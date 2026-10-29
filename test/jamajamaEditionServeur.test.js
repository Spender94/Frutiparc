'use strict';
/*
 * JAMAJAMA — LE MODE ÉDITION ET LES STATISTIQUES, CÔTÉ SERVEUR.
 *
 * Le SWF rangeait les niveaux de ses créateurs sur le serveur (slotSave,
 * slotList, slotRename, slotFree, slotSubmit) et lui demandait ses
 * statistiques (listStats) ; la version déployée, hors ligne, n'avait ni l'un
 * ni l'autre. Ce fichier tient le circuit rebranché :
 *
 *  · un niveau mal formé, trop grand, ou posant ce que l'éditeur ne sait pas
 *    poser, est refusé ; la case d'un autre joueur ne s'écrit pas ;
 *  · VALIDER, c'est envoyer la partie gagnée : le serveur la rejoue, et seul
 *    un replay victorieux publie le niveau au tournoi, avec son nombre de
 *    coups pour record ; ensuite le niveau ne se modifie plus ;
 *  · le niveau publié se joue au tournoi comme les autres (statut, record) ;
 *  · les quatre onglets des statistiques ;
 *  · avec Postgres, tout cela survit au redémarrage.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'public/jamajama/regles.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function demarrer(port, env) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(port), REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
    }, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  return proc;
}
async function attendreServeur(base, pret) {
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(base + '/do/prefdef')).ok && (!pret || await pret())) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
}
const client = (base) => {
  const poster = (chemin, corps) => fetch(base + chemin, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
  }).then((r) => r.json());
  return {
    poster,
    lire: (chemin) => fetch(base + chemin).then((r) => r.json()),
    async inscrire(pseudo) {
      const body = JSON.stringify({ username: pseudo, password: 'secret123' });
      await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const j = await r.json();
      assert.ok(j.sid, 'session ouverte pour ' + pseudo);
      return j.sid;
    },
  };
};

// Un niveau tel que l'éditeur l'écrit : Tiki en (0,0), un mur, la sortie.
function couloir(largeur) {
  const l = new R.Level();
  l.size = new R.Dimension(largeur, 2);
  const mur = new R.Element(null);
  mur.id = R.Element.WALL; mur.pos = new R.Coord(0, 1); mur.orientation = 0;
  const sortie = new R.Element(null);
  sortie.id = R.Element.EXIT; sortie.pos = new R.Coord(largeur - 1, 0); sortie.orientation = 0;
  l.tiles.push(mur, sortie);
  return l.dump();
}
const VERS_LA_SORTIE = (largeur) => Array.from({ length: largeur - 1 }, () => R.Direction.EAST);

// ── sans base : le serveur de mise au point ──
const PORT = 3631;
const BASE = `http://127.0.0.1:${PORT}`;
const C = client(BASE);
let proc = null;
before(async () => {
  proc = demarrer(PORT, { DATABASE_URL: '', XMLSOCKET_PORT: '5651', FRUTISCORE_PORT: '5652' });
  await attendreServeur(BASE);
});
after(() => { if (proc) proc.kill('SIGKILL'); });

test('les cases du joueur : écrire, relire, renommer, supprimer', async () => {
  const sid = await C.inscrire('jamacrea');
  let d = await C.lire('/api/jamajama/edition?sid=' + sid);
  assert.ok(d.ok);
  assert.deepEqual(d.niveaux, [], 'aucun niveau au départ');
  assert.ok(d.cases > 0, 'le nombre de cases du joueur');

  d = await C.poster('/api/jamajama/edition/sauver', { sid, titre: '  Mon couloir ', contenu: couloir(4) });
  assert.ok(d.ok, JSON.stringify(d));
  const id = d.niveau.id;
  assert.ok(id > 0);
  assert.equal(d.niveau.titre, 'Mon couloir', 'le titre, nettoyé');
  assert.equal(d.niveau.valide, false);

  // Réécrire sa case.
  d = await C.poster('/api/jamajama/edition/sauver', { sid, id, titre: 'Mon couloir', contenu: couloir(5) });
  assert.ok(d.ok);
  assert.equal(d.niveau.id, id, 'la même case');
  d = await C.lire('/api/jamajama/edition?sid=' + sid);
  assert.equal(d.niveaux.length, 1);
  assert.equal(d.niveaux[0].contenu, couloir(5));

  d = await C.poster('/api/jamajama/edition/renommer', { sid, id, titre: '' });
  assert.ok(d.ok);
  assert.equal(d.niveau.titre, 'sans nom', 'un titre vide devient « sans nom » (Consts.WITHOUT_TITLE)');
  d = await C.poster('/api/jamajama/edition/renommer', { sid, id, titre: 'x'.repeat(80) });
  assert.equal(d.niveau.titre.length, 40, 'quarante caractères au plus (maxChars)');

  // La case d'un autre ne s'écrit pas, ne se supprime pas.
  const autre = await C.inscrire('jamavoisin');
  d = await C.poster('/api/jamajama/edition/sauver', { sid: autre, id, titre: 'vol', contenu: couloir(4) });
  assert.equal(d.ok, false);
  assert.equal(d.error, 'niveau');
  d = await C.poster('/api/jamajama/edition/supprimer', { sid: autre, id });
  assert.equal(d.ok, false);
  d = await C.lire('/api/jamajama/edition?sid=' + autre);
  assert.deepEqual(d.niveaux, [], 'chacun ses niveaux');

  d = await C.poster('/api/jamajama/edition/supprimer', { sid, id });
  assert.ok(d.ok);
  d = await C.lire('/api/jamajama/edition?sid=' + sid);
  assert.deepEqual(d.niveaux, []);

  d = await C.lire('/api/jamajama/edition?sid=inconnu');
  assert.equal(d.error, 'session', 'sans session, rien');
});

test('un niveau que l’éditeur n’aurait pas pu faire est refusé', async () => {
  const sid = await C.inscrire('jamaforge');
  const refuse = async (contenu, quoi) => {
    const d = await C.poster('/api/jamajama/edition/sauver', { sid, titre: 't', contenu });
    assert.equal(d.ok, false, quoi);
    assert.equal(d.error, 'contenu', quoi);
  };
  await refuse('', 'vide');
  await refuse(123, 'pas une chaîne');
  await refuse('100d2', 'trop large (13 colonnes)');
  await refuse('1002c', 'trop haut (12 lignes)');
  await refuse('10022' + '410000', 'un interrupteur (PIN), que Sprite.create ignore');
  await refuse('10022' + '110000', 'Tiki en tuile : il est la case de départ');
  await refuse('10022' + '850000', 'une tuile hors du plateau');
  await refuse('10022' + '810000' + '210000', 'deux éléments sur une case');
  await refuse('10022' + '8100', 'un casier tronqué');
  await refuse('10022<b>', 'des caractères hors de l’alphabet');
  // Le plus grand plateau, plein : il passe.
  const l = new R.Level();
  l.size = new R.Dimension(12, 11);
  l.startPos = new R.Coord(0, 0);
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 12; x++) {
      if (!x && !y) continue;
      const e = new R.Element(null);
      e.id = R.Element.WALL; e.pos = new R.Coord(x, y); e.orientation = 0;
      l.tiles.push(e);
    }
  }
  const d = await C.poster('/api/jamajama/edition/sauver', { sid, titre: 'plein', contenu: l.dump() });
  assert.ok(d.ok, 'le plateau de 12×11 plein');
});

test('valider : le serveur rejoue, publie au tournoi, et fige le niveau', async () => {
  const sid = await C.inscrire('jamavalid');
  const contenu = couloir(5);
  let d = await C.poster('/api/jamajama/edition/sauver', { sid, titre: 'Couloir', contenu });
  const id = d.niveau.id;

  // Une partie qui n'atteint pas la sortie ne valide rien.
  d = await C.poster('/api/jamajama/edition/valider', { sid, id, titre: 'Couloir', contenu, mouvements: [1, 1] });
  assert.equal(d.ok, false);
  assert.equal(d.error, 'perdu');
  d = await C.poster('/api/jamajama/edition/valider', { sid, id, titre: 'Couloir', contenu, mouvements: [1, 'x'] });
  assert.equal(d.error, 'mouvements');

  // Un détour : six coups au lieu de quatre — c'est le record qui compte.
  const detour = [R.Direction.EAST, R.Direction.WEST].concat(VERS_LA_SORTIE(5));
  assert.ok(R.rejouer(R.Level.depuisChaine(contenu), detour).victorieux);
  d = await C.poster('/api/jamajama/edition/valider', { sid, id, titre: 'Couloir', contenu, mouvements: detour });
  assert.ok(d.ok, JSON.stringify(d));
  assert.equal(d.niveau.valide, true);
  assert.equal(d.niveau.record, 6, 'le record : les coups de la partie de validation');
  assert.equal(d.tournoi.id, id);
  assert.equal(d.tournoi.auteur, 'jamavalid');

  // Figé : ni réécrit, ni renommé, ni revalidé.
  d = await C.poster('/api/jamajama/edition/sauver', { sid, id, titre: 'autre', contenu: couloir(4) });
  assert.equal(d.error, 'valide');
  d = await C.poster('/api/jamajama/edition/renommer', { sid, id, titre: 'autre' });
  assert.equal(d.error, 'valide');
  d = await C.poster('/api/jamajama/edition/valider', { sid, id, titre: 'x', contenu, mouvements: VERS_LA_SORTIE(5) });
  assert.equal(d.error, 'valide');

  // Le tournoi de tout le monde le montre, après les niveaux de levels.xml.
  const joueur = await C.inscrire('jamajoueur');
  d = await C.lire('/api/jamajama/donnees?sid=' + joueur);
  const t = d.tournoi.find((x) => x.id === id);
  assert.ok(t, 'le niveau validé entre au tournoi');
  assert.equal(t.titre, 'Couloir');
  assert.equal(t.score, 6);
  assert.equal(t.difficulte, Math.round(6 * 6 / 290));
  assert.equal(t.contenu, contenu);
  assert.ok(d.tournoi.findIndex((x) => x.id === id) > d.tournoi.findIndex((x) => x.id > 200000));

  // Il se joue comme un niveau du tournoi : le tiki d'or en battant l'auteur.
  d = await C.poster('/api/jamajama/score', { sid: joueur, source: 'tournoi', id, mouvements: VERS_LA_SORTIE(5) });
  assert.ok(d.ok, JSON.stringify(d));
  assert.ok(d.victorieux);
  assert.equal(d.statut.s, 2, 'quatre coups contre six : l’or');
  assert.equal(d.statut.b, 4);

  // Une validation peut aussi créer la case d'un coup (niveau jamais sauvé).
  d = await C.poster('/api/jamajama/edition/valider', { sid, titre: 'Direct', contenu: couloir(3), mouvements: VERS_LA_SORTIE(3) });
  assert.ok(d.ok);
  assert.ok(d.niveau.id !== id);

  // Supprimer un niveau validé le retire du tournoi.
  await C.poster('/api/jamajama/edition/supprimer', { sid, id: d.niveau.id });
  const apres = await C.lire('/api/jamajama/donnees?sid=' + joueur);
  assert.ok(!apres.tournoi.some((x) => x.id === d.niveau.id));
  assert.ok(apres.tournoi.some((x) => x.id === id));
});

test('les statistiques : Joueurs, Créateurs, Niveaux, Mes niveaux', async () => {
  const auteur = await C.inscrire('jamastatauteur');
  const contenu = couloir(4);
  const v = await C.poster('/api/jamajama/edition/valider',
    { sid: auteur, titre: 'Stat', contenu, mouvements: VERS_LA_SORTIE(4) });
  assert.ok(v.ok);
  const id = v.niveau.id;
  const joueur = await C.inscrire('jamastatjoueur');
  await C.poster('/api/jamajama/score', { sid: joueur, source: 'tournoi', id, mouvements: [R.Direction.WEST] });
  await C.poster('/api/jamajama/score', { sid: joueur, source: 'tournoi', id, mouvements: VERS_LA_SORTIE(4) });

  let d = await C.lire(`/api/jamajama/stats?sid=${auteur}&mode=C`);
  assert.ok(d.ok);
  const createur = d.lignes.find((l) => l.u === 'jamastatauteur');
  assert.equal(createur && createur.s, '1', 'un niveau publié');

  // Les joueurs : le nombre de niveaux du tournoi terminés (première
  // demande de l'onglet sur ce serveur : la photo d'une minute est fraîche).
  d = await C.lire(`/api/jamajama/stats?sid=${joueur}&mode=P`);
  assert.ok(d.ok);
  assert.deepEqual(d.lignes.find((l) => l.u === 'jamastatjoueur'), { u: 'jamastatjoueur', s: '1' });
  assert.ok(!d.lignes.some((l) => l.u === 'jamastatauteur'), 'qui n’a rien terminé n’y est pas');
  for (const l of d.lignes) assert.ok(l.u && Number(l.s) > 0);

  d = await C.lire(`/api/jamajama/stats?sid=${joueur}&mode=L`);
  const ligne = d.lignes.find((l) => l.t === 'Stat');
  assert.ok(d.total > d.lignes.length || d.total === d.lignes.length);
  assert.equal(d.lignes.length, Math.min(15, d.total), 'quinze lignes par page');
  if (ligne) assert.equal(ligne.s, '3', 'son meilleur score');
  // La page qui contient le niveau (trié par auteur puis titre).
  let trouve = ligne;
  for (let page = 1; !trouve && page * 15 < d.total; page++) {
    const p = await C.lire(`/api/jamajama/stats?sid=${joueur}&mode=L&page=${page}`);
    trouve = p.lignes.find((l) => l.t === 'Stat');
  }
  assert.ok(trouve, 'les niveaux des autres créateurs');
  assert.equal(trouve.u, 'jamastatauteur');
  assert.equal(trouve.s, '3');
  const jamais = (await C.lire(`/api/jamajama/stats?sid=${joueur}&mode=L`)).lignes.find((l) => !l.s);
  if (jamais) assert.match(jamais.np, /^\d+ essai\(s\)$/, 'sans score : le nombre de parties');

  d = await C.lire(`/api/jamajama/stats?sid=${auteur}&mode=O`);
  assert.deepEqual(d.lignes, [{ t: 'Stat', np: '0 essai(s)' }], 'ses propres niveaux validés');
  d = await C.lire(`/api/jamajama/stats?sid=${auteur}&mode=L`);
  assert.ok(!d.lignes.some((l) => l.u === 'jamastatauteur'), '« Niveaux » : ceux des AUTRES créateurs');
  d = await C.lire(`/api/jamajama/stats?sid=${auteur}&mode=Z`);
  assert.equal(d.error, 'mode');
});

// ── avec Postgres : les niveaux survivent au redémarrage ──
const PORT_DB = 3632;
const BASE_DB = `http://127.0.0.1:${PORT_DB}`;
const DB = process.env.TEST_DATABASE_URL_JAMAEDIT || 'postgres://postgres@127.0.0.1:5433/frutiparc_jamaedit';

async function baseNeuve() {
  let Client;
  try { ({ Client } = require(path.join(ROOT, 'node_modules', 'pg'))); } catch { return false; }
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
async function schemaPret() {
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const c = new Client({ connectionString: DB });
  try {
    await c.connect();
    const { rows } = await c.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name IN ('users', 'jama_niveaux')");
    return rows.length === 2;
  } catch { return false; } finally { try { await c.end(); } catch {} }
}

test('avec Postgres, un niveau sauvé ou validé survit au redémarrage', async (t) => {
  if (!(await baseNeuve())) return t.skip('Postgres indisponible sur 5433');
  const env = { DATABASE_URL: DB, XMLSOCKET_PORT: '5653', FRUTISCORE_PORT: '5654' };
  const D = client(BASE_DB);
  let p = demarrer(PORT_DB, env);
  try {
    await attendreServeur(BASE_DB, schemaPret);
    const sid = await D.inscrire('jamapersiste');
    const brouillon = await D.poster('/api/jamajama/edition/sauver', { sid, titre: 'Brouillon', contenu: couloir(4) });
    assert.ok(brouillon.ok, JSON.stringify(brouillon));
    const publie = await D.poster('/api/jamajama/edition/valider',
      { sid, titre: 'Publié', contenu: couloir(6), mouvements: VERS_LA_SORTIE(6) });
    assert.ok(publie.ok, JSON.stringify(publie));
  } finally { p.kill('SIGKILL'); }
  await wait(500);
  p = demarrer(PORT_DB, env);
  try {
    await attendreServeur(BASE_DB, schemaPret);
    let sid = null;
    for (let i = 0; i < 40 && !sid; i++) {
      const body = JSON.stringify({ username: 'jamapersiste', password: 'secret123' });
      const r = await fetch(BASE_DB + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      sid = (await r.json()).sid;
      if (!sid) await wait(250);
    }
    assert.ok(sid, 'le compte a survécu');
    const d = await D.lire('/api/jamajama/edition?sid=' + sid);
    assert.deepEqual(d.niveaux.map((n) => [n.titre, n.valide, n.record]),
      [['Brouillon', false, null], ['Publié', true, 5]], 'les deux cases, dans l’ordre');
    const t2 = await D.lire('/api/jamajama/donnees?sid=' + sid);
    assert.ok(t2.tournoi.some((x) => x.titre === 'Publié' && x.score === 5), 'et le tournoi');
    const refus = await D.poster('/api/jamajama/edition/sauver',
      { sid, id: d.niveaux[1].id, titre: 'x', contenu: couloir(4) });
    assert.equal(refus.error, 'valide', 'toujours figé après le redémarrage');
  } finally { p.kill('SIGKILL'); }
});
