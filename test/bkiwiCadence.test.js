/*
 * BURNING KIWI — LA CADENCE : MÊME SUITE DE TOUCHES, MÊME TEMPS, QUELLES QUE
 * SOIENT LES DURÉES D'IMAGE.
 *
 * « Quelques ralentissements imperceptibles. Les meilleurs joueurs continuent
 *   de jouer sur la version Flash car ils n'arrivent pas à reproduire leurs
 *   temps sur la version light. »
 *
 * CE QUI ÉTAIT DÉJÀ JUSTE. Le lecteur avance la physique à pas fixes de 25 ms
 * sur une horloge virtuelle (flash.js, Scene.demarrer) : getTimer(), donc le
 * chrono (`getTimer() − timerLap`, moteur.js, comme code.as) et le gtmod du
 * timer de secours (25/32), ne connaissent que les pas. Une image qui tarde
 * est rattrapée par autant de pas, jusqu'à 500 ms. Mesuré au navigateur avec
 * un pilote qui joue DANS le pas : 21,850 s au tour (21,350 s depuis que le
 * gtmod suit le fichier compilé, cf. biblio.js), que les images durent
 * 16,7 ms, 33 ms (processeur ralenti quatre fois) ou 150 ms (fil occupé
 * 90 ms toutes les 200 ms, six pas par image).
 *
 * CE QUI NE L'ÉTAIT PAS. Le joueur, lui, pilote AU TEMPS ; et chaque pas
 * lisait le clavier à l'instant de son exécution. Six pas joués en rafale
 * lisaient donc tous le clavier tel qu'il est à la FIN de la rafale : une
 * flèche lâchée au milieu des 150 ms l'était pour les six pas, ou tenue pour
 * les six. Un lecteur Flash à quarante images régulières l'aurait vue au bon
 * pas. Le chrono reste juste, la voiture n'a pas sauté : rien ne se voit, mais
 * la course n'est plus la même — et celui qui frôle la bordure la touche.
 *
 * LA CORRECTION (jeu/cadence.js). Chaque frappe est datée (ev.timeStamp,
 * l'heure de la touche, pas celle de son traitement) et appliquée devant le
 * pas dont c'est l'instant — la règle du Flash Player d'époque, dont le
 * minuteur exécutait l'image k à 25·k ms. La physique ne dépend plus que de
 * la suite des frappes et de leurs dates.
 *
 * CE QUE CES TESTS VERROUILLENT :
 *   · la file datée, à l'unité : un pas joué en retard lit le clavier de son
 *     heure, une frappe plus tardive attend le pas suivant, tout lâcher vide
 *     la file, une date invraisemblable (l'horloge d'époque) vaut maintenant ;
 *   · la course entière, dans Node (le lecteur et le jeu avec un DOM minimal,
 *     les zones des circuits testées par un Path2D géométrique, le tracé
 *     neutralisé) : la même suite de touches, datées depuis le GO, donne le
 *     même temps au tour et la même trajectoire au millième de pixel à 25 ms
 *     réguliers, à 16,7 / 33,3 ms (un écran à 60 Hz) et à 10 / 40 / 70 ms ;
 *   · que le test mord : sans la file datée, le rejeu à 10 / 40 / 70 ms ne
 *     boucle même plus le tour ;
 *   · et la physique elle-même, que rien ici ne devait changer : le pilote
 *     automatique du test boucle Green Hill en 21 350 ms — 21 850 à l'époque
 *     de la correction, avant que le minuteur ne suive le fichier compilé.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/* ══════════════════════════════════════════════════════════════════════════
 * LA SIMULATION — dans un processus enfant (`node ce-fichier --course {…}`),
 * pour que chaque course parte d'un lecteur neuf.
 * ══════════════════════════════════════════════════════════════════════════ */

function simuler(opts) {
  // ── Un DOM minimal ──
  class DOMMatrix {
    constructor(v) {
      if (Array.isArray(v) && v.length >= 6) { [this.a, this.b, this.c, this.d, this.e, this.f] = v; }
      else if (v && typeof v === 'object') { Object.assign(this, { a: v.a, b: v.b, c: v.c, d: v.d, e: v.e, f: v.f }); }
      else { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
    }
    multiply(o) {
      return new DOMMatrix([this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b, this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d,
        this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f]);
    }
  }
  // Path2D géométrique : sous-chemins aplatis (M, L, Q, C, Z), transformables,
  // et le test « dedans ? » par lancer de rayon — ce qu'isPointInPath fait.
  class Path2D {
    constructor(d) { this.sous = []; if (d instanceof Path2D) this.sous = d.sous.map((s) => s.slice()); else if (typeof d === 'string') this.analyser(d); }
    analyser(d) {
      const tok = d.match(/[MLQCZ]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
      let i = 0, cur = null, x = 0, y = 0;
      const num = () => Number(tok[i++]);
      while (i < tok.length) {
        const c = tok[i++];
        if (c === 'M') { x = num(); y = num(); cur = [[x, y]]; this.sous.push(cur); }
        else if (c === 'L') { x = num(); y = num(); cur.push([x, y]); }
        else if (c === 'Q') {
          const cx = num(), cy = num(), ex = num(), ey = num();
          for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; cur.push([u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey]); }
          x = ex; y = ey;
        } else if (c === 'C') {
          const x1 = num(), y1 = num(), x2 = num(), y2 = num(), ex = num(), ey = num();
          for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; cur.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey]); }
          x = ex; y = ey;
        } else if (c === 'Z') { if (cur && cur.length) { x = cur[0][0]; y = cur[0][1]; } cur = null; }
        else { i--; x = num(); y = num(); if (cur) cur.push([x, y]); }
      }
    }
    addPath(p, m) { for (const s of p.sous) this.sous.push(m ? s.map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]) : s.slice()); }
    contient(x, y, regle) {
      let croisements = 0, enroulement = 0;
      for (const s of this.sous) {
        const n = s.length;
        for (let i = 0; i < n; i++) {
          const [x0, y0] = s[i], [x1, y1] = s[(i + 1) % n];
          if ((y0 <= y) !== (y1 <= y)) {
            const xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0);
            if (xi > x) { croisements++; enroulement += y1 > y0 ? 1 : -1; }
          }
        }
      }
      return regle === 'evenodd' ? (croisements % 2) === 1 : enroulement !== 0;
    }
  }
  const ctxFactice = (canvas) => new Proxy({ canvas }, {
    get(o, p) {
      if (p === 'canvas') return o.canvas;
      if (p === 'isPointInPath') return (chemin, x, y, regle) => chemin.contient(x, y, regle);
      if (p === 'measureText') return (t) => ({ width: 6 * String(t).length });
      if (p === 'getTransform') return () => new DOMMatrix();
      if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) });
      if (p === 'createPattern') return () => ({ setTransform() {} });
      if (p in o) return o[p];
      return () => {};
    },
    set(o, p, v) { o[p] = v; return true; },
  });
  const elementFactice = (tag) => ({
    tag, style: {}, width: 0, height: 0, enfants: [], attributs: {},
    getContext() { if (!this.ctx) this.ctx = ctxFactice(this); return this.ctx; },
    addEventListener() {}, removeEventListener() {}, appendChild(e) { this.enfants.push(e); }, setAttribute(k, v) { this.attributs[k] = v; },
    getBoundingClientRect() { return { left: 0, top: 0, x: 0, y: 0, width: 350, height: 350 }; }, focus() {}, setPointerCapture() {}, remove() {},
  });
  class Image {
    set src(v) { this._src = v; this.complete = true; this.naturalWidth = 1; this.naturalHeight = 1; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
    get src() { return this._src; }
  }
  // Un contexte audio qui décode tout et ne joue rien (sans lui, la musique du
  // menu « introuvable » arrête le jeu).
  class AudioContext {
    constructor() { this.state = 'running'; this.destination = {}; }
    resume() { return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 1 }); }
    createGain() { return { connect() {}, gain: { value: 1 } }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {}, buffer: null, loop: false, onended: null }; }
  }
  globalThis.window = undefined;
  globalThis.DOMMatrix = DOMMatrix;
  globalThis.Path2D = Path2D;
  globalThis.Image = Image;
  globalThis.AudioContext = AudioContext;
  globalThis.document = {
    createElement: elementFactice, createElementNS: (ns, t) => elementFactice(t), getElementById: () => null,
    body: elementFactice('body'), documentElement: elementFactice('html'), addEventListener() {}, hidden: false,
  };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  const rafFile = [];
  globalThis.requestAnimationFrame = (f) => { rafFile.push(f); return rafFile.length; };
  globalThis.cancelAnimationFrame = () => {};
  // L'horloge de la page : l'horodatage de l'image en cours.
  let tRaf = 0;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => tRaf }, configurable: true, writable: true });
  // Les fichiers de public/ (et les musiques du disque Flash), les routes du serveur en très court.
  globalThis.fetch = async (url) => {
    const chemin = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (chemin === '/api/bkiwi/daily') return new Response(JSON.stringify({ ok: true, trk: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (chemin.startsWith('/api/') || chemin.startsWith('/do/')) return new Response('ok=1', { status: 200 });
    const f = chemin.startsWith('/swf/games/') ? path.join(ROOT, 'Games', chemin.slice('/swf/games/'.length)) : path.join(ROOT, 'public', chemin);
    if (!fs.existsSync(f)) return new Response('', { status: 404 });
    const buf = fs.readFileSync(f);
    return new Response(buf, { status: 200, headers: { 'Content-Length': String(buf.length), 'X-Taille-Reelle': String(buf.length) } });
  };
  for (const f of ['public/kaluga/moteur/formes.js', 'public/kaluga/moteur/flash.js', 'public/kaluga/moteur/texte.js', 'public/kaluga/moteur/son.js',
    'public/kaluga/moteur/chargeur.js', 'public/bkiwi/jeu/scripts-images.js', 'public/bkiwi/jeu/fantome.js', 'public/bkiwi/jeu/biblio.js',
    'public/bkiwi/jeu/donnees.js', 'public/bkiwi/jeu/moteur.js', 'public/bkiwi/jeu/menu.js', 'public/bkiwi/jeu/final.js',
    'public/bkiwi/plateforme.js', 'public/bkiwi/jeu/cadence.js', 'public/bkiwi/jeu/principal.js']) require(path.join(ROOT, f));
  const K = globalThis.KalugaMoteur;
  const Jeu = globalThis.BkiwiJeu;

  // Les frappes datées du rejeu : injectées avant l'image dont l'horodatage
  // les dépasse — l'ordre du navigateur, les entrées puis le rAF.
  let frappes = [];
  const injecter = (t) => {
    while (frappes.length && frappes[0].t <= t) { const e = frappes.shift(); (e.v ? K.Key.presser : K.Key.relacher).call(K.Key, e.code, e.t); }
  };
  // Battre : n rappels de rAF ; le premier à t = 0, puis les durées du motif.
  // On rend la main entre deux salves (les promesses du chargement).
  let kMotif = 0, premier = true;
  const battre = async (n, motif) => {
    for (let k = 0; k < n && rafFile.length; k++) {
      const f = rafFile.shift();
      if (premier) premier = false; else tRaf += motif[kMotif++ % motif.length];
      injecter(tRaf);
      f(tRaf);
    }
    await new Promise((r) => setImmediate(r));
  };

  (async () => {
    const canvas = elementFactice('canvas'); canvas.width = 350; canvas.height = 350;
    const { scene } = await globalThis.demarrerBurningKiwi({ canvas, sid: '' });
    scene.rendre = () => {};                                   // pas de tracé : la physique seule
    if (opts.sansCadence) K.Key.$cadence.defaire();            // l'ancienne lecture : la frappe compte à l'arrivée
    const M = () => Jeu.M;
    // Le menu jusqu'à la connexion (phase 121 : les commandes par défaut).
    const pret = () => !!(M() && M().vs && M().controls && M().controls[0] != null && Jeu.client && Jeu.client.connected);
    for (let i = 0; i < 4000 && !pret(); i++) await battre(8, [25]);
    if (!pret()) throw new Error('le menu n’a pas atteint la connexion');
    M().musicON = false;
    M().vs.gameMode = M().TIMETRIAL; M().vs.selectedTrack = opts.trk || 0; M().vs.selectedCar = 2; M().vs.menuPhase = -1; M().vs.mainPhase = 3;
    for (let i = 0; i < 4000 && !(M().vs.mainPhase === 1 && M().track); i++) await battre(4, [25]);
    if (M().vs.mainPhase !== 1) throw new Error('la course n’a pas démarré');
    // gtmod : sa valeur convergée (25 × 0,032 = 0,8 à 1e-6 près après dix
    // secondes de menu) — le menu a été court-circuité, on la pose.
    Jeu.G.gtmod = 0.8;
    const kBase = scene.numeroTick;                            // d'ici au GO, un nombre de pas fixe (dGo)
    const m = M(), s = scene;
    const J = { pas: 0, tours: [], tele: [], touches: [] };

    // Le pilote : poursuite pure sur la polyligne des checkpoints, frein avant
    // les virages serrés. Il joue DANS le pas (l'état du clavier posé
    // directement), et note chaque changement : c'est la suite de touches.
    const P = m.CP[m.track.id].map((c) => ({ x: c.x, y: c.y }));
    const n = P.length, L = 70, CROISIERE = 7, ENTREE = 8, SORTIE_H = 3;
    const getAngle = (a) => { let r = a % 360; if (r >= 180) r -= 360; if (r <= -180) r += 360; return r; };
    const seg = (k) => { const a = P[k % n], b = P[(k + 1) % n]; return { a, b, l: Math.hypot(b.x - a.x, b.y - a.y) }; };
    const cum = [0]; for (let k = 0; k < n; k++) cum.push(cum[k] + seg(k).l);
    const total = cum[n];
    const proj = (k, x, y) => {
      const g = seg(k); const t = Math.max(0, Math.min(1, ((x - g.a.x) * (g.b.x - g.a.x) + (y - g.a.y) * (g.b.y - g.a.y)) / (g.l * g.l)));
      return { t, d: Math.hypot(x - (g.a.x + t * (g.b.x - g.a.x)), y - (g.a.y + t * (g.b.y - g.a.y))), s: cum[k] + t * g.l };
    };
    const pointA = (sAbs) => {
      const v = ((sAbs % total) + total) % total; let k = 0; while (k < n - 1 && cum[k + 1] < v) k++;
      const g = seg(k); const t = (v - cum[k]) / g.l; return { x: g.a.x + t * (g.b.x - g.a.x), y: g.a.y + t * (g.b.y - g.a.y) };
    };
    const virage = (k) => {
      const a = seg((k - 1 + n) % n), b = seg(k % n);
      const c1 = Math.atan2(a.b.y - a.a.y, a.b.x - a.a.x), c2 = Math.atan2(b.b.y - b.a.y, b.b.x - b.a.x);
      return Math.abs(getAngle((c2 - c1) * 180 / Math.PI));
    };
    let kProj = 0, gauche = false, droite = false, frein = false, lapPrec = null;
    const poser = (code, v) => {
      J.touches.push([J.pas, code, v ? 1 : 0]);
      const c = K.Key.$cadence;
      (v ? (c ? c.presser0 : K.Key.presser) : (c ? c.relacher0 : K.Key.relacher)).call(K.Key, code);
    };
    if (opts.rejeu) {
      const go = kBase + opts.rejeu.dGo;                       // le numéro du pas du GO
      frappes = opts.rejeu.touches.map(([p, code, v]) => ({ t: 25 * (go + p - 1) + opts.decalage, code, v: !!v })).sort((a, b) => a.t - b.t);
    }
    const TOURS = opts.tours || 1, MAX_PAS = 2600;
    const tick0 = s.tick.bind(s);
    s.tick = function () {
      const c = m.cars && m.cars[0];
      if (c && !m.gamePaused && !c.finished && m.vs.mainPhase === 1 && !J.fini) {
        J.pas++;
        if (J.pas === 1) { J.dGo = s.numeroTick + 1 - kBase; if (!opts.rejeu) poser(38, true); }
        if (lapPrec !== null && c.timerLap !== lapPrec) {
          J.tours.push(c.timerLap - lapPrec);
          if (J.tours.length >= TOURS) J.fini = { pas: J.pas - 1, total: J.tours.reduce((a, b) => a + b, 0) };
        }
        lapPrec = c.timerLap;
        if (!J.fini && !opts.rejeu) {
          let best = null;
          for (let dk = 0; dk < 3; dk++) { const k = (kProj + dk) % n; const p = proj(k, c.x, c.y); if (!best || p.d < best.d) best = Object.assign({ k }, p); }
          kProj = best.k;
          const cible = pointA(best.s + L);
          const ecart = getAngle(Math.atan2(cible.y - c.y, cible.x - c.x) * 180 / Math.PI - c._rotation);
          const vg = gauche ? ecart < -SORTIE_H : ecart < -ENTREE, vd = droite ? ecart > SORTIE_H : ecart > ENTREE;
          if (vg !== gauche) { gauche = vg; poser(37, gauche); }
          if (vd !== droite) { droite = vd; poser(39, droite); }
          let vCible = CROISIERE;
          for (let dk = 1; dk <= 2; dk++) { const k = (kProj + dk) % n; const dist = ((cum[k] - best.s) % total + total) % total; const a = virage(k); if (dist < 140 && a > 45) vCible = Math.min(vCible, a > 90 ? 4 : 5.5); }
          const vf = c.speed > vCible + 0.3 ? true : (c.speed < vCible - 0.3 ? false : frein);
          if (vf !== frein) { frein = vf; poser(38, !frein); }
        }
        if (!J.fini && J.pas >= MAX_PAS) J.fini = { pas: J.pas, total: null, nonBoucle: true };
        if (!J.fini && J.pas % 40 === 0) J.tele.push({ pas: J.pas, chrono: K.getTimer() - c.timerLap, x: +c.x.toFixed(3), y: +c.y.toFixed(3), rot: +c._rotation.toFixed(3), v: +c.speed.toFixed(4) });
      }
      if (c && c.finished && !J.fini) { J.tours.push(K.getTimer() - c.timerLap); J.fini = { pas: J.pas, total: J.tours.reduce((a, b) => a + b, 0) }; }
      return tick0();
    };
    for (let i = 0; i < 100000 && !J.fini; i++) await battre(40, opts.motif);
    process.stdout.write(JSON.stringify({ dGo: J.dGo, pas: J.fini.pas, tours: J.tours, total: J.fini.total, nonBoucle: !!J.fini.nonBoucle,
      touches: J.touches.filter((t) => t[0] <= J.fini.pas), tele: J.tele }));
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

if (process.argv[2] === '--course') { simuler(JSON.parse(process.argv[3])); return; }

const courir = (opts) => new Promise((resoudre, rejeter) => {
  execFile(process.execPath, [__filename, '--course', JSON.stringify(opts)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: Object.assign({}, process.env, { NODE_OPTIONS: '' }) },
    (err, stdout, stderr) => {
      if (err) return rejeter(new Error('simulation : ' + err.message + '\n' + stderr));
      try { resoudre(JSON.parse(stdout)); } catch (e) { rejeter(new Error('simulation : sortie illisible\n' + stdout.slice(0, 500) + '\n' + stderr)); }
    });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. LA FILE DATÉE, À L'UNITÉ
 * ══════════════════════════════════════════════════════════════════════════ */

// Le lecteur et le module, sans scène : une scène factice porte les trois
// champs que la file regarde (tPrecedent, accumule, periode) et un tick().
globalThis.window = undefined;
globalThis.addEventListener = () => {};
require(path.join(ROOT, 'public/kaluga/moteur/formes.js'));
require(path.join(ROOT, 'public/kaluga/moteur/flash.js'));
require(path.join(ROOT, 'public/bkiwi/jeu/cadence.js'));
const K = globalThis.KalugaMoteur;
const J = globalThis.BkiwiJeu;

function banc() {
  let horloge = 10000;
  const lus = [];
  // La scène part comme si une image avait battu à 9975 : celle de 10000 joue
  // le pas nominal 10000, et ainsi de suite tous les 25 ms.
  const scene = { periode: 25, tPrecedent: 9975, accumule: 0, tick() { lus.push([this.tPrecedent - this.accumule, K.Key.isDown(38), K.Key.isDown(37)]); } };
  if (K.Key.$cadence) K.Key.$cadence.defaire();
  K.Key.enfoncees = {};
  const cadence = J.installerCadence(scene, { maintenant: () => horloge });
  // Une image à l'horodatage t : la boucle du lecteur, en raccourci — le retard
  // s'accumule, chaque pas en retire 25 ms, le pas est joué ensuite.
  const image = (t) => {
    horloge = t;
    scene.accumule += t - scene.tPrecedent; scene.tPrecedent = t;
    while (scene.accumule >= scene.periode) { scene.accumule -= scene.periode; scene.tick(); }
  };
  // L'horloge de la page avance aussi entre deux images : c'est là que les frappes arrivent.
  return { scene, lus, cadence, image, avancer: (t) => { horloge = t; } };
}

test('un pas joué en retard lit le clavier de SON heure, pas celui de la fin de la rafale', () => {
  const b = banc();
  b.image(10000);                                  // le pas nominal 10000
  // Une image qui tarde : à 10150, six pas (nominaux 10025 … 10150). L'accélérateur
  // est pressé à 10060, lâché à 10110 : les frappes arrivent avant l'image.
  b.avancer(10149);
  K.Key.presser(38, 10060);
  K.Key.relacher(38, 10110);
  b.image(10150);
  assert.deepStrictEqual(b.lus.slice(1).map(([t, haut]) => [t, haut]),
    [[10025, false], [10050, false], [10075, true], [10100, true], [10125, false], [10150, false]],
    'pressé pour les pas 10075 et 10100 seulement');
  assert.strictEqual(b.cadence.file.length, 0);
});

test('une frappe plus tardive que l’heure du pas attend le pas suivant — la règle du Flash Player', () => {
  const b = banc();
  b.image(10000);
  // L'image à 10033 (un écran à 60 Hz) joue le pas nominal 10025 ; la frappe de
  // 10030 est arrivée avant l'image mais après l'heure du pas.
  b.avancer(10031);
  K.Key.presser(37, 10030);
  b.image(10033);
  assert.deepStrictEqual(b.lus[1], [10025, false, false], 'pas encore');
  b.image(10050);
  assert.deepStrictEqual(b.lus[2], [10050, false, true], 'au pas de 10050');
  assert.strictEqual(b.lus.length, 3);
});

test('une frappe sans date vaut maintenant, une date invraisemblable aussi ; tout lâcher vide la file', () => {
  const b = banc();
  b.image(10025);                                  // les pas 10000 et 10025
  b.image(10040);                                  // une image sans pas (15 ms de retard) : l'horloge est à 10040
  K.Key.presser(38);                               // la manette tactile : pas de date → 10040
  K.Key.presser(37, Date.now());                   // l'horloge d'époque (millisecondes depuis 1970) → 10040
  assert.deepStrictEqual(b.cadence.file.map((e) => e.t), [10040, 10040]);
  b.image(10050);                                  // le pas nominal 10050 ≥ 10040
  assert.deepStrictEqual(b.lus[2], [10050, true, true]);
  // Tout lâcher : ce qui est tenu se lâche, ce qui attendait n'arrive jamais.
  K.Key.presser(39, 10060);
  K.Key.toutRelacher();
  assert.strictEqual(b.cadence.file.length, 0);
  assert.deepStrictEqual(K.Key.enfoncees, {});
  b.image(10100);
  assert.ok(!K.Key.isDown(39), 'la flèche droite n’a jamais compté');
  b.cadence.defaire();
});

test('la page et l’amorçage installent la cadence, avant que la scène ne démarre', () => {
  const page = fs.readFileSync(path.join(ROOT, 'public/bkiwi/index.html'), 'utf8');
  const iCadence = page.indexOf('<script src="/bkiwi/jeu/cadence.js"></script>');
  const iPrincipal = page.indexOf('<script src="/bkiwi/jeu/principal.js"></script>');
  assert.ok(iCadence > 0 && iCadence < iPrincipal, 'cadence.js est chargé avant principal.js');
  const principal = fs.readFileSync(path.join(ROOT, 'public/bkiwi/jeu/principal.js'), 'utf8');
  const iInstall = principal.indexOf('J.installerCadence(scene)');
  assert.ok(iInstall > principal.indexOf('new K.Scene(canvas, biblio, { cadence: 40 })'));
  assert.ok(iInstall < principal.indexOf('scene.demarrer()'));
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. LA COURSE ENTIÈRE : MÊME SUITE DE TOUCHES → MÊME TEMPS
 * ══════════════════════════════════════════════════════════════════════════ */

// Un tour de Green Hill (circuit 0), voiture 2, au pilote automatique : la
// référence, et sa suite de touches datées depuis le GO.
// 21 850 ms tant que gtmod valait 25/32 ; 21 350 depuis que le minuteur suit
// le fichier compilé (25 × 0,032 = 0,8, biblio.js) — la même course, 2,4 %
// plus vite, comme en Flash.
const TOUR_ATTENDU = 21350;
let reference;
test('la référence : le pilote boucle Green Hill en 21 350 ms à 25 ms réguliers — la physique n’a pas bougé', async () => {
  reference = await courir({ motif: [25], tours: 1 });
  assert.strictEqual(reference.nonBoucle, false);
  assert.strictEqual(reference.total, TOUR_ATTENDU, 'le temps au tour du pilote');
  assert.strictEqual(reference.pas, TOUR_ATTENDU / 25, 'le chrono compte des pas : 854 × 25 ms');
  assert.ok(reference.touches.length > 100, 'une suite de touches fournie : ' + reference.touches.length);
  assert.ok(reference.tele.length >= 20);
});

const memeCourse = (a, b, ou) => {
  assert.strictEqual(b.nonBoucle, false, ou + ' : le tour boucle');
  assert.strictEqual(b.total, a.total, ou + ' : même temps au tour');
  assert.deepStrictEqual(b.tours, a.tours, ou + ' : mêmes tours');
  assert.deepStrictEqual(b.tele, a.tele, ou + ' : même trajectoire, au millième de pixel, tous les quarante pas');
};

test('les mêmes touches, datées depuis le GO, donnent la même course à 25 ms, à 16,7 / 33,3 ms et à 10 / 40 / 70 ms', async () => {
  const rejeu = { dGo: reference.dGo, touches: reference.touches };
  // −12 ms : la frappe tombe au milieu de l'intervalle qui précède son pas,
  // comme celle d'un joueur ; 0 et −24 encadrent l'intervalle.
  const cas = [];
  for (const decalage of [-12, 0, -24]) {
    for (const motif of [[25], [16.667, 33.333], [10, 40, 70]]) cas.push({ motif, decalage });
  }
  const resultats = await Promise.all(cas.map((c) => courir({ motif: c.motif, tours: 1, rejeu, decalage: c.decalage })));
  resultats.forEach((r, i) => memeCourse(reference, r, 'images ' + cas[i].motif.join('/') + ' ms, frappes à ' + cas[i].decalage + ' ms'));
});

test('le test mord : sans la file datée, le même rejeu sous des images de 10 / 40 / 70 ms n’est plus la même course', async () => {
  const rejeu = { dGo: reference.dGo, touches: reference.touches };
  const [lisse, rafales] = await Promise.all([
    courir({ motif: [25], tours: 1, rejeu, decalage: -12, sansCadence: true }),
    courir({ motif: [10, 40, 70], tours: 1, rejeu, decalage: -12, sansCadence: true }),
  ]);
  memeCourse(reference, lisse, 'sans la file, à 25 ms réguliers (une frappe par pas : rien ne change)');
  // En rafale, chaque pas lisait le clavier de la fin de la rafale : la
  // voiture part ailleurs dès les premiers pas.
  const ecart = Math.max(...rafales.tele.slice(0, 10).map((t, i) => Math.hypot(t.x - reference.tele[i].x, t.y - reference.tele[i].y)));
  assert.ok(rafales.nonBoucle || rafales.total !== reference.total || ecart > 10,
    'l’ancienne lecture donnait une autre course (écart ' + ecart.toFixed(1) + ' px, tour ' + rafales.total + ')');
});
