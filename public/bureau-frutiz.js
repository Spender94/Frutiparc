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
    forum:      { panneau: '#forum-panel',     titre: 'Forum',          l: 920, h: 640 },
    // LES SCORES — `box.Score` (0xade18). Relevé 1:1 : 610 × 328, cadre
    // `#444444` compris ; la colonne de gauche fait 160 et celle de droite
    // 430, six pixels entre les deux.
    scores:     { panneau: '#scores-panel',    titre: 'Scores',         l: 610, h: 328 },
    mail:       { panneau: '#mail-panel',      titre: 'Messagerie',     l: 640, h: 560 },
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
      var cornerY = coin ? coin.offsetHeight + coin.offsetTop : 0;
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
  // sa place (le coefficient 3 d'animList.addSlide) si l'animation est active.
  var FLUIDE = true;                    // la préférence win_flMoveAnim du SWF

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

  function bornerDansEcran(fen) {
    var f = null;
    for (var id in fenetres) if (fenetres[id].fen === fen) f = fenetres[id];
    var pos = recal(posDe(fen), (f && f.minimum) || { w: 160, h: 60 });
    fen.style.left = Math.round(pos.x) + 'px';
    fen.style.top = Math.round(pos.y) + 'px';
  }

  // moveToPos (0x55b47) : le glissement vers la place — chaque image (au pas
  // du lecteur, 25 ms) la fenêtre parcourt UN TIERS du chemin restant.
  function glisserVers(fen, cible) {
    if (fen._glisse) clearInterval(fen._glisse);
    if (!FLUIDE) {
      fen.style.left = Math.round(cible.x) + 'px';
      fen.style.top = Math.round(cible.y) + 'px';
      return;
    }
    fen._glisse = setInterval(function () {
      var x = parseFloat(fen.style.left) || 0;
      var y = parseFloat(fen.style.top) || 0;
      x += (cible.x - x) / 3;
      y += (cible.y - y) / 3;
      if (Math.abs(cible.x - x) < 0.5 && Math.abs(cible.y - y) < 0.5) {
        x = cible.x; y = cible.y;
        clearInterval(fen._glisse); fen._glisse = null;
      }
      fen.style.left = Math.round(x) + 'px';
      fen.style.top = Math.round(y) + 'px';
    }, 25);
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
  var contactsCharges = false;

  function basculerContacts() {
    var ouvert = document.body.classList.toggle('contacts-ouverts');
    CORNER_X = ouvert ? 129 : 9;
    // `activate` termine par `main.onResize()` : les fenêtres sont rebornées.
    for (var id in fenetres) bornerDansEcran(fenetres[id].fen);
    if (ouvert && !contactsCharges) { contactsCharges = true; chargerContacts(); }
  }

  function ligneContact(c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sl-contact ' + (c.enLigne ? 'en-ligne' : 'hors-ligne');
    b.title = c.pseudo + (c.jeu ? ' — joue à ' + c.jeu : (c.enLigne ? ' — en ligne' : ' — hors ligne'));
    b.innerHTML = '<span class="voyant"></span><span class="nom"></span>';
    b.querySelector('.nom').textContent = c.pseudo;
    b.addEventListener('click', function () { ouvrirFiche(c.pseudo); });
    return b;
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
    var f = document.createElement('iframe');
    f.setAttribute('scrolling', 'no');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    f.setAttribute('tabindex', '-1');
    f.src = '/bouille-preview.html?s=' + encodeURIComponent(String(etat || '').replace(/[^0-9A-Za-z]/g, ''))
      + '&bg=transparent';
    c.appendChild(f);
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
    return caseExplorateur({
      classe: 'ex-slot-disque',
      dessin: dessinDisque(type, jeu),
      titre: tab ? 'Jouer' : 'Ce disque ne se lit que sur la version Flash',
      faire: tab && window.activateTab ? function () { window.activateTab(tab); } : null,
    });
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
    var vieux = ecran.querySelector('img');
    if (vieux) vieux.remove();
    // `detourer` retire le vert plat sur lequel la capture est peinte
    // (#E8F8D3, le fond des cartes du forum) : ici c'est le DÉGRADÉ de
    // l'écran qui doit se voir derrière la bouille, pas un carré pâle.
    if (window.FPBouilleThumb) {
      ecran.insertAdjacentHTML('afterbegin', FPBouilleThumb.imgHtml(bouille, 0, { detourer: true }));
    }
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
        liste.textContent = '';
        if (!d || !d.ok) return;
        // Carnet vide : la bande reste BLANCHE, sans un mot. C'est ce que fait
        // le SWF — `buildList` ne parcourt rien et n'écrit rien.
        (d.dossiers || []).forEach(function (f) {
          var bloc = document.createElement('div');
          bloc.className = 'sl-dossier';
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

  // Le clic sur un contact ouvre SA FICHE, comme le `userSlot` du bureau.
  function ouvrirFiche(pseudo) {
    if (window.ouvrirFicheJoueur) window.ouvrirFicheJoueur(pseudo);
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
      var boite = tuile.getBoundingClientRect();
      var app = bureau.getBoundingClientRect();
      var departX = ev.clientX, departY = ev.clientY;
      var bouge = false;
      // Le décalage du curseur DANS la tuile, pour qu'elle ne saute pas sous
      // la main au premier pixel de mouvement.
      var decalX = ev.clientX - boite.left, decalY = ev.clientY - boite.top;
      var trou = null;

      var glisser = function (e2) {
        if (!bouge) {
          if (Math.abs(e2.clientX - departX) < 4 && Math.abs(e2.clientY - departY) < 4) return;
          bouge = true;
          // La case libérée reste OUVERTE : on laisse un espaceur de la même
          // largeur, sinon la rangée se refermerait — d'époque elle ne le
          // fait pas.
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
        tuile.style.left = Math.round(e2.clientX - app.left - decalX) + 'px';
        tuile.style.top = Math.round(e2.clientY - app.top - decalY) + 'px';
      };

      var lacher = function () {
        document.removeEventListener('pointermove', glisser);
        document.removeEventListener('pointerup', lacher);
        if (!bouge) return;                       // simple clic : la rubrique s'ouvre
        tuile.classList.remove('en-main');
        tuile.style.left = (parseFloat(tuile.style.left) + ICONE_SAUT_X) + 'px';
        tuile.style.top = (parseFloat(tuile.style.top) + ICONE_SAUT_Y) + 'px';
        dernierGlisse = Date.now();
      };

      document.addEventListener('pointermove', glisser);
      document.addEventListener('pointerup', lacher);
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
  var slots = [];                       // [{ id, titre, fruit, panneau }] — 'bureau' en tête
  var slotActif = 'bureau';
  var ongletBureau = null;

  function creerOnglet(id, titre, fruit) {
    var o = document.createElement('div');
    o.className = 'fb-onglet';
    o.setAttribute('data-slot', id);
    // La pastille : c'est `getIconLabel()` du slot qui la choisit — l'orange
    // du bureau, la banane d'un explorateur, la fraise d'un salon… La plaque
    // extraite du SWF porte l'orange en dur : on sert donc la plaque NUE
    // (onglet_plaque.svg) et on pose la pastille par-dessus, à la place exacte
    // qu'elle occupe dans le clip d'origine.
    if (id !== 'bureau') {
      o.style.backgroundImage = 'url(' + fruitUrl(fruit) + '), '
        + "url('/frutiz/sprites/onglet_plaque.svg'), url('/frutiz/sprites/onglet_fond.svg')";
    }
    var lab = document.createElement('span');
    lab.textContent = titre;
    o.appendChild(lab);
    o.addEventListener('click', function () { activerSlot(id); });
    // Le menu de l'onglet (`FPTab.getMenu`) : deux entrées, sur le clic droit.
    o.addEventListener('contextmenu', function (e) {
      if (id === 'bureau') return;
      e.preventDefault();
      menuOnglet(id, e.clientX, e.clientY);
    });
    $('#bureau-onglets').appendChild(o);
    return o;
  }

  // `_global.main.tabSpace` : les onglets se posent à `id × 110`, le premier à
  // l'origine de la barre. La plaque déborde de 17,5 px à gauche de son cadre
  // (cf. le SVG) — d'où le −18,5 de la mise en place.
  function dessinerOnglets() {
    var barre = $('#bureau-onglets');
    if (!barre) return;
    var liste = [{ id: 'bureau' }].concat(slots);
    for (var i = 0; i < barre.children.length; i++) {
      var o = barre.children[i];
      var id = o.getAttribute('data-slot');
      var rang = -1;
      for (var j = 0; j < liste.length; j++) if (liste[j].id === id) rang = j;
      if (rang < 0) { o.remove(); i--; continue; }
      o.style.left = (rang * 110) + 'px';
      o.classList.toggle('actif', id === slotActif);
    }
  }

  function activerSlot(id) {
    if (slotActif === id) return;
    var avant = slotActif;
    slotActif = id;
    // Le bureau s'escamote quand un onglet prend la main (FPDesktop.onDeactivate
    // cache `mcDesk` ET la rangée d'icônes), et revient quand on le rappelle.
    document.body.classList.toggle('fb-onglet-actif', id !== 'bureau');
    if (id === 'bureau' && ongletBureau) ongletBureau.classList.remove('clignote');
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      var f = fenetres[s.panneau];
      if (!f) continue;
      f.fen.classList.toggle('fen-onglet-vue', s.id === id);
    }
    if (avant !== id) dessinerOnglets();
  }

  /** Le « ─ » du bandeau : la fenêtre quitte le bureau pour un onglet. */
  function mettreEnOnglet(idPanneau) {
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
    activerSlot(id);
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

  // Le menu de `FPTab` : « Vers bureau » puis « Fermer ». Un menu tout simple,
  // posé au curseur et refermé au premier clic ailleurs.
  function menuOnglet(idOnglet, x, y) {
    var vieux = $('#fb-menu-onglet');
    if (vieux) vieux.remove();
    var m = document.createElement('div');
    m.id = 'fb-menu-onglet';
    m.style.left = Math.round(x) + 'px';
    m.style.top = Math.round(y) + 'px';
    var entrees = [
      { titre: 'Vers bureau', faire: function () { versBureau(idOnglet); } },
      { titre: 'Fermer', faire: function () {
        var s = null;
        for (var i = 0; i < slots.length; i++) if (slots[i].id === idOnglet) s = slots[i];
        if (s) fermerFenetre(s.panneau);
      } },
    ];
    entrees.forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = e.titre;
      b.addEventListener('click', function () { m.remove(); e.faire(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    setTimeout(function () {
      document.addEventListener('pointerdown', function fermer() {
        m.remove();
        document.removeEventListener('pointerdown', fermer);
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
  }

  function creerFenetre(rub, panneau) {
    var fen = document.createElement('div');
    fen.className = 'fen';
    fen.style.width = Math.min(rub.l, window.innerWidth - 24) + 'px';
    fen.style.height = Math.min(rub.h, window.innerHeight - CORNER_Y - 12) + 'px';
    // Les ouvertures se décalent en cascade sous le coin de la main bar et
    // sous la rangée d'icônes du haut (qu'une fenêtre neuve ne doit pas
    // recouvrir d'emblée — on peut toujours la déplacer ensuite).
    if (rub.centre) {
      // `WinStandard.moveToCenter` : la fenêtre se pose au milieu de la zone
      // utile, celle qui commence sous la main bar.
      fen.style.left = Math.max(12, Math.round((window.innerWidth - rub.l) / 2)) + 'px';
      fen.style.top = Math.max(CORNER_Y + 6,
        Math.round(CORNER_Y + (window.innerHeight - CORNER_Y - rub.h) / 2)) + 'px';
    } else {
      fen.style.left = Math.min(450 + (cascade % 6) * 26, window.innerWidth - rub.l - 12) + 'px';
      fen.style.top = (185 + (cascade % 6) * 24) + 'px';
      if (parseFloat(fen.style.left) < 12) fen.style.left = '12px';
      cascade++;
    }

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
      if (e.ctrlKey || e.metaKey) { mettreEnOnglet(panneau.id); return; }
      fen.classList.add('fen-glisse');
      var apres = function () {
        fen.removeEventListener('transitionend', apres);
        fen.classList.remove('fen-glisse');
        mettreEnOnglet(panneau.id);
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
    if (!f.onglet && slotActif !== 'bureau' && ongletBureau) {
      ongletBureau.classList.add('clignote');
    }
    // #evt-panel sert deux rubriques : la fenêtre prend le titre demandé.
    f.txt.textContent = rub.titre;
    f.pastille.style.backgroundImage = 'url(' + fruitUrl(rub.fruit) + ')';
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

  // LA ROUE DES FRUTISIGNES (wheel.FruitMonth #777, RunDate.getCurrentFSign
  // 0xbbf73). La loi d'époque, au chiffre près :
  //     t     = getTime() / 1000
  //     signe = floor(((t − 345600) / 604800) % 10)
  //     part  =      ((t − 345600) / 604800) % 1
  // 604800 s = UNE SEMAINE par signe, dix signes qui tournent ; 345600 = le
  // décalage d'origine (4 jours). Et update() pose la rotation :
  //     setRot((signe + part) × 36)   — 36° par signe, 360 pour le tour.
  // Vérifié : au moment de la capture de référence le signe était le KIWI,
  // et c'est bien le kiwi qui trône au centre du cadran, citron à sa gauche
  // et raisin à sa droite.
  function tournerMandala(roue) {
    var t = Date.now() / 1000;
    var signe = Math.floor(((t - 345600) / 604800) % 10);
    var part = ((t - 345600) / 604800) % 1;
    roue.style.transform = 'rotate(' + ((signe + part) * 36).toFixed(2) + 'deg)';
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

  function demarrer() {
    if (actif) return;
    actif = true;
    document.body.classList.add('bureau-frutiz');
    var app = $('#app');

    var bureau = document.createElement('div');
    bureau.id = 'bureau';
    var couche = document.createElement('div');
    couche.id = 'bureau-fenetres';
    // La couche HAUTE : la barre et ses meubles, AU-DESSUS des fenêtres —
    // les profondeurs du SWF (la main bar recouvre ce qui s'en approche,
    // recal borne d'ailleurs les fenêtres sous cornerY).
    var haut = document.createElement('div');
    haut.id = 'bureau-haut';
    var coin = document.createElement('div');
    coin.id = 'bureau-coin';
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
    haut.appendChild(barreOnglets);    // sous la barre (tabBlack 4 < tab 8 < interface 10)
    haut.appendChild(coin);
    ongletBureau = creerOnglet('bureau', 'Bureau', null);
    dessinerOnglets();

    // La boîte de la FRUSION (le lecteur de disques, en haut à droite) : le
    // même chrome que la barre — blanc, liseré #DDD, contour #444, coins bas
    // arrondis — hauteur 76, calée à 8 px du bord (le contour tombe à
    // Stage.width − 6, comme la pilule). Son contenu (la console) viendra
    // avec la transcription de FrusionSlot.
    var frusion = document.createElement('div');
    frusion.id = 'frusion-boite';
    haut.appendChild(frusion);

    // LA FRUTIMANDALA (cpWheelMng #640) : trois couches, comme les
    // profondeurs du SWF — le châssis de FOND (profondeur 1), la ROUE des
    // frutisignes à la place du cadran (profondeur 3), puis les boutons et
    // le verre par-dessus (profondeurs 8 à 25).
    var mandala = document.createElement('div');
    mandala.id = 'frutimandala';
    // Le cadran MASQUE la roue : le châssis la recouvre sur ses 6 px du haut
    // (relevé au centre — le vert d'époque ne commence qu'à y 8).
    var cadran = document.createElement('div');
    cadran.className = 'cadran';
    var roue = document.createElement('div');
    roue.className = 'roue';
    cadran.appendChild(roue);
    var dessus = document.createElement('div');
    dessus.className = 'dessus';
    mandala.appendChild(cadran);
    mandala.appendChild(dessus);
    // Elle vit DANS la barre (c'est le dernier élément de son frameSet), pas
    // sur l'écran : sa marge droite se compte donc depuis le bord de la barre.
    coin.appendChild(mandala);
    tournerMandala(roue);
    setInterval(function () { tournerMandala(roue); }, 60000);

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
    window.addEventListener('resize', function () {
      poserFond(fondCourant);
      for (var id in fenetres) bornerDansEcran(fenetres[id].fen);
      majBouilles();
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
    // Rappelé par renderRoomOptions : l'affluence des salons bouge, la
    // fenêtre la suit — et la fenêtre du salon se retitre au changement.
    majSalons: function () { majSalons(); majTitreSalon(); },
    // Rappelés par le light : la colonne des bouilles suit la liste des
    // connectés, et une émotion joue dans l'écran de la personne.
    ajusterJournal: ajusterJournal,
    retitrer: retitrer,
    majBouilles: majBouilles,
    majListeConnectes: majListeConnectes,
    ecranDe: ecranDe,
    actif: function () { return actif; },
  };
})();
