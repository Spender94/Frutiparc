/*
 * LES QUÊTES DE GROMELIN, côté light — l'icône, la fenêtre, et Gromelin qui
 * parle.
 *
 *   · L'ICÔNE (#tuile-quetes) : le baluchon de MiniPixiz. Elle ne paraît que
 *     si le serveur ouvre les quêtes à ce joueur (admin : fermées, testeurs,
 *     ou tous). Quand il y a du neuf — une semaine pas encore vue, une quête
 *     payée depuis la dernière visite — le baluchon gigote et des éclats
 *     scintillent autour (`.nouvelles`). Pas de pastille : le bureau d'origine
 *     n'en pose sur aucune icône, c'est le dessin qui change d'état.
 *   · LA FENÊTRE (#quetes-sheet) : une fenêtre du bureau, une feuille sur
 *     mobile, comme les Prunostics. Gromelin dans son écran de bouille — celui
 *     des bouilles de Gaspard —, sa bulle, puis les quêtes en parchemins sur
 *     des planches.
 *   · LA PAROLE : à l'ouverture, Gromelin joue l'animation « parle » du moteur
 *     de bouilles (playAnim 1) pendant que ses messages s'écrivent lettre à
 *     lettre, l'un après l'autre, puis se tait. Un clic dans la bulle finit le
 *     message en cours, ou passe au suivant.
 *
 * Le serveur fait foi pour tout : ce module ne calcule rien, il affiche
 * /api/quetes/etat et prévient /api/quetes/vu quand la fenêtre s'ouvre.
 */
(function (global) {
  'use strict';

  var SAC = '/minipixiz/sprites/shape446.svg';
  var CASE = '/minipixiz/sprites/shape981.svg';
  var KIKOOZ = '/fb/icone_kikooz.svg';
  var LETTRE_MS = 32;          // une lettre
  var PAUSE_MS = 1400;         // entre deux messages
  var SONDE_MS = 5 * 60 * 1000; // l'icône se remet à jour toute seule

  var etat = null;             // la dernière réponse du serveur
  var sid = '';
  var ouverte = false;
  var sonde = null;
  var parole = { msgs: [], i: 0, n: 0, minuteur: null, pause: null, toile: null };

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function nombre(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function reduit() {
    try { return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // ── Le serveur ─────────────────────────────────────────────────────────────
  function charger() {
    if (!sid) return Promise.resolve(null);
    return fetch('/api/quetes/etat?sid=' + encodeURIComponent(sid), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function noterVu() {
    if (!sid) return;
    fetch('/api/quetes/vu', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sid }) }).catch(function () {});
  }

  // ── L'icône ────────────────────────────────────────────────────────────────
  function majTuile() {
    var t = document.getElementById('tuile-quetes');
    if (!t) return;
    var acces = !!(etat && etat.acces);
    var etait = t.style.display !== 'none';
    t.style.display = acces ? '' : 'none';
    var neuf = acces && etat.nouveau && !ouverte;
    t.classList.toggle('nouvelles', !!neuf);
    t.title = !acces ? '' : (neuf
      ? (etat.nouvelleSemaine ? 'Quêtes — Gromelin a de nouvelles quêtes pour toi' : 'Quêtes — Gromelin a quelque chose à te dire')
      : 'Quêtes');
    // Le bureau range ses icônes à l'ouverture : une icône qui apparaît ou
    // disparaît doit lui être signalée, comme celle des Prunostics.
    if (acces !== etait && global.BureauFrutiz && BureauFrutiz.actif && BureauFrutiz.actif()) {
      try { global.dispatchEvent(new Event('resize')); } catch (e) { /* vieux navigateur */ }
    }
  }
  function majEtat(d) {
    if (d && d.ok) etat = d;
    else if (d === null && !etat) etat = null;
    majTuile();
    return etat;
  }

  // ── La fenêtre ─────────────────────────────────────────────────────────────
  function reste(fin) {
    var ms = Math.max(0, Number(fin) - Date.now());
    var j = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60;
    if (j > 0) return j + ' j ' + h + ' h';
    if (h > 0) return h + ' h ' + m + ' min';
    return Math.max(1, m) + ' min';
  }
  function carte(q) {
    var points = '';
    var niv = q.niveau === 'difficile' ? 3 : (q.niveau === 'moyenne' ? 2 : 1);
    for (var i = 1; i <= 3; i++) points += '<i' + (i <= niv ? ' class="on"' : '') + '></i>';
    var et = q.etiquette ? '<span class="qt-jeu" style="background:' + esc(q.etiquette.couleur) + '">' + esc(q.etiquette.nom) + '</span>' : '';
    return '<div class="qt-carte' + (q.fait ? ' faite' : '') + '">'
      + '<div class="qt-case"><img src="' + CASE + '" alt="">' + (q.fait ? '<span class="qt-coche" aria-label="faite">✔</span>' : '') + '</div>'
      + '<div class="qt-titre">' + et + esc(q.titre) + '</div>'
      + '<div class="qt-detail">' + esc(q.detail) + (q.detail && q.ligne ? ' · ' : '') + esc(q.ligne) + '</div>'
      + '<div class="qt-barre"><i style="width:' + Math.round((Number(q.pc) || 0) * 100) + '%"></i></div>'
      + '<div class="qt-gain"><span class="qt-kik"><img src="' + KIKOOZ + '" alt="kikooz">' + (q.fait ? '+' : '') + nombre(q.gain) + '</span>'
      + '<span class="qt-diff" aria-hidden="true">' + points + '</span><span class="qt-diff-nom">' + esc(q.niveauNom) + '</span></div>'
      + (q.fait ? '<span class="qt-tampon">FAIT</span>' : '')
      + '</div>';
  }
  function rendre() {
    var corps = document.getElementById('quetes-corps');
    if (!corps || !etat) return;
    if (!etat.acces) { corps.innerHTML = '<div class="qt-ferme">Gromelin n’a pas de quêtes pour toi en ce moment.</div>'; return; }
    var S = etat.semaine || {};
    var gainsTxt = (etat.gains ? ('Facile <b>' + nombre(etat.gains.facile) + '</b> · Moyenne <b>' + nombre(etat.gains.moyenne)
      + '</b> · Difficile <b>' + nombre(etat.gains.difficile) + '</b> kikooz, versés dès que la quête est faite.<br>') : '');
    var dejaLa = corps.querySelector('.qt');
    var planches = (etat.quetes || []).map(carte).join('') || '<div class="qt-vide">Pas de quêtes cette semaine.</div>';
    var semaine = '<span>Semaine ' + esc(S.lisible || '') + ' · <b>' + nombre(etat.gagnes) + '</b> / ' + nombre(etat.total) + ' kikooz gagnés</span>'
      + '<span>Nouvelles quêtes dans <b class="qt-compte">' + esc(reste(S.fin)) + '</b></span>';
    if (dejaLa) {
      // Déjà affichée : on ne touche ni à Gromelin ni à sa bulle (il parle peut-être).
      dejaLa.querySelector('.qt-semaine').innerHTML = semaine;
      dejaLa.querySelector('.qt-planches').innerHTML = planches;
      return;
    }
    corps.innerHTML = '<div class="qt">'
      + '<div class="qt-tete"><div class="qt-cadre"><div class="qt-ecran" title="' + esc((etat.gromelin && etat.gromelin.nom) || 'Gromelin') + '"></div></div>'
      + '<div class="qt-dit" role="status" aria-live="polite" title="Clique pour la suite"><span class="qt-txt"></span><span class="qt-curseur"></span><span class="qt-suite"></span></div></div>'
      + '<div class="qt-semaine">' + semaine + '</div>'
      + '<div class="qt-planches">' + planches + '</div>'
      + '<div class="qt-pied">' + gainsTxt + 'Nouvelles quêtes chaque lundi à minuit. Une quête non finie dimanche est perdue.</div>'
      + '</div>';
    var ecran = corps.querySelector('.qt-ecran');
    if (global.FPBouilleVignette && etat.gromelin) {
      ecran.innerHTML = FPBouilleVignette.html(etat.gromelin.bouille, { marge: FPBouilleVignette.MARGE_ECRAN });
      FPBouilleVignette.brancher(ecran);
    }
    corps.querySelector('.qt-dit').addEventListener('click', clicBulle);
  }

  // ── La parole ──────────────────────────────────────────────────────────────
  function longueur(h) { return String(h).replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, 'x').length; }
  // Le début d'un message HTML, `n` lettres visibles, balises refermées.
  function debut(h, n) {
    var out = '', vus = 0, i = 0, ouvertes = [];
    while (i < h.length && vus < n) {
      if (h[i] === '<') {
        var j = h.indexOf('>', i);
        var tag = h.slice(i, j + 1);
        if (/^<\//.test(tag)) ouvertes.pop(); else if (!/\/>$/.test(tag)) ouvertes.push(tag.replace(/^<(\w+).*$/, '$1'));
        out += tag; i = j + 1; continue;
      }
      if (h[i] === '&') { var k = h.indexOf(';', i); if (k > i) { out += h.slice(i, k + 1); i = k + 1; vus++; continue; } }
      out += h[i]; vus++; i++;
    }
    while (ouvertes.length) out += '</' + ouvertes.pop() + '>';
    return out;
  }
  function toile() { var c = $('#quetes-corps .qt-ecran canvas'); return c || null; }
  function bouche(parle) {
    var c = toile();
    if (!c || !global.FPBouilleVignette || !etat || !etat.gromelin) return;
    try {
      if (parle) FPBouilleVignette.jouer(c, etat.gromelin.bouille, 1);
      else FPBouilleVignette.stopper(c);
    } catch (e) { /* une bouille qui ne se dessine pas ne doit rien bloquer */ }
  }
  function dessinerParole() {
    var d = $('#quetes-corps .qt-dit');
    if (!d) return;
    var m = parole.msgs[parole.i] || '';
    var fini = parole.n >= longueur(m);
    d.querySelector('.qt-txt').innerHTML = debut(m, parole.n);
    d.querySelector('.qt-curseur').style.display = fini ? 'none' : '';
    var plus = parole.i < parole.msgs.length - 1;
    d.querySelector('.qt-suite').innerHTML = parole.msgs.length > 1
      ? (parole.i + 1) + ' / ' + parole.msgs.length + (fini && plus ? ' · <b>Suite ›</b>' : '') : '';
  }
  function taire() {
    clearInterval(parole.minuteur); parole.minuteur = null;
    clearTimeout(parole.pause); parole.pause = null;
    bouche(false);
  }
  function messageSuivant(i) {
    clearTimeout(parole.pause); parole.pause = null;
    parole.i = i;
    var m = parole.msgs[i] || '';
    if (reduit()) { parole.n = longueur(m); dessinerParole(); bouche(false); return; }
    parole.n = 0;
    bouche(true);
    dessinerParole();
    clearInterval(parole.minuteur);
    parole.minuteur = setInterval(function () {
      parole.n++;
      dessinerParole();
      if (parole.n >= longueur(m)) finMessage();
    }, LETTRE_MS);
  }
  function finMessage() {
    clearInterval(parole.minuteur); parole.minuteur = null;
    var m = parole.msgs[parole.i] || '';
    parole.n = longueur(m);
    dessinerParole();
    if (parole.i < parole.msgs.length - 1) {
      parole.pause = setTimeout(function () { messageSuivant(parole.i + 1); }, PAUSE_MS);
    } else bouche(false);
  }
  function parler(msgs) {
    taire();
    parole.msgs = (msgs || []).slice();
    if (!parole.msgs.length) { dessinerParole(); return; }
    messageSuivant(0);
  }
  function clicBulle() {
    if (parole.minuteur) return finMessage();
    if (parole.i < parole.msgs.length - 1) messageSuivant(parole.i + 1);
  }

  // ── Ouvrir, fermer ─────────────────────────────────────────────────────────
  /** La fenêtre (ou la feuille) vient de s'ouvrir. */
  function ouvert() {
    ouverte = true;
    majTuile();
    return charger().then(function (d) {
      majEtat(d);
      if (!ouverte) return;
      rendre();
      if (etat && etat.acces) {
        parler(etat.messages);
        noterVu();
        etat.nouveau = false;
        etat.nouvelleSemaine = false;
      }
      majTuile();
    });
  }
  /** La fenêtre se ferme : Gromelin se tait, la bulle sera rejouée à la prochaine ouverture. */
  function ferme() {
    ouverte = false;
    taire();
    var corps = document.getElementById('quetes-corps');
    if (corps) corps.innerHTML = '';
    majTuile();
  }
  function ouvrirFeuille() {
    var f = document.getElementById('quetes-sheet');
    if (!f) return;
    document.getElementById('quetes-sheet-backdrop').classList.add('show');
    f.classList.add('show');
    ouvert();
  }
  function fermerFeuille() {
    var f = document.getElementById('quetes-sheet');
    if (!f) return;
    document.getElementById('quetes-sheet-backdrop').classList.remove('show');
    f.classList.remove('show');
    ferme();
  }

  /** Quelque chose a bougé côté serveur (une quête payée) : on relit. */
  function rafraichir() {
    return charger().then(function (d) {
      majEtat(d);
      if (!ouverte || !etat || !etat.acces) return;
      rendre();
      if (etat.nouveau) {
        parler(etat.messages);
        noterVu();
        etat.nouveau = false;
      }
      majTuile();
    });
  }

  /** Au démarrage du light (et à chaque reconnexion) : la session, puis l'icône. */
  function demarrer(s) {
    if ((s || '') === sid && sonde) return rafraichir();
    sid = s || '';
    if (sonde) clearInterval(sonde);
    sonde = setInterval(function () { if (!ouverte) rafraichir(); else majCompte(); }, SONDE_MS);
    var close = document.getElementById('quetes-sheet-close');
    if (close && !close._qt) { close._qt = true; close.addEventListener('click', fermerFeuille); }
    var fond = document.getElementById('quetes-sheet-backdrop');
    if (fond && !fond._qt) { fond._qt = true; fond.addEventListener('click', fermerFeuille); }
    return rafraichir();
  }
  function majCompte() {
    var b = $('#quetes-corps .qt-compte');
    if (b && etat && etat.semaine) b.textContent = reste(etat.semaine.fin);
  }

  /*
   * LES MODES DE JEU HORS CLASSEMENT. Un jeu light déclare un résultat (une
   * épreuve de Kaluga) ; le serveur décide s'il fait avancer une quête.
   * Appelable depuis n'importe quel cadre de jeu : il passe sa propre session.
   */
  function rapporterMode(s, jeu, mode, v, record) {
    if (!s) return;
    fetch('/api/quetes/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: s, jeu: jeu, mode: mode, v: v, record: !!record }) }).catch(function () {});
  }

  global.QuetesLight = {
    demarrer: demarrer, rafraichir: rafraichir, ouvert: ouvert, ferme: ferme,
    ouvrirFeuille: ouvrirFeuille, fermerFeuille: fermerFeuille, rapporterMode: rapporterMode,
    // pour les tests
    _debut: debut, _longueur: longueur, _carte: carte,
  };
})(typeof window !== 'undefined' ? window : globalThis);
