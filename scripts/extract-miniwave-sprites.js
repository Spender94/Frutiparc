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
  // Les PARTICULES du jeu : anneaux d'onde, étincelles d'impact, traînes des
  // tirs, étoiles de warp… Chaque image du clip est une étape de l'animation ;
  // le client les joue à 40 i/s comme le SWF. Les transformations de couleur
  // posées dans le fichier (le halo BLANC de la bombe du Pamplemousse, le fondu
  // des traînes) sortent avec les pièces — sans elles, ces dessins sortaient
  // noirs ou opaques.
  liste.push({ cle: 'partOnde', symbole: 'miniWave2SpPartOnde', etiquette: 'Onde de choc' });
  liste.push({ cle: 'partImpact', symbole: 'miniWave2SpPartImpact', etiquette: 'Impact' });
  liste.push({ cle: 'partVanish', symbole: 'miniWave2SpPartVanish', etiquette: 'Volute' });
  liste.push({ cle: 'partWarpStar', symbole: 'miniWave2SpPartWarpStar', etiquette: 'Étoile de warp' });
  liste.push({ cle: 'partBadsWarp', symbole: 'miniWave2SpPartBadsWarp', etiquette: 'Warp des ennemis' });
  liste.push({ cle: 'queueCuraso', symbole: 'miniWave2SpPartCurasoQueue', etiquette: 'Traîne du Curaso' });
  liste.push({ cle: 'queueHoming', symbole: 'miniWave2SpPartHomingQueue', etiquette: 'Traîne chercheuse' });
  liste.push({ cle: 'queueKumquat', symbole: 'miniWave2SpPartKumquatQueue', etiquette: 'Traîne du Kumquat' });
  liste.push({ cle: 'queueGroseille', symbole: 'miniWave2SpPartGroseilleQueue', etiquette: 'Traîne de la Groseille' });
  liste.push({ cle: 'cherryLaser', symbole: 'miniWave2SpPartCherryLaser', etiquette: 'Rayon du Cherry' });
  liste.push({ cle: 'emp', symbole: 'mcEMP', etiquette: 'Brouillage EMP' });
  liste.push({ cle: 'pause', symbole: 'mcPause', etiquette: 'Écran de pause' });
  // Le bonus « vaisseau » de la soucoupe : le halo étoilé (image 4 du clip Opt)
  // et les cinq silhouettes de vaisseaux qu'il peut annoncer — Opt.as tire
  // l'identité au largage (opt.gotoAndStop(id+1)), jamais l'Aliquet.
  liste.push({ cle: 'optVaisseau', id: 1404, etiquette: 'Bonus vaisseau' });
  liste.push({ cle: 'optHalo', id: 1398, etiquette: 'Halo du bonus vaisseau' });
  // La PIÈCE du bonus (image 1 du clip Opt) : la toupie du SWF est un morph
  // qu'on ne sait pas rejouer, mais sa dernière image — la pièce de face — est
  // un vrai dessin. Le client la teinte par valeur (MC.setColor ajoute la
  // couleur au sous-clip `piece`), d'où le chemin conservé sur les pièces.
  liste.push({ cle: 'optPiece', id: 1382, etiquette: 'Pièce du bonus' });
  // L'interface du jeu : l'ornement du panneau de score (les chevrons de part
  // et d'autre des chiffres), les fonds des panneaux de message (level,
  // game over, fin, boss) et le fond du menu.
  liste.push({ cle: 'scoreOrne', id: 1123, etiquette: 'Ornement du score' });
  liste.push({ cle: 'msg', symbole: 'miniWave2Msg', etiquette: 'Panneaux de message' });
  liste.push({ cle: 'menuFond', id: 1023, etiquette: 'Fond du menu' });
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
  // L'illustration du panneau d'accueil (box/InfoMain.setIllus) : six images,
  // une par rubrique du menu, l'accueil compris. C'est le carré vert au logo
  // « mw » qu'on voit à l'ouverture, et qui change au survol des boutons.
  liste.push({ cle: 'illus', symbole: 'illus', etiquette: 'Illustration du panneau d\'accueil' });
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
    // Le coin haut-gauche des bornes (`@x,y` en fin de ligne) : les formes
    // excentrées — les traînes, ancrées derrière leur origine — se posent par
    // lui, pas par leur centre.
    const o = /\t@(-?[\d.]+),(-?[\d.]+)\s*$/.exec(m[3]);
    t.set(Number(m[1]), { images, w, h, x0: o ? Number(o[1]) : -w / 2, y0: o ? Number(o[2]) : -h / 2 });
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
    // Une FORME nue (le halo du bonus vaisseau) n'a pas d'images : elle est sa
    // propre pièce unique.
    if (swf.estForme(id)) {
      formes.add(id);
      manifeste[item.cle] = {
        nom: item.etiquette, symbole: '#' + id,
        etats: [{ frame: 1, pieces: [{ shape: id, M: swf.IDENTITE, chemin: '', cx: null }] }],
      };
      continue;
    }
    const frames = parSprite.get(id);
    if (!frames || frames.size === 0) { absents.push(item.symbole + ' (sans image)'); continue; }
    const etats = [];
    for (const f of [...frames.keys()].sort((a, c) => a - c)) {
      const pieces = [];
      // La transformation de couleur du placement de PREMIER niveau part avec
      // le reste : c'est elle qui éteint l'anneau d'onde et fond les traînes.
      for (const p of frames.get(f)) pieces.push(...aplatir(p.ch, p.M, 0, undefined, '', p.cx));
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
        const piece = {
          fichier,
          // Taille du cadre d'origine, en pixels : c'est elle qui dit au client
          // à quelle échelle poser l'image.
          w: info ? info.w : 0,
          h: info ? info.h : 0,
          // Matrice de placement, translation convertie des twips en pixels.
          m: [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20]
            .map((v) => Math.round(v * 1e4) / 1e4),
        };
        // Origine du dessin quand elle n'est PAS le centre du cadre (à plus
        // d'un demi-pixel près) : le client pose alors l'image à cet endroit.
        if (info && (Math.abs(info.x0 + info.w / 2) > 0.5 || Math.abs(info.y0 + info.h / 2) > 0.5)) {
          piece.o = [Math.round(info.x0 * 100) / 100, Math.round(info.y0 * 100) / 100];
        }
        // Le chemin des clips nommés qui portent la pièce : le jeu teinte ses
        // morceaux par leur nom (MC.setColor sur opt.piece).
        if (pc.chemin) piece.c = pc.chemin;
        // Transformation de couleur posée dans le SWF (sortie = source ×
        // mult/256 + add) : le halo de la bombe du Pamplemousse est un disque
        // noir PEINT EN BLANC par elle, les traînes s'éteignent par son alpha.
        // La laisser tomber rendait ces pièces noires ou opaques.
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
