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
