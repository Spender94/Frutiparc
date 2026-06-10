/*
 * Aperçu hors-ligne du rendu mobile de Swapou 2.
 *   npm i -D @napi-rs/canvas   (dépendance de dev, non requise par le jeu)
 *   node public/swapou/preview.render.js
 * Outil de dev autonome (ni le serveur ni les tests ne le chargent).
 * Charge le VRAI code du jeu + les VRAIS assets via @napi-rs/canvas, pilote
 * une partie de Challenge jusqu'à un plateau bien rempli, puis compose le
 * rendu exactement comme le ferait le téléphone (rotation « paysage forcé »
 * + échelle de index.html). Produit dans /tmp :
 *   - swapou_game.png      : la frame de jeu brute 700×480 (rendu net)
 *   - swapou_phone_new.png : écran téléphone portrait, version actuelle
 *   - swapou_phone_old.png : écran téléphone portrait, ancien letterbox
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const REPO = path.join(__dirname, '..', '..');
const SWDIR = __dirname;

// police : on enregistre une sans-serif sous l'alias « Verdana » (le jeu
// demande 'Verdana,Arial,sans-serif').
const FONTS = [
  ['Games/frutibandas/anim/fonts/ebrima.ttf', 'Verdana'],
  ['Games/frutibandas/anim/fonts/ebrimabd.ttf', 'Verdana'],
  ['Games/frutibandas/anim/fonts/NotoSans_Regular.ttf', 'Verdana'],
];
for (const [f, name] of FONTS) {
  const p = path.join(REPO, f);
  if (fs.existsSync(p)) { try { GlobalFonts.registerFromPath(p, name); } catch (e) {} }
}

// ── RNG déterministe (LCG) pour un plateau reproductible ────────────────────
let seed = 1234567;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const seededMath = {};
for (const k of Object.getOwnPropertyNames(Math)) seededMath[k] = Math[k];
seededMath.random = rnd;

// ── shim Image : charge depuis le disque, expose l'image napi dans ._img ────
const pending = [];
function NodeImage() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; }
Object.defineProperty(NodeImage.prototype, 'src', {
  set: function (url) {
    const self = this;
    const rel = String(url).replace(/^\/games\/swapou2\//, 'Games/swapou2/');
    const file = path.join(REPO, rel);
    const pr = loadImage(file).then(function (img) {
      self._img = img;
      self.naturalWidth = self.width = img.width;
      self.naturalHeight = self.height = img.height;
      self.complete = true;
      if (self.onload) self.onload();
    }).catch(function () {
      self.complete = true;
      if (self.onerror) self.onerror();
    });
    pending.push(pr);
  },
});

// ── sandbox : on exécute le vrai code client ────────────────────────────────
const sandbox = {
  console: console, setTimeout: setTimeout, URLSearchParams: URLSearchParams,
  performance: { now: function () { return Date.now(); } },
  Date: Date, Math: seededMath, JSON: JSON, Image: NodeImage,
  fetch: function () { return Promise.reject(new Error('no-net')); },
};
sandbox.self = sandbox; sandbox.window = sandbox;
vm.createContext(sandbox);
['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(SWDIR, f), 'utf8'), sandbox, { filename: f });
});
const SW = sandbox.SW;
const A = SW.A;           // SwapouAssets, exposé par game.js
const Manager = SW.Manager;

// ── contexte canvas : drawImage déballe le NodeImage ────────────────────────
function wrapCtx(ctx) {
  return new Proxy(ctx, {
    get: function (t, p) {
      if (p === 'drawImage') {
        return function (img) {
          const real = (img && img._img) ? img._img : img;
          const args = Array.prototype.slice.call(arguments, 1);
          return t.drawImage.apply(t, [real].concat(args));
        };
      }
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set: function (t, p, v) { t[p] = v; return true; },
  });
}

function pump(n, tmod) {
  tmod = tmod || 1;
  for (let i = 0; i < n; i++) Manager.main(tmod, tmod / 40);
}
// privilégie un échange horizontal qui crée un combo (look naturel : poches
// vidées, fruits spéciaux), sinon le premier échange légal
function findSwap(lvl) {
  let fallback = null;
  for (let x = 0; x < lvl.width - 1; x++)
    for (let y = 0; y < lvl.height; y++) {
      const f1 = lvl.getFruit(x, y), f2 = lvl.getFruit(x + 1, y);
      if (!(f1 && f2 && f1.canSwap() && f2.canSwap())) continue;
      if (!fallback) fallback = { x: x, y: y };
      lvl.swapPair({ x: x, y: y, dx: 1, dy: 0 });
      const c = lvl.calc();
      lvl.swapPair({ x: x, y: y, dx: 1, dy: 0 }); // revert
      if (c != null) return { x: x, y: y };
    }
  return fallback;
}

(async function main() {
  // charge tous les assets puis attend la fin des décodages disque
  await A.loadImages(function () {});
  await Promise.all(pending);

  // partie de Challenge (Dimitri), plateau rempli comme la capture
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.players = [0, -1];
  SW.Manager.client = new SW.Client();        // standalone
  SW.Manager.client.connected = true;
  SW.Manager.client.slots = [{ $chars: [true, true], $items: [], $combos: [] }, null];
  SW.Data.chars = SW.Manager.client.slots[0].$chars;
  Manager.mode = new SW.Challenge();
  const chal = Manager.mode;

  // joue quelques tours pour remplir la pile (~mi-hauteur, comme la capture)
  let turns = 0, guard = 0;
  while (turns < 7 && guard++ < 60000 && Manager.mode === chal) {
    if (!chal.lock) {
      const sw = findSwap(chal.player.level);
      if (!sw) break;
      const info = chal.player.animator.getInfos();
      SW.handleMouseMove(info.px + sw.x * 35 + 30, info.py + sw.y * 35 + 17);
      chal.onClickDown();
      turns++;
    }
    pump(1, 1);
  }
  // laisse les animations se poser
  let g2 = 0;
  while (chal.lock && g2++ < 4000) pump(1, 1);
  pump(8, 1);

  // simule un doigt posé sur une paire → le sélecteur orange est visible.
  // on vise une case bien remplie (vers le haut de la pile) pour la lisibilité.
  let touchPt = null;
  {
    const lvl = chal.player.level;
    const info = chal.player.animator.getInfos();
    // première colonne dont une case haute est occupée, voisin de droite aussi
    outer:
    for (let y = 0; y < lvl.height; y++)
      for (let x = 0; x < lvl.width - 1; x++) {
        const f1 = lvl.getFruit(x, y), f2 = lvl.getFruit(x + 1, y);
        if (f1 && f2 && f1.canSwap() && f2.canSwap()) {
          touchPt = { px: info.px + x * 35 + 30, py: info.py + y * 35 + 17 };
          break outer;
        }
      }
    if (touchPt) {
      SW.handleTouchStart(touchPt.px, touchPt.py);
      pump(1, 1); // displayPair() positionne le rollover
    }
  }
  console.log('sélecteur visible:', chal.interf.rollover.visible);

  // ── 1) frame de jeu brute 700×480 ──
  const game = createCanvas(700, 480);
  const gctx = wrapCtx(game.getContext('2d'));
  Manager.draw(gctx);
  fs.writeFileSync('/tmp/swapou_game.png', game.toBuffer('image/png'));

  // ── compositeur « écran téléphone » ──
  // reproduit la logique de index.html (portrait → rotation 90° + échelle)
  function phone(file, mode) {
    const W = 390, H = 844; // gabarit portrait type
    const cv = createCanvas(W, H);
    const c = cv.getContext('2d');
    c.fillStyle = '#24330e'; // body bg
    c.fillRect(0, 0, W, H);
    const scale = (mode === 'new')
      ? Math.min(W / 480, H / 700)  // paysage forcé (rotation)
      : Math.min(W / 700, H / 480); // ancien letterbox
    c.save();
    c.translate(W / 2, H / 2);
    if (mode === 'new') c.rotate(Math.PI / 2);
    c.scale(scale, scale);
    c.drawImage(game, -350, -240);
    c.restore();
    fs.writeFileSync(file, cv.toBuffer('image/png'));
    return { scale: scale };
  }
  const nu = phone('/tmp/swapou_phone_new.png', 'new');
  const ol = phone('/tmp/swapou_phone_old.png', 'old');

  // ── 4) gros plan du sélecteur de paire + repère « doigt » ──
  if (touchPt) {
    const Z = 3.2, cw = 230, ch = 170; // fenêtre logique autour du doigt
    const ox = Math.max(0, Math.min(700 - cw, touchPt.px - cw / 2));
    const oy = Math.max(0, Math.min(480 - ch, touchPt.py - ch / 2));
    const zc = createCanvas(Math.round(cw * Z), Math.round(ch * Z));
    const zx = zc.getContext('2d');
    zx.imageSmoothingEnabled = true;
    zx.drawImage(game, ox, oy, cw, ch, 0, 0, cw * Z, ch * Z);
    // doigt : disque translucide au point de contact
    const fx = (touchPt.px - ox) * Z, fy = (touchPt.py - oy) * Z;
    zx.beginPath();
    zx.arc(fx, fy, 34, 0, Math.PI * 2);
    zx.fillStyle = 'rgba(255,255,255,0.28)';
    zx.fill();
    zx.lineWidth = 3;
    zx.strokeStyle = 'rgba(255,255,255,0.7)';
    zx.stroke();
    zx.font = 'bold 18px Verdana';
    zx.fillStyle = '#fff';
    zx.textAlign = 'center';
    zx.fillText('appui : aperçu de l\'échange', zc.width / 2, 26);
    fs.writeFileSync('/tmp/swapou_selector.png', zc.toBuffer('image/png'));
  }

  console.log('rendu OK — tours joués:', turns);
  console.log('échelle paysage forcé:', nu.scale.toFixed(3),
    '| ancien letterbox:', ol.scale.toFixed(3),
    '| gain ×', (nu.scale / ol.scale).toFixed(2));
})().catch(function (e) { console.error(e); process.exit(1); });
