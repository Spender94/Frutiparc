#!/usr/bin/env node
// Les EMBLÈMES de Mini-Fever, pour les deux greffes SWF et le voyant light.
//
//   node scripts/make-minifever-emblemes.js [--force]
//
// Rien n'est dessiné ici qui ne vienne du jeu : la JAQUETTE est le disque déjà
// composé pour la feuille de lancement (public/fb/fd_minifever.svg, quartiers
// des quatre premières épreuves), et l'emblème est LES CERISES — sym544, la
// paire grimaçante de l'écran de fin, le seul personnage que le jeu possède en
// propre. Trois sorties :
//
//   scripts/assets-minifever/disque-122.png    la jaquette, 2× de la boîte
//                                              61×61 du clip 81 de fileIcon.swf
//   scripts/assets-minifever/voyant-34.png     les cerises, 2× de la boîte
//                                              ~17×17 de la feuille d'icônes de
//                                              statut (clip 246 de main.swf)
//   public/fb/voyant_minifever.png             les cerises à 44×44, comme les
//                                              autres voyants du light
//
// (La vignette de MÉDAILLE, elle, n'est pas fabriquée : Mini-Fever emprunte le
// set d'époque inutilisé de Tubulo — patch-awards-minifever.js — comme
// MiniPixiz emprunte celui de Tris. On n'invente pas de médailles.)
//
// Le rendu passe par Chromium (le client du jeu sait poser sym544) et le script
// ne sert qu'une fois : les PNG produits sont versionnés, --force pour refaire.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'scripts/assets-minifever');
const SORTIES = [
  path.join(ASSETS, 'disque-122.png'),
  path.join(ASSETS, 'voyant-34.png'),
  path.join(ROOT, 'public/fb/voyant_minifever.png'),
];

if (!process.argv.includes('--force') && SORTIES.every((f) => fs.existsSync(f))) {
  console.log('les quatre emblèmes existent déjà — rien à faire (--force pour refaire).');
  process.exit(0);
}

const html = `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#0000">
<canvas id="disque" width="122" height="122"></canvas>
<canvas id="voyantB" width="34" height="34"></canvas>
<canvas id="voyantL" width="44" height="44"></canvas>
<script src="/minifever/engine.js"></script>
<script src="/minifever/client.js"></script>
<script>
const C = window.MinifeverClient;
function img(src) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
}
// Les cerises, posées pour remplir une toile : leur boîte fait
// (-34.7,-45.7)-(48.7,31.3) — centre visuel (7,-7.2), 83.4×77 de large.
function cerises(toile) {
  const g = toile.getContext('2d');
  const k = Math.min(toile.width / 83.4, toile.height / 77);
  g.save();
  g.translate(toile.width / 2, toile.height / 2);
  g.scale(k, k);
  C.poser(g, 'sym544', 1, -7, 7.2, 1, 1, 0, 1);
  g.restore();
}
window.fait = Promise.all([C.charger('/minifever/sprites/'), img('/fb/fd_minifever.svg')])
  .then(([m, jaquette]) => {
    const d = document.getElementById('disque');
    d.getContext('2d').drawImage(jaquette, 0, 0, 122, 122);
    cerises(document.getElementById('voyantB'));
    cerises(document.getElementById('voyantL'));
    document.title = 'pret';
  });
</script>`;

(async () => {
  fs.mkdirSync(ASSETS, { recursive: true });
  const scratch = process.env.MF_SCRATCH || '/tmp';
  const page_ = path.join(scratch, 'mf-emblemes.html');
  fs.writeFileSync(page_, html);
  const nav = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  });
  const p = await nav.newPage({ viewport: { width: 400, height: 300 } });
  const base = process.env.MF_BASE || 'http://127.0.0.1:3599';
  await p.goto(base + '/mf/emblemes.html', { waitUntil: 'load' });
  await p.waitForFunction(() => document.title === 'pret');
  const ids = ['disque', 'voyantB', 'voyantL'];
  for (let i = 0; i < 3; i++) {
    const data = await p.evaluate((id) =>
      document.getElementById(id).toDataURL('image/png'), ids[i]);
    fs.writeFileSync(SORTIES[i], Buffer.from(data.split(',')[1], 'base64'));
    console.log('→', path.relative(ROOT, SORTIES[i]));
  }
  await nav.close();
})();
