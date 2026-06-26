// Réchauffe le cache des miniatures de bouilles pour une grille (trombinoscope).
//
// /bouille-img renvoie le PNG s'il est déjà en cache, SINON il redirige (302)
// vers /bouille-capture (une page HTML) — donc un <img src="/bouille-img…">
// direct casse tant que le cache est vide. La page de capture est faite pour
// être pilotée dans un iframe caché : elle rend la bouille via Ruffle, POSTe le
// PNG (/api/bouille-img) puis remplit le cache. Ici on enfile les codes, on en
// réchauffe quelques-uns à la fois, on attend que le cache se remplisse
// (/api/bouille-img/status) et on affiche enfin le PNG. Une fois en cache, c'est
// instantané pour tous les visiteurs suivants.
(function () {
  "use strict";
  var queue = [], active = 0, PAR = 3, TIMEOUT_MS = 16000;
  function statusUrl(code, size, fmt) { return "/api/bouille-img/status?s=" + encodeURIComponent(code) + "&fmt=" + fmt + "&size=" + size; }
  function imgUrl(code, size, fmt) { return "/bouille-img?s=" + encodeURIComponent(code) + "&fmt=" + fmt + "&size=" + size; }
  function pump() { while (active < PAR && queue.length) { var j = queue.shift(); active++; run(j); } }
  function settle(j, okk) { active--; try { j.cb(okk); } catch (e) {} pump(); }
  function run(j) {
    fetch(statusUrl(j.code, j.size, j.fmt), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.cached) settle(j, true); else warm(j); })
      .catch(function () { warm(j); });
  }
  function warm(j) {
    var ifr = document.createElement("iframe");
    ifr.setAttribute("aria-hidden", "true"); ifr.tabIndex = -1;
    ifr.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:" + (j.size + 8) + "px;height:" + (j.size + 8) + "px;border:0;visibility:hidden";
    var fin = false, poll = null, to = null;
    function finish(okk) { if (fin) return; fin = true; if (poll) clearInterval(poll); if (to) clearTimeout(to); try { ifr.remove(); } catch (e) {} settle(j, okk); }
    ifr.src = "/bouille-capture?s=" + encodeURIComponent(j.code) + "&fmt=" + j.fmt + "&size=" + j.size;
    (document.body || document.documentElement).appendChild(ifr);
    poll = setInterval(function () {
      fetch(statusUrl(j.code, j.size, j.fmt), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.cached) finish(true); })
        .catch(function () {});
    }, 600);
    to = setTimeout(function () { finish(false); }, TIMEOUT_MS);
  }
  // Affiche la bouille `code` dans l'élément <img> fourni, en réchauffant le
  // cache au besoin. cb optionnel(okk) appelé à la fin.
  window.showBouilleThumb = function (img, code, size, fmt, cb) {
    size = size || 64; fmt = fmt || "png";
    queue.push({ code: code, size: size, fmt: fmt, cb: function (okk) {
      if (img) { if (okk) img.src = imgUrl(code, size, fmt); else img.style.visibility = "hidden"; }
      if (cb) cb(okk);
    } });
    pump();
  };
  window.bouilleImgUrl = imgUrl;
})();
