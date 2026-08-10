/*
 * Miniwave : la partie jouée au BUREAU ne mange plus la fiche du light.
 *
 * Le SWF du mode Frutiz enregistre par le FIL (fcardupdateslot, wire « ed »)
 * une chaîne à sept champs — sans crédits, sans modes achetés, sans records
 * d'Endurance ni de Letter Invader. Le chemin HTTP regreffait ces champs
 * depuis la fiche stockée (miniwaveGreffeHorsTuyau) ; le fil convertissait le
 * tuyau SANS regreffer : la première partie de bureau remplaçait la fiche
 * riche par sa version amputée. « Les missions ne sont plus accessibles » et
 * « j'ai perdu mes crédits accumulés » : c'était ce trou-là.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
const PORT = 3491;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const JOUEUR = 'mwfil' + RUN;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5224', FRUTISCORE_PORT: '5225',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

let sid = '';
async function session() {
  if (sid) return sid;
  const body = JSON.stringify({ username: JOUEUR, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  sid = (await r.json()).sid;
  assert.ok(sid, 'connexion → sid');
  return sid;
}

// La fiche riche que le portage light écrit : crédits gagnés, missions 1 et 2
// achetées, un record d'Endurance, un vaisseau acheté.
function ficheRiche() {
  return {
    $vs: 0.93,
    $ship: [1, 1, 0, 0, 0, 0],
    $mode: [1, [1, 1, 0, 0, 0, 0, 0, 0], [0, 1, 0], 1, 1],
    $arcade: { $bestScore: 4200, $bestLevel: 7 },
    $letter: 0, $survival: 1234, $time: 0,
    $bonus: [500, 0, 0, 0, 0, 0, 0, 0],
    $cons: { $main: 12, $bonus: [40, 0, 0, 0, 0, 0, 0, 0], $letter: 0 },
    $badsKill: Array.from({ length: 51 }, (_, i) => (i < 3 ? 250 : 0)),
    $saucerKill: 9,
    $credit: 500,
    $shop: [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    $lvl: 0,
    $stats: { $play: { $main: 3, $mission: 2, $survival: 1, $letter: 0 }, $buy: [] },
  };
}

async function relire() {
  const r = await fetch(`${BASE}/api/loadFrutiSlots?sid=${sid}&game=miniwave`, { cache: 'no-store' });
  const m = /(?:^|&)slot0=([^&]*)/.exec(await r.text());
  assert.ok(m, 'slot0 présent');
  return JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' ')));
}

// Une socket CBee identifiée, pour parler le fil fcardupdateslot (« ed »).
async function socketFil() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const trames = [];
  let tampon = '';
  ws.on('message', (d) => {
    tampon += d.toString('utf8');
    const bouts = tampon.split('\0');
    tampon = bouts.pop();
    for (const b of bouts) if (b.trim()) trames.push(b.trim());
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${JOUEUR}" s="${sid}" />\0`);
  const attendre = async (pred, quoi, ms = 5000) => {
    for (let i = 0; i < ms / 50; i++) {
      const t = trames.find(pred);
      if (t) return t;
      await wait(50);
    }
    throw new Error(`${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 400)}`);
  };
  await attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return { ws, attendre, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    fermer: () => { try { ws.close(); } catch {} } };
}

// Le tuyau à sept champs qu'écrit le SWF du bureau après une partie : du
// progrès réel (tableau de chasse, niveau d'arcade) mais RIEN des champs
// riches — ni crédits, ni modes, ni records des modes spéciaux.
function tuyauDeBureau() {
  const ships = ['true', 'false', 'false', 'false', 'false', 'false'].join(',');
  const kills = Array.from({ length: 51 }, (_, i) => (i < 3 ? 260 : (i === 4 ? 12 : 0))).join(',');
  const consBonus = [40, 0, 0, 0, 0, 0, 0, 0].join(',');
  const shop = new Array(20).fill(1).join(',');
  return [ships, kills, '9', consBonus, '0', shop, '0.93'].join('|');
}

test('le fil regreffe crédits et modes sur le tuyau du bureau', async () => {
  await session();
  // 1. Le joueur light a une fiche riche.
  const envoi = await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: JSON.stringify(ficheRiche()) }),
  });
  assert.equal((await envoi.text()).slice(0, 4), 'ok=1');
  assert.equal((await relire()).$credit, 500, 'la fiche riche est en place');

  // 2. Il joue au bureau : le SWF sauve son tuyau par le fil.
  const c = await socketFil();
  try {
    c.envoyer(`<ed r="3" g="miniwave" s="0">${tuyauDeBureau()}</ed>`);
    await c.attendre((t) => t.startsWith('<ed'), 'accusé updateSlot');
  } finally { c.fermer(); }

  // 3. De retour sur le light : rien de riche n'a disparu…
  const fiche = await relire();
  assert.equal(fiche.$credit, 500, 'les crédits accumulés sont toujours là');
  assert.deepEqual(fiche.$mode[1].slice(0, 3), [1, 1, 0], 'les missions achetées restent ouvertes');
  assert.equal(fiche.$mode[2][1], 1, 'Endurance achetée reste ouverte');
  assert.equal(fiche.$survival, 1234, 'le record d\'Endurance tient');
  assert.equal(fiche.$arcade.$bestScore, 4200, 'le meilleur score d\'arcade tient');
  assert.equal(fiche.$saucerKill, 9);
  assert.ok(fiche.$stats && fiche.$stats.$play && fiche.$stats.$play.$main === 3, 'les statistiques tiennent');
  // …et ce que le tuyau porte a bien avancé.
  assert.equal(fiche.$arcade.$bestLevel, 9, 'le niveau d\'arcade vient du bureau');
  assert.equal(fiche.$badsKill[0], 260, 'le tableau de chasse vient du bureau');
  assert.equal(fiche.$badsKill[4], 12);
});

test('la fiche d\'usine du bureau ne remplace toujours pas la progression', async () => {
  await session();
  // Le SWF qui n'a pas su charger sauve une fiche vierge : tableau de chasse à
  // zéro, aucun niveau. La garde d'usine doit la refuser AVANT la greffe.
  const ships = ['true', 'false', 'false', 'false', 'false', 'false'].join(',');
  const kills = new Array(51).fill(0).join(',');
  const usine = [ships, kills, '0', new Array(8).fill(0).join(','), '0',
    new Array(20).fill(1).join(','), '0.93'].join('|');
  const c = await socketFil();
  try {
    c.envoyer(`<ed r="4" g="miniwave" s="0">${usine}</ed>`);
    await c.attendre((t) => t.startsWith('<ed'), 'accusé updateSlot');
  } finally { c.fermer(); }
  const fiche = await relire();
  assert.equal(fiche.$badsKill[0], 260, 'le tableau de chasse n\'a pas été remis à zéro');
  assert.equal(fiche.$credit, 500, 'et les crédits non plus');
});

// ── La réconciliation $shop → déverrouillages (le retour de Sykka) ────────
//
// Les fiches amputées AVANT la regreffe gardent leurs achats ($shop voyage
// dans le tuyau) mais plus leurs déverrouillages ($mode n'y tient pas) : le
// stand montre les cases achetées, le menu light reste muet et le bureau
// verrouille BONUS/SPECIAL. Le serveur redérive désormais $ship/$mode du
// registre d'achats — la table exacte de la boutique d'époque
// (box/ShopSlot.select) — au chargement comme à la sauvegarde.

function ficheAmputee() {
  const f = ficheRiche();
  // Achats : Proto (0), Sacuro (3), Missions 1-3 (5-7), Endurance (9),
  // Mission 4 (15). Mais plus un seul déverrouillage : l'état d'après
  // l'écrasement d'avant le correctif.
  f.$shop = [0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1];
  f.$ship = [1, 0, 0, 0, 0, 0];
  f.$mode = [1, [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0], 1, 1];
  f.$credit = 23;
  return f;
}

test('la fiche amputée d\'avant le correctif se guérit d\'elle-même', async () => {
  await session();
  const envoi = await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: JSON.stringify(ficheAmputee()) }),
  });
  assert.equal((await envoi.text()).slice(0, 4), 'ok=1');
  const fiche = await relire();
  // Les missions achetées rouvrent…
  assert.deepEqual(fiche.$mode[1], [1, 1, 1, 1, 0, 0, 0, 0],
    'missions 1-3 (ids 5-7) et 4 (id 15 → $mode[1][3]) rouvertes');
  // …les vaisseaux achetés aussi…
  assert.deepEqual(fiche.$ship, [1, 1, 0, 0, 1, 0],
    'Proto (id 0 → $ship[1]) et Sacuro (id 3 → $ship[4]) rendus');
  // …et les modes spéciaux achetés.
  assert.deepEqual(fiche.$mode[2], [0, 1, 0], 'Endurance (id 9) rouverte, Letter non acheté fermé');
  // Rien n'est inventé : le registre d'achats n'a pas bougé.
  assert.equal(fiche.$shop[1], 1, 'Gapatsa toujours à vendre');
  assert.equal(fiche.$credit, 23, 'les crédits ne bougent pas');
});

test('la réconciliation n\'enlève jamais rien', async () => {
  await session();
  // Un déverrouillage présent SANS achat correspondant (cadeau, vieil état) :
  // il reste. La réconciliation ouvre, elle ne referme pas.
  const f = ficheRiche();
  f.$shop = new Array(20).fill(1);        // rien d'acheté
  f.$mode = [1, [1, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0], 1, 1];
  f.$ship = [1, 1, 0, 0, 0, 0];
  await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: JSON.stringify(f) }),
  });
  const fiche = await relire();
  assert.equal(fiche.$mode[1][0], 1, 'la mission offerte reste ouverte');
  assert.equal(fiche.$mode[2][0], 1, 'le mode offert aussi');
  assert.equal(fiche.$ship[1], 1, 'le vaisseau offert aussi');
});

test('le fil aussi guérit : un tuyau de bureau sur une fiche amputée', async () => {
  await session();
  // La fiche stockée est amputée MAIS marchande ; le bureau envoie son tuyau.
  // La greffe rapporte crédits et $mode (vides), la réconciliation rouvre
  // depuis $shop — qui vient du TUYAU, donc du bureau lui-même.
  await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: JSON.stringify(ficheAmputee()) }),
  });
  const ships = ['true', 'false', 'false', 'false', 'false', 'false'].join(',');
  const kills = Array.from({ length: 51 }, (_, i) => (i < 3 ? 300 : 0)).join(',');
  const shop = [0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1].join(',');
  const tuyau = [ships, kills, '9', [40, 0, 0, 0, 0, 0, 0, 0].join(','), '0', shop, '0.93'].join('|');
  const c = await socketFil();
  try {
    c.envoyer(`<ed r="9" g="miniwave" s="0">${tuyau}</ed>`);
    await c.attendre((t) => t.startsWith('<ed'), 'accusé updateSlot');
  } finally { c.fermer(); }
  const fiche = await relire();
  assert.deepEqual(fiche.$mode[1], [1, 1, 1, 1, 0, 0, 0, 0], 'missions rouvertes après le tuyau');
  assert.equal(fiche.$credit, 23, 'et les crédits regreffés');
});
