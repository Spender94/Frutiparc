# Frutiparc

Code source de **Frutiparc**, un site de jeux Flash des années 2000,
émulé dans le navigateur grâce à [Ruffle](https://ruffle.rs/).

Le serveur Node.js reconstitue la logique backend originale (endpoints HTTP
+ serveur XMLSocket pour le chat temps réel) afin que le SWF fonctionne
comme à l'époque.

## Lancer le projet

1. Installer les dépendances :
   ```bash
   npm install
   ```
2. Démarrer le serveur (port `8888` par défaut) :
   ```bash
   npm start
   ```
3. Ouvrir [`http://localhost:8888/`](http://localhost:8888/) dans le navigateur.
4. Cliquer sur **Entrer dans Frutiparc** pour lancer le SWF via Ruffle.
5. Pour tester le flux auth simple : ouvrir [`/login`](http://localhost:8888/login) (création de compte + connexion).
6. Les comptes créés sont modérateurs par défaut (chat): `!message` (rouge gras), `/kick pseudo`, `/totoch pseudo`.

## Préparer une mise en ligne (checklist)

### 1) Nettoyer le mode debug et les valeurs hardcodées

Le serveur supporte maintenant des variables d'environnement pour éviter de
laisser des valeurs de dev en dur :

- `PORT` (défaut `8888`)
- `XMLSOCKET_PORT` (défaut `5000`, idéalement un port se terminant par `000`)
- `PUBLIC_HOST` (optionnel, override explicite du domaine public)
- `VERBOSE_HTTP_LOGS=1` pour activer les logs HTTP verbeux
- `VERBOSE_SWF_LOGS=1` pour activer les logs SWF verbeux

`PUBLIC_HOST` est optionnel : si non défini, le serveur essaie d'utiliser le host
de la requête (`x-forwarded-host` / `host`) pour `xml/services.xml`.

Version Node recommandée pour l'hébergement:
- `.node-version` : `20.18.0`
- `package.json` : `"engines": { "node": ">=20 <22" }`

Exemple de lancement "quasi-prod" en local :

```bash
PUBLIC_HOST=frutiparc.example.com \
npm start
```

### 2) Déployer sur un serveur

1. Prendre un VPS (Debian/Ubuntu) et pointer le DNS de ton domaine vers l'IP.
2. Installer Node.js LTS (v20+ recommandé) et cloner ce dépôt.
3. Installer les dépendances (`npm install`).
4. Lancer avec variables d'environnement (ou via `systemd`/PM2).
5. Mettre un reverse proxy Nginx devant l'app (HTTP + WebSocket).
6. Activer HTTPS via Let's Encrypt (certbot).
7. Vérifier l'accès public :
   - `https://ton-domaine/`
   - `https://ton-domaine/xml/services.xml`
   - et la connexion chat (WebSocket bridge + XMLSocket backend)

### 2 bis) Déploiement sur Render (oui, ça peut le faire)

Tu peux déployer ce repo sur **Render Web Service** sans VPS manuel :

1. Push ton code sur GitHub/GitLab.
2. Sur Render: **New +** → **Web Service** → connecter le repo.
3. Configuration:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Variables d'environnement Render:
   - `PORT` = (laisse Render injecter automatiquement; ne pas forcer une valeur fixe)
   - `PUBLIC_HOST` = ton domaine Render (ex: `mon-app.onrender.com`) ou ton domaine custom
   - `VERBOSE_HTTP_LOGS` = vide (ou `0`)
   - `VERBOSE_SWF_LOGS` = vide (ou `0`)
   - **RGPD** (voir `RGPD.md` et `rgpd/`) :
     - `RGPD_RESPONSABLE` = le nom du responsable du traitement (personne ou association) — **obligatoire** pour que `/confidentialite` soit en règle (art. 13)
     - `RGPD_CONTACT` = l'adresse e-mail où exercer ses droits — **obligatoire** aussi
     - `RGPD_GRACE_JOURS` (défaut 7) : délai entre la demande de suppression d'un compte et son effacement
     - `RGPD_INACTIVITE_JOURS` (défaut 1095, soit 3 ans) : un compte sans connexion depuis ce délai est supprimé
     - `RGPD_PREAVIS_JOURS` (défaut 35) : l'avertissement par e-mail part ce nombre de jours avant
     - `RGPD_PURGE_INACTIFS` = `0` pour suspendre l'effacement des comptes inactifs (le préavis part quand même)
     - `RGPD_IP_JOURS` (défaut 183), `RGPD_MODERATION_JOURS` (défaut 365), `RGPD_SESSIONS_JOURS` (défaut 180) : les autres rétentions
     - Changer une durée impose de relire `public/confidentialite.html`, qui les annonce.
   - Choisir une **région européenne** (Frankfurt) : les données ne doivent pas quitter l'Union sans garantie.
5. Déployer et attendre le statut **Live**.
6. Tester:
   - `https://mon-app.onrender.com/`
   - `https://mon-app.onrender.com/xml/services.xml`
   - login + chat + inventaire

Notes Render:
- Render expose le service en HTTPS public pour la partie web (Ruffle + API).
- Le serveur XMLSocket peut rester interne au process (bridge WS/TCP local).
- En production web, privilégier `wss://` (si la page est en HTTPS).
- Si tu utilises le plan free, le spin-down peut rallonger le premier chargement.
- Le filesystem est éphémère par défaut: ne pas compter sur des écritures locales persistantes.

### 3) Vérifs avant partage à d'autres testeurs

- Vérifier le flux compte: créer un compte via `/login`, puis entrer dans `/legacy?sid=...`.
- Couper les logs verbeux (`VERBOSE_HTTP_LOGS` / `VERBOSE_SWF_LOGS` non définis).
- Vérifier que `PUBLIC_HOST` est bien ton domaine public.
- Contrôler les assets SWF critiques (pas de stubs de quelques octets).
- Tester depuis un autre réseau (4G, machine externe) pour valider le vrai parcours utilisateur.

## Architecture

```
server.js             Serveur Express (HTTP :8888) + XMLSocket CBee (:5173)
public/               Fichiers statiques (HTML, SWF, XML, crossdomain)
public/ruffle.html    Page Ruffle qui charge legacy/main.swf
legacy/main.swf       SWF principal de Frutiparc
frutiengine/          Code source ActionScript 2 du moteur
frutiparc/            Code source AS2 de l'application principale
frusion/              Système réseau (client/serveur Flash)
Games/                Mini-jeux (Burning Kiwi, Kaluga, Frutibandas, etc.)
```

## Le mode nuit (« Son temps viendra »)

Un thème sombre pour `/light`, vendu en boutique (rubrique **Décors**, 300
kikooz, article `42`). Il s'allume dans **Réglages → « Le parc, la nuit »**,
avec trois positions : Jour, Nuit, Comme mon téléphone. Le choix vit dans le
`localStorage` (donc **par appareil**) ; la possession, elle, est au compte
(`owned_features`, option `modeNuit`, lue par `/api/features`).

**La feuille de nuit est engendrée, pas écrite.** Les trois feuilles du site —
le `<style>` de `public/light.html`, `public/bureau-frutiz.css`, le `<style>`
de `public/fb/index.html` — comptent près de mille huit cents couleurs en dur
et pas une variable CSS. `scripts/generer-nuit.js` les relit, fait passer
chaque couleur par une conversion, et écrit deux feuilles de **surcharge** :

```
node scripts/generer-nuit.js              écrit public/nuit.css et public/fb/nuit.css
node scripts/generer-nuit.js --verifier   n'écrit rien, sort 1 si elles sont périmées
```

> **Toute retouche du thème de jour demande de relancer le générateur.**
> `test/modeNuit.test.js` échoue si on l'oublie.

### La conversion

Elle renverse la **clarté** selon le **rôle** de la couleur, lu dans le nom de
la propriété : un fond descend, un texte monte, une bordure se pose entre les
deux, une ombre déjà sombre ne bouge pas. Et elle rejoue la **teinte** par
famille :

| Famille | Ce qu'elle devient | Pourquoi |
|---|---|---|
| les verts et les gris — le **châssis** | **violet** (256°) | c'est ce qui fait la nuit *violette* plutôt qu'un parc vert éteint |
| le **parchemin** (17°→70°), *en CSS seulement* | **violet** aussi, nivelé sur le vert | le parc ne s'habille pas qu'en vert : Scores, Messagerie, Mes disques et l'inventaire sont crème et or. Gardés jaunes, ils sortaient **olive** au milieu d'un parc violet |
| la famille **rose/rouge** (335°→16°) | **rose** (325°) — vif en texte, glyphe et liseré, prune profonde en aplat | l'accent qui empêche le violet de tourner au monochrome |
| les bleus, les cyans — les **accents** | teinte gardée | un voyant bleu violet ne serait plus un voyant |
| **tout, dans un dessin** | teinte gardée | un orange y est une orange : celle de l'onglet, le fruit du Frusion, le « swap » jaune |

Le parchemin est **nivelé sur le vert** avant conversion : relevé sur les
aplats des trois feuilles, le vert a une clarté médiane de 78 %, le parchemin
de 69 %. Comme la courbe *renverse* la clarté, le parchemin — plus sombre le
jour — ressortait plus **clair** la nuit : corps de fenêtre à 20 %, grille de
l'inventaire à 33 %, dans la même fenêtre. On le remonte donc de ces neuf
points avant la courbe, et les deux décors ressortent au même étage.

Une seule chose qu'aucune règle de couleur ne peut sauver : **l'arc-en-ciel du
feutre multicolore**. Il ne vaut que par la *suite* de ses teintes, et la
conversion, qui ne regarde qu'une couleur à la fois, en perdait trois d'un
coup. Il est reposé entier dans `scripts/nuit-retouches.css`.

**L'invariant, et il est arithmétique** : aucun fond au-dessus de `0,078` de
luminance, aucun texte en dessous de `0,654`. Les deux bornes sont choisies
pour que le **pire couple possible** tienne 5,5:1 — donc un texte illisible
n'est pas improbable, il est *impossible*, y compris pour des couleurs pas
encore écrites. En **luminance** et non en clarté : `hsl(60 50% 26%)` et
`hsl(256 30% 26%)` annoncent la même clarté, mais l'œil voit le jaune deux fois
plus lumineux. Mesuré au navigateur sur huit écrans : **95 textes sous 4,5:1 de
jour, 0 la nuit**.

### Les dessins gardent leurs couleurs

**Seul le châssis s'éteint** — les cadres de fenêtre, les onglets, l'écran de
la main bar, le boîtier du Frusion : des surfaces qui n'illustrent rien. Les
fruits du bureau, les bouilles des émotions, les pictos du forum et la bouille
du joueur restent en couleur. Un mode sombre, pas un mode terne.

### Les dessins de châssis : `nuit-svg.js`

Un filtre CSS assombrit un sprite, mais mal : il ternit tout de la même main,
écrase les reliefs, et ne sait pas qu'un liseré doit rester un liseré. Ces
dessins-là sont des SVG — leurs couleurs sont donc lisibles, et on peut leur
appliquer **la conversion du thème elle-même** :

```
node scripts/nuit-svg.js              écrit les variantes de nuit
node scripts/nuit-svg.js --verifier   sort 1 si elles sont périmées
```

Le **manifeste** en tête du script dit ce qui est du châssis : l'écran de
l'aquarium, la boîte et les bandes de la liste des connectés, le cadre des
fenêtres et les onglets, le lecteur Frusion, les quatre boutons du salon, la
languette CONTACTS, le frutimandala et ses commandes, la boutique, l'encart de
la main bar et la barre de contacts. Ce qui n'y est pas garde
ses couleurs — c'est le bon défaut. Deux exclusions sont délibérées et
commentées : le reflet de l'écran (deux traits blancs qui font le verre), et
les **pastilles de présence**, dont la couleur est une *information* et non une
décoration.

Un dessin n'est pas qu'une liste de couleurs, et le manifeste porte donc deux
nuances que le fichier ne peut pas dire tout seul :

| Drapeau | Ce qu'il change | Pour qui |
|---|---|---|
| `blanc: 'teint'` | le blanc pur s'éteint au lieu d'être gardé | les onglets, la languette CONTACTS, le boîtier du Frusion — là où le blanc est la **face**, pas une marque |
| `teintes: 'gardees'` | seuls les **neutres** s'éteignent, toute couleur reste la sienne | les commandes : triangles rouges, swap jaune, valider vert, croix et « ? » du bandeau de fenêtre |
| `teinte: 'glyphe'` \| `'voyant'` | le dessin prend une teinte **énoncée** au lieu d'être converti | les pictogrammes de l'encart et leurs voyants (voir plus bas) |
| `role: 'texte'` | le dessin passe par la courbe du **texte** | « NIV », qui se lit d'un tenant avec le numéro qui le suit |
| `famille: 'commande'` | le dessin passe par la branche **rose**, celle des boutons | « Acheter » de la boutique : vert le jour, donc rangé avec le châssis, donc violet sombre sur un panneau violet — l'air d'un bouton **désactivé** |
| `dossier: FB` | le dessin vit dans `public/fb/` et non dans `frutiz/sprites/` | les pièces de la main bar |

**Un voyant s'inverse.** Les six raccourcis de l'encart ont deux états, et le
thème de jour signale en **fonçant** — vert clair au repos, vert sombre allumé,
sur un panneau vert pâle. Sur un panneau de nuit c'est le contraire : on
signale en s'éclairant. Aucune conversion couleur→couleur ne peut le voir (elle
regarde une couleur à la fois, et toutes les courbes gardent la hiérarchie
d'origine) : le voyant allumé serait ressorti plus *sombre* que le voyant au
repos, c'est-à-dire éteint. Ces dessins n'ayant qu'une seule couleur, il n'y a
rien à convertir — juste une teinte à **donner**, et le thème dit laquelle.

Deux accords s'obtiennent alors sans les écrire : le fond de la bouille est le
**même dessin** que l'écran de l'aquarium (mêmes verts, même dégradé), donc la
même conversion leur donne la même nuit ; et « NIV », converti au rôle `texte`
depuis la même couleur d'origine que le numéro qui le suit, en ressort à la
teinte exacte de ce numéro.

Le premier vient d'un défaut visible : un blanc pur reste blanc par défaut,
parce que dans ces dessins c'est presque toujours un glyphe ou un liseré — et
c'est ce qui sauve la tête de mort des boutons du salon. Sur un onglet, non :
la face est blanche, et deux onglets restaient en plein jour au-dessus d'un
bureau éteint.

Le second vient d'un autre : une **commande se reconnaît à sa couleur**. La
conversion range le rouge avec les roses (les triangles viraient au magenta) et
le vert avec le châssis, puisque le vert est la couleur du parc de jour — le
bouton « valider » virait au violet, et trois boutons de trois couleurs
devenaient trois boutons identiques. Un dessin qui n'a *que* de la couleur —
la croix, le trait, le « ? » du bandeau — reçoit tout de même sa variante, à
l'identique : sans elle, la feuille de nuit le prendrait pour un dessin oublié
et lui poserait le filtre du châssis.

**La courbe des dessins ne plafonne plus.** Elle était coupée à 38 % de clarté :
de `#888888` au noir, toute la moitié sombre de la rampe des gris sortait sur
cette seule valeur. Un bouton du Frusion, c'est un anneau et un pictogramme —
les deux en sortaient de la même couleur, et le pictogramme disparaissait.
Au-delà de 38 elle **comprime** désormais au lieu de couper : ce qui était clair
ne bouge pas d'un cheveu, ce qui était sombre s'étale jusqu'à 61 %. Le trait
redevient un liseré clair sur une face sombre. Et le relief d'un dessin échappe
au plafond de luminance des fonds — ce plafond vaut pour une surface qui porte
du texte, pas pour l'arête censée la détacher.

La **roue du frutimandala** est le cas limite : ses fruits sont peints *sur*
ses quartiers. Sa portée est donc réduite au premier groupe du SVG — les deux
tracés des quartiers —, et les fruits n'y bougent pas d'un pixel. Roue sombre,
fruits en couleur : ce qu'aucun filtre ne pouvait donner.

Reste un cas qu'aucun outil ne sauve : **les deux dossiers du forum**
(`folder_big.gif`, `folder_big_new.png`) sont des GIF **opaques** au vert
`#D6F7B5`, et leur plaque court sur toute la hauteur de la page. Baisser leur
luminosité rend le vert sombre, pas violet : ce sont les deux seuls dessins
qu'on éteint vraiment. Un `folder_big-nuit.png` **sans fond** règle la question.

### Redessiner les assets : `nom-nuit.svg`

Pour remplacer un dessin d'époque :

> déposer **`nom-nuit.svg` à côté de `nom.svg`**, relancer le générateur.

Il prend la place de l'original partout (CSS, `<img src>`, fonds posés depuis
le JavaScript) et **échappe au filtre**. Aucune liste à tenir, aucun code à
toucher : le fichier sur le disque *est* la déclaration. Deux règles en
dessinant : même `viewBox` et mêmes dimensions que l'original, et les états
`_up`/`_over`/`_down` vont par trois.

### Les fonds d'écran de nuit : `background_<nom>_dark.jpg`

Même convention que `nom-nuit.svg`, pour la même raison : **le nom du fichier
déclare la variante**, il n'y a pas de liste à tenir. Déposer dans
`public/fb/boutique/` —

| Fichier | Où il sert |
|---|---|
| `background_<nom>_dark.jpg` | le **paysage** de nuit — bureau large |
| `background_<nom>_dark_mobile.jpg` | le **portrait** de nuit — tiroir de `/light` |

— et le fond passe en version nocturne dès que le parc s'éteint. `<nom>` est
le libellé du fond en minuscules sans accents ni apostrophes (« Ceci n'est pas
une pipe » → `ceci_nest_pas_une_pipe`), sauf les deux Mini-Wave, nommés
explicitement dans `WALLPAPER_MOBILE_EXCEPTIONS`.

**Le décor par défaut** — ce que la nuit pose quand le joueur n'a choisi aucun
fond, l'équivalent du vert pomme du jour — est **Utopiz endormie**
(`FOND_DECOR_NUIT`). Elle tient déjà tout ce que la présentation d'époque
promettait : le gros ciel nuageux, la lune blafarde, et jusqu'aux petits fruits
qui dorment. Le bureau large la pose en `cover`, cadrée un peu haut pour garder
la lune sur un écran très large ; le ciel de dégradés (`--nuit-ciel`) reste
dessous et reprend seul si l'image manque. Le tiroir de `/light`, lui, garde ce
ciel tant que le **portrait** n'est pas dessiné — un paysage y rentrerait en
timbre au milieu.

Sans variante, un fond reste tel quel : mieux vaut l'illustration de jour qu'un
aplat vide. Deux exceptions déclarées dans `WALLPAPER_NUIT_OK` : les deux
**Mini-Wave** sont déjà des ciels étoilés (leur couleur de bureau est un bleu
nuit), rien à redessiner. L'onglet **Fonds d'écran** de l'admin porte l'état de
chacun — « dessin de nuit », « déjà nocturne », « à redessiner » — avec la
vignette de nuit à côté de celle du jour.

### Ouvrir le rayon quand on est prêt

Un thème se juge sur un vrai parc, pas sur une capture. **L'article part donc
retiré du rayon** (`disabled: true` dans sa définition) : au premier démarrage
il n'est en vente pour personne. Deux gestes, dans l'admin :

| Où | Quoi | Effet |
|---|---|---|
| **Boutique**, ligne `42` | « Réactiver » / « Désactiver » | ouvre ou referme la **vente** |
| **Détail joueur** → « Mode nuit » | « Donner » / « Retirer » | accorde l'**option** à une personne, sans caisse |

Ce qui permet de faire essayer à quelques-uns pendant que le rayon est encore
fermé : la possession vit dans `owned_features`, jamais dans le catalogue —
`/api/features` ne regarde que le compte. Refermer le rayon **ne reprend rien**
à ceux qui l'ont déjà.

La bascule est persistée (`shop_packs.disabled`) et **survit au redémarrage** :
au boot, la ligne de la base écrase la définition statique, et seuls les champs
que la base ne sait pas porter (`gameFeature`, `notDefault`, `picto`) sont
réappliqués par-dessus. Y ajouter `disabled` referait le rayon tout seul à
chaque relance — `test/modeNuit.test.js` monte la garde.

Enfin, « Pousser à tous » et « Retirer à tous » **ne s'affichent pas** sur cet
article, et les deux routes le refusent : elles écrivent dans les inventaires,
et une option de jeu n'y a rien à faire — elles y déposeraient un accessoire
fantôme sans rien accorder. Même chose pour les feutres, les pass et les
récompenses ; une pastille dit par où passer.

### Le reste

Les corrections que la conversion ne peut pas trouver — le ciel et la lune, qui
n'existent nulle part dans le thème de jour — vivent dans
`scripts/nuit-retouches.css` et `scripts/nuit-retouches-forum.css`, recopiées à
la fin des feuilles engendrées. Ce qui reste **en couleur**, volontairement :
les bouilles (dessinées dans un `<canvas>`), les fonds d'écran achetés, et les
jeux — les teinter abîmerait la lisibilité de jeu et la fidélité d'époque.

## Endpoints HTTP

| Route | Rôle |
|---|---|
| `do/init` | Initialisation de session |
| `do/prefdef` | Définitions des préférences |
| `do/mypref` | Préférences utilisateur |
| `do/prefsave` | Sauvegarde des préférences |
| `do/onident` | Données post-identification |
| `ff/tree` | Arbre des dossiers virtuels |
| `ff/ls` | Contenu d'un dossier |
| `ff/mk` `ff/mv` `ff/cp` `ff/erb` `ff/dm` | Opérations sur fichiers |

## Renommer un joueur

Admin → **Utilisateurs** → *Renommer*. Ce qui suit vaut d'être connu avant de
cliquer.

**Ce qui rend l'opération sûre :** presque tout ce qui appartient à un joueur
est rangé sous son **numéro de compte** (`user_id`) — scores, accessoires,
objets, contacts, journaux, courriers reçus, quotas, préférences. Renommer n'y
touche pas.

**Ce qui est balayé**, parce que la ligne désigne le joueur par son pseudo sans
lui appartenir : le carnet et la liste noire des **autres**, l'auteur d'un sujet
ou d'un message du forum, les sujets suivis et lus, l'expéditeur d'un courrier
(et son adresse, et les listes de destinataires), les médailles, les archives du
challenge, les achats et reventes en boutique, les dons de kikooz, les tournois,
le trombinoscope, les abonnements aux notifications, les journaux de modération,
la signature d'un accessoire maison, et le parrain de ses filleuls. Côté
serveur : les tables en mémoire et les quatre fichiers de travail
(`scores.json`, `xp-actions.json`, `challenge-medals.json`,
`acc-maison-equip.json`). La base fait sa part **en une transaction** —
`db.renommerJoueur`, dont la liste de colonnes est le contrat ; toute nouvelle
colonne de pseudo doit y être ajoutée (et à `test/renommage.test.js`).

**Ce qui ne bouge pas :** le **texte**. Un message du forum qui dit « merci
bob », un courrier, une ligne d'historique (« 10 kikooz obtenus par bob »)
racontent ce qui s'est passé quand il s'appelait ainsi.

**Deux conséquences à annoncer au joueur :** il est **déconnecté** (il revient
sous son nouveau nom — c'est ce qui évite de recoudre l'état vivant en vol), et
son **ancien pseudo est réservé** comme celui d'un compte supprimé : personne ne
pourra s'en emparer et hériter de son passé aux yeux des autres.

## Application mobile (/light installable)

`/light` est une PWA : elle s'installe sur l'écran d'accueil et envoie des
notifications push (courrier, messages privés, événements du site).

**Côté joueur :**
- **Android (Chrome)** : ouvrir `/light` → menu ⋮ → « Installer l'application »
  (ou la bulle d'installation). Puis, dans l'appli, pied de l'accueil →
  « Activer les notifications ».
- **iPhone/iPad (iOS 16.4+)** : Safari → Partager → « Sur l'écran d'accueil »,
  puis ouvrir **l'appli** (pas Safari) et activer les notifications. Sur iOS,
  le push n'existe que dans l'appli installée — la page l'explique d'elle-même.

**Côté serveur :** rien à configurer. La paire de clés VAPID est générée au
premier démarrage et conservée en base (`push_vapid`) ; les abonnements vivent
dans `push_subscriptions`. Optionnel : `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
(pour partager la clé entre instances) et `VAPID_CONTACT` (mailto: ou https:).
**Ne jamais régénérer la clé** : tous les abonnements existants tomberaient.

**La règle d'envoi :** on ne pousse qu'aux joueurs **absents** — et « absent »
se mesure à la **fraîcheur**, pas à l'existence d'une socket : une appli
suspendue garde sa connexion ouverte des heures sans rien dire. Une socket ne
compte comme présence que si elle a parlé récemment (`PRESENCE_FRESH_MS`,
130 s par défaut — le SWF ping toutes les 60 s, l'appli bat toutes les 25 s
quand elle est visible) et que l'appli ne s'est pas déclarée en arrière-plan
(`<e h="1"/>`, envoyé en quittant le premier plan). Notifications envoyées :
courrier, message privé, **défi Grapiz/Frutibandas** (la partie démarre
sur-le-champ !), **citation sur le forum** (`[quote=…]`, lien direct vers le
sujet), événements. Diagnostic : `/api/push/etat?sid=…` rend la présence
socket par socket et le journal des dernières décisions d'envoi. Le service
worker (`public/light-sw.js`) n'a **pas** de gestionnaire `fetch` : aucun
cache, il ne peut rien casser (jeux, Ruffle). Tests :
`test/appliMobile.test.js` et `test/citationsForum.test.js` (le faux
« téléphone » déchiffre réellement les charges, RFC 8291).

### Publier sur le Play Store (Android)

L'appli du store est une **Trusted Web Activity** : une coquille signée qui
affiche `/light` en plein écran. Le site reste la seule source — chaque mise en
ligne du site met à jour l'appli instantanément, sans nouvelle release.

1. **Côté serveur (déjà câblé).** Le domaine doit prouver qu'il connaît
   l'appli via `/.well-known/assetlinks.json`. Deux façons de l'alimenter :
   les variables `ANDROID_PACKAGE_ID` (ex. `app.frutiparc.twa`) et
   `ANDROID_CERT_SHA256` (empreintes séparées par des virgules), ou un fichier
   complet `data/assetlinks.json`. Sans lui, l'appli marche mais garde la
   barre d'adresse. La fiche Play exige aussi une politique de
   confidentialité publique : c'est `/confidentialite`.
2. **Compte Play Console** : 25 $, une seule fois
   ([play.google.com/console](https://play.google.com/console)). Un compte
   **personnel** créé récemment doit d'abord faire un **test fermé** (une
   vingtaine de testeurs pendant 14 jours — la console affiche le seuil
   exact du moment) avant d'ouvrir la production ; un compte organisation
   n'a pas cette contrainte.
3. **Empaqueter la PWA** : [PWABuilder](https://www.pwabuilder.com) (tout se
   fait dans le navigateur : entrer l'URL du site, choisir Android, il rend
   un `.aab` prêt à téléverser) ou `npx @bubblewrap/cli init` pour la ligne
   de commande. Garder l'ID de paquet choisi : il ne peut plus changer.
4. **Récupérer l'empreinte de signature.** Laisser Google signer (Play App
   Signing, le défaut). Après le premier envoi du `.aab` : Play Console →
   **Intégrité de l'appli** → certificat de la **clé de signature** — copier
   l'empreinte SHA-256 dans `ANDROID_CERT_SHA256` (ajouter aussi celle de la
   clé d'envoi, séparée par une virgule, pour tester le `.aab` en direct).
   Redéployer, vérifier `https://ton-domaine/.well-known/assetlinks.json`.
5. **La fiche** : icône 512 (déjà là : `public/images/appli/icone-512.png`),
   au moins 2 captures d'écran, descriptions, l'URL
   `https://ton-domaine/confidentialite`, puis les formulaires :
   classification du contenu, sécurité des données (voir la page
   confidentialité : compte, contenus, pas de pub ni traqueurs), et déclarer
   le contenu créé par les joueurs (chat/forum modérés, signalement).

**iOS/App Store** (plus tard, facultatif) : compte Apple 99 $/an + build
Xcode ; le push y passe par APNs et non Web Push — à câbler à ce moment-là ;
tout le reste (l'appli, l'écran, la reconnexion) est réutilisé tel quel.

## Serveur XMLSocket (CBee)

Le serveur TCP sur le port `5173` implémente le protocole CBee
(XML null-terminated) utilisé par le SWF pour le chat, la présence
et l'authentification.


## Dépannage rapide (frutibouilleur)

Si la fenêtre **Ma Frutibouille** affiche des champs à `undefined` ou un aperçu vide, le problème vient généralement des SWF d'assets manquants/incomplets (`public/swf/fbouille/famille*.swf`).

Dans ce dépôt, plusieurs SWF peuvent être des stubs (taille très faible, ex. ~17 bytes) : le client charge bien les URLs en HTTP 200, mais il n'y a pas de contenu exploitable côté Flash/Ruffle pour alimenter les libellés/visuels.

Au démarrage, `server.js` affiche maintenant un diagnostic `[ASSETS]` pour signaler explicitement ce cas.
