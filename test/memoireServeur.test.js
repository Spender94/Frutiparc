'use strict';
/*
 * LA MÉMOIRE DU SERVEUR (memoireServeur.js) : relevés, historique en base,
 * inventaire. Le point qui compte le plus : une base qui refuse (création,
 * écriture, lecture) ne casse RIEN — ni le démarrage, ni les relevés, ni
 * l'admin. Et la table n'est jamais créée par db.initSchema.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { MemoireServeur, contenuDe } = require('../memoireServeur.js');

const Mo = 1024 * 1024;
function horloge(t0) {
  const h = { t: t0 || Date.UTC(2026, 10, 16, 12) };
  h.lire = () => h.t;
  return h;
}
const memoire = (rss) => () => ({ rss: rss * Mo, heapUsed: 20 * Mo, external: 5 * Mo });

// Un faux pool : note les requêtes, échoue sur demande.
function fauxPool(o) {
  o = o || {};
  const p = { requetes: [], lignes: [] };
  p.query = async (sql, params) => {
    p.requetes.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (o.echoue && o.echoue(sql)) throw new Error('permission denied for schema public');
    if (/^\s*INSERT/.test(sql)) { p.lignes.push(params); return { rows: [] }; }
    return { rows: [] };
  };
  return p;
}

test('sans base : les relevés vivent en mémoire, rien ne casse', async () => {
  const h = horloge();
  const m = new MemoireServeur({ pool: null, memoire: memoire(200), maintenant: h.lire });
  const r = await m.relever();
  assert.strictEqual(r.rss, 200 * Mo);
  assert.strictEqual(m.etat().etat, 'sans base');
  const hist = await m.historique(24);
  assert.strictEqual(hist.source, 'memoire');
  assert.strictEqual(hist.points.length, 1);
});

test('une base qui REFUSE de créer la table : aucun rejet, relevés en mémoire, retentée une heure plus tard', async () => {
  const h = horloge();
  const pool = fauxPool({ echoue: (sql) => /CREATE TABLE/.test(sql) });
  const m = new MemoireServeur({ pool, memoire: memoire(200), maintenant: h.lire, retenteMs: 3600 * 1000 });
  const r = await m.relever();                    // ne doit pas rejeter
  assert.ok(r, 'le relevé est pris quand même');
  assert.strictEqual(m.etat().etat, 'indisponible');
  assert.match(m.etat().erreur, /permission denied/);
  const essais = pool.requetes.filter((q) => /CREATE/.test(q)).length;
  h.t += 5 * 60 * 1000;
  await m.relever();
  assert.strictEqual(pool.requetes.filter((q) => /CREATE/.test(q)).length, essais, 'pas de nouvel essai avant une heure');
  h.t += 3600 * 1000;
  await m.relever();
  assert.strictEqual(pool.requetes.filter((q) => /CREATE/.test(q)).length, essais + 1, 'nouvel essai après une heure');
  assert.strictEqual(m.releves.length, 3, 'les trois relevés sont en mémoire');
  const hist = await m.historique(24);
  assert.strictEqual(hist.source, 'memoire');
});

test('une ÉCRITURE qui échoue ne casse rien non plus', async () => {
  const pool = fauxPool({ echoue: (sql) => /INSERT/.test(sql) });
  const m = new MemoireServeur({ pool, memoire: memoire(200), maintenant: horloge().lire });
  const r = await m.relever();
  assert.ok(r);
  assert.strictEqual(m.etat().etat, 'indisponible');
});

test('base saine : la table est créée une fois, puis chaque relevé s\'écrit', async () => {
  const h = horloge();
  const pool = fauxPool();
  const m = new MemoireServeur({ pool, memoire: memoire(200), maintenant: h.lire, inventaireChaque: 12 });
  m.surveiller('sessions', () => ({ a: 1, b: 2 }));
  for (let i = 0; i < 13; i++) { await m.relever(); h.t += 5 * 60 * 1000; }
  assert.strictEqual(pool.requetes.filter((q) => /CREATE/.test(q)).length, 1);
  assert.strictEqual(pool.lignes.length, 13);
  assert.strictEqual(m.etat().etat, 'ok');
  // L'inventaire : au 1er relevé, puis au 13e (une fois par heure).
  const avecInventaire = pool.lignes.map((p) => p[7]).filter(Boolean);
  assert.strictEqual(avecInventaire.length, 2);
  assert.deepStrictEqual(JSON.parse(avecInventaire[0]), { sessions: [2, 0] });
});

test('la mémoire ne garde que vingt-quatre heures', async () => {
  const h = horloge();
  const m = new MemoireServeur({ pool: null, memoire: memoire(200), maintenant: h.lire });
  for (let i = 0; i < 400; i++) { await m.relever(); h.t += 5 * 60 * 1000; }
  assert.ok(m.releves.length <= 289);
});

test('l\'inventaire compte, un cran plus bas compris', () => {
  const m = new MemoireServeur({ pool: null, memoire: memoire(200) });
  const salons = { a: { historique: [1, 2, 3], nom: 'A' }, b: { historique: [1] } };
  const files = new Map([['x', [1, 2]], ['y', new Set([1, 2, 3])]]);
  m.surveiller('salons', () => salons).surveiller('files', () => files).surveiller('nombre', () => 3)
    .surveiller('cassé', () => { throw new Error('x'); });
  const inv = m.inventaire();
  assert.deepStrictEqual(inv.find((x) => x.nom === 'salons'), { nom: 'salons', type: 'objet', elements: 2, contenu: 4 });
  assert.deepStrictEqual(inv.find((x) => x.nom === 'files'), { nom: 'files', type: 'Map', elements: 2, contenu: 5 });
  assert.ok(!inv.find((x) => x.nom === 'nombre'), 'un nombre n\'est pas une structure');
  assert.ok(!inv.find((x) => x.nom === 'cassé'), 'une structure illisible est sautée, sans casser les autres');
});

test('l\'inventaire montre ce qui a grossi depuis une heure et un jour', async () => {
  const h = horloge();
  const m = new MemoireServeur({ pool: null, memoire: memoire(200), maintenant: h.lire, inventaireChaque: 12 });
  const fuite = new Map();
  const stable = new Map([[1, 1]]);
  m.surveiller('fuite', () => fuite).surveiller('stable', () => stable);
  for (let i = 0; i < 12 * 25; i++) {           // 25 heures de relevés
    fuite.set(i, i);
    await m.relever();
    h.t += 5 * 60 * 1000;
  }
  const c = await m.inventaireCompare();
  assert.strictEqual(c.lignes[0].nom, 'fuite', 'la structure qui grossit vient en tête');
  assert.ok(c.lignes[0].d1 >= 11 && c.lignes[0].d24 >= 280);
  assert.strictEqual(c.lignes.find((x) => x.nom === 'stable').d24, 0);
});

test('le contenu d\'une très grosse structure est borné', () => {
  const gros = new Map();
  for (let i = 0; i < 2100000; i++) gros.set(i, [1]);
  const c = contenuDe(gros);
  assert.strictEqual(c.tronque, true);
});

test('la table n\'est PAS créée par db.initSchema (le démarrage n\'en dépend pas)', () => {
  const DB = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  assert.doesNotMatch(DB, /memoire_releves/);
  const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(SRV, /new MemoireServeur\(/);
  assert.match(SRV, /memoireServeur\.demarrer\(\)/);
  assert.match(SRV, /app\.get\('\/api\/admin\/memoire', adminAuth/);
});

test('l\'admin : un onglet « Serveur » à part, que les Statistiques ne chargent plus', () => {
  const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  assert.match(ADMIN, /data-tab="serveur" onclick="switchTab\('serveur'\)">Serveur</);
  assert.match(ADMIN, /<div class="content" id="tab-serveur"[^>]*>[\s\S]*id="stats-memoire"[\s\S]*id="memoire-inventaire"[\s\S]*?<\/div>/);
  assert.match(ADMIN, /if \(name === 'serveur'\) loadMemoire\(\);\s*else memoireAuto\(false\);/);
  const stats = ADMIN.slice(ADMIN.indexOf('<div class="content" id="tab-stats"'), ADMIN.indexOf('<div class="content" id="tab-serveur"'));
  assert.doesNotMatch(stats, /stats-memoire/, 'la mémoire n\'est plus dans les Statistiques');
  assert.doesNotMatch(ADMIN, /async function loadStats\(\) \{\s*loadMemoire\(\);/);
});

// La page est faite pour un admin qui ne connaît rien à l'informatique :
// chaque structure surveillée a son nom en français courant, et la page dit
// en mots simples si tout va bien et quoi faire.
test('l\'admin : chaque structure surveillée est traduite en mots simples', () => {
  const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const liste = SRV.slice(SRV.indexOf('for (const [nom, lire] of ['), SRV.indexOf(']) memoireServeur.surveiller(nom, lire);'));
  const surveillees = [...liste.matchAll(/\['([A-Za-z0-9_$]+)', \(\) =>/g)].map((m) => m[1]);
  assert.ok(surveillees.length >= 90, surveillees.length + ' structures surveillées');
  const dico = ADMIN.slice(ADMIN.indexOf('const MEMO_NOMS = {'), ADMIN.indexOf('function memoNom('));
  const sans = surveillees.filter((n) => !dico.includes('\n  ' + n + ': ['));
  assert.deepStrictEqual(sans, [], 'structures sans traduction');
  assert.match(ADMIN, /Tout va bien/);
  assert.match(ADMIN, /À surveiller/);
  assert.match(ADMIN, /<b>Que faire \?<\/b>/);
  assert.match(ADMIN, /class="mem-lexique"/);
});

// L'onglet Swapou vérifié utilisait déjà `sv-verdict` (son filtre) : l'onglet
// Serveur a écrit dedans tant qu'il portait le même préfixe. Plus jamais deux
// fois le même identifiant dans la page de l'admin.
test('l\'admin : aucun identifiant en double (Swapou garde son filtre « sv-verdict »)', () => {
  const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const ids = [...ADMIN.matchAll(/ id="([^"$]+)"/g)].map((m) => m[1]);
  const vus = new Set(), doubles = new Set();
  for (const i of ids) (vus.has(i) ? doubles : vus).add(i);
  assert.deepStrictEqual([...doubles], []);
  assert.match(ADMIN, /<select id="sv-verdict" onchange="loadSwapouVerif\(\)">/);
  const code = ADMIN.slice(ADMIN.indexOf('// ─── Onglet Serveur'), ADMIN.indexOf('async function loadStats() {'));
  assert.doesNotMatch(code, /#sv-/, 'l\'onglet Serveur ne touche à aucun élément de Swapou');
});
