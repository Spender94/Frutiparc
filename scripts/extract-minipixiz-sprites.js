#!/usr/bin/env node
// Sort les dessins de Minipixiz (miniTroll) du SWF, pour le portage natif.
//
//   node scripts/extract-minipixiz-sprites.js            → écrit public/minipixiz/sprites/
//   node scripts/extract-minipixiz-sprites.js --liste    → montre ce qui serait extrait
//
// ── Quel SWF ──
//
// Games/miniTroll/minipixiz.swf est OBFUSQUÉ : ses noms de symboles sont du
// bruit (« ;dO4) », « [Ryaj »…), on n'y retrouve rien. Games/miniTroll/swf/root.swf
// est le même jeu avant obfuscation, avec ses vrais noms — token, stone,
// impCell, bomb, elItem. C'est celui-là qu'on lit.
//
// ── Le jeton, et pourquoi il demande un traitement à part ──
//
// Un jeton n'est pas une image mais DEUX clips superposés, que Group.draw envoie
// tous les deux sur la même image :
//
//     e.skin.gotoAndStop(frame)              // le contour, qui dit à quels
//                                            // voisins le jeton est relié
//     e.skin.skin.gotoAndStop(frame)         // le corps, dont la forme suit
//
// L'image va de 1 à 16 : un bit par côté relié (haut 1, droite 2, bas 4, gauche
// 8). C'est ce qui fait que quatre jetons d'une même couleur se fondent en une
// seule tache au lieu de rester quatre carrés — toute la lisibilité du jeu tient
// là-dedans. L'image 20 est à part : c'est l'armure.
//
// Aplatir naïvement le clip donnerait seize contours corrects et seize fois le
// MÊME corps (la première image du clip imbriqué). D'où le paramètre `frame`
// d'aplatir(), qui synchronise l'enfant sur l'image du parent.
//
// ── La couleur ──
//
// Les dessins sont en niveaux de gris : le jeu teinte à l'exécution
// (Mc.setColor(mc, Cs.colorList[type])). On garde le principe — un seul jeu de
// dessins pour les huit couleurs.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'Games/miniTroll/swf/root.swf');
const SORTIE = path.join(RACINE, 'public/minipixiz/sprites');

const swf = ouvrir(SWF);
const { noms, parSprite, aplatir } = swf;

// Ce qu'on va chercher. `synchro` demande que les clips imbriqués suivent
// l'image du parent — voir l'en-tête.
// `images` limite ce qu'on garde : les clips continuent souvent bien au-delà de
// ce que le jeu utilise, et tout ce qui suit n'est que du remplissage de
// scénario qui alourdirait le manifeste et le chargement.
const CIBLES = [
  // Le jeton : seize images de liaison (1 à 16) plus l'armure (20). L'image
  // porte les côtés reliés — haut 1, droite 2, bas 4, gauche 8, plus un. Le
  // contour n'est posé que sur les images SANS voisin du dessus : c'est le
  // rebord supérieur de la tache, et il n'a pas lieu d'être ailleurs.
  { cle: 'token', symbole: 'token', etiquette: 'Jeton', synchro: true,
    images: [...Array(16)].map((_, i) => i + 1).concat([20]) },
  { cle: 'stone', symbole: 'stone', etiquette: 'Pierre' },
  { cle: 'impCell', symbole: 'impCell', etiquette: 'Cellule d\'impy' },
  { cle: 'bomb', symbole: 'bomb', etiquette: 'Bombe' },
  { cle: 'elItem', symbole: 'elItem', etiquette: 'Objet' },
  { cle: 'star', symbole: 'mcTokenStar', etiquette: 'Étoile' },
  { cle: 'marble', symbole: 'mcBlackMarble', etiquette: 'Perle noire' },
  { cle: 'imp', symbole: 'imp', etiquette: 'Impy' },

  // ── Le cadre du jeu ──
  // interfaceRacine porte les trois morceaux du cadre de la forêt : les racines
  // du haut (image 1), le montant du milieu (2) et le sol (3). base/Forest les
  // attache tels quels, sur trois profondeurs.
  { cle: 'cadre', symbole: 'interfaceRacine', etiquette: 'Cadre de la forêt' },

  // ── Le décor ──
  // Neuf plans, de l'horizon au premier plan, chacun avec son coefficient de
  // parallaxe (Menu.initDecor).
  //
  // Le ciel manque, et c'est délibéré : decorPlanSky n'est pas une forme mais un
  // MORPH (tag 46), cent une images d'un dégradé qui se déforme — c'est lui qui
  // fait le lever et le coucher du soleil. L'extracteur de formes ne sait pas
  // lire un morph, et le bricoler à moitié donnerait un ciel faux. Il se joue
  // sur l'écran du menu, pas sur celui de la forêt : on le traitera avec le
  // menu, proprement.
  { cle: 'horizon', symbole: 'decorPlanHorizon', etiquette: 'Horizon' },
  { cle: 'collines', symbole: 'decorPlanHill', etiquette: 'Collines' },
  { cle: 'foret3', symbole: 'decorPlanForest3', etiquette: 'Forêt lointaine' },
  { cle: 'foret2', symbole: 'decorPlanForest2', etiquette: 'Forêt moyenne' },
  { cle: 'foret', symbole: 'decorPlanForest', etiquette: 'Forêt' },
  { cle: 'milieu', symbole: 'decorPlanMid', etiquette: 'Plan médian' },
  { cle: 'arbre', symbole: 'decorPlanTree', etiquette: 'Arbre' },
  { cle: 'herbe', symbole: 'decorPlanHerb', etiquette: 'Herbe' },
  { cle: 'premier', symbole: 'decorPlanFirst', etiquette: 'Premier plan' },
  { cle: 'nuage', symbole: 'cloud', etiquette: 'Nuage' },

  // ── La fée et son interface ──
  // faerie porte toutes ses animations, picFace ses portraits. On ne garde pas
  // les soixante-et-onze images du clip : le jeu n'en joue qu'une poignée, et
  // le reste alourdirait le chargement pour rien.
  { cle: 'fee', symbole: 'faerie', etiquette: 'Fée', synchro: true,
    images: [...Array(24)].map((_, i) => i + 1) },
  // picFace ne garde que ses DIX premières images. Au-delà, les dix-neuf
  // suivantes ne sont qu'une seule et même photo de Jane Fonda en Barbarella —
  // une blague d'atelier laissée dans le fichier. Cm.genFaerieSeed tire de toute
  // façon `$skin[0] = Std.random(6)`, donc six visages ; les quatre autres
  // restent au cas où une fée de mission en demanderait un.
  { cle: 'portrait', symbole: 'picFace', etiquette: 'Portrait de fée', synchro: true,
    images: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  { cle: 'interFace', symbole: 'interFace', etiquette: 'Cadre du portrait' },
  // inter.Life et inter.Mana ne sont que des boîtes vides : ce qu'on voit, ce
  // sont des cœurs posés tous les 14 px et des gouttes tous les 6, chacun à
  // deux images — vide, plein.
  { cle: 'coeur', symbole: 'mcHeart', etiquette: 'Cœur de vie', synchro: true },
  { cle: 'mana', symbole: 'mcMana', etiquette: 'Goutte de mana', synchro: true },
  { cle: 'suivante', symbole: 'mcNext', etiquette: 'Pièce suivante' },
  { cle: 'nuit', symbole: 'mcNightMask', etiquette: 'Masque de nuit' },
];

// Quelle image chaque forme utilise-t-elle ? extract-swf-shapes.js le dit.
function tableFormes() {
  const brut = execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), SWF],
    { cwd: RACINE, encoding: 'utf8', maxBuffer: 128e6 });
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
  const manifeste = {};
  const formes = new Set();
  const absents = [];

  for (const item of CIBLES) {
    const id = (item.id !== undefined) ? item.id : noms.get(item.symbole);
    if (id === undefined) { absents.push(item.symbole); continue; }
    const frames = parSprite.get(id);
    if (!frames || frames.size === 0) { absents.push(item.symbole + ' (sans image)'); continue; }
    const etats = [];
    const voulues = item.images ? new Set(item.images) : null;
    for (const f of [...frames.keys()].sort((a, c) => a - c)) {
      if (voulues && !voulues.has(f)) continue;
      const pieces = [];
      for (const p of frames.get(f)) {
        const morceaux = aplatir(p.ch, p.M, 0, item.synchro ? f : undefined, p.nom || '');
        // Le masque posé au PREMIER niveau du symbole visé : aplatir() ne le
        // voit pas, puisqu'on l'appelle placement par placement. Sans ce
        // rattrapage, le rectangle rouge qui découpe la colonne des pièces à
        // venir se dessinait par-dessus elle.
        if (p.masque) for (const m of morceaux) m.masque = true;
        pieces.push(...morceaux);
      }
      if (!pieces.length) continue;
      for (const pc of pieces) formes.add(pc.shape);
      etats.push({ frame: f, pieces });
    }
    if (!etats.length) { absents.push(item.symbole + ' (aucune forme)'); continue; }
    manifeste[item.cle] = { nom: item.etiquette, symbole: item.symbole, etats };
  }

  if (absents.length) console.log('introuvables : ' + absents.join(', '));
  const total = Object.values(manifeste).reduce((n, m) => n + m.etats.length, 0);
  console.log(`${Object.keys(manifeste).length} sprites, ${total} états, ${formes.size} formes distinctes`);

  if (process.argv.includes('--liste')) {
    for (const [cle, m] of Object.entries(manifeste)) {
      console.log(`  ${cle.padEnd(9)} ${m.nom.padEnd(16)} ${m.etats.length} état(s) : `
        + m.etats.map((e) => 'f' + e.frame + '=' + e.pieces.map((p) => '#' + p.shape).join('+')).join(' '));
    }
    return;
  }

  fs.mkdirSync(SORTIE, { recursive: true });
  const infos = tableFormes();

  const imagesVoulues = new Set(), tracesVoulus = new Set();
  for (const f of formes) {
    const info = infos.get(f);
    if (info && info.images.length === 1) imagesVoulues.add(info.images[0]);
    else tracesVoulus.add(f);
  }
  console.log(`${imagesVoulues.size} images, ${tracesVoulus.size} tracés`);

  const ecrites = new Map();
  if (imagesVoulues.size) {
    const brut = execFileSync(process.execPath,
      [path.join(__dirname, 'extract-swf-bitmaps.js'), SWF, SORTIE, ...[...imagesVoulues].map(String)],
      { cwd: RACINE, encoding: 'utf8', maxBuffer: 128e6 });
    for (const m of brut.matchAll(/^#(\d+) → \S*?([^/\s]+\.(?:png|svg|jpg|gif))/gm)) {
      ecrites.set('img' + m[1], m[2]);
    }
  }
  if (tracesVoulus.size) {
    const brut = execFileSync(process.execPath,
      [path.join(__dirname, 'extract-swf-shapes.js'), SWF, SORTIE, ...[...tracesVoulus].map(String)],
      { cwd: RACINE, encoding: 'utf8', maxBuffer: 128e6 });
    for (const m of brut.matchAll(/^#(\d+) → \S*?([^/\s]+\.svg)/gm)) {
      ecrites.set('shp' + m[1], m[2]);
    }
  }

  // Le cadre exact de chaque dessin, lu dans le viewBox du SVG écrit.
  //
  // C'est indispensable ici, et ça ne l'était pas pour Miniwave : les contours
  // du jeton ne sont pas centrés sur la case (le rebord supérieur occupe le
  // haut, pas le milieu). Les poser centrés les décalerait tous. Le SVG porte
  // déjà l'information — autant la lire là plutôt que d'inventer un format.
  function cadre(fichier) {
    const t = fs.readFileSync(path.join(SORTIE, fichier), 'utf8');
    const m = /viewBox="([-\d.eE]+) ([-\d.eE]+) ([-\d.eE]+) ([-\d.eE]+)"/.exec(t);
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
  }

  // Une pièce qu'on n'a pas su sortir ne doit pas disparaître en silence : le
  // client afficherait un trou à la place d'un jeton.
  const perdues = [];
  for (const [cle, m] of Object.entries(manifeste)) {
    m.etats = m.etats.map((e) => {
      const pieces = [];
      const masques = [];
      for (const pc of e.pieces) {
        const info = infos.get(pc.shape);
        const k = (info && info.images.length === 1) ? 'img' + info.images[0] : 'shp' + pc.shape;
        const fichier = ecrites.get(k);
        if (!fichier) { perdues.push(`${cle} #${pc.shape}`); continue; }
        const c = cadre(fichier) || { x: -50, y: -50, w: 100, h: 100 };
        // La matrice absolue, translation convertie en pixels. Le client s'en
        // sert telle quelle : c'est le seul moyen exact de poser une pièce
        // MIROIR (l'aile droite de la fée est l'aile gauche à l'envers, a = -1)
        // ou TOURNÉE. Un simple coin haut-gauche et une taille ne suffisent
        // pas — le masque du portrait, étiré de 32 à 94 px, en est la preuve.
        const M = [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20];
        const coin = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
        const pts = [coin(c.x, c.y), coin(c.x + c.w, c.y),
          coin(c.x, c.y + c.h), coin(c.x + c.w, c.y + c.h)];
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const arr = (v) => Math.round(v * 1e4) / 1e4;
        const p = {
          fichier,
          // Le cadre du dessin APRÈS transformation : c'est lui qui dit au
          // client quelle taille de canevas préparer.
          x: arr(Math.min(...xs)), y: arr(Math.min(...ys)),
          w: arr(Math.max(...xs) - Math.min(...xs)),
          h: arr(Math.max(...ys) - Math.min(...ys)),
          // Le viewBox propre du SVG, et la matrice pour l'y poser.
          vb: [arr(c.x), arr(c.y), arr(c.w), arr(c.h)],
          m: M.map(arr),
        };
        // Un masque ne se dessine pas : il DÉCOUPE. On n'en garde que le cadre,
        // et le client s'en sert comme fenêtre — sans quoi le rectangle rouge
        // qui découpe le portrait de la fée se collerait en travers du cadre.
        //
        // Seuls les masques de PREMIER NIVEAU sont retenus. Ceux qui vivent au
        // fond d'un sous-clip ne découpent que ce sous-clip : les deux petits
        // masques des pupilles de la fée, appliqués au dessin entier,
        // réduiraient son portrait à treize pixels sur six.
        if (pc.masque) {
          masques.push({ x: p.x, y: p.y, w: p.w, h: p.h, chemin: pc.chemin || '' });
          continue;
        }
        // Le chemin des clips nommés qui portent la forme : c'est par lui que
        // le client sait quelle couleur de la fée appliquer à quel morceau.
        if (pc.chemin) p.nom = pc.chemin;
        pieces.push(p);
      }
      // Un masque ne découpe que ses FRÈRES — ce qui vit sous le même clip que
      // lui. On ne garde donc que ceux qui couvrent tout le dessin, c'est-à-dire
      // ceux dont le clip parent contient toutes les pièces. Les deux petits
      // masques des pupilles de la fée, appliqués au dessin entier, réduiraient
      // son portrait à treize pixels sur six.
      const couvreTout = (m) => pieces.every((p) => {
        const n = p.nom || '';
        return m.chemin === '' || n === m.chemin || n.indexOf(m.chemin + '.') === 0;
      });
      const gardes = masques.filter(couvreTout).map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h }));
      const etat = { frame: e.frame, pieces };
      if (gardes.length) etat.masques = gardes;
      return etat;
    }).filter((e) => e.pieces.length);
  }
  if (perdues.length) console.log('pièces perdues : ' + perdues.join(', '));

  const dest = path.join(SORTIE, 'sprites.json');
  fs.writeFileSync(dest, JSON.stringify(manifeste), 'utf8');
  console.log(`→ ${path.relative(RACINE, dest)} (${Object.keys(manifeste).length} sprites)`);
}

principal();
