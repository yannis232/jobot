"""Adaptation locale, traçable et lisible par extraction de texte. Aucun fait inventé."""
import hashlib
import io
import re
from xml.sax.saxutils import escape
import matching


def fingerprint(api, job):
    doc = matching.documents(api.PROFILES, api.cv_path).get(job['profile'], {})
    return hashlib.sha256((doc.get('fingerprint', '') + job['profile'] + job.get('title', '') + job.get('description', '')).encode()).hexdigest()


def generate(api, job):
    doc = matching.documents(api.PROFILES, api.cv_path).get(job['profile'], {})
    if doc.get('status') != 'read':
        raise ValueError('Ajoute un CV PDF avec du texte sélectionnable pour l’adapter.')
    if not job.get('description', '').strip():
        raise ValueError('Ajoute la description de l’offre pour adapter ce CV.')
    evidence = matching.evidence(doc, job)
    keywords = []
    description = job.get('description', '')
    for row in evidence:
        if row['level'] == 'objective':
            continue
        key = row.get('key') or next((k for k, v in matching.SKILLS.items() if v[0] == row['label']), '')
        match = re.search(matching.SKILLS[key][1], matching.norm(description)) if key else None
        phrase = description[match.start():match.end()] if match else row['label']
        # Une famille de produits ne rend pas ses membres interchangeables :
        # AWS ne prouve pas Azure, React ne prouve pas Angular, AD local ne prouve pas Entra.
        if key in {'ad', 'linux', 'javascript', 'sql', 'cloud', 'server', 'windows'} and matching.norm(phrase) not in matching.norm(doc['text']):
            source_match = re.search(matching.SKILLS[key][1], matching.norm(doc['text']))
            if not source_match:
                continue
            phrase = doc['text'][source_match.start():source_match.end()]
        keywords.append({'word': phrase, 'level': row['level'], 'proof': row.get('source', '') or row.get('line', ''), 'label': row['label']})
    facts = api.load_profile()
    heading = [facts.get('name', ''), ' | '.join(filter(None, (facts.get('contact_email'), facts.get('phone'), facts.get('city')))),
               'Objectif : ' + job['title']]
    if keywords:
        heading += ['COMPÉTENCES EN LIEN AVEC LE POSTE', '\n'.join('- ' + k['word'] + (' (notions)' if k['level'] == 'basic' else '') for k in keywords)]
    # Le parcours complet est conservé : pas de résumé qui efface dates, niveaux ou diplômes.
    text = '\n\n'.join(filter(None, heading + ['PARCOURS ET INFORMATIONS DU CV', doc['text']]))
    rank = matching.rank(job, {job['profile']: doc}, facts)['profiles'][0]
    return {'text': text, 'keywords': keywords, 'missing': rank['missing'], 'fingerprint': fingerprint(api, job),
            'warning': 'Structure simple et mots-clés justifiés par ton CV. Aucun outil ne peut garantir le passage d’un ATS.',
            'provisional': job.get('description_kind') == 'excerpt'}


def valid(api, job):
    return bool(job.get('ats_text', '').strip() and job.get('ats_fingerprint') == fingerprint(api, job))


def render_pdf(api, job):
    if not valid(api, job):
        raise ValueError('L’offre ou le CV a changé. Actualise le CV adapté avant de l’utiliser.')
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    # Enregistre les polices Unicode déjà embarquées, sans nouvelle dépendance.
    api.letters.render_pdf(job, api.load_profile(), 'Préparation du CV')
    out = io.BytesIO()
    document = SimpleDocTemplate(out, pagesize=A4, leftMargin=42, rightMargin=42, topMargin=38, bottomMargin=38,
                                 title='CV - ' + job['title'], author=api.load_profile().get('name', ''))
    style = ParagraphStyle('cv', fontName='JobBotVera', fontSize=10, leading=14, spaceAfter=5)
    story = []
    for line in job['ats_text'].splitlines():
        if line.strip():
            story.append(Paragraph(escape(line.strip()), style))
        else:
            story.append(Spacer(1, 5))
    document.build(story)
    return out.getvalue()


def attachment(api, job):
    if job.get('use_ats'):
        return 'CV_adapte_' + job['id'] + '.pdf', render_pdf(api, job)
    path = api.cv_path(job.get('profile'))
    if not path:
        raise ValueError('Ajoute le CV choisi avant de postuler.')
    return path.name, path.read_bytes()
