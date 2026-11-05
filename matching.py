"""Comparaison locale explicable des annonces avec le contenu réel des CV PDF."""
from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter
from functools import lru_cache
from pathlib import Path


def norm(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(value or '').lower()) if not unicodedata.combining(c))


STOP = set('avec pour dans vous nous votre notre une des les aux sur ses ces mes mon sont est etre plus tout tous cette poste offre emploi missions profil recherche entreprise experience formation competences savoir faire travail lyon france candidat candidature contrat disponibilite ans mois an obtenu non cours notion notions'.split())
SKILLS = {
    'support': ('Assistance utilisateurs', r'\b(?:support(?: informatique)?|help\s?desk|service desk|assistance (?:aux )?utilisateurs?|assistance technique)\b', 3),
    'windows': ('Windows', r'\bwindows(?:\s*(?:10|11))?\b', 3),
    'ad': ('Active Directory', r'\bactive directory\b|\b(?:azure|entra)\s*(?:ad|id)\b', 4),
    'server': ('Windows Server', r'\bwindows server\b', 4),
    'network': ('Diagnostic et réseaux informatiques', r'\b(?:reseaux? informatiques?|pannes? reseaux?|incidents? reseaux?)\b', 2),
    'tcpip': ('TCP/IP', r'\btcp\s*/?\s*ip\b', 3), 'dhcp': ('DHCP', r'\bdhcp\b', 3), 'dns': ('DNS', r'\bdns\b', 3),
    'maintenance': ('Maintenance des postes', r'\b(?:maintenance (?:et (?:depannage|reparation) )?(?:des? |de )?(?:postes?|pc|informatique)|depannage (?:des? |de )?(?:postes?|pc|informatique)|reparation de postes|montage (?:et maintenance )?pc)\b', 3),
    'installation': ('Installation et configuration de postes', r'\b(?:installation|configuration|deploiement)\b.{0,45}\b(?:postes?|ordinateurs?|logiciels?|pc)\b', 2),
    'incidents': ('Diagnostic et résolution d’incidents', r'\b(?:diagnostic|resolution (?:d.incidents?|de pannes?)|gestion des incidents|ticketing|tickets?)\b', 2),
    'linux': ('Linux', r'\b(?:linux|ubuntu|debian|redhat|centos)\b', 4),
    'python': ('Python', r'\bpython\b', 5), 'java': ('Java', r'\bjava\b(?!script)', 5),
    'javascript': ('JavaScript / TypeScript', r'\b(?:javascript|typescript|react|node\.?js|angular)\b', 5),
    'sql': ('SQL', r'\b(?:sql|postgresql|mysql|sql server)\b', 4),
    'cloud': ('Cloud AWS / Azure', r'\b(?:aws|amazon web services|azure)\b', 4),
    'security': ('Cybersécurité', r'\b(?:cybersecurite|securite informatique|securite des systemes)\b', 3),
    'customer': ('Service et relation client', r'\b(?:sens du service|relation clients?|service clients?|contact (?:avec )?(?:le )?public|accueil(?: des clients?)?)\b', 2),
    'retail': ('Distribution et polyvalence', r'\b(?:leclerc|distribution|employe polyvalent|libre.service|mise en rayon|reassort)\b', 2),
    'cash': ('Tenue de caisse', r'\b(?:caisse|encaissement)\b', 3),
    'orders': ('Préparation de commandes', r'\bprepara(?:tion|teur|trice)\s+(?:de\s+)?commandes?\b|\bpicking\b', 3),
    'stock': ('Gestion des stocks', r'\b(?:stocks?|inventaires?|reception de marchandises|magasinier)\b', 2),
    'team': ('Travail en équipe', r'\b(?:travail(?:ler)? en equipe|esprit d.equipe|coordination|collaboration)\b', 1),
    'rigor': ('Rigueur et organisation', r'\b(?:rigueur|rigoureux|organise|organisation|autonomie)\b', 1),
    'english': ('Anglais', r'\b(?:anglais|english)\b', 2),
}
DOMAINS = {
    'informatique': r'informat|help.?desk|support (?:it|windows)|technicien(?:ne)? support|service desk|systemes?|reseaux?',
    'commandes': r'commandes?|logisti|magasinier|manutention|entrepot|picking|drive',
    'polyvalent': r'polyvalent|libre.service|rayon|distribution|vendeu|commerce|accueil|caisse|equipier',
    'developpement': r'developpeu|ingenieur logiciel|software|full.?stack|data scientist',
}


def clean_pdf_text(text):
    """Les CV avec espacement typographique doivent rester comparables."""
    lines = []
    for line in str(text or '').replace('\x7f', ' ').splitlines():
        tokens = line.split()
        if len(tokens) >= 6 and sum(len(t) == 1 for t in tokens) / len(tokens) > .75:
            line = ' '.join(''.join(part.split()) for part in re.split(r' {2,}', line.strip()))
        line = re.sub(r'[ \t]+', ' ', line).strip()
        if line:
            lines.append(line)
    return '\n'.join(lines)


@lru_cache(maxsize=32)
def _read_pdf(path, modified, size):
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        text = clean_pdf_text('\n'.join(page.extract_text() or '' for page in reader.pages[:10]))[:45000]
        if len(re.findall(r'\w{3,}', text)) < 18:
            return {'text': '', 'status': 'unreadable', 'warning': 'Ce PDF ne contient pas assez de texte lisible. Ajoute une version avec du texte sélectionnable.'}
        return {'text': text, 'status': 'read', 'warning': '', 'fingerprint': hashlib.sha256(Path(path).read_bytes()).hexdigest()[:16]}
    except Exception:
        return {'text': '', 'status': 'unreadable', 'warning': 'Le texte de ce CV ne peut pas être extrait. Le fichier original est conservé.'}


def concepts(text):
    value = norm(text)
    return {key for key, (_, pattern, _) in SKILLS.items() if re.search(pattern, value)}


def documents(profiles, path_for):
    result = {}
    for key, profile in profiles.items():
        path = path_for(key)
        if path:
            try:
                stat = path.stat()
                item = dict(_read_pdf(str(path.resolve()), stat.st_mtime_ns, stat.st_size))
            except OSError:
                item = {'text': '', 'status': 'unreadable', 'warning': 'Ce CV n’est plus accessible. Ajoute à nouveau le PDF.'}
        else:
            item = {'text': '', 'status': 'missing', 'warning': 'Ajoute ce CV PDF pour le comparer aux offres.'}
        item.update(id=key, label=profile.get('label', key), cv=profile.get('cv', ''))
        item['skills'] = sorted(concepts(item['text']))
        item['word_count'] = len(item['text'].split())
        result[key] = item
    return result


def tokens(text):
    return Counter(w for w in re.findall(r'[a-z][a-z0-9]{2,}', norm(text)) if w not in STOP)


def cosine(a, b):
    if not a or not b:
        return 0
    return sum(min(n, 3) * min(b.get(w, 0), 3) for w, n in a.items()) / math.sqrt(sum(min(n, 3) ** 2 for n in a.values()) * sum(min(n, 3) ** 2 for n in b.values()))


def evidence(document, offer):
    needed = concepts(offer.get('title', '') + ' ' + offer.get('description', ''))
    found = needed & set(document.get('skills', []))
    rows = []
    for key in sorted(found, key=lambda k: -SKILLS[k][2]):
        label, pattern, _ = SKILLS[key]
        line = next((s for s in document['text'].splitlines() if re.search(pattern, norm(s))), '')
        basic = bool(re.search(r'notions?|bases?|debut', norm(line)))
        # Un objectif de carrière ne constitue pas une expérience acquise.
        aspirational = key == 'orders' and bool(re.search(r'(?:souhaite|desire).{0,30}debuter|debuter dans (?:la )?preparation', norm(document['text']), re.S))
        rows.append({'key': key, 'label': label, 'source': line[:240], 'level': 'objective' if aspirational else 'basic' if basic else 'declared'})
    return rows


def compare(offer, document, facts=None):
    facts = facts or {}
    base = {'profile': document['id'], 'label': document['label'], 'cv': document['cv'], 'status': document['status'], 'score': None,
            'matched': [], 'missing': [], 'cautions': [], 'evidence': [], 'coverage': 'full' if offer.get('description_kind') == 'full' else 'excerpt', 'fingerprint': document.get('fingerprint', '')}
    if document['status'] != 'read':
        base['cautions'] = [document['warning']]
        return base
    title = norm(offer.get('title', ''))
    text = norm(offer.get('title', '') + ' ' + offer.get('description', '') + ' ' + offer.get('summary', ''))
    cv = norm(document['text'])
    required = concepts(text)
    proofs = evidence(document, offer)
    actual = {row['key'] for row in proofs if row['level'] != 'objective'}
    base['evidence'] = proofs
    base['matched'] = [row['label'] + (' (notions)' if row['level'] == 'basic' else '') for row in proofs if row['level'] != 'objective']
    base['missing'] = [SKILLS[key][0] for key in sorted(required - actual, key=lambda k: -SKILLS[k][2])]
    coverage = sum(SKILLS[key][2] for key in actual) / max(1, sum(SKILLS[key][2] for key in required))
    domain = next((key for key, pattern in DOMAINS.items() if re.search(pattern, title)), '')
    alternate = bool(re.search(r'alternance|apprenti', title))
    focus = 'alternance' if alternate and domain == 'informatique' else domain
    focus_score = 28 if focus == document['id'] else 15 if domain and re.search(DOMAINS.get(domain, r'(?!)'), cv) else 3
    if alternate and document['id'] == 'informatique':
        focus_score = 18
    lexical = min(17, round(cosine(tokens(offer.get('title', '') + ' ' + offer.get('description', '')), tokens(document['text'])) * 40))
    score = 5 + focus_score + (round(45 * coverage) if required else 8) + lexical
    if re.search(r'debutants? accept|sans experience|formation assuree|junior', text):
        score += 5
    limits = norm(str(facts.get('constraints', '')))
    no_license = bool(re.search(r'sans permis|pas de permis|permis b.{0,15}en cours', limits + ' ' + cv))
    required_license = bool(re.search(r'permis\s*b\s*(?:est\s*)?(?:exige|obligatoire|indispensable|requis)|(?:titulaire|possession)\s+(?:du\s+)?permis\s*b', text))
    if no_license and required_license:
        base['cautions'].append('Permis B exigé alors que ton profil indique sans permis ou permis en cours.')
        score = min(score - 22, 42)
    caces_required = bool(re.search(r'caces.{0,35}(?:exige|obligatoire|indispensable|requis)', text))
    caces_held = bool(re.search(r'(?:titulaire|certifi|obtenu).{0,35}caces|caces.{0,25}(?:obtenu|valide)', cv)) and not re.search(r'pas de caces|sans caces', limits)
    if caces_required and not caces_held:
        base['cautions'].append('CACES exigé, aucune certification obtenue identifiée dans ce CV.')
        score = min(score - 20, 45)
    years = re.search(r'(\d{1,2})\s*(?:a\s*\d{1,2}\s*)?ans?\s*(?:d.experience|minimum|min\b|exige|requis)', text)
    if years and int(years[1]) >= 2 and not re.search(r'\d+\s*ans? d.experience', cv):
        base['cautions'].append(f'{years[1]} ans d’expérience demandés ; cette durée n’est pas établie dans le CV.')
        score -= min(18, int(years[1]) * 4)
    if re.search(r'(?:bac\s*\+\s*[2-5]|bts|diplome).{0,65}(?:exige|requis|obligatoire)', text) and re.search(r'(?:diplome )?non obtenu', cv):
        base['cautions'].append('Un diplôme est exigé ; le BTS est indiqué non obtenu dans ton CV. Vérifie les équivalences acceptées.')
        score -= 12
    if re.search(r'\b(?:senior|directeur|directrice|expert)\b', title) and 'stage' in cv and not re.search(r'\bsenior\b|\d+\s*ans? d.experience', cv):
        score -= 15
        base['cautions'].append('Niveau confirmé ou expert demandé ; expérience à vérifier.')
    base['order_score'] = max(0, min(100, round(score)))
    if base['coverage'] != 'full':
        score = min(score, 74)
        base['cautions'].append('Correspondance provisoire : seule une partie de l’annonce est disponible.')
    base['score'] = max(0, min(100, round(score)))
    base['explanation'] = (', '.join(base['matched'][:4]) or 'Peu de compétences explicites communes dans le texte lu.')
    return base


def rank(offer, docs, facts=None):
    rows = [compare(offer, doc, facts) for doc in docs.values()]
    rows.sort(key=lambda row: (row['score'] if row['score'] is not None else -1, row.get('order_score', -1)), reverse=True)
    best = rows[0] if rows else {'profile': 'polyvalent', 'score': None, 'status': 'missing', 'label': 'Aucun CV'}
    return {'best_profile': best['profile'], 'score': best['score'], 'order_score': best.get('order_score', -1), 'label': best['label'], 'status': best['status'],
            'matched': best.get('matched', []), 'missing': best.get('missing', []), 'cautions': best.get('cautions', []),
            'profiles': rows, 'method': 'Comparaison locale du texte des CV et des exigences de l’offre ; indice indicatif, pas une probabilité d’embauche.'}
