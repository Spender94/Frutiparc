#!/usr/bin/env node
// Sort les dessins de Miniwave 2 du SWF, en SVG, pour le portage natif.
//
//   node scripts/extract-miniwave-sprites.js            → écrit public/miniwave/sprites/
//   node scripts/extract-miniwave-sprites.js --liste    → montre ce qui serait extrait
//
// Le jeu range chaque vaisseau dans un DefineSprite NOMMÉ (miniWave2SpBadsFraise,
// miniWave2SpHeroTequila…) dont chaque IMAGE pose une forme différente : c'est
// ainsi qu'il montre les états de coque (l'Orangeonaute frappé une fois passe à
// l'image 2) et les aspects de projectile, choisis par gotoAndStop.
//
// Point important : les fruits ne sont PAS dessinés en vecteur. Chaque forme
// n'est qu'un rectangle rempli d'une image — les mêmes PNG que ceux restés dans
// Games/miniWave2/bitmap/ship. On récupère donc l'IMAGE, pas le tracé : c'est
// plus fidèle (aucune reconversion) et bien plus léger. Les projectiles, eux,
// sont de vrais tracés : ils sortent en SVG.
//
// Le manifeste (sprites.json) dit ensuite au client quel fichier correspond à
// quel état, avec la matrice de placement quand le dessin est composé (le boss
// est fait d'une coque, d'un casque, de deux mains et d'une orange).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'Games/miniWave2/miniwave.swf');
const SORTIE = path.join(RACINE, 'public/miniwave/sprites');

const { ouvrir } = require('./lib/swf-sprites.js');

// La lecture du SWF — parcours des tags, noms d'auteur, liste d'affichage image
// par image et aplatissement des clips imbriqués — est commune aux extracteurs
// de jeux : elle vit dans scripts/lib/swf-sprites.js.
const swf = ouvrir(SWF);
const { b, noms, parSprite, aplatir } = swf;

// L'ordre du bestiaire : index de type → nom du symbole. Il vient de
// badsInfo.as, et c'est LUI qui compte — les niveaux désignent les ennemis par
// cet index, pas par leur nom.
const BADS = [
  'Fraise', 'Orange', 'Banane', 'Clementine', 'Citron', 'Cerise', 'Radis', 'Pradiou',
  'Pamplemousse', 'Prune', 'Coing', 'Figue', 'Mandarine', 'Pomme', 'Datte', 'Pruneau',
  'Mure', 'Citrus', 'Pulpe', 'Baies', 'Raisin', 'Mangue', 'Titi', 'Mirabelle',
  'Quetsch', 'Ananas', 'Myrtille', 'Strawberry', 'Aubergine', 'Groseille', 'Peche',
  'Abricot', 'Nectarine', 'Blackamber', 'Corinthe', 'Betterave', 'Scarab', 'Kumquat',
  'Poivron', 'Kiwi', 'ReineClaude', 'Jelly', 'Lemon', 'Momo', 'Courge', 'Bulbe',
  'Cassis', 'PoisChiche', 'Brugnon', 'Pommette', 'Letter',
];
const HEROS = ['Tequila', 'Porto', 'Pastaga', 'Manzana', 'Curaso', 'Cherry'];

// Ce qu'on va chercher : { clé du manifeste, symbole, images voulues }
function aExtraire() {
  const liste = [];
  BADS.forEach((nom, type) => {
    liste.push({ cle: 'bads' + type, symbole: 'miniWave2SpBads' + nom, etiquette: nom });
  });
  HEROS.forEach((nom, i) => {
    liste.push({ cle: 'hero' + i, symbole: 'miniWave2SpHero' + nom, etiquette: nom });
  });
  liste.push({ cle: 'boss', symbole: 'miniWave2SpBoss', etiquette: 'Boss' });
  liste.push({ cle: 'saucer', symbole: 'miniWave2SpSaucer', etiquette: 'Soucoupe' });
  liste.push({ cle: 'shot', symbole: 'miniWave2SpShot', etiquette: 'Projectiles' });
  // Les icônes de la boutique : un seul clip de dix-huit images, une par
  // article (box/ShopSlot.as fait `ico.gotoAndStop(id+1)`). Il n'est pas exporté
  // sous un nom — il vit à l'intérieur de miniWave2BoxShopSlot — d'où
  // l'identifiant direct.
  liste.push({ cle: 'shopIco', id: 1108, etiquette: 'Icônes du stand' });
  // Le logo du menu (posé en 120,24 sur le fond #4a4a84 de miniWave2Menu) et la
  // pièce du compteur de crédits. Comme les icônes, ils n'ont pas de nom
  // d'export : ils sont imbriqués dans les clips de l'interface.
  liste.push({ cle: 'titre', id: 1025, etiquette: 'Logo du menu' });
  liste.push({ cle: 'piece', id: 1082, etiquette: 'Pièce du compteur' });
  // Les vignettes des modes spéciaux (box/Special.as : `illus.gotoAndStop(id+1)`).
  liste.push({ cle: 'specialIco', symbole: 'specialIllustration', etiquette: 'Vignettes des spéciaux' });
  return liste;
}

// Quelle image chaque forme utilise-t-elle ? extract-swf-shapes.js sait le dire
// (il signale les remplissages bitmap) ; on lui demande son inventaire une fois
// et on en tire la table forme → image. 65535 est le « pas d'image » du format.
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
    t.set(Number(m[1]), { images, w, h });
  }
  return t;
}

function principal() {
  const liste = aExtraire();
  const manifeste = {};
  const formes = new Set();
  const absents = [];

  for (const item of liste) {
    const id = (item.id !== undefined) ? item.id : noms.get(item.symbole);
    if (id === undefined) { absents.push(item.symbole); continue; }
    const frames = parSprite.get(id);
    if (!frames || frames.size === 0) { absents.push(item.symbole + ' (sans image)'); continue; }
    const etats = [];
    for (const f of [...frames.keys()].sort((a, c) => a - c)) {
      const pieces = [];
      for (const p of frames.get(f)) pieces.push(...aplatir(p.ch, p.M, 0));
      if (!pieces.length) continue;
      for (const pc of pieces) formes.add(pc.shape);
      etats.push({ frame: f, pieces });
    }
    if (!etats.length) { absents.push(item.symbole + ' (aucune forme)'); continue; }
    manifeste[item.cle] = { nom: item.etiquette, symbole: item.symbole || ('#' + id), etats };
  }

  if (absents.length) console.log('introuvables : ' + absents.join(', '));
  const total = Object.values(manifeste).reduce((n, m) => n + m.etats.length, 0);
  console.log(`${Object.keys(manifeste).length} sprites, ${total} états, ${formes.size} formes distinctes`);

  if (process.argv.includes('--liste')) {
    for (const [cle, m] of Object.entries(manifeste)) {
      console.log(`  ${cle.padEnd(10)} ${m.nom.padEnd(14)} ${m.etats.length} état(s) : `
        + m.etats.map((e) => e.pieces.map((p) => '#' + p.shape).join('+')).join(' '));
    }
    return;
  }

  fs.mkdirSync(SORTIE, { recursive: true });
  const infos = tableFormes();

  // Deux familles : les formes qui ne sont qu'un cadre rempli d'une image (tous
  // les fruits et le boss) et les vrais tracés (les projectiles).
  const imagesVoulues = new Set(), tracesVoulus = new Set();
  for (const f of formes) {
    const info = infos.get(f);
    if (info && info.images.length === 1) imagesVoulues.add(info.images[0]);
    else tracesVoulus.add(f);
  }
  console.log(`${imagesVoulues.size} images, ${tracesVoulus.size} tracés`);

  const ecrites = new Map();   // identifiant → nom de fichier
  if (imagesVoulues.size) {
    const brut = execFileSync(process.execPath,
      [path.join(__dirname, 'extract-swf-bitmaps.js'), SWF, SORTIE, ...[...imagesVoulues].map(String)],
      { cwd: RACINE, encoding: 'utf8', maxBuffer: 64e6 });
    for (const m of brut.matchAll(/^#(\d+) → \S*?([^/\s]+\.(?:png|svg|jpg|gif))/gm)) {
      ecrites.set('img' + m[1], m[2]);
    }
  }
  if (tracesVoulus.size) {
    const brut = execFileSync(process.execPath,
      [path.join(__dirname, 'extract-swf-shapes.js'), SWF, SORTIE, ...[...tracesVoulus].map(String)],
      { cwd: RACINE, encoding: 'utf8', maxBuffer: 64e6 });
    for (const m of brut.matchAll(/^#(\d+) → \S*?([^/\s]+\.svg)/gm)) {
      ecrites.set('shp' + m[1], m[2]);
    }
  }

  // Une pièce qu'on n'a pas su sortir ne doit pas disparaître en silence : le
  // client afficherait un trou à la place d'un vaisseau.
  const perdues = [];
  for (const [cle, m] of Object.entries(manifeste)) {
    m.etats = m.etats.map((e) => {
      const pieces = [];
      for (const pc of e.pieces) {
        const info = infos.get(pc.shape);
        const k = (info && info.images.length === 1) ? 'img' + info.images[0] : 'shp' + pc.shape;
        const fichier = ecrites.get(k);
        if (!fichier) { perdues.push(`${cle} #${pc.shape}`); continue; }
        pieces.push({
          fichier,
          // Taille du cadre d'origine, en pixels : c'est elle qui dit au client
          // à quelle échelle poser l'image.
          w: info ? info.w : 0,
          h: info ? info.h : 0,
          // Matrice de placement, translation convertie des twips en pixels.
          m: [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20]
            .map((v) => Math.round(v * 1e4) / 1e4),
        });
      }
      return pieces.length ? { frame: e.frame, pieces } : null;
    }).filter(Boolean);
  }
  for (const cle of Object.keys(manifeste)) {
    if (manifeste[cle].etats.length === 0) delete manifeste[cle];
  }
  if (perdues.length) {
    console.log(`pièces non extraites (${perdues.length}) : `
      + perdues.slice(0, 12).join(', ') + (perdues.length > 12 ? '…' : ''));
  }

  const dest = path.join(SORTIE, 'sprites.json');
  fs.writeFileSync(dest, JSON.stringify(manifeste), 'utf8');
  console.log(`→ ${path.relative(RACINE, dest)} (${Object.keys(manifeste).length} sprites)`);
}

if (require.main === module) principal();
module.exports = { aExtraire, BADS, HEROS };
