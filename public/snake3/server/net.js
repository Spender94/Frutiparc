//
// Frutisnake Battle en ligne — le pont réseau (la « cervelle » côté serveur).
//
// Le modèle de Frutibandas : ce module possède le salon (lobby.js), les
// sessions de bataille (session.js), les NOTES du championnat et les bots, et
// traduit chaque action d'un client en une liste de messages
// { to:[usernames], xml } que le transport (server.js) enverra. Aucune
// socket ici → entièrement testable. L'identité d'un joueur = son username.
//
// Protocole (XML sur le WebSocket existant, balise <sb>) :
//   client → serveur : <sb a="hello|list|seek|cancel|challenge|input|part|say" …/>
//   serveur → client : <sb e="lobby|start|state|end|chat|err" …> … </sb>
//
// La partie tourne SUR LE SERVEUR à quarante pas par seconde (session.js) ;
// `tick(now)` la fait avancer et rend, pour chaque pas, l'état à pousser aux
// deux joueurs. Un client n'envoie que ses touches (`input`), quand elles
// changent.
//
// LE CHAMPIONNAT — la note d'Elo du Championnat de Frutibandas (elo.js, le
// même module : placement rapide, plancher à 100). Chaque partie entre deux
// HUMAINS fait bouger les deux notes, égalité comprise (les deux têtes qui
// tombent au même pas valent un demi-point chacune) ; l'abandon et la
// déconnexion valent une défaite. La note part au classement « Frutisnake -
// Championnat » (onChampion). Un bot n'a pas de note : une partie contre lui
// est un ENTRAÎNEMENT, elle ne compte pas — sinon un adversaire toujours
// disponible ferait un distributeur d'Elo.
//
(function (root, factory) {
  var L = (typeof require !== "undefined") ? require("./lobby.js") : (root.SnakeBattle && root.SnakeBattle.lobby);
  var S = (typeof require !== "undefined") ? require("./session.js") : (root.SnakeBattle && root.SnakeBattle.session);
  var B = (typeof require !== "undefined") ? require("./bot.js") : (root.SnakeBattle && root.SnakeBattle.bot);
  // La note du championnat : celle de Frutibandas, le même Elo pour les deux
  // jeux (le module est pur et n'a rien de propre aux fruits).
  var E = (typeof require !== "undefined") ? require("../../bandas/server/elo.js") : (root.Bandas && root.Bandas.elo);
  var api = factory(L, S, B, E);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.SnakeBattle = root.SnakeBattle || {}).net = api;
})(typeof self !== "undefined" ? self : this, function (L, S, Bot, E) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function n1(v) { return Math.round(v * 10) / 10; }      // un décimal (positions)
  function n3(v) { return Math.round(v * 1000) / 1000; }  // trois (angles, jauges)

  // Les bots, toujours là. Même plage de niveau pour tous, tirée par partie.
  var BOT_SKILL = { lo: 0.45, hi: 1.0 };
  var BOTS = [
    { id: "sifflet", name: "Sifflet", fb: "0006000U040L0N0000000000" },
    { id: "viperine", name: "Vipérine", fb: "0006010Y040N0L0000000000" },
  ];

  // opts : { clock?, rng?, withBots?, objets?, onResult?, getChampion?,
  //          onChampion?, onMatchForming?, onDefi?, botIdentity? }
  function SnakeNet(opts) {
    opts = opts || {};
    this.lobby = new L.SnakeLobby();
    this.sessions = {};                 // gameId → SnakeBattleSession
    this.names = {};                    // username → nom affiché
    this.bouilles = {};                 // username → frutibouille
    this.champions = {};                // username → fiche Championnat (elo.js : { linit, l, ls })
    this.bots = {};                     // username → true
    this._botNeuf = {};
    this._botEtats = {};                // gameId → { bot: état de décision }
    this.clock = opts.clock || function () { return Date.now(); };
    this._rng = opts.rng || Math.random;
    this.objets = opts.objets;          // surcharge des objets (tests)
    this.onResult = opts.onResult || function () {};
    // CHAMPIONNAT. Deux hooks, absents en tests purs (la note vit alors en
    // mémoire, à 1000 au départ) :
    //   • getChampion(username) → la fiche persistée { linit, l, ls } ;
    //   • onChampion(username, fiche, { adversaire, avant, apres, delta,
    //     resultat }) → à persister + classer.
    this.getChampion = opts.getChampion || null;
    this.onChampion = opts.onChampion || null;
    // onMatchForming(humains, { hasBot }) : l'hôte allume le voyant de jeu de
    // chaque humain ; { ok:false, blocked:[…] } refuserait le match.
    this.onMatchForming = opts.onMatchForming || null;
    this.onDefi = opts.onDefi || null;
    this.botIdentity = opts.botIdentity || null;
    if (opts.withBots !== false) this._registerBots();
  }

  // La fiche Championnat d'un joueur, chargée à la demande auprès de l'hôte.
  SnakeNet.prototype.ficheChampion = function (username) {
    if (!this.champions[username]) {
      var brut = null;
      if (this.getChampion) { try { brut = this.getChampion(username); } catch (e) { brut = null; } }
      this.champions[username] = E.fiche(brut);
    }
    return this.champions[username];
  };
  SnakeNet.prototype._note = function (username) {
    return this.bots[username] ? 0 : this.ficheChampion(username).ls[0];
  };

  // ── Les bots empruntent une tête au Bouilloscope (cf. Grapiz) ─────────────
  SnakeNet.prototype._refreshBotIdentities = function () {
    if (!this.botIdentity) return;
    var self = this;
    var deja = BOTS.map(function (b) { return self.names[b.id] || b.name; });
    BOTS.forEach(function (b) {
      var p = self.lobby.getPlayer(b.id);
      if (!self._botNeuf[b.id] || (p && p.status !== "idle")) return;
      var ident = null;
      try { ident = self.botIdentity(deja, self._rng); } catch (e) { ident = null; }
      if (!ident || !ident.name) return;
      self._botNeuf[b.id] = false;
      self.names[b.id] = ident.name;
      if (ident.fb) self.bouilles[b.id] = ident.fb;
      self.lobby.addPlayer(b.id, ident.name);
      deja.push(ident.name);
    });
  };
  SnakeNet.prototype._retireBots = function (session) {
    var self = this;
    (session.players || []).forEach(function (p) { if (self.bots[p.id]) self._botNeuf[p.id] = true; });
  };
  SnakeNet.prototype._registerBots = function () {
    var self = this;
    BOTS.forEach(function (b) {
      self.bots[b.id] = true;
      self.names[b.id] = b.name;
      self.bouilles[b.id] = b.fb;
      self._botNeuf[b.id] = true;
      self.lobby.addPlayer(b.id, b.name);
    });
    this._refreshBotIdentities();
  };

  // ── Sérialisation ──────────────────────────────────────────────────────────
  SnakeNet.prototype._lobbyXml = function () {
    var self = this;
    var players = this.lobby.listPlayers().map(function (p) {
      var f = self.bots[p.id] ? null : self.ficheChampion(p.id);
      return '<pl u="' + esc(p.id) + '" n="' + esc(p.name || p.id) + '" s="' + esc(p.status) +
        '" f="' + esc(self.bouilles[p.id] || "") + '" no="' + (f ? f.ls[0] : 0) +
        '" pj="' + (f ? E.parties(f) : 0) + '" bot="' + (self.bots[p.id] ? 1 : 0) + '"/>';
    }).join("");
    return '<sb e="lobby">' + players + "</sb>";
  };

  // L'état d'un pas (ou l'état ENTIER, files comprises, pour `start`).
  SnakeNet.prototype._stateXml = function (session, evt, full) {
    var self = this;
    var snap = session.snapshot(full);
    // Les joueurs ne voyagent qu'au départ et à la fin : ils ne changent pas
    // entre deux pas, et quarante fois par seconde, chaque octet compte.
    // `no` : la note ; à la fin d'une partie classée, `dn` dit de combien
    // elle vient de bouger. `cl="0"` sur l'enveloppe : un entraînement contre
    // un bot, qui ne compte pas.
    var pls = snap.players.map(function (p) {
      var mv = session._elo && session._elo[p.id];
      return '<p u="' + esc(p.id) + '" n="' + esc(p.name) + '" e="' + p.team +
        '" f="' + esc(p.fb || "") + '" no="' + self._note(p.id) + '"' +
        (mv ? ' dn="' + mv.delta + '"' : "") + '/>';
    }).join("");
    // `tr` : le sens où ce serpent tourne À CET INSTANT (−1 gauche, 0 tout
    // droit, +1 droite). Le client prolonge chaque tête entre deux pas ; sans
    // ce chiffre il ne pouvait la prolonger qu'en LIGNE DROITE, et un
    // adversaire en plein virage paraissait avancer par à-coups. Un octet par
    // serpent et par pas, pour une courbe juste.
    var srp = snap.serpents.map(function (s) {
      var e = (snap.inputs && snap.inputs[s.team]) || null;
      var tr = e ? ((e.gauche ? -1 : 0) + (e.droite ? 1 : 0)) : 0;
      var a = '<s i="' + s.team + '" x="' + n1(s.x) + '" y="' + n1(s.y) + '" a="' + n3(s.ang) +
        '" v="' + n3(s.speed) + '" l="' + s.len + '" e="' + n3(s.eat) + '" p="' + n3(s.power) +
        '" k="' + (s.vivant ? 1 : 0) + '" q="' + s.q + '" g="' + s.g + '" xp="' + s.xp +
        '" tr="' + tr + '"';
      if (s.fini) a += ' fin="1"';
      if (full && s.queue) {
        a += ' file="' + s.queue.map(function (p) { return n1(p.x) + "," + n1(p.y); }).join(" ") + '"';
      }
      return a + "/>";
    }).join("");
    // `t` : b une bombe (avec sa mèche `v`), d une dynamite (sans mèche).
    var obj = snap.objets.map(function (o) {
      return '<o i="' + o.id + '" t="' + (o.type === "dynamite" ? "d" : "b") + '" x="' + o.x + '" y="' + o.y +
        (o.vie == null ? '"' : '" v="' + n3(o.vie) + '"') + '/>';
    }).join("");
    var ex = snap.explosions.map(function (e) { return '<ex x="' + e.x + '" y="' + e.y + '"/>'; }).join("");
    // Une dynamite ramassée : où, et par qui — le client y fait le bruit.
    ex += (snap.ramassages || []).map(function (r) { return '<dy x="' + r.x + '" y="' + r.y + '" e="' + r.team + '"/>'; }).join("");
    return '<sb e="' + evt + '" g="' + esc(snap.id) + '" ph="' + snap.phase + '" cd="' + n3(snap.compte) +
      '" n="' + snap.numero + '" t="' + n3(snap.temps) + '" cl="' + (session._classe ? 1 : 0) + '"' +
      (snap.ended ? ' end="1" w="' + snap.winner + '" r="' + esc(snap.endReason) + '"' : "") +
      ">" + (evt === "state" ? "" : pls) + srp + obj + ex + "</sb>";
  };

  SnakeNet.prototype._err = function (username, code) {
    return { to: [username], xml: '<sb e="err" m="' + esc(code) + '"/>' };
  };
  SnakeNet.prototype._lobbyBroadcast = function () {
    var to = this.lobby.listPlayers().map(function (p) { return p.id; });
    return to.length ? [{ to: to, xml: this._lobbyXml() }] : [];
  };
  SnakeNet.prototype._ids = function (session) { return session.players.map(function (p) { return p.id; }); };

  // ── Le départ d'une partie ────────────────────────────────────────────────
  SnakeNet.prototype._startSession = function (game) {
    var self = this;
    var humans = game.players.filter(function (uid) { return !self.bots[uid]; });
    var hasBot = humans.length !== game.players.length;
    if (humans.length && this.onMatchForming) {
      var chk;
      try { chk = this.onMatchForming(humans, { hasBot: hasBot, playerCount: game.players.length }); } catch (e) { chk = null; }
      if (chk && chk.ok === false) {
        this.lobby.endGame(game.id);
        var blocked = (chk.blocked && chk.blocked.length) ? chk.blocked : humans;
        return game.players.map(function (uid) {
          return { to: [uid], xml: '<sb e="err" m="' + (blocked.indexOf(uid) >= 0 ? "refus" : "opp-refus") + '"/>' };
        });
      }
    }
    var players = game.players.map(function (uid) {
      return { id: uid, name: self.names[uid] || uid, fb: self.bouilles[uid] || "" };
    });
    var sess = new S.SnakeBattleSession({ id: game.id, players: players, now: this.clock(), rng: this._rng, objets: this.objets });
    sess._botSkill = {};
    game.players.forEach(function (uid) {
      if (self.bots[uid]) sess._botSkill[uid] = BOT_SKILL.lo + self._rng() * (BOT_SKILL.hi - BOT_SKILL.lo);
    });
    sess._classe = !hasBot;              // entre humains : la note est en jeu
    sess._elo = null;
    this.sessions[game.id] = sess;
    this._botEtats[game.id] = {};
    return [{ to: game.players.slice(), xml: this._stateXml(sess, "start", true) }];
  };

  // ── Le championnat ─────────────────────────────────────────────────────────
  // La note de chacun bouge, égalité comprise. Les deux notes sont relevées
  // AVANT d'être modifiées : sinon le second joueur serait évalué contre la
  // note déjà corrigée du premier. Rien ne bouge contre un bot.
  SnakeNet.prototype._updateElo = function (session) {
    if (!session._classe || session.players.length !== 2) return;
    var a = session.playerOfTeam(0), b = session.playerOfTeam(1);
    if (!a || !b || this.bots[a.id] || this.bots[b.id]) return;
    var nul = session.winner == null || session.winner < 0;
    var issues = nul ? ["n", "n"] : (session.winner === 0 ? ["v", "d"] : ["d", "v"]);
    var fa = this.ficheChampion(a.id), fb = this.ficheChampion(b.id);
    var na = fa.ls[0], nb = fb.ls[0];
    session._elo = {};
    this._appliquerElo(session, a.id, fa, nb, issues[0], b.id);
    this._appliquerElo(session, b.id, fb, na, issues[1], a.id);
  };
  SnakeNet.prototype._appliquerElo = function (session, user, avant, noteAdverse, resultat, adversaire) {
    var r = E.apres(avant, noteAdverse, resultat);
    this.champions[user] = r.fiche;
    var info = { adversaire: adversaire, avant: avant.ls[0], apres: r.fiche.ls[0], delta: r.delta, resultat: resultat };
    session._elo[user] = info;
    if (this.onChampion) {
      try { this.onChampion(user, r.fiche, info); } catch (e) { /* la partie prime sur la persistance */ }
    }
  };

  // Conclut : notes → état final (notes et écarts à jour) → hook → libère.
  SnakeNet.prototype._concludeGame = function (session) {
    this._updateElo(session);
    var msgs = [{ to: this._ids(session), xml: this._stateXml(session, "end") }];
    try { this.onResult(session, session.winner, session.endReason); } catch (e) {}
    this._retireBots(session);
    this.lobby.endGame(session.id);
    this._refreshBotIdentities();
    delete this.sessions[session.id];
    delete this._botEtats[session.id];
    return msgs.concat(this._lobbyBroadcast());
  };

  SnakeNet.prototype._sessionOf = function (username) {
    var p = this.lobby.getPlayer(username);
    if (!p || !p.gameId) return null;
    return this.sessions[p.gameId] || null;
  };

  // ── Dispatch d'une action client ────────────────────────────────────────────
  SnakeNet.prototype.handle = function (username, attrs) {
    attrs = attrs || {};
    var a = attrs.a, r, sess;
    switch (a) {
      case "hello": {
        this.names[username] = attrs.n || username;
        if (attrs.f) this.bouilles[username] = attrs.f;
        this.lobby.addPlayer(username, this.names[username]);
        this.ficheChampion(username);   // charge la note pour le salon
        this._refreshBotIdentities();
        var out = this._lobbyBroadcast();
        // Reconnexion en pleine partie : l'état entier, files comprises.
        sess = this._sessionOf(username);
        if (sess && !sess.ended) out.push({ to: [username], xml: this._stateXml(sess, "start", true) });
        return out;
      }

      case "list":
        return [{ to: [username], xml: this._lobbyXml() }];

      case "seek":
        r = this.lobby.seek(username);
        if (!r.ok) return [this._err(username, r.error)];
        if (r.started) return this._startSession(r.game).concat(this._lobbyBroadcast());
        return this._lobbyBroadcast();

      case "cancel":
        r = this.lobby.cancel(username);
        return r.ok ? this._lobbyBroadcast() : [this._err(username, r.error)];

      case "challenge": {
        r = this.lobby.challenge(username, attrs.u);
        if (!r.ok) return [this._err(username, r.error)];
        if (this.onDefi && !this.bots[attrs.u]) { try { this.onDefi(username, attrs.u); } catch (e) {} }
        return this._startSession(r.game).concat(this._lobbyBroadcast());
      }

      // LE PING. Le client a besoin de savoir combien de temps sépare son
      // doigt de l'écran : c'est de cette mesure qu'il déduit de combien
      // prédire son propre serpent (enligne.js). La réponse part tout de
      // suite, dans le même tour de boucle que la demande — la faire attendre
      // le prochain pas ajouterait jusqu'à vingt-cinq millisecondes à la
      // mesure, et le client prédirait trop loin.
      case "ping":
        return [{ to: [username], xml: '<sb e="pong" t="' + esc(attrs.t || "") + '"/>' }];

      case "input": {
        sess = this._sessionOf(username);
        if (!sess) return [this._err(username, "not-in-game")];
        sess.setInput(username, { gauche: attrs.g === "1", droite: attrs.d === "1", haut: attrs.h === "1" });
        return [];
      }

      case "part": {
        sess = this._sessionOf(username);
        if (sess && !sess.ended) {
          sess.forfeit(username);
          return this._concludeGame(sess);
        }
        this.lobby.partGame(username);
        return this._lobbyBroadcast();
      }

      case "say": {
        if (!attrs.m) return [];
        var to = this.lobby.listPlayers().filter(function (pl) { return pl.status !== "playing"; }).map(function (pl) { return pl.id; });
        return [{ to: to, xml: '<sb e="chat" u="' + esc(this.names[username] || username) + '" m="' + esc(String(attrs.m).slice(0, 200)) + '"/>' }];
      }

      default:
        return [this._err(username, "unknown-action")];
    }
  };

  // Déconnexion : abandon si en partie (une défaite, la note en pâtit). La
  // fiche en mémoire est oubliée : la prochaine venue la relira chez l'hôte.
  SnakeNet.prototype.onDisconnect = function (username) {
    var rm = this.lobby.removePlayer(username);
    if (!rm || !rm.ok) { delete this.champions[username]; return []; }
    var out;
    if (rm.playingGameId && this.sessions[rm.playingGameId]) {
      this.sessions[rm.playingGameId].forfeit(username);
      out = this._concludeGame(this.sessions[rm.playingGameId]);
    } else out = this._lobbyBroadcast();
    delete this.champions[username];
    return out;
  };

  // ── Le tick : quarante fois par seconde ───────────────────────────────────
  SnakeNet.prototype.tick = function (now) {
    if (now === undefined) now = this.clock();
    var out = [];
    Object.keys(this.sessions).forEach(function (id) {
      var sess = this.sessions[id];
      if (!sess) return;
      // Une session déjà pliée (abandon hors tick) se conclut ici, au cas où.
      if (sess.ended) { out = out.concat(this._concludeGame(sess)); return; }
      this._jouerBots(sess);
      var self = this, ids = this._ids(sess);
      sess.avancer(now, function (s) {
        if (!s.ended) out.push({ to: ids, xml: self._stateXml(s, "state") });
      });
      if (sess.ended) out = out.concat(this._concludeGame(sess));
    }, this);
    return out;
  };

  SnakeNet.prototype._jouerBots = function (sess) {
    if (sess.phase !== "jeu") return;
    var etats = this._botEtats[sess.id] || (this._botEtats[sess.id] = {});
    for (var i = 0; i < sess.players.length; i++) {
      var p = sess.players[i];
      if (!this.bots[p.id]) continue;
      var skill = (sess._botSkill && sess._botSkill[p.id]); if (skill == null) skill = 0.7;
      var etat = etats[p.id] || (etats[p.id] = {});
      sess.setInput(p.id, Bot.decider(sess, p.team, skill, this._rng, etat));
    }
  };

  return { SnakeNet: SnakeNet, BOTS: BOTS };
});
