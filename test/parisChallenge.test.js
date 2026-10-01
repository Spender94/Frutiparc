'use strict';
/*
 * LES PARIS DU CHALLENGE — sur les médaillés du lendemain, à cote fixe
 * ════════════════════════════════════════════════════════════════════
 *
 * Les mises se posent par l'API, pour DEMAIN. L'historique des 30 derniers
 * jours (scores archivés et médailles) est semé en base : c'est lui qui donne
 * les cotes. Pour voir le règlement sans attendre minuit, on fait « passer la
 * nuit » : les paris reculent d'un jour et deviennent ceux du Challenge
 * d'hier ; le roll forcé de l'admin clôt justement le Challenge d'hier, sur le
 * podium des scores posés par le vrai chemin du jeu. On vérifie :
 *   · l'interrupteur baissé (par défaut) : rien ne se mise ;
 *   · les cotes tirées de l'historique ; pas de cote sous 7 jours joués ; ×3
 *     au plus sur soi ; la cote vue à l'écran est celle qu'on prend ;
 *   · le plafond PAR JOUR, tous jeux confondus ; un pseudo inconnu refusé ;
 *   · le règlement : le gagnant reçoit mise × cote, le perdant rien ; les
 *     paris d'avant les cotes se règlent encore en pari mutuel ;
 *   · le compte rendu de la veille sur la page ; l'option baissée rembourse.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const Cote = require('../coteChallenge.js');

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
before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
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

test('l’interrupteur baissé : rien ne se mise', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  for (const p of PARIEURS) await compte(p, 500);
  for (const j of ['grenade', 'papaye', 'myrtille', 'clemence']) await compte(j);
  assert.equal((await etat('anais')).actif, false);
  assert.equal((await parier('anais', 'swapou2_classic', 'podium', 'grenade', 10)).code, 'fermes');
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 0, 'pas de tuile');
});

// Les jours, à l'heure de Paris.
const jourParis = (decalage) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })
  .format(new Date(Date.now() + decalage * 86400000));
// L'historique du Swapou sur les 30 jours qui précèdent demain (d'il y a 30
// jours à hier) : grenade en or deux jours sur trois, papaye souvent
// deuxième, myrtille souvent troisième, clémence de temps en temps ; cyril
// est venu 10 jours, basile 5 (trop peu pour une cote).
const HIST = { joues: [], medailles: [] };
for (let i = 1; i <= 30; i++) {
  const jour = jourParis(-i);
  for (const u of ['grenade', 'papaye', 'myrtille', 'clemence']) HIST.joues.push({ username: u, jour });
  if (i <= 10) HIST.joues.push({ username: 'cyril', jour });
  if (i <= 5) HIST.joues.push({ username: 'basile', jour });
  const podium = i % 3 === 0 ? ['papaye', 'clemence', 'myrtille'] : i % 5 === 0 ? ['grenade', 'clemence', 'papaye'] : ['grenade', 'papaye', 'myrtille'];
  podium.forEach((u, r) => HIST.medailles.push({ username: u, jour, rang: r + 1 }));
}
const COTES = Cote.cotesDuJeu(HIST).joueurs;
async function semerHistorique() {
  for (const l of HIST.joues) {
    await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score) VALUES ($1, 'swapou2_classic', $2, 1000)`, [l.jour, l.username]);
  }
  for (const m of HIST.medailles) {
    await sql(`INSERT INTO challenge_medals (username, ranking_id, game, rank, medal, awarded_day) VALUES ($1, 'swapou2_classic', 'swapou2', $2, $3, $4)`,
      [m.username, m.rang, ['or', 'argent', 'bronze'][m.rang - 1], m.jour]);
  }
}

test('les cotes de demain, tirées de l’historique', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await semerHistorique();
  const r = await post('/api/admin/paris-challenge', { actif: true, plafond: 50 }, ADMIN);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 1, 'la tuile paraît');
  const e = await etat('anais');
  assert.equal(e.actif, true);
  assert.equal(e.jour, jourParis(1));
  assert.ok(e.jeux.some((j) => j.cle === 'bkiwi' && j.nom === 'Burning Kiwi'), 'Burning Kiwi : un seul jeu');
  assert.ok(!e.jeux.some((j) => /^bkiwi_track/.test(j.cle)));
  assert.deepEqual(e.regles, { fenetre: 30, joursMin: 7, marge: 0.1, min: 1.1, max: 10, maxSoi: 3 });
  const sw = e.jeux.find((j) => j.cle === 'swapou2_classic');
  assert.equal(sw.jours, 30);
  assert.equal(sw.eligibles, 5, 'basile, 5 jours joués, n’est pas coté');
  const ordre = Object.keys(COTES).filter((u) => COTES[u].eligible)
    .sort((a, b) => COTES[a].podium.cote - COTES[b].podium.cote || COTES[a].or.cote - COTES[b].or.cote || (a < b ? -1 : 1));
  assert.deepEqual(sw.candidats.map((c) => c.pseudo), ordre, 'les favoris d’abord');
  assert.deepEqual(ordre, ['papaye', 'myrtille', 'grenade', 'clemence', 'cyril']);
  const p = sw.candidats[0];
  assert.deepEqual([p.joues, p.podiums, p.ors], [30, 30, 10]);
  assert.equal(p.cote.podium, 1.1, 'papaye, toujours sur le podium : la cote plancher');
  const g = sw.candidats.find((c) => c.pseudo === 'grenade');
  assert.deepEqual([g.joues, g.podiums, g.ors], [30, 20, 20]);
  assert.deepEqual(g.cote, { podium: COTES.grenade.podium.cote, or: COTES.grenade.or.cote });
  assert.ok(g.cote.podium > 1.1 && g.cote.or > g.cote.podium);
  assert.ok(sw.candidats.find((c) => c.pseudo === 'cyril').cote.podium === 10, 'cyril, jamais médaillé : la cote plafond');
  // Vu par cyril : sur lui-même, ×3 au plus.
  const vuParCyril = (await etat('cyril')).jeux.find((j) => j.cle === 'swapou2_classic').candidats.find((c) => c.pseudo === 'cyril');
  assert.equal(vuParCyril.soi, true);
  assert.deepEqual(vuParCyril.cote, { podium: 3, or: 3 });
  // Un compte du même appareil compte comme soi : clémence, jamais en or
  // (×10 pour les autres), est à ×3 au plus pour cyril.
  assert.equal(COTES.clemence.or.cote, 10);
  await sql(`INSERT INTO connexions (username, jour, appareil) VALUES ('cyril', $1, 'appareil-partage'), ('clemence', $1, 'appareil-partage')`, [jourParis(0)]);
  const vus = (await etat('cyril')).jeux.find((j) => j.cle === 'swapou2_classic').candidats;
  const cl = vus.find((c) => c.pseudo === 'clemence');
  assert.equal(cl.soi, false, 'le lien d’appareil ne s’affiche pas');
  assert.equal(cl.cote.or, 3);
  assert.equal(sw.candidats.find((c) => c.pseudo === 'clemence').cote.or, 10, 'pour anais, la cote entière');
  // Un jeu sans historique : personne n'est coté.
  const sn = e.jeux.find((j) => j.cle === 'snake3_classic');
  assert.equal(sn.eligibles, 0);
  assert.deepEqual(sn.candidats, []);
});

test('les mises de demain : cote figée, plafond du jour, sur soi, refus', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const demain = jourParis(1);
  const cg = COTES.grenade, cp = COTES.papaye;
  const m1 = await parier('anais', 'swapou2_classic', 'podium', 'grenade', 20);
  assert.equal(m1.ok, true, JSON.stringify(m1));
  assert.equal(m1.cote, cg.podium.cote);
  assert.equal(m1.retour, Cote.retourDe(20, cg.podium.cote));
  assert.equal((await parier('anais', 'swapou2_classic', 'or', 'grenade', 20)).ok, true);
  const trop = await parier('anais', 'swapou2_classic', 'podium', 'myrtille', 20);
  assert.equal(trop.code, 'plafond', '40 + 20 > 50, tous jeux confondus');
  assert.match(trop.message, /encore miser 10/);
  assert.equal((await parier('anais', 'swapou2_classic', 'podium', 'grenade', 10)).ok, true, 'la mise grossit');
  // La cote vue à l'écran est celle qu'on prend.
  const bouge = await post('/api/paris/challenge', { sid: sids.basile, jeu: 'swapou2_classic', type: 'podium', choix: 'papaye', mise: 30, cote: 9.99 });
  assert.equal(bouge.code, 'cote_changee');
  assert.equal(bouge.cote, cp.podium.cote);
  const m2 = await post('/api/paris/challenge', { sid: sids.basile, jeu: 'swapou2_classic', type: 'podium', choix: 'papaye', mise: 30, cote: cp.podium.cote });
  assert.equal(m2.ok, true, JSON.stringify(m2));
  assert.equal((await parier('cyril', 'swapou2_classic', 'podium', 'personne-ici', 5)).code, 'choix');
  const sansCote = await parier('cyril', 'swapou2_classic', 'podium', 'basile', 5);
  assert.equal(sansCote.code, 'cote', 'basile n’a que 5 jours joués');
  assert.match(sansCote.message, /au moins 7 jours/);
  assert.equal((await parier('cyril', 'snake3_classic', 'podium', 'grenade', 5)).code, 'cote', 'pas d’historique sur ce jeu');
  const soi = await parier('cyril', 'swapou2_classic', 'podium', 'cyril', 15);
  assert.equal(soi.ok, true, 'on peut miser sur soi');
  assert.equal(soi.cote, 3, '×3 au plus sur soi');
  assert.equal(soi.retour, 45);
  assert.equal((await parier('cyril', 'swapou2_classic', 'or', 'papaye', 25)).ok, true);
  assert.equal((await parier('cyril', 'swapou2_classic', 'tierce', 'papaye', 5)).code, 'type');
  assert.equal(await solde('anais'), 450);
  const rows = await sql(`SELECT username, type, choix, mise, cote::float AS cote, retour FROM challenge_paris WHERE jour = $1 ORDER BY id`, [demain]);
  assert.equal(rows.length, 5);
  const ap = rows.find((x) => x.username === 'anais' && x.type === 'podium');
  assert.equal(ap.mise, 30);
  assert.equal(ap.retour, Cote.retourDe(20, cg.podium.cote) + Cote.retourDe(10, cg.podium.cote), 'deux mises, chacune à sa cote');
  const vu = (await etat('anais')).jeux.find((j) => j.cle === 'swapou2_classic');
  assert.equal(vu.mises, 120);
  assert.deepEqual(vu.mesParis.map((p) => [p.type, p.choix, p.mise, p.retour]),
    [['podium', 'grenade', 30, ap.retour], ['or', 'grenade', 20, Cote.retourDe(20, cg.or.cote)]]);
});

test('la nuit passe, le roll règle à la cote — le parc paie les gagnants', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const cg = COTES.grenade, cp = COTES.papaye;
  // « La nuit passe » : les paris de demain deviennent ceux d'hier.
  const hier = jourParis(-1);
  await sql(`UPDATE challenge_paris SET jour = $1`, [hier]);
  // Deux paris d'avant les cotes (sans retour) : ils restent en pari mutuel.
  await sql(`INSERT INTO challenge_paris (jour, jeu, type, username, choix, mise) VALUES
    ($1, 'swapou2_classic', 'or', 'myrtille', 'grenade', 10), ($1, 'swapou2_classic', 'or', 'clemence', 'papaye', 30)`, [hier]);
  // Le Challenge de Swapou : grenade, papaye, myrtille sur le podium.
  await jouer('grenade', 9000);
  await jouer('papaye', 8000);
  await jouer('myrtille', 7000);
  await jouer('clemence', 6000);
  const roll = await post('/api/admin/challenge/roll', {}, ADMIN);
  assert.ok(roll.ok, JSON.stringify(roll));
  await wait(800);
  const gainAnais = Cote.retourDe(20, cg.podium.cote) + Cote.retourDe(10, cg.podium.cote) + Cote.retourDe(20, cg.or.cote);
  assert.equal(await solde('anais'), 450 + gainAnais);
  assert.equal(await solde('basile'), 470 + Cote.retourDe(30, cp.podium.cote));
  assert.equal(await solde('cyril'), 460, 'cyril pas médaillé, papaye pas en or');
  const rows = await sql(`SELECT username, type, statut, gain FROM challenge_paris ORDER BY username, type`);
  assert.deepEqual(rows.map((r) => [r.username, r.type, r.statut, r.gain]), [
    ['anais', 'or', 'gagne', Cote.retourDe(20, cg.or.cote)], ['anais', 'podium', 'gagne', Cote.retourDe(20, cg.podium.cote) + Cote.retourDe(10, cg.podium.cote)],
    ['basile', 'podium', 'gagne', Cote.retourDe(30, cp.podium.cote)],
    ['clemence', 'or', 'perdu', 0],
    ['cyril', 'or', 'perdu', 0], ['cyril', 'podium', 'perdu', 0],
    ['myrtille', 'or', 'gagne', 40],
  ]);
  // Le compte rendu de la veille.
  const e = await etat('anais');
  const sw = e.hier.podiums.find((p) => p.nom === 'Swapou 2');
  assert.deepEqual(sw.podium, ['grenade', 'papaye', 'myrtille']);
  assert.ok(e.hier.mesParis.some((p) => p.statut === 'gagne' && p.gain === Cote.retourDe(20, cg.or.cote) && p.cote === cg.or.cote));
  // Un second roll ne paie pas deux fois. (Le roll forcé réécrit les médailles
  // de la veille avec les scores du moment — vides : on a lu le podium avant.)
  await post('/api/admin/challenge/roll', {}, ADMIN);
  await wait(500);
  assert.equal(await solde('anais'), 450 + gainAnais);
  // Le journal des kikooz : une dépense (avec sa cote), puis un gain.
  const j = await (await fetch(BASE + '/api/light/kikooz?sid=' + sids.anais)).json();
  const textes = (j.events || []).map((x) => x.text).join(' | ');
  assert.match(textes, /Achat du produit "Pari : grenade en or à Swapou 2 \([^)]*\), cote ×/);
  assert.match(textes, new RegExp(Cote.retourDe(20, cg.or.cote) + ' kikooz obtenus par un pari gagné \\(grenade en or à Swapou 2'));
  // Le bilan du parc, côté admin : ce qu'il a encaissé moins ce qu'il a rendu.
  const adm = await (await fetch(BASE + '/api/admin/paris-challenge', { headers: ADMIN })).json();
  const mises = 30 + 20 + 30 + 15 + 25 + 10 + 30;
  const rendus = gainAnais + Cote.retourDe(30, cp.podium.cote) + 40;
  assert.equal(adm.bilan.mises, mises);
  assert.equal(adm.bilan.gains, rendus);
  const swa = adm.jeux.find((x) => x.cle === 'swapou2_classic');
  assert.equal(swa.eligibles, 5);
  assert.equal(swa.favoris.length, 5);
  assert.ok(swa.favoris.every((f, i) => i === 0 || f.podium >= swa.favoris[i - 1].podium), 'les favoris d’abord');
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
