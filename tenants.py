"""Un moteur et un dossier privés par compte, sans permutation de variables globales."""
import copy
import importlib.util
import re
import sys
import threading


class TenantStore:
    def __init__(self, owner, data, signed):
        self.owner, self.data, self.signed = owner, data, signed
        self.lock = threading.RLock()
        self.engines = {'owner': owner}
        owner.TOKEN = signed('api:owner')
        owner.CLOUD_ACCOUNT_SCOPE = signed('scope:owner')
        self.locks = {'owner': threading.RLock()}

    def get(self, user_id):
        if user_id != 'owner' and not re.fullmatch(r'[a-f0-9]{32}', user_id):
            raise ValueError('Compte incorrect.')
        with self.lock:
            if user_id not in self.engines:
                name = '_jobbot_tenant_' + str(id(self)) + '_' + user_id
                spec = importlib.util.spec_from_file_location(name, self.owner.ROOT / 'app.py')
                engine = importlib.util.module_from_spec(spec)
                sys.modules[name] = engine
                try:
                    spec.loader.exec_module(engine)
                    engine.DATA = self.data / 'users' / user_id
                    engine.DATA.mkdir(parents=True, mode=0o700, exist_ok=True)
                    engine.DATA.chmod(0o700)
                    engine.CLOUD_TENANT = True
                    engine.PROFILES = {'polyvalent': {'label': 'CV principal', 'cv': ''}, 'commandes': {'label': 'Préparateur de commandes', 'cv': ''}, 'informatique': {'label': 'Technicien informatique', 'cv': ''}, 'alternance': {'label': 'Alternance systèmes et réseaux', 'cv': ''}}
                    engine.FACTS = {'name': '', 'phone': '', 'contact_email': '', 'target': '', 'city': '', 'query': '', 'mobility': '', 'experience': [], 'education': [], 'skills': [], 'constraints': '', 'profile_pitch': {}}
                    engine.PERSONAL_SEED = {}
                    engine.DEFAULT_CONFIG = copy.deepcopy(engine.DEFAULT_CONFIG)
                    for key in engine.SECRET_KEYS + ('gmail_address', 'yahoo_address', 'telegram_chat'):
                        engine.DEFAULT_CONFIG[key] = ''
                    engine.TOKEN = self.signed('api:' + user_id)
                    engine.CLOUD_ACCOUNT_SCOPE = self.signed('scope:' + user_id)
                    engine.init()
                    self.engines[user_id] = engine
                    self.locks[user_id] = threading.RLock()
                except BaseException:
                    sys.modules.pop(name, None)
                    raise
            return self.engines[user_id], self.locks[user_id]

    def usage(self, user_id):
        folder = self.data if user_id == 'owner' else self.data / 'users' / user_id
        if not folder.exists():
            return 0
        size = 0
        for path in folder.rglob('*'):
            relative = path.relative_to(folder)
            if user_id == 'owner' and (relative.parts[0] == 'users' or relative.parts[0].startswith('cloud_auth.sqlite')):
                continue
            if path.is_file():
                try:
                    size += path.stat().st_size
                except FileNotFoundError:
                    pass  # Un fichier temporaire peut être remplacé pendant la lecture.
        return size
