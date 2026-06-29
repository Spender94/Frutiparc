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
  // base62 : 0-9 → 0-9, a-z → 10-35, A-Z → 36-61 (aligné sur decode62 du SWF).
  function dec(c) {
    if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
    if (c >= "a" && c <= "z") return c.charCodeAt(0) - 87;
    if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 29;
    return 0;
  }

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

  function statusUrl(s, e) {
    return "/api/bouille-img/status?s=" + encodeURIComponent(s) + "&e=" + encodeURIComponent(e)
      + "&size=" + SIZE + "&fmt=png";
  }

  // ── familles disponibles ───────────────────────────────────────────────────
  // Seules certaines familles ont un SWF patché (/fbouille_patched/familleN.swf).
  // Une bouille d'une famille ABSENTE ne peut PAS être rendue : on évite alors la
  // capture (qui échouerait en boucle et ferait planter le réchauffage) et on
  // affiche une vignette « ? » neutre. La liste vient de /api/bouille-families.
  var FALLBACK_FAMILIES = [0, 10, 11, 12, 13, 14, 15, 16, 23, 24];
  var families = null; // Set | null (null = pas encore chargé → on tente)
  var familiesLoading = null;
  function loadFamilies() {
    if (familiesLoading) return familiesLoading;
    familiesLoading = fetch("/api/bouille-families", { cache: "force-cache" })
      .then(function (r) { return r.json(); })
      .then(function (d) { families = setOf((d && d.families) || FALLBACK_FAMILIES); })
      .catch(function () { families = setOf(FALLBACK_FAMILIES); });
    return familiesLoading;
  }
  function setOf(arr) { var o = {}; for (var i = 0; i < arr.length; i++) o[arr[i]] = 1; return o; }
  // Famille = 1er caractère base62 (0-9 → 0-9, a-o → 10-24). Lire 2 caractères
  // donnait famille×62 (ex. "10" → 62) et ne marchait que pour la famille 0.
  function familyOf(s) { s = sanitize(s); return dec(s.charAt(0)); }
  function renderable(s) { return families ? !!families[familyOf(s)] : true; }
  loadFamilies();

  // Vignette « ? » (famille indisponible ou capture impossible) — data-URI, léger.
  var PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#E8F8D3"/>'
    + '<text x="36" y="48" font-size="34" text-anchor="middle" fill="#bcd0a0" font-family="Verdana,Arial,sans-serif">?</text></svg>');

  // ── pool de capture (iframes /bouille-capture cachées) ─────────────────────
  // Concurrence faible + recyclage périodique des iframes : sans ça, des milliers
  // de captures accumulent la mémoire WASM de Ruffle et finissent par faire
  // planter l'onglet. On détruit les iframes tous les RECYCLE_EVERY pour la libérer.
  var CONC = CONCURRENCY;
  var RECYCLE_EVERY = 24;    // détruit les iframes après N captures (flush mémoire)
  var GAP_MS = 35;           // petite pause entre captures (laisse respirer le GC/UI)
  var pending = [];          // [{s,e,cb}] captures en attente
  var activeCaps = 0;
  var capCount = 0;          // captures depuis le dernier recyclage
  var frames = [];           // iframes de capture (pool + occupées)

  function idleFrame() {
    for (var i = 0; i < frames.length; i++) if (!frames[i]._job) return frames[i];
    var f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
    f.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(f); frames.push(f); return f;
  }
  function destroyFrames() {
    for (var i = 0; i < frames.length; i++) { try { frames[i].src = "about:blank"; if (frames[i].parentNode) frames[i].parentNode.removeChild(frames[i]); } catch (e) {} }
    frames = [];
  }
  function maybeRecycle() { if (activeCaps === 0 && capCount >= RECYCLE_EVERY) { capCount = 0; destroyFrames(); } }
  function setConcurrency(n) { CONC = Math.max(1, (n | 0) || 1); pumpCaps(); }
  function capture(s, e, cb) { pending.push({ s: sanitize(s), e: normEmote(e), cb: cb }); pumpCaps(); }
  function pumpCaps() { while (activeCaps < CONC && pending.length) { activeCaps++; runCap(pending.shift()); } }
  function runCap(job) {
    var f = idleFrame();
    var settled = false;
    var timer = setTimeout(function () { settle(false); }, CAPTURE_TIMEOUT);
    function settle(ok) {
      if (settled) return; settled = true;
      clearTimeout(timer); f._job = null; activeCaps--; capCount++;
      try { f.src = "about:blank"; } catch (e) {}  // stoppe le SWF entre deux captures
      try { job.cb(ok); } catch (e) {}
      maybeRecycle();
      // petite pause avant la suivante : libère le thread, aide le GC
      setTimeout(pumpCaps, GAP_MS);
    }
    f._job = { s: job.s, settle: settle };
    f.src = captureUrl(job.s, job.e);
  }
  // bouille-capture.html (en iframe) signale la fin via postMessage (`s` = code 24c).
  global.addEventListener("message", function (ev) {
    var d = ev && ev.data; if (!d || !d.__bouilleCapture) return;
    for (var i = 0; i < frames.length; i++) {
      var j = frames[i]._job;
      if (j && j.s === d.s) { j.settle(d.__bouilleCapture === "ok"); return; }
    }
  });

  // ── réchauffage à la volée (vignette dont la sonde a fait 404) ─────────────
  var waiting = {};          // s -> [img,...] en attente de leur PNG
  var queued = {};           // s -> true (déjà en capture), évite les doublons
  function onMiss(img) {
    var s = img.getAttribute("data-s"), e = img.getAttribute("data-e") || "0";
    if (!s) return;
    img.onerror = null;                  // ne pas boucler sur le 404
    if (!renderable(s)) { img.src = PLACEHOLDER; img.style.visibility = "visible"; return; } // famille indisponible
    img.style.visibility = "hidden";     // masquer l'icône « image cassée »
    (waiting[s] = waiting[s] || []).push(img);
    if (queued[s]) return;
    queued[s] = true;
    capture(s, e, function (ok) {
      var imgs = waiting[s] || []; delete waiting[s]; delete queued[s];
      var job = { s: sanitize(s), e: normEmote(e) };
      for (var i = 0; i < imgs.length; i++) resolveImg(imgs[i], job, ok);
    });
  }
  function onOk(img) { img.style.visibility = "visible"; }
  function resolveImg(img, job, ok) {
    if (!img.isConnected) return;
    if (ok) {
      img.onload = function () { img.style.visibility = "visible"; };
      img.src = imgUrl(job.s, job.e, false);   // en cache désormais → 200
    } else {
      // Capture en échec → vignette « ? » (léger). On NE relance PAS d'iframe live :
      // ça surchargerait et échouerait pareil.
      img.onerror = null; img.src = PLACEHOLDER; img.style.visibility = "visible";
    }
  }

  // ── pré-réchauffage en masse (admin) ───────────────────────────────────────
  // Remplit le cache PNG pour une liste : saute les bouilles déjà en cache (sonde
  // /status, gratuit) ET celles dont la famille n'a pas de SWF (non rendables),
  // puis capture le reste (concurrence faible + recyclage mémoire → ne plante pas).
  // onProgress(done, total, {skipped, unsupported, failed}).
  function warmAll(items, opts) {
    opts = opts || {};
    if (opts.concurrency) setConcurrency(opts.concurrency);
    var retries = (opts.retries != null) ? opts.retries : 1;
    return (families ? Promise.resolve() : loadFamilies()).then(function () {
      var raw = (items || []).map(function (it) {
        return (typeof it === "string") ? { s: sanitize(it), e: "0" }
          : { s: sanitize(it.s != null ? it.s : it.bouille), e: normEmote(it.e) };
      });
      var list = [], unsupported = 0;
      for (var k = 0; k < raw.length; k++) { if (renderable(raw[k].s)) list.push(raw[k]); else unsupported++; }
      var total = list.length, i = 0, done = 0, okN = 0, skipped = 0, failed = 0, running = 0;
      function report() { if (opts.onProgress) { try { opts.onProgress(done, total, { skipped: skipped, unsupported: unsupported, failed: failed }); } catch (e) {} } }
      report();
      return new Promise(function (resolve) {
        if (!total) { resolve({ total: 0, captured: 0, skipped: 0, unsupported: unsupported, failed: 0 }); return; }
        function finishItem(kind) {
          if (kind === 'skip') skipped++; else if (kind === 'ok') okN++; else failed++;
          running--; done++; report(); step();
        }
        function attempt(job, left) {
          capture(job.s, job.e, function (cok) {
            if (cok) finishItem('ok');
            else if (left > 0) attempt(job, left - 1);
            else finishItem('fail');
          });
        }
        function step() {
          if (i >= total && running === 0) { resolve({ total: total, captured: okN, skipped: skipped, unsupported: unsupported, failed: failed }); return; }
          while (running < CONC && i < total) {
            (function (job) {
              running++;
              fetch(statusUrl(job.s, job.e), { cache: "no-store" })
                .then(function (r) { return r.json(); })
                .then(function (d) { if (d && d.cached) finishItem('skip'); else attempt(job, retries); })
                .catch(function () { attempt(job, retries); });
            })(list[i++]);
          }
        }
        step();
      });
    });
  }

  global.FPBouilleThumb = { imgHtml: imgHtml, warmAll: warmAll, setConcurrency: setConcurrency, loadFamilies: loadFamilies, _miss: onMiss, _ok: onOk, SIZE: SIZE };
})(window);
