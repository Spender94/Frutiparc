'use strict';
/*
 * SWAPOU VÉRIFIÉ ET JOURNAL DES CONNEXIONS — le serveur, de bout en bout
 * ════════════════════════════════════════════════════════════════════
 *
 * Ce que le joueur ne doit PAS voir changer, et ce que l'admin doit voir :
 *
 *   · la graine arrive par /api/swapou/partie ; la partie jouée avec elle, puis
 *     rendue avec ses coups, est enregistrée EXACTEMENT comme avant (même
 *     réponse, même classement) — puis rejouée dans le fil, et notée
 *     « conforme » ;
 *   · un score gonflé est enregistré tout pareil (mode observateur !), mais
 *     noté « divergent » ;
 *   · un score sans journal (le jeu Flash, un vieux client) passe comme avant ;
 *   · l'interrupteur du tournoi, baissé : tout score entre au tour, comme
 *     avant ; levé : seules les parties conformes y entrent ;
 *   · la connexion laisse sa ligne au journal ; deux comptes du même appareil
 *     forment un groupe de « comptes liés » ;
 *   · l'export RGPD emporte les deux tables, la suppression du compte les efface.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
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
// Le formulaire, comme le client du jeu (URLSearchParams).
function formulaire(url, champs) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(champs)) body.set(k, String(v));
  return fetch(BASE + url, { method: 'POST', body });
}

// ── Une vraie partie, jouée par le bot dans un bac à sable ─────────────────
const sb = (() => {
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URLSearchParams, performance: { now: () => Date.now() }, Date, Math, JSON,
  };
  s.self = s; s.window = s;
  vm.createContext(s);
  for (const f of ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js', 'bot.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/swapou', f), 'utf8'), s, { filename: f });
  }
  s.SW.Manager.init('');
  return s;
})();
function jouer(partie, perso) {
  const SW = sb.SW, M = SW.Manager, Bot = sb.SwapouBot;
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.players = [perso, -1];
  if (M.mode && M.mode.destroy) M.mode.destroy();
  M.client.partie = partie;
  M.mode = new SW.Challenge();
  const chal = M.mode;
  while (M.mode === chal) {
    if (!chal.lock && !chal.pause.activated()) {
      const mv = Bot.choose(chal.player.level, { charId: perso, canDefend: false, stars: chal.player.star_counter, ncoups: chal.ncoups });
      if (mv.type === 'none') break;
      const info = chal.player.animator.getInfos(), p = mv.pair;
      if (p.dx === 1) SW.handleMouseMove(info.px + p.x * 35 + 30, info.py + p.y * 35 + 17);
      else SW.handleMouseMove(info.px + p.x * 35 + 17, info.py + p.y * 35 + 30);
      chal.onClickDown();
    }
    M.main(2, 0.05);
  }
  const pf = M.client.partieFinie;
  M.client.partieFinie = null;
  return { score: chal.player.score, pf };
}
async function nouvellePartie(sid) {
  const j = await (await formulaire('/api/swapou/partie', { sid })).json();
  assert.ok(j.ok && /^[a-f0-9]{24}$/.test(j.id) && Number.isInteger(j.graine), JSON.stringify(j));
  return { id: j.id, graine: j.graine };
}
async function rendre(sid, partie, score, pf, perso) {
  const champs = { sid, game: 'swapou2', m: 0, score, data: 'S' + perso + ':' };
  if (pf) {
    if (partie && partie.id) champs.partie = partie.id; else champs.graine = pf.graine;
    champs.coups = pf.coups;
    champs.duree = pf.duree;
  }
  const r = await formulaire('/api/saveScore', champs);
  return { status: r.status, json: await r.json() };
}
async function verdict(id, pour) {
  for (let i = 0; i < 120; i++) {
    const rows = await sql('SELECT * FROM swapou_parties WHERE id = $1', [id]);
    if (rows[0] && rows[0].verdict !== 'en_cours' && rows[0].fini_le) return rows[0];
    await wait(pour || 100);
  }
  throw new Error('pas de verdict pour ' + id);
}

// ── La partie vérifiée ───────────────────────────────────────────────────

test('une partie jouée avec la graine du serveur est enregistrée comme avant, puis notée conforme', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('verifa', 'dAAAA');
  const partie = await nouvellePartie(sid);
  const { score, pf } = jouer(partie, 1);
  assert.equal(pf.id, partie.id, 'le jeu a pris la partie du serveur');
  assert.equal(pf.graine, partie.graine);
  const r = await rendre(sid, partie, score, pf, 1);
  assert.equal(r.status, 200);
  // LA RÉPONSE EST CELLE D'AVANT : mêmes champs, rien de plus.
  assert.deepEqual(Object.keys(r.json).sort(),
    ['fdBlocked', 'newPos', 'newScore', 'ok', 'oldPos', 'oldScore', 'rankingId', 'updated']);
  assert.equal(r.json.rankingId, 'swapou2_classic');
  const ligne = await verdict(partie.id);
  assert.equal(ligne.verdict, 'conforme', ligne.raison);
  assert.equal(Number(ligne.score_rejoue), score);
  assert.equal(Number(ligne.score_declare), score);
  assert.equal(ligne.source, 'serveur');
  assert.equal(ligne.username, 'verifa');
  assert.ok(ligne.nb_coups > 0 && ligne.rythme && ligne.rythme.coups === ligne.nb_coups);
  // Le numéro ne sert qu'une fois.
  const again = await rendre(sid, partie, score, pf, 1);
  assert.equal(again.status, 200, 'le score repasse comme avant');
  await wait(500);
  const x = await sql(`SELECT verdict, raison FROM swapou_parties WHERE username = 'verifa' AND id LIKE 'x%'`);
  assert.equal(x.length, 1);
  assert.equal(x[0].verdict, 'non_verifiable');
  assert.match(x[0].raison, /déjà rendue/);
});

test('un score gonflé est enregistré (mode observateur), mais noté divergent', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('verifb', 'dBBBB');
  const partie = await nouvellePartie(sid);
  const { score, pf } = jouer(partie, 0);
  const r = await rendre(sid, partie, score + 10000, pf, 0);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.newScore, score + 10000, 'le score déclaré a été pris tel quel');
  const ligne = await verdict(partie.id);
  assert.equal(ligne.verdict, 'divergent');
  assert.match(ligne.raison, /score rejoué/);
  assert.equal(Number(ligne.score_rejoue), score);
});

test('un score sans journal (Flash, vieux client) passe comme avant ; une graine locale se vérifie aussi', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await compte('verifc', '');
  const avant = (await sql('SELECT COUNT(*)::int AS n FROM swapou_parties'))[0].n;
  const r = await rendre(sid, null, 1234, null, 0);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  await wait(300);
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM swapou_parties'))[0].n, avant, 'rien à noter');
  // Hors ligne : le jeu a tiré sa graine lui-même.
  const { score, pf } = jouer(null, 2);
  assert.equal(pf.id, null);
  const r2 = await rendre(sid, null, score, pf, 2);
  assert.equal(r2.status, 200);
  await wait(300);
  const [ligne] = await sql(`SELECT * FROM swapou_parties WHERE username = 'verifc' AND source = 'locale'`);
  assert.ok(ligne, 'la partie locale est notée');
  const v = await verdict(ligne.id);
  assert.equal(v.verdict, 'conforme');
});

test('la graine d’un autre joueur ne se réutilise pas', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sidA = await compte('verifd', '');
  const sidB = await compte('verife', '');
  const partie = await nouvellePartie(sidA);
  const { score, pf } = jouer(partie, 0);
  const r = await rendre(sidB, partie, score, pf, 0);
  assert.equal(r.status, 200, 'le score de B passe quand même (observateur)');
  await wait(500);
  const [x] = await sql(`SELECT verdict, raison FROM swapou_parties WHERE username = 'verife'`);
  assert.equal(x.verdict, 'non_verifiable');
  assert.match(x.raison, /autre joueur/);
});

// ── Le tournoi ───────────────────────────────────────────────────────────

test('l’interrupteur du tournoi : baissé, tout entre ; levé, seules les parties conformes', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const etat0 = await (await fetch(BASE + '/api/admin/swapou/parties', { headers: ADMIN })).json();
  assert.equal(etat0.tournoiVerifie, false, 'baissé par défaut');
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

  // Baissé : un score sans journal entre au tour, comme avant.
  const sidF = await compte('verifflash', '');
  await rendre(sidF, null, 777, null, 0);
  assert.ok((await tour()).some((r) => r.username === 'verifflash'), 'baissé : le score entre');

  // Levé.
  const lev = await (await post('/api/admin/swapou/tournoi-verifie', { on: true }, ADMIN)).json();
  assert.equal(lev.tournoiVerifie, true);
  const [marque] = await sql(`SELECT value FROM app_state WHERE key = 'swapou_tournoi_verifie'`);
  assert.equal(marque.value, '1', 'l’interrupteur survit au redémarrage');
  // Sans journal : n'entre pas.
  const sidG = await compte('verifsansjournal', '');
  await rendre(sidG, null, 999, null, 0);
  // Gonflé : n'entre pas.
  const sidH = await compte('verifgonfle', '');
  const pH = await nouvellePartie(sidH);
  const jH = jouer(pH, 0);
  await rendre(sidH, pH, jH.score + 5000, jH.pf, 0);
  // Conforme : entre, une fois vérifié.
  const sidI = await compte('verifhonnete', '');
  const pI = await nouvellePartie(sidI);
  const jI = jouer(pI, 3);
  await rendre(sidI, pI, jI.score, jI.pf, 3);
  await verdict(pH.id);
  const vI = await verdict(pI.id);
  assert.equal(vI.verdict, 'conforme');
  await wait(300);
  const noms = (await tour()).map((r) => r.username);
  assert.ok(noms.includes('verifhonnete'), 'la partie conforme est au tour');
  assert.ok(!noms.includes('verifgonfle'), 'la partie divergente n’y est pas');
  assert.ok(!noms.includes('verifsansjournal'), 'la partie sans journal n’y est pas');
  const vH = await sql('SELECT tournoi FROM swapou_parties WHERE id = $1', [pH.id]);
  assert.equal(vH[0].tournoi, true, 'la partie est marquée « jouée pendant un tournoi »');

  // Rebaissé pour la suite.
  await post('/api/admin/swapou/tournoi-verifie', { on: false }, ADMIN);
});

test('l’admin : liste, bilan par joueur, détail d’une partie, clé maître exigée', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.equal((await fetch(BASE + '/api/admin/swapou/parties')).status, 403);
  const j = await (await fetch(BASE + '/api/admin/swapou/parties?jours=7', { headers: ADMIN })).json();
  assert.ok(j.ok);
  assert.ok(j.parties.length >= 4);
  assert.ok(!('coups' in j.parties[0]), 'le journal ne voyage pas dans la liste');
  const b = j.bilan.find((x) => x.username === 'verifb');
  assert.equal(b.divergentes, 1);
  const d = await (await fetch(BASE + '/api/admin/swapou/parties/' + j.parties[0].id, { headers: ADMIN })).json();
  assert.ok(d.partie.coups.length > 0);
  const rj = await (await post('/api/admin/swapou/parties/' + j.parties[0].id + '/rejouer', {}, ADMIN)).json();
  assert.ok(['conforme', 'divergent', 'non_verifiable'].includes(rj.verdict));
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

test('RGPD : l’export emporte les deux tables, la suppression les efface', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = (await (await post('/api/auth/login', { username: 'verifa', password: 'secret123' })).json()).sid;
  const exp = await (await fetch(BASE + '/api/light/mes-donnees?sid=' + sid)).json();
  assert.ok(Array.isArray(exp.swapou_parties) && exp.swapou_parties.length >= 1);
  assert.ok(Array.isArray(exp.connexions) && exp.connexions.length >= 1);
  const del = await fetch(BASE + '/api/admin/users/verifa', { method: 'DELETE', headers: ADMIN });
  assert.ok(del.ok, 'suppression : ' + del.status);
  await wait(300);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM swapou_parties WHERE LOWER(username) = 'verifa'`))[0].n, 0);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM connexions WHERE LOWER(username) = 'verifa'`))[0].n, 0);
});
