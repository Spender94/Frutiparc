/*
 * Motion Ball 2 — la MAP DU JOUR postée par VieuxPruneau.
 *
 * Deux familles :
 *   · le MODULE (mb2carte.js), à blanc : le décodage du flux de mb2gen.js
 *     (les mêmes bits que motionball.swf), la description — départ, boss,
 *     billes, bonus, portes —, le plan SVG et le message ;
 *   · le SERVEUR, avec Postgres (ignoré s'il n'y en a pas) : au démarrage
 *     VieuxPruneau ouvre le sujet dans « Jeux Frutiparc » et y poste la map
 *     avec son plan ; un roll sur la même graine ne poste pas deux fois ; une
 *     régénération par l'admin poste la nouvelle ; le plan se sert en SVG.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const RACINE = path.join(__dirname, '..');
const Carte = require(path.join(RACINE, 'mb2carte.js'));
const Gen = require(path.join(RACINE, 'mb2gen.js'));

// ── Le module ──────────────────────────────────────────────────────────────

test('le décodage relit le donjon de mb2gen : 8×8, un départ, un boss, quatre billes, les bonus du tirage', () => {
  // Le flux d'une map réelle : celle que le serveur sert (mb2data.dat).
  const fichier = path.join(RACINE, 'Games', 'motionBall2', 'mb2data.dat');
  const contenu = fs.readFileSync(fichier, 'utf8');
  const { graine, donjon } = Carte.lireFichier(contenu);
  assert.ok(graine > 0);
  assert.strictEqual(donjon.largeur, 8);
  assert.strictEqual(donjon.hauteur, 8);
  const r = Carte.decrire(donjon);
  assert.ok(r.depart, 'un départ');
  assert.ok(r.boss, 'une salle du boss');
  assert.notStrictEqual(r.depart, r.boss);
  // Les quatre billes à trouver, une de chaque (OBJECTS_COUNT du générateur).
  assert.deepStrictEqual(r.billes.map((b) => b.nom), ['verte', 'bleue', 'métal', 'violette']);
  // Les bonus obligatoires du tirage (BONUS_COUNTS : une orange, une rouge,
  // une carte, un radar), une fois chacun.
  for (const nom of ['bille orange', 'bille rouge', 'carte', 'radar']) {
    assert.strictEqual(r.bonus.filter((b) => b.nom === nom).length, 1, nom);
  }
  assert.ok(r.bonus.filter((b) => b.nom === 'grand temps').length <= 2, 'deux grands temps au plus');
  // La superficie : au moins les trois quarts des cases (genDungeon).
  assert.ok(r.salles >= 48, 'au moins 48 salles : ' + r.salles);
  assert.strictEqual(r.salles + r.vides, 64);
  // Chaque porte et chaque passage invisible relie deux cases voisines.
  for (const p of r.portes.concat(r.invisibles)) {
    const [a, b] = p.entre;
    const dx = Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), dy = Math.abs(Number(a.slice(1)) - Number(b.slice(1)));
    assert.strictEqual(dx + dy, 1, 'voisines : ' + a + '–' + b);
  }
  // Le départ est une salle qui existe, à la position du flux.
  assert.strictEqual(r.depart, Carte.nomCase(donjon.depart.x, donjon.depart.y));
  assert.notStrictEqual(donjon.salles[donjon.depart.x][donjon.depart.y].type, 0);
});

test('le décodage est celui du SWF : un flux forgé se relit champ à champ', () => {
  // On écrit un donjon 2×1 à la main avec le codec du générateur (alphabet
  // du SWF) : départ en (0,0) salle normale, passage ouvert vers la droite ;
  // (1,0) salle du boss, porte bleue vers la gauche.
  const bits = [];
  const w = (n, v) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  w(7, 2); w(7, 1); w(7, 0); w(7, 0);                       // 2 × 1, départ en (0,0)
  w(3, 1); w(2, 1); w(2, 0); w(2, 1); w(2, 1);              // (0,0) normale : gauche fermé, DROITE OUVERTE, haut et bas fermés
  w(3, 2); w(2, 3); w(2, 1); w(2, 1); w(2, 1); w(2, 1);     // (1,0) boss : gauche = porte (3) bille bleue (1), le reste fermé
  while (bits.length % 6) bits.push(0);
  const alphabet = Gen.B64_SWF;
  let s = '';
  for (let i = 0; i < bits.length; i += 6) {
    let v = 0;
    for (let j = 0; j < 6; j++) v = (v << 1) | bits[i + j];
    s += alphabet[v];
  }
  const d = Carte.decoderDonjon(s);
  assert.strictEqual(d.largeur, 2);
  assert.strictEqual(d.hauteur, 1);
  assert.deepStrictEqual(d.depart, { x: 0, y: 0 });
  assert.strictEqual(d.salles[0][0].type, 1);
  assert.strictEqual(d.salles[1][0].type, 2);
  assert.deepStrictEqual(d.salles[1][0].passages[0], { type: 3 }, 'la donnée de la porte est lue, pas gardée : le jeu ne s’en sert pas');
  const r = Carte.decrire(d);
  assert.strictEqual(r.depart, 'A1');
  assert.strictEqual(r.boss, 'B1');
  assert.deepStrictEqual(r.portes, [{ entre: ['A1', 'B1'] }]);
  assert.throws(() => Carte.decoderDonjon('a'), /tronqué|illisible/);
  assert.throws(() => Carte.lireFichier('n importe quoi'), /illisible/);
});

test('le plan SVG et le message disent la même chose que la description', () => {
  const contenu = fs.readFileSync(path.join(RACINE, 'Games', 'motionBall2', 'mb2data.dat'), 'utf8');
  const { graine, donjon } = Carte.lireFichier(contenu);
  const r = Carte.decrire(donjon);
  const svg = Carte.carteSvg(donjon, { graine, jour: '17/09/2026' });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.indexOf('graine ' + graine) > 0);
  // Rien d'extérieur : un SVG dans une balise <img> ne charge que lui-même.
  assert.doesNotMatch(svg, /href="(?!#|data:)/, 'aucune adresse extérieure');
  // C'est la carte DU JEU : le parchemin (l'image 281 du manifeste, en
  // ligne), la grille (la forme 284), et les clips `room` aux places de la
  // pause (px = 18 + 48x, py = 16 + 36y) — le départ à l'image 34 + 26, le
  // boss à la 31, chaque bille et chaque bonus à sa case.
  const json = JSON.parse(fs.readFileSync(path.join(RACINE, 'public/mb2/data/mb2.json'), 'utf8'));
  const forme = (id) => json.perso[String(id)].ops[0].d.slice(0, 40);
  assert.ok(svg.indexOf(forme(284)) > 0, 'la grille du jeu');
  assert.ok(svg.indexOf(forme(276)) > 0, 'le boss (image 31)');
  assert.ok(svg.indexOf(forme(278)) > 0 && svg.indexOf(forme(271)) > 0, 'la salle où l’on est (34) et le départ (26)');
  assert.ok(svg.indexOf('<mask') > 0 && svg.indexOf('data:image/png;base64,') > 0, 'le parchemin, en ligne');
  const place = (nom) => { const x = nom.charCodeAt(0) - 65, y = Number(nom.slice(1)) - 1; return 'translate(' + (18 + 48 * x) + ',' + (16 + 36 * y) + ')'; };
  assert.ok(svg.indexOf(place(r.depart)) > 0, 'le départ à sa case');
  assert.ok(svg.indexOf(place(r.boss)) > 0, 'le boss à sa case');
  for (const b of r.billes) assert.ok(svg.indexOf(place(b.case)) > 0, b.nom);
  // Rejouable : la même map donne le même plan (l'image est adressée par son contenu).
  assert.strictEqual(Carte.carteSvg(donjon, { graine, jour: 'autre jour' }), svg);
  // Le message : le plan, puis chaque rubrique du détail — et rien d'inventé :
  // une porte n'a pas de couleur (c'est le grelot qui l'ouvre).
  const m = Carte.messageForum(donjon, { graine, jour: 'jeudi 17 septembre 2026', urlImage: '/forum-uploads/abc.svg' });
  assert.ok(m.indexOf('[img]/forum-uploads/abc.svg[/img]') > 0);
  assert.ok(m.indexOf('Départ[/b] en ' + r.depart) > 0);
  assert.ok(m.indexOf('boss[/b] en ' + r.boss) > 0);
  for (const b of r.billes) assert.ok(m.indexOf(b.nom + ' en ' + b.case) > 0, b.nom);
  for (const b of r.bonus) assert.ok(m.indexOf(b.nom + ' en ' + b.case) > 0, b.nom);
  for (const p of r.portes) assert.ok(m.indexOf(p.entre[0] + '–' + p.entre[1]) > 0);
  assert.doesNotMatch(m, /bille (verte|bleue|métal|violette)\)/, 'pas de couleur aux portes');
  assert.doesNotMatch(m, /réclame/, 'pas de salle qui réclame une bille : le jeu n’en a pas');
  assert.ok(m.endsWith('(graine ' + graine + ' · carte v2)[/i]'), 'la graine et la version du plan ferment le message : c’est la marque d’idempotence');
  assert.strictEqual(Carte.MARQUE_VERSION, ' · carte v2');
  // La variante « changée en cours de journée ».
  const m2 = Carte.messageForum(donjon, { graine, jour: 'x', changement: true });
  assert.ok(m2.startsWith('[b]Rebelote') && m2.indexOf('[img]') < 0);
});

// ── Le serveur, avec Postgres ──────────────────────────────────────────────

const PORT = 3448;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_mb2carte';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc, dispo = false;

async function baseNeuve() {
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
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5164', FRUTISCORE_PORT: '5165',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/forum/index')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const post = (url) => fetch(BASE + url, { method: 'POST', headers: hdr, body: '{}' }).then((r) => r.json());
const get = (url) => fetch(BASE + url).then((r) => r.json());

// Le sujet de VieuxPruneau, s'il existe : { topic, posts }.
async function sujet() {
  const idx = await get('/api/forum/index');
  const boards = [].concat(...(idx.categories || []).map((c) => c.boards || []));
  const board = boards.find((b) => b.name === 'Jeux Frutiparc');
  if (!board) return null;
  const b = await get('/api/forum/board/' + board.id);
  const t = (b.topics || []).find((x) => x.title === 'Map Challenge Motion-Ball 2');
  if (!t) return null;
  const pages = await get('/api/forum/topic/' + t.id + '?page=last');
  return { topic: t, posts: pages.posts || [] };
}
async function attendreMessages(n) {
  for (let i = 0; i < 80; i++) {
    const s = await sujet();
    if (s && s.posts.length >= n) return s;
    await wait(250);
  }
  return sujet();
}

test('au démarrage, VieuxPruneau ouvre le sujet et y poste la map du jour avec son plan', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  const s = await attendreMessages(2);
  assert.ok(s, 'le sujet « Map Challenge Motion-Ball 2 » existe dans « Jeux Frutiparc »');
  assert.strictEqual(s.topic.author, 'VieuxPruneau');
  assert.ok(s.posts.length >= 2, 'l’introduction, puis la map : ' + s.posts.length);
  const carte = s.posts[s.posts.length - 1];
  assert.strictEqual(carte.author, 'VieuxPruneau');
  assert.strictEqual(String(carte.bouille || '').slice(0, 24), '0g0000010000000000000000');
  assert.match(carte.content, /\[img\]\/forum-uploads\/[0-9a-f]{32}\.svg\[\/img\]/);
  assert.match(carte.content, /Le boss\[\/b\] en [A-H][1-8]\./);
  assert.match(carte.content, /\(graine \d+ · carte v2\)\[\/i\]$/);
  // Le plan se sert, en SVG, et c'est bien celui de la map servie.
  const url = /\[img\]([^\[]+)\[\/img\]/.exec(carte.content)[1];
  const r = await fetch(BASE + url);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /image\/svg\+xml/);
  const svg = await r.text();
  const graine = Number(/\(graine (\d+)/.exec(carte.content)[1]);
  assert.ok(svg.indexOf('graine ' + graine) > 0);
  const info = await fetch(BASE + '/api/admin/mb2/map-info', { headers: hdr }).then((x) => x.json());
  assert.strictEqual(String(info.seed), String(graine), 'la graine du message est celle de la map servie');
});

test('un roll sur la même graine ne poste pas deux fois ; une régénération par l’admin poste la nouvelle', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  await attendreMessages(2);
  // Un premier roll ramène la map à la graine CANONIQUE du jour (le fichier
  // sur disque pouvait porter une graine d'admin) : il poste, ou non. Le
  // second regénère la même : rien de neuf à dire.
  assert.ok((await post('/api/admin/challenge/roll')).ok);
  await wait(2500);
  const n = (await sujet()).posts.length;
  assert.ok((await post('/api/admin/challenge/roll')).ok);
  await wait(2500);
  const apres = await sujet();
  assert.strictEqual(apres.posts.length, n, 'même graine, même message : pas de doublon');
  const info = await fetch(BASE + '/api/admin/mb2/map-info', { headers: hdr }).then((x) => x.json());
  assert.ok(info.canonical, 'la map servie est la canonique du jour');
  assert.ok(apres.posts[n - 1].content.indexOf('(graine ' + info.seed + Carte.MARQUE_VERSION + ')') > 0, 'et c’est elle qu’annonce le dernier message');
  // L'admin tire une autre map : VieuxPruneau la poste, en le disant.
  const rg = await post('/api/admin/mb2/regenerate-map');
  assert.ok(rg.ok);
  const s = await attendreMessages(n + 1);
  assert.strictEqual(s.posts.length, n + 1);
  const dernier = s.posts[s.posts.length - 1];
  assert.ok(dernier.content.indexOf('Rebelote') >= 0, 'la map a changé en cours de journée, et il le dit');
  assert.ok(dernier.content.indexOf('(graine ' + rg.seed + Carte.MARQUE_VERSION + ')') > 0, 'la nouvelle graine');
  // Et le rétablissement de la précédente aussi (l'ancienne graine revient).
  const rp = await post('/api/admin/mb2/restore-previous');
  assert.ok(rp.ok);
  const s2 = await attendreMessages(n + 2);
  assert.strictEqual(s2.posts.length, n + 2);
  assert.ok(s2.posts[s2.posts.length - 1].content.indexOf('(graine ' + rp.seed + Carte.MARQUE_VERSION + ')') > 0);
});
