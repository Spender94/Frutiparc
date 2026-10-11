/*
 * Mini-Wave — la sixième vague de retours.
 *
 *   · « Demons Lemon dont on ne peut détruire le tir. » Shot.as, cas 17 (LEMON
 *     THUNDER BALL) : la boule de foudre est destructible EXACTEMENT comme le
 *     tir du Kiwi (cas 16) — la balle du vaisseau meurt (`mc.kill()`, ni
 *     impact ni point), la boule est désarmée (`flHit = false`) et joue son
 *     éclatement (`this.shot.play()`). Le sous-clip `shot` de l'image 52 du
 *     clip des tirs est le sprite 1256 du SWF : neuf images, `stop()` sur la
 *     première, `_parent.kill()` sur la neuvième. Le portage désarmait bien la
 *     boule mais ne jouait rien : elle continuait sa route, inoffensive mais
 *     identique à une boule vivante — « indestructible » pour le joueur. Il
 *     manquait aussi deux détails de Lemon.shoot : `killMargin = 5`, et la
 *     boîte de collision de la boule (12 × 12, forme 1254), pas le rayon de 4
 *     d'un tir ordinaire.
 *
 *   · « Le picto du boss final se débloque sans finir le mode arcade. » Le jeu
 *     d'origine donne `$arcade` dans Boss.as, initStep 29 (« ORANGE DESTRUCT »,
 *     l'entrée en agonie du boss final : `client.giveItem("$arcade")`), et
 *     nulle part ailleurs — le giveItem de Main.endGame est en commentaire. Le
 *     portage l'annonçait dès que $arcade.$bestLevel passait de 0 à 1, c'est-à-
 *     dire à la première mort. Le boss est le niveau d'index 199 des 200 de
 *     l'arcade ; le battre mène au niveau 200 (l'écran de fin), donc à un
 *     meilleur niveau de 201 : « arcade finie », c'est $bestLevel > 200.
 *
 * Bornes et actions du sous-clip relevées dans le BYTECODE du SWF
 * (`node scripts/disasm-as2.js Games/miniWave2/miniwave.swf --sprites`,
 * sprite#1256) : le compilé fait foi.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const P = require(path.join(ROOT, 'public/miniwave/plateforme.js'));
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
  jeu.toKill = jeu.badsList.length + 1;     // sinon l'escadre vidée fait avancer le niveau
  return nes;
}

// La boule du Demon lemon, tirée et éloignée de son tireur, immobilisée pour
// viser juste (les deux projectiles avancent avant que la collision ne se juge).
function bouleDeFoudre(jeu) {
  const [l] = poser(jeu, [{ type: 42, x: 120, y: 40 }]);
  E.TYPES[42].tirer(l);
  const t = jeu.bShotList.find((s) => s.behaviourId === 17);
  assert.ok(t, 'le Demon lemon tire sa boule de foudre');
  for (let i = 0; i < 12; i++) jeu.update(1);
  t.vitx = 0; t.vity = 0;
  return t;
}

// ── A. LA BOULE DU DEMON LEMON SE DÉTRUIT ──────────────────────────────────

test('la pellicule d\'éclatement du Demon lemon est extraite et connue du moteur', () => {
  assert.ok(SPRITES.tirLemon, 'le sous-clip 1256 est extrait pour lui-même');
  assert.equal(SPRITES.tirLemon.symbole, '#1256');
  assert.equal(SPRITES.tirLemon.etats[0].pieces[0].fichier, 'shape1254.svg',
    'son image 1 est la boule de 12 × 12 — celle que l\'image 52 des tirs montrait déjà');
  assert.equal(SPRITES.tirLemon.etats.length, 8, 'huit images dessinées (la neuvième ne fait que tuer)');
  assert.deepEqual(E.CLIPS_TIR[17], { cle: 'tirLemon', fin: 9, eclats: true },
    'l\'image 9 appelle _parent.kill(), comme le dit le bytecode du clip');
  // Le Kiwi et la Nectarine n'ont pas bougé.
  assert.deepEqual(E.CLIPS_TIR[16], { cle: 'tirKiwi', fin: 7 });
  assert.deepEqual(E.CLIPS_TIR[13], { cle: 'trouNoir', boucle: [8, 16], fin: 25 });
});

test('la boule du Demon lemon porte les réglages de Lemon.shoot', () => {
  const jeu = partie();
  const [l] = poser(jeu, [{ type: 42, x: 120, y: 40 }]);
  E.TYPES[42].tirer(l);
  const t = jeu.bShotList.find((s) => s.behaviourId === 17);
  assert.ok(t);
  assert.equal(t.vity, 2.2, 'vity = 2.2');
  assert.equal(t.killMargin, 5, 'killMargin = 5 : elle meurt à cinq pixels du bord');
  assert.equal(t.ray, 6, 'sa boîte est celle de la boule de 12 × 12');
  assert.equal(t.flHit, true, 'vivante, elle tue');
  assert.equal(t.clipJoue, false, 'et elle dort sur son image 1');
});

test('la boule du Demon lemon, une fois touchée, ÉCLATE et disparaît', () => {
  const jeu = partie();
  const t = bouleDeFoudre(jeu);
  const score = jeu.score;
  const balle = jeu.newHShot({ x: t.x, y: t.y, vitx: 0, vity: 0 });
  jeu.update(1);
  assert.equal(balle.vivant, false, 'la balle du vaisseau meurt (mc.kill())');
  assert.equal(jeu.score, score, 'sans rapporter de point : ce n\'est pas un ennemi abattu');
  assert.equal(t.flHit, false, 'la boule est DÉSARMÉE');
  assert.equal(t.clipJoue, true, 'et elle joue son éclatement');
  assert.equal(t.vivant, true, 'elle est encore là le temps de la pellicule');

  // L'image 9 l'efface : elle ne traîne pas à l'écran, et le vaisseau en
  // dessous n'a plus rien à craindre d'elle.
  let images = 0;
  while (t.vivant && images < 20) { jeu.update(1); images++; }
  assert.equal(t.vivant, false, 'l\'éclatement fini, elle n\'est plus là');
  // La pellicule avance dès l'image du coup (image 2), puis une par image :
  // la neuvième, qui la tue, arrive sept images plus tard.
  assert.equal(images, 7, 'la neuvième image du clip la tue');
  assert.ok(!jeu.bShotList.includes(t), 'et elle a quitté la liste des tirs');
});

test('une boule désarmée ne charge plus le vaisseau et ne relance pas son éclatement', () => {
  const jeu = partie();
  const t = bouleDeFoudre(jeu);
  // Elle était en train de charger le vaisseau (step 1 : à moins de 100 px).
  jeu.hero.x = t.x; jeu.hero.y = t.y + 60;
  jeu.update(1);
  assert.equal(t.behaviourInfo.step, 1, 'à portée, elle fonce sur le vaisseau');
  t.vitx = 0; t.vity = 0;
  jeu.newHShot({ x: t.x, y: t.y, vitx: 0, vity: 0 });
  jeu.update(1);
  assert.equal(t.flHit, false, 'la première balle la désarme');
  const image = t.clipImage;
  const { vitx, vity } = t;
  // Une deuxième balle au même endroit : elle ne doit plus rien lui faire.
  jeu.newHShot({ x: t.x, y: t.y, vitx: 0, vity: 0 });
  jeu.update(1);
  assert.ok(t.clipImage > image, 'sa pellicule continue son chemin, sans repartir de zéro');
  assert.deepEqual([t.vitx, t.vity], [vitx, vity], 'et désarmée, elle ne poursuit plus le vaisseau');
});

test('le client garde les étincelles autour de la boule pendant l\'éclatement', () => {
  const jeujs = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(jeujs, /t\.clipJoue \|\| !clip\.eclats/,
    'endormie, la boule est dessinée par l\'image 52 au complet (boule + étincelles)');
  assert.match(jeujs, /poserPieces\(ctx, etat\.pieces\.slice\(1\), 0, 0\)/,
    'en éclatant, les étincelles (toutes les pièces sauf le sous-clip) restent');
  // L'image 52 du clip des tirs : la boule (le sous-clip aplati) d'abord, puis
  // les quatre étincelles — c'est sur cet ordre que repose le `slice(1)`.
  const img52 = SPRITES.shot.etats.find((e) => e.frame === 52);
  assert.ok(img52, 'l\'aspect 10 + 42 existe');
  assert.equal(img52.pieces[0].fichier, 'shape1254.svg', 'la boule en premier');
  assert.equal(img52.pieces.length, 5, 'puis les quatre étincelles');
  const extr = fs.readFileSync(path.join(ROOT, 'scripts/extract-miniwave-sprites.js'), 'utf8');
  assert.match(extr, /cle: 'tirLemon', id: 1256/, 'l\'éclatement du Demon lemon est extrait pour lui-même');
});

// ── B. LE PICTO « ARCADE BOSS » ATTEND LE BOSS FINAL ──────────────────────

test('l\'arcade a 200 niveaux et le dernier est le boss', () => {
  assert.equal(ARCADE.length, P.NB_NIVEAUX_ARCADE);
  assert.equal(ARCADE[P.NB_NIVEAUX_ARCADE - 1].name, 'boss');
  assert.ok(!ARCADE.slice(0, -1).some((n) => n.name === 'boss'), 'et c\'est le seul');
});

test('mourir en route n\'ouvre pas le picto arcade, même devant le boss', () => {
  const neuve = P.carteNeuve();
  // Première mort, au premier niveau : $bestLevel passe à 1 — le record
  // s'enregistre, le picto non.
  const premiere = P.fusionner(neuve, { mode: 'arcade', level: 0, score: 5, badsKill: { 0: 1 } });
  assert.equal(premiere.$arcade.$bestLevel, 1, 'le record est bien tenu');
  assert.equal(P.arcadeFinie(premiere), false);
  assert.deepEqual(P.nouveauxPictos(neuve, premiere), [], 'rien à annoncer');
  // Mort PENDANT le combat de boss (index 199) : niveau 200 atteint, pas fini.
  const devantLeBoss = P.fusionner(premiere, { mode: 'arcade', level: 199, score: 90000, raison: 'gameover' });
  assert.equal(devantLeBoss.$arcade.$bestLevel, 200);
  assert.equal(P.arcadeFinie(devantLeBoss), false, 'devant le boss, l\'arcade n\'est pas finie');
  assert.deepEqual(P.nouveauxPictos(premiere, devantLeBoss), []);
  // Le boss battu : l'écran de fin est le niveau 200, le meilleur niveau 201.
  const fini = P.fusionner(devantLeBoss, { mode: 'arcade', level: 200, score: 91000, raison: 'fin' });
  assert.equal(fini.$arcade.$bestLevel, 201);
  assert.equal(P.arcadeFinie(fini), true);
  assert.deepEqual(P.nouveauxPictos(devantLeBoss, fini), [{ genre: 'arcade' }], 'le picto s\'ouvre, une fois');
  const encore = P.fusionner(fini, { mode: 'arcade', level: 200, score: 1, raison: 'fin' });
  assert.deepEqual(P.nouveauxPictos(fini, encore), [], 'et ne se re-annonce pas');
});

test('le Challenge et les missions ne touchent pas au picto arcade', () => {
  const neuve = P.carteNeuve();
  const ch = P.fusionner(neuve, { mode: 'challenge', jour: '2026-10-11', level: 250, score: 1 });
  assert.equal(ch.$arcade.$bestLevel, 0);
  assert.deepEqual(P.nouveauxPictos(neuve, ch), []);
  const mi = P.fusionner(neuve, { mode: 'mission', missionNum: 0, level: 250, score: 1, cons: 10 });
  assert.equal(mi.$arcade.$bestLevel, 0);
  assert.deepEqual(P.nouveauxPictos(neuve, mi), []);
});

test('le moteur note l\'agonie du boss final — là où Boss.as donnait le picto', () => {
  // Une partie réduite au seul niveau du boss : panneau, puis le combat.
  const vus = [];
  let fin = null;
  const jeu = new E.Game({
    levels: [ARCADE[199]], graine: 3,
    onEvent: (n, d) => { vus.push(n); if (n === 'finPartie') fin = d; },
  });
  for (let i = 0; i < 400 && jeu.step !== E.ETAPE.BOSS; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.BOSS, 'le combat de boss est engagé');
  assert.ok(jeu.boss, 'le boss est là');
  assert.equal(jeu.arcadeFinie, false, 'tant qu\'il se bat, rien n\'est acquis');

  // Boss.as, initStep 29 (« ORANGE DESTRUCT ») : l'agonie.
  jeu.boss.initStep(29);
  assert.equal(jeu.arcadeFinie, true, 'l\'entrée en agonie, c\'est l\'arcade finie');
  assert.ok(vus.includes('bossForme'), 'et le client en est averti');

  // Le vaisseau tombe sous un dernier tir pendant l'agonie : la partie se
  // termine en game over, au niveau du boss — le parcours est fini quand même.
  while (jeu.heroList.length > 0 || jeu.hero) {
    const avant = jeu.heroList.length;
    jeu.hero.exploser();
    for (let i = 0; i < 200 && jeu.heroList.length === avant && !jeu.termine; i++) jeu.update(1);
    if (jeu.termine) break;
  }
  assert.ok(fin, 'la partie s\'est terminée');
  assert.equal(fin.raison, 'gameover');
  assert.equal(fin.arcadeFinie, true, 'le relevé porte le boss abattu');
  const carte = P.fusionner(P.carteNeuve(), Object.assign({ mode: 'arcade' }, fin));
  assert.equal(carte.$arcade.$bestLevel, P.NB_NIVEAUX_ARCADE + 1, 'la fiche dit « parcours fini »');
  assert.equal(P.arcadeFinie(carte), true);
  assert.deepEqual(P.nouveauxPictos(P.carteNeuve(), carte), [{ genre: 'arcade' }]);
});

test('le boss abattu mène à l\'écran de fin, au niveau 200 — la fiche dit 201', () => {
  let fin = null;
  const jeu = new E.Game({
    levels: ARCADE, graine: 3,
    onEvent: (n, d) => { if (n === 'finPartie') fin = d; },
  });
  // On se place devant le boss sans jouer les 199 niveaux : le moteur passe
  // au niveau suivant comme après une escadre abattue.
  jeu.nextLevel = 199;
  jeu.initStep(E.ETAPE.SUIVANT);
  for (let i = 0; i < 600 && jeu.step !== E.ETAPE.BOSS; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.BOSS);
  assert.equal(jeu.level, 199, 'le boss est le niveau d\'index 199');
  jeu.boss.initStep(29);
  for (let i = 0; i < 2000 && !jeu.termine; i++) jeu.update(1);
  assert.ok(fin, 'la partie s\'est terminée');
  assert.equal(fin.raison, 'fin', 'sur l\'écran de victoire');
  assert.equal(fin.level, 200, 'au niveau 200, après le dernier');
  assert.equal(fin.arcadeFinie, true);
  const carte = P.fusionner(P.carteNeuve(), Object.assign({ mode: 'arcade' }, fin));
  assert.equal(carte.$arcade.$bestLevel, 201);
  assert.deepEqual(P.nouveauxPictos(P.carteNeuve(), carte), [{ genre: 'arcade' }]);
});
