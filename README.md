# MoneyScout Cloud

Des comptes personnels pour comparer des offres à ses CV, adapter un CV et une lettre, retrouver les offres sur une carte et suivre ses candidatures et relances. Un même lien peut être partagé avec des amis : chacun crée son compte et utilise son propre espace.

Le serveur fonctionne sans PC Windows allumé. L’espace est privé, protégé par une connexion. Ce dépôt contient uniquement le code : **aucun CV, suivi de candidature, profil personnel, cookie ou mot de passe de messagerie**.

## Fonctionnement

- Inscription depuis **Créer mon compte** sur la connexion, identifiant et mot de passe de 6 caractères minimum. Les nouveaux mots de passe sont dérivés avec scrypt et un sel différent par compte.
- Code de secours affiché une seule fois pour récupérer l’accès sans email automatique. Une récupération révoque les anciennes sessions et renouvelle le code.
- CV, profil, contacts, recherches, courriers préparés et suivi séparés dans des dossiers et bases propres à chaque compte. Le module du navigateur abandonne les préparations de l’ancien compte lors d’un changement de compte ou d’une déconnexion.

- Python 3.12, serveur Waitress et base SQLite sur stockage persistant.
- Démarrage en deux champs : métier et ville. CV et coordonnées facultatifs pour commencer, à compléter pour préparer une candidature.
- Comparaison du texte réel des PDF, variantes de CV modifiables avec preuves et lettres PDF.
- Carte des communes et suivi des relances sans réponse.
- Recherche publique sans module ni connexion aux plateformes sur les pages accessibles des huit sources. Première page, 30 annonces maximum par site, cache de 10 minutes. Les accès bloqués et pages non reconnues sont indiqués comme indisponibles, jamais comme une absence de postes.
- Module facultatif pour lire les pages dans son navigateur et préparer des candidatures dans les comptes connectés.

Le module facultatif se télécharge **depuis le site connecté**, dans « Options avancées ». Son adresse autorisée est limitée à l’adresse exacte du site. Les comptes des plateformes restent dans le navigateur de l’utilisateur. Les questions inconnues, CAPTCHA, consentements et formulaires externes nécessitent une intervention. Un accès de site refusé ne devient jamais une fausse absence d’offres.

Sur téléphone ou sans module : recherche publique partielle, consultation, profil, CV, import d’une annonce par son lien lorsqu’elle est publiquement lisible, comparaisons, lettres et suivi restent accessibles. Le pilotage des huit sites et les envois dans les comptes connectés exigent un navigateur de bureau compatible et ouvert. Aucun traitement ne peut contacter les plateformes en utilisant un navigateur éteint.

## Hébergement gratuit : PythonAnywhere

La voie retenue est **PythonAnywhere Beginner à 0 $/mois**, avec une application web et 512 Mo de stockage privé. Le site doit être prolongé chaque mois depuis l’onglet Web du compte. Le serveur a un accès limité aux sites externes ; les sites absents de sa liste autorisée peuvent refuser la recherche publique. Le mode navigateur reste une option pour ces pages.

Le guide complet est dans [PYTHONANYWHERE.md](PYTHONANYWHERE.md). Il décrit la création du compte gratuit, l’installation depuis ce dépôt, la configuration du mot de passe invisible dans la console privée et le raccordement WSGI. Aucun fichier BAT ni PC serveur allumé ne sont nécessaires.

Le mot de passe et la clé restent dans `~/.config/jobbot/settings.json`, hors de ce dépôt. Les CV et le suivi restent dans `~/jobbot-donnees`, également hors du dépôt et non exposés comme fichiers statiques. Une mise à jour conserve les secrets et les données.

Le compte d’origine `jobbot` et ses données sont conservés lors de la mise à jour. Les comptes créés sur le site sont enregistrés dans la base privée `cloud_auth.sqlite`, leurs données dans `users/<identifiant interne aléatoire>`. Le propriétaire de l’hébergement reste l’administrateur du stockage ; la séparation empêche l’accès entre utilisateurs depuis l’application.

Pour rester adapté aux 512 Mo gratuits, la configuration par défaut accepte **12 comptes au total**, avec un budget de 20 Mo par nouveau compte et 50 Mo pour le compte d’origine. Les enregistrements sont freinés à l’approche de ce budget et l’espace utilisé s’affiche dans le site. Les limites peuvent être ajustées par l’hébergeur avec `JOBBOT_MAX_ACCOUNTS` et `JOBBOT_USER_QUOTA_MB`, sans changer les données existantes. Ne pas ouvrir le service à un public important sur cette offre limitée.

Le mode simple ne prétend pas envoyer dans des comptes tiers : les PDF et brouillons se préparent dans MoneyScout, puis l’utilisateur termine l’envoi sur le site ou dans sa messagerie. Les contacts LinkedIn restent à rechercher/vérifier manuellement sans module.

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

## GitHub Pages

Le dépôt est hébergé sur GitHub. GitHub Pages sert des fichiers statiques et ne peut pas exécuter ce serveur Python ni conserver ses comptes et CV privés. Héberger l’interface sur Pages demanderait toujours un serveur distinct pour ces fonctions.

## Connexions aux plateformes

MoneyScout est le nouveau nom du produit. Les identifiants de compte, variables `JOBBOT_*`, cookies, en-têtes `X-JobBot-*` et dossiers privés historiques sont conservés pour éviter toute migration de données ou rupture des modules installés. Les nouveaux téléchargements portent le nom MoneyScout.

La page Mes comptes regroupe les accès officiels et une préférence de messagerie propre à chaque compte. Ouvrir une page ne prouve pas une authentification ; aucun état connecté n’est inventé. Les mots de passe des plateformes ne sont ni demandés dans cette page ni enregistrés. Une connexion OAuth de messagerie exige une application Google/Yahoo autorisée et configurée : elle n’est pas active dans cette version. Un navigateur distant serait un projet d’hébergement distinct ; aucun service payant n’a été créé.
