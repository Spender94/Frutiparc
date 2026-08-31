'use strict';
/*
 * LES FRUTICARDS — `Standard.getFrutiCardLines` (main.swf, 0x5c370)
 * ═════════════════════════════════════════════════════════════════
 *
 * La « fruticard » d'un jeu, c'est sa fiche de sauvegarde DESSINÉE : ce que le
 * joueur a fait dans le jeu complet — coupes, records, collections, tableau de
 * chasse. Le bureau d'époque la montre dans l'onglet « Scores » de la fiche,
 * sous un titre « Fruticard ! » qui liste les jeux ; un clic sur un nom
 * remplace la page par la carte (`win.Frutiz.loadFrutiCard` → `onFrutiCard`).
 *
 * OÙ EST LE MOTEUR. Pas dans `frutiparc/Standard.as` : la `getFrutiCardLines`
 * qu'on y lit est COMMENTÉE, ne traite que `bkiwi` avec des données bidon et
 * porte l'aveu de son auteur — « DEVRAIT ETRE PLACE DANS UN SWF EXTERNE D'UNE
 * MANIERE OU D'UNE AUTRE ». La vraie vit dans main.swf, à 0x5c370, et fait
 * 4351 lignes de bytecode. Elle traite SEPT jeux :
 *
 *     bkiwi 0x5c618 · snake3 0x5cde6 · grapiz/bandas 0x5d4e8 (rien) ·
 *     swapou2 0x5d532 · mb2 0x5d9cd · kaluga 0x5df1a · miniwave 0x5e868 ·
 *     minipixiz 0x5f285
 *
 * Grapiz et Frutibandas n'ont PAS de carte : leur branche retombe sur le
 * retour commun.
 *
 * COMMENT ON LA LIT. La fonction ne calcule presque rien : elle DÉCRIT. Des
 * objets littéraux — `{ type:"text", width:80, param:{…} }` — empilés dans un
 * tableau `lines`. Le module ci-dessous en est la TRANSCRIPTION : mêmes noms
 * de champs, mêmes largeurs, mêmes ordres, pour qu'on puisse le relire en
 * face du bytecode. (`scratchpad/decode-fcard.js`, un évaluateur symbolique de
 * la pile AVM1, a servi à sortir les formes : les lire à l'œil, c'est se
 * tromper — `InitObject`/`InitArray` dépilent À L'ENVERS de l'ordre de
 * poussée.)
 *
 * CE QUE CE MODULE AJOUTE À L'ORIGINAL : rien à la structure, seulement la
 * RÉSOLUTION DES DESSINS. Une ligne `url` d'époque désigne un petit SWF
 * autonome (`/sd/bkiwi_cup.swf`…) qu'on lui passe des paramètres ; ici elle
 * porte en plus un `src` — le PNG déjà extrait de ce SWF — pour que le light
 * n'ait qu'à poser une image. La clé d'époque reste dans `lib`.
 */

// ── LE DÉCOR COMMUN (méthodes de `Standard`, vers 0x5b608) ─────────────────

// `getMargin()` puis `y.min = 8 ; y.ratio = 1` — la marge des filets du titre.
const MARGE_TITRE = { y: { min: 8, ratio: 1 } };

// getTitleLine(title, width) — 0x5b60d. UNE ligne, cinq morceaux : deux
// espaces de 14, deux filets de 2 et le texte centré au style 2. La largeur
// par défaut est `titre.length × 10`.
function getTitleLine(titre, largeur) {
  return { list: [
    { type: 'spacer', width: 14 },
    { type: 'line', size: 2, big: 1, param: { margin: MARGE_TITRE } },
    { type: 'text', width: largeur === undefined ? String(titre).length * 10 : largeur,
      param: { sid: 2, text: String(titre), textFormat: { align: 'center' } } },
    { type: 'line', size: 2, big: 1, param: { margin: MARGE_TITRE } },
    { type: 'spacer', width: 14 },
  ] };
}

// getSepLine() — 0x5bb09 : un filet de deux pixels, rentré de 28 à gauche.
function getSepLine() {
  return { height: 2, list: [
    { type: 'line', size: 2, param: { margin: { x: { min: 28 } } } },
  ] };
}

// getRecordLines(title, record) — 0x609e9 : un titre, le record CENTRÉ sur
// 200, et dix pixels d'air. Trois lignes, pas une.
function getRecordLines(titre, record) {
  return [
    getTitleLine(titre),
    { list: [
      { type: 'spacer', big: 1 },
      { type: 'text', width: 200,
        param: { sid: 1, text: String(record), textFormat: { align: 'center' } } },
      { type: 'spacer', big: 1 },
    ] },
    { height: 10 },
  ];
}

// getSimpleScoreLine(name, score) — 0x6043b : le libellé sur 160, la valeur
// sur 60 alignée à droite.
function getSimpleScoreLine(nom, score) {
  return { list: [
    { type: 'spacer', big: 1 },
    { type: 'text', width: 160, param: { sid: 1, text: String(nom) } },
    { type: 'text', width: 60,
      param: { sid: 1, text: String(score), textFormat: { align: 'right' } } },
    { type: 'spacer', big: 1 },
  ] };
}

// getWildScoreLine(name, score) — 0x60563 : la version étroite (58 + 20), sans
// espaces autour. C'est elle qui range les caractéristiques d'une fée en deux
// colonnes de 90.
function getWildScoreLine(nom, score) {
  return { list: [
    { type: 'text', width: 58, param: { sid: 1, text: String(nom) } },
    { type: 'text', width: 20,
      param: { sid: 1, text: String(score), textFormat: { align: 'right' } } },
  ] };
}

/* getKalugaModeLines(name, info, displayMode) — 0x6064b.
   Un titre, puis une ligne par niveau JOUÉ : le tzongre qui l'a fait, son nom,
   et le score mis en forme selon le mode. Un niveau à 0 ou à 600000 (la valeur
   « jamais fini » du chrono) ne compte pas — et si rien ne compte, la section
   entière disparaît (le tableau ne garde pas son seul titre). */
function getKalugaModeLines(nom, info, mode) {
  const lignes = [getTitleLine(nom)];
  const niveaux = (info && Array.isArray(info.$level)) ? info.$level : [];
  for (let i = 0; i < niveaux.length; i++) {
    const lv = niveaux[i] || {};
    const v = Number(lv.$s) || 0;
    let txt = '';
    if (mode === 'cm') txt = v + ' cm';
    else if (mode === 'time') txt = tempsStr(v);
    else if (mode === 'pts') txt = v + ' pts';
    if (v === 0 || v === 600000) continue;
    lignes.push({ list: [
      { type: 'spacer', big: 1 },
      urlLigne('kaluga_tz',
        { min: { w: 20 }, param: { frame: (Number(lv.$t) || 0) + 1 } }, { dy: 2 }),
      { type: 'text', width: 120, param: { sid: 1, text: String(lv.$name || '') } },
      { type: 'text', width: 80,
        param: { sid: 1, text: txt, textFormat: { align: 'right' } } },
      { type: 'spacer', big: 1 },
    ] });
  }
  return lignes.length === 1 ? [] : lignes;
}

/* `ext.util.MTNumber.getTimeStr(ms, "'", "''")` — le chronomètre d'époque.
   Les cartes l'appellent partout avec ces deux séparateurs : minutes en
   apostrophe simple, secondes en double, centièmes accolés. */
function tempsStr(ms) {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  const cs = Math.floor((n % 1000) / 10);
  const s = Math.floor(n / 1000) % 60;
  const m = Math.floor(n / 60000);
  return m + "'" + String(s).padStart(2, '0') + "''" + String(cs).padStart(2, '0');
}

// ── LES DESSINS ────────────────────────────────────────────────────────────
/*
 * Une ligne `url` d'époque charge un petit SWF autonome et lui pose ses
 * variables. Le light, lui, pose une image : ces bibliothèques ont été
 * extraites en PNG (cf. `scripts/extract-scores-sd.js` et
 * `scripts/extract-swf-bitmaps.js`), et `resoudre` refait le choix que le SWF
 * faisait tout seul.
 *
 * Ce qui n'est pas encore extrait rend `null` : la ligne garde sa place et sa
 * taille, et le light n'y met pas d'image — comme il fait déjà pour un voyant
 * de jeu sans PNG.
 */
const ECURIES_BKIWI = ['ultra orange', 'uwe wing', 'fury hun', 'sonic brain', 'kiwix'];
const TZONGRES = ['kaluga', 'piwali', 'nalika', 'gomola', 'makulo'];

function fente(s) { return String(s).toLowerCase().replace(/\s+/g, '-'); }

/* LE MANIFESTE DES BIBLIOTHÈQUES SORTIES DU SWF
   (`scripts/extract-fruticard-sd.js`). Chaque état y renvoie vers son
   FICHIER : un dessin peut servir à plusieurs états — `picFace` a
   soixante-cinq images pour six fées, Flash gardant le dernier placement — et
   c'est le manifeste qui refait le lien plutôt que soixante-cinq copies. */
let MANIFESTE = {};
try {
  MANIFESTE = require('./public/fb/sd/manifeste.json');
} catch (e) {
  console.warn('[FCARD] manifeste des dessins /sd/ illisible : ' + e.message);
}

// Les états NUMÉRIQUES connus d'une bibliothèque, en ordre, mis en cache : il
// faut leurs bornes pour serrer un `gotoAndStop` hors scénario.
const BORNES = {};
function bornes(lib) {
  if (!BORNES[lib]) {
    const n = Object.keys(MANIFESTE)
      .filter((k) => MANIFESTE[k].lib === lib)
      .map((k) => Number(k.slice(lib.length + 1)))
      .filter((v) => Number.isFinite(v));
    BORNES[lib] = n.length ? { min: Math.min(...n), max: Math.max(...n) } : null;
  }
  return BORNES[lib];
}

/* L'adresse d'un état, à travers le manifeste. Un état qu'on n'a pas sorti rend
   `null` : la ligne garde sa place et n'y met pas d'image.

   LE SERRAGE. `gotoAndStop` d'AVM1 ne sort jamais du scénario : au-delà de la
   dernière image il s'arrête sur la dernière, en deçà de la première sur la
   première. Une fiche abîmée (un `$lvl` de 25 pour douze grades) montre donc le
   dernier rang, pas un trou — on refait le même serrage plutôt que d'inventer
   un vide que l'époque n'avait pas. */
function viaManifeste(lib, etat) {
  let d = MANIFESTE[lib + '_' + etat];
  if (!d && typeof etat === 'number') {
    const b = bornes(lib);
    if (!b) return null;
    etat = Math.max(b.min, Math.min(b.max, etat));
    d = MANIFESTE[lib + '_' + etat];
  }
  if (!d) return null;
  // `.svg` pour un dessin APLATI, `.png` pour un dessin PHOTOGRAPHIÉ sous
  // Ruffle : le panier de Kaluga est passé du premier au second (son osier est
  // un bitmap, que l'aplatisseur laissait tomber).
  return '/fb/sd/' + lib + '_' + (d.etat === undefined ? etat : d.etat)
    + '.' + (d.ext || 'svg');
}

function resoudre(lib, param) {
  const p = param || {};
  switch (lib) {
    /* `this.gotoAndStop(10 + frame)` — la règle que ces quatre SWF portent à
       leur image 1, désassemblée à l'identique. Les dix premières images sont
       un état d'attente (un carré blanc) : le décalage n'est pas décoratif. */
    case 'miniwave_rank':
    case 'miniwave_ship':
    case 'miniwave_bads':
    case 'kaluga_panier':
      return viaManifeste(lib, 10 + (Number(p.frame) || 0));
    /* `var f = 1 ; if (shade == 1) f += 1 ; if (frame == null) f += 2`
       puis `award.gotoAndStop(f)` et, quand `frame` est donné,
       `award.sub.gotoAndStop(frame)`. D'où deux familles : les cinq diamants
       (`frame` = leur rang) et l'étoile (`num` = combien). */
    case 'minipixiz_award':
      return (p.frame === undefined || p.frame === null)
        ? viaManifeste(lib, 'e' + (Number(p.shade) === 1 ? 1 : 0))
        : viaManifeste(lib, 'd' + (Number(p.frame) || 1) + '_' + (Number(p.shade) === 1 ? 1 : 0));
    // `ball.symbol.gotoAndStop(frame)` · `pic.gotoAndStop(frame)`
    case 'minipixiz_spell':
    case 'minipixiz_faeries':
      return viaManifeste(lib, Number(p.frame) || 1);
    /* Les quatre coupes : image 1..4 du clip `cup` de `/sd/bkiwi_cup.swf`.
       Leurs quatre tailles diffèrent (37 × 69, 64 × 80, 48 × 73, 64 × 79) et
       c'est le DESSIN qui le veut — quatre coupes de formes différentes,
       vérifié en aplatissant le clip. Elles sont posées à 1:1, donc sans
       entrée de manifeste : `tailleDe` rend `null` et l'image garde sa taille
       de fichier, qui est déjà celle de la scène. */
    case 'bkiwi_cup': {
      const n = Math.max(1, Math.min(4, Number(p.frame) || 1));
      return '/fb/sd/bkiwi_cup_' + n + (n === 4 ? '.svg' : '.png');
    }
    // `bkiwi_team` lit `data[0]` et se pose sur l'écurie ; c'est la VOITURE
    // qu'il montre (les écussons sont rendus invisibles à l'image 1).
    case 'bkiwi_team': {
      const nom = Array.isArray(p.data) ? String(p.data[0] || '') : String(p.data || '');
      const cle = fente(nom.split(':')[0]);
      return ECURIES_BKIWI.indexOf(nom.split(':')[0]) < 0 ? null : '/fb/sd/bkiwi_car_' + cle + '.png';
    }
    // `kaluga_tz` : `gotoAndStop(10 + n)`, n étant le tzongre. La carte lui
    // passe `frame`, et l'image 1 est déjà le premier tzongre.
    case 'kaluga_tz': {
      const n = (Number(p.frame) || 0) - 1;
      const nom = TZONGRES[n];
      return '/fb/sd/kaluga_tz_' + (nom || 'inconnu') + '.png';
    }
    /* `_xscale = _yscale = scale ; gotoAndStop(10 + frame)` — le scénario
       racine de `/sd/swapou_chars.swf`, désassemblé. La carte passe `frame = i`
       pour un personnage DÉBLOQUÉ et `frame = i + 10` pour un VERROUILLÉ : ce
       sont les images 10 à 16 et 20 à 26.

       Les images 20 à 26 reposent le MÊME personnage sous une transformation
       de couleur — multiplicateurs (0, 0, 0), addition (114, 153, 40) : un
       aplat vert, exactement celui du médaillon, donc un médaillon VIDE. C'est
       ça, un personnage pas encore découvert.

       On les prenait à `swapou_score_chars`, la bibliothèque du TABLEAU DES
       SCORES — un autre SWF, aux vignettes de vingt pixels de côté (étirées à
       quarante-huit sur la fiche, d'où le flou) et dont l'état « inconnu » est
       une CROIX ROUGE. */
    case 'swapou_chars': {
      const n = Number(p.frame) || 0;
      const verrou = n >= 10;
      const i = Math.max(0, Math.min(6, verrou ? n - 10 : n));
      return '/fb/sd/swapou_carte_' + (verrou ? 'v' : '') + i + '.png';
    }
    // Les cinq donjons de MotionBall sont servis tels quels : le SWF n'y
    // touchait pas, c'est déjà une adresse de PNG.
    case 'sd/mb2': return '/sd/mb2/' + String(p.nom || '') + '.png';
    default: return null;                 // pas encore extrait : pas d'image
  }
}

/* Une ligne `url` d'époque, augmentée de son `src`.

   LES TEINTES. `minipixiz_faeries` ne se contente pas d'aller à une image : il
   REPEINT trois groupes de son dessin, ceux que `$skin` fait varier d'une fée
   à l'autre — `setColor(pic.f.k0|k1|k2, col1)` les CHEVEUX, `(pic.f.o0.p|o1.p|
   cloth, col2)` les YEUX et la ROBE, `(pic.f.w0|w1, col3)` les AILES. Le teint
   du visage, lui, est peint dans le dessin : toutes les fées ont le même. Le
   dessin extrait marque donc ses trois groupes d'une classe `t1`/`t2`/`t3`, et
   la ligne emporte les couleurs : c'est le light qui pose les filtres,
   puisqu'une image posée en `<img>` ne se teinte pas.

   On regarde la PRÉSENCE des clés, pas leur valeur : une fée sans `$skin` passe
   `col1: undefined`, et l'époque en tire `undefined >> 16 & 255` = 0, donc un
   décalage de −255 sur les trois canaux — une silhouette noire. La carte doit
   montrer la même chose, pas une fée en niveaux de gris. */
/*
 * LA TAILLE VRAIE D'UN DESSIN — celle qu'il a DANS LA SCÈNE, pas celle du
 * fichier.
 *
 * Les vignettes rendues sous Ruffle (`extract-scores-sd.js` : les voitures de
 * Burning Kiwi, les tzongres de Kaluga, les personnages de Swapou) sortent à
 * DEUX FOIS leur taille — `ZOOM = 4`, réduit à `FINAL = 2` — pour rester
 * nettes sur les écrans denses. Le light, lui, les posait à la taille du
 * FICHIER : une voiture de vingt pixels s'affichait à quarante, un tzongre de
 * dix-huit à trente-six. D'où trois symptômes qui n'en faisaient qu'un — des
 * dessins trop gros chez Burning Kiwi, des personnages flous chez Swapou (un
 * dessin de vingt pixels étiré au double), et des rangées qui se chevauchaient
 * parce que l'image dépassait de partout.
 *
 * Le manifeste porte la taille LOGIQUE de chaque dessin : on la fait voyager
 * avec la ligne. Pour un SVG, elle vaut déjà celle du fichier — la poser ne
 * change rien ; pour un PNG rendu, elle le ramène à sa vraie stature.
 */
/*
 * `x`/`y` — L'ÉCART ENTRE L'ORIGINE DU SWF ET LE COIN DE SON DESSIN.
 *
 * `DocPage.updateLine` charge le SWF dans un clip et lui pose `_x`/`_y` : c'est
 * l'ORIGINE du dessin qui atterrit sur `dx`/`dy`, jamais son coin. Or une
 * bibliothèque ne dessine pas forcément à partir de (0,0) — le panier de Kaluga
 * commence à (27.5, 3) et les personnages de Swapou sont CENTRÉS sur l'origine,
 * de (−33, −24.5) à (24, 24). Une image posée par son coin haut-gauche, comme
 * le fait `<img>`, se décale donc de tout ce que vaut ce couple : la moitié
 * d'un dessin pour Swapou, dont le cercle partait en biais.
 */
function tailleDe(src) {
  if (!src) return null;
  const cle = String(src).split('/').pop().replace(/\.(svg|png)$/i, '');
  const d = MANIFESTE[cle];
  if (!d || !(Number(d.w) > 0) || !(Number(d.h) > 0)) return null;
  return { w: Number(d.w), h: Number(d.h), x: Number(d.x) || 0, y: Number(d.y) || 0 };
}

function urlLigne(lib, param, extra) {
  const l = Object.assign({ type: 'url' }, extra || {});
  l.param = Object.assign({ url: lib }, param || {});
  const p = (param && param.param) || param || {};
  l.src = resoudre(lib, p);
  const t = tailleDe(l.src);
  if (t) {
    l.w = t.w; l.h = t.h;
    if (t.x) l.ox = t.x;
    if (t.y) l.oy = t.y;
  }
  if ('col1' in p || 'col2' in p || 'col3' in p) {
    l.teintes = [Number(p.col1) || 0, Number(p.col2) || 0, Number(p.col3) || 0];
  }
  return l;
}

// ── LES SEPT CARTES ────────────────────────────────────────────────────────

/* BURNING KIWI — 0x5c618. L'utilisateur avait raison : les coupes sont là.

     { height:10 }
     ×4  url bkiwi_cup, dy 4, min.w 30, { frame:i+1, available: card[cle] }
         cles = ["$wss","$ws","$wcs","$wc"]
     getTitleLine("voitures")
     ×5  url bkiwi_team, dy 4, { data:[écurie], _alpha: 20 + $ac[i] × 80 }
     ×6 circuits, ceux dont `$fcLap` est un nombre fini :
         getTitleLine(circuit) puis DEUX lignes — le meilleur tour, puis la
         meilleure course — chacune avec la voiture qui l'a fait.
     { height:20 } ; getSepLine()

   `available` : le SWF pose `cup._alpha` d'après lui. La valeur « éteinte »
   n'est pas lisible dans le pool de chaînes (c'est un littéral numérique) ; on
   reprend celle que les VOITURES utilisent dans la même carte — 20 contre
   100 —, faute de mieux et à défaut de mesure. */
function carteBkiwi(c) {
  const lignes = [];
  lignes.push({ height: 10 });
  const cles = ['$wss', '$ws', '$wcs', '$wc'];
  const circuits = ['green hill', 'banana derby', 'terre grise', 'solstice',
    'jupiter IV', 'mistral kiwi'];
  const rangee = { height: 86, list: [] };
  rangee.list.push({ type: 'spacer', big: 2 });
  for (let i = 0; i < cles.length; i++) {
    const dispo = !!c[cles[i]];
    rangee.list.push(urlLigne('bkiwi_cup',
      { min: { w: 30 }, param: { frame: i + 1, available: dispo, _alpha: dispo ? 100 : 20 } },
      { dy: 4 }));
    rangee.list.push({ type: 'spacer', big: 1 });
  }
  lignes.push(rangee);
  lignes.push(getTitleLine('voitures'));
  const voitures = { height: 32, list: [] };
  voitures.list.push({ type: 'spacer', width: -16, big: 1 });
  const ac = Array.isArray(c.$ac) ? c.$ac : [];
  for (let i = 0; i < 5; i++) {
    voitures.list.push(urlLigne('bkiwi_team',
      { param: { data: [ECURIES_BKIWI[i]], _alpha: 20 + (ac[i] ? 1 : 0) * 80 } },
      { dy: 4 }));
    voitures.list.push({ type: 'spacer', big: 1 });
  }
  lignes.push(voitures);
  /*
   * `card.$ts[i]` — UN INDEX, PAS UNE CLÉ NOMMÉE.
   *
   *     0x5caad  Push reg3 · "$ts" · GetMember · Push reg10 · GetMember
   *
   * `reg10` est le compteur de la boucle (0 à 5) : le SWF indexe le tableau
   * des circuits par leur RANG. On y cherchait `$t0`, `$t1`… — une clé qui
   * n'existe dans aucune sauvegarde, si bien que `isFinite($fcLap)` était
   * toujours faux et que la carte de Burning Kiwi perdait ses six circuits :
   * elle s'arrêtait aux coupes et aux voitures. C'est l'information qui
   * manquait.
   */
  const ts = (c.$ts && typeof c.$ts === 'object') ? c.$ts : {};
  for (let t = 0; t < 6; t++) {
    const piste = ts[t] || {};
    if (!isFinite(Number(piste.$fcLap))) continue;
    lignes.push(getTitleLine(circuits[t]));
    for (let k = 0; k < 2; k++) {
      const lib = k === 0 ? 'meilleur tour :' : 'meilleur course :';
      const temps = k === 0 ? piste.$fcLap : piste.$fcTotal;
      const ecurie = ECURIES_BKIWI[Number(k === 0 ? piste.$lapCar : piste.$totalCar) || 0];
      lignes.push({ list: [
        { type: 'spacer', big: 1 },
        urlLigne('bkiwi_team', { min: { w: 30 }, param: { data: [ecurie] } }),
        { type: 'text', width: 120, param: { sid: 1, text: lib } },
        { type: 'text', width: 80,
          param: { sid: 1, text: tempsStr(temps), textFormat: { align: 'right' } } },
        { type: 'spacer', big: 1 },
      ] });
    }
  }
  lignes.push({ height: 20 });
  lignes.push(getSepLine());
  return lignes;
}

/* `Const.fruit_points` — le barème de Frutisnake, celui que la carte refait à
   l'identique pour trouver « le plus gros fruit » (0x5cf13..0x5d09b). Il vit
   déjà dans `public/snake3/const.js` ; il est redit ici parce que le serveur
   en a besoin pour garnir `$fruits`, et que les deux doivent rester égaux. */
function pointsFruit(id) {
  const n = Number(id) || 0;
  if (n <= 40) return n * 5;
  if (n <= 90) return 200 + (n - 40) * 10;
  if (n <= 150) return 700 + (n - 90) * 20;
  if (n <= 220) return 1900 + (n - 150) * 30;
  if (n <= 260) return 4000 + (n - 220) * 50;
  if (n <= 300) return 6000 + (n - 260) * 100;
  return -(n - 320) * 250;               // les fruits POURRIS, 321 à 342
}

/* FRUTISNAKE — 0x5cde6. « Combien de fruits ramassés, records », mot pour mot.

   `$fruits` est indexé PAR FRUIT : la case d'un fruit jamais vu est vide, celle
   d'un fruit découvert porte ses points. La carte balaie les 343 cases, compte
   les découverts, additionne leurs points, et retient l'INDICE du dernier
   découvert d'indice ≤ 300 — les pourris (321-342) ne peuvent donc pas être
   « le plus gros fruit ». Puis elle refait le barème sur cet indice.

   « meileur score » s'écrit avec UN SEUL L dans le SWF. C'est une faute
   d'époque, et elle reste : la carte est un objet d'archive. */
function carteSnake(c, pseudo) {
  const lignes = [];
  const TOTAL = 322, BALAYAGE = 343;
  const fruits = Array.isArray(c.$fruits) ? c.$fruits : [];
  let nb = 0, somme = 0, imax = 0;
  for (let i = 0; i < BALAYAGE; i++) {
    const v = fruits[i];
    if (v === undefined || v === null) continue;
    nb += 1;
    somme += Number(v) || 0;
    if (i > 300) continue;
    imax = i;
  }
  const pct = Math.round(nb / TOTAL * 1000) / 10 + '%';
  lignes.push({ list: [
    { type: 'spacer', big: 1 },
    { type: 'text', width: 300,
      param: { sid: 2, text: pseudo + ' a ramassé ' + somme + ' fruits !',
        textFormat: { align: 'center', color: 15168875 } } },
    { type: 'spacer', big: 1 },
  ] });
  lignes.push({ height: 10 });
  getRecordLines('meileur score', (Number(c.$record) || 0) + ' points')
    .forEach((l) => lignes.push(l));
  lignes.push(getTitleLine('collection'));
  lignes.push({ list: [
    { type: 'spacer', big: 1 },
    { type: 'text', width: 300,
      param: { sid: 1, text: nb + ' sur ' + TOTAL + ' ont été découverts',
        textFormat: { align: 'center' } } },
    { type: 'spacer', big: 1 },
  ] });
  lignes.push({ list: [
    { type: 'spacer', big: 1 },
    { type: 'text', width: 300,
      param: { sid: 1, text: '( ' + pct + ' )', textFormat: { align: 'center' } } },
    { type: 'spacer', big: 1 },
  ] });
  lignes.push({ height: 10 });
  getRecordLines('le plus gros fruit', pointsFruit(imax) + ' points')
    .forEach((l) => lignes.push(l));
  lignes.push({ big: 1 });
  return lignes;
}

/* SWAPOU 2 — 0x5d532. Les sept personnages en CERCLE (rayon 60, départ à
   l'angle −2 radians), les verrouillés à l'image `i + 10` ; puis, dans une
   colonne de 140, les trois records. */
function carteSwapou(c) {
  const page = { height: 240, list: [] };
  const gauche = { type: 'page', width: 190, lineList: [] };
  gauche.lineList.push(getTitleLine('personnages'));
  const cercle = { height: 168, list: [] };
  cercle.list.push({ type: 'spacer', big: 1 });
  const chars = Array.isArray(c.$chars) ? c.$chars : [];
  const NB = 7, CX = 0, CY = 80, R = 60;
  for (let i = 0; i < NB; i++) {
    const a = 6.28 * i / NB - 2;
    const frame = chars[i] ? i : i + 10;
    cercle.list.push(urlLigne('swapou_chars', { param: { frame } },
      { dx: CX + Math.cos(a) * R, dy: CY + Math.sin(a) * R }));
  }
  cercle.list.push({ type: 'spacer', big: 1 });
  gauche.lineList.push(cercle);
  gauche.lineList.push(getSepLine());
  page.list.push(gauche);
  const droite = { type: 'page', width: 140, lineList: [] };
  [].concat(getRecordLines('normal', (Number(c.$record) || 0) + ' points'),
    getRecordLines('classic', (Number(c.$classic_record) || 0) + ' points'),
    getRecordLines('swaps', (Number(c.$swap) || 0) + ' swaps'))
    .forEach((l) => droite.lineList.push(l));
  page.list.push(droite);
  return [page];
}

/* MOTIONBALL 2 — 0x5d9cd. Les cinq donjons en rangée, le cinquième GLISSÉ AU
   MILIEU (`list.splice(5, 0, …)`) — un choix d'époque qu'on garde ; puis, par
   couleur de course, le premier record qui n'est pas un « challenge ». */
function carteMb2(c) {
  const lignes = [];
  const rangee = { height: 44, list: [] };
  rangee.list.push({ type: 'spacer', big: 2 });
  const faits = Array.isArray(c.$dungeons_done) ? c.$dungeons_done : [];
  for (let i = 0; i < 5; i++) {
    const nom = String(i + 1) + (faits[i] ? '_done' : '');
    const tuile = urlLigne('sd/mb2', { min: { w: 40 }, nom }, { dy: 4 });
    if (i === 4) rangee.list.splice(5, 0, tuile, { type: 'spacer', big: 1 });
    else { rangee.list.push(tuile); rangee.list.push({ type: 'spacer', big: 1 }); }
  }
  lignes.push(rangee);
  lignes.push(getTitleLine('course'));
  const couleurs = ['jaune', 'vert', 'rouge', 'orange', 'bleu', 'métal', 'violet'];
  const records = Array.isArray(c.$records) ? c.$records : [];
  for (let i = 0; i < couleurs.length; i++) {
    const liste = Array.isArray(records[i]) ? records[i] : [];
    for (let j = 0; j < liste.length; j++) {
      const r = liste[j] || {};
      if (r.$c) continue;                       // les temps « challenge » ne comptent pas
      lignes.push({ list: [
        { type: 'spacer', big: 1 },
        { type: 'text', width: 120, param: { sid: 1, text: couleurs[i] } },
        { type: 'text', width: 80,
          param: { sid: 1, text: tempsStr((Number(r.$t) || 0) * 10),
            textFormat: { align: 'center' } } },
        { type: 'spacer', big: 1 },
      ] });
      break;                                    // un seul par couleur
    }
  }
  [].concat(getRecordLines('classic', (Number(c.$classic_score) || 0) + ' niveaux'))
    .forEach((l) => lignes.push(l));
  lignes.push({ height: 20 });
  lignes.push(getSepLine());
  return lignes;
}

/* KALUGA — 0x5df1a. Trois sections de modes, chacune bâtie puis passée à
   `getKalugaModeLines` (qui se tait quand elle n'a rien à dire), et pour finir
   le PANIER, dont l'image suit `floor(fruits^0.3)`. */
const KALUGA_EPREUVES = ['lancer de vers', 'dexteripomme', "lancer d'ecureuil",
  'planter de vers', 'lancer de fourmi', 'plantapomme', 'course de grenouille'];
const KALUGA_MODES = [
  { cle: '$chrono', nom: 'mode chrono' },
  { cle: '$survival', nom: 'mode survie' },
  { cle: '$invasion', nom: 'mode invasion' },
  { cle: '$ring', nom: 'mode piste' },
];
const KALUGA_DIFF = ['facile', 'standard', 'difficile', 'infernal'];

function carteKaluga(c) {
  let lignes = [];
  const essais = { $level: [] };
  const classic = c.$classic || {};
  const trial = c.$trial || {};
  if (Number(classic.$s) > 0) essais.$level.push({ $name: 'essai', $t: classic.$t, $s: classic.$s });
  if (trial.$tria && Number(trial.$tria.$s) > 0) {
    essais.$level.push({ $name: 'triathlon', $t: trial.$tria.$t, $s: trial.$tria.$s });
  }
  if (trial.$hept && Number(trial.$hept.$s) > 0) {
    essais.$level.push({ $name: 'heptathlon', $t: trial.$hept.$t, $s: trial.$hept.$s });
  }
  lignes = lignes.concat(getKalugaModeLines('épreuve', essais, 'pts'));

  const olympique = { $level: [] };
  const liste = Array.isArray(trial.$list) ? trial.$list : [];
  for (let i = 0; i < KALUGA_EPREUVES.length; i++) {
    const e = liste[i] || {};
    const tz = Array.isArray(e.$tz) ? e.$tz : [];
    let meilleur = 0, lequel = -1;
    for (let j = 0; j < tz.length; j++) {
      if (Number(tz[j] && tz[j].$s) > meilleur) { meilleur = Number(tz[j].$s); lequel = j; }
    }
    if (lequel !== -1) olympique.$level.push({ $name: KALUGA_EPREUVES[i], $t: lequel, $s: meilleur });
  }
  lignes = lignes.concat(getKalugaModeLines('olympique', olympique, 'cm'));

  for (let i = 0; i < KALUGA_MODES.length; i++) {
    const info = c[KALUGA_MODES[i].cle] || { $level: [] };
    const niveaux = Array.isArray(info.$level) ? info.$level : [];
    let mode = info;
    if (i === 0) {
      // LE CHRONO se recompose : chaque niveau est une LISTE de temps, dont on
      // ne garde que le dernier, et seulement s'il est débloqué (`$mode[2]`).
      const debloques = (Array.isArray(c.$mode) && Array.isArray(c.$mode[2])) ? c.$mode[2] : [];
      const l = [];
      for (let j = 0; j < niveaux.length; j++) {
        if (!debloques[j]) continue;
        const n = niveaux[j];
        l.push({ $s: Array.isArray(n) ? n[n.length - 1] : n, $t: 10 });
      }
      mode = { $level: l };
    } else {
      mode = { $level: niveaux.slice() };
    }
    for (let j = 0; j < mode.$level.length; j++) {
      mode.$level[j] = Object.assign({}, mode.$level[j], { $name: KALUGA_DIFF[j] });
    }
    lignes = lignes.concat(getKalugaModeLines(KALUGA_MODES[i].nom, mode, 'time'));
  }

  lignes.push(getTitleLine('panier'));
  const fruits = Number((c.$stat || {}).$fruit) || 0;
  lignes.push({ list: [
    { type: 'spacer', big: 1 },
    { type: 'text', width: 200,
      param: { sid: 1, text: fruits + ' fruits !', textFormat: { align: 'center' } } },
    { type: 'spacer', big: 1 },
  ] });
  lignes.push({ list: [
    { type: 'spacer', big: 1 },
    urlLigne('kaluga_panier',
      { min: { w: 160, h: 130 }, param: { frame: Math.floor(Math.pow(fruits, 0.3)) } },
      { dy: 2 }),
    { type: 'spacer', big: 1 },
  ] });
  lignes.push(getSepLine());
  lignes.push({ height: 20 });
  return lignes;
}

/* MINIWAVE — 0x5e868. Le grade, les vaisseaux (verrouillés à 20 % d'opacité),
   l'arcade, les bonus de mission, les modes spéciaux — chaque section VIDE
   reprend son titre (`lines.pop()`) — et le tableau de chasse.

   Le tableau de chasse s'arrête à `$badsKill.length − 1` : le dernier compteur
   n'est jamais montré. C'est ainsi dans le bytecode ; on le garde. */
const MINIWAVE_BADS = ['Fraise-bouclier', 'Orangeonaute', 'Banana', 'Clémentine mécanique',
  'Kamikaze', 'Cerises-duo', 'Fraise des bois', 'Poire sous cloche', 'Astro-Pamplemousse',
  'Cosmo-Prune', 'Coing mutant', 'Figue-laser', 'Batmandarine', "Pomme d'épines",
  'Astro-Datte', 'Pruneau magnétique', 'Mûre chercheuse', 'Citrus', 'Astéropulpe',
  'Baies à tête chercheuse', 'Aigrelle assassine', 'Mangue-strike', 'Tyson',
  'Cosmirabelle', 'Astro-Quetsch', 'Ananas sauvage', 'Myrtillerie lourde',
  'Fraise-shuriken', 'Aubergine folle', 'Space-Groseille', 'Pêche astronomique',
  'Abricot guerrier', 'Nectarine trou-noir', 'Pruneau passe-muraille', 'Astro-raisin',
  'Betterave astrale', 'Scarabé pulpé', 'Space-Kumquat', 'Poivri le poivron violent',
  'Kiwi interstellaire', 'Prune sidérale', 'Prune paralysante', 'Demon lemon',
  'Pêche jongleuse', 'Courge céleste', 'Bulbe spatial', 'Cosmo-Cassis', 'Pois casseur',
  'Brugnon cuirassé', 'Nitro-pruneau', 'Letter-monster'];
const MINIWAVE_SPECIAUX = [
  { nom: 'mode lettre', lien: '$letter' },
  { nom: 'mode sentinelle', lien: '$survival' },
  { nom: 'mode fuite', lien: '$time' },
];

function carteMiniwave(c) {
  const lignes = [];
  lignes.push({ height: 60, list: [
    { type: 'spacer', big: 1 },
    urlLigne('miniwave_rank', { param: { frame: Number(c.$lvl) || 0 } }, { dy: 4 }),
    { type: 'spacer', big: 1 },
  ] });
  lignes.push(getTitleLine('vaisseaux'));
  const vaisseaux = { height: 32, list: [] };
  vaisseaux.list.push({ type: 'spacer', width: -16, big: 1 });
  const ship = Array.isArray(c.$ship) ? c.$ship : [];
  for (let i = 0; i < ship.length; i++) {
    vaisseaux.list.push(urlLigne('miniwave_ship',
      { param: { frame: i, _alpha: 20 + (Number(ship[i]) || 0) * 80 } }, { dy: 4 }));
    vaisseaux.list.push({ type: 'spacer', big: 1 });
  }
  lignes.push(vaisseaux);
  const arcade = c.$arcade || {};
  lignes.push(getTitleLine('arcade'));
  lignes.push(getSimpleScoreLine('meilleur score :', Number(arcade.$bestScore) || 0));
  lignes.push(getSimpleScoreLine('niveau maximum atteint :', Number(arcade.$bestLevel) || 0));

  lignes.push(getTitleLine('bonus'));
  const bonus = ((c.$cons || {}).$bonus) || [];
  let vide = true;
  for (let i = 0; i < bonus.length; i++) {
    const v = Number(bonus[i]) || 0;
    if (v <= 0) continue;
    vide = false;
    lignes.push(getSimpleScoreLine('mission ' + (i + 1) + ' :', v + ' %'));
  }
  if (vide) lignes.pop();

  lignes.push(getTitleLine('spécial'));
  vide = true;
  for (let i = 0; i < MINIWAVE_SPECIAUX.length; i++) {
    const v = Number(c[MINIWAVE_SPECIAUX[i].lien]) || 0;
    if (v <= 0) continue;
    vide = false;
    lignes.push(getSimpleScoreLine(MINIWAVE_SPECIAUX[i].nom, v));
  }
  if (vide) lignes.pop();

  lignes.push(getTitleLine('tableau de chasse'));
  const tues = Array.isArray(c.$badsKill) ? c.$badsKill : [];
  for (let i = 0; i < tues.length - 1; i++) {
    const n = Number(tues[i]) || 0;
    if (n <= 0) continue;
    lignes.push({ list: [
      { type: 'spacer', big: 1 },
      urlLigne('miniwave_bads', { min: { w: 20 }, param: { frame: i } }, { dy: -2 }),
      { type: 'text', width: 160, param: { sid: 1, text: MINIWAVE_BADS[i] || '' } },
      { type: 'text', width: 60,
        param: { sid: 1, text: String(n), textFormat: { align: 'right' } } },
      { type: 'spacer', big: 1 },
    ] });
  }
  lignes.push({ height: 8 });
  lignes.push(getSepLine());
  lignes.push({ height: 20 });
  return lignes;
}

/* MINIPIXIZ — 0x5f285. Le grade tiré de `$run^0.16`, les cinq diamants et
   l'étoile, la fée courante avec ses six caractéristiques en deux colonnes et
   ses sorts, puis les statistiques, le tableau de chasse et la Luz. */
const MINIPIXIZ_GRADES = ['Apprenti', 'Ami des fées', 'Etudiant en esoterisme',
  'Chercheur en esoterisme', 'Expert', 'Collectionneur de fées', 'Maitre des fées',
  'Seigneur des fées', 'Souverain des fées'];
const MINIPIXIZ_LIEUX = ['forêts', 'bassin', 'donjon', 'arc-en-ciel', 'arbre creux'];
const MINIPIXIZ_DEMONS = ['diablotin', 'demon mineur', 'demon majeur', 'ombre', 'furie'];

function carteMinipixiz(c) {
  const lignes = [];
  const stat = c.$stat || {};
  const rang = Math.floor(Math.min(Math.pow(Number(stat.$run) || 0, 0.16), 8));
  lignes.push(getTitleLine(MINIPIXIZ_GRADES[rang] || MINIPIXIZ_GRADES[0]));

  const medailles = { height: 30, list: [] };
  medailles.list.push({ type: 'spacer', width: 75 });
  for (let i = 0; i < 5; i++) {
    medailles.list.push(urlLigne('minipixiz_award',
      { param: { frame: i + 1, shade: i < (Number(c.$diam) || 0) ? 0 : 1 } }));
    medailles.list.push({ type: 'spacer', width: 24 });
  }
  medailles.list.push({ type: 'spacer', width: 18 });
  medailles.list.push(urlLigne('minipixiz_award',
    { param: { num: Number(c.$star) || 0, shade: (Number(c.$star) || 0) === 0 ? 1 : 0 } }));
  lignes.push(medailles);

  const fees = Array.isArray(c.$faerie) ? c.$faerie : [];
  const f = (c.$current !== null && c.$current !== undefined) ? fees[c.$current] : null;
  if (f) {
    lignes.push(getTitleLine(f.$name + ' ( niveau ' + ((Number(f.$level) || 0) + 1) + ' )'));
    const bloc = { height: 120, list: [] };
    const portrait = { type: 'page', width: 114, lineList: [] };
    const cadre = { height: 100, list: [] };
    const peau = Array.isArray(f.$skin) ? f.$skin : [];
    cadre.list.push({ type: 'spacer', width: 14 });
    cadre.list.push(urlLigne('minipixiz_faeries',
      { param: { frame: 1 + (Number(peau[0]) || 0), col1: peau[1], col2: peau[2], col3: peau[3] } },
      { dy: 4 }));
    portrait.lineList.push(cadre);
    bloc.list.push(portrait);
    bloc.list.push({ type: 'spacer', width: 9 });

    const fiche = { type: 'page', width: 240, lineList: [] };
    const caracs = { height: 62, list: [] };
    const carac = Array.isArray(f.$carac) ? f.$carac : [];
    const colA = { type: 'page', width: 90, lineList: [] };
    colA.lineList.push(getWildScoreLine('force', carac[0]));
    colA.lineList.push(getWildScoreLine('rapidité', carac[1]));
    colA.lineList.push(getWildScoreLine('vie', carac[2]));
    caracs.list.push(colA);
    const colB = { type: 'page', width: 90, lineList: [] };
    colB.lineList.push(getWildScoreLine('intel', carac[3]));
    colB.lineList.push(getWildScoreLine('sagesse', carac[4]));
    colB.lineList.push(getWildScoreLine('mana', carac[5]));
    caracs.list.push(colB);
    fiche.lineList.push(caracs);

    // Les sorts se DÉPILENT, huit par rangée, trois rangées au plus.
    const sorts = Array.isArray(f.$spell) ? f.$spell.slice() : [];
    for (let r = 0; sorts.length > 0 && r < 3; r++) {
      const rangee = { height: 20, list: [] };
      rangee.list.push({ type: 'spacer', width: 6 });
      for (let j = 0; j < 8; j++) {
        if (sorts.length === 0) break;
        const s = sorts.pop();
        rangee.list.push(urlLigne('minipixiz_spell', { param: { frame: 1 + (Number(s) || 0) } }));
        rangee.list.push({ type: 'spacer', width: 21 });
      }
      fiche.lineList.push(rangee);
    }
    bloc.list.push(fiche);
    lignes.push(bloc);
    lignes.push({ height: 8 });
  }

  lignes.push(getTitleLine('statistiques'));
  const donjon = c.$dungeon || {};
  const objets = (Array.isArray(stat.$item) ? stat.$item : []).filter((x) => x !== null && x !== undefined).length;
  const plats = (Array.isArray(stat.$eat) ? stat.$eat : []).filter((x) => x !== null && x !== undefined).length;
  const stats = [
    ['jours de jeu', (c.$time || {}).$d],
    ['record forêt', 'niv. ' + ((Number(stat.$forestMax) || 0) + 1)],
    ['record arbre creux', 'niv. ' + (Number(stat.$treeMax) || 0)],
    ['donjons terminés', (Number(donjon.$lvl) || 0) + (Number(donjon.$loop) || 0) * 5],
    ['objets différents', objets],
    ['plats différents', plats],
    ['missions terminées', Number(stat.$misNum) || 0],
  ];
  const parties = Array.isArray(stat.$game) ? stat.$game : [];
  for (let i = 0; i < parties.length; i++) {
    const n = Number(parties[i]) || 0;
    if (n > 0) stats.push(['parties ' + (MINIPIXIZ_LIEUX[i] || ''), n]);
  }
  stats.forEach((s) => lignes.push(getSimpleScoreLine(s[0], s[1] === undefined ? 0 : s[1])));

  lignes.push(getTitleLine('tableau de chasse'));
  const tues = Array.isArray(stat.$kill) ? stat.$kill : [];
  for (let i = 0; i < 5; i++) {
    lignes.push(getSimpleScoreLine(MINIPIXIZ_DEMONS[i], Number(tues[i]) || 0));
  }
  lignes.push({ height: 3 });
  lignes.push(getSepLine());
  const luz = { height: 100, list: [] };
  luz.list.push({ type: 'spacer', width: 12 });
  luz.list.push(urlLigne('minipixiz_luz', { param: { star: Number(c.$star) || 0 } }));
  lignes.push(luz);
  lignes.push(getSepLine());
  lignes.push({ height: 10 });
  return lignes;
}

// ── L'AIGUILLAGE ───────────────────────────────────────────────────────────
// L'ordre et les noms sont ceux du `switch` d'époque. Grapiz et Frutibandas y
// figurent et n'y font rien : leur branche retombe sur le retour commun.
const CARTES = {
  bkiwi: carteBkiwi,
  snake3: carteSnake,
  swapou2: carteSwapou,
  mb2: carteMb2,
  kaluga: carteKaluga,
  miniwave: carteMiniwave,
  miniwave2: carteMiniwave,
  minipixiz: carteMinipixiz,
  grapiz: null,
  bandas: null,
};

/**
 * `Standard.getFrutiCardLines(frutiCard, gameName)` — la liste de lignes de la
 * carte, ou un tableau vide pour un jeu qui n'en a pas.
 * @param {string} jeu     l'identifiant d'époque (bkiwi, snake3, …)
 * @param {object} carte   la sauvegarde (slot 0), déjà rembourrée
 * @param {string} pseudo  le nom du joueur (Frutisnake s'en sert)
 */
function lignes(jeu, carte, pseudo) {
  const f = CARTES[String(jeu || '')];
  if (!f) return [];
  const c = (carte && typeof carte === 'object') ? carte : {};
  try {
    return f(c, String(pseudo || ''));
  } catch (e) {
    console.warn(`[FCARD] carte ${jeu} illisible : ${e.message}`);
    return [];
  }
}

function aUneCarte(jeu) { return !!CARTES[String(jeu || '')]; }

// `Lang.gameName(g)` — ce que la ligne cliquable de la section « Fruticard ! »
// écrit à la place de l'identifiant. Les noms sont ceux des classements
// (`LEGACY_RANKINGS.rn`) pour les cinq jeux qui en ont un, et ceux du tableau
// des scores pour les deux autres.
const NOMS_JEUX = {
  bkiwi: 'Burning kiwi',
  snake3: 'Frutisnake 2',
  swapou2: 'Swapou 2',
  mb2: 'Motion Ball 2',
  kaluga: 'Kaluga',
  miniwave: 'MiniWave',
  miniwave2: 'MiniWave',
  minipixiz: 'MiniPixiz',
};

function nomJeu(jeu) { return NOMS_JEUX[String(jeu || '')] || String(jeu || ''); }

module.exports = {
  lignes,
  aUneCarte,
  nomJeu,
  tempsStr,
  pointsFruit,
  resoudre,
  urlLigne,
  getTitleLine,
  getSepLine,
  getRecordLines,
  getSimpleScoreLine,
  getWildScoreLine,
  getKalugaModeLines,
  ECURIES_BKIWI,
  MINIWAVE_BADS,
  MINIPIXIZ_GRADES,
};
