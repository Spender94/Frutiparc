/*
 * /light façon Frutiz — LE BUREAU (étape 1 : le shell).
 *
 * Le module ne s'active QUE sur desktop (≥ 768 px) : light.html appelle
 * demarrer() après la connexion, et tout le reste suit par deux crochets —
 * apresActivateTab(tab) à la fin du routeur de rubriques, poserFond(fond)
 * dans l'application des fonds d'écran. Sur mobile, aucun crochet ne fait
 * rien : la page reste exactement celle d'avant.
 *
 * Le principe est le REPARENTAGE, jamais la copie : la main bar, la grille
 * des rubriques et la ligne du compte quittent le tiroir mobile pour se poser
 * sur le bureau ; chaque panneau de rubrique quitte le flux plein écran pour
 * le corps d'une fenêtre, et y retourne à la fermeture. Les gestionnaires de
 * clics, les voyants, les chargements paresseux : tout reste branché, ce sont
 * les mêmes nœuds.
 *
 * Les fenêtres refont le bureau Flash : barre-titre à pastille de couleur
 * (la fraise des salons, la poire orange de l'historique…), bouton replier
 * (l'enroulement) et fermer, déplacement à la souris, premier plan au clic.
 */
'use strict';

window.BureauFrutiz = (function () {

  // Chaque rubrique fenêtrable : son panneau, son titre de fenêtre, son FRUIT
  // de pastille, et son gabarit. La pastille d'époque n'est pas un disque
  // teinté : c'est la BANDE DE FRUITS #198 de main.swf (une frame étiquetée
  // par type — gotoAndStop(type)), et une étiquette inconnue laisse la
  // frame 1 : L'ORANGE. D'où la loi : winChat → la fraise, alertes → le
  // citron, boutique → le fruit vert, et TOUT LE RESTE l'orange par défaut —
  // exactement le comportement du SWF (public/frutiz/PLAN.md).
  // `evenements` et `historique` partagent le panneau #evt-panel : la fenêtre
  // est UNIQUE et se retitre selon l'onglet demandé.
  var RUBRIQUES = {
    // PAS DE RUBRIQUE « chat » ICI — et ce n'est pas un oubli non plus.
    // `box.Chat` est une instance PAR SALON (`chatMng.setBox(user, this)`
    // 0x29fdc pour un privé, `channelMng.pushUniq(group)` 0x2a065 pour un
    // public) et `Slot.addBox` (0x35c98) en tient une LISTE : le bureau
    // d'époque ouvre autant de fenêtres de conversation qu'on veut. Chacune
    // est bâtie à la volée par `ouvrirSalon`, sous la clé « salon:<id> ».
    // PAS DE FORUM ICI — et ce n'est pas un oubli. `win.Forum` (0x6e136) est
    // la seule rubrique qui ne s'ouvre pas SUR le bureau : elle renvoie
    // dehors, dans une fenêtre de navigateur à elle. Voir `ouvrirForum`.
    // LES SCORES — `box.Score` (0xade18). Relevé 1:1 : 610 × 328, cadre
    // `#444444` compris ; la colonne de gauche fait 160 et celle de droite
    // 430, six pixels entre les deux.
    // `win.Score.initFrameSet` (sprite#869) : l'arbre à gauche et le tableau à
    // droite, côte à côte — `tree` min 160×60, `showFrame` min 300×200.
    scores:     { panneau: '#scores-panel',    titre: 'Scores',         l: 610, h: 328,
                  min: minFenetre(160 + 300, 200) },
    // LA BOUTIQUE — `win.Shop`. Relevé 1:1 : la fenêtre tient en 476 × 404,
    // contour compris, et s'ouvre au milieu. `winType = "winShop"` : le fruit
    // VERT en pastille.
    boutique:   { panneau: '#shop-sheet',      titre: 'Boutique', fruit: 'winShop',
                  l: 476, h: 404, min: minFenetre(140 + 300, 200), centre: true },
    // « MODIFIER MA FICHE » — `win.EditInfo`, la fenêtre que le bouton d'édition
    // (image 10, `frutiz_edit_info`) ouvre sur SA fiche. Le formulaire — mêmes
    // champs, même /do/smi — vient du panneau mobile #profil-sheet, rhabillé en
    // écorce verte (`frSheet`). EditInfo n'est pas dans la bande de fruits
    // (#198) : sa pastille retombe sur l'ORANGE par défaut, comme la recherche.
    'fiche-edit': { panneau: '#profil-sheet',  titre: 'Modifier ma fiche',
                    l: 404, h: 470, min: minFenetre(320, 300), centre: true },
    // LA MESSAGERIE — d'époque c'est un EXPLORATEUR (`box.Explorer` sur
    // `fileMng.inbox`), donc la fenêtre jaune et son gabarit : `win.Explorer`
    // pose `pos = {50, 50, 400, 400}` et s'ouvre AU MILIEU. Le relevé 1:1 la
    // donne en x 486..896 / y 146..546 — 411 × 401, contour compris. Le titre
    // vient du dossier (`setTitle(this.list.desc[0])`).
    mail:       { panneau: '#mail-panel',      titre: 'Boîte de réception',
                  fruit: 'winExplorer', l: 412, h: 402,
                  min: minFenetre(100, 28 + 100), centre: true },
    // LES DEUX JOURNAUX — `box.SiteLog` et `box.UserLog`, qui n'ajoutent rien
    // à `win.Log` (0x57281) qu'une icône : `linkIco` vaut « icoSiteLog » ou
    // « icoUserLog ». Et `win.Log.init` pose `flResizable = false` : ces
    // fenêtres-là ne se redimensionnent pas. Le gabarit vient du relevé 1:1 —
    // 314 × 246, cadre `#444444` compris.
    evenements: { panneau: '#evt-panel',       titre: 'Événements',     l: 314, h: 246, fixe: true,
                  min: minFenetre(300, 200) },
    historique: { panneau: '#evt-panel',       titre: 'Mon historique', l: 314, h: 246, fixe: true,
                  min: minFenetre(300, 200) },
    // `box.KikoozLog` (0x8b46e) : un TROISIÈME journal, du même `win.Log` que
    // les deux autres — d'où le même panneau et le même gabarit. Son titre est
    // celui de la table (`kikooz_log.title`), et il n'a pas de raccourci : on
    // y entre par le petit bouton blanc du haut de la boutique.
    kikoozlog:  { panneau: '#evt-panel',       titre: 'Historique Kikooz', l: 314, h: 246, fixe: true,
                  min: minFenetre(300, 200) },
    trombi:     { panneau: '#trombi-panel',    titre: 'Bouilloscope',   l: 780, h: 620 },
    // `win.Pref` (sprite#831) : l'arbre des rubriques (menuFrame min 140×60)
    // et le panneau de droite (showFrame min 200×200), côte à côte. Le titre
    // est celui du constructeur (`box.Pref`, 0xc9af5) : `pref.title` vaut
    // « Mes préférences » dans lang_french.as, pas « Préférences ».
    reglages:   { panneau: '#reglages-panel',  titre: 'Mes préférences', l: 560, h: 620,
                  min: minFenetre(140 + 200, 200) },
    grapiz:     { panneau: '#grapiz-panel',    titre: 'Grapiz',         l: 900, h: 660 },
    bandas:     { panneau: '#bandas-panel',    titre: 'Frutibandas',    l: 900, h: 660 },
    swapou:     { panneau: '#swapou-panel',    titre: 'Swapou',         l: 900, h: 660 },
    miniwave:   { panneau: '#miniwave-panel',  titre: 'Mini-Wave',      l: 900, h: 700 },
    minipixiz:  { panneau: '#minipixiz-panel', titre: 'MiniPixiz',      l: 900, h: 700 },
    snake3:     { panneau: '#snake3-panel',    titre: 'Frutisnake',     l: 880, h: 740 },
    minifever:  { panneau: '#minifever-panel', titre: 'Mini-Fever',     l: 880, h: 760 },
    jamajama:   { panneau: '#jamajama-panel',  titre: 'JamaJama',       l: 620, h: 640 },
    // « Salons publics » — la SEULE fenêtre du bureau qui n'existe pas côté
    // mobile : le light y met un menu déroulant, main.swf une fenêtre à part
    // entière (`win.RoomList`, 0xbebb6). Son gabarit vient du bytecode et du
    // relevé 1:1 : `min: {w: 200, h: 240}` est écrit dans `initFrameSet`
    // (0xbec80), et la fenêtre s'ouvre à 265×288 sur le rendu d'époque.
    salons:     { panneau: '#salons-panel',    titre: 'Salons publics', fruit: 'winChat',
                  l: 265, h: 288, min: minFenetre(200, 240) },
    // « Recherche » — `win.Search` (0x855db). L'autre fenêtre sans équivalent
    // mobile. Son gabarit est écrit dans `init` : `mWidth = 270` et
    // `flResizable = false`. La largeur suit la loi du journal (300 de contenu
    // → 314 de fenêtre) : 270 + 14 = 284. La HAUTEUR, elle, ne se fixe pas —
    // `flDocumentFit` la fait suivre le contenu, et `ajusterFenetreRecherche`
    // la recalcule à chaque dépliage et à chaque page de résultats. Le `h` ci-
    // dessous n'est donc que celui de la fenêtre VIDE, à l'ouverture.
    // `winType = "winSearchFrutiz"` : une étiquette que la bande de fruits
    // #198 ne connaît pas, donc l'ORANGE par défaut en pastille.
    recherche:  { panneau: '#recherche-panel', titre: 'Recherche', fruit: 'winSearchFrutiz',
                  l: 284, h: 84, fixe: true, min: minFenetre(270, 20 + 24) },
    // GASPARD — `box.Help` / `win.Help` (0xbd7db). C'est une fenêtre de
    // DIALOGUE, comme un salon : `win.Help` étend `win.Dialog`, et
    // `getIconLabel` renvoie « winChat » — d'où la pastille du chat.
    // Son gabarit ne s'écrit nulle part : `win.Help` ne pose ni `pos` ni
    // `moveToCenter`, donc `recal` en fait le MINIMUM de son contenu, comme
    // pour une conversation neuve. C'est `minGaspard` qui le calcule, cadre
    // par cadre — 240 × 248 fenêtre nue, plus large quand on ouvre les
    // bouilles ou les présents. Le `l`/`h` à zéro laisse `recal` décider.
    gaspard:    { panneau: '#gaspard-panel', titre: 'Gaspard', fruit: 'winChat',
                  l: 0, h: 0, min: function () { return minGaspard(); } },
    // L'EXPLORATEUR — `win.Explorer`, la fenêtre JAUNE (winType « winExplorer »,
    // d'où la banane en pastille). Son gabarit est écrit dans `init` :
    // `pos = {x:50, y:50, w:400, h:400}` — 402 × 402 le contour compris, ce
    // que le relevé 1:1 confirme. Deux dossiers l'ouvrent depuis le bureau ;
    // c'est la MÊME fenêtre, seul l'uid de départ change.
    // `init` finit par `moveToCenter()` : l'explorateur est la SEULE fenêtre du
    // bureau à s'ouvrir au milieu — toutes les autres se posent dans le coin.
    'ex-disques':    { panneau: '#ex-disques-panel',    titre: 'Mes disques', fruit: 'winExplorer',
                       l: 402, h: 402, min: minFenetre(100, 28 + 100), centre: true },
    'ex-inventaire': { panneau: '#ex-inventaire-panel', titre: 'Inventaire',  fruit: 'winExplorer',
                       l: 402, h: 402, min: minFenetre(100, 28 + 100), centre: true },
  };

  function fruitUrl(nom) { return '/frutiz/sprites/fruit_' + (nom || 'default') + '.svg'; }

  var actif = false;
  var fenetres = {};                    // id de panneau → { fen, corps, panneau, origine, txt, pastille }
  var zCourant = 20;                    // premier plan : le dernier cliqué
  var fondCourant = null;               // le dernier fond posé (repeint au resize)

  function $(s) { return document.querySelector(s); }

  // ── Reparentage réversible ────────────────────────────────────────────
  // On note d'où vient le nœud pour l'y remettre à l'identique : le parent et
  // le voisin suivant du moment suffisent (les panneaux ne bougent pas entre
  // eux pendant qu'une fenêtre est ouverte).
  function deplacer(noeud, vers) {
    var origine = { parent: noeud.parentNode, suivant: noeud.nextSibling };
    vers.appendChild(noeud);
    return origine;
  }
  function rendre(noeud, origine) {
    if (!origine || !origine.parent) return;
    // Le voisin noté peut être PARTI à son tour dans une fenêtre : on rend
    // alors le nœud en fin de parent plutôt que de viser un repère absent.
    var suivant = (origine.suivant && origine.suivant.parentNode === origine.parent)
      ? origine.suivant : null;
    origine.parent.insertBefore(noeud, suivant);
  }

  // ── Le fond d'écran du bureau ─────────────────────────────────────────
  // La transcription de WallPaperMng.onStageResize, comme le tiroir mobile —
  // mais en PAYSAGE : l'image d'origine (fond.url), contenue sans jamais être
  // agrandie, centrée dans la zone qui commence sous la main bar (cornerY).
  function poserFond(fond) {
    fondCourant = fond || null;
    if (!actif) return;
    var bureau = $('#bureau');
    if (!bureau) return;
    if (!fond || !fond.url) {
      bureau.style.background = '#ADE76B';
      bureau.style.removeProperty('--fond-txt');
      bureau.style.removeProperty('--fond-halo');
      return;
    }
    var arr = String(fond.color || '').split(';');
    var hex = function (v) {
      v = String(v || '').trim();
      return /^[0-9a-fA-F]{6}$/.test(v) ? '#' + v : null;
    };
    bureau.style.backgroundColor = hex(arr[0]) || '#ADE76B';
    bureau.style.backgroundImage = 'url("' + fond.url + '")';
    bureau.style.backgroundRepeat = 'no-repeat';
    var txt = arr.length >= 2 ? (hex(arr[1]) || '#000000') : null;
    if (txt) bureau.style.setProperty('--fond-txt', txt);
    else bureau.style.removeProperty('--fond-txt');
    var halo = '255,255,255';
    if (txt) {
      var v = parseInt(txt.slice(1), 16);
      var lum = 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
      if (lum > 140) halo = '0,0,0';
    }
    bureau.style.setProperty('--fond-halo', 'rgba(' + halo + ',.85)');
    var img = new Image();
    img.onload = function () {
      var dispo = bureau.getBoundingClientRect();
      var coin = $('#bureau-coin');
      // La barre REPLIÉE (« mode rapide ») libère le haut de l'écran : le
      // fond se recentre sur toute la hauteur, comme après `main.onResize()`.
      var cornerY = coin
        ? Math.max(0, coin.offsetHeight + coin.offsetTop + repli.barre) : 0;
      var largeur = dispo.width;
      var hauteur = Math.max(0, dispo.height - cornerY);
      var w = img.naturalWidth, h = img.naturalHeight;
      var e = (w <= largeur && h <= hauteur) ? 1 : Math.min(largeur / w, hauteur / h);
      bureau.style.backgroundSize = Math.round(w * e) + 'px ' + Math.round(h * e) + 'px';
      bureau.style.backgroundPosition =
        Math.round((largeur - w * e) / 2) + 'px ' +
        Math.round(cornerY + (hauteur - h * e) / 2) + 'px';
    };
    img.onerror = function () {
      bureau.style.backgroundSize = 'contain';
      bureau.style.backgroundPosition = 'center center';
    };
    img.src = fond.url;
  }

  // ── Les fenêtres — le protocole FANTÔME de WinStandard ────────────────
  // Transcrit du bytecode (public/frutiz/PLAN.md porte les décalages) : on ne
  // déplace jamais la fenêtre en direct. La prise attache un FANTÔME — la
  // silhouette blanche win.Ghost — qui suit la souris rigidement pendant que
  // la fenêtre reste en place ; au lâcher, applyGhost recopie la position du
  // fantôme, recal borne au bureau, et moveToPos fait GLISSER la fenêtre vers
  // sa place, si l'animation est active.
  var FLUIDE = true;                    // la préférence win_flMoveAnim du SWF

  /*
   * LA VITESSE DU GLISSEMENT, relevée au pas près.
   *
   * `moveToPos` (0x55b47) ne bouge rien lui-même : il confie la fenêtre à
   * `AnimList.addSlide` (0x51514), qui pose un `setInterval` de **25 ms** et
   * appelle `AnimList.slide` (0x515d1) à chaque battement —
   *
   *     var k = Math.pow(0.8, tmod × ratio);
   *     regular.x = regular.x × k + pos.x × (1 − k);
   *     regular.y = regular.y × k + pos.y × (1 − k);
   *     _x = regular.x; _y = regular.y;
   *     if (Math.round(regular.y) == Math.round(pos.y)
   *      && Math.round(regular.x) == Math.round(pos.x)) { _x = pos.x; _y = pos.y; remove(); }
   *
   * `ratio` vaut 1 (addSlide le met à 1 quand il n'est pas donné, et
   * `moveToPos` n'en passe pas), et `tmod` vaut 1 : `_global.tmod = 1` est
   * posé une fois pour toutes par le CLIENT FRUSION (frusion_client.swf,
   * offset 5813) et main.swf ne fait que le lire — vingt-trois fois, jamais
   * en écriture.
   *
   * Donc **k = 0,8** : la fenêtre couvre UN CINQUIÈME du chemin restant tous
   * les 25 ms. Le portage en prenait un tiers — d'où une arrivée deux fois
   * trop vive. Il faut ~10,3 pas (258 ms) pour en faire 90 %, contre 5,7
   * (142 ms) avec un tiers.
   *
   * L'ARRÊT n'est pas « à moins d'un demi-pixel » mais « dans le même pixel
   * entier », les deux coordonnées ARRONDIES : c'est plus tolérant sur un
   * axe (1,6 → 2,4 s'arrête) et plus strict sur l'autre (1,4 → 1,6 continue).
   */
  var GLISSE_K = 0.8;                   // Math.pow(0.8, tmod × ratio), tmod = ratio = 1
  var GLISSE_MS = 25;                   // le setInterval d'addSlide

  function premierPlan(fen) { fen.style.zIndex = String(++zCourant); }

  /* ── L'ARRIVÉE DES ENTRÉES D'UN MENU (`cp.Tree.addPhysElement`, 0x7b6xx) ──
   *
   * Une entrée d'arbre — un classement dans la fenêtre des scores, une
   * rubrique ou un article dans la boutique — ne PARAÎT pas à sa place : elle
   * y arrive. Le bytecode, dans l'ordre :
   *
   *     content.attachMovie(link, "caps" + n, 80000 - n, …);
   *     caps.pos.x = x + marginLeft;  caps._x = caps.pos.x;
   *     caps._y = last._y + last.height / 2;          ← elle NAÎT au milieu
   *     if (last !== undefined) {                        de la précédente
   *       caps.moveTo(last.pos.y + last.height);      ← puis GLISSE à sa place
   *       caps.fadeIn();                              ← en se colorant
   *       caps.id = last.id + 1;
   *     } else {
   *       caps.moveTo(0, true);                       ← la première se pose net
   *       caps.id = 0;
   *     }
   *
   * `Capsule.moveTo(y, flDirect)` (0x9f0aa) pose `pos.y` puis, sans
   * `flDirect`, confie le trajet à `tree.animList.addSlide(…, 2)` — le même
   * amortissement que les fenêtres, au ratio 2 près. `Capsule.fadeIn`
   * (0x9f147) peint la capsule de la couleur du panneau
   * (`FEMC.setPColor(this, c, 0)`) et laisse `addPaint` la ramener à 100 : de
   * la teinte du fond à ses propres couleurs.
   *
   * LA LISTE EST BÂTIE D'UN COUP : `last._y` n'a pas encore bougé quand la
   * suivante naît, si bien que les décalages se cumulent de moitié en moitié.
   * Chaque entrée démarre donc à LA MOITIÉ de son décalage final, et la
   * colonne entière se déplie depuis le haut. C'est tout ce que cette
   * fonction écrit : le reste est une transition CSS, dont la courbe est
   * l'équivalent continu de `_y = _y × 0.64 + cible × 0.36` toutes les 25 ms.
   */
  function animerEntrees(hote) {
    if (!hote || !FLUIDE) return;
    // Une copie : la collection d'enfants est VIVANTE, et la colonne peut se
    // refaire entre les deux battements ci-dessous.
    var l = [].slice.call(hote.children);
    if (l.length < 2) return;
    var haut = l[0].getBoundingClientRect().top;
    var pris = [];
    for (var i = 1; i < l.length; i++) {
      var dy = l[i].getBoundingClientRect().top - haut;
      if (dy <= 0) continue;
      l[i].style.setProperty('--cy', (-dy / 2) + 'px');
      l[i].classList.add('caps-entre');
      pris.push(l[i]);
    }
    if (!pris.length) return;
    // DEUX battements : le premier PEINT l'état de départ, le second lâche la
    // transition. Un simple recalcul forcé ne suffit pas — le navigateur
    // fusionne les deux styles quand ils tombent dans le même cycle, et
    // l'entrée se fait alors sans mouvement du tout.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var j = 0; j < pris.length; j++) pris[j].classList.remove('caps-entre');
      });
    });
  }

  function posDe(fen) {
    // La FICHE se place par `--fx`/`--fy` — sa feuille tactile occupe déjà
    // `left`/`top`. On lit l'une ou l'autre paire, et tout ce qui suit
    // (`recal`, `glisserVers`, `bornerDansEcran`) vaut pour elle comme pour
    // n'importe quelle fenêtre : c'en est une (`win.Frutiz extends
    // WinStandard`).
    var x = parseFloat(fen.style.left);
    var y = parseFloat(fen.style.top);
    if (isNaN(x)) x = parseFloat(fen.style.getPropertyValue('--fx'));
    if (isNaN(y)) y = parseFloat(fen.style.getPropertyValue('--fy'));
    return {
      x: isNaN(x) ? 0 : x,
      y: isNaN(y) ? 0 : y,
      w: fen.offsetWidth,
      h: fen.offsetHeight,
    };
  }

  // recal (0x54126) : la taille bornée aux minima et au bureau, la position
  // gardée dans la zone visible.
  // Le coin du bureau : main.cornerY = 106 (MainBar.init, 0x6b5e2) — la
  // barre (76) plus la rangée d'onglets. recal (0x54126) borne les fenêtres
  // à ce coin : une fenêtre ne passe JAMAIS au-dessus de la zone de la barre
  // (et la barre, plus profonde, recouvre ce qui s'en approche).
  // Et `main.cornerX = wSide` (SideList.init, 0xa0a5b) : le bureau commence
  // après la bande des contacts — 9 px, ou 129 quand la liste est dépliée.
  var CORNER_Y = 106, CORNER_X = 9;
  // ── LES MINIMA D'UNE FENÊTRE ─────────────────────────────────────────────
  // `WinStandard.minimum` n'est pas une constante : c'est `frameSet.minInt`,
  // le minimum INTERNE de l'arbre de cadres, recalculé à chaque changement
  // (`onFrameSetUpdate`, 0x5493d). Ouvrir un panneau RELÈVE donc le minimum,
  // et `recal` fait grandir la fenêtre si elle était en dessous. Un minimum
  // peut donc être une fonction ici, et non un couple figé.
  function minDe(m) { return typeof m === 'function' ? m() : (m || { w: 160, h: 60 }); }

  /*
   * LE MINIMUM D'UNE FENÊTRE, À PARTIR DE CELUI DE SON CONTENU.
   *
   * `Frame.updateMinInt` (0x479ba) remonte l'arbre : un cadre de type « w »
   * empile ses enfants (largeur = le plus large, hauteur = la somme), un cadre
   * de type « h » les range côte à côte (l'inverse), et chacun prend au moins
   * son propre `min`. L'arbre qu'`initFrameSet` (0x547f9) bâtit autour du
   * contenu est toujours le même —
   *
   *     frameSet   type w
   *       top      type w   min { w: 0, h: 6 }  + winTopBar (compo, min 200×20)
   *       center   type h
   *         left   type w   min { w: 6, h: 0 }
   *         center type w   ← LE CONTENU (`this.main`)
   *         right  type w   min { w: 6, h: 0 }
   *       bottom   type w   min { w: 0, h: 6 }
   *
   * — d'où, en deux lignes : la largeur ajoute les deux bandes de 6 et ne
   * descend jamais sous les 200 de la barre de titre ; la hauteur ajoute la
   * barre (20) et la bande du bas (6).
   *
   * Ces minima ne changent RIEN à la taille d'ouverture : `recal` ne fait que
   * remonter une fenêtre trop petite, et chaque relevé 1:1 est déjà au-dessus.
   * Ils bornent la POIGNÉE de redimensionnement, et c'est tout.
   */
  function minFenetre(w, h) { return { w: Math.max(200, w + 12), h: h + 26 }; }

  function recal(pos, minimum) {
    var vw = window.innerWidth, vh = window.innerHeight;
    minimum = minDe(minimum);
    pos.w = Math.max(minimum.w, Math.min(pos.w, vw - CORNER_X));
    pos.h = Math.max(minimum.h, Math.min(pos.h, vh - CORNER_Y));
    pos.x = Math.max(CORNER_X, Math.min(pos.x, vw - pos.w));
    pos.y = Math.max(CORNER_Y, Math.min(pos.y, vh - pos.h));
    return pos;
  }

  // `WinStandard.onStageResize` (0x54709) ne fait qu'un `update()` — donc, en
  // mode bureau, `recal(); moveToPos()`. Une fenêtre que l'écran rétréci
  // repousse ne SAUTE donc pas dans le cadre : elle y glisse, comme après un
  // déplacement. (Rien à faire quand elle y est déjà : le SWF appelle bien
  // `moveToPos`, mais l'animation s'arrête au premier battement.)
  function bornerDansEcran(fen) {
    var f = null;
    for (var id in fenetres) if (fenetres[id].fen === fen) f = fenetres[id];
    // `recal` corrige SUR PLACE et rend le même objet : on garde une copie de
    // l'avant, sans quoi la comparaison se ferait avec elle-même.
    var avant = posDe(fen);
    var pos = recal(posDe(fen), (f && f.minimum) || { w: 160, h: 60 });
    if (Math.round(avant.x) === Math.round(pos.x)
      && Math.round(avant.y) === Math.round(pos.y)) return;
    glisserVers(fen, pos);
  }

  // moveToPos (0x55b47) → AnimList.slide (0x515d1) : voir la note de GLISSE_K.
  // Le SWF garde la position EXACTE dans `regular` et n'arrondit que pour
  // l'affichage — arrondir la position elle-même à chaque pas ferait boiter
  // la fin du trajet, où l'on n'avance plus que d'une fraction de pixel.
  // Le troisième argument, `poser`, dit COMMENT écrire la position. Les
  // fenêtres l'écrivent dans `left`/`top` ; la fiche, dont la feuille tactile
  // occupe déjà ces deux propriétés, l'écrit dans ses variables `--fx`/`--fy`.
  // Le mouvement, lui, est le même — c'est tout l'intérêt.
  function glisserVers(fen, cible, poser) {
    poser = poser || function (x, y) {
      fen.style.left = x + 'px';
      fen.style.top = y + 'px';
    };
    if (fen._glisse) clearInterval(fen._glisse);
    if (!FLUIDE) { poser(Math.round(cible.x), Math.round(cible.y)); return; }
    // `addSlide` remet `regular` sur la position courante du clip.
    var depart = posDe(fen);
    var reg = { x: depart.x, y: depart.y };
    fen._glisse = setInterval(function () {
      reg.x = reg.x * GLISSE_K + cible.x * (1 - GLISSE_K);
      reg.y = reg.y * GLISSE_K + cible.y * (1 - GLISSE_K);
      poser(Math.round(reg.x), Math.round(reg.y));
      if (Math.round(reg.y) === Math.round(cible.y)
        && Math.round(reg.x) === Math.round(cible.x)) {
        reg.x = cible.x; reg.y = cible.y;
        poser(Math.round(cible.x), Math.round(cible.y));
        clearInterval(fen._glisse); fen._glisse = null;
      }
    }, GLISSE_MS);
  }

  // `hote` : la couche où poser la silhouette. Les fenêtres la posent dans
  // `#bureau-fenetres` ; la fiche, qui vit une couche au-dessus, la pose chez
  // elle — sans quoi le fantôme passerait DERRIÈRE ce qu'on déplace.
  function creerFantome(pos, hote) {
    var fantome = document.createElement('div');
    fantome.className = 'fen-fantome';
    fantome.style.left = pos.x + 'px';
    fantome.style.top = pos.y + 'px';
    // border-box : la bordure de 2 px du fantôme compte dans sa taille, comme
    // la silhouette du clip couvrait exactement le cadre de la fenêtre.
    fantome.style.boxSizing = 'border-box';
    fantome.style.width = pos.w + 'px';
    fantome.style.height = pos.h + 'px';
    (hote || $('#bureau-fenetres')).appendChild(fantome);
    return fantome;
  }

  // initDrag/endDrag (0x53b7b/0x53d6d) : le déplacement au fantôme.
  function rendreDeplacable(fen, titre) {
    titre.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('.fen-btn')) return;
      ev.preventDefault();
      premierPlan(fen);
      var pos = posDe(fen);
      var fantome = creerFantome(pos);
      var decalx = ev.clientX, decaly = ev.clientY;
      var glisser = function (e2) {
        fantome.style.left = Math.round(pos.x + e2.clientX - decalx) + 'px';
        fantome.style.top = Math.round(pos.y + e2.clientY - decaly) + 'px';
      };
      var lacher = function (e2) {
        document.removeEventListener('pointermove', glisser);
        document.removeEventListener('pointerup', lacher);
        // applyGhost : la position du fantôme devient la position voulue,
        // recal la borne, moveToPos y fait glisser la fenêtre.
        var cible = recal({
          x: pos.x + e2.clientX - decalx,
          y: pos.y + e2.clientY - decaly,
          w: pos.w, h: pos.h,
        }, { w: pos.w, h: pos.h });
        fantome.remove();
        glisserVers(fen, cible);
      };
      document.addEventListener('pointermove', glisser);
      document.addEventListener('pointerup', lacher);
    });
  }

  // ── LE PANNEAU DES CONTACTS (SideList, DoInitAction #847 0xa05b7) ──────
  // `toggle` (0xa0e2a) appelle `activate` ou `deActivate`, et toute la
  // différence tient dans UNE borne : `main.cornerX` passe de `wSide` (9) à
  // `wMain + wSide` (129). Le bureau entier suit — la barre, l'onglet, la
  // rangée d'icônes et le bornage des fenêtres —, ce que la feuille de style
  // reproduit avec `--cornerX`. Relevé 1:1 : la première icône passe du
  // centre 53 au centre 173, soit exactement +120 = wMain.
  //
  // La liste elle-même vient de `buildList`/`buildElement` : une ligne fait
  // **18 px**, chaque niveau de dossier décale de **5 px**, et un dossier
  // REPLIÉ ajoute un cinquième de ligne (`currentLine += 0.2`). Les dossiers
  // se replient au clic sur leur titre (`fond.onPress` bascule `element.open`
  // puis rebâtit la liste).
  // Les voyants de la bande VIVENT : d'époque le serveur pousse le statut de
  // chaque contact (`onStatusObj`) et `userSlot` change d'icône sur-le-champ.
  // Le light n'a pas cette poussée hors salon — il relit donc le carnet à
  // chaque ouverture, puis toutes les trente secondes tant qu'il est ouvert.
  var contactsMinuteur = null;

  function basculerContacts() {
    var ouvert = document.body.classList.toggle('contacts-ouverts');
    CORNER_X = ouvert ? 129 : 9;
    // `activate` termine par `main.onResize()` : les fenêtres sont rebornées.
    for (var id in fenetres) bornerDansEcran(fenetres[id].fen);
    bornerFiche();
    if (contactsMinuteur) { clearInterval(contactsMinuteur); contactsMinuteur = null; }
    if (!ouvert) return;
    chargerContacts();
    contactsMinuteur = setInterval(chargerContacts, 30000);
  }

  // `UserSlot.onStatusObj` donne l'ordre exact de ce que porte l'icône :
  //
  //     status == undefined   → rien
  //     présence 0            → image 1 de `ico` : la pastille SAUMON
  //     status.internal       → l'icône du JEU, à la place de la pastille
  //     status.external       → celle du jeu externe
  //     sinon                 → image 2 : la pastille VERTE
  //
  // Et le carnet passe `statusDspMode: "all"` (SideList.buildElement) : il
  // montre TOUT, hors ligne compris. C'est le même clip `userSlot` que la
  // liste des connectés d'un salon — seul le voyant de jeu manquait ici.
  function ligneContact(c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sl-contact ' + (c.enLigne ? 'en-ligne' : 'hors-ligne');
    b.title = c.pseudo + (c.jeu ? ' — ' + libelleJeu(c.jeu)
      : (c.enLigne ? ' — en ligne' : ' — hors ligne'));
    b.innerHTML = '<span class="voyant"></span><span class="nom"></span>';
    b.querySelector('.nom').textContent = c.pseudo;
    // L'encre du pseudo suit le GENRE (`UserSlot.onInfoBasic`, 0x63a51) : les
    // règles vivent dans light.html, elles valent pour le carnet comme pour la
    // liste des connectés — c'est le même `userSlot`.
    if (c.genre) b.setAttribute('data-genre', c.genre);
    if (c.enLigne && c.jeu) {
      var v = b.querySelector('.voyant');
      v.classList.add('jeu');
      v.style.backgroundImage = "url('" + voyantUrl(c.jeu) + "'), "
        + "url('/frutiz/sprites/sl-icone-fond.svg')";
    }
    b.addEventListener('click', function () {
      if (Date.now() - dernierDepot < 250) return;   // c'était un GLISSÉ
      ouvrirFiche(c.pseudo);
    });
    // Un contact du carnet s'ATTRAPE. `UserSlot.initButtons` ne passe pas par
    // le contrôle de distance des fichiers : il branche `createDragIcon` sur
    // `onDragOut` — le glissé part dès que le curseur QUITTE le bouton, sans
    // seuil. Et ce qu'il emporte est un fichier « à naître » :
    //
    //     createDragIcon({ uid: "new", type: "contact",
    //                      desc: [userName + "@frutiparc.com"],
    //                      name: userName, fbouille: this.fbouille })
    //
    // — l'uid « new » est ce qui fait prendre à `FPDesktop.onDrop` la branche
    // `fileMng.make` : déposer un contact CRÉE le raccourci.
    attraperContact(b, c);
    return b;
  }

  // `onDragOut` : le bouton perd le curseur alors qu'il est enfoncé.
  function attraperContact(b, c) {
    b.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      var parti = false;
      var boite = b.getBoundingClientRect();
      var dehors = function (e) {
        if (!parti) {
          if (e.clientX >= boite.left && e.clientX <= boite.right
            && e.clientY >= boite.top && e.clientY <= boite.bottom) return;
          parti = true;
          glisseur.source = null;              // le slot RESTE en place
          creerIconeGlissee({
            uid: 'new', type: 'contact',
            desc: [c.pseudo + '@frutiparc.com', c.bouille || ''],
            name: c.pseudo,
          }, dessinBouille(c.bouille || ''), e.clientX, e.clientY);
        }
        glisseur.ctrl = !!(e.ctrlKey || e.metaKey);
        glisseur.el.style.left = e.clientX + 'px';
        glisseur.el.style.top = e.clientY + 'px';
      };
      var lache = function (e) {
        document.removeEventListener('pointermove', dehors);
        document.removeEventListener('pointerup', lache, true);
        if (!parti) return;
        e.preventDefault(); e.stopPropagation();
        finirGlisser(e.clientX, e.clientY);
      };
      document.addEventListener('pointermove', dehors);
      document.addEventListener('pointerup', lache, true);
    });
  }

  // Le voyant d'un jeu, celui-là même que la liste des connectés pose à
  // gauche du pseudo. Seul Swapou change de nom au passage (swapou2 côté
  // serveur), comme dans `VOYANT_ASSET_KEY` du light.
  function voyantUrl(jeu) {
    return '/fb/voyant_' + (jeu === 'swapou2' ? 'swapou' : jeu) + '.png';
  }
  var JEUX_NOM = {
    forum: 'Forum', bkiwi: 'Burning Kiwi', mb2: 'MotionBall 2', swapou: 'Swapou',
    swapou2: 'Swapou', snake3: 'Frutisnake', bandas: 'Frutibandas', grapiz: 'Grapiz',
    kaluga: 'Kaluga', miniwave: 'Mini-Wave', minipixiz: 'Minipixiz',
    minifever: 'Mini-Fever',
  };
  function libelleJeu(jeu) {
    var n = JEUX_NOM[jeu] || jeu;
    return jeu === 'forum' ? 'lit le forum' : 'joue à ' + n;
  }

  /*
   * `win.Alert` (DoInitAction sprite#812) — LA BOÎTE D'ALERTE DU BUREAU.
   *
   * Deux cadres et rien d'autre, écrits dans son `initFrameSet` :
   *
   *     frameDoc     cpDocument frSystem   min { w: 200, h: 80 }
   *     frameButton  cpDocument frSystem   min { w: 200, h: 24 }
   *
   * `init` finit par `moveToCenter()` : elle s'ouvre au milieu, comme
   * l'explorateur. Le bouton dit « Fermer » — `_global.langText.close`.
   *
   * C'est ce que `openErrorAlert` ouvre, et c'est par là que passe le refus de
   * `createChannel` : « Impossible de créer ce salon : » suivi du motif.
   */
  var alerteSeq = 0;
  function alerte(titre, texte) {
    var phrase = String(titre || '') + String(texte || '');
    if (!actif) { window.alert(phrase); return null; }
    var id = 'fb-alerte-' + (++alerteSeq);
    var p = document.createElement('div');
    p.id = id;
    p.className = 'fb-alerte-panneau';
    var doc = document.createElement('div');
    doc.className = 'fb-alerte-doc';
    doc.textContent = phrase;
    var pied = document.createElement('div');
    pied.className = 'fb-alerte-pied';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'fb-alerte-ok';
    ok.textContent = 'Fermer';
    pied.appendChild(ok);
    p.appendChild(doc);
    p.appendChild(pied);
    $('#app').appendChild(p);
    RUBRIQUES[id] = {
      panneau: '#' + id, titre: 'Frutiparc', fruit: 'winAlert',
      l: 260, h: 130, min: minFenetre(200, 80 + 24), centre: true, fixe: true,
    };
    var partir = function () {
      fermerFenetre(id);
      delete RUBRIQUES[id];
      p.remove();
    };
    ok.addEventListener('click', partir);
    ouvrirFenetre(id);
    var f = fenetres[id];
    if (f && f.fen) {
      var croix = f.fen.querySelector('.fen-btn.fermer');
      if (croix) croix.addEventListener('click', function () { delete RUBRIQUES[id]; p.remove(); });
    }
    ok.focus();
    return id;
  }

  // ── « Salons publics » (`win.RoomList` 0xbebb6, `cp.RoomList` 0x70733) ──
  //
  // Sur mobile, choisir son salon c'est dérouler un `<select>`. Sur le bureau
  // d'époque, c'est une FENÊTRE : la liste des salons avec leur affluence, une
  // rangée par salon, et sous elle une barre pour en créer un.
  //
  // `cp.RoomList.setList` (0x70881) donne la loi au mot près :
  //
  //     pal.bg = style.color[0]                  // frRoomList → colorSet.pink
  //     pour chaque salon i :
  //       texte  = nom + " (" + nbUser + ")"
  //       hauteur = 20                            // reg7, écrit en dur
  //       clic   = win.box.join(salon.id)
  //       si i % 2 == 0 : fond = pal.bg.shade     // UNE rangée sur deux
  //       butText._y = i * 20
  //
  // Les teintes sont relevées au pixel sur le rendu Ruffle 1:1 (scratchpad/
  // ref3-salons.png) : rangée paire `#FEABAB`, impaire `#FEC9C9`, survol
  // `#FFF2F2` (paires ET impaires), encre `#BA4444`. Le SWF ne marque PAS le
  // salon courant — on ne le marque pas non plus.
  var salonsPanneau = null;

  function panneauSalons() {
    if (salonsPanneau) return salonsPanneau;
    var p = document.createElement('section');
    p.className = 'panel';
    p.id = 'salons-panel';
    var liste = document.createElement('div');
    liste.className = 'sp-liste';
    // La barre du bas : `initFrameSet` (0xbec4d) y pose, dans cet ordre, un
    // espace de 4, un `<b l="butPushStandard">` étiqueté `chat.create_channel`,
    // un espace de 10, puis le champ `<i v="roomName">`.
    var pied = document.createElement('div');
    pied.className = 'sp-pied';
    var creer = document.createElement('button');
    creer.type = 'button';
    creer.className = 'sp-creer';
    creer.textContent = 'créer un salon';
    var nom = document.createElement('input');
    nom.type = 'text';
    nom.className = 'sp-nom';
    nom.maxLength = 60;
    nom.setAttribute('aria-label', 'Sujet du salon à créer');
    /*
     * `box.RoomList.createChannel(n)` (0xa65a5), au mot près :
     *
     *     if (n === undefined || n.length === 0) {
     *       openErrorAlert(Lang.fv("error.chat.topic_required"));
     *       return;
     *     }
     *     channelMng.create(n);
     *     this.close();
     *
     * Le salon porte le SUJET qu'on lui donne, et il est PRIVÉ au sens du
     * listing : il n'apparaît que dans la fenêtre de ceux qui y sont (c'est le
     * serveur qui le retire du `<q>` des autres). Redonner un sujet déjà pris
     * y entre au lieu d'ouvrir un doublon — c'est ainsi qu'on invite.
     */
    var lancerCreation = function () {
      var S = window.SalonsBureau;
      if (!S || !S.creer || creer.disabled) return;
      var sujet = nom.value.trim();
      if (!sujet) {
        alerte('Impossible de créer ce salon : ',
          'Vous devez spécifier un sujet pour créer un salon.');
        nom.focus();
        return;
      }
      creer.disabled = true;
      S.creer(sujet).then(function () {
        nom.value = '';
        creer.disabled = false;
        // `this.close()` : la fenêtre des salons se referme derrière soi, celle
        // du salon vient de s'ouvrir. (La clé d'une fenêtre est celle de son
        // PANNEAU, pas de sa rubrique — cf. `ouvrirFenetre`.)
        fermerFenetre('salons-panel');
      }, function (e) {
        creer.disabled = false;
        alerte('Impossible de créer ce salon : ', (e && e.message) || '');
      });
    };
    creer.addEventListener('click', lancerCreation);
    nom.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); lancerCreation(); }
    });
    pied.appendChild(creer);
    pied.appendChild(nom);
    p.appendChild(liste);
    p.appendChild(pied);
    salonsPanneau = p;
    return p;
  }

  function majSalons() {
    if (!salonsPanneau) return;
    var pont = window.SalonsBureau;
    if (!pont) return;
    var liste = salonsPanneau.querySelector('.sp-liste');
    var salons = pont.liste() || [];
    liste.textContent = '';
    salons.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sp-salon' + (i % 2 === 0 ? ' paire' : '');
      b.textContent = s.nom + ' (' + s.nbUser + ')';
      // `box.join` instancie une `box.Chat` de plus : le salon prend SA
      // fenêtre, et celles déjà ouvertes restent où elles sont.
      b.addEventListener('click', function () { pont.rejoindre(s.id); });
      liste.appendChild(b);
    });
  }

  function ouvrirSalonsPublics() {
    if (!actif) return;
    ouvrirFenetre('salons');
    majSalons();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LA RECHERCHE DE FRUTIZ
     `win.Search` (0x855db) · `win.search.Frutiz` (0x86170) · `box.Search`
     (0x984e7) · `cp.SearchSlot` (0xc79dd)

     Une deuxième fenêtre sans équivalent mobile — comme « Salons publics », on
     la bâtit ici de toutes pièces. Deux portes y mènent, et ce sont celles de
     l'époque : le bouton du bas de la bande des contacts
     (`SideList.buildList` 0xa115b : `butSearch.onPress = uniqWinMng.open("search")`)
     et l'entrée « Recherche » du menu de l'onglet Bureau (`FPDesktop.getMenu`).

     ── LE GABARIT ──────────────────────────────────────────────────────────
     `win.Search.init` (0x85629) tient en trois lignes :

         mWidth = 270 ; flResizable = false ; flAdvance = false

     et `initFrameSet` (0x8567a) empile, de haut en bas :

         doc          cpDocument « search », style frSystem, min {w:270, h:20},
                      marge y.min = 6 / y.ratio = 0, args {flDocumentFit:true}
         showFrame    un cadre nu, min {w:270, h:0} — c'est là que vont les blocs
         pageSelector cpPageSelector, min {w:270, h:24}, dans margin.bottom,
                      marge x.min = 10

     `flDocumentFit` : la fenêtre PREND LA TAILLE DE SON CONTENU. Elle grandit
     donc quand la recherche avancée se déplie, et quand les résultats
     arrivent — d'où `updateSize()` appelé (deux fois !) par `toggleAdvance` et
     `frameSet.update()` après chaque `displayBloc`.

     ── LE FORMULAIRE ───────────────────────────────────────────────────────
     `getSearchLines` (0x862c9) rend UNE ligne, dans cet ordre :

         text   width 60   « pseudo : »
         input             variable "pseudo", maxChars 18, restrict "0-9a-zA-Z"
         spacer width 4
         button            « ok »       → launchSearch
         button dx 3       « avancée »  → toggleAdvance   [si flAdvanceAvailable]

     `getAdvanceSearchLines` (0x8646d) en rend QUATRE :

         text 48 « sexe : »   radio 76 « Masculin » M
                              radio 76 « Feminin »  F
                              radio 60 « Tous »     ""
         text 66 « age min : » input 40 (maxChars 2, restrict "0-9")
         spacer 12
         text 66 « age max : » input 40 (maxChars 2, restrict "0-9")
         text 50 « pays : »    comboBox big 100, variable "country"
         text 50 « region : »  comboBox big 100, variable "region"

     L'ORDRE DES TROIS BOUTONS DE SEXE est bien celui-là : `InitArray` renverse
     l'ordre d'empilement, et le bytecode empile Tous, Feminin, Masculin, puis
     l'étiquette. Le menu d'origine disait donc « sexe : Masculin Feminin
     Tous » — c'est contre-intuitif, et c'est ce qu'il disait. On le garde. (Le
     « Feminin » sans accent est d'origine aussi.)

     `launchSearch` de la fenêtre Frutiz (0x86a57) commence par une trappe de
     mise au point : si la touche ENTRÉE est enfoncée pendant l'appui sur « ok »,
     elle affiche quatre « bumdum » de Bordeaux au lieu d'interroger le serveur.
     ÉCART ASSUMÉ : on ne reproduit pas l'outillage des auteurs.

     ── UNE ENTRÉE DU LISTING ───────────────────────────────────────────────
     `cp.SearchSlot`, `th = 44`, `mLeft = 24`, bloc de 270 × 50 :

         status     (le voyant)  16 × 16 en (2, 0), bg figé sur son image 2
         countryBox (le drapeau) 16 × 16 en (2, th·0.5 = 22)
         frutiScreen (la bouille) fix 44 × 44 en (mLeft = 24, 0)
         doc         cpDocument 190 × 44 en (mLeft + th + 8 = 76, 1), deux
                     lignes : [pseudo 110 en gras 11 | région, taille 10, à
                     droite] et [« $age ans » 60 | ville, taille 10, à droite]

     et derrière le doc, `updateInfoBackground` (0xc8026) peint un carré
     arrondi (`drawCustomSquare`, chrome compris) :

         x = th + mLeft + 6 = 74   w = width − (x + 2)   h = th
         inline 2, outline 2, curve 4
         color.main    = colorSet.pink | colorSet.green
         color.inline  = la même en .shade
         color.outline = win.style.global.color[0].shade = #DDDDDD

     LE GENRE DÉCIDE DE TOUT : `info.gender == "M"` donne le VERT (frSheet), et
     tout le reste — les filles ET le genre inconnu — le ROSE (frRoomList).
     C'est la même règle que la couleur des pseudos dans les salons.

     Enfin, `select()` (0xc830e) : `frutizInfMng.open(info.nickname)` — cliquer
     une entrée ouvre la fiche, où que l'on clique dessus (la bouille comme le
     document ont le même `onPress`).
  */
  var RC_LARGEUR = 270;                 // `mWidth`
  var RC_BLOC_MAX = 6;                  // `blocMax`
  var RC_TH = 44, RC_MLEFT = 24;        // `cp.SearchSlot.th` et `.mLeft`
  var RC_BLOC_H = 50;                   // `displayBloc` : h = 50, en dur
  var RC_LIGNE = 22;                    // une ligne du formulaire
  var RC_PIED = 24;                     // `cpPageSelector` min h
  // Les six images de `countryBox`, dans leur ordre de clip. Elles se recoupent
  // exactement avec la table <ct> de lang_french.xml (France 1, Belgique 2,
  // Luxembourg 3, Canada 4, Suisse 5) : `gotoAndStop(info.countryCode)` reçoit
  // l'INDEX en chaîne, ne trouve pas d'étiquette « 3 » et retombe sur le numéro
  // d'image — d'où la coïncidence, qui n'en est pas une. Un code vide devient
  // « ot » (`initScreen` le réécrit), et Flash borne les autres : au-dessous de
  // 1 on reste sur la France, au-dessus de 6 on tombe sur « ot ».
  var RC_DRAPEAUX = ['fr', 'be', 'lu', 'ca', 'ch', 'ot'];
  function drapeauDe(co) {
    var s = String(co == null ? '' : co);
    if (s === '') return 'ot';
    var n = Number(s);
    if (!isFinite(n)) return 'ot';
    if (n < 1) return RC_DRAPEAUX[0];
    return RC_DRAPEAUX[Math.min(Math.round(n), RC_DRAPEAUX.length) - 1];
  }

  var rcPanneau = null;
  var rcEtat = {
    avance: false,        // `flAdvance`
    charge: false,        // `flLoading`
    depart: 0,            // `currentSearch.s`
    total: 0,             // `nbResult`
    resultats: [],
    pays: null,           // la table <ct>, une fois chargée
  };

  function panneauRecherche() {
    if (rcPanneau) return rcPanneau;
    var p = document.createElement('section');
    p.className = 'panel';
    p.id = 'recherche-panel';

    var form = document.createElement('div');
    form.className = 'rc-form';

    // ── La ligne simple ────────────────────────────────────────────────────
    var l1 = ligneRecherche();
    l1.appendChild(etiquetteRecherche('pseudo :', 60));
    var pseudo = document.createElement('input');
    pseudo.type = 'text';
    pseudo.className = 'rc-in rc-pseudo';
    pseudo.maxLength = 18;
    pseudo.setAttribute('aria-label', 'Pseudo cherché');
    l1.appendChild(pseudo);
    l1.appendChild(espaceRecherche(4));
    var ok = boutonRecherche('ok', 'rc-ok');
    l1.appendChild(ok);
    // « avancée » : le bouton n'EXISTE que si l'on a le Bananocle
    // (`flAdvanceAvailable`). `dx: 3` — trois pixels de plus que l'espace
    // ordinaire entre deux éléments d'une ligne.
    var avance = boutonRecherche('avancée', 'rc-avance');
    avance.style.marginLeft = '3px';
    l1.appendChild(avance);
    form.appendChild(l1);

    // ── Les quatre lignes avancées ─────────────────────────────────────────
    var av = document.createElement('div');
    av.className = 'rc-avancee';

    var lS = ligneRecherche();
    lS.appendChild(etiquetteRecherche('sexe :', 48));
    lS.appendChild(radioRecherche('M', 'Masculin', 76));
    lS.appendChild(radioRecherche('F', 'Feminin', 76));
    lS.appendChild(radioRecherche('', 'Tous', 60, true));
    av.appendChild(lS);

    var lA = ligneRecherche();
    lA.appendChild(etiquetteRecherche('age min :', 66));
    lA.appendChild(champAge('rc-agemin', 'Âge minimum'));
    lA.appendChild(espaceRecherche(12));
    lA.appendChild(etiquetteRecherche('age max :', 66));
    lA.appendChild(champAge('rc-agemax', 'Âge maximum'));
    av.appendChild(lA);

    var lP = ligneRecherche();
    lP.appendChild(etiquetteRecherche('pays :', 50));
    var selP = document.createElement('select');
    selP.className = 'rc-combo rc-pays';
    selP.setAttribute('aria-label', 'Pays');
    lP.appendChild(selP);
    av.appendChild(lP);

    var lR = ligneRecherche();
    lR.appendChild(etiquetteRecherche('region :', 50));
    var selR = document.createElement('select');
    selR.className = 'rc-combo rc-region';
    selR.setAttribute('aria-label', 'Région');
    lR.appendChild(selR);
    av.appendChild(lR);

    form.appendChild(av);
    p.appendChild(form);

    // ── Le listing, puis le sélecteur de page ──────────────────────────────
    var liste = document.createElement('div');
    liste.className = 'rc-liste';
    p.appendChild(liste);

    var pied = document.createElement('div');
    pied.className = 'rc-pied';
    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'rc-page rc-prev';
    prev.title = 'Page précédente';
    prev.innerHTML = '<img src="/fb/fleche_gauche.svg" alt="" aria-hidden="true">';
    var compte = document.createElement('span');
    compte.className = 'rc-compte';
    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'rc-page rc-next';
    next.title = 'Page suivante';
    next.innerHTML = '<img src="/fb/fleche_droite.svg" alt="" aria-hidden="true">';
    pied.appendChild(prev);
    pied.appendChild(compte);
    pied.appendChild(next);
    p.appendChild(pied);

    // ── Le câblage ─────────────────────────────────────────────────────────
    ok.addEventListener('click', lancerRecherche);
    // La touche entrée dans un champ vaut l'appui sur « ok » : `cpInput` d'époque
    // relaie `onEnter` au premier bouton de sa ligne.
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); lancerRecherche(); }
    });
    // `restrict` d'un champ Flash : les touches interdites ne s'écrivent pas.
    filtrerSaisie(pseudo, /[^0-9A-Za-z]/g);
    filtrerSaisie(av.querySelector('.rc-agemin'), /[^0-9]/g);
    filtrerSaisie(av.querySelector('.rc-agemax'), /[^0-9]/g);
    avance.addEventListener('click', basculerAvancee);
    selP.addEventListener('change', majComboRegion);
    prev.addEventListener('click', pagePrecedente);
    next.addEventListener('click', pageSuivante);

    rcPanneau = p;
    return p;
  }

  function ligneRecherche() {
    var d = document.createElement('div');
    d.className = 'rc-ligne';
    return d;
  }
  function etiquetteRecherche(txt, largeur) {
    var s = document.createElement('span');
    s.className = 'rc-lbl';
    s.style.width = largeur + 'px';
    s.textContent = txt;
    return s;
  }
  function espaceRecherche(largeur) {
    var s = document.createElement('span');
    s.className = 'rc-espace';
    s.style.width = largeur + 'px';
    return s;
  }
  function boutonRecherche(txt, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rc-but ' + cls;
    b.textContent = txt;
    return b;
  }
  function radioRecherche(val, txt, largeur, coche) {
    var l = document.createElement('label');
    l.className = 'rc-radio';
    l.style.width = largeur + 'px';
    var r = document.createElement('input');
    r.type = 'radio';
    r.name = 'rc-sexe';
    r.value = val;
    if (coche) r.checked = true;
    l.appendChild(r);
    l.appendChild(document.createTextNode(txt));
    return l;
  }
  function champAge(cls, aria) {
    var i = document.createElement('input');
    i.type = 'text';
    i.className = 'rc-in ' + cls;
    i.maxLength = 2;
    i.style.width = '40px';
    i.setAttribute('aria-label', aria);
    return i;
  }
  // `restrict` : Flash refuse la frappe, il ne nettoie pas après coup. On s'en
  // approche au plus près — la position du curseur est conservée.
  function filtrerSaisie(champ, interdit) {
    if (!champ) return;
    champ.addEventListener('input', function () {
      var propre = champ.value.replace(interdit, '');
      if (propre === champ.value) return;
      var p = champ.selectionStart;
      champ.value = propre;
      try { champ.setSelectionRange(p - 1, p - 1); } catch (e) {}
    });
  }

  // Le formulaire tel que `win.Search.launchSearch` (0x859f9) le ramasse :
  // `for (n in doc.card) obj[n] = doc.card[n].value`.
  function formulaireRecherche() {
    if (!rcPanneau) return {};
    var sexe = rcPanneau.querySelector('.rc-avancee input[name="rc-sexe"]:checked');
    var pays = rcPanneau.querySelector('.rc-pays');
    var reg = rcPanneau.querySelector('.rc-region');
    var f = { pseudo: rcPanneau.querySelector('.rc-pseudo').value };
    // Une recherche SIMPLE n'envoie que le pseudo : les champs avancés ne
    // figurent dans `doc.card` que lorsque leurs lignes sont montées.
    if (rcEtat.avance) {
      f.gender = sexe ? sexe.value : '';
      f.ageMin = rcPanneau.querySelector('.rc-agemin').value;
      f.ageMax = rcPanneau.querySelector('.rc-agemax').value;
      f.country = pays ? pays.value : '';
      f.region = reg ? reg.value : '';
    }
    return f;
  }

  function pontRecherche() { return window.RechercheBureau || null; }

  /*
   * `win.Search.launchSearch` : la boîte part chercher, le sélecteur de page
   * dit « chargement... » et la fenêtre se remet à jour. Le premier appel
   * repart toujours de zéro (`box.launchSearch` pose `q.s = 0`).
   */
  function lancerRecherche() {
    var P = pontRecherche();
    if (!P || rcEtat.charge) return;
    rcEtat.depart = 0;
    envoyerRecherche();
  }
  function envoyerRecherche() {
    var P = pontRecherche();
    if (!P) return;
    if (!P.chercher(formulaireRecherche(), rcEtat.depart)) return;
    rcEtat.charge = true;
    texteDePage('chargement...');
  }
  // `box.nextPage` (0x98cfe) : rien à faire si l'on charge déjà, et rien non
  // plus si l'on est sur la dernière page — la condition est écrite en clair,
  // `currentSearch.s < nbResult − nbPerPage`.
  function pageSuivante() {
    if (rcEtat.charge) return;
    if (!(rcEtat.depart < rcEtat.total - RC_BLOC_MAX)) return;
    rcEtat.depart = Math.min(rcEtat.total, rcEtat.depart + RC_BLOC_MAX);
    envoyerRecherche();
  }
  function pagePrecedente() {
    if (rcEtat.charge) return;
    if (!(rcEtat.depart > 0)) return;
    rcEtat.depart = Math.max(rcEtat.depart - RC_BLOC_MAX, 0);
    envoyerRecherche();
  }

  /*
   * `win.Search.toggleAdvance` (0x8597f), au mot près :
   *
   *     flAdvance = !flAdvance
   *     box.onAdvanceSearch(flAdvance)      // ← LE BANANOCLE SUR LE NEZ
   *     updateSearchFrame() ; updateSize() ; updateSize()
   */
  function basculerAvancee() {
    if (!rcPanneau) return;
    rcEtat.avance = !rcEtat.avance;
    rcPanneau.classList.toggle('avancee-ouverte', rcEtat.avance);
    var P = pontRecherche();
    if (P && P.porterBananocle) P.porterBananocle(rcEtat.avance);
    if (rcEtat.avance) chargerCombosPays();
    ajusterFenetreRecherche();
  }

  /*
   * Les deux menus déroulants. `box.Search` (0x98564) bâtit `countryList` avec
   * un TITRE en tête, dont la clé est `undefined` : tant qu'on ne descend pas
   * dedans, aucun `co` ne part. `onCountryChange` (0x986db) refait alors celui
   * des régions, titre compris, et `updateRegionCombo` (0x867be) le repose sur
   * sa première entrée.
   *
   * Les libellés des trois titres viennent du fichier de langue du SERVEUR
   * (`search.country_combo_title`, `search.region_combo_title`,
   * `search.choose_country_first`) : il n'est pas dans le SWF. Un seul est
   * connu au mot près — `win.search.Frutiz.init` (0x861e9) écrit en dur
   * « Choisissez un pays ! » comme valeur de repli d'`infoRegion`, et c'est
   * donc bien la phrase d'époque pour la liste des régions AVANT tout choix de
   * pays. Les deux autres sont reconstruits sur ce modèle ; le seul point non
   * reconstruit du titre des régions est sa SUBSTITUTION : `fv(clé, {n:
   * regionName.toLowerCase()})`, où `regionName` est l'attribut `tn` de la
   * table <ct>. Il ne vaut « département » que pour la France — les quatre
   * autres pays y portent leur propre code (« be », « lu », « ca », « ch »).
   * C'est la donnée d'origine, on ne la corrige pas.
   */
  var RC_TITRE_PAYS = 'Choisissez un pays';
  var RC_TITRE_AVANT_PAYS = 'Choisissez un pays !';
  var RC_TITRE_SANS_REGION = 'Aucune région';
  function chargerCombosPays() {
    var P = pontRecherche();
    if (!P || !P.tablePays || rcEtat.pays) { majComboPays(); return; }
    P.tablePays(function (table) {
      rcEtat.pays = table || [];
      majComboPays();
      ajusterFenetreRecherche();
    });
  }
  function majComboPays() {
    if (!rcPanneau) return;
    var sel = rcPanneau.querySelector('.rc-pays');
    if (!sel) return;
    var garde = sel.value;
    sel.textContent = '';
    sel.appendChild(optionRecherche('', RC_TITRE_PAYS));
    (rcEtat.pays || []).forEach(function (c) {
      sel.appendChild(optionRecherche(c.code, c.nom));
    });
    sel.value = garde || '';
    if (!sel.value) sel.selectedIndex = 0;
    majComboRegion();
  }
  function majComboRegion() {
    if (!rcPanneau) return;
    var selP = rcPanneau.querySelector('.rc-pays');
    var sel = rcPanneau.querySelector('.rc-region');
    if (!selP || !sel) return;
    sel.textContent = '';
    var pays = null;
    (rcEtat.pays || []).forEach(function (c) {
      if (String(c.code) === String(selP.value)) pays = c;
    });
    if (!pays) {
      sel.appendChild(optionRecherche('', RC_TITRE_AVANT_PAYS));
    } else if (!(pays.regions || []).length) {
      sel.appendChild(optionRecherche('', RC_TITRE_SANS_REGION));
    } else {
      var n = String(pays.nomRegion || '').toLowerCase();
      sel.appendChild(optionRecherche('', 'Choisissez un ' + (n || 'lieu')));
      pays.regions.forEach(function (r) {
        // `displayCode` : « 01 - Ain » plutôt que « Ain » tout court.
        sel.appendChild(optionRecherche(r.code,
          pays.afficherCode ? (r.code + ' - ' + r.nom) : r.nom));
      });
    }
    // `updateRegionCombo` finit par `valSetTo(0)` : le menu revient sur son
    // titre chaque fois qu'on change de pays.
    sel.selectedIndex = 0;
  }
  function optionRecherche(valeur, texte) {
    var o = document.createElement('option');
    o.value = valeur;
    o.textContent = texte;
    return o;
  }

  /*
   * `win.Search.displayBloc` (0x86863) :
   *
   *     cleanPage()
   *     pour chaque info : newElement cpSearchSlot, min {w: mWidth, h: 50}
   *     nbPages = Math.ceil(searchMax / blocMax)
   *     setText(page + "/" + nbPages + " - " + searchMax + " réponse[s]")
   *     frameSet.update()
   *
   * Le pluriel se décide sur `searchMax > 1` — « 1 réponse », « 0 réponse ».
   */
  function afficherResultats(liste, page, total, erreur) {
    rcEtat.charge = false;
    if (!rcPanneau) return;
    if (erreur) {
      // `openErrorAlert(Lang.fv("error.cbee." + k))` : le code d'erreur du
      // serveur, que ce portage n'émet pas — on dit au moins qu'on a échoué.
      alerte('Recherche impossible : ', 'le serveur a refusé la demande.');
      texteDePage('');
      return;
    }
    if (total !== null && total !== undefined) rcEtat.total = Number(total) || 0;
    rcEtat.resultats = liste || [];
    var zone = rcPanneau.querySelector('.rc-liste');
    zone.textContent = '';
    rcEtat.resultats.forEach(function (info) { zone.appendChild(blocRecherche(info)); });
    var nbPages = Math.ceil(rcEtat.total / RC_BLOC_MAX);
    texteDePage(page + '/' + nbPages + ' - ' + rcEtat.total
      + ' réponse' + (rcEtat.total > 1 ? 's' : ''));
    ajusterFenetreRecherche();
  }
  function texteDePage(t) {
    if (!rcPanneau) return;
    var c = rcPanneau.querySelector('.rc-compte');
    if (c) c.textContent = t;
  }

  // Une entrée : `cp.SearchSlot.initScreen` (0xc7a79) et `initDoc` (0xc7cbe).
  function blocRecherche(info) {
    var d = document.createElement('div');
    d.className = 'rc-slot';
    // La couleur du bloc ET l'encre du document : `gender == "M"` → le vert,
    // TOUT LE RESTE → le rose. (Le genre inconnu suit les filles, d'époque.)
    d.setAttribute('data-genre', info.genre === 'M' ? 'M' : 'F');

    // Le voyant. `bg.gotoAndStop(2)` puis `updateStatus` (0xc818a) :
    //   presence == 0                → image « presence », ico = presence + 1
    //   status.internal défini       → image « internal », ico = le jeu
    //   status.external défini       → image « external » (jamais émise ici)
    //   sinon                        → image « presence », ico = presence + 1
    var voyant = document.createElement('span');
    voyant.className = 'rc-voyant';
    var ico = document.createElement('img');
    if (info.presence !== 0 && info.jeu) {
      ico.src = voyantUrl(info.jeu);
      ico.className = 'jeu';
      voyant.title = libelleJeu(info.jeu);
    } else {
      // Le pip de `presence` : 0 rouge (hors ligne), 1 vert (en ligne),
      // 2 gris (invisible). Flash borne au-delà de la troisième image.
      var pr = Math.max(0, Math.min(2, Number(info.presence) || 0));
      ico.src = '/frutiz/sprites/recherche-presence-' + pr + '.svg';
      ico.className = 'pip';
      voyant.title = pr === 1 ? 'En ligne' : (pr === 2 ? 'Invisible' : 'Hors ligne');
    }
    ico.alt = '';
    voyant.appendChild(ico);
    d.appendChild(voyant);

    // Le drapeau.
    var dr = document.createElement('img');
    dr.className = 'rc-drapeau';
    dr.src = '/frutiz/sprites/recherche-pays-' + drapeauDe(info.pays) + '.svg';
    dr.alt = '';
    var P = pontRecherche();
    if (P && P.nomPays) dr.title = P.nomPays(info.pays);
    d.appendChild(dr);

    // La bouille, 44 × 44 — `attachMovie("frutiScreen", …, {fix:{w:th,h:th}})`
    // puis `onStatusObj({fbouille, status, presence})` : l'humeur voyage avec.
    var ec = document.createElement('div');
    ec.className = 'rc-bouille';
    if (info.bouille && info.bouille.length >= 4) {
      ec.innerHTML = FPBouilleVignette.html(info.bouille, { humeur: Number(info.humeur) || 0 });
      FPBouilleVignette.brancher(ec);
    }
    d.appendChild(ec);

    var doc = document.createElement('div');
    doc.className = 'rc-doc';
    var l1 = document.createElement('div');
    l1.className = 'rc-l1';
    var nom = document.createElement('span');
    nom.className = 'rc-nom';
    nom.textContent = info.pseudo;
    var reg = document.createElement('span');
    reg.className = 'rc-reg';
    reg.textContent = (P && P.nomRegion) ? P.nomRegion(info.pays, info.region) : '';
    l1.appendChild(nom);
    l1.appendChild(reg);
    var l2 = document.createElement('div');
    l2.className = 'rc-l2';
    var age = document.createElement('span');
    age.className = 'rc-age';
    age.textContent = info.age + ' ans';
    var ville = document.createElement('span');
    ville.className = 'rc-ville';
    ville.textContent = info.ville || '';
    l2.appendChild(age);
    l2.appendChild(ville);
    doc.appendChild(l1);
    doc.appendChild(l2);
    d.appendChild(doc);

    // `select()` : la fiche s'ouvre, qu'on clique la bouille ou le document.
    d.addEventListener('click', function () {
      if (P && P.ouvrirFiche) P.ouvrirFiche(info.pseudo);
    });
    d.title = 'Voir la fiche de ' + info.pseudo;
    return d;
  }

  /*
   * `flDocumentFit` + `updateSize()` : la fenêtre fait la taille de ce qu'elle
   * contient. On la recalcule à chaque changement — dépliage de la recherche
   * avancée, arrivée d'une page de résultats — comme le SWF le fait par son
   * `frameSet.update()`.
   */
  function hauteurRecherche() {
    var lignes = 1 + (rcEtat.avance ? 4 : 0);
    // 6 : `Standard.getMargin().y.min` du document du formulaire.
    return 26 + 6 + lignes * RC_LIGNE + 4
      + rcEtat.resultats.length * RC_BLOC_H + RC_PIED + 4;
  }
  function ajusterFenetreRecherche() {
    var f = fenetres['recherche-panel'];
    if (!f) return;
    f.fen.style.height = Math.min(hauteurRecherche(),
      window.innerHeight - CORNER_Y - 12) + 'px';
    bornerDansEcran(f.fen);
  }

  function ouvrirRechercheFenetre() {
    if (!actif) return;
    ouvrirFenetre('recherche');
    // `flAdvanceAvailable` se relit à chaque ouverture : l'objet a pu être
    // acquis (ou perdu) entre deux. La réponse peut arriver en différé la
    // toute première fois — l'inventaire n'est demandé qu'une fois.
    var P = pontRecherche();
    if (P && P.bananocle) {
      P.bananocle(function (dispo) {
        if (!rcPanneau) return;
        rcPanneau.classList.toggle('avance-possible', dispo);
        if (!dispo && rcEtat.avance) basculerAvancee();
        else ajusterFenetreRecherche();
      });
    }
    if (rcEtat.avance) chargerCombosPays();
    ajusterFenetreRecherche();
    var champ = rcPanneau.querySelector('.rc-pseudo');
    if (champ) champ.focus();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     L'EXPLORATEUR (`win.Explorer` 0x91d21, `box.Explorer` 0x86eb4)

     La fenêtre jaune qui montre un DOSSIER : « Mes disques », « Inventaire »,
     et tout ce qu'ils contiennent. Une seule classe pour les deux, comme
     d'époque — c'est le dossier ouvert qui décide de tout.

     `win.Explorer.init` donne le gabarit : `pos = {x:50, y:50, w:400, h:400}`,
     puis trois compos empilés,

         initNavigatorIconList()      la barre d'outils, si elle a des boutons
         displayNavigatorIconList()   compo « navigatorFrame », min {w:80,h:28}
                                      struct {x:{size:24,space:2}, y:{…}}
         displayExplorer()            compo « fileIconListFrame », le champ

     et la barre d'outils N'EXISTE PAS quand elle est vide (`if(!length) return`)
     — c'est pourquoi la racine de l'inventaire n'a pas de rangée de boutons et
     « Accessoires » en a une. Les boutons viennent de `butPushNavigator`, une
     image par action :

         flUp          → image 2, « explorer_up »              box.getParent
         flNewDirectory→ image 3, « explorer_new_folder »      nouveau dossier
         flRemoveAll   → image 4, « explorer_empty_recyclebin »
         flMail        → image 5, « explorer_new_mail »

     et `box.Explorer.onLoadList` décide lesquels selon le dossier :

         uid commence par « inv »  → ni nouveau dossier ni vidage
         uid == corbeille          → vidage
         uid ∈ {boîtes mail, inventaire, liste noire} → pas de nouveau dossier
         sinon                     → nouveau dossier
         flUp = le dossier a un parent

     La NAVIGATION se fait SUR PLACE : `IconFileBox.click` appelle
     `box.getList(uid)` pour un dossier, et la fenêtre se retitre du nom du
     dossier ouvert (`setTitle(this.list.desc[0])`). Rien ne s'empile.

     Le clic sur un FICHIER passe d'abord par `box.Explorer.specialClick` :

         uid commence par « invpicto, » → la pop-up des pictos du forum
         type == « bouille »            → mainCnx.cmd("fbouille", {f: desc[1]})
                                          (+ la fenêtre « recherche » pour le
                                          Bananocle — la blague d'origine)
         type == « wallpaper »          → wallPaper.loadWP(desc[1], desc[2])

     et sinon `_global.onFileClick`.

     Enfin les BANDEAUX D'AVERTISSEMENT, `window.displayAlert` : une phrase
     selon le dossier, prise telle quelle dans lang_french.as.

     Tout cela se branche sur `/ff/ls`, l'API que main.swf interroge déjà : le
     serveur du revival la sert pour tous ces dossiers. Le portage lit donc
     EXACTEMENT la même chose que le bureau Flash. */

  // Le cadre de chaque dessin sorti de fileIcon.swf (scripts/extract-frutiz-
  // explorer.js). Il donne l'origine du dessin par rapport au point
  // d'enregistrement du clip — c'est ce qui le pose au bon endroit dans sa case.
  var CADRES = null;
  function cadresExplorateur() {
    if (CADRES) return CADRES;
    CADRES = {};
    var x = new XMLHttpRequest();
    try {
      x.open('GET', '/frutiz/sprites/explorateur.json', false);
      x.send(null);
      if (x.status >= 200 && x.status < 300) CADRES = JSON.parse(x.responseText);
    } catch (e) { /* les icônes se poseront à leur taille naturelle */ }
    return CADRES;
  }

  // `but.icon.Standard.display` (0x842e0), au chiffre près :
  //     bx = 3, by = 4, textRatio = 0.5, icoRatio = 1.66 (1 pour une bouille)
  //     r4 = width × (1 − textRatio)          // width = case − 2×bx
  //     ico._xscale = ico._yscale = r4 × icoRatio        (en POUR CENT)
  //     ico._x = (width − r4) / 2
  //     titleField.pos = {x: 0, y: r4, w: width, h: height × textRatio}
  var EX_CASE = 80;                      // la case d'une icône, mesurée 1:1
  var EX_BX = 3, EX_BY = 4;
  var EX_LARGEUR = EX_CASE - 2 * EX_BX;  // 74
  var EX_R4 = EX_LARGEUR / 2;            // 37 — hauteur de l'icône ET y du titre

  // Les dossiers de l'inventaire et la boîte à disques : les racines que le
  // bureau ouvre depuis ses icônes.
  var EXPLORATEURS = {
    disques:    { panneau: '#ex-disques-panel',    uid: 'disccollector', titre: 'Mes disques' },
    inventaire: { panneau: '#ex-inventaire-panel', uid: 'inventory',     titre: 'Inventaire' },
  };
  var exEtats = {};                      // clé → { uid, panneau, liste, titre }

  function panneauExplorateur(cle) {
    var conf = EXPLORATEURS[cle];
    var p = document.createElement('section');
    p.className = 'panel ex-panel';
    p.id = conf.panneau.slice(1);
    // `box.Explorer` EST un `dropBox` : `IconFileBox.onDrop` prend l'uid du
    // dossier affiché pour cible et appelle `fileMng.move`. Le portage n'en
    // avait fait aucun — rendre à « Mes disques » un disque qu'on venait
    // d'éjecter tombait dans le vide.
    p.setAttribute('data-depot', 'explorateur');
    p.setAttribute('data-cle', cle);
    p.innerHTML = '<div class="ex-nav" hidden></div>'
      + '<div class="ex-alerte" hidden></div>'
      + '<div class="ex-champ"></div>';
    return p;
  }

  // Le bouton d'une action de la barre d'outils.
  function boutonNav(action, titre, faire) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ex-nav-but';
    b.title = titre;
    b.style.backgroundImage = 'url(/frutiz/sprites/nav_' + action + '.svg)';
    if (faire) b.addEventListener('click', faire);
    else { b.disabled = true; }
    return b;
  }

  // Une case d'icône : le dessin posé comme `but.icon.Standard` le pose, et
  // l'étiquette dessous, centrée, sur deux lignes au plus.
  function caseExplorateur(opts) {
    var d = document.createElement('div');
    d.className = 'ex-slot' + (opts.classe ? ' ' + opts.classe : '');
    if (opts.titre) d.title = opts.titre;
    if (opts.faire) {
      d.tabIndex = 0;
      d.addEventListener('click', opts.faire);
      d.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.faire(e); }
      });
    } else {
      d.classList.add('inerte');
    }
    if (opts.dessin) d.appendChild(opts.dessin);
    if (opts.nom !== undefined) {
      var l = document.createElement('span');
      l.className = 'ex-lbl';
      l.textContent = opts.nom;
      d.appendChild(l);
    }
    return d;
  }

  // Le dessin d'une icône « standard » : le SVG sorti du SWF, à l'échelle du
  // bureau (r4 × icoRatio) et posé sur l'origine de son clip.
  function dessinStandard(nom, ratio) {
    var c = cadresExplorateur()[nom];
    var img = document.createElement('img');
    img.className = 'ex-img';
    img.alt = '';
    img.src = '/frutiz/sprites/' + nom + '.svg';
    if (!c) return img;
    var e = EX_R4 * (ratio === undefined ? 1.66 : ratio) / 100;
    img.style.width = (c.w * e) + 'px';
    img.style.height = (c.h * e) + 'px';
    // `ico._y` n'est jamais posé : le clip s'accroche en haut de la marge, et
    // c'est l'origine du dessin qui décide du reste.
    img.style.top = (EX_BY + c.y * e) + 'px';
    return img;
  }

  // LE DISQUE, tel que `but.icon.Full` le dessine : pas d'étiquette, l'anneau
  // du type de FD et par-dessus la jaquette du jeu — les deux images que
  // `ico.disc.gotoAndStop(desc[0] + 1)` et `ico.disc.label.gotoAndStop(desc[1])`
  // choisissent.
  var JAQUETTES = {
    Grapiz: 'grapiz', grapiz: 'grapiz', bandas: 'bandas', bkiwi: 'bkiwi',
    kaluga: 'kaluga', kalugaPreview: 'kalugaPreview', swapou2: 'swapou2',
    miniwave: 'miniwave', minipixiz: 'minipixiz', minifever: 'minifever',
    snake3: 'snake', snake: 'snake', jama: 'jama', mb2: 'mb2',
    mele: 'mele', tower: 'tower', tuberculoz: 'tuberculoz',
  };
  function dessinDisque(type, jeu) {
    var d = document.createElement('span');
    d.className = 'ex-disque';
    var anneau = document.createElement('img');
    anneau.alt = '';
    anneau.src = '/frutiz/sprites/disc_anneau_' + (Number(type) || 0) + '.svg';
    d.appendChild(anneau);
    var nom = JAQUETTES[jeu] || JAQUETTES[String(jeu).toLowerCase()];
    if (nom) {
      var jaq = document.createElement('img');
      jaq.alt = '';
      jaq.className = 'jaquette';
      jaq.src = '/frutiz/sprites/disc_jaquette_' + nom + '.svg';
      d.appendChild(jaq);
    }
    return d;
  }

  // La bouille d'un accessoire : `but.Icon.display` remplace l'icône par un
  // `frutibouille` et met `icoRatio` à 1 — l'aperçu fait donc r4 de côté.
  function dessinBouille(etat) {
    var c = document.createElement('span');
    c.className = 'ex-bouille';
    // Un canevas du moteur JS : c'était un lecteur Flash par accessoire, et
    // l'inventaire en aligne des dizaines.
    c.innerHTML = FPBouilleVignette.html(etat);
    FPBouilleVignette.brancher(c);
    return c;
  }

  // Le fond d'écran : l'icône du type « wallpaper », et dedans l'image du fond
  // — le SWF, lui, ne montre que le cadre ; on y met la vignette, qui dit tout
  // de suite lequel c'est.
  function dessinFond(url, couleur) {
    var img = dessinStandard('ico_wallpaper');
    if (!url) return img;
    var c = document.createElement('span');
    c.className = 'ex-fond';
    c.style.width = img.style.width;
    c.style.height = img.style.height;
    c.style.top = img.style.top;
    var v = document.createElement('span');
    v.className = 'vign';
    v.style.backgroundImage = 'url("' + url + '")';
    var arr = String(couleur || '').split(';')[0];
    if (/^[0-9a-fA-F]{6}$/.test(arr)) v.style.backgroundColor = '#' + arr;
    c.appendChild(v);
    c.appendChild(img);
    img.style.top = '0';
    return c;
  }

  // L'ARBRE DES DOSSIERS (`/ff/tree`), que `FFileMng` lit une fois pour toutes
  // au démarrage. C'est LUI qui nomme et TYPE un dossier : `onLoadDesktop` fait
  // `var i = fileMng.tree[uid]; desc: [i.name, i.type]`. Le listing, lui, ne
  // porte qu'un `t="folder"` générique — sans l'arbre, les trois dossiers de
  // l'inventaire perdraient leur coffre.
  var arbre = null, arbreEnCours = null;
  function chargerArbre() {
    if (arbre) return Promise.resolve(arbre);
    if (arbreEnCours) return arbreEnCours;
    var sid = (window.state && window.state.sid) || '';
    arbreEnCours = fetch('/ff/tree?sid=' + encodeURIComponent(sid), { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var doc = new DOMParser().parseFromString(t, 'text/xml');
        var m = {};
        var noeuds = doc.getElementsByTagName('f');
        for (var i = 0; i < noeuds.length; i++) {
          var n = noeuds[i];
          m[n.getAttribute('u')] = { nom: n.getAttribute('n') || '', type: n.getAttribute('t') || 'default' };
        }
        arbre = m;
        return m;
      })
      .catch(function () { arbre = {}; return arbre; });
    return arbreEnCours;
  }

  // ── Ce que `box.Explorer.onLoadList` décide du dossier ouvert ───────────
  var MAIL_UIDS = { messages: 1, inbox: 1, outbox: 1, draftbox: 1, blackbox: 1 };
  function typeDeDossier(uid, aParent) {
    var t = { flUp: !!aParent, flNewDirectory: false, flRemoveAll: false, flMail: false };
    if (String(uid).indexOf('inv') === 0) return t;
    if (uid === 'recyclebin') { t.flRemoveAll = true; return t; }
    t.flNewDirectory = !(MAIL_UIDS[uid] || uid === 'inventory' || uid === 'blacklist');
    t.flMail = !!MAIL_UIDS[uid];
    return t;
  }

  // `window.displayAlert` — la phrase du dossier, mot pour mot (lang_french.as).
  function alerteDossier(uid, entrees) {
    var n = entrees.length;
    if (uid === 'disccollector') {
      var noir = entrees.some(function (e) { return e.type === 'disc' && e.desc[0] === '0'; });
      if (noir) {
        return 'Pour jouer, faîtes glisser les disques dans la Frusion : '
          + 'la console en haut à droite de Frutiparc';
      }
      if (!entrees.some(function (e) { return e.type === 'disc'; })) {
        return 'Vous n’avez plus de Fruti-Disque ? Les FD noirs sont distribués tous les jours '
          + 'à minuit, mais vous pouvez dès maintenant acheter des FD blancs ou des Pass '
          + 'dans la boutique !';
      }
      return '';
    }
    // La phrase de l'inventaire vide. D'époque elle ne sort que sur la RACINE
    // (`uid == fileMng.inventory && listSize() < 2`) — mais la racine du
    // revival porte toujours ses trois dossiers, si bien qu'elle ne sortirait
    // jamais. On la garde donc AUSSI pour un dossier d'inventaire vide : c'est
    // là qu'elle a quelque chose à dire, et c'est la phrase d'origine, dans le
    // bandeau d'origine.
    if ((uid === 'inventory' || String(uid).indexOf('inv') === 0) && n < 2) {
      return 'Vous trouverez dans votre inventaire des objets achetés dans la boutique '
        + 'ou accumulés en jouant.';
    }
    return '';
  }

  // ── La lecture d'un dossier ────────────────────────────────────────────
  // `/ff/ls` rend le XML que `FFileMng.analyseXml` sait lire : `<e>` un
  // fichier (le contenu = les lignes de `desc`), `<f>` un dossier.
  function lireDossier(xml) {
    var racine = xml && xml.documentElement;
    var out = [];
    if (!racine) return out;
    for (var n = racine.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      if (n.nodeName === 'e') {
        out.push({
          uid: n.getAttribute('u') || '',
          type: n.getAttribute('t') || 'default',
          desc: String(n.textContent || '').split(/\r\n|\r|\n/),
        });
      } else if (n.nodeName === 'f') {
        // `onLoadDesktop` : le nom ET le type d'un dossier viennent de
        // l'ARBRE (`fileMng.tree[uid]`), pas du listing.
        var uid = n.getAttribute('u') || '';
        var i = (arbre && arbre[uid]) || null;
        out.push({
          uid: uid,
          type: 'folder',
          desc: [(i && i.nom) || n.getAttribute('n') || '',
            (i && i.type) || n.getAttribute('t') || 'default'],
        });
      }
    }
    return out;
  }

  function ouvrirDossier(cle, uid, titre) {
    var etat = exEtats[cle];
    if (!etat) return;
    etat.uid = uid;
    etat.titre = titre || EXPLORATEURS[cle].titre;
    retitrer(etat.panneau.id, etat.titre);
    var sid = (window.state && window.state.sid) || '';
    var champ = etat.panneau.querySelector('.ex-champ');
    champ.textContent = '';
    champ.classList.add('attente');
    Promise.all([
      chargerArbre(),
      fetch('/ff/ls?uid=' + encodeURIComponent(uid) + '&sid=' + encodeURIComponent(sid),
        { cache: 'no-store' }).then(function (r) { return r.text(); }),
    ])
      .then(function (r) {
        if (etat.uid !== uid) return;     // un autre dossier a été demandé entre-temps
        var xml = new DOMParser().parseFromString(r[1], 'text/xml');
        dessinerDossier(cle, uid, lireDossier(xml));
      })
      .catch(function () {
        champ.classList.remove('attente');
        champ.textContent = '';
        var m = document.createElement('div');
        m.className = 'ex-vide';
        m.textContent = 'Dossier indisponible.';
        champ.appendChild(m);
      });
  }

  function dessinerDossier(cle, uid, entrees) {
    var etat = exEtats[cle];
    var conf = EXPLORATEURS[cle];
    var racine = uid === conf.uid;
    var t = typeDeDossier(uid, !racine);

    // La barre d'outils, dans l'ordre de `initNavigatorIconList`.
    var nav = etat.panneau.querySelector('.ex-nav');
    nav.textContent = '';
    if (t.flUp) {
      nav.appendChild(boutonNav('up', 'Remonter d’un dossier', function () {
        ouvrirDossier(cle, conf.uid, conf.titre);
      }));
    }
    if (t.flNewDirectory) {
      // D'époque ce bouton déplie un champ « nouveau dossier ». Le serveur du
      // revival ne crée pas de dossier dans la boîte à disques : le bouton est
      // là parce qu'il fait partie de la fenêtre, mais il n'a rien à appeler.
      var b = boutonNav('new_folder', 'La création de dossiers n’est pas ouverte sur le revival', null);
      nav.appendChild(b);
    }
    nav.hidden = !nav.firstChild;

    var alerte = etat.panneau.querySelector('.ex-alerte');
    var phrase = alerteDossier(uid, entrees);
    alerte.textContent = phrase;
    alerte.hidden = !phrase;

    var champ = etat.panneau.querySelector('.ex-champ');
    champ.classList.remove('attente');
    champ.textContent = '';
    // `fileMng.frusionOn` : le disque QUI TOURNE n'est plus dans la boîte —
    // il est dans le lecteur. Il y revient quand on l'éjecte.
    // Et `fileMng.move` : un disque POSÉ AILLEURS — sur le bureau, dans un
    // dossier — a QUITTÉ la boîte. Un déménagement, pas une copie : sans ce
    // filtre, glisser un disque sur le bureau en laissait un second dans
    // « Mes disques », et l'on se retrouvait avec deux fois le même FD.
    entrees = entrees.filter(function (x) {
      if (x.type !== 'disc') return true;
      return !dansLeLecteur(x) && !trouverObjet(x.uid);
    });
    // `box.Explorer.displayList` trie par NOM, croissant, sans tenir compte de
    // la casse — les dossiers ne passent pas devant.
    entrees = entrees.slice().sort(function (a, b) {
      return String(nomDe(a)).toLowerCase().localeCompare(String(nomDe(b)).toLowerCase(), 'fr');
    });
    // Un dossier vide reste VIDE : le bureau d'époque n'écrit rien dans le
    // champ, c'est le bandeau d'avertissement qui parle à sa place.
    for (var i = 0; i < entrees.length; i++) champ.appendChild(caseDe(cle, entrees[i]));
  }

  function nomDe(e) { return e.desc[0] || ''; }

  function caseDe(cle, e) {
    var conf = EXPLORATEURS[cle];
    if (e.type === 'folder') {
      var typeDossier = e.desc[1] || 'default';
      var nomIco = cadresExplorateur()['ico_dossier_' + typeDossier]
        ? 'ico_dossier_' + typeDossier : 'ico_dossier_default';
      return caseExplorateur({
        nom: nomDe(e), dessin: dessinStandard(nomIco), titre: nomDe(e),
        faire: function () { ouvrirDossier(cle, e.uid, nomDe(e)); },
      });
    }
    if (e.type === 'disc') return caseDisque(e);
    if (e.type === 'bouille') {
      return caseExplorateur({
        nom: nomDe(e), dessin: dessinBouille(e.desc[1]), classe: 'ex-slot-bouille',
        titre: 'Porter « ' + nomDe(e) + ' »',
        faire: function () { poserAccessoire(nomDe(e), e.desc[1]); },
      });
    }
    if (e.type === 'wallpaper') {
      // Une entrée d'UNE seule ligne — pas d'url, pas de couleur — c'est le
      // retour au thème d'origine : `loadWP(undefined)` efface la préférence.
      var vide = e.uid === '__fond_defaut__' || !e.desc[1];
      return caseExplorateur({
        nom: nomDe(e), dessin: dessinFond(vide ? '' : e.desc[1], e.desc[2]),
        titre: 'Poser « ' + nomDe(e) + ' » sur le bureau',
        faire: function () { poserFondInventaire(vide ? '' : e.uid); },
      });
    }
    if (e.type === 'url') {
      // `<e t="url">` porte une ligne `javascript:fp_openPopup('url', nom, spec)` :
      // le bureau l'exécute tel quel. On en tire l'adresse et on ouvre la
      // fenêtre nous-mêmes.
      var lien = ouvrirPopup(e.desc[1]);
      return caseExplorateur({
        nom: nomDe(e), dessin: dessinStandard('ico_pictoForum'), titre: nomDe(e),
        faire: lien,
      });
    }
    return caseExplorateur({ nom: nomDe(e), dessin: dessinStandard('ico_default'), titre: nomDe(e) });
  }

  function ouvrirPopup(commande) {
    var m = /fp_openPopup\('([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/.exec(String(commande || ''));
    if (!m) return null;
    return function () { window.open(m[1], m[2], m[3]); };
  }

  // LES DISQUES. `but.icon.Full` ne met pas d'étiquette : le disque se
  // reconnaît à sa jaquette. Le libellé d'un disque (`desc[1]`) est celui qui
  // CHOISIT la jaquette dans fileIcon.swf — c'est aussi ce qui nous dit quel
  // jeu lancer.
  var JEUX_LIGHT = {
    grapiz: 'grapiz', bandas: 'bandas', swapou2: 'swapou', miniwave: 'miniwave',
    miniwaved: 'miniwave', minipixiz: 'minipixiz', minipixizd: 'minipixiz',
    snake3: 'snake3', snake: 'snake3', minifever: 'minifever',
    jama: 'jamajama', jamajama: 'jamajama',
  };
  /*
   * LES TROIS QUI SONT ENCORE EN FLASH.
   *
   * Burning Kiwi, Kaluga et Motion-Ball 2 n'ont pas de portage JS : ils se
   * lisent sous Ruffle, dans une fenêtre à part. Le bureau les MONTRAIT — le
   * bureau d'époque montre tous les disques du joueur — mais les laissait
   * INERTES : pas attrapables, donc impossibles à glisser dans la Frusion.
   * Quatre pastilles sur quinze qui ne répondaient pas (Kaluga en a deux, le
   * FD et son aperçu), alors que main.swf accepte n'importe quel disque dans
   * sa console.
   *
   * Le catalogue vit dans `light.html` (`window.JeuxFlash`), avec les mêmes
   * dimensions et le même rognage que le bureau donne à `game-popup.html` —
   * un seul endroit pour les trois.
   */
  function jeuFlashDe(jeu) {
    var P = window.JeuxFlash;
    return P && P.parDisque ? P.parDisque(jeu) : null;
  }
  function caseDisque(e) {
    var type = e.desc[0], jeu = e.desc[1] || '';
    var tab = JEUX_LIGHT[String(jeu).toLowerCase()];
    var flash = tab ? null : jeuFlashDe(jeu);
    // D'époque, `_global.onFileClick` ne fait RIEN d'un disque — la branche
    // « disc » est commentée dans openFunctions.as. On joue en le GLISSANT
    // dans la Frusion, et le bandeau de la fenêtre le dit : « Pour jouer,
    // faîtes glisser les disques dans la Frusion ». Le clic reste donc muet,
    // comme d'époque ; c'est le glisser qui ouvre le tiroir.
    var c = caseExplorateur({
      classe: 'ex-slot-disque',
      dessin: dessinDisque(type, jeu),
      titre: flash ? 'Glissez-le dans la Frusion (il s’ouvre en fenêtre à part)'
        : 'Glissez-le dans la Frusion',
    });
    // Muet au clic ne veut pas dire INERTE : un disque s'attrape, qu'il soit
    // porté en JS ou joué sous Ruffle.
    if (tab || flash) {
      c.classList.remove('inerte');
      rendreAttrapable(c, e, function () { return dessinDisque(type, jeu); });
    }
    return c;
  }

  // `specialClick` : un accessoire se PORTE (la commande `fbouille`), un fond
  // d'écran se POSE. Le light sait déjà faire les deux — on lui passe la main.
  function poserAccessoire(nom, etat) {
    if (window.InventaireBureau && InventaireBureau.porterAccessoire) {
      InventaireBureau.porterAccessoire(nom, etat);
    }
  }
  function poserFondInventaire(id) {
    if (window.InventaireBureau && InventaireBureau.poserFond) InventaireBureau.poserFond(id);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LE GLISSER-DÉPOSER DE FICHIERS (`_global.createDragIcon`, `dragListener`)

     Au bureau d'époque on n'ouvre pas un disque : on l'ATTRAPE et on le POSE
     dans la Frusion. `IconFileBox.pressIcon` arme un contrôle toutes les 25 ms
     et, dès que la souris a bougé de plus de `dragDistMin = 4`, appelle
     `createDragIcon` : l'icône quitte sa fenêtre (elle s'y fait invisible) et
     suit le curseur. `onEndDrag` la rend, `IconFileBox.onDrop` la reçoit.

     Le lecteur, lui, s'abonne au TYPE de fichier :

         dragListener.addListener("disc", {obj: this,
             startMethod: "onStartDragDisc", stopMethod: "onEndDragDisc"})

     — c'est ce qui fait sortir le tiroir DÈS QU'ON ATTRAPE un disque, avant
     même de savoir où il ira. */
  var DIST_MIN_GLISSER = 4;             // IconFileBox.dragDistMin
  var glisseur = { info: null, el: null, source: null };
  var abonnesGlisser = {};              // type → [{ debut, fin }]

  function ecouterGlisser(type, obj) {
    (abonnesGlisser[type] = abonnesGlisser[type] || []).push(obj);
  }
  function prevenirGlisser(type, phase) {
    var l = abonnesGlisser[type] || [];
    for (var i = 0; i < l.length; i++) if (l[i][phase]) l[i][phase]();
  }

  // `_global.createDragIcon` : le dessin du fichier, à la taille de l'icône,
  // centré sur le curseur et transparent aux clics (c'est ce qu'il y a DESSOUS
  // qui reçoit le dépôt).
  function creerIconeGlissee(info, dessin, x, y) {
    var el = document.createElement('div');
    el.className = 'fb-glisse-icone';
    el.appendChild(dessin);
    document.body.appendChild(el);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    glisseur.info = info;
    glisseur.el = el;
    prevenirGlisser(info.type, 'debut');
    return el;
  }

  // `listener.dragIconMouse.onMouseUp` : on cherche ce qu'il y a sous le
  // curseur ; le premier parent porteur d'un `dropBox` reçoit le dépôt, et
  // QUAND IL N'Y EN A PAS, c'est le BUREAU qui le prend —
  //
  //     if (mc == undefined) this.desktop.onDrop(this.dragIconOrig);
  //
  // d'où le comportement d'époque : lâcher n'importe où sur le fond pose
  // l'objet là.
  function finirGlisser(x, y) {
    if (!glisseur.el) return;
    var info = glisseur.info;
    var ctrl = glisseur.ctrl;           // `Key.isDown(17)` : Ctrl = COPIER
    glisseur.el.remove();
    glisseur.el = null;
    glisseur.info = null;
    glisseur.ctrl = false;
    // La CIBLE : ce qui se trouve sous le curseur au lâcher. L'icône glissée
    // ne compte pas (elle ne reçoit pas les clics).
    var cible = document.elementFromPoint(x, y);
    var boite = cible && cible.closest ? cible.closest('[data-depot]') : null;
    var quoi = boite ? boite.getAttribute('data-depot') : null;
    var pris = false;
    if (quoi === 'frusion') pris = frusion.deposer(info);
    else if (quoi === 'dossier') pris = deposerDansDossier(info, boite.getAttribute('data-uid'));
    else if (quoi === 'explorateur') pris = deposerDansExplorateur(info, boite.getAttribute('data-cle'));
    else if (quoi === 'bureau' || (!boite && surLeBureau(cible))) pris = deposerSurBureau(info, x, y, ctrl);
    // `IconFileBox.onEndDrag` note l'heure (`IconFileBox.dragEnd = getTimer()`)
    // pour que le clic de fin de geste n'ouvre rien.
    if (pris) {
      dernierDepot = Date.now();
      // `fileMng` prévient ses ÉCOUTEURS : « Mes disques » se relit, le disque
      // posé n'y est plus.
      if (info.type === 'disc') relireExplorateurs();
    }
    prevenirGlisser(info.type, 'fin');
    if (!pris && glisseur.source) glisseur.source.style.visibility = '';
    glisseur.source = null;
  }

  // Le fond du bureau, ou l'un de ses raccourcis : dans les deux cas c'est le
  // bureau qui reçoit — `findDropTargetIn` ne s'arrête que sur un `dropBox`,
  // et un raccourci n'en est pas un.
  function surLeBureau(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('#bureau') && !el.closest('.fen') && !el.closest('#side-list');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CE QU'ON POSE SUR LE BUREAU (`FPDesktop`, DoInitAction sprite#883 0xb8cae)

     Le bureau d'époque est un DOSSIER comme un autre : `FPDesktop` s'abonne à
     `fileMng` sur l'uid « root » et tient sa liste d'`IconFileBox`. Déposer
     quelque chose dessus passe par `onDrop` :

         onDrop(ico, mc) :
           si l'uid est DÉJÀ dans ma liste  → on le REPOSITIONNE seulement
               pos = globalToLocal(dragIcon._x, _y) ; removeFromList/addToList
           sinon si ico.uid == "new"        → fileMng.make(ico, "root", {pos})
           sinon si Key.isDown(17)          → fileMng.copy(ico.uid, "root", …)
           sinon                            → fileMng.move(ico.uid, "root", …)

     Et `displayIconList` monte le tout dans un `cpDragIconList` avec une marge
     de 18 en x, 12 en y, la couleur de texte du fond d'écran (ou
     `colorSet.green.overdark` s'il n'en impose pas) et `flMask: false`.

     La grille est celle de `cp.DragIconList` :

         gridSpace = displayParameters.icon.size.large + 4      → 84
         initGrid  : xMax = floor(width / gridSpace), idem en y
         fitInGrid : sans pos → getNextAvailablePos() ; hors cadre → on
                     ramène par pas entiers puis findNear()
         getNextAvailablePos : balayage LIGNE PAR LIGNE (y dehors, x dedans)
         addToGrid : la case est round(pos / gridSpace) — et elle peut en
                     contenir PLUSIEURS : la grille sert à trouver du vide,
                     pas à empêcher les recouvrements.
         updateIcons : _x = pos.x, _y = pos.y — aucune animation, ça claque. */
  var GRILLE_PAS = 84;                  // icon.size.large (80) + 4
  var GRILLE_MX = 18, GRILLE_MY = 12;   // `Standard.getMargin()` + x.min/y.min
  var objetsBureau = [];                // la liste « root » de FPDesktop
  var bureauCharge = false;

  function jetonSid() { return (window.state && window.state.sid) || ''; }

  function chargerObjetsBureau() {
    var sid = jetonSid();
    if (!sid) return;
    // LE FILET NE COUVRE QUE LA LECTURE. Il enveloppait aussi le DESSIN, si
    // bien qu'une erreur de code y disparaissait sans un mot — c'est ainsi
    // qu'un bureau entier a pu rester nu sur un `o.pos.x` de trop. Le rendu
    // est donc sorti de sa portée : s'il casse, ça se voit.
    fetch('/api/light/bureau/objets?sid=' + encodeURIComponent(sid), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })   // hors ligne : rien à lire
      .then(function (d) {
        if (!d || !d.ok) return;
        objetsBureau = d.objets || [];
        bureauCharge = true;
        rafraichirBureau();
      });
  }

  function ecrireObjetBureau(corps) {
    var sid = jetonSid();
    if (!sid) return Promise.resolve(null);
    corps.sid = sid;
    return fetch('/api/light/bureau/objets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  /*
   * `initGrid` + `getNextAvailablePos` : la première case libre, en balayant
   * ligne par ligne. Les cases occupées sont celles des objets DÉJÀ POSÉS —
   * et « posé » veut dire : qui a une position.
   *
   * IL Y EN A QUI N'EN ONT PAS, et c'est le cas le plus courant : quand
   * main.swf pose un disque sur le bureau, `/ff/mv` appelle `desktopAdd` SANS
   * coordonnées, et `bureauObjetEnrichi` renvoie `pos: null`. Or on entre ici
   * précisément pour donner une place à ces objets-là : la boucle les
   * rencontrait donc avec leur `pos` encore nul et lisait `o.pos.x`.
   *
   * Le TypeError partait dans le `.catch` de `chargerObjetsBureau` — celui
   * qui devait couvrir la coupure réseau — et le bureau restait NU. Pas une
   * icône, pas un message : un seul disque posé depuis le Flash suffisait à
   * effacer tout le bureau du portage.
   */
  function caseLibreBureau(parent) {
    var bureau = $('#bureau');
    var l = bureau ? bureau.clientWidth : 1200, h = bureau ? bureau.clientHeight : 700;
    var xMax = Math.max(1, Math.floor(l / GRILLE_PAS));
    var yMax = Math.max(1, Math.floor(h / GRILLE_PAS));
    var prises = {};
    objetsBureau.forEach(function (o) {
      if ((o.parent || 'root') !== parent) return;
      if (!o.pos) return;               // pas encore placé : il ne prend rien
      prises[Math.round(o.pos.x / GRILLE_PAS) + ':' + Math.round(o.pos.y / GRILLE_PAS)] = true;
    });
    // ET LA RANGÉE D'ICÔNES PREND SES CASES. D'époque il n'y a qu'UNE liste :
    // `/ff/ls?uid=root` sert la boîte de réception, les disques, l'inventaire,
    // les contacts, la corbeille ET ce que le joueur a posé, dans le même
    // `cp.DragIconList` — `getNextAvailablePos` saute donc naturellement les
    // cases des premières. Le portage, lui, montre les fixes dans `#home-grid`
    // et le reste en absolu : sans cela, la première case libre tombe en
    // (18, 12), c'est-à-dire DERRIÈRE la barre du haut. Une icône sans
    // position y disparaissait — celle de Gaspard, et tout disque que
    // main.swf pose sans coordonnées.
    // La rangée commence à `main.cornerY` : au-dessus d'elle il n'y a pas de
    // case du tout — c'est la barre du haut. On barre donc TOUT ce qui précède
    // sa dernière ligne, pas seulement les lignes qu'elle recouvre.
    var rangee = bureau && bureau.querySelector('#home-grid');
    if (rangee) {
      var rb = rangee.getBoundingClientRect(), bb = bureau.getBoundingClientRect();
      var y1 = Math.ceil((rb.bottom - bb.top - GRILLE_MY) / GRILLE_PAS);
      for (var ry = 0; ry < y1; ry++) {
        for (var rx = 0; rx < xMax; rx++) prises[rx + ':' + ry] = true;
      }
    }
    for (var y = 0; y < yMax; y++) {
      for (var x = 0; x < xMax; x++) {
        if (!prises[x + ':' + y]) return { x: x * GRILLE_PAS, y: y * GRILLE_PAS };
      }
    }
    return { x: 0, y: 0 };
  }

  // `fitInGrid` : une position hors cadre revient par pas ENTIERS de
  // `gridSpace`, puis `findNear` cherche une case libre à moins de dix.
  function rangerDansGrille(pos, parent) {
    var bureau = $('#bureau');
    var l = bureau ? bureau.clientWidth : 1200, h = bureau ? bureau.clientHeight : 700;
    var xMax = Math.max(1, Math.floor(l / GRILLE_PAS));
    var yMax = Math.max(1, Math.floor(h / GRILLE_PAS));
    var x = pos.x, y = pos.y;
    while (x > (xMax - 1) * GRILLE_PAS) x -= GRILLE_PAS;
    while (y > (yMax - 1) * GRILLE_PAS) y -= GRILLE_PAS;
    return { x: Math.max(0, x), y: Math.max(0, y), parent: parent };
  }

  // `FPDesktop.onDrop`, branche par branche.
  function deposerSurBureau(info, x, y, ctrl) {
    var bureau = $('#bureau');
    if (!bureau) return false;
    var app = bureau.getBoundingClientRect();
    // `globalToLocal` : la position du curseur DANS la liste d'icônes, dont
    // l'origine est la marge de `displayIconList`.
    var pos = rangerDansGrille({
      x: Math.round(x - app.left - GRILLE_MX),
      y: Math.round(y - app.top - GRILLE_MY),
    }, 'root');

    // Un objet DÉJÀ du bureau ne se recrée pas : il se repositionne.
    var dedans = info.uid && trouverObjet(info.uid);
    if (dedans && !ctrl) {
      dedans.pos = { x: pos.x, y: pos.y };
      dedans.parent = 'root';
      rafraichirBureau();
      ecrireObjetBureau({ action: 'move', uid: dedans.uid, parent: 'root', pos: dedans.pos });
      return true;
    }
    return creerObjetBureau(info, 'root', pos);
  }

  function deposerDansDossier(info, uid) {
    if (!uid) return false;
    var dedans = info.uid && trouverObjet(info.uid);
    if (dedans) {
      if (dedans.uid === uid) return false;         // un dossier dans lui-même
      dedans.parent = uid;
      dedans.pos = caseLibreBureau(uid);
      rafraichirBureau();
      ecrireObjetBureau({ action: 'move', uid: dedans.uid, parent: uid, pos: dedans.pos });
      return true;
    }
    return creerObjetBureau(info, uid, caseLibreBureau(uid));
  }

  /*
   * RANGER DANS UNE FENÊTRE D'EXPLORATEUR (`fileMng.move(uid, dossier)`).
   *
   * « Mes disques » est la BOÎTE du serveur : un disque y est TOUJOURS. Ce qui
   * l'en sort, ce n'est pas un déménagement mais un raccourci posé ailleurs —
   * sur le bureau ou dans un dossier. L'y ranger, c'est donc retirer ce
   * raccourci-là ; et un disque qui sort du lecteur sans raccourci y rentre de
   * lui-même, le geste réussit quand même.
   *
   * L'inventaire, lui, ne range rien : ses accessoires, fonds et pictos ne se
   * posent pas sur le bureau d'époque (ils s'APPLIQUENT — cf.
   * `box.Explorer.specialClick`), il n'y a donc rien à lui rendre.
   */
  function deposerDansExplorateur(info, cle) {
    if (cle !== 'disques' || !info || info.type !== 'disc') return false;
    var dedans = info.uid && trouverObjet(info.uid);
    if (dedans) retirerObjetBureau(dedans.uid);
    return true;
  }

  // `fileMng.addListener` : chaque explorateur ouvert écoute SON dossier et se
  // relit quand il change. Le portage relit simplement ce qui est affiché.
  function relireExplorateurs() {
    for (var cle in exEtats) {
      var e = exEtats[cle];
      if (e && e.uid) ouvrirDossier(cle, e.uid, e.titre);
    }
  }

  function creerObjetBureau(info, parent, pos) {
    // `fileMng.make` ne connaît que ce que l'icône glissée porte : son type,
    // son `desc` et son nom. Un accessoire ou un fond ne se posent pas sur le
    // bureau d'époque (ils s'appliquent), on ne prend que ce qui s'y pose.
    if (info.type !== 'contact' && info.type !== 'disc' && info.type !== 'folder') return false;
    // L'UID est celui du fichier : l'identifiant du disque au catalogue,
    // l'adresse pour un contact. C'est ce que `fileMng` manipule d'époque, et
    // c'est ce qui fait qu'un disque posé quitte « Mes disques ».
    var uid = info.type === 'contact' ? (info.desc || [])[0] : info.uid;
    var provisoire = {
      uid: uid || ('tmp' + Math.random().toString(36).slice(2)),
      parent: parent, type: info.type,
      desc: (info.desc || []).slice(),
      name: info.name || '',
      pos: { x: pos.x, y: pos.y },
    };
    if (trouverObjet(provisoire.uid)) return false;      // déjà posé
    objetsBureau.push(provisoire);
    rafraichirBureau();
    ecrireObjetBureau({
      action: 'make', parent: parent, type: info.type, uid: uid,
      desc: provisoire.desc, name: provisoire.name, pos: provisoire.pos,
    }).then(function (d) {
      var i = objetsBureau.indexOf(provisoire);
      if (!d || !d.ok) { if (i >= 0) objetsBureau.splice(i, 1); rafraichirBureau(); return; }
      // Le serveur refuse le doublon d'un contact : l'icône revient à sa
      // place, comme d'époque quand `fileMng` renvoie une erreur.
      if (d.deja) { if (i >= 0) objetsBureau.splice(i, 1); rafraichirBureau(); return; }
      if (i >= 0) objetsBureau[i] = d.objet;
      rafraichirBureau();
    });
    return true;
  }

  function trouverObjet(uid) {
    for (var i = 0; i < objetsBureau.length; i++) if (objetsBureau[i].uid === uid) return objetsBureau[i];
    return null;
  }

  function retirerObjetBureau(uid) {
    for (var i = objetsBureau.length - 1; i >= 0; i--) {
      if (objetsBureau[i].uid === uid || objetsBureau[i].parent === uid) objetsBureau.splice(i, 1);
    }
    rafraichirBureau();
    ecrireObjetBureau({ action: 'remove', uid: uid });
  }

  // `newIconObj` : un disque prend `fileIconFull` (pas d'étiquette), tout le
  // reste `fileIconStandard`. Et `but.Icon.display` remplace le dessin d'un
  // contact par sa FRUTIBOUILLE.
  function dessinObjet(o) {
    if (o.type === 'disc') return dessinDisque(o.desc[0], o.desc[1] || '');
    if (o.type === 'folder') return dessinStandard('ico_folder');
    return dessinBouille(o.desc[1] || '');
  }

  function dessinerObjetsBureau() {
    var bureau = $('#bureau');
    if (!bureau) return;
    var vieux = bureau.querySelectorAll('.fb-raccourci');
    for (var v = 0; v < vieux.length; v++) vieux[v].remove();
    // `fitInGrid` : ce qui n'a pas de position prend la première case libre.
    objetsBureau.forEach(function (o) {
      if (!o.pos) o.pos = caseLibreBureau(o.parent || 'root');
    });
    objetsBureau.forEach(function (o) {
      if ((o.parent || 'root') !== 'root') return;
      if (dansLeLecteur(o)) return;      // `fileMng.frusionOn` : il n'est plus là
      bureau.appendChild(raccourciBureau(o));
    });
  }

  /*
   * `fileMng.frusionOn(info)` / `frusionOff()` — LE DISQUE QUI TOURNE N'EST
   * NULLE PART AILLEURS.
   *
   * D'époque, insérer un disque le retire du GESTIONNAIRE DE FICHIERS : tous
   * ceux qui l'écoutent se relisent, et il disparaît d'un coup de la boîte à
   * disques, du bureau et de tout dossier ouvert. Il y revient à l'éjection.
   *
   * Le portage ne filtrait que la fenêtre « Mes disques » : un disque posé sur
   * le bureau restait sur le bureau pendant qu'il tournait dans le lecteur —
   * on en voyait deux, et l'éjecter en donnait un troisième.
   */
  function dansLeLecteur(o) {
    return !!(frusion && frusion.disque && !frusion.rendu
      && o && frusion.disque.uid === o.uid);
  }

  function raccourciBureau(o) {
    var d = document.createElement('div');
    d.className = 'fb-raccourci fb-r-' + o.type;
    d.setAttribute('data-uid', o.uid);
    // Un DOSSIER est un `dropBox` : `IconFileBox.onDrop` prend son propre uid
    // pour cible. Les autres n'en sont pas — le dépôt file au bureau.
    if (o.type === 'folder') { d.setAttribute('data-depot', 'dossier'); }
    d.style.left = (GRILLE_MX + o.pos.x) + 'px';
    d.style.top = (GRILLE_MY + o.pos.y) + 'px';
    d.appendChild(dessinObjet(o));
    if (o.type !== 'disc') {           // `but.icon.Full` ne met pas d'étiquette
      var l = document.createElement('span');
      l.className = 'fb-r-lbl';
      l.textContent = o.name || o.desc[0] || '';
      d.appendChild(l);
    }
    d.title = o.type === 'contact' ? o.name : (o.name || '');

    /*
     * `IconFileBox.click` : le contrôle de glissé court encore ⇒ c'était un
     * CLIC. Un disque ne fait RIEN, comme d'époque (la branche « disc »
     * d'`openFunctions.as` est commentée). Un contact, lui, suit la règle
     * qu'écrit `openFunctions.as` mot pour mot :
     *
     *     case "contact":
     *       if(obj.name.indexOf("@") < 0){
     *         if(obj.name.toLowerCase() == Lang.fv("help.name").toLowerCase()){
     *           _global.chatNow(obj.name);              ← GASPARD
     *         }else{
     *           _global.frutizInfMng.open(obj.name, _global.desktop);
     *         }
     *       }
     *
     * et `chatMng.open` renvoie Gaspard sur `uniqWinMng.open("help")` : son
     * icône n'ouvre donc pas une fiche, elle ouvre SA FENÊTRE.
     */
    d.addEventListener('click', function (ev) {
      if (Date.now() - dernierDepot < 250) { ev.stopPropagation(); return; }
      if (o.type === 'contact') {
        if (estGaspard(o.name || o.desc[0])) ouvrirGaspard();
        else ouvrirFiche(o.name || o.desc[0]);
      } else if (o.type === 'folder') ouvrirDossierBureau(o);
    });
    // `getFileContextMenu` : d'époque le clic droit offre de jeter le fichier.
    d.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      if (window.confirm('Retirer « ' + (o.name || o.desc[0]) + ' » du bureau ?')) retirerObjetBureau(o.uid);
    });
    rendreAttrapable(d, {
      uid: o.uid, type: o.type, desc: o.desc, name: o.name,
    }, function () { return dessinObjet(o); });
    return d;
  }

  // `Lang.fv("help.name")` — le nom que `openFunctions.as` compare, en
  // minuscules, pour reconnaître Gaspard parmi les contacts.
  function estGaspard(nom) {
    return String(nom || '').split('@')[0].toLowerCase() === GS_MOTS.nom.toLowerCase();
  }

  /*
   * L'ICÔNE DE GASPARD DANS LA RANGÉE DU BUREAU.
   *
   * D'époque il n'y a qu'une liste d'icônes, et Gaspard y est un CONTACT :
   * `/ff/ls?uid=root` sert, entre l'inventaire et le carnet,
   *
   *     <e u="Gaspard" t="contact" s="10" d="0" a="0">Gaspard@frutiparc.com</e>
   *
   * et `but.Icon.display` remplace le dessin d'un contact par sa
   * FRUTIBOUILLE. Le portage montre les icônes fixes dans `#home-grid` : la
   * tuile de Gaspard y était, mais avec le point d'interrogation de la barre
   * du haut — un dessin de 15 × 14 en `#A2EB56`, vert clair sur vert clair.
   * On ne voyait rien. On lui rend sa bouille, celle que le serveur garde
   * pour lui.
   */
  function habillerIconeGaspard() {
    var t = $('#home-grid .home-tile[data-go="gaspard"]');
    var ico = t && t.querySelector('.ico');
    if (!ico || ico._gsHabille) return;
    ico._gsHabille = true;
    ico.textContent = '';
    ico.appendChild(dessinBouille(GS_BOUILLE));
  }

  var dernierDepot = 0;

  // `FPDesktop.getMenu` : le menu du fond d'écran. D'époque il tient la
  // déconnexion, le mode light, le repli de la barre et la recherche — tout
  // cela vit déjà ailleurs dans le portage. Ne reste ici que ce qui manquait :
  // créer un dossier, comme `explorer_new_folder` le fait dans une fenêtre.
  function menuDuBureau(x, y) {
    var vieux = document.querySelector('.fb-menu-bureau');
    if (vieux) vieux.remove();
    var m = document.createElement('div');
    m.className = 'fb-menu-bureau';
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Nouveau dossier';
    b.addEventListener('click', function () {
      m.remove();
      var nom = window.prompt('Nom du dossier ?', 'Nouveau dossier');
      if (!nom) return;
      var bureau = $('#bureau');
      var app = bureau.getBoundingClientRect();
      creerObjetBureau({ type: 'folder', desc: [], name: nom.slice(0, 40) }, 'root',
        rangerDansGrille({ x: Math.round(x - app.left - GRILLE_MX),
          y: Math.round(y - app.top - GRILLE_MY) }, 'root'));
    });
    m.appendChild(b);
    // « Se déconnecter » : c'est ICI qu'elle vit d'époque, dans le menu du fond
    // d'écran — le bureau n'a pas de pied de page. On appuie sur le bouton du
    // tiroir mobile, qui reste la seule porte de sortie du light.
    var sortir = document.createElement('button');
    sortir.type = 'button';
    sortir.textContent = 'Se déconnecter';
    sortir.addEventListener('click', function () {
      m.remove();
      var q = $('#logout-btn');
      if (q) q.click();
    });
    m.appendChild(sortir);
    document.body.appendChild(m);
    var fermer = function () { m.remove(); document.removeEventListener('pointerdown', fermer, true); };
    setTimeout(function () { document.addEventListener('pointerdown', fermer, true); }, 0);
  }

  // Un dossier du bureau s'ouvre dans une fenêtre, comme
  // `_global.explorerMng.open(ico.uid)` le fait d'époque. Elle est bâtie à la
  // volée — même procédé que « Salons publics », qui n'a pas non plus de
  // panneau mobile à emprunter.
  function ouvrirDossierBureau(o) {
    var tab = 'dossier:' + o.uid;
    var idp = 'fb-dossier-' + o.uid;
    if (!$('#' + idp)) {
      var p = document.createElement('div');
      p.id = idp;
      p.className = 'fb-dossier-panneau';
      p.setAttribute('data-depot', 'dossier');
      p.setAttribute('data-uid', o.uid);
      $('#app').appendChild(p);
      RUBRIQUES[tab] = {
        panneau: '#' + idp, titre: o.name || 'Dossier', fruit: 'winExplorer',
        // Un dossier du bureau s'ouvre dans un `win.Explorer` comme les
        // autres : même gabarit (400 × 400 + contour) et même arrivée au
        // milieu — `explorer_new_folder` ne fait rien d'autre.
        l: 402, h: 402, min: minFenetre(100, 28 + 100), centre: true,
      };
    }
    ouvrirFenetre(tab);
    dessinerDossierBureau(o.uid);
  }

  // Ce que le bureau tient dans un dossier donné — le disque qui tourne dans
  // le lecteur en sort, comme partout ailleurs (`fileMng.frusionOn`).
  function objetsDuDossier(uid) {
    return objetsBureau.filter(function (o) {
      return (o.parent || 'root') === uid && !dansLeLecteur(o);
    });
  }

  function dessinerDossierBureau(uid) {
    var p = $('#fb-dossier-' + uid);
    if (!p) return;
    p.innerHTML = '';
    var liste = objetsDuDossier(uid);
    if (!liste.length) {
      var vide = document.createElement('p');
      vide.className = 'fb-dossier-vide';
      vide.textContent = 'Ce dossier est vide. Glissez-y ce que vous voulez y ranger.';
      p.appendChild(vide);
      return;
    }
    liste.forEach(function (o) {
      var c = caseExplorateur({
        classe: o.type === 'disc' ? 'ex-slot-disque' : '',
        dessin: dessinObjet(o),
        nom: o.type === 'disc' ? undefined : (o.name || o.desc[0] || ''),
        titre: o.name || '',
        faire: o.type === 'contact' ? function () {
          if (Date.now() - dernierDepot < 250) return;
          ouvrirFiche(o.name || o.desc[0]);
        } : undefined,
      });
      c.classList.remove('inerte');
      rendreAttrapable(c, { uid: o.uid, type: o.type, desc: o.desc, name: o.name },
        function () { return dessinObjet(o); });
      p.appendChild(c);
    });
  }

  // Redessiner le bureau ET les dossiers ouverts : un objet peut passer de
  // l'un à l'autre.
  function rafraichirBureau() {
    dessinerObjetsBureau();
    var ouverts = document.querySelectorAll('.fb-dossier-panneau');
    for (var i = 0; i < ouverts.length; i++) dessinerDossierBureau(ouverts[i].getAttribute('data-uid'));
  }

  // Rendre une case d'explorateur ATTRAPABLE. Le clic simple reste possible :
  // c'est la distance parcourue qui décide, comme `IconFileBox.checkDrag`.
  function rendreAttrapable(el, info, dessine) {
    el.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      // Sans cela, tirer sur une icône déclenche la SÉLECTION du navigateur et
      // tout le bureau vire au bleu.
      ev.preventDefault();
      var x0 = ev.clientX, y0 = ev.clientY, parti = false;
      var bouge = function (e) {
        if (!parti) {
          var d = Math.sqrt(Math.pow(e.clientX - x0, 2) + Math.pow(e.clientY - y0, 2));
          if (d <= DIST_MIN_GLISSER) return;
          parti = true;
          el.style.visibility = 'hidden';     // `path._visible = false`
          glisseur.source = el;
          creerIconeGlissee(info, dessine(), e.clientX, e.clientY);
        }
        // `Key.isDown(17)` est lu AU DÉPÔT d'époque ; on retient donc l'état
        // de la touche à chaque pas, le dernier fait foi.
        glisseur.ctrl = !!(e.ctrlKey || e.metaKey);
        glisseur.el.style.left = e.clientX + 'px';
        glisseur.el.style.top = e.clientY + 'px';
      };
      /*
       * LE DÉSABONNEMENT DOIT PORTER LE MÊME DRAPEAU QUE L'ABONNEMENT.
       *
       * `pointerup` était écouté en CAPTURE (`true`) et retiré sans — deux
       * clés différentes pour le navigateur : le retrait ne retirait rien. Un
       * écouteur restait donc accroché au document à CHAQUE glissé, avec son
       * `parti` figé à vrai, et tous les anciens se réveillaient au relâchement
       * suivant : chacun faisait son `stopPropagation()` et appelait
       * `finirGlisser` à vide. De là l'impression, au bout de quelques gestes,
       * qu'« on ne peut plus rien lâcher ».
       */
      var lache = function (e) {
        document.removeEventListener('pointermove', bouge);
        document.removeEventListener('pointerup', lache, true);
        document.removeEventListener('pointercancel', lache, true);
        if (parti) {
          e.preventDefault(); e.stopPropagation();
          glisseur.ctrl = !!(e.ctrlKey || e.metaKey);
          finirGlisser(e.clientX, e.clientY);
        }
      };
      document.addEventListener('pointermove', bouge);
      document.addEventListener('pointerup', lache, true);
      // Un glissé que le navigateur interrompt (le doigt sort de l'écran, une
      // fenêtre passe devant) doit rendre l'icône, pas la laisser invisible.
      document.addEventListener('pointercancel', lache, true);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LE LECTEUR FRUSION (`_global.Frusion`, DoInitAction 0x990e0)

     Le clip `frusion` (#324) n'est pas un décor : c'est une MACHINE. Son
     bytecode donne toute la mécanique, au chiffre près.

         init :  width = 116, margin = 16, slot._y = 71
                 flOpen = flDisc = flRotating = flRunning = false
                 slot.dropBox = this
                 dragListener.addListener("disc", {startMethod:
                     "onStartDragDisc", stopMethod: "onEndDragDisc"})

         openSlot  : moveSlot vers 140      closeSlot : moveSlot vers 71
         moveSlot(y) :
             r = 0,8 ^ tmod
             slot._y = slot._y × r + y × (1 − r)      ← approche exponentielle
             fondSlot._y = slot._y
             si arrondi(slot._y) == arrondi(y) :
                 slot._y = y ; on arrête
                 si y == 71 et flDisc : runDisc()      ← le disque démarre
         rotateDisc(sens) :
             d.speed += tmod × sens ; d._rotation −= d.speed
             si sens > 0 et speed > 140 : on arrête, et la jaquette JOUE son
                 animation de rotation (les anneaux flous du rendu d'époque)
             si sens < 0 et speed < 0   : on arrête, flRotating = false,
                 et `this[discDestiny]()` — c'est ainsi que l'éjection enchaîne

         onStartDragDisc : si !flDisc et !flOpen → openSlot()
         onEndDragDisc   : si !flDisc et flOpen  → closeSlot()
         onDrop(o) : si o.type == "disc" et !flDisc et flOpen :
             flDisc = true ; le disque s'attache au tiroir (fileIconFull) ;
             closeSlot() ; frusionMng.launchDisc(uid) ; fileMng.frusionOn(info)
         pushEject : frusionMng.eject()  → le jeu se ferme, puis
                     stopDisc("releaseDisc")
         releaseDisc : fileMng.frusionOff() ; openSlot() ; le disque devient
                     CLIQUABLE → takeDisc() le rend au curseur
         pushReset : frusionMng.reset() — le jeu redémarre

     Les deux boutons ronds sont des DefineButton2 du clip : #317 à gauche
     appelle `pushReset`, #313 à droite `pushEject` (lu dans leurs actions).

     La GÉOMÉTRIE vient du clip et du relevé 1:1 (scratchpad/fr-*.png) :
     le clip fait 119 × 77,5 et son origine tombe à x 117,5 dans la boîte ;
     le tiroir est posé à (−58, 71), donc à x 59,5 dans la boîte, et descend
     de 69 px ; le disque, lui, fait 63 px et son centre se pose 32,25 px
     AU-DESSUS de l'origine du tiroir — c'est-à-dire au ras du haut de la
     cuve, dont l'ouverture ne laisse voir que sa moitié basse. */
  var FR_L = 119, FR_H = 77.5;          // le cadre du clip
  var FR_X0 = 117.5;                    // l'origine du clip dans la boîte
  var FR_SLOT_X = FR_X0 - 58;           // 59,5 — l'axe du tiroir
  var FR_FERME = 71, FR_OUVERT = 140;   // slot._y, fermé et ouvert
  var FR_DISQUE = 63;                   // la jaquette, à l'échelle 1
  var FR_DISQUE_DY = -32.25;            // son centre, sous l'origine du tiroir
  var FR_VMAX = 140;                    // rotateDisc : au-delà, la jaquette file

  var frusion = {
    boite: null, tiroirs: null, disqueEl: null, cible: null,
    y: FR_FERME, cibleY: FR_FERME, ouvert: false,
    disque: null, vitesse: 0, sens: 0, destin: null, anim: null, dernier: 0,
    // `jeu` : l'onglet du portage. `jeuFlash` : la fenêtre de Ruffle, pour
    // les trois disques qui n'ont pas de portage.
    jeu: null, jeuFlash: null,
  };

  function couche(nom) {
    var d = document.createElement('div');
    d.className = 'fr-couche fr-' + nom;
    return d;
  }

  function batirFrusion() {
    var b = document.createElement('div');
    b.id = 'frusion-boite';
    b.appendChild(couche('arriere'));
    // Le berceau et le tiroir descendent ENSEMBLE (`fondSlot._y = slot._y`),
    // mais de part et d'autre de la plaque du milieu : deux enveloppes.
    var mFond = document.createElement('div');
    mFond.className = 'fr-mobile fr-m-fond';
    mFond.appendChild(couche('fondslot'));
    b.appendChild(mFond);
    b.appendChild(couche('milieu'));
    var mSlot = document.createElement('div');
    mSlot.className = 'fr-mobile fr-m-slot';
    mSlot.appendChild(couche('slot'));
    // Le disque vit DANS le tiroir : il descend avec lui, et la façade ne
    // laisse voir que ce qui passe par la cuve.
    var disque = document.createElement('div');
    disque.className = 'fr-disque';
    // `releaseDisc` pose `slot.disc.onPress = takeDisc` : une fois rendu, le
    // disque se reprend d'un clic — et repart au bout du curseur.
    disque.addEventListener('pointerdown', function (ev) {
      if (!disque.classList.contains('reprenable')) return;
      ev.preventDefault();
      frusion.takeDisc(ev);
    });
    mSlot.appendChild(disque);
    // La zone de dépôt : `slot.dropBox = this`, c'est le TIROIR qu'on vise.
    //
    // Elle est posée SUR LA CONSOLE, pas dans le tiroir. Ses 71 px de haut de
    // page DISENT DÉJÀ le tiroir sorti — c'est la place qu'il occupe une fois
    // descendu. Rangée parmi les pièces mobiles, elle recevait EN PLUS leur
    // translation de 69 et se retrouvait à 140, sous le tiroir, dans le vide :
    // le disque tombait à côté à chaque fois. (Le banc d'essai visait la cible
    // par son propre rectangle — il ne pouvait pas voir la faute.)
    //
    // Et elle passe AVANT le tiroir : le disque rendu, lui, se reprend d'un
    // clic (`slot.disc.onPress = takeDisc`) et doit donc rester au-dessus.
    var cible = document.createElement('div');
    cible.className = 'fr-cible';
    cible.setAttribute('data-depot', 'frusion');
    b.appendChild(cible);
    b.appendChild(mSlot);
    b.appendChild(couche('avant'));
    var casque = document.createElement('button');
    casque.type = 'button';
    casque.className = 'fr-but fr-casque';
    casque.title = 'Redémarrer le jeu';
    casque.addEventListener('click', function () { frusion.pushReset(); });
    var eject = document.createElement('button');
    eject.type = 'button';
    eject.className = 'fr-but fr-eject';
    eject.title = 'Éjecter le disque';
    eject.addEventListener('click', function () { frusion.pushEject(); });
    b.appendChild(casque);
    b.appendChild(eject);

    frusion.boite = b;
    frusion.tiroirs = [mFond, mSlot];
    frusion.disqueEl = disque;
    frusion.cible = cible;
    frusion.poser();
    // Le lecteur s'abonne au glisser des DISQUES, comme d'époque.
    ecouterGlisser('disc', {
      debut: function () { frusion.onStartDragDisc(); },
      fin: function () { frusion.onEndDragDisc(); },
    });
    return b;
  }

  frusion.poser = function () {
    var d = this.y - FR_FERME;
    for (var i = 0; i < this.tiroirs.length; i++) {
      this.tiroirs[i].style.transform = 'translateY(' + d.toFixed(2) + 'px)';
    }
  };

  // `AnimList` bat toutes les 25 ms ; `tmod` mesure le temps réellement passé
  // en multiples de ce battement. Une boucle d'animation du navigateur donne
  // la même chose, sans minuterie.
  frusion.battre = function () {
    var self = this;
    if (this.anim) return;
    this.dernier = 0;
    var pas = function (t) {
      self.anim = null;
      var tmod = self.dernier ? Math.min(4, (t - self.dernier) / 25) : 1;
      self.dernier = t;
      var encore = false;
      if (self.y !== self.cibleY) { self.moveSlot(self.cibleY, tmod); encore = true; }
      if (self.sens) { self.rotateDisc(self.sens, tmod); encore = true; }
      // LE DISQUE NE S'ARRÊTE PAS UNE FOIS LANCÉ. `rotateDisc` met `sens` à
      // zéro quand la vitesse atteint 140 — d'époque, c'est là que la JAQUETTE
      // prend le relais et joue son animation de rotation. Ici il n'y avait
      // rien derrière : la boucle s'arrêtait et le disque restait FIGÉ sur son
      // dernier angle. Il continue donc de tourner à cette vitesse-là, ce qui
      // est le même mouvement, sans dessin supplémentaire.
      else if (self.file) { self.tournerAVide(tmod); encore = true; }
      if (encore) self.anim = requestAnimationFrame(pas);
    };
    this.anim = requestAnimationFrame(pas);
  };

  frusion.moveSlot = function (y, tmod) {
    var r = Math.pow(0.8, tmod);
    this.y = this.y * r + y * (1 - r);
    if (Math.round(this.y) === Math.round(y)) {
      this.y = y;
      // « si y == 71 et flDisc : runDisc() » — le tiroir refermé sur un
      // disque, la machine le lance.
      if (y === FR_FERME && this.disque) this.runDisc();
    }
    this.poser();
  };

  frusion.openSlot = function () {
    this.cibleY = FR_OUVERT; this.ouvert = true;
    this.boite.classList.add('fr-ouvert');
    this.battre();
  };
  frusion.closeSlot = function () {
    this.cibleY = FR_FERME; this.ouvert = false;
    this.boite.classList.remove('fr-ouvert');
    this.battre();
  };

  frusion.runDisc = function () { this.sens = 1; this.battre(); };
  frusion.stopDisc = function (destin) {
    this.destin = destin || null;
    this.sens = -2;
    this.battre();
  };
  frusion.rotateDisc = function (sens, tmod) {
    this.vitesse += tmod * sens;
    this.rotation = (this.rotation || 0) - this.vitesse;
    if (this.disqueEl) this.disqueEl.style.transform = 'rotate(' + this.rotation.toFixed(1) + 'deg)';
    if (sens > 0 && this.vitesse > FR_VMAX) {
      // D'époque le clip s'arrête là et la JAQUETTE joue son animation de
      // rotation — les anneaux flous du rendu 1:1. Ici, c'est le disque qui
      // continue de tourner à cette vitesse-là : le même flou, sans dessin
      // supplémentaire.
      this.vitesse = FR_VMAX;
      this.file = true;                 // il file — et il continue de filer
      if (this.disqueEl) this.disqueEl.classList.add('file');
      this.sens = 0;
    }
    if (sens < 0 && this.vitesse < 0) {
      this.sens = 0;
      this.vitesse = 0;
      this.file = false;
      if (this.disqueEl) this.disqueEl.classList.remove('file');
      var d = this.destin;
      this.destin = null;
      if (d && this[d]) this[d]();
    }
  };

  // La rotation d'entretien, à vitesse constante : celle que la jaquette
  // d'époque jouait toute seule une fois le disque lancé.
  frusion.tournerAVide = function (tmod) {
    // Le modulo replie l'angle dans un tour à chaque image. D'époque le
    // bytecode écrit `d._rotation -= d.speed` sans borne, mais `_rotation`
    // est une propriété de Flash, que le lecteur ramène lui-même entre -180
    // et 180 : c'est le même mouvement. Une transformation CSS, elle,
    // accepterait un angle qui enfle sans fin — des millions de degrés au
    // bout d'une partie, et la précision du dixième finirait par y passer.
    this.rotation = ((this.rotation || 0) - FR_VMAX * tmod) % 360;
    if (this.disqueEl) this.disqueEl.style.transform = 'rotate(' + this.rotation.toFixed(1) + 'deg)';
  };

  frusion.onStartDragDisc = function () { if (!this.disque && !this.ouvert) this.openSlot(); };
  frusion.onEndDragDisc = function () { if (!this.disque && this.ouvert) this.closeSlot(); };

  // `onDrop` : le disque entre, le tiroir se referme, et le jeu se lance.
  frusion.deposer = function (info) {
    if (!info || info.type !== 'disc' || this.disque || !this.ouvert) return false;
    this.disque = info;
    this.disqueEl.textContent = '';
    this.disqueEl.appendChild(dessinDisque(info.desc[0], info.desc[1]));
    this.disqueEl.classList.add('plein');
    this.disqueEl.classList.remove('file');
    this.file = false;
    this.rendu = false;                 // `fileMng.frusionOn` : il quitte ses dossiers
    this.rotation = 0;
    this.vitesse = 0;
    this.closeSlot();
    this.lancer(info);
    rafraichirDisques();
    return true;
  };

  // `frusionMng.launchDisc` + `FPSlotList.addSlot(slot, true)` : le jeu ne
  // s'ouvre pas en fenêtre flottante, il prend l'espace de travail et se
  // donne un ONGLET à côté de « Bureau ».
  frusion.lancer = function (info) {
    var tab = JEUX_LIGHT[String(info.desc[1] || '').toLowerCase()];
    this.jeu = null;
    this.jeuFlash = null;
    // LES TROIS DISQUES QUI SONT ENCORE EN FLASH : pas d'onglet, une FENÊTRE
    // À PART (game-popup.html + Ruffle) — celle que la Frusion d'époque
    // ouvrait déjà pour eux depuis `ruffle.html`.
    if (!tab) {
      var f = jeuFlashDe(info.desc[1] || '');
      if (f && window.JeuxFlash) { this.jeuFlash = f; window.JeuxFlash.ouvrir(f); }
      return;
    }
    if (!window.activateTab) return;
    this.jeu = tab;
    window.activateTab(tab);
    var rub = RUBRIQUES[tab];
    var panneau = rub && $(rub.panneau);
    if (panneau && fenetres[panneau.id] && !fenetres[panneau.id].onglet) {
      // Un jeu qu'on vient de lancer S'AFFICHE : `FPSlotList.addSlot(slot,
      // flGo)` avec flGo vrai, l'onglet s'active dans la foulée.
      mettreEnOnglet(panneau.id, true);
    }
  };

  frusion.pushEject = function () {
    if (!this.disque || this.sens < 0) return;
    // `frusionMng.eject()` demande au jeu de se fermer ; quand il a rendu la
    // main, la machine ralentit le disque et le rend.
    if (this.jeu) {
      var rub = RUBRIQUES[this.jeu];
      var panneau = rub && $(rub.panneau);
      if (panneau && fenetres[panneau.id]) fermerFenetre(panneau.id);
      this.jeu = null;
    }
    // Un jeu Flash n'a pas d'onglet à fermer : c'est sa fenêtre qui s'en va.
    if (this.jeuFlash) {
      if (window.JeuxFlash) window.JeuxFlash.fermer();
      this.jeuFlash = null;
    }
    this.stopDisc('releaseDisc');
  };

  frusion.pushReset = function () {
    // `frusionMng.reset()` vaut pour les deux : l'onglet du portage comme la
    // fenêtre de Ruffle.
    if (this.disque && !this.jeu && this.jeuFlash) {
      var f = this.jeuFlash;
      if (window.JeuxFlash) { window.JeuxFlash.fermer(); window.JeuxFlash.ouvrir(f); }
      return;
    }
    if (!this.disque || !this.jeu) return;
    // `frusionMng.reset()` : le jeu redémarre. Le portage n'a pas le canal du
    // Frusion Server — on refait ce qu'il fait de visible : on referme le jeu
    // et on le relance sur le même disque.
    var jeu = this.jeu;
    var rub = RUBRIQUES[jeu];
    var panneau = rub && $(rub.panneau);
    if (panneau && fenetres[panneau.id]) fermerFenetre(panneau.id);
    var self = this;
    setTimeout(function () { self.lancer(self.disque); }, 80);
  };

  // `releaseDisc` : le tiroir ressort et le disque, posé dedans, redevient
  // attrapable — un clic dessus le remet au bout du curseur (`takeDisc`).
  frusion.releaseDisc = function () {
    // `fileMng.frusionOff()` : le disque redevient un fichier comme les
    // autres — il repeuple sa boîte et son dossier AVANT même qu'on le
    // reprenne au curseur. `rendu` est ce drapeau-là.
    this.rendu = true;
    this.openSlot();
    this.disqueEl.classList.add('reprenable');
    rafraichirDisques();
  };

  frusion.takeDisc = function (ev) {
    if (!this.disque) return;
    var info = this.disque;
    this.removeDisc();
    // `iconInfo.comeFromFrusion = true` : le disque revient du lecteur.
    info = Object.assign({}, info, { comeFromFrusion: true });
    glisseur.source = null;
    creerIconeGlissee(info, dessinDisque(info.desc[0], info.desc[1]), ev.clientX, ev.clientY);
    var bouge = function (e) {
      if (!glisseur.el) return;
      glisseur.el.style.left = e.clientX + 'px';
      glisseur.el.style.top = e.clientY + 'px';
    };
    var lache = function (e) {
      document.removeEventListener('pointermove', bouge);
      document.removeEventListener('pointerup', lache, true);
      finirGlisser(e.clientX, e.clientY);
    };
    document.addEventListener('pointermove', bouge);
    document.addEventListener('pointerup', lache, true);
  };

  frusion.removeDisc = function () {
    this.disque = null;
    this.rendu = false;
    this.disqueEl.textContent = '';
    this.disqueEl.classList.remove('plein', 'file', 'reprenable');
    rafraichirDisques();
  };

  // TOUS les écoutants de `fileMng` suivent l'état du lecteur : la fenêtre
  // « Mes disques », le bureau, et les dossiers ouverts. Le disque inséré les
  // quitte, le disque éjecté y rentre.
  function rafraichirDisques() {
    var e = exEtats.disques;
    if (e && e.uid && $(EXPLORATEURS.disques.panneau)) ouvrirDossier('disques', e.uid, e.titre);
    rafraichirBureau();
  }

  // `forceCloseSlot` : le disque s'en va sans qu'on le reprenne (on a fermé
  // le jeu autrement, ou quitté le bureau).
  frusion.forceCloseSlot = function () {
    if (!this.ouvert) return;
    if (this.disque) this.removeDisc();
    this.closeSlot();
  };

  // L'ouverture depuis le bureau : la fenêtre, puis la racine du dossier.
  function ouvrirExplorateur(cle) {
    if (!actif) return;
    var conf = EXPLORATEURS[cle];
    if (!conf) return;
    if (!$(conf.panneau)) $('#app').appendChild(panneauExplorateur(cle));
    var neuf = !exEtats[cle];
    ouvrirFenetre('ex-' + cle);
    exEtats[cle] = exEtats[cle] || { panneau: $(conf.panneau), uid: null, titre: conf.titre };
    // Rouverte, la fenêtre revient à la RACINE : `box.Explorer.init` refait
    // `getList()` sans argument, et `close()` a effacé l'uid courant.
    if (neuf || exEtats[cle].uid === null) ouvrirDossier(cle, conf.uid, conf.titre);
    else ouvrirDossier(cle, exEtats[cle].uid, exEtats[cle].titre);
  }

  // La fenêtre du salon porte le NOM du salon SUIVI DE SON AFFLUENCE, comme
  // le bureau d'époque — « Salon Fraise (1) » sur le rendu de référence.
  // « Salons » tout court ne disait rien de l'endroit où l'on parle.
  function majTitreSalon(salon) {
    var S = window.SalonsBureau;
    if (!S) return;
    // Sans salon nommé, on retitre TOUTES les fenêtres de conversation :
    // l'affluence d'un salon bouge sans qu'on lui parle.
    var cles = salon ? ['salon:' + salon] : Object.keys(fenetres);
    cles.forEach(function (cle) {
      var f = fenetres[cle];
      if (!f || !f.salon) return;
      var nom = S.titreDe(f.salon);
      if (!nom) return;
      var n = S.affluenceDe(f.salon);
      retitrer(cle, nom + (n === null ? '' : ' (' + n + ')'));
    });
  }

  // LE QUATRIÈME BOUTON de la colonne du salon : `chat_warning`, qui d'époque
  // appelle `box.whining` — un appel au modérateur. Le serveur du revival n'a
  // pas ce fil-là ; le bouton est dessiné parce qu'il fait partie de la
  // fenêtre, mais il est désactivé et le dit. (Le cri modérateur « !texte »
  // du light, lui, marche toujours.)
  // LE BOUTON DES BOUILLES. D'époque (`toggleScreenList`, 0x69646) il ouvre un
  // PANNEAU qui reste — `cpScreenList`, 100 de large, dans la marge gauche — et
  // range du même coup la colonne des icônes en RANGÉE (`min.h` passe à
  // `lefIconListHMaxLarge`). Le light, lui, s'en sert pour une préférence :
  // afficher ou non la bouille de qui vient de parler, en surimpression du fil.
  //
  // Sur le bureau, c'est le geste d'époque qui l'emporte : le clic est
  // intercepté AVANT d'atteindre le bouton (capture sur le corps de la
  // fenêtre), et il ouvre ou ferme le panneau. La préférence du light reste
  // celle du mobile, où rien ne change.
  function brancherBouillesSalon(f) {
    if (f.bouillesBranchees) return;
    f.bouillesBranchees = true;
    var panneau = f.panneau;
    f.corps.addEventListener('click', function (e) {
      if (!actif) return;
      var c = e.target && e.target.closest ? e.target : null;
      if (!c) return;
      if (c.closest('#bouille-toggle')) {
        e.stopPropagation();
        e.preventDefault();
        var t = panneau.querySelector('#topbar');
        var ouvert = panneau.classList.toggle('bouilles-ouvertes');
        if (t) t.classList.toggle('en-rangee', ouvert);
        // La fenêtre grandit D'ABORD s'il le faut : c'est sa hauteur qui dit
        // combien d'écrans tiennent, donc lequel des deux visages la zone
        // prend.
        appliquerMinimum(f);
        if (ouvert) majBouilles(panneau);
        return;
      }
      // Les feutres et les connectés, eux, sont bien branchés côté light : on
      // repasse APRÈS lui pour relever le minimum, comme `onFrameSetUpdate`.
      if (c.closest('#pen-btn') || c.closest('#users-btn')) {
        setTimeout(function () { appliquerMinimum(f); majBouilles(panneau); }, 0);
      }
    }, true);
    brancherEcrans(f);
  }

  /*
   * LE CLIC ET LE SURVOL D'UN ÉCRAN — communs à TOUTES les fenêtres qui en
   * portent. `cp.ScreenList` est le même composant partout : le salon en
   * empile un par membre, `win.Help` en empile un par personne de sa liste
   * (soi et Gaspard). Les deux gestes viennent donc du même endroit, au lieu
   * de n'exister que dans la fenêtre de salon.
   *
   *   clic    `attachFrutiScreen` (0xb6597) pose
   *           `setAction({obj: win.box, method: 'openFrutizInfo', args: u})`
   *   survol  `cp.FrutiScreen.setTip` (0x6299a) : `onRollOver` appelle
   *           `tip.displayCallBack({id, cb})`, `onRollOut` `tip.remove(id)`.
   *           La bulle se pose UNE FOIS, au point d'entrée, et n'y bouge plus
   *           — vérifié sur Ruffle : trois survols, trois bulles au même écart
   *           du curseur.
   */
  function brancherEcrans(f) {
    if (f.ecransBranches) return;
    f.ecransBranches = true;
    var panneau = f.panneau;
    f.corps.addEventListener('click', function (e) {
      if (!actif) return;
      var ec = e.target && e.target.closest ? e.target.closest('.bo-ecran:not(.clb)') : null;
      if (!ec || !ec.getAttribute('data-nom')) return;
      e.stopPropagation();
      e.preventDefault();
      tipCacher();
      var nom = ec.getAttribute('data-nom');
      // Gaspard n'a pas de fiche : `openFunctions.as` renvoie son nom sur
      // `chatNow`, et `chatMng.open` sur `uniqWinMng.open("help")`.
      if (estGaspard(nom)) { ouvrirGaspard(); return; }
      var S = window.SalonsBureau;
      // Le SALON de cette fenêtre-là : c'est lui que la fiche retiendra pour
      // son kick (`box.Frutiz` est ouverte PAR un salon, `openFrutizInfo`).
      if (S && S.ouvrirFiche) S.ouvrirFiche(nom, panneau.getAttribute('data-salon'));
    }, true);
    f.corps.addEventListener('mouseover', function (e) {
      if (!actif) return;
      var ec = e.target && e.target.closest ? e.target.closest('.bo-ecran:not(.clb)') : null;
      if (!ec || !ec.getAttribute('data-nom') || ec === tipCible) return;
      tipMontrer(ec, e.clientX, e.clientY);
    });
    f.corps.addEventListener('mouseout', function (e) {
      if (!tipCible) return;
      var ec = e.target && e.target.closest ? e.target.closest('.bo-ecran:not(.clb)') : null;
      if (ec !== tipCible) return;
      if (e.relatedTarget && ec.contains(e.relatedTarget)) return;
      tipCacher();
    });
  }

  // ── LA BULLE DE SURVOL ────────────────────────────────────────────────────
  // `TipTextMng.display` attache le clip `tipText` sur `main`, à la profondeur
  // `Depths.tipText` : au-dessus de tout, et SANS jamais intercepter la souris.
  // Le relevé 1:1 (Ruffle, fenêtre 626×486) donne la géométrie exacte :
  //   coin haut-gauche = (souris.x − 1, souris.y + 19)
  //   boîte 122 × 48, arrondi 6, liserés (de l'extérieur vers la chair)
  //   1 px #66AA22 · 2 px #DDFFBB · 2 px #94DB39 · 1 px #ADE76B · chair #CCF599
  //   reflet blanc en haut de la chair : .72 → 0 sur 9 px (les neuf valeurs
  //   mesurées tombent au centième)
  //   texte Verdana 10 px, interligne 12, encre noire, 3 px de marge à gauche
  // La LARGEUR NE S'ADAPTE PAS au texte : « zoe » comme « Gaspard » donnent
  // 122 de large. Et le pseudo tient sa ligne à lui seul — c'est ainsi que le
  // champ HTML du SWF rend `<b>$u</b> : …`.
  var tipCible = null;
  var tipBoite = null;
  function tipMontrer(ec, x, y) {
    var pseudo = ec.getAttribute('data-nom');
    var S = window.SalonsBureau;
    if (!S || !S.infoBasique) return;
    tipCible = ec;
    if (!tipBoite) {
      tipBoite = document.createElement('div');
      tipBoite.className = 'bo-tip';
      // Sur le corps du document, pas dans `#bureau-haut` : la couche haute
      // rend la souris à tous ses enfants, et une bulle qui intercepte le
      // curseur se ferait fuir elle-même.
      document.body.appendChild(tipBoite);
    }
    // (souris.x − 1, souris.y + 19) est le coin de la boîte VISIBLE, anneaux
    // compris ; l'élément, lui, commence 5 px plus loin — les trois anneaux
    // sont des ombres portées, hors boîte.
    tipBoite.style.left = (x + 4) + 'px';
    tipBoite.style.top = (y + 24) + 'px';
    tipEcrire(pseudo, S.infoBasique(pseudo));
    // La table des pays peut arriver après coup : on réécrit alors la bulle,
    // si elle parle encore du même écran.
    S.infoBasique(pseudo, function (i) {
      if (tipCible === ec) tipEcrire(pseudo, i);
    });
    tipBoite.classList.add('vue');
  }
  function tipEcrire(pseudo, i) {
    if (!tipBoite) return;
    // « <b>$u</b> : $a ans, $r ($c), niveau $l » (langText.chat.u_tip_long).
    var b = document.createElement('b');
    b.textContent = pseudo;
    tipBoite.textContent = '';
    tipBoite.appendChild(b);
    tipBoite.appendChild(document.createTextNode(i
      ? ' : ' + i.age + ' ans, ' + i.region + ' (' + i.pays + '), niveau ' + i.niveau
      : ''));
  }
  function tipCacher() {
    tipCible = null;
    if (tipBoite) tipBoite.classList.remove('vue');
  }

  // ── LE MINIMUM DE LA FENÊTRE DU SALON ────────────────────────────────────
  // L'arbre de cadres du salon : `margin.left` porte la colonne d'icônes et,
  // quand elle s'ouvre, la pile des bouilles ; `main` porte le fil, les
  // feutres et la saisie ; `margin.right` les connectés. Un cadre de type
  // « w » empile ses enfants EN HAUTEUR (les hauteurs s'ajoutent, les largeurs
  // se maximisent) ; un cadre « h » les range en largeur (`updateMinInt`,
  // 0x479e9). Les mins sont écrits dans le bytecode :
  //   colonne d'icônes   min {w:24}          marge 8   (0x694b0)
  //   cpScreenList       min {w:100, h:200}  marge 12  (0x6973d)
  //   multiTextField     min {w:100, h:100}  marge INTÉRIEURE 8 (0x68b1f)
  //   cpPenList          min {w:120, h:48}   marge 6   (0x69849)
  //   cpUserList         min {w:122, h:100}  marge 6   (0x66c9f)
  //   inputField         14 de haut,         marge 6   (0x68c46)
  // et la colonne d'icônes passe de 104 (quatre gélules au pas de 26) à 28
  // quand les bouilles l'obligent à se mettre en rangée (0x69646).
  //
  // Vérifié sur Ruffle : on rétrécit la fenêtre à fond par sa poignée, puis on
  // ouvre les panneaux un à un — elle grandit d'elle-même jusqu'au nouveau
  // minimum. Relevé au pixel sur le cadre `#444444` :
  //   nu 202×156 · +bouilles 228×256 · +connectés 356×256 · +feutres 374×256.
  // Les 8 px de chrome en largeur et les 28 en hauteur (12 de cadre, 16 de
  // bandeau) tombent de ces quatre mesures, et le PLANCHER de 202 est celui du
  // bandeau-titre, que le contenu n'atteint jamais tout seul.
  function minSalon(p) {
    if (!p) return { w: 202, h: 156 };
    var bouilles = !!p.classList.contains('bouilles-ouvertes');
    var tiroir = p.querySelector('#users-drawer');
    var connectes = !!(tiroir && tiroir.classList.contains('open'));
    var barre = p.querySelector('#pen-bar');
    var feutres = !!(barre && barre.classList.contains('show'));
    var gauche = { w: bouilles ? 112 : 32, h: bouilles ? 228 : 104 };
    var milieu = { w: feutres ? 126 : 108, h: 128 + (feutres ? 48 : 0) };
    var droite = { w: connectes ? 128 : 0, h: connectes ? 100 : 0 };
    return {
      w: Math.max(202, 8 + gauche.w + milieu.w + droite.w),
      h: 28 + Math.max(milieu.h, gauche.h, droite.h),
    };
  }

  // `recal` après un changement d'arbre : la fenêtre grandit si elle est
  // passée sous le nouveau minimum, et ne bouge pas sinon.
  function appliquerMinimum(f) {
    if (!f || !f.fen) return;
    var cible = recal(posDe(f.fen), f.minimum);
    f.fen.style.width = Math.round(cible.w) + 'px';
    f.fen.style.height = Math.round(cible.h) + 'px';
    f.fen.style.left = Math.round(cible.x) + 'px';
    f.fen.style.top = Math.round(cible.y) + 'px';
  }

  // ── LA ZONE DES BOUILLES (`cp.ScreenList`, 0xb6088) ───────────────────────
  // Ce panneau a DEUX visages, et le bytecode dit lequel au pixel près :
  //
  //     size = width                              // un écran est CARRÉ
  //     max  = Math.floor(height / (size + ecart))   // ecart = 2 (prototype)
  //     win.box.userList.wantList(max, 'setUserList', this)
  //
  //     setUserList(list, userTotal):
  //       si max >= userTotal  →  removeCLBScreen(), attachMultiScreen(),
  //                               updateMultiScreen()
  //       sinon                →  removeMultiScreen(), attachCLBScreen(),
  //                               updateCLBScreen()
  //
  // • MULTI — tout le monde tient : UN écran par personne, empilé au pas de
  //   `size + 2` (`screen<i>._y = i × (size + ecart)`), chacun cliquable vers
  //   sa fiche (`openFrutizInfo`) et coiffé d'une infobulle.
  // • CLB — il y a plus de monde que d'écrans : un SEUL `frutiScreen`, monté
  //   avec `flCLB: true`, qui prend TOUTE la zone (`extWidth = width`,
  //   `extHeight = height`) et que `box.addUserActionListener(…, 'onCLBEvent')`
  //   branche sur les actions du salon. D'où la grande zone verticale — et ce
  //   n'est pas une bouille qui remplace l'autre, c'est un AQUARIUM.
  //   `cp.FrutiScreen.onCLBEvent` (0x62361) :
  //     – la bouille de qui s'exprime est attachée à l'échelle `minSide` =
  //       `min(width, height)`, posée hors champ à gauche (`_x = −width`) ;
  //     – on lui cherche une hauteur au HASARD dans `[0, height − minSide[`,
  //       en refusant celles qui tombent à moins de `minSide / 2` d'une
  //       voisine — vingt essais, puis tant pis (`checkContentCollide`) ;
  //     – elle glisse jusqu'à `x = 0` (`animList.addSlide`, 1,5) ;
  //     – si la personne est DÉJÀ là, rien de neuf : elle re-glisse et joue
  //       son émotion ;
  //     – au-delà de `maxContent` = **3**, la plus ancienne repart par la
  //       gauche (`launchIntoTheSpace`) et disparaît.
  //   QUIRK d'époque : la nouvelle venue est poussée dans la liste AVANT le
  //   tirage de sa hauteur, et son `_y` vaut alors 0 — le tirage se refuse
  //   donc lui-même le haut de la zone. On garde le biais.
  //
  // Le light rend les deux, et remplit les écrans d'IMAGES — le cache PNG
  // partagé du site (`FPBouilleThumb`, le même que le Bouilloscope et le
  // trombinoscope) — plutôt que d'un lecteur Flash par personne : un salon
  // plein ne coûte alors que des images déjà en cache. Le lecteur, il n'y en a
  // qu'UN, et il ne s'allume que le temps d'une émotion (cf. `ecranDe`).
  var ECRAN_ECART = 2;               // `ScreenList.prototype.ecart` (0xb68ee)
  var CLB_MAX = 3;                   // `FrutiScreen.maxContent` (0x61b61)

  // L'écran qui doit jouer l'émotion de quelqu'un : le sien en mode MULTI, et
  // en mode CLB la bouille qu'on fait entrer dans l'aquarium.
  function ecranDe(pseudo, panneau) {
    var p = panneau || $('#chat-panel');
    var col = p && p.querySelector('#bouille-overlay');
    if (!col || !p.classList.contains('bouilles-ouvertes')) return null;
    if (col.querySelector('.bo-ecran.clb')) return clbAccueille(pseudo, p);
    var ec = col.querySelector('.bo-ecran[data-qui="' + cleCss(String(pseudo).toLowerCase()) + '"]');
    // La même règle qu'en CLB : l'animation, elle, lit le cache et joue le BON
    // accessoire ; la vignette figée qui reparaît derrière elle doit dire la
    // même chose, sinon on voit le bon dessin quatre secondes puis l'ancien.
    var m = ec && membreDe(pseudo, p);
    if (m) poserBouille(ec, m.bouille, m.pseudo, m.humeur);
    return ec;
  }

  // `onCLBEvent` : quelqu'un s'exprime, sa bouille entre dans l'aquarium.
  function clbAccueille(pseudo, panneau) {
    var ec = (panneau || document).querySelector('#bouille-overlay .bo-ecran.clb');
    if (!ec) return null;
    var cle = String(pseudo).toLowerCase();
    var cote = Math.min(ec.clientWidth, ec.clientHeight);
    var b = ec.querySelector('.bo-clb[data-qui="' + cleCss(cle) + '"]');
    // ELLE REPARTAIT ? ELLE RESTE. `onCLBEvent` (0x62318) ne fait `addContent`
    // que si la personne n'est pas déjà dans `contentList` — et une bouille qui
    // s'en va y EST ENCORE : `removeCLBContent` ne l'en retire qu'au bout du
    // glissement. Elle reprend donc son `addSlide(1.5, …, "contentSlide" +
    // user)`, et comme le glissement porte son nom, le nouveau REMPLACE
    // l'ancien — callback de suppression compris. Le portage laissait au
    // contraire son minuteur courir : sept dixièmes plus tard la bouille
    // s'effaçait en pleine parole, EN EMPORTANT LE LECTEUR qu'on venait d'y
    // loger. C'est ce clignotement-là qu'on voyait « parfois ».
    if (b) revenirDeLEspace(b);
    if (!b) {
      b = document.createElement('div');
      b.className = 'bo-clb';
      b.setAttribute('data-qui', cle);
      b.style.width = cote + 'px';
      b.style.height = cote + 'px';
      b.style.left = (-ec.clientWidth) + 'px';   // hors champ, à gauche
      ec.appendChild(b);                         // AVANT le tirage : cf. le quirk
      b.style.top = Math.round(hauteurLibre(ec, cote)) + 'px';
    }
    // Le dessin se refait à CHAQUE passage, pas seulement à l'arrivée : la
    // vignette figée qui reparaît à la fin de l'émotion doit porter la bouille
    // du moment, et pas celle de la première prise de parole. (D'époque, la
    // règle vient de `frutiScreen.onStatusObj` — cf. `bouilleUnique`.)
    var m = membreDe(pseudo, panneau);
    poserBouille(b, m && m.bouille, pseudo, m && m.humeur);
    void b.offsetWidth;                          // que le départ soit enregistré
    b.style.left = '0px';
    // L'ORDRE DE DÉPART SE POSE SUR LA BOUILLE, PAS SUR LA FENÊTRE : c'est
    // `content.actionCallBack` (cf. `armerDepart`). On l'arme à chaque passage,
    // puisque reparler relance l'animation — donc le compte à rebours.
    armerDepart(b, ec);
    var tous = ec.querySelectorAll('.bo-clb:not(.part)');
    if (tous.length > CLB_MAX) partirDansLEspace(tous[0], ec);
    return b;
  }

  /*
   * `content.actionCallBack` — UN ORDRE DE DÉPART PAR BOUILLE.
   *
   * `cp.FrutiScreen.onAction` (0x62245) le pose sur le CONTENU, pas sur
   * l'écran :
   *
   *     content.action(o.id, o.length);
   *     if (this.flCLB) {
   *       content.actionCallBack = { obj: this, method: "launchIntoTheSpace",
   *                                  args: content };
   *     }
   *
   * et il se déclenche à la fin de SON animation, quoi qu'il arrive ailleurs.
   *
   * LE PORTAGE N'AVAIT QU'UN MINUTEUR PAR FENÊTRE (`overlayMinuteur`), parce
   * qu'il n'a qu'un lecteur par fenêtre. Chaque nouvelle émotion l'écrasait
   * (`clearTimeout`), et la bouille précédente ne comptait plus que sur la
   * boucle `.bo-anime` de `showBouilleOverlay` pour être renvoyée. Il suffisait
   * qu'elle rate ce rendez-vous — une émotion venue d'un salon dont la fenêtre
   * est fermée (le minuteur global remplace alors celui du cadre), la colonne
   * des bouilles refermée puis rouverte, les bouilles coupées dans les
   * préférences — pour qu'elle reste là POUR TOUJOURS : plus personne n'avait
   * de raison de la faire partir.
   *
   * Chaque bouille porte donc maintenant son propre compte à rebours. C'est la
   * règle d'époque, et elle rend le figeage impossible : ce qui entre dans
   * l'aquarium en ressort, sans dépendre de ce que fait la fenêtre.
   */
  var EMOTE_MS = 4200;               // = OVERLAY_HOLD_MS (light.html)
  function armerDepart(b, ec) {
    if (b.bfEmote) clearTimeout(b.bfEmote);
    b.bfEmote = setTimeout(function () {
      b.bfEmote = null;
      // L'écran a pu être remplacé entre-temps (bascule MULTI/CLB) : on part de
      // celui qui la porte AUJOURD'HUI.
      if (b.parentNode) partirDansLEspace(b, b.parentNode);
    }, EMOTE_MS);
  }

  // Une hauteur au hasard qui ne tombe pas à moins d'un demi-côté d'une
  // voisine — vingt essais, puis tant pis (`checkContentCollide`, 0x62693).
  function hauteurLibre(ec, cote) {
    var libre = Math.max(0, ec.clientHeight - cote);
    var pris = Array.prototype.map.call(ec.querySelectorAll('.bo-clb'), function (e) {
      return parseFloat(e.style.top) || 0;
    });
    for (var i = 0; i < 20; i++) {
      var y = Math.random() * libre, bon = true;
      for (var k = 0; k < pris.length; k++) if (Math.abs(pris[k] - y) < cote / 2) { bon = false; break; }
      if (bon) return y;
    }
    return Math.random() * libre;
  }

  // `launchIntoTheSpace` (0x62565) : la bouille repart par la gauche, jusqu'à
  // `pos.x = −minSide`, et `removeCLBContent` (0x625ee) la retire de la liste
  // et du plan au bout du glissement.
  function partirDansLEspace(b, ec) {
    if (b.classList.contains('part')) return;
    if (b.bfEmote) { clearTimeout(b.bfEmote); b.bfEmote = null; }   // elle s'en va
    b.classList.add('part');
    rendreScene(b);
    b.style.left = (-Math.min(ec.clientWidth, ec.clientHeight)) + 'px';
    b.bfDepart = setTimeout(function () {
      b.bfDepart = null;
      // Ceinture ET bretelles : le lecteur ne part JAMAIS avec l'écran qui le
      // loge, quoi qu'il se soit passé entre-temps.
      rendreScene(b);
      if (b.parentNode) b.remove();
    }, 700);
  }
  // Le glissement de départ est annulé : la bouille reprend sa place.
  function revenirDeLEspace(b) {
    if (b.bfDepart) { clearTimeout(b.bfDepart); b.bfDepart = null; }
    b.classList.remove('part');
  }

  /*
   * UNE BOUILLE NE RESTE PAS DANS L'AQUARIUM : ELLE Y PASSE.
   *
   * `cp.FrutiScreen.onAction` (0x62245) joue l'émotion, puis — en mode CLB, et
   * seulement là — pose sur la bouille son ordre de départ :
   *
   *     content.action(o.id, o.length);
   *     if (this.flCLB) {
   *       content.actionCallBack = { obj: this,
   *                                  method: "launchIntoTheSpace",
   *                                  args: content };
   *     }
   *
   * `actionCallBack` se déclenche à la FIN de l'animation : qui a fini de
   * parler s'en va. Le portage n'avait gardé que le débordement
   * (`maxContent` = 3, la plus ancienne chassée par la nouvelle), si bien que
   * les bouilles s'accumulaient, figées sur leur vignette, jusqu'au quatrième
   * arrivant.
   *
   * DEUX MOMENTS l'appellent, parce que le light n'a qu'UN lecteur par fenêtre
   * là où l'époque en avait un par bouille :
   *   · la fin du minuteur — l'animation est allée à son terme ;
   *   · l'arrivée d'une AUTRE émotion, qui prend le lecteur — celle d'avant
   *     est interrompue, donc finie elle aussi. C'est ce cas-là qui laissait
   *     « parfois » une bouille en plan.
   */
  function finirEmote(ecran) {
    if (!ecran || !ecran.classList.contains('bo-clb')) return;   // MULTI : on reste
    if (ecran.parentNode) partirDansLEspace(ecran, ecran.parentNode);
  }

  function bouilleDe(pseudo, panneau) {
    var g = membreDe(pseudo, panneau);
    return g ? g.bouille : null;
  }
  function membreDe(pseudo, panneau) {
    return dansListe(membresDuPanneau(panneau), String(pseudo).toLowerCase());
  }
  function dansListe(gens, cle) {
    for (var i = 0; i < gens.length; i++) {
      if (String(gens[i].pseudo).toLowerCase() === cle) return gens[i];
    }
    return null;
  }

  // On ne refait la vignette que si quelque chose a changé : sinon elle
  // clignoterait à chaque relevé des connectés.
  //
  // « Quelque chose », c'est la CHAÎNE (accessoire, couleurs, coupe) ET
  // L'HUMEUR — les deux voyagent avec chaque trace `<z>`, et la fenêtre montrait
  // jusqu'ici l'état figé au moment où l'on y était entré. Quand seule l'humeur
  // bouge, `rafraichir` suffit : l'arbre est déjà monté, on ne recharge rien.
  //
  // Le pseudo ne va PAS dans `title` : l'infobulle du navigateur ferait
  // doublon — et concurrence — avec celle du SWF, qu'on refait ici.
  function poserBouille(ecran, bouille, pseudo, humeur) {
    if (pseudo) ecran.setAttribute('data-nom', pseudo);
    if (!bouille) return;
    var em = String(Number(humeur) || 0);
    var memeEtat = ecran.getAttribute('data-bouille') === bouille;
    var memeHumeur = ecran.getAttribute('data-humeur') === em;
    if (memeEtat && memeHumeur) return;
    ecran.setAttribute('data-bouille', bouille);
    ecran.setAttribute('data-humeur', em);
    // ENFANTS DIRECTS SEULEMENT : pendant une émotion, l'écran héberge AUSSI la
    // scène du light (`#bouille-overlay-stage`), qui contient son propre canevas
    // animé. Une recherche en profondeur pourrait tomber dessus et l'arracher au
    // milieu de son animation.
    var toile = ecran.querySelector(':scope > canvas.fp-bvig');
    if (memeEtat && toile) { FPBouilleVignette.rafraichir(toile, bouille, Number(em)); return; }
    var vieux = ecran.querySelector(':scope > img, :scope > canvas.fp-bvig');
    // `oublier` avant de retirer : une bouille qui anime un accessoire tient
    // une boucle de rendu, et un canevas arraché du document la garderait
    // ouverte le temps d'une image de plus.
    if (vieux) { if (vieux.tagName === 'CANVAS') FPBouilleVignette.oublier(vieux); vieux.remove(); }
    // Le moteur JS dessine sur fond TRANSPARENT : c'est le dégradé de l'écran
    // qui se voit derrière la bouille. (Le cache PNG peignait la capture sur le
    // vert plat des cartes du forum, d'où le `detourer` qu'il fallait lui
    // demander — plus rien à détourer ici.)
    ecran.insertAdjacentHTML('afterbegin', FPBouilleVignette.html(bouille, { humeur: Number(em) }));
    FPBouilleVignette.brancher(ecran);
  }
  // `CSS.escape` n'est pas partout ; un pseudo n'a de toute façon que des
  // lettres, des chiffres, `_` et `-`, on s'en tient là.
  function cleCss(s) { return s.replace(/["\\\]]/g, ''); }

  // ── LA LISTE DES CONNECTÉS ────────────────────────────────────────────────
  // La bande d'une personne va d'un bord à l'autre de la boîte, liseré compris.
  // Or un `overflow` rogne à la zone de remplissage, DANS la bordure : la boîte
  // ne peut donc pas défiler elle-même sans couper les bandes de 10 px. On
  // glisse une enveloppe qui déborde de la bordure et qui, elle, défile. Le
  // light refait la liste à chaque relevé des connectés : on la ré-enveloppe
  // au même moment.
  function majListeConnectes(panneau) {
    if (!actif) return;
    // Sans panneau nommé : toutes les fenêtres de conversation ouvertes.
    if (!panneau) {
      for (var cle in fenetres) if (fenetres[cle].salon) majListeConnectes(fenetres[cle].panneau);
      return;
    }
    var l = panneau.querySelector('#users-list');
    if (!l) return;
    if (l.children.length === 1 && l.firstElementChild.className === 'ul-defile') return;
    var d = document.createElement('div');
    d.className = 'ul-defile';
    while (l.firstChild) d.appendChild(l.firstChild);
    l.appendChild(d);
  }

  // Sans panneau nommé : toutes les fenêtres de conversation ouvertes.
  function majBouilles(panneau) {
    // Un écran qui disparaît emporte sa bulle : `remove(id)` d'époque.
    if (tipCible && !document.documentElement.contains(tipCible)) tipCacher();
    if (!panneau) {
      for (var cle in fenetres) if (fenetres[cle].salon) majBouilles(fenetres[cle].panneau);
      return;
    }
    var col = panneau.querySelector('#bouille-overlay');
    if (!col || !panneau.classList.contains('bouilles-ouvertes')) return;
    var gens = membresDuPanneau(panneau);
    var cote = col.clientWidth || 100;
    var max = Math.floor((col.clientHeight || 0) / (cote + ECRAN_ECART));
    if (max >= gens.length) pileDeBouilles(col, gens);
    else bouilleUnique(col, gens);
  }

  // Les membres du salon d'une fenêtre — c'est le panneau qui dit lequel.
  function membresDuPanneau(panneau) {
    var S = window.SalonsBureau;
    var salon = panneau && panneau.getAttribute('data-salon');
    if (!S || !salon || !S.membresDe) return [];
    return S.membresDe(salon) || [];
  }

  // MULTI : un écran par personne, au pas de `size + ecart`.
  function pileDeBouilles(col, gens) {
    col.classList.remove('un-seul-ecran');
    var seul = col.querySelector('.bo-ecran.clb');
    if (seul) rendreScene(seul), seul.remove();
    var vus = {};
    gens.forEach(function (g) {
      var cle = String(g.pseudo).toLowerCase();
      vus[cle] = true;
      var ecran = col.querySelector('.bo-ecran[data-qui="' + cleCss(cle) + '"]');
      if (!ecran) {
        ecran = document.createElement('div');
        ecran.className = 'bo-ecran';
        ecran.setAttribute('data-qui', cle);
        col.appendChild(ecran);
      }
      poserBouille(ecran, g.bouille, g.pseudo, g.humeur);
    });
    // Qui a quitté le salon perd son écran — sauf s'il est en train de jouer
    // une émotion : la scène du light y est logée, on ne l'arrache pas.
    Array.prototype.slice.call(col.querySelectorAll('.bo-ecran')).forEach(function (e) {
      if (!vus[e.getAttribute('data-qui')] && !e.querySelector('#bouille-overlay-stage')) e.remove();
    });
  }

  // CLB : un seul écran, qui prend toute la zone. Les bouilles de qui
  // s'exprime y entrent par la gauche et s'y installent (cf. `clbAccueille`).
  //
  // LE REDESSIN, ET L'ÉCART ASSUMÉ AVEC L'ÉPOQUE. En MULTI, chaque écran est
  // INSCRIT auprès de son propriétaire — `attachFrutiScreen` (0xb646f) finit par
  // `win.box.userList.defineMc(user, screen)`, et `UserMng.User.setMc` (0x268d0)
  // le range dans un `mcList`. Quand le statut de la personne change,
  // `User.onStatusObj` (0x26a28) parcourt ce `mcList` et appelle
  // `mc.onInfoBasic(o)` ; `frutiScreen.onInfoBasic` (0x62226) renvoie sur
  // `onStatusObj` (0x620fe), qui, l'arbre déjà monté, fait
  // `last.apply(o.fbouille)` puis `last.applyEmote(o.status.emote)`. La bouille
  // se refait donc SUR PLACE, accessoire et humeur compris.
  //
  // L'aquarium, lui, n'est inscrit nulle part : `attachCLBScreen` (0xb6717) ne
  // pose qu'un `addUserActionListener(..., 'onCLBEvent')`, et `updateCLBScreen`
  // (0xb67f5) ne fait que retailler. D'époque, une bouille déjà dans l'aquarium
  // gardait donc l'accessoire qu'elle avait en y entrant — `onCLBEvent` (0x62318)
  // n'appelle `addContent` QUE si la personne n'y est pas encore. On ne garde
  // pas ce trou-là : la règle de l'époque (« un statut qui change refait la
  // bouille ») s'applique ici aussi, sans quoi la fenêtre étroite — celle qui
  // s'ouvre à la connexion, et qui bascule en CLB dès qu'on est deux — ne
  // montrerait jamais un accessoire mis en cours de route.
  function bouilleUnique(col, gens) {
    col.classList.add('un-seul-ecran');
    var seul = col.querySelector('.bo-ecran.clb');
    Array.prototype.slice.call(col.querySelectorAll('.bo-ecran')).forEach(function (e) {
      if (e !== seul) { rendreScene(e); e.remove(); }
    });
    if (!seul) {
      seul = document.createElement('div');
      seul.className = 'bo-ecran clb';
      col.appendChild(seul);
      return;
    }
    // La zone a pu changer de taille : les bouilles suivent son petit côté.
    var cote = Math.min(seul.clientWidth, seul.clientHeight);
    var liste = gens || [];
    Array.prototype.forEach.call(seul.querySelectorAll('.bo-clb'), function (b) {
      b.style.width = cote + 'px';
      b.style.height = cote + 'px';
      var y = parseFloat(b.style.top) || 0;
      b.style.top = Math.min(y, Math.max(0, seul.clientHeight - cote)) + 'px';
      // Et le DESSIN suit l'état courant : `poserBouille` ne refait rien si
      // rien n'a bougé.
      var m = dansListe(liste, b.getAttribute('data-qui'));
      if (m) poserBouille(b, m.bouille, m.pseudo, m.humeur);
    });
  }

  // La scène du light (le lecteur Flash) ne doit jamais partir avec l'écran
  // qui la loge : on la remet dans la colonne avant de retirer celui-ci.
  function rendreScene(ecran) {
    var scene = ecran.querySelector('#bouille-overlay-stage');
    ecran.classList.remove('bo-anime');   // sa vignette figée revient
    // La colonne de CETTE fenêtre-là : chaque cadre a sa scène et son lecteur.
    var col = ecran.closest ? ecran.closest('#bouille-overlay') : null;
    if (scene && col) { scene.classList.remove('joue'); col.appendChild(scene); }
  }

  // Un bouton par fenêtre de conversation : la colonne d'icônes appartient à
  // la fenêtre, pas au bureau.
  function warningSalon() {
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'chat-warning';
    b.className = 'icon-btn bare';
    b.disabled = true;
    b.title = 'L’appel au modérateur n’est pas ouvert sur le revival';
    return b;
  }

  function enTeteDossier(nom, bloc) {
    var t = document.createElement('button');
    t.type = 'button';
    t.className = 'sl-titre';
    t.innerHTML = '<span class="plaque"></span><span class="bout"></span><span class="nom"></span>';
    t.querySelector('.nom').textContent = nom;
    t.addEventListener('click', function () { bloc.classList.toggle('replie'); });
    return t;
  }

  function chargerContacts() {
    var liste = $('#side-list .sl-liste');
    if (!liste) return;
    var sid = (window.state && window.state.sid) || '';
    fetch('/api/light/contacts?sid=' + encodeURIComponent(sid))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // `element.open` survit à `buildList` : un dossier replié le reste
        // quand la liste se refait. On note donc l'état avant de tout jeter.
        var replies = {};
        Array.prototype.forEach.call(liste.querySelectorAll('.sl-dossier'), function (b) {
          if (b.classList.contains('replie')) replies[b.getAttribute('data-nom')] = true;
        });
        liste.textContent = '';
        if (!d || !d.ok) return;
        // Carnet vide : la bande reste BLANCHE, sans un mot. C'est ce que fait
        // le SWF — `buildList` ne parcourt rien et n'écrit rien.
        (d.dossiers || []).forEach(function (f) {
          var bloc = document.createElement('div');
          bloc.className = 'sl-dossier';
          bloc.setAttribute('data-nom', f.nom);
          if (replies[f.nom]) bloc.classList.add('replie');
          var contenu = document.createElement('div');
          contenu.className = 'sl-contenu';
          (f.contacts || []).forEach(function (c) { contenu.appendChild(ligneContact(c)); });
          bloc.appendChild(enTeteDossier(f.nom, bloc));
          bloc.appendChild(contenu);
          liste.appendChild(bloc);
        });
        (d.contacts || []).forEach(function (c) { liste.appendChild(ligneContact(c)); });
      })
      .catch(function () {});
  }


  // ── LA MESSAGERIE ────────────────────────────────────────────────────────
  //
  // D'époque ce ne sont pas trois vues d'une même fenêtre mais TROIS fenêtres :
  // la boîte de réception est un EXPLORATEUR (la fenêtre jaune, `winExplorer`),
  // lire un courrier ouvre `winViewMail` (500 × 400) et en écrire un ouvre
  // `winMail`. Le light n'a qu'un panneau `#mail-panel` à reparenter : on y
  // rejoue les trois GABARITS, l'un après l'autre.
  //
  // LA BOÎTE — `box.Explorer.init` monte le type de dossier :
  //
  //     flNewDirectory = false ; flRemoveAll = false ; flMail = true
  //     styleName      = "frFileStandard"                     (le jaune)
  //     lister         = [ {De|À, 140}, {Sujet, 200, big}, {Date, 80} ]
  //     currentSort    = { field: "date", sens: "DESC" }
  //
  // et `win.Explorer.displayList` passe le gabarit « mail » : chaque entrée
  // devient un `fileIconDetail` — l'icône, puis les trois colonnes.
  //
  // Relevé 1:1 (fenêtre en x 486..896 / y 146..546, soit 411 × 401) :
  //   · le bandeau des colonnes est une BOÎTE à lui — contour 2 px #DDDDDD,
  //     liseré 2 px #EAEA0F, chair #F9F977 sous le reflet, 18 px de haut ;
  //   · le champ dessous a la même écorce, chair #F8F866 ;
  //   · une rangée fait 22 px, la suivante s'en sépare d'un trait #EAEA0F ;
  //   · les colonnes se séparent de 2 px de #F1F13B, à 140 et à « largeur−80 » ;
  //   · l'encre du bandeau est #404000, celle des rangées #5A5A00.
  var MAIL_COLONNES = [
    { cle: 'qui', titre: 'Expéditeur', titreEnvoi: 'Destinataire', tri: 'from', l: 140 },
    { cle: 'subject', titre: 'Sujet', tri: 'name', big: true },
    { cle: 'date', titre: 'Date', tri: 'date', l: 80 },
  ];
  var mailTri = { champ: 'date', desc: true };   // `currentSort` en mode mail
  var mailHabille = false;

  function navBouton(image, titre, faire) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ex-nav-but mx-nav-but';
    b.title = titre;
    b.textContent = titre;
    b.style.backgroundImage = "url('/frutiz/sprites/" + image + ".svg')";
    b.addEventListener('click', faire);
    return b;
  }

  /*
   * Les deux gabarits de citation, au mot près (lang_french.as) :
   *
   *   mail.reply_tpl   = '<br><br><b>--- En réponse au message ---</b><br>…'
   *   mail.forward_tpl = '<br><br><b>--- Message transféré ---</b><br>…'
   *
   * suivis de « Date : $d », « De : $f », « A : $t », « Sujet : $s », une
   * ligne vide, puis « $c ». Le courrier du portage est du texte simple d'un
   * bout à l'autre : les `<br>` deviennent des retours à la ligne et le gras
   * tombe, le reste ne bouge pas.
   *
   * `mail.reply_subject` = « Re: $s », `mail.forward_subject` = « Tr: $s » —
   * avec les deux-points COLLÉS, comme dans le SWF.
   */
  function citerMail(quoi, ev) {
    var M = window.MessagerieLight;
    var m = M && M.lu && M.lu();
    if (!m) return;
    if (ev) { ev.preventDefault(); ev.stopImmediatePropagation(); }
    var s = String(m.subject || '');
    var prefixe = quoi === 'reply' ? 'Re: ' : 'Tr: ';
    var deja = quoi === 'reply' ? /^re\s*:/i : /^tr\s*:/i;
    var entete = quoi === 'reply' ? '--- En réponse au message ---' : '--- Message transféré ---';
    // `$d` vaut `Lang.formatDateString(date, "long")` dans les deux gabarits
    // (0xaec2b et 0xaed9b) : la date en toutes lettres, pas l'horodatage brut.
    var corps = '\n\n' + entete + '\n'
      + 'Date : ' + mailDateLongue(m.date) + '\n'
      + 'De : ' + (m.from || '') + '\n'
      + 'A : ' + (m.to || '') + '\n'
      + 'Sujet : ' + s + '\n\n'
      + (m.body || m.text || '');
    // `reply` répond à l'expéditeur ; `forward` laisse le destinataire à
    // choisir — le SWF ouvre la fenêtre d'écriture avec le champ vide.
    M.ecrire(quoi === 'reply' ? (m.from || '') : '',
      deja.test(s) ? s : prefixe + (s || '(sans sujet)'), corps);
  }

  function habillerMail(panneau) {
    if (mailHabille || !panneau) return;
    mailHabille = true;
    // LA BARRE D'OUTILS (`initNavigatorIconList`) : pour une boîte aux lettres
    // `flNewDirectory` et `flRemoveAll` sont faux, `flUp` et `flMail` vrais —
    // deux boutons, la flèche du dossier parent et l'enveloppe.
    var nav = document.createElement('div');
    nav.className = 'mx-nav';
    nav.appendChild(navBouton('nav_up', 'Dossier parent', function () {
      panneau.classList.toggle('mx-dossiers');
    }));
    nav.appendChild(navBouton('nav_new_mail', 'Écrire un courrier', function () {
      if (window.MessagerieLight) MessagerieLight.ecrire('', '');
    }));
    panneau.insertBefore(nav, panneau.firstChild);

    // LE DOSSIER PARENT (`fileMng.messages`) : ses boîtes, en icônes, comme
    // n'importe quel dossier de l'explorateur.
    var dossiers = document.createElement('div');
    dossiers.className = 'mx-champ mx-dossiers-champ';
    [['inbox', 'Boîte de réception'], ['outbox', 'Messages envoyés'],
      ['blackbox', 'Indésirables']].forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ex-slot mx-slot';
      b.innerHTML = '<img alt=""><span></span>';
      b.querySelector('img').src = '/frutiz/sprites/ico_dossier_' + d[0] + '.svg';
      b.querySelector('span').textContent = d[1];
      b.addEventListener('click', function () {
        panneau.classList.remove('mx-dossiers');
        if (window.MessagerieLight) MessagerieLight.charger(d[0]);
      });
      dossiers.appendChild(b);
    });
    panneau.insertBefore(dossiers, $('#mail-vue-liste'));

    // LE BANDEAU DES COLONNES, sa propre boîte au-dessus du champ.
    var entete = document.createElement('div');
    entete.className = 'mx-entete';
    MAIL_COLONNES.forEach(function (c) {
      var t = document.createElement('button');
      t.type = 'button';
      t.className = 'mx-col' + (c.big ? ' big' : '');
      t.setAttribute('data-col', c.cle);
      if (!c.big) t.style.width = c.l + 'px';
      t.innerHTML = '<span class="t"></span><i class="fl"></i>';
      t.addEventListener('click', function () {
        // Un second clic sur la même colonne retourne le sens.
        if (mailTri.champ === c.tri) mailTri.desc = !mailTri.desc;
        else { mailTri.champ = c.tri; mailTri.desc = (c.tri === 'date'); }
        majMessagerie(mailDerniere, mailDossierVu);
      });
      entete.appendChild(t);
    });
    var vue = $('#mail-vue-liste');
    if (vue) vue.insertBefore(entete, vue.firstChild);

    /*
     * LA BARRE DU BAS DE LA LECTURE. `win.ViewMail.attachEndButton` (0xc8e72)
     * la compose en XML, et il n'y a rien à interpréter :
     *
     *   <b t="{mail.move_to_recyclebin}" l="butPushStandard" m="moveToRecycleBin"/>
     *   <s b="1"/>                                     ← un espace ÉLASTIQUE
     *   <b t="{mail.reply}"   l="butPushStandard" m="reply"/>
     *   <s w="8"/>
     *   <b t="{mail.forward}" l="butPushStandard" m="forward"/>
     *
     * Les trois libellés sortent de lang_french.as, et deux d'entre eux
     * n'étaient pas ceux qu'on affichait : `mail.move_to_recyclebin` vaut
     * « Supprimer » (et non « Mettre à la corbeille »), `mail.forward` vaut
     * « Transférer » (et non « Faire suivre »). Le troisième bouton manquait
     * tout court.
     *
     * Le « Retour » du light n'existait pas d'époque — les trois fenêtres se
     * fermaient — mais il n'a nulle part où aller ici : il passe en tête.
     */
    var pou = $('#mail-supprimer');
    if (pou) pou.textContent = 'Supprimer';
    // Les chevrons du gabarit tactile n'ont pas d'équivalent d'époque : un
    // `butPushStandard` ne porte que son mot.
    var ret = $('#mail-retour');
    if (ret) ret.textContent = 'Retour';
    var ann = $('#mail-annuler');
    if (ann) ann.textContent = 'Annuler';
    var env = $('#mail-envoyer');
    if (env) env.textContent = 'Envoyer';

    // RÉPONDRE ET TRANSFÉRER CITENT LE MESSAGE. `mail.reply_tpl` et
    // `mail.forward_tpl` (lang_french.as) sont deux gabarits à quatre
    // substitutions — $d la date, $f l'expéditeur, $t le destinataire,
    // $s le sujet, $c le corps — que le SWF pose dans le nouveau message.
    // Le light répondait sur une page blanche.
    var rep = $('#mail-repondre');
    if (rep && !rep.dataset.epoque) {
      rep.dataset.epoque = '1';
      rep.addEventListener('click', citerMail.bind(null, 'reply'), true);
    }
    if (rep && !$('#mail-transferer')) {
      var tr = document.createElement('button');
      tr.type = 'button';
      tr.className = 'ma-btn';
      tr.id = 'mail-transferer';
      tr.textContent = 'Transférer';
      tr.addEventListener('click', citerMail.bind(null, 'forward'));
      rep.parentNode.insertBefore(tr, rep.nextSibling);
    }

    // L'EN-TÊTE DE LECTURE (`win.ViewMail.attachInfo`) : quatre lignes de 20,
    // étiquette de 60 alignée à DROITE — Date, De, À, Sujet. Le light n'en
    // affiche que trois valeurs ; on monte le gabarit complet et on le
    // remplit à l'ouverture.
    var lect = $('#mail-vue-lecture');
    if (lect) {
      var info = document.createElement('div');
      info.className = 'mx-info';
      // Les étiquettes portent leurs DEUX-POINTS, et le « A » n'a pas
      // d'accent : `mail.date` = « Date : », `mail.from` = « De : »,
      // `mail.to` = « A : », `mail.subject` = « Sujet : » (lang_french.as).
      [['date', 'Date :'], ['from', 'De :'], ['to', 'A :'], ['subject', 'Sujet :']].forEach(function (l) {
        var ligne = document.createElement('div');
        ligne.className = 'mx-ligne';
        ligne.innerHTML = '<span class="mx-lab"></span><span class="mx-val" data-champ="'
          + l[0] + '"></span>';
        ligne.querySelector('.mx-lab').textContent = l[1];
        info.appendChild(ligne);
      });
      lect.insertBefore(info, lect.firstChild);
    }

    // L'EN-TÊTE DE RÉDACTION (`win.Mail.attachInfo`) : trois lignes de 20,
    // étiquette de 60 — De (en clair, sur fond), À, Sujet. Le light a déjà les
    // deux champs ; il lui manque la ligne « De », que `preInit` remplit avec
    // « pseudo <pseudo@frutiparc.com> ».
    var form = $('#mail-vue-ecriture .mail-form');
    if (form && !form.querySelector('.mx-de')) {
      var de = document.createElement('div');
      de.className = 'mx-de';
      de.innerHTML = '<span class="mx-lab">De :</span><span class="mx-val"></span>';
      var moi = (window.state && window.state.user) || '';
      de.querySelector('.mx-val').textContent = moi + ' <' + moi + '@frutiparc.com>';
      form.insertBefore(de, form.firstChild);
    }
    // Les deux étiquettes du light prennent elles aussi les mots du SWF. On
    // les réécrit ICI, et pas dans light.html : le gabarit tactile garde les
    // siens (« À », « Sujet »), qui vont mieux à une colonne de champs.
    var lblA = $('#mail-vue-ecriture .mail-form label[for="mail-a"]');
    if (lblA) lblA.textContent = 'A :';
    var lblS = $('#mail-vue-ecriture .mail-form label[for="mail-sujet"]');
    if (lblS) lblS.textContent = 'Sujet :';

    /*
     * LA BARRE DE STYLE (`win.Mail.attachEditTool`, 0x78048).
     *
     * Un `cpDocument` de 28 px, style `frSystem`, dont le `lineList` tient —
     * après le retournement d'InitArray (0x781a5) — dans cet ordre :
     *
     *   {type:'link', link:'butFlag', width:20,
     *    param:{variable:'flBold',      link:'butFlagSmallPink', frame:2}}
     *   … idem flItalic (image 3) et flUnderline (image 4)
     *   {type:'spacer', big:1}
     *   {type:'comboBox', width:100, dy:4,
     *    param:{variable:'textSize', def:'normal', text:Lang.fv('mail.font_size')}}
     *
     * `win.Mail.endInit` (0x77d4d) les branche sur un `AdvancedTextInput` :
     *   {field: mainDoc.console.content, docPanel: panelToolDoc,
     *    btBold:'flBold', btItalic:'flItalic', btUnderline:'flUnderline',
     *    cbColor:'', cbSize:'textSize'}
     * et le champ du corps porte `fieldProperty.html = true` — d'époque le
     * message EST du HTML, que `box.Mail.sendMail` fait passer par
     * `FEString.simplifyHTML` avant de l'envoyer.
     *
     * ÉCART ASSUMÉ : le courrier du portage est du texte simple d'un bout à
     * l'autre (le lecteur écrit `textContent`, et ce lecteur est PARTAGÉ avec
     * le gabarit tactile, qui ne doit pas bouger). Les trois drapeaux et le
     * menu des corps agissent donc sur TOUT le champ, à l'écran seulement :
     * la mise en forme ne survit pas à l'envoi. La rendre réelle demande
     * d'ouvrir le corps à une liste blanche d'époque (`<b> <i> <u> <br>
     * <font size>`) des DEUX côtés — c'est un changement à part.
     */
    var form2 = $('#mail-vue-ecriture .mail-form');
    if (form2 && !form2.querySelector('.mx-outils')) {
      var outils = document.createElement('div');
      outils.className = 'mx-outils';
      MAIL_DRAPEAUX.forEach(function (f) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'mx-flag mx-flag-' + f[0];
        b.title = f[2];
        b.textContent = f[2];
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () {
          var on = b.getAttribute('aria-pressed') !== 'true';
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          var champ = $('#mail-texte');
          if (champ) champ.classList.toggle('mx-' + f[1], on);
        });
        outils.appendChild(b);
      });
      var esp = document.createElement('span');
      esp.className = 'mx-outils-esp';
      outils.appendChild(esp);
      var taille = document.createElement('select');
      taille.className = 'mx-taille';
      taille.id = 'mail-taille';
      taille.title = 'Taille du texte';
      MAIL_CORPS.forEach(function (t) {
        var o = document.createElement('option');
        o.value = String(t[1]);
        o.textContent = t[0];
        taille.appendChild(o);
      });
      taille.value = '12';                 // « Normal », le `def` du comboBox
      taille.addEventListener('change', function () {
        var champ = $('#mail-texte');
        if (champ) champ.style.fontSize = taille.value + 'px';
      });
      outils.appendChild(taille);
      form2.insertBefore(outils, $('#mail-texte'));
    }

    // LA CASE « garder une copie » (`attachEndButton`, 0x784b0) :
    // `{type:'checkBox', width:210, param:{variable:'savetooutbox',
    // text: Lang.fv('mail.add_in_outbox')}}`, cochée par défaut — c'est ce
    // que `box.Mail.sendMail` relaie au serveur dans `o` (0x8a9d6).
    var barre = $('#mail-vue-ecriture .mail-actions');
    if (barre && !barre.querySelector('.mx-copie')) {
      var lab = document.createElement('label');
      lab.className = 'mx-copie';
      lab.innerHTML = '<input type="checkbox" id="mail-copie" checked><span></span>';
      lab.querySelector('span').textContent = MAIL_COPIE;
      barre.insertBefore(lab, barre.firstChild);
    }
  }

  // `mail.font_size` (lang_french.as) : les sept mots du `comboBox`, du plus
  // gros au plus petit. Les corps ne se devinent pas — `AdvancedTextInput`
  // les porte en clair (0x7970d) : `cbSizeEqui = [6, 8, 10, 12, 14, 16, 18]`,
  // que l'InitArray retourne en [18, 16, 14, 12, 10, 8, 6]. Le quatrième,
  // « Normal », vaut donc 12 — la taille de départ du champ
  // (`tFormat.size = 12`, 0x796cc), et son encre est 3364113 = #335511.
  var MAIL_CORPS = [['Trop gros', 18], ['Très gros', 16], ['Gros', 14],
    ['Normal', 12], ['Petit', 10], ['Très petit', 8], ['Illisible', 6]];
  var MAIL_DRAPEAUX = [['gras', 'g', 'Gras'], ['italique', 'i', 'Italique'],
    ['souligne', 's', 'Souligné']];
  var MAIL_COPIE = 'Ajouter dans "Messages envoyés"';

  var mailDerniere = [], mailDossierVu = 'inbox';

  /**
   * La LISTE, au gabarit « mail » de l'explorateur.
   *
   * `box.Explorer` trie côté client (`currentSort`), et le SWF ne recharge
   * rien pour cela : on fait de même sur la liste que le light vient de
   * recevoir.
   */
  function majMessagerie(liste, dossier) {
    var panneau = $('#mail-panel');
    if (!panneau || !actif) return;
    habillerMail(panneau);
    mailDerniere = liste || [];
    mailDossierVu = dossier || 'inbox';
    var envoi = (mailDossierVu === 'outbox');
    // `lister` change de première colonne selon la boîte : « Expéditeur » à
    // l'arrivée, « Destinataire » au départ.
    Array.prototype.forEach.call(panneau.querySelectorAll('.mx-col'), function (t, i) {
      var c = MAIL_COLONNES[i];
      t.querySelector('.t').textContent = (envoi && c.titreEnvoi) ? c.titreEnvoi : c.titre;
      t.classList.toggle('trie', mailTri.champ === c.tri);
      t.classList.toggle('desc', mailTri.desc);
    });
    var champ = $('#mail-liste');
    if (!champ) return;
    var rangs = mailDerniere.slice();
    var sens = mailTri.desc ? -1 : 1;
    rangs.sort(function (a, b) {
      var va, vb;
      if (mailTri.champ === 'date') { va = a.date || ''; vb = b.date || ''; }
      else if (mailTri.champ === 'name') { va = (a.subject || '').toLowerCase(); vb = (b.subject || '').toLowerCase(); }
      else { va = ((envoi ? a.to : a.from) || '').toLowerCase(); vb = ((envoi ? b.to : b.from) || '').toLowerCase(); }
      return va < vb ? -sens : va > vb ? sens : 0;
    });
    champ.textContent = '';
    rangs.forEach(function (m) {
      var r = document.createElement('button');
      r.type = 'button';
      r.className = 'mx-rang' + (!m.read && !envoi ? ' neuf' : '');
      var ico = document.createElement('i');
      ico.className = 'mx-ico';
      r.appendChild(ico);
      [envoi ? (m.to || '?') : (m.from || '?'), m.subject || '(sans sujet)',
        mailDateCourte(m.date)].forEach(function (txt, i) {
        var c = document.createElement('span');
        c.className = 'mx-cell' + (MAIL_COLONNES[i].big ? ' big' : '');
        if (!MAIL_COLONNES[i].big) c.style.width = MAIL_COLONNES[i].l + 'px';
        c.textContent = txt;
        r.appendChild(c);
      });
      r.addEventListener('click', function () {
        if (window.MessagerieLight) MessagerieLight.ouvrir(m.uid);
      });
      champ.appendChild(r);
    });
  }

  /**
   * `win.ViewMail.setMail` : les quatre champs de l'en-tête, dans l'ordre.
   *
   * `box.ViewMail.init` compose les deux adresses avec
   * `FPString.toDisplayMail` — « pseudo <pseudo@frutiparc.com> ». On garde la
   * forme, elle dit d'un coup d'œil de qui vient le courrier et où il est allé.
   */
  function majLectureMail(m) {
    var panneau = $('#mail-panel');
    if (!panneau || !actif || !m) return;
    var moi = (window.state && window.state.user) || '';
    var adr = function (p) { return p ? (p + ' <' + p + '@frutiparc.com>') : ''; };
    var val = {
      // `win.ViewMail.setMail` (0xaeb22) demande le format « long », pas le
      // « numeric » de la liste : `Lang.formatDateString(date, "long")`.
      date: mailDateLongue(m.date),
      from: adr(m.from || (m.folder === 'outbox' ? moi : '')),
      to: adr(m.to || (m.folder === 'outbox' ? '' : moi)),
      subject: m.subject || '(sans sujet)',
    };
    Array.prototype.forEach.call(panneau.querySelectorAll('.mx-val[data-champ]'), function (e) {
      e.textContent = val[e.getAttribute('data-champ')] || '';
    });
    // D'ÉPOQUE C'EST UNE FENÊTRE PAR MESSAGE : `win.ViewMail` porte le SUJET
    // en bandeau, pas le nom de la boîte. Le portage n'a qu'un panneau, mais
    // il peut au moins se retitrer — c'est ce que le bandeau annonce.
    retitrer('mail-panel', val.subject);
  }

  /*
   * Le bandeau suit la VUE, comme les trois fenêtres d'époque suivaient leur
   * classe : `win.Explorer` pour la boîte (titre = le dossier), `win.ViewMail`
   * pour la lecture (titre = le sujet), `win.Mail` pour l'écriture
   * (`mail.write_new_mail` = « Composer un nouveau message »).
   */
  var MAIL_DOSSIERS = {
    inbox: 'Boîte de réception', outbox: 'Messages envoyés', blackbox: 'Indésirables',
  };
  function retitrerMail(vue) {
    if (!actif) return;
    // Trois fenêtres d'époque dans un seul panneau : la classe dit LAQUELLE
    // on regarde, et la feuille de style rend à chacune ses couleurs (la
    // liste est un explorateur JAUNE, lire et écrire sont VERTES).
    var panneau = $('#mail-panel');
    if (panneau) {
      panneau.classList.toggle('mx-lit', vue === 'lecture');
      panneau.classList.toggle('mx-ecrit', vue === 'ecriture');
    }
    if (vue === 'ecriture') retitrer('mail-panel', 'Composer un nouveau message');
    else if (vue === 'liste') retitrer('mail-panel', MAIL_DOSSIERS[mailDossierVu] || 'Courrier');
  }

  // `but.icon.Detail.display` (0x524c7) : `dateDsp = Lang.formatDateString(
  // date, "numeric")`, et `date.format_numeric` vaut « $D/$N $H:$I »
  // (lang_french.as) — le quantième, le mois et l'heure. PAS D'ANNÉE : la
  // colonne d'époque n'en montre pas.
  function mailDateCourte(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? m[3] + '/' + m[2] + ' ' + m[4] + ':' + m[5] : String(s || '');
  }

  // `date.format_long` = « $a $d $m $H:$I » : le jour de la semaine en toutes
  // lettres, le quantième SANS zéro, le mois en toutes lettres, puis l'heure
  // et les minutes AVEC zéro — « jeudi 27 aout 20:17 ». Les douze mois et les
  // sept jours sortent de `lang_french.as`, « aout » compris, sans accent
  // circonflexe comme d'époque.
  var MAIL_JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi',
    'samedi', 'dimanche'];
  var MAIL_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'décembre'];
  function mailDateLongue(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return String(s || '');
    // `$b` va de 1 (lundi) à 7 (dimanche) : le dimanche de `getDay()` vaut 0.
    var jour = MAIL_JOURS[(new Date(+m[1], +m[2] - 1, +m[3]).getDay() + 6) % 7];
    return jour + ' ' + Number(m[3]) + ' ' + MAIL_MOIS[+m[2] - 1]
      + ' ' + m[4] + ':' + m[5];
  }


  // ── LA BOUTIQUE (`win.Shop`, `box.Shop`) ─────────────────────────────────
  //
  // `initFrameSet` monte la fenêtre en DEUX colonnes :
  //
  //   margin.left (140)  · `bar` : le compteur de kikooz (`cpCounter`, style
  //                        `frKikooz`, Verdana 14 GRAS en brun sombre, avec la
  //                        pièce `iconCounter`) et, calé à DROITE, deux
  //                        `butPushSmallWhite` — le journal des kikooz
  //                        (`uniqWinMng.open("kikoozLog")`) et « en obtenir »
  //                        (`box.obtainKikooz`) ;
  //                      · `menuFrame` : un `cpTree` de 140 de large, dont les
  //                        puces sont `shopBullet` — dossier fermé, dossier
  //                        ouvert.
  //   main               · `showFrame` → `menuInfoFrame`, un `cpDocument` au
  //                        style `frSheet` (le VERT) : la fiche de l'article ;
  //                      · `bar` → `pushKikooz`, la grande plaque orange
  //                        « OBTENIR DES KIKOOZ » (`butPushMoreKikooz`),
  //                        min 100 × 60, calée à droite.
  //
  // Relevé 1:1 (scratchpad/sr-1-boutique.png — fenêtre en x 8..483 / y 104..507,
  // soit 476 × 404) :
  //   · le compteur est une pilule de 26 px — contour 2 px #DDDDDD, liseré
  //     2 px #F3BE8C, chair #F8D5BC, encre #764A34 ;
  //   · la colonne de gauche fait 140, son arbre est une boîte blanche ;
  //   · la fiche a l'écorce verte : contour #DDDDDD, liseré #ADE76B, chair
  //     #CCF599 sous un reflet blanc, encre #5A7D33 ;
  //   · le gros bouton se pose sous la fiche, à droite.
  var boutiqueHabillee = false;

  function habillerBoutique(feuille) {
    if (boutiqueHabillee || !feuille) return;
    boutiqueHabillee = true;
    var haut = feuille.querySelector('#bo-haut');
    if (!haut) return;
    // LES DEUX PETITS BOUTONS BLANCS (`iconList`) : `butPushSmallWhite` porte
    // la plaque, et la bande d'icônes donne l'image — 20 le journal, 21 la
    // main qui en donne.
    var barre = document.createElement('div');
    barre.className = 'bq-icones';
    // Le premier bouton ouvre l'HISTORIQUE KIKOOZ — `box.KikoozLog` (0x8b46e),
    // `uniqWinMng.open("kikoozLog")`, titre `kikooz_log.title`. Il renvoyait
    // vers le Club, faute de fenêtre ; c'en est une maintenant, la même que
    // les deux autres journaux.
    // On passe par `activateTab`, PAS par `ouvrirFenetre` : c'est lui qui
    // déclenche le chargement du journal (`loadJournal`) avant de nous rendre
    // la main par `apresActivateTab`. Ouvrir la fenêtre directement montrerait
    // le panneau du journal précédent, ou un panneau vide.
    [['shop-ico-journal', 'Historique Kikooz', function () {
      if (window.activateTab) window.activateTab('kikoozlog');
      else ouvrirFenetre('kikoozlog');
    }], ['shop-ico-kikooz', 'Obtenir des kikooz', function () {
      window.open('/kikooz', '_blank');
    }]].forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bq-ico';
      b.title = d[1];
      b.textContent = d[1];
      b.innerHTML = '<i style="background-image:url(\'/frutiz/sprites/' + d[0] + '.svg\')"></i>';
      b.addEventListener('click', d[2]);
      barre.appendChild(b);
    });
    haut.appendChild(barre);

    // LA GRANDE PLAQUE, sous la fiche et à droite (`main.bar.pushKikooz`).
    var pied = document.createElement('div');
    pied.className = 'bq-pied';
    var gros = document.createElement('button');
    gros.type = 'button';
    gros.className = 'bq-plus';
    gros.title = 'Obtenir des kikooz';
    gros.textContent = 'Obtenir des kikooz';
    gros.addEventListener('click', function () { window.open('/kikooz', '_blank'); });
    pied.appendChild(gros);
    var corps = feuille.querySelector('#bo-corps');
    if (corps) corps.appendChild(pied);
  }

  /** La boutique s'ouvre en FENÊTRE sur le bureau, pas en feuille. */
  function ouvrirBoutique() {
    ouvrirFenetre('boutique');
    if (window.MagasinLight && MagasinLight.charger) MagasinLight.charger();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LE FORUM — LA SEULE RUBRIQUE QUI SORT DU BUREAU

     `win.Forum` (0x6e136) n'est pas une fenêtre du bureau : c'est un renvoi
     vers l'EXTÉRIEUR. Son `init` n'attache aucun contenu, il appelle le pont
     JavaScript de la page qui portait le lecteur Flash —

         getURL("javascript:fp_goURLResize('/fb/?sid=" + sid + "',1)")

     — puis pose sur le bureau un simple `ForumSlot` (le témoin qui dit « le
     forum est ouvert, là-bas »). L'ouverture réelle se fait à l'activation :

         onActivate:   cwm == "1" ? fp_resizeMe(1) : fp_activatePopupForum()
                       me.status.setInternal("forum")   // le voyant « lit le forum »
                       wallPaper.hide()
         onDeactivate: cwm == "1" ? fp_resizeMe(0) : (rien — la popup reste)
                       me.status.unsetInternal("forum")
         close:        fp_closeFrame(1) / fp_closePopupForum()

     Deux modes, donc : un CADRE dans la page (`cwm`, le mode « une seule
     fenêtre »), ou une VRAIE FENÊTRE de navigateur. Le revival garde la
     seconde — c'est ce que la page du lecteur Flash fait déjà (`ruffle.html`,
     `fp_activatePopupForum`), et le forum a besoin de sa largeur.

     Le voyant « lit le forum » ne demande rien ici : c'est le serveur qui le
     pose en voyant passer `/fb/?sid=…` (server.js, route du forum) — la même
     chose qu'il faisait pour le cadre du light. */
  var popupForum = null;
  // Le même nom et le même gabarit que le chemin Flash (`ruffle.html`,
  // `openForumPopup`) : les deux bureaux ouvrent LA MÊME fenêtre, et passer
  // de l'un à l'autre ne laisse pas deux forums ouverts côte à côte.
  var FORUM_FENETRE = 'width=860,height=640,resizable=yes,scrollbars=yes,'
    + 'menubar=no,toolbar=no,location=no,status=no';

  function ouvrirForum(sujet) {
    // PAS de « &from=light » : ce paramètre est celui du CADRE mobile — il
    // pose un lien « ‹ Salons » et fait revenir `closeForum()` sur /light.
    // Une fenêtre ouverte par script se ferme, elle, avec `window.close()`.
    var sid = jetonSid();
    var q = [];
    if (sid) q.push('sid=' + encodeURIComponent(sid));
    // Une citation reçue en notification mène AU SUJET, pas à l'accueil.
    if (sujet) q.push('sujet=' + encodeURIComponent(sujet));
    var url = '/fb/' + (q.length ? '?' + q.join('&') : '');
    if (popupForum && !popupForum.closed) {
      // `fp_activatePopupForum` ne rouvre pas : il RAMÈNE au premier plan.
      // Un sujet demandé y mène quand même — la fenêtre est du même domaine.
      try {
        if (sujet) popupForum.location.href = url;
        popupForum.focus();
        return true;
      } catch (e) { /* refusé : on rouvre */ }
    }
    popupForum = window.open(url, 'frutiparc_forum', FORUM_FENETRE);
    // Un bloqueur de fenêtres rend `null` : plutôt que de ne rien faire, on
    // ouvre dans un onglet — le forum reste atteignable.
    if (!popupForum) window.open(url, '_blank');
    else try { popupForum.focus(); } catch (e) {}
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     « MES PRÉFÉRENCES » (`win.Pref` sprite#831, `box.Pref` 0xc9a6e)

     `box.Pref.init` demande `do/prefForm` en XML, `analysePrefForm` en fait un
     arbre de rubriques et de préférences, et `win.Pref.initFrameSet` (0x9146b)
     monte les trois cadres décrits dans la feuille de style : l'arbre blanc de
     140 à gauche, le document VERT (`frSheet`) à droite, et la barre du bas
     avec deux gélules roses.

     Le cycle d'édition vient du bytecode, et il n'est pas celui d'un panneau
     de réglages moderne :

       · `displayPref(pref)` remplit le document avec le formulaire de la
         préférence choisie ; `updateFromForm` (0xca16a) recopie le widget dans
         la COPIE de travail (`prefDetails[i].value`) ;
       · `useDefault` (0xca17f) remet TOUTES les préférences de la copie à leur
         `defVal` — sans rien enregistrer ;
       · `save` (0xca24e) fait `updateFromForm`, `userPref.setFromCopy`,
         `userPref.save()`… puis `close()`. La fenêtre se FERME en
         enregistrant.

     Rien n'est écrit avant « Enregistrer » : c'est un brouillon, et on le
     reproduit tel quel.

     Le serveur sert le MÊME formulaire aux deux clients — `/do/prefForm` pour
     le SWF, `/api/light/prefs` pour ici, tous deux bâtis sur `prefDefs`,
     `PREF_LABELS` et `PREF_CATEGORIES`. L'écriture passe par entrée, comme
     `prefsavepartial` : `/do/prefsave` écraserait la chaîne entière. */

  var prefHabillee = false;
  var prefEtat = null;     // { categories, valeurs, defauts, brouillon, choix }

  // Les rubriques que le serveur ne connaît pas : elles ne touchent pas au
  // compte mais au navigateur qui l'affiche (voir l'ÉCART ASSUMÉ en CSS).
  // Chaque entrée montre une des cartes déjà présentes dans `#reg-corps`.
  var PF_LOCALES = {
    name: 'Cet appareil',
    prefs: [
      { local: 0, label: 'Notifications' },
      { local: 1, label: "L'appli" },
      { local: 2, label: 'Rien ne sonne ?' },
    ],
  };

  function habillerReglages(panneau) {
    if (!panneau) return;
    // L'écorce ne se monte qu'une fois ; les VALEURS, elles, se relisent à
    // chaque ouverture — `box.Pref.init` redemande `do/prefForm` à chaque
    // fois, et une fenêtre rouverte ne doit pas rouvrir sur un vieux
    // brouillon.
    if (prefHabillee) { chargerPrefs(panneau); return; }
    prefHabillee = true;
    var boite = panneau.querySelector('.fenetre') || panneau;

    var fen = document.createElement('div');
    fen.className = 'pf-fen';
    var arbre = document.createElement('div');
    arbre.className = 'pf-arbre';
    var feuille = document.createElement('div');
    feuille.className = 'pf-feuille';
    var outils = document.createElement('div');
    outils.className = 'pf-outils';
    // `<b t="{pref.use_default}" …/><s w="10"/><b t="{pref.save}" …/>` — les
    // deux libellés sortent de lang_french.as (« Valeurs par défaut »,
    // « Enregistrer »), dans cet ordre.
    outils.appendChild(prefBouton('Valeurs par défaut', prefUseDefault));
    outils.appendChild(prefBouton('Enregistrer', prefSave));
    fen.appendChild(arbre);
    fen.appendChild(feuille);
    fen.appendChild(outils);
    boite.appendChild(fen);

    // Les cartes de l'appli descendent dans le document vert : le JS du
    // mobile les cherche par identifiant, elles gardent donc les leurs.
    var corps = panneau.querySelector('#reg-corps');
    if (corps) feuille.appendChild(corps);

    chargerPrefs(panneau);
  }

  function prefBouton(libelle, action) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pf-but';
    b.textContent = libelle;
    b.addEventListener('click', action);
    return b;
  }

  function chargerPrefs(panneau) {
    var sid = jetonSid();
    if (!sid) return;
    fetch('/api/light/prefs?sid=' + encodeURIComponent(sid), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) return;
        prefEtat = {
          categories: (j.categories || []).concat([PF_LOCALES]),
          defauts: j.defaults || {},
          // Le BROUILLON : `box.Pref.prefDetails`, la copie de travail que
          // seul « Enregistrer » reverse dans le compte.
          brouillon: Object.assign({}, j.values || {}),
          choix: null,
          panneau: panneau,
        };
        dessinerArbrePrefs();
        // `box.Pref.onPrefForm` finit par `displayPref()` sans argument :
        // le document reste vide tant qu'on n'a rien choisi.
        afficherPref(null);
      })
      .catch(function () {});
  }

  function dessinerArbrePrefs() {
    if (!prefEtat) return;
    var arbre = prefEtat.panneau.querySelector('.pf-arbre');
    if (!arbre) return;
    arbre.textContent = '';
    prefEtat.categories.forEach(function (cat) {
      var r = document.createElement('button');
      r.type = 'button';
      r.className = 'pf-rub';
      r.textContent = cat.name;
      arbre.appendChild(r);
      // `cp.Tree` ouvre tout : `analysePrefForm` ne pose pas `flOpen`, mais
      // les rubriques d'une fenêtre de préférences n'ont que deux niveaux et
      // le SWF les déplie d'un clic. Ici tout est visible d'emblée — une
      // rubrique repliée cacherait la moitié des réglages sans raison.
      (cat.prefs || []).forEach(function (p) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pf-pref';
        b.textContent = p.label;
        b.addEventListener('click', function () { afficherPref(p); });
        arbre.appendChild(b);
      });
    });
    marquerPrefChoisie();
  }

  function marquerPrefChoisie() {
    if (!prefEtat) return;
    var arbre = prefEtat.panneau.querySelector('.pf-arbre');
    if (!arbre) return;
    var voulu = prefEtat.choix ? (prefEtat.choix.name || ('local' + prefEtat.choix.local)) : null;
    var i = 0;
    var boutons = arbre.querySelectorAll('.pf-pref');
    prefEtat.categories.forEach(function (cat) {
      (cat.prefs || []).forEach(function (p) {
        var cle = p.name || ('local' + p.local);
        if (boutons[i]) boutons[i].classList.toggle('on', cle === voulu);
        i++;
      });
    });
  }

  /**
   * `win.Pref.displayPref` (0x9181b) : sans argument, il vide le document.
   * Avec une préférence, il monte son formulaire — et le formulaire lit la
   * COPIE (`prefDetails[i].value`), jamais la valeur enregistrée.
   */
  function afficherPref(p) {
    if (!prefEtat) return;
    var feuille = prefEtat.panneau.querySelector('.pf-feuille');
    if (!feuille) return;
    prefEtat.choix = p;
    marquerPrefChoisie();
    // Le document se vide de ses widgets, mais les cartes de l'appli restent
    // dans le DOM : ce sont elles qu'on montre ou cache.
    var corps = feuille.querySelector('#reg-corps');
    [].slice.call(feuille.children).forEach(function (n) {
      if (n !== corps) n.remove();
    });
    if (corps) corps.hidden = !(p && p.local !== undefined);
    if (!p) return;

    if (p.local !== undefined) {
      // Une rubrique de l'appareil : on ne montre que SA carte.
      if (!corps) return;
      var cartes = corps.querySelectorAll('.reg-carte');
      for (var k = 0; k < cartes.length; k++) cartes[k].hidden = (k !== p.local);
      return;
    }

    var titre = document.createElement('div');
    titre.className = 'pf-titre';
    titre.textContent = p.label;
    var desc = document.createElement('div');
    desc.className = 'pf-desc';
    desc.textContent = p.desc || '';
    feuille.insertBefore(desc, feuille.firstChild);
    feuille.insertBefore(titre, feuille.firstChild);

    var valeur = prefEtat.brouillon[p.name];
    if (valeur === undefined) valeur = p.def;
    feuille.appendChild(champPref(p, valeur));

    // « Valeurs par défaut » ne dit pas ce qu'il va faire : cette ligne le
    // dit pour lui.
    var d = document.createElement('div');
    d.className = 'pf-defaut';
    d.textContent = 'Valeur d’origine : ' + libellePref(p, p.def);
    feuille.appendChild(d);
  }

  // Le libellé d'une valeur — celui du choix quand il y en a, la valeur brute
  // sinon (un booléen d'époque vaut 'Y' ou 'N', jamais true/false).
  function libellePref(p, v) {
    for (var i = 0; i < (p.choices || []).length; i++) {
      if (p.choices[i].v === v) return p.choices[i].label;
    }
    if (p.type === 'b') return v === 'N' ? 'Non' : 'Oui';
    return v === '' ? '(vide)' : String(v);
  }

  /**
   * Le widget, tel que `Standard.getPrefForm` le décrit par type — deux radios
   * Oui/Non pour un booléen, un champ de saisie sinon — ou la liste de choix
   * que le serveur envoie à sa place.
   */
  function champPref(p, valeur) {
    var boite = document.createElement('div');
    var choix = p.choices && p.choices.length
      ? p.choices
      : (p.type === 'b' ? [{ v: 'Y', label: 'Oui' }, { v: 'N', label: 'Non' }] : null);
    if (choix) {
      choix.forEach(function (c) {
        var l = document.createElement('label');
        l.className = 'pf-choix';
        var r = document.createElement('input');
        r.type = 'radio';
        r.name = 'pf-' + p.name;
        r.value = c.v;
        r.checked = (c.v === valeur);
        r.addEventListener('change', function () {
          if (r.checked) prefEtat.brouillon[p.name] = c.v;
        });
        l.appendChild(r);
        l.appendChild(document.createTextNode(c.label));
        boite.appendChild(l);
      });
      return boite;
    }
    var i = document.createElement('input');
    i.type = 'text';
    i.className = 'pf-saisie';
    i.value = valeur === undefined ? '' : String(valeur);
    // `r="0-9"` : un entier d'époque ne prend que des chiffres. La chaîne
    // stockée est en base 62, mais le champ montre le nombre — la conversion
    // est faite ici, comme `AdvancedTextInput` la faisait là-bas.
    if (p.type === 'i') {
      i.value = String(decode62Bureau(valeur));
      i.inputMode = 'numeric';
      i.addEventListener('input', function () {
        i.value = i.value.replace(/[^0-9]/g, '');
        prefEtat.brouillon[p.name] = encode62Bureau(Number(i.value) || 0);
      });
    } else {
      i.addEventListener('input', function () { prefEtat.brouillon[p.name] = i.value; });
    }
    boite.appendChild(i);
    return boite;
  }

  // Les deux moitiés de la base 62 du SWF (`encode62`/`decode62` du serveur) :
  // 0-9, puis a-z, puis A-Z.
  var BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function decode62Bureau(s) {
    var r = 0, t = String(s === undefined || s === null ? '' : s);
    for (var i = 0; i < t.length; i++) {
      var v = BASE62.indexOf(t.charAt(i));
      r = r * 62 + (v < 0 ? 0 : v);
    }
    return r;
  }
  function encode62Bureau(n) {
    if (!n) return '0';
    var r = '', x = Math.floor(n);
    while (x > 0) { r = BASE62.charAt(x % 62) + r; x = Math.floor(x / 62); }
    return r;
  }

  // `box.Pref.useDefault` (0xca17f) : TOUTE la copie retombe sur ses valeurs
  // d'origine, et le document se redessine sur la préférence en cours. Rien
  // n'est enregistré — il faut encore « Enregistrer ».
  function prefUseDefault() {
    if (!prefEtat) return;
    prefEtat.brouillon = Object.assign({}, prefEtat.defauts);
    afficherPref(prefEtat.choix);
  }

  // `box.Pref.save` (0xca24e) : la copie passe dans le compte, puis
  // `close()` — la fenêtre s'en va.
  function prefSave() {
    if (!prefEtat) return;
    var sid = jetonSid();
    if (!sid) return;
    fetch('/api/light/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sid, prefs: prefEtat.brouillon }),
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) appliquerPrefsLocales(j.values || {});
      })
      .catch(function () {})
      .then(function () { fermerFenetre('reglages-panel'); });
  }

  /* ── CE QUE LE BUREAU FAIT DES PRÉFÉRENCES ──────────────────────────────
     Une préférence sans effet n'est qu'un décor. Le bureau light honore
     celles dont il a le moyen :

       win_flMoveAnim  → l'animation d'ouverture et de déplacement (`FLUIDE`) ;
       ch_dsp_h        → l'horodatage devant chaque message ;
       ch_dsp_join/leave/kick/ban → les lignes d'arrivée, de départ,
                         d'expulsion et de bannissement dans le fil.

     Les autres restent servies et enregistrées — le SWF s'en sert, et un
     réglage posé ici doit le suivre là-bas — mais le light ne les consulte
     pas encore : `default_channel` et `cl_open` touchent au démarrage,
     `cache_length` au cache du lecteur Flash, `wallpaper` passe par
     l'inventaire, et les deux comportements d'invitation par le serveur. */
  function appliquerPrefsLocales(valeurs) {
    if (!valeurs) return;
    FLUIDE = valeurs.win_flMoveAnim !== 'N';
    if (window.SalonsBureau && SalonsBureau.poserPrefsAffichage) {
      SalonsBureau.poserPrefsAffichage({
        heure: valeurs.ch_dsp_h !== 'N',
        arrivees: valeurs.ch_dsp_join !== 'N',
        departs: valeurs.ch_dsp_leave !== 'N',
        expulsions: valeurs.ch_dsp_kick !== 'N',
        bannissements: valeurs.ch_dsp_ban !== 'N',
      });
    }
  }

  // À la connexion, le bureau lit une fois les préférences pour se régler —
  // c'est le `userPref` que `do/onident` remet au SWF.
  function relirePrefs() {
    var sid = jetonSid();
    if (!sid) return;
    fetch('/api/light/prefs?sid=' + encodeURIComponent(sid), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) appliquerPrefsLocales(j.values); })
      .catch(function () {});
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LA FICHE (`win.Frutiz`, DoInitAction sprite#753 0x583ad)

     `win.Frutiz extends WinStandard` : une FENÊTRE. Rien ne s'assombrit
     derrière elle, et `initInterface` la rend glissable par son cadre —

         mcInterface.onPress = function() {
           this._parent.box.activate(); this._parent.initDrag();
         }
         mcInterface.onRelease = mcInterface.onReleaseOutside = endDrag

     Le mobile en fait une carte modale (sur un téléphone, une fenêtre
     flottante n'a nulle part où flotter) ; le bureau lui rend sa nature. */

  function ouvrirFiche(pseudo) {
    if (!window.ouvrirFicheJoueur) return;
    window.ouvrirFicheJoueur(pseudo);
    if (actif) poserFiche();
  }

  // La fiche est une fenêtre comme les autres : `win.Frutiz` (sprite#819) ne
  // se donne pas de `pos` et n'appelle pas `moveToCenter`, donc `recal` la pose
  // DANS LE COIN, comme tout ce qui s'ouvre sur le bureau. (Elle y arrivait en
  // escalier : c'était une invention, au même titre que celui des fenêtres.)
  function poserFiche() {
    var f = $('#fiche');
    if (!f) return;
    if (!f.dataset.posee) {
      f.style.setProperty('--fx', CORNER_X + 'px');
      f.style.setProperty('--fy', CORNER_Y + 'px');
      f.dataset.posee = '1';
      glisserFiche(f);
      var rangee = f.querySelector('.fiche-actions');
      if (rangee) completerIconesFiche(rangee);
    }
    habillerIconesFiche();
  }

  /* `box.Frutiz.getIconList` compose la rangée de boutons blancs, et l'ordre
     comme les conditions viennent du bytecode :

       si c'est MA fiche  → image 10 seule (frutiz_edit_info)
       sinon, dans l'ordre :
         image  2  frutiz_chat_now
         image  3  frutiz_new_mail
         image 13  frutiz_blog
         image  4  frutiz_add_to_contact       si pas déjà au carnet
         image  5  frutiz_add_to_blacklist     sinon image 12, l'en retirer
         si me.flMode :
           image 6 frutiz_kick   (seulement quand la fiche vient d'un SALON)
           image 7 frutiz_ban  ·  image 8 frutiz_mute

     Le light n'en montrait que deux : le mobile avait écarté le blog, le
     carnet et la liste noire faute de place. Au bureau il y a la place, et
     l'époque les met. */
  var FICHE_ICONES = [
    { id: 'fiche-mp',       art: 'fiche-ico-chat' },
    { id: 'fiche-mail',     art: 'fiche-ico-mail' },
    { id: 'fiche-blog',     art: 'fiche-ico-blog',    titre: 'Son blog' },
    { id: 'fiche-contact',  art: 'fiche-ico-contact', titre: 'Ajouter à mes contacts' },
    { id: 'fiche-noire',    art: 'fiche-ico-noire',   titre: 'Mettre en liste noire' },
    { id: 'fiche-kick',     art: 'fiche-ico-kick' },
    { id: 'fiche-ban',      art: 'fiche-ico-ban' },
    { id: 'fiche-totoche',  art: 'fiche-ico-mute' },
    { id: 'fiche-editer',   art: 'fiche-ico-editer' },
  ];

  // Les trois que le mobile n'a pas : on les monte une fois, à leur place
  // d'époque, et on les câble sur ce que le light sait faire.
  function completerIconesFiche(rangee) {
    var pseudo = function () {
      var e = $('#fiche-pseudo');
      return e ? e.textContent.trim() : '';
    };
    var neuf = function (id, art, titre, faire) {
      if ($('#' + id)) return null;
      var b = document.createElement('button');
      b.type = 'button';
      b.id = id;
      b.title = titre;
      b.innerHTML = '<img src="/frutiz/sprites/' + art + '.svg" alt="">';
      b.addEventListener('click', faire);
      return b;
    };
    var blog = neuf('fiche-blog', 'fiche-ico-blog', 'Son blog', function () {
      window.open('/bouilloscope/?u=' + encodeURIComponent(pseudo()), '_blank');
    });
    var contact = neuf('fiche-contact', 'fiche-ico-contact', 'Ajouter à mes contacts', function () {
      var sid = jetonSid(), u = pseudo();
      if (!sid || !u) return;
      fetch('/ff/mk?sid=' + encodeURIComponent(sid) + '&folder=mycontact&t=contact&u='
        + encodeURIComponent(u)).then(function () { chargerContacts(); });
    });
    var noire = neuf('fiche-noire', 'fiche-ico-noire', 'Mettre en liste noire', function () {
      var sid = jetonSid(), u = pseudo();
      if (!sid || !u) return;
      if (!window.confirm('Mettre « ' + u + ' » en liste noire ?')) return;
      fetch('/ff/mk?sid=' + encodeURIComponent(sid) + '&folder=blacklist&t=contact&u='
        + encodeURIComponent(u)).then(function () { chargerContacts(); });
    });
    // `getIconList` les pousse APRÈS le courrier et AVANT la modération.
    var apres = $('#fiche-mail');
    [blog, contact, noire].forEach(function (b) {
      if (!b) return;
      if (apres && apres.parentNode === rangee) rangee.insertBefore(b, apres.nextSibling);
      else rangee.appendChild(b);
      apres = b;
    });
  }

  // Les glyphes d'époque, à la place des PNG du mobile.
  function habillerIconesFiche() {
    FICHE_ICONES.forEach(function (d) {
      var b = $('#' + d.id);
      if (!b) return;
      var i = b.querySelector('img');
      if (i) i.src = '/frutiz/sprites/' + d.art + '.svg';
    });
  }

  // `UserSlot.onInfoBasic` : le pseudo prend la couleur du GENRE — le bleu
  // #242169 pour un garçon, le rouge #BB4444 pour une fille.
  // (`majGenreFiche` guettait ici l'arrivée des données pour teinter le pseudo
  // en rose. C'est `renderFiche` qui pose l'attribut désormais, au moment où il
  // écrit le pseudo — il a la donnée sous la main, plus rien à guetter.)

  // OÙ LA FICHE SE POSE — dans `--fx`/`--fy`, mais avec la même arithmétique
  // que `left`/`top` d'une fenêtre.
  function poserFicheA(x, y) {
    var f = $('#fiche');
    if (!f) return;
    f.style.setProperty('--fx', x + 'px');
    f.style.setProperty('--fy', y + 'px');
  }

  /* `initDrag` / `endDrag` : la fiche se déplace COMME UNE FENÊTRE, parce que
     c'en est une — `win.Frutiz extends WinStandard`, et `initInterface` lui
     branche le même couple :

         mcInterface.onPress = function() { box.activate(); initDrag(); }
         mcInterface.onRelease = mcInterface.onReleaseOutside = endDrag

     `WinStandard.initDrag` (0x53b7b) n'attache pas la fenêtre au curseur : il
     sort le FANTÔME (`win.Ghost`, la silhouette blanche à quatre arcs) et
     c'est lui qui suit la souris. `endDrag` (0x53d6d) reprend sa place,
     `recal` la borne à la zone du bureau, `moveToPos` y fait GLISSER la
     fenêtre.

     Le portage attachait la fiche au curseur, sans silhouette, et ne la
     bornait qu'à zéro : elle pouvait passer sous la main bar et derrière la
     bande des contacts, et elle sautait sans glisser. Elle suit maintenant le
     même chemin que les autres — au même code près. */
  function glisserFiche(f) {
    f.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      if (ev.target.closest('button, a, input, .fiche-corps')) return;
      ev.preventDefault();
      var pos = posDe(f);
      // Le fantôme vit DANS la couche de la fiche : `#bureau-fenetres` est
      // une couche plus bas, et la silhouette y passerait derrière elle.
      var fantome = creerFantome(pos, f.parentNode);
      var decalx = ev.clientX, decaly = ev.clientY;
      var glisser = function (e2) {
        fantome.style.left = Math.round(pos.x + e2.clientX - decalx) + 'px';
        fantome.style.top = Math.round(pos.y + e2.clientY - decaly) + 'px';
      };
      var lacher = function (e2) {
        document.removeEventListener('pointermove', glisser);
        document.removeEventListener('pointerup', lacher);
        var cible = recal({
          x: pos.x + e2.clientX - decalx,
          y: pos.y + e2.clientY - decaly,
          w: pos.w, h: pos.h,
        }, { w: pos.w, h: pos.h });
        fantome.remove();
        glisserVers(f, cible, poserFicheA);
      };
      document.addEventListener('pointermove', glisser);
      document.addEventListener('pointerup', lacher);
    });
  }

  // `main.onResize()` reborne TOUT ce qui est posé sur le bureau — la fiche
  // comprise. C'est le même appel qui suit `SideList.activate` quand la bande
  // des contacts s'ouvre et pousse `cornerX` de 9 à 129.
  function bornerFiche() {
    var f = $('#fiche');
    if (!f || !f.dataset.posee || !f.offsetWidth) return;
    var avant = posDe(f);
    var pos = recal(posDe(f), { w: avant.w, h: avant.h });
    if (Math.round(avant.x) === Math.round(pos.x)
      && Math.round(avant.y) === Math.round(pos.y)) return;
    glisserVers(f, pos, poserFicheA);
  }

  // ── Le GLISSER-DÉPOSER des icônes du bureau ────────────────────────────
  // `cpDragIconList` + `FPDesktop.onDrop` (0xb9ca9). Le comportement a été
  // relevé sur le rendu 1:1 (une icône prise, promenée, lâchée, puis un
  // rechargement), et il ne ressemble PAS à celui des fenêtres :
  //
  //   • l'icône elle-même suit le curseur — pas de fantôme, pas de glissade
  //     de retour ; sa case d'origine se VIDE pendant la prise ;
  //   • lâchée, elle reste où on l'a mise : `onDrop` inscrit un `pos` libre
  //     sur l'entrée de la liste, et `DragIconList.fitInGrid` ne fait que la
  //     BORNER (il retranche `gridSpace` tant qu'on dépasse), sans arrondir ;
  //   • les voisines ne bougent pas : le trou reste ouvert dans la rangée ;
  //   • et RIEN n'est retenu — après rechargement, l'icône est revenue à sa
  //     place (relevé : la corbeille déposée au milieu du bureau retrouve sa
  //     6e case). Le `pos` ne vit qu'en mémoire.
  //
  // QUIRK D'ÉPOQUE conservé : au relâché, l'icône saute de +9 en x et +6 en y
  // par rapport à l'endroit où on la voyait. `onDrop` convertit la position du
  // curseur en coordonnées de la liste sans défalquer le décalage de celle-ci
  // — soit `cornerX` (9) et `margin` (6). Le saut est visible d'origine, on le
  // garde.
  var ICONE_SAUT_X = 9, ICONE_SAUT_Y = 6;
  var dernierGlisse = 0;

  function rendreIconesDeplacables(grille, bureau) {
    // Un glissé ne doit pas OUVRIR la rubrique. On ne peut pas s'appuyer sur
    // le clic de fin de geste : la tuile ayant changé de parent en cours de
    // route, le navigateur n'en émet aucun. On garde donc l'heure du dernier
    // dépôt et on n'avale que ce qui arrive dans la foulée.
    bureau.addEventListener('click', function (ev) {
      if (Date.now() - dernierGlisse > 250) return;
      if (!ev.target.closest('.home-tile')) return;
      ev.stopPropagation();
      ev.preventDefault();
    }, true);

    grille.addEventListener('pointerdown', function (ev) {
      var tuile = ev.target.closest('.home-tile');
      if (!tuile || ev.button !== 0) return;
      // Sans cela le navigateur démarre une SÉLECTION DE TEXTE : le libellé
      // et tout ce que le geste balaie virent au bleu pendant le glissé. Le
      // même remède que pour les disques de la Frusion.
      ev.preventDefault();
      var departX = ev.clientX, departY = ev.clientY;
      var bouge = false;
      // Le décalage du curseur DANS la tuile, pour qu'elle ne saute pas sous
      // la main au premier pixel de mouvement.
      var boite = tuile.getBoundingClientRect();
      var decalX = ev.clientX - boite.left, decalY = ev.clientY - boite.top;
      var trou = null;
      // La capture suit le pointeur PARTOUT — au-dessus d'une fenêtre, hors
      // du bureau, hors de la page. Sans elle, un survol malencontreux volait
      // les événements et la tuile restait collée au curseur.
      try { tuile.setPointerCapture(ev.pointerId); } catch (e) { /* vieux navigateur */ }

      var glisser = function (e2) {
        if (e2.pointerId !== ev.pointerId) return;
        if (!bouge) {
          if (Math.abs(e2.clientX - departX) < 4 && Math.abs(e2.clientY - departY) < 4) return;
          bouge = true;
          // La case libérée reste OUVERTE : on laisse un espaceur de la même
          // largeur, sinon la rangée se refermerait — d'époque elle ne le
          // fait pas. Une tuile DÉJÀ posée a laissé le sien au premier voyage.
          if (!tuile.classList.contains('posee')) {
            trou = document.createElement('div');
            trou.className = 'home-trou';
            trou.style.width = boite.width + 'px';
            trou.style.height = boite.height + 'px';
            grille.insertBefore(trou, tuile);
          }
          tuile.classList.add('posee', 'en-main');
          bureau.appendChild(tuile);
          // REPOSER LA CAPTURE. Un élément qui change de parent est d'abord
          // RETIRÉ du document, et le retrait libère la capture de pointeur :
          // sans ce rappel, la tuile ne recevait plus rien après son premier
          // pas et restait figée là, `en-main`, sans jamais se déposer.
          try { tuile.setPointerCapture(ev.pointerId); } catch (e) { /* vieux navigateur */ }
        }
        // Le repère est relu à CHAQUE pas : le bureau bouge (la barre se
        // replie, la bande des contacts s'ouvre) et une boîte figée au départ
        // décalait la tuile de tout ce que le bureau avait bougé depuis.
        var app = bureau.getBoundingClientRect();
        tuile.style.left = Math.round(e2.clientX - app.left - decalX) + 'px';
        tuile.style.top = Math.round(e2.clientY - app.top - decalY) + 'px';
      };

      var lacher = function (e2) {
        if (e2.pointerId !== ev.pointerId) return;
        document.removeEventListener('pointermove', glisser);
        document.removeEventListener('pointerup', lacher);
        document.removeEventListener('pointercancel', lacher);
        try { tuile.releasePointerCapture(e2.pointerId); } catch (e) { /* déjà rendu */ }
        if (!bouge) return;                       // simple clic : la rubrique s'ouvre
        tuile.classList.remove('en-main');
        tuile.style.left = (parseFloat(tuile.style.left) + ICONE_SAUT_X) + 'px';
        tuile.style.top = (parseFloat(tuile.style.top) + ICONE_SAUT_Y) + 'px';
        dernierGlisse = Date.now();
      };

      // Sur le DOCUMENT, et la capture par-dessus : les deux se complètent.
      // Capture posée, l'événement va à la tuile PUIS remonte jusqu'ici — on
      // le voit. Capture perdue (le reparentage, une fenêtre qui passe
      // dessous), le document le reçoit quand même. Écouter la tuile seule
      // laissait le geste en plan dès qu'elle changeait de parent.
      document.addEventListener('pointermove', glisser);
      document.addEventListener('pointerup', lacher);
      document.addEventListener('pointercancel', lacher);
    });
  }

  // initResize/endResize (0x53a2e/0x53b2a) : le redimensionnement au fantôme —
  // decalSize garde l'écart entre la souris et le coin, les minima s'imposent
  // pendant le suivi, la taille ne s'applique qu'au lâcher.
  /* ══ LA POIGNÉE, ET CE QU'ELLE MONTRE ══════════════════════════════════
     Deux clips, et il ne faut pas les confondre.

     LA ZONE SENSIBLE. `initButtons` (0x5449d) attache le symbole `transp` —
     un DefineButton2 dont la seule forme de hit (#130) fait 100 × 100 — sous
     le nom d'instance `butResize`, puis le met à `_xscale = _yscale = 30`
     (0x544b7). `updateDeskSize` (0x5400c) le pose à `pos.w − 20, pos.h − 20`.
     Elle couvre donc un carré de **30** ancré 20 px avant le coin : elle
     DÉBORDE de 10 px, et c'est ce débordement qu'on attrape.

     LE DESSIN N'EXISTE QU'AU SURVOL. `onRollOver → startResizeAnim`
     (0x568c1), `onRollOut → endResizeAnim` (0x56d7d). Avec `s = 18`, la
     méthode crée un clip vide et y trace trois `drawOval` concentriques
     autour de (−9, −9), plus l'icône `resizeIcon` (#355, 12 × 12) au centre :

       outline  Ø 20  `darkest`   #444444      (x = −(s+1), w = s+2)
       shade    Ø 18  `shade`     #DDDDDD      (x = −s,     w = s)
       main     Ø 14  `main`      #FFFFFF      (x = 2−s,    w = s−4)

     Les teintes viennent de `style.global.color[0]`, et `getWinStyle` (0x4957f)
     donne à `global` la famille **white** : la pastille est blanche cerclée de
     gris, quel que soit le fruit de la fenêtre.

     LE MOUVEMENT. Le clip naît en `(pos.w − s, pos.h − s)` à l'échelle 0, puis
     `animList.addSlide(…, ratio 2)` l'envoie vers `(pos.w + s/2, pos.h + s/2)`
     pendant qu'`addResize` (ratio 1) le porte à 100 %. À l'arrivée l'origine du
     clip est en (w+9, h+9) et les cercles, centrés en (−9, −9), tombent donc
     EXACTEMENT SUR LE COIN de la fenêtre. Au départ du curseur, cible
     `(pos.w − 20, pos.h − 20)` à l'échelle 0, ratio 1, puis suppression.

     La loi est celle de toutes les animations de la maison — `AnimList.slide`
     (0x515d1) et `AnimList.resize` (0x518c8) écrivent le même
     `Math.pow(0.8, tmod × ratio)` toutes les 25 ms. Ratio 2 → k = 0,64.

     Le portage posait une icône fixe à 8 px des bords, sans pastille et sans
     mouvement : elle ne tombait donc jamais sur le coin. */
  var POIGNEE_S = 18;                  // le `var s = 18` de startResizeAnim
  var POIGNEE_ANCRE = 20;              // `pos.w − 20`, la pose de butResize

  // `pos.w`/`pos.h` sont les dimensions de la fenêtre BORD COMPRIS, alors qu'un
  // enfant en position absolue se règle sur la boîte de remplissage — laquelle
  // commence 1 px plus loin, après le liseré. D'où le pixel retranché : sans
  // lui, la pastille tomberait un cran à côté du coin.
  var POIGNEE_BORD = 1;
  function poseVue(fen, x, y, echelle) {
    var v = fen._poigneeVue;
    if (!v) return;
    v.style.left = (x - POIGNEE_BORD) + 'px';
    v.style.top = (y - POIGNEE_BORD) + 'px';
    v.style.transform = 'scale(' + (echelle / 100) + ')';
  }

  // `startResizeAnim` / `endResizeAnim`, avec leur cible et leur ratio.
  function animerPoignee(fen, entrante) {
    var reg = fen._poigneeReg;
    if (!reg) return;
    if (fen._poigneeAnim) clearInterval(fen._poigneeAnim);
    var pos = posDe(fen);
    var cible = entrante
      ? { x: pos.w + POIGNEE_S / 2, y: pos.h + POIGNEE_S / 2, e: 100 }
      : { x: pos.w - POIGNEE_ANCRE, y: pos.h - POIGNEE_ANCRE, e: 0 };
    var kMouv = Math.pow(GLISSE_K, entrante ? 2 : 1);   // le `ratio` d'addSlide
    fen._poigneeAnim = setInterval(function () {
      reg.x = reg.x * kMouv + cible.x * (1 - kMouv);
      reg.y = reg.y * kMouv + cible.y * (1 - kMouv);
      reg.e = reg.e * GLISSE_K + cible.e * (1 - GLISSE_K);   // addResize, ratio 1
      poseVue(fen, reg.x, reg.y, reg.e);
      if (Math.round(reg.x) === Math.round(cible.x)
        && Math.round(reg.y) === Math.round(cible.y)
        && Math.round(reg.e) === Math.round(cible.e)) {
        clearInterval(fen._poigneeAnim); fen._poigneeAnim = null;
        poseVue(fen, cible.x, cible.y, cible.e);
        // `removeResizeArrow` : au repos, le dessin n'existe pas.
        if (!entrante && fen._poigneeVue) {
          fen._poigneeVue.remove(); fen._poigneeVue = null; fen._poigneeReg = null;
        }
      }
    }, GLISSE_MS);
  }

  function montrerPoignee(fen) {
    if (fen._poigneeVue) { animerPoignee(fen, true); return; }
    var v = document.createElement('div');
    v.className = 'fen-poignee-vue';
    v.innerHTML = '<i class="pv-anneau"></i><i class="pv-ombre"></i>'
      + '<i class="pv-chair"></i><i class="pv-icone"></i>';
    fen.appendChild(v);
    fen._poigneeVue = v;
    var pos = posDe(fen);
    fen._poigneeReg = { x: pos.w - POIGNEE_S, y: pos.h - POIGNEE_S, e: 0 };
    poseVue(fen, fen._poigneeReg.x, fen._poigneeReg.y, 0);
    void v.offsetWidth;                // que le départ soit enregistré
    animerPoignee(fen, true);
  }
  function cacherPoignee(fen) {
    if (!fen._poigneeVue) return;
    animerPoignee(fen, false);
  }

  function rendreRedimensionnable(fen, poignee, minimum) {
    poignee.addEventListener('pointerenter', function () { montrerPoignee(fen); });
    poignee.addEventListener('pointerleave', function () {
      if (!poignee._tient) cacherPoignee(fen);
    });
    poignee.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      premierPlan(fen);
      var pos = posDe(fen);
      var min = minDe(minimum);          // les panneaux ne bougent pas pendant le glissé
      var fantome = creerFantome(pos);
      var decalSizeX = pos.w - ev.clientX;
      var decalSizeY = pos.h - ev.clientY;
      var taille = { w: pos.w, h: pos.h };
      var suivre = function (e2) {
        taille.w = Math.max(min.w, e2.clientX + decalSizeX);
        taille.h = Math.max(min.h, e2.clientY + decalSizeY);
        fantome.style.width = Math.round(taille.w) + 'px';
        fantome.style.height = Math.round(taille.h) + 'px';
      };
      var lacher = function () {
        document.removeEventListener('pointermove', suivre);
        document.removeEventListener('pointerup', lacher);
        fantome.remove();
        var cible = recal({ x: pos.x, y: pos.y, w: taille.w, h: taille.h }, minimum);
        fen.style.width = Math.round(cible.w) + 'px';
        fen.style.height = Math.round(cible.h) + 'px';
        fen.style.left = Math.round(cible.x) + 'px';
        fen.style.top = Math.round(cible.y) + 'px';
        // `onRelease` rend la main au survol ; `onReleaseOutside` (0x54593)
        // range la pastille dans la foulée — ici, c'est le curseur qui décide.
        poignee._tient = false;
        if (!poignee.matches(':hover')) cacherPoignee(fen);
        else animerPoignee(fen, true);        // elle suit le nouveau coin
        // La zone des bouilles compte combien d'écrans tiennent dans sa
        // hauteur : elle change de visage quand la fenêtre change de taille.
        majBouilles();
      };
      // Tant qu'on tient la poignée, le curseur peut sortir de sa zone : la
      // pastille ne doit pas s'en aller sous la main.
      poignee._tient = true;
      document.addEventListener('pointermove', suivre);
      document.addEventListener('pointerup', lacher);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //   LES ONGLETS — `SlotList`, `FPDesktop` et `FPTab`
  // ════════════════════════════════════════════════════════════════════════
  //
  // Le bureau d'époque n'est pas un simple gestionnaire de fenêtres
  // flottantes : c'est un ESPACE DE TRAVAIL À ONGLETS. `_global.slotList`
  // (SlotList.as) tient une liste de SLOTS dont un seul est actif ; le premier
  // est le BUREAU (`FPDesktop`, l'onglet « Bureau »), et chaque fenêtre mise
  // en onglet prend un `FPTab` à elle.
  //
  //   · le bouton « ─ » du bandeau appelle `WinStandard.putInTab()` : la
  //     fenêtre GLISSE d'abord hors de l'écran par le haut
  //     (`pos.y = −(pos.h + 100)`, sauf si Ctrl est enfoncée — le raccourci
  //     d'époque pour y aller sans animation), puis passe au slot ;
  //   · `FPDesktop.tab(box)` crée le `FPTab` et le rend actif ;
  //   · `WinStandard.initTabMode()` RETIRE le bandeau (`winTopBar`) et masque
  //     la poignée : en onglet la fenêtre n'a plus de barre de titre — l'onglet
  //     EST sa barre de titre — et elle occupe tout l'espace du bureau
  //     (`tab.w = mcw − cornerX`, `tab.h = mch − cornerY`) ;
  //   · `FPDesktop.onDeactivate()` cache le fond du bureau ET sa rangée
  //     d'icônes : passer sur un onglet escamote le bureau entier ;
  //   · `FPTab.getMenu()` donne le menu de l'onglet : « Vers bureau »
  //     (`moveToDesktop`) et « Fermer » (`tryToClose`).
  // ── LA GÉOMÉTRIE D'UN ONGLET (`MainBarTab`, sprite #781) ──────────────
  //
  // Le clip `tab` n'est pas d'une pièce : c'est une PLAQUE étirable (`barre`)
  // au-dessus d'un PIED (`bottom`), doublés d'une silhouette sombre
  // (`tabFond`) que `init` attache non pas au clip mais à `bar.mcTabBlack` —
  // un conteneur posé SOUS toute la rangée.
  //
  // La plaque est bornée en BAS par `barre._y` et monte de `barre._height` :
  // elle occupe `_y − _height` .. `_y`, et ce qui dépasse au-dessus de 0
  // passe sous la barre principale. Le pied la suit (`bottom._y = barre._y`).
  // D'où les trois positions de repos :
  //
  //     scrollUp   : barre._y → flActive × 4 ; à l'arrivée _height = _y et
  //                  `removeMenu()` — l'onglet rangé est plat, l'actif garde
  //                  4 px de plaque qui le raccordent à la barre ;
  //     activate   : barre._height = max(4, _height) puis scrollDown ;
  //     attachMenu : barre._height = tabMenuMargeUp + n × tabMenuSpace, et
  //                  scrollDown fait DESCENDRE l'onglet d'autant.
  //
  // Le menu ne se pose donc pas SUR l'onglet : les entrées sont attachées
  // DANS le clip (`menuMc`, à `_y = barre._y`), et c'est la plaque étirée qui
  // leur sert de fond. C'était là tout l'écart avec le portage précédent, qui
  // posait un panneau blanc par-dessus.
  //
  // Les deux défilements sont la même interpolation, celle de tout le SWF :
  // `v = v × 0,8^tmod + cible × (1 − 0,8^tmod)`, battue par un
  // `setInterval(…, 25)`. On garde le pas de 25 ms comme unité de tmod : la
  // vitesse est celle d'époque, quelle que soit la cadence d'affichage.
  var TAB_ESPACE = 110;                 // _global.main.tabSpace
  var TAB_PLAQUE = 4;                   // la plaque au repos (yscale 0,2222 de 18)
  var TAB_ARRIVEE = -30;                // `init` : this._y = −30, puis addSlide vers 0
  var MENU_ESPACE = 18, MENU_MARGE_HAUT = 8, MENU_MARGE_GAUCHE = 4, MENU_LARGEUR = 100;
  var slots = [];                       // [{ id, titre, fruit, panneau }] — 'bureau' en tête
  var slotActif = 'bureau';
  var ongletBureau = null;
  var ongletOuvert = null;              // celui dont le menu est déroulé

  function pieceOnglet(cls) {
    var i = document.createElement('i');
    i.className = cls;
    return i;
  }

  // `updateFond` : la silhouette recopie `barre._y`, `barre._height` et
  // `bottom._y`. Ici les trois tiennent dans deux variables.
  function poserOnglet(o) {
    var y = o.etat.y.toFixed(2) + 'px', h = o.etat.h.toFixed(2) + 'px';
    o.style.setProperty('--y', y); o.style.setProperty('--h', h);
    o.fond.style.setProperty('--y', y); o.fond.style.setProperty('--h', h);
  }

  function animerOnglet(o) {
    var e = o.etat;
    if (e.anim) return;                 // la boucle en cours suivra la cible
    e.dernier = 0;
    var pas = function (t) {
      if (!o.parentNode) { e.anim = null; return; }
      // Le premier pas vaut un tick d'époque ; ensuite on mesure, borné pour
      // qu'un onglet resté en arrière-plan ne saute pas d'un coup.
      var dt = e.dernier ? Math.min(t - e.dernier, 200) : 25;
      e.dernier = t;
      var r = Math.pow(0.8, dt / 25);
      e.y = e.y * r + e.cible * (1 - r);
      if (Math.round(e.y) === Math.round(e.cible)) {
        e.y = e.cible;
        // `scrollUp` : arrivé, il rabat la plaque sur le pied — et c'est LUI
        // qui retire le menu, jamais avant : la plaque le porte jusqu'en haut.
        // (`scrollDown`, lui, arrive à `cible = _height` et n'y touche pas.)
        if (e.h > e.cible) e.h = e.cible;
        if (ongletOuvert !== o) retirerMenu(o);
        e.anim = null;
        poserOnglet(o);
        return;
      }
      poserOnglet(o);
      e.anim = requestAnimationFrame(pas);
    };
    e.anim = requestAnimationFrame(pas);
  }

  function creerOnglet(id, titre, fruit) {
    var o = document.createElement('div');
    o.className = 'fb-onglet';
    o.setAttribute('data-slot', id);
    // `tabFond` va dans `mcTabBlack`, pas dans le clip : rangée dans
    // l'onglet, la silhouette du rang 0 déborderait par-dessus la plaque du
    // rang 1 (les onglets se chevauchent de treize pixels).
    var fond = document.createElement('div');
    fond.className = 'fb-onglet-fond';
    fond.setAttribute('data-slot', id);
    fond.appendChild(pieceOnglet('ot-fondh'));
    fond.appendChild(pieceOnglet('ot-fondb'));
    o.fond = fond;
    o.appendChild(pieceOnglet('ot-barre'));
    o.appendChild(pieceOnglet('ot-pied'));
    var lab = document.createElement('span');
    lab.textContent = titre;
    o.appendChild(lab);
    // LA PASTILLE EST UN BOUTON. `MainBarTab.init` accroche `bottom.but`, et
    // c'est SON `onPress` qui déroule le menu du slot (`slot.getMenu()`). La
    // plaque extraite du SWF est NUE : la pastille porte le fruit que
    // `getIconLabel()` choisit — l'orange du bureau, la banane d'un
    // explorateur, la fraise d'un salon.
    var ico = document.createElement('button');
    ico.type = 'button';
    ico.className = 'fb-onglet-ico';
    ico.title = 'Menu de l\'onglet';
    ico.style.backgroundImage = 'url(' + fruitUrl(fruit) + ')';
    ico.addEventListener('click', function (e) {
      e.stopPropagation();              // le clic sur la plaque ACTIVE ; ici, non
      menuOnglet(id);
    });
    o.appendChild(ico);
    // La COUTURE (#205, profondeur 13) : la bande grise qui recoud l'onglet au
    // liseré de la barre, par-dessus la plaque comme par-dessus le pied.
    o.appendChild(pieceOnglet('ot-couture'));
    // Les deux calques de `warning()` : une teinte rose masquée par le dessin.
    o.appendChild(pieceOnglet('ot-teinte ot-barre'));
    o.appendChild(pieceOnglet('ot-teinte ot-pied'));
    o.addEventListener('click', function () { activerSlot(id); });
    // Le clic droit ouvre le même menu : commodité du portage, sans coût.
    o.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      menuOnglet(id);
    });
    o.etat = { y: 0, h: TAB_PLAQUE, cible: 0, anim: null, dernier: 0 };
    poserOnglet(o);
    // `init` pose le clip à `_y = −30` et lui donne un `addSlide` vers 0 :
    // l'onglet TOMBE de sous la barre.
    o.style.top = TAB_ARRIVEE + 'px';
    fond.style.top = TAB_ARRIVEE + 'px';
    $('#bureau-onglets-noir').appendChild(fond);
    $('#bureau-onglets').appendChild(o);
    requestAnimationFrame(function () {
      o.classList.add('pose'); fond.classList.add('pose');
      o.style.top = '0px'; fond.style.top = '0px';
    });
    return o;
  }

  // `_global.main.tabSpace` : les onglets se posent à `rang × 110`, le premier
  // à l'origine de la barre (cornerX).
  function dessinerOnglets() {
    var barre = $('#bureau-onglets');
    if (!barre) return;
    var liste = [{ id: 'bureau' }].concat(slots);
    var vus = document.querySelectorAll('.fb-onglet');
    for (var i = 0; i < vus.length; i++) {
      var o = vus[i];
      var id = o.getAttribute('data-slot');
      var rang = -1;
      for (var j = 0; j < liste.length; j++) if (liste[j].id === id) rang = j;
      if (rang < 0) { if (o.fond) o.fond.remove(); o.remove(); continue; }
      o.style.left = (rang * TAB_ESPACE) + 'px';
      o.fond.style.left = o.style.left;
      // L'EMPILEMENT. `MainBar.addTab` attache l'onglet à
      // `dp_tab + (tabMax − id × 2)` : plus le rang est GRAND, plus la
      // profondeur est BASSE — le nouvel onglet passe SOUS les précédents, et
      // « Bureau » reste devant. L'activation, elle, ne change pas la
      // profondeur : elle ne fait que DESCENDRE l'onglet de quatre pixels.
      o.style.zIndex = String(500 - rang);
      o.fond.style.zIndex = o.style.zIndex;
      var etait = o.classList.contains('actif');
      var est = (id === slotActif);
      if (est === etait) continue;
      o.classList.toggle('actif', est);
      if (est) {
        // `activate` : la plaque prend au moins 4 px, puis scrollDown. Un menu
        // encore déroulé garde sa hauteur ; un menu qu'on vient de refermer
        // laisse la sienne derrière lui — on vise alors le repos, et c'est
        // `scrollUp` qui rabattra la plaque en arrivant.
        o.etat.h = Math.max(TAB_PLAQUE, o.etat.h);
        o.etat.cible = ongletOuvert === o ? o.etat.h : TAB_PLAQUE;
      } else {
        // `deactivate` : flMenu = false, puis scrollUp vers flActive × 4 = 0.
        o.etat.cible = 0;
      }
      animerOnglet(o);
    }
  }

  function activerSlot(id) {
    if (slotActif === id) return;
    var avant = slotActif;
    slotActif = id;
    // `Slot.deactivate` remet flMenu à faux : changer de slot referme le menu.
    fermerMenuOnglet();
    // Le bureau s'escamote quand un onglet prend la main (FPDesktop.onDeactivate
    // cache `mcDesk` ET la rangée d'icônes), et revient quand on le rappelle.
    document.body.classList.toggle('fb-onglet-actif', id !== 'bureau');
    // `Slot.onActivate` : « if (this.flWarning) this.onStopWarning() » — le
    // slot qui prend la main cesse d'avertir (`MainBarTab.stopWarning`).
    var neuf = document.querySelector('.fb-onglet[data-slot="' + id + '"]');
    if (neuf) neuf.classList.remove('clignote');
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      var f = fenetres[s.panneau];
      if (!f) continue;
      f.fen.classList.toggle('fen-onglet-vue', s.id === id);
    }
    if (avant !== id) dessinerOnglets();
  }

  /**
   * `Slot.warning()` — un slot réclame l'attention.
   *
   * Le garde-fou est dans `Slot.warning` lui-même : un slot ACTIF n'avertit
   * jamais (« if (this.flActive) return false »), et un slot déjà en alerte
   * ne relance pas l'animation (« if (this.flWarning) return false »).
   * `FPTab.onWarning` appelle alors `MainBarTab.warning()`, qui teinte
   * l'onglet de `0xFFB1AB` à 30 %, une demi-seconde sur deux.
   */
  function avertirSlot(id) {
    if (!actif || !id || id === slotActif) return false;
    var o = document.querySelector('.fb-onglet[data-slot="' + id + '"]');
    if (!o || o.classList.contains('clignote')) return false;
    o.classList.add('clignote');
    return true;
  }

  /**
   * Un message est arrivé dans une conversation (`box.Chat.onSend`).
   *
   *     if (cmode == "private" || cmode == "channel" && passwd != undefined) {
   *       if (mode == "desktop") this.activate();
   *       this.slot.warning();
   *     }
   *
   * Chaque conversation a SA fenêtre, ici comme d'époque : c'est l'onglet qui
   * porte CELLE DU SALON CONCERNÉ qui clignote — ou celui du BUREAU si elle y
   * est restée, exactement comme le fait `box.Chat` en remontant d'abord la
   * fenêtre au premier plan avant d'avertir le slot.
   *
   * (Quirk d'origine, laissé de côté : `onSend` exige `passwd != undefined`
   * pour un salon, `onSendUser` exige l'inverse — les deux gardes se
   * contredisent. Le light avertit dans les deux cas, salons et privés.)
   */
  function avertirConversation(salon) {
    var f = salon ? fenetres['salon:' + salon] : null;
    // Sans salon nommé (une annonce globale), c'est la conversation qu'on
    // regarde qui s'agite.
    if (!f) f = fenetres['salon:' + salonCourant()];
    if (!f) return false;
    return avertirSlot(f.onglet || 'bureau');
  }

  /**
   * Le « ─ » du bandeau : la fenêtre quitte le bureau pour un onglet.
   *
   * `flGo` dit si l'onglet PREND LA MAIN dans la foulée. Ce n'est pas un
   * détail : `WinStandard.putInTab` passe `Key.isDown(17)` — donc VRAI sous
   * Ctrl seulement — jusqu'à `FPSlotList.addSlot(slot, flGo)`, qui ne fait
   * `slot.mc.activate()` que si flGo. Au clic ordinaire, la fenêtre SE RANGE :
   * l'onglet se pose dans la barre et on reste sur le bureau, fond d'écran
   * compris. On l'activait toujours — la fenêtre s'étalait aussitôt en plein
   * écran et le bureau disparaissait sous elle.
   */
  function mettreEnOnglet(idPanneau, flGo) {
    var f = fenetres[idPanneau];
    if (!f || f.onglet) return;
    var id = 'tab-' + idPanneau;
    // On retient la pose du bureau : « Vers bureau » la rendra telle quelle.
    f.poseBureau = {
      left: f.fen.style.left, top: f.fen.style.top,
      width: f.fen.style.width, height: f.fen.style.height,
    };
    f.onglet = id;
    slots.push({ id: id, titre: f.txt.textContent, fruit: f.fruit, panneau: idPanneau });
    creerOnglet(id, f.txt.textContent, f.fruit);
    f.fen.classList.add('fen-en-onglet');
    f.fen.style.left = ''; f.fen.style.top = '';
    f.fen.style.width = ''; f.fen.style.height = '';
    if (flGo) activerSlot(id);
    dessinerOnglets();
    majBouilles();
  }

  /** `FPTab.moveToDesktop` : l'onglet rend sa fenêtre au bureau. */
  function versBureau(idOnglet) {
    var s = null;
    for (var i = 0; i < slots.length; i++) if (slots[i].id === idOnglet) s = slots[i];
    if (!s) return;
    var f = fenetres[s.panneau];
    slots.splice(slots.indexOf(s), 1);
    if (f) {
      f.onglet = null;
      f.fen.classList.remove('fen-en-onglet', 'fen-onglet-vue');
      if (f.poseBureau) {
        f.fen.style.left = f.poseBureau.left; f.fen.style.top = f.poseBureau.top;
        f.fen.style.width = f.poseBureau.width; f.fen.style.height = f.poseBureau.height;
      }
      premierPlan(f.fen);
    }
    slotActif = null;                   // pour forcer la bascule
    activerSlot('bureau');
    dessinerOnglets();
    majBouilles();
  }

  // ── LE MENU D'UN ONGLET (`MainBarTab.attachMenu`) ─────────────────────
  //
  // Ce n'est pas un menu contextuel flottant, et ce n'est pas non plus un
  // panneau posé sur l'onglet : `attachMenu` crée un clip VIDE dans l'onglet,
  // étire la plaque —
  //
  //     barre._height = tabMenuMargeUp + n × tabMenuSpace     (8 + n × 18)
  //
  // — puis `scrollDown` fait descendre l'onglet jusqu'à cette hauteur, ce qui
  // dégage la place au-dessus de l'étiquette. Les entrées sont des `butText`
  // de 100 × tabMenuSpace, gras, posées à `_x = tabMenuMargeLeft` (4) et
  // `_y = −(i × tabMenuSpace + 16)` : l'index 0 EN BAS. `FPTab.getMenu`
  // rendant [« Vers bureau », « Fermer »], on lit donc, de haut en bas,
  // « Fermer » puis « Vers bureau ».
  /*
   * LE MENU DE L'ONGLET « BUREAU » — il existe, et il tient quatre entrées.
   *
   * Le portage avait conclu que `FPDesktop` n'en avait pas ; c'était faux, et
   * la pastille de l'onglet ne faisait donc rien. `FPDesktop.getMenu`
   * (0xb97cd) se lit d'un bloc :
   *
   *     getMenu = function () {
   *       var m;
   *       if (me.name est l'un de bumdum, deepnight, yota, whitetigle, skool,
   *           warp, roger, test, ernest, hiko, ou (en minuscules) gaspard ou
   *           snowstar)
   *         m = [ {title: "Invisibilité",      → mainCnx.cmd("invisible")},
   *               {title: "Créer accessoires", → desktop.addBox(new
   *                                               box.NewBouille())},
   *               {title: "Afficher debug",    → moveDebugToDesktop()} ];
   *       else m = [];
   *       var t = main.mainBar.flHalfHide ? "Afficher barre" : "Mode rapide";
   *       m.push({title: "Se déconnecter", → logout()});
   *       m.push({title: "Mode light",     → golight()});
   *       m.push({title: t,                → main.mainBar.toggleHalfHide()});
   *       m.push({title: "Recherche",      → uniqWinMng.open("search")});
   *       return m;
   *     };
   *
   * Les trois premières sont l'outillage des AUTEURS (les pseudos sont ceux de
   * Motion-Twin) : elles n'ont pas cours ici. Restent les quatre de tout le
   * monde, et chacune existait déjà ailleurs dans le portage — il ne manquait
   * que de les rassembler là où l'époque les mettait.
   *
   * C'est aussi le menu du CLIC DROIT sur le fond d'écran (cf. `menuDuBureau`,
   * qui n'y ajoute que « Nouveau dossier »).
   */
  function menuDuSlot(idOnglet) {
    if (idOnglet === 'bureau') {
      return [
        { titre: 'Se déconnecter', faire: deconnecter },
        { titre: 'Mode light', faire: passerEnLight },
        // `flHalfHide` décide du libellé, pas de l'action : c'est la même
        // bascule dans les deux sens.
        { titre: repli.actif ? 'Afficher barre' : 'Mode rapide',
          faire: function () { basculerRepli(); } },
        { titre: 'Recherche', faire: ouvrirRecherche },
      ];
    }
    return [
      { titre: 'Vers bureau', faire: function () { versBureau(idOnglet); } },
      { titre: 'Fermer', faire: function () {
        var s = null;
        for (var i = 0; i < slots.length; i++) if (slots[i].id === idOnglet) s = slots[i];
        if (s) fermerFenetre(s.panneau);
      } },
    ];
  }

  // `FPDesktop.logout` : on part. La confirmation en deux temps est une
  // prudence du TIROIR mobile, où le doigt dérape ; on repasse par son bouton
  // pour ne pas dédoubler le chemin (fermeture de la socket comprise), en
  // l'armant puis en le confirmant d'un seul geste.
  function deconnecter() {
    var b = $('#logout-btn');
    if (!b) return;
    b.click();
    b.click();
  }

  // `FPDesktop.golight` : quitter le bureau pour la version légère. Elle est
  // ICI la même page, en présentation mobile — `isDesktop()` décide, et
  // `?vue=light` le lui interdit. Revenir au bureau, c'est rouvrir /light.html
  // sans le paramètre : rien n'est retenu nulle part.
  function passerEnLight() {
    var p = new URLSearchParams(window.location.search);
    p.set('vue', 'light');
    window.location.href = window.location.pathname + '?' + p.toString();
  }

  // `uniqWinMng.open("search")` : la fenêtre de recherche, celle-là même que le
  // bouton du bas de la bande des contacts ouvre. (Elle tenait lieu jusqu'ici
  // d'un renvoi vers le Bouilloscope, faute d'annuaire ; il y en a un.)
  function ouvrirRecherche() { ouvrirRechercheFenetre(); }

  function retirerMenu(o) {
    var m = o.querySelector('.ot-menu');
    if (m) m.remove();
  }

  function fermerMenuOnglet() {
    var o = ongletOuvert;
    ongletOuvert = null;
    if (!o) return;
    o.classList.remove('menu-ouvert');
    // `bottom.but.onPress` quand flMenu : scrollUp. C'est LUI qui retire le
    // menu — à l'arrivée seulement : la plaque le porte jusqu'en haut.
    o.etat.cible = o.classList.contains('actif') ? TAB_PLAQUE : 0;
    animerOnglet(o);
  }

  function menuOnglet(idOnglet) {
    var onglet = document.querySelector('.fb-onglet[data-slot="' + idOnglet + '"]');
    if (!onglet) return;
    // Un second appui referme, comme `bottom.but.onPress` quand `flMenu`.
    if (ongletOuvert === onglet) { fermerMenuOnglet(); return; }
    fermerMenuOnglet();
    var entrees = menuDuSlot(idOnglet);
    if (!entrees.length) { activerSlot(idOnglet); return; }
    retirerMenu(onglet);
    var m = document.createElement('div');
    m.className = 'ot-menu';
    m.style.left = MENU_MARGE_GAUCHE + 'px';
    entrees.forEach(function (e, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = e.titre;
      b.style.top = (-(i * MENU_ESPACE + 16)) + 'px';
      b.style.width = MENU_LARGEUR + 'px';
      b.style.height = MENU_ESPACE + 'px';
      b.style.lineHeight = MENU_ESPACE + 'px';
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        fermerMenuOnglet();
        e.faire();
      });
      m.appendChild(b);
    });
    onglet.appendChild(m);
    onglet.etat.h = MENU_MARGE_HAUT + entrees.length * MENU_ESPACE;
    onglet.etat.cible = onglet.etat.h;
    animerOnglet(onglet);
    onglet.classList.add('menu-ouvert');
    ongletOuvert = onglet;
    setTimeout(function () {
      document.addEventListener('pointerdown', function fermer(ev) {
        if (m.contains(ev.target)) return;
        document.removeEventListener('pointerdown', fermer);
        fermerMenuOnglet();
      });
    }, 0);
  }

  function fermerFenetre(idPanneau) {
    var f = fenetres[idPanneau];
    if (!f) return;
    // Une fenêtre en onglet emporte son onglet avec elle.
    if (f.onglet) {
      for (var i = slots.length - 1; i >= 0; i--) {
        if (slots[i].id === f.onglet) slots.splice(i, 1);
      }
      if (slotActif === f.onglet) { slotActif = null; activerSlot('bureau'); }
      dessinerOnglets();
    }
    f.panneau.classList.remove('active');
    rendre(f.panneau, f.origine);
    f.fen.remove();
    delete fenetres[idPanneau];
    // `box.Chat.close` (0x2a0be) : fermer la fenêtre d'une conversation, c'est
    // la quitter — `channelMng.remove(group)` pour un salon public,
    // `chatMng.unsetBox(user)` pour un privé. Le cadre s'en va avec elle, et
    // la rubrique aussi : celle-ci retient le panneau, qui n'existe plus.
    if (f.salon) {
      delete RUBRIQUES[idPanneau];
      if (window.SalonsBureau && SalonsBureau.fermerCadre) SalonsBureau.fermerCadre(f.salon);
    }
    // `box.Explorer.close` oublie le dossier courant : rouverte, la fenêtre
    // repart de sa racine.
    for (var cle in exEtats) {
      if (exEtats[cle].panneau && exEtats[cle].panneau.id === idPanneau) exEtats[cle].uid = null;
    }
    // FERMER LE JEU, C'EST ÉJECTER. D'époque le jeu ne se ferme pas tout
    // seul : c'est `FrusionSlot.onReadyToClose` qui prévient le lecteur, et le
    // lecteur rend le disque. Ici la fenêtre du jeu joue le rôle du slot.
    if (frusion && frusion.jeu) {
      var rub = RUBRIQUES[frusion.jeu];
      if (rub && rub.panneau === '#' + idPanneau) {
        frusion.jeu = null;
        frusion.stopDisc('releaseDisc');
      }
    }
  }

  function creerFenetre(rub, panneau, cle) {
    cle = cle || panneau.id;
    var fen = document.createElement('div');
    fen.className = 'fen';
    fen.style.width = Math.min(rub.l, window.innerWidth - 24) + 'px';
    fen.style.height = Math.min(rub.h, window.innerHeight - CORNER_Y - 12) + 'px';
    /*
     * OÙ ELLE SE POSE — dans le COIN, et elle y reste.
     *
     * `WinStandard.init` (0x53807) ne donne aucune position à la fenêtre :
     *
     *     if (this.pos === undefined) this.pos = { x: 0, y: 0, w: 0, h: 0 };
     *
     * et c'est `recal` (0x5411f) qui en fait une place réelle, en bornant au
     * coin de la zone utile :
     *
     *     pos.x = max(cornerX, min(mcw - pos.w, pos.x))   →   cornerX
     *     pos.y = max(cornerY, min(mch - pos.h, pos.y))   →   cornerY
     *
     * Une fenêtre neuve se pose donc SOUS LA MAIN BAR ET CONTRE LA BANDE DES
     * CONTACTS, et elle n'en bouge plus : il n'y a pas d'escalier d'ouverture
     * dans main.swf. Celui qu'on avait ici — 450 + n×26, 185 + n×24 — était une
     * invention, et c'est elle qui envoyait les fenêtres au milieu du bureau.
     *
     * DEUX FENÊTRES dérogent, et elles le font en écrivant leur propre `pos`
     * dans leur `init` :
     *
     *     win.Explorer  (0x92447)  pos = { x: 50, y: 50, w: 400, h: 400 }
     *                              puis moveToCenter()      → au milieu
     *     win.ViewMail  (0xc8910)  pos = { x: 50, y: 50, w: 500, h: 400 }
     *                              sans moveToCenter        → à (50, cornerY)
     *
     * Rouvrir une fenêtre déjà bâtie ne la déplace pas non plus : `Box.init`
     * prend alors sa branche `else` (swapDepths + onChangeMode), et
     * `moveToPos` part de là où elle est.
     */
    var place;
    if (rub.centre) {
      // `WinStandard.moveToCenter` (0x55bee) — et ce n'est PAS « le milieu de
      // la zone utile » :
      //
      //     pos.x = (mcw - (main.cornerX + pos.w)) / 2
      //     pos.y = (mch - (main.cornerY + pos.h)) / 2
      //
      // Le coin est SOUSTRAIT, pas ajouté : la fenêtre se pose donc un demi-
      // coin plus haut et plus à gauche que le vrai centre. `recal` la ramène
      // ensuite dans le cadre si elle en sort, puis `moveToPos` l'y fait
      // GLISSER depuis le coin : une fenêtre centrée ne saute pas au milieu.
      place = {
        x: (window.innerWidth - (CORNER_X + parseFloat(fen.style.width))) / 2,
        y: (window.innerHeight - (CORNER_Y + parseFloat(fen.style.height))) / 2,
      };
    } else if (rub.pos) {
      // Une fenêtre qui écrit son `pos` : `recal` la bornera au coin si sa
      // place tombe dessous (c'est le cas de `y` = 50 sous une main bar de 106).
      place = { x: rub.pos.x, y: rub.pos.y };
    } else {
      place = { x: 0, y: 0 };            // `recal` en fera (cornerX, cornerY)
    }
    /*
     * L'ARRIVÉE : la fenêtre VIENT DU COIN, elle n'apparaît pas à sa place.
     *
     * `Box.init` (0x23286) attache le clip sans lui donner de position —
     *
     *     this.slot.slotList.mc.attachMovie(this.winType, id, this.depth, this.winOpt)
     *
     * et `winOpt` ne porte que `box` et `title`. Un clip fraîchement attaché
     * est donc à (0, 0) de `slotList.mc`, c'est-à-dire au coin de la scène.
     * La suite pose sa place et l'y envoie EN GLISSANT :
     *
     *     endInit → onChangeMode (0x543d5) → initDesktopMode → update (0x53e06)
     *             → updatePos (0x53e3d) → updateDeskPos (0x53f47)
     *             → recal(); moveToPos()
     *
     * D'où la fenêtre qui sort de sous la main bar en diagonale. Ce n'est vrai
     * qu'à la PREMIÈRE ouverture : rouvrir une fenêtre déjà bâtie prend la
     * branche `else` de `Box.init` (swapDepths + onChangeMode), et `moveToPos`
     * part alors de la place où elle est déjà — donc ne bouge pas.
     */
    fen.style.left = '0px';
    fen.style.top = '0px';
    fen._entree = recal(
      { x: place.x, y: place.y, w: parseFloat(fen.style.width), h: parseFloat(fen.style.height) },
      rub.min || { w: 320, h: 220 });
    // `recal` borne la TAILLE autant que la place (`pos.w`, `pos.h`) : une
    // rubrique peut donc déclarer un gabarit plus petit que son minimum — ou
    // ne rien déclarer du tout, comme `win.Chat` dont le `pos` reste à zéro —
    // et la fenêtre s'ouvre au minimum de son contenu. Sans cette ligne, la
    // largeur écrite plus haut restait telle quelle et le minimum n'agissait
    // qu'à la poignée.
    fen.style.width = Math.round(fen._entree.w) + 'px';
    fen.style.height = Math.round(fen._entree.h) + 'px';

    var titre = document.createElement('div');
    titre.className = 'fen-titre';
    var pastille = document.createElement('span');
    pastille.className = 'fen-pastille';
    pastille.style.backgroundImage = 'url(' + fruitUrl(rub.fruit) + ')';
    var txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = rub.titre;
    // Les vrais boutons du bandeau (butGroupWinTop) : la MISE EN ONGLET puis
    // la croix, la croix au bord — l'ordre du bureau Flash. Le premier n'est
    // pas un « replier » : `WinStandard.putInTab()` fait glisser la fenêtre
    // hors de l'écran par le haut, puis la donne à un onglet
    // (`FPDesktop.tab`). Ctrl enfoncée, la glissade est sautée — c'est écrit
    // tel quel dans le moteur (`if(Key.isDown(17))`).
    var plier = document.createElement('button');
    plier.className = 'fen-btn plier';
    plier.title = 'Mettre en onglet';
    plier.addEventListener('click', function (e) {
      // Ctrl : pas de glissade, ET l'onglet prend la main — c'est le même
      // `Key.isDown(17)` qui commande les deux (`putInTab` → `addSlot(…, true)`).
      if (e.ctrlKey || e.metaKey) { mettreEnOnglet(cle, true); return; }
      fen.classList.add('fen-glisse');
      var apres = function () {
        fen.removeEventListener('transitionend', apres);
        fen.classList.remove('fen-glisse');
        // Clic ordinaire : la fenêtre se RANGE, on reste sur le bureau.
        mettreEnOnglet(cle, false);
      };
      fen.addEventListener('transitionend', apres);
      // Filet : si la transition ne part pas (fenêtre déjà hors flux), on
      // bascule quand même.
      setTimeout(function () {
        if (fen.classList.contains('fen-glisse')) apres();
      }, 420);
    });
    var fermer = document.createElement('button');
    fermer.className = 'fen-btn fermer';
    fermer.title = 'Fermer';
    titre.appendChild(pastille);
    titre.appendChild(txt);
    titre.appendChild(plier);
    titre.appendChild(fermer);

    var corps = document.createElement('div');
    corps.className = 'fen-corps';
    fen.appendChild(titre);
    fen.appendChild(corps);
    // La poignée de redimensionnement (butResize) : flResizable vaut vrai par
    // défaut dans WinStandard — toutes nos fenêtres l'ont.
    var minimum = rub.min || { w: 320, h: 220 };
    fen.addEventListener('pointerdown', function () { premierPlan(fen); });
    rendreDeplacable(fen, titre);
    // `flResizable` vaut vrai par défaut dans WinStandard, mais pas partout :
    // `win.Log.init` le met à FAUX. Une fenêtre `fixe` n'a donc pas de
    // poignée du tout — pas même invisible.
    if (!rub.fixe) {
      var poignee = document.createElement('div');
      poignee.className = 'fen-poignee';
      poignee.title = 'Redimensionner';
      fen.appendChild(poignee);
      rendreRedimensionnable(fen, poignee, minimum);
    } else {
      fen.classList.add('fen-fixe');
    }
    $('#bureau-fenetres').appendChild(fen);
    premierPlan(fen);
    // `updateDeskPos` : la fenêtre, encore au coin, part vers sa place.
    glisserVers(fen, fen._entree);
    fen._entree = null;

    var f = {
      fen: fen, corps: corps, panneau: panneau, minimum: minimum, cle: cle,
      origine: deplacer(panneau, corps),
      // Le salon d'une fenêtre de conversation ; nul pour toutes les autres.
      salon: rub.salon || null,
      txt: txt, pastille: pastille, topbar: null,
      // Le fruit du type de fenêtre : le bandeau ET l'onglet le portent —
      // c'est `getIconLabel()` qui le donne, une fois pour les deux.
      fruit: rub.fruit || null, onglet: null, poseBureau: null,
    };
    fermer.addEventListener('click', function () { fermerFenetre(cle); });
    return f;
  }

  // ── LA FENÊTRE D'UN JOURNAL GRANDIT AVEC SA PAGE ─────────────────────────
  // `win.Log` n'est pas redimensionnable, mais sa hauteur n'est pas fixe pour
  // autant : le `frameSet` la recalcule à chaque `update()`. `main.showFrame`
  // a `min.h = 200`, et les blocs de la page ont chacun `min.h = 60` avec 6 px
  // d'écart — quand ils dépassent les 200, c'est la fenêtre qui cède.
  //   hauteur = 3 (cadre+liseré) + 16 (bandeau) + zone + 24 (pied) + 2 + 3
  //   zone    = max(200, n × 60 + (n − 1) × 6)
  // Vérifié sur le relevé : deux blocs → zone 200 → 246 de haut, au pixel.
  function ajusterJournal(nbBlocs) {
    if (!actif) return;
    var p = $('#evt-panel');
    var f = p && fenetres[p.id];
    if (!f || !f.fen || f.fen.classList.contains('pliee')) return;
    var n = Math.max(1, nbBlocs || 1);
    var zone = Math.max(200, n * 60 + (n - 1) * 6);
    f.fen.style.height = (46 + zone) + 'px';
  }

  // Le bandeau des SCORES ne dit pas « Scores » mais « Scores - Burning kiwi -
  // mer 26 aout » : `win.Score` le retitre à chaque classement choisi. Le
  // light compose déjà cette phrase pour son propre bandeau — il nous la
  // passe, on la met où le bureau la met.
  function retitrer(idPanneau, texte) {
    var f = fenetres[idPanneau];
    if (!f || !texte) return;
    if (f.txt) f.txt.textContent = texte;
    // `FPTab.setTitle` suit le titre de sa fenêtre : l'onglet se retitre avec
    // le bandeau.
    if (f.onglet) {
      for (var i = 0; i < slots.length; i++) if (slots[i].id === f.onglet) slots[i].titre = texte;
      var o = document.querySelector('.fb-onglet[data-slot="' + f.onglet + '"] span');
      if (o) o.textContent = texte;
    }
  }

  /* ══ UNE FENÊTRE PAR SALON ═════════════════════════════════════════════
     `box.Chat` est une instance PAR SALON — `chatMng.setBox(this.user, this)`
     (0x29fdc) pour une discussion privée, `channelMng.pushUniq(this.group)`
     (0x2a065) pour un salon public — et `Slot.addBox` (0x35c98) range les
     boîtes d'un slot dans une LISTE. Le bureau d'époque tient donc autant de
     fenêtres de conversation qu'on en ouvre ; rejoindre un salon n'en ferme
     aucune.

     Le panneau, lui, vient du light : `SalonsBureau.cadre(id)` recopie le
     panneau du chat et le branche sur CE salon (son fil, sa saisie, ses
     feutres, ses connectés). Ici on ne fait que le loger dans une fenêtre —
     avec son bouton d'appel au modérateur et le geste des bouilles, qui
     appartiennent au bureau.

     La rubrique est bâtie à la volée, sous la clé « salon:<id> », comme
     `ouvrirDossierBureau` le fait pour « dossier:<uid> ». */
  function salonCourant() {
    var S = window.SalonsBureau;
    if (!S) return null;
    var id = S.courant && S.courant();
    if (id) return id;
    // Plus une seule conversation ouverte (on les a toutes fermées) : on
    // retombe sur le premier salon public, celui que le light rejoint au
    // démarrage.
    var l = (S.liste && S.liste()) || [];
    return l.length ? l[0].id : null;
  }
  function ouvrirSalon(salon, enFond) {
    if (!actif || !salon) return;
    var S = window.SalonsBureau;
    if (!S || !S.cadre) return;
    var cle = 'salon:' + salon;
    var neuve = !fenetres[cle];
    if (!RUBRIQUES[cle]) {
      var panneau = S.cadre(salon);
      if (!panneau) return;
      // Hors écran tant qu'il n'est pas `.active` — c'est de là que le
      // reparentage le prendra, et c'est là qu'il retournera à la fermeture.
      if (!panneau.parentNode) $('#app').appendChild(panneau);
      RUBRIQUES[cle] = {
        panneau: '[data-salon="' + String(salon).replace(/["\\\]]/g, '') + '"]',
        cle: cle, salon: salon, titre: S.titreDe(salon), fruit: 'winChat',
        // `win.Chat` n'écrit PAS de `pos` : ni `win.Chat.init` (0x69154, qui ne
        // fait que fermer ses trois panneaux et appeler `win.Dialog.init`), ni
        // `win.Dialog.init` (0x68ac3), ni `win.Advance` au-dessus. Le `pos` de
        // `WinStandard.init` reste donc à zéro, et `recal` en fait le MINIMUM
        // du contenu, dans le coin. Une conversation s'ouvre étroite, et c'est
        // à l'usage qu'on l'étire — le portage l'ouvrait à 780 × 580, c'est-
        // à-dire plus grande que la moitié du bureau.
        //   `h: 0` dit exactement cela : la hauteur est celle de `minSalon`.
        //   La largeur est celle qu'on veut voir à l'ouverture (220), et elle
        //   remonte d'elle-même quand la colonne des bouilles ou la liste des
        //   connectés relève le minimum (`appliquerMinimum`).
        l: 220, h: 0, min: function () { return minSalon(panneau); },
      };
    }
    ouvrirFenetre(cle);
    var f = fenetres[cle];
    if (enFond) {
      // `chatMng.open(p, g, u, trashSlot)` (0x8d599) : une conversation qu'on
      // n'a pas demandée s'ouvre DANS LE SLOT D'ATTENTE, pas sur le bureau.
      // C'est l'onglet qui prévient — `box.Chat.onSend` finit par
      // `this.slot.warning()` — et non la fenêtre qui s'impose.
      if (f && neuve && !f.onglet) mettreEnOnglet(cle, false);
      if (f) avertirSlot(f.onglet || 'bureau');
      return;
    }
    // La fenêtre qu'on vient d'ouvrir (ou de rappeler) est celle qu'on
    // regarde : c'est elle que le reste du light suit.
    if (S.regarder) S.regarder(salon);
  }

  /* ═══ GASPARD ════════════════════════════════════════════════════════════
   *
   * La PREMIÈRE des six icônes de l'encart, et la fenêtre qu'elle ouvre.
   *
   * `initNameList` (0xb56c0) nomme la rangée. Attention à l'ordre : `InitArray`
   * dépile, la dernière valeur empilée devient l'indice 0 —
   *
   *     Push "jeux","evenements","historique","messages","forum","gaspard", 6
   *     InitArray                → [gaspard, forum, messages, historique,
   *                                 evenements, jeux]
   *
   * `initIcons` (0x6cbbc) les pose de gauche à droite, `icon<i>._x = 42 + i×15`
   * et `_y = 33`, chacune arrêtée sur l'image `i+1` de `digitalIcon` ; un clip
   * `transp` de 15 % leur sert de zone sensible, décalé de −7,5 px puisque les
   * dessins sont centrés. Le survol écrit `nameList[id]` dans le champ du
   * classement, la sortie y remet le rang, et l'appui appelle `select(id)` :
   *
   *     0 → uniqWinMng.open("help")      3 → uniqWinMng.open("userLog")
   *     1 → openForum()                  4 → uniqWinMng.open("siteLog")
   *     2 → openInbox()                  5 → openGame()
   *
   * Gaspard, c'est donc l'aide — et sa fenêtre est une CONVERSATION :
   * `box.Help` (0x7fc9f) étend `box.Standard`, `win.Help` (0xbd7db) étend
   * `win.Dialog` comme le salon, et `getIconLabel` renvoie « winChat » — la
   * pastille du chat. La liste des présents contient deux noms (`nbUser = 2`) :
   * soi et Gaspard.
   *
   *     init          userList.addUser(me.name) puis addUser(help.name)
   *                   loadContent(openContent || { i: 1 })
   *     getContent(id)      previousArr.push(current) ; loadContent({i: id})
   *     getPrevious()       loadContent(previousArr.pop())
   *     analyseInput(s)     trim ; vide → non ; moins de 2500 ms depuis la
   *                         dernière → non ; sinon search(s)
   *     search(s)           HTTP("fh/search", {s: s})
   *     loadContent(o)      HTTP("fh/get", o)
   *     onWheel(d)          window.scrollText(−10 × d)
   *
   * CE QUE LE SWF N'A PAS : le TEXTE de l'aide. Il vivait sur le serveur de
   * 2005, derrière ces deux adresses ; le portage le tient en base, et
   * l'administration l'y écrit (`/api/admin/gaspard/topics`).
   */
  /*
   * LA FENÊTRE, cadre par cadre. `win.Help` (0xbd7db) étend `win.Dialog` —
   * c'est donc l'écorce d'un salon, avec DEUX gélules au lieu de quatre :
   *
   *   init()                       flUserList = false ; flScreenList = false
   *                                super.init()   → initMainField, initInputField
   *                                nbUser = 2
   *                                genLeftIconList() ; displayLeftIconList()
   *
   *   genLeftIconList (0xbd8bc)    deux `butPush` de param `butPushSmallPink`,
   *                                `outline: 2`, `curve: 4` —
   *                                  image 3 → toggleScreenList (les bouilles)
   *                                  image 2 → toggleUserList   (les présents)
   *                                lefIconListHMaxThin  = 4 + 26 × 2  = 56
   *                                lefIconListHMaxLarge = 4 + 26 × ⌈2/3⌉ = 30
   *
   *   displayLeftIconList (0xbd9e5)  `basicIconList` min {w: 32, h: 0}, struct
   *                                limitée en x, cases de 24, écart 2, marge 2,
   *                                alignement « center », dans `margin.left`.
   *                                (Le salon écrit la même chose autrement —
   *                                cases de 22, écart 4, compo de 24 et marge
   *                                de 8 : PAS de 26 et 32 de large des deux
   *                                côtés. Les deux colonnes se dessinent donc
   *                                pareil, d'où la feuille de style partagée.)
   *
   *   initMainField (0xbddd9)      RÉÉCRIT celui du dialogue : là où le salon
   *                                pose un `multiTextField`, Gaspard pose un
   *                                cadre `showFrame` (type « h », min 200×200,
   *                                fond) contenant un `cpDocument` de style
   *                                « frSheet », min 200 × 200 lui aussi.
   *
   *   initInputField (0x68bee)     hérité tel quel : `inputField` sous la page,
   *                                marge `y.min = 6`, `y.ratio = 1`.
   *
   *   displayScreenList (0xbdd14)  `cpScreenList` min {w: 100, h: 200}, marge
   *                                12, dans `margin.left` — sous la colonne
   *                                d'icônes, qui se couche en rangée.
   *   displayUserList  (0xbdbc8)   `cpUserList` dans `margin.right`, marge 12.
   *
   * LE STYLE `frSheet` (Standard.as) donne la couleur des trois encres :
   *   color = [green, green, pink]
   *   s[0]  vert `#558811`, 10 px, retrait 6   → le corps et les liens
   *   s[2]  vert `#335511`, 12 px GRAS, retrait 2 → les intertitres, le retour
   *   s[4]  rose `#852929`, 15 px GRAS          → le titre de la page
   * et `Standard.getStyleSheet()` peint les liens en `#344D67`, soulignés au
   * survol seulement.
   */
  var GASPARD_ATTENTE = 2500;           // `analyseInput` : le pas entre deux recherches
  var GS_ICONE = 26;                    // le pas d'une gélule (24 de case + 2 d'écart)
  var gsPanneau = null;
  var gsEtat = { precedents: [], courant: null, charge: false, derniere: 0 };

  /*
   * LES MOTS SONT CEUX DE 2005 — `frutiparc/lang_french.as`, au caractère près :
   *
   *   help.title            « Gaspard - $t »
   *   help.name             « Gaspard »
   *   help.search           « Recherche »
   *   help.link             <a href="asfunction:win.box.getContent,$i">$n</a>
   *   help.link_back        « Précédent » - « Index de l'aide »
   *   help.link_type.cat_tree  « Rubriques : »
   *   help.link_type.cat_ls    « Dans cette rubrique : »
   *   help.link_type.seealso   « Voir également : »
   *   help.results_exact    « J'ai trouvé $n résultats correspondants… »
   *   help.results_similar  « J'ai trouvé $n résultats proches… »
   *   help.no_result        « Désolé, je n'ai rien trouvé… »
   *   help.contact_me       le conseil de recherche + l'adresse de Gaspard
   *   please_wait           « Veuillez patienter... »
   *
   * (Le portage avait inventé « Voir aussi » et « Les rubriques », qui
   * n'existaient pas, et un « retour » là où l'époque offre DEUX liens.)
   */
  // La bouille de Gaspard, celle du serveur (`HARDCODED_FRUTIZ`, server.js) :
  // douze paires en base 62, la première `0n` = 0×62 + 23, soit la FAMILLE 23
  // (public/fbouille/famille23.swf), et tout le reste à zéro.
  var GS_BOUILLE = '0n0000000000000000000000';
  var GS_MOTS = {
    nom: 'Gaspard',
    recherche: 'Recherche',
    attente: 'Veuillez patienter...',
    injoignable: 'L’accès au serveur Frutiparc semble impossible. '
      + 'Pensez à vérifier votre connexion internet.',
    resultats: {
      e: 'J’ai trouvé $n résultats correspondants à votre recherche :',
      s: 'J’ai trouvé $n résultats proches de votre recherche :',
    },
    rien: 'Désolé, je n’ai rien trouvé correspondant à votre recherche.',
    conseil: 'Essayez de faire une recherche plus large : indiquez un seul mot '
      + 'plutôt qu’une phrase. Par exemple, cherchez <i>titems</i> plutôt que '
      + '<i>C’est quoi les titems ?</i>. Vérifiez également l’orthographe.'
      + '<br/><br/>Si vous avez besoin de <b>support technique</b>, vous pouvez '
      + 'envoyer un mail à : '
      + '<a href="mailto:gaspard@frutiparc.com">gaspard@frutiparc.com</a>',
    groupes: {
      cat_tree: 'Rubriques :',
      cat_ls: 'Dans cette rubrique :',
      seealso: 'Voir également :',
    },
  };
  // « error.http.<k> », les motifs que le serveur peut renvoyer (0x8045e).
  var GS_ERREURS = {
    1: 'Une erreur inconue s’est produite sur le serveur (HTTP)',
    2: 'Action non autorisée',
    3: 'Requête non valide',
    4: 'Une erreur s’est produite sur le serveur',
    5: 'Cette action vous est interdite pour le moment',
  };

  function panneauGaspard() {
    if (gsPanneau) return gsPanneau;
    var p = document.createElement('section');
    p.className = 'panel';
    p.id = 'gaspard-panel';

    // `displayLeftIconList` : la colonne, dans `margin.left`.
    var icones = document.createElement('div');
    icones.className = 'gs-icones';
    icones.appendChild(gelule('ecrans', 'Afficher les bouilles'));
    icones.appendChild(gelule('users', 'Afficher les frutiz présents'));
    p.appendChild(icones);

    // `displayScreenList` : la pile des bouilles, sous la colonne. Fermée à
    // l'ouverture (`flScreenList = false`).
    var ecrans = document.createElement('div');
    ecrans.className = 'gs-ecrans';
    p.appendChild(ecrans);

    // `main` : la page, puis la ligne de saisie.
    var page = document.createElement('div');
    page.className = 'gs-page';
    p.appendChild(page);
    var bas = document.createElement('div');
    bas.className = 'gs-saisie';
    var champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'gs-in';
    champ.setAttribute('aria-label', 'Poser une question à Gaspard');
    bas.appendChild(champ);
    p.appendChild(bas);

    // `displayUserList` : les présents, dans `margin.right`. Fermée elle aussi.
    var users = document.createElement('div');
    users.className = 'gs-users';
    users.innerHTML = '<div class="gs-ul-fleche haut"></div>'
      + '<div class="gs-ul-boite"><div class="gs-ul-defile"></div></div>'
      + '<div class="gs-ul-fleche bas"></div>';
    p.appendChild(users);

    // `onEnter` : la saisie part, et ne se vide QUE si elle est partie.
    champ.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      if (analyserSaisieGaspard(champ.value)) champ.value = '';
    });
    // `onWheel` : la molette fait défiler la page, pas la fenêtre.
    page.addEventListener('wheel', function (ev) {
      if (page.scrollHeight <= page.clientHeight) return;
      ev.stopPropagation();
    });
    // Un lien de la page : une rubrique, le précédent, ou l'index.
    page.addEventListener('click', function (ev) {
      var a = ev.target.closest ? ev.target.closest('a[data-gs]') : null;
      if (!a) return;
      ev.preventDefault();
      var quoi = a.getAttribute('data-gs');
      if (quoi === 'precedent') pagePrecedenteGaspard();
      else if (quoi === 'index') contenuGaspard();
      else contenuGaspard(Number(quoi));
    });
    // Les deux gélules.
    icones.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('.icon-btn') : null;
      if (!b) return;
      basculerPanneauGaspard(b.getAttribute('data-gs-but'));
    });

    gsPanneau = p;
    return p;
  }

  // Une gélule de la colonne : le même bouton que le salon, au même dessin.
  function gelule(quoi, titre) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn gs-but-' + quoi;
    b.setAttribute('data-gs-but', quoi);
    b.title = titre;
    b.setAttribute('aria-label', titre);
    return b;
  }

  /*
   * `toggleScreenList` (0xbdc67) et `toggleUserList` (0xbdb4d).
   *
   * Le premier fait DEUX choses : il pose (ou retire) la pile des bouilles, et
   * il change le minimum de la colonne d'icônes — `lefIconListHMaxLarge` quand
   * la pile est là (30 : les gélules se couchent en rangée pour lui laisser la
   * hauteur), `lefIconListHMaxThin` sinon (56 : elles se remettent debout).
   * Les deux finissent par `frameSet.update()`, qui RELÈVE le minimum de la
   * fenêtre — d'où `appliquerMinimum`, comme au salon.
   */
  function basculerPanneauGaspard(quoi) {
    var p = panneauGaspard();
    var ouvert = p.classList.toggle(quoi === 'ecrans' ? 'gs-a-ecrans' : 'gs-a-users');
    var b = p.querySelector('.gs-but-' + quoi);
    if (b) b.classList.toggle('on', ouvert);
    if (quoi === 'ecrans') p.querySelector('.gs-icones').classList.toggle('en-rangee', ouvert);
    var f = fenetres['gaspard-panel'];
    if (f) appliquerMinimum(f);
    if (quoi === 'ecrans') majEcransGaspard();
    else majPresentsGaspard();
  }

  /*
   * LE MINIMUM DE LA FENÊTRE, par le même chemin que celui du salon —
   * `Frame.updateMinInt` remonte l'arbre que `win.Help` a bâti :
   *
   *   margin.left   colonne d'icônes   min {w: 32}, hauteur 56 debout / 30 couchée
   *                 cpScreenList       min {w: 100, h: 200}, marge 12
   *   main (« w »)  showFrame          min {w: 200, h: 200}
   *                 inputField         14 de haut, marge 6
   *   margin.right  cpUserList         min {w: 122, h: 100}, marge 12
   *
   * Les 8 px de chrome en largeur et les 28 en hauteur sont ceux relevés au
   * pixel sur la fenêtre de salon (12 de cadre, 16 de bandeau) : c'est la même
   * écorce. Nue, la fenêtre s'ouvre donc à 240 × 248.
   */
  function minGaspard() {
    var p = gsPanneau;
    var ecrans = !!(p && p.classList.contains('gs-a-ecrans'));
    var users = !!(p && p.classList.contains('gs-a-users'));
    var gauche = { w: ecrans ? 112 : 32, h: ecrans ? 30 + 200 + 12 : 4 + GS_ICONE * 2 };
    var milieu = { w: 200, h: 200 + 6 + 14 };
    var droite = { w: users ? 134 : 0, h: users ? 100 : 0 };
    return {
      w: Math.max(202, 8 + gauche.w + milieu.w + droite.w),
      h: 28 + Math.max(milieu.h, gauche.h, droite.h),
    };
  }

  /*
   * LES PRÉSENTS — `nbUser = 2`, et `box.Help.init` (0x7fdf6) dit lesquels :
   *
   *     if (me.logged) userList.addUser(me.name);
   *     userList.addUser(Lang.fv("help.name"));
   *
   * soit le joueur puis Gaspard, dans cet ordre. La bande est le `userSlot`
   * (#261) du salon, et l'alternance des fonds suit la même règle : une ligne
   * sur deux seulement porte le dessin.
   */
  function gensDeGaspard() {
    var moi = (window.state && window.state.user) || '';
    var gens = [];
    if (moi) gens.push(moi);
    gens.push(GS_MOTS.nom);
    return gens;
  }
  // LA BANDE EST CELLE DU SALON, pas une imitation : `cp.UserList` monte le
  // même `userSlot` partout où il y a des présents, et le light sait déjà la
  // fabriquer (`ligneConnecte`). On la lui demande — d'où le voyant, la
  // couleur du genre et le clic vers la fiche, que la version d'ici n'avait
  // pas. Gaspard, lui, n'a pas de fiche : son nom renvoie sur SA fenêtre,
  // comme `chatMng.open` (openFunctions.as).
  function majPresentsGaspard() {
    var p = gsPanneau;
    if (!p || !p.classList.contains('gs-a-users')) return;
    var liste = p.querySelector('.gs-ul-defile');
    if (!liste) return;
    var S = window.SalonsBureau;
    liste.textContent = '';
    gensDeGaspard().forEach(function (nom) {
      var d = (S && S.ligne) ? S.ligne(nom) : null;
      if (!d) {
        d = document.createElement('div');
        d.className = 'u';
        d.innerHTML = '<span class="nom"></span>';
        d.querySelector('.nom').textContent = nom;
      }
      if (estGaspard(nom)) {
        d.title = 'Parler à ' + GS_MOTS.nom;
        d.addEventListener('click', function (ev) {
          ev.stopImmediatePropagation();
          ouvrirGaspard();
        }, true);
      }
      liste.appendChild(d);
    });
  }
  // LA BOUILLE DE QUELQU'UN, dans l'ordre où le light la connaît : celle du
  // carnet de session d'abord (un accessoire posé en cours de route y arrive
  // par la trace `<z>`), et pour SOI celle que la tuile d'accueil montre déjà
  // — c'est la même règle que `refreshHomeAvatar`. À défaut, le sac à patates.
  function bouilleDeGaspard(pseudo) {
    var cle = String(pseudo).toLowerCase();
    // LUI, il n'est dans aucun carnet : il n'a pas de compte. Sa bouille est
    // celle que le serveur garde en dur (HARDCODED_FRUTIZ) et sert au SWF —
    // douze paires en base 62 dont la première vaut 23 : la FAMILLE 23, le
    // rouquin à la feuille, tout le reste à zéro. On la montrait en sac à
    // patates faute de la chercher.
    if (cle === GS_MOTS.nom.toLowerCase()) return GS_BOUILLE;
    var carnet = (window.state && window.state.bouilleByUser) || {};
    if (carnet[cle]) return carnet[cle];
    var moi = String((window.state && window.state.user) || '').toLowerCase();
    if (cle === moi) {
      var c = document.querySelector('#home-avatar canvas.fp-bvig');
      var s = c && c.getAttribute('data-s');
      if (s) return s;
    }
    return '000000010000000000000000';
  }

  // LES BOUILLES — `cp.ScreenList` empile un écran carré par personne, au pas
  // de `size + 2`. À deux, elles tiennent toujours : le mode CLB (l'aquarium)
  // ne se déclenche jamais ici.
  function majEcransGaspard() {
    var p = gsPanneau;
    if (!p || !p.classList.contains('gs-a-ecrans')) return;
    var col = p.querySelector('.gs-ecrans');
    if (!col) return;
    var vus = {};
    gensDeGaspard().forEach(function (nom) {
      var cle = String(nom).toLowerCase();
      vus[cle] = true;
      var ecran = col.querySelector('.bo-ecran[data-qui="' + cleCss(cle) + '"]');
      if (!ecran) {
        ecran = document.createElement('div');
        ecran.className = 'bo-ecran';
        ecran.setAttribute('data-qui', cle);
        col.appendChild(ecran);
      }
      poserBouille(ecran, bouilleDeGaspard(nom), nom, 0);
    });
    Array.prototype.slice.call(col.querySelectorAll('.bo-ecran')).forEach(function (e) {
      if (!vus[e.getAttribute('data-qui')]) e.remove();
    });
  }

  // `analyseInput` (0x806f3), au mot près : rien à envoyer si la saisie est
  // vide, rien non plus si la précédente a moins de 2500 ms. Le compteur ne
  // se remet à zéro QUE lorsqu'une recherche part réellement.
  function analyserSaisieGaspard(brut) {
    var s = String(brut || '').replace(/^\s+|\s+$/g, '');
    if (!s.length) return false;
    var t = Date.now();
    if (!(t - gsEtat.derniere > GASPARD_ATTENTE)) return false;
    gsEtat.derniere = t;
    chercherGaspard(s);
    return true;
  }

  // `getContent(id)` (0x7ff27) : sans argument c'est l'INDEX (`id = 1`), et la
  // page courante entre dans la pile avant qu'on parte.
  function contenuGaspard(id) {
    if (id === undefined) id = 1;
    if (gsEtat.courant) gsEtat.precedents.push(gsEtat.courant);
    chargerGaspard({ i: id });
  }
  // `getPrevious()` : on ne dépile que s'il y a de quoi.
  function pagePrecedenteGaspard() {
    if (!gsEtat.precedents.length) return;
    chargerGaspard(gsEtat.precedents.pop());
  }

  function urlGaspard(base, params) {
    var q = [];
    for (var k in params) if (params[k] !== undefined && params[k] !== null) {
      q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
    return base + (q.length ? '?' + q.join('&') : '');
  }

  // `loadContent(o)` (0x8032b) : la fenêtre affiche l'attente, puis
  // `HTTP("fh/get", o)`. Le TITRE ne bouge pas ici — c'est `onGetContent` qui
  // le pose, une fois la page arrivée.
  function chargerGaspard(o) {
    gsEtat.courant = o;
    gsEtat.charge = true;
    attendreGaspard();
    lireXmlGaspard(urlGaspard('/fh/get', o), function (doc) {
      gsEtat.charge = false;
      if (!doc) return erreurGaspard(GS_MOTS.injoignable);
      var h = doc.documentElement;
      // `onGetContent` : la racine doit s'appeler `h` et n'avoir aucun `k`.
      if (!h || h.nodeName !== 'h' || h.getAttribute('k') !== null) {
        var k = (h && h.getAttribute('k')) || 1;
        return erreurGaspard(GS_ERREURS[k] || GS_ERREURS[1]);
      }
      var groupes = {};                 // t → [ {i, n}, … ], dans l'ordre du XML
      var ordre = [];
      var corps = '';
      var enfants = h.childNodes;
      for (var i = 0; i < enfants.length; i++) {
        var e = enfants[i];
        if (e.nodeType !== 1) continue;
        if (e.nodeName === 'c') { corps = e.textContent || ''; continue; }
        if (e.nodeName !== 'l') continue;
        var dedans = e.childNodes;
        for (var j = 0; j < dedans.length; j++) {
          var l = dedans[j];
          if (l.nodeType !== 1) continue;
          var t = l.getAttribute('t') || '';
          if (!groupes[t]) { groupes[t] = []; ordre.push(t); }
          groupes[t].push({ i: Number(l.getAttribute('i')), n: l.getAttribute('n') || '' });
        }
      }
      afficherGaspard({
        id: Number(h.getAttribute('i')),
        titre: h.getAttribute('n') || '',
        corps: corps,
        groupes: groupes,
        ordre: ordre,
        retour: gsEtat.precedents.length > 0,
      });
    });
  }

  // `search(s)` (0x800b3) : même attente, `HTTP("fh/search", {s: s})`. Le titre
  // devient « Gaspard - Recherche » DÈS LE RETOUR, avant même le dépouillement.
  function chercherGaspard(s) {
    gsEtat.charge = true;
    attendreGaspard();
    lireXmlGaspard(urlGaspard('/fh/search', { s: s }), function (doc) {
      gsEtat.charge = false;
      if (!doc) return erreurGaspard(GS_MOTS.injoignable);
      titrerGaspard(GS_MOTS.recherche);
      var r = doc.documentElement;
      var n = Number(r && r.getAttribute('n'));
      // `onSearch` : moins d'un résultat, on le dit ; un seul, on l'ouvre.
      if (!(n >= 1)) return sansResultatGaspard();
      var liste = [];
      var enfants = r.childNodes;
      for (var i = 0; i < enfants.length; i++) {
        var e = enfants[i];
        if (e.nodeType !== 1) continue;
        liste.push({ i: Number(e.getAttribute('i')), n: e.getAttribute('n') || '' });
      }
      if (n === 1 && liste.length) return contenuGaspard(liste[0].i);
      resultatsGaspard(n, (r.getAttribute('m') || '') === 'e', liste);
    });
  }

  function lireXmlGaspard(url, suite) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var doc = null;
      try {
        doc = x.responseXML
          || new DOMParser().parseFromString(x.responseText || '', 'text/xml');
        if (doc && doc.getElementsByTagName('parsererror').length) doc = null;
      } catch (e) { doc = null; }
      suite(x.status >= 200 && x.status < 300 ? doc : null);
    };
    try { x.send(); } catch (e) { suite(null); }
  }

  // ── Ce que la fenêtre montre ──────────────────────────────────────────
  // `displayContent` (0xbdef4) empile des LIGNES DE TEXTE dans le document, et
  // chacune porte son style : le titre en `sid: 4` (rose, 15 gras), le corps
  // et les liens sans `sid` (vert, 10), les intertitres et le retour en
  // `sid: 2` (vert foncé, 12 gras).
  function pageGaspard() {
    var p = panneauGaspard();
    var page = p.querySelector('.gs-page');
    page.textContent = '';
    return page;
  }
  function ligneGaspard(page, cls, html) {
    var d = document.createElement('div');
    d.className = 'gs-l ' + cls;
    d.innerHTML = html;
    page.appendChild(d);
    return d;
  }
  function echapperGaspard(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // `help.link` : <a href="asfunction:win.box.getContent,$i">$n</a>
  function lienGaspard(l) {
    return '<a href="#" data-gs="' + l.i + '">' + echapperGaspard(l.n) + '</a>';
  }
  // `help.link_back` : DEUX liens séparés d'un tiret — `getPrevious` et
  // `getContent` sans argument, qui ramène à l'index.
  var GS_RETOUR = '<a href="#" data-gs="precedent">Précédent</a> - '
    + '<a href="#" data-gs="index">Index de l’aide</a>';

  // `displayWait` (0xbe2a8) : une seule ligne, en `sid: 2`. Le bandeau garde
  // le nom de la page qu'on quitte — le SWF ne le retitre pas ici.
  function attendreGaspard() {
    ligneGaspard(pageGaspard(), 'gs-groupe', echapperGaspard(GS_MOTS.attente));
  }
  // `openErrorAlert` : une ALERTE, pas une ligne dans la page. La page reste
  // sur ce qu'elle montrait — d'époque `displayWait` l'a déjà vidée, on fait
  // pareil, l'alerte se pose par-dessus.
  function erreurGaspard(txt) {
    ligneGaspard(pageGaspard(), 'gs-groupe', echapperGaspard(GS_MOTS.attente));
    alerte('', txt);
  }
  function afficherGaspard(o) {
    var page = pageGaspard();
    ligneGaspard(page, 'gs-titre', echapperGaspard(o.titre));
    ligneGaspard(page, 'gs-corps', o.corps || '');
    for (var i = 0; i < o.ordre.length; i++) {
      var t = o.ordre[i];
      var g = o.groupes[t];
      if (!g || !g.length) continue;    // `if (arr.length == 0) continue`
      ligneGaspard(page, 'gs-groupe', echapperGaspard(GS_MOTS.groupes[t] || t));
      for (var j = 0; j < g.length; j++) ligneGaspard(page, 'gs-lien', lienGaspard(g[j]));
    }
    if (o.retour) ligneGaspard(page, 'gs-retour', GS_RETOUR);
    page.scrollTop = 0;
    titrerGaspard(o.titre);
  }
  // `displayResult({nb, method, list})` (0xbe3c0) : l'intertitre porte le
  // COMPTE, et la méthode dit s'il est exact — `m == "e"`, la lettre seule.
  function resultatsGaspard(nb, exact, liste) {
    var page = pageGaspard();
    ligneGaspard(page, 'gs-groupe',
      echapperGaspard(GS_MOTS.resultats[exact ? 'e' : 's'].replace('$n', nb)));
    for (var i = 0; i < liste.length; i++) ligneGaspard(page, 'gs-lien', lienGaspard(liste[i]));
    ligneGaspard(page, 'gs-retour', GS_RETOUR);
    page.scrollTop = 0;
  }
  // `displayNoResult` (0xbe6b0) : l'excuse, le conseil, puis le retour.
  function sansResultatGaspard() {
    var page = pageGaspard();
    ligneGaspard(page, 'gs-groupe', echapperGaspard(GS_MOTS.rien));
    ligneGaspard(page, 'gs-corps', GS_MOTS.conseil);
    ligneGaspard(page, 'gs-retour', GS_RETOUR);
    page.scrollTop = 0;
  }
  // `setTitle(Lang.fv("help.title", {t: …}))` : « Gaspard - $t ».
  function titrerGaspard(t) {
    var f = fenetres['gaspard-panel'];
    if (f) f.txt.textContent = 'Gaspard - ' + t;
  }

  /*
   * LA RANGÉE DE L'ENCART, telle que `initIcons` la câble.
   *
   * Trois gestes, trois méthodes, et le light n'en branchait aucun sur la
   * première icône : l'aide n'a pas de rubrique mobile, son bouton restait
   * donc muet. Ici il ouvre Gaspard, comme `select(0)`.
   *
   *     onPress     → _parent.select(id)
   *     onRollOver  → _parent.rollOver(id)  →  field.text = nameList[id]
   *     onRollOut   → _parent.rollOut(id)   →  field.text = ladderPos
   *
   * Le champ, c'est celui du RANG (le chiffre sous la coupe) : survoler une
   * icône y écrit le nom de la rubrique, en sortir y remet le classement.
   */
  var GS_NOMS = {                       // `nameList`, après le retournement
    Aide: 'gaspard', Forum: 'forum', Mail: 'messages',
    Historique: 'historique', Warning: 'evenements', Jeux: 'jeux',
  };
  /*
   * LES NEUF BARRES D'XP DE L'ENCART — DEUX BOÎTES PEINTES, ET NON NEUF.
   *
   * `barLevel` (#431) découpe la progression du niveau en neuf filets de 2 px
   * séparés de 1 : un pas de 3, vingt-six px en tout. Le portage en faisait
   * neuf éléments, et la mise en page était JUSTE — relevé au banc, dpr = 1 :
   * neuf boîtes de 2 px aux ordonnées 0, 3, 6 … 24, huit écarts de 1.
   *
   * Mais un écran DENSE ne peint pas des pixels CSS. À dpr 1,5 un filet de 2
   * vaut 3 rangées d'écran et un écart 1,5 : le navigateur cale chaque boîte
   * séparément, et le relevé (bench-xp2, capture à la résolution de l'écran)
   * donne 2, 3, 2, 3, 2, 3… — une barre sur deux la moitié plus épaisse. À
   * 1,25 et à 2, même chose sur d'autres rangs. C'est ce qu'on voit à l'œil,
   * et ce n'était pas une impression.
   *
   * Le remède ne peut pas être un réglage de plus sur neuf boîtes : tant
   * qu'elles sont neuf, elles se calent neuf fois. On les remplace donc par
   * DEUX SURFACES peintes d'un dégradé répété, que le navigateur rastérise
   * d'un seul tenant — le rythme y est alors le même d'un bout à l'autre,
   * quelle que soit la densité :
   *
   *   · le fond du composant   les neuf filets VIDES  (#A2EB56)
   *   · `::after`              les filets PLEINS (#73B01E), une boîte ancrée
   *                            EN BAS dont la hauteur vaut le nombre de
   *                            barres pleines — le remplissage monte du bas,
   *                            comme d'époque
   *   · `::before`             la barre EN COURS, la seule qui soit partielle
   *                            (cf. `setHomeProgress` : une seule à la fois)
   *
   * Il ne reste qu'à donner à la feuille de style ce que le light a calculé.
   * On le lit sur les neuf éléments eux-mêmes (leur `--f`), sans toucher au
   * calcul : le gabarit tactile garde ses neuf boîtes et son rendu.
   */
  function brancherBarresXp() {
    // L'ENCART N'EST PAS ENCORE DANS LE COIN à cet instant : il est emprunté au
    // gabarit tactile et reparenté plus tard (même piège que la rangée
    // d'icônes, cf. `brancherRangeeEncart`). On vise donc le document, où le
    // nœud existe depuis le premier rendu.
    var boite = $('#home-progress');
    if (!boite || boite._xpBranche) return;
    boite._xpBranche = true;
    var relire = function () {
      var barres = boite.querySelectorAll('i');
      if (!barres.length) return;
      // Le DOM va du haut vers le bas, le remplissage du bas vers le haut :
      // on compte donc à rebours.
      var pleines = 0, partielle = 0, rangPartiel = -1;
      for (var i = barres.length - 1; i >= 0; i--) {
        var f = parseFloat(barres[i].style.getPropertyValue('--f')) || 0;
        if (f >= 99.95) { pleines++; continue; }
        if (f > 0) { partielle = f; rangPartiel = barres.length - 1 - i; }
        break;
      }
      boite.style.setProperty('--xp-pleines', pleines);
      boite.style.setProperty('--xp-part', partielle + '%');
      // L'ordonnée de la barre en cours, comptée depuis le BAS : la première
      // au-dessus des pleines.
      boite.style.setProperty('--xp-part-bas',
        (rangPartiel < 0 ? -10 : rangPartiel * 3) + 'px');
    };
    relire();
    // Le light réécrit les `--f` à chaque relevé de profil : on repasse
    // derrière lui, sans lui demander de nous prévenir.
    new MutationObserver(relire).observe(boite, {
      attributes: true, attributeFilter: ['style'], subtree: true,
    });
  }

  function brancherRangeeEncart(coin) {
    if (!coin || coin._rangeeBranchee) return;
    coin._rangeeBranchee = true;
    // On écoute LE COIN, pas la rangée : l'encart est emprunté au mobile et
    // reparenté ici plus tard, la rangée n'existe pas encore à cet instant.
    var quelBouton = function (ev) {
      return ev.target && ev.target.closest ? ev.target.closest('.mb-shortcuts .sc-btn') : null;
    };
    var champDuRang = function () { return coin.querySelector('.enc-trophy .val'); };
    var rang = null;                    // `ladderPos`, retenu à l'entrée
    coin.addEventListener('mouseover', function (ev) {
      var b = quelBouton(ev);
      var champ = champDuRang();
      if (!b || !champ) return;
      if (rang === null) rang = champ.textContent;
      champ.textContent = GS_NOMS[b.getAttribute('data-sc')] || '';
      champ.classList.add('gs-survol');
    });
    coin.addEventListener('mouseout', function (ev) {
      var champ = champDuRang();
      if (!champ || rang === null) return;
      // Passer d'une icône à l'autre ne repasse pas par le rang : on ne le
      // rend qu'en QUITTANT la rangée pour de bon.
      var vers = ev.relatedTarget;
      if (vers && vers.closest && vers.closest('.mb-shortcuts')) return;
      champ.textContent = rang;
      rang = null;
      champ.classList.remove('gs-survol');
    });
    coin.addEventListener('click', function (ev) {
      var b = quelBouton(ev);
      if (!b || b.getAttribute('data-sc') !== 'Aide') return;
      ev.preventDefault();
      ev.stopPropagation();
      ouvrirGaspard();
    });
  }

  // `select(0)` → `uniqWinMng.open("help")`. La fenêtre s'ouvre sur la page
  // d'accueil, `loadContent({i: 1})`, à la PREMIÈRE ouverture seulement : la
  // rouvrir la rappelle telle qu'on l'a laissée (`Box.init` prend sa branche
  // `else`, elle ne se recharge pas). `box.Help.init` charge SANS empiler —
  // `loadContent` directement, pas `getContent` : l'index n'est pas un
  // « précédent » de lui-même.
  function ouvrirGaspard() {
    var neuve = !fenetres['gaspard-panel'];
    // Fermer, c'est `uniqWinMng.unsetBox("help")` : la boîte s'en va tout
    // entière. Rouvrir en construit une NEUVE — `previousArr = []`,
    // `lastSearchTimer = 0`, `flUserList` et `flScreenList` à faux. Le portage
    // garde le même nœud de panneau ; on lui rend donc son état de naissance.
    if (neuve && gsPanneau) {
      gsEtat.precedents = [];
      gsEtat.courant = null;
      gsEtat.derniere = 0;
      ['gs-a-ecrans', 'gs-a-users'].forEach(function (c) { gsPanneau.classList.remove(c); });
      gsPanneau.querySelector('.gs-icones').classList.remove('en-rangee');
      Array.prototype.slice.call(gsPanneau.querySelectorAll('.icon-btn'))
        .forEach(function (b) { b.classList.remove('on'); });
    }
    ouvrirFenetre('gaspard');
    // Ses écrans sont ceux d'un salon : mêmes gestes, même bulle de survol.
    var f = fenetres['gaspard-panel'];
    if (f) brancherEcrans(f);
    if (!neuve) return;
    titrerGaspard(GS_MOTS.attente);     // le titre du constructeur (0x7fcfa)
    chargerGaspard({ i: 1 });
  }

  function ouvrirFenetre(tab) {
    // Le forum n'est pas une fenêtre du bureau : `win.Forum` renvoie vers
    // l'extérieur (cf. `ouvrirForum`). Quel que soit le chemin qui mène ici —
    // une tuile, un lien profond, `apresActivateTab` — il sort de la page.
    if (tab === 'forum') return ouvrirForum();
    // « Le salon » n'est pas une fenêtre non plus : c'est une par salon.
    if (tab === 'chat') return ouvrirSalon(salonCourant());
    var rub = RUBRIQUES[tab];
    if (!rub) return;
    // « Salons publics » n'a pas de panneau mobile à emprunter : on le bâtit
    // au premier appel et on le range dans #app, hors écran tant qu'il n'est
    // pas `.active` — c'est de là que le reparentage le prendra, et c'est là
    // qu'il retournera à la fermeture.
    if (tab === 'salons' && !$(rub.panneau)) $('#app').appendChild(panneauSalons());
    // Idem pour « Recherche » : elle non plus n'a pas de panneau mobile.
    if (tab === 'recherche' && !$(rub.panneau)) $('#app').appendChild(panneauRecherche());
    // Et pour Gaspard : le mobile n'a pas d'aide, son icône y est muette.
    if (tab === 'gaspard' && !$(rub.panneau)) $('#app').appendChild(panneauGaspard());
    var panneau = $(rub.panneau);
    if (!panneau) return;
    // Les panneaux de salon portent tous le même identifiant (ce sont des
    // copies) : c'est la rubrique qui donne la clé de leur fenêtre.
    var cle = rub.cle || panneau.id;
    var f = fenetres[cle];
    if (!f) {
      f = creerFenetre(rub, panneau, cle);
      fenetres[cle] = f;
      if (rub.salon) {
        f.salon = rub.salon;
        // La colonne d'icônes appartient à la MARGE GAUCHE de la fenêtre, pas
        // à un bandeau au-dessus : `displayLeftIconList` (0x69384) la pose
        // dans `margin.left`, et la pile des bouilles vient dessous quand elle
        // s'ouvre. Le cadre l'apporte déjà, en tête de panneau ; le bureau n'y
        // ajoute que son quatrième bouton.
        var topbar = panneau.querySelector('#topbar');
        if (topbar && !topbar.querySelector('#chat-warning')) topbar.appendChild(warningSalon());
        brancherBouillesSalon(f);
      }
    } else if (f.onglet) {
      // Déjà en onglet : on y va.
      activerSlot(f.onglet);
    } else {
      premierPlan(f.fen);
    }
    // Le bureau reçoit la fenêtre alors qu'un ONGLET a la main : d'époque il
    // ne se met pas au premier plan tout seul, il AVERTIT — `FPDesktop.addBox`
    // fait `if(!this.flActive) this.warning()`, et l'onglet « Bureau »
    // clignote jusqu'à ce qu'on le rappelle.
    if (!f.onglet) avertirSlot('bureau');
    // #evt-panel sert deux rubriques : la fenêtre prend le titre demandé.
    f.txt.textContent = rub.titre;
    f.pastille.style.backgroundImage = 'url(' + fruitUrl(rub.fruit) + ')';
    // La messagerie prend son écorce d'explorateur AVANT le premier listing :
    // sans quoi la fenêtre s'ouvrirait un instant en habits de mobile.
    if (tab === 'mail') habillerMail(panneau);
    if (tab === 'boutique') habillerBoutique(panneau);
    if (tab === 'reglages') habillerReglages(panneau);
    panneau.classList.add('active');
    if (rub.salon) { majTitreSalon(rub.salon); majBouilles(panneau); }
  }

  // ── Les crochets appelés par light.html ───────────────────────────────
  // À la fin d'activateTab : la rubrique demandée s'ouvre en fenêtre, et les
  // panneaux DÉJÀ fenêtrés restent visibles (activateTab n'en laisse qu'un
  // actif — l'invariant du plein écran, qui ne vaut plus ici).
  function apresActivateTab(tab) {
    if (!actif) return;
    ouvrirFenetre(tab);
    for (var id in fenetres) fenetres[id].panneau.classList.add('active');
  }

  // ═══ LA FRUTIMANDALA ═════════════════════════════════════════════════
  // `cp.WheelMng` (DoInitAction 0x6a7c2) n'est pas un décor : c'est un
  // TOURNE-DISQUE à deux faces. Le clip cpWheelMng (#640) pose, dans cet
  // ordre de profondeurs :
  //
  //      1  mask   (#609)   le châssis — et le masque du cadran
  //      3         (#613)   le fond du cadran
  //      8  inside (#407)   le CONTENEUR des roues (vide dans le SWF)
  //   12/14        (#618, #623)   les deux triangles rouges
  //   17/21        (#629, #635)   l'échange (« G ») et la validation
  //     25  cadran (#639)   le verre
  //
  // `init` pose `list = ["whDayNight", "whFruitMonth"]` puis appelle
  // `swapWheel()` : `currentPos` passe de 0 à 1 — c'est donc la roue des
  // FRUTISIGNES qui s'affiche en premier, et le bouton du bas-gauche
  // (`pressSwap`) fait tourner l'autre à sa place.
  var MD_L = 200, MD_H = 80;              // le dessin du châssis
  var MD_DX = 6.3, MD_DY = 4.35;          // …dont l'origine du clip est à −6,3 ; −4,35
  // `inside` est posé à (1862 ; −750) twips dans le clip : le CENTRE des deux
  // cadrans, à 99,4 du bord gauche du dessin et 33,15 AU-DESSUS de son haut.
  // Seule la calotte basse des roues se voit donc dans la fenêtre.
  var MD_CX = 93.1 + MD_DX, MD_CY = -37.5 + MD_DY;
  // Le clip nommé `mask` (#609, profondeur 1) DÉCOUPE les cadrans : la
  // feuille de style s'en sert en `mask-image`, à l'échelle du dessin.
  var MD_RAY = 100;                       // `ray` : la roue entre par la gauche, à −2·ray
  // Les quatre boutons, aux places du clip (plus l'origine du dessin) et à la
  // taille de leur état UP.
  var MD_BOUTONS = [
    { cle: 'mandalaGauche', x: 0.75, y: 21.7, l: 19.25, h: 20, act: 'pressLeft',
      titre: '' },
    { cle: 'mandalaDroite', x: 167.15 + 0.1, y: 21.8, l: 19.25, h: 20, act: 'pressRight',
      titre: '' },
    { cle: 'mandalaSwap', x: 0.75, y: 43.7, l: 50.05, h: 20, act: 'pressSwap',
      titre: 'Changer de cadran' },
    { cle: 'mandalaValider', x: 136.35, y: 43.8, l: 50.1, h: 20, act: 'pressValidate',
      titre: 'Mode rapide' },
  ];
  // Les deux peaux, chargées d'ordinaire par `Wheel.loadSkin` depuis
  // /wheel/wheel<wheelId>.swf : ici, leurs dessins déjà sortis.
  var MD_ROUES = {
    whFruitMonth: { fichier: 'frutimandala-roue', x: -126.01, y: -125.99, l: 252.01, h: 252.01 },
    whDayNight: { fichier: 'frutimandala-jour', x: -102, y: -102, l: 204, h: 204 },
  };
  // La bande `police` (#47) de wheel0.swf : un glyphe par image. Chacun garde
  // sa LARGEUR propre — c'est de `mc._width` que `setNum` avance — et son bord
  // gauche, le même pour tous les chiffres (−3,8) sauf les deux-points.
  var MD_CHIFFRE = { x: -3.8, y: -5.25, l: 37.95, h: 34.55 };
  var MD_GLYPHES = {
    '0': { n: '0', w: 37.85 }, '1': { n: '1', w: 22.85 }, '2': { n: '2', w: 37.5 },
    '3': { n: '3', w: 37.55 }, '4': { n: '4', w: 37.5 }, '5': { n: '5', w: 37.5 },
    '6': { n: '6', w: 37.95 }, '7': { n: '7', w: 37.55 }, '8': { n: '8', w: 37.4 },
    '9': { n: '9', w: 37.5 }, ':': { n: 'deuxpoints', w: 19.2, x: -1.2 },
  };
  var MD_ECHELLE = 0.85;                  // `scale: 85` de l'objet d'init
  var MD_HEURE_Y = 52;                    // `_y: 52`, sous le centre du cadran

  var mandala = {
    boite: null, cadran: null, inside: null,
    liste: ['whDayNight', 'whFruitMonth'],
    pos: 0, dp: 0, roues: {},             // dp → { el, lien, art, display, heure, gx }
    tour: 0, accel: 0, flRoue: false, flSwap: false,
    anim: null, dernier: 0, aidHeure: null,
  };

  // `Wheel.setRot(deg) { this._rotation = deg }`, et `wheel.DayNight` y ajoute
  // `display._rotation = −deg` : le cadran tourne, l'heure reste droite.
  // `onBaseTurn` en dit autant pendant l'échange, où c'est `inside` qui vire :
  // `display._rotation = −(this._rotation + this._parent._rotation)`.
  mandala.poserRoue = function (r) {
    r.el.style.transform = 'translateX(' + r.gx.toFixed(2) + 'px) rotate('
      + r.rot.toFixed(2) + 'deg)';
    if (r.display) {
      r.display.style.transform = 'rotate(' + (-(r.rot + this.tour * 6)).toFixed(2) + 'deg)';
    }
  };

  mandala.setRot = function (r, deg) { r.rot = deg; this.poserRoue(r); };

  // `loadWheel(link)` : la roue s'attache à la profondeur 10000 − dp — la
  // NOUVELLE passe donc DESSOUS, et c'est l'ancienne qui s'efface au-dessus
  // d'elle. Première roue : elle entre en glissant depuis −2·ray. Les
  // suivantes : le plateau s'emballe (`animDisk`).
  mandala.loadWheel = function (lien) {
    this.dp += 1;
    var dp = this.dp;
    var conf = MD_ROUES[lien];
    var el = document.createElement('div');
    el.className = 'md-roue';
    el.style.zIndex = String(10000 - dp);
    var art = document.createElement('div');
    art.className = 'md-art';
    art.style.left = conf.x + 'px'; art.style.top = conf.y + 'px';
    art.style.width = conf.l + 'px'; art.style.height = conf.h + 'px';
    art.style.backgroundImage = 'url(/frutiz/sprites/' + conf.fichier + '.svg)';
    art.style.backgroundSize = conf.l + 'px ' + conf.h + 'px';
    el.appendChild(art);
    var r = { el: el, art: art, lien: lien, gx: 0, rot: 0, dp: dp, mort: false };
    // Le cadran JOUR/NUIT porte son afficheur : `display` (profondeur 30 de
    // wheel0.swf), posé à l'origine du disque, où `wheelInit` attache
    // `extGameNumb` sous le nom « hour ».
    if (lien === 'whDayNight') {
      r.display = document.createElement('div');
      r.display.className = 'md-display';
      r.heure = document.createElement('div');
      r.heure.className = 'md-heure';
      r.display.appendChild(r.heure);
      el.appendChild(r.display);
    }
    this.roues[dp] = r;
    this.inside.appendChild(el);
    if (this.flRoue) {
      this.tour = 2; this.accel = 0.3;
      this.sortante = this.roues[dp - 1] || null;
      this.flSwap = true;
      this.battre();
    } else {
      r.gx = -MD_RAY * 2;
      r.cible = 0;
      this.battre();
    }
    this.flRoue = true;
    if (lien === 'whDayNight') this.majJourNuit(r);
    else this.majFrutisigne(r);
    return r;
  };

  mandala.swapWheel = function () {
    this.pos = (this.pos + 1) % this.liste.length;
    this.loadWheel(this.liste[this.pos]);
  };

  // `pressSwap` : rien tant que l'échange court (`if (!flSwap) swapWheel()`).
  mandala.pressSwap = function () { if (!this.flSwap) this.swapWheel(); };
  // Les deux triangles rouges sont MUETS d'époque : `pressLeft` et
  // `pressRight` sont des fonctions vides. On les garde tels quels.
  mandala.pressLeft = function () {};
  mandala.pressRight = function () {};
  mandala.pressValidate = function () { basculerRepli(); };

  // `AnimList` bat toutes les 25 ms ; `tmod` mesure le temps réellement passé
  // en multiples de ce battement.
  mandala.battre = function () {
    var self = this;
    if (this.anim) return;
    this.dernier = 0;
    var pas = function (t) {
      self.anim = null;
      var tmod = self.dernier ? Math.min(4, (t - self.dernier) / 25) : 1;
      self.dernier = t;
      var encore = false;
      if (self.flSwap) { self.animDisk(tmod); encore = encore || self.flSwap; }
      if (self.glisser(tmod)) encore = true;
      if (encore) self.anim = requestAnimationFrame(pas);
    };
    this.anim = requestAnimationFrame(pas);
  };

  // `AnimList.slide` : regular = regular × r + pos × (1 − r), r = 0,8 ^ tmod.
  // Ici il n'y a qu'un axe à faire glisser, l'entrée de la première roue.
  mandala.glisser = function (tmod) {
    var encore = false;
    for (var dp in this.roues) {
      var r = this.roues[dp];
      if (r.cible === undefined) continue;
      var e = Math.pow(0.8, tmod);
      r.gx = r.gx * e + r.cible * (1 - e);
      if (Math.round(r.gx) === Math.round(r.cible)) { r.gx = r.cible; delete r.cible; }
      else encore = true;
      this.poserRoue(r);
    }
    return encore;
  };

  // `animDisk(mcIn, mcOut)` — le plateau s'emballe puis rend la main :
  //     accel −= tmod / 90 ;  r = (1 + accel) ^ tmod ;  turning ×= r
  //     inside._rotation = turning × 6
  //     r < 1 ? (l'ancienne roue encore là : turning ×= −1) et on la tue
  //           : mcOut._alpha = (r − 1) × 400
  //     |turning| < 0,1 → on s'arrête.
  mandala.animDisk = function (tmod) {
    this.accel -= tmod / 90;
    var r = Math.pow(1 + this.accel, tmod);
    this.tour *= r;
    this.inside.style.transform = 'rotate(' + (this.tour * 6).toFixed(2) + 'deg)';
    // `inside["wheel" + dp].onBaseTurn()` : la NOUVELLE roue redresse son
    // afficheur pendant que le plateau vire.
    var neuve = this.roues[this.dp];
    if (neuve) this.poserRoue(neuve);
    var s = this.sortante;
    if (r < 1) {
      // Le plateau a fini d'accélérer : l'ancienne roue s'en va, et le sens
      // s'INVERSE — le plateau se dévide jusqu'à revenir droit.
      if (s && !s.mort) {
        this.tour *= -1;
        s.mort = true;
        clearTimeout(s.aid);
        if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
        delete this.roues[s.dp];
      }
    } else if (s && !s.mort) {
      s.el.style.opacity = String(Math.min(1, (r - 1) * 4));
    }
    if (Math.abs(this.tour) < 0.1) {
      this.tour = 0;
      this.flSwap = false;
      this.sortante = null;
      // ÉCART assumé : d'époque `inside._rotation` garde sa dernière valeur
      // (jusqu'à 0,6°, `turning` valant encore moins de 0,1 quand la boucle
      // s'arrête) ; on le remet droit, ce qui ne se voit pas mais évite de
      // traîner un cadran de travers.
      this.inside.style.transform = 'rotate(0deg)';
      for (var k in this.roues) this.poserRoue(this.roues[k]);
    }
  };

  // ── LA ROUE DES FRUTISIGNES (wheel.FruitMonth #777, RunDate.getCurrentFSign
  // 0xbbf73). La loi d'époque, au chiffre près :
  //     t     = getTime() / 1000
  //     signe = floor(((t − 345600) / 604800) % 10)
  //     part  =      ((t − 345600) / 604800) % 1
  // 604800 s = UNE SEMAINE par signe, dix signes qui tournent ; 345600 = le
  // décalage d'origine (4 jours). Et update() pose la rotation :
  //     setRot((signe + part) × 36)   — 36° par signe, 360 pour le tour.
  // Vérifié : au moment de la capture de référence le signe était le KIWI,
  // et c'est bien le kiwi qui trône au centre du cadran, citron à sa gauche
  // et raisin à sa droite. `wheel.FruitMonth` se remet à jour toutes les
  // heures ; on suit la même cadence.
  mandala.majFrutisigne = function (r) {
    var t = Date.now() / 1000;
    var signe = Math.floor(((t - 345600) / 604800) % 10);
    var part = ((t - 345600) / 604800) % 1;
    this.setRot(r, (signe + part) * 36);
    var self = this;
    clearTimeout(r.aid);
    r.aid = setTimeout(function () { if (!r.mort) self.majFrutisigne(r); }, 3600000);
  };

  // ── LE CADRAN JOUR/NUIT (wheel.DayNight #800, 0x7d97f) ──────────────────
  //     dayCoef = (h + m / 60) / 24 ;  setRot(dayCoef × 360)
  // À minuit le disque est droit — la LUNE est en bas, dans la fenêtre ; à
  // midi il a fait un demi-tour et c'est le SOLEIL qu'on y voit. L'heure,
  // elle, s'écrit droite au centre : `display` contre-tourne d'autant.
  // `wheelInit` cale le premier réveil sur la MINUTE suivante
  // (`60 − getSeconds()`), puis passe à 60 s pile.
  mandala.majJourNuit = function (r) {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    this.setRot(r, ((h + m / 60) / 24) * 360);
    ecrireHeure(r.heure, (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m);
    var self = this;
    clearTimeout(r.aid);
    r.aid = setTimeout(function () {
      if (!r.mort) self.majJourNuit(r);
    }, (60 - d.getSeconds()) * 1000 + 500);
  };

  // `ext.game.Numb.setNum` — la classe partagée que la rustine
  // scripts/patch-main-heure-mandala.js a rendue à main.swf, et qui écrit
  // l'heure du cadran :
  //     un clip par caractère, `mc._x = x` puis `x += mc._width` ;
  //     `compteur._xscale = _yscale = scale` (85) ;
  //     `compteur._x = (−compteur._width / 2) × align` (align = 1).
  // La dernière ligne CENTRE la boîte d'encre, pas le texte : l'origine part
  // à −largeur/2 sans corriger le bord gauche du premier glyphe — l'écriture
  // penche donc de 3 px vers la gauche. C'est ainsi d'époque, on le garde.
  function ecrireHeure(el, txt) {
    if (!el) return;
    el.textContent = '';
    var x = 0, g0 = 1e9, g1 = -1e9, i, g, bx;
    for (i = 0; i < txt.length; i++) {
      g = MD_GLYPHES[txt.charAt(i)];
      if (!g) continue;
      bx = g.x === undefined ? MD_CHIFFRE.x : g.x;
      g0 = Math.min(g0, x + bx);
      g1 = Math.max(g1, x + bx + g.w);
      var img = document.createElement('i');
      img.style.left = (x + MD_CHIFFRE.x) + 'px';
      img.style.top = MD_CHIFFRE.y + 'px';
      img.style.backgroundImage = 'url(/frutiz/sprites/mandala-chiffre-' + g.n + '.svg)';
      el.appendChild(img);
      x += g.w;
    }
    if (g1 < g0) return;
    el.style.left = (-MD_ECHELLE * (g1 - g0) / 2).toFixed(2) + 'px';
  }

  function batirMandala() {
    var boite = document.createElement('div');
    boite.id = 'frutimandala';
    var cadran = document.createElement('div');
    cadran.className = 'md-cadran';
    var inside = document.createElement('div');
    inside.className = 'md-inside';
    inside.style.left = MD_CX + 'px';
    inside.style.top = MD_CY + 'px';
    cadran.appendChild(inside);
    var dessus = document.createElement('div');
    dessus.className = 'md-dessus';
    boite.appendChild(cadran);
    boite.appendChild(dessus);
    for (var i = 0; i < MD_BOUTONS.length; i++) {
      (function (b) {
        var but = document.createElement('button');
        but.type = 'button';
        but.className = 'md-but md-' + b.cle;
        but.style.left = (b.x + MD_DX) + 'px';
        but.style.top = (b.y + MD_DY) + 'px';
        but.style.width = b.l + 'px';
        but.style.height = b.h + 'px';
        if (b.titre) but.title = b.titre;
        but.addEventListener('click', function () { mandala[b.act](); });
        boite.appendChild(but);
      })(MD_BOUTONS[i]);
    }
    mandala.boite = boite;
    mandala.cadran = cadran;
    mandala.inside = inside;
    mandala.swapWheel();                  // `init` : la roue des frutisignes d'abord
    return boite;
  }

  // ═══ LE REPLI DE LA BARRE (MainBar.toggleHalfHide) ════════════════════
  //     hideHeight = 220
  //     replié   : pos.y = −220 ; frusion.jumpTo(−220) ; on attache
  //                `testRetour` à `_y = hideHeight` — donc au ras du haut de
  //                l'écran — invisible jusqu'à la fin du glissement
  //                (`endMove` le rend visible) ;
  //     déplié   : testRetour.removeMovieClip() ; pos.y = 0 ; frusion.jumpTo(0)
  //     puis     : animList.addSlide("barSlide", this, …, 2)  — la barre
  //                glisse DEUX FOIS plus vite que la frusion (ratio 1) ;
  //                main.cornerY = 10 + 96 × !flHalfHide  → 106 ou 10 ;
  //                main.onResize().
  var MD_CACHE = 220;
  var repli = { actif: false, barre: 0, frusion: 0, cible: 0, anim: null, dernier: 0 };

  function posterRepli() {
    var coin = $('#bureau-coin');
    var coinNoir = $('#bureau-coin-noir');
    var onglets = $('#bureau-onglets');
    var t = 'translateY(' + repli.barre.toFixed(2) + 'px)';
    if (coin) coin.style.transform = t;
    if (coinNoir) coinNoir.style.transform = t;   // le contour suit la barre
    // `mcTab` est un enfant de la barre (`_y = height`) : la rangée d'onglets
    // monte avec elle.
    if (onglets) onglets.style.transform = t;
    var f = 'translateY(' + repli.frusion.toFixed(2) + 'px)';
    if (frusion.boite) frusion.boite.style.transform = f;
  }

  function basculerRepli(force) {
    repli.actif = force === undefined ? !repli.actif : !!force;
    var nub = $('#mode-rapide');
    if (repli.actif) {
      repli.cible = -MD_CACHE;
      if (!nub) document.getElementById('bureau-haut').appendChild(batirNub());
      else nub.classList.remove('vu');
    } else {
      repli.cible = 0;
      if (nub && nub.parentNode) nub.parentNode.removeChild(nub);
    }
    CORNER_Y = 10 + 96 * (repli.actif ? 0 : 1);
    // Le bureau suit le coin : la rangée d'icônes remonte, comme d'époque.
    document.body.style.setProperty('--cornerY', CORNER_Y + 'px');
    battreRepli();
    // `main.onResize()` : les fenêtres se recalent sous le nouveau coin.
    for (var id in fenetres) bornerDansEcran(fenetres[id].fen);
    bornerFiche();
    poserFond(fondCourant);
  }

  function battreRepli() {
    if (repli.anim) return;
    repli.dernier = 0;
    var pas = function (t) {
      repli.anim = null;
      var tmod = repli.dernier ? Math.min(4, (t - repli.dernier) / 25) : 1;
      repli.dernier = t;
      // La barre : ratio 2. La frusion : `jumpTo` → addSlide sans ratio, donc 1.
      var rb = Math.pow(0.8, tmod * 2), rf = Math.pow(0.8, tmod);
      repli.barre = repli.barre * rb + repli.cible * (1 - rb);
      repli.frusion = repli.frusion * rf + repli.cible * (1 - rf);
      var fini = Math.round(repli.barre) === Math.round(repli.cible)
        && Math.round(repli.frusion) === Math.round(repli.cible);
      if (fini) { repli.barre = repli.cible; repli.frusion = repli.cible; }
      posterRepli();
      if (!fini) repli.anim = requestAnimationFrame(pas);
      else if (repli.actif) {
        // `endMove` : la languette ne se montre qu'une fois la barre partie.
        var nub = $('#mode-rapide');
        if (nub) nub.classList.add('vu');
      }
    };
    repli.anim = requestAnimationFrame(pas);
  }

  // `testRetour` (#587) : le dessin de 14×14 et son champ « mode rapide » en
  // Verdana gras 10 `#4D7417`, posés à l'origine de la barre — soit, une fois
  // la barre remontée de 220, au coin haut-gauche de l'écran.
  function batirNub() {
    var nub = document.createElement('button');
    nub.type = 'button';
    nub.id = 'mode-rapide';
    nub.title = 'Revenir à la barre';
    var img = document.createElement('i');
    var txt = document.createElement('span');
    txt.textContent = 'mode rapide';
    nub.appendChild(img);
    nub.appendChild(txt);
    nub.addEventListener('click', function () { basculerRepli(false); });
    return nub;
  }

  // ── LE CLIGNOTEMENT DU PREMIER SURVOL ────────────────────────────────
  //
  // Les états d'un bouton sont trois DESSINS distincts (`_up`, `_over`,
  // `_down`) posés en `background-image`. Le navigateur ne va chercher un
  // dessin qu'au moment où la règle s'applique : au tout premier survol, la
  // pièce disparaît le temps du chargement, puis revient — et ne cligne plus
  // jamais. Flash, lui, avait tout en mémoire dès la première image.
  //
  // On demande donc TOUS les dessins de l'interface d'un coup, en deux
  // inventaires : la LISTE d'époque (`chargement.json`, ce que l'extracteur a
  // sorti de main.swf) et les images citées par la feuille de style du bureau.
  // C'est exactement ce que la page de chargement promet — « tous les éléments
  // de l'interface de frutiparc » — et c'est elle qui compte les arrivées.
  var precharge = [];                   // on garde les Image vivantes le temps du chargement
  function inventaireDuChargement(declarer, fini) {
    var restants = 2;
    var termine = function () { if (--restants === 0 && fini) fini(); };
    var demander = function (url) {
      var img = new Image();
      var arrive = declarer(url);
      img.onload = arrive; img.onerror = arrive;   // une image absente est « réglée » aussi
      img.src = url;
      precharge.push(img);
    };
    var vues = {};
    var unique = function (url) { if (vues[url]) return; vues[url] = true; demander(url); };
    // 1. les dessins sortis du SWF (scripts/extract-chargement.js)
    fetch('/frutiz/sprites/chargement.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m && m.interface) m.interface.forEach(unique); })
      .catch(function () { /* pas de manifeste : la feuille de style suffira */ })
      .then(termine, termine);
    // 2. celles que la feuille de style pose en `background-image`
    fetch('/bureau-frutiz.css', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (css) {
        var re = /url\(\s*['"]?(\/[^'")]+)['"]?\s*\)/g;
        var m;
        while ((m = re.exec(css))) unique(m[1]);
      })
      .catch(function () { /* tant pis, le premier survol clignotera */ })
      .then(termine, termine);
  }

  /*
   * ── LA PAGE DE CHARGEMENT — `loadingProcess` (#154) ───────────────────
   *
   * La toute première chose que main.swf montrait : un écran vert, le mot
   * CHARGEMENT, et une BARRE ROSE qui se remplit. `loadingInit()` (0x08641)
   * l'attache à la profondeur 512, `updateLoadingSize()` (0x087ba) la pose,
   * `loadingLoop()` (0x08a52) la fait vivre — une fois par image, à 100 im/s.
   *
   *     ratio = (mLoaded + iLoaded) / (mTotal + iTotal)
   *     coef  = coef × 0,9 + ratio × 0,1
   *     mid._width = coef × midMax        b2._x = b1._x + mid._width
   *     fieldInfo.text = « fichiers restants : » + round((1 − coef) × 100) + « % »
   *     fini quand tout est là ET coef > 0,995 → gotoAndPlay("fin"),
   *     puis icon.removeMovieClip() et lp.removeMovieClip()
   *
   * DEUX CHOSES D'ÉPOQUE QU'ON GARDE TELLES QUELLES :
   *
   *  · LA BARRE MONTE PENDANT QUE LE NOMBRE DESCEND. Le libellé dit
   *    « fichiers restants » et affiche (1 − coef) : à barre pleine il marque
   *    0 %. Le texte par défaut du champ dit d'ailleurs « fichiers
   *    téléchargés », preuve que l'un des deux a été changé sans l'autre.
   *    C'est le bug d'origine, il reste.
   *  · LE PLANCHER DE DEMI-SECONDE. Le lissage part de coef = 0 : même tout
   *    en cache, il faut une cinquantaine d'images d'époque pour franchir
   *    0,995 (0,9⁵⁰ ≈ 0,005). La page ne clignote donc jamais.
   *
   * Ce que le ruban MESURE : là où le SWF pesait ses propres octets et ceux de
   * fileIcon.swf, le portage pèse les dessins de l'interface — un fichier
   * réglé, un pas de plus. Le reste (la loi, la géométrie, les mots) est au
   * chiffre près celui du SWF ; la géométrie vit dans la feuille de style.
   */
  var CH_LISSAGE = 0.9;          // coef = coef × 0,9 + ratio × 0,1, par image
  var CH_SEUIL = 0.995;          // et fini au-delà
  var CH_CADENCE = 10;           // une image d'époque = 10 ms (100 im/s)
  var CH_TITRE = 'CHARGEMENT';
  var CH_PREFIXE = 'fichiers restants : ';
  var CH_INFO_TITRE = 'Information :';
  var CH_INFO = 'Ce chargement comprend tous les éléments de l’interface de'
    + ' frutiparc ce qui vous permettra de naviguer plus rapidement ensuite !';

  var pageChargement = null;
  function ouvrirChargement() {
    if (pageChargement) return;
    var page = document.createElement('div');
    page.id = 'fb-chargement';
    // Les neuf enfants de `loadingProcess`, dans l'ordre de leurs profondeurs :
    // la gouttière (image 2 des clips), le ruban (image 1), puis les champs.
    page.innerHTML =
      '<div class="ch-barre">'
      + '<i class="ch-g1"></i><i class="ch-gm"></i><i class="ch-g2"></i>'
      + '<div class="ch-ruban"><i class="ch-b1"></i><i class="ch-mid"></i><i class="ch-b2"></i></div>'
      + '</div>'
      + '<div class="ch-titre"></div>'
      + '<div class="ch-champ"></div>'
      + '<div class="ch-info-titre"></div>'
      + '<div class="ch-info"></div>';
    page.querySelector('.ch-titre').textContent = CH_TITRE;
    page.querySelector('.ch-info-titre').textContent = CH_INFO_TITRE;
    page.querySelector('.ch-info').textContent = CH_INFO;
    var champ = page.querySelector('.ch-champ');
    document.body.appendChild(page);
    pageChargement = page;

    var total = 0, regles = 0, pret = false, coef = 0, dernier = 0;
    // `mTotal` était connu dès la première image : tant qu'on ne sait pas
    // combien de fichiers on attend, le ratio reste à zéro — sans quoi le
    // ruban avancerait puis RECULERAIT quand le second inventaire arrive.
    inventaireDuChargement(
      function (url) { total++; return function () { regles++; }; },
      function () { pret = true; }
    );

    var poser = function (c) {
      // `mid._width = coef × midMax` et `b2._x = b1._x + mid._width` : ici, la
      // feuille de style tire la même largeur de `--ch-coef`, et le bout droit
      // suit tout seul (il est collé à `left: 100%` du ruban).
      page.style.setProperty('--ch-coef', String(c));
      champ.textContent = CH_PREFIXE + Math.round((1 - c) * 100) + '%';
    };
    poser(0);

    var fermer = function () {
      // « fin » : `lp.removeMovieClip()`, sans fondu — la page disparaît.
      if (page.parentNode) page.parentNode.removeChild(page);
      if (pageChargement === page) pageChargement = null;
    };

    var boucle = function (ts) {
      if (!page.parentNode) return;                 // fermée entre-temps
      var dt = dernier ? Math.max(0, ts - dernier) : CH_CADENCE;
      dernier = ts;
      var ratio = pret ? (total ? regles / total : 1) : 0;
      // `loadingLoop` lisse de 0,9 UNE FOIS PAR IMAGE, à 100 im/s. On garde la
      // constante de temps plutôt que le compte d'images : `coef − ratio` est
      // multiplié par 0,9 tous les 10 ms, ce que la forme fermée donne
      // exactement pour un intervalle quelconque.
      coef = ratio + (coef - ratio) * Math.pow(CH_LISSAGE, dt / CH_CADENCE);
      poser(coef);
      if (pret && regles === total && coef > CH_SEUIL) { fermer(); return; }
      requestAnimationFrame(boucle);
    };
    requestAnimationFrame(boucle);
    return fermer;
  }

  function demarrer() {
    if (actif) return;
    actif = true;
    document.body.classList.add('bureau-frutiz');
    // La page de chargement passe DEVANT (profondeur 512, au-dessus de tout) :
    // le bureau se monte derrière elle pendant que les dessins arrivent, et
    // elle s'efface d'elle-même. C'est aussi elle qui précharge — d'où le
    // `flLoading` d'époque, vrai le temps du montage.
    ouvrirChargement();
    var app = $('#app');

    var bureau = document.createElement('div');
    bureau.id = 'bureau';
    // `listener.dragIconMouse.onMouseUp` : quand rien sous le curseur ne porte
    // de `dropBox`, c'est le BUREAU qui reçoit. Ici il le dit franchement.
    bureau.setAttribute('data-depot', 'bureau');
    // `FPDesktop.getMenu` : le clic droit sur le fond ouvre le menu du bureau.
    bureau.addEventListener('contextmenu', function (ev) {
      if (ev.target !== bureau) return;      // un raccourci a le sien
      ev.preventDefault();
      menuDuBureau(ev.clientX, ev.clientY);
    });
    var couche = document.createElement('div');
    couche.id = 'bureau-fenetres';
    // La couche HAUTE : la barre et ses meubles, AU-DESSUS des fenêtres —
    // les profondeurs du SWF (la main bar recouvre ce qui s'en approche,
    // recal borne d'ailleurs les fenêtres sous cornerY).
    var haut = document.createElement('div');
    haut.id = 'bureau-haut';
    var coin = document.createElement('div');
    coin.id = 'bureau-coin';
    // `drawInterface` dessine la barre en DEUX clips, et pas au même étage :
    // le contour sombre dans `mcInterfaceBlack` (profondeur 2), le liseré et
    // le fond blanc dans `mcInterface` (10). Entre les deux, `mcTabBlack` (4)
    // et `mcTab` (8) — les onglets. Le liseré du bas passe donc SOUS eux, et
    // c'est la couture de l'onglet qu'on lit à sa place.
    var coinNoir = document.createElement('div');
    coinNoir.id = 'bureau-coin-noir';
    app.appendChild(bureau);
    app.appendChild(couche);
    app.appendChild(haut);

    // LA BARRE D'ONGLETS (MainBarTab #781) : les deux clips extraits —
    // tabFond (la silhouette sombre) sous tab (la plaque + la pastille) — dans
    // leur cadre commun (x −17.5, y −18, 123×41.5), posés à l'origine de la
    // barre d'onglets (mcTab._y = height = 76). Le label est le champ #190 :
    // Verdana 10 gras #000000, lié au titre du slot.
    //
    // Ce n'est pas UN onglet mais une LISTE : `_global.slotList` (SlotList.as)
    // tient un slot par espace de travail — le bureau (FPDesktop, l'onglet
    // « Bureau ») et un FPTab par fenêtre mise en onglet. Un seul est actif à
    // la fois : `activate()` désactive le précédent.
    var barreOnglets = document.createElement('div');
    barreOnglets.id = 'bureau-onglets';
    // `mcTabBlack` : la silhouette sombre de TOUS les onglets, sous TOUS les
    // onglets (`init` y attache « tabFond », pas dans le clip de l'onglet).
    var noirOnglets = document.createElement('div');
    noirOnglets.id = 'bureau-onglets-noir';
    barreOnglets.appendChild(noirOnglets);
    haut.appendChild(coinNoir);        // mcInterfaceBlack (2)
    haut.appendChild(barreOnglets);    // mcTabBlack (4) puis mcTab (8)
    haut.appendChild(coin);            // mcInterface (10)
    ongletBureau = creerOnglet('bureau', 'Bureau', null);
    dessinerOnglets();

    // LE LECTEUR FRUSION (le clip `frusion` #324, en couches), avec sa
    // mécanique : le tiroir qui sort, le disque qu'on y pose, celui qu'on
    // reprend.
    haut.appendChild(batirFrusion());

    // LA FRUTIMANDALA (cpWheelMng #640) : le châssis, ses deux cadrans qui
    // s'échangent et ses quatre boutons. Elle vit DANS la barre (c'est le
    // dernier élément de son frameSet), pas sur l'écran : sa marge droite se
    // compte donc depuis le bord de la barre — et elle monte avec elle quand
    // le « mode rapide » la replie.
    coin.appendChild(batirMandala());
    brancherRangeeEncart(coin);
    brancherBarresXp();

    // PAS DE PILULE « N EN LIGNE ». C'était une invention du portage, posée en
    // surimpression du coin haut-droit ; main.swf n'a rien de tel — le compte
    // des présents se lit dans la liste des connectés d'une fenêtre de salon,
    // et le titre du salon le porte déjà entre parenthèses.

    // LE PANNEAU DES CONTACTS (SideList) : la bande blanche de 9 px (wSide)
    // au liseré de 3 (wShade), son ombre de 2 px (le clip carreFond) posée à
    // cornerX, et la POIGNÉE — le DefineButton2 `sideListContact` extrait tel
    // quel, collé en bas comme `butContact._y = 800`.
    var bande = document.createElement('div');
    bande.id = 'side-list';
    bande.innerHTML = '<div class="sl-liste"></div>'
      + '<button type="button" class="sl-recherche" title="Chercher un joueur">recherche</button>';
    var ombre = document.createElement('div');
    ombre.id = 'side-list-ombre';
    var languette = document.createElement('button');
    languette.type = 'button';
    languette.id = 'languette-contacts';
    languette.title = 'Contacts';
    languette.textContent = 'CONTACTS';
    haut.appendChild(bande);
    haut.appendChild(ombre);
    haut.appendChild(languette);
    languette.addEventListener('click', basculerContacts);
    // `butSearch.onPress = uniqWinMng.open("search")` (0xa1172).
    bande.querySelector('.sl-recherche').addEventListener('click', ouvrirRechercheFenetre);

    // La main bar quitte le tiroir : c'est le meuble du bureau maintenant.
    // (La bannière quotidienne reste au tiroir : main.swf n'a pas de bandeau
    // — la « Connexion quotidienne : +10 kikooz » se lit dans l'historique.)
    var mainbar = $('#home-panel .mainbar');
    if (mainbar) coin.appendChild(mainbar);
    var grille = $('#home-grid');
    if (grille) { bureau.appendChild(grille); rendreIconesDeplacables(grille, bureau); }
    habillerIconeGaspard();
    // LA LIGNE DU COMPTE RESTE AU TIROIR. Le bureau d'époque n'a pas de pied de
    // page : « Se déconnecter » y vit dans le MENU DU FOND D'ÉCRAN (cf.
    // `menuDuBureau`), et la confidentialité n'a rien à faire sur un bureau.

    poserFond(fondCourant);
    // Ce que le joueur a posé sur son bureau : `FPDesktop` s'abonne à `fileMng`
    // sur « root » dès son `init`, et le portage relit la même liste.
    chargerObjetsBureau();
    // Les préférences se lisent une fois au démarrage — c'est le `userPref`
    // que `do/onident` remet au SWF avant même le premier écran.
    relirePrefs();
    window.addEventListener('resize', function () {
      poserFond(fondCourant);
      for (var id in fenetres) bornerDansEcran(fenetres[id].fen);
      bornerFiche();
      majBouilles();
      // `cpDragIconList.updateSize` relance `initGrid` + `fitInGrid` : la
      // grille change de taille, les icônes hors cadre reviennent dedans.
      rafraichirBureau();
    });
  }

  return {
    demarrer: demarrer,
    apresActivateTab: apresActivateTab,
    poserFond: poserFond,
    // La tuile « Salons » du bureau ouvre la LISTE, pas la conversation :
    // c'est le double-clic sur « Les salons » du bureau d'époque.
    ouvrirSalonsPublics: ouvrirSalonsPublics,
    // LA RECHERCHE : le bureau ouvre la fenêtre, le light lui rend la réponse
    // du serveur (`box.Search.onSearch` → `win.displayBloc`).
    ouvrirRecherche: ouvrirRechercheFenetre,
    resultatsRecherche: afficherResultats,
    // UNE FENÊTRE PAR SALON : le light appelle ici pour ouvrir (ou rappeler
    // au premier plan) la conversation d'un salon, public ou privé.
    ouvrirSalon: ouvrirSalon,
    // La même, mais RANGÉE : une invitation reçue s'ouvre en onglet qui
    // clignote, sans prendre le bureau (`chatMng.open(…, trashSlot)`).
    ouvrirSalonEnFond: function (salon) { ouvrirSalon(salon, true); },
    // ET SON CONTRAIRE : quand le SERVEUR nous met dehors (une expulsion, un
    // bannissement), la fenêtre doit partir comme si on l'avait fermée —
    // `box.Chat.onKick` fait `channelMng.rm(this.group)`. `fermerFenetre`
    // rappelle `SalonsBureau.fermerCadre` au passage : le cadre, le journal et
    // la liste des connectés s'en vont avec elle.
    fermerSalon: function (salon) { fermerFenetre('salon:' + salon); },
    // GASPARD, la première icône de l'encart : `select(0)` d'époque.
    ouvrirGaspard: ouvrirGaspard,
    // Les deux explorateurs : « Mes disques » et « Inventaire ».
    ouvrirDisques: function () { ouvrirExplorateur('disques'); },
    ouvrirInventaire: function () { ouvrirExplorateur('inventaire'); },
    // La boutique : une FENÊTRE sur le bureau, la feuille du mobile ailleurs.
    ouvrirBoutique: ouvrirBoutique,
    // « Modifier ma fiche » (`win.EditInfo`) : une FENÊTRE aussi. Le light
    // remplit les champs après l'ouverture ; la fermeture remet la feuille en
    // place (et l'enregistrement, comme d'époque, ferme la fenêtre).
    ouvrirProfil: function () { ouvrirFenetre('fiche-edit'); },
    fermerProfil: function () { fermerFenetre('profil-sheet'); },
    // Le forum : ni fenêtre ni cadre, une FENÊTRE DE NAVIGATEUR à part —
    // `win.Forum` ne fait rien d'autre que renvoyer dehors.
    ouvrirForum: ouvrirForum,
    // La fiche : au bureau c'est une fenêtre, elle se pose et se glisse.
    poserFiche: poserFiche,
    // Les entrées d'un menu arrivent en glissant : le light rappelle ici
    // chaque fois qu'il refait la colonne des scores ou celle de la boutique.
    animerEntrees: animerEntrees,
    // Ce que le joueur a posé sur son bureau, pour le banc et pour le light.
    objetsBureau: function () { return objetsBureau.slice(); },
    rafraichirBureau: rafraichirBureau,
    // Rappelé par renderRoomOptions : l'affluence des salons bouge, la
    // fenêtre la suit — et la fenêtre du salon se retitre au changement.
    majSalons: function () { majSalons(); majTitreSalon(); },
    // Rappelés par le light : la colonne des bouilles suit la liste des
    // connectés, et une émotion joue dans l'écran de la personne.
    ajusterJournal: ajusterJournal,
    // La messagerie du light, rhabillée en explorateur : mêmes données, le
    // gabarit « mail » de `box.Explorer` par-dessus.
    majMessagerie: majMessagerie,
    majLectureMail: majLectureMail,
    // Le light prévient à chaque changement de vue : le bandeau suit.
    retitrerMail: retitrerMail,
    retitrer: retitrer,
    // `box.Chat.onSend` : une trame de conversation avertit son slot. L'onglet
    // qui porte la fenêtre des salons (ou celui du bureau si elle y est
    // restée) se teinte de rose tant qu'on ne l'a pas rappelé.
    avertirConversation: avertirConversation,
    majBouilles: majBouilles,
    majListeConnectes: majListeConnectes,
    ecranDe: ecranDe,
    finirEmote: finirEmote,
    actif: function () { return actif; },
  };
})();
