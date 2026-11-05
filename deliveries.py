"""Envois unitaires par le navigateur connecté, avec préparation et confirmation séparées."""
import base64
import hashlib
import json
import secrets
import threading
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
import ats
import boards

LOCK = threading.RLock()
ACTIVE = {'queued', 'preparing', 'ready', 'sending', 'uncertain', 'needs_user'}


def _schema(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, data TEXT NOT NULL)')


def save(api, task):
    task['updated'] = api.now()
    with api.db() as conn:
        _schema(conn)
        conn.execute('INSERT INTO deliveries(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (task['id'], json.dumps(task, ensure_ascii=False)))
    return public(task)


def get(api, identifier):
    with api.db() as conn:
        _schema(conn)
        row = conn.execute('SELECT data FROM deliveries WHERE id=?', (str(identifier),)).fetchone()
    if not row:
        raise ValueError('Cet envoi est introuvable.')
    return json.loads(row['data'])


def listing(api):
    with api.db() as conn:
        _schema(conn)
        return [public(json.loads(row['data'])) for row in conn.execute('SELECT data FROM deliveries ORDER BY rowid DESC LIMIT 30')]


def public(task):
    return {k: v for k, v in task.items() if k not in ('attachments', 'nonce', 'snapshot')}


def _existing(api, kind, target):
    with api.db() as conn:
        _schema(conn)
        tasks = (json.loads(row['data']) for row in conn.execute('SELECT data FROM deliveries ORDER BY rowid DESC'))
        return next((public(t) for t in tasks if t['kind'] == kind and t['target_id'] == target and t['status'] in ACTIVE), None)


def snapshot(api, job):
    selected = api.cv_path(job.get('profile'))
    keys = ('email', 'email_source', 'subject', 'body', 'profile', 'include_letter', 'letter_text', 'source_url', 'apply_url', 'ats_text', 'use_ats', 'ats_fingerprint', 'draft_kind', 'last_sent_at')
    values = {k: job.get(k) for k in keys}
    values['cv_hash'] = hashlib.sha256(selected.read_bytes()).hexdigest() if selected else ''
    values['sender'] = api.mail_settings()['address']
    values['personal'] = api.load_profile()
    return hashlib.sha256(json.dumps(values, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def prepare_email(api, identifier, followup=False):
    with LOCK:
        job = api.get_job(identifier)
        if (job.get('sent_at') and not followup) or job.get('delivery_uncertain') or job.get('status') == 'envoi_incertain':
            raise ValueError('Cette candidature est envoyée ou son envoi est incertain. Vérifie le suivi et ta messagerie.')
        old = _existing(api, 'email', identifier)
        if old:
            return old
        cfg = api.mail_settings()
        if not api.valid_email(cfg['address']):
            raise ValueError('Enregistre ton adresse Yahoo ou Gmail dans Démarrage > Messagerie.')
        address = job.get('email', '')
        if not api.valid_email(address) or not job.get('email_source') or any(t in address.split('@')[0].lower() for t in ('noreply', 'no-reply', 'donotreply')):
            raise ValueError('Il faut une adresse de candidature publiée et sa page source. Sans adresse, utilise le formulaire de l’annonce.')
        if job.get('form_mandatory') and not followup:
            raise ValueError('Cette offre impose un formulaire employeur. Le dossier et les PDF restent disponibles ici.')
        if not followup and job.get('include_letter') and job.get('letter_stale'):
            raise ValueError('Le CV choisi a changé. Actualise ou adapte la lettre avant de la joindre.')
        if not job.get('subject', '').strip() or not job.get('body', '').strip():
            raise ValueError('Prépare et relis le message de candidature.')
        attachments = []
        if not followup:
            name, content = ats.attachment(api, job)
            attachments.append({'name': name, 'content': base64.b64encode(content).decode(), 'type': 'application/pdf'})
        if not followup and job.get('include_letter'):
            content = api.letters.render_pdf(job, api.load_profile(), job.get('letter_text', ''))
            attachments.append({'name': api.letters.filename(job), 'content': base64.b64encode(content).decode(), 'type': 'application/pdf'})
        task = {'id': secrets.token_hex(16), 'nonce': secrets.token_urlsafe(24), 'kind': 'email', 'provider': cfg['provider'],
                'target_id': identifier, 'recipient': address, 'sender': cfg['address'], 'company': job['company'],
                'subject': job['subject'], 'body': job['body'], 'attachments': attachments, 'files': [a['name'] for a in attachments],
                'status': 'queued', 'message': 'Ouverture et préparation de la messagerie connectée…', 'created': api.now(), 'snapshot': snapshot(api, job), 'followup': followup}
        task['url'] = ('https://mail.yahoo.com/d/compose?' + urlencode({'to': address, 'subject': job['subject']})) if cfg['provider'] == 'yahoo' else 'https://mail.google.com/mail/u/0/?view=cm&fs=1&' + urlencode({'to': address, 'su': job['subject']})
        return save(api, task)


def prepare_followup(api, identifier):
    with LOCK:
        job = api.get_job(identifier)
        if job['status'] != 'envoyee' or not job.get('sent_at') or job.get('delivery_uncertain'):
            raise ValueError('Seules les candidatures envoyées sans réponse peuvent être relancées.')
        if not job.get('next_followup') or job['next_followup'] > api.now():
            raise ValueError('La date de relance n’est pas encore atteinte.')
        old = _existing(api, 'email', identifier)
        if old:
            return old
        job.update(api.draft(job, followup=True), draft_kind='followup')
        api.update_internal(job)
        return prepare_email(api, identifier, followup=True)


def prepare_application(api, identifier, express=False):
    with LOCK:
        job = api.get_job(identifier)
        if job.get('sent_at') or job.get('delivery_uncertain') or job['status'] == 'envoi_incertain':
            raise ValueError('Cette candidature est déjà envoyée ou reste à vérifier.')
        for kind in ('email', 'application'):
            existing = _existing(api, kind, identifier)
            if existing:
                return existing
        if not job.get('letter_text') or job.get('letter_stale'):
            job.update(letter_text=api.letters.draft_letter(job, api.load_profile(), api.cv_evidence(job)), include_letter=True,
                       letter_stale=False, letter_cv_fingerprint=api.matching.documents(api.PROFILES, api.cv_path)[job['profile']].get('fingerprint', ''))
        if not job.get('body') or job.get('draft_kind') == 'followup':
            job.update(api.draft(job), draft_kind='application')
        api.update_internal(job)
        if api.valid_email(job.get('email', '')) and job.get('email_source') and not job.get('form_mandatory'):
            result = prepare_email(api, identifier)
            task = get(api, result['id'])
        else:
            # Autorisation limitée au domaine et à l'annonce demandés ; redirection externe à traiter manuellement.
            source = job.get('source_id') or next((s for s in boards.SITES if _belongs(s, job.get('source_url', ''))), '')
            if not source:
                raise ValueError('Formulaire externe : ouvre l’annonce depuis la fiche. Le remplissage automatique est disponible sur les huit sites connectés.')
            url = boards.canonical_job(source, job.get('source_url', ''))
            facts = api.load_profile()
            if not facts.get('first_name') or not facts.get('last_name') or not api.valid_email(facts.get('contact_email', '')):
                raise ValueError('Complète une seule fois ton prénom, ton nom et ton email dans Mes CV et mon profil > Candidature express.')
            name, content = ats.attachment(api, job)
            attachments = [{'name': name, 'content': base64.b64encode(content).decode(), 'type': 'application/pdf'}]
            if job.get('include_letter'):
                attachments.append({'name': api.letters.filename(job), 'content': base64.b64encode(api.letters.render_pdf(job, facts, job['letter_text'])).decode(), 'type': 'application/pdf'})
            task = {'id': secrets.token_hex(16), 'nonce': secrets.token_urlsafe(24), 'kind': 'application', 'provider': source,
                    'target_id': identifier, 'recipient': job['title'], 'company': job['company'], 'subject': job['title'], 'body': job['letter_text'],
                    'url': url, 'attachments': attachments, 'files': [a['name'] for a in attachments],
                    'fields': {k: facts.get(k, '') for k in ('first_name', 'last_name', 'contact_email', 'phone', 'city', 'address', 'postcode', 'availability')},
                    'status': 'queued', 'message': 'Ouverture et remplissage du formulaire compatible…', 'created': api.now(), 'snapshot': snapshot(api, job)}
        task['express'] = bool(express and api.config(public=True).get('express_apply'))
        return save(api, task)


def _belongs(source, url):
    try:
        boards.canonical_job(source, url)
        return True
    except ValueError:
        return False


def prepare_linkedin(api, identifier, job_id=''):
    with LOCK:
        person = next((c for c in api.all_contacts() if c['id'] == identifier), None)
        if not person or not api.enrichment.valid_profile(person.get('profile_url', '')):
            raise ValueError('Indique le profil LinkedIn exact de la personne avant de préparer un envoi.')
        if not person.get('body', '').strip():
            raise ValueError('Rédige et enregistre d’abord ton message au contact.')
        if person.get('status') == 'sent':
            raise ValueError('Un message est déjà enregistré comme envoyé à ce contact. Consulte ton historique LinkedIn.')
        if job_id:
            job = api.get_job(job_id)
            if api.normalize(job['company']) != api.normalize(person['company']) or (person.get('offer_id') and job.get('offer_id') != person['offer_id']):
                raise ValueError('Ce contact n’est pas rattaché à cette entreprise ou à cette offre.')
        old = _existing(api, 'linkedin', identifier)
        if old:
            return old
        return save(api, {'id': secrets.token_hex(16), 'nonce': secrets.token_urlsafe(24), 'kind': 'linkedin', 'provider': 'linkedin',
                          'target_id': identifier, 'job_id': job_id, 'recipient': person['name'], 'company': person['company'],
                          'body': person['body'][:8000], 'url': person['profile_url'], 'files': [], 'attachments': [],
                          'status': 'queued', 'message': 'Ouverture du profil et vérification du bouton Message…', 'created': api.now()})


def confirm(api, identifier):
    with LOCK, api.SEND_LOCK:
        task = get(api, identifier)
        if task['status'] != 'ready':
            raise ValueError('Attends que le destinataire, le texte et les pièces jointes soient vérifiés dans le navigateur.')
        if datetime.now(timezone.utc) - datetime.fromisoformat(task['updated']) > timedelta(minutes=10):
            raise ValueError('L’aperçu a expiré. Annule cette préparation puis prépare à nouveau le message.')
        if task['kind'] in ('email', 'application'):
            job = api.get_job(task['target_id'])
            if (job.get('sent_at') and not task.get('followup')) or job.get('delivery_uncertain') or snapshot(api, job) != task['snapshot']:
                raise ValueError('Le dossier a changé ou un envoi est déjà enregistré. Prépare un nouvel aperçu.')
            if task.get('followup') and job['status'] != 'envoyee':
                raise ValueError('Une réponse a été enregistrée. Cette relance est annulée.')
            job.update(status='envoi_incertain', delivery_uncertain=True)
            api.update_internal(job)
        else:
            person = next((c for c in api.all_contacts() if c['id'] == task['target_id']), {})
            if person.get('body') != task['body'] or person.get('profile_url') != task['url'] or person.get('status') == 'sent':
                raise ValueError('Le contact ou le message a changé. Prépare un nouvel aperçu.')
        task.update(status='sending', message='Envoi demandé une seule fois. Attente de confirmation du site…')
        save(api, task)
        return {'id': task['id'], 'nonce': task['nonce']}


def receive(api, payload):
    with LOCK, api.SEND_LOCK:
        task = get(api, payload.get('id'))
        if not secrets.compare_digest(str(payload.get('nonce', '')), task['nonce']):
            raise ValueError('Retour de navigateur non reconnu.')
        state = payload.get('status')
        if task['status'] == 'sent':
            return public(task)
        if state in ('preparing', 'ready', 'needs_user') and task['status'] not in ('queued', 'preparing', 'needs_user', 'ready'):
            raise ValueError('Cet envoi ne peut pas revenir à la préparation.')
        if state in ('sent', 'uncertain', 'not_clicked') and task['status'] not in ('sending', 'uncertain'):
            raise ValueError('Aucun envoi n’a été confirmé pour cette préparation.')
        if state not in ('preparing', 'ready', 'needs_user', 'sent', 'uncertain', 'not_clicked'):
            raise ValueError('État d’envoi incorrect.')
        if state == 'ready' and payload.get('verified') is not True:
            raise ValueError('Le navigateur doit vérifier le destinataire et le dossier.')
        if task['kind'] in ('email', 'application') and state in ('sent', 'not_clicked'):
            job = api.get_job(task['target_id'])
            if state == 'sent':
                previous_cv, previous_files = job.get('sent_cv', ''), job.get('sent_files', [])
                status = job['status'] if job['status'] in ('reponse', 'entretien', 'refus', 'archivee') else 'envoyee'
                job.update(status=status, delivery_uncertain=False, sent_at=job.get('sent_at') or api.now(),
                           last_sent_at=api.now(), draft_kind='application', delivery_method='browser',
                           sent_cv=task['files'][0] if task['files'] else '', sent_files=list(task['files']),
                           next_followup=(datetime.now(timezone.utc) + timedelta(days=api.config()['reminder_days'])).isoformat(timespec='seconds'))
                if task.get('followup'):
                    job.update(sent_cv=previous_cv, sent_files=previous_files)
                    job['followup_count'] = job.get('followup_count', 0) + 1
                    job['last_followup_at'] = api.now()
                api.event(('Relance' if task.get('followup') else 'Candidature') + ' envoyée depuis JobBot via ' + task['provider'] + ' : ' + job['company'])
            else:
                job.update(status='envoyee' if job.get('sent_at') else 'preparee', delivery_uncertain=False)
            api.update_internal(job)
        if task['kind'] == 'linkedin' and state == 'sent':
            api.save_contact({'id': task['target_id'], 'status': 'sent', 'body': task['body']})
            api.event('Message LinkedIn envoyé à ' + task['recipient'] + ' · ' + task['company'])
        task.update(status='ready' if state == 'not_clicked' else state, message=str(payload.get('message', ''))[:700])
        if state == 'sent':
            task['attachments'] = []
        return save(api, task)


def cancel(api, identifier):
    with LOCK:
        task = get(api, identifier)
        if task['status'] in ('sending', 'sent', 'uncertain'):
            raise ValueError('Cet envoi a déjà été demandé. Vérifie son résultat dans le site avant toute autre action.')
        task.update(status='cancelled', message='Préparation annulée. Aucun envoi demandé.')
        task['attachments'] = []
        return save(api, task)
