/*
 * Burning Kiwi — les SCRIPTS D'IMAGE et de BOUTON du SWF, portés à la main.
 *
 * L'extracteur ne traduit pas le bytecode des DoAction / DefineButton2 :
 * ils se lisent au désassembleur (scripts/disasm-as2.js --sprites). Chaque
 * clé est « <biblio>:<sprite>:<image> » (ou « <biblio>:btn:<id> ») ; `this`
 * est le clip dont c'est l'image — pour un bouton, le clip qui le contient.
 *
 * Les idiomes de l'auteur (Motion-Twin, 2004) :
 *   · une ATTENTE au compteur : `cpt = n` (ou `cpt = _parent.popUpDuration`)
 *     sur une image, puis `cpt -= gtmod ; si cpt > 0, gotoAndPlay(image − 1)`
 *     — `gtmod` est la variable GLOBALE du timer de secours (timer.as,
 *     _global.gtmod), que le jeu recalcule à chaque image : la pause dure le
 *     même temps réel quelle que soit la cadence ;
 *   · un DRAPEAU posé pour le code : `kill = true` (le bouton du menu, la
 *     brillance), `_parent.canMoveShines`, `canPlaySound` trois parents plus
 *     haut (la bille qui explose dans le résumé du survivor) ;
 *   · les boutons du menu appellent `onPush()`, `onOver()`, `onOut()`, des
 *     fonctions que attachButton a posées sur le clip menuButton — `this`
 *     du gestionnaire de bouton est ce clip.
 *
 * La racine (sprite 0) : image 1 « si _parent.name est indéfini,
 * gotoAndPlay('main') » (le jeu lancé seul), image 3 la boucle du
 * préchargeur (même saut), image 5 `stop` — c'est là que `main` (sprite 637)
 * et `limited` sont posés. Le clip main : image 1 tout le code du jeu puis
 * init(), image 2 main(), image 3 gotoAndPlay(image − 1) : main() tourne
 * une fois par image, à 40 images par seconde.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur = racine.KalugaMoteur || {};
const J = racine.BkiwiJeu = racine.BkiwiJeu || {};

const random = (n) => { const m = Math.trunc(n) || 0; return m > 0 ? Math.floor(Math.random() * m) : 0; };
const appeler = (o, nom) => { if (o && typeof o[nom] === 'function') return o[nom](); return undefined; };
const gtmod = () => (J.G ? J.G.gtmod : 1);

const stop = function () { this.stop(); };
const retirer = function () { this.removeMovieClip(); };
const stopRetirer = function () { this.stop(); this.removeMovieClip(); };
const boucler = function () { this.gotoAndPlay(1); };
const stopKill = function () { this.stop(); this.kill = true; };
const precedente = function () { this.gotoAndPlay(this._currentframe - 1); };
// « cpt -= gtmod ; if (cpt > 0) gotoAndPlay(_currentframe - 1) »
const attendreCpt = function () { this.cpt -= gtmod(); if (this.cpt > 0) this.gotoAndPlay(this._currentframe - 1); };
const attendreC = function () { this.c -= gtmod(); if (this.c > 0) this.gotoAndPlay(this._currentframe - 1); };
// « cpt = _parent.popUpDuration » (la durée d'affichage des pop-up, gameData)
const cptPopUp = function () { this.cpt = this._parent ? this._parent.popUpDuration : undefined; };
const cLimited = function () { this.c = this._parent ? this._parent.limitedPopUpDuration : undefined; };

const S = {
  // ── la racine et le clip principal ──
  'bkiwi:0:1': function () { if (!this._parent || this._parent.name === undefined) this.gotoAndPlay('main'); },
  // Image 3 : « loaded = false ; WaitForFrame ; loaded = true » — tout est
  // chargé d'avance ici, on part à main (sinon gotoAndPlay(image − 1)).
  'bkiwi:0:3': function () { this.loaded = true; if (this.loaded) this.gotoAndPlay('main'); else this.gotoAndPlay(this._currentframe - 1); },
  'bkiwi:0:5': stop,
  'bkiwi:637:1': function () {
    // Tout le code du FLA (code.as, mainGame.as, IA.as, gameMovies.as,
    // sounds.as, preload.as, main.as, menu.as, final.as) puis init().
    J.initialiserDonnees(this);
    J.installerMoteur(this);
    J.installerMenu(this);
    J.installerFinal(this);
    J.M = this;
    J.init();
  },
  'bkiwi:637:2': function () { J.main(); },
  'bkiwi:637:3': precedente,

  // ── la voiture (car, 64) ──
  'bkiwi:10:9': boucler,                                   // les pneus qui tournent
  'bkiwi:59:8': function () { this.gotoAndStop(1); },      // instantBoost
  'bkiwi:63:1': function () {                              // boost : les quatre flammes partent d'une image au hasard
    const total = this.b0 ? this.b0._totalframes : 0;
    for (const n of ['b0', 'b1', 'b2', 'b3']) if (this[n]) this[n].gotoAndPlay(random(total) + 1);
  },
  'bkiwi:63:2': stop,

  // ── les fumées et le choc ──
  'bkiwi:67:14': stopKill,                                 // smokeSkid
  'bkiwi:70:16': stopRetirer,                              // smokeAccel
  'bkiwi:73:16': stopRetirer,                              // smokeMud
  'bkiwi:77:38': function () { this.stop(); this.kill = 1; },   // hitCar

  // ── les pop-up de course ──
  'bkiwi:123:8': cptPopUp,                                 // chronoSummary
  'bkiwi:123:10': attendreCpt,
  'bkiwi:123:20': stopRetirer,
  'bkiwi:132:1': function () { if (this.barre) this.barre._xscale = 0; },   // goBox (barre est dans bloc : rien)
  'bkiwi:132:2': function () {
    const p = this._parent;
    if (this.bloc && this.bloc.barre) this.bloc.barre._xscale = (1 - p.timerStart / p.delaiDebut) * 100;
  },
  'bkiwi:132:3': function () { if (!this._parent.timerStart) this.gotoAndPlay(this._currentframe - 1); },
  'bkiwi:132:12': cptPopUp,
  'bkiwi:132:13': function () { this.cpt -= gtmod(); if (!(this.cpt > 0)) this.gotoAndPlay(this._currentframe + 2); },
  'bkiwi:132:14': precedente,
  'bkiwi:132:25': stopRetirer,
  'bkiwi:138:22': stop,                                    // finalPosition

  // ── le bouton du menu (menuButton, 166) ──
  'bkiwi:166:2': function () { appeler(this, 'onUpdate'); this.pushed = false; },
  'bkiwi:166:6': stop,
  'bkiwi:166:12': function () {
    this.stop();
    if (this.pushed && this.onEnd) {
      if (this._parent && this._parent.vs) this._parent.vs.menuPhase = this.id;
      this.onEnd();
    }
    this.kill = true;
  },

  // ── le menu principal (mainMenu, 280) ──
  'bkiwi:170:12': stop, 'bkiwi:170:19': stop,              // la bande
  'bkiwi:175:43': boucler,
  'bkiwi:234:7': stop, 'bkiwi:234:14': stop,               // infoPanel (show / hide)
  'bkiwi:238:10': stop, 'bkiwi:238:17': stop,
  'bkiwi:279:8': stop,

  // ── les résumés ──
  'bkiwi:315:14': stop,                                    // tournamentSummary
  'bkiwi:316:11': stop,                                    // finalScrolls
  'bkiwi:326:8': stop,                                     // nitroMC
  'bkiwi:396:2': function () {                             // raceStats : le rang
    const p = this._parent;
    if (!p.perfect && this.perfect) this.perfect._visible = false;
    if (this.rank) {
      if (this.rank.perfects) this.rank.perfects.gotoAndStop(p.perfectsRank);
      if (this.rank.pos) this.rank.pos.gotoAndStop(p.posRank);
    }
    this.stop();
  },
  'bkiwi:397:14': stop,
  'bkiwi:405:7': cLimited,                                 // specialsBox
  'bkiwi:405:9': attendreC,
  'bkiwi:405:17': stopRetirer,
  'bkiwi:413:14': stop,                                    // survivorSummary
  'bkiwi:429:1': function () { this.c = 15; },             // loseLife : la bille qui explose
  'bkiwi:429:3': attendreC,
  'bkiwi:429:18': function () {
    const p3 = this._parent && this._parent._parent && this._parent._parent._parent;
    if (p3) p3.canPlaySound = true;
  },
  'bkiwi:429:26': stopRetirer,
  'bkiwi:433:14': stop,                                    // gameOver

  // ── l'annonce et le décor du menu ──
  'bkiwi:502:14': function () { if (this._parent) this._parent.canMoveShines = true; this.stop(); },   // announce
  'bkiwi:505:22': boucler,                                 // backgroundFx
  'bkiwi:509:1': function () {                             // les aiguilles du compteur
    if (this.aiguille) this.aiguille._rotation = random(360);
    if (this.aiguille2) this.aiguille2._rotation = random(360);
  },
  'bkiwi:509:2': function () {
    if (this.aiguille) this.aiguille._rotation += 5 * gtmod();
    if (this.aiguille2) this.aiguille2._rotation += gtmod();
  },
  'bkiwi:509:3': precedente,
  'bkiwi:519:16': stopKill,                                // shine
  'bkiwi:544:1': function () { this.cpt = random(30); },   // le kiwi du logo qui cligne
  'bkiwi:544:3': attendreCpt,
  'bkiwi:544:18': function () { this.cpt = random(10); },
  'bkiwi:544:20': attendreCpt,
  'bkiwi:544:46': function () { this.cpt = random(100); },
  'bkiwi:544:48': function () { this.cpt -= gtmod(); if (this.cpt > 0) this.gotoAndPlay(this._currentframe - 1); else this.gotoAndPlay(1); },
  'bkiwi:548:6': stop, 'bkiwi:548:14': stopRetirer,        // logo
  'bkiwi:571:15': stop,                                    // keysManager

  // ── la ligne de temps (timeLine, 590) ──
  'bkiwi:582:1': function () { this.cpt = 110; },
  'bkiwi:582:3': function () { this.cpt -= gtmod(); if (this.cpt > 0) this.gotoAndPlay(this._currentframe - 1); else { this.stop(); this._visible = false; } },
  'bkiwi:586:1': function () { this.repeat = 17; },
  'bkiwi:586:8': function () { this.repeat--; if (this.repeat < 0) { if (this._parent) this._parent.prevFrame(); } else this.gotoAndPlay('loop'); },
  'bkiwi:589:7': boucler,

  // ── perfect, superPop, limited ──
  'bkiwi:593:1': cptPopUp, 'bkiwi:593:3': attendreCpt, 'bkiwi:593:4': stopRetirer,
  'bkiwi:618:1': cptPopUp, 'bkiwi:618:3': attendreCpt, 'bkiwi:618:4': stopRetirer,
  'bkiwi:622:8': cLimited,
  'bkiwi:622:10': attendreC,
  'bkiwi:622:16': function () { this._visible = false; this.stop(); },

  // ── l'intro (intro.swf) ──
  'intro:15:147': stop, 'intro:76:50': stop, 'intro:97:27': stop, 'intro:153:64': stop, 'intro:242:977': stop,
  'intro:152:35': function () { this.gotoAndPlay(29); },
  'intro:242:75': function () { this.gotoAndPlay('cask'); },
  'intro:242:104': function () { if (this.volD) this.volD.gotoAndPlay(79); if (this.volG) this.volG.gotoAndPlay(79); },
  'intro:242:278': function () { this.gotoAndPlay('gants'); },
  'intro:242:404': function () { this.gotoAndPlay('part2'); },
  'intro:242:509': function () { this.gotoAndPlay('burn'); },
  'intro:242:593': function () { this.gotoAndPlay('kiwi'); },
};

const B = {
  // menuButton : `this` est le clip menuButton (onPush… posés par attachButton)
  'bkiwi:btn:165': {
    release() { this.pushed = true; appeler(this, 'onPush'); },
    rollOver() { appeler(this, 'onOver'); },
    rollOut() { appeler(this, 'onOut'); },
  },
  // giveUpBox : oui / non
  'bkiwi:btn:289': {
    rollOver() { if (this.yes) this.yes._visible = true; if (this.no) this.no._visible = false; },
    release() { if (this._parent) this._parent.giveUpBt = 1; },
  },
  'bkiwi:btn:290': {
    rollOver() { if (this.yes) this.yes._visible = false; if (this.no) this.no._visible = true; },
    release() { if (this._parent) this._parent.giveUpBt = 2; },
  },
  // skipButton (jamais posé par le jeu)
  'bkiwi:btn:317': {
    press() { this.pressed = true; },
    release() { if (this.pressed && this._parent) this._parent.clicked = true; this.pressed = false; },
  },
  // les coupes du palmarès (announce.win)
  'bkiwi:btn:459': { rollOver() { this.txt = 'Coupe Elite d\'argent'; }, rollOut() { this.txt = ''; } },
  'bkiwi:btn:460': { rollOver() { this.txt = 'FrutiCoupe d\'argent'; }, rollOut() { this.txt = ''; } },
  'bkiwi:btn:461': { rollOver() { this.txt = 'Coupe Elite d\'Or'; }, rollOut() { this.txt = ''; } },
  'bkiwi:btn:462': { rollOver() { this.txt = 'FrutiCoupe d\'Or'; }, rollOut() { this.txt = ''; } },
};
// keysManager.manager : les cinq touches à redéfinir (_parent._parent.keyAsked = i)
for (let i = 0; i < 5; i++) {
  B['bkiwi:btn:' + (562 + i)] = {
    release() { const p2 = this._parent && this._parent._parent; if (p2) p2.keyAsked = i; },
  };
}

K.scriptsImages = Object.assign(K.scriptsImages || {}, S);
K.scriptsBoutons = Object.assign(K.scriptsBoutons || {}, B);

})(typeof window !== 'undefined' ? window : globalThis);
