// Discussions privées sur /light (mobile).
//
// Elles fonctionnaient déjà sur le bureau (main.swf) : le protocole les traite
// comme des salons nommés « pm2_<a>__<b> », que le serveur crée à la demande et
// auxquels il abonne les deux participants. Le client mobile, lui, ne connaissait
// qu'un seul salon à la fois et ignorait l'attribut `g` des messages — il ne
// pouvait donc ni ouvrir une discussion privée, ni distinguer ses messages de
// ceux du salon public.
//
// Ces tests attaquent le VRAI serveur par la vraie WebSocket, avec deux (puis
// trois) clients simultanés, et vérifient la propriété qui compte : ce qui est
// dit en privé n'arrive qu'aux deux intéressés.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3437;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-6);

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5150', FRUTISCORE_PORT: '5151',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (serverProc) serverProc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}

// Un client mobile : même poignée de main que public/light.html (lc="1").
async function client(pseudo) {
  const sid = await inscrire(pseudo);
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
  const c = {
    pseudo, sid, ws, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    // Attend une trame satisfaisant un prédicat (le réseau n'est pas synchrone).
    attendre: async (pred, quoi, ms = 4000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 600)}`);
    },
    messages: () => trames.filter((t) => t.startsWith('<t ')),
    fermer: () => { try { ws.close(); } catch {} },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}
const attr = (xml, n) => {
  const m = new RegExp(`\\b${n}="([^"]*)"`).exec(xml);
  return m ? m[1] : '';
};
const corps = (xml) => {
  const m = /^<[^>]*>([\s\S]*)<\/[^>]*>$/.exec(xml);
  return m ? m[1] : '';
};

test('une discussion privée s\'ouvre et se tient à deux', async () => {
  const a = await client('mpalice' + RUN);
  const b = await client('mpbob' + RUN);
  try {
    // Alice demande une discussion privée avec Bob — exactement ce que le client
    // mobile envoie quand on appuie sur un pseudo dans la liste des connectés.
    a.envoyer(`<r u="${b.pseudo}" r="mp1" />`);

    // Le serveur répond par l'identifiant du salon privé…
    const rep = await a.attendre((t) => t.startsWith('<r ') && attr(t, 'g'), 'ouverture du salon privé');
    const salon = attr(rep, 'g');
    assert.ok(/^pm2?_/.test(salon), `identifiant de salon privé (${salon})`);
    assert.equal(attr(rep, 'u').toLowerCase(), b.pseudo, 'la réponse nomme l\'interlocuteur');

    // …et prévient Bob par une invitation portant le même salon.
    const inv = await b.attendre((t) => t.startsWith('<s '), 'invitation reçue par Bob');
    assert.equal(attr(inv, 'g'), salon, 'même salon des deux côtés');
    assert.equal(attr(inv, 'u').toLowerCase(), a.pseudo, 'l\'invitation nomme l\'expéditeur');

    // Les deux rejoignent, puis échangent.
    a.envoyer(`<o g="${salon}" />`);
    b.envoyer(`<o g="${salon}" />`);
    await wait(300);
    a.envoyer(`<t g="${salon}" t="m" p="">coucou Bob</t>`);
    const recu = await b.attendre(
      (t) => t.startsWith('<t ') && attr(t, 'g') === salon && corps(t).indexOf('coucou Bob') >= 0,
      'message privé reçu par Bob');
    assert.equal(attr(recu, 'u').toLowerCase(), a.pseudo, 'le message est attribué à Alice');

    // Et dans l'autre sens.
    b.envoyer(`<t g="${salon}" t="m" p="">salut Alice</t>`);
    await a.attendre(
      (t) => t.startsWith('<t ') && attr(t, 'g') === salon && corps(t).indexOf('salut Alice') >= 0,
      'réponse reçue par Alice');
  } finally { a.fermer(); b.fermer(); }
});

test('un tiers dans le salon public ne voit RIEN de la discussion privée', async () => {
  const a = await client('mpanne' + RUN);
  const b = await client('mpbenj' + RUN);
  const c = await client('mpcurieux' + RUN);
  try {
    // Tout le monde est dans le même salon public.
    for (const x of [a, b, c]) x.envoyer('<o g="pomme" />');
    await wait(400);

    a.envoyer(`<r u="${b.pseudo}" r="mp2" />`);
    const salon = attr(await a.attendre((t) => t.startsWith('<r ') && attr(t, 'g'), 'salon privé'), 'g');
    a.envoyer(`<o g="${salon}" />`);
    b.envoyer(`<o g="${salon}" />`);
    await wait(300);

    const avant = c.messages().length;
    a.envoyer(`<t g="${salon}" t="m" p="">un secret</t>`);
    await b.attendre((t) => corps(t).indexOf('un secret') >= 0, 'Bob reçoit le secret');
    await wait(600);
    assert.ok(!c.trames.some((t) => t.indexOf('un secret') >= 0),
      'le curieux ne doit rien recevoir de la discussion privée');

    // …et le salon public continue de fonctionner pour tout le monde.
    a.envoyer('<t g="pomme" t="m" p="">bonjour à tous</t>');
    await c.attendre((t) => t.startsWith('<t ') && attr(t, 'g') === 'pomme' &&
      corps(t).indexOf('bonjour à tous') >= 0, 'le salon public marche toujours');
    assert.ok(c.messages().length > avant, 'le curieux reçoit bien le salon public');
  } finally { a.fermer(); b.fermer(); c.fermer(); }
});

test('écrire à quelqu\'un de déconnecté est refusé proprement', async () => {
  const a = await client('mpseul' + RUN);
  try {
    a.envoyer('<r u="fantomeabsent" r="mp3" />');
    const rep = await a.attendre((t) => t.startsWith('<r ') && attr(t, 'k'), 'refus');
    assert.equal(attr(rep, 'k'), '201',
      'code 201 = destinataire non connecté, celui que le bureau traduit déjà');
  } finally { a.fermer(); }
});

test('le client mobile sait ouvrir, router et signaler les discussions privées', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  // Ouverture : un appui sur un pseudo de la liste des connectés.
  assert.ok(/function ouvrirPrive\(pseudo\)/.test(html), 'fonction d\'ouverture présente');
  assert.ok(/wsSend\('<r u="' \+ xmlEscape\(p\)/.test(html),
    'elle envoie bien la demande d\'ouverture au serveur');
  assert.ok(/u\.classList\.add\("mp"\)/.test(html) && /ouvrirPrive\(n\)/.test(html),
    'les pseudos de la liste sont cliquables');

  // Réception : les deux trames du protocole sont traitées.
  assert.ok(/case "r": \{/.test(html), 'réponse d\'ouverture traitée');
  assert.ok(/case "s": \{/.test(html), 'invitation entrante traitée');
  assert.ok(/n'est pas connect/.test(html), 'le refus 201 est expliqué au joueur');

  // Routage : sans tri par salon, un message privé s'écrirait dans le salon public.
  assert.ok(/var salon = attr\(xml, "g"\);[\s\S]{0,400}salon !== state\.room/.test(html),
    'les messages sont triés par salon');

  // On ne quitte JAMAIS une discussion privée : sinon on cesse d'en recevoir.
  assert.ok(/!estPrive\(state\.room\)/.test(html),
    'seuls les salons publics sont quittés en changeant de vue');

  // Signalement : compteur de non-lus + pastille.
  assert.ok(/nonLus \+= 1/.test(html), 'les messages non lus sont comptés');
  assert.ok(/function majPastilleMp/.test(html), 'une pastille signale les non-lus');
  assert.ok(/Messages priv/.test(html), 'les discussions ont leur groupe dans le sélecteur');

  // Reconnexion : le mobile perd sa socket dès qu'il passe en arrière-plan.
  assert.ok(/function rejoindreLesPrives/.test(html), 'les discussions sont rejointes après reconnexion');
  assert.ok(/sourdineJusqua/.test(html),
    'le rejeu d\'historique ne doit pas gonfler le compteur de non-lus');
});
