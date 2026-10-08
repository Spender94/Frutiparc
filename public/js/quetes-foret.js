/*
 * LA FORÊT DE GROMELIN — le haut de la fenêtre des quêtes.
 *
 * Rien de dessiné ici : c'est le paysage de l'écran-titre de MiniPixiz, recomposé
 * pièce à pièce depuis ses sprites (un extrait, minipixiz/sprites/foret.json,
 * produit par scripts/extraire-foret.js) :
 *   · le CIEL de l'heure qu'il est (cent une images, de minuit à minuit) ;
 *   · les NEUF PLANS du menu (horizon, collines, forêts, arbre, herbes…), avec
 *     leurs lieux à leurs ancrages — la cabane de Gromelin, l'arbre creux, le
 *     moulin, le donjon — et le voile de nuit du jeu, plus fort au loin ;
 *   · deux NUAGES qui dérivent ;
 *   · GROMELIN, celui de l'écran de mission de Pixiz (bras croisés), qui sort
 *     des herbes devant sa cabane : posé entre l'arbre et l'herbe, il a le bas
 *     caché par les herbes et le bord de la scène ;
 *   · sa PAROLE est écrite sur une feuille du courrier de Pixiz (la bulle
 *     .qt-dit de quetes-light.js, posée dans la scène), reliée à lui par trois
 *     bulles de fée.
 *
 * La scène se cale sur la largeur de la fenêtre (feuille mobile ou fenêtre du
 * bureau) et se redessine quand elle change.
 */
(function (global) {
  'use strict';

  var SPR = '/minipixiz/sprites/';
  var PLANS = [['horizon', 0.25], ['collines', 0.35], ['foret3', 0.45], ['foret2', 0.52], ['foret', 0.9],
    ['milieu', 1.1], ['arbre', 1.5], ['herbe', 1.8], ['premier', 3.2]];
  // Les lieux accrochés à un plan : [symbole, ancrage, échelle forcée].
  var LIEUX = { foret: [['mCabane', 'house', 1.5]], milieu: [['mArbre', 'tree']],
    collines: [['mMoulin', 'windMill', 0.704], ['mDonjon', 'dungeon']] };
  var GROMELIN = { src: SPR + 'shape990.svg', l: 303.15, h: 284.7, redresse: 12 };
  var BULLE = SPR + 'shape764.svg';

  var donnees = null, promesse = null;
  var heureForcee = null;   // les captures et les tests fixent l'heure
  function charger() {
    if (donnees) return Promise.resolve(donnees);
    if (!promesse) {
      promesse = fetch(SPR + 'foret.json').then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (d) { donnees = d; promesse = null; return d; });
    }
    return promesse;
  }

  // ── Les calculs (purs, testés) ─────────────────────────────────────────────
  /** Le cadrage pour une largeur : hauteur, échelle, haut du paysage, regard. */
  function cadre(L) {
    var etroit = L < 450;
    var H = etroit ? 200 : 230;
    // Unités de décor visibles en largeur ; les plans font environ 420 de large.
    var large = Math.min(410, etroit ? 300 : 400);
    var k = L / large;
    return { L: L, H: H, k: k, y0: 240 - H / k, xm: 20, etroit: etroit, gromelin: etroit ? 130 : 160 };
  }
  /** L'image du ciel (1 à 101) pour une heure de la journée (0 à 24). */
  function ciel(heure) {
    var f = Math.max(1, Math.min(101, Math.floor(heure / 24 * 100) + 1));
    return SPR + 'ciel/ciel' + ('00' + f).slice(-3) + '.svg';
  }
  /** La nuit, de 0 (midi) à 1 (minuit). */
  function nuitDe(heure) { return Math.abs(heure / 24 - 0.5) * 2; }
  /** Le voile de nuit de MiniPixiz pour un plan de coefficient c : max(80 − 30c, 30) % du bleu nuit. */
  function voile(c, nuit) {
    var p = Math.max(80 - c * 30, 30) * nuit / 100;
    return p > 0.02 ? 'brightness(' + (1 - p * 0.7).toFixed(3) + ') saturate(' + (1 - p * 0.5).toFixed(3) + ') hue-rotate(' + (p * 15).toFixed(1) + 'deg)' : '';
  }

  // ── Les sprites en DOM ─────────────────────────────────────────────────────
  function piece(p) {
    var img = document.createElement('img');
    img.src = SPR + p.fichier;
    img.alt = '';
    img.style.cssText = 'position:absolute;left:0;top:0;width:' + p.vb[2] + 'px;height:' + p.vb[3] + 'px;max-width:none;'
      + 'transform-origin:0 0;transform:matrix(' + p.m.join(',') + ') translate(' + p.vb[0] + 'px,' + p.vb[1] + 'px)';
    return img;
  }
  function boite(e) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    e.pieces.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  /** Un symbole entier, à l'échelle k, dans une boîte à sa taille. */
  function symbole(nom, frame, k) {
    var v = donnees && donnees[nom];
    if (!v) return null;
    var e = v.etats.filter(function (x) { return x.frame === frame; })[0] || v.etats[0];
    var b = boite(e);
    var d = document.createElement('div');
    d.className = 'qt-mp';
    d.style.cssText = 'position:relative;width:' + (b.w * k) + 'px;height:' + (b.h * k) + 'px';
    var dedans = document.createElement('div');
    dedans.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;transform:scale(' + k + ') translate(' + (-b.x) + 'px,' + (-b.y) + 'px)';
    e.pieces.forEach(function (p) { dedans.appendChild(piece(p)); });
    d.appendChild(dedans);
    return d;
  }

  // ── La scène ───────────────────────────────────────────────────────────────
  function decor(el) { el.setAttribute('data-decor', ''); return el; }
  function heureLocale() { var d = new Date(); return d.getHours() + d.getMinutes() / 60; }

  /**
   * Dessine (ou redessine) la forêt dans `scene`, en gardant ce qui n'est pas
   * du décor (la feuille de Gromelin). `opts.heure` force l'heure (tests, captures).
   */
  function dessiner(scene, opts) {
    var o = opts || {};
    var L = scene.clientWidth;
    if (!L) return;
    var C = cadre(L);
    var heure = o.heure != null ? o.heure : heureForcee != null ? heureForcee : heureLocale();
    var nuit = nuitDe(heure);
    scene.style.height = C.H + 'px';
    scene.classList.toggle('etroite', C.etroit);
    scene.classList.toggle('nuit', nuit > 0.6);
    scene._qtLargeur = L;
    Array.prototype.slice.call(scene.querySelectorAll('[data-decor]')).forEach(function (x) { x.remove(); });
    var avant = scene.firstChild;
    var poser = function (el) { scene.insertBefore(decor(el), avant); return el; };

    var c = document.createElement('img');
    c.className = 'qt-ciel'; c.alt = ''; c.src = ciel(heure);
    poser(c);
    if (donnees) {
      [[1, 0.04, 46, 0.9], [3, 0.41, 60, 0.55]].forEach(function (n) {
        var d = symbole('nuage', n[0], n[3] * C.k / 2);
        if (!d) return;
        d.className = 'qt-nuage';
        d.style.left = Math.round(n[1] * L) + 'px'; d.style.top = n[2] + 'px';
        d.style.opacity = Math.max(0.15, 1 - nuit * 0.5);
        poser(d);
      });
    }
    var gro = document.createElement('div');
    gro.className = 'qt-gromelin';
    var gh = C.gromelin, gw = gh * GROMELIN.l / GROMELIN.h;
    gro.innerHTML = '<img src="' + GROMELIN.src + '" alt="Gromelin">';
    gro.style.width = gw + 'px'; gro.style.height = gh + 'px';
    gro.style.top = Math.round(C.H - gh * 0.62) + 'px';
    var f = voile(1.5, nuit);
    if (f) gro.style.filter = f;
    var cabane = null;
    PLANS.forEach(function (pl) {
      var cle = pl[0], k = pl[1];
      // Gromelin juste devant l'arbre, juste derrière les herbes.
      if (cle === 'herbe') poser(gro);
      if (!donnees || !donnees[cle]) return;
      var w = document.createElement('div');
      w.className = 'qt-plan';
      w.style.transform = 'scale(' + C.k + ') translate(' + (-C.xm * k) + 'px,' + (-C.y0) + 'px)';
      donnees[cle].etats[0].pieces.forEach(function (p) { w.appendChild(piece(p)); });
      (LIEUX[cle] || []).forEach(function (li) {
        var a = (donnees[cle].ancrages || {})[li[1]], s = donnees[li[0]];
        if (!a || !s) return;
        var g = document.createElement('div');
        g.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(' + a.x + 'px,' + a.y + 'px) scale(' + (li[2] || a.k || 1) + ')';
        s.etats[0].pieces.forEach(function (p) { g.appendChild(piece(p)); });
        if (li[0] === 'mCabane') {
          // Le bord droit de la cabane, en pixels de scène.
          var b = boite(s.etats[0]);
          cabane = ((a.x + (b.x + b.w) * li[2]) - C.xm * k) * C.k;
        }
        w.appendChild(g);
      });
      var v = voile(k, nuit);
      if (v) w.style.filter = v;
      poser(w);
    });
    // Gromelin se tient juste à droite de sa cabane, qui reste visible.
    gro.style.left = Math.round(cabane != null ? cabane + gw * 0.1 : L * 0.12) + 'px';
    placerLettre(scene);
  }

  /** La feuille de Gromelin à sa droite, et les bulles de fée de sa tête à la feuille. */
  function placerLettre(scene) {
    var lettre = scene.querySelector('.qt-dit');
    var gro = scene.querySelector('.qt-gromelin');
    if (!lettre || !gro) return;
    Array.prototype.slice.call(scene.querySelectorAll('.qt-bulle-fee')).forEach(function (x) { x.remove(); });
    var gl = gro.offsetLeft, gt = gro.offsetTop, gw = gro.offsetWidth, gh = gro.offsetHeight;
    lettre.style.left = Math.round(gl + gw * 0.82) + 'px';
    // Le dessin est redressé autour de ses pieds : le crâne a glissé vers la gauche.
    var tx = gl + gw * 0.56 - gh * 0.95 * Math.sin(GROMELIN.redresse * Math.PI / 180), ty = gt + gh * 0.04;
    // Le coin bas gauche de la feuille à sa hauteur d'ouverture (elle grandit en s'écrivant).
    var lx = lettre.offsetLeft + 6, ly = lettre.offsetTop + Math.min(lettre.offsetHeight, 56) - 2;
    [[0.22, 6], [0.5, 9], [0.8, 13]].forEach(function (b) {
      var img = document.createElement('img');
      img.className = 'qt-bulle-fee'; img.alt = ''; img.src = BULLE;
      img.style.cssText = 'width:' + b[1] + 'px;height:' + b[1] + 'px;left:' + (tx + (lx - tx) * b[0] - b[1] / 2) + 'px;top:' + (ty + (ly - ty) * b[0] - b[1] / 2) + 'px';
      scene.appendChild(decor(img));
    });
  }

  /** Une enseigne : la planche aux lianes de Pixiz, le texte gravé dessus. */
  function enseigne(el, texte, k) {
    var p = symbole('invMessage', 1, k || 0.7);
    if (!p) { el.textContent = texte; el.classList.add('sans-planche'); return; }
    el.innerHTML = '';
    el.appendChild(p);
    el.style.width = p.style.width; el.style.height = p.style.height;
    var s = document.createElement('span');
    s.textContent = texte;
    el.appendChild(s);
  }

  /** Brancher une scène : dessinée maintenant, redessinée si la largeur change. */
  function brancher(scene, opts) {
    return charger().then(function () {
      dessiner(scene, opts);
      if (scene._qtSuivi || typeof global.ResizeObserver !== 'function') return;
      scene._qtSuivi = new global.ResizeObserver(function () {
        if (scene.isConnected && Math.abs(scene.clientWidth - (scene._qtLargeur || 0)) > 1) dessiner(scene, opts);
      });
      scene._qtSuivi.observe(scene);
    });
  }

  global.QuetesForet = {
    charger: charger, brancher: brancher, dessiner: dessiner, placerLettre: placerLettre, enseigne: enseigne,
    // pour les tests
    _cadre: cadre, _ciel: ciel, _nuit: nuitDe, _voile: voile, _heure: function (h) { heureForcee = h; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
