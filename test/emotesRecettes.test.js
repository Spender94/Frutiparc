'use strict';
/*
 * DEUX ÉMOTES SANS UN DESSIN DE PLUS : le clin d'œil et le bisou.
 *
 * « Allons-y avec clin d'œil et bisou. » Ni l'une ni l'autre n'emprunte quoi
 * que ce soit à une autre famille : ce sont des RECETTES, faites de dessins
 * que chaque famille a déjà —
 *
 *   CLIN (17)   un œil sur « ferme » (l'image que « pleurer » et la toux
 *               utilisent), l'autre tel quel, la bouche du Sourire ; l'œil se
 *               rouvre au bout d'une demi-seconde, le sourire tient un peu ;
 *   BISOU (18)  la pellicule de « rougir » (le fard des joues, et c'est elle
 *               qui mène la fin), les yeux clos, la bouche en bec que le
 *               sifflote pose à l'étiquette « siffle », tenue tout du long.
 *
 * Ce fichier tient ce qui peut se défaire : le déroulé (quel œil, quelle
 * bouche, quand ça rouvre, quand ça rentre), l'absence de greffe, et le
 * câblage du chat et de la démo.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const DEMO = fs.readFileSync(path.join(ROOT, 'public/demo.html'), 'utf8');
const DOSSIER = path.join(ROOT, 'public/fbouille');

function lire(fichier) {
  const b = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}
const paire = (n) => Moteur.encode62(n, 2);
// L'humeur 4 (Joie) : l'œil ouvert du clin d'œil doit rester CELUI-LÀ.
const ETAT = [0, 1, 0, 4, 1, 15, 22, 0, 0, 0, 0, 0].map(paire).join('');

function monter(defs) {
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(ETAT);
  return mo;
}
function morceaux(mo) {
  const face = mo.racine.face;
  return {
    face,
    oa: face.enfantNomme('oa').enfantNomme('o'),
    ob: face.enfantNomme('ob').enfantNomme('o'),
    bb: face.enfantNomme('b').enfantNomme('b'),
  };
}

test('le clin d’œil : un œil clos, l’autre à l’humeur, le sourire — puis l’œil se rouvre et tout rentre', async () => {
  const mo = monter(await lire('famille0.swf'));
  const { face, oa, ob, bb } = morceaux(mo);
  const humeur = mo.racine.emoteEye + 1;
  mo.jouerAnim(17);
  assert.ok(oa.def.labels && oa.def.labels.ferme, 'l’œil a une image « ferme »');
  assert.strictEqual(oa.frame, oa.def.labels.ferme, 'l’œil gauche est clos');
  assert.strictEqual(ob.frame, humeur, 'l’œil droit reste à l’humeur du moment');
  assert.strictEqual(bb.frame, Moteur.HUMEURS[3][1] + 1, 'la bouche du Sourire');
  assert.strictEqual(face.frame, 1, 'le visage ne joue rien : il reste au repos');
  assert.ok(mo.chute && mo.chute.quoi === 'clin', 'c’est le moteur qui tient le compte');

  // L'œil se rouvre à vingt battements, le sourire tient jusqu'à trente-huit.
  let n = 0, rouvert = null;
  while (mo.enMouvement() && n < 400) {
    mo.avancer(); n++;
    if (rouvert === null && oa.frame !== oa.def.labels.ferme) rouvert = n;
  }
  assert.strictEqual(rouvert, 20, 'l’œil se rouvre au vingtième battement');
  assert.strictEqual(n, 38, 'et tout rentre au trente-huitième');
  assert.strictEqual(mo.chute, null);
  assert.strictEqual(mo.racine.flStop, true, 'repos');
  assert.strictEqual(oa.frame, humeur);
  assert.strictEqual(ob.frame, humeur);
  // Et rien n'a été greffé : pas un dessin de plus sur le visage.
  assert.ok([...face.enfants.keys()].every((p) => p < 65536));
});

test('le bisou : le fard de « rougir », les yeux clos, la bouche en bec tenue jusqu’au bout', async () => {
  const mo = monter(await lire('famille0.swf'));
  const { face, oa, ob, bb } = morceaux(mo);
  mo.jouerAnim(18);
  assert.strictEqual(face.frame, face.def.labels.rougir, 'la pellicule de rougir : c’est elle qui porte le fard');
  assert.strictEqual(oa.frame, oa.def.labels.ferme);
  assert.strictEqual(ob.frame, oa.def.labels.ferme, 'les deux yeux clos');
  assert.ok(bb.def.labels && bb.def.labels.siffle, 'la bouche a une image « siffle »');
  assert.strictEqual(bb.frame, bb.def.labels.siffle, 'la bouche en bec, dès le départ');
  assert.strictEqual(mo.chute, null, 'pas de compte à tenir : la pellicule mène');
  assert.strictEqual(mo.fardKaki, false, 'le fard reste rouge — ce n’est pas beurk');

  // Tout du long, la bouche reste dans sa boucle « siffle », les yeux clos.
  const bec = bb.def.labels.siffle;
  let n = 0;
  while (mo.enMouvement() && n < 2000) {
    assert.ok(bb.frame >= bec && bb.frame < bec + 20, `la bouche en bec au battement ${n} (image ${bb.frame})`);
    assert.strictEqual(oa.frame, oa.def.labels.ferme, `yeux clos au battement ${n}`);
    mo.avancer(); n++;
  }
  // Même durée que « rougir » et « beurk », qui jouent la même pellicule.
  const temoin = monter(await lire('famille0.swf'));
  temoin.jouerAnim(5);
  let m = 0;
  while (temoin.enMouvement() && m < 2000) { temoin.avancer(); m++; }
  assert.strictEqual(n, m, 'le bisou dure ce que dure un rougissement');
  assert.strictEqual(mo.racine.flStop, true);
  assert.strictEqual(bb.frame, 1, 'la bouche est rangée');
});

test('les deux recettes jouent sur les autres familles — avec ce que chacune a', async () => {
  // Une famille sans image « ferme » (la 10) ne ferme pas plus l'œil ici que
  // dans « pleurer » ou la toux : la recette dégrade comme les émotes
  // d'époque, et surtout elle ne casse rien.
  let fermes = 0;
  for (const f of ['famille0.swf', 'famille10.swf', 'famille12.swf', 'famille15.swf', 'famille24.swf']) {
    const mo = monter(await lire(f));
    const { oa, bb } = morceaux(mo);
    mo.jouerAnim(17);
    if (oa.def.labels && oa.def.labels.ferme) { fermes++; assert.strictEqual(oa.frame, oa.def.labels.ferme, `${f} : l’œil se ferme`); }
    let n = 0;
    while (mo.enMouvement() && n < 400) { mo.avancer(); n++; }
    assert.strictEqual(n, 38, `${f} : le clin dure le même temps partout`);
    mo.jouerAnim(18);
    if (bb.def.labels && bb.def.labels.siffle) assert.strictEqual(bb.frame, bb.def.labels.siffle, `${f} : la bouche en bec`);
    n = 0;
    while (mo.enMouvement() && n < 2000) { mo.avancer(); n++; }
    assert.ok(n > 0 && n < 2000, `${f} : le bisou finit (${n})`);
  }
  assert.ok(fermes >= 4, 'presque toutes ont l’image « ferme »');
});

test('une animation par-dessus range le clin d’œil, comme une chute', async () => {
  const mo = monter(await lire('famille0.swf'));
  mo.jouerAnim(17);
  assert.ok(mo.chute);
  mo.jouerAnim(2);
  assert.strictEqual(mo.chute, null, 'le rire range le clin');
  mo.jouerAnim(17);
  mo.jouerAnim(0);
  assert.strictEqual(mo.chute, null);
});

test('le chat et la démo les connaissent, sous leurs mots', () => {
  const bloc = /var EMOTE_MAP = \{\};[\s\S]*?\n  \}\)\(\);/.exec(LIGHT);
  assert.ok(bloc, 'la table des déclencheurs');
  assert.match(bloc[0], /add\("clin", "fait un clin d’œil", \[";\)", ";-\)", "clin"\]\);/);
  assert.match(bloc[0], /add\("bisou", "envoie un bisou", \[":\*", ":-\*", "bisou", "smack"\]\);/);
  const idx = /var ANIM_INDEX = \{[\s\S]*?\};/.exec(LIGHT);
  assert.match(idx[0], /clin:17, bisou:18/);
  const lab = /var ANIM_LABEL = \{[\s\S]*?\};/.exec(LIGHT);
  assert.match(lab[0], /clin:"fait un clin d’œil"/);
  assert.match(lab[0], /bisou:"envoie un bisou"/);
  assert.strictEqual(Moteur.ANIMATIONS[17], 'clin');
  assert.strictEqual(Moteur.ANIMATIONS[18], 'bisou');
  assert.strictEqual(Moteur.NOMS_ANIMATIONS[17], 'Clin d’œil');
  assert.strictEqual(Moteur.NOMS_ANIMATIONS[18], 'Bisou');
  assert.match(DEMO, /\{ id: 'clin',\s+name: 'Clin d’œil',\s+idx: 17 \}/);
  assert.match(DEMO, /\{ id: 'bisou',\s+name: 'Bisou',\s+idx: 18 \}/);
  // Les mots d'époque ne bougent pas : « ;( » reste la larme, « :p » la langue.
  assert.match(bloc[0], /add\("larme", "laisse couler une larme", \[":'\(", ";\(", "larme", "snif"\]\);/);
});
