'use strict';
/*
 * LES PRUNOSTICS DU CHALLENGE — les médaillés du lendemain, en pari mutuel
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Les mises se posent par l'API, pour DEMAIN, sur les jeux du jour. Pour voir
 * le règlement sans attendre minuit, on fait « passer la nuit » en base : les
 * paris reculent d'un jour et deviennent ceux du Challenge d'hier ; le roll
 * forcé de l'admin clôt justement le Challenge d'hier, sur le podium des
 * scores posés par le vrai chemin du jeu. On vérifie :
 *   · ouverts par défaut ; baissés, rien ne se mise, et ça survit au
 *     redémarrage ;
 *   · les DEUX jeux du jour, tirés au sort et figés, ou choisis par l'admin ;
 *     changer de jeux rembourse les mises des jeux qui sortent ;
 *   · le pari mutuel : les pots, la cote du pot, le plafond du jour, miser sur
 *     soi, les refus ; le règlement au prorata, AUCUN KIKOOZ CRÉÉ NI DÉTRUIT ;
 *     les anciens paris à cote fixe payés comme promis ;
 *   · Dimitri et les gros coups ; le registre ;
 *   · la cagnotte des pots sans gagnant, plafonnée ;
 *   · le Prunostiqueur du mois : le classement, le sacre, la cagnotte, le
 *     frutijob porté un mois puis rendu, l'objet offert.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3596;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-paris-challenge';
const DB = process.env.TEST_DATABASE_URL_PCHAL || 'postgres://postgres@127.0.0.1:5433/frutiparc_paris_challenge';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-paris-challenge-'));
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
// Le serveur, lancé (et relancé : les réglages doivent survivre au redémarrage).
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5466', FRUTISCORE_PORT: '5467', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'challenge_paris'`)).length) return;
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
async function compte(pseudo, kikooz) {
  await post('/api/auth/register', { username: pseudo, password: 'secret123' });
  sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).sid;
  if (kikooz) await fetch(BASE + '/api/admin/users/' + pseudo, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ kikooz }) });
}
const parier = (qui, jeu, type, choix, mise) => post('/api/paris/challenge', { sid: sids[qui], jeu, type, choix, mise });
const etat = async (qui) => (await fetch(BASE + '/api/paris/challenge?sid=' + (sids[qui] || ''))).json();
const solde = async (qui) => (await (await fetch(BASE + '/api/paris?sid=' + sids[qui])).json()).solde;
async function jouer(pseudo, score) {
  const b = new URLSearchParams({ sid: sids[pseudo], game: 'swapou2', m: '0', score: String(score), data: 'S0:' });
  const r = await (await fetch(BASE + '/api/saveScore', { method: 'POST', body: b })).json();
  assert.ok(r.ok, JSON.stringify(r));
}
const PARIEURS = ['anais', 'basile', 'cyril'];

// Les jours, à l'heure de Paris.
const jourParis = (decalage) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })
  .format(new Date(Date.now() + decalage * 86400000));
// Un peu d'historique au Swapou : grenade, papaye, myrtille, clémence y
// viennent tous les jours depuis un mois (ce sont les habitués proposés).
async function semerHistorique() {
  for (let i = 1; i <= 30; i++) {
    const jour = jourParis(-i);
    for (const u of ['grenade', 'papaye', 'myrtille', 'clemence']) {
      await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score) VALUES ($1, 'swapou2_classic', $2, 1000)`, [jour, u]);
    }
    const podium = i % 3 === 0 ? ['papaye', 'clemence', 'myrtille'] : ['grenade', 'papaye', 'myrtille'];
    for (let r = 0; r < 3; r++) {
      await sql(`INSERT INTO challenge_medals (username, ranking_id, game, rank, medal, awarded_day) VALUES ($1, 'swapou2_classic', 'swapou2', $2, $3, $4)`,
        [podium[r], r + 1, ['or', 'argent', 'bronze'][r], jour]);
    }
  }
}
const reglages = async () => JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'paris_challenge'`))[0].value);

test('ouverts par défaut ; baissés, rien ne se mise — et ça survit au redémarrage', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  for (const p of PARIEURS) await compte(p, 500);
  for (const j of ['grenade', 'papaye', 'myrtille', 'clemence']) await compte(j);
  await compte('dora', 500);
  assert.equal((await etat('anais')).actif, true, 'une base neuve : les paris sont ouverts');
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 1, 'la tuile paraît');
  // Dimitri ouvre son sujet au démarrage, avant le moindre gros coup.
  let sujets = [];
  for (let i = 0; i < 60 && !sujets.length; i++) {
    sujets = await sql(`SELECT t.id, b.name FROM forum_topics t JOIN forum_boards b ON b.id = t.board_id
      WHERE t.title = 'Les Prunostics du parc : débats, pronos et gros coups' AND t.author_username = 'dimitri-pnj'`);
    if (!sujets.length) await wait(250);
  }
  assert.equal(sujets.length, 1);
  assert.equal(sujets[0].name, 'Jeux Frutiparc');
  const sujetsDimitri = () => sql(`SELECT id, title FROM forum_topics WHERE author_username = 'dimitri-pnj'`);
  // La modération le renomme : au redémarrage, Dimitri ne rouvre rien (avant,
  // il ne le « trouvait » plus par son titre, et en ouvrait un à chaque reboot).
  await sql(`UPDATE forum_topics SET title = 'Le comptoir de Dimitri' WHERE id = $1`, [sujets[0].id]);
  assert.ok((await post('/api/admin/paris-challenge', { actif: false }, ADMIN)).ok);
  assert.equal((await etat('anais')).actif, false);
  assert.equal((await parier('anais', 'swapou2_classic', 'podium', 'grenade', 10)).code, 'fermes');
  await arreter();
  await demarrer();
  assert.equal((await etat('anais')).actif, false, 'baissés par l’admin, ils le restent après un redémarrage');
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 0, 'pas de tuile');
  await wait(6500);   // l'ouverture du sujet au démarrage attend 5 s
  assert.deepEqual((await sujetsDimitri()).map((x) => x.id), [sujets[0].id], 'renommé : toujours un seul sujet, le même');
  // Supprimé : le démarrage ne le rouvre pas non plus.
  await sql(`DELETE FROM forum_topics WHERE id = $1`, [sujets[0].id]);
  await arreter();
  await demarrer();
  await wait(6500);
  assert.equal((await sujetsDimitri()).length, 0, 'supprimé : pas de nouveau sujet au démarrage');
});

test('les deux jeux du jour : tirés au sort, figés, ou choisis par l’admin', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await semerHistorique();
  assert.ok((await post('/api/admin/paris-challenge', { actif: true, plafond: 50 }, ADMIN)).ok);
  const demain = jourParis(1);
  const e = await etat('anais');
  assert.equal(e.jour, demain);
  assert.equal(e.jeux.length, 2, 'deux jeux par jour');
  const tires = e.jeux.map((j) => j.cle);
  assert.deepEqual((await reglages()).choix[demain], tires, 'le tirage est figé en base');
  assert.deepEqual((await etat('basile')).jeux.map((j) => j.cle), tires, 'et ne bouge plus');
  // Un jeu qui n'est pas du jour : pas de pari.
  const horsJeu = ['grapiz_challenge', 'miniwave_classic', 'kaluga_classic'].find((k) => !tires.includes(k));
  assert.equal((await parier('anais', horsJeu, 'podium', 'grenade', 5)).code, 'jeu');
  // L'admin choisit : le Swapou et le Frutisnake.
  assert.ok((await post('/api/admin/paris-challenge', { jeuxDuJour: { jeux: ['swapou2_classic', 'snake3_classic'] } }, ADMIN)).ok);
  const e2 = await etat('anais');
  assert.deepEqual(e2.jeux.map((j) => j.cle), ['swapou2_classic', 'snake3_classic'], 'dans l’ordre choisi');
  // Les habitués du Swapou sont proposés, les plus médaillés d'abord.
  const sw = e2.jeux.find((j) => j.cle === 'swapou2_classic');
  assert.deepEqual(sw.candidats.map((c) => c.pseudo), ['papaye', 'myrtille', 'grenade', 'clemence']);
  assert.deepEqual([sw.candidats[0].joues, sw.candidats[0].podiums], [30, 30]);
  assert.deepEqual(sw.pots, { podium: 0, or: 0 });
  // Changer les jeux rembourse les mises de celui qui sort.
  assert.equal((await parier('dora', 'snake3_classic', 'podium', 'grenade', 5)).ok, true);
  assert.equal(await solde('dora'), 495);
  assert.ok((await post('/api/admin/paris-challenge', { jeuxDuJour: { jeux: ['swapou2_classic', 'grapiz_challenge'] } }, ADMIN)).ok);
  await wait(300);
  assert.equal(await solde('dora'), 500, 'le Frutisnake sort : la mise revient');
  // « Nouveau tirage » : une autre graine, aussitôt figée.
  assert.ok((await post('/api/admin/paris-challenge', { jeuxDuJour: { jeux: [] } }, ADMIN)).ok);
  const R = await reglages();
  assert.equal(R.choix[demain].length, 2);
  assert.equal(R.retirages[demain], 1);
  // On revient au Swapou et au Frutisnake pour la suite.
  assert.ok((await post('/api/admin/paris-challenge', { jeuxDuJour: { jeux: ['swapou2_classic', 'snake3_classic'] } }, ADMIN)).ok);
});

test('le pari mutuel : les pots, leur cote, le plafond, sur soi, les refus', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const demain = jourParis(1);
  const m1 = await parier('anais', 'swapou2_classic', 'podium', 'grenade', 20);
  assert.equal(m1.ok, true, JSON.stringify(m1));
  assert.deepEqual([m1.pot, m1.estime], [20, 20], 'seule sur le pot : elle récupérerait sa mise');
  assert.equal((await parier('anais', 'swapou2_classic', 'or', 'grenade', 20)).ok, true);
  const trop = await parier('anais', 'snake3_classic', 'podium', 'papaye', 20);
  assert.equal(trop.code, 'plafond', '40 + 20 > 50, tous jeux confondus');
  assert.match(trop.message, /encore miser 10/);
  assert.equal((await parier('anais', 'swapou2_classic', 'podium', 'grenade', 10)).ok, true, 'la mise grossit');
  assert.equal((await parier('basile', 'swapou2_classic', 'podium', 'papaye', 30)).ok, true);
  assert.equal((await parier('cyril', 'swapou2_classic', 'podium', 'personne-ici', 5)).code, 'choix');
  assert.equal((await parier('cyril', 'swapou2_classic', 'podium', 'dimitri-pnj', 5)).code, 'choix', 'pas de pari sur un PNJ');
  assert.equal((await parier('cyril', 'swapou2_classic', 'podium', 'cyril', 15)).ok, true, 'on peut miser sur soi');
  const m2 = await parier('cyril', 'swapou2_classic', 'or', 'papaye', 25);
  assert.equal(m2.ok, true);
  assert.deepEqual([m2.pot, m2.estime], [45, 45], 'or : 45 au pot, tout à cyril si papaye gagne');
  assert.equal((await parier('cyril', 'swapou2_classic', 'tierce', 'papaye', 5)).code, 'type');
  // Les joueurs sur qui l'on mise sont prévenus — à la première mise de chaque
  // parieur sur chaque pot, pas à la rallonge, et pas quand on mise sur soi.
  const prevenus = async (u) => (await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id
    WHERE lower(u.username) = $1 AND l.entry_type = 71 ORDER BY l.id`, [u])).map((r) => r.content);
  await wait(300);
  const g7 = (await prevenus('grenade')).filter((c) => /Swapou 2/.test(c));
  assert.equal(g7.length, 2, 'anais : un podium et un or (la rallonge ne sonne pas) — ' + JSON.stringify(g7));
  assert.equal(g7[0], 'Un Frutiz prunostique ton podium à Swapou 2 au Challenge de demain : 20 kikooz misés sur toi. Ne le déçois pas !');
  assert.match(g7[1], /prunostique ta médaille d’or/);
  assert.ok(!g7.join(' ').includes('anais'), 'le parieur reste anonyme, comme sur la page');
  assert.ok((await prevenus('grenade')).some((c) => /Frutisnake/.test(c)), 'et dora, plus tôt, au Frutisnake');
  assert.equal((await prevenus('papaye')).length, 2, 'basile et cyril');
  assert.equal((await prevenus('cyril')).length, 0, 'miser sur soi ne se notifie pas');
  assert.equal(await solde('anais'), 450);
  // Ce que la page voit : les pots, et la cote du pot sur chacun.
  const sw = (await etat('anais')).jeux.find((j) => j.cle === 'swapou2_classic');
  assert.deepEqual(sw.pots, { podium: 75, or: 45 });
  const g = sw.candidats.find((c) => c.pseudo === 'grenade');
  assert.deepEqual(g.pot.or, { mises: 20, parieurs: 1, cote: 2.25 });
  assert.deepEqual(g.pot.podium, { mises: 30, parieurs: 1, cote: 2.5 });
  assert.ok(sw.candidats.some((c) => c.pseudo === 'cyril' && c.soi === false), 'cyril (misé sur lui) entre dans la liste');
  assert.equal((await etat('cyril')).jeux.find((j) => j.cle === 'swapou2_classic').candidats.find((c) => c.pseudo === 'cyril').soi, true);
  assert.deepEqual(sw.mesParis.map((p) => [p.type, p.choix, p.mise, p.cote]), [['podium', 'grenade', 30, null], ['or', 'grenade', 20, null]]);
  // Chercher un joueur hors liste : son historique et ce qui est misé sur lui.
  const vu = await (await fetch(BASE + '/api/paris/challenge/joueur?sid=' + sids.dora + '&jeu=swapou2_classic&choix=Cyril')).json();
  assert.equal(vu.ok, true, JSON.stringify(vu));
  assert.deepEqual([vu.pseudo, vu.joues, vu.pot.podium.mises, vu.pots.podium], ['cyril', 0, 15, 75]);
  assert.equal((await (await fetch(BASE + '/api/paris/challenge/joueur?jeu=swapou2_classic&choix=personne-ici')).json()).code, 'choix');
  assert.equal((await (await fetch(BASE + '/api/paris/challenge/joueur?jeu=grapiz_challenge&choix=cyril')).json()).code, 'jeu');
  const rows = await sql(`SELECT cote, retour FROM challenge_paris WHERE jour = $1 AND statut = 'ouvert'`, [demain]);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.cote == null && r.retour == null), 'ni cote ni retour : pari mutuel');
});

test('la nuit passe : le roll règle au prorata, aucun kikooz créé ni détruit', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.ok((await post('/api/admin/paris-challenge', { grosCoup: 5 }, ADMIN)).ok);
  // La cagnotte plafonnée à 10 : le pot sans gagnant (12) déborde de 2, qui quittent le parc.
  assert.equal((await post('/api/admin/paris-challenge', { plafondCagnotte: -1 }, ADMIN)).error, 'bad_plafond_cagnotte');
  assert.ok((await post('/api/admin/paris-challenge', { plafondCagnotte: 10 }, ADMIN)).ok);
  const avant = (await Promise.all(PARIEURS.map(solde))).reduce((a, b) => a + b, 0);
  const hier = jourParis(-1);
  await sql(`UPDATE challenge_paris SET jour = $1`, [hier]);
  // Un ancien pari à cote fixe (la règle d'une semaine) : payé comme promis.
  await sql(`INSERT INTO challenge_paris (jour, jeu, type, username, choix, mise, cote, retour) VALUES ($1, 'swapou2_classic', 'or', 'dora', 'grenade', 10, 3, 30)`, [hier]);
  // Un pot sans gagnant : dora seule sur clémence, médaillée au Grapiz où
  // personne ne monte sur le podium. Perdu — et la mise part à la cagnotte.
  await sql(`INSERT INTO challenge_paris (jour, jeu, type, username, choix, mise) VALUES ($1, 'grapiz_challenge', 'podium', 'dora', 'clemence', 12)`, [hier]);
  await jouer('grenade', 9000);
  await jouer('papaye', 8000);
  await jouer('myrtille', 7000);
  await jouer('clemence', 6000);
  const roll = await post('/api/admin/challenge/roll', {}, ADMIN);
  assert.ok(roll.ok, JSON.stringify(roll));
  await wait(800);
  // Médaillé : 75 de pot ; grenade (anais, 30) et papaye (basile, 30) sont
  // médaillées → 37,5 chacun, le kikooz d'arrondi au premier arrivé ; cyril
  // (sur lui-même, 15) n'est pas sur le podium. Or : 45 de pot ; grenade a
  // l'or → tout pour anais.
  assert.equal(await solde('anais'), 450 + 38 + 45);
  assert.equal(await solde('basile'), 470 + 37);
  assert.equal(await solde('cyril'), 460);
  assert.equal(await solde('dora'), 500 + 30, 'la cote fixe d’avant : 10 × 3');
  const apres = (await Promise.all(PARIEURS.map(solde))).reduce((a, b) => a + b, 0);
  assert.equal(apres, avant + 75 + 45, 'les deux pots sont revenus, entiers, aux soldes');
  const rows = await sql(`SELECT username, type, statut, gain FROM challenge_paris ORDER BY username, type, jeu`);
  assert.deepEqual(rows.map((r) => [r.username, r.type, r.statut, r.gain]), [
    ['anais', 'or', 'gagne', 45], ['anais', 'podium', 'gagne', 38],
    ['basile', 'podium', 'gagne', 37],
    ['cyril', 'or', 'perdu', 0], ['cyril', 'podium', 'perdu', 0],
    ['dora', 'or', 'gagne', 30], ['dora', 'podium', 'perdu', 0], ['dora', 'podium', 'rembourse', 5],
  ]);
  // La cagnotte : les 12 kikooz du pot sans gagnant… plafonnés à 10.
  const cagnotte = async () => Number(((await sql(`SELECT value FROM app_state WHERE key = 'prunostics_cagnotte'`))[0] || {}).value || 0);
  assert.equal(await cagnotte(), 10, 'plafonnée');
  // Le compte rendu de la veille.
  const e = await etat('anais');
  assert.deepEqual(e.hier.podiums.find((p) => p.nom === 'Swapou 2').podium, ['grenade', 'papaye', 'myrtille']);
  assert.ok(e.hier.mesParis.some((p) => p.statut === 'gagne' && p.gain === 45));
  // Un second roll ne paie pas deux fois, ni ne regarnit la cagnotte.
  await post('/api/admin/challenge/roll', {}, ADMIN);
  await wait(500);
  assert.equal(await solde('anais'), 533);
  assert.equal(await cagnotte(), 10);
  assert.equal((await etat('anais')).cagnotte, 10, 'la page la montre');
  // Le journal des kikooz : une dépense, puis un gain.
  const j = await (await fetch(BASE + '/api/light/kikooz?sid=' + sids.anais)).json();
  const textes = (j.events || []).map((x) => x.text).join(' | ');
  assert.match(textes, /Achat du produit "Pari : grenade en or à Swapou 2/);
  assert.match(textes, /45 kikooz obtenus par un pari gagné \(grenade en or à Swapou 2/);
  // DIMITRI annonce les gros coups (bénéfice ≥ 5), en un message, ravi.
  let annonces = [];
  for (let i = 0; i < 40 && !annonces.length; i++) {
    annonces = await sql(`SELECT p.content, p.mood FROM forum_posts p WHERE p.author_username = 'dimitri-pnj' AND p.content LIKE '%avait misé%'`);
    if (!annonces.length) await wait(150);
  }
  assert.equal(annonces.length, 1, 'un seul message pour le lot');
  assert.equal(annonces[0].mood, 4, 'd’humeur ravie');
  for (const q of ['anais', 'basile', 'dora']) assert.match(annonces[0].content, new RegExp('@' + q + ' avait misé'));
  assert.match(annonces[0].content, /@anais avait misé 20 kikooz sur grenade en or à Swapou 2, à ×2,25 : \[b\]45 kikooz\[\/b\]/);
  // LE REGISTRE : mes paris et mon bilan.
  const reg = await (await fetch(BASE + '/api/paris/registre?sid=' + sids.anais)).json();
  assert.deepEqual([reg.bilan.paris, reg.bilan.gagnes, reg.bilan.mises, reg.bilan.gains, reg.bilan.net], [2, 2, 50, 83, 33]);
  assert.ok(reg.grosCoups.some((c) => c.parieur === 'anais'));
});

test('le Prunostiqueur du mois : le classement, le sacre, la cagnotte, le titre porté puis rendu, l’objet offert', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Le mois dernier : émile +60, fanny +20, gaston −10 (trois paris réglés chacun).
  const moisDernier = new Date(Date.UTC(Number(jourParis(0).slice(0, 4)), Number(jourParis(0).slice(5, 7)) - 2, 15)).toISOString().slice(0, 7);
  const jour = moisDernier + '-10';
  for (const u of ['emile', 'fanny', 'gaston']) await compte(u);
  const rang = { emile: [[10, 50], [10, 40], [10, 0]], fanny: [[10, 30], [10, 20], [10, 0]], gaston: [[10, 20], [10, 0], [10, 0]] };
  for (const [u, l] of Object.entries(rang)) {
    for (let i = 0; i < l.length; i++) {
      const [mise, gain] = l[i];
      await sql(`INSERT INTO challenge_paris (jour, jeu, type, username, choix, mise, statut, gain, regle_le) VALUES ($1, 'swapou2_classic', 'podium', $2, $3, $4, $5, $6, now())`,
        [jour, u, 'choix' + i, mise, gain ? 'gagne' : 'perdu', gain]);
    }
  }
  // Émile avait un frutijob : il le retrouvera après son mois de gloire.
  await sql(`UPDATE users SET frutijob = 'Jardinier' WHERE username = 'emile'`);
  // L'objet offert : le premier de la boutique.
  const adm = await (await fetch(BASE + '/api/admin/paris-challenge', { headers: ADMIN })).json();
  const objet = adm.objets[0];
  assert.ok(objet && objet.id);
  assert.ok((await post('/api/admin/paris-challenge', { recompenseMois: objet.id }, ADMIN)).ok);
  assert.equal((await post('/api/admin/paris-challenge', { recompenseMois: 999999 }, ADMIN)).error, 'bad_objet');
  const r = await post('/api/admin/paris-challenge/mois', {}, ADMIN);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.mois.cle, moisDernier);
  assert.deepEqual([r.gagnant.username, r.gagnant.net, r.gagnant.paris, r.gagnant.objet], ['emile', 60, 3, objet.nom]);
  // La cagnotte (plafonnée à 10) lui revient, et repart de zéro.
  assert.equal(r.gagnant.cagnotte, 10);
  assert.equal(((await sql(`SELECT value FROM app_state WHERE key = 'prunostics_cagnotte'`))[0] || {}).value, '0');
  const jk = await (await fetch(BASE + '/api/light/kikooz?sid=' + sids.emile)).json();
  assert.match((jk.events || []).map((x) => x.text).join(' | '), /10 kikooz obtenus par la cagnotte des Prunostics/);
  // LE TITRE : « Prunostiqueur du mois » en frutijob, tout le mois en cours.
  assert.equal(r.gagnant.titre, 'Prunostiqueur du mois');
  const job = async () => (await sql(`SELECT frutijob FROM users WHERE username = 'emile'`))[0].frutijob;
  assert.equal(await job(), 'Prunostiqueur du mois');
  const titre = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'prunostics_titre'`))[0].value);
  assert.deepEqual([titre.username, titre.mois, titre.ancien], ['emile', jourParis(0).slice(0, 7), 'Jardinier']);
  // L'objet est bien dans son inventaire.
  const items = await sql(`SELECT i.item_id FROM user_items i JOIN users u ON u.id = i.user_id WHERE LOWER(u.username) = 'emile'`);
  assert.ok(items.some((i) => Number(i.item_id) === objet.id));
  // Dimitri le sacre, avec le podium, le titre et la cagnotte.
  let sacre = [];
  for (let i = 0; i < 40 && !sacre.length; i++) {
    sacre = await sql(`SELECT content FROM forum_posts WHERE author_username = 'dimitri-pnj' AND content LIKE '%Prunostiqueur du mois%' AND content LIKE '%@emile%'`);
    if (!sacre.length) await wait(150);
  }
  assert.equal(sacre.length, 1);
  assert.match(sacre[0].content, /@emile, avec \[b\]\+60 kikooz\[\/b\] de bénéfice en /);
  assert.match(sacre[0].content, /@fanny, 2e \(\+20\)/);
  assert.match(sacre[0].content, /le titre de \[b\]Prunostiqueur du mois\[\/b\]/);
  assert.match(sacre[0].content, /la cagnotte : 10 kikooz/);
  assert.doesNotMatch(sacre[0].content, /@gaston/, 'pas de podium pour un bénéfice négatif');
  assert.match(sacre[0].content, new RegExp('cadeau du parc : \\[b\\]' + objet.nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Le registre montre le sacré du mois passé, et le classement en cours.
  const reg = await (await fetch(BASE + '/api/paris/registre?sid=' + sids.emile)).json();
  assert.deepEqual(reg.mois.passee && [reg.mois.passee.nom, reg.mois.passee.net], ['emile', 60]);
  assert.equal(reg.mois.minParis, 3);
  assert.equal(reg.mois.cagnotte, 0, 'vidée par le sacre');
  assert.equal(reg.mois.plafondCagnotte, 10);
  assert.ok(Array.isArray(reg.mois.classement));
  // Le mois passe : le titre est rendu, et émile retrouve son frutijob.
  await sql(`UPDATE app_state SET value = $1 WHERE key = 'prunostics_titre'`, [JSON.stringify(Object.assign(titre, { mois: '2000-01' }))]);
  await post('/api/admin/paris-challenge/mois', { mois: '1999-12' }, ADMIN);
  assert.equal(await job(), 'Jardinier', 'le titre est rendu');
  assert.equal((await sql(`SELECT value FROM app_state WHERE key = 'prunostics_titre'`))[0].value, '');
});

test('baisser l’option rembourse les mises en jeu ; l’export les emporte', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const avant = await solde('basile');
  assert.equal((await parier('basile', 'swapou2_classic', 'podium', 'myrtille', 12)).ok, true);
  assert.equal(await solde('basile'), avant - 12);
  assert.ok((await post('/api/admin/paris-challenge', { actif: false }, ADMIN)).ok);
  await wait(300);
  assert.equal(await solde('basile'), avant, 'la mise revient');
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 0);
  const exp = await (await fetch(BASE + '/api/light/mes-donnees?sid=' + sids.basile)).json();
  assert.equal(exp.paris_challenge.length, 2);
  const adm = await (await fetch(BASE + '/api/admin/paris-challenge', { headers: ADMIN })).json();
  assert.equal(adm.reglages.actif, false);
  assert.ok(adm.jeux.length >= 5);
});
