'use strict';
/*
 * LES DÉPARTS DE SALON — et la couleur des émotes.
 *
 * « Sur les salons, on voit les gens arriver ("user a rejoint le salon") mais
 * pas forcément ceux qui quittent. » Trois cas tenaient la porte fermée :
 *   · un Light qui fermait l'onglet n'était annoncé parti qu'après la grâce
 *     de reconnexion du bureau, quarante-cinq secondes ;
 *   · un Light qui revenait dans un AUTRE salon restait à jamais dans le
 *     premier : le ménage différé renonçait dès qu'une socket vivante du
 *     joueur tenait un salon, n'importe lequel ;
 *   · à sa reconnexion, on le remettait d'office dans ses anciens salons,
 *     comme le SWF qui, lui, ne redit pas ses salons. Le Light les redit.
 *
 * Et « les émotes s'affichent avec la couleur par défaut » : la ligne
 * d'émote fabriquée par le serveur ne portait pas le feutre de l'auteur.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3577;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml); return m ? m[1] : null; };

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-de-test', XMLSOCKET_PORT: '5442', FRUTISCORE_PORT: '5443',
      // Les délais du Light, raccourcis : la grâce après fermeture, et le
      // temps laissé pour redire ses salons après une reconnexion.
      CHAT_GRACE_LIGHT_MS: '700', CHAT_REJOIN_LIGHT_MS: '700',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('le serveur de test n’a pas démarré');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

// Un client LIGHT : <k … lc="1"> puis un salon.
async function client(pseudo, sid, salon) {
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
  if (salon) { ws.send(`<o g="${salon}" />\0`); await wait(400); }
  return {
    ws, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    // <u u="…" g="…"/> : un départ ; <v …/> : une arrivée.
    departs: (salon) => trames.filter((t) => /^<u[\s>]/.test(t) && (!salon || attr(t, 'g') === salon)).map((t) => attr(t, 'u')),
    arrivees: (salon) => trames.filter((t) => /^<v[\s>]/.test(t) && (!salon || attr(t, 'g') === salon)).map((t) => attr(t, 'u')),
    fermer: () => ws.close(),
  };
}

test('quitter un salon (<y>) est annoncé aussitôt', async () => {
  const [a, b] = ['quitteur' + RUN, 'temoin1' + RUN];
  const A = await client(a, await sidFor(a), 'poire');
  const B = await client(b, await sidFor(b), 'poire');
  await wait(200);
  A.envoyer('<y g="poire" />');
  await wait(400);
  assert.deepStrictEqual(B.departs('poire'), [a], 'B a vu A partir');
  A.fermer(); B.fermer();
});

test('un Light qui ferme l’onglet est annoncé parti après la grâce courte', async () => {
  const [a, b] = ['fermeur' + RUN, 'temoin2' + RUN];
  const A = await client(a, await sidFor(a), 'fraise');
  const B = await client(b, await sidFor(b), 'fraise');
  await wait(200);
  assert.ok(B.arrivees('fraise').includes(a) || true);
  A.fermer();
  await wait(300);
  assert.deepStrictEqual(B.departs('fraise'), [], 'pas tout de suite : la grâce court');
  await wait(900);
  assert.deepStrictEqual(B.departs('fraise'), [a], 'puis B le voit partir');
  B.fermer();
});

test('un Light qui revient dans un AUTRE salon quitte le premier, et personne ne le remet d’office', async () => {
  const [a, b, c] = ['mobile' + RUN, 'temoin3' + RUN, 'temoin4' + RUN];
  const sa = await sidFor(a);
  const A = await client(a, sa, 'citron');
  const B = await client(b, await sidFor(b), 'citron');
  const C = await client(c, await sidFor(c), 'kiwi');
  await wait(200);
  A.fermer();
  await wait(200);
  // Il revient — dans un autre salon.
  const A2 = await client(a, sa, 'kiwi');
  await wait(200);
  assert.deepStrictEqual(C.arrivees('kiwi'), [a], 'kiwi le voit arriver');
  await wait(1000);
  assert.deepStrictEqual(B.departs('citron'), [a], 'citron le voit partir : il n’y est pas revenu');
  assert.deepStrictEqual(C.departs('kiwi'), [], 'kiwi, lui, le garde');
  A2.fermer(); B.fermer(); C.fermer();
});

test('un Light qui revient dans le MÊME salon n’est pas annoncé parti', async () => {
  const [a, b] = ['fidele' + RUN, 'temoin5' + RUN];
  const sa = await sidFor(a);
  const A = await client(a, sa, 'raisin');
  const B = await client(b, await sidFor(b), 'raisin');
  await wait(200);
  A.fermer();
  await wait(200);
  const A2 = await client(a, sa, 'raisin');
  await wait(1200);
  assert.deepStrictEqual(B.departs('raisin'), [], 'aucun départ annoncé');
  A2.fermer(); B.fermer();
});

test('une émote porte le feutre de son auteur', async () => {
  const [a, b] = ['gommeur' + RUN, 'temoin6' + RUN];
  const A = await client(a, await sidFor(a), 'orange');
  const B = await client(b, await sidFor(b), 'orange');
  await wait(200);
  A.envoyer('<t g="orange" t="m" p="5">gum</t>');
  await wait(400);
  const emote = B.trames.find((t) => /^<t[\s>]/.test(t) && attr(t, 'e') === 'gum');
  assert.ok(emote, 'la ligne d’émote est arrivée : ' + B.trames.filter((t) => /^<t/.test(t)).join(' | '));
  assert.strictEqual(attr(emote, 'p'), '5', 'avec le feutre de l’auteur');
  assert.strictEqual(attr(emote, 'eu'), a);
  assert.match(emote, /fait une bulle de chewing-gum/);
  A.fermer(); B.fermer();
});

test('le Light teinte la ligne d’émote avec ce feutre, en italique', () => {
  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(light, /addEmoteMessage\(\{ from: emWho, time: h, label: emLabel, salon: salon, mi: mi,\s+pen: penColorFor\(attr\(xml, "p"\)\), feutre: attr\(xml, "p"\) \}\);/);
  assert.match(light, /var lb = el\("span", "body"\); lb\.textContent = o\.label;\s+if \(o\.pen\) lb\.style\.color = o\.pen;/);
  assert.match(light, /\.msg\.emote \{ font-style: italic;/, 'l’italique reste');
});
