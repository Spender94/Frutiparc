// Un petit ASSEMBLEUR ActionScript 2 — de quoi écrire un DoInitAction à la
// main sans passer par Flash.
//
// Les rustines de ce dépôt qui touchent au code du bureau se contentaient
// jusqu'ici d'une poignée d'octets poussés à la main
// (patch-main-statusmng-minipixiz.js, …). Dès qu'il faut une fonction, une
// condition ou un objet un peu construit, l'exercice devient illisible : d'où
// ce module, qui donne des noms aux opcodes et pose les sauts pour nous.
//
// Ce qu'il produit est le CORPS d'actions d'un tag — à envelopper dans un
// DoInitAction (code 59, précédé du SpriteID) ou un DoAction (code 12).
//
// Deux partis pris :
//
//   · Pas de ConstantPool. Chaque chaîne est poussée telle quelle (type 0).
//     C'est quelques octets de plus, mais le tag reste indépendant du reste du
//     fichier — donc greffable n'importe où sans renumérotation.
//   · DefineFunction « ancienne mode » (0x9b) plutôt que DefineFunction2
//     (0x8e) : pas de registres à préallouer, pas de drapeaux de préchargement.
//     `this` et les paramètres sont de simples variables, ce que l'AVM1 lit
//     sans broncher. On y perd en vitesse ce qu'on y gagne en relecture.
//
// Ordre des opérandes, tel que le compilateur d'origine les écrit — c'est la
// seule chose vraiment piégeuse de l'AVM1 :
//
//   objet.membre = valeur   →  push objet, push "membre", push valeur, setMember
//   objet.methode(a, b)     →  push b, push a, push 2, push objet,
//                              push "methode", callMethod
//                              (les arguments À L'ENVERS, le dernier d'abord)
//   var x = v               →  push "x", push v, defineLocal
//   { a: 1, b: 2 }          →  push "a", push 1, push "b", push 2, push 2,
//                              initObject
//
// Les tableaux, eux, se construisent par `new Array()` puis `push()` : l'ordre
// d'initArray se lit mal et se relit encore plus mal.
'use strict';

const ui16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };
const chaine = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);

// ── Les opcodes sans opérande ──
const OPS = {
  pop: 0x17, getVariable: 0x1c, setVariable: 0x1d, trace: 0x26,
  defineLocal: 0x3c, callFunction: 0x3d, retour: 0x3e,
  nouvelObjet: 0x40, initTableau: 0x42, initObjet: 0x43,
  plus: 0x47, moins: 0x0b, inferieur: 0x48, egal: 0x49,
  nombre: 0x4a, texte: 0x4b, doubler: 0x4c, echanger: 0x4d,
  getMember: 0x4e, setMember: 0x4f, callMethod: 0x52,
  identique: 0x66, non: 0x12, et: 0x10, ou: 0x11,
  typeDe: 0x44, supprimer: 0x3a,
};
for (const [nom, code] of Object.entries(OPS)) OPS[nom] = Buffer.from([code]);

const INDEFINI = Symbol('undefined');

/** Une action Push, avec autant de valeurs qu'on veut. */
function pousse(...valeurs) {
  const morceaux = valeurs.map((v) => {
    if (v === INDEFINI) return Buffer.from([3]);
    if (v === null) return Buffer.from([2]);
    if (typeof v === 'string') return Buffer.concat([Buffer.from([0]), chaine(v)]);
    if (typeof v === 'boolean') return Buffer.from([5, v ? 1 : 0]);
    if (typeof v === 'number' && Number.isInteger(v)) {
      const b = Buffer.alloc(5); b[0] = 7; b.writeInt32LE(v, 1); return b;
    }
    throw new Error('valeur non gérée par l\'assembleur : ' + String(v));
  });
  const corps = Buffer.concat(morceaux);
  return Buffer.concat([Buffer.from([0x96]), ui16(corps.length), corps]);
}

/** DefineFunction (0x9b) : le corps suit l'action, et sa taille est déclarée. */
function fonction(params, corps) {
  const entete = Buffer.concat([
    chaine(''),                                  // anonyme
    ui16(params.length),
    ...params.map(chaine),
    ui16(corps.length),
  ]);
  return Buffer.concat([Buffer.from([0x9b]), ui16(entete.length), entete, corps]);
}

// ── Sauts et étiquettes ──
//
// `if` et `jump` portent un décalage RELATIF à la fin de leur propre action ;
// les deux occupent 5 octets, ce qui permet de calculer les positions en une
// passe puis d'émettre en une seconde.
const etiquette = (nom) => ({ etiquette: nom });
const saut = (nom) => ({ saut: nom, code: 0x99 });
const si = (nom) => ({ saut: nom, code: 0x9d });     // branche si la pile dit vrai

function assembler(elements) {
  const plat = [];
  (function aplatir(l) {
    for (const e of l) { if (Array.isArray(e)) aplatir(e); else plat.push(e); }
  })(elements);

  // Passe 1 : la position de chaque élément, et de chaque étiquette.
  const pos = [];
  let o = 0;
  for (const e of plat) {
    pos.push(o);
    if (e && e.etiquette) continue;               // ne pèse rien
    o += (e && e.saut) ? 5 : e.length;
  }
  const cibles = {};
  plat.forEach((e, i) => { if (e && e.etiquette) cibles[e.etiquette] = pos[i]; });

  // Passe 2 : l'émission.
  const sortie = [];
  plat.forEach((e, i) => {
    if (e && e.etiquette) return;
    if (e && e.saut) {
      if (!(e.saut in cibles)) throw new Error('étiquette inconnue : ' + e.saut);
      const b = Buffer.alloc(5);
      b[0] = e.code; b.writeUInt16LE(2, 1);
      b.writeInt16LE(cibles[e.saut] - (pos[i] + 5), 3);
      sortie.push(b);
      return;
    }
    sortie.push(e);
  });
  return Buffer.concat(sortie);
}

/** L'en-tête d'un tag, forme longue systématique. */
function enteteTag(code, longueur) {
  const b = Buffer.alloc(6);
  b.writeUInt16LE((code << 6) | 0x3f, 0);
  b.writeUInt32LE(longueur, 2);
  return b;
}

/** Un DoInitAction complet, porté par le sprite donné. */
function doInitAction(spriteId, actions) {
  const corps = Buffer.concat([ui16(spriteId), actions, Buffer.from([0x00])]);
  return Buffer.concat([enteteTag(59, corps.length), corps]);
}

module.exports = {
  OPS, INDEFINI, pousse, fonction, assembler, etiquette, saut, si,
  enteteTag, doInitAction, ui16, chaine,
};
