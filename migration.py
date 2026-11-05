"""Reprise non destructive des données d'une version locale précédente."""
import json
import shutil
import sqlite3
from pathlib import Path


def restore(root, data):
    root, data = Path(root).resolve(), Path(data).resolve()
    if not (root / 'edition_personnelle.json').is_file():
        return ''
    if data != root / 'donnees' or (data / 'jobbot.sqlite').exists():
        return ''
    candidates = []
    for name in ('JobBot_Yannis_V7', 'JobBot_Yannis_V6', 'JobBot_Yannis', 'JobBot_Yannis_V5'):
        old = root.parent / name / 'donnees'
        if old != data and (old / 'jobbot.sqlite').is_file():
            candidates.append(old)
    if not candidates:
        return ''
    old = max(candidates, key=lambda p: (p / 'jobbot.sqlite').stat().st_mtime)
    data.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(old / 'jobbot.sqlite', timeout=10)
    target = sqlite3.connect(data / 'jobbot.sqlite', timeout=10)
    try:
        source.backup(target)
    finally:
        source.close()
        target.close()
    for name in ('profil.json', 'configuration.json', 'config.json', 'cv.json', 'recherche_multisite.json', 'enrichissement.json'):
        if (old / name).is_file() and not (data / name).exists():
            shutil.copyfile(old / name, data / name)
    if (old / 'cv').is_dir():
        shutil.copytree(old / 'cv', data / 'cv', dirs_exist_ok=True)
    # Les sessions Opera restent dans leur profil existant, sans copie de
    # cookies ni mélange avec un profil Edge ou le navigateur personnel.
    if (old / 'navigateur_opera').is_dir():
        (data / 'profil_navigateur.json').write_text(json.dumps({'path': str(old / 'navigateur_opera')}, ensure_ascii=False), encoding='utf-8')
    (data / 'migration_v7.json').write_text(json.dumps({'source': str(old), 'original_conserve': True}, ensure_ascii=False), encoding='utf-8')
    return 'Données de ' + old.parent.name + ' reprises. Le dossier d’origine est conservé.'
