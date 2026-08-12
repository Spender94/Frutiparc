#!/usr/bin/env node
// Fabrique la vignette du disque Minipixiz pour « Mes disques » sur /light.
//
//   node scripts/make-minipixiz-disc.js
//
// Même règle que pour Miniwave (scripts/make-miniwave-disc.js) : rien n'est
// dessiné à la main sinon la galette elle-même — l'anneau, le trou, le reflet,
// identiques d'un disque à l'autre.
//
// La face du disque est une VRAIE partie. Le moteur (public/minipixiz/engine.js)
// tourne ici, en Node, sur une graine fixe : même graine, même plateau, donc le
// script est reproductible. On lui laisse le temps de poser sa pile de départ,
// puis on envoie le plateau à Chromium qui le dessine avec les mêmes dessins et
// la même teinte que le jeu, et on en découpe un carré.
//
// Le SWF n'a pas de décor de forêt en bitmap — ses deux seules images sont
// l'écran « Game Over » et un parchemin de dialogue, ni l'un ni l'autre
// représentatif. Le plateau, lui, EST le jeu.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SORTIE = path.join(ROOT, 'public/fb/fd_minipixiz.png');
const TAILLE = 93;                                   // comme les quatre autres

const sprites = require(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'));
const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));

// GRAINE et NIVEAU sont choisis pour ce qu'ils donnent à voir : trois couleurs,
// des groupes larges et lisibles, deux pierres et une cellule d'impy.
const GRAINE = 3;
const NIVEAU = 24;

// ── Le plateau ────────────────────────────────────────────────────────────
const jeu = new E.Jeu({ graine: GRAINE, niveau: NIVEAU });
for (let i = 0; i < 90; i++) jeu.update(1);   // la pile se pose et les groupes se forment

// L'image de liaison d'un jeton, comme imageJeton() dans public/minipixiz/game.js.
const DIRS = [{ x: 0, y: -1, v: 1 }, { x: 1, y: 0, v: 2 }, { x: 0, y: 1, v: 4 }, { x: -1, y: 0, v: 8 }];
function liaison(e) {
  if (e.special === E.SPECIAL.ARMURE) return 20;
  if (!e.groupe) return 1;
  let f = 1;
  for (const d of DIRS) {
    const v = jeu.element(e.px + d.x, e.py + d.y);
    if (v && v.groupe === e.groupe) f += d.v;
  }
  return f;
}

const plateau = jeu.eList.map((e) => ({
  et: e.et, x: e.px, y: e.py,
  frame: e.et === E.E.JETON ? liaison(e) : Math.max(1, Math.min(3, e.life || 1)),
  couleur: (e.et === E.E.JETON || e.et === E.E.OEIL)
    ? E.COULEURS[(e.et === E.E.OEIL ? e.color : e.type)] || E.COULEURS[0]
    : undefined,
  special: e.special,
}));

// La fenêtre découpée : le bas du plateau, centré en largeur. C'est là que la
// pile se trouve — le haut est vide.
const TS = E.TS;
const FEN_X = Math.round((jeu.xMax * TS - TAILLE) / 2);
const FEN_Y = jeu.yMax * TS - TAILLE + 6;

const html = `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#0000">
<canvas id="c" width="${TAILLE}" height="${TAILLE}"></canvas>
<script>
const T = ${TAILLE}, R = T / 2, TS = ${TS};
const E = ${JSON.stringify({ E: E.E, SPECIAL: E.SPECIAL })};
const sprites = ${JSON.stringify(sprites)};
const plateau = ${JSON.stringify(plateau)};
const FEN_X = ${FEN_X}, FEN_Y = ${FEN_Y};
const images = new Map();
const ANCRE_CENTRE = new Set(['marble', 'star']);
const ECHELLE_PIXEL = new Set(['imp']);

function img(src) {
  return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}

// Copie conforme de rendre() dans public/minipixiz/game.js.
function rendre(cle, frame, taille, couleur) {
  const sprite = sprites[cle];
  const etat = sprite.etats.find((e) => e.frame === frame) || sprite.etats[0];
  const k = ECHELLE_PIXEL.has(cle) ? 1 : taille / 100;
  const zero = ANCRE_CENTRE.has(cle) ? 50 : 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of etat.pieces) {
    x0 = Math.min(x0, p.x + zero); y0 = Math.min(y0, p.y + zero);
    x1 = Math.max(x1, p.x + zero + p.w); y1 = Math.max(y1, p.y + zero + p.h);
  }
  const dx = Math.floor(x0 * k), dy = Math.floor(y0 * k);
  const l = Math.max(1, Math.ceil(x1 * k) - dx), h = Math.max(1, Math.ceil(y1 * k) - dy);
  const c = document.createElement('canvas');
  c.width = l; c.height = h;
  const g = c.getContext('2d');
  for (const p of etat.pieces) {
    const im = images.get(p.fichier);
    if (im) g.drawImage(im, (p.x + zero) * k - dx, (p.y + zero) * k - dy, p.w * k, p.h * k);
  }
  if (couleur !== undefined) {
    const d = g.getImageData(0, 0, l, h), px = d.data;
    const dr = ((couleur >> 16) & 255) - 230, dv = ((couleur >> 8) & 255) - 230, db = (couleur & 255) - 230;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      px[i] = Math.max(0, Math.min(255, px[i] + dr));
      px[i + 1] = Math.max(0, Math.min(255, px[i + 1] + dv));
      px[i + 2] = Math.max(0, Math.min(255, px[i + 2] + db));
    }
    g.putImageData(d, 0, 0);
  }
  return { c, dx, dy };
}
function poser(g, r, x, y) { g.drawImage(r.c, x + r.dx, y + r.dy); }

const CLE = {};
CLE[E.E.JETON] = 'token'; CLE[E.E.PIERRE] = 'stone'; CLE[E.E.CELLULE] = 'impCell';
CLE[E.E.BOMBE] = 'bomb'; CLE[E.E.OBJET] = 'elItem'; CLE[E.E.OEIL] = 'token';

const fichiers = new Set();
for (const s of Object.values(sprites)) for (const e of s.etats) for (const p of e.pieces) fichiers.add(p.fichier);

window.fait = Promise.all([...fichiers].map((f) => img('sprites/' + f).then((i) => { if (i) images.set(f, i); })))
.then(() => {
  const c = document.getElementById('c'), g = c.getContext('2d');
  g.save();
  g.beginPath(); g.arc(R, R, R - 0.5, 0, Math.PI * 2); g.clip();

  // Le fond et le damier des colonnes, comme dans l'aire de jeu.
  g.fillStyle = '#241c3a'; g.fillRect(0, 0, T, T);
  g.fillStyle = 'rgba(255,255,255,.045)';
  for (let x = 0; x * TS < FEN_X + T; x += 2) g.fillRect(x * TS - FEN_X, 0, TS, T);

  // Le plateau, tel que le moteur l'a posé.
  for (const e of plateau) {
    const cle = CLE[e.et];
    if (!cle || !sprites[cle]) continue;
    const x = e.x * TS - FEN_X, y = e.y * TS - FEN_Y;
    if (x < -TS || x > T || y < -TS || y > T) continue;
    poser(g, rendre(cle, e.frame, TS, e.couleur), x, y);
    if (e.special === E.SPECIAL.PERLE && sprites.marble) poser(g, rendre('marble', 1, TS), x, y);
    if (e.special === E.SPECIAL.ETOILE && sprites.star) poser(g, rendre('star', 1, TS), x, y);
    if (e.et === E.E.OEIL) {
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + TS / 2, y + TS / 2, 4, 0, 6.28); g.fill();
      g.fillStyle = '#1a1030'; g.beginPath(); g.arc(x + TS / 2, y + TS / 2, 2, 0, 6.28); g.fill();
    }
  }

  // L'impy, la bestiole du jeu : il sort de sa cellule et ronge la pile. Il est
  // posé à sa taille de jeu, debout sur le haut de la pile.
  if (sprites.imp) poser(g, rendre('imp', sprites.imp.etats[0].frame, TS), 30, 22);

  // Le reflet du plastique, la même écharpe que sur les autres disques.
  const refl = g.createLinearGradient(0, T, T, 0);
  refl.addColorStop(0.30, 'rgba(255,255,255,0)');
  refl.addColorStop(0.46, 'rgba(255,255,255,.26)');
  refl.addColorStop(0.54, 'rgba(255,255,255,.26)');
  refl.addColorStop(0.70, 'rgba(255,255,255,0)');
  g.fillStyle = refl; g.fillRect(0, 0, T, T);

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
  console.log('Pour la régénérer malgré tout : node scripts/make-minipixiz-disc.js --force');
  process.exit(0);
}

(async () => {
  const base = path.join(ROOT, 'public/minipixiz');
  const page = path.join(base, '.disque.tmp.html');
  fs.writeFileSync(page, html);
  const nav = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--allow-file-access-from-files'],
  });
  try {
    const p = await nav.newPage();
    await p.goto('file://' + page);
    const url = await p.evaluate(() => window.fait);
    fs.writeFileSync(SORTIE, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${SORTIE} — ${fs.statSync(SORTIE).size} o, ${TAILLE}×${TAILLE}`
      + ` (graine ${GRAINE}, niveau ${NIVEAU}, ${plateau.length} éléments)`);
  } finally {
    await nav.close();
    fs.unlinkSync(page);
  }
})();
