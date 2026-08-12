#!/usr/bin/env node
// Sort les VIGNETTES de la boutique (public/swf/shopitem.swf) en PNG, pour que
// le portage light montre les mêmes articles que le bureau.
//
//   node scripts/extract-boutique-pictos.js [capture-boutique.png]
//
// ── D'où elles viennent ──
//
// Un article de boutique porte un picto « <type>,<n> » : le bureau charge
// shopitem.swf, va à l'image du TYPE (la pellicule racine est étiquetée feutre,
// game, pass, item, pack, mini, wallpaper) et fait `gotoAndStop(n)` sur le clip
// qui s'y trouve. Les trois types dont le mobile a besoin :
//
//   · pass,N   → le clip des jeux (mb2, snake3, bkiwi, swapou2, kaluga…) ;
//   · pack,N   → le clip des packs de jeu (mêmes jeux, autre dessin) ;
//   · feutre,N → le porte-feutres, une image par couleur.
//
// On les sort en aplatissant le clip à l'image voulue (scripts/lib/swf-sprites)
// puis en rendant les formes au navigateur — les dessins d'époque emploient des
// dégradés qu'un rendu maison approximerait.
//
// Les fonds d'écran et les accessoires n'ont rien à faire ici : le fond est déjà
// une image (public/wal/*.jpg), et l'accessoire se voit sur la bouille du joueur.
//
// ── Le dossier rose ──
//
// La colonne des rubriques est une arborescence de main.swf, pas de shopitem :
// son DOSSIER rose ne se trouve donc pas dans ce binaire. On le prend là où il
// est sûr — dans une capture ×2 de la vraie fenêtre — en découpant à la boîte
// des pixels non blancs et en détourant le blanc du fond. Passer la capture en
// argument déclenche cette découpe (sans argument, on ne sort que les pictos).
//
//   node scripts/extract-boutique-pictos.js /chemin/capture-boutique.png
//
// Capture attendue : /legacy en ×2, fenêtre Boutique ouverte en haut à gauche,
// image entière (le dossier du premier rayon tombe alors vers 37,148).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'public/swf/shopitem.swf');
const SORTIE = path.join(RACINE, 'public/fb/boutique');
const TRAVAIL = path.join(RACINE, 'data/boutique-travail');
const TAILLE = 128;                                  // affiché ~64 px

// Les images à sortir, par type. Les index sont ceux des pictos du catalogue
// (server.js, SHOP_PACKS) : pass 1..8, pack 12/14, feutre 0..17.
const DEMANDES = [
  { type: 'pass', images: [1, 3, 4, 5, 8] },
  { type: 'pack', images: [12, 14] },
];

// Les feutres, eux, n'ont qu'UN dessin : le clip du porte-feutres ne compte
// qu'une image, et c'est le CODE du SWF qui teinte son calque « col » selon la
// couleur choisie. On sort donc le stylo en deux couches — le corps, et la
// partie à teindre — que le portage recolore comme le fait le bureau.
const FEUTRE = { clip: 'feutre', calqueTeinte: 'col' };

// Le clip posé sur l'image ÉTIQUETÉE `nom` de la pellicule racine.
function clipDuType(chemin, nom) {
  const raw = fs.readFileSync(chemin);
  const b = raw.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  let o = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;
  let image = 1, cible = 0, dansLaBonne = false;
  while (o < b.length - 1) {
    const hdr = b.readUInt16LE(o), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
    if (code === 0) break;
    const corps = o + hs;
    if (code === 43) {
      const e = b.indexOf(0, corps);
      dansLaBonne = b.slice(corps, e).toString('latin1') === nom;
    }
    if (code === 26 && dansLaBonne) {
      const flags = b[corps];
      if (flags & 2) cible = b.readUInt16LE(corps + 3);   // HasCharacter
    }
    if (code === 1) { if (dansLaBonne && cible) break; image++; dansLaBonne = false; }
    o += hs + len;
  }
  if (!cible) throw new Error(`aucun clip sur l'image « ${nom} » de shopitem.swf`);
  return cible;
}

fs.mkdirSync(SORTIE, { recursive: true });
fs.mkdirSync(TRAVAIL, { recursive: true });

const r = ouvrir(SWF);
const cellules = [];
const formes = new Set();
for (const d of DEMANDES) {
  const clip = clipDuType(SWF, d.type);
  console.log(`type « ${d.type} » → clip #${clip}`);
  for (const n of d.images) {
    const pieces = r.aplatir(clip, r.IDENTITE, 0, n, '', null);
    if (!pieces.length) { console.log(`  ${d.type},${n} : image vide, ignorée`); continue; }
    for (const p of pieces) formes.add(p.shape);
    cellules.push({ nom: `${d.type}_${n}`, pieces });
  }
}
// Le stylo, en deux couches. `aplatir` nomme le chemin de chaque morceau : le
// calque à teindre est celui qui passe par l'enfant « col ».
{
  const clip = clipDuType(SWF, FEUTRE.clip);
  const pieces = r.aplatir(clip, r.IDENTITE, 0, 1, '', null);
  console.log(`type « feutre » → clip #${clip} (${pieces.length} morceaux)`);
  const teinte = pieces.filter((p) => String(p.chemin || '').split('.').includes(FEUTRE.calqueTeinte));
  const corps = pieces.filter((p) => !teinte.includes(p));
  if (!teinte.length) throw new Error('calque « col » introuvable dans le porte-feutres');
  for (const p of pieces) formes.add(p.shape);
  // Les deux couches partagent le MÊME cadrage : on les rend ensemble, en
  // masquant tour à tour l'autre — sinon elles ne se superposeraient plus.
  cellules.push({ nom: 'feutre_corps', pieces: corps, cadreDe: pieces });
  cellules.push({ nom: 'feutre_teinte', pieces: teinte, cadreDe: pieces });
}
execFileSync(process.execPath,
  [path.join(__dirname, 'extract-swf-shapes.js'), SWF, TRAVAIL, ...[...formes].map(String)],
  { encoding: 'utf8' });

const cadre = (sh) => {
  const t = fs.readFileSync(path.join(TRAVAIL, 'shape' + sh + '.svg'), 'utf8');
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(t);
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
};
const enPieces = (liste) => liste.map((pc) => {
  const cb = cadre(pc.shape);
  return {
    f: 'shape' + pc.shape + '.svg', vb: [cb.x, cb.y, cb.w, cb.h],
    m: [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20],
  };
});
const donnees = cellules.map((c) => ({
  nom: c.nom,
  // `cadre` : la boîte à utiliser pour le cadrage (les deux couches du stylo
  // partagent celle du dessin entier, pour rester superposables).
  cadre: enPieces(c.cadreDe || c.pieces),
  pieces: c.pieces.map((pc) => {
    const cb = cadre(pc.shape);
    return {
      f: 'shape' + pc.shape + '.svg', vb: [cb.x, cb.y, cb.w, cb.h],
      m: [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20],
    };
  }),
}));
fs.writeFileSync(path.join(TRAVAIL, 'pictos.json'), JSON.stringify(donnees));

// Le rendu passe par le navigateur, comme les voyants de jeu : les SVG d'époque
// utilisent des dégradés que seul un vrai moteur rend fidèlement. Chaque picto
// est cadré sur son propre dessin, puis centré dans une image carrée.
const CAPTURE = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (CAPTURE && !fs.existsSync(CAPTURE)) throw new Error('capture introuvable : ' + CAPTURE);

const rendu = path.join(TRAVAIL, 'rendu.js');
fs.writeFileSync(rendu, `
const { chromium } = require(${JSON.stringify(process.env.PLAYWRIGHT_DIR || path.join(RACINE, 'node_modules/playwright'))});
const fs = require('fs');
const TRAVAIL = ${JSON.stringify(TRAVAIL)};
const SORTIE = ${JSON.stringify(SORTIE)};
const TAILLE = ${TAILLE};
const CAPTURE = ${JSON.stringify(CAPTURE)};
// La boîte où chercher le dossier du PREMIER rayon, dans la capture ×2.
const DOSSIER = { x: 37, y: 146, w: 46, h: 40 };
(async () => {
  const donnees = JSON.parse(fs.readFileSync(TRAVAIL + '/pictos.json', 'utf8'));
  const svgs = {};
  for (const c of donnees) for (const p of c.pieces) {
    if (!svgs[p.f]) svgs[p.f] = 'data:image/svg+xml;base64,'
      + fs.readFileSync(TRAVAIL + '/' + p.f).toString('base64');
  }
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await nav.newPage({ viewport: { width: 200, height: 200 } });
  await page.setContent('<canvas id="c" width="' + TAILLE + '" height="' + TAILLE + '"></canvas>');
  for (const c of donnees) {
    const url = await page.evaluate(async ({ c, svgs, TAILLE }) => {
      const images = {};
      await Promise.all(c.pieces.map((p) => new Promise((res, rej) => {
        if (images[p.f]) return res();
        const im = new Image();
        im.onload = () => { images[p.f] = im; res(); };
        im.onerror = rej;
        im.src = svgs[p.f];
      })));
      // La boîte du dessin entier, dans le repère du clip.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of (c.cadre || c.pieces)) {
        const [vx, vy, vw, vh] = p.vb;
        for (const [cx, cy] of [[vx, vy], [vx + vw, vy], [vx, vy + vh], [vx + vw, vy + vh]]) {
          const X = p.m[0] * cx + p.m[2] * cy + p.m[4];
          const Y = p.m[1] * cx + p.m[3] * cy + p.m[5];
          if (X < x0) x0 = X; if (X > x1) x1 = X;
          if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
        }
      }
      const l = x1 - x0, h = y1 - y0;
      const k = Math.min(TAILLE / l, TAILLE / h) * 0.94;
      const cv = document.getElementById('c');
      const g = cv.getContext('2d');
      g.clearRect(0, 0, TAILLE, TAILLE);
      g.save();
      g.translate(TAILLE / 2, TAILLE / 2);
      g.scale(k, k);
      g.translate(-(x0 + l / 2), -(y0 + h / 2));
      for (const p of c.pieces) {
        const [vx, vy] = p.vb;
        g.save();
        g.transform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
        g.drawImage(images[p.f], vx, vy);
        g.restore();
      }
      g.restore();
      return cv.toDataURL('image/png');
    }, { c, svgs, TAILLE });
    fs.writeFileSync(SORTIE + '/' + c.nom + '.png', Buffer.from(url.split(',')[1], 'base64'));
    console.log(c.nom + '.png');
  }
  // Le dossier rose des rubriques, découpé dans la capture du bureau. Le fond
  // est blanc : on le rend transparent, et on dé-multiplie ce blanc pour que le
  // rose antialiasé garde sa teinte sur n'importe quel fond.
  if (CAPTURE) {
    const src64 = 'data:image/png;base64,' + fs.readFileSync(CAPTURE).toString('base64');
    await page.setContent('<img id="cap" src="' + src64 + '">');
    await page.waitForFunction(() => document.getElementById('cap').complete);
    const d = await page.evaluate((B) => {
      const im = document.getElementById('cap');
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      const g2 = cv.getContext('2d');
      g2.drawImage(im, 0, 0);
      const px = g2.getImageData(B.x, B.y, B.w, B.h);
      let x0 = B.w, y0 = B.h, x1 = -1, y1 = -1;
      for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
        const i = (y * B.w + x) * 4;
        if (px.data[i] > 246 && px.data[i + 1] > 246 && px.data[i + 2] > 246) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) return null;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const dst = g2.getImageData(B.x + x0, B.y + y0, w, h);
      for (let i = 0; i < dst.data.length; i += 4) {
        const m = Math.min(dst.data[i], dst.data[i + 1], dst.data[i + 2]);
        const a = Math.min(255, Math.round((255 - m) * 255 / 200));
        if (a <= 0) { dst.data[i + 3] = 0; continue; }
        for (let k = 0; k < 3; k++) {
          const v = (dst.data[i + k] - 255 * (1 - a / 255)) / (a / 255);
          dst.data[i + k] = Math.max(0, Math.min(255, Math.round(v)));
        }
        dst.data[i + 3] = a;
      }
      out.getContext('2d').putImageData(dst, 0, 0);
      return { url: out.toDataURL('image/png'), w, h };
    }, DOSSIER);
    if (!d) console.log('dossier : rien dans la boîte — la capture n\\'est pas cadrée comme attendu.');
    else {
      fs.writeFileSync(SORTIE + '/dossier.png', Buffer.from(d.url.split(',')[1], 'base64'));
      console.log('dossier.png — ' + d.w + 'x' + d.h);
    }
  }
  await nav.close();
})();
`);
execFileSync(process.execPath, [rendu], { stdio: 'inherit' });
console.log(`\n${cellules.length} vignettes dans ${SORTIE}`);
