'use strict';
/*
 * RGPD — CE QUE LE JOUEUR PEUT FAIRE SEUL, ET CE QUE LE TEMPS EFFACE
 *
 * Un serveur avec sa base, et l'on joue le parcours d'un joueur qui exerce ses
 * droits sans écrire à personne :
 *
 *   · l'INSCRIPTION demande la date de naissance, et l'accord d'un parent
 *     sous quinze ans (art. 8) ;
 *   · l'EXPORT (art. 15 et 20) rend un JSON, table par table, sans le mot de
 *     passe ;
 *   · la SUPPRESSION (art. 17) veut le code secret, tue les sessions, laisse
 *     sept jours ; se reconnecter annule ; passé le délai, le balayage efface —
 *     et ce que les autres ont de lui prend la pierre tombale ;
 *   · l'ÂGE : les autres ne voient que l'âge, et rien avant dix-huit ans ; la
 *     date de naissance ne sort plus des trames de présence ;
 *   · les PURGES : l'IP et le jeton d'inscription au bout de six mois, les
 *     journaux de modération au bout d'un an — et un compte inactif depuis
 *     trois ans disparaît.
 *
 * Et, par le code : YouTube n'est chargé qu'au clic, sans cookie.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3467;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-rgpd';
const DB = process.env.TEST_DATABASE_URL_RGPD || 'postgres://postgres@127.0.0.1:5433/frutiparc_rgpd';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };
const ADMIN = Object.assign({ 'x-admin-key': CLE }, H);

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
async function sql(q, params) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5206', FRUTISCORE_PORT: '5207',
      RGPD_RESPONSABLE: 'Association Test', RGPD_CONTACT: 'rgpd@example.test',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const rows = await sql(`SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'deletion_requested_at'`);
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const post = (url, body, headers) => fetch(BASE + url, { method: 'POST', headers: headers || H, body: JSON.stringify(body) });
async function inscrire(pseudo, extra) {
  const body = Object.assign({ username: pseudo, password: 'secret123', birthday: '1990-05-15' }, extra || {});
  const r = await post('/api/auth/register', body);
  return { status: r.status, json: await r.json() };
}
async function connecter(pseudo) {
  const r = await post('/api/auth/login', { username: pseudo, password: 'secret123', birthday: '1990-05-15' });
  return { status: r.status, json: await r.json() };
}

// ── L'inscription ─────────────────────────────────────────────────────────

test('sans date de naissance, pas de compte', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const r = await post('/api/auth/register', { username: 'sansdate', password: 'secret123' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await r.json()).error, 'birthday_invalid');
  const futur = await inscrire('futur', { birthday: '2999-01-01' });
  assert.strictEqual(futur.status, 400, 'une naissance dans le futur n’est pas une naissance');
});

test('sous quinze ans, l’accord d’un parent — et il est horodaté', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const an = new Date().getFullYear() - 12;
  const sans = await inscrire('enfant', { birthday: `${an}-06-01` });
  assert.strictEqual(sans.status, 400);
  assert.strictEqual(sans.json.error, 'parental_consent_required');
  const avec = await inscrire('enfant', { birthday: `${an}-06-01`, parental_consent: true });
  assert.strictEqual(avec.status, 200, JSON.stringify(avec.json));
  // `birthday` est une colonne DATE : pg la rend en objet Date.
  const [row] = await sql(`SELECT to_char(birthday, 'YYYY-MM-DD') AS naissance, parent_consent_at FROM users WHERE username = 'enfant'`);
  assert.ok(row.parent_consent_at, 'la date de l’accord est gardée : c’est la preuve');
  assert.strictEqual(row.naissance, `${an}-06-01`);
  // Un adulte n'a pas d'accord parental, même s'il coche la case.
  const adulte = await inscrire('adulte', { parental_consent: true });
  assert.strictEqual(adulte.status, 200);
  const [a] = await sql(`SELECT parent_consent_at FROM users WHERE username = 'adulte'`);
  assert.strictEqual(a.parent_consent_at, null);
});

test('la colonne birthday n’a plus de valeur inventée par défaut', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const [c] = await sql(`SELECT column_default FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'birthday'`);
  assert.strictEqual(c.column_default, null, 'plus de 1990-05-15 posé d’office');
});

// ── L'âge, vu des autres ──────────────────────────────────────────────────

test('les autres voient l’âge, pas la date ; et rien avant dix-huit ans', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await inscrire('regardeur');
  await inscrire('adulte');                       // déjà là si le test d'avant a tout fait
  const moi = (await connecter('regardeur')).json.sid;
  // L'adulte : l'âge, sans la date.
  const fa = await (await fetch(`${BASE}/api/light/fiche?sid=${moi}&u=adulte`)).json();
  assert.strictEqual(fa.basic.age, new Date().getFullYear() - 1990 - (new Date() < new Date(`${new Date().getFullYear()}-05-15`) ? 1 : 0));
  assert.strictEqual(fa.perso.anniversaire, null, 'la date de naissance ne sort pas');
  // L'enfant : ni l'un ni l'autre.
  const fe = await (await fetch(`${BASE}/api/light/fiche?sid=${moi}&u=enfant`)).json();
  assert.strictEqual(fe.basic.age, null);
  assert.strictEqual(fe.perso.anniversaire, null);
  // Soi-même : tout.
  const sidE = (await connecter('enfant')).json.sid;
  const fs2 = await (await fetch(`${BASE}/api/light/fiche?sid=${sidE}&u=enfant`)).json();
  assert.strictEqual(fs2.basic.age, 12);
  assert.match(String(fs2.perso.anniversaire), /-06-01$/);
});

test('les trames de présence ne portent plus la date de naissance', () => {
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(!/bd="\$\{ud\.birthday/.test(srv), 'plus aucun `bd` tiré de la colonne brute');
  assert.ok(!/getFrutizBirthday\(ud/.test(srv.replace(/function getFrutizBirthday[\s\S]*?\n\}/, '')),
    'plus aucune trame ne passe par getFrutizBirthday');
  assert.ok((srv.match(/bd="\$\{bdPublicXml\(ud\)\}"/g) || []).length >= 5, 'toutes par bdPublicXml');
  // bdPublic : rien sous dix-huit ans, une date fabriquée au-dessus.
  assert.match(srv, /if \(age === null \|\| age < AGE_VISIBLE_DES\) return '';/);
  assert.match(srv, /const AGE_VISIBLE_DES = 18;/);
  assert.match(srv, /const AGE_MAJORITE_NUMERIQUE = 15;/);
});

// ── L'export ──────────────────────────────────────────────────────────────

test('« Télécharger mes données » : tout, table par table, sans le mot de passe', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await inscrire('adulte');
  const sid = (await connecter('adulte')).json.sid;
  const r = await fetch(`${BASE}/api/light/mes-donnees?sid=${sid}`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /attachment; filename="frutiparc-adulte-\d{4}-\d{2}-\d{2}\.json"/);
  const j = await r.json();
  assert.strictEqual(j.pseudo, 'adulte');
  assert.ok(j.compte && j.compte.username === 'adulte');
  assert.strictEqual(j.compte.password, undefined, 'jamais le mot de passe, même haché');
  for (const k of ['inventaire', 'scores', 'courrier', 'forum_messages', 'contacts', 'sanctions', 'notifications', 'sessions', 'achats'])
    assert.ok(Array.isArray(j[k]), 'la section ' + k + ' est là');
  assert.ok(j.sessions.length >= 1, 'la session ouverte à l’instant y figure');
  // Une fois par minute.
  assert.strictEqual((await fetch(`${BASE}/api/light/mes-donnees?sid=${sid}`)).status, 429);
  // Et jamais sans session.
  assert.strictEqual((await fetch(`${BASE}/api/light/mes-donnees`)).status, 401);
});

// ── La suppression ────────────────────────────────────────────────────────

test('supprimer son compte : le code secret, sept jours, et se reconnecter annule', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await inscrire('partant');
  const sid = (await connecter('partant')).json.sid;
  // Sans le bon code secret, rien.
  const faux = await post('/api/light/compte/suppression', { sid, password: 'mauvais' });
  assert.strictEqual(faux.status, 401);
  // Avec : la demande est posée, et la session tombe.
  const ok = await post('/api/light/compte/suppression', { sid, password: 'secret123' });
  assert.strictEqual(ok.status, 200);
  const j = await ok.json();
  assert.strictEqual(j.graceJours, 7);
  assert.strictEqual((await fetch(`${BASE}/api/light/mes-donnees?sid=${sid}`)).status, 401, 'la session est morte');
  const [row] = await sql(`SELECT deletion_requested_at FROM users WHERE username = 'partant'`);
  assert.ok(row.deletion_requested_at, 'la demande est datée');
  // Se reconnecter annule — et le dit.
  const re = await connecter('partant');
  assert.strictEqual(re.json.suppressionAnnulee, true);
  const [apres] = await sql(`SELECT deletion_requested_at FROM users WHERE username = 'partant'`);
  assert.strictEqual(apres.deletion_requested_at, null);
});

test('passé le délai, le balayage efface — et anonymise ce qui reste', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await inscrire('ephemere');
  await inscrire('lecteur');
  const sid = (await connecter('ephemere')).json.sid;
  // Une trace de lui chez les autres : un sujet de forum, une lecture, un
  // contact dans le carnet de « lecteur », un achat, une sanction.
  await sql(`INSERT INTO forum_categories (name, sort_order) VALUES ('Cat', 0) ON CONFLICT DO NOTHING`).catch(() => {});
  const [cat] = await sql(`SELECT id FROM forum_categories LIMIT 1`).catch(() => [null]);
  let topicId = null;
  if (cat) {
    const [board] = await sql(`INSERT INTO forum_boards (category_id, name, sort_order) VALUES ($1, 'B', 0) RETURNING id`, [cat.id]);
    const [topic] = await sql(`INSERT INTO forum_topics (board_id, author_username, title, last_post_by) VALUES ($1, 'ephemere', 'Bonjour', 'ephemere') RETURNING id`, [board.id]);
    topicId = topic.id;
    await sql(`INSERT INTO forum_posts (topic_id, author_username, content) VALUES ($1, 'ephemere', 'salut')`, [topicId]);
    await sql(`INSERT INTO forum_topic_reads (username, topic_id, read_at) VALUES ('ephemere', $1, now())`, [topicId]).catch(() => {});
  }
  const [lecteur] = await sql(`SELECT id FROM users WHERE username = 'lecteur'`);
  await sql(`INSERT INTO contacts (user_id, contact_name, folder) VALUES ($1, 'ephemere@frutiparc.com', 'mycontact')`, [lecteur.id]);
  await sql(`INSERT INTO shop_purchases (username, pack_id, pack_name, category, price) VALUES ('ephemere', 101, 'Bonnet', 'Accessoires', 60)`);
  await sql(`INSERT INTO moderation_logs (target_username, moderator, action, detail) VALUES ('ephemere', 'lecteur', 'kick', 'test')`);

  await post('/api/light/compte/suppression', { sid, password: 'secret123' });
  // On avance l'horloge : la demande date de huit jours.
  await sql(`UPDATE users SET deletion_requested_at = now() - interval '8 days' WHERE username = 'ephemere'`);
  const r = await post('/api/admin/rgpd/balayage', {}, ADMIN);
  assert.strictEqual(r.status, 200);
  const { bilan } = await r.json();
  assert.strictEqual(bilan.suppressions, 1, JSON.stringify(bilan));

  assert.strictEqual((await sql(`SELECT 1 FROM users WHERE username = 'ephemere'`)).length, 0, 'le compte n’est plus');
  assert.strictEqual((await sql(`SELECT 1 FROM deleted_usernames WHERE username = 'ephemere'`)).length, 1, 'le pseudo est réservé');
  if (topicId) {
    const [tp] = await sql(`SELECT author_username, last_post_by FROM forum_topics WHERE id = $1`, [topicId]);
    assert.strictEqual(tp.author_username, 'compte_supprime');
    assert.strictEqual(tp.last_post_by, 'compte_supprime');
    const [po] = await sql(`SELECT author_username, content FROM forum_posts WHERE topic_id = $1`, [topicId]);
    assert.strictEqual(po.author_username, 'compte_supprime', 'le message reste, l’auteur non');
    assert.strictEqual(po.content, 'salut');
    assert.strictEqual((await sql(`SELECT 1 FROM forum_topic_reads WHERE username = 'ephemere'`)).length, 0);
  }
  assert.strictEqual((await sql(`SELECT 1 FROM contacts WHERE contact_name LIKE 'ephemere%'`)).length, 0, 'retiré du carnet des autres');
  const [achat] = await sql(`SELECT username FROM shop_purchases WHERE pack_id = 101`);
  assert.strictEqual(achat.username, 'compte_supprime');
  const [sanction] = await sql(`SELECT target_username FROM moderation_logs WHERE action = 'kick'`);
  assert.strictEqual(sanction.target_username, 'compte_supprime');
  // Et le pseudo réservé ne se réinscrit pas.
  const re = await inscrire('ephemere');
  assert.strictEqual(re.status, 409);
});

// ── Les purges ────────────────────────────────────────────────────────────

test('l’IP et le jeton d’inscription tombent au bout de six mois, les sanctions au bout d’un an', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await inscrire('vieux', { device_token: 'jetonABC' });
  await sql(`UPDATE users SET register_ip = '203.0.113.9', created_at = now() - interval '200 days', device_token_at = now() - interval '200 days' WHERE username = 'vieux'`);
  await sql(`INSERT INTO moderation_logs (target_username, moderator, action, detail, created_at) VALUES ('vieux', 'lecteur', 'warn', 'ancien', now() - interval '400 days')`);
  await sql(`INSERT INTO moderation_logs (target_username, moderator, action, detail) VALUES ('vieux', 'lecteur', 'warn', 'recent')`);
  const { bilan } = await (await post('/api/admin/rgpd/balayage', {}, ADMIN)).json();
  assert.ok(bilan.ip >= 1 && bilan.jetons >= 1, JSON.stringify(bilan));
  const [v] = await sql(`SELECT register_ip, device_token FROM users WHERE username = 'vieux'`);
  assert.strictEqual(v.register_ip, '');
  assert.strictEqual(v.device_token, '');
  const restes = await sql(`SELECT detail FROM moderation_logs WHERE target_username = 'vieux' ORDER BY detail`);
  assert.deepStrictEqual(restes.map((r) => r.detail), ['recent'], 'l’ancienne sanction est purgée, la récente reste');
});

test('un compte sans connexion depuis trois ans disparaît — un préavis avant, s’il a un e-mail', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await inscrire('dormeur');
  await inscrire('dormeurmail', { email: 'dormeur@example.test' });
  await sql(`UPDATE users SET last_login = now() - interval '1100 days' WHERE username IN ('dormeur', 'dormeurmail')`);
  const { bilan } = await (await post('/api/admin/rgpd/balayage', {}, ADMIN)).json();
  assert.ok(bilan.inactifs >= 1, JSON.stringify(bilan));
  assert.strictEqual((await sql(`SELECT 1 FROM users WHERE username = 'dormeur'`)).length, 0, 'sans e-mail, effacé');
  // Avec un e-mail : le préavis doit PARTIR avant l'effacement. Sans clé
  // Resend, il ne part pas — et le compte reste, on ne fait pas semblant.
  assert.strictEqual((await sql(`SELECT 1 FROM users WHERE username = 'dormeurmail'`)).length, 1,
    'avec un e-mail et sans envoi possible, le compte attend');
});

// ── YouTube ───────────────────────────────────────────────────────────────

test('le blindtest : youtube-nocookie, et le lecteur chargé au clic seulement', () => {
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  const ruffle = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');
  assert.match(srv, /https:\/\/www\.youtube-nocookie\.com\/embed\//);
  assert.ok(!/https:\/\/www\.youtube\.com\/embed\//.test(srv));
  for (const [nom, src] of [['light', light], ['ruffle', ruffle]]) {
    assert.ok(!/"https:\/\/www\.youtube\.com"/.test(src), nom + ' : plus d’origine youtube.com');
    assert.ok(/"https:\/\/www\.youtube-nocookie\.com"/.test(src), nom + ' : l’origine nocookie');
  }
  // Light : le lecteur ne part qu'avec un consentement déjà donné, sinon au clic.
  assert.match(light, /if \(blindtest\.arme\) lancerCadre\(false\);/);
  assert.match(light, /if \(!btLecteur\(\)\) \{\s*\n\s*\/\/ Pas de lecteur[\s\S]*?lancerCadre\(true\);/);
  // Couper retire le lecteur — plus rien ne part.
  assert.match(light, /try \{ localStorage\.removeItem\("fp_bt_son"\); \} catch \(e\) \{\}\s*\n\s*\/\/ Couper, c'est retirer son consentement[\s\S]*?btRetirerCadre\(\);/);
  // Bureau : pareil.
  assert.match(ruffle, /if \(etat\.arme\) cadre\(false\);/);
  assert.match(ruffle, /if \(!document\.querySelector\("#bt-b-cadre iframe"\)\) cadre\(true\);/);
});

// ── La politique et les réglages ──────────────────────────────────────────

test('la politique nomme le responsable, les tiers, les durées et la CNIL', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const page = await (await fetch(BASE + '/confidentialite')).text();
  assert.match(page, /Association Test/, 'RGPD_RESPONSABLE');
  assert.match(page, /rgpd@example\.test/, 'RGPD_CONTACT');
  for (const mot of ['Base légale', 'youtube-nocookie', 'Resend', 'CNIL', '3 ans', '24 heures', '6 mois', 'moins de 15 ans', 'Télécharger mes données', 'Supprimer mon compte'])
    assert.ok(page.includes(mot), 'la politique parle de : ' + mot);
});

test('les réglages de l’appli offrent l’export et la suppression', () => {
  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(light, /<div class="reg-titre">Mes données<\/div>/);
  assert.match(light, /id="reg-export-btn"/);
  assert.match(light, /id="reg-suppr-btn"/);
  assert.match(light, /window\.location\.href = "\/api\/light\/mes-donnees\?sid=" \+ encodeURIComponent\(state\.sid\);/);
  assert.match(light, /fetch\("\/api\/light\/compte\/suppression", \{/);
  // L'inscription : la date de naissance, et la case parentale sous quinze ans.
  assert.match(light, /<input type="date" id="re-naissance" autocomplete="bday" required>/);
  assert.match(light, /if \(age < 15 && !accord\) \{/);
  assert.match(light, /if \(age < 15\) body\.parental_consent = true;/);
});
