'use strict';
/*
 * MINI-PIXIZ — LE LOT DE RETOURS DE CYID (laser, étoiles, pause floue, curseurs).
 *
 * « Les tirs Théo Laser sont invisibles » ; « ma fée a utilisé Dactylo, les
 * étoiles violettes n'étaient pas visibles » ; « après un alt-tab le jeu était
 * devenu tout flou » ; « elle s'obstine à lancer des spells que j'ai mis à 0 ».
 *
 * Les deux premiers viennent de la même règle mal lue. Sous Flash, un clip à
 * plusieurs images JOUE — sauf s'il porte lui-même un `stop()`. Relevé dans
 * Games/miniTroll/swf/root.swf :
 *   · shotLightBeam a cinq images et un stop() sur la CINQUIÈME : le laser
 *     grandit puis se tient. Le portage le tenait sur sa première image, un
 *     trait d'un tiers de pixel ;
 *   · partLightStar a neuf images et un stop() sur la PREMIÈRE — l'étoile
 *     violette ; les huit autres sont son éclat de fin. Le portage la faisait
 *     jouer, et au bout de neuf pas elle restait sur un halo blanc.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));
const L = require(path.join(ROOT, 'public/minipixiz/lieux.js'));
const P = require(path.join(ROOT, 'public/minipixiz/plateforme.js'));
const C = require(path.join(ROOT, 'public/minipixiz/combat.js'));

const graine = (n) => () => { n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648; };

// Une fée qui sait le Théo laser (21) et la Dactylo (2), dans un donjon.
function donjon() {
  const c = P.carteNeuve();
  const f = F.genererGraine(graine(7));
  f.$carac = [2, 2, 6, 5, 3, 5];
  f.$life = 6; f.$mana = 10; f.$hunger = 20; f.$moral = 10;
  f.$mission = null; f.$pos = null; f.$mood = [];
  f.$spell = [20, 21, 2, 0];
  c.$faerie = [f]; c.$current = 0;
  c.$key = 5; c.$dungeon = { $lvl: 0, $f: true, $day: 0 };
  const lieu = new L.Donjon({ carte: c, graine: 7, fee: f, surEvenement: () => {} });
  return { lieu, champ: lieu.champ, fee: lieu.champ.faerieList[0], f };
}

// Les scripts d'image d'un clip exporté de root.swf : { image: hex }.
async function scriptsDe(nom) {
  const b = fs.readFileSync(path.join(ROOT, 'Games/miniTroll/swf/root.swf'));
  const d = Swf.lire(await Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  const sp = d.sprites.get(d.exports.get(nom));
  const out = { n: sp.n, scripts: {} };
  sp.images.forEach((im, i) => im.forEach((o) => { if (o.t === 'script') out.scripts[i + 1] = Buffer.from(o.code).toString('hex'); }));
  return out;
}

test('root.swf : le laser s’arrête sur sa dernière image, l’étoile sur la première', async () => {
  const laser = await scriptsDe('shotLightBeam');
  assert.strictEqual(laser.n, 5);
  assert.strictEqual(laser.scripts[5], '0700', 'stop() à l’image 5');
  const etoile = await scriptsDe('partLightStar');
  assert.strictEqual(etoile.n, 9);
  assert.strictEqual(etoile.scripts[1], '0700', 'stop() à l’image 1 : l’étoile violette');
  // Et les tables du portage le disent.
  assert.strictEqual(C.IMAGES.shotLightBeam, 5);
  assert.ok(C.ARRETS_AU_DEBUT.has('partLightStar'));
});

test('le Théo laser grandit sur cinq images au lieu de rester un trait d’un tiers de pixel', () => {
  const { champ, fee } = donjon();
  const laser = fee.tirList.find((t) => t.sid === 21);
  assert.ok(laser, 'la fée a le Théo laser');
  laser.tirer();
  const t = champ.shotList[0];
  assert.strictEqual(t.lien, 'shotLightBeam');
  assert.strictEqual(t.joue, true, 'le clip joue');
  const images = [];
  for (let i = 0; i < 6; i++) { images.push(t.frame + Math.floor(t.age)); champ.update(1); }
  assert.deepStrictEqual(images, [1, 2, 3, 4, 5, 6], 'une image par pas — au-delà de 5, poserVif tient la dernière');
  // La cinquième image est vingt-quatre pixels de long, la première un tiers.
  const sprites = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  const beam = (sprites.clips || sprites.sprites || sprites).shotLightBeam.etats;
  assert.ok(beam[0].pieces[0].m[0] < 0.01, 'image 1 : quasi rien');
  assert.ok(beam[4].pieces[0].m[0] > 0.2, 'image 5 : le rayon entier');
});

test('les étoiles de la Dactylo restent violettes : le clip ne joue pas de lui-même', () => {
  const { lieu, champ, fee } = donjon();
  const dac = fee.sortList.find((s) => s.sid === 2);
  assert.ok(dac, 'la fée a la Dactylo');
  dac.ranger();
  for (let i = 0; i < 15; i++) { champ.update(1); try { lieu.jeu.update(1); } catch (e) { /* le puzzle peut attendre */ } }
  const etoiles = champ.partList.filter((p) => p.lien === 'partLightStar');
  assert.strictEqual(etoiles.length, 3, 'trois étoiles (concentration 3)');
  for (const p of etoiles) {
    assert.strictEqual(p.joue, false, 'figée sur son image 1');
    assert.strictEqual(p.frame + (p.joue ? Math.floor(p.age) : 0), 1, 'l’étoile violette, pas l’éclat');
    assert.strictEqual(p.sa, 100); assert.strictEqual(p.sx, 100);
  }
});

test('un sort dont le curseur est à zéro ne se lance plus', () => {
  const { fee, f } = donjon();
  fee.jeu.flAide = true;
  const avec = fee.listeDeSorts().map((e) => e.sort.sid);
  assert.ok(avec.includes(2), 'la Dactylo est pertinente ici : ' + avec.join(','));
  f.$spellCoef = []; f.$spellCoef[2] = 0;          // Ornegon : curseur tout à gauche
  const sans = fee.listeDeSorts().map((e) => e.sort.sid);
  assert.ok(!sans.includes(2), 'à zéro, elle sort de la liste : ' + sans.join(','));
  f.$spellCoef[2] = 20;                              // tout à droite
  const fond = fee.listeDeSorts();
  assert.strictEqual(fond[0].sort.sid, 2, 'à fond, elle passe en tête');
});

test('la bande du panneau de pause porte sa consigne', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /const PAUSE_CONSIGNE = 'Appuyez sur P pour continuer';/);
  assert.match(src, /ctx\.fillText\(PAUSE_CONSIGNE, 117\.35, 128\.5\);/, 'centrée dans la bande (x 42…193, y 123…134)');
  // La bande est bien là, dans le dessin du panneau : le rectangle #938dc3.
  const svg = fs.readFileSync(path.join(ROOT, 'public/minipixiz/sprites/shape1051.svg'), 'utf8');
  assert.match(svg, /fill="#938dc3"/);
});

test('le jeu se remesure au retour au premier plan, et jamais sur un cadre caché', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /new ResizeObserver\(\(\) => this\.redimensionner\(\)\)\.observe\(parent\)/);
  assert.match(src, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(!document\.hidden\) this\.redimensionner\(\); \}\);/);
  assert.match(src, /window\.addEventListener\('focus', \(\) => this\.redimensionner\(\)\);/);
  assert.match(src, /if \(document\.hidden \|\| !parent\.clientWidth \|\| !parent\.clientHeight\) return;/);
});
