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
    chat:       { panneau: '#chat-panel',      titre: 'Salons',         fruit: 'winChat', l: 780, h: 580 },
    forum:      { panneau: '#forum-panel',     titre: 'Forum',          l: 920, h: 640 },
    scores:     { panneau: '#scores-panel',    titre: 'Scores',         l: 720, h: 620 },
    mail:       { panneau: '#mail-panel',      titre: 'Messagerie',     l: 640, h: 560 },
    evenements: { panneau: '#evt-panel',       titre: 'Événements',     l: 560, h: 560 },
    historique: { panneau: '#evt-panel',       titre: 'Mon historique', l: 560, h: 560 },
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
  function recal(pos, minimum) {
    var vw = window.innerWidth, vh = window.innerHeight;
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
      var b = e.target && e.target.closest && e.target.closest('#bouille-toggle');
      if (!b) return;
      e.stopPropagation();
      e.preventDefault();
      var p = $('#chat-panel');
      var t = $('#topbar');
      if (!p) return;
      var ouvert = p.classList.toggle('bouilles-ouvertes');
      if (t) t.classList.toggle('en-rangee', ouvert);
      if (ouvert) majBouilles();
    }, true);
  }

  // ── LA COLONNE DES BOUILLES (`cp.ScreenList`) ─────────────────────────────
  // D'époque, ce panneau n'est pas une surimpression : c'est une PILE d'écrans
  // de 100×100 (`cp.FrutiScreen`), un par personne du salon, dans l'ordre de
  // la liste des connectés. Le light, lui, s'en servait pour montrer la bouille
  // de qui venait de parler, en gros, par-dessus le fil.
  //
  // On rend donc la colonne d'époque, et on la remplit d'IMAGES — le cache PNG
  // partagé du site (`FPBouilleThumb`, le même que le Bouilloscope et le
  // trombinoscope) — plutôt que d'un lecteur Flash par personne : un salon
  // plein ne coûte alors que des images déjà en cache. Le lecteur, il n'y en a
  // qu'UN, et il ne s'allume que le temps d'une émotion (cf. `ecranDe`).
  function ecranDe(pseudo) {
    var col = $('#bouille-overlay');
    var p = $('#chat-panel');
    if (!col || !p || !p.classList.contains('bouilles-ouvertes')) return null;
    return col.querySelector('.bo-ecran[data-qui="' + cleCss(String(pseudo).toLowerCase()) + '"]');
  }
  // `CSS.escape` n'est pas partout ; un pseudo n'a de toute façon que des
  // lettres, des chiffres, `_` et `-`, on s'en tient là.
  function cleCss(s) { return s.replace(/["\\\]]/g, ''); }

  function majBouilles() {
    var col = $('#bouille-overlay');
    var p = $('#chat-panel');
    if (!col || !p || !p.classList.contains('bouilles-ouvertes')) return;
    var S = window.SalonsBureau;
    var gens = (S && S.membres) ? S.membres() : [];
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
      ecran.title = g.pseudo;
      // On ne refait la vignette que si la bouille a changé : sinon elle
      // clignoterait à chaque relevé des connectés.
      if (ecran.getAttribute('data-bouille') !== g.bouille) {
        ecran.setAttribute('data-bouille', g.bouille);
        var vieux = ecran.querySelector('img');
        if (vieux) vieux.remove();
        // `detourer` retire le vert plat sur lequel la capture est peinte
        // (#E8F8D3, le fond des cartes du forum) : ici c'est le DÉGRADÉ de
        // l'écran qui doit se voir derrière la bouille, pas un carré pâle.
        if (window.FPBouilleThumb) {
          ecran.insertAdjacentHTML('afterbegin', FPBouilleThumb.imgHtml(g.bouille, 0, { detourer: true }));
        }
      }
    });
    // Qui a quitté le salon perd son écran — sauf s'il est en train de jouer
    // une émotion : la scène du light y est logée, on ne l'arrache pas.
    Array.prototype.slice.call(col.querySelectorAll('.bo-ecran')).forEach(function (e) {
      if (!vus[e.getAttribute('data-qui')] && !e.querySelector('#bouille-overlay-stage')) e.remove();
    });
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
      var fantome = creerFantome(pos);
      var decalSizeX = pos.w - ev.clientX;
      var decalSizeY = pos.h - ev.clientY;
      var taille = { w: pos.w, h: pos.h };
      var suivre = function (e2) {
        taille.w = Math.max(minimum.w, e2.clientX + decalSizeX);
        taille.h = Math.max(minimum.h, e2.clientY + decalSizeY);
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
      };
      document.addEventListener('pointermove', suivre);
      document.addEventListener('pointerup', lacher);
    });
  }

  function fermerFenetre(idPanneau) {
    var f = fenetres[idPanneau];
    if (!f) return;
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
  }

  function creerFenetre(rub, panneau) {
    var fen = document.createElement('div');
    fen.className = 'fen';
    fen.style.width = Math.min(rub.l, window.innerWidth - 24) + 'px';
    fen.style.height = Math.min(rub.h, window.innerHeight - CORNER_Y - 12) + 'px';
    // Les ouvertures se décalent en cascade sous le coin de la main bar et
    // sous la rangée d'icônes du haut (qu'une fenêtre neuve ne doit pas
    // recouvrir d'emblée — on peut toujours la déplacer ensuite).
    fen.style.left = Math.min(450 + (cascade % 6) * 26, window.innerWidth - rub.l - 12) + 'px';
    fen.style.top = (185 + (cascade % 6) * 24) + 'px';
    if (parseFloat(fen.style.left) < 12) fen.style.left = '12px';
    cascade++;

    var titre = document.createElement('div');
    titre.className = 'fen-titre';
    var pastille = document.createElement('span');
    pastille.className = 'fen-pastille';
    pastille.style.backgroundImage = 'url(' + fruitUrl(rub.fruit) + ')';
    var txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = rub.titre;
    // Les vrais boutons du bandeau (butGroupWinTop) : l'enroulement puis la
    // croix, la croix au bord — l'ordre du bureau Flash.
    var plier = document.createElement('button');
    plier.className = 'fen-btn plier';
    plier.title = 'Replier';
    plier.addEventListener('click', function () { fen.classList.toggle('pliee'); });
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
    var poignee = document.createElement('div');
    poignee.className = 'fen-poignee';
    poignee.title = 'Redimensionner';
    fen.appendChild(poignee);
    fen.addEventListener('pointerdown', function () { premierPlan(fen); });
    rendreDeplacable(fen, titre);
    rendreRedimensionnable(fen, poignee, minimum);
    $('#bureau-fenetres').appendChild(fen);
    premierPlan(fen);

    var f = {
      fen: fen, corps: corps, panneau: panneau, minimum: minimum,
      origine: deplacer(panneau, corps),
      txt: txt, pastille: pastille, topbar: null,
    };
    fermer.addEventListener('click', function () { fermerFenetre(panneau.id); });
    return f;
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
        if (topbar) f.topbar = { noeud: topbar, origine: deplacer(topbar, f.corps) };
        if (f.topbar) {
          f.corps.insertBefore(topbar, f.corps.firstChild);
          topbar.appendChild(warningSalon());
          brancherBouillesSalon(f);
        }
      }
    } else {
      f.fen.classList.remove('pliee');
      premierPlan(f.fen);
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

    // L'ONGLET « Bureau » (MainBarTab #781) : les deux clips extraits —
    // tabFond (la silhouette sombre) sous tab (la plaque + l'orange) — dans
    // leur cadre commun (x −17.5, y −18, 123×41.5), posés à l'origine de la
    // barre d'onglets (mcTab._y = height = 76). Le label est le champ #190 :
    // Verdana 10 gras #000000, lié au titre du slot (« Bureau »).
    var onglet = document.createElement('div');
    onglet.id = 'onglet-bureau';
    var ongletLabel = document.createElement('span');
    ongletLabel.textContent = 'Bureau';
    onglet.appendChild(ongletLabel);
    haut.appendChild(onglet);          // sous la barre (tabBlack 4 < tab 8 < interface 10)
    haut.appendChild(coin);

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
    });
  }

  return {
    demarrer: demarrer,
    apresActivateTab: apresActivateTab,
    poserFond: poserFond,
    // La tuile « Salons » du bureau ouvre la LISTE, pas la conversation :
    // c'est le double-clic sur « Les salons » du bureau d'époque.
    ouvrirSalonsPublics: ouvrirSalonsPublics,
    // Rappelé par renderRoomOptions : l'affluence des salons bouge, la
    // fenêtre la suit — et la fenêtre du salon se retitre au changement.
    majSalons: function () { majSalons(); majTitreSalon(); },
    // Rappelés par le light : la colonne des bouilles suit la liste des
    // connectés, et une émotion joue dans l'écran de la personne.
    majBouilles: majBouilles,
    ecranDe: ecranDe,
    actif: function () { return actif; },
  };
})();
