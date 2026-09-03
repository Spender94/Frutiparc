/*
 * Harnais HORS-LIGNE du bot Challenge :
 *   node public/swapou/bot.run.js [--games 10] [--char 0] [--seed 1]
 *                                 [--tmod 6] [--max-turns 20000] [--progress]
 *
 * Charge le vrai client (engine/game/screens) dans un contexte vm sans DOM
 * et laisse le bot jouer des parties complètes de Challenge : génération
 * réelle (montée du gel avec ncoups), étoiles, défenses, comptabilité
 * fidèle. RNG du jeu seedé (LCG) pour des parties reproductibles.
 *
 * Volontairement déconnecté de la plateforme : client standalone (pas de
 * sid), aucun score envoyé — outil d'étude, pas de quoi nourrir le
 * classement.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── arguments ────────────────────────────────────────────────────────────
const args = { games: 10, char: 0, seed: 1, tmod: 6, 'max-turns': 20000, progress: false, trace: 0, weights: null, depth2: false, samples: 3, topk: 8,
  // L'ANALYSEUR (analyse.js) à la place du bot : tout le faisceau à la
  // profondeur 2 sous budget (ses valeurs par défaut, cf. DEFAUTS).
  analyse: false, budget: 1500, prof: 2, k1: 400, k2: 10, k3: 6 };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--progress') args.progress = true;
  else if (a === '--depth2') args.depth2 = true;
  else if (a === '--analyse') args.analyse = true;
  else if (a === '--weights') args.weights = process.argv[++i];
  // Le relevé tour par tour, en JSON (une ligne par partie), pour étudier
  // les phases de la partie — début, milieu, fin — hors du bruit du terminal.
  else if (a === '--trace-json') args.traceJson = process.argv[++i];
  // Les réglages de l'analyseur (au-delà des poids) : '{"tard":{...}}'.
  else if (a === '--options') args.options = process.argv[++i];
  // REJOUER DES POSITIONS : un fichier JSONL de positions relevées
  // ({ char, ncoups, stars, g }, cf. le champ `g` du relevé), chacune jouée
  // `--horizon` tours au plus. Deux réglages partent des MÊMES positions :
  // c'est ce qui rend une fin de partie comparable, là où des parties
  // entières ne se départagent qu'au bout de dizaines de graines.
  else if (a === '--positions') args.positions = process.argv[++i];
  else if (a.startsWith('--')) args[a.slice(2)] = Number(process.argv[++i]);
}
if (args.horizon === undefined) args.horizon = 60;
const CHAR = args.char | 0;
const TMOD = Number(args.tmod) || 6;
const DT = TMOD / 40;

// ── sandbox (comme client.test.js) + RNG seedable ───────────────────────
let rngState = 1;
function seededRandom() {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}
const sandboxMath = {};
for (const k of Object.getOwnPropertyNames(Math)) sandboxMath[k] = Math[k];
sandboxMath.random = seededRandom;

const sandbox = {
  console: console, setTimeout: setTimeout, URLSearchParams: URLSearchParams,
  performance: { now: function () { return Date.now(); } },
  Date: Date, Math: sandboxMath, JSON: JSON,
};
sandbox.self = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js', 'bot.js', 'analyse.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
});

const SW = sandbox.SW;
const E = sandbox.SwapouEngine;
const Bot = sandbox.SwapouBot;
const Analyse = sandbox.SwapouAnalyse;
const Manager = SW.Manager;

function pump(n) {
  for (let i = 0; i < n; i++) Manager.main(TMOD, DT);
}
function maxHeight(level) {
  let m = 0;
  for (let x = 0; x < level.width; x++) {
    let y = 0;
    while (y < level.height && level.fruits[x][y] == null) y++;
    if (level.height - y > m) m = level.height - y;
  }
  return m;
}
function frozenCount(level) {
  let n = 0;
  for (let x = 0; x < level.width; x++)
    for (let y = 0; y < level.height; y++) {
      const f = level.fruits[x][y];
      if (f != null && (f.flags & E.FLAG_ARMURE) !== 0) n++;
    }
  return n;
}

// surcharge éventuelle des poids de l'évaluation (--weights '{"danger":60}')
if (args.weights) {
  const o = JSON.parse(args.weights);
  for (const k in o) Bot.WEIGHTS[k] = o[k];
  console.log('poids surchargés :', JSON.stringify(o));
}

// boot standalone une fois (client sans réseau)
Manager.init('');

// Une position relevée prend la place du plateau de départ : les fruits sont
// posés à leur case (sprite compris, comme `Level.attach` le fait), le
// compteur de coups et les étoiles remis à ce qu'ils étaient.
function injecter(chal, pos) {
  const level = chal.player.level;
  for (let x = 0; x < level.width; x++)
    for (let y = 0; y < level.height; y++) level.fruits[x][y] = null;
  let i = 0;
  for (let x = 0; x < level.width; x++)
    for (let y = 0; y < level.height; y++) {
      const ch = pos.g[i++];
      if (ch === '.' || ch === undefined) continue;
      const v = ch.charCodeAt(0) - 97;
      const k = Math.floor(v / 3), color = v % 3;
      const flags = k === 1 ? E.FLAG_ARMURE : k === 2 ? E.FLAG_NOSWAP : k === 3 ? E.FLAG_STAR : 0;
      level.fruits[x][y] = level.attach(x, y, color, flags);
    }
  chal.ncoups = Number(pos.ncoups) || chal.ncoups;
  const stars = Math.max(0, Math.min(E.MAX_POWER, Number(pos.stars) || 0));
  chal.player.star_counter = stars;
  chal.interf.pl[0].power = stars;
}

function playGame(seed, pos) {
  rngState = seed >>> 0 || 1;
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.players = [CHAR, -1];
  if (Manager.mode) Manager.mode.destroy();
  Manager.mode = new SW.Challenge();
  const chal = Manager.mode;
  if (pos) { injecter(chal, pos); rngState = seed >>> 0 || 1; }
  const t0 = Date.now();

  let turns = 0, defends = 0, maxH = 0, reason = 'gameover';
  let analyseMs = 0, analyseN = 0, preparations = 0;
  const traces = [];
  const analyseProf = {};
  let stuckRetries = 0;
  let frames = 0;
  const FRAME_GUARD = 4000000;

  while (Manager.mode === chal) {
    if (frames++ > FRAME_GUARD) { reason = 'frame-guard'; break; }
    if (!chal.lock && !chal.pause.activated()) {
      if (turns >= args['max-turns']) { reason = 'max-turns'; break; }
      const etat = {
        charId: CHAR,
        canDefend: chal.player.canDefend() && chal.interf.pl[0].power >= E.DEFENSE_STARS[CHAR],
        stars: chal.player.star_counter,
        ncoups: chal.ncoups,
        depth2: args.depth2,
        samples: args.samples | 0,
        topK: args.topk | 0,
      };
      let mv;
      if (args.analyse) {
        // --weights a déjà posé ses poids sur Bot.WEIGHTS : on ne laisse pas
        // l'analyseur les écraser par les siens.
        const opt = { budgetMs: args.budget, profondeur: args.prof,
          K1: args.k1, K2: args.k2, K3: args.k3, S: args.samples | 0 || 3 };
        if (args.weights) opt.poids = null;
        if (args.options) Object.assign(opt, JSON.parse(args.options));
        mv = Analyse.choisir(chal.player.level, etat, opt);
        if (mv.tempsMs !== undefined) { analyseMs += mv.tempsMs; analyseN++; analyseProf[mv.profondeur] = (analyseProf[mv.profondeur] || 0) + 1; }
        if (mv.nature === 'preparation') preparations++;
      } else {
        mv = Bot.choose(chal.player.level, etat);
      }
      // Le relevé du tour AVANT qu'il soit joué : la position, et ce qu'on y
      // décide (l'hauteur, la glace et le métal sont ceux que l'IA a vus).
      let releve = null;
      if (args.traceJson) {
        const hs = Bot.heights(Bot.copyGrid(chal.player.level));
        let gel = 0, gelHaut = 0, metal = 0, fruits = 0;
        for (let x = 0; x < chal.player.level.width; x++)
          for (let y = 0; y < chal.player.level.height; y++) {
            const f = chal.player.level.fruits[x][y];
            if (f == null) continue;
            fruits++;
            if ((f.flags & E.FLAG_ARMURE) !== 0) { gel++; if (y <= 4) gelHaut++; }
            else if ((f.flags & E.FLAG_NOSWAP) !== 0) metal++;
          }
        // La grille, compacte (168 caractères, colonne par colonne, du haut
        // vers le bas) : « . » vide, sinon un chiffre de base 8 = couleur +
        // 3 × (0 libre, 1 armure, 2 métal, 3 étoile). De quoi REJOUER la
        // position (--positions).
        let grille = '';
        for (let x = 0; x < chal.player.level.width; x++)
          for (let y = 0; y < chal.player.level.height; y++) {
            const f = chal.player.level.fruits[x][y];
            if (f == null) { grille += '.'; continue; }
            const k = (f.flags & E.FLAG_ARMURE) ? 1 : (f.flags & E.FLAG_NOSWAP) ? 2 : (f.flags & E.FLAG_STAR) ? 3 : 0;
            grille += String.fromCharCode(97 + f.save_t + 3 * k);   // a..l
          }
        releve = {
          t: turns + 1, score: chal.player.score, ncoups: chal.ncoups, g: grille,
          hmax: Math.max.apply(null, hs), hmoy: Math.round(hs.reduce(function (a, b) { return a + b; }, 0) / hs.length * 10) / 10,
          fruits: fruits, gel: gel, gelHaut: gelHaut, metal: metal,
          etoiles: chal.player.star_counter,
          mob: Bot.mobility(Bot.copyGrid(chal.player.level)),
          coup: mv.type, nature: mv.nature || null,
          gain: mv.gained ? (mv.gained.score || 0) : 0,
          phases: mv.gained ? (mv.gained.phases || 0) : 0,
          pieces: mv.gained ? (mv.gained.pieces || 0) : 0,
          v: mv.v === undefined ? null : Math.round(mv.v),
        };
      }
      if (mv.type === 'none') { reason = 'stuck'; break; }
      if (mv.type === 'defend') {
        chal.interf.defend();
        if (!chal.lock) { // garde-fou : désynchro étoiles → rejoue sans défense
          const mv2 = Bot.choose(chal.player.level, { charId: CHAR, canDefend: false, stars: 0 });
          if (mv2.type !== 'swap') { reason = 'stuck'; break; }
          execSwap(chal, mv2.pair);
        } else defends++;
      } else {
        execSwap(chal, mv.pair);
      }
      if (!chal.lock) {
        if (++stuckRetries > 3) { reason = 'stuck'; break; }
      } else {
        stuckRetries = 0;
        turns++;
        if (releve) traces.push(releve);
        const h = maxHeight(chal.player.level);
        if (h > maxH) maxH = h;
        if (args.progress && turns % 100 === 0)
          console.log('    tour ' + turns + ' : score=' + chal.player.score +
            ' hmax=' + h + ' gel=' + frozenCount(chal.player.level) +
            ' étoiles=' + chal.player.star_counter + ' ncoups=' + chal.ncoups);
        if (args.trace && turns >= args.trace)
          console.log('      t' + turns + ' ' + (mv.type === 'defend' ? 'DEF' : 'swap') +
            ' gain=' + (mv.gained ? mv.gained.score : 0) +
            ' hmax=' + h + ' gel=' + frozenCount(chal.player.level) +
            ' ★=' + chal.player.star_counter +
            ' mob=' + Bot.mobility(Bot.copyGrid(chal.player.level)));
      }
    }
    pump(1);
  }

  const score = chal.player.score;
  const secs = (Date.now() - t0) / 1000;
  // referme l'écran de fin pour la partie suivante
  if (Manager.mode !== chal && Manager.mode.onClickDown) {
    pump(30);
    Manager.mode.onClickDown();
  }
  const resultat = {
    seed: seed, score: score, turns: turns, defends: defends,
    maxH: maxH, ncoups: chal.ncoups, reason: reason, secs: secs,
    msParCoup: analyseN ? Math.round(analyseMs / analyseN) : 0,
    preparations: preparations, profondeurs: analyseProf,
    position: pos ? (pos.id || (pos.seed + ':' + pos.t)) : undefined,
  };
  if (args.traceJson) {
    fs.appendFileSync(args.traceJson, JSON.stringify(Object.assign({ char: CHAR, tours: traces }, resultat)) + '\n');
  }
  return resultat;
}

function execSwap(chal, pair) {
  const info = chal.player.animator.getInfos();
  let px, py;
  if (pair.dx === 1) {
    px = info.px + pair.x * 35 + 30;
    py = info.py + pair.y * 35 + 17;
  } else {
    px = info.px + pair.x * 35 + 17;
    py = info.py + pair.y * 35 + 30;
  }
  SW.handleMouseMove(px, py);
  chal.onClickDown();
}

const charName = E.CHAR_NAMES[CHAR].trim();
const defName = E.DEFENSE_NAMES[E.DEFENSE_PLAYERS[CHAR]].trim();

// ── Les positions rejouées ──
if (args.positions) {
  const positions = fs.readFileSync(args.positions, 'utf8').split('\n').filter(Boolean)
    .map(function (l) { return JSON.parse(l); })
    .filter(function (p) { return p.char === undefined || Number(p.char) === CHAR; });
  args['max-turns'] = Number(args.horizon);
  console.log('Positions rejouées — perso ' + CHAR + ' (' + charName + ', « ' + defName + ' » à '
    + E.DEFENSE_STARS[CHAR] + '★), ' + positions.length + ' positions, ' + args.horizon + ' tours au plus, graine ' + args.seed);
  const rs = [];
  positions.forEach(function (p, i) {
    const r = playGame(Number(args.seed) + i * 7919, p);
    r.position = p.id || (p.seed + ':' + p.t);
    r.vivant = r.reason === 'max-turns';
    rs.push(r);
    console.log('  ' + r.position + ' (ncoups ' + p.ncoups + ', ' + p.stars + '★) : +' + r.score + ' en ' + r.turns + ' tours'
      + (r.vivant ? ' — vivant' : ' — mort') + ', défenses=' + r.defends);
  });
  const moy = function (f) { return rs.length ? rs.reduce(function (a, r) { return a + f(r); }, 0) / rs.length : 0; };
  console.log('—');
  console.log('points moy=' + Math.round(moy(function (r) { return r.score; }))
    + '  tours moy=' + Math.round(moy(function (r) { return r.turns; }))
    + '  vivants=' + Math.round(100 * moy(function (r) { return r.vivant ? 1 : 0; })) + '%'
    + '  défenses moy=' + moy(function (r) { return r.defends; }).toFixed(1)
    + '  pts/tour=' + Math.round(moy(function (r) { return r.score; }) / Math.max(1, moy(function (r) { return r.turns; }))));
  process.exit(0);
}

console.log('Bot Swapou Challenge — perso ' + CHAR + ' (' + charName + ', défense « ' +
  defName + ' » à ' + E.DEFENSE_STARS[CHAR] + '★), ' + args.games + ' parties, graine ' + args.seed);

const results = [];
for (let i = 0; i < args.games; i++) {
  const r = playGame(Number(args.seed) + i * 7919);
  results.push(r);
  console.log('  partie ' + (i + 1) + ' (graine ' + r.seed + ') : score=' + r.score +
    ' tours=' + r.turns + ' défenses=' + r.defends + ' hmax=' + r.maxH +
    ' fin=' + r.reason + ' (' + r.secs.toFixed(1) + 's)' +
    (args.analyse ? ' · ' + r.msParCoup + ' ms/coup, préparations=' + r.preparations
      + ', profondeurs=' + JSON.stringify(r.profondeurs) : ''));
}

const scores = results.map(function (r) { return r.score; }).sort(function (a, b) { return a - b; });
const sum = scores.reduce(function (a, b) { return a + b; }, 0);
console.log('—');
console.log('meilleur=' + scores[scores.length - 1] +
  '  médiane=' + scores[Math.floor(scores.length / 2)] +
  '  moyenne=' + Math.round(sum / scores.length) +
  '  pire=' + scores[0] +
  '  tours moy=' + Math.round(results.reduce(function (a, r) { return a + r.turns; }, 0) / results.length));
