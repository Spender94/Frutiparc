#!/usr/bin/env node
// Ouvre `/log`, `/logs` et `/histo` À TOUT LE MONDE dans legacy/main.swf.
//
// ── Ce qu'étaient les commandes ──
//
// Le répartiteur de commandes du salon (`analyseInput`, 0x2a48a) mène les
// trois mots sur la même branche, 0x2c126 :
//
//   if (!(this.mng.me.flMode || this.mng.me.flAnimator)) return false;
//   getURL("javascript:fp_openHisto('" + sid + "','" + this.group + "')");
//
// `flMode`/`flAnimator`, c'est le staff : un joueur ordinaire qui tapait
// /logs voyait sa ligne rester dans la saisie, et rien ne s'ouvrait. Or les
// logs d'un salon sont à tous les Frutiz (server.js, /api/chat/histo — la
// page juge elle-même des droits) ; le light et le bureau les ouvrent à tous.
//
// ── Le correctif ──
//
// Les trois sauts du répartiteur visent directement l'ouverture, 0x2c15e,
// par-dessus la garde. Trois décalages de deux octets réécrits, la longueur
// du fichier ne bouge pas :
//
//   0x2a8d4  If -> 0x2c126   (/log)     devient   If -> 0x2c15e
//   0x2a8e4  If -> 0x2c126   (/logs)    devient   If -> 0x2c15e
//   0x2a8f4  If -> 0x2c126   (/histo)   devient   If -> 0x2c15e
//
// La pile est vide aux deux adresses (0x2c126 ne fait que lire `me`, 0x2c15e
// repart d'un Push) : sauter l'une pour l'autre n'y laisse rien.
// /chatlog et /chatlogs, que le SWF ne connaît pas, partent au serveur
// (patch-main-anim-commands), qui répond par le même lien.
//
//   node scripts/patch-main-logs-tous.js      → réécrit legacy/main.swf

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const GARDE = 0x2c126;        // la vérification flMode / flAnimator
const OUVRIR = 0x2c15e;       // getURL("javascript:fp_openHisto(…)")
const SAUTS = [[0x2a8d4, '/log'], [0x2a8e4, '/logs'], [0x2a8f4, '/histo']];

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

// L'ouverture est bien là où on l'attend : Push "javascript:fp_openHisto('".
const ouvre = out.subarray(OUVRIR, OUVRIR + 40).toString('latin1');
if (out[OUVRIR] !== 0x96) throw new Error('pas un ActionPush à 0x' + OUVRIR.toString(16) + ' : ' + ouvre);

let faits = 0, deja = 0;
for (const [adr, mot] of SAUTS) {
  if (out[adr] !== 0x9d || out[adr + 1] !== 0x02 || out[adr + 2] !== 0x00) {
    throw new Error(mot + ' : pas un ActionIf à 0x' + adr.toString(16));
  }
  const cible = adr + 5 + out.readInt16LE(adr + 3);
  if (cible === OUVRIR) { deja++; continue; }
  if (cible !== GARDE) {
    throw new Error(mot + ' mène à 0x' + cible.toString(16) + ', pas à la garde 0x' + GARDE.toString(16));
  }
  out.writeInt16LE(OUVRIR - (adr + 5), adr + 3);
  faits++;
  console.log(mot + ' : If @0x' + adr.toString(16) + ' → 0x' + OUVRIR.toString(16));
}
if (!faits) {
  console.log('déjà ouvert à tous — rien à faire.');
  process.exit(0);
}
const taille = writeSwf(IN_PATH, sig, version, out);
console.log('/log, /logs, /histo ouverts à tous (' + faits + ' saut(s), ' + deja + ' déjà fait(s)).');
console.log('main.swf réécrit (' + taille + ' octets).');
