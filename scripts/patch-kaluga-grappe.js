#!/usr/bin/env node
// Apprend à Games/kaluga/full.swf à DIRE ses grappes, pour le record
// « Kaluga Freestyle » (le classement sans grappe) du Club.
//
// LE BESOIN
// Une grappe de taille k rapporte 2^min(11,k) × 10 points (classe des
// grappes : « r3 = Math.pow(2, Math.min(11, this.grappe)) * 10 », puis
// « jeu.score += r3 »). Réaliser une grosse grappe tient souvent de la
// chance, et certains joueurs revendiquent le « freestyle » — jouer sans.
// Pour les classer à part, le serveur doit savoir si une partie a encaissé
// une grappe au-dessus du seuil (2000 points → taille 8, l'Atomique-grappe
// à 2560). Or le jeu n'envoyait QUE le score et un objet {tz} qui,
// sérialisé par le socket, arrivait en « [object Object] » : inexploitable.
//
// LE CORRECTIF — deux retouches :
//
//   1. LA CLASSE DES GRAPPES (DoInitAction repérée par « Maestro-grappe ») :
//      au point de chute du saut « if (this.grappe > 1) » — l'endroit où
//      TOUTE fin de grappe passe, engrangée ou non, juste avant
//      « this.grappe = 0 » — on insère :
//
//          jeu.gOr = jeu.gOr | this.grappe
//
//      Le OU BINAIRE des tailles rencontrées : des tailles toutes < 8
//      gardent gOr < 8, et toute taille ≥ 8 allume le bit 3 — « gOr ≥ 8 »
//      dit donc exactement « une grappe d'au moins 2560 points est passée ».
//      BitOr convertit undefined en 0 : aucune initialisation à poser, et
//      chaque partie (nouvel objet jeu) repart de zéro. L'insertion se fait
//      PILE au point de chute du saut : son delta ne bouge pas, et les deux
//      chemins (engrangé ou non) traversent l'accumulateur.
//
//   2. kaluga.Game.saveScore (DoInitAction repérée par « sauvegarde du
//      score... ») : l'objet {tz} — qui ne survivait pas au socket — devient
//      la CHAÎNE « tz + ':' + (this.gOr | 0) », par exemple « 4:0 » (tzongre
//      4, pas de grappe) ou « 4:9 » (une Atomique et une Mono). Le serveur
//      (parseKalugaTzId / parseKalugaGrappe) lit les deux moitiés ; les
//      vieilles données restent comprises, et un SWF encore en cache chez un
//      joueur n'envoie pas de témoin : sa partie est simplement inclassable
//      en freestyle.
//
// LA MÉCANIQUE — contrairement aux patchs kaluga précédents, la TAILLE du
// code change : les entrées de pool nécessaires sont ajoutées en queue de
// table, puis, pour chaque site, TOUS les sauts (If/Jump) dont l'intervalle
// enjambe le site sont recalés et TOUTES les fonctions (DefineFunction /
// DefineFunction2) dont le corps contient le site voient leur codeSize
// grandir. Un saut qui ATTERRIT exactement sur le site atterrit sur le code
// injecté — c'est voulu (cf. 1). Les repères sont structurels (formes de
// bytecode) et les littéraux en clair (« Grappe maximum ») : rien ne dépend
// des noms obfusqués, relus depuis le code lui-même.
//
// Réversible d'une commande : git checkout Games/kaluga/full.swf
// (à ré-appliquer alors APRÈS patch-kaluga-challenge.js et
// patch-kaluga-endgame.js, comme eux.)
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'Games', 'kaluga', 'full.swf');
const REPERE_GRAPPE = 'Maestro-grappe ';
const REPERE_STAT = 'Grappe maximum';
const REPERE_GAME = 'sauvegarde du score...';
const NOM_TEMOIN = 'gOr';
const SEPARATEUR = ':';

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
  out.writeUInt8(version, 3);
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

// Itère les actions d'un bloc : { pc, op, next } — next = début de la suivante.
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

// Les valeurs d'un ActionPush (ce dont on a besoin : registres, nombres, pool).
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
// Le push d'UNE valeur de pool, et son index — sinon null.
function pushDePool(b, ins) {
  if (ins.op !== 0x96) return null;
  const v = valeursPush(b, ins.pc, ins.next);
  if (v.length !== 1 || (v[0].t !== 8 && v[0].t !== 9)) return null;
  return v[0].v;
}

// Encode un ActionPush ({reg:n} | {int:n} | {cp:n}).
function encoderPush(valeurs) {
  const morceaux = [];
  for (const v of valeurs) {
    if (v.reg !== undefined) morceaux.push(Buffer.from([0x04, v.reg]));
    else if (v.int !== undefined) {
      const m = Buffer.alloc(5); m[0] = 0x07; m.writeInt32LE(v.int, 1); morceaux.push(m);
    } else if (v.cp !== undefined) {
      if (v.cp < 256) morceaux.push(Buffer.from([0x08, v.cp]));
      else { const m = Buffer.alloc(3); m[0] = 0x09; m.writeUInt16LE(v.cp, 1); morceaux.push(m); }
    } else throw new Error('valeur de push inconnue');
  }
  const corps = Buffer.concat(morceaux);
  const tete = Buffer.alloc(3); tete[0] = 0x96; tete.writeUInt16LE(corps.length, 1);
  return Buffer.concat([tete, corps]);
}
const OP = { GetMember: 0x4E, SetMember: 0x4F, Add2: 0x47, BitOr: 0x61, Greater: 0x67, Not: 0x12, If: 0x9D, Jump: 0x99, InitObject: 0x43 };
const octet = (o) => Buffer.from([o]);

// Lit la table des constantes d'un DoInitAction (code 59).
function lirePool(b, tag) {
  const cpStart = tag.offset + tag.hdrSize + 2;          // 2 octets d'id de sprite
  if (b[cpStart] !== 0x88) throw new Error('ConstantPool attendue');
  const payloadLen = b.readUInt16LE(cpStart + 1);
  const count = b.readUInt16LE(cpStart + 3);
  const entrees = []; let pos = cpStart + 5;
  for (let i = 0; i < count; i++) {
    const e = b.indexOf(0, pos);
    entrees.push(b.slice(pos, e).toString('latin1'));
    pos = e + 1;
  }
  return { cpStart, payloadLen, count, entrees, actionsStart: cpStart + 3 + payloadLen };
}

/**
 * Applique à UN tag DoInitAction : des ajouts de pool + UNE retouche de code
 * (l'intervalle [de, a) remplacé par `nouveau` — une insertion pure a
 * de === a). Recale les sauts qui enjambent le site, les codeSize des
 * fonctions qui le contiennent, puis reconstruit le corps du SWF.
 */
function retoucher(body, tag, ajoutsPool, site) {
  const pool = lirePool(body, tag);
  const tagStart = tag.offset + tag.hdrSize;
  const tagEnd = tagStart + tag.length;
  const delta = site.nouveau.length - (site.a - site.de);

  // Où atterrit un octet x après la retouche. Un point PILE sur le début du
  // site y reste (un saut qui y atterrissait exécute le code injecté).
  const decale = (x, quoi) => {
    if (x <= site.de) return x;
    if (x >= site.a) return x + delta;
    throw new Error(quoi + ' pointe dans le site remplacé (0x' + x.toString(16) + ')');
  };

  // 1. Répertorier les réécritures ponctuelles.
  const patches = [];
  for (const ins of walk(body, pool.actionsStart, tagEnd)) {
    if (ins.op === OP.Jump || ins.op === OP.If) {
      const d = body.readInt16LE(ins.pc + 3);
      const nd = decale(ins.next + d, 'un saut') - decale(ins.next, 'une source de saut');
      if (nd !== d) {
        if (nd < -32768 || nd > 32767) throw new Error('delta de saut hors bornes');
        const buf = Buffer.alloc(2); buf.writeInt16LE(nd, 0);
        patches.push({ pos: ins.pc + 3, buf });
      }
    } else if (ins.op === 0x9B || ins.op === 0x8E) {     // DefineFunction(2)
      const taille = body.readUInt16LE(ins.next - 2);
      const nt = decale(ins.next + taille, 'une fin de fonction') - decale(ins.next, 'un début de fonction');
      if (nt !== taille) {
        const buf = Buffer.alloc(2); buf.writeUInt16LE(nt, 0);
        patches.push({ pos: ins.next - 2, buf });
      }
    }
  }

  // 2. Reconstruire le tag : pool rallongée puis actions retouchées.
  const ajout = Buffer.from(ajoutsPool.map((s) => s + '\0').join(''), 'latin1');
  const tetePool = Buffer.from(body.slice(tagStart, pool.actionsStart));
  tetePool.writeUInt16LE(pool.payloadLen + ajout.length, pool.cpStart - tagStart + 1);
  tetePool.writeUInt16LE(pool.count + ajoutsPool.length, pool.cpStart - tagStart + 3);

  const actions = Buffer.from(body.slice(pool.actionsStart, tagEnd));
  for (const p of patches) p.buf.copy(actions, p.pos - pool.actionsStart);
  const de = site.de - pool.actionsStart, a = site.a - pool.actionsStart;
  const corpsTag = Buffer.concat([tetePool, ajout, actions.slice(0, de), site.nouveau, actions.slice(a)]);

  const enTete = Buffer.alloc(6);
  enTete.writeUInt16LE((tag.code << 6) | 0x3f, 0);
  enTete.writeUInt32LE(corpsTag.length, 2);
  return Buffer.concat([body.slice(0, tag.offset), enTete, corpsTag, body.slice(tagEnd)]);
}

// ── Lecture ───────────────────────────────────────────────────────────────
const { sig, version, body } = readSwf(IN_PATH);
let buf = body;
const tagAvec = (b, repere) => findTags(b, rectBytes(b) + 4, b.length)
  .find((t) => t.code === 59 && t.hdrSize === 6 &&
    b.slice(t.offset + t.hdrSize, t.offset + t.hdrSize + t.length)
      .includes(Buffer.from(repere, 'latin1')));

// ═══ 1. La classe des grappes : l'accumulateur gOr ════════════════════════
{
  const tag = tagAvec(buf, REPERE_GRAPPE);
  if (!tag) throw new Error('classe des grappes introuvable');
  const pool = lirePool(buf, tag);
  if (pool.entrees.indexOf(NOM_TEMOIN) >= 0) {
    console.log('grappes : déjà corrigé (gOr présent) — rien à faire.');
  } else {
    const iGrappe = pool.entrees.indexOf('grappe');
    const iStat = pool.entrees.indexOf(REPERE_STAT);
    if (iGrappe < 0 || iStat < 0) throw new Error('constantes « grappe »/« Grappe maximum » introuvables');
    const tagEnd = tag.offset + tag.hdrSize + tag.length;

    // a. Le saut « if (this.grappe > 1) » — Push reg | Push cp(grappe) |
    //    GetMember | Push 1 | Greater | Not | If. Un seul candidat.
    let siteIf = null;
    const prev = [];
    for (const ins of walk(buf, pool.actionsStart, tagEnd)) {
      if (ins.op === OP.If && prev.length >= 6) {
        const [pThis, pCp, gm, pUn, gt, not] = prev.slice(-6);
        const okThis = pThis.op === 0x96 && valeursPush(buf, pThis.pc, pThis.next).length === 1
          && valeursPush(buf, pThis.pc, pThis.next)[0].reg;
        const okCp = pushDePool(buf, pCp) === iGrappe;
        const vUn = pUn.op === 0x96 ? valeursPush(buf, pUn.pc, pUn.next) : [];
        const okUn = vUn.length === 1 && Number(vUn[0].v) === 1;
        if (okThis && okCp && gm.op === OP.GetMember && okUn && gt.op === OP.Greater && not.op === OP.Not) {
          if (siteIf) throw new Error('deux sites « if (grappe > 1) » — patch ambigu');
          siteIf = {
            apres: ins.next,
            delta: buf.readInt16LE(ins.pc + 3),
            regThis: valeursPush(buf, pThis.pc, pThis.next)[0].v,
          };
        }
      }
      prev.push(ins);
      if (prev.length > 6) prev.shift();
    }
    if (!siteIf) throw new Error('site « if (this.grappe > 1) » introuvable');
    const cible = siteIf.apres + siteIf.delta;

    // b. Le membre « jeu » : sur la ligne de statistique, en clair —
    //    Push cp('Grappe maximum') | Push 2 | Push reg | Push cp(JEU) | …
    let iJeu = null;
    {
      const suite = [];
      for (const ins of walk(buf, siteIf.apres, cible)) suite.push(ins);
      for (let i = 0; i + 3 < suite.length; i++) {
        if (pushDePool(buf, suite[i]) !== iStat) continue;
        const vDeux = suite[i + 1].op === 0x96 ? valeursPush(buf, suite[i + 1].pc, suite[i + 1].next) : [];
        const vReg = suite[i + 2].op === 0x96 ? valeursPush(buf, suite[i + 2].pc, suite[i + 2].next) : [];
        const cp = pushDePool(buf, suite[i + 3]);
        if (vDeux.length === 1 && Number(vDeux[0].v) === 2
          && vReg.length === 1 && vReg[0].reg && cp !== null) { iJeu = cp; break; }
      }
    }
    if (iJeu === null) throw new Error('membre « jeu » introuvable sur la ligne « Grappe maximum »');

    // c. Le point de chute doit toucher à la grappe (sa remise à zéro).
    const chute = [];
    for (const ins of walk(buf, cible, Math.min(cible + 40, tagEnd))) chute.push(ins);
    if (!chute.some((ins) => ins.op === 0x96
      && valeursPush(buf, ins.pc, ins.next).some((v) => (v.t === 8 || v.t === 9) && v.v === iGrappe))) {
      throw new Error('le point de chute n\'est pas la remise à zéro de la grappe');
    }

    // d. jeu.gOr = jeu.gOr | this.grappe — inséré au point de chute.
    const iTemoin = pool.count;
    const R = siteIf.regThis;
    const injection = Buffer.concat([
      encoderPush([{ reg: R }, { cp: iJeu }]), octet(OP.GetMember),
      encoderPush([{ cp: iTemoin }]),
      encoderPush([{ reg: R }, { cp: iJeu }]), octet(OP.GetMember),
      encoderPush([{ cp: iTemoin }]), octet(OP.GetMember),
      encoderPush([{ reg: R }, { cp: iGrappe }]), octet(OP.GetMember),
      octet(OP.BitOr),
      octet(OP.SetMember),
    ]);
    console.log(`grappes : chute du If en 0x${cible.toString(16)}, jeu=cp[${iJeu}], +${injection.length} o`);
    buf = retoucher(buf, tag, [NOM_TEMOIN], { de: cible, a: cible, nouveau: injection });
  }
}

// ═══ 2. kaluga.Game.saveScore : la donnée devient « tz:gOr » ══════════════
{
  const tag = tagAvec(buf, REPERE_GAME);
  if (!tag) throw new Error('classe kaluga.Game introuvable');
  const pool = lirePool(buf, tag);
  if (pool.entrees.indexOf(NOM_TEMOIN) >= 0) {
    console.log('saveScore : déjà corrigé (gOr présent) — rien à faire.');
  } else {
    const tagEnd = tag.offset + tag.hdrSize + tag.length;
    // Le site : Push cp(clé) | Push reg | Push cp(a) | GetMember | Push cp(b)
    // | GetMember | Push 1 | InitObject — l'objet {clé: this.a.b} à un champ.
    let site = null;
    const prev = [];
    for (const ins of walk(buf, pool.actionsStart, tagEnd)) {
      if (ins.op === OP.InitObject && prev.length >= 7) {
        const [pCle, pThis, pA, gm1, pB, gm2, pUn] = prev.slice(-7);
        const vThis = pThis.op === 0x96 ? valeursPush(buf, pThis.pc, pThis.next) : [];
        const vUn = pUn.op === 0x96 ? valeursPush(buf, pUn.pc, pUn.next) : [];
        if (pushDePool(buf, pCle) !== null
          && vThis.length === 1 && vThis[0].reg
          && pushDePool(buf, pA) !== null && gm1.op === OP.GetMember
          && pushDePool(buf, pB) !== null && gm2.op === OP.GetMember
          && vUn.length === 1 && Number(vUn[0].v) === 1) {
          if (site) throw new Error('deux objets {clé: this.a.b} — patch ambigu');
          site = {
            de: pCle.pc, a: ins.next,
            regThis: vThis[0].v,
            iA: pushDePool(buf, pA), iB: pushDePool(buf, pB),
          };
        }
      }
      prev.push(ins);
      if (prev.length > 7) prev.shift();
    }
    if (!site) throw new Error('site de la donnée {tz} introuvable dans saveScore');

    const ajouts = [];
    let iSep = pool.entrees.indexOf(SEPARATEUR);
    if (iSep < 0) { iSep = pool.count + ajouts.length; ajouts.push(SEPARATEUR); }
    const iTemoin = pool.count + ajouts.length;
    ajouts.push(NOM_TEMOIN);
    const R = site.regThis;
    const nouveau = Buffer.concat([
      encoderPush([{ reg: R }, { cp: site.iA }]), octet(OP.GetMember),
      encoderPush([{ cp: site.iB }]), octet(OP.GetMember),     // this.a.b — le tzongre
      encoderPush([{ cp: iSep }]), octet(OP.Add2),             // tz + ':'
      encoderPush([{ reg: R }, { cp: iTemoin }]), octet(OP.GetMember),
      encoderPush([{ int: 0 }]), octet(OP.BitOr),              // this.gOr | 0
      octet(OP.Add2),                                          // « tz:g »
    ]);
    console.log(`saveScore : [0x${site.de.toString(16)}, 0x${site.a.toString(16)}) `
      + `(${site.a - site.de} o) → ${nouveau.length} o`);
    buf = retoucher(buf, tag, ajouts, { de: site.de, a: site.a, nouveau });
  }
}

// ── Vérification structurelle : les deux tags se re-parcourent en entier. ──
for (const repere of [REPERE_GRAPPE, REPERE_GAME]) {
  const tag = tagAvec(buf, repere);
  if (!tag) throw new Error('après patch : tag « ' + repere + ' » perdu');
  const pool = lirePool(buf, tag);
  if (pool.entrees.indexOf(NOM_TEMOIN) < 0) throw new Error('après patch : gOr absent de « ' + repere + ' »');
  const tagEnd = tag.offset + tag.hdrSize + tag.length;
  let n = 0, dernier = pool.actionsStart;
  for (const ins of walk(buf, pool.actionsStart, tagEnd)) {
    n++;
    dernier = ins.next;
    if (ins.op === 0x9B || ins.op === 0x8E) {
      const taille = buf.readUInt16LE(ins.next - 2);
      if (ins.next + taille > tagEnd) throw new Error('après patch : une fonction déborde (« ' + repere + ' »)');
    }
    if (ins.op === OP.Jump || ins.op === OP.If) {
      const t = ins.next + buf.readInt16LE(ins.pc + 3);
      if (t < pool.actionsStart || t > tagEnd) throw new Error('après patch : un saut sort du tag (« ' + repere + ' »)');
    }
  }
  if (tagEnd - dernier > 1) throw new Error('après patch : la fin du tag « ' + repere + ' » ne se parcourt pas');
  console.log(`vérification « ${repere} » : ${n} actions, sauts et tailles cohérents`);
}

if (buf === body) {
  console.log('Rien à écrire.');
} else {
  const outSize = writeSwf(IN_PATH, sig, version, buf);
  console.log(`Écrit ${IN_PATH} (${outSize} o compressés, version ${version} inchangée)`);
}
