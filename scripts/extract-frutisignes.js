#!/usr/bin/env node
// Sort les FRUTISIGNES — les fruits du zodiaque de Frutiparc — pour la fiche
// user du mobile.
//
//   node scripts/extract-frutisignes.js      → écrit public/fb/signe_*.png
//
// ── D'où viennent-ils ──
//
// main.swf ne porte pas les dessins : il charge /frutiSign.swf et fait
// gotoAndStop sur une ÉTIQUETTE (« pomme », « orange »…). Le scénario racine
// de ce fichier pose une forme par section étiquetée — et l'image 1, sans
// étiquette, est le signe encore caché (la silhouette noire).
//
// La fiche du bureau montre le signe en grand et l'ascendant en petit de part
// et d'autre : mêmes dessins, deux tailles — on ne sort qu'une taille, nette.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'public/swf/frutiSign.swf');
const SORTIE = path.join(RACINE, 'public/fb');
const TRAVAIL = path.join(RACINE, 'data/frutisignes-travail');
const TAILLE = 112;                    // affiché ~56 px : deux fois pour les
                                       // écrans denses

fs.mkdirSync(TRAVAIL, { recursive: true });
const r = ouvrir(SWF);

// Le scénario racine : à chaque étiquette sa forme (posée à la même image).
const parImage = new Map();            // image → forme posée
const etiquettes = new Map();          // image → étiquette
r.parcourir((code, corps, len, id, frame) => {
  if (id !== 0) return;
  if (code === 26) {
    const flags = r.b[corps];
    if (flags & 2) parImage.set(frame, r.b.readUInt16LE(corps + 3));
  } else if (code === 43) {
    let e = corps;
    while (e < corps + len && r.b[e] !== 0) e++;
    etiquettes.set(frame, r.b.slice(corps, e).toString('utf8'));
  }
});

// La silhouette du signe caché est à l'image 1, sans étiquette.
const signes = [{ nom: 'mystere', forme: parImage.get(1) }];
for (const [image, nom] of etiquettes) {
  const forme = parImage.get(image);
  if (forme === undefined) continue;
  // « pêche » se range sous un nom de fichier sans accent.
  const propre = nom.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/gi, '').toLowerCase();
  signes.push({ nom: propre, forme });
}

execFileSync(process.execPath,
  [path.join(__dirname, 'extract-swf-shapes.js'), SWF, TRAVAIL,
    ...new Set(signes.map((s) => String(s.forme)))],
  { encoding: 'utf8' });

fs.writeFileSync(path.join(TRAVAIL, 'signes.json'), JSON.stringify(signes));

// Le rendu au navigateur, comme les voyants : les dégradés des fruits ne
// sortent fidèles que d'un vrai moteur.
const rendu = path.join(TRAVAIL, 'rendu.js');
fs.writeFileSync(rendu, `
const { chromium } = require(${JSON.stringify(path.join(RACINE, 'node_modules/playwright'))});
const fs = require('fs');
const TRAVAIL = ${JSON.stringify(TRAVAIL)};
const SORTIE = ${JSON.stringify(SORTIE)};
const TAILLE = ${TAILLE};
(async () => {
  const signes = JSON.parse(fs.readFileSync(TRAVAIL + '/signes.json', 'utf8'));
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await nav.newPage({ viewport: { width: 200, height: 200 } });
  await page.setContent('<canvas id="c" width="' + TAILLE + '" height="' + TAILLE + '"></canvas>');
  for (const s of signes) {
    const svg = fs.readFileSync(TRAVAIL + '/shape' + s.forme + '.svg', 'utf8');
    const m = /viewBox="([-\\d.]+) ([-\\d.]+) ([\\d.]+) ([\\d.]+)"/.exec(svg);
    const vb = [+m[1], +m[2], +m[3], +m[4]];
    const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    const png = await page.evaluate(async ({ url, vb, TAILLE }) => {
      const img = await new Promise((res) => {
        const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url;
      });
      const cv = document.getElementById('c');
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, TAILLE, TAILLE);
      if (img) {
        const k = Math.min(TAILLE / vb[2], TAILLE / vb[3]);
        const l = vb[2] * k, h = vb[3] * k;
        ctx.drawImage(img, (TAILLE - l) / 2, (TAILLE - h) / 2, l, h);
      }
      return cv.toDataURL('image/png');
    }, { url, vb, TAILLE });
    fs.writeFileSync(SORTIE + '/signe_' + s.nom + '.png',
      Buffer.from(png.split(',')[1], 'base64'));
    console.log('signe_' + s.nom + '.png');
  }
  await nav.close();
})();
`);
const res = spawnSync(process.execPath, [rendu], { encoding: 'utf8' });
process.stdout.write(res.stdout || '');
process.stderr.write(res.stderr || '');
console.log('→ public/fb/signe_*.png');
