#!/usr/bin/env node
// Corrige, dans Games/kaluga/full.swf, la fin de partie « réussie » de Kaluga.
//
// LE DÉFAUT (d'origine, hérité de Motion-Twin)
// Quand on mène une partie à son terme — panier plein, donc plus de fruits qui
// tombent, puis plus un seul fruit à l'écran — kaluga.game.Classic.checkFruit()
// déclenche la fin de partie ainsi :
//
//     function checkFruit(){
//         if( this.fruitList.length == 0 ){
//             this.initEndGame(120)          // ← appel DIRECT
//         }
//     }
//
// Or le garde de fin de partie n'est pas dans initEndGame() mais dans endGame() :
//
//     function endGame(timer){
//         if(!this.flEndingGame){ this.initEndGame(timer); }
//     }
//
// checkFruit() court-circuite donc le garde. Et comme il est appelé depuis la
// boucle de jeu (Classic.update, cas step==2, qui continue de tourner), la fin
// de partie est REJOUÉE À CHAQUE IMAGE, indéfiniment :
//   • saveScore() est ré-émis à chaque image — côté serveur, chaque envoi était
//     une partie, si bien que terminer une partie vidait le quota de challenge
//     du jour et noyait l'historique du joueur de notifications identiques ;
//   • initEndGame() remet endTimer à 120 à chaque image, donc le décompte qui
//     déclenche le panneau de fin n'arrive jamais à zéro : le panneau ne
//     s'affiche pas et la partie ne se termine jamais vraiment.
// Le chemin « mort du personnage » (loose(), onTzDeath()) passe, lui, par
// endGame() : il était correct, d'où un défaut visible seulement en cas de
// réussite.
//
// LE CORRECTIF
// checkFruit() appelle désormais endGame(120) au lieu de initEndGame(120) — soit
// exactement ce que fait déjà le chemin « mort ». endGame() délègue à
// initEndGame(), donc la surcharge Classic.initEndGame() reste appelée : même
// comportement, mais une seule fois.
//
// Il se trouve que kaluga.Game.endGame n'est PAS obfusqué (vérifié dans le
// bytecode : « prototype.endGame = function(timer) »), alors que initEndGame l'est
// (« =yxqR »). Le correctif se réduit donc à :
//   1. ajouter « endGame » à la table des constantes de la classe Classic (+8 o) ;
//   2. réécrire UN octet — l'index de constante poussé juste avant le CallMethod
//      de checkFruit.
// L'index tient sur un octet dans les deux cas, donc le code ne change pas de
// taille : aucun saut relatif n'est touché, aucun codeSize n'a à bouger. Seuls
// la table des constantes et la longueur du tag grandissent, et le bloc de code
// se décale uniformément — ce qui est sans effet, les constantes étant référencées
// par index et les sauts étant relatifs.
//
// Réversible d'une commande : git checkout Games/kaluga/full.swf
// (à ré-appliquer alors APRÈS scripts/patch-kaluga-challenge.js).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'Games', 'kaluga', 'full.swf');
// Littéral en clair propre à kaluga.game.Classic (une statistique de fin de partie).
const REPERE_CLASSIC = 'Nombre de grenouille';
const NOM_GARDE = 'endGame';   // kaluga.Game.endGame, non obfusqué
const DUREE_FIN = 120;         // l'argument de checkFruit : this.initEndGame(120)

function readSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Signature inconnue: ' + sig);
  return { sig, version: raw[3], body: sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8)) };
}
function writeSwf(p, sig, version, newBody) {
  const payload = sig === 'CWS' ? zlib.deflateSync(newBody, { level: 9 }) : newBody;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);                    // inchangée
  out.writeUInt32LE(8 + newBody.length, 4);
  payload.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}
const rectBytes = (b) => Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8);
function findTags(b, from, to, out = []) {
  let off = from;
  while (off < to) {
    const hdr = b.readUInt16LE(off), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = b.readUInt32LE(off + 2); hs = 6; }
    if (code === 0) break;
    out.push({ code, offset: off, hdrSize: hs, length: len });
    if (code === 39) findTags(b, off + hs + 4, off + hs + len, out);
    off += hs + len;
  }
  return out;
}
function* walk(b, start, end) {
  let pc = start;
  while (pc < end) {
    const op = b[pc];
    if (op === 0) { pc += 1; continue; }
    const next = op >= 0x80 ? pc + 3 + b.readUInt16LE(pc + 1) : pc + 1;
    if (next <= pc || next > end) return;
    yield { pc, op, next };
    pc = next;
  }
}
// Décode les valeurs d'un ActionPush (uniquement ce dont on a besoin ici).
function valeursPush(b, pc, next) {
  const out = []; let i = pc + 3;
  while (i < next) {
    const t = b[i];
    if (t === 0) { const e = b.indexOf(0, i + 1); out.push({ t, v: b.slice(i + 1, e).toString('latin1') }); i = e + 1; }
    else if (t === 1) { out.push({ t, v: b.readFloatLE(i + 1) }); i += 5; }
    else if (t === 4) { out.push({ t, v: b[i + 1], reg: true }); i += 2; }
    else if (t === 5) { out.push({ t, v: !!b[i + 1] }); i += 2; }
    else if (t === 6) { out.push({ t, v: b.readDoubleLE(i + 1) }); i += 9; }
    else if (t === 7) { out.push({ t, v: b.readInt32LE(i + 1) }); i += 5; }
    else if (t === 8) { out.push({ t, v: b[i + 1], pos: i + 1 }); i += 2; }
    else if (t === 9) { out.push({ t, v: b.readUInt16LE(i + 1), pos: i + 1 }); i += 3; }
    else if (t === 2 || t === 3) { out.push({ t, v: null }); i += 1; }
    else return out;
  }
  return out;
}

const { sig, version, body } = readSwf(IN_PATH);
let buf = Buffer.from(body);

const tag = findTags(buf, rectBytes(buf) + 4, buf.length).find((t) =>
  (t.code === 59 || t.code === 12) &&
  buf.slice(t.offset + t.hdrSize, t.offset + t.hdrSize + t.length).includes(Buffer.from(REPERE_CLASSIC, 'latin1')));
if (!tag) throw new Error('classe kaluga.game.Classic introuvable');
if (tag.hdrSize !== 6) throw new Error('tag court inattendu');

const saut = tag.code === 12 ? 0 : 2;
const cpStart = tag.offset + tag.hdrSize + saut;
if (buf[cpStart] !== 0x88) throw new Error('ConstantPool attendue');
let payloadLen = buf.readUInt16LE(cpStart + 1), count = buf.readUInt16LE(cpStart + 3);
const cp = []; let pos = cpStart + 5;
for (let i = 0; i < count; i++) { const e = buf.indexOf(0, pos); cp.push(buf.slice(pos, e).toString('latin1')); pos = e + 1; }
console.log(`Classe Classic à ${tag.offset} (pool ${count} entrées)`);

// 1. « endGame » dans la table des constantes.
let iGarde = cp.indexOf(NOM_GARDE);
let delta = 0;
if (iGarde < 0) {
  const dataEnd = cpStart + 3 + payloadLen;
  const ajout = Buffer.from(NOM_GARDE + '\0', 'latin1');
  buf = Buffer.concat([buf.slice(0, dataEnd), ajout, buf.slice(dataEnd)]);
  iGarde = count;
  buf.writeUInt16LE(payloadLen + ajout.length, cpStart + 1);
  buf.writeUInt16LE(count + 1, cpStart + 3);
  buf.writeUInt32LE(tag.length + ajout.length, tag.offset + 2);
  delta = ajout.length;
  payloadLen += ajout.length;
  console.log(`  pool : + ${JSON.stringify(NOM_GARDE)} en position ${iGarde} (+${delta} o)`);
} else {
  console.log(`  pool : ${JSON.stringify(NOM_GARDE)} déjà présent en position ${iGarde}`);
}
if (iGarde > 255) throw new Error('index de constante trop grand : la réécriture changerait de taille');

// 2. Le site : Push 120 | Push 1 | Push r? | Push cp(x) | CallMethod, dans une
//    fonction qui teste « .length == 0 ». On exige UN seul candidat.
const actionsStart = cpStart + 3 + payloadLen;
const tagEnd = tag.offset + tag.hdrSize + tag.length + delta;
const seq = [];
const candidats = [];
for (const ins of walk(buf, actionsStart, tagEnd)) {
  seq.push(ins);
  const n = seq.length;
  if (n < 5 || ins.op !== 0x52) continue;                       // CallMethod
  const [a, b1, c, d] = [seq[n - 5], seq[n - 4], seq[n - 3], seq[n - 2]];
  if (a.op !== 0x96 || b1.op !== 0x96 || c.op !== 0x96 || d.op !== 0x96) continue;
  const va = valeursPush(buf, a.pc, a.next);
  const vb = valeursPush(buf, b1.pc, b1.next);
  const vc = valeursPush(buf, c.pc, c.next);
  const vd = valeursPush(buf, d.pc, d.next);
  if (va.length !== 1 || Number(va[0].v) !== DUREE_FIN) continue;   // l'argument 120
  if (vb.length !== 1 || Number(vb[0].v) !== 1) continue;           // un seul argument
  if (vc.length !== 1 || !vc[0].reg) continue;                      // l'objet (this)
  if (vd.length !== 1 || (vd[0].t !== 8 && vd[0].t !== 9)) continue; // le nom de méthode
  candidats.push({ pc: d.pc, valeur: vd[0] });
}
if (candidats.length !== 1)
  throw new Error(`site « checkFruit » : ${candidats.length} candidat(s) au lieu d'un seul`);
const site = candidats[0];
const nomActuel = cp[site.valeur.v] !== undefined ? cp[site.valeur.v] : (site.valeur.v === iGarde ? NOM_GARDE : '?');
console.log(`  site trouvé en ${site.pc} : appel de ${JSON.stringify(nomActuel)}(${DUREE_FIN})`);

if (site.valeur.v === iGarde) {
  console.log('Déjà corrigé — rien à écrire.');
  process.exit(0);
}
if (site.valeur.t !== 8) throw new Error('constante sur 2 octets : la réécriture changerait de taille');
buf.writeUInt8(iGarde, site.valeur.pos);
console.log(`  → appelle désormais ${JSON.stringify(NOM_GARDE)}(${DUREE_FIN}), qui porte le garde flEndingGame`);

const outSize = writeSwf(IN_PATH, sig, version, buf);
console.log(`Écrit ${IN_PATH} (${outSize} o compressés, version ${version} inchangée)`);
