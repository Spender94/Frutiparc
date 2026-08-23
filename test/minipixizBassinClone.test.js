'use strict';

/*
 * LA FABRIQUE DE CLONES DU BASSIN — et sa fermeture.
 *
 * Retour joueur : « la fée du bassin a exactement les mêmes couleurs que ma
 * seconde fée », plongée après plongée, sur les deux disques — et la fée
 * capturée la veille avait disparu, le bassin rallumé.
 *
 * La chaîne du bug :
 *
 *   1. Le pipe du SWF ne transporte pas $pond.$fs (la graine de la fée qui
 *      mûrit au bassin). Pour qu'elle survive aux sauvegardes du bureau, le
 *      serveur la RESTAURE depuis la fiche précédente. C'est légitime…
 *   2. …sauf à la CAPTURE : freeFaerie pousse la fée au tableau et vide le
 *      bassin, mais le pipe n'emporte que « nom:niveau ». La restauration la
 *      remettait donc À L'EAU. La fiche portait la même fée deux fois : au
 *      tableau et au fond du bassin.
 *   3. Chaque plongée suivante relivrait la même graine — le « clone ». Et le
 *      dé-doublonnage du chargement (identité = nom + peau), fait pour un
 *      autre bug, effaçait la copie fraîchement capturée : « ma fée a
 *      disparu ».
 *
 * Les remèdes, tous deux côté serveur :
 *
 *   · à la sauvegarde d'une capture (pipe) : la fée NOUVELLE au tableau qui
 *     porte le nom de la fée du bassin EST la fée du bassin — elle regagne sa
 *     vraie graine (couleurs, carac, sorts) et le bassin se vide, comme
 *     freeFaerie l'a fait dans le jeu ;
 *   · au chargement : une fée du bassin qui est DÉJÀ au tableau (même nom,
 *     même peau — 3 × 24 bits, jamais deux fées pareilles) est un fantôme,
 *     dissipé comme freeFaerie l'aurait fait ($fs null, $q 0).
 *
 * Et le garde-fou inverse : une fée qui mûrit au bassin SANS avoir été
 * capturée doit toujours survivre à une sauvegarde pipe — c'était la raison
 * d'être de la restauration, elle ne doit pas se perdre en route.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3521;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProc = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + '/api/loadFrutiSlots?game=minipixiz');
      if (r.ok) return;
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
}

before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5292', FRUTISCORE_PORT: '5293',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  await waitForServer();
});

after(() => {
  if (serverProc) serverProc.kill('SIGKILL');
});

const sidCache = {};
async function makeSession(name) {
  if (sidCache[name]) return sidCache[name];
  await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'secret123' }),
  });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'secret123' }),
  });
  const j = await r.json();
  assert.ok(j.sid, 'login → sid');
  sidCache[name] = j.sid;
  return j.sid;
}

async function saveSlot(sid, data) {
  const body = new URLSearchParams({ sid, game: 'minipixiz', slotId: '0', data });
  const r = await fetch(BASE + '/api/saveFrutiSlot', { method: 'POST', body });
  assert.equal((await r.text()).slice(0, 4), 'ok=1');
}

async function loadSlot0(sid) {
  const r = await fetch(BASE + `/api/loadFrutiSlots?sid=${sid}&game=minipixiz`);
  const params = new URLSearchParams(await r.text());
  return params.get('slot0') ? JSON.parse(params.get('slot0')) : null;
}

// Une graine de fée COMPLÈTE, aux couleurs choisies — celles par lesquelles le
// joueur reconnaît sa fée, et le test son clone.
function graine(nom, corps, c1, c2, c3, niveau) {
  return {
    $name: nom, $humor: 3, $carac: [2, 1, 1, 1, 1, 1],
    $skin: [corps, c1, c2, c3],
    $mood: [], $next: [0, 20], $pos: null, $level: niveau || 0,
    $exp: 0, $hunger: 4, $moral: 10, $shot: 0,
    $spell: [20, 0], $spellCoef: [], $taste: [[1], [2]], $behaviour: [],
    $inv: [], $mission: null, $bagMax: 2, $life: 2, $mana: 2,
  };
}

// Une fiche vivante et saine : assez de progrès pour que le forward-merge la
// juge « healthy » et fasse son travail.
function fiche(faerie, pond) {
  return JSON.stringify({
    $stat: {
      $item: [true, false, true], $eat: [2, 0, 1], $kill: [1, 0, 0, 0, 0],
      $run: 1234, $game: [3, 1, 0, 0, 0], $forestMax: 300, $treeMax: 40, $misNum: 1,
    },
    $diam: 1, $key: 1, $star: 2, $bag: 2,
    $dungeon: { $lvl: 0, $f: false, $loop: 0, $day: 0 },
    $rainbow: { $f: false, $day: 0, $it: 0 },
    $pond: pond,
    $frog: false,
    $faerie: faerie,
    $vs: 1.2, $inv: [30, null, 5], $current: 0,
    $help: [true, true, true], $mis: [], $wind: 0.3,
    $god: [false, false, false],
    $time: { $t: 1770000000000, $d: 12, $s: 3600000 },
    $mission: [], $checkpoint: 1,
  });
}

// Le pipe du SWF patché (33 champs) — la sauvegarde APPAUVRIE du bureau, avec
// le champ 17 (faerie) et le champ 15 ($pond.$q) qui nous intéressent.
function pipe(faerieField, pondQ) {
  const o = {
    item: 'true,,true', eat: '2,0,1', kill: '1,0,0,0,0', run: '1300',
    game: '3,1,0,0,0', forestMax: '300', treeMax: '40', misNum: '1',
    diam: '1', key: '1', star: '2', bag: '2',
    dunLvl: '0', dunF: 'false', rainF: 'false', pondQ: String(pondQ),
    frog: 'false', faerie: faerieField, vs: '1.2',
    inv: '30,,5', current: '0', checkpoint: '1',
    timeT: '1770000100000', timeD: '12', timeS: '3700000',
    pondD: '1', dunDay: '0', dunLoop: '0', rainDay: '0', rainIt: '0',
    wind: '0.3', god: 'false,,false', help: 'true,,true',
  };
  return [o.item, o.eat, o.kill, o.run, o.game, o.forestMax, o.treeMax, o.misNum,
    o.diam, o.key, o.star, o.bag, o.dunLvl, o.dunF, o.rainF, o.pondQ,
    o.frog, o.faerie, o.vs, o.inv, o.current, o.checkpoint,
    o.timeT, o.timeD, o.timeS, o.pondD, o.dunDay, o.dunLoop, o.rainDay, o.rainIt,
    o.wind, o.god, o.help].join('|');
}

// ── 1. LE FANTÔME SE DISSIPE AU CHARGEMENT ────────────────────────────────

test('une fée du bassin déjà au tableau est un fantôme : dissipé au chargement', async () => {
  const sid = await makeSession('bassinfantome');
  const X = graine('Sisine', 2, 0x88AA22, 0x2244CC, 0xCC2288, 3);
  // La fiche empoisonnée telle que le bug la laissait : la MÊME fée au tableau
  // ET au fond du bassin.
  await saveSlot(sid, fiche([X], { $q: 2, $d: 0, $fs: JSON.parse(JSON.stringify(X)) }));

  const carte = await loadSlot0(sid);
  assert.ok(carte, 'la fiche se recharge');
  assert.equal(carte.$pond.$fs, null, 'le bassin ne retient plus le fantôme');
  assert.equal(carte.$pond.$q, 0, 'et sa qualité est soldée, comme freeFaerie');
  assert.equal(carte.$faerie.length, 1, 'la fée du tableau, elle, reste');
  assert.equal(carte.$faerie[0].$name, 'Sisine');
  assert.deepEqual(carte.$faerie[0].$skin, X.$skin, 'avec ses vraies couleurs');
});

test('deux homonymes de peaux différentes ne déclenchent rien : le bassin garde sa fée', async () => {
  const sid = await makeSession('bassinhomonyme');
  const A = graine('Gilika', 1, 0x111111, 0x222222, 0x333333, 5);
  // Même nom — le bassin tire dans ~970 combinaisons, ça arrive — mais une
  // AUTRE peau : c'est une autre fée, elle a le droit de mûrir au bassin.
  const B = graine('Gilika', 4, 0x999999, 0x888888, 0x777777, 0);
  await saveSlot(sid, fiche([A], { $q: 1, $d: 0, $fs: B }));

  const carte = await loadSlot0(sid);
  assert.ok(carte.$pond.$fs, 'le bassin garde son homonyme');
  assert.deepEqual(carte.$pond.$fs.$skin, B.$skin, 'aux couleurs de B, pas de A');
});

// ── 2. LA CAPTURE AU BUREAU (PIPE) VIDE LE BASSIN ET REND SA GRAINE ───────

test('capture au bureau : la fée regagne sa graine et le bassin se vide', async () => {
  const sid = await makeSession('bassincapture');
  const A = graine('Alméria', 0, 0x445566, 0x665544, 0x556644, 4);
  const X = graine('Pikadea', 5, 0xDD8811, 0x11DD88, 0x8811DD, 0);
  // L'état d'avant la plongée : A au tableau, X mûrit au bassin.
  await saveSlot(sid, fiche([A], { $q: 2, $d: 0, $fs: X }));

  // Le SWF capture X : freeFaerie l'a poussée au tableau ($q = 0), et le pipe
  // n'emporte que « nom:niveau ».
  await saveSlot(sid, pipe('Alm%E9ria:4,Pikadea:0,', 0));

  const carte = await loadSlot0(sid);
  assert.equal(carte.$pond.$fs, null, 'le bassin est vide : la capture a eu lieu');
  const noms = carte.$faerie.map((f) => f.$name);
  assert.ok(noms.includes('Pikadea'), 'Pikadea est au tableau : ' + noms.join(', '));
  const pika = carte.$faerie.find((f) => f.$name === 'Pikadea');
  assert.deepEqual(pika.$skin, X.$skin,
    'et elle porte ses VRAIES couleurs — la graine du bassin, pas une synthèse');
  assert.equal(pika.$carac.join(','), X.$carac.join(','), 'ses carac aussi');
  // Replonger ne peut plus livrer de clone : il n'y a plus rien à livrer.
});

// ── 3. LE GARDE-FOU INVERSE : LA FÉE QUI MÛRIT SURVIT TOUJOURS AU PIPE ────

test('sans capture, la fée du bassin survit à une sauvegarde du bureau', async () => {
  const sid = await makeSession('bassinmurit');
  const A = graine('Cynmone', 3, 0x123456, 0x654321, 0x246810, 2);
  const X = graine('Hokine', 1, 0xABCDEF, 0xFEDCBA, 0x102030, 0);
  await saveSlot(sid, fiche([A], { $q: 3, $d: 1, $fs: X }));

  // Le joueur fait une partie de forêt au bureau et ressort SANS plonger : le
  // pipe repart avec le tableau inchangé et le $q du bassin toujours armé.
  await saveSlot(sid, pipe('Cynmone:2,', 3));

  const carte = await loadSlot0(sid);
  assert.ok(carte.$pond.$fs, 'la fée du bassin est toujours là');
  assert.equal(carte.$pond.$fs.$name, 'Hokine');
  assert.deepEqual(carte.$pond.$fs.$skin, X.$skin, 'intacte, couleurs comprises');
  assert.equal(carte.$faerie.length, 1, 'et le tableau n\'a pas gonflé');
});

// ── 4. LE MÊME MÉNAGE, SANS SERVEUR ───────────────────────────────────────
// chasserFantomeDuBassin est aussi appelée pendant la sauvegarde : on vérifie
// la règle à la source, moignons compris.

test('chasserFantomeDuBassin : identité stricte, jamais sur un moignon', () => {
  const { chasserFantomeDuBassin } = require('../minipixizFaerie');
  const X = graine('Namilie', 2, 0x0F0F0F, 0xF0F0F0, 0x0FF0FF, 1);

  // Le fantôme exact part.
  const c1 = { $faerie: [JSON.parse(JSON.stringify(X))], $pond: { $q: 2, $d: 0, $fs: X } };
  assert.equal(chasserFantomeDuBassin(c1), true);
  assert.equal(c1.$pond.$fs, null);
  assert.equal(c1.$pond.$q, 0);

  // Un moignon au tableau (pas de peau) ne répond pas pour la vraie : sa peau
  // synthétique n'est pas la sienne, on ne vide rien sur un doute.
  const c2 = { $faerie: [{ $name: 'Namilie', $level: 1 }],
    $pond: { $q: 2, $d: 0, $fs: JSON.parse(JSON.stringify(X)) } };
  assert.equal(chasserFantomeDuBassin(c2), false);
  assert.ok(c2.$pond.$fs, 'le bassin garde sa fée');

  // Rien au bassin : rien à faire.
  const c3 = { $faerie: [X], $pond: { $q: 0, $d: 0, $fs: null } };
  assert.equal(chasserFantomeDuBassin(c3), false);
});
