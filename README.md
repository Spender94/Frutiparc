# Frutiparc

This repository hosts a small server used to serve the assets of the
**Frutiparc** Flash game.  The game expects to communicate with a web
server running on `localhost:8888`.

## Running the game

1. Install the dependencies:
   ```bash
   npm install
   ```
2. Start the HTTP server (defaults to port `8888`):
   ```bash
   npm start
   ```
   On Windows you can run the `public/start.bat` script which launches the same
   server. The batch file now automatically switches to its own directory so it
   can be invoked from anywhere.
   You can change the port by setting the `PORT` environment variable if
   necessary.
3. Open your browser at [`http://localhost:8888/`](http://localhost:8888/).
   This is now a first portable UI shell inspired by Frutiparc desktop (no Ruffle, no `main.swf`).
4. For legacy Flash facade, open [`http://localhost:8888/legacy`](http://localhost:8888/legacy).

Legacy SWF is only exposed via `/legacy/main.swf`.


## Tester la version portée (sans Ruffle / sans `main.swf`)

Tu peux tester la version Node des modules portés via l'endpoint MVP:

```bash
curl http://localhost:8888/api/mvp/showcase
```

Cet endpoint exécute les modules portés (`feString`, `feColor`, `statusMng`, `classLoader`)
et renvoie un JSON de démonstration.


## Déploiement public

Un blueprint Render est fourni via `render.yaml` pour exposer publiquement l'API Node MVP.
Voir `docs/DEPLOY_NODE_MVP.md`.
