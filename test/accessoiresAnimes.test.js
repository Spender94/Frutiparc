'use strict';
/*
 * LES ACCESSOIRES ANIMÉS
 *
 * Cinq accessoires de la bibliothèque bougent d'époque. Aucun ne bougeait ici,
 * et pour DEUX raisons superposées :
 *
 * 1. LA VIGNETTE FIGEAIT TOUT. `FPBouilleVignette` montait ses bouilles avec
 *    `anime: false` : une image, puis plus rien. C'était juste pour une bouille
 *    au repos — aucune des dix familles n'a de pellicule en marche une fois
 *    `apply()` passé — mais faux dès qu'un accessoire en a une. `apply()` du
 *    SWF n'arrête que `c`, `acc` et `acc2` (gotoAndStop) ; jamais leurs
 *    enfants, et c'est un enfant qui porte l'animation.
 *
 * 2. `_rotation` N'ÉTAIT PAS APPLIQUÉ. La variante 25 de l'accessoire 3
 *    (famille 0) est une casquette dont deux pièces tournent en sens
 *    contraires, et rien d'autre : trois images qui posent toutes le même
 *    dessin au même endroit, et un script qui fait tout le travail —
 *
 *        image 1 : vit = -(random(5) + 3)      · l'autre pièce : random(3) + 2
 *        image 2 : _parent.col2._rotation += vit
 *        image 3 : gotoAndPlay(_currentframe - 1)
 *
 *    L'interpréteur rangeait `_rotation` parmi les variables ordinaires du
 *    clip : l'angle s'accumulait fidèlement, et ne tournait rien.
 *
 * Le recensement ci-dessous est le garde-fou de la première cause : si une
 * famille change, on veut savoir que la liste des accessoires vivants change
 * avec elle.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
const M = require(path.join(ROOT, 'public/js/bouille-moteur.js'));

const DOSSIER = path.join(ROOT, 'public/fbouille');
const VIGNETTE = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
const MOTEUR = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');

const familles = {};
async function famille(n) {
  if (!familles[n]) {
    const brut = fs.readFileSync(path.join(DOSSIER, 'famille' + n + '.swf'));
    familles[n] = Swf.lire(await Swf.decompresser(new Uint8Array(brut)));
  }
  return familles[n];
}
const paire = (v) => M.encode62(v, 2);
/** Une chaîne d'état : la famille, deux couleurs, et le couple d'accessoires. */
const etat = (fam, acc, sec) =>
  [fam, 0, 0, 0, 0, 5, 15, acc || 0, sec || 0, 0, 0, 0].map(paire).join('');

async function moteur(fam, acc, sec) {
  const m = new M.Moteur(await famille(fam), { alea: () => 0.5 });
  m.definir(etat(fam, acc, sec));
  return m;
}

/* ── 1. QUI BOUGE, ET QUI NE BOUGE PAS ────────────────────────────────────── */

const FAMILLES = [0, 10, 11, 12, 13, 14, 15, 16, 23, 24];

test('aucune famille ne bouge d’elle-même une fois apply() passé', async () => {
  // C'est ce qui rendait `anime: false` défendable, et c'est ce qui rend le
  // mode automatique aussi économe : sans accessoire, pas une seule boucle.
  for (const f of FAMILLES) {
    const m = await moteur(f, 0, 0);
    assert.strictEqual(m.enMouvement(), false, 'famille ' + f + ' : une pellicule tourne au repos');
    let bouge = 0;
    for (let i = 0; i < 200; i++) if (m.avancer()) bouge++;
    assert.strictEqual(bouge, 0, 'famille ' + f + ' : ' + bouge + ' images jouées au repos');
  }
});

test('cinq accessoires de la bibliothèque sont vivants, et eux seuls', async () => {
  const attendu = {
    0: { 3: [25, 33], 6: [0], 10: [4] },
    12: { 2: [0] },
  };
  const trouve = {};
  for (const f of FAMILLES) {
    const defs = await famille(f);
    const sonde = new M.Moteur(defs, { alea: () => 0.5 });
    const face = sonde.creerVisage();
    const ca = face.enfantNomme('ca');
    const c = ca && ca.enfantNomme('c');
    if (!c) continue;                       // les incarnations n'ont pas d'accessoire
    for (let a = 0; a < c.def.n; a++) {
      c.allerImage(a + 1, false);
      const acc = c.enfantNomme('acc'), acc2 = c.enfantNomme('acc2');
      const n = Math.max(acc ? acc.def.n : 1, acc2 ? acc2.def.n : 1);
      for (let s = 0; s < n; s++) {
        const m = new M.Moteur(defs, { alea: () => 0.5 });
        m.definir(etat(f, a, s));
        if (!m.enMouvement()) continue;
        (trouve[f] = trouve[f] || {})[a] = (trouve[f][a] || []).concat(s);
      }
    }
  }
  assert.deepStrictEqual(trouve, attendu);
});

test('peutBouger descend dans l’arbre, il ne regarde pas que la racine', async () => {
  // L'accessoire 6 (le visiocasque) : `acc` est ARRÊTÉ par apply(), et c'est
  // son enfant `col` — soixante-quinze images — qui joue.
  const m = await moteur(0, 6, 0);
  const acc = m.racine.face.enfantNomme('ca').enfantNomme('c').enfantNomme('acc');
  assert.strictEqual(acc.enLecture, false, '`acc` est bien arrêté par apply()');
  const col = acc.enfantNomme('col');
  assert.ok(col && col.def.n > 1 && col.enLecture, 'c’est `col` qui joue');
  assert.strictEqual(m.enMouvement(), true);
  // Et le visage, lui, est arrêté : la marche vient bien d'en dessous.
  assert.strictEqual(m.racine.face.enLecture, false);
});

/* ── 2. `_rotation` ───────────────────────────────────────────────────────── */

test('le moulinet tourne, et ses deux pièces en sens contraires', async () => {
  // `alea` figé à 0,5 : vit vaut -(⌊0,5×5⌋+3) = -5 d'un côté, ⌊0,5×3⌋+2 = 3 de
  // l'autre. Une image du lecteur = un incrément (l'image 3 renvoie à la 2,
  // dont le script s'exécute dans la foulée).
  const m = await moteur(0, 3, 25);
  const acc = m.racine.face.enfantNomme('ca').enfantNomme('c').enfantNomme('acc');
  const col2 = acc.enfantNomme('col2'), col3 = acc.enfantNomme('col3');
  assert.strictEqual(col2.vars.vit, -5);
  assert.strictEqual(col3.vars.vit, 3);
  assert.strictEqual(col2.drot, 0, 'rien n’a encore tourné');
  // La première image ne fait que réveiller les clips neufs (Clip.neuf).
  m.avancer();
  assert.strictEqual(col2.drot, 0);
  for (let i = 0; i < 9; i++) m.avancer();
  assert.strictEqual(col2.drot, -45);
  assert.strictEqual(col3.drot, 27);
});

test('_rotation tourne la matrice, pas la position', async () => {
  const m = await moteur(0, 3, 25);
  const acc = m.racine.face.enfantNomme('ca').enfantNomme('c').enfantNomme('acc');
  const col2 = acc.enfantNomme('col2');
  const pose = col2.matrice();
  col2.drot = 90;
  const tourne = col2.matrice();
  // La translation ne bouge pas : on tourne AUTOUR de l'origine du clip.
  assert.strictEqual(tourne.e, pose.e);
  assert.strictEqual(tourne.f, pose.f);
  // Un quart de tour dans le repère du parent : (a,b) part sur (b,-a)… ou
  // plutôt, en composant à gauche par R(90) = [[0,-1],[1,0]] : a' = -b, b' = a.
  const pres = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, x + ' ≠ ' + y);
  pres(tourne.a, -pose.b); pres(tourne.b, pose.a);
  pres(tourne.c, -pose.d); pres(tourne.d, pose.c);
});

test('_rotation se relit dans ]-180, 180], comme sous Flash', async () => {
  const m = await moteur(0, 3, 25);
  const acc = m.racine.face.enfantNomme('ca').enfantNomme('c').enfantNomme('acc');
  const col2 = acc.enfantNomme('col2');
  assert.strictEqual(col2.rotationPosee(), 0, 'le placement n’a pas d’angle');
  for (const [pose, lu] of [[0, 0], [90, 90], [180, 180], [181, -179], [-190, 170], [720, 0]]) {
    col2.avmSet('_rotation', pose);
    assert.strictEqual(col2.avmGet('_rotation'), lu, pose + '° se relit ' + lu + '°');
  }
  // Et le tour de piste ne dérive pas : au bout de cent images, l'angle reste
  // borné là où Flash le borne.
  const m2 = await moteur(0, 3, 25);
  const c2 = m2.racine.face.enfantNomme('ca').enfantNomme('c').enfantNomme('acc').enfantNomme('col2');
  for (let i = 0; i < 100; i++) m2.avancer();
  assert.ok(c2.avmGet('_rotation') > -180 && c2.avmGet('_rotation') <= 180);
});

/* ── 3. LE LECTEUR DÉCIDE TOUT SEUL ───────────────────────────────────────── */

test('la vignette ne fige plus rien : c’est le moteur qui tranche', () => {
  assert.doesNotMatch(VIGNETTE, /anime: anime,/);
  assert.match(VIGNETTE, /anime: anime \? true : undefined/);
  // Plus de `super` imposé : `ajuster()` choisit ×4 au repos, ×2 en mouvement.
  assert.doesNotMatch(VIGNETTE, /super: anime \? 2 : undefined/);
  // `stopper` rend la main au moteur : un accessoire animé n'a jamais cessé.
  assert.match(VIGNETTE, /b\.moteur\.jouerAnim\(0\);\s*\n\s*b\.ajuster\(\);/);
  // Et `jouer` ne remonte plus la bouille pour changer de finesse.
  assert.doesNotMatch(VIGNETTE, /la qualité change : on remonte/);
});

test('ajuster() règle la finesse ET la boucle, aux trois portes du moteur', () => {
  assert.match(MOTEUR, /Bouille\.prototype\.ajuster = function \(\) \{[\s\S]*?const vivante = this\.anime === false \? false : this\.moteur\.enMouvement\(\);/);
  assert.match(MOTEUR, /if \(vivante\) this\.demarrer\(\); else this\.arreter\(\);/);
  for (const porte of ['definir', 'humeur', 'animer']) {
    assert.match(MOTEUR, new RegExp('Bouille\\.prototype\\.' + porte + ' = function[\\s\\S]{0,500}?ajuster\\(\\)'),
      porte + '() doit repasser par ajuster()');
  }
  // La boucle s'éteint d'elle-même quand le canevas quitte le document.
  assert.match(MOTEUR, /if \(self\.attache\) \{ if \(!self\.canvas\.isConnected\) \{ self\.arreter\(\); return; \} \}/);
});
