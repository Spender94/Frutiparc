'use strict';

// Convertit les assets Frutibandas préparés à la main (Games/frutibandas/anim,
// TGA 32 bits) vers public/bandas/assets/ :
//   - images fixes → PNG individuels,
//   - dossiers d'animation (frames 1..N.tga) → UNE bande horizontale PNG
//     (frame 1 à gauche) + nombre de frames consigné dans manifest.json,
//   - cartes (déjà en PNG dans cartes/140) et musiques (snd/musique) copiées.
//
// Sans dépendance : décodeur TGA (types 2 et 10, BGRA) + encodeur PNG (zlib)
// faits maison. Relancer après toute mise à jour des TGA :
//   node scripts/convert-bandas-assets.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.join(__dirname, '..', 'Games', 'frutibandas');
const DST = path.join(__dirname, '..', 'public', 'bandas', 'assets');

// ── TGA ─────────────────────────────────────────────────────────────────────
function decodeTga(buf) {
  const idLen = buf[0];
  const type = buf[2];
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const bpp = buf[16];
  const desc = buf[17];
  if (bpp !== 32 && bpp !== 24) throw new Error(`TGA ${bpp}bpp non géré`);
  const bytes = bpp / 8;
  let off = 18 + idLen;
  const px = Buffer.alloc(w * h * 4);

  const putPixel = (i, b) => {
    px[i * 4] = b[2];          // R (TGA stocke BGR[A])
    px[i * 4 + 1] = b[1];      // G
    px[i * 4 + 2] = b[0];      // B
    px[i * 4 + 3] = bytes === 4 ? b[3] : 255;
  };

  if (type === 2) {
    for (let i = 0; i < w * h; i++) putPixel(i, buf.subarray(off + i * bytes, off + (i + 1) * bytes));
  } else if (type === 10) {
    let i = 0;
    while (i < w * h) {
      const head = buf[off++];
      const count = (head & 0x7f) + 1;
      if (head & 0x80) {                       // paquet RLE : 1 pixel répété
        const b = buf.subarray(off, off + bytes); off += bytes;
        for (let k = 0; k < count; k++) putPixel(i++, b);
      } else {                                 // paquet brut : count pixels
        for (let k = 0; k < count; k++) { putPixel(i++, buf.subarray(off, off + bytes)); off += bytes; }
      }
    }
  } else {
    throw new Error(`TGA type ${type} non géré`);
  }

  // bit 5 du descripteur : 0 = origine en bas → retourner verticalement
  if (!(desc & 0x20)) {
    const flipped = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) px.copy(flipped, y * w * 4, (h - 1 - y) * w * 4, (h - y) * w * 4);
    return { w, h, px: flipped };
  }
  return { w, h, px };
}

// ── PNG ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(typ, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(typ, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) px.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Outils ──────────────────────────────────────────────────────────────────
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function convertOne(src, dst) {
  const img = decodeTga(fs.readFileSync(src));
  ensureDir(path.dirname(dst));
  fs.writeFileSync(dst, encodePng(img.w, img.h, img.px));
  return img;
}
// Bande horizontale depuis un dossier de frames 1..N.tga
function convertStrip(srcDir, dst) {
  const frames = fs.readdirSync(srcDir)
    .filter((f) => /^\d+\.tga$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((f) => decodeTga(fs.readFileSync(path.join(srcDir, f))));
  if (!frames.length) throw new Error(`aucune frame dans ${srcDir}`);
  const fw = frames[0].w, fh = frames[0].h;
  const strip = Buffer.alloc(fw * frames.length * fh * 4);
  frames.forEach((fr, i) => {
    if (fr.w !== fw || fr.h !== fh) throw new Error(`frame de taille différente dans ${srcDir}`);
    for (let y = 0; y < fh; y++) {
      fr.px.copy(strip, (y * fw * frames.length + i * fw) * 4, y * fw * 4, (y + 1) * fw * 4);
    }
  });
  ensureDir(path.dirname(dst));
  fs.writeFileSync(dst, encodePng(fw * frames.length, fh, strip));
  return { frames: frames.length, w: fw, h: fh };
}

// ── Conversion ──────────────────────────────────────────────────────────────
const manifest = { strips: {}, images: {} };

// 1) Images fixes de la page de jeu + communes + souris
const SINGLES = [
  ['anim/game_page/game.tga', 'page/game.png'],
  ['anim/game_page/board.tga', 'page/board.png'],
  ['anim/game_page/banana.tga', 'page/banana.png'],
  ['anim/game_page/orange.tga', 'page/orange.png'],
  ['anim/game_page/empty.tga', 'page/empty.png'],
  ['anim/game_page/anvil.tga', 'page/anvil.png'],
  ['anim/game_page/victory.tga', 'page/victory.png'],
  ['anim/game_page/defeat.tga', 'page/defeat.png'],
  ['anim/game_page/give_up.tga', 'page/give_up.png'],
  ['anim/game_page/give_up_hover.tga', 'page/give_up_hover.png'],
  ['anim/game_page/sound.tga', 'page/sound.png'],
  ['anim/game_page/sound_hover.tga', 'page/sound_hover.png'],
  ['anim/game_page/sound_ctrl.tga', 'page/sound_ctrl.png'],
  ['anim/game_page/sound_lvl.tga', 'page/sound_lvl.png'],
  ['anim/game_page/chat_input.tga', 'page/chat_input.png'],
  ['anim/game_page/chat_input_hover.tga', 'page/chat_input_hover.png'],
  ['anim/game_page/arrow_up.tga', 'page/arrow_up.png'],
  ['anim/game_page/arrow_up_hover.tga', 'page/arrow_up_hover.png'],
  ['anim/game_page/arrow_down.tga', 'page/arrow_down.png'],
  ['anim/game_page/arrow_down_hover.tga', 'page/arrow_down_hover.png'],
  ['anim/game_page/arrow_left.tga', 'page/arrow_left.png'],
  ['anim/game_page/arrow_left_hover.tga', 'page/arrow_left_hover.png'],
  ['anim/game_page/arrow_right.tga', 'page/arrow_right.png'],
  ['anim/game_page/arrow_right_hover.tga', 'page/arrow_right_hover.png'],
  ['anim/common/ok.tga', 'common/ok.png'],
  ['anim/common/ok_hover.tga', 'common/ok_hover.png'],
  ['anim/mouse/normal.tga', 'mouse/normal.png'],
  ['anim/mouse/hover.tga', 'mouse/hover.png'],
  ['anim/mouse/viseur.tga', 'mouse/viseur.png'],
  ['anim/animation/board/select/1.tga', 'anim/board_select.png'],
  ['anim/cartes/140/used.tga', 'cards/used.png'],
];
for (const [src, dst] of SINGLES) {
  const img = convertOne(path.join(SRC, src), path.join(DST, dst));
  manifest.images[dst] = { w: img.w, h: img.h };
  console.log(`png   ${dst}  ${img.w}x${img.h}`);
}

// 2) Bandes d'animation
const STRIPS = [];
for (const fruit of ['banane', 'orange']) {
  for (const anim of ['mv_up', 'mv_down', 'mv_left', 'mv_right',
    'pushed_up', 'pushed_down', 'pushed_left', 'pushed_right',
    'flying_left', 'flying_right', 'petrification']) {
    STRIPS.push([`anim/animation/${fruit}/${anim}`, `anim/${fruit}_${anim}.png`]);
  }
}
STRIPS.push(['anim/animation/board', 'anim/board.png']);
STRIPS.push(['anim/animation/anvil', 'anim/anvil.png']);
STRIPS.push(['anim/animation/cow', 'anim/cow.png']);
STRIPS.push(['anim/animation/cow/trail', 'anim/cow_trail.png']);
for (const [src, dst] of STRIPS) {
  const info = convertStrip(path.join(SRC, src), path.join(DST, dst));
  manifest.strips[dst] = info;
  console.log(`strip ${dst}  ${info.frames}x ${info.w}x${info.h}`);
}

// 3) Bannières d'annonce des cartes (advertiser, statiques 1150x60)
for (const f of fs.readdirSync(path.join(SRC, 'anim/animation/advertiser')).filter((f) => f.endsWith('.tga'))) {
  const dst = `advertiser/${f.replace(/\.tga$/, '.png')}`;
  const img = convertOne(path.join(SRC, 'anim/animation/advertiser', f), path.join(DST, dst));
  manifest.images[dst] = { w: img.w, h: img.h };
  console.log(`png   ${dst}  ${img.w}x${img.h}`);
}

// 4) Cartes (déjà PNG) + icônes audio + musiques
ensureDir(path.join(DST, 'cards'));
for (const f of fs.readdirSync(path.join(SRC, 'anim/cartes/140')).filter((f) => f.endsWith('.png'))) {
  fs.copyFileSync(path.join(SRC, 'anim/cartes/140', f), path.join(DST, 'cards', f));
  console.log(`copy  cards/${f}`);
}
ensureDir(path.join(DST, 'sound'));
for (const f of ['intro.mp3', 'loop.mp3']) {
  fs.copyFileSync(path.join(SRC, 'snd/musique', f), path.join(DST, 'sound', f));
  console.log(`copy  sound/${f}`);
}

fs.writeFileSync(path.join(DST, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('manifest.json écrit —', Object.keys(manifest.strips).length, 'strips,', Object.keys(manifest.images).length, 'images');
