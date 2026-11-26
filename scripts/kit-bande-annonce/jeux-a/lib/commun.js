/*
 * Kit bande-annonce — section « jeux-a » : la boîte à outils commune.
 *
 * Tout ce que les scripts de jeu partagent :
 *
 *   · le SERVEUR local (lancé sans base si personne n'écoute déjà le port) ;
 *   · l'HORLOGE VIRTUELLE injectée dans la page avant tout script du jeu :
 *     performance.now, Date.now, requestAnimationFrame, setTimeout et
 *     setInterval ne bougent que quand la capture le décide. Une image filmée
 *     = exactement 1/60 s de jeu, quelle que soit la charge de la machine ;
 *   · le TUYAU vers ffmpeg : chaque image (capture d'écran PNG) part dans
 *     l'entrée standard d'ffmpeg (image2pipe) — aucune séquence d'images
 *     n'est jamais écrite sur le disque ;
 *   · l'AFFICHE (une image PNG 1920×1080 choisie dans le clip) et le
 *     MANIFESTE (un fichier par jeu, fusionnés par tout.js).
 *
 * Aucune de ces pièces ne touche aux fichiers du jeu : les crochets dont un
 * script a besoin sont posés DANS la page, au moment de la capture.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const RACINE = path.resolve(__dirname, '../../../..');            // le dépôt
const SORTIE = process.env.KIT_SORTIE || '/home/user/Frutiparc/kit-bande-annonce/jeux-a';
const PORT = Number(process.env.KIT_PORT || 4200);
const BASE = `http://127.0.0.1:${PORT}`;
const FPS = 60;
const LARGEUR = 1920, HAUTEUR = 1080;

// ─── Le serveur ────────────────────────────────────────────────────────────

function repond(url) {
  return new Promise((ok) => {
    const req = http.get(url, (res) => { res.resume(); ok(res.statusCode > 0); });
    req.on('error', () => ok(false));
    req.setTimeout(2000, () => { req.destroy(); ok(false); });
  });
}

let serveurLance = null;
/** Démarre le site en local (mémoire, sans base) si le port est libre. */
async function serveur() {
  if (await repond(BASE + '/')) return;
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
    ADMIN_KEY: process.env.KIT_ADMIN_KEY || 'kit-jeux-a', XMLSOCKET_PORT: String(PORT + 1), FRUTISCORE_PORT: String(PORT + 2),
  });
  serveurLance = spawn(process.execPath, ['server.js'], { cwd: RACINE, env, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await repond(BASE + '/')) return;
  }
  throw new Error('le serveur local ne répond pas sur ' + BASE);
}
function arreterServeur() { if (serveurLance) { serveurLance.kill(); serveurLance = null; } }

// ─── L'horloge virtuelle (injectée dans la page) ──────────────────────────

/*
 * Le temps de la page part de T0 = 10 000 000 ms : loin de l'horodatage réel
 * des événements (ev.timeStamp, en millisecondes depuis l'ouverture de la
 * page). Un jeu qui date ses frappes (Burning Kiwi) les trouve donc
 * « invraisemblables » et les compte à l'instant où il les traite — l'instant
 * virtuel, celui de l'image filmée.
 */
function scriptHorloge() {
  /* eslint-disable no-undef */
  const T0 = 10000000;
  let t = T0;
  const dateBase = Date.now();
  const DateNow = Date.now.bind(Date);
  let seq = 0;
  const minuteurs = new Map();                 // id → { a, f, args, periode }
  let rafs = [];                               // [{ id, f }]
  let rafId = 0;
  let annules = new Set();
  const perf = window.performance;
  try { Object.defineProperty(perf, 'now', { value: () => t, configurable: true, writable: true }); }
  catch (e) { perf.now = () => t; }
  Date.now = () => dateBase + (t - T0);
  window.requestAnimationFrame = (f) => { const id = ++rafId; rafs.push({ id, f }); return id; };
  window.cancelAnimationFrame = (id) => { annules.add(id); };
  const poser = (f, d, args, periode) => {
    const id = ++seq;
    minuteurs.set(id, { a: t + Math.max(0, Number(d) || 0), f, args, periode, s: id });
    return id;
  };
  window.setTimeout = (f, d, ...args) => poser(f, d, args, null);
  window.setInterval = (f, d, ...args) => poser(f, d, args, Math.max(1, Number(d) || 1));
  window.clearTimeout = window.clearInterval = (id) => { minuteurs.delete(id); };
  const lancer = (m) => {
    try { if (typeof m.f === 'function') m.f(...(m.args || [])); else if (typeof m.f === 'string') (0, eval)(m.f); }
    catch (e) { console.error(e); }
  };
  // Joue les minuteurs échus jusqu'à `limite`, dans l'ordre de leurs heures.
  const minuteursJusqua = (limite) => {
    for (let garde = 0; garde < 100000; garde++) {
      let pro = null, proId = 0;
      for (const [id, m] of minuteurs) if (m.a <= limite && (!pro || m.a < pro.a || (m.a === pro.a && m.s < pro.s))) { pro = m; proId = id; }
      if (!pro) return;
      if (pro.a > t) t = pro.a;
      if (pro.periode) { pro.a += pro.periode; pro.s = ++seq; } else minuteurs.delete(proId);
      lancer(pro);
    }
  };
  window.__horloge = {
    T0,
    get t() { return t; },
    reel: DateNow,
    /** Avance de `ms` : les minuteurs échus, puis UNE image (les rAF en attente). */
    avancer(ms) {
      const fin = t + ms;
      minuteursJusqua(fin);
      t = fin;
      const lot = rafs; rafs = [];
      const ann = annules; annules = new Set();
      for (const r of lot) {
        if (ann.has(r.id)) continue;
        try { r.f(t); } catch (e) { console.error(e); }
      }
    },
    /** Les minuteurs seuls (sans image) — pendant un chargement. */
    minuteurs(ms) { const fin = t + ms; minuteursJusqua(fin); t = fin; },
    attente() { return { rafs: rafs.length, minuteurs: minuteurs.size }; },
  };
  /* eslint-enable no-undef */
}

// ─── Le navigateur ─────────────────────────────────────────────────────────

async function navigateur() {
  const { chromium } = require('playwright');
  return chromium.launch({ args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
}

/**
 * Une page 1920×1080 à l'horloge virtuelle. `echelle` : le deviceScaleFactor
 * (1 par défaut — la plupart des jeux tracent à la taille affichée).
 */
async function nouvellePage(nav, opts) {
  const o = opts || {};
  const ctx = await nav.newContext({
    viewport: { width: o.largeur || LARGEUR, height: o.hauteur || HAUTEUR },
    deviceScaleFactor: o.echelle || 1,
    hasTouch: false, isMobile: false,
    locale: 'fr-FR', timezoneId: 'Europe/Paris',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('  [page] ' + (e && e.message)));
  if (o.journal) page.on('console', (m) => console.log('  [console] ' + m.text()));
  if (o.horloge !== false) await page.addInitScript(scriptHorloge);
  if (o.css) await page.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    });
  }, o.css);
  return page;
}

/** Avance l'horloge de `n` images (1/60 s chacune), sans filmer. */
async function avancer(page, n, pas) {
  const ms = pas || 1000 / FPS;
  await page.evaluate(([k, d]) => { for (let i = 0; i < k; i++) window.__horloge.avancer(d); }, [n, ms]);
}

/**
 * Attend une condition (évaluée dans la page) en laissant battre l'horloge —
 * pour les chargements, qui eux vivent en temps réel (réseau, décodage).
 */
async function attendre(page, condition, opts) {
  const o = opts || {};
  const max = o.max || 60000;
  const debut = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await page.evaluate(condition, o.arg); } catch (e) { ok = false; }
    if (ok) return true;
    if (Date.now() - debut > max) throw new Error('attente trop longue : ' + (o.nom || String(condition).slice(0, 80)));
    await avancer(page, o.images || 2);
    await new Promise((r) => setTimeout(r, o.repos || 15));
  }
}

// ─── Le tuyau vers ffmpeg ──────────────────────────────────────────────────

// Trois fils d'encodage : la machine est partagée, et chaque fil de plus coûte de la mémoire.
const MP4 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '3'];

/** Un encodeur ffmpeg qui lit des PNG sur son entrée standard. */
function encodeur(fichier, opts) {
  const o = opts || {};
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(o.fps || FPS), '-c:v', 'png', '-i', '-']
    .concat(o.filtre ? ['-vf', o.filtre] : [])
    .concat(o.codec || MP4, [fichier]);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'inherit'] });
  const fini = new Promise((ok, ko) => ff.on('close', (c) => (c === 0 ? ok() : ko(new Error('ffmpeg a échoué (' + c + ') pour ' + fichier)))));
  let n = 0;
  return {
    get images() { return n; },
    async ecrire(png) {
      n++;
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    },
    async fermer() { ff.stdin.end(); await fini; },
  };
}

/*
 * Une capture d'écran PNG par le protocole de débogage, en mode « rapide »
 * (compression zlib légère) : ~140 ms l'image en 1080p au lieu de ~450 ms
 * pour page.screenshot, et toujours sans perte.
 */
const sessions = new WeakMap();
async function capture(page, clip) {
  let cdp = sessions.get(page);
  if (!cdp) { cdp = await page.context().newCDPSession(page); sessions.set(page, cdp); }
  const p = { format: 'png', optimizeForSpeed: true };
  if (clip) p.clip = Object.assign({ scale: 1 }, clip);
  const r = await cdp.send('Page.captureScreenshot', p);
  return Buffer.from(r.data, 'base64');
}

/**
 * Filme `n` images : à chaque image, `avant(i)` (les commandes du joueur, dans
 * la page ou au clavier), l'horloge avance d'1/60 s, puis la capture.
 * `affiche` : l'indice de l'image gardée en PNG (ou une fonction (i) → bool).
 */
async function filmer(page, fichier, n, opts) {
  const o = opts || {};
  // `pas` : le temps de jeu par image filmée. 1/60 s par défaut ; 25 ms pour
  // les jeux à 40 pas par seconde (une image par pas, voir INTERMEDIAIRE).
  const pas = o.pas || 1000 / FPS;
  const enc = encodeur(fichier, Object.assign({ fps: Math.round(1000 / pas) }, o));
  const clip = o.clip || undefined;
  let afficheFaite = false;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    if (o.avant) await o.avant(i);
    await page.evaluate((d) => window.__horloge.avancer(d), pas);
    if (o.apres) await o.apres(i);
    const png = await capture(page, clip);
    await enc.ecrire(png);
    const garder = typeof o.affiche === 'function' ? o.affiche(i) : i === o.affiche;
    if (garder && o.fichierAffiche) { fs.writeFileSync(o.fichierAffiche, png); afficheFaite = true; }
  }
  await enc.fermer();
  if (o.fichierAffiche && !afficheFaite) fs.writeFileSync(o.fichierAffiche, await capture(page, clip));
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✔ ${path.basename(fichier)} — ${n} images (${(n * pas / 1000).toFixed(2)} s) en ${s} s`);
  return { fichier, images: n, duree: n * pas / 1000 };
}

/*
 * LES JEUX À 40 PAS PAR SECONDE (Burning Kiwi, Kaluga, Frutisnake : la
 * cadence du SWF d'origine). Ils ne redessinent que quand un pas a été joué :
 * filmés à 60 i/s, une image sur trois répète la précédente. On les filme donc
 * à 40 i/s — une image par pas, toutes différentes — dans un fichier
 * INTERMÉDIAIRE quasi sans perte (scratchpad), d'où l'on tire ensuite les
 * plans : le maître à 60 i/s (images répétées au rythme 2-1, exactement ce
 * qu'affiche un écran à 60 Hz) et une variante native à 40 i/s, sans aucune
 * répétition, pour qui veut conformer le rythme au montage.
 */
const INTERMEDIAIRE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '6', '-pix_fmt', 'yuv420p', '-g', '20'];
const DOSSIER_TEMP = process.env.KIT_TEMP || path.join(require('os').tmpdir(), 'kit-jeux-a');

/** Coupe [debut, debut+duree] (secondes) d'une source, à `fps` (60 : maître ; null : cadence d'origine). */
function couper(source, debut, duree, sortie, fps) {
  const { execFileSync } = require('child_process');
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  const vf = fps ? ['-vf', `fps=${fps}`] : [];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(debut), '-i', source, '-t', String(duree)]
    .concat(vf, MP4, ['-an', sortie]));
  return sortie;
}

/** Une image (à `t` secondes) d'une vidéo, en PNG. */
function image(source, t, sortie) {
  const { execFileSync } = require('child_process');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', source, '-frames:v', '1', sortie]);
  return sortie;
}

// ─── ffprobe ───────────────────────────────────────────────────────────────

function sonder(fichier) {
  const { execFileSync } = require('child_process');
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,r_frame_rate,nb_frames,codec_name:format=duration', '-of', 'json', fichier], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const s = j.streams[0] || {};
  const [a, b] = String(s.r_frame_rate || '0/1').split('/').map(Number);
  return { largeur: s.width, hauteur: s.height, fps: b ? a / b : 0, duree: Number((j.format || {}).duration) || 0, images: Number(s.nb_frames) || 0, codec: s.codec_name };
}

function sonderSon(fichier) {
  const { execFileSync } = require('child_process');
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', fichier], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const s = (j.streams || [])[0] || {};
  return { duree: Number((j.format || {}).duration) || 0, codec: s.codec_name, frequence: Number(s.sample_rate) || 0, canaux: s.channels };
}

// ─── Le manifeste (un morceau par jeu) ─────────────────────────────────────

/*
 * Chaque script de jeu écrit `<jeu>/manifest-partiel.json` (ses éléments,
 * avec le champ "jeu"), et tout.js — ou n'importe quel script à la fin —
 * refait `manifest.json` de la section à partir de tous les morceaux présents.
 */
function ecrireManifesteJeu(jeu, elements) {
  const dossier = path.join(SORTIE, jeu);
  fs.mkdirSync(dossier, { recursive: true });
  const els = elements.map((e) => Object.assign({ jeu }, e, { fichier: path.posix.join(jeu, e.fichier) },
    e.affiche ? { affiche: path.posix.join(jeu, e.affiche) } : {},
    e.variantes ? { variantes: e.variantes.map((v) => path.posix.join(jeu, v)) } : {}));
  fs.writeFileSync(path.join(dossier, 'manifest-partiel.json'), JSON.stringify(els, null, 2) + '\n');
  refaireManifeste();
}

const TITRES_JEUX = {
  swapou: 'Swapou', snake3: 'Frutisnake 3', bkiwi: 'Burning Kiwi', kaluga: 'Kaluga', minifever: 'Mini-Fever', minipixiz: 'MiniPixiz',
};

function refaireManifeste() {
  const elements = [];
  for (const jeu of Object.keys(TITRES_JEUX)) {
    const f = path.join(SORTIE, jeu, 'manifest-partiel.json');
    if (fs.existsSync(f)) elements.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  const m = {
    section: 'jeux-a',
    titre: 'Jeux (A) — Swapou, Frutisnake 3, Burning Kiwi, Kaluga, Mini-Fever, MiniPixiz',
    texte: 'Séquences de jeu « attract mode » filmées dans les vraies pages du site (portages JS), image par image ' +
      'sur une horloge virtuelle (60 i/s exactes, aucune image perdue), cadrées en 1920×1080 sur le vert du parc ' +
      '#ADE76B. Pour chaque jeu : 2 à 3 plans de jeu, un plan de titre/menu, la jaquette du disque en PNG, la ' +
      'musique et quelques bruitages d\'origine (sons/). Les vidéos sont muettes ; les sons sont à poser au montage. ' +
      'Chaque élément porte le champ "jeu".',
    jeux: TITRES_JEUX,
    elements,
  };
  // Ce qui manque encore, dit franchement dans le manifeste.
  const sansVideo = Object.keys(TITRES_JEUX).filter((j) => !elements.some((e) => e.jeu === j && e.type === 'video'));
  if (sansVideo.length) m.texte += ` Premier kit, incomplet : pas encore de vidéo pour ${sansVideo.map((j) => TITRES_JEUX[j]).join(', ')} (jaquette seulement).`;
  fs.writeFileSync(path.join(SORTIE, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
}

/** Un élément vidéo du manifeste, mesuré par ffprobe. */
function elementVideo(jeu, fichier, infos) {
  const p = sonder(path.join(SORTIE, jeu, fichier));
  return Object.assign({ fichier, type: 'video' }, infos, {
    duree: Math.round(p.duree * 100) / 100, fps: Math.round(p.fps), largeur: p.largeur, hauteur: p.hauteur, alpha: false,
  });
}

/** Les sons : copie (ou conversion OGG pour les MP3) et éléments du manifeste. */
function copierSons(jeu, sons) {
  const { execFileSync } = require('child_process');
  const dossier = path.join(SORTIE, jeu, 'sons');
  fs.mkdirSync(dossier, { recursive: true });
  const els = [];
  for (const s of sons) {
    const src = path.join(RACINE, s.source);
    if (!fs.existsSync(src)) { console.warn('  ✘ son introuvable : ' + s.source); continue; }
    const ext = path.extname(src).toLowerCase();
    const nom = (s.nom || path.basename(src, ext)) + (ext === '.wav' || ext === '.ogg' ? ext : '.ogg');
    const dest = path.join(dossier, nom);
    if (ext === '.wav' || ext === '.ogg') fs.copyFileSync(src, dest);
    // MP3 → OGG Vorbis (qualité 8 : transparent), sans rien couper ni rééchantillonner.
    else execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', '8', dest]);
    const p = sonderSon(dest);
    els.push({
      fichier: path.posix.join('sons', nom), type: 'son', titre: s.titre, description: s.description + ' (fichier du site : ' + s.source + ')',
      usage: s.usage, duree: Math.round(p.duree * 100) / 100, boucle: !!s.boucle,
    });
  }
  return els;
}

/** La jaquette du disque (SVG des sprites du bureau Frutiz) rendue en PNG transparent. */
/*
 * La jaquette du disque. Le sprite du bureau Frutiz (disc_jaquette_*.svg)
 * n'est qu'une enveloppe : il porte UNE image PNG de 61 × 61 pixels, en ligne
 * (data:). Rendre le SVG en grand l'aurait agrandie en flou. On en sort donc
 * les pixels d'origine tels quels (`<fichier>`, 61 × 61, transparence
 * comprise), plus un agrandissement ×16 au plus proche voisin
 * (`<fichier sans .png>-x16.png`, 976 × 976) : des pixels nets, pas de flou.
 */
async function jaquette(nav, jeu, svg, fichier) {
  const { execFileSync } = require('child_process');
  const texte = fs.readFileSync(path.join(RACINE, 'public/frutiz/sprites', svg), 'utf8');
  const m = texte.match(/href="data:image\/png;base64,([^"]+)"/);
  if (!m) {
    // Une jaquette VECTORIELLE (Kaluga, MiniPixiz : un SVG dans le SVG) : là,
    // le navigateur la trace nette à toute taille — 1080 px, sans agrandissement.
    const propre = !nav;
    const n = nav || await navigateur();
    const ctx = await n.newContext({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block;width:1080px;height:1080px}</style></head><body><img src="${BASE}/frutiz/sprites/${svg}"></body></html>`);
    await page.waitForFunction(() => { const i = document.querySelector('img'); return i && i.complete && i.naturalWidth > 0; });
    const dest = path.join(SORTIE, jeu, fichier);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await page.screenshot({ path: dest, omitBackground: true });
    await ctx.close();
    if (propre) await n.close();
    console.log('  ✔ ' + fichier + ' (vectorielle, 1080 × 1080)');
    return { fichier, vectorielle: true };
  }
  const dest = path.join(SORTIE, jeu, fichier);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(m[1], 'base64'));
  const grand = dest.replace(/\.png$/, '-x16.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', dest, '-vf', 'scale=iw*16:ih*16:flags=neighbor', '-pix_fmt', 'rgba', grand]);
  console.log('  ✔ ' + fichier + ' (pixels d\'origine) et ' + path.basename(grand) + ' (×16, plus proche voisin)');
  return { fichier };
}


/*
 * Le manifeste d'un jeu, refait à partir de ce qui EXISTE sur le disque :
 * les vidéos décrites (avec leur affiche PNG du même nom et leurs variantes),
 * les images, et les sons (copiés ici même). Un clip qu'on n'a pas régénéré
 * cette fois-ci garde donc sa place.
 */
function finirJeu(jeu, d) {
  const dossier = path.join(SORTIE, jeu);
  const elements = [];
  // La fenêtre du bureau, si fenetres.js l'a filmée.
  d.videos = Object.assign({}, d.videos, { [jeu + '-fenetre']: descriptionFenetre(TITRES_JEUX[jeu] || jeu) });
  for (const [nom, infos] of Object.entries(d.videos || {})) {
    const f = path.join(dossier, nom + '.mp4');
    if (!fs.existsSync(f)) continue;
    const e = elementVideo(jeu, nom + '.mp4', Object.assign({}, infos));
    if (fs.existsSync(path.join(dossier, nom + '.png'))) e.affiche = nom + '.png';
    const vars = (infos.variantes || []).filter((v) => fs.existsSync(path.join(dossier, v)));
    if (vars.length) e.variantes = vars; else delete e.variantes;
    elements.push(e);
  }
  for (const [fichier, infos] of Object.entries(d.images || {})) {
    const f = path.join(dossier, fichier);
    if (!fs.existsSync(f)) continue;
    const { execFileSync } = require('child_process');
    const dim = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split(',').map(Number);
    const e = Object.assign({ fichier, type: 'image', largeur: dim[0], hauteur: dim[1], alpha: !!infos.alpha || /jaquette/.test(fichier) }, infos);
    if (/jaquette/.test(fichier)) {
      // Voir jaquette() : les pixels d'origine, et l'agrandissement net en variante.
      e.description = `La jaquette du disque telle que le bureau Frutiz la montre : l'image d'origine du sprite, ${dim[0]} × ${dim[1]} pixels, PNG transparent. ` +
        'Variante -x16 : la même agrandie seize fois au plus proche voisin (pixels nets, aucun flou d\'agrandissement).';
      const x16 = fichier.replace(/\.png$/, '-x16.png');
      if (fs.existsSync(path.join(dossier, x16))) e.variantes = [x16];
    }
    elements.push(e);
  }
  if (d.sons && d.sons.length) elements.push(...copierSons(jeu, d.sons));
  ecrireManifesteJeu(jeu, elements);
  console.log(`  manifeste : ${elements.length} éléments pour ${jeu}`);
}

// La fenêtre du bureau (fenetres.js) : la même description pour tous les jeux.
function descriptionFenetre(titreJeu) {
  return {
    titre: `${titreJeu} — dans sa fenêtre du bureau Frutiz`,
    description: `Le bureau Frutiz du site (client /light en mode bureau, compte fictif « pomelo ») : la fenêtre ${titreJeu} ouverte, le jeu qui s'anime dans son cadre.`,
    usage: 'Plan « c\'est sur le site » : raccord entre le bureau et le jeu en plein écran.',
  };
}

/** Ajoute (ou remplace) un élément vidéo dans le manifeste partiel d'un jeu. */
function ajouterAuManifeste(jeu, fichier, infos) {
  const f = path.join(SORTIE, jeu, 'manifest-partiel.json');
  const liste = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  const e = elementVideo(jeu, fichier, infos);
  const base = fichier.replace(/\.mp4$/, '');
  if (fs.existsSync(path.join(SORTIE, jeu, base + '.png'))) e.affiche = path.posix.join(jeu, base + '.png');
  e.fichier = path.posix.join(jeu, fichier);
  e.jeu = jeu;
  const autres = liste.filter((x) => x.fichier !== e.fichier);
  autres.push(e);
  fs.writeFileSync(f, JSON.stringify(autres, null, 2) + '\n');
  refaireManifeste();
}

module.exports = {
  finirJeu, descriptionFenetre, ajouterAuManifeste, TITRES_JEUX,
  RACINE, SORTIE, PORT, BASE, FPS, LARGEUR, HAUTEUR, MP4,
  serveur, arreterServeur, navigateur, nouvellePage, avancer, attendre, encodeur, filmer,
  capture, couper, image, INTERMEDIAIRE, DOSSIER_TEMP, sonder, sonderSon, ecrireManifesteJeu, refaireManifeste, elementVideo, copierSons, jaquette, scriptHorloge,
};
