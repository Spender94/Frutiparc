'use strict';
/*
 * LA PAGE DE CHARGEMENT DU BUREAU — `loadingProcess` (#154), `loadingInit`
 * (0x08641), `updateLoadingSize` (0x087ba), `loadingLoop` (0x08a52).
 *
 * La première chose que main.swf montrait : un écran VERT, le mot CHARGEMENT,
 * et une BARRE ROSE qui se remplit — avec, dessous, le nombre de fichiers qui
 * restent et un mot d'explication.
 *
 * ── LA SCÈNE ─────────────────────────────────────────────────────────────
 * Ce n'est PAS le RECT du SWF (1024 × 768) : `updateLoadingSize` travaille sur
 * `_global.mcw` × `_global.mch`, que la toute première DoAction du fichier
 * (0x07fd0) pose à `baseMcw = 1265`, `baseMch = 768` — et que
 * `StageResize.onResize` y remet à chaque secousse avant de rappeler
 * `updateLoadingSize()` tant que `flLoading`. Tout s'exprime en MARGES, donc
 * tout se transpose à la fenêtre du navigateur :
 *
 *     mx = 32 ; b = 9 ; x0 = mx + b = 41 ; cy = mch / 2
 *     midMax = mcw − (mx + b) × 2       (la gouttière va de mx à mcw − mx)
 *     title._x     = mcw / 2   title._y     = cy − 24
 *     fieldInfo._x = mx        fieldInfo._y = cy + 16
 *     info._x      = mcw / 2   info._y      = cy + 32
 *     b1 · bgb1 · mid · bgmid → _x = x0, _y = cy   (les formes vont de −3 à 15)
 *     mid._width = coef × midMax    b2._x = b1._x + mid._width
 *
 * ── LES DESSINS ──────────────────────────────────────────────────────────
 * Deux clips à deux images seulement : `mid` (ch142, 10 × 18) et `bout`
 * (ch145, 9 × 18) — image 1 le remplissage, image 2 la gouttière. Le bout
 * DROIT est le même dessin posé avec `a = −1` : un miroir.
 *
 * ── LA LOI ───────────────────────────────────────────────────────────────
 *     ratio = (mLoaded + iLoaded) / (mTotal + iTotal)
 *     coef  = coef × 0,9 + ratio × 0,1              (une fois par image, 100/s)
 *     fieldInfo.text = « fichiers restants : » + round((1 − coef) × 100) + « % »
 *     fini quand tout est là ET coef > 0,995
 *
 * DEUX CHOSES D'ÉPOQUE QU'ON GARDE : la barre MONTE pendant que le nombre
 * DESCEND (le texte par défaut du champ dit « fichiers téléchargés », preuve
 * que l'un des deux a changé sans l'autre), et le plancher d'une demi-seconde
 * (0,9⁵⁰ ≈ 0,005 : il faut une cinquantaine d'images pour franchir 0,995).
 *
 * Mesuré au banc (Playwright, banc-chargement.js) en 1265 × 768 : la gouttière
 * tient x 32..1233 avec un milieu de 1183 (= midMax), le ruban part de x 41,
 * son bout droit le suit, le titre est en (559 ; 349,5), le champ en (30 ; 398)
 * et le bloc d'information en (534,11 ; 409,5) — au dixième les valeurs du
 * SWF. La page reste 0,65 s à froid, 1,9 s cache chaud, puis disparaît.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const SPRITES = path.join(ROOT, 'public/frutiz/sprites');
const MANIFESTE = JSON.parse(fs.readFileSync(path.join(SPRITES, 'chargement.json'), 'utf8'));

// Le bloc de la page dans la feuille de style, isolé une fois pour toutes.
const BLOC = CSS.slice(CSS.indexOf('body.bureau-frutiz #fb-chargement {'));

/* ── LA SCÈNE D'ÉPOQUE ────────────────────────────────────────────────────── */

test('la scène est celle de `baseMcw` × `baseMch`, pas le RECT du SWF', () => {
  assert.deepStrictEqual(MANIFESTE.scene, { w: 1265, h: 768 });
  assert.strictEqual(MANIFESTE.fond, '#ADE76B');       // SetBackgroundColor
  assert.strictEqual(MANIFESTE.encre, '#4D7614');      // les quatre EditText
});

test('les marges de `updateLoadingSize` sont celles du bytecode', () => {
  const g = MANIFESTE.geometrie;
  assert.strictEqual(g.mx, 32);
  assert.strictEqual(g.b, 9);
  assert.strictEqual(g.x0, g.mx + g.b);
  assert.strictEqual(g.hauteur, 18);
  assert.strictEqual(g.haut, -3);
  // les trois décalages verticaux, comptés depuis cy
  assert.strictEqual(g.dyTitre, -24);
  assert.strictEqual(g.dyChamp, 16);
  assert.strictEqual(g.dyInfo, 32);
  // midMax = mcw − (mx + b) × 2 : 1183 pour la scène d'époque
  assert.strictEqual(MANIFESTE.scene.w - g.x0 * 2, 1183);
});

/* ── LA BARRE ─────────────────────────────────────────────────────────────── */

test('la barre couvre exactement mx → mcw − mx, bouts compris', () => {
  // `.ch-barre` est posée à 32 de chaque bord : sa largeur vaut donc
  // midMax + 18, les deux bouts de 9 compris.
  assert.match(BLOC, /#fb-chargement \.ch-barre \{\s*\n\s*position: absolute; left: 32px; right: 32px;/);
  assert.match(BLOC, /top: 50%; margin-top: -3px; height: 18px;/);
});

test('le ruban vaut `coef × midMax`, et son bout droit le suit', () => {
  // `.ch-ruban` part de x0 (9 après le bord de la barre) et retranche les deux
  // bouts de la largeur mesurée : c'est `mid._width = coef × midMax`.
  assert.match(BLOC, /#fb-chargement \.ch-ruban \{[^}]*left: 9px;[^}]*width: calc\(var\(--ch-coef\) \* \(100% - 18px\)\);/);
  // `b2._x = b1._x + mid._width` : le bout droit est collé à la fin du ruban.
  assert.match(BLOC, /#fb-chargement \.ch-b2 \{ left: 100%; transform: scaleX\(-1\); \}/);
  // et le bout gauche déborde DEVANT (son dessin va de −9 à 0)
  assert.match(BLOC, /#fb-chargement \.ch-b1 \{ left: -9px; \}/);
});

test('le bout droit est le bout gauche EN MIROIR (matrice a = −1)', () => {
  // Un seul dessin pour les deux côtés, dans la gouttière comme dans le ruban.
  assert.match(BLOC, /\.ch-g1,\s*\nbody\.bureau-frutiz #fb-chargement \.ch-g2 \{\s*\n\s*width: 9px; background-image: url\('\/frutiz\/sprites\/chargement-bout-vide\.svg'\);/);
  assert.match(BLOC, /#fb-chargement \.ch-g2 \{ right: 0; transform: scaleX\(-1\); \}/);
  assert.match(BLOC, /\.ch-b1,\s*\nbody\.bureau-frutiz #fb-chargement \.ch-b2 \{\s*\n\s*width: 9px; background-image: url\('\/frutiz\/sprites\/chargement-bout-plein\.svg'\);/);
});

test('les quatre dessins sortent du SWF et sont là', () => {
  for (const nom of ['milieu-plein', 'milieu-vide', 'bout-plein', 'bout-vide']) {
    const p = path.join(SPRITES, 'chargement-' + nom + '.svg');
    assert.ok(fs.existsSync(p), 'chargement-' + nom + '.svg manque');
    // `preserveAspectRatio="none"` : le milieu s'étire sans déformer ses bords.
    assert.match(fs.readFileSync(p, 'utf8'), /preserveAspectRatio="none"/);
  }
  // Les cadres relevés : le milieu 10 × 18 à partir de y = −3, le bout 9 × 18
  // de x = −9 à 0 — le bout gauche couvre donc mx..x0.
  assert.deepStrictEqual(MANIFESTE.milieuPlein.cadre, { x: 0, y: -3, w: 10, h: 18 });
  assert.deepStrictEqual(MANIFESTE.boutPlein.cadre, { x: -9, y: -3, w: 9, h: 18 });
});

test('la barre est ROSE et la gouttière VERTE — relevé sur les formes', () => {
  const plein = fs.readFileSync(path.join(SPRITES, 'chargement-milieu-plein.svg'), 'utf8');
  // une bande blanche de 18, un ruban de 12 en dégradé, un reflet blanc
  assert.match(plein, /fill="#ffffff"/);
  assert.match(plein, /stop-color="#bb1e1e"/);
  assert.match(plein, /stop-color="#ee9595"/);
  assert.match(plein, /stop-color="#ffc1c1"/);
  const vide = fs.readFileSync(path.join(SPRITES, 'chargement-milieu-vide.svg'), 'utf8');
  assert.match(vide, /fill="#dbf3ba"/);            // le liseré clair
  assert.match(vide, /fill="#8fcf5a"/);            // le corps de la gouttière
});

/* ── LES QUATRE CHAMPS ────────────────────────────────────────────────────── */

test('chaque champ est posé sur le RECT de son DefineEditText', () => {
  const b = MANIFESTE.boites;
  // #149 « CHARGEMENT » : RECT (−2,−2)–(145 ; 19,05) posé à (−71,5 ; −8,5)
  // dans `title`, lui-même à (mcw / 2 ; cy − 24).
  assert.deepStrictEqual([b.titre.dx, b.titre.dy, b.titre.l, b.titre.h], [-73.5, -34.5, 147, 21.05]);
  assert.match(BLOC, /#fb-chargement \.ch-titre \{\s*\n\s*left: 50%; margin-left: -73\.5px; top: 50%; margin-top: -34\.5px;\s*\n\s*width: 147px; height: 21\.05px; font-size: 14px; font-weight: 700;/);
  // #147 `fieldInfo` : ancré à GAUCHE sur mx, la gouttière de 2 px mettant le
  // premier glyphe pile sur 32.
  assert.deepStrictEqual([b.champ.x, b.champ.dy, b.champ.l, b.champ.h], [30, 14, 491.1, 17.7]);
  assert.match(BLOC, /#fb-chargement \.ch-champ \{\s*\n\s*left: 30px; top: 50%; margin-top: 14px;\s*\n\s*width: 491\.1px; height: 17\.7px; font-size: 10px;/);
  assert.match(BLOC, /#fb-chargement \.ch-champ \{[^}]*text-align: left;/);
  // #152 « Information : » et #151 la phrase, dans `info` à (mcw / 2 ; cy + 32)
  assert.deepStrictEqual([b.infoTitre.dx, b.infoTitre.dy], [-98.4, 25.5]);
  assert.match(BLOC, /#fb-chargement \.ch-info-titre \{\s*\n\s*left: 50%; margin-left: -98\.4px; top: 50%; margin-top: 25\.5px;/);
  assert.deepStrictEqual([b.info.dx, b.info.dy, b.info.l], [-99.75, 41.45, 199.5]);
  assert.match(BLOC, /#fb-chargement \.ch-info \{\s*\n\s*left: 50%; margin-left: -99\.75px; top: 50%; margin-top: 41\.45px;\s*\n\s*width: 199\.5px; height: 123\.5px; font-size: 10px; line-height: 16\.32px;/);
});

test('l’interligne remet la base du texte où Flash la met', () => {
  // Un EditText a une gouttière de 2 px et pose sa première base à
  // `y0 + 2 + ascendante`. Verdana (police #148) déclare 1030/1024 d'ascendante
  // et 215/1024 de descendante : une boîte d'UNE ligne fait donc
  // 2 + (1,0059 + 0,21) × h + 2, et poser `line-height` égal à cette hauteur
  // rend une demi-interligne de 2 — la gouttière, exactement.
  for (const nom of ['titre', 'infoTitre']) {
    const b = MANIFESTE.boites[nom];
    assert.strictEqual(b.ligne, b.h, nom + ' : l’interligne doit valoir la boîte');
  }
  // Le TITRE est la preuve : sa boîte a été dimensionnée par Flash sur le
  // texte, et elle tombe au centième sur la formule.
  const titre = MANIFESTE.boites.titre;
  const calcule = 2 + (1030 / 1024 + 215 / 1024) * titre.police + 2;
  assert.ok(Math.abs(calcule - titre.h) < 0.05, calcule + ' ≠ ' + titre.h);
  // « Information : » est un champ MULTILIGNE dont la boîte a été tirée à la
  // main (et posé avec un `d = 1,00311` dans sa matrice) : un dixième de moins
  // que la formule. On garde son RECT, c'est lui qui fait foi.
  assert.ok(Math.abs(2 + (1030 / 1024 + 215 / 1024) * 10 + 2 - MANIFESTE.boites.infoTitre.h) < 0.15);
  assert.match(BLOC, /#fb-chargement \.ch-titre \{[^}]*line-height: 21\.05px;/);
  assert.match(BLOC, /#fb-chargement \.ch-info-titre \{[^}]*line-height: 16\.05px;/);
  // Un PARAGRAPHE avance de ascendante + descendante + interligne de police
  // (221/1024) + interligne du champ (2) : 16,32 pour une fonte de 10.
  const paragraphe = (1030 + 215 + 221) / 1024 * 10 + 2;
  assert.ok(Math.abs(paragraphe - MANIFESTE.boites.info.ligne) < 0.02);
});

test('les mots sont ceux du SWF, à la lettre', () => {
  assert.strictEqual(MANIFESTE.textes.titre, 'CHARGEMENT');
  assert.strictEqual(MANIFESTE.textes.prefixe, 'fichiers restants : ');
  assert.strictEqual(MANIFESTE.textes.infoTitre, 'Information :');
  assert.match(JS, /var CH_TITRE = 'CHARGEMENT';/);
  assert.match(JS, /var CH_PREFIXE = 'fichiers restants : ';/);
  assert.match(JS, /var CH_INFO_TITRE = 'Information :';/);
  // La phrase d'époque, apostrophes typographiques mises à part.
  const norm = (s) => s.replace(/[’']/g, "'");
  const dansJs = /var CH_INFO = '([^']*(?:'[^']*)*?)'\s*\n\s*\+ '([^']*)';/.exec(
    JS.slice(JS.indexOf('var CH_INFO =')).slice(0, 400));
  assert.ok(dansJs, 'CH_INFO introuvable');
  assert.strictEqual(norm(dansJs[1] + dansJs[2]), norm(MANIFESTE.textes.info));
});

/* ── LA LOI DU RUBAN ──────────────────────────────────────────────────────── */

test('le lissage et le seuil sont ceux de `loadingLoop`', () => {
  assert.strictEqual(MANIFESTE.loi.lissage, 0.9);
  assert.strictEqual(MANIFESTE.loi.seuil, 0.995);
  assert.strictEqual(MANIFESTE.loi.cadence, 100);
  assert.match(JS, /var CH_LISSAGE = 0\.9;/);
  assert.match(JS, /var CH_SEUIL = 0\.995;/);
  // 100 im/s → une image d'époque vaut 10 ms
  assert.match(JS, /var CH_CADENCE = 10;/);
  assert.strictEqual(1000 / MANIFESTE.loi.cadence, 10);
});

test('la constante de temps est gardée, pas le compte d’images', () => {
  // `coef − ratio` est multiplié par 0,9 tous les 10 ms : la forme fermée rend
  // la valeur d'époque pour un intervalle quelconque (60 Hz compris).
  assert.match(JS, /coef = ratio \+ \(coef - ratio\) \* Math\.pow\(CH_LISSAGE, dt \/ CH_CADENCE\);/);
  // vérification numérique : la récurrence pas à pas et la forme fermée
  const pasAPas = (n) => { let c = 0; for (let i = 0; i < n; i++) c = c * 0.9 + 1 * 0.1; return c; };
  assert.ok(Math.abs(pasAPas(50) - (1 + (0 - 1) * Math.pow(0.9, 500 / 10))) < 1e-12);
  // LE PLANCHER : partant de coef = 0 avec tout déjà là, il faut 51 images
  // d'époque pour franchir 0,995 — soit 510 ms. La page ne clignote jamais.
  assert.ok(pasAPas(50) <= 0.995, 'cinquante images ne suffisent pas : ' + pasAPas(50));
  assert.ok(pasAPas(51) > 0.995, 'la cinquante-et-unième franchit le seuil');
  assert.ok(51 * (1000 / MANIFESTE.loi.cadence) > 500);
});

test('la barre MONTE pendant que le nombre DESCEND — le bug d’origine', () => {
  assert.match(JS, /champ\.textContent = CH_PREFIXE \+ Math\.round\(\(1 - c\) \* 100\) \+ '%';/);
  // et la largeur, elle, suit `coef` : les deux vont en sens contraire
  assert.match(JS, /page\.style\.setProperty\('--ch-coef', String\(c\)\);/);
});

test('« fini » reprend les trois conditions du bytecode', () => {
  assert.match(JS, /if \(pret && regles === total && coef > CH_SEUIL\) \{ fermer\(\); return; \}/);
  // `lp.removeMovieClip()` : la page s'enlève, sans fondu.
  assert.match(JS, /if \(page\.parentNode\) page\.parentNode\.removeChild\(page\);/);
});

test('le ratio reste à zéro tant que le total n’est pas connu', () => {
  // `mTotal` était connu dès la première image ; sans cette garde le ruban
  // avancerait puis RECULERAIT quand le second inventaire arrive.
  assert.match(JS, /var ratio = pret \? \(total \? regles \/ total : 1\) : 0;/);
});

/* ── CE QUE LA PAGE PRÉCHARGE ─────────────────────────────────────────────── */

test('« tous les éléments de l’interface » : la promesse est tenue', () => {
  assert.ok(Array.isArray(MANIFESTE.interface));
  assert.ok(MANIFESTE.interface.length > 100,
    'la liste ne compte que ' + MANIFESTE.interface.length + ' dessins');
  for (const u of MANIFESTE.interface) {
    // LES PNG COMPTENT AUSSI : les cinquante et un dessins de FEUTRES sont des
    // bitmaps découpés dans le #595, pas des tracés. Les exclure, c'était les
    // laisser hors du préchargement — et la barre des feutres clignotait au
    // premier survol, le défaut même que cette page est censée effacer.
    assert.match(u, /^\/frutiz\/sprites\/[^/]+\.(svg|png)$/);
    assert.ok(fs.existsSync(path.join(SPRITES, path.basename(u))), u + ' manque');
    assert.ok(!/^chargement-/.test(path.basename(u)),
      'la barre ne se précharge pas elle-même');
  }
  const feutres = MANIFESTE.interface.filter((u) => /\/feutre-/.test(u));
  assert.ok(feutres.length >= 51,
    'les feutres doivent être préchargés (relevé : ' + feutres.length + ')');
  // Deux inventaires : la liste du SWF et les images de la feuille de style.
  assert.match(JS, /fetch\('\/frutiz\/sprites\/chargement\.json', \{ cache: 'force-cache' \}\)/);
  assert.match(JS, /fetch\('\/bureau-frutiz\.css', \{ cache: 'force-cache' \}\)/);
  assert.match(JS, /var restants = 2;/);
  // une image absente compte quand même : sinon la page ne finirait jamais
  assert.match(JS, /img\.onload = arrive; img\.onerror = arrive;/);
});

/* ── L'INSERTION DANS LE BUREAU ───────────────────────────────────────────── */

test('la page passe devant tout et s’ouvre dès `demarrer()`', () => {
  assert.match(JS, /document\.body\.classList\.add\('bureau-frutiz'\);\n(?:\s*\/\/[^\n]*\n)*\s*ouvrirChargement\(\);/);
  assert.match(BLOC, /position: fixed; inset: 0; z-index: 5000; overflow: hidden;/);
  assert.match(BLOC, /background: #ADE76B;/);
  // on ne l'ouvre qu'une fois
  assert.match(JS, /if \(pageChargement\) return;/);
});

test('le mobile ne voit rien : tout est sous `body.bureau-frutiz`', () => {
  const regles = BLOC.split('\n').filter((l) => /^[^\s].*\{\s*$|^[^\s].*\{/.test(l));
  for (const r of regles) {
    if (!/#fb-chargement/.test(r)) continue;
    assert.ok(/^body\.bureau-frutiz /.test(r), 'règle hors du bureau : ' + r);
  }
});
