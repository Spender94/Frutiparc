/*
 * LE LECTEUR PARTAGÉ — L'HORLOGE N'AVANCE QUE PAR LES PAS.
 *
 * Burning Kiwi chronomètre ses courses avec getTimer(), et multiplie toute sa
 * physique par `gtmod`, lu sur cette même horloge. Dans le lecteur partagé,
 * getTimer() rend `horloge`, une horloge VIRTUELLE que la boucle fait avancer
 * de vingt-cinq millisecondes à chaque pas. Tant qu'elle n'avance que par les
 * pas, la simulation est la même sur toutes les machines — celle d'un lecteur
 * Flash à quarante images par seconde, bit pour bit.
 *
 * La boucle bornait le rattrapage à trois pas par image et SAUTAIT le reste :
 * l'horloge avançait alors sans pas. Dans la page du bureau ou du light, où le
 * jeu partage son fil avec le chat et les bouilles animées, une image qui
 * tarde de plus de cent millisecondes n'a rien de rare, et à chaque saut le
 * chrono courait pendant que la voiture restait en place — toujours dans le
 * même sens, celui de tours plus longs (+0,15 à +0,2 s par tour, mesuré au
 * pilote automatique avec un fil occupé 90 ms toutes les 200 ms).
 *
 * On rattrape désormais tout le retard jusqu'à 500 ms. Au-delà, c'est un
 * onglet qu'on a quitté : là seulement, le temps passe sans pas.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Un requestAnimationFrame que le test fait battre à la main, avec les
// horodatages qu'il choisit.
const file = [];
globalThis.requestAnimationFrame = (f) => { file.push(f); return file.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.DOMMatrix = class { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
globalThis.document = { createElement: () => ({ getContext: () => null }) };
globalThis.window = undefined;
require(path.join(ROOT, 'public/kaluga/moteur/formes.js'));
require(path.join(ROOT, 'public/kaluga/moteur/flash.js'));
const K = globalThis.KalugaMoteur;

// Une scène nue : on ne passe pas par le constructeur (il veut un canevas),
// on pose les seuls champs que la boucle regarde.
function scene() {
  const s = Object.create(K.Scene.prototype);
  s.periode = 25; s.horloge = 0; s.accumule = 0; s.tPrecedent = null; s.actif = false;
  s.pas = 0; s.images = 0;
  s.tick = () => { s.pas++; };
  s.rendre = () => { s.images++; };
  K.Key = K.Key || { toutRelacher() {} };
  return s;
}
// Fait battre la boucle aux instants donnés (ms).
function battre(s, instants) {
  file.length = 0;
  s.demarrer();
  for (const t of instants) { const f = file.shift(); f(t); }
}

test('à soixante images par seconde, quarante pas par seconde, et l’horloge suit les pas', () => {
  const s = scene();
  const instants = []; for (let i = 0; i <= 60; i++) instants.push(i * 1000 / 60);
  battre(s, instants);
  assert.strictEqual(s.pas, 40);
  assert.strictEqual(s.horloge, 40 * 25, 'l’horloge = les pas × 25 ms');
});

test('une image qui tarde de 130 ms est RATTRAPÉE : cinq pas, pas trois et un saut', () => {
  const s = scene();
  battre(s, [0, 16.7, 33.3, 50, 180]);        // la dernière arrive 130 ms après
  // 180 ms écoulés → 7 pas au total (le reste attend la prochaine image).
  assert.strictEqual(s.pas, 7);
  assert.strictEqual(s.horloge, 7 * 25, 'aucune milliseconde passée sans pas');
  assert.strictEqual(s.accumule, 5, 'le reliquat est gardé, pas jeté');
});

test('un retard de 400 ms se rattrape encore en une image', () => {
  const s = scene();
  battre(s, [0, 25, 425]);
  assert.strictEqual(s.pas, 17);
  assert.strictEqual(s.horloge, 17 * 25);
});

test('au-delà de 500 ms — l’onglet quitté — le temps passe : on rattrape 500 ms et on laisse le reste', () => {
  const s = scene();
  battre(s, [0, 25, 3025]);                     // trois secondes d'absence
  // 25 ms puis un rattrapage borné à 500 ms : 21 pas ; l'horloge ne saute pas
  // les trois secondes (elles sont perdues, comme les images qu'un lecteur
  // Flash ne rejoue pas après un onglet quitté).
  assert.strictEqual(s.pas, 21);
  assert.strictEqual(s.horloge, 21 * 25);
});

test('le rendu n’a lieu que quand un pas a eu lieu', () => {
  const s = scene();
  battre(s, [0, 10, 20, 30]);                   // 30 ms : un seul pas
  assert.strictEqual(s.pas, 1);
  assert.strictEqual(s.images, 1);
});
