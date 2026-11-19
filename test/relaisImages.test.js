'use strict';
/*
 * LE RELAIS DES IMAGES DU CHAT : UN TÉLÉCHARGEMENT PAR IMAGE, POUR TOUT LE SALON.
 *
 * « Certains joueurs ne voient pas l'image de /img » : chaque joueur du salon
 * faisait télécharger l'image par le serveur, dans la même seconde, et
 * l'hébergeur (miniatures Google Images) refusait la rafale. Voir
 * relaisImages.js.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { creerRelaisImages } = require('../relaisImages');
const { CacheBorne } = require('../cacheBorne');

const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const URL_IMG = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc&s=10';

function reponse(status, type, corps) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : (k.toLowerCase() === 'content-length' ? String(corps.length) : null)) },
    arrayBuffer: async () => corps.buffer.slice(corps.byteOffset, corps.byteOffset + corps.length),
  };
}
// Un hébergeur qui, comme Google, n'accepte qu'une demande à la fois : les
// suivantes, pendant qu'une est en cours, reçoivent 429.
function hebergeurQuiLimite() {
  let enCours = 0;
  const h = { appels: 0 };
  h.fetchFn = async () => {
    h.appels++;
    if (enCours > 0) return reponse(429, 'text/html', Buffer.from('trop'));
    enCours++;
    await new Promise((r) => setTimeout(r, 20));
    enCours--;
    return reponse(200, 'image/jpeg', JPEG);
  };
  return h;
}
const sansJournal = () => {};

test('dix joueurs en même temps : un seul téléchargement, dix images', async () => {
  const h = hebergeurQuiLimite();
  const relais = creerRelaisImages({ fetchFn: h.fetchFn, cache: new CacheBorne({ maxOctets: 1e6 }), journal: sansJournal });
  const r = await Promise.all(Array.from({ length: 10 }, () => relais.obtenir(URL_IMG)));
  assert.ok(r.every((x) => x.ok && x.buf.equals(JPEG) && x.type === 'image/jpeg'), 'tout le salon voit l\'image');
  assert.strictEqual(h.appels, 1);
  assert.strictEqual(relais.compteurs.regroupes, 9);
});

test('ce qui se passait avant : sans regroupement, la rafale est refusée', async () => {
  const h = hebergeurQuiLimite();
  const r = await Promise.all(Array.from({ length: 10 }, () => h.fetchFn(URL_IMG)));
  assert.strictEqual(r.filter((x) => x.ok).length, 1, 'un seul joueur aurait vu l\'image');
});

test('le joueur qui arrive après se sert dans le cache', async () => {
  const h = hebergeurQuiLimite();
  const relais = creerRelaisImages({ fetchFn: h.fetchFn, cache: new CacheBorne({ maxOctets: 1e6 }), journal: sansJournal });
  await relais.obtenir(URL_IMG);
  const r = await relais.obtenir(URL_IMG);
  assert.ok(r.ok);
  assert.strictEqual(h.appels, 1);
  assert.strictEqual(relais.compteurs.depuisCache, 1);
});

test('un échec passager (429, 5xx, réseau) est retenté une fois, et journalisé s\'il persiste', async () => {
  let n = 0;
  const lignes = [];
  const relais = creerRelaisImages({
    fetchFn: async () => (++n === 1 ? reponse(429, 'text/html', Buffer.from('x')) : reponse(200, 'image/png', JPEG)),
    pauseMs: 0, journal: (m) => lignes.push(m),
  });
  assert.ok((await relais.obtenir(URL_IMG)).ok);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(lignes, []);

  const relais2 = creerRelaisImages({
    fetchFn: async () => { throw new Error('ECONNRESET'); }, pauseMs: 0, journal: (m) => lignes.push(m),
  });
  const r = await relais2.obtenir(URL_IMG);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 502);
  assert.strictEqual(relais2.compteurs.reessais, 1);
  assert.match(lignes[0], /^\[IMGPROXY\] échec encrypted-tbn0\.gstatic\.com : réseau/);
});

test('un refus définitif (404, pas une image, trop lourde) n\'est pas retenté ni gardé', async () => {
  for (const [rep, status] of [
    [reponse(404, 'text/html', Buffer.from('x')), 502],
    [reponse(200, 'text/html', Buffer.from('<html>')), 415],
    [reponse(200, 'image/png', Buffer.alloc(6 * 1024 * 1024)), 413],
  ]) {
    let n = 0;
    const cache = new CacheBorne({ maxOctets: 1e8 });
    const relais = creerRelaisImages({ fetchFn: async () => { n++; return rep; }, cache, pauseMs: 0, journal: sansJournal });
    const r = await relais.obtenir(URL_IMG);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, status);
    assert.strictEqual(n, 1, 'pas de nouvel essai');
    assert.strictEqual(cache.size, 0);
  }
});

test('le délai dépassé est un échec passager, retenté puis journalisé', async () => {
  const lignes = [];
  const relais = creerRelaisImages({
    fetchFn: (u, o) => new Promise((ok, ko) => o.signal.addEventListener('abort', () => ko(new Error('aborted')))),
    delaiMs: 10, pauseMs: 0, journal: (m) => lignes.push(m),
  });
  const r = await relais.obtenir(URL_IMG);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(relais.compteurs.reessais, 1);
  assert.match(lignes[0], /délai dépassé/);
});

test('les redirections restent refusées (sécurité)', async () => {
  let options;
  const relais = creerRelaisImages({ fetchFn: async (u, o) => { options = o; return reponse(200, 'image/jpeg', JPEG); } });
  await relais.obtenir(URL_IMG);
  assert.strictEqual(options.redirect, 'error');
});

test('server.js passe par le relais, garde les garde-fous, et l\'admin voit le cache', () => {
  const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = S.slice(S.indexOf("app.get('/api/imgproxy'"), S.indexOf("app.get('/api/imgproxy'") + 900);
  assert.match(route, /isPrivateHost\(parsed\.hostname\)[\s\S]*relaisImages\.obtenir\(parsed\.toString\(\)\)/);
  assert.match(S, /const imageCaches = \(\) => \[[^\]]*chatImageCache\]/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8'), /'images du chat': 'Images partagées dans les salons \(\/img\)'/);
});

test('Light : une seconde tentative avant « [image indisponible] »', () => {
  const L = fs.readFileSync(path.join(__dirname, '..', 'public', 'light.html'), 'utf8');
  assert.match(L, /if \(!reessayee && \/\^\\\/api\\\/imgproxy\\\?\/\.test\(o\.url\)\) \{\s*reessayee = true;\s*setTimeout\(function \(\) \{ img\.src = o\.url \+ "&r=2"; \}, 2500\);/);
});
