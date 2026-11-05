# JobBot Cloud

Un espace personnel pour comparer des offres à ses CV, adapter un CV et une lettre, retrouver les offres sur une carte et suivre ses candidatures et relances.

Le serveur fonctionne sans PC Windows allumé. L’espace est privé, protégé par une connexion. Ce dépôt contient uniquement le code : **aucun CV, suivi de candidature, profil personnel, cookie ou mot de passe de messagerie**.

## Fonctionnement

- Python 3.12, serveur Waitress et base SQLite sur stockage persistant.
- Profil et CV ajoutés depuis l’espace privé après la première connexion.
- Comparaison du texte réel des PDF, variantes de CV modifiables avec preuves et lettres PDF.
- Carte des communes et suivi des relances sans réponse.
- Module de navigateur pour lire Indeed France, France Travail, HelloWork, LinkedIn, Météojob, Adecco, Manpower et Randstad, et préparer des candidatures dans les comptes connectés.

Le module se télécharge **depuis le site connecté**, dans « Connecter mon navigateur ». Son adresse autorisée est limitée à l’adresse exacte du site. Les comptes des plateformes restent dans le navigateur de l’utilisateur. Les questions inconnues, CAPTCHA, consentements et formulaires externes nécessitent une intervention. Un accès de site refusé ne devient jamais une fausse absence d’offres.

Sur téléphone ou sans module : consultation, profil, CV, import d’une annonce par son lien lorsqu’elle est publiquement lisible, comparaisons, lettres et suivi restent accessibles. Le pilotage des huit sites et les envois dans les comptes connectés exigent un navigateur de bureau compatible et ouvert. Aucun traitement ne peut contacter les plateformes en utilisant un navigateur éteint.

## Hébergement Render

Le fichier [render.yaml](render.yaml) prépare un service Python à Francfort, sur le plus petit plan payant compatible avec un disque persistant de 1 Go. **Un déploiement de cette configuration entraîne des frais Render, à vérifier et approuver avant l’application du plan.** Aucun service gratuit avec fichiers éphémères n’est proposé comme stockage durable pour les CV.

[Préparer le déploiement sur Render](https://dashboard.render.com/blueprint/new?repo=https://github.com/yannis232/jobot)

Le déploiement démarre avec :

| Variable privée | Utilité |
| --- | --- |
| `JOBBOT_OWNER_USERNAME` | Identifiant du propriétaire, `jobbot` par défaut |
| `JOBBOT_OWNER_PASSWORD` | Mot de passe propre à JobBot, 16 caractères minimum ; saisir dans Render, jamais dans le dépôt ou le chat |
| `JOBBOT_SESSION_SECRET` | Clé de session générée par Render, 32 caractères minimum |
| `JOBBOT_DATA_DIR` | `/var/data/jobbot`, sous le disque persistant |
| `JOBBOT_PUBLIC_ORIGIN` | Facultative sur Render : son adresse HTTPS est obtenue depuis `RENDER_EXTERNAL_URL`. À fixer pour un domaine personnalisé |

L’application refuse de démarrer si son adresse HTTPS ou ses secrets privés ne sont pas correctement configurés. Les CV, exports, API et téléchargements exigent une session valide. Les cookies de session sont `Secure`, `HttpOnly` et `SameSite=Strict`. Les actions exigent l’origine exacte du site et le jeton de la page. Les échecs de connexion sont limités.

Après déploiement, ouvre l’adresse `https://…onrender.com`, connecte-toi, ajoute tes CV, complète ton profil et installe une fois le module de navigateur si tu utilises les recherches et envois connectés. Il n’y a plus de fichier BAT à lancer.

## Développement et vérification

```sh
pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Pour démarrer le serveur, configure les variables privées dans l’environnement, puis lance `python cloud.py`. L’hébergeur termine HTTPS ; le serveur écoute sur le port `PORT` fourni. Le mode de test HTTP est réservé à `127.0.0.1` avec `JOBBOT_ALLOW_LOCAL_TEST=1` et ne doit pas être activé sur un hébergement.

Les tests n’envoient aucun email, message LinkedIn ou candidature réelle. La rédaction et l’adaptation incluses sont locales au serveur et ne nécessitent pas de clé d’IA externe. L’original d’un CV est conservé ; aucun passage d’ATS ou recrutement n’est garanti.

Les données se trouvent uniquement dans `JOBBOT_DATA_DIR`, pas dans Git. Un disque persistant ne remplace pas une sauvegarde : exporter le suivi et conserver une copie privée de ses CV. Les déploiements d’un service avec disque peuvent provoquer une courte interruption.

La bibliothèque Leaflet conserve sa licence dans [web/LEAFLET-LICENSE.txt](web/LEAFLET-LICENSE.txt).
