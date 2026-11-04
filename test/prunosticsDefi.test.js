'use strict';
/*
 * LE DÉFI MÉDAILLE, L'XP DES MÉDAILLES, ET DIMITRI QUI NE POSTE PLUS QU'UNE FOIS PAR JOUR
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Comme pour les Prunostics (parisChallenge.test.js), on mise pour DEMAIN par
 * l'API, puis on « fait passer la nuit » en base (les paris reculent d'un
 * jour) et le roll forcé de l'admin clôt le Challenge d'hier sur les scores
 * posés par le vrai chemin du jeu. On vérifie :
 *   · le défi médaille : sur soi seulement, sur n'importe quel jeu qui a assez
 *     tourné, trois cotes fixes croissantes (bronze < argent < or), son plafond
 *     propre dans celui du jour ; réglé au roll à sa cote, remboursé sur un jeu
 *     qui n'a pas tourné, fermé par l'admin → remboursé ;
 *   · l'XP des médailles : 2 500 / 5 000 / 7 500, dans le message de la
 *     médaille, UNE fois par médaille même si le jour est rejoué ;
 *   · Dimitri : un seul message par jour, complété au fil de la journée ; en
 *     « direct », un message par règlement, comme avant.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3661;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-prunostics-defi';
const DB = process.env.TEST_DATABASE_URL_PDEFI || 'postgres://postgres@127.0.0.1:5433/frutiparc_prunostics_defi';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-prunostics-defi-'));
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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5791', FRUTISCORE_PORT: '5792', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'challenge_medailles_xp'`)).length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
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
const parier = (qui, jeu, type, mise, choix) => post('/api/paris/challenge', { sid: sids[qui], jeu, type, mise, choix });
const etat = async (qui) => (await fetch(BASE + '/api/paris/challenge?sid=' + (sids[qui] || ''))).json();
const solde = async (qui) => (await (await fetch(BASE + '/api/paris?sid=' + sids[qui])).json()).solde;
const xp = async (u) => Number((await sql(`SELECT xp FROM users WHERE username = $1`, [u]))[0].xp) || 0;
async function jouer(pseudo, score) {
  const b = new URLSearchParams({ sid: sids[pseudo], game: 'swapou2', m: '0', score: String(score), data: 'S0:' });
  const r = await (await fetch(BASE + '/api/saveScore', { method: 'POST', body: b })).json();
  assert.ok(r.ok, JSON.stringify(r));
}
// Attendre qu'une condition (asynchrone) tienne.
async function attendre(f, n = 40) {
  let v;
  for (let i = 0; i < n; i++) { v = await f(); if (v) return v; await wait(150); }
  return v;
}
const jourParis = (decalage) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })
  .format(new Date(Date.now() + decalage * 86400000));
// Un mois d'historique (hors hier, que le roll du test va écrire) au Swapou et
// au Frutisnake : grenade, papaye, myrtille, clémence et deux figurants
// viennent tous les jours. Le Kaluga n'a jamais tourné.
const HABITUES = ['grenade', 'papaye', 'myrtille', 'clemence', 'figue', 'kiwi'];
async function semerHistorique() {
  for (let i = 2; i <= 30; i++) {
    const jour = jourParis(-i);
    for (const rk of ['swapou2_classic', 'snake3_classic']) {
      for (const u of HABITUES) {
        await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score) VALUES ($1, $2, $3, 1000)`, [jour, rk, u]);
      }
      const podium = i % 3 === 0 ? ['papaye', 'clemence', 'myrtille'] : ['grenade', 'papaye', 'myrtille'];
      for (let r = 0; r < 3; r++) {
        await sql(`INSERT INTO challenge_medals (username, ranking_id, game, rank, medal, awarded_day) VALUES ($1, $2, $3, $4, $5, $6)`,
          [podium[r], rk, rk.split('_')[0], r + 1, ['or', 'argent', 'bronze'][r], jour]);
      }
    }
  }
}
const dimitri = () => sql(`SELECT id, content FROM forum_posts WHERE author_username = 'dimitri-pnj' AND content LIKE '%avait misé%' ORDER BY id`);

test('le défi médaille : sur soi, trois cotes fixes croissantes, son plafond, ses refus', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  for (const u of HABITUES) await compte(u, 500);
  await compte('dora', 500);
  await semerHistorique();
  // Les quêtes paient un Prunostic placé : fermées, les soldes ne comptent que les paris.
  assert.ok((await post('/api/admin/quetes', { ouverture: 'ferme' }, ADMIN)).ok);
  assert.ok((await post('/api/admin/paris-challenge', { grosCoup: 1, jeuxDuJour: { jeux: ['swapou2_classic', 'bandas_challenge'] } }, ADMIN)).ok);
  const e = await etat('grenade');
  assert.equal(e.defi.actif, true, 'ouvert par défaut');
  assert.equal(e.defi.plafond, 20);
  const cles = e.defi.jeux.map((j) => j.cle);
  // N'importe quel jeu qui a tourné, pas seulement les deux du jour ; pas le Kaluga, désert.
  assert.ok(cles.includes('swapou2_classic') && cles.includes('snake3_classic'), cles.join(','));
  assert.ok(!cles.includes('kaluga_classic'), 'pas de défi sur un jeu qui n’a pas tourné');
  const sw = e.defi.jeux.find((j) => j.cle === 'swapou2_classic');
  assert.ok(sw.cotes.bronze < sw.cotes.argent && sw.cotes.argent < sw.cotes.or, 'l’or est le plus dur, il paie le plus : ' + JSON.stringify(sw.cotes));
  assert.deepEqual([sw.joues, sw.podiums, sw.ors], [29, 19, 19]);
  // Un joueur qui ne gagne jamais l'or a une cote d'or plus haute que grenade.
  const fig = (await etat('figue')).defi.jeux.find((j) => j.cle === 'swapou2_classic');
  assert.ok(fig.cotes.or > sw.cotes.or && fig.cotes.bronze > sw.cotes.bronze);
  // Les refus.
  assert.equal((await parier('grenade', 'swapou2_classic', 'defi_or', 5, 'papaye')).code, 'soi', 'le défi se relève pour soi');
  assert.equal((await parier('grenade', 'kaluga_classic', 'defi_or', 5)).code, 'jeu');
  assert.equal((await parier('grenade', 'jeu-inconnu', 'defi_or', 5)).code, 'jeu');
  assert.equal((await parier('grenade', 'swapou2_classic', 'defi_platine', 5)).code, 'type');
  assert.equal((await parier('grenade', 'swapou2_classic', 'defi_or', 21)).code, 'plafond', '20 kikooz par jour sur les défis');
  // Les mises : à la cote du moment, figée, et la rallonge s'ajoute.
  const m1 = await parier('grenade', 'swapou2_classic', 'defi_or', 10, 'grenade');
  assert.equal(m1.ok, true, JSON.stringify(m1));
  assert.deepEqual([m1.cote, m1.retour], [sw.cotes.or, Math.floor(10 * sw.cotes.or + 1e-9)]);
  const m2 = await parier('grenade', 'swapou2_classic', 'defi_or', 5);
  assert.equal(m2.mise, 15);
  assert.equal(m2.retour, m1.retour + Math.floor(5 * sw.cotes.or + 1e-9));
  const trop = await parier('grenade', 'snake3_classic', 'defi_bronze', 6);
  assert.equal(trop.code, 'plafond');
  assert.match(trop.message, /encore y miser 5/);
  assert.equal(await solde('grenade'), 485);
  // Le plafond du JOUR tient compte des défis : 15 + 40 > 50.
  assert.equal((await parier('grenade', 'swapou2_classic', 'podium', 40, 'papaye')).code, 'plafond');
  // Les autres : myrtille vise l'argent au Swapou, clémence une médaille au Frutisnake.
  assert.equal((await parier('myrtille', 'swapou2_classic', 'defi_argent', 10)).ok, true);
  assert.equal((await parier('clemence', 'snake3_classic', 'defi_bronze', 8)).ok, true);
  // La page : mes défis à part, pas dans les pots mutuels des jeux du jour.
  const e2 = await etat('grenade');
  assert.deepEqual(e2.defi.mesDefis.map((p) => [p.jeu, p.couleur, p.mise]), [['swapou2_classic', 'or', 15]]);
  assert.equal(e2.defi.dejaMise, 15);
  const swDuJour = e2.jeux.find((j) => j.cle === 'swapou2_classic');
  assert.deepEqual(swDuJour.pots, { podium: 0, or: 0 });
  assert.deepEqual(swDuJour.mesParis, []);
  assert.deepEqual(e2.autresParis, [], 'le défi n’est pas un « autre pari »');
  // Changer les jeux du jour ne rembourse pas un défi (il ne dépend pas d'eux).
  assert.ok((await post('/api/admin/paris-challenge', { jeuxDuJour: { jeux: ['swapou2_classic', 'grapiz_challenge'] } }, ADMIN)).ok);
  await wait(300);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM challenge_paris WHERE statut = 'ouvert' AND type LIKE 'defi_%'`))[0].n, 3);
  // L'admin voit les défis de demain.
  const adm = await (await fetch(BASE + '/api/admin/paris-challenge', { headers: ADMIN })).json();
  assert.equal(adm.reglages.defiActif, true);
  assert.equal(adm.reglages.dimitriCadence, 'jour');
  assert.equal(adm.jeux.find((j) => j.cle === 'swapou2_classic').demain.defi, 25);
});

test('la nuit passe : le défi se règle à sa cote, les médailles rapportent de l’XP, Dimitri poste une fois', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const retourGrenade = (await sql(`SELECT retour FROM challenge_paris WHERE username = 'grenade'`))[0].retour;
  await sql(`UPDATE challenge_paris SET jour = $1`, [jourParis(-1)]);
  await jouer('grenade', 9000);
  await jouer('papaye', 8000);
  await jouer('myrtille', 7000);
  await jouer('clemence', 6000);
  const avant = { grenade: await solde('grenade'), myrtille: await solde('myrtille'), clemence: await solde('clemence') };
  const xpAvant = { papaye: await xp('papaye'), myrtille: await xp('myrtille') };
  assert.ok((await post('/api/admin/challenge/roll', {}, ADMIN)).ok);
  const regles = await attendre(async () => {
    const r = await sql(`SELECT username, type, statut, gain FROM challenge_paris ORDER BY username`);
    return r.every((x) => x.statut !== 'ouvert') && r;
  });
  // grenade a l'or : payée à sa cote ; myrtille finit 3e, pas d'argent : perdu ;
  // le Frutisnake n'a pas tourné hier : clémence est remboursée.
  assert.deepEqual(regles.map((r) => [r.username, r.type, r.statut, Number(r.gain)]), [
    ['clemence', 'defi_bronze', 'rembourse', 8],
    ['grenade', 'defi_or', 'gagne', retourGrenade],
    ['myrtille', 'defi_argent', 'perdu', 0],
  ]);
  // Les kikooz des médailles (or 15, bronze 5) s'ajoutent au règlement.
  assert.equal(await attendre(async () => (await solde('grenade')) === avant.grenade + retourGrenade + 15), true);
  assert.equal(await solde('myrtille'), avant.myrtille + 5);
  assert.equal(await solde('clemence'), avant.clemence + 8);
  // L'XP DES MÉDAILLES, dans le registre et dans le message de chacune.
  const registre = await attendre(async () => {
    const r = await sql(`SELECT username, medal, xp FROM challenge_medailles_xp WHERE ranking_id = 'swapou2_classic' ORDER BY xp DESC`);
    return r.length === 3 && r;
  });
  assert.deepEqual(registre.map((r) => [r.username, r.medal, r.xp]), [['grenade', 'or', 7500], ['papaye', 'argent', 5000], ['myrtille', 'bronze', 2500]]);
  const messages = await attendre(async () => {
    const r = await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id WHERE u.username = 'papaye' AND l.entry_type = 60`);
    return r.length && r;
  });
  assert.match(messages[0].content, /médaille d'argent à .* et empoché 10 kikooz et 5000 XP !/);
  const xp1 = { papaye: (await xp('papaye')) - xpAvant.papaye, myrtille: (await xp('myrtille')) - xpAvant.myrtille };
  // DIMITRI : le gros coup de grenade, en un message.
  const posts = await attendre(async () => { const r = await dimitri(); return r.length && r; });
  assert.equal(posts.length, 1);
  assert.match(posts[0].content, /@grenade avait misé 15 kikooz sur le défi de grenade : l’or à Swapou 2/);
  const memo = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'dimitri_message_jour'`))[0].value);
  assert.deepEqual([memo.jour, memo.postId], [jourParis(0), posts[0].id]);

  // LE JOUR REJOUÉ : les mêmes scores, le même roll — les kikooz des médailles
  // repartent (la règle d'avant), mais pas leur XP.
  await jouer('grenade', 9000);
  await jouer('papaye', 8000);
  await jouer('myrtille', 7000);
  const xpMilieu = { papaye: await xp('papaye'), myrtille: await xp('myrtille') };
  assert.ok((await post('/api/admin/challenge/roll', {}, ADMIN)).ok);
  const seconds = await attendre(async () => {
    const r = await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id WHERE u.username = 'papaye' AND l.entry_type = 60 ORDER BY l.id`);
    return r.length === 2 && r;
  });
  assert.match(seconds[1].content, /empoché 10 kikooz ! /, 'plus d’XP annoncée : elle est déjà payée');
  await wait(500);
  const xp2 = { papaye: (await xp('papaye')) - xpMilieu.papaye, myrtille: (await xp('myrtille')) - xpMilieu.myrtille };
  assert.equal(xp1.papaye - xp2.papaye, 5000, `l’argent ne paie son XP qu’une fois (${xp1.papaye} puis ${xp2.papaye})`);
  // myrtille avait parié (1 000 XP le premier soir) : son bronze, lui aussi, une fois.
  assert.equal(xp1.myrtille - xp2.myrtille, 1000 + 2500);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM challenge_medailles_xp`))[0].n, 3);
});

test('Dimitri : le même jour, il complète son message ; en « direct », il en poste un autre', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Un défi d'avant-hier resté ouvert (le roll l'a manqué) : myrtille y était
  // bronze (semerHistorique, i = 2). Le rattrapage le règle : un gros coup de plus.
  await sql(`INSERT INTO challenge_paris (jour, jeu, type, username, choix, mise, cote, retour) VALUES ($1, 'swapou2_classic', 'defi_bronze', 'myrtille', 'myrtille', 10, 3, 30)`, [jourParis(-2)]);
  assert.equal((await post('/api/admin/paris-challenge/rattraper', {}, ADMIN)).jours, 1);
  const complete = await attendre(async () => { const r = await dimitri(); return r.length === 1 && /@myrtille/.test(r[0].content) && r; });
  assert.ok(complete, 'toujours UN message aujourd’hui, complété');
  assert.match(complete[0].content, /@grenade avait misé[\s\S]*\[b\]— Mise à jour de \d\d h \d\d —\[\/b\][\s\S]*@myrtille avait misé 10 kikooz sur le défi de myrtille : une médaille à Swapou 2/);
  // En « direct » : un message par règlement, comme avant.
  assert.equal((await post('/api/admin/paris-challenge', { dimitriCadence: 'n-importe' }, ADMIN)).error, 'bad_cadence');
  assert.ok((await post('/api/admin/paris-challenge', { dimitriCadence: 'direct' }, ADMIN)).ok);
  await sql(`INSERT INTO challenge_paris (jour, jeu, type, username, choix, mise, cote, retour) VALUES ($1, 'swapou2_classic', 'defi_bronze', 'papaye', 'papaye', 10, 2, 20)`, [jourParis(-3)]);
  assert.equal((await post('/api/admin/paris-challenge/rattraper', {}, ADMIN)).jours, 1);
  const deux = await attendre(async () => { const r = await dimitri(); return r.length === 2 && r; });
  assert.ok(deux, 'un second message');
  assert.match(deux[1].content, /@papaye avait misé 10 kikooz/);
  assert.doesNotMatch(deux[1].content, /Mise à jour/);
  assert.ok((await post('/api/admin/paris-challenge', { dimitriCadence: 'jour' }, ADMIN)).ok);
});

test('fermer le défi rembourse les défis en jeu ; la page et l’admin portent le défi', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const avant = await solde('figue');
  assert.equal((await parier('figue', 'snake3_classic', 'defi_or', 7)).ok, true);
  assert.equal(await solde('figue'), avant - 7);
  assert.equal((await post('/api/admin/paris-challenge', { plafondDefi: 0 }, ADMIN)).error, 'bad_plafond_defi');
  assert.ok((await post('/api/admin/paris-challenge', { defiActif: false }, ADMIN)).ok);
  assert.equal(await attendre(async () => (await solde('figue')) === avant), true, 'la mise revient');
  assert.equal((await etat('figue')).defi.actif, false);
  assert.equal((await parier('figue', 'snake3_classic', 'defi_or', 7)).code, 'fermes');
  assert.ok((await post('/api/admin/paris-challenge', { defiActif: true }, ADMIN)).ok);
  const page = fs.readFileSync(path.join(ROOT, 'public/paris/index.html'), 'utf8');
  assert.match(page, /data-defi="/);
  assert.match(page, /Défi médaille/);
  const admin = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  for (const id of ['pc-defi', 'pc-plafonddefi', 'pc-cadence']) assert.ok(admin.includes(`id="${id}"`), id);
});
