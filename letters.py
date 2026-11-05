"""Brouillons factuels et PDF de motivation. Aucun service distant requis."""
import io
import re
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape


def lines(value):
    return [str(s).strip() for s in (value if isinstance(value, list) else str(value or '').splitlines()) if str(s).strip()]


def draft_letter(job, profile, cv_evidence=None):
    title, company = job.get('title', 'ce poste'), job.get('company', 'votre entreprise')
    pitch = profile.get('profile_pitch', {}).get(job.get('profile'), '')
    if not pitch:
        experiences = lines(profile.get('experience'))
        pitch = ' '.join(experiences[:2]) or 'Je souhaite vous présenter ma candidature et échanger avec vous sur les besoins de ce poste.'
    text = (job.get('description') or '').lower()
    topics = [('accueil', 'l’accueil et la relation avec les clients'), ('caisse', 'la tenue de caisse'),
              ('commande', 'la préparation des commandes'), ('stock', 'le suivi des stocks'),
              ('support', 'l’assistance aux utilisateurs'), ('maintenance', 'la maintenance des postes'),
              ('réseau', 'le fonctionnement des réseaux'), ('reseau', 'le fonctionnement des réseaux'),
              ('sécurité', 'le respect des consignes de sécurité'), ('équipe', 'le travail en équipe')]
    selected = list(dict.fromkeys(label for key, label in topics if key in text))[:3]
    motivation = ('Votre annonce met notamment en avant ' + ', '.join(selected) + '. Ces missions motivent ma démarche : je souhaite comprendre vos méthodes et contribuer au travail de votre équipe.') if selected else 'Les missions décrites dans votre annonce retiennent mon attention. Je souhaite mieux comprendre vos attentes et vous présenter la manière dont mon parcours peut répondre aux besoins du poste.'
    skills = lines(profile.get('skills'))
    if cv_evidence is not None:
        matched = [row['label'] + (' (notions)' if row['level'] == 'basic' else '') for row in cv_evidence if row['level'] != 'objective'][:4]
    else:
        matched = [s for s in skills if any(w in text for w in re.findall(r'[\wÀ-ÿ]{4,}', s.lower()))][:3]
    match_text = ('Les compétences que je peux mettre en avant sont : ' + ', '.join(matched) + '.') if matched else ''
    paragraphs = ['Madame, Monsieur,', f'Je vous propose ma candidature au poste de {title} au sein de {company}.',
                  motivation, pitch, match_text, profile.get('mobility', ''),
                  'Je joins mon CV à cette candidature et reste disponible pour un entretien afin de vous présenter mon parcours et ma motivation.',
                  'Je vous remercie de l’attention portée à ma candidature.\n\nCordialement,', profile.get('name', '')]
    return '\n\n'.join(p.strip() for p in paragraphs if p and p.strip())


def filename(job):
    base = re.sub(r'[^\wÀ-ÿ .-]+', '', 'Lettre de motivation - ' + job.get('company', 'candidature'))[:90].strip()
    return base + '.pdf'


def render_pdf(job, profile, text):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
    import reportlab
    if not str(text).strip():
        raise ValueError('Crée ou saisis d’abord ta lettre de motivation.')
    fonts = Path(reportlab.__file__).parent / 'fonts'
    if 'JobBotVera' not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont('JobBotVera', str(fonts / 'Vera.ttf')))
        pdfmetrics.registerFont(TTFont('JobBotVeraBold', str(fonts / 'VeraBd.ttf')))
    out = io.BytesIO()
    document = SimpleDocTemplate(out, pagesize=A4, rightMargin=52, leftMargin=52, topMargin=42, bottomMargin=45,
                                 title='Candidature - ' + job.get('title', ''), author=profile.get('name', ''))
    body = ParagraphStyle('body', fontName='JobBotVera', fontSize=10.2, leading=15.5, spaceAfter=11, textColor=colors.HexColor('#22243a'), alignment=TA_LEFT)
    name = ParagraphStyle('name', parent=body, fontName='JobBotVeraBold', fontSize=22, leading=27, textColor=colors.HexColor('#5335a5'))
    small = ParagraphStyle('small', parent=body, fontSize=9, leading=14, textColor=colors.HexColor('#575c78'))
    subject = ParagraphStyle('subject', parent=body, fontName='JobBotVeraBold', fontSize=11, leading=16, spaceAfter=17)
    story = [Paragraph(escape(profile.get('name', '') or 'Candidature'), name)]
    details = ' · '.join(s for s in [profile.get('phone', ''), profile.get('contact_email', '')] if s)
    if details:
        story.append(Paragraph(escape(details), small))
    story += [HRFlowable(width='100%', thickness=1.4, color=colors.HexColor('#7567db')), Spacer(1, 19),
              Paragraph(escape(job.get('company', '')), subject),
              Paragraph('Le ' + date.today().strftime('%d/%m/%Y'), small),
              Paragraph(escape('Objet : candidature - ' + job.get('title', '')), subject)]
    # Les retours à la ligne du texte relu restent présents ; le contenu n'est
    # jamais interprété comme une instruction ou du HTML fourni par une offre.
    for paragraph in str(text).replace('\r\n', '\n').split('\n\n'):
        if paragraph.strip():
            story.append(Paragraph(escape(paragraph.strip()).replace('\n', '<br/>'), body))
    document.build(story)
    return out.getvalue()
