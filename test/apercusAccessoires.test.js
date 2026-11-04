'use strict';
/*
 * LES APERÇUS D'ACCESSOIRE DISENT CE QUE LES BOUILLES PORTERONT.
 *
 * « Les previews sur l'atelier ET la boutique sont messed up. » Relevé :
 *
 *   · chaque aperçu montait SA famille à la main — le fichier brut, le
 *     catalogue parfois, sans ses index parfois, jamais les greffes —, là où
 *     le site passe par `famille()` de bouille-vignette.js ;
 *   · le tableau des variantes de l'admin rangeait ses aperçus par RANG dans
 *     le catalogue public, qui compte les variantes purgées quand le tableau
 *     les tait : une purge, et chaque ligne montrait l'accessoire d'à côté ;
 *   · l'admin publiait toujours sur la coiffure de référence 8, quelle que
 *     soit celle du gabarit : sur les types 6, 7, 12 et 13, dont le repère suit
 *     la coiffure, l'accessoire porté tombait à côté de l'aperçu ;
 *   · l'écran de la boutique posait la bouille bord à bord : le bord d'un
 *     chapeau, une visière, la pointe d'un bonnet disparaissaient — les salons,
 *     eux, les montrent entiers (`MARGE_ECRAN`).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lireTexte = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Le décor d'un navigateur, juste ce qu'il faut à bouille-vignette.js : les
// modules du moteur en globales, et un `fetch` qui lit le disque (les SWF) ou
// rend le catalogue qu'on lui donne.
function monterVignette(catalogue) {
  const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
  const M = require(path.join(ROOT, 'public/js/bouille-moteur.js'));
  const V = require(path.join(ROOT, 'public/js/bouille-variante.js'));
  global.FPBouilleSwf = Swf; global.FPBouilleMoteur = M; global.FPBouilleVariante = V;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('/api/light/variantes')) return { ok: true, json: async () => ({ ok: true, liste: catalogue }) };
    const f = path.join(ROOT, 'public', u.split('?')[0]);
    if (!fs.existsSync(f)) return { ok: false, json: async () => null };
    const b = fs.readFileSync(f);
    return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      json: async () => JSON.parse(b.toString('utf8')) };
  };
  delete require.cache[require.resolve(path.join(ROOT, 'public/js/bouille-vignette.js'))];
  require(path.join(ROOT, 'public/js/bouille-vignette.js'));
  return { BV: global.FPBouilleVignette, M, V, Swf };
}

test('familleNeuve : la famille du site — catalogue à ses index —, puis l’essai à sa place', async () => {
  // Un dessin d'époque, repris comme variante publiée à un index LOIN du rouleau.
  const { M, V, Swf } = monterVignette([]);
  const brut = fs.readFileSync(path.join(ROOT, 'public/fbouille/famille0.swf'));
  const defs0 = await Swf.lire(await Swf.decompresser(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength)));
  const rouleau = V.repere(defs0, 3, 8).variantes;
  const dessin = V.exporter(defs0, 3, 1, 8);
  const catalogue = [
    { famille: 0, type: 3, coiffureRef: 8, index: rouleau + 3, paths: dessin, anim: null },
    // Une variante purgée garde sa place : une image vide.
    { famille: 0, type: 3, coiffureRef: 8, index: rouleau + 4, paths: [], retire: true },
    // Celle d'une autre famille ne se glisse pas dans la 0.
    { famille: 12, type: 3, coiffureRef: 8, index: rouleau, paths: dessin },
  ];
  const { BV } = monterVignette(catalogue);
  const r = await BV.familleNeuve(0, [{ type: 3, paths: V.exporter(defs0, 3, 4, 8), coiffureRef: 8 }]);
  assert.ok(V.dessinee(r.defs, 3, rouleau + 3, 8), 'la publiée est à SON index');
  assert.ok(!V.dessinee(r.defs, 3, rouleau, 8), 'le trou avant elle reste vide (pas de variante d’une autre famille)');
  assert.ok(!V.dessinee(r.defs, 3, rouleau + 4, 8), 'la purgée : une image vide');
  assert.strictEqual(r.essais[0].variante, rouleau + 5, 'l’essai tombe après tout le catalogue, comme à la publication');
  assert.ok(V.dessinee(r.defs, 3, rouleau + 5, 8));
  // Une famille NEUVE à chaque appel : les essais ne s'empilent pas.
  const r2 = await BV.familleNeuve(0, [{ type: 3, paths: dessin, coiffureRef: 8 }]);
  assert.strictEqual(r2.essais[0].variante, rouleau + 5);
  assert.notStrictEqual(r2.defs, r.defs);
  // Et la famille partagée de la page n'en a rien vu.
  const partagee = await BV.famille(0);
  assert.ok(!V.dessinee(partagee, 3, rouleau + 5, 8), 'aucun essai dans la famille du site');
  assert.ok(M.CHAUVE_VARIANTE > rouleau + 5);
});

test('le gabarit porte sa coiffure dans le nom du calque de repère', async () => {
  const { V, Swf } = monterVignette([]);
  const brut = fs.readFileSync(path.join(ROOT, 'public/fbouille/famille0.swf'));
  const defs = await Swf.lire(await Swf.decompresser(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength)));
  const svg = V.exporterSVG(defs, { type: 7, variante: 0, coiffure: 20, nom: 'bandeau', fondTete: '' });
  assert.match(svg, /<g id="repere-coiffure-20"/);
  // Le lecteur (navigateur) la relit : début du nom « repere », puis le numéro —
  // y compris sous la forme qu'Illustrator rend (« _x2D_ » pour un tiret).
  const custom = lireTexte('public/js/bouille-custom.js');
  const re = new RegExp(/\/\^repere\\D\*\?\(\\d\{1,2\}\)\\b\/i/.source);
  assert.match(custom, re, 'la lecture de la coiffure');
  const lecture = /^repere\D*?(\d{1,2})\b/i;
  const desechapper = (s) => s.replace(/_x([0-9a-f]{2,4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  assert.strictEqual(Number(lecture.exec('repere-coiffure-20')[1]), 20);
  assert.strictEqual(Number(lecture.exec(desechapper('repere_x2D_coiffure_x2D_7'))[1]), 7);
  assert.strictEqual(lecture.exec('repere'), null, 'un gabarit d’avant : pas de coiffure lue');
  assert.match(custom, /out\.coiffure = coiffureLue/);
});

test('l’admin publie sur la coiffure du gabarit, et ses aperçus suivent le site', () => {
  const admin = lireTexte('public/admin.html');
  assert.match(admin, /coiffureRef: vaCoiffureRef\(\),/, 'la publication');
  assert.match(admin, /FPBouilleVignette\.familleNeuve\(0, \[\{ type: type, paths: paths, anim: vaAnim, coiffureRef: vaCoiffureRef\(\) \}\]\)/,
    'l’aperçu d’import, monté comme le site');
  // Le tableau : par IDENTIFIANT, à l'index de la ligne, par FPBouilleVignette.
  assert.match(admin, /liste\.find\(function \(x\) \{ return x\.id === sp\.getAttribute\('data-id'\); \}\)/);
  assert.doesNotMatch(admin, /index\[i\] = inj\.variante/, 'plus de rangement par rang dans le catalogue public');
  assert.match(admin, /id="pack-preview-canvas"[^>]*data-marge="0\.08"/, 'l’aperçu d’article cadré comme un écran');
});

test('l’atelier montre ses aperçus par le chemin du site, cadrés comme un écran', () => {
  const at = lireTexte('public/bouille-accessoire.html');
  assert.match(at, /<script src="\/js\/bouille-vignette\.js"><\/script>/);
  assert.match(at, /BV\.familleNeuve\(0, \[\{ type: t, paths: paths, anim: anim, coiffureRef: coRef \}\]\)/, 'l’import');
  assert.match(at, /var coRef = \(impLots\[0\] && impLots\[0\]\.coiffure != null\) \? impLots\[0\]\.coiffure : co;/);
  assert.match(at, /if \(v\.index != null\) poserReelle\(\$\("#mai-apercu"\), etatAvec\(v\.type, v\.index, co\)\);/,
    'la reprise d’un accessoire publié : à SON index, dans la famille du site');
  assert.match(at, /var MARGE = \(BV && BV\.MARGE_ECRAN\) \|\| 0;/);
  assert.doesNotMatch(at, /anime: false, alea/, 'plus d’aperçu figé : les accessoires animés tournent, comme sur les bouilles');
});

test('la boutique cadre ses aperçus comme les écrans des salons', () => {
  const light = lireTexte('public/light.html');
  assert.match(light, /function apercuBoutique\(etat\) \{\s*return FPBouilleVignette\.html\(etat \|\| DEFAULT_BOUILLE, \{ marge: FPBouilleVignette\.MARGE_ECRAN \}\);/);
  assert.match(light, /return apercuBoutique\(buildState\(myBase, it\.suffix9, null\)\);/);
});
