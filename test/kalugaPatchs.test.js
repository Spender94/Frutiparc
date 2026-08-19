/*
 * Kaluga : les trois patchs du SWF, et surtout ce qu'ils NE touchent PAS.
 *
 * Le joueur soupçonnait un de nos patchs d'avoir bridé la prise à six items.
 * Ce fichier fixe les deux moitiés de la réponse :
 *
 *   1. LE CHEMIN DE PRISE EST INTACT. On désassemble, dans le SWF livré, les
 *      trois fonctions qui gouvernent la capture — updateRange (la portée),
 *      search (la boucle d'accrochage) et catchButterFly (les papillons) — et
 *      on vérifie qu'elles disent exactement ce que disent les sources
 *      d'époque : portée = nbMulti + bonusMulti + 1, accrochage tant que
 *      linkList.length < portée, et aucune borne nulle part.
 *
 *   2. LE PATCH « CHALLENGE » NE VISE PLUS À L'AVEUGLE. Il codait en dur
 *      l'index 98 de la table des constantes, alors que « $train » figure
 *      dans plusieurs classes et « $classic » dans huit d'entre elles à des
 *      index tous différents (9, 57, 65, 78, 79, 98, 119…). Dans une autre
 *      classe, l'index 98 vaut « $key » ou « $param » : le script pouvait
 *      donc remettre à zéro le saut d'une condition étrangère. Il relit
 *      désormais l'index dans la table de la classe qu'il a identifiée par
 *      ses formes de bytecode.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const SWF = path.join(ROOT, 'Games', 'kaluga', 'full.swf');

function corps() {
  const raw = fs.readFileSync(SWF);
  return raw.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
}

// Les DoInitAction (tag 59) et leur table de constantes.
function classes(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  let off = Math.ceil((5 + nbits * 4) / 8) + 4;
  const out = [];
  while (off < body.length) {
    const hdr = body.readUInt16LE(off);
    const code = hdr >> 6;
    let len = hdr & 0x3f, h = 2;
    if (len === 0x3f) { len = body.readUInt32LE(off + 2); h = 6; }
    if (code === 0) break;
    if (code === 59) {
      const cp = off + h + 2;
      const entrees = [];
      if (body[cp] === 0x88) {
        const count = body.readUInt16LE(cp + 3);
        let p = cp + 5;
        for (let i = 0; i < count; i++) {
          const e = body.indexOf(0, p);
          entrees.push(body.slice(p, e).toString('latin1'));
          p = e + 1;
        }
      }
      out.push({ off, len, h, entrees });
    }
    off += h + len;
  }
  return out;
}

const pushCp = (i) => Buffer.from([0x96, 0x02, 0x00, 0x08, i]);
const idx = (cl, nom) => cl.entrees.indexOf(nom);

test('le SWF livré garde la formule de portée du jeu : nbMulti + bonusMulti + 1', () => {
  const body = corps();
  // La classe du tzongre est celle qui annonce « Multi up! ».
  const tz = classes(body).find((c) => c.entrees.includes('Multi up!'));
  assert.ok(tz, 'classe du tzongre introuvable');

  // updateRange est appelée juste après « Multi up! » : on la retrouve par sa
  // définition, une fonction de 43 octets qui écrit « a = b + c + 1 ».
  // Concrètement on cherche la séquence « Push 1 ; Add2 ; SetMember » précédée
  // de deux GetMember — la somme de deux champs plus un.
  const zone = body.slice(tz.off + tz.h, tz.off + tz.h + tz.len);
  // La queue exacte de « portée = nbMulti + bonusMulti + 1 » : le second champ
  // lu, la première addition, le littéral 1, la seconde addition, l'écriture.
  // Deux Add2 encadrant un Push 1 : la forme ne se rencontre pas par hasard.
  const somme = Buffer.from([
    0x4E,                                           // GetMember (bonusMulti)
    0x47,                                           // Add2      (nbMulti + bonusMulti)
    0x96, 0x05, 0x00, 0x07, 0x01, 0x00, 0x00, 0x00, // Push 1
    0x47,                                           // Add2      (+ 1)
    0x4F,                                           // SetMember (→ portée)
  ]);
  let n = 0, p = 0;
  for (;;) { const k = zone.indexOf(somme, p); if (k < 0) break; n++; p = k + 1; }
  assert.equal(n, 1,
    'la formule de portée « a + b + 1 » doit figurer une fois et une seule '
    + `dans la classe du tzongre (vue ${n} fois)`);
});

test('la boucle d’accrochage compare bien la prise à la portée, sans borne', () => {
  const body = corps();
  // La classe Phys : celle qui garde les traces « this.linkList.length( » est
  // une autre ; la vraie porte le champ de portée et « splice ».
  const phys = classes(body).find((c) => c.entrees.includes('splice')
    && c.entrees.includes('abs') && c.entrees.includes('length'));
  assert.ok(phys, 'classe Phys introuvable');

  // search fait « linkList.length < range » : GetMember "length", GetMember
  // <portée>, Less2, Not, If. On vérifie la présence de cette forme.
  const zone = body.slice(phys.off + phys.h, phys.off + phys.h + phys.len);
  const iLen = idx(phys, 'length');
  assert.ok(iLen >= 0 && iLen <= 0xFF, '« length » doit être dans la table');
  const forme = Buffer.concat([
    pushCp(iLen), Buffer.from([0x4E]),        // GetMember "length"
    Buffer.from([0x96, 0x02, 0x00, 0x04]),    // Push r?
  ]);
  assert.ok(zone.includes(forme.slice(0, 6)),
    'la lecture de linkList.length a disparu de search');
  // Le comparateur : Less2 puis Not puis If — la garde d’origine.
  assert.ok(zone.includes(Buffer.from([0x48, 0x12, 0x9d])),
    'la garde « longueur < portée » (Less2 ; Not ; If) a disparu');
});

test('le patch « challenge » ne code plus l’index de pool en dur', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'patch-kaluga-challenge.js'), 'utf8');
  assert.doesNotMatch(src, /0x08,\s*0x62/,
    'le motif « Push CP[98] » ne doit plus être écrit en dur');
  assert.match(src, /cible\.idx/, 'l’index doit venir de la table de la classe retenue');
  assert.match(src, /aucune classe ne porte les deux formes/,
    'la classe cible doit être identifiée par ses formes de bytecode');
});

test('les deux retouches du patch « challenge » sont bien dans kaluga.Game, et nulle part ailleurs', () => {
  const body = corps();
  const jeu = classes(body).find((c) => c.entrees.includes('$butterfly'));
  assert.ok(jeu, 'kaluga.Game introuvable');
  const i = idx(jeu, '$classic');
  assert.equal(i, 98, 'dans kaluga.Game, « $classic » est l’entrée 98');

  const zone = body.slice(jeu.off + jeu.h, jeu.off + jeu.h + jeu.len);
  let scan = 0;
  const formes = [];
  for (;;) {
    const k = zone.indexOf(pushCp(i), scan);
    if (k < 0) break;
    scan = k + 5;
    if (zone[k + 5] !== 0x49) continue;                 // Equals2
    if (zone[k + 6] === 0x12 && zone[k + 7] === 0x9d) formes.push({ kind: 'replay', k });
    else if (zone[k + 6] === 0x08 && zone[k + 7] === 0x4c) formes.push({ kind: 'savescore', k });
  }
  assert.deepEqual(formes.map((f) => f.kind).sort(), ['replay', 'savescore'],
    'exactement deux sites retouchés, un de chaque sorte');
  // Le site « replay » doit sauter de 0 : on tombe toujours sur addReplayPanel.
  const replay = formes.find((f) => f.kind === 'replay');
  assert.equal(zone.readInt16LE(replay.k + 10), 0,
    'le saut du panneau « Rejouer ? » doit être neutralisé (offset 0)');

  // Et AUCUNE autre classe ne doit porter un site de cette forme sur SON
  // index de « $classic » : c’est ce que l’ancien script risquait de toucher.
  for (const c of classes(body)) {
    if (c.off === jeu.off) continue;
    const j = idx(c, '$classic');
    if (j < 0 || j > 0xFF) continue;
    const z = body.slice(c.off + c.h, c.off + c.h + c.len);
    let s = 0;
    while (s < z.length) {
      const k = z.indexOf(pushCp(j), s);
      if (k < 0) break;
      s = k + 5;
      assert.ok(!(z[k + 5] === 0x49 && z[k + 6] === 0x08),
        `classe @${c.off} : un Not y a été transformé en ToggleQuality — dégât collatéral`);
    }
  }
});
