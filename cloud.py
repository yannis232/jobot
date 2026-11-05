"""Instance web privée mono-utilisateur, sans dépendance au PC Windows."""
from __future__ import annotations
import base64
import hashlib
import hmac
import html
import io
import json
import os
import secrets
import sqlite3
import threading
import time
import zipfile
from contextlib import contextmanager
from http.cookies import SimpleCookie
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, quote, urlsplit

import app

COOKIE = '__Host-jobbot_session'
MAX_BODY = 12_000_000
SESSION_AGE = 12 * 3600


class MemoryConnection:
    def __init__(self, raw):
        self.input = io.BytesIO(raw)
        self.output = io.BytesIO()

    def makefile(self, *args, **kwargs):
        return self.input

    def sendall(self, raw):
        self.output.write(raw)


class Cloud:
    def __init__(self, environment=None):
        env = os.environ if environment is None else environment
        self.origin = str(env.get('JOBBOT_PUBLIC_ORIGIN') or env.get('RENDER_EXTERNAL_URL') or '').rstrip('/')
        u = urlsplit(self.origin)
        self.local_test = env.get('JOBBOT_ALLOW_LOCAL_TEST') == '1' and u.hostname == '127.0.0.1' and u.scheme == 'http'
        if (u.scheme != 'https' and not self.local_test) or not u.hostname or u.path not in ('', '/') or u.query or u.fragment or u.username or u.password:
            raise ValueError('Configure JOBBOT_PUBLIC_ORIGIN avec l’adresse HTTPS exacte de ton site.')
        self.host = u.netloc
        self.username = str(env.get('JOBBOT_OWNER_USERNAME') or 'jobbot')
        password = str(env.get('JOBBOT_OWNER_PASSWORD') or '')
        self.secret = str(env.get('JOBBOT_SESSION_SECRET') or '').encode()
        if len(password) < 16 or len(self.secret) < 32:
            raise ValueError('Configure un mot de passe privé de 16 caractères minimum et une clé de session de 32 caractères minimum dans les secrets de l’hébergeur.')
        self.password_hash = self.password_digest(password)
        self.cookie = 'jobbot_test_session' if self.local_test else COOKIE
        self.lock = threading.RLock()
        app.init()
        with self.database() as conn:
            conn.execute('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)')
            conn.execute('CREATE TABLE IF NOT EXISTS attempts (client TEXT, at INTEGER)')
            conn.execute('CREATE INDEX IF NOT EXISTS attempts_client ON attempts(client,at)')

    @contextmanager
    def database(self):
        conn = sqlite3.connect(app.DATA / 'cloud_auth.sqlite', timeout=15)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def password_digest(self, password):
        return hashlib.scrypt(str(password).encode(), salt=self.secret, n=16384, r=8, p=1)

    def signed(self, value):
        return hmac.new(self.secret, value.encode(), hashlib.sha256).hexdigest()

    def csrf(self):
        hour = str(int(time.time()) // 3600)
        return hour + '.' + self.signed('login:' + hour)

    def csrf_valid(self, value):
        try:
            hour, sig = value.split('.', 1)
            return abs(int(time.time()) // 3600 - int(hour)) <= 1 and hmac.compare_digest(sig, self.signed('login:' + hour))
        except (ValueError, AttributeError):
            return False

    def session(self, env):
        try:
            cookies = SimpleCookie(env.get('HTTP_COOKIE', ''))
            value = cookies[self.cookie].value
        except (KeyError, ValueError):
            return ''
        if len(value) > 100:
            return ''
        identifier = self.signed(value)
        with self.database() as conn:
            row = conn.execute('SELECT expires FROM sessions WHERE id=?', (identifier,)).fetchone()
        return identifier if row and row[0] > time.time() else ''

    def set_cookie(self, value, age=SESSION_AGE):
        return f'{self.cookie}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}' + ('' if self.local_test else '; Secure')

    def response(self, start, status, body, kind='application/json; charset=utf-8', extra=()):
        data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode('utf-8')
        headers = [('Content-Type', kind), ('Content-Length', str(len(data))), ('Cache-Control', 'no-store'),
                   ('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'strict-origin-when-cross-origin'),
                   ('X-Frame-Options', 'DENY'), ('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; frame-ancestors 'none'; form-action 'self'; object-src 'none'; base-uri 'none'")]
        if not self.local_test:
            headers.append(('Strict-Transport-Security', 'max-age=31536000'))
        start(status, headers + list(extra))
        return [data]

    def login_page(self, start, error='', status='200 OK'):
        page = (app.ROOT / 'web' / 'login.html').read_text(encoding='utf-8')
        page = page.replace('__LOGIN_ERROR__', html.escape(error)).replace('__LOGIN_CSRF__', self.csrf())
        return self.response(start, status, page, 'text/html; charset=utf-8')

    def login(self, env, start, body):
        if len(body) > 4096:
            return self.login_page(start, 'Formulaire incorrect.', '400 Bad Request')
        values = parse_qs(body.decode('utf-8', errors='replace'))
        if not self.csrf_valid(values.get('csrf', [''])[0]):
            return self.login_page(start, 'Recharge la page de connexion.', '403 Forbidden')
        client = self.signed(str(env.get('REMOTE_ADDR', 'unknown')))
        with self.lock, self.database() as conn:
            conn.execute('DELETE FROM attempts WHERE at<?', (time.time() - 900,))
            count = conn.execute('SELECT COUNT(*) FROM attempts WHERE client=?', (client,)).fetchone()[0]
            if count >= 10:
                return self.login_page(start, 'Trop de tentatives. Réessaie dans quinze minutes.', '429 Too Many Requests')
            conn.execute('INSERT INTO attempts(client,at) VALUES(?,?)', (client, int(time.time())))
            username = values.get('username', [''])[0]
            password = values.get('password', [''])[0]
            password_ok = hmac.compare_digest(self.password_digest(password), self.password_hash)
            if not (hmac.compare_digest(username.encode(), self.username.encode()) and password_ok):
                return self.login_page(start, 'Identifiant ou mot de passe incorrect.', '401 Unauthorized')
            token = secrets.token_urlsafe(32)
            conn.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
            conn.execute('INSERT INTO sessions VALUES(?,?)', (self.signed(token), int(time.time()) + SESSION_AGE))
            conn.execute('DELETE FROM attempts WHERE client=?', (client,))
        return self.response(start, '303 See Other', b'', extra=[('Location', '/'), ('Set-Cookie', self.set_cookie(token))])

    def extension_zip(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
            for p in (app.ROOT / 'extension').rglob('*'):
                if not p.is_file():
                    continue
                rel = p.relative_to(app.ROOT / 'extension').as_posix()
                data = p.read_bytes()
                if rel == 'cloud-origin.js':
                    data = ('globalThis.JOBBOT_CLOUD_ORIGIN=' + json.dumps(self.origin) + ';\n').encode()
                if rel == 'manifest.json':
                    manifest = json.loads(data)
                    manifest['host_permissions'] = [v for v in manifest['host_permissions'] if v != 'https://example.invalid/*'] + [self.origin + '/*']
                    for script in manifest['content_scripts']:
                        script['matches'] = [self.origin + '/*' if v == 'https://example.invalid/*' else v for v in script['matches']]
                    data = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
                z.writestr('JobBot_Cloud_Extension/' + rel, data)
            z.writestr('LIRE_MOI.txt', 'Extrais le dossier. Ouvre opera://extensions ou chrome://extensions, active le mode développeur, puis Charger l’extension non empaquetée et choisis JobBot_Cloud_Extension. Reviens sur ton site JobBot et recharge-le. Cette extension ne fonctionne qu’avec cette adresse HTTPS.\n')
        return output.getvalue()

    def legacy(self, env, start, body):
        method = env.get('REQUEST_METHOD', 'GET')
        path = quote(env.get('PATH_INFO', '/'), safe='/%:@')
        query = env.get('QUERY_STRING', '')
        target = path + ('?' + query if query else '')
        # L'enveloppe HTTPS et la session sont vérifiées AVANT d'appeler les routes locales.
        headers = {'Host': '127.0.0.1:1', 'Connection': 'close', 'Origin': 'http://127.0.0.1:1',
                   'Content-Type': env.get('CONTENT_TYPE', 'application/json'), 'Content-Length': str(len(body))}
        if env.get('HTTP_X_JOBBOT_TOKEN'):
            headers['X-JobBot-Token'] = env['HTTP_X_JOBBOT_TOKEN']
        raw = (method + ' ' + target + ' HTTP/1.0\r\n' + ''.join(k + ': ' + v + '\r\n' for k, v in headers.items()) + '\r\n').encode('latin-1') + body
        connection = MemoryConnection(raw)
        app.Handler(connection, ('127.0.0.1', 1), SimpleNamespace(server_port=1))
        head, content = connection.output.getvalue().split(b'\r\n\r\n', 1)
        lines = head.decode('latin-1').split('\r\n')
        status = lines[0].split(' ', 1)[1]
        extra = [tuple(line.split(': ', 1)) for line in lines[1:] if ': ' in line]
        excluded = {'server', 'date', 'connection', 'transfer-encoding', 'content-security-policy', 'referrer-policy'}
        extra = [(k, v) for k, v in extra if k.lower() not in excluded]
        extra += [('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; frame-ancestors 'none'; form-action 'self'; object-src 'none'; base-uri 'none'"), ('X-Frame-Options', 'DENY'), ('Referrer-Policy', 'strict-origin-when-cross-origin')]
        if not self.local_test:
            extra.append(('Strict-Transport-Security', 'max-age=31536000'))
        start(status, extra)
        return [content]

    def __call__(self, env, start):
        path, method = env.get('PATH_INFO', '/'), env.get('REQUEST_METHOD', 'GET')
        if path == '/healthz' and method in ('GET', 'HEAD'):
            return self.response(start, '200 OK', {'status': 'ok'})
        if env.get('HTTP_HOST') != self.host:
            return self.response(start, '400 Bad Request', {'error': 'Adresse de site incorrecte.'})
        if method not in ('GET', 'POST'):
            return self.response(start, '405 Method Not Allowed', {'error': 'Méthode indisponible.'})
        if method == 'POST' and env.get('HTTP_ORIGIN') != self.origin:
            return self.response(start, '403 Forbidden', {'error': 'Ouvre le formulaire dans ton JobBot.'})
        try:
            length = int(env.get('CONTENT_LENGTH') or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            return self.response(start, '413 Payload Too Large', {'error': 'Fichier trop volumineux.'})
        body = env['wsgi.input'].read(length) if method == 'POST' else b''
        if path == '/login':
            return self.login(env, start, body) if method == 'POST' else self.login_page(start)
        if path in ('/login.css', '/login.js') and method == 'GET':
            ext = path.rsplit('.', 1)[1]
            return self.response(start, '200 OK', (app.ROOT / 'web' / ('login.' + ext)).read_bytes(), 'text/css; charset=utf-8' if ext == 'css' else 'application/javascript; charset=utf-8')
        session = self.session(env)
        if not session:
            if path == '/' and method == 'GET':
                return self.response(start, '303 See Other', b'', extra=[('Location', '/login')])
            return self.response(start, '401 Unauthorized', {'error': 'Ta session a expiré. Reconnecte-toi à ton JobBot.'})
        if method == 'POST' and not hmac.compare_digest(str(env.get('HTTP_X_JOBBOT_TOKEN', '')), app.TOKEN):
            return self.response(start, '403 Forbidden', {'error': 'Recharge ton JobBot avant de continuer.'})
        if path == '/logout' and method == 'POST':
            with self.database() as conn:
                conn.execute('DELETE FROM sessions WHERE id=?', (session,))
            return self.response(start, '200 OK', {'ok': True}, extra=[('Set-Cookie', self.set_cookie('', 0))])
        if path == '/api/extension.zip' and method == 'GET':
            return self.response(start, '200 OK', self.extension_zip(), 'application/zip', [('Content-Disposition', 'attachment; filename="JobBot_Cloud_Extension.zip"')])
        if path in ('/cloud-ui.js', '/cloud-ui.css') and method == 'GET':
            ext = path.rsplit('.', 1)[1]
            return self.response(start, '200 OK', (app.ROOT / 'web' / ('cloud-ui.' + ext)).read_bytes(), 'text/css; charset=utf-8' if ext == 'css' else 'application/javascript; charset=utf-8')
        blocked = {'/api/browser/open', '/api/send', '/api/test-email', '/api/test-gmail', '/api/test-telegram', '/api/check-mail', '/api/yahoo/connect', '/api/gmail/connect'}
        if path in blocked:
            return self.response(start, '400 Bad Request', {'error': 'Utilise le module de ton navigateur pour connecter les sites et préparer les envois. Le serveur ne pilote pas Opera sur ton PC.'})
        if path == '/api/config' and method == 'POST':
            try:
                values = json.loads(body)
                if any(values.get(k) for k in app.SECRET_KEYS) or values.get('mail_mode') == 'direct' or values.get('watch_mail'):
                    return self.response(start, '400 Bad Request', {'error': 'Cette version utilise les comptes connectés dans ton navigateur. Aucun mot de passe Yahoo ou Google à enregistrer sur le serveur.'})
            except (ValueError, TypeError):
                return self.response(start, '400 Bad Request', {'error': 'Réglages incorrects.'})
        return self.legacy(env, start, body)


def main():
    from waitress import serve
    application = Cloud()
    serve(application, host='0.0.0.0', port=int(os.environ.get('PORT', '8080')), threads=6,
          max_request_body_size=MAX_BODY, max_request_header_size=32768, channel_timeout=30,
          expose_tracebacks=False, ident='JobBot')


if __name__ == '__main__':
    main()
