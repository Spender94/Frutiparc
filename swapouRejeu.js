'use strict';
/*
 * SWAPOU — LE REJEU D'UNE PARTIE CHALLENGE, pour en vérifier le score.
 *
 * Le score d'une partie est calculé par le navigateur : seul, il ne prouve
 * rien. Mais depuis que les tirages qui décident de la partie (couleur et
 * marques des fruits qui montent) sortent d'une GRAINE que le serveur donne
 * (SW.tirage, public/swapou/game.js), une partie se rejoue à l'identique à
 * partir de cette graine et de la liste des coups. On la rejoue donc ici,
 * avec le VRAI code du jeu (chargé dans un bac à sable, comme les tests et
 * le harnais du bot) — pas une copie des règles qui pourrait diverger.
 *
 * Le verdict :
 *   · « conforme »  — la partie rejouée finit, sur le dernier coup, au
 *     score déclaré ;
 *   · « divergent » — un coup est impossible, la partie finit trop tôt ou
 *     pas du tout, ou le score diffère ;
 *   · le cas « graine locale » (le serveur n'a pas répondu à temps) se rejoue
 *     aussi, mais la graine venant du navigateur, la preuve est plus faible :
 *     c'est à l'appelant de le noter.
 *
 * Le module ne décide RIEN : il rejoue et rend un constat. Il tourne dans un
 * fil à part (swapouRejeuFil.js), jamais dans la boucle du serveur.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DOSSIER = path.join(__dirname, 'public', 'swapou');
const FICHIERS = ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'];
// Le pas d'image du rejeu. La partie n'en dépend pas (les tests le vérifient
// en jouant à pas variable et en rejouant à pas fixe) ; un grand pas rejoue
// vite.
const TMOD = 6;
const DT = TMOD / 40;
const GARDE_IMAGES = 4000000;
const MAX_COUPS = 20000;

let moteur = null;
function charger() {
  if (moteur) return moteur;
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URLSearchParams,
    performance: { now: () => Date.now() },
    Date, Math, JSON,
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of FICHIERS) {
    vm.runInContext(fs.readFileSync(path.join(DOSSIER, f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.SW.Manager.init('');                   // client autonome : rien ne part
  moteur = sandbox;
  return moteur;
}

// « s3,5,0@812! » → { t: 's', x: 3, y: 5, sens: 0, ms: 812, ia: true }
function lireCoups(texte) {
  const coups = [];
  for (const brut of String(texte || '').split(';')) {
    if (!brut) continue;
    const m = /^(s(\d+),(\d+),([0-3])|d)@(\d+)(!?)$/.exec(brut);
    if (!m) return null;
    if (m[1] === 'd') coups.push({ t: 'd', ms: Number(m[5]), ia: m[6] === '!' });
    else coups.push({ t: 's', x: Number(m[2]), y: Number(m[3]), sens: Number(m[4]), ms: Number(m[5]), ia: m[6] === '!' });
    if (coups.length > MAX_COUPS) return null;
  }
  return coups;
}

const SENS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// L'analyseur de l'IA (le même que celui du jeu), chargé à la demande : il ne
// sert qu'au calcul d'accord, que l'admin lance lui-même.
let analyseur = null;
function chargerAnalyseur() {
  if (!analyseur) analyseur = require(path.join(DOSSIER, 'analyse.js'));
  return analyseur;
}
// Une case échangée, sans direction : (x,y)↔(x+1,y) et (x+1,y)↔(x,y) sont le
// même coup.
function cleEchange(x, y, dx, dy) {
  const a = x + ',' + y, b = (x + dx) + ',' + (y + dy);
  return a < b ? a + '|' + b : b + '|' + a;
}

/**
 * @param {{ graine:number, coups:string, perso:number }} p
 * @param {{ analyse?: { budgetMs?:number }, surCoup?: function }} [opts]
 *   `analyse` : avant chaque coup, demander à l'analyseur de l'IA son
 *   classement des coups possibles, et noter le rang du coup joué (l'accord).
 * @returns {{ ok:boolean, fini:boolean, score:number, joues:number, total:number, raison?:string, accord?:object }}
 */
function rejouer(p, opts) {
  opts = opts || {};
  const coups = lireCoups(p.coups);
  if (!coups) return { ok: false, fini: false, score: 0, joues: 0, total: 0, raison: 'journal illisible' };
  const S = charger();
  const SW = S.SW, Manager = SW.Manager;
  const perso = Number(p.perso) | 0;
  if (perso < 0 || perso >= S.SwapouEngine.CHAR_NAMES.length) {
    return { ok: false, fini: false, score: 0, joues: 0, total: coups.length, raison: 'personnage inconnu' };
  }
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.players = [perso, -1];
  if (Manager.mode && Manager.mode.destroy) Manager.mode.destroy();
  Manager.client.partie = { id: 'rejeu', graine: Number(p.graine) >>> 0 };
  Manager.mode = new SW.Challenge();
  const chal = Manager.mode;
  let i = 0, images = 0, raison = null;
  const A = opts.analyse ? chargerAnalyseur() : null;
  const aide = A ? new SW.AnalyseChallenge(chal) : null;
  const rangs = [];
  while (Manager.mode === chal) {
    if (++images > GARDE_IMAGES) { raison = 'rejeu interrompu (trop long)'; break; }
    if (!chal.lock && !chal.pause.activated()) {
      if (i >= coups.length) { raison = 'la partie continue après le dernier coup'; break; }
      const c = coups[i++];
      if (A) rangs.push(rangDuCoup(A, aide, c, opts.analyse));
      if (opts.surCoup) opts.surCoup(i, coups.length);
      if (c.t === 'd') {
        chal.defend();
        if (!chal.lock) { raison = 'défense impossible au coup ' + i; break; }
      } else {
        const lvl = chal.player.level;
        const [dx, dy] = SENS[c.sens];
        const col = lvl.fruits[c.x];
        const col2 = lvl.fruits[c.x + dx];
        const paire = {
          x: c.x, y: c.y, dx, dy,
          f1: col ? (col[c.y] === undefined ? null : col[c.y]) : null,
          f2: col2 ? (col2[c.y + dy] === undefined ? null : col2[c.y + dy]) : null,
        };
        if (!paire.f1 || !chal.jouerPaire(paire)) { raison = 'échange impossible au coup ' + i; break; }
      }
    }
    Manager.main(TMOD, DT);
  }
  const fini = Manager.mode !== chal;
  if (fini && i < coups.length) raison = raison || ('partie finie au coup ' + i + ' sur ' + coups.length);
  const score = chal.player.score;
  // L'écran de fin, refermé : le bac à sable est prêt pour la suivante.
  if (Manager.mode && Manager.mode.destroy) Manager.mode.destroy();
  Manager.mode = null;
  const r = { ok: !raison && fini, fini, score, joues: i, total: coups.length, raison: raison || undefined };
  if (A) r.accord = bilanAccord(rangs, coups);
  return r;
}

// Le rang du coup joué dans le classement de l'analyseur (1 = son meilleur),
// 0 s'il n'y figure pas. Les ex æquo partagent leur rang : quand deux coups
// valent autant, jouer l'un ou l'autre, c'est être d'accord avec l'IA.
// Le budget par défaut est celui du conseil en partie (AnalyseChallenge) :
// plus court, la recherche serait coupée au hasard de l'horloge, et l'IA ne
// serait même plus d'accord avec elle-même.
function rangDuCoup(A, aide, c, options) {
  const res = A.analyserGrille(aide.grille(), aide.etat(), Object.assign({ budgetMs: 1500 }, options));
  const liste = res.coups || [];
  let cle = null;
  if (c.t === 's') {
    const [dx, dy] = SENS[c.sens];
    cle = cleEchange(c.x, c.y, dx, dy);
  }
  for (let k = 0; k < liste.length; k++) {
    const m = liste[k];
    if (c.t === 'd' ? m.type === 'defend'
      : (m.type === 'swap' && m.pair && cleEchange(m.pair.x, m.pair.y, m.pair.dx, m.pair.dy) === cle)) {
      let devant = 0;
      for (const o of liste) if (o.valeur > m.valeur + 1e-9) devant++;
      return { rang: devant + 1, sur: liste.length };
    }
  }
  return { rang: 0, sur: liste.length };
}

// Ce que l'accord dit : la part des coups qui sont LE meilleur de l'IA, ou
// dans ses trois premiers, parmi les coups qui laissaient un vrai choix
// (au moins cinq possibles) — les coups forcés ne disent rien. Les coups
// joués par le bouton de l'IA sont comptés à part.
function bilanAccord(rangs, coups) {
  let choix = 0, premier = 0, top3 = 0, parIa = 0;
  const parTranche = [];
  for (let k = 0; k < rangs.length; k++) {
    const r = rangs[k];
    if (coups[k] && coups[k].ia) { parIa++; continue; }
    if (r.sur < 5) continue;
    choix++;
    if (r.rang === 1) premier++;
    if (r.rang >= 1 && r.rang <= 3) top3++;
    const t = Math.floor(k / 50);
    parTranche[t] = parTranche[t] || { coups: 0, premier: 0 };
    parTranche[t].coups++;
    if (r.rang === 1) parTranche[t].premier++;
  }
  const pct = (n) => (choix ? Math.round((n / choix) * 1000) / 10 : 0);
  return {
    coups: rangs.length, choix, parIa,
    premierPct: pct(premier), top3Pct: pct(top3),
    // Par tranche de cinquante coups : un joueur qui passe à l'IA en cours de
    // partie se voit à la courbe.
    tranches: parTranche.map((t) => (t && t.coups ? Math.round((t.premier / t.coups) * 100) : null)),
  };
}

// Le rythme d'une partie, tiré du journal : de quoi repérer un jeu trop
// régulier (toujours le même temps de réflexion) ou joué par le bouton de
// l'IA.
function rythme(texte) {
  const coups = lireCoups(texte) || [];
  const ms = coups.map((c) => c.ms).filter((v) => Number.isFinite(v));
  const tries = ms.slice().sort((a, b) => a - b);
  const q = (f) => (tries.length ? tries[Math.min(tries.length - 1, Math.floor(f * tries.length))] : 0);
  const moy = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;
  const et = ms.length ? Math.sqrt(ms.reduce((a, b) => a + (b - moy) * (b - moy), 0) / ms.length) : 0;
  return {
    coups: coups.length,
    defenses: coups.filter((c) => c.t === 'd').length,
    parIa: coups.filter((c) => c.ia).length,
    medianeMs: q(0.5),
    q10Ms: q(0.1),
    q90Ms: q(0.9),
    // Coefficient de variation (écart type / moyenne) : un humain varie d'un
    // coup à l'autre ; un programme qui joue à cadence fixe, très peu.
    variation: moy ? Math.round((et / moy) * 100) / 100 : 0,
  };
}

module.exports = { rejouer, rythme, lireCoups, charger, cleEchange };
