'use strict';
/*
 * LES JAQUETTES DE « MES DISQUES »
 *
 * Un FD du bureau, c'est deux couches : l'ANNEAU (le boîtier, une image par
 * `discType` — noir, gris, blanc, rouge…) et la JAQUETTE (le dessin du jeu).
 * `but.Icon.display` les choisit ainsi (~0x4ec64) :
 *
 *     ico.disc.gotoAndStop(desc[0]);          // l'anneau
 *     ico.disc.label.gotoAndStop(desc[1]);    // la bande des jaquettes
 *     ico.disc.label.gfx.stop();              // le clip de la jaquette
 *
 * Ce troisième appel est la clé. Chaque image de la bande pose un clip nommé
 * `gfx`, et ce clip a deux ou trois images :
 *
 *     image 1  →  Stop                                  ← le RECTO, le dessin
 *     image 2  →  setProperty("", _rotation, random(360))
 *     image 3  →  gotoAndPlay(1)                        ← retour au Stop
 *
 * Les images 2-3 portent un AUTRE bitmap : le VERSO BRILLANT du disque, celui
 * qu'une rotation au hasard fait tourner. Rien ne les montre.
 *
 * CE QUI N'ALLAIT PAS. L'extracteur descendait dans `gfx` avec le NUMÉRO
 * D'IMAGE DE LA BANDE. Pour la plupart des jeux ce numéro dépasse le compte
 * d'images du clip et l'aplatisseur retombe sur la première — le bon dessin,
 * par chance. Mais Kaluga est à l'image 2 de la bande et son aperçu à
 * l'image 3 : ces numéros-là EXISTENT dans le clip, et c'est le verso brillant
 * qui sortait. Deux disques vierges dans « Mes disques ».
 *
 * ET LE BANDEAU « DEMO ». Les clips de Mini-Wave (#64) et de MiniPixiz (#80)
 * portent un sous-clip nommé `demo` dont l'image 1 dit :
 *
 *     setProperty("", _visible, _parent._parent._currentframe > 60)
 *
 * `_parent._parent`, c'est la BANDE : le bandeau ne se montre que sur ses
 * images de fin — miniwaved (61) et minipixizd (62). Le portage le posait sur
 * les deux, et le disque Mini-Wave du commerce (image 11) portait un DEMO
 * qu'il n'a pas.
 *
 * Trois fichiers changent, et trois seulement : kaluga, kalugaPreview,
 * miniwave. Les quatorze autres sont identiques au geste près.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const SPRITES = path.join(ROOT, 'public/frutiz/sprites');
const EXTRACTEUR = fs.readFileSync(path.join(ROOT, 'scripts/extract-frutiz-explorer.js'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');

const fichier = (nom) => path.join(SPRITES, 'disc_jaquette_' + nom + '.svg');
// L'empreinte d'une jaquette : le condensé de son fichier. Deux dessins
// différents donnent deux empreintes différentes, et deux étiquettes qui
// visent le même clip donnent la même — c'est tout ce qu'on demande ici.
const empreinte = (nom) => require('node:crypto')
  .createHash('sha1').update(fs.readFileSync(fichier(nom))).digest('hex');
// Le nombre de COUCHES : l'extracteur écrit un `<g transform=…>` par morceau,
// et le bandeau DEMO en est un de plus.
const couches = (nom) =>
  (fs.readFileSync(fichier(nom), 'utf8').match(/<g transform=/g) || []).length;

test('l’extracteur descend dans la jaquette à son image 1, pas à celle de la bande', () => {
  assert.match(EXTRACTEUR, /const dedans = \(swf\.parSprite\.get\(p\.ch\) \|\| new Map\(\)\)\.get\(1\);/);
  assert.match(EXTRACTEUR, /morceaux\.push\(\.\.\.swf\.aplatir\(q\.ch, swf\.composer\(M, q\.M\), 0, 1, '',/);
  // L'ancien appel — celui qui passait le numéro d'image de la bande — a disparu.
  assert.doesNotMatch(EXTRACTEUR, /swf\.aplatir\(bandeJaquettes\.ch, bandeJaquettes\.M, 0, f\)/);
});

test('le bandeau DEMO ne sort que sur les images de fin de bande', () => {
  assert.match(EXTRACTEUR, /if \(q\.nom === 'demo' && f <= 60\) continue;/);
});

test('Kaluga montre son dessin, pas le verso brillant', () => {
  // Le verso, c'est celui que les images 2-3 du clip posent — et le clip de
  // Kaluga (#25) est le SEUL dont la bande atteint ces numéros. On vérifie que
  // la jaquette sortie n'est plus la même que celle du verso : le bitmap #23
  // (verso) contre le #21 (recto).
  const kaluga = empreinte('kaluga');
  assert.strictEqual(kaluga, empreinte('kalugaPreview'),
    'les deux étiquettes visent le MÊME clip (#25) : le dessin est le même');
  // Kaluga ne partage son dessin avec personne d'autre. Deux étiquettes qui
  // visent le même clip, ça arrive (swapou2 et mele) ; deux VERSOS identiques,
  // non — c'est le symptôme qu'on chasse.
  const tous = ['bandas', 'bkiwi', 'grapiz', 'jama', 'mb2', 'minipixiz', 'miniwave',
    'snake', 'swapou2', 'tower', 'tuberculoz', 'minifever'];
  for (const n of tous) {
    assert.notStrictEqual(kaluga, empreinte(n), 'kaluga a le dessin de ' + n);
  }
  // `swapou2` et `mele` visent le clip #38 tous les deux : c'est le SWF qui le
  // dit, et le portage le suit.
  assert.strictEqual(empreinte('swapou2'), empreinte('mele'));
});

test('Mini-Wave n’a plus le bandeau DEMO ; sa version light l’a', () => {
  assert.notStrictEqual(empreinte('miniwave'), empreinte('miniwaved'),
    'les deux jaquettes doivent différer');
  // Le bandeau est une couche EN PLUS.
  assert.strictEqual(couches('miniwave'), 1);
  assert.strictEqual(couches('miniwaved'), 2);
  // MiniPixiz suit la même règle, et l'a toujours suivie (#74 n'a pas de
  // sous-clip `demo`, #80 en a un).
  assert.strictEqual(couches('minipixiz'), 1);
  assert.strictEqual(couches('minipixizd'), 2);
});

test('chaque disque du catalogue trouve sa jaquette', () => {
  // `desc[1]` vaut `disc.iconName || disc.swfName` côté serveur ; la table du
  // bureau doit couvrir tout ce qui en sort.
  const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const deb = SERVEUR.indexOf('const GAME_DISCS = {');
  const bloc = SERVEUR.slice(deb, SERVEUR.indexOf('\n};', deb));
  const noms = new Set();
  for (const m of bloc.matchAll(/^\s{2}[A-Za-z0-9_]+:\s*\{([\s\S]*?)\n  \},/gm)) {
    const ic = /iconName: '([^']*)'/.exec(m[1]);
    const sw = /swfName: '([^']*)'/.exec(m[1]);
    noms.add((ic && ic[1]) || (sw && sw[1]));
  }
  assert.ok(noms.size >= 10, 'le catalogue des disques est introuvable');
  const table = JS.slice(JS.indexOf('var JAQUETTES = {'), JS.indexOf('function dessinDisque'));
  for (const n of noms) {
    if (!n) continue;
    assert.ok(table.includes(n + ':') || table.includes(n.toLowerCase() + ':'),
      'aucune jaquette pour « ' + n + ' »');
  }
});

test('les cinq anneaux sont là, un par discType', () => {
  for (let t = 0; t <= 4; t++) {
    assert.ok(fs.existsSync(path.join(SPRITES, 'disc_anneau_' + t + '.svg')),
      'disc_anneau_' + t + '.svg manque');
  }
  assert.match(JS, /anneau\.src = '\/frutiz\/sprites\/disc_anneau_' \+ \(Number\(type\) \|\| 0\) \+ '\.svg';/);
});

test('fileIcon.swf n’est pas retouché : tout vient de sa lecture', () => {
  const swf = fs.readFileSync(path.join(ROOT, 'public/fileIcon.swf'));
  assert.strictEqual(swf.slice(0, 3).toString('ascii'), 'CWS');
  // Et la bande des jaquettes y a bien ses soixante-huit images.
  const b = zlib.inflateSync(swf.slice(8));
  assert.ok(b.length > 10000);
});
