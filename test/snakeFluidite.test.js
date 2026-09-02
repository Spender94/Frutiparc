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
  assert.ok(f[0].indexOf('if (partie.pause) return;') < f[0].indexOf('p.main(deltaT);'),
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

/* ── 3. LE VIRAGE ──────────────────────────────────────────────────────────
 *
 * « Le serpent est saccadé quand il fait des virages. »
 *
 * Ce n'était pas la boucle, cette fois : c'était le TRACÉ. `draw_queue` pose
 * une seule quadratique par segment — de la file [n] à la file [n−5], point
 * de contrôle la file [n−2] — et cette courbe-là a deux défauts que la ligne
 * droite cache entièrement :
 *
 *   · elle ne passe PAS par les points intermédiaires : elle coupe le virage ;
 *   · et deux segments voisins ne se raccordent qu'en POSITION, pas en
 *     direction — la tangente saute au joint.
 *
 * Mesuré ci-dessous, sur un serpent à plein braquage (7,16°/image, 3,3 px par
 * image, soit 54° de virage par segment) : 27° de cassure à CHAQUE joint et
 * 1,8 px d'écart au chemin réellement parcouru. Dix segments, dix angles : le
 * corps devenait un polygone.
 *
 * On remplace la quadratique par cinq cubiques de Catmull-Rom — une par point
 * de file. Même segments, mêmes largeurs, mêmes couleurs, même voie rapide
 * au-delà de 1,7 de tmod : seule la courbe change, et elle passe désormais
 * exactement par la trace que la tête a semée.
 */

test('le corps suit sa trace, sans casser au joint', () => {
  const S = require('../public/snake3/serpent.js');
  const C = require('../public/snake3/const.js');

  const s = new S.Serpent({ x: 400, y: 300, hasard: () => 0, evenement: () => {} });
  s.len = 10;
  s.ang = 0;
  s.queue_collide = false;
  const bornes = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
  for (let i = 0; i < 100; i++) { s.ang += C.SNAKE_DEFAULT_TURN; s.old_ang = null; s.move(bornes, 1); }
  const q = s.queue;
  const pt = (k) => q[k < 0 ? 0 : (k >= q.length ? q.length - 1 : k)];

  // Le tracé, tel que rendu.js le pose : cinq cubiques par segment, la
  // tangente donnée par les voisins.
  const points = [];
  const tangentes = [];
  let n = q.length - 1, px = q[n].x, py = q[n].y;
  for (let i = s.len; i > 0; i--) {
    let av = pt(n + 1), ici = { x: px, y: py };
    const tSeg = [];
    for (let j = 1; j <= 5; j++) {
      const su = pt(n - j), ap = pt(n - j - 1);
      const c1 = { x: ici.x + (su.x - av.x) / 6, y: ici.y + (su.y - av.y) / 6 };
      const c2 = { x: su.x - (ap.x - ici.x) / 6, y: su.y - (ap.y - ici.y) / 6 };
      if (j === 1) tSeg.push([c1.x - ici.x, c1.y - ici.y]);
      if (j === 5) tSeg.push([su.x - c2.x, su.y - c2.y]);
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t;
        points.push({
          x: u * u * u * ici.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * su.x,
          y: u * u * u * ici.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * su.y,
        });
      }
      av = ici; ici = su;
    }
    tangentes.push(tSeg);
    px = ici.x; py = ici.y;
    n -= 5;
  }

  // Le virage est bien au maximum : sans quoi on ne mesurerait rien.
  assert.ok(q[q.length - 1].x !== q[0].x, 'le serpent a bougé');
  assert.ok(25 / C.SNAKE_DEFAULT_SPEED * C.SNAKE_DEFAULT_TURN * 180 / Math.PI > 50,
    'un segment couvre plus de 50° de virage');

  // AUCUNE cassure aux joints — la tangente sortante d'un segment est la
  // tangente entrante du suivant.
  for (let i = 1; i < tangentes.length; i++) {
    const a = tangentes[i - 1][1], b = tangentes[i][0];
    let d = (Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0])) * 180 / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    assert.ok(Math.abs(d) < 0.01, 'joint ' + i + ' : cassure de ' + d.toFixed(1) + '°');
  }

  // Et le trait passe PAR la trace : chaque point de file est sur la courbe.
  let ecart = 0;
  const n0 = q.length - 1;
  for (let k = 1; k < s.len * 5; k++) {
    const cible = q[n0 - k];
    let d = Infinity;
    for (const p of points) d = Math.min(d, Math.hypot(p.x - cible.x, p.y - cible.y));
    ecart = Math.max(ecart, d);
  }
  assert.ok(ecart < 0.01, 'écart au chemin parcouru : ' + ecart.toFixed(2) + ' px');

  // L'ANCIENNE courbe, elle, cassait : on le vérifie pour que le chiffre du
  // commentaire ne devienne pas une légende.
  let pireAncien = 0;
  n = q.length - 1;
  let sortie = null;
  for (let i = s.len; i > 0; i--) {
    const P0 = pt(n), Cp = pt(n - 2), P1 = pt(n - 5);
    const entree = Math.atan2(Cp.y - P0.y, Cp.x - P0.x);
    if (sortie !== null) {
      let d = (entree - sortie) * 180 / Math.PI;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      pireAncien = Math.max(pireAncien, Math.abs(d));
    }
    sortie = Math.atan2(P1.y - Cp.y, P1.x - Cp.x);
    n -= 5;
  }
  assert.ok(pireAncien > 20, 'la quadratique cassait bien (' + pireAncien.toFixed(1) + '°)');
});

test('le dessin et la collision lisent la MÊME courbe', () => {
  const SERPENT = fs.readFileSync(path.join(ROOT, 'public/snake3/serpent.js'), 'utf8');
  // Le tracé : une cubique par point de file, tangente prise chez les voisins.
  assert.match(RENDU, /function pointFile\(q, k, delta\) \{/);
  assert.match(RENDU, /ctx\.bezierCurveTo\(\s*\n\s*ici\.x \+ \(suiv\.x - av\.x\) \/ 6, ici\.y \+ \(suiv\.y - av\.y\) \/ 6,/);
  assert.ok(!/quadraticCurveTo/.test(RENDU), 'plus de quadratique dans le tracé');
  // Le hitTest : les mêmes points de file, corde à corde.
  assert.match(SERPENT, /const w = q\[Math\.max\(0, n - k\)\];/);
  assert.ok(!/2 \* u \* t \* cx/.test(SERPENT), 'plus de quadratique dans le hitTest');
  // La voie rapide (machine à la peine) n'a pas bougé : elle reste droite des
  // deux côtés, et c'est `tmod_dessin` qui dit laquelle a servi.
  assert.match(RENDU, /\/\/ La voie rapide du fichier quand la machine peine : des segments\./);
  assert.match(SERPENT, /const courbe = !\(this\.tmod_dessin >= 1\.7\);/);
});
