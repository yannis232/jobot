"""Comptes indépendants : mots de passe dérivés, sessions et récupération."""
import hashlib
import hmac
import html
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from http.cookies import CookieError, SimpleCookie
from urllib.parse import parse_qs

SESSION_AGE = 12 * 3600
USERNAME = re.compile(r'[a-z0-9][a-z0-9_.-]{2,31}')


class Accounts:
    def init_accounts(self):
        self.auth_path = self.data / 'cloud_auth.sqlite'
        with self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            conn.execute('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, recovery_hash TEXT NOT NULL, created INTEGER NOT NULL)')
            conn.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, user_id TEXT NOT NULL DEFAULT 'owner')")
            columns = {r[1] for r in conn.execute('PRAGMA table_info(sessions)')}
            if 'user_id' not in columns:
                conn.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'owner'")
            conn.execute('CREATE TABLE IF NOT EXISTS attempts (client TEXT, at INTEGER)')
            conn.execute('CREATE INDEX IF NOT EXISTS attempts_client ON attempts(client,at)')
        self.auth_path.chmod(0o600)

    @contextmanager
    def database(self):
        conn = sqlite3.connect(self.auth_path, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def password_digest(self, password, salt=None):
        return hashlib.scrypt(str(password).encode(), salt=self.secret if salt is None else salt, n=16384, r=8, p=1)

    def signed(self, value):
        return hmac.new(self.secret, value.encode(), hashlib.sha256).hexdigest()

    def csrf(self, action='login'):
        hour = str(int(time.time()) // 3600)
        return hour + '.' + self.signed(action + ':' + hour)

    def csrf_valid(self, value, action='login'):
        try:
            hour, sig = value.split('.', 1)
            return abs(int(time.time()) // 3600 - int(hour)) <= 1 and hmac.compare_digest(sig, self.signed(action + ':' + hour))
        except (ValueError, AttributeError):
            return False

    def session(self, env):
        try:
            value = SimpleCookie(env.get('HTTP_COOKIE', ''))[self.cookie].value
        except (KeyError, ValueError, CookieError):
            return None
        if len(value) > 100:
            return None
        identifier = self.signed(value)
        with self.database() as conn:
            row = conn.execute('SELECT user_id FROM sessions WHERE id=? AND expires>?', (identifier, time.time())).fetchone()
            if not row:
                return None
            user_id = row['user_id']
            if user_id == 'owner':
                username = self.username
            else:
                user = conn.execute('SELECT username FROM users WHERE id=?', (user_id,)).fetchone()
                if not user:
                    return None
                username = user['username']
        return {'id': identifier, 'user_id': user_id, 'username': username}

    def set_cookie(self, value, age=SESSION_AGE):
        return f'{self.cookie}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}' + ('' if self.local_test else '; Secure')

    def issue_session(self, conn, user_id):
        token = secrets.token_urlsafe(32)
        conn.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
        conn.execute('INSERT INTO sessions(id,expires,user_id) VALUES(?,?,?)', (self.signed(token), int(time.time()) + SESSION_AGE, user_id))
        return ('Set-Cookie', self.set_cookie(token))

    def auth_page(self, action, start, error='', status='200 OK', username=''):
        page = (self.root / 'web' / (action + '.html')).read_text(encoding='utf-8')
        for key, value in {'__LOGIN_ERROR__': error, '__LOGIN_CSRF__': self.csrf(action), '__LOGIN_USERNAME__': username}.items():
            page = page.replace(key, html.escape(value, quote=True))
        return self.response(start, status, page, 'text/html; charset=utf-8')

    def login_page(self, start, error='', status='200 OK'):
        return self.auth_page('login', start, error, status)

    def form(self, action, env, start, body):
        if len(body) > 4096:
            return None, self.auth_page(action, start, 'Formulaire trop volumineux.', '400 Bad Request')
        try:
            values = parse_qs(body.decode('utf-8', errors='replace'), max_num_fields=12)
        except ValueError:
            return None, self.auth_page(action, start, 'Formulaire incorrect.', '400 Bad Request')
        values = {k: v[0] for k, v in values.items()}
        values['username'] = values.get('username', '').strip().lower()
        if not self.csrf_valid(values.get('csrf', ''), action):
            return None, self.auth_page(action, start, 'Recharge cette page avant de continuer.', '403 Forbidden', values['username'])
        return values, None

    def rate_limit(self, conn, env, action, limit=10, window=900):
        client = self.signed(action + ':' + str(env.get('REMOTE_ADDR', 'unknown')))
        conn.execute('DELETE FROM attempts WHERE at<?', (time.time() - 3600,))
        count = conn.execute('SELECT COUNT(*) FROM attempts WHERE client=? AND at>?', (client, time.time() - window)).fetchone()[0]
        if count >= limit:
            return None
        conn.execute('INSERT INTO attempts(client,at) VALUES(?,?)', (client, int(time.time())))
        return client

    def login(self, env, start, body):
        values, error = self.form('login', env, start, body)
        if error is not None:
            return error
        with self.lock, self.database() as conn:
            client = self.rate_limit(conn, env, 'login')
            if client is None:
                return self.auth_page('login', start, 'Trop de tentatives. Réessaie dans quinze minutes.', '429 Too Many Requests', values['username'])
            password = values.get('password', '')
            user = conn.execute('SELECT * FROM users WHERE username=?', (values['username'],)).fetchone()
            if values['username'] == self.username.lower():
                user_id, expected, salt = 'owner', self.password_hash, self.secret
            elif user:
                user_id, expected, salt = user['id'], bytes.fromhex(user['password_hash']), bytes.fromhex(user['salt'])
            else:
                user_id, expected, salt = None, self.password_hash, self.secret
            valid = hmac.compare_digest(self.password_digest(password, salt), expected)
            if not user_id or not valid:
                return self.auth_page('login', start, 'Identifiant ou mot de passe incorrect.', '401 Unauthorized', values['username'])
            cookie = self.issue_session(conn, user_id)
            conn.execute('DELETE FROM attempts WHERE client=?', (client,))
        return self.response(start, '303 See Other', b'', extra=[('Location', '/'), cookie])

    def password_error(self, values):
        password = values.get('password', '')
        if not 16 <= len(password) <= 200:
            return 'Choisis un mot de passe de 16 à 200 caractères. Une phrase de plusieurs mots convient.'
        if not hmac.compare_digest(password.encode(), values.get('confirmation', '').encode()):
            return 'Les deux mots de passe diffèrent. Retape le même mot de passe dans les deux champs.'
        return ''

    def account_ready(self, start, cookie, code, *, recovered=False):
        page = (self.root / 'web' / 'account-ready.html').read_text(encoding='utf-8')
        page = page.replace('__RECOVERY_CODE__', html.escape(code, quote=True)).replace('__ACCOUNT_TITLE__', 'Ton accès est rétabli.' if recovered else 'Ton compte est prêt.')
        return self.response(start, '200 OK', page, 'text/html; charset=utf-8', [cookie])

    def register(self, env, start, body):
        values, error = self.form('register', env, start, body)
        if error is not None:
            return error
        with self.lock, self.database() as conn:
            conn.execute('BEGIN IMMEDIATE')
            client = self.rate_limit(conn, env, 'register', 8, 3600)
            if client is None:
                return self.auth_page('register', start, 'Trop de demandes depuis cette connexion. Réessaie dans une heure.', '429 Too Many Requests', values['username'])
            reason = self.password_error(values)
            if not USERNAME.fullmatch(values['username']):
                reason = 'Choisis un identifiant de 3 à 32 caractères : lettres sans accent, chiffres, point, tiret ou soulignement.'
            if reason:
                return self.auth_page('register', start, reason, '400 Bad Request', values['username'])
            if values['username'] == self.username.lower() or conn.execute('SELECT 1 FROM users WHERE username=?', (values['username'],)).fetchone():
                return self.auth_page('register', start, 'Cet identifiant est déjà utilisé. Choisis-en un autre.', '409 Conflict', values['username'])
            count = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0] + 1
            if count >= self.max_accounts:
                return self.auth_page('register', start, 'Le nombre de comptes prévu pour cet hébergement gratuit est atteint. Contacte la personne qui t’a partagé le lien.', '503 Service Unavailable', values['username'])
            user_id, salt, code = secrets.token_hex(16), secrets.token_bytes(16), secrets.token_urlsafe(24)
            conn.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (user_id, values['username'], self.password_digest(values['password'], salt).hex(), salt.hex(), hashlib.sha256(code.encode()).hexdigest(), int(time.time())))
            cookie = self.issue_session(conn, user_id)
        return self.account_ready(start, cookie, code)

    def recover(self, env, start, body):
        values, error = self.form('recover', env, start, body)
        if error is not None:
            return error
        with self.lock, self.database() as conn:
            client = self.rate_limit(conn, env, 'recover')
            if client is None:
                return self.auth_page('recover', start, 'Trop de tentatives. Réessaie dans quinze minutes.', '429 Too Many Requests', values['username'])
            user = conn.execute('SELECT * FROM users WHERE username=?', (values['username'],)).fetchone()
            proof = hashlib.sha256(values.get('recovery_code', '').strip().encode()).hexdigest()
            if not hmac.compare_digest(proof, user['recovery_hash'] if user else '0' * 64) or not user:
                return self.auth_page('recover', start, 'Identifiant ou code de secours incorrect.', '401 Unauthorized', values['username'])
            reason = self.password_error(values)
            if reason:
                return self.auth_page('recover', start, reason, '400 Bad Request', values['username'])
            salt, code = secrets.token_bytes(16), secrets.token_urlsafe(24)
            conn.execute('UPDATE users SET password_hash=?,salt=?,recovery_hash=? WHERE id=?', (self.password_digest(values['password'], salt).hex(), salt.hex(), hashlib.sha256(code.encode()).hexdigest(), user['id']))
            conn.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
            conn.execute('DELETE FROM attempts WHERE client=?', (client,))
            cookie = self.issue_session(conn, user['id'])
        return self.account_ready(start, cookie, code, recovered=True)
