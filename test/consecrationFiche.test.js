/*
 * La CONSÉCRATION des versions light — Miniwave et Minipixiz.
 *
 * Les deux portages enregistrent leur fiche par /api/saveFrutiSlot, et le
 * serveur en tire l'album (extractGameItemsFromSlot → user.gameItems →
 * user_game_items) puis la consécration (computeConsecration). Ce chemin-là
 * marchait. Ce qui était « mal raccordé », c'était la LECTURE : la fiche
 * (/api/light/fiche au mobile, userinfo au bureau) fabriquait pour un joueur
 * absent de la mémoire un utilisateur jetable — dbUserToMemory, gameItems
 * vides, jamais rangé dans users[] — puis demandait computeConsecration(u),
 * qui lit users[u]. Résultat : après chaque redémarrage du serveur, la fiche
 * de tout joueur pas encore revenu affichait « consécration 0 % », pictos
 * pourtant en base. Le remède est celui du classement du club : HYDRATER
 * (hydrateUserFromDb charge user_game_items et range users[u]).
 *
 * On rejoue toute l'histoire avec les VRAIES cartes des deux jeux — construites
 * par leur propre code client (plateforme.js), pas par des gabarits de test.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3461;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-consec';
const DB = process.env.TEST_DATABASE_URL_CONSEC || 'postgres://postgres@127.0.0.1:5433/frutiparc_consec';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Les cartes light, par le code des jeux eux-mêmes.
const P = require('../public/minipixiz/plateforme.js');
const W = require('../public/miniwave/plateforme.js');

const JOUEUSE = 'pixiluce';
const CURIEUSE = 'curieuse';

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

function lancerServeur() {
  return spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5202', FRUTISCORE_PORT: '5203',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function attendreServeur() {
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'users'`);
        await c.end();
        if (rows.length) return true;
      }
    } catch {}
    await wait(250);
  }
  return false;
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = lancerServeur();
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  if (!(await attendreServeur())) throw new Error('serveur ou schéma indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}

const enregistrerCarte = (sid, jeu, carte) => fetch(BASE + '/api/saveFrutiSlot', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sid, game: jeu, slotId: '0', data: JSON.stringify(carte) }),
});

const consecration = async (sid) => (await fetch(BASE + '/api/consecration?sid=' + sid)).json();
const fiche = async (sid, u) =>
  (await fetch(`${BASE}/api/light/fiche?sid=${sid}&u=${u}`)).json();

let sidJoueuse = '';
let overallAvantReboot = 0;

test('la carte light Minipixiz nourrit l\'album, la consécration et l\'historique', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  sidJoueuse = await inscrire(JOUEUSE);

  // Deux ramassages en forêt, écrits par le code du jeu : le Cœur +1 (10) et
  // le Casque à corne (45). L'album se remplit à l'instant du ramassage
  // (Base.grab), la sauvegarde de fin de course porte la fiche entière.
  const carte = P.carteNeuve();
  assert.equal(P.ramasser(carte, 10) !== 'perdu' || carte.$stat.$item[10], true);
  P.ramasser(carte, 45);
  assert.equal(carte.$stat.$item[10], true);
  assert.equal(carte.$stat.$item[45], true);
  const r = await enregistrerCarte(sidJoueuse, 'minipixiz', carte);
  assert.ok(r.ok, 'sauvegarde acceptée');

  // L'extraction est synchrone dans la requête : la consécration suit aussitôt.
  const c = await consecration(sidJoueuse);
  const pixiz = c.games.find((g) => g.id === 'pixiz');
  assert.equal(pixiz.unlocked, 2, 'deux pictos Minipixiz');
  assert.equal(pixiz.total, 162, 'sur l\'album canonique de 162');

  // La fiche light — celle qu'ouvre « voir la fiche » — porte le pourcentage.
  const f = await fiche(sidJoueuse, JOUEUSE);
  assert.ok(f.ok, 'fiche servie');
  assert.ok(f.frutiz.consecration > 0, 'consécration > 0 sur la fiche');

  // Et l'historique du joueur raconte le déblocage, avec le nom du picto.
  const h = await (await fetch(`${BASE}/api/light/history?sid=${sidJoueuse}`)).json();
  const contenus = (h.events || []).map((e) => e.text || '').join('\n');
  assert.match(contenus, /Nouveau picto débloqué sur MiniPixiz : Cœur \+1 !/);
  assert.match(contenus, /Casque à corne/);
});

test('la partie light Miniwave nourrit l\'album et la consécration', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  // Une partie d'arcade réelle, soldée par le code du jeu : 205 éliminations
  // du monstre 3 (le picto tombe à 200) et un niveau atteint (picto arcade).
  // Le vaisseau de départ ($ship[0]) fait le troisième.
  const partie = { mode: 'arcade', score: 3000, level: 0, cons: 5, badsKill: { 3: 205 } };
  const carte = W.fusionner(W.carteNeuve(), partie);
  assert.equal(carte.$badsKill[3], 205);
  assert.equal(carte.$arcade.$bestLevel, 1);
  const r = await enregistrerCarte(sidJoueuse, 'miniwave', carte);
  assert.ok(r.ok, 'sauvegarde acceptée');

  const c = await consecration(sidJoueuse);
  const mw = c.games.find((g) => g.id === 'miniwave');
  assert.equal(mw.unlocked, 3, 'vaisseau de départ + monstre 3 + arcade');
  assert.equal(mw.total, 69, 'l\'album Miniwave compte 69 pictos');

  const h = await (await fetch(`${BASE}/api/light/history?sid=${sidJoueuse}`)).json();
  const contenus = (h.events || []).map((e) => e.text || '').join('\n');
  assert.match(contenus, /Nouveau picto débloqué sur MiniWave : Monstre 3 !/);

  overallAvantReboot = c.overall;
  assert.ok(overallAvantReboot > 0);
});

test('après un reboot, la fiche dit encore la vraie consécration', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  // Le serveur redémarre (la mémoire se vide) ; la joueuse ne revient PAS.
  proc.kill('SIGKILL');
  await wait(400);
  proc = lancerServeur();
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  assert.ok(await attendreServeur(), 'serveur relancé');

  // Une autre joueuse, inscrite après le reboot, ouvre sa fiche. Avant le
  // correctif : « consécration 0.00 % » — la fiche fabriquait un utilisateur
  // jetable (gameItems vides) au lieu d'hydrater users[u] depuis la base.
  const sidCurieuse = await inscrire(CURIEUSE);
  const f = await fiche(sidCurieuse, JOUEUSE);
  assert.ok(f.ok, 'fiche servie après reboot');
  assert.ok(f.frutiz.consecration > 0, 'la consécration a survécu au reboot');
  assert.equal(f.frutiz.consecration, overallAvantReboot,
    'au même pourcentage qu\'avant le reboot');
});

test('les deux fiches (mobile et bureau) hydrent avant de compter', () => {
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  // /api/light/fiche : l'hydratation précède computeConsecration.
  const ficheLight = serveur.indexOf("app.get('/api/light/fiche'");
  assert.ok(ficheLight >= 0);
  const blocLight = serveur.slice(ficheLight, ficheLight + 1200);
  assert.match(blocLight, /hydrateUserFromDb\(u, row\)/, 'la fiche light hydrate');
  assert.match(blocLight, /computeConsecration\(u\)/);

  // userinfo (fiche du bureau) : même remède au même endroit.
  const ficheBureau = serveur.indexOf('lastProfileUser = u;');
  assert.ok(ficheBureau >= 0);
  const blocBureau = serveur.slice(ficheBureau, ficheBureau + 1200);
  assert.match(blocBureau, /hydrateUserFromDb\(u, row\)/, 'la fiche bureau hydrate');
  assert.match(blocBureau, /computeConsecration\(u\)/);
});
