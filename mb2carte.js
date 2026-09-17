//
// La CARTE DU JOUR de Motion Ball 2 — lue, dessinée, racontée.
//
// Chaque nuit, mb2gen.js tire le donjon du Challenge (mb2data.dat). Ce
// module le RELIT — le même flux binaire que motionball.swf, dans l'alphabet
// du SWF — et en tire trois choses pour le forum :
//
//   · le DONJON décodé : huit salles sur huit, chacune avec son type (rien,
//     salle ordinaire, départ, boss, bille à trouver, bonus, salle qui
//     réclame une bille) et ses quatre passages (ouvert, fermé, invisible,
//     porte qui réclame une bille) ;
//   · un PLAN en SVG, tout en formes — pas une image externe : un SVG posé
//     dans une balise <img> ne charge rien d'autre que lui-même ;
//   · le MESSAGE du forum, en BBCode : le plan, puis le détail — où l'on
//     part, où dort le boss, où trouver chaque bille et chaque bonus, quelles
//     portes réclament quoi, les passages invisibles.
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
const BILLES = ['verte', 'bleue', 'métal', 'violette'];
const BILLES_COULEUR = ['#39c23f', '#3f8cf0', '#b9bec6', '#a555e0'];
const BONUS = ['bille orange', 'bille rouge', 'carte', 'radar', 'grelot', 'petit temps', 'grand temps'];
const BONUS_COURT = ['orange', 'rouge', 'carte', 'radar', 'grelot', '+temps', '++temps'];
const BONUS_COULEUR = ['#ff8a1f', '#e8262f', '#f4e04d', '#5fd7d3', '#e4c33a', '#8fd67a', '#4fb84a'];
const TYPES = ['vide', 'normale', 'boss', 'bille', 'bonus', 'réclame'];
const PASSAGES = ['ouvert', 'fermé', 'invisible', 'porte'];
const COLONNES = 'ABCDEFGH';

function nomCase(x, y) { return COLONNES[x] + (y + 1); }

// ── Le décodage ────────────────────────────────────────────────────────────
/**
 * Lit `ddata` (le champ de mb2data.dat) et rend le donjon :
 * { largeur, hauteur, depart:{x,y}, salles[x][y] } où une salle vaut
 * { type: 0..5, donnee, passages:[{type, bille}] × 4 (gauche, droite, haut, bas) }
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
          const p = { type: bc.read(2), bille: -1 };
          if (p.type === 3) p.bille = bc.read(2);
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
// une porte ou un passage invisible d'un côté suffit à le qualifier.
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
  if (pa.type === 2 || pb.type === 2) return { type: 2, bille: -1 };
  return { type: 0, bille: -1 };
}

/** Ce que la carte raconte, rangé : départ, boss, billes, bonus, portes… */
function decrire(d) {
  const r = { depart: null, boss: null, billes: [], bonus: [], reclament: [], portes: [], invisibles: [], salles: 0, vides: 0 };
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
      else if (s.type === 5) r.reclament.push({ bille: s.donnee, nom: BILLES[s.donnee], case: c });
      // Les portes et les passages invisibles, une fois chacun (vers la
      // droite et vers le bas).
      for (const dir of [1, 3]) {
        const p = passage(d, x, y, dir);
        if (!p) continue;
        const voisin = nomCase(x + (dir === 1 ? 1 : 0), y + (dir === 3 ? 1 : 0));
        if (p.type === 3) r.portes.push({ bille: p.bille, nom: BILLES[p.bille], entre: [c, voisin] });
        else if (p.type === 2) r.invisibles.push({ entre: [c, voisin] });
      }
    }
  }
  const ordre = (a, b) => a.case.localeCompare(b.case);
  r.billes.sort((a, b) => a.bille - b.bille);
  r.bonus.sort((a, b) => (a.bonus - b.bonus) || ordre(a, b));
  r.reclament.sort(ordre);
  return r;
}

// ── Le plan, en SVG ────────────────────────────────────────────────────────
const CASE = 56, MARGE = 30, ENTETE = 34, LEGENDE = 62;

function svgEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Le glyphe d'une salle, centré en (0, 0), dans une case de CASE px. */
function glyphe(s, estDepart) {
  const out = [];
  const cercle = (fill, r, stroke) => `<circle r="${r}" fill="${fill}" stroke="${stroke || '#1c3a08'}" stroke-width="2"/>`;
  if (estDepart) {
    out.push('<circle r="13" fill="#ffd93b" stroke="#1c3a08" stroke-width="2"/>');
    out.push('<text y="4.5" font-size="11" font-weight="bold" text-anchor="middle" fill="#1c3a08">GO</text>');
    return out.join('');
  }
  switch (s.type) {
    case 2:   // le boss : un crâne stylisé sur fond sombre
      out.push('<circle r="15" fill="#3a2432" stroke="#1c3a08" stroke-width="2"/>');
      out.push('<circle r="8.5" cy="-2" fill="#f5f1e6"/>');
      out.push('<rect x="-5" y="4" width="10" height="6" rx="1.5" fill="#f5f1e6"/>');
      out.push('<circle cx="-3.4" cy="-2.8" r="2.3" fill="#3a2432"/><circle cx="3.4" cy="-2.8" r="2.3" fill="#3a2432"/>');
      out.push('<rect x="-2.6" y="5.5" width="1.3" height="3.5" fill="#3a2432"/><rect x="1.3" y="5.5" width="1.3" height="3.5" fill="#3a2432"/>');
      break;
    case 3:   // une bille à trouver
      out.push(cercle(BILLES_COULEUR[s.donnee] || '#ccc', 11));
      out.push('<circle cx="-3.5" cy="-4" r="3" fill="#ffffff" opacity=".75"/>');
      break;
    case 4: { // un bonus
      const b = s.donnee;
      const fill = BONUS_COULEUR[b] || '#ccc';
      if (b === 0 || b === 1) {
        out.push(cercle(fill, 11));
        out.push('<circle cx="-3.5" cy="-4" r="3" fill="#ffffff" opacity=".75"/>');
      } else if (b === 2) {          // la carte : un parchemin
        out.push(`<rect x="-11" y="-8" width="22" height="16" rx="2" fill="${fill}" stroke="#1c3a08" stroke-width="2"/>`);
        out.push('<path d="M-6 -3 L-1 3 L3 -2 L7 4" fill="none" stroke="#1c3a08" stroke-width="1.6"/>');
      } else if (b === 3) {          // le radar : des ondes
        out.push(`<circle r="12" fill="${fill}" stroke="#1c3a08" stroke-width="2"/>`);
        out.push('<circle r="2.5" fill="#1c3a08"/><circle r="6.5" fill="none" stroke="#1c3a08" stroke-width="1.5"/>');
      } else if (b === 4) {          // le grelot : la clé des portes
        out.push(`<circle r="12" fill="${fill}" stroke="#1c3a08" stroke-width="2"/>`);
        out.push('<circle cy="-2" r="6" fill="none" stroke="#1c3a08" stroke-width="2"/><rect x="-1" y="3" width="2" height="6" fill="#1c3a08"/>');
      } else {                        // les temps : un cadran
        out.push(`<circle r="12" fill="${fill}" stroke="#1c3a08" stroke-width="2"/>`);
        out.push('<path d="M0 -6 V0 H4" fill="none" stroke="#1c3a08" stroke-width="2" stroke-linecap="round"/>');
        if (b === 6) out.push('<text x="0" y="-13" font-size="9" font-weight="bold" text-anchor="middle" fill="#1c3a08">+</text>');
      }
      break;
    }
    case 5:   // une salle qui réclame une bille : un cadenas de sa couleur
      out.push(`<rect x="-8" y="-3" width="16" height="12" rx="2" fill="${BILLES_COULEUR[s.donnee] || '#ccc'}" stroke="#1c3a08" stroke-width="2"/>`);
      out.push('<path d="M-5 -3 V-7 A5 5 0 0 1 5 -7 V-3" fill="none" stroke="#1c3a08" stroke-width="2"/>');
      break;
    default:
      break;
  }
  return out.join('');
}

/**
 * Le plan du donjon. `infos` : { graine, jour } pour le cartouche.
 */
function carteSvg(d, infos) {
  const o = infos || {};
  const W = MARGE * 2 + CASE * d.largeur, H = ENTETE + MARGE * 2 + CASE * d.hauteur + LEGENDE;
  const gx = (x) => MARGE + x * CASE, gy = (y) => ENTETE + MARGE + y * CASE;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Verdana, Arial, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" rx="14" fill="#ade76b"/>`);
  out.push(`<rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="10" fill="#5c9a18"/>`);
  out.push(`<text x="${W / 2}" y="26" font-size="15" font-weight="bold" text-anchor="middle" fill="#ffffff">Motion Ball 2 — Challenge du ${svgEsc(o.jour || '')}</text>`);
  // Les repères.
  for (let x = 0; x < d.largeur; x++) {
    out.push(`<text x="${gx(x) + CASE / 2}" y="${gy(0) - 8}" font-size="11" font-weight="bold" text-anchor="middle" fill="#e6ffc7">${COLONNES[x]}</text>`);
  }
  for (let y = 0; y < d.hauteur; y++) {
    out.push(`<text x="${gx(0) - 10}" y="${gy(y) + CASE / 2 + 4}" font-size="11" font-weight="bold" text-anchor="middle" fill="#e6ffc7">${y + 1}</text>`);
  }
  // Les salles.
  for (let x = 0; x < d.largeur; x++) {
    for (let y = 0; y < d.hauteur; y++) {
      const s = d.salles[x][y];
      if (s.type === 0) {
        out.push(`<rect x="${gx(x) + 3}" y="${gy(y) + 3}" width="${CASE - 6}" height="${CASE - 6}" rx="6" fill="#4b7f14" opacity=".55"/>`);
        continue;
      }
      out.push(`<rect x="${gx(x) + 3}" y="${gy(y) + 3}" width="${CASE - 6}" height="${CASE - 6}" rx="6" fill="#d9f2b4" stroke="#1c3a08" stroke-width="2"/>`);
    }
  }
  // Les passages (par-dessus les salles, sous les glyphes).
  for (let x = 0; x < d.largeur; x++) {
    for (let y = 0; y < d.hauteur; y++) {
      for (const dir of [1, 3]) {
        const p = passage(d, x, y, dir);
        if (!p) continue;
        const cx = gx(x) + CASE / 2, cy = gy(y) + CASE / 2;
        const ex = dir === 1 ? cx + CASE : cx, ey = dir === 3 ? cy + CASE : cy;
        if (p.type === 0) {
          out.push(`<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#1c3a08" stroke-width="8" stroke-linecap="round"/>`);
          out.push(`<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#d9f2b4" stroke-width="4" stroke-linecap="round"/>`);
        } else if (p.type === 2) {
          out.push(`<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#1c3a08" stroke-width="4" stroke-dasharray="3 5" stroke-linecap="round" opacity=".7"/>`);
        } else {
          out.push(`<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="#1c3a08" stroke-width="8" stroke-linecap="round"/>`);
          out.push(`<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="${BILLES_COULEUR[p.bille] || '#ccc'}" stroke-width="4" stroke-linecap="round"/>`);
          const mx = (cx + ex) / 2, my = (cy + ey) / 2;
          out.push(`<rect x="${mx - 5}" y="${my - 5}" width="10" height="10" rx="2" fill="${BILLES_COULEUR[p.bille] || '#ccc'}" stroke="#1c3a08" stroke-width="1.5"/>`);
        }
      }
    }
  }
  // Les glyphes.
  for (let x = 0; x < d.largeur; x++) {
    for (let y = 0; y < d.hauteur; y++) {
      const s = d.salles[x][y];
      if (s.type === 0) continue;
      const g = glyphe(s, x === d.depart.x && y === d.depart.y);
      if (g) out.push(`<g transform="translate(${gx(x) + CASE / 2},${gy(y) + CASE / 2})">${g}</g>`);
    }
  }
  // La légende.
  const ly = gy(d.hauteur) + 18;
  const legende = [
    ['<circle r="7" fill="#ffd93b" stroke="#1c3a08" stroke-width="1.5"/>', 'départ'],
    ['<circle r="7" fill="#3a2432" stroke="#1c3a08" stroke-width="1.5"/><circle r="3.5" cy="-1" fill="#f5f1e6"/>', 'boss'],
    ['<circle r="7" fill="#39c23f" stroke="#1c3a08" stroke-width="1.5"/>', 'bille'],
    ['<rect x="-6" y="-5" width="12" height="10" rx="1.5" fill="#f4e04d" stroke="#1c3a08" stroke-width="1.5"/>', 'bonus'],
    ['<rect x="-5" y="-2" width="10" height="7" rx="1" fill="#3f8cf0" stroke="#1c3a08" stroke-width="1.5"/><path d="M-3 -2 V-4 A3 3 0 0 1 3 -4 V-2" fill="none" stroke="#1c3a08" stroke-width="1.5"/>', 'réclame une bille'],
    ['<line x1="-8" y1="0" x2="8" y2="0" stroke="#1c3a08" stroke-width="3" stroke-dasharray="2 3"/>', 'passage invisible'],
    ['<line x1="-8" y1="0" x2="8" y2="0" stroke="#3f8cf0" stroke-width="4"/><rect x="-3" y="-3" width="6" height="6" fill="#3f8cf0" stroke="#1c3a08"/>', 'porte'],
  ];
  // Sur deux rangées : la première ne tient pas sur la largeur du plan.
  let lx = MARGE + 6, ligne = 0;
  legende.forEach(([g, t], i) => {
    if (i === 4) { lx = MARGE + 6; ligne = 1; }
    const y = ly + ligne * 18;
    out.push(`<g transform="translate(${lx},${y})">${g}</g>`);
    out.push(`<text x="${lx + 12}" y="${y + 4}" font-size="10" fill="#ffffff">${t}</text>`);
    lx += 26 + t.length * 6.2;
  });
  if (o.graine != null) {
    out.push(`<text x="${W - 14}" y="${H - 12}" font-size="9" text-anchor="end" fill="#e6ffc7">graine ${svgEsc(o.graine)}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

// ── Le message du forum ────────────────────────────────────────────────────
function liste(items, f) { return items.map(f).join(', '); }

/**
 * Le message de VieuxPruneau, en BBCode. `infos` : { graine, jour, urlImage,
 * changement } — `changement` (facultatif) quand la map a été changée en
 * cours de journée par l'équipe.
 */
function messageForum(d, infos) {
  const o = infos || {};
  const r = decrire(d);
  const l = [];
  if (o.changement) l.push(`[b]Rebelote ![/b] L'équipe vient de changer la map du Challenge en cours de journée. Voici la nouvelle, la seule qui compte désormais.`);
  else l.push(`[b]La map du jour[/b] — Challenge Motion Ball 2 du ${o.jour || 'jour'}. Nouvelle nuit, nouveau donjon : le voilà, relevé à la lampe torche.`);
  l.push('');
  if (o.urlImage) { l.push(`[img]${o.urlImage}[/img]`); l.push(''); }
  l.push(`[b]Le donjon[/b] : ${r.salles} salles sur ${d.largeur} × ${d.hauteur} (${r.vides} cases vides). Colonnes A à H de gauche à droite, lignes 1 à 8 de haut en bas.`);
  l.push(`• [b]Départ[/b] en ${r.depart || '?'}.`);
  l.push(`• [b]Le boss[/b] dort en ${r.boss || '?'}.`);
  if (r.billes.length) l.push(`• [b]Les billes[/b] : ${liste(r.billes, (b) => `${b.nom} en ${b.case}`)}.`);
  const bonusBilles = r.bonus.filter((b) => b.bonus <= 1);
  const bonusAutres = r.bonus.filter((b) => b.bonus > 1);
  if (bonusBilles.length) l.push(`• [b]Billes bonus[/b] : ${liste(bonusBilles, (b) => `${b.nom} en ${b.case}`)}.`);
  if (bonusAutres.length) l.push(`• [b]Bonus[/b] : ${liste(bonusAutres, (b) => `${b.nom} en ${b.case}`)}.`);
  if (r.reclament.length) l.push(`• [b]Salles qui réclament une bille[/b] : ${liste(r.reclament, (s) => `${s.case} (bille ${s.nom})`)}.`);
  if (r.portes.length) l.push(`• [b]Portes[/b] : ${liste(r.portes, (p) => `${p.entre[0]}–${p.entre[1]} (bille ${p.nom})`)}.`);
  if (r.invisibles.length) l.push(`• [b]Passages invisibles[/b] : ${liste(r.invisibles, (p) => `${p.entre[0]}–${p.entre[1]}`)}.`);
  l.push('');
  l.push(`Bonne chasse, et méfiez-vous des bumpers de la mort. [i](graine ${o.graine != null ? o.graine : '?'})[/i]`);
  return l.join('\n');
}

module.exports = {
  decoderDonjon, lireFichier, decrire, carteSvg, messageForum, passage, nomCase,
  BILLES, BONUS, BONUS_COURT, TYPES, PASSAGES, COLONNES,
};
