'use strict';
/*
 * LA CADENCE DES BOUILLES — celle du parc, pas celle du fichier.
 *
 * « Les animations des émotes sont souvent trop rapides. Le gum est joué
 * trop vite par exemple. » Les pellicules de bouille se déclarent à 40
 * images par seconde, mais Flash jouait tout SWF chargé à la cadence de sa
 * racine : root.swf, box.swf (le chat), interface.swf — 24 images par
 * seconde, relevé dans leurs en-têtes. Un gum de 120 images y durait cinq
 * secondes ; lu à 40, il n'en durait que trois.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
require(path.join(ROOT, 'public/js/bouille-avm.js'));
const M = require(path.join(ROOT, 'public/js/bouille-moteur.js'));

// La cadence déclarée dans l'en-tête d'un SWF (après le RECT de la scène).
function cadenceDe(fichier) {
  const b = fs.readFileSync(path.join(ROOT, fichier));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then((buf) => {
    const u = new Uint8Array(buf);
    const nb = u[0] >> 3;
    const oct = Math.ceil((5 + 4 * nb) / 8);
    return u[oct + 1] + u[oct] / 256;
  });
}

test('les racines du parc tournent à 24 images par seconde, les bouilles se déclarent à 40', async () => {
  for (const f of ['public/swf/lib/root.swf', 'public/swf/lib/box.swf', 'public/swf/lib/interface.swf']) {
    assert.strictEqual(await cadenceDe(f), 24, f);
  }
  assert.strictEqual(await cadenceDe('public/fbouille/famille0.swf'), 40);
  assert.strictEqual(await cadenceDe('public/fbouille/famille14.swf'), 40);
});

test('le lecteur lit à la cadence du parc — 24 — quoi que dise la pellicule', () => {
  assert.strictEqual(M.CADENCE_PARC, 24);
  const src = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');
  assert.match(src, /this\.cadence = options\.cadence \|\| CADENCE_PARC;/, 'la cadence du fichier n’est plus lue');
  assert.match(src, /const pas = 1000 \/ this\.cadence;/, 'et c’est elle qui rythme la boucle');
});
