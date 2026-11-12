#!/usr/bin/env node
// Les 28 PICTOS de JamaJama, redessinés depuis les tracés du jeu.
//
//   node scripts/make-jamajama-pictos.js
//
// L'album d'époque comptait 28 pictos ; leurs images ont disparu avec le
// serveur de 2005, mais une planche de 2007 (28/28) les montre : ce sont les
// ÉLÉMENTS DU JEU — les cinq fruits, les deux aimants, l'araignée et son
// cocon, la bombe, les galets, l'eau, l'archer, le sens unique, la statue de
// jade, Kohl en flammes, les deux Louki, le Lurker, le mur, la rune, Tiki
// sous quatre visages, le Winkle, l'œil — et un dernier qui les réunit.
// Chacun est donc rendu ici depuis les symboles extraits du SWF
// (public/jamajama/sprites, rendu.js), à l'image et à la pose de la planche,
// à l'échelle de la planche, dans 48 × 48 (96 × 60 pour le groupe).
//
// Sorties : Games/poulpi/titems/jamaNN.png (versionnés), dans l'ordre de la
// planche — c'est l'ordre de JAMA_PICTOS dans server.js.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.join(__dirname, '..');
const SORTIE = path.join(ROOT, 'Games/poulpi/titems');

// [symbole, image, surcharge de clips] — une pièce, ou plusieurs pour le groupe
// ({ dx, dy, k } : décalage et échelle dans la composition).
const PICTOS = [
  ['jama_Fruit', 1, { clips: { j: 5 } }, { dx: 0, dy: 0, k: 0.68 }],        // 01 banane
  ['jama_Fruit', 1, { clips: { j: 1 } }, { dx: 0, dy: 0, k: 0.68 }],        // 02 orange
  ['jama_Fruit', 1, { clips: { j: 3 } }, { dx: 0, dy: 0, k: 0.68 }],        // 03 pomme
  ['jama_Fruit', 1, { clips: { j: 2 } }, { dx: 0, dy: 0, k: 0.68 }],        // 04 poire
  ['jama_Fruit', 1, { clips: { j: 4 } }, { dx: 0, dy: 0, k: 0.68 }],        // 05 prune
  ['jama_Magnet', 4],                            // 06 aimant
  ['jama_GoldMagnet', 4],                        // 07 aimant doré
  ['jama_Spider', 2],                            // 08 araignée
  ['jama_Bomb', 1],                              // 09 bombe
  ['jama_Peeble', 1],                            // 10 galets
  ['jama_Spider', 1],                            // 11 cocon
  ['jama_Water', 1, { clips: { j: 1 } }],        // 12 eau
  ['jama_Archer', 3],                            // 13 archer
  ['jama_OneWay', 3],                            // 14 sens unique
  ['jama_Jade', 1],                              // 15 statue de jade
  ['jama_Kohl', 2],                              // 16 Kohl en flammes
  ['jama_Louki', 12],                            // 17 grand Louki
  ['jama_Lurker', 5],                            // 18 Lurker
  ['jama_Wall', 1],                              // 19 mur
  ['jama_Louki', 2],                             // 20 Louki
  ['jama_Rune', 1],                              // 21 rune
  ['heroGFX', 1],                                // 22 Tiki
  ['jama_Hero', 5],                              // 23 Tiki carbonisé
  ['clip562', 17],                               // 24 Tiki surpris
  ['clip562', 6],                                // 25 Tiki joyeux
  ['jama_Winkle', 2],                            // 26 Winkle
  ['jama_Eye', 2],                               // 27 œil
  [[                                             // 28 toute la bande
    ['jama_fx_Fire', 5, null, { dx: -44, dy: -6, k: 1.7 }],
    ['jama_Louki', 12, null, { dx: 2, dy: -26, k: 1.6 }],
    ['jama_Winkle', 2, null, { dx: 40, dy: -16, k: 1.6 }],
    ['jama_Bomb', 1, null, { dx: 20, dy: 0, k: 1.15 }],
    ['clip562', 6, null, { dx: -22, dy: -4, k: 1.7 }],
  ]],
];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const serveur = http.createServer((req, res) => {
  const f = path.join(ROOT, 'public', decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(b);
  });
});

(async () => {
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const port = serveur.address().port;
  const nav = await chromium.launch();
  const page = await nav.newPage();
  await page.goto(`http://127.0.0.1:${port}/jamajama/planche.html?vue=gui`);
  await page.waitForTimeout(2500);
  const images = await page.evaluate((PICTOS) => {
    const G = 1400, K = 6;                        // le grand canevas de travail
    function rendre(pieces, L, H) {
      const c = document.createElement('canvas'); c.width = G; c.height = G;
      const ctx = c.getContext('2d');
      for (const [cle, ref, sur, pose] of pieces) {
        const p = pose || { dx: 0, dy: 0, k: 1 };
        ctx.setTransform(K * p.k, 0, 0, K * p.k, G / 2 + p.dx * K, G / 2 + p.dy * K);
        JamaRendu.dessiner(ctx, cle, ref, sur || null);
      }
      // La boîte de ce qui est peint…
      const d = ctx.getImageData(0, 0, G, G).data;
      let x0 = G, y0 = G, x1 = -1, y1 = -1;
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
        if (d[(y * G + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) throw new Error('rien de peint : ' + pieces[0][0]);
      // …ramenée dans le cadre du picto, centrée, un pixel de marge.
      const o = document.createElement('canvas'); o.width = L; o.height = H;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      // Les pictos gardent la TAILLE RELATIVE des pièces, comme sur la planche
      // d'époque (les fruits et le petit Louki y sont plus petits que le mur) :
      // une case de 35 du jeu fait 46 pixels ; ce qui déborde est ramené au cadre.
      const e = Math.min((L - 2) / w, (H - 2) / h, L === 48 ? 46 / (35 * K) : Infinity);
      const octx = o.getContext('2d');
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(c, x0, y0, w, h, (L - w * e) / 2, (H - h * e) / 2, w * e, h * e);
      return o.toDataURL('image/png');
    }
    return PICTOS.map((p) => (Array.isArray(p[0]) ? rendre(p[0], 96, 60) : rendre([p], 48, 48)));
  }, PICTOS);
  fs.mkdirSync(SORTIE, { recursive: true });
  images.forEach((u, i) => {
    const f = path.join(SORTIE, 'jama' + String(i + 1).padStart(2, '0') + '.png');
    fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64'));
  });
  // La planche de contrôle, pour l'œil (non versionnée si l'on ne veut pas).
  await page.setContent('<body style="margin:8px;background:#fff">' + images.map((u) => `<img src="${u}" style="margin:2px">`).join('') + '</body>');
  await page.screenshot({ path: path.join(SORTIE, '_planche.png'), clip: { x: 0, y: 0, width: 1280, height: 150 } });
  await nav.close();
  serveur.close();
  console.log(images.length + ' pictos écrits dans ' + path.relative(ROOT, SORTIE));
})().catch((e) => { console.error(e); process.exit(1); });
