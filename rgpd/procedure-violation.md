# Procédure en cas de violation de données

*Articles 33 et 34 du RGPD. À lire AVANT d'en avoir besoin ; à suivre dans
l'ordre le jour où il le faut.*

## Qu'est-ce qu'une violation

Tout accès, perte, altération ou divulgation de données personnelles qui n'était
pas prévu. Exemples concrets pour Frutiparc :

- la clé d'administration (`ADMIN_KEY`) ou la base de données exposée (dépôt
  public, journal, capture d'écran) ;
- un compte administrateur ou modérateur compromis ;
- une faille qui a laissé lire les fiches, e-mails, messages privés ou courriers
  d'autres joueurs ;
- l'export « Mes données » servi au mauvais joueur ;
- une sauvegarde de base perdue ou copiée ;
- un e-mail envoyé aux mauvais destinataires.

Un bug qui n'expose rien à personne (un score faux, une bouille perdue) n'est
pas une violation.

## Les 72 heures

Le délai court **à partir du moment où l'équipe en a connaissance**.

### Heure 0 — contenir

1. Couper l'accès : régénérer `ADMIN_KEY`, changer le mot de passe de la base,
   révoquer les sessions (`DELETE FROM sessions`), suspendre le compte
   compromis.
2. Ne rien effacer qui servirait à comprendre : garder les journaux.
3. Noter l'heure de découverte et qui a découvert.

### Jour 0 – 1 — comprendre

Répondre par écrit, même approximativement :

- **Quoi** : quelles tables, quelles colonnes (le registre des traitements dit
  ce qu'elles contiennent).
- **Qui** : combien de joueurs, et y a-t-il des mineurs.
- **Comment** et **depuis quand**.
- **Quel risque pour les personnes** : un pseudo et des scores exposés, c'est
  faible ; des e-mails, des messages privés, des dates de naissance de mineurs,
  ce ne l'est pas.

### Avant 72 h — notifier la CNIL

Sauf si la violation ne présente **aucun** risque pour les personnes (par
exemple des données déjà publiques, ou chiffrées sans la clé), notifier la CNIL
par son téléservice : <https://notifications.cnil.fr/notifications/index>.

Ce qu'ils demandent (préparé grâce à l'étape précédente) : la nature de la
violation, les catégories et le nombre approximatif de personnes et de données,
les conséquences probables, les mesures prises, un contact.

Si tout n'est pas encore connu, notifier quand même, et compléter ensuite : le
règlement le permet (art. 33-4).

### Si le risque est élevé — prévenir les joueurs

Quand la violation peut leur nuire (e-mails, messages privés, données de
mineurs, codes secrets même hachés), les informer **sans délai injustifié**, en
langage simple : ce qui s'est passé, ce que ça peut leur faire, ce qu'on a
fait, ce qu'ils peuvent faire (changer de code secret, se méfier d'un e-mail).

Canaux disponibles : le courrier interne à tous (`broadcastSiteLogToAllUsers`),
une annonce dans les salons, l'e-mail pour ceux qui en ont un, et une note sur
`/confidentialite`.

### Après — consigner

Toute violation, notifiée ou non, est consignée dans le fichier
`rgpd/violations.md` (à créer à la première) : date, faits, analyse, décisions,
mesures. C'est la trace que la CNIL peut demander (art. 33-5).

## Qui fait quoi

- **Le responsable du traitement** (`RGPD_RESPONSABLE`) décide de notifier et
  signe la notification.
- **Qui a l'accès technique** contient et analyse.
- En cas de doute sur le risque : notifier. Notifier pour rien coûte un
  formulaire ; ne pas notifier coûte bien plus.

## Réduire les chances d'en avoir besoin

- Ne jamais mettre `ADMIN_KEY`, `DATABASE_URL`, `RESEND_API_KEY` dans le dépôt,
  un fichier public ou un journal.
- Limiter les administrateurs, et leur donner un rôle (`admin_role`) plutôt que
  la clé complète.
- Garder les dépendances à jour (`npm audit`).
- Tester la restauration d'une sauvegarde de base une fois par an.
