/*
 * La SYNCHRONISATION Miniwave entre le bureau (SWF sous Ruffle) et light.
 *
 * Le SWF compilé tourne en STANDALONE : il lit sa fiche dans un SharedObject
 * — getLocal("miniWave2/card2"), champ « fruticard », tous deux vérifiés sur
 * un dump du SOL écrit par Ruffle. Avant le raccord, ce SharedObject était
 * VIDE : loadFruticard ne trouvait rien, formatFruticard() repartait d'une
 * fiche d'usine… et l'enregistrait aussitôt PAR-DESSUS la progression light.
 * La garde de taille ne bronchait pas : la fiche vierge, avec ses 51 zéros de
 * $badsKill, est plus LONGUE que la fiche riche.
 *
 * Le raccord tient en trois pièces, toutes épinglées ici :
 *   1. game-popup.html sème le SharedObject depuis la fiche serveur AVANT le
 *      boot du SWF (même mécanique que Minipixiz), sous les DEUX clés — avec
 *      et sans port : Ruffle bâtit la sienne sur le host sans port.
 *   2. Le serveur refuse la fiche d'usine quand une progression existe
 *      (HTTP et fil), en reconnaissant son CONTENU, pas sa taille.
 *   3. Le pipe de préférences « undefined|undefined|… » du slot 1 est ignoré.
 *
 * Vérifié en vrai : le SWF, semé, relit la fiche riche (grade recalculé,
 * badsKill et vaisseaux présents dans SA sauvegarde de retour).
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 3463;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const W = require('../public/miniwave/plateforme.js');

let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5208', FRUTISCORE_PORT: '5209',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid);
  return j.sid;
}

const sauver = (sid, slotId, data) => fetch(BASE + '/api/saveFrutiSlot', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sid, game: 'miniwave', slotId, data }),
});

async function fiche(sid) {
  const t = await (await fetch(`${BASE}/api/loadFrutiSlots?sid=${sid}&game=miniwave`, { method: 'POST' })).text();
  const m = /slot0=([^&]*)/.exec(t);
  return { brut: t, carte: m ? JSON.parse(decodeURIComponent(m[1])) : null };
}

// La fiche d'usine EXACTE que le bureau envoie quand il n'a rien lu : le
// tuyau du SWF, converti en JSON par game-popup (booléens pour $ship).
function ficheUsine() {
  return {
    $ship: [true, false, false, false, false, false],
    $badsKill: new Array(51).fill(0),
    $arcade: { $bestLevel: 0, $bestScore: 0 },
    $cons: { $main: 0, $bonus: [0, 0, 0, 0, 0, 0, 0, 0], $letter: 0 },
    $shop: new Array(20).fill(1),
    $vs: 0.93,
  };
}

let sid = '';

test('le bureau est semé : game-popup porte l\'entrée SharedObject de Miniwave', () => {
  const popup = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  // La clé du SOL et son champ, tels que le SWF les lit (dump Ruffle) :
  // « card2 » — pas « card » comme les sources AS — et « fruticard » en clair.
  assert.match(popup, /miniwave:\s*\{ name: "miniWave2\/card2", base: "card2", fields: \["fruticard"\] \}/);
  // Les DEUX clés : Ruffle lit host SANS port, la page host AVEC.
  assert.match(popup, /window\.location\.hostname \+ swfLoadPath \+ "\/#" \+ cfg\.name/);
});

test('la fiche d\'usine du bureau n\'écrase pas la progression light', async () => {
  sid = await inscrire('wavesync');

  // La progression light : une partie d'arcade réelle + des achats.
  let carte = W.fusionner(W.carteNeuve(),
    { mode: 'arcade', score: 4200, level: 2, cons: 30, badsKill: { 3: 205 }, credits: 800 });
  carte.$ship[2] = 1;
  carte.$credit = 777;
  assert.ok((await sauver(sid, '0', JSON.stringify(carte))).ok);

  // Le bureau qui n'a rien lu enregistre sa fiche d'usine. La taille ne peut
  // rien (la vierge est plus longue) : c'est le CONTENU qui la trahit.
  const r = await sauver(sid, '0', JSON.stringify(ficheUsine()));
  assert.equal((await r.text()).trim(), 'ok=1', 'refus silencieux : le SWF ne réessaie pas');

  const { carte: apres } = await fiche(sid);
  assert.equal(apres.$credit, 777, 'les crédits ont survécu');
  assert.ok(apres.$ship[2], 'le vaisseau acheté a survécu');
  assert.equal(Number(apres.$badsKill[3]), 205, 'les éliminations ont survécu');
  assert.equal(Number(apres.$arcade.$bestLevel), 3, 'le niveau d\'arcade a survécu');
});

test('une vraie session bureau, elle, s\'enregistre et se fusionne', async () => {
  // Le SWF semé rejoue : sa fiche porte l'état chargé PLUS le neuf
  // (un monstre de plus à 210, le tuyau ne transporte pas les crédits).
  const f = ficheUsine();
  f.$ship = [true, false, true, false, false, false];
  f.$badsKill[3] = 205;
  f.$badsKill[7] = 210;
  f.$arcade = { $bestLevel: 3, $bestScore: 4200 };
  await sauver(sid, '0', JSON.stringify(f));

  const { carte: apres } = await fiche(sid);
  assert.equal(Number(apres.$badsKill[7]), 210, 'le nouveau monstre est compté');
  assert.equal(Number(apres.$badsKill[3]), 205, 'l\'ancien reste');
  assert.equal(apres.$credit, 777, 'les crédits regreffés (le tuyau ne les porte pas)');
});

test('le pipe de préférences « undefined|… » ne s\'enregistre pas', async () => {
  const r = await sauver(sid, '1',
    'undefined|undefined|undefined|undefined|undefined|undefined|undefined');
  assert.equal((await r.text()).trim(), 'ok=1');
  const { brut } = await fiche(sid);
  assert.ok(!/slot1=/.test(brut), 'aucun slot 1 fantôme');
});

test('le serveur porte les deux gardes (HTTP et fil)', () => {
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(serveur, /function looksLikeMiniwaveDefault/);
  const occurrences = serveur.match(/looksLikeMiniwaveDefault\(neuf\) && miniwaveHasProgress\(prev\)/g) || [];
  assert.equal(occurrences.length, 2, 'la garde vit sur les deux chemins');
  assert.match(serveur, /miniwave pref pipe VIDE/, 'et le pref vide est refusé');
});
