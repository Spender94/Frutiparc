/*
 * La MAP DU JOUR de Mini-Wave ne change pas en cours de journée.
 *
 * La graine, elle, n'a jamais bougé : elle sort de la date. Mais les NIVEAUX
 * étaient fabriqués par le CLIENT, à partir d'un générateur qu'on fait évoluer
 * — le vivier d'espèces, les motifs d'escadre, la zone rouge. Résultat : le
 * moindre déploiement changeait la map en pleine journée, et le classement du
 * jour comparait alors des scores faits sur deux parcours différents. Deux
 * joueurs pouvaient même jouer deux maps le même jour, selon la version du
 * générateur restée dans le cache de leur navigateur.
 *
 * Le serveur FIGE donc la map : il la fabrique une fois, la range (disque, et
 * base quand elle est là — le disque d'un conteneur est éphémère), puis la sert
 * telle quelle jusqu'à minuit Paris. C'est le traitement de la map MotionBall,
 * appliqué à Mini-Wave.
 *
 * Ce fichier le vérifie là où ça compte : après un REDÉMARRAGE, la map servie
 * est la même — au point qu'une map trafiquée à la main survit au reboot. C'est
 * la preuve qu'elle est relue, et non refabriquée.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3504;
const BASE = `http://127.0.0.1:${PORT}`;
const CARTE = path.join(ROOT, 'data/miniwave-challenge.json');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const C = require(path.join(ROOT, 'public/miniwave/challenge.js'));

let proc = null;
async function demarrer(base) {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: base || '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5284', FRUTISCORE_PORT: '5285',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
}
async function arreter() {
  if (!proc) return;
  proc.kill('SIGKILL');
  proc = null;
  await wait(400);
}
const defi = async () => (await fetch(BASE + '/api/miniwave/challenge')).json();

before(async () => {
  try { fs.unlinkSync(CARTE); } catch { /* pas de map à effacer */ }
  await demarrer();
});
after(async () => {
  await arreter();
  try { fs.unlinkSync(CARTE); } catch { /* déjà propre */ }
});

test('le serveur sert la map du jour, niveaux compris', async () => {
  const d = await defi();
  assert.equal(d.ok, true);
  assert.match(d.jour, /^\d{4}-\d{2}-\d{2}$/, 'le jour est une date Paris');
  assert.ok(Number.isInteger(d.graine), 'la graine voyage toujours (repli du client)');
  assert.ok(Array.isArray(d.niveaux), 'les niveaux aussi, désormais');
  assert.equal(d.niveaux.length, C.NIVEAUX_PAR_JOUR, 'la map entière');
  for (const lv of d.niveaux) {
    assert.ok(Array.isArray(lv.list) && lv.list.length >= 1, 'chaque niveau a son escadre');
    assert.ok(Number.isFinite(lv.moveSpeed) && Number.isFinite(lv.fallSpeed), 'et ses vitesses');
  }
  // Deux appels, la même map, au bit près.
  const e = await defi();
  assert.equal(JSON.stringify(e.niveaux), JSON.stringify(d.niveaux), 'stable d\'un appel à l\'autre');
});

test('la map du jour est rangée sur le disque', async () => {
  const d = await defi();
  assert.ok(fs.existsSync(CARTE), 'le fichier de la map existe');
  const range = JSON.parse(fs.readFileSync(CARTE, 'utf8'));
  assert.equal(range.jour, d.jour);
  assert.equal(range.graine, d.graine);
  assert.equal(JSON.stringify(range.niveaux), JSON.stringify(d.niveaux),
    'et c'.concat('est bien la map servie'));
});

/*
 * Le cœur du sujet. On MARQUE la map rangée — un ennemi changé, une clef en
 * plus — puis on redémarre. Si le serveur la refabriquait, la marque
 * disparaîtrait ; elle doit survivre.
 */
test('un redémarrage ne change pas la map du jour', async () => {
  const avant = await defi();
  await arreter();

  const range = JSON.parse(fs.readFileSync(CARTE, 'utf8'));
  range.niveaux[0].list[0][0].t = 7;          // une Poire sous cloche en tête
  range.marqueDeTest = 'reboot';
  fs.writeFileSync(CARTE, JSON.stringify(range));

  await demarrer();
  const apres = await defi();
  assert.equal(apres.jour, avant.jour, 'même journée');
  assert.equal(apres.graine, avant.graine, 'même graine');
  assert.equal(apres.niveaux[0].list[0][0].t, 7,
    'la map servie est celle qui était rangée, marque comprise');
  assert.equal(JSON.stringify(apres.niveaux), JSON.stringify(range.niveaux),
    'la map entière est relue, pas refabriquée');
  // Et la preuve par l'absurde : le générateur, lui, en aurait fait une autre.
  const refaite = C.genererMap(avant.graine).niveaux;
  assert.notEqual(JSON.stringify(refaite), JSON.stringify(apres.niveaux),
    'une map refabriquée aurait perdu la marque');
});

test('une map d\'un autre jour est écartée : la journée neuve a la sienne', async () => {
  const avant = await defi();
  await arreter();

  const range = JSON.parse(fs.readFileSync(CARTE, 'utf8'));
  range.jour = '2000-01-01';                  // une map d'un autre temps
  range.marqueDeTest = 'vieille';
  fs.writeFileSync(CARTE, JSON.stringify(range));

  await demarrer();
  const apres = await defi();
  assert.equal(apres.jour, avant.jour, 'le jour servi est celui du serveur');
  assert.equal(JSON.stringify(apres.niveaux), JSON.stringify(C.genererMap(apres.graine).niveaux),
    'et la map est refabriquée pour ce jour-là');
  const surDisque = JSON.parse(fs.readFileSync(CARTE, 'utf8'));
  assert.equal(surDisque.jour, apres.jour, 'le fichier suit le nouveau jour');
  assert.equal(surDisque.marqueDeTest, undefined, 'la vieille map a bien été remplacée');
});

/*
 * Le cas qui compte VRAIMENT en production : le DÉPLOIEMENT. Le disque du
 * conteneur repart de zéro, et c'est justement le moment où le générateur
 * vient de changer. Sans la copie en base, la map de la journée entamée serait
 * refabriquée — la version neuve, sur des scores déjà posés. On simule donc un
 * conteneur neuf : même base, disque effacé.
 */
test('un déploiement (disque vidé) ne change pas la map : la base fait foi', async () => {
  const { Client } = require('pg');
  const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_mwmap';
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  let dispo = false;
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    dispo = true;
  } catch { try { await admin.end(); } catch { /* rien */ } }
  if (!dispo) { console.log('    (Postgres indisponible : cas du déploiement non vérifié)'); return; }

  await arreter();
  try { fs.unlinkSync(CARTE); } catch { /* déjà propre */ }
  await demarrer(DB);
  const avant = await defi();
  await arreter();

  // On marque la map EN BASE, puis on efface le disque : c'est un conteneur neuf.
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows } = await c.query("SELECT day_key, data FROM miniwave_maps WHERE slot = 'current'");
  assert.equal(rows.length, 1, 'la map du jour est rangée en base');
  assert.equal(rows[0].day_key, avant.jour);
  const enBase = JSON.parse(rows[0].data);
  enBase.niveaux[0].list[0][0].t = 7;
  enBase.marqueDeTest = 'deploiement';
  await c.query("UPDATE miniwave_maps SET data = $1 WHERE slot = 'current'", [JSON.stringify(enBase)]);
  await c.end();
  fs.unlinkSync(CARTE);

  await demarrer(DB);
  const apres = await defi();
  assert.equal(apres.jour, avant.jour, 'même journée');
  assert.equal(apres.niveaux[0].list[0][0].t, 7,
    'la map vient de la base, pas du générateur');
  assert.ok(fs.existsSync(CARTE), 'et le disque est réamorcé pour la suite');
  assert.equal(JSON.parse(fs.readFileSync(CARTE, 'utf8')).marqueDeTest, 'deploiement');

  // On rend le banc d'essai à son état sans base pour les tests suivants.
  await arreter();
  try { fs.unlinkSync(CARTE); } catch { /* déjà propre */ }
  await demarrer();
});

test('le client joue la map servie, et sait encore se débrouiller sans', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/miniwave/index.html'), 'utf8');
  assert.match(html, /\(d\.niveaux && d\.niveaux\.length\)[\s\S]{0,20}\?\s*d\.niveaux/,
    'les niveaux du serveur passent devant');
  assert.match(html, /window\.MiniwaveChallenge\.genererMap\(d\.graine\)\.niveaux/,
    'le générateur embarqué reste le repli');

  // Et la persistance côté serveur : disque ET base, comme la map MotionBall.
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(srv, /MINIWAVE_MAP_FILE/, 'le fichier de la map est nommé');
  assert.match(srv, /db\.getMiniwaveMap\(\)/, 'la base est relue au besoin');
  assert.match(srv, /db\.setMiniwaveMap\(/, 'et écrite à la génération');
  const dbjs = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(dbjs, /CREATE TABLE IF NOT EXISTS miniwave_maps/, 'la table existe');
});
