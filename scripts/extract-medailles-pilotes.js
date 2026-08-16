#!/usr/bin/env node
// Sort les MÉDAILLES des jeux nés APRÈS le bureau, pour le portage light.
//
//   node scripts/extract-medailles-pilotes.js        (serveur local sur :3499)
//   BASE=http://127.0.0.1:3000 node scripts/extract-medailles-pilotes.js
//
// Le bureau affiche la médaille de la veille en chargeant public/awards.swf avec
// deux paramètres : `frame` (la vignette du jeu) et `value` (1 or, 2 argent,
// 3 bronze). Le mobile n'a pas de SWF : les médailles des sept jeux d'époque y
// sont déjà des PNG (public/fb/medal_<couleur>_<jeu>.png). Les deux classements
// pilotes n'en avaient pas — d'où cette sortie, prise du MÊME dessin, rendu par
// Ruffle puis photographié sur fond transparent.
//
// Les étiquettes « miniwave » et « minipixiz » d'awards.swf sont les alias posés
// par scripts/patch-awards-vignettes.js ; sans elles, le SWF resterait sur son
// disque vert.

const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3499';
const SORTIE = path.resolve(__dirname, '..', 'public', 'fb');
const TAILLE = 103;                                  // le gabarit des sept autres

const CIBLES = [
  { vignette: 'miniwave', cle: 'miniwave' },
  { vignette: 'minipixiz', cle: 'minipixiz' },
  { vignette: 'minifever', cle: 'minifever' },
];
const RANGS = [[1, 'gold'], [2, 'silver'], [3, 'bronze']];

const page = (vignette, valeur) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: transparent; }
  #hote { width: ${TAILLE}px; height: ${TAILLE}px; }
</style><script src="/ruffle/ruffle.js"></script></head>
<body><div id="hote"></div><script>
window.RufflePlayer = window.RufflePlayer || {};
window.RufflePlayer.config = { autoplay: 'on', unmuteOverlay: 'hidden', contextMenu: 'off',
  warnOnUnsupportedContent: false, logLevel: 'error', wmode: 'transparent', backgroundColor: null };
window.addEventListener('load', function () {
  var p = window.RufflePlayer.newest().createPlayer();
  p.style.width = '${TAILLE}px'; p.style.height = '${TAILLE}px';
  document.getElementById('hote').appendChild(p);
  p.load({ url: '/awards.swf', parameters: { frame: '${vignette}', value: '${valeur}',
    day: '1', scale: '100', flLoadComplete: 'true' }, wmode: 'transparent' });
  window.__pret = true;
});
</script></body></html>`;

(async () => {
  const { chromium } = require('playwright');
  const tmp = path.join(SORTIE, 'medaille-tmp.html');
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const p = await nav.newPage({ viewport: { width: TAILLE, height: TAILLE }, deviceScaleFactor: 1 });
    for (const { vignette, cle } of CIBLES) {
      for (const [valeur, couleur] of RANGS) {
        fs.writeFileSync(tmp, page(vignette, valeur));
        await p.goto(`${BASE}/fb/medaille-tmp.html`, { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__pret, null, { timeout: 20000 });
        await p.waitForTimeout(2500);                 // le clip se pose sur son image
        const cible = path.join(SORTIE, `medal_${couleur}_${cle}.png`);
        await p.locator('#hote').screenshot({ path: cible, omitBackground: true });
        console.log(`${path.basename(cible)} — ${fs.statSync(cible).size} o`);
      }
    }
  } finally {
    await nav.close();
    try { fs.unlinkSync(tmp); } catch { /* déjà parti */ }
  }
})();
