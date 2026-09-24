'use strict';
/*
 * Le Palmarès de l'admin — les stats « sympas » à partager avec la
 * communauté —, contre une vraie base (sauté sans Postgres de test).
 *
 * On sème les tables à la main (totoches, achats, dons, médailles, forum,
 * parrainages, profils), avec une ligne vieille de quarante jours et un PNJ,
 * puis on vérifie : les classements et leur ordre, la période (30 jours
 * écarte la vieille ligne), les citations comptées par [quote=…], les PNJ
 * absents partout, la date par défaut des anniversaires ignorée — et la
 * porte, fermée sans clé.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const RACINE = path.join(__dirname, '..');
const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_palmares';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc, dispo = false;

async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}

function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5188', FRUTISCORE_PORT: '5189',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
}
async function pret() {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/online-count')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  demarrer();
  await pret();
  // Des Frutiz, puis la base garnie à la main.
  for (const u of ['Pomme', 'Kiwi', 'Cerise', 'Mangue']) {
    await fetch(BASE + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: 'secret123' }),
    });
  }
  const c = new Client({ connectionString: DB });
  await c.connect();
  const vieux = "now() - interval '40 days'";
  await c.query(`
    INSERT INTO moderation_logs (target_username, moderator, action, detail, created_at) VALUES
      ('kiwi', 'modo', 'totoche', '10 min', now()), ('kiwi', 'auto', 'totoche', 'mots interdits', now()),
      ('kiwi', 'modo', 'totoche', '10 min', now()), ('cerise', 'modo', 'totoche', '10 min', now()),
      ('pomme', 'modo', 'totoche', '10 min', ${vieux}), ('pomme', 'modo', 'totoche', '10 min', ${vieux}),
      ('pomme', 'modo', 'totoche', '10 min', ${vieux}), ('pomme', 'modo', 'totoche', '10 min', ${vieux}),
      ('mangue', 'modo', 'kick', '', now()), ('gaspard', 'modo', 'totoche', '', now());
    INSERT INTO shop_purchases (username, pack_name, category, price, created_at) VALUES
      ('pomme', 'Chapeau de paille', 'accessoire', 120, now()), ('kiwi', 'Chapeau de paille', 'accessoire', 120, now()),
      ('cerise', 'Chapeau de paille', 'accessoire', 120, now()), ('cerise', 'Lunettes 3D', 'accessoire', 300, now()),
      ('cerise', 'Lunettes 3D', 'accessoire', 300, now());
    INSERT INTO kikooz_gifts (giver, recipient, amount, source) VALUES
      ('mangue', 'pomme', 50, 'personnel'), ('mangue', 'kiwi', 30, 'personnel'),
      ('pomme', 'kiwi', 10, 'personnel'), ('modo', 'kiwi', 500, 'enveloppe');
    INSERT INTO challenge_medals (username, ranking_id, game, rank, medal, awarded_day) VALUES
      ('kiwi', 'snake3_classic', 'snake3', 1, 'or', '2026-09-01'), ('kiwi', 'snake3_classic', 'snake3', 1, 'or', '2026-09-02'),
      ('pomme', 'snake3_classic', 'snake3', 1, 'or', '2026-09-03'), ('pomme', 'snake3_classic', 'snake3', 2, 'argent', '2026-09-04'),
      ('pomme', 'snake3_classic', 'snake3', 2, 'argent', '2026-09-05'), ('cerise', 'mb2_classic', 'mb2', 3, 'bronze', '2026-09-05');
    UPDATE users SET xp = 250000, kikooz = 900, fruti_sign = 5, birthday = '1995-12-24' WHERE username = 'mangue';
    UPDATE users SET xp = 90000, kikooz = 50, fruti_sign = 5, birthday = '1998-12-02' WHERE username = 'kiwi';
    UPDATE users SET xp = 10000, kikooz = 4000, fruti_sign = 1 WHERE username = 'cerise';
    UPDATE users SET referred_by = 'mangue', referral_state = 'rewarded' WHERE username IN ('kiwi', 'cerise');
    UPDATE users SET referred_by = 'pomme', referral_state = 'pending' WHERE username = 'mangue';
  `);
  // Le forum : un sujet de Pomme, des réponses qui citent.
  const board = (await c.query(`SELECT id FROM forum_boards WHERE name = 'Frutiz' LIMIT 1`)).rows[0];
  const t = (await c.query(`INSERT INTO forum_topics (board_id, author_username, title, last_post_by)
                            VALUES ($1, 'pomme', 'Le grand sujet', 'pomme') RETURNING id`, [board.id])).rows[0];
  await c.query(`INSERT INTO forum_posts (topic_id, author_username, content) VALUES
      ($1, 'pomme', 'Premier !'),
      ($1, 'kiwi', '[quote=Pomme]\nPremier ![/quote]\nBravo.'),
      ($1, 'cerise', '[quote=Pomme]x[/quote] et [quote=Kiwi]y[/quote]'),
      ($1, 'kiwi', 'Encore moi.')`, [t.id]);
  await c.end();
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const palmares = (periode, cle = true) => fetch(BASE + '/api/admin/palmares?periode=' + periode, { headers: cle ? { 'x-admin-key': CLE } : {} })
  .then((r) => r.json().then((j) => Object.assign({ statut: r.status }, j)));
const noms = (l) => (l || []).map((r) => r.u);

test('le palmarès classe, écarte les PNJ, et ne garde que la période demandée', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  assert.strictEqual((await palmares('tout', false)).statut, 403, 'fermé sans clé');

  const tout = await palmares('tout');
  assert.strictEqual(tout.ok, true, JSON.stringify(tout));
  // Les totochés : Pomme (4, il y a 40 jours) devant Kiwi (3) — le kick ne compte pas, Gaspard (PNJ) non plus.
  assert.deepStrictEqual(tout.totoches.map((r) => [r.u, r.n]), [['Pomme', 4], ['Kiwi', 3], ['Cerise', 1]]);
  // Sur 30 jours, la vieille série disparaît.
  const mois = await palmares('30');
  assert.deepStrictEqual(mois.totoches.map((r) => [r.u, r.n]), [['Kiwi', 3], ['Cerise', 1]]);
  assert.strictEqual(mois.periode, '30');

  // La boutique : l'accessoire le plus acheté, et le plus gros dépensier.
  assert.deepStrictEqual(tout.accessoires.map((r) => [r.nom, r.n]), [['Chapeau de paille', 3], ['Lunettes 3D', 2]]);
  assert.deepStrictEqual(tout.depensiers[0], { u: 'Cerise', n: 720, achats: 3 });
  // Les dons : seuls ceux de sa poche font un généreux ; les gâtés comptent tout.
  assert.deepStrictEqual(tout.genereux.map((r) => [r.u, r.n]), [['Mangue', 80], ['Pomme', 10]]);
  assert.deepStrictEqual(tout.gates[0], { u: 'Kiwi', n: 540, dons: 3 });
  // Les médailles : l'or d'abord.
  assert.deepStrictEqual(noms(tout.medailles), ['Kiwi', 'Pomme', 'Cerise']);
  assert.deepStrictEqual(tout.medailles[1], { u: 'Pomme', ors: 1, argents: 2, bronzes: 0, n: 3 });
  // Le forum : les plumes, les cités (par [quote=…]), le sujet le plus animé.
  assert.deepStrictEqual(tout.bavards.map((r) => [r.u, r.n]), [['Kiwi', 2], ['Cerise', 1], ['Pomme', 1]]);
  assert.deepStrictEqual(tout.cites.map((r) => [r.u, r.n]), [['Pomme', 2], ['Kiwi', 1]]);
  assert.strictEqual(tout.sujets[0].titre, 'Le grand sujet');
  assert.strictEqual(tout.sujets[0].n, 4);
  // Les parrains : seuls les parrainages aboutis.
  assert.deepStrictEqual(tout.parrains.map((r) => [r.u, r.n]), [['Mangue', 2]]);
  // De tout temps : niveau, fortune, fruti-signe, anniversaires (le 15 mai 1990 par défaut est ignoré).
  assert.strictEqual(tout.niveaux[0].u, 'Mangue');
  assert.strictEqual(typeof tout.niveaux[0].niveau, 'number');
  assert.deepStrictEqual(tout.fortunes[0], { u: 'Cerise', n: 4000 });
  assert.deepStrictEqual(tout.signes[0], { signe: 'kiwi', n: 2 });
  assert.deepStrictEqual(tout.anniversaires, [{ mois: 12, n: 2 }]);
  assert.strictEqual(tout.doyens.length, 4);
  // Aucun PNJ nulle part.
  const tous = JSON.stringify(tout).toLowerCase();
  for (const pnj of ['gaspard', 'vieuxpruneau', 'natacha']) assert.ok(tous.indexOf('"u":"' + pnj) < 0, pnj);
  // Les rois des records viennent de la mémoire : une liste, même vide.
  assert.ok(Array.isArray(tout.records));
});

test('après un redémarrage, les pseudos gardent leur casse (lue en base)', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  // Au démarrage, la mémoire ne tient plus ces comptes : le nom affiché vient
  // de la base, pas du pseudo en minuscules.
  proc.kill('SIGKILL');
  await wait(500);
  demarrer();
  await pret();
  const tout = await palmares('tout');
  assert.deepStrictEqual(tout.totoches.map((r) => r.u), ['Pomme', 'Kiwi', 'Cerise']);
  assert.strictEqual(tout.depensiers[0].u, 'Cerise');
  assert.strictEqual(tout.niveaux[0].u, 'Mangue');
});
