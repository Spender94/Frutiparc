/*
 * Minipixiz — le pont avec Frutiparc, et la réparation des fiches abîmées.
 *
 * Le serveur sait déjà lire la fiche de Minipixiz : extractGameItemsFromSlot en
 * tire les pictos de l'album (cent objets, cinquante-sept aliments, cinq
 * diamants), et computeConsecration le pourcentage. On écrit donc la fiche dans
 * le format d'origine (Card.mt) et tout suit.
 *
 * ── Pourquoi ce module est plus qu'un pont ──
 *
 * server.js porte SEPT fonctions de rattrapage écrites uniquement pour
 * Minipixiz : isMinipixizSlot0Corrupted, looksLikeMinipixizDefault,
 * padMinipixizSlot0, isMinipixizSlotHealthy, minipixizHasRichFaerie,
 * mergeFaerieByIdentity et parseMinipixizPipe. Elles compensent des dégâts que
 * Ruffle inflige au SWF :
 *
 *   • Array.toString() renvoie "" sur un tableau passé par le pont JSON, si
 *     bien que $item, $eat, $kill et $game partaient VIDES à la sauvegarde ;
 *   • le eval() de fromJSON renvoie null, la fiche chargée est perdue, le jeu
 *     repart sur formatFruticard() et écrase la vraie ;
 *   • les fées repassaient en {$level:N} nus, perdant nom, sorts et carac.
 *
 * Le portage natif supprime la CAUSE : plus de Ruffle, plus de pont JSON, plus
 * d'Array.toString(). Mais les fiches déjà abîmées, elles, sont en base. Ce
 * module les répare au chargement au lieu de propager le dégât — voir reparer().
 *
 * ── La règle qui protège tout le reste ──
 *
 * On ne sauvegarde JAMAIS sans avoir chargé, et jamais après une fiche
 * illisible. Une fiche neuve écrite par-dessus une vraie n'a pas d'erreur à
 * signaler : elle efface, simplement.
 */
'use strict';

(function (racine) {

const VERSION = 1.2;                  // Cm.VERSION
const NB_ZONES = 5;                   // $stat.$game / $kill : forêt, bassin, château, arc-en-ciel, arbre
const PAS_CHECKPOINT = 20;            // base/Forest.endGame : un relais tous les vingt niveaux

// Lang.checkpointName : les relais de la forêt, dans l'ordre. Le premier est
// toujours ouvert ; chacun se gagne en franchissant vingt niveaux depuis le
// précédent. Sept noms, donc sept relais — au-delà, le jeu d'origine n'avait
// plus rien à afficher.
const RELAIS = [
  'L’orée de la forêt',
  'La clairière sereine',
  'L’épaisse sommière',
  'Le cœur de la forêt',
  'L’antre sylvaine',
  'Le seuil empirique',
  'Le sentier oublié',
];

// Cs.bagLimit : combien de places l'inventaire offre selon le sac possédé.
// Sans sac — $bag à zéro — il n'y a AUCUNE place, et c'est voulu : Item.getRandomId
// ne fait alors tomber que des sacs. Le premier sac ouvre le jeu.
const PLACES_SAC = [0, 4, 6, 8, 9];
const IT_CLE = 31;                    // it/Key  — flGeneral : va au trousseau
const IT_SAC = 80;                    // it/Bag  — flGeneral : agrandit l'inventaire
const IT_FLASQUE = 30;
const PREMIER_ALIMENT = 300;

// Cm.formatFruticard, au champ près. C'est la forme que le serveur range et
// relit ; aucune traduction en route.
//
// $time part de MAINTENANT, et $s de l'heure qu'il est :
//
//     $t : Manager.date.getTime()
//     $s : int( Manager.date.getHours() * 60 * 60000 )
//
// Ce n'est pas de la décoration. Cm.updateTime calcule `et = maintenant - $t`
// et l'ajoute à $s ; avec $t à zéro, l'écart vaut cinquante-six ans, la boucle
// « tant que $s > un jour » tourne vingt mille fois et l'entretien du bassin,
// du vent, du donjon et de l'arc-en-ciel part en vrille. Et $s posé à l'heure
// réelle, c'est ce qui fait que la forêt est de nuit quand il fait nuit.
// `maintenant` est là pour les tests, qui ont besoin d'une fiche reproductible.
function carteNeuve(maintenant) {
  const d = new Date(maintenant === undefined ? Date.now() : maintenant);
  return {
    $time: { $t: d.getTime(), $d: 0, $s: Math.floor(d.getHours() * 60 * 60000) },
    $current: null,
    $vs: VERSION,
    $bag: 0,
    $wind: 0,
    $help: [],
    $key: 0,
    $star: 0,
    $diam: 0,
    $checkpoint: 0,
    $god: [false, false, false],
    $frog: false,
    $inv: [],
    $faerie: [],
    $pond: { $fs: null, $d: 0, $q: null },
    $dungeon: { $lvl: 0, $f: false, $day: 0, $loop: 0 },
    $rainbow: { $f: false, $day: null, $it: null },
    $mission: null,
    $mis: [],
    $stat: {
      $run: 0,
      $game: new Array(NB_ZONES).fill(0),
      $item: [],
      $eat: [],
      $kill: new Array(NB_ZONES).fill(0),
      $forestMax: 0,
      $treeMax: 0,
      $misNum: 0,
    },
  };
}

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Un tableau de compteurs d'au moins `n` cases. $game et $kill en ont toujours
// cinq — c'est d'ailleurs à leur longueur que le serveur reconnaît une fiche
// abîmée (isMinipixizSlot0Corrupted).
function compteurs(v, n) {
  const a = new Array(n).fill(0);
  if (Array.isArray(v)) for (let i = 0; i < Math.max(n, v.length); i++) a[i] = nombre(v[i]);
  return a;
}

/**
 * Répare une fiche, et dit ce qu'elle avait.
 *
 * Ce n'est pas de la défense au hasard : ce sont les dégâts CONNUS, ceux que les
 * garde-fous de server.js décrivent. On les corrige à la source plutôt que de
 * les traîner.
 *
 *   fiche absente ou scalaire      → on repart d'une fiche neuve
 *   $game / $kill de moins de cinq → signature du dégât « tableau → chaîne vide »
 *   $item / $eat non tableaux      → le même, sur les listes de l'album
 *   sous-objets absents            → $pond, $dungeon, $rainbow, $time
 *
 * Ce qu'on ne comprend PAS est recopié tel quel : une fiche peut porter des
 * champs des modes non encore portés, et les perdre serait pire que le dégât.
 *
 * @returns {{carte: object, reparations: string[]}}
 */
function reparer(brut) {
  const reparations = [];
  const neuve = carteNeuve();
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return {
      carte: neuve,
      reparations: (brut === undefined || brut === null) ? [] : ['fiche illisible'],
    };
  }
  // On part de ce qui existe : tout champ inconnu survit.
  const c = Object.assign({}, brut);

  for (const [cle, defaut] of Object.entries(neuve)) {
    // $current et $mission valent null par nature : leur absence n'est pas un
    // dégât, et les remplacer effacerait un choix du joueur.
    if (cle === '$current' || cle === '$mission') continue;
    if (c[cle] === undefined || c[cle] === null) {
      c[cle] = defaut;
      reparations.push(cle + ' absent');
    }
  }
  if (c.$current === undefined) c.$current = null;
  if (c.$mission === undefined) c.$mission = null;

  // Les tableaux, là où le dégât frappe.
  for (const cle of ['$help', '$inv', '$faerie', '$mis', '$god']) {
    if (!Array.isArray(c[cle])) {
      c[cle] = neuve[cle].slice();
      reparations.push(cle + ' n\'était pas un tableau');
    }
  }

  // Les sous-objets : on complète sans écraser.
  for (const cle of ['$time', '$pond', '$dungeon', '$rainbow']) {
    if (!c[cle] || typeof c[cle] !== 'object' || Array.isArray(c[cle])) {
      c[cle] = Object.assign({}, neuve[cle]);
      reparations.push(cle + ' reconstruit');
    } else {
      c[cle] = Object.assign({}, neuve[cle], c[cle]);
    }
  }

  // Une horloge à zéro n'est pas une horloge neuve : c'est une horloge de 1970,
  // et Cm.updateTime lui ferait rattraper cinquante-six ans d'entretien d'un
  // coup. On la remet à l'heure sans toucher au compteur de jours acquis.
  if (!(nombre(c.$time.$t) > 0)) {
    c.$time.$t = neuve.$time.$t;
    c.$time.$s = nombre(c.$time.$s) || neuve.$time.$s;
    reparations.push('$time.$t remis à l\'heure');
  }

  // $stat : le cœur de l'album, et la cible principale des dégâts.
  if (!c.$stat || typeof c.$stat !== 'object' || Array.isArray(c.$stat)) {
    c.$stat = neuve.$stat;
    reparations.push('$stat reconstruit');
  } else {
    const s = Object.assign({}, c.$stat);
    // $game et $kill ont TOUJOURS cinq cases : moins, c'est le dégât signé.
    for (const cle of ['$game', '$kill']) {
      if (!Array.isArray(s[cle]) || s[cle].length < NB_ZONES) {
        if (s[cle] !== undefined) reparations.push('$stat.' + cle + ' tronqué');
        s[cle] = compteurs(s[cle], NB_ZONES);
      } else {
        s[cle] = s[cle].map(nombre);
      }
    }
    for (const cle of ['$item', '$eat']) {
      if (!Array.isArray(s[cle])) {
        if (s[cle] !== undefined) reparations.push('$stat.' + cle + ' perdu');
        s[cle] = [];
      }
    }
    for (const cle of ['$run', '$forestMax', '$treeMax', '$misNum']) s[cle] = nombre(s[cle]);
    c.$stat = s;
  }

  for (const cle of ['$bag', '$key', '$star', '$diam', '$checkpoint']) c[cle] = nombre(c[cle]);
  if (!Number(c.$vs)) c.$vs = VERSION;
  return { carte: c, reparations };
}

// La fiche porte-t-elle une vraie progression ? Même règle que
// isMinipixizSlotHealthy côté serveur — on la relit pour savoir si une
// sauvegarde risquerait d'écraser quelque chose.
function porteUneProgression(c) {
  if (!c) return false;
  const s = c.$stat || {};
  if (nombre(s.$run) > 0) return true;
  if (Array.isArray(s.$item) && s.$item.some((v) => v)) return true;
  if (Array.isArray(s.$eat) && s.$eat.some((v) => nombre(v) > 0)) return true;
  if (Array.isArray(c.$faerie) && c.$faerie.length > 0) return true;
  if (nombre(c.$diam) > 0 || nombre(c.$star) > 0 || nombre(c.$key) > 0) return true;
  if (c.$dungeon && nombre(c.$dungeon.$lvl) > 0) return true;
  return false;
}

// /api/loadFrutiSlots répond en LoadVars — le format de Flash, pas du JSON.
function lireLoadVars(texte, slot) {
  const cible = 'slot' + (slot === undefined ? '0' : slot);
  for (const morceau of String(texte).split('&')) {
    const eq = morceau.indexOf('=');
    if (eq < 0) continue;
    if (morceau.slice(0, eq) !== cible) continue;
    try { return decodeURIComponent(morceau.slice(eq + 1).replace(/\+/g, ' ')); } catch (e) { return null; }
  }
  return null;
}

/**
 * Ce que le joueur porte, pour le tirage des objets (Item.scanInventory).
 * Le compte des flasques additionne l'inventaire du joueur ET celui de chaque
 * fée : c'est ce total qui rend la flasque suivante plus rare (cube du compte).
 */
function fiche(carte) {
  let flasques = 0;
  const compter = (l) => {
    if (!Array.isArray(l)) return;
    for (const v of l) if (nombre(v) === IT_FLASQUE) flasques++;
  };
  compter(carte && carte.$inv);
  for (const f of ((carte && carte.$faerie) || [])) if (f) compter(f.$inv);
  return { sac: nombre(carte && carte.$bag), flasques };
}

/**
 * Ramasser un objet, exactement comme Base.grab(type).
 *
 * Trois choses arrivent, dans cet ordre, et il ne faut en oublier aucune :
 *
 *   1. Cm.getItem — l'album. Sauf la clé du donjon (31) et les aliments (300+),
 *      qui ne s'y montrent pas ; c'est de là que viennent les pictos.
 *   2. les objets `flGeneral` ne vont PAS dans l'inventaire mais agissent
 *      aussitôt : la clé monte le trousseau (Cm.incKey, borné à neuf), le sac
 *      remplace le précédent (Cm.getNewBag).
 *   3. tout le reste cherche la première place LIBRE de l'inventaire, dans la
 *      limite du sac. Plus de place, l'objet est perdu — le jeu l'écrit
 *      lui-même, et sans sac il n'y a aucune place du tout.
 *
 * @returns {string} 'album' | 'cle' | 'sac' | 'inventaire' | 'perdu'
 */
function ramasser(c, type) {
  const n = nombre(type);
  if (n !== IT_CLE && n < PREMIER_ALIMENT && c.$stat.$item[n] !== true) c.$stat.$item[n] = true;

  if (n === IT_CLE) {                              // it/Key.grab → Cm.incKey(1)
    c.$key = Math.max(0, Math.min(nombre(c.$key) + 1, 9));
    return 'cle';
  }
  if (n >= IT_SAC && n < IT_SAC + PLACES_SAC.length) {   // it/Bag.grab → Cm.getNewBag(id+1)
    c.$bag = n - IT_SAC + 1;
    return 'sac';
  }

  const places = PLACES_SAC[Math.max(0, Math.min(nombre(c.$bag), PLACES_SAC.length - 1))];
  if (!Array.isArray(c.$inv)) c.$inv = [];
  for (let i = 0; i < places; i++) {
    if (c.$inv[i] === undefined || c.$inv[i] === null) { c.$inv[i] = n; return 'inventaire'; }
  }
  return 'perdu';
}

/**
 * Ce qu'une course en forêt ajoute à la fiche.
 *
 * Une course est une SUITE de niveaux : on gagne, on passe au suivant, jusqu'à
 * perdre ou atteindre le relais suivant. `run` la décrit :
 *
 *   niveaux    les niveaux terminés, dans l'ordre
 *   dernier    le niveau où la course s'est arrêtée
 *   objets     les identifiants ramassés (Base.grab)
 *   entree     vrai si c'est une nouvelle entrée en forêt ($stat.$game[0]++)
 *
 * ── Le carré, et son décalage d'un ──
 *
 * base/Forest.setWin fait `level += 1` AVANT d'appeler endGame, qui fait
 * `$stat.$run += int(Math.pow(level,2))`. Terminer le niveau n rapporte donc
 * (n+1)², et non n². Ça n'est pas un détail : le tout premier niveau, numéroté
 * zéro, ne rapporterait rien du tout — et $run est ce qui ouvre le donjon
 * ($run > 1000) et les fées ($run > (lvl+1)²×5000).
 */
function fusionner(carte, run) {
  const c = JSON.parse(JSON.stringify(carte));
  run = run || {};
  const s = c.$stat;

  if (run.entree) s.$game[0] = nombre(s.$game[0]) + 1;

  for (const n of (run.niveaux || [])) {
    const gagne = nombre(n) + 1;
    s.$run += Math.floor(gagne * gagne);
  }

  // base/Forest.kill : le meilleur niveau atteint ne redescend jamais.
  const dernier = nombre(run.dernier);
  s.$forestMax = Math.max(nombre(s.$forestMax), dernier + 1);

  for (const id of (run.objets || [])) ramasser(c, id);

  // base/Forest.endGame : le relais SUIVANT, et lui seul.
  //
  //     if( level == (Cm.card.$checkpoint+1)*20 ) Cm.card.$checkpoint += 1
  //
  // On n'en gagne donc jamais deux d'un coup, et repartir d'un vieux relais
  // pour refaire ses vingt niveaux n'en rapporte aucun : il faut atteindre le
  // premier qu'on n'a pas.
  if (dernier === (nombre(c.$checkpoint) + 1) * PAS_CHECKPOINT) c.$checkpoint = nombre(c.$checkpoint) + 1;

  return c;
}

// Le relais où s'arrête une course partie de `depart` : base/Forest.endGame
// ferme la partie dès que le niveau atteint est un multiple de vingt.
function finDeCourse(depart) {
  return (Math.floor(nombre(depart) / PAS_CHECKPOINT) + 1) * PAS_CHECKPOINT;
}

// Ce que la course vient d'ouvrir, dit au joueur avant que le serveur ne le
// confirme. Même règle que extractGameItemsFromSlot.
function nouveauxPictos(avant, apres) {
  const l = [];
  const a = (avant.$stat && avant.$stat.$item) || [];
  const b = (apres.$stat && apres.$stat.$item) || [];
  for (let i = 0; i < b.length; i++) if (b[i] && !a[i]) l.push({ genre: 'objet', num: i });
  return l;
}

class Plateforme {
  constructor(sid) {
    this.sid = sid || '';
    this.carte = carteNeuve();
    this.charge = false;
    this.reparations = [];
  }

  // Sans session (le jeu ouvert hors du site), on joue sans rien enregistrer.
  charger() {
    if (!this.sid) return Promise.resolve(this.carte);
    return fetch('/api/loadFrutiSlots?sid=' + encodeURIComponent(this.sid) + '&game=minipixiz',
      { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((txt) => {
        const brut = lireLoadVars(txt, '0');
        let o = null;
        if (brut) { try { o = JSON.parse(brut); } catch (e) { o = null; } }
        // Une fiche PRÉSENTE mais illisible n'est pas une fiche neuve : la
        // remplacer effacerait tout. On joue, mais on n'enregistre pas.
        if (brut && o === null) {
          this.charge = false;
          this.reparations = ['fiche illisible — enregistrement suspendu'];
          return this.carte;
        }
        const r = reparer(o);
        this.carte = r.carte;
        this.reparations = r.reparations;
        this.charge = true;
        return this.carte;
      })
      .catch(() => this.carte);        // charge reste faux : on ne sauvera pas
  }

  ecrire(avant) {
    const gagnes = nouveauxPictos(avant, this.carte);
    if (!this.sid || !this.charge) {
      return Promise.resolve({ enregistre: false, carte: this.carte, gagnes });
    }
    return fetch('/api/saveFrutiSlot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sid: this.sid, game: 'minipixiz', slotId: '0', data: JSON.stringify(this.carte),
      }),
    })
      .then((r) => ({ enregistre: r.ok, carte: this.carte, gagnes }))
      .catch(() => ({ enregistre: false, carte: this.carte, gagnes }));
  }

  // Appelé à la fin d'une course.
  enregistrer(run) {
    const avant = this.carte;
    this.carte = fusionner(avant, run);
    return this.ecrire(avant);
  }

  // Où le joueur peut reprendre : les relais acquis, tous les vingt niveaux
  // (base/Forest.initCheckpoint). Le premier est toujours ouvert.
  departs() {
    const l = [];
    for (let i = 0; i <= nombre(this.carte.$checkpoint); i++) l.push(i * PAS_CHECKPOINT);
    return l;
  }

  // La carte de la forêt : un relais par départ, avec son nom et le numéro
  // affiché au joueur (le jeu compte les niveaux à partir de un).
  carteDesRelais() {
    return this.departs().map((niveau, i) => ({
      index: i,
      niveau,
      affiche: niveau + 1,
      nom: RELAIS[i] || ('Relais ' + (i + 1)),
      fin: finDeCourse(niveau),
    }));
  }

  // Ce que le moteur doit savoir du joueur pour tirer ses objets.
  fiche() { return fiche(this.carte); }

  progression() {
    const s = this.carte.$stat || {};
    return {
      forestMax: nombre(s.$forestMax),
      run: nombre(s.$run),
      parties: nombre((s.$game || [])[0]),
      objets: (s.$item || []).filter(Boolean).length,
      checkpoint: nombre(this.carte.$checkpoint),
      sac: nombre(this.carte.$bag),
      cles: nombre(this.carte.$key),
      inventaire: (this.carte.$inv || []).filter((v) => v !== null && v !== undefined).length,
    };
  }
}

const API = {
  Plateforme, carteNeuve, reparer, fusionner, ramasser, fiche, lireLoadVars,
  nouveauxPictos, porteUneProgression, finDeCourse,
  VERSION, NB_ZONES, PAS_CHECKPOINT, PLACES_SAC, RELAIS,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizPlateforme = API;

})(typeof window !== 'undefined' ? window : globalThis);
