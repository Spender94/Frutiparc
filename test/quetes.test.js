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

test('le tirage : 2 faciles, 2 moyennes, 1 difficile, jamais deux de la même famille, reproductible', () => {
  for (const lundi of ['2026-10-05', '2026-10-12', '2026-10-19', '2027-01-04']) {
    const t = Q.tirer({}, 'gromelin:' + lundi);
    assert.deepEqual(t.map((q) => q.niveau), ['facile', 'facile', 'moyenne', 'moyenne', 'difficile']);
    assert.equal(new Set(t.map((q) => q.famille)).size, 5, lundi + ' : ' + t.map((q) => q.id));
    assert.ok(t.every((q) => q.actif), 'seulement des quêtes actives');
    assert.deepEqual(Q.tirer({}, 'gromelin:' + lundi).map((q) => q.id), t.map((q) => q.id), 'même graine, même tirage');
  }
  // L'épreuve au seuil n'est pas calibrée : inactive par défaut, jamais tirée.
  const def = Q.definition('vers-seuil', {});
  assert.equal(def.actif, false);
  for (let i = 0; i < 40; i++) assert.ok(!Q.tirer({}, 'x' + i).some((q) => q.id === 'vers-seuil'));
});

test('les retouches de l\'admin : composition, niveau, seuil, quête désactivée', () => {
  const R = Q.reglagesNormalises({
    composition: { facile: 1, moyenne: 0, difficile: 3 },
    catalogue: { 'swapou2-25000': { seuil: 30000, niveau: 'moyenne' }, kiloute: { actif: false }, 'vers-seuil': { actif: true } },
  });
  const t = Q.tirer(R, 'g');
  assert.deepEqual(t.map((q) => q.niveau), ['facile', 'difficile', 'difficile', 'difficile']);
  assert.ok(!t.some((q) => q.id === 'kiloute'));
  const d = Q.definition('swapou2-25000', R);
  assert.equal(d.niveau, 'moyenne');
  assert.equal(Q.titre(d), 'Dépasse 30 000 points à Swapou');
  assert.equal(Q.definition('vers-seuil', R).actif, true);
  // Des réglages absurdes retombent sur les défauts.
  const B = Q.reglagesNormalises({ ouverture: 'n’importe', gains: { facile: -3, moyenne: 'x', difficile: 20000 }, testeurs: [' Papaye ', 'papaye', ''] });
  assert.equal(B.ouverture, 'ferme');
  assert.deepEqual(B.gains, { facile: 5, moyenne: 10, difficile: 20 });
  assert.deepEqual(B.testeurs, ['papaye']);
});

test('l’avancement, type par type', () => {
  const jour = '2026-10-06';
  // Au score : le meilleur de la semaine, sur le bon classement seulement.
  const sw = Q.definition('swapou2-25000', {});
  let e = Q.appliquer(sw, {}, { type: 'score', rk: 'swapou2_classic', v: 21340 }, jour);
  assert.deepEqual(e, { m: 21340 });
  assert.equal(Q.appliquer(sw, e, { type: 'score', rk: 'swapou2_classic', v: 9000 }, jour), null, 'moins bien : rien ne change');
  assert.equal(Q.appliquer(sw, e, { type: 'score', rk: 'snake3_classic', v: 99999 }, jour), null, 'un autre jeu : rien');
  assert.equal(Q.estFaite(sw, e), false);
  assert.equal(Q.avancement(sw, e).ligne, 'ton meilleur cette semaine : 21 340 points');
  e = Q.appliquer(sw, e, { type: 'score', rk: 'swapou2_classic', v: 25000 }, jour);
  assert.equal(Q.estFaite(sw, e), true);
  assert.equal(Q.avancement(sw, e).pc, 1);
  // Les jours au Challenge : un jour ne compte qu'une fois, un classement hors Challenge pas du tout.
  const cj = Q.definition('challenge-2j', {});
  let j = Q.appliquer(cj, {}, { type: 'score', rk: 'swapou2_classic', v: 1, challenge: true }, '2026-10-05');
  assert.equal(Q.appliquer(cj, j, { type: 'score', rk: 'snake3_classic', v: 1, challenge: true }, '2026-10-05'), null);
  assert.equal(Q.appliquer(cj, j, { type: 'score', rk: 'snake3_contest', v: 1, challenge: false }, '2026-10-06'), null);
  j = Q.appliquer(cj, j, { type: 'score', rk: 'snake3_classic', v: 1, challenge: true }, '2026-10-06');
  assert.ok(Q.estFaite(cj, j));
  assert.equal(Q.avancement(cj, j).ligne, '2 / 2 jours');
  // Les parties et les actions : des compteurs.
  const p = Q.definition('snake3-3p', {});
  let c = {};
  for (let i = 0; i < 3; i++) c = Q.appliquer(p, c, { type: 'partie', jeu: 'snake3' }, jour);
  assert.ok(Q.estFaite(p, c));
  assert.equal(Q.appliquer(p, {}, { type: 'partie', jeu: 'kaluga' }, jour), null);
  const pr = Q.definition('prunostic-1', {});
  assert.ok(Q.estFaite(pr, Q.appliquer(pr, {}, { type: 'action', action: 'pari' }, jour)));
  assert.equal(Q.appliquer(pr, {}, { type: 'action', action: 'chatMsg' }, jour), null);
  // Les épreuves de Kaluga : le nombre de lancers, le record, le seuil.
  const v3 = Q.definition('vers-3', {});
  let v = {};
  for (let i = 0; i < 3; i++) v = Q.appliquer(v3, v, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 100 + i }, jour);
  assert.ok(Q.estFaite(v3, v));
  assert.equal(Q.appliquer(v3, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve6', v: 1 }, jour), null, 'une autre épreuve');
  const rec = Q.definition('vers-record', {});
  assert.equal(Q.appliquer(rec, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 500 }, jour), null, 'sans record, rien');
  const r = Q.appliquer(rec, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 640, record: true }, jour);
  assert.ok(Q.estFaite(rec, r));
  assert.equal(Q.avancement(rec, r).ligne, 'record battu : 640 cm');
  const seuil = Q.definition('vers-seuil', {});
  assert.ok(!Q.estFaite(seuil, Q.appliquer(seuil, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 399 }, jour)));
  assert.ok(Q.estFaite(seuil, Q.appliquer(seuil, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 400 }, jour)));
});

test('une déclaration de mode : connue et vraisemblable, ou refusée', () => {
  assert.deepEqual(Q.modeRecevable('kaluga', 'epreuve0', '412.5'), { jeu: 'kaluga', mode: 'epreuve0', v: 412.5 });
  assert.equal(Q.modeRecevable('kaluga', 'epreuve9', 1), null);
  assert.equal(Q.modeRecevable('swapou2', 'epreuve0', 1), null);
  assert.equal(Q.modeRecevable('kaluga', 'epreuve0', -1), null);
  assert.equal(Q.modeRecevable('kaluga', 'epreuve0', 1e9), null);
  assert.equal(Q.modeRecevable('kaluga', 'epreuve0', 'abc'), null);
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
const epreuve = (qui, mode, v, record) => post('/api/quetes/mode', { sid: sids[qui], jeu: 'kaluga', mode, v, record });
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

test('un score, une épreuve : la quête se fait, Gromelin paie tout de suite, une seule fois', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await semaineConnue(['swapou2-15000', 'vers-3', 'vers-record']);
  const avant = await solde('papaye');
  await swapou('papaye', 12000);
  let e = await etat('papaye');
  assert.equal(quete(e, 'swapou2-15000').fait, false);
  assert.equal(quete(e, 'swapou2-15000').ligne, 'ton meilleur cette semaine : 12 000 points');
  assert.equal(quete(e, 'swapou2-15000').pc, 0.8);
  await swapou('papaye', 16000);
  e = await etat('papaye');
  assert.equal(quete(e, 'swapou2-15000').fait, true);
  assert.equal(await solde('papaye'), avant + 10, '+10 kikooz (moyenne), versés sur-le-champ');
  // Les épreuves de Kaluga, déclarées par le jeu (espacées : 1,5 s au moins).
  assert.ok((await epreuve('papaye', 'epreuve0', 310)).ok);
  await wait(1600);
  assert.ok((await epreuve('papaye', 'epreuve0', 290)).ok);
  assert.equal((await epreuve('papaye', 'epreuve0', 999, true)).ignore, true, 'trop tôt : ignorée');
  await wait(1600);
  assert.ok((await epreuve('papaye', 'epreuve0', 512, true)).ok);
  e = await etat('papaye');
  assert.equal(quete(e, 'vers-3').fait, true);
  assert.equal(quete(e, 'vers-record').fait, true);
  assert.equal(quete(e, 'vers-record').ligne, 'record battu : 512 cm');
  assert.equal(await solde('papaye'), avant + 10 + 5 + 10);
  assert.equal(e.gagnes, 25);
  assert.equal(e.total, 25);
  // Refusée, et sans effet pour qui n'a pas accès.
  assert.equal((await epreuve('papaye', 'epreuve42', 1)).error, 'mode_invalide');
  const g = await solde('grenade');
  await epreuve('grenade', 'epreuve0', 900, true);
  await swapou('grenade', 30000);
  assert.equal(await solde('grenade'), g);
  // Le même événement, encore : rien de plus.
  await swapou('papaye', 17000);
  await wait(1600);
  await epreuve('papaye', 'epreuve0', 700, true);
  assert.equal(await solde('papaye'), avant + 25);
  // En base : l'avancement, et une ligne d'historique par quête.
  const lignes = await sql(`SELECT quete_id, gain, fait_at IS NOT NULL AS fait FROM quetes_progres WHERE username = 'papaye' ORDER BY quete_id`);
  assert.deepEqual(lignes.map((l) => [l.quete_id, l.gain, l.fait]), [['swapou2-15000', 10, true], ['vers-3', 5, true], ['vers-record', 10, true]]);
  const histo = await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id WHERE u.username = 'papaye' AND l.entry_type = 72 ORDER BY l.id`);
  assert.equal(histo.length, 3);
  assert.match(histo[0].content, /^Quête accomplie : « Dépasse 15 000 points à Swapou »\. Gromelin te verse 10 kikooz\.$/);
  const journal = await sql(`SELECT k.amount, k.label FROM kikooz_log k JOIN users u ON u.id = k.user_id WHERE u.username = 'papaye' AND k.label LIKE 'la quête%' ORDER BY k.id`);
  assert.deepEqual(journal.map((j) => Number(j.amount)), [10, 5, 10]);
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
  await epreuve('papaye', 'epreuve0', 800, true);
  assert.equal(await solde('papaye'), avant);
  assert.deepEqual(await etat('grenade'), { ok: true, acces: false });
});

// Le concours de Frutisnake (la longueur du serpent) : hors quota de Fruits
// Défendus, il passe par persistScore comme un score classé.
const serpent = (qui, anneaux) => post('/api/contest/snake3', { sid: sids[qui], v: anneaux });

test('l’admin : un seuil abaissé paie aussitôt, un testeur se remet à zéro', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.ok((await post('/api/admin/quetes/semaine', { action: 'ajouter', id: 'snake3-200a' }, ADMIN)).ok);
  const avant = await solde('papaye');
  assert.ok((await serpent('papaye', 150)).ok);
  let e = await etat('papaye');
  assert.equal(quete(e, 'snake3-200a').fait, false);
  assert.equal(quete(e, 'snake3-200a').ligne, 'ton meilleur cette semaine : 150 anneaux');
  const r = await post('/api/admin/quetes/catalogue', { id: 'snake3-200a', seuil: 140 }, ADMIN);
  assert.ok(r.ok && r.semaineMiseAJour);
  await wait(300);
  e = await etat('papaye');
  assert.equal(quete(e, 'snake3-200a').titre, 'Fais un serpent de 140 anneaux');
  assert.equal(quete(e, 'snake3-200a').fait, true);
  assert.equal(await solde('papaye'), avant + 20, '+20 (difficile), sans attendre une autre partie');
  // Le retouché est gardé pour les semaines suivantes.
  const reglages = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_reglages'`))[0].value);
  assert.deepEqual(reglages.catalogue['snake3-200a'], { seuil: 140 });
  // Ce que voit l'admin.
  const A = await adminEtat();
  assert.equal(A.semaine.quetes.length, 4);
  assert.equal(A.semaine.quetes.find((q) => q.id === 'snake3-200a').faites, 1);
  assert.equal(A.joueurs[0].username, 'papaye');
  assert.equal(A.joueurs[0].faites, 4);
  assert.equal(A.historique[0].kikooz, 45);
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
  await serpent('papaye', 141);
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
  // (papaye avait été remise à zéro, puis avait refait le serpent : 1 quête, 20 kikooz)
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
