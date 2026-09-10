/*
 * Le voyant de jeu sur la FICHE d'un frutiz (/light).
 *
 * L'en-tête ne montrait qu'un point de présence — connecté, ou pas —, ce que la
 * liste des connectés dit déjà. Le voyant, lui, dit ce qu'on ne lit nulle part
 * ailleurs sur la fiche : qu'il est AU MILIEU d'une partie. On veut le savoir
 * avant de redémarrer le serveur, pas après.
 *
 * Le cycle complet, contre un vrai serveur : la fiche d'un joueur au repos, la
 * même pendant qu'il joue, et la même quand il a fini.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3463;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5200', FRUTISCORE_PORT: '5201', DATABASE_URL: '',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const json = (r) => r.json();
async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await json(await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
  assert.ok(j.sid, 'session de ' + pseudo);
  return j.sid;
}
// Une socket de chat : c'est ELLE que le serveur lit pour savoir qui joue.
async function brancher(pseudo, sid) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sid}" lc="1" />\0`);
  await wait(400);
  ws.send('<o g="pomme" />\0');
  await wait(400);
  return ws;
}
const fiche = async (sid, qui) =>
  json(await fetch(`${BASE}/api/light/fiche?sid=${sid}&u=${encodeURIComponent(qui)}`));

test('la fiche montre le voyant du jeu pendant la partie, le point sinon', async () => {
  const JOUEUR = 'ficheJoue' + SUF;
  const OBS = 'ficheObs' + SUF;
  const sidJoueur = await inscrire(JOUEUR);
  const sidObs = await inscrire(OBS);

  // ── 1. Hors ligne : ni présence, ni jeu. ──
  let f = await fiche(sidObs, JOUEUR);
  assert.equal(f.ok, true, 'la fiche répond');
  assert.equal(f.enLigne, false, 'il n\'est pas là');
  assert.equal(f.jeu, '', 'et ne joue à rien');

  // ── 2. Connecté, au repos : présent, mais aucune partie. ──
  const ws = await brancher(JOUEUR, sidJoueur);
  try {
    f = await fiche(sidObs, JOUEUR);
    assert.equal(f.enLigne, true, 'il est en ligne');
    assert.equal(f.jeu, '', 'et ne joue toujours à rien');

    // ── 3. En partie : le voyant du jeu. ──
    const entrer = (jeu, on) => fetch(`${BASE}/api/light/jeu-en-cours`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sidJoueur, jeu, on: on ? '1' : '0' }),
    });
    assert.equal((await entrer('minipixiz', true)).status, 200, 'il entre en partie');
    await wait(300);
    f = await fiche(sidObs, JOUEUR);
    assert.equal(f.jeu, 'minipixiz', 'la fiche dit à quoi il joue');
    assert.equal(f.enLigne, true, 'sans perdre la présence');

    // ── 4. Swapou : le nom publié est celui des ASSETS, pas celui du SWF. ──
    assert.equal((await entrer('minipixiz', false)).status, 200);
    assert.equal((await entrer('swapou2', true)).status, 200, 'il passe à Swapou');
    await wait(300);
    f = await fiche(sidObs, JOUEUR);
    assert.equal(f.jeu, 'swapou',
      'le serveur publie « swapou » — le fichier voyant_swapou.png existe, pas voyant_swapou2.png');

    // ── 5. La vue « tout le site » dit la même chose. ──
    const enLigne = await json(await fetch(`${BASE}/api/light/online?sid=${sidObs}`));
    const ligne = (enLigne.users || []).find((x) => String(x.pseudo).toLowerCase() === JOUEUR.toLowerCase());
    assert.ok(ligne, 'il figure dans la liste du site');
    assert.equal(ligne.jeu, 'swapou', 'et avec le même nom que la fiche');

    // ── 6. Fin de partie : le point de présence revient. ──
    assert.equal((await entrer('swapou2', false)).status, 200, 'il sort de partie');
    await wait(300);
    f = await fiche(sidObs, JOUEUR);
    assert.equal(f.jeu, '', 'plus de voyant');
    assert.equal(f.enLigne, true, 'mais toujours présent');
  } finally { try { ws.close(); } catch {} }

  // ── 7. Déconnecté en pleine partie : plus de voyant non plus. ──
  await wait(600);
  f = await fiche(sidObs, JOUEUR);
  assert.equal(f.enLigne, false, 'la socket fermée l\'éteint');
  assert.equal(f.jeu, '', 'et le voyant avec');
});
