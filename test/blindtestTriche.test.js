'use strict';
/*
 * BLINDTEST : LE TITRE NE DOIT SE LIRE NULLE PART.
 *
 * « Triche sur les blindtests lors des quizz sur Anim : c'est possible
 *   d'obfusquer le nom de la vidéo youtube qui est montrée à certains via leur
 *   browser ou pas ? »
 *
 * Ce qui était déjà fermé (test/animateurs.test.js, test/blindtestSon.test.js) :
 * le salon ne reçoit qu'un jeton opaque, l'annonce ne nomme rien, le lecteur
 * youtube-nocookie part sans contrôles et tient dans un cadre d'un pixel à un
 * centième d'opacité.
 *
 * Ce qui restait ouvert, et que ces tests gardent :
 *
 *   1. LE NAVIGATEUR LUI-MÊME. Chrome (Edge, Brave, Android) affiche la session
 *      média du cadre le plus haut QUI JOUE — l'iframe YouTube, puisque la page
 *      ne jouait rien : la pastille « média en cours », la notification du
 *      téléphone et l'écran de verrouillage donnaient le titre, et les
 *      métadonnées anonymes que la page posait n'étaient jamais lues. Un
 *      LEURRE muet joué par la page tant que le lecteur est là la remet en tête.
 *   2. L'ADRESSE DU CADRE. Ouverte dans un onglet, elle menait à la page
 *      YouTube de la chanson. Elle ne sert plus qu'à un cadre de nos pages
 *      (Sec-Fetch-Dest / Sec-Fetch-Site).
 *   3. Le cadre du bureau se laissait viser (clic droit → « copier l'URL »).
 *
 * LA LIMITE, assumée : la lecture se fait dans le navigateur du joueur, qui
 * finit donc par charger la vidéo — l'onglet Réseau des outils de
 * développement montre la redirection, identifiant compris. Seul un son servi
 * par le serveur lui-même fermerait cette porte-là.
 *
 * Parties « navigateur » (Chromium) et « serveur vivant » (PostgreSQL de
 * test, port 5433) : sautées sans eux.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
const RUFFLE = fs.readFileSync(path.join(ROOT, 'public', 'ruffle.html'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// ── 1. Le leurre de session média ───────────────────────────────────────────

test('light et bureau : un leurre muet joue tant que le lecteur est là, et part du clic', () => {
  // Le light.
  assert.match(LIGHT, /function btLeurre\(actif\) \{/);
  assert.match(LIGHT, /btLeurre\(actif && !!btLecteur\(\)\);/, 'le leurre suit la présence du lecteur');
  assert.match(LIGHT, /btLeurreSon\.loop = true;/);
  const clic = LIGHT.slice(LIGHT.indexOf('function btClic() {'), LIGHT.indexOf('function btArmerRecours() {'));
  assert.match(clic, /btNommerLecteur\(true\);/, 'le clic lance le leurre (c\'est lui qui donne le droit de jouer)');
  // L'arrêt de l'extrait le coupe (btNommerLecteur(false) → btLeurre(false)).
  assert.match(LIGHT, /function arreterBlindtest\(parLeJoueur\) \{\s*btNommerLecteur\(false\);/);
  // Le bureau.
  assert.match(RUFFLE, /function leurre\(actif\) \{/);
  assert.match(RUFFLE, /leurre\(actif && !!document\.querySelector\("#bt-b-cadre iframe"\)\);/);
  assert.match(RUFFLE, /nommerLecteur\(true\);\s*\/\/ le leurre part du clic/);
});

test('bureau : le cadre du lecteur ne se laisse plus viser', () => {
  assert.match(RUFFLE, /id="bt-b-cadre" style="width:1px;height:1px;overflow:hidden;opacity:\.01;pointer-events:none"/);
  // Le light l'avait déjà.
  assert.match(LIGHT, /\.bt-cadre \{[^}]*opacity: \.01; pointer-events: none; \}/);
});

function chromium() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p).chromium; } catch { /* suivant */ }
  }
  return null;
}
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

test('navigateur : le leurre est un vrai son de plus de cinq secondes, qui joue en boucle', async (t) => {
  const c = chromium();
  if (!c || !fs.existsSync(CHROME)) return t.skip('Chromium/Playwright absent');
  // La fonction du light, telle qu'elle est écrite, avec un lecteur de doublure.
  const debut = LIGHT.indexOf('  var btLeurreSon = null;');
  const fin = LIGHT.indexOf('  function btNommerLecteur(actif) {');
  assert.ok(debut > 0 && fin > debut);
  const code = LIGHT.slice(debut, fin);
  const b = await c.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const p = await b.newPage();
    await p.setContent('<!doctype html><title>t</title>');
    const r = await p.evaluate(async (src) => {
      // eslint-disable-next-line no-new-func
      const f = new Function(src + '\nreturn { lancer: btLeurre, son: function () { return btLeurreSon; } };')();
      f.lancer(true);
      const a = f.son();
      await new Promise((res) => { if (a.readyState >= 1) res(); else a.addEventListener('loadedmetadata', res); });
      await new Promise((res) => setTimeout(res, 300));
      const enCours = !a.paused;
      f.lancer(false);
      return { duree: a.duration, boucle: a.loop, enCours, apres: a.paused, muet: a.muted };
    }, code);
    assert.ok(r.duree >= 5, 'plus de cinq secondes, sinon Chrome l\'ignore : ' + r.duree);
    assert.strictEqual(r.boucle, true);
    assert.strictEqual(r.enCours, true, 'le leurre joue');
    assert.strictEqual(r.muet, false, 'un lecteur MUET ne compte pas pour la session média');
    assert.strictEqual(r.apres, true, 'et s\'arrête avec l\'extrait');
  } finally { await b.close(); }
});

// ── 2. L'adresse du cadre n'est pas une page ────────────────────────────────

test('serveur : /api/blindtest/embed refuse une navigation d\'onglet et un autre site', () => {
  const route = SRV.slice(SRV.indexOf("app.get('/api/blindtest/embed'"), SRV.indexOf("app.get('/api/blindtest/state'"));
  assert.match(route, /if \(\(dest && dest !== 'iframe'\) \|\| \(site && site !== 'same-origin'\)\) \{\s*return res\.status\(403\)/);
  assert.match(route, /res\.set\('Cache-Control', 'no-store'\);/);
  // Le reste ne bouge pas : nocookie, sans contrôles.
  assert.match(route, /https:\/\/www\.youtube-nocookie\.com\/embed\/\$\{b\.id\}/);
  assert.match(route, /controls: '0'/);
});

const PORT = 3667;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-blindtest-triche';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_btriche';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null, dispo = false;

async function baseNeuve() {
  let Client;
  try { ({ Client } = require(path.join(ROOT, 'node_modules', 'pg'))); } catch { return false; }
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5667', FRUTISCORE_PORT: '5668',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  for (let i = 0; i < 160; i++) {
    // Le serveur répond avant que le schéma d'une base neuve soit posé : on
    // attend aussi sa dernière table (comme test/animateurs.test.js).
    try {
      if ((await fetch(BASE + '/do/prefdef')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'kikooz_gifts'`);
        await c.end();
        if (rows.length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session pour ' + pseudo);
  return j.sid;
}

async function client(pseudo, sid) {
  const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const trames = [];
  let tampon = '';
  ws.on('message', (d) => {
    tampon += d.toString('utf8');
    const bouts = tampon.split('\0');
    tampon = bouts.pop();
    for (const x of bouts) if (x.trim()) trames.push(x.trim());
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sid}" lc="1" />\0`);
  const c = {
    trames,
    dire: (texte) => ws.send(`<t g="pomme" t="m" p="">${texte}</t>\0`),
    attendre: async (pred, quoi, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(-900)}`);
    },
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  ws.send('<o g="pomme" />\0');
  await c.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'liste du salon');
  return c;
}

test('serveur vivant : le cadre a l\'extrait, l\'onglet et l\'autre site ont une porte close', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const ANIM = 'animbt' + RUN, JOUEUR = 'joueurbt' + RUN;
  const sidAnim = await inscrire(ANIM);
  const r = await fetch(`${BASE}/api/admin/users/${ANIM}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ is_animator: true }),
  });
  assert.strictEqual(r.status, 200, 'rôle d\'animateur');
  const anim = await client(ANIM, sidAnim);
  const joueur = await client(JOUEUR, await inscrire(JOUEUR));
  try {
    anim.dire('/blind https://youtu.be/dQw4w9WgXcQ 0:30 40');
    const trame = await joueur.attendre((x) => x.includes('t="bt"') && /bk="[0-9a-f]+"/.test(x), 'la trame du lecteur');
    const annonce = await joueur.attendre((x) => x.includes('Blindtest !'), 'l\'annonce');
    for (const x of [trame, annonce, ...joueur.trames]) {
      assert.ok(!x.includes('dQw4w9WgXcQ'), 'aucune trame du salon ne porte l\'identifiant : ' + x);
    }
    const jeton = /bk="([^"]*)"/.exec(trame)[1];
    const url = `${BASE}/api/blindtest/embed?k=${jeton}`;
    const ouvrir = (h) => fetch(url, { redirect: 'manual', headers: h });

    // Le cadre de nos pages : l'extrait.
    const cadre = await ouvrir({ 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate' });
    assert.strictEqual(cadre.status, 302);
    assert.match(cadre.headers.get('location'), /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
    assert.strictEqual(cadre.headers.get('cache-control'), 'no-store', 'la redirection ne se garde pas en cache');

    // L'adresse collée dans un onglet : porte close, et rien à lire.
    const onglet = await ouvrir({ 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate' });
    assert.strictEqual(onglet.status, 403);
    assert.strictEqual(onglet.headers.get('location'), null);
    assert.ok(!(await onglet.text()).includes('dQw4w9WgXcQ'));

    // Un autre site qui encadrerait le lien : porte close aussi.
    const ailleurs = await ouvrir({ 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'cross-site' });
    assert.strictEqual(ailleurs.status, 403);

    anim.dire('/blindstop');
    await joueur.attendre((x) => x.includes('t="bt"') && x.includes('bk=""'), 'l\'arrêt');
  } finally { anim.fermer(); joueur.fermer(); }
});
