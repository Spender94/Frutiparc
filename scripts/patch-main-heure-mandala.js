#!/usr/bin/env node
// legacy/main.swf : rendre l'HEURE à la frutimandala.
//
//   node scripts/patch-main-heure-mandala.js
//
// ── Ce que fait le SWF d'origine ──
//
// Le cadran en haut à droite du bureau est un « wheel » : cp.WheelMng tient
// deux disques et les fait tourner de l'un à l'autre —
//
//     this.list = ["whFruitMonth", "whDayNight"];
//
// whDayNight (classe wheel.DayNight) est le disque JOUR/NUIT : il charge son
// décor externe, /wheel/wheel0.swf, dans `skin`, puis pose son afficheur et le
// remet à l'heure toutes les minutes :
//
//     wheelInit()  → skin.mc.display.attachMovie("extGameNumb", "hour", 1,
//                        { link: "police", num: "21:37", scale: 85, _y: 52 });
//     updateDayCoef() → var d = servTime.getDateObject();
//                       this.dayCoef = (d.getHours() + d.getMinutes()/60) / 24;
//                       this.setRot(this.dayCoef * 360);      // le ciel tourne
//                       skin.mc.display.hour.setNum(hh + ":" + mm);   // l'heure
//
// Le ciel tourne bien. L'heure, elle, n'est jamais apparue.
//
// ── Pourquoi ──
//
// `extGameNumb` est un symbole de wheel0.swf, et c'est un sprite VIDE : une
// image, aucun contenu, aucun code. Tout son comportement vient d'une classe,
// que wheel0.swf lui accroche lui-même à l'ouverture (DoAction du sprite
// `mc`) :
//
//     Object.registerClass("extGameNumb", ext.game.Numb);
//
// Or `ext.game.Numb` n'existe nulle part. C'est une classe de la bibliothèque
// de jeu partagée de Motion-Twin (celle que les sources de Grapiz appellent
// encore : `Object.registerClass("mcGoldNumber", ext.game.Numb)`), et la
// version de main.swf dont nous disposons ne l'embarque pas — le
// classLoader du .fla de développement allait chercher bumdum.swf sur un
// serveur qui n'existe plus depuis vingt ans. Résultat : registerClass lie le
// symbole à `undefined`, le clip attaché reste le sprite vide, `setNum` n'est
// pas une méthode, et l'appel se perd dans le silence de l'AVM1.
//
// Les chiffres, eux, ont toujours été là : le symbole `police` de wheel0.swf
// est une pellicule de 41 images dont les douze premières donnent exactement
// ce qu'il faut —
//
//     images  1 à 10 : les chiffres 0 à 9 (bleu bordé de blanc)
//     image      11  : vide
//     image      12  : les deux-points
//     images 19 à 41 : les mêmes chiffres en rouge, pour d'autres usages
//
// soit, image par image, la table « 0123456789 : ». C'est elle que la classe
// restituée ci-dessous utilise.
//
// ── Ce que la rustine ajoute ──
//
// Un DoInitAction de plus, qui définit `_global.ext.game.Numb` : le clip se
// remplit d'un chiffre par caractère, pris dans la pellicule que `link`
// désigne. On la modèle sur kaluga.Numb (Games/kaluga/class/kaluga/Numb.as),
// qui est la copie que le même auteur a faite de cette classe dans le paquet
// du jeu — mêmes paramètres (num, link, align, scale), même construction, même
// centrage. UNE différence, et elle est décisive : kaluga.Numb fait
// `Number(num).toString()`, ce qui suffit à un score mais rendrait « NaN »
// pour « 21:37 ». La classe partagée garde la chaîne telle quelle — c'est bien
// une chaîne que DayNight lui passe, et Grapiz aussi (`num: string(value)`).
//
// Rien du code d'origine n'est touché : wheel0.swf accroche sa classe comme il
// l'a toujours fait, elle existe désormais. Ce que ça répare dépasse l'horloge
// — tout `extGameNumb` du bureau retrouve ses chiffres.
//
// La rustine se reconnaît à sa table de caractères et ne se pose qu'une fois.
// Sauvegarde : legacy/main.swf.avant-heure-mandala.

'use strict';

const fs = require('fs');
const path = require('path');
const G = require('./lib/swf-greffe.js');
const A = require('./lib/as2-asm.js');

const { OPS: O, INDEFINI, pousse: P, fonction, assembler, etiquette, saut, si } = A;

const SWF = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const SAUVE = SWF + '.avant-heure-mandala';

// La pellicule `police`, image par image. L'indice dans cette table, plus un,
// EST le numéro d'image — d'où le « 11 » (vide) pour tout ce qu'elle ignore.
const TABLE = '0123456789 :';
const VIDE = 11;
const LIEN_DEFAUT = 'police';        // celui de la frutimandala

// Les mêmes raccourcis que les autres rustines du bureau.
const lire = (nom) => [P(nom), O.getVariable];
const membre = (nom) => [P(nom), O.getMember];
const appel = (objet, methode, args) => [
  ...args.slice().reverse(), P(args.length), objet, P(methode), O.callMethod,
];
// _global.ext.game.Numb, et son prototype.
const CLASSE = [lire('_global'), membre('ext'), membre('game'), membre('Numb')];
const PROTO = [...CLASSE, membre('prototype')];

// ── Le constructeur ──
// attachMovie recopie l'objet d'initialisation AVANT d'appeler le
// constructeur : `num`, `link`, `scale` sont donc déjà là.
const CORPS_CTOR = assembler([
  appel([lire('this')], 'init', []), O.pop,
]);

// ── init() : les valeurs par défaut, puis le premier affichage ──
const CORPS_INIT = assembler([
  // if (this.align == undefined) this.align = 1;
  lire('this'), membre('align'), P(INDEFINI), O.egal, O.non, si('scale'),
  lire('this'), P('align'), P(1), O.setMember,
  etiquette('scale'),
  // if (this.scale == undefined) this.scale = 100;
  lire('this'), membre('scale'), P(INDEFINI), O.egal, O.non, si('lien'),
  lire('this'), P('scale'), P(100), O.setMember,
  etiquette('lien'),
  // if (this.link == undefined) this.link = "police";
  lire('this'), membre('link'), P(INDEFINI), O.egal, O.non, si('num'),
  lire('this'), P('link'), P(LIEN_DEFAUT), O.setMember,
  etiquette('num'),
  // if (this.num != undefined) this.setNum(this.num);
  lire('this'), membre('num'), P(INDEFINI), O.egal, si('fin'),
  appel([lire('this')], 'setNum', [[lire('this'), membre('num')]]), O.pop,
  etiquette('fin'), P(INDEFINI), O.retour,
]);

// ── setNum(num) : un clip par caractère, posés bout à bout ──
const CORPS_SETNUM = assembler([
  // this.num = num;
  lire('this'), P('num'), lire('num'), O.setMember,
  // this.createEmptyMovieClip("compteur", 1);   (on repart d'un compteur neuf)
  appel([lire('this')], 'createEmptyMovieClip', [P('compteur'), P(1)]), O.pop,
  // var n = String(num); var x = 0; var i = 0;
  P('n'), lire('num'), O.texte, O.defineLocal,
  P('x'), P(0), O.defineLocal,
  P('i'), P(0), O.defineLocal,

  etiquette('boucle'),
  lire('i'), lire('n'), membre('length'), O.inferieur, O.non, si('sortie'),

  // var c = n.substr(i, 1);
  P('c'), appel([lire('n')], 'substr', [lire('i'), P(1)]), O.defineLocal,
  // this.compteur.attachMovie(this.link, "n" + i, i);
  appel([lire('this'), membre('compteur')], 'attachMovie', [
    [lire('this'), membre('link')],
    [P('n'), lire('i'), O.plus],
    lire('i'),
  ]), O.pop,
  // var mc = this.compteur["n" + i];
  P('mc'), lire('this'), membre('compteur'), P('n'), lire('i'), O.plus, O.getMember,
  O.defineLocal,

  // var f = TABLE.indexOf(c) + 1;  if (f < 1) f = VIDE;
  P('f'), appel([P(TABLE)], 'indexOf', [lire('c')]), P(1), O.plus, O.defineLocal,
  lire('f'), P(1), O.inferieur, O.non, si('pose'),
  P('f'), P(VIDE), O.setVariable,

  etiquette('pose'),
  appel([lire('mc')], 'gotoAndStop', [lire('f')]), O.pop,
  // mc._x = x;  x += mc._width;
  lire('mc'), P('_x'), lire('x'), O.setMember,
  P('x'), lire('x'), lire('mc'), membre('_width'), O.plus, O.setVariable,
  // i++
  P('i'), lire('i'), P(1), O.plus, O.setVariable,
  saut('boucle'),

  etiquette('sortie'),
  // L'échelle d'abord : _width se lit APRÈS, déjà mis à l'échelle, et c'est
  // cette largeur-là qui sert au centrage.
  lire('this'), membre('compteur'), P('_xscale'), lire('this'), membre('scale'), O.setMember,
  lire('this'), membre('compteur'), P('_yscale'), lire('this'), membre('scale'), O.setMember,
  // this.compteur._x = (-this.compteur._width / 2) * this.align;
  lire('this'), membre('compteur'), P('_x'),
  P(0), lire('this'), membre('compteur'), membre('_width'), O.moins,
  P(2), O.divise,
  lire('this'), membre('align'), O.fois,
  O.setMember,
  P(INDEFINI), O.retour,
]);

// ── La classe, posée comme le compilateur la poserait ──
const ACTIONS = assembler([
  // if (_global.ext == undefined) _global.ext = new Object();
  lire('_global'), membre('ext'), P(INDEFINI), O.egal, O.non, si('paquet'),
  lire('_global'), P('ext'), P(0), P('Object'), O.nouvelObjet, O.setMember,
  etiquette('paquet'),
  // if (_global.ext.game == undefined) _global.ext.game = new Object();
  lire('_global'), membre('ext'), membre('game'), P(INDEFINI), O.egal, O.non, si('classe'),
  lire('_global'), membre('ext'), P('game'), P(0), P('Object'), O.nouvelObjet, O.setMember,
  etiquette('classe'),
  // Une seule fois : si la classe existe (un jour, une lib la fournira), on la
  // laisse tranquille.
  ...CLASSE, P(INDEFINI), O.egal, O.non, si('fin'),

  // ext.game.Numb = function () { this.init(); };
  lire('_global'), membre('ext'), membre('game'), P('Numb'),
  fonction([], CORPS_CTOR), O.setMember,
  // ext.game.Numb extends MovieClip;
  ...CLASSE, lire('MovieClip'), O.etend,

  ...PROTO, P('init'), fonction([], CORPS_INIT), O.setMember,
  ...PROTO, P('setNum'), fonction(['num'], CORPS_SETNUM), O.setMember,
  // Les méthodes ne doivent pas ressortir dans un for..in sur le clip.
  P(1), P(null), ...PROTO, P(3), P('ASSetPropFlags'), O.callFunction, O.pop,

  etiquette('fin'),
]);

// ── La pose ──

function poser() {
  const { sig, version, body } = G.lireSwf(SWF);
  if (body.indexOf(TABLE) >= 0) {
    console.log('· déjà posée (la table « ' + TABLE + ' » est là) — rien à faire.');
    return;
  }

  // Où : après la classe wheel.DayNight, la seule qui s'en serve aujourd'hui.
  // N'importe quel DoInitAction de la première image ferait l'affaire — le
  // cadran ne charge son décor qu'une fois le joueur connecté — mais la voisine
  // dit ce que la rustine sert.
  //
  // Et par qui : un sprite défini AVANT ce point et qui n'a pas déjà son propre
  // DoInitAction, Flash n'en retenant qu'un par sprite.
  let apres = -1;
  const spritesAvant = [];
  const initsPris = new Set();
  G.parcourir(body, (code, o, h, len) => {
    if (code === 39 && apres < 0) spritesAvant.push(body.readUInt16LE(o + h));
    if (code !== 59) return;
    initsPris.add(body.readUInt16LE(o + h));
    const corps = body.slice(o + h, o + h + len);
    if (corps.indexOf('DayNight') >= 0 && corps.indexOf('updateDayCoef') >= 0) {
      apres = o + h + len;
    }
  });
  if (apres < 0) throw new Error('classe wheel.DayNight introuvable');
  const porteur = spritesAvant.reverse().find((id) => !initsPris.has(id));
  if (porteur === undefined) throw new Error('aucun sprite libre pour porter le code');

  const tag = A.doInitAction(porteur, ACTIONS);
  const neuf = G.insererAvant(body, apres, tag);

  fs.copyFileSync(SWF, SAUVE);
  const taille = G.ecrireSwf(SWF, sig, version, neuf);
  console.log('· ext.game.Numb restituée (' + ACTIONS.length + ' octets de code, '
    + 'sprite porteur ' + porteur + ', après l\'offset ' + apres + ').');
  console.log('· sauvegarde : ' + path.basename(SAUVE));
  console.log('→ ' + SWF + ' (' + taille + ' octets)');
}

poser();
