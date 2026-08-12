/*
 * Troisième vague de retours joueurs sur Miniwave light — le mode Challenge à
 * l'épreuve du jeu, et deux dessins repris dans le SWF d'origine
 * (Games/miniWave2/class, Games/miniWave2/miniwave.swf).
 *
 *   1. « Il y a un niveau où il y a les ennemis du mode lettre $bads50. » Le
 *      générateur puisait dans TOUT le bestiaire du moteur, alors que l'arcade
 *      ne fait voler que quarante et une de ses cinquante et une espèces : les
 *      dix autres appartiennent aux missions spéciales et au mode lettre.
 *      (Le vivier lui-même est recompté sur levels.json dans
 *      test/miniwaveChallenge.test.js ; ici on vérifie ce qu'il change en jeu.)
 *
 *   2. « $bads48 : une bombe descend et génère des projectiles dans tous les
 *      sens, on ne voit pas la bombe. » La mine du Brugnon cuirassé n'est pas
 *      un dessin mais un CLIP : l'image 58 des projectiles ne fait que le
 *      poser. Aplati à sa première image, il sortait au huitième de sa taille
 *      — deux pixels. La mine fait vingt-quatre pixels une fois amorcée,
 *      tourne sur elle-même (Brugnon.shoot : vitRot 6) et, abattue, joue sa
 *      destruction avant de disparaître (Shot.as case 23).
 *
 *   3. « Les visuels des boost de niveaux sont mauvais. » Le bonus de saut est
 *      l'image 2 du clip Opt : un halo, un noyau qui porte le chiffre, un
 *      anneau et QUATRE électrons en orbite, chacun tourné au hasard et lancé
 *      sur une image au hasard (Opt.as init). Le portage dessinait un rond
 *      bleu avec le chiffre écrit en Verdana par-dessus.
 *
 *   4. « Les monstres détruits en Challenge ne doivent pas compter pour les
 *      pictos. » Deux cents fruits d'une espèce ouvrent son picto et pèsent sur
 *      le grade ; la zone rouge de la map du jour n'aligne QUE les espèces les
 *      plus dures. Le tableau de chasse reste donc celui de l'arcade et des
 *      missions.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const C = require(path.join(ROOT, 'public/miniwave/challenge.js'));
const P = require(path.join(ROOT, 'public/miniwave/plateforme.js'));
const SPRITES = require(path.join(ROOT, 'public/miniwave/sprites/sprites.json'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));
const ARCADE = NIVEAUX.main[0].levels;

function partie(o) {
  o = o || {};
  const journal = [];
  const jeu = new E.Game({
    levels: o.levels || ARCADE,
    graine: o.graine === undefined ? 7 : o.graine,
    ship: o.ship,
    onEvent: (n, d) => journal.push({ n, d }),
  });
  return { jeu, journal };
}
function jusquAuCombat(jeu) {
  for (let i = 0; i < 600 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.COMBAT, 'le combat est engagé');
}
function poserFigurants(jeu, liste) {
  while (jeu.badsList.length > 0) jeu.badsList[0].tuer();
  const nes = liste.map((o) => jeu.newBads(o.type === undefined ? 0 : o.type,
    Object.assign({ waveId: 0, lineId: 0, wpTimer: -1, flWave: false }, o)));
  for (const b of nes) b.flReady = true;
  jeu.toKill = jeu.badsList.length + 1;
  return nes;
}
// L'enveloppe d'une image de sprite, dans le repère du clip — chaque pièce
// porte son coin (`o`) et sa matrice.
function enveloppe(sprite, image) {
  const etat = sprite.etats.find((e) => e.frame === image);
  assert.ok(etat, 'image ' + image + ' présente');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of etat.pieces) {
    const ox = p.o ? p.o[0] : -p.w / 2;
    const oy = p.o ? p.o[1] : -p.h / 2;
    for (const [cx, cy] of [[ox, oy], [ox + p.w, oy], [ox, oy + p.h], [ox + p.w, oy + p.h]]) {
      const X = p.m[0] * cx + p.m[2] * cy + p.m[4];
      const Y = p.m[1] * cx + p.m[3] * cy + p.m[5];
      x0 = Math.min(x0, X); x1 = Math.max(x1, X);
      y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
  }
  return { l: x1 - x0, h: y1 - y0 };
}

// ── 1. Le mode lettre et les fruits de mission hors de la map du jour ─────

test('la map du jour ne fait voler que des espèces éprouvées en escadre', () => {
  const croisees = new Set();
  for (let g = 1; g <= 120; g++) {
    for (const lv of C.genererMap(g).niveaux) {
      for (const ligne of lv.list) for (const c of ligne) croisees.add(c.t);
    }
  }
  for (const t of C.HORS_ESCADRE) {
    assert.ok(!croisees.has(t),
      `${E.ENNEMIS[t].name} (type ${t}) ne doit jamais sortir en Challenge`);
  }
  // Le Letter-monster ne tire même pas : il porte une lettre, il n'a rien à
  // faire dans une vague.
  assert.equal(E.TYPES[50].tire, false, 'le Letter-monster ne tire pas');
  // La zone rouge garde tout de même de quoi faire un mur : les espèces les
  // plus dures de l'arcade y sont.
  const vivier = C.typesJouables();
  const rangMax = vivier[vivier.length - 1].rank;
  const dernier = C.genererMap(42).niveaux[C.NIVEAUX_PAR_JOUR - 1];
  const rangs = dernier.list.flat().map((c) => E.ENNEMIS[c.t].rank);
  assert.ok(Math.max(...rangs) >= rangMax - 2, 'le dernier niveau tape en haut du vivier');
});

// ── 2. La mine du Brugnon cuirassé ───────────────────────────────────────

test('le Brugnon pose une mine qui descend en tournant sur elle-même', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const [brugnon] = poserFigurants(jeu, [{ type: 48, x: 120, y: 60 }]);
  assert.equal(brugnon.hp, 2, 'le Brugnon est cuirassé');
  brugnon.tirer();
  const mine = jeu.bShotList.find((t) => t.behaviourId === 23);
  assert.ok(mine, 'la mine est posée');
  assert.equal(mine.vity, 0.6, 'elle descend lentement (Brugnon.shoot)');
  assert.equal(mine.vitRot, 6, 'et tourne sur elle-même');
  assert.equal(mine.badsType, 48, 'son aspect est celui de l\'espèce (gotoAndStop 10+type)');
  const avant = mine.rot;
  jeu.update(1);
  assert.notEqual(mine.rot, avant, 'la toupie tourne vraiment');
});

test('une mine abattue s\'éteint et disparaît au bout de sa destruction', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const [brugnon] = poserFigurants(jeu, [{ type: 48, x: 120, y: 60 }]);
  brugnon.tirer();
  const mine = jeu.bShotList.find((t) => t.behaviourId === 23);
  assert.equal(mine.flHit, true, 'tant qu\'elle est intacte, elle blesse');
  // On la laisse descendre hors de portée du Brugnon, sinon c'est LUI que le
  // tir toucherait.
  for (let i = 0; i < 40; i++) jeu.update(1);
  assert.ok(mine.vivant && mine.y - brugnon.y > 20, 'la mine a pris ses distances');

  // Un tir du vaisseau la touche : elle cesse d'essaimer, cesse de blesser,
  // s'arrête de tourner (Shot.as case 23) — puis meurt à la fin de l'animation.
  jeu.newHShot({ x: mine.x, y: mine.y, vitx: 0, vity: 0 });
  jeu.update(1);
  assert.equal(mine.flHit, false, 'elle ne blesse plus');
  assert.equal(mine.vitRot, 0, 'et ne tourne plus');
  assert.ok(mine.mourant !== undefined, 'sa destruction est lancée');

  const eclatsAvant = jeu.bShotList.length;
  for (let i = 0; i < E.MINE_MORT + 2; i++) jeu.update(1);
  assert.ok(!mine.vivant, 'au bout de la destruction, la mine disparaît');
  assert.ok(jeu.bShotList.length <= eclatsAvant, 'et n\'a plus rien semé entre-temps');
});

test('la mine a le dessin animé du SWF, pas les deux pixels de sa première image', () => {
  const sp = SPRITES.mineBrugnon;
  assert.ok(sp, 'le clip de la mine est extrait pour lui-même');
  assert.equal(sp.etats.length, 33, 'ses trente-trois images');
  // Elle s'amorce en grossissant : la première image est minuscule, et c'est
  // exactement pourquoi l'aplatir avec le reste la rendait invisible.
  assert.ok(enveloppe(sp, 1).l < 4, 'l\'image 1 ne fait que deux pixels');
  // Une fois amorcée (image 11), elle est aussi grosse qu'un fruit.
  const posee = enveloppe(sp, 11);
  assert.ok(posee.l >= 20 && posee.h >= 20, `la mine posée fait ${posee.l}×${posee.h} px`);
  assert.deepEqual(enveloppe(sp, 23), posee, 'la boucle garde cette taille');

  // Et le client la dessine par son animation, pas par l'image 58 des tirs.
  const jeujs = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(jeujs, /behaviourId === 23\) \{ this\.dessinerMine/, 'la mine a son propre rendu');
  assert.match(jeujs, /sprites\.mineBrugnon/, 'qui pose le clip extrait');
  assert.equal(E.MINE_AMORCE, 10, 'dix images d\'amorce');
  assert.equal(E.MINE_BOUCLE, 13, 'puis une boucle de treize (11→23)');
});

// ── 3. Le bonus de saut ──────────────────────────────────────────────────

test('le bonus de saut est un atome à quatre électrons, tirés au largage', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  for (const type of [4, 5, 6]) {
    const o = new E.Opt(jeu, { x: 100, y: 40, type });
    assert.ok(Array.isArray(o.atomes) && o.atomes.length === 4,
      `le bonus ${E.BONUS[type].nom} porte ses quatre électrons`);
    for (const a of o.atomes) {
      assert.ok(a.rot >= 0 && a.rot < 360, 'chacun tourné au hasard');
      assert.ok(a.image >= 1 && a.image <= 40, 'et lancé sur une image au hasard');
    }
    assert.equal(o.age, 0, 'son horloge part de zéro');
    o.update(1);
    assert.equal(o.age, 1, 'et avance avec le jeu');
  }
  // Une pièce, elle, n'a pas d'électrons.
  assert.equal(new E.Opt(jeu, { x: 0, y: 0, type: 0 }).atomes, undefined);
});

test('les dessins du bonus de saut viennent du SWF', () => {
  for (const [cle, n] of [['optSautHalo', 1], ['optSautNoyau', 3],
    ['optSautAnneau', 1], ['optSautAtome', 42]]) {
    const sp = SPRITES[cle];
    assert.ok(sp, cle + ' est extrait');
    assert.equal(sp.etats.length, n, `${cle} : ${n} image(s)`);
  }
  // Le noyau porte le chiffre : une image par valeur (5, 10, 20), et les trois
  // sont des dessins DIFFÉRENTS.
  const noyau = SPRITES.optSautNoyau;
  const formes = noyau.etats.map((e) => e.pieces.map((p) => p.fichier).join('+'));
  assert.equal(new Set(formes).size, 3, 'trois chiffres distincts');
  assert.equal(E.BONUS[4].warp, 5);
  assert.equal(E.BONUS[5].warp, 10);
  assert.equal(E.BONUS[6].warp, 20);

  const jeujs = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(jeujs, /dessinerSaut\(ctx, o\)/, 'le bonus de saut a son rendu propre');
  assert.match(jeujs, /poser\(ctx, noyau, Math\.max\(1, Math\.min\(3, o\.type - 3\)\)/,
    'le noyau suit center.gotoAndStop(type-3)');
  for (const cle of ['optSautHalo', 'optSautAnneau', 'optSautAtome']) {
    assert.ok(jeujs.includes('sprites.' + cle), cle + ' est posé par le client');
  }
  // La moitié d'orbite que le SWF découpe au masque passe DERRIÈRE le noyau :
  // l'extraction marque ces images, le client s'en sert pour l'ordre de tracé.
  const masquees = SPRITES.optSautAtome.etats.filter((e) => e.masque).map((e) => e.frame);
  assert.deepEqual(masquees, Array.from({ length: 20 }, (_, i) => 11 + i),
    'les images 11 à 30 sont celles que le SWF découpe');
  assert.match(jeujs, /etat && etat\.masque \? derriere : devant/,
    'et le client les dessine sous le noyau');
  // Le masque lui-même n'est pas un dessin : un rectangle vert traversait le
  // bonus tant qu'on le posait comme une pièce ordinaire.
  for (const e of SPRITES.optSautAtome.etats) {
    assert.equal(e.pieces.length, 1, `image ${e.frame} : le seul dessin est l'électron`);
  }
  assert.ok(!/fillText\(String\(b\.warp\)/.test(jeujs),
    'plus de chiffre écrit en Verdana par-dessus un rond');
});

// ── 4. Le tableau de chasse reste celui de l'arcade ──────────────────────

test('les éliminations du Challenge n\'ouvrent pas de picto', () => {
  const neuve = P.carteNeuve();
  // Une carte à un fruit du picto pour l'espèce 2.
  const presque = P.carteNeuve();
  presque.$badsKill[2] = 199;

  const apresChallenge = P.fusionner(presque, {
    mode: 'challenge', jour: '2026-08-12', score: 9000, level: 20, badsKill: { 2: 40 },
  });
  assert.equal(apresChallenge.$badsKill[2], 199, 'le compteur n\'a pas bougé');
  assert.deepEqual(P.nouveauxPictos(presque, apresChallenge), [],
    'et aucun picto ne s\'ouvre');

  // La même partie en arcade, elle, compte.
  const apresArcade = P.fusionner(presque, {
    mode: 'arcade', score: 9000, level: 20, badsKill: { 2: 40 },
  });
  assert.equal(apresArcade.$badsKill[2], 239, 'l\'arcade alimente le tableau de chasse');
  const ouverts = P.nouveauxPictos(presque, apresArcade);
  assert.ok(ouverts.some((x) => x.genre === 'bads' && x.type === 2),
    'et ouvre le picto de l\'espèce');

  // Une mission aussi (c'est un parcours dessiné, comme l'arcade).
  const apresMission = P.fusionner(presque, {
    mode: 'mission', missionNum: 0, score: 500, cons: 50, badsKill: { 2: 40 },
  });
  assert.equal(apresMission.$badsKill[2], 239, 'les missions comptent');

  // Le reste d'une partie de Challenge compte normalement.
  const riche = P.fusionner(neuve, {
    mode: 'challenge', jour: '2026-08-12', score: 4200, level: 7,
    credits: 12, saucerKill: 3, badsKill: { 0: 50 },
  });
  assert.equal(riche.$credit, 12, 'les crédits ramassés');
  assert.equal(riche.$saucerKill, 3, 'les soucoupes');
  assert.equal(riche.$challenge.$bestScore, 4200, 'et le record du jour');
});
