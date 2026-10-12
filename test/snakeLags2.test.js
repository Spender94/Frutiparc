/*
 * LES LAGS PENDANT LA PARTIE — les documents SVG et le ramasse-miettes.
 *
 * « Toujours quelques lags pendant les parties. Les lags sont très courts mais
 *   fréquents. »
 *
 * Après les lags du début (snakeLags.test.js), il en restait de courts et de
 * réguliers, en solo comme en bataille, sur une machine qui pourtant ne fait
 * rien de lourd : le profil d'une partie (scratchpad snake-lags, Chromium,
 * CPU ×1, quarante secondes) montrait trois ramassages complets du moteur
 * JavaScript de 104, 60 et 18 ms — et neuf images de plus de 25 ms, jusqu'à
 * 117 — pour un tas JS de… trois mégaoctets. Le temps n'était pas dans le tas :
 * il était dans les MILLE CENT DOCUMENTS SVG que le jeu gardait vivants, un
 * par dessin décodé (une Image dont la source est un SVG porte un document
 * entier : sa page, son arbre, ses styles — trente-cinq mille nœuds en tout),
 * et que chaque ramassage complet doit parcourir. Mesuré : un ramassage
 * complet forcé durait 125 à 170 ms avec ces documents, 12 ms sans. Le
 * navigateur en déclenche un toutes les cinq à dix secondes de partie
 * (« memory reducer », puis la croissance ordinaire du tas) : c'est le lag.
 *
 * La réponse (dessin.js, « les documents SVG ne restent pas en vie ») :
 *   · un dessin décodé se peint au palier 1 dès son décodage (les petits : un
 *     fruit, une option, un chiffre), et son document est RELÂCHÉ en fin
 *     d'image d'écran (`relacher`, appelé par la boucle du jeu) — src retiré,
 *     élément oublié ; restent sa SOURCE (le blob du lot, qu'on ne révoque
 *     plus), sa TAILLE, et son tampon ;
 *   · un palier manquant, ou une autre densité, REDÉCODE le dessin depuis sa
 *     source, et le dernier tampon peint tient la place d'ici là (`secours`) :
 *     rien ne clignote ;
 *   · la chauffe remet à plus tard ce qui se redécode, et finit son travail ;
 *   · les grands dessins (écrans, pages : plus de 150 pixels) ne se décodent
 *     plus d'avance — ils ne servent qu'à l'écran, et leur tampon pèserait
 *     des mégaoctets ;
 *   · et un document ne part JAMAIS avant que son `load` ne soit passé : une
 *     image relancée depuis un blob déjà en cache est `complete` sur-le-champ
 *     alors que son `load` n'est que mis en file — la relâcher à ce moment-là
 *     annulait l'événement, et le décodeur comptait un décodage de trop pour
 *     toujours (plus aucune vague ne partait).
 *
 * Même partie, même pilote, après : aucune image de plus de 25 ms sur
 * quarante secondes, ramassage complet le plus long 18,7 ms (contre 104),
 * ramassage forcé en partie 10 à 13 ms (contre 125 à 170).
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DESSIN = lire('public/snake3/dessin.js');
const GAME = lire('public/snake3/game.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Un navigateur de poche ─────────────────────────────────────────────────
 * Une Image qui « décode » au tour suivant (ou, en mode `cache`, qui est
 * `complete` tout de suite mais dont le `load` n'arrive qu'après — ce que fait
 * Chromium pour un blob déjà en cache) ; un document qui ne sait faire que des
 * canevas ; un fetch qui sert un lot ; pas d'ouvrier. */
const journal = { relachees: [], revoquees: [], peintes: 0, images: [] };
let modeCache = false;
class FausseImage {
  constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; this._ecouteurs = {}; journal.images.push(this); }
  addEventListener(t, f) { (this._ecouteurs[t] = this._ecouteurs[t] || []).push(f); }
  removeAttribute(n) { if (n === 'src') { journal.relachees.push(this._src); this._src = undefined; } }
  set src(v) {
    this._src = v;
    if (modeCache) { this.complete = true; this.naturalWidth = 10; this.naturalHeight = 12; }
    setTimeout(() => {
      this.complete = true; this.naturalWidth = 10; this.naturalHeight = 12;
      for (const f of (this._ecouteurs.load || [])) f();
    }, 2);
  }
  get src() { return this._src; }
}
function fauxCanvas() {
  const c = { width: 0, height: 0 };
  c.getContext = () => ({
    drawImage: (src) => { if (src instanceof FausseImage) journal.peintes++; },
    getImageData: () => ({}), fillRect() {}, fillStyle: '', globalCompositeOperation: '',
  });
  return c;
}
function lotDe(prefixe, n) {
  const lot = {};
  for (let i = 1; i <= n; i++) lot[prefixe + i + '.svg'] = '<svg/>';
  return lot;
}
function poserNavigateur(lots) {
  globalThis.Image = FausseImage;
  globalThis.document = { createElement: (t) => (t === 'canvas' ? fauxCanvas() : {}) };
  globalThis.SnakeLots = { lots: Object.fromEntries(Object.keys(lots).map((n) => [n, 'lots/' + n + '.json'])), manifeste: 'sprites.json' };
  globalThis.fetch = (url) => {
    const nom = Object.keys(lots).find((n) => url.endsWith('lots/' + n + '.json'));
    return Promise.resolve({ ok: !!nom, json: () => Promise.resolve(lots[nom]) });
  };
  const revoquer = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (u) => { journal.revoquees.push(u); revoquer(u); };
}
const D = require('../public/snake3/dessin.js');

// Le manifeste : un fruit (petit), un écran (grand), une option avec sa suite.
const MANIFESTE = {
  clips: {
    fruits: { frames: { 1: { fichier: 'arene1.svg', cadre: { x: -5, y: -6, w: 30, h: 40 } },
      2: { fichier: 'arene2.svg', cadre: { x: 0, y: 0, w: 30, h: 40 } } } },
    screens: { frames: { 1: { fichier: 'arene3.svg', cadre: { x: 0, y: 0, w: 700, h: 480 } } } },
    options: { frames: { 1: { fichier: 'arene4.svg', cadre: { x: 0, y: 0, w: 60, h: 60 },
      anim: [{ fichier: 'arene5.svg', cadre: { x: 0, y: 0, w: 60, h: 60 } }] } } },
  },
  cadres: {},
};

test('un petit dessin se peint au palier 1 à son décodage, et son document part en fin d’image — pas sa source', async () => {
  poserNavigateur({ arene: lotDe('arene', 5) });
  D.poserManifeste(MANIFESTE);
  D.freiner(false);
  assert.strictEqual(await D.chargerLot('arene'), true);
  // Le grand dessin n'a pas fait la file : jamais décodé, mais sa source est là.
  assert.strictEqual(D.estGrand('arene3.svg'), true);
  assert.strictEqual(D.estGrand('arene1.svg'), false);
  let e = D.etatImages();
  assert.strictEqual(e.sources, 5, 'les cinq adresses du lot sont gardées');
  assert.strictEqual(e.tailles, 4, 'quatre décodés — l’écran attend sa première apparition');
  assert.strictEqual(e.tampons, 4, 'chaque petit dessin a son tampon de palier 1');
  assert.strictEqual(journal.peintes, 4);
  assert.strictEqual(e.vivantes, 4, 'les documents attendent la fin de l’image d’écran');
  assert.deepStrictEqual(journal.revoquees, [], 'aucune adresse blob révoquée : on redécode d’ici');
  // La fin de l'image : la boucle appelle relacher().
  D.relacher();
  e = D.etatImages();
  assert.strictEqual(e.vivantes, 0, 'plus un document vivant');
  assert.strictEqual(journal.relachees.length, 4);
  assert.ok(journal.relachees.every((u) => /^blob:/.test(u)), 'les src retirés étaient les blobs du lot');
  // …et le tampon sert toujours : dessiner ne redécode rien.
  const n = journal.images.length;
  const r = D.rendre('fruits', 1, 1);
  assert.ok(r && !r.secours && r.kp === 1);
  assert.strictEqual(r.dx, -5, 'le cadre du manifeste');
  assert.strictEqual(journal.images.length, n, 'pas de nouvelle Image');
});

test('un palier manquant redécode depuis le blob, et le secours tient la place sans clignoter', async () => {
  const n = journal.images.length;
  const avant = D.rendre('fruits', 1, 1);
  const s = D.rendre('fruits', 1, 2);          // le saut du fruit : palier 2
  assert.ok(s, 'quelque chose à dessiner tout de suite');
  assert.strictEqual(s.secours, true, 'c’est le secours…');
  assert.strictEqual(s.c, avant.c, '…le tampon du palier 1, à la géométrie demandée');
  assert.strictEqual(s.dx, -5);
  assert.strictEqual(journal.images.length, n + 1, 'un redécodage lancé');
  const im = journal.images[n];
  assert.match(im.src, /^blob:/, 'depuis la source gardée, pas depuis le réseau');
  assert.strictEqual(D.etatDecodeur().enCours, 1);
  // Rien n'est mis en cache sous la clef du palier 2 tant que c'est un secours.
  assert.strictEqual(D.etatImages().tampons, 4);
  await wait(10);
  const apres = D.rendre('fruits', 1, 2);
  assert.ok(apres && !apres.secours && apres.kp === 2, 'le vrai tampon du palier 2');
  assert.notStrictEqual(apres.c, avant.c);
  assert.strictEqual(D.etatImages().tampons, 5);
  D.relacher();
  assert.strictEqual(D.etatImages().vivantes, 0, 'et le document repart');
  assert.strictEqual(D.etatDecodeur().enCours, 0);
});

test('une variante (teinte) d’un secours est un secours : rien ne s’inscrit sous sa clef', async () => {
  D.poserDensite(2);                           // une autre densité : les tampons sont vidés…
  assert.strictEqual(D.etatImages().tampons, 0);
  assert.strictEqual(D.etatImages().secours, 4, '…mais pas les secours (un par dessin peint, tous paliers confondus)');
  const t = D.rendreTeinte('fruits', 1, 1, '#000000');
  assert.ok(t && t.secours === true, 'l’ombre tient la place aussi');
  assert.strictEqual(D.etatImages().tampons, 0, 'rien en cache tant que ça se redécode');
  await wait(10);
  const t2 = D.rendreTeinte('fruits', 1, 1, '#000000');
  assert.ok(t2 && !t2.secours, 'puis la vraie ombre, à la nouvelle densité');
  assert.strictEqual(D.etatImages().tampons, 2, 'le tampon et sa teinte');
  D.relacher();
  assert.strictEqual(D.etatImages().vivantes, 0);
  D.poserDensite(1);
});

test('la chauffe remet à plus tard ce qui se redécode, et finit son travail', async () => {
  // La densité vient de changer deux fois : on remet le palier 1 du fruit 1.
  assert.strictEqual(D.rendre('fruits', 1, 1).secours, true);
  await wait(10);
  assert.ok(!D.rendre('fruits', 1, 1).secours);
  D.relacher();
  const pr = D.chauffer([{ cle: 'fruits', frame: 2, k: 4 }, { cle: 'fruits', frame: 1, k: 1 }]);
  assert.strictEqual(D.chaufferPendant(50), 1, 'le palier 1 est là, le palier 4 se redécode');
  assert.strictEqual(D.chauffeEnAttente(), true, 'l’entrée remise attend la tranche suivante');
  await wait(10);
  assert.strictEqual(D.chaufferPendant(50), 1, 'et passe à la tranche suivante');
  assert.strictEqual(await pr, 2);
  assert.ok(D.rendre('fruits', 2, 4) && D.rendre('fruits', 2, 4).kp === 4);
  D.relacher();
  assert.strictEqual(D.etatImages().vivantes, 0);
});

test('un grand dessin ne se décode qu’à sa première demande, puis son document part aussi', async () => {
  const n = journal.images.length;
  assert.strictEqual(D.rendre('screens', 1, 1), null, 'jamais décodé : rien à montrer, le décodage part');
  assert.strictEqual(journal.images.length, n + 1);
  assert.match(journal.images[n].src, /^blob:/, 'depuis le blob du lot');
  await wait(10);
  const r = D.rendre('screens', 1, 1);
  assert.ok(r && !r.secours);
  assert.strictEqual(D.etatImages().vivantes, 1);
  D.relacher();
  assert.strictEqual(D.etatImages().vivantes, 0);
});

test('precharger ne redécode pas un dessin déjà peint, et la suite d’une option se décode à l’amorce', async () => {
  const n = journal.images.length;
  await D.precharger(['fruits']);
  assert.strictEqual(journal.images.length, n, 'rien relancé : les deux fruits sont peints');
  D.amorcerAnimations(['options']);
  assert.strictEqual(journal.images.length, n + 1, 'l’image de la suite part');
  await wait(10);
  assert.ok(D.rendreAnim('options', 1, 0, 1) && !D.rendreAnim('options', 1, 0, 1).secours);
});

test('une image relancée depuis le cache n’est pas relâchée avant son load — le décodeur ne se bloque plus', async () => {
  // Le décodage « instantané » du navigateur : complete tout de suite, load après.
  modeCache = true;
  D.poserDensite(3);                           // tout à repeindre : le fruit se redécode
  // L'image est complete d'emblée : le tampon se peint depuis elle tout de suite…
  const r = D.rendre('fruits', 1, 1);
  assert.ok(r && !r.secours, 'peint depuis l’image déjà complete, sans passer par le secours');
  assert.strictEqual(D.etatDecodeur().enCours, 1, 'son load n’est pas passé');
  // …mais la fin d'image ne la relâche PAS : son load n'est pas venu.
  D.relacher();
  assert.strictEqual(D.etatImages().vivantes, 1, 'le document reste tant que load n’est pas passé');
  assert.deepStrictEqual(D.etatImages().enDecodage, ['arene1.svg']);
  await wait(10);
  assert.strictEqual(D.etatDecodeur().enCours, 0, 'le load est arrivé : le décodeur est libre');
  D.relacher();
  assert.strictEqual(D.etatImages().vivantes, 0);
  modeCache = false;
  D.poserDensite(1);
});

test('la boucle du jeu relâche en fin d’image, et le code dit pourquoi', () => {
  assert.match(GAME, /D\.relacher\(\);\s*\n\s*requestAnimationFrame\(cadre\);/, 'relacher() ferme chaque image d’écran');
  // Le drapeau `decodee` — et non `complete` — décide du relâchement.
  assert.match(DESSIN, /im\.decodee = true;/);
  assert.match(DESSIN, /if \(!im \|\| !im\.decodee \|\| !im\.naturalWidth \|\| !secours\.has\(fichier\)\) return;/);
  assert.match(DESSIN, /im\.removeAttribute\('src'\)/);
  // Les sources ne sont plus révoquées après décodage, et l'ouvrier n'est plus
  // prié de le faire.
  assert.ok(!/revoquer\(entree\.url\)/.test(DESSIN), 'l’adresse du blob survit au décodage');
  assert.ok(!/postMessage\(\{ revoquer/.test(DESSIN));
  // Le palier et la clef de cache se lisent dans la taille relevée, pas dans
  // un document qui n'est plus là.
  assert.match(DESSIN, /const taille = tailles\.get\(fichier\);/);
  assert.match(DESSIN, /if \(estGrand\(f\)\) continue;/, 'les grands dessins ne font pas la file');
  assert.match(DESSIN, /const GRAND = 150;/);
  assert.match(DESSIN, /if \(r\.secours\) return PLUS_TARD;/, 'la chauffe remet à plus tard');
});
