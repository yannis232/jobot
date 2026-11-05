"""Point d'entrée WSGI gratuit : ne démarre aucun serveur ni tâche permanente."""
import json
import os
from pathlib import Path

private = Path(os.environ.get('JOBBOT_SETTINGS_FILE') or Path.home() / '.config' / 'jobbot' / 'settings.json')
if not private.is_file():
    raise RuntimeError('Configure d’abord le site avec configure_pythonanywhere.py dans ta console privée.')
settings = json.loads(private.read_text(encoding='utf-8'))
for key, value in settings.items():
    if not key.startswith('JOBBOT_') or not isinstance(value, str):
        raise RuntimeError('Format de configuration privée incorrect.')
    os.environ[key] = value

# Les variables de stockage sont fixées avant d'importer le moteur.
from cloud import Cloud
application = Cloud()
