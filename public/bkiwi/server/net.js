//
// Burning Kiwi MULTI — le pont réseau des courses en ligne (côté serveur).
//
// Le modèle du Battle de Frutisnake (snake3/server/net.js) : ce module
// possède les SALONS (une course à préparer : un hôte, un circuit, deux à
// quatre pilotes), traduit chaque action d'un client en une liste de messages
// { to:[usernames], xml } que le transport (server.js) enverra, et ne tient
// aucune socket — entièrement testable. L'identité d'un joueur = son username.
//
// CE QUE LE SERVEUR NE FAIT PAS, ET POURQUOI. Dans le Battle de Frutisnake le
// serveur joue la partie, et chaque écran la miroite : il tranche les
// collisions, et il le faut, car deux serpents qui se touchent, c'est la fin
// de l'un des deux. Une course de Burning Kiwi n'a rien à trancher : chacun
// pilote SA voiture, et c'est son chrono qui compte. La physique tourne donc
// chez chaque pilote, à pas fixe, exactement comme en solo — zéro aller-retour
// entre la touche et le virage, donc AUCUN LAG sur sa propre voiture, quel que
// soit le réseau. Le serveur ne fait que RELAYER les positions (vingt fois par
// seconde, un petit message par pilote) et tenir le départ et l'arrivée : les
// autres voitures se dessinent entre deux positions reçues (multi.js), et
// elles ne se cognent pas — les voitures se traversent, comme un fantôme :
// une collision à cent millisecondes de distance ne serait la même pour
// personne, et c'est ce qui rend un jeu en ligne injouable.
//
// Protocole (XML sur le WebSocket existant, balise <kw>) :
//   client → serveur : <kw a="hello|creer|rejoindre|quitter|piste|voiture|pret|
//                              lancer|charge|pos|fin|abandon|ping" …/>
//   serveur → client : <kw e="hub|salon|depart|go|pos|arrivee|resultat|quitte|
//                              abandon|pong|err" …> … </kw>
//
// LA COURSE. L'hôte lance ; chaque pilote charge le circuit, dit `charge`,
// et quand tous l'ont dit (vingt secondes au plus) le serveur envoie `go`
// avec l'heure du départ, la même pour tous : le décompte 3-2-1 démarre au
// même instant sur chaque écran. À l'arrivée, chacun envoie son temps de
// course ; le classement se fait AU TEMPS (deux pilotes partis au même
// instant : le meilleur chrono est devant, qu'il ait ou non le réseau le
// plus court). Quand tous sont arrivés — ou abandonnés, ou quatre-vingt-dix
// secondes après le premier —, `resultat`, et le salon redevient prêt pour
// une revanche.
//
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.BkiwiMulti = root.BkiwiMulti || {}).net = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_PILOTES = 4;             // les quatre places de la grille de départ
  var NB_PISTES = 6;               // les six circuits du jeu
  var NB_VOITURES = 6;             // les cinq écuries, et la X Violet
  var DELAI_CHARGEMENT = 20000;    // ms : passé ce délai, on part sans les retardataires
  var DELAI_DEPART = 1200;         // ms entre le `go` et le début du décompte
  var DELAI_ARRIVEE = 90000;       // ms après le premier arrivé : la course se ferme
  var DUREE_MAX = 10 * 60000;      // ms : une course qui n'en finit pas se ferme

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function entier(v, min, max, def) {
    var n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < min || n > max) return def;
    return n;
  }

  // opts : { clock?, onDepart?(usernames), onFin?(usernames) }
  function BkiwiNet(opts) {
    opts = opts || {};
    this.joueurs = {};     // username → { id, nom, fb, salon, voiture, pret, charge, t, rang }
    this.salons = {};      // id → salon
    this._seq = 0;
    this.clock = opts.clock || function () { return Date.now(); };
    this.onDepart = opts.onDepart || function () {};
    this.onFin = opts.onFin || function () {};
  }

  // ── Les joueurs ───────────────────────────────────────────────────────────
  BkiwiNet.prototype._joueur = function (u) { return this.joueurs[u] || null; };
  BkiwiNet.prototype._salonDe = function (u) {
    var j = this.joueurs[u];
    return (j && j.salon && this.salons[j.salon]) || null;
  };
  BkiwiNet.prototype._tous = function () { return Object.keys(this.joueurs); };

  // ── Sérialisation ──────────────────────────────────────────────────────────
  BkiwiNet.prototype._hubXml = function () {
    var self = this;
    var salons = Object.keys(this.salons).map(function (id) {
      var s = self.salons[id];
      var hote = self.joueurs[s.hote];
      return '<s i="' + esc(s.id) + '" h="' + esc(hote ? hote.nom : s.hote) + '" p="' + s.piste +
        '" n="' + s.joueurs.length + '" e="' + s.etat + '"/>';
    }).join("");
    var libres = this._tous().filter(function (u) { return !self.joueurs[u].salon; }).map(function (u) {
      var j = self.joueurs[u];
      return '<j u="' + esc(u) + '" n="' + esc(j.nom) + '" f="' + esc(j.fb || "") + '"/>';
    }).join("");
    return '<kw e="hub">' + salons + libres + "</kw>";
  };
  BkiwiNet.prototype._joueurXml = function (u, i) {
    var j = this.joueurs[u];
    if (!j) return "";
    return '<j u="' + esc(u) + '" n="' + esc(j.nom) + '" f="' + esc(j.fb || "") + '" c="' + j.voiture +
      '" i="' + i + '" r="' + (j.pret ? 1 : 0) + '" k="' + (j.charge ? 1 : 0) + '"' +
      (j.t ? ' t="' + j.t + '"' : "") + (j.rang ? ' g="' + j.rang + '"' : "") + "/>";
  };
  BkiwiNet.prototype._salonXml = function (s, evt) {
    var self = this;
    var js = s.joueurs.map(function (u, i) { return self._joueurXml(u, i); }).join("");
    // (`et` : l'état du salon — `e` est déjà le nom de l'événement)
    return '<kw e="' + (evt || "salon") + '" s="' + esc(s.id) + '" h="' + esc(s.hote) + '" p="' + s.piste + '" et="' + s.etat + '">' + js + "</kw>";
  };
  // Le classement d'une course, au temps ; ceux qui n'ont pas fini à la suite,
  // dans l'ordre de la grille, sans temps.
  BkiwiNet.prototype._classement = function (s) {
    var self = this;
    var arrives = s.arrivees.slice().sort(function (a, b) { return a.t - b.t || a.ordre - b.ordre; });
    var dedans = {};
    arrives.forEach(function (a) { dedans[a.u] = true; });
    var reste = s.joueurs.filter(function (u) { return !dedans[u]; }).map(function (u) { return { u: u, t: 0 }; });
    return arrives.concat(reste).map(function (a, i) {
      var j = self.joueurs[a.u] || s.partis[a.u] || { nom: a.u, voiture: 0 };
      return { u: a.u, nom: j.nom, voiture: j.voiture, t: a.t, rang: a.t ? i + 1 : 0 };
    });
  };
  BkiwiNet.prototype._classementXml = function (s, evt, extra) {
    var l = this._classement(s).map(function (a) {
      return '<a u="' + esc(a.u) + '" n="' + esc(a.nom) + '" c="' + a.voiture + '" t="' + a.t + '" g="' + a.rang + '"/>';
    }).join("");
    return '<kw e="' + evt + '" s="' + esc(s.id) + '"' + (extra || "") + ">" + l + "</kw>";
  };
  BkiwiNet.prototype._err = function (u, code) { return { to: [u], xml: '<kw e="err" m="' + esc(code) + '"/>' }; };
  BkiwiNet.prototype._hub = function () {
    var to = this._tous();
    return to.length ? [{ to: to, xml: this._hubXml() }] : [];
  };
  BkiwiNet.prototype._salon = function (s) {
    return s.joueurs.length ? [{ to: s.joueurs.slice(), xml: this._salonXml(s) }] : [];
  };

  // ── Les salons ────────────────────────────────────────────────────────────
  BkiwiNet.prototype._creer = function (u, piste) {
    var s = { id: "s" + (++this._seq), hote: u, piste: piste, joueurs: [u], etat: "attente",
      arrivees: [], abandons: {}, partis: {}, debut: 0, chargeAt: 0, premiereArrivee: 0 };
    this.salons[s.id] = s;
    this.joueurs[u].salon = s.id;
    this.joueurs[u].pret = false;
    return s;
  };
  // Remet le salon en attente, pour la revanche.
  BkiwiNet.prototype._reposer = function (s) {
    var self = this;
    s.etat = "attente";
    s.arrivees = [];
    s.abandons = {};
    s.partis = {};
    s.debut = 0; s.chargeAt = 0; s.premiereArrivee = 0;
    s.joueurs.forEach(function (u) {
      var j = self.joueurs[u];
      if (j) { j.pret = false; j.charge = false; j.t = 0; j.rang = 0; }
    });
  };
  // Un joueur sort de son salon : l'hôte passe au suivant, le salon vide
  // disparaît, une course en cours continue sans lui.
  BkiwiNet.prototype._sortir = function (u) {
    var s = this._salonDe(u);
    var j = this.joueurs[u];
    if (j) { j.salon = null; j.pret = false; j.charge = false; j.t = 0; j.rang = 0; }
    if (!s) return [];
    var i = s.joueurs.indexOf(u);
    if (i >= 0) s.joueurs.splice(i, 1);
    var out = [];
    if (!s.joueurs.length) { delete this.salons[s.id]; return out; }
    if (s.hote === u) s.hote = s.joueurs[0];
    if (s.etat === "chargement" || s.etat === "course") {
      // On garde son nom et sa voiture pour le classement final.
      if (j) s.partis[u] = { nom: j.nom, voiture: j.voiture };
      out.push({ to: s.joueurs.slice(), xml: '<kw e="quitte" u="' + esc(u) + '"/>' });
      out = out.concat(this._verifierDepart(s)).concat(this._verifierFin(s));
    }
    if (this.salons[s.id]) out = out.concat(this._salon(s));
    return out;
  };

  // ── Le départ ─────────────────────────────────────────────────────────────
  BkiwiNet.prototype._lancer = function (s) {
    var self = this;
    s.etat = "chargement";
    s.chargeAt = this.clock();
    s.arrivees = []; s.abandons = {}; s.partis = {}; s.premiereArrivee = 0; s.debut = 0;
    s.joueurs.forEach(function (u) { var j = self.joueurs[u]; j.charge = false; j.t = 0; j.rang = 0; });
    try { this.onDepart(s.joueurs.slice()); } catch (e) { /* le voyant ne bloque pas la course */ }
    return [{ to: s.joueurs.slice(), xml: this._salonXml(s, "depart") }];
  };
  // Tous ont chargé (ou le délai est passé) : le départ, à la même heure pour tous.
  BkiwiNet.prototype._verifierDepart = function (s, force) {
    var self = this;
    if (s.etat !== "chargement") return [];
    var tous = s.joueurs.every(function (u) { return self.joueurs[u] && self.joueurs[u].charge; });
    if (!tous && !force) return [];
    s.etat = "course";
    s.debut = this.clock() + DELAI_DEPART;
    return [{ to: s.joueurs.slice(), xml: '<kw e="go" s="' + esc(s.id) + '" at="' + s.debut + '" t="' + this.clock() + '"/>' }];
  };

  // ── L'arrivée ─────────────────────────────────────────────────────────────
  BkiwiNet.prototype._verifierFin = function (s, force) {
    var self = this;
    if (s.etat !== "course") return [];
    var arrives = {};
    s.arrivees.forEach(function (a) { arrives[a.u] = true; });
    var tous = s.joueurs.every(function (u) { return arrives[u] || s.abandons[u]; });
    if (!tous && !force) return [];
    var xml = this._classementXml(s, "resultat");
    var to = s.joueurs.slice();
    try { this.onFin(to); } catch (e) { /* idem */ }
    this._reposer(s);
    return [{ to: to, xml: xml }].concat(this._salon(s)).concat(this._hub());
  };

  // ── Dispatch d'une action client ────────────────────────────────────────────
  BkiwiNet.prototype.handle = function (u, attrs) {
    attrs = attrs || {};
    var a = attrs.a, s, j = this.joueurs[u];
    if (a !== "hello" && !j) return [this._err(u, "pas-la")];
    switch (a) {
      case "hello": {
        if (!j) j = this.joueurs[u] = { id: u, nom: u, fb: "", salon: null, voiture: 0, pret: false, charge: false, t: 0, rang: 0 };
        j.nom = attrs.n || j.nom || u;
        if (attrs.f) j.fb = attrs.f;
        var out = this._hub();
        // Reconnexion : on redit son salon (en course, la course continue sans
        // lui — ses positions ne reviendront plus, mais il peut finir).
        s = this._salonDe(u);
        if (s) out = out.concat(this._salon(s));
        return out;
      }

      case "creer": {
        if (j.salon) return [this._err(u, "deja-en-salon")];
        s = this._creer(u, entier(attrs.p, 0, NB_PISTES - 1, 0));
        return this._salon(s).concat(this._hub());
      }

      case "rejoindre": {
        if (j.salon) return [this._err(u, "deja-en-salon")];
        s = this.salons[attrs.s];
        if (!s) return [this._err(u, "salon-inconnu")];
        if (s.etat !== "attente") return [this._err(u, "course-en-cours")];
        if (s.joueurs.length >= MAX_PILOTES) return [this._err(u, "salon-plein")];
        s.joueurs.push(u);
        j.salon = s.id; j.pret = false; j.charge = false; j.t = 0; j.rang = 0;
        return this._salon(s).concat(this._hub());
      }

      case "quitter":
        return this._sortir(u).concat(this._hub());

      case "piste": {
        s = this._salonDe(u);
        if (!s) return [this._err(u, "pas-de-salon")];
        if (s.hote !== u) return [this._err(u, "pas-l-hote")];
        if (s.etat !== "attente") return [this._err(u, "course-en-cours")];
        s.piste = entier(attrs.p, 0, NB_PISTES - 1, s.piste);
        return this._salon(s).concat(this._hub());
      }

      case "voiture": {
        j.voiture = entier(attrs.c, 0, NB_VOITURES - 1, j.voiture);
        s = this._salonDe(u);
        return s ? this._salon(s) : [];
      }

      case "pret": {
        s = this._salonDe(u);
        if (!s) return [this._err(u, "pas-de-salon")];
        if (s.etat !== "attente") return [];
        j.pret = attrs.r !== "0";
        return this._salon(s);
      }

      case "lancer": {
        s = this._salonDe(u);
        if (!s) return [this._err(u, "pas-de-salon")];
        if (s.hote !== u) return [this._err(u, "pas-l-hote")];
        if (s.etat !== "attente") return [this._err(u, "course-en-cours")];
        if (s.joueurs.length < 2) return [this._err(u, "seul")];
        var self = this;
        var pasPrets = s.joueurs.filter(function (x) { return x !== u && !self.joueurs[x].pret; });
        if (pasPrets.length) return [this._err(u, "pas-prets")];
        return this._lancer(s).concat(this._hub());
      }

      case "charge": {
        s = this._salonDe(u);
        if (!s || s.etat !== "chargement") return [];
        j.charge = true;
        return this._verifierDepart(s);
      }

      // La position d'une voiture, relayée telle quelle aux autres pilotes du
      // salon : le serveur ne la lit pas, il n'a pas de circuit pour la juger.
      case "pos": {
        s = this._salonDe(u);
        if (!s || s.etat !== "course") return [];
        var autres = s.joueurs.filter(function (x) { return x !== u; });
        if (!autres.length) return [];
        var attrsPos = "";
        for (var k in attrs) if (k !== "a" && k !== "u" && Object.prototype.hasOwnProperty.call(attrs, k)) attrsPos += " " + k + '="' + esc(attrs[k]) + '"';
        return [{ to: autres, xml: '<kw e="pos" u="' + esc(u) + '"' + attrsPos + "/>" }];
      }

      case "fin": {
        s = this._salonDe(u);
        if (!s || s.etat !== "course") return [];
        if (s.arrivees.some(function (x) { return x.u === u; }) || s.abandons[u]) return [];
        var t = entier(attrs.t, 1, 3600000, 0);
        if (!t) return [this._err(u, "temps-invalide")];
        if (!s.premiereArrivee) s.premiereArrivee = this.clock();
        s.arrivees.push({ u: u, t: t, ordre: s.arrivees.length });
        j.t = t;
        this._classement(s).forEach(function (c) { var jj = this.joueurs[c.u]; if (jj) jj.rang = c.rang; }, this);
        var out2 = [{ to: s.joueurs.slice(), xml: this._classementXml(s, "arrivee", ' u="' + esc(u) + '" t="' + t + '"') }];
        return out2.concat(this._verifierFin(s));
      }

      // Renoncer à la course (échap, « oui ») sans quitter le salon : classé
      // sans temps, et les autres voient sa voiture partir.
      case "abandon": {
        s = this._salonDe(u);
        if (!s || s.etat !== "course") return [];
        if (s.arrivees.some(function (x) { return x.u === u; }) || s.abandons[u]) return [];
        s.abandons[u] = true;
        var autres2 = s.joueurs.filter(function (x) { return x !== u; });
        var out3 = autres2.length ? [{ to: autres2, xml: '<kw e="abandon" u="' + esc(u) + '"/>' }] : [];
        return out3.concat(this._verifierFin(s));
      }

      case "ping":
        return [{ to: [u], xml: '<kw e="pong" t="' + esc(attrs.t || "") + '" st="' + this.clock() + '"/>' }];

      default:
        return [this._err(u, "unknown-action")];
    }
  };

  // Déconnexion : on sort du salon (une course en cours continue sans lui).
  BkiwiNet.prototype.onDisconnect = function (u) {
    if (!this.joueurs[u]) return [];
    var out = this._sortir(u);
    delete this.joueurs[u];
    return out.concat(this._hub());
  };

  // ── Le tick (une fois par seconde) : les délais ────────────────────────────
  BkiwiNet.prototype.tick = function (now) {
    if (now === undefined) now = this.clock();
    var out = [];
    Object.keys(this.salons).forEach(function (id) {
      var s = this.salons[id];
      if (!s) return;
      if (s.etat === "chargement" && now - s.chargeAt >= DELAI_CHARGEMENT) out = out.concat(this._verifierDepart(s, true));
      else if (s.etat === "course") {
        if ((s.premiereArrivee && now - s.premiereArrivee >= DELAI_ARRIVEE) || (s.debut && now - s.debut >= DUREE_MAX)) {
          out = out.concat(this._verifierFin(s, true));
        }
      }
    }, this);
    return out;
  };

  // Pour les voyants du parc : les pilotes en course, salon par salon.
  BkiwiNet.prototype.enCourse = function () {
    var self = this;
    var l = [];
    Object.keys(this.salons).forEach(function (id) {
      var s = self.salons[id];
      if (s.etat === "course" || s.etat === "chargement") l = l.concat(s.joueurs);
    });
    return l;
  };

  return { BkiwiNet: BkiwiNet, MAX_PILOTES: MAX_PILOTES, NB_PISTES: NB_PISTES, NB_VOITURES: NB_VOITURES,
    DELAI_CHARGEMENT: DELAI_CHARGEMENT, DELAI_ARRIVEE: DELAI_ARRIVEE, DELAI_DEPART: DELAI_DEPART };
});
