#!/usr/bin/env node
// Sort TOUT ce que le portage natif de Kaluga rejoue : les scénarios des clips,
// les dessins, les textes, les boutons, les images, les sons et les fontes.
//
//   node scripts/extract-kaluga.js            → écrit public/kaluga/data/, sons/, fontes/
//   node scripts/extract-kaluga.js --liste    → montre ce qui serait extrait
//
// ── Pourquoi des SCÉNARIOS et pas des images aplaties ──
//
// Les autres portages (Frutisnake, Swapou…) aplatissent chaque image de chaque
// clip en un SVG : ça suffit quand le jeu ne fait que choisir une image
// (gotoAndStop). Kaluga, lui, PILOTE ses clips : la tzongre bat des ailes
// (a1.a.play()), cligne des yeux (yeux.play()), la grenouille se tourne
// (turn() appelé DEPUIS une image du clip), la porte de la carte s'ouvre sur
// une image que le jeu guette (map.bg.animPorte._currentframe > 70), les
// portraits du menu bouclent sur deux images jusqu'à ce qu'on leur dise de
// partir (flGoAway). Aplatir figerait tout cela. On sort donc les scénarios
// eux-mêmes — image par image, ce que Flash pose, retire, déplace — et un
// petit moteur de liste d'affichage (public/kaluga/moteur/) les rejoue comme
// le lecteur Flash le faisait.
//
// ── Les fichiers d'origine ──
//
// Games/kaluga/full.swf est OBFUSQUÉ (Obfu, clé « coucou » — cf. swfmake.xml)
// et ne sert à rien ici. Il est bâti sur Games/kaluga/kaluga.swf, la base
// NON obfusquée : tous les noms d'auteur y sont en clair (spPhysTzongre,
// console, startPanel, sBonus…), et les scripts d'image sont intacts. C'est
// elle qu'on lit, avec les cartes (map/*.swf, chargées par loadClip dans
// map.bg) et l'animation de fin (anim/credits/credits.swf).
//
// ── Ce que contient chaque data/<nom>.json ──
//
//   entete     { l, h, cadence, images, fond }
//   symboles   { nomDeLiaison: idDeCaractère }
//   perso      { id: { t: 'forme', b, ops, m? }          un dessin (swf-formes)
//                    { t: 'clip', n, frames: [ { lab?, a?, ops: [...] } ] }
//                    { t: 'texte', ... }                   un DefineEditText
//                    { t: 'bouton', rec: [...], a? } }
//   fontes     { id: { nom, gras, nb, asc, desc, lead, fichier? } }
//   images     { id: { f, l, h } }
//
// Un `ops` d'image est la liste EXACTE des PlaceObject/RemoveObject de cette
// image : { p: profondeur, c?: caractère, m?: matrice, cx?: couleurs, r?: taux
// de morph, n?: nom d'instance, k?: profondeur de masque, mv?: 1 si c'est un
// déplacement } ou { x: profondeur }. Les morphs sont cuits au taux de chaque
// placement (perso « 310_8192 ») : un morph placé est un dessin comme un autre.
//
// Les scripts d'image (DoAction) ne sont pas traduits ici : ils sont peu
// nombreux et courts (stop(), gotoAndPlay, un appel à _parent.xxx()), et
// public/kaluga/moteur/scripts-images.js les porte à la main, sous la clé
// « <nom>:<sprite>:<image> » que ce fichier pose dans `a`.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { lireSwf } = require('./lib/swf-sprites.js');
const { lireMorphs } = require('./lib/swf-morph.js');
const { lireTextes } = require('./lib/swf-texte.js');
const F = require('./lib/swf-formes.js');

const RACINE = path.join(__dirname, '..');
const DOSSIER = path.join(RACINE, 'Games/kaluga');
const SORTIE = path.join(RACINE, 'public/kaluga');
const LISTE_SEULE = process.argv.includes('--liste');

const SWFS = [
  { nom: 'kaluga', fichier: 'kaluga.swf', sons: true, fontes: true },
  { nom: 'challenge', fichier: 'map/challenge.swf' },
  { nom: 'forest', fichier: 'map/forest.swf' },
  { nom: 'field', fichier: 'map/field.swf' },
  { nom: 'mordor', fichier: 'map/mordor.swf' },
  { nom: 'olympic_a', fichier: 'map/olympic_a.swf' },
  { nom: 'squirrel', fichier: 'map/squirrel.swf' },
  { nom: 'dawn', fichier: 'map/dawn.swf' },
  { nom: 'credits', fichier: 'anim/credits/credits.swf', sons: true, fontes: true },
];

// ── Lecture d'un SWF : tags avec sprite et image ──────────────────────────
function lireEntete(b) {
  const r = new F.Bits(b, 0);
  const n = r.u(5);
  const x0 = r.s(n), x1 = r.s(n), y0 = r.s(n), y1 = r.s(n);
  r.align();
  const o = r.o;
  return { l: (x1 - x0) / 20, h: (y1 - y0) / 20, cadence: b.readUInt16LE(o) / 256, images: b.readUInt16LE(o + 2), debut: o + 4 };
}

function parcourir(b, debut, visiter) {
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
      if (code === 1) frame++;
      o += hs + len;
    }
  })(debut, b.length, 0);
}

function chaine(b, o) {
  let e = o; while (e < b.length && b[e] !== 0) e++;
  return { texte: b.slice(o, e).toString('utf8'), fin: e + 1 };
}

// CXFORMWITHALPHA → [mr, mg, mb, ma, ar, ag, ab, aa] (mult sur 256, add sur 255).
function lireCouleurs(m, alpha) {
  const add = m.u(1), mult = m.u(1), n = m.u(4);
  const c = [256, 256, 256, 256, 0, 0, 0, 0];
  if (mult) { c[0] = m.s(n); c[1] = m.s(n); c[2] = m.s(n); if (alpha) c[3] = m.s(n); }
  if (add) { c[4] = m.s(n); c[5] = m.s(n); c[6] = m.s(n); if (alpha) c[7] = m.s(n); }
  m.align();
  return c;
}
const couleursNeutres = (c) => c[0] === 256 && c[1] === 256 && c[2] === 256 && c[3] === 256 && !c[4] && !c[5] && !c[6] && !c[7];

// ── Les placements d'une image ────────────────────────────────────────────
function lirePlacement(b, code, corps) {
  if (code === 4) {                       // PlaceObject
    const c = b.readUInt16LE(corps), p = b.readUInt16LE(corps + 2);
    const bits = new F.Bits(b, corps + 4);
    const M = F.lireMatriceBits(bits);
    return { p, c, m: F.matricePx(M) };
  }
  const flags = b[corps];
  let o = corps + 1;
  let flags2 = 0;
  if (code === 70) { flags2 = b[corps + 1]; o += 1; }
  const op = { p: b.readUInt16LE(o) }; o += 2;
  if (flags & 1) op.mv = 1;
  if (code === 70 && (flags2 & 0x08)) o = chaine(b, o).fin;    // HasClassName
  if (flags & 2) { op.c = b.readUInt16LE(o); o += 2; }
  const bits = new F.Bits(b, o);
  if (flags & 4) op.m = F.matricePx(F.lireMatriceBits(bits));
  if (flags & 8) { const cx = lireCouleurs(bits, true); if (!couleursNeutres(cx)) op.cx = cx; else op.cx = null; }
  o = bits.align();
  if (flags & 16) { op.r = b.readUInt16LE(o); o += 2; }
  if (flags & 32) { const r = chaine(b, o); op.n = r.texte; o = r.fin; }
  if (flags & 64) { op.k = b.readUInt16LE(o); o += 2; }
  return op;
}

// ── DefineButton2 ─────────────────────────────────────────────────────────
function lireBouton(b, corps, len) {
  const id = b.readUInt16LE(corps);
  const actionOffset = b.readUInt16LE(corps + 3);
  let o = corps + 5;
  const rec = [];
  for (;;) {
    const fl = b[o];
    if (!fl) { o += 1; break; }
    const r = { e: fl & 15, c: b.readUInt16LE(o + 1), p: b.readUInt16LE(o + 3) };
    const bits = new F.Bits(b, o + 5);
    r.m = F.matricePx(F.lireMatriceBits(bits));
    const cx = lireCouleurs(bits, true);
    if (!couleursNeutres(cx)) r.cx = cx;
    o = bits.align();
    if (fl & 0x10) throw new Error('bouton à filtres');
    if (fl & 0x20) o += 1;
    rec.push(r);
  }
  return { id, rec, actions: actionOffset > 0 };
}

// ── DefineFont2 : nom et métriques ────────────────────────────────────────
function lireFonte(b, corps) {
  const id = b.readUInt16LE(corps);
  const flags = b[corps + 2];
  const larges = !!(flags & 0x08), codesLarges = !!(flags & 0x04);
  const lg = b[corps + 4];
  const nom = b.slice(corps + 5, corps + 5 + lg).toString('latin1').replace(/\0+$/, '');
  let o = corps + 5 + lg;
  const nb = b.readUInt16LE(o); o += 2;
  const f = { id, nom, gras: !!(flags & 0x01), italique: !!(flags & 0x02), nb };
  if (nb) {
    const base = o;
    const finTable = larges ? b.readUInt32LE(base + nb * 4) : b.readUInt16LE(base + nb * 2);
    o = base + finTable + nb * (codesLarges ? 2 : 1);
  }
  if (flags & 0x80) {                     // HasLayout
    f.asc = b.readInt16LE(o) / 1024; f.desc = b.readInt16LE(o + 2) / 1024; f.lead = b.readInt16LE(o + 4) / 1024;
  }
  return f;
}

// ── Un SWF ────────────────────────────────────────────────────────────────
function extraire(spec) {
  const chemin = path.join(DOSSIER, spec.fichier);
  const b = lireSwf(chemin);
  const entete = lireEntete(b);
  const sortie = { entete: { l: entete.l, h: entete.h, cadence: entete.cadence, images: entete.images, fond: '#ffffff' },
    symboles: {}, perso: {}, fontes: {}, images: {} };
  const clips = new Map();              // id → { n, frames: [] }
  const frameDe = (id, frame) => {
    if (!clips.has(id)) clips.set(id, { n: 0, frames: [] });
    const c = clips.get(id);
    while (c.frames.length < frame) c.frames.push({ ops: [] });
    return c.frames[frame - 1];
  };
  const formesTags = [], textesFiges = new Set(), boutons = [], imagesIds = [], sonsIds = [];
  const ratiosParMorph = new Map();     // id → Set(ratio)
  const morphIds = new Set();
  const compteScripts = {};

  parcourir(b, entete.debut, (code, corps, len, sprite, frame) => {
    switch (code) {
      case 9: sortie.entete.fond = '#' + [b[corps], b[corps + 1], b[corps + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''); break;
      case 56: {                          // ExportAssets
        const n = b.readUInt16LE(corps); let p = corps + 2;
        for (let i = 0; i < n; i++) { const id = b.readUInt16LE(p); const r = chaine(b, p + 2); sortie.symboles[r.texte] = id; p = r.fin; }
        break;
      }
      case 1: frameDe(sprite, frame); clips.get(sprite).n = Math.max(clips.get(sprite).n, frame); break;
      case 43: frameDe(sprite, frame).lab = chaine(b, corps).texte; break;
      case 12: {
        frameDe(sprite, frame).a = `${spec.nom}:${sprite}:${frame}`;
        compteScripts[`${sprite}:${frame}`] = len;
        break;
      }
      case 4: case 26: case 70: {
        const op = lirePlacement(b, code, corps);
        if (op.r !== undefined && op.c !== undefined) {
          if (!ratiosParMorph.has(op.c)) ratiosParMorph.set(op.c, new Set());
          ratiosParMorph.get(op.c).add(op.r);
        }
        frameDe(sprite, frame).ops.push(op);
        break;
      }
      case 5: frameDe(sprite, frame).ops.push({ x: b.readUInt16LE(corps + 2) }); break;
      case 28: frameDe(sprite, frame).ops.push({ x: b.readUInt16LE(corps) }); break;
      case 39: frameDe(b.readUInt16LE(corps), 1); break;
      case 2: case 22: case 32: case 83: formesTags.push({ code, corps }); break;
      case 11: case 33: textesFiges.add(b.readUInt16LE(corps)); break;
      case 45: case 46: morphIds.add(b.readUInt16LE(corps)); break;
      case 34: boutons.push(lireBouton(b, corps, len)); break;
      case 7: throw new Error('DefineButton (v1) non géré');
      case 6: case 20: case 21: case 35: case 36: case 90: imagesIds.push(b.readUInt16LE(corps)); break;
      case 14: sonsIds.push(b.readUInt16LE(corps)); break;
      case 48: { const f = lireFonte(b, corps); sortie.fontes[f.id] = f; break; }
      case 15: console.warn(`  ! StartSound dans sprite#${sprite} image ${frame} (non rejoué)`); break;
      default: break;
    }
  });

  // Les clips (la racine comprise, sous 0).
  for (const [id, c] of clips) {
    if (!c.frames.length) c.frames.push({ ops: [] });
    c.n = Math.max(c.n, c.frames.length);
    // Une image sans ShowFrame final (dernier tag = placement) compte quand même.
    sortie.perso[id] = { t: 'clip', n: c.n, frames: c.frames.slice(0, c.n).map((f) => {
      const r = { ops: f.ops };
      if (f.lab) r.lab = f.lab;
      if (f.a) r.a = f.a;
      return r;
    }) };
  }

  // Les formes.
  let nFormes = 0, nErreurs = 0;
  for (const t of formesTags) {
    try {
      const d = F.dessinForme(b, t);
      sortie.perso[d.id] = { t: 'forme', b: d.b, ops: d.ops };
      nFormes++;
    } catch (e) {
      nErreurs++;
      console.warn(`  ! forme #${b.readUInt16LE(t.corps)} illisible : ${e.message}`);
    }
  }

  // Les morphs, cuits à chaque taux posé (et à 0 par défaut).
  const morphs = lireMorphs(chemin);
  let nMorphs = 0;
  for (const id of morphIds) {
    const m = morphs.get(id);
    if (!m) { console.warn(`  ! morph #${id} illisible`); continue; }
    const taux = new Set(ratiosParMorph.get(id) || []);
    taux.add(0);
    for (const r of taux) {
      const d = F.dessinMorph(m, r / 65535);
      sortie.perso[`${id}_${r}`] = { t: 'forme', b: d.b, ops: d.ops };
      nMorphs++;
    }
    sortie.perso[id] = { t: 'morph', taux: [...taux].sort((x, y) => x - y) };
  }

  // Les textes figés (glyphes) et les champs.
  const T = lireTextes({ b, parcourir: (v) => parcourir(b, entete.debut, v) });
  let nTextes = 0;
  for (const id of textesFiges) {
    const t = T.statiques.get(id);
    if (!t) continue;
    const d = F.dessinTexte(t, T.fontes);
    const p = { t: 'forme', b: d.b, ops: d.ops };
    if (d.m) p.m = d.m;
    sortie.perso[id] = p;
    nTextes++;
  }
  for (const [id, t] of T.dynamiques) {
    sortie.perso[id] = { t: 'texte', r: [F.arr(t.rect.x), F.arr(t.rect.y), F.arr(t.rect.w), F.arr(t.rect.h)],
      fonte: t.fonte, taille: t.taille, couleur: t.couleur, alpha: F.arr5(t.alpha), align: t.align,
      inter: t.interligne || 0, mg: t.margeG || 0, md: t.margeD || 0, ret: t.retrait || 0,
      wrap: t.wrap ? 1 : 0, multi: t.multiligne ? 1 : 0, auto: t.autoTaille ? 1 : 0, html: t.html ? 1 : 0,
      emb: t.embarquee ? 1 : 0, variable: t.variable || '', texte: t.texte || '' };
  }

  // Les boutons.
  for (const bt of boutons) {
    const p = { t: 'bouton', rec: bt.rec };
    if (bt.actions) p.a = `${spec.nom}:btn:${bt.id}`;
    sortie.perso[bt.id] = p;
  }

  // Les images, par l'extracteur commun (un JPEG à alpha sort en SVG autonome).
  const dossierImg = path.join(SORTIE, 'data', 'img');
  if (imagesIds.length && !LISTE_SEULE) {
    fs.mkdirSync(dossierImg, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kaluga-img-'));
    const liste = execFileSync('node', [path.join(__dirname, 'extract-swf-bitmaps.js'), chemin], { encoding: 'utf8' });
    const tailles = {};
    for (const l of liste.split('\n')) {
      const m = /^#(\d+)\s+\S+\s+(\d+)x(\d+)/.exec(l);
      if (m) tailles[m[1]] = { l: +m[2], h: +m[3] };
    }
    execFileSync('node', [path.join(__dirname, 'extract-swf-bitmaps.js'), chemin, tmp, ...imagesIds.map(String)], { stdio: 'pipe' });
    for (const f of fs.readdirSync(tmp)) {
      const m = /^bitmap(\d+)\.(\w+)$/.exec(f);
      if (!m) continue;
      const nom = `${spec.nom}-${m[1]}.${m[2]}`;
      fs.copyFileSync(path.join(tmp, f), path.join(dossierImg, nom));
      sortie.images[m[1]] = Object.assign({ f: nom }, tailles[m[1]] || {});
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Les sons, nommés par leur nom d'auteur.
  if (spec.sons && sonsIds.length && !LISTE_SEULE) {
    const dossierSons = path.join(SORTIE, 'sons');
    fs.mkdirSync(dossierSons, { recursive: true });
    execFileSync('node', [path.join(__dirname, 'extract-swf-sounds.js'), chemin, dossierSons, ...sonsIds.map(String)], { stdio: 'pipe' });
  }

  // Les fontes embarquées, en WOFF ; celles sans glyphe sont des fontes
  // SYSTÈME (Flash écrivait avec la Verdana de la machine) : rien à sortir,
  // le moteur leur donne une pile CSS.
  if (spec.fontes && !LISTE_SEULE) {
    const dossierFontes = path.join(SORTIE, 'fontes');
    fs.mkdirSync(dossierFontes, { recursive: true });
    for (const f of Object.values(sortie.fontes)) {
      if (!f.nb) continue;
      const fichier = `${spec.nom}-${f.id}.woff`;
      execFileSync('node', [path.join(__dirname, 'extract-swf-font.js'), chemin, String(f.id),
        path.join(dossierFontes, fichier), `Kaluga ${f.id}`], { stdio: 'pipe' });
      f.fichier = fichier;
    }
  }

  const resume = `${spec.nom}: ${clips.size} clips, ${nFormes} formes (${nErreurs} illisibles), ${nMorphs} morphs cuits, `
    + `${nTextes} textes figés, ${T.dynamiques.size} champs, ${boutons.length} boutons, ${imagesIds.length} images, `
    + `${sonsIds.length} sons, ${Object.keys(sortie.fontes).length} fontes, ${Object.keys(compteScripts).length} scripts d'image`;
  console.log(resume);
  if (LISTE_SEULE) {
    console.log('  scripts :', Object.entries(compteScripts).map(([k, v]) => `${k}(${v}o)`).join(' '));
    return;
  }
  fs.mkdirSync(path.join(SORTIE, 'data'), { recursive: true });
  const json = JSON.stringify(sortie);
  fs.writeFileSync(path.join(SORTIE, 'data', spec.nom + '.json'), json);
  console.log(`  → data/${spec.nom}.json (${Math.round(json.length / 1024)} ko)`);
}

for (const spec of SWFS) {
  try { extraire(spec); } catch (e) { console.error(`!! ${spec.nom} : ${e.stack}`); process.exitCode = 1; }
}
