# JobBot Cloud

Des comptes personnels pour comparer des offres à ses CV, adapter un CV et une lettre, retrouver les offres sur une carte et suivre ses candidatures et relances. Un même lien peut être partagé avec des amis : chacun crée son compte et utilise son propre espace.

Le serveur fonctionne sans PC Windows allumé. L’espace est privé, protégé par une connexion. Ce dépôt contient uniquement le code : **aucun CV, suivi de candidature, profil personnel, cookie ou mot de passe de messagerie**.

## Fonctionnement

- Inscription depuis **Créer mon compte** sur la connexion, identifiant et phrase de passe de 16 caractères minimum. Les nouveaux mots de passe sont dérivés avec scrypt et un sel différent par compte.
- Code de secours affiché une seule fois pour récupérer l’accès sans email automatique. Une récupération révoque les anciennes sessions et renouvelle le code.
- CV, profil, contacts, recherches, courriers préparés et suivi séparés dans des dossiers et bases propres à chaque compte. Le module du navigateur abandonne les préparations de l’ancien compte lors d’un changement de compte ou d’une déconnexion.

- Python 3.12, serveur Waitress et base SQLite sur stockage persistant.
- Profil et CV ajoutés depuis l’espace privé après la première connexion.
- Comparaison du texte réel des PDF, variantes de CV modifiables avec preuves et lettres PDF.
- Carte des communes et suivi des relances sans réponse.
- Module de navigateur pour lire Indeed France, France Travail, HelloWork, LinkedIn, Météojob, Adecco, Manpower et Randstad, et préparer des candidatures dans les comptes connectés.

Le module se télécharge **depuis le site connecté**, dans « Connecter mon navigateur ». Son adresse autorisée est limitée à l’adresse exacte du site. Les comptes des plateformes restent dans le navigateur de l’utilisateur. Les questions inconnues, CAPTCHA, consentements et formulaires externes nécessitent une intervention. Un accès de site refusé ne devient jamais une fausse absence d’offres.

Sur téléphone ou sans module : consultation, profil, CV, import d’une annonce par son lien lorsqu’elle est publiquement lisible, comparaisons, lettres et suivi restent accessibles. Le pilotage des huit sites et les envois dans les comptes connectés exigent un navigateur de bureau compatible et ouvert. Aucun traitement ne peut contacter les plateformes en utilisant un navigateur éteint.

## Hébergement gratuit : PythonAnywhere

La voie retenue est **PythonAnywhere Beginner à 0 $/mois**, avec une application web et 512 Mo de stockage privé. Le site doit être prolongé chaque mois depuis l’onglet Web du compte. Le serveur a un accès limité aux sites externes ; le module du navigateur conserve la lecture des plateformes connectées.

Le guide complet est dans [PYTHONANYWHERE.md](PYTHONANYWHERE.md). Il décrit la création du compte gratuit, l’installation depuis ce dépôt, la configuration du mot de passe invisible dans la console privée et le raccordement WSGI. Aucun fichier BAT ni PC serveur allumé ne sont nécessaires.

Le mot de passe et la clé restent dans `~/.config/jobbot/settings.json`, hors de ce dépôt. Les CV et le suivi restent dans `~/jobbot-donnees`, également hors du dépôt et non exposés comme fichiers statiques. Une mise à jour conserve les secrets et les données.

Le compte d’origine `jobbot` et ses données sont conservés lors de la mise à jour. Les comptes créés sur le site sont enregistrés dans la base privée `cloud_auth.sqlite`, leurs données dans `users/<identifiant interne aléatoire>`. Le propriétaire de l’hébergement reste l’administrateur du stockage ; la séparation empêche l’accès entre utilisateurs depuis l’application.

Pour rester adapté aux 512 Mo gratuits, la configuration par défaut accepte **12 comptes au total**, avec un budget de 20 Mo par nouveau compte et 50 Mo pour le compte d’origine. Les enregistrements sont freinés à l’approche de ce budget et l’espace utilisé s’affiche dans le site. Les limites peuvent être ajustées par l’hébergeur avec `JOBBOT_MAX_ACCOUNTS` et `JOBBOT_USER_QUOTA_MB`, sans changer les données existantes. Ne pas ouvrir le service à un public important sur cette offre limitée.

L’application refuse de démarrer sans adresse HTTPS et secrets valides. CV, exports, API et téléchargements exigent une session. Les cookies sont `Secure`, `HttpOnly` et `SameSite=Strict`. Les actions exigent l’origine exacte du site et le jeton de la page. Les échecs de connexion sont limités.

Sources : [formule gratuite](https://www.pythonanywhere.com/pricing/) et [limites actuelles](https://help.pythonanywhere.com/pages/FreeAccountsFeatures/).

### Option Render facultative

`render.yaml` conserve une configuration payante facultative, avec un disque persistant. **Elle n’est pas activée.** Aucun service payant n’a été créé. Ne l’appliquer que si un hébergement payant est explicitement souhaité et son coût accepté. La configuration gratuite décrite ci-dessus n’utilise pas Render.

## Développement et vérification

```sh
pip install -r requirements.txt
python -m unittest discover -s tests -v
node --test tests/test_extension_accounts.cjs
```

Pour démarrer le serveur, configure les variables privées dans l’environnement, puis lance `python cloud.py`. L’hébergeur termine HTTPS ; le serveur écoute sur le port `PORT` fourni. Le mode de test HTTP est réservé à `127.0.0.1` avec `JOBBOT_ALLOW_LOCAL_TEST=1` et ne doit pas être activé sur un hébergement.

Les tests n’envoient aucun email, message LinkedIn ou candidature réelle. La rédaction et l’adaptation incluses sont locales au serveur et ne nécessitent pas de clé d’IA externe. L’original d’un CV est conservé ; aucun passage d’ATS ou recrutement n’est garanti.

Les données se trouvent uniquement dans `JOBBOT_DATA_DIR`, pas dans Git. Un disque persistant ne remplace pas une sauvegarde : exporter le suivi et conserver une copie privée de ses CV. Les déploiements d’un service avec disque peuvent provoquer une courte interruption.

La bibliothèque Leaflet conserve sa licence dans [web/LEAFLET-LICENSE.txt](web/LEAFLET-LICENSE.txt).
