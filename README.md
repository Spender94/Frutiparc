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

## Préparer une mise en ligne (checklist)

### 1) Nettoyer le mode debug et les valeurs hardcodées

Le serveur supporte maintenant des variables d'environnement pour éviter de
laisser des valeurs de dev en dur :

- `PORT` (défaut `8888`)
- `XMLSOCKET_PORT` (défaut `5000`, idéalement un port se terminant par `000`)
- `PUBLIC_HOST` (défaut `localhost`, doit pointer vers ton domaine public)
- `DEFAULT_USERNAME` (défaut `skool`)
- `DEFAULT_PASSWORD` (défaut `test`)
- `VERBOSE_HTTP_LOGS=1` pour activer les logs HTTP verbeux
- `VERBOSE_SWF_LOGS=1` pour activer les logs SWF verbeux

Version Node recommandée pour l'hébergement:
- `.node-version` : `20.18.0`
- `package.json` : `"engines": { "node": ">=20 <22" }`

Exemple de lancement "quasi-prod" en local :

```bash
PUBLIC_HOST=frutiparc.example.com \
DEFAULT_USERNAME=admin \
DEFAULT_PASSWORD='change-me-now' \
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
   - `DEFAULT_USERNAME` = un login de test non-public
   - `DEFAULT_PASSWORD` = un vrai mot de passe (pas `test`)
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

- Changer les identifiants par défaut.
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

## Serveur XMLSocket (CBee)

Le serveur TCP sur le port `5173` implémente le protocole CBee
(XML null-terminated) utilisé par le SWF pour le chat, la présence
et l'authentification.


## Dépannage rapide (frutibouilleur)

Si la fenêtre **Ma Frutibouille** affiche des champs à `undefined` ou un aperçu vide, le problème vient généralement des SWF d'assets manquants/incomplets (`public/swf/fbouille/famille*.swf`).

Dans ce dépôt, plusieurs SWF peuvent être des stubs (taille très faible, ex. ~17 bytes) : le client charge bien les URLs en HTTP 200, mais il n'y a pas de contenu exploitable côté Flash/Ruffle pour alimenter les libellés/visuels.

Au démarrage, `server.js` affiche maintenant un diagnostic `[ASSETS]` pour signaler explicitement ce cas.
