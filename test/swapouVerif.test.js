'use strict';
/*
 * SWAPOU VÉRIFIÉ ET JOURNAL DES CONNEXIONS — le serveur, de bout en bout
 * ════════════════════════════════════════════════════════════════════
 *
 * Le rejeu DÉCIDE (il n'est plus « observateur ») :
 *
 *   · la graine arrive par /api/swapou/partie ; la partie jouée avec elle, puis
 *     rendue avec ses coups dans un temps possible, est rejouée AVANT la
 *     réponse, et classée (verdict « conforme ») ;
 *   · un score gonflé, des coups trafiqués : « divergent », non classé,
 *     alerte grave ; une partie rendue plus vite qu'elle ne se joue, ou à la
 *     durée déclarée impossible : refusée, alerte grave ;
 *   · sans journal, sur une graine locale, d'essai, d'un autre joueur, ou
 *     déjà rendue : refusée, alerte — et le joueur ne lit qu'un message
 *     neutre ;
 *   · le tournoi ne voit que les parties admises (plus d'interrupteur) ;
 *   · l'admin voit verdict, durées et combos, et reclasse à la main ;
 *   · la connexion laisse sa ligne au journal ; deux comptes du même appareil
 *     forment un groupe de « comptes liés » ;
 *   · l'export RGPD emporte les tables, la suppression du compte les efface.
 *
 * Les parties sont jouées par le bot, horloge simulée, et leur graine est
 * vieillie en base de la durée de la partie (test/aideSwapou.js).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const PORT = 3593;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-swapou-verif';
const DB = process.env.TEST_DATABASE_URL_SWAPOU || 'postgres://postgres@127.0.0.1:5433/frutiparc_swapou_verif';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };
const ADMIN = Object.assign({ 'x-admin-key': CLE }, H);

let proc = null, dispo = false;
// Les scores de ces parties (des milliers de points) vont dans un dossier à
// part : dans `data/`, ils fausseraient les podiums des autres tests.
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-swapou-verif-'));

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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5460', FRUTISCORE_PORT: '5461', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const rows = await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'connexions'`);
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
async function compte(pseudo, appareil) {
  await post('/api/auth/register', { username: pseudo, password: 'secret123', device_token: appareil });
  const j = await (await post('/api/auth/login', { username: pseudo, password: 'secret123', device_token: appareil })).json();
  assert.ok(j.sid, 'connecté : ' + JSON.stringify(j));
  return j.sid;
}

// ── De vraies parties, jouées par le bot (test/aideSwapou.js) ──────────────
const A = require('./aideSwapou.js');
const sb = A.bac();
const jouer = (partie, perso, o) => A.jouer(sb, partie, perso, o);
const nouvellePartie = (sid, essai) => A.nouvellePartie(BASE, sid, essai);
const vieillir = (id, ms) => A.vieillir(sql, id, ms);
const rendre = (sid, partie, score, pf, perso) => A.rendre(BASE, sid, score, pf, perso);
async function verdict(id) {
  for (let i = 0; i < 120; i++) {
    const rows = await sql('SELECT * FROM swapou_parties WHERE id = $1', [id]);
    if (rows[0] && rows[0].verdict !== 'en_cours' && rows[0].fini_le) return rows[0];
    await wait(100);
  }
  throw new Error('pas de verdict pour ' + id);
}
const classeEnBase = async (u) => (await sql(
  `SELECT s.score FROM scores s JOIN users u ON u.id = s.user_id WHERE LOWER(u.username) = $1 AND s.ranking_id = 'swapou2_classic'`, [u]))[0];
async function alertes(u, type) {
  for (let i = 0; i < 30; i++) {
    const l = await sql(`SELECT * FROM alertes_triche WHERE username = $1 AND jeu = 'swapou2'${type ? ' AND type = $2' : ''} ORDER BY id`,
      type ? [u, type] : [u]);
    if (l.length || !type) return l;
    await wait(100);
  }
  return [];
}
// Ce qu'un refus dit au joueur : un message neutre, rien sur le pourquoi.
function refusNeutre(r) {
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.nonClasse, true);
  assert.equal(r.json.error, 'partie_non_classee');
  assert.match(r.json.message, /^Partie non classée/);
  assert.doesNotMatch(r.json.message, /durée|graine|score rejoué|divergent/i);
}

// ── La partie vérifiée ───────────────────────────────────────────────────

test('une partie honnête est rejouée, PUIS classée ; la rendre une seconde fois ne sert à rien', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('verifa', 'dAAAA');
  const partie = await nouvellePartie(sid);
  const { score, pf } = jouer(partie, 1);
  assert.equal(pf.id, partie.id, 'le jeu a pris la partie du serveur');
  assert.equal(pf.graine, partie.graine);
  await vieillir(partie.id, pf.duree + 1000);
  const r = await rendre(sid, partie, score, pf, 1);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.equal(r.json.verifie, true);
  assert.equal(r.json.updated, true);
  assert.equal(r.json.newScore, score);
  assert.equal(r.json.rankingId, 'swapou2_classic');
  assert.ok(r.json.fiche && r.json.fiche.combos.length === 11, 'la fiche des combos revient au jeu');
  // Le verdict est déjà écrit quand la réponse part : le rejeu l'a précédée.
  const [ligne] = await sql('SELECT * FROM swapou_parties WHERE id = $1', [partie.id]);
  assert.equal(ligne.verdict, 'conforme', ligne.raison);
  assert.equal(ligne.classe, true);
  assert.equal(ligne.classe_par, 'rejeu');
  assert.equal(Number(ligne.score_rejoue), score);
  assert.equal(ligne.source, 'serveur');
  assert.equal(ligne.ranking_id, 'swapou2_classic');
  assert.ok(ligne.duree_serveur_ms >= pf.duree, 'la durée serveur est mesurée');
  assert.ok(ligne.temps_jeu_ms > 0 && ligne.temps_jeu_ms <= ligne.duree_serveur_ms / 0.85 + 5000);
  assert.ok(Array.isArray(ligne.combos) && ligne.combos.length === 11);
  assert.equal(Number((await classeEnBase('verifa')).score), score, 'le score est au classement');
  // Le numéro ne sert qu'une fois.
  const again = await rendre(sid, partie, score, pf, 1);
  refusNeutre(again);
  const [x] = await sql(`SELECT verdict, raison, classe FROM swapou_parties WHERE username = 'verifa' AND id LIKE 'x%'`);
  assert.equal(x.verdict, 'refuse');
  assert.match(x.raison, /déjà rendue/);
  assert.equal(x.classe, false);
  const [al] = await alertes('verifa', 'swapou_partie_rejouee');
  assert.equal(al.gravite, 'suspect');
});

test('un score gonflé, un journal retouché : refusés, rien n’est classé, l’alerte est grave', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('verifb', 'dBBBB');
  const partie = await nouvellePartie(sid);
  const { score, pf } = jouer(partie, 0);
  await vieillir(partie.id, pf.duree + 1000);
  const r = await rendre(sid, partie, score + 10000, pf, 0);
  refusNeutre(r);
  const ligne = await verdict(partie.id);
  assert.equal(ligne.verdict, 'divergent');
  assert.match(ligne.raison, /score rejoué/);
  assert.equal(Number(ligne.score_rejoue), score);
  assert.equal(ligne.classe, false);
  assert.equal(await classeEnBase('verifb'), undefined, 'rien au classement');
  const [al] = await alertes('verifb', 'swapou_divergent');
  assert.equal(al.gravite, 'grave');
  assert.equal(al.details.score, score + 10000);
  // Des coups trafiqués : un échange inventé au milieu de la partie.
  const p2 = await nouvellePartie(sid);
  const j2 = jouer(p2, 0);
  await vieillir(p2.id, j2.pf.duree + 1000);
  const coups = j2.pf.coups.split(';');
  coups.splice(5, 1, 's0,0,0@100');
  const r2 = await rendre(sid, p2, j2.score, Object.assign({}, j2.pf, { coups: coups.join(';') }), 0);
  refusNeutre(r2);
  assert.equal((await verdict(p2.id)).verdict, 'divergent');
  assert.equal(await classeEnBase('verifb'), undefined);
});

test('une partie rendue plus vite qu’elle ne se joue : refusée (durée impossible)', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('verifrapide', '');
  const partie = await nouvellePartie(sid);
  const { score, pf } = jouer(partie, 4);
  // Pas de vieillissement : pour le serveur, la graine a été donnée il y a
  // un instant, et la partie dure plusieurs minutes d'animations.
  const r = await rendre(sid, partie, score, pf, 4);
  refusNeutre(r);
  const ligne = await verdict(partie.id);
  assert.equal(ligne.verdict, 'refuse');
  assert.match(ligne.raison, /durée impossible : partie rendue .* après la graine/);
  assert.equal(await classeEnBase('verifrapide'), undefined);
  const [al] = await alertes('verifrapide', 'swapou_duree_impossible');
  assert.equal(al.gravite, 'grave');
  // Une durée déclarée bien plus longue que celle du serveur : refusée aussi.
  const p2 = await nouvellePartie(sid);
  const j2 = jouer(p2, 4);
  await vieillir(p2.id, j2.pf.duree + 1000);
  const r2 = await rendre(sid, p2, j2.score, Object.assign({}, j2.pf, { duree: j2.pf.duree * 3 }), 4);
  refusNeutre(r2);
  assert.match((await verdict(p2.id)).raison, /plus longue que les/);
});

test('sans journal, sur une graine locale, d’essai ou d’un autre joueur : refusé, et chaque refus est une alerte', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('verifc', '');
  // Sans journal (le jeu Flash, un vieux client).
  refusNeutre(await rendre(sid, null, 1234, null, 0));
  assert.equal((await alertes('verifc', 'swapou_sans_journal'))[0].gravite, 'info');
  const [sans] = await sql(`SELECT * FROM swapou_parties WHERE username = 'verifc' AND coups = ''`);
  assert.ok(sans && sans.score_declare === 1234, 'la partie est notée, pour l’admin');
  // Hors ligne : le jeu a tiré sa graine lui-même. Rejouée, mais pas classée.
  const loc = jouer(null, 2);
  assert.equal(loc.pf.id, null);
  refusNeutre(await rendre(sid, null, loc.score, loc.pf, 2));
  const [ligne] = await sql(`SELECT * FROM swapou_parties WHERE username = 'verifc' AND source = 'locale'`);
  assert.equal(ligne.verdict, 'refuse');
  assert.match(ligne.raison, /graine tirée par le navigateur/);
  assert.equal(Number(ligne.score_rejoue), loc.score, 'rejouée quand même, pour l’admin');
  assert.equal((await alertes('verifc', 'swapou_graine_locale'))[0].gravite, 'info');
  // La graine d'un essai, rendue au Challenge.
  const pe = await nouvellePartie(sid, true);
  const je = jouer(pe, 2);
  await vieillir(pe.id, je.pf.duree + 1000);
  refusNeutre(await rendre(sid, pe, je.score, je.pf, 2));
  assert.ok((await alertes('verifc', 'swapou_graine_essai')).length);
  assert.equal(await classeEnBase('verifc'), undefined);

  // La graine d'un autre : refusée, sans brûler le numéro de son vrai joueur.
  const sidA = await compte('verifd', '');
  const sidB = await compte('verife', '');
  const partie = await nouvellePartie(sidA);
  const { score, pf } = jouer(partie, 0);
  await vieillir(partie.id, pf.duree + 1000);
  refusNeutre(await rendre(sidB, partie, score, pf, 0));
  const [x] = await sql(`SELECT verdict, raison FROM swapou_parties WHERE username = 'verife'`);
  assert.equal(x.verdict, 'refuse');
  assert.match(x.raison, /autre joueur/);
  assert.equal((await alertes('verife', 'swapou_graine_autre_joueur'))[0].gravite, 'grave');
  const rA = await rendre(sidA, partie, score, pf, 0);
  assert.equal(rA.json.ok, true, 'le vrai joueur rend sa partie : ' + JSON.stringify(rA.json));
  assert.equal(Number((await classeEnBase('verifd')).score), score);
});

test('deux envois simultanés du même numéro : un seul passe', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('verifdouble', '');
  const partie = await nouvellePartie(sid);
  const { score, pf } = jouer(partie, 3);
  await vieillir(partie.id, pf.duree + 1000);
  const [a, b] = await Promise.all([rendre(sid, partie, score, pf, 3), rendre(sid, partie, score, pf, 3)]);
  assert.deepEqual([a.json.ok, b.json.ok].sort(), [false, true]);
});

// ── Le tournoi ───────────────────────────────────────────────────────────

test('le tournoi ne compte que les parties admises — sans interrupteur', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.equal((await post('/api/admin/swapou/tournoi-verifie', { on: true }, ADMIN)).status, 404, 'l’interrupteur n’existe plus');
  const cree = await (await post('/api/admin/tournaments',
    { name: 'Maître ès Swapou', ranking_id: 'swapou2_classic', bracket_size: 4, round_hours: 24 }, ADMIN)).json();
  assert.ok(cree.ok, JSON.stringify(cree));
  const tid = cree.tournament.id;
  const prog = await (await post(`/api/admin/tournaments/${tid}/schedule`, {
    qualif_start: new Date(Date.now() - 60000).toISOString(),
    qualif_end: new Date(Date.now() + 3600000).toISOString(),
  }, ADMIN)).json();
  assert.ok(prog.ok, JSON.stringify(prog));
  const tour = async () => (await (await fetch(BASE + `/api/admin/tournaments/${tid}`, { headers: ADMIN })).json()).roundScores;
  // Sans journal : n'entre pas.
  const sidG = await compte('verifsansjournal', '');
  await rendre(sidG, null, 999, null, 0);
  // Gonflé : n'entre pas.
  const sidH = await compte('verifgonfle', '');
  const pH = await nouvellePartie(sidH);
  const jH = jouer(pH, 0);
  await vieillir(pH.id, jH.pf.duree + 1000);
  await rendre(sidH, pH, jH.score + 5000, jH.pf, 0);
  // Honnête : entre, dès la réponse.
  const sidI = await compte('verifhonnete', '');
  const pI = await nouvellePartie(sidI);
  const jI = jouer(pI, 3);
  await vieillir(pI.id, jI.pf.duree + 1000);
  const rI = await rendre(sidI, pI, jI.score, jI.pf, 3);
  assert.equal(rI.json.ok, true);
  const noms = (await tour()).map((r) => r.username);
  assert.ok(noms.includes('verifhonnete'), 'la partie admise est au tour');
  assert.ok(!noms.includes('verifgonfle'), 'la partie divergente n’y est pas');
  assert.ok(!noms.includes('verifsansjournal'), 'la partie sans journal n’y est pas');
  const vH = await sql('SELECT tournoi FROM swapou_parties WHERE id = $1', [pH.id]);
  assert.equal(vH[0].tournoi, true, 'la partie est marquée « jouée pendant un tournoi »');
  // L'admin reclasse la partie sans journal : elle entre au tour.
  const [sj] = await sql(`SELECT id FROM swapou_parties WHERE username = 'verifsansjournal'`);
  const cl = await (await post('/api/admin/swapou/parties/' + sj.id + '/classer', {}, ADMIN)).json();
  assert.ok(cl.ok, JSON.stringify(cl));
  assert.ok((await tour()).some((r) => r.username === 'verifsansjournal'), 'reclassée à la main : au tour');
  await post(`/api/admin/tournaments/${tid}/cancel`, {}, ADMIN).catch(() => {});
});

test('l’admin : liste, bilan par joueur, détail, rejeu, reclassement d’une partie écartée, clé maître exigée', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.equal((await fetch(BASE + '/api/admin/swapou/parties')).status, 403);
  assert.equal((await post('/api/admin/swapou/parties/x/classer', {})).status, 403);
  const j = await (await fetch(BASE + '/api/admin/swapou/parties?jours=7', { headers: ADMIN })).json();
  assert.ok(j.ok);
  assert.ok(j.parties.length >= 4);
  assert.ok(!('coups' in j.parties[0]), 'le journal ne voyage pas dans la liste');
  assert.ok(j.seuils && j.seuils.tempsJeuPart, 'les seuils des horloges sont affichés');
  const b = j.bilan.find((x) => x.username === 'verifb');
  assert.equal(b.divergentes, 2);
  assert.equal(b.classees, 0);
  const vite = j.parties.find((p) => p.username === 'verifrapide' && /après la graine/.test(p.raison));
  assert.ok(vite.duree_serveur_ms != null && vite.temps_jeu_ms > vite.duree_serveur_ms, 'durée serveur et temps de jeu, côte à côte');
  const d = await (await fetch(BASE + '/api/admin/swapou/parties/' + vite.id, { headers: ADMIN })).json();
  assert.ok(d.partie.coups.length > 0);
  const rj = await (await post('/api/admin/swapou/parties/' + vite.id + '/rejouer', {}, ADMIN)).json();
  assert.equal(rj.verdict, 'refuse', 'le rejeu de l’admin garde les mêmes horloges');
  // Reclasser à la main la partie trop rapide (l'admin la juge honnête).
  const cl = await (await post('/api/admin/swapou/parties/' + vite.id + '/classer', {}, ADMIN)).json();
  assert.ok(cl.ok && cl.score === Number(vite.score_declare), JSON.stringify(cl));
  assert.equal(Number((await classeEnBase('verifrapide')).score), Number(vite.score_declare));
  const [l] = await sql('SELECT classe, classe_par FROM swapou_parties WHERE id = $1', [vite.id]);
  assert.deepEqual([l.classe, l.classe_par], [true, 'admin']);
  assert.equal((await (await post('/api/admin/swapou/parties/' + vite.id + '/classer', {}, ADMIN)).json()).deja, true);
  // Une partie d'essai ne se classe pas, même à la main.
  const [ess] = await sql(`SELECT id FROM swapou_parties WHERE username = 'verifc' AND essai AND fini_le IS NOT NULL`);
  assert.equal((await post('/api/admin/swapou/parties/' + ess.id + '/classer', {}, ADMIN)).status, 400);
});

// ── Le journal des connexions et les comptes liés ────────────────────────

test('la connexion laisse sa ligne ; deux comptes du même appareil sont liés', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await compte('jumeau1', 'dMEMEAPPAREIL');
  await compte('jumeau2', 'dMEMEAPPAREIL');
  await compte('solitaire', 'dAUTRE');
  const lignes = await sql(`SELECT * FROM connexions WHERE username = 'jumeau1' ORDER BY origine`);
  assert.deepEqual(lignes.map((l) => l.origine).sort(), ['connexion'], 'une ligne par jour, adresse et appareil');
  assert.ok(lignes[0].n >= 2, 'l’inscription et la connexion du même jour se cumulent');
  assert.equal(lignes[0].appareil, 'dMEMEAPPAREIL');
  assert.ok(lignes[0].ip, 'l’adresse est notée');
  // La reprise de session du light (jeton en paramètre).
  const sid = (await (await post('/api/auth/login', { username: 'solitaire', password: 'secret123' })).json()).sid;
  const prof = await fetch(BASE + '/api/light/profile?sid=' + sid + '&appareil=dLIGHT');
  assert.equal(prof.status, 200);
  await wait(200);
  const rep = await sql(`SELECT origine FROM connexions WHERE username = 'solitaire' AND appareil = 'dLIGHT'`);
  assert.equal(rep[0].origine, 'reprise');

  assert.equal((await fetch(BASE + '/api/admin/comptes-lies')).status, 403);
  const cl = await (await fetch(BASE + '/api/admin/comptes-lies', { headers: ADMIN })).json();
  assert.ok(cl.ok);
  const g = cl.groupes.find((x) => x.comptes.some((c) => c.username === 'jumeau1'));
  assert.ok(g, 'le groupe des jumeaux existe');
  assert.deepEqual(g.comptes.map((c) => c.username).filter((n) => n.startsWith('jumeau')).sort(), ['jumeau1', 'jumeau2']);
  assert.ok(g.paires.some((p) => p.preuves.some((x) => /même appareil/.test(x))));
  assert.ok(!cl.groupes.some((x) => x.comptes.some((c) => c.username === 'solitaire')),
    'une adresse partagée un seul jour ne suffit pas à lier');
  const cx = await (await fetch(BASE + '/api/admin/connexions/jumeau1', { headers: ADMIN })).json();
  assert.ok(cx.connexions.length >= 1);
});

test('RGPD : l’export emporte les tables, la suppression les efface', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = (await (await post('/api/auth/login', { username: 'verifa', password: 'secret123' })).json()).sid;
  const exp = await (await fetch(BASE + '/api/light/mes-donnees?sid=' + sid)).json();
  assert.ok(Array.isArray(exp.swapou_parties) && exp.swapou_parties.length >= 1);
  assert.ok(Array.isArray(exp.swapou_combos), 'les combos comptés par le serveur sont exportés');
  assert.ok(Array.isArray(exp.connexions) && exp.connexions.length >= 1);
  const del = await fetch(BASE + '/api/admin/users/verifa', { method: 'DELETE', headers: ADMIN });
  assert.ok(del.ok, 'suppression : ' + del.status);
  await wait(300);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM swapou_parties WHERE LOWER(username) = 'verifa'`))[0].n, 0);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM swapou_combos WHERE LOWER(username) = 'verifa'`))[0].n, 0);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM connexions WHERE LOWER(username) = 'verifa'`))[0].n, 0);
});
