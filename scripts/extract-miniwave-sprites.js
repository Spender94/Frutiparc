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

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Signature inconnue : ' + sig);
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
}

const b = lireSwf(SWF);
const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;

// Parcourt les tags en descendant dans les DefineSprite.
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
      if (code === 1) frame++;
      o += hs + len;
    }
  })(debut, b.length, 0);
}

// Les noms d'auteur (ExportAssets / SymbolClass) : c'est par eux qu'on trouve.
const noms = new Map();
parcourir((code, corps, len) => {
  if (code !== 56 && code !== 76) return;
  let p = corps;
  const n = b.readUInt16LE(p); p += 2;
  for (let i = 0; i < n; i++) {
    const id = b.readUInt16LE(p); p += 2;
    let e = p; while (e < corps + len && b[e] !== 0) e++;
    noms.set(b.slice(p, e).toString('utf8'), id);
    p = e + 1;
  }
});

// Nature de chaque caractère : une forme se trace, un sprite se traverse.
const TYPE = new Map();
parcourir((code, corps) => {
  if ([2, 22, 32, 83, 39].includes(code)) TYPE.set(b.readUInt16LE(corps), code);
});
const estForme = (id) => [2, 22, 32, 83].includes(TYPE.get(id));
const estSprite = (id) => TYPE.get(id) === 39;

// Lecture d'une MATRIX (champs non alignés sur l'octet).
class Bits {
  constructor(o) { this.o = o; this.bit = 0; }
  u(n) { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((b[this.o] >> (7 - this.bit)) & 1); if (++this.bit === 8) { this.bit = 0; this.o++; } } return v >>> 0; }
  s(n) { if (!n) return 0; const v = this.u(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
}
function lireMatrice(o) {
  const m = new Bits(o);
  const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };   // a b c d e f, comme en SVG
  if (m.u(1)) { const n = m.u(5); M.a = m.s(n) / 65536; M.d = m.s(n) / 65536; }
  if (m.u(1)) { const n = m.u(5); M.b = m.s(n) / 65536; M.c = m.s(n) / 65536; }
  const n = m.u(5); M.e = m.s(n); M.f = m.s(n);       // translation en twips
  return M;
}
// Composition parent ∘ enfant.
function composer(P, E) {
  return {
    a: P.a * E.a + P.c * E.b,
    b: P.b * E.a + P.d * E.b,
    c: P.a * E.c + P.c * E.d,
    d: P.b * E.c + P.d * E.d,
    e: P.a * E.e + P.c * E.f + P.e,
    f: P.b * E.e + P.d * E.f + P.f,
  };
}
const IDENTITE = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// Le contenu image par image de chaque sprite.
//
// Flash ne redéclare pas tout à chaque image : il tient une LISTE D'AFFICHAGE
// indexée par profondeur, qu'un PlaceObject remplit et qu'un RemoveObject vide.
// Une image qui ne touche qu'une profondeur laisse les autres en place. Ne
// retenir que les placements de l'image courante suffit pour les vaisseaux (qui
// se redessinent entièrement à chaque image), mais perd tout ce qui persiste —
// le fond commun des icônes de la boutique, par exemple, posé une fois puis
// gardé pendant trois images.
//
// On tient donc la liste d'affichage, et on photographie son état à chaque
// image. Les profondeurs sont triées : c'est l'ordre d'empilement de Flash.
const parSprite = new Map();
{
  const listes = new Map();                            // sprite → profondeur → {ch, M}
  const photographier = (id, frame) => {
    const l = listes.get(id);
    if (!l || l.size === 0) return;
    if (!parSprite.has(id)) parSprite.set(id, new Map());
    parSprite.get(id).set(frame,
      [...l.keys()].sort((a, c) => a - c).map((d) => l.get(d)));
  };
  let derniere = new Map();                            // sprite → dernière image vue
  parcourir((code, corps, len, id, frame) => {
    if (!id) return;
    if (!listes.has(id)) listes.set(id, new Map());
    const l = listes.get(id);
    // ShowFrame : l'image est complète, on la photographie.
    if (code === 1) { photographier(id, frame); derniere.set(id, frame); return; }
    // RemoveObject (5) et RemoveObject2 (28) : la profondeur se vide.
    if (code === 5) { l.delete(b.readUInt16LE(corps + 2)); return; }
    if (code === 28) { l.delete(b.readUInt16LE(corps)); return; }
    let ch = -1, M = IDENTITE, prof = -1;
    if (code === 4) {                                  // PlaceObject
      ch = b.readUInt16LE(corps);
      prof = b.readUInt16LE(corps + 2);
      M = lireMatrice(corps + 4);
    } else if (code === 26 || code === 70) {           // PlaceObject2 / 3
      const flags = b[corps];
      prof = b.readUInt16LE(corps + 1);
      if (!(flags & 2)) {
        // Simple modification : on garde le caractère déjà en place et on ne
        // remplace que ce que l'étiquette redéfinit (typiquement la matrice).
        const avant = l.get(prof);
        if (!avant) return;
        ch = avant.ch;
        M = (flags & 4) ? lireMatrice(corps + 3) : avant.M;
      } else {
        ch = b.readUInt16LE(corps + 3);
        M = (flags & 4) ? lireMatrice(corps + 5) : IDENTITE;
      }
    }
    if (ch < 0 || prof < 0) return;
    l.set(prof, { ch, M });
  });
  // La dernière image d'un sprite n'est pas toujours suivie d'un ShowFrame.
  for (const [id, l] of listes) {
    if (l.size === 0) continue;
    const f = (derniere.get(id) || 0) + 1;
    if (!parSprite.has(id) || !parSprite.get(id).has(f - 1)) photographier(id, f);
  }
}

// Aplatit un caractère en une liste de formes avec leur matrice absolue. Un
// sprite imbriqué (une pièce animée : le hublot qui clignote, la main du boss)
// est traversé jusqu'à ses formes — c'est ce qui manquait pour le boss, le
// Pruneau et une partie des projectiles.
function aplatir(ch, M, profondeur) {
  if (profondeur > 6) return [];
  if (estForme(ch)) return [{ shape: ch, M }];
  if (!estSprite(ch)) return [];
  const frames = parSprite.get(ch);
  if (!frames) return [];
  const premiere = frames.get([...frames.keys()].sort((a, c) => a - c)[0]) || [];
  const out = [];
  for (const p of premiere) out.push(...aplatir(p.ch, composer(M, p.M), profondeur + 1));
  return out;
}

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
