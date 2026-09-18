//
// Frutisnake Battle en ligne — le bot (un adversaire quand le salon est vide).
//
// Un serpent qui regarde devant lui. À chaque pas, il essaie ses trois
// gestes — tourner à gauche, aller droit, tourner à droite — et pousse sa
// tête EN PENSÉE sur une trentaine de pas, contre les murs, contre le corps
// de l'autre et contre le sien (`hit` et `toucheLeCorps` du moteur, les
// mêmes que la vraie collision). Il garde le geste qui survit le plus
// longtemps, avec un faible pour tout droit — un serpent qui zigzague pour
// rien se fait des nœuds.
//
// Le NIVEAU (skill 0…1) est la part des pas où il réfléchit vraiment : le
// reste du temps il garde son geste précédent, quoi qu'il voie. Le turbo
// part quand la voie est libre loin devant et que la jauge est haute.
//
(function (root, factory) {
  var C = (typeof require !== "undefined") ? require("../const.js") : root.SnakeConst;
  var api = factory(C);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.SnakeBattle = root.SnakeBattle || {}).bot = api;
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  var HORIZON = 32;                       // pas regardés devant
  var TMOD = C.WANTED_FPS / C.SWF_FPS;    // 0,8, le tmod de la partie

  // Combien de pas la tête tient-elle en tenant `virage` (-1, 0, +1) ?
  function survie(session, team, virage, horizon) {
    var ba = session.bataille;
    var s = ba.serpents[team];
    if (!s) return 0;
    var bounds = ba.niveau.bounds();
    var ang = s.ang, x = s.x, y = s.y;
    var v = Math.max(s.speed, C.SNAKE_DEFAULT_SPEED) * TMOD * s.base_speed;
    var ds = Math.min(10 + s.len, 18);
    var autres = ba.serpents.filter(function (o, k) { return o && k !== team; });
    // L'autre tête AVANCE aussi : on la projette sur son cap, sinon deux
    // serpents qui se foncent dessus se croient chacun la voie libre.
    var tetes = autres.map(function (o) {
      return { x: o.x, y: o.y, dx: Math.cos(o.ang) * Math.max(o.speed, C.SNAKE_DEFAULT_SPEED) * TMOD,
        dy: Math.sin(o.ang) * Math.max(o.speed, C.SNAKE_DEFAULT_SPEED) * TMOD };
    });
    var objets = session.objets || [];
    var rayon = (session.objetsCfg && session.objetsCfg.rayonBombe) || C.RAYON_BOMBE;
    for (var n = 1; n <= horizon; n++) {
      ang += virage * s.delta_ang * TMOD;
      var dx = Math.cos(ang), dy = Math.sin(ang);
      x += dx * v; y += dy * v;
      var px = x + dx * ds, py = y + dy * ds;
      if (px < bounds.left || py < bounds.top || px > bounds.right || py > bounds.bottom) return n;
      var pt = { x: px, y: py };
      if (s.toucheLeCorps(px, py)) return n;
      for (var i = 0; i < autres.length; i++) {
        if (autres[i].hit(pt)) return n;
        var t = tetes[i];
        t.x += t.dx; t.y += t.dy;
        if ((t.x - px) * (t.x - px) + (t.y - py) * (t.y - py) < 24 * 24) return n;
      }
      // Une bombe : on n'y met pas le nez, et quand la mèche est courte on
      // s'écarte de tout le souffle. Une dynamite : on la prend tant qu'on a
      // de quoi la payer, on l'évite quand elle coûterait la tête.
      for (var j = 0; j < objets.length; j++) {
        var o = objets[j];
        var d2 = (o.x - px) * (o.x - px) + (o.y - py) * (o.y - py);
        if (o.type === "dynamite") {
          var prises = (session.dynamites && session.dynamites[team]) || 0;
          if (s.len <= prises + 1 && d2 < 30 * 30) return n;
          continue;
        }
        if (o.type !== "bombe") continue;
        var r = (o.vie < 2.5) ? rayon + 12 : 40;
        if (d2 < r * r) return n;
      }
    }
    return horizon + 1;
  }

  // Le geste du bot pour ce pas. `etat` garde son geste précédent d'un pas à
  // l'autre (un objet vide au départ).
  function decider(session, team, skill, rng, etat) {
    etat = etat || {};
    var s = session.bataille.serpents[team];
    if (!s) return { gauche: false, droite: false, haut: false };
    var reflechit = rng() < (0.55 + 0.45 * skill);
    var virage = etat.virage || 0;
    if (reflechit) {
      var h = Math.round(HORIZON * (0.6 + 0.4 * skill));
      var meilleur = -1, choix = 0;
      var ordre = [0, -1, 1];
      for (var i = 0; i < ordre.length; i++) {
        var v = ordre[i];
        var score = survie(session, team, v, h) + (v === 0 ? 0.5 : 0) + (v === virage ? 0.25 : 0);
        if (score > meilleur) { meilleur = score; choix = v; }
      }
      virage = choix;
      // Une voie libre jusqu'au bout de l'horizon et une jauge pleine : turbo.
      etat.haut = meilleur > HORIZON && session.bataille.powers[team] > C.BATTLE_POWER_MAX * 0.6 && rng() < skill;
      if (meilleur <= 6 && rng() < skill * 0.5) etat.haut = false;
    }
    etat.virage = virage;
    return { gauche: virage < 0, droite: virage > 0, haut: !!etat.haut };
  }

  return { decider: decider, survie: survie, HORIZON: HORIZON };
});
