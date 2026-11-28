'use strict';
/*
 * L'API ET LES CATALOGUES DANS LA LANGUE DE CHACUN — étape 3b de la version
 * anglaise.
 *
 * Deux comptes, l'un inscrit en français, l'autre en anglais (le `lang` du
 * formulaire d'accueil), lisent les mêmes routes ; on compare ce que le serveur
 * leur écrit :
 *   · les messages d'erreur de l'inscription et de la connexion (la langue de
 *     la page, `lang` dans le corps) et d'une route de joueur (le courrier) ;
 *   · les noms des pictos (l'inventaire du light) ;
 *   · la boutique : un article livré avec le code, son rayon, et un article
 *     créé dans l'admin avec son nom anglais (`name_en`, rangé en base) ;
 *   · le tableau des scores et le livre des records ;
 *   · les préférences du light ;
 *   · les quêtes de Gromelin (titres, lignes, niveaux, semaine) ;
 *   · les Prunostics : un pari du Challenge dans le registre, le mois et sa
 *     clé, un refus ;
 *   · une médaille de la fiche (« d'or » / « gold »).
 * Le français, lui, doit sortir à l'octet près comme avant : on l'affirme en
 * toutes lettres.
 *
 * Une base PostgreSQL de test (port 5433) est nécessaire pour les quêtes, les
 * Prunostics et la médaille ; sans elle, ces tests-là sont sautés.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 5210;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-api-langues';
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const DB = process.env.TEST_DATABASE_URL_APILANGUES || 'postgres://postgres@127.0.0.1:5433/frutiparc_apilangues';
const RUN = Date.now().toString(36).slice(-5);
const FR = 'franc' + RUN, EN = 'angl' + RUN;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const P = require('../public/minipixiz/plateforme.js');
let proc = null, avecBase = false, journal = '';
const sids = {};

let Client = null;
try { ({ Client } = require(path.join(ROOT, 'node_modules', 'pg'))); } catch { /* sans pg : sans base */ }
async function baseNeuve() {
  if (!Client) return false;
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
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}

before(async () => {
  avecBase = await baseNeuve();
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: avecBase ? DB : '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5211', FRUTISCORE_PORT: '5212',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { journal += d; });
  proc.stderr.on('data', (d) => { journal += d; });
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(BASE + '/do/prefdef')).ok) {
        if (!avecBase) break;
        // Une base neuve : on attend aussi sa dernière table.
        const t = await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'kikooz_gifts'`);
        if (t.length) break;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  // Les deux comptes : la langue de l'inscription est celle de la page.
  for (const [pseudo, lang] of [[FR, 'fr'], [EN, 'en']]) {
    const r = await post('/api/auth/register', { username: pseudo, password: 'secret123', lang });
    assert.ok(r.ok, JSON.stringify(r) + journal.slice(-2000));
    sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123', lang })).sid;
    assert.ok(sids[pseudo], 'session pour ' + pseudo);
  }
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function post(url, body, headers) {
  const r = await fetch(BASE + url, { method: 'POST', headers: headers || { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const get = async (url, qui) => (await fetch(BASE + url + (url.includes('?') ? '&' : '?') + 'sid=' + encodeURIComponent(sids[qui]))).json();
// Deux lectures, une par compte.
const lesDeux = async (url) => ({ fr: await get(url, FR), en: await get(url, EN) });

test('inscription et connexion : le message dans la langue de la page, le même code', async () => {
  const fr = await post('/api/auth/register', { username: 'a', password: 'secret123', lang: 'fr' });
  const en = await post('/api/auth/register', { username: 'a', password: 'secret123', lang: 'en' });
  assert.deepEqual([fr.error, en.error], ['username_invalid', 'username_invalid']);
  assert.equal(fr.message, 'Pseudo : 3-20 caractères [a-zA-Z0-9_], pas d\'accents.');
  assert.equal(en.message, 'Username: 3-20 characters [a-zA-Z0-9_], no accents.');
  // Le pseudo pris : il disait « Username already taken. » même en français.
  const prisFr = await post('/api/auth/register', { username: FR, password: 'secret123', lang: 'fr' });
  const prisEn = await post('/api/auth/register', { username: FR, password: 'secret123', lang: 'en' });
  assert.deepEqual([prisFr.error, prisFr.message], ['user_exists', 'Ce pseudo est déjà pris.']);
  assert.deepEqual([prisEn.error, prisEn.message], ['user_exists', 'Username already taken.']);
  // La connexion ratée.
  const lfr = await post('/api/auth/login', { username: FR, password: 'mauvais1', lang: 'fr' });
  const len = await post('/api/auth/login', { username: FR, password: 'mauvais1', lang: 'en' });
  assert.deepEqual([lfr.error, len.error], ['invalid_credentials', 'invalid_credentials']);
  assert.equal(lfr.message, 'Pseudo ou code secret incorrect.');
  assert.equal(len.message, 'Wrong username or secret code.');
  // Sans `lang`, l'en-tête du navigateur décide.
  const nav = await fetch(BASE + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en-GB,en;q=0.9' },
    body: JSON.stringify({ username: FR, password: 'mauvais1' }) }).then((r) => r.json());
  assert.equal(nav.message, 'Wrong username or secret code.');
});

test('une route de joueur : le message d’erreur dans la langue du compte', async () => {
  const fr = await post('/api/light/mail/send', { sid: sids[FR], to: '', body: 'coucou' });
  const en = await post('/api/light/mail/send', { sid: sids[EN], to: '', body: 'coucou' });
  assert.deepEqual([fr.ok, en.ok], [false, false]);
  assert.equal(fr.error, 'Indique au moins un destinataire.');
  assert.equal(en.error, 'Enter at least one recipient.');
});

test('les pictos du light : le nom du catalogue en français, l’anglais pour l’anglais', async () => {
  // Deux ramassages en forêt de MiniPixiz, écrits par le code du jeu : le
  // Cœur +1 (objet 10) et le Casque à corne (45).
  for (const qui of [FR, EN]) {
    const carte = P.carteNeuve();
    P.ramasser(carte, 10);
    P.ramasser(carte, 45);
    const r = await fetch(BASE + '/api/saveFrutiSlot', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sids[qui], game: 'minipixiz', slotId: '0', data: JSON.stringify(carte) }) });
    assert.ok(r.ok, 'carte rangée');
  }
  const { fr, en } = await lesDeux('/api/light/inventaire');
  const noms = (d) => d.pictos.map((p) => p.nom);
  assert.deepEqual(noms(fr), ['Cœur +1', 'Casque à corne']);
  assert.deepEqual(noms(en), ['Heart +1', 'Horned helmet']);
  // Le même ordre, les mêmes identifiants et le même jeu (une clé).
  assert.deepEqual(en.pictos.map((p) => [p.id, p.jeu]), fr.pictos.map((p) => [p.id, p.jeu]));
  // Le sélecteur du forum aussi.
  const sel = await lesDeux('/api/pictos');
  assert.deepEqual([sel.fr[0].name, sel.en[0].name], ['Cœur +1', 'Heart +1']);
});

test('la boutique : les articles du code, leurs rayons, et l’anglais saisi dans l’admin', async () => {
  let { fr, en } = await lesDeux('/api/light/shop');
  const art = (d, id) => d.categories.flatMap((c) => c.items).find((i) => i.id === id);
  assert.deepEqual([art(fr, 101).name, art(en, 101).name], ['Bonnet de nuit', 'Nightcap']);
  assert.equal(art(fr, 315).name, 'Feutre orange');
  assert.equal(art(en, 315).name, 'Orange pen');
  // La fiche commune des accessoires.
  assert.match(art(fr, 101).comment, /^Hier, j'ai regardé ma bouille/);
  assert.match(art(en, 101).comment, /^Yesterday I looked at my bouille/);
  // Le rayon : son nom traduit, sa clé en français.
  const rayon = (d) => d.categories.find((c) => c.cle === 'Accessoires');
  assert.deepEqual([rayon(fr).name, rayon(en).name], ['Accessoires', 'Accessories']);
  // Un article créé dans l'admin, avec son anglais.
  const cree = await post('/api/admin/shop', { id: 4242, name: 'Chapeau à plume', name_en: 'Feathered hat', category: 'Accessoires',
    price: 10, suffix9: 'a0b0a0b0c', description: JSON.stringify({ l1: 'Une plume.', l2: '' }),
    description_en: JSON.stringify({ l1: 'A feather.', l2: '' }) }, ADMIN);
  assert.ok(cree.ok, JSON.stringify(cree));
  ({ fr, en } = await lesDeux('/api/light/shop'));
  assert.deepEqual([art(fr, 4242).name, art(en, 4242).name], ['Chapeau à plume', 'Feathered hat']);
  assert.deepEqual([art(fr, 4242).comment, art(en, 4242).comment], ['Une plume.', 'A feather.']);
  // L'anglais est rangé en base, dans ses colonnes.
  if (avecBase) {
    let row = null;
    for (let i = 0; i < 40 && !row; i++) { row = (await sql('SELECT name, name_en, description_en FROM shop_packs WHERE id = 4242'))[0]; if (!row) await wait(100); }
    assert.deepEqual([row.name, row.name_en], ['Chapeau à plume', 'Feathered hat']);
    assert.equal(JSON.parse(row.description_en).l1, 'A feather.');
  }
  // Acheté : l'inventaire le nomme depuis son article.
  for (const qui of [FR, EN]) assert.ok((await post('/api/light/shop/buy', { sid: sids[qui], id: 4242 })).ok);
  const inv = await lesDeux('/api/light/inventaire');
  const nomAcc = (d) => d.accessoires.find((a) => a.id === 'shop_4242').nom;
  assert.deepEqual([nomAcc(inv.fr), nomAcc(inv.en)], ['Chapeau à plume', 'Feathered hat']);
  // Le refus d'achat : déjà possédé.
  const refFr = await post('/api/light/shop/buy', { sid: sids[FR], id: 4242 });
  const refEn = await post('/api/light/shop/buy', { sid: sids[EN], id: 4242 });
  assert.deepEqual([refFr.code, refFr.error], [2, 'Tu possèdes déjà cet accessoire.']);
  assert.deepEqual([refEn.code, refEn.error], [2, 'You already own this accessory.']);
});

test('les classements : les onglets du tableau des scores et le livre des records', async () => {
  const { fr, en } = await lesDeux('/api/light/challenge');
  const nom = (d, id) => (d.games.find((g) => g.id === id) || {}).name;
  assert.deepEqual([nom(fr, 'kaluga_classic'), nom(en, 'kaluga_classic')], ['Kaluga grappe', 'Kaluga cluster']);
  assert.deepEqual([nom(fr, '_xp'), nom(en, '_xp')], ['Classement XP', 'XP ranking']);
  // Les noms propres ne bougent pas.
  assert.equal(nom(en, 'swapou2_classic'), nom(fr, 'swapou2_classic'));
  assert.deepEqual(en.games.map((g) => g.id), fr.games.map((g) => g.id), 'les mêmes classements, dans le même ordre');
  const rec = await lesDeux('/api/club/records');
  const r = (d, id) => d.rankings.find((x) => x.id === id).name;
  assert.deepEqual([r(rec.fr, 'snake3_classic'), r(rec.en, 'snake3_classic')], ['Frutisnake - Classique', 'Frutisnake - Classic']);
  assert.equal(r(rec.en, 'bkiwi_track2_classic'), 'Burning Kiwi - Terre Grise', 'un circuit garde son nom');
});

test('les préférences du light : libellés, descriptions, choix et catégories', async () => {
  const { fr, en } = await lesDeux('/api/light/prefs');
  assert.deepEqual([fr.categories[0].name, en.categories[0].name], ['Général', 'General']);
  const pref = (d, n) => d.categories.flatMap((c) => c.prefs).find((p) => p.name === n);
  assert.deepEqual([pref(fr, 'default_channel').label, pref(en, 'default_channel').label], ['Salon par défaut', 'Default chat room']);
  assert.equal(pref(fr, 'ch_dsp_h').desc, 'Afficher l\'heure devant chaque message du chat.');
  assert.equal(pref(en, 'ch_dsp_h').desc, 'Show the time in front of each chat message.');
  assert.deepEqual([pref(fr, 'default_pen').choices[1].label, pref(en, 'default_pen').choices[1].label], ['Orange', 'Orange']);
  assert.deepEqual([pref(fr, 'default_pen').choices[0].label, pref(en, 'default_pen').choices[0].label], ['Aucun feutre', 'No pen']);
  assert.deepEqual([pref(fr, 'forum_notify').choices[2].label, pref(en, 'forum_notify').choices[2].label], ['Jamais', 'Never']);
  // Les valeurs, elles, ne changent pas.
  assert.deepEqual(pref(en, 'forum_notify').choices.map((c) => c.v), pref(fr, 'forum_notify').choices.map((c) => c.v));
});

test('les quêtes de Gromelin : titres, lignes, niveaux et semaine', async (t) => {
  if (!avecBase) return t.skip('Postgres indisponible sur 5433');
  const { fr, en } = await lesDeux('/api/quetes/etat');
  assert.ok(fr.acces && en.acces, 'les quêtes sont ouvertes au lancement');
  assert.ok(fr.quetes.length > 0 && en.quetes.length === fr.quetes.length, JSON.stringify(fr.quetes.map((q) => q.titre)));
  // Le premier message du forum, un premier pas de chacun.
  const pas = (d) => d.quetes.find((q) => q.id === 'pas-forum');
  assert.ok(pas(fr) && pas(en), 'un premier pas : le forum');
  assert.equal(pas(fr).titre, 'Écris ton premier message sur le forum');
  assert.equal(pas(en).titre, 'Write your first message on the forum');
  assert.equal(pas(fr).detail, 'Premiers pas · un sujet ou une réponse, où tu veux');
  assert.equal(pas(en).detail, 'First steps · a topic or a reply, wherever you like');
  assert.deepEqual([pas(fr).niveauNom, pas(en).niveauNom], ['Facile', 'Easy']);
  assert.deepEqual([pas(fr).palierNom, pas(en).palierNom], ['Bronze', 'Bronze']);
  assert.deepEqual([pas(fr).ligne, pas(en).ligne], ['0 / 1', '0 / 1']);
  // Le premier Prunostic : sa mise posée dans la phrase.
  const pari = (d) => d.quetes.find((q) => q.id === 'pas-prunostic');
  assert.match(pari(fr).titre, /^Place un Prunostic d’au moins \d+ kikooz$/);
  assert.match(pari(en).titre, /^Place a Prunostic of at least \d+ kikooz$/);
  // Toutes les quêtes ont leur texte anglais (aucune ligne restée en français).
  for (const q of en.quetes) {
    assert.doesNotMatch(q.titre + ' ' + q.detail, /\b(Fais|Joue|Découvre|Dépasse|Premiers pas|Vie du parc|Découverte|ton |tes )\b/, q.titre + ' · ' + q.detail);
  }
  assert.match(fr.semaine.lisible, /^du \d+ (au \d+ \p{L}+|\p{L}+ au \d+ \p{L}+)$/u);
  assert.match(en.semaine.lisible, /^of [A-Z][a-z]+ \d+ to ([A-Z][a-z]+ )?\d+$/);
  // Rien n'est rangé en toutes lettres : les définitions ne portent que leurs paramètres.
  const rows = await sql(`SELECT quetes FROM quetes_individuelles WHERE lower(username) = $1`, [EN.toLowerCase()]);
  for (const d of rows[0].quetes) {
    assert.equal(d.detail, undefined, 'pas de ligne rangée : ' + JSON.stringify(d));
    if (d.type !== 'mesure') assert.equal(d.titre, undefined, 'pas de titre rangé : ' + JSON.stringify(d));
  }
});

test('les Prunostics : un pari du Challenge au registre, le mois et sa clé, un refus', async (t) => {
  if (!avecBase) return t.skip('Postgres indisponible sur 5433');
  assert.ok((await post('/api/admin/paris-challenge', { actif: true, plafond: 50 }, ADMIN)).ok);
  assert.ok((await post('/api/admin/paris-challenge', { jeuxDuJour: { jeux: ['swapou2_classic'] } }, ADMIN)).ok);
  // Un refus : la mise n'est pas un nombre entier.
  const nonFr = await post('/api/paris/challenge', { sid: sids[FR], jeu: 'swapou2_classic', type: 'podium', choix: EN, mise: 0 });
  const nonEn = await post('/api/paris/challenge', { sid: sids[EN], jeu: 'swapou2_classic', type: 'podium', choix: FR, mise: 0 });
  assert.deepEqual([nonFr.code, nonFr.message], ['mise', 'La mise est un nombre entier de kikooz.']);
  assert.deepEqual([nonEn.code, nonEn.message], ['mise', 'A bet is a whole number of kikooz.']);
  // Chacun parie sur l'autre.
  assert.ok((await post('/api/paris/challenge', { sid: sids[FR], jeu: 'swapou2_classic', type: 'podium', choix: EN, mise: 5 })).ok);
  assert.ok((await post('/api/paris/challenge', { sid: sids[EN], jeu: 'swapou2_classic', type: 'or', choix: FR, mise: 5 })).ok);
  const { fr, en } = await lesDeux('/api/paris/registre');
  assert.match(fr.lignes[0].quoi, new RegExp(`^${EN} médaillé à Swapou 2 \\(\\p{L}+ \\d+ \\p{L}+\\)$`, 'ui'));
  assert.match(en.lignes[0].quoi, new RegExp(`^${FR} gold at Swapou 2 \\([A-Z][a-z]+, [A-Z][a-z]+ \\d+\\)$`, 'i'));
  // Le mois : son nom dans chaque langue, et sa clé pour la page.
  const cle = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()).slice(0, 7);
  assert.deepEqual([fr.mois.cle, en.mois.cle], [cle, cle]);
  const [a, m] = cle.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, 15));
  assert.equal(fr.mois.lisible, d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  assert.equal(en.mois.lisible, d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
});

test('une médaille de la fiche : « d’or » en français, « gold » en anglais', async (t) => {
  if (!avecBase) return t.skip('Postgres indisponible sur 5433');
  const hier = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(Date.now() - 86400000));
  await sql(`INSERT INTO challenge_medals (username, ranking_id, game, rank, medal, awarded_day) VALUES ($1, 'kaluga_classic', 'kaluga', 1, 'or', $2)`,
    [FR.toLowerCase(), hier]);
  const { fr, en } = { fr: await get('/api/light/fiche?u=' + FR, FR), en: await get('/api/light/fiche?u=' + FR, EN) };
  assert.ok(fr.ok && en.ok);
  const med = (d) => d.scores.medailles[0];
  assert.deepEqual([med(fr).medaille, med(en).medaille], ['d\'or', 'gold']);
  assert.deepEqual([med(fr).jeu, med(en).jeu], ['Kaluga', 'Kaluga'], 'le nom du jeu ne change pas');
  assert.deepEqual([med(fr).couleur, med(en).couleur], ['gold', 'gold']);
});
