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

/*
 * LA CADENCE — le même piège que Mini-Wave et Minipixiz : l'en-tête du SWF dit
 * quarante (la fréquence de REDESSIN), mais la vitesse du jeu vient de
 * `Timer.tmod`, dont la référence est trente-deux images par seconde.
 *
 * Ici les noms sont obfusqués : impossible de chercher « wantedFPS ». On
 * reconnaît le bloc statique de Timer à ses VALEURS — les mêmes que dans
 * miniTroll et Mini-Wave : maxDeltaTime 0,5 / wantedFPS 32 / tmod_factor 0,95,
 * affectées coup sur coup dans le même bloc.
 */
test('la cadence du SWF est trente-deux images par seconde, et le portage suit', () => {
  const b = corps();
  // Les affectations `push <nom>, <valeur> ; setVariable` du bloc de Timer.
  const affectations = [];
  for (let o = 0; o < b.length - 8; o++) {
    if (b[o] !== 0x96) continue;                      // ActionPush
    const fin = o + 3 + b.readUInt16LE(o + 1);
    if (fin >= b.length || b[fin] !== 0x1d) continue; // suivi d'un SetVariable
    let q = o + 3;
    const pile = [];
    let bon = true;
    while (q < fin) {
      const t = b[q++];
      if (t === 0) { let e = q; while (b[e] !== 0) e++; pile.push(b.slice(q, e).toString('latin1')); q = e + 1; }
      else if (t === 1) { pile.push(b.readFloatLE(q)); q += 4; }
      else if (t === 5) { pile.push(!!b[q]); q += 1; }
      else if (t === 6) {
        const t8 = Buffer.alloc(8);
        b.copy(t8, 0, q + 4, q + 8); b.copy(t8, 4, q, q + 4);
        pile.push(t8.readDoubleLE(0)); q += 8;
      } else if (t === 7) { pile.push(b.readInt32LE(q)); q += 4; }
      // Les NOMS passent par la table de constantes (types 8 et 9) : leur
      // valeur importe peu ici, seule la paire nom-nombre compte.
      else if (t === 8) { pile.push('cst'); q += 1; }
      else if (t === 9) { pile.push('cst'); q += 2; }
      else { bon = false; break; }
    }
    if (!bon || pile.length !== 2 || typeof pile[1] !== 'number') continue;
    affectations.push({ o, valeur: pile[1] });
  }
  // Le bloc : 32, puis 0,5, puis 0,95, à quelques octets d'écart.
  const bloc = affectations.find((a, i) => a.valeur === 32
    && affectations[i + 1] && affectations[i + 1].valeur === 0.5
    && affectations.slice(i + 1, i + 4).some((x) => x.valeur === 0.95)
    && affectations[i + 1].o - a.o < 40);
  assert.ok(bloc, 'le bloc statique de Timer (32 / 0,5 / 0,95) est dans le SWF');

  const moteur = fs.readFileSync(path.join(ROOT, 'public/minifever/engine.js'), 'utf8');
  assert.match(moteur, /const IPS = 32;/, 'le moteur compte 32 unités par seconde');
  assert.match(moteur, /const TMOD_LISSAGE = 0\.95;/, 'le lissage de Timer.update');
  assert.match(moteur, /const TMOD_SAUT = 0\.5;/, 'et son saut d\'image');
  // La cadence d'APPEL vient de l'en-tête (40) : un update par image Flash,
  // recevant le tmod lissé — le modèle du lecteur, comme Mini-Wave.
  assert.match(moteur, /const CADENCE_FLASH = 40;/, 'la cadence d\'appel de l\'en-tête');
  const client = fs.readFileSync(path.join(ROOT, 'public/minifever/client.js'), 'utf8');
  assert.match(client, /this\.tmod = this\.tmod \* TMOD_LISSAGE \+ \(1 - TMOD_LISSAGE\) \* ecart \* IPS;/,
    'la boucle avance du tmod lissé, mesuré entre images exécutées');
  assert.match(client, /this\.socle\.update\(this\.tmod\)/, 'le socle reçoit le tmod fractionnaire');
  assert.match(client, /this\.attente = Math\.min\(this\.attente - IMAGE_FLASH, IMAGE_FLASH\);/,
    'une image au plus par rafraîchissement : l\'excédent est perdu, comme Flash');
});
