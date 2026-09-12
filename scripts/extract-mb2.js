#!/usr/bin/env node
// Sort TOUT ce que le portage natif de MotionBall rejoue : les scénarios des
// clips, les dessins, les textes, les images, les sons et les fontes.
//
//   node scripts/extract-mb2.js            → écrit public/mb2/data/, sons/, fontes/
//   node scripts/extract-mb2.js --liste    → montre ce qui serait extrait
//
// Le mécanisme est celui de scripts/extract-kaluga.js (scénarios rejoués par
// le lecteur de public/kaluga/moteur/, et non des images aplaties) ; ce qui
// change ici, c'est le SWF lui-même.
//
// ── Un SWF OBFUSQUÉ ──
//
// Games/motionBall2/motionball.swf est passé par Obfu (OBFUSC.bat) : les
// identifiants — champs, méthodes, NOMS DE LIAISON des symboles et des sons —
// sont remplacés par des chaînes de signes (« 5{3+"?# »), avec un dictionnaire
// UNIQUE : le même nom donne partout la même chaîne. Les sources AS2
// (Games/motionBall2/mb2/*.as) parlent, elles, en clair : « bmagnet »,
// « tourneboule », « wall_bump »… Pour que le portage attache les clips par
// leur nom d'auteur, ce fichier porte le DICTIONNAIRE inverse, établi en
// alignant les constantes poussées par le bytecode (dans l'ordre de
// compilation, qui est celui du source) sur les littéraux des .as, et vérifié
// par la structure des clips (étiquettes d'images, enfants nommés) :
// « bmagnet » a bien deux étiquettes plus/neg, « bdeath » ses six billes
// b0…b5, « exit » ses close/anim_open/open, la « tourneboule » ses six katas.
// Les noms que l'obfuscateur avait laissés (hit, round, item, pause, border,
// background, press start, time counter, menu balls, boss tir, boss shade,
// ball icon, icon grelot, loop$1…5, kata1…3, hide) restent tels quels.
//
// ── Ce que contient data/mb2.json ──
//
//   entete     { l, h, cadence, images, fond }
//   symboles   { nomDeLiaison: idDeCaractère }     — noms d'AUTEUR
//   perso      { id: { t: 'forme', b, ops, m? }          un dessin (swf-formes)
//                    { t: 'clip', n, frames: [ { lab?, a?, ops: [...] } ] }
//                    { t: 'texte', ... }                   un DefineEditText
//                    { t: 'bouton', rec: [...], a? } }
//   fontes     { id: { nom, gras, nb, asc, desc, lead, fichier? } }
//   images     { id: { f, l, h } }
//
// Les scripts d'image (DoAction dans les sprites) ne sont pas traduits ici :
// public/mb2/jeu/scripts-images.js les porte à la main, sous la clé
// « mb2:<sprite>:<image> » que ce fichier pose dans `a`.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { lireSwf } = require('./lib/swf-sprites.js');
const { lireMorphs } = require('./lib/swf-morph.js');
const { lireTextes } = require('./lib/swf-texte.js');
const F = require('./lib/swf-formes.js');

const RACINE = path.join(__dirname, '..');
const DOSSIER = path.join(RACINE, 'Games/motionBall2');
const SORTIE = path.join(RACINE, 'public/mb2');
const LISTE_SEULE = process.argv.includes('--liste');

const SWFS = [{ nom: 'mb2', fichier: 'motionball.swf', sons: true, fontes: true }];

// ── Le dictionnaire : nom obfusqué → nom d'auteur ─────────────────────────
// Les clips (attachMovie / DepthManager.attach dans les sources AS2).
const NOMS_CLIPS = {
  '{1]7=4"': 'fissure',        // Intro : les vingt éclats autour du « 2 »
  '[196': 'deux',              // Intro : le « 2 » du titre
  '?3@8"#': 'light',           // Ball : le reflet posé sur la bille
  '82!1\'5!': 'marble',        // Ball : la bille (une image par couleur)
  '*18489"': 'ballbox',        // Level : la boîte d\'une nouvelle bille (aura, ball ; « hit »)
  '!&"6]#': 'ombre',           // Level : l\'ombre d\'un bumper (une image par type)
  '2$*-^3#': 'loading',        // Loader : l\'écran de chargement (chargement.txt, progress)
  '%=$-1\'"': 'fondMenu',      // Menu : le fond et son trou (hole)
  '= |))="': 'intro_bg',       // Intro : le fond
  '[-|& 7"': 'interred',       // Level : le bloc rouge de l\'interrupteur
  '0}0&)7!': 'flashLine',      // Collide : l\'éclair entre deux zappers
  ' ^!56=#': 'panGameOver',    // GameOver/Text/Aide : le panneau (gameOver, victory, texte, records, aide, error)
  '8]^5#%': 'title',           // Intro : une lettre du titre (et le titre des boules du menu)
  '#1]="': 'room',             // Pause : une case de la carte
  '0-{3?': 'carte',            // Pause : la carte (grille)
  '?657': 'door',              // Interf : une porte (porteA, porteB)
  '^-8?$5"': 'TBSpawn',        // BossTB : l\'apparition de la Tourneboule
  ')529 5"': 'TBShadow',       // BossTB : son ombre (mêmes katas)
  '1=?5+@#': 'TBVanish',       // BossTB : sa disparition
  '1&[*8-#': 'FXDalleCut',     // BossTB : une dalle qui se découpe
  '7$#9*-#': 'FXbourgeon',     // BossPowTerre : le bourgeon (explode, death)
  '$2^8{|!': 'snakePart',      // BossSerpent : une écaille projetée
  '2?7#-3"': 'FXWaterQueue',   // BossPowEau : la traînée d\'eau derrière la bille
  ')!-&|{!': 'maskHole',       // Collide : le masque de la sortie (classique)
  ')8{!7|': 'tourneboule',     // BossTB : la Tourneboule (katas, vol, mort)
  '834)#!': 'forceBubble',     // BossTB : la bulle de force
  '#\'81!(!': 'logoBg',        // BossSerpent : le logo de l\'élément au sol
  '@3!6\'}#': 'FXWaterParticule',
  '?93^^9': 'FXWater',         // BossPowEau : la boule d\'eau
  '8[][$7': 'FXLiane',         // BossPowTerre : un maillon de liane (liane, feuille)
  '865^9""': 'FXFire',         // BossPowFeu : la flamme (loop)
  '74(1@""': 'FXWind',         // BossPowVent : une volute
  ']@=%^$': 'snake',           // BossSerpent : un anneau du serpent (gfx, crane, o1, o2)
  '87]6 !': 'dalle',           // Boss : une dalle qui se referme (destroy)
  '@ +^  "': 'bossParticule',  // Boss : une particule de sa mort
  '7"9{((!': 'checkpoint',     // Level (course) : un point de passage (off, hit, on)
  '59%[': 'exit',              // Level (classique) : la sortie (close, anim_open, open)
  '-[8]6|': 'bteleport',       // Level : le téléporteur (c0)
  '6""+)?!': 'interblue',      // Level : le bloc bleu de l\'interrupteur
  '(4\'\' 7"': 'interupt',     // Level : l\'interrupteur
  '3{3@#$#': 'zapper',         // Level : un zapper (reflet)
  '!)}*': 'boss',              // Boss : le poulpe (b, oeil, souffle, p1, p2)
  '[36!': 'red',               // Level : un bonus rouge
  '5* [30': 'itembox',         // Level : la boîte d\'un objet (item ; hit, opened)
  '$9^$$8': 'wallpart',        // Collide : un éclat de mur vert
  '7*"40$#': 'ground',         // Interf : le sol des trous (masqué par holes)
  ' )71#': 'wall',             // Level : un mur vert (seize raccords)
  ')?^4{+"': 'bshadow',        // Level : le bumper invisible
  '5{3+"?#': 'bmagnet',        // Level : le bumper magnétique (plus, neg)
  '^3*}-^': 'bdeath',          // Level : le bumper de la mort (b0…b5)
  '\'*{\'6': 'btime',          // Level : le bumper du temps (aig, aig2)
  '90@0+)': 'bnormal',         // Level : le bumper normal
  '%2[#{$': 'stone',           // Ball : un grain dans la bille (eclat)
  ')76 !&': 'shadow',          // Ball : l\'ombre de la bille
  '#8*(90': 'cadreInfo',       // Menu : le cadre d\'information d\'un mode
  '6[9*': 'blue',              // Level : un bonus bleu
};
// Les sons (mb2.Sound, dans l\'ordre de ses constantes).
const NOMS_SONS = {
  '$%+2#': 'wind', '?6{9[%': 'water', '")74{': 'wall_bump', '3]!)-*"': 'sound_zapper', '*]-530': 'touched',
  '^1]18"': 'sound_bdeath', '&}=27*"': 'sound_grelot', '8#@=-&"': 'eye_new', '}42': 'eye', '7 +52?!': 'object_found',
  '{%66#%"': 'sound_poulpe', '[+650*!': 'menu_select', '3+8&=@"': 'menu_enter', '8!||!': 'menu', '3{17+|': 'game_over',
  ']"!9?)"': 'sound_casse', '3{^=(!': 'earth', '7{5)&|': 'door_open', '[}\'"@&': 'bumper_metal', '|=+3|$"': 'sound_boss_saut',
  '&-?9{[': 'boss_loop', '^41-?&#': 'bonus_blip3', ']41-?&#': 'bonus_blip2', '&@9)-+"': 'bonus_blip',
};
const NOMS = Object.assign({}, NOMS_CLIPS, NOMS_SONS);
const nomAuteur = (n) => (Object.prototype.hasOwnProperty.call(NOMS, n) ? NOMS[n] : n);

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
  const nomsSons = {};                  // id → nom d'auteur
  const nomsObfusques = [];             // les liaisons restées inconnues du dictionnaire

  parcourir(b, entete.debut, (code, corps, len, sprite, frame) => {
    switch (code) {
      case 9: sortie.entete.fond = '#' + [b[corps], b[corps + 1], b[corps + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''); break;
      case 56: {                          // ExportAssets
        const n = b.readUInt16LE(corps); let p = corps + 2;
        for (let i = 0; i < n; i++) {
          const id = b.readUInt16LE(p); const r = chaine(b, p + 2); p = r.fin;
          const nom = nomAuteur(r.texte);
          if (nom === r.texte && /[^\w$ .]/.test(r.texte) && !/^__Packages/.test(r.texte)) nomsObfusques.push(`${r.texte}#${id}`);
          if (/^__Packages\./.test(nom)) break;   // les classes : rien à rejouer
          sortie.symboles[nom] = id;
          nomsSons[id] = nom;
        }
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

  // Les clips (la racine comprise, sous 0). Les sprites des classes
  // (DoInitAction seuls, sans image) ne sont pas des dessins : on les saute.
  for (const [id, c] of clips) {
    if (!c.frames.length) c.frames.push({ ops: [] });
    c.n = Math.max(c.n, c.frames.length);
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
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mb2-img-'));
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

  // Les sons : l'extracteur commun les nomme par leur nom de liaison — ici
  // obfusqué —, on les renomme par le dictionnaire (sons/<nom d'auteur>.mp3).
  if (spec.sons && sonsIds.length && !LISTE_SEULE) {
    const dossierSons = path.join(SORTIE, 'sons');
    fs.mkdirSync(dossierSons, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mb2-sons-'));
    execFileSync('node', [path.join(__dirname, 'extract-swf-sounds.js'), chemin, tmp, ...sonsIds.map(String)], { stdio: 'pipe' });
    const liste = execFileSync('node', [path.join(__dirname, 'extract-swf-sounds.js'), chemin], { encoding: 'utf8' });
    for (const l of liste.split('\n')) {
      const m = /^#(\d+)\t(.*?)\s*\t/.exec(l);
      if (!m) continue;
      const id = +m[1], brut = m[2].trim();
      const nom = nomsSons[id] || nomAuteur(brut);
      const fichier = fs.readdirSync(tmp).find((f) => f.startsWith(brut + '.'));
      if (!fichier) { console.warn(`  ! son #${id} (${brut}) introuvable`); continue; }
      fs.copyFileSync(path.join(tmp, fichier), path.join(dossierSons, nom + path.extname(fichier)));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Les fontes embarquées, en WOFF ; celles sans glyphe sont des fontes
  // SYSTÈME : rien à sortir, le moteur leur donne une pile CSS. La famille
  // garde le préfixe « Kaluga » : c'est celui que le moteur partagé déclare.
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
  if (nomsObfusques.length) console.log('  liaisons hors dictionnaire :', nomsObfusques.join(' '));
  if (LISTE_SEULE) {
    console.log('  symboles :', Object.entries(sortie.symboles).map(([n, id]) => `${n}#${id}`).join(' '));
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
