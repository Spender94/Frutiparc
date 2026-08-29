'use strict';
/*
 * DE VRAIES VARIANTES D'ACCESSOIRE, INJECTÉES DANS LA FAMILLE
 *
 * `FPBouilleVariante` ajoute une IMAGE au caractère `acc` d'un type d'accessoire.
 * Comme ce caractère est partagé par toutes les coiffures, la variante naît
 * disponible sur les 67 coupes — et elle s'encode dans la chaîne de 24
 * caractères (type + variante + trois couleurs), comme celles d'époque.
 *
 * Ce que ce test tient :
 *
 *   · le REPÈRE — `acc` de la casquette est bien un caractère partagé, et la
 *     matrice qui mène du carré du visage à son repère est la même d'une
 *     coiffure à l'autre (c'est ce qui dispense d'adapter le dessin) ;
 *   · le GABARIT — l'art d'une variante existante ressort en coordonnées de
 *     scène, avec ses niveaux de couleur (col → 1, col2 → 2, col3 → 3) ;
 *   · l'ALLER-RETOUR — réinjecter ce gabarit tel quel rend une variante dont la
 *     liste d'affichage porte les mêmes tracés, dans le MÊME ORDRE ;
 *   · l'ORDRE DE PEINTURE — le micro de la casquette est posé APRÈS la calotte.
 *     Regrouper les tracés par couleur le faisait passer dessous : il
 *     disparaissait sous la casquette, et rien ne le disait.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
require(path.join(ROOT, 'public/js/bouille-avm.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));
const Variante = require(path.join(ROOT, 'public/js/bouille-variante.js'));

const DOSSIER = path.join(ROOT, 'public/fbouille');
const CASQUETTE = 3;          // le type « Casquette » de bouille-palette.js

function lire(fichier) {
  const brut = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength))
    .then(Swf.lire);
}

test('le repère de la casquette : un caractère PARTAGÉ, une matrice constante', async () => {
  const defs = await lire('famille0.swf');
  const refs = [0, 8, 20, 40, 66].map((co) => Variante.repere(defs, CASQUETTE, co));
  for (const r of refs) assert.ok(r, 'un repère par coiffure');

  // Le même caractère `acc` pour toutes les coiffures : c'est CE partage qui
  // rend une variante disponible partout sans rien adapter.
  const ids = new Set(refs.map((r) => r.accId));
  assert.strictEqual(ids.size, 1, 'toutes les coiffures posent le même acc (#' + refs[0].accId + ')');

  // Et la matrice scène → acc ne bouge pas d'une coupe à l'autre (relevé : une
  // translation, à moins d'un demi-pixel près).
  for (const r of refs) {
    assert.ok(Math.abs(r.versScene.a - 1) < 0.01 && Math.abs(r.versScene.d - 1) < 0.01, 'pas de mise à l\'échelle');
    assert.ok(Math.abs(r.versScene.e - refs[0].versScene.e) < 0.5, 'même décalage horizontal');
    assert.ok(Math.abs(r.versScene.f - refs[0].versScene.f) < 0.5, 'même décalage vertical');
  }
  assert.ok(refs[0].variantes > 30, 'la casquette a déjà de nombreuses variantes');
});

test('le mécanisme vaut pour LES SEIZE types d\'accessoire, pas seulement la casquette', async () => {
  const defs = await lire('famille0.swf');
  const COIFS = [0, 8, 20, 40, 66];
  const soucis = [];
  for (let type = 1; type <= 16; type++) {
    const reps = COIFS.map((co) => Variante.repere(defs, type, co)).filter(Boolean);
    if (reps.length !== COIFS.length) { soucis.push(type + ' : repère manquant'); continue; }
    // LE POINT QUI REND TOUT POSSIBLE : le caractère `acc` est le même pour
    // toutes les coiffures. Une image ajoutée vaut donc pour les 67 coupes.
    const ids = new Set(reps.map((r) => r.accId));
    if (ids.size !== 1) soucis.push(type + ' : acc non partagé (' + [...ids].join(',') + ')');
    // Et l'aller-retour tient sur la première variante DESSINÉE de ce type.
    let vu = -1;
    for (let v = 0; v < reps[0].variantes && vu < 0; v++) {
      if (Variante.exporter(defs, type, v, 8).length > 1) vu = v;
    }
    if (vu < 0) { soucis.push(type + ' : aucune variante dessinée'); continue; }
    const gab = Variante.exporter(defs, type, vu, 8);
    const inj = Variante.injecter(defs, { type, paths: gab, coiffureRef: 8 });
    if (!inj) { soucis.push(type + ' : injection refusée'); continue; }
    const copie = Variante.exporter(defs, type, inj.variante, 8);
    const cle = (p) => p.d.length + ':' + p.fill + ':' + p.slot;
    if (JSON.stringify(copie.map(cle)) !== JSON.stringify(gab.map(cle))) {
      soucis.push(type + ' : aller-retour différent');
    }
  }
  assert.deepStrictEqual(soucis, [], 'chaque type se prête à une nouvelle variante');
});

test('les images VIDES de fin de rouleau se distinguent des vraies variantes', async () => {
  const defs = await lire('famille0.swf');
  // Un rouleau traîne une queue d'images vides — reliquat d'atelier d'époque.
  // Le bonnet type 3 (15) en déclare seize et n'en dessine que deux : proposer
  // les autres comme gabarit promettrait un dessin qui n'existe pas.
  const rep = Variante.repere(defs, 15, 8);
  assert.ok(rep.variantes > 10, 'le rouleau déclare beaucoup d\'images (' + rep.variantes + ')');
  let dessinees = 0;
  for (let v = 0; v < rep.variantes; v++) {
    if (Variante.exporter(defs, 15, v, 8).length > 1) dessinees++;
  }
  assert.strictEqual(dessinees, 2, 'mais deux seulement portent un dessin');

  // La queue n'occupe que des profondeurs BASSES : l'effacement que pose une
  // variante injectée (1..64 au minimum) la couvre donc entièrement — rien de
  // l'image précédente ne peut transparaître sous une variante neuve.
  let maxProf = 0;
  for (const img of rep.sprite.images) {
    for (const o of img) if (o.prof > maxProf) maxProf = o.prof;
  }
  assert.ok(maxProf <= 64, 'profondeurs du rouleau dans la portée de l\'effacement (max ' + maxProf + ')');
});

test('le gabarit : l\'art d\'une variante, en scène, avec ses niveaux de couleur', async () => {
  const defs = await lire('famille0.swf');
  const gab = Variante.exporter(defs, CASQUETTE, 34, 8);
  assert.ok(gab.length >= 10, 'la variante 34 donne plusieurs tracés (' + gab.length + ')');

  // Les niveaux de couleur remontent (col → 1, col2 → 2) : sans eux, la
  // recolorisation n'aurait rien à quoi s'accrocher.
  const niveaux = new Set(gab.map((p) => p.slot));
  assert.ok(niveaux.has(1), 'au moins une zone de niveau 1 (col)');
  assert.ok(niveaux.has(0), 'au moins une pièce à couleur fixe');

  // Les coordonnées tombent sur le visage : c'est le repère de l'atelier.
  const xs = [], ys = [];
  for (const p of gab) {
    const n = (p.d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    for (let i = 0; i < n.length - 1; i += 2) {
      xs.push(p.m[0] * n[i] + p.m[2] * n[i + 1] + p.m[4]);
      ys.push(p.m[1] * n[i] + p.m[3] * n[i + 1] + p.m[5]);
    }
  }
  const min = (a) => Math.min.apply(null, a), max = (a) => Math.max.apply(null, a);
  assert.ok(min(xs) > -20 && max(xs) < 120, 'x dans le voisinage du visage (' + min(xs).toFixed(1) + '..' + max(xs).toFixed(1) + ')');
  assert.ok(min(ys) > -20 && max(ys) < 120, 'y dans le voisinage du visage (' + min(ys).toFixed(1) + '..' + max(ys).toFixed(1) + ')');
});

test('injecter ajoute une variante au bout du rouleau', async () => {
  const defs = await lire('famille0.swf');
  const avant = Variante.repere(defs, CASQUETTE, 8).variantes;
  const gab = Variante.exporter(defs, CASQUETTE, 34, 8);

  const inj = Variante.injecter(defs, { type: CASQUETTE, paths: gab, coiffureRef: 8 });
  assert.ok(inj, 'injection réussie');
  assert.strictEqual(inj.variante, avant, 'la nouvelle variante prend l\'index suivant');
  assert.strictEqual(Variante.repere(defs, CASQUETTE, 8).variantes, avant + 1, 'le rouleau a grandi');

  // Une seconde injection ne recouvre pas la première.
  const inj2 = Variante.injecter(defs, { type: CASQUETTE, paths: gab, coiffureRef: 8 });
  assert.strictEqual(inj2.variante, avant + 1, 'chaque injection a son propre index');
});

test('l\'aller-retour garde TOUS les tracés, et leur ordre de peinture', async () => {
  const defs = await lire('famille0.swf');
  const gab = Variante.exporter(defs, CASQUETTE, 34, 8);
  const inj = Variante.injecter(defs, { type: CASQUETTE, paths: gab, coiffureRef: 8 });

  // On ressort la variante injectée par le MÊME chemin : elle doit rendre
  // exactement le même inventaire de tracés que l'originale.
  const copie = Variante.exporter(defs, CASQUETTE, inj.variante, 8);
  assert.strictEqual(copie.length, gab.length, 'même nombre de tracés qu\'au départ');

  const cle = (p) => p.d.length + ':' + p.fill + ':' + p.slot;
  assert.deepStrictEqual(copie.map(cle), gab.map(cle),
    'mêmes tracés, mêmes couleurs, mêmes niveaux — ET dans le même ordre');
});

test('le micro de la casquette reste PAR-DESSUS la calotte', async () => {
  const defs = await lire('famille0.swf');
  const gab = Variante.exporter(defs, CASQUETTE, 34, 8);

  // Dans la variante d'origine, la calotte (niveau 1, « col ») est peinte AVANT
  // les dernières pièces à couleur fixe — le micro. Si l'injection regroupait
  // les tracés par couleur, le micro repasserait dessous et disparaîtrait.
  const dernierCol = gab.map((p) => p.slot).lastIndexOf(1);
  const dernierFixe = gab.map((p) => p.slot).lastIndexOf(0);
  assert.ok(dernierFixe > dernierCol,
    'le gabarit finit par des pièces fixes posées après la calotte (le micro)');

  const inj = Variante.injecter(defs, { type: CASQUETTE, paths: gab, coiffureRef: 8 });
  const copie = Variante.exporter(defs, CASQUETTE, inj.variante, 8);
  const cCol = copie.map((p) => p.slot).lastIndexOf(1);
  const cFixe = copie.map((p) => p.slot).lastIndexOf(0);
  assert.ok(cFixe > cCol, 'la copie garde cet ordre : le micro passe toujours au-dessus');
});

test('RETIRER une variante ne décale pas les suivantes', async () => {
  // Le contrat du catalogue : une variante vaut par son INDEX, et cet index vient
  // de son rang d'injection. Si retirer la première faisait reculer la seconde,
  // tous les joueurs qui portent la seconde changeraient d'accessoire du jour au
  // lendemain. Une variante retirée s'injecte donc VIDE, et garde sa place.
  const gab = Variante.exporter(await lire('famille0.swf'), CASQUETTE, 34, 8);

  // Cas 1 — les deux variantes publiées.
  const defsA = await lire('famille0.swf');
  const base = Variante.repere(defsA, CASQUETTE, 8).variantes;
  Variante.injecter(defsA, { type: CASQUETTE, paths: gab, coiffureRef: 8 });
  const bAvant = Variante.injecter(defsA, { type: CASQUETTE, paths: gab, coiffureRef: 8 });
  assert.strictEqual(bAvant.variante, base + 1, 'la seconde est juste après la première');

  // Cas 2 — la première est retirée : sa place reste tenue par une image vide.
  const defsB = await lire('famille0.swf');
  const vide = Variante.injecter(defsB, { type: CASQUETTE, paths: [], coiffureRef: 8, vide: true });
  assert.ok(vide, 'une variante vide s\'injecte quand même');
  const bApres = Variante.injecter(defsB, { type: CASQUETTE, paths: gab, coiffureRef: 8 });
  assert.strictEqual(bApres.variante, bAvant.variante,
    'la seconde garde EXACTEMENT le même index qu\'avant le retrait');

  // Et la place tenue ne dessine rien.
  assert.strictEqual(Variante.exporter(defsB, CASQUETTE, vide.variante, 8).length, 0,
    'la variante retirée n\'affiche aucun tracé');
});

test('une variante injectée se sélectionne par la chaîne de 24 caractères', async () => {
  const defs = await lire('famille0.swf');
  const gab = Variante.exporter(defs, CASQUETTE, 34, 8);
  const inj = Variante.injecter(defs, { type: CASQUETTE, paths: gab, coiffureRef: 8 });

  const paire = (n) => Moteur.encode62(n, 2);
  const etat = [0, 3, 0, 8, 0, 2, 7, CASQUETTE, inj.variante, 21, 17, 24].map(paire).join('');
  assert.strictEqual(etat.length, 24, 'une chaîne d\'état ordinaire — rien d\'ajouté au bout');

  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(etat);

  // L'accessoire est bien monté, et ses niveaux de couleur ont reçu la teinte
  // de la palette : c'est le mécanisme d'époque, pas un habillage à part.
  const face = mo.racine.face;
  const enf = (c, nom) => (c ? c.enfantNomme(nom) : null);
  const acc = enf(enf(enf(face, 'ca'), 'c'), 'acc');
  assert.ok(acc, 'la chaîne d\'état monte bien l\'accessoire');
  const col = enf(acc, 'col');
  assert.ok(col, 'la variante injectée expose un sous-clip « col »');
  assert.ok(col.teinte, 'et apply() l\'a teinté depuis la palette');
  assert.deepStrictEqual(col.teinte, Moteur.PALETTE[21], 'avec la couleur demandée (index 21)');
});
