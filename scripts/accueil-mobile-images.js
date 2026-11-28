#!/usr/bin/env node
'use strict';
/*
 * LES IMAGES NETTES DE L'ACCUEIL DU TÉLÉPHONE (public/images/m/).
 *
 * L'accueil d'époque est en petites images : le logo fait 167 × 74, les
 * vignettes des jeux 150 px. Sur l'écran d'un
 * ordinateur de 2005, c'était le pixel près ; sur un téléphone, qui affiche
 * deux à trois pixels par point, c'est flou. On les agrandit donc ici en xBR —
 * l'algorithme des émulateurs, qui suit les contours des dessins au lieu de les
 * baver — puis on les écrit en WebP.
 *
 * Seul l'accueil du TÉLÉPHONE s'en sert : le bureau garde les images d'origine.
 * Les sources ne sont pas touchées ; relancer ce script refait tout :
 *
 *   node scripts/accueil-mobile-images.js
 *
 * Il faut ffmpeg (avec les filtres xbr et libwebp).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PUB = path.join(__dirname, '..', 'public');
const SORTIE = path.join(PUB, 'images', 'm');
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);

/*
 * Agrandir un dessin DÉTOURÉ : xBR ne connaît pas la transparence. On agrandit
 * donc les couleurs posées sur un fond (celui sur lequel l'image sera vue, pour
 * que le liseré qui tient à moitié du fond prenne la bonne teinte), et l'alpha à
 * part, comme une image en niveaux de gris ; puis on recolle les deux.
 */
function agrandirDetoure(src, dst, facteur, fond, largeur) {
  const [l, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'csv=p=0', src]).toString().trim().split(',').map(Number);
  const reduire = largeur ? ',scale=' + largeur + ':-1:flags=lanczos' : '';
  ff('-i', src, '-filter_complex',
    '[0]format=rgba,split[a][b];color=c=' + fond + ':s=' + l + 'x' + h + '[f];'
    + '[f][a]overlay=format=auto:shortest=1,format=rgb24,xbr=' + facteur + reduire + '[rgb];'
    + '[b]alphaextract,format=rgb24,xbr=' + facteur + reduire + ',format=gray[al];[rgb][al]alphamerge,format=yuva420p',
    '-frames:v', '1', '-c:v', 'libwebp', '-quality', '90', dst);
}

// Une vignette de jeu : carrée, opaque — xBR tout droit.
function agrandirVignette(src, dst) {
  ff('-i', src, '-vf', 'format=rgb24,xbr=2,scale=300:300:flags=lanczos',
    '-frames:v', '1', '-c:v', 'libwebp', '-quality', '88', dst);
}

/*
 * LE LISERÉ DU LOGO. Le logo a été dessiné pour le vert uni du parc : autour
 * des lettres, un halo OPAQUE qui va du blanc (contre les lettres) au vert
 * #AEE868 (au bord) — un dégradé déjà fondu dans ce vert. Sur le ciel du
 * bureau, il disparaît ; sur l'arbre de la scène du téléphone, il dessinait
 * une boîte vert pâle. On le rend à ce qu'il était avant d'être fondu : du
 * BLANC, plus ou moins transparent (la part de blanc se lit sur le bleu, le
 * canal où vert et blanc s'écartent le plus). Seul le halo relié à l'extérieur
 * change — le blanc des reflets, enfermé dans les lettres, ne bouge pas.
 */
function lisereDuLogo(src, dst) {
  const W = 167, H = 74, VERT = [174, 232, 104];
  const px = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  const part = (i) => (px[i + 2] - VERT[2]) / (255 - VERT[2]);      // part de blanc, lue sur le bleu
  const duHalo = (i) => {
    const a = part(i);
    if (px[i + 3] === 0 || a < -0.02 || a > 1.02) return false;
    return Math.abs(px[i] - (VERT[0] + a * (255 - VERT[0]))) < 16
      && Math.abs(px[i + 1] - (VERT[1] + a * (255 - VERT[1]))) < 12;
  };
  const vu = new Uint8Array(W * H);
  const file = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (px[i + 3] === 0 || x === 0 || y === 0 || x === W - 1 || y === H - 1) { if (px[i + 3] === 0 || duHalo(i)) { vu[y * W + x] = 1; file.push(x, y); } }
  }
  while (file.length) {
    const y = file.pop(), x = file.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || vu[ny * W + nx]) continue;
      const i = (ny * W + nx) * 4;
      if (!duHalo(i)) continue;
      vu[ny * W + nx] = 1; file.push(nx, ny);
    }
  }
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    if (!vu[k] || px[i + 3] === 0) continue;
    const a = Math.max(0, Math.min(1, part(i)));
    px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(a * 255);
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
    '-s', W + 'x' + H, '-i', '-', '-frames:v', '1', dst], { input: px });
}

fs.mkdirSync(SORTIE, { recursive: true });
const os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-accueil-'));
// Le logo : son liseré rendu au blanc (ci-dessus), puis ×3, la densité des
// écrans de téléphone. Agrandi sur du blanc, la couleur de son liseré.
lisereDuLogo(path.join(PUB, 'images/logo.png'), path.join(tmp, 'logo.png'));
agrandirDetoure(path.join(tmp, 'logo.png'), path.join(SORTIE, 'logo.webp'), 3, 'white');
for (const f of ['bk', 'frutisnake', 'mb', 'fb', 'swapou', 'grapiz', 'kaluga', 'mwave', 'jamajama', 'mpixiz']) {
  agrandirVignette(path.join(PUB, 'images', f + '.png'), path.join(SORTIE, f + '.webp'));
}
for (const f of fs.readdirSync(SORTIE).sort()) {
  console.log(f.padEnd(16), String(fs.statSync(path.join(SORTIE, f)).size).padStart(7), 'octets');
}
