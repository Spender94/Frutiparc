/*
 * LE LECTEUR SWF PARTAGÉ — DEUX ÉCARTS VISUELS, ET LEUR REMÈDE.
 *
 * Un joueur de Burning Kiwi le dit en deux phrases : « on aperçoit les
 * contours des éléments, c'est assez disgracieux » et « j'ai l'impression que
 * la luminosité du jeu est plus élevée que sur l'original ». Deux défauts,
 * deux causes, toutes deux dans public/kaluga/moteur — donc dans les trois
 * portages qui partagent ce lecteur (Burning Kiwi, Kaluga, MotionBall 2).
 *
 * ── 1. LA LUMIÈRE ─────────────────────────────────────────────────────────
 * Un placement Flash porte une transformation de couleur : multiplier chaque
 * composante par m/256, puis AJOUTER un décalage de −255 à +255. Le lecteur
 * la composait à coups de « multiply » et de « lighter ». Or `lighter` ne
 * sait qu'ajouter : le code bornait donc les décalages à zéro, et tout
 * ASSOMBRISSEMENT était jeté.
 *
 * La piste de Burning Kiwi en porte justement un : son clip `track` a
 * cx = [256, 256, 256, 256, −70, −70, −21, 0]. Le jeu se jouait donc dans une
 * lumière qu'il n'a jamais eue — et les voitures, elles, portent un décalage
 * POSITIF (+70), d'où l'impression qu'elles brillaient. Mesuré au navigateur
 * sur Green Hill, luminance moyenne de l'image : 133,96 avant, 70,08 sous
 * Ruffle, 69,79 après.
 *
 * On pose désormais un `feColorMatrix` — qui fait le calcul exact, décalages
 * négatifs compris — par `ctx.filter`. `matriceCouleur` en est l'arithmétique.
 *
 * ── 2. LES CONTOURS ───────────────────────────────────────────────────────
 * Une forme du SWF pave son plan : l'herbe, la route, chaque touffe de décor
 * sont des surfaces JOINTIVES d'un même dessin. Flash les rasterise ensemble.
 * Le canevas, lui, remplit un chemin à la fois : sur un bord partagé, le
 * premier couvre le pixel à 60 %, le second aux 40 % restants… du RESTE. Il
 * manque toujours un quart de couverture, et c'est le fond du tampon —
 * transparent — qui transparaît : un trait clair AUTOUR DE CHAQUE ÉLÉMENT.
 *
 * Le remède est de faire déborder chaque remplissage d'un demi-pixel sur son
 * voisin. Encore faut-il savoir OÙ : déborder partout épaissirait la
 * silhouette des dessins isolés (les boules du menu de MotionBall 2 y ont
 * gagné un liseré, essai fait). Or le SWF le dit lui-même — une arête sait
 * quel remplissage elle a à gauche et lequel à droite, et l'extracteur la
 * range dans les deux tracés, à l'endroit pour l'un, à l'envers pour l'autre.
 * Une arête vue DEUX FOIS est une couture ; vue une fois, une silhouette.
 * `cheminsDebord` fait ce relevé.
 *
 * Mesuré au navigateur, pixels en creux sur Green Hill : 1 538 avant, 624
 * sous Ruffle, 614 après. Écart moyen au SWF : 0,87/255.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

globalThis.window = undefined;
require(path.join(ROOT, 'public/kaluga/moteur/formes.js'));
const K = globalThis.KalugaMoteur;

// flash.js veut un DOMMatrix au chargement des classes ; on lui en donne un
// muet, aucun des tests d'ici ne s'en sert.
globalThis.DOMMatrix = class { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
globalThis.document = { createElement: () => ({ getContext: () => null }) };
require(path.join(ROOT, 'public/kaluga/moteur/flash.js'));

/* ── 1. LA TRANSFORMATION DE COULEUR ──────────────────────────────────────── */

// Ce que le filtre fera d'une couleur, à la main (sRGB, non prémultipliée).
function appliquer(cx, r, g, b) {
  const m = K.matriceCouleur(cx);
  const bornee = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [
    bornee((m[0] * r + m[4] * 255)),
    bornee((m[6] * g + m[9] * 255)),
    bornee((m[12] * b + m[14] * 255)),
  ];
}

test('la transformation neutre ne touche à rien', () => {
  const m = K.matriceCouleur([256, 256, 256, 256, 0, 0, 0, 0]);
  assert.deepStrictEqual(m, [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
  assert.deepStrictEqual(appliquer([256, 256, 256, 256, 0, 0, 0, 0], 110, 151, 59), [110, 151, 59]);
});

test('les multiplicateurs sont sur 256, les décalages sur 255', () => {
  const m = K.matriceCouleur([128, 64, 0, 256, 255, -255, 51, 0]);
  assert.strictEqual(m[0], 0.5, 'rouge × 128/256');
  assert.strictEqual(m[6], 0.25, 'vert × 64/256');
  assert.strictEqual(m[12], 0, 'bleu × 0');
  assert.strictEqual(m[4], 1, 'décalage rouge +255 → +1');
  assert.strictEqual(m[9], -1, 'décalage vert −255 → −1');
  assert.ok(Math.abs(m[14] - 0.2) < 1e-9, 'décalage bleu +51 → +0,2');
});

test('le décalage NÉGATIF de la piste assombrit vraiment — c’était tout le défaut', () => {
  // Le clip `track` de Burning Kiwi.
  const cx = [256, 256, 256, 256, -70, -70, -21, 0];
  const m = K.matriceCouleur(cx);
  assert.ok(m[4] < 0 && m[9] < 0 && m[14] < 0, 'les trois décalages restent négatifs');
  // Un vert d'herbe du circuit Green Hill.
  assert.deepStrictEqual(appliquer(cx, 110, 151, 59), [40, 81, 38]);
  // L'ancienne composition bornait à zéro : elle rendait la couleur telle
  // quelle. C'est exactement ce qu'on ne veut plus.
  const borneeCommeAvant = [Math.max(0, cx[4]), Math.max(0, cx[5]), Math.max(0, cx[6])];
  assert.deepStrictEqual(borneeCommeAvant, [0, 0, 0], 'l’ancien code jetait ces trois valeurs');
});

test('les voitures, elles, s’éclaircissent — et le filtre borne à 255', () => {
  const cx = [256, 256, 256, 256, 70, 70, 70, 0];       // le clip `car_0`
  assert.deepStrictEqual(appliquer(cx, 110, 151, 59), [180, 221, 129]);
  assert.deepStrictEqual(appliquer(cx, 220, 240, 250), [255, 255, 255], 'jamais au-delà du blanc');
});

test('l’alpha du placement passe par le multiplicateur, pas par la matrice', () => {
  // dessinerTeinte force l'alpha de la matrice à 256 et applique l'opacité
  // par globalAlpha : le filtre ne doit donc jamais toucher à l'alpha.
  const m = K.matriceCouleur([256, 256, 256, 256, -70, -70, -21, 0]);
  assert.strictEqual(m[18], 1, 'alpha × 1');
  assert.strictEqual(m[19], 0, 'aucun décalage d’alpha');
});

/* ── 2. LES ARÊTES PARTAGÉES ──────────────────────────────────────────────── */

const rempli = (d) => ({ f: { c: '#123456', a: 1 }, d });
const nCoupures = (d) => (d.match(/M/g) || []).length;

test('deux carrés jointifs : seul le bord commun déborde', () => {
  // A = [0,0]→[10,10], B = [10,0]→[20,10] : ils partagent x = 10.
  // Les contours sont écrits ARÊTE PAR ARÊTE, comme les sort l'extracteur :
  // le `Z` final ne referme rien (le contour boucle déjà), et le relevé ne
  // compte donc jamais de segment implicite — une fermeture inventée par un
  // contour resté ouvert ne serait pas une arête du fichier.
  const a = rempli('M0 0L10 0L10 10L0 10L0 0Z');
  const b = rempli('M10 0L20 0L20 10L10 10L10 0Z');
  const [da, db] = K.cheminsDebord([a, b]);
  assert.ok(da && db, 'les deux tracés ont une couture');
  // Une seule arête chacun, et c'est le segment vertical x = 10.
  assert.strictEqual(nCoupures(da), 1, 'une seule polyligne : ' + da);
  assert.strictEqual(nCoupures(db), 1, 'une seule polyligne : ' + db);
  for (const d of [da, db]) {
    const n = d.match(/-?\d+(\.\d+)?/g).map(Number);
    assert.deepStrictEqual(n.slice().sort((x, y) => x - y), [0, 10, 10, 10], 'le bord x = 10 : ' + d);
  }
});

test('le sens de parcours est indifférent — l’extracteur retourne une arête sur deux', () => {
  const a = rempli('M0 0L10 0L10 10L0 10Z');
  // Le même bord, parcouru dans l'autre sens (10,10) → (10,0).
  const b = rempli('M10 10L10 0L20 0L20 10Z');
  const [da, db] = K.cheminsDebord([a, b]);
  assert.ok(da && db, 'la couture est vue des deux côtés');
});

test('un dessin d’un seul remplissage n’a pas de couture : sa silhouette est juste', () => {
  assert.deepStrictEqual(K.cheminsDebord([rempli('M0 0L10 0L10 10L0 10Z')]), [null]);
});

test('deux remplissages qui ne se touchent pas ne débordent pas non plus', () => {
  const a = rempli('M0 0L10 0L10 10L0 10Z');
  const b = rempli('M50 0L60 0L60 10L50 10Z');
  assert.deepStrictEqual(K.cheminsDebord([a, b]), [null, null]);
});

test('une courbe ne fait couture que si sa POIGNÉE de contrôle est la même', () => {
  const a = rempli('M0 0Q5 5 10 0L10 10L0 10Z');
  const meme = rempli('M10 0Q5 5 0 0L0 -10L10 -10Z');
  const autre = rempli('M10 0Q5 -5 0 0L0 -10L10 -10Z');
  assert.ok(K.cheminsDebord([a, meme])[0], 'même courbe : couture');
  assert.strictEqual(K.cheminsDebord([a, autre])[0], null, 'autre courbure : deux bords distincts');
});

test('des arêtes partagées qui se suivent font UNE polyligne, pas dix segments', () => {
  // Un escalier de quatre marches entre deux surfaces.
  const bord = 'L2 1L4 2L6 3L8 4';
  const a = rempli('M0 0' + bord + 'L8 -6L0 -6Z');
  const b = rempli('M0 0' + bord + 'L8 10L0 10Z');
  const [da] = K.cheminsDebord([a, b]);
  assert.strictEqual(nCoupures(da), 1, 'un seul M : ' + da);
  assert.strictEqual((da.match(/L/g) || []).length, 4, 'les quatre marches : ' + da);
});

test('le trait (op.s) n’entre pas dans le relevé : il a sa propre largeur', () => {
  const a = rempli('M0 0L10 0L10 10L0 10Z');
  const trait = { s: { w: 1, c: '#000', a: 1 }, d: 'M0 0L10 0L10 10L0 10Z' };
  const r = K.cheminsDebord([a, trait]);
  assert.deepStrictEqual(r, [null, null], 'le remplissage ne se croit pas jointif de son propre trait');
});

test('deux glyphes au même dessin mais à deux places ne sont pas voisins', () => {
  // Les textes figés posent chaque glyphe par sa matrice : deux « o » d'un
  // même mot ont le MÊME chemin. Sans le préfixe, on les croirait jointifs.
  const o1 = { f: { c: '#000', a: 1 }, d: 'M0 0L4 0L4 6L0 6Z', m: [1, 0, 0, 1, 10, 0] };
  const o2 = { f: { c: '#000', a: 1 }, d: 'M0 0L4 0L4 6L0 6Z', m: [1, 0, 0, 1, 30, 0] };
  assert.deepStrictEqual(K.cheminsDebord([o1, o2]), [null, null]);
  // …et deux glyphes à la même place, eux, le sont bel et bien.
  const o3 = Object.assign({}, o1);
  assert.ok(K.cheminsDebord([o1, o3])[0], 'même matrice, même chemin : couture');
});

/* ── 3. SUR LES VRAIES DONNÉES ────────────────────────────────────────────── */

function dessinsDe(fichier) {
  const out = [];
  const visite = (o) => {
    if (Array.isArray(o)) o.forEach(visite);
    else if (o && typeof o === 'object') {
      if (Array.isArray(o.ops) && o.ops.some((x) => x && (x.f || x.s))) out.push(o);
      for (const k in o) visite(o[k]);
    }
  };
  visite(JSON.parse(fs.readFileSync(path.join(ROOT, fichier), 'utf8')));
  return out;
}

test('le décor de Green Hill est bien un pavage : presque tous ses tracés ont une couture', () => {
  const dessins = dessinsDe('public/bkiwi/data/track00.json');
  const decor = dessins.slice().sort((a, b) => b.ops.length - a.ops.length)[0];
  assert.ok(decor.ops.length > 100, 'le grand dessin du circuit : ' + decor.ops.length + ' tracés');
  const chemins = K.cheminsDebord(decor.ops);
  const avec = chemins.filter(Boolean).length;
  assert.ok(avec > decor.ops.length * 0.9, avec + ' tracés sur ' + decor.ops.length + ' ont une couture');
  // Et le débord reste une PART du tracé : on ne repasse pas tout le contour.
  for (let i = 0; i < chemins.length; i++) {
    if (!chemins[i]) continue;
    assert.ok(chemins[i].length <= decor.ops[i].d.length,
      'tracé ' + i + ' : débord ' + chemins[i].length + ' > chemin ' + decor.ops[i].d.length);
  }
});

test('aucun chemin des trois portages ne sort de la grammaire M/L/Q/Z', () => {
  // `cheminsDebord` relit les chemins à la main : si l'extracteur se mettait
  // un jour à écrire des cubiques ou des arcs, le relevé les manquerait en
  // silence. On préfère le savoir ici.
  const lus = new Set();
  let nOps = 0;
  for (const jeu of ['bkiwi', 'kaluga', 'mb2']) {
    const dossier = path.join(ROOT, 'public', jeu, 'data');
    if (!fs.existsSync(dossier)) continue;
    for (const f of fs.readdirSync(dossier)) {
      if (!f.endsWith('.json')) continue;
      for (const d of dessinsDe('public/' + jeu + '/data/' + f)) {
        for (const op of d.ops) {
          if (typeof op.d !== 'string') continue;
          nOps++;
          for (const c of op.d.match(/[A-Za-z]/g) || []) lus.add(c);
        }
      }
    }
  }
  assert.ok(nOps > 5000, 'on a bien relu tous les dessins : ' + nOps + ' tracés');
  assert.deepStrictEqual([...lus].sort().join(''), 'LMQZ');
});
