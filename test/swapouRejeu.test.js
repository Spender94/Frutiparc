'use strict';
/*
 * SWAPOU — LE REJEU QUI VÉRIFIE LES SCORES
 * ════════════════════════════════════════
 *
 * Deux promesses, et ce fichier les tient :
 *
 *   1. LE JEU NE CHANGE PAS. Une partie jouée comme dans un navigateur — à pas
 *      d'image variable, le temps que met chaque image à venir — se rejoue à
 *      pas fixe sur le serveur et finit au MÊME score, sur le même dernier
 *      coup. Si le jeu dépendait du pas, ou si la graine n'était pas la seule
 *      source du hasard qui compte, les parties divergeraient ici.
 *
 *   2. UNE TRICHE SE VOIT. Un score gonflé, un coup retiré, un coup ajouté, une
 *      autre graine : le rejeu ne retombe pas sur ses pieds.
 *
 * Plus : le journal se lit comme on l'écrit, le rythme se mesure, et l'accord
 * avec l'IA distingue une partie jouée par l'analyseur d'une partie jouée par
 * un autre programme.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'public', 'swapou');
const R = require(path.join(ROOT, 'swapouRejeu.js'));

// Un « navigateur » à part : le jeu, le bot, et un pas d'image au hasard.
function navigateur() {
  const sb = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URLSearchParams,
    performance: { now: () => Date.now() }, Date, Math, JSON,
  };
  sb.self = sb; sb.window = sb;
  vm.createContext(sb);
  for (const f of ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js', 'bot.js']) {
    vm.runInContext(fs.readFileSync(path.join(DOSSIER, f), 'utf8'), sb, { filename: f });
  }
  sb.SW.Manager.init('');
  return sb;
}

// Un générateur à graine pour le test lui-même : les parties sont variées,
// mais les mêmes d'une exécution à l'autre.
function hasard(g) {
  let a = g >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Le clic de la souris sur une paire, comme le joueur (SW.pickPair).
function cliquer(SW, chal, pair) {
  const info = chal.player.animator.getInfos();
  let px, py;
  if (pair.dx === 1) { px = info.px + pair.x * 35 + 30; py = info.py + pair.y * 35 + 17; }
  else { px = info.px + pair.x * 35 + 17; py = info.py + pair.y * 35 + 30; }
  SW.handleMouseMove(px, py);
  chal.onClickDown();
}

// Une partie complète, jouée par le bot avec des défenses et des coups au
// hasard, à pas variable. Rend { graine, perso, coups, score }.
function jouer(sb, graine, perso, alea, choisir) {
  const SW = sb.SW, M = SW.Manager, Bot = sb.SwapouBot, E = sb.SwapouEngine;
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.players = [perso, -1];
  if (M.mode && M.mode.destroy) M.mode.destroy();
  M.client.partie = { id: 'essai', graine };
  M.mode = new SW.Challenge();
  const chal = M.mode;
  let images = 0;
  while (M.mode === chal && images++ < 3000000) {
    if (!chal.lock && !chal.pause.activated()) {
      const etat = {
        charId: perso,
        canDefend: chal.player.canDefend() && chal.interf.pl[0].power >= E.DEFENSE_STARS[perso],
        stars: chal.player.star_counter, ncoups: chal.ncoups,
      };
      const mv = choisir ? choisir(chal, etat)
        : (alea() < 0.15 ? Bot.choose(chal.player.level, Object.assign({}, etat, { canDefend: false }))
          : Bot.choose(chal.player.level, etat));
      if (mv.type === 'none') break;
      if (mv.type === 'defend') chal.interf.defend();
      else cliquer(SW, chal, mv.pair);
    }
    const pas = 0.5 + alea() * 3.5;            // comme requestAnimationFrame
    M.main(pas, pas / 40);
  }
  const pf = M.client.partieFinie;
  M.client.partieFinie = null;
  assert.ok(pf, 'la partie laisse son récit au client');
  assert.equal(pf.graine, graine, 'la graine du serveur est bien celle de la partie');
  return { graine, perso, coups: pf.coups, score: chal.player.score, duree: pf.duree };
}

const sb = navigateur();
const NB = Number(process.env.SWAPOU_REJEU_PARTIES) || 40;
const parties = [];
const alea = hasard(20260930);
for (let g = 0; g < NB; g++) {
  const perso = g % sb.SwapouEngine.CHAR_NAMES.length;
  parties.push(jouer(sb, (alea() * 4294967296) >>> 0, perso, alea));
}

test(`le rejeu à pas fixe retrouve le score de ${NB} parties jouées à pas variable`, () => {
  let defenses = 0;
  for (const p of parties) {
    const r = R.rejouer(p);
    assert.ok(r.ok, `graine ${p.graine} : ${r.raison}`);
    assert.equal(r.score, p.score, `graine ${p.graine} : même score`);
    assert.equal(r.joues, r.total, 'tous les coups joués, pas un de plus');
    defenses += R.rythme(p.coups).defenses;
  }
  assert.ok(defenses > 0, 'des défenses ont été jouées et rejouées');
});

test('un score gonflé, un coup retiré ou ajouté, une autre graine : divergent', () => {
  const p = parties.find((x) => x.coups.split(';').length > 20);
  const r0 = R.rejouer(p);
  assert.ok(r0.ok);
  assert.notEqual(r0.score, p.score + 500, 'le score déclaré gonflé ne tombe pas juste');
  const coups = p.coups.split(';');
  // Un coup de moins : la partie continue après le dernier coup (ou un
  // coup suivant devient impossible).
  const sans = coups.slice(0, 10).concat(coups.slice(11)).join(';');
  const r1 = R.rejouer(Object.assign({}, p, { coups: sans }));
  assert.ok(!r1.ok || r1.score !== p.score, 'un coup retiré se voit');
  // La même partie, coupée avant la fin : elle ne finit pas.
  const r2 = R.rejouer(Object.assign({}, p, { coups: coups.slice(0, coups.length - 3).join(';') }));
  assert.equal(r2.ok, false);
  assert.match(r2.raison, /continue après le dernier coup|impossible/);
  // Un coup de trop, après la fin.
  const r3 = R.rejouer(Object.assign({}, p, { coups: p.coups + ';s0,0,0@500' }));
  assert.equal(r3.ok, false);
  assert.match(r3.raison, /partie finie au coup/);
  // Une autre graine : d'autres fruits, les coups ne vont plus.
  const r4 = R.rejouer(Object.assign({}, p, { graine: (p.graine + 1) >>> 0 }));
  assert.ok(!r4.ok || r4.score !== p.score, 'une autre graine se voit');
});

test('un journal illisible ou un personnage inconnu ne plantent pas le rejeu', () => {
  assert.equal(R.rejouer({ graine: 1, coups: 'n’importe quoi', perso: 0 }).raison, 'journal illisible');
  assert.equal(R.rejouer({ graine: 1, coups: 's1,1,0@10', perso: 99 }).raison, 'personnage inconnu');
  assert.equal(R.rejouer({ graine: 1, coups: '', perso: 0 }).ok, false);
  // Et le rejeu suivant repart d'un bac à sable propre.
  const p = parties[0];
  assert.equal(R.rejouer(p).score, p.score);
});

test('le journal : échanges, défenses, coups de l’IA, temps de réflexion', () => {
  assert.deepEqual(R.lireCoups('s3,5,0@812!;d@40;s0,11,3@7'), [
    { t: 's', x: 3, y: 5, sens: 0, ms: 812, ia: true },
    { t: 'd', ms: 40, ia: false },
    { t: 's', x: 0, y: 11, sens: 3, ms: 7, ia: false },
  ]);
  assert.equal(R.lireCoups('s3,5,4@1'), null, 'un sens hors de 0..3 est refusé');
  const ry = R.rythme('s1,1,0@100;s1,1,0@200;s1,1,0@300;d@400!');
  assert.equal(ry.coups, 4);
  assert.equal(ry.defenses, 1);
  assert.equal(ry.parIa, 1);
  assert.equal(ry.medianeMs, 300);
  // Un programme qui joue à cadence fixe : variation nulle.
  assert.equal(R.rythme('s1,1,0@500;s1,1,0@500;s1,1,0@500').variation, 0);
  // Le même échange, dit de ses deux bouts.
  assert.equal(R.cleEchange(2, 3, 1, 0), R.cleEchange(3, 3, -1, 0));
  assert.equal(R.cleEchange(2, 3, 0, 1), R.cleEchange(2, 4, 0, -1));
});

test('le temps de réflexion part du moment où le plateau se rend', () => {
  for (const p of parties.slice(0, 5)) {
    for (const c of R.lireCoups(p.coups)) assert.ok(c.ms >= 0 && Number.isFinite(c.ms));
    assert.ok(p.duree >= 0);
  }
});

test('l’accord avec l’IA : haut pour une partie de l’analyseur, bas pour le bot', () => {
  const A = require(path.join(DOSSIER, 'analyse.js'));
  const nav = navigateur();
  // Une partie courte jouée par l'analyseur lui-même (sans défense, pour
  // qu'elle finisse vite).
  // Réglage rapide ET sans horloge : un étage, pas de fin de partie à trois
  // étages — le classement ne dépend plus que du plateau.
  const REGLAGE = { budgetMs: 60000, profondeur: 1, tard: null };
  const parIa = jouer(nav, 777, 2, hasard(1), (chal, etat) => A.choisir(chal.player.level, etat, REGLAGE));
  const rIa = R.rejouer(parIa, { analyse: REGLAGE });
  assert.ok(rIa.ok, rIa.raison);
  assert.equal(rIa.accord.premierPct, 100, 'l’analyseur est d’accord avec lui-même : ' + rIa.accord.premierPct + ' %');
  // La partie d'un autre programme (le bot) : l'analyseur ne la reconnaît pas.
  const autre = parties.find((p) => p.coups.split(';').length < 120) || parties[0];
  const rBot = R.rejouer(autre, { analyse: REGLAGE });
  assert.ok(rBot.ok, rBot.raison);
  assert.ok(rBot.accord.premierPct < rIa.accord.premierPct - 30,
    `bot ${rBot.accord.premierPct} % contre analyseur ${rIa.accord.premierPct} %`);
  assert.equal(rBot.score, autre.score, 'l’analyse ne change pas le rejeu');
});

test('la partie hors ligne (sans graine du serveur) se joue et se raconte aussi', () => {
  const SW = sb.SW, M = SW.Manager;
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.players = [0, -1];
  if (M.mode && M.mode.destroy) M.mode.destroy();
  M.client.partie = null;
  M.mode = new SW.Challenge();
  const chal = M.mode;
  assert.ok(Number.isInteger(chal.graine) && chal.graine >= 0 && chal.graine < 4294967296,
    'le jeu tire sa propre graine');
  assert.equal(chal.partie, null);
  M.mode.destroy();
  M.mode = null;
});
