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

// PlaceObject 1/2/3 → { caractere, profondeur } (caractere = -1 si le tag ne fait
// que modifier un objet déjà en place).
function placement(code, corps) {
  if (code === 4) return { ch: b.readUInt16LE(corps), depth: b.readUInt16LE(corps + 2) };
  if (code === 26 || code === 70) {
    const flags = b[corps], depth = b.readUInt16LE(corps + 1);
    return { ch: (flags & 2) ? b.readUInt16LE(corps + 3) : -1, depth, bouge: !!(flags & 1) };
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
    if (p) console.log(`f${frame}\tplace\tdepth ${p.depth}\t${p.ch >= 0 ? '#' + p.ch : '(modif)'}${p.bouge ? ' [move]' : ''}`);
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

} else {
  console.error('commande inconnue : ' + commande);
  process.exit(1);
}
