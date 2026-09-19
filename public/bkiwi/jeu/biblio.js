/*
 * Burning Kiwi — la BIBLIOTHÈQUE : ce que le SWF seul contenait, désassemblé
 * (scripts/disasm-as2.js --sprites), faute de source — les `#include
 * "../ext/inc/…"` de Games/burningKiwi/inc/main.as ne sont pas dans le dépôt :
 *
 *   · timer-fp.as : le `gtmod`, la variable GLOBALE (_global.gtmod — la
 *     fonction est compilée avec _global préchargé en registre) que toute la
 *     physique multiplie. initTimer(32) le pose à 1 ; mainTimer(), à chaque
 *     image, lit l'écart de getTimer() depuis l'image précédente et le lisse :
 *     gtmod = 0,97·gtmod + 0,03·(écart / 32). À 40 images par seconde (le SWF),
 *     l'écart vaut 25 ms et gtmod tend vers 0,78125 — c'est LA constante de la
 *     vitesse du jeu, ce que les joueurs ont dans les doigts. Le lecteur
 *     partagé bat à 40 i/s sur une horloge virtuelle de 25 ms : même gtmod.
 *     randomT(n) tire au sort sur n / gtmod ;
 *   · depth.as : les profondeurs par NIVEAUX (initDepth(levels, steps) —
 *     20 niveaux de 200 par défaut, 40 de 150 pour le clip principal) :
 *     calcDepth(level, protect) rend la prochaine profondeur libre du niveau,
 *     tourne dans ses `steps` cases, verrouille celles qu'on protège ;
 *     removeMovieClip rend la sienne à son parent (unlockDepth) ;
 *   · sounds.as : playSound(id, panning, offset, duration) crée un Sound sur
 *     le clip forcé (forceSoundMC), l'attache et le lance ; playSoundInMC sur
 *     un clip donné ; fadeSound ;
 *   · keyNames.as : les noms des touches, en français (initKeyNames("fr")),
 *     pour l'écran des commandes ;
 *   · stringLib.as et varSecure2.as : rien n'en est appelé — varSecure n'est
 *     même pas compilé : vs.vsInit(), vsSecureAll() et vsCheckAll() tombent
 *     dans le vide, comme dans le fichier. On garde des fonctions vides.
 *
 * Et les idiomes de l'AVM1 dont le portage a besoin : random(n) qui tronque
 * son argument, removeMovieClip sur un clip absent qui ne fait rien, un
 * clip qu'on « décharge » (unloadMovie), Stage.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.BkiwiJeu = racine.BkiwiJeu || {};

// ── _global ──────────────────────────────────────────────────────────────
const G = J.G = {
  gtmod: 1,
  DEPTHDEBUG: false,
  DEPTH_LIB_INCLUDED: true,
  soundsDisabled: false,
  forcedSoundMC: undefined,
};

// random(n) : un entier de [0, n[, n tronqué (0 si n ≤ 0 ou NaN).
const random = (n) => { const m = Math.trunc(n) || 0; return m > 0 ? Math.floor(Math.random() * m) : 0; };
J.random = random;
J.getTimer = () => K.getTimer();
// removeMovieClip sur ce qui n'existe pas (ou plus) : rien, comme en AVM1.
J.rm = (mc) => { if (mc && typeof mc.removeMovieClip === 'function') mc.removeMovieClip(); };
J.Stage = { width: 350, height: 350 };
J.Key = K.Key;

// ── timer-fp.as ──────────────────────────────────────────────────────────
J.initTimer = function (M, optimalFPS) {
  M.timerOptimalFPS = optimalFPS;
  G.gtmod = 1;
  M.oldAlternateTimer = K.getTimer();
  M.timerConstant = M.timerOptimalFPS / 1000;
  M.timerUseOldTimer = false;
};
J.mainTimer = function (M, averageTimer) {
  const t = K.getTimer();
  const delta = t - M.oldAlternateTimer;
  M.oldAlternateTimer = t;
  if (!M.timerUseOldTimer) {
    if (averageTimer == false) G.gtmod = delta / M.timerOptimalFPS;                // eslint-disable-line eqeqeq
    else G.gtmod = G.gtmod * 0.97 + (delta / M.timerOptimalFPS) * 0.03;
  } else {
    if (averageTimer == false) G.gtmod = M.timerConstant * delta;                  // eslint-disable-line eqeqeq
    else G.gtmod = G.gtmod * 0.97 + (M.timerConstant * delta) * 0.03;
  }
};
J.useOldTimer = function (M) { M.timerUseOldTimer = true; };
J.randomT = function (range) { return random(Math.round(range / G.gtmod)); };

// ── depth.as : MovieClip.prototype.initDepth / calcDepth / unlockDepth ───
const Clip = K.Clip;
Clip.prototype.initDepth = function (levels, steps, defaultProtectValue) {
  if (this.linearDepthLocks !== undefined) { depthError('this object use another depth manager !'); return -1; }
  if (steps === undefined) steps = 200;
  if (levels === undefined) levels = 20;
  if (defaultProtectValue === undefined) defaultProtectValue = true;
  this.defaultProtectFlag = defaultProtectValue;
  this.depthTable = new Array(levels);
  this.depthLocks = new Array(levels * steps);
  this.depthSteps = steps;
  return undefined;
};
Clip.prototype.calcDepth = function (level, protect) {
  if (level * this.depthSteps > this.depthLocks.length) { depthError('invalid level number: ' + level); return null; }
  if (protect === undefined) protect = this.defaultProtectFlag;
  let tries = 0, ok, d;
  do {
    ok = true;
    if (this.depthTable[level] === undefined) this.depthTable[level] = 0;
    d = this.depthTable[level] + level * this.depthSteps;
    this.depthTable[level]++;
    if (this.depthTable[level] % this.depthSteps === 0) this.depthTable[level] = 0;
    if (this.depthLocks[d]) { ok = false; tries++; }
  } while (!ok && tries < this.depthSteps);
  if (ok) {
    if (protect) this.depthLocks[d] = true;
    return d;
  }
  depthError("can't allocate a depth for level " + level);
  return undefined;
};
Clip.prototype.unlockDepth = function (d) { this.depthLocks[d] = null; };
function depthError(msg) { if (G.DEPTHDEBUG) console.warn('DEPTH-ERROR : ' + msg); }
// removeMovieClip rend sa profondeur au parent, comme la surcharge du fichier
// (MovieClip.prototype.removeMovieClipOld) — pour TOUS les clips de la page.
{
  const ancien = K.Affichable.prototype.removeMovieClip;
  K.Affichable.prototype.removeMovieClip = function () {
    if (this._parent && this._parent.unlockDepth !== undefined && this._parent.depthLocks) this._parent.unlockDepth(this.getDepth());
    ancien.call(this);
  };
}
// unloadMovie : le clip se vide de ce qu'un loadClip y avait mis.
Clip.prototype.unloadMovie = function () {
  for (const e of this.$enfants.slice()) this.retirerEnfant(e);
  this.$def = null;
  this.$frame = 1;
};

// ── sounds.as (_global) ──────────────────────────────────────────────────
J.forceSoundMC = function (pathMC) { G.forcedSoundMC = pathMC; };
J.disableSounds = function () { G.soundsDisabled = true; };
J.enableSounds = function () { G.soundsDisabled = false; };
J.playSound = function (sndID, panning, offset, duration) {
  if (G.soundsDisabled) return undefined;
  const snd = G.forcedSoundMC !== undefined ? new K.Sound(G.forcedSoundMC) : new K.Sound();
  snd.attachSound(sndID);
  if (offset != null && duration != null) snd.start(offset, duration);   // eslint-disable-line eqeqeq
  else snd.start();
  if (panning != null && typeof snd.setPan === 'function') snd.setPan(panning);   // eslint-disable-line eqeqeq
  return snd;
};
J.playSoundInMC = function (sndID, targetMC, panning, offset, duration) {
  if (G.soundDisabled) return undefined;                 // la coquille du fichier : jamais posé
  const snd = new K.Sound(targetMC);
  snd.attachSound(sndID);
  if (offset != null && duration != null) snd.start(offset, duration);   // eslint-disable-line eqeqeq
  else snd.start();
  if (panning != null && typeof snd.setPan === 'function') snd.setPan(panning);   // eslint-disable-line eqeqeq
  return snd;
};
J.fadeSound = function (son, offset, seuil) {
  let vol;
  if (seuil == null) vol = Math.min(100, Math.max(0, son.getVolume() + offset));   // eslint-disable-line eqeqeq
  else {
    vol = son.getVolume() + offset;
    if ((offset < 0 && vol < seuil) || (offset > 0 && vol > seuil)) vol = seuil;
  }
  son.setVolume(vol);
};
J.playSoundOD = function (sndID, offset, duration) { J.playSound(sndID, undefined, offset, duration); };
J.playSoundPan = function (sndID, panning) { J.playSound(sndID, panning); };

// ── keyNames.as ──────────────────────────────────────────────────────────
const keyNames_US = new Array(256), keyNames_FR = new Array(256);
for (let i = 0; i < 256; i++) { keyNames_US[i] = '?'; keyNames_FR[i] = '?'; }
for (let i = 65; i <= 90; i++) { keyNames_US[i] = String.fromCharCode(i); keyNames_FR[i] = String.fromCharCode(i); }
for (let i = 48; i <= 57; i++) { keyNames_US[i] = String.fromCharCode(i); keyNames_FR[i] = String.fromCharCode(i); }
for (let i = 96; i <= 105; i++) { keyNames_US[i] = 'NumPad ' + (i - 96); keyNames_FR[i] = 'PavNum ' + (i - 96); }
Object.assign(keyNames_US, { 106: 'NumPad *', 107: 'NumPad +', 108: 'NumPad Enter', 109: 'NumPad -', 110: 'NumPad Del', 111: 'NumPad /' });
Object.assign(keyNames_FR, { 106: 'PavNum *', 107: 'PavNum +', 108: 'PavNum Entrée', 109: 'PavNum -', 110: 'PavNum Suppr', 111: 'PavNum /' });
for (let i = 112; i <= 123; i++) { keyNames_US[i] = 'F ' + (i - 111); keyNames_FR[i] = 'F ' + (i - 111); }
Object.assign(keyNames_FR, { 1: 'Mouse left', 2: 'Mouse right', 4: 'Mouse middle' });
Object.assign(keyNames_US, {
  8: 'Backspace ', 9: 'TAB ', 12: 'Delete ', 13: 'Return ', 16: 'Shift ', 17: 'Control ', 18: 'Alt ', 20: 'CapsLock ',
  27: 'Escape ', 32: 'Spacebar ', 33: 'Page up', 34: 'Page down', 35: 'End ', 36: 'Home ', 37: 'Left ', 38: 'Up ',
  39: 'Right ', 40: 'Down ', 45: 'Insert ', 46: 'Delete ', 47: 'Help ', 144: 'VerrNum ', 186: '; :', 187: '= +',
  189: '- _', 191: '/ ?', 192: '~', 219: '[ {', 220: '\\|', 221: '] }', 222: '" \'',
});
Object.assign(keyNames_FR, {
  1: 'Souris gauche', 2: 'Souris droite', 4: 'Souris milieu', 8: 'Retour ', 9: 'TAB ', 12: 'Supprimer ', 13: 'Entrée ',
  16: 'Majuscule ', 17: 'Controle ', 18: 'Alt ', 20: 'Verr.Maj.', 27: 'Echappe ', 32: 'Espace ', 33: 'Page préc.',
  34: 'Page suiv.', 35: 'Fin ', 36: 'Début ', 37: 'Gauche ', 38: 'Haut ', 39: 'Droite ', 40: 'Bas ', 45: 'Insérer',
  46: 'Supprimer ', 47: 'Aide ', 144: 'VerrNum ', 186: '$ £', 187: '= +', 189: '- _', 191: ': /', 192: 'ù %',
  219: '° )', 220: '* µ', 221: '^ ¨', 222: '²',
});
J.keyNames_US = keyNames_US;
J.keyNames_FR = keyNames_FR;
J.initKeyNames = function (M, lang) { M.keyNames = J['keyNames_' + String(lang).toUpperCase()]; };
// getAnyKey(testMouseButtons) : le premier code enfoncé, de 8 (ou 1) à 222.
J.getAnyKey = function (testMouseButtons) {
  let found;
  const debut = testMouseButtons ? 1 : 8;
  for (let i = debut; i < 223 && found === undefined; i++) if (K.Key.isDown(i)) found = i;
  return found;
};

// ── varSecure2.as : absent du fichier compilé — vs.vsInit() et les autres
// appels tombent dans le vide. Des fonctions vides, pour l'écrire pareil.
J.vsInit = function () {};
J.vsSecureAll = function () {};
J.vsCheckAll = function () {};

// ── les traces du fichier (gdebug, warning, error) : rien à l'écran ──────
J.gdebug = function () {};
J.warning = function (msg) { if (J.TRACE) console.warn('[bkiwi] ' + msg); };
J.error = function (msg) { console.error('[bkiwi] ' + msg); };
J.traceTxt = function () {};

})(typeof window !== 'undefined' ? window : globalThis);
