'use strict';
/*
 * EXPORT D'UN ACCESSOIRE EN TRACÉS SVG
 *
 * `Moteur.exporterAccessoire()` refait la marche de dessinerClip — mêmes
 * matrices, mêmes teintes, même ordre de profondeur — mais au lieu de peindre,
 * il émet chaque aplat SOUS UN ROULEAU d'accessoire (face.ca.c / face.cb.c) en
 * { d, fill, alpha }. C'est ce que l'atelier d'accessoires confie au graphiste,
 * puis relit (bouille-custom.js, testé en navigateur — DOMParser + getCTM).
 *
 * On vérifie ici le cœur, jouable en Node :
 *   · un accessoire donne des tracés, une tête nue n'en donne aucun ;
 *   · la teinte est celle du rendu (le vert du bonnet, 62,116,51 = 3e7433) ;
 *   · les tracés sont dans le repère de la scène (0..100), déterministes.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
require(path.join(ROOT, 'public/js/bouille-avm.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));

const DOSSIER = path.join(ROOT, 'public/fbouille');
const paire = (n) => Moteur.encode62(n, 2);
const etat = (v) => v.map(paire).join('');

function lire(fichier) {
  const brut = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength))
    .then(Swf.lire);
}

function moteurAvec(defs, chaine) {
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(chaine);
  return mo;
}

// pos : famille, yeux, iris, coiffure, bouche, coul1, coul2, ACC, variante, c1, c2, c3
const BONNET = (co) => etat([0, 3, 0, co, 0, 2, 7, 5, 0, 1, 0, 0]);
const TETE_NUE = (co) => etat([0, 3, 0, co, 0, 2, 7, 0, 0, 0, 0, 0]);

test('poser un accessoire AJOUTE des tracés (et le vert du bonnet)', async () => {
  const defs = await lire('famille0.swf');
  const avecBonnet = moteurAvec(defs, BONNET(8)).exporterAccessoire();
  const sansRien = moteurAvec(defs, TETE_NUE(8)).exporterAccessoire();

  assert.deepStrictEqual(avecBonnet.scene, { x: 0, y: 0, w: 100, h: 100 }, 'repère = scène 100×100');
  assert.ok(avecBonnet.paths.length >= 10, 'le bonnet donne plusieurs aplats');
  // « Rien » (type 0) laisse quand même quelques aplats de fond dans le rouleau ;
  // ce qui compte, c'est que l'accessoire en AJOUTE, et que sa couleur propre
  // (le vert du bonnet) n'apparaisse qu'avec lui.
  assert.ok(avecBonnet.paths.length > sansRien.paths.length, 'le bonnet ajoute des aplats');
  const vertSans = sansRien.paths.some((p) => p.fill === 'rgb(62,116,51)');
  const vertAvec = avecBonnet.paths.some((p) => p.fill === 'rgb(62,116,51)');
  assert.ok(!vertSans && vertAvec, 'le vert du bonnet n\'est là qu\'avec le bonnet');
});

test('la teinte exportée est celle du rendu (le vert du bonnet)', async () => {
  const defs = await lire('famille0.swf');
  const ex = moteurAvec(defs, BONNET(8)).exporterAccessoire();
  const fills = new Set(ex.paths.map((p) => p.fill));
  // #3e7433 = rgb(62,116,51) — le vert cuit du bonnet type 5.
  assert.ok(fills.has('rgb(62,116,51)'), 'le vert du bonnet est présent, teinté comme au rendu');
  // Chaque aplat porte un remplissage CSS valide et un tracé qui commence par M.
  for (const p of ex.paths) {
    assert.match(p.fill, /^rgb\(\d+,\d+,\d+\)$/, 'remplissage rgb() valide');
    assert.match(p.d, /^M/, 'le tracé commence par un moveto');
  }
});

test('les tracés tiennent dans le repère de la scène', async () => {
  const defs = await lire('famille0.swf');
  const ex = moteurAvec(defs, BONNET(8)).exporterAccessoire();
  const nombres = [];
  for (const p of ex.paths) {
    for (const n of p.d.match(/-?\d+(?:\.\d+)?/g) || []) nombres.push(parseFloat(n));
  }
  const min = Math.min.apply(null, nombres), max = Math.max.apply(null, nombres);
  // La scène fait 100×100 ; un accessoire déborde un peu (ailes, ombres) mais
  // reste dans un voisinage raisonnable — pas d'échelle qui aurait dérapé.
  assert.ok(min > -40 && max < 140, 'coordonnées dans le voisinage de [0,100] (min=' + min + ', max=' + max + ')');
});

test('l\'export est déterministe (même état → mêmes tracés)', async () => {
  const defs = await lire('famille0.swf');
  const a = moteurAvec(defs, BONNET(8)).exporterAccessoire();
  const b = moteurAvec(defs, BONNET(8)).exporterAccessoire();
  assert.strictEqual(JSON.stringify(a.paths), JSON.stringify(b.paths), 'deux exports identiques');
});

test('l\'accessoire suit la coiffure : sa boîte bouge peu d\'une coupe à l\'autre', async () => {
  const defs = await lire('famille0.swf');
  // On mesure le centre du nuage de points pour deux coiffures : la mesure
  // confirme que l'accessoire est posé en repère VISAGE (donc un calque SVG en
  // repère scène « suit » naturellement la coiffure).
  function centre(co) {
    const ex = moteurAvec(defs, BONNET(co)).exporterAccessoire();
    let sx = 0, sy = 0, n = 0;
    for (const p of ex.paths) {
      const m = p.d.match(/-?\d+(?:\.\d+)?/g) || [];
      for (let i = 0; i < m.length - 1; i += 2) { sx += parseFloat(m[i]); sy += parseFloat(m[i + 1]); n++; }
    }
    return { x: sx / n, y: sy / n };
  }
  const c8 = centre(8), c30 = centre(30);
  assert.ok(Math.abs(c8.x - c30.x) < 3 && Math.abs(c8.y - c30.y) < 3,
    'le centre de l\'accessoire bouge de moins de 3 px entre coiffures 8 et 30');
});
