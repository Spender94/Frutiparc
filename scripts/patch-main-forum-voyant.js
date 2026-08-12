#!/usr/bin/env node
// legacy/main.swf : ÉTEINDRE le voyant « forum » de l'écran digital quand on
// ouvre le forum.
//
//   node scripts/patch-main-forum-voyant.js
//
// ── Le problème ──
//
// L'écran digital du bureau range six voyants (0 aide, 1 FORUM, 2 messagerie,
// 3 historique, 4 évènements, 5 jeux). Chacun s'allume par `unSleep(id)` et
// s'éteint par `sleep(id)`. Dans les sources d'époque, les autres voyants ont
// bien leurs DEUX gestes :
//
//   · fichiers   — FPFileMng : unSleep(2) à l'arrivée d'un fichier, sleep(2)
//                  quand la fenêtre des fichiers s'affiche ;
//   · journaux   — MeMng : unSleep(3)/(4) à l'arrivée d'une ligne,
//                  sleep(3)/(4) dans onDisplayUserLog / onDisplaySiteLog.
//
// Le voyant FORUM, lui, n'a que l'allumage : `listener.main.onNewForumMsg` fait
// `unSleep(1)`, et RIEN, dans tout le binaire, n'appelle jamais `sleep(1)`. Le
// serveur d'époque n'envoyait pas la trame <ay>, personne ne s'en était donc
// aperçu ; depuis qu'on l'envoie, le voyant s'allume — et ne s'éteint plus
// jamais de la session.
//
// ── Le correctif ──
//
// On donne au forum le geste qui lui manque, au même endroit que les autres :
// à l'AFFICHAGE. `FPForumSlot.onActivate` est le moment où la fenêtre du forum
// prend le dessus (ouverture, ou retour dessus) — on y insère, en tête :
//
//     _global.me.digitalScreen.sleep(1);
//
// Écrit exactement comme la ligne voisine `_global.me.status.setInternal(...)`
// de la même fonction (même registre pour _global, même forme d'appel). Si
// l'écran n'est pas encore là, l'appel sur `undefined` ne fait rien — AVM1 ne
// s'en émeut pas, et le voyant s'éteindra à la prochaine ouverture.
//
// Le script est idempotent : il ne fait rien si la rustine est déjà posée.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const VOYANT_FORUM = 1;                    // l'index du forum sur l'écran digital

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('signature inconnue : ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version: raw[3], body };
}

function ecrireSwf(p, sig, version, body) {
  const charge = sig === 'CWS' ? zlib.deflateSync(body) : body;
  const out = Buffer.alloc(8 + charge.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + body.length, 4);
  charge.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}

// ── Repérage du bloc de classe ────────────────────────────────────────────
// Le DoInitAction qui contient le ConstantPool de FPForumSlot.
function trouverBloc(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  let o = Math.ceil((5 + nbits * 4) / 8) + 4;
  while (o < body.length - 1) {
    const hdr = body.readUInt16LE(o);
    const code = hdr >> 6;
    let len = hdr & 0x3f, h = 2;
    if (len === 0x3f) { len = body.readUInt32LE(o + 2); h = 6; }
    if (code === 0) break;
    if (code === 59) {
      const corps = o + h + 2;                         // DoInitAction : UI16 spriteID
      if (body[corps] === 0x88) {
        const cpLen = body.readUInt16LE(corps + 1);
        const cpCount = body.readUInt16LE(corps + 3);
        const pool = body.slice(corps + 5, corps + 3 + cpLen).toString('latin1').split('\0').slice(0, cpCount);
        if (pool.includes('FPForumSlot') && pool.includes('onActivate')) {
          return { tagOff: o, tagH: h, tagLen: len, cpOff: corps, cpLen, cpCount, pool };
        }
      }
    }
    o += h + len;
  }
  throw new Error('bloc FPForumSlot introuvable');
}

// ── L'insertion ───────────────────────────────────────────────────────────
// `_global.me.digitalScreen.sleep(1)` : arguments d'abord (à l'envers), puis
// leur nombre, puis l'objet, puis le nom de méthode — la forme qu'emploie le
// compilateur d'époque partout ailleurs dans ce même bloc.
function appelSleep(regGlobal, iMe, iEcran, iSleep) {
  const push1 = Buffer.from([
    0x96, 0x0e, 0x00,
    0x07, VOYANT_FORUM, 0x00, 0x00, 0x00,   // argument : 1
    0x07, 0x01, 0x00, 0x00, 0x00,           // nombre d'arguments : 1
    0x04, regGlobal,                        // _global (registre préchargé)
    0x08, iMe,                              // "me"
  ]);
  return Buffer.concat([
    push1,
    Buffer.from([0x4e]),                                     // GetMember  → _global.me
    Buffer.from([0x96, 0x02, 0x00, 0x08, iEcran]),           // "digitalScreen"
    Buffer.from([0x4e]),                                     // GetMember  → …digitalScreen
    Buffer.from([0x96, 0x02, 0x00, 0x08, iSleep]),           // "sleep"
    Buffer.from([0x52]),                                     // CallMethod
    Buffer.from([0x17]),                                     // Pop
  ]);
}

// Le registre qui porte `_global` dans onActivate : on le LIT dans la fonction
// elle-même (la ligne `_global.me.status.setInternal("forum")` l'utilise),
// plutôt que de parier sur l'ordre de préchargement.
function registreGlobal(body, corpsOff, corpsLen, iMe, iStatus) {
  const zone = body.slice(corpsOff, corpsOff + corpsLen);
  for (let i = 0; i + 12 < zone.length; i++) {
    // Push …, reg?, cp[me] ; GetMember ; Push cp[status]
    if (zone[i] === 0x04 && zone[i + 2] === 0x08 && zone[i + 3] === iMe
        && zone[i + 4] === 0x4e
        && zone[i + 5] === 0x96 && zone[i + 8] === 0x08 && zone[i + 9] === iStatus) {
      return zone[i + 1];
    }
  }
  return null;
}

function patch() {
  const { sig, version, body } = lireSwf(SWF);
  const bloc = trouverBloc(body);
  const pool = bloc.pool.slice();

  if (pool.includes('digitalScreen') && pool.includes('sleep')) {
    console.log('main.swf : le voyant forum s\'endort déjà à l\'ouverture — rien à faire.');
    return;
  }

  const iMe = pool.indexOf('me');
  const iStatus = pool.indexOf('status');
  const iOnActivate = pool.indexOf('onActivate');
  if (iMe < 0 || iStatus < 0 || iOnActivate < 0) throw new Error('pool inattendu (me/status/onActivate)');

  // La fonction onActivate : Push cp[onActivate] … puis DefineFunction2 (0x8e).
  const tagFin = bloc.tagOff + bloc.tagH + bloc.tagLen;
  let fOff = -1;
  for (let o = bloc.cpOff + 3 + bloc.cpLen; o < tagFin - 4; o++) {
    if (body[o] !== 0x8e) continue;                   // DefineFunction2
    // le Push juste avant doit nommer onActivate
    const avant = body.slice(Math.max(0, o - 12), o);
    if (avant.includes(Buffer.from([0x08, iOnActivate]))) { fOff = o; break; }
  }
  if (fOff < 0) throw new Error('DefineFunction2 onActivate introuvable');

  // En-tête DefineFunction2 : nom\0, NumParams UI16, RegCount UI8, Flags UI16,
  // params…, CodeSize UI16.
  let p = fOff + 3;                                    // saute 0x8e + longueur UI16
  const finNom = body.indexOf(0, p);
  p = finNom + 1;
  const nbParams = body.readUInt16LE(p); p += 2;
  p += 1;                                             // RegisterCount
  p += 2;                                             // Flags
  for (let i = 0; i < nbParams; i++) {
    p += 1;                                           // registre du paramètre
    p = body.indexOf(0, p) + 1;                       // nom du paramètre
  }
  const csOff = p;                                    // CodeSize
  const codeSize = body.readUInt16LE(csOff);
  const corpsOff = csOff + 2;

  const regGlobal = registreGlobal(body, corpsOff, codeSize, iMe, iStatus);
  if (regGlobal === null) throw new Error('registre de _global introuvable dans onActivate');

  const iEcran = pool.length;                          // "digitalScreen"
  const iSleep = pool.length + 1;                      // "sleep"
  if (iSleep > 255) throw new Error('pool trop grand pour un index sur un octet');
  const insert = appelSleep(regGlobal, iMe, iEcran, iSleep);

  // 1. le code, en tête du corps de onActivate (avant tout saut : les offsets
  //    relatifs des If/Jump de la fonction restent donc justes) ;
  let neuf = Buffer.concat([body.slice(0, corpsOff), insert, body.slice(corpsOff)]);
  neuf.writeUInt16LE(codeSize + insert.length, csOff);

  // 2. les deux chaînes, à la fin du ConstantPool.
  const ajout = Buffer.from('digitalScreen\0sleep\0', 'latin1');
  const cpFin = bloc.cpOff + 3 + bloc.cpLen;           // juste après le dernier \0
  neuf = Buffer.concat([neuf.slice(0, cpFin), ajout, neuf.slice(cpFin)]);
  neuf.writeUInt16LE(bloc.cpLen + ajout.length, bloc.cpOff + 1);
  neuf.writeUInt16LE(bloc.cpCount + 2, bloc.cpOff + 3);

  // 3. la longueur du tag (forme longue : UI32 après l'en-tête court).
  if (bloc.tagH !== 6) throw new Error('DoInitAction en forme courte — inattendu');
  neuf.writeUInt32LE(bloc.tagLen + insert.length + ajout.length, bloc.tagOff + 2);

  const taille = ecrireSwf(SWF, sig, version, neuf);
  console.log(`main.swf : _global.me.digitalScreen.sleep(${VOYANT_FORUM}) posé en tête de FPForumSlot.onActivate`);
  console.log(`  registre _global = reg${regGlobal}, pool ${bloc.cpCount} → ${bloc.cpCount + 2},`
    + ` code ${codeSize} → ${codeSize + insert.length} octets`);
  console.log(`  fichier réécrit : ${taille} octets (corps ${neuf.length}).`);
}

patch();
