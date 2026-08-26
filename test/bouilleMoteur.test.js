'use strict';
/*
 * LE MOTEUR JAVASCRIPT DES FRUTIBOUILLES
 *
 * Aujourd'hui une bouille est un SWF joué par Ruffle : un interpréteur AVM1
 * complet en WebAssembly pour un visage de cent pixels. Le moteur de
 * public/js/bouille-*.js lit les MÊMES fichiers (public/fbouille/famille<N>.swf,
 * ceux d'époque, pas les rustines Ruffle) et les joue lui-même.
 *
 * Ce qui est vérifié ici, c'est la FIDÉLITÉ au script racine des familles,
 * relevé au décompilateur :
 *
 *   apply(s)      s.substring(2,4).decode62() → yeux, puis iris, cheveux,
 *                 bouche, couleur1, couleur2, accessoire, accessoire2 et les
 *                 trois couleurs d'accessoire — douze paires en base 62.
 *   FEMC.setColor ra = ga = ba = 100 ; rb = r - 255 …  →  la teinte n'est PAS
 *                 un aplat, c'est un DÉCALAGE ajouté à la couleur d'origine.
 *                 Relevé sur le rendu Flash de la famille 0 : un gris 238
 *                 teinté par la couleur 7 (160,100,45) sort en (143,83,28),
 *                 soit exactement 238 + c - 255.
 *   emoteList     [[0,0],[1,2],[2,1],[0,3],[3,4],[1,4],[2,3],[2,6]]
 *   actionList    stop parle rire mdr langue rougir regard siffle gum
 *                 question miam pleure larme
 *
 * Et un BOGUE D'ÉPOQUE, conservé : apply() cale ca.c.acc, ca.c.acc2 et
 * cb.c.acc sur l'accessoire secondaire mais oublie cb.c.acc2.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
const Avm = require(path.join(ROOT, 'public/js/bouille-avm.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));

const DOSSIER = path.join(ROOT, 'public/fbouille');
const FAMILLES = fs.readdirSync(DOSSIER).filter((f) => /^famille\d+\.swf$/.test(f)).sort();

function lire(fichier) {
  const brut = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength))
    .then(Swf.lire);
}
const paire = (n) => Moteur.encode62(n, 2);
const etat = (v) => v.map(paire).join('');

test('les onze SWF de famille se lisent et montent un visage', async () => {
  assert.ok(FAMILLES.length >= 10, 'au moins dix familles');
  for (const f of FAMILLES) {
    const defs = await lire(f);
    assert.deepStrictEqual(defs.scene, { x: 0, y: 0, w: 100, h: 100 }, f + ' : scène 100×100');
    assert.strictEqual(defs.cadence, 40, f + ' : 40 images par seconde');
    assert.ok(defs.formes.size > 0, f + ' : des formes');
    const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
    const face = mo.creerVisage();
    assert.ok(face.def.n >= 1, f + ' : le visage a une pellicule');
  }
});

test('apply() lit les douze paires base 62 aux bonnes positions', async () => {
  const defs = await lire('famille0.swf');
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(etat([0, 4, 3, 7, 2, 15, 22, 5, 1, 11, 21, 31]));
  assert.deepStrictEqual(mo.etat, {
    famille: 0, eyeId: 4, eyeSc: 3, hairId: 7, mouthId: 2,
    faceColor: 15, secondColor: 22, accId: 5, accSecId: 1,
    accColor1: 11, accColor2: 21, accColor3: 31,
  });
  // Une paire base 62 dépasse 61 : « 10 » vaut 62, pas dix.
  assert.strictEqual(Moteur.decode62('10'), 62);
  assert.strictEqual(Moteur.decode62('0a'), 10);
  assert.strictEqual(Moteur.decode62('0A'), 36);
  assert.strictEqual(Moteur.encode62(10, 2), '0a');
  assert.strictEqual(Moteur.familleDe('0c00000000000000000000'), 12);
});

test('les images des sous-clips suivent la chaîne d’état', async () => {
  const defs = await lire('famille0.swf');
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  const face = mo.creerVisage();
  mo.definir(etat([0, 4, 3, 7, 2, 15, 22, 5, 1, 11, 21, 31]));
  const e = (c, n) => c && c.enfantNomme(n);
  // gotoAndStop(id + 1) : l'indice 0 est l'image 1.
  assert.strictEqual(e(face, 'ca').frame, 8, 'cheveux 7 → image 8');
  assert.strictEqual(e(face, 'cb').frame, 8, 'les deux couches de cheveux');
  assert.strictEqual(e(face, 'b').frame, 3, 'bouche 2 → image 3');
  assert.strictEqual(e(face, 'oa').frame, 5, 'yeux 4 → image 5');
  assert.strictEqual(e(face, 'ob').frame, 5);
  assert.strictEqual(e(e(face, 'oa'), 'o').enfantNomme('p').frame, 4, 'iris 3 → image 4');
  assert.strictEqual(e(e(face, 'ca'), 'c').frame, 6, 'accessoire 5 → image 6');
});

test('la teinte d’époque est un DÉCALAGE, pas un aplat', () => {
  // FEMC.setColor : rb = r - 255, multiplicateur laissé à 100 %.
  const cx = Moteur.cxTeinte([160, 100, 45]);
  assert.deepStrictEqual([cx.mr, cx.mv, cx.mb], [256, 256, 256]);
  assert.deepStrictEqual([cx.ar, cx.av, cx.ab], [160 - 255, 100 - 255, 45 - 255]);
  // Le relevé sur le rendu Flash : un gris 238 → (143, 83, 28).
  assert.strictEqual(Moteur.teindre([238, 238, 238], cx), 'rgb(143,83,28)');
  // Le blanc rend la couleur de palette telle quelle : c'est la règle du parc.
  assert.strictEqual(Moteur.teindre([255, 255, 255], cx), 'rgb(160,100,45)');
  // Et l'on borne : un gris sombre ne descend pas sous zéro.
  assert.strictEqual(Moteur.teindre([20, 20, 20], cx), 'rgb(0,0,0)');
  // Les deux autres couleurs relevées sur Flash, pour la même source 238.
  assert.strictEqual(Moteur.teindre([238, 238, 238], Moteur.cxTeinte(Moteur.PALETTE[15])), 'rgb(133,198,38)');
  assert.strictEqual(Moteur.teindre([238, 238, 238], Moteur.cxTeinte(Moteur.PALETTE[2])), 'rgb(234,183,173)');
});

test('la palette est bien generalPalette (53 couleurs) du loader', () => {
  assert.strictEqual(Moteur.PALETTE.length, 53);
  assert.deepStrictEqual(Moteur.PALETTE[0], [255, 231, 206]);
  assert.deepStrictEqual(Moteur.PALETTE[52], [255, 245, 245]);
  // Et elle est la même que celle de bouille-palette.js, déjà partagée par
  // l'éditeur du light, l'admin et la vitrine de la boutique.
  const src = fs.readFileSync(path.join(ROOT, 'public/js/bouille-palette.js'), 'utf8');
  const hex = src.match(/hex:\s*"#([0-9A-Fa-f]{6})"/g).map((s) => s.slice(-7, -1).toUpperCase());
  assert.strictEqual(hex.length, 53);
  Moteur.PALETTE.forEach((rgb, i) => {
    const h = rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    assert.strictEqual(h, hex[i], 'couleur ' + i);
  });
});

test('les teintes atterrissent sur les clips nommés du script racine', async () => {
  const defs = await lire('famille0.swf');
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  const face = mo.creerVisage();
  // Cheveux 4 + accessoire 4 : la seule sorte de combinaison où les DEUX
  // couches de cheveux portent un `col` (toutes n'en ont pas — un accessoire
  // sans partie colorable n'a tout simplement pas le sous-clip).
  mo.definir(etat([0, 1, 0, 4, 1, 15, 22, 4, 1, 11, 21, 31]));
  const e = (c, n) => c && c.enfantNomme(n);
  assert.deepStrictEqual(e(e(face, 'pa'), 'col').teinte, Moteur.PALETTE[15], 'peau avant ← couleur1');
  assert.deepStrictEqual(e(e(face, 'pb'), 'col').teinte, Moteur.PALETTE[15], 'peau arrière ← couleur1');
  const bb = e(e(face, 'b'), 'b');
  assert.deepStrictEqual(e(e(bb, 'col'), 'col').teinte, Moteur.PALETTE[15], 'bouche ← couleur1');
  const caC = e(e(face, 'ca'), 'c'), cbC = e(e(face, 'cb'), 'c');
  assert.deepStrictEqual(e(caC, 'col').teinte, Moteur.PALETTE[22], 'cheveux avant ← couleur2');
  assert.deepStrictEqual(e(cbC, 'col').teinte, Moteur.PALETTE[22], 'cheveux arrière ← couleur2');
  // L'accessoire prend ses trois couleurs à lui, sur les sous-clips présents.
  const acc = e(caC, 'acc');
  assert.ok(acc, 'accessoire 4 monté');
  const attendu = { col: Moteur.PALETTE[11], col2: Moteur.PALETTE[21], col3: Moteur.PALETTE[31] };
  let vus = 0;
  for (const n of ['col', 'col2', 'col3']) {
    const c = e(acc, n);
    if (!c) continue;
    vus++;
    assert.deepStrictEqual(c.teinte, attendu[n], 'accessoire.' + n);
  }
  assert.ok(vus > 0, 'au moins une couleur d’accessoire teintée');
  // Changer d'état repeint : la teinte n'est pas figée à la construction.
  mo.definir(etat([0, 1, 0, 4, 1, 3, 9, 4, 1, 11, 21, 31]));
  assert.deepStrictEqual(e(e(face, 'pa'), 'col').teinte, Moteur.PALETTE[3]);
  assert.deepStrictEqual(e(e(face, 'ca'), 'c').enfantNomme('col').teinte, Moteur.PALETTE[9]);
});

test('BOGUE D’ÉPOQUE conservé : cb.c.acc2 n’est pas calé', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');
  // Les trois que le script racine cale, et pas le quatrième.
  assert.match(src, /aller\(caAcc, accSecId \+ 1\); aller\(caAcc2, accSecId \+ 1\); aller\(cbAcc, accSecId \+ 1\);/);
  assert.doesNotMatch(src, /aller\(cbAcc2, accSecId \+ 1\)/);
  assert.match(src, /cb\.c\.acc2 n'est PAS calé/);
});

test('emoteList et actionList sont celles du script racine', async () => {
  assert.deepStrictEqual(Moteur.HUMEURS,
    [[0, 0], [1, 2], [2, 1], [0, 3], [3, 4], [1, 4], [2, 3], [2, 6]]);
  assert.deepStrictEqual(Moteur.ANIMATIONS, ['stop', 'parle', 'rire', 'mdr', 'langue',
    'rougir', 'regard', 'siffle', 'gum', 'question', 'miam', 'pleure', 'larme']);
  const defs = await lire('famille0.swf');
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  const face = mo.creerVisage();
  mo.definir(etat([0, 1, 0, 5, 1, 15, 22, 0, 0, 0, 0, 0]));
  // applyEmote(4) → œil 3, bouche 4 ; les clips suivent d'une image.
  mo.humeur(4);
  assert.strictEqual(mo.racine.emoteEye, 3);
  assert.strictEqual(mo.racine.emoteMouth, 4);
  assert.strictEqual(face.enfantNomme('oa').enfantNomme('o').frame, 4);
  assert.strictEqual(face.enfantNomme('b').enfantNomme('b').frame, 5);
});

test('les treize animations jouent, bouclent et rendent la main', async () => {
  const defs = await lire('famille0.swf');
  const mo = new Moteur.Moteur(defs, { alea: () => 0.5 });
  const face = mo.creerVisage();
  mo.definir(etat([0, 1, 0, 5, 1, 15, 22, 0, 0, 0, 0, 0]));
  const labels = face.def.labels;
  // Les étiquettes que playAnim() vise, telles quelles dans la pellicule.
  for (const l of ['parle', 'rire', 'mdr', 'langue', 'rougir', 'sifflote',
    'gum', 'question', 'pleurer', 'larme', 'regard', 'miam']) {
    assert.ok(labels[l], 'étiquette « ' + l +' » présente');
  }
  for (let id = 1; id <= 12; id++) {
    mo.jouerAnim(0);
    mo.jouerAnim(id);
    assert.strictEqual(mo.racine.flStop, false, 'anim ' + id + ' : le visage est lancé');
    let vues = new Set();
    for (let k = 0; k < 400; k++) { mo.avancer(); vues.add(face.frame); }
    assert.ok(vues.size > 1 || face.frame === 1,
      'anim ' + id + ' : le visage bouge (ou est déjà revenu au repos)');
  }
  // La garde d'époque : `action(id)` ne LANCE que si l'on est au repos ;
  // sinon elle se contente de retenir la suite dans `next`, et c'est le script
  // d'image de fin d'animation qui l'enchaînera (playAnim(_parent.next)).
  mo.jouerAnim(0);
  assert.strictEqual(mo.racine.flStop, true, 'stop() remet au repos');
  mo.action(2);
  assert.strictEqual(mo.racine.flStop, false, 'action() lance depuis le repos');
  // playAnim(2) a remis next à 0 : le rire rend la main au repos.
  assert.strictEqual(mo.racine.next, 0);
  const avant = face.frame;
  mo.action(5);
  assert.strictEqual(mo.racine.next, 5, 'la suite est retenue');
  assert.strictEqual(face.frame, avant, 'mais rien n’est relancé en cours d’animation');
});

test('l’interpréteur AVM1 tient les idiomes d’époque', () => {
  // « compt-- ; si compt > 0, tenir l'image » — la boucle sur deux images.
  //   push "compt" ; getvariable ; decrement ; push "compt" ; … setvariable
  const A = [];
  const pousserChaine = (s) => { A.push(0x96, s.length + 2, 0, 0x00); for (const c of s) A.push(c.charCodeAt(0)); A.push(0); };
  const pousserEntier = (n) => { A.push(0x96, 5, 0, 0x07, n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255); };
  pousserChaine('compt'); pousserChaine('compt'); A.push(0x1c); A.push(0x51); A.push(0x1d);
  pousserChaine('compt'); A.push(0x1c); pousserEntier(0); A.push(0x67);
  A.push(0x12);                                     // not  → vrai si compt ≤ 0
  A.push(0x9d, 2, 0, 6, 0);                         // if → saute play (1) + jump (5)
  A.push(0x06);                                     // play()   (1 octet)
  A.push(0x99, 2, 0, 1, 0);                         // jump → saute le stop()
  A.push(0x07);                                     // stop()
  A.push(0);
  const clip = {
    vars: { compt: 3 }, joue: null,
    avmGet(n) { return this.vars[n]; },
    avmSet(n, v) { this.vars[n] = v; },
    avmAppel(n) { this.joue = n; },
  };
  Avm.jouer(new Uint8Array(A), { cible: clip, racine: {}, alea: () => 0 });
  assert.strictEqual(clip.vars.compt, 2, 'compt décrémenté');
  assert.strictEqual(clip.joue, 'play', 'compt > 0 : on continue');
  clip.vars.compt = 1; clip.joue = null;
  Avm.jouer(new Uint8Array(A), { cible: clip, racine: {}, alea: () => 0 });
  assert.strictEqual(clip.vars.compt, 0);
  assert.strictEqual(clip.joue, 'stop', 'compt épuisé : on s’arrête');

  // GotoFrame2 avec le drapeau de lecture : « gotoAndPlay(_currentframe - 1) ».
  const B = [];
  B.push(0x96, 2, 0, 0x00, 0);                      // push ""  (cible courante)
  B.push(0x96, 5, 0, 0x07, 4, 0, 0, 0);             // push 4   (_currentframe)
  B.push(0x22);                                     // GetProperty
  B.push(0x96, 5, 0, 0x07, 1, 0, 0, 0); B.push(0x0b); // - 1
  B.push(0x9f, 1, 0, 1);                            // GotoFrame2, PlayFlag
  B.push(0);
  const clip2 = { frame: 9, vise: null,
    avmGet(n) { return n === '_currentframe' ? this.frame : undefined; },
    avmSet() {},
    avmAppel(n, args) { if (n === 'allerImage') this.vise = args; } };
  Avm.jouer(new Uint8Array(B), { cible: clip2, racine: {}, alea: () => 0 });
  assert.deepStrictEqual(clip2.vise, [8, true], 'retour d’une image, en lecture');
});

test('le moteur ne touche à rien du site : aucune page ne le charge encore', () => {
  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  for (const f of ['bouille-swf.js', 'bouille-avm.js', 'bouille-moteur.js']) {
    assert.ok(!light.includes(f), 'le mobile ignore ' + f);
  }
  // Le banc d'essai, lui, les charge tous les trois — et rien d'autre.
  const banc = fs.readFileSync(path.join(ROOT, 'public/bouille-js.html'), 'utf8');
  for (const f of ['bouille-swf.js', 'bouille-avm.js', 'bouille-moteur.js']) {
    assert.ok(banc.includes(f), 'le banc charge ' + f);
  }
  assert.ok(banc.includes('/fbouille/') || banc.includes('bouille-preview'),
    'le banc compare bien au SWF d’époque');
});
