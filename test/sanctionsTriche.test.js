'use strict';
/*
 * LA FICHE DE SUSPICION ET LES SANCTIONS (onglet Alertes de l'admin).
 *
 *   · la fiche réunit alertes, historique, parties vérifiées, Swapou et IA,
 *     comptes liés, kikooz reçus, et les scores contre leur distribution ;
 *   · annuler un score (en place, puis d'une journée archivée), retirer des
 *     pictos (et la sauvegarde suivante ne les rend pas), exclure des
 *     classements puis lever l'exclusion — chaque action journalisée ;
 *   · toutes ces routes sont réservées à l'admin.
 *
 * Postgres sur 5433 (sinon, les tests s'effacent).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3751;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-sanctions';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_sanctions_triche';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-sanctions-triche-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JSN = { 'Content-Type': 'application/json' };
const ADMIN = { 'x-admin-key': CLE, 'Content-Type': 'application/json' };
const jourParis = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

let proc = null, dispo = false, pg = null;
const sql = async (q, p) => (await pg.query(q, p)).rows;

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

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5953', FRUTISCORE_PORT: '5954', FRUTI_DATA_DIR: DONNEES, TRICHE_DELAI_VERIF_MS: '400',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/api/admin/triche/exclusions', { headers: ADMIN })).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
  // Le port s'ouvre avant que la base soit prête : on attend que le schéma
  // existe (créé d'un bloc), puis la fin du démarrage.
  pg = new Client({ connectionString: DB });
  await pg.connect();
  for (let i = 0; i < 200; i++) {
    const r = await pg.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'triche_pictos_retires'`);
    if (r.rows.length) break;
    await wait(250);
  }
  await wait(1500);
});
after(async () => {
  if (proc) proc.kill('SIGKILL');
  if (pg) await pg.end().catch(() => {});
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: JSN, body });
  return (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSN, body })).json()).sid;
}
const sauver = (sid, game, fiche) => fetch(BASE + '/api/saveFrutiSlot', {
  method: 'POST', body: new URLSearchParams({ sid, game, slotId: '0', data: JSON.stringify(fiche) }) }).then((r) => r.text());
const admin = (route, corps) => fetch(BASE + route, corps === undefined ? { headers: ADMIN }
  : { method: 'POST', headers: ADMIN, body: JSON.stringify(corps) }).then(async (r) => Object.assign({ statut: r.status }, await r.json()));
const alertes = async (pseudo) => (await admin('/api/admin/triche/alertes?username=' + pseudo)).alertes;

// Une fiche de Swapou : 46 cases de $items, 11 compteurs de combos.
function ficheSwapou({ items = [], combos = [], record = 0, swap = 0 } = {}) {
  const it = Array.from({ length: 46 }, (_, i) => items === 'tout' ? i !== 1 : items.includes(i));
  return { $chars: [true, false, false, false, false, false, false], $items: it, $combos: combos, $record: record,
    $classic_record: 0, $swap: swap };
}

let sidT;

// De quoi instruire : une fiche modeste, puis forgée — l'album entier, des
// combos par centaines, sans aucune partie (trois alertes).
test('une fiche forgée, pour avoir de quoi instruire', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  sidT = await inscrire('tricheur');
  assert.equal(await sauver(sidT, 'swapou2', ficheSwapou({ combos: [3, 1], record: 1000 })), 'ok=1');
  assert.equal(await sauver(sidT, 'swapou2', ficheSwapou({ items: 'tout',
    combos: [300, 200, 100, 50, 40, 30, 20, 10, 5, 5, 10], record: 999999 })), 'ok=1');
  await wait(1200);
  assert.deepEqual((await alertes('tricheur')).map((a) => a.type).sort(), ['combos_sans_partie', 'pictos_en_rafale', 'saut_compteur']);
});

test('la fiche de suspicion réunit tout', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await inscrire('complice');
  // Un score du jour très au-dessus de ses journées habituelles.
  const s = await fetch(`${BASE}/api/saveScore?sid=${sidT}&game=miniwave&m=0&score=48000&data=37`).then((r) => r.json());
  assert.ok(s, 'score posté');
  for (let i = 1; i <= 10; i++) {
    const j = jourParis(new Date(Date.now() - (i + 2) * 86400000));
    await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score) VALUES ($1, 'miniwave_classic', 'tricheur', $2)`, [j, 4000 + i * 100]);
  }
  await sql(`INSERT INTO swapou_parties (id, username, graine, source, fini_le, score_declare, score_rejoue, verdict, raison, nb_coups, duree_ms)
             VALUES ('sp1', 'tricheur', 42, 'locale', now(), 90000, 1200, 'divergent', 'score rejoué 1200', 80, 60000),
                    ('sp2', 'tricheur', 43, 'serveur', now(), 8000, 8000, 'conforme', '', 120, 300000)`);
  await sql(`INSERT INTO swapou_ia_scores (username, score, data) VALUES ('tricheur', 77000, 'ia')`);
  await sql(`INSERT INTO parties_verifiees (id, jeu, username, fini_le, score_declare, verdict, raison)
             VALUES ('pv1', 'minipixiz', 'tricheur', now(), 88888, 'refuse', 'sans jeton')`);
  await sql(`INSERT INTO connexions (username, jour, ip, appareil) VALUES ('tricheur', $1, '10.0.0.9', 'appareil-commun'),
             ('complice', $1, '10.0.0.9', 'appareil-commun')`, [jourParis()]);
  await sql(`INSERT INTO kikooz_gifts (giver, recipient, amount, reason, source) VALUES ('complice', 'tricheur', 500, 'merci', 'personnel')`);

  const f = await admin('/api/admin/triche/joueur/tricheur');
  assert.equal(f.ok, true, JSON.stringify(f));
  assert.equal(f.compte.existe, true);
  assert.ok(f.alertes.some((a) => a.type === 'combos_sans_partie'));
  assert.ok(f.historique.some((h) => h.champ === '$combos[10]'));
  assert.deepEqual(f.swapou.bilan, Object.assign({}, f.swapou.bilan, { parties: 2, conformes: 1, divergentes: 1, grainesLocales: 1 }));
  assert.equal(f.swapou.ia[0].score, 77000);
  assert.equal(f.partiesVerifiees[0].verdict, 'refuse');
  assert.ok(f.comptesLies.groupe && f.comptesLies.groupe.comptes.some((c) => c.username === 'complice'), 'le complice est lié');
  assert.ok(f.comptesLies.connexions.length >= 1);
  assert.equal(f.kikooz.dons[0].giver, 'complice');
  const mw = f.scores.find((x) => x.rankingId === 'miniwave_classic');
  assert.ok(mw, 'le classement Mini-Wave : ' + JSON.stringify(f.scores));
  assert.equal(mw.enPlace.score, 48000);
  assert.equal(mw.meilleur, 48000);
  assert.equal(mw.n, 11);
  assert.equal(mw.ecart, 'fort', 'un record dix fois au-dessus de sa médiane');
  const sw = f.parPartie.find((x) => x.jeu === 'swapou2');
  assert.equal(sw.meilleur, 90000);
  assert.ok(f.pictos.actuels.some((p) => p.id === '$combo10'), 'les pictos de la fiche forgée');
});

test('annuler un score : en place, puis d’une journée archivée (médailles intactes)', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const r = await admin('/api/admin/triche/joueur/tricheur/annuler-score', { ranking: 'miniwave_classic', note: 'record forgé' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.score, 48000);
  const live = await sql(`SELECT s.score FROM scores s JOIN users u ON u.id = s.user_id WHERE u.username = 'tricheur' AND ranking_id = 'miniwave_classic'`);
  assert.equal(live.length, 0, 'retiré de la table scores');
  const f = await admin('/api/admin/triche/joueur/tricheur');
  assert.equal(f.scores.find((x) => x.rankingId === 'miniwave_classic').enPlace, null, 'retiré de la mémoire');
  // Une journée passée, médaillée : la ligne d'archive part, la médaille reste.
  const jour = jourParis(new Date(Date.now() - 3 * 86400000));
  const uid = (await sql(`SELECT id FROM users WHERE username = 'tricheur'`))[0].id;
  await sql(`INSERT INTO challenge_medals (user_id, username, ranking_id, game, rank, medal, awarded_day)
             VALUES ($1, 'tricheur', 'miniwave_classic', 'miniwave', 1, 'or', $2)`, [uid, jour]);
  const r2 = await admin('/api/admin/triche/joueur/tricheur/annuler-score', { ranking: 'miniwave_classic', jour });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM challenge_score_archive WHERE username = 'tricheur' AND day_key = $1`, [jour]))[0].n, 0);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM challenge_score_archive WHERE username = 'tricheur'`))[0].n, 9, 'les autres journées restent');
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM challenge_medals WHERE username = 'tricheur'`))[0].n, 1, 'la médaille reste');
  assert.equal((await admin('/api/admin/triche/joueur/tricheur/annuler-score', { ranking: 'miniwave_classic', jour })).statut, 404);
  // La trace : une action traitée, et le journal de modération.
  const actions = (await alertes('tricheur')).filter((a) => a.type === 'action_admin');
  assert.equal(actions.length, 2);
  assert.ok(actions.every((a) => a.statut === 'traitee'));
  assert.ok(actions.some((a) => a.note === 'record forgé'));
  const modlogs = await (await fetch(BASE + '/api/admin/users/tricheur/modlogs', { headers: ADMIN })).json();
  assert.ok(modlogs.some((m) => m.action === 'triche:annuler_score'));
  // Les actions ne comptent pas au décompte des soupçons.
  const j = (await admin('/api/admin/triche/joueurs')).joueurs.find((x) => x.username === 'tricheur');
  assert.equal(j.total, 3, 'trois alertes, pas cinq');
});

test('retirer des pictos : la sauvegarde suivante ne les rend pas ; les rendre', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const alerte = (await alertes('tricheur')).find((a) => a.type === 'pictos_en_rafale');
  const r = await admin('/api/admin/triche/joueur/tricheur/retirer-pictos', { pictos: ['$combo10', '$combo09'], note: 'album forgé', alerte: alerte.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  const items = async () => (await fetch(BASE + '/api/admin/users/tricheur/gameitems', { headers: ADMIN })).json();
  assert.ok(!(await items()).includes('$combo10'));
  const enBase = await sql(`SELECT item_name FROM user_game_items g JOIN users u ON u.id = g.user_id WHERE u.username = 'tricheur'`);
  assert.ok(!enBase.some((x) => x.item_name === '$combo10'));
  // La fiche porte encore la case cochée : la sauvegarde suivante ne la rend pas.
  await sauver(sidT, 'swapou2', ficheSwapou({ items: 'tout', combos: [300, 200, 100, 50, 40, 30, 20, 10, 5, 5, 10], record: 999999, swap: 7 }));
  await wait(200);
  assert.ok(!(await items()).includes('$combo10'), 'toujours retiré après la sauvegarde');
  // L'alerte qui l'a motivée est close.
  const close = (await alertes('tricheur')).find((a) => a.id === alerte.id);
  assert.equal(close.statut, 'traitee');
  // Rendre.
  const rr = await admin('/api/admin/triche/joueur/tricheur/rendre-pictos', { pictos: ['$combo10'] });
  assert.equal(rr.ok, true);
  assert.ok((await items()).includes('$combo10'));
  const f = await admin('/api/admin/triche/joueur/tricheur');
  assert.deepEqual(f.pictos.retires.map((p) => p.id), ['$combo09']);
});

test('exclure des classements, puis lever l’exclusion', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const e = await admin('/api/admin/triche/joueur/tricheur/exclusion', { exclu: true, motif: 'récidive' });
  assert.equal(e.ok, true);
  assert.equal((await admin('/api/admin/triche/exclusions')).exclusions[0].username, 'tricheur');
  await fetch(`${BASE}/api/saveScore?sid=${sidT}&game=miniwave&m=0&score=30000&data=20`);
  await wait(300);
  const live = () => sql(`SELECT s.score FROM scores s JOIN users u ON u.id = s.user_id WHERE u.username = 'tricheur' AND ranking_id = 'miniwave_classic'`);
  assert.equal((await live()).length, 0, 'exclu : pas classé');
  assert.ok((await alertes('tricheur')).some((a) => a.type === 'score_exclu'), 'et le score part en alerte');
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM triche_exclusions`))[0].n, 1, 'le drapeau est en base');
  // Levée.
  const l = await admin('/api/admin/triche/joueur/tricheur/exclusion', { exclu: false });
  assert.equal(l.ok, true);
  await fetch(`${BASE}/api/saveScore?sid=${sidT}&game=miniwave&m=0&score=30000&data=20`);
  await wait(300);
  assert.equal(Number((await live())[0].score), 30000, 'levée : classé de nouveau');
  assert.equal((await admin('/api/admin/triche/joueur/tricheur/exclusion', { exclu: false })).statut, 404);
});

test('toutes ces routes sont réservées à l’admin', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  for (const [m, r] of [['GET', '/api/admin/triche/joueur/tricheur'], ['GET', '/api/admin/triche/historique'],
    ['GET', '/api/admin/triche/exclusions'], ['POST', '/api/admin/triche/joueur/tricheur/annuler-score'],
    ['POST', '/api/admin/triche/joueur/tricheur/retirer-pictos'], ['POST', '/api/admin/triche/joueur/tricheur/rendre-pictos'],
    ['POST', '/api/admin/triche/joueur/tricheur/exclusion']]) {
    const rep = await fetch(BASE + r, { method: m, headers: JSN, body: m === 'POST' ? JSON.stringify({ exclu: true, ranking: 'miniwave_classic', pictos: ['$combo01'] }) : undefined });
    assert.ok([401, 403].includes(rep.status), `${m} ${r} → ${rep.status}`);
  }
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM triche_exclusions`))[0].n, 0, 'rien n’a bougé');
});
