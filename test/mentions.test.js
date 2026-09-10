/*
 * LES @MENTIONS — dans les salons publics et sur le forum.
 *
 * Écrire « @pseudo » s'adresse à quelqu'un. Jusqu'ici rien ne le distinguait
 * d'une ligne ordinaire : l'onglet d'un salon clignotait pour TOUT ce qui
 * passait — donc, dans un salon vivant, en permanence, et ne voulait plus rien
 * dire — et le forum ne prévenait que par son voyant collectif.
 *
 * Ce que ces épreuves tiennent :
 *
 *   · LE SALON. La trame diffusée porte `mn="…"`, la liste des pseudos que le
 *     SERVEUR a reconnus. C'est lui qui tranche — pas le client : il sait où
 *     s'arrête un pseudo (« @jean-luc, » désigne jean-luc), il connaît la
 *     casse, et il ignore « @personne ». Se mentionner soi-même ne compte pas.
 *   · LE TÉLÉPHONE. Un mentionné ABSENT reçoit une notification qui nomme
 *     l'auteur et mène au salon ; un mentionné qui a coupé `mention_chat` n'en
 *     reçoit aucune.
 *   · LE FORUM. Une mention allume le voyant du raccourci CHEZ LE MENTIONNÉ
 *     seul, laisse une ligne dans son historique, et sonne s'il est absent.
 *   · LE CLIGNOTEMENT, côté client : un salon public ne s'agite plus que pour
 *     une mention ou un cri de modérateur ; une conversation privée, elle,
 *     s'agite toujours.
 *
 * Le forum vit en base : PostgreSQL de test requis (cluster port 5433), sinon
 * tout est sauté proprement — comme citationsForum, dont ce fichier reprend le
 * téléphone simulé.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgWpQESXonD013w4k0
8CCMZ6bs8hov61dysBqv2SCHpB6hRANCAARnaiKXcWd7/g+Ui0gxjg+q/I25+HVX
xqyj+GyBLfONollQJswYAFsMQTp2OkS+hyuu07zG8K51hOmCLNLHuQbP
-----END PRIVATE KEY-----`;
const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBkTCCATagAwIBAgIURNXpwdCiYS4mgfzKB4O+Ee/E0rwwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJMTI3LjAuMC4xMCAXDTI2MDgyMjEzMzMwNVoYDzIxMjYwNzI5
MTMzMzA1WjAUMRIwEAYDVQQDDAkxMjcuMC4wLjEwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARnaiKXcWd7/g+Ui0gxjg+q/I25+HVXxqyj+GyBLfONollQJswYAFsM
QTp2OkS+hyuu07zG8K51hOmCLNLHuQbPo2QwYjAdBgNVHQ4EFgQUGtfxZr0hojQw
Lewcbj6efdddYDMwHwYDVR0jBBgwFoAUGtfxZr0hojQwLewcbj6efdddYDMwDwYD
VR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMAoGCCqGSM49BAMCA0kAMEYC
IQDLUV04+jGp3v6R1ju/pLZfJDKlMUryw3tEGyZO0mMXewIhANl4u7fM7Q7FtcY2
aOXjI8Pybb6Fd1F5RB0YNzT5T8tX
-----END CERTIFICATE-----`;

const ROOT = path.join(__dirname, '..');
const PORT = 3531;
const FAUX_PUSH_PORT = 3532;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-mentions';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_mentions';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const NOMME = 'mirabelle' + RUN;   // celui qu'on mentionne
const AUTEUR = 'bavard' + RUN;     // celui qui mentionne
const SOURD = 'discret' + RUN;     // celui qui a coupé ses mentions

let proc = null, fauxPush = null, dispo = false;
const recus = [];

// Le téléphone simulé (même mécanique que citationsForum / appliMobile).
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const AUTH_SECRET = crypto.randomBytes(16);
const b64url = (b) => Buffer.from(b).toString('base64url');
const abonnement = (chemin) => ({
  endpoint: `https://127.0.0.1:${FAUX_PUSH_PORT}${chemin}`,
  keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(AUTH_SECRET) },
});
function dechiffrer(corps) {
  const salt = corps.subarray(0, 16);
  const idlen = corps.readUInt8(20);
  const clePubServeur = corps.subarray(21, 21 + idlen);
  const chiffre = corps.subarray(21 + idlen);
  const partage = ecdh.computeSecret(clePubServeur);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), clePubServeur]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', partage, AUTH_SECRET, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(chiffre.subarray(chiffre.length - 16));
  const clair = Buffer.concat([d.update(chiffre.subarray(0, chiffre.length - 16)), d.final()]);
  let fin = clair.length - 1;
  while (fin >= 0 && clair[fin] === 0) fin--;
  return JSON.parse(clair.subarray(0, fin).toString('utf8'));
}

async function baseDisponible() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}

before(async () => {
  dispo = await baseDisponible();
  if (!dispo) return;
  fauxPush = https.createServer({ key: TLS_KEY, cert: TLS_CERT }, (req, res) => {
    const bouts = [];
    req.on('data', (c) => bouts.push(c));
    req.on('end', () => { recus.push({ url: req.url, corps: Buffer.concat(bouts) }); res.statusCode = 201; res.end(); });
  });
  await new Promise((r) => fauxPush.listen(FAUX_PUSH_PORT, '127.0.0.1', r));

  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5306', FRUTISCORE_PORT: '5307',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/do/prefdef')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'forum_posts'`);
        await c.end();
        if (rows.length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (fauxPush) fauxPush.close();
});

const jpost = (chemin, corps) => fetch(BASE + chemin, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
}).then((r) => r.json());

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session pour ' + pseudo);
  return j.sid;
}

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
    pseudo, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    attendre: async (pred, quoi, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 700)}`);
    },
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}

async function attendrePush(nAvant, ms = 4000) {
  for (let i = 0; i < ms / 100; i++) {
    if (recus.length > nAvant) return dechiffrer(recus[recus.length - 1].corps);
    await wait(100);
  }
  return null;
}

let sidNomme = null, sidAuteur = null, sidSourd = null;

test('mise en place : trois comptes, deux téléphones abonnés', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  sidNomme = await inscrire(NOMME);
  sidAuteur = await inscrire(AUTEUR);
  sidSourd = await inscrire(SOURD);
  assert.equal((await jpost('/api/push/subscribe', { sid: sidNomme, subscription: abonnement('/nomme') })).ok, true);
  assert.equal((await jpost('/api/push/subscribe', { sid: sidSourd, subscription: abonnement('/sourd') })).ok, true);
});

test('un salon public : la trame nomme qui a été mentionné', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const auteur = await client(AUTEUR, sidAuteur);
  const temoin = await client(NOMME, sidNomme);
  try {
    auteur.envoyer('<o g="pomme" />');
    temoin.envoyer('<o g="pomme" />');
    await auteur.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'liste du salon');
    await temoin.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'liste du salon (témoin)');

    // 1. Une mention ordinaire : le serveur la reconnaît et la nomme.
    auteur.envoyer(`<t g="pomme" t="m" p="">salut @${NOMME} ça va ?</t>`);
    const avec = await temoin.attendre(
      (x) => x.startsWith('<t') && x.includes('ça va'), 'la ligne mentionnée');
    assert.match(avec, new RegExp(`mn="[^"]*${NOMME}`, 'i'),
      'la trame porte mn= avec le pseudo mentionné : ' + avec);

    // 2. LA PONCTUATION NE FAIT PAS PARTIE DU PSEUDO. « @pseudo, » désigne bien
    //    le pseudo — c'est le cas le plus courant dans une phrase.
    auteur.envoyer(`<t g="pomme" t="m" p="">@${NOMME}, tu viens ?</t>`);
    const virgule = await temoin.attendre(
      (x) => x.startsWith('<t') && x.includes('tu viens'), 'la ligne avec virgule');
    assert.match(virgule, new RegExp(`mn="[^"]*${NOMME}`, 'i'),
      'la virgule ne mange pas la mention : ' + virgule);

    // 3. Une ligne SANS mention n'en porte pas — l'onglet ne clignotera pas.
    auteur.envoyer('<t g="pomme" t="m" p="">il fait beau aujourd\'hui</t>');
    const sans = await temoin.attendre(
      (x) => x.startsWith('<t') && x.includes('il fait beau'), 'la ligne ordinaire');
    assert.ok(!sans.includes('mn='), 'aucune mention annoncée : ' + sans);

    // 4. Un pseudo qui n'existe pas n'est pas une mention.
    auteur.envoyer('<t g="pomme" t="m" p="">coucou @personne_du_tout</t>');
    const fantome = await temoin.attendre(
      (x) => x.startsWith('<t') && x.includes('coucou'), 'la ligne au pseudo inconnu');
    assert.ok(!fantome.includes('mn='), '« @personne_du_tout » ne mentionne personne : ' + fantome);

    // 5. Se mentionner soi-même ne compte pas.
    auteur.envoyer(`<t g="pomme" t="m" p="">moi c'est @${AUTEUR}</t>`);
    const soi = await temoin.attendre(
      (x) => x.startsWith('<t') && x.includes("moi c'est"), 'la ligne où l\'auteur se nomme');
    assert.ok(!soi.includes('mn='), 'on ne se mentionne pas soi-même : ' + soi);
  } finally { auteur.fermer(); temoin.fermer(); }
});

test('un mentionné ABSENT reçoit la notification ; celui qui a coupé, non', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const auteur = await client(AUTEUR, sidAuteur);
  try {
    auteur.envoyer('<o g="pomme" />');
    await auteur.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'liste du salon');

    // NOMME n'a pas de socket ouverte : il est absent, le téléphone prend le relais.
    const avant = recus.length;
    auteur.envoyer(`<t g="pomme" t="m" p="">@${NOMME} tu me manques</t>`);
    const charge = await attendrePush(avant);
    assert.ok(charge, 'une notification est partie pour le mentionné absent');
    assert.match(charge.t, /mentionné/i, 'le titre dit la mention : ' + charge.t);
    assert.match(charge.t, new RegExp(AUTEUR, 'i'), 'et nomme l\'auteur : ' + charge.t);
    assert.match(charge.c, /tu me manques/, 'le corps donne l\'extrait : ' + charge.c);
    assert.match(charge.u, /ouvre=chat&salon=pomme/, 'le clic mène AU SALON : ' + charge.u);

    // SOURD a coupé `mention_chat` : rien ne doit partir pour lui.
    assert.equal((await jpost('/api/light/prefs', { sid: sidSourd, prefs: { mention_chat: 'N' } })).ok, true);
    const avant2 = recus.length;
    auteur.envoyer(`<t g="pomme" t="m" p="">@${SOURD} et toi ?</t>`);
    await wait(1200);
    assert.equal(recus.length, avant2, 'aucune notification pour qui a coupé ses mentions');
  } finally { auteur.fermer(); }
});

test('le forum : voyant, historique et téléphone, pour le seul mentionné', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const index = await (await fetch(`${BASE}/api/forum/index?sid=${sidAuteur}`)).json();
  const board = (index.categories || []).flatMap((c) => c.boards || [])
    .find((b) => b && !/annonce|animation/i.test(String(b.name || '')));
  assert.ok(board, 'un forum où poster : ' + JSON.stringify(index).slice(0, 200));

  // Le mentionné est CONNECTÉ : il doit voir son voyant s'allumer.
  const nomme = await client(NOMME, sidNomme);
  const temoin = await client(SOURD, sidSourd);
  let topicId = null;
  try {
    const avant = recus.length;
    const sujet = await jpost('/api/forum/topic', {
      sid: sidAuteur, boardId: board.id, title: 'Le verger en septembre',
      content: `Qu'en penses-tu @${NOMME} ?`,
    });
    assert.ok(sujet.ok, 'sujet créé : ' + JSON.stringify(sujet).slice(0, 160));
    topicId = sujet.topicId;

    // 1. LE VOYANT, chez le mentionné, avec le sujet nommé.
    // Le voyant COLLECTIF part pour tout le monde (`notifyForumNews`, la trame
    // nue). Celui de la mention, lui, NOMME le sujet : c'est celui-là qu'on
    // attend, et c'est lui qui mène au bon fil.
    const ay = await nomme.attendre(
      (x) => x.startsWith('<ay') && x.includes('i='), 'le voyant NOMMÉ du mentionné');
    assert.match(ay, /i="\d+"/, 'la trame nomme le sujet : ' + ay);
    assert.match(ay, /Le verger/, 'et en donne le titre : ' + ay);

    // 2. L'HISTORIQUE garde une ligne — c'est ce qui reste après coup.
    const histo = await (await fetch(`${BASE}/api/light/history?sid=${sidNomme}`)).json();
    const ligne = (histo.events || []).find((e) => /mentionné/i.test(String(e.text || '')));
    assert.ok(ligne, 'une ligne d\'historique pour la mention : '
      + JSON.stringify(histo.events || []).slice(0, 300));
    assert.match(JSON.stringify(ligne), /Le verger en septembre/, 'elle nomme le sujet');
    assert.match(JSON.stringify(ligne), new RegExp(AUTEUR, 'i'), 'et l\'auteur');

    // 3. LE TÉLÉPHONE ne sonne pas : il est devant son écran. (La notification
    //    du forum, elle, ne part que pour un absent — comme partout.)
    await wait(600);
    const pousses = recus.length - avant;
    assert.equal(pousses, 0, 'présent : rien n\'est poussé (' + pousses + ' reçue(s))');

    // 4. Le témoin qui n'est pas mentionné ne reçoit PAS de trame nommée.
    const nomme2 = temoin.trames.filter((x) => x.startsWith('<ay') && x.includes('i='));
    assert.equal(nomme2.length, 0, 'le voyant nommé ne part que pour le mentionné : ' + nomme2.join(' '));
  } finally { nomme.fermer(); temoin.fermer(); }

  // 5. ABSENT, le mentionné reçoit la notification, sujet en lien. La réponse
  //    vient d'un TROISIÈME joueur : le forum refuse deux messages d'affilée du
  //    même auteur, et cela tombe bien — une mention vaut quel qu'en soit
  //    l'auteur.
  const avant = recus.length;
  const rep = await jpost('/api/forum/post', {
    sid: sidSourd, topicId, content: `et toi @${NOMME} ? tu en dis quoi ?`,
  });
  assert.ok(rep.ok, 'réponse postée : ' + JSON.stringify(rep).slice(0, 160));
  const charge = await attendrePush(avant);
  assert.ok(charge, 'une notification est partie pour le mentionné absent');
  assert.match(charge.t, /mentionné/i, 'le titre dit la mention : ' + charge.t);
  assert.match(charge.t, new RegExp(SOURD, 'i'), 'et nomme l\'auteur : ' + charge.t);
  assert.equal(charge.u, '/light?ouvre=forum&sujet=' + topicId, 'le clic mène AU sujet');
});

test('le forum trouve aussi quelqu\'un que la mémoire ne connaît pas', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  /*
   * `users` ne garde en mémoire que les comptes récemment touchés. Mentionner
   * quelqu'un qui n'est pas passé depuis le redémarrage ne trouvait personne —
   * or c'est précisément celui-là qu'il fallait prévenir. Le forum redemande
   * donc à la BASE. On fabrique le cas : un compte inscrit puis oublié, qu'on
   * mentionne sans qu'il se soit jamais connecté au chat.
   */
  const OUBLIE = 'oublie' + RUN;
  // On l'écrit DIRECTEMENT en base, sans jamais passer par le serveur : c'est
  // la seule façon d'avoir un compte que `users` ne connaît pas.
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows } = await c.query(
    'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id', [OUBLIE, 'x']);
  const idOublie = rows[0] && rows[0].id;
  assert.ok(idOublie, 'compte inséré en base sans passer par le serveur');

  const index = await (await fetch(`${BASE}/api/forum/index?sid=${sidAuteur}`)).json();
  const board = (index.categories || []).flatMap((cat) => cat.boards || [])
    .find((b) => b && !/annonce|animation/i.test(String(b.name || '')));
  const sujet = await jpost('/api/forum/topic', {
    sid: sidAuteur, boardId: board.id, title: 'On cherche un absent',
    content: `quelqu'un a vu @${OUBLIE} ?`,
  });
  assert.ok(sujet.ok, 'sujet créé : ' + JSON.stringify(sujet).slice(0, 160));

  // La preuve : la ligne d'historique est écrite EN BASE pour un compte que le
  // serveur n'a jamais chargé. C'est `addAndNotifyUserLog` qui s'en charge quand
  // le joueur est hors ligne — et il ne l'aurait jamais fait si la mention
  // n'avait désigné personne.
  let trouve = null;
  for (let i = 0; i < 40 && !trouve; i++) {
    const { rows: log } = await c.query(
      'SELECT content FROM user_logs WHERE user_id = $1 AND entry_type = 21', [idOublie]);
    trouve = log[0] || null;
    if (!trouve) await wait(100);
  }
  await c.end();
  assert.ok(trouve, 'l\'absent oublié de la mémoire est quand même prévenu');
  assert.match(trouve.content, /On cherche un absent/, 'la ligne nomme le sujet : ' + trouve.content);
});

test('on n\'a plus à savoir écrire le pseudo : la liste le propose', () => {
  /*
   * Certains pseudos ne s'écrivent pas de mémoire — une majuscule au milieu, un
   * point, un chiffre. « @ » suivi de deux lettres ouvre donc une liste. Les
   * noms viennent d'abord du SALON (ceux qu'on nomme neuf fois sur dix, et
   * qu'on a déjà sous la main), puis du PARC, que le serveur cherche.
   *
   * Le geste se vérifie dans un navigateur ; on tient ici le câblage.
   */
  const src = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
  // Le mot en cours doit TOUCHER le curseur, et commencer un mot.
  assert.match(src, /var m = \/\(\^\|\\s\)@\(\[A-Za-z0-9_\.-\]\{0,32\}\)\$\/\.exec\(avant\);/,
    'la mention se lit devant le curseur, en début de mot');
  // Le salon d'abord, le parc ensuite — et jamais soi-même.
  assert.match(src, /var ici = state\.usersByRoom\[state\.room\] \|\| \{\};/, 'les présents du salon');
  assert.match(src, /if \(bas\.length >= 2 && mentionParc\[bas\]\)/, 'le parc, à partir de deux lettres');
  // Et il vient du REGISTRE DES COMPTES, pas du Bouilloscope : celui-ci est une
  // collection de bouilles, un joueur qui n'y figure pas ne se proposait jamais.
  assert.match(src, /fetch\("\/api\/light\/pseudos\?sid="/, 'le parc vient de /api/light/pseudos');
  assert.doesNotMatch(src, /mentionTrombi/, 'le trombinoscope ne sert plus d’annuaire');
  assert.match(src, /return dansLeSalon\.sort\(tri\)\.concat\(ailleurs\.sort\(tri\)\)\.slice\(0, 8\);/,
    'le salon passe devant, et la liste est bornée');
  // Le clavier : ↑↓ choisissent, Entrée et Tab insèrent, Échap referme. Tant
  // qu'une proposition est en main, Entrée ne POSTE pas — elle complète.
  assert.match(src, /if \(ev\.key === "Enter" \|\| ev\.key === "Tab"\) \{ ev\.preventDefault\(\); mentionPoser\(\); return; \}/,
    'Entrée complète au lieu d\'envoyer');
  assert.match(src, /if \(ev\.key === "Escape"\) \{ ev\.preventDefault\(\); mentionFermer\(\); \}/);
  // Une espace après le pseudo : on enchaîne sur la phrase sans y penser.
  assert.match(src, /inp\.value = avant \+ "@" \+ pseudo \+ " " \+ apres;/);
  // Il y a PLUSIEURS saisies à l'écran (le panneau mobile, une par fenêtre de
  // salon) et toutes portent le même identifiant : on écoute le document.
  assert.match(src, /document\.addEventListener\("input", function \(ev\) \{\s*\n\s*if \(!ev\.target \|\| ev\.target\.id !== "compose-input"\) return;/,
    'l\'écoute est déléguée au document');
});

test('le client : un salon public ne clignote que pour ce qui s\'adresse à moi', () => {
  // La règle vit dans le client (public/light.html) : `avertirOngletChat` reçoit
  // désormais un troisième argument, et le salon public le calcule à partir de
  // `mn` et du cri rouge. On tient ici le CÂBLAGE — le rendu, lui, se regarde
  // dans un navigateur.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
  assert.match(src, /function avertirOngletChat\(ty, salon, pourMoi\)/,
    'le clignotement sait pour QUI il clignote');
  assert.match(src, /if \(pourMoi === false\) return;/,
    'et se tait quand la ligne ne me concerne pas');
  // « et rien d'autre » — pas même une ligne REJOUÉE : l'historique de la
  // reconnexion s'écrit sans réveiller personne (cf. bouilleClignote).
  assert.match(src, /var pourMoi = !enRejeu && \(meMentionne\(nommes\) \|\| attr\(xml, "st"\) === "r"\);/,
    'une mention OU un cri de modérateur, et rien d\'autre — jamais un rejeu');
  assert.match(src, /avertirOngletChat\(ty, salon, true\);/,
    'une conversation privée avertit toujours');
  // Et le lien de la notification ouvre le BON salon — sinon il faudrait
  // chercher soi-même où l'on a été appelé.
  assert.match(src, /if \(ouvre === "chat" && salon\) \{/, 'le routeur connaît le salon');
  assert.match(src, /if \(salon !== state\.room\) switchRoom\(salon\);/, 'et y bascule');
  const sw = fs.readFileSync(path.join(ROOT, 'public', 'light-sw.js'), 'utf8');
  assert.match(sw, /salon: p\.get\('salon'\) \|\| ''/, 'le service worker fait suivre le salon');
});

test('l\'annuaire des @mentions : chercher un préfixe, résoudre une liste', async (t) => {
  if (!dispo) return t.skip('PostgreSQL de test indisponible');
  /*
   * `/api/light/pseudos` répond aux DEUX questions du client — « quels pseudos
   * commencent par là ? » (on complète) et « lesquels de ceux-ci existent ? »
   * (on met en gras) — par la MÊME résolution que celle qui décide d'envoyer
   * la notification. Sinon le forum souligne des pseudos que le serveur ne
   * notifiera pas, ou l'inverse.
   *
   * Ce qu'on interrogeait avant, `/api/trombinoscope`, est une collection de
   * BOUILLES : un joueur qui n'y figure pas ne se proposait jamais.
   */
  const q = async (params) => (await (await fetch(BASE + '/api/light/pseudos?sid='
    + encodeURIComponent(sidAuteur) + '&' + params)).json());

  // Le préfixe : le pseudo de B doit sortir, et pas celui du demandeur seul.
  const parPrefixe = await q('q=' + encodeURIComponent(NOMME.slice(0, 6)));
  assert.strictEqual(parPrefixe.ok, true);
  assert.ok(parPrefixe.pseudos.some((p) => p.toLowerCase() === NOMME.toLowerCase()),
    'le pseudo cherché doit être proposé — ' + JSON.stringify(parPrefixe.pseudos));

  // La résolution : ce qui existe revient avec sa CASSE d'affichage, le reste
  // ne revient pas du tout.
  const resolu = await q('n=' + encodeURIComponent([NOMME, 'zzintrouvable'].join(',')));
  assert.ok(resolu.connus[NOMME], 'un vrai pseudo est reconnu');
  assert.ok(!resolu.connus.zzintrouvable, 'un pseudo inventé ne l’est pas');

  // Sans session, rien : l'annuaire n'est pas public.
  const sansSid = await fetch(BASE + '/api/light/pseudos?q=a');
  assert.strictEqual(sansSid.status, 401);
});

test('le forum : les @mentions se complètent et se lisent en gras', () => {
  /* Le serveur les notifiait déjà (voyant, historique, poussée) ; il manquait
     les deux gestes qui se voient — écrire une mention sans se tromper de
     pseudo, et la lire d'un coup d'œil. */
  const FB = fs.readFileSync(path.join(ROOT, 'public', 'fb', 'index.html'), 'utf8');
  // LA LECTURE. Le marquage passe APRÈS les BBCode (pour ne pas couper une
  // balise) et n'accepte un `@mot` que si le serveur l'a reconnu.
  assert.match(FB, /out = marquerMentions\(out\);/);
  assert.match(FB, /function marquerMentions\(html\) \{/);
  assert.match(FB, /if \(!mentionRoster\[nom\.toLowerCase\(\)\]\) return tout;/,
    'un @mot qui ne désigne personne reste du texte');
  assert.match(FB, /'mention' \+ \(nom\.toLowerCase\(\) === moi \? ' moi' : ''\)/,
    'et la sienne se voit davantage, comme au chat');
  // Un seul aller-retour par page, AVANT le rendu : les mentions naissent en
  // gras au lieu de s'y mettre après coup.
  assert.match(FB, /await resoudreMentions\(data\.posts\.flatMap/);
  assert.match(FB, /\/api\/light\/pseudos\?sid='[\s\S]{0,120}'&n='/);
  // La ponctuation de queue ne fait pas partie du pseudo — même règle que
  // `candidatsMention` côté serveur.
  assert.match(FB, /if \(!\/\[\._,;:!\?\)-\]\$\/\.test\(mot\)\) break;/);

  // L'ÉCRITURE. Toutes les zones de saisie du forum, et le clavier d'abord.
  assert.match(FB, /function estUneSaisie\(el\) \{/);
  assert.match(FB, /'&q=' \+ encodeURIComponent\(bas\)/, 'les propositions viennent du serveur');
  assert.match(FB, /if \(ev\.key === 'Enter' \|\| ev\.key === 'Tab'\) \{ ev\.preventDefault\(\); poser\(\); return; \}/);
  assert.match(FB, /if \(ev\.key === 'Escape'\) \{ ev\.preventDefault\(\); fermer\(\); \}/);
  // La liste se pose sous le CURSEUR : dans un forum la zone est haute, une
  // liste ancrée au bord du champ tomberait loin du mot qu'on tape.
  assert.match(FB, /function pointDuCurseur\(inp\) \{/);
  assert.match(FB, /miroir\.style\.whiteSpace = 'pre-wrap';/);
  // Et le gras a ses couleurs, celles du chat.
  assert.match(FB, /\.post-content \.mention, \.post-signature \.mention \{ color: #2C4A0F; font-weight: bold; \}/);
});
