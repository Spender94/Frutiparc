//
// La CARTE DU JOUR de Motion Ball 2 — lue, dessinée, racontée.
//
// Chaque nuit, mb2gen.js tire le donjon du Challenge (mb2data.dat). Ce
// module le RELIT — le même flux binaire que motionball.swf, dans l'alphabet
// du SWF — et en tire trois choses pour le forum :
//
//   · le DONJON décodé : huit salles sur huit, chacune avec son type (rien,
//     salle ordinaire, boss, bille à trouver, bonus), ses quatre passages
//     (ouvert, fermé, invisible, porte) — et, à la suite du donjon dans le
//     même flux, le CONTENU de chaque salle : bumpers, blocs verts, trous,
//     interrupteur et ses blocs, téléporteurs, zappers, billes rouges et
//     bleues, chacun à sa place sur la grille de la salle (152 × 102 cases
//     de quatre pixels : LevelLoader.decode_room_bumpers) ;
//   · l'ANALYSE de chaque salle : ce qu'il y a dedans, et s'il faut la
//     bille verte (les blocs barrent le chemin) ou l'interrupteur (les blocs
//     bleus le barrent) pour la traverser — ce que les joueurs annotaient à
//     la main sur la capture de la carte ;
//   · le PLAN DÉTAILLÉ : les soixante-quatre salles dessinées à l'échelle
//     avec leur contenu, les passages secrets et les portes, dans un second
//     SVG (le premier reste la carte du jeu, telle quelle) ;
//   · le PLAN : LA CARTE DU JEU, telle que la pause la montre quand on a la
//     carte et le radar en poche (Pause.show_map de public/mb2/jeu/ecrans.js)
//     — les mêmes clips (`carte`, `room`), lus dans public/mb2/data/mb2.json
//     et rejoués en SVG, image par image, aux mêmes places ; rien n'y est
//     dessiné qui ne soit dans le jeu ;
//   · le MESSAGE du forum, en BBCode : les deux plans, puis le détail — où
//     l'on part, où est le boss, où trouver chaque bille et chaque bonus, les
//     portes, les passages invisibles, les salles à bumpers, les blocs verts
//     qu'il faut casser, les interrupteurs, les trous.
//
// Le repère est celui d'une grille de bataille navale : colonnes A à H de
// gauche à droite, lignes 1 à 8 de haut en bas — le sens du plan de la pause
// du jeu (x vers la droite, y vers le bas).
//
// Rien ici ne touche à la base ni au réseau : c'est le serveur qui publie
// (mb2PublierCarteDuJour dans server.js). Tout est pur et rejouable.
//
'use strict';

// ── Le flux binaire (ext.util.MTBitcodec, alphabet du SWF) ────────────────
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const VALEUR = {};
for (let i = 0; i < ALPHABET.length; i++) VALEUR[ALPHABET[i]] = i;

function lecteur(data) {
  let nbits = 0, bits = 0, pos = 0, erreur = false;
  const s = String(data || '');
  return {
    read(n) {
      while (nbits < n) {
        const v = VALEUR[s.charAt(pos++)];
        if (v === undefined) { erreur = true; return -1; }
        nbits += 6;
        bits = ((bits << 6) | v) >>> 0;
        // On ne garde que ce qui reste à lire : le tampon ne déborde jamais.
        bits &= (2 ** nbits) - 1;
      }
      nbits -= n;
      return Math.floor(bits / 2 ** nbits) & ((1 << n) - 1);
    },
    erreur: () => erreur,
    // `MTBitcodec.next_part` : on oublie les bits restants du caractère en
    // cours — le générateur cale chaque partie (donjon, puis salles) sur un
    // caractère entier (flushPartie).
    suite() { nbits = 0; bits = 0; },
  };
}

// ── Les noms des choses ────────────────────────────────────────────────────
// Ce que le jeu en fait (public/mb2/jeu/niveau.js) : les billes à trouver
// (VERTE, BLEUE, METAL, VIOLET), les bonus — deux billes de plus (ORANGE,
// ROUGE), la carte, le radar, le grelot (trois par boîte : il ouvre une
// porte), et deux rallonges de temps (une minute, trois minutes). Une porte
// s'ouvre au grelot ; un passage invisible se franchit mais n'est pas dessiné
// sur la carte ; la salle « objet requis » du flux est jouée comme une salle
// ordinaire.
const BILLES = ['verte', 'bleue', 'métal', 'violette'];
const BONUS = ['bille orange', 'bille rouge', 'carte', 'radar', 'grelot', '+1 min', '+3 min'];
const TYPES = ['vide', 'ordinaire', 'boss', 'bille', 'bonus', 'ordinaire (« objet requis » dans le flux, sans effet en jeu)'];
const PASSAGES = ['ouvert', 'fermé', 'invisible', 'porte'];
// Les objets d'une salle (Level.gen_bumper et gen_normal_room) : les cinq
// bumpers, le BLOC VERT — que seule la bille VERTE casse (Collide.wall_on_hit
// ne fait rien pour les autres) —, le trou, les billes rouge et bleue à
// ramasser, le téléporteur, l'INTERRUPTEUR et ses blocs rouges et bleus (les
// bleus sont solides au départ, les rouges le deviennent quand on frappe
// l'interrupteur), le zapper, et la sortie du mode classique.
const OBJETS = [null, 'bumper', 'bumper à temps', 'bumper mortel', 'bumper aimant', 'bumper ombre',
  'bloc vert', 'trou', 'bille rouge', 'bille bleue', 'téléporteur', 'interrupteur', 'bloc rouge', 'bloc bleu', 'zapper', 'sortie'];
const POS_NBITS = 8;                 // Const.POS_NBITS : ceil(log2(152))
const COLONNES = 'ABCDEFGH';

function nomCase(x, y) { return COLONNES[x] + (y + 1); }

// ── Le décodage ────────────────────────────────────────────────────────────
/**
 * Lit `ddata` (le champ de mb2data.dat) et rend le donjon :
 * { largeur, hauteur, depart:{x,y}, salles[x][y] } où une salle vaut
 * { type: 0..5, donnee, passages:[{type}] × 4 (gauche, droite, haut, bas) }
 * ou { type: 0 } pour une case vide.
 */
function decoderDonjon(ddata) {
  const bc = lecteur(ddata);
  const largeur = bc.read(7), hauteur = bc.read(7);
  const depart = { x: bc.read(7), y: bc.read(7) };
  if (largeur < 1 || largeur > 16 || hauteur < 1 || hauteur > 16) throw new Error('mb2carte : donjon illisible');
  const salles = [];
  for (let x = 0; x < largeur; x++) {
    salles[x] = [];
    for (let y = 0; y < hauteur; y++) {
      const s = { type: bc.read(3), donnee: -1, passages: null };
      if (s.type === 3 || s.type === 5) s.donnee = bc.read(2);
      else if (s.type === 4) s.donnee = bc.read(3);
      if (s.type !== 0) {
        s.passages = [];
        for (let d = 0; d < 4; d++) {
          // Une porte porte deux bits de plus dans le flux ; le jeu les lit et
          // n'en fait rien (c'est le grelot qui ouvre) — on les passe.
          const p = { type: bc.read(2) };
          if (p.type === 3) bc.read(2);
          s.passages.push(p);
        }
      }
      salles[x][y] = s;
    }
  }
  if (bc.erreur()) throw new Error('mb2carte : flux tronqué');
  // Le contenu des salles, à la suite, dans l'ordre du donjon (x puis y),
  // une entrée par case — vide comprise (un bit à zéro). Une salle : un bit,
  // puis des objets (type sur quatre bits, x et y sur huit) jusqu'au type 0.
  bc.suite();
  for (let x = 0; x < largeur; x++) {
    for (let y = 0; y < hauteur; y++) {
      const s = salles[x][y];
      s.objets = null;
      if (bc.read(1) !== 1) continue;
      s.objets = [];
      for (;;) {
        const t = bc.read(4);
        if (t <= 0) break;
        const ox = bc.read(POS_NBITS), oy = bc.read(POS_NBITS);
        if (bc.erreur()) break;
        s.objets.push({ type: t, x: ox, y: oy });
      }
    }
  }
  // Un flux d'avant les salles (ou tronqué) : on garde le donjon, sans
  // contenu — la carte du jeu ne s'en sert pas.
  if (bc.erreur()) for (let x = 0; x < largeur; x++) for (let y = 0; y < hauteur; y++) salles[x][y].objets = null;
  return { largeur, hauteur, depart, salles };
}

/** Le contenu de mb2data.dat (« dseed=…&ddata=… ») → { graine, donjon }. */
function lireFichier(contenu) {
  const m = /dseed=(\d+)&ddata=([A-Za-z0-9_-]+)/.exec(String(contenu || ''));
  if (!m) throw new Error('mb2carte : mb2data.dat illisible');
  return { graine: Number(m[1]), donjon: decoderDonjon(m[2]) };
}

// ── La lecture du donjon ───────────────────────────────────────────────────
function salle(d, x, y) {
  return (d.salles[x] && d.salles[x][y]) || { type: 0 };
}
// Un passage n'existe que s'il est ouvert DES DEUX CÔTÉS (Pause.path_open) ;
// une porte ou un passage invisible d'un côté suffit à le qualifier. (Pour
// le TEXTE ; le plan, lui, rejoue path_open tel quel.)
function passage(d, x, y, dir) {
  const a = salle(d, x, y);
  if (!a.passages) return null;
  const dx = [-1, 1, 0, 0][dir], dy = [0, 0, -1, 1][dir];
  const b = salle(d, x + dx, y + dy);
  if (!b.passages) return null;
  const pa = a.passages[dir], pb = b.passages[dir ^ 1];
  if (pa.type === 1 || pb.type === 1) return null;
  if (pa.type === 3) return pa;
  if (pb.type === 3) return pb;
  if (pa.type === 2 || pb.type === 2) return { type: 2 };
  return { type: 0 };
}

// ── L'analyse d'une salle ──────────────────────────────────────────────────
//
// Ce que les joueurs annotaient à la main sur la capture de la carte : les
// salles à bumpers, celles où des blocs verts barrent le passage — il faut
// alors la bille VERTE, la seule qui les casse —, celles où c'est
// l'interrupteur qui commande le passage, les trous.
//
// Pour le dire, on rejoue la grille de collision de la salle avec les tables
// de bumpers.txt (les mêmes silhouettes que le jeu : mb2gen._tables), on
// gonfle chaque obstacle du rayon de la bille (deux cases), et l'on cherche
// si les entrées de la salle — les passages praticables, et son centre — se
// rejoignent :
//
//   · oui, blocs verts et blocs bleus en place       → « libre » ;
//   · seulement si l'on retire les blocs verts        → « verte » ;
//   · seulement en basculant l'interrupteur           → « interrupteur » ;
//   · en basculant ET en cassant                      → « interrupteur+verte » ;
//   · jamais                                          → « bloquée » (ne devrait pas arriver).
const SOLIDES = new Set([1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14]);
const RAYON_BILLE = 2;               // Const.BALL_RAYSIZE (8 px) en cases de 4 px

let tables = null;
function tablesDeCollision() {
  if (!tables) {
    const gen = require('./mb2gen.js');
    gen.loadBumpers();
    const T = gen._tables;
    // La silhouette de chaque type : bumpers.txt en donne sept (les cinq
    // bumpers, le bloc, le trou) ; l'interrupteur, ses blocs et le zapper
    // prennent celle du bloc.
    const silhouette = (t) => T.bumpers[t - 1] || T.bumpers[5];
    tables = { CW: T.cwidth, CH: T.cheight, BORD: T.cborder, silhouette };
  }
  return tables;
}

function grilleDeSalle(objets, { sansVerts = false, interrupteur = false } = {}) {
  const { CW, CH, BORD, silhouette } = tablesDeCollision();
  const dur = Array.from({ length: CW }, () => new Uint8Array(CH));
  for (let i = 0; i < BORD; i++) for (let j = 0; j < CH; j++) { dur[i][j] = 1; dur[CW - 1 - i][j] = 1; }
  for (let j = 0; j < BORD; j++) for (let i = 0; i < CW; i++) { dur[i][j] = 1; dur[i][CH - 1 - j] = 1; }
  for (const o of objets || []) {
    if (!SOLIDES.has(o.type)) continue;
    if (o.type === 6 && sansVerts) continue;
    // Les bleus sont solides au départ, les rouges une fois l'interrupteur frappé.
    if (o.type === 13 && interrupteur) continue;
    if (o.type === 12 && !interrupteur) continue;
    const tbl = silhouette(o.type);
    for (let a = 0; a < tbl.length; a++) {
      for (let b = 0; b < tbl[a].length; b++) {
        if (!tbl[a][b]) continue;
        // Gonflé du rayon de la bille : elle ne passe pas où son centre ne passe pas.
        for (let dx = -RAYON_BILLE; dx <= RAYON_BILLE; dx++) {
          for (let dy = -RAYON_BILLE; dy <= RAYON_BILLE; dy++) {
            const px = o.x + a + dx, py = o.y + b + dy;
            if (px >= 0 && px < CW && py >= 0 && py < CH) dur[px][py] = 1;
          }
        }
      }
    }
  }
  return dur;
}

// Les entrées d'une salle : ses passages praticables (par `passage`, les deux
// côtés comptés) et son centre, en cases de la grille.
function entreesDeSalle(d, x, y) {
  const { CW, CH, BORD } = tablesDeCollision();
  const e = [{ nom: 'centre', x: Math.floor(CW / 2), y: Math.floor(CH / 2) }];
  const portes = [
    { nom: 'gauche', x: BORD + 1, y: Math.floor(CH / 2) },
    { nom: 'droite', x: CW - BORD - 2, y: Math.floor(CH / 2) },
    { nom: 'haut', x: Math.floor(CW / 2), y: BORD + 1 },
    { nom: 'bas', x: Math.floor(CW / 2), y: CH - BORD - 2 },
  ];
  for (let dir = 0; dir < 4; dir++) if (passage(d, x, y, dir)) e.push(portes[dir]);
  return e;
}

// Toutes les entrées se rejoignent-elles sur cette grille ?
function seRejoignent(dur, entrees) {
  const CW = dur.length, CH = dur[0].length;
  // Une entrée gonflée dans un obstacle : on part de la case libre la plus proche.
  const depart = (e) => {
    for (let r = 0; r <= 6; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const px = e.x + dx, py = e.y + dy;
          if (px >= 0 && px < CW && py >= 0 && py < CH && !dur[px][py]) return [px, py];
        }
      }
    }
    return null;
  };
  const departs = entrees.map(depart);
  if (departs.some((p) => !p)) return false;
  const vu = Array.from({ length: CW }, () => new Uint8Array(CH));
  const file = [departs[0]];
  vu[departs[0][0]][departs[0][1]] = 1;
  while (file.length) {
    const [px, py] = file.pop();
    for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
      if (nx < 0 || nx >= CW || ny < 0 || ny >= CH || dur[nx][ny] || vu[nx][ny]) continue;
      vu[nx][ny] = 1; file.push([nx, ny]);
    }
  }
  return departs.every(([px, py]) => vu[px][py]);
}

/**
 * Ce qu'il y a dans une salle et ce qu'il faut pour la traverser :
 * { compte: {type: n}, bumpers, blocs, trous, interrupteur, acces }
 * où `acces` vaut 'libre' | 'verte' | 'interrupteur' | 'interrupteur+verte' | 'bloquée'.
 * Sans contenu (flux d'avant les salles) : null.
 */
function analyserSalle(d, x, y) {
  const s = salle(d, x, y);
  if (!s.objets || s.type === 0) return null;
  const compte = {};
  for (const o of s.objets) compte[o.type] = (compte[o.type] || 0) + 1;
  const n = (t) => compte[t] || 0;
  const r = {
    compte,
    bumpers: n(1) + n(2) + n(3) + n(4) + n(5),
    blocs: n(6), trous: n(7), rouges: n(8), bleues: n(9),
    teleporteurs: n(10), interrupteur: n(11) > 0, blocsRouges: n(12), blocsBleus: n(13), zappers: n(14),
    acces: 'libre',
  };
  const entrees = entreesDeSalle(d, x, y);
  if (entrees.length < 2) return r;
  if (seRejoignent(grilleDeSalle(s.objets), entrees)) return r;
  if (r.blocs && seRejoignent(grilleDeSalle(s.objets, { sansVerts: true }), entrees)) { r.acces = 'verte'; return r; }
  if (r.interrupteur || r.blocsBleus) {
    if (seRejoignent(grilleDeSalle(s.objets, { interrupteur: true }), entrees)) { r.acces = 'interrupteur'; return r; }
    if (r.blocs && seRejoignent(grilleDeSalle(s.objets, { interrupteur: true, sansVerts: true }), entrees)) { r.acces = 'interrupteur+verte'; return r; }
  }
  r.acces = 'bloquée';
  return r;
}

/** Ce que la carte raconte, rangé : départ, boss, billes, bonus, portes… */
function decrire(d) {
  const r = { depart: null, boss: null, billes: [], bonus: [], portes: [], invisibles: [], salles: 0, vides: 0,
    // Le contenu des salles, quand le flux le porte.
    contenu: false, bumpers: [], blocsVerts: [], interrupteurs: [], trous: [], teleporteurs: [], zappers: [], bloquees: [] };
  for (let x = 0; x < d.largeur; x++) {
    for (let y = 0; y < d.hauteur; y++) {
      const s = d.salles[x][y];
      const c = nomCase(x, y);
      if (s.type === 0) { r.vides++; continue; }
      r.salles++;
      const a = analyserSalle(d, x, y);
      if (a) {
        r.contenu = true;
        if (a.bumpers) r.bumpers.push({ case: c, nombre: a.bumpers, compte: a.compte });
        if (a.blocs) r.blocsVerts.push({ case: c, nombre: a.blocs, obligatoire: a.acces === 'verte' || a.acces === 'interrupteur+verte' });
        if (a.interrupteur || a.blocsRouges || a.blocsBleus) r.interrupteurs.push({ case: c, obligatoire: a.acces === 'interrupteur' || a.acces === 'interrupteur+verte' });
        if (a.trous) r.trous.push({ case: c, nombre: a.trous });
        if (a.teleporteurs) r.teleporteurs.push({ case: c, nombre: a.teleporteurs });
        if (a.zappers) r.zappers.push({ case: c, nombre: a.zappers });
        if (a.acces === 'bloquée') r.bloquees.push({ case: c });
      }
      if (x === d.depart.x && y === d.depart.y) r.depart = c;
      if (s.type === 2) r.boss = c;
      else if (s.type === 3) r.billes.push({ bille: s.donnee, nom: BILLES[s.donnee], case: c });
      else if (s.type === 4) r.bonus.push({ bonus: s.donnee, nom: BONUS[s.donnee], case: c });
      // Les portes et les passages invisibles, une fois chacun (vers la
      // droite et vers le bas).
      for (const dir of [1, 3]) {
        const p = passage(d, x, y, dir);
        if (!p) continue;
        const voisin = nomCase(x + (dir === 1 ? 1 : 0), y + (dir === 3 ? 1 : 0));
        if (p.type === 3) r.portes.push({ entre: [c, voisin] });
        else if (p.type === 2) r.invisibles.push({ entre: [c, voisin] });
      }
    }
  }
  const ordre = (a, b) => a.case.localeCompare(b.case);
  r.billes.sort((a, b) => a.bille - b.bille);
  r.bonus.sort((a, b) => (a.bonus - b.bonus) || ordre(a, b));
  return r;
}

// ── Le plan : la carte du jeu, rejouée en SVG ──────────────────────────────
//
// Le jeu (Pause.show_map) pose le clip `carte` — le parchemin et sa grille —
// puis, case par case, des clips `room` figés sur une image : 1 et 2 pour un
// passage vers la gauche ou vers le haut (5, 6 depuis une salle visitée ; 9,
// 10 depuis la salle où l'on est), 14 à 17 les hachures d'une case vide, 26
// le départ, 31 le boss, 19/22/23/24 les billes, 21/20/28/27/29/30 les
// bonus (le radar, image 0, n'est pas marqué), 33 une salle visitée, 34 la
// salle où l'on est. On rejoue exactement cela, avec le joueur AU DÉPART et
// rien de visité d'autre — l'état de la carte quand on la découvre.
//
// Les dessins viennent de public/mb2/data/mb2.json (le manifeste des clips
// du SWF, celui que le jeu light affiche) : un clip est une liste d'images
// dont chacune place, déplace ou retire des enfants à une profondeur ; une
// forme est une suite de tracés SVG remplis ou tracés. On recompose l'état
// d'une image comme le fait le moteur (KalugaMoteur, flash.js : instantane),
// puis on l'écrit en SVG.
const fs = require('node:fs');
const path = require('node:path');

const DOSSIER_MB2 = path.join(__dirname, 'public', 'mb2', 'data');
const OBJFRAMES = [19, 22, 23, 24];                 // Pause.OBJFRAMES
const BONUSFRAMES = [21, 20, 28, 0, 27, 29, 30];    // Pause.BONUSFRAMES
const CARTE_X = 18, CARTE_Y = 16, PAS_X = 48, PAS_Y = 36;   // px = 18 + 48x, py = 16 + 36y

let biblio = null;
function bibliotheque() {
  if (!biblio) {
    const d = JSON.parse(fs.readFileSync(path.join(DOSSIER_MB2, 'mb2.json'), 'utf8'));
    biblio = { perso: d.perso, symboles: d.symboles, images: d.images, fichiers: new Map() };
  }
  return biblio;
}

// L'état de la liste d'affichage d'un clip à l'image f (1..n) : rejeu des
// placements 1..f — `p` la profondeur, `c` le caractère, `m` la matrice, `mv`
// un déplacement (l'enfant en place hérite de ce qu'on ne redit pas), `x`
// un retrait. Rendu trié par profondeur.
function instantane(def, f) {
  const etat = new Map();
  for (let i = 0; i < f; i++) {
    for (const op of def.frames[i].ops) {
      if (op.x !== undefined) { etat.delete(op.x); continue; }
      const avant = etat.get(op.p);
      if (op.c !== undefined && !(op.mv && avant)) {
        etat.set(op.p, { c: op.c, m: op.m || null });
        continue;
      }
      if (!avant) continue;
      if (op.c !== undefined) avant.c = op.c;
      if (op.m) avant.m = op.m;
    }
  }
  return [...etat.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
}

const matrice = (m) => (m && !(m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0)
  ? ` transform="matrix(${m.map((v) => +v.toFixed(3)).join(' ')})"` : '');

// Un remplissage par image : le fichier du manifeste, mis en ligne dans le
// SVG (un SVG dans une balise <img> ne charge rien d'extérieur). Un fichier
// SVG est imbriqué tel quel, ses identifiants préfixés pour ne heurter
// personne ; une image matricielle passe en data:.
function imageSvg(b, id, ctx) {
  const im = b.images[String(id)];
  if (!im) return '';
  let f = b.fichiers.get(id);
  if (!f) {
    const fichier = path.join(DOSSIER_MB2, 'img', im.f);
    if (/\.svg$/i.test(im.f)) {
      f = { svg: fs.readFileSync(fichier, 'utf8').replace(/^\s*<\?xml[^>]*>\s*/, '') };
    } else {
      const mime = /\.png$/i.test(im.f) ? 'image/png' : 'image/jpeg';
      f = { data: `data:${mime};base64,${fs.readFileSync(fichier).toString('base64')}` };
    }
    b.fichiers.set(id, f);
  }
  if (f.data) return `<image href="${f.data}" width="${im.l}" height="${im.h}" preserveAspectRatio="none"/>`;
  const pfx = ctx.id('i');
  return f.svg
    .replace(/\bid="([^"]+)"/g, (_, n) => `id="${pfx}-${n}"`)
    .replace(/url\(#([^)]+)\)/g, (_, n) => `url(#${pfx}-${n})`)
    .replace(/\bhref="#([^"]+)"/g, (_, n) => `href="#${pfx}-${n}"`);
}

// Une forme : ses tracés, dans l'ordre. Le lecteur ne trace jamais moins
// d'un pixel ; une image de remplissage est découpée par son tracé.
function formeSvg(b, def, ctx) {
  const out = [];
  for (const op of def.ops) {
    const tr = matrice(op.m);
    if (op.f) {
      const f = op.f;
      if (f.g) throw new Error('mb2carte : un dégradé sur la carte, non prévu');
      if (f.bm) {
        const id = ctx.id('d');
        out.push(`<clipPath id="${id}"><path d="${op.d}" clip-rule="evenodd"${tr}/></clipPath>`);
        out.push(`<g clip-path="url(#${id})"><g${matrice(f.bm.m)}>${imageSvg(b, f.bm.id, ctx)}</g></g>`);
      } else {
        const a = (f.a !== undefined && f.a < 1) ? ` fill-opacity="${f.a}"` : '';
        out.push(`<path d="${op.d}" fill="${f.c}"${a} fill-rule="evenodd"${tr}/>`);
      }
    } else if (op.s) {
      const st = op.s;
      const a = (st.a !== undefined && st.a < 1) ? ` stroke-opacity="${st.a}"` : '';
      out.push(`<path d="${op.d}" fill="none" stroke="${st.c}" stroke-width="${Math.max(st.w || 0, 1)}"${a} stroke-linecap="round" stroke-linejoin="round"${tr}/>`);
    }
  }
  return out.join('');
}

// Un caractère figé sur une image : une forme telle quelle, un clip par
// l'état de son image (ses enfants, chacun à l'image 1 — comme un
// gotoAndStop sur le parent seul).
function caractereSvg(b, id, frame, ctx) {
  const def = b.perso[String(id)];
  if (!def) return '';
  if (def.t === 'forme') return formeSvg(b, def, ctx);
  if (def.t !== 'clip') return '';                  // textes, morphs : rien sur la carte
  const f = Math.max(1, Math.min(def.n, frame || 1));
  return instantane(def, f).map((e) => `<g${matrice(e.m)}>${caractereSvg(b, e.c, 1, ctx)}</g>`).join('');
}

// Le random(4) des cases vides, rejouable : la même map donne le même plan
// (l'image est adressée par son contenu).
function aleas(graine) {
  let a = (Number(graine) || 0) >>> 0;
  return (n) => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

/**
 * Le plan du donjon : la carte de la pause du jeu, en SVG. `infos` :
 * { graine } (pour les hachures des cases vides et le commentaire du fichier).
 */
function carteSvg(d, infos) {
  const o = infos || {};
  const b = bibliotheque();
  const ROOM = b.symboles.room, CARTE = b.symboles.carte;
  let seq = 0;
  const ctx = { id: (p) => `${p}${++seq}` };
  const random = aleas(o.graine);
  const posX = d.depart.x, posY = d.depart.y;
  const salleDe = (x, y) => (d.salles[x] && d.salles[x][y]) || undefined;
  // Pause.path_open : `undefined` (pas de salle, pas de passages) passe.
  const pathOpen = (x, y, n) => {
    const room = salleDe(x, y);
    const p = room && room.passages ? room.passages[n].type : undefined;
    return p !== 1 && p !== 2;
  };
  const visitee = (x, y) => x === posX && y === posY;

  // Deux plans, comme le DepthManager de la pause : les marqueurs (images
  // > 14) dessous, les passages et hachures (≤ 14) dessus ; la grille est
  // échangée avec le DERNIER marqueur posé, qui passe donc sous les autres.
  const marqueurs = [], chemins = [];
  let dernier = -1;
  const poser = (px, py, frame) => {
    if (!frame) return;
    const g = `<g transform="translate(${px},${py})">${caractereSvg(b, ROOM, frame, ctx)}</g>`;
    if (frame > 14) { marqueurs.push(g); dernier = marqueurs.length - 1; } else chemins.push(g);
  };
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      const room = salleDe(x, y);
      if (!room) continue;
      const px = CARTE_X + PAS_X * x, py = CARTE_Y + PAS_Y * y;
      if (room.type !== 0) {
        let t = 0;
        if (x === posX && y === posY) { poser(px, py, 34); t = 8; }
        const st = t;
        if (pathOpen(x, y, 0) && pathOpen(x - 1, y, 1)) {
          if (x - 1 === posX && y === posY) t = 8;
          else if (t !== 8 && visitee(x - 1, y)) t = 4;
          poser(px, py, 1 + t);
        }
        t = st;
        if (pathOpen(x, y, 2) && pathOpen(x, y - 1, 3)) {
          if (x === posX && y - 1 === posY) t = 8;
          else if (t !== 8 && visitee(x, y - 1)) t = 4;
          poser(px, py, 2 + t);
        }
      }
      switch (room.type) {
        case 0: poser(px, py, 14 + random(4)); break;
        case 1: case 5:
          if (x === d.depart.x && y === d.depart.y) poser(px, py, 26);
          break;
        case 2: poser(px, py, 31); break;
        case 3: if (room.donnee !== -1) poser(px, py, OBJFRAMES[room.donnee]); break;
        case 4: if (room.donnee !== -1) poser(px, py, BONUSFRAMES[room.donnee]); break;
        default: break;
      }
    }
  }

  // Le clip `carte` lui-même : le fond (profondeur 1) et la grille (3, nommée).
  const fond = [], grille = [];
  for (const e of instantane(b.perso[String(CARTE)], 1)) {
    (e.n === 'grille' || grille.length === 0 && fond.length ? grille : fond)
      .push(`<g${matrice(e.m)}>${caractereSvg(b, e.c, 1, ctx)}</g>`);
  }
  // Le cadre : celui du fond du clip (la forme 282 : −13, −38, 440 × 360).
  // Sous le parchemin, la légende des annotations.
  const [bx, by, bl] = [-13, -38, 440];
  const bh = 360 + LEGENDE_H;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${bl}" height="${bh}" viewBox="${bx} ${by} ${bl} ${bh}" font-family="Verdana, Arial, sans-serif">`);
  out.push(`<!-- Motion Ball 2 : la carte du Challenge (graine ${o.graine != null ? o.graine : '?'}), telle que la pause du jeu la montre, annotée -->`);
  out.push(fond.join(''));
  if (dernier >= 0) out.push(marqueurs[dernier]);
  marqueurs.forEach((g, i) => { if (i !== dernier) out.push(g); });
  out.push(grille.join(''));
  out.push(chemins.join(''));
  // Par-dessus tout : les annotations.
  out.push(annotations(d).join('\n'));
  out.push(legende(bx, by + 360, bl).join('\n'));
  out.push('</svg>');
  return out.join('\n');
}

// ── Les annotations : ce que les joueurs dessinaient à la main ────────────
//
// La carte reste celle du jeu ; on pose par-dessus, dans son repère (une
// case = 48 × 36, à 18 + 48x, 16 + 36y), ce que le flux nous apprend :
//
//   · un passage secret : un pointillé sur le mur qu'il traverse ;
//   · une porte : le grelot (♪) qui l'ouvre, posé sur le mur ;
//   · dans chaque salle, une rangée de pastilles : les bumpers ombres
//     (invisibles en jeu), les trous, les blocs verts, l'interrupteur, les
//     mortels quand ils abondent, et la salle « à bumpers » ;
//   · un liseré vert ou violet autour de la salle quand il faut la bille
//     verte, ou l'interrupteur, pour la traverser.
//
// Et une légende sous le parchemin.
const COULEURS = {
  ombre: '#4A4A4A', trou: '#111111', bloc: '#2E8B3A', inter: '#7B1FA2', mortel: '#D32F2F', bumpers: '#3F51B5',
  secret: '#4E2E00', porte: '#5D4037', grelot: '#F9A825', verte: '#1B7A2A', texte: '#5A3A00', legende: '#FFF3C4',
};
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CASE_L = PAS_X, CASE_H = PAS_Y;
const LEGENDE_H = 46;

// Une pastille ronde avec un nombre ou une lettre.
function pastille(x, y, fond, texte, encre) {
  const t = String(texte);
  return `<g><circle cx="${x}" cy="${y}" r="4.6" fill="${fond}" stroke="#fff" stroke-width="0.9"/>`
    + `<text x="${x}" y="${y + 2.1}" text-anchor="middle" font-size="${t.length > 1 ? 5.2 : 6}" font-weight="bold" font-family="Verdana, Arial, sans-serif" fill="${encre || '#fff'}">${esc(t)}</text></g>`;
}
function carre(x, y, fond) {
  return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1" fill="${fond}" stroke="#fff" stroke-width="0.9"/>`;
}
// Le grelot d'une porte, posé sur le mur.
function grelot(x, y) {
  return `<g><circle cx="${x}" cy="${y}" r="5.5" fill="${COULEURS.grelot}" stroke="${COULEURS.porte}" stroke-width="1.4"/>`
    + `<text x="${x}" y="${y + 2.8}" text-anchor="middle" font-size="7.5" font-weight="bold" font-family="Verdana, Arial, sans-serif" fill="#fff">♪</text></g>`;
}

// Les pastilles d'une salle, d'après son analyse : [[fond, texte, forme]].
function pastillesDe(a) {
  const l = [];
  const n = (t) => a.compte[t] || 0;
  if (n(5)) l.push([COULEURS.ombre, n(5), 'rond']);
  if (a.trous) l.push([COULEURS.trou, a.trous, 'rond']);
  if (a.blocs) l.push([COULEURS.bloc, a.blocs, 'carre']);
  if (a.interrupteur || a.blocsBleus || a.blocsRouges) l.push([COULEURS.inter, 'I', 'rond']);
  if (n(3) >= SEUIL_MORTELS) l.push([COULEURS.mortel, n(3), 'rond']);
  if (a.bumpers >= SEUIL_SALLE_A_BUMPERS) l.push([COULEURS.bumpers, a.bumpers, 'rond']);
  return l;
}

function annotations(d) {
  const out = [];
  const coin = (x, y) => [CARTE_X + PAS_X * x, CARTE_Y + PAS_Y * y];
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      const s = salle(d, x, y);
      if (s.type === 0) continue;
      const [px, py] = coin(x, y);
      // Les passages secrets et les portes vers la droite et vers le bas.
      for (const dir of [1, 3]) {
        const p = passage(d, x, y, dir);
        if (!p || p.type < 2) continue;
        const mx = dir === 1 ? px + CASE_L : px + CASE_L / 2;
        const my = dir === 1 ? py + CASE_H / 2 : py + CASE_H;
        if (p.type === 2) {
          const [x1, y1, x2, y2] = dir === 1 ? [mx, my - 9, mx, my + 9] : [mx - 9, my, mx + 9, my];
          out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.8"/>`
            + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COULEURS.secret}" stroke-width="2" stroke-dasharray="2.5 2.5"/>`);
        } else {
          out.push(grelot(mx, my));
        }
      }
      const a = analyserSalle(d, x, y);
      if (!a) continue;
      // Le liseré : ce qu'il faut pour traverser.
      if (a.acces !== 'libre') {
        const coul = a.acces === 'verte' ? COULEURS.verte : a.acces === 'bloquée' ? COULEURS.mortel : COULEURS.inter;
        out.push(`<rect x="${px + 2.5}" y="${py + 2.5}" width="${CASE_L - 5}" height="${CASE_H - 5}" rx="2" fill="none" stroke="${coul}" stroke-width="2.2" stroke-dasharray="4 2"/>`);
      }
      // Les pastilles, en rangée au bas de la case (deux rangées au besoin).
      const l = pastillesDe(a);
      l.forEach(([fond, texte, forme], i) => {
        const cx = px + 8 + (i % 4) * 10.5, cy = py + CASE_H - 8 - Math.floor(i / 4) * 10.5;
        out.push(forme === 'carre' ? carre(cx, cy, fond) + `<text x="${cx}" y="${cy + 2.1}" text-anchor="middle" font-size="${String(texte).length > 1 ? 5.2 : 6}" font-weight="bold" font-family="Verdana, Arial, sans-serif" fill="#fff">${esc(texte)}</text>` : pastille(cx, cy, fond, texte));
      });
    }
  }
  return out;
}

// La légende, sous le parchemin (deux lignes).
function legende(x0, y0, largeur) {
  const out = [`<rect x="${x0}" y="${y0}" width="${largeur}" height="${LEGENDE_H}" fill="${COULEURS.legende}"/>`];
  const lig = (items, y) => items.map(([dessin, texte], i) => `<g transform="translate(${x0 + 10 + i * 88},${y})">${dessin}<text x="9" y="2.6" font-size="7" font-family="Verdana, Arial, sans-serif" fill="${COULEURS.texte}">${esc(texte)}</text></g>`).join('');
  out.push(lig([
    [pastille(0, 0, COULEURS.ombre, 3), 'bumpers ombres'], [pastille(0, 0, COULEURS.trou, 4), 'trous'],
    [carre(0, 0, COULEURS.bloc), 'blocs verts'], [pastille(0, 0, COULEURS.inter, 'I'), 'interrupteur'],
    [pastille(0, 0, COULEURS.mortel, 5), 'mortels (5 et +)'],
  ], y0 + 14));
  out.push(lig([
    [pastille(0, 0, COULEURS.bumpers, 20), 'salle à bumpers'],
    [`<line x1="-4" y1="0" x2="4" y2="0" stroke="${COULEURS.secret}" stroke-width="2" stroke-dasharray="2.5 2.5"/>`, 'passage secret'],
    [grelot(0, 0), 'porte (grelot)'],
    [`<rect x="-5" y="-4" width="10" height="8" fill="none" stroke="${COULEURS.verte}" stroke-width="1.6" stroke-dasharray="3 1.5"/>`, 'bille verte obligatoire'],
    [`<rect x="-5" y="-4" width="10" height="8" fill="none" stroke="${COULEURS.inter}" stroke-width="1.6" stroke-dasharray="3 1.5"/>`, 'interrupteur obligatoire'],
  ], y0 + 32));
  return out;
}

// ── Le message du forum ────────────────────────────────────────────────────
function liste(items, f) { return items.map(f).join(', '); }

/**
 * Le message de VieuxPruneau, en BBCode : le plan, puis ce que le donjon
 * contient, rien de plus. `infos` : { graine, jour, urlImage, changement } —
 * `changement` (facultatif) quand la map a été changée en cours de journée
 * par l'équipe.
 */
function messageForum(d, infos) {
  const o = infos || {};
  const r = decrire(d);
  const l = [];
  if (o.changement) l.push(`[b]Rebelote ![/b] L'équipe vient de changer la map du Challenge en cours de journée. Voici la nouvelle, la seule qui compte désormais.`);
  else l.push(`[b]La map du jour[/b] — Challenge Motion Ball 2 du ${o.jour || 'jour'}.`);
  l.push('');
  if (o.urlImage) {
    l.push(`[img]${o.urlImage}[/img]`);
    l.push(`[i]La carte telle que le jeu la montre en pause (Échap), carte et radar en poche, le joueur au départ — annotée (cliquer pour l'agrandir) : les passages secrets en pointillé, le grelot sur chaque porte, et dans chaque salle ses bumpers ombres, ses trous, ses blocs verts, son interrupteur ; un liseré vert ou violet quand il faut la bille verte ou l'interrupteur pour traverser.[/i]`);
    l.push('');
  }
  l.push(`[b]Le donjon[/b] : ${r.salles} salles sur ${d.largeur} × ${d.hauteur} (${r.vides} cases vides). Colonnes A à H de gauche à droite, lignes 1 à 8 de haut en bas.`);
  l.push(`• [b]Départ[/b] en ${r.depart || '?'}.`);
  l.push(`• [b]Le boss[/b] en ${r.boss || '?'}.`);
  if (r.billes.length) l.push(`• [b]Les billes[/b] : ${liste(r.billes, (b) => `${b.nom} en ${b.case}`)}.`);
  const bonusBilles = r.bonus.filter((b) => b.bonus <= 1);
  const bonusAutres = r.bonus.filter((b) => b.bonus > 1);
  if (bonusBilles.length) l.push(`• [b]Billes bonus[/b] : ${liste(bonusBilles, (b) => `${b.nom} en ${b.case}`)}.`);
  if (bonusAutres.length) l.push(`• [b]Bonus[/b] : ${liste(bonusAutres, (b) => `${b.nom} en ${b.case}`)} (le radar n'est pas marqué sur la carte).`);
  if (r.portes.length) l.push(`• [b]Portes[/b] (un grelot — la cloche — les ouvre) : ${liste(r.portes, (p) => `${p.entre[0]}–${p.entre[1]}`)}.`);
  if (r.invisibles.length) l.push(`• [b]Passages secrets[/b] (absents de la carte du jeu, en pointillé sur la carte) : ${liste(r.invisibles, (p) => `${p.entre[0]}–${p.entre[1]}`)}.`);
  if (r.contenu) {
    l.push('');
    l.push(`[b]Dans les salles[/b]`);
    const obligatoires = r.blocsVerts.filter((b) => b.obligatoire);
    if (obligatoires.length) l.push(`• [b]Blocs verts à casser obligatoirement[/b] (il faut la bille verte pour traverser) : ${liste(obligatoires, (b) => b.case)}.`);
    const autresBlocs = r.blocsVerts.filter((b) => !b.obligatoire);
    if (autresBlocs.length) l.push(`• [b]Blocs verts[/b] (on peut les contourner) : ${liste(autresBlocs, (b) => b.case)}.`);
    const interObl = r.interrupteurs.filter((i) => i.obligatoire);
    if (interObl.length) l.push(`• [b]Interrupteur à frapper pour passer[/b] : ${liste(interObl, (i) => i.case)}.`);
    const interAutres = r.interrupteurs.filter((i) => !i.obligatoire);
    if (interAutres.length) l.push(`• [b]Interrupteurs[/b] : ${liste(interAutres, (i) => i.case)}.`);
    // Les salles à bumpers : toutes en ont ; on ne nomme que les plus garnies,
    // puis celles où les mortels abondent. Le plan montre le reste.
    const pl = (n, un, des) => `${n} ${n > 1 ? des : un}`;
    const speciaux = (c) => [[2, 'à temps', 'à temps'], [3, 'mortel', 'mortels'], [4, 'aimant', 'aimants'], [5, 'ombre', 'ombres']]
      .filter(([t]) => c[t]).map(([t, un, des]) => pl(c[t], un, des)).join(', ');
    const garnies = r.bumpers.filter((b) => b.nombre >= SEUIL_SALLE_A_BUMPERS).sort((a, b) => b.nombre - a.nombre);
    if (garnies.length) l.push(`• [b]Salles à bumpers[/b] (${SEUIL_SALLE_A_BUMPERS} et plus) : ${liste(garnies, (b) => `${b.case} (${b.nombre}${speciaux(b.compte) ? ' dont ' + speciaux(b.compte) : ''})`)}.`);
    const mortelles = r.bumpers.filter((b) => b.nombre < SEUIL_SALLE_A_BUMPERS && (b.compte[3] || 0) >= SEUIL_MORTELS).sort((a, b) => b.compte[3] - a.compte[3]);
    if (mortelles.length) l.push(`• [b]Bumpers mortels en nombre[/b] (${SEUIL_MORTELS} et plus) : ${liste(mortelles, (b) => `${b.case} (${pl(b.compte[3], 'mortel', 'mortels')})`)}.`);
    if (r.trous.length) l.push(`• [b]Trous[/b] : ${liste(r.trous, (t) => `${t.case} (${t.nombre})`)}.`);
    if (r.teleporteurs.length) l.push(`• [b]Téléporteurs[/b] : ${liste(r.teleporteurs, (t) => t.case)}.`);
    if (r.zappers.length) l.push(`• [b]Zappers[/b] : ${liste(r.zappers, (t) => t.case)}.`);
    if (r.bloquees.length) l.push(`• [b]Salles que je ne sais pas traverser[/b] (à vérifier sur place) : ${liste(r.bloquees, (t) => t.case)}.`);
  }
  l.push('');
  l.push(`[i](graine ${o.graine != null ? o.graine : '?'}${MARQUE_VERSION})[/i]`);
  return l.join('\n');
}

// La marque d'idempotence du message (server.js la cherche dans le dernier
// message de VieuxPruneau) : la graine, et la VERSION du plan. Changer de
// version fait reposter la map du jour une fois — c'est ainsi que le plan du
// jeu (v2) a remplacé le plan inventé, puis la carte annotée (v4) le plan
// nu, sans attendre le lendemain.
const MARQUE_VERSION = ' · carte v4';
// Une salle « à bumpers » : à partir de ce nombre. Toutes les salles en ont
// (de cinq à une dizaine) ; celles qu'on nomme en ont vingt et plus — les
// salles spéciales aux vingt aimants ou aux vingt ombres, et les plus
// encombrées. Et l'on nomme à part celles où les mortels abondent.
const SEUIL_SALLE_A_BUMPERS = 20;
const SEUIL_MORTELS = 5;

module.exports = {
  decoderDonjon, lireFichier, decrire, carteSvg, messageForum, passage, nomCase, analyserSalle,
  BILLES, BONUS, TYPES, PASSAGES, OBJETS, COLONNES, MARQUE_VERSION, SEUIL_SALLE_A_BUMPERS, SEUIL_MORTELS,
};
