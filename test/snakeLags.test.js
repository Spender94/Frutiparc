/*
 * LES LAGS DU DÉBUT DE PARTIE — et pourquoi ils ne reviendront pas.
 *
 * « Je rencontre quelques petits lags sur le mode light » — « des freeze de
 * temps en temps » — « mini lag mais surtout au début ».
 *
 * Mesuré sur un téléphone bridé (scratchpad perf-lag, CPU ×4, DPR 3), pour un
 * joueur qui se rue sur « jouer » : quarante-cinq tâches de plus de cinquante
 * millisecondes dans les vingt-cinq premières secondes, quatre secondes et
 * demie de fil principal en tout — la moitié de chaque seconde pendant les huit
 * premières. Quatre causes, toutes au même endroit du temps :
 *
 *   1. les LOTS DE FOND (fruits tardifs, suites, livre : ~750 SVG, 4,5 Mo de
 *      JSON) se décodaient PENDANT la partie, par paquets de quarante — la
 *      lecture du JSON, un Blob et une adresse par fichier, puis le décodage
 *      de chaque SVG, tout sur le fil principal, tout pendant qu'on joue ;
 *   2. les PREMIÈRES RASTERISATIONS : décodé n'est pas rasterisé, et le fond,
 *      la frutibarre, les chiffres, chaque fruit et chaque option se peignaient
 *      à leur première apparition — cent quatre-vingts millisecondes rien que
 *      pour le premier tour d'arène ;
 *   3. le RIDEAU peignait le mode entier sous un masque qui n'en montre qu'une
 *      partie : trois pleins écrans par image pendant cinquante-trois images ;
 *   4. les VINGT-DEUX SONS se décodaient d'un coup au premier geste — pour un
 *      joueur au doigt, le tap sur « jouer » —, la musique de partie (632 ko)
 *      comprise.
 *
 * Les réponses, et ce que ces cas verrouillent :
 *   · la lecture des lots et leurs blobs passent dans un ouvrier ; le décodage
 *     des SVG passe par UNE file, par vagues — douze au fil libre, une toutes
 *     les soixante millisecondes en partie —, et un dessin demandé avant son
 *     tour passe devant depuis son blob ;
 *   · l'arène se CHAUFFE (rasterise) avant que le rideau ne s'ouvre, par
 *     tranches de quelques millisecondes, jamais pendant la partie ;
 *   · le rideau découpe le mode à la boîte de son masque ;
 *   · le contexte audio s'ouvre au menu, suspendu, et décode un son à la fois,
 *     musiques d'abord.
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
const SONS = lire('public/snake3/sons.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Un navigateur de poche : une Image qui « décode » au tour suivant, un
 * fetch qui sert un lot, pas d'ouvrier (Node n'a pas de Worker global). ── */
const decodees = [];
class FausseImage {
  constructor() { this.complete = false; this.naturalWidth = 0; this._ecouteurs = {}; }
  addEventListener(t, f) { (this._ecouteurs[t] = this._ecouteurs[t] || []).push(f); }
  set src(v) {
    this._src = v;
    setTimeout(() => {
      this.complete = true; this.naturalWidth = 10;
      decodees.push(v);
      for (const f of (this._ecouteurs.load || [])) f();
    }, 2);
  }
  get src() { return this._src; }
}
function lotDe(prefixe, n) {
  const lot = {};
  for (let i = 1; i <= n; i++) lot[prefixe + i + '.svg'] = '<svg/>';
  return lot;
}
function poserNavigateur(lots) {
  globalThis.Image = FausseImage;
  globalThis.SnakeLots = { lots: Object.fromEntries(Object.keys(lots).map((n) => [n, 'lots/' + n + '.json'])), manifeste: 'sprites.json' };
  globalThis.fetch = (url) => {
    const nom = Object.keys(lots).find((n) => url.endsWith('lots/' + n + '.json'));
    return Promise.resolve({ ok: !!nom, json: () => Promise.resolve(lots[nom]) });
  };
}
const D = require('../public/snake3/dessin.js');

// Le pic de décodages simultanés, relevé à la volée.
function surveiller() {
  const pics = { max: 0 };
  const t = setInterval(() => { pics.max = Math.max(pics.max, D.etatDecodeur().enCours); }, 1);
  return { pics, arreter: () => clearInterval(t) };
}

test('au fil libre, un lot se décode par vagues de douze — et la promesse tient jusqu’au dernier', async () => {
  poserNavigateur({ libre: lotDe('libre', 30) });
  D.freiner(false);
  const s = surveiller();
  const t0 = Date.now();
  const ok = await D.chargerLot('libre');
  s.arreter();
  assert.strictEqual(ok, true);
  assert.ok(Date.now() - t0 < 500, 'trente images en moins d’une demi-seconde au fil libre');
  assert.strictEqual(s.pics.max, D.VAGUE_LIBRE, 'jamais plus d’une vague en vol : ' + s.pics.max);
  assert.strictEqual(D.etatDecodeur().enFile, 0);
  for (let i = 1; i <= 30; i++) assert.ok(D.image('libre' + i + '.svg').complete, 'libre' + i);
});

test('en partie, une image à la fois, à petit pas — et tout repart quand la partie s’arrête', async () => {
  poserNavigateur({ partie: lotDe('partie', 20) });
  D.freiner(true);
  const s = surveiller();
  const pr = D.chargerLot('partie');
  await wait(200);
  const enFile = D.etatDecodeur().enFile;
  // Cent vingt millisecondes entre deux vagues d'une image : en deux cents
  // millisecondes, deux ou trois au plus sont passées.
  assert.ok(enFile >= 20 - 4 && enFile < 20, 'la file se vide à peine en partie : ' + enFile + ' restantes');
  assert.ok(s.pics.max <= D.VAGUE_PARTIE, 'jamais plus d’une image en vol en partie');
  // Et une machine à la peine (plus de trente millisecondes entre deux
  // images d'écran) ne décode plus rien du tout tant que ça dure.
  D.freiner(true, 45);
  const avant = D.etatDecodeur().enFile;
  await wait(300);
  assert.strictEqual(D.etatDecodeur().enFile, avant, 'rien ne bouge quand l’écran peine');
  D.freiner(true, 16);
  await wait(300);
  assert.ok(D.etatDecodeur().enFile < avant, 'et ça repart quand la cadence revient');
  D.freiner(false);
  const t0 = Date.now();
  assert.strictEqual(await pr, true);
  s.arreter();
  assert.ok(Date.now() - t0 < 500, 'et le reste vient d’un coup une fois le fil libre');
});

test('un dessin demandé avant son tour passe devant, depuis son blob', async () => {
  poserNavigateur({ presse: lotDe('presse', 20) });
  D.freiner(true);                       // la file avance au pas : tout attend
  const pr = D.chargerLot('presse');
  await wait(20);
  assert.ok(D.etatDecodeur().enFile > 10, 'le gros du lot attend encore');
  const im = D.image('presse15.svg');
  assert.ok(im instanceof FausseImage);
  assert.match(im.src, /^blob:/, 'décodé depuis son blob, pas depuis le réseau');
  assert.ok(!/\/snake3\/sprites\/presse15\.svg$/.test(im.src));
  await wait(10);
  assert.ok(im.complete, 'et il est là tout de suite');
  D.freiner(false);
  assert.strictEqual(await pr, true, 'le lot se termine quand même, sans compter deux fois ce fichier');
});

test('la chauffe et le décodeur savent qu’on joue, et c’est la boucle qui le leur dit', () => {
  // Chaque image de la boucle : freiner(enPartie()).
  assert.match(GAME, /const enPartie = this\.enPartie\(\);\s*\n\s*D\.freiner\(enPartie, dt \* 1000\);/);
  const enPartie = /enPartie\(\) \{[\s\S]*?\n  \}/.exec(GAME);
  assert.ok(enPartie, 'Jeu.enPartie');
  assert.match(enPartie[0], /if \(m\.partie\) return !m\.partie\.pause && !m\.partie\.game_over_flag;/, 'la pause et la fin de partie rendent le fil');
  assert.match(enPartie[0], /if \(m\.bataille\) return !m\.ecran;/);
  // La file : ses deux vagues, son pas en partie, l'ouvrier et son repli.
  assert.match(DESSIN, /const VAGUE_LIBRE = 12;/);
  assert.match(DESSIN, /const VAGUE_PARTIE = 1;/);
  assert.match(DESSIN, /const DELAI_PARTIE = 120;/);
  assert.match(DESSIN, /setTimeout\(lancer, decodeur\.frein \? DELAI_PARTIE : 0\);/);
  // …et pas du tout si l'écran n'a pas tenu sa cadence à l'image d'avant.
  assert.match(DESSIN, /const CADENCE_LIBRE = 30;/);
  assert.match(DESSIN, /if \(decodeur\.frein && decodeur\.cadence > CADENCE_LIBRE\) \{ programmerVague\(\); return; \}/);
  assert.match(GAME, /D\.freiner\(enPartie, dt \* 1000\);/, 'la boucle lui donne la cadence');
  assert.match(DESSIN, /const pr = lireLotParOuvrier\(nom, url\)\n\s+\.catch\(\(\) => lireLotIci\(url\)\)/, 'sans ouvrier, le lot se lit ici');
  assert.match(DESSIN, /ouvrier\.onerror = \(\) => \{/, 'un ouvrier qui tombe ne bloque personne');
  // La vague suivante ne part que lorsque la précédente est décodée.
  assert.match(DESSIN, /if \(decodeur\.enCours === 0\) programmerVague\(\);/);
  // La chauffe : des tranches que LA BOUCLE donne — vingt millisecondes
  // derrière un rideau tenu, six derrière le menu —, et rien en partie.
  assert.match(DESSIN, /function chaufferPendant\(budget\) \{\s*\n\s*if \(decodeur\.frein \|\| !chauffe\.file\.length\) return 0;/);
  assert.match(GAME, /if \(!enPartie && D\.chauffeEnAttente\(\)\) D\.chaufferPendant\(this\.rideauTenu\(\) \? 20 : 6\);/);
  assert.match(GAME, /return !!\(m instanceof Transition && !m\.reversed && m\.taille <= 0\);/);
  assert.ok(!/requestIdleCallback\(/.test(DESSIN), 'plus d’appel à requestIdleCallback : la boucle a le tempo');
  // …et chaque tampon est FORCÉ, sinon rien ne chauffe.
  assert.match(DESSIN, /s\.drawImage\(c, 0, 0, 1, 1, 0, 0, 1, 1\);/);
});

test('le rideau attend la chauffe de l’essentiel, et découpe le mode à son masque', () => {
  assert.match(GAME, /return this\.dessinsJeuPrets === true && this\.dessinsJeuChauds === true;/);
  assert.match(GAME, /return chaufferArene\(jeu, 'essentiel'\);\s*\n\s*\}\)\.then\(\(\) => \{\s*\n\s*jeu\.dessinsJeuChauds = true;/,
    'l’essentiel ouvre le rideau');
  // La suite ne retient ni le rideau ni les lots : elle n'est pas attendue,
  // et le lot des fruits tardifs part aussitôt — il se décodera au pas.
  assert.match(GAME, /chaufferArene\(jeu, 'suite'\)\.catch\(\(\) => \{\}\);\s*\n\s*return D\.chargerLot\('fruits2'\);/,
    'la suite chauffe sans retenir les lots de fond');
  assert.match(GAME, /jeu\.encycloPret = true;\s*\n[\s\S]*?return chaufferArene\(jeu, 'reste'\);/, 'le reste chauffe après le dernier lot');
  // L'essentiel est ce que le PREMIER TOUR pose : les fonds, la frutibarre,
  // le score, la tête, le terrier, les chiffres verts, les fruits de départ.
  // La suite : options, cases, bombes, langue, les chiffres aux paliers 2 et
  // 4. Le reste : le palier 2 des fruits, les ombres, les deux écrans.
  const liste = /function listeChauffeArene\(temps\) \{[\s\S]*?\n\}/.exec(GAME);
  assert.ok(liste, 'listeChauffeArene');
  const bloc = (nom) => {
    const i = liste[0].indexOf(nom === 'essentiel' ? "if (temps === 'essentiel')" : nom === 'suite' ? "else if (temps === 'suite')" : '} else {');
    const j = nom === 'essentiel' ? liste[0].indexOf("else if (temps === 'suite')") : nom === 'suite' ? liste[0].lastIndexOf('} else {') : liste[0].length;
    return liste[0].slice(i, j);
  };
  for (const attendu of ['backgroundBord.svg', 'backgroundField.svg', 'm.cadres.fbarre.pieces', "clip('barreScore', [1])",
    "clip('tete', [1])", "clip('chiffresVert', suiteEntiere(1, 10))", "clip('fruits', FRUITS_DEPART);"]) {
    assert.ok(bloc('essentiel').includes(attendu), 'essentiel : ' + attendu);
  }
  assert.ok(!bloc('essentiel').includes("clip('options'"), 'les options ne retiennent pas le rideau');
  for (const attendu of ["clip('options', suiteEntiere(1, 37));", "clip('slot', suiteEntiere(1, 46));", "clip('bombe', suiteEntiere(1, 22));",
    "for (const k of [1, 2, 4]) clip('langue', [1], k);", "clip(police, suiteEntiere(1, 10), k);"]) {
    assert.ok(bloc('suite').includes(attendu), 'suite : ' + attendu);
  }
  assert.ok(bloc('reste').includes("clip('fruits', FRUITS_DEPART, 2);"));
  assert.ok(bloc('reste').includes("clip('fruits', FRUITS_DEPART, 1, R.OMBRE_FRUIT);"));
  assert.ok(bloc('reste').includes("clip('screens', [ECRANS.pause]);"));
  // Le fond composé chauffe aussi, sur la géométrie de l'arène (Niveau).
  assert.match(GAME, /dessinerFondArene\(s\.getContext\('2d'\), jeu, niveau\);/);
  // Une densité qui change vide le cache : on rechauffe, sans retenir le rideau.
  assert.match(GAME, /if \(D\.DENSITE !== densiteAvant && this\.dessinsJeuPrets === true\) \{/);
  // Le rideau : découpé à la boîte du masque, et rien tant qu'il est tenu fermé.
  assert.match(GAME, /if \(k <= 0\) return;\n\s+\/\/ Le rideau va de 400 %/);
  assert.match(GAME, /t\.rect\(C\.WIDTH \/ 2 \+ masque\.dx \* k - 1, C\.HEIGHT \/ 2 \+ masque\.dy \* k - 1,\s*\n\s*masque\.lw \* k \+ 2, masque\.lh \* k \+ 2\);\s*\n\s*t\.clip\(\);\s*\n\s*this\.mode\.dessiner\(t\);/);
});

test('les sons : le contexte au menu, un décodage à la fois, les musiques d’abord', () => {
  assert.match(SONS, /charger\(\) \{[\s\S]*?this\.preparer\(\);[\s\S]*?fetch\(BASE \+ nom \+ '\.mp3'\)/, 'le contexte s’ouvre avec le téléchargement');
  assert.match(SONS, /const MUSIQUES = new Set\(\['menu_loop', 'game_loop'\]\);/);
  assert.match(SONS, /if \(MUSIQUES\.has\(nom\)\) this\.aDecoder\.unshift\(nom\); else this\.aDecoder\.push\(nom\);/);
  assert.match(SONS, /if \(this\.decodeEnCours \|\| !this\.aDecoder\.length\) return;/, 'un seul décodage en vol');
  assert.match(SONS, /const DECODAGE_PATIENCE = 10000;/);
  // Le premier geste réveille le contexte et relance ce qui manque.
  assert.match(SONS, /ouvrir\(\) \{\s*\n\s*this\.charger\(\);\s*\n\s*if \(!this\.preparer\(\)\) return;\s*\n\s*if \(this\.ctx\.state === 'suspended'\) this\.ctx\.resume\(\)/);
  assert.match(SONS, /for \(const nom of this\.bruts\.keys\(\)\) this\.decoder\(nom\);/);
  assert.match(SONS, /window\.addEventListener\('pointerup', ouvrir, \{ capture: true \}\);/);
});
