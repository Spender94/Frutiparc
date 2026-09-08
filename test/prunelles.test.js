/*
 * LES PRUNELLES — les iris d'hiko, vendus au parc.
 *
 * L'iris d'une frutibouille, c'est le clip `p` de `oa.o` : un ROULEAU que le
 * moteur cale sur `eyeSc`, la valeur des caractères 4 et 5 de la chaîne
 * d'état. La famille 0 en a dix-huit ; hiko (famille 12) en a deux que
 * personne d'autre ne porte — une paire rouge et noir, et une paire ANIMÉE.
 *
 * Ce fichier tient les quatre promesses de la fonctionnalité :
 *
 *   · LA RÉCOLTE est reproductible et FIGÉE. `prunelles.json` porte l'index
 *     que chaque paire occupera : c'est ce numéro qu'une bouille inscrit dans
 *     son état et que la boutique vend. Il doit vouloir dire la même chose sur
 *     tous les écrans, pour toujours.
 *   · LA GREFFE n'écrase rien. Elle AJOUTE au bout du rouleau de la famille
 *     d'accueil, et se tait quand la famille a déjà un iris à cette place —
 *     sans quoi elle remplacerait un des iris de hiko chez ceux qui le
 *     portent.
 *   · L'ACHAT ne change QUE les yeux. Deux caractères sur vingt-quatre : la
 *     coiffure, les couleurs et l'accessoire restent à leur place.
 *   · L'INVENTAIRE a un rayon pour elles, des deux côtés — l'onglet du light
 *     et le dossier du bureau —, et elles ne se retrouvent pas parmi les
 *     accessoires.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3517;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-prunelles';
const RUN = Date.now().toString(36).slice(-5);
const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

const Swf = require('../public/js/bouille-swf.js');
const M = require('../public/js/bouille-moteur.js');

const PAQUET = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/fbouille/prunelles.json'), 'utf8'));
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

function lireFamille(n) {
  const b = fs.readFileSync(path.join(ROOT, 'public/fbouille/famille' + n + '.swf'));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}

let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5262', FRUTISCORE_PORT: '5263',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('le serveur de test n’a pas démarré');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

async function joueur(nom, etat) {
  const corps = JSON.stringify({ username: nom, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr, body: corps });
  const r = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: hdr, body: corps })).json();
  assert.ok(r.sid, 'session ouverte pour ' + nom);
  if (etat) await fetch(BASE + '/do/eb?sid=' + r.sid + '&b=' + encodeURIComponent(etat));
  return r.sid;
}

// ── La récolte ─────────────────────────────────────────────────────────────

test('la récolte porte les deux paires, et leur place est FIGÉE', () => {
  assert.equal(PAQUET.iris.length, 2);
  const parCle = Object.fromEntries(PAQUET.iris.map((i) => [i.cle, i]));
  assert.ok(parCle.hiko1 && parCle.hiko2);
  assert.equal(parCle.hiko1.nom, "Hiko's eyes");
  assert.equal(parCle.hiko2.nom, "Hiko's eyes #2");
  // La famille 0 a dix-huit iris : les deux nouvelles prennent 18 et 19. Ces
  // deux nombres sont vendus en boutique et inscrits dans des chaînes d'état —
  // les changer, c'est changer les yeux de tous ceux qui les portent.
  assert.equal(parCle.hiko1.index, 18);
  assert.equal(parCle.hiko2.index, 19);
  // Chaque paire porte ses ORDRES DE POSE, jamais de retrait : ce qu'il faut
  // retirer dépend de la famille d'accueil, la greffe le calcule.
  for (const i of PAQUET.iris) {
    assert.ok(i.ordres.length >= 1);
    for (const o of i.ordres) assert.equal(o.t, 'pose');
  }
  // Les caractères sont renumérotés au-delà de la plage d'un SWF : rien ne peut
  // se heurter à ceux de la famille d'accueil.
  const ids = Object.keys(PAQUET.formes).concat(Object.keys(PAQUET.sprites)).map(Number);
  assert.ok(ids.length >= 6, 'cinq formes et un clip au moins');
  for (const id of ids) assert.ok(id >= 300000, 'identifiant décalé : ' + id);
});

test('l’outil de récolte refait le même paquet', () => {
  // On ne relance pas le script (il écrit dans public/) : on vérifie qu'il est
  // là, et que le paquet dit d'où il vient — de quoi refaire la récolte.
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/extract-prunelles-bouille.js')));
  assert.equal(PAQUET.source.outil, 'scripts/extract-prunelles-bouille.js');
  assert.match(PAQUET.source.iris, /famille12\.swf/);
  assert.match(PAQUET.source.hote, /famille0\.swf, oa\.o\.p, 18 images/);
});

// ── La greffe ──────────────────────────────────────────────────────────────

test('le rouleau d’iris se retrouve sous oa.o.p, et il est PARTAGÉ', async () => {
  const d0 = await lireFamille(0);
  const r0 = M.rouleauxIris(d0);
  // Neuf formes d'œil, deux yeux — et un seul rouleau : le clip est partagé.
  // Greffer une image le fait donc paraître partout d'un coup.
  assert.equal(r0.length, 1, 'un seul rouleau pour les deux yeux et les neuf formes');
  assert.equal(r0[0].images.length, 18, 'dix-huit iris d’origine');
  const d12 = await lireFamille(12);
  assert.equal(M.rouleauxIris(d12)[0].images.length, 19, 'hiko en a dix-neuf');
});

test('la greffe AJOUTE au bout, sans toucher aux iris d’origine', async () => {
  const defs = await lireFamille(0);
  const r = M.rouleauxIris(defs)[0];
  const avant = r.images.slice(0, 18).map((im) => JSON.stringify(im));
  const table = M.grefferPrunelles(defs, PAQUET);
  assert.deepEqual(table, { hiko1: 18, hiko2: 19 });
  assert.equal(r.images.length, 20, 'deux images de plus');
  assert.deepEqual(r.images.slice(0, 18).map((im) => JSON.stringify(im)), avant,
    'les dix-huit d’origine sont intactes');
  assert.equal(r.n, 20, 'et le compte du rouleau suit');
  // Les formes et les clips récoltés sont entrés dans les tables.
  for (const id of Object.keys(PAQUET.formes)) assert.ok(defs.formes.has(Number(id)));
  for (const id of Object.keys(PAQUET.sprites)) assert.ok(defs.sprites.has(Number(id)));
  // Idempotente : la même `defs` sert toutes les bouilles d'une page.
  assert.deepEqual(M.grefferPrunelles(defs, PAQUET), table);
  assert.equal(r.images.length, 20, 'une seconde greffe n’ajoute rien');
});

test('la greffe se TAIT là où la famille a déjà un iris', async () => {
  /*
   * Hiko a dix-neuf iris — les places 0 à 18 sont prises, la 19 est libre.
   * Y poser la greffe à la 18 remplacerait un de ses propres iris chez ceux
   * qui portent son incarnation : la règle est donc « on n'ajoute qu'au-delà
   * de ce que la famille a déjà ». La 18 reste à lui, la 19 accueille.
   */
  const d12 = await lireFamille(12);
  const r = M.rouleauxIris(d12)[0];
  const avant = r.images.map((im) => JSON.stringify(im));
  M.grefferPrunelles(d12, PAQUET);
  assert.equal(r.images.length, 20, 'seule la place libre (19) a été prise');
  assert.deepEqual(r.images.slice(0, 19).map((im) => JSON.stringify(im)), avant,
    'aucun des dix-neuf iris de hiko n’a bougé');
});

test('une image greffée RETIRE ce que la famille laissait, puis pose', async () => {
  const defs = await lireFamille(0);
  M.grefferPrunelles(defs, PAQUET);
  const r = M.rouleauxIris(defs)[0];
  for (const index of [18, 19]) {
    const ordres = r.images[index];
    assert.ok(ordres.some((o) => o.t === 'retire'),
      'l’image ' + index + ' commence par faire place nette');
    assert.ok(ordres.some((o) => o.t === 'pose' && o.ch >= 300000),
      'puis pose un caractère récolté');
  }
});

// ── La boutique ────────────────────────────────────────────────────────────

test('les prunelles ont leur rayon, et il est PAYANT', async () => {
  const sid = await joueur('prul' + RUN, '000305070b0f0m09020t0a00');
  const s = await (await fetch(BASE + '/api/light/shop?sid=' + sid)).json();
  const rayon = (s.categories || []).find((c) => c.name === 'Prunelles');
  assert.ok(rayon, 'le rayon « Prunelles » existe');
  assert.equal(rayon.items.length, 2);
  for (const a of rayon.items) {
    assert.equal(a.kind, 'prunelle');
    assert.equal(a.offert, false, 'un rayon payant, comme les accessoires');
    assert.equal(a.owned, false);
    assert.ok(a.prunelle, 'l’article nomme sa paire');
    // L'ÉTAT D'APERÇU : la bouille du joueur, deux caractères changés.
    assert.equal(a.etat.length, 24);
    const diff = [];
    for (let i = 0; i < 24; i++) if (a.etat[i] !== s.bouille[i]) diff.push(i);
    assert.ok(diff.every((i) => i === 4 || i === 5),
      'seuls les caractères 4-5 (l’iris) changent, pas ' + diff.join(','));
  }
  // Les deux index vendus sont ceux du paquet.
  const yeux = rayon.items.map((a) => M.decode62(a.etat.substring(4, 6))).sort((x, y) => x - y);
  assert.deepEqual(yeux, [18, 19]);
});

test('acheter une prunelle ne change QUE les yeux', async () => {
  const mienne = '000305070b0f0m09020t0a00';   // avec le bonnet de nuit au bout
  const sid = await joueur('prua' + RUN, mienne);
  const r = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: 301 }),
  })).json();
  assert.equal(r.ok, true);
  assert.equal(r.bouille.length, 24);
  const diff = [];
  for (let i = 0; i < 24; i++) if (r.bouille[i] !== mienne[i]) diff.push(i);
  assert.deepEqual(diff, [5], 'un seul caractère : le poids faible de l’iris');
  assert.equal(M.decode62(r.bouille.substring(4, 6)), 18);
  assert.equal(r.bouille.substring(15, 24), '9020t0a00', 'le bonnet est resté');
  // Deux fois, non : c'est un article de boutique comme un autre.
  const encore = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: 301 }),
  })).json();
  assert.equal(encore.ok, false);
  assert.equal(encore.code, 2, 'déjà possédé');
});

// ── L'inventaire ───────────────────────────────────────────────────────────

test('les prunelles ont leur rayon d’inventaire, et pas celui des accessoires', async () => {
  // Un nouveau membre a de quoi s'offrir la première paire (120 kikooz sur les
  // 200 de bienvenue) : c'est assez pour voir où elle se range.
  const sid = await joueur('prui' + RUN, '000305070b0f0m09020t0a00');
  const achat = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: 301 }),
  })).json();
  assert.equal(achat.ok, true, 'la paire est achetée');

  const inv = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  assert.equal(inv.prunelles.length, 1);
  assert.equal(inv.prunelles[0].nom, "Hiko's eyes");
  assert.equal(inv.prunelles[0].cle, 'hiko1', 'la ligne nomme sa paire');
  assert.equal(inv.prunelles[0].etat.length, 24);
  // Et elle n'est PAS parmi les accessoires : une paire d'iris n'en est pas un.
  const accs = (inv.accessoires || []).map((a) => a.nom);
  assert.ok(!accs.some((n) => /Hiko/.test(n)), 'pas de doublon côté accessoires');

  // Le BUREAU a le même rangement : un dossier de plus dans l'Inventaire.
  const arbre = await (await fetch(BASE + '/ff/ls?uid=inventory&sid=' + sid)).text();
  assert.match(arbre, /<f u="inv_prunelles" n="Prunelles" t="folder" \/>/);
  const dossier = await (await fetch(BASE + '/ff/ls?uid=inv_prunelles&sid=' + sid)).text();
  assert.match(dossier, /u="shop_301"[^>]*t="bouille"/);
  const accessoires = await (await fetch(BASE + '/ff/ls?uid=inv_accessories&sid=' + sid)).text();
  assert.ok(!/shop_301/.test(accessoires), 'le dossier Accessoires ne la reprend pas');
});

// ── Le code ────────────────────────────────────────────────────────────────

test('la clé d’une prunelle survit au passage par la base', () => {
  // Les articles sont persistés, et les colonnes ne connaissent pas `prunelle` :
  // sans réapplication depuis la définition statique, l'article redeviendrait un
  // accessoire au suffixe vide — une bouille sans rien, et des yeux inchangés.
  assert.match(SERVEUR, /if \(def && def\.prunelle\) p\.prunelle = def\.prunelle;/);
  // Et le rayon reste payant.
  assert.match(SERVEUR, /\|\| n\.startsWith\('prunelle'\)\);/);
});

test('le light range les prunelles à part, et sait en sortir', () => {
  assert.match(LIGHT, /<button class="inv-onglet" data-rub="prunelles">Prunelles<\/button>/);
  assert.match(LIGHT, /id="inv-prunelles-grid"/);
  assert.match(LIGHT, /function porterPrunelle\(iris, nom\)/);
  // On change DEUX caractères de ce qu'on porte, pas plus.
  assert.match(LIGHT, /return s\.substring\(0, 4\) \+ iris \+ s\.substring\(6, 24\);/);
  // Le retour aux iris d'origine passe par l'éditeur — un seul endroit pour
  // changer de visage.
  assert.match(LIGHT, /\$\("#inv-prunelles-retour"\)\.addEventListener\("click", function \(\) \{\s*\n\s*openFbEditor\(/);
  // Et l'éditeur ne propose PAS les prunelles : elles s'achètent.
  assert.match(LIGHT, /\{ key: "iris",\s+label: "iris",\s+id: 2, pos: 4,\s+max: 17 \}/);
});

test('le lecteur greffe les prunelles au chargement de la famille', () => {
  const vig = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
  // Au MÊME point de passage que les variantes d'accessoire, et pour la même
  // raison : un index doit vouloir dire la même chose sur tous les écrans.
  assert.match(vig, /Promise\.all\(\[Swf\.charger\(DOSSIER \+ 'famille' \+ n \+ '\.swf'\), variantes\(\), prunelles\(\)\]\)/);
  assert.match(vig, /M\.grefferPrunelles\(r\[0\], r\[2\]\)/);
  assert.match(vig, /global\.fetch\(DOSSIER \+ 'prunelles\.json'\)/);
  // Un fichier absent ne doit pas empêcher les bouilles de paraître.
  assert.match(vig, /\.catch\(function \(\) \{ return null; \}\)/);
});
