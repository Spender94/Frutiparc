/*
 * KALUGA — LA COMPOSITION D'UNE TEINTE, ET CE QU'ELLE COÛTE.
 *
 * Une transformation de couleur (le `cx` d'un placement : multiplier, puis
 * ajouter) ne se fait pas d'un trait sur un canevas : il faut dessiner
 * l'objet À PART, le multiplier, lui rajouter sa lumière, puis le recoller.
 * Le lecteur le fait donc hors écran, sur deux tampons.
 *
 * ── CE QUI N'ALLAIT PAS ───────────────────────────────────────────────────
 * Ces tampons faisaient la taille de la SCÈNE ENTIÈRE, et chaque étape —
 * effacer, recopier, remplir en « multiply », remplir en « lighter »,
 * découper deux fois en « destination-in », recoller — les parcourait en
 * entier. Pour UN objet, si petit soit-il.
 *
 * Burning Kiwi en fait la démonstration : son écran de fin de course lâche
 * vingt confettis, et un confetti porte une teinte (le reflet qui tourne,
 * sprite 436 : vingt-neuf images de `cx`). Vingt objets de dix-sept pixels,
 * et six passes sur 700 × 700 pour chacun. Mesuré au navigateur :
 *
 *     rendu d'une image : 89,9 ms   (donc sept images par seconde)
 *     les mêmes confettis sans le détour de teinte : 0,3 ms
 *
 * C'est tout le « lag au moment où le temps final s'affiche » : le résultat
 * de la course apparaît en même temps que les confettis.
 *
 * ── CE QU'ON FAIT ─────────────────────────────────────────────────────────
 * On borne la composition à la BOÎTE de l'objet : les tampons sont taillés
 * dessus (arrondis au multiple de 64 pour ne pas réallouer à chaque image),
 * la scène y est décalée du coin de la boîte, et tout le reste se joue en
 * (0, 0, largeur, hauteur). Un objet entièrement hors champ ne donne rien.
 *
 *     après : 2,1 ms pour la même image — quarante fois moins.
 *
 * Vérifié au navigateur, image contre image, sur les trois jeux qui
 * partagent ce lecteur : Burning Kiwi (menu, course, classement, stats),
 * Kaluga et MotionBall 2 — zéro pixel d'écart, sauf une quarantaine de
 * pixels de bord d'antialiasing (écart maximal 14/255) sur une courbe de
 * l'intro, que le rasteriseur place autrement selon la taille du tampon.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/*
 * Node n'a ni DOMMatrix ni canevas : on les pose, réduits à ce que le
 * lecteur leur demande. La matrice fait la vraie arithmétique — c'est elle
 * qu'on vérifie — et les contextes ne font que NOTER ce qu'on leur demande,
 * ce qui est précisément la question posée ici : sur quelle surface ?
 */
class FausseMatrice {
  constructor(m) {
    const v = m || [1, 0, 0, 1, 0, 0];
    this.a = v[0]; this.b = v[1]; this.c = v[2]; this.d = v[3]; this.e = v[4]; this.f = v[5];
  }
  multiply(o) {
    return new FausseMatrice([
      this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b,
      this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d,
      this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f,
    ]);
  }
  translateSelf(x, y) { this.e += this.a * x + this.c * y; this.f += this.b * x + this.d * y; return this; }
}
globalThis.DOMMatrix = FausseMatrice;

function faireContexte(journal, nom) {
  let T = new FausseMatrice();
  return {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    getTransform: () => T,
    setTransform: (m) => { T = (m && m.a !== undefined) ? m : new FausseMatrice([arguments]); },
    save() {}, restore() {}, transform() {}, clip() {}, beginPath() {},
    clearRect: (x, y, l, h) => journal.push({ q: nom + ':clear', x, y, l, h }),
    fillRect: (x, y, l, h) => journal.push({ q: nom + ':fill', x, y, l, h }),
    drawImage: (...a) => journal.push({ q: nom + ':image', a }),
  };
}
let journal = [];
globalThis.document = {
  createElement() {
    const c = { width: 0, height: 0 };
    c.getContext = () => { const x = faireContexte(journal, 'tampon'); x.canvas = c; return x; };
    return c;
  },
};

globalThis.window = undefined;
require(path.join(ROOT, 'public/kaluga/moteur/formes.js'));
require(path.join(ROOT, 'public/kaluga/moteur/flash.js'));
const K = globalThis.KalugaMoteur;

// Une scène nue : on n'appelle pas le constructeur (il veut un vrai canevas),
// on pose à la main les champs que la composition regarde.
function scene(l = 700, h = 700) {
  const s = Object.create(K.Scene.prototype);
  s.canvas = { width: l, height: h };
  s.tampons = [];
  s.niveauTeinte = 0;
  s.base = new FausseMatrice();
  return s;
}
// Un objet teinté : son cadre local, sa matrice, sa transformation de couleur.
function objet(cadre, matrice, cx) {
  return {
    $cx: cx || [128, 128, 128, 256, 0, 0, 0, 0],
    cadreLocal: () => cadre,
    matriceLocale: () => matrice || [1, 0, 0, 1, 0, 0],
  };
}

/* ── 1. LA BOÎTE ──────────────────────────────────────────────────────────── */

test('la boîte, c’est le cadre de l’objet passé par la matrice du moment', () => {
  const s = scene();
  const ctx = faireContexte([], 'x');
  // Le canevas est à deux pixels par unité (350 unités sur 700 pixels).
  ctx.setTransform(new FausseMatrice([2, 0, 0, 2, 0, 0]));
  const b = s.boiteDevice(ctx, objet([-10, -5, 10, 5], [1, 0, 0, 1, 100, 50]));
  // (90, 45) → (110, 55) en unités, donc (180, 90) → (220, 110) en pixels,
  // plus deux pixels de marge de chaque côté.
  assert.deepStrictEqual(b, { x: 178, y: 88, w: 44, h: 24 });
});

test('la boîte suit la rotation et l’échelle', () => {
  const s = scene();
  const ctx = faireContexte([], 'x');
  ctx.setTransform(new FausseMatrice([1, 0, 0, 1, 0, 0]));
  // Un carré de 20 tourné de 45° : sa boîte fait 20·√2 ≈ 28,3 de côté.
  const c = Math.cos(Math.PI / 4), n = Math.sin(Math.PI / 4);
  const b = s.boiteDevice(ctx, objet([-10, -10, 10, 10], [c, n, -n, c, 200, 200]));
  assert.ok(Math.abs(b.w - (Math.ceil(20 * Math.SQRT2) + 5)) <= 2, 'largeur ' + b.w);
  assert.strictEqual(b.w, b.h, 'carré tourné : boîte carrée');
});

test('la boîte est bornée au canevas, et vide si l’objet est hors champ', () => {
  const s = scene(700, 700);
  const ctx = faireContexte([], 'x');
  ctx.setTransform(new FausseMatrice([2, 0, 0, 2, 0, 0]));
  const dedans = s.boiteDevice(ctx, objet([-1000, -1000, 1000, 1000], [1, 0, 0, 1, 175, 175]));
  assert.deepStrictEqual(dedans, { x: 0, y: 0, w: 700, h: 700 }, 'jamais plus grand que le canevas');
  const dehors = s.boiteDevice(ctx, objet([-5, -5, 5, 5], [1, 0, 0, 1, -900, -900]));
  assert.strictEqual(dehors.w, 0, 'hors champ : rien à composer');
});

test('sans cadre calculable, on ne devine pas : c’est le canevas entier', () => {
  const s = scene(640, 480);
  const ctx = faireContexte([], 'x');
  assert.strictEqual(s.boiteDevice(ctx, objet(null)), null);
  const journalX = [];
  const ctx2 = faireContexte(journalX, 'x');
  s.dessinerObjet = () => {};
  s.dessinerTeinte(ctx2, objet(null), 1, () => {});
  const fin = journalX.filter((o) => o.q === 'x:image').pop();
  assert.ok(fin, 'le recollage a bien eu lieu');
  assert.deepStrictEqual(fin.a.slice(1), [0, 0, 640, 480, 0, 0, 640, 480], 'plein canevas');
});

/* ── 2. CE QUE LA COMPOSITION TOUCHE ──────────────────────────────────────── */

function composer(s, obj, ctxJournal) {
  journal = ctxJournal;
  const ctx = faireContexte(ctxJournal, 'scene');
  ctx.setTransform(new FausseMatrice([2, 0, 0, 2, 0, 0]));
  s.dessinerObjet = (c, o, a, contenu) => { if (contenu) contenu(c, a); };
  s.dessinerTeinte(ctx, obj, 1, () => {});
  return ctx;
}

test('un petit objet ne fait travailler qu’un petit rectangle', () => {
  const s = scene(700, 700);
  const j = [];
  // Un confetti : dix-sept unités de côté, donc trente-quatre pixels.
  composer(s, objet([-8.5, -8.5, 8.5, 8.5], [1, 0, 0, 1, 100, 100],
    [238, 238, 238, 256, 18, 18, 18, 0]), j);
  const surfaces = j.filter((o) => o.q.endsWith(':clear') || o.q.endsWith(':fill'));
  assert.ok(surfaces.length >= 3, 'la composition a bien eu lieu : ' + surfaces.length);
  for (const o of surfaces) {
    assert.ok(o.l <= 42 && o.h <= 42, 'surface parcourue : ' + o.l + '×' + o.h + ' (attendu ~38)');
    assert.strictEqual(o.x, 0, 'dans le tampon, tout part du coin');
    assert.strictEqual(o.y, 0);
  }
  // …et le recollage se fait À LA BONNE PLACE sur la scène.
  const fin = j.filter((o) => o.q === 'scene:image').pop();
  assert.ok(fin, 'le recollage a bien eu lieu');
  const [, sx, sy, sl, sh, dx, dy, dl, dh] = fin.a;
  assert.deepStrictEqual([sx, sy], [0, 0], 'pris au coin du tampon');
  assert.deepStrictEqual([sl, sh], [dl, dh], 'un pour un, jamais redimensionné');
  assert.ok(dx >= 178 && dx <= 184, 'posé sur l’objet : x=' + dx);
  assert.ok(dy >= 178 && dy <= 184, 'posé sur l’objet : y=' + dy);
  // La preuve par le contraire : le plein canevas, c'était 490 000 pixels
  // par passe ; ici moins de deux mille.
  assert.ok(surfaces.every((o) => o.l * o.h < 2000), 'moins de deux mille pixels par passe');
});

test('un objet hors champ ne fait rien du tout', () => {
  const s = scene(700, 700);
  const j = [];
  composer(s, objet([-5, -5, 5, 5], [1, 0, 0, 1, -900, 0]), j);
  assert.deepStrictEqual(j.filter((o) => o.q !== 'scene:transform'), [], 'aucune passe');
  assert.strictEqual(s.niveauTeinte, 0, 'et le compteur de niveaux reste d’aplomb');
});

test('les teintes imbriquées prennent chacune leur tampon', () => {
  const s = scene(700, 700);
  const j = [];
  journal = j;
  const ctx = faireContexte(j, 'scene');
  ctx.setTransform(new FausseMatrice([2, 0, 0, 2, 0, 0]));
  const interieur = objet([-4, -4, 4, 4], [1, 0, 0, 1, 100, 100]);
  let niveauVu = -1;
  s.dessinerObjet = (c, o, a, contenu) => {
    if (o !== interieur) { niveauVu = s.niveauTeinte; s.dessinerTeinte(c, interieur, a, () => {}); }
    else if (contenu) contenu(c, a);
  };
  s.dessinerTeinte(ctx, objet([-20, -20, 20, 20], [1, 0, 0, 1, 100, 100]), 1, () => {});
  assert.strictEqual(niveauVu, 1, 'la teinte du dedans travaille un cran plus loin');
  assert.strictEqual(s.niveauTeinte, 0, 'et le compteur revient à zéro');
  assert.ok(s.tampons.length >= 4, 'quatre tampons : deux par niveau');
});

/* ── 3. LES TAMPONS ───────────────────────────────────────────────────────── */

test('un tampon se taille sur la demande, par multiples de 64', () => {
  const s = scene();
  const t = s.tampon(0, 30, 200);
  assert.strictEqual(t.canvas.width, 64, 'jamais plus petit que 64');
  assert.strictEqual(t.canvas.height, 256);
});

test('un tampon ne se réalloue pas pour une demande qu’il couvre déjà', () => {
  const s = scene();
  const t = s.tampon(0, 200, 200);
  const l = t.canvas.width, h = t.canvas.height;
  s.tampon(0, 190, 150);
  assert.strictEqual(t.canvas.width, l, 'même largeur : pas de réallocation');
  assert.strictEqual(t.canvas.height, h);
  // …mais il redescend quand il devient franchement trop grand (un fond
  // plein écran teinté ne doit pas garder sa mémoire pour la suite) : au-delà
  // du quadruple de ce qu'on demande, il se retaille.
  s.tampon(0, 400, 400);
  assert.strictEqual(t.canvas.width, 448, 'il a d’abord grandi');
  s.tampon(0, 20, 20);
  assert.strictEqual(t.canvas.width, 64, 'puis rendu la place');
});

test('un tampon grandit quand il le faut, sans dépasser la borne', () => {
  const s = scene();
  const t = s.tampon(1, 100, 100);
  s.tampon(1, 900, 700);
  assert.ok(t.canvas.width >= 900 && t.canvas.height >= 700, 'il a grandi');
  s.tampon(1, 99999, 99999);
  assert.ok(t.canvas.width <= 4096 && t.canvas.height <= 4096, 'et reste borné');
});
