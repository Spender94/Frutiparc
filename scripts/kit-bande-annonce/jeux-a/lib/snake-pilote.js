/*
 * Frutisnake 3 — les PILOTES de la capture (injectés dans la page).
 *
 * Le jeu lit ses commandes à chaque pas par `jeu.entreesPartie()` (partie
 * solo) et `jeu.entreesBataille()` (Battle sur un clavier). On enveloppe ces
 * deux lectures, le temps de la capture, pour y mettre les gestes d'un pilote :
 * rien du jeu n'est changé, c'est exactement ce que donnerait un clavier.
 *
 * SOLO : un serpent qui regarde devant lui, à la manière du bot du Battle en
 * ligne (public/snake3/server/bot.js) — il pousse sa tête EN PENSÉE contre les
 * murs et contre son propre corps (`toucheLeCorps`, la vraie collision) pour
 * chaque plan « tourner k pas puis aller droit » — et, parmi les gestes sûrs,
 * prend celui qui le rapproche du fruit visé (le plus proche, une option de
 * temps en temps). Un fruit hors d'atteinte (dans le cercle de virage) est
 * abandonné un moment. Turbo quand la voie est libre loin devant, ESPACE pour
 * vider la case d'option quand il en tient une.
 *
 * BATTLE : chaque serpent est joué par le bot du jeu lui-même
 * (SnakeBattle.bot.decider, chargé depuis /snake3/server/bot.js), au niveau
 * de jeu `skill`.
 */
'use strict';

function installerPiloteSolo(reglages) {
  /* eslint-disable no-undef */
  const R = Object.assign({ horizon: 50, turbo: 0.5, options: true, espace: false }, reglages || {});
  const jeu = window.__frutisnake;
  const orig = jeu.entreesPartie.bind(jeu);
  let cible = null, cibleDepuis = 0, pasTotal = 0, espace = 0, prochaineOption = 160, droit = 0;
  const bannis = new Map();
  const T = { pas: 0, fruits: 0, cible: null };
  window.__pilote = T;
  const angle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  jeu.entreesPartie = function () {
    const e = orig();
    const m = jeu.mode, p = m && m.partie;
    if (!p || p.pause || p.game_over_flag || !p.serpent) return e;
    pasTotal++; T.pas = pasTotal;
    const s = p.serpent, b = p.niveau.bounds();
    const tmod = jeu.tmod || 0.8;
    const v = Math.max(s.speed, 1) * tmod * Math.max(s.base_speed, 1);
    const ds = Math.min(10 + s.len, 18);
    const marge = 6;
    // Combien de pas la tête tient-elle en tournant `vir` pendant k pas, puis tout droit ?
    const survie = (vir, k, H) => {
      let ang = s.ang, x = s.x, y = s.y;
      for (let n = 1; n <= H; n++) {
        if (n <= k) ang += vir * s.delta_ang * tmod;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        x += dx * v; y += dy * v;
        const px = x + dx * ds, py = y + dy * ds;
        if (px < b.left + marge || py < b.top + marge || px > b.right - marge || py > b.bottom - marge) return n;
        if (n > 1 && s.queue_collide !== false && s.toucheLeCorps(px, py)) return n;
      }
      return H + 1;
    };
    const H = R.horizon;
    // `sur` : le meilleur plan sur l'horizon court (est-ce sûr ?) ; `long` :
    // sur un horizon double — une mesure de la place qui reste devant.
    const sur = {}, long = {};
    for (const vir of [-1, 0, 1]) {
      let best = 0, bestL = 0;
      for (const k of (vir === 0 ? [0] : [3, 8, 16, 30, 60, 2 * H])) {
        best = Math.max(best, survie(vir, k, H));
        if (best > H) bestL = Math.max(bestL, survie(vir, k, 2 * H));
      }
      sur[vir] = best; long[vir] = bestL;
    }
    // La cible : le fruit (ou l'option) le plus proche qui ne soit pas banni.
    for (const [o, t] of bannis) if (t < pasTotal) bannis.delete(o);
    const objets = p.niveau.fruits.concat(R.options ? p.niveau.bonuses : []);
    if (cible && objets.indexOf(cible) < 0) { if (p.niveau.fruits.indexOf(cible) < 0) T.fruits++; cible = null; }
    if (cible && pasTotal - cibleDepuis > 260) { bannis.set(cible, pasTotal + 200); cible = null; }
    if (!cible) {
      let d0 = Infinity;
      for (const o of objets) {
        if (bannis.has(o)) continue;
        const d = Math.hypot(o.x - s.x, o.y - s.y) + (p.niveau.bonuses.indexOf(o) >= 0 ? 80 : 0);
        if (d < d0) { d0 = d; cible = o; }
      }
      cibleDepuis = pasTotal;
    }
    let vir = 0;
    let sures = [-1, 0, 1].filter((k) => sur[k] > H);
    // Parmi les gestes sûrs, on écarte ceux qui mènent dans un cul-de-sac.
    if (sures.length > 1) {
      const meilleur = Math.max.apply(null, sures.map((k) => long[k]));
      sures = sures.filter((k) => long[k] >= meilleur * 0.85);
    }
    if (droit > 0) droit--;
    if (cible) {
      const err = angle(Math.atan2(cible.y - s.y, cible.x - s.x) - s.ang);
      const dist = Math.hypot(cible.x - s.x, cible.y - s.y);
      // Rayon de virage : un fruit dans le cercle ne s'attrape pas en tournant ;
      // on file tout droit un moment pour reprendre de l'élan.
      const rayon = v / Math.max(1e-3, s.delta_ang * tmod);
      if (dist < rayon * 1.25 && Math.abs(err) > 1.0 && !droit) droit = 14;
      const voulu = Math.abs(err) < 0.06 ? 0 : (err > 0 ? 1 : -1);
      vir = droit ? 0 : voulu;
      T.cible = { x: Math.round(cible.x), y: Math.round(cible.y), err: +err.toFixed(2) };
    }
    if (sures.length && sures.indexOf(vir) < 0) vir = sures.indexOf(0) >= 0 ? 0 : sures[0];
    if (!sures.length) vir = [-1, 0, 1].reduce((a, k) => (sur[k] > sur[a] ? k : a), 0);
    const out = Object.assign({}, e, { gauche: vir < 0, droite: vir > 0 });
    // Turbo : la voie est libre loin devant et la cible est loin.
    const loin = cible ? Math.hypot(cible.x - s.x, cible.y - s.y) > 160 : false;
    out.haut = R.turbo > 0 && sur[0] > H && loin && ((pasTotal >> 5) % 3 !== 0);
    // ESPACE : vider la première case d'option, de temps en temps et sans danger.
    if (espace > 0) { espace--; out.espace = true; }
    else if (R.espace && p.slots && p.slots.length && pasTotal > prochaineOption && sures.length === 3) {
      espace = 2; out.espace = true; prochaineOption = pasTotal + 120;
    }
    return out;
  };
  return true;
  /* eslint-enable no-undef */
}

function installerPiloteBataille(reglages) {
  /* eslint-disable no-undef */
  const R = Object.assign({ skill: [0.9, 0.85, 0.8, 0.75], graine: 77 }, reglages || {});
  const jeu = window.__frutisnake;
  const bot = window.SnakeBattle && window.SnakeBattle.bot;
  if (!bot) throw new Error('bot Battle absent');
  let a = R.graine >>> 0;
  const rng = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const etats = [{}, {}, {}, {}];
  const orig = jeu.entreesBataille.bind(jeu);
  jeu.entreesBataille = function () {
    const e = orig();
    const m = jeu.mode;
    if (!m || !m.bataille) return e;
    const session = { bataille: m.bataille, objets: [] };
    for (let i = 0; i < m.bataille.serpents.length; i++) {
      if (!m.bataille.serpents[i]) continue;
      e[i] = bot.decider(session, i, R.skill[i] || 0.8, rng, etats[i]);
    }
    return e;
  };
  return true;
  /* eslint-enable no-undef */
}

module.exports = { installerPiloteSolo, installerPiloteBataille };
