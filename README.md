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
