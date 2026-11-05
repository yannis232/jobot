# Hébergement gratuit de JobBot

L’offre **Beginner à 0 $/mois** permet une application web avec stockage privé de 512 Mo. L’application doit être prolongée chaque mois depuis l’onglet Web du compte. Le serveur n’a accès qu’à certains sites externes ; les recherches et les envois connectés passent donc par le module de ton navigateur. Les CV et le suivi restent sur le disque privé du compte, hors de GitHub.

Sources officielles : [offres](https://www.pythonanywhere.com/pricing/), [limites gratuites](https://help.pythonanywhere.com/pages/FreeAccountsFeatures/), [configuration WSGI](https://help.pythonanywhere.com/pages/Flask/), [sites accessibles depuis le serveur](https://www.pythonanywhere.com/whitelist/).

## 1. Compte et code

Crée un [compte Beginner gratuit](https://www.pythonanywhere.com/registration/register/beginner/) ou connecte-toi à ton compte existant. Garde le mot de passe du compte pour toi et confirme ton adresse email.

Dans **Consoles → Bash**, exécute :

```sh
git clone https://github.com/yannis232/jobot.git
cd jobot
python3.12 -m pip install --user --no-cache-dir -r requirements.txt
```

Si le dossier `jobot` existe déjà, conserve-le et mets son code à jour avec `git pull --ff-only` au lieu de le cloner à nouveau. Ne supprime pas les dossiers privés de données.

## 2. Application et mot de passe privé

Dans **Web → Add a new web app**, conserve l’offre gratuite, choisis **Manual configuration**, puis Python 3.12. Note le domaine exact affiché : par exemple `toncompte.pythonanywhere.com`.

Dans ta console Bash, depuis le dossier `jobot`, lance :

```sh
python3.12 configure_pythonanywhere.py --domain toncompte.pythonanywhere.com
```

Remplace le domaine d’exemple par celui de ton onglet Web. Le programme te demande de choisir et confirmer un mot de passe propre à JobBot, de 16 caractères minimum. Il reste invisible à l’écran. Ne le mets ni dans le chat, ni dans GitHub, ni dans la commande.

La configuration privée est écrite dans `~/.config/jobbot/settings.json` et les données dans `~/jobbot-donnees`. Ces dossiers restent hors du dépôt et ne sont pas exposés comme fichiers statiques. Une nouvelle exécution conserve le mot de passe et les données existants.

## 3. Relier le site

Dans **Web**, ouvre le fichier de configuration **WSGI**. Utilise les trois lignes indiquées par le programme précédent, avec le chemin exact du dossier `jobot`. Le point d’entrée est `from pythonanywhere_wsgi import application`.

Active **Force HTTPS**, puis clique sur **Reload**. Aucune console permanente ni fichier BAT n’est nécessaire pour faire fonctionner le site.

N’ajoute pas de correspondance de fichiers statiques pour `/`, `/cv`, le dossier de données ou le dossier de configuration : l’application protège ces accès par la connexion. Les fichiers CSS et JS sont servis par l’application.

## 4. Utiliser ton lien

Ouvre l’adresse HTTPS de ton onglet Web. L’identifiant JobBot est `jobbot` ; utilise le mot de passe choisi dans ta console privée. Ajoute tes CV et ton profil depuis ce site connecté.

Pour les recherches et les candidatures : **Connecter mon navigateur → Télécharger le module**, puis installe une fois le dossier dans Opera ou Chrome en mode développeur. Recharge le site, puis connecte-toi à tes plateformes dans leurs onglets. Le module est limité à l’adresse exacte de ton JobBot.

La carte utilise OpenStreetMap dans le navigateur et `geo.api.gouv.fr` pour identifier les communes ; ce dernier figure dans la liste d’accès autorisés de l’hébergement gratuit au moment de la préparation. L’import direct de certaines pages d’employeur et la vérification de coordonnées peuvent être limités par l’offre gratuite ou par le site lui-même. Le module peut lire les descriptions affichées ; une source inaccessible doit rester signalée comme telle.

## Entretien et mises à jour

Si la connexion refuse le mot de passe, vérifie que l’identifiant est bien `jobbot`. Pour choisir un nouveau mot de passe, lance dans ta console privée :

```sh
cd ~/jobot
python3.12 configure_pythonanywhere.py --domain toncompte.pythonanywhere.com --reset-password
```

Saisis et confirme le nouveau mot de passe, puis clique sur **Reload** dans Web et recharge la page de connexion. Les anciennes sessions sont invalidées et les CV ainsi que le suivi sont conservés. Une phrase de plusieurs mots convient si elle contient au moins 16 caractères. Ne communique pas ce mot de passe dans le chat.

- Prolonge l’application gratuite depuis **Web** chaque mois, avant son expiration.
- Conserve une copie de tes CV et exporte régulièrement ton suivi.
- Pour mettre à jour le code : `git pull --ff-only` dans `~/jobot`, puis **Reload** dans Web. Les secrets et données placés hors du dépôt sont conservés.
- Si PythonAnywhere refuse l’installation avec Python 3.12, choisis une version disponible compatible dans Web et utilise la même version pour l’installation. Les vérifications automatiques du dépôt utilisent Python 3.12.
- Le fichier `render.yaml` est une ancienne option payante facultative. Il n’est pas utilisé pour cet hébergement gratuit et aucun service payant n’a été activé.
