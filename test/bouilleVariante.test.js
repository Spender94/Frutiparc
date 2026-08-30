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

// Depuis que l'export rend AUSSI la couche arrière, un comptage brut mêlerait
// les deux. Les épreuves qui portent sur l'art qu'on vient d'injecter ne
// retiennent donc que le DEVANT — c'est ce qu'elles ont toujours voulu dire.
const devant = (liste) => liste.filter((p) => p.avant !== false);

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
  //
  // Et une image de queue n'est pas forcément VIDE À L'ÉCRAN : le type 15 a un
  // second rouleau `acc2` d'une seule image, qui se borne donc sur toute la
  // queue et y laisse son bandeau. Compter les tracés ne suffit pas — c'est au
  // rouleau PRINCIPAL qu'il faut demander s'il a dessiné.
  const rep = Variante.repere(defs, 15, 8);
  assert.ok(rep.variantes > 10, 'le rouleau déclare beaucoup d\'images (' + rep.variantes + ')');
  let dessinees = 0, avecTraces = 0;
  for (let v = 0; v < rep.variantes; v++) {
    if (Variante.dessinee(defs, 15, v, 8)) dessinees++;
    if (Variante.exporter(defs, 15, v, 8).length > 1) avecTraces++;
  }
  assert.strictEqual(dessinees, 2, 'mais deux seulement portent un dessin');
  assert.strictEqual(avecTraces, rep.variantes,
    'toutes montrent pourtant quelque chose — le reliquat du rouleau compagnon');

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
  assert.strictEqual(devant(Variante.exporter(defsB, CASQUETTE, vide.variante, 8)).length, 0,
    'la variante retirée n\'affiche aucun tracé');
});

test('une variante LONGUE ne déborde pas sur la suivante', async () => {
  // Une pellicule GARDE ce que l'image précédente a posé : chaque variante doit
  // donc faire table rase. On ne balayait que nos propres profondeurs (64 au
  // minimum) — une variante de quarante tracés montant jusqu'à 80, la suivante,
  // plus courte, héritait de ses derniers calques. En production les accessoires
  // se mélangeaient ; dans l'atelier, où une seule variante est injectée, il n'y
  // avait rien à hériter et tout semblait juste.
  const defs = await lire('famille0.swf');
  const longue = [];
  for (let i = 0; i < 40; i++) {
    longue.push({ d: 'M' + (10 + i) + ' 20h3v3h-3Z', fill: 'rgb(200,60,60)', m: [1, 0, 0, 1, 0, 0] });
  }
  const courte = [{ d: 'M40 20h10v10h-10Z', fill: 'rgb(60,60,200)', m: [1, 0, 0, 1, 0, 0] }];

  const a = Variante.injecter(defs, { type: CASQUETTE, paths: longue, coiffureRef: 8 });
  const b = Variante.injecter(defs, { type: CASQUETTE, paths: courte, coiffureRef: 8 });
  assert.strictEqual(devant(Variante.exporter(defs, CASQUETTE, a.variante, 8)).length, 40, 'la longue est entière');
  assert.strictEqual(devant(Variante.exporter(defs, CASQUETTE, b.variante, 8)).length, 1,
    'la courte ne porte QUE son tracé — rien de la précédente');
});

test('l\'INDEX d\'une variante ne dépend pas de ce qui a été injecté avant', async () => {
  // Une variante valait par son RANG d'injection : le troisième publié tombait à
  // l'index 40 parce que deux autres étaient passés avant. Tout écart entre ce
  // qu'un client avait chargé et ce que le serveur savait donnait alors un AUTRE
  // accessoire, sans rien dire. `index` en fait un FAIT : on comble le rouleau
  // jusqu'à la place demandée, et la variante y tombe toujours.
  const art = [{ d: 'M20 20h20v10h-20Z', fill: 'rgb(10,200,90)', m: [1, 0, 0, 1, 0, 0] }];
  const autre = [{ d: 'M60 20h5v5h-5Z', fill: 'rgb(9,9,9)', m: [1, 0, 0, 1, 0, 0] }];

  const seul = await lire('famille0.swf');
  const r1 = Variante.injecter(seul, { type: CASQUETTE, paths: art, coiffureRef: 8, index: 42 });

  const apres = await lire('famille0.swf');
  Variante.injecter(apres, { type: CASQUETTE, paths: autre, coiffureRef: 8, index: 38 });
  Variante.injecter(apres, { type: CASQUETTE, paths: autre, coiffureRef: 8, index: 39 });
  const r2 = Variante.injecter(apres, { type: CASQUETTE, paths: art, coiffureRef: 8, index: 42 });

  assert.strictEqual(r1.variante, 42, 'seule, elle tombe à la place demandée');
  assert.strictEqual(r2.variante, 42, 'et à la MÊME place une fois deux autres passées avant');
  assert.strictEqual(devant(Variante.exporter(seul, CASQUETTE, 42, 8)).length, 1, 'avec son dessin');
  assert.strictEqual(devant(Variante.exporter(apres, CASQUETTE, 42, 8)).length, 1, 'des deux côtés');
  // Les places comblées entre-temps ne dessinent rien.
  assert.strictEqual(devant(Variante.exporter(seul, CASQUETTE, 40, 8)).length, 0,
    'une place tenue reste vide — elle ne montre pas la variante d\'à côté');
});

test('les DÉGRADÉS survivent à l\'aller-retour, et le gabarit les écrit en SVG', async () => {
  const defs = await lire('famille0.swf');
  // Vingt-trois couches de la famille 0 sont peintes en dégradé. L'export les
  // jetait — un « bout du dessin » disparaissait sans rien dire. Elles font
  // maintenant l'aller-retour, et un dégradé de GRIS se teinte comme un aplat :
  // c'est ce qui donne du volume à une zone recolorable.
  let trouve = null;
  for (let type = 1; type <= 16 && !trouve; type++) {
    const rep = Variante.repere(defs, type, 8);
    if (!rep) continue;
    for (let v = 0; v < rep.variantes; v++) {
      const g = Variante.exporter(defs, type, v, 8);
      if (g.some((p) => p.degrade)) { trouve = { type, v, paths: g }; break; }
    }
  }
  assert.ok(trouve, 'au moins un accessoire d\'époque porte un dégradé');

  const deg = trouve.paths.filter((p) => p.degrade);
  for (const p of deg) {
    assert.ok(p.degrade.arrets.length >= 2, 'un dégradé a au moins deux arrêts');
    assert.ok(p.degrade.M && isFinite(p.degrade.M.a), 'et une matrice exploitable');
    assert.ok(p.fill, 'un repli de couleur reste, pour un lecteur qui l\'ignorerait');
  }

  // Réinjecté, le dégradé arrive tel quel jusqu'à la couche du moteur.
  const inj = Variante.injecter(defs, { type: trouve.type, paths: trouve.paths, coiffureRef: 8 });
  const copie = Variante.exporter(defs, trouve.type, inj.variante, 8);
  assert.strictEqual(copie.filter((p) => p.degrade).length, deg.length,
    'la copie porte autant de dégradés que l\'original');
});

test('un dessin HORS des calques « couleurN » garde ses couleurs', async () => {
  const defs = await lire('famille0.swf');
  // Le graphiste doit pouvoir livrer un accessoire à couleurs FIXES : il lui
  // suffit de ne rien mettre dans « couleur1/2/3 ». Les tracés sans niveau
  // gardent alors leur teinte, que la recolorisation ne touche pas.
  const cuits = [
    { d: 'M10 10h20v20h-20Z', fill: 'rgb(230,120,10)', m: [1, 0, 0, 1, 0, 0] },
    { d: 'M40 10h20v20h-20Z', fill: '#3269AF', m: [1, 0, 0, 1, 0, 0] },
  ];
  const inj = Variante.injecter(defs, { type: CASQUETTE, paths: cuits, coiffureRef: 8 });
  assert.ok(inj, 'une variante entièrement à couleurs fixes s\'injecte');

  const relu = devant(Variante.exporter(defs, CASQUETTE, inj.variante, 8));
  assert.strictEqual(relu.length, 2, 'les deux tracés sont là');
  for (const p of relu) assert.strictEqual(p.slot, 0, 'aucun niveau de couleur : rien à recolorer');
  const fills = relu.map((p) => p.fill).sort();
  assert.deepStrictEqual(fills, ['rgb(230,120,10)', 'rgb(50,105,175)'].sort(),
    'chaque tracé a gardé EXACTEMENT sa couleur');
});

test('un SVG dont le plan de travail a changé revient À L\'ÉCHELLE', async () => {
  // Le gabarit part en 100 × 100, mais un aller-retour par Illustrator n'en
  // revient pas toujours ainsi : ré-exporter en « pixels » donne couramment un
  // plan de travail de 1000, viewBox comprise. Les tracés arrivaient alors DIX
  // FOIS trop grands — l'accessoire couvrait tout le canevas et la bouille
  // semblait avoir disparu, sans la moindre erreur pour le dire.
  //
  // `charger` se règle désormais sur la VIEWBOX, jamais sur width/height. Ce
  // test tient la règle sans navigateur : on refait le calcul que fait l'import.
  const scene = 100;
  function versScene(viewBox) {
    const vb = viewBox.split(/[\s,]+/).map(Number);
    const ok = vb.length === 4 && vb.every((n) => isFinite(n)) && vb[2] > 0 && vb[3] > 0;
    const sx = ok ? scene / vb[2] : 1, sy = ok ? scene / vb[3] : 1;
    return { a: sx, d: sy, e: ok ? -vb[0] * sx : 0, f: ok ? -vb[1] * sy : 0 };
  }
  // Le gabarit tel qu'il part : rien à corriger.
  assert.deepStrictEqual(versScene('0 0 100 100'), { a: 1, d: 1, e: -0, f: -0 });
  // Un plan de travail dix fois plus grand : tout revient au dixième.
  assert.deepStrictEqual(versScene('0 0 1000 1000'), { a: 0.1, d: 0.1, e: -0, f: -0 });
  // Et une viewBox décalée retrouve son origine.
  const d = versScene('50 20 200 200');
  assert.strictEqual(d.a, 0.5);
  assert.strictEqual(d.e, -25);
  assert.strictEqual(d.f, -10);
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

test('la partie DERRIÈRE la tête fait partie du gabarit, et de la copie', async () => {
  // Un accessoire vit sur deux couches : `ca` devant les cheveux, `cb` derrière
  // la tête. Onze types sur seize ont une partie arrière — les bananes qui
  // pendent derrière la tête, l'arrière d'un chapeau. L'export ne suivait que
  // l'avant : le gabarit livré au graphiste était amputé, sans le dire.
  const BANANE = 12;
  const defs = await lire('famille0.swf');
  const gab = Variante.exporter(defs, BANANE, 0, 8);
  const arriere = gab.filter((p) => p.avant === false);
  assert.ok(arriere.length > 0, 'la banane a bien une partie arrière (' + arriere.length + ' tracés)');
  assert.ok(devant(gab).length > 0, 'et une partie avant');

  // L'aller-retour garde les deux, chacune dans SON rouleau.
  const inj = Variante.injecter(defs, { type: BANANE, paths: gab, coiffureRef: 8 });
  const copie = Variante.exporter(defs, BANANE, inj.variante, 8);
  assert.strictEqual(copie.filter((p) => p.avant === false).length, arriere.length,
    'la copie porte autant de tracés derrière');
  assert.strictEqual(devant(copie).length, devant(gab).length, 'et autant devant');

  // ET les variantes d'époque gardent leur arrière : le rouleau arrière de la
  // casquette n'a qu'UNE image, partagée par ses trente-huit variantes. La
  // rallonger avec des images vides les aurait toutes dépouillées — on comble
  // donc avec une copie de l'état où elles se bornent.
  const d2 = await lire('famille0.swf');
  const avantInj = Variante.exporter(d2, CASQUETTE, 0, 8).filter((p) => p.avant === false).length;
  Variante.injecter(d2, {
    type: CASQUETTE, coiffureRef: 8, index: 45,
    paths: [{ d: 'M10 10h5v5h-5Z', fill: 'rgb(1,2,3)', m: [1, 0, 0, 1, 0, 0], avant: false }],
  });
  assert.strictEqual(Variante.exporter(d2, CASQUETTE, 0, 8).filter((p) => p.avant === false).length,
    avantInj, 'la variante 0 garde exactement l\'arrière qu\'elle avait');
});

test('la teinte d\'une POSE fait partie du dessin, pas de la couleur du joueur', async () => {
  // Le casque-mouche (type 5) est un dessin BLANC que sa pose verdit : une
  // transformation de couleur portée par le placement, pas par les niveaux du
  // joueur. L'exportateur ne lisait que la couleur brute de la forme — il rendait
  // au graphiste un gabarit blanc là où le jeu montre du vert.
  const defs = await lire('famille0.swf');
  const gab = Variante.exporter(defs, 5, 0, 8);
  const vert = gab.filter((p) => {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(p.fill || '');
    return m && +m[2] > +m[1] + 20 && +m[2] > +m[3] + 20;
  });
  assert.ok(vert.length > 0, 'le gabarit porte le vert que la pose applique');

  // Et il revient tel quel : la teinte est DANS le dessin, donc dans la copie.
  const inj = Variante.injecter(defs, { type: 5, paths: gab, coiffureRef: 8 });
  const copie = Variante.exporter(defs, 5, inj.variante, 8);
  assert.deepStrictEqual(copie.map((p) => p.fill), gab.map((p) => p.fill),
    'la copie porte exactement les mêmes couleurs');
});

test('le SECOND rouleau d\'un accessoire ne déteint pas sur les variantes ajoutées', async () => {
  // Le bonnet de bain (type 2) a DEUX rouleaux : `acc` et, par-dessus, `acc2`
  // qui ne compte que deux images — un bandeau rose apparaissant en variante 1.
  // Une variante ajoutée au-delà s'y BORNAIT : elle héritait du bandeau sans
  // l'avoir demandé, et l'aperçu de l'atelier ne le montrait pas.
  const BONNET = 2;
  const defs = await lire('famille0.swf');
  const r = Variante.repere(defs, BONNET, 8);
  assert.ok(r.reels.length > 1, 'le type 2 a bien un rouleau compagnon');

  const bandeau = Variante.exporter(defs, BONNET, 1, 8).filter((p) => p.reel === 'acc2');
  assert.ok(bandeau.length > 0, 'la variante 1 porte le bandeau dans `acc2`');

  const inj = Variante.injecter(defs, {
    type: BONNET, coiffureRef: 8, index: r.variantes,
    paths: [{ d: 'M10 10h20v20h-20Z', fill: 'rgb(255,255,255)', slot: 1, m: [1, 0, 0, 1, 0, 0] }],
  });
  const neuve = Variante.exporter(defs, BONNET, inj.variante, 8);
  assert.strictEqual(neuve.filter((p) => p.reel === 'acc2').length, 0,
    'la variante neuve ne montre QUE ce qu\'on lui a donné');
  assert.strictEqual(neuve.length, 1, 'un tracé demandé, un tracé rendu');

  // Et les variantes d'époque gardent leur bandeau.
  assert.strictEqual(Variante.exporter(defs, BONNET, 1, 8).filter((p) => p.reel === 'acc2').length,
    bandeau.length, 'la variante 1 garde le sien');
});

test('un MASQUE D\'ÉCRÊTAGE se transporte, découpe comprise', async () => {
  // Deux variantes d'époque en portent un (la casquette 25 et le type 16
  // variante 1). Sauter le masque emportait avec lui ce qu'il rogne — les plumes
  // bleues du type 16 ; l'ignorer laissait la lueur rouge du micro s'étaler sur
  // tout le visage.
  const defs = await lire('famille0.swf');
  const gab = Variante.exporter(defs, 16, 1, 8);
  const tracé = gab.filter((p) => p.estDecoupe);
  const rogné = gab.filter((p) => p.decoupe && !p.estDecoupe);
  assert.ok(tracé.length > 0, 'le gabarit porte le tracé du masque');
  assert.ok(rogné.length > 0, 'et ce qu\'il rogne');
  // Le tracé du masque vient AVANT ce qu'il rogne : l'injection en dépend.
  assert.ok(gab.indexOf(tracé[0]) < gab.indexOf(rogné[0]), 'le masque précède sa découpe');

  const inj = Variante.injecter(defs, { type: 16, paths: gab, coiffureRef: 8 });
  const copie = Variante.exporter(defs, 16, inj.variante, 8);
  assert.strictEqual(copie.filter((p) => p.estDecoupe).length, tracé.length,
    'la copie repose le masque');
  assert.strictEqual(copie.filter((p) => p.decoupe && !p.estDecoupe).length, rogné.length,
    'et tout ce qu\'il rogne');
});

test('le MARQUEUR d\'atelier ne fait pas un gabarit', async () => {
  // La dernière image de presque tous les rouleaux est un carré opaque de la
  // taille de la scène — un repère de montage. Le rendu le saute déjà ; l'export
  // le prenait pour un dessin et rendait un gabarit entièrement rempli.
  const defs = await lire('famille0.swf');
  const r = Variante.repere(defs, CASQUETTE, 8);
  const derniere = devant(Variante.exporter(defs, CASQUETTE, r.variantes - 1, 8));
  assert.strictEqual(derniere.length, 0, 'la dernière image ne donne aucun tracé devant');
  assert.ok(!Variante.dessinee(defs, CASQUETTE, r.variantes - 1, 8), 'et ne compte pas pour une variante');
  assert.ok(Variante.dessinee(defs, CASQUETTE, 0, 8), 'la variante 0, elle, est bien dessinée');
});

test('les identifiants du gabarit sont UNIQUES — un doublon coûtait le niveau 1', async () => {
  /*
   * Un niveau de couleur revient souvent à deux endroits de la pile : le niveau 1
   * presque toujours (une fois derrière la tête, une fois devant). On écrivait
   * alors deux fois `id="couleur1"` — ce qu'un document XML n'autorise pas.
   * Illustrator tranchait : il gardait le premier, celui de l'ARRIÈRE, et rendait
   * le groupe de devant sans nom. Au retour, tout le devant du niveau 1 revenait
   * en couleur FIXE, en gris. Le niveau 1 seulement, jamais les autres — parce
   * que c'est lui que les deux couches partagent.
   *
   * (La lecture, elle, se vérifie en navigateur : elle demande DOMParser et
   * getCTM. Ce test tient le côté qui produit.)
   */
  const defs = await lire('famille0.swf');
  const soucis = [];
  let gabarits = 0;
  for (let type = 1; type <= 16; type++) {
    const r = Variante.repere(defs, type, 8);
    if (!r) continue;
    for (let v = 0; v < r.variantes; v++) {
      if (!Variante.dessinee(defs, type, v, 8)) continue;
      gabarits++;
      const svg = Variante.exporterSVG(defs, { type, variante: v, coiffure: 8 });
      const ids = (svg.match(/ id="([^"]+)"/g) || []).map((s) => s.slice(5, -1));
      const vus = new Set(), doubles = new Set();
      for (const id of ids) { if (vus.has(id)) doubles.add(id); vus.add(id); }
      if (doubles.size) soucis.push(`type ${type} v${v} : ${[...doubles].join(', ')}`);
    }
  }
  assert.ok(gabarits > 100, 'on a bien passé tous les gabarits en revue (' + gabarits + ')');
  assert.deepStrictEqual(soucis, [], 'aucun identifiant en double');

  // Et le nom d'un niveau qui revient reste LISIBLE comme ce niveau : le lecteur
  // n'en regarde que le début, donc « couleur1-2 » vaut « couleur1 ».
  const svg = Variante.exporterSVG(defs, { type: CASQUETTE, variante: 0, coiffure: 8 });
  const niveaux = (svg.match(/ id="(couleur[^"]*)"/g) || []).map((s) => s.slice(5, -1));
  assert.ok(niveaux.length > 1, 'la casquette porte le niveau 1 des deux côtés');
  assert.strictEqual(niveaux[0], 'couleur1', 'le premier garde le nom simple');
  for (const n of niveaux) {
    assert.match(n, /^couleur[123]/, 'un nom de niveau commence par son niveau : ' + n);
  }
});
