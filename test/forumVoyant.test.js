/*
 * Le VOYANT du forum, sur la barre de raccourcis de /light.
 *
 * Trois rubriques allumaient leur raccourci quand quelque chose attendait — la
 * messagerie, les événements, l'historique. Le forum, non : son entrée dans
 * HOME_SHORTCUTS n'avait pas d'icône d'alerte, aucun compte ne lui parvenait,
 * et le serveur n'en disait rien. Les trois manquaient à la fois.
 *
 * La règle retenue : TOUT sujet ayant du nouveau depuis la dernière visite,
 * partout sur le forum — la même que les dossiers du forum lui-même. Ses
 * propres messages ne comptent pas : poster ne doit pas s'allumer au visage.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3426;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-forum-voyant';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_forumvoyant';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5196', FRUTISCORE_PORT: '5197',
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
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'forum_topics'`);
        await c.end();
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const json = (r) => r.json();
// Les salons par défaut s'ensemencent au boot, parfois APRÈS que le serveur
// répond : sous la contention de la suite complète, une lecture immédiate de
// l'index peut les manquer. On attend qu'ils soient là.
async function salons(sid) {
  for (let i = 0; i < 40; i++) {
    const index = await json(await fetch(`${BASE}/api/forum/index?sid=${sid}`));
    const liste = (index.categories || []).flatMap((c) => c.boards || []);
    if (liste.length) return liste;
    await wait(250);
  }
  throw new Error('les salons du forum ne sont jamais apparus');
}
async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await json(await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
  assert.ok(j.sid, 'session de ' + pseudo);
  return j.sid;
}
const compte = async (sid) => (await json(await fetch(`${BASE}/api/light/profile?sid=${sid}`))).forumUnread;

test('le voyant du forum compte les sujets qui ont du nouveau', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidA = await inscrire('forumauteur');
  const sidB = await inscrire('forumlecteur');
  // Un troisième pour la relance : le forum refuse deux messages d'affilée du
  // même auteur sur un sujet, donc A ne peut pas se répondre à lui-même.
  const sidC = await inscrire('forumrelance');

  // Un salon où poster : on attend la liste ensemencée au boot.
  const liste = await salons(sidA);
  // Pas le premier : « Annonces » est réservé aux modérateurs. On prend un
  // salon où un frutiz ordinaire a le droit d'écrire.
  const board = liste.find((b) => /frutiz/i.test(b.name) && !/jeux/i.test(b.name)) || liste[liste.length - 1];
  const boardId = board.id;

  // ── 1. Rien n'a bougé : le voyant est éteint pour les deux. ──
  // (Le forum livré au boot peut porter des sujets d'exemple : on part de ce
  // qu'ils voient MAINTENANT, et on regarde la variation.)
  const departB = await compte(sidB);
  assert.equal(typeof departB, 'number', 'le profil rend bien un compte');

  // ── 2. A poste : B a du nouveau, A n'a rien. ──
  const r = await fetch(`${BASE}/api/forum/topic`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidA, boardId, title: 'Le voyant du forum', content: 'Un sujet tout neuf.' }),
  });
  assert.equal(r.status, 200, 'le sujet est créé');
  const cree = await json(r);
  const topicId = cree.topicId || cree.id || (cree.topic && cree.topic.id);
  assert.ok(topicId, 'on connaît le numéro du sujet');

  assert.equal(await compte(sidB), departB + 1, 'B voit un sujet de plus à lire');
  const apresA = await compte(sidA);
  assert.ok(apresA <= departB, 'et A ne se compte pas lui-même (' + apresA + ')');

  // ── 3. B ouvre le sujet : son voyant retombe. ──
  const ouvert = await fetch(`${BASE}/api/forum/topic/${topicId}?sid=${sidB}`);
  assert.equal(ouvert.status, 200, 'B ouvre le sujet');
  // La marque de lecture est posée en tâche de fond.
  let redescendu = null;
  for (let i = 0; i < 20; i++) {
    redescendu = await compte(sidB);
    if (redescendu === departB) break;
    await wait(200);
  }
  assert.equal(redescendu, departB, 'le sujet lu ne compte plus');

  // ── 4. Quelqu'un d'autre répond : le sujet redevient neuf pour B. ──
  const rep = await fetch(`${BASE}/api/forum/post`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidC, topicId, content: 'Et voici une réponse au sujet.' }),
  });
  assert.equal(rep.status, 200, 'la réponse passe');
  assert.equal(await compte(sidB), departB + 1, 'un sujet relancé se rallume');
});

// Le même voyant, côté BUREAU (main.swf) : l'écran digital de la barre porte
// une icône forum (select() : 0 aide, 1 FORUM, 2 messagerie…), et le SWF est
// câblé depuis toujours pour l'éveiller sur la trame <ay /> (newforummsg →
// listener.main.onNewForumMsg → digitalScreen.unSleep(1)). Le serveur ne
// l'émettait jamais : l'icône restait éteinte à vie. Désormais elle part à
// chaque sujet/réponse (jamais à l'auteur), et à la connexion quand des
// sujets ont du nouveau.
async function clientCBee(pseudo, sid) {
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
  const c = {
    pseudo, trames,
    attendre: async (pred, quoi, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 500)}`);
    },
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}
const trameForum = (t) => t.startsWith('<ay');

test('le voyant forum du BUREAU s\'allume : à la publication, et à la connexion', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidA = await inscrire('bureauposteur');
  const sidB = await inscrire('bureautemoin');
  const sidC = await inscrire('bureauretard');

  const liste = await salons(sidA);
  const board = liste.find((b) => /frutiz/i.test(b.name) && !/jeux/i.test(b.name)) || liste[liste.length - 1];

  const a = await clientCBee('bureauposteur', sidA);
  const b = await clientCBee('bureautemoin', sidB);
  try {
    const avantA = a.trames.filter(trameForum).length;

    // A poste : le témoin connecté voit la trame, l'auteur non.
    const r = await fetch(`${BASE}/api/forum/topic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sidA, boardId: board.id, title: 'Voyant du bureau', content: 'La barre doit s\'éveiller.' }),
    });
    assert.equal(r.status, 200, 'le sujet est créé');
    await b.attendre(trameForum, 'la trame <ay /> du voyant');
    await wait(400);
    assert.equal(a.trames.filter(trameForum).length, avantA,
      'l\'auteur ne s\'allume pas à son propre message');

    // C se connecte APRÈS coup : le voyant l'attend à l'ident.
    const c = await clientCBee('bureauretard', sidC);
    try {
      await c.attendre(trameForum, 'le voyant à la connexion (sujets non lus)');
    } finally { c.fermer(); }
  } finally {
    a.fermer();
    b.fermer();
  }
});

// ── « Tout marquer comme lu » : l'interrupteur du voyant ──────────────────
//
// Un sujet JAMAIS OUVERT compte comme neuf (COALESCE(read_at, 'epoch')) : un
// vieux fil qu'on ne compte pas lire laissait donc le voyant allumé à demeure,
// sans aucun moyen de dire « j'ai vu ». Le bouton du forum pose la marque de
// lecture partout d'un coup.

test('« Tout marquer comme lu » éteint le voyant, et un message neuf le rallume', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidA = await inscrire('toutluauteur');
  const sidB = await inscrire('toutlulecteur');
  const sidC = await inscrire('toutlurelance');

  const liste = await salons(sidA);
  const board = liste.find((b) => /frutiz/i.test(b.name) && !/jeux/i.test(b.name)) || liste[liste.length - 1];

  // A poste DEUX sujets : B ne les lira jamais — c'est tout le propos.
  const numeros = [];
  for (const titre of ['Un fil que je ne lirai pas', 'Un autre fil de la même eau']) {
    const r = await fetch(`${BASE}/api/forum/topic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sidA, boardId: board.id, title: titre, content: 'Du texte pour faire un sujet.' }),
    });
    assert.equal(r.status, 200, 'sujet créé : ' + titre);
    const j = await json(r);
    numeros.push(j.topicId || j.id || (j.topic && j.topic.id));
  }
  assert.ok(await compte(sidB) >= 2, 'B a au moins ces deux sujets à lire');

  // Sans session : personne à marquer.
  const anonyme = await fetch(`${BASE}/api/forum/read-all`, { method: 'POST' });
  assert.equal(anonyme.status, 401, 'le marquage exige une session');

  // Le bouton.
  const r = await fetch(`${BASE}/api/forum/read-all?sid=${sidB}`, { method: 'POST' });
  assert.equal(r.status, 200, 'le marquage passe');
  const d = await json(r);
  assert.equal(d.ok, true);
  assert.equal(d.restant, 0, 'le serveur annonce un forum entièrement lu');
  assert.ok(d.marques >= 2, 'et il dit combien de sujets il a marqués (' + d.marques + ')');
  assert.equal(await compte(sidB), 0, 'le voyant de B est éteint');

  // A, qui n'a rien demandé, garde son propre compte : le marquage est PERSONNEL.
  const sidD = await inscrire('toutlutemoin');
  assert.ok(await compte(sidD) >= 2, 'un autre frutiz voit toujours les sujets non lus');

  // Et le forum continue de vivre : une réponse rallume le voyant de B.
  const rep = await fetch(`${BASE}/api/forum/post`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidC, topicId: numeros[0], content: 'Une réponse qui doit rallumer le voyant.' }),
  });
  assert.equal(rep.status, 200, 'la réponse passe');
  assert.equal(await compte(sidB), 1, 'un sujet relancé se rallume');
});

test('le forum porte le bouton, et /light écoute son extinction', () => {
  const forum = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');
  assert.match(forum, /Tout marquer comme lu/, 'le bouton existe sur l\'index du forum');
  assert.match(forum, /id="tout-lu-btn"/, 'et il est repérable');
  assert.match(forum, /apiFetch\('\/api\/forum\/read-all', \{ method: 'POST' \}\)/,
    'il appelle bien la route de marquage');
  assert.match(forum, /if \(actions && currentUser\) \{[\s\S]{0,400}tout-lu-btn/,
    'réservé au frutiz connecté (un visiteur n\'a rien à marquer)');
  assert.match(forum, /postMessage\(\{ forum: 'toutLu'/, 'et il prévient la page qui l\'héberge');

  // EN HAUT de l'index, pas en bas : la liste des forums fait plusieurs
  // écrans sur un téléphone, et personne ne descendait chercher le bouton.
  // Il vit maintenant DANS l'en-tête (voir le test de mise en page plus bas),
  // donc au-dessus de tout ce que loadIndex compose.
  const index = forum.substring(forum.indexOf('async function loadIndex'),
    forum.indexOf('async function marquerToutLu'));
  const bouton = index.indexOf('tout-lu-btn');
  const entete = index.indexOf('<div class="tbl-header">');
  const boucle = index.indexOf('data.categories.length; ci++');
  assert.ok(bouton > 0 && entete > 0 && boucle > 0, 'les trois repères sont là');
  assert.ok(bouton < entete, 'le bouton est posé AVANT l\'en-tête du tableau');
  assert.ok(bouton < boucle, 'et avant la liste des forums — visible sans scroller');
  assert.match(index, /getElementById\('header-actions'\)/,
    'et il est posé dans la barre d\'actions de l\'en-tête');

  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(light, /d\.forum !== "toutLu"/, '/light écoute ce message…');
  assert.match(light, /setForumNonLus\(d\.restant\)/, '…et éteint son voyant sans attendre');
});

test('le bureau ENDORT son voyant forum quand la fenêtre du forum s\'ouvre', () => {
  // main.swf n'avait que l'allumage : `onNewForumMsg → digitalScreen.unSleep(1)`,
  // et RIEN n'appelait jamais `sleep(1)` — le voyant du bureau restait allumé
  // toute la session. La rustine pose l'appel manquant en tête de
  // FPForumSlot.onActivate, comme FPFileMng le fait pour les fichiers.
  const zlib = require('node:zlib');
  const raw = fs.readFileSync(path.join(ROOT, 'legacy/main.swf'));
  const corps = raw.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);

  // Le bloc de classe FPForumSlot, repéré par son ConstantPool.
  let pool = null, cpFin = 0, tagFin = 0;
  const debut = Math.ceil((5 + ((corps[0] >> 3) & 0x1f) * 4) / 8) + 4;
  for (let o = debut; o < corps.length - 1;) {
    const hdr = corps.readUInt16LE(o); const code = hdr >> 6;
    let len = hdr & 0x3f, h = 2;
    if (len === 0x3f) { len = corps.readUInt32LE(o + 2); h = 6; }
    if (code === 0) break;
    if (code === 59 && corps[o + h + 2] === 0x88) {
      const c = o + h + 2;
      const cpLen = corps.readUInt16LE(c + 1), cpCount = corps.readUInt16LE(c + 3);
      const p = corps.slice(c + 5, c + 3 + cpLen).toString('latin1').split('\0').slice(0, cpCount);
      if (p.includes('FPForumSlot')) { pool = p; cpFin = c + 3 + cpLen; tagFin = o + h + len; break; }
    }
    o += h + len;
  }
  assert.ok(pool, 'le bloc FPForumSlot est là');
  const iMe = pool.indexOf('me');
  const iEcran = pool.indexOf('digitalScreen');
  const iSleep = pool.indexOf('sleep');
  assert.ok(iEcran >= 0 && iSleep >= 0, 'le pool porte « digitalScreen » et « sleep »');

  // La séquence exacte : Push [1, 1, reg?, "me"] ; GetMember ; Push
  // "digitalScreen" ; GetMember ; Push "sleep" ; CallMethod ; Pop.
  const zone = corps.slice(cpFin, tagFin);
  let trouve = false;
  for (let i = 0; i + 30 < zone.length && !trouve; i++) {
    if (zone[i] !== 0x96 || zone.readUInt16LE(i + 1) !== 14) continue;
    if (zone[i + 3] !== 0x07 || zone.readInt32LE(i + 4) !== 1) continue;   // le voyant 1 = forum
    if (zone[i + 8] !== 0x07 || zone.readInt32LE(i + 9) !== 1) continue;   // un argument
    if (zone[i + 13] !== 0x04) continue;                                    // le registre _global
    if (zone[i + 15] !== 0x08 || zone[i + 16] !== iMe) continue;
    trouve = zone[i + 17] === 0x4e
      && zone[i + 18] === 0x96 && zone[i + 21] === 0x08 && zone[i + 22] === iEcran
      && zone[i + 23] === 0x4e
      && zone[i + 24] === 0x96 && zone[i + 27] === 0x08 && zone[i + 28] === iSleep
      && zone[i + 29] === 0x52 && zone[i + 30] === 0x17;
  }
  assert.ok(trouve, '_global.me.digitalScreen.sleep(1) est bien dans FPForumSlot');
});

test('le raccourci Forum a son icône d\'alerte, et de quoi l\'allumer', () => {
  // L'icône : la même forme dans le vert SOMBRE de l'écran allumé, exactement
  // comme l'historique et les événements. C'est l'inversion d'un segment de
  // LCD, pas un dessin nouveau.
  const repos = fs.readFileSync(path.join(ROOT, 'public/fb/Forum.svg'), 'utf8');
  const alerte = fs.readFileSync(path.join(ROOT, 'public/fb/ForumAlerte.svg'), 'utf8');
  assert.match(repos, /#a2eb56/, 'au repos, le vert clair');
  assert.match(alerte, /#2C4A0F/, 'allumée, le vert sombre');
  assert.ok(!/#a2eb56/.test(alerte), 'et plus une trace du vert clair');
  assert.equal(alerte.replace(/#2C4A0F/g, 'X'), repos.replace(/#a2eb56/g, 'X'),
    'même forme au pixel près — seule la couleur change');
  // Le témoin : l'historique suit la même règle.
  const hRepos = fs.readFileSync(path.join(ROOT, 'public/fb/Historique.svg'), 'utf8');
  const hAlerte = fs.readFileSync(path.join(ROOT, 'public/fb/HistoriqueAlerte.svg'), 'utf8');
  assert.equal(hAlerte.replace(/#2C4A0F/g, 'X'), hRepos.replace(/#a2eb56/g, 'X'),
    'la règle est bien celle du jeu d\'icônes');

  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // Le raccourci déclare son voyant — sans quoi `majVoyant` ne l'allumerait
  // jamais, quel que soit le compte (`n > 0 && !!def.voyant`).
  assert.match(html, /\{ file: "Forum",\s+name: "Forum", go: "forum",\s+voyant: "ForumAlerte",\s+mot: "sujet" \}/);
  assert.match(html, /var allume = n > 0 && !!def\.voyant;/, 'la porte est bien celle-là');
  // Et le compte lui parvient : au chargement du profil, et à la construction
  // de la grille.
  assert.match(html, /setForumNonLus\(d\.forumUnread\);/);
  assert.match(html, /majVoyant\("Forum", forumNonLus\);/);
  // Quitter le forum redemande le compte : les sujets se lisent dans l'iframe,
  // hors de notre vue.
  assert.match(html, /if \(ongletCourant === "forum" && tab !== "forum"\) loadHomeProfile\(\);/);
});

test('l\'en-tête du forum tient sur UNE ligne, même sur un téléphone', () => {
  // Le fil d'Ariane « Forum Frutiparc.com > Frutiz > Vos anciens pseudos ! »
  // ne rentre pas dans 390 px. Le repli mobile posait `flex-wrap: wrap` : le
  // titre, boîte flex qui refuse de se rétrécir sous son texte, sautait tout
  // entier à la ligne — l'orange restait SEULE en haut, le titre s'étalait sur
  // deux lignes en dessous, et le bouton « tout marquer comme lu » ouvrait
  // encore une bande blanche à lui seul. Trois lignes pour un titre.
  const forum = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');

  // 1. L'icône ne se sépare plus du titre.
  assert.match(forum, /\.forum-header \.title-link \{[^}]*min-width: 0;/,
    'le titre accepte de se rétrécir : son texte se replie DANS la boîte');
  assert.match(forum, /\.forum-header \{ flex-wrap: nowrap; \}/,
    'et rien ne saute plus à la ligne suivante');
  assert.match(forum, /\.forum-header \.bc-home \{ flex: none;/,
    'l\'orange garde sa taille quoi qu\'il arrive');

  // 2. L'orange EST la racine : sur un petit écran elle remplace le nom du
  // forum, qui coûte la moitié de la ligne. Elle mène au même endroit.
  assert.match(forum, /class="bc-home" onclick="navigate\('index'\);return false"/,
    'l\'icône est un lien vers l\'accueil du forum');
  assert.match(forum, /alt="Forum Frutiparc\.com"/, 'et elle le dit aux lecteurs d\'écran');
  assert.match(forum, /\.forum-header\.deep \.bc-root \{ display: none; \}/,
    'la racine s\'efface dès qu\'on est descendu d\'un cran');
  assert.match(forum, /entete\.classList\.toggle\('deep', parts\.length > 0\)/,
    'et « deep » se pose exactement là');
  // La racine emporte son chevron : sinon « > Frutiz » ouvrirait la ligne.
  const fil = forum.substring(forum.indexOf('function setBreadcrumb'),
    forum.indexOf('function navigate'));
  assert.match(fil, /if \(parts\.length\) html \+= ' <span class="bc-sep">&gt;<\/span> ';\s*\n\s*html \+= '<\/span>';/,
    'le séparateur de tête vit DANS la racine');
  assert.match(fil, /if \(i > 0\) html \+= ' <span class="bc-sep">&gt;<\/span> ';/,
    'les suivants restent entre les niveaux');

  // 3. Un titre à rallonge ne fait pas un pavé : deux lignes au plus.
  assert.match(forum, /-webkit-line-clamp: 2;/, 'le titre est borné à deux lignes');

  // 4. Le bouton partage la ligne du titre au lieu d'ouvrir une bande.
  assert.match(forum, /<div class="header-actions" id="header-actions"><\/div>/,
    'la barre d\'actions est dans l\'en-tête');
  assert.match(forum, /\.forum-header \.header-actions \{[^}]*margin-left: auto;/,
    'poussée au bout de la ligne');
  assert.match(forum, /\.forum-header \.header-actions:empty \{ display: none; \}/,
    'et invisible quand la page n\'a rien à y mettre');
  // Elle se vide à chaque changement de vue : les actions appartiennent à la
  // page qu'on quitte.
  assert.match(fil, /actions\.innerHTML = '';/, 'setBreadcrumb repart d\'une barre vide');
  // Le libellé raccourcit quand la place manque, sans perdre le bouton.
  assert.match(forum, /<span class="lb-long">Tout marquer comme lu<\/span>/);
  assert.match(forum, /<span class="lb-court">Tout lu<\/span>/);
  assert.match(forum, /\.forum-header \.lb-long \{ display: none; \}/,
    'à l\'étroit, c\'est le court qui parle');
  // Et l'attente ne mange pas la paire de libellés.
  const marquage = forum.substring(forum.indexOf('async function marquerToutLu'),
    forum.indexOf('var currentBoardId'));
  assert.match(marquage, /libelles\.length === 2/, 'le « Marquage… » écrit dans les deux');
  assert.ok(!/b\.textContent = 'Tout marquer comme lu'/.test(marquage),
    'plus de textContent qui écraserait les spans');
});
