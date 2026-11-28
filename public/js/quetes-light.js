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
 *     mobile, comme les Prunostics. En haut, la forêt de Gromelin (le paysage
 *     de MiniPixiz, dessiné par quetes-foret.js) : Gromelin y sort des herbes
 *     devant sa cabane et écrit sur une feuille du courrier de Pixiz ; puis
 *     les quêtes sur son parchemin, et les mises à prix.
 *   · LE CONTRAT (« Rien que pour toi ») : sous les quêtes de tous, trois
 *     propositions taillées par le serveur sur les scores du joueur ; il en
 *     signe une (deux clics : « Signer », puis « Sûr ? »), qui devient sa
 *     quête personnelle de la semaine, scellée de cire.
 *   · LA PAROLE : à l'ouverture, Gromelin s'anime pendant que ses messages
 *     s'écrivent lettre à lettre sur sa feuille, l'un après l'autre, puis se
 *     tait. Un clic sur la feuille finit le message en cours, ou passe au
 *     suivant.
 *
 * Le serveur fait foi pour tout : ce module ne calcule rien, il affiche
 * /api/quetes/etat et prévient /api/quetes/vu quand la fenêtre s'ouvre.
 *
 * LES LANGUES : ce que le module écrit lui-même passe par T() (/js/i18n.js,
 * l'anglais dans /i18n/en/widgets.js). Les titres, les détails, les records et
 * la parole de Gromelin viennent du serveur : ils ne se traduisent pas ici.
 */
(function (global) {
  'use strict';

  function remplir(s, p) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] != null ? String(p[k]) : m; });
  }
  // Sans i18n.js (une page qui ne le charge pas encore), le français, gabarit rempli.
  function T(cle, fr, p) {
    var I = global.FPI18n;
    return I && I.T ? I.T(cle, fr, p) : remplir(fr, p);
  }
  T.n = function (cle, n, formes, p) {
    var I = global.FPI18n;
    if (I && I.T && I.T.n) return I.T.n(cle, n, formes, p);
    var q = { n: n };
    for (var k in (p || {})) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
    return remplir(Math.abs(n) < 2 ? formes.one : formes.other, q);
  };

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
  // 12 345 en français (l’espace fine insécable, comme toujours ici) ; 12,345 en anglais.
  function nombre(n) {
    var I = global.FPI18n, v = Math.round(Number(n) || 0);
    if (I && I.langue && I.langue !== 'fr' && I.T && I.T.nombre) return I.T.nombre(v);
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
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
      ? (etat.nouvelleSemaine ? T('widgets.quetesTuileNouvelles', 'Quêtes — Gromelin a de nouvelles quêtes pour toi')
        : T('widgets.quetesTuileMessage', 'Quêtes — Gromelin a quelque chose à te dire'))
      : T('widgets.quetesTuile', 'Quêtes'));
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
  /*
   * LES ASSETS DU PARC. Rien de dessiné ici : le jeu d'une quête se reconnaît
   * à son VOYANT (celui de la barre des jeux) ; chaque quête a sa CASE — la
   * case de mission de l'écran de Gromelin, dans MiniPixiz, cochée quand
   * c'est fait —, et la liste est écrite sur son PARCHEMIN de missions ;
   * l'avancement est la FRUTIBARRE de Frutisnake, les kikooz la pièce et la
   * pastille de la boutique ; « Changer » est le bouton orange de Swapou, la
   * signature du contrat la gélule rose d'époque.
   */
  var VOYANT = { swapou2: 'swapou', snake3: 'snake3', kaluga: 'kaluga', bkiwi: 'bkiwi', mb2: 'mb2', minifever: 'minifever',
    minipixiz: 'minipixiz', miniwave: 'miniwave', grapiz: 'grapiz', bandas: 'bandas', forum: 'forum' };
  var PORTRAIT = { swapou2: 'swapou', snake3: 'frutisnake', kaluga: 'kaluga', mb2: 'mb', minipixiz: 'mpixiz', miniwave: 'mwave',
    bkiwi: 'bk', grapiz: 'grapiz', jamajama: 'jamajama' };
  var PIECE = '/frutiz/sprites/shop-kikooz.svg';
  function nomJeu(q) { return q.etiquette ? q.etiquette.nom : ''; }
  // Hors des jeux : la prune des Prunostics (sa tuile), le soleil des
  // événements de jeu pour le Challenge, la bulle des salons.
  var ICONE = { prunostics: '/frutiz/sprites/ico_pictoForum.svg', challenge: '/fb/evt_jeu.svg', salons: '/fb/icone_salon.png' };
  function voyant(q) {
    var v = VOYANT[q.jeu] ? '/fb/voyant_' + VOYANT[q.jeu] + '.png' : ICONE[q.jeu];
    return v ? '<img class="qt-voyant" src="' + v + '" alt="' + esc(nomJeu(q)) + '" title="' + esc(nomJeu(q)) + '">'
      : '<img class="qt-voyant puce" src="/frutiz/sprites/puce-standard-2.svg" alt="" title="' + esc(nomJeu(q)) + '">';
  }
  function piece(n, plus) { return '<span class="qt-kik"><img src="' + PIECE + '" alt="kikooz">' + (plus ? '+' : '') + nombre(n) + '</span>'; }
  function barre(pc) {
    var p = Math.round((Number(pc) || 0) * 100);
    return '<div class="qt-barre">' + (p > 0 ? '<i style="width:' + p + '%"></i>' : '') + '</div>';
  }
  function section(titre) { return '<div class="qt-section"><img src="/frutiz/sprites/shop-puce-rubrique.svg" alt="">' + esc(titre) + '</div>'; }
  // La case de mission de Gromelin (caseMission : la case, et sa coche).
  function caseMission(fait) {
    return '<span class="qt-case' + (fait ? ' cochee' : '') + '" aria-label="' + esc(fait ? T('widgets.quetesFaite', 'faite') : T('widgets.quetesAFaire', 'à faire')) + '">'
      + '<img src="/minipixiz/sprites/shape981.svg" alt="">' + (fait ? '<img class="coche" src="/minipixiz/sprites/shape983.svg" alt="">' : '') + '</span>';
  }
  function carte(q) {
    var changer = (!q.fait && !q.contrat && !q.gromelin && etat && etat.echange && etat.echange.possible)
      ? '<button type="button" class="qt-swapou qt-changer" data-id="' + esc(q.id) + '" title="' + esc(T('widgets.quetesChangerTitre', 'Une fois par semaine, une seule quête')) + '">'
        + esc(T('widgets.quetesChanger', 'Changer')) + '</button>' : '';
    return '<div class="qt-ligne' + (q.fait ? ' faite' : '') + (q.contrat ? ' qt-signee' : '') + '">'
      + (q.contrat ? '<span class="qt-sceau" aria-hidden="true">G</span>' : caseMission(q.fait))
      + '<div class="qt-corps"><div class="qt-titre">' + (q.contrat ? '' : voyant(q)) + esc(q.titre) + '</div>'
      + '<div class="qt-detail">' + esc(q.detail) + (q.detail && q.ligne ? ' · ' : '') + esc(q.ligne) + '</div>'
      + barre(q.fait ? 1 : q.pc) + '</div>'
      + '<div class="qt-gain">' + piece(q.gain, q.fait) + changer + '</div>'
      + '</div>';
  }
  // LES MISES À PRIX : sous l'enseigne (la planche aux lianes de Pixiz), une
  // affiche par record du parc, le portrait du jeu (son illustration du site).
  function primes() {
    var l = (etat && etat.primes) || [];
    if (!l.length) return '';
    // L'enseigne : son texte est peint sur la planche de Pixiz (QuetesForet.enseigne).
    var enseigne = esc(T('widgets.quetesMisesAPrix', 'Mises à prix'));
    return '<div class="qt-enseigne" data-texte="' + enseigne + '"><span>' + enseigne + '</span></div>'
      + '<div class="qt-note qt-note-primes">' + T('widgets.quetesPrimesNote1', 'Bats un <b>record absolu du parc</b> au Challenge (un score, le temps d’un circuit de Burning Kiwi, la série de victoires à Grapiz ou Frutibandas) en détrônant son tenant : Gromelin paie la prime.') + ' '
      + T('widgets.quetesPrimesNote2', 'La prime <b>grossit chaque semaine</b> que le record tient, et repart de peu une fois payée. Une prime par record et par semaine ; battre son propre record ne compte pas.') + '</div>'
      + '<div class="qt-avis">' + l.map(function (p) {
        var portrait = PORTRAIT[p.jeu];
        return '<div class="qt-affiche' + (p.ouverte ? '' : ' prise') + '">'
          + (portrait ? '<div class="qt-portrait"><img src="/images/' + portrait + '.png" alt=""></div>' : '<div class="qt-portrait vide">' + voyant(p) + '</div>')
          + '<div class="qt-aff-jeu">' + voyant(p) + esc(nomJeu(p)) + '</div>'
          + (p.circuit ? '<div class="qt-aff-circuit">' + esc(p.circuit) + '</div>' : '')
          + '<div class="qt-aff-record">' + esc(p.record) + '</div>'
          + '<div class="qt-aff-tenant">' + T('widgets.quetesRecordDe', 'record de <b>{tenant}</b>', { tenant: esc(p.tenant) })
          + (p.semaines ? '<br>' + T.n('widgets.quetesTenuDepuis', p.semaines, { one: 'tenu depuis {n} semaine', other: 'tenu depuis {n} semaines' }) : '') + '</div>'
          + '<div class="qt-aff-prime">' + piece(p.gain) + '</div>'
          + (p.ouverte ? (p.moi ? '<span class="qt-aff-prise qt-aff-moi">' + esc(T('widgets.quetesTonRecord', 'Ton record : à toi de le défendre !')) + '</span>' : '')
            : '<span class="qt-aff-prise">' + T('widgets.quetesPrisePar', 'Prise par {nom}', { nom: esc(p.prisePar) }) + '</span>')
          + '</div>';
      }).join('') + '</div>';
  }
  // Une proposition de contrat, pas encore signée.
  function proposition(p) {
    return '<div class="qt-ligne qt-prop">'
      + '<span class="qt-sceau vide" aria-hidden="true">G</span>'
      + '<div class="qt-corps"><div class="qt-titre">' + esc(p.titre) + '</div>'
      + '<div class="qt-detail">' + esc(p.detail) + '</div></div>'
      + '<div class="qt-gain">' + piece(p.gain)
      + '<button type="button" class="qt-gelule qt-signer" data-i="' + Number(p.i) + '">' + esc(T('widgets.quetesSigner', 'Signer')) + '</button></div>'
      + '</div>';
  }
  function contrat() {
    var c = etat && etat.contrat;
    if (!c || c.etat === 'inactif') return '';
    var tete = section(T('widgets.quetesRienQuePourToi', 'Rien que pour toi'));
    if (c.etat === 'aucun') {
      var sem = Math.max(1, Math.round((Number(c.fenetre) || 28) / 7));
      // `n` : le nombre de jours, pour l'accord de l'anglais (le texte
      // français d'origine dit toujours « jours »).
      var p = { jours: nombre(c.minJours || 3), n: Number(c.minJours || 3), sem: sem };
      return tete + '<div class="qt-note">' + (sem > 1
        ? T('widgets.quetesContratAucun', 'Joue au Challenge au moins <b>{jours} jours</b> sur les {sem} dernières semaines, et Gromelin te taillera un contrat sur mesure, d’après tes propres scores.', p)
        : T('widgets.quetesContratAucunSemaine', 'Joue au Challenge au moins <b>{jours} jours</b> sur la dernière semaine, et Gromelin te taillera un contrat sur mesure, d’après tes propres scores.', p))
        + '</div>';
    }
    if (c.etat === 'a_signer') {
      return tete + '<div class="qt-note">' + T('widgets.quetesContratASigner', 'Trois contrats taillés sur tes scores du Challenge. <b>Signes-en un seul</b> : '
        + 'seuls les résultats obtenus après la signature comptent.') + '</div>'
        + '<div class="qt-liste">' + (c.propositions || []).map(proposition).join('') + '</div>';
    }
    return tete + '<div class="qt-note">' + T('widgets.quetesContratSigne', 'Ton contrat de la semaine. Seuls les résultats obtenus depuis la signature comptent.') + '</div>'
      + '<div class="qt-liste">' + (c.quete ? carte(c.quete) : '') + '</div>';
  }
  function rendre() {
    var corps = document.getElementById('quetes-corps');
    if (!corps || !etat) return;
    if (!etat.acces) { corps.innerHTML = '<div class="qt-ferme">' + esc(T('widgets.quetesFermees', 'Gromelin n’a pas de quêtes pour toi en ce moment.')) + '</div>'; return; }
    var S = etat.semaine || {};
    var pied = T('widgets.quetesPied', 'Les kikooz sont versés dès que la quête est faite. Nouvelles quêtes chaque lundi à minuit ; une quête non finie dimanche est perdue.')
      + (etat.echange ? '<br>' + (etat.echange.fait ? T('widgets.quetesDejaChangee', 'Tu as changé une quête cette semaine (« {titre} »).', { titre: esc(etat.echange.fait.titre) })
        : T('widgets.quetesPeutChanger', 'Une quête ne te plaît pas ? Tu peux en <b>changer une</b> par semaine.')) : '');
    var dejaLa = corps.querySelector('.qt');
    var planches = (etat.quetes || []).map(carte).join('') || '<div class="qt-vide">' + esc(T('widgets.quetesAucune', 'Pas de quêtes cette semaine.')) + '</div>';
    // Où il en est, le bonus de la semaine, et le compteur de la boutique (gagnés / possibles) —
    // tamponné « max! » (Swapou) quand toute la semaine est faite.
    var Q = etat.quetes || [];
    var faites = Q.filter(function (q) { return q.fait; }).length;
    var tout = Q.length > 0 && faites === Q.length;
    // La semaine (`S.lisible`) est écrite par le serveur.
    var semaine = '<img class="qt-cabane" src="/minipixiz/sprites/shape429.svg" alt="" title="' + esc(T('widgets.quetesCabane', 'La cabane de Gromelin')) + '">'
      + '<span class="qt-sem-txt">' + T('widgets.quetesSemaine', 'Semaine {semaine}', { semaine: esc(S.lisible || '') }) + '<br>'
      + (!Q.length ? esc(T('widgets.quetesAucuneSemaine', 'Pas de quêtes cette semaine')) : tout ? '<b>' + esc(T('widgets.quetesToutesFaites', 'Toutes les quêtes sont faites !')) + '</b>'
        : T.n('widgets.quetesFaitesSur', faites, { one: '<b>{n} quête faite</b> sur {total}', other: '<b>{n} quêtes faites</b> sur {total}' }, { total: Q.length })) + '</span>'
      + '<span class="qt-sem-droite">' + (etat.bonus ? '<span class="qt-bonus' + (etat.bonus.verse ? ' verse' : '') + '" title="'
        + esc(etat.bonus.verse ? T('widgets.quetesBonusVerse', 'Bonus de la semaine versé') : T('widgets.quetesBonusTitre', 'Toutes les quêtes faites : un bonus d’XP')) + '"><img src="/fb/Niveau.svg" alt="">'
        + (etat.bonus.verse ? T('widgets.quetesBonusVerseXp', '✔ +{xp} XP', { xp: nombre(etat.bonus.xp) })
          : T('widgets.quetesBonusXp', 'tout finir : +{xp} XP', { xp: nombre(etat.bonus.xp) })) + '</span>' : '')
      + '<span class="qt-compteur" title="' + esc(T('widgets.quetesCompteurTitre', 'kikooz gagnés / possibles cette semaine')) + '"><img src="' + PIECE + '" alt="kikooz"><b>' + nombre(etat.gagnes) + '</b>&nbsp;/ ' + nombre(etat.total)
      + (tout ? '<img class="qt-max" src="/swapou/ui/max.svg" alt="' + esc(T('widgets.quetesMax', 'max !')) + '">' : '') + '</span></span>';
    if (dejaLa) {
      // Déjà affichée : on ne touche ni à la forêt ni à la feuille (Gromelin écrit peut-être).
      dejaLa.querySelector('.qt-semaine').innerHTML = semaine;
      dejaLa.querySelector('.qt-planches').innerHTML = planches;
      dejaLa.querySelector('.qt-contrat').innerHTML = contrat();
      dejaLa.querySelector('.qt-primes').innerHTML = primes();
      dejaLa.querySelector('.qt-pied').innerHTML = pied;
      enseignes(dejaLa);
      return;
    }
    corps.innerHTML = '<div class="qt">'
      + '<div class="qt-scene">'
      + '<div class="qt-dit" role="status" aria-live="polite" title="' + esc(T('widgets.quetesCliqueSuite', 'Clique pour la suite')) + '"><span class="qt-txt"></span><span class="qt-curseur"></span><span class="qt-suite"></span></div></div>'
      + '<div class="qt-semaine">' + semaine + '</div>'
      + '<div class="qt-planches qt-liste">' + planches + '</div>'
      + '<div class="qt-contrat">' + contrat() + '</div>'
      + '<div class="qt-primes">' + primes() + '</div>'
      + '<div class="qt-pied">' + pied + '</div>'
      + '</div>';
    var scene = corps.querySelector('.qt-scene');
    if (global.QuetesForet) {
      QuetesForet.brancher(scene).then(function () {
        enseignes(corps);
        // La feuille a pu s'écrire avant que la forêt soit là : on rebranche les bulles.
        QuetesForet.placerLettre(scene);
      });
    } else scene.classList.add('sans-foret');
    corps.querySelector('.qt-dit').addEventListener('click', clicBulle);
    corps.querySelector('.qt-contrat').addEventListener('click', clicSigner);
    corps.querySelector('.qt-planches').addEventListener('click', clicChanger);
  }
  // Les enseignes (planches de Pixiz), une fois les sprites de la forêt arrivés.
  function enseignes(racine) {
    if (!global.QuetesForet) return;
    var l = racine.querySelectorAll('.qt-enseigne[data-texte]');
    for (var i = 0; i < l.length; i++) {
      var el = l[i];
      el.removeAttribute('data-texte');
      QuetesForet.enseigne(el, el.textContent, 0.7);
    }
  }

  // ── L'échange : une quête par semaine (deux clics, comme la signature) ──────
  function clicChanger(e) {
    var b = e.target && e.target.closest ? e.target.closest('.qt-changer') : null;
    if (!b || b.disabled) return;
    if (!b.classList.contains('arme')) {
      var autres = document.querySelectorAll('#quetes-corps .qt-changer.arme');
      for (var k = 0; k < autres.length; k++) { autres[k].classList.remove('arme'); autres[k].textContent = T('widgets.quetesChanger', 'Changer'); }
      b.classList.add('arme');
      b.textContent = T('widgets.quetesSur', 'Sûr ?');
      clearTimeout(b._qt);
      b._qt = setTimeout(function () { b.classList.remove('arme'); b.textContent = T('widgets.quetesChanger', 'Changer'); }, 4000);
      return;
    }
    clearTimeout(b._qt);
    b.disabled = true;
    b.textContent = '…';
    fetch('/api/quetes/echanger', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sid, id: b.getAttribute('data-id') }) })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .catch(function () { return null; })
      .then(function (d) {
        if (d && d.ok && d.acces) {
          majEtat(d);
          if (ouverte) { rendre(); parler(d.messages); }
          return;
        }
        // Le message du serveur, tel quel ; à défaut, le nôtre.
        if (ouverte) parler([esc((d && d.message) || T('widgets.quetesEchecEchange', 'Grumpf. Ça n’a pas marché. Réessaie.'))]);
        return rafraichir();
      });
  }

  // ── La signature du contrat ────────────────────────────────────────────────
  // Deux clics : on ne signe pas par mégarde un engagement d'une semaine.
  function clicSigner(e) {
    var b = e.target && e.target.closest ? e.target.closest('.qt-signer') : null;
    if (!b || b.disabled) return;
    if (!b.classList.contains('arme')) {
      var autres = document.querySelectorAll('#quetes-corps .qt-signer.arme');
      for (var k = 0; k < autres.length; k++) { autres[k].classList.remove('arme'); autres[k].textContent = T('widgets.quetesSigner', 'Signer'); }
      b.classList.add('arme');
      b.textContent = T('widgets.quetesSur', 'Sûr ?');
      clearTimeout(b._qt);
      b._qt = setTimeout(function () { b.classList.remove('arme'); b.textContent = T('widgets.quetesSigner', 'Signer'); }, 4000);
      return;
    }
    clearTimeout(b._qt);
    b.disabled = true;
    b.textContent = '…';
    signer(Number(b.getAttribute('data-i')));
  }
  function signer(i) {
    return fetch('/api/quetes/contrat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sid, choix: i }) })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .catch(function () { return null; })
      .then(function (d) {
        if (d && d.ok && d.acces) {
          majEtat(d);
          if (ouverte) { rendre(); parler(d.messages); }
          return;
        }
        if (ouverte) parler([esc((d && d.message) || T('widgets.quetesEchecSignature', 'Grumpf. Ta signature n’est pas passée. Réessaie.'))]);
        return rafraichir();
      });
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
  function bouche(parle) {
    var g = $('#quetes-corps .qt-gromelin');
    if (g) g.classList.toggle('parle', !!parle);
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
      ? (parole.i + 1) + ' / ' + parole.msgs.length + (fini && plus ? ' · <b>' + esc(T('widgets.quetesSuite', 'Suite ›')) + '</b>' : '') : '';
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
    var scene = corps && corps.querySelector('.qt-scene');
    if (scene && scene._qtSuivi) scene._qtSuivi.disconnect();
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
    sonde = setInterval(function () { if (!ouverte) rafraichir(); }, SONDE_MS);
    var close = document.getElementById('quetes-sheet-close');
    if (close && !close._qt) { close._qt = true; close.addEventListener('click', fermerFeuille); }
    var fond = document.getElementById('quetes-sheet-backdrop');
    if (fond && !fond._qt) { fond._qt = true; fond.addEventListener('click', fermerFeuille); }
    return rafraichir();
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
    _debut: debut, _longueur: longueur, _carte: carte, _proposition: proposition,
    _etat: function (e) { etat = e; }, _primes: primes,
  };
})(typeof window !== 'undefined' ? window : globalThis);
