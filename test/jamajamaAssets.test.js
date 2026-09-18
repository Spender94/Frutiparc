/*
 * JamaJama — les assets portés face au fichier (Games/poulpi/game.swf).
 *
 * Chaque clip exporté du SWF doit se retrouver dans le manifeste avec SES
 * étiquettes et SON nombre d'images — celui de l'en-tête DefineSprite, pas
 * celui de la dernière image dessinée : la flamme (jama_fx_Fire) et le fruit
 * (jama_Fruit) finissent sur une image VIDE, que la photographie du
 * manifeste ne retient pas. Sans `longueur`, Rendu.longueur() rendait 15 et
 * 22 au lieu de 16 et 23, et les effets mouraient une image trop tôt ; et
 * une image vide se dessinait comme la précédente au lieu de rien.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const Swf = require(path.join(RACINE, 'public/js/bouille-swf.js'));
const MANIFESTE = JSON.parse(fs.readFileSync(path.join(RACINE, 'public/jamajama/sprites/sprites.json'), 'utf8'));

async function lireJeu() {
  const b = fs.readFileSync(path.join(RACINE, 'Games/poulpi/game.swf'));
  return Swf.lire(await Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
}

test('chaque clip exporté du SWF est dans le manifeste, avec ses étiquettes et son nombre d’images', async () => {
  const jeu = await lireJeu();
  const manquants = [];
  const ecarts = [];
  let compares = 0;
  for (const [nom, id] of jeu.exports) {
    const sp = jeu.sprites.get(id);
    if (!sp) continue;                               // une forme, une fonte…
    // Les clips qui ne portent que du code (les classes AS2, `code`,
    // `importer`) n'ont rien à dessiner.
    if (sp.images.every((img) => img.every((o) => o.t === 'script'))) continue;
    const s = MANIFESTE.symboles[nom];
    if (!s) { manquants.push(nom); continue; }
    compares++;
    const etiquettes = s.etiquettes || {};
    for (const [label, frame] of Object.entries(sp.labels || {})) {
      if (etiquettes[label] !== frame) ecarts.push(`${nom}: étiquette ${label} ${etiquettes[label]} ≠ ${frame}`);
    }
    if (sp.n > 1) {
      const longueur = s.longueur || (s.etats.length ? s.etats[s.etats.length - 1].frame : 1);
      if (longueur !== sp.n) ecarts.push(`${nom}: ${longueur} images au lieu de ${sp.n}`);
    }
  }
  assert.deepStrictEqual(manquants, [], 'clips exportés absents du manifeste');
  assert.deepStrictEqual(ecarts, [], 'étiquettes ou longueurs en écart');
  assert.ok(compares >= 75, `seulement ${compares} clips comparés`);
});

test('la flamme et le fruit gardent leur dernière image, vide', async () => {
  const jeu = await lireJeu();
  for (const [nom, attendu] of [['jama_fx_Fire', 16], ['jama_Fruit', 23]]) {
    const sp = jeu.sprites.get(jeu.exports.get(nom));
    assert.strictEqual(sp.n, attendu, `${nom} dans le fichier`);
    const s = MANIFESTE.symboles[nom];
    assert.strictEqual(s.longueur, attendu, `${nom} dans le manifeste`);
    // …et cette dernière image n'a pas d'état : elle est vide.
    assert.strictEqual(s.etats[s.etats.length - 1].frame, attendu - 1);
  }
  // La flamme tourne d'elle-même sur ses 16 images, image vide comprise.
  assert.strictEqual(MANIFESTE.symboles.jama_fx_Fire.anime, 16);
});

// rendu.js dans un bac à sable : juste ce qu'il faut de DOM pour charger().
function chargerRendu() {
  const noop = () => {};
  const element = () => ({ textContent: '', appendChild: noop, addEventListener: noop, getContext: () => null, width: 0, height: 0 });
  const contexte = {
    console,
    document: { createElement: element, head: { appendChild: noop }, fonts: { load: () => Promise.resolve() } },
    Image: function () { const img = { set src(v) { setTimeout(() => img.onload && img.onload(), 0); } }; return img; },
    fetch: (url) => Promise.resolve({ json: () => Promise.resolve(url.endsWith('sprites.json') ? MANIFESTE : {}) }),
    encodeURIComponent, setTimeout, Promise, Map, Object, Math,
  };
  contexte.window = contexte;
  vm.createContext(contexte);
  vm.runInContext(fs.readFileSync(path.join(RACINE, 'public/jamajama/rendu.js'), 'utf8'), contexte, { filename: 'rendu.js' });
  return contexte.JamaRendu.charger('').then(() => contexte.JamaRendu);
}

test('Rendu.longueur() rend le nombre d’images du fichier, et une image vide ne dessine rien', async () => {
  const Rendu = await chargerRendu();
  assert.strictEqual(Rendu.longueur('jama_fx_Fire'), 16);
  assert.strictEqual(Rendu.longueur('jama_Fruit'), 23);
  assert.strictEqual(Rendu.longueur('jama_fx_cocon'), 20);
  const feu = MANIFESTE.symboles.jama_fx_Fire;
  assert.strictEqual(Rendu.etatDe(feu, 15).frame, 15, 'l’avant-dernière image se dessine');
  assert.strictEqual(Rendu.etatDe(feu, 16).pieces.length, 0, 'la dernière image, vide, ne dessine rien');
  const fruit = MANIFESTE.symboles.jama_Fruit;
  assert.strictEqual(Rendu.etatDe(fruit, 23).pieces.length, 0, 'le fruit brûlé a disparu');
  assert.strictEqual(Rendu.etatDe(fruit, 22).frame, 22);
  assert.strictEqual(Rendu.etatDe(fruit, 'burn').frame, 11, 'les étiquettes se lisent toujours');
  // Au-delà du fichier, Flash s'arrête sur la dernière image : on la garde.
  assert.strictEqual(Rendu.etatDe(fruit, 40).frame, 22);
  // Une image sans état propre AVANT la fin, sur un clip que le fichier ne
  // photographie pas plus finement, reste sur le dernier état connu.
  const sortie = MANIFESTE.symboles.jama_Exit;
  assert.strictEqual(Rendu.etatDe(sortie, 36).frame, 36);
  assert.strictEqual(Rendu.etatDe(sortie, 37).pieces.length, 0, 'l’image d’arrêt de la sortie sud est vide');
});

test('l’extracteur lit le nombre d’images dans l’en-tête DefineSprite', () => {
  const src = fs.readFileSync(path.join(RACINE, 'scripts/extract-jamajama-sprites.js'), 'utf8');
  assert.match(src, /if \(code !== 39\) return;[\s\S]{0,200}readUInt16LE\(corps \+ 2\)/);
  assert.match(src, /entree\.longueur = longueur/);
});
