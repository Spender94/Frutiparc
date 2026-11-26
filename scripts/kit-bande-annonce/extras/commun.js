/*
 * KIT BANDE-ANNONCE — section « extras » : la boîte à outils commune.
 *
 * Tous les générateurs de la section (stickers, logos, moments du site, « Crée
 * ta bouille », typographie) s'appuient sur ce module :
 *
 *   · demarrerServeur()   le VRAI serveur du parc, en mémoire (sans base), sur
 *                         la plage de ports de la section (4400–4499) ;
 *   · compte()            un compte local FICTIF (inscription, réglages admin,
 *                         connexion → sid) — jamais un vrai joueur ;
 *   · Capture             une page Playwright dont on PILOTE L'HORLOGE : on
 *                         avance image par image, les timers JS (page.clock)
 *                         ET les animations CSS (Web Animations, mises en pause
 *                         et calées à la main), puis on photographie ;
 *   · encodeur()          un seul ffmpeg par clip, alimenté par un pipe
 *                         (image2pipe) — aucune séquence d'images sur disque —
 *                         qui sort d'un coup le MP4 maître, la version
 *                         transparente WebM VP9 et la version fond vert ;
 *   · sonder()            ffprobe : durée, cadence, taille, alpha ;
 *   · Manifeste           le manifest.json de la section, fusionné entrée par
 *                         entrée (chaque générateur ne réécrit que les siennes).
 *
 * Les fichiers produits vont HORS du dépôt, dans KIT_DIR/extras (par défaut
 * /home/user/Frutiparc/kit-bande-annonce/extras).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..', '..');
const KIT = process.env.KIT_DIR || '/home/user/Frutiparc/kit-bande-annonce';
const SORTIE = path.join(KIT, 'extras');
const PORT = Number(process.env.KIT_PORT || 4400);
const BASE = 'http://127.0.0.1:' + PORT;
const ADMIN_KEY = process.env.KIT_ADMIN_KEY || 'kit-extras';
const MDP = 'kit-bande-annonce';
// Une base Postgres À NOUS (kit_extras) sur le Postgres de test : sans base, le
// serveur refuse les réglages d'admin (PATCH /api/admin/users → « no db ») —
// or il faut poser la bouille, l'XP et les kikooz des comptes fictifs.
const BASE_DE_DONNEES = process.env.KIT_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/kit_extras';

// Le vert des couleurs du parc : fond des pages de relevé, du kit, du light.
const VERT_PARC = '#ADE76B';
const VERT_CLAIR = '#E8F8D3';
const VERT_INCRUST = '#00FF00';

function dossier(...p) {
  const d = path.join(SORTIE, ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function attendre(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────
//  LE SERVEUR
// ─────────────────────────────────────────────────────────────────────────
/*
 * Pourquoi un lien symbolique : `res.sendFile` d'Express (module `send`)
 * refuse tout chemin qui traverse un dossier dont le nom commence par un point
 * — et une copie de travail Claude vit sous `.claude/worktrees/…`. Le serveur y
 * répondait 404 à `/light` et `/`. On le lance donc depuis un lien sans point
 * (dans le dossier temporaire), avec --preserve-symlinks-main pour que
 * `__dirname` reste le chemin du lien.
 */
function assurerPostgres() {
  const pret = () => { try { execFileSync('pg_isready', ['-h', '127.0.0.1', '-p', '5433'], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
  if (!pret()) {
    try {
      execFileSync('setsid', ['su', 'postgres', '-c', "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg-frutiparc-test -o '-p 5433 -k /tmp' -l /tmp/pg-frutiparc-test.log -w start"], { stdio: 'ignore' });
    } catch (e) { /* un autre l'a peut-être lancé entre-temps */ }
  }
  try { execFileSync('psql', ['-h', '127.0.0.1', '-p', '5433', '-U', 'postgres', '-c', 'create database kit_extras'], { stdio: 'ignore' }); } catch (e) { /* existe déjà */ }
}

async function demarrerServeur() {
  try {
    const r = await fetch(BASE + '/light');
    if (r.status === 200) return { base: BASE, arreter() {} };       // déjà là
  } catch (e) { /* personne : on le lance */ }
  if (!process.env.KIT_DATABASE_URL) assurerPostgres();
  let racine = RACINE;
  if (RACINE.split(path.sep).some((s) => s.startsWith('.'))) {
    racine = path.join(os.tmpdir(), 'frutiparc-kit-extras');
    try { fs.unlinkSync(racine); } catch (e) { /* absent */ }
    fs.symlinkSync(RACINE, racine);
  }
  const journal = fs.openSync(path.join(os.tmpdir(), 'frutiparc-kit-extras-serveur.log'), 'w');
  const enfant = spawn(process.execPath,
    ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
      cwd: os.tmpdir(),
      env: Object.assign({}, process.env, {
        PORT: String(PORT), DATABASE_URL: BASE_DE_DONNEES, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
        ADMIN_KEY, XMLSOCKET_PORT: String(PORT + 1), FRUTISCORE_PORT: String(PORT + 2),
      }),
      stdio: ['ignore', journal, journal],
    });
  for (let i = 0; i < 120; i++) {
    await attendre(500);
    try { if ((await fetch(BASE + '/light')).status === 200) break; } catch (e) { /* pas encore */ }
    if (enfant.exitCode !== null) throw new Error('le serveur est tombé au démarrage');
  }
  return { base: BASE, arreter() { try { enfant.kill(); } catch (e) { /* déjà parti */ } } };
}

async function api(chemin, corps, entetes, methode) {
  const r = await fetch(BASE + chemin, {
    method: methode || (corps ? 'POST' : 'GET'),
    headers: Object.assign({ 'content-type': 'application/json' }, entetes || {}),
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return { brut: t, status: r.status }; }
}

function admin(chemin, corps, methode) {
  return api(chemin, corps, { 'x-admin-key': ADMIN_KEY }, methode);
}

/*
 * Un compte FICTIF : inscription (idempotente), réglages par l'admin (bouille,
 * XP, kikooz, nom affiché…), connexion. Rend le sid.
 */
async function compte(pseudo, reglages) {
  await api('/api/auth/register', { username: pseudo, password: MDP });
  if (reglages) await admin('/api/admin/users/' + encodeURIComponent(pseudo), reglages, 'PATCH');
  const c = await api('/api/auth/login', { username: pseudo, password: MDP });
  if (!c.sid) throw new Error('connexion impossible pour ' + pseudo + ' : ' + JSON.stringify(c));
  return c.sid;
}

/** Le casting, RELU à chaque appel : l'agent « chat » peut l'avoir mis à jour. */
function casting() {
  const c = JSON.parse(fs.readFileSync(path.join(KIT, 'casting.json'), 'utf8'));
  return { spectateur: c.spectateur, liste: c.casting };
}

// ─────────────────────────────────────────────────────────────────────────
//  LA CAPTURE PILOTÉE
// ─────────────────────────────────────────────────────────────────────────
/*
 * Une page dont le temps n'avance que quand on le dit.
 *
 * · page.clock (Playwright) remplace Date, setTimeout, setInterval,
 *   requestAnimationFrame et performance.now : tout ce que le JS du site
 *   anime — les bouilles, le glissé des fenêtres du bureau — suit notre pas.
 * · Les ANIMATIONS CSS (transitions, @keyframes) tournent, elles, sur la ligne
 *   de temps du document, que page.clock ne touche pas. On les reprend une à
 *   une par l'API Web Animations : chaque animation vue pour la première fois
 *   est notée à l'instant virtuel courant, mise en pause, et à chaque image on
 *   pose son `currentTime` = temps virtuel écoulé depuis. Le rendu est donc
 *   le même quelle que soit la charge de la machine.
 */
const INSTALLER_ANIMS = `(function () {
  if (window.__kitAnims) return;
  window.__kitAnims = { vues: new WeakMap(), t: 0 };
  window.__kitCaler = function (t) {
    var k = window.__kitAnims;
    k.t = t;
    document.getAnimations().forEach(function (a) {
      var d = k.vues.get(a);
      // Le temps qu'elle avait déjà couru (lancée entre deux images, elle a pu
      // avancer un peu en temps réel) est oublié : elle part de l'instant
      // virtuel où on la voit pour la première fois.
      if (d === undefined) { d = t; k.vues.set(a, d); }
      try { a.pause(); a.currentTime = Math.max(0, (t - d) * (a.playbackRate || 1)); } catch (e) { /* finie */ }
    });
  };
})();`;

class Capture {
  constructor(navigateur, opts) {
    this.navigateur = navigateur;
    this.opts = Object.assign({ largeur: 1920, hauteur: 1080, echelle: 1, fps: 60 }, opts || {});
    this.t = 0;                       // temps virtuel écoulé, en ms
  }

  async ouvrir(url, avantChargement) {
    const o = this.opts;
    this.contexte = await this.navigateur.newContext({
      viewport: { width: o.largeur, height: o.hauteur },
      deviceScaleFactor: o.echelle,
      isMobile: !!o.mobile, hasTouch: !!o.mobile,
      userAgent: o.mobile
        ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
        : undefined,
      locale: 'fr-FR', timezoneId: 'Europe/Paris',
    });
    this.page = await this.contexte.newPage();
    this.page.on('pageerror', (e) => { if (process.env.KIT_VERBEUX) console.log('  [page]', e.message); });
    // L'horloge part de l'heure réelle (les messages et sujets que le serveur
    // vient d'horodater restent cohérents), puis n'avance qu'à notre pas.
    await this.page.clock.install({ time: o.date ? new Date(o.date) : new Date() });
    if (avantChargement) await avantChargement(this.page);
    this.cdp = await this.contexte.newCDPSession(this.page);
    if (o.transparent) {
      await this.cdp.send('Emulation.setDefaultBackgroundColorOverride',
        { color: { r: 0, g: 0, b: 0, a: 0 } });
    }
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.installerAnimations();
    return this.page;
  }

  async installerAnimations() {
    // Par script d'initialisation : il survit aux navigations (la connexion
    // recharge la page), et on le pose aussi sur la page déjà chargée.
    const code = INSTALLER_ANIMS;
    if (!this.initPose) { await this.contexte.addInitScript(code); this.initPose = true; }
    await this.page.evaluate(code);
  }

  /** Avance le temps virtuel de `ms` (timers JS + animations CSS). */
  async avancer(ms) {
    if (ms > 0) await this.page.clock.runFor(ms);
    this.t += ms;
    await this.page.evaluate((t) => { if (window.__kitCaler) window.__kitCaler(t); }, this.t)
      .catch(() => {});      // une navigation en cours : l'image suivante rattrapera
  }

  /** Une image : PNG (alpha si `transparent`), optionnellement recadrée. */
  async image(clip) {
    const p = { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false };
    if (clip) p.clip = Object.assign({ scale: 1 }, clip);
    const r = await this.cdp.send('Page.captureScreenshot', p);
    return Buffer.from(r.data, 'base64');
  }

  async fermer() { try { await this.contexte.close(); } catch (e) { /* déjà fermé */ } }
}

// ─────────────────────────────────────────────────────────────────────────
//  L'ENCODAGE
// ─────────────────────────────────────────────────────────────────────────
const X264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
// VP9 avec alpha : les réglages du kit, plus `-cpu-used 4` et `-deadline good`
// — sans eux libvpx encode au plus lent (cpu-used 0), dix fois plus long pour
// une différence invisible à crf 24.
const VP9 = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-row-mt', '1',
  '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0'];

function hex(c) { return '0x' + c.replace('#', ''); }

/*
 * Un ffmpeg, plusieurs sorties. `sorties` :
 *   { mp4: chemin }                       le maître, tel quel (source opaque)
 *   { mp4: chemin, fond: '#ADE76B' }      le maître posé sur un fond uni
 *   { webm: chemin }                      transparent, VP9 yuva420p
 *   { vert: chemin }                      sur #00FF00, pour l'incrustation
 * Les images arrivent en PNG par `ecrire(buffer)`.
 */
function encodeur(sorties, opts) {
  opts = Object.assign({ fps: 60 }, opts || {});
  const { largeur: L, hauteur: H, fps } = opts;
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-'];
  const branches = [];
  if (sorties.mp4) branches.push({ type: 'mp4', fichier: sorties.mp4, fond: sorties.fond || null });
  if (sorties.webm) branches.push({ type: 'webm', fichier: sorties.webm });
  if (sorties.vert) branches.push({ type: 'mp4', fichier: sorties.vert, fond: VERT_INCRUST });
  const filtres = [];
  // Mise à la taille demandée (les captures à l'échelle 1,5 ou 3 tombent juste,
  // mais une capture recadrée peut avoir un pixel de trop).
  // `pad` : l'image (carrée, par exemple) est centrée sur un cadre L × H
  // transparent au lieu d'être étirée.
  const geo = opts.pad
    ? 'format=rgba,scale=-1:' + H + ':flags=lanczos,pad=' + L + ':' + H + ':(ow-iw)/2:(oh-ih)/2:color=black@0'
    : 'scale=' + L + ':' + H + ':flags=lanczos,format=rgba';
  filtres.push('[0:v]' + geo + ',split=' + branches.length
    + branches.map((b, i) => '[s' + i + ']').join(''));
  branches.forEach((b, i) => {
    if (b.type === 'webm') filtres.push('[s' + i + ']format=yuva420p[o' + i + ']');
    else if (b.fond) {
      filtres.push('color=c=' + hex(b.fond) + ':s=' + L + 'x' + H + ':r=' + fps + '[f' + i + ']');
      filtres.push('[f' + i + '][s' + i + ']overlay=shortest=1:format=auto,format=yuv420p[o' + i + ']');
    } else filtres.push('[s' + i + ']format=yuv420p[o' + i + ']');
  });
  args.push('-filter_complex', filtres.join(';'));
  branches.forEach((b, i) => {
    args.push('-map', '[o' + i + ']', '-r', String(fps));
    // `vite` (les 189 émotes des stickers) : x264 en « medium » et libvpx en
    // cpu-used 6 — même crf, donc même qualité visée, deux fois moins de calcul.
    let reglages = b.type === 'webm' ? VP9 : X264;
    if (opts.vite) reglages = reglages.map((a) => (a === 'slow' ? 'medium' : a === '4' && b.type === 'webm' ? '6' : a));
    args.push(...reglages);
    if (b.type === 'webm') args.push('-metadata:s:v:0', 'alpha_mode=1');
    args.push(b.fichier);
  });
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let erreurs = '';
  ff.stderr.on('data', (d) => { erreurs += d; });
  const fini = new Promise((ok, ko) => ff.on('close', (code) => (code === 0 ? ok() : ko(new Error('ffmpeg ' + code + ' : ' + erreurs.slice(-800))))));
  fini.catch(() => {});
  let n = 0;
  return {
    get images() { return n; },
    async ecrire(buf) {
      n++;
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    },
    async fin() { ff.stdin.end(); await fini; },
  };
}

/** ffprobe : durée, cadence, taille et alpha d'une vidéo. */
function sonder(fichier) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format',
    '-of', 'json', fichier]).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const res = { duree: Number(Number(j.format.duration).toFixed(2)), octets: Number(j.format.size) };
  if (v) {
    const [nu, de] = (v.r_frame_rate || '0/1').split('/').map(Number);
    Object.assign(res, { largeur: v.width, hauteur: v.height, fps: Math.round(nu / de),
      codec: v.codec_name, alpha: !!(v.tags && (v.tags.alpha_mode === '1' || v.tags.ALPHA_MODE === '1')) });
  }
  if (a) Object.assign(res, { audio: a.codec_name, frequence: Number(a.sample_rate) });
  return res;
}

/** Extrait une image d'une vidéo (contrôle visuel, affiche). */
function extraireImage(video, t, png) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', video,
    '-frames:v', '1', png]);
}

// ─────────────────────────────────────────────────────────────────────────
//  LE MANIFESTE
// ─────────────────────────────────────────────────────────────────────────
/*
 * Chaque générateur déclare SES éléments ; on fusionne par `fichier` dans le
 * manifest.json de la section, en gardant ceux des autres générateurs. Les
 * durées, cadences et tailles sont relevées par ffprobe, pas recopiées.
 */
const TITRE_SECTION = 'Extras — stickers, logos, vie du site, typo';
const TEXTE_SECTION = 'Tout ce qui n’est ni le salon de chat ni les jeux : les bouilles du casting '
  + 'en stickers (8 humeurs, toutes les émotes du moteur JS), la séquence « Crée ta bouille », '
  + 'le logo, des moments de la vie du site (bureau Frutiz, accueil du light, pictos, classements, '
  + 'forum), les polices et la palette. Vidéos en 1920×1080 à 60 i/s ; les éléments à incruster '
  + 'existent en WebM transparent et en MP4 fond vert. Tout est fictif (comptes locaux, casting). '
  + 'Absents du dépôt, donc absents ici : un logo animé (fcLogo.swf est un fichier vide), des sons '
  + 'de site hors jeux (ni connexion, ni chat, ni jingle Frusion : aucun SWF ni dossier n’en contient).';

function lireManifeste() {
  const f = path.join(SORTIE, 'manifest.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {
    return { section: 'extras', titre: TITRE_SECTION, texte: TEXTE_SECTION, elements: [] };
  }
}

/**
 * Remplace dans le manifeste toutes les entrées dont le `fichier` commence par
 * l'un des `prefixes`, par `elements` (dans l'ordre donné).
 */
function majManifeste(prefixes, elements) {
  const m = lireManifeste();
  m.section = 'extras'; m.titre = TITRE_SECTION; m.texte = TEXTE_SECTION;
  const garde = m.elements.filter((e) => !prefixes.some((p) => e.fichier.startsWith(p)));
  m.elements = garde.concat(elements);
  // Un ordre stable pour l'index : par groupe, puis dans l'ordre d'arrivée.
  const ordre = ['logos/', 'stickers/', 'cree-ta-bouille/', 'moments/', 'typo/', 'sons/'];
  const rang = (e) => { const i = ordre.findIndex((p) => e.fichier.startsWith(p)); return i < 0 ? 99 : i; };
  m.elements = m.elements.map((e, i) => [e, i]).sort((a, b) => rang(a[0]) - rang(b[0]) || a[1] - b[1]).map((x) => x[0]);
  fs.writeFileSync(path.join(SORTIE, 'manifest.json'), JSON.stringify(m, null, 1) + '\n');
}

/** Une entrée vidéo, mesurée par ffprobe. `rel` est relatif à SORTIE. */
function entreeVideo(rel, champs) {
  const s = sonder(path.join(SORTIE, rel));
  return Object.assign({ fichier: rel, type: 'video' }, champs, {
    duree: s.duree, fps: s.fps, largeur: s.largeur, hauteur: s.hauteur,
    alpha: champs.alpha !== undefined ? champs.alpha : s.alpha,
    octets: s.octets,
  });
}

module.exports = {
  RACINE, KIT, SORTIE, BASE, PORT, ADMIN_KEY, VERT_PARC, VERT_CLAIR, VERT_INCRUST,
  dossier, attendre, demarrerServeur, api, admin, compte, casting,
  Capture, encodeur, sonder, extraireImage, lireManifeste, majManifeste, entreeVideo,
};
