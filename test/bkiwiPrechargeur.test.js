/*
 * BURNING KIWI — LE PRÉCHARGEUR, ET LE TEMPS AU TOUR DU MODE FANTÔME.
 *
 * ── LES TROIS FIOLES DE NITRO ─────────────────────────────────────────────
 * Entre deux sections — le menu qui charge un circuit, le circuit qui charge
 * sa musique — le jeu montre un préchargeur : trois fioles de nitro qui se
 * VIDENT l'une après l'autre à mesure que les octets arrivent (preload.as,
 * `showProgress`). Deux choses l'empêchaient de jouer :
 *
 *   1. `nbPreloadIcons` n'était pas repris de gameData.as. Les deux boucles
 *      qui posent et remplissent les fioles tournaient donc sur `undefined`,
 *      c'est-à-dire zéro fois : les fioles restaient à leur première image,
 *      pleines, et rien ne bougeait jamais.
 *   2. La progression sautait de 0 à 100. `fetch(...).then(r => r.json())` ne
 *      rend la main qu'une fois le fichier ENTIER arrivé : `getBytesLoaded`
 *      valait zéro, puis le total, et le préchargeur disparaissait dans la
 *      même image. On lit donc le corps par morceaux (`K.telecharger`).
 *
 * LA TAILLE TOTALE, pour savoir où l'on va : `Content-Length` la donne, sauf
 * quand la réponse est compressée — et tous nos JSON le sont. Le serveur pose
 * donc `X-Taille-Reelle` (la taille sur le disque) sur ses fichiers statiques.
 *
 * ── LE TEMPS AU TOUR EN MODE FANTÔME ──────────────────────────────────────
 * « Sur le mode ghost, on ne voit pas quel temps on a fait à la fin de chaque
 *   tour, ce n'est pas indiqué en haut à gauche comme c'est le cas en
 *   Challenge ou timetrial. »
 *
 * L'indicateur permanent (`attachTimeLine`) ne se posait qu'en contre-la-
 * montre, en challenge et en essais. Le mode fantôme n'y figurait pas — son
 * bouton n'ayant jamais été posé dans le SWF, il ne figurait dans aucune de
 * ces listes. C'est pourtant une course contre le chrono : sans ses temps au
 * tour, on ne sait pas où l'on perd.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 1. LES DONNÉES DU PRÉCHARGEUR ───────────────────────────────────────── */

test('les trois fioles de nitro sont bien trois (gameData.as)', () => {
  const bac = { window: undefined, console };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(lire('public/bkiwi/jeu/donnees.js'), bac, { filename: 'donnees.js' });
  const M = {};
  bac.BkiwiJeu.initialiserDonnees(M);
  assert.strictEqual(M.nbPreloadIcons, 3, 'trois fioles, comme dans le fichier');
  assert.strictEqual(M.preloaderX, 175, 'docWidth / 2');
  assert.strictEqual(M.preloaderY, 205);
  // La règle de `showProgress` : chaque fiole couvre un tiers, et son liquide
  // descend de -12 à +7 sur ce tiers. Sans le compte, aucune de ces deux
  // boucles ne tournait.
  const tiers = 100 / M.nbPreloadIcons;
  const niveau = (pct, i) => -12 + ((pct - i * tiers) * 19) / tiers;
  assert.ok(Math.abs(niveau(0, 0) + 12) < 1e-9, 'pleine au départ');
  assert.ok(Math.abs(niveau(tiers, 0) - 7) < 1e-9, 'vide au bout du tiers');
});

/* ── 2. TÉLÉCHARGER EN DISANT OÙ L'ON EN EST ─────────────────────────────── */

// Le chargeur seul, hors navigateur : `K.telecharger` n'a besoin que de fetch.
function chargeur() {
  const bac = { window: undefined, console, fetch, TextDecoder, Uint8Array, Promise, Error, Number, Math, Object, JSON };
  bac.globalThis = bac;
  // Le module du son s'abonne aux gestes du joueur pour réveiller l'audio :
  // hors navigateur, il n'y a personne à écouter.
  bac.addEventListener = () => {};
  vm.createContext(bac);
  vm.runInContext(lire('public/kaluga/moteur/flash.js'), bac, { filename: 'flash.js' });
  vm.runInContext(lire('public/kaluga/moteur/son.js'), bac, { filename: 'son.js' });
  vm.runInContext(lire('public/kaluga/moteur/chargeur.js'), bac, { filename: 'chargeur.js' });
  return bac.KalugaMoteur;
}

let srv, base;
before(async () => {
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/lent') {
      // Cinq morceaux de mille octets, annoncés par X-Taille-Reelle — comme
      // un JSON compressé : pas de Content-Length, mais la taille réelle.
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Taille-Reelle': '5000' });
      let n = 0;
      const pousser = () => {
        if (n++ === 5) { res.end(); return; }
        res.write(Buffer.alloc(1000, 65));
        setTimeout(pousser, 12);
      };
      pousser();
      return;
    }
    if (u.pathname === '/muet') {          // ni l'un ni l'autre en-tête
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.write(Buffer.alloc(700, 66)); res.end(Buffer.alloc(300, 66));
      return;
    }
    if (u.pathname === '/biblio.json') {
      const corps = Buffer.from(JSON.stringify({ entete: { largeur: 100, hauteur: 100, cadence: 40 }, perso: {}, images: {}, fontes: {} }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Taille-Reelle': String(corps.length) });
      res.end(corps);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port + '/';
});
after(() => { if (srv) srv.close(); });

test('les octets sont rapportés au fil de l’eau, pas d’un coup à la fin', async () => {
  const K = chargeur();
  const vus = [];
  const buf = await K.telecharger(base + 'lent', (octets, total) => vus.push([octets, total]));
  assert.strictEqual(buf.byteLength, 5000, 'le fichier entier est bien rendu');
  assert.ok(vus.length >= 4, 'plusieurs relevés en cours de route : ' + vus.length);
  assert.deepStrictEqual(vus[0], [0, 5000], 'le total est connu dès le départ (X-Taille-Reelle)');
  assert.deepStrictEqual(vus[vus.length - 1], [5000, 5000], 'et l’on finit à cent pour cent');
  for (let i = 1; i < vus.length; i++) assert.ok(vus[i][0] >= vus[i - 1][0], 'la jauge ne recule jamais');
  const milieu = vus.slice(1, -1).some((v) => v[0] > 0 && v[0] < 5000);
  assert.ok(milieu, 'il y a bien eu des états INTERMÉDIAIRES — c’est tout l’objet');
});

test('sans taille annoncée, la jauge avance sans jamais promettre la fin', async () => {
  const K = chargeur();
  const vus = [];
  await K.telecharger(base + 'muet', (o, t) => vus.push([o, t]));
  for (const [o, t] of vus) assert.ok(o <= t, 'jamais plus de cent pour cent : ' + o + '/' + t);
  assert.deepStrictEqual(vus[vus.length - 1], [1000, 1000]);
});

test('un fichier introuvable jette, il ne rend pas une page d’erreur', async () => {
  const K = chargeur();
  await assert.rejects(() => K.telecharger(base + 'nexistepas', () => {}), /introuvable/);
});

test('une bibliothèque rapporte sa progression, et la même deux fois ne retélécharge pas', async () => {
  const K = chargeur();
  K.base = base.replace(/\/$/, '') + '/';
  // `chargerBiblio` cherche data/<nom>.json : on sert /biblio.json, donc on
  // vise « ../biblio » — ce qui revient au même fichier.
  const vus = [];
  const b = await K.chargerBiblio('../biblio', (o, t) => vus.push([o, t]));
  assert.ok(b, 'la bibliothèque est construite');
  assert.ok(vus.length >= 2, 'des relevés : ' + JSON.stringify(vus));
  const [o, t] = vus[vus.length - 1];
  assert.strictEqual(o, t, 'on finit à cent pour cent');
  const vus2 = [];
  const b2 = await K.chargerBiblio('../biblio', (o2, t2) => vus2.push([o2, t2]));
  assert.strictEqual(b2, b, 'la deuxième fois vient du cache');
  assert.deepStrictEqual(vus2, [[1, 1]], 'et se dit tout de suite complète');
});

/* ── 3. LE CÂBLAGE DANS LE JEU ───────────────────────────────────────────── */

const MOTEUR = lire('public/bkiwi/jeu/moteur.js');

test('le préchargeur du jeu est branché sur les octets réels', () => {
  assert.ok(/K\.chargerBiblio\(nom, avance\)/.test(MOTEUR), 'le circuit rapporte sa progression');
  assert.ok(/K\.audio\.charger\(nom, p\.fileInfos\.name, avance\)/.test(MOTEUR), 'la musique aussi');
  const f = /const avance = \(octets, total\) => \{[\s\S]*?\n    \};/.exec(MOTEUR);
  assert.ok(f, 'le rapporteur existe');
  assert.ok(/M\.preloadData !== p/.test(f[0]), 'un chargement remplacé ne rapporte plus rien');
  assert.ok(/p\.octets = octets/.test(f[0]) && /p\.total = total/.test(f[0]),
    'ce sont bien getBytesLoaded / getBytesTotal qu’il alimente');
});

test('le temps au tour s’affiche aussi en mode fantôme', () => {
  const bloc = /\/\/ Indicateur permanent de temps au tour[\s\S]*?J\.attachTimeLine\(car\.vs\.laps - 1[^\n]*\n\s*\}/.exec(MOTEUR);
  assert.ok(bloc, 'le bloc de l’indicateur permanent existe');
  for (const mode of ['M.TIMETRIAL', 'M.ARCADE', 'M.TRAINING', 'M.GHOSTRUN']) {
    assert.ok(bloc[0].indexOf('M.vs.gameMode == ' + mode) > 0, mode + ' doit y figurer');
  }
  // La ligne porte le numéro du tour, le temps, et l'écart au tour précédent.
  assert.ok(/J\.attachTimeLine\(car\.vs\.laps - 1, M\.temps, perfect, best, false, car\.previousLapTime\)/.test(bloc[0]));
});

/* ── 4. LE SERVEUR DIT LA TAILLE RÉELLE ──────────────────────────────────── */

const PORT = 3461;
const BASE = `http://127.0.0.1:${PORT}`;
let serveur;
before(async () => {
  serveur = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-de-test', XMLSOCKET_PORT: '5170', FRUTISCORE_PORT: '5171',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serveur.stdout.on('data', () => {});
  serveur.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(async () => { if (serveur) serveur.kill('SIGKILL'); await wait(200); });

test('un JSON compressé annonce quand même sa taille décompressée', async () => {
  const chemin = 'public/bkiwi/data/track00.json';
  const taille = fs.statSync(path.join(ROOT, chemin)).size;
  const r = await fetch(BASE + '/bkiwi/data/track00.json', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('X-Taille-Reelle'), String(taille),
    'la taille sur le disque, celle que le client verra défiler');
  // Et c'est bien le cas où Content-Length disparaît : sinon l'en-tête serait
  // superflu, et ce cas ne vaudrait rien.
  assert.strictEqual(r.headers.get('Content-Encoding'), 'gzip', 'la réponse est compressée');
  assert.strictEqual(r.headers.get('Content-Length'), null, 'donc sans Content-Length');
  const corps = await r.arrayBuffer();
  assert.strictEqual(corps.byteLength, taille, 'le corps décompressé fait bien cette taille');
  assert.ok(zlib.gzipSync(Buffer.from(corps)).length < taille, 'et il se compresse bien — d’où le problème');
});

test('l’en-tête est lisible depuis une autre origine', async () => {
  const r = await fetch(BASE + '/bkiwi/data/track00.json');
  const expose = r.headers.get('Access-Control-Expose-Headers') || '';
  assert.ok(/X-Taille-Reelle/i.test(expose), 'exposé au script : ' + expose);
});

test('les musiques du jeu l’annoncent aussi', async () => {
  const f = path.join(ROOT, 'Games/burningKiwi/bk00.mp3');
  if (!fs.existsSync(f)) return;                      // dépôt sans les musiques
  const r = await fetch(BASE + '/swf/games/burningKiwi/bk00.mp3');
  assert.strictEqual(r.headers.get('X-Taille-Reelle'), String(fs.statSync(f).size));
});
