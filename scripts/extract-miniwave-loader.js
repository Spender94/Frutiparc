#!/usr/bin/env node
// Sort l'écran de chargement d'origine de Miniwave 2 (loader_miniwave.swf) :
// le CADRE du disque (mb2Frame, deux images de tuiles bitmap) et le LOGO
// frusion, tel qu'il se pose à la fin de son animation d'intro. C'est cet
// écran — fond blanc, cadre, logo au centre, pourcentage — que montrait le
// disque Frutiparc pendant le téléchargement du jeu.
//
//   node scripts/extract-miniwave-loader.js   → écrit public/miniwave/loader/

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'Games/miniWave2/loader_miniwave.swf');
const SORTIE = path.join(RACINE, 'public/miniwave/loader');

const { ouvrir } = require('./lib/swf-sprites.js');
const swf = ouvrir(SWF);
const { noms, parSprite, aplatir } = swf;

// forme → { images, taille, origine } via l'inventaire d'extract-swf-shapes.
function tableFormes() {
  const brut = execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), SWF], { cwd: RACINE, encoding: 'utf8', maxBuffer: 64e6 });
  const t = new Map();
  for (const ligne of brut.split('\n')) {
    const m = /^#(\d+)\t\S+\t(\S+)\t(.*)$/.exec(ligne);
    if (!m) continue;
    const images = [...m[3].matchAll(/bitmap#(\d+)/g)]
      .map((x) => Number(x[1])).filter((id) => id !== 65535);
    const [w, h] = m[2].split('x').map(Number);
    const o = /\t@(-?[\d.]+),(-?[\d.]+)\s*$/.exec(m[3]);
    t.set(Number(m[1]), { images, w, h, x0: o ? Number(o[1]) : -w / 2, y0: o ? Number(o[2]) : -h / 2 });
  }
  return t;
}

function principal() {
  const manifeste = {};
  const formes = new Set();

  // Le cadre : ses deux images (la seconde est l'état « chargé »).
  const cadreId = noms.get('mb2Frame');
  // Le logo frusion : on fige le PALIER de son animation — l'état stable
  // qu'elle tient pendant tout le téléchargement (l'atome, le bandeau, la
  // virgule). Les dernières images ne sont que le fondu blanc de sortie.
  const frusionId = noms.get('frusion');
  const logoPlaces = parSprite.get(44) ? 44 : frusionId;

  const entrees = [
    { cle: 'cadre', id: cadreId },
    { cle: 'logo', id: logoPlaces, frame: 130 },
  ];
  for (const e of entrees) {
    if (e.id === undefined) continue;
    const frames = parSprite.get(e.id);
    if (!frames) continue;
    const etats = [];
    const cibles = e.frame ? [e.frame] : [...frames.keys()].sort((a, b) => a - b);
    for (const f of cibles) {
      if (!frames.has(f)) continue;
      const pieces = [];
      for (const p of frames.get(f)) pieces.push(...aplatir(p.ch, p.M, 0, f, '', p.cx));
      if (!pieces.length) continue;
      for (const pc of pieces) formes.add(pc.shape);
      etats.push({ frame: f, pieces });
    }
    if (etats.length) manifeste[e.cle] = { etats };
  }

  fs.mkdirSync(SORTIE, { recursive: true });
  const infos = tableFormes();
  const imagesVoulues = new Set(), tracesVoulus = new Set();
  for (const f of formes) {
    const info = infos.get(f);
    if (info && info.images.length === 1) imagesVoulues.add(info.images[0]);
    else tracesVoulus.add(f);
  }

  const ecrites = new Map();
  if (imagesVoulues.size) {
    const brut = execFileSync(process.execPath,
      [path.join(__dirname, 'extract-swf-bitmaps.js'), SWF, SORTIE, ...[...imagesVoulues].map(String)],
      { cwd: RACINE, encoding: 'utf8', maxBuffer: 64e6 });
    for (const m of brut.matchAll(/^#(\d+) → \S*?([^/\s]+\.(?:png|svg|jpg|gif))/gm)) ecrites.set('img' + m[1], m[2]);
  }
  if (tracesVoulus.size) {
    const brut = execFileSync(process.execPath,
      [path.join(__dirname, 'extract-swf-shapes.js'), SWF, SORTIE, ...[...tracesVoulus].map(String)],
      { cwd: RACINE, encoding: 'utf8', maxBuffer: 64e6 });
    for (const m of brut.matchAll(/^#(\d+) → \S*?([^/\s]+\.svg)/gm)) ecrites.set('shp' + m[1], m[2]);
  }

  for (const m of Object.values(manifeste)) {
    m.etats = m.etats.map((e) => {
      const pieces = [];
      for (const pc of e.pieces) {
        const info = infos.get(pc.shape);
        const k = (info && info.images.length === 1) ? 'img' + info.images[0] : 'shp' + pc.shape;
        const fichier = ecrites.get(k);
        if (!fichier) continue;
        const piece = {
          fichier,
          w: info ? info.w : 0,
          h: info ? info.h : 0,
          m: [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20].map((v) => Math.round(v * 1e4) / 1e4),
        };
        if (info && (Math.abs(info.x0 + info.w / 2) > 0.5 || Math.abs(info.y0 + info.h / 2) > 0.5)) {
          piece.o = [Math.round(info.x0 * 100) / 100, Math.round(info.y0 * 100) / 100];
        }
        if (pc.cx) {
          piece.cx = {
            m: [pc.cx.mr, pc.cx.mv, pc.cx.mb, pc.cx.ma].map((v) => Math.round(v)),
            a: [pc.cx.ar, pc.cx.av, pc.cx.ab, pc.cx.aa].map((v) => Math.round(v)),
          };
        }
        pieces.push(piece);
      }
      return pieces.length ? { frame: e.frame, pieces } : null;
    }).filter(Boolean);
  }

  const dest = path.join(SORTIE, 'loader.json');
  fs.writeFileSync(dest, JSON.stringify(manifeste), 'utf8');
  const n = Object.values(manifeste).reduce((s, m) => s + m.etats.length, 0);
  console.log(`→ ${path.relative(RACINE, dest)} (${Object.keys(manifeste).length} éléments, ${n} états)`);
}

principal();
