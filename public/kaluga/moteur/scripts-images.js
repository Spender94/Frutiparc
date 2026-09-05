/*
 * Kaluga — les SCRIPTS D'IMAGE et de BOUTON du SWF, portés à la main.
 *
 * L'extracteur ne traduit pas le bytecode des DoAction : ils sont courts et
 * peu nombreux, et se lisent sans peine au désassembleur (scripts/
 * disasm-as2.js). Chaque clé est « <fichier>:<sprite>:<image> » ; `this` est
 * le clip dont c'est l'image. Les boutons ont leurs gestionnaires sous
 * « <fichier>:btn:<id> » ; là, `this` est le clip QUI CONTIENT le bouton —
 * c'est ainsi que Flash exécute un on(press) : dans le scénario du parent.
 *
 * Deux idiomes de l'auteur :
 *   · gotoAndStop(_parent.id + 1) sur la première image d'un sous-clip : le
 *     clip choisit sa planche d'après la tzongre (ou le papillon) qui le
 *     porte — l'image 1 des ailes est pour Kaluga, la 2 pour Piwali… ;
 *   · les portraits du menu : à l'image de fin de l'entrée, si `flGoAway`
 *     est levé on part (« leave »), sinon on rejoue l'image précédente —
 *     une boucle de respiration sur deux images.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur = racine.KalugaMoteur || {};

const stop = function () { this.stop(); };
const retirer = function () { this.removeMovieClip(); };
const versId = function () { this.gotoAndStop((this._parent && this._parent.id || 0) + 1); };
const aleatoire = () => Math.random() * 2 - 1;

const S = {
  // mcPause : le pictogramme tremble
  'kaluga:62:1': function () { if (this.gfx) { this.gfx._x = 3 * aleatoire(); this.gfx._y = 3 * aleatoire(); this.gfx._rotation = 3 * aleatoire(); } },
  'kaluga:62:2': function () { this.gotoAndPlay(1); },
  // la touche du tableau des options
  'kaluga:118:1': stop,
  'kaluga:118:22': function () { this.gotoAndPlay(2); },
  'kaluga:120:1': stop,
  'kaluga:133:1': stop,
  'kaluga:159:1': stop,
  // les yeux : cinq clignements de dix images, chacun revient à sa base
  'kaluga:204:1': stop,
  'kaluga:204:18': function () { this.gotoAndStop(10); },
  'kaluga:204:28': function () { this.gotoAndStop(20); },
  'kaluga:204:38': function () { this.gotoAndStop(30); },
  'kaluga:204:48': function () { this.gotoAndStop(40); },
  'kaluga:204:58': function () { this.gotoAndStop(50); },
  'kaluga:208:1': versId,
  'kaluga:212:1': stop,
  'kaluga:215:1': stop,
  'kaluga:225:1': stop,
  'kaluga:257:1': stop,
  'kaluga:257:12': function () { this.gotoAndStop(1); },
  'kaluga:257:35': function () { this.gotoAndStop(1); },
  'kaluga:263:41': function () { this.gotoAndPlay(1); },
  'kaluga:264:1': stop,
  'kaluga:270:17': function () { this.gotoAndPlay(1); },
  'kaluga:270:26': function () { this.gotoAndPlay(this.memoryFrame); },
  'kaluga:270:78': function () { this.gotoAndPlay(1); },
  'kaluga:279:1': stop,
  'kaluga:284:1': stop,
  'kaluga:317:53': function () { if (typeof this.kill === 'function') this.kill(); },
  'kaluga:331:19': retirer,
  'kaluga:386:1': function () { this.gotoAndStop((this._parent && this._parent.status || 0) + 1); },
  'kaluga:426:19': stop,
  'kaluga:426:76': function () { this.gotoAndPlay('stunLoop'); },
  'kaluga:442:41': function () { this.gotoAndPlay(1); },
  'kaluga:454:1': versId,
  'kaluga:454:17': versId,
  'kaluga:456:1': stop,
  'kaluga:467:1': stop,
  'kaluga:491:9': retirer,
  'kaluga:554:34': stop,
  'kaluga:565:16': stop,
  'kaluga:609:1': stop,
  'kaluga:617:1': stop,
  'kaluga:617:7': function () { const g = this._parent && this._parent._parent; if (g && typeof g.crunch === 'function') g.crunch(); },
  'kaluga:617:12': function () { const g = this._parent && this._parent._parent; if (g) g.flEating = false; },
  'kaluga:626:20': stop,
  'kaluga:626:42': stop,
  'kaluga:626:57': function () { if (typeof this.turn === 'function') this.turn(); },
  'kaluga:637:1': stop,
  'kaluga:639:5': function () { this.stop(); if (this._parent && typeof this._parent.setEndGamePanel === 'function') this._parent.setEndGamePanel(this.sheet); },
  'kaluga:741:1': stop,
  'kaluga:1076:5': stop,
  'kaluga:1076:20': function () { if (this._parent && typeof this._parent.endStartPanel === 'function') this._parent.endStartPanel(); },
  // la racine : le chargeur et la boucle du FLA, que le moteur n'utilise pas
  'kaluga:0:3': function () {}, 'kaluga:0:21': function () {}, 'kaluga:0:22': function () {}, 'kaluga:0:23': function () {},

  // ── la carte « challenge » : la porte du pommier ──
  'challenge:33:1': stop,
  'challenge:70:1': stop,
  'challenge:70:2': function () { const r = Math.floor(Math.random() * 100); this.flag = r ? !K.Key.isDown(78) : 0; },
  'challenge:70:26': function () { if (this.flag) this.gotoAndPlay('open'); },
  'challenge:70:99': function () { if (this.flag) this.gotoAndPlay('close'); },
  'challenge:70:295': stop,

  // ── la carte « mordor » : les fourmilières qui s'animent au hasard ──
  'mordor:0:2': function () { this.BASE = 70; this.RAND = 450; this.stop(); },
  'mordor:17:1': function () { this.gotoAndPlay('wait'); },
  'mordor:17:9': function () { this.cpt = (this._parent.BASE || 70) + Math.floor(Math.random() * (this._parent.RAND || 450)); },
  'mordor:17:11': function () { this.cpt--; if (this.cpt > 0) this.gotoAndPlay(this._currentframe - 1); else this.gotoAndPlay('anim'); },
  'mordor:23:1': function () { this.gotoAndPlay('wait'); },
  'mordor:23:10': function () { this.cpt = (this._parent.BASE || 70) + Math.floor(Math.random() * (this._parent.RAND || 450)); },
  'mordor:23:12': function () { this.cpt--; if (this.cpt > 0) this.gotoAndPlay(this._currentframe - 1); else this.gotoAndPlay('anim'); },
};

// Les portraits du menu (cinq tzongres) : entrée, respiration, sortie.
for (const [id, fin, boucle, out] of [[793, 18, 26, 30], [805, 18, 27, 31], [816, 15, 21, 27], [827, 13, 21, 27], [863, 14, 22, 27]]) {
  S[`kaluga:${id}:${fin}`] = function () { if (this.flGoAway) this.gotoAndPlay('leave'); };
  S[`kaluga:${id}:${boucle}`] = function () { if (!this.flGoAway) this.gotoAndPlay(this._currentframe - 1); };
  S[`kaluga:${id}:${out}`] = retirer;
}

K.scriptsImages = S;

// Les boutons : `this` est le clip qui contient le bouton, `b` le bouton.
const appeler = (o, nom, ...args) => { if (o && typeof o[nom] === 'function') return o[nom](...args); return undefined; };
K.scriptsBoutons = {
  'kaluga:btn:90': {
    press() { appeler(this._parent && this._parent._parent, 'pushDisc', this); },
    rollOut() { appeler(this._parent && this._parent._parent, 'rOut', this); },
    dragOut() { appeler(this._parent && this._parent._parent, 'rOut', this); },
    rollOver() { appeler(this._parent && this._parent._parent, 'rOver', this); },
  },
  'kaluga:btn:96': { press() { appeler(this._parent, 'closeOption'); } },
  'kaluga:btn:117': {
    press() { appeler(this._parent && this._parent._parent, 'initKey', this); },
    rollOut() { appeler(this._parent && this._parent._parent, 'rOut', this); },
    dragOut() { appeler(this._parent && this._parent._parent, 'rOut', this); },
    rollOver() { appeler(this._parent && this._parent._parent, 'rOver', this); },
  },
  'kaluga:btn:139': { press() { appeler(this._parent, 'traceInfo'); } },
  'kaluga:btn:582': {
    press() { if (this._parent) this._parent.flPanPressLeft = true; },
    release() { if (this._parent) this._parent.flPanPressLeft = false; },
    releaseOutside() { if (this._parent) this._parent.flPanPressLeft = false; },
  },
  'kaluga:btn:583': {
    press() { if (this._parent) this._parent.flPanPressRight = true; },
    release() { if (this._parent) this._parent.flPanPressRight = false; },
    releaseOutside() { if (this._parent) this._parent.flPanPressRight = false; },
  },
  'kaluga:btn:705': {
    press() { appeler(this, 'select'); },
    rollOver() { appeler(this, 'rOver'); },
    rollOut() { appeler(this, 'rOut'); },
    dragOut() { appeler(this, 'rOut'); },
  },
};

})(typeof window !== 'undefined' ? window : globalThis);
