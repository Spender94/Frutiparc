/*
 * BURNING KIWI — LE FANTÔME (mode Ghost-Run).
 *
 * Le mode existe en entier dans le fichier d'époque — enregistrement de la
 * trajectoire, relecture interpolée, voiture translucide — mais son bouton de
 * menu est resté EN COMMENTAIRE (Games/burningKiwi/inc/menu.as, après
 * « elite »), et `unlockMode` n'a jamais été appelé pour lui. Personne n'y a
 * donc jamais joué. Le portage repose le bouton au mot et au pixel près, ouvre
 * le mode, et fait ce que le fichier ne faisait pas : garder la trace au
 * serveur, pour qu'on retrouve son fantôme le lendemain.
 *
 * Ce que ces tests verrouillent :
 *   · LE CODEC — cinq octets par point, la position au pixel, la rotation à un
 *     degré près et sans enroulement ;
 *   · LE BOUTON — même identifiant, même place, même phrase que le commentaire
 *     d'origine, et le mode ouvert par checkMode ;
 *   · L'ÉCART ASSUMÉ — la comparaison de fin de tour du fichier vidait le
 *     fantôme dès le premier tour ; elle est retirée, et le remplacement se
 *     décide à l'arrivée sur les temps complets ;
 *   · LES ROUTES — une trace par joueur et par circuit, celle du meilleur
 *     temps, et rien d'autre n'entre.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

globalThis.window = undefined;
require(path.join(ROOT, 'public/bkiwi/jeu/fantome.js'));
const J = globalThis.BkiwiJeu;

// ── Le codec ──────────────────────────────────────────────────────────────

test('le codec rend la position au pixel et la rotation à un degré et demi près', () => {
  const moves = [];
  for (let i = 0; i < 1500; i++) {
    moves.push({ x: 2171 + Math.sin(i / 30) * 900, y: 1605 - i * 0.7, r: ((i * 7) % 360) - 180, n: false });
  }
  const texte = J.encoderFantome({ moves });
  // Cinq octets par point, en base64 d'URL sans remplissage : quatre
  // caractères pour trois octets, et le reste à la fin.
  const octets = moves.length * 5;
  const reste = octets % 3;
  assert.strictEqual(texte.length, Math.floor(octets / 3) * 4 + (reste === 0 ? 0 : reste + 1));
  assert.ok(texte.length < 11 * 1024, 'une course entière tient dans une dizaine de Ko : ' + texte.length);
  // Et elle traverse un formulaire sans qu'un caractère soit ré-encodé.
  assert.strictEqual(encodeURIComponent(texte), texte);

  const trace = J.decoderFantome(texte);
  assert.strictEqual(trace.moves.length, moves.length);
  assert.strictEqual(trace.current, 0);
  let ecartXY = 0, ecartR = 0;
  for (let i = 0; i < moves.length; i++) {
    ecartXY = Math.max(ecartXY, Math.abs(trace.moves[i].x - Math.round(moves[i].x)),
      Math.abs(trace.moves[i].y - Math.round(moves[i].y)));
    let dr = Math.abs(trace.moves[i].r - moves[i].r);
    if (dr > 180) dr = 360 - dr;
    ecartR = Math.max(ecartR, dr);
    assert.strictEqual(trace.moves[i].n, false, 'la nitro n\'est jamais posée par le jeu');
  }
  assert.strictEqual(ecartXY, 0, 'la trajectoire ne bouge pas d\'un pixel');
  assert.ok(ecartR < 1.5, 'rotation à ' + ecartR.toFixed(2) + ' degrés près');
});

test('la rotation ne connaît pas le saut de +179 à -179, et le vide reste du vide', () => {
  // Une rotation ABSOLUE sur un octet : la jonction ne crée pas d'écart.
  const moves = [{ x: 0, y: 0, r: 179.9 }, { x: 0, y: 0, r: -179.9 }, { x: 0, y: 0, r: 180 }, { x: 0, y: 0, r: -180 }];
  const t = J.decoderFantome(J.encoderFantome({ moves })).moves;
  for (let i = 0; i < moves.length; i++) {
    let dr = Math.abs(t[i].r - moves[i].r);
    if (dr > 180) dr = 360 - dr;
    assert.ok(dr < 1.5, 'jonction ' + moves[i].r + ' → ' + t[i].r);
  }
  // Une voiture partie dans le vide a des coordonnées négatives : le décalage
  // du codec les garde (c'est la seule façon d'en obtenir, avant qu'outZone
  // ne la rattrape).
  const loin = J.decoderFantome(J.encoderFantome({ moves: [{ x: -900, y: -1200, r: 0 }] })).moves[0];
  assert.deepStrictEqual([loin.x, loin.y], [-900, -1200]);

  assert.strictEqual(J.encoderFantome({ moves: [] }), '');
  assert.strictEqual(J.decoderFantome(''), null, 'une trace vide n\'est pas un fantôme');
  assert.strictEqual(J.decoderFantome('n\'importe quoi ?'), null);
  assert.strictEqual(J.decoderFantome(undefined), null);
});

// ── Le bouton et le mode ──────────────────────────────────────────────────

test('le bouton du menu est celui que le fichier porte en commentaire', () => {
  const MENU = lire('public/bkiwi/jeu/menu.js');
  const SOURCE = fs.readFileSync(path.join(ROOT, 'Games/burningKiwi/inc/menu.as'), 'latin1');
  // Le commentaire d'origine : identifiant 65, place (-23, 240), et sa phrase.
  assert.match(SOURCE, /\/\/\s*attachButton\(65, "ghost run", skinBt, -23,240,/,
    'le fichier porte bien le bouton en commentaire');
  assert.match(MENU, /J\.attachButton\(65, 'ghost run', skinBt, -23, 240, onPush, undefined, onEnd, onOver, onOut\);/);
  assert.match(MENU, /Rivalisez avec votre pire adversaire: vous !/);
  assert.match(MENU, /onEnd = function \(\) \{ M\.vs\.menuPhase = 3; M\.vs\.gameMode = M\.GHOSTRUN; \};/,
    'il mène au choix libre du circuit, comme le contre-la-montre');
  // Et il est posé APRÈS « elite », à sa place d'origine dans le menu évolution.
  assert.ok(MENU.indexOf("'elite'") < MENU.indexOf("'ghost run'"));

  // Le mode est ouvert : d'époque il dépendait d'un slot que seul le serveur
  // de 2005 posait, et `unlockMode` n'a jamais été appelé pour lui.
  const MOTEUR = lire('public/bkiwi/jeu/moteur.js');
  assert.match(MOTEUR, /if \(mode == M\.TUTORIAL \|\| mode == M\.FRUTICUP \|\| mode == M\.TIMETRIAL \|\| mode == M\.GHOSTRUN\) return true;/);
  const SRC = fs.readFileSync(path.join(ROOT, 'Games/burningKiwi/inc/code.as'), 'latin1');
  assert.ok(!/unlockMode\(\s*GHOSTRUN\s*\)/.test(SRC), 'rien ne débloquait le mode d\'époque');
});

test('le fantôme n\'est plus remplacé à la fin du premier tour', () => {
  const MOTEUR = lire('public/bkiwi/jeu/moteur.js');
  // La ligne d'origine comparait un temps de tour à un temps de course.
  const SRC = fs.readFileSync(path.join(ROOT, 'Games/burningKiwi/inc/code.as'), 'latin1');
  assert.match(SRC, /if \( ghost\.raceTime < previousGhost\.raceTime \|\| previousGhost == undefined \)/,
    'le fichier fait bien la comparaison à chaque fin de tour');
  // Le portage ne la fait plus : la fin de tour ne touche qu'au temps.
  const finDeTour = /\/\/ Mode ghost[\s\S]*?if \(M\.vs\.gameMode == M\.GHOSTRUN\) \{[\s\S]*?\n        \}/.exec(MOTEUR);
  assert.ok(finDeTour, 'le bloc de fin de tour existe');
  assert.match(finDeTour[0], /M\.ghost\.raceTime = car\.vs\.totalTime;/);
  assert.ok(!/M\.previousGhost = M\.ghost;/.test(finDeTour[0]),
    'le fantôme affronté ne se remplace plus en pleine course');
  // Le remplacement se décide à l'arrivée, sur les temps complets.
  assert.match(MOTEUR, /J\.sauverFantome = function \(\) \{/);
  assert.match(MOTEUR, /if \(M\.vs\.giveUp \|\| M\.vs\.useSpecials\) return;/,
    'une course abandonnée ou trichée ne laisse pas de fantôme');
  assert.match(MOTEUR, /if \(M\.previousGhost != null && Number\.isFinite\(M\.fantomeTemps\) && M\.fantomeTemps <= temps\) return;/);
  assert.match(lire('public/bkiwi/jeu/final.js'), /J\.sauverFantome\(\);/);
  // Le fantôme court avec la voiture qui a fait le temps.
  assert.match(MOTEUR, /const ecurie = \(M\.fantomeCar === undefined\) \? M\.vs\.selectedCar : M\.fantomeCar;/);
});

test('la trace ne voyage qu\'en Ghost-Run, jamais avec la fruticard', () => {
  const P = lire('public/bkiwi/plateforme.js');
  assert.match(P, /chargerFantome\(track\) \{/);
  assert.match(P, /const fantome = \(mode === \(M && M\.GHOSTRUN\)\)\s*\n\s*\? this\.chargerFantome\(track\) : Promise\.resolve\(null\);/,
    'le chargement s\'accroche au départ de partie, pas à la connexion');
  assert.match(P, /\/api\/bkiwi\/ghost\?sid=/);
  // Elle n'est pas rangée dans une case de fruticard : les slots restent trois.
  assert.match(P, /for \(let i = 0; i < 3; i\+\+\) this\.slots\[i\]/);
  assert.ok(!/slot.*fantome|fantome.*slotId/i.test(P), 'aucune case de fruticard pour la trace');
  // Et la page charge le codec.
  assert.match(lire('public/bkiwi/index.html'), /<script src="\/bkiwi\/jeu\/fantome\.js"><\/script>/);
});

// ── Les routes ────────────────────────────────────────────────────────────

const PORT = 3437;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let serveur;

before(async () => {
  serveur = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-de-test', XMLSOCKET_PORT: '5136', FRUTISCORE_PORT: '5137',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serveur.stdout.on('data', () => {});
  serveur.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=bkiwi')).ok) return; } catch { /* pas encore */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (serveur) serveur.kill('SIGKILL'); });

async function sidPour(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const poser = (sid, corps) => fetch(BASE + '/api/bkiwi/ghost', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(Object.assign({ sid }, corps)).toString(),
}).then(async (r) => ({ code: r.status, corps: await r.json() }));
const relire = (sid, track) =>
  fetch(`${BASE}/api/bkiwi/ghost?sid=${encodeURIComponent(sid)}&track=${track}`).then(async (r) => ({ code: r.status, corps: await r.json() }));

test('le serveur ne garde qu\'un fantôme par circuit : celui du meilleur temps', async () => {
  const sid = await sidPour('fantomin');
  const trace = (n) => J.encoderFantome({ moves: Array.from({ length: n }, (_, i) => ({ x: 100 + i, y: 200 + i, r: i % 90 })) });

  // Rien au départ.
  assert.deepStrictEqual((await relire(sid, 0)).corps, { ok: true, ghost: null });

  // Une première course : elle s'installe.
  let r = await poser(sid, { track: 0, car: 2, time: 90000, data: trace(200) });
  assert.deepStrictEqual(r.corps, { ok: true, saved: true, t: 90000 });
  let lu = (await relire(sid, 0)).corps;
  assert.strictEqual(lu.ghost.t, 90000);
  assert.strictEqual(lu.ghost.c, 2);
  assert.strictEqual(J.decoderFantome(lu.ghost.p).moves.length, 200, 'la trace revient entière');

  // Une course PLUS LENTE ne la remplace pas.
  r = await poser(sid, { track: 0, car: 3, time: 95000, data: trace(300) });
  assert.deepStrictEqual(r.corps, { ok: true, saved: false, t: 90000 });
  assert.strictEqual((await relire(sid, 0)).corps.ghost.c, 2, 'l\'ancien fantôme tient sa place');

  // Une course PLUS RAPIDE la remplace, écurie comprise.
  r = await poser(sid, { track: 0, car: 4, time: 61234, data: trace(150) });
  assert.deepStrictEqual(r.corps, { ok: true, saved: true, t: 61234 });
  lu = (await relire(sid, 0)).corps;
  assert.strictEqual(lu.ghost.t, 61234);
  assert.strictEqual(lu.ghost.c, 4);
  assert.strictEqual(J.decoderFantome(lu.ghost.p).moves.length, 150);

  // Chaque circuit a le sien, et ils ne se mélangent pas.
  await poser(sid, { track: 3, car: 0, time: 70000, data: trace(80) });
  assert.strictEqual((await relire(sid, 3)).corps.ghost.t, 70000);
  assert.strictEqual((await relire(sid, 0)).corps.ghost.t, 61234);
  assert.strictEqual((await relire(sid, 5)).corps.ghost, null);

  // Et le fantôme d'un autre joueur n'est pas le nôtre.
  const autre = await sidPour('fantomax');
  assert.strictEqual((await relire(autre, 0)).corps.ghost, null);
});

test('rien d\'autre n\'entre : ni sans session, ni hors circuit, ni sans trace', async () => {
  const sid = await sidPour('fantomir');
  const bonne = J.encoderFantome({ moves: [{ x: 1, y: 2, r: 3 }] });

  assert.strictEqual((await relire('', 0)).code, 401);
  assert.strictEqual((await poser('', { track: 0, time: 1000, data: bonne })).code, 401);

  for (const track of [-1, 6, 99, 'vert', '']) {
    assert.strictEqual((await relire(sid, track)).code, 400, 'lecture du circuit ' + track);
    assert.strictEqual((await poser(sid, { track, time: 1000, data: bonne })).code, 400, 'écriture du circuit ' + track);
  }
  for (const time of [0, -5, 3600001, 'vite', '']) {
    assert.strictEqual((await poser(sid, { track: 1, time, data: bonne })).code, 400, 'temps ' + time);
  }
  // Une trace vide n'est pas un fantôme ; une trace démesurée non plus.
  assert.strictEqual((await poser(sid, { track: 1, time: 1000, data: '' })).code, 400);
  assert.strictEqual((await poser(sid, { track: 1, time: 1000, data: 'Q'.repeat(256 * 1024 + 4) })).code, 400);
  assert.strictEqual((await relire(sid, 1)).corps.ghost, null, 'rien n\'a été posé');

  // L'écurie est bornée aux cinq du jeu.
  await poser(sid, { track: 2, car: 42, time: 1000, data: bonne });
  assert.strictEqual((await relire(sid, 2)).corps.ghost.c, 4, 'une écurie hors table se borne');
});

test('la trace a sa table, et le remplacement s\'y décide en une écriture', () => {
  const DB = lire('db.js');
  assert.match(DB, /CREATE TABLE IF NOT EXISTS bkiwi_ghosts \(/);
  assert.match(DB, /PRIMARY KEY \(user_id, track\)/);
  // Le « WHERE race_time > $4 » du upsert : deux onglets qui finissent en même
  // temps ne peuvent pas se voler la place, c'est la base qui tranche.
  assert.match(DB, /ON CONFLICT \(user_id, track\) DO UPDATE\s*\n\s*SET car = \$3, race_time = \$4, data = \$5, updated_at = now\(\)\s*\n\s*WHERE bkiwi_ghosts\.race_time > \$4/);
  assert.match(DB, /async function getBkiwiGhost\(userId, track\)/);
  assert.match(DB, /async function upsertBkiwiGhost\(userId, track, car, raceTime, data\)/);
});
