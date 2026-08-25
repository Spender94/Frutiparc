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
    // La barre du salon retourne à sa place d'origine avec le panneau.
    if (f.topbar) rendre(f.topbar.noeud, f.topbar.origine);
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
        if (f.topbar) f.corps.insertBefore(topbar, f.corps.firstChild);
      }
    } else {
      f.fen.classList.remove('pliee');
      premierPlan(f.fen);
    }
    // #evt-panel sert deux rubriques : la fenêtre prend le titre demandé.
    f.txt.textContent = rub.titre;
    f.pastille.style.backgroundImage = 'url(' + fruitUrl(rub.fruit) + ')';
    panneau.classList.add('active');
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
    // quel, collé en bas comme `butContact._y = 800`. Le dépliement de la
    // liste (wMain 120, activate/toggle) viendra avec l'étape des contacts ;
    // ici c'est le décor, au relevé près.
    var bande = document.createElement('div');
    bande.id = 'side-list';
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

    // La main bar quitte le tiroir : c'est le meuble du bureau maintenant.
    // (La bannière quotidienne reste au tiroir : main.swf n'a pas de bandeau
    // — la « Connexion quotidienne : +10 kikooz » se lit dans l'historique.)
    var mainbar = $('#home-panel .mainbar');
    if (mainbar) coin.appendChild(mainbar);
    var grille = $('#home-grid');
    if (grille) bureau.appendChild(grille);
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
    actif: function () { return actif; },
  };
})();
