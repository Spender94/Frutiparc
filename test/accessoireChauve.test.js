'use strict';
/*
 * L'ACCESSOIRE « CHAUVE » — il retire la coupe de cheveux, sur toutes les bouilles.
 *
 * Il s'écrit comme un accessoire d'époque : type 0 (« Rien »), variante « ZZ »
 * (3843, hors de tout rouleau). Le moteur JS — qui dessine TOUTES les bouilles
 * du site : salons, fiche, bureau, forum, light — ne garde alors sous `ca.c` et
 * `cb.c` que les rouleaux d'accessoire. Vérifié ici sans navigateur : on monte
 * la bouille, on relève les formes que `dessiner` peint (un faux canevas), et
 * l'on compare la tête coiffée à la tête chauve.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));

function lire(n) {
  const brut = fs.readFileSync(path.join(ROOT, 'public/fbouille/famille' + n + '.swf'));
  return Swf.decompresser(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength)).then(Swf.lire);
}
const p = (n) => Moteur.encode62(n, 2);
// Famille, yeux, iris, coupe, bouche, peau, cheveux (quatorze caractères), le
// premier caractère du type d'accessoire, puis le suffixe de neuf.
const tete = (famille, coupe, suffixe9) => p(famille) + p(2) + p(0) + p(coupe) + p(3) + p(9) + p(14) + '0' + suffixe9;

// Un canevas qui ne peint rien : seules comptent les formes qu'on lui demande.
const fauxCtx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
global.Path2D = global.Path2D || class { addPath() {} moveTo() {} lineTo() {} closePath() {} };

function formesPeintes(defs, etat) {
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(etat);
  const vues = [];
  mo.dessinerForme = (ctx, ch) => { vues.push(ch); };
  mo.accumuler = () => {};
  mo.dessiner(fauxCtx, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return { mo, vues };
}
// Les formes que la coupe pose sous `ca.c` et `cb.c`, rouleaux d'accessoire exclus.
function formesDeCoiffure(mo) {
  const out = new Set();
  const descendre = (clip) => clip.enfants.forEach((e) => {
    if (e.objet) descendre(e.objet); else out.add(e.ch);
  });
  for (const nom of ['ca', 'cb']) {
    const c = mo.racine.face.enfantNomme(nom) && mo.racine.face.enfantNomme(nom).enfantNomme('c');
    if (!c) continue;
    c.enfants.forEach((e) => {
      if (/^acc\d*$/.test(e.nom || '')) return;
      if (e.objet) descendre(e.objet); else out.add(e.ch);
    });
  }
  return out;
}

test('la variante du Chauve est « ZZ », et le serveur l’offre sous ce suffixe', () => {
  assert.strictEqual(Moteur.CHAUVE_VARIANTE, Moteur.decode62('ZZ'));
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /const CHAUVE_SUFFIX9 = '0ZZ000000';/);
  assert.match(src, /\{ u: 'chauve',\s+n: 'Chauve',\s+suffix: CHAUVE_SUFFIX9 \}/, 'dans les accessoires de base, offerts à tous');
  // Une seule liste pour le forum et les préférences : le Chauve y est aussi.
  assert.match(src, /const ACCESSOIRES_DEFAUT = DEFAULT_ACCESSORIES\.map/);
});

test('famille 0 : le Chauve retire toute la coupe et ne touche à rien d’autre', async () => {
  const defs = await lire(0);
  let tondues = 0;
  for (let coupe = 0; coupe < 67; coupe++) {
    const coiffe = formesPeintes(defs, tete(0, coupe, '000000000'));
    const chauve = formesPeintes(defs, tete(0, coupe, '0ZZ000000'));
    assert.strictEqual(coiffe.mo.chauve, false);
    assert.strictEqual(chauve.mo.chauve, true, 'coupe ' + coupe + ' : reconnu');
    const cheveux = formesDeCoiffure(coiffe.mo);
    // Rien de la coupe n'est peint…
    for (const ch of chauve.vues) assert.ok(!cheveux.has(ch), `coupe ${coupe} : la forme #${ch} des cheveux est encore peinte`);
    // … et TOUT le reste l'est, dans le même ordre.
    assert.deepStrictEqual(chauve.vues, coiffe.vues.filter((ch) => !cheveux.has(ch)), 'coupe ' + coupe + ' : le visage intact');
    if (cheveux.size) tondues++;
  }
  assert.ok(tondues >= 60, `la plupart des coupes ont des cheveux à retirer (${tondues})`);
});

test('le Chauve reste chauve pendant une émote, et un accessoire maison se pose encore', async () => {
  const defs = await lire(0);
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5, accessoireCustom: [{ d: 'M10 10h20v20h-20z', fill: '#ff0000' }] });
  mo.creerVisage();
  mo.definir(tete(0, 20, '0ZZ000000'));
  const cheveux = formesDeCoiffure(formesPeintes(defs, tete(0, 20, '000000000')).mo);
  assert.ok(cheveux.size > 0);
  mo.action(2);                                       // « rire » : la tête rejoue sa pellicule
  for (let i = 0; i < 30; i++) mo.avancer ? mo.avancer() : (mo.tick && mo.tick());
  const vues = [];
  mo.dessinerForme = (ctx, ch) => { vues.push(ch); };
  mo.accumuler = () => {};
  mo.dessiner(fauxCtx, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  for (const ch of vues) assert.ok(!cheveux.has(ch), 'pendant le rire, la forme #' + ch + ' des cheveux revient');
  assert.ok(vues.length > 5, 'le visage se peint toujours');
});

test('une autre famille (le ninja, 12) : la coupe tombe, le bandeau d’accessoire reste', async () => {
  const defs = await lire(12);
  const coiffe = formesPeintes(defs, tete(12, 2, '000000000'));
  const chauve = formesPeintes(defs, tete(12, 2, '0ZZ000000'));
  const cheveux = formesDeCoiffure(coiffe.mo);
  for (const ch of chauve.vues) assert.ok(!cheveux.has(ch));
  assert.ok(chauve.vues.length < coiffe.vues.length, 'moins de formes : les cheveux sont partis');
  assert.ok(chauve.vues.length > 0);
});

test('les clients : le SWF n’est pas touché, et les rendus passent tous par le moteur', () => {
  // Le type « Rien » n'a aucun rouleau d'accessoire sous `c` : la variante y est
  // sans effet pour un lecteur Flash, qui montre la bouille coiffée.
  const src = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');
  assert.match(src, /this\.chauve = accId === 0 && accSecId === CHAUVE_VARIANTE;/);
  assert.match(src, /const tondre = this\.chauve && sousCoiffure\(clip\);/);
});
