#!/usr/bin/env node
// Sort les VOYANTS de jeu de main.swf — l'icône qui s'affiche à côté du pseudo
// d'un joueur en pleine partie.
//
//   node scripts/extract-voyants-jeux.js      → écrit public/fb/voyant_*.png
//
// ── D'où viennent-ils ──
//
// Le bureau les tient dans le clip 246 (la feuille d'icônes d'activité, posée
// dans le clip « status » à l'étiquette internal). Le serveur diffuse un code
// INTERNE dans la chaîne de statut de chaque joueur ; StatusMng.analyseStr en
// fait un NOM — le code est un index dans internalList, lu dans le bytecode :
//
//   [ ∅, forum, bkiwi, mb2, swapou2, snake3, bandas, grapiz, kaluga, miniwave ]
//
// et l'affichage fait gotoAndStop(nom) : chaque image du clip porte
// l'ÉTIQUETTE de son jeu. On choisit donc l'image PAR SON ÉTIQUETTE — pas par
// un décalage : la vieille règle « code + 3 » n'était qu'une coïncidence
// partielle, qui donnait à Grapiz le bolide de Burning Kiwi, à Frutibandas la
// tomate de Costomate, à Swapou le lion de Zibal et à Mini-Wave la bille de
// Grapiz.
//
// Le mobile n'a pas de SWF : on sort donc les images en PNG, une par jeu
// jouable, aux mêmes dessins que le bureau.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'legacy/main.swf');
const SORTIE = path.join(RACINE, 'public/fb');
// Les SVG intermédiaires vont dans data/ (hors dépôt) : seuls les PNG comptent.
const TRAVAIL = path.join(RACINE, 'data/voyants-travail');

// Fichier PNG → étiquette d'image du clip 246 (la clé du fichier reste le nom
// que light.html connaît ; l'étiquette est celle du jeu dans le SWF).
const VOYANTS = [
  { jeu: 'bandas', etiquette: 'bandas' },        // le béret rouge
  { jeu: 'grapiz', etiquette: 'grapiz' },        // la bille bleue
  { jeu: 'swapou', etiquette: 'swapou2' },       // la grappe de fruits
  { jeu: 'miniwave', etiquette: 'miniwave' },    // le vaisseau blanc
  { jeu: 'minipixiz', etiquette: 'minipixiz' },  // la fée-papillon
];

// Les ÉTIQUETTES d'images d'un sprite (FrameLabel, code 43), directement dans
// le fichier — swf-sprites.js ne les lit pas.
function etiquettesDuClip(chemin, spriteId) {
  const zlib = require('zlib');
  const raw = fs.readFileSync(chemin);
  const b = raw.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;
  const table = {};
  (function scan(from, to) {
    let o = from;
    while (o < to) {
      const hdr = b.readUInt16LE(o), code = hdr >> 6;
      let len = hdr & 0x3f, hs = 2;
      if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
      if (code === 0) break;
      const corps = o + hs;
      if (code === 39) {
        const sid = b.readUInt16LE(corps);
        if (sid === spriteId) {
          let p = corps + 4, f = 1;
          while (p < corps + len) {
            const h2 = b.readUInt16LE(p), c2 = h2 >> 6;
            let l2 = h2 & 0x3f, hs2 = 2;
            if (l2 === 0x3f) { l2 = b.readUInt32LE(p + 2); hs2 = 6; }
            if (c2 === 0) break;
            if (c2 === 43) {
              let e = p + hs2;
              while (b[e] !== 0) e++;
              table[b.slice(p + hs2, e).toString('latin1')] = f;
            }
            if (c2 === 1) f++;
            p += hs2 + l2;
          }
        } else {
          scan(corps + 4, corps + len);
        }
      }
      o += hs + len;
    }
  })(debut, b.length);
  return table;
}

fs.mkdirSync(TRAVAIL, { recursive: true });
const r = ouvrir(SWF);
const etiquettes = etiquettesDuClip(SWF, 246);
for (const v of VOYANTS) {
  v.image = etiquettes[v.etiquette];
  if (!v.image) throw new Error('étiquette absente du clip 246 : ' + v.etiquette);
}
console.log('images par étiquette : '
  + VOYANTS.map((v) => v.jeu + '=f' + v.image).join(' '));

const cellules = [];
const formes = new Set();
for (const v of VOYANTS) {
  const pieces = r.aplatir(246, r.IDENTITE, 0, v.image, '', null);
  for (const p of pieces) formes.add(p.shape);
  cellules.push({ jeu: v.jeu, pieces });
}
execFileSync(process.execPath,
  [path.join(__dirname, 'extract-swf-shapes.js'), SWF, TRAVAIL, ...[...formes].map(String)],
  { encoding: 'utf8' });

const cadre = (sh) => {
  const t = fs.readFileSync(path.join(TRAVAIL, 'shape' + sh + '.svg'), 'utf8');
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(t);
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
};
const donnees = cellules.map((c) => ({
  jeu: c.jeu,
  pieces: c.pieces.map((pc) => {
    const cb = cadre(pc.shape);
    return { f: 'shape' + pc.shape + '.svg', vb: [cb.x, cb.y, cb.w, cb.h],
      m: [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20] };
  }),
}));
fs.writeFileSync(path.join(TRAVAIL, 'voyants.json'), JSON.stringify(donnees));

// Le rendu se fait au navigateur, comme les sprites de Minipixiz : les SVG du
// jeu utilisent des dégradés que seul un vrai moteur rend fidèlement.
const rendu = path.join(TRAVAIL, 'rendu.js');
fs.writeFileSync(rendu, `
const { chromium } = require(${JSON.stringify(path.join(RACINE, 'node_modules/playwright'))});
const fs = require('fs');
const TRAVAIL = ${JSON.stringify(TRAVAIL)};
const SORTIE = ${JSON.stringify(SORTIE)};
const TAILLE = 44;   // affiché ~22 px : deux fois pour les écrans denses
(async () => {
  const donnees = JSON.parse(fs.readFileSync(TRAVAIL + '/voyants.json', 'utf8'));
  const svgs = {};
  for (const c of donnees) for (const p of c.pieces) {
    if (!svgs[p.f]) svgs[p.f] = 'data:image/svg+xml;base64,'
      + fs.readFileSync(TRAVAIL + '/' + p.f).toString('base64');
  }
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await nav.newPage({ viewport: { width: 100, height: 100 } });
  await page.setContent('<canvas id="c" width="' + TAILLE + '" height="' + TAILLE + '"></canvas>');
  for (const c of donnees) {
    const url = await page.evaluate(async ({ c, svgs, TAILLE }) => {
      const images = {};
      await Promise.all(c.pieces.map((p) => new Promise((res) => {
        if (images[p.f]) return res();
        const i = new Image(); i.onload = () => { images[p.f] = i; res(); }; i.onerror = res;
        i.src = svgs[p.f];
      })));
      const cv = document.getElementById('c');
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, TAILLE, TAILLE);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of c.pieces) {
        const [a, b, cc, d, e, f] = p.m;
        for (const [qx, qy] of [[p.vb[0], p.vb[1]], [p.vb[0] + p.vb[2], p.vb[1]],
          [p.vb[0], p.vb[1] + p.vb[3]], [p.vb[0] + p.vb[2], p.vb[1] + p.vb[3]]]) {
          const X = a * qx + cc * qy + e, Y = b * qx + d * qy + f;
          x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
        }
      }
      const k = Math.min(TAILLE / (x1 - x0), TAILLE / (y1 - y0));
      ctx.translate((TAILLE - (x1 - x0) * k) / 2, (TAILLE - (y1 - y0) * k) / 2);
      ctx.scale(k, k);
      ctx.translate(-x0, -y0);
      for (const p of c.pieces) {
        const img = images[p.f];
        if (!img) continue;
        const [a, b, cc, d, e, f] = p.m;
        ctx.save();
        ctx.transform(a, b, cc, d, e, f);
        ctx.drawImage(img, p.vb[0], p.vb[1], p.vb[2], p.vb[3]);
        ctx.restore();
      }
      return cv.toDataURL('image/png');
    }, { c, svgs, TAILLE });
    fs.writeFileSync(SORTIE + '/voyant_' + c.jeu + '.png',
      Buffer.from(url.split(',')[1], 'base64'));
    console.log('voyant_' + c.jeu + '.png');
  }
  await nav.close();
})();
`);
const res = spawnSync(process.execPath, [rendu], { encoding: 'utf8' });
process.stdout.write(res.stdout || '');
process.stderr.write(res.stderr || '');
console.log('→ public/fb/voyant_*.png');
