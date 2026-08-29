'use strict';
/*
 * FRUTISNAKE — LA FLUIDITÉ, ET LA BOMBE.
 *
 * « Plusieurs joueurs disent qu'en fin de partie, le serpent est plus "lourd"
 *   à manœuvrer, comme s'il y avait du ping. D'autres disent que le jeu est
 *   plus saccadé/moins fluide que sur Flash. »
 * « Il y a un bug avec l'animation du bomb-assist quand on met le jeu en
 *   pause (ça ne met pas en pause le bomb assist) + il manque le décompte
 *   lors de l'explosion de la bombe. »
 *
 * ── CE QUE LA BOUCLE FAISAIT ──────────────────────────────────────────────
 * Le moteur avance par pas fixes de 1/40 s (la cadence du SWF), et c'est
 * juste : tout ce que le jeu fait « une fois par image » en dépend. Deux
 * choses autour, en revanche, ne l'étaient pas.
 *
 *   1. LE DESSIN suivait la cadence de l'ÉCRAN. Sur un 60 Hz, soixante images
 *      par seconde pour quarante états : vingt répétaient la précédente, et
 *      la séquence 2-1-2-1 se voit — c'est le « moins fluide que sur Flash »,
 *      qui affiche quarante images toutes différentes. Sur un 120 Hz, deux
 *      images sur trois étaient du travail perdu, et c'est ce travail-là qui
 *      manquait pour tenir les quarante pas en fin de partie, quand le
 *      serpent est long (`dessinerSerpent` trace un `stroke()` par segment et
 *      par passe : le coût croît avec la longueur — mesuré au banc,
 *      scratchpad/bench-snake.js).
 *
 *   2. LE RATTRAPAGE allait jusqu'à VINGT pas (`MAX_DELTA_TIME × 40`). Une
 *      machine qui perdait une demi-seconde les jouait tous avant de
 *      dessiner : le serpent traversait un demi-écran d'un bond. C'est très
 *      exactement « comme s'il y avait du ping ». Flash ne rattrape pas — il
 *      tourne au ralenti et laisse filer le temps perdu.
 *
 * ── LA BOMBE ──────────────────────────────────────────────────────────────
 * `partie.main` rend la main tout de suite en pause, mais le `main` du MODE
 * continuait derrière : la mèche brûlait, les enrobages, les bulles de
 * points, les particules et les clips des cases avançaient. En Flash, la
 * pause arrête le clip — rien ne joue derrière le voile.
 *
 * Et l'assistant montrait l'arc de la mèche sans jamais dire COMBIEN de
 * secondes il restait — le chiffre qu'on lit d'un coup d'œil pour décider de
 * traverser ou de contourner.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GAME = fs.readFileSync(path.join(ROOT, 'public/snake3/game.js'), 'utf8');
const RENDU = fs.readFileSync(path.join(ROOT, 'public/snake3/rendu.js'), 'utf8');
const PARTIE = fs.readFileSync(path.join(ROOT, 'public/snake3/partie.js'), 'utf8');
const CONST = fs.readFileSync(path.join(ROOT, 'public/snake3/const.js'), 'utf8');

/* ── 1. LA CADENCE ────────────────────────────────────────────────────────── */

test('on ne dessine que ce qui a changé', () => {
  const f = /const cadre = \(maintenant\) => \{[\s\S]*?\n    \};/.exec(GAME);
  assert.ok(f, 'la boucle doit exister');
  assert.match(f[0], /if \(n > 0\) this\.dessiner\(\);/,
    'pas de pas, pas d’image — la cadence retombe sur les 40 du SWF');
  // Et le pas reste FIXE : c'est lui qui garde les clips à la bonne vitesse.
  assert.match(GAME, /const PAS = 1 \/ C\.SWF_FPS;/);
  assert.match(CONST, /C\.SWF_FPS = 40;/);
});

test('le rattrapage ne téléporte plus le serpent', () => {
  // Vingt pas d'un coup, c'était un demi-écran sans image intermédiaire.
  assert.ok(!/RATTRAPAGE = Math\.ceil\(C\.MAX_DELTA_TIME \* C\.SWF_FPS\)/.test(GAME),
    'le rattrapage ne se calcule plus sur MAX_DELTA_TIME');
  assert.match(GAME, /const RATTRAPAGE = 3;/);
  // Le reste du temps est abandonné, comme le lecteur d'origine le fait.
  assert.match(GAME, /if \(n === RATTRAPAGE\) retard = 0;/);
});

/* ── 2. LA PAUSE ──────────────────────────────────────────────────────────── */

test('la pause arrête tout, pas seulement le moteur', () => {
  // `partie.main` sort tout de suite…
  assert.match(PARTIE, /main\(tmod, deltaT\) \{\s*\n\s*\/\/ La pause[\s\S]*?\n      return;\n    \}/);
  // …et le mode s'arrête juste derrière.
  const f = /main\(tmod, deltaT\) \{\s*\n\s*const partie = this\.partie;[\s\S]*?\n    if \(partie\.pause\) return;/.exec(GAME);
  assert.ok(f, 'le mode doit s’arrêter sur la pause');
  // L'arrêt vient APRÈS `partie.main` — c'est lui qui garde la main sur la
  // touche qui LÈVE la pause.
  assert.ok(f[0].indexOf('partie.main(tmod, deltaT);') < f[0].indexOf('if (partie.pause) return;'));
});

test('la mèche des bombes ne brûle plus derrière le voile', () => {
  // Elle est mise à jour dans le `main` du mode, donc après le retour anticipé.
  const f = /main\(tmod, deltaT\) \{\s*\n\s*const partie = this\.partie;[\s\S]*?\n  \}/.exec(GAME);
  assert.ok(f, 'le main du mode doit exister');
  assert.ok(f[0].indexOf('if (partie.pause) return;') < f[0].indexOf('b.meche -= deltaT;'),
    'la mèche est derrière le garde-fou');
  assert.ok(f[0].indexOf('if (partie.pause) return;') < f[0].indexOf('this.particules.main(tmod);'),
    'les particules aussi');
  assert.ok(f[0].indexOf('if (partie.pause) return;') < f[0].indexOf('for (const p of this.popups) p.main(deltaT);'),
    'et les bulles de points');
});

/* ── 3. LE DÉCOMPTE ───────────────────────────────────────────────────────── */

test('la bombe dit combien de secondes il reste', () => {
  const f = /if \(reste > 0\) \{[\s\S]*?\n    \}\n    ctx\.restore\(\);/.exec(RENDU);
  assert.ok(f, 'le bloc de l’arc doit exister');
  // Arrondi VERS LE HAUT, avec un plancher à 1 : « 1 » couvre la dernière
  // seconde, et le zéro n'apparaît jamais avant que ça saute.
  assert.match(f[0], /const secondes = Math\.max\(1, Math\.ceil\(b\.meche \|\| 0\)\);/);
  // Les chiffres du JEU (asml.NumberMC), pas une police du navigateur — et
  // la couleur suit le danger, comme le reste de l'assistant.
  assert.match(f[0], /const police = d\.niveau === 2 \? 'chiffresRouge'/);
  assert.match(f[0], /d\.niveau === 1 \? 'chiffresJaune' : 'chiffresVert'/);
  assert.match(f[0], /b\._compte = new D\.Nombre\(police\);/);
  assert.match(f[0], /b\._compte\.centre = true;/);
  // Le clip est reconstruit quand la couleur change (le danger monte).
  assert.match(f[0], /if \(!b\._compte \|\| b\._compte\.police !== police\)/);
  // Les trois polices existent bien, et le jeu les précharge.
  assert.match(GAME, /'chiffresVert', 'chiffresRouge', 'chiffresJaune'/);
});

test('le chiffre grossit sur la dernière seconde', () => {
  const f = /const k = 2\.4 \+ \(reste < 1 \/ C\.TIME_BOMBE \? \(1 - reste \* C\.TIME_BOMBE\) \* 1\.4 : 0\);/.exec(RENDU);
  assert.ok(f, 'l’échelle doit enfler à la fin');
  assert.match(RENDU, /b\._compte\.dessiner\(ctx, b\.x, b\.y, k\);/);
  assert.match(CONST, /C\.TIME_BOMBE = 5;/);
});
