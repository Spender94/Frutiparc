/*
 * Le chat — LES LIGNES REJOUÉES NE SE DOUBLENT PAS.
 *
 * Retour du forum : « quand on joue à un jeu et qu'on déporte la fenêtre et
 * qu'on laisse le salon ouvert, quand on revient les messages sont doublés ».
 *
 * Le client light demande au serveur de REJOUER les cinq dernières minutes
 * d'un salon à chaque (re)connexion (`lc="1"` → trames `rj="1"`). Il vide le
 * fil qu'il regarde avant — mais pas tous les fils : une fenêtre de salon
 * restée ouverte sur le bureau, la discussion privée qu'on n'a pas fermée,
 * relisaient deux fois les mêmes lignes dès que la socket avait été refaite
 * (le bureau qui reprend la main après une partie déportée, un proxy qui
 * ferme une socket muette…).
 *
 * Le serveur numérote donc chaque message (`mi`), et une ligne rejouée dont
 * le numéro est déjà dans le fil visé n'est pas réécrite. Ici : le numéro
 * voyage bien, il est le MÊME en direct et au rejeu, unique par message,
 * absent des trames qui ne sont pas des messages — et le client porte bien
 * le verrou.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const RACINE = path.join(__dirname, '..');
const PORT = 3451;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-7);
let proc;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-de-test', XMLSOCKET_PORT: '5168', FRUTISCORE_PORT: '5169',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(async () => {
  if (proc) proc.kill('SIGKILL');
  await wait(300);
  try {
    const fichier = path.join(RACINE, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.slice(-RUN.length) === RUN) delete d.users[u];
    fs.writeFileSync(fichier, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml); return m ? m[1] : null; };

// Un client LIGHT : <k … lc="1"> puis le salon pomme.
async function client(pseudo, sid) {
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
  ws.send(`<k l="${pseudo}" s="${sid}" lc="1" />\0`);
  await wait(300);
  ws.send('<o g="pomme" />\0');
  await wait(400);
  return {
    ws, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    messages: () => trames.filter((t) => /^<t[\s>]/.test(t) && attr(t, 'u') !== 'admin'),
    fermer: () => ws.close(),
  };
}

test('chaque message porte un numéro, le même en direct et au rejeu', async () => {
  const [sa, sb] = [await sidFor('parleur' + RUN), await sidFor('lecteur' + RUN)];
  const A = await client('parleur' + RUN, sa);
  const B = await client('lecteur' + RUN, sb);
  A.envoyer('<t g="pomme" t="m" p="">premier mot</t>');
  A.envoyer('<t g="pomme" t="m" p="">second mot</t>');
  await wait(500);
  const direct = B.messages();
  assert.ok(direct.length >= 2, 'B lit les deux messages en direct : ' + direct.length);
  const nums = direct.map((t) => attr(t, 'mi'));
  assert.ok(nums.every(Boolean), 'chaque message a son numéro : ' + JSON.stringify(nums));
  assert.equal(new Set(nums).size, nums.length, 'des numéros tous différents');
  assert.ok(direct.every((t) => attr(t, 'rj') === null), 'en direct, pas de marque de rejeu');
  // Les trames de présence, elles, n'en portent pas.
  const autres = B.trames.filter((t) => !/^<t[\s>]/.test(t));
  assert.ok(autres.length > 0);
  assert.ok(autres.every((t) => attr(t, 'mi') === null), 'seuls les messages sont numérotés');

  // B refait sa socket (la partie déportée rendue, le bureau reprend la main) :
  // le serveur rejoue les cinq dernières minutes — mêmes numéros, marque rj.
  B.fermer();
  await wait(300);
  const B2 = await client('lecteur' + RUN, sb);
  const rejoues = B2.messages().filter((t) => attr(t, 'rj') === '1');
  assert.ok(rejoues.length >= 2, 'le rejeu ramène les messages : ' + rejoues.length);
  const numsRejoues = rejoues.map((t) => attr(t, 'mi'));
  for (const n of nums) assert.ok(numsRejoues.indexOf(n) >= 0, 'le numéro ' + n + ' est rejoué tel quel');
  A.fermer(); B2.fermer();
  await wait(200);
});

test('le client light se tait devant une ligne rejouée dont le numéro est déjà dans le fil', () => {
  const src = fs.readFileSync(path.join(RACINE, 'public/light.html'), 'utf8');
  // Le verrou, en tête du traitement des messages, AVANT toute écriture…
  assert.match(src, /var mi = attr\(xml, "mi"\);\s*\n\s*if \(mi && attr\(xml, "rj"\) === "1" && dejaDansLeFil\(salon, mi\)\) break;/);
  // …le numéro posé sur chaque ligne écrite (les deux écritures)…
  assert.ok((src.match(/row\.setAttribute\("data-mi", String\(o\.mi\)\)/g) || []).length === 2,
    'addMessage et addEmoteMessage marquent la ligne');
  // …et la recherche dans le fil VISÉ (celui du salon, ou celui qu'on regarde).
  assert.match(src, /function dejaDansLeFil\(salon, mi\) \{\s*\n\s*var fil = journalDe\(salon \|\| state\.room\);/);
  // Chaque chemin d'écriture d'une trame <t> transmet le numéro.
  const cas = src.slice(src.indexOf('case "t": {'), src.indexOf('case "r": {'));
  const ecritures = cas.match(/add(?:Emote)?Message\(\{[^}]*\}\)/g) || [];
  assert.ok(ecritures.length >= 4, 'les écritures du cas <t> : ' + ecritures.length);
  for (const e of ecritures) assert.ok(/mi: mi/.test(e), 'transmet mi : ' + e.slice(0, 60));
});
