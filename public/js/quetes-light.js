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
 *   · LE CONTRAT (« Rien que pour toi ») : sous les quêtes de tous, trois
 *     propositions taillées par le serveur sur les scores du joueur ; il en
 *     signe une (deux clics : « Signer », puis « Sûr ? »), qui devient sa
 *     quête personnelle de la semaine, scellée de cire.
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
  /*
   * LES ASSETS DU PARC. Rien de dessiné ici : le jeu d'une quête se reconnaît
   * à son VOYANT (celui de la barre des jeux) ; chaque quête a sa CASE — la
   * case de mission de l'écran de Gromelin, dans MiniPixiz, cochée quand
   * c'est fait —, et la liste est écrite sur son PARCHEMIN de missions ;
   * l'avancement est la FRUTIBARRE de Frutisnake, les kikooz la pièce de la
   * boutique, les boutons la gélule rose d'époque.
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
    return '<span class="qt-case' + (fait ? ' cochee' : '') + '" aria-label="' + (fait ? 'faite' : 'à faire') + '">'
      + '<img src="/minipixiz/sprites/shape981.svg" alt="">' + (fait ? '<img class="coche" src="/minipixiz/sprites/shape983.svg" alt="">' : '') + '</span>';
  }
  function carte(q) {
    var changer = (!q.fait && !q.contrat && etat && etat.echange && etat.echange.possible)
      ? '<button type="button" class="qt-gelule qt-changer" data-id="' + esc(q.id) + '" title="Une fois par semaine, une seule quête">Changer</button>' : '';
    return '<div class="qt-ligne' + (q.fait ? ' faite' : '') + (q.contrat ? ' qt-signee' : '') + '">'
      + (q.contrat ? '<span class="qt-sceau" aria-hidden="true">G</span>' : caseMission(q.fait))
      + '<div class="qt-corps"><div class="qt-titre">' + (q.contrat ? '' : voyant(q)) + esc(q.titre) + '</div>'
      + '<div class="qt-detail">' + esc(q.detail) + (q.detail && q.ligne ? ' · ' : '') + esc(q.ligne) + '</div>'
      + barre(q.fait ? 1 : q.pc) + '</div>'
      + '<div class="qt-gain">' + piece(q.gain, q.fait) + changer + '</div>'
      + '</div>';
  }
  // LES MISES À PRIX : un avis de recherche par record du parc, le portrait
  // du jeu (son illustration du site) au milieu.
  function primes() {
    var l = (etat && etat.primes) || [];
    if (!l.length) return '';
    return section('Mises à prix')
      + '<div class="qt-note">Bats un <b>record absolu du parc</b> au Challenge en détrônant son tenant : Gromelin paie la prime. '
      + 'Une prime par record et par semaine.</div>'
      + '<div class="qt-avis">' + l.map(function (p) {
        var portrait = PORTRAIT[p.jeu];
        return '<div class="qt-affiche' + (p.ouverte ? '' : ' prise') + '">'
          + '<div class="qt-recherche">RECHERCHÉ</div>'
          + (portrait ? '<div class="qt-portrait"><img src="/images/' + portrait + '.png" alt=""></div>' : '<div class="qt-portrait vide">' + voyant(p) + '</div>')
          + '<div class="qt-aff-jeu">' + voyant(p) + esc(nomJeu(p)) + '</div>'
          + '<div class="qt-aff-record">' + esc(p.record) + '</div>'
          + '<div class="qt-aff-tenant">record de <b>' + esc(p.tenant) + '</b></div>'
          + '<div class="qt-aff-prime">' + piece(p.gain) + '</div>'
          + (p.ouverte ? '' : '<span class="qt-aff-prise">Prise par ' + esc(p.prisePar) + '</span>')
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
      + '<button type="button" class="qt-gelule qt-signer" data-i="' + Number(p.i) + '">Signer</button></div>'
      + '</div>';
  }
  function contrat() {
    var c = etat && etat.contrat;
    if (!c || c.etat === 'inactif') return '';
    var tete = section('Rien que pour toi');
    if (c.etat === 'aucun') {
      var sem = Math.max(1, Math.round((Number(c.fenetre) || 28) / 7));
      return tete + '<div class="qt-note">Joue au Challenge au moins <b>' + nombre(c.minJours || 3) + ' jours</b> sur '
        + (sem > 1 ? 'les ' + sem + ' dernières semaines' : 'la dernière semaine')
        + ', et Gromelin te taillera un contrat sur mesure, d’après tes propres scores.</div>';
    }
    if (c.etat === 'a_signer') {
      return tete + '<div class="qt-note">Trois contrats taillés sur tes scores du Challenge. <b>Signes-en un seul</b> : '
        + 'seuls les résultats obtenus après la signature comptent.</div>'
        + '<div class="qt-liste">' + (c.propositions || []).map(proposition).join('') + '</div>';
    }
    return tete + '<div class="qt-note">Ton contrat de la semaine. Seuls les résultats obtenus depuis la signature comptent.</div>'
      + '<div class="qt-liste">' + (c.quete ? carte(c.quete) : '') + '</div>';
  }
  function rendre() {
    var corps = document.getElementById('quetes-corps');
    if (!corps || !etat) return;
    if (!etat.acces) { corps.innerHTML = '<div class="qt-ferme">Gromelin n’a pas de quêtes pour toi en ce moment.</div>'; return; }
    var S = etat.semaine || {};
    var pied = 'Les kikooz sont versés dès que la quête est faite. Nouvelles quêtes chaque lundi à minuit ; une quête non finie dimanche est perdue.'
      + (etat.echange ? '<br>' + (etat.echange.fait ? 'Tu as changé une quête cette semaine (« ' + esc(etat.echange.fait.titre) + ' »).'
        : 'Une quête ne te plaît pas ? Tu peux en <b>changer une</b> par semaine.') : '');
    var dejaLa = corps.querySelector('.qt');
    var planches = (etat.quetes || []).map(carte).join('') || '<div class="qt-vide">Pas de quêtes cette semaine.</div>';
    // Le compteur de la boutique (gagnés / possibles), et le bonus de la semaine.
    var semaine = '<img class="qt-cabane" src="/minipixiz/sprites/shape429.svg" alt="" title="La cabane de Gromelin">'
      + '<span class="qt-sem-txt">Semaine ' + esc(S.lisible || '') + '<br>Nouvelles quêtes dans <b class="qt-compte">' + esc(reste(S.fin)) + '</b></span>'
      + '<span class="qt-sem-droite">' + (etat.bonus ? '<span class="qt-bonus' + (etat.bonus.verse ? ' verse' : '') + '" title="'
        + (etat.bonus.verse ? 'Bonus de la semaine versé' : 'Toutes les quêtes faites : un bonus d’XP') + '"><img src="/fb/Niveau.svg" alt="">'
        + (etat.bonus.verse ? '✔ ' : 'tout finir : ') + '+' + nombre(etat.bonus.xp) + ' XP</span>' : '')
      + '<span class="qt-compteur" title="kikooz gagnés / possibles cette semaine"><img src="' + PIECE + '" alt="kikooz"><b>' + nombre(etat.gagnes) + '</b>&nbsp;/ ' + nombre(etat.total) + '</span></span>';
    if (dejaLa) {
      // Déjà affichée : on ne touche ni à Gromelin ni à sa bulle (il parle peut-être).
      dejaLa.querySelector('.qt-semaine').innerHTML = semaine;
      dejaLa.querySelector('.qt-planches').innerHTML = planches;
      dejaLa.querySelector('.qt-contrat').innerHTML = contrat();
      dejaLa.querySelector('.qt-primes').innerHTML = primes();
      dejaLa.querySelector('.qt-pied').innerHTML = pied;
      return;
    }
    corps.innerHTML = '<div class="qt">'
      + '<div class="qt-tete"><div class="qt-cadre"><div class="qt-ecran" title="' + esc((etat.gromelin && etat.gromelin.nom) || 'Gromelin') + '"></div></div>'
      + '<div class="qt-dit" role="status" aria-live="polite" title="Clique pour la suite"><span class="qt-txt"></span><span class="qt-curseur"></span><span class="qt-suite"></span></div></div>'
      + '<div class="qt-semaine">' + semaine + '</div>'
      + '<div class="qt-planches qt-liste">' + planches + '</div>'
      + '<div class="qt-contrat">' + contrat() + '</div>'
      + '<div class="qt-primes">' + primes() + '</div>'
      + '<div class="qt-pied">' + pied + '</div>'
      + '</div>';
    var ecran = corps.querySelector('.qt-ecran');
    if (global.FPBouilleVignette && etat.gromelin) {
      ecran.innerHTML = FPBouilleVignette.html(etat.gromelin.bouille, { marge: FPBouilleVignette.MARGE_ECRAN });
      FPBouilleVignette.brancher(ecran);
    }
    corps.querySelector('.qt-dit').addEventListener('click', clicBulle);
    corps.querySelector('.qt-contrat').addEventListener('click', clicSigner);
    corps.querySelector('.qt-planches').addEventListener('click', clicChanger);
  }

  // ── L'échange : une quête par semaine (deux clics, comme la signature) ──────
  function clicChanger(e) {
    var b = e.target && e.target.closest ? e.target.closest('.qt-changer') : null;
    if (!b || b.disabled) return;
    if (!b.classList.contains('arme')) {
      var autres = document.querySelectorAll('#quetes-corps .qt-changer.arme');
      for (var k = 0; k < autres.length; k++) { autres[k].classList.remove('arme'); autres[k].textContent = 'Changer'; }
      b.classList.add('arme');
      b.textContent = 'Sûr ?';
      clearTimeout(b._qt);
      b._qt = setTimeout(function () { b.classList.remove('arme'); b.textContent = 'Changer'; }, 4000);
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
        if (ouverte) parler([esc((d && d.message) || 'Grumpf. Ça n’a pas marché. Réessaie.')]);
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
      for (var k = 0; k < autres.length; k++) { autres[k].classList.remove('arme'); autres[k].textContent = 'Signer'; }
      b.classList.add('arme');
      b.textContent = 'Sûr ?';
      clearTimeout(b._qt);
      b._qt = setTimeout(function () { b.classList.remove('arme'); b.textContent = 'Signer'; }, 4000);
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
        if (ouverte) parler([esc((d && d.message) || 'Grumpf. Ta signature n’est pas passée. Réessaie.')]);
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
    _debut: debut, _longueur: longueur, _carte: carte, _proposition: proposition,
    _etat: function (e) { etat = e; }, _primes: primes,
  };
})(typeof window !== 'undefined' ? window : globalThis);
