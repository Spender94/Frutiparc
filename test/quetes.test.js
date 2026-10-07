'use strict';
/*
 * LES QUÊTES DE GROMELIN
 * ══════════════════════
 *
 * Le module pur (quetes.js) : la semaine (lundi minuit, heure de Paris, heure
 * d'été comprise), le tirage (composition, familles, reproductible, retouches
 * de l'admin), l'avancement de chaque type de quête, la parole de Gromelin.
 *
 * Puis le parc entier, sur Postgres :
 *   · fermées par défaut ; ouvertes à un testeur, et à lui seul ;
 *   · un score classé, une épreuve de Kaluga déclarée par le jeu : la quête
 *     avance, se fait, et Gromelin paie TOUT DE SUITE — une seule fois, même
 *     quand l'événement revient, même après un redémarrage ;
 *   · ce que dit Gromelin, ce qui est « neuf », la visite ;
 *   · l'admin : réglages persistants, semaine retouchée, seuil abaissé qui
 *     paie aussitôt, remise à zéro d'un testeur ;
 *   · la semaine qui tourne : un nouveau tirage, l'avancement repart de zéro.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const Q = require(path.join(ROOT, 'quetes.js'));

// ── Le module ────────────────────────────────────────────────────────────────

test('la semaine : du lundi au dimanche, et elle finit lundi à minuit, heure de Paris', () => {
  assert.equal(Q.lundiDe('2026-10-05'), '2026-10-05');
  assert.equal(Q.lundiDe('2026-10-07'), '2026-10-05');
  assert.equal(Q.lundiDe('2026-10-11'), '2026-10-05', 'le dimanche est encore de la semaine');
  assert.equal(Q.lundiDe('2026-10-12'), '2026-10-12');
  // Heure d'été : minuit à Paris = 22 h UTC ; heure d'hiver : 23 h UTC.
  assert.equal(new Date(Q.finDeSemaine('2026-10-05')).toISOString(), '2026-10-11T22:00:00.000Z');
  // Le changement d'heure tombe dans la semaine du 19 (dimanche 25 octobre).
  assert.equal(new Date(Q.finDeSemaine('2026-10-19')).toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(Q.semaineLisible('2026-10-05'), 'du 5 au 11 octobre');
  assert.equal(Q.semaineLisible('2026-09-28'), 'du 28 septembre au 4 octobre');
});

test('le tirage : 2 faciles, 2 moyennes, 1 difficile, des jeux différents, reproductible', () => {
  for (const lundi of ['2026-10-05', '2026-10-12', '2026-10-19', '2027-01-04']) {
    const t = Q.tirer({}, 'gromelin:' + lundi);
    assert.deepEqual(t.map((q) => q.niveau), ['facile', 'facile', 'moyenne', 'moyenne', 'difficile']);
    assert.equal(new Set(t.map((q) => q.famille)).size, 5, lundi + ' : ' + t.map((q) => q.id));
    assert.equal(new Set(t.map((q) => q.etiquette)).size, 5, 'cinq jeux différents : ' + t.map((q) => q.id));
    assert.ok(t.every((q) => q.actif), 'seulement des quêtes actives');
    assert.deepEqual(Q.tirer({}, 'gromelin:' + lundi).map((q) => q.id), t.map((q) => q.id), 'même graine, même tirage');
  }
});

test('le catalogue : des résultats, plus de volumes', () => {
  for (const q of Q.CATALOGUE) {
    assert.ok(['mesure', 'record', 'action'].includes(q.type), q.id + ' : ' + q.type);
    if (q.type === 'action') assert.ok(['kiloute', 'medaille'].includes(q.params.action), 'une victoire, pas un compteur : ' + q.id);
    if (q.type === 'mesure') {
      assert.ok(Q.MESURES[q.params.mesure], q.id + ' : mesure connue');
      assert.ok(Number(q.params.seuil) > 0, q.id + ' : un seuil');
    }
  }
  assert.ok(!JSON.stringify(Q.CATALOGUE).match(/"(parties|jours)"|chatMsg|forumPost|"pari"/), 'ni parties, ni jours, ni messages, ni paris');
  // Les repères viennent des jeux : objectifs de niveau de Kaluga, temps de l'ordinateur à MotionBall.
  assert.deepEqual(Q.reperes(Q.MESURES['kaluga-chrono0']).map((r) => r.texte), ['1 min']);
  assert.deepEqual(Q.reperes(Q.MESURES['mb2-course1']).map((r) => [r.nom, r.texte]),
    [['Or (ordinateur)', '4 min'], ['Argent', '4 min 40 s'], ['Bronze', '5 min 20 s']]);
  assert.equal(Q.titre(Q.definition('mb2-course-verte-argent', {})), 'Finis la course verte en moins de 4 min 40 s');
  assert.equal(Q.titre(Q.definition('kaluga-chrono-difficile', {})), 'Finis le Chrono difficile en moins de 45 s');
  // Aucun titre ne répète son unité (« 20 épreuves épreuves »).
  for (const x of Q.catalogue({})) assert.doesNotMatch(Q.titre(x), /(?:^|\s)(\p{L}{3,}) \1(?:\s|$)/u, Q.titre(x));
  for (const m of Object.values(Q.MESURES)) {
    const t = m.titre.replace('{seuil}', Q.formater(m, 12));
    assert.doesNotMatch(t, /(points|épreuves|coups|victoires|cm|salle|niveau) \1/, t);
  }
  // Chaque mode déclaré par un jeu est une mesure, avec sa borne.
  for (const k of ['kaluga:chrono0', 'kaluga:survie3', 'kaluga:invasion1', 'kaluga:piste2', 'kaluga:defi2', 'kaluga:epreuve6',
    'kaluga:triathlon', 'kaluga:heptathlon', 'mb2:course6', 'mb2:classique', 'mb2:aventure4', 'minifever:fever', 'swapou2:classique']) {
    assert.ok(Q.MODES[k], k);
  }
});

test('les valeurs : écrites et relues dans l’unité de leur mesure', () => {
  const M = Q.MESURES;
  assert.equal(Q.formater(M['kaluga-chrono0'], 45230), '45,23 s');
  assert.equal(Q.formater(M['kaluga-chrono0'], 65000), '1 min 05 s');
  assert.equal(Q.formater(M['mb2-course1'], 28050), '4 min 40,50 s');
  assert.equal(Q.formater(M['swapou-challenge'], 25000), '25 000 points');
  assert.equal(Q.formater(M['mb2-challenge-salles'], 80), '80 %');
  for (const [k, texte, attendu] of [
    ['mb2-course1', '4:40', 28000], ['mb2-course1', '4:40,5', 28050], ['mb2-course1', '4 min 40 s', 28000], ['mb2-course1', '280', 28000],
    ['kaluga-chrono0', '45,5', 45500], ['kaluga-chrono0', '1:05', 65000], ['kaluga-chrono0', '1 min', 60000],
    ['swapou-challenge', '25 000', 25000], ['swapou-challenge', '25 000 points', 25000], ['minifever-arcade0', '20 épreuves', 20],
  ]) assert.equal(Q.lireValeur(M[k], texte), attendu, k + ' ← ' + texte);
  assert.equal(Q.lireValeur(M['mb2-course1'], 'bof'), null);
  assert.equal(Q.lireValeur(M['swapou-challenge'], ''), null);
});

test('les retouches de l\'admin : composition, niveau, seuil, quête désactivée, quêtes créées', () => {
  const R = Q.reglagesNormalises({
    composition: { facile: 1, moyenne: 0, difficile: 3 },
    catalogue: { 'swapou-25000': { seuil: 30000, niveau: 'moyenne' }, kiloute: { actif: false } },
    perso: [
      { id: 'perso-1', mesure: 'bkiwi-circuit0', seuil: 72000, niveau: 'difficile' },
      { id: 'perso-2', mesure: 'inconnue', seuil: 1, niveau: 'facile' },
      { id: 'perso-3', mesure: 'mb2-course1', seuil: 0, niveau: 'facile' },
      { id: 'pas-perso', mesure: 'mb2-course1', seuil: 1, niveau: 'facile' },
    ],
  });
  assert.deepEqual(R.perso.map((x) => x.id), ['perso-1'], 'seules les quêtes créées valides restent');
  const t = Q.tirer(R, 'g');
  assert.deepEqual(t.map((q) => q.niveau), ['facile', 'difficile', 'difficile', 'difficile']);
  assert.ok(!t.some((q) => q.id === 'kiloute'));
  const d = Q.definition('swapou-25000', R);
  assert.equal(d.niveau, 'moyenne');
  assert.equal(Q.titre(d), 'Dépasse 30 000 points à Swapou');
  const p = Q.definition('perso-1', R);
  assert.equal(Q.titre(p), 'Boucle Green Hill en moins de 1 min 12 s');
  assert.equal(p.etiquette, 'bkiwi');
  assert.ok(Q.catalogue(R).some((x) => x.id === 'perso-1'));
  // Un titre choisi par l'admin remplace celui de la mesure.
  const R2 = Q.reglagesNormalises({ perso: [{ id: 'perso-4', mesure: 'mb2-course1', seuil: 27000, niveau: 'moyenne', titre: 'La verte en {seuil}, chiche ?' }] });
  assert.equal(Q.titre(Q.definition('perso-4', R2)), 'La verte en 4 min 30 s, chiche ?');
  // Des réglages absurdes retombent sur les défauts.
  const B = Q.reglagesNormalises({ ouverture: 'n’importe', gains: { facile: -3, moyenne: 'x', difficile: 20000 }, testeurs: [' Papaye ', 'papaye', ''] });
  assert.equal(B.ouverture, 'ferme');
  assert.deepEqual(B.gains, { facile: 5, moyenne: 10, difficile: 20 });
  assert.deepEqual(B.testeurs, ['papaye']);
});

test('l’avancement des quêtes à mesure : le meilleur de la semaine, dans le bon sens', () => {
  const jour = '2026-10-06';
  // Au score (classement) : le meilleur, sur le bon classement seulement.
  const sw = Q.definition('swapou-25000', {});
  let e = Q.appliquer(sw, {}, { type: 'score', rk: 'swapou2_classic', v: 21340 }, jour);
  assert.deepEqual(e, { m: 21340 });
  assert.equal(Q.appliquer(sw, e, { type: 'score', rk: 'swapou2_classic', v: 9000 }, jour), null, 'moins bien : rien ne change');
  assert.equal(Q.appliquer(sw, e, { type: 'score', rk: 'snake3_classic', v: 99999 }, jour), null, 'un autre jeu : rien');
  assert.equal(Q.estFaite(sw, e), false);
  assert.equal(Q.avancement(sw, e).ligne, 'ton meilleur cette semaine : 21 340 points');
  e = Q.appliquer(sw, e, { type: 'score', rk: 'swapou2_classic', v: 25000 }, jour);
  assert.equal(Q.estFaite(sw, e), true);
  assert.equal(Q.avancement(sw, e).pc, 1);
  // Un temps (déclaré par le jeu) : plus petit = meilleur.
  const verte = Q.definition('mb2-course-verte-or', {});
  let t = Q.appliquer(verte, {}, { type: 'mode', jeu: 'mb2', mode: 'course1', v: 26000 }, jour);
  assert.equal(Q.estFaite(verte, t), false);
  assert.equal(Q.appliquer(verte, t, { type: 'mode', jeu: 'mb2', mode: 'course1', v: 27000 }, jour), null, 'plus lent : rien');
  assert.equal(Q.appliquer(verte, t, { type: 'mode', jeu: 'mb2', mode: 'course0', v: 1000 }, jour), null, 'une autre course : rien');
  assert.equal(Q.avancement(verte, t).ligne, 'ton meilleur cette semaine : 4 min 20 s');
  assert.ok(Q.avancement(verte, t).pc > 0.9 && Q.avancement(verte, t).pc < 1);
  t = Q.appliquer(verte, t, { type: 'mode', jeu: 'mb2', mode: 'course1', v: 24000 }, jour);
  assert.ok(Q.estFaite(verte, t), 'pile 4 min : c’est fait');
  // Le palier de Mini-Fever voyage dans la donnée ; le score se ramène en épreuves.
  const mf = Q.definition('minifever-arcade-facile', {});
  assert.equal(Q.appliquer(mf, {}, { type: 'score', rk: 'minifever_arcade', v: 800, data: '1' }, jour), null, 'un autre palier : rien');
  const f = Q.appliquer(mf, {}, { type: 'score', rk: 'minifever_arcade', v: 400, data: '0' }, jour);
  assert.deepEqual(f, { m: 40 });
  assert.ok(Q.estFaite(mf, f));
  // Le Challenge de MotionBall : la part des salles, et le poulpe.
  const salles = Q.definition('mb2-salles-50', {});
  assert.deepEqual(Q.appliquer(salles, {}, { type: 'score', rk: 'mb2_classic', v: 41 }, jour), { m: 42 });
  assert.deepEqual(Q.appliquer(salles, {}, { type: 'score', rk: 'mb2_classic', v: 15300 }, jour), { m: 100 });
  const poulpe = Q.definition('mb2-poulpe', {});
  assert.equal(Q.estFaite(poulpe, Q.appliquer(poulpe, {}, { type: 'score', rk: 'mb2_classic', v: 99 }, jour)), false);
  assert.equal(Q.avancement(poulpe, {}).ligne, 'pas encore vaincu cette semaine');
  assert.ok(Q.estFaite(poulpe, Q.appliquer(poulpe, {}, { type: 'score', rk: 'mb2_classic', v: 12500 }, jour)));
  // Le record d'épreuve, toujours là.
  const rec = Q.definition('vers-record', {});
  assert.equal(Q.appliquer(rec, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 500 }, jour), null, 'sans record, rien');
  const r = Q.appliquer(rec, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 640, record: true }, jour);
  assert.ok(Q.estFaite(rec, r));
  assert.equal(Q.avancement(rec, r).ligne, 'record battu : 640 cm');
  // Les anciens types (une semaine tirée avant la refonte) restent lisibles.
  const vieux = { id: 'vieux', type: 'parties', params: { jeu: 'snake3', n: 1 }, titre: 'Joue {n} partie' };
  assert.ok(Q.estFaite(vieux, Q.appliquer(vieux, {}, { type: 'partie', jeu: 'snake3' }, jour)));
});

test('le calibrage : où se situe un seuil parmi les meilleurs de chacun', () => {
  const m = Q.MESURES['mb2-course1'];
  const c = Q.calibrer(m, [25000, 27000, 30000, 33000, 40000], 28000);
  assert.equal(c.joueurs, 5);
  assert.equal(c.meilleur, 25000);
  assert.equal(c.atteint, 2);
  assert.match(c.texte, /4 min 40 s : atteint par 2 \(40 %\)/);
  assert.equal(Q.calibrer(m, []).joueurs, 0);
});

test('une déclaration de mode : connue et vraisemblable, ou refusée', () => {
  assert.deepEqual(Q.modeRecevable('kaluga', 'epreuve0', '412.5'), { jeu: 'kaluga', mode: 'epreuve0', v: 412.5 });
  assert.equal(Q.modeRecevable('kaluga', 'epreuve9', 1), null);
  assert.equal(Q.modeRecevable('swapou2', 'epreuve0', 1), null);
  assert.equal(Q.modeRecevable('kaluga', 'epreuve0', -1), null);
  assert.equal(Q.modeRecevable('kaluga', 'epreuve0', 1e9), null);
  assert.equal(Q.modeRecevable('kaluga', 'epreuve0', 'abc'), null);
  assert.deepEqual(Q.modeRecevable('mb2', 'course1', 27000), { jeu: 'mb2', mode: 'course1', v: 27000 });
  assert.equal(Q.modeRecevable('mb2', 'course1', 9e9), null, 'au-delà de la borne');
});

test('Gromelin parle : ses répliques, leurs trous remplis', () => {
  const t = Q.parole('faite', { titre: 'Place un Prunostic', gain: 5 }, () => 0);
  assert.match(t, /« Place un Prunostic »/);
  assert.match(t, /<em>5 kikooz<\/em>/);
  assert.doesNotMatch(Q.parole('semaine', { n: 5 }, () => 0.99), /\{n\}/);
  for (const cle of Object.keys(Q.PAROLES)) for (const l of Q.PAROLES[cle]) {
    assert.equal((l.match(/<em>/g) || []).length, (l.match(/<\/em>/g) || []).length, l);
  }
});

test('le client : un message s’écrit lettre à lettre, ses balises toujours refermées', () => {
  globalThis.window = globalThis;
  require(path.join(ROOT, 'public/js/quetes-light.js'));
  const L = globalThis.QuetesLight;
  const m = '<em>Grumpf.</em> Te revoilà. <em>10 kikooz</em> &amp; rien d’autre.';
  assert.equal(L._longueur(m), 'Grumpf. Te revoilà. 10 kikooz & rien d’autre.'.length);
  assert.equal(L._debut(m, 3), '<em>Gru</em>');
  assert.equal(L._debut(m, 9), '<em>Grumpf.</em> T');
  assert.equal(L._debut(m, 999), m);
  const c = L._carte({ id: 'x', niveau: 'difficile', niveauNom: 'Difficile', gain: 20, titre: 'A <b>', detail: 'd', ligne: '0 / 1', pc: 0.5,
    fait: true, etiquette: { nom: 'Swapou', couleur: '#E2862A' } });
  assert.match(c, /A &lt;b&gt;/, 'le titre est échappé');
  assert.match(c, /qt-tampon">FAIT/);
  assert.match(c, /\+20/);
  assert.equal((c.match(/<i class="on">/g) || []).length, 3);
});

test('le light : la tuile, la feuille, le script, et le bureau qui adopte la feuille', () => {
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(LIGHT, /id="tuile-quetes" style="display:none"/);
  assert.match(LIGHT, /<script src="\/js\/quetes-light.js"><\/script>/);
  assert.match(LIGHT, /<link rel="stylesheet" href="\/quetes.css">/);
  assert.match(LIGHT, /id="quetes-sheet" class="sheet sheet-quetes"/);
  assert.match(LIGHT, /if \(go === "quetes"\)/);
  assert.match(LIGHT, /attr\(xml, "type"\) === "72" && window.QuetesLight/);
  const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
  assert.match(BUREAU, /quetes: +\{ panneau: '#quetes-sheet'/);
  assert.match(BUREAU, /ouvrirQuetes: ouvrirQuetes/);
  assert.match(BUREAU, /idPanneau === 'quetes-sheet' && window.QuetesLight\) QuetesLight.ferme\(\)/);
  // Kaluga déclare chaque épreuve jouée.
  const MODES = fs.readFileSync(path.join(ROOT, 'public/kaluga/jeu/modes.js'), 'utf8');
  assert.match(MODES, /rapporterQuete\('epreuve' \+ this.trialId, this.score, ancienMax > 0 && this.score > ancienMax\)/);
  for (const mode of ['chrono', 'invasion', 'survie', 'piste', 'defi']) {
    assert.match(MODES, new RegExp(`rapporterQuete\\('${mode}' \\+ this.level, this.score\\)`), mode);
  }
  assert.match(MODES, /rapporterQuete\(this.mode, score\)/, 'triathlon et heptathlon');
  // MotionBall : la course (centièmes), le classique, l'aventure.
  const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.match(lire('public/mb2/jeu/ecrans.js'), /rapporterQuete\('course' \+ J.Manager.play_mode_param, score\)/);
  assert.match(lire('public/mb2/plateforme.js'), /this.rapporterQuete\('classique', score\)/);
  assert.match(lire('public/mb2/jeu/base.js'), /rapporterQuete\('aventure' \+ id, score\)/);
  // Mini-Fever (fever) et Swapou (classique).
  assert.match(lire('public/minifever/index.html'), /jeu: 'minifever', mode: 'fever', v: d.niveau - 1/);
  assert.match(lire('public/swapou/game.js'), /jeu: 'swapou2', mode: 'classique'/);
});

// ── Le parc ──────────────────────────────────────────────────────────────────

const PORT = 3597;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-quetes';
const DB = process.env.TEST_DATABASE_URL_QUETES || 'postgres://postgres@127.0.0.1:5433/frutiparc_quetes';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-quetes-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };
const ADMIN = Object.assign({ 'x-admin-key': CLE }, H);

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
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5470', FRUTISCORE_PORT: '5471', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'quetes_progres'`)).length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
async function arreter() {
  if (!proc) return;
  const fini = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGKILL');
  await fini;
  proc = null;
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/api/loadFrutiSlots?game=snake3'); } catch { return; }
    await wait(100);
  }
}
before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  await demarrer();
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body, headers) => fetch(BASE + url, { method: 'POST', headers: headers || H, body: JSON.stringify(body) }).then((r) => r.json());
const sids = {};
async function compte(pseudo) {
  await post('/api/auth/register', { username: pseudo, password: 'secret123' });
  sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).sid;
}
// Après un redémarrage, les sessions dormantes se réveillent ; on se reconnecte quand même.
async function reconnecter(pseudo) {
  sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).sid;
}
const etat = async (qui) => (await fetch(BASE + '/api/quetes/etat?sid=' + sids[qui])).json();
const solde = async (qui) => (await (await fetch(BASE + '/api/paris?sid=' + sids[qui])).json()).solde;
const adminEtat = async () => (await fetch(BASE + '/api/admin/quetes', { headers: ADMIN })).json();
async function swapou(pseudo, score) {
  const b = new URLSearchParams({ sid: sids[pseudo], game: 'swapou2', m: '0', score: String(score), data: 'S0:' });
  const r = await (await fetch(BASE + '/api/saveScore', { method: 'POST', body: b })).json();
  assert.ok(r.ok, JSON.stringify(r));
}
const quete = (e, id) => e.quetes.find((q) => q.id === id);
const lundiCourant = () => Q.lundiDe(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()));

// La semaine, posée à la main : trois quêtes connues.
async function semaineConnue(ids) {
  for (const q of (await adminEtat()).semaine.quetes) {
    assert.ok((await post('/api/admin/quetes/semaine', { action: 'retirer', id: q.id }, ADMIN)).ok);
  }
  for (const id of ids) assert.ok((await post('/api/admin/quetes/semaine', { action: 'ajouter', id }, ADMIN)).ok, id);
}

test('fermées par défaut, puis ouvertes à un testeur — et à lui seul', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await compte('papaye');
  await compte('grenade');
  assert.deepEqual(await etat('papaye'), { ok: true, acces: false }, 'une base neuve : fermées');
  const r = await post('/api/admin/quetes', { ouverture: 'testeurs', testeurs: 'Papaye, inconnu42' }, ADMIN);
  assert.ok(r.ok);
  assert.deepEqual(r.reglages.testeurs, ['papaye', 'inconnu42']);
  assert.deepEqual(r.inconnus, ['inconnu42'], 'l’admin est prévenu des pseudos inconnus');
  const e = await etat('papaye');
  assert.equal(e.acces, true);
  assert.equal(e.quetes.length, 5);
  assert.deepEqual(e.quetes.map((q) => q.niveau), ['facile', 'facile', 'moyenne', 'moyenne', 'difficile']);
  assert.equal(e.semaine.lundi, lundiCourant());
  assert.equal(e.nouveau, true, 'une semaine jamais vue : le baluchon gigote');
  assert.equal(e.messages.length, 1);
  assert.match(e.messages[0], /5/);
  assert.equal(e.gromelin.bouille, '0d0000010000000000000000');
  assert.deepEqual(await etat('grenade'), { ok: true, acces: false }, 'pas testeur : rien');
  // Le tirage est celui du module, semé par le lundi.
  const reglages = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_reglages'`))[0].value);
  assert.deepEqual(e.quetes.map((q) => q.id), Q.tirer(reglages, 'gromelin:' + e.semaine.lundi).map((q) => q.id));
  assert.equal(JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_semaine'`))[0].value).lundi, e.semaine.lundi);
});

const declarer = (qui, jeu, mode, v, record) => post('/api/quetes/mode', { sid: sids[qui], jeu, mode, v, record });

test('un score, un chrono, un record : la quête se fait, Gromelin paie tout de suite, une seule fois', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await semaineConnue(['swapou-15000', 'kaluga-chrono-facile', 'vers-record']);
  const avant = await solde('papaye');
  // Un score classé (Swapou, au Challenge).
  await swapou('papaye', 12000);
  let e = await etat('papaye');
  assert.equal(quete(e, 'swapou-15000').fait, false);
  assert.equal(quete(e, 'swapou-15000').ligne, 'ton meilleur cette semaine : 12 000 points');
  assert.equal(quete(e, 'swapou-15000').pc, 0.8);
  await swapou('papaye', 16000);
  e = await etat('papaye');
  assert.equal(quete(e, 'swapou-15000').fait, true);
  assert.equal(await solde('papaye'), avant + 10, '+10 kikooz (moyenne), versés sur-le-champ');
  // Un temps déclaré par Kaluga (Chrono facile, en ms) : trop lent, puis dans l'objectif.
  assert.ok((await declarer('papaye', 'kaluga', 'chrono0', 62000)).ok);
  e = await etat('papaye');
  assert.equal(quete(e, 'kaluga-chrono-facile').titre, 'Finis le Chrono facile en moins de 1 min');
  assert.equal(quete(e, 'kaluga-chrono-facile').ligne, 'ton meilleur cette semaine : 1 min 02 s');
  assert.equal(quete(e, 'kaluga-chrono-facile').fait, false);
  assert.equal((await declarer('papaye', 'kaluga', 'chrono0', 30000)).ignore, true, 'trop tôt : ignorée');
  await wait(1600);
  assert.ok((await declarer('papaye', 'kaluga', 'chrono0', 58250)).ok);
  // Le record d'une épreuve olympique.
  await wait(1600);
  assert.ok((await declarer('papaye', 'kaluga', 'epreuve0', 512, true)).ok);
  e = await etat('papaye');
  assert.equal(quete(e, 'kaluga-chrono-facile').fait, true);
  assert.equal(quete(e, 'vers-record').fait, true);
  assert.equal(quete(e, 'vers-record').ligne, 'record battu : 512 cm');
  assert.equal(await solde('papaye'), avant + 10 + 5 + 5);
  assert.equal(e.gagnes, 20);
  assert.equal(e.total, 20);
  // Refusée, et sans effet pour qui n'a pas accès.
  assert.equal((await declarer('papaye', 'kaluga', 'epreuve42', 1)).error, 'mode_invalide');
  const g = await solde('grenade');
  await declarer('grenade', 'kaluga', 'chrono0', 40000);
  await swapou('grenade', 30000);
  assert.equal(await solde('grenade'), g);
  // Le même événement, encore : rien de plus.
  await swapou('papaye', 17000);
  await wait(1600);
  await declarer('papaye', 'kaluga', 'chrono0', 41000);
  assert.equal(await solde('papaye'), avant + 20);
  // En base : l'avancement, et une ligne d'historique par quête.
  const lignes = await sql(`SELECT quete_id, gain, fait_at IS NOT NULL AS fait FROM quetes_progres WHERE username = 'papaye' ORDER BY quete_id`);
  assert.deepEqual(lignes.map((l) => [l.quete_id, l.gain, l.fait]), [['kaluga-chrono-facile', 5, true], ['swapou-15000', 10, true], ['vers-record', 5, true]]);
  const histo = await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id WHERE u.username = 'papaye' AND l.entry_type = 72 ORDER BY l.id`);
  assert.equal(histo.length, 3);
  assert.match(histo[0].content, /^Quête accomplie : « Dépasse 15 000 points à Swapou »\. Gromelin te verse 10 kikooz\.$/);
  const journal = await sql(`SELECT k.amount, k.label FROM kikooz_log k JOIN users u ON u.id = k.user_id WHERE u.username = 'papaye' AND k.label LIKE 'la quête%' ORDER BY k.id`);
  assert.deepEqual(journal.map((j) => Number(j.amount)), [10, 5, 5]);
});

test('Gromelin raconte ce qui est arrivé depuis la dernière visite ; la visite éteint le neuf', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  let e = await etat('papaye');
  assert.equal(e.nouveau, true);
  const faites = e.messages.filter((m) => /kikooz<\/em>/.test(m));
  assert.equal(faites.length, 3, e.messages.join('\n'));
  assert.match(faites[0], /« Dépasse 15 000 points à Swapou »/);
  assert.match(e.messages[e.messages.length - 1], /Reviens lundi/, 'tout est fait');
  assert.ok((await post('/api/quetes/vu', { sid: sids.papaye })).ok);
  e = await etat('papaye');
  assert.equal(e.nouveau, false);
  assert.equal(e.messages.length, 1);
  assert.match(e.messages[0], /Reviens lundi/);
});

test('les réglages et l’avancement survivent au redémarrage ; rien ne se repaie', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const avant = await solde('papaye');
  const ids = (await etat('papaye')).quetes.map((q) => q.id);
  await arreter();
  await demarrer();
  await reconnecter('papaye');
  await reconnecter('grenade');
  const e = await etat('papaye');
  assert.equal(e.acces, true, 'toujours testeur');
  assert.deepEqual(e.quetes.map((q) => q.id), ids, 'la même semaine');
  assert.ok(e.quetes.every((q) => q.fait));
  assert.equal(e.nouveau, false, 'la visite aussi est gardée');
  await swapou('papaye', 18000);
  await declarer('papaye', 'kaluga', 'epreuve0', 800, true);
  assert.equal(await solde('papaye'), avant);
  assert.deepEqual(await etat('grenade'), { ok: true, acces: false });
});

test('l’admin crée une quête (la course verte), la calibre, abaisse son seuil — payé aussitôt — et remet un testeur à zéro', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Un seuil illisible est refusé ; une mesure inconnue aussi.
  assert.equal((await post('/api/admin/quetes/perso', { mesure: 'mb2-course1', seuil: 'bof', niveau: 'difficile' }, ADMIN)).error, 'seuil_illisible');
  assert.equal((await post('/api/admin/quetes/perso', { mesure: 'nimporte', seuil: '1', niveau: 'difficile' }, ADMIN)).error, 'mesure_inconnue');
  const c = await post('/api/admin/quetes/perso', { mesure: 'mb2-course1', seuil: '4:30', niveau: 'difficile' }, ADMIN);
  assert.ok(c.ok, JSON.stringify(c));
  assert.equal(c.quete.id, 'perso-1');
  assert.equal(c.quete.titre, 'Finis la course verte en moins de 4 min 30 s');
  assert.ok((await post('/api/admin/quetes/semaine', { action: 'ajouter', id: 'perso-1' }, ADMIN)).ok);
  const avant = await solde('papaye');
  await wait(1600);
  assert.ok((await declarer('papaye', 'mb2', 'course1', 27500)).ok);
  let e = await etat('papaye');
  assert.equal(quete(e, 'perso-1').fait, false);
  assert.equal(quete(e, 'perso-1').ligne, 'ton meilleur cette semaine : 4 min 35 s');
  assert.equal(quete(e, 'perso-1').etiquette.nom, 'MotionBall');
  // Le calibrage d'une mesure au classement : les joueurs de Swapou.
  const cal = await (await fetch(BASE + '/api/admin/quetes/calibrage?mesure=swapou-challenge&seuil=20000', { headers: ADMIN })).json();
  assert.match(cal.texte, /joueur\(s\)/);
  assert.match(cal.texte, /20 000 points : atteint par 1/, cal.texte);
  // Le seuil abaissé à 4:40 : papaye l'a déjà, elle est payée sans rejouer.
  const r = await post('/api/admin/quetes/catalogue', { id: 'perso-1', seuil: '4:40' }, ADMIN);
  assert.ok(r.ok && r.semaineMiseAJour, JSON.stringify(r));
  await wait(300);
  e = await etat('papaye');
  assert.equal(quete(e, 'perso-1').titre, 'Finis la course verte en moins de 4 min 40 s');
  assert.equal(quete(e, 'perso-1').fait, true);
  assert.equal(await solde('papaye'), avant + 20, '+20 (difficile)');
  // Tout est gardé : la quête créée et son seuil.
  const reglages = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_reglages'`))[0].value);
  assert.deepEqual(reglages.perso.map((x) => [x.id, x.mesure, x.seuil, x.niveau]), [['perso-1', 'mb2-course1', 28000, 'difficile']]);
  // Ce que voit l'admin.
  const A = await adminEtat();
  assert.ok(A.mesures.some((m) => m.cle === 'kaluga-chrono0' && m.reperes[0].texte === '1 min'));
  const ligne = A.catalogue.find((q) => q.id === 'perso-1');
  assert.equal(ligne.valeurTexte, '4 min 40 s');
  assert.equal(ligne.sens, 'au plus');
  assert.equal(A.semaine.quetes.length, 4);
  assert.equal(A.joueurs[0].username, 'papaye');
  assert.equal(A.joueurs[0].faites, 4);
  assert.equal(A.historique[0].kikooz, 40);
  // Remettre à zéro : l'avancement part, la visite aussi, les kikooz restent.
  const k = await solde('papaye');
  const z = await post('/api/admin/quetes/reinitialiser', { username: 'papaye' }, ADMIN);
  assert.ok(z.ok);
  assert.equal(z.lignes, 4);
  e = await etat('papaye');
  assert.ok(e.quetes.every((q) => !q.fait));
  assert.equal(e.nouveau, true);
  assert.equal(await solde('papaye'), k);
  // Et l'on peut refaire la quête : elle se repaie (c'est le but d'un test).
  await wait(1600);
  await declarer('papaye', 'mb2', 'course1', 27900);
  assert.equal(await solde('papaye'), k + 20);
});

test('ouvertes à tous, puis la semaine tourne : nouveau tirage, avancement neuf', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.ok((await post('/api/admin/quetes', { ouverture: 'tous' }, ADMIN)).ok);
  assert.equal((await etat('grenade')).acces, true);
  // « La semaine passe » : l'avancement et la semaine tirée reculent d'une semaine.
  const lundi = lundiCourant();
  const passe = Q.jourPlus(lundi, -7);
  await sql(`UPDATE quetes_progres SET semaine = $1`, [passe]);
  const sem = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_semaine'`))[0].value);
  sem.lundi = passe;
  await sql(`UPDATE app_state SET value = $1 WHERE key = 'quetes_semaine'`, [JSON.stringify(sem)]);
  await arreter();
  await demarrer();
  await reconnecter('papaye');
  const e = await etat('papaye');
  assert.equal(e.semaine.lundi, lundi);
  const reglages = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_reglages'`))[0].value);
  assert.deepEqual(e.quetes.map((q) => q.id), Q.tirer(reglages, 'gromelin:' + lundi).map((q) => q.id));
  assert.ok(e.quetes.every((q) => !q.fait && q.pc === 0), 'tout repart de zéro : ' + JSON.stringify(e.quetes.map((q) => [q.id, q.fait, q.pc, q.ligne])));
  assert.equal(e.nouveau, true);
  // Les semaines passées restent en base (pour l'historique de l'admin).
  const A = await adminEtat();
  // (papaye avait été remise à zéro, puis avait refait la course verte : 1 quête, 20 kikooz)
  const h = A.historique.find((x) => x.semaine === passe);
  assert.deepEqual([h.joueurs, h.faites, h.kikooz], [1, 1, 20]);
});

test('RGPD : l’export du joueur contient ses quêtes', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const D = require(path.join(ROOT, 'db.js'));
  assert.ok(D.RENOMMAGE_COLONNES.some(([tb, c]) => tb === 'quetes_progres' && c === 'username'));
  assert.ok(D.RENOMMAGE_COLONNES.some(([tb, c]) => tb === 'quetes_visites' && c === 'username'));
  const SRC = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(SRC, /quetes: await q\('SELECT semaine, quete_id, etat, fait_at, gain FROM quetes_progres WHERE username = \$1/);
  assert.match(SRC, /\['quetes_progres', 'username', 'brut'\],\n\s+\['quetes_visites', 'username', 'brut'\]/);
});
