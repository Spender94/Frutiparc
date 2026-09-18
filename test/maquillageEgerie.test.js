'use strict';
/*
 * LE MAQUILLAGE D'EGERIE, EN VARIANTE D'ACCESSOIRE
 *
 * « Récupérer le make-up (lèvres + yeux + sourcils) et voir dans quelle mesure
 * on peut le mettre en boutique + le customiser (comme on le fait pour les
 * accessoires). »
 *
 * Le maquillage de la famille 14 est dessiné DANS les yeux et la bouche
 * d'Egerie ; scripts/extract-maquillage-egerie.js en détache le fard, les
 * cils, les sourcils et les lèvres, et les livre au format d'une VARIANTE des
 * lunettes — le circuit de la boutique : injection dans le rouleau, chaîne de
 * 24 caractères, article suffix9 aux couleurs de l'admin.
 *
 * Ce que ce test tient :
 *   · le PAQUET — huit aplats, deux niveaux de couleur (lèvres, fard), les
 *     cils et sourcils en noir fixe, tous devant (les lunettes n'ont pas de
 *     couche arrière : un tracé « arrière » s'y perdrait sans un mot) ;
 *   · la RÉCOLTE est reproductible — relancer le script rend le même paquet ;
 *   · l'INJECTION — la variante prend un index dans le rouleau des lunettes,
 *     ressort avec ses huit tracés dans l'ordre, et la chaîne d'état la monte
 *     avec ses deux niveaux teintés par la palette ;
 *   · les DEUX PORTES — le bouton de l'admin et l'encart 6 de l'atelier
 *     servent bien ce paquet-là.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
require(path.join(ROOT, 'public/js/bouille-avm.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));
const Variante = require(path.join(ROOT, 'public/js/bouille-variante.js'));

const DOSSIER = path.join(ROOT, 'public/fbouille');
const PAQUET = path.join(DOSSIER, 'maquillage-egerie.json');
const LUNETTES = 10;                  // le type porteur, dans bouille-palette.js

function lire(fichier) {
  const brut = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength))
    .then(Swf.lire);
}
const paquet = () => JSON.parse(fs.readFileSync(PAQUET, 'utf8'));

test('le paquet : huit aplats, lèvres au niveau 1, fard au niveau 2, le reste en noir', () => {
  const paq = paquet();
  assert.strictEqual(paq.type, LUNETTES, 'porté par les lunettes, l\'accessoire du visage');
  assert.strictEqual(paq.nom, 'Maquillage d’Egerie');
  assert.strictEqual(paq.paths.length, 8, 'fard ×2, cils ×2, sourcils ×2, lèvres + reflet');
  const par = (n) => paq.paths.filter((p) => (p.slot || 0) === n);
  assert.strictEqual(par(1).length, 2, 'les lèvres et leur reflet au niveau 1');
  assert.strictEqual(par(2).length, 2, 'le fard des deux yeux au niveau 2');
  assert.strictEqual(par(0).length, 4, 'cils et sourcils à couleur fixe');
  for (const p of par(0)) assert.strictEqual(p.fill, 'rgb(0,0,0)', 'en noir — la palette n\'en a pas');
  for (const p of par(1).concat(par(2))) {
    assert.match(p.fill, /^rgb\((\d+),\1,\1\)$/, 'une zone recolorable se dessine en gris : ' + p.fill);
  }
  for (const p of paq.paths) {
    assert.match(p.d, /^M/, 'un tracé SVG');
    assert.notStrictEqual(p.avant, false, 'tout devant : les lunettes n\'ont pas de couche arrière');
    assert.ok(p.alpha > 0 && p.alpha <= 1, 'une opacité');
  }
  // Sur le visage, dans le repère de la scène.
  const xs = [], ys = [];
  for (const p of paq.paths) {
    const n = (p.d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    for (let i = 0; i < n.length - 1; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); }
  }
  assert.ok(Math.min(...xs) > 0 && Math.max(...xs) < 100, 'x sur le visage');
  assert.ok(Math.min(...ys) > 30 && Math.max(...ys) < 100, 'y entre les yeux et la bouche');
});

test('la récolte est reproductible : relancer le script rend le même paquet', () => {
  const avant = fs.readFileSync(PAQUET, 'utf8');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/extract-maquillage-egerie.js')], { stdio: 'pipe' });
  assert.strictEqual(fs.readFileSync(PAQUET, 'utf8'), avant, 'le fichier livré est celui que le script produit');
});

test('injecté dans le rouleau des lunettes, il ressort entier et se monte par la chaîne d\'état', async () => {
  const defs = await lire('famille0.swf');
  const paq = paquet();
  const base = Variante.repere(defs, LUNETTES, 8).variantes;
  const inj = Variante.injecter(defs, { type: LUNETTES, paths: paq.paths, coiffureRef: 8 });
  assert.ok(inj, 'injection réussie');
  assert.strictEqual(inj.variante, base, 'la première variante maison prend l\'index suivant');
  assert.ok(inj.variante <= 61, 'un article de boutique code la variante sur un caractère base62');

  const copie = Variante.exporter(defs, LUNETTES, inj.variante, 8).filter((p) => p.avant !== false);
  assert.strictEqual(copie.length, 8, 'les huit tracés ressortent');
  assert.deepStrictEqual(copie.map((p) => p.slot), paq.paths.map((p) => p.slot || 0),
    'chacun à son niveau, dans l\'ordre de peinture');

  const paire = (n) => Moteur.encode62(n, 2);
  // Lèvres rouges (Red 3), fard bleu (Blue 1).
  const etat = [0, 3, 0, 8, 0, 2, 7, LUNETTES, inj.variante, 21, 23, 24].map(paire).join('');
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(etat);
  const enf = (c, nom) => (c ? c.enfantNomme(nom) : null);
  const acc = enf(enf(enf(mo.racine.face, 'ca'), 'c'), 'acc');
  assert.ok(acc, 'la chaîne d\'état monte le maquillage comme un accessoire');
  assert.deepStrictEqual(enf(acc, 'col').teinte, Moteur.PALETTE[21], 'les lèvres prennent la couleur 1');
  assert.deepStrictEqual(enf(acc, 'col2').teinte, Moteur.PALETTE[23], 'le fard prend la couleur 2');
});

test('les deux portes : le bouton de l\'admin et l\'encart 6 de l\'atelier', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(admin, /onclick="vaChargerMaquillage\(\)"/, 'le bouton du formulaire de variante');
  assert.match(admin, /fetch\('\/fbouille\/maquillage-egerie\.json'/, 'qui charge le paquet récolté');
  assert.match(admin, /sel\.value = String\(paq\.type\)/, 'et cale le type porteur');
  const atelier = fs.readFileSync(path.join(ROOT, 'public/bouille-accessoire.html'), 'utf8');
  assert.match(atelier, /<h2>6 · Le maquillage d'Egerie<\/h2>/, 'l\'encart 6');
  assert.match(atelier, /fetch\("\/fbouille\/maquillage-egerie\.json"/, 'même paquet');
  assert.match(atelier, /a\.download = "maquillage-egerie\.svg"/, 'le gabarit SVG à retravailler');
});
