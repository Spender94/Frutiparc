'use strict';
/*
 * LES VARIANTES D'ACCESSOIRE ANIMÉES
 *
 * Une variante maison était FIXE : une image de plus dans le rouleau `acc`, et
 * rien qui bouge. Elle peut désormais être une PELLICULE — chaque tracé porte
 * éventuellement `image` (sans quoi il est du décor commun), et la variante
 * porte `anim.durees`, la tenue de chaque image en tics de 1/24 s.
 *
 * Ce que ce test tient :
 *
 *   · `animer` / `enchainer` — des calques « imageN » (ou d'une suite de
 *     fichiers) à la pellicule : numéros resserrés, tenues lues ou par défaut ;
 *   · l'INJECTION — une seule image dans le rouleau, qui pose un clip `varFilm`
 *     jouant les images dans l'ordre, chacune le temps de sa tenue ;
 *   · la TEINTE — un niveau de couleur qui naît à l'image 2, bien après
 *     `apply()`, reçoit quand même la couleur du joueur ;
 *   · le GABARIT — une variante animée se rend à son graphiste avec ses calques
 *     « imageN_xT » ;
 *   · et rien ne bouge pour une variante FIXE.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
require(path.join(ROOT, 'public/js/bouille-avm.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));
const Variante = require(path.join(ROOT, 'public/js/bouille-variante.js'));

const CASQUETTE = 3;

function lire() {
  const brut = fs.readFileSync(path.join(ROOT, 'public/fbouille/famille0.swf'));
  return Swf.decompresser(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength))
    .then(Swf.lire);
}
const paire = (n) => Moteur.encode62(n, 2);
const etatAvec = (variante, c1, c2, c3) =>
  [0, 3, 0, 8, 0, 2, 7, CASQUETTE, variante, c1, c2, c3].map(paire).join('');

// Deux carrés repérables, posés sur le front.
const CARRE_A = 'M40 10 L50 10 L50 20 L40 20 Z';
const CARRE_B = 'M60 10 L72 10 L72 22 L60 22 Z';

function monter(defs, variante, couleurs) {
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  const c = couleurs || [21, 17, 24];
  mo.definir(etatAvec(variante, c[0], c[1], c[2]));
  return mo;
}
const enf = (c, nom) => (c ? c.enfantNomme(nom) : null);
function accDe(mo) { return enf(enf(enf(mo.racine.face, 'ca'), 'c'), 'acc'); }
function pelliculeDe(clip) {
  for (const e of clip.enfants.values()) if (e.objet && e.objet.def && e.objet.def.varFilm) return e.objet;
  return null;
}
// Les tracés que l'arbre monté peint en ce moment, pour la variante donnée.
function peints(defs, variante) {
  return Variante.exporter(defs, CASQUETTE, variante, 8).map((p) => p.d);
}

test('animer : les calques « imageN » deviennent une pellicule 1…N', () => {
  const r = Variante.animer([
    { d: 'M0 0', fill: '#000' },
    { d: 'M1 1', fill: '#000', image: 5, tenue: 4 },
    { d: 'M2 2', fill: '#000', image: 2 },
    { d: 'M3 3', fill: '#000', image: 5 },
  ], 3);
  assert.deepStrictEqual(r.anim, { durees: [3, 4] }, 'images 2 et 5 → 1 et 2 ; la tenue « x4 » est gardée');
  assert.deepStrictEqual(r.paths.map((p) => p.image || 0), [0, 2, 1, 2]);
  assert.ok(r.paths.every((p) => p.tenue === undefined), 'la tenue ne reste pas sur les tracés');

  // Une seule image n'est pas une animation : ses tracés rejoignent le décor.
  const seul = Variante.animer([{ d: 'M0 0', fill: '#000', image: 3 }], 3);
  assert.strictEqual(seul.anim, null);
  assert.strictEqual(seul.paths[0].image, undefined);
});

test('enchainer : un fichier par image, dans l’ordre', () => {
  const r = Variante.enchainer([
    [{ d: 'M0 0', fill: '#000', image: 7 }],
    [{ d: 'M1 1', fill: '#000' }, { d: 'M2 2', fill: '#111' }],
    [{ d: 'M3 3', fill: '#000' }],
  ], 2);
  assert.deepStrictEqual(r.anim, { durees: [2, 2, 2] });
  assert.deepStrictEqual(r.paths.map((p) => p.image), [1, 2, 2, 3]);
});

test('une variante animée : une image du rouleau, une pellicule qui tient ses tenues', async () => {
  const defs = await lire();
  const decor = Variante.exporter(defs, CASQUETTE, 34, 8);
  const paths = decor.concat([
    { d: CARRE_A, fill: '#ff0000', image: 1 },
    { d: CARRE_B, fill: 'rgb(255,255,255)', slot: 2, image: 2 },
  ]);
  const longueur = Variante.repere(defs, CASQUETTE, 8).variantes;
  const inj = Variante.injecter(defs, { type: CASQUETTE, paths, anim: { durees: [2, 3] }, coiffureRef: 8 });
  assert.ok(inj, 'injection réussie');
  assert.strictEqual(inj.variante, longueur, 'UNE image de plus au rouleau, comme une variante fixe');
  assert.strictEqual(inj.images, 2);

  const mo = monter(defs, inj.variante);
  const film = pelliculeDe(accDe(mo));
  assert.ok(film, 'l’accessoire pose une pellicule');
  assert.strictEqual(film.def.n, 2);
  assert.ok(mo.enMouvement(), 'et le moteur la sait vivante : la vignette l’animera');

  // Image 1 : le décor et le carré A, pas le carré B.
  let vus = peints(defs, inj.variante);
  assert.ok(vus.includes(CARRE_A) && !vus.includes(CARRE_B), 'image 1 : carré A seul');
  assert.strictEqual(vus.length, decor.filter((p) => p.avant !== false).length + decor.filter((p) => p.avant === false).length + 1,
    'le décor commun est entier à l’image 1');

  // La tenue : 2 tics sur l'image 1, 3 sur l'image 2, puis on reboucle.
  const suite = [];
  for (let i = 0; i < 10; i++) { mo.avancer(); suite.push(film.frame); }
  // Le premier `avancer` consomme l'image de naissance (le clip est neuf).
  assert.deepStrictEqual(suite, [1, 1, 2, 2, 2, 1, 1, 2, 2, 2], 'chaque image tient sa tenue, en boucle');
});

test('un niveau qui naît à l’image 2 prend quand même la couleur du joueur', async () => {
  const defs = await lire();
  const paths = [
    { d: CARRE_A, fill: 'rgb(255,255,255)', slot: 1 },                // décor teint
    { d: CARRE_B, fill: 'rgb(255,255,255)', slot: 2, image: 2 },      // naît plus tard
    { d: 'M30 30 L35 30 L35 35 Z', fill: '#000', image: 1 },
  ];
  const inj = Variante.injecter(defs, { type: CASQUETTE, paths, anim: { durees: [1, 1] }, coiffureRef: 8 });
  const mo = monter(defs, inj.variante, [21, 17, 24]);
  const film = pelliculeDe(accDe(mo));
  const niveaux = () => Array.from(film.enfants.values())
    .filter((e) => e.objet && e.objet.def.varTeinte)
    .map((e) => ({ s: e.objet.def.varTeinte, t: e.objet.teinte }));

  const a = niveaux();
  assert.deepStrictEqual(a.map((n) => n.s), [1], 'image 1 : le seul niveau 1');
  assert.strictEqual(a[0].t, Moteur.PALETTE[21]);

  mo.avancer(); mo.avancer();                    // naissance, puis image 2
  assert.strictEqual(film.frame, 2);
  const b = niveaux();
  const n2 = b.find((n) => n.s === 2);
  assert.ok(n2, 'image 2 : le niveau 2 est né');
  assert.strictEqual(n2.t, Moteur.PALETTE[17], 'avec la couleur 2 du joueur, posée bien après apply()');
  assert.strictEqual(b.find((n) => n.s === 1).t, Moteur.PALETTE[21], 'et le décor garde la sienne');

  // L'export lit les niveaux par la teinte : la sentinelle traverse donc la
  // pellicule, et le gabarit d'une image retrouve ses calques « couleurN ».
  const gab = Variante.exporter(defs, CASQUETTE, inj.variante, 8);
  assert.deepStrictEqual(gab.filter((p) => p.avant !== false).map((p) => p.slot), [1, 0]);
});

test('le décor commun n’est fabriqué qu’une fois pour toute la pellicule', async () => {
  const defs = await lire();
  const paths = [
    { d: CARRE_A, fill: '#123456' },
    { d: CARRE_B, fill: '#ff0000', image: 1 },
    { d: CARRE_B, fill: '#00ff00', image: 2 },
    { d: CARRE_B, fill: '#0000ff', image: 3 },
  ];
  const inj = Variante.injecter(defs, { type: CASQUETTE, paths, anim: { durees: [1, 1, 1] }, coiffureRef: 8 });
  const film = pelliculeDe(accDe(monter(defs, inj.variante)));
  const etats = Moteur.etatsDe(film.def);
  const formesDuDecor = new Set(etats.map((st) => {
    for (const [, e] of st) {
      const f = defs.formes.get(e.ch);
      if (f && f.couches[0].rgb.join(',') === '18,52,86') return e.ch;
    }
    return null;
  }));
  assert.strictEqual(formesDuDecor.size, 1, 'les trois images posent la MÊME forme pour le décor');
});

test('l’arrière d’une variante animée tourne aussi', async () => {
  const defs = await lire();
  const paths = [
    { d: CARRE_A, fill: '#000' },
    { d: CARRE_B, fill: '#ff0000', avant: false, image: 1 },
    { d: CARRE_B, fill: '#00ff00', avant: false, image: 2 },
  ];
  const inj = Variante.injecter(defs, { type: CASQUETTE, paths, anim: { durees: [2, 2] }, coiffureRef: 8 });
  const mo = monter(defs, inj.variante);
  const accAr = enf(enf(enf(mo.racine.face, 'cb'), 'c'), 'acc');
  assert.ok(accAr, 'la casquette a une couche arrière');
  const filmAr = pelliculeDe(accAr), filmAv = pelliculeDe(accDe(mo));
  assert.ok(filmAr, 'la couche arrière pose sa pellicule');
  assert.ok(filmAv === null, 'le devant, sans rien d’animé, reste une variante fixe');
  assert.ok(mo.enMouvement(), 'mais la bouille, elle, bouge');
});

test('une variante FIXE ne garde que sa première image, et ne bouge pas', async () => {
  const defs = await lire();
  const paths = [
    { d: CARRE_A, fill: '#ff0000', image: 1 },
    { d: CARRE_B, fill: '#00ff00', image: 2 },
  ];
  const inj = Variante.injecter(defs, { type: CASQUETTE, paths, coiffureRef: 8 });
  const mo = monter(defs, inj.variante);
  assert.ok(pelliculeDe(accDe(mo)) === null, 'pas de pellicule');
  assert.strictEqual(mo.enMouvement(), false, 'rien ne tourne');
  assert.deepStrictEqual(peints(defs, inj.variante), [CARRE_A], 'l’image 2 ne s’empile pas sur la 1');
});

test('le gabarit d’une variante animée rend ses calques « imageN_xT »', async () => {
  const defs = await lire();
  const source = {
    paths: [
      { d: CARRE_A, fill: '#000' },
      { d: CARRE_B, fill: 'rgb(255,255,255)', slot: 1, image: 1 },
      { d: CARRE_B, fill: '#ff0000', image: 2 },
      { d: 'M0 0 L1 1 Z', fill: '#000', image: 9 },              // au-delà : tombe
    ],
    anim: { durees: [4, 6] },
  };
  const svg = Variante.exporterSVG(defs, { type: CASQUETTE, variante: 0, coiffure: 8, source });
  assert.match(svg, /<g id="image1_x4">[\s\S]*<g id="couleur1">[\s\S]*<\/g>\s*<\/g>/, 'image 1, niveau 1 dedans');
  assert.match(svg, /<g id="image2_x6">/, 'image 2 et sa tenue');
  assert.doesNotMatch(svg, /image9/, 'une image hors pellicule ne ressort pas');
  assert.match(svg, /animée sur 2 images/);
  // Le décor commun reste HORS des calques d'image.
  const avant = svg.slice(svg.indexOf('<g id="accessoire">'));
  assert.ok(avant.indexOf(CARRE_A) < avant.indexOf('image1_x4'), 'le décor est posé à sa place, hors images');
});

/* ── LE SERVEUR : ce qu'il garde d'une animation ─────────────────────────── */

const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
// Les nettoyeurs, tirés tels quels de server.js (ils ne dépendent de rien).
const bloc = SERVEUR.slice(SERVEUR.indexOf('const BLENDS_MAISON'),
  SERVEUR.indexOf('// Les trois niveaux de couleur d\'un accessoire'));
const S = new Function(bloc + '\nreturn { pathsDeVariante, nettoyerAnim };')();

test('serveur : une animation se borne, et une variante fixe perd ses marques', () => {
  assert.strictEqual(S.nettoyerAnim(null), null);
  assert.strictEqual(S.nettoyerAnim({ durees: [3] }), null, 'une image n’anime rien');
  assert.deepStrictEqual(S.nettoyerAnim({ durees: [0, 2.6, 500, 'x'] }), { durees: [1, 3, 96, 1] });
  assert.strictEqual(S.nettoyerAnim({ durees: new Array(50).fill(2) }).durees.length, 32);

  const paths = [
    { d: 'M0 0 L1 1', fill: '#000' },
    { d: 'M1 1 L2 2', fill: '#000', image: 1 },
    { d: 'M2 2 L3 3', fill: '#000', image: 2 },
    { d: 'M3 3 L4 4', fill: '#000', image: 3 },
  ];
  const anime = S.pathsDeVariante({ paths, anim: { durees: [2, 4] } });
  assert.deepStrictEqual(anime.anim, { durees: [2, 4] });
  assert.deepStrictEqual(anime.paths.map((p) => p.image || 0), [0, 1, 2], 'l’image 3 n’existe pas : elle tombe');

  const fixe = S.pathsDeVariante({ paths });
  assert.strictEqual(fixe.anim, null);
  assert.deepStrictEqual(fixe.paths.map((p) => p.d), ['M0 0 L1 1', 'M1 1 L2 2'], 'seule l’image 1 reste');
  assert.ok(fixe.paths.every((p) => p.image === undefined), 'et sans marque');

  // Une pellicule a droit à plus de tracés qu'une variante fixe.
  const beaucoup = new Array(900).fill(0).map((_, i) => ({ d: 'M' + i + ' 0', fill: '#000', image: 1 + (i % 2) }));
  assert.strictEqual(S.pathsDeVariante({ paths: beaucoup, anim: { durees: [1, 1] } }).paths.length, 900);
  assert.strictEqual(S.pathsDeVariante({ paths: beaucoup }).paths.length, 250, '500 lus, la moitié en image 1');
});

test('serveur : l’animation voyage avec le catalogue et se range en base', () => {
  const pub = SERVEUR.slice(SERVEUR.indexOf("app.get('/api/light/variantes'"),
    SERVEUR.indexOf("app.get('/api/admin/variantes'"));
  assert.match(pub, /anim: \(!v\.retire && v\.anim\) \? v\.anim : null,/);
  const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(DB, /ALTER TABLE bouille_variantes ADD COLUMN IF NOT EXISTS anim TEXT;/);
  assert.match(DB, /purge = EXCLUDED\.purge, anim = EXCLUDED\.anim/);
  // Retirer ou purger arrête l'animation avec le dessin.
  assert.match(SERVEUR, /v\.retire = true; v\.paths = \[\]; v\.anim = null;/);
  // Et la vignette — le chemin de tout le site — passe l'animation au moteur.
  const VIG = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
  assert.match(VIG, /V\.injecter\(defs, \{ type: v\.type, paths: v\.paths \|\| \[\], anim: v\.anim \|\| null,/);
});
