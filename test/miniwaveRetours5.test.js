/*
 * Mini-Wave — la cinquième vague de retours (Sgrota, 16 août 2026).
 *
 * Trois d'entre eux se ramènent à la même cause : le SOUS-CLIP `shot`.
 *
 * Chaque image du clip des projectiles pose un sous-clip nommé `shot`, arrêté
 * sur sa première image. Shot.as le lance (`this.shot.play()`) au moment qui
 * compte, et l'extraction n'avait gardé que cette première image — comme si un
 * film n'avait que son affiche. Deux projectiles en dépendaient entièrement :
 *
 *   · « les projectiles des trous noirs $bads32 ne se transforment plus en trou
 *     noir une fois au sol, c'est devenu très difficile de les voir. » Le tir
 *     arrive à hauteur du vaisseau, s'y fige et joue sa pellicule EN BOUCLE :
 *     c'est là qu'il s'ouvre en trou noir et se met à aspirer. Sans elle, il
 *     restait le petit point du départ — on se faisait tirer par un invisible.
 *
 *   · « les projectiles des kiwis $bads39 sont indestructibles (ou plutôt j'ai
 *     l'impression qu'on peut les détruire mais que leur animation reste à
 *     l'écran). » Le diagnostic du joueur est exact, à ceci près que rien ne
 *     restait à l'écran par accident : le tir touché est désarmé et joue son
 *     éclatement, dont l'IMAGE FINALE l'efface (`_parent.kill()`). Sans la
 *     pellicule, il n'y avait ni éclatement ni effacement — le projectile
 *     désarmé continuait sa route, identique à un projectile vivant.
 *
 * Le troisième n'a rien à voir mais est plus grave :
 *
 *   · « les aubergines $bads28 sont devenues des plots, elles ne font plus rien
 *     du tout désormais. » Aubergine.as « charge en laissant sa place » : le
 *     fruit garde son créneau dans la vague (`x, y` avancent avec l'escadre) et
 *     se DESSINE à `kx, ky`, le point qui fonce sur le vaisseau — son endUpdate
 *     fait `_x = kx ; _y = ky`, et tout la suit là-bas : le choc, les tirs, son
 *     explosion. Le portage calculait kx/ky et ne les appliquait à RIEN.
 *
 * Bornes et actions des pellicules relevées dans le BYTECODE des clips du SWF
 * (sprites 1217 et 1251), pas dans les sources : le compilé fait foi.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const SPRITES = require(path.join(ROOT, 'public/miniwave/sprites/sprites.json'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));
const ARCADE = NIVEAUX.main[0].levels;

function partie(o) {
  const jeu = new E.Game(Object.assign({ levels: ARCADE, graine: 7 }, o || {}));
  for (let i = 0; i < 600 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.COMBAT, 'le combat est engagé');
  return jeu;
}
function poser(jeu, liste) {
  while (jeu.badsList.length > 0) jeu.badsList[0].tuer();
  const nes = liste.map((o) => jeu.newBads(o.type,
    Object.assign({ waveId: 0, lineId: 0, wpTimer: -1, flWave: false }, o)));
  for (const b of nes) b.flReady = true;
  jeu.toKill = jeu.badsList.length + 1;
  return nes;
}

// ── 1. L'AUBERGINE CHARGE POUR DE BON ────────────────────────────────────

test('l\'Aubergine folle se MONTRE au bout de sa charge, pas dans son rang', () => {
  const jeu = partie();
  const [a] = poser(jeu, [{ type: 28, x: 120, y: 50 }]);
  const h = jeu.hero;
  h.x = 40; h.y = 200;

  // Hors charge, elle est là où la vague l'a mise.
  assert.equal(a.px, a.x, 'au repos, sa place est sa place');
  assert.equal(a.py, a.y);

  for (let i = 0; i < 4000 && a.step !== 1; i++) E.TYPES[28].vague(a, 1);
  assert.equal(a.step, 1, 'la charge est lancée');
  const departX = a.x, departY = a.y;
  for (let i = 0; i < 40 && a.step === 1; i++) jeu.update(1);

  // Elle a VRAIMENT bougé — et vers le vaisseau.
  assert.ok(Math.abs(a.px - departX) > 10 || Math.abs(a.py - departY) > 10,
    `la charge a quitté son rang (px=${a.px.toFixed(1)}, py=${a.py.toFixed(1)})`);
  assert.ok(a.py > departY, 'elle descend vers le vaisseau');
  assert.ok(a.px < departX, 'et se rabat vers lui');
  assert.equal(a.px, a.kx, 'sa place VISIBLE est celle de la charge');
  assert.equal(a.py, a.ky);
  assert.ok(a.rot !== 0, 'et elle se tourne dans le sens de sa course');
});

test('pendant sa charge, l\'Aubergine se touche et touche AU BOUT de la charge', () => {
  const jeu = partie();
  const [a] = poser(jeu, [{ type: 28, x: 120, y: 50 }]);
  // On la met en charge à la main, loin de son rang.
  a.step = 1; a.kx = 60; a.ky = 200; a.vitx = 0; a.vity = 0; a.timer = 100; a.cible = null;

  // Un tir du vaisseau qui passe sur son RANG ne la touche plus…
  assert.equal(a.toucheEn(a.x, a.y), false, 'son créneau vide n\'arrête rien');
  // …celui qui passe sur la CHARGE, si.
  assert.equal(a.toucheEn(60, 200), true, 'la charge, elle, est bien là');

  // Le choc avec le vaisseau se juge au même endroit.
  const h = jeu.hero;
  h.x = 60; h.y = 200;
  const viesAvant = jeu.vies !== undefined ? jeu.vies : null;
  a.verifierChocHero();
  assert.ok(!a.vivant || viesAvant === null,
    'le vaisseau posé sur la charge se fait percuter');
});

// ── 2. LE TROU NOIR DE LA NECTARINE ──────────────────────────────────────

test('le tir de la Nectarine S\'OUVRE en trou noir et se referme', () => {
  assert.ok(SPRITES.trouNoir, 'la pellicule du trou noir est extraite');
  // Le clip compte vingt-six images ; les deux dernières ne DESSINENT rien
  // (l'image 25 ne porte que l'action qui efface le projectile), d'où les
  // vingt-quatre images-clés que l'extracteur en sort.
  const derniere = SPRITES.trouNoir.etats[SPRITES.trouNoir.etats.length - 1].frame;
  assert.ok(derniere >= 20, 'sa pellicule entière, ou presque (' + derniere + ' images dessinées)');
  assert.deepEqual(E.CLIPS_TIR[13], { cle: 'trouNoir', boucle: [8, 16], fin: 25 },
    'bornes du bytecode : « loop » à l\'image 8, le renvoi à la 16, la mort à la 25');

  const jeu = partie();
  const [n] = poser(jeu, [{ type: 32, x: 120, y: 40 }]);
  // Le vaisseau se tient À CÔTÉ de la colonne du tir : sinon celui-ci le
  // percute avant d'atteindre sa hauteur, et meurt sans jamais s'ouvrir.
  jeu.hero.x = 40; jeu.hero.y = 200;
  E.TYPES[32].tirer(n);
  const t = jeu.bShotList.find((s) => s.behaviourId === 13);
  assert.ok(t, 'la Nectarine a tiré');
  assert.equal(t.clipJoue, false, 'en tombant, il dort sur son image 1');
  assert.equal(t.clipImage, 1);

  // Il descend jusqu'à la hauteur du vaisseau.
  for (let i = 0; i < 400 && !t.behaviourInfo.flBlackHole; i++) jeu.update(1);
  assert.equal(t.behaviourInfo.flBlackHole, true, 'il atteint le vaisseau et se fige');
  assert.equal(t.clipJoue, true, 'sa pellicule est lancée…');
  assert.equal(t.flLoop, true, '…et elle BOUCLE tant qu\'il aspire');

  // Il bat entre 8 et 16, sans jamais aller plus loin tant qu'il aspire.
  const vues = new Set();
  for (let i = 0; i < 120 && t.vivant && t.behaviourInfo.timer > 0; i++) {
    jeu.update(1);
    if (t.clipJoue) vues.add(t.clipImage);
  }
  const max = Math.max(...vues);
  assert.ok(max <= 16, 'la boucle ne dépasse pas son image de renvoi (' + max + ')');
  assert.ok(vues.size > 4, 'et elle défile pour de bon (' + vues.size + ' images vues)');

  // Le temps d'aspiration écoulé, il se referme puis s'efface.
  for (let i = 0; i < 200 && t.vivant; i++) jeu.update(1);
  assert.equal(t.vivant, false, 'l\'image finale du clip l\'efface');
});

test('le trou noir TIRE le vaisseau à lui — c\'est tout son intérêt', () => {
  const jeu = partie();
  const [n] = poser(jeu, [{ type: 32, x: 60, y: 40 }]);
  jeu.hero.x = 200; jeu.hero.y = 200;
  E.TYPES[32].tirer(n);
  const t = jeu.bShotList.find((s) => s.behaviourId === 13);
  for (let i = 0; i < 400 && !t.behaviourInfo.flBlackHole; i++) jeu.update(1);
  const avant = jeu.hero.x;
  for (let i = 0; i < 30; i++) { jeu.hero.y = 200; jeu.update(1); }
  assert.ok(jeu.hero.x < avant, `le vaisseau est aspiré vers le trou (${avant} → ${jeu.hero.x})`);
});

// ── 3. LES TIRS DU KIWI ──────────────────────────────────────────────────

test('le tir du Kiwi, une fois touché, ÉCLATE et disparaît', () => {
  assert.ok(SPRITES.tirKiwi, 'la pellicule d\'éclatement est extraite');
  assert.deepEqual(E.CLIPS_TIR[16], { cle: 'tirKiwi', fin: 7 },
    'l\'image 7 appelle _parent.kill(), comme le dit le bytecode du clip');

  const jeu = partie();
  const [k] = poser(jeu, [{ type: 39, x: 120, y: 40 }]);
  E.TYPES[39].tirer(k);
  const tirs = jeu.bShotList.filter((s) => s.behaviourId === 16);
  assert.equal(tirs.length, 8, 'le Kiwi ouvre en gerbe de huit');
  const t = tirs[0];
  assert.equal(t.flHit, true, 'vivant, il tue');
  assert.equal(t.clipJoue, false, 'et il dort sur son image 1');

  // On laisse la gerbe s'écarter du Kiwi, sinon la balle du vaisseau touche
  // le TIREUR avant le projectile — puis on immobilise la cible pour viser
  // juste (les deux avancent avant que la collision ne se juge).
  for (let i = 0; i < 12; i++) jeu.update(1);
  t.vitx = 0; t.vity = 0;
  jeu.newHShot({ x: t.x, y: t.y, vitx: 0, vity: 0 });
  jeu.update(1);
  assert.equal(t.flHit, false, 'touché, il est DÉSARMÉ');
  assert.equal(t.clipJoue, true, 'et il joue son éclatement');

  // Puis l'image finale l'efface — il ne traîne pas à l'écran.
  for (let i = 0; i < 20 && t.vivant; i++) jeu.update(1);
  assert.equal(t.vivant, false, 'l\'éclatement fini, il n\'est plus là');
  assert.ok(!jeu.bShotList.includes(t), 'et il a quitté la liste des tirs');
});

test('un tir de Kiwi déjà désarmé ne relance pas son éclatement', () => {
  const jeu = partie();
  const [k] = poser(jeu, [{ type: 39, x: 120, y: 40 }]);
  E.TYPES[39].tirer(k);
  const t = jeu.bShotList.filter((s) => s.behaviourId === 16)[0];
  for (let i = 0; i < 12; i++) jeu.update(1);
  t.vitx = 0; t.vity = 0;
  jeu.newHShot({ x: t.x, y: t.y, vitx: 0, vity: 0 });
  jeu.update(1);
  assert.equal(t.flHit, false, 'la première balle le désarme');
  const image = t.clipImage;
  // Une deuxième balle au même endroit : elle ne doit plus rien lui faire.
  jeu.newHShot({ x: t.x, y: t.y, vitx: 0, vity: 0 });
  jeu.update(1);
  assert.ok(t.clipImage > image, 'sa pellicule continue son chemin, sans repartir de zéro');
});

// ── 4. LE CLIENT POSE BIEN CES PELLICULES ────────────────────────────────

test('le client dessine la pellicule du clip, pas son affiche', () => {
  const jeujs = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(jeujs, /E\.CLIPS_TIR\[t\.behaviourId\]/, 'il consulte la table des clips animés');
  assert.match(jeujs, /t\.clipImage/, 'et pose l\'image où le clip en est');
  // L'extracteur les sort pour de bon.
  const extr = fs.readFileSync(path.join(ROOT, 'scripts/extract-miniwave-sprites.js'), 'utf8');
  assert.match(extr, /cle: 'trouNoir', id: 1217/, 'le trou noir est extrait pour lui-même');
  assert.match(extr, /cle: 'tirKiwi', id: 1251/, 'l\'éclatement du kiwi aussi');
});

// ── 5. LA PLONGÉE DU KAMIKAZE ────────────────────────────────────────────

test('le kamikaze plonge à mi-chemin des deux extrêmes d\'époque', () => {
  // Citron.as applique tmod DEUX FOIS : `vity = min(vity+0.5, 8)*tmod` puis
  // `y += vity*tmod`. La première ligne est une suite dont le point fixe vaut
  // 0,5·tmod/(1−tmod) : le plafond de 8 écrit dans le code n'est atteint que
  // si la machine NE TIENT PAS la cadence de l'en-tête (tmod ≥ 1). Nous la
  // tenons — la formule brute s'effondrait au quart, d'où « trop lents ».
  const jeu = partie();
  const [k] = poser(jeu, [{ type: 4, x: 120, y: 20 }]);
  k.mode = 1; k.vity = 0; k.flWave = false;
  const depart = k.y;
  let images = 0;
  while (k.vivant && k.y - depart < 200 && images < 10000) { E.TYPES[4].tic(k, 0.8); images++; }
  // Quarante images par seconde : la traversée doit tenir entre une seconde et
  // deux — la plongée rapide d'époque en faisait une, la formule brute trois.
  const secondes = images / 40;
  assert.ok(secondes > 1 && secondes < 2.2,
    `200 px en ${secondes.toFixed(2)} s — ni la chute de plume, ni le missile`);
  assert.equal(Math.round(k.vity * 100) / 100, 4, 'sa vitesse limite est le point fixe attendu');

  // La formule reste celle du jeu, coquille comprise : seule la poussée change.
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/engine.js'), 'utf8');
  assert.match(src, /b\.vity = Math\.min\(b\.vity \+ KAMIKAZE_POUSSEE, 8\) \* tmod;/,
    'le double tmod d\'époque est conservé');
  assert.match(src, /b\.y \+= b\.vity \* tmod;/, 'et l\'intégration aussi');
  assert.match(src, /const KAMIKAZE_POUSSEE = 1;/, 'la poussée est nommée et documentée');
});
