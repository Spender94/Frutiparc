/*
 * Kit bande-annonce — section « jeux-b » : la boîte à outils commune.
 *
 * Ce module ne filme rien par lui-même ; il fournit à chaque script de jeu
 * (miniwave.js, mb2.js, jamajama.js, grapiz.js, bandas.js) :
 *
 *   · le serveur local du site (lancé sans base, ports 4300–4399) ;
 *   · des comptes fictifs (casting.json) pour les jeux qui exigent un ?sid= ;
 *   · une HORLOGE VIRTUELLE injectée dans la page avant tout script : Date,
 *     performance.now, setTimeout/setInterval et requestAnimationFrame ne
 *     suivent plus le temps réel mais un compteur que le harnais avance
 *     d'exactement 1/60 s par image capturée. La partie se joue donc à sa
 *     vraie vitesse dans la vidéo, quelle que soit la charge de la machine ;
 *     Math.random est remplacé par un tirage à graine (même graine, même
 *     film). Les WebSockets peuvent être « retenues » : les messages du
 *     serveur attendent que le harnais les livre, à une image précise ;
 *   · la capture : capture d'écran de la page à chaque image → ffmpeg par un
 *     tube (image2pipe), jamais de séquence d'images sur le disque ;
 *   · le découpage des plans dans un plan maître, les affiches, ffprobe ;
 *   · l'écriture des fragments de manifeste (un par jeu, fusionnés par
 *     tout.js en jeux-b/manifest.json).
 *
 * Rien ici ne touche aux jeux eux-mêmes : les entrées passent par le clavier
 * et la souris de Playwright (événements de confiance), les crochets vivent
 * dans le harnais.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

// Playwright est préinstallé hors du dépôt (/opt/node-tools) ; on le prend où
// il est, sans l'ajouter aux dépendances du site.
function chargerPlaywright() {
  try { return require('playwright'); } catch (e) { /* plus loin */ }
  return require('/opt/node-tools/node_modules/playwright');
}

const RACINE = path.resolve(__dirname, '..', '..', '..');
const SORTIE = process.env.KIT_SORTIE || '/home/user/Frutiparc/kit-bande-annonce/jeux-b';
const PORT = Number(process.env.KIT_PORT || 4300);
const BASE = `http://127.0.0.1:${PORT}`;
const VERT_SITE = '#ADE76B';
const CLE_ADMIN = process.env.KIT_ADMIN_KEY || 'kitjeuxb';

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Le serveur ────────────────────────────────────────────────────────────
function repond(url) {
  return new Promise((resoudre) => {
    const req = http.get(url, (res) => { res.resume(); resoudre(res.statusCode < 500); });
    req.on('error', () => resoudre(false));
    req.setTimeout(2000, () => { req.destroy(); resoudre(false); });
  });
}

let serveur = null;
/** Lance server.js (mémoire seule) sur PORT, ou réutilise celui qui tourne. */
async function demarrerServeur() {
  if (await repond(BASE + '/miniwave/')) return BASE;
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
    ADMIN_KEY: CLE_ADMIN,
    XMLSOCKET_PORT: String(PORT + 1), FRUTISCORE_PORT: String(PORT + 2),
  });
  /*
   * Un dépôt rangé sous un dossier caché (une copie de travail sous
   * .claude/worktrees/…) : res.sendFile refuse tout chemin qui traverse un
   * « dotfile » et répond 404 — les familles de frutibouilles
   * (/fbouille/famille0.swf) disparaissent, et les vignettes des joueurs
   * restent vides. On lance alors le serveur depuis un lien symbolique sans
   * point, en gardant ce chemin (--preserve-symlinks-main).
   */
  let cwd = RACINE;
  const nodeArgs = ['server.js'];
  if (/[\/]\./.test(RACINE)) {
    const lien = path.join(require('os').tmpdir(), 'kit-jeux-b-depot');
    try { if (fs.readlinkSync(lien) !== RACINE) fs.unlinkSync(lien); } catch (e) { /* absent */ }
    if (!fs.existsSync(lien)) fs.symlinkSync(RACINE, lien);
    cwd = lien;
    nodeArgs.splice(0, 1, '--preserve-symlinks', '--preserve-symlinks-main', path.join(lien, 'server.js'));
  }
  serveur = spawn(process.execPath, nodeArgs, { cwd, env, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 120; i++) {
    await attendre(500);
    if (await repond(BASE + '/miniwave/')) return BASE;
  }
  throw new Error('le serveur local ne répond pas sur ' + BASE);
}
function arreterServeur() { if (serveur) { serveur.kill(); serveur = null; } }

// ── Les comptes (personnages fictifs du casting) ──────────────────────────
function casting() {
  return JSON.parse(fs.readFileSync(path.join(path.dirname(SORTIE), 'casting.json'), 'utf8'));
}
async function posterJson(chemin, corps, entetes) {
  const r = await fetch(BASE + chemin, {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, entetes || {}),
    body: JSON.stringify(corps),
  });
  return r.json().catch(() => ({}));
}
/**
 * Crée (si besoin) le compte et rend son sid. Le personnage reçoit la
 * frutibouille que lui donne casting.json (enregistrée comme le fait
 * l'éditeur de bouille du site, /do/eb), pour que sa vignette apparaisse
 * dans les jeux en ligne.
 */
async function compte(pseudo) {
  const mdp = 'bande-annonce-' + pseudo;
  await posterJson('/api/auth/register', { username: pseudo, password: mdp });
  const l = await posterJson('/api/auth/login', { username: pseudo, password: mdp });
  if (!l.sid) throw new Error('connexion impossible pour ' + pseudo + ' : ' + JSON.stringify(l));
  const c = casting();
  const fiche = [c.spectateur].concat(c.casting).find((x) => x && x.pseudo === pseudo);
  if (fiche && fiche.bouille) {
    await fetch(BASE + '/do/eb?sid=' + encodeURIComponent(l.sid) + '&b=' + encodeURIComponent(fiche.bouille)).catch(() => null);
  }
  return l.sid;
}

// ── L'horloge virtuelle, injectée avant tout script de la page ────────────
// Écrite comme une fonction pour être relue par Playwright (addInitScript).
function horlogeVirtuelle(opts) {
  const graine = (opts && opts.graine) >>> 0 || 12345;
  const EPOQUE = (opts && opts.epoque) || Date.UTC(2026, 10, 26, 16, 0, 0);
  const DateVraie = Date;
  const vrai = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    raf: window.requestAnimationFrame.bind(window),
  };
  let maintenant = 0;                         // ms virtuelles depuis le chargement
  let prochainId = 1;
  const minuteurs = new Map();               // id → { fn, a, args, intervalle }
  let rafs = new Map();

  window.setTimeout = function (fn, ms) {
    const args = Array.prototype.slice.call(arguments, 2);
    const id = prochainId++;
    minuteurs.set(id, { fn, a: maintenant + Math.max(0, Number(ms) || 0), args, intervalle: 0 });
    return id;
  };
  window.setInterval = function (fn, ms) {
    const args = Array.prototype.slice.call(arguments, 2);
    const id = prochainId++;
    const pas = Math.max(1, Number(ms) || 0);
    minuteurs.set(id, { fn, a: maintenant + pas, args, intervalle: pas });
    return id;
  };
  window.clearTimeout = window.clearInterval = function (id) { minuteurs.delete(id); };
  window.requestAnimationFrame = function (fn) { const id = prochainId++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = function (id) { rafs.delete(id); };
  Object.defineProperty(performance, 'now', { value: () => maintenant, configurable: true });

  // Date : sans argument, c'est l'instant virtuel ; avec, la vraie Date.
  function DateVirtuelle() {
    const a = arguments;
    if (!(this instanceof DateVirtuelle)) return new DateVraie(EPOQUE + maintenant).toString();
    if (a.length === 0) return new DateVraie(EPOQUE + maintenant);
    return new (Function.prototype.bind.apply(DateVraie, [null].concat(Array.prototype.slice.call(a))))();
  }
  DateVirtuelle.prototype = DateVraie.prototype;
  DateVirtuelle.now = () => EPOQUE + Math.floor(maintenant);
  DateVirtuelle.UTC = DateVraie.UTC;
  DateVirtuelle.parse = DateVraie.parse;
  window.Date = DateVirtuelle;

  // Tirage à graine (mulberry32) : particules et éclats rejouent pareil.
  let s = graine;
  Math.random = function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Les WebSockets : on peut retenir les messages reçus et les livrer à une
  // image précise (une partie en réseau rejouée au rythme de la capture).
  const WSVraie = window.WebSocket;
  const enAttente = [];
  const vt = {
    retenir: false,
    get maintenant() { return maintenant; },
    enAttente: () => enAttente.length,
    messagesEnAttente: () => enAttente.map((m) => String(m.ev.data)),
    livrer() {
      while (enAttente.length) {
        const m = enAttente.shift();
        try { m.cible(m.ev); } catch (e) { console.error(e); }
      }
    },
  };
  if (WSVraie) {
    window.WebSocket = function (url, proto) {
      const ws = proto === undefined ? new WSVraie(url) : new WSVraie(url, proto);
      let surMessage = null;
      Object.defineProperty(ws, 'onmessage', {
        configurable: true,
        get() { return surMessage; },
        set(f) { surMessage = f; },
      });
      WSVraie.prototype.addEventListener.call(ws, 'message', (ev) => {
        const cible = (e) => { if (surMessage) surMessage.call(ws, e); };
        if (vt.retenir || enAttente.length) enAttente.push({ cible, ev });
        else cible(ev);
      });
      return ws;
    };
    window.WebSocket.prototype = WSVraie.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => { window.WebSocket[k] = WSVraie[k]; });
  }

  /** Avance l'horloge de `ms`, déclenche les minuteurs échus puis UNE image. */
  vt.avancer = function (ms) {
    const fin = maintenant + ms;
    for (let garde = 0; garde < 10000; garde++) {
      let choisi = null, idChoisi = 0;
      for (const [id, m] of minuteurs) {
        if (m.a <= fin && (!choisi || m.a < choisi.a || (m.a === choisi.a && id < idChoisi))) { choisi = m; idChoisi = id; }
      }
      if (!choisi) break;
      maintenant = Math.max(maintenant, choisi.a);
      if (choisi.intervalle) choisi.a += choisi.intervalle; else minuteurs.delete(idChoisi);
      try {
        if (typeof choisi.fn === 'function') choisi.fn.apply(window, choisi.args);
        else (0, eval)(String(choisi.fn));
      } catch (e) { console.error(e); }
    }
    maintenant = fin;
    if (!vt.retenir) vt.livrer();
    const liste = rafs;
    rafs = new Map();
    for (const fn of liste.values()) {
      try { fn(maintenant); } catch (e) { console.error(e); }
    }
  };
  // Pour attendre un vrai délai sans dépendre de l'horloge truquée.
  vt.vrai = vrai;
  window.__vt = vt;
}

// ── Navigateur ────────────────────────────────────────────────────────────
async function ouvrirNavigateur() {
  const { chromium } = chargerPlaywright();
  return chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
}

/**
 * Une page 1920×1080 dont l'horloge est virtuelle.
 * opts : { largeur, hauteur, echelle (deviceScaleFactor), graine, css }
 */
async function nouvellePage(navigateur, opts) {
  opts = opts || {};
  const contexte = await navigateur.newContext({
    viewport: { width: opts.largeur || 1920, height: opts.hauteur || 1080 },
    deviceScaleFactor: opts.echelle || 1,
  });
  if (opts.virtuel !== false) await contexte.addInitScript(horlogeVirtuelle, { graine: opts.graine || 12345 });
  if (opts.css) {
    await contexte.addInitScript((css) => {
      const poser = () => {
        const st = document.createElement('style');
        st.setAttribute('data-kit', '1');
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poser);
      else poser();
    }, opts.css);
  }
  const page = await contexte.newPage();
  // La capture CDP rend la page en pixels CSS : on retient l'échelle pour
  // demander les pixels physiques (clip × échelle) quand elle dépasse 1.
  formatParPage.set(page, { l: opts.largeur || 1920, h: opts.hauteur || 1080, e: opts.echelle || 1 });
  page.on('pageerror', (e) => console.warn('  [page] erreur :', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|net::ERR/.test(m.text())) console.warn('  [page]', m.text().slice(0, 200)); });
  return page;
}

const formatParPage = new WeakMap();
const IMAGE = 1000 / 60;
/** Avance d'une image (1/60 s) dans la page. */
function avancer(page, n) {
  return page.evaluate((a) => { for (let i = 0; i < a.n; i++) window.__vt.avancer(a.ms); }, { n: n || 1, ms: IMAGE });
}
/**
 * Fait tourner l'horloge virtuelle au rythme du réel jusqu'à ce que
 * `condition` (évaluée dans la page) soit vraie — chargements, réseau…
 */
async function patienter(page, condition, arg, maxMs) {
  const t0 = Date.now();
  for (;;) {
    const ok = await page.evaluate(({ c, a }) => {
      // eslint-disable-next-line no-new-func
      const f = new Function('arg', 'return (' + c + ')(arg);');
      return !!f(a);
    }, { c: condition.toString(), a: arg === undefined ? null : arg });
    if (ok) return true;
    if (Date.now() - t0 > (maxMs || 30000)) throw new Error('patienter : délai dépassé pour ' + condition.toString().slice(0, 120));
    await avancer(page, 2);
    await attendre(15);
  }
}

// ── Capture → ffmpeg ──────────────────────────────────────────────────────
/**
 * Un encodeur MP4 maître (1920×1080, 60 i/s) nourri image par image.
 * `filtre` : filtre vidéo ffmpeg optionnel (recadrage…).
 */
class Encodeur {
  constructor(fichier, opts) {
    opts = opts || {};
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    this.fichier = fichier;
    this.images = 0;
    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '60', '-i', '-'];
    if (opts.filtre) args.push('-vf', opts.filtre);
    args.push('-c:v', 'libx264', '-preset', opts.preset || 'slow', '-crf', String(opts.crf || 16),
      '-pix_fmt', 'yuv420p', '-r', '60', '-movflags', '+faststart', fichier);
    this.ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    this.fin = new Promise((resoudre, rejeter) => {
      this.ff.on('close', (code) => (code === 0 ? resoudre() : rejeter(new Error('ffmpeg a échoué (' + code + ') pour ' + fichier))));
    });
  }
  async ecrire(png) {
    this.images++;
    if (!this.ff.stdin.write(png)) await new Promise((r) => this.ff.stdin.once('drain', r));
  }
  async fermer() { this.ff.stdin.end(); await this.fin; return this.fichier; }
}

/** Capture d'écran de la page entière (PNG, rapide). */
const cdpParPage = new WeakMap();
async function capturer(page) {
  let cdp = cdpParPage.get(page);
  if (!cdp) { cdp = await page.context().newCDPSession(page); cdpParPage.set(page, cdp); }
  const fmt = formatParPage.get(page);
  const args = { format: 'png', optimizeForSpeed: true };
  if (fmt && fmt.e !== 1) args.clip = { x: 0, y: 0, width: fmt.l, height: fmt.h, scale: fmt.e };
  const r = await cdp.send('Page.captureScreenshot', args);
  return Buffer.from(r.data, 'base64');
}

// ── Découpe, affiches, vérification ───────────────────────────────────────
function sonde(fichier) {
  const sortie = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_packets:format=duration', '-of', 'json', fichier]).toString();
  const j = JSON.parse(sortie);
  const st = j.streams[0];
  const [a, b] = st.r_frame_rate.split('/').map(Number);
  return { largeur: st.width, hauteur: st.height, fps: Math.round(a / b), images: Number(st.nb_read_packets), duree: Number(Number(j.format.duration).toFixed(3)) };
}
/** Coupe [debut, debut+duree] (secondes) d'un maître, réencodé à l'image près. */
function couper(maitre, fichier, debut, duree) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', debut.toFixed(4), '-i', maitre, '-t', duree.toFixed(4),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '60', '-an', '-movflags', '+faststart', fichier]);
  return fichier;
}
/** Une image d'une vidéo (à t secondes) en PNG. */
function affiche(video, fichier, t) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', Math.max(0, t).toFixed(4), '-i', video, '-frames:v', '1', fichier]);
  return fichier;
}
/** Planche-contact de vérification (hors kit : dans le dossier temporaire). */
function planche(video, fichier, n) {
  const info = sonde(video);
  const pas = info.duree / (n || 6);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf',
    `fps=1/${pas.toFixed(3)},scale=480:-1,tile=${n || 6}x1`, '-frames:v', '1', fichier]);
  return fichier;
}

// ── Manifeste ─────────────────────────────────────────────────────────────
/** Un élément vidéo du manifeste, mesuré par ffprobe. */
function elementVideo(jeu, fichierAbs, o) {
  const info = sonde(fichierAbs);
  return Object.assign({
    fichier: path.relative(SORTIE, fichierAbs),
    jeu, type: 'video',
    duree: info.duree, fps: info.fps, largeur: info.largeur, hauteur: info.hauteur, alpha: false,
  }, o, o && o.affiche ? { affiche: path.relative(SORTIE, o.affiche) } : {});
}
/**
 * Écrit le fragment de manifeste d'un jeu. `fusion` (lancement partiel, une
 * seule partie du jeu régénérée) : on garde les éléments déjà décrits, en
 * remplaçant ceux dont le fichier a été refait.
 */
function ecrireFragment(jeu, elements, fusion) {
  const dossier = path.join(SORTIE, jeu);
  const f = path.join(dossier, 'elements.json');
  fs.mkdirSync(dossier, { recursive: true });
  let liste = elements;
  if (fusion && fs.existsSync(f)) {
    const neufs = new Set(elements.map((e) => e.fichier));
    liste = JSON.parse(fs.readFileSync(f, 'utf8')).filter((e) => !neufs.has(e.fichier)).concat(elements);
  }
  fs.writeFileSync(f, JSON.stringify(liste, null, 2) + '\n');
}

// ── Jaquettes et sons ─────────────────────────────────────────────────────
/** Rend une jaquette SVG du bureau Frutiz en PNG (fond transparent). */
async function jaquettePng(navigateur, svgRel, fichier, largeur) {
  const svg = fs.readFileSync(path.join(RACINE, svgRel), 'utf8');
  const vb = /viewBox="([^"]+)"/.exec(svg);
  let w = 0, h = 0;
  if (vb) { const p = vb[1].trim().split(/[\s,]+/).map(Number); w = p[2]; h = p[3]; }
  if (!w) { w = Number((/width="([\d.]+)/.exec(svg) || [])[1]) || 100; h = Number((/height="([\d.]+)/.exec(svg) || [])[1]) || 100; }
  const L = largeur || 1200, H = Math.round(L * h / w);
  const ctx = await navigateur.newContext({ viewport: { width: L, height: H } });
  const page = await ctx.newPage();
  const url = BASE + '/' + svgRel.replace(/^public\//, '');
  await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${url}" style="width:${L}px;height:${H}px;display:block"></body></html>`);
  await page.waitForFunction(() => document.images[0] && document.images[0].complete);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  await page.screenshot({ path: fichier, omitBackground: true });
  await ctx.close();
  return { fichier, largeur: L, hauteur: H };
}
/** Copie un son du site (ou le convertit en OGG s'il est en MP3). */
function copierSon(srcRel, fichier) {
  const src = path.join(RACINE, srcRel);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const ext = path.extname(src).toLowerCase();
  if (ext === '.wav' || ext === '.ogg') fs.copyFileSync(src, fichier);
  else execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'libvorbis', '-q:a', '6', fichier]);
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fichier]).toString().trim());
  return Number(d.toFixed(3));
}
function elementSon(jeu, fichierAbs, duree, o) {
  return Object.assign({ fichier: path.relative(SORTIE, fichierAbs), jeu, type: 'son', duree }, o);
}

/** Choisit des fenêtres sans recouvrement maximisant un score par image. */
function meilleuresFenetres(scores, longueur, n, opts) {
  opts = opts || {};
  const marge = opts.marge || 30;
  const pris = [];
  const cumul = [0];
  for (let i = 0; i < scores.length; i++) cumul.push(cumul[i] + scores[i]);
  for (let k = 0; k < n; k++) {
    let best = -1, bestDebut = -1;
    for (let d = opts.debutMin || 0; d + longueur <= scores.length; d += 5) {
      if (pris.some((p) => d < p + longueur + marge && p < d + longueur + marge)) continue;
      if (opts.interdit && opts.interdit(d, d + longueur)) continue;
      const s = cumul[d + longueur] - cumul[d];
      if (s > best) { best = s; bestDebut = d; }
    }
    if (bestDebut < 0) break;
    pris.push(bestDebut);
  }
  return pris.sort((a, b) => a - b);
}

module.exports = {
  RACINE, SORTIE, PORT, BASE, VERT_SITE, IMAGE,
  attendre, demarrerServeur, arreterServeur, casting, compte, posterJson,
  horlogeVirtuelle, ouvrirNavigateur, nouvellePage, avancer, patienter,
  Encodeur, capturer, sonde, couper, affiche, planche,
  elementVideo, elementSon, ecrireFragment, jaquettePng, copierSon, meilleuresFenetres,
};
