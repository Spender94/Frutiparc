#!/usr/bin/env node
// Patche legacy/main.swf : le champ de saisie suit le curseur quand on tape.
//
// LE BUG (signalé sur les salons de discussion)
// --------------------------------------------
// Dans la barre de message, le texte tapé s'arrête au bord du champ : la
// suite se tape « à l'aveugle », et le curseur sort même de la fenêtre.
//
// LA CAUSE
// --------
// main.swf n'a qu'UN seul champ de saisie : l'EditText #169 (variable "text")
// du symbole `inputField` (sprite 170) — une seule ligne, sans retour à la
// ligne. Le Flash d'origine faisait défiler tout seul un champ mono-ligne pour
// garder le curseur visible ; Ruffle ne le fait pas. Le code du jeu ne touche
// jamais à `hscroll` — il n'avait aucune raison de le faire, Flash s'en
// chargeait. C'est donc un écart d'ÉMULATION, pas un bug du jeu : sur le Flash
// d'époque le champ défilait, chez nous non.
//
// LE CORRECTIF
// ------------
// Le client étend déjà `TextField.prototype` (frutiengine/TextField.class.as :
// onSetFocus, addToTextFormat, addProp, getLineHeight, getPos, setPos) dans la
// DoAction du sprite 653. On ajoute UNE méthode de plus, au même endroit et
// dans le même style :
//
//     TextField.prototype.onChanged = function(){
//         this.hscroll = this.maxhscroll;
//     };
//     ASSetPropFlags(TextField.prototype, "onChanged", 1);
//
// `onChanged` ne se déclenche QUE sur une saisie de l'utilisateur (jamais sur
// un texte posé par le code), donc les champs de log ne sont pas concernés.
// Et sur un champ multiligne à retour automatique, `maxhscroll` vaut 0 : la
// ligne devient `hscroll = 0`, sans effet. Seul le champ de saisie mono-ligne
// bouge — c'est exactement la cible.
//
// Le `ASSetPropFlags(..., 1)` cache la méthode des boucles `for..in`, comme le
// fait le code d'origine pour ses cinq autres méthodes : rien de nouveau ne
// remonte dans les énumérations du client.
//
// LA CHIRURGIE
// ------------
// L'insertion grossit le bytecode, donc trois longueurs sont recalculées :
//   • la DoAction    (tag 12, forme longue UI32) qui contient le code ;
//   • le DefineSprite 653 (tag 39, forme longue UI32) qui la contient ;
//   • la longueur de fichier de l'en-tête SWF.
// Le script est IDEMPOTENT : relancé, il détecte la marque et ne fait rien.
//
//   node scripts/patch-main-textfield-hscroll.js            → patche
//   node scripts/patch-main-textfield-hscroll.js --verify   → dit l'état

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CHEMIN = path.resolve(__dirname, '..', 'legacy', 'main.swf');

// ── Fabrique de bytecode AVM1 ────────────────────────────────────────────
// On pousse les chaînes EN CLAIR (type 0) plutôt que par le pool de
// constantes : le pool du bloc compte plus de 1400 entrées, et y toucher
// obligerait à décaler des index utilisés partout. Une chaîne littérale ne
// coûte que quelques octets et ne dérange rien.
const pushStr = (s) => {
  const b = Buffer.from(s, 'latin1');
  const out = Buffer.alloc(3 + 1 + b.length + 1);
  out[0] = 0x96;                       // Push
  out.writeUInt16LE(1 + b.length + 1, 1);
  out[3] = 0x00;                       // type 0 : chaîne terminée par zéro
  b.copy(out, 4);
  out[4 + b.length] = 0x00;
  return out;
};
const pushInt = (n) => {
  const out = Buffer.alloc(8);
  out[0] = 0x96;
  out.writeUInt16LE(5, 1);
  out[3] = 0x07;                       // type 7 : entier 32 bits
  out.writeInt32LE(n, 4);
  return out;
};
const OP = (c) => Buffer.from([c]);
const GET_VARIABLE = OP(0x1c);
const GET_MEMBER = OP(0x4e);
const SET_MEMBER = OP(0x4f);
const CALL_FUNCTION = OP(0x3d);
const POP = OP(0x17);

// Le corps de la fonction : this.hscroll = this.maxhscroll
// SetMember dépile (valeur, nom, objet) → on empile objet, nom, valeur.
const CORPS = Buffer.concat([
  pushStr('this'), GET_VARIABLE,        // objet
  pushStr('hscroll'),                   // nom
  pushStr('this'), GET_VARIABLE, pushStr('maxhscroll'), GET_MEMBER,  // valeur
  SET_MEMBER,
]);

// ActionDefineFunction (0x9B) : nom vide, zéro paramètre, puis le corps.
function defineFunction(corps) {
  const entete = Buffer.alloc(3 + 1 + 2 + 2);
  entete[0] = 0x9b;
  entete.writeUInt16LE(1 + 2 + 2, 1);   // nom("\0") + nbParams + tailleCorps
  entete[3] = 0x00;                     // nom vide
  entete.writeUInt16LE(0, 4);           // zéro paramètre
  entete.writeUInt16LE(corps.length, 6);
  return Buffer.concat([entete, corps]);
}

// TextField.prototype.onChanged = function(){ … }
const AFFECTATION = Buffer.concat([
  pushStr('TextField'), GET_VARIABLE,
  pushStr('prototype'), GET_MEMBER,
  pushStr('onChanged'),
  defineFunction(CORPS),
  SET_MEMBER,
]);

// ASSetPropFlags(TextField.prototype, "onChanged", 1) — arguments empilés à
// l'envers, puis leur nombre, puis le nom de la fonction (le motif exact du
// code d'origine juste au-dessus).
const MASQUAGE = Buffer.concat([
  pushInt(1),
  pushStr('onChanged'),
  pushStr('TextField'), GET_VARIABLE,
  pushStr('prototype'), GET_MEMBER,
  pushInt(3),
  pushStr('ASSetPropFlags'),
  CALL_FUNCTION,
  POP,
]);

const INSERTION = Buffer.concat([AFFECTATION, MASQUAGE]);

// La marque d'idempotence : la chaîne littérale "maxhscroll" n'existe nulle
// part ailleurs dans le SWF (le jeu ne s'en sert jamais).
const MARQUE = Buffer.from('maxhscroll\0', 'latin1');

// ── Lecture / écriture du SWF ────────────────────────────────────────────
function lire() {
  const brut = fs.readFileSync(CHEMIN);
  const sig = brut.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('signature inattendue : ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(brut.slice(8)) : Buffer.from(brut.slice(8));
  return { sig, version: brut[3], body };
}

function ecrire(sig, version, body) {
  const charge = sig === 'CWS' ? zlib.deflateSync(body) : body;
  const out = Buffer.alloc(8 + charge.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + body.length, 4);   // longueur DÉCOMPRESSÉE
  charge.copy(out, 8);
  fs.writeFileSync(CHEMIN, out);
  return out.length;
}

// Repère le DefineSprite 653, sa DoAction, et le point d'insertion : juste
// après le bloc onSetFocus (donc avant la définition de addToTextFormat).
function reperer(body) {
  const debut = Math.ceil((5 + ((body[0] >> 3) & 0x1f) * 4) / 8) + 4;
  let sprite = null;
  let action = null;
  (function scan(from, to, parent) {
    let o = from;
    while (o < to) {
      const hdr = body.readUInt16LE(o);
      const code = hdr >> 6;
      let len = hdr & 0x3f, hs = 2;
      if (len === 0x3f) { len = body.readUInt32LE(o + 2); hs = 6; }
      if (code === 0) break;
      const corps = o + hs;
      if (code === 39) {
        const id = body.readUInt16LE(corps);
        if (id === 653) sprite = { tag: o, hs, len, corps };
        scan(corps + 4, corps + len, id);
      }
      if (code === 12 && parent === 653 && !action) action = { tag: o, hs, len, corps };
      o = corps + len;
    }
  })(debut, body.length, 0);
  if (!sprite || !action) throw new Error('DefineSprite 653 ou sa DoAction introuvable');
  if (sprite.hs !== 6 || action.hs !== 6) {
    throw new Error('tags en forme courte : la réécriture de longueur supposerait une forme longue');
  }

  return { sprite, action };
}

// Le point d'insertion se repère par la SÉQUENCE D'INSTRUCTIONS qui ouvre la
// définition suivante (addToTextFormat) :
//
//     Push CP["TextField"] ; GetVariable ; Push CP["prototype"] ; GetMember
//     Push CP["addToTextFormat"] ; DefineFunction2 …
//
// Les noms vivent dans le pool de constantes du bloc (un seul gros
// ActionConstantPool en tête) et les Push n'en portent que l'index : chercher
// la chaîne dans les octets tomberait sur le pool, pas sur le code. On rejoue
// donc le flux action par action — seule façon de connaître les frontières,
// les Push étant de taille variable — et on s'arrête sur le motif.
function pointInsertion(body, action) {
  let pool = null;
  const actions = [];
  let o = action.corps;
  const fin = action.corps + action.len;

  // Un Push qui ne contient QU'UNE référence au pool rend la chaîne visée ;
  // sinon null (les Push composites ne nous intéressent pas ici).
  const constanteUnique = (off, taille) => {
    const charge = 3 + body.readUInt16LE(off + 1);
    if (charge !== taille) return null;
    const t = body[off + 3];
    let idx = null;
    if (t === 8 && taille === 3 + 2) idx = body[off + 4];
    else if (t === 9 && taille === 3 + 3) idx = body.readUInt16LE(off + 4);
    if (idx === null || !pool) return null;
    return pool[idx] === undefined ? null : pool[idx];
  };

  while (o < fin) {
    const code = body[o];
    if (code === 0) break;
    const taille = code >= 0x80 ? 3 + body.readUInt16LE(o + 1) : 1;
    if (code === 0x88) {                       // ActionConstantPool
      const n = body.readUInt16LE(o + 3);
      const cp = [];
      let p = o + 5;
      for (let i = 0; i < n; i++) {
        let e = p; while (body[e] !== 0) e++;
        cp.push(body.slice(p, e).toString('latin1'));
        p = e + 1;
      }
      pool = cp;
    }
    actions.push({ off: o, code, cst: code === 0x96 ? constanteUnique(o, taille) : null });
    o += taille;
  }

  for (let i = 0; i + 5 < actions.length; i++) {
    const a = actions;
    if (a[i].code === 0x96 && a[i].cst === 'TextField'
      && a[i + 1].code === 0x1c
      && a[i + 2].code === 0x96 && a[i + 2].cst === 'prototype'
      && a[i + 3].code === 0x4e
      && a[i + 4].code === 0x96 && a[i + 4].cst === 'addToTextFormat'
      && (a[i + 5].code === 0x8e || a[i + 5].code === 0x9b)) {
      return a[i].off;
    }
  }
  throw new Error('séquence TextField.prototype.addToTextFormat introuvable');
}

function principal() {
  const verifier = process.argv.includes('--verify');
  const { sig, version, body } = lire();

  if (body.indexOf(MARQUE) >= 0) {
    console.log('déjà patché (la marque "maxhscroll" est présente) — rien à faire');
    return;
  }
  if (verifier) {
    console.log('NON patché : le champ de saisie ne suivra pas le curseur');
    process.exitCode = 1;
    return;
  }

  const { sprite, action } = reperer(body);
  const insertion = pointInsertion(body, action);
  console.log('DefineSprite 653 @0x' + sprite.tag.toString(16)
    + ', DoAction @0x' + action.tag.toString(16)
    + ', insertion @0x' + insertion.toString(16)
    + ' (+' + INSERTION.length + ' octets)');

  const neuf = Buffer.concat([
    body.slice(0, insertion),
    INSERTION,
    body.slice(insertion),
  ]);

  // Les deux tags qui englobent l'insertion grandissent d'autant.
  neuf.writeUInt32LE(action.len + INSERTION.length, action.tag + 2);
  neuf.writeUInt32LE(sprite.len + INSERTION.length, sprite.tag + 2);

  const taille = ecrire(sig, version, neuf);
  console.log('→ legacy/main.swf réécrit (' + taille + ' octets, corps ' + neuf.length + ')');
}

if (require.main === module) principal();
module.exports = { INSERTION, MARQUE };
