//
// Frutisnake Battle en ligne — la session (autorité d'UNE partie en réseau).
//
// LE SERVEUR JOUE LA PARTIE. Le mode Battle du jeu d'origine (Battle.as,
// porté dans bataille.js) est un moteur isomorphe : on le fait tourner ICI,
// à pas fixe — un quarantième de seconde, tmod 0,8, exactement l'horloge
// vers laquelle converge le lecteur d'origine (40 images de 1/32 s) — et les
// deux clients ne font que MIROITER ce qu'on leur envoie. Chacun envoie ses
// touches (gauche, droite, turbo), la session les applique au serpent de son
// équipe, et tranche seule les collisions et le vainqueur. Deux navigateurs
// n'ont pas les mêmes cosinus au dernier bit : leur laisser calculer, c'était
// deux parties qui divergent au bout d'une minute.
//
// Ce que la session ajoute au Battle d'époque :
//   · un COMPTE À REBOURS de trois secondes, le temps que les deux écrans
//     montrent l'arène ;
//   · des OBJETS qui tombent : des BOMBES — mèche de cinq secondes, puis un
//     souffle qui emporte la queue prise dedans et tue la tête qui s'y
//     trouve ; la toucher du nez la fait sauter aussitôt — et des FRUITS,
//     qui rendent trois segments et remplissent le turbo ;
//   · l'abandon (départ, déconnexion) → l'autre gagne.
//
// L'horloge est INJECTABLE (`now` en ms) pour des tests déterministes.
//
(function (root, factory) {
  var C = (typeof require !== "undefined") ? require("../const.js") : root.SnakeConst;
  var BA = (typeof require !== "undefined") ? require("../bataille.js") : root.SnakeBataille;
  var api = factory(C, BA);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.SnakeBattle = root.SnakeBattle || {}).session = api;
})(typeof self !== "undefined" ? self : this, function (C, BA) {
  "use strict";

  var PAS = 1 / C.SWF_FPS;                 // 1/40 s — le pas du lecteur d'origine
  var TMOD = C.WANTED_FPS / C.SWF_FPS;    // 32/40 = 0,8
  var RATTRAPAGE = 3;                      // pas joués d'un coup au plus (cf. game.js)
  var COMPTE_A_REBOURS = 3;                // secondes avant que les serpents ne partent

  // Les objets.
  var OBJETS = {
    premier: [6, 10],                      // secondes avant le premier objet
    suivants: [7, 12],                     // …puis entre deux objets
    max: 4,                                // posés en même temps, au plus
    marge: 40,                             // aux bords du terrain
    distanceTete: 110,                     // jamais sous le nez d'un serpent
    partBombes: 0.6,                       // sinon un fruit
    meche: C.TIME_BOMBE,                   // 5 s, comme la bombe du Challenge
    rayonBombe: 100,                       // le souffle (le Challenge : 160)
    contactBombe: 16,                      // la toucher du nez la fait sauter
    vieFruit: 12,                          // secondes avant qu'il ne pourrisse
    contactFruit: 20,
    segmentsFruit: 3,                      // rendus par un fruit
  };

  // Où une bombe posée en (x, y) COUPERAIT ce serpent : l'indice, compté
  // depuis la tête, du premier segment dans le rayon (coupureBombe de
  // bonus.js, au rayon près). `len` si rien n'y est ; sous 2, la tête y est.
  function coupure(serpent, x, y, rayon) {
    var q = serpent.queue, l = q.length, i;
    for (i = 1; i < serpent.len; i++) {
      var p = q[Math.max(0, l - i * 5 - 3)];
      var d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < rayon * rayon) break;
    }
    return i;
  }

  // opts : { id, players:[{id,name,fb?}], now?, rng?, objets? (false pour les
  //          couper, ou un objet qui surcharge OBJETS) }
  function SnakeBattleSession(opts) {
    opts = opts || {};
    var self = this;
    this.id = opts.id;
    this.rng = opts.rng || Math.random;
    this.players = (opts.players || []).slice(0, 2).map(function (p, i) {
      return { id: p.id, name: p.name, fb: p.fb || "", team: i };
    });
    this.objetsCfg = opts.objets === false ? null : Object.assign({}, OBJETS, opts.objets || {});
    this.inputs = [{ gauche: false, droite: false, haut: false }, { gauche: false, droite: false, haut: false }];
    this.phase = "compte";
    this.compte = COMPTE_A_REBOURS;
    this.temps = 0;                        // secondes de jeu jouées
    this.numero = 0;                       // numéro du pas (le client ordonne)
    this.ended = false;
    this.winner = null;                    // index d'équipe, -1 égalité
    this.endReason = null;                 // "collision" | "forfeit" | "draw"
    this.objets = [];
    this._seqObjet = 0;
    this._prochainObjet = this._tirer(this.objetsCfg ? this.objetsCfg.premier : [1e9, 1e9]);
    // Les événements d'un pas, à raconter au client (remis à zéro à chaque pas).
    this.evts = null;
    this._raz();

    var hasard = function (n) { return Math.floor(self.rng() * n); };
    this.bataille = new BA.Bataille({
      nplayers: 2,
      hasard: hasard,
      evenement: function (nom, d) {
        if (nom === "finBataille") self._finir(d.vainqueur, d.vainqueur === -1 ? "draw" : "collision");
      },
    });
    // On COMPTE ce que chaque serpent fait pendant un pas, pour que le miroir
    // du client refasse exactement les mêmes gestes sur sa propre file :
    // les points poussés par move (tous à la position de la tête), la pousse
    // (add_queue) et les segments partis en particules (explode).
    this.serpentsInit = this.bataille.serpents.slice();   // k → serpent, même une fois abattu
    this.bataille.serpents.forEach(function (s, k) {
      var move0 = s.move, add0 = s.add_queue, expl0 = s.explode;
      s.move = function (bounds, tmod) {
        var L = s.queue.length;
        var h = move0.call(s, bounds, tmod);
        self.evts.serpents[k].q += s.queue.length - L;
        return h;
      };
      s.add_queue = function (fid) { add0.call(s, fid); self.evts.serpents[k].g = 1; };
      s.explode = function (rgb) { expl0.call(s, rgb); self.evts.serpents[k].xp++; };
    });
    this.horloge = (opts.now !== undefined ? opts.now : Date.now());
    this._retard = 0;
  }

  SnakeBattleSession.prototype._tirer = function (fourchette) {
    return fourchette[0] + this.rng() * (fourchette[1] - fourchette[0]);
  };

  SnakeBattleSession.prototype._raz = function () {
    this.evts = { serpents: [{ q: 0, g: 0, xp: 0 }, { q: 0, g: 0, xp: 0 }], explosions: [], manges: [] };
  };

  SnakeBattleSession.prototype.teamOf = function (playerId) {
    for (var i = 0; i < this.players.length; i++) if (this.players[i].id === playerId) return this.players[i].team;
    return -1;
  };
  SnakeBattleSession.prototype.playerOfTeam = function (team) {
    for (var i = 0; i < this.players.length; i++) if (this.players[i].team === team) return this.players[i];
    return null;
  };

  // Les touches d'un joueur, telles qu'il les tient ENFONCÉES en ce moment.
  SnakeBattleSession.prototype.setInput = function (playerId, e) {
    var team = this.teamOf(playerId);
    if (team < 0 || this.ended) return { ok: false, error: "not-a-player" };
    e = e || {};
    this.inputs[team] = { gauche: !!e.gauche, droite: !!e.droite, haut: !!e.haut };
    return { ok: true };
  };

  SnakeBattleSession.prototype._finir = function (winner, reason) {
    if (this.ended) return;
    this.ended = true;
    this.phase = "fin";
    this.winner = winner;
    this.endReason = reason;
  };

  // Abandon ou déconnexion → l'adversaire gagne (sauf partie déjà finie).
  SnakeBattleSession.prototype.forfeit = function (playerId) {
    if (this.ended) return null;
    var team = this.teamOf(playerId);
    if (team < 0) return null;
    this._finir(team === 0 ? 1 : 0, "forfeit");
    return { ended: true, winner: this.winner };
  };

  // ── Les objets ────────────────────────────────────────────────────────────
  SnakeBattleSession.prototype._poserObjet = function () {
    var cfg = this.objetsCfg, b = this.bataille.niveau.bounds();
    var vivants = this.bataille.serpents.filter(function (s) { return !!s; });
    var x, y, essais = 0, loin = false;
    while (!loin && essais++ < 30) {
      x = b.left + cfg.marge + this.rng() * (b.right - b.left - 2 * cfg.marge);
      y = b.top + cfg.marge + this.rng() * (b.bottom - b.top - 2 * cfg.marge);
      loin = vivants.every(function (s) {
        return (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) >= cfg.distanceTete * cfg.distanceTete;
      });
    }
    if (!loin) return;
    var bombe = this.rng() < cfg.partBombes;
    this.objets.push({
      id: ++this._seqObjet,
      type: bombe ? "bombe" : "fruit",
      x: Math.round(x), y: Math.round(y),
      vie: bombe ? cfg.meche : cfg.vieFruit,
      fid: bombe ? 0 : 1 + Math.floor(this.rng() * C.FRUIT_BASE),
    });
  };

  SnakeBattleSession.prototype._exploser = function (o) {
    var cfg = this.objetsCfg, ba = this.bataille;
    this.evts.explosions.push({ x: o.x, y: o.y });
    for (var k = 0; k < ba.serpents.length; k++) {
      var s = ba.serpents[k];
      if (!s) continue;
      var i = coupure(s, o.x, o.y, cfg.rayonBombe);
      if (i < 2) ba.mortsExternes.push(k);        // la tête est dans le souffle
      else if (i < s.len) s.len = i;              // la queue prise dedans s'envole
    }
  };

  SnakeBattleSession.prototype._objets = function (dt) {
    var cfg = this.objetsCfg;
    if (!cfg) return;
    var ba = this.bataille;
    this._prochainObjet -= dt;
    if (this._prochainObjet <= 0) {
      if (this.objets.length < cfg.max) this._poserObjet();
      this._prochainObjet = this._tirer(cfg.suivants);
    }
    for (var n = 0; n < this.objets.length; n++) {
      var o = this.objets[n];
      o.vie -= dt;
      var parti = false;
      if (o.type === "bombe") {
        var touchee = false;
        for (var k = 0; k < ba.serpents.length && !touchee; k++) {
          var s = ba.serpents[k];
          if (!s) continue;
          var d = (s.x - o.x) * (s.x - o.x) + (s.y - o.y) * (s.y - o.y);
          if (d < cfg.contactBombe * cfg.contactBombe) touchee = true;
        }
        if (touchee || o.vie <= 0) { this._exploser(o); parti = true; }
      } else {
        for (var j = 0; j < ba.serpents.length && !parti; j++) {
          var sj = ba.serpents[j];
          if (!sj) continue;
          var dj = (sj.x - o.x) * (sj.x - o.x) + (sj.y - o.y) * (sj.y - o.y);
          if (dj < cfg.contactFruit * cfg.contactFruit) {
            // Trois segments rendus, tête gardée : le reste part en particules
            // (explode raccourcit d'un et annonce — le miroir fait de même).
            for (var m = 0; m < cfg.segmentsFruit && sj.len > 2; m++) sj.explode(sj.color);
            ba.powers[j] = C.BATTLE_POWER_MAX;
            this.evts.manges.push({ id: o.id, e: j });
            parti = true;
          }
        }
        if (!parti && o.vie <= 0) parti = true;   // pourri
      }
      if (parti) { this.objets.splice(n, 1); n--; }
    }
  };

  // ── Un pas de jeu ─────────────────────────────────────────────────────────
  SnakeBattleSession.prototype.step = function () {
    if (this.ended) return { ended: true };
    this._raz();
    this.numero++;
    if (this.phase === "compte") {
      this.compte -= PAS;
      if (this.compte <= 0) { this.compte = 0; this.phase = "jeu"; }
      return { ended: false };
    }
    this.temps += PAS;
    this._objets(PAS);
    this.bataille.main(TMOD, PAS, this.inputs);
    return { ended: this.ended, winner: this.winner };
  };

  // Rattrape le temps écoulé par pas fixes (trois au plus : au-delà, on
  // renonce au retard, comme le lecteur d'origine). Rend le nombre de pas
  // joués ; les événements de chaque pas se lisent par `snapshot()` entre
  // deux appels de step — d'où le rappel `chaquePas`.
  SnakeBattleSession.prototype.avancer = function (now, chaquePas) {
    if (this.ended) return 0;
    var dt = (now - this.horloge) / 1000;
    this.horloge = now;
    if (dt < 0) dt = 0;
    if (dt > C.MAX_DELTA_TIME) dt = C.MAX_DELTA_TIME;
    this._retard += dt;
    var n = 0;
    while (this._retard >= PAS && n < RATTRAPAGE && !this.ended) {
      this._retard -= PAS;
      n++;
      this.step();
      if (chaquePas) chaquePas(this);
    }
    if (n === RATTRAPAGE) this._retard = 0;
    return n;
  };

  // ── L'état pour le client ─────────────────────────────────────────────────
  // `full` : la file entière de chaque serpent (départ, reprise) ; sinon les
  // seuls gestes du pas (points poussés, pousse, particules).
  SnakeBattleSession.prototype.snapshot = function (full) {
    var ba = this.bataille, self = this;
    var serpents = [];
    for (var k = 0; k < 2; k++) {
      var s = this.serpentsInit[k], detruit = !ba.serpents[k];
      var e = this.evts.serpents[k];
      var o = {
        team: k,
        vivant: !detruit,
        x: s ? s.x : 0, y: s ? s.y : 0, ang: s ? s.ang : 0,
        speed: s ? s.speed : 0, len: s ? s.len : 0, eat: s ? s.eat : 0,
        power: ba.powers[k],
        q: e.q, g: e.g, xp: e.xp,
        fini: detruit && s.vivant === false,     // fondu jusqu'au bout
      };
      if (full && s) o.queue = s.queue.map(function (p) { return { x: p.x, y: p.y }; });
      serpents.push(o);
    }
    return {
      id: this.id,
      numero: this.numero,
      phase: this.phase,
      compte: this.compte,
      temps: this.temps,
      players: this.players.map(function (p) { return { id: p.id, name: p.name, team: p.team, fb: p.fb }; }),
      serpents: serpents,
      objets: this.objets.map(function (o) { return { id: o.id, type: o.type, x: o.x, y: o.y, vie: o.vie, fid: o.fid }; }),
      explosions: this.evts.explosions.slice(),
      manges: this.evts.manges.slice(),
      ended: this.ended, winner: this.winner, endReason: this.endReason,
      inputs: self.inputs.map(function (i) { return { gauche: i.gauche, droite: i.droite, haut: i.haut }; }),
    };
  };

  return { SnakeBattleSession: SnakeBattleSession, coupure: coupure, PAS: PAS, TMOD: TMOD, OBJETS: OBJETS, COMPTE_A_REBOURS: COMPTE_A_REBOURS };
});
