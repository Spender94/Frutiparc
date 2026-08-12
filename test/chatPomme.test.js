// Les droits de modération des ANIMATEURS sur le salon pomme — et seulement là.
//
// Quatre droits sur ce salon : la tête de liste (m="1"), le cri rouge gras
// (!message), /kick et /image. Deux interdits qui ne bougent pas : totocher et
// bannir restent aux modérateurs, partout. Et la fenêtre des logs — le
// « … voir les messages précédents … » du bureau, mort depuis toujours —
// répond désormais : les messages du salon des six dernières heures.
//
// Tout le par-salon du bureau est piloté par le serveur : le SWF copie le
// m="1" de sa propre ligne dans Chat.flMode (par salon), qui déverrouille son
// « ! » et son /kick. Donner m="1" aux animateurs sur pomme suffit donc — à
// condition que le serveur tienne chaque porte derrière (c'est ce qu'on
// vérifie ici, y compris les trames forgées).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3459;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-salon-pomme';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_pomme';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ANIM = 'animpomme';
const MODO = 'modopomme';
const CIBLE = 'ciblepomme';
const TEMOIN = 'temoinpomme';

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

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5194', FRUTISCORE_PORT: '5195',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'users'`);
        await c.end();
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
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

const donnerRole = (pseudo, champs) => fetch(`${BASE}/api/admin/users/${pseudo}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
  body: JSON.stringify(champs),
});

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
  const c = {
    pseudo, sid, ws, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    attendre: async (pred, quoi, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 700)}`);
    },
    fermer: () => { try { ws.close(); } catch {} },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}

test('salon pomme : les quatre droits de l\'animateur, et leurs refus ailleurs', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire(ANIM);
  const sidModo = await inscrire(MODO);
  const sidCible = await inscrire(CIBLE);
  const sidTemoin = await inscrire(TEMOIN);
  assert.equal((await donnerRole(ANIM, { is_animator: true })).status, 200, 'rôle animateur posé');
  assert.equal((await donnerRole(MODO, { is_moderator: true })).status, 200, 'rôle modérateur posé');

  const anim = await client(ANIM, sidAnim);
  const temoin = await client(TEMOIN, sidTemoin);
  try {
    // ── 1. LA TÊTE DE LISTE : m="1" sur pomme, rien sur poire. ──
    anim.envoyer('<o g="pomme" />');
    await anim.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'userlist de pomme');
    temoin.envoyer('<o g="pomme" />');
    const listePomme = await temoin.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'userlist de pomme (témoin)');
    const ligneAnim = new RegExp(`<u [^>]*u="${ANIM}"[^>]*/>`).exec(listePomme);
    assert.ok(ligneAnim, 'l\'animateur figure dans la liste');
    assert.match(ligneAnim[0], /\bm="1"/, 'et sa ligne porte m="1" — badge, tri en tête, flMode du SWF');

    anim.envoyer('<o g="poire" />');
    await anim.attendre((x) => x.startsWith('<p') && x.includes('g="poire"'), 'userlist de poire');
    temoin.envoyer('<o g="poire" />');
    const listePoire = await temoin.attendre((x) => x.startsWith('<p') && x.includes('g="poire"'), 'userlist de poire (témoin)');
    const ligneAnimPoire = new RegExp(`<u [^>]*u="${ANIM}"[^>]*/>`).exec(listePoire);
    assert.ok(ligneAnimPoire, 'présent sur poire aussi');
    assert.ok(!/\bm="1"/.test(ligneAnimPoire[0]), 'mais sans m="1" : simple utilisateur ailleurs');

    // ── 2. LE CRI : !message rouge gras sur pomme, texte ordinaire ailleurs. ──
    anim.envoyer('<t g="pomme" t="m" p="">!silence dans les rangs</t>');
    const cri = await temoin.attendre((x) => x.includes('silence dans les rangs'), 'le cri sur pomme');
    assert.match(cri, /st="r"/, 'marqué rouge pour le client Light');
    assert.match(cri, /C10000/, 'et rouge gras pour le bureau');

    anim.envoyer('<t g="poire" t="m" p="">!ici je ne suis personne</t>');
    const pasCri = await temoin.attendre((x) => x.includes('ici je ne suis personne'), 'le même texte sur poire');
    assert.ok(!/st="r"/.test(pasCri), 'sur poire, le « ! » reste un message ordinaire');

    // Une trame t="w" FORGÉE (le cri du SWF) sans être staff : avalée.
    temoin.trames.length = 0;
    anim.envoyer('<t g="poire" t="w" p="">cri forgé hors salon</t>');
    await wait(700);
    assert.ok(!temoin.trames.some((x) => x.includes('cri forgé hors salon')),
      'le t="w" forgé hors de son salon ne passe pas');
    // Et la même trame LÀ OÙ il est staff : le vrai cri du bureau.
    anim.envoyer('<t g="pomme" t="w" p="">le cri du bureau</t>');
    const criSwf = await temoin.attendre((x) => x.includes('le cri du bureau'), 'le t="w" sur pomme');
    assert.match(criSwf, /st="r"/, 'rendu comme le « ! » du client Light');

    // ── 3. /image : la fenêtre pour tout le salon, depuis pomme seulement. ──
    // a) le chemin du client LIGHT : la commande en texte.
    anim.envoyer('<t g="pomme" t="m" p="">/image 200 150 https://exemple.test/a.png La preuve</t>');
    const img = await temoin.attendre((x) => x.includes('t="i"') && x.includes('La preuve'), 'la trame image');
    assert.match(img, /\/api\/imgproxy\?url=/, 'l\'image passe par le relais du serveur');
    assert.match(img, new RegExp(`u="${ANIM}"`), 'et elle est signée de l\'animateur');
    assert.match(img, /g="pomme"/, 'diffusée SUR le salon — donc à tout le monde');

    // b) le chemin du BUREAU : la trame t="i" que sendImage compose. Le SWF la
    //    laisse partir de n'importe où (flAnimator est global) ; c'est le
    //    serveur qui la retient ailleurs que sur pomme.
    temoin.trames.length = 0;
    anim.envoyer('<t g="pomme" t="i" p=""><i w="240" h="180" u="https://exemple.test/b.png">Depuis le bureau</i></t>');
    const imgSwf = await temoin.attendre((x) => x.includes('Depuis le bureau'), 'la trame image du bureau');
    assert.match(imgSwf, /t="i"/, 'relayée telle quelle en t="i"');
    assert.match(imgSwf, /\/api\/imgproxy\?url=/, 'proxifiée elle aussi');

    // c) ailleurs, les deux chemins sont muets — et l'animateur sait pourquoi.
    temoin.trames.length = 0;
    anim.envoyer('<t g="poire" t="i" p=""><i w="240" h="180" u="https://exemple.test/c.png">Hors salon</i></t>');
    await anim.attendre((x) => x.includes('réservé au salon Pomme'), 'le refus expliqué (bureau)');
    anim.envoyer('<t g="poire" t="m" p="">/image 200 150 https://exemple.test/a.png Refusée</t>');
    await anim.attendre((x) => x.includes('réservé au salon Pomme'), 'le refus expliqué (light)');
    await wait(400);
    assert.ok(!temoin.trames.some((x) => x.includes('Hors salon') || x.includes('Refusée')),
      'et personne n\'a rien vu passer sur poire');

    // ── 4. /kick : l'éjection marche sur pomme… ──
    const cible = await client(CIBLE, sidCible);
    try {
      cible.envoyer('<o g="pomme" />');
      await cible.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'la cible entre sur pomme');
      anim.envoyer('<t g="pomme" t="m" p="">/kick ' + CIBLE + '</t>');
      await cible.attendre((x) => x.startsWith('<ag') && x.includes(`u="${CIBLE}"`), 'la cible est éjectée');

      // …et l'éjection par la fiche (trame <l>) est refusée hors de pomme.
      cible.envoyer('<o g="poire" />');
      await cible.attendre((x) => x.startsWith('<p') && x.includes('g="poire"'), 'la cible entre sur poire');
      anim.trames.length = 0;
      anim.envoyer(`<l u="${CIBLE}" g="poire" />`);
      await anim.attendre((x) => x.includes('k="403"'), 'kick par la fiche refusé sur poire');

      // ── 5. Totoché et ban restent aux modérateurs, même sur pomme. ──
      anim.trames.length = 0;
      anim.envoyer(`<m u="${CIBLE}" g="0" />`);
      await anim.attendre((x) => x.includes('k="403"'), 'le ban est refusé à l\'animateur');
      anim.envoyer('<t g="pomme" t="m" p="">/totoch ' + CIBLE + '</t>');
      await anim.attendre((x) => x.includes('Commande inconnue'), 'le totoché n\'existe pas pour lui');
    } finally { cible.fermer(); }

    // ── 6. Le modérateur, lui, garde tout, partout. ──
    const modo = await client(MODO, sidModo);
    try {
      modo.envoyer('<o g="poire" />');
      const listeModo = await temoin.attendre(
        (x) => x.startsWith('<v') && x.includes(`u="${MODO}"`) && x.includes('g="poire"'), 'le modérateur entre sur poire');
      assert.match(listeModo, /\bm="1"/, 'm="1" partout pour lui');
      modo.envoyer('<t g="poire" t="m" p="">!le vrai rouge partout</t>');
      const criModo = await temoin.attendre((x) => x.includes('le vrai rouge partout'), 'son cri sur poire');
      assert.match(criModo, /st="r"/, 'rouge gras hors de pomme aussi');
    } finally { modo.fermer(); }
  } finally {
    anim.fermer();
    temoin.fermer();
  }
});

test('la fenêtre des logs : six heures de salon, réservées au staff du salon', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidModo = (await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: MODO, password: 'secret123' }),
  })).json()).sid;
  const sidAnim = (await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ANIM, password: 'secret123' }),
  })).json()).sid;
  const sidTemoin = (await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEMOIN, password: 'secret123' }),
  })).json()).sid;

  // Un peu de vie sur pomme : une ligne ordinaire, puis un cri.
  const modo = await client(MODO, sidModo);
  try {
    modo.envoyer('<o g="pomme" />');
    await modo.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'entrée sur pomme');
    modo.envoyer('<t g="pomme" t="m" p="">la mémoire du salon</t>');
    modo.envoyer('<t g="pomme" t="m" p="">!et son cri rouge</t>');
    await wait(400);
  } finally { modo.fermer(); }

  // Les portes : session obligatoire, staff du salon obligatoire.
  assert.equal((await fetch(`${BASE}/api/chat/histo?g=pomme`)).status, 401, 'sans session : 401');
  assert.equal((await fetch(`${BASE}/api/chat/histo?sid=${sidTemoin}&g=pomme`)).status, 403,
    'un simple utilisateur : 403');
  assert.equal((await fetch(`${BASE}/api/chat/histo?sid=${sidModo}&g=inconnu`)).status, 404,
    'salon inconnu : 404');

  // Le modérateur lit tout salon ; la page porte les couleurs et les lignes.
  const page = await (await fetch(`${BASE}/api/chat/histo?sid=${sidModo}&g=pomme`)).text();
  assert.match(page, /6 dernières heures/, 'la fenêtre annonce sa période');
  assert.match(page, /la mémoire du salon/, 'la ligne ordinaire y est');
  assert.match(page, /class="ligne cri"/, 'le cri y est marqué rouge');
  assert.match(page, /#cfec9a/, 'et la fenêtre porte les couleurs de Frutiparc');

  // L'animateur : son salon oui, les autres non.
  assert.equal((await fetch(`${BASE}/api/chat/histo?sid=${sidAnim}&g=pomme`)).status, 200,
    'l\'animateur lit les logs de pomme');
  assert.equal((await fetch(`${BASE}/api/chat/histo?sid=${sidAnim}&g=poire`)).status, 403,
    'mais pas ceux de poire');
});

test('les deux clients embarquent le par-salon : tri, lien des logs, fiche', () => {
  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(light, /var SALON_ANIM = "pomme";/, 'le salon des animateurs, déclaré');
  assert.match(light, /staff: attr\(frag, "m"\) === "1"/, 'la liste retient le m="1" du serveur');
  assert.match(light, /sa - sb/, 'et trie le staff en tête');
  assert.match(light, /montrerLienHisto\(room, set\)/, 'le lien des logs à l\'entrée');
  assert.match(light, /\/api\/chat\/histo\?sid=/, 'vers la fenêtre des six heures');
  assert.match(light, /d\.vous\.animateur && state\.room === SALON_ANIM/,
    'la fiche montre l\'éjection à l\'animateur sur son salon');
  const ruffle = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');
  assert.match(ruffle, /fp_openHisto = function \(sid, group\)/,
    'fp_openHisto retrouve la signature que le SWF appelle depuis toujours');
  assert.match(ruffle, /\/api\/chat\/histo\?\$\{qs\}/, 'et ouvre la vraie fenêtre');
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(serveur, /const ANIM_CHANNEL = 'pomme';/, 'le serveur nomme le même salon');
  assert.match(serveur, /const CHAT_REPLAY_MAX_AGE_MS = 5 \* 60 \* 1000;/,
    'le REJEU du client Light reste sur cinq minutes');
  assert.match(serveur, /Date\.now\(\) - CHAT_REPLAY_MAX_AGE_MS/,
    'et c\'est bien lui que sert getChannelHistory');
});

test('les logs survivent au redémarrage du serveur', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  // Un modérateur écrit dans un salon…
  const sid1 = await inscrire('logsdur');
  assert.equal((await donnerRole('logsdur', { is_moderator: true })).status, 200);
  const proc1 = proc;
  // Le rôle est lu au boot : on redémarre une première fois pour qu'il prenne,
  // puis on écrit, puis on redémarre encore — le message doit tenir bon.
  proc1.kill('SIGKILL');
  await wait(400);
  const relancer = () => {
    proc = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
        ADMIN_KEY: CLE, XMLSOCKET_PORT: '5194', FRUTISCORE_PORT: '5195',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', () => {});
    return (async () => {
      for (let i = 0; i < 160; i++) {
        try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch {}
        await wait(250);
      }
      throw new Error('serveur indisponible après relance');
    })();
  };
  await relancer();

  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'logsdur', password: 'secret123' }),
  });
  const sid2 = (await login.json()).sid;
  const c = await client('logsdur', sid2);
  c.envoyer('<o g="pomme" />');
  await c.attendre((x) => x.startsWith('<o'), 'entrée dans pomme');
  c.envoyer('<t g="pomme" t="m" p="">Un message qui doit survivre au reboot.</t>');
  await c.attendre((x) => /survivre au reboot/.test(x), 'écho du message');
  c.fermer();
  // L'insertion en base est asynchrone : une respiration avant de tuer.
  await wait(600);

  const avant = await fetch(`${BASE}/api/chat/histo?sid=${sid2}&g=pomme`);
  assert.equal(avant.status, 200);
  assert.match(await avant.text(), /survivre au reboot/, 'les logs le montrent avant');

  // Le couperet, puis la relance : la fenêtre doit encore l'avoir.
  proc.kill('SIGKILL');
  await wait(400);
  await relancer();
  const login2 = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'logsdur', password: 'secret123' }),
  });
  const sid3 = (await login2.json()).sid;
  // La restauration est asynchrone au boot (l'écoute HTTP ouvre avant) : on
  // laisse à la fenêtre le temps de se remplir, comme un humain qui la rouvre.
  let texte = '';
  for (let i = 0; i < 40; i++) {
    const apres = await fetch(`${BASE}/api/chat/histo?sid=${sid3}&g=pomme`);
    if (apres.status === 200) {
      texte = await apres.text();
      if (/survivre au reboot/.test(texte)) break;
    }
    await wait(250);
  }
  assert.match(texte, /survivre au reboot/,
    'le message écrit avant le redémarrage est toujours dans la fenêtre');
});

// ── Le lancer de dé, à la table de tout le monde ──────────────────────────
//
// `/d6` tire entre 0 et 6, `/d20` entre 0 et 20 — bornes comprises. Il était
// réservé aux animateurs, sur le seul salon Pomme : c'était en faire un outil
// d'animation. Un dé est un JEU DE SALON — il appartient à qui veut jouer, où
// qu'il joue. Ne restent que les bornes du bon sens (1 à 1000 faces).

test('/dN : le dé roule pour tout le monde, dans n\'importe quel salon', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidA = await inscrire('animde');
  const sidT = await inscrire('temoinde');
  assert.equal((await donnerRole('animde', { is_animator: true })).status, 200);

  const anim = await client('animde', sidA);
  const temoin = await client('temoinde', sidT);
  try {
    anim.envoyer('<o g="pomme" />');
    await anim.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'pomme (anim)');
    temoin.envoyer('<o g="pomme" />');
    await temoin.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'pomme (témoin)');

    // ── 1. Le tirage est DIFFUSÉ, et il tombe dans [0, n]. ──
    const vus = new Set();
    for (let i = 0; i < 12; i++) {
      temoin.trames.length = 0;
      anim.envoyer('<t g="pomme" t="m" p="">/d6</t>');
      const ligne = await temoin.attendre((x) => /lance un dé/.test(x), 'le tirage diffusé');
      const m = /lance un dé \(0–6\) : <b><font color="#C10000">(\d+)<\/font><\/b>/.exec(ligne);
      assert.ok(m, 'la ligne dit le dé et son résultat : ' + ligne.slice(0, 200));
      const n = Number(m[1]);
      assert.ok(n >= 0 && n <= 6, 'le tirage ' + n + ' tient dans [0, 6]');
      vus.add(n);
      assert.match(ligne, /animde/, 'et il porte le nom du lanceur');
    }
    assert.ok(vus.size >= 3, 'douze lancers donnent plusieurs valeurs (' + [...vus].join(',') + ')');

    // ── 2. Les grands dés marchent aussi. ──
    temoin.trames.length = 0;
    anim.envoyer('<t g="pomme" t="m" p="">/d20</t>');
    const vingt = await temoin.attendre((x) => /lance un dé/.test(x), 'le d20');
    const m20 = /\(0–20\) : <b><font color="#C10000">(\d+)<\/font><\/b>/.exec(vingt);
    assert.ok(m20 && Number(m20[1]) >= 0 && Number(m20[1]) <= 20, 'entre 0 et 20');

    // ── 3. AILLEURS QU'À POMME : le dé roule pareil. ──
    anim.envoyer('<o g="poire" />');
    await anim.attendre((x) => x.startsWith('<p') && x.includes('g="poire"'), 'poire (anim)');
    temoin.envoyer('<o g="poire" />');
    await temoin.attendre((x) => x.startsWith('<p') && x.includes('g="poire"'), 'poire (témoin)');
    temoin.trames.length = 0;
    anim.trames.length = 0;
    anim.envoyer('<t g="poire" t="m" p="">/d6</t>');
    const ailleurs = await temoin.attendre((x) => /lance un dé/.test(x), 'le tirage à Poire');
    assert.match(ailleurs, /g="poire"/, 'et il est bien diffusé dans CE salon');
    assert.ok(!anim.trames.some((x) => /réservé aux animateurs/.test(x)),
      'plus aucun rappel de droits');

    // ── 4. UN SIMPLE FRUTIZ lance aussi son dé. ──
    temoin.trames.length = 0;
    anim.trames.length = 0;
    temoin.envoyer('<t g="poire" t="m" p="">/d10</t>');
    const duJoueur = await anim.attendre((x) => /lance un dé/.test(x), 'le tirage du frutiz');
    assert.match(duJoueur, /temoinde/, 'la ligne porte SON nom');
    assert.match(duJoueur, /\(0–10\)/, 'et son dé à dix faces');

    // ── 5. Les bornes du bon sens tiennent toujours. ──
    temoin.trames.length = 0;
    temoin.envoyer('<t g="poire" t="m" p="">/d0</t>');
    await temoin.attendre((x) => /Syntaxe : \/d6/.test(x), 'le rappel de syntaxe pour /d0');
    assert.ok(!temoin.trames.some((x) => /lance un dé/.test(x)), 'et aucun tirage');

    // ── 6. La commande n'est jamais rediffusée comme un message ordinaire. ──
    assert.ok(!temoin.trames.some((x) => />\/d\d/.test(x)), '« /d6 » ne s\'affiche pas tel quel');
  } finally {
    anim.fermer(); temoin.fermer();
  }
});
