# Hébergement gratuit de MoneyScout

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

Remplace le domaine d’exemple par celui de ton onglet Web. Le programme te demande de choisir et confirmer un mot de passe propre à MoneyScout, de 6 caractères minimum. Il reste invisible à l’écran. Ne le mets ni dans le chat, ni dans GitHub, ni dans la commande.

La configuration privée est écrite dans `~/.config/jobbot/settings.json` et les données dans `~/jobbot-donnees`. Ces dossiers restent hors du dépôt et ne sont pas exposés comme fichiers statiques. Une nouvelle exécution conserve le mot de passe et les données existants.

## 3. Relier le site

Dans **Web**, ouvre le fichier de configuration **WSGI**. Utilise les trois lignes indiquées par le programme précédent, avec le chemin exact du dossier `jobot`. Le point d’entrée est `from pythonanywhere_wsgi import application`.

Active **Force HTTPS**, puis clique sur **Reload**. Aucune console permanente ni fichier BAT n’est nécessaire pour faire fonctionner le site.

N’ajoute pas de correspondance de fichiers statiques pour `/`, `/cv`, le dossier de données ou le dossier de configuration : l’application protège ces accès par la connexion. Les fichiers CSS et JS sont servis par l’application.

## 4. Utiliser ton lien

Ouvre l’adresse HTTPS de ton onglet Web. L’identifiant MoneyScout est `jobbot` ; utilise le mot de passe choisi dans ta console privée. Ajoute tes CV et ton profil depuis ce site connecté.

Le démarrage demande seulement le métier et la ville. Le CV est facultatif pour commencer. **Trouver des offres** lance la lecture publique depuis l’hébergement, sans module et sans compte sur les plateformes. L’accès gratuit de PythonAnywhere est limité : certains sites refusent cette lecture et sont signalés. La première page est lue, jusqu’à 30 annonces par source, avec un cache de 10 minutes. Aucun résultat exhaustif n’est promis.

Pour envoyer sans module, prépare les PDF et le brouillon puis termine dans la messagerie ou sur l’annonce. Pour le pilotage facultatif du navigateur : **Options avancées → Navigateur connecté**, ouvre le détail du module et télécharge-le. Installe le dossier dans Opera ou Chrome en mode développeur, recharge MoneyScout puis connecte-toi seulement aux sites qui le demandent pour tes actions. Le module est limité à l’adresse exacte du site.

La carte utilise OpenStreetMap dans le navigateur et `geo.api.gouv.fr` pour identifier les communes ; ce dernier figure dans la liste d’accès autorisés de l’hébergement gratuit au moment de la préparation. L’import direct de certaines pages d’employeur et la vérification de coordonnées peuvent être limités par l’offre gratuite ou par le site lui-même. Le module peut lire les descriptions affichées ; une source inaccessible doit rester signalée comme telle.

## Entretien et mises à jour

### Partager avec des amis

Partage l’adresse de ton site, ou directement son chemin `/register`. Les amis choisissent **Créer mon compte**, gardent leur code de secours, puis ajoutent leurs propres CV et connexions. Ne leur donne pas le mot de passe du compte d’origine `jobbot`. Les nouvelles inscriptions ne passent pas par la console PythonAnywhere.

Aucune installation n’est demandée pour le mode simple. Chaque personne qui choisit le mode avancé installe le module facultatif téléchargé depuis son espace dans son propre navigateur. Après cette mise à jour, remplace un ancien module Cloud pour bénéficier de l’arrêt des tâches lors du changement de compte. Le compte et les sessions du propriétaire sont migrés automatiquement.

La configuration gratuite accepte par défaut 12 comptes au total, dont celui d’origine, et prévoit 20 Mo par nouveau compte. Ce format convient à un petit groupe. Les CV, profils, contacts, candidatures et lettres sont séparés entre comptes ; les nouveaux mots de passe et codes de secours ne sont pas conservés en clair. Le propriétaire de l’hébergement garde l’administration du stockage. Les emails automatiques de vérification ou de récupération ne sont pas activés : la récupération utilise le code de secours.

### Mot de passe du compte d’origine

Si la connexion refuse le mot de passe, vérifie que l’identifiant est bien `jobbot`. Pour choisir un nouveau mot de passe, lance dans ta console privée :

```sh
cd ~/jobot
python3.12 configure_pythonanywhere.py --domain toncompte.pythonanywhere.com --reset-password
```

Saisis et confirme le nouveau mot de passe, puis clique sur **Reload** dans Web et recharge la page de connexion. Les anciennes sessions sont invalidées et les CV ainsi que le suivi sont conservés. Une phrase de plusieurs mots convient si elle contient au moins 6 caractères. Ne communique pas ce mot de passe dans le chat.

- Prolonge l’application gratuite depuis **Web** chaque mois, avant son expiration.
- Conserve une copie de tes CV et exporte régulièrement ton suivi.
- Pour mettre à jour le code : `git pull --ff-only` dans `~/jobot`, puis **Reload** dans Web. Les secrets et données placés hors du dépôt sont conservés.
- Si PythonAnywhere refuse l’installation avec Python 3.12, choisis une version disponible compatible dans Web et utilise la même version pour l’installation. Les vérifications automatiques du dépôt utilisent Python 3.12.
- Le fichier `render.yaml` est une ancienne option payante facultative. Il n’est pas utilisé pour cet hébergement gratuit et aucun service payant n’a été activé.
