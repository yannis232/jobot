"""Recherche des quatre sites via les pages ouvertes dans le navigateur JobBot.

Le serveur ne consulte aucun endpoint privé : le module du navigateur transmet
les cartes réellement présentes dans les pages de résultats.
"""
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from sourcing import clean, normalized, stamp

SITES = {'indeed': 'Indeed France', 'francetravail': 'France Travail',
         'hellowork': 'HelloWork', 'linkedin': 'LinkedIn', 'meteojob': 'Météojob',
         'adecco': 'Adecco', 'manpower': 'Manpower', 'randstad': 'Randstad'}
LOCK = threading.RLock()
AUTO_SEARCH = True
STATUSES = {'opening', 'reading', 'results', 'empty', 'needs_user', 'unavailable'}


def empty_feed():
    return {'mode': 'boards', 'search_id': '', 'query': 'employé polyvalent', 'city': 'Lyon',
            'offers': [], 'sources': {k: {'label': v, 'status': 'idle', 'count': 0,
                                         'message': 'Prêt pour la recherche.', 'url': ''} for k, v in SITES.items()},
            'checked_at': '', 'started_at': '', 'running': False, 'errors': [], 'by_source': {}, 'revision': 0}


def path_for(data):
    return Path(data) / 'recherche_multisite.json'


def save(data, value):
    path = path_for(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)


def canonical_job(source, url):
    """N'accepter que les liens d'annonces du site dont provient le résultat."""
    if not isinstance(url, str) or len(url) > 4000:
        raise ValueError('Lien d’annonce incorrect.')
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or u.username or u.password or u.port not in (None, 443):
        raise ValueError('Lien d’annonce non autorisé.')
    host = (u.hostname or '').lower()
    if source == 'indeed' and host == 'fr.indeed.com' and u.path in ('/viewjob', '/rc/clk', '/pagead/clk'):
        key = urllib.parse.parse_qs(u.query).get('jk', [''])[0]
        if re.fullmatch(r'[a-zA-Z0-9_-]{6,80}', key):
            return 'https://fr.indeed.com/viewjob?' + urllib.parse.urlencode({'jk': key})
    if source == 'francetravail' and host == 'candidat.francetravail.fr':
        m = re.fullmatch(r'/offres/recherche/detail/([A-Za-z0-9]{5,30})/?', u.path)
        if m:
            return 'https://candidat.francetravail.fr/offres/recherche/detail/' + m[1]
    if source == 'hellowork' and host in ('www.hellowork.com', 'hellowork.com'):
        m = re.fullmatch(r'/fr-fr/emplois/(\d{5,20})\.html', u.path)
        if m:
            return 'https://www.hellowork.com/fr-fr/emplois/' + m[1] + '.html'
    if source == 'linkedin' and host in ('www.linkedin.com', 'fr.linkedin.com', 'linkedin.com'):
        m = re.fullmatch(r'/jobs/view/(?:[^/]*-)?(\d{5,20})/?', u.path)
        if m:
            return 'https://www.linkedin.com/jobs/view/' + m[1] + '/'
    if source == 'meteojob' and host in ('www.meteojob.com', 'meteojob.com') and re.fullmatch(r'/jobs/\d{5,20}/?', u.path):
        return 'https://www.meteojob.com' + u.path.rstrip('/')
    if source == 'adecco' and host == 'www.adecco.com' and re.fullmatch(r'/fr-fr/offres-emploi/[^/]+/[A-Za-z0-9-]{5,40}/?', u.path):
        return 'https://www.adecco.com' + u.path.rstrip('/')
    if source == 'manpower' and host == 'www.manpower.fr' and re.fullmatch(r'/offers/details/\d{5,20}/?', u.path):
        return 'https://www.manpower.fr' + u.path.rstrip('/')
    if source == 'randstad' and host == 'www.randstad.fr' and re.fullmatch(r'/emploi/[^/]+_[^/]+_[^/]+/?', u.path):
        return 'https://www.randstad.fr' + u.path.rstrip('/') + '/'
    raise ValueError('Ce lien ne correspond pas à une annonce du site indiqué.')


def parse_offer(source, item):
    if not isinstance(item, dict):
        raise ValueError('Offre incorrecte.')
    url = canonical_job(source, item.get('url'))
    title = clean(item.get('title'))[:300]
    if len(title) < 3:
        raise ValueError('Le titre de l’annonce manque.')
    company = clean(item.get('company'))[:200] or 'Entreprise non précisée'
    location = clean(item.get('location'))[:300] or 'Lieu non précisé'
    excerpt = clean(item.get('summary'))[:2500]
    posted = str(item.get('posted') or '')[:10]
    try:
        datetime.strptime(posted, '%Y-%m-%d')
    except ValueError:
        posted = ''
    return {'offer_id': hashlib.sha256(url.encode()).hexdigest()[:20],
            'posting_id': url, 'provider': SITES[source], 'source_id': source,
            'employer_id': '', 'employer_label': company, 'title': title,
            'company': company, 'city': location, 'location': location,
            'description': excerpt, 'summary': excerpt, 'description_kind': 'excerpt',
            'source_url': url, 'apply_url': url, 'posted': posted,
            'posted_label': clean(item.get('posted_label'))[:100], 'checked_at': stamp(),
            'active': True, 'contract': clean(item.get('contract'))[:120],
            'experience': '', 'creator': '', 'email': '', 'email_source': ''}


def collect(feed):
    # Un même identifiant d'annonce n'apparaît qu'une fois. Deux postes au même
    # intitulé dans une entreprise peuvent être distincts : ne pas les fusionner.
    found = {}
    for source in SITES:
        for offer in feed.get('by_source', {}).get(source, []):
            found[offer['offer_id']] = offer
    feed['offers'] = sorted(found.values(), key=lambda o: o.get('posted', ''), reverse=True)
    feed['running'] = any(s['status'] in ('opening', 'reading') for s in feed['sources'].values())
    return feed


def load(data, internal=False):
    with LOCK:
        path = path_for(data)
        if not path.exists():
            return empty_feed()
        try:
            saved = json.loads(path.read_text(encoding='utf-8-sig'))
            if not isinstance(saved, dict) or saved.get('mode') != 'boards' or not isinstance(saved.get('by_source'), dict):
                raise ValueError('Recherche enregistrée incorrecte.')
            feed = {**empty_feed(), **saved}
            feed['sources'] = {key: {**empty_feed()['sources'][key], **saved.get('sources', {}).get(key, {})} for key in SITES}
            buckets = {}
            for source in SITES:
                buckets[source] = []
                for item in saved['by_source'].get(source, [])[:300]:
                    try:
                        offer = parse_offer(source, {**item, 'url': item.get('source_url')})
                        offer['checked_at'] = item.get('checked_at', '')
                        buckets[source].append(offer)
                    except (ValueError, TypeError):
                        continue
            feed['by_source'] = buckets
            # Une recherche laissée ouverte lors d'un ancien lancement ne tourne
            # pas indéfiniment si ses onglets ont été fermés.
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(feed['started_at'])).total_seconds()
            if age > 180:
                for status in feed['sources'].values():
                    if status['status'] in ('opening', 'reading'):
                        status.update(status='unavailable', message='Lecture interrompue. Clique sur Reprendre ce site.')
            collect(feed)
        except (ValueError, TypeError, KeyError, AttributeError, OSError):
            feed = empty_feed()
            feed['errors'] = ['La dernière recherche ne peut pas être lue. Son fichier est conservé ; relance une recherche.']
        if not internal:
            feed.pop('by_source', None)
        return feed


def resolve_city(city):
    # Lyon est le projet déjà renseigné. Les autres communes viennent du
    # référentiel public, jamais d'un code INSEE deviné depuis un code postal.
    if normalized(city) == 'lyon':
        return '69123', 'Lyon'
    params = {'fields': 'code,nom,population', 'boost': 'population', 'limit': 10}
    params['codePostal' if re.fullmatch(r'\d{5}', city) else 'nom'] = city
    try:
        url = 'https://geo.api.gouv.fr/communes?' + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=5) as response:
            towns = json.loads(response.read(100_000))
        matches = [t for t in towns if 'codePostal' in params or normalized(t['nom']) == normalized(city)]
        if matches:
            town = max(matches, key=lambda t: t.get('population', 0) or 0)
            return town['code'], town['nom']
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return '', city


def search_urls(query, city, code):
    q = urllib.parse.urlencode
    return {
        'indeed': 'https://fr.indeed.com/jobs?' + q({'q': query, 'l': city, 'sort': 'date'}),
        'francetravail': ('https://candidat.francetravail.fr/offres/recherche?' + q({'motsCles': query, 'lieux': code, 'rayon': 20, 'tri': 0, 'offresPartenaires': 'true'})) if code else '',
        'hellowork': 'https://www.hellowork.com/fr-fr/emploi/recherche.html?' + q({'k': query, 'l': city}),
        'linkedin': 'https://www.linkedin.com/jobs/search/?' + q({'keywords': query, 'location': city + ', France', 'sortBy': 'DD'}),
        'meteojob': 'https://www.meteojob.com/jobs?' + q({'what': query, 'where': city}),
        'adecco': 'https://www.adecco.com/fr-fr/offres-emploi?' + q({'jobTitle': query, 'jobLocation': city + ', France', 'radius': 20}),
        'manpower': 'https://www.manpower.fr/offre-emploi/' + urllib.parse.quote(query.replace(' ', '+'), safe='') + '/' + urllib.parse.quote(normalized(city).replace(' ', '-'), safe=''),
        'randstad': 'https://www.randstad.fr/emploi/q-' + urllib.parse.quote(normalized(query).replace(' ', '-'), safe='') + '/' + urllib.parse.quote(normalized(city).replace(' ', '-'), safe='') + '/',
    }


def start(data, query, city):
    query, city = clean(query)[:200], clean(city)[:80]
    if not query or not city:
        raise ValueError('Indique un métier et une ville pour les huit sites.')
    code, town = resolve_city(city)
    urls = search_urls(query, town, code)
    with LOCK:
        old = path_for(data)
        if old.exists():
            shutil.copyfile(old, old.with_name('recherche_precedente.json'))
        feed = empty_feed()
        feed.update(search_id=secrets.token_hex(16), query=query, city=town,
                    started_at=stamp(), checked_at='', commune_code=code)
        for source, state in feed['sources'].items():
            state.update(url=urls[source], status='opening' if urls[source] else 'unavailable',
                         message='Ouverture de la recherche…' if urls[source] else 'Commune non identifiée. Saisis le nom exact ou le code postal puis relance.')
        collect(feed)
        save(data, feed)
        feed.pop('by_source')
        return feed


def receive(data, payload):
    with LOCK:
        feed = load(data, internal=True)
        source, status = payload.get('source_id'), payload.get('status')
        if not feed['search_id'] or payload.get('search_id') != feed['search_id']:
            raise ValueError('Cette recherche a été remplacée. Ses résultats ne sont pas mélangés à la nouvelle.')
        if source not in SITES or status not in STATUSES:
            raise ValueError('Site ou état de lecture incorrect.')
        rows = payload.get('offers', [])
        if not isinstance(rows, list) or len(rows) > 30:
            raise ValueError('Liste d’offres incorrecte.')
        current = {o['offer_id']: o for o in feed['by_source'].get(source, [])}
        rejected = 0
        for row in rows:
            try:
                offer = parse_offer(source, row)
                current[offer['offer_id']] = offer
            except (ValueError, TypeError):
                rejected += 1
        feed['by_source'][source] = list(current.values())[:300]
        count = len(feed['by_source'][source])
        if status == 'empty' and (rows or count or rejected):
            status = 'results' if count else 'unavailable'
        if status == 'results' and not count:
            status = 'unavailable'
        state = feed['sources'][source]
        state.update(status=status, count=count, checked_at=stamp(),
                     message=clean(payload.get('message'))[:400], partial=bool(payload.get('partial', False)))
        if rejected:
            state['message'] = f'{count} offre(s) lisible(s) ; {rejected} carte(s) non reconnue(s).'
        if len(current) > 300:
            state['message'] = '300 offres conservées pour ce site. Lance une recherche plus précise pour les suivantes.'
        feed['checked_at'] = stamp()
        feed['revision'] = int(feed.get('revision', 0)) + 1
        collect(feed)
        save(data, feed)
        feed.pop('by_source')
        return feed


def opera_path():
    for base in (os.environ.get('LOCALAPPDATA'), os.environ.get('ProgramFiles'), os.environ.get('ProgramFiles(x86)')):
        if base:
            for folder in ('Programs/Opera', 'Programs/Opera GX', 'Opera', 'Opera GX'):
                for name in ('opera.exe', 'launcher.exe'):
                    candidate = Path(base) / folder / name
                    if candidate.is_file():
                        return candidate
    return None


def open_browser(root, data, url):
    browser = opera_path()
    if not browser:
        raise ValueError('Opera est nécessaire pour cette version. Installe Opera puis relance JobBot.')
    profile = Path(data).resolve() / 'navigateur_opera'
    try:
        saved = json.loads((Path(data) / 'profil_navigateur.json').read_text(encoding='utf-8'))
        previous = Path(saved['path'])
        if previous.name == 'navigateur_opera' and previous.is_dir():
            profile = previous.resolve()
    except (OSError, ValueError, KeyError, TypeError):
        pass
    profile.mkdir(parents=True, exist_ok=True)
    extension = (Path(root) / 'extension').resolve()
    startup = None
    if os.name == 'nt':
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 1  # La fenêtre de l'application doit être visible, même si son lanceur est masqué.
    # Profil propre à l'application. Pas de modification des profils existants,
    # de cookie importé, d'option de contournement TLS ou de protection du navigateur.
    subprocess.Popen([str(browser), '--user-data-dir=' + str(profile), '--no-first-run',
                      '--no-default-browser-check', '--load-extension=' + str(extension),
                      '--new-window', url], startupinfo=startup,
                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    return {'message': 'Fenêtre Opera JobBot ouverte. Tes connexions aux sites restent dans ce navigateur.'}
