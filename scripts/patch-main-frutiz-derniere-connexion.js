#!/usr/bin/env node
// legacy/main.swf : la DERNIÈRE CONNEXION sur la fiche, section « Bonus ».
//
//   node scripts/patch-main-frutiz-derniere-connexion.js
//
// Le mobile l'affiche déjà ; le bureau, non. Le serveur, lui, la sert depuis
// toujours à qui la demande — attribut `lc` de la réponse userinfo, au même
// format à points que `ft` (la date d'inscription). Il ne manquait que deux
// choses dans le SWF : la RETENIR, et la MONTRER.
//
// ── Ce que fait le SWF d'origine ──
//
// FrutizInfo.onUserInfo(node) range les attributs du nœud par rubrique. La
// rubrique « bonus » ne reçoit que deux champs :
//
//     this.bonus.comment = node.attributes.cm;
//     this.bonus.url     = node.attributes.su;
//
// et win.Frutiz.getPageObj("bonus") les rend à la main : un titre + le texte
// pour chacun, un trait de séparation s'il y a eu quelque chose, sinon le titre
// « aucune info ». Rien là-dedans n'est piloté par une table ; on ne peut donc
// pas se contenter d'ajouter une ligne quelque part.
//
// ── Ce que la rustine ajoute ──
//
// Un DoInitAction de plus, posé APRÈS les deux classes, qui les enveloppe :
//
//   1. FrutizInfo.onUserInfo garde `lc` à côté de `comment` et `url`.
//   2. win.Frutiz.getMenuLine — appelé tout en haut de getPageObj, et dont le
//      tableau OUVRE la liste des lignes — se voit ajouter, pour la seule page
//      « bonus », le titre « dernière connexion » et sa date. La ligne arrive
//      donc en TÊTE de la rubrique, comme sur mobile.
//   3. win.Frutiz.getPageObj retire ensuite le titre « aucune info », qui n'a
//      plus lieu d'être puisqu'il y a désormais une info. Il se trouve à
//      l'avant-dernière place (getEndLine n'ajoute qu'une ligne) ; on ne le
//      retire que si c'est bien lui, et que si l'on a une date à montrer.
//
// La date est mise en forme par le client, comme toutes les autres :
// Lang.formatDateString(lc, "sentence_year_short") → « sam 20 aoû 26 à 16:42 ».
// Le serveur n'envoie qu'une date brute, il ne choisit pas la langue.
//
// Envelopper plutôt que réécrire : le code d'origine n'est pas touché d'un
// octet, la rustine est idempotente (elle se reconnaît à ses variables
// `fpLcVieux*` sur _global) et s'annule en retirant un seul tag.
//
// Sauvegarde : legacy/main.swf.avant-derniere-connexion.

'use strict';

const fs = require('fs');
const path = require('path');
const G = require('./lib/swf-greffe.js');
const A = require('./lib/as2-asm.js');

const { OPS: O, INDEFINI, pousse: P, fonction, assembler, etiquette, si } = A;

const SWF = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const SAUVE = SWF + '.avant-derniere-connexion';
const MARQUE = 'fpLcVieuxUserInfo';                  // la trace de la rustine
const TITRE = 'dernière connexion';
const FORMAT = 'sentence_year_short';                // « $A $d $M $y à $H:$I »
const RIEN = 'aucune info';                          // le titre qu'on remplace

// Deux raccourcis qui portent tout le reste.
const lire = (nom) => [P(nom), O.getVariable];       // une variable
const membre = (nom) => [P(nom), O.getMember];       // .membre

// `objet.methode(args…)` — les arguments à l'envers, le dernier d'abord.
const appel = (objet, methode, args) => [
  ...args.slice().reverse(), P(args.length), objet, P(methode), O.callMethod,
];
// Le chemin d'une classe : _global.win.Frutiz.prototype, etc.
const proto = (...noms) => [lire('_global'), ...noms.map(membre), membre('prototype')];

// ── 1. FrutizInfo.onUserInfo : retenir `lc` ──
const CORPS_USERINFO = assembler([
  // _global.fpLcVieuxUserInfo.call(this, node);
  appel([lire('_global'), membre(MARQUE)], 'call', [lire('this'), lire('node')]),
  O.pop,
  // La rubrique n'existe pas quand le joueur est introuvable (k=201).
  // if (this.bonus == undefined) return;
  lire('this'), membre('bonus'), P(INDEFINI), O.egal, si('fin'),
  // this.bonus.lc = node.attributes.lc;
  lire('this'), membre('bonus'), P('lc'),
  lire('node'), membre('attributes'), membre('lc'),
  O.setMember,
  // Une sortie explicite : sauter pile sur la fin du corps se lit mal d'un
  // interpréteur à l'autre.
  etiquette('fin'), P(INDEFINI), O.retour,
]);

// La date, telle qu'elle s'affichera : Lang.formatDateString(d, format).
const DATE_MISE_EN_FORME = appel([lire('Lang')], 'formatDateString', [lire('d'), P(FORMAT)]);

// Un petit écarteur, comme celui qui encadre le commentaire.
const ECARTEUR = [P('type', 'spacer', 'width', 8, 2), O.initObjet];

// ── 2. win.Frutiz.getMenuLine : la ligne, en tête de la rubrique ──
const CORPS_MENU = assembler([
  // var r = _global.fpLcVieuxMenu.call(this, pos);
  P('r'), appel([lire('_global'), membre('fpLcVieuxMenu')], 'call', [lire('this'), lire('pos')]),
  O.defineLocal,
  // if (pos != "bonus") return r;
  lire('pos'), P('bonus'), O.egal, O.non, si('sortie'),
  // var d = this.box.frutizInfo.bonus.lc;
  P('d'), lire('this'), membre('box'), membre('frutizInfo'), membre('bonus'), membre('lc'),
  O.defineLocal,
  lire('d'), P(INDEFINI), O.egal, si('sortie'),
  lire('d'), P(''), O.egal, si('sortie'),

  // r.push(this.getTitleLine("dernière connexion"));
  appel([lire('r')], 'push', [appel([lire('this')], 'getTitleLine', [P(TITRE)])]),
  O.pop,

  // var L = new Array();  (plutôt qu'initArray, dont l'ordre se relit mal)
  P('L'), P(0), P('Array'), O.nouvelObjet, O.defineLocal,
  appel([lire('L')], 'push', [ECARTEUR]), O.pop,
  appel([lire('L')], 'push', [[
    P('type', 'text', 'big', 1, 'param'),
    P('text'), DATE_MISE_EN_FORME,
    P('textFormat'), P('align', 'center', 1), O.initObjet,
    P(2), O.initObjet,
    P(3), O.initObjet,
  ]]), O.pop,
  appel([lire('L')], 'push', [ECARTEUR]), O.pop,

  // r.push({ list: L });
  appel([lire('r')], 'push', [[P('list'), lire('L'), P(1), O.initObjet]]), O.pop,

  etiquette('sortie'),
  lire('r'), O.retour,
]);

// ── 3. win.Frutiz.getPageObj : « aucune info » n'a plus lieu d'être ──
const CORPS_PAGE = assembler([
  P('r'), appel([lire('_global'), membre('fpLcVieuxPage')], 'call', [lire('this'), lire('pos')]),
  O.defineLocal,
  lire('pos'), P('bonus'), O.egal, O.non, si('sortie'),
  P('d'), lire('this'), membre('box'), membre('frutizInfo'), membre('bonus'), membre('lc'),
  O.defineLocal,
  lire('d'), P(INDEFINI), O.egal, si('sortie'),
  lire('d'), P(''), O.egal, si('sortie'),

  // var L = r.lineList; var k = L.length - 2;   (getEndLine ne rend qu'une ligne)
  P('L'), lire('r'), membre('lineList'), O.defineLocal,
  P('k'), lire('L'), membre('length'), P(2), O.moins, O.defineLocal,

  // Un titre est fait de [écarteur, trait, texte, trait, écarteur] : le texte
  // est en 2. Sur une ligne de séparation, list[2] n'existe pas — l'AVM1 rend
  // undefined sans broncher, et la comparaison échoue d'elle-même.
  // if (L[k].list[2].param.text != "aucune info") return r;
  lire('L'), lire('k'), O.getMember, membre('list'), P(2), O.getMember,
  membre('param'), membre('text'),
  P(RIEN), O.egal, O.non, si('sortie'),

  appel([lire('L')], 'splice', [lire('k'), P(1)]), O.pop,

  etiquette('sortie'),
  lire('r'), O.retour,
]);

// ── Le tag ──
//
// Chaque enveloppe garde SON original sur _global : une variable de pellicule
// ne survivrait pas à la fin du DoInitAction.
function envelopper(chemin, methode, cle, corpsFonction, params) {
  return [
    // _global.<cle> = <chemin>.<methode>;
    lire('_global'), P(cle), ...proto(...chemin), membre(methode), O.setMember,
    // <chemin>.<methode> = function (…) { … };
    ...proto(...chemin), P(methode), fonction(params, corpsFonction), O.setMember,
  ];
}

const ACTIONS = assembler([
  envelopper(['FrutizInfo'], 'onUserInfo', MARQUE, CORPS_USERINFO, ['node']),
  envelopper(['win', 'Frutiz'], 'getMenuLine', 'fpLcVieuxMenu', CORPS_MENU, ['pos']),
  envelopper(['win', 'Frutiz'], 'getPageObj', 'fpLcVieuxPage', CORPS_PAGE, ['pos']),
]);

// ── La pose ──

function poser() {
  const { sig, version, body } = G.lireSwf(SWF);
  if (body.indexOf(MARQUE) >= 0) {
    console.log('· déjà posée (« ' + MARQUE +' » présent) — rien à faire.');
    return;
  }

  // Où : après la DERNIÈRE des deux classes enveloppées, pour qu'elles
  // existent quand notre code s'exécute. Et par qui : un sprite défini avant
  // ce point et qui n'a pas déjà son propre DoInitAction — Flash n'en retient
  // qu'un par sprite.
  let apres = -1, vues = 0;
  const spritesAvant = [];
  const initsPris = new Set();
  G.parcourir(body, (code, o, h, len) => {
    if (code === 39 && apres < 0) spritesAvant.push(body.readUInt16LE(o + h));
    if (code !== 59) return;
    initsPris.add(body.readUInt16LE(o + h));
    const corps = body.slice(o + h, o + h + len);
    // Les deux classes : celle qui range les infos, celle qui les dessine.
    if ((corps.indexOf('FrutizInfo') >= 0 && corps.indexOf('onUserInfo') >= 0)
      || (corps.indexOf('getMenuLine') >= 0 && corps.indexOf('getPageObj') >= 0)) {
      apres = o + h + len;
      vues++;
    }
  });
  if (vues !== 2) throw new Error('classes attendues : 2 trouvée(s) ' + vues);
  const porteur = spritesAvant.reverse().find((id) => !initsPris.has(id));
  if (porteur === undefined) throw new Error('aucun sprite libre pour porter le code');

  const tag = A.doInitAction(porteur, ACTIONS);
  const neuf = G.insererAvant(body, apres, tag);

  fs.copyFileSync(SWF, SAUVE);
  const taille = G.ecrireSwf(SWF, sig, version, neuf);
  console.log('· enveloppes posées (' + ACTIONS.length + ' octets de code, '
    + 'sprite porteur ' + porteur + ', après l\'offset ' + apres + ').');
  console.log('· sauvegarde : ' + path.basename(SAUVE));
  console.log('→ ' + SWF + ' (' + taille + ' octets)');
}

poser();
