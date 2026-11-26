/*
 * Kit bande-annonce, section « chat » — LA CAMÉRA DÉTERMINISTE.
 *
 * Le chat vit de minuteurs (le glissement d'une bouille, son départ au bout de
 * 4,2 s, la boucle du moteur de bouilles à 40 im/s…) et de trames WebSocket qui
 * arrivent quand elles veulent. Filmer ça en temps réel donne une vidéo qui
 * dépend de la charge de la machine. On fait donc l'inverse : c'est le
 * TOURNAGE qui tient le temps.
 *
 *   · l'HORLOGE de la page est celle de Playwright (`page.clock`) : Date,
 *     setTimeout, requestAnimationFrame, performance.now n'avancent que quand
 *     on le dit — 1/60 s par image ;
 *   · les ANIMATIONS CSS (le glissement `left` des bouilles de l'aquarium…)
 *     ne connaissent pas cette horloge : on les met en pause et on pose
 *     nous-mêmes leur `currentTime` à chaque image (Web Animations API) ;
 *   · le HASARD de la page est calé (la hauteur où entre une bouille, les
 *     variations du moteur) : deux tournages donnent la même scène ;
 *   · la WEBSOCKET passe par nous (`page.routeWebSocket`) : chaque trame du
 *     serveur est retenue jusqu'à l'image où on la livre, et l'on attend que
 *     la page l'ait reçue avant d'avancer. Les répliques des PNJ (Gaspard…)
 *     attendent leur signal dans le scénario ; les visites imprévues des
 *     autres PNJ sont écartées.
 *
 * Chaque image est photographiée puis poussée dans ffmpeg par un tube : rien
 * ne reste sur le disque.
 */
'use strict';

const { spawn } = require('child_process');
const { once } = require('events');
const { attendre, decoupeur, attribut, balise } = require('./site');

// Les comptes PNJ du serveur (NPC_USERNAMES, server.js).
const PNJ = new Set(['gaspard', 'mdamirma', 'gromelin', 'kiloute79', 'vieuxpruneau', 'natacha', 'dimitri']);

// Injecté dans la page AVANT tout script du site.
const SCRIPT_CAMERA = `(() => {
  // 1. Le hasard calé — mulberry32, regrainé au début de chaque prise.
  let graine = 20261126;
  Math.random = function () {
    graine = (graine + 0x6D2B79F5) | 0;
    let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // 2. Le compteur des messages WebSocket reçus (pour savoir qu'une trame
  //    livrée a bien été traitée). \`routeWebSocket\` remplace la WebSocket de
  //    la page par la sienne, qui livre chaque message par \`dispatchEvent\` :
  //    on compte APRÈS la diffusion, quand le onmessage du site a déjà tourné.
  let recus = 0;
  const diffuser = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    const r = diffuser.call(this, ev);
    if (ev && ev.type === 'message' && this && typeof this.send === 'function' && 'binaryType' in this) recus++;
    return r;
  };
  // 3. Les animations CSS, menées à la main.
  const debuts = new WeakMap();
  window.__camera = {
    recus: () => recus,
    graine: (g) => { graine = g | 0; },
    synchro(t) {
      for (const a of document.getAnimations()) {
        if (!debuts.has(a)) {
          debuts.set(a, t - (a.currentTime || 0));
          try { a.pause(); } catch (e) {}
        }
        const ct = t - debuts.get(a);
        let fin = Infinity;
        try { fin = a.effect ? a.effect.getComputedTiming().endTime : Infinity; } catch (e) {}
        if (isFinite(fin) && ct >= fin) { try { a.finish(); } catch (e) {} continue; }
        try { a.currentTime = Math.max(0, ct); } catch (e) {}
      }
    },
  };
})();`;

/*
 * UNE SORTIE = un ffmpeg nourri d'images PNG par son entrée standard.
 *   mode 'mp4'   : H.264, la vidéo maîtresse ;
 *   mode 'alpha' : WebM VP9 transparent + MP4 sur fond vert #00FF00, d'une
 *                  seule passe (le filtre `split`).
 * `pad` place l'image dans un cadre plus grand (transparent), p. ex. la
 * colonne des bouilles contre le bord gauche d'un 1920×1080.
 */
class Sortie {
  constructor(o) {
    this.o = o;
    this.fps = o.fps || 60;
    this.n = 0;
    const entree = ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(this.fps), '-c:v', 'png', '-i', '-'];
    const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    let args;
    if (o.mode === 'alpha') {
      const [W, H] = o.cadre || [1920, 1080];
      // La bande est d'abord mise exactement à la hauteur du cadre (la photo
      // peut avoir un pixel de trop ou de moins), puis posée dedans.
      const pad = o.pad ? `,scale=-2:${H}:flags=lanczos,pad=${W}:${H}:${o.pad[0]}:${o.pad[1]}:color=0x00000000` : '';
      args = entree.concat([
        '-filter_complex',
        `[0:v]format=rgba${pad},split=2[a][b];color=c=0x00FF00:s=${W}x${H}:r=${this.fps}[g];[g][b]overlay=shortest=1:format=auto,format=yuv420p[v]`,
        '-map', '[a]', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-row-mt', '1',
        // VP9 au réglage par défaut (cpu-used 0) met des dizaines de minutes : la
        // vitesse 4 garde la qualité visuelle à crf 24, en bien moins de temps.
        '-deadline', 'good', '-cpu-used', '4', o.fichier,
        '-map', '[v]'].concat(x264, [o.vert]));
    } else {
      // Un recadrage peut tomber à un pixel près de la taille voulue : on
      // l'y remet (lanczos, sur ±1 px : invisible).
      const ajuster = o.ajuster ? ['-vf', `scale=${o.ajuster[0]}:${o.ajuster[1]}:flags=lanczos`] : [];
      args = entree.concat(ajuster, x264, [o.fichier]);
    }
    this.proc = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    this.fin = once(this.proc, 'exit');
  }
  async ecrire(png) {
    this.n++;
    if (!this.proc.stdin.write(png)) await once(this.proc.stdin, 'drain');
  }
  async fermer() {
    this.proc.stdin.end();
    const [code] = await this.fin;
    if (code) throw new Error('ffmpeg a échoué pour ' + this.o.fichier);
  }
}

class Camera {
  /**
   * @param {import('playwright').Page} page
   * @param {object} o  { fps, pnjRetenus: ['gaspard'] }
   */
  constructor(page, o) {
    o = o || {};
    this.page = page;
    this.fps = o.fps || 60;
    this.echelle = o.echelle || 1;   // deviceScaleFactor de la vue : la photo est rendue à cette échelle
    this.pnjRetenus = new Set((o.pnjRetenus || []).map((s) => s.toLowerCase()));
    // Les trames qu'on écarte : la mention de Pomelo sur le forum par Natacha
    // (le mot d'accueil que le parc poste pour tout nouveau compte — notre
    // spectateur est un compte neuf, un vrai joueur ne l'aurait plus).
    this.ecarter = (o.ecarter || []).map((r) => new RegExp(r));
    // L'HEURE DES LIGNES. Le serveur horodate chaque ligne à SON heure ; or la
    // prise avance image par image, bien plus lentement que le temps réel :
    // deux répliques à une seconde d'écart sortaient à quarante secondes
    // d'écart. L'horloge de la scène part de `heure` (« 17:45:00 ») et suit le
    // temps de la prise ; ce qui arrive pendant la mise en place est daté un
    // peu avant.
    this.heure = o.heure ? o.heure.split(':').map(Number) : null;
    this.toutes = [];      // toutes les trames reçues du serveur (pour les guetter)
    this.file = [];        // trames à livrer à la prochaine image
    this.retenues = [];    // répliques de PNJ en attente de leur signal
    this.livrees = 0;      // messages livrés à la page
    this.direct = true;    // avant la prise : on livre au fil de l'eau
    this.route = null;
    this.image = 0;        // numéro de l'image suivante
    this.tMs = 0;          // temps virtuel de la prise, en ms
    this.t0Reel = 0;       // arrivée de la première trame (mise en place)
  }

  /** À appeler AVANT d'ouvrir la page. */
  static async preparer(contexte) {
    await contexte.addInitScript({ content: SCRIPT_CAMERA });
  }

  async brancher() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.page.clock.install();
    await this.page.routeWebSocket((url) => {
      try { return new URL(url).pathname === '/'; } catch (e) { return false; }
    }, (ws) => {
      this.route = ws;
      const serveur = ws.connectToServer();
      const couper = decoupeur();
      serveur.onMessage((m) => { for (const t of couper(m)) this.recevoir(t); });
    });
  }

  // Le tri des trames du serveur : livrer, retenir (une réplique de PNJ qui
  // attend son signal), ou jeter (une visite de PNJ hors scénario).
  recevoir(t) {
    if (!this.t0Reel) this.t0Reel = Date.now();
    t = this.horodater(t);
    this.toutes.push(t);
    if (this.ecarter.some((r) => r.test(t))) return;
    const b = balise(t);
    const u = String(attribut(t, 'u') || '').toLowerCase();
    if (PNJ.has(u)) {
      if (b === 't' && this.pnjRetenus.has(u)) { this.retenues.push(t); return; }
      if (b === 't' || b === 'v' || b === 'u') return;
    }
    this.file.push(t);
    if (this.direct) this.livrer();
  }

  // L'heure de la scène, en secondes depuis minuit.
  horloge() {
    const [h, m, sec] = this.heure;
    const debut = h * 3600 + m * 60 + (sec || 0);
    if (this.direct) return debut - 40 + Math.min(30, (Date.now() - this.t0Reel) / 4000);
    return debut + this.tMs / 1000;
  }

  // Réécrit l'heure (« [22:51:04] ») des lignes du salon à l'heure de la scène.
  horodater(t) {
    if (!this.heure || balise(t) !== 't') return t;
    const s = Math.floor(this.horloge());
    const p2 = (n) => String(n).padStart(2, '0');
    const hms = `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
    return t.replace(/(\sh="[^"]*?)\d\d:\d\d:\d\d/, '$1' + hms)
      .replace(/(\sd="[^"]*?)\d\d:\d\d:\d\d/, '$1' + hms);
  }

  livrer() {
    if (!this.route) return;
    while (this.file.length) {
      this.route.send(this.file.shift() + '\0');
      this.livrees++;
    }
  }

  /** Attend que la page ait reçu tout ce qu'on lui a livré. */
  async recu() {
    for (let i = 0; i < 400; i++) {
      const n = await this.page.evaluate(() => window.__camera.recus());
      if (n >= this.livrees) return;
      await attendre(5);
    }
    console.warn('[camera] la page n\'a pas tout reçu');
  }

  /** Une marque dans le fil des trames : guetter ce qui arrive APRÈS. */
  marque() { return this.toutes.length; }

  /** Attend (en temps réel) une trame du serveur, arrivée après `depuis`. */
  async guetter(depuis, pred, quoi, ms) {
    const fin = Date.now() + (ms || 4000);
    while (Date.now() < fin) {
      for (let i = depuis; i < this.toutes.length; i++) if (pred(this.toutes[i])) return this.toutes[i];
      await attendre(10);
    }
    console.warn('[camera] jamais reçu : ' + quoi);
    return null;
  }

  /** Libère la prochaine réplique retenue d'un PNJ (en l'attendant au besoin). */
  async liberer(pnj, ms) {
    const cle = pnj.toLowerCase();
    const fin = Date.now() + (ms || 15000);
    while (Date.now() < fin) {
      const i = this.retenues.findIndex((t) => String(attribut(t, 'u') || '').toLowerCase() === cle);
      // Datée au moment où on la laisse passer, pas à celui où le serveur l'a dite.
      if (i >= 0) { this.file.push(this.horodater(this.retenues.splice(i, 1)[0])); return true; }
      await attendre(20);
    }
    console.warn('[camera] ' + pnj + ' n\'a rien dit');
    return false;
  }

  /** Le début de la prise : l'horloge s'arrête, le hasard est regrainé. */
  async demarrer(graine) {
    this.direct = false;
    const maintenant = await this.page.evaluate(() => Date.now());
    await this.page.clock.pauseAt(maintenant + 1500);
    await this.page.evaluate((g) => window.__camera.graine(g), graine || 1);
    this.image = 0;
    this.tMs = 0;
  }

  /**
   * Une image : livrer ce qui attend, avancer l'horloge, mener les
   * animations, photographier pour chaque sortie.
   */
  async tourner(sorties, photo) {
    const dbg = process.env.KIT_CHAT_DEBUG ? (m) => console.log(`[camera] image ${this.image} ${m} ${Date.now() - d0} ms`) : () => {};
    const d0 = Date.now();
    this.livrer();
    await this.recu();
    dbg('reçu');
    const t = Math.round(this.image * 1000 / this.fps);
    const dt = t - this.tMs;
    if (dt > 0) await this.page.clock.runFor(dt);
    dbg('horloge');
    this.tMs = t;
    await this.page.evaluate((tt) => window.__camera.synchro(tt), t);
    dbg('synchro');
    const images = [];
    for (const s of sorties) {
      const png = await this.photo(s.o.capture || {});
      dbg('photo');
      await s.ecrire(png);
      images.push(png);
    }
    this.image++;
    if (photo) photo(images);
    return images;
  }

  /*
   * LA PHOTO, par le protocole de Chromium directement : deux fois plus
   * rapide que page.screenshot. Chromium REDESSINE le rectangle à l'échelle
   * demandée (texte et dessins vectoriels nets) ; les canevas des bouilles,
   * eux, ont la définition de la vue (deviceScaleFactor) — d'où des vues à
   * l'échelle 5 ou 6 pour les gros plans, photographiées à une échelle
   * inférieure ou égale. `alpha` laisse le fond transparent.
   */
  async photo(o) {
    const [lv, hv] = [this.page.viewportSize().width, this.page.viewportSize().height];
    const clip = o.clip || { x: 0, y: 0, width: lv, height: hv };
    if (o.alpha && !this.fondTransparent) {
      await this.cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      this.fondTransparent = true;
    }
    const r = await this.cdp.send('Page.captureScreenshot', {
      format: 'png', optimizeForSpeed: true, captureBeyondViewport: false,
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: o.echelle || this.echelle },
    });
    return Buffer.from(r.data, 'base64');
  }

  /** Laisse passer du temps SANS filmer (mise en place), à vitesse réelle. */
  async patienter(ms) {
    await attendre(ms);
    this.livrer();
  }
}

module.exports = { Camera, Sortie, SCRIPT_CAMERA, PNJ };
