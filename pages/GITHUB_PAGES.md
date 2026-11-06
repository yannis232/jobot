# MoneyScout sur GitHub

Ouvre le site, crée ton espace local et choisis ton mot de passe (6 caractères minimum). Ce compte appartient à ce navigateur : ce n’est pas un compte hébergé.

## Tes CV restent enregistrés

Tu les importes une seule fois. Fermer puis rouvrir le site conserve les CV, les lettres et le suivi, sur le même appareil et dans le même navigateur. Les documents sont chiffrés dans IndexedDB avec AES-GCM ; le mot de passe sert à dériver une clé avec PBKDF2. Ni le mot de passe ni les CV ne sont envoyés à GitHub.

**Profil & sauvegarde → Télécharger ma sauvegarde** crée un fichier chiffré de ton espace. Garde le fichier et son mot de passe. **Restaurer un espace sauvegardé** permet de l’ouvrir sur un autre appareil. Une restauration ajoute un espace : elle n’écrase pas les espaces déjà présents.

Effacer les données du site, utiliser la navigation privée ou changer de navigateur peut rendre le coffre indisponible. Le mot de passe n’a pas de récupération à distance. Un hébergement statique ne fournit pas une synchronisation entre appareils.

## Recherche et candidatures

- 19 catalogues publics sont consultés directement : Intermarché / Netto, METRO, HELPLINE / Everience, Accor, Sopra Steria, Devoteam, SEGULA, SOCOTEC, Veolia, Egis, Artelia, Bosch, Eurofins, SIXT, Nexity, Hana Group, JYSK, H&M et Kiabi. Ils couvrent plusieurs secteurs. Les sources, dates et limites sont indiquées.
- Le métier est libre. La ville est facultative : vide, la recherche couvre la France. Choisis Tous les contrats, alternance / apprentissage, stage, intérim, CDI ou CDD. Le contrat est reconnu dans le titre et les champs publiés, sans déduire une alternance d’une simple mention dans la description. Les informations de la source peuvent être incomplètes.
- Une seule recherche interroge tous les catalogues compatibles. Pour employé polyvalent, les intitulés équipier et vendeur sont aussi cherchés. L’option communes proches ajoute jusqu’à trois communes importantes à moins de 15 km, dans le même département. Le code postal peut être converti en ville.
- Les résultats arrivent pendant la recherche. Les titres correspondant au métier passent avant les annonces simplement récentes ; les managers sans rapport sont écartés pour une recherche d’employé polyvalent. Les CV personnalisent ensuite le classement.
- Le traitement est borné : 30 annonces par page, jusqu’à deux pages par combinaison, 90 lectures de pages au maximum, puis jusqu’à 60 descriptions. La recherche s’arrête au bout de 35 secondes et conserve les résultats partiels. 500 annonces au maximum sont conservées ; précise les critères au-delà. Le bouton Arrêter garde les résultats déjà reçus.
- Les offres apparaissent directement sous les filtres. Les informations de sources sont placées après les résultats. Les plateformes non intégrables se retrouvent uniquement dans Profil & sauvegarde, avec leur limitation d’accès explicite.
- Le moteur officiel de La bonne alternance s’affiche automatiquement après une recherche avec le contrat Alternance. Choisis ton métier dans ce moteur. Il reçoit la commune de recherche ; les CV et le coffre restent séparés. Pour utiliser une annonce dans la comparaison et les documents MoneyScout, ajoute son texte.
- Indeed, France Travail, HelloWork, LinkedIn, Météojob, Adecco, Manpower, Randstad, La bonne alternance, Apec, Adéquat, Partnaire, Synergie, CRIT et Samsic Emploi s’ouvrent par leurs liens de recherche. Leur lecture automatique générale n’est pas possible depuis une simple page GitHub.
- Ajoute le texte d’une annonce pour comparer le contenu complet aux CV.
- Sur chaque offre, les boutons Comparer mes CV, Adapter mon CV et Générer ma lettre ouvrent directement ces fonctions. La comparaison montre les mots en commun et les mots non retrouvés pour chaque CV.
- Le classement mesure des mots présents dans les documents. Il ne prédit pas le recrutement.
- Les lettres sont rédigées localement à partir des faits disponibles. Les variantes ATS conservent le parcours et n’ajoutent pas les compétences non établies ; relis toujours les textes.
- Le dossier ZIP contient le CV sélectionné et la lettre choisie. Un fichier .eml peut réunir le message et les pièces jointes pour une application mail compatible.
- Un lien Yahoo / Gmail prépare le texte mais ne joint pas les fichiers et ne clique pas sur Envoyer. Les messages LinkedIn et formulaires externes se terminent dans leurs sites.
- Les relances sont des rappels et des brouillons. Une candidature ne devient envoyée qu’après ta déclaration.

Le site ne demande aucun mot de passe Yahoo, Google ou LinkedIn et n’utilise ni module ni serveur MoneyScout externe. Les appels de recherche vont directement aux fournisseurs concernés ; la carte charge des tuiles OpenStreetMap et peut consulter le référentiel public des communes.

## Sauvegarde de la version précédente

Le code de la version Cloud reste figé dans la branche backup/moneyscout-cloud-2026-11-06 du dépôt yannis232/jobot. Le site précédent et ses comptes restent accessibles à leur adresse habituelle. Les comptes Cloud ne se transfèrent pas automatiquement vers les espaces locaux GitHub.

## Mise à jour

Les fichiers publics sont construits avec des adresses versionnées avant publication. Un ancien cache ne doit pas mélanger les nouveaux écrans et les anciens scripts. Recharger le site conserve le coffre, les CV et le suivi ; il peut être nécessaire de déverrouiller à nouveau son espace. Ne pas effacer les données du navigateur pour mettre le site à jour.
