// « Qui est connecté sur le site » (/light).
//
// Le protocole de chat ne sait répondre qu'à « qui est dans CE salon » : la
// liste <p> arrive au join et les allées et venues la tiennent à jour, mais rien
// ne dit qui se trouve ailleurs. Un joueur du mobile ne pouvait donc pas savoir
// qu'un ami l'attend deux salons plus loin.
//
// /api/light/online comble ce trou en lisant la table des sockets identifiées.
// Ce qu'on vérifie ici, c'est qu'elle dit la vérité — et rien de plus :
//
//   • tout le monde y est, quel que soit le salon (et même sans salon) ;
//   • un joueur ouvert sur deux appareils n'apparaît qu'une fois ;
//   • les discussions privées ne sont JAMAIS nommées : le lieu affiché
//     trahirait avec qui l'on parle ;
//   • partir, c'est disparaître de la liste.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3443;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-6);

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5162', FRUTISCORE_PORT: '5163',
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

const attr = (xml, n) => {
  const m = new RegExp(`\\b${n}="([^"]*)"`).exec(xml);
  return m ? m[1] : '';
};

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}

// Une socket identifiée. `sid` peut être fourni pour ouvrir un SECOND appareil
// sur le même compte (bureau + téléphone) sans réinscrire le joueur.
async function client(pseudo, sidConnu) {
  const sid = sidConnu || await inscrire(pseudo);
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
    attendre: async (pred, quoi, ms = 4000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 600)}`);
    },
    fermer: () => { try { ws.close(); } catch {} },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}

const presence = async (sid) => (await fetch(`${BASE}/api/light/online?sid=${sid}`)).json();
const trouver = (liste, pseudo) =>
  (liste || []).find((j) => String(j.pseudo).toLowerCase() === String(pseudo).toLowerCase());

test('la présence du site est réservée aux joueurs identifiés', async () => {
  const anon = await fetch(`${BASE}/api/light/online`);
  assert.equal(anon.status, 401, 'sans session : refusé');
  const faux = await fetch(`${BASE}/api/light/online?sid=nimportequoi`);
  assert.equal(faux.status, 401, 'avec une session inventée : refusé');
});

test('elle liste les joueurs de TOUS les salons, avec leur salon', async () => {
  const a = await client('prsa' + RUN);
  const b = await client('prsb' + RUN);
  const c = await client('prsc' + RUN);
  try {
    a.envoyer('<o g="pomme" />');
    b.envoyer('<o g="citron" />');
    // c reste identifié sans rejoindre le moindre salon (il lit le forum, il joue…).
    await wait(600);

    const d = await presence(a.sid);
    assert.equal(d.ok, true);

    const ja = trouver(d.users, a.pseudo);
    const jb = trouver(d.users, b.pseudo);
    const jc = trouver(d.users, c.pseudo);
    assert.ok(ja && jb && jc, 'les trois sont listés');
    assert.deepEqual(ja.salons, ['pomme'], 'A est situé dans son salon');
    assert.deepEqual(jb.salons, ['citron'], 'B dans le sien — même si l\'appelant n\'y est pas');
    assert.deepEqual(jc.salons, [], 'C est en ligne sans salon : la liste le dit sans inventer de lieu');

    assert.equal(d.count, d.users.length, 'le compte annoncé est celui de la liste');
    const pseudos = d.users.map((j) => j.pseudo);
    assert.deepEqual(pseudos.slice().sort((x, y) => x.localeCompare(y, 'fr', { sensitivity: 'base' })), pseudos,
      'la liste arrive triée : le client n\'a pas à la retrier');
  } finally { a.fermer(); b.fermer(); c.fermer(); }
});

test('une discussion privée n\'est jamais nommée', async () => {
  const a = await client('prva' + RUN);
  const b = await client('prvb' + RUN);
  const espion = await client('prvx' + RUN);
  try {
    a.envoyer('<o g="pomme" />');
    b.envoyer('<o g="pomme" />');
    await wait(400);
    a.envoyer(`<r u="${b.pseudo}" r="mp1" />`);
    const rep = await a.attendre((t) => t.startsWith('<r ') && attr(t, 'g'), 'ouverture du salon privé');
    const prive = attr(rep, 'g');
    a.envoyer(`<o g="${prive}" />`);
    b.envoyer(`<o g="${prive}" />`);
    await wait(600);

    const d = await presence(espion.sid);
    const ja = trouver(d.users, a.pseudo);
    assert.ok(ja, 'A est bien listé');
    assert.deepEqual(ja.salons, ['pomme'],
      `seul son salon public est visible (reçu : ${JSON.stringify(ja.salons)})`);
    const tout = JSON.stringify(d.users);
    assert.ok(!tout.includes(prive) && !/pm2?_/.test(tout),
      'aucun identifiant de discussion privée ne fuit dans la réponse');
  } finally { a.fermer(); b.fermer(); espion.fermer(); }
});

test('deux appareils pour un même joueur ne font qu\'une entrée', async () => {
  const bureau = await client('prdd' + RUN);
  const mobile = await client(bureau.pseudo, bureau.sid);
  try {
    bureau.envoyer('<o g="pomme" />');
    mobile.envoyer('<o g="poire" />');
    await wait(600);

    const d = await presence(bureau.sid);
    const entrees = (d.users || []).filter((j) => j.pseudo.toLowerCase() === bureau.pseudo);
    assert.equal(entrees.length, 1, 'une seule ligne, pas un doublon par socket');
    assert.deepEqual(entrees[0].salons.slice().sort(), ['poire', 'pomme'],
      'et ses deux salons sont fusionnés');
  } finally { bureau.fermer(); mobile.fermer(); }
});

test('quitter le site, c\'est disparaître de la liste', async () => {
  const temoin = await client('prqa' + RUN);
  const partant = await client('prqb' + RUN);
  try {
    partant.envoyer('<o g="pomme" />');
    await wait(500);
    assert.ok(trouver((await presence(temoin.sid)).users, partant.pseudo), 'présent tant qu\'il est connecté');

    partant.fermer();
    await wait(900);
    assert.ok(!trouver((await presence(temoin.sid)).users, partant.pseudo),
      'absent dès que sa socket tombe — sinon la liste montrerait des fantômes');
  } finally { temoin.fermer(); partant.fermer(); }
});

test('les PNJ ne comptent pas comme des joueurs connectés', async () => {
  const a = await client('prna' + RUN);
  try {
    a.envoyer('<o g="pomme" />');
    await wait(600);
    // Gaspard tient le salon d'accueil : il apparaît bien dans la liste du salon
    // (trame <p>), mais la question « qui est connecté » porte sur les joueurs.
    const d = await presence(a.sid);
    assert.ok(!trouver(d.users, 'Gaspard'), 'Gaspard n\'est pas compté');

    // Même population que le compteur public de la page d'accueil : les deux
    // chiffres sont affichés au même joueur, ils ne doivent pas se contredire.
    const badge = await (await fetch(`${BASE}/api/online-count`)).json();
    assert.equal(d.count, badge.count, 'même compte que /api/online-count');
  } finally { a.fermer(); }
});
