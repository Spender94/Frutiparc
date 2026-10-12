/*
 * MOTIONBALL — DEUX RETOURS DE JOUEURS.
 *
 * A. « Quelques ralentissements dans les salles spéciales balle violette
 *    (bumpers invisibles). » Le bumper invisible (bshadow, sprite 821) est
 *    le seul bumper en pur vecteur : dix remplissages et neuf coutures par
 *    bumper, dessinés à chaque image dès que la bille violette le voit
 *    (Collide.bumper_shadow_on_update). Dans une salle qui en compte quinze
 *    ou seize, le rendu doublait. Le portage le dessine désormais depuis un
 *    cache raster par remplissage (niveau.js, « Le bumper invisible se
 *    dessine depuis un cache raster ») — même matrice, même phase
 *    sous-pixel, même ordre et même alpha que le dessin direct. Ici, sans
 *    navigateur : un document et des canevas bouchons enregistrent ce que
 *    le clip demande au contexte.
 *
 * B. « Certains pictos (eau et air) du mode aventure sont mélangés. » Le
 *    mapping boss → picto du portage est celui de la source : donjon n →
 *    élément n+1 (EAU 1, FEU 2, VENT 3, TERRE 4 — BossSerpent.as), picto
 *    $symb[n] puis écaille $eca[n] (TItems.as : « 0 : eau, 1 : feu, 2 :
 *    air, 3 : terre »). Le serpent d'eau est teinté vers le bleu, celui du
 *    vent vers le vert (les transformations de couleur de snakePart dans le
 *    SWF) ; la table des pictos du serveur nomme pourtant $eca0 « Écaille
 *    verte » et $eca2 « Écaille bleue » — c'est l'inversion rapportée. Elle
 *    est constatée ici (DIVERGENCES_CONNUES) sans être corrigée : server.js
 *    n'est pas du ressort du portage.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Le moteur (sans DOM) puis les classes du jeu, dans l'ordre de la page.
globalThis.window = undefined;
for (const f of ['public/kaluga/moteur/formes.js', 'public/kaluga/moteur/flash.js', 'public/kaluga/moteur/texte.js',
  'public/mb2/jeu/scripts-images.js', 'public/mb2/jeu/base.js', 'public/mb2/jeu/niveau.js', 'public/mb2/jeu/balle.js',
  'public/mb2/jeu/boss.js', 'public/mb2/jeu/ecrans.js', 'public/mb2/jeu/game.js', 'public/mb2/plateforme.js', 'public/mb2/jeu/manager.js']) {
  require(path.join(ROOT, f));
}
const K = globalThis.KalugaMoteur;
const J = globalThis.Mb2Jeu;
const json = JSON.parse(lire('public/mb2/data/mb2.json'));
const biblio = new K.Bibliotheque('mb2', json, {});

// ── A. Le cache raster du bumper invisible ────────────────────────────────

// Les chemins et matrices du navigateur, juste assez pour compiler un dessin.
globalThis.Path2D = class { constructor(d) { this.d = d; } addPath(p, m) { this.d = p.d; this.m = m; } };
globalThis.DOMMatrix = class {
  constructor(m) { Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); if (Array.isArray(m)) [this.a, this.b, this.c, this.d, this.e, this.f] = m; }
};

// Un contexte qui note ce qu'on lui demande.
function contexteEnregistreur(journal, T) {
  let transformation = Object.assign({}, T);
  return {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '',
    getTransform() { return Object.assign({}, transformation); },
    setTransform(a, b, c, d, e, f) { transformation = { a, b, c, d, e, f }; journal.push(['setTransform', a, b, c, d, e, f]); },
    transform(...m) { journal.push(['transform', ...m]); },
    save() { journal.push(['save']); },
    restore() { journal.push(['restore']); },
    fill(chemin, regle) { journal.push(['fill', chemin.d, regle, this.fillStyle, this.globalAlpha]); },
    stroke(chemin) { journal.push(['stroke', chemin.d, this.strokeStyle, this.lineWidth, this.globalAlpha]); },
    drawImage(image, x, y) { journal.push(['drawImage', image, x, y, this.globalAlpha]); },
  };
}

// Un document dont les canevas enregistrent leur contexte.
const canevasCrees = [];
function documentBouchon() {
  return {
    createElement(balise) {
      const journal = [];
      const cv = { balise, width: 0, height: 0, journal, getContext() { return contexteEnregistreur(journal, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); } };
      canevasCrees.push(cv);
      return cv;
    },
  };
}

// Une scène sans canevas : la file des scripts d'image (le stop() de l'image 1).
function nouvelleScene() {
  const sc = Object.create(K.Scene.prototype);
  Object.assign(sc, { numeroTick: 0, fileScripts: [], dansScript: false, enAvance: false, surTick: null, souris: { x: -1000, y: -1000 } });
  sc.surSouris = () => {};
  sc.objetRetire = () => {};
  return sc;
}

test('le bumper invisible au repos se dessine par drawImage depuis des caches par remplissage, à la matrice et à la phase exactes', () => {
  const sceneAvant = K.scene;
  const direct = K.Clip.prototype.dessinerDans;
  let appelsDirects = 0;
  K.scene = nouvelleScene();
  globalThis.document = documentBouchon();
  canevasCrees.length = 0;
  J.CACHES_BUMPER_INVISIBLE.clear();
  try {
    // Le chemin direct du moteur : on ne le rejoue pas (pas de scène de rendu), on le compte.
    K.Clip.prototype.dessinerDans = function () { appelsDirects++; };
    const clip = K.instancier(biblio, biblio.symboles.bshadow);
    K.finaliser(clip, null);
    K.scene.viderScripts();
    assert.strictEqual(clip._currentframe, 1);
    clip._x = 300; clip._y = 200; clip._visible = true; clip._alpha = 50;
    J.poserCacheBumperInvisible(clip);

    // Les formes du clip au repos : le corps (819) et le cœur (820 → 557).
    const formes = [819, 557].map((id) => K.compilerDessin(json.perso[id]));
    const nRempl = formes.reduce((n, c) => n + c.ops.length, 0);
    const nCoutures = formes.reduce((n, c) => n + c.ops.filter((o) => o.cheminDebord).length, 0);
    assert.strictEqual(nRempl, 10, 'dix remplissages');
    assert.ok(nCoutures > 0, 'des coutures');

    // Le canevas de la scène : l'échelle du clip « main » du SWF n'est pas uniforme.
    const T = { a: 1.1475, b: 0, c: 0, d: 1.1476, e: 0.17, f: 0 };
    const journal = [];
    clip.dessinerDans(contexteEnregistreur(journal, T), 1);

    assert.strictEqual(appelsDirects, 0, 'pas de dessin direct au repos');
    assert.deepStrictEqual(journal.filter((o) => o[0] === 'fill' || o[0] === 'stroke'), [], 'aucun tracé sur le canevas de la scène');
    const copies = journal.filter((o) => o[0] === 'drawImage');
    assert.strictEqual(copies.length, nRempl + nCoutures, 'un drawImage par remplissage et par couture');
    assert.ok(copies.every((o) => o[4] === 0.5), 'l\'alpha du clip (50 %) sur chaque copie');
    assert.strictEqual(J.CACHES_BUMPER_INVISIBLE.size, 2, 'un cache par forme');
    assert.strictEqual(canevasCrees.length, nRempl + nCoutures, 'un canevas par remplissage et par couture');

    // Chaque canevas est posé sous la matrice exacte de sa forme, et recopié
    // à un entier tel que la phase sous-pixel soit celle du dessin direct.
    const M = K.composer([T.a, T.b, T.c, T.d, T.e, T.f], clip.matriceLocale());   // les enfants sont à l'identité
    for (const cv of canevasCrees) {
      const pose = cv.journal.find((o) => o[0] === 'setTransform');
      assert.deepStrictEqual(pose.slice(1, 5), [M[0], M[1], M[2], M[3]], 'la partie linéaire');
      const copie = copies.find((o) => o[1] === cv);
      assert.ok(copie, 'chaque canevas est recopié');
      assert.ok(Number.isInteger(copie[2]) && Number.isInteger(copie[3]), 'à une position entière');
      assert.ok(Math.abs(copie[2] + pose[5] - M[4]) < 1e-9 && Math.abs(copie[3] + pose[6] - M[5]) < 1e-9, 'phase exacte');
      const traces = cv.journal.filter((o) => o[0] === 'fill' || o[0] === 'stroke');
      assert.strictEqual(traces.length, 1, 'un seul tracé par canevas');
      assert.strictEqual(traces[0][traces[0].length - 1], 1, 'tracé opaque : l\'alpha s\'applique à la copie');
      if (traces[0][0] === 'stroke') assert.ok(Math.abs(traces[0][3] - 1 / Math.sqrt(M[0] * M[3])) < 1e-9, 'la couture fait un pixel d\'écran');
    }
    // L'ordre du dessin direct : remplissage puis sa couture, forme après forme.
    const attendu = [];
    for (const c of formes) for (const o of c.ops) { attendu.push('fill:' + o.op.f.c); if (o.cheminDebord) attendu.push('stroke:' + o.op.f.c); }
    const obtenu = copies.map((o) => { const t = o[1].journal.find((e) => e[0] === 'fill' || e[0] === 'stroke'); return t[0] + ':' + (t[0] === 'fill' ? t[3] : t[2]); });
    assert.deepStrictEqual(obtenu, attendu);

    // Une image de plus : rien de nouveau n'est rastérisé.
    const journal2 = [];
    clip.dessinerDans(contexteEnregistreur(journal2, T), 1);
    assert.strictEqual(canevasCrees.length, nRempl + nCoutures, 'les caches servent');
    assert.strictEqual(journal2.filter((o) => o[0] === 'drawImage').length, nRempl + nCoutures);

    // Invisible (alpha 0) : rien du tout, comme le moteur.
    clip._alpha = 0;
    const journal3 = [];
    clip.dessinerDans(contexteEnregistreur(journal3, T), 1);
    assert.deepStrictEqual(journal3, []);
    assert.strictEqual(appelsDirects, 0);

    // L'animation « hit » (image 2, le corps teinté) repasse par le moteur.
    clip._alpha = 100;
    clip.gotoAndStop(2);
    const journal4 = [];
    clip.dessinerDans(contexteEnregistreur(journal4, T), 1);
    assert.strictEqual(appelsDirects, 1, 'le dessin direct');
    assert.deepStrictEqual(journal4, [], 'rien par le cache');

    // Retour au repos : le cache reprend.
    clip.gotoAndStop(1);
    K.scene.viderScripts();
    const journal5 = [];
    clip.dessinerDans(contexteEnregistreur(journal5, T), 1);
    assert.strictEqual(appelsDirects, 1);
    assert.strictEqual(journal5.filter((o) => o[0] === 'drawImage').length, nRempl + nCoutures);

    // Sans document (pas de canevas hors écran possible) : le moteur, tel quel.
    delete globalThis.document;
    clip.dessinerDans(contexteEnregistreur([], T), 1);
    assert.strictEqual(appelsDirects, 2);
  } finally {
    K.Clip.prototype.dessinerDans = direct;
    K.scene = sceneAvant;
    delete globalThis.document;
    J.CACHES_BUMPER_INVISIBLE.clear();
  }
});

test('Level.gen_bumper pose le cache sur le bumper invisible, et sur lui seul', () => {
  const src = lire('public/mb2/jeu/niveau.js');
  assert.match(src, /b\.clip = clip;\s*if \(b\.btype === 5\) poserCacheBumperInvisible\(clip\);/);
  assert.strictEqual((src.match(/\bposerCacheBumperInvisible\(clip\);/g) || []).length, 1, 'un seul appel');
});

// ── B. Boss → picto, comme à l'origine ────────────────────────────────────

const ELEMENTS = ['eau', 'feu', 'vent', 'terre'];
// La teinte du serpent et de ses écailles projetées (snakePart, image
// élément) dans le SWF : les décalages r, g, b de la transformation de
// couleur, sur un dessin en niveaux de gris. Sur du blanc : eau (199, 255,
// 255) bleu-cyan, feu (255, 120, 120) rouge, vent (0, 245, 185) vert, terre
// (185, 135, 0) marron.
const TEINTES = { eau: [-56, 0, 56], feu: [0, -135, -135], vent: [-255, -10, -70], terre: [-70, -120, -255] };
const COULEUR_ECAILLE = { eau: 'bleue', feu: 'rouge', vent: 'verte', terre: 'marron' };
// Ce que la table des pictos du serveur dit de travers AUJOURD'HUI : l'eau
// et le vent (« air ») échangent leurs écailles. À vider quand server.js
// nomme $eca0 « Écaille bleue » et $eca2 « Écaille verte ».
// Plus aucune divergence : server.js nomme les écailles comme le jeu les teinte.
const DIVERGENCES_CONNUES = {};

test('TItems : la liste du portage est celle de TItems.as, et un donjon donne son symbole puis son écaille', () => {
  const as = lire('Games/motionBall2/mb2/TItems.as');
  const liste = /static var TITEMS = \[([\s\S]*?)\];/.exec(as)[1].match(/"[^"]*"/g).map((s) => s.slice(1, -1));
  assert.deepStrictEqual(J.TItems.TITEMS, liste);
  assert.deepStrictEqual([J.TItems.TITEMS_SERPENT, J.TItems.TITEMS_SYMBOL, J.TItems.TITEMS_END], [29, 33, 22]);
  assert.deepStrictEqual(liste.slice(33), ['$symb0', '$symb1', '$symb2', '$symb3']);
  assert.deepStrictEqual(liste.slice(29, 33), ['$eca0', '$eca1', '$eca2', '$eca3']);

  const fcard = new J.Card();
  const donnes = [];
  J.Manager.client = { fcard, giveItem: (n) => donnes.push(n), saveSlot: () => {} };
  for (let av = 0; av < 4; av++) {
    assert.strictEqual(J.TItems.giveAventure(av), true);
    assert.strictEqual(donnes[donnes.length - 1], '$symb' + av, 'le logo du donjon ' + av);
    assert.strictEqual(J.TItems.giveAventure(av), true);
    assert.strictEqual(donnes[donnes.length - 1], '$eca' + av, 'puis son écaille');
    assert.strictEqual(J.TItems.giveAventure(av), false, 'puis plus rien');
  }
  assert.strictEqual(J.TItems.giveAventure(4), true);
  assert.ok(liste.slice(22, 29).includes(donnes[donnes.length - 1]), 'le cinquième donjon : un picto de la Tourneboule');
});

test('le donjon n joue la carte mb2adv(n+1) contre le serpent de l\'élément n+1, comme BossSerpent.as', () => {
  const as = lire('Games/motionBall2/mb2/BossSerpent.as');
  assert.match(as, /elt = Manager\.play_mode_param \+ 1;/);
  assert.match(as, /static var EAU = 1;\s*static var FEU = 2;\s*static var VENT = 3;\s*static var TERRE = 4;/);
  assert.match(lire('public/mb2/jeu/boss.js'), /this\.elt = J\.Manager\.play_mode_param \+ 1;/);
  assert.deepStrictEqual([J.BossSerpent.EAU, J.BossSerpent.FEU, J.BossSerpent.VENT, J.BossSerpent.TERRE], [1, 2, 3, 4]);
  assert.strictEqual(J.Const.AVENTURE_DATA(0), 'mb2adv1.dat');
  assert.match(lire('public/mb2/jeu/ecrans.js'), /case 60: case 61: case 62: case 63: case 64:\s*this\.run_mode\(Const\.MODE_AVENTURE, id - 60\)/);
});

test('dans le SWF, le logo au sol de l\'élément n+1 est bossLogo{Eau,Feu,Vent,Terre}.png, et le serpent prend la teinte de son élément', () => {
  const dimsPng = (f) => { const b = fs.readFileSync(path.join(ROOT, 'Games/motionBall2/images', f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const logoBg = json.perso[json.symboles.logoBg];
  const noms = ['bossLogoEau.png', 'bossLogoFeu.png', 'bossLogoVent.png', 'bossLogoTerre.png'];
  for (let i = 0; i < 4; i++) {
    const forme = json.perso[logoBg.frames[i].ops.find((o) => o.c !== undefined).c];
    const bm = forme.ops[0].f.bm.id;
    assert.deepStrictEqual([json.images[bm].l, json.images[bm].h], dimsPng(noms[i]), 'image ' + (i + 1) + ' : ' + noms[i]);
  }
  for (const nom of ['snakePart', 'snake']) {
    const clip = json.perso[json.symboles[nom]];
    const gfx = nom === 'snake' ? json.perso[clip.frames[0].ops.find((o) => o.n === 'gfx').c] : clip;
    for (let i = 0; i < 4; i++) {
      const cx = gfx.frames[i].ops[0].cx;
      assert.deepStrictEqual(cx.slice(4, 7), TEINTES[ELEMENTS[i]], nom + ', élément ' + ELEMENTS[i]);
    }
  }
});

test('la table des pictos du serveur : les logos suivent les éléments ; les écailles eau/vent sont inversées (constaté, pas corrigé ici)', () => {
  const serveur = lire('server.js');
  const titems = /const MB2_TITEMS = \[([\s\S]*?)\];/.exec(serveur)[1].match(/'[^']*'/g).map((s) => s.slice(1, -1));
  assert.deepStrictEqual(titems, J.TItems.TITEMS, 'le serveur relit $items dans le même ordre');
  const nom = (cle) => new RegExp("'\\" + cle + "':\\s*\\{\\s*name:\\s*'([^']*)'").exec(serveur)[1];
  for (let i = 0; i < 4; i++) assert.strictEqual(nom('$symb' + i), 'Logo ' + ELEMENTS[i]);
  const divergences = {};
  for (let i = 0; i < 4; i++) {
    const serveurDit = nom('$eca' + i).replace('Écaille ', '');
    const jeuDit = COULEUR_ECAILLE[ELEMENTS[i]];
    if (serveurDit !== jeuDit) divergences['$eca' + i] = { serveur: serveurDit, jeu: jeuDit };
  }
  assert.deepStrictEqual(divergences, DIVERGENCES_CONNUES);
});
