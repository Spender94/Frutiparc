/*
 * LE JOURNAL D'UNE PARTIE — l'écriture commune des parties qu'on fait rejouer
 * au serveur (l'Arbre creux de MiniPixiz, l'arcade de Mini-Fever).
 *
 * Le principe est celui de Swapou et de JamaJama : le navigateur ne dit plus
 * « j'ai fait tant », il rend ce qu'il a JOUÉ — la graine que le serveur lui a
 * donnée, et la suite exacte de ce que le moteur a reçu, image par image. Le
 * serveur repasse le même moteur sur le même journal ; le score qu'il trouve
 * est le seul qui compte.
 *
 * Ce fichier ne tient que l'écriture, partagée par les deux jeux et par le
 * serveur (il se charge sous Node comme dans la page) :
 *
 *   · des ENTIERS en base 64 « VLQ » — l'écriture des cartes de sources :
 *     cinq bits utiles par caractère, le sixième dit « la suite continue ».
 *     Un petit entier tient en un caractère, et le journal reste du texte
 *     sûr dans une URL comme dans du JSON ;
 *   · le générateur reproductible (mulberry32, le même que le moteur de
 *     MiniPixiz) et le mélange qui tire une graine par épreuve.
 */
'use strict';

(function (racine) {

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALEUR = {};
for (let i = 0; i < ALPHABET.length; i++) VALEUR[ALPHABET[i]] = i;

// Un entier signé devient positif (zigzag) : 0, -1, 1, -2… → 0, 1, 2, 3…
const zig = (n) => (n < 0 ? ((-n) * 2 - 1) : n * 2);
const dezig = (n) => ((n & 1) ? -((n + 1) / 2) : n / 2);

/** Écrit une liste d'entiers (signés) en texte. */
function encoder(entiers) {
  let s = '';
  for (const brut of entiers) {
    let n = zig(Math.trunc(Number(brut) || 0));
    do {
      let c = n & 31;
      n = Math.floor(n / 32);
      if (n > 0) c |= 32;
      s += ALPHABET[c];
    } while (n > 0);
  }
  return s;
}

/**
 * Relit le texte. Rend null au premier caractère étranger, ou sur un entier
 * coupé en plein milieu : un journal abîmé ne se devine pas, il se refuse.
 */
function decoder(texte, max) {
  const s = String(texte || '');
  const out = [];
  const plafond = max || Infinity;
  let n = 0, mul = 1, enCours = false;
  for (let i = 0; i < s.length; i++) {
    const v = VALEUR[s[i]];
    if (v === undefined) return null;
    n += (v & 31) * mul;
    if (v & 32) {
      mul *= 32;
      enCours = true;
      if (mul > 2 ** 40) return null;       // un entier démesuré : du bruit
    } else {
      out.push(dezig(n));
      if (out.length > plafond) return null;
      n = 0; mul = 1; enCours = false;
    }
  }
  return enCours ? null : out;
}

// mulberry32 — même graine, même suite, dans tous les moteurs JavaScript
// (que des opérations entières sur 32 bits).
function generateur(graine) {
  let a = graine >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// La graine de l'épreuve n°k d'une partie : la graine de la partie, brassée
// avec le rang (le nombre d'or de Knuth, puis un tour de mulberry). Deux
// épreuves voisines n'ont rien en commun.
function graineDe(graine, k) {
  const g = generateur(((graine >>> 0) ^ Math.imul((k + 1) >>> 0, 0x9E3779B9)) >>> 0);
  return Math.floor(g() * 4294967296) >>> 0;
}

// Le pas de temps (`tmod`) voyage en 1024es : la valeur jouée EST celle du
// journal, au bit près, des deux côtés. Un millième d'image d'écart par pas,
// et le joueur ne le sent pas.
const QUANTUM_TMOD = 1024;
const quantifierTmod = (t) => Math.max(1, Math.round((Number(t) || 0) * QUANTUM_TMOD));

/*
 * LES BATTEMENTS d'une partie vérifiée (antitricheLight.js, « LE RALENTI »).
 *
 * Le journal prouve CE QUI a été joué, pas À QUELLE VITESSE : un « speed
 * hack » qui ralentit l'horloge du navigateur fait tourner le jeu deux fois
 * moins vite, et le journal reste authentique. Pendant la partie, on dit donc
 * au serveur, toutes les deux secondes, où en est le journal (`pas`) et si le
 * jeu est figé (`pause`) ou entre deux épreuves (`console`) ; c'est LUI qui
 * date chaque battement, avec son horloge à lui. Un ralenti ralentit aussi
 * nos minuteries — les battements arrivent plus espacés, sans importance.
 *
 * Un battement part aussi AUSSITÔT que l'état change : la pause posée ou
 * levée, une épreuve finie ou lancée. L'état se relit à chaque image
 * (requestAnimationFrame), tous les quarts de seconde (une minuterie, qui
 * tourne encore onglet caché) et sur les événements qui le font changer
 * (focus, clavier, pointeur) — écoutés APRÈS ceux du jeu, l'état y est déjà
 * à jour. Le serveur sait ainsi que l'intervalle qui suit un battement « en
 * jeu » est du jeu d'un bout à l'autre, et celui qui suit un battement « en
 * pause », de la pause.
 *
 *   const b = JournalPartie.battements({ sid, id, jeton, etat })
 *     etat() → { pas, pause, console } ou null (la partie n'est plus là :
 *              les battements s'arrêtent)
 *   b.finir() → une promesse : le dernier battement est parti (et revenu,
 *               ou une seconde et demie s'est écoulée). À appeler juste
 *               avant d'envoyer la fin.
 *
 * Le jeton ne part qu'une fois que le serveur a dit ne pas connaître la
 * partie (il a redémarré pendant qu'on jouait) : il s'en sert pour la
 * réinscrire.
 */
function battements(o) {
  if (!o || !o.id || !o.sid || typeof o.etat !== 'function' || typeof fetch === 'undefined') return null;
  const url = o.url || '/api/antitriche/battement';
  const periode = o.periode || 2000;
  const periodePause = o.periodePause || 10000;   // figé, rien ne presse
  let n = 0, fini = false, avecJeton = false, minuteur = null, cle = null, raf = null, veille = null;
  const lire = () => { try { return o.etat(); } catch (e) { return null; } };
  const clef = (e) => (e.pause ? 'p' : '-') + (e.console ? 'c' : '-');
  const programmer = (ms) => {
    if (minuteur) clearTimeout(minuteur);
    minuteur = fini ? null : setTimeout(envoyer, ms);
  };
  function envoyer() {
    if (fini) return Promise.resolve(null);
    const e = lire();
    if (!e) { arreter(); return Promise.resolve(null); }
    cle = clef(e);
    const corps = { sid: o.sid, id: o.id, n: ++n, pas: Math.max(0, Math.trunc(Number(e.pas)) || 0), pause: e.pause ? 1 : 0 };
    if (e.console) corps.console = 1;
    if (avecJeton && o.jeton) corps.jeton = o.jeton;
    programmer(e.pause ? periodePause : periode);
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps), keepalive: true })
      .then((r) => r.json())
      .then((j) => { if (j && j.error === 'inconnue') avecJeton = true; return j; })
      .catch(() => null);
  }
  const surveiller = () => {
    if (fini) return;
    const e = lire();
    if (!e) { arreter(); return; }
    if (clef(e) !== cle) envoyer();
  };
  const image = () => { if (fini) return; surveiller(); raf = requestAnimationFrame(image); };
  const EVENEMENTS = ['blur', 'focus', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'touchstart', 'mousedown'];
  const ecouter = (on) => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    for (const ev of EVENEMENTS) window[on ? 'addEventListener' : 'removeEventListener'](ev, surveiller);
    if (typeof document !== 'undefined') document[on ? 'addEventListener' : 'removeEventListener']('visibilitychange', surveiller);
  };
  function arreter() {
    if (fini) return;
    fini = true;
    if (minuteur) clearTimeout(minuteur);
    if (veille) clearInterval(veille);
    if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf);
    ecouter(false);
  }
  envoyer();
  if (typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(image);
  veille = setInterval(surveiller, 250);
  ecouter(true);
  return {
    signaler: envoyer,
    arreter,
    finir() {
      if (fini) return Promise.resolve(null);
      const dernier = envoyer();
      arreter();
      return Promise.race([dernier, new Promise((res) => setTimeout(res, 1500))]);
    },
  };
}

const API = { encoder, decoder, generateur, graineDe, QUANTUM_TMOD, quantifierTmod, zig, dezig, battements };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.JournalPartie = API;

})(typeof window !== 'undefined' ? window : globalThis);
