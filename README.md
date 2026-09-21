# À chacun son tour

Application familiale mobile pour Android et iPhone. Première version à connecter et à valider sur de vrais appareils avant utilisation quotidienne.

## Inclus

- Comptes individuels Supabase, création de famille et invitation par code.
- Récupération de mot de passe par SMS (code à six chiffres, AllMySMS) ou par lien e-mail, et changement de mot de passe depuis Famille & rappels.
- Planning jour et semaine visible par tous ; filtre par membre.
- Création, modification et suppression de séries de tâches par le parent.
- Récurrence par jours de semaine et rotation hebdomadaire entre tous les membres.
- Validation par la personne assignée ou le parent ; confirmation parentale facultative.
- Actualisation toutes les 30 secondes et au retour sur la page.
- Installation PWA, abonnement Web Push par appareil, notification de test.
- Récapitulatif quotidien des tâches du jour non déclarées terminées.
- Démonstration explicitement séparée des comptes réels.

## Déployer via un dépôt GitHub privé et Vercel

1. Créer un dépôt privé personnel sur GitHub et y déposer le contenu de ce dossier (package.json doit être à la racine). Ne jamais envoyer node_modules, .env ou de clés privées.
2. Créer un projet Supabase Free, de préférence dans une région européenne. Exécuter database/setup.sql une seule fois dans SQL Editor, puis database/sms-recovery.sql si la récupération par SMS est souhaitée.
3. Dans Supabase Authentication, activer les comptes e-mail/mot de passe. Pour une famille, le plus simple est de créer les utilisateurs depuis Authentication > Users > Add user, avec leur mot de passe et confirmation explicite. Cela évite de dépendre du serveur e-mail de démonstration Supabase, qui ne permet pas l'envoi à tous les destinataires. Pour laisser les utilisateurs s'inscrire depuis l'application et confirmer leur adresse, configurer un SMTP opérationnel. Ne pas désactiver la confirmation uniquement pour contourner cet obstacle.
4. Sur votre PC, installer Node.js LTS, ouvrir ce dossier dans un terminal et exécuter `npm ci`, puis `npm run keys`. Conserver la paire VAPID ; ne pas la régénérer après activation des téléphones.
5. Sur Vercel : Add New > Project > importer ce dépôt GitHub. Limiter l'installation GitHub Vercel au dépôt sélectionné. Framework Preset : Other ; Output Directory : public ; pas de commande de build nécessaire ; installation `npm ci`.
6. Ajouter les variables suivantes dans Settings > Environment Variables, pour Production. Le fichier .env.example contient uniquement leurs noms.

| Variable | Valeur |
| --- | --- |
| SUPABASE_URL | URL du projet Supabase |
| SUPABASE_ANON_KEY | Clé publique anon du projet |
| SUPABASE_SERVICE_ROLE_KEY | Clé secrète service_role, réservée aux fonctions serveur |
| VAPID_PUBLIC_KEY | Clé publique produite par npm run keys |
| VAPID_PRIVATE_KEY | Clé privée produite par npm run keys |
| VAPID_SUBJECT | mailto: suivi d'une adresse de contact valide |
| ALLMYSMS_LOGIN | Identifiant du compte AllMySMS, pour la récupération par SMS |
| ALLMYSMS_API_KEY | Clé d API AllMySMS (espace client, section API) |
| ALLMYSMS_FROM | Nom d expéditeur affiché, 11 caractères au plus, déclaré auprès d AllMySMS |
| CRON_SECRET | Secret aléatoire long, par exemple produit avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

7. Déployer. Reporter l'URL HTTPS finale dans Supabase Authentication > URL Configuration > Site URL. Ajouter cette même URL dans Redirect URLs : la récupération de mot de passe y renvoie l'utilisateur. Si l'inscription par e-mail est utilisée, faire de même pour ses redirections.
8. Le premier parent se connecte puis crée son profil sans code famille. Il retrouve le code dans Famille & rappels. Les autres se connectent avec leurs comptes respectifs et ce code.
9. Pour un deuxième parent, changer le rôle de ce membre en `parent` depuis le Table Editor Supabase. Les enfants ne peuvent pas changer leur rôle via l'application.
10. Installer sur chaque téléphone, activer les notifications et envoyer un test. Sur iPhone : iOS 16.4 minimum, Safari > Partager > Sur l'écran d'accueil, puis ouvrir l'application installée. Sur Android : utiliser un navigateur prenant en charge Web Push.

Après connexion GitHub, chaque modification de la branche de production déclenche un déploiement Vercel. Les variables secrètes restent dans Vercel.

## Mot de passe oublié

### Par SMS, avec AllMySMS

Chaque membre enregistre son mobile dans « Famille & rappels » ; un parent renseigne aussi ceux des enfants. **Ce numéro doit être enregistré avant d'oublier son mot de passe** : sans mobile en base, seul le lien e-mail reste possible. Seuls les mobiles français 06 et 07 sont acceptés, stockés au format international, et un même numéro ne peut pas servir à deux membres.

Depuis l'écran de connexion, « Mot de passe oublié ? » puis « Recevoir plutôt un code par SMS » : la personne saisit son numéro, reçoit un code à six chiffres, puis choisit directement son nouveau mot de passe. Le changement passe par l'API d'administration Supabase côté serveur ; aucune session n'est créée au passage, la personne se reconnecte normalement ensuite.

Garde-fous, tous appliqués côté serveur dans /api/recover et database/sms-recovery.sql :

- Le code vit dix minutes, ne sert qu'une fois, et est effacé après cinq tentatives.
- Il n'est jamais stocké en clair : seule son empreinte SHA-256 est enregistrée.
- Un SMS par minute et par personne, cinq par jour et par personne, vingt par jour pour l'ensemble de la base. Ces deux derniers plafonds sont les valeurs par défaut de start_recovery : les relever demande de modifier la fonction.
- Un numéro inconnu suit exactement le même chemin qu'un numéro connu et reçoit la même réponse : l'endpoint ne permet pas de découvrir qui possède un compte.
- Les tables recovery_codes et sms_budget n'ont aucune politique de sécurité : elles ne sont atteignables que par les fonctions serveur.

Chaque SMS est facturé par AllMySMS : les plafonds ci-dessus bornent la dépense même si l'endpoint est harcelé. Le nom d'expéditeur (ALLMYSMS_FROM) doit être déclaré dans le compte AllMySMS ; en France les expéditeurs alphanumériques non déclarés sont rejetés par les opérateurs. Le message est transactionnel et ne porte donc pas de mention STOP ; vérifier ce point avec AllMySMS avant l'ouverture à la famille.

### Par e-mail

Depuis l'écran de connexion, « Mot de passe oublié ? » demande à Supabase l'envoi d'un lien. Le lien ouvre l'application avec un jeton temporaire dans l'adresse, l'application affiche le choix d'un nouveau mot de passe, l'enregistre puis connecte la personne. Le jeton est retiré de l'adresse dès l'ouverture et n'est jamais écrit dans l'historique. Un lien expire au bout d'une heure et ne sert qu'une fois ; un lien périmé affiche une invitation à en demander un autre.

Ce parcours dépend entièrement de l'envoi d'e-mails du projet Supabase. Le serveur de démonstration Supabase n'écrit qu'à quelques adresses et limite fortement le débit : sans SMTP opérationnel configuré (Authentication > Emails), la famille ne recevra rien. Supabase limite aussi le nombre de demandes par adresse ; l'application affiche alors le délai d'attente renvoyé par le service.

La réponse est volontairement identique qu'un compte existe ou non à cette adresse, pour ne pas révéler qui possède un compte. Le changement de mot de passe depuis Famille & rappels s'adresse aux personnes déjà connectées et ne nécessite pas d'e-mail.

## Rappels et gratuité

Le cron fourni se déclenche quotidiennement à 16 h UTC : à Paris, entre 18 h et 19 h en été et entre 17 h et 18 h en hiver. Vercel Hobby ne garantit pas une heure exacte. Il ne tourne que sur les déploiements de production. Un même utilisateur ne reçoit qu'un récapitulatif par jour, sur tous ses appareils inscrits. Une notification de test est limitée à une par minute. Aucun rappel n'est envoyé si toutes les tâches du jour ont été déclarées faites.

Pas de promesse de réception immédiate : réseau, autorisations et modes de concentration du téléphone influencent la réception. Pas encore de choix d'heure individuel, de relance supplémentaire ou de points/récompenses. L'application n'a aucune fonction payante. Les infrastructures restent soumises aux quotas et conditions de leurs offres gratuites. Supabase Free peut mettre en pause les projets inactifs ; contrôler l'état du projet si les rappels cessent.

Sources :
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/git/vercel-for-github
- https://supabase.com/pricing
- https://supabase.com/docs/guides/auth/auth-smtp
- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers

## Contrôle avant ouverture à la famille

Tester la récupération par SMS sur un vrai mobile : enregistrement du numéro, demande de code, changement, reconnexion, puis rejeu du même code qui doit être refusé. Tester aussi la récupération par e-mail de bout en bout avec une vraie adresse : demande du lien, réception, choix du mot de passe, connexion, puis réutilisation du même lien qui doit être refusée. Tester deux comptes dans des navigateurs séparés : visibilité commune, validation d'une tâche assignée, refus d'une tâche d'autrui pour un enfant, refus de modification des séries pour un enfant. Tester aussi une deuxième famille : aucune donnée ne doit être accessible entre familles. Tester enfin les notifications Android et iPhone avec l'application fermée, puis vérifier le premier cron dans les journaux Vercel. Ces tests réels nécessitent les comptes et services connectés ; ils ne sont pas remplacés par la démonstration.

Les tables utilisent la sécurité par ligne Supabase. Les fonctions d'écriture de validation vérifient l'appartenance au foyer et la personne assignée. Les clés service_role et VAPID_PRIVATE_KEY ne sont jamais exposées par /api/config. Les sessions sont conservées dans le stockage du navigateur : utiliser un téléphone personnel et se déconnecter des appareils partagés. L'installation des notifications rattache cet appareil au compte qui les active.

## Développement

`npm run check` vérifie la syntaxe JavaScript. Un simple serveur statique permet d'explorer la démonstration ; les fonctions /api demandent l'environnement Vercel (par exemple `npx vercel dev`). Aucune compilation frontend n'est nécessaire.

Le SQL initial n'est pas une migration réexécutable. Les évolutions de schéma devront être livrées dans de nouvelles migrations. Modifier une série de tâches modifie aussi son affichage passé ; pour conserver le passé, fixer sa date de fin puis créer une nouvelle série.
