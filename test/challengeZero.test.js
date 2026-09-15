/*
 * UNE SÉRIE DE ZÉRO EST UNE SÉRIE.
 *
 * « Un score de 0 à Bandas et Grapiz doit être comptabilisé dans le classement
 * challenge (valeur 0, mais classé quand même). »
 *
 * Ces deux challenges comptent des victoires d'affilée, et l'on en fait
 * beaucoup de zéro — perdre son premier match est le cas le plus fréquent.
 * Deux verrous se cumulaient :
 *
 *   · les deux `onStreak` n'appelaient `persistScore` que `if (info.series >
 *     0)` : une série nulle ne partait même pas ;
 *   · et `persistScore` ne retient que ce qui BAT le record — or zéro ne bat
 *     pas le zéro d'une fiche vide, donc rien ne se serait écrit de toute
 *     façon.
 *
 * Être CLASSÉ et BATTRE SON RECORD sont deux choses. Le drapeau `classeAZero`,
 * porté par le classement lui-même, fait écrire la ligne au PREMIER score quelle
 * que soit sa valeur ; les suivants repassent par la règle du record. Le drapeau
 * plutôt qu'une règle générale : ailleurs, un zéro n'est pas une performance
 * mais l'absence de partie, et l'on ne veut pas remplir tous les tableaux de
 * joueurs qui n'ont rien joué.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3529;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-challenge-zero';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5292', FRUTISCORE_PORT: '5293',
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
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('zer')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const joueur = (b) => 'zer' + b + RUN;

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr, body });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const sid = (await r.json()).sid;
  assert.ok(sid, 'session de ' + pseudo);
  return sid;
}
const poserScore = (pseudo, rk, score) =>
  fetch(`${BASE}/api/admin/scores/${pseudo}/${rk}`, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ score }) });
const tableau = async (sid) =>
  (await fetch(`${BASE}/api/light/challenge?sid=${sid}`)).json();

test('un zéro s’affiche et se classe dans les deux tableaux', async () => {
  const gagnant = joueur('g'), nul = joueur('n');
  const sidG = await inscrire(gagnant), sidN = await inscrire(nul);
  for (const rk of ['bandas_challenge', 'grapiz_challenge']) {
    await poserScore(gagnant, rk, 4);
    await poserScore(nul, rk, 0);
  }
  const vu = await tableau(sidN);
  for (const rk of ['bandas_challenge', 'grapiz_challenge']) {
    const jeu = (vu.games || []).find((g) => g.id === rk);
    assert.ok(jeu, 'le tableau porte ' + rk);
    const ligne = jeu.scores.find((s) => s.user.toLowerCase() === nul);
    assert.ok(ligne, 'le joueur à zéro est dans ' + rk + ' : '
      + JSON.stringify(jeu.scores.map((s) => s.user + ':' + s.score)));
    assert.equal(ligne.score, 0, 'avec la valeur zéro');
    assert.ok(ligne.pos > 0, 'et un rang');
    // Derrière celui qui a une vraie série, évidemment.
    const mieux = jeu.scores.find((s) => s.user.toLowerCase() === gagnant);
    assert.ok(mieux && mieux.pos < ligne.pos, 'une série de quatre passe devant');
    // Et le « je suis Nème avec … » le reconnaît.
    assert.equal(jeu.me.score, 0);
    assert.equal(jeu.me.pos, ligne.pos);
  }
  assert.ok(sidG, 'les deux sessions ont servi');
});

test('la règle est portée par le classement, pas par tous', () => {
  const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  // Le drapeau sur les deux challenges concernés, et nulle part ailleurs.
  assert.match(SERVEUR, /bandas_challenge:.*classeAZero: true/);
  assert.match(SERVEUR, /grapiz_challenge:.*classeAZero: true/);
  const porteurs = (SERVEUR.match(/^\s+\w+:\s+\{ name:.*classeAZero: true/gm) || []).length;
  assert.equal(porteurs, 2, 'deux classements le portent, pas un de plus');

  // `persistScore` écrit la première ligne quand le classement le demande.
  assert.match(SERVEUR,
    /const premierClassement = !prev && !!RANKINGS\[rankingId\]\.classeAZero;/);
  assert.match(SERVEUR,
    /if \(scoreImproved \|\| shouldBackfillData \|\| premierClassement\) \{/);

  // Et les deux `onStreak` ne filtrent plus les séries nulles.
  assert.ok(!/if \(info && info\.series > 0\) persistScore/.test(SERVEUR),
    'plus de garde « série > 0 »');
  assert.match(SERVEUR,
    /if \(info\) persistScore\(username, 'grapiz_challenge', Math\.max\(0, Number\(info\.series\) \|\| 0\)\);/);
  assert.match(SERVEUR,
    /if \(info\) persistScore\(username, 'bandas_challenge', Math\.max\(0, Number\(info\.series\) \|\| 0\)\);/);
});
