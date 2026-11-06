"""Lecture bornée des pages publiques, sans cookie ni compte de plateforme.

Une source inaccessible n'est jamais présentée comme une recherche exhaustive
sans résultat. Aucun proxy de contournement, endpoint privé ou CAPTCHA résolu.
"""
import copy
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

import boards
from sourcing import clean

MAX_BYTES = 2_000_000
CACHE = {}
LOCK = threading.RLock()


class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children = []

    def text(self):
        return clean(' '.join(c.text() if isinstance(c, Node) else c for c in self.children))

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk()


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Node()
        self.count = 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.count += 1
        if self.count > 40000:
            raise ValueError('Page trop complexe.')
        # Tolère les pages HTML qui ne ferment pas leurs cartes <li>.
        if tag == 'li' and self.current.tag == 'li':
            self.current = self.current.parent
        node = Node(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in ('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'):
            self.current = node

    def handle_endtag(self, tag):
        node = self.current
        while node.parent:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, value):
        self.current.children.append(value)


def first_text(node, classes=(), tags=()):
    return next((n.text() for n in node.walk() if n.tag in tags or any(c in n.attrs.get('class', '').split() for c in classes)), '')


def parse_page(source, raw, url):
    doc = Document(raw)
    offers = {}

    def add(row):
        try:
            normalized = boards.parse_offer(source, row)
            offers.setdefault(normalized['offer_id'], row)
        except (ValueError, TypeError):
            pass

    def structured(value):
        if isinstance(value, list):
            for item in value[:100]:
                structured(item)
        elif isinstance(value, dict):
            if value.get('@type') == 'JobPosting':
                organization = value.get('hiringOrganization') or {}
                location = value.get('jobLocation') or {}
                if isinstance(location, list):
                    location = next(iter(location), {})
                address = location.get('address', {}) if isinstance(location, dict) else {}
                add({'url': value.get('url', ''), 'title': value.get('title'),
                     'company': organization.get('name') if isinstance(organization, dict) else '',
                     'location': address.get('addressLocality') if isinstance(address, dict) else '',
                     'summary': value.get('description'), 'posted': value.get('datePosted'),
                     'contract': clean(value.get('employmentType'))})
            for key in ('@graph', 'itemListElement', 'item'):
                if key in value:
                    structured(value[key])

    for node in doc.root.walk():
        if node.tag == 'script' and node.attrs.get('type') == 'application/ld+json':
            try:
                structured(json.loads(''.join(c for c in node.children if isinstance(c, str))))
            except (ValueError, RecursionError):
                pass
        if node.tag != 'a' or not node.attrs.get('href'):
            continue
        link = urllib.parse.urljoin(url, node.attrs['href'])
        try:
            link = boards.canonical_job(source, link)
        except ValueError:
            continue
        card = node
        candidate = node
        while candidate is not None:
            if candidate.tag in ('article', 'li') or 'base-search-card' in candidate.attrs.get('class', '').split():
                card = candidate
                break
            candidate = candidate.parent
        title = first_text(card, ('base-search-card__title', 'job-title', 'jobCard-title', 'job-title-link'), ('h3', 'h2')) or node.text()
        if len(title) < 3 or clean(title).lower() in ('voir l’offre', 'voir l\'offre', 'postuler'):
            continue
        posted = next((n.attrs.get('datetime', '') for n in card.walk() if n.tag == 'time'), '')
        row = {'url': link, 'title': title,
               'company': first_text(card, ('base-search-card__subtitle', 'companyName', 'company-name', 'job-company')),
               'location': first_text(card, ('job-search-card__location', 'companyLocation', 'job-location')),
               'posted': posted,
               'summary': first_text(card, ('job-snippet', 'job-description', 'job-search-card__snippet', 'cards__description'))}
        if source == 'hellowork' and node.attrs.get('data-cy') == 'offerTitle':
            parts = [n.text() for n in node.walk() if n.tag == 'span' and n.text()]
            if len(parts) >= 2:
                row.update(title=parts[0], company=parts[1])
            label = node.attrs.get('aria-label', '')
            place = re.search(r' à (.+?), chez .+?, pour (?:un |une )?(.+?)(?:,|$)', label)
            if place:
                row.update(location=place[1], contract=place[2])
        elif source == 'meteojob':
            row['company'] = first_text(card, ('d-inline-block',), ())
            badges = [n.text() for n in card.walk() if 'cc-badge-gray' in n.attrs.get('class', '').split()]
            if badges:
                row['location'] = re.sub(r'^place\s+', '', badges[0])
            if len(badges) > 1:
                row['contract'] = badges[1]
        elif source == 'randstad':
            metadata = [n.text() for n in card.walk() if 'cards__meta-item' in n.attrs.get('class', '').split()]
            if metadata:
                row['location'] = metadata[0]
            if len(metadata) > 1:
                row['contract'] = metadata[1]
        add(row)
    return list(offers.values())[:30]


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urllib.parse.urlsplit(req.full_url), urllib.parse.urlsplit(newurl)
        if new.scheme != 'https' or new.hostname != old.hostname or new.username or new.password or new.port not in (None, 443):
            raise ValueError('Redirection hors de la source publique.')
        if any(part in new.path.lower() for part in ('/login', '/authwall', '/checkpoint', '/signin', '/captcha')):
            raise ValueError('Le site exige une connexion ou une vérification.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_page(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'JobBot/8.0 public-job-search', 'Accept': 'text/html', 'Accept-Language': 'fr-FR,fr;q=0.9'})
    with urllib.request.build_opener(PublicRedirect()).open(request, timeout=8) as response:
        if 'html' not in response.headers.get('Content-Type', '').lower():
            raise ValueError('Page publique non lisible.')
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError('Page trop volumineuse.')
        return raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')


def search_site(source, query, city, code=''):
    if source not in boards.SITES:
        raise ValueError('Site inconnu.')
    key = (source, query, city, code)
    with LOCK:
        saved = CACHE.get(key)
        if saved and time.monotonic() - saved[0] < 600:
            return copy.deepcopy(saved[1])
    url = boards.search_urls(query, city, code)[source]
    if source == 'linkedin':
        # Fragment public que LinkedIn fournit aux visiteurs sans compte.
        url = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?' + urllib.parse.urlencode({'keywords': query, 'location': city + ', France', 'start': 0})
    result = {'source_id': source, 'offers': [], 'status': 'unavailable', 'partial': True}
    try:
        if not url:
            raise ValueError('Commune non reconnue.')
        raw = fetch_page(url)
        if re.search(r'anomaly-modal|g-recaptcha|cf-chl-|challenge-platform|/checkpoint/challenge', raw, re.I):
            raise ValueError('Vérification demandée par le site.')
        rows = parse_page(source, raw, url)
        result.update(offers=rows, status='results' if rows else 'unavailable',
                      message=f'{len(rows)} annonce(s) publique(s) lue(s), sans connexion. Première page uniquement.' if rows else 'Aucune annonce lisible dans la page publique. Cela ne signifie pas qu’il n’y a pas d’offres. Consulte ce site si besoin.')
    except (OSError, ValueError, RecursionError, urllib.error.HTTPError):
        result['message'] = 'Recherche publique indisponible depuis cet hébergement ou limitée par le site. Les autres sources continuent ; tu peux consulter ce site directement.'
    with LOCK:
        if len(CACHE) >= 64:
            CACHE.pop(next(iter(CACHE)))
        CACHE[key] = (time.monotonic(), copy.deepcopy(result))
    return result


def read_detail(source, url):
    url = boards.canonical_job(source, url)
    key = ('detail', source, url)
    with LOCK:
        saved = CACHE.get(key)
        if saved and time.monotonic() - saved[0] < 600:
            return copy.deepcopy(saved[1])
    public_url = url
    if source == 'linkedin':
        identifier = urllib.parse.urlsplit(url).path.strip('/').split('/')[-1]
        public_url = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/' + identifier
    result = {'status': 'unavailable', 'description': '', 'full': False, 'people': [],
              'message': 'Description publique indisponible. Ouvre la source pour compléter le texte avant de candidater.'}
    try:
        doc = Document(fetch_page(public_url))
        description = first_text(doc.root, ('show-more-less-html__markup', 'jobs-description__content', 'description__text', 'job-description'))
        if not description:
            description = next((n.text() for n in doc.root.walk() if n.attrs.get('id') == 'jobDescriptionText' or n.attrs.get('itemprop') == 'description' or n.attrs.get('data-cy') == 'jobDescription'), '')
        if description and len(description) > 120:
            result.update(status='done', description=description[:40000], full=True, message='Description publique lue, sans connexion.')
        for node in doc.root.walk():
            link = urllib.parse.urljoin(url, node.attrs.get('href') or '')
            parsed = urllib.parse.urlsplit(link)
            if node.tag != 'a' or parsed.scheme != 'https' or parsed.hostname not in ('www.linkedin.com', 'fr.linkedin.com') or not parsed.path.startswith('/in/'):
                continue
            context = node
            while context.parent and context.tag not in ('section', 'article') and not re.search('hirer|poster|recruiter', context.attrs.get('class', ''), re.I):
                context = context.parent
            name = node.text()
            if len(result['people']) < 5 and 3 < len(name) < 100 and context.tag and re.search('recrut|talent|hiring|recruit|ressources humaines', context.text(), re.I):
                result['people'].append({'name': name, 'profile_url': link, 'context': context.text()[:500], 'role': 'Personne mentionnée dans cette annonce ; fonction à vérifier'})
    except (OSError, ValueError, RecursionError):
        pass
    with LOCK:
        if len(CACHE) >= 64:
            CACHE.pop(next(iter(CACHE)))
        CACHE[key] = (time.monotonic(), copy.deepcopy(result))
    return result


def enrich_offer(engine, offer_id):
    offer = next((o for o in engine.get_feed()['offers'] if o['offer_id'] == offer_id), None)
    if not offer or offer.get('description_kind') == 'full':
        return
    value = engine.enrichment.read(engine.DATA)
    engine.enrichment.add_task(value, 'detail', offer['source_url'], offer['company'], offer_id, priority=0)
    engine.enrichment.write(engine.DATA, value)
    task = next(t for t in value['tasks'].values() if t['kind'] == 'detail' and t.get('offer_id') == offer_id)
    result = read_detail(offer['source_id'], offer['source_url'])
    engine.enrichment.receive(engine.DATA, {**result, 'task_id': task['id']}, engine.public_text)
