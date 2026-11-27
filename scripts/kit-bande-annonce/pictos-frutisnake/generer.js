#!/usr/bin/env node
/*
 * KIT BANDE-ANNONCE — SECTION « pictos-frutisnake » : les 322 fruits de Frutisnake.
 *
 *   node scripts/kit-bande-annonce/pictos-frutisnake/generer.js
 *
 * (port 4470 par défaut, KIT_PORT pour un autre ; sortie dans
 * /home/user/Frutiparc/kit-bande-annonce/pictos-frutisnake, KIT_DIR pour un autre kit.)
 *
 * Ce qui sort :
 *   · originaux/NNNN-nom.png — les 322 pictos d'origine (Games/snake3/gif,
 *     30 × 45), simplement passés de GIF à PNG (transparence gardée), et leur zip ;
 *   · hd/NNNN-nom.png — les mêmes fruits en 512 × 512 transparents, rendus par
 *     LE DESSIN DU JEU : le manifeste des sprites (sprites.json, clip « fruits »)
 *     et le chargeur d'images de public/snake3/dessin.js, dans un vrai Chromium.
 *     Les fruits du jeu sont des SVG : on les peint directement à la taille
 *     voulue (le jeu plafonne sa rastérisation à 4 × 4 ; on fait le même
 *     drawImage du même SVG, sans plafond) — net, rien n'est agrandi. Et leur zip ;
 *   · pictos.json et pictos.csv — n° d'image, identifiant du jeu, nom (sans les
 *     espaces d'époque autour), pourri oui/non ;
 *   · planche-1..3.png — 3840 × 2160 (≈ 1,7 Mo chacune) sur le
 *     vert du site #ADE76B, avec les noms ;
 *   · grille-pop — 10 s en 1920 × 1080 à 60 i/s : les 322 fruits apparaissent
 *     en vague dans une grille de 23 × 14, chacun avec le REBOND D'APPARITION
 *     DU JEU (C.ECHELLES_FRUIT, le clip d'enrobage du SWF à 40 i/s : 0,1 →
 *     1,2 → 1). MP4 sur #ADE76B, WebM transparent, MP4 fond vert, affiche.
 *
 * Numérotation (cf. test/snake3Pictos.test.js) : les images 1 à 300 sont les
 * fruits 1 à 300 ; les images 301 à 322 sont les fruits POURRIS, identifiants
 * 321 à 342 dans le jeu (C.TXT_FRUIT_NAME retire 20 au-delà de 320). Le dessin
 * du jeu (clip « fruits ») est rangé par identifiant : image n → frame
 * n ≤ 300 ? n : n + 20.
 *
 * Capture déterministe : chaque image de la vidéo est CALCULÉE pour son
 * instant (t = i / 60), dessinée sur un canevas, photographiée et poussée
 * dans ffmpeg par un pipe — aucune séquence d'images sur disque.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const S = require('../frusion-fd/serveur.js');
const C = S.C;

const SECTION = 'pictos-frutisnake';
const SORTIE = S.sortie(SECTION);
const SNAKE = require(path.join(C.RACINE, 'public/snake3/const.js'));
const GIFS = path.join(C.RACINE, 'Games/snake3/gif');
const HD = 512;           // côté des PNG HD
const MARGE_HD = 20;      // marge transparente autour du fruit

// ─── La table des 322 pictos ───────────────────────────────────────────────
function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
const PICTOS = [];
for (let n = 1; n <= 322; n++) {
  const id = n <= 300 ? n : n + 20;
  const nom = SNAKE.TXT_FRUIT_NAME(id).trim();
  const base = String(n).padStart(4, '0') + '-' + slug(nom);
  PICTOS.push({ image: n, id, nom, pourri: n > 300, fichier: base + '.png',
    gif: 'snakeFruit' + String(n).padStart(4, '0') + '.gif' });
}

// ─── 1. Les originaux, en PNG ──────────────────────────────────────────────
function originaux() {
  const d = S.sortie(SECTION, 'originaux');
  for (const p of PICTOS) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(GIFS, p.gif),
      '-frames:v', '1', '-vf', 'format=rgba', path.join(d, p.fichier)]);
  }
}

// ─── 2. Les tables ─────────────────────────────────────────────────────────
function tables() {
  const json = PICTOS.map((p) => ({ image: p.image, id_jeu: p.id, nom: p.nom, pourri: p.pourri,
    hd: 'hd/' + p.fichier, original: 'originaux/' + p.fichier, gif_source: 'Games/snake3/gif/' + p.gif }));
  fs.writeFileSync(path.join(SORTIE, 'pictos.json'), JSON.stringify(json, null, 1) + '\n');
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const lignes = ['image,id_jeu,nom,pourri,fichier_hd,fichier_original']
    .concat(PICTOS.map((p) => [p.image, p.id, q(p.nom), p.pourri ? 'oui' : 'non', 'hd/' + p.fichier, 'originaux/' + p.fichier].join(',')));
  // BOM UTF-8 : les accents s'ouvrent justes dans un tableur.
  fs.writeFileSync(path.join(SORTIE, 'pictos.csv'), '﻿' + lignes.join('\n') + '\n');
}

// ─── Le code de page : le dessin du jeu ────────────────────────────────────
/*
 * La page est servie par le vrai serveur (même origine que /snake3/), on y
 * charge const.js et dessin.js du jeu. Pour chaque fruit : D.chargerManifeste()
 * donne la frame du clip « fruits » (fichier SVG + cadre), D.image() la charge
 * comme le jeu, puis on peint le SVG dans un canevas à l'échelle voulue — ce
 * que fait rendreFichier, à la différence du plafond de résolution.
 */
async function preparerPage(navigateur, vue) {
  const ctx = await navigateur.newContext({ viewport: vue, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(C.BASE + '/snake3/sprites/sprites.json');
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent"></body></html>');
  await page.addScriptTag({ url: '/snake3/const.js' });
  await page.addScriptTag({ url: '/snake3/dessin.js' });
  await page.evaluate(async () => {
    const D = window.SnakeDessin;
    await D.chargerManifeste();
    window.__fruit = async function (frame) {
      const f = D.manifeste.clips.fruits.frames[frame];
      const im = D.image(f.fichier);
      if (!im.decodee) await new Promise((ok) => { im.addEventListener('load', ok); im.addEventListener('error', ok); });
      return { im, cadre: f.cadre };
    };
    // Un fruit peint au centre d'un carré `cote` × `cote`, ajusté dans
    // (cote − 2·marge). Rend le canevas.
    window.__peindre = async function (frame, cote, marge) {
      const { im } = await window.__fruit(frame);
      const c = document.createElement('canvas');
      c.width = cote; c.height = cote;
      const g = c.getContext('2d');
      const w = im.naturalWidth, h = im.naturalHeight;
      const k = (cote - 2 * marge) / Math.max(w, h);
      g.imageSmoothingQuality = 'high';
      g.drawImage(im, (cote - w * k) / 2, (cote - h * k) / 2, w * k, h * k);
      return c;
    };
  });
  return page;
}

// ─── 3. Les HD ─────────────────────────────────────────────────────────────
async function hd(page) {
  const d = S.sortie(SECTION, 'hd');
  for (let i = 0; i < PICTOS.length; i += 40) {
    const lot = PICTOS.slice(i, i + 40);
    const urls = await page.evaluate(async ([frames, cote, marge]) => {
      const r = [];
      for (const f of frames) r.push((await window.__peindre(f, cote, marge)).toDataURL('image/png'));
      return r;
    }, [lot.map((p) => p.id), HD, MARGE_HD]);
    urls.forEach((u, j) => fs.writeFileSync(path.join(d, lot[j].fichier), Buffer.from(u.split(',')[1], 'base64')));
  }
}

// ─── 4. Les planches contact ───────────────────────────────────────────────
/*
 * Trois planches 3840 × 2160 (12 × 9 = 108 fruits par planche) : la page HTML
 * pose les fruits HD (déjà rendus) dans une grille, les noms en Verdana (la
 * police du jeu, public/snake3/fontes), le titre en Alba (celle de
 * l'Encyclopéfruit). Les pourris portent une étiquette.
 */
async function planches(navigateur) {
  const ctx = await navigateur.newContext({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(C.BASE + '/snake3/sprites/sprites.json');
  const PAR = 108;
  const fichiers = [];
  for (let k = 0; k < 3; k++) {
    const lot = PICTOS.slice(k * PAR, (k + 1) * PAR);
    const cellules = lot.map((p) => {
      const src = 'data:image/png;base64,' + fs.readFileSync(path.join(SORTIE, 'hd', p.fichier)).toString('base64');
      return '<div class="c' + (p.pourri ? ' pourri' : '') + '"><img src="' + src + '"><div class="n">'
        + '<b>' + p.image + '</b> ' + p.nom.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>'
        + (p.pourri ? '<i>pourri</i>' : '') + '</div>';
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @font-face { font-family: Alba; src: url(/snake3/fontes/alba.woff); }
      @font-face { font-family: VerdanaJeu; src: url(/snake3/fontes/verdana.woff); }
      html, body { margin: 0; width: 3840px; height: 2160px; background: ${C.VERT_PARC}; overflow: hidden; }
      h1 { font: 72px Alba, sans-serif; color: #2f5a07; margin: 0; position: absolute; left: 80px; top: 34px; letter-spacing: 1px; }
      h2 { font: 34px VerdanaJeu, Verdana, sans-serif; color: #3d6c10; margin: 0; position: absolute; right: 80px; top: 64px; }
      .g { position: absolute; left: 60px; top: 150px; width: 3720px; height: 1980px;
           display: grid; grid-template-columns: repeat(12, 1fr); grid-template-rows: repeat(9, 1fr); }
      .c { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; }
      .c img { width: 164px; height: 164px; filter: drop-shadow(0 4px 3px rgba(40,80,0,.28)); }
      .n { font: 21px/1.15 VerdanaJeu, Verdana, sans-serif; color: #1f3d05; text-align: center; width: 290px; margin-top: 2px; }
      .n b { color: #4f8a14; }
      .c i { position: absolute; top: 6px; right: 34px; font: bold 18px VerdanaJeu, Verdana, sans-serif; font-style: normal;
             color: #fff; background: #8a5a9c; border-radius: 12px; padding: 3px 10px; }
    </style></head><body>
      <h1>Frutisnake — les 322 fruits</h1>
      <h2>planche ${k + 1} / 3 · n° ${lot[0].image} à ${lot[lot.length - 1].image}${k === 2 ? ' (301 à 322 : fruits pourris)' : ''}</h2>
      <div class="g">${cellules}</div></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const png = path.join(SORTIE, 'planche-' + (k + 1) + '.png');
    await page.screenshot({ path: png });
    fichiers.push(png);
  }
  await ctx.close();
  return fichiers;
}

// ─── 5. Les aperçus des zips (légers, pour l'index) ────────────────────────
function apercus() {
  const d = S.sortie(SECTION, 'apercus');
  // Douze originaux agrandis ×6 au plus proche voisin, sur le vert du site.
  const choix = [1, 2, 9, 19, 27, 50, 100, 150, 200, 250, 300, 322];
  const entrees = [];
  choix.forEach((n) => entrees.push('-i', path.join(SORTIE, 'originaux', PICTOS[n - 1].fichier)));
  const f = choix.map((_, i) => '[' + i + ':v]scale=180:270:flags=neighbor[s' + i + ']').join(';')
    + ';' + choix.map((_, i) => '[s' + i + ']').join('') + 'hstack=inputs=' + choix.length + ',format=rgba[h];'
    + 'color=c=0xADE76B:s=2160x270[f];[f][h]overlay=format=auto';
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...entrees, '-filter_complex', f,
    '-frames:v', '1', path.join(d, 'originaux.png')]);
  // Les mêmes en HD, réduits à 270 px.
  const e2 = [];
  choix.forEach((n) => e2.push('-i', path.join(SORTIE, 'hd', PICTOS[n - 1].fichier)));
  const f2 = choix.map((_, i) => '[' + i + ':v]scale=270:270:flags=lanczos[s' + i + ']').join(';')
    + ';' + choix.map((_, i) => '[s' + i + ']').join('') + 'hstack=inputs=' + choix.length + ',format=rgba[h];'
    + 'color=c=0xADE76B:s=3240x270[f];[f][h]overlay=format=auto';
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...e2, '-filter_complex', f2,
    '-frames:v', '1', '-q:v', '3', path.join(d, 'hd.jpg')]);
}

function zipper() {
  for (const [nom, dos] of [['pictos-frutisnake-originaux.zip', 'originaux'], ['pictos-frutisnake-hd-512.zip', 'hd']]) {
    const z = path.join(SORTIE, nom);
    try { fs.unlinkSync(z); } catch (e) { /* absent */ }
    execFileSync('zip', ['-q', '-r', '-X', z, dos, 'pictos.csv', 'pictos.json'], { cwd: SORTIE });
  }
}

// ─── 6. La grille qui se remplit ───────────────────────────────────────────
const COLS = 23, LIGNES = 14;                 // 23 × 14 = 322, juste
const L = 1920, H = 1080, FPS = 60, DUREE = 10;
const CEL_X = 1840 / COLS, CEL_Y = 1008 / LIGNES, X0 = 40, Y0 = 36;
const FRUIT = 66;                              // côté de la boîte d'un fruit au repos
const PAS_VAGUE = 0.19;                        // s entre deux diagonales
const DEBUT = 0.25;

async function grille(navigateur) {
  const page = await preparerPage(navigateur, { width: L, height: H });
  // Fond transparent : le MP4 maître est recomposé sur #ADE76B par ffmpeg, et
  // le WebM garde l'alpha.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await page.evaluate(async (o) => {
    const SC = window.SnakeConst;
    const cv = document.createElement('canvas');
    cv.width = o.L; cv.height = o.H;
    cv.style.cssText = 'position:fixed;left:0;top:0';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    // Chaque fruit rendu une fois, à la taille de son pic de rebond (×1,2) :
    // on ne le réduit jamais qu'à partir d'un dessin net.
    const cote = Math.ceil(o.FRUIT * 1.25);
    const tampons = [];
    for (const f of o.frames) tampons.push(await window.__peindre(f, cote, 0));
    // Un petit décalage pseudo-aléatoire (graine fixe) casse la régularité
    // de la vague sans la rendre différente d'un tournage à l'autre.
    let gr = 20061104;
    const alea = () => { gr = (gr * 1103515245 + 12345) & 0x7fffffff; return gr / 0x80000000; };
    const departs = o.frames.map((_, n) => {
      const c = n % o.COLS, l = Math.floor(n / o.COLS);
      return o.DEBUT + (c + l) * o.PAS + alea() * 0.12;
    });
    const E = SC.ECHELLES_FRUIT;
    window.__image = function (t) {
      g.clearRect(0, 0, o.L, o.H);
      for (let n = 0; n < tampons.length; n++) {
        const dt = t - departs[n];
        if (dt < 0) continue;
        // Le clip d'enrobage du jeu : une image tous les 1/40 s, de 1 à 10
        // (le stop() au repos, 100 %), interpolé entre deux images pour les 60 i/s.
        const fi = Math.min(SC.CLIP_STOP - 1, dt * SC.SWF_FPS);
        const a = Math.floor(fi), u = fi - a;
        const k = (E[a] + (E[Math.min(a + 1, SC.CLIP_STOP - 1)] - E[a]) * u) / 1.25;
        const c = n % o.COLS, l = Math.floor(n / o.COLS);
        const cx = o.X0 + (c + 0.5) * o.CEL_X, cy = o.Y0 + (l + 0.5) * o.CEL_Y;
        const s = cote * k;
        g.drawImage(tampons[n], cx - s / 2, cy - s / 2, s, s);
      }
    };
  }, { L, H, FRUIT, COLS, CEL_X, CEL_Y, X0, Y0, PAS: PAS_VAGUE, DEBUT, frames: PICTOS.map((p) => p.id) });

  const enc = C.encodeur({
    mp4: path.join(SORTIE, 'grille-pop.mp4'), fond: C.VERT_PARC,
    webm: path.join(SORTIE, 'grille-pop.webm'),
    vert: path.join(SORTIE, 'grille-pop-vert.mp4'),
  }, { largeur: L, hauteur: H, fps: FPS });
  const n = DUREE * FPS;
  const iAffiche = Math.round(9 * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.__image(t), i / FPS);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    const buf = Buffer.from(r.data, 'base64');
    await enc.ecrire(buf);
    if (i === iAffiche) {
      // L'affiche : la grille pleine, sur le vert du site.
      const tmp = path.join(SORTIE, '.affiche-alpha.png');
      fs.writeFileSync(tmp, buf);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xADE76B:s=1920x1080',
        '-i', tmp, '-filter_complex', '[0][1]overlay=format=auto', '-frames:v', '1', path.join(SORTIE, 'grille-pop.png')]);
      fs.unlinkSync(tmp);
    }
  }
  await enc.fin();
  await page.context().close();
}

// ─── 7. Le manifeste ───────────────────────────────────────────────────────
function manifeste() {
  const taille = (rel) => fs.statSync(path.join(SORTIE, rel)).size;
  const elements = [
    S.entreeVideo(SORTIE, 'grille-pop.mp4', {
      titre: 'Les 322 fruits qui apparaissent', alpha: false, affiche: 'grille-pop.png',
      variantes: ['grille-pop.webm', 'grille-pop-vert.mp4'],
      description: 'Toute la collection de Frutisnake se remplit en vague dans une grille de 23 × 14 : '
        + 'chaque fruit surgit avec le rebond d’apparition du jeu lui-même (le clip d’enrobage du SWF, '
        + '0,1 → 1,2 → 1), dans l’ordre de l’Encyclopéfruit — les 300 fruits puis les 22 pourris en bas à droite. '
        + 'Dessins vectoriels du jeu, nets. MP4 sur le vert du site, WebM transparent, MP4 fond vert.',
      usage: 'Plan « 322 fruits à collectionner » ; la version transparente s’incruste sur un plan de partie ou derrière un titre.',
    }),
    { fichier: 'pictos-frutisnake-hd-512.zip', type: 'autre', titre: 'Les 322 fruits en HD (PNG 512 × 512 transparents)',
      affiche: 'apercus/hd.jpg', octets: taille('pictos-frutisnake-hd-512.zip'), largeur: 512, hauteur: 512, alpha: true,
      description: 'Chaque fruit rendu en 512 × 512 sur fond transparent par le dessin du jeu (ses SVG, chargés par '
        + 'public/snake3/dessin.js) — net à toute taille, rien n’est agrandi. Fichiers « NNNN-nom.png » (n° d’image du picto). '
        + 'Aussi dépliés dans le dossier hd/. Le zip contient pictos.csv et pictos.json.',
      usage: 'Isoler un fruit à l’écran, en faire pleuvoir, illustrer un texte ; à poser sur n’importe quel fond.' },
    { fichier: 'pictos-frutisnake-originaux.zip', type: 'autre', titre: 'Les 322 pictos d’origine (PNG 30 × 45)',
      affiche: 'apercus/originaux.png', octets: taille('pictos-frutisnake-originaux.zip'), largeur: 30, hauteur: 45, alpha: true,
      description: 'Les pictos d’époque (Games/snake3/gif), tels quels, passés de GIF à PNG transparent — ceux que le forum '
        + 'affiche. Mêmes noms de fichiers que la version HD ; aussi dépliés dans le dossier originaux/.',
      usage: 'Le clin d’œil « pixel » : à agrandir au plus proche voisin (sans lissage) pour garder les pixels nets.' },
  ];
  for (let k = 1; k <= 3; k++) {
    elements.push({ fichier: 'planche-' + k + '.png', type: 'image', titre: 'Planche contact ' + k + ' / 3',
      largeur: 3840, hauteur: 2160, alpha: false, octets: taille('planche-' + k + '.png'),
      description: ['Fruits 1 à 108', 'Fruits 109 à 216', 'Fruits 217 à 300, puis les 22 pourris (301 à 322)'][k - 1]
        + ', en 4K sur le vert du site, avec leur numéro et leur nom.',
      usage: 'Choisir ses fruits ; fond de plan « collection » avec un lent travelling.' });
  }
  elements.push({ fichier: 'pictos.csv', type: 'autre', titre: 'La liste des fruits (CSV)', octets: taille('pictos.csv'),
    variantes: ['pictos.json'],
    description: 'Colonnes : n° d’image, identifiant dans le jeu (321 à 342 pour les pourris), nom (sans les espaces '
      + 'd’époque), pourri oui/non, chemins des PNG HD et d’origine. La même chose en JSON en variante.',
    usage: 'Retrouver un fruit par son nom.' });
  const m = {
    section: SECTION, titre: 'Pictos Frutisnake — les 322 fruits',
    texte: 'Toute la collection de fruits de Frutisnake : les 300 fruits et les 22 fruits pourris. Les pictos d’origine '
      + '(30 × 45) et une version HD 512 × 512 transparente rendue par le propre dessin vectoriel du jeu, trois planches '
      + 'contact 4K avec les noms, la liste en CSV/JSON, et une vidéo où la collection apparaît avec le rebond du jeu. '
      + 'L’Encyclopéfruit (le livre de collection du jeu) existe mais ne montre qu’un fruit par page et ne remplit ses '
      + 'pages qu’avec une collection de joueur : on a préféré la grille.',
    elements,
  };
  fs.writeFileSync(path.join(SORTIE, 'manifest.json'), JSON.stringify(m, null, 1) + '\n');
}

async function principal() {
  const etapes = process.argv.slice(2);
  const faire = (e) => !etapes.length || etapes.includes(e);
  if (faire('originaux')) { console.log('originaux, tables…'); originaux(); tables(); }
  const srv = await S.demarrer({ base: false });
  const nav = await chromium.launch();
  try {
    if (faire('hd')) {
      console.log('HD…');
      const page = await preparerPage(nav, { width: 800, height: 600 });
      await hd(page);
      await page.context().close();
    }
    if (faire('planches')) { console.log('planches…'); await planches(nav); }
    if (faire('originaux') || faire('hd')) { apercus(); zipper(); }
    if (faire('video')) { console.log('vidéo…'); await grille(nav); }
  } finally {
    await nav.close();
    srv.arreter();
  }
  if (fs.existsSync(path.join(SORTIE, 'grille-pop.mp4'))) manifeste();
  console.log('fait :', SORTIE);
}

principal().catch((e) => { console.error(e); process.exit(1); });
