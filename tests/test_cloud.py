"""Accès privé et fonctions réelles du site ; aucune candidature envoyée."""
import base64
import io
import json
import re
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from urllib.parse import urlencode
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
import cloud
from configure_pythonanywhere import configure
from reportlab.pdfgen import canvas
from pypdf import PdfReader


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous = app.DATA
        self.profiles = {k: dict(v) for k, v in app.PROFILES.items()}
        app.DATA = Path(self.tmp.name)
        self.settings = {'JOBBOT_PUBLIC_ORIGIN': 'https://jobbot-test.example', 'JOBBOT_OWNER_USERNAME': 'proprietaire',
                         'JOBBOT_OWNER_PASSWORD': 'Mot de passe FICTIF pour les tests', 'JOBBOT_SESSION_SECRET': 's' * 48}
        self.site = cloud.Cloud(self.settings)
        self.cookies = ''

    def tearDown(self):
        app.DATA = self.previous
        app.PROFILES.clear(); app.PROFILES.update(self.profiles)
        self.tmp.cleanup()

    def call(self, path='/', method='GET', data=None, *, cookie=True, origin=True, token=True, host=None):
        body = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else b''
        env = {'REQUEST_METHOD': method, 'PATH_INFO': path, 'QUERY_STRING': '', 'HTTP_HOST': host or self.site.host,
               'REMOTE_ADDR': '127.0.0.1', 'CONTENT_LENGTH': str(len(body)), 'CONTENT_TYPE': 'application/json',
               'wsgi.input': io.BytesIO(body)}
        if '?' in path:
            env['PATH_INFO'], env['QUERY_STRING'] = path.split('?', 1)
        if origin: env['HTTP_ORIGIN'] = self.site.origin
        if token: env['HTTP_X_JOBBOT_TOKEN'] = app.TOKEN
        if cookie: env['HTTP_COOKIE'] = self.cookies
        captured = {}
        def start(status, headers): captured.update(status=int(status[:3]), headers=dict(headers))
        raw = b''.join(self.site(env, start))
        return captured['status'], captured['headers'], raw

    def login(self, password=None):
        form = urlencode({'username': 'proprietaire', 'password': password or self.settings['JOBBOT_OWNER_PASSWORD'], 'csrf': self.site.csrf()}).encode()
        status, headers, body = self.call('/login', 'POST', form)
        if status == 303: self.cookies = headers['Set-Cookie'].split(';', 1)[0]
        return status, headers, body

    def test_fail_closed_without_private_settings_and_https(self):
        for changes in [{'JOBBOT_OWNER_PASSWORD': ''}, {'JOBBOT_SESSION_SECRET': ''}, {'JOBBOT_PUBLIC_ORIGIN': 'http://jobbot-test.example'}]:
            with self.assertRaises(ValueError): cloud.Cloud({**self.settings, **changes})

    def test_free_host_configuration_preserves_private_credentials_and_data(self):
        home = app.DATA / 'home'
        private, data = configure('exemple.pythonanywhere.com', password='Mot de passe FICTIF pour les tests', home=home)
        before = json.loads(private.read_text())
        (data / 'temoin.txt').write_text('à conserver')
        configure('exemple.pythonanywhere.com', home=home)
        after = json.loads(private.read_text())
        self.assertEqual(before['JOBBOT_SESSION_SECRET'], after['JOBBOT_SESSION_SECRET'])
        self.assertEqual(before['JOBBOT_OWNER_PASSWORD'], after['JOBBOT_OWNER_PASSWORD'])
        self.assertEqual((data / 'temoin.txt').read_text(), 'à conserver')
        self.assertNotIn('jobot', str(private.relative_to(home)))
        with self.assertRaises(ValueError): configure('https://exemple.pythonanywhere.com', password='x'*20, home=home)

    def test_every_private_route_is_locked_even_with_api_token(self):
        for path in ['/api/state', '/api/letter?id=1', '/cv/example.pdf', '/export.csv', '/api/extension.zip', '/.git/config', '/app.py']:
            self.assertEqual(self.call(path)[0], 401, path)
        self.assertEqual(self.call('/')[0], 303)
        self.assertEqual(self.call('/healthz', token=False, host='internal-health')[0], 200)

    def test_login_cookie_logout_and_expiration(self):
        self.assertEqual(self.login('incorrect')[0], 401)
        status, headers, body = self.login()
        self.assertEqual(status, 303)
        cookie = headers['Set-Cookie']
        self.assertIn('__Host-', cookie); self.assertIn('Secure', cookie); self.assertIn('HttpOnly', cookie); self.assertIn('SameSite=Strict', cookie)
        self.assertEqual(self.call('/api/state')[0], 200)
        self.assertEqual(self.call('/logout', 'POST', {})[0], 200)
        self.assertEqual(self.call('/api/state')[0], 401)

    def test_host_origin_csrf_and_body_limits(self):
        self.login()
        self.assertEqual(self.call('/', host='evil.example')[0], 400)
        self.assertEqual(self.call('/api/profile', 'POST', {'name': 'autre'}, origin=False)[0], 403)
        self.assertEqual(self.call('/api/profile', 'POST', {'name': 'autre'}, token=False)[0], 403)
        self.assertEqual(app.load_profile()['name'], '')

    def test_login_requires_origin_and_valid_form_nonce(self):
        self.assertEqual(self.call('/login', 'POST', b'username=x&password=x', origin=False)[0], 403)
        self.assertEqual(self.call('/login', 'POST', b'username=x&password=x&csrf=bad')[0], 403)

    def test_failed_login_rate_limit(self):
        for _ in range(10): self.assertEqual(self.login('incorrect')[0], 401)
        self.assertEqual(self.login()[0], 429)

    def test_private_state_starts_empty_and_survives_restart(self):
        self.login()
        state = json.loads(self.call('/api/state')[2])
        self.assertEqual(state['profile']['name'], '')
        self.assertEqual(state['jobs'], [])
        self.assertEqual(state['contacts'], [])
        self.assertFalse(any(p['available'] for p in state['profiles'].values()))
        self.assertEqual(self.call('/api/profile', 'POST', {'name': 'Alex Exemple', 'contact_email': 'alex@example.test', 'city': 'Lyon'})[0], 200)
        self.site = cloud.Cloud(self.settings)
        self.assertEqual(json.loads(self.call('/api/state')[2])['profile']['name'], 'Alex Exemple')

    def test_windows_and_provider_secret_routes_are_unavailable(self):
        self.login()
        for path in ['/api/browser/open', '/api/send', '/api/yahoo/connect', '/api/check-mail']:
            self.assertEqual(self.call(path, 'POST', {})[0], 400)
        self.assertEqual(self.call('/api/config', 'POST', {'yahoo_password': 'NE_PAS_STOCKER'})[0], 400)
        self.assertEqual(self.call('/api/config', 'POST', {'mail_mode': 'direct'})[0], 400)
        self.assertEqual(self.call('/api/config', 'POST', {'mail_mode': 'browser', 'yahoo_address': 'alex@example.test'})[0], 200)
        self.assertNotIn('NE_PAS_STOCKER', (app.DATA / 'configuration.json').read_text())

    def test_downloaded_module_pinned_to_our_site_and_contains_no_secrets(self):
        self.login()
        status, headers, data = self.call('/api/extension.zip')
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            m = json.loads(z.read('JobBot_Cloud_Extension/manifest.json'))
            self.assertIn(self.site.origin + '/*', m['host_permissions'])
            self.assertNotIn('https://example.invalid/*', m['host_permissions'])
            self.assertFalse(any('127.0.0.1' in h for h in m['host_permissions']))
            self.assertIn(self.site.origin, z.read('JobBot_Cloud_Extension/cloud-origin.js').decode())
            contents = '\n'.join(z.read(n).decode() for n in z.namelist())
            self.assertNotIn(self.settings['JOBBOT_OWNER_PASSWORD'], contents)
            self.assertNotIn(self.settings['JOBBOT_SESSION_SECRET'], contents)
            self.assertNotIn(app.TOKEN, contents)

    def test_upload_analyse_adapt_cv_and_download_private_pdfs(self):
        self.login()
        self.call('/api/profile', 'POST', {'name': 'Alex Exemple', 'contact_email': 'alex@example.test', 'skills': ['Windows'], 'experience': ['Stage en assistance utilisateurs.']})
        out=io.BytesIO(); c=canvas.Canvas(out); t=c.beginText(40,800)
        for line in ['Alex Exemple','Support informatique. Assistance utilisateurs Windows.','Active Directory (notions). Installation de postes informatiques.','Stage en maintenance des postes, diagnostic et travail en equipe.','Baccalaureat obtenu. Anglais : notions. Sens du service.']: t.textLine(line)
        c.drawText(t); c.save()
        status, _, raw=self.call('/api/cv/upload','POST',{'profile':'informatique','content':base64.b64encode(out.getvalue()).decode()})
        self.assertEqual(status,200,raw)
        status, _, raw=self.call('/api/job','POST',{'title':'Technicien support informatique','company':'Exemple','profile':'informatique','description':'Assistance utilisateurs Windows. Python expert requis.'})
        self.assertEqual(status,200,raw); job=json.loads(raw)
        self.assertGreater(job['score'],0)
        status, _, raw=self.call('/api/cv/adapt','POST',{'id':job['id']})
        self.assertEqual(status,200,raw); adapted=json.loads(raw)
        self.assertNotIn('Python', adapted['ats_text'])
        status, _, pdf=self.call('/api/cv/adapted?id='+job['id'])
        self.assertEqual(status,200,pdf)
        self.assertIn('Windows',''.join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages))
        self.assertEqual(self.call('/api/letter/draft','POST',{'id':job['id']})[0],200)
        self.assertEqual(self.call('/api/letter?id='+job['id'])[0],200)
        self.cookies=''
        self.assertEqual(self.call('/api/cv/adapted?id='+job['id'])[0],401)


if __name__ == '__main__': unittest.main()
