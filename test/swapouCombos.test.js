'use strict';
/*
 * SWAPOU — LES COMBOS COMPTÉS PAR LE SERVEUR, de bout en bout.
 * ═══════════════════════════════════════════════════════════
 *
 * Le cocktail Swapolotof (le onzième combo) et les autres se comptaient dans
 * la fiche (`$combos` du slot 0), que le navigateur écrit seul : n'importe
 * qui pouvait s'en offrir cent, et le picto avec. Désormais :
 *
 *   · le rejeu compte les combos de chaque partie validée, et le serveur les
 *     ajoute au compteur du joueur (swapou_combos) — une fois par partie ;
 *   · le picto d'un combo vient du serveur, au cinquième ;
 *   · la fiche que le jeu sauvegarde est réécrite avec ces valeurs : des
 *     `$combos` forgés, des cases de pictos cochées à la main, n'y restent
 *     pas, et ne donnent aucun picto ;
 *   · une partie refusée ne compte rien ; une partie d'ESSAI (le seul autre
 *     mode où les combos tombent) compte, une fois vérifiée ;
 *   · les compteurs d'avant (« hérités ») sont gardés à part, montrés à
 *     l'admin face aux vérifiés ; il décide : remise à zéro, ou ne garder
 *     que ce que couvrent les parties rejouées d'avant.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const A = require('./aideSwapou.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3737;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-swapou-combos';
const DB = process.env.TEST_DATABASE_URL_SWAPOU_COMBOS || 'postgres://postgres@127.0.0.1:5433/frutiparc_swapou_combos';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };
const ADMIN = Object.assign({ 'x-admin-key': CLE }, H);
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-swapou-combos-'));

let proc = null, dispo = false;
async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch {} return false; }
}
async function sql(q, params) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}
before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5737', FRUTISCORE_PORT: '5738', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const rows = await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'swapou_combos'`);
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body, headers) => fetch(BASE + url, { method: 'POST', headers: headers || H, body: JSON.stringify(body) });
async function compte(pseudo) {
  await post('/api/auth/register', { username: pseudo, password: 'secret123' });
  const j = await (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).json();
  assert.ok(j.sid, 'connecté : ' + JSON.stringify(j));
  return j.sid;
}
const sb = A.bac();
const pictos = async (u) => (await sql(
  `SELECT i.item_name FROM user_game_items i JOIN users u ON u.id = i.user_id
    WHERE LOWER(u.username) = $1 AND i.item_name LIKE '$combo%' ORDER BY 1`, [u])).map((r) => r.item_name);
const compteurs = async (u) => (await sql('SELECT * FROM swapou_combos WHERE username = $1', [u]))[0];
async function sauver(sid, fiche) {
  const r = await A.formulaire(BASE, '/api/saveFrutiSlot', { sid, game: 'swapou2', slotId: '0', data: JSON.stringify(fiche) });
  assert.equal(await r.text(), 'ok=1');
}
async function lireFiche(sid) {
  const t = await (await fetch(BASE + '/api/loadFrutiSlots?game=swapou2&sid=' + sid)).text();
  return JSON.parse(new URLSearchParams(t).get('slot0'));
}
const FICHE = () => ({ $chars: [true, true, false, false, false, false, false, false, false], $record: 0, $classic_record: 0, $swap: 0, $items: [], $combos: [] });
const somme = (a, b) => a.map((x, i) => x + (b[i] || 0));

test('pas de picto de combo sans partie : la fiche forgée est réécrite', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('forgeur');
  const f = FICHE();
  f.$combos = [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 99];       // cent cocktails swapolotof
  for (let i = 0; i < 46; i++) f.$items[i] = true;    // toutes les cases cochées
  await sauver(sid, f);
  assert.deepEqual(await pictos('forgeur'), [], 'aucun picto de combo');
  const lue = await lireFiche(sid);
  assert.deepEqual(lue.$combos, new Array(11).fill(0), 'les compteurs sont ceux du serveur');
  for (let n = 0; n < 11; n++) assert.ok(!lue.$items[27 + n], 'case de picto ' + n + ' décochée');
  assert.equal(lue.$items[0], true, 'les autres pictos de la fiche passent tels quels (pas de mon ressort)');
  assert.equal(lue.$chars[1], true, 'le reste de la fiche est intact');
  const [row] = await sql(`SELECT f.data FROM fruti_slots f JOIN users u ON u.id = f.user_id WHERE u.username = 'forgeur' AND f.game = 'swapou2'`);
  assert.deepEqual(JSON.parse(row.data).$combos, new Array(11).fill(0), 'en base aussi');
});

test('une partie validée : ses combos comptent, au cinquième le picto ; la fiche suit', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('cocktail');
  await sauver(sid, FICHE());
  const p = await A.partieHonnete(BASE, sql, sid, 1, { sb });
  assert.equal(p.rep.json.ok, true, JSON.stringify(p.rep.json));
  assert.ok(p.combos.some((x) => x > 0), 'le bot a fait des combos');
  const c = await compteurs('cocktail');
  assert.deepEqual(c.verifies, p.combos, 'le serveur compte ce que le jeu a compté');
  assert.deepEqual(p.rep.json.fiche.combos, p.combos, 'la réponse le dit au jeu');
  const attendus = p.combos.map((x, n) => (x >= 5 ? '$combo' + String(n + 1).padStart(2, '0') : null)).filter(Boolean).sort();
  assert.deepEqual(await pictos('cocktail'), attendus, 'le picto au cinquième, et lui seul');
  // La fiche stockée a suivi, sans attendre une sauvegarde du jeu.
  const lue = await lireFiche(sid);
  assert.deepEqual(lue.$combos, p.combos);
  // Une fiche forgée APRÈS : réécrite à la vérité, les pictos gagnés restent.
  const f = FICHE();
  f.$combos = new Array(11).fill(50);
  f.$items = new Array(46).fill(true);
  await sauver(sid, f);
  const relue = await lireFiche(sid);
  assert.deepEqual(relue.$combos, p.combos);
  for (let n = 0; n < 11; n++) assert.equal(!!relue.$items[27 + n], p.combos[n] >= 5, 'picto ' + n);
  assert.deepEqual(await pictos('cocktail'), attendus, 'aucun picto de plus');
  // La partie ne compte qu'une fois : le rejeu de l'admin ne recompte pas.
  await post('/api/admin/swapou/parties/' + p.partie.id + '/rejouer', {}, ADMIN);
  assert.deepEqual((await compteurs('cocktail')).verifies, p.combos);
  // Une deuxième partie s'additionne.
  const p2 = await A.partieHonnete(BASE, sql, sid, 3, { sb });
  assert.equal(p2.rep.json.ok, true);
  assert.deepEqual((await compteurs('cocktail')).verifies, somme(p.combos, p2.combos));
});

test('une partie refusée ne compte aucun combo', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('refuse');
  // Gonflée.
  const partie = await A.nouvellePartie(BASE, sid);
  const j = A.jouer(sb, partie, 0);
  await A.vieillir(sql, partie.id, j.pf.duree + 1000);
  assert.equal((await A.rendre(BASE, sid, j.score + 1, j.pf, 0)).json.ok, false);
  // Trop rapide (graine non vieillie).
  const p2 = await A.nouvellePartie(BASE, sid);
  const j2 = A.jouer(sb, p2, 0);
  assert.equal((await A.rendre(BASE, sid, j2.score, j2.pf, 0)).json.ok, false);
  // Graine locale.
  const j3 = A.jouer(sb, null, 0);
  assert.equal((await A.rendre(BASE, sid, j3.score, j3.pf, 0)).json.ok, false);
  const c = await compteurs('refuse');
  assert.ok(!c || c.verifies.every((x) => !x), 'rien de compté : ' + JSON.stringify(c));
  assert.deepEqual(await pictos('refuse'), []);
});

test('une partie d’essai vérifiée compte ses combos, sans rien classer', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('essayeur');
  const partie = await A.nouvellePartie(BASE, sid, true);
  const j = A.jouer(sb, partie, 2);
  await A.vieillir(sql, partie.id, j.pf.duree + 1000);
  const r = await (await A.formulaire(BASE, '/api/swapou/essai', { sid, score: j.score, data: 'S2:',
    partie: partie.id, coups: j.pf.coups, duree: j.pf.duree })).json();
  assert.equal(r.ok, true);
  assert.equal(r.verifiee, true);
  assert.deepEqual(r.fiche.combos, j.combos);
  assert.deepEqual((await compteurs('essayeur')).verifies, j.combos);
  const [l] = await sql('SELECT essai, classe, verdict FROM swapou_parties WHERE id = $1', [partie.id]);
  assert.deepEqual([l.essai, l.classe, l.verdict], [true, false, 'conforme']);
  const sc = await sql(`SELECT 1 FROM scores s JOIN users u ON u.id = s.user_id WHERE u.username = 'essayeur'`);
  assert.equal(sc.length, 0, 'un essai ne classe rien');
  // Un essai forgé : rien.
  const p2 = await A.nouvellePartie(BASE, sid, true);
  const j2 = A.jouer(sb, p2, 2);
  await A.vieillir(sql, p2.id, j2.pf.duree + 1000);
  const r2 = await (await A.formulaire(BASE, '/api/swapou/essai', { sid, score: j2.score + 50, data: 'S2:',
    partie: p2.id, coups: j2.pf.coups, duree: j2.pf.duree })).json();
  assert.equal(r2.verifiee, false);
  assert.deepEqual((await compteurs('essayeur')).verifies, j.combos, 'inchangé');
});

test('les compteurs hérités : gardés à part, montrés à l’admin, et la décision lui revient', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('ancien');
  // La partie qu'il va jouer, connue d'avance (le bot, sur sa graine) : on
  // choisit un combo qu'elle fait d'une à quatre fois.
  const partie = await A.nouvellePartie(BASE, sid);
  const j = A.jouer(sb, partie, 0);
  const k = j.combos.findIndex((x) => x >= 1 && x <= 4);
  assert.ok(k >= 0, 'un combo rare dans la partie : ' + JSON.stringify(j.combos));
  // Sa fiche d'avant (le navigateur l'écrivait seul) : de quoi atteindre le
  // cinquième de ce combo avec la partie, et six cocktails swapolotof.
  const herites = new Array(11).fill(0);
  herites[k] = 5 - j.combos[k];
  herites[10] = 6;
  const [u] = await sql(`SELECT id FROM users WHERE username = 'ancien'`);
  const vieille = FICHE();
  vieille.$combos = herites.slice();
  await sql(`INSERT INTO fruti_slots (user_id, game, slot_id, data) VALUES ($1, 'swapou2', 0, $2)`, [u.id, JSON.stringify(vieille)]);
  // Le jeu charge sa fiche, puis la sauvegarde : rien n'est perdu.
  await sauver(sid, await lireFiche(sid));
  let lue = await lireFiche(sid);
  assert.deepEqual(lue.$combos, herites, 'l’héritage n’est pas effacé d’office');
  // La partie validée s'y ajoute — et atteint le cinquième : le picto.
  await A.vieillir(sql, partie.id, j.pf.duree + 1000);
  assert.equal((await A.rendre(BASE, sid, j.score, j.pf, 0)).json.ok, true);
  const c = await compteurs('ancien');
  assert.deepEqual(c.herites, herites);
  assert.deepEqual(c.verifies, j.combos);
  const picto = '$combo' + String(k + 1).padStart(2, '0');
  assert.ok((await pictos('ancien')).includes(picto), 'cinquième atteint avec l’héritage : ' + picto);
  assert.ok(!(await pictos('ancien')).includes('$combo11'), 'aucun cocktail sans partie');
  lue = await lireFiche(sid);
  assert.deepEqual(lue.$combos, somme(herites, j.combos), 'la fiche montre hérités + vérifiés');
  // L'admin voit les deux colonnes.
  assert.equal((await fetch(BASE + '/api/admin/swapou/combos')).status, 403);
  const vue = await (await fetch(BASE + '/api/admin/swapou/combos', { headers: ADMIN })).json();
  const ligne = vue.joueurs.find((x) => x.username === 'ancien');
  assert.deepEqual(ligne.herites, herites);
  assert.deepEqual(ligne.verifies, j.combos);
  assert.deepEqual(ligne.swapolotof, { herites: 6, verifies: 0 });
  assert.equal(vue.joueurs[0].username, 'ancien', 'le plus gros écart de cocktails en tête');
  // « Ne garder que ce que couvrent les parties rejouées d'avant » : une
  // partie du temps du mode observateur, conforme, jamais comptée.
  const vp = A.jouer(sb, { id: 'v', graine: 777 }, 0);
  await sql(`INSERT INTO swapou_parties (id, username, graine, source, perso, fini_le, score_declare, score_rejoue, verdict, coups, nb_coups)
             VALUES ('vieille1', 'ancien', 777, 'serveur', 0, now() - interval '3 days', $1, $1, 'conforme', $2, 10)`,
  [vp.score, vp.pf.coups]);
  const dec = await (await post('/api/admin/swapou/combos/ancien', { action: 'couverts' }, ADMIN)).json();
  assert.ok(dec.ok, JSON.stringify(dec));
  assert.equal(dec.parties, 1);
  assert.deepEqual(dec.herites, herites.map((x, i) => Math.min(x, vp.combos[i])));
  assert.match(dec.note, /1 partie/);
  assert.ok((await pictos('ancien')).includes(picto), 'sans demande, les pictos restent');
  // Remise à zéro, pictos repris : celui du combo k n'est plus justifié.
  const zero = await (await post('/api/admin/swapou/combos/ancien', { action: 'zero', retirerPictos: true }, ADMIN)).json();
  assert.ok(zero.ok);
  assert.deepEqual(zero.herites, new Array(11).fill(0));
  assert.deepEqual(zero.pictosRetires, [picto]);
  assert.ok(!(await pictos('ancien')).includes(picto));
  lue = await lireFiche(sid);
  assert.deepEqual(lue.$combos, j.combos, 'la fiche ne montre plus que les combos vérifiés');
  assert.ok(!lue.$items[27 + k]);
});

test('reclasser à la main une partie écartée compte ses combos, une fois', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('reclasse');
  const partie = await A.nouvellePartie(BASE, sid);
  const j = A.jouer(sb, partie, 5);
  const r = await A.rendre(BASE, sid, j.score, j.pf, 5);       // trop rapide : refusée
  assert.equal(r.json.ok, false);
  assert.ok(!(await compteurs('reclasse')) || (await compteurs('reclasse')).verifies.every((x) => !x));
  const cl = await (await post('/api/admin/swapou/parties/' + partie.id + '/classer', {}, ADMIN)).json();
  assert.ok(cl.ok, JSON.stringify(cl));
  assert.equal(cl.combos, true);
  assert.deepEqual((await compteurs('reclasse')).verifies, j.combos);
  await post('/api/admin/swapou/parties/' + partie.id + '/classer', {}, ADMIN);
  assert.deepEqual((await compteurs('reclasse')).verifies, j.combos, 'pas deux fois');
});
