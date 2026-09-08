'use strict';
/*
 * DEUX ÉMOTES EMPRUNTÉES À D'AUTRES FAMILLES
 * ══════════════════════════════════════════
 *
 * « J'aimerais permettre à tout le monde d'utiliser l'émote "regarde
 * ailleurs" de hiko (famille 12). Ce qui m'intéresse, c'est la fin de
 * l'émote : il y a une explosion et un chocapic qui apparaît. […] J'aimerais
 * aussi reprendre le "tousse" de la famille 15 en éliminant la bulle de
 * chewing gum. »
 *
 * Le relevé des dix familles en donne quatre qui ont une chute que la
 * famille 0 n'a pas. Deux valaient d'être partagées :
 *
 *   JUTSU (famille 12). Après « regarde ailleurs », le visage disparaît dans
 *   la fumée et il ne reste qu'un chocapic. Le gag n'a rien de ninja : il
 *   marche sur n'importe quelle bouille. Deux dessins le portent — la fumée
 *   (six formes qui se relaient) et le chocapic — et ils n'existent que dans
 *   famille12.swf : c'est eux, et eux seuls, qu'on récolte.
 *
 *   TOUSSE (famille 15). Elle ne dessine RIEN : c'est la tête entière qui
 *   sursaute, sur une courbe de six images. On n'emporte donc que les six
 *   matrices — et pas la bulle de chewing-gum qui l'amène chez elle.
 *
 * CE QU'ON N'EMPORTE PAS : les pellicules. La chute d'hiko vit dans les
 * images 129 à 148 de SON visage, avec ses scripts et ses boucles d'attente ;
 * rien de cela n'a de place dans un visage qui n'a pas ces images. Le moteur
 * rejoue donc le déroulé lui-même, au battement près du relevé.
 *
 * Ce fichier tient les trois choses qui peuvent se défaire : la récolte (son
 * contenu et ses numéros), le déroulé (ce qui paraît, quand, et pour combien
 * de temps), et le câblage du chat.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const VIGNETTE = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
const DOSSIER = path.join(ROOT, 'public/fbouille');
const PAQUET = JSON.parse(fs.readFileSync(path.join(DOSSIER, 'emotes.json'), 'utf8'));

function lire(fichier) {
  const b = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}
const paire = (n) => Moteur.encode62(n, 2);
const ETAT = [0, 1, 0, 4, 1, 15, 22, 0, 0, 0, 0, 0].map(paire).join('');

function monter(defs) {
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(ETAT);
  mo.greffer(PAQUET);
  return mo;
}

// ══ LA RÉCOLTE ════════════════════════════════════════════════════════════

test('la récolte ne prend que les dessins de la chute, et les renumérote', () => {
  // Deux clips — la fumée et le chocapic — et les sept formes qu'ils portent.
  assert.strictEqual(Object.keys(PAQUET.sprites).length, 2, 'deux clips');
  assert.strictEqual(Object.keys(PAQUET.formes).length, 7, 'sept formes');
  // AU-DELÀ DE LA PLAGE D'UN SWF. Un caractère d'hiko porte un numéro sur
  // seize bits, et la famille d'accueil a le sien au même : #415 est le
  // chocapic chez hiko et tout autre chose dans la famille 0.
  Object.keys(PAQUET.formes).concat(Object.keys(PAQUET.sprites)).forEach((id) => {
    assert.ok(Number(id) > 65535, 'le numéro ' + id + ' doit sortir de la plage d’un SWF');
  });
  assert.ok(PAQUET.jutsu.fumee.ch > 65535 && PAQUET.jutsu.chocapic.ch > 65535);
  // Et l'on sait d'où ça vient, si la récolte est à refaire.
  assert.match(PAQUET.source.outil, /extract-emotes-bouille\.js/);
  assert.match(PAQUET.source.jutsu, /famille12\.swf/);
  assert.match(PAQUET.source.toux, /famille15\.swf/);
});

test('les dessins récoltés sont bien ceux d’hiko, au tracé près', async () => {
  const d12 = await lire('famille12.swf');
  const dec = PAQUET.source.decalage;
  let compares = 0;
  Object.entries(PAQUET.formes).forEach(([id, forme]) => {
    const origine = d12.formes.get(Number(id) - dec);
    assert.ok(origine, 'la forme ' + id + ' doit exister dans famille12.swf');
    assert.deepStrictEqual(forme, origine, 'la forme ' + id + ' est recopiée telle quelle');
    compares++;
  });
  assert.strictEqual(compares, 7);
  // La fumée est bien une pellicule (six dessins qui se relaient), le chocapic
  // une seule image.
  assert.strictEqual(PAQUET.sprites[PAQUET.jutsu.chocapic.ch].n, 1, 'le chocapic ne bouge pas');
  assert.ok(PAQUET.sprites[PAQUET.jutsu.fumee.ch].n > 1, 'la fumée, elle, tourne');
});

test('la secousse de la toux est celle de la famille 15', () => {
  const pas = PAQUET.toux.secousse;
  assert.strictEqual(pas.length, 6, 'six images de sursaut');
  const angle = (M) => Math.atan2(M.b, M.a) * 180 / Math.PI;
  // Un RECUL AMORTI : la tête part à deux degrés et revient à sa place.
  assert.ok(angle(pas[0]) < -1.9 && angle(pas[0]) > -2.2, 'le départ est à −2°');
  for (let i = 1; i < pas.length; i++) {
    assert.ok(Math.abs(angle(pas[i])) < Math.abs(angle(pas[i - 1])),
      'l’image ' + i + ' revient vers la position de repos');
  }
  const fin = pas[pas.length - 1];
  assert.deepStrictEqual([fin.a, fin.b, fin.c, fin.d, fin.e, fin.f], [1, 0, 0, 1, 0, 0],
    'et la dernière est l’identité : on est rentré');
});

// ══ LE DÉROULÉ ════════════════════════════════════════════════════════════

test('« jutsu » commence à la fumée — le « regarde ailleurs » n’est pas rejoué', async () => {
  const mo = monter(await lire('famille0.swf'));
  const face = mo.racine.face;
  mo.jouerAnim(14);
  // Le visage ne joue rien : il est à l'arrêt sur son image 1, et c'est le
  // dessin qui l'efface (cf. `dessiner`). Chez hiko c'est l'alpha zéro posé
  // sur ses huit profondeurs qui fait le même travail.
  assert.strictEqual(face.frame, 1, 'le visage ne joue aucune pellicule');
  assert.ok(mo.chute && mo.chute.quoi === 'jutsu', 'la chute part tout de suite');
  assert.strictEqual(mo.chute.t, 0);
  // La fumée ET le chocapic sont là dès le premier battement.
  assert.ok(mo.chute.fumee && mo.chute.fumee.enfants.size > 0, 'la fumée est montée');
  assert.ok(mo.chute.chocapic && mo.chute.chocapic.enfants.size > 0, 'le chocapic aussi');
});

test('la fumée s’efface, le chocapic reste, et tout rentre au bout', async () => {
  const mo = monter(await lire('famille0.swf'));
  mo.jouerAnim(14);
  let n = 0;
  const fumeeVue = [];
  while (mo.enMouvement() && n < 400) {
    if (mo.chute) fumeeVue.push(mo.chute.t < 20);
    mo.avancer(); n++;
  }
  // Trois secondes et des poussières, à quarante images par seconde.
  assert.strictEqual(n, 129, 'la chute dure ce que dure celle d’hiko');
  assert.strictEqual(fumeeVue.filter(Boolean).length, 20,
    'la fumée tient vingt battements — « _alpha -= 5 » vingt fois');
  assert.strictEqual(mo.chute, null, 'et la chute se range');
  assert.strictEqual(mo.racine.flStop, true, 'la bouille est revenue au repos');
});

test('« tousse » sursaute quatre fois, les yeux fermés, sans rien dessiner', async () => {
  const mo = monter(await lire('famille0.swf'));
  const face = mo.racine.face;
  const oa = face.enfantNomme('oa').enfantNomme('o');
  mo.jouerAnim(15);
  // Les yeux se ferment et restent clos, comme à l'image 90 de la famille 15.
  assert.ok(oa.def.labels && oa.def.labels.ferme, 'l’œil a une image « ferme »');
  assert.strictEqual(oa.frame, oa.def.labels.ferme, 'et c’est celle qu’il montre');
  assert.ok(mo.chute && mo.chute.quoi === 'toux');

  // Les battements où la tête est hors de sa place : quatre salves de six.
  const secoue = [];
  let n = 0;
  while (mo.enMouvement() && n < 400) {
    if (mo.secousseToux()) secoue.push(mo.chute.t);
    mo.avancer(); n++;
  }
  assert.strictEqual(n, 45, 'un peu plus d’une seconde');
  assert.deepStrictEqual(secoue, [
    0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15,
    20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35,
  ], 'quatre sursauts de six battements, dix battements d’écart');
  assert.strictEqual(mo.chute, null);

  // Et RIEN n'a été greffé sur le visage : la toux n'est que du mouvement.
  const profs = [...face.enfants.keys()];
  assert.ok(profs.every((p) => p < 65536), 'aucun dessin récolté ne s’invite dans le visage');
});

test('une chute ne survit pas à l’animation suivante', async () => {
  const mo = monter(await lire('famille0.swf'));
  mo.jouerAnim(14);
  assert.ok(mo.chute);
  mo.jouerAnim(2);                         // on rit par-dessus
  assert.strictEqual(mo.chute, null, 'le rire range la chute');
  mo.jouerAnim(15);
  assert.ok(mo.chute);
  mo.jouerAnim(0);                         // retour au repos
  assert.strictEqual(mo.chute, null);
});

test('sans la récolte, l’émote ne fait rien plutôt que d’effacer la tête', async () => {
  // Le paquet arrive par le réseau : s'il manque, mieux vaut une bouille
  // immobile qu'un visage effacé et rien à sa place.
  const defs = await lire('famille0.swf');
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(ETAT);                        // pas de greffer()
  mo.jouerAnim(14);
  assert.ok(!mo.chute, 'aucune chute sans les dessins');
  // La toux, elle, n'a besoin d'aucun dessin — mais sa courbe vient du même
  // paquet : sans lui, elle ne secoue rien.
  mo.jouerAnim(15);
  assert.strictEqual(mo.secousseToux(), null);
});

test('la greffe est idempotente et ne recouvre rien', async () => {
  const defs = await lire('famille0.swf');
  const avantF = defs.formes.size, avantS = defs.sprites.size;
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.greffer(PAQUET);
  const apresF = defs.formes.size, apresS = defs.sprites.size;
  assert.strictEqual(apresF, avantF + 7, 'sept formes de plus');
  assert.strictEqual(apresS, avantS + 2, 'deux clips de plus');
  // La même famille sert toutes les bouilles d'une page : la deuxième greffe
  // ne doit rien refaire.
  const mo2 = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo2.creerVisage();
  mo2.greffer(PAQUET);
  assert.strictEqual(defs.formes.size, apresF);
  assert.strictEqual(defs.sprites.size, apresS);
  assert.ok(mo2.emotes, 'mais le moteur, lui, connaît le paquet');
});

// ══ LE CÂBLAGE ════════════════════════════════════════════════════════════

test('le chat mène aux deux émotes, et les nomme', () => {
  const bloc = /var EMOTE_MAP = \{\};[\s\S]*?\n  \}\)\(\);/.exec(LIGHT);
  assert.ok(bloc, 'la table des déclencheurs');
  assert.match(bloc[0], /add\("jutsu", "chocapic no jutsu", \["jutsu", "chocapic"\]\);/);
  assert.match(bloc[0], /add\("tousse", "tousse", \["tousse", "cough", "keuf"\]\);/);
  const idx = /var ANIM_INDEX = \{[\s\S]*?\};/.exec(LIGHT);
  assert.match(idx[0], /jutsu:14, tousse:15/);
  const lab = /var ANIM_LABEL = \{[\s\S]*?\};/.exec(LIGHT);
  assert.match(lab[0], /jutsu:"chocapic no jutsu"/);
  assert.match(lab[0], /tousse:"tousse"/);
  // Le moteur les connaît sous les mêmes indices.
  assert.strictEqual(Moteur.ANIMATIONS[14], 'jutsu');
  assert.strictEqual(Moteur.ANIMATIONS[15], 'tousse');
});

test('le paquet ne se charge QUE pour les émotes qui en ont besoin', () => {
  // Vingt-cinq kilo-octets qu'on ne fait pas payer à ceux qui ne les jouent
  // pas — et une seule fois pour toute la page.
  assert.match(VIGNETTE, /var EMOTES_GREFFEES = \[14, 15\];/);
  assert.match(VIGNETTE, /function emotes\(\) \{[\s\S]*?fetch\(DOSSIER \+ 'emotes\.json'\)/);
  const j = /function jouer\(c, etat, anim, humeur\) \{[\s\S]*?\n  \}/.exec(VIGNETTE);
  assert.ok(j, 'jouer');
  assert.match(j[0], /if \(EMOTES_GREFFEES\.indexOf\(n\) >= 0\)/);
  assert.match(j[0], /b\.moteur\.greffer\(r\[1\]\)/);
  // Et l'échec du chargement ne casse rien : `emotes()` rend null.
  assert.match(VIGNETTE, /\.catch\(function \(\) \{ return null; \}\);/);
});
