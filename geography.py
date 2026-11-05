"""Positions de communes publiques, jamais de position employeur devinée."""
import concurrent.futures
import json
import math
import re
import threading
import urllib.parse
import urllib.request
from pathlib import Path
from sourcing import normalized

LOCK = threading.RLock()


def towns(query):
    query = str(query).strip()[:100]
    if len(query) < 2:
        raise ValueError('Indique une commune ou un code postal français.')
    params = {'fields': 'code,nom,centre,codesPostaux,population,departement', 'boost': 'population', 'limit': 8}
    params['codePostal' if re.fullmatch(r'\d{5}', query) else 'nom'] = query
    req = urllib.request.Request('https://geo.api.gouv.fr/communes?' + urllib.parse.urlencode(params), headers={'User-Agent': 'JobBot/8.0 (application locale)'})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            rows = json.loads(response.read(200000))
        return [{'code': t['code'], 'name': t['nom'], 'department': t.get('departement', {}).get('nom', ''),
                 'postcodes': t.get('codesPostaux', []), 'lon': t['centre']['coordinates'][0], 'lat': t['centre']['coordinates'][1]}
                for t in rows if t.get('centre', {}).get('coordinates')]
    except (OSError, ValueError, KeyError, TypeError):
        raise ValueError('Le service des communes ne répond pas. Réessaie ; les offres restent accessibles en liste.') from None


def city_query(location):
    s = re.sub(r'^\s*\d{2,3}\s*[-–]\s*', '', location)
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'\b\d{5}\b', '', s)
    s = re.sub(r'\b\d+(?:e|er|eme|ème)?\s*(?:arrondissement)?\b', '', s, flags=re.I)
    return re.split(r'[,/]', s)[0].strip(' -')


def distance(a, b):
    la, lb = math.radians(a['lat']), math.radians(b['lat'])
    x = math.sin((lb-la)/2)**2 + math.cos(la)*math.cos(lb)*math.sin(math.radians(b['lon']-a['lon'])/2)**2
    return 6371 * 2 * math.asin(min(1, math.sqrt(x)))


def offers(api, payload):
    options = towns(payload.get('city', ''))
    center = next((t for t in options if t['code'] == payload.get('code')), None)
    if center is None:
        exact = [t for t in options if normalized(t['name']) == normalized(payload.get('city', ''))]
        if len(exact) != 1:
            return {'choose': options, 'offers': [], 'message': 'Choisis la commune exacte pour afficher sa carte.'}
        center = exact[0]
    radius = max(1, min(200, float(payload.get('radius', 25))))
    feed = api.get_feed()
    path = Path(api.DATA) / 'communes_carte.json'
    with LOCK:
        try:
            cache = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            cache = {}
    cache[normalized(center['name'])] = center
    rows = feed.get('offers', [])
    queries = {city_query(o.get('location', '')) for o in rows}
    queries = [q for q in queries if q and normalized(q) not in cache][:24]
    def resolve(q):
        try:
            choices = towns(q)
            exact = [t for t in choices if normalized(t['name']) == normalized(q)]
            return normalized(q), exact[0] if len(exact) == 1 else None
        except ValueError:
            return normalized(q), None
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        resolved = dict(pool.map(resolve, queries))
    cache.update({k: v for k, v in resolved.items() if v})
    with LOCK:
        api.write_json(path, cache)
    result, unlocated = [], 0
    for offer in rows:
        town = cache.get(normalized(city_query(offer.get('location', ''))))
        if not town:
            unlocated += 1
            continue
        km = distance(center, town)
        if km <= radius:
            result.append({**offer, 'geo': {**town, 'distance': round(km, 1), 'precision': 'centre de commune'}})
    return {'center': center, 'radius': radius, 'offers': result, 'unlocated': unlocated,
            'search_city': feed.get('city', ''), 'message': 'Les points représentent les communes, pas l’adresse exacte des entreprises.'}
