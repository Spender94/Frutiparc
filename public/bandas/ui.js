//
// Frutibandas — connexion + écrans hors partie (mode, lobby) + dispatch <bd>.
// Même architecture que le client Grapiz : WebSocket vers le bridge existant,
// identification par <k l s>, puis protocole <bd> (cf. server/net.js).
//
(function () {
  "use strict";
  var GV = window.BandasView;
  var $ = function (s) { return document.querySelector(s); };
  function div(c) { var d = document.createElement("div"); d.className = c; return d; }
  function esc(s) { var d = document.createElement("div"); d.textContent = String(s == null ? "" : s); return d.innerHTML; }
  function each(l, f) { Array.prototype.forEach.call(l, f); }
  function xml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  function sameUser(a, b) { return String(a == null ? "" : a).toLowerCase() === String(b == null ? "" : b).toLowerCase(); }
  function isMe(p) { return !!p && (sameUser(p.u, state.user) || sameUser(p.n, state.user)); }

  var DEFAULT_BOUILLE = "000000010000000000000000";
  var sid = new URLSearchParams(location.search).get("sid") || "";
  if (!sid) { try { sid = (JSON.parse(localStorage.getItem("fp_light_session") || "{}") || {}).sid || ""; } catch (e) {} }

  // Les trois salles du jeu d'origine (frutibandas/Main.as : FREE_MODE 0,
  // CHALLENGE_MODE 1, CHAMPION_MODE 2). On garde la dernière visitée : revenir
  // au jeu après un rafraîchissement ne doit pas renvoyer au challenge.
  var SALLES = {
    chall:  { titre: "CHALLENGE" },
    champ:  { titre: "CHAMPIONNAT" },
    amical: { titre: "MATCHES AMICAUX" },
  };
  var SALLE_DEFAUT = "chall";
  function salleGardee() {
    try { var s = localStorage.getItem("bandas.salle"); if (SALLES[s]) return s; } catch (e) {}
    return SALLE_DEFAUT;
  }

  var state = {
    ws: null, user: "", myBouille: "", gotLobby: false, screen: "connect",
    inGame: false, helloTimer: null, lobbyTab: "players", salle: salleGardee(),
  };
  function setStatus(s) { $("#status").textContent = s; }

  // ── Pop-in « Plus de FD » (reproduction de la popin NATIVE Frutiparc) ──
  // Affichée quand le serveur refuse un match CLASSÉ faute de FD : soit le
  // joueur a épuisé son quota (no-fd), soit son adversaire (opp-no-fd). PAS
  // d'achat ici — les pass s'achètent dans la BOUTIQUE officielle (rubrique
  // Pass, « Pass quotidien de Frutibandas »). L'entraînement contre les bots
  // reste libre. Style calqué sur la Boutique (fond blanc, bordure noire +
  // liseré gris collé, coins arrondis, ombre portée, icône + titre gras).
  function showFdPopin(kind) {
    if (document.getElementById("fd-popin")) return;
    var msg = (kind === "opp-no-fd")
      ? "Ton adversaire n’a plus de disque Challenge aujourd’hui. Proposez-lui un entraînement contre les bots (toujours libre), ou réessayez demain."
      : "Nom d’un Pamplefrousse ! Tu as perdu tous tes disques Challenge pour aujourd’hui ! Continue à t’entraîner librement contre les bots, retente demain ou achète un pass en boutique !";
    var wrap = document.createElement("div");
    wrap.id = "fd-popin";
    wrap.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.30)";
    wrap.innerHTML =
      '<div style="background:#fff;border:1px solid #000;border-radius:12px;padding:0;box-shadow:0 7px 8px rgba(0,0,0,.5);max-width:378px;width:calc(100% - 14px)">' +
        '<div style="border:2px solid #ccc;border-radius:11px;padding:13px 16px 16px;font-family:Verdana,Arial,sans-serif;color:#000">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
            '<img src="/fb/icone_popin.png" alt="" width="19" height="24" style="display:block">' +
            '<b style="font-size:15px">Challenge</b>' +
          '</div>' +
          '<p style="font-family:Verdana,Arial,sans-serif;font-size:14px;line-height:1.5;margin:0 0 20px">' + msg + '</p>' +
          '<div style="text-align:center">' +
            '<button id="fd-popin-close" style="width:124px;height:30px;border:0;padding:0 0 2px;background:url(/fb/bouton_popin.png) no-repeat center/100% 100%;font-family:Verdana,Arial,sans-serif;font-weight:bold;font-size:13px;color:#660000;cursor:pointer">Fermer</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    var bt = document.getElementById("fd-popin-close");
    bt.onmousedown = function () { bt.style.transform = "translateY(1px)"; };
    bt.onmouseup = function () { bt.style.transform = ""; };
    bt.onclick = function () { wrap.remove(); };
  }
  function showScreen(name) {
    state.screen = name;
    each(document.querySelectorAll(".screen"), function (s) { s.classList.toggle("on", s.id === "screen-" + name); });
    $("#status").style.display = name === "game" ? "none" : "block";
  }

  // ── Connexion ────────────────────────────────────────────────────────────
  function start() {
    if (!sid) { setStatus("Session manquante (?sid=)."); return; }
    fetch("/api/forum/me?sid=" + encodeURIComponent(sid), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.user) { setStatus("Session invalide."); return; }
        state.user = d.user; state.myBouille = d.bouille || DEFAULT_BOUILLE; connect();
      })
      .catch(function () { setStatus("Réseau indisponible."); });
  }
  function connect() {
    var proto = location.protocol === "https:" ? "wss" : "ws";
    var ws;
    try { ws = new WebSocket(proto + "://" + location.host + "/"); } catch (e) { scheduleReconnect(); return; }
    state.ws = ws;
    ws.onopen = function () {
      setStatus("Identification…");
      state.gotLobby = false; // (re)connexion → on se ré-enregistre au lobby
      send('<k l="' + xml(state.user) + '" s="' + xml(sid) + '" />');
      if (state.helloTimer) clearInterval(state.helloTimer);
      state.helloTimer = setInterval(function () {
        if (state.gotLobby) { clearInterval(state.helloTimer); return; }
        send('<bd a="hello" n="' + xml(state.user) + '" f="' + xml(state.myBouille || DEFAULT_BOUILLE)
          + '" sa="' + xml(state.salle) + '" />');
      }, 600);
    };
    ws.onmessage = function (ev) { onData(ev.data); };
    ws.onclose = function () { if (state.ws !== ws) return; setStatus("Reconnexion…"); scheduleReconnect(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  // Reconnexion automatique. Sur mobile, passer l'app en arrière-plan (ou un
  // creux réseau) ferme la WebSocket de l'iframe ; sans reconnexion le lobby
  // restait affiché mais figé et « Défier » n'envoyait plus rien (socket morte
  // → send() abandonne en silence). On rétablit la connexion, on se ré-identifie
  // et on renvoie « hello » pour réintégrer le lobby (le serveur renvoie l'état
  // de la partie en cours si on jouait).
  var reconnectTimer = null;
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(); }, 1500);
  }
  function send(s) {
    if (state.ws && state.ws.readyState === 1) {
      try { state.ws.send(s + "\0"); return true; } catch (e) {}
    }
    scheduleReconnect(); // socket tombée → on rétablit, l'action sera rejouable
    return false;
  }
  // De retour au premier plan : reconnexion immédiate si la socket est tombée.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && (!state.ws || state.ws.readyState > 1)) {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      connect();
    }
  });
  function bd(a) { var s = "<bd"; for (var k in a) s += " " + k + '="' + xml(a[k]) + '"'; send(s + " />"); }

  var buf = "";
  function onData(data) {
    if (typeof data !== "string") {
      if (data instanceof Blob) { data.text().then(onData); return; }
      try { data = new TextDecoder("utf-8").decode(data); } catch (e) { return; }
    }
    buf += data; var parts = buf.split("\0"); buf = parts.pop();
    parts.forEach(function (p) { p = p.trim(); if (p.indexOf("<bd") === 0) handleBd(p); });
  }
  function handleBd(s) {
    var doc; try { doc = new DOMParser().parseFromString(s, "text/xml"); } catch (e) { return; }
    var el = doc.documentElement; if (!el || el.nodeName !== "bd") return;
    var e = el.getAttribute("e");
    if (e === "lobby") return onLobby(el);
    if (e === "chat") return addChat($("#lobby-chat"), el.getAttribute("u"), el.getAttribute("m"));
    if (e === "gchat") return GV.chatMessage(el.getAttribute("u"), el.getAttribute("m"));
    if (e === "start") return onStart(el);
    if (e === "ev") return onEvent(el);
    if (e === "err") {
      var m = el.getAttribute("m");
      // Refus FD d'un match classé : popin native (pas une simple ligne d'état).
      if (m === "no-fd" || m === "opp-no-fd") { showFdPopin(m); return; }
      setStatus("⚠ " + m); return;
    }
  }

  // ── Lobby ────────────────────────────────────────────────────────────────
  var lobbyPlayers = [], lobbyGames = [], lobbySel = null;
  var SQCLASS = { idle: "SQ-idle", waiting: "SQ-waiting", playing: "SQ-playing" };
  var STATUSLABEL = { idle: "Disponible", waiting: "En attente", playing: "En partie" };
  function onLobby(el) {
    if (!state.gotLobby) {
      state.gotLobby = true;
      setStatus("Connecté — " + state.user);
      if (state.screen === "connect") showScreen("mode");
    }
    // Le serveur dit de quelle salle vient ce lobby : un message adressé à une
    // salle qu'on vient de quitter ne doit pas écraser la liste de la nouvelle.
    var sa = el.getAttribute("sa");
    if (sa && SALLES[sa] && sa !== state.salle) return;
    lobbyPlayers = []; lobbyGames = [];
    each(el.getElementsByTagName("pl"), function (n) {
      lobbyPlayers.push({ u: n.getAttribute("u"), n: n.getAttribute("n"), s: n.getAttribute("s"), f: n.getAttribute("f"), sr: +n.getAttribute("sr") || 0, el: +n.getAttribute("el") || 0, bot: n.getAttribute("bot") === "1" });
    });
    each(el.getElementsByTagName("game"), function (n) {
      lobbyGames.push({ id: n.getAttribute("id"), host: n.getAttribute("host"), c: +n.getAttribute("c"), m: +n.getAttribute("m") });
    });
    // Les compteurs des TROIS bandeaux de l'écran de mode voyagent avec chaque
    // lobby : ils restent justes sans qu'on ait à entrer dans chaque salle.
    each(el.getElementsByTagName("s"), function (n) {
      var k = n.getAttribute("k");
      var j = $('[data-cpt="' + k + '-j"]'), p = $('[data-cpt="' + k + '-p"]');
      if (j) j.textContent = n.getAttribute("j") || "0";
      if (p) p.textContent = n.getAttribute("p") || "0";
    });
    majNote();
    if (state.screen === "lobby") renderLobby();
  }
  // Sa propre note de championnat, sous le bandeau du mode. Elle est envoyée
  // pour chaque joueur quelle que soit la salle : on la lit donc sans avoir à
  // entrer au championnat.
  function majNote() {
    var box = $("#ma-note"); if (!box) return;
    var moi = lobbyPlayers.filter(isMe)[0];
    box.innerHTML = (moi && moi.el) ? "Ta note : <b>" + moi.el + "</b>" : "";
  }
  function findPlayer(uid) { for (var i = 0; i < lobbyPlayers.length; i++) if (lobbyPlayers[i].u === uid) return lobbyPlayers[i]; return null; }
  function renderLobby() {
    var me = lobbyPlayers.filter(isMe)[0];
    $("#btn-create").textContent = (me && me.s === "waiting") ? "Annuler la partie" : "Créer une partie";
    if (lobbySel && !findPlayer(lobbySel)) lobbySel = null;
    renderPlayers(); renderDefis();
    if (isMobile() && $(".lobby-main") && !/\bmt-/.test($(".lobby-main").className)) setLobbyTab(state.lobbyTab || "players");
  }
  function renderPlayers() {
    var box = $("#players"); box.innerHTML = "";
    var playing = 0, waiting = 0;
    lobbyPlayers.forEach(function (p) { if (p.s === "playing") playing++; else if (p.s === "waiting") waiting++; });
    box.appendChild(countRow("SQ-playing", playing + (playing > 1 ? " qui jouent" : " qui joue")));
    box.appendChild(countRow("SQ-waiting", waiting + " en attente"));
    lobbyPlayers.forEach(function (p) {
      if (isMe(p)) return;
      var row = div("pli can" + (lobbySel === p.u ? " sel" : ""));
      row.innerHTML = '<span class="sq ' + (SQCLASS[p.s] || "SQ-idle") + '"></span><span class="nm">' + esc(p.n || p.u) + "</span>";
      row.onclick = function () { selectPlayer(p.u); };
      box.appendChild(row);
    });
  }
  function countRow(sq, label) { var r = div("pcount"); r.innerHTML = '<span class="sq ' + sq + '"></span><span class="nm">' + esc(label) + "</span>"; return r; }
  function selectPlayer(uid) {
    lobbySel = uid;
    $("#panel-defis").classList.remove("collapsed");
    renderPlayers(); renderDefis();
    if (isMobile()) setLobbyTab("defis");
  }
  function renderDefis() {
    var p = lobbySel ? findPlayer(lobbySel) : null;
    var title = $("#defis-title"), body = $("#defis-body"), foot = $("#defis-foot");
    if (!p) {
      title.textContent = "Liste des défis";
      body.innerHTML = '<div class="defis-empty">Clique sur un joueur dans la liste de droite pour voir son statut et le défier.</div>';
      foot.innerHTML = '<span class="arrow" data-col="defis" title="Replier">»</span>';
      return;
    }
    var name = p.n || p.u;
    // Au championnat, le nombre entre parenthèses est la NOTE de l'adversaire
    // (c'est elle qui dit ce qu'on a à gagner ou à perdre) ; ailleurs, sa série.
    title.textContent = "Liste des défis de " + name
      + " (" + (state.salle === "champ" ? (p.el || 0) : (p.sr || 0)) + ")";
    body.innerHTML = '<div class="defis-status"><span class="sq ' + (SQCLASS[p.s] || "SQ-idle") + '"></span>' + esc(STATUSLABEL[p.s] || "Disponible") + "</div>";
    foot.innerHTML = "";
    var btn = document.createElement("button"); btn.className = "btn-defier";
    if (p.s === "idle") { btn.textContent = "Défier " + name; btn.onclick = function () { bd({ a: "challenge", u: p.u }); }; }
    else if (p.s === "waiting") {
      var g = lobbyGames.filter(function (x) { return x.host === p.u; })[0];
      if (g) { btn.textContent = "Rejoindre " + name; btn.onclick = function () { bd({ a: "join", g: g.id }); }; }
      else { btn.textContent = "Défier " + name; btn.disabled = true; }
    } else { btn.textContent = name + " est en partie"; btn.disabled = true; }
    foot.appendChild(btn);
    var arr = document.createElement("span"); arr.className = "arrow"; arr.setAttribute("data-col", "defis"); arr.setAttribute("title", "Replier"); arr.textContent = "»"; foot.appendChild(arr);
  }
  function collapsePanel(name) { var el = $("#panel-" + name); if (el) el.classList.add("collapsed"); if (name === "defis") { lobbySel = null; renderPlayers(); } }
  function expandPanel(name) { var el = $("#panel-" + name); if (el) el.classList.remove("collapsed"); if (name === "defis") renderDefis(); }
  $(".lobby-main").addEventListener("click", function (ev) {
    var t = ev.target;
    var exp = t.getAttribute && t.getAttribute("data-exp"); if (exp) { expandPanel(exp); return; }
    var col = t.getAttribute && t.getAttribute("data-col"); if (col) { collapsePanel(col); return; }
  });
  function isMobile() { return window.innerWidth <= 760; }
  function setLobbyTab(t) {
    state.lobbyTab = t;
    var m = $(".lobby-main"); if (m) m.className = "lobby-main mt-" + t;
    each(document.querySelectorAll(".lobby-tabs button"), function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === t); });
    if (t === "defis") { var pd = $("#panel-defis"); if (pd) pd.classList.remove("collapsed"); renderDefis(); }
  }
  each(document.querySelectorAll(".lobby-tabs button"), function (b) { b.addEventListener("click", function () { setLobbyTab(b.getAttribute("data-tab")); }); });
  // Les trois salles. Entrer, c'est demander au serveur de nous y déplacer
  // (`a="room"`) puis ouvrir le lobby — on ne voit que les gens de sa salle.
  each(document.querySelectorAll(".mode[data-salle]"), function (m) {
    m.onclick = function () { entrerSalle(m.getAttribute("data-salle")); };
  });
  function entrerSalle(salle) {
    if (!SALLES[salle]) salle = SALLE_DEFAUT;
    if (salle !== state.salle) {
      state.salle = salle;
      try { localStorage.setItem("bandas.salle", salle); } catch (e) {}
      lobbyPlayers = []; lobbyGames = [];
      bd({ a: "room", sa: salle });
    }
    $("#lobby-title").textContent = SALLES[salle].titre;
    lobbySel = null;
    $("#panel-defis").classList.add("collapsed");
    showScreen("lobby");
    renderLobby();
    bd({ a: "list" });
  }
  $("#lobby-back").onclick = function () { showScreen("mode"); };
  $("#btn-create").onclick = function () {
    var me = lobbyPlayers.filter(isMe)[0];
    if (me && me.s === "waiting") bd({ a: "part" }); else bd({ a: "create" });
  };
  $("#lobby-send").onclick = sendLobbyChat;
  $("#lobby-say").addEventListener("keydown", function (e) { if (e.key === "Enter") sendLobbyChat(); });
  function sendLobbyChat() { var i = $("#lobby-say"); if (i.value.trim()) { bd({ a: "say", m: i.value.trim() }); i.value = ""; } }

  var NICKCOL = ["#ffe14d", "#8cdb4b", "#7fb4ff", "#ff9ed0", "#ffd089", "#9be0e0", "#d6a8ff"];
  function colorFor(n) { var h = 0; n = n || ""; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0; return NICKCOL[Math.abs(h) % NICKCOL.length]; }
  function addChat(log, user, msg) {
    if (!log) return;
    var atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    var ln = div("ln");
    ln.innerHTML = '<span class="nk" style="color:' + colorFor(user) + '">' + esc(user) + " &gt;</span> " + esc(msg);
    log.appendChild(ln);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  // ── Partie ───────────────────────────────────────────────────────────────
  function onStart(el) {
    state.inGame = true;
    showScreen("game");
    GV.start(el, state.user);
  }
  function onEvent(el) {
    if (!state.inGame) return;
    GV.pushEvent(el);
  }

  GV.send = function (a) { bd(a); };
  GV.onQuit = function () {
    bd({ a: "part" });
    // l'événement end reviendra du serveur ; en mode challenge l'abandon ferme le jeu
  };
  GV.onEndClosed = function () {
    var mine = GV.winner === GV.myTeam;
    state.inGame = false;
    GV.started = false;
    GV.stopMusic();
    document.body.classList.remove("chat-open", "sheet-open");
    // CHALLENGE : gagnant → retour au lobby (la série continue), perdant →
    // écran d'accueil. C'est le mode « une vie » du jeu d'origine — Manager.as
    // n'y quitte même pas proprement son salon (`quit()` saute `partGame`), et
    // une défaite renvoie à l'accueil (`hardReboot`).
    // CHAMPIONNAT et AMICAL : on reste dans sa salle quoi qu'il arrive, c'est
    // ce qui permet d'enchaîner les manches d'un même match.
    var reste = mine || state.salle !== "chall";
    showScreen(reste ? "lobby" : "mode");
    if (reste) renderLobby();
    bd({ a: "list" });
  };

  GV.init();
  if (!window.Bandas || !window.Bandas.engine) setStatus("Moteur indisponible (engine.js).");
  else start();
})();
