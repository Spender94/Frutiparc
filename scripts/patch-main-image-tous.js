#!/usr/bin/env node
// Ouvre `/image` et `/img` À TOUT LE MONDE dans legacy/main.swf.
//
// ── Ce que faisait le portillon ──
//
// Le répartiteur de commandes envoie `/image` ET `/img` sur la MÊME branche
// (0x2a704 et 0x2a714 → 0x2aec8), et cette branche s'ouvre sur un test :
//
//   0x2aec8  Push reg3 ; Push "me" ; GetMember      → _global.me
//   0x2aed3  Push "flAnimator" ; GetMember          → me.flAnimator
//   0x2aed9  PushDuplicate ; Not
//   0x2aedb  If -> 0x2af36        ← pas animateur : on saute au refus
//   0x2aee0  Pop
//   0x2aee1  Jump -> 0x2af41      ← animateur : la commande s'exécute
//   …
//   0x2af36  If -> 0x2af41
//   0x2af3b  Push false ; Return  ← refusé, SANS UN MOT
//
// Un joueur ordinaire tapait donc `/img` et il ne se passait rien : la
// commande mourait dans le client, elle n'atteignait jamais le serveur. Le
// portillon du serveur, lui, est réglé à part (server.js, la trame t="i").
//
// ── Le correctif ──
//
// Une seule valeur change : la CIBLE du saut. `If -> 0x2af36` devient
// `If -> 0x2aee0`, c'est-à-dire le `Pop` juste après. Les deux chemins se
// rejoignent alors sur le même `Jump -> 0x2af41` — la commande s'exécute,
// que l'on soit animateur ou non — et la pile reste équilibrée dans les deux
// cas (le `If` a dépilé la copie, le `Pop` dépile l'originale).
//
// Deux octets réécrits, la longueur du fichier ne bouge pas, et rien d'autre
// n'est touché : `/testimg` et `/testimage` (0x2b094) gardent leur propre
// portillon, et les autres pouvoirs d'animateur aussi.
//
//   node scripts/patch-main-image-tous.js      → réécrit legacy/main.swf

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const IF_ADDR = 0x2aedb;        // le `If` du portillon
const IF_END = IF_ADDR + 5;     // 9d 02 00 <off16>
const CIBLE_AVANT = 0x2af36;    // le refus
const CIBLE_APRES = 0x2aee0;    // le `Pop` qui mène au chemin autorisé

function readSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('signature inconnue : ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version: raw[3], body };
}
function writeSwf(p, sig, version, body) {
  const payload = sig === 'CWS' ? zlib.deflateSync(body) : body;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + body.length, 4);
  payload.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}

const { sig, version, body } = readSwf(IN_PATH);
const out = Buffer.from(body);

// On vérifie qu'on est bien devant le portillon, et pas ailleurs : l'octet du
// `If`, et les deux `GetMember` de `me.flAnimator` qui le précèdent.
if (out[IF_ADDR] !== 0x9d || out[IF_ADDR + 1] !== 0x02 || out[IF_ADDR + 2] !== 0x00) {
  throw new Error('pas un ActionIf à 0x' + IF_ADDR.toString(16));
}
if (out[0x2aed9] !== 0x4c || out[0x2aeda] !== 0x12) {
  throw new Error('la signature « PushDuplicate ; Not » manque avant le If');
}
// Et que la branche est bien celle que le répartiteur donne à /image ET /img.
for (const [nom, adr] of [['/image', 0x2a704], ['/img', 0x2a714]]) {
  if (out[adr] !== 0x9d) throw new Error(nom + ' : pas un ActionIf à 0x' + adr.toString(16));
  const cible = adr + 5 + out.readInt16LE(adr + 3);
  if (cible !== 0x2aec8) {
    throw new Error(nom + ' mène à 0x' + cible.toString(16) + ', pas au portillon 0x2aec8');
  }
}

const offAvant = out.readInt16LE(IF_ADDR + 3);
const cible = IF_END + offAvant;
if (cible === CIBLE_APRES) {
  console.log('déjà ouvert — rien à faire.');
  process.exit(0);
}
if (cible !== CIBLE_AVANT) {
  throw new Error('cible inattendue 0x' + cible.toString(16)
    + ' (attendu 0x' + CIBLE_AVANT.toString(16) + ')');
}
out.writeInt16LE(CIBLE_APRES - IF_END, IF_ADDR + 3);
const taille = writeSwf(IN_PATH, sig, version, out);
console.log('/image et /img ouverts à tous : If@0x' + IF_ADDR.toString(16)
  + '  0x' + CIBLE_AVANT.toString(16) + ' → 0x' + CIBLE_APRES.toString(16)
  + ' (décalage ' + offAvant + ' → ' + (CIBLE_APRES - IF_END) + ')');
console.log('main.swf réécrit (' + taille + ' octets).');
