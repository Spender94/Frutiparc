/*
 * FPI18n — LES LANGUES DU PARC (français, anglais).
 *
 * LE PRINCIPE : LE FRANÇAIS RESTE ÉCRIT EN CLAIR DANS LE CODE. On n'écrit pas
 * `T('accueil.titre')` mais `T('accueil.titre', 'Bienvenue sur Frutiparc')` :
 * le texte français est l'argument de repli, celui qu'on lit en ouvrant le
 * fichier, celui que les tests vérifient, celui que voient les joueurs
 * francophones — sans dictionnaire français à tenir à jour. Seul l'ANGLAIS vit
 * dans des dictionnaires à part (/i18n/en/<zone>.js), chargés uniquement quand
 * la langue est l'anglais. Une clé absente du dictionnaire retombe sur le
 * français : la version anglaise peut avancer zone par zone sans rien casser.
 *
 * LA LANGUE, dans cet ordre :
 *   1. `?lang=en` ou `?lang=fr` dans l'adresse (et elle est retenue) ;
 *   2. `localStorage.fp_lang`, écrit par le sélecteur de langue et à la
 *      connexion (la préférence du compte) — même origine pour le site et les
 *      jeux, donc partagée par les cadres, les fenêtres à part, les invités ;
 *   3. la langue du navigateur : français s'il commence par « fr », anglais
 *      sinon ;
 *   4. le français.
 *
 * LE MÊME FICHIER SERT AU SERVEUR (`require('./public/js/i18n.js')`) : il n'y
 * a pas de langue « courante » côté serveur, on passe la langue à chaque appel
 * (`FPI18n.traduire(langue, cle, fr, params)`), car un même message part vers
 * des joueurs de langues différentes.
 *
 * API (navigateur) :
 *   T(cle, fr, params)          le texte ; `{nom}` dans le texte est remplacé
 *                               par params.nom. Une entrée de dictionnaire
 *                               peut être une FONCTION (params) → texte, pour
 *                               la grammaire qu'un gabarit ne sait pas dire.
 *   T.n(cle, n, formes, params) pluriel : formes = { one: '…', other: '…' }
 *                               en français ; `{n}` vaut le nombre. Règles
 *                               d'Intl.PluralRules (en français, 0 et 1 sont
 *                               au singulier ; en anglais, seul 1 l'est).
 *   T.date(d, style)            'court' (12/03), 'long' (12 mars 2026),
 *                               'heure' (14:05), 'jourHeure' (12/03 14:05).
 *   T.nombre(n)                 12 345 / 12,345.
 *   FPI18n.langue               'fr' ou 'en'.
 *   FPI18n.ajouter(lang, table) ajoute des traductions (les dictionnaires
 *                               /i18n/en/*.js l'appellent).
 *   FPI18n.charger(zones)       pendant le chargement de la page, ajoute les
 *                               dictionnaires des zones demandées — seulement
 *                               hors français.
 *   FPI18n.appliquer(racine)    traduit le HTML statique marqué :
 *                               data-i18n="cle" (texte), data-i18n-html="cle"
 *                               (HTML), data-i18n-attr="title:cle;placeholder:cle".
 *   FPI18n.changer(lang)        retient la langue et recharge la page.
 */
(function (racine, fabrique) {
  'use strict';
  var api = fabrique(racine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    racine.FPI18n = api;
    racine.T = api.T;
  }
})(typeof window !== 'undefined' ? window : this, function (global) {
  'use strict';
  var LANGUES = ['fr', 'en'];
  var dicos = { fr: {}, en: {} };
  var navigateur = typeof document !== 'undefined' && typeof global.location !== 'undefined';

  function valide(l) {
    l = String(l || '').toLowerCase().slice(0, 2);
    return LANGUES.indexOf(l) >= 0 ? l : '';
  }

  function detecter() {
    if (!navigateur) return 'fr';
    var l = '';
    try { l = valide(new URLSearchParams(global.location.search).get('lang')); } catch (e) { /* vieux navigateur */ }
    if (l) {
      try { global.localStorage.setItem('fp_lang', l); } catch (e) { /* pas de stockage */ }
      return l;
    }
    try { l = valide(global.localStorage.getItem('fp_lang')); } catch (e) { /* pas de stockage */ }
    if (l) return l;
    var nav = (global.navigator && (global.navigator.languages || [global.navigator.language])) || [];
    for (var i = 0; i < nav.length; i++) {
      var n = String(nav[i] || '').toLowerCase();
      if (!n) continue;
      return n.indexOf('fr') === 0 ? 'fr' : 'en';
    }
    return 'fr';
  }

  var langue = detecter();

  function remplacer(s, params) {
    if (!params) return s;
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(params, k) && params[k] != null ? String(params[k]) : m;
    });
  }

  function brut(l, cle) {
    var d = dicos[l];
    return d && Object.prototype.hasOwnProperty.call(d, cle) ? d[cle] : undefined;
  }

  function traduire(l, cle, fr, params) {
    l = valide(l) || 'fr';
    var s = l === 'fr' ? brut('fr', cle) : brut(l, cle);
    if (s === undefined) s = fr;
    if (s === undefined || s === null) s = cle;
    if (typeof s === 'function') return String(s(params || {}));
    return remplacer(s, params);
  }

  var regles = {};
  function categorie(l, n) {
    try {
      if (!regles[l]) regles[l] = new Intl.PluralRules(l);
      return regles[l].select(Number(n));
    } catch (e) {
      // Sans Intl : la règle de chaque langue, écrite à la main.
      return l === 'fr' ? (Math.abs(n) < 2 ? 'one' : 'other') : (Number(n) === 1 ? 'one' : 'other');
    }
  }

  function pluriel(l, cle, n, formes, params) {
    l = valide(l) || 'fr';
    var p = {};
    var k;
    for (k in (params || {})) if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k];
    p.n = n;
    var source = l === 'fr' ? (brut('fr', cle) || formes) : (brut(l, cle) || formes);
    if (typeof source === 'function') return String(source(p));
    if (typeof source === 'string') return remplacer(source, p);
    // Sans traduction, on garde les formes FRANÇAISES — avec la règle française.
    var regle = source === formes ? 'fr' : l;
    var cat = categorie(regle, n);
    var s = (source && (source[cat] || source.other || source.one)) || cle;
    return remplacer(s, p);
  }

  var MOIS = {
    fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  };
  function deux(n) { return (n < 10 ? '0' : '') + n; }
  function date(l, d, style) {
    l = valide(l) || 'fr';
    if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d.getTime())) return '';
    var j = d.getDate(), m = d.getMonth(), a = d.getFullYear();
    var heure = deux(d.getHours()) + ':' + deux(d.getMinutes());
    // Les anglophones lisent le mois d'abord (03/12 = 12 mars).
    var court = l === 'en' ? deux(m + 1) + '/' + deux(j) : deux(j) + '/' + deux(m + 1);
    switch (style) {
      case 'long': return l === 'en' ? MOIS.en[m] + ' ' + j + ', ' + a : j + ' ' + MOIS.fr[m] + ' ' + a;
      case 'heure': return heure;
      case 'jourHeure': return court + ' ' + heure;
      default: return court;
    }
  }

  function nombre(l, n) {
    l = valide(l) || 'fr';
    try { return Number(n).toLocaleString(l === 'en' ? 'en-US' : 'fr-FR'); } catch (e) { return String(n); }
  }

  function ajouter(l, table) {
    l = valide(l);
    if (!l || !table) return;
    for (var k in table) if (Object.prototype.hasOwnProperty.call(table, k)) dicos[l][k] = table[k];
  }

  // Les dictionnaires d'une page, chargés PENDANT son analyse : la suite de la
  // page les trouve prêts, sans attendre ni rien réécrire de son démarrage.
  // En français, rien n'est chargé.
  function charger(zones) {
    if (!navigateur || langue === 'fr') return;
    if (typeof zones === 'string') zones = [zones];
    for (var i = 0; i < zones.length; i++) {
      // Une zone du site (« light ») vit dans /i18n/<langue>/ ; un jeu donne son
      // propre chemin, où {lang} est remplacé : '/snake3/lang/{lang}.js'.
      var z = String(zones[i]);
      var src = z.charAt(0) === '/'
        ? z.replace('{lang}', langue).replace(/[^\w\/.-]/g, '')
        : '/i18n/' + langue + '/' + z.replace(/[^\w-]/g, '') + '.js';
      if (document.readyState === 'loading') {
        document.write('<script src="' + src + '"><\/script>');
      } else {
        var s = document.createElement('script');
        s.src = src;
        s.async = false;
        (document.head || document.documentElement).appendChild(s);
      }
    }
  }

  function appliquer(racineDom) {
    if (!navigateur || langue === 'fr') return;
    racineDom = racineDom || document;
    var i, el, cle;
    var textes = racineDom.querySelectorAll('[data-i18n]');
    for (i = 0; i < textes.length; i++) {
      el = textes[i]; cle = el.getAttribute('data-i18n');
      if (brut(langue, cle) !== undefined) el.textContent = traduire(langue, cle, el.textContent);
    }
    var htmls = racineDom.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < htmls.length; i++) {
      el = htmls[i]; cle = el.getAttribute('data-i18n-html');
      if (brut(langue, cle) !== undefined) el.innerHTML = traduire(langue, cle, el.innerHTML);
    }
    var attrs = racineDom.querySelectorAll('[data-i18n-attr]');
    for (i = 0; i < attrs.length; i++) {
      el = attrs[i];
      var paires = el.getAttribute('data-i18n-attr').split(';');
      for (var j = 0; j < paires.length; j++) {
        var pa = paires[j].split(':');
        if (pa.length !== 2) continue;
        var nom = pa[0].trim(); cle = pa[1].trim();
        if (brut(langue, cle) !== undefined) el.setAttribute(nom, traduire(langue, cle, el.getAttribute(nom)));
      }
    }
  }

  function changer(l) {
    l = valide(l);
    if (!l || !navigateur) return;
    try { global.localStorage.setItem('fp_lang', l); } catch (e) { /* pas de stockage */ }
    // L'adresse peut porter un ?lang= qui gagnerait au rechargement : on l'ôte.
    try {
      var p = new URLSearchParams(global.location.search);
      if (p.has('lang')) {
        p.delete('lang');
        var q = p.toString();
        global.location.replace(global.location.pathname + (q ? '?' + q : '') + global.location.hash);
        return;
      }
    } catch (e) { /* on recharge tel quel */ }
    global.location.reload();
  }

  // La langue de la page, pour les lecteurs d'écran, la césure, les guillemets.
  if (navigateur && document.documentElement) document.documentElement.lang = langue;

  function T(cle, fr, params) { return traduire(langue, cle, fr, params); }
  T.n = function (cle, n, formes, params) { return pluriel(langue, cle, n, formes, params); };
  T.date = function (d, style) { return date(langue, d, style); };
  T.nombre = function (n) { return nombre(langue, n); };

  return {
    LANGUES: LANGUES,
    get langue() { return langue; },
    T: T,
    traduire: traduire,
    pluriel: pluriel,
    date: date,
    nombre: nombre,
    ajouter: ajouter,
    charger: charger,
    appliquer: appliquer,
    changer: changer,
    valide: valide,
    // Les tests du serveur.
    _dicos: dicos,
  };
});
