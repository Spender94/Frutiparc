#!/usr/bin/env node
// Fabrique la vignette du disque Frutisnake pour « Mes disques » sur /light.
//
//   NODE_PATH=<dossier avec playwright-core> node scripts/make-snake3-disc.js
//
// Comme pour les autres jaquettes composées (make-miniwave-disc.js,
// make-jamajama-disc.js) : RIEN n'est dessiné qui ne vienne du jeu — le fond
// est le terrain du SWF, le titre est le sien, la tête et les fruits sont ses
// sprites extraits. Seule la galette (anneau, trou, reflet) est tracée ici,
// la même que sur les autres disques.
//
// Le script ne sert qu'une fois : le PNG produit est versionné. Il passe par
// Chromium (playwright-core, hors dépôt — NODE_PATH) pour décoder les SVG.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const SORTIE = path.join(ROOT, 'public/fb/fd_snake3.png');
const TAILLE = 93;

if (fs.existsSync(SORTIE) && !process.argv.includes('--force')) {
  console.log(`${SORTIE} existe déjà — rien à faire (--force pour régénérer).`);
  process.exit(0);
}

const html = `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#0000">
<canvas id="c" width="${TAILLE}" height="${TAILLE}"></canvas>
<script>
const R = ${TAILLE} / 2;
function img(src) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
}
window.fait = Promise.all([
  img('sprites/backgroundField.svg'),
  img('sprites/title001.svg'),
  img('sprites/tete001.svg'),
  img('sprites/fruits001.svg'),
  img('sprites/fruits040.svg'),
]).then(([champ, titre, tete, fruit1, fruit2]) => {
  const c = document.getElementById('c'), g = c.getContext('2d');
  g.save();
  // La galette.
  g.beginPath(); g.arc(R, R, R - 0.5, 0, Math.PI * 2); g.clip();

  // Le fond : le terrain du jeu, un carré sans déformation.
  g.imageSmoothingEnabled = true;
  const cote = Math.min(champ.width, champ.height);
  g.drawImage(champ, 0, 0, cote, cote, 0, 0, ${TAILLE}, ${TAILLE});

  // Deux fruits qui encadrent le moyeu, la tête du serpent dessous.
  g.drawImage(fruit1, 12, 14, fruit1.width * 0.8, fruit1.height * 0.8);
  g.drawImage(fruit2, ${TAILLE} - 34, 16, fruit2.width * 0.8, fruit2.height * 0.8);
  g.save();
  g.translate(R, ${TAILLE} - 16);
  g.rotate(-Math.PI / 2);
  g.drawImage(tete, -tete.width * 0.45, -tete.height * 0.45, tete.width * 0.9, tete.height * 0.9);
  g.restore();

  // Le titre FrutiSnake en travers du haut.
  const kT = (${TAILLE} - 14) / titre.width;
  g.drawImage(titre, 7, 8, titre.width * kT, titre.height * kT);

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

(async () => {
  const base = path.join(ROOT, 'public/snake3');
  const page = path.join(base, '.disque.tmp.html');
  fs.writeFileSync(page, html);
  const executablePath = process.env.CHROMIUM_PATH
    || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  // En file://, chaque image « souille » le canvas (toDataURL refuse) : on
  // autorise explicitement les fichiers locaux — le script est hors ligne.
  const options = { args: ['--allow-file-access-from-files'] };
  if (fs.existsSync(executablePath)) options.executablePath = executablePath;
  const browser = await chromium.launch(options);
  try {
    const p = await browser.newPage();
    await p.goto('file://' + page);
    const url = await p.evaluate(() => window.fait);
    fs.writeFileSync(SORTIE, Buffer.from(url.split(',')[1], 'base64'));
    console.log('→ ' + SORTIE);
  } finally {
    await browser.close();
    fs.unlinkSync(page);
  }
})();
