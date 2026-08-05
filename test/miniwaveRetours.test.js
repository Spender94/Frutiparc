/*
 * Les retours joueurs sur Miniwave light — chacun contre le comportement du
 * SWF d'origine (Games/miniWave2/class), vérifié dans les sources.
 *
 *   1. L'ulti du Curaso (vaisseau bleu) ne filait plus que tout droit :
 *      Shot.onHit case 10 le fait ÉCLATER en cinq à l'impact — et chaque
 *      éclat porte le même comportement, donc re-divise. C'est la cascade.
 *   2. Son tir de base ondule ET laisse une traîne (Shot.queue étire une
 *      particule entre deux positions) ; les têtes chercheuses de Manzana
 *      aussi. Le moteur publie désormais ces segments (événement `traine`).
 *   3. Le compteur de crédits en jeu doit dire le PORTEFEUILLE : le SWF
 *      crédite la fiche en direct (Game.incCred → $credit += n), le joueur
 *      du bureau lit donc toujours son solde total.
 *   4. Un vaisseau ne s'enrôle qu'UNE fois par escadron — box/ShipDemo.select
 *      masque son bouton après le choix — sauf le basique (id 0), ré-attaché.
 *   5. Le pilotage tactile : le pouce EST le vaisseau (position absolue sur
 *      la bande), tir continu tant qu'il est posé, double-tap pour l'ulti,
 *      et plus aucun bouton de tir.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const M = require(path.join(ROOT, 'public/miniwave/menu.js'));
const W = require(path.join(ROOT, 'public/miniwave/plateforme.js'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));
const ARCADE = NIVEAUX.main[0].levels;

function partie(o) {
  o = o || {};
  const journal = [];
  const jeu = new E.Game({
    levels: ARCADE,
    graine: o.graine === undefined ? 7 : o.graine,
    onEvent: (n, d) => journal.push({ n, d }),
  });
  return { jeu, journal };
}

function jusquAuCombat(jeu) {
  for (let i = 0; i < 600 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.COMBAT, 'le combat est engagé');
}

test('l\'ulti du Curaso éclate en cinq à l\'impact, et les éclats re-divisent', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const cible = jeu.badsList[0];
  assert.ok(cible, 'une escadre est en place');

  // Le tir spécial arrive PILE sur un ennemi (Shot.onHit case 10).
  jeu.newHShot({ x: cible.x, y: cible.y, vitx: 0, vity: -5, behaviourId: 10, heroType: 4 });
  const avant = jeu.hShotList.length;
  jeu.update(1);

  const eclats = jeu.hShotList.filter((t) => t.behaviourId === 10);
  assert.equal(eclats.length, 5, 'cinq éclats en étoile (le tir d\'origine est mort)');
  assert.ok(jeu.hShotList.length >= avant + 4, 'la gerbe a bien remplacé le tir');
  for (const t of eclats) {
    const v = Math.sqrt(t.vitx * t.vitx + t.vity * t.vity);
    assert.ok(Math.abs(v - 4) < 0.01, 'vitesse 4, comme Shot.onHit');
    assert.ok(t.time !== undefined && t.time <= 20, 'vie brève (time 20)');
    assert.equal(t.heroType, 4, 'l\'aspect du tir Curaso');
  }
  // Les cinq angles sont réguliers : i/5 de tour (628/100 pour 2π, comme l'AS2).
  const angles = eclats.map((t) => Math.atan2(t.vity, t.vitx)).sort((a, b) => a - b);
  for (let i = 1; i < angles.length; i++) {
    assert.ok(Math.abs((angles[i] - angles[i - 1]) - (Math.PI * 2) / 5) < 0.02,
      'étoile régulière à cinq branches');
  }
});

test('le tir ondulant du Curaso publie sa traîne, segment par segment', () => {
  const { jeu, journal } = partie();
  jusquAuCombat(jeu);
  const t = jeu.newHShot({
    x: 120, y: 200, vitx: 0, vity: -3.5, behaviourId: 9, heroType: 4,
    behaviourInfo: { x: 120, d: 0, decalSpeed: 20, decal: 8 },
  });
  jeu.update(1);
  jeu.update(1);
  const traines = journal.filter((e) => e.n === 'traine');
  assert.ok(traines.length >= 1, 'au moins un segment publié');
  const s = traines[traines.length - 1].d;
  assert.equal(s.genre, 'curaso');
  assert.ok(s.x0 !== s.x1 || s.y0 !== s.y1, 'le segment relie deux positions distinctes');
  assert.ok(t.behaviourInfo.oldPos, 'et la position d\'avant est retenue');
  // Les têtes chercheuses de Manzana tracent aussi (Shot.queue du SWF).
  const moteur = fs.readFileSync(path.join(ROOT, 'public/miniwave/engine.js'), 'utf8');
  assert.match(moteur, /this\.tracer\('homing'\)/);
});

test('au doigt, le vaisseau est à la position du pouce — même sous EMP', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  assert.ok(jeu.hero, 'le vaisseau est là');

  jeu.entree.cibleX = 30;
  jeu.update(1);
  assert.ok(Math.abs(jeu.hero.x - 30) < 0.01, 'le pouce à 30, le vaisseau à 30');

  jeu.entree.cibleX = 200;
  jeu.update(1);
  assert.ok(Math.abs(jeu.hero.x - 200) < 0.01, 'le pouce saute, le vaisseau suit');

  // L'EMP de la Prune inverse les commandes : en absolu, c'est le MIROIR.
  jeu.hero.sens = -1;
  jeu.entree.cibleX = 40;
  jeu.update(1);
  assert.ok(Math.abs(jeu.hero.x - (240 - 40)) < 0.01, 'sous EMP, le vaisseau va à l\'opposé');
  jeu.hero.sens = 1;

  // Le relâcher rend la main au clavier : cibleX null n'aimante plus.
  jeu.entree.cibleX = null;
  const x = jeu.hero.x;
  jeu.update(1);
  assert.ok(Math.abs(jeu.hero.x - x) < 0.01, 'plus de doigt, plus d\'aimant');
});

test('un vaisseau ne s\'enrôle qu\'une fois — sauf le basique', () => {
  const plateforme = { carte: W.carteNeuve() };
  plateforme.carte.$ship = [1, 1, 1, 0, 0, 0];
  const ui = new M.Interface({
    canvas: { getContext: () => ({}) },
    sprites: {}, poser: () => {}, plateforme, niveaux: NIVEAUX,
    surChoix: () => {}, surSon: () => {},
  });
  ui.escadron = { lancement: { vies: 4 }, choix: [] };

  ui.choisirVaisseau(2);
  assert.deepEqual(ui.escadron.choix, [2], 'premier choix accepté');
  ui.choisirVaisseau(2);
  assert.deepEqual(ui.escadron.choix, [2], 'le même vaisseau est refusé');
  assert.match(String(ui.message), /escadron/, 'et le joueur est prévenu');
  ui.choisirVaisseau(0);
  ui.choisirVaisseau(0);
  assert.deepEqual(ui.escadron.choix, [2, 0, 0], 'le basique, lui, se reprend');
});

test('la bande tactile a remplacé les boutons, et le compteur dit le portefeuille', () => {
  const page = fs.readFileSync(path.join(ROOT, 'public/miniwave/index.html'), 'utf8');
  assert.match(page, /id="pave-tactile"/, 'la bande est là');
  assert.ok(!/data-cmd="tir"/.test(page), 'plus de bouton de tir');
  assert.ok(!/data-cmd="gauche"/.test(page), 'plus de boutons de direction');
  assert.match(page, /portefeuille: Number\(plateforme\.carte\.\$credit\)/,
    'le solde de la fiche part avec la partie');

  const rendu = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(rendu, /\(jeu\.portefeuille \|\| 0\) \+ jeu\.credits/,
    'le compteur affiche portefeuille + récolte');
  assert.match(rendu, /'#pave-tactile'/, 'et la bande est branchée');
  assert.match(rendu, /dernierTap < 320/, 'double-tap : la spéciale');

  // Le pilotage doit tenir sur un VRAI téléphone : Pointer Events avec
  // capture (iOS/Android/souris, un seul chemin), le canevas lui-même comme
  // surface (l'instinct pose le doigt sur le jeu), et des scripts estampillés
  // pour que les téléphones ne rejouent pas un vieux game.js en cache.
  assert.match(rendu, /setPointerCapture/, 'la capture suit le doigt hors surface');
  assert.match(rendu, /piloter\(this\.canvas, true\)/, 'le jeu lui-même se pilote');
  assert.match(rendu, /horsMenu && this\.avant && this\.avant\.visible/,
    'mais pas pendant que le menu écoute');
  assert.match(page, /game\.js\?v=/, 'les scripts sont estampillés');
});
