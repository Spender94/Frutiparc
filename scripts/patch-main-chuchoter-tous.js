#!/usr/bin/env node
// Ouvre `/! pseudo message` À TOUT LE MONDE dans legacy/main.swf.
//
// ── Ce qu'était la commande ──
//
// `/!` est d'époque : le répartiteur de commandes du salon (0x2a7ee) l'envoie
// sur sa branche 0x2bb3a, qui fait exactement ce qu'on attend d'un message
// « pour une seule personne » :
//
//   if (cmode == "channel" && this.flMode && args[1].length) {
//     var texte = saisie.substr(args[1].length + 1);
//     var u = this.userList.getRealUserName(args[1]);
//     mainCnx.cmd("senduserongroup", { g: this.group, u: u, t: "w" },
//                 new XML().createTextNode(FEString.unHTML(texte)));
//     this.addText(Lang.fv("chat.cmd.warn_send_to_user.sended", { u: u, m: texte }));
//   }
//
// soit la trame `<bk g="salon" u="pseudo" t="w">texte</bk>` vers le serveur,
// et chez soi la ligne « Envoyé à pseudo : texte ». Mais `this.flMode`, c'est
// le drapeau de modération DU salon (le `m="1"` de sa propre entrée dans la
// liste des présents) : la commande était un avertissement de modérateur, et
// un joueur ordinaire qui la tapait ne voyait rien partir.
//
// ── Le correctif ──
//
// Le parc l'ouvre à tous (server.js, `chuchoter`, garde les bornes : présent
// dans le même salon, liste noire, silence, cadence). On remplace la lecture
// de `this.flMode` par la constante `true`, à longueur égale :
//
//   0x2bb53  Push r1 ; Push "flMode" ; GetMember     (96 02 00 04 01  96 02 00 08 8f  4e)
//   devient  Push true ; Push true ; Pop              (96 02 00 05 01  96 02 00 05 01  17)
//
// Onze octets réécrits, la longueur du fichier ne bouge pas. Les deux autres
// conditions restent : un salon (pas une discussion privée) et un pseudo.
//
//   node scripts/patch-main-chuchoter-tous.js      → réécrit legacy/main.swf

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const ADR = 0x2bb53;
const AVANT = Buffer.from([0x96, 0x02, 0x00, 0x04, 0x01, 0x96, 0x02, 0x00, 0x08, 0x8f, 0x4e]);
const APRES = Buffer.from([0x96, 0x02, 0x00, 0x05, 0x01, 0x96, 0x02, 0x00, 0x05, 0x01, 0x17]);

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

// Le répartiteur mène bien `/!` à la branche 0x2bb3a (If à 0x2a7f4).
if (out[0x2a7f4] !== 0x9d) throw new Error('/! : pas un ActionIf à 0x2a7f4');
const cibleBranche = 0x2a7f4 + 5 + out.readInt16LE(0x2a7f4 + 3);
if (cibleBranche !== 0x2bb3a) {
  throw new Error('/! mène à 0x' + cibleBranche.toString(16) + ', pas à la branche 0x2bb3a');
}

const ici = out.subarray(ADR, ADR + AVANT.length);
if (ici.equals(APRES)) {
  console.log('déjà ouvert — rien à faire.');
  process.exit(0);
}
if (!ici.equals(AVANT)) {
  throw new Error('octets inattendus à 0x' + ADR.toString(16) + ' : ' + ici.toString('hex'));
}
APRES.copy(out, ADR);
const taille = writeSwf(IN_PATH, sig, version, out);
console.log('/! ouvert à tous : this.flMode → true @0x' + ADR.toString(16));
console.log('main.swf réécrit (' + taille + ' octets).');
