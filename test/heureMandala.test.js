/*
 * L'HEURE DE LA FRUTIMANDALA.
 *
 * Le cadran du bureau tient deux disques (cp.WheelMng), et celui du jour et de
 * la nuit — wheel.DayNight — affiche l'heure au milieu. Le code est là depuis
 * toujours et il est intact :
 *
 *   wheelInit()     → skin.mc.display.attachMovie("extGameNumb", "hour", 1,
 *                         { link: "police", num: "21:37", scale: 85, _y: 52 });
 *   updateDayCoef() → skin.mc.display.hour.setNum(hh + ":" + mm);   (chaque minute)
 *
 * Ce qui manquait, c'est la CLASSE derrière le symbole. `extGameNumb` est un
 * sprite VIDE de /wheel/wheel0.swf ; wheel0.swf lui accroche lui-même
 * `Object.registerClass("extGameNumb", ext.game.Numb)`, mais `ext.game.Numb`
 * appartient à la bibliothèque de jeu partagée de Motion-Twin, que cette
 * version de main.swf n'embarque pas. La liaison se faisait donc sur
 * `undefined` : clip vide, `setNum` inexistante, appel perdu dans le silence
 * de l'AVM1. Les chiffres, eux, n'ont jamais bougé — ils dorment dans le
 * symbole `police` de wheel0.swf.
 *
 * scripts/patch-main-heure-mandala.js restitue la classe. Ce fichier tient les
 * deux bouts du contrat : ce que wheel0.swf attend, et ce que main.swf fournit
 * désormais. Le rendu, lui, a été regardé sous Ruffle — « 16:42 » en chiffres
 * bleus au centre du dôme, à l'heure de Paris, et le disque des fruits
 * inchangé à côté.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'legacy/main.swf');
const ROUE0 = path.join(ROOT, 'public/wheel/wheel0.swf');
const TABLE = '0123456789 :';        // la pellicule `police`, image par image

function corps(fichier) {
  const raw = fs.readFileSync(fichier);
  const sig = raw.slice(0, 3).toString('ascii');
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
}

/** Les tags de premier niveau, pour vérifier que le flux se relit en entier. */
function tags(b) {
  const out = [];
  let o = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;
  while (o < b.length - 1) {
    const hdr = b.readUInt16LE(o); const code = hdr >> 6;
    let len = hdr & 0x3f, h = 2;
    if (len === 0x3f) { len = b.readUInt32LE(o + 2); h = 6; }
    if (code === 0) return { out, fin: o };
    out.push({ code, o, h, len });
    o += h + len;
  }
  return { out, fin: -1 };
}

/** Les symboles exportés d'un SWF : identifiant → nom. */
function exportes(b) {
  const noms = {};
  for (const t of tags(b).out) {
    if (t.code !== 56) continue;
    let q = t.o + t.h;
    const n = b.readUInt16LE(q); q += 2;
    for (let i = 0; i < n; i++) {
      const id = b.readUInt16LE(q); q += 2;
      let e = q; while (b[e]) e++;
      noms[b.slice(q, e).toString('utf8')] = id; q = e + 1;
    }
  }
  return noms;
}

// ── Ce que le décor apporte ─────────────────────────────────────────────────

test('wheel0.swf a bien ses chiffres, et un afficheur vide à remplir', () => {
  const b = corps(ROUE0);
  const noms = exportes(b);

  assert.ok(noms.extGameNumb !== undefined, 'le décor exporte son afficheur');
  assert.ok(noms.police !== undefined, 'et la pellicule des chiffres');

  // L'afficheur est un sprite d'UNE image et de rien du tout : tout son
  // comportement lui vient d'une classe. C'est la clé du bug.
  const sprite = tags(b).out.find((t) => t.code === 39
    && b.readUInt16LE(t.o + t.h) === noms.extGameNumb);
  assert.ok(sprite, 'extGameNumb est bien un sprite');
  assert.equal(b.readUInt16LE(sprite.o + sprite.h + 2), 1, 'une seule image');
  assert.ok(sprite.len <= 12, 'et vide — pas de contenu, pas de code');

  // Les chiffres, eux, sont une pellicule : une image par caractère.
  const police = tags(b).out.find((t) => t.code === 39
    && b.readUInt16LE(t.o + t.h) === noms.police);
  assert.ok(b.readUInt16LE(police.o + police.h + 2) >= TABLE.length,
    'la pellicule des chiffres couvre au moins « ' + TABLE + ' »');

  // Et c'est le décor lui-même qui réclame la classe, par son nom.
  const txt = b.toString('latin1');
  assert.ok(txt.indexOf('registerClass') >= 0, 'wheel0.swf accroche une classe…');
  for (const morceau of ['ext', 'game', 'Numb', 'extGameNumb']) {
    assert.ok(txt.indexOf(morceau + '\0') >= 0,
      '…et la nomme : ' + morceau);
  }
});

// ── Ce que le bureau fournit ────────────────────────────────────────────────

test('main.swf porte la classe restituée, et son flux de tags se relit en entier', () => {
  const b = corps(MAIN);
  assert.ok(b.indexOf(TABLE) >= 0,
    'legacy/main.swf doit être passé sous scripts/patch-main-heure-mandala.js');

  const { out, fin } = tags(b);
  assert.ok(fin > 0, 'le fichier se termine par un tag de fin, pas au milieu d’un tag');

  const notre = out.filter((t) => t.code === 59
    && b.slice(t.o + t.h, t.o + t.h + t.len).indexOf(TABLE) >= 0);
  assert.equal(notre.length, 1, 'un seul tag porte la classe — la rustine ne s’empile pas');

  // Un sprite ne retient qu'un DoInitAction : le porteur doit être libre.
  const porteur = b.readUInt16LE(notre[0].o + notre[0].h);
  const surLeMeme = out.filter((t) => t.code === 59
    && b.readUInt16LE(t.o + t.h) === porteur);
  assert.equal(surLeMeme.length, 1, 'le sprite porteur n’avait pas déjà son propre code');

  // Et il doit être DÉFINI avant, sinon Flash ne saurait pas à quoi rattacher
  // le tag.
  const defini = out.find((t) => t.code === 39 && b.readUInt16LE(t.o + t.h) === porteur);
  assert.ok(defini && defini.o < notre[0].o, 'le sprite porteur est défini plus haut');
});

test('la classe rendue est bien celle que le décor réclame', () => {
  const b = corps(MAIN);
  const t = tags(b).out.find((x) => x.code === 59
    && b.slice(x.o + x.h, x.o + x.h + x.len).indexOf(TABLE) >= 0);
  const code = b.slice(t.o + t.h + 2, t.o + t.h + t.len).toString('latin1');

  // Le chemin exact : _global.ext.game.Numb — c'est le nom que wheel0.swf
  // cherchera, à la lettre près.
  for (const nom of ['_global', 'ext', 'game', 'Numb']) {
    assert.ok(code.indexOf(nom + '\0') >= 0, 'le code nomme ' + nom);
  }
  // La méthode que DayNight appelle chaque minute.
  assert.ok(code.indexOf('setNum\0') >= 0, 'setNum existe');
  // Les paramètres que l'objet d'initialisation apporte (attachMovie les pose
  // AVANT le constructeur — c'est tout le principe).
  for (const p of ['num', 'link', 'scale', 'align']) {
    assert.ok(code.indexOf(p + '\0') >= 0, 'le paramètre ' + p + ' est lu');
  }
  assert.ok(code.indexOf('police\0') >= 0, 'la pellicule par défaut est « police »');
  // La construction : un clip par caractère, dans un compteur remis à neuf.
  assert.ok(code.indexOf('compteur\0') >= 0, 'les chiffres vont dans « compteur »');
  assert.ok(code.indexOf('createEmptyMovieClip\0') >= 0, 'recréé à chaque appel');
  assert.ok(code.indexOf('attachMovie\0') >= 0, 'un clip par caractère');
  assert.ok(code.indexOf('gotoAndStop\0') >= 0, 'chacun sur son image');

  // ActionExtends : sans lui, le clip attaché n'hériterait de rien et
  // createEmptyMovieClip lui manquerait. Le compilateur l'écrit toujours ainsi
  // — push "MovieClip", getVariable (0x1c), extends (0x69) — et c'est cette
  // suite-là qu'on vérifie, pas un octet 0x69 perdu au milieu du texte.
  const i = code.indexOf('MovieClip\0');
  assert.ok(i >= 0, 'la classe étend MovieClip…');
  assert.equal(code.slice(i + 10, i + 12), '\x1c\x69',
    '…par l’ActionExtends du compilateur');

  // La chaîne reste une CHAÎNE : kaluga.Numb, la copie du jeu, fait
  // Number(num).toString() — ce qui rendrait « NaN » pour « 21:37 ».
  assert.ok(code.indexOf('Number\0') < 0, 'aucune conversion en nombre');
});

test('reposer la rustine ne fait rien : elle se reconnaît', () => {
  const avant = fs.readFileSync(MAIN);
  const sortie = execFileSync(process.execPath,
    [path.join(ROOT, 'scripts/patch-main-heure-mandala.js')], { encoding: 'utf8' });
  assert.match(sortie, /déjà posée/, 'la rustine se voit déjà là');
  assert.ok(avant.equals(fs.readFileSync(MAIN)), 'et n’a pas touché un octet');
});

test('le code d’origine du cadran n’a pas été retouché', () => {
  const b = corps(MAIN).toString('latin1');
  // wheel.DayNight attache toujours son afficheur de la même façon, et le
  // remet à l'heure par le même chemin. La rustine n'ajoute que la classe.
  for (const nom of ['extGameNumb', 'updateDayCoef', 'dayCoef', 'servTime', 'getDateObject']) {
    assert.ok(b.indexOf(nom + '\0') >= 0, 'le code d’origine garde ' + nom);
  }
  // Les deux disques du cadran, dans leur ordre d'origine.
  assert.ok(b.indexOf('whDayNight\0') >= 0 && b.indexOf('whFruitMonth\0') >= 0,
    'le cadran tient toujours ses deux disques');
});
