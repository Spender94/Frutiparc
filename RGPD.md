# RGPD — ce que Frutiparc traite, et ce qu'il reste à faire

Ceci est une **checklist d'ingénierie**, pas un avis juridique : elle dit ce que
le code fait aujourd'hui, ce que le règlement demande, et par quoi commencer.
Un juriste aura le dernier mot sur les formulations ; le travail technique, lui,
est décrit ici assez précisément pour être fait.

Le contexte pèse sur presque toutes les décisions : **site bénévole, non
commercial, sans publicité, sans régie, sans mesure d'audience**. Cela n'exonère
de rien (le RGPD ne parle pas de commerce), mais cela simplifie beaucoup — il
n'y a ni profilage, ni revente, ni transfert marketing à documenter.

---

## 1. Ce que le site traite aujourd'hui

Relevé dans `db.js` et `server.js`, colonne par colonne.

### Le compte (`users`)

| donnée | d'où elle vient | obligatoire ? |
|---|---|---|
| `username`, `password` (bcrypt) | inscription | oui |
| `email` | inscription | **non** — sert au seul renvoi de mot de passe |
| `register_ip`, `device_token` | inscription | posés d'office |
| `last_login`, `created_at` | connexion | posés d'office |
| `first_name`, `last_name`, `birthday`, `city`, `country`, `region`, `real_job`, `site_url`, `gender`, `comment` | la fiche, remplie par le joueur | non |
| `banned_until`, `banned_by`, `banned_reason` | modération | — |
| `admin_role`, `is_moderator`, `is_animator` | staff | — |

Le reste des colonnes est du **jeu** (kikooz, XP, inventaire, fruticard, quotas
FD, bureau, feutres) : des données personnelles au sens du règlement — elles se
rattachent à une personne identifiée — mais sans aucune sensibilité.

### Ce que le joueur écrit

| table | contenu | rétention actuelle |
|---|---|---|
| `chat_history` | les lignes des salons | **24 h** (purge en base et en mémoire) |
| forum (`forum_*`) | sujets, messages, signatures | **sans limite** |
| courrier interne, messages privés | messages | **sans limite** |
| `forum_images`, `quiz_images`, `bouille_images` | fichiers déposés | **sans limite** |
| `moderation_logs` | sanctions (pseudo, modérateur, motif) | **sans limite** |
| `user_logs` | historique du joueur (kikooz, pictos…) | **sans limite** |
| `scores`, `challenge_score_archive` | classements | **sans limite** |
| `deleted_usernames` | le pseudo d'un compte supprimé, **gardé pour toujours** | volontaire (il ne doit pas être repris) |

### Les tiers

| tiers | ce qui part | quand |
|---|---|---|
| **YouTube** (`www.youtube.com/embed/…`) | l'IP du joueur, ses cookies YouTube | dès qu'un blindtest se lance |
| **Resend** (`RESEND_API_KEY`) | l'e-mail du joueur | renvoi de mot de passe |
| **service de push du navigateur** (Google/Apple/Mozilla) | une adresse d'envoi chiffrée | si le joueur active les notifications |
| **l'hébergeur** (Render) | tout, par construction | en permanence |

Pas d'analytics, pas de régie, pas de cookie tiers hors YouTube : vérifié
(aucun `gtag`, `matomo`, `plausible`, `sentry` dans le code servi).

---

## 2. Les obligations, et où l'on en est

### ✅ Déjà en place

- **Politique de confidentialité** (`public/confidentialite.html`), écrite,
  lisible, honnête sur l'essentiel.
- **Minimisation à l'inscription** : pseudo + mot de passe. L'e-mail est
  facultatif et son usage est déclaré.
- **Sécurité du mot de passe** : bcrypt, avec migration paresseuse des anciens.
- **Notifications** : désactivées par défaut, consentement explicite, retrait
  possible, suppression des adresses au retrait.
- **Suppression d'un compte** : `db.deleteUser` efface en cascade (l'essentiel
  des tables porte `ON DELETE CASCADE`).

### ⚠️ À combler — par ordre d'effet

**1. L'embarquement YouTube pose un cookie sans consentement.**
C'est le point le plus exposé, parce qu'il relève de l'ePrivacy (la « loi
cookies »), qui, elle, exige un consentement **préalable** — et la CNIL
sanctionne ce point précis. Deux remèdes, du plus simple au plus propre :
   - passer à `www.youtube-nocookie.com/embed/…` (une ligne, `server.js:13964`) :
     YouTube ne dépose alors plus de cookie publicitaire, mais lit toujours l'IP ;
   - ne charger l'iframe **qu'au clic** du joueur, derrière une vignette qui
     annonce « lire sur YouTube (dépose des cookies) ».
   La combinaison des deux est ce qui se fait de mieux sans bandeau.

**2. Aucun moyen, pour le joueur, d'exercer ses droits tout seul.**
Le règlement n'impose pas le libre-service, mais impose de répondre en un mois,
et une demande par courrier interne se perd. À construire :
   - **export** (art. 20, portabilité) : un bouton « Télécharger mes données »
     qui rend un JSON — compte, fiche, inventaire, scores, messages, forum ;
   - **suppression** (art. 17) : un bouton « Supprimer mon compte », avec
     confirmation par mot de passe et un délai de grâce (7 jours) ;
   - **rectification** (art. 16) : déjà là, c'est la fiche.

**3. Rien ne dit sur quelle base légale on traite, ni combien de temps.**
La politique doit nommer, pour chaque finalité, la **base légale** (ici : le
contrat pour le compte et le jeu, l'intérêt légitime pour l'anti-triche et la
modération, le consentement pour les notifications) et la **durée de
conservation**. Aujourd'hui aucune des deux n'y figure.

**4. Les durées de conservation ne sont ni décidées ni appliquées.**
À trancher, puis à implémenter (une purge par table) :
   - **comptes inactifs** : la CNIL retient couramment 2 à 3 ans sans connexion,
     avec un courriel d'avertissement avant effacement ;
   - **journaux techniques** : 6 à 12 mois ;
   - **`register_ip` / `device_token`** : leur seule raison d'être est
     l'anti-multi-comptes du parrainage — quelques mois suffisent ;
   - **`moderation_logs`** : le temps de la sanction plus un délai de recours ;
   - forum et courrier : par nature durables, à dire dans la politique.

**5. L'âge n'est jamais demandé.**
Le site rejoue un parc pour enfants ; il attirera des mineurs. En France, le
consentement d'un mineur de **moins de 15 ans** doit être donné ou autorisé par
un titulaire de l'autorité parentale (art. 8 + loi Informatique et Libertés).
Le minimum praticable : une **date de naissance à l'inscription**, un message
clair sous 15 ans, et une politique de confidentialité en langage simple. La
colonne `birthday` existe déjà (avec un défaut `1990-05-15` qui, lui, ne veut
rien dire et devra sauter).

**6. L'identité du responsable de traitement n'est pas donnée.**
La politique renvoie à « l'adresse de contact indiquée sur la fiche de
l'application ». Il faut un **nom** (personne physique ou association) et une
**adresse de contact directe** dans la page elle-même — c'est explicitement
exigé (art. 13). Pas besoin de DPO ici (aucun des trois critères de l'art. 37
n'est rempli), mais il faut quelqu'un à qui écrire.

**7. Pas de registre des traitements (art. 30).**
L'exemption « moins de 250 personnes » ne joue pas : le traitement est
**régulier**. Le registre est un tableau, pas un logiciel — une page par
traitement (compte, jeu, chat, forum, modération, notifications), avec
finalité, base légale, catégories de personnes et de données, destinataires,
durées, mesures de sécurité. Une demi-journée de rédaction.

**8. Pas de procédure de violation de données (art. 33-34).**
Obligation : notifier la CNIL sous **72 h**. Il faut au minimum une page qui
dise qui prévenir, comment évaluer la gravité, et où est le formulaire.

**9. Le transfert hors UE n'est pas documenté.**
Render héberge en Europe **si la région choisie l'est** (Frankfurt). À
vérifier et à écrire ; sinon, il faut nommer les garanties (clauses
contractuelles types). Idem pour Resend (société américaine).

**10. Détails de la politique à corriger.**
   - elle ne cite pas les champs de la fiche (nom, prénom, date de naissance,
     ville, métier) — ce sont pourtant les plus personnels du lot ;
   - elle ne cite ni YouTube ni Resend ;
   - elle ne mentionne pas les droits d'accès, de rectification, d'opposition,
     de limitation, ni **le droit de réclamation auprès de la CNIL** (obligatoire).

### 🟢 Non applicable ici

- **Bandeau cookies** : le site n'utilise que `localStorage` pour la session et
  l'affichage — strictement nécessaire, donc exempté. Il ne le deviendra que si
  l'on ajoute de la mesure d'audience ou si l'on garde l'embarquement YouTube
  actuel (cf. point 1).
- **AIPD** (analyse d'impact) : pas de profilage, pas de données sensibles, pas
  de surveillance systématique — sauf si le public mineur devient un axe assumé,
  auquel cas elle se discute.
- **DPO** : non requis.

---

## 3. Ce qui a été fait — et ce qui reste à l'humain

Tout ce qui relève du code est en place (commit « mise en conformité RGPD »).
Point par point, en reprenant la numérotation du § 2 :

| # | point | état |
|---|---|---|
| 1 | YouTube | **fait** — `youtube-nocookie.com`, et le lecteur n'est chargé qu'au clic sur « Écouter » (light et bureau) ; « Couper » retire le lecteur et le consentement |
| 2 | export et suppression | **fait** — *Réglages → Mes données* : `GET /api/light/mes-donnees` (un JSON, table par table) et `POST /api/light/compte/suppression` (code secret, 7 jours de grâce, une reconnexion annule) ; l'admin et le joueur passent par le même `supprimerJoueurPartout`, qui anonymise ce qui reste (« compte_supprime ») |
| 3 | bases légales et durées | **fait** — deux tableaux dans `/confidentialite` |
| 4 | purges | **fait** — `rgpdBalayage()` toutes les heures : comptes inactifs (3 ans, préavis e-mail 35 j avant), IP et jeton d'inscription (6 mois), journaux de modération (1 an), sessions (6 mois), jetons de réinitialisation (7 j). Durées réglables (`RGPD_*_JOURS`, cf. README) ; `POST /api/admin/rgpd/balayage` pour le lancer à la main |
| 5 | âge | **fait, autrement** — l'inscription ne le demande PAS (cf. ci-dessous) : la règle est déclarée, l'écran le dit. Le défaut `1990-05-15`, qui donnait un âge inventé à tout le monde, est supprimé ; la date reste facultative dans la fiche ; l'âge n'est plus montré avant 18 ans, et la date de naissance plus jamais — les trames de présence envoyaient la date exacte de chacun à tout le salon |
| 6 | responsable | **à faire par vous** — poser `RGPD_RESPONSABLE` (un nom) et `RGPD_CONTACT` (un e-mail) dans l'environnement ; sans eux le serveur l'écrit au démarrage |
| 7 | registre | **fait** — `rgpd/registre-des-traitements.md` (dix fiches), à relire à chaque nouvelle fonctionnalité |
| 8 | violation | **fait** — `rgpd/procedure-violation.md` |
| 9 | transferts | **à vérifier par vous** — la région de l'hébergeur doit être européenne (Render : Frankfurt) ; Resend et le push sont documentés dans le registre |
| 10 | politique | **fait** — champs de la fiche, tiers, droits, CNIL, mineurs, sécurité |

### L'âge : pourquoi on ne le demande pas

Première version : date de naissance obligatoire à l'inscription et case
« un parent est d'accord » sous quinze ans. **Retiré**, et c'est plus juste
ainsi.

Le raisonnement : le parc s'adresse à ceux qui l'ont connu — un public de
trentenaires et de quarantenaires. Exiger une date de naissance de TOUT LE
MONDE pour attraper le mineur qui passerait, c'est collecter une donnée de plus
chez tous les autres — l'inverse de la minimisation, que l'article 5 pose comme
principe (« adéquates, pertinentes et limitées à ce qui est nécessaire »). Le
RGPD n'impose d'ailleurs nulle part de VÉRIFIER l'âge : l'article 8 ne joue que
pour un service **offert directement à des enfants**, et il demande des efforts
« raisonnables », pas une pièce d'identité. Un site de nostalgie n'est pas dans
ce cas.

La règle est donc **posée, pas mesurée** : l'écran d'inscription et la politique
de confidentialité disent que le parc s'adresse aux adultes et qu'avant quinze
ans il faut l'accord d'un parent. Rien n'est collecté pour le vérifier.

Ce qui reste du travail sur l'âge, et qui vaut la peine :

* la date de naissance est **facultative**, dans la fiche, comme avant ;
* le défaut `1990-05-15` posé d'office sur chaque compte a disparu — il donnait
  le même âge inventé à tout le monde ;
* les autres n'en voient que l'**âge**, jamais la date, et **rien avant
  18 ans** ;
* et sans date, les clients n'affichent plus « 0 ans » mais rien du tout.

**Le risque assumé**, pour qu'il soit dit : le parc *ressemble* à un site pour
enfants, et un regard extérieur pourrait le lire ainsi. Si le public changeait —
si des enfants s'y inscrivaient vraiment —, la question se reposerait, et la
réponse serait alors la case, pas la collecte pour tous.

Trois choses ne peuvent pas venir du code :

1. **`RGPD_RESPONSABLE` et `RGPD_CONTACT`** — dix secondes dans le tableau de
   bord de l'hébergeur, et c'est le point que la CNIL regarde en premier.
2. **La région de l'hébergement** — à vérifier une fois.
3. **Le fichier `rgpd/violations.md`** — à créer le jour où il servira, en
   suivant la procédure.

Et une décision à garder en tête : l'effacement des comptes inactifs est
**actif**, à trois ans. Sur un site où les gens reviennent après des années,
c'est le réglage le plus lourd de conséquences de toute cette liste. Il se
suspend d'une variable (`RGPD_PURGE_INACTIFS=0`) et s'allonge d'une autre
(`RGPD_INACTIVITE_JOURS`) — mais la politique de confidentialité annonce trois
ans, et doit être relue si on en change.

---

*Dernière revue du code : septembre 2026.*
