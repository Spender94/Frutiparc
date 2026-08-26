'use strict';
/*
 * LE BOUILLOSCOPE, RENDU EN JAVASCRIPT
 *
 * La grille des visages existait en trois exemplaires, et aucun n'était bon :
 *
 *   · l'onglet de l'admin posait une IFRAME RUFFLE PAR VIGNETTE — quarante-huit
 *     lecteurs Flash pour quarante-huit têtes de soixante-douze pixels. Relevé :
 *     241 requêtes, 47 secondes avant d'y voir quelque chose, et la deuxième
 *     visite ne va pas plus vite (44 s) : les octets viennent du cache disque,
 *     mais chaque iframe recompile son module WebAssembly ;
 *   · le bureau Frutiz et le light passaient par le cache PNG du serveur —
 *     20 Ko la vignette, soit ~960 Ko pour la grille, MAIS à condition que le
 *     cache soit chaud, et le remplir demandait encore Ruffle (une iframe
 *     cachée, une capture, un aller-retour serveur, une écriture en base).
 *
 * Désormais les trois passent par FPBouilleVignette : le moteur JS lit le SWF
 * de famille d'époque et dessine dans un canevas. Relevé sur les mêmes
 * quarante-huit : 662 Ko de SWF en 8 requêtes, les vignettes visibles en
 * 850 ms, et plus rien à demander au serveur.
 *
 * Ce que ce fichier garde : que les trois grilles sont bien branchées, que le
 * cache PNG reste disponible pour tout ce qui n'a pas basculé, et que la
 * vignette est PARESSEUSE et IMMOBILE — quarante-huit têtes qui scintillent à
 * quarante images par seconde ne valent pas le courant dépensé.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const VIGNETTE = lire('public/js/bouille-vignette.js');
const ADMIN = lire('public/admin.html');
const LIGHT = lire('public/light.html');
const BUREAU = lire('public/ruffle.html');

/** Le module, chargé dans un faux navigateur. */
function charger() {
  const observes = [];
  const global = {
    FPBouilleSwf: { charger: (url) => Promise.resolve({ url }) },
    FPBouilleMoteur: {
      familleDe: (s) => (s.charCodeAt(0) - 48) * 62 + (s.charCodeAt(1) - 48),
      Bouille: function () { this.arreter = () => {}; },
    },
    IntersectionObserver: function (f) {
      this.observe = (c) => observes.push(c);
      this.unobserve = () => {};
    },
    document: { querySelectorAll: () => [] },
  };
  vm.createContext(global);
  vm.runInContext(VIGNETTE, global);
  return { api: global.FPBouilleVignette, observes };
}

test('la vignette est un canevas qui remplit sa boîte', () => {
  const { api } = charger();
  const h = api.html('0002010602030900');
  assert.match(h, /^<canvas class="fp-bvig"/);
  assert.match(h, /data-s="0002010602030900\d{8}"/, 'l’état est complété à 24 caractères');
  assert.match(h, /data-e="0"/);
  assert.match(h, /width:100%;height:100%/);
  // Pas de fond : c'est ce qui remplace le détourage du cache PNG, dont le
  // carré vert sautait aux yeux dès qu'on posait la vignette ailleurs.
  assert.doesNotMatch(h, /background/);
  // Un état sale est nettoyé — il vient d'un CSV importé à la main.
  assert.match(api.html('00-02/01 06;02'), /data-s="[0-9A-Za-z]{24}"/);
  assert.match(api.html(null), /data-s="0{24}"/);
  assert.match(api.html('0002010602030900000000000000EXTRA'), /data-s="[0-9A-Za-z]{24}"/);
});

test('les vignettes ne se dessinent qu’en approchant de l’écran', () => {
  const { api, observes } = charger();
  const faux = [{ getAttribute: () => '00', isConnected: true, setAttribute: () => {} },
    { getAttribute: () => '00', isConnected: true, setAttribute: () => {} }];
  const hote = { querySelectorAll: (sel) => { assert.strictEqual(sel, 'canvas.fp-bvig'); return faux; } };
  assert.strictEqual(api.brancher(hote), 2);
  assert.deepStrictEqual(observes, faux, 'les deux canevas sont confiés au guetteur');
  // Rebrancher ne les confie pas deux fois.
  api.brancher(hote);
  assert.strictEqual(observes.length, 2);
});

test('les trois Bouilloscopes chargent le moteur et l’utilisent', () => {
  const MODULES = ['/js/bouille-swf.js', '/js/bouille-avm.js',
    '/js/bouille-moteur.js', '/js/bouille-vignette.js'];
  for (const [nom, src] of [['admin', ADMIN], ['light', LIGHT], ['bureau Frutiz', BUREAU]]) {
    let precedent = -1;
    for (const m of MODULES) {
      const i = src.indexOf('src="' + m + '"');
      assert.ok(i > 0, nom + ' charge ' + m);
      assert.ok(i > precedent, nom + ' : ' + m + ' vient après ses dépendances');
      precedent = i;
    }
    assert.ok(src.includes('FPBouilleVignette.html('), nom + ' pose des vignettes JS');
    assert.ok(src.includes('FPBouilleVignette.brancher('), nom + ' les branche après insertion');
  }
});

test('plus une seule iframe Ruffle dans la grille de l’admin', () => {
  // C'était le pire des trois : une iframe /bouille-preview.html par carte.
  const grille = ADMIN.slice(ADMIN.indexOf('box.innerHTML = slice.map'),
    ADMIN.indexOf('async function importTrombinoscope'));
  assert.ok(!grille.includes('bouille-preview.html'), 'la grille n’ouvre plus de lecteur Flash');
  assert.ok(grille.includes('FPBouilleVignette.html('));
});

test('le cache PNG n’est plus lu par personne', () => {
  // Le forum, le club et l'écran du bureau s'en servaient ; ils dessinent
  // maintenant. Plus rien ne LIT /bouille-img : les pages ne chargent même plus
  // le module qui le sondait.
  for (const [nom, src] of [['light', LIGHT], ['bureau Frutiz', BUREAU]]) {
    assert.ok(!src.includes('/js/bouille-thumb.js'), nom + ' ne charge plus bouille-thumb');
  }
  for (const f of ['public/light.html', 'public/club/index.html', 'public/bureau-frutiz.js']) {
    assert.ok(!/FPBouilleThumb\.\w+\(/.test(lire(f)), f + ' ne demande plus de capture');
  }
  // Seule l'admin garde le module : son bouton « Réchauffer les bouilles »
  // remplit encore le cache — au cas où l'on ferait marche arrière. Le bouton
  // dit lui-même que plus personne ne s'en sert.
  assert.ok(ADMIN.includes('/js/bouille-thumb.js'), 'l’admin garde de quoi réchauffer');
  assert.match(ADMIN, /PLUS AUCUNE PAGE NE S'EN SERT/);
});

test('la carte du Bouilloscope mobile accepte un canevas', () => {
  const regle = LIGHT.slice(LIGHT.indexOf('.trombi-card .tb iframe'));
  const fin = regle.indexOf('}');
  assert.ok(regle.slice(0, fin).includes('canvas'),
    'sans cette règle, le canevas ne remplirait pas la case de 72 px');
});

test('deux modes : la vignette POSÉE et la bouille QUI S’ANIME', () => {
  // Une vignette posée ne se dessine qu'une fois : elle se paie le
  // suréchantillonnage ×4 du moteur sans compter. Une bouille qui s'anime
  // redessine quarante fois par seconde : ×2, cinq fois moins cher, et l'œil ne
  // fait pas la différence en mouvement.
  assert.match(VIGNETTE, /anime: anime, super: anime \? 2 : undefined/,
    'la qualité suit le mode');
  assert.match(VIGNETTE, /jouer:/, 'le module sait lancer une animation');
  assert.match(VIGNETTE, /stopper:/, 'et la ramener au repos');
});

test('la réaction du chat ne recharge plus de lecteur', () => {
  // C'était une iframe Ruffle dont on remettait le src à « about:blank » puis à
  // l'URL, pour forcer le rejeu — un lecteur Flash entier par message.
  const bloc = LIGHT.slice(LIGHT.indexOf('function showBouilleOverlay'),
    LIGHT.indexOf('function hideBouilleOverlay'));
  assert.ok(!bloc.includes('about:blank'), 'plus de rechargement d’iframe');
  assert.ok(!bloc.includes('bouille-preview.html'), 'plus de lecteur Flash');
  assert.ok(bloc.includes('overlayJouer('), 'on dit simplement « joue »');
});

test('l’éditeur répond au doigt : plus d’attente de 120 ms', () => {
  // Recharger une iframe Ruffle était assez lent pour qu'il ait fallu attendre
  // que le doigt se calme avant de rendre. Changer d'état, lui, est immédiat.
  const bloc = LIGHT.slice(LIGHT.indexOf('function fbApercu'),
    LIGHT.indexOf('function fbChoix'));
  assert.ok(bloc.includes('FPBouilleVignette.rafraichir('), 'l’aperçu se met à jour sur place');
  assert.ok(!/setTimeout\(fbRenderPreview/.test(LIGHT), 'plus de délai');
  assert.match(bloc, /function fbRenderPreviewSoon\(\) \{ fbRenderPreview\(\); \}/,
    'le nom reste, l’attente disparaît');
});
