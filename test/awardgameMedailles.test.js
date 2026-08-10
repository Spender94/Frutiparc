/*
 * Les médaillés de la veille en tête des scores Challenge de main.swf.
 *
 * Le panneau des scores du bureau demande, jeu par jeu, le podium de la
 * veille : `<ha g="…" />` (awardgame). Le serveur résolvait d'abord le
 * classement « classic » du jeu et ne se repliait vers le « challenge » que
 * s'il EXISTAIT un classic hors-challenge — or Grapiz et Frutibandas n'ont
 * QUE leur <jeu>_challenge (la série de victoires, section C). Leur réponse
 * partait vide : pas de médailles en tête de leurs colonnes, alors que tous
 * les jeux dotés d'un classic les montraient.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
const PORT = 3489;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-medailles';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5220', FRUTISCORE_PORT: '5221',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  // data/scores.json et data/challenge-medals.json survivent d'une exécution à
  // l'autre : on retire nos joueurs pour ne pas polluer les suites suivantes.
  for (const fichier of ['data/scores.json', 'data/challenge-medals.json']) {
    try {
      const p = path.join(ROOT, fichier);
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (d.users) {
        for (const u of Object.keys(d.users)) if (u.startsWith('gmd')) delete d.users[u];
      }
      if (d.medalsByVisibleDay) {
        for (const [jour, parJoueur] of Object.entries(d.medalsByVisibleDay)) {
          for (const u of Object.keys(parJoueur)) if (u.startsWith('gmd')) delete parJoueur[u];
          if (Object.keys(parJoueur).length === 0) delete d.medalsByVisibleDay[jour];
        }
      }
      fs.writeFileSync(p, JSON.stringify(d));
    } catch { /* rien à nettoyer */ }
  }
});

const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const joueur = (base) => 'gmd' + base + RUN;

async function semer(username, ranking, score) {
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: hdr,
    body: JSON.stringify({ username, password: 'secret123' }),
  });
  const r = await fetch(`${BASE}/api/admin/scores/${username}/${ranking}`, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ score }),
  });
  assert.ok(r.ok, `graine ${ranking} posée pour ${username}`);
}

// Une socket CBee identifiée — le pont /score aboutit au même serveur TCP, on
// parle donc les codes FrutiScore sur la connexion principale.
async function socketScore(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr, body });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const sid = (await r.json()).sid;
  assert.ok(sid, 'connexion → sid');

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const trames = [];
  let tampon = '';
  ws.on('message', (d) => {
    tampon += d.toString('utf8');
    const bouts = tampon.split('\0');
    tampon = bouts.pop();
    for (const b of bouts) if (b.trim()) trames.push(b.trim());
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sid}" />\0`);
  const attendre = async (pred, quoi, ms = 5000) => {
    for (let i = 0; i < ms / 50; i++) {
      const t = trames.find(pred);
      if (t) return t;
      await wait(50);
    }
    throw new Error(`${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 400)}`);
  };
  await attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return { ws, attendre, envoyer: (xml) => ws.send(xml + '\0'), fermer: () => { try { ws.close(); } catch {} } };
}

const medailles = (trame) => {
  const out = [];
  for (const m of trame.matchAll(/<a v="(\d)" u="([^"]*)"/g)) out.push({ v: Number(m[1]), u: m[2] });
  return out;
};

test('grapiz et bandas rendent le podium de la veille, comme les jeux à classic', async () => {
  // Le podium d'hier se fabrique en semant les scores du jour puis en forçant
  // le roll : l'archive du jour devient « la veille » et distribue or/argent/
  // bronze (c'est la mécanique réelle, pilotée par la route admin).
  for (const [jeu, rk] of [
    ['bandas', 'bandas_challenge'],
    ['grapiz', 'grapiz_challenge'],
    ['swapou2', 'swapou2_classic'],          // le témoin : un jeu à classic
  ]) {
    await semer(joueur(jeu.slice(0, 2) + 'or'), rk, 30);
    await semer(joueur(jeu.slice(0, 2) + 'ag'), rk, 20);
    await semer(joueur(jeu.slice(0, 2) + 'bz'), rk, 10);
  }
  const roll = await fetch(BASE + '/api/admin/challenge/roll', { method: 'POST', headers: hdr });
  assert.ok(roll.ok, 'roll forcé');

  const c = await socketScore(joueur('spec'));
  try {
    for (const [jeu, prefixe] of [['bandas', 'ba'], ['grapiz', 'gr'], ['swapou2', 'sw']]) {
      c.envoyer(`<ha r="7" g="${jeu}" />`);
      const t = await c.attendre((x) => x.startsWith('<ha') && x.includes(`g="${jeu}"`),
        `podium ${jeu}`);
      const pod = medailles(t);
      assert.equal(pod.length, 3, `${jeu} : trois marches (${t.slice(0, 200)})`);
      assert.equal(pod[0].u, joueur(prefixe + 'or'), `${jeu} : l'or au meilleur`);
      assert.equal(pod[1].u, joueur(prefixe + 'ag'), `${jeu} : l'argent au deuxième`);
      assert.equal(pod[2].u, joueur(prefixe + 'bz'), `${jeu} : le bronze au troisième`);
    }
  } finally {
    c.fermer();
  }
});
