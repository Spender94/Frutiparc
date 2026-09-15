/*
 * LE GUICHET MINI-PIXIZ DE L'ADMIN.
 *
 * « Crée-moi un endpoint dans l'admin dédié à Minipixiz pour que je puisse
 * faire des ajouts facilement à mes joueurs. L'idée étant de pouvoir leur
 * rendre des objets qu'ils ont perdu à cause de bugs et/ou faire level up
 * leurs fées. »
 *
 * Trois gestes, sur la fiche du jeu (slot 0 de `minipixiz`) : la LIRE en
 * clair, RENDRE des objets, FAIRE MONTER une fée.
 *
 * DEUX RÈGLES qui font tout le sujet, et que ces cas verrouillent :
 *
 *   · `$inv` EST INDEXÉ PAR CASE. Une case vide vaut `null`, et le joueur
 *     range où il veut. Rendre un objet en le « poussant à la fin » remplirait
 *     la case 3 d'un sac dont la 0 est libre — le jeu, lui, compte les cases,
 *     et l'objet rendu paraîtrait perdu.
 *
 *   · LA MONTÉE PASSE PAR LA RÈGLE DU JEU (`Fee.monterNiveau`), pas par
 *     `$level++` : elle paie l'expérience, applique la caractéristique déjà
 *     tirée dans `$next`, remonte le moral et retire la suivante. Écrire le
 *     niveau à la main laisserait une fée de niveau 12 avec les
 *     caractéristiques d'une débutante — une de ces fiches à moitié cohérentes
 *     qui ont fait les « fées cassées » qu'on répare ici.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3587;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-admin-minipixiz';
const RUN = Date.now().toString(36).slice(-5);
const JOUEUR = 'pixad' + RUN;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null, sid = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5412', FRUTISCORE_PORT: '5413',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
  const body = JSON.stringify({ username: JOUEUR, password: 'secret123' });
  const JSN = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: JSN, body });
  sid = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSN, body })).json()).sid;
  assert.ok(sid, 'session du joueur d’essai');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const CLEF = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

function fee(nom, extra) {
  return Object.assign({
    $name: nom, $level: 0, $humor: 0, $exp: 0, $hunger: 12, $moral: 10,
    $bagMax: 2, $shot: 0, $life: 3, $mana: 3, $mission: null, $pos: null,
    $carac: [1, 1, 1, 1, 1, 1], $skin: [0, 0, 0, 0], $next: [2, 5], $inv: [],
    $spell: [], $spellCoef: [], $mood: [], $behaviour: [], $taste: [[], []],
  }, extra || {});
}
const carte = (fees, inv) => ({
  $time: { $t: Date.now(), $d: 0, $s: 21600000 },
  $current: 0, $vs: 1.2, $bag: 2, $wind: 0, $help: [true, true, true],
  $inv: inv || [], $faerie: fees, $mis: [], $mission: null, $god: [false, false, false],
  $diam: 3, $key: 4, $star: 5, $frog: false, $checkpoint: 0,
  $dungeon: { $lvl: 2, $f: false, $loop: 0, $day: 0 },
  $rainbow: { $f: false, $day: 0, $it: 0 },
  $pond: { $q: 0, $d: 0, $fs: null },
  $stat: {
    $item: [], $eat: [], $kill: [0, 0, 0, 0, 0], $run: 9, $game: [0, 0, 0, 0, 0],
    $forestMax: 1, $treeMax: 0, $misNum: 7,
  },
});
const poser = (c) => fetch(BASE + '/api/saveFrutiSlot', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sid, game: 'minipixiz', slotId: '0', data: JSON.stringify(c) }),
});
const lire = async () => (await fetch(`${BASE}/api/admin/users/${JOUEUR}/minipixiz`, { headers: CLEF })).json();
const guichet = async (quoi, corps) => {
  const r = await fetch(`${BASE}/api/admin/users/${JOUEUR}/minipixiz/${quoi}`,
    { method: 'POST', headers: CLEF, body: JSON.stringify(corps) });
  return { statut: r.status, corps: await r.json() };
};

test('sans partie, le guichet le dit — il n’invente pas de fiche', async () => {
  const vu = await lire();
  assert.equal(vu.ok, true);
  assert.equal(vu.aUneFiche, false);
  assert.match(vu.message, /Aucune partie/);
  // Le catalogue, lui, est toujours là : c'est ce qui garnit le menu.
  assert.ok(vu.catalogue.length > 50, 'le catalogue des objets est servi');
  assert.ok(vu.catalogue.some((o) => o.nom === 'Clé' && o.famille === 'cle'));
});

test('la fiche se lit en clair : sac, fées, compteurs', async () => {
  // Un trou en case 0 : c'est le cas qui compte.
  await poser(carte([fee('Grelotine')], [null, 12]));
  const vu = await lire();
  assert.equal(vu.aUneFiche, true);
  assert.equal(vu.sac.places, 6, 'un sac n°2 tient six objets');
  assert.deepEqual(vu.sac.cases.map((c) => c.id), [null, 12, null, null, null, null]);
  assert.equal(vu.sac.cases[1].nom, 'Cœur +3', 'les objets portent leur nom de jeu');
  assert.equal(vu.fees.length, 1);
  assert.equal(vu.fees[0].nom, 'Grelotine');
  assert.equal(vu.fees[0].niveau, 0);
  assert.equal(vu.fees[0].expProchain, 50, 'le premier niveau coûte cinquante');
  assert.equal(vu.fees[0].places, 2, 'son sac à elle en tient deux');
  assert.equal(vu.compteurs.missions, 7);
  assert.equal(vu.compteurs.cles, 4);
});

test('un objet rendu va dans la première case LIBRE, jamais à la suite', async () => {
  await poser(carte([fee('Grelotine')], [null, 12]));
  const r = await guichet('objets', { objets: [31] });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.rendus, [{ id: 31, nom: 'Clé', case: 0 }],
    'la case 0 était libre : c’est elle qui reçoit');
  const vu = await lire();
  assert.deepEqual(vu.sac.cases.map((c) => c.id), [31, 12, null, null, null, null]);
});

test('un sac plein refuse, et le dit — rien n’est perdu en silence', async () => {
  await poser(carte([fee('Grelotine', { $bagMax: 2 })], [1, 2, 3, 4, 5, 6]));
  const r = await guichet('objets', { objets: [30, 31] });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.rendus.length, 0);
  assert.equal(r.corps.refuses.length, 2);
  assert.equal(r.corps.refuses[0].raison, 'sac plein');

  // Le sac d'une fée a ses propres places : deux, ici.
  const f = await guichet('objets', { fee: 'Grelotine', objets: [0, 1, 2] });
  assert.equal(f.corps.rendus.length, 2, 'deux places, deux objets');
  assert.equal(f.corps.refuses.length, 1);
  assert.equal(f.corps.ou, 'Grelotine');
  const vu = await lire();
  assert.deepEqual(vu.fees[0].sac.map((c) => c.id), [0, 1]);
});

test('un objet que le jeu ne connaît pas est refusé AVANT d’écrire', async () => {
  await poser(carte([fee('Grelotine')], [null, 12]));
  const r = await guichet('objets', { objets: [30, 9999] });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.error, 'objet_inconnu');
  assert.equal(r.corps.id, 9999);
  const vu = await lire();
  assert.deepEqual(vu.sac.cases.map((c) => c.id), [null, 12, null, null, null, null],
    'le 30 valide n’est pas passé non plus : on refuse le lot entier');
});

test('faire monter une fée suit la règle du jeu, pas un « $level++ »', async () => {
  await poser(carte([fee('Grelotine')], []));
  const r = await guichet('fee', { fee: 'Grelotine', niveaux: 3 });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.niveauAvant, 0);
  assert.equal(r.corps.niveauApres, 3);
  assert.equal(r.corps.appris.length, 3, 'trois apprentissages, un par marche');

  const vu = await lire();
  const f = vu.fees[0];
  assert.equal(f.niveau, 3);
  // Chaque montée ajoute UN point de caractéristique : six au départ, neuf après.
  const somme = f.carac.reduce((a, b) => a + b, 0);
  assert.equal(somme, 9, 'les caractéristiques ont suivi le niveau : ' + JSON.stringify(f.carac));
  assert.equal(f.moral, 20, 'monter de niveau remonte le moral (+4, plafonné à 20)');
  assert.equal(f.expProchain, 800, 'la marche suivante coûte (3+1)² × 50');
});

test('l’expérience seule ne fait pas monter : la fée montera en jeu', async () => {
  await poser(carte([fee('Grelotine')], []));
  const r = await guichet('fee', { fee: 'Grelotine', exp: 120 });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.niveauApres, 0, 'le niveau ne bouge pas tout seul');
  assert.equal(r.corps.etat.exp, 120, 'mais elle a de quoi monter (50 suffisent)');

  // Et une fée qu'on ne connaît pas ne fait rien du tout.
  const inconnue = await guichet('fee', { fee: 'Personne', niveaux: 1 });
  assert.equal(inconnue.statut, 404);
  assert.equal(inconnue.corps.error, 'fee_inconnue');
  // Ni niveaux ni expérience : on le dit plutôt que d'écrire pour rien.
  const vide = await guichet('fee', { fee: 'Grelotine' });
  assert.equal(vide.statut, 400);
  assert.equal(vide.corps.error, 'rien_a_faire');
});

test('le guichet est à l’écran, dans la fiche du joueur', () => {
  const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(ADMIN, /<div id="pixiz-panneau"/);
  assert.match(ADMIN, /onclick="ouvrirPixiz\(\)"/);
  assert.match(ADMIN, /async function ouvrirPixiz\(\)/);
  assert.match(ADMIN, /minipixiz\/\$\{|minipixiz`/, 'il interroge l’endpoint du guichet');
  // Les trois commandes.
  assert.match(ADMIN, /async function pixizRendre\(\)/);
  assert.match(ADMIN, /async function pixizMonter\(\)/);
  assert.match(ADMIN, /async function pixizDonnerExp\(\)/);
  // L'avertissement qui compte : une partie ouverte réécrit la fiche.
  assert.match(ADMIN, /sa partie réécrira la fiche en la quittant/);
});
