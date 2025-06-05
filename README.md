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
   You can change the port by setting the `PORT` environment variable if
   necessary.
3. Open your browser at [`http://localhost:8888/index.html`](http://localhost:8888/index.html).
   The page uses [Ruffle](https://ruffle.rs/) to load `main.swf`.  The
   `flashvars` parameter in `public/index.html` already sets
   `domain=localhost:8888/` so that the additional assets (e.g.
   `fileIcon.swf`) are loaded from the same server.

If everything is accessible, the progress bar shown by `main.swf` will
continue past 10 % and the game will start.
