#!/usr/bin/env node
// Fabrique la vignette du disque Miniwave pour « Mes disques » sur /light.
//
//   node scripts/make-miniwave-disc.js
//
// Les trois autres disques (fd_bandas, fd_grapiz, fd_swapou) sont des rendus de
// FrusionDisc à 93×93 en RGBA. Il n'en existe pas pour Miniwave — on le compose
// donc, mais SANS rien dessiner qui ne vienne du jeu : le fond est le décor du
// jeu (bitmap du SWF), le vaisseau et les fruits sont les sprites extraits du
// SWF. Seule la galette — l'anneau, le trou, le reflet — est tracée ici, et
// elle est la même pour tous les disques.
//
// Le rendu passe par Chromium plutôt que par un encodeur maison : c'est lui qui
// décode le JPEG du décor et les PNG des sprites, et qui compose. Le script ne
// sert qu'une fois — le PNG produit est versionné.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SORTIE = path.join(ROOT, 'public/fb/fd_miniwave.png');
const TAILLE = 93;                                   // comme les trois autres

// Le vaisseau de départ et deux fruits reconnaissables, pris dans les sprites
// extraits. On lit sprites.json pour ne pas coder en dur des noms de fichiers
// qui changeraient à la prochaine extraction.
const sprites = require(path.join(ROOT, 'public/miniwave/sprites/sprites.json'));

function premiereImage(nom) {
  const s = (sprites.sprites || sprites)[nom];
  if (!s) throw new Error('sprite inconnu : ' + nom);
  for (const etat of s.etats) {
    for (const p of etat.pieces) {
      if (/\.png$/.test(p.fichier)) return { fichier: p.fichier, w: p.w, h: p.h };
    }
  }
  throw new Error('pas de bitmap pour ' + nom);
}

const heros = premiereImage('hero0');
const fruits = ['bads0', 'bads2', 'bads5'].map(premiereImage);

const html = `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#0000">
<canvas id="c" width="${TAILLE}" height="${TAILLE}"></canvas>
<script>
const R = ${TAILLE} / 2;
function img(src) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
}
window.fait = Promise.all([
  img('decor/bitmap1.jpg'),
  img('sprites/${heros.fichier}'),
  ${fruits.map((f) => `img('sprites/${f.fichier}')`).join(',\n  ')}
]).then(([decor, hero, ...fr]) => {
  const c = document.getElementById('c'), g = c.getContext('2d');
  g.save();
  // La galette.
  g.beginPath(); g.arc(R, R, R - 0.5, 0, Math.PI * 2); g.clip();

  // Le fond : le haut du décor du jeu — la planète et son champ d'étoiles.
  // Le décor fait 240 de large : on en prend un carré, sans le déformer.
  g.imageSmoothingEnabled = true;
  g.drawImage(decor, 0, 0, decor.width, decor.width, 0, 0, ${TAILLE}, ${TAILLE});

  // Les sprites du jeu sont de la pixel-art de 20 px : les lisser les
  // transformerait en bouillie. On les pose à leur taille, nets.
  g.imageSmoothingEnabled = false;
  // Une escadre de trois fruits en V, et le vaisseau dessous — la scène du jeu.
  // Ils encadrent le moyeu (rayon 18) au lieu de passer dessous, sinon la
  // galette les mangerait.
  fr.forEach((f, i) => {
    g.drawImage(f, 19 + i * 19, 7 + (i === 1 ? -4 : 0));
  });
  g.drawImage(hero, R - hero.width / 2, ${TAILLE} - 25);

  // Le reflet du plastique : une écharpe claire en diagonale.
  const refl = g.createLinearGradient(0, ${TAILLE}, ${TAILLE}, 0);
  refl.addColorStop(0.30, 'rgba(255,255,255,0)');
  refl.addColorStop(0.46, 'rgba(255,255,255,.26)');
  refl.addColorStop(0.54, 'rgba(255,255,255,.26)');
  refl.addColorStop(0.70, 'rgba(255,255,255,0)');
  g.fillStyle = refl; g.fillRect(0, 0, ${TAILLE}, ${TAILLE});

  // L'anneau transparent du centre, puis le moyeu.
  g.beginPath(); g.arc(R, R, 18, 0, Math.PI * 2);
  g.fillStyle = 'rgba(228,236,240,.55)'; g.fill();
  g.beginPath(); g.arc(R, R, 13, 0, Math.PI * 2);
  g.fillStyle = 'rgba(246,250,252,.85)'; g.fill();
  g.restore();

  // Le liseré du bord, et le trou.
  g.beginPath(); g.arc(R, R, R - 1, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.4; g.stroke();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(R, R, 9, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.beginPath(); g.arc(R, R, 9, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke();

  return c.toDataURL('image/png');
});
</script>`;

// PÉRIMÉ — la jaquette servie est désormais une image DESSINÉE, déposée dans
// le dépôt à la main : elle vaut mieux que cette composition de dépannage. Le
// script reste pour mémoire (il documente d'où venait la première version),
// mais il n'écrase plus rien sans qu'on le lui demande explicitement.
if (fs.existsSync(SORTIE) && !process.argv.includes('--force')) {
  console.log(`${SORTIE} existe déjà (jaquette dessinée) — rien à faire.`);
  console.log('Pour la régénérer malgré tout : node scripts/make-miniwave-disc.js --force');
  process.exit(0);
}

(async () => {
  const base = path.join(ROOT, 'public/miniwave');
  const page = path.join(base, '.disque.tmp.html');
  fs.writeFileSync(page, html);
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    const p = await nav.newPage();
    await p.goto('file://' + page);
    const url = await p.evaluate(() => window.fait);
    fs.writeFileSync(SORTIE, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${SORTIE} — ${fs.statSync(SORTIE).size} o, ${TAILLE}×${TAILLE}`);
  } finally {
    await nav.close();
    fs.unlinkSync(page);
  }
})();
