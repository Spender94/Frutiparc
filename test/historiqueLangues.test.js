'use strict';
/*
 * L'HISTORIQUE, LES NOTIFICATIONS, LES COURRIELS ET LES PERSONNAGES DU FORUM
 * DANS LA LANGUE DE CHACUN (étape 3b).
 *
 * Ce que le serveur RANGE (l'historique, l'Historique Kikooz) ou POUSSE (les
 * notifications du téléphone, les courriels) se lit dans la langue de son
 * destinataire. Deux comptes, l'un anglais, l'autre français :
 *
 *   · un même événement d'historique (un cadeau de l'admin) arrive à chacun
 *     dans sa langue — en direct (la trame <aw>) et dans /api/light/history —,
 *     et le bureau Flash d'époque (une socket sans `la` ni `lc`) le reçoit en
 *     français, quelle que soit la langue du compte ;
 *   · l'entrée est rangée en français AVEC sa clé et ses paramètres
 *     (user_logs.msg_key, msg_params) : après un redémarrage, elle se refait
 *     dans la langue du lecteur ;
 *   · l'Historique Kikooz en anglais, y compris une vieille ligne au libellé
 *     français (« la revente de … », « connexion quotidienne »), et le motif
 *     d'une ligne neuve rangé en code ;
 *   · une notification poussée en anglais — y compris vers un absent dont le
 *     compte n'est pas chargé (la langue est rangée avec l'abonnement) : un
 *     faux service de poussée la capture et le test la DÉCHIFFRE ;
 *   · le courriel du code secret oublié en anglais (sujet, texte, HTML) : un
 *     faux service d'envoi (RESEND_API_URL) le capture au lieu de l'envoyer ;
 *   · Natacha souhaite la bienvenue en anglais au nouveau anglophone ;
 *   · Dimitri poste UN message à deux langues, et le complète en le
 *     modifiant (la mise à jour sous chaque moitié) ; le titre du
 *     Prunostiqueur du mois est rangé en code et dit dans la langue du lecteur ;
 *   · VieuxPruneau poste la map du jour en deux langues, et sa marque de
 *     graine, restée dans le français, l'empêche de la reposter au redémarrage.
 *
 * PostgreSQL de test requis (port 5433), sinon le fichier s'efface.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 5144;
const SOCKET_PORT = 5145;
const FAUX_PUSH_PORT = 5147;
const FAUX_MAIL_PORT = 5148;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-historique-langues';
const DB = process.env.TEST_DATABASE_URL_HISTOLANGUES || 'postgres://postgres@127.0.0.1:5433/frutiparc_histolangues';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-histolangues-'));
const RUN = Date.now().toString(36).slice(-4);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };
const ADMIN = Object.assign({ 'x-admin-key': CLE }, H);

const EN = 'lgen' + RUN;          // le compte anglais
const FR = 'lgfr' + RUN;          // le compte français (une consonne en tête : « de lgfr… »)

// Le certificat du faux service de poussée (le même que test/appliMobile).
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

let proc = null, dispo = false, journal = '';
let fauxPush = null, fauxMail = null;
const pousses = [];               // ce que le « téléphone » reçoit
const courriels = [];             // ce que le faux service d'envoi reçoit

// ── Le téléphone simulé : sa paire P-256, son secret ────────────────────────
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const AUTH_SECRET = crypto.randomBytes(16);
const abonnement = (chemin) => ({
  endpoint: `https://127.0.0.1:${FAUX_PUSH_PORT}${chemin}`,
  keys: { p256dh: Buffer.from(ecdh.getPublicKey()).toString('base64url'), auth: AUTH_SECRET.toString('base64url') },
});
// RFC 8291 (aes128gcm) : ce que fait le navigateur avant de réveiller le service worker.
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

async function baseNeuve() {
  let Client;
  try { ({ Client } = require(path.join(ROOT, 'node_modules', 'pg'))); } catch { return false; }
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
async function sql(q, params) {
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}

async function lancer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: String(SOCKET_PORT), FRUTISCORE_PORT: String(SOCKET_PORT + 1),
      FRUTI_DATA_DIR: DONNEES,
      // Les courriels partent vers le faux service d'envoi, pas vers Resend.
      RESEND_API_KEY: 'cle-de-test', RESEND_API_URL: `http://127.0.0.1:${FAUX_MAIL_PORT}/emails`,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',     // le certificat du faux service de poussée
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { journal += d; });
  proc.stderr.on('data', (d) => { journal += d; });
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(BASE + '/do/prefdef')).ok
        && (await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'challenge_paris'`)).length
        && (await (await fetch(BASE + '/api/push/cle')).json()).ok) return;
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible\n' + journal.slice(-2000));
}
async function arreter() {
  if (!proc) return;
  const p = proc;
  proc = null;
  await new Promise((r) => { p.once('exit', r); p.kill('SIGKILL'); });
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  fauxPush = https.createServer({ key: TLS_KEY, cert: TLS_CERT }, (req, res) => {
    const m = [];
    req.on('data', (c) => m.push(c));
    req.on('end', () => { pousses.push({ url: req.url, corps: Buffer.concat(m) }); res.statusCode = 201; res.end(); });
  });
  fauxMail = http.createServer((req, res) => {
    const m = [];
    req.on('data', (c) => m.push(c));
    req.on('end', () => {
      try { courriels.push(JSON.parse(Buffer.concat(m).toString('utf8'))); } catch { /* illisible */ }
      res.setHeader('Content-Type', 'application/json');
      res.end('{"id":"capture"}');
    });
  });
  await new Promise((r) => fauxPush.listen(FAUX_PUSH_PORT, '127.0.0.1', r));
  await new Promise((r) => fauxMail.listen(FAUX_MAIL_PORT, '127.0.0.1', r));
  await lancer();
});
after(async () => {
  await arreter();
  if (fauxPush) fauxPush.close();
  if (fauxMail) fauxMail.close();
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body, headers) => fetch(BASE + url, { method: 'POST', headers: headers || H, body: JSON.stringify(body) }).then((r) => r.json());
const sids = {};
async function inscrire(pseudo, lang) {
  const r = await post('/api/auth/register', { username: pseudo, password: 'secret123', email: pseudo + '@exemple.test', lang });
  assert.ok(r.ok, JSON.stringify(r));
  return connecter(pseudo);
}
async function connecter(pseudo) {
  const j = await post('/api/auth/login', { username: pseudo, password: 'secret123' });
  assert.ok(j.sid, 'session pour ' + pseudo);
  sids[pseudo] = j.sid;
  return j.sid;
}

// Une socket : light avec sa langue (`la`), ou sans rien comme le SWF du bureau.
async function socket(pseudo, { la, light = true } = {}) {
  const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
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
  ws.send(`<k l="${pseudo}" s="${sids[pseudo]}"${light ? ' lc="1"' : ''}${la ? ` la="${la}"` : ''} />\0`);
  const s = {
    trames,
    attendre: async (pred, quoi, ms = 6000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(-1500)}`);
    },
    fermer: () => new Promise((r) => { ws.once('close', r); try { ws.close(); } catch { r(); } }),
  };
  await s.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return s;
}
const corpsAw = (xml) => xml.replace(/^<aw[^>]*>/, '').replace(/<\/aw>$/, '')
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const historique = async (pseudo) => (await (await fetch(`${BASE}/api/light/history?sid=${sids[pseudo]}`)).json()).events.map((e) => e.text);
const kikooz = async (pseudo) => (await (await fetch(`${BASE}/api/light/kikooz?sid=${sids[pseudo]}`)).json()).events.map((e) => e.text);
const evenements = async (pseudo) => (await (await fetch(`${BASE}/api/light/events?sid=${sids[pseudo]}`)).json()).events.map((e) => e.text);

const CADEAU_FR = "Un cadeau pour toi ! L'accessoire Masque de ski t'attend dans ton inventaire.";
const CADEAU_EN = 'A gift for you! The Masque de ski accessory is waiting in your inventory.';

// ── 1. Natacha, puis un même événement d'historique pour deux lecteurs ──────

test('Natacha accueille chacun dans sa langue', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await inscrire(EN, 'en');
  await inscrire(FR, 'fr');
  const motNatacha = async (pseudo) => {
    for (let i = 0; i < 60; i++) {
      const r = await sql(`SELECT content FROM forum_posts WHERE author_username = 'natacha' AND content LIKE $1`, ['%@' + pseudo + '%']);
      if (r.length) return r[0].content;
      await wait(150);
    }
    throw new Error('pas de mot de Natacha pour ' + pseudo);
  };
  const Natacha = require(path.join(ROOT, 'natacha.js'));
  const anglais = require(path.join(ROOT, 'i18n-serveur', 'en', 'forumbots.js'));
  const ouverturesEn = Object.keys(anglais).filter((k) => k.startsWith('forumbots.natacha.ouverture.'))
    .map((k) => anglais[k].replace('{qui}', '@' + EN));
  const motEn = await motNatacha(EN);
  assert.ok(ouverturesEn.some((o) => motEn.startsWith(o)), 'une ouverture anglaise : ' + motEn);
  assert.ok(!Natacha.OUVERTURES.some((f) => motEn.startsWith(f('@' + EN))), 'pas française');
  const motFr = await motNatacha(FR);
  assert.ok(Natacha.OUVERTURES.some((f) => motFr.startsWith(f('@' + FR))), 'une ouverture française : ' + motFr);
  // Le sujet garde son titre français : c'est par lui qu'on le retrouve.
  const sujets = await sql(`SELECT t.title FROM forum_topics t JOIN forum_posts p ON p.topic_id = t.id WHERE p.content LIKE $1`, ['%@' + EN + '%']);
  assert.equal(sujets[0].title, Natacha.SUJET);
});

test('un même événement : chacun le lit dans sa langue, en direct et dans /api/light/history ; le bureau Flash en français', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const en = await socket(EN, { la: 'en' });
  const fr = await socket(FR, { la: 'fr' });
  const bureau = await socket(EN, { light: false });     // le SWF : ni `la` ni `lc`
  // L'entrée d'accueil, rejouée à l'ident (non lue), est déjà dans la langue de la socket.
  assert.ok(en.trames.some((x) => x.startsWith('<aw') && corpsAw(x).includes('Welcome to Frutiparc Revival!')), 'accueil en anglais');
  assert.ok(fr.trames.some((x) => x.startsWith('<aw') && corpsAw(x).includes('Bienvenue sur Frutiparc Revival !')), 'accueil en français');
  assert.ok(bureau.trames.some((x) => x.startsWith('<aw') && corpsAw(x).includes('Bienvenue sur Frutiparc Revival !')), 'le bureau en français');

  for (const u of [EN, FR]) {
    const r = await post('/api/admin/donner', { username: u, shopId: 103 }, ADMIN);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  const directEn = await en.attendre((x) => x.startsWith('<aw') && x.includes('Masque de ski'), 'le cadeau, en direct');
  assert.equal(corpsAw(directEn), CADEAU_EN);
  const directFr = await fr.attendre((x) => x.startsWith('<aw') && x.includes('Masque de ski'), 'le cadeau, en direct');
  assert.equal(corpsAw(directFr), CADEAU_FR);
  const directBureau = await bureau.attendre((x) => x.startsWith('<aw') && x.includes('Masque de ski'), 'le cadeau, sur le bureau');
  assert.equal(corpsAw(directBureau), CADEAU_FR, 'le bureau Flash d\'époque reste en français');

  assert.ok((await historique(EN)).includes(CADEAU_EN), 'le light anglais');
  assert.ok((await historique(FR)).includes(CADEAU_FR), 'le light français');
  // Le lecteur peut demander une autre langue que celle de son compte.
  assert.ok((await (await fetch(`${BASE}/api/light/history?sid=${sids[EN]}&lang=fr`)).json()).events.some((e) => e.text === CADEAU_FR));
  // La mention de Natacha aussi.
  assert.ok((await historique(EN)).some((x) => /^You were mentioned on the forum, in "Bienvenue aux nouveaux Frutiz !", by Natacha\.$/.test(x)),
    (await historique(EN)).join(' | '));

  // RANGÉ EN FRANÇAIS, avec sa clé et ses paramètres.
  const rangs = await sql(`SELECT l.content, l.msg_key, l.msg_params FROM user_logs l JOIN users u ON u.id = l.user_id
    WHERE u.username = $1 AND l.content LIKE '%Masque de ski%'`, [EN]);
  assert.deepEqual(rangs.map((x) => [x.content, x.msg_key, x.msg_params]), [[CADEAU_FR, 'historique.cadeau', { nom: 'Masque de ski' }]]);
  for (const s of [en, fr, bureau]) await s.fermer();
});

// ── 2. Les notifications poussées, les courriels ─────────────────────────────

test('une notification poussée part dans la langue du joueur', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const r = await post('/api/push/subscribe', { sid: sids[EN], subscription: abonnement('/push/' + EN) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual((await sql(`SELECT lang FROM push_subscriptions WHERE username = $1`, [EN])).map((x) => x.lang), ['en'],
    'la langue est rangée avec l\'appareil');
  pousses.length = 0;
  await post('/api/push/test', { sid: sids[EN] });
  for (let i = 0; i < 60 && !pousses.length; i++) await wait(100);
  assert.equal(pousses.length, 1);
  const charge = dechiffrer(pousses[0].corps);
  assert.equal(charge.c, 'Notifications are working! You\'ll hear about mail, private messages and events.');
});

test('le courriel du code secret oublié : la langue du compte, sujet, texte et HTML', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  courriels.length = 0;
  for (const u of [EN, FR]) await post('/api/auth/forgot', { email: u + '@exemple.test' });
  for (let i = 0; i < 60 && courriels.length < 2; i++) await wait(100);
  const pour = (u) => courriels.find((c) => (c.to || [])[0] === u + '@exemple.test');
  const en = pour(EN), fr = pour(FR);
  assert.ok(en && fr, 'deux courriels capturés');
  assert.equal(en.subject, 'Frutiparc — reset your secret code');
  assert.match(en.text, new RegExp(`^Hi ${EN}!\\n\\nYou asked to reset your Frutiparc secret code\\.`));
  assert.match(en.text, /\/reset\?token=[0-9a-f]{64}/);
  assert.match(en.html, /Choose a new secret code<\/a>/);
  assert.match(en.html, new RegExp(`<p>Hi <b>${EN}</b>!</p>`));
  assert.doesNotMatch(en.text + en.html, /Salut|code secret/);
  assert.equal(fr.subject, 'Frutiparc — réinitialise ton code secret');
  assert.match(fr.text, new RegExp(`^Salut ${FR} !\\n\\nTu as demandé à réinitialiser ton code secret Frutiparc\\.`));
  assert.match(fr.html, /Choisir un nouveau code secret<\/a>/);
});

// ── 3. Dimitri : un message, deux langues, complété en place ─────────────────

test('Dimitri : le sacre du mois en deux langues, puis complété dans le même message ; le titre se dit dans la langue du lecteur', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const jourParis = (decalageMois) => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    return new Date(Date.UTC(d.getFullYear(), d.getMonth() + decalageMois, 15)).toISOString().slice(0, 7);
  };
  const [m1, m2] = [jourParis(-1), jourParis(-2)];
  const A = 'dima' + RUN, B = 'dimb' + RUN;
  for (const u of [A, B]) { await post('/api/auth/register', { username: u, password: 'secret123' }); await connecter(u); }
  const paris = [[A, m1], [B, m2]];
  for (const [u, mois] of paris) {
    for (let i = 0; i < 3; i++) {
      await sql(`INSERT INTO challenge_paris (jour, jeu, type, username, choix, mise, statut, gain, regle_le) VALUES ($1, 'swapou2_classic', 'podium', $2, $3, 10, 'gagne', 30, now())`,
        [mois + '-10', u, 'choix' + i]);
    }
  }
  const r1 = await post('/api/admin/paris-challenge/mois', { mois: m1 }, ADMIN);
  assert.ok(r1.ok && r1.gagnant && r1.gagnant.username === A, JSON.stringify(r1));
  assert.equal(r1.gagnant.titre, 'Prunostiqueur du mois', 'l\'admin lit le titre en toutes lettres');
  // Le titre est rangé en code…
  assert.equal((await sql(`SELECT frutijob FROM users WHERE username = $1`, [A]))[0].frutijob, '[prunostiqueur]');
  // … et dit dans la langue de qui lit la fiche.
  const fiche = async (lecteur, u) => (await (await fetch(`${BASE}/api/light/fiche?sid=${sids[lecteur]}&u=${u}`)).json()).frutiz.job;
  assert.equal(await fiche(EN, A), 'Prunosticator of the month');
  assert.equal(await fiche(FR, A), 'Prunostiqueur du mois');

  const message = async () => {
    for (let i = 0; i < 60; i++) {
      const memo = (await sql(`SELECT value FROM app_state WHERE key = 'dimitri_message_jour'`))[0];
      if (memo && memo.value) {
        const id = JSON.parse(memo.value).postId;
        const p = (await sql(`SELECT id, content FROM forum_posts WHERE id = $1`, [id]))[0];
        if (p) return p;
      }
      await wait(150);
    }
    throw new Error('pas de message du jour de Dimitri');
  };
  const avant = await message();
  const TRAIT = '\n\n────────────\n[i]';
  assert.equal(avant.content.split(TRAIT).length, 2, 'un seul bloc anglais');
  const [frA, enA] = avant.content.split(TRAIT);
  assert.match(frA, new RegExp(`@${A}, avec \\[b\\]\\+60 kikooz\\[/b\\] de bénéfice en `));
  assert.match(frA, /le titre de \[b\]Prunostiqueur du mois\[\/b\]/);
  assert.match(enA, new RegExp(`@${A}, with \\[b\\]\\+60 kikooz\\[/b\\] profit in `));
  assert.match(enA, /the title of \[b\]Prunosticator of the month\[\/b\]/);
  assert.ok(enA.endsWith('[/i]') && !/\[i\]/.test(enA.slice(0, -4)), 'un bloc en italique, sans italique dedans');

  // Le sacre d'un autre mois, le même jour : il COMPLÈTE le message du jour.
  const r2 = await post('/api/admin/paris-challenge/mois', { mois: m2 }, ADMIN);
  assert.ok(r2.ok && r2.gagnant && r2.gagnant.username === B, JSON.stringify(r2));
  let apres = avant;
  for (let i = 0; i < 60 && apres.content === avant.content; i++) { await wait(150); apres = await message(); }
  assert.equal(apres.id, avant.id, 'le même message, modifié');
  assert.equal(apres.content.split(TRAIT).length, 2, 'toujours un seul bloc anglais, à la fin');
  const [frB, enB] = apres.content.split(TRAIT);
  assert.ok(frB.startsWith(frA.replace(/\s+$/, '')), 'le français d\'avant reste en tête');
  assert.match(frB, /\n\n\[b\]— Mise à jour de \d\d h \d\d —\[\/b\]\n\n/);
  assert.match(frB, new RegExp(`@${B}, avec`));
  assert.ok(enB.startsWith(enA.replace(/\[\/i\]$/, '').replace(/\s+$/, '')), 'l\'anglais d\'avant reste en tête de son bloc');
  assert.match(enB, /\n\n\[b\]— Update at \d\d:\d\d —\[\/b\]\n\n/);
  assert.match(enB, new RegExp(`@${B}, with`));
});

// ── 4. VieuxPruneau : la map du jour, deux langues, une marque ───────────────

const cartesDuJour = () => sql(`SELECT id, content FROM forum_posts WHERE author_username = 'vieuxpruneau' AND content LIKE '%(graine %'`);

test('VieuxPruneau : la map du jour en un message, le français (et sa marque) puis l\'anglais', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Il la poste de lui-même au démarrage (« vérification au démarrage »).
  let cartes = [];
  for (let i = 0; i < 100 && !cartes.length; i++) { cartes = await cartesDuJour(); if (!cartes.length) await wait(200); }
  assert.equal(cartes.length, 1, 'une map, un message');
  const [fr, en, reste] = cartes[0].content.split('\n\n────────────\n[i]');
  assert.equal(reste, undefined, 'un seul bloc anglais');
  assert.match(fr, /^\[b\](La map du jour|Rebelote !)\[\/b\]/);
  assert.match(fr, /\[i\]\(graine \d+ · carte v\d+\)\[\/i\]$/, 'la marque reste au bout du français');
  assert.match(en, /^\[b\](Today's map|Do-over!)\[\/b\]/);
  assert.match(en, /\[b\]The dungeon\[\/b\]: \d+ rooms on 8 × 8/);
  assert.ok(en.endsWith('[/i]') && !/\[\/?i\]/.test(en.slice(0, -4)), 'un bloc en italique, sans italique dedans');
  assert.doesNotMatch(en, /graine|\[img\]/, 'ni la marque ni le plan, déjà dans le français');
});

// ── 5. Après un redémarrage ──────────────────────────────────────────────────

test('après un redémarrage : l\'entrée se refait de sa clé, l\'Historique Kikooz se lit en anglais (vieilles lignes comprises), la notification d\'un absent aussi', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Deux lignes d'AVANT les codes : le libellé français seul.
  const id = (await sql(`SELECT id FROM users WHERE username = $1`, [EN]))[0].id;
  await sql(`INSERT INTO kikooz_log (user_id, entry_type, amount, label, created_at) VALUES ($1, 'c', 7, 'la revente de "Bonnet de nuit"', now() - interval '2 day'),
    ($1, 'c', 12, 'connexion quotidienne', now() - interval '1 day'), ($1, 'c', 5, 'Zazou', now() - interval '3 day')`, [id]);
  // Le motif d'une ligne neuve est rangé en code (la connexion du jour).
  const codes = await sql(`SELECT label, label_key FROM kikooz_log WHERE user_id = $1 AND label_key IS NOT NULL`, [id]);
  assert.ok(codes.some((c) => c.label === 'connexion quotidienne' && c.label_key === 'historique.kikooz.motif.connexion'), JSON.stringify(codes));

  const cartesAvant = (await cartesDuJour()).length;
  await arreter();
  await lancer();

  // L'ABSENT : son compte n'est pas chargé, la langue vient de l'abonnement.
  // L'anniversaire du jour (un événement du site fait d'un gabarit) est fêté
  // chez le français ; l'anglais, absent, reçoit la notification en anglais.
  const mmjj = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', month: '2-digit', day: '2-digit' }).format(new Date());
  await sql(`UPDATE users SET birthday = $2 WHERE username = $1`, [FR, '1995-' + mmjj]);
  pousses.length = 0;
  const a = await post('/api/admin/anniversaires/annoncer', {}, ADMIN);
  assert.ok(a.ok && a.annonce, JSON.stringify(a));
  for (let i = 0; i < 60 && !pousses.length; i++) await wait(100);
  const charge = dechiffrer(pousses.find((p) => p.url === '/push/' + EN).corps);
  assert.equal(charge.c, `🎂 Today is ${FR}'s birthday. Happy birthday!`);
  // L'évènement est rangé en français (la marque 🎂 en tête), avec sa clé.
  const ev = await sql(`SELECT l.content, l.msg_key FROM user_logs l JOIN users u ON u.id = l.user_id WHERE u.username = $1 AND l.log_type = 'site' AND l.content LIKE '🎂%'`, [EN]);
  assert.deepEqual(ev.map((x) => [x.content, x.msg_key]), [[`🎂 Aujourd'hui, c'est l'anniversaire de ${FR}. Joyeux anniversaire !`, 'historique.anniversaire']]);

  await connecter(EN);
  await connecter(FR);
  // L'historique : refait de la clé rangée en base.
  const hEn = await historique(EN), hFr = await historique(FR);
  assert.ok(hEn.includes(CADEAU_EN), hEn.join(' | '));
  assert.ok(hEn.includes('Welcome to Frutiparc Revival! Got nothing better to do, then?!'), hEn.join(' | '));
  assert.ok(hFr.includes(CADEAU_FR), hFr.join(' | '));
  // Les évènements : l'anniversaire, chacun dans sa langue.
  assert.ok((await evenements(EN)).includes(`🎂 Today is ${FR}'s birthday. Happy birthday!`));
  assert.ok((await evenements(FR)).includes(`🎂 Aujourd'hui, c'est l'anniversaire de ${FR}. Joyeux anniversaire !`));
  assert.ok((await evenements(EN)).includes('Event: your Frutiparc Revival account has just been activated.'));

  // L'Historique Kikooz : les vieilles lignes en anglais, le nom d'un joueur tel quel.
  const kEn = await kikooz(EN);
  assert.ok(kEn.includes('7 kikooz from the resale of "Bonnet de nuit".'), kEn.join(' | '));
  assert.ok(kEn.includes('12 kikooz from your daily login.'), kEn.join(' | '));
  assert.ok(kEn.includes('5 kikooz from Zazou.'), kEn.join(' | '));
  // Le français, lui, n'a pas bougé d'un octet.
  const kFr = await (await fetch(`${BASE}/api/light/kikooz?sid=${sids[EN]}&lang=fr`)).json();
  assert.ok(kFr.events.some((e) => e.text === '7 kikooz obtenus par la revente de "Bonnet de nuit".'));
  assert.ok(kFr.events.some((e) => e.text === '12 kikooz obtenus par connexion quotidienne.'));

  // VieuxPruneau relit sa marque dans le message à deux langues : la même map
  // n'est pas reposée (sa vérification passe huit secondes après le démarrage).
  await wait(10000);
  assert.equal((await cartesDuJour()).length, cartesAvant, 'la map du jour n\'est pas reposée');
});
