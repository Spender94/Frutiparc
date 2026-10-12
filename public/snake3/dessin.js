/*
 * Frutisnake — le chargement des dessins et les aides de rendu.
 *
 * Les sprites sont les SVG extraits du SWF (sprites/sprites.json les
 * recense : clé → frames → fichier + cadre en pixels de scène 700×480).
 * Comme sur MiniPixiz : chaque frame se RASTERISE une fois par échelle
 * demandée, à k·DENSITE pixels physiques, dans un canvas hors écran mis en
 * cache — dessiner ensuite est un simple drawImage, et rien n'est flou même
 * sur écran dense (le navigateur ne re-rasterise pas un SVG déjà peint).
 *
 * S'y ajoutent deux mécaniques du jeu recopiées du SWF :
 *   · PopupFX (asml.PopupFX, décompilé du bytecode — sprite 719) : le rebond
 *     élastique des écrans et du terrier ;
 *   · Nombre (asml.NumberMC) : une rangée de clips-chiffres (policeVert 515,
 *     policePointRed 561, policePointYellow 590 — l'image n+1 porte le
 *     chiffre n), alignable au centre comme le fait Popup.as.
 */
'use strict';

(function (racine) {

const BASE = '/snake3/sprites/';

let manifeste = null;
/*
 * ── LES DOCUMENTS SVG NE RESTENT PAS EN VIE ────────────────────────────────
 *
 * « Toujours quelques lags pendant les parties. Très courts mais fréquents. »
 *
 * Une Image dont la source est un SVG n'est pas une image : c'est un DOCUMENT
 * entier que le navigateur garde derrière elle — sa page, son arbre, ses
 * styles. On en gardait mille cent (chaque dessin du jeu, décodé une fois,
 * rangé ici pour toujours), soit trente-cinq mille nœuds que CHAQUE ramassage
 * complet du moteur JavaScript doit parcourir — le tas JS, lui, ne pèse que
 * trois mégaoctets. Mesuré (scratchpad snake-lags, CPU ×1) : un ramassage
 * complet dure 125 à 170 ms avec ces documents vivants, 12 ms sans ; et le
 * navigateur en déclenche un toutes les cinq à dix secondes de partie
 * (« memory reducer », puis la croissance ordinaire du tas) — c'est le lag,
 * court et fréquent, sur une machine qui pourtant ne fait rien de lourd.
 *
 * Un dessin ne se peint qu'une fois par palier (rendreFichier), dans un
 * tampon qui ne doit rien au document. On RELÂCHE donc le document dès qu'il
 * a servi — en fin d'image d'écran (`relacher`, appelé par la boucle du jeu),
 * et l'on garde trois choses à sa place, toutes légères pour le ramasseur :
 *   · sa SOURCE (l'adresse blob du lot, qu'on ne révoque plus) — pour le
 *     redécoder si un autre palier, ou une autre densité, le redemande ;
 *   · sa TAILLE naturelle — le palier et la clef de cache en dépendent ;
 *   · son dernier tampon peint, en SECOURS : le temps d'un redécodage (une
 *     ou deux images d'écran), c'est lui qu'on dessine à l'échelle demandée,
 *     plutôt que rien — un fruit qui saute ne clignote pas.
 * Les fichiers des lots qui ne servent qu'à l'écran (écrans, pages, menu :
 * plus de 150 pixels) ne se décodent plus d'avance du tout : leur tampon
 * pèserait des mégaoctets, et leur première apparition est toujours un
 * rebond parti de zéro. Les petits (fruits, options, chiffres) se peignent au
 * palier 1 dès leur décodage, puis le document part : c'est l'état où la
 * chauffe les aurait mis, sans le document.
 */
const images = new Map();             // fichier → Image VIVANTE (en cours de décodage, ou décodée et pas encore relâchée)
const sources = new Map();            // fichier → adresse (le blob du lot), gardée pour redécoder
const tailles = new Map();            // fichier → { w, h } : la taille naturelle, relevée au décodage
const rendus = new Map();             // fichier@k[/variante] → { c, dx, dy, lw, lh, kp }
const secours = new Map();            // fichier[/variante] → le dernier tampon peint, toutes densités
const aRelacher = new Set();          // les fichiers dont le document a peint un tampon cette image
let tour = 0;                         // le compteur d'images d'écran de `relacher`
const GRAND = 150;                    // pixels logiques : au-delà, un dessin « d'écran »
let DENSITE = 1;                      // pixels physiques par pixel logique (1..4)

function chargerManifeste() {
  // Le manifeste versionné par lots.js (sprites.json?v=empreinte) : le
  // dossier des sprites est servi avec un cache long, un manifeste regénéré
  // doit changer d'adresse pour être revu.
  const L = racine.SnakeLots;
  return fetch(BASE + ((L && L.manifeste) || 'sprites.json'))
    .then((r) => r.json())
    .then((m) => { manifeste = m; return m; });
}

/* ── LES LOTS (scripts/build-snake3-lots.js) ────────────────────────────────
 *
 * Le jeu est fait de 1 247 fichiers SVG que le client chargeait UN PAR UN : à
 * six connexions et quarante millisecondes d'aller-retour, l'arène mettait
 * huit secondes et demie à venir la première fois, quatorze au téléphone —
 * le temps du NOMBRE de requêtes, pas du poids (577 ko sur le fil).
 *
 * Un lot est un JSON { fichier → texte SVG } : une requête au lieu de
 * centaines. Chaque texte devient une Image par un blob — le même objet, dans
 * le même registre, que si le fichier était venu du réseau : rendreFichier ne
 * voit pas la différence.
 *
 * Sans lots.js — ou si un lot manque, ou si un fichier n'est dans aucun lot —
 * image() va chercher le fichier comme avant : rien ne casse, c'est seulement
 * plus lent.
 *
 * ── ET LE DÉCODAGE NE SE DISPUTE PLUS LE FIL AVEC LA PARTIE ────────────────
 *
 * Les lots venaient « en fond » : l'arène d'abord, puis les fruits tardifs,
 * les suites d'animation, le livre — l'un après l'autre, par paquets de
 * quarante images entre deux tours de boucle. Mesuré sur un téléphone bridé
 * (perf-lag, CPU ×4, DPR 3), pour un joueur qui se rue sur « jouer » : les
 * trois lots de fond s'étalent sur les QUARANTE premières secondes de la
 * partie, et y font quarante-cinq tâches de plus de cinquante millisecondes
 * — quatre secondes et demie de fil principal, la moitié de chaque seconde
 * pendant les huit premières. C'est LE « petit lag du début », et les
 * « freezes de temps en temps » qui suivent. Trois coûts s'y additionnaient :
 * lire le JSON (deux mégaoctets et demi pour les fruits), bâtir un Blob et
 * une adresse par fichier (deux secondes à eux seuls), et décoder chaque SVG
 * — tous les trois sur le fil principal, tous pendant qu'on joue.
 *
 * Trois règles, maintenant :
 *   · la LECTURE du lot et les blobs se font dans un OUVRIER (lots.worker.js)
 *     — le fil principal ne reçoit que des adresses prêtes ;
 *   · le DÉCODAGE des SVG, qui ne peut pas quitter le fil principal, passe
 *     par UNE file, par vagues bornées : douze images quand le fil est libre
 *     (menu, rideau, pause, fin de partie), UNE toutes les soixante
 *     millisecondes pendant la partie — et la vague suivante ne part que
 *     lorsque la précédente est décodée (ses `load`), ce qui est ce qui borne
 *     réellement le travail par tour ;
 *   · un dessin qu'on demande AVANT son tour (`image()` sur un fichier en
 *     attente — un fruit tardif que la frutibarre appelle) passe devant : il
 *     se décode tout de suite depuis son blob, sans retourner au réseau.
 *
 * Le jeu dit à `freiner()` s'il est en partie ; c'est lui qui a le tempo.
 */
const OUVRIER = '/snake3/lots.worker.js';
const VAGUE_LIBRE = 12;               // images par vague, le fil étant libre
const VAGUE_PARTIE = 1;               // …et pendant la partie
const DELAI_PARTIE = 120;             // ms entre deux vagues en partie
// En partie, une image ne se décode que si l'image d'écran précédente est
// venue à l'heure : au-delà de trente millisecondes entre deux images, la
// machine est déjà à la peine — un décodage de plus, c'est une image sautée.
const CADENCE_LIBRE = 30;

const lots = new Map();               // nom → Promise<bool>
const enAttente = new Map();          // fichier → entrée de la file
const decodeur = { file: [], enCours: 0, frein: false, programme: false, cadence: 0 };
let ouvrier = null;                   // le Worker, ou false s'il est hors d'usage
const attentesOuvrier = new Map();    // nom → { resoudre, rejeter }

function chargerLot(nom) {
  const L = racine.SnakeLots;
  if (!L || !L.lots || !L.lots[nom] || typeof fetch === 'undefined') return Promise.resolve(false);
  if (lots.has(nom)) return lots.get(nom);
  const url = BASE + L.lots[nom];
  const pr = lireLotParOuvrier(nom, url)
    .catch(() => lireLotIci(url))
    .then((urls) => (urls ? mettreEnFile(nom, urls) : false))
    .catch(() => false);
  lots.set(nom, pr);
  return pr;
}

// L'ouvrier lit le lot et rend [[fichier, adresse blob], …]. Sans Worker (ou
// s'il tombe), on rejette : le lot se lit ici, comme avant.
function lireLotParOuvrier(nom, url) {
  if (ouvrier === false || typeof Worker === 'undefined') return Promise.reject(new Error('pas d’ouvrier'));
  if (!ouvrier) {
    try {
      ouvrier = new Worker(OUVRIER);
      ouvrier.onmessage = (e) => {
        const d = e.data || {};
        const a = attentesOuvrier.get(d.nom);
        if (!a) return;
        attentesOuvrier.delete(d.nom);
        if (d.erreur || !Array.isArray(d.urls)) a.rejeter(new Error(d.erreur || 'lot illisible'));
        else a.resoudre(d.urls);
      };
      ouvrier.onerror = () => {
        // L'ouvrier est mort : ceux qui l'attendaient retombent sur le chemin
        // d'ici, et plus personne ne le sollicite.
        for (const a of attentesOuvrier.values()) a.rejeter(new Error('ouvrier en panne'));
        attentesOuvrier.clear();
        try { ouvrier.terminate(); } catch (e) { /* déjà parti */ }
        ouvrier = false;
      };
    } catch (e) { ouvrier = false; return Promise.reject(e); }
  }
  return new Promise((resoudre, rejeter) => {
    attentesOuvrier.set(nom, { resoudre, rejeter });
    ouvrier.postMessage({ nom, url });
  });
}

// Le chemin sans ouvrier : lecture et blobs sur le fil principal.
function lireLotIci(url) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return Promise.resolve(null);
  return fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((lot) => {
      if (!lot) return null;
      const urls = [];
      for (const f of Object.keys(lot)) urls.push([f, URL.createObjectURL(new Blob([lot[f]], { type: 'image/svg+xml' }))]);
      return urls;
    });
}

// Les adresses d'un lot entrent dans la file ; la promesse tient jusqu'à ce
// que la DERNIÈRE image du lot soit décodée. Les adresses sont GARDÉES
// (`sources`) : un document relâché se redécode d'ici, sans retour au réseau.
// Les grands dessins (écrans, pages) ne font pas la file : ils ne se
// décoderont qu'à leur première apparition, comme n'importe quel fichier hors
// lot — mais depuis leur blob.
function mettreEnFile(nom, urls) {
  if (typeof Image === 'undefined') return Promise.resolve(false);
  return new Promise((resoudre) => {
    const lot = { nom, restants: 0, resoudre };
    for (const [f, url] of urls) {
      if (sources.has(f) || images.has(f) || enAttente.has(f)) { revoquer(url); continue; }
      sources.set(f, url);
      if (estGrand(f)) continue;
      const entree = { fichier: f, url, lot };
      lot.restants++;
      enAttente.set(f, entree);
      decodeur.file.push(entree);
    }
    if (lot.restants === 0) { resoudre(true); return; }
    programmerVague();
  });
}

function revoquer(url) {
  try { URL.revokeObjectURL(url); } catch (e) { /* d'un autre contexte : l'ouvrier s'en charge */ }
}

// Le cadre d'un fichier d'après le manifeste (clé → frames → fichier), et
// s'il est « d'écran ». Sans manifeste (les bancs), rien n'est grand.
let cadres = null;                    // fichier → cadre, bâti à la première demande
function cadreDe(fichier) {
  if (!manifeste) return null;
  if (!cadres) {
    cadres = new Map();
    for (const clip of Object.values(manifeste.clips || {})) {
      for (const f of Object.values(clip.frames || {})) {
        if (f.fichier && f.cadre) cadres.set(f.fichier, f.cadre);
        for (const a of (f.anim || [])) if (a.fichier && a.cadre) cadres.set(a.fichier, a.cadre);
      }
    }
  }
  return cadres.get(fichier) || null;
}
function estGrand(fichier) {
  const c = cadreDe(fichier);
  return !!c && Math.max(c.w || 0, c.h || 0) > GRAND;
}

// Une entrée de la file — ou un fichier froid { fichier, url } — devient une
// Image, maintenant. Au décodage, on relève sa taille, et un petit dessin se
// peint tout de suite au palier 1 : son document n'a plus rien à faire ici.
function lancerImage(entree) {
  enAttente.delete(entree.fichier);
  const im = new Image();
  const lot = entree.lot;
  decodeur.enCours++;
  const fait = () => {
    decodeur.enCours--;
    // C'est CE drapeau, et non `complete`, qui dit « décodée » : une image
    // relancée depuis un blob déjà en cache est `complete` sur-le-champ, son
    // `load` n'étant que mis en file — la relâcher avant qu'il n'arrive
    // (src retiré) l'annulerait, et `enCours` ne redescendrait jamais.
    im.decodee = true;
    im.tourPret = tour;
    if (im.naturalWidth) tailles.set(entree.fichier, { w: im.naturalWidth, h: im.naturalHeight });
    peindreAuDecodage(entree.fichier);
    // Une image `complete` d'emblée a pu peindre AVANT ce load (et la fin
    // d'image l'a laissée, à raison) : elle a servi, elle peut partir.
    if (im.aPeint) aRelacher.add(entree.fichier);
    if (lot && --lot.restants === 0) lot.resoudre(true);
    if (decodeur.enCours === 0) programmerVague();
  };
  im.addEventListener('load', fait);
  im.addEventListener('error', fait);
  im.src = entree.url;
  images.set(entree.fichier, im);
  return im;
}

// Le tampon du palier 1 d'un petit dessin, dès son décodage — et FORCÉ,
// comme à la chauffe : le document peut alors partir. Les grands dessins
// attendent leur première apparition (un écran de 700 pixels à la densité 3
// pèse douze mégaoctets : on n'en peint que ceux qui servent).
function peindreAuDecodage(fichier) {
  if (typeof document === 'undefined') return;
  const cadre = cadreDe(fichier);
  if (!cadre || estGrand(fichier)) return;
  const r = rendreFichier(fichier, cadre, 1);
  if (r && !r.secours) forcerTampon(r.c);
}

/*
 * LA FIN D'UNE IMAGE D'ÉCRAN : les documents qui ont peint un tampon partent
 * (`src` retiré, l'élément oublié) — leur source, leur taille et leur tampon
 * restent. La boucle du jeu l'appelle à chaque image. Un document décodé
 * depuis longtemps sans avoir rien peint de neuf (un redécodage dont le
 * dessin n'a finalement pas été redemandé, ou dont le palier 1 existait
 * déjà) part aussi, au bout d'une demi-seconde, pourvu qu'un tampon de
 * secours existe pour lui.
 */
const PATIENCE_RELACHE = 30;          // images d'écran
function relacher() {
  tour++;
  for (const f of aRelacher) relacherUne(f);
  aRelacher.clear();
  if (tour % 16 === 0) {
    for (const [f, im] of images) {
      if (im.decodee && tour - im.tourPret >= PATIENCE_RELACHE) relacherUne(f);
    }
  }
}

function relacherUne(fichier) {
  const im = images.get(fichier);
  // Pas encore décodé (son `load` n'est pas passé), en échec (rien à
  // redessiner), ou jamais peint : il reste.
  if (!im || !im.decodee || !im.naturalWidth || !secours.has(fichier)) return;
  images.delete(fichier);
  if (typeof im.removeAttribute === 'function') im.removeAttribute('src');
}

// Pour les tests : les documents vivants, les tampons, les sources gardées.
function etatImages() {
  const enDecodage = [];
  for (const [f, im] of images) if (!im.decodee) enDecodage.push(f);
  return { vivantes: images.size, enDecodage, tampons: rendus.size, secours: secours.size, sources: sources.size, tailles: tailles.size };
}

// La vague suivante : au prochain tour hors partie (les `load` de la vague en
// cours arrivent chacun dans leur tâche — la boucle du jeu passe entre) ; à
// petit pas, cadencé, pendant la partie.
function programmerVague() {
  if (decodeur.programme || !decodeur.file.length) return;
  decodeur.programme = true;
  const lancer = () => { decodeur.programme = false; vague(); };
  setTimeout(lancer, decodeur.frein ? DELAI_PARTIE : 0);
}

function vague() {
  // En partie, sur une machine qui n'arrive déjà pas à tenir la cadence, on
  // ne décode rien : on repassera à la prochaine échéance.
  if (decodeur.frein && decodeur.cadence > CADENCE_LIBRE) { programmerVague(); return; }
  const n = decodeur.frein ? VAGUE_PARTIE : VAGUE_LIBRE;
  let lancees = 0;
  while (lancees < n && decodeur.file.length) {
    const e = decodeur.file.shift();
    if (!enAttente.has(e.fichier)) continue;    // déjà passée devant (image())
    lancerImage(e);
    lancees++;
  }
  // Rien lancé (tout était déjà décodé) : on repasse sans attendre de load.
  if (lancees === 0 && decodeur.file.length) programmerVague();
}

// Le jeu dit s'il est EN PARTIE : le décodeur ralentit d'autant, et la
// chauffe (plus bas) s'arrête net. `cadence` : les millisecondes entre les
// deux dernières images d'écran — la mesure de la peine de la machine.
function freiner(actif, cadence) {
  if (typeof cadence === 'number') decodeur.cadence = cadence;
  const f = !!actif;
  if (decodeur.frein === f) return;
  decodeur.frein = f;
  if (!f) programmerVague();
}

// Pour les tests : l'état du décodeur, en lecture.
function etatDecodeur() {
  return { enFile: decodeur.file.filter((e) => enAttente.has(e.fichier)).length, enCours: decodeur.enCours, frein: decodeur.frein, cadence: decodeur.cadence };
}

// Pour les tests sous Node : injecter le manifeste sans fetch ni DOM.
function poserManifeste(m) { manifeste = m; }

// L'Image VIVANTE d'un fichier — décodée ou en cours —, lancée s'il le faut :
// un fichier de la file passe devant, depuis son blob ; un fichier froid (son
// document relâché, ou un grand dessin jamais décodé) repart de sa source ;
// un fichier hors lot vient du réseau. Pour savoir si un dessin est PRÊT à
// se peindre, c'est `tailles` qu'il faut lire : un document relâché l'est.
function image(fichier) {
  const im = images.get(fichier);
  if (im) return im;
  // Le fichier attend son tour dans la file : il passe devant, depuis son
  // blob — pas de retour au réseau pour un dessin qu'on a déjà.
  const e = enAttente.get(fichier);
  if (e) return lancerImage(e);
  // Sous Node (les tests lisent le manifeste sans navigateur) : un leurre
  // « chargé mais vide », que rendreFichier refuse et que precharger saute.
  if (typeof Image === 'undefined') return { complete: true, naturalWidth: 0 };
  return lancerImage({ fichier, url: sources.get(fichier) || (BASE + fichier), lot: null });
}

// Précharge les images d'un jeu de clés (avant d'ouvrir le jeu). Une entrée
// est une clé — toutes ses images — ou [clé, [images]] pour n'attendre que
// celles-là (les six écrans affichés sur cent quarante, les soixante premiers
// fruits). Les SUITES d'animation (voir plus bas) restent en dehors : elles
// pèsent le double du reste et ne servent qu'aux objets réellement posés —
// elles se décodent au premier besoin, l'image figée tenant la place.
function precharger(cles) {
  const promesses = [];
  for (const entree of cles) {
    const cle = Array.isArray(entree) ? entree[0] : entree;
    const seules = Array.isArray(entree) ? new Set(entree[1]) : null;
    const clip = manifeste.clips[cle];
    if (!clip) continue;
    for (const [n, f] of Object.entries(clip.frames)) {
      if (seules && !seules.has(Number(n))) continue;
      // Décodé puis relâché : il est prêt — on ne le redécode pas pour rien.
      if (tailles.has(f.fichier) && !images.has(f.fichier)) continue;
      const im = image(f.fichier);
      if (!im.complete) {
        promesses.push(new Promise((res) => {
          im.addEventListener('load', res);
          im.addEventListener('error', res);
        }));
      }
    }
  }
  return Promise.all(promesses);
}

function poserDensite(n) {
  const d = Math.max(1, Math.min(4, Math.ceil(n)));
  if (d !== DENSITE) { DENSITE = d; rendus.clear(); }
}

// Le cadre d'une frame (pixels de scène, x/y = coin par rapport au point
// d'ancrage du clip).
function cadre(cle, frame) {
  const clip = manifeste.clips[cle];
  const f = clip && (clip.frames[frame] || clip.frames[1]);
  return f ? f.cadre : null;
}

// La frame rasterisée à l'échelle k : canvas en pixels physiques (k·DENSITE),
// et sa géométrie LOGIQUE (dx/dy = coin, lw/lh = taille à dessiner).
function rendre(cle, frame, k) {
  const clip = manifeste.clips[cle];
  if (!clip) return null;
  const f = clip.frames[frame] || clip.frames[1];
  if (!f) return null;
  return rendreFichier(f.fichier, f.cadre, k);
}

/* ── LES PALIERS DE RASTERISATION ──────────────────────────────────────────
 *
 * On rasterisait une fois par VINGTIÈME d'échelle demandée. Or un fruit qui
 * apparaît passe par vingt-trois échelles (son clip d'enrobage rebondit de
 * 0,1 à 1,2 avant de se poser, puis s'efface en huit pas) : vingt-trois
 * peintures du SVG sur le fil principal, vingt-trois canvas gardés — pour un
 * seul fruit, sans compter son ombre teintée. Trois cents fruits, trente-sept
 * options : la mémoire montait par dizaines de mégaoctets au fil d'une partie,
 * et chaque apparition coûtait sa rafale de peintures.
 *
 * On rasterise par PALIER — une, deux ou quatre fois la taille du SWF, à la
 * densité de l'écran — et c'est le contexte qui met à l'échelle : au plus
 * trois tampons par dessin, un seul dans la vie ordinaire d'un fruit. Réduire
 * un tampon net ne se voit pas ; l'agrandir d'un quart, le temps d'un rebond,
 * non plus. Les GRANDS dessins (écrans, pages, fonds : plus de 300 pixels)
 * restent au palier 1 — un écran à 1,1 (le rebond d'entrée) tiré d'un tampon
 * double ferait trente mégaoctets pour trois images.
 */
function palier(k, taille) {
  if (k <= 1.25) return 1;
  if (taille.w * DENSITE > 300 || taille.h * DENSITE > 300) return 1;
  return k <= 2.5 ? 2 : 4;
}

// La taille et la clef de cache d'un fichier à l'échelle k — null tant que
// l'image n'a jamais été décodée (sa taille est relevée au décodage, et
// survit au document).
function clefRaster(fichier, k) {
  const taille = tailles.get(fichier);
  if (!taille) return null;
  const kp = palier(k || 1, taille);
  return { taille, kp, clef: fichier + '@' + kp };
}

// Le tampon de SECOURS d'un fichier (ou d'une de ses variantes), présenté à
// la géométrie demandée : le dernier peint, à quelque palier ou densité que
// ce soit. `secours: true` dit qu'il tient la place — rien ne doit le mettre
// en cache sous la clef demandée, et la chauffe repassera.
function tamponDeSecours(clefSecours, cadre) {
  const s = secours.get(clefSecours);
  if (!s) return null;
  return { c: s.c, dx: cadre.x, dy: cadre.y, lw: s.lw, lh: s.lh, kp: s.kp, secours: true };
}

function rendreFichier(fichier, cadre, k) {
  const cr = clefRaster(fichier, k);
  // Jamais décodé : on lance le décodage (depuis son blob s'il en a un), et
  // il n'y a rien à montrer d'ici là.
  if (!cr) { image(fichier); return null; }
  let r = rendus.get(cr.clef);
  if (r) return r;
  // Le palier manque, et le document est parti (ou se redécode) : on le
  // relance et l'on dessine, le temps qu'il revienne, le dernier tampon peint.
  const im = image(fichier);
  if (!im.complete || !im.naturalWidth) return tamponDeSecours(fichier, cadre);
  const kd = cr.kp * DENSITE;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(im.naturalWidth * kd));
  c.height = Math.max(1, Math.ceil(im.naturalHeight * kd));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  r = {
    c,
    dx: cadre.x,
    dy: cadre.y,
    lw: c.width / DENSITE / cr.kp,
    lh: c.height / DENSITE / cr.kp,
    kp: cr.kp,
  };
  rendus.set(cr.clef, r);
  secours.set(fichier, r);
  im.aPeint = true;
  aRelacher.add(fichier);               // le document a servi : il partira en fin d'image
  return r;
}

// Une VARIANTE d'un tampon (teinte, multiplication) : peinte depuis le tampon
// de base et mise en cache sous sa clef — ou, si la base n'est qu'un secours,
// depuis lui, en secours elle aussi (et gardée comme tel, pour ne pas la
// repeindre à chaque image le temps du redécodage).
function variante(fichier, cadre, k, suffixe, peindre) {
  const base = rendreFichier(fichier, cadre, k);
  if (!base) return null;
  const clefSecours = fichier + suffixe;
  if (base.secours) {
    let s = secours.get(clefSecours);
    if (!s) {
      s = peindre(base);
      secours.set(clefSecours, s);
    }
    return { c: s.c, dx: base.dx, dy: base.dy, lw: s.lw, lh: s.lh, kp: s.kp, secours: true };
  }
  const clef = fichier + '@' + base.kp + suffixe;
  let r = rendus.get(clef);
  if (r) return r;
  r = peindre(base);
  rendus.set(clef, r);
  secours.set(clefSecours, r);
  return r;
}

// ── Les clips animés ──────────────────────────────────────────────────────
// Une image de clip peut porter une SUITE (`anim`) : en Flash le clip parent
// est figé sur son image (gotoAndStop(id)) mais les sous-clips posés dessus
// continuent de jouer leur propre boucle — c'est ce qui fait ballotter le
// liquide des potions et claquer les ciseaux. `tick` est le nombre d'images
// écoulées depuis que l'objet est apparu (40/s, la cadence du SWF) ; la suite
// se lit modulo sa longueur, l'index 0 étant le départ de la boucle.
//
// Tant qu'une image de la suite n'est pas décodée, on retombe sur l'image
// figée : l'objet ne clignote pas, il s'anime dès que le décodage a suivi.
const amorces = new Set();

// Lance le décodage de toutes les suites d'un jeu de clés, sans attendre :
// le menu s'ouvre tout de suite, les fioles ballottent dès la première partie.
function amorcerAnimations(cles) {
  for (const cle of cles) {
    const clip = manifeste.clips[cle];
    if (!clip) continue;
    for (const f of Object.keys(clip.frames)) suiteDe(cle, Number(f));
  }
}

function suiteDe(cle, frame) {
  const clip = manifeste.clips[cle];
  if (!clip) return null;
  const f = clip.frames[frame] || clip.frames[1];
  if (f && f.anim) {
    const marque = cle + '#' + frame;
    if (!amorces.has(marque)) {
      amorces.add(marque);
      for (const a of f.anim) image(a.fichier);
    }
  }
  return f || null;
}

// L'entrée { fichier, cadre } à jouer pour ce tick (l'image figée sans suite).
function imageAnim(cle, frame, tick) {
  const f = suiteDe(cle, frame);
  if (!f || !f.anim) return f;
  const n = f.anim.length;
  const i = ((Math.floor(tick) % n) + n) % n;
  return f.anim[i];
}

function rendreAnim(cle, frame, tick, k) {
  const f = suiteDe(cle, frame);
  if (!f) return null;
  if (!f.anim) return rendreFichier(f.fichier, f.cadre, k);
  const a = imageAnim(cle, frame, tick);
  return rendreFichier(a.fichier, a.cadre, k) || rendreFichier(f.fichier, f.cadre, k);
}

// La frame rasterisée puis TEINTE en silhouette (Color.setRGB, ou le cxform
// de l'image « ombre ») : chaque pixel opaque prend la couleur. Le fond
// passe par un canvas intermédiaire — un source-atop sur le canvas de scène
// teinterait tout ce qui est déjà peint dessous.
function rendreTeinteFichier(fichier, cadre, k, couleur) {
  return variante(fichier, cadre, k, '/' + couleur, (base) => {
    const c = document.createElement('canvas');
    c.width = base.c.width;
    c.height = base.c.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(base.c, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = couleur;
    ctx.fillRect(0, 0, c.width, c.height);
    return { c, dx: base.dx, dy: base.dy, lw: base.lw, lh: base.lh, kp: base.kp };
  });
}

function rendreTeinte(cle, frame, k, couleur) {
  const clip = manifeste.clips[cle];
  const f = clip && (clip.frames[frame] || clip.frames[1]);
  return f ? rendreTeinteFichier(f.fichier, f.cadre, k, couleur) : null;
}

function rendreTeinteAnim(cle, frame, tick, k, couleur) {
  const a = imageAnim(cle, frame, tick);
  if (!a) return null;
  return rendreTeinteFichier(a.fichier, a.cadre, k, couleur)
    || rendreTeinte(cle, frame, k, couleur);
}

// La frame sous un cxform MULTIPLICATIF (les pastilles du menu : ra=p,
// ga=0,6p+0,4, ba=p) : multiplie chaque canal par le facteur, l'alpha
// d'origine étant restauré ensuite. Les facteurs sont quantifiés au 1/32
// pour borner le cache.
function rendreMultiplie(cle, frame, k, mr, mv, mb) {
  const q = (v) => Math.round(Math.max(0, Math.min(1, v)) * 32) / 32;
  mr = q(mr); mv = q(mv); mb = q(mb);
  if (mr === 1 && mv === 1 && mb === 1) return rendre(cle, frame, k);
  const clip = manifeste.clips[cle];
  const f = clip && (clip.frames[frame] || clip.frames[1]);
  if (!f) return null;
  return variante(f.fichier, f.cadre, k, '*' + mr + ',' + mv + ',' + mb, (base) => {
    const c = document.createElement('canvas');
    c.width = base.c.width;
    c.height = base.c.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(base.c, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(' + Math.round(mr * 255) + ',' + Math.round(mv * 255) + ',' + Math.round(mb * 255) + ')';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(base.c, 0, 0);
    return { c, dx: base.dx, dy: base.dy, lw: base.lw, lh: base.lh, kp: base.kp };
  });
}

/* ── LA CHAUFFE : RASTERISER AVANT QU'ON EN AIT BESOIN ─────────────────────
 *
 * Un dessin ne se rasterise qu'à sa PREMIÈRE apparition (rendreFichier) : la
 * peinture du SVG dans un tampon, sur le fil principal. Pour une partie qui
 * commence, c'est le fond de l'arène (deux pleins écrans), la frutibarre, la
 * tête, les chiffres, puis chaque fruit et chaque option la première fois
 * qu'ils tombent — autant de coups de frein semés sur les premières secondes,
 * quand la partie est encore fraîche. Mesuré (perf-lag2, CPU ×4) : le premier
 * tour d'arène coûtait à lui seul cent quatre-vingts millisecondes, et chaque
 * fruit nouveau sa poignée.
 *
 * On rasterise donc D'AVANCE, par tranches que LA BOUCLE DU JEU donne à
 * chaque image (`chaufferPendant`) — quelques millisecondes derrière le menu,
 * une vingtaine quand le rideau est tenu fermé et qu'il n'y a rien d'autre à
 * faire, rien du tout pendant la partie. (Un `requestIdleCallback` n'aurait
 * eu que des miettes : la boucle tourne à quarante images par seconde et ne
 * laisse pas le fil « libre » au sens du navigateur ; mesuré, la chauffe
 * mettait trente secondes à passer derrière un rideau fermé.) Chaque tampon
 * est FORCÉ par un drawImage 1×1 sur un canevas de service : sans cela le
 * navigateur garde la peinture en attente et la ferait à la première vraie
 * apparition, et rien n'aurait chauffé du tout.
 *
 * Une entrée : { cle, frame, k, teinte? } ou { fichier, cadre, k, teinte? }.
 * La promesse rend le nombre de tampons peints — une image pas encore
 * décodée est simplement sautée (elle chauffera à sa première apparition).
 */
const chauffe = { file: [], service: null };
const maintenant = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());

function chauffer(entrees) {
  if (typeof document === 'undefined' || !Array.isArray(entrees)) return Promise.resolve(0);
  return new Promise((resoudre) => {
    chauffe.file.push({ entrees: entrees.slice(), i: 0, faites: 0, remises: [], resoudre });
  });
}

// Une tranche de `budget` millisecondes, maintenant — rien en partie. Une
// entrée dont le dessin se (re)décode est REMISE : elle repasse à la tranche
// suivante, quand son document sera là — sans quoi la chauffe sauterait tout
// ce qu'elle a elle-même relâché après le palier 1 (les chiffres à 2 et 4,
// le saut des fruits).
const PLUS_TARD = 'plus tard';
const ESSAIS_CHAUFFE = 40;            // tranches, soit autant d'images d'écran
function chaufferPendant(budget) {
  if (decodeur.frein || !chauffe.file.length) return 0;
  const t0 = maintenant();
  let faites = 0;
  while (chauffe.file.length) {
    const tache = chauffe.file[0];
    while (tache.i < tache.entrees.length) {
      const e = tache.entrees[tache.i++];
      const etat = chaufferUne(e);
      if (etat === true) { tache.faites++; faites++; }
      else if (etat === PLUS_TARD && (e.essais = (e.essais || 0) + 1) <= ESSAIS_CHAUFFE) tache.remises.push(e);
      if (maintenant() - t0 >= budget) return faites;
    }
    if (tache.remises.length) {
      tache.entrees = tache.remises;
      tache.remises = [];
      tache.i = 0;
      return faites;                    // la tranche suivante : les décodages auront eu leur tâche
    }
    chauffe.file.shift();
    tache.resoudre(tache.faites);
  }
  return faites;
}

// Reste-t-il de quoi chauffer ?
function chauffeEnAttente() { return chauffe.file.length > 0; }

// Vrai (peint), faux (rien à peindre : image absente ou en échec — elle
// chauffera à sa première apparition), ou PLUS_TARD (son document se décode).
function chaufferUne(e) {
  const k = e.k || 1;
  let r = null;
  if (e.fichier) r = e.teinte ? rendreTeinteFichier(e.fichier, e.cadre, k, e.teinte) : rendreFichier(e.fichier, e.cadre, k);
  else r = e.teinte ? rendreTeinte(e.cle, e.frame, k, e.teinte) : rendre(e.cle, e.frame, k);
  if (!r) return seDecode(e) ? PLUS_TARD : false;
  if (r.secours) return PLUS_TARD;
  forcerTampon(r.c);
  return true;
}

// Le dessin d'une entrée de chauffe a-t-il un document en cours de décodage ?
function seDecode(e) {
  let fichier = e.fichier;
  if (!fichier && manifeste) {
    const clip = manifeste.clips[e.cle];
    const f = clip && (clip.frames[e.frame] || clip.frames[1]);
    fichier = f && f.fichier;
  }
  const im = fichier && images.get(fichier);
  return !!im && !im.decodee;
}

// Le tampon est réellement peint quand il sert de SOURCE : un drawImage 1×1
// sur le canevas de service l'y oblige, sans relire un seul pixel du tampon.
function forcerTampon(c) {
  if (!chauffe.service) {
    chauffe.service = document.createElement('canvas');
    chauffe.service.width = 1;
    chauffe.service.height = 1;
  }
  try {
    const s = chauffe.service.getContext('2d');
    s.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1);
    s.getImageData(0, 0, 1, 1);              // et le service ne garde rien en attente
  } catch (err) { /* un tampon vide : rien à forcer */ }
}

// Dessine la frame au point d'ancrage (x, y), échelle sx/sy (1 = taille du
// SWF), rotation en radians. Le contexte est déjà en repère logique.
function poserRendu(ctx, r, x, y, sx, sy, rot, alpha) {
  if (!r) return;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(sx == null ? 1 : sx, sy == null ? 1 : sy);
  if (alpha != null && alpha < 100) ctx.globalAlpha *= Math.max(0, alpha / 100);
  ctx.drawImage(r.c, r.dx, r.dy, r.lw, r.lh);
  ctx.restore();
}

function poser(ctx, cle, frame, x, y, sx, sy, rot, alpha) {
  poserRendu(ctx, rendre(cle, frame, Math.max(Math.abs(sx || 1), Math.abs(sy || 1))),
    x, y, sx, sy, rot, alpha);
}

// Idem, mais en jouant la suite d'animation de l'image (voir suiteDe).
function poserAnim(ctx, cle, frame, tick, x, y, sx, sy, rot, alpha) {
  poserRendu(ctx, rendreAnim(cle, frame, tick, Math.max(Math.abs(sx || 1), Math.abs(sy || 1))),
    x, y, sx, sy, rot, alpha);
}

// ── PopupFX — asml.PopupFX, décompilé de snake3.swf (DoInitAction 719) ────
// z part de `depart` vers `cible` à `vitesse`·tmod par image, la vitesse
// multipliée par accel^tmod ; au-delà de cible±dépassement, on plaque, le
// dépassement et la vitesse décroissent, et le sens s'inverse — jusqu'à ce
// que le dépassement passe sous `seuil` : z se verrouille sur la cible.
// Le jeu l'applique à _xscale/_yscale (écrans : 0→100 rebond ; terrier :
// 100→0 tout droit, détruit dès z < 3).
class PopupFX {
  constructor(depart, cible, depassement, vitesse, accel, decroitDep, decroitVit, seuil) {
    this.z = depart;
    this.cible = cible;
    this.depassement = depassement;
    this.vitesse = vitesse;
    this.accel = accel;
    this.decroitDep = decroitDep;
    this.decroitVit = decroitVit;
    this.seuil = seuil;
    this.monte = depart < cible;
  }

  main(tmod) {
    if (this.monte) {
      this.z += tmod * this.vitesse;
      this.vitesse *= Math.pow(this.accel, tmod);
      if (this.z > this.cible + this.depassement) {
        this.z = this.cible + this.depassement;
        this.depassement *= this.decroitDep;
        this.vitesse *= this.decroitVit;
        this.monte = !this.monte;
      }
    } else {
      this.z -= tmod * this.vitesse;
      this.vitesse *= Math.pow(this.accel, tmod);
      if (this.z < this.cible - this.depassement) {
        this.z = this.cible - this.depassement;
        this.depassement *= this.decroitDep;
        this.vitesse *= this.decroitVit;
        this.monte = !this.monte;
      }
    }
    if (this.depassement < this.seuil) {
      this.depassement = 0;
      this.z = this.cible;
      this.vitesse = 0;
    }
  }
}

// ── Nombre — asml.NumberMC, décompilé de snake3.swf (sprite 715) ──────────
// `police` est la clé du clip de chiffres ; l'image n+1 porte le chiffre n.
// setVal pose les chiffres de DROITE À GAUCHE (unités d'abord), chacun reculé
// de sa propre chasse (_width) : l'ancre du nombre est son bord DROIT — c'est
// ainsi que le score, posé à x = WIDTH−BORDER, s'étend vers la gauche.
// alignCenter recale ensuite de +largeur/2 (et le centrage vertical, que
// Popup.as demande toujours avec, remonte de la demi-hauteur du chiffre).
class Nombre {
  constructor(police) {
    this.police = police;
    this.valeur = null;
    this.chiffres = [];
    this.centre = false;
    this.largeur = 0;
    this.hauteur = 0;
  }

  poserVal(n) {
    const v = Math.floor(Math.abs(n));
    if (v === this.valeur) return;
    this.valeur = v;
    this.chiffres = [];
    const texte = String(v);
    let x = 0;
    for (let i = texte.length - 1; i >= 0; i--) {
      const d = texte.charCodeAt(i) - 48;
      const c = cadre(this.police, d + 1);
      const w = c ? c.w : 10;
      x -= w;
      this.chiffres.push({ d, x });
    }
    this.largeur = -x;
    const c0 = cadre(this.police, 1);
    this.hauteur = c0 ? c0.h : 20;
  }

  // Dessine à (x, y) — l'ancre au bord droit, ou au centre si `centre`.
  dessiner(ctx, x, y, echelle) {
    const k = echelle == null ? 1 : echelle;
    const dx = this.centre ? this.largeur / 2 : 0;
    const dy = this.centre ? -this.hauteur / 2 : 0;
    for (const c of this.chiffres) {
      poser(ctx, this.police, c.d + 1, x + (c.x + dx) * k, y + dy * k, k, k, 0);
    }
  }
}

const API = {
  chargerManifeste, chargerLot, poserManifeste, precharger, poserDensite, cadre, rendre, rendreFichier,
  rendreTeinte, rendreTeinteFichier, rendreTeinteAnim, rendreMultiplie,
  imageAnim, rendreAnim, amorcerAnimations, poser, poserAnim, image, PopupFX, Nombre,
  freiner, chauffer, chaufferPendant, chauffeEnAttente, etatDecodeur,
  relacher, etatImages, estGrand,
  VAGUE_LIBRE, VAGUE_PARTIE, DELAI_PARTIE, CADENCE_LIBRE, GRAND, PATIENCE_RELACHE,
  get manifeste() { return manifeste; },
  get DENSITE() { return DENSITE; },
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeDessin = API;

})(typeof window !== 'undefined' ? window : globalThis);
