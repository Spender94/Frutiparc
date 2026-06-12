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

  var state = {
    ws: null, user: "", myBouille: "", gotLobby: false, screen: "connect",
    inGame: false, helloTimer: null, lobbyTab: "players",
  };
  function setStatus(s) { $("#status").textContent = s; }
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
    var ws = new WebSocket(proto + "://" + location.host + "/"); state.ws = ws;
    ws.onopen = function () {
      setStatus("Identification…");
      send('<k l="' + xml(state.user) + '" s="' + xml(sid) + '" />');
      state.helloTimer = setInterval(function () {
        if (state.gotLobby) { clearInterval(state.helloTimer); return; }
        send('<bd a="hello" n="' + xml(state.user) + '" f="' + xml(state.myBouille || DEFAULT_BOUILLE) + '" />');
      }, 600);
    };
    ws.onmessage = function (ev) { onData(ev.data); };
    ws.onclose = function () { setStatus("Connexion perdue."); };
    ws.onerror = function () { setStatus("Erreur de connexion."); };
  }
  function send(s) { try { if (state.ws && state.ws.readyState === 1) state.ws.send(s + "\0"); } catch (e) {} }
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
    if (e === "err") { setStatus("⚠ " + el.getAttribute("m")); return; }
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
    lobbyPlayers = []; lobbyGames = [];
    each(el.getElementsByTagName("pl"), function (n) {
      lobbyPlayers.push({ u: n.getAttribute("u"), n: n.getAttribute("n"), s: n.getAttribute("s"), f: n.getAttribute("f"), sr: +n.getAttribute("sr") || 0, bot: n.getAttribute("bot") === "1" });
    });
    each(el.getElementsByTagName("game"), function (n) {
      lobbyGames.push({ id: n.getAttribute("id"), host: n.getAttribute("host"), c: +n.getAttribute("c"), m: +n.getAttribute("m") });
    });
    $("#ch-j").textContent = lobbyPlayers.length;
    $("#ch-p").textContent = lobbyGames.length;
    if (state.screen === "lobby") renderLobby();
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
    title.textContent = "Liste des défis de " + name + " (" + (p.sr || 0) + ")";
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
  $("#mode-chall").onclick = function () { lobbySel = null; $("#panel-defis").classList.add("collapsed"); showScreen("lobby"); renderLobby(); };
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
    // gagnant → retour au lobby (la série continue) ; perdant/égalité → écran d'accueil
    showScreen(mine ? "lobby" : "mode");
    if (mine) renderLobby();
    bd({ a: "list" });
  };

  GV.init();
  if (!window.Bandas || !window.Bandas.engine) setStatus("Moteur indisponible (engine.js).");
  else start();
})();
