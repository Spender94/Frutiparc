//
// Frutibandas — écran de jeu (plateau canvas + animations + cartes + chat).
//
// Le client REJOUE chaque événement serveur sur son propre plateau (engine.js,
// mêmes règles) ; le listener du moteur capture les mouvements/poussées/morts
// et la file d'animations les joue séquentiellement, comme l'AnimationController
// du SWF d'origine. Pendant qu'une animation tourne, l'entrée est verrouillée
// (Main.inputLocked) et les flèches sont cachées.
//
// Géométrie : page 1050x728 (assets/page/game.png) ; zone verte x 231-818 ;
// cases de 46 px ; chaque frame d'animation est un canvas 256x256 dont la
// case occupe (104,102)-(149,151) → ancre commune pour tout aligner.
//
(function () {
  "use strict";
  var E = window.Bandas.engine;
  var DIR = E.DIR;

  var CARD_KEYS = ["enclume", "celerite", "confiscation", "renfort", "desordre",
    "petrification", "vachette", "conversion", "charge", "entracte", "solo", "piege"];
  var CARD_LABELS = ["Enclume", "Célérité", "Confiscation", "Renfort", "Désordre",
    "Pétrification", "Vachette", "Conversion", "Charge", "Entracte", "Solo", "Piège"];
  var CARD_DESCS = [
    "L'enclume détruit la case ciblée. Si l'enclume rencontre un obstacle, celui-ci est détruit.",
    "Vous pouvez jouer une seconde fois à ce tour.",
    "Si votre adversaire joue une carte au prochain tour, annulez son effet et récupérez la carte.",
    "Place au hasard jusqu'à 3 fruits alliés supplémentaires sur le plateau.",
    "Le prochain mouvement de votre adversaire sera inversé.",
    "Le fruit ciblé se transforme en pierre.",
    "Une meuhmeuh apparaît en haut du plateau et fait voler tous les fruits de la colonne choisie.",
    "Le fruit choisi change d'équipe.",
    "Votre prochain mouvement sera doublé.",
    "Vous ne jouez pas ce tour-ci.",
    "Seul le fruit choisi se déplacera lors de votre prochain mouvement.",
    "Pose un piège sur une case libre : le fruit qui s'y placera sera détruit avec la case.",
  ];
  // cible requise (Card.as) : enclume, pétrification, vachette, conversion, solo, piège
  var NEEDS_TARGET = { 0: 1, 5: 1, 6: 1, 7: 1, 10: 1, 11: 1 };
  var CARD = { ENCLUME: 0, CELERITE: 1, CONFISCATION: 2, RENFORT: 3, DESORDRE: 4, PETRIFICATION: 5, VACHETTE: 6, CONVERSION: 7, CHARGE: 8, ENTRACTE: 9, SOLO: 10, PIEGE: 11 };

  // ── Géométrie ──────────────────────────────────────────────────────────────
  var CELL = 46;                 // pas de la grille (px natifs)
  var FRAME = 256;               // côté d'une frame d'animation
  var ANCHOR_X = 104, ANCHOR_Y = 102;   // coin haut-gauche de la case dans la frame
  var AREA_W = 587, AREA_H = 560;       // zone verte (canvas)
  var PAGE_AREA_X = 231;                // origine de la zone verte dans la page

  // ── Chargement des assets ──────────────────────────────────────────────────
  var IMG = {};        // clé → {img, frames, fw}
  function load(key, url, frames) {
    var img = new Image();
    img.src = url;
    IMG[key] = { img: img, frames: frames || 1, fw: 0 };
    img.onload = function () { IMG[key].fw = img.width / IMG[key].frames; GV.dirty = true; };
    return IMG[key];
  }
  var FRUIT_OF_TEAM = ["orange", "banane"];   // équipe 0 = orange (béret rouge), 1 = banane (béret vert)
  function loadAssets() {
    load("tile", "assets/page/board.png");
    load("select", "assets/anim/board_select.png");
    load("fruit_orange", "assets/page/orange.png");
    load("fruit_banane", "assets/page/banana.png");
    load("boardAnim", "assets/anim/board.png", 34);
    load("anvil", "assets/page/anvil.png");
    load("anvilAnim", "assets/anim/anvil.png", 12);
    load("cow", "assets/anim/cow.png", 17);
    load("cowTrail", "assets/anim/cow_trail.png", 21);
    ["banane", "orange"].forEach(function (f) {
      ["mv_up", "mv_down", "mv_left", "mv_right", "pushed_up", "pushed_down",
        "pushed_left", "pushed_right"].forEach(function (a) { load(f + "_" + a, "assets/anim/" + f + "_" + a + ".png", 22); });
      load(f + "_flying_left", "assets/anim/" + f + "_flying_left.png", 15);
      load(f + "_flying_right", "assets/anim/" + f + "_flying_right.png", 15);
    });
    load("banane_petrification", "assets/anim/banane_petrification.png", 17);
    load("orange_petrification", "assets/anim/orange_petrification.png", 13);
  }

  // ── État de la vue ─────────────────────────────────────────────────────────
  var GV = window.BandasView = {
    started: false,
    myTeam: -1,
    board: null,              // plateau miroir (avance événement par événement)
    size: 8,
    originX: 0, originY: 0,   // origine de la grille dans le canvas
    phase: 1,
    currentTeam: -1,
    pool: [],
    hands: [[], []],
    players: [],              // [{u,n,e,f,sr}]
    clocks: [0, 0],
    clockTurn: -1,            // équipe dont l'horloge décompte localement
    clockAt: 0,               // Date.now() de la dernière synchro
    ended: false,
    winner: null,
    cardPlayedThisTurn: false,
    myTraps: {},              // "x,y" → true (marqueurs de mes pièges)
    soloMark: null,           // fruit marqué Solo (le mien)
    rocks: {},                // "x,y" → fruit pétrifié ("banane"/"orange") pour le visuel
    targetCard: null,         // carte en attente de cible
    hoverCell: null,
    queue: [],                // file d'événements à rejouer
    anims: [],                // animations en cours (parallèles)
    effects: [],              // dessins par-dessus (enclume, vache, fruits volants)
    hiddenCells: {},          // cases dont le fruit statique est masqué (animé)
    dirty: true,
    musicOn: true,
    sndIntro: null, sndLoop: null,
    onQuit: null,             // callbacks branchés par ui.js
    onEndClosed: null,
    send: null,               // gz-like sender ({a:...})
  };

  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { var d = document.createElement("div"); d.textContent = String(s == null ? "" : s); return d.innerHTML; }
  var canvas, ctx;

  GV.init = function () {
    canvas = $("#bd-canvas");
    ctx = canvas.getContext("2d");
    loadAssets();
    buildSlots();
    bindInputs();
    requestAnimationFrame(frame);
  };

  // ── Démarrage / reprise d'une partie (instantané complet) ─────────────────
  // el : élément <bd e="start"> ; user : mon username
  GV.start = function (el, user) {
    var players = [];
    var hands = [[], []];
    Array.prototype.forEach.call(el.getElementsByTagName("p"), function (n) {
      var p = {
        u: n.getAttribute("u"), n: n.getAttribute("n"), e: +n.getAttribute("e"),
        rt: +n.getAttribute("rt"), f: n.getAttribute("f"), sr: +n.getAttribute("sr") || 0,
      };
      var hc = n.getAttribute("c");
      hands[p.e] = hc ? hc.split(":").filter(function (s) { return s !== ""; }).map(Number) : [];
      players.push(p);
    });
    var me = players.filter(function (p) {
      return String(p.u).toLowerCase() === String(user).toLowerCase() || String(p.n).toLowerCase() === String(user).toLowerCase();
    })[0];
    GV.myTeam = me ? me.e : -1;
    GV.players = players;
    GV.hands = hands;
    var b = el.getElementsByTagName("b")[0];
    GV.size = +b.getAttribute("size");
    GV.board = E.Board.fromContent(GV.size, b.textContent, {
      x1: +b.getAttribute("x1"), x2: +b.getAttribute("x2"),
      y1: +b.getAttribute("y1"), y2: +b.getAttribute("y2"),
    });
    GV.phase = +el.getAttribute("ph");
    GV.currentTeam = +el.getAttribute("t");
    var pc = el.getAttribute("c");
    GV.pool = pc ? pc.split(":").filter(function (s) { return s !== ""; }).map(Number) : [];
    GV.clocks = [0, 0];
    players.forEach(function (p) { GV.clocks[p.e] = p.rt; });
    GV.clockTurn = GV.currentTeam;
    GV.clockAt = Date.now();
    GV.ended = el.getAttribute("end") === "1";
    GV.winner = GV.ended ? +el.getAttribute("w") : null;
    GV.cardPlayedThisTurn = false;
    GV.myTraps = {}; GV.rocks = {}; GV.soloMark = null;
    GV.targetCard = null; GV.queue = []; GV.anims = []; GV.effects = []; GV.hiddenCells = {};
    // pièges connus : les cases TRAPPED de MON instantané sont forcément les miennes
    for (var y = GV.board.minY; y <= GV.board.maxY; y++) {
      for (var x = GV.board.minX; x <= GV.board.maxX; x++) {
        if (GV.board.getElement({ x: x, y: y }) === E.TRAPPED) GV.myTraps[x + "," + y] = true;
      }
    }
    GV.started = true;
    if (GV._endTimer) { clearTimeout(GV._endTimer); GV._endTimer = null; } // pas de minuteur de fin résiduel
    setupCanvas();

    $("#bd-chatbox").innerHTML = "";
    logLine("ATTENTION : Les touches F5, Alt-F4, Control-W, ou autres ferment ou relancent Frutiparc et vous font perdre la partie. Ne les utilisez pas !");
    $("#bd-end").style.display = "none";
    $("#bd-banner").style.display = "none";
    $("#m-hint").classList.remove("on");
    closeSheet();
    players.sort(function (a, b2) { return a.e - b2.e; }).forEach(function (p) {
      var fb = (p.f && p.f.length >= 15) ? p.f : "000000010000000000000000";
      // Une bouille = un canevas du moteur JS, dessiné à l'écran. C'étaient deux
      // lecteurs Flash sur le plateau et deux autres dans la barre mobile —
      // quatre, allumés en pleine partie.
      var tete = FPBouilleVignette.html(fb);
      var gr = $("#pf" + p.e);
      if (gr) { gr.innerHTML = tete; FPBouilleVignette.brancher(gr); }
      $("#pname" + p.e).textContent = p.n || p.u;
      $("#pserie" + p.e).textContent = "★ " + (p.sr || 0);
      $("#m-name" + p.e).textContent = p.n || p.u;
      $("#m-serie" + p.e).textContent = "★" + (p.sr || 0);
      // mobile : bouille du joueur dans l'encart (comme Grapiz), posée une seule
      // fois au démarrage (GV.start).
      var av = $("#m-av" + p.e);
      if (av) { av.innerHTML = tete; FPBouilleVignette.brancher(av); }
    });
    // mobile : MA main en grand, celle de l'adversaire en petit (dos)
    var mine = GV.myTeam === 1 ? 1 : 0;
    $("#slots" + mine).classList.add("slots-mine");
    $("#slots" + mine).classList.remove("slots-theirs");
    $("#slots" + (1 - mine)).classList.add("slots-theirs");
    $("#slots" + (1 - mine)).classList.remove("slots-mine");
    refreshPanes();
    refreshTurn();
    refreshCounters();
    startMusic();
    GV.dirty = true;
    if (GV.ended) showEnd();
  };

  // ── File d'événements (un événement <bd e="ev"> à la fois) ────────────────
  GV.pushEvent = function (el) {
    GV.queue.push(el);
    // synchro horloges à chaque événement
    var rt0 = el.getAttribute("rt0"), rt1 = el.getAttribute("rt1");
    if (rt0 != null) { GV.clocks[0] = +rt0; GV.clocks[1] = +rt1; GV.clockAt = Date.now(); }
  };

  function animating() { return GV.anims.length > 0; }
  function inputLocked() { return animating() || GV.queue.length > 0; }

  // traite l'événement suivant si rien ne s'anime
  function pump() {
    while (!animating() && GV.queue.length) {
      var el = GV.queue.shift();
      processEvent(el);
    }
    refreshArrows();
  }

  function processEvent(el) {
    var t = el.getAttribute("t");
    var team = +el.getAttribute("tm");
    switch (t) {
      case "cardChosen": {
        var c = +el.getAttribute("c");
        var i = GV.pool.indexOf(c); if (i >= 0) GV.pool.splice(i, 1);
        GV.hands[team].push(c);
        if (el.getAttribute("mp") === "1") GV.phase = 2;
        logLine(nameOf(team) + " a choisi une carte");
        refreshPanes();
        break;
      }
      case "turn": {
        GV.currentTeam = team;
        GV.clockTurn = team;
        GV.clockAt = Date.now();
        // nc="1" : tour REJOUÉ par célérité — on rebouge, on ne rejoue pas de
        // carte. La main reste donc grisée (cf. game.js, _endTurn).
        GV.cardPlayedThisTurn = el.getAttribute("nc") === "1";
        refreshTurn();
        refreshPanes();
        break;
      }
      case "move":
        applyMove(team, +el.getAttribute("d"));
        break;
      case "cardPlayed":
        applyCardPlayed(team, +el.getAttribute("c"), el);
        break;
      case "end": {
        GV.ended = true;
        GV.winner = +el.getAttribute("w");
        // la bannière de fin s'affiche quand les animations sont finies
        GV.anims.push({ wait: 350, update: function (dt) { this.wait -= dt; return this.wait > 0; }, draw: function () {} });
        GV.afterAnims = showEnd;
        break;
      }
    }
  }

  // ── Rejeu d'un mouvement (capture du listener → animations) ───────────────
  function captureBoard(fn) {
    var moves = [], destroyed = [], discovered = [];
    GV.board.setListener({
      onSpriteMove: function (c, d, pushed) {
        moves.push({ from: { x: c.x, y: c.y }, dir: d, pushed: pushed });
      },
      onSlotDestroyed: function (c) { destroyed.push({ x: c.x, y: c.y }); },
      onSlotTrapped: function () {},
      onTrapDiscovered: function (c) { discovered.push({ x: c.x, y: c.y }); },
    });
    fn();
    GV.board.setListener(null);
    return { moves: moves, destroyed: destroyed, discovered: discovered };
  }

  function applyMove(team, d) {
    var solo = (GV.soloPending && GV.soloPending.team === team) ? GV.soloPending.c : null;
    if (solo) GV.soloPending = null;
    GV.soloMark = null;
    var before = snapshotCells();
    var cap = captureBoard(function () {
      if (solo) GV.board.moveSprite(solo, d);
      else GV.board.move(team, d);
      GV.board.removeEmptyBorders();
    });
    GV.board.takeTrapHits();
    buildMoveAnims(before, cap, d);
    refreshCounters();
  }

  // photographie des fruits avant un changement (pour savoir qui était où)
  function snapshotCells() {
    var cells = {};
    for (var y = GV.board.minY; y <= GV.board.maxY; y++) {
      for (var x = GV.board.minX; x <= GV.board.maxX; x++) {
        var e = GV.board.getElement({ x: x, y: y });
        if (e === 0 || e === 1) cells[x + "," + y] = e;
      }
    }
    return cells;
  }

  // Construit les animations d'un mouvement : fruits qui glissent (mv_/pushed_),
  // fruits qui tombent (chute directionnelle), cases de bord qui se détruisent.
  function buildMoveAnims(before, cap, d) {
    var dirName = ["up", "right", "down", "left"][d];
    var moveDur = 480;
    cap.moves.forEach(function (m) {
      var team = before[m.from.x + "," + m.from.y];
      if (team === undefined) return;
      var dest = E.moved(m.from, d);
      var still = GV.board.getElement(dest);
      var died = !(still === 0 || still === 1) ? deathAt(dest) : false;
      // un fruit "mort" = la destination n'est pas un fruit après coup ET la case
      // de destination est morte (hors plateau / détruite / piégée). Sinon il a
      // simplement été poussé plus loin par la chaîne — l'événement de la chaîne
      // anime chaque cran individuellement.
      var key = m.from.x + "," + m.from.y;
      GV.hiddenCells[dest.x + "," + dest.y] = true;
      GV.hiddenCells[key] = true;
      var fruit = FRUIT_OF_TEAM[team];
      var strip = fruit + "_" + (m.pushed ? "pushed_" : "mv_") + dirName;
      GV.anims.push(spriteSlide(fruit, strip, d, m.from, dest, moveDur, died && isDeadCell(dest)));
    });
    if (cap.destroyed.length) {
      GV.anims.push(borderCrumble(cap.destroyed));
    }
  }
  function isDeadCell(c) {
    var e = GV.board.getElement(c);
    return e === E.DESTROYED || e === E.TRAPPED || !GV.board.isValid(c);
  }
  function deathAt(c) { return isDeadCell(c); }

  // Fruit qui glisse d'une case (et meurt éventuellement à l'arrivée).
  function spriteSlide(fruit, strip, d, from, to, dur, dies) {
    var t = 0;
    return {
      from: from, to: to,
      update: function (dt) {
        t += dt;
        if (t >= dur) {
          delete GV.hiddenCells[from.x + "," + from.y];
          delete GV.hiddenCells[to.x + "," + to.y];
          if (dies) GV.effects.push(fallOff(fruit, strip, d, to));
          return false;
        }
        return true;
      },
      draw: function (ctx2) {
        var k = Math.min(1, t / dur);
        var x = from.x + (to.x - from.x) * k;
        var y = from.y + (to.y - from.y) * k;
        drawFrame(ctx2, strip, Math.floor(k * (IMG[strip] ? IMG[strip].frames - 1 : 0)), x, y);
      },
    };
  }

  // Fruit qui tombe (du bord du plateau, dans un trou ou sur un piège) : il
  // continue sur sa lancée DANS LA DIRECTION DU MOUVEMENT (la strip
  // directionnelle continue de tourner), puis la gravité l'emporte et il
  // disparaît en fondu. `delay` (ms) retarde le départ en figeant le fruit
  // sur sa case (utilisé quand une bannière de carte passe d'abord).
  function fallOff(fruit, strip, d, cell, delay) {
    var dl = E.moved({ x: 0, y: 0 }, d);
    var t = -(delay || 0), dur = 560;
    return {
      update: function (dt) { t += dt; return t < dur; },
      draw: function (ctx2) {
        if (t < 0) { drawCellImage(ctx2, "fruit_" + fruit, cell.x, cell.y); return; }
        var k = Math.min(1, t / dur);
        ctx2.globalAlpha = 1 - k * k;
        var fr = IMG[strip] && IMG[strip].frames ? Math.floor(t / 26) % IMG[strip].frames : 0;
        drawFrame(ctx2, strip, fr,
          cell.x + dl.x * 0.85 * k,
          cell.y + dl.y * 0.85 * k + 2.4 * k * k);   // gravité
        ctx2.globalAlpha = 1;
      },
    };
  }

  // Fruit éjecté : vole en l'air et disparaît (flying_left/right, 15 frames).
  function flyAway(fruit, cell, side) {
    var strip = fruit + "_flying_" + side;
    var t = 0, dur = 620;
    var dx = side === "left" ? -1 : 1;
    return {
      update: function (dt) { t += dt; return t < dur; },
      draw: function (ctx2) {
        var k = Math.min(1, t / dur);
        ctx2.globalAlpha = 1 - k * k;
        drawFrame(ctx2, strip, Math.floor(k * (IMG[strip].frames - 1)), cell.x + dx * k * 2.2, cell.y - k * 1.6 + k * k * 1.2);
        ctx2.globalAlpha = 1;
      },
    };
  }

  // Cases de bord qui s'émiettent (strip board, 34 frames). Pendant le
  // `delay`, les cases restent dessinées intactes (la bannière passe d'abord).
  function borderCrumble(cells, delay) {
    var t = -(delay || 0), dur = 620;
    cells.forEach(function (c) { GV.hiddenCells["t" + c.x + "," + c.y] = true; });
    return {
      update: function (dt) {
        t += dt;
        if (t >= dur) { cells.forEach(function (c) { delete GV.hiddenCells["t" + c.x + "," + c.y]; }); return false; }
        return true;
      },
      draw: function (ctx2) {
        var k = Math.max(0, Math.min(1, t / dur));
        var f = Math.floor(k * (IMG.boardAnim.frames - 1));
        cells.forEach(function (c) {
          if (t < 0) drawCellImage(ctx2, "tile", c.x, c.y);
          else drawFrame(ctx2, "boardAnim", f, c.x, c.y);
        });
      },
    };
  }

  // ── Rejeu d'une carte jouée ────────────────────────────────────────────────
  function applyCardPlayed(team, card, el) {
    var x = el.getAttribute("x") != null ? +el.getAttribute("x") : undefined;
    var y = el.getAttribute("y") != null ? +el.getAttribute("y") : undefined;
    var p = el.getAttribute("p") != null ? +el.getAttribute("p") : undefined;
    var hidden = el.getAttribute("h") === "1";

    // « une carte par tour » : verrouille mes cartes dès que MA carte est
    // passée (jouée normalement, posée cachée, ou confisquée par l'adversaire)
    if (team === GV.myTeam || (card === CARD.CONFISCATION && p !== undefined && 1 - team === GV.myTeam)) {
      GV.cardPlayedThisTurn = true;
    }

    // main affichée : retirer la carte jouée (sauf révélation d'une pose cachée
    // déjà retirée chez son poseur — cf. alreadyDestroyed du client d'origine)
    var alreadyGone = false;
    if (!hidden && (card === CARD.PIEGE || card === CARD.DESORDRE || card === CARD.CONFISCATION) && team === GV.myTeam) {
      alreadyGone = true;   // je l'avais retirée au moment de la pose cachée
    }
    if (card === CARD.CONFISCATION && p !== undefined) {
      // révélation d'une confiscation : la carte VOLÉE change de main
      var vi = GV.hands[1 - team].indexOf(p);
      if (vi >= 0) GV.hands[1 - team].splice(vi, 1);
      GV.hands[team].push(p);
      // ma confiscation avait déjà disparu de ma main à la pose
      if (team !== GV.myTeam) removeFromHand(team, CARD.CONFISCATION);
      logLine(nameOf(team) + " confisque la carte de " + nameOf(1 - team) + " !");
    } else if (!alreadyGone) {
      removeFromHand(team, card);
    }
    refreshPanes();

    // bannière d'annonce (même une pose cachée est annoncée à son poseur),
    // PUIS l'effet de la carte : comme les priorités d'animation du SWF
    // d'origine (titre AVANT effet), l'effet démarre quand la bannière passe.
    banner(team, card);
    var wait = EFFECT_DELAY;

    switch (card) {
      case CARD.ENCLUME: anvilDrop({ x: x, y: y }, wait); break;
      case CARD.VACHETTE: cowCharge(x, wait); break;
      case CARD.PETRIFICATION: petrify({ x: x, y: y }, wait); break;
      case CARD.CONVERSION: convert({ x: x, y: y }, wait); break;
      case CARD.RENFORT: renfort(team, x, y, wait); break;
      case CARD.SOLO: {
        GV.soloPending = { team: team, c: { x: x, y: y } };
        if (team === GV.myTeam) GV.soloMark = { x: x, y: y };
        break;
      }
      case CARD.PIEGE:
        if (hidden) {                          // ma pose : marquer la case
          GV.board.setTrapped({ x: x, y: y });
          GV.myTraps[x + "," + y] = true;
        } else {                               // révélation : la case explose
          trapReveal({ x: x, y: y }, wait);
        }
        break;
      case CARD.CELERITE:
        logLine(team === GV.myTeam ? "Effet célérité, encore à vous !" : "Effet célérité, l'adversaire bouge encore !");
        break;
      // désordre / charge / entracte / confiscation : bannière seulement
    }
    refreshCounters();
  }

  function removeFromHand(team, card) {
    var i = GV.hands[team].indexOf(card);
    if (i >= 0) GV.hands[team].splice(i, 1);
  }

  // Délai avant l'effet d'une carte : la bannière (1150 ms) est bien engagée,
  // l'effet démarre pendant qu'elle s'efface.
  var EFFECT_DELAY = 800;

  // bannière d'annonce de carte : bande inclinée rouge (équipe 0) / verte
  // (équipe 1) — couleurs des assets d'origine — avec le nom FRANÇAIS.
  function banner(team, card) {
    var el = $("#bd-banner");
    el.className = "abs " + (team === 0 ? "r" : "g");
    $("#bd-banner-txt").textContent = CARD_LABELS[card].toUpperCase();
    el.style.display = "flex";
    var t = 0, dur = 1150;
    GV.anims.push({
      update: function (dt) {
        t += dt;
        var k = t / dur;
        var off = (k < 0.25) ? (1 - k / 0.25) : (k > 0.75 ? (k - 0.75) / 0.25 : 0);
        el.style.transform = "translateX(" + Math.round(off * (t < dur / 2 ? -1 : 1) * 1100) + "px)";
        el.style.opacity = String(1 - off);
        if (t >= dur) { el.style.display = "none"; el.style.transform = ""; return false; }
        return true;
      },
      draw: function () {},
    });
  }

  // enclume : chute + fracas + destruction de la case (et du bord éventuel).
  // Pendant `delay`, la case et son fruit restent affichés tels quels.
  function anvilDrop(c, delay) {
    var before = snapshotCells();
    var cap = captureBoard(function () {
      GV.board.destroy(c);
      GV.board.removeEmptyBorders();
    });
    GV.board.takeTrapHits();
    var fruit = before[c.x + "," + c.y] !== undefined ? FRUIT_OF_TEAM[before[c.x + "," + c.y]] : null;
    var t = -(delay || 0), fall = 420, smash = 600;
    GV.hiddenCells["t" + c.x + "," + c.y] = true;     // la case reste affichée pendant la chute
    var keepCell = { x: c.x, y: c.y };
    GV.anims.push({
      update: function (dt) {
        t += dt;
        if (t >= fall + smash) {
          delete GV.hiddenCells["t" + keepCell.x + "," + keepCell.y];
          if (cap.destroyed.length > 1 || cap.discovered.length) {
            var rest = cap.destroyed.filter(function (d2) { return d2.x !== keepCell.x || d2.y !== keepCell.y; });
            if (rest.length) GV.anims.push(borderCrumble(rest));
          }
          return false;
        }
        return true;
      },
      draw: function (ctx2) {
        if (t < fall) {
          drawCellImage(ctx2, "tile", keepCell.x, keepCell.y);
          if (fruit) drawCellImage(ctx2, "fruit_" + fruit, keepCell.x, keepCell.y);
          if (t >= 0) {
            var k = t / fall;
            drawFrame(ctx2, "anvil", 0, keepCell.x, keepCell.y - (1 - k * k) * 6);
          }
        } else {
          var k2 = (t - fall) / smash;
          drawFrame(ctx2, "anvilAnim", Math.floor(k2 * (IMG.anvilAnim.frames - 1)), keepCell.x, keepCell.y);
        }
      },
    });
    delete GV.rocks[c.x + "," + c.y];
  }

  // vachette : la vache descend la colonne, les fruits volent, la colonne se
  // vide. Pendant `delay`, la colonne reste affichée intacte (bannière d'abord).
  function cowCharge(colX, delay) {
    var col = [];
    for (var y = GV.board.minY; y <= GV.board.maxY; y++) {
      var e = GV.board.getElement({ x: colX, y: y });
      col.push({ y: y, team: (e === 0 || e === 1) ? e : null });
      delete GV.rocks[colX + "," + y];
    }
    var minY = GV.board.minY, maxY = GV.board.maxY;
    var cap = captureBoard(function () {
      // Dans les bornes, comme le serveur (game.js) : hors cadre, les cases
      // sont DÉTRUITES et doivent le rester — les repeindre en LIBRES faisait
      // diverger les deux plateaux à la première reprise de partie.
      for (var vy = GV.board.minY; vy <= GV.board.maxY; vy++) {
        var c = { x: colX, y: vy };
        var e2 = GV.board.getElement(c);
        if (e2 > E.FREE) GV.board.decTeamCounter(e2);
        GV.board.setElement(c, E.FREE);
        delete GV.myTraps[colX + "," + vy];
      }
      GV.board.removeEmptyBorders();
    });
    col.forEach(function (cell) { GV.hiddenCells[colX + "," + cell.y] = true; });
    var t = -(delay || 0);
    var side = 0;
    var thrown = {};
    GV.anims.push({
      update: function (dt) {
        t += dt;                       // t sert au cyclage des frames de la vache
        if (t < 0) return true;        // bannière en cours : colonne figée
        return this._update(dt);
      },
      _row: minY - 1,
      _update: function (dt) {
        this._row += dt * 0.0028;           // ~2,8 cases/s (COW_SPEED d'origine ≈ 2,5)
        var rowNow = Math.floor(this._row);
        col.forEach(function (cell) {
          if (cell.team !== null && !thrown[cell.y] && rowNow >= cell.y) {
            thrown[cell.y] = true;
            side = 1 - side;
            GV.effects.push(flyAway(FRUIT_OF_TEAM[cell.team], { x: colX, y: cell.y }, side ? "left" : "right"));
            delete GV.hiddenCells[colX + "," + cell.y];
            GV.hiddenCells["f" + colX + "," + cell.y] = true;   // fruit retiré, case visible
          }
        });
        if (this._row > maxY + 1.2) {
          col.forEach(function (cell) {
            delete GV.hiddenCells[colX + "," + cell.y];
            delete GV.hiddenCells["f" + colX + "," + cell.y];
          });
          if (cap.destroyed.length) GV.anims.push(borderCrumble(cap.destroyed));
          return false;
        }
        return true;
      },
      draw: function (ctx2) {
        // les cases de la colonne pas encore atteintes restent dessinées
        col.forEach(function (cell) {
          if (GV.hiddenCells[colX + "," + cell.y]) {
            drawCellImage(ctx2, "tile", colX, cell.y);
            if (cell.team !== null && !thrown[cell.y]) drawCellImage(ctx2, "fruit_" + FRUIT_OF_TEAM[cell.team], colX, cell.y);
          } else if (GV.hiddenCells["f" + colX + "," + cell.y]) {
            drawCellImage(ctx2, "tile", colX, cell.y);
          }
        });
        if (t < 0) return;                    // bannière en cours : pas encore de vache
        var yPix = this._row * CELL;
        // traînée de poussière
        drawFrameAtPix(ctx2, "cowTrail", Math.floor((Math.max(0, t) / 50) % IMG.cowTrail.frames), colX * CELL, yPix - CELL * 0.8);
        drawFrameAtPix(ctx2, "cow", Math.floor((Math.max(0, t) / 45) % IMG.cow.frames), colX * CELL, yPix);
      },
    });
  }

  // pétrification : le fruit joue sa strip et reste en pierre. Pendant
  // `delay`, la frame 0 (le fruit intact) reste affichée.
  function petrify(c, delay) {
    var e = GV.board.getElement(c);
    var fruit = (e === 0 || e === 1) ? FRUIT_OF_TEAM[e] : "banane";
    var cap = captureBoard(function () {
      GV.board.setElement(c, E.ROCK);
      if (e === 0 || e === 1) GV.board.decTeamCounter(e);
      GV.board.removeEmptyBorders();
    });
    GV.board.takeTrapHits();
    GV.rocks[c.x + "," + c.y] = fruit;
    var strip = fruit + "_petrification";
    var t = -(delay || 0), dur = 700;
    GV.hiddenCells["r" + c.x + "," + c.y] = true;     // ne pas dessiner la pierre statique pendant l'anim
    GV.anims.push({
      update: function (dt) {
        t += dt;
        if (t >= dur) {
          delete GV.hiddenCells["r" + c.x + "," + c.y];
          if (cap.destroyed.length) GV.anims.push(borderCrumble(cap.destroyed));
          return false;
        }
        return true;
      },
      draw: function (ctx2) {
        var k = Math.max(0, Math.min(1, t / dur));
        drawFrame(ctx2, strip, Math.floor(k * (IMG[strip].frames - 1)), c.x, c.y);
      },
    });
  }

  // conversion : le fruit change de camp SOUS NOS YEUX — l'ancien fruit
  // s'écrase sur place, le nouveau surgit avec un petit rebond. Pendant
  // `delay`, l'ancien fruit reste affiché tel quel (bannière d'abord).
  function convert(c, delay) {
    var e = GV.board.getElement(c);
    if (!(e === 0 || e === 1)) return;
    var oldFruit = FRUIT_OF_TEAM[e], newFruit = FRUIT_OF_TEAM[1 - e];
    GV.board.decTeamCounter(e);
    GV.board.incTeamCounter(1 - e);
    GV.board.setElement(c, 1 - e);
    var key = c.x + "," + c.y;
    GV.hiddenCells[key] = true;                 // le statique attend la fin de l'anim
    var t = -(delay || 0), dur = 640, swapAt = 0.42;
    GV.anims.push({
      update: function (dt) {
        t += dt;
        if (t >= dur) { delete GV.hiddenCells[key]; return false; }
        return true;
      },
      draw: function (ctx2) {
        if (t < 0) { drawCellImage(ctx2, "fruit_" + oldFruit, c.x, c.y); return; }
        var k = Math.min(1, t / dur);
        if (k < swapAt) {                       // l'ancien fruit s'écrase
          var p = k / swapAt;
          drawCellImageScaled(ctx2, "fruit_" + oldFruit, c.x, c.y, 1 - 0.8 * p);
          ctx2.globalAlpha = 0.55 * p;
          drawCellImage(ctx2, "select", c.x, c.y);
          ctx2.globalAlpha = 1;
        } else {                                // le nouveau surgit (rebond)
          var p2 = (k - swapAt) / (1 - swapAt);
          var s = 0.25 + 0.75 * p2 + 0.16 * Math.sin(p2 * Math.PI); // léger overshoot
          drawCellImageScaled(ctx2, "fruit_" + newFruit, c.x, c.y, Math.min(1.16, s));
          ctx2.globalAlpha = Math.max(0, 0.55 * (1 - p2));
          drawCellImage(ctx2, "select", c.x, c.y);
          ctx2.globalAlpha = 1;
        }
      },
    });
  }

  // renfort : décode les coordonnées (encodage Renfort.as) et fait pousser
  // les fruits (échelonnés, après la bannière)
  function renfort(team, xsum, ysum, delay) {
    var spots = [];
    if (xsum > 10000) {
      var x1 = Math.floor(xsum / 10000) - 1, y1 = Math.floor(ysum / 10000) - 1;
      xsum -= (x1 + 1) * 10000; ysum -= (y1 + 1) * 10000;
      spots.push({ x: x1, y: y1 });
    }
    if (xsum > 100) {
      var x2 = Math.floor(xsum / 100) - 1, y2 = Math.floor(ysum / 100) - 1;
      xsum -= (x2 + 1) * 100; ysum -= (y2 + 1) * 100;
      spots.push({ x: x2, y: y2 });
    }
    if (xsum > 0) spots.push({ x: xsum - 1, y: ysum - 1 });
    spots.forEach(function (s, i) {
      GV.board.setElement(s, team);
      GV.board.incTeamCounter(team);
      GV.hiddenCells[s.x + "," + s.y] = true;
      var t = -(delay || 0) - i * 140, dur = 330;
      GV.anims.push({
        update: function (dt) {
          t += dt;
          if (t >= dur) { delete GV.hiddenCells[s.x + "," + s.y]; return false; }
          return true;
        },
        draw: function (ctx2) {
          if (t < 0) return;
          var k = Math.min(1, t / dur);
          var s2 = 0.3 + 0.7 * k;
          drawCellImageScaled(ctx2, "fruit_" + FRUIT_OF_TEAM[team], s.x, s.y, s2);
        },
      });
    });
  }

  // révélation d'un piège : la case explose et le fruit qui s'y trouvait
  // TOMBE dans le trou (chute sur place, plus d'éjection latérale).
  function trapReveal(c, delay) {
    var key = c.x + "," + c.y;
    delete GV.myTraps[key];
    var before = snapshotCells();
    var cap = captureBoard(function () {
      GV.board.destroy(c);                    // TRAPPED → discovered ; fruit → tué
      GV.board.removeEmptyBorders();
    });
    GV.board.takeTrapHits();
    var victim = before[key];
    if (victim !== undefined) {
      var fruit = FRUIT_OF_TEAM[victim];
      GV.anims.push(fallOff(fruit, fruit + "_mv_down", DIR.DOWN, c, delay));
    }
    var cells = [{ x: c.x, y: c.y }];
    cap.destroyed.forEach(function (d2) { if (d2.x !== c.x || d2.y !== c.y) cells.push(d2); });
    GV.anims.push(borderCrumble(cells, delay));
  }

  // ── Boucle de rendu ────────────────────────────────────────────────────────
  var lastT = 0;
  function frame(now) {
    var dt = lastT ? Math.min(50, now - lastT) : 16;
    lastT = now;
    if (GV.started && $("#screen-game").classList.contains("on")) {
      // animations
      if (GV.anims.length) {
        GV.anims = GV.anims.filter(function (a) { return a.update(dt); });
        GV.dirty = true;
        if (!GV.anims.length) {
          refreshCounters();
          if (GV.afterAnims) { var f = GV.afterAnims; GV.afterAnims = null; f(); }
        }
      }
      if (GV.effects.length) {
        GV.effects = GV.effects.filter(function (a) { return a.update(dt); });
        GV.dirty = true;
      }
      pump();
      tickClocks();
      if (GV.dirty) { render(); GV.dirty = false; }
      if (GV.anims.length || GV.effects.length) GV.dirty = true;
    }
    requestAnimationFrame(frame);
  }

  function cellPix(x, y) { return { x: GV.originX + x * CELL, y: GV.originY + y * CELL }; }

  // dessine la frame f d'une strip, la CASE (ancre 104,102) posée sur la cellule (gx,gy)
  function drawFrame(ctx2, key, f, gx, gy) {
    var a = IMG[key];
    if (!a || !a.fw) return;
    var p = cellPix(gx, gy);
    ctx2.drawImage(a.img, f * a.fw, 0, a.fw, a.img.height, p.x - ANCHOR_X, p.y - ANCHOR_Y, a.fw, a.img.height);
  }
  function drawFrameAtPix(ctx2, key, f, px, py) {
    var a = IMG[key];
    if (!a || !a.fw) return;
    ctx2.drawImage(a.img, f * a.fw, 0, a.fw, a.img.height, GV.originX + px - ANCHOR_X, GV.originY + py - ANCHOR_Y, a.fw, a.img.height);
  }
  function drawCellImage(ctx2, key, gx, gy) { drawFrame(ctx2, key, 0, gx, gy); }
  function drawCellImageScaled(ctx2, key, gx, gy, s) {
    var a = IMG[key];
    if (!a || !a.fw) return;
    var p = cellPix(gx, gy);
    var w = a.fw * s, h = a.img.height * s;
    ctx2.drawImage(a.img, 0, 0, a.fw, a.img.height,
      p.x + CELL / 2 - (ANCHOR_X + CELL / 2) * s, p.y + CELL / 2 - (ANCHOR_Y + CELL / 2) * s, w, h);
  }

  function render() {
    ctx.clearRect(0, 0, AREA_W, AREA_H);
    if (!GV.board) return;
    var b = GV.board;
    // cases (les TRAPPED se dessinent comme des cases normales)
    for (var y = b.minY; y <= b.maxY; y++) {
      for (var x = b.minX; x <= b.maxX; x++) {
        var e = b.getElement({ x: x, y: y });
        if (e === E.DESTROYED) continue;
        if (GV.hiddenCells["t" + x + "," + y]) continue;   // case en cours de destruction
        drawCellImage(ctx, "tile", x, y);
      }
    }
    // surbrillance de la case visée (mode cible)
    if (GV.targetCard !== null && GV.hoverCell) drawCellImage(ctx, "select", GV.hoverCell.x, GV.hoverCell.y);
    // marqueur solo
    if (GV.soloMark) drawCellImage(ctx, "select", GV.soloMark.x, GV.soloMark.y);
    // fruits + pierres
    for (var y2 = b.minY; y2 <= b.maxY; y2++) {
      for (var x2 = b.minX; x2 <= b.maxX; x2++) {
        var key = x2 + "," + y2;
        var e2 = b.getElement({ x: x2, y: y2 });
        if (GV.hiddenCells[key] || GV.hiddenCells["t" + key] || GV.hiddenCells["f" + key]) continue;
        if (e2 === 0 || e2 === 1) drawCellImage(ctx, "fruit_" + FRUIT_OF_TEAM[e2], x2, y2);
        else if (e2 === E.ROCK && !GV.hiddenCells["r" + key]) {
          var rk = GV.rocks[key] || "banane";
          var st = rk + "_petrification";
          drawFrame(ctx, st, IMG[st] ? IMG[st].frames - 1 : 0, x2, y2);
        }
      }
    }
    // mes pièges (marqueur discret, connu de moi seul)
    ctx.save();
    ctx.strokeStyle = "rgba(180,40,40,.55)";
    ctx.setLineDash([4, 3]);
    Object.keys(GV.myTraps).forEach(function (k) {
      var pq = k.split(",");
      var p = cellPix(+pq[0], +pq[1]);
      ctx.strokeRect(p.x + 6, p.y + 6, CELL - 12, CELL - 12);
    });
    ctx.restore();
    // animations puis effets par-dessus
    GV.anims.forEach(function (a) { a.draw(ctx); });
    GV.effects.forEach(function (a) { a.draw(ctx); });
  }

  // ── Panneaux joueurs : cartes / compteurs / horloges / tour ───────────────
  function buildSlots() {
    [0, 1].forEach(function (side) {
      var host = $("#slots" + side);
      host.innerHTML = "";
      var xs = side === 0 ? [16, 119] : [840, 943];
      var ys = [190, 315, 439, 564];
      for (var i = 0; i < 8; i++) {
        var d = document.createElement("div");
        d.className = "cardslot abs";
        d.style.left = xs[i % 2] + "px";
        d.style.top = ys[Math.floor(i / 2)] + "px";
        d.dataset.side = side;
        d.dataset.slot = i;
        host.appendChild(d);
      }
    });
  }

  // Quoi afficher dans les 8 emplacements d'un panneau (fidèle au SWF) :
  // draft → le POOL sur le panneau du joueur qui choisit (faces pour moi,
  // dos pour lui) ; phase de mouvement → la main du joueur (faces pour moi).
  function refreshPanes() {
    [0, 1].forEach(function (team) {
      var cards = [];
      var faces = team === GV.myTeam;
      var clickable = false;
      if (GV.phase === 1) {
        if (team === GV.currentTeam) {
          cards = GV.pool;
          clickable = faces && !GV.ended;
        }
      } else {
        cards = GV.hands[team];
        clickable = faces && !GV.ended && GV.currentTeam === GV.myTeam && !GV.cardPlayedThisTurn;
      }
      var host = $("#slots" + team);
      Array.prototype.forEach.call(host.children, function (slot, i) {
        var c = cards[i];
        slot.classList.toggle("play", clickable && c !== undefined);
        slot.dataset.card = c !== undefined ? c : "";
        if (c === undefined) { slot.innerHTML = ""; return; }
        var src = faces ? "assets/cards/" + CARD_KEYS[c] + ".png" : "assets/cards/verso.png";
        var cur = slot.firstChild;
        if (!cur || cur.dataset.src !== src) {
          slot.innerHTML = '<img class="appear" draggable="false" data-src="' + src + '" src="' + src + '" alt="">';
          slot.firstChild.dataset.src = src;
        }
      });
    });
  }

  function refreshCounters() {
    if (!GV.board) return;
    $("#pcount0").textContent = "× " + GV.board.countSpritesOf(0);
    $("#pcount1").textContent = "× " + GV.board.countSpritesOf(1);
    // L'icône fruit (vrai sprite orange/banane) est dans le HTML du chip ;
    // ici on ne met à jour que le nombre.
    $("#m-count0").textContent = GV.board.countSpritesOf(0);
    $("#m-count1").textContent = GV.board.countSpritesOf(1);
  }

  function refreshTurn() {
    [0, 1].forEach(function (t) {
      var active = t === GV.currentTeam && !GV.ended;
      $("#pside" + t).classList.toggle("active", active);
      $("#mchip" + t).classList.toggle("active", active);
    });
    if (GV.phase === 1 && GV.currentTeam === GV.myTeam && !GV.ended) logLine("Choisissez une carte");
  }

  function refreshArrows() {
    var show = GV.started && !GV.ended && GV.phase === 2 && GV.currentTeam === GV.myTeam &&
      !inputLocked() && GV.targetCard === null;
    ["up", "down", "left", "right"].forEach(function (d) {
      $("#arrow-" + d).classList.toggle("on", show);
    });
    $("#m-dpad").classList.toggle("on", show);     // mobile : croix directionnelle
    positionArrows();
  }

  function positionArrows() {
    if (!GV.board || isMobileView()) return;
    var bx = PAGE_AREA_X + GV.originX, by = GV.originY;
    var bw = GV.size * CELL, bh = GV.size * CELL;
    var up = $("#arrow-up"), down = $("#arrow-down"), left = $("#arrow-left"), right = $("#arrow-right");
    up.style.left = (bx + bw / 2 - 52) + "px"; up.style.top = (by - 78) + "px";
    down.style.left = (bx + bw / 2 - 52) + "px"; down.style.top = (by + bh - 22) + "px";
    left.style.left = (bx - 80) + "px"; left.style.top = (by + bh / 2 - 52) + "px";
    right.style.left = (bx + bw - 25) + "px"; right.style.top = (by + bh / 2 - 52) + "px";
  }

  // Taille interne du canvas : 587x560 sur bureau (la zone verte de la page),
  // resserré autour du plateau sur mobile (cases plus grandes à l'écran).
  function setupCanvas() {
    if (!GV.started) return;
    var mobile = isMobileView();
    var w = mobile ? GV.size * CELL + 24 : AREA_W;
    var h = mobile ? GV.size * CELL + 24 : AREA_H;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    GV.originX = mobile ? 12 : Math.round((AREA_W - GV.size * CELL) / 2);
    GV.originY = mobile ? 12 : Math.round((AREA_H - GV.size * CELL) / 2);
    positionArrows();
    GV.dirty = true;
  }

  function tickClocks() {
    if (!GV.started) return;
    var c0 = GV.clocks[0], c1 = GV.clocks[1];
    if (!GV.ended && GV.clockTurn >= 0) {
      var el = Date.now() - GV.clockAt;
      if (GV.clockTurn === 0) c0 = Math.max(0, c0 - el); else c1 = Math.max(0, c1 - el);
    }
    var f0 = fmt(c0), f1 = fmt(c1);
    if ($("#pclock0").textContent !== f0) { $("#pclock0").textContent = f0; $("#m-clock0").textContent = f0; }
    if ($("#pclock1").textContent !== f1) { $("#pclock1").textContent = f1; $("#m-clock1").textContent = f1; }
  }
  function fmt(ms) {
    ms = Math.max(0, ms | 0);
    var s = Math.floor(ms / 1000);
    return ("0" + Math.floor(s / 60)).slice(-2) + ":" + ("0" + (s % 60)).slice(-2);
  }

  function nameOf(team) {
    var p = GV.players.filter(function (q) { return q.e === team; })[0];
    return p ? (p.n || p.u) : "équipe " + team;
  }

  // ── Chat & log ─────────────────────────────────────────────────────────────
  function logLine(txt) { addChatLine('<span class="log">' + esc(txt) + "</span>"); }
  GV.chatMessage = function (user, msg) { addChatLine('<span class="nk">' + esc(user) + " &gt;</span> " + esc(msg)); };
  function addChatLine(html) {
    var box = $("#bd-chatbox");
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    var d = document.createElement("div");
    d.innerHTML = html;
    box.appendChild(d);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  // ── Fin de partie (textes d'origine, en français) ─────────────────────────
  function showEnd() {
    var box = $("#bd-end");
    var mine = GV.winner === GV.myTeam;
    var draw = !(GV.winner === 0 || GV.winner === 1);
    if (draw) {
      $("#bd-endtext").textContent = "Égalité ! La Vachette gagne…\nVous avez encore vos chances sur le challenge.";
      $("#bd-endsub").textContent = "";
    } else if (mine) {
      $("#bd-endtext").textContent = "La partie est terminée, " + nameOf(GV.winner) + " a gagné !";
      $("#bd-endsub").textContent = "+1 à votre série !";
    } else {
      $("#bd-endtext").textContent = "Vous avez perdu !\nÀ bientôt sur le challenge Frutibandas.";
      $("#bd-endsub").textContent = nameOf(GV.winner) + " remporte la partie.";
    }
    box.style.display = "block";
    refreshArrows();
    // Retour automatique au lobby (gagnant) / à l'accueil (défaite, égalité)
    // après un court délai. Sur mobile, l'overlay de fin et son bouton OK
    // peuvent être hors écran (il fallait scroller pour revenir) ; on enchaîne
    // donc tout seul. Le bouton OK reste actif pour enchaîner immédiatement.
    if (GV._endTimer) clearTimeout(GV._endTimer);
    GV._endTimer = setTimeout(function () {
      GV._endTimer = null;
      if (GV.onEndClosed) GV.onEndClosed();
    }, 2200);
  }
  // Ferme l'écran de fin (clic OK ou minuteur) une seule fois.
  function closeEnd() {
    if (GV._endTimer) { clearTimeout(GV._endTimer); GV._endTimer = null; }
    if (GV.onEndClosed) GV.onEndClosed();
  }

  // ── Entrées ────────────────────────────────────────────────────────────────
  // (clientX, clientY) → cellule du plateau. L'échelle est déduite du canvas
  // lui-même (rect / taille interne) : valable bureau (transform scale du
  // #page) comme mobile (largeur CSS 100 vw).
  function cellAtClient(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    var s = r.width / canvas.width;
    var cx = (clientX - r.left) / s, cy = (clientY - r.top) / s;
    var gx = Math.floor((cx - GV.originX) / CELL), gy = Math.floor((cy - GV.originY) / CELL);
    if (!GV.board) return null;
    var c = { x: gx, y: gy };
    return GV.board.isValid(c) ? c : null;
  }
  function canvasCell(ev) { return cellAtClient(ev.clientX, ev.clientY); }

  function bindInputs() {
    // flèches (souris)
    [["up", DIR.UP], ["down", DIR.DOWN], ["left", DIR.LEFT], ["right", DIR.RIGHT]].forEach(function (a) {
      var img = $("#arrow-" + a[0]);
      img.addEventListener("mouseenter", function () { img.src = "assets/page/arrow_" + a[0] + "_hover.png"; });
      img.addEventListener("mouseleave", function () { img.src = "assets/page/arrow_" + a[0] + ".png"; });
      img.addEventListener("click", function () { requestMove(a[1]); });
    });
    // clavier
    document.addEventListener("keydown", function (ev) {
      if (!$("#screen-game").classList.contains("on")) return;
      if (document.activeElement === $("#bd-input")) return;
      var map = { ArrowUp: DIR.UP, ArrowDown: DIR.DOWN, ArrowLeft: DIR.LEFT, ArrowRight: DIR.RIGHT };
      if (map[ev.key] !== undefined) { ev.preventDefault(); requestMove(map[ev.key]); }
      if (ev.key === "m" || ev.key === "M") toggleMusic();
      if (ev.key === "Escape" && GV.targetCard !== null) cancelTarget("Lancement de carte annulé.");
    });
    // plateau : visée des cartes
    canvas.addEventListener("mousemove", function (ev) {
      var c = canvasCell(ev);
      if ((c && GV.hoverCell && (c.x !== GV.hoverCell.x || c.y !== GV.hoverCell.y)) || (!!c !== !!GV.hoverCell)) GV.dirty = true;
      GV.hoverCell = c;
    });
    canvas.addEventListener("click", function (ev) { onBoardTap(ev.clientX, ev.clientY); });
    // clic ailleurs sur la page en mode visée = annulation (fidèle à l'original)
    // clic sur le FOND de la page en mode visée = annulation (fidèle à
    // l'original). Les contrôles (cartes, fiche mobile, bandeau de visée,
    // croix, chat) ne doivent PAS annuler : le clic « Jouer » de la fiche
    // remonte jusqu'ici et tuerait la visée qu'il vient d'armer.
    $("#page").addEventListener("click", function (ev) {
      if (GV.targetCard === null) return;
      if (ev.target.closest("#bd-canvas, .cardslot, #m-sheet, #m-sheet-backdrop, #m-hint, #m-dpad, #m-chatbtn, #chatwrap")) return;
      cancelTarget("Vous avez cliqué hors du plateau, lancement de carte annulé !");
    });
    // cartes
    $("#slots0").addEventListener("click", onSlotClick);
    $("#slots1").addEventListener("click", onSlotClick);
    [0, 1].forEach(function (s) {
      $("#slots" + s).addEventListener("mouseover", onSlotHover);
      $("#slots" + s).addEventListener("mouseout", hideInfo);
    });
    // chat
    $("#bd-input").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        var v = this.value.trim();
        if (v) GV.send({ a: "gsay", m: v });
        this.value = "";
      }
    });
    // boutons (Abandon avec confirmation — texte d'origine)
    function onGiveUp() {
      if (GV.ended) { closeEnd(); return; }
      if (window.confirm("Voulez-vous abandonner la partie ?")) { if (GV.onQuit) GV.onQuit(); }
    }
    $("#btn-giveup").addEventListener("click", onGiveUp);
    $("#m-giveup").addEventListener("click", onGiveUp);
    $("#btn-sound").addEventListener("click", toggleMusic);
    $("#m-sound").addEventListener("click", toggleMusic);
    var okb = $("#bd-ok");
    okb.addEventListener("mouseenter", function () { okb.src = "assets/common/ok_hover.png"; });
    okb.addEventListener("mouseleave", function () { okb.src = "assets/common/ok.png"; });
    okb.addEventListener("click", function () { closeEnd(); });

    // ── mobile : croix directionnelle, glisser sur le plateau, fiche carte,
    //    chat en surcouche ──
    each(document.querySelectorAll("#m-dpad .mdir"), function (b) {
      b.addEventListener("click", function () { requestMove(+b.dataset.d); });
    });
    var touch = null;
    canvas.addEventListener("touchstart", function (ev) {
      if (!ev.touches.length) return;
      touch = { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
      ev.preventDefault();
    }, { passive: false });
    canvas.addEventListener("touchmove", function (ev) { ev.preventDefault(); }, { passive: false });
    canvas.addEventListener("touchend", function (ev) {
      if (!touch) return;
      var t0 = touch; touch = null;
      var t = ev.changedTouches && ev.changedTouches[0];
      if (!t) return;
      ev.preventDefault();
      var dx = t.clientX - t0.x, dy = t.clientY - t0.y;
      if (Math.abs(dx) < 22 && Math.abs(dy) < 22) {        // toucher = clic plateau
        onBoardTap(t.clientX, t.clientY);
        return;
      }
      // glisser = bouger ses fruits dans la direction du geste
      var d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR.RIGHT : DIR.LEFT) : (dy > 0 ? DIR.DOWN : DIR.UP);
      requestMove(d);
    }, { passive: false });
    $("#m-hint-cancel").addEventListener("click", function () { cancelTarget("Lancement de carte annulé."); });
    $("#m-sheet-close").addEventListener("click", closeSheet);
    $("#m-sheet-backdrop").addEventListener("click", closeSheet);
    $("#m-sheet-play").addEventListener("click", function () {
      var card = GV._sheetCard;
      closeSheet();
      if (card === undefined || card === null) return;
      playFromHand(card);
    });
    $("#m-chatbtn").addEventListener("click", function () {
      document.body.classList.toggle("chat-open");
    });

    // mise à l'échelle de la page
    window.addEventListener("resize", function () { scalePage(); setupCanvas(); });
    scalePage();
  }

  function each(l, f) { Array.prototype.forEach.call(l, f); }
  function isMobileView() { return window.matchMedia("(max-width:760px)").matches; }

  // fiche carte mobile (confirmation avant de jouer / choisir)
  function openSheet(card) {
    GV._sheetCard = card;
    $("#m-sheet-img").src = "assets/cards/" + CARD_KEYS[card] + ".png";
    $("#m-sheet-name").textContent = CARD_LABELS[card];
    $("#m-sheet-desc").textContent = CARD_DESCS[card];
    $("#m-sheet-play").textContent = GV.phase === 1 ? "Choisir cette carte" : "Jouer";
    document.body.classList.add("sheet-open");
  }
  function closeSheet() {
    GV._sheetCard = null;
    document.body.classList.remove("sheet-open");
  }

  function onSlotClick(ev) {
    var slot = ev.target.closest(".cardslot");
    if (!slot || !slot.classList.contains("play")) return;
    var card = +slot.dataset.card;
    if (inputLocked() || GV.ended) return;
    if (isMobileView()) { openSheet(card); return; }   // mobile : fiche de confirmation
    playFromHand(card);
  }

  // Joue / choisit une carte de MA main (après confirmation sur mobile).
  function playFromHand(card) {
    if (inputLocked() || GV.ended) return;
    if (GV.phase === 1) {                       // draft : choisir cette carte
      if (GV.currentTeam !== GV.myTeam) return;
      GV.send({ a: "choose", c: card });
      return;
    }
    if (GV.currentTeam !== GV.myTeam || GV.cardPlayedThisTurn) return;
    if (NEEDS_TARGET[card]) {                   // viser une case
      GV.targetCard = card;
      canvas.classList.add("target");
      logLine("Choisissez une cible pour « " + CARD_LABELS[card] + " » (Échap pour annuler)");
      $("#m-hint-txt").textContent = "Touche une case pour « " + CARD_LABELS[card] + " »";
      $("#m-hint").classList.add("on");
      refreshArrows();
    } else {
      GV.send({ a: "play", c: card });
    }
  }

  // Toucher / cliquer une case du plateau (mode visée d'une carte).
  function onBoardTap(clientX, clientY) {
    if (GV.targetCard === null) return;
    var c = cellAtClient(clientX, clientY);
    if (!c) { cancelTarget("Vous avez cliqué hors du plateau, lancement de carte annulé !"); return; }
    var err = validTarget(GV.targetCard, c);
    if (err) { logLine(err); if (isMobileView()) $("#m-hint-txt").textContent = err; return; }
    GV.send({ a: "play", c: GV.targetCard, x: c.x, y: c.y });
    GV.targetCard = null;
    canvas.classList.remove("target");
    $("#m-hint").classList.remove("on");
    refreshArrows();
  }

  function validTarget(card, c) {
    var el = GV.board.getElement(c);
    if (card === CARD.PIEGE && el !== E.FREE) return "Vous devez cibler un emplacement libre !";
    if ((card === CARD.PETRIFICATION || card === CARD.CONVERSION) && !(el === 0 || el === 1)) return "Vous devez cibler un fruit !";
    if (card === CARD.SOLO && el !== GV.myTeam) return "Vous devez cibler un fruit vous appartenant !";
    return null;
  }

  function cancelTarget(msg) {
    GV.targetCard = null;
    canvas.classList.remove("target");
    $("#m-hint").classList.remove("on");
    if (msg) logLine(msg);
    refreshArrows();
    GV.dirty = true;
  }

  function requestMove(d) {
    if (!GV.started || GV.ended || GV.phase !== 2) return;
    if (GV.currentTeam !== GV.myTeam || inputLocked() || GV.targetCard !== null) return;
    GV.send({ a: "move", d: d });
  }

  // info carte au survol (équivalent du mode info du chat d'origine)
  function onSlotHover(ev) {
    var slot = ev.target.closest(".cardslot");
    if (!slot || slot.dataset.card === "") return;
    var side = +slot.dataset.side;
    if (side !== GV.myTeam && GV.phase !== 1) return;   // dos de carte : pas d'info
    if (side !== GV.myTeam && GV.phase === 1) return;
    var c = +slot.dataset.card;
    var box = $("#bd-info");
    box.innerHTML = '<img src="assets/cards/' + CARD_KEYS[c] + '.png" alt="">' +
      '<div class="iname">' + esc(CARD_LABELS[c]) + "</div>" +
      '<div class="idesc">' + esc(CARD_DESCS[c]) + "</div>";
    box.style.display = "block";
  }
  function hideInfo() { $("#bd-info").style.display = "none"; }

  // ── Musique ────────────────────────────────────────────────────────────────
  function startMusic() {
    if (!GV.sndIntro) {
      GV.sndIntro = new Audio("assets/sound/intro.mp3");
      GV.sndLoop = new Audio("assets/sound/loop.mp3");
      GV.sndLoop.loop = true;
      GV.sndIntro.addEventListener("ended", function () { if (GV.musicOn) GV.sndLoop.play().catch(function () {}); });
    }
    if (GV.musicOn) {
      GV.sndIntro.currentTime = 0;
      GV.sndIntro.play().catch(function () {});
    }
  }
  function toggleMusic() {
    GV.musicOn = !GV.musicOn;
    if (!GV.musicOn) { GV.sndIntro && GV.sndIntro.pause(); GV.sndLoop && GV.sndLoop.pause(); }
    else if (GV.sndLoop) { GV.sndLoop.play().catch(function () {}); }
  }
  GV.stopMusic = function () {
    if (GV.sndIntro) GV.sndIntro.pause();
    if (GV.sndLoop) GV.sndLoop.pause();
  };

  function scalePage() {
    var page = $("#page");
    if (isMobileView()) { page.style.transform = ""; return; }   // pile verticale en CSS
    var s = Math.min(window.innerWidth / 1050, window.innerHeight / 728);
    page.style.transform = "translateX(-50%) scale(" + s + ")";
  }
})();
