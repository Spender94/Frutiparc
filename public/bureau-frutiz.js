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
    chat:       { panneau: '#chat-panel',      titre: 'Salons',         fruit: 'winChat', l: 780, h: 580,
                  min: function () { return minSalon(); } },
    // PAS DE FORUM ICI — et ce n'est pas un oubli. `win.Forum` (0x6e136) est
    // la seule rubrique qui ne s'ouvre pas SUR le bureau : elle renvoie
    // dehors, dans une fenêtre de navigateur à elle. Voir `ouvrirForum`.
    // LES SCORES — `box.Score` (0xade18). Relevé 1:1 : 610 × 328, cadre
    // `#444444` compris ; la colonne de gauche fait 160 et celle de droite
    // 430, six pixels entre les deux.
    scores:     { panneau: '#scores-panel',    titre: 'Scores',         l: 610, h: 328 },
    // LA BOUTIQUE — `win.Shop`. Relevé 1:1 : la fenêtre tient en 476 × 404,
    // contour compris, et s'ouvre au milieu. `winType = "winShop"` : le fruit
    // VERT en pastille.
    boutique:   { panneau: '#shop-sheet',      titre: 'Boutique', fruit: 'winShop',
                  l: 476, h: 404, min: { w: 300, h: 200 }, centre: true },
    // LA MESSAGERIE — d'époque c'est un EXPLORATEUR (`box.Explorer` sur
    // `fileMng.inbox`), donc la fenêtre jaune et son gabarit : `win.Explorer`
    // pose `pos = {50, 50, 400, 400}` et s'ouvre AU MILIEU. Le relevé 1:1 la
    // donne en x 486..896 / y 146..546 — 411 × 401, contour compris. Le titre
    // vient du dossier (`setTitle(this.list.desc[0])`).
    mail:       { panneau: '#mail-panel',      titre: 'Boîte de réception',
                  fruit: 'winExplorer', l: 412, h: 402,
                  min: { w: 200, h: 128 }, centre: true },
    // LES DEUX JOURNAUX — `box.SiteLog` et `box.UserLog`, qui n'ajoutent rien
    // à `win.Log` (0x57281) qu'une icône : `linkIco` vaut « icoSiteLog » ou
    // « icoUserLog ». Et `win.Log.init` pose `flResizable = false` : ces
    // fenêtres-là ne se redimensionnent pas. Le gabarit vient du relevé 1:1 —
    // 314 × 246, cadre `#444444` compris.
    evenements: { panneau: '#evt-panel',       titre: 'Événements',     l: 314, h: 246, fixe: true },
    historique: { panneau: '#evt-panel',       titre: 'Mon historique', l: 314, h: 246, fixe: true },
    trombi:     { panneau: '#trombi-panel',    titre: 'Bouilloscope',   l: 780, h: 620 },
    reglages:   { panneau: '#reglages-panel',  titre: 'Préférences',    l: 560, h: 620 },
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
                  l: 265, h: 288, min: { w: 200, h: 240 } },
    // L'EXPLORATEUR — `win.Explorer`, la fenêtre JAUNE (winType « winExplorer »,
    // d'où la banane en pastille). Son gabarit est écrit dans `init` :
    // `pos = {x:50, y:50, w:400, h:400}` — 402 × 402 le contour compris, ce
    // que le relevé 1:1 confirme. Deux dossiers l'ouvrent depuis le bureau ;
    // c'est la MÊME fenêtre, seul l'uid de départ change.
    // `init` finit par `moveToCenter()` : l'explorateur s'ouvre AU MILIEU, pas
    // en cascade comme les autres.
    'ex-disques':    { panneau: '#ex-disques-panel',    titre: 'Mes disques', fruit: 'winExplorer',
                       l: 402, h: 402, min: { w: 100, h: 128 }, centre: true },
    'ex-inventaire': { panneau: '#ex-inventaire-panel', titre: 'Inventaire',  fruit: 'winExplorer',
                       l: 402, h: 402, min: { w: 100, h: 128 }, centre: true },
  };

  function fruitUrl(nom) { return '/frutiz/sprites/fruit_' + (nom || 'default') + '.svg'; }

  var actif = false;
  var fenetres = {};                    // id de panneau → { fen, corps, panneau, origine, txt, pastille }
  var zCourant = 20;                    // premier plan : le dernier cliqué
  var cascade = 0;                      // décalage des ouvertures successives
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

  function posDe(fen) {
    return {
      x: parseFloat(fen.style.left) || 0,
      y: parseFloat(fen.style.top) || 0,
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
  function glisserVers(fen, cible) {
    if (fen._glisse) clearInterval(fen._glisse);
    if (!FLUIDE) {
      fen.style.left = Math.round(cible.x) + 'px';
      fen.style.top = Math.round(cible.y) + 'px';
      return;
    }
    // `addSlide` remet `regular` sur la position courante du clip.
    var reg = { x: parseFloat(fen.style.left) || 0, y: parseFloat(fen.style.top) || 0 };
    fen._glisse = setInterval(function () {
      reg.x = reg.x * GLISSE_K + cible.x * (1 - GLISSE_K);
      reg.y = reg.y * GLISSE_K + cible.y * (1 - GLISSE_K);
      fen.style.left = Math.round(reg.x) + 'px';
      fen.style.top = Math.round(reg.y) + 'px';
      if (Math.round(reg.y) === Math.round(cible.y)
        && Math.round(reg.x) === Math.round(cible.x)) {
        reg.x = cible.x; reg.y = cible.y;
        fen.style.left = Math.round(cible.x) + 'px';
        fen.style.top = Math.round(cible.y) + 'px';
        clearInterval(fen._glisse); fen._glisse = null;
      }
    }, GLISSE_MS);
  }

  function creerFantome(pos) {
    var fantome = document.createElement('div');
    fantome.className = 'fen-fantome';
    fantome.style.left = pos.x + 'px';
    fantome.style.top = pos.y + 'px';
    // border-box : la bordure de 2 px du fantôme compte dans sa taille, comme
    // la silhouette du clip couvrait exactement le cadre de la fenêtre.
    fantome.style.boxSizing = 'border-box';
    fantome.style.width = pos.w + 'px';
    fantome.style.height = pos.h + 'px';
    $('#bureau-fenetres').appendChild(fantome);
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
    // Le serveur du revival n'a pas de `createChannel` : les onze salons sont
    // fixes. Le bouton est là parce qu'il fait partie de la fenêtre, mais il
    // n'a rien à appeler — mieux vaut le dire que faire semblant.
    creer.disabled = true;
    creer.title = 'La création de salons n’est pas ouverte sur le revival';
    var nom = document.createElement('input');
    nom.type = 'text';
    nom.className = 'sp-nom';
    nom.disabled = true;
    nom.setAttribute('aria-label', 'Nom du salon à créer');
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
      b.addEventListener('click', function () {
        pont.rejoindre(s.id);
        // `box.join` fait suivre la fenêtre du salon : elle s'ouvre (ou
        // repasse devant) sur le salon qu'on vient de rejoindre.
        ouvrirFenetre('chat');
      });
      liste.appendChild(b);
    });
  }

  function ouvrirSalonsPublics() {
    if (!actif) return;
    ouvrirFenetre('salons');
    majSalons();
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
    if (frusion.disque) {
      entrees = entrees.filter(function (x) { return x.uid !== frusion.disque.uid; });
    }
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
  // reconnaît à sa jaquette. Le clic, lui, lance le jeu — c'est ce que fait
  // `_global.onFileClick` d'un disque une fois posé dans la Frusion.
  // Le libellé d'un disque (`desc[1]`) est celui qui CHOISIT la jaquette dans
  // fileIcon.swf — c'est aussi ce qui nous dit quel jeu lancer. Trois disques
  // n'ont pas de portage light : Burning Kiwi, Kaluga et Motion-Ball ne se
  // lisent que sur la version Flash. On les montre quand même — le bureau
  // d'époque montre TOUS les disques du joueur — et on le dit à la main.
  var JEUX_LIGHT = {
    grapiz: 'grapiz', bandas: 'bandas', swapou2: 'swapou', miniwave: 'miniwave',
    miniwaved: 'miniwave', minipixiz: 'minipixiz', minipixizd: 'minipixiz',
    snake3: 'snake3', snake: 'snake3', minifever: 'minifever',
    jama: 'jamajama', jamajama: 'jamajama',
  };
  function caseDisque(e) {
    var type = e.desc[0], jeu = e.desc[1] || '';
    var tab = JEUX_LIGHT[String(jeu).toLowerCase()];
    // D'époque, `_global.onFileClick` ne fait RIEN d'un disque — la branche
    // « disc » est commentée dans openFunctions.as. On joue en le GLISSANT
    // dans la Frusion, et le bandeau de la fenêtre le dit : « Pour jouer,
    // faîtes glisser les disques dans la Frusion ». Le clic reste donc muet,
    // comme d'époque ; c'est le glisser qui ouvre le tiroir.
    var c = caseExplorateur({
      classe: 'ex-slot-disque',
      dessin: dessinDisque(type, jeu),
      titre: tab ? 'Glissez-le dans la Frusion' : 'Ce disque ne se lit que sur la version Flash',
    });
    // Muet au clic ne veut pas dire INERTE : un disque jouable s'attrape.
    if (tab) {
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
    fetch('/api/light/bureau/objets?sid=' + encodeURIComponent(sid), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) return;
        objetsBureau = d.objets || [];
        bureauCharge = true;
        rafraichirBureau();
      })
      .catch(function () { /* hors ligne : le bureau reste nu */ });
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

  // `initGrid` + `getNextAvailablePos` : la première case libre, en balayant
  // ligne par ligne. Les cases occupées sont celles des objets DÉJÀ posés.
  function caseLibreBureau(parent) {
    var bureau = $('#bureau');
    var l = bureau ? bureau.clientWidth : 1200, h = bureau ? bureau.clientHeight : 700;
    var xMax = Math.max(1, Math.floor(l / GRILLE_PAS));
    var yMax = Math.max(1, Math.floor(h / GRILLE_PAS));
    var prises = {};
    objetsBureau.forEach(function (o) {
      if ((o.parent || 'root') !== parent) return;
      prises[Math.round(o.pos.x / GRILLE_PAS) + ':' + Math.round(o.pos.y / GRILLE_PAS)] = true;
    });
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
      bureau.appendChild(raccourciBureau(o));
    });
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

    // `IconFileBox.click` : le contrôle de glissé court encore ⇒ c'était un
    // CLIC. Un contact ouvre sa fiche ; un disque ne fait RIEN, comme
    // d'époque (la branche « disc » d'`openFunctions.as` est commentée).
    d.addEventListener('click', function (ev) {
      if (Date.now() - dernierDepot < 250) { ev.stopPropagation(); return; }
      if (o.type === 'contact') ouvrirFiche(o.name || o.desc[0]);
      else if (o.type === 'folder') ouvrirDossierBureau(o);
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
        l: 400, h: 300, min: { w: 200, h: 128 }, centre: true,
      };
    }
    ouvrirFenetre(tab);
    dessinerDossierBureau(o.uid);
  }

  // Ce que le bureau tient dans un dossier donné.
  function objetsDuDossier(uid) {
    return objetsBureau.filter(function (o) { return (o.parent || 'root') === uid; });
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
      var lache = function (e) {
        document.removeEventListener('pointermove', bouge);
        document.removeEventListener('pointerup', lache);
        if (parti) {
          e.preventDefault(); e.stopPropagation();
          glisseur.ctrl = !!(e.ctrlKey || e.metaKey);
          finirGlisser(e.clientX, e.clientY);
        }
      };
      document.addEventListener('pointermove', bouge);
      document.addEventListener('pointerup', lache, true);
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
      if (this.disqueEl) this.disqueEl.classList.add('file');
      this.sens = 0;
    }
    if (sens < 0 && this.vitesse < 0) {
      this.sens = 0;
      this.vitesse = 0;
      if (this.disqueEl) this.disqueEl.classList.remove('file');
      var d = this.destin;
      this.destin = null;
      if (d && this[d]) this[d]();
    }
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
    if (!tab || !window.activateTab) return;
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
    this.stopDisc('releaseDisc');
  };

  frusion.pushReset = function () {
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
    this.openSlot();
    this.disqueEl.classList.add('reprenable');
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
    this.disqueEl.textContent = '';
    this.disqueEl.classList.remove('plein', 'file', 'reprenable');
    rafraichirDisques();
  };

  // La fenêtre « Mes disques » suit l'état du lecteur, comme les écoutants de
  // `fileMng` d'époque : le disque inséré la quitte, le disque éjecté y rentre.
  function rafraichirDisques() {
    var e = exEtats.disques;
    if (e && e.uid && $(EXPLORATEURS.disques.panneau)) ouvrirDossier('disques', e.uid, e.titre);
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
  function majTitreSalon() {
    var f = fenetres['chat-panel'];
    if (!f || !window.SalonsBureau) return;
    var nom = window.SalonsBureau.nomCourant();
    if (!nom) return;
    var n = window.SalonsBureau.affluenceCourante();
    f.txt.textContent = nom + (n === null ? '' : ' (' + n + ')');
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
    f.corps.addEventListener('click', function (e) {
      if (!actif) return;
      var c = e.target && e.target.closest ? e.target : null;
      if (!c) return;
      if (c.closest('#bouille-toggle')) {
        e.stopPropagation();
        e.preventDefault();
        var p = $('#chat-panel');
        var t = $('#topbar');
        if (!p) return;
        var ouvert = p.classList.toggle('bouilles-ouvertes');
        if (t) t.classList.toggle('en-rangee', ouvert);
        // La fenêtre grandit D'ABORD s'il le faut : c'est sa hauteur qui dit
        // combien d'écrans tiennent, donc lequel des deux visages la zone
        // prend.
        appliquerMinimum(f);
        if (ouvert) majBouilles();
        return;
      }
      // Les feutres et les connectés, eux, sont bien branchés côté light : on
      // repasse APRÈS lui pour relever le minimum, comme `onFrameSetUpdate`.
      if (c.closest('#pen-btn') || c.closest('#users-btn')) {
        setTimeout(function () { appliquerMinimum(f); majBouilles(); }, 0);
      }
      // LE CLIC SUR UN ÉCRAN ouvre la fiche : `attachFrutiScreen` (0xb6597)
      // pose `setAction({obj: win.box, method: 'openFrutizInfo', args: u})`.
      var ec = c.closest('.bo-ecran:not(.clb)');
      if (ec && ec.getAttribute('data-nom')) {
        e.stopPropagation();
        e.preventDefault();
        tipCacher();
        var S = window.SalonsBureau;
        if (S && S.ouvrirFiche) S.ouvrirFiche(ec.getAttribute('data-nom'));
      }
    }, true);
    // LE SURVOL. `cp.FrutiScreen.setTip` (0x6299a) : `onRollOver` appelle
    // `tip.displayCallBack({id, cb})`, `onRollOut` `tip.remove(id)`. La bulle
    // se pose UNE FOIS, au point d'entrée, et n'y bouge plus — vérifié sur
    // Ruffle : trois survols, trois bulles au même écart du curseur.
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
  function minSalon() {
    var p = $('#chat-panel');
    var bouilles = !!(p && p.classList.contains('bouilles-ouvertes'));
    var tiroir = $('#users-drawer');
    var connectes = !!(tiroir && tiroir.classList.contains('open'));
    var barre = $('#pen-bar');
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
  function ecranDe(pseudo) {
    var col = $('#bouille-overlay');
    var p = $('#chat-panel');
    if (!col || !p || !p.classList.contains('bouilles-ouvertes')) return null;
    if (col.querySelector('.bo-ecran.clb')) return clbAccueille(pseudo);
    return col.querySelector('.bo-ecran[data-qui="' + cleCss(String(pseudo).toLowerCase()) + '"]');
  }

  // `onCLBEvent` : quelqu'un s'exprime, sa bouille entre dans l'aquarium.
  function clbAccueille(pseudo) {
    var ec = $('#bouille-overlay .bo-ecran.clb');
    if (!ec) return null;
    var cle = String(pseudo).toLowerCase();
    var cote = Math.min(ec.clientWidth, ec.clientHeight);
    var b = ec.querySelector('.bo-clb[data-qui="' + cleCss(cle) + '"]');
    if (!b) {
      b = document.createElement('div');
      b.className = 'bo-clb';
      b.setAttribute('data-qui', cle);
      b.style.width = cote + 'px';
      b.style.height = cote + 'px';
      b.style.left = (-ec.clientWidth) + 'px';   // hors champ, à gauche
      ec.appendChild(b);                         // AVANT le tirage : cf. le quirk
      b.style.top = Math.round(hauteurLibre(ec, cote)) + 'px';
      poserBouille(b, bouilleDe(pseudo), pseudo);
      void b.offsetWidth;                        // que le départ soit enregistré
    }
    b.style.left = '0px';
    var tous = ec.querySelectorAll('.bo-clb:not(.part)');
    if (tous.length > CLB_MAX) partirDansLEspace(tous[0], ec);
    return b;
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

  // `launchIntoTheSpace` : la plus ancienne repart par la gauche et disparaît.
  function partirDansLEspace(b, ec) {
    if (b.classList.contains('part')) return;
    b.classList.add('part');
    rendreScene(b);
    b.style.left = (-Math.min(ec.clientWidth, ec.clientHeight)) + 'px';
    setTimeout(function () { if (b.parentNode) b.remove(); }, 700);
  }

  function bouilleDe(pseudo) {
    var S = window.SalonsBureau;
    var gens = (S && S.membres) ? S.membres() : [];
    var cle = String(pseudo).toLowerCase();
    for (var i = 0; i < gens.length; i++) {
      if (String(gens[i].pseudo).toLowerCase() === cle) return gens[i].bouille;
    }
    return null;
  }

  // On ne refait la vignette que si la bouille a changé : sinon elle
  // clignoterait à chaque relevé des connectés.
  // Le pseudo ne va PAS dans `title` : l'infobulle du navigateur ferait
  // doublon — et concurrence — avec celle du SWF, qu'on refait ici.
  function poserBouille(ecran, bouille, pseudo) {
    if (pseudo) ecran.setAttribute('data-nom', pseudo);
    if (!bouille || ecran.getAttribute('data-bouille') === bouille) return;
    ecran.setAttribute('data-bouille', bouille);
    var vieux = ecran.querySelector('img, canvas.fp-bvig');
    if (vieux) vieux.remove();
    // Le moteur JS dessine sur fond TRANSPARENT : c'est le dégradé de l'écran
    // qui se voit derrière la bouille. (Le cache PNG peignait la capture sur le
    // vert plat des cartes du forum, d'où le `detourer` qu'il fallait lui
    // demander — plus rien à détourer ici.)
    ecran.insertAdjacentHTML('afterbegin', FPBouilleVignette.html(bouille));
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
  function majListeConnectes() {
    var l = $('#users-list');
    if (!l || !actif) return;
    if (l.children.length === 1 && l.firstElementChild.className === 'ul-defile') return;
    var d = document.createElement('div');
    d.className = 'ul-defile';
    while (l.firstChild) d.appendChild(l.firstChild);
    l.appendChild(d);
  }

  function majBouilles() {
    var col = $('#bouille-overlay');
    var p = $('#chat-panel');
    // Un écran qui disparaît emporte sa bulle : `remove(id)` d'époque.
    if (tipCible && !document.documentElement.contains(tipCible)) tipCacher();
    if (!col || !p || !p.classList.contains('bouilles-ouvertes')) return;
    var S = window.SalonsBureau;
    var gens = (S && S.membres) ? S.membres() : [];
    var cote = col.clientWidth || 100;
    var max = Math.floor((col.clientHeight || 0) / (cote + ECRAN_ECART));
    if (max >= gens.length) pileDeBouilles(col, gens);
    else bouilleUnique(col);
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
      poserBouille(ecran, g.bouille, g.pseudo);
    });
    // Qui a quitté le salon perd son écran — sauf s'il est en train de jouer
    // une émotion : la scène du light y est logée, on ne l'arrache pas.
    Array.prototype.slice.call(col.querySelectorAll('.bo-ecran')).forEach(function (e) {
      if (!vus[e.getAttribute('data-qui')] && !e.querySelector('#bouille-overlay-stage')) e.remove();
    });
  }

  // CLB : un seul écran, qui prend toute la zone. Les bouilles de qui
  // s'exprime y entrent par la gauche et s'y installent (cf. `clbAccueille`).
  function bouilleUnique(col) {
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
    Array.prototype.forEach.call(seul.querySelectorAll('.bo-clb'), function (b) {
      b.style.width = cote + 'px';
      b.style.height = cote + 'px';
      var y = parseFloat(b.style.top) || 0;
      b.style.top = Math.min(y, Math.max(0, seul.clientHeight - cote)) + 'px';
    });
  }

  // La scène du light (le lecteur Flash) ne doit jamais partir avec l'écran
  // qui la loge : on la remet dans la colonne avant de retirer celui-ci.
  function rendreScene(ecran) {
    var scene = ecran.querySelector('#bouille-overlay-stage');
    ecran.classList.remove('bo-anime');   // sa vignette figée revient
    if (scene) { scene.classList.remove('joue'); $('#bouille-overlay').appendChild(scene); }
  }

  var boutonWarning = null;
  function warningSalon() {
    if (boutonWarning) return boutonWarning;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'chat-warning';
    b.className = 'icon-btn bare';
    b.disabled = true;
    b.title = 'L’appel au modérateur n’est pas ouvert sur le revival';
    boutonWarning = b;
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

    // LES LIBELLÉS D'ÉPOQUE. `win.ViewMail.attachEndButton` compose sa barre
    // en XML : « Mettre à la corbeille », un grand espace, « Répondre », huit
    // pixels, « Faire suivre ». Le light n'a pas le renvoi, et il lui faut un
    // « Retour » que les trois fenêtres d'époque n'avaient pas — elles se
    // fermaient. Le reste prend les mots du SWF.
    var pou = $('#mail-supprimer');
    if (pou) pou.textContent = 'Mettre à la corbeille';
    var env = $('#mail-envoyer');
    if (env) env.textContent = 'Envoyer';

    // L'EN-TÊTE DE LECTURE (`win.ViewMail.attachInfo`) : quatre lignes de 20,
    // étiquette de 60 alignée à DROITE — Date, De, À, Sujet. Le light n'en
    // affiche que trois valeurs ; on monte le gabarit complet et on le
    // remplit à l'ouverture.
    var lect = $('#mail-vue-lecture');
    if (lect) {
      var info = document.createElement('div');
      info.className = 'mx-info';
      [['date', 'Date'], ['from', 'De'], ['to', 'À'], ['subject', 'Sujet']].forEach(function (l) {
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
      de.innerHTML = '<span class="mx-lab">De</span><span class="mx-val"></span>';
      var moi = (window.state && window.state.user) || '';
      de.querySelector('.mx-val').textContent = moi + ' <' + moi + '@frutiparc.com>';
      form.insertBefore(de, form.firstChild);
    }
  }

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
      date: mailDateCourte(m.date),
      from: adr(m.from || (m.folder === 'outbox' ? moi : '')),
      to: adr(m.to || (m.folder === 'outbox' ? '' : moi)),
      subject: m.subject || '(sans sujet)',
    };
    Array.prototype.forEach.call(panneau.querySelectorAll('.mx-val[data-champ]'), function (e) {
      e.textContent = val[e.getAttribute('data-champ')] || '';
    });
  }

  // `but.icon.Detail.display` : `dateDsp = Lang.formatDateString(date,
  // "numeric")` — la date COURTE, jour/mois/année et l'heure.
  function mailDateCourte(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1].slice(2) + ' ' + m[4] + ':' + m[5] : String(s || '');
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
    [['shop-ico-journal', 'Journal des kikooz', function () {
      window.open('/club/', '_blank');           // le journal vit au Club
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
     LA FICHE (`win.Frutiz`, DoInitAction sprite#753 0x583ad)

     `win.Frutiz extends WinStandard` : une FENÊTRE. Rien ne s'assombrit
     derrière elle, et `initInterface` la rend glissable par son cadre —

         mcInterface.onPress = function() {
           this._parent.box.activate(); this._parent.initDrag();
         }
         mcInterface.onRelease = mcInterface.onReleaseOutside = endDrag

     Le mobile en fait une carte modale (sur un téléphone, une fenêtre
     flottante n'a nulle part où flotter) ; le bureau lui rend sa nature. */
  var ficheRang = 0;

  function ouvrirFiche(pseudo) {
    if (!window.ouvrirFicheJoueur) return;
    window.ouvrirFicheJoueur(pseudo);
    if (actif) poserFiche();
  }

  // `openWin` pose chaque nouvelle fenêtre en escalier : la fiche suit.
  function poserFiche() {
    var f = $('#fiche');
    if (!f) return;
    if (!f.dataset.posee) {
      ficheRang = (ficheRang + 1) % 8;
      f.style.setProperty('--fx', (200 + ficheRang * 22) + 'px');
      f.style.setProperty('--fy', (110 + ficheRang * 20) + 'px');
      f.dataset.posee = '1';
      glisserFiche(f);
      var rangee = f.querySelector('.fiche-actions');
      if (rangee) completerIconesFiche(rangee);
    }
    habillerIconesFiche();
    majGenreFiche(f);
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
  // #242169 pour un garçon, le rouge #BB4A44 pour une fille.
  function majGenreFiche(f) {
    var lire = function () {
      var d = window.ficheDerniere && window.ficheDerniere();
      f.classList.toggle('elle', !!(d && d.basic && d.basic.sexe === 'F'));
    };
    lire();
    setTimeout(lire, 500);
    setTimeout(lire, 1500);
  }

  // `initDrag` / `endDrag` : on l'attrape par son CADRE — tout le haut blanc,
  // sauf ce qui est déjà un bouton.
  function glisserFiche(f) {
    f.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      if (ev.target.closest('button, a, input, .fiche-corps')) return;
      ev.preventDefault();
      var b = f.getBoundingClientRect();
      var dx = ev.clientX - b.left, dy = ev.clientY - b.top;
      var bouge = function (e) {
        f.style.setProperty('--fx', Math.max(0, e.clientX - dx) + 'px');
        f.style.setProperty('--fy', Math.max(0, e.clientY - dy) + 'px');
      };
      var lache = function () {
        document.removeEventListener('pointermove', bouge);
        document.removeEventListener('pointerup', lache);
      };
      document.addEventListener('pointermove', bouge);
      document.addEventListener('pointerup', lache);
    });
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
        }
        // Le repère est relu à CHAQUE pas : le bureau bouge (la barre se
        // replie, la bande des contacts s'ouvre) et une boîte figée au départ
        // décalait la tuile de tout ce que le bureau avait bougé depuis.
        var app = bureau.getBoundingClientRect();
        tuile.style.left = Math.round(e2.clientX - app.left - decalX) + 'px';
        tuile.style.top = Math.round(e2.clientY - app.top - decalY) + 'px';
      };

      var lacher = function (e2) {
        tuile.removeEventListener('pointermove', glisser);
        tuile.removeEventListener('pointerup', lacher);
        tuile.removeEventListener('pointercancel', lacher);
        try { tuile.releasePointerCapture(e2.pointerId); } catch (e) { /* déjà rendu */ }
        if (!bouge) return;                       // simple clic : la rubrique s'ouvre
        tuile.classList.remove('en-main');
        tuile.style.left = (parseFloat(tuile.style.left) + ICONE_SAUT_X) + 'px';
        tuile.style.top = (parseFloat(tuile.style.top) + ICONE_SAUT_Y) + 'px';
        dernierGlisse = Date.now();
      };

      // Sur la TUILE, pas sur le document : avec la capture, c'est elle qui
      // reçoit tout, et les écouteurs partent avec elle si elle est retirée.
      tuile.addEventListener('pointermove', glisser);
      tuile.addEventListener('pointerup', lacher);
      tuile.addEventListener('pointercancel', lacher);
    });
  }

  // initResize/endResize (0x53a2e/0x53b2a) : le redimensionnement au fantôme —
  // decalSize garde l'écart entre la souris et le coin, les minima s'imposent
  // pendant le suivi, la taille ne s'applique qu'au lâcher.
  function rendreRedimensionnable(fen, poignee, minimum) {
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
        // La zone des bouilles compte combien d'écrans tiennent dans sa
        // hauteur : elle change de visage quand la fenêtre change de taille.
        majBouilles();
      };
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
   * D'époque chaque conversation a SA fenêtre ; le light n'en a qu'une, où
   * salons et discussions privées défilent tour à tour. C'est donc l'onglet
   * qui la porte qui clignote — ou celui du BUREAU si elle y est restée,
   * exactement comme le fait `box.Chat` en remontant d'abord la fenêtre au
   * premier plan avant d'avertir le slot.
   *
   * (Quirk d'origine, laissé de côté : `onSend` exige `passwd != undefined`
   * pour un salon, `onSendUser` exige l'inverse — les deux gardes se
   * contredisent. Le light avertit dans les deux cas, salons et privés.)
   */
  function avertirConversation() {
    var f = fenetres['chat-panel'];
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
  function menuDuSlot(idOnglet) {
    // `FPDesktop` n'a pas de menu : `bottom.but.onPress` teste
    // `getMenu().length > 0` et se contente d'activer le slot.
    if (idOnglet === 'bureau') return [];
    return [
      { titre: 'Vers bureau', faire: function () { versBureau(idOnglet); } },
      { titre: 'Fermer', faire: function () {
        var s = null;
        for (var i = 0; i < slots.length; i++) if (slots[i].id === idOnglet) s = slots[i];
        if (s) fermerFenetre(s.panneau);
      } },
    ];
  }

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
    // La barre du salon retourne à sa place d'origine avec le panneau — sans
    // le bouton d'avertissement, qui n'appartient qu'au bureau.
    if (f.topbar) {
      if (boutonWarning && boutonWarning.parentNode) boutonWarning.parentNode.removeChild(boutonWarning);
      rendre(f.topbar.noeud, f.topbar.origine);
    }
    rendre(f.panneau, f.origine);
    f.fen.remove();
    delete fenetres[idPanneau];
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

  function creerFenetre(rub, panneau) {
    var fen = document.createElement('div');
    fen.className = 'fen';
    fen.style.width = Math.min(rub.l, window.innerWidth - 24) + 'px';
    fen.style.height = Math.min(rub.h, window.innerHeight - CORNER_Y - 12) + 'px';
    // Les ouvertures se décalent en cascade sous le coin de la main bar et
    // sous la rangée d'icônes du haut (qu'une fenêtre neuve ne doit pas
    // recouvrir d'emblée — on peut toujours la déplacer ensuite).
    var place;
    if (rub.centre) {
      // `WinStandard.moveToCenter` (0x55bee) : la fenêtre se pose au milieu de
      // la zone utile, celle qui commence sous la main bar — et le SWF finit
      // par `recal(); moveToPos()`, donc elle Y GLISSE, elle n'y saute pas.
      place = {
        x: Math.max(12, Math.round((window.innerWidth - rub.l) / 2)),
        y: Math.max(CORNER_Y + 6,
          Math.round(CORNER_Y + (window.innerHeight - CORNER_Y - rub.h) / 2)),
      };
    } else {
      place = {
        x: Math.min(450 + (cascade % 6) * 26, window.innerWidth - rub.l - 12),
        y: 185 + (cascade % 6) * 24,
      };
      if (place.x < 12) place.x = 12;
      cascade++;
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
      if (e.ctrlKey || e.metaKey) { mettreEnOnglet(panneau.id, true); return; }
      fen.classList.add('fen-glisse');
      var apres = function () {
        fen.removeEventListener('transitionend', apres);
        fen.classList.remove('fen-glisse');
        // Clic ordinaire : la fenêtre se RANGE, on reste sur le bureau.
        mettreEnOnglet(panneau.id, false);
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
      fen: fen, corps: corps, panneau: panneau, minimum: minimum,
      origine: deplacer(panneau, corps),
      txt: txt, pastille: pastille, topbar: null,
      // Le fruit du type de fenêtre : le bandeau ET l'onglet le portent —
      // c'est `getIconLabel()` qui le donne, une fois pour les deux.
      fruit: rub.fruit || null, onglet: null, poseBureau: null,
    };
    fermer.addEventListener('click', function () { fermerFenetre(panneau.id); });
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

  function ouvrirFenetre(tab) {
    // Le forum n'est pas une fenêtre du bureau : `win.Forum` renvoie vers
    // l'extérieur (cf. `ouvrirForum`). Quel que soit le chemin qui mène ici —
    // une tuile, un lien profond, `apresActivateTab` — il sort de la page.
    if (tab === 'forum') return ouvrirForum();
    var rub = RUBRIQUES[tab];
    if (!rub) return;
    // « Salons publics » n'a pas de panneau mobile à emprunter : on le bâtit
    // au premier appel et on le range dans #app, hors écran tant qu'il n'est
    // pas `.active` — c'est de là que le reparentage le prendra, et c'est là
    // qu'il retournera à la fermeture.
    if (tab === 'salons' && !$(rub.panneau)) $('#app').appendChild(panneauSalons());
    var panneau = $(rub.panneau);
    if (!panneau) return;
    var f = fenetres[panneau.id];
    if (!f) {
      f = creerFenetre(rub, panneau);
      fenetres[panneau.id] = f;
      // La fenêtre du salon embarque la barre du haut (choix du salon,
      // feutre, bouilles, connectés) : c'est SA barre d'outils.
      if (tab === 'chat') {
        var topbar = $('#topbar');
        // La colonne d'icônes appartient à la MARGE GAUCHE de la fenêtre, pas
        // à un bandeau au-dessus : `displayLeftIconList` (0x69384) la pose
        // dans `margin.left`, et la pile des bouilles vient dessous quand elle
        // s'ouvre. Elle entre donc DANS le panneau, où la grille lui donne sa
        // colonne — sans quoi le fil de discussion se retrouverait poussé de
        // 24 px vers le bas dès qu'on met les icônes en rangée.
        if (topbar) f.topbar = { noeud: topbar, origine: deplacer(topbar, panneau) };
        if (f.topbar) {
          panneau.insertBefore(topbar, panneau.firstChild);
          topbar.appendChild(warningSalon());
          brancherBouillesSalon(f);
        }
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
    panneau.classList.add('active');
    if (tab === 'chat') majTitreSalon();
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
    var pilule = $('#pill-enligne');
    if (pilule) pilule.style.transform = f;
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

  // La pilule « N en ligne » : le même décompte que le tiroir « site » du
  // light (/api/light/online), rafraîchi sans hâte — la pilule d'époque
  // n'était qu'un compteur, le détail vit ailleurs.
  function majEnLigne() {
    var sid = window.state && window.state.sid;
    if (!sid) return;
    fetch('/api/light/online?sid=' + encodeURIComponent(sid), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) return;
        var n = Math.max(1, (d.users || []).length);
        var el = $('#pill-enligne-txt');
        if (el) el.textContent = n + ' en ligne';
      })
      .catch(function () {});
  }

  // ── LE CLIGNOTEMENT DU PREMIER SURVOL ────────────────────────────────
  //
  // Les états d'un bouton sont trois DESSINS distincts (`_up`, `_over`,
  // `_down`) posés en `background-image`. Le navigateur ne va chercher un
  // dessin qu'au moment où la règle s'applique : au tout premier survol, la
  // pièce disparaît le temps du chargement, puis revient — et ne cligne plus
  // jamais. Flash, lui, avait tout en mémoire dès la première image.
  //
  // On lit donc la feuille de style du bureau et on demande TOUTES ses images
  // d'un coup. Une seule requête (le fichier est déjà en cache), et le reste
  // part en parallèle sans rien bloquer.
  var precharge = [];                   // on garde les Image vivantes le temps du chargement
  function prechargerImages() {
    fetch('/bureau-frutiz.css', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (css) {
        var vues = {};
        var re = /url\(\s*['"]?(\/[^'")]+)['"]?\s*\)/g;
        var m;
        while ((m = re.exec(css))) {
          if (vues[m[1]]) continue;
          vues[m[1]] = true;
          var img = new Image();
          img.src = m[1];
          precharge.push(img);
        }
      })
      .catch(function () {});
  }

  function demarrer() {
    if (actif) return;
    actif = true;
    document.body.classList.add('bureau-frutiz');
    prechargerImages();
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

    // La pilule « N en ligne » (coin haut-droit, bord à Stage.width − 6).
    var pilule = document.createElement('div');
    pilule.id = 'pill-enligne';
    var point = document.createElement('span');
    point.className = 'point';
    var piluleTxt = document.createElement('span');
    piluleTxt.id = 'pill-enligne-txt';
    piluleTxt.textContent = '1 en ligne';
    pilule.appendChild(point);
    pilule.appendChild(piluleTxt);
    pilule.appendChild(document.createTextNode(' ▾'));
    haut.appendChild(pilule);
    majEnLigne();
    setInterval(majEnLigne, 60000);

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
    bande.querySelector('.sl-recherche').addEventListener('click', function () {
      // `butSearch.onPress` ouvre la fenêtre « search » (uniqWinMng.open).
      // Le light n'a pas d'annuaire : le Bouilloscope en tient lieu.
      var tuile = $('#bureau .home-tile[data-go="trombi"]');
      if (tuile) tuile.click();
    });

    // La main bar quitte le tiroir : c'est le meuble du bureau maintenant.
    // (La bannière quotidienne reste au tiroir : main.swf n'a pas de bandeau
    // — la « Connexion quotidienne : +10 kikooz » se lit dans l'historique.)
    var mainbar = $('#home-panel .mainbar');
    if (mainbar) coin.appendChild(mainbar);
    var grille = $('#home-grid');
    if (grille) { bureau.appendChild(grille); rendreIconesDeplacables(grille, bureau); }
    var compte = $('#home-panel .home-compte');
    if (compte) bureau.appendChild(compte);

    poserFond(fondCourant);
    // Ce que le joueur a posé sur son bureau : `FPDesktop` s'abonne à `fileMng`
    // sur « root » dès son `init`, et le portage relit la même liste.
    chargerObjetsBureau();
    window.addEventListener('resize', function () {
      poserFond(fondCourant);
      for (var id in fenetres) bornerDansEcran(fenetres[id].fen);
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
    // Les deux explorateurs : « Mes disques » et « Inventaire ».
    ouvrirDisques: function () { ouvrirExplorateur('disques'); },
    ouvrirInventaire: function () { ouvrirExplorateur('inventaire'); },
    // La boutique : une FENÊTRE sur le bureau, la feuille du mobile ailleurs.
    ouvrirBoutique: ouvrirBoutique,
    // Le forum : ni fenêtre ni cadre, une FENÊTRE DE NAVIGATEUR à part —
    // `win.Forum` ne fait rien d'autre que renvoyer dehors.
    ouvrirForum: ouvrirForum,
    // La fiche : au bureau c'est une fenêtre, elle se pose et se glisse.
    poserFiche: poserFiche,
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
    retitrer: retitrer,
    // `box.Chat.onSend` : une trame de conversation avertit son slot. L'onglet
    // qui porte la fenêtre des salons (ou celui du bureau si elle y est
    // restée) se teinte de rose tant qu'on ne l'a pas rappelé.
    avertirConversation: avertirConversation,
    majBouilles: majBouilles,
    majListeConnectes: majListeConnectes,
    ecranDe: ecranDe,
    actif: function () { return actif; },
  };
})();
