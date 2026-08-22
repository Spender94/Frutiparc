/*
 * L'APPLI MOBILE — installation et notifications push.
 *
 * /light s'installe désormais comme une appli (manifest + service worker), et
 * le serveur pousse des notifications Web Push : courrier, messages privés,
 * événements du site. La règle : on ne pousse qu'aux ABSENTS — un joueur dont
 * la socket de chat vit voit déjà tout à l'écran.
 *
 * Le test joue le TÉLÉPHONE : un faux service de poussée (serveur HTTP local)
 * reçoit ce que web-push envoie, et le test DÉCHIFFRE réellement la charge
 * (RFC 8291 : ECDH P-256 + HKDF + AES-128-GCM) avec les clés de l'appareil
 * simulé. On ne vérifie donc pas « une requête est partie » mais « le titre et
 * le lien profond arrivent, lisibles, chiffrés pour le bon destinataire ».
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

// web-push parle https, point. Le faux service de poussée est donc un serveur
// TLS avec ce certificat auto-signé (CN=127.0.0.1, valable un siècle — il ne
// protège rien, il permet la poignée de main) ; le serveur SOUS TEST reçoit
// NODE_TLS_REJECT_UNAUTHORIZED=0 pour l'accepter. Test uniquement : en
// production, les endpoints sont ceux des vrais services de poussée.
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
const PORT = 3511;
const SOCKET_PORT = 5272;
const FAUX_PUSH_PORT = 3512;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE_ADMIN = 'cle-de-test-appli';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DEST = 'poche' + RUN;        // le joueur qui a installé l'appli
const EXP = 'plume' + RUN;         // celui qui lui écrit

let proc = null;
let fauxPush = null;
const recus = [];                  // { url, headers, corps (Buffer) } — ce que le « téléphone » reçoit
let reponsePush = 201;             // 410 pour simuler un abonnement mort

// ── Le téléphone simulé : paire P-256 + secret d'authentification ───────────
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const AUTH_SECRET = crypto.randomBytes(16);
const b64url = (b) => Buffer.from(b).toString('base64url');

function abonnement(chemin) {
  return {
    endpoint: `https://127.0.0.1:${FAUX_PUSH_PORT}${chemin}`,
    keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(AUTH_SECRET) },
  };
}

// Déchiffrement côté récepteur (RFC 8291 / aes128gcm, RFC 8188) : exactement
// ce que fait le navigateur avant de réveiller le service worker.
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
  const dechiffreur = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  dechiffreur.setAuthTag(chiffre.subarray(chiffre.length - 16));
  let clair = Buffer.concat([dechiffreur.update(chiffre.subarray(0, chiffre.length - 16)), dechiffreur.final()]);
  // Le remplissage : le clair se termine par 0x02 (dernier bloc) puis des zéros.
  let fin = clair.length - 1;
  while (fin >= 0 && clair[fin] === 0) fin--;
  assert.equal(clair[fin], 0x02, 'délimiteur de remplissage du dernier bloc');
  return JSON.parse(clair.subarray(0, fin).toString('utf8'));
}

before(async () => {
  fauxPush = https.createServer({ key: TLS_KEY, cert: TLS_CERT }, (req, res) => {
    const morceaux = [];
    req.on('data', (c) => morceaux.push(c));
    req.on('end', () => {
      recus.push({ url: req.url, headers: req.headers, corps: Buffer.concat(morceaux) });
      res.statusCode = reponsePush;
      res.end();
    });
  });
  await new Promise((r) => fauxPush.listen(FAUX_PUSH_PORT, '127.0.0.1', r));

  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE_ADMIN, XMLSOCKET_PORT: String(SOCKET_PORT), FRUTISCORE_PORT: String(SOCKET_PORT + 1),
      NODE_TLS_REJECT_UNAUTHORIZED: '0',   // accepte le certificat du faux service
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (fauxPush) fauxPush.close();
});

async function sidPour(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session pour ' + pseudo);
  return j.sid;
}

const jpost = (chemin, corps) => fetch(BASE + chemin, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(corps),
}).then((r) => r.json());

// Une socket de chat « à la light » (TCP + ident par sid) : c'est elle qui
// fait un joueur PRÉSENT aux yeux du serveur. On garde ce qu'elle reçoit —
// le nom du salon privé, entre autres, arrive par là.
const sockets = [];
function brancher(pseudo, sid) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET_PORT, '127.0.0.1');
    sockets.push(sock);
    sock.trames = [];
    sock.setEncoding('utf8');
    let tampon = '';
    sock.on('data', (d) => {
      tampon += d;
      let i;
      while ((i = tampon.indexOf('\0')) >= 0) {
        const t = tampon.slice(0, i);
        tampon = tampon.slice(i + 1);
        if (t) sock.trames.push(t);
      }
    });
    sock.on('error', reject);
    sock.on('connect', () => {
      sock.write(`<k l="${pseudo}" s="${sid}" lc="1" />\0`);
      setTimeout(() => resolve(sock), 500);
    });
  });
}
async function attendreTrame(sock, motif) {
  for (let i = 0; i < 40; i++) {
    const t = sock.trames.find((x) => motif.test(x));
    if (t) return t;
    await wait(100);
  }
  assert.fail('trame attendue jamais reçue : ' + motif);
}

// Attend qu'un message pousse jusqu'au faux service (ou échoue au bout de 4 s).
async function attendrePush(nAvant) {
  for (let i = 0; i < 40; i++) {
    if (recus.length > nAvant) return recus[recus.length - 1];
    await wait(100);
  }
  assert.fail('aucune notification reçue par le téléphone simulé');
}

let sidDest = null, sidExp = null;

// ── L'installation (fichiers statiques de l'appli) ─────────────────────────

test("l'appli est installable : manifest, icônes, service worker", async () => {
  const man = await (await fetch(BASE + '/light-manifest.webmanifest')).json();
  assert.equal(man.name, 'Frutiparc');
  assert.equal(man.display, 'standalone');
  assert.match(man.start_url, /^\/light/);
  assert.ok(man.icons.length >= 3, 'les icônes 192/512/maskable');
  assert.ok(man.icons.some((i) => i.purpose === 'maskable'), 'une icône maskable (Android rogne en cercle)');
  for (const i of man.icons) {
    const r = await fetch(BASE + i.src);
    assert.equal(r.status, 200, i.src + ' existe');
    assert.equal(r.headers.get('content-type'), 'image/png');
  }

  const sw = await (await fetch(BASE + '/light-sw.js')).text();
  assert.match(sw, /addEventListener\('push'/, 'le service worker écoute les poussées');
  assert.match(sw, /addEventListener\('notificationclick'/, 'et le clic sur la notification');
  assert.ok(!/addEventListener\(['"]fetch/.test(sw),
    "PAS de gestionnaire fetch : aucun cache, rien qui puisse casser les jeux ou Ruffle");

  const page = await (await fetch(BASE + '/light')).text();
  assert.match(page, /rel="manifest" href="\/light-manifest\.webmanifest"/, 'la page déclare le manifest');
  assert.match(page, /serviceWorker\.register\("\/light-sw\.js"\)/, 'et enregistre le service worker');
  assert.match(page, /apple-touch-icon/, "l'icône iOS");
  assert.match(page, /src="\/images\/logo\.gif"/, 'le logo est servi en local (plus de dépendance GitHub)');
});

// ── Les notifications ──────────────────────────────────────────────────────

test("s'abonner enregistre l'appareil", async () => {
  sidDest = await sidPour(DEST);
  sidExp = await sidPour(EXP);
  const r = await jpost('/api/push/subscribe', { sid: sidDest, subscription: abonnement('/push/tel1') });
  assert.equal(r.ok, true);
  const etat = await (await fetch(`${BASE}/api/push/etat?sid=${sidDest}&endpoint=${encodeURIComponent(abonnement('/push/tel1').endpoint)}`)).json();
  assert.equal(etat.actif, true, "l'état du bouton reflète l'abonnement");
});

test('un courrier reçu ABSENT sonne sur le téléphone — chiffré, lisible, cliquable', async () => {
  const n = recus.length;
  const envoi = await jpost('/api/light/mail/send', {
    sid: sidExp, to: DEST, subject: 'Rendez-vous au stand', body: 'Viens voir la vitrine !',
  });
  assert.equal(envoi.ok, true, 'courrier parti : ' + JSON.stringify(envoi).slice(0, 120));
  const p = await attendrePush(n);
  assert.match(String(p.headers.authorization || ''), /^vapid t=/, 'signature VAPID présente');
  assert.equal(p.headers['content-encoding'], 'aes128gcm', 'chiffrement Web Push');
  const charge = dechiffrer(p.corps);
  assert.equal(charge.t, '📬 Nouveau courrier');
  assert.match(charge.c, new RegExp(EXP));
  assert.match(charge.c, /Rendez-vous au stand/);
  assert.equal(charge.u, '/light?ouvre=mail', 'le clic atterrit sur la messagerie');
});

test('présent devant l\'écran → pas de doublon sur le téléphone', async () => {
  await brancher(DEST, sidDest);
  const n = recus.length;
  await jpost('/api/light/mail/send', { sid: sidExp, to: DEST, subject: 'Encore moi', body: 'Tu es là ?' });
  await wait(800);
  assert.equal(recus.length, n, 'sa socket vit : l\'écran a déjà tout montré');
});

test('un message privé qui tombe dans le vide sonne sur le téléphone', async () => {
  // Le protocole d'origine REFUSE d'ouvrir un privé vers un hors-ligne (k=201,
  // « envoyez un e-mail »). Le cas réel du mobile est l'autre : la conversation
  // est OUVERTE, puis l'un des deux passe en arrière-plan — sa socket meurt, et
  // le message suivant part dans un salon où personne ne l'entend. C'est là que
  // le téléphone doit prendre le relais.
  const sockExp = await brancher(EXP, sidExp);
  sockExp.write(`<r u="${DEST}" r="mp1" />\0`);
  const rep = await attendreTrame(sockExp, /<r [^>]*g="pm2?_/);
  const salon = / g="([^"]+)"/.exec(rep)[1];

  // Le destinataire referme l'appli : sa socket meurt.
  const sockDest = sockets.find((s) => s !== sockExp);
  sockDest.destroy();
  await wait(400);

  const n = recus.length;
  sockExp.write(`<t g="${salon}" t="m" p="">Tu joues ce soir ?</t>\0`);
  const p = await attendrePush(n);
  const charge = dechiffrer(p.corps);
  assert.match(charge.t, /t'écrit/, 'le titre nomme l\'expéditeur : ' + charge.t);
  assert.match(charge.t, new RegExp(EXP, 'i'));
  assert.match(charge.c, /Tu joues ce soir/);
  assert.match(charge.u, /ouvre=prive&avec=/, 'le clic ouvre la conversation');
});

test('un événement du site prévient les abonnés absents', async () => {
  const n = recus.length;
  const r = await fetch(BASE + '/api/admin/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE_ADMIN },
    body: JSON.stringify({ message: 'Grand tournoi Frutibandas à 21h !', type: 1 }),
  });
  assert.equal(r.status, 200);
  const p = await attendrePush(n);
  const charge = dechiffrer(p.corps);
  assert.equal(charge.t, '📣 Frutiparc');
  assert.match(charge.c, /Grand tournoi Frutibandas/);
  assert.equal(charge.u, '/light?ouvre=evenements');
});

test('le bouton « tester » sonne même connecté', async () => {
  const n = recus.length;
  const r = await jpost('/api/push/test', { sid: sidDest });
  assert.equal(r.ok, true);
  const p = await attendrePush(n);
  const charge = dechiffrer(p.corps);
  assert.match(charge.c, /notifications fonctionnent/i);
});

// ── La présence par FRAÎCHEUR : le vrai téléphone ─────────────────────────
// Sur un vrai téléphone, l'appli en arrière-plan garde sa socket ouverte des
// heures — et avant, cette socket zombie suffisait à étouffer TOUTES les
// notifications (« je ne reçois rien alors qu'elles sont activées »). Deux
// parades, testées ici : le signal explicite <e h="1"/> quand l'appli passe
// derrière, et l'expiration de fraîcheur quand une socket se tait.

test("l'appli passe en arrière-plan (<e h=\"1\"/>) : la socket vit, le téléphone sonne quand même", async () => {
  const sockDest = await brancher(DEST, sidDest);
  // Au premier plan : silence (l'écran montre déjà tout).
  let n = recus.length;
  await jpost('/api/light/mail/send', { sid: sidExp, to: DEST, subject: 'Premier plan', body: 'Rien ne doit sonner.' });
  await wait(800);
  assert.equal(recus.length, n, 'présent au premier plan : silence');
  // Le téléphone est rangé : l'appli le signale avant d'être gelée.
  sockDest.write('<e h="1" />\0');
  await wait(300);
  n = recus.length;
  await jpost('/api/light/mail/send', { sid: sidExp, to: DEST, subject: 'Dans la poche', body: 'Là, ça doit sonner.' });
  const p = await attendrePush(n);
  const charge = dechiffrer(p.corps);
  assert.equal(charge.t, '📬 Nouveau courrier');
  assert.match(charge.c, /Dans la poche/);
  // Retour au premier plan : le silence revient.
  sockDest.write('<e h="0" />\0');
  await wait(300);
  n = recus.length;
  await jpost('/api/light/mail/send', { sid: sidExp, to: DEST, subject: 'De retour', body: 'Silence à nouveau.' });
  await wait(800);
  assert.equal(recus.length, n, 'revenu au premier plan : plus de doublon');
  sockDest.destroy();
  await wait(300);
});

test('un défi Frutibandas sonne sur le téléphone du défié parti en arrière-plan', async () => {
  // Les deux joueurs entrent au salon Frutibandas par leur socket de chat.
  const sExp = await brancher(EXP, sidExp);
  const sDest = await brancher(DEST, sidDest);
  sExp.write(`<bd a="hello" n="${EXP}" f="${'0'.repeat(24)}" />\0`);
  sDest.write(`<bd a="hello" n="${DEST}" f="${'0'.repeat(24)}" />\0`);
  await attendreTrame(sExp, /<bd e="lobby"/);
  await attendreTrame(sDest, /<bd e="lobby"/);
  // Le défié range son téléphone — sa place au salon reste, sa présence non.
  sDest.write('<e h="1" />\0');
  await wait(300);
  const n = recus.length;
  // Défier lance la partie SUR-LE-CHAMP (pas de fenêtre d'acceptation) : c'est
  // exactement le moment où le téléphone doit prévenir — l'horloge tourne.
  sExp.write(`<bd a="challenge" u="${DEST}" />\0`);
  const p = await attendrePush(n);
  const charge = dechiffrer(p.corps);
  assert.match(charge.t, /te défie/, 'le titre annonce le défi : ' + charge.t);
  assert.match(charge.t, new RegExp(EXP, 'i'), 'et nomme le défieur');
  assert.match(charge.c, /Frutibandas/);
  assert.equal(charge.u, '/light?ouvre=bandas', 'le clic mène à la table');
  sExp.write('<bd a="part" />\0');
  sDest.write('<bd a="part" />\0');
  await wait(200);
  sExp.destroy(); sDest.destroy();
  await wait(300);
});

test("l'état du push explique la présence et journalise les décisions", async () => {
  const etat = await (await fetch(`${BASE}/api/push/etat?sid=${sidDest}&endpoint=${encodeURIComponent(abonnement('/push/tel1').endpoint)}`)).json();
  assert.equal(etat.ok, true);
  assert.ok(etat.appareils >= 1, 'au moins un appareil abonné');
  assert.equal(typeof etat.joignable, 'boolean');
  assert.ok(etat.fenetreFraicheurS > 0, 'la fenêtre de fraîcheur est annoncée');
  assert.ok(Array.isArray(etat.decisions) && etat.decisions.length > 0, 'le journal des décisions existe');
  const defi = etat.decisions.filter((d) => d.type === 'defi_bandas').pop();
  assert.ok(defi && defi.envoye === true, 'le défi envoyé est journalisé : ' + JSON.stringify(etat.decisions.slice(-4)));
  const doublon = etat.decisions.filter((d) => d.envoye === false).pop();
  assert.ok(doublon && /présent/.test(doublon.raison), 'les suppressions disent pourquoi');
});

test('une socket MUETTE finit par compter pour absente : le courrier sonne malgré elle', async () => {
  // Le cas où le téléphone n'a pas pu prévenir (appli tuée net, tunnel…) : la
  // socket reste ouverte mais ne dit plus rien. Passé la fenêtre de fraîcheur,
  // elle ne vaut plus présence. Serveur dédié à fenêtre courte (1,2 s).
  const PORT2 = 3516, SOCK2 = 5278, BASE2 = `http://127.0.0.1:${PORT2}`;
  const proc2 = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT2), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE_ADMIN, XMLSOCKET_PORT: String(SOCK2), FRUTISCORE_PORT: String(SOCK2 + 1),
      NODE_TLS_REJECT_UNAUTHORIZED: '0', PRESENCE_FRESH_MS: '1200',
    }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let pret = false;
    for (let i = 0; i < 160 && !pret; i++) {
      try { if ((await fetch(BASE2 + '/do/prefdef')).ok) pret = true; } catch { /* pas prêt */ }
      if (!pret) await wait(250);
    }
    assert.ok(pret, 'serveur à fenêtre courte indisponible');
    const inscrire = async (pseudo) => {
      const body = JSON.stringify({ username: pseudo, password: 'secret123' });
      await fetch(BASE2 + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      return (await (await fetch(BASE2 + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json()).sid;
    };
    const sidZ = await inscrire('zombie' + RUN);
    const sidV = await inscrire('vif' + RUN);
    const ab = await fetch(BASE2 + '/api/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sidZ, subscription: abonnement('/push/tel-zombie') }),
    });
    assert.equal((await ab.json()).ok, true);
    // La socket s'identifie… puis se TAIT (l'appli a été gelée sans prévenir).
    const sockZ = await new Promise((resolve, reject) => {
      const s = net.connect(SOCK2, '127.0.0.1');
      sockets.push(s);
      s.on('error', reject);
      s.on('connect', () => { s.write(`<k l="zombie${RUN}" s="${sidZ}" lc="1" />\0`); setTimeout(() => resolve(s), 400); });
    });
    await wait(1600);   // la fenêtre (1,2 s) expire — la socket est toujours ouverte
    const n = recus.length;
    const envoi = await fetch(BASE2 + '/api/light/mail/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sidV, to: 'zombie' + RUN, subject: 'À travers la socket zombie', body: 'Le téléphone doit sonner.' }),
    });
    assert.equal((await envoi.json()).ok, true);
    const p = await attendrePush(n);
    const charge = dechiffrer(p.corps);
    assert.equal(charge.t, '📬 Nouveau courrier');
    assert.match(charge.c, /À travers la socket zombie/);
    sockZ.destroy();
  } finally {
    proc2.kill('SIGKILL');
  }
});

test('un abonnement mort (410) est retiré au fil de l\'eau', async () => {
  reponsePush = 410;
  await jpost('/api/push/test', { sid: sidDest });
  await wait(600);
  reponsePush = 201;
  const etat = await (await fetch(`${BASE}/api/push/etat?sid=${sidDest}&endpoint=${encodeURIComponent(abonnement('/push/tel1').endpoint)}`)).json();
  assert.equal(etat.actif, false, 'le serveur a fait le ménage');
  const n = recus.length;
  await jpost('/api/push/test', { sid: sidDest });
  await wait(500);
  assert.equal(recus.length, n, 'et il n\'essaie plus cet appareil');
});

test('se désabonner retire l\'appareil', async () => {
  const sub = abonnement('/push/tel2');
  await jpost('/api/push/subscribe', { sid: sidDest, subscription: sub });
  await jpost('/api/push/unsubscribe', { sid: sidDest, endpoint: sub.endpoint });
  const etat = await (await fetch(`${BASE}/api/push/etat?sid=${sidDest}&endpoint=${encodeURIComponent(sub.endpoint)}`)).json();
  assert.equal(etat.actif, false);
});
