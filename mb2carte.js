//
// La CARTE DU JOUR de Motion Ball 2 — lue, dessinée, racontée.
//
// Chaque nuit, mb2gen.js tire le donjon du Challenge (mb2data.dat). Ce
// module le RELIT — le même flux binaire que motionball.swf, dans l'alphabet
// du SWF — et en tire trois choses pour le forum :
//
//   · le DONJON décodé : huit salles sur huit, chacune avec son type (rien,
//     salle ordinaire, boss, bille à trouver, bonus) et ses quatre passages
//     (ouvert, fermé, invisible, porte) ;
//   · le PLAN : LA CARTE DU JEU, telle que la pause la montre quand on a la
//     carte et le radar en poche (Pause.show_map de public/mb2/jeu/ecrans.js)
//     — les mêmes clips (`carte`, `room`), lus dans public/mb2/data/mb2.json
//     et rejoués en SVG, image par image, aux mêmes places ; rien n'y est
//     dessiné qui ne soit dans le jeu ;
//   · le MESSAGE du forum, en BBCode : le plan, puis le détail — où l'on
//     part, où est le boss, où trouver chaque bille et chaque bonus, les
//     portes, les passages invisibles.
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

/** Ce que la carte raconte, rangé : départ, boss, billes, bonus, portes… */
function decrire(d) {
  const r = { depart: null, boss: null, billes: [], bonus: [], portes: [], invisibles: [], salles: 0, vides: 0 };
  for (let x = 0; x < d.largeur; x++) {
    for (let y = 0; y < d.hauteur; y++) {
      const s = d.salles[x][y];
      const c = nomCase(x, y);
      if (s.type === 0) { r.vides++; continue; }
      r.salles++;
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
  const [bx, by, bl, bh] = [-13, -38, 440, 360];
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${bl}" height="${bh}" viewBox="${bx} ${by} ${bl} ${bh}">`);
  out.push(`<!-- Motion Ball 2 : la carte du Challenge (graine ${o.graine != null ? o.graine : '?'}), telle que la pause du jeu la montre -->`);
  out.push(fond.join(''));
  if (dernier >= 0) out.push(marqueurs[dernier]);
  marqueurs.forEach((g, i) => { if (i !== dernier) out.push(g); });
  out.push(grille.join(''));
  out.push(chemins.join(''));
  out.push('</svg>');
  return out.join('\n');
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
    l.push(`[i]La carte telle que le jeu la montre en pause (Échap), carte et radar en poche — le joueur au départ.[/i]`);
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
  if (r.portes.length) l.push(`• [b]Portes[/b] (un grelot les ouvre) : ${liste(r.portes, (p) => `${p.entre[0]}–${p.entre[1]}`)}.`);
  if (r.invisibles.length) l.push(`• [b]Passages invisibles[/b] (absents de la carte) : ${liste(r.invisibles, (p) => `${p.entre[0]}–${p.entre[1]}`)}.`);
  l.push('');
  l.push(`[i](graine ${o.graine != null ? o.graine : '?'}${MARQUE_VERSION})[/i]`);
  return l.join('\n');
}

// La marque d'idempotence du message (server.js la cherche dans le dernier
// message de VieuxPruneau) : la graine, et la VERSION du plan. Changer de
// version fait reposter la map du jour une fois — c'est ainsi que le plan du
// jeu (v2) a remplacé le plan inventé sans attendre le lendemain.
const MARQUE_VERSION = ' · carte v2';

module.exports = {
  decoderDonjon, lireFichier, decrire, carteSvg, messageForum, passage, nomCase,
  BILLES, BONUS, TYPES, PASSAGES, COLONNES, MARQUE_VERSION,
};
