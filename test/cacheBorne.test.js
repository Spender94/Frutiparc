'use strict';
/*
 * LE CACHE D'IMAGES BORNÉ (cacheBorne.js).
 *
 * Les caches d'images du serveur ne se vidaient jamais : le forum seul (330 Mo
 * en base) suffisait à remplir l'instance de 512 Mo. On vérifie ici le budget,
 * l'ordre de sortie, le refus des grosses images, et que server.js n'a plus
 * aucun cache d'images sans borne.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CacheBorne, moEnv } = require('../cacheBorne.js');

const img = (n) => ({ mime: 'image/png', buf: Buffer.alloc(n) });

test('le budget tient : les moins récemment servies sortent', () => {
  const c = new CacheBorne({ nom: 't', maxOctets: 300, maxElement: 200 });
  c.set('a', img(100)).set('b', img(100)).set('c', img(100));
  assert.strictEqual(c.stats().octets, 300);
  c.get('a');                       // a redevient la plus récente
  c.set('d', img(100));             // b, la plus ancienne, sort
  assert.ok(c.has('a') && c.has('c') && c.has('d'));
  assert.ok(!c.has('b'));
  assert.strictEqual(c.stats().octets, 300);
  assert.strictEqual(c.stats().sortis, 1);
});

test('une image plus grosse que le plafond n\'entre pas', () => {
  const c = new CacheBorne({ maxOctets: 1000, maxElement: 200 });
  c.set('grosse', img(201));
  assert.strictEqual(c.get('grosse'), undefined);
  assert.strictEqual(c.size, 0);
  assert.strictEqual(c.stats().refusés, 1);
  c.set('petite', img(200));
  assert.strictEqual(c.get('petite').buf.length, 200);
});

test('remplacer ou retirer une image recompte les octets', () => {
  const c = new CacheBorne({ maxOctets: 1000 });
  c.set('a', img(100));
  c.set('a', img(300));
  assert.strictEqual(c.stats().octets, 300);
  assert.strictEqual(c.size, 1);
  assert.strictEqual(c.delete('a'), true);
  assert.strictEqual(c.delete('a'), false);
  assert.strictEqual(c.stats().octets, 0);
});

test('les lectures et les ratés sont comptés', () => {
  const c = new CacheBorne({ maxOctets: 1000 });
  c.set('a', img(10));
  c.get('a'); c.get('a'); c.get('x');
  assert.strictEqual(c.stats().lus, 2);
  assert.strictEqual(c.stats().ratés, 1);
});

test('mille images de 3 Mo ne dépassent jamais le budget', () => {
  const c = new CacheBorne({ maxOctets: 24 * 1024 * 1024, maxElement: 4 * 1024 * 1024 });
  const buf = Buffer.alloc(3 * 1024 * 1024);
  for (let i = 0; i < 1000; i++) c.set('i' + i, { mime: 'image/jpeg', buf });
  assert.ok(c.stats().octets <= 24 * 1024 * 1024);
  assert.strictEqual(c.size, 8);
});

test('le budget se règle par l\'environnement, en Mo', () => {
  process.env.TEST_CACHE_MO = '2';
  assert.strictEqual(moEnv('TEST_CACHE_MO', 5), 2 * 1024 * 1024);
  delete process.env.TEST_CACHE_MO;
  assert.strictEqual(moEnv('TEST_CACHE_MO', 5), 5 * 1024 * 1024);
});

test('server.js : plus aucun cache d\'images sans borne', () => {
  const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const noms = ['forumImageCache', 'customPictoImageCache', 'shopAssetImageCache', 'wallpaperImageCache', 'quizImageCache'];
  for (const n of noms) {
    assert.match(SRV, new RegExp(`const ${n} = new CacheBorne\\(`), n + ' doit être borné');
    assert.doesNotMatch(SRV, new RegExp(`const ${n} = new Map\\(`), n + ' ne doit plus être une Map');
  }
  assert.match(SRV, /app\.get\('\/api\/admin\/memoire', adminAuth/, 'l\'indicateur de mémoire de l\'admin');
});
