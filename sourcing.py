"""Lecture des flux publics d'employeurs SmartRecruiters, sans compte candidat."""
import hashlib
import html
import json
import re
import threading
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

EMPLOYERS = {
    'GroupementMousquetaires': 'Intermarché / Netto / Mousquetaires',
    'METROMAKRO': 'METRO France',
    'EVERIENCE': 'HELPLINE / Everience',
    'AccorHotel': 'Hôtels Accor',
}
REFRESH_LOCK = threading.Lock()


def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', str(value or '')))).strip()


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value).lower()) if unicodedata.category(c) != 'Mn')


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def read_json(url):
    if not url.startswith('https://api.smartrecruiters.com/v1/companies/'):
        raise ValueError('Source d’offres non autorisée.')
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'JobBot/6.0 personal-job-search'})
    with urllib.request.urlopen(req, timeout=18) as response:
        data = response.read(6_000_001)
        if len(data) > 6_000_000:
            raise ValueError('Flux trop volumineux.')
        return json.loads(data)


def relevant(title):
    t = normalized(title)
    if any(w in t for w in ('directeur', 'responsable', 'manager', 'ingenieur', 'senior', 'expert ', 'chef ', 'alternance commerce', 'comptable')):
        return False
    if any(w in t for w in ('employe', 'equipier', 'caisse', 'drive', 'preparateur', 'commande', 'manutention', 'magasinier', 'agent logistique', 'polyvalent')):
        return True
    if 'technicien' in t and any(w in t for w in ('support', 'informat', 'reseau', 'helpdesk', 'service desk', 'proximite', 'supervision')):
        return True
    return any(w in t for w in ('helpdesk', 'service desk', 'alternance system', 'alternance reseau', 'alternant informatique'))


def parse_posting(item, company):
    location = item.get('location') or {}
    parts = item.get('jobAd', {}).get('sections', {})
    description = '\n\n'.join(clean(parts.get(k, {}).get('text', '')) for k in ('companyDescription', 'jobDescription', 'qualifications', 'additionalInformation'))
    employer = item.get('company', {}).get('name') or EMPLOYERS[company]
    city = location.get('city', '')
    address = ', '.join(str(location[k]) for k in ('address', 'postalCode', 'city') if location.get(k))
    source_url = item.get('postingUrl') or f'https://jobs.smartrecruiters.com/{company}/{item["id"]}'
    apply_url = item.get('applyUrl') or source_url
    posting_id = str(item.get('id') or item.get('uuid'))
    result = {
        'offer_id': hashlib.sha256((company + ':' + posting_id).encode()).hexdigest()[:20],
        'posting_id': posting_id, 'provider': 'SmartRecruiters', 'employer_id': company,
        'employer_label': EMPLOYERS[company], 'title': clean(item.get('name', '')),
        'company': clean(employer), 'city': city, 'location': address or city,
        'description': description.strip(), 'source_url': source_url, 'apply_url': apply_url,
        'summary': clean(parts.get('jobDescription', {}).get('text', ''))[:500],
        'posted': str(item.get('releasedDate', ''))[:10], 'checked_at': stamp(),
        'active': item.get('active', True), 'contract': item.get('typeOfEmployment', {}).get('label', ''),
        'experience': item.get('experienceLevel', {}).get('label', ''), 'creator': '',
        'email': '', 'email_source': '',
    }
    author = item.get('creator') or {}
    if author.get('name'):
        result['creator'] = clean(author['name'])
    # Un email n'est proposé que près d'une consigne de candidature, jamais déduit.
    for match in re.finditer(r'[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', description, re.I):
        context = normalized(description[max(0, match.start()-140):match.end()+140])
        if any(w in context for w in ('candidatur', 'postul', 'votre cv', 'ton cv')) and not any(w in context for w in ('rgpd', 'dpo', 'donnees personnelles', 'privacy')):
            result['email'], result['email_source'] = match.group(), source_url
            break
    return result


def cache_path(data):
    return Path(data) / 'offres.json'


def load_feed(data, root):
    paths = [cache_path(data), Path(root) / 'selection_initiale' / 'offres.json']
    warnings = []
    for path in paths:
        if not path.exists():
            continue
        try:
            result = json.loads(path.read_text(encoding='utf-8-sig'))
            if not isinstance(result, dict) or not isinstance(result.get('offers'), list):
                raise ValueError('Format de sélection incorrect')
            result['offers'] = [offer for offer in result['offers'] if isinstance(offer, dict) and
                                all(isinstance(offer.get(k), str) and offer[k].strip() for k in ('offer_id', 'title', 'company', 'source_url'))]
            for offer in result['offers']:
                for key in ('description', 'summary', 'location', 'posted', 'checked_at'):
                    if not isinstance(offer.get(key), str):
                        offer[key] = ''
            result.setdefault('city', 'Lyon')
            result.setdefault('checked_at', '')
            result['sources'] = result.get('sources') if isinstance(result.get('sources'), dict) else {}
            result['errors'] = result.get('errors') if isinstance(result.get('errors'), list) else []
            if path == paths[0] and path == cache_path(data) and not result['offers'] and normalized(result['city']) == 'lyon' and paths[1].exists():
                warnings.append('La recherche enregistrée à Lyon est vide. La sélection fournie est affichée avec sa date de lecture ; utilise Actualiser pour rechercher de nouvelles offres.')
                continue
            result['errors'] = warnings + result['errors']
            result['loaded_from'] = 'saved' if path == paths[0] else 'included'
            return result
        except (ValueError, OSError, TypeError):
            warnings.append('La sélection enregistrée n’a pas pu être lue. Les offres fournies avec cette version sont utilisées ; ton ancien fichier est conservé.')
    return {'offers': [], 'checked_at': '', 'city': 'Lyon', 'sources': {}, 'errors': warnings, 'loaded_from': 'none'}


def refresh(data, root, city='Lyon'):
    city = str(city).strip()[:80]
    if not city:
        raise ValueError('Indique une ville.')
    if not REFRESH_LOCK.acquire(blocking=False):
        return {**load_feed(data, root), 'message': 'Une actualisation est déjà en cours.'}
    try:
        listings, errors, sources = [], [], {}

        def listing(company):
            params = urllib.parse.urlencode({'limit': 100, 'city': city, 'country': 'fr'})
            url = f'https://api.smartrecruiters.com/v1/companies/{company}/postings?{params}'
            body = read_json(url)
            matches = [r for r in body.get('content', []) if relevant(r.get('name', ''))]
            return company, matches, body.get('totalFound', 0)

        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(listing, company): company for company in EMPLOYERS}
            for future in as_completed(futures):
                company = futures[future]
                try:
                    _, matches, total = future.result()
                    sources[company] = {'label': EMPLOYERS[company], 'total': total, 'read_limit': 100}
                    listings.extend((company, row) for row in matches[:20])
                except Exception:
                    errors.append(EMPLOYERS[company] + ' : lecture momentanément indisponible.')
        if not sources:
            return {**load_feed(data, root), 'errors': errors, 'message': 'Connexion aux sources impossible. La dernière sélection est conservée.'}

        listings.sort(key=lambda pair: str(pair[1].get('releasedDate', '')), reverse=True)

        def detail(company, row):
            url = f'https://api.smartrecruiters.com/v1/companies/{company}/postings/{urllib.parse.quote(str(row["id"]), safe="")}'
            result = parse_posting(read_json(url), company)
            if not result['creator'] and (row.get('creator') or {}).get('name'):
                result['creator'] = clean(row['creator']['name'])
            return result if result['active'] else None

        offers = []
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(detail, c, row): c for c, row in listings[:60]}
            for future in as_completed(futures):
                try:
                    item = future.result()
                    if item:
                        offers.append(item)
                except Exception:
                    errors.append('Une annonce n’a pas pu être vérifiée ; elle n’a pas été ajoutée.')
        offers.sort(key=lambda r: r['posted'], reverse=True)
        # Ne pas écraser une sélection valide si tous les détails ont échoué.
        if listings and not offers:
            return {**load_feed(data, root), 'errors': errors, 'message': 'Détails des offres indisponibles. La dernière sélection est conservée.'}
        result = {'offers': offers, 'city': city, 'checked_at': stamp(), 'sources': sources,
                  'errors': list(dict.fromkeys(errors)), 'message': f'{len(offers)} offres lues directement chez les employeurs.'}
        target = cache_path(data)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(target)
        return result
    finally:
        REFRESH_LOCK.release()


def load_contacts(root):
    path = Path(root) / 'selection_initiale' / 'contacts.json'
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding='utf-8'))


def contacts_for_offer(offer, root):
    result = []
    company = offer.get('employer_id', '')
    for contact in load_contacts(root):
        if company and company in contact.get('employer_ids', []):
            result.append(dict(contact))
    author = offer.get('creator', '')
    if author and not any(normalized(c['name']) == normalized(author) for c in result):
        result.insert(0, {'id': hashlib.sha256((author+company).encode()).hexdigest()[:16],
                         'name': author, 'company': offer['company'], 'employer_ids': [company],
                         'role': 'Auteur de cette annonce ; fonction à confirmer', 'profile_url': '',
                         'source_url': offer['source_url'], 'checked_at': offer.get('checked_at', ''),
                         'context': 'Nom publié dans le flux employeur. Le profil LinkedIn exact reste à vérifier.',
                         'confidence': 'author', 'email': ''})
    return result


def linkedin_search(company, name=''):
    return 'https://www.linkedin.com/search/results/people/?' + urllib.parse.urlencode({'keywords': f'{name} {company} recrutement'.strip()})
