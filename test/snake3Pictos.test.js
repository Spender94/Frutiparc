'use strict';
/*
 * FRUTISNAKE — LE NUMÉRO DES PICTOS DE FRUITS POURRIS.
 *
 * Les fruits vont de 1 à 300, les pourris de 321 à 342 ; les 322 images de
 * pictos, elles, se suivent sans trou (Const.TXT_FRUIT_NAME retire 20 aux
 * identifiants ≥ 320). « Fruit 321 » — le premier pourri, qu'on avale dès la
 * première partie — s'affichait avec l'image n° 321, l'avant-dernière : la
 * collection semblait achevée, et la galerie sautait de 300 à 321.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3681;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '',
      XMLSOCKET_PORT: '5681', FRUTISCORE_PORT: '5682' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const gif = (n) => fs.readFileSync(path.join(ROOT, 'Games/snake3/gif', 'snakeFruit' + String(n).padStart(4, '0') + '.gif'));
const picto = async (nom) => Buffer.from(await (await fetch(BASE + '/api/picto/' + encodeURIComponent(nom))).arrayBuffer());

test('« Fruit 321 » (premier pourri) a l’image n° 301, « Fruit 342 » la n° 322', async () => {
  assert.ok((await picto('Fruit 300')).equals(gif(300)), 'les 300 fruits gardent leur image');
  assert.ok((await picto('Fruit 321')).equals(gif(301)), 'le premier pourri : image 301');
  assert.ok((await picto('Fruit 322')).equals(gif(302)));
  assert.ok((await picto('Fruit 342')).equals(gif(322)), 'le dernier pourri : la dernière image');
  assert.ok(!(await picto('Fruit 321')).equals(gif(321)), 'plus l’avant-dernière image');
});

test('le nom affiché suit le même numéro, sans trou entre 300 et 301', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const f = /function numeroPictoSnake\(id\) \{[\s\S]*?\n\}/.exec(src)[0];
  const numero = new Function(f + '; return numeroPictoSnake;')();
  assert.deepStrictEqual([1, 300, 321, 322, 342].map(numero), [1, 300, 301, 302, 322]);
  assert.match(src, /if \(snakeMatch\) return `Fruit \$\{numeroPictoSnake\(snakeMatch\[1\]\)\}`;/);
  // Et le dénominateur de la consécration reste 322 : 300 fruits + 22 pourris.
  assert.match(src, /matchGame: 'Frutisnake',[\s\S]{0,200}totalPictos: 322/);
});
