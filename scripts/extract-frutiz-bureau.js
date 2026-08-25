#!/usr/bin/env node
/*
 * Sort les dessins du BUREAU (main.swf) pour le portage light — la partie que
 * l'extracteur commun ne sait pas traverser : les DefineButton2.
 *
 *   node scripts/extract-frutiz-bureau.js          → écrit public/frutiz/sprites/
 *
 * Le bandeau d'une fenêtre (cp.WinTopBar) attache des `butGroupWinTop`
 * (sprite #180) : trois images, une par BOUTON — #173, #176, #179, des
 * DefineButton2. Un bouton n'est pas un clip : ses états (up/over/down)
 * sont des BUTTONRECORDs, chacun posant un caractère avec sa matrice et sa
 * transformation de couleur. L'aplatisseur commun (lib/swf-sprites.js) les
 * ignore, et c'est pour cela que le sprite #180 sortait « vide ».
 *
 * Ici on lit les BUTTONRECORDs à l'octet, on compose chaque état en SVG
 * (formes extraites par extract-swf-shapes.js, matrices en pixels, cxform en
 * filtre de couleur), et on écrit un manifeste avec les cadres — mêmes
 * conventions que les autres extracteurs du dépôt.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir, IDENTITE } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'legacy/main.swf');
const SORTIE = path.join(RACINE, 'public/frutiz/sprites');

const swf = ouvrir(SWF, { textesEnFormes: false });
const b = swf.b;

// ── Les DefineButton2 du fichier ──────────────────────────────────────────
function tousLesBoutons() {
  const boutons = new Map();
  const nbits = b[0] >> 3;
  const debut = Math.ceil((5 + nbits * 4) / 8) + 4;
  (function scan(from, to) {
    let o = from;
    while (o + 2 <= to) {
      const cl = b.readUInt16LE(o); const code = cl >> 6;
      let len = cl & 0x3f, hs = 2;
      if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
      const corps = o + hs;
      if (code === 0) break;
      if (code === 39) scan(corps + 4, corps + len);
      if (code === 34) boutons.set(b.readUInt16LE(corps), { corps, len });
      o = corps + len;
    }
  })(debut, b.length);
  return boutons;
}

// ── La lecture au bit (MATRIX et CXFORMWITHALPHA, non alignés) ────────────
class Bits {
  constructor(o) { this.o = o; this.bit = 0; }
  u(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((b[this.o] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.o++; }
    }
    return v >>> 0;
  }
  s(n) { if (!n) return 0; const v = this.u(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
  aligner() { if (this.bit) { this.bit = 0; this.o++; } return this.o; }
}
function lireMatrice(bits) {
  const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (bits.u(1)) { const n = bits.u(5); M.a = bits.s(n) / 65536; M.d = bits.s(n) / 65536; }
  if (bits.u(1)) { const n = bits.u(5); M.b = bits.s(n) / 65536; M.c = bits.s(n) / 65536; }
  const n = bits.u(5); M.e = bits.s(n); M.f = bits.s(n);
  bits.aligner();
  return M;
}
function lireCx(bits) {
  const add = bits.u(1), mult = bits.u(1), n = bits.u(4);
  const c = { mr: 256, mv: 256, mb: 256, ma: 256, ar: 0, av: 0, ab: 0, aa: 0 };
  if (mult) { c.mr = bits.s(n); c.mv = bits.s(n); c.mb = bits.s(n); c.ma = bits.s(n); }
  if (add) { c.ar = bits.s(n); c.av = bits.s(n); c.ab = bits.s(n); c.aa = bits.s(n); }
  bits.aligner();
  return c;
}
const cxNeutre = (c) => !c || (c.mr === 256 && c.mv === 256 && c.mb === 256
  && c.ma === 256 && !c.ar && !c.av && !c.ab && !c.aa);

// ── Les BUTTONRECORDs d'un DefineButton2 ──────────────────────────────────
// { up: [...], over: [...], down: [...] } — chaque entrée { ch, prof, M, cx }.
function lireBouton(def) {
  let o = def.corps + 2;                // après l'id
  o += 1;                               // drapeaux (trackAsMenu)
  o += 2;                               // actionOffset
  const etats = { up: [], over: [], down: [] };
  while (b[o] !== 0) {
    const drapeaux = b[o]; o += 1;
    const ch = b.readUInt16LE(o); o += 2;
    const prof = b.readUInt16LE(o); o += 2;
    const bits = new Bits(o);
    const M = lireMatrice(bits);
    const cx = lireCx(bits);
    o = bits.o;
    // ButtonHasFilterList / ButtonHasBlendMode (SWF8) : absents de ce fichier
    // (drapeaux ≤ 0x0f partout) — on le vérifie plutôt que de le supposer.
    if (drapeaux & 0x30) throw new Error('bouton à filtres/blend, non géré : ' + drapeaux);
    const pose = { ch, prof, M, cx };
    if (drapeaux & 1) etats.up.push(pose);
    if (drapeaux & 2) etats.over.push(pose);
    if (drapeaux & 4) etats.down.push(pose);
    // bit 3 = hitTest : la zone cliquable, invisible — rien à dessiner.
  }
  return etats;
}

// ── Les formes, par l'extracteur commun ───────────────────────────────────
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'frutiz-formes-'));
const corpsFormes = new Map();          // id → { corps, vb } (main.swf)
// `fichier`/`formes` permettent de servir une SECONDE source : la roue de la
// frutimandala vit dans public/wheel/wheel1.swf, pas dans main.swf.
function chargerFormes(ids, fichier = SWF, formes = corpsFormes) {
  if (!ids.length) return;
  const dossier = fichier === SWF ? TMP : path.join(TMP, path.basename(fichier, '.swf'));
  execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), fichier, dossier, ...ids.map(String)],
    { stdio: 'pipe' });
  for (const id of ids) {
    const p = path.join(dossier, 'shape' + id + '.svg');
    if (!fs.existsSync(p)) { console.warn('!! forme absente', id); continue; }
    const t = fs.readFileSync(p, 'utf8');
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(t);
    formes.set(id, {
      corps: t.replace(/<svg[^>]*>/, '').replace('</svg>', ''),
      vb: { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] },
    });
  }
}

// Un cxform en filtre SVG (le même feColorMatrix que les autres extracteurs :
// sortie = source × mult/256 + add/255).
let nFiltre = 0;
function filtreCx(cx) {
  if (cxNeutre(cx)) return null;
  const id = 'cx' + (++nFiltre);
  const m = [
    cx.mr / 256, 0, 0, 0, cx.ar / 255,
    0, cx.mv / 256, 0, 0, cx.av / 255,
    0, 0, cx.mb / 256, 0, cx.ab / 255,
    0, 0, 0, cx.ma / 256, cx.aa / 255,
  ];
  return {
    id,
    def: `<filter id="${id}" color-interpolation-filters="sRGB">`
      + `<feColorMatrix type="matrix" values="${m.map((v) => +v.toFixed(4)).join(' ')}"/></filter>`,
  };
}

// ── La composition d'un état en SVG ───────────────────────────────────────
// Chaque pose devient des morceaux-formes : une forme telle quelle, un sprite
// via l'aplatisseur commun (ses matrices composées sous celle du record).
function morceauxDe(pose) {
  if (swf.estForme(pose.ch)) return [{ shape: pose.ch, M: pose.M, cx: pose.cx }];
  if (swf.estSprite(pose.ch)) {
    return swf.aplatir(pose.ch, pose.M, 0, 1, '', pose.cx).map((m) => m);
  }
  console.warn('!! caractère non géré dans un bouton :', pose.ch);
  return [];
}

const arr = (v) => String(Math.round(v * 100) / 100);
function svgCompose(morceaux, formes = corpsFormes) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const dessins = [];
  for (const m of morceaux) {
    if (m.masque) continue;
    const f = formes.get(m.shape);
    if (!f) continue;
    for (const [px, py] of [[f.vb.x, f.vb.y], [f.vb.x + f.vb.w, f.vb.y],
      [f.vb.x, f.vb.y + f.vb.h], [f.vb.x + f.vb.w, f.vb.y + f.vb.h]]) {
      const sx = m.M.a * px + m.M.c * py + m.M.e / 20;
      const sy = m.M.b * px + m.M.d * py + m.M.f / 20;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    dessins.push(m);
  }
  if (!dessins.length) return null;
  const l = Math.max(0.01, x1 - x0), h = Math.max(0.01, y1 - y0);
  let defs = '', corps = '';
  for (const d of dessins) {
    const f = formes.get(d.shape);
    const fc = filtreCx(d.cx);
    if (fc) defs += fc.def;
    corps += `<g transform="matrix(${[d.M.a, d.M.b, d.M.c, d.M.d, d.M.e / 20, d.M.f / 20]
      .map((v) => +v.toFixed(4)).join(',')})"` + (fc ? ` filter="url(#${fc.id})"` : '') + '>'
      + f.corps + '</g>\n';
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(x0)} ${arr(y0)} ${arr(l)} ${arr(h)}" width="${arr(l)}" height="${arr(h)}">\n`
    + (defs ? '<defs>' + defs + '</defs>\n' : '') + corps + '</svg>\n';
  return { svg, cadre: { x: +arr(x0), y: +arr(y0), w: +arr(l), h: +arr(h) } };
}

// ── Les placements d'une frame 1 de sprite, à l'octet ─────────────────────
// L'aplatisseur commun saute les DefineButton2 : pour l'ONGLET (#206), dont
// la plaque est justement un bouton (#133), on relit les PlaceObject2 de la
// première image et on substitue l'état UP du bouton — le reste passe par
// morceauxDe comme d'habitude.
function placementsFrame1(spriteId) {
  let corps = null, len = 0;
  const nbits = b[0] >> 3;
  const debut = Math.ceil((5 + nbits * 4) / 8) + 4;
  (function scan(from, to) {
    let o = from;
    while (o + 2 <= to) {
      const cl = b.readUInt16LE(o); const code = cl >> 6;
      let l = cl & 0x3f, hs = 2;
      if (l === 0x3f) { l = b.readUInt32LE(o + 2); hs = 6; }
      const c = o + hs;
      if (code === 0) break;
      if (code === 39) {
        if (b.readUInt16LE(c) === spriteId) { corps = c + 4; len = l - 4; }
        else scan(c + 4, c + l);
      }
      o = c + l;
    }
  })(debut, b.length);
  if (corps === null) throw new Error('sprite absent : ' + spriteId);
  const poses = [];
  let o = corps;
  const fin = corps + len;
  while (o + 2 <= fin) {
    const cl = b.readUInt16LE(o); const code = cl >> 6;
    let l = cl & 0x3f, hs = 2;
    if (l === 0x3f) { l = b.readUInt32LE(o + 2); hs = 6; }
    const c = o + hs;
    if (code === 0 || code === 1) break;            // End ou ShowFrame : image 1 close
    if (code === 26) {                              // PlaceObject2
      const drapeaux = b[c]; let p = c + 3;         // flags + depth(2)
      const prof = b.readUInt16LE(c + 1);
      let ch = null, M = IDENTITE, cx;
      if (drapeaux & 2) { ch = b.readUInt16LE(p); p += 2; }
      if (drapeaux & 4) { const bits = new Bits(p); M = lireMatrice(bits); p = bits.o; }
      if (drapeaux & 8) { const bits = new Bits(p); cx = lireCx(bits); }
      if (ch !== null) poses.push({ ch, prof, M, cx });
    }
    o = c + l;
  }
  return poses.sort((a, bb) => a.prof - bb.prof);
}

// Matrices en twips : composition A∘B (B dessiné dans le repère de A).
function composerTwips(A, B) {
  return {
    a: A.a * B.a + A.c * B.b, b: A.b * B.a + A.d * B.b,
    c: A.a * B.c + A.c * B.d, d: A.b * B.c + A.d * B.d,
    e: A.a * B.e + A.c * B.f + A.e, f: A.b * B.e + A.d * B.f + A.f,
  };
}

// ── L'extraction ──────────────────────────────────────────────────────────
function principal() {
  fs.mkdirSync(SORTIE, { recursive: true });
  const boutons = tousLesBoutons();
  // Le bandeau : butGroupWinTop (#180) place #173/#176/#179 sur ses trois
  // images — le bouton 1 est celui de genTopIconList (fermer, tryToClose).
  const CIBLES = [
    { cle: 'butWinTop1', id: 173 },
    { cle: 'butWinTop2', id: 176 },
    { cle: 'butWinTop3', id: 179 },
    // La languette CONTACTS : `sideListContact` (#436) est LUI AUSSI un
    // DefineButton2 — SideList.init l'attache sous le nom `butContact` à
    // x = wSide (9), y = 800 (le bas de la scène d'époque).
    { cle: 'butContact', id: 436 },
  ];
  // Toutes les formes touchées, en un passage.
  const formes = new Set();
  const lus = [];
  for (const c of CIBLES) {
    const def = boutons.get(c.id);
    if (!def) { console.warn('!! bouton absent', c.id); continue; }
    const etats = lireBouton(def);
    for (const nomEtat of ['up', 'over', 'down']) {
      for (const pose of etats[nomEtat]) {
        for (const m of morceauxDe(pose)) if (m.shape !== undefined) formes.add(m.shape);
      }
    }
    lus.push({ c, etats });
  }
  chargerFormes([...formes]);

  const manifeste = { boutons: {}, notes: 'butGroupWinTop #180 : images 1..3 → boutons #173/#176/#179 (up/over/down)' };
  for (const { c, etats } of lus) {
    manifeste.boutons[c.cle] = {};
    // Le cadre COMMUN aux trois états : au repos seul le glyphe se dessine,
    // la plaque n'arrive qu'au survol — sans repère commun, le glyphe
    // sauterait au premier survol. On compose chaque état dans l'union.
    const rendus = {};
    let u = null;
    for (const nomEtat of ['up', 'over', 'down']) {
      const morceaux = [];
      for (const pose of etats[nomEtat]) morceaux.push(...morceauxDe(pose));
      const r = svgCompose(morceaux);
      if (!r) { console.warn('!! état vide', c.cle, nomEtat); continue; }
      rendus[nomEtat] = r;
      u = u ? {
        x: Math.min(u.x, r.cadre.x), y: Math.min(u.y, r.cadre.y),
        x1: Math.max(u.x1, r.cadre.x + r.cadre.w), y1: Math.max(u.y1, r.cadre.y + r.cadre.h),
      } : { x: r.cadre.x, y: r.cadre.y, x1: r.cadre.x + r.cadre.w, y1: r.cadre.y + r.cadre.h };
    }
    const cadre = { x: u.x, y: u.y, w: +arr(u.x1 - u.x), h: +arr(u.y1 - u.y) };
    for (const nomEtat of Object.keys(rendus)) {
      const fichier = c.cle + '_' + nomEtat + '.svg';
      const svg = rendus[nomEtat].svg.replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/,
        `viewBox="${arr(cadre.x)} ${arr(cadre.y)} ${arr(cadre.w)} ${arr(cadre.h)}" width="${arr(cadre.w)}" height="${arr(cadre.h)}"`);
      fs.writeFileSync(path.join(SORTIE, fichier), svg, 'utf8');
      manifeste.boutons[c.cle][nomEtat] = { fichier };
      console.log(fichier, 'cadre commun', JSON.stringify(cadre));
    }
    manifeste.boutons[c.cle].cadre = cadre;
  }

  // ── L'ONGLET du bureau (MainBarTab, DoInitAction #781 0x6e614) ──────────
  // Deux clips attachés côte à côte par la barre : `tabFond` (#187, la
  // silhouette sombre sur mcTabBlack) et `tab` (#206, la plaque + le
  // contenu sur mcTab). La plaque de #206 est un DefineButton2 (#133,
  // étiré ×1.2325/×0.2406) : on compose son état UP sous la matrice du
  // placement. Le label (« Bureau ») est un DefineEditText (#190, Verdana
  // 10 #000000 lié à _parent.name) : il ne se dessine pas ici — c'est du
  // texte HTML dans le portage. Les deux SVG partagent le MÊME cadre pour
  // se superposer tels quels.
  const ONGLET = [{ cle: 'onglet_fond', id: 187 }, { cle: 'onglet_corps', id: 206 }];
  const morceauxOnglet = new Map();
  const formesOnglet = new Set();
  for (const c of ONGLET) {
    const liste = [];
    for (const pose of placementsFrame1(c.id)) {
      const def = boutons.get(pose.ch);
      if (def) {
        for (const rec of lireBouton(def).up) {
          for (const m of morceauxDe({ ch: rec.ch, M: composerTwips(pose.M, rec.M), cx: rec.cx })) liste.push(m);
        }
      } else {
        for (const m of morceauxDe(pose)) liste.push(m);
      }
    }
    for (const m of liste) if (m.shape !== undefined) formesOnglet.add(m.shape);
    morceauxOnglet.set(c.cle, liste);
  }
  chargerFormes([...formesOnglet].filter((id) => !corpsFormes.has(id)));
  {
    const rendus = {};
    let u = null;
    for (const c of ONGLET) {
      const r = svgCompose(morceauxOnglet.get(c.cle));
      if (!r) { console.warn('!! onglet vide', c.cle); continue; }
      rendus[c.cle] = r;
      u = u ? {
        x: Math.min(u.x, r.cadre.x), y: Math.min(u.y, r.cadre.y),
        x1: Math.max(u.x1, r.cadre.x + r.cadre.w), y1: Math.max(u.y1, r.cadre.y + r.cadre.h),
      } : { x: r.cadre.x, y: r.cadre.y, x1: r.cadre.x + r.cadre.w, y1: r.cadre.y + r.cadre.h };
    }
    const cadre = { x: u.x, y: u.y, w: +arr(u.x1 - u.x), h: +arr(u.y1 - u.y) };
    manifeste.onglet = { cadre, notes: 'tabFond #187 + tab #206 (plaque = état UP du bouton #133) ; label = Verdana 10 #000000 (#190)' };
    for (const cle of Object.keys(rendus)) {
      const svg = rendus[cle].svg.replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/,
        `viewBox="${arr(cadre.x)} ${arr(cadre.y)} ${arr(cadre.w)} ${arr(cadre.h)}" width="${arr(cadre.w)}" height="${arr(cadre.h)}"`);
      fs.writeFileSync(path.join(SORTIE, cle + '.svg'), svg, 'utf8');
      manifeste.onglet[cle] = { fichier: cle + '.svg' };
      console.log(cle + '.svg cadre commun', JSON.stringify(cadre));
    }
  }

  // ── Les quatre boutons de la colonne gauche du SALON ────────────────────
  // `win.Chat.genLeftIconList` (0x691da) déclare quatre `butPush` dont le
  // `param` est `{link: 'butPushSmallPink', frame: N, outline: 2, curve: 4}`.
  // `butPushSmallPink` (#378) pose, sur son image 1, la GÉLULE #359 (20×20,
  // anneau `#F28687`, fond `#FFAAAD`), la bande d'icônes #374 et le REFLET
  // #375 (un filet blanc de 16×3,65 en haut). C'est la bande #374 que le
  // `frame` vise : image 2 = la liste, 3 = la bouille, 4 = les feutres,
  // 5 = l'avertissement. Tout est posé à l'origine — les formes portent leur
  // propre décalage —, donc composer un bouton, c'est empiler trois formes.
  const CHAT_BOUTONS = [
    { cle: 'chat-but-bouille',  icone: 361 },   // image 3 — tipId chat_bouille
    { cle: 'chat-but-userlist', icone: 360 },   // image 2 — tipId chat_userlist
    { cle: 'chat-but-penlist',  icone: 362 },   // image 4 — tipId chat_penlist
    { cle: 'chat-but-warning',  icone: 363 },   // image 5 — tipId chat_warning
  ];
  chargerFormes([359, 375, ...CHAT_BOUTONS.map((b) => b.icone)]
    .filter((id) => !corpsFormes.has(id)));
  {
    // La gélule donne le cadre : 20×20, les icônes tiennent dedans.
    const gelule = corpsFormes.get(359);
    const cadre = gelule ? { x: gelule.vb.x, y: gelule.vb.y, w: gelule.vb.w, h: gelule.vb.h } : null;
    if (!cadre) console.warn('!! gélule #359 absente');
    else {
      manifeste.chatBoutons = { cadre, notes: 'butPushSmallPink #378 : gélule #359 + reflet #375 + icône de la bande #374' };
      for (const b of CHAT_BOUTONS) {
        const ico = corpsFormes.get(b.icone);
        if (!ico) { console.warn('!! icône absente', b.icone); continue; }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(cadre.x)} ${arr(cadre.y)} ${arr(cadre.w)} ${arr(cadre.h)}" width="${arr(cadre.w)}" height="${arr(cadre.h)}">\n`
          + gelule.corps + corpsFormes.get(375).corps + ico.corps + '</svg>\n';
        fs.writeFileSync(path.join(SORTIE, b.cle + '.svg'), svg, 'utf8');
        manifeste.chatBoutons[b.cle] = { fichier: b.cle + '.svg', icone: b.icone };
        console.log(b.cle + '.svg (icône #' + b.icone + ')');
      }
    }
  }

  // ── La bande des fruits-pastilles (#198) ────────────────────────────────
  // Une image étiquetée par TYPE de fenêtre — la pastille d'une barre-titre
  // est un gotoAndStop sur cette bande, et une étiquette inconnue laisse la
  // frame 1 : l'ORANGE est le fruit par défaut. Chaque fruit sort sur un
  // cadre COMMUN (l'union) pour se poser au même endroit dans le bandeau.
  const FRUITS = [
    { cle: 'fruit_default', id: 191 },     // l'orange (frame 1)
    { cle: 'fruit_winDebug', id: 192 },    // la prune
    { cle: 'fruit_winChat', id: 193 },     // la fraise
    { cle: 'fruit_winExplorer', id: 194 }, // la banane
    { cle: 'fruit_winShop', id: 195 },     // le fruit vert
    { cle: 'fruit_winAlert', id: 196 },    // le citron
    { cle: 'fruit_f86', id: 197 },         // frame 86, sans étiquette (rose)
  ];
  chargerFormes(FRUITS.map((f) => f.id).filter((id) => !corpsFormes.has(id)));
  {
    let u = null;
    for (const f of FRUITS) {
      const vb = corpsFormes.get(f.id) && corpsFormes.get(f.id).vb;
      if (!vb) continue;
      u = u ? {
        x: Math.min(u.x, vb.x), y: Math.min(u.y, vb.y),
        x1: Math.max(u.x1, vb.x + vb.w), y1: Math.max(u.y1, vb.y + vb.h),
      } : { x: vb.x, y: vb.y, x1: vb.x + vb.w, y1: vb.y + vb.h };
    }
    const cadre = { x: u.x, y: u.y, w: +arr(u.x1 - u.x), h: +arr(u.y1 - u.y) };
    manifeste.fruits = { cadre, notes: 'bande #198 : une frame étiquetée par type (gotoAndStop) ; étiquette inconnue → frame 1, l’orange' };
    for (const f of FRUITS) {
      const forme = corpsFormes.get(f.id);
      if (!forme) { console.warn('!! fruit absent', f.id); continue; }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(cadre.x)} ${arr(cadre.y)} ${arr(cadre.w)} ${arr(cadre.h)}" width="${arr(cadre.w)}" height="${arr(cadre.h)}">\n`
        + forme.corps + '</svg>\n';
      fs.writeFileSync(path.join(SORTIE, f.cle + '.svg'), svg, 'utf8');
      manifeste.fruits[f.cle] = { fichier: f.cle + '.svg', id: f.id };
      console.log(f.cle + '.svg (forme #' + f.id + ')');
    }
  }

  // ── Le PANNEAU DES CONTACTS : ses vraies pièces ────────────────────────
  // `SideList.buildElement` (0xa1243) pose deux sortes de lignes :
  //   • un DOSSIER = `sideListTitle` (#215), qui contient trois choses —
  //     `fond` (#210 → la forme #209), `fondD` (#213, DEUX images : #211 et
  //     #212, la flèche de repli) et `tf` (#214, le champ texte) ;
  //   • un CONTACT = `userSlot` (#261), dont `UserSlot.init` (0x633dc)
  //     attache la bande `status` (#253) sous le nom `icon`, puis `butText`
  //     à `_x = 20` pour le pseudo.
  // Dans la bande `status`, la profondeur 1 est le FOND de l'icône (#217,
  // dont `iconBackgroundId = 2` retient la forme #216) et la profondeur 3
  // l'ÉTAT : image 2 « presence » = la bande #222, dont `ico.gotoAndStop
  // (presence + 1)` choisit #220 (présence 1) ou #221 (présence 2) ; l'image 1
  // par défaut réunit #218 et #219.
  const CONTACTS = [
    { cle: 'sl-dossier-fond', id: 209 },   // la plaque du dossier
    { cle: 'sl-fleche-1', id: 211 },       // fondD image 1
    { cle: 'sl-fleche-2', id: 212 },       // fondD image 2
    { cle: 'sl-icone-fond', id: 216 },     // le fond de l'icône (iconBackgroundId = 2)
    { cle: 'sl-presence-0a', id: 218 },    // image 1 de la bande de présence…
    { cle: 'sl-presence-0b', id: 219 },    // …en deux morceaux
    { cle: 'sl-presence-1', id: 220 },     // présence 1
    { cle: 'sl-presence-2', id: 221 },     // présence 2
  ];
  chargerFormes(CONTACTS.map((c) => c.id).filter((id) => !corpsFormes.has(id)));
  {
    manifeste.contacts = { notes: 'sideListTitle #215 / userSlot #261 + bande status #253' };
    for (const c of CONTACTS) {
      const forme = corpsFormes.get(c.id);
      if (!forme) { console.warn('!! pièce de contact absente', c.id); continue; }
      const vb = forme.vb;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(vb.x)} ${arr(vb.y)} ${arr(vb.w)} ${arr(vb.h)}" width="${arr(vb.w)}" height="${arr(vb.h)}">\n`
        + forme.corps + '</svg>\n';
      fs.writeFileSync(path.join(SORTIE, c.cle + '.svg'), svg, 'utf8');
      manifeste.contacts[c.cle] = { fichier: c.cle + '.svg', id: c.id, cadre: vb };
      console.log(c.cle + '.svg (forme #' + c.id + ')', JSON.stringify(vb));
    }
  }

  // La présence PAR DÉFAUT réunit deux formes sur la même image : on les
  // compose sur leur cadre commun, comme le fait le lecteur.
  {
    const morceaux = [];
    for (const pose of placementsFrame1(222)) {
      if (!corpsFormes.has(pose.ch)) continue;
      morceaux.push({ shape: pose.ch, M: pose.M, cx: pose.cx });
    }
    if (morceaux.length) {
      const svg = svgCompose(morceaux);
      fs.writeFileSync(path.join(SORTIE, 'sl-presence-0.svg'), svg.svg, 'utf8');
      manifeste.contacts["sl-presence-0"] = { fichier: "sl-presence-0.svg", ids: morceaux.map((m) => m.shape), cadre: svg.cadre };
      console.log('sl-presence-0.svg', JSON.stringify(svg.cadre));
    }
  }

  // ── Les CLIPS qui s'aplatissent tels quels ─────────────────────────────
  // Tout n'est pas un conteneur vide : le lecteur `frusion` (#324) pose bien
  // ses dessins sur sa première image (la cuve, les trois fruits, les deux
  // boutons ronds). On l'aplatit par la bibliothèque commune, à l'identique.
  // La frutimandala sort en DEUX COUCHES, comme ses profondeurs le veulent :
  // le châssis de fond (#609, profondeur 1) passe SOUS le cadran, et les
  // quatre boutons plus le verre (profondeurs 8 à 25) passent DESSUS — c'est
  // la place du cadran (#613, profondeur 3) que vient prendre la roue.
  const CLIPS = [
    { cle: 'frusion', id: 324 },
    { cle: 'frutimandala-fond', id: 640, profondeurs: (p) => p < 3 },
    { cle: 'frutimandala-dessus', id: 640, profondeurs: (p) => p > 3 },
    // La boîte de recherche du panneau des contacts : `mcSearchButton` (#441),
    // que `SideList.buildList` attache à `_y = 770`.
    { cle: 'recherche', id: 441 },
    // LE REFLET DE L'ENCART. `cpDigital` (#417) empile quatre choses sur son
    // image 1 : la plaque #411 (profondeur 1, 150×45, le fond `#C8F39A`, le
    // liseré `#DDDDDD` et le filet sombre `#666666`), le champ du rang #413
    // (prof. 2), la coupe #415 (prof. 3) — et, TOUT EN HAUT, la forme #416
    // (prof. 7), qui n'est pas « un reflet » mais la COUCHE DE FINITION
    // complète : le trait de séparation `#73B01E` sous la coupe, l'ombre
    // basse (noir 20 %), le liseré haut (blanc 40 %), la grande brillance en
    // L le long du haut et du bord droit (blanc 50 %) et — ce qui manquait —
    // l'éclat OPAQUE du coin haut-droit. On la sort seule, mais cadrée sur le
    // clip entier, donc dans le repère de la plaque : elle se pose telle
    // quelle sur l'encart.
    { cle: 'encart-reflet', id: 417, profondeurs: (p) => p === 7 },
  ];
  for (const c of CLIPS) {
    // On relit ses placements à l'octet plutôt que d'appeler aplatir() : le
    // lecteur pose DEUX DefineButton2 (#317 le casque à gauche, #313
    // l'éjection à droite), que l'aplatisseur commun saute — leur état UP est
    // composé ici, comme pour l'onglet.
    const morceaux = [];
    let cadreEntier = null;
    for (const pose of placementsFrame1(c.id)) {
      const def = boutons.get(pose.ch);
      const sortis = [];
      if (def) {
        for (const rec of lireBouton(def).up) {
          for (const m of morceauxDe({ ch: rec.ch, M: composerTwips(pose.M, rec.M), cx: rec.cx })) sortis.push(m);
        }
      } else {
        for (const m of morceauxDe(pose)) sortis.push(m);
      }
      // Les couches d'un même clip partagent le cadre du clip ENTIER : sans
      // ça, chaque SVG se recadrerait sur son propre contenu et les deux ne
      // se superposeraient plus.
      for (const m of sortis) { m._prof = pose.prof; morceaux.push(m); }
    }
    const formesClip = new Set();
    for (const m of morceaux) if (m.shape !== undefined) formesClip.add(m.shape);
    chargerFormes([...formesClip].filter((id) => !corpsFormes.has(id)));
    cadreEntier = svgCompose(morceaux);
    const garde = c.profondeurs ? morceaux.filter((m) => c.profondeurs(m._prof)) : morceaux;
    const r = svgCompose(garde);
    if (!r || !cadreEntier) { console.warn('!! clip vide', c.cle); continue; }
    const k = cadreEntier.cadre;
    const svg = r.svg.replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/,
      `viewBox="${arr(k.x)} ${arr(k.y)} ${arr(k.w)} ${arr(k.h)}" width="${arr(k.w)}" height="${arr(k.h)}"`);
    fs.writeFileSync(path.join(SORTIE, c.cle + '.svg'), svg, 'utf8');
    manifeste[c.cle] = { fichier: c.cle + '.svg', cadre: k };
    console.log(c.cle + '.svg', JSON.stringify(k));
  }

  // ── La ROUE de la frutimandala (public/wheel/wheel1.swf) ────────────────
  // Le cadran est vide dans main.swf parce qu'il n'y est pas : `Wheel`
  // (#773) charge une PEAU EXTERNE — `Path.wheel` = « /wheel/wheel$i.swf »,
  // avec `wheelId` 1 pour wheel.FruitMonth (#777). Le sprite #62 de ce
  // fichier EST la roue : dix quartiers (#52) posés tous les 36°, et les
  // dix fruits des frutisignes par-dessus. On l'aplatit tel quel.
  {
    const ROUE = path.join(RACINE, 'public/wheel/wheel1.swf');
    const swfRoue = ouvrir(ROUE, { textesEnFormes: false });
    const formesRoue = new Map();
    const morceaux = swfRoue.aplatir(62, IDENTITE, 0, 1, '', undefined);
    const ids = new Set();
    for (const m of morceaux) if (m.shape !== undefined) ids.add(m.shape);
    chargerFormes([...ids], ROUE, formesRoue);
    const r = svgCompose(morceaux, formesRoue);
    if (r) {
      fs.writeFileSync(path.join(SORTIE, 'frutimandala-roue.svg'), r.svg, 'utf8');
      manifeste.frutimandalaRoue = { fichier: 'frutimandala-roue.svg', cadre: r.cadre };
      console.log('frutimandala-roue.svg', JSON.stringify(r.cadre));
    } else console.warn('!! roue vide');
  }

  fs.writeFileSync(path.join(SORTIE, 'bureau.json'), JSON.stringify(manifeste, null, 1), 'utf8');
  console.log('manifeste → public/frutiz/sprites/bureau.json');
}

principal();
