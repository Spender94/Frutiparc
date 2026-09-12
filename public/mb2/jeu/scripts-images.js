/*
 * MotionBall — les SCRIPTS D'IMAGE du SWF, portés à la main.
 *
 * L'extracteur ne traduit pas le bytecode des DoAction : ils sont courts —
 * cent dix, la plupart un stop() — et se lisent au désassembleur
 * (scripts/disasm-as2.js, étendu aux sprites). Chaque clé est
 * « mb2:<sprite>:<image> » ; `this` est le clip dont c'est l'image.
 *
 * Trois idiomes de l'auteur :
 *   · un COMPTEUR d'attente sur une image : `cpt = n` à l'image précédente,
 *     puis `cpt--; si cpt > 0, gotoAndPlay(image − 1)` — la boucle du poulpe
 *     qui meurt, de la pupille des objets ;
 *   · le même compteur écrit `cpt -= tmod`, où `tmod` est une variable
 *     GLOBALE que rien ne pose jamais (ni le jeu, ni le chargeur) : la
 *     soustraction donne NaN, `NaN > 0` est faux, et l'attente est SAUTÉE.
 *     La sortie du Classique s'ouvre donc sans ses seize images de pause,
 *     les billes du bumper de la mort sans leurs dix : on le reproduit
 *     (`this.cpt -= undefined`) plutôt que de « corriger » ce que le lecteur
 *     n'a jamais fait ;
 *   · des RAPPELS posés par le code sur le clip (loadReady, loadFinish,
 *     animDone, kataDone) et appelés par une image : la fonction est celle
 *     que la classe a accrochée à l'instance.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur = racine.KalugaMoteur || {};
const J = racine.Mb2Jeu = racine.Mb2Jeu || {};

const random = (n) => { const m = Math.trunc(n) || 0; return m > 0 ? Math.floor(Math.random() * m) : 0; };
const appeler = (o, nom) => { if (o && typeof o[nom] === 'function') o[nom](); };

const stop = function () { this.stop(); };
const retirer = function () { this.removeMovieClip(); };
const boucler = function () { this.gotoAndPlay(1); };
// « gotoAndStop(random(_totalframes) + 1) » : une image au hasard.
const auHasard = function () { this.gotoAndStop(random(this._totalframes) + 1); };
const kataDone = function () { appeler(this, 'kataDone'); };
const animDone = function () { appeler(this, 'animDone'); };
// Les six billes du bumper de la mort partent ensemble.
const jouerBilles = function () { for (const n of ['b0', 'b1', 'b2', 'b3', 'b4', 'b5']) if (this[n]) this[n].play(); };
// L'attente au compteur global `tmod` — jamais posé : NaN, et l'on passe.
const attendreTmod = function () { this.cpt -= undefined; if (this.cpt > 0) this.gotoAndPlay(this._currentframe - 1); };

const S = {
  // ── le jeu ──
  'mb2:47:10': retirer,                                            // hit : l'étincelle s'efface
  'mb2:59:1': function () { if (this.aura) this.aura.gotoAndPlay(10); this.stop(); },   // ballbox
  'mb2:59:15': retirer,
  'mb2:73:11': function () { appeler(this, 'loadReady'); this.stop(); },               // loading : prêt, on attend les données
  'mb2:73:16': function () { appeler(this, 'loadFinish'); },
  'mb2:80:1': stop, 'mb2:80:6': boucler,                           // fondMenu
  'mb2:88:7': stop, 'mb2:88:17': stop,                             // interred
  'mb2:97:10': retirer,                                            // flashLine
  'mb2:215:53': stop,                                              // le logo d'une boule du menu
  'mb2:253:22': function () { this.gotoAndStop('time'); },         // time counter : fin de l'animation du tour
  'mb2:285:1': stop,                                               // la grille de la carte
  'mb2:299:2': stop, 'mb2:299:8': stop, 'mb2:299:25': stop,        // door
  'mb2:316:6': function () { appeler(this, 'animDone'); this.removeMovieClip(); },     // TBSpawn
  'mb2:321:6': retirer,                                            // TBVanish
  'mb2:337:36': retirer,                                           // FXDalleCut
  'mb2:345:42': stop, 'mb2:345:59': stop, 'mb2:345:76': retirer,   // FXbourgeon (explode, death)
  'mb2:350:1': auHasard,                                           // une écaille projetée
  'mb2:354:7': retirer,                                            // FXWaterQueue
  'mb2:472:21': boucler,                                           // FXWater
  'mb2:476:1': auHasard,                                           // un maillon de liane
  'mb2:483:1': function () { this._yscale = (random(2) * 2 - 1) * 100; auHasard.call(this); },   // une feuille
  'mb2:511:22': function () { if (this.flLoopv) this.gotoAndPlay('loop'); },           // FXFire
  'mb2:511:34': retirer,
  'mb2:522:1': stop,                                               // crane.anim du serpent
  'mb2:550:14': function () { if (this._parent) this._parent.removeMovieClip(); },     // dalle : refermée
  'mb2:560:1': stop, 'mb2:560:16': stop,                           // checkpoint
  'mb2:568:11': function () { this.cpt = 16; },                    // exit : l'ouverture…
  'mb2:568:13': attendreTmod,                                      // …et son attente sautée
  'mb2:568:18': function () { this.flOpen = true; this.stop(); },
  'mb2:573:1': stop,                                               // c0 du téléporteur
  'mb2:576:23': stop,                                              // bteleport
  'mb2:581:7': stop, 'mb2:581:17': stop,                           // interblue
  'mb2:604:7': stop, 'mb2:604:19': stop,                           // interupt
  'mb2:618:3': function () { if (random(100) > 0) this.gotoAndPlay(this._currentframe - 1); },   // le reflet du zapper
  'mb2:642:4': stop, 'mb2:642:13': retirer,                        // boss tir
  'mb2:658:1': stop, 'mb2:665:1': stop,                            // b, oeil du poulpe
  'mb2:692:26': boucler,                                           // souffle
  'mb2:743:1': stop,                                               // boss
  'mb2:743:12': function () { if (this.souffle) { this.souffle._xscale = 1; this.souffle._yscale = 1; } },
  'mb2:743:13': stop,
  'mb2:743:15': function () { this.gotoAndPlay('aspire'); },
  'mb2:743:29': function () { this.gotoAndPlay('eat'); },
  'mb2:743:32': stop,
  'mb2:743:73': function () { if (this.control) this.control.change_pattern = true; },
  'mb2:743:103': stop,
  'mb2:743:105': function () { this.cpt = 6; },
  'mb2:743:108': function () { if (this.cpt-- > 0) this.gotoAndPlay(this._currentframe - 2); },
  'mb2:743:124': stop,
  'mb2:748:1': stop, 'mb2:748:10': retirer,                        // icon grelot
  'mb2:757:1': stop, 'mb2:757:11': retirer,                        // red
  'mb2:763:1': function () { this.stop(); if (this._parent) this._parent.pupille = true; },   // l'œil d'un objet
  'mb2:763:5': function () { this.cpt = random(100); },
  'mb2:763:7': function () { if (this.cpt-- > 0) this.gotoAndPlay(this._currentframe - 1); },
  'mb2:764:2': function () {
    if (this.pupille && random(30) === 0) {
      if (this.pup) { this.pup._rotation = random(360); this.pup.play(); }
      this.pupille = false;
    }
  },
  'mb2:764:3': function () { this.gotoAndPlay(2); },
  'mb2:775:32': function () { this._rotation = this._rotation + random(40); },
  'mb2:776:5': stop,                                               // item
  'mb2:792:1': stop, 'mb2:792:11': retirer, 'mb2:792:12': stop,    // itembox
  'mb2:821:1': stop,                                               // bshadow
  'mb2:833:6': stop, 'mb2:833:12': stop,                           // bmagnet
  'mb2:838:1': stop, 'mb2:838:3': function () { this.cpt = 10; }, 'mb2:838:5': attendreTmod,   // une bille du bumper de la mort
  'mb2:839:1': stop, 'mb2:839:2': jouerBilles, 'mb2:839:9': stop,  // bdeath
  'mb2:852:1': stop, 'mb2:852:2': jouerBilles,                     // btime (l'auteur y a copié le même script : sans billes, rien)
  'mb2:860:1': stop,                                               // bnormal
  'mb2:862:5': stop, 'mb2:862:13': stop, 'mb2:862:22': stop,       // ball icon
  'mb2:898:1': stop, 'mb2:898:11': retirer,                        // blue

  // ── la racine et le clip principal : l'amorçage et la boucle du FLA ──
  'mb2:0:1': stop,
  'mb2:900:1': function () { J.Manager.init(this); },
  'mb2:900:2': function () { K.Std.update(); J.Manager.main(); },
  'mb2:900:3': function () { this.gotoAndPlay(this._currentframe - 1); },
};

// La Tourneboule : chaque kata rappelle kataDone à son coup, animDone à sa
// fin ; le vol boucle, la disparition aussi jusqu'à ce que le code l'arrête.
for (const f of [17, 39, 61, 83, 104, 125]) S['mb2:435:' + f] = kataDone;
for (const f of [27, 48, 69, 91, 113, 134, 155, 163, 220]) S['mb2:435:' + f] = animDone;
S['mb2:435:179'] = function () { this.gotoAndPlay('flyVanish'); };

K.scriptsImages = S;
K.scriptsBoutons = {};

})(typeof window !== 'undefined' ? window : globalThis);
