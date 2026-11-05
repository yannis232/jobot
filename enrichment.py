"""Analyse locale et recherche de coordonnées professionnelles publiées.

Les pages de recherche sont lues par le navigateur. Une adresse n'est utilisable
que si une page source accessible la publie près d'une consigne de candidature.
"""
import hashlib
import json
import re
import secrets
import shutil
import threading
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from sourcing import clean, normalized, stamp

LOCK = threading.RLock()
BOARD_HOSTS = {'fr.indeed.com', 'candidat.francetravail.fr', 'www.hellowork.com', 'www.linkedin.com'}
EMAIL_RE = re.compile(r'[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', re.I)
RECRUIT_RE = re.compile(r'candidatur|postul|votre cv|ton cv|envoyez.{0,60}cv|recrutement', re.I)


def company_key(company):
    return normalized(clean(company))


def state_path(data):
    return Path(data) / 'enrichissement.json'


def read(data):
    path = state_path(data)
    try:
        value = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(value, dict) or not all(isinstance(value.get(k), dict) for k in ('offers', 'companies', 'tasks')):
            raise ValueError('Format incorrect')
        return value
    except FileNotFoundError:
        return {'offers': {}, 'companies': {}, 'tasks': {}}
    except (ValueError, OSError):
        return {'offers': {}, 'companies': {}, 'tasks': {}, 'damaged': True}


def write(data, value):
    path = state_path(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    if value.pop('damaged', False) and path.exists():
        shutil.copyfile(path, path.with_name('enrichissement_ancien_' + secrets.token_hex(4) + '.json'))
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)


def analyze(offer, profile=None):
    text = clean(offer.get('description') or offer.get('summary'))
    segments = re.split(r'(?<=[.!?;])\s+|\n+', text)
    patterns = [('Diplômes / formation', r'dipl[oô]me|bts|baccalaur|bac\s?[+p]|formation|certific'),
                ('Expérience', r'exp[eé]rience|d[eé]butant|junior|[0-9]\s*an'),
                ('Transport / permis', r'permis|v[eé]hicul|d[eé]placement|caces'),
                ('Horaires', r'horair|nuit|week.?end|samedi|dimanche|\d{1,2}\s*h'),
                ('Contrat / salaire', r'\bcdi\b|\bcdd\b|int[eé]rim|alternance|salaire|r[eé]mun[eé]r|\b[e€]uros?\b|€')]
    requirements = []
    for label, pattern in patterns:
        matches = [s.strip()[:480] for s in segments if re.search(pattern, s, re.I)][:2]
        requirements.append({'label': label, 'text': ' '.join(matches) or 'Non précisé dans le texte lu.'})
    full = offer.get('description_kind') == 'full'
    mandatory = bool(re.search(r'(?:uniquement|exclusivement|obligatoirement|imp[eé]rativement).{0,110}(?:formulaire|plateforme|portail|site)|(?:formulaire|plateforme|portail).{0,70}(?:obligatoire|exclusif)', normalized(text)))
    skills = []
    for skill in (profile or {}).get('skills', []):
        words = re.findall(r'\w{4,}', normalized(skill))
        if any(w in normalized(text) for w in words):
            skills.append(skill)
    constraints = (profile or {}).get('constraints', '')
    cautions = []
    if not full:
        cautions.append('Analyse d’un aperçu : les exigences absentes restent à vérifier dans la description complète.')
    if constraints:
        cautions.append('Tes contraintes déclarées : ' + str(constraints))
    if mandatory:
        cautions.append('Le texte indique un passage obligatoire par un formulaire ou une plateforme.')
    return {'coverage': 'Description complète lue' if full else 'Aperçu de la carte',
            'requirements': requirements, 'matching_skills': skills[:8], 'cautions': cautions,
            'form_mandatory': mandatory, 'checked_at': offer.get('checked_at', '')}


def published_emails(text, url, company, exact_offer=False):
    text = clean(text)
    # Une mention de l'entreprise est nécessaire sur une autre page ; une adresse
    # dans un résultat de moteur n'est jamais considérée comme vérifiée.
    if not exact_offer and (len(company_key(company)) < 4 or company_key(company) not in normalized(text)):
        return []
    found = {}
    for match in EMAIL_RE.finditer(text):
        address = match.group().strip('.').lower()
        local = address.split('@')[0]
        if any(s in local for s in ('noreply', 'no-reply', 'donotreply', 'dpo', 'privacy', 'support', 'abuse')):
            continue
        context = text[max(0, match.start()-230):match.end()+230]
        explicit = re.search(r'candidatur|postul|votre cv|ton cv|envoyez.{0,60}cv', context, re.I)
        recruitment_mailbox = re.search(r'recrut|talent|career|jobs|candidat|^rh[._-]?', local, re.I)
        if not (explicit or (recruitment_mailbox and RECRUIT_RE.search(context))) or re.search(r'rgpd|donn[eé]es personnelles|confidentialit[eé]|privacy', context, re.I):
            continue
        found[address] = {'email': address, 'source_url': url, 'context': context[:500],
                          'verified': True, 'verified_at': stamp(), 'company': company,
                          'person_name': '', 'kind': 'recruitment',
                          'scope': 'offer' if exact_offer else 'company',
                          'association': 'Publiée dans cette offre' if exact_offer else 'Publiée sur une page citant cette entreprise ; destinataire à relire'}
    return list(found.values())[:5]


def add_task(value, kind, url, company, offer_id='', priority=5):
    key = hashlib.sha256((kind+'|'+url).encode()).hexdigest()[:24]
    if key in value['tasks']:
        value['tasks'][key]['priority'] = min(priority, value['tasks'][key].get('priority', 5))
        return
    value['tasks'][key] = {'id': key, 'kind': kind, 'url': url, 'company': company,
                           'offer_id': offer_id, 'status': 'queued', 'created_at': stamp(), 'priority': priority}


def queue_offers(data, offers, priority=False):
    with LOCK:
        value = read(data)
        for offer in offers:
            oid, company = offer.get('offer_id', ''), offer.get('company', '')
            if not oid:
                continue
            if oid not in value['offers']:
                value['offers'][oid] = {'status': 'queued', 'company': company}
                add_task(value, 'detail', offer['source_url'], company, oid, 0 if priority else 5)
            elif priority:
                for t in value['tasks'].values():
                    if t.get('offer_id') == oid:
                        t['priority'] = 0
                        if t['status'] in ('needs_user', 'unavailable'):
                            t['status'] = 'queued'
            if not company or company == 'Entreprise non précisée':
                continue
            key = company_key(company)
            if key not in value['companies']:
                value['companies'][key] = {'company': company, 'status': 'queued', 'people': [], 'emails': []}
                for mode, query in [('people', f'"{company}" recrutement recruteur site:linkedin.com/in/'),
                                    ('email', f'"{company}" recrutement candidature email contact')]:
                    url = 'https://www.bing.com/search?' + urllib.parse.urlencode({'q': query, 'setlang': 'fr'})
                    add_task(value, mode, url, company, priority=1 if priority else 6)
            elif priority:
                for t in value['tasks'].values():
                    if company_key(t['company']) == key and t['kind'] != 'detail':
                        t['priority'] = 1
                        if t['status'] in ('needs_user', 'unavailable'):
                            t['status'] = 'queued'
        write(data, value)


def pending(data):
    with LOCK:
        value = read(data)
        tasks = []
        for task in value['tasks'].values():
            if task['status'] == 'running':
                age = (datetime.now(timezone.utc)-datetime.fromisoformat(task['started_at'])).total_seconds()
                if age > 180:
                    task['status'] = 'queued'
            if task['status'] == 'queued':
                tasks.append(task)
        return sorted(tasks, key=lambda t: (t.get('priority', 5), t['created_at']))[:16]


def receive(data, payload, public_reader):
    tid = payload.get('task_id')
    with LOCK:
        value = read(data)
        task = value['tasks'].get(tid)
        if not task:
            raise ValueError('Recherche de contact inconnue.')
        if payload.get('status') == 'running':
            task.update(status='running', started_at=stamp())
            write(data, value)
            return
        task = dict(task)
    status = payload.get('status')
    if status not in ('done', 'needs_user', 'unavailable'):
        raise ValueError('État de recherche incorrect.')
    result = {'status': status, 'checked_at': stamp(), 'message': clean(payload.get('message'))[:400]}
    company = task['company']
    emails, people = [], []
    if task['kind'] == 'detail' and status == 'done':
        description = clean(payload.get('description'))[:40000]
        result.update(description=description, description_kind='full' if payload.get('full') is True else 'excerpt')
        emails = published_emails(description, task['url'], company, exact_offer=True)
        for person in payload.get('people', [])[:5]:
            url = person.get('profile_url', '')
            if valid_profile(url) and person.get('name'):
                people.append({'name': clean(person['name'])[:100], 'company': company, 'profile_url': url,
                               'role': clean(person.get('role'))[:200] or 'Personne mentionnée dans l’annonce ; fonction à confirmer',
                               'source_url': task['url'], 'context': clean(person.get('context'))[:500], 'confidence': 'offer', 'checked_at': stamp(), 'offer_id': task['offer_id']})
        for email in emails:
            for person in people:
                pattern = re.escape(normalized(person['name'])) + r'[^@]{0,90}' + re.escape(normalized(email['email']))
                if re.search(pattern, normalized(email['context'])):
                    email['person_name'] = person['name']
                    email['person_profile_url'] = person['profile_url']
                    email['association'] = 'Adresse publiée près du nom de ' + person['name'] + ' dans cette annonce ; attribution à relire dans la source'
                    break
    elif task['kind'] in ('people', 'email') and status == 'done':
        rows = payload.get('results', [])
        if not isinstance(rows, list):
            raise ValueError('Résultats de recherche incorrects.')
        public_pages = []
        for row in rows[:8]:
            if not isinstance(row, dict):
                continue
            text = clean(str(row.get('title', '')) + ' ' + str(row.get('snippet', '')))
            url = str(row.get('url', ''))[:3000]
            if company_key(company) not in normalized(text):
                continue
            if valid_profile(url) and re.search(r'recrut|talent|ressources humaines|recruit|hiring', text, re.I):
                name = re.split(r'\s+[|–-]\s+', clean(row.get('title')))[0].replace(' | LinkedIn', '').strip()
                if 3 <= len(name) <= 100:
                    people.append({'name': name, 'company': company, 'profile_url': url,
                                   'role': 'Profil public mentionnant le recrutement ; poste actuel à vérifier',
                                   'source_url': task['url'], 'context': text[:500], 'confidence': 'search', 'checked_at': stamp()})
            elif task['kind'] == 'email':
                host = (urllib.parse.urlsplit(url).hostname or '').lower()
                if url.startswith('https://') and host not in BOARD_HOSTS and not any(x in host for x in ('linkedin.com', 'facebook.com', 'instagram.com', 'bing.com', 'google.com')):
                    public_pages.append(url)
        # Vérification sur les pages elles-mêmes, jamais à partir de l'extrait du moteur.
        for url in list(dict.fromkeys(public_pages))[:3]:
            try:
                page = public_reader(url)
                emails.extend(published_emails(page, url, company))
            except (ValueError, OSError):
                continue
    with LOCK:
        value = read(data)
        current = value['tasks'][tid]
        current.update(status=status, checked_at=stamp(), message=result['message'])
        if task['kind'] == 'detail':
            result['emails'] = emails
            result['people'] = people
            value['offers'][task['offer_id']] = result
        bucket = value['companies'].setdefault(company_key(company), {'company': company, 'people': [], 'emails': []})
        known = {p['profile_url']: p for p in bucket.get('people', [])}
        known.update({p['profile_url']: p for p in people})
        bucket['people'] = list(known.values())
        known_emails = {e['email']: e for e in bucket.get('emails', [])}
        known_emails.update({e['email']: e for e in emails})
        bucket['emails'] = list(known_emails.values())
        unfinished = [t for t in value['tasks'].values() if company_key(t['company']) == company_key(company) and t['kind'] != 'detail' and t['status'] in ('queued', 'running')]
        failed = any(t['status'] in ('needs_user', 'unavailable') for t in value['tasks'].values() if company_key(t['company']) == company_key(company) and t['kind'] != 'detail')
        bucket.update(status='running' if unfinished else ('found' if bucket['people'] or bucket['emails'] else 'unavailable' if failed else 'none'), checked_at=stamp())
        write(data, value)


def valid_profile(url):
    try:
        p = urllib.parse.urlsplit(url)
        return p.scheme == 'https' and p.hostname in ('www.linkedin.com', 'fr.linkedin.com', 'linkedin.com') and p.path.startswith('/in/') and not p.username and not p.password
    except ValueError:
        return False


def decorate(offer, value, profile=None):
    offer = dict(offer)
    detail = value.get('offers', {}).get(offer.get('offer_id'), {})
    if detail.get('description'):
        offer.update(description=detail['description'], description_kind=detail['description_kind'])
    company = value.get('companies', {}).get(company_key(offer.get('company', '')), {})
    people = list({p['profile_url']: p for p in [*detail.get('people', []), *[p for p in company.get('people', []) if not p.get('offer_id') or p['offer_id'] == offer.get('offer_id')]]}.values())
    emails = list({e['email']+'|'+e['source_url']: e for e in [*detail.get('emails', []), *[e for e in company.get('emails', []) if e.get('scope') != 'offer' or e['source_url'] == offer.get('source_url')]]}.values())
    offer['research'] = {'detail_status': detail.get('status', 'queued'),
                         'status': company.get('status', 'queued'), 'people': people,
                         'emails': emails, 'checked_at': company.get('checked_at', '')}
    offer['analysis'] = analyze(offer, profile)
    offer['form_mandatory'] = offer['analysis']['form_mandatory']
    # L'email provenant de l'offre elle-même prime sur une page de l'entreprise.
    # Une adresse d'un autre établissement ou d'une autre annonce du même
    # groupe n'est jamais attribuée automatiquement à cette offre.
    verified = next((e for e in detail.get('emails', []) if e.get('verified')), None)
    if verified and not offer.get('email_opt_out') and (not offer.get('email') or offer.get('email_auto')):
        offer.update(email=verified['email'], email_source=verified['source_url'], email_auto=True,
                     email_context=verified['context'], email_association=verified['association'])
    return offer


def summary(value):
    counts = {state: sum(t['status'] == state for t in value.get('tasks', {}).values()) for state in ('queued', 'running', 'done', 'needs_user', 'unavailable')}
    return {'counts': counts, 'total': len(value.get('tasks', {})),
            'companies': len(value.get('companies', {})),
            'emails': sum(len(c.get('emails', [])) for c in value.get('companies', {}).values()),
            'people': sum(len(c.get('people', [])) for c in value.get('companies', {}).values()),
            'messages': list(dict.fromkeys(t.get('message', '') for t in value.get('tasks', {}).values() if t['status'] in ('needs_user', 'unavailable') and t.get('message')))[:3]}
