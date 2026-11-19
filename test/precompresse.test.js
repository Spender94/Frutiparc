'use strict';
/*
 * LES FICHIERS PRÉ-COMPRESSÉS SONT LES MÊMES QUE CEUX D'EXPRESS.STATIC.
 *
 * precompresse.js sert le .gz préparé d'un fichier à la place de la
 * compression à la volée (mémoire native du serveur). Rien ne doit changer
 * pour le navigateur : même contenu une fois décompressé, même ETag (son cache
 * reste valable), 304, Range et clients sans gzip laissés à express.static,
 * rien hors de la racine.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'precomp-'));
process.env.PRECOMP_DIR = path.join(TMP, 'cache');
const RACINE = path.join(TMP, 'public');
fs.mkdirSync(path.join(RACINE, 'js'), { recursive: true });
const GROS = 'console.log("Frutiparc");\n'.repeat(400);
fs.writeFileSync(path.join(RACINE, 'js', 'gros.js'), GROS);
fs.writeFileSync(path.join(RACINE, 'petit.css'), 'a{}');
fs.writeFileSync(path.join(RACINE, 'image.png'), Buffer.alloc(4096, 1));
fs.writeFileSync(path.join(TMP, 'secret.js'), GROS);

const express = require('express');
const precompresse = require('../precompresse');
const app = express();
app.use(precompresse(RACINE));
app.use(express.static(RACINE));
let base;
const serveur = app.listen(0);
test.before(() => new Promise((ok) => serveur.on('listening', () => { base = 'http://127.0.0.1:' + serveur.address().port; ok(); })));
test.after(() => { serveur.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

function get(url, entetes = {}) {
  return new Promise((ok, ko) => {
    http.get(base + url, { headers: entetes }, (res) => {
      const morceaux = [];
      res.on('data', (m) => morceaux.push(m));
      res.on('end', () => ok({ statut: res.statusCode, h: res.headers, corps: Buffer.concat(morceaux) }));
    }).on('error', ko);
  });
}
const GZ = { 'accept-encoding': 'gzip' };
const attendre = async (cond) => { for (let i = 0; i < 100 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 20)); };

test('1re requête par express.static, puis le .gz préparé, au contenu identique', async () => {
  const brut = await get('/js/gros.js');
  assert.strictEqual(brut.statut, 200);
  const premiere = await get('/js/gros.js', GZ);
  assert.strictEqual(premiere.statut, 200);
  assert.notStrictEqual(premiere.h['content-encoding'], 'gzip', 'pas encore prêt : express.static répond');
  await attendre(() => fs.readdirSync(process.env.PRECOMP_DIR).some((f) => f.endsWith('.gz')));
  const r = await get('/js/gros.js', GZ);
  assert.strictEqual(r.h['content-encoding'], 'gzip');
  assert.strictEqual(Number(r.h['content-length']), r.corps.length);
  assert.strictEqual(zlib.gunzipSync(r.corps).toString(), GROS);
  assert.strictEqual(r.h.etag, brut.h.etag, 'même ETag qu\'express.static : le cache du navigateur reste bon');
  assert.strictEqual(r.h['x-taille-reelle'], String(Buffer.byteLength(GROS)));
  assert.match(r.h['content-type'], /javascript/);
  assert.strictEqual(r.h.vary, 'Accept-Encoding');
});

test('304 quand le navigateur a déjà le fichier', async () => {
  const r = await get('/js/gros.js', GZ);
  const r2 = await get('/js/gros.js', { ...GZ, 'if-none-match': r.h.etag });
  assert.strictEqual(r2.statut, 304);
  assert.strictEqual(r2.corps.length, 0);
});

test('sans gzip, Range, petit fichier, image : la main passe à express.static', async () => {
  const sans = await get('/js/gros.js');
  assert.strictEqual(sans.h['content-encoding'], undefined);
  assert.strictEqual(sans.corps.toString(), GROS);
  const range = await get('/js/gros.js', { ...GZ, range: 'bytes=0-9' });
  assert.strictEqual(range.statut, 206);
  assert.strictEqual(range.corps.toString(), GROS.slice(0, 10));
  assert.strictEqual((await get('/petit.css', GZ)).h['content-encoding'], undefined);
  assert.strictEqual((await get('/image.png', GZ)).h['content-encoding'], undefined);
});

test('un fichier modifié est re-préparé, jamais l\'ancien .gz', async () => {
  const f = path.join(RACINE, 'js', 'gros.js');
  const NOUVEAU = GROS + '// v2\n';
  fs.writeFileSync(f, NOUVEAU);
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  const r = await get('/js/gros.js', GZ);
  const corps = r.h['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.corps).toString() : r.corps.toString();
  assert.strictEqual(corps, NOUVEAU);
});

test('rien hors de la racine', async () => {
  const r = await new Promise((ok) => http.get({ host: '127.0.0.1', port: serveur.address().port, path: '/../secret.js', headers: GZ },
    (res) => { res.resume(); res.on('end', () => ok(res.statusCode)); }));
  assert.notStrictEqual(r, 200);
  const r2 = await get('/%2e%2e/secret.js', GZ);
  assert.notStrictEqual(r2.statut, 200);
});

test('server.js : gzip allégé et pré-compression avant public/ et Ruffle', () => {
  const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(S, /compression\(\{\s*threshold: 1024,\s*windowBits: 13,\s*memLevel: 7,/);
  assert.match(S, /app\.use\(precompresse\(path\.join\(__dirname, 'public'\)\)\);\s*app\.use\(express\.static\(path\.join\(__dirname, 'public'\)/);
  assert.match(S, /app\.use\('\/ruffle', precompresse\(ruffleDir[^\n]*\n\s*app\.use\('\/ruffle', express\.static/);
  const P = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.match(P.scripts.start, /--max-old-space-size=256 server\.js$/);
});
