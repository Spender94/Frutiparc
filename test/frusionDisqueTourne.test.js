'use strict';
/*
 * LE DISQUE TOURNE TANT QU'IL EST DANS LE LECTEUR.
 *
 * `rotateDisc` (0x990e0) accélère jusqu'à 140, puis :
 *
 *     si sens > 0 et speed > 140 : on arrête, et la jaquette JOUE son
 *         animation de rotation (les anneaux flous du rendu d'époque)
 *
 * Le portage mettait bien `sens` à zéro… et il n'y avait RIEN derrière. Or
 * `battre()` ne redemande une image que si le tiroir bouge ou si `sens` n'est
 * pas nul : la boucle s'arrêtait donc net, et le disque restait FIGÉ sur son
 * dernier angle pendant toute la partie. La classe `file` qu'on lui posait
 * n'avait aucune règle en face.
 *
 * Il file maintenant pour de bon, à la vitesse d'arrivée (140 par image), et
 * `stopDisc` — l'éjection — le remet à zéro.
 *
 * Ce fichier ne relit pas le code : il l'EXÉCUTE. Les trois méthodes sont
 * extraites du fichier livré et posées sur un lecteur en carton.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');

// Le corps d'une méthode `frusion.<nom> = function (…) { … };`, tel qu'il est
// livré. On s'arrête à la ligne « }; » de même indentation que la déclaration.
function methode(nom) {
  const debut = JS.indexOf('  frusion.' + nom + ' = function ');
  assert.ok(debut >= 0, 'méthode introuvable : ' + nom);
  const fin = JS.indexOf('\n  };', debut);
  assert.ok(fin > debut, 'fin de méthode introuvable : ' + nom);
  return JS.slice(debut + ('  frusion.' + nom + ' = ').length, fin + 4);
}

// Un lecteur en carton : ce que les trois méthodes touchent, et rien d'autre.
function lecteur() {
  const images = [];
  const ctx = {
    FR_VMAX: 140,
    requestAnimationFrame: (f) => { images.push(f); return images.length; },
  };
  const frusion = {
    y: 71, cibleY: 71, sens: 0, vitesse: 0, rotation: 0, file: false,
    anim: null, dernier: 0, destin: null,
    disqueEl: { style: {}, classList: { add() {}, remove() {} } },
    moveSlot() {},
  };
  for (const nom of ['battre', 'rotateDisc', 'tournerAVide']) {
    // eslint-disable-next-line no-new-func
    frusion[nom] = new Function('FR_VMAX', 'requestAnimationFrame',
      'return (' + methode(nom) + ');')(ctx.FR_VMAX, ctx.requestAnimationFrame);
  }
  // Avancer de n images, 25 ms chacune (tmod = 1). L'horloge est celle du
  // lecteur, pas celle de l'appel : `requestAnimationFrame` sert un temps qui
  // ne recule jamais, et `battre` calcule `tmod` par différence. Une horloge
  // qui repartirait de zéro à chaque `avancer` fabriquerait un tmod NÉGATIF —
  // un faux mouvement de plusieurs dizaines de milliers de degrés, à mettre
  // au compte du banc d'essai et non du code livré.
  let horloge = 0;
  frusion.avancer = (n) => {
    for (let i = 0; i < n; i++) {
      const f = images.shift();
      if (!f) return i;             // la boucle s'est arrêtée
      horloge += 25;
      f(horloge);
    }
    return n;
  };
  return frusion;
}

test('le disque accélère, puis FILE — la boucle ne s’arrête pas', () => {
  const f = lecteur();
  f.sens = 1;
  f.battre();
  // Vingt images suffisent largement à dépasser 140 (vitesse += tmod par image
  // n'y suffirait pas ; c'est `vitesse += tmod * sens` cumulé qui monte).
  const jouees = f.avancer(400);
  assert.strictEqual(jouees, 400, 'la boucle doit encore tourner après 400 images');
  assert.strictEqual(f.sens, 0, 'à pleine vitesse, `sens` retombe à zéro');
  assert.strictEqual(f.file, true, 'et le disque FILE');
  assert.strictEqual(f.vitesse, 140, 'à la vitesse d’arrivée du bytecode');
});

test('et il tourne vraiment : l’angle change à chaque image', () => {
  const f = lecteur();
  f.sens = 1;
  f.battre();
  f.avancer(300);                       // il file
  assert.strictEqual(f.file, true);
  const a = f.rotation;
  f.avancer(1);
  const b = f.rotation;
  assert.notStrictEqual(a, b, 'l’angle doit bouger');
  // 140 par image, replié dans un tour : l'angle DÉCROÎT de 140, et remonte
  // de 360 quand il passerait sous le tour complet. Modulo 360, c'est le même
  // pas dans les deux cas : −140 ≡ 220.
  assert.ok(Math.abs(((b - a) % 360 + 360) % 360 - 220) < 1e-9,
    'de 140 degrés par image (relevé : ' + (b - a) + ')');
  // …et il reste dans un tour, sans enfler
  f.avancer(500);
  assert.ok(f.rotation > -360 && f.rotation <= 0, 'borné à un tour : ' + f.rotation);
});

test('AVANT le correctif, la boucle s’arrêtait et l’angle se figeait', () => {
  // On rejoue l'ancienne `battre` — sans la branche `file` — pour montrer que
  // le figeage venait bien de là.
  const f = lecteur();
  const ancienne = methode('battre').replace(/\n\s*\/\/[^\n]*/g, '')
    .replace('else if (self.file) { self.tournerAVide(tmod); encore = true; }', '');
  assert.ok(!/self\.file/.test(ancienne), 'la branche doit avoir sauté');
  // eslint-disable-next-line no-new-func
  f.battre = new Function('FR_VMAX', 'requestAnimationFrame',
    'return (' + ancienne + ');')(140, (fn) => { f._file = f._file || []; f._file.push(fn); return 1; });
  let t = 0;
  f.sens = 1;
  f.battre();
  let n = 0;
  while (f._file && f._file.length && n < 500) { t += 25; f._file.shift()(t); n++; }
  assert.ok(n < 500, 'l’ancienne boucle s’arrêtait — au bout de ' + n + ' images');
  const fige = f.rotation;
  assert.strictEqual(f.sens, 0);
  assert.strictEqual(fige, f.rotation, 'et l’angle ne bougeait plus');
});

test('l’éjection remet le disque à plat', () => {
  assert.match(JS, /this\.sens = 0;\s*\n\s*this\.vitesse = 0;\s*\n\s*this\.file = false;/);
  // …et un disque qu'on dépose repart de zéro
  assert.match(JS, /this\.disqueEl\.classList\.remove\('file'\);\s*\n\s*this\.file = false;/);
});
