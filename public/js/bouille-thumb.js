/*
  FPBouilleThumb — miniatures de bouilles rapides via le cache PNG du serveur.

  Pourquoi : la grille du Bouilloscope (jusqu'à 48 vignettes) affichait chaque
  bouille avec une <iframe> /bouille-preview.html, soit AUTANT d'instances Ruffle
  (WASM) à la fois. Acceptable sur le forum (~10 avatars), mais sur main.swf ces
  instances entrent en concurrence avec le lourd SWF du bureau → chargement très
  lent.

  Solution : chaque vignette est une simple <img> pointant sur /bouille-img (cache
  PNG disque, déjà existant). En cache → image statique instantanée, ZÉRO Ruffle.
  En cache absent (probe nocapture=1 → 404) → on « réchauffe » l'entrée via UNE
  iframe /bouille-capture cachée (elle rend la bouille via Ruffle, capture le
  canvas, le POST dans le cache, puis postMessage {__bouilleCapture:'ok'} au
  parent). On échange alors la <img> vers le PNG désormais en cache. La capture
  est faite UNE fois pour toutes (cache partagé entre tous les visiteurs), avec au
  plus CONCURRENCY captures simultanées — bien plus léger que 48 lecteurs Ruffle.

  Rendu identique au forum : le PNG est une capture du même rendu Ruffle (même
  SWF de famille, même quality:"high", même fond).
*/
(function (global) {
  "use strict";

  var SIZE = 160;            // résolution capture & cache (boîte affichée ~72px)
  var CONCURRENCY = 2;       // iframes de capture simultanées pour le cache froid
  var CAPTURE_TIMEOUT = 16000; // garde-fou > watchdog 14s de bouille-capture.html

  function sanitize(s) {
    var ss = String(s == null ? "" : s).replace(/[^0-9A-Za-z]/g, "").slice(0, 24);
    return ss.length >= 2 ? ss : "000000010000000000000000";
  }
  function normEmote(e) { return (e != null && Number(e) > 0) ? String(Number(e)) : "0"; }

  function imgUrl(s, e, probe) {
    return "/bouille-img?s=" + encodeURIComponent(s) + "&e=" + encodeURIComponent(e)
      + "&size=" + SIZE + "&fmt=png" + (probe ? "&nocapture=1" : "");
  }
  function captureUrl(s, e) {
    return "/bouille-capture?s=" + encodeURIComponent(s) + "&e=" + encodeURIComponent(e)
      + "&size=" + SIZE + "&fmt=png";
  }

  // HTML d'une vignette : une <img> qui sonde le cache (nocapture=1).
  //   HIT  → 200, l'image s'affiche immédiatement (aucun Ruffle) ;
  //   MISS → 404, onerror déclenche une capture ponctuelle (ci-dessous).
  function imgHtml(s, e) {
    var ss = sanitize(s), ee = normEmote(e);
    return '<img class="fp-bthumb" loading="lazy" decoding="async" alt=""'
      + ' data-s="' + ss + '" data-e="' + ee + '"'
      + ' src="' + imgUrl(ss, ee, true) + '"'
      + ' onerror="window.FPBouilleThumb&&FPBouilleThumb._miss(this)"'
      + ' onload="window.FPBouilleThumb&&FPBouilleThumb._ok(this)"'
      + ' style="width:100%;height:100%;object-fit:contain;display:block">';
  }

  // ── réchauffage du cache froid ───────────────────────────────────────────
  var queue = [];            // [{s,e}] à capturer
  var waiting = {};          // s -> [img,...] en attente de leur PNG
  var queued = {};           // s -> true (déjà en file/actif), évite les doublons
  var active = 0;
  var frames = [];           // toutes les iframes de capture créées (pool + occupées)

  function idleFrame() {
    for (var i = 0; i < frames.length; i++) if (!frames[i]._job) return frames[i];
    var f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
    f.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(f); frames.push(f); return f;
  }

  function onMiss(img) {
    var s = img.getAttribute("data-s"), e = img.getAttribute("data-e") || "0";
    if (!s) return;
    img.onerror = null;                  // ne pas boucler sur le 404
    img.style.visibility = "hidden";     // masquer l'icône « image cassée »
    (waiting[s] = waiting[s] || []).push(img);
    if (!queued[s]) { queued[s] = true; queue.push({ s: s, e: e }); pump(); }
  }

  function onOk(img) { img.style.visibility = "visible"; }

  function pump() {
    while (active < CONCURRENCY && queue.length) { active++; run(queue.shift()); }
  }

  function run(job) {
    var f = idleFrame();
    var settled = false;
    var timer = setTimeout(function () { settle(false); }, CAPTURE_TIMEOUT);
    function settle(ok) {
      if (settled) return; settled = true;
      clearTimeout(timer); f._job = null; active--;
      // Vider l'iframe : sinon le SWF de famille continue de tourner dans Ruffle
      // en arrière-plan (CPU gaspillé) entre deux captures.
      try { f.src = "about:blank"; } catch (e) {}
      var imgs = waiting[job.s] || []; delete waiting[job.s]; delete queued[job.s];
      for (var i = 0; i < imgs.length; i++) resolveImg(imgs[i], job, ok);
      pump();
    }
    f._job = { s: job.s, settle: settle };
    f.src = captureUrl(job.s, job.e);
  }

  function resolveImg(img, job, ok) {
    if (!img.isConnected) return;
    if (ok) {
      img.onload = function () { img.style.visibility = "visible"; };
      img.src = imgUrl(job.s, job.e, false);   // en cache désormais → 200
    } else {
      // Capture en échec → iframe de preview live pour ne jamais laisser un vide.
      var box = img.parentNode; if (!box) return;
      var ifr = document.createElement("iframe");
      ifr.src = "/bouille-preview.html?s=" + encodeURIComponent(job.s) + (job.e !== "0" ? "&e=" + encodeURIComponent(job.e) : "");
      ifr.loading = "lazy"; ifr.setAttribute("sandbox", "allow-scripts allow-same-origin");
      ifr.style.cssText = "width:100%;height:100%;border:0;display:block";
      box.replaceChild(ifr, img);
    }
  }

  // bouille-capture.html (en iframe) signale la fin via postMessage. Il renvoie
  // `s` (le code 24c assaini) mais pas `e` — or le Bouilloscope n'utilise pas
  // d'humeur (e=0), donc l'appariement par `s` suffit.
  global.addEventListener("message", function (ev) {
    var d = ev && ev.data; if (!d || !d.__bouilleCapture) return;
    for (var i = 0; i < frames.length; i++) {
      var j = frames[i]._job;
      if (j && j.s === d.s) { j.settle(d.__bouilleCapture === "ok"); return; }
    }
  });

  global.FPBouilleThumb = { imgHtml: imgHtml, _miss: onMiss, _ok: onOk, SIZE: SIZE };
})(window);
