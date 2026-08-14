/*
 * MiniFever — retrouver quel dessin appartient à quel mini-jeu.
 *
 * MiniFever n'a jamais été mis en ligne. Il en reste les SOURCES (quatre-vingt-dix
 * mini-jeux écrits en « mt », le langage maison de Motion Twin dont le
 * compilateur n'existe plus) et un SWF de développement OBFUSQUÉ : ses cent
 * vingt et un symboles exportés portent des noms tirés au sort, et les noms de
 * classes ont disparu du binaire. Sans correspondance, l'art est inexploitable.
 *
 * Le fil qu'on tire : Manager.registerSymphony() enregistre les classes une par
 * une, dans un ORDRE FIXE. L'obfuscation a renommé les chaînes, pas réordonné
 * les appels. On relève donc dans le bytecode la suite des `registerClass` et on
 * l'aligne sur celle des sources.
 *
 * Ce fichier tient l'alignement : sa forme (vingt-huit classes, toutes exportées),
 * son décalage (ce build de développement n'enregistre ni les modes ni le menu),
 * et les correspondances VÉRIFIÉES À L'ŒIL sur un rendu des clips — gameBalance
 * montre une balance, gameMarmite une marmite, gameHammer un jeu de taupes au
 * maillet, gameLander un sol lunaire sous les étoiles. Si un jour l'alignement
 * glisse d'un cran, ces quatre-là le diront.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const SWF = path.join(ROOT, 'Games/miniFever/release/swf/minifever.swf');
const SPRITES = path.join(ROOT, 'public/minifever/sprites');
const outil = require(path.join(ROOT, 'scripts/extract-minifever-sprites.js'));
const { ouvrir } = require(path.join(ROOT, 'scripts/lib/swf-sprites.js'));

const corps = () => {
  const brut = fs.readFileSync(SWF);
  return brut.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(brut.slice(8)) : brut.slice(8);
};

test('le bytecode livre les classes enregistrées, toutes exportées', () => {
  const liens = outil.liensEnregistres(corps());
  assert.equal(liens.length, 28, 'ce build enregistre vingt-huit classes');
  const swf = ouvrir(SWF);
  const exportes = new Set([...swf.noms.keys()]);
  for (const l of liens) {
    assert.ok(exportes.has(l), `« ${l} » est un symbole exporté du SWF`);
    assert.ok(swf.estSprite(swf.noms.get(l)), `« ${l} » est bien un clip`);
  }
  assert.equal(new Set(liens).size, 28, 'aucun doublon');
});

test('l\'alignement sur les sources commence après le menu et couvre 27 mini-jeux', () => {
  const liens = outil.liensEnregistres(corps());
  const attendus = outil.classesDesSources();
  assert.equal(attendus.length, 96, 'les sources enregistrent quatre-vingt-seize classes');
  // Le décalage : ce build ne compile ni les quatre modes, ni le menu, ni
  // l'écran de félicitations (Manager.init() saute directement au mode Fever).
  assert.equal(outil.DECALAGE, 6);
  assert.deepEqual(attendus.slice(0, 7),
    ['baseArcade', 'baseFever', 'baseChrono', 'baseTrain', 'menu', 'congrat', 'gameOver']);
  const noms = liens.map((_, i) => attendus[i + outil.DECALAGE]);
  assert.equal(noms[0], 'gameOver', 'le premier enregistré est l\'écran de fin');
  assert.equal(noms[1], 'gameBasket', 'puis le premier mini-jeu de la liste');
  assert.equal(noms[noms.length - 1], 'gameTaquin', 'et le dernier compilé est le taquin');
  // `gameOver` commence par « game » lui aussi : c'est l'écran de fin, pas un jeu.
  assert.equal(noms.filter((n) => /^game[A-Z]/.test(n) && n !== 'gameOver').length, 27,
    'vingt-sept mini-jeux');
  // Les soixante-deux suivants existent en source mais pas dans ce binaire.
  assert.equal(attendus.length - outil.DECALAGE - liens.length, 62);
});

/*
 * Le verrou : ces correspondances ont été établies en DESSINANT les clips.
 * Un décalage d'un seul cran les casserait toutes — c'est exactement ce qui
 * s'était produit au premier essai (l'alignement partait de baseArcade, et
 * « gameParachute » montrait une balance).
 */
test('les correspondances vérifiées à l\'œil tiennent', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SPRITES, 'sprites.json'), 'utf8'));
  for (const [classe, symbole, id] of [
    ['gameOver', '1DSXe4', 549],
    ['gameBasket', '40XPE1', 492],     // un terrain de basket vu de haut
    ['gameLander', '4oVVa6', 476],     // un sol lunaire sous les étoiles
    ['gameBalance', '60M2C5', 259],    // une balance à deux plateaux
    ['gameMarmite', '1SqgM6', 204],    // une marmite noire
    ['gameHammer', '2Xqdi1', 599],     // des taupes et leurs maillets
    ['gameTaquin', '4okHh2', 562],     // le fond de bois du taquin
  ]) {
    assert.ok(m[classe], `${classe} est dans le manifeste`);
    assert.equal(m[classe].symbole, symbole, `${classe} ← ${symbole}`);
    assert.equal(m[classe].id, id, `${classe} = clip #${id}`);
  }
});

test('les dessins sont extraits et complets', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SPRITES, 'sprites.json'), 'utf8'));
  assert.ok(Object.keys(m).length >= 110, 'plus de cent symboles');
  const jeux = Object.keys(m).filter((k) => /^game[A-Z]/.test(k) && k !== 'gameOver');
  assert.equal(jeux.length, 27, 'les vingt-sept mini-jeux compilés');

  let images = 0;
  const fichiers = new Set();
  for (const [cle, s] of Object.entries(m)) {
    assert.ok(Array.isArray(s.etats) && s.etats.length, `${cle} a des images`);
    for (const e of s.etats) {
      images++;
      assert.ok(Number.isInteger(e.frame) && e.frame >= 1, `${cle} : image numérotée`);
      assert.ok(e.pieces.length, `${cle} image ${e.frame} : au moins un dessin`);
      for (const p of e.pieces) {
        assert.ok(p.fichier && p.w > 0 && p.h > 0, `${cle} : pièce mesurée`);
        assert.equal(p.m.length, 6, 'une matrice de placement');
        fichiers.add(p.fichier);
      }
    }
  }
  assert.ok(images >= 500, `${images} images extraites`);
  // Chaque pièce citée existe vraiment sur le disque.
  for (const f of fichiers) {
    assert.ok(fs.existsSync(path.join(SPRITES, f)), `${f} est extrait`);
  }
  assert.ok(fichiers.size >= 150, `${fichiers.size} dessins distincts`);
});
