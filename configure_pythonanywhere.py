"""Configuration privée dans le compte PythonAnywhere, sans secret dans Git."""
import argparse
import getpass
import json
import os
import re
import secrets
from pathlib import Path


def ask_password():
    while True:
        password = getpass.getpass('Choisis un mot de passe propre à JobBot (16 caractères minimum, invisible) : ')
        if len(password) < 16:
            print(f'{len(password)} caractères saisis : il en faut au moins 16. Recommence avec une phrase de plusieurs mots.')
            continue
        again = getpass.getpass('Confirme ce mot de passe : ')
        if password == again:
            return password
        print('Les deux saisies diffèrent. Recommence ; le mot de passe actuel est conservé.')


def configure(domain, password=None, home=None, reset_password=False):
    if not re.fullmatch(r'[a-zA-Z0-9_-]+\.(?:eu\.)?pythonanywhere\.com', str(domain)):
        raise ValueError('Indique le domaine exact affiché dans ton onglet Web PythonAnywhere.')
    home = Path(home or Path.home()).resolve()
    private = home / '.config' / 'jobbot' / 'settings.json'
    data = home / 'jobbot-donnees'
    if private.exists():
        settings = json.loads(private.read_text(encoding='utf-8'))
        # Une mise à jour ne change ni le mot de passe, ni la clé, ni les données.
        settings['JOBBOT_PUBLIC_ORIGIN'] = 'https://' + domain
    else:
        settings = {'JOBBOT_PUBLIC_ORIGIN': 'https://' + domain, 'JOBBOT_OWNER_USERNAME': 'jobbot',
                    'JOBBOT_DATA_DIR': str(data), 'JOBBOT_HOSTING_PROVIDER': 'pythonanywhere-free'}
    if reset_password or 'JOBBOT_OWNER_PASSWORD' not in settings:
        if password is None:
            password = ask_password()
        if len(password) < 16:
            raise ValueError('Utilise au moins 16 caractères. Aucun fichier créé.')
        settings['JOBBOT_OWNER_PASSWORD'] = password
        # Une réinitialisation invalide aussi les anciennes sessions et tentatives.
        settings['JOBBOT_SESSION_SECRET'] = secrets.token_urlsafe(48)
    private.parent.mkdir(parents=True, exist_ok=True)
    data.mkdir(parents=True, exist_ok=True)
    # L'ouverture avec mode 0600 évite une fenêtre où le secret serait lisible par d'autres comptes.
    fd = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
    if os.name != 'nt':
        private.chmod(0o600)
        private.parent.chmod(0o700)
        data.chmod(0o700)
    return private, data


def main():
    parser = argparse.ArgumentParser(description='Préparer JobBot sur le compte gratuit PythonAnywhere.')
    parser.add_argument('--domain', required=True, help='Domaine exact affiché dans Web, sans https://')
    parser.add_argument('--reset-password', action='store_true', help='Choisir un nouveau mot de passe JobBot et révoquer les anciennes sessions, en conservant les données.')
    args = parser.parse_args()
    private, data = configure(args.domain, reset_password=args.reset_password)
    root = Path(__file__).resolve().parent
    print('Configuration privée enregistrée hors du dépôt. Aucun mot de passe affiché.')
    print('Stockage privé :', data)
    print('Dans le fichier WSGI de ton onglet Web, utilise ces trois lignes :')
    print('import sys')
    print('sys.path.insert(0, ' + repr(str(root)) + ')')
    print('from pythonanywhere_wsgi import application')
    print('Active Force HTTPS dans Web, recharge l’application puis ouvre https://' + args.domain)
    print('Identifiant JobBot : jobbot. Mot de passe : celui que tu viens de choisir.')
    print('Pense à prolonger la web app gratuite depuis Web chaque mois.')


if __name__ == '__main__':
    main()
