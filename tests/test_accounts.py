"""Inscription, récupération et isolement réel des données entre comptes."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import tempfile
import time
import unittest
from urllib.parse import urlencode
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
import deliveries
from cloud import Cloud
from reportlab.pdfgen import canvas

PASSWORD = 'Phrase de TEST fictive pour les comptes'


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous = app.DATA
        self.profiles = {k: dict(v) for k, v in app.PROFILES.items()}
        app.DATA = Path(self.tmp.name)
        self.env = {'JOBBOT_PUBLIC_ORIGIN': 'https://comptes.example', 'JOBBOT_OWNER_USERNAME': 'jobbot', 'JOBBOT_OWNER_PASSWORD': PASSWORD, 'JOBBOT_SESSION_SECRET': 'q' * 48}
        self.site = Cloud(self.env)

    def tearDown(self):
        for name in list(sys.modules):
            if name.startswith('_jobbot_tenant_') and str(id(self.site.tenants)) in name:
                sys.modules.pop(name, None)
        app.DATA = self.previous
        app.PROFILES.clear(); app.PROFILES.update(self.profiles)
        self.tmp.cleanup()

    def call(self, path, *, data=None, cookie='', token='', origin=True, ip='127.0.0.1'):
        body = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else b''
        route, _, query = path.partition('?')
        env = {'REQUEST_METHOD': 'POST' if data is not None else 'GET', 'PATH_INFO': route, 'QUERY_STRING': query, 'HTTP_HOST': self.site.host, 'CONTENT_LENGTH': str(len(body)), 'CONTENT_TYPE': 'application/json', 'REMOTE_ADDR': ip, 'HTTP_COOKIE': cookie, 'HTTP_X_JOBBOT_TOKEN': token, 'wsgi.input': io.BytesIO(body)}
        if origin: env['HTTP_ORIGIN'] = self.site.origin
        result = {}
        def start(status, headers): result.update(status=int(status[:3]), headers=dict(headers))
        result['body'] = b''.join(self.site(env, start))
        return result

    def form(self, action, fields, **kwargs):
        return self.call('/' + action, data=urlencode({'csrf': self.site.csrf(action), **fields}).encode(), **kwargs)

    def client(self, username, password=PASSWORD, register=True, **kwargs):
        response = self.form('register' if register else 'login', {'username': username, 'password': password, 'confirmation': password}, **kwargs)
        self.assertIn(response['status'], (200, 303), response['body'])
        cookie = response['headers']['Set-Cookie'].split(';', 1)[0]
        homepage = self.call('/', cookie=cookie)
        self.assertEqual(homepage['status'], 200)
        token = re.search(rb'name="jobbot-token" content="([^"]+)"', homepage['body']).group(1).decode()
        code = re.search(rb'<code id="recovery-code">([^<]+)</code>', response['body'])
        return {'cookie': cookie, 'token': token, 'code': code.group(1).decode() if code else ''}

    def state(self, client):
        response = self.call('/api/state', cookie=client['cookie'], token=client['token'])
        self.assertEqual(response['status'], 200, response['body'])
        return json.loads(response['body'])

    def test_signup_password_validation_duplicates_and_no_plaintext(self):
        for fields in [{'username': '../owner', 'password': PASSWORD, 'confirmation': PASSWORD}, {'username': 'alice', 'password': 'court', 'confirmation': 'court'}, {'username': 'alice', 'password': PASSWORD, 'confirmation': PASSWORD + 'x'}]:
            self.assertEqual(self.form('register', fields)['status'], 400)
        alice = self.client('Alice')
        self.assertEqual(self.form('register', {'username': 'ALICE', 'password': PASSWORD, 'confirmation': PASSWORD})['status'], 409)
        self.assertEqual(self.form('register', {'username': 'JobBot', 'password': PASSWORD, 'confirmation': PASSWORD})['status'], 409)
        self.assertEqual(self.state(alice)['profile']['name'], '')
        self.assertNotIn(PASSWORD.encode(), self.site.auth_path.read_bytes())
        with self.site.database() as conn:
            user = conn.execute('SELECT * FROM users').fetchone()
        self.assertNotEqual(user['recovery_hash'], alice['code'])
        self.assertEqual(user['recovery_hash'], hashlib.sha256(alice['code'].encode()).hexdigest())

    def test_signup_requires_origin_and_action_specific_csrf(self):
        values = {'username': 'alice', 'password': PASSWORD, 'confirmation': PASSWORD}
        self.assertEqual(self.form('register', values, origin=False)['status'], 403)
        self.assertEqual(self.form('register', {**values, 'csrf': self.site.csrf('login')})['status'], 403)
        self.assertEqual(self.call('/register', data=b'&'.join([b'x=1'] * 15))['status'], 400)
        for path in ('/register', '/recover', '/login', '/login.js'):
            self.assertEqual(self.call(path)['status'], 200)

    def test_owner_retained_and_three_accounts_have_separate_profiles_jobs_contacts_exports(self):
        owner = self.client('jobbot', register=False)
        alice, bob = self.client('alice'), self.client('bob')
        for username, client in [('Owner', owner), ('Alice', alice), ('Bob', bob)]:
            r = self.call('/api/profile', data={'name': username, 'contact_email': username.lower() + '@example.test'}, cookie=client['cookie'], token=client['token'])
            self.assertEqual(r['status'], 200, r['body'])
            session = self.site.session({'HTTP_COOKIE': client['cookie']})
            engine, _ = self.site.tenants.get(session['user_id'])
            engine.save_contact({'name': 'Contact ' + username, 'company': username})
            r = self.call('/api/job', data={'title': 'Poste privé ' + username, 'company': username, 'description': 'Candidature fictive.'}, cookie=client['cookie'], token=client['token'])
            self.assertEqual(r['status'], 200, r['body'])
        self.assertEqual(app.load_profile()['name'], 'Owner')
        for username, client in [('Owner', owner), ('Alice', alice), ('Bob', bob)]:
            state = self.state(client)
            self.assertEqual(state['profile']['name'], username)
            self.assertEqual([job['company'] for job in state['jobs']], [username])
            self.assertEqual([contact['name'] for contact in state['contacts']], ['Contact ' + username])
            csv = self.call('/export.csv', cookie=client['cookie'])['body'].decode('utf-8-sig')
            self.assertIn('Poste privé ' + username, csv)
            for other in {'Owner', 'Alice', 'Bob'} - {username}:
                self.assertNotIn('Poste privé ' + other, csv)
        self.assertEqual(self.call('/api/profile', data={'name': 'Intrusion'}, cookie=bob['cookie'], token=alice['token'])['status'], 403)
        self.assertEqual(self.call('/api/state', cookie=bob['cookie'], token=alice['token'])['status'], 403)
        self.assertEqual(self.state(bob)['profile']['name'], 'Bob')

    def test_cv_letters_and_task_ids_cannot_be_read_by_another_account(self):
        alice, bob = self.client('alice'), self.client('bob')
        output = io.BytesIO(); c = canvas.Canvas(output); c.drawString(40, 800, 'CV PRIVE ALICE'); c.save()
        uploaded = self.call('/api/cv/upload', data={'profile': 'polyvalent', 'content': base64.b64encode(output.getvalue()).decode()}, cookie=alice['cookie'], token=alice['token'])
        self.assertEqual(uploaded['status'], 200)
        filename = json.loads(uploaded['body'])['cv']['cv']
        self.assertEqual(self.call('/cv/' + filename, cookie=alice['cookie'])['status'], 200)
        self.assertEqual(self.call('/cv/' + filename, cookie=bob['cookie'])['status'], 404)
        created = self.call('/api/job', data={'title': 'Poste Alice', 'company': 'Privé', 'description': 'Offre fictive.'}, cookie=alice['cookie'], token=alice['token'])
        identifier = json.loads(created['body'])['id']
        self.assertEqual(self.call('/api/letter?id=' + identifier, cookie=bob['cookie'], token=bob['token'])['status'], 400)
        session = self.site.session({'HTTP_COOKIE': alice['cookie']})
        engine, _ = self.site.tenants.get(session['user_id'])
        task_id = secrets.token_hex(16)
        deliveries.save(engine, {'id': task_id, 'status': 'ready', 'kind': 'email', 'nonce': 'preuve-fictive', 'attachments': [{'content': 'CV PRIVE ALICE'}]})
        self.assertEqual(self.call('/api/outbox/task?id=' + task_id, cookie=alice['cookie'], token=alice['token'])['status'], 200)
        self.assertEqual(self.call('/api/outbox/task?id=' + task_id, cookie=bob['cookie'], token=bob['token'])['status'], 400)
        self.assertFalse(any(p['available'] for p in self.state(bob)['profiles'].values()))

    def test_accounts_sessions_and_documents_survive_restart(self):
        alice = self.client('alice')
        self.call('/api/profile', data={'name': 'Alice sauvegardée'}, cookie=alice['cookie'], token=alice['token'])
        self.site = Cloud(self.env)
        self.assertEqual(self.state(alice)['profile']['name'], 'Alice sauvegardée')
        fresh = self.client('ALICE', register=False)
        self.assertEqual(fresh['token'], alice['token'])
        self.assertEqual(self.state(fresh)['profile']['name'], 'Alice sauvegardée')

    def test_recovery_revokes_old_sessions_and_rotates_one_time_code(self):
        alice = self.client('alice')
        new_password = 'Une AUTRE phrase FICTIVE très longue'
        fields = {'username': 'alice', 'recovery_code': alice['code'], 'password': new_password, 'confirmation': new_password}
        self.assertEqual(self.form('recover', {**fields, 'recovery_code': 'mauvais'})['status'], 401)
        response = self.form('recover', fields)
        self.assertEqual(response['status'], 200)
        self.assertNotIn(alice['code'].encode(), response['body'])
        self.assertEqual(self.call('/api/state', cookie=alice['cookie'], token=alice['token'])['status'], 401)
        self.assertEqual(self.form('login', {'username': 'alice', 'password': PASSWORD})['status'], 401)
        self.assertEqual(self.form('recover', fields)['status'], 401)
        self.client('alice', new_password, register=False)

    def test_legacy_owner_session_migrates_without_resetting_data(self):
        token = secrets.token_urlsafe(32)
        with self.site.database() as conn:
            conn.execute('DROP TABLE sessions')
            conn.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)')
            conn.execute('INSERT INTO sessions VALUES(?,?)', (self.site.signed(token), int(time.time()) + 3600))
        app.save_profile({'name': 'Profil existant'})
        self.site = Cloud(self.env)
        cookie = self.site.cookie + '=' + token
        self.assertEqual(json.loads(self.call('/api/state', cookie=cookie, token=app.TOKEN)['body'])['profile']['name'], 'Profil existant')

    def test_owner_password_reset_does_not_change_guest_password_or_documents(self):
        alice = self.client('alice')
        self.call('/api/profile', data={'name': 'Alice conservée'}, cookie=alice['cookie'], token=alice['token'])
        self.env.update(JOBBOT_OWNER_PASSWORD='Nouvelle phrase FICTIVE propriétaire', JOBBOT_SESSION_SECRET='z' * 48)
        self.site = Cloud(self.env)
        self.assertEqual(self.call('/api/state', cookie=alice['cookie'], token=alice['token'])['status'], 401)
        alice = self.client('alice', register=False)
        self.assertEqual(self.state(alice)['profile']['name'], 'Alice conservée')
        self.assertEqual(self.form('login', {'username': 'jobbot', 'password': PASSWORD})['status'], 401)
        self.client('jobbot', self.env['JOBBOT_OWNER_PASSWORD'], register=False)

    def test_public_registration_rate_limit(self):
        fields = {'username': '../interdit', 'password': PASSWORD, 'confirmation': PASSWORD}
        for _ in range(8):
            self.assertEqual(self.form('register', fields)['status'], 400)
        self.assertEqual(self.form('register', fields)['status'], 429)
        with self.site.database() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM users').fetchone()[0], 0)

    def test_parallel_requests_do_not_swap_profiles_or_engines(self):
        alice, bob = self.client('alice'), self.client('bob')
        def work(pair):
            username, client = pair
            for _ in range(8):
                self.assertEqual(self.call('/api/profile', data={'name': username}, cookie=client['cookie'], token=client['token'])['status'], 200)
                self.assertEqual(self.state(client)['profile']['name'], username)
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(work, [('Alice', alice), ('Bob', bob)]))
        self.assertEqual(app.load_profile()['name'], '')

    def test_account_capacity_and_private_storage_budget(self):
        self.site.max_accounts = 3
        alice, bob = self.client('alice'), self.client('bob')
        self.assertEqual(self.form('register', {'username': 'charlie', 'password': PASSWORD, 'confirmation': PASSWORD})['status'], 503)
        info = json.loads(self.call('/api/account', cookie=alice['cookie'])['body'])
        self.assertEqual(info['username'], 'alice')
        self.assertNotIn('account_count', info)
        session = self.site.session({'HTTP_COOKIE': alice['cookie']})
        engine, _ = self.site.tenants.get(session['user_id'])
        (engine.DATA / 'fichier-test').write_bytes(b'x' * (20 * 1024 * 1024))
        self.assertEqual(self.call('/api/profile', data={'name': 'plein'}, cookie=alice['cookie'], token=alice['token'])['status'], 413)
        self.assertEqual(self.state(bob)['profile']['name'], '')
        self.assertEqual(self.call('/export.csv', cookie=alice['cookie'])['status'], 200)


if __name__ == '__main__': unittest.main()
