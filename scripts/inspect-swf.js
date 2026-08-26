#!/usr/bin/env node
// Explore la structure d'un SWF : qui contient quoi, et où.
//
// Troisième outil de la famille, avec extract-swf-shapes.js (formes → SVG) et
// extract-swf-bitmaps.js (images → PNG/SVG). Ceux-là savent SORTIR un élément
// quand on connaît son identifiant ; celui-ci sert à le TROUVER.
//
//   node scripts/inspect-swf.js <fichier.swf> <commande> [args…]
//
//   bandes                    liste les « bandes d'icônes » : les sprites dont
//                             chaque frame pose une forme différente. C'est ainsi
//                             que le SWF range un jeu d'icônes sélectionnable par
//                             gotoAndStop — les icônes des raccourcis, celles des
//                             événements, celles de l'historique.
//   sprite <id…>              déroule la timeline d'un sprite : labels de frame,
//                             placements et retraits, avec profondeurs.
//   labels                    tous les labels de frame du fichier, par sprite.
//                             Un label nomme ce qu'on cherche (« levelUp »,
//                             « nouveauté »…) et donne le numéro de frame.
//   ou <id…>                  où un caractère est-il placé, et dans quel sprite.
//   symboles [motif]          les symboles NOMMÉS du fichier (ExportAssets /
//                             SymbolClass). C'est le chemin le plus court quand
//                             on cherche un élément précis : le nom d'origine
//                             (« fileIconStandard », « picto_mail »…) mène droit
//                             à l'identifiant.
//   chaines <motif>           cherche un motif dans les chaînes du fichier
//                             (noms de classes, clés de traduction, labels).
//   texte [id…]               les CHAMPS DE TEXTE (DefineEditText) : cadre,
//                             police et corps, couleur, alignement, marges,
//                             interligne, nom de variable et texte initial.
//                             C'est ce que déclare l'auteur — la vérité sur la
//                             typo d'un libellé, là où un rendu ne donne que
//                             l'anticrénelage. Sans argument : tous.
//   polices [id…]             les POLICES (DefineFont2/3) : nom, style, et la
//                             table des caractères qu'elles embarquent.
//
// Les identifiants qu'il renvoie s'utilisent tels quels avec les deux
// extracteurs.

const fs = require('fs');
const zlib = require('zlib');

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Signature inconnue : ' + sig);
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
}

const [, , fichier, commande, ...args] = process.argv;
if (!fichier || !commande) {
  console.error('usage : inspect-swf.js <fichier.swf> <bandes|sprite|labels|ou|chaines> [args…]');
  process.exit(1);
}
const b = lireSwf(fichier);
// L'en-tête du corps : RECT de la scène, puis frame rate (2 o) et frame count (2 o).
const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;

// Parcourt les tags en descendant dans les DefineSprite. `visiter` reçoit, pour
// chaque tag, son code, l'offset de son corps, sa longueur, l'identifiant du
// sprite courant (0 = scène principale) et le numéro de frame courant.
function parcourir(visiter) {
  (function scan(from, to, id) {
    let o = from, frame = 1;
    while (o < to) {
      const hdr = b.readUInt16LE(o), code = hdr >> 6;
      let len = hdr & 0x3f, hs = 2;
      if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
      if (code === 0) break;
      const corps = o + hs;
      if (code === 39) scan(corps + 4, corps + len, b.readUInt16LE(corps));
      visiter(code, corps, len, id, frame);
      if (code === 1) frame++;                  // ShowFrame
      o += hs + len;
    }
  })(debut, b.length, 0);
}

// Lecteur de bits, pour les champs du format qui ne sont pas alignés.
class Bits {
  constructor(b, o) { this.b = b; this.o = o; this.bit = 0; }
  u(n) { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((this.b[this.o] >> (7 - this.bit)) & 1); if (++this.bit === 8) { this.bit = 0; this.o++; } } return v >>> 0; }
  s(n) { if (!n) return 0; const v = this.u(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
  align() { if (this.bit) { this.bit = 0; this.o++; } }
}
// MATRIX : échelle, rotation/inclinaison, translation (en twips).
function lireMatrice(o) {
  const m = new Bits(b, o);
  const M = { sx: 1, sy: 1, b: 0, c: 0, tx: 0, ty: 0 };
  if (m.u(1)) { const n = m.u(5); M.sx = m.s(n) / 65536; M.sy = m.s(n) / 65536; }
  if (m.u(1)) { const n = m.u(5); M.b = m.s(n) / 65536; M.c = m.s(n) / 65536; }
  const n = m.u(5); M.tx = m.s(n); M.ty = m.s(n); m.align();
  return M;
}
const matriceTexte = (M) => `matrix(${[M.sx, M.b, M.c, M.sy, M.tx / 20, M.ty / 20]
  .map((v) => Math.round(v * 1e4) / 1e4).join(',')})`;

// PlaceObject 1/2/3 → { caractere, profondeur, matrice } (caractere = -1 si le
// tag ne fait que modifier un objet déjà en place).
function placement(code, corps) {
  if (code === 4) {
    return { ch: b.readUInt16LE(corps), depth: b.readUInt16LE(corps + 2), M: lireMatrice(corps + 4) };
  }
  if (code === 26 || code === 70) {
    const flags = b[corps], depth = b.readUInt16LE(corps + 1);
    let o = corps + 3;
    if (code === 70) o += 0;                        // PlaceObject3 : drapeaux étendus déjà lus
    const aChar = !!(flags & 2);
    if (aChar) o += 2;
    const M = (flags & 4) ? lireMatrice(o) : null;  // HasMatrix
    return { ch: aChar ? b.readUInt16LE(corps + 3) : -1, depth, bouge: !!(flags & 1), M };
  }
  return null;
}

if (commande === 'bandes') {
  const parSprite = new Map();
  const frames = new Map();
  parcourir((code, corps, len, id, frame) => {
    frames.set(id, frame);
    const p = placement(code, corps);
    if (p && p.ch >= 0) {
      if (!parSprite.has(id)) parSprite.set(id, new Set());
      parSprite.get(id).add(p.ch);
    }
  });
  for (const [id, chars] of parSprite) {
    if (chars.size < 5 || (frames.get(id) || 0) < 5) continue;
    console.log(`sprite#${id}\t${frames.get(id)} frames\t${chars.size} formes : ${[...chars].join(' ')}`);
  }

} else if (commande === 'sprite') {
  const veut = new Set(args.map(Number));
  parcourir((code, corps, len, id, frame) => {
    if (!veut.has(id)) return;
    if (code === 43) console.log(`f${frame}\tLABEL "${b.slice(corps, corps + len).toString('utf8').replace(/\0/g, '')}"`);
    const p = placement(code, corps);
    if (p) console.log(`f${frame}\tplace\tdepth ${p.depth}\t${p.ch >= 0 ? '#' + p.ch : '(modif)'}`
      + `${p.bouge ? ' [move]' : ''}${p.M ? '\t' + matriceTexte(p.M) : ''}`);
    if (code === 5) console.log(`f${frame}\tretire\tdepth ${b.readUInt16LE(corps + 2)}\t#${b.readUInt16LE(corps)}`);
    if (code === 28) console.log(`f${frame}\tretire\tdepth ${b.readUInt16LE(corps)}`);
  });

} else if (commande === 'labels') {
  const parSprite = new Map();
  parcourir((code, corps, len, id, frame) => {
    if (code !== 43) return;
    if (!parSprite.has(id)) parSprite.set(id, []);
    parSprite.get(id).push(`f${frame}=${b.slice(corps, corps + len).toString('utf8').replace(/\0/g, '')}`);
  });
  for (const [id, l] of parSprite) console.log(`sprite#${id}\t${l.join('  ')}`);

} else if (commande === 'ou') {
  const veut = new Set(args.map(Number));
  parcourir((code, corps, len, id, frame) => {
    const p = placement(code, corps);
    if (p && veut.has(p.ch)) console.log(`#${p.ch}\tdans sprite#${id}\tframe ${frame}\tdepth ${p.depth}`);
  });

} else if (commande === 'symboles') {
  // ExportAssets (56) et SymbolClass (76) associent un NOM d'auteur à un
  // caractère. C'est le chemin le plus court vers un élément précis : le SWF
  // garde les noms de la bibliothèque Flash d'origine.
  const motif = args[0] ? new RegExp(args[0], 'i') : null;
  parcourir((code, corps, len) => {
    if (code !== 56 && code !== 76) return;
    let p = corps;
    const n = b.readUInt16LE(p); p += 2;
    for (let i = 0; i < n; i++) {
      const id = b.readUInt16LE(p); p += 2;
      let e = p; while (e < corps + len && b[e] !== 0) e++;
      const nom = b.slice(p, e).toString('utf8');
      p = e + 1;
      if (!motif || motif.test(nom)) console.log(`#${id}\t${nom}`);
    }
  });

} else if (commande === 'chaines') {
  // Les chaînes utiles (noms de classes, clés de traduction, labels) vivent dans
  // les pools de constantes, séparées par des octets nuls.
  const s = b.toString('latin1');
  const motif = new RegExp(args[0] || '.', 'gi');
  const vus = new Set();
  let m;
  while ((m = motif.exec(s)) !== null && vus.size < 80) {
    let d = m.index; while (d > 0 && s.charCodeAt(d - 1) >= 32 && d > m.index - 70) d--;
    let f = m.index; while (f < s.length && s.charCodeAt(f) >= 32 && f < m.index + 70) f++;
    const t = s.slice(d, f);
    if (!vus.has(t)) { vus.add(t); console.log(m.index + '\t' + JSON.stringify(t)); }
  }

} else if (commande === 'texte' || commande === 'polices') {
  // Le nom d'une police, tel que DefineFont2/3 le déclare — c'est lui qu'un
  // champ de texte désigne par son identifiant.
  const nomsPolice = new Map();
  parcourir((code, corps, len) => {
    if (code !== 48 && code !== 75) return;           // DefineFont2 / DefineFont3
    const id = b.readUInt16LE(corps);
    const drapeaux = b[corps + 2];
    const nl = b[corps + 4];
    nomsPolice.set(id, {
      nom: b.slice(corps + 5, corps + 5 + nl).toString('utf8').replace(/\0/g, ''),
      gras: !!(drapeaux & 1), italique: !!(drapeaux & 2),
      // DefineFont3 range ses coordonnées au 1/20 d'EM : les hauteurs d'un
      // champ qui l'emploie restent en twips, mais les glyphes sont 20× plus
      // fins — c'est ce qui distingue une police « pixel » d'une vectorielle.
      tag: code === 75 ? 'DefineFont3' : 'DefineFont2',
    });
  });
  if (commande === 'polices') {
    const veut = new Set(args.map(Number));
    for (const [id, f] of nomsPolice) {
      if (veut.size && !veut.has(id)) continue;
      console.log(`#${id}\t${f.nom}${f.gras ? ' gras' : ''}${f.italique ? ' italique' : ''}\t${f.tag}`);
    }
  } else {
    const veut = new Set(args.map(Number));
    parcourir((code, corps, len, sprite) => {
      if (code !== 37) return;                        // DefineEditText
      const id = b.readUInt16LE(corps);
      if (veut.size && !veut.has(id)) return;
      // RECT (cadre), puis deux octets de drapeaux, puis les champs optionnels
      // dans l'ordre du format.
      const r = new Bits(b, corps + 2);
      const n = r.u(5);
      const cadre = { x0: r.s(n) / 20, x1: r.s(n) / 20, y0: r.s(n) / 20, y1: r.s(n) / 20 };
      r.align();
      let o = r.o;
      const f1 = b[o], f2 = b[o + 1]; o += 2;
      const aTexte = !!(f1 & 0x80), aMax = !!(f1 & 0x20), aCouleur = !!(f1 & 0x04),
        aPolice = !!(f1 & 0x01), aClasse = !!(f1 & 0x02), aMise = !!(f2 & 0x20);
      const info = [];
      if (aPolice) {
        const fid = b.readUInt16LE(o); o += 2;
        const h = b.readUInt16LE(o); o += 2;
        const f = nomsPolice.get(fid);
        info.push(`police #${fid}${f ? ' « ' + f.nom + ' »' + (f.gras ? ' gras' : '') : ''} ${h / 20} px`);
      } else if (aClasse) {
        let e = o; while (b[e] !== 0) e++;
        info.push(`classe « ${b.slice(o, e).toString('utf8')} »`);
        o = e + 1;
        const h = b.readUInt16LE(o); o += 2;
        info.push(`${h / 20} px`);
      }
      if (aCouleur) {
        const c = '#' + [b[o], b[o + 1], b[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        const a = b[o + 3]; o += 4;
        info.push('encre ' + c + (a < 255 ? ' α' + a : ''));
      }
      if (aMax) { info.push('maxlen ' + b.readUInt16LE(o)); o += 2; }
      if (aMise) {
        const ALIGN = ['gauche', 'droite', 'centre', 'justifié'];
        info.push('align ' + (ALIGN[b[o]] || b[o])
          + ` marges ${b.readUInt16LE(o + 1) / 20}/${b.readUInt16LE(o + 3) / 20}`
          + ` retrait ${b.readUInt16LE(o + 5) / 20} interligne ${b.readInt16LE(o + 7) / 20}`);
        o += 9;
      }
      let e = o; while (b[e] !== 0) e++;
      const variable = b.slice(o, e).toString('utf8');
      o = e + 1;
      let initial = '';
      if (aTexte) { let e2 = o; while (b[e2] !== 0) e2++; initial = b.slice(o, e2).toString('utf8'); }
      const dr = [];
      if (f1 & 0x40) dr.push('wordwrap'); if (f1 & 0x20 && false) dr.push('');
      if (f1 & 0x10) dr.push('multiline'); if (f1 & 0x08) dr.push('password');
      if (f1 & 0x02 && !aPolice) dr.push('fontclass');
      if (f2 & 0x80) dr.push('lecture-seule'); if (f2 & 0x40) dr.push('bordure');
      if (f2 & 0x10) dr.push('sélectionnable-non'); if (f2 & 0x08) dr.push('html');
      if (f2 & 0x04) dr.push('police-embarquée'); if (f1 & 0x01 && (f2 & 0x02)) dr.push('auto-size');
      console.log(`#${id}\tdans sprite#${sprite}\tcadre ${cadre.x0},${cadre.y0} `
        + `${Math.round((cadre.x1 - cadre.x0) * 100) / 100}×${Math.round((cadre.y1 - cadre.y0) * 100) / 100}`
        + `\t${info.join(' · ')}`
        + (variable ? `\tvar « ${variable} »` : '')
        + (initial ? `\ttexte « ${initial} »` : '')
        + (dr.length ? `\t[${dr.join(' ')}]` : ''));
    });
  }

} else {
  console.error('commande inconnue : ' + commande);
  process.exit(1);
}
