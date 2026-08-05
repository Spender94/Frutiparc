#!/usr/bin/env node
/*
 * Sortir une POLICE EMBARQUÉE d'un SWF, et la rendre au navigateur en WOFF.
 *
 *   node scripts/extract-swf-font.js <fichier.swf> <fontId> <sortie.woff> [Famille]
 *
 * Les jeux de Motion-Twin embarquent leurs fontes : le SWF ne dit pas « écris
 * ça en Atlantis », il PORTE les contours de chaque lettre. Le portage n'avait
 * pas de quoi les afficher et se rabattait sur Verdana — d'où des libellés qui
 * ne ressemblaient pas à ceux dont les joueurs se souviennent.
 *
 * La conversion est exacte, et ce n'est pas de la chance : un glyphe SWF est
 * une suite de courbes de Bézier QUADRATIQUES, ce qui est précisément le format
 * de la table `glyf` de TrueType. Il n'y a donc rien à approcher — seulement
 * deux différences de convention à corriger :
 *
 *   — l'axe Y descend dans Flash et monte dans TrueType : on le nie ;
 *   — l'unité est le 1/1024 d'em dans les deux cas : on la garde telle quelle.
 *
 * Le WOFF n'est qu'un TTF dont chaque table est compressée (zlib) et précédée
 * d'un en-tête `wOFF` ; on l'écrit ici plutôt que le TTF parce que c'est le seul
 * format que tous les navigateurs acceptent sans discuter.
 *
 * À savoir avant de s'en servir : ces fontes de 2005 n'ont PAS de glyphes
 * accentués. Ce n'est pas un oubli de l'extraction, c'est la fonte elle-même —
 * et c'est pour cette raison que le jeu d'origine écrit « Foret enchantee ».
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');

// ── Lire le SWF ──────────────────────────────────────────────────────────────

function lireSwf(chemin) {
  const buf = fs.readFileSync(chemin);
  const sig = buf.toString('latin1', 0, 3);
  if (sig === 'CWS') return zlib.inflateSync(buf.slice(8));
  if (sig === 'FWS') return buf.slice(8);
  throw new Error('signature inconnue : ' + sig);
}

// Un lecteur qui sait compter en BITS — les tailles de champ du format sont
// variables, et tout se décale d'un cran si l'on oublie de se réaligner.
class Lecteur {
  constructor(b, p = 0) { this.b = b; this.p = p; this.bit = 0; }
  aligner() { if (this.bit !== 0) { this.bit = 0; this.p++; } }
  u8() { this.aligner(); return this.b[this.p++]; }
  u16() { this.aligner(); const v = this.b.readUInt16LE(this.p); this.p += 2; return v; }
  i16() { this.aligner(); const v = this.b.readInt16LE(this.p); this.p += 2; return v; }
  u32() { this.aligner(); const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  ub(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((this.b[this.p] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.p++; }
    }
    return v >>> 0;
  }
  sb(n) { if (!n) return 0; const v = this.ub(n); const s = 1 << (n - 1); return (v & s) ? v - (1 << n) : v; }
  rect() { this.aligner(); const nb = this.ub(5); this.ub(nb); this.ub(nb); this.ub(nb); this.ub(nb); this.aligner(); }
}

// La marche des tags, en descendant dans les sprites (un DefineSprite contient
// ses propres tags).
function tags(corps) {
  const r = new Lecteur(corps);
  r.rect(); r.u16(); r.u16();
  const liste = [];
  (function marcher(lect, fin) {
    while (lect.p < fin - 1) {
      const hdr = lect.u16();
      const code = hdr >> 6;
      let len = hdr & 0x3f;
      if (len === 0x3f) len = lect.u32();
      const debut = lect.p;
      liste.push({ code, debut, fin: debut + len });
      if (code === 39) {                       // DefineSprite
        const sr = new Lecteur(corps, debut);
        sr.u16(); sr.u16();
        marcher(sr, debut + len);
      }
      lect.p = debut + len;
      if (code === 0) break;
    }
  })(r, corps.length);
  return liste;
}

// DefineFont2 (48) et DefineFont3 (75) : le nom, la table des codes, les
// décalages de chaque glyphe, et — si `hasLayout` — les chasses et les métriques.
function lireFonte(corps, t) {
  const r = new Lecteur(corps, t.debut);
  const id = r.u16();
  const drapeaux = r.u8();
  const f = {
    id,
    largesDecalages: !!(drapeaux & 0x08),
    largesCodes: !!(drapeaux & 0x04),
    aMetriques: !!(drapeaux & 0x80),
  };
  r.u8();                                        // langCode
  const lg = r.u8();
  f.nom = corps.toString('latin1', r.p, r.p + lg).replace(/\0+$/, '');
  r.p += lg;
  f.nombre = r.u16();
  const base = r.p;
  f.codes = [];
  if (f.nombre === 0) return f;
  const large = f.largesDecalages ? 4 : 2;
  const lire = (i) => (f.largesDecalages
    ? corps.readUInt32LE(base + i * large) : corps.readUInt16LE(base + i * large));
  const finTable = f.largesDecalages
    ? corps.readUInt32LE(base + f.nombre * 4) : corps.readUInt16LE(base + f.nombre * 2);
  f.decalages = [];
  for (let i = 0; i < f.nombre; i++) f.decalages.push(base + lire(i));
  f.finDesFormes = base + finTable;
  let p = base + finTable;
  for (let i = 0; i < f.nombre; i++) {
    f.codes.push(f.largesCodes ? corps.readUInt16LE(p) : corps[p]);
    p += f.largesCodes ? 2 : 1;
  }
  if (f.aMetriques) {
    const lr = new Lecteur(corps, p);
    f.hauteur = lr.i16(); f.profondeur = lr.i16(); f.interligne = lr.i16();
    f.chasses = [];
    for (let i = 0; i < f.nombre; i++) f.chasses.push(lr.i16());
  }
  return f;
}

// Les contours d'un glyphe : la même grammaire que n'importe quelle forme SWF,
// mais sans style — que des traits et des courbes.
function contours(corps, debut, fin) {
  const r = new Lecteur(corps, debut);
  const bitsFond = r.ub(4), bitsTrait = r.ub(4);
  let x = 0, y = 0;
  const sortie = [];
  let cur = null;
  while (r.p < fin) {
    if (r.ub(1) === 0) {                         // un changement d'état
      const d = r.ub(5);
      if (d === 0) break;                        // fin de la forme
      if (d & 0x01) {                            // MoveTo : un nouveau contour
        const nb = r.ub(5);
        x = r.sb(nb); y = r.sb(nb);
        if (cur && cur.length) sortie.push(cur);
        cur = [{ x, y, sur: true }];
      }
      if (d & 0x02) r.ub(bitsFond);
      if (d & 0x04) r.ub(bitsFond);
      if (d & 0x08) r.ub(bitsTrait);
      if (d & 0x10) break;                       // un nouveau groupe de styles
    } else if (r.ub(1)) {                        // un trait droit
      const nb = r.ub(4) + 2;
      let dx = 0, dy = 0;
      if (r.ub(1)) { dx = r.sb(nb); dy = r.sb(nb); }
      else if (r.ub(1)) dy = r.sb(nb);
      else dx = r.sb(nb);
      x += dx; y += dy;
      if (cur) cur.push({ x, y, sur: true });
    } else {                                     // une courbe quadratique
      const nb = r.ub(4) + 2;
      const cx = x + r.sb(nb), cy = y + r.sb(nb);
      const ax = cx + r.sb(nb), ay = cy + r.sb(nb);
      x = ax; y = ay;
      if (cur) { cur.push({ x: cx, y: cy, sur: false }); cur.push({ x: ax, y: ay, sur: true }); }
    }
  }
  if (cur && cur.length) sortie.push(cur);
  return sortie;
}

// ── Écrire le TTF ────────────────────────────────────────────────────────────

class Plume {
  constructor() { this.bouts = []; this.lg = 0; }
  u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v & 0xff); this.bouts.push(b); this.lg += 1; return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); this.bouts.push(b); this.lg += 2; return this; }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(Math.max(-32768, Math.min(32767, v))); this.bouts.push(b); this.lg += 2; return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); this.bouts.push(b); this.lg += 4; return this; }
  mot(s) { const b = Buffer.from(s, 'latin1'); this.bouts.push(b); this.lg += b.length; return this; }
  brut(b) { this.bouts.push(b); this.lg += b.length; return this; }
  out() { return Buffer.concat(this.bouts, this.lg); }
}

const cale4 = (b) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]));
function somme(b) {
  const p = cale4(b);
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0;
  return s >>> 0;
}

// La table `glyf`. C'est ici que l'axe Y se retourne.
function glyf(glyphes) {
  const morceaux = [];
  let maxPoints = 0, maxContours = 0;
  const boite = { xMin: 32767, yMin: 32767, xMax: -32768, yMax: -32768 };
  for (const g of glyphes) {
    const cs = g.contours.filter((c) => c.length > 0);
    if (!cs.length) { morceaux.push(Buffer.alloc(0)); g.boite = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }; continue; }
    let xMin = 32767, yMin = 32767, xMax = -32768, yMax = -32768;
    const pts = [], fins = [];
    for (const c of cs) {
      for (const p of c) {
        const X = Math.round(p.x), Y = -Math.round(p.y);   // Flash descend, TrueType monte
        pts.push({ x: X, y: Y, sur: p.sur });
        if (X < xMin) xMin = X; if (X > xMax) xMax = X;
        if (Y < yMin) yMin = Y; if (Y > yMax) yMax = Y;
      }
      fins.push(pts.length - 1);
    }
    maxPoints = Math.max(maxPoints, pts.length);
    maxContours = Math.max(maxContours, cs.length);
    g.boite = { xMin, yMin, xMax, yMax };
    boite.xMin = Math.min(boite.xMin, xMin); boite.yMin = Math.min(boite.yMin, yMin);
    boite.xMax = Math.max(boite.xMax, xMax); boite.yMax = Math.max(boite.yMax, yMax);

    const w = new Plume();
    w.i16(cs.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
    for (const e of fins) w.u16(e);
    w.u16(0);                                    // pas d'instructions de hinting
    const drapeaux = [], xs = [], ys = [];
    let px = 0, py = 0;
    for (const p of pts) {
      const dx = p.x - px, dy = p.y - py;
      px = p.x; py = p.y;
      let f = p.sur ? 0x01 : 0x00;
      if (dx === 0) f |= 0x10;
      else if (dx >= -255 && dx <= 255) { f |= 0x02; if (dx > 0) f |= 0x10; }
      if (dy === 0) f |= 0x20;
      else if (dy >= -255 && dy <= 255) { f |= 0x04; if (dy > 0) f |= 0x20; }
      drapeaux.push(f); xs.push(dx); ys.push(dy);
    }
    for (const f of drapeaux) w.u8(f);
    for (let i = 0; i < xs.length; i++) {
      if (drapeaux[i] & 0x02) w.u8(Math.abs(xs[i]));
      else if (!(drapeaux[i] & 0x10)) w.i16(xs[i]);
    }
    for (let i = 0; i < ys.length; i++) {
      if (drapeaux[i] & 0x04) w.u8(Math.abs(ys[i]));
      else if (!(drapeaux[i] & 0x20)) w.i16(ys[i]);
    }
    morceaux.push(cale4(w.out()));
  }
  return { morceaux, maxPoints, maxContours, boite };
}

function tableNoms(lignes) {
  const w = new Plume();
  w.u16(0).u16(lignes.length).u16(6 + 12 * lignes.length);
  const chaines = [];
  let off = 0;
  for (const l of lignes) {
    const s = Buffer.from(l.valeur, 'utf16le').swap16();
    w.u16(3).u16(1).u16(0x409).u16(l.id).u16(s.length).u16(off);
    chaines.push(s); off += s.length;
  }
  return Buffer.concat([w.out(), ...chaines]);
}

// cmap format 4 : les codes se regroupent en segments contigus.
function cmap(table) {
  const codes = [...table.keys()].filter((c) => c > 0 && c <= 0xffff).sort((a, b) => a - b);
  const segs = [];
  let i = 0;
  while (i < codes.length) {
    let j = i;
    while (j + 1 < codes.length && codes[j + 1] === codes[j] + 1
      && table.get(codes[j + 1]) === table.get(codes[j]) + 1) j++;
    segs.push({ debut: codes[i], fin: codes[j], delta: (table.get(codes[i]) - codes[i]) & 0xffff });
    i = j + 1;
  }
  segs.push({ debut: 0xffff, fin: 0xffff, delta: 1 });
  const n = segs.length;
  const sub = new Plume();
  let portee = 2, selecteur = 0;
  while (portee * 2 <= n * 2) { portee *= 2; selecteur++; }
  sub.u16(4).u16(0).u16(0);
  sub.u16(n * 2).u16(portee).u16(selecteur).u16(n * 2 - portee);
  for (const s of segs) sub.u16(s.fin);
  sub.u16(0);
  for (const s of segs) sub.u16(s.debut);
  for (const s of segs) sub.i16((s.delta << 16) >> 16);
  for (const s of segs) sub.u16(0);
  const sb = sub.out();
  sb.writeUInt16BE(sb.length, 2);
  const w = new Plume();
  w.u16(0).u16(1).u16(3).u16(1).u32(12);
  return Buffer.concat([w.out(), sb]);
}

function batirTtf(o) {
  const { glyphes, em, hauteur, profondeur, interligne, famille } = o;
  const g = glyf(glyphes);

  const loca = new Plume();
  let off = 0;
  for (const d of g.morceaux) { loca.u32(off); off += d.length; }
  loca.u32(off);

  const n = glyphes.length;
  const chasseMax = Math.max(...glyphes.map((x) => x.chasse));
  const hmtx = new Plume();
  for (const x of glyphes) hmtx.u16(x.chasse).i16(x.boite.xMin);

  const head = new Plume();
  head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5F0F3CF5).u16(0x000B).u16(em);
  head.u32(0).u32(0).u32(0).u32(0);
  head.i16(g.boite.xMin).i16(g.boite.yMin).i16(g.boite.xMax).i16(g.boite.yMax);
  head.u16(0).u16(8).i16(2).i16(1).i16(0);       // indexToLocFormat = 1 : loca sur 32 bits
  const headB = head.out();

  const hhea = new Plume();
  hhea.u32(0x00010000).i16(hauteur).i16(profondeur).i16(interligne);
  hhea.u16(chasseMax).i16(g.boite.xMin).i16(0).i16(g.boite.xMax);
  hhea.i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(n);

  const maxp = new Plume();
  maxp.u32(0x00010000).u16(n).u16(g.maxPoints).u16(g.maxContours)
    .u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

  const os2 = new Plume();
  os2.u16(4).i16(Math.round(chasseMax * 0.6)).u16(400).u16(5).u16(0);
  for (let i = 0; i < 10; i++) os2.i16(0);
  os2.brut(Buffer.from([2, 0, 5, 3, 0, 0, 0, 0, 0, 0]));   // panose
  os2.u32(0x00000003).u32(0).u32(0).u32(0);
  os2.mot('SWFX');
  os2.u16(0x0040);                                          // fsSelection : REGULAR
  const codes = glyphes.map((x) => x.code).filter((c) => c && c <= 0xffff).sort((a, b) => a - b);
  os2.u16(codes[0] || 32).u16(codes[codes.length - 1] || 126);
  os2.i16(hauteur).i16(profondeur).i16(interligne);
  os2.u16(hauteur).u16(-profondeur);
  os2.u32(0).u32(0);
  os2.i16(Math.round(em * 0.5)).i16(Math.round(em * 0.7));
  os2.u16(1).u16(32).u16(1).i16(0).i16(0).i16(0);

  const post = new Plume();
  post.u32(0x00030000).u32(0).i16(0).i16(0).u32(0).u32(0).u32(0).u32(0).u32(0);

  const noms = tableNoms([
    { id: 0, valeur: 'Contours extraits du DefineFont2 du SWF d\'origine.' },
    { id: 1, valeur: famille },
    { id: 2, valeur: 'Regular' },
    { id: 3, valeur: famille + '-Regular-swf' },
    { id: 4, valeur: famille + ' Regular' },
    { id: 5, valeur: 'Version 1.000' },
    { id: 6, valeur: famille.replace(/\s+/g, '') + '-Regular' },
  ]);

  const corr = new Map();
  glyphes.forEach((x, i) => { if (i > 0 && x.code && !corr.has(x.code)) corr.set(x.code, i); });

  const tbl = [
    ['OS/2', os2.out()], ['cmap', cmap(corr)], ['glyf', Buffer.concat(g.morceaux)],
    ['head', headB], ['hhea', hhea.out()], ['hmtx', hmtx.out()], ['loca', loca.out()],
    ['maxp', maxp.out()], ['name', noms], ['post', post.out()],
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  let portee = 16, selecteur = 0;
  while (portee * 2 <= tbl.length * 16) { portee *= 2; selecteur++; }
  const rep = new Plume();
  rep.u32(0x00010000).u16(tbl.length).u16(portee).u16(selecteur).u16(tbl.length * 16 - portee);
  let pos = 12 + tbl.length * 16;
  const entrees = [];
  for (const [nom, data] of tbl) { entrees.push({ nom, data, pos }); pos += cale4(data).length; }
  for (const e of entrees) rep.mot(e.nom).u32(somme(e.data)).u32(e.pos).u32(e.data.length);
  const fonte = Buffer.concat([rep.out(), ...entrees.map((e) => cale4(e.data))]);
  // checkSumAdjustment : la somme du fichier entier, retranchée d'une constante.
  const tete = entrees.find((e) => e.nom === 'head');
  fonte.writeUInt32BE((0xB1B0AFBA - somme(fonte)) >>> 0, tete.pos + 8);
  return fonte;
}

// ── Emballer en WOFF ─────────────────────────────────────────────────────────

function enWoff(ttf) {
  const n = ttf.readUInt16BE(4);
  const tbl = [];
  for (let i = 0; i < n; i++) {
    const p = 12 + i * 16;
    tbl.push({
      nom: ttf.toString('latin1', p, p + 4),
      somme: ttf.readUInt32BE(p + 4),
      pos: ttf.readUInt32BE(p + 8),
      lg: ttf.readUInt32BE(p + 12),
    });
  }
  tbl.sort((a, b) => (a.nom < b.nom ? -1 : 1));
  const cale = (x) => (x + 3) & ~3;
  let pos = 44 + n * 20;
  const bouts = [];
  const rep = Buffer.alloc(n * 20);
  let d = 0;
  for (const t of tbl) {
    const brut = ttf.slice(t.pos, t.pos + t.lg);
    const serre = zlib.deflateSync(brut, { level: 9 });
    const pris = serre.length < brut.length ? serre : brut;
    rep.write(t.nom, d, 4, 'latin1');
    rep.writeUInt32BE(pos, d + 4);
    rep.writeUInt32BE(pris.length, d + 8);
    rep.writeUInt32BE(brut.length, d + 12);
    rep.writeUInt32BE(t.somme, d + 16);
    d += 20;
    bouts.push(pris);
    const reste = cale(pris.length) - pris.length;
    if (reste) bouts.push(Buffer.alloc(reste));
    pos += cale(pris.length);
  }
  const corps = Buffer.concat(bouts);
  const total = 44 + n * 20 + corps.length;
  const tete = Buffer.alloc(44);
  tete.write('wOFF', 0, 4, 'latin1');
  tete.writeUInt32BE(ttf.readUInt32BE(0), 4);
  tete.writeUInt32BE(total, 8);
  tete.writeUInt16BE(n, 12);
  let taille = 12 + n * 16;
  for (const t of tbl) taille += cale(t.lg);
  tete.writeUInt32BE(taille, 16);
  tete.writeUInt16BE(1, 20);
  return Buffer.concat([tete, rep, corps]);
}

// ── Le programme ─────────────────────────────────────────────────────────────

function principal() {
  const [swf, idTexte, sortie, famille] = process.argv.slice(2);
  if (!swf || !idTexte || !sortie) {
    console.error('usage : extract-swf-font.js <fichier.swf> <fontId> <sortie.woff> [Famille]');
    process.exit(2);
  }
  const id = parseInt(idTexte, 10);
  const corps = lireSwf(swf);
  let f = null;
  for (const t of tags(corps)) {
    if (t.code !== 48 && t.code !== 75) continue;
    const c = lireFonte(corps, t);
    if (c.id === id) { f = c; break; }
  }
  if (!f) throw new Error('police ' + id + ' introuvable dans ' + swf);

  const glyphes = [{ code: 0, chasse: 0, contours: [] }];   // .notdef en tête
  let dessines = 0;
  for (let i = 0; i < f.nombre; i++) {
    const debut = f.decalages[i];
    const fin = (i + 1 < f.nombre) ? f.decalages[i + 1] : f.finDesFormes;
    let cs = [];
    try { cs = contours(corps, debut, fin); } catch (e) { cs = []; }
    if (!f.codes[i]) continue;
    glyphes.push({ code: f.codes[i], chasse: (f.chasses && f.chasses[i]) || 512, contours: cs });
    if (cs.length) dessines++;
  }

  const ttf = batirTtf({
    glyphes,
    em: 1024,
    hauteur: f.hauteur || 815,
    profondeur: -(f.profondeur || 204),
    interligne: f.interligne || 0,
    famille: famille || f.nom,
  });
  const woff = enWoff(ttf);
  fs.writeFileSync(sortie, woff);
  console.log('« ' + f.nom + ' » (id ' + f.id + ') : ' + f.nombre + ' glyphes déclarés, '
    + dessines + ' réellement dessinés');
  console.log('→ ' + sortie + ' (' + woff.length + ' octets, TTF intermédiaire ' + ttf.length + ')');
}

principal();
