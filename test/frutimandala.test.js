/*
 * LA FRUTIMANDALA du bureau light — ses deux cadrans, son heure, ses boutons.
 *
 * `cp.WheelMng` (DoInitAction 0x6a7c2) tient DEUX faces et les échange :
 *
 *     list = ["whDayNight", "whFruitMonth"]  puis  swapWheel()
 *
 * — `currentPos` passe de 0 à 1, donc la roue des FRUTISIGNES paraît en
 * premier, et le bouton « G » (pressSwap) fait tourner l'autre à sa place.
 * Ce fichier tient les quatre moitiés de la ressemblance :
 *
 *   · les DESSINS — le bol qui découpe (`mask` #609), le verre (#639), les
 *     deux cadrans (wheel1.swf et wheel0.swf) et les onze glyphes de la bande
 *     `police`, tous tirés des SWF par scripts/extract-frutiz-bureau.js ;
 *   · l'HEURE — `wheel.DayNight` : dayCoef = (h + m/60) / 24, setRot ×360, et
 *     « HH:MM » écrit DROIT au centre par `ext.game.Numb.setNum` (échelle 85,
 *     _y 52, un glyphe par caractère à sa largeur propre) ;
 *   · l'ÉCHANGE — `animDisk` : accel −= tmod/90, r = (1+accel)^tmod, le
 *     plateau vire de turning×6, l'ancienne roue s'efface puis meurt ;
 *   · le REPLI — `MainBar.toggleHalfHide` : la barre monte de 220, la frusion
 *     suit deux fois moins vite, cornerY tombe de 106 à 10 et la languette
 *     « mode rapide » reste seule en haut à gauche.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SPRITES = path.join(ROOT, 'public/frutiz/sprites');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');

test('les deux cadrans, le bol et le verre sortent des SWF', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(SPRITES, 'bureau.json'), 'utf8'));
  // Le châssis : le bol qui DÉCOUPE (prof. 1) et le verre (prof. 25), au même
  // cadre — celui du clip cpWheelMng.
  for (const cle of ['frutimandala-masque', 'frutimandala-dessus']) {
    const c = manifeste[cle].cadre;
    assert.deepStrictEqual(c, { x: -6.3, y: -4.35, w: 200, h: 80 }, cle + ' : cadre du clip');
    assert.ok(fs.statSync(path.join(SPRITES, cle + '.svg')).size > 300, cle + ' est vide');
  }
  // Les deux peaux, chargées d'ordinaire depuis /wheel/wheel<i>.swf.
  assert.deepStrictEqual(manifeste.frutimandalaRoue.cadre,
    { x: -126.01, y: -125.99, w: 252.01, h: 252.01 }, 'la roue des frutisignes');
  assert.deepStrictEqual(manifeste.frutimandalaJour.cadre,
    { x: -102, y: -102, w: 204, h: 204 }, 'le cadran jour/nuit');
  // Le cadran jour/nuit n'est pas un tracé mais une IMAGE (le disque bleu, ses
  // étoiles et sa couronne de vingt-quatre graduations) : sans elle il ne
  // resterait qu'un soleil et une lune flottant dans le vide.
  const jour = fs.readFileSync(path.join(SPRITES, 'frutimandala-jour.svg'), 'utf8');
  assert.match(jour, /<image [^>]*href="data:image\/png;base64,/,
    'le fond du cadran jour/nuit doit porter son bitmap');
});

test('les onze glyphes de l’heure, et chacun sa largeur', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(SPRITES, 'bureau.json'), 'utf8'));
  const ch = manifeste.mandalaChiffres;
  assert.strictEqual(ch.glyphes.length, 11, '0 à 9 plus les deux-points');
  // Ils partagent le cadre du plus grand : l'écriture ne saute pas d'un
  // chiffre à l'autre.
  assert.deepStrictEqual(ch.cadre, { x: -3.8, y: -5.25, w: 37.95, h: 34.55 });
  for (const nom of ch.glyphes) {
    assert.ok(fs.existsSync(path.join(SPRITES, nom + '.svg')), nom + '.svg manquant');
  }
  // `setNum` avance de `mc._width` : le « 1 » est étroit, les deux-points plus
  // encore, et le portage reprend ces largeurs-là.
  assert.strictEqual(ch.boites['mandala-chiffre-1'].w, 22.85);
  assert.strictEqual(ch.boites['mandala-chiffre-8'].w, 37.4);
  assert.strictEqual(ch.boites['mandala-chiffre-deuxpoints'].w, 19.2);
  assert.match(JS, /'1': \{ n: '1', w: 22\.85 \}/);
  assert.match(JS, /':': \{ n: 'deuxpoints', w: 19\.2, x: -1\.2 \}/);
});

test('la géométrie est celle du clip cpWheelMng', () => {
  // `inside` (#407) posé à (1862 ; −750) twips, dans un dessin qui commence à
  // (−6,3 ; −4,35) : le centre des cadrans tombe à (99,4 ; −33,15).
  assert.match(JS, /MD_DX = 6\.3, MD_DY = 4\.35/);
  assert.match(JS, /MD_CX = 93\.1 \+ MD_DX, MD_CY = -37\.5 \+ MD_DY/);
  // Les quatre boutons, aux places du clip.
  assert.match(JS, /cle: 'mandalaGauche', x: 0\.75, y: 21\.7, l: 19\.25, h: 20/);
  assert.match(JS, /cle: 'mandalaDroite', x: 167\.15 \+ 0\.1, y: 21\.8/);
  assert.match(JS, /cle: 'mandalaSwap', x: 0\.75, y: 43\.7, l: 50\.05, h: 20/);
  assert.match(JS, /cle: 'mandalaValider', x: 136\.35, y: 43\.8, l: 50\.1, h: 20/);
  // Le BOL découpe les cadrans : sans lui, le bitmap du jour/nuit — opaque
  // jusque dans ses coins, peints sur le vert du bureau — laisserait une
  // écharpe verte le long du châssis.
  assert.match(CSS, /mask: url\('\/frutiz\/sprites\/frutimandala-masque\.svg'\) left top \/ 200px 80px no-repeat;/);
});

test('l’heure suit la loi de wheel.DayNight', () => {
  // dayCoef = (h + m/60) / 24 ; setRot(dayCoef × 360)
  assert.match(JS, /this\.setRot\(r, \(\(h \+ m \/ 60\) \/ 24\) \* 360\)/);
  // `display._rotation = −deg` : le cadran tourne, l'heure reste droite — et
  // `onBaseTurn` en fait autant pendant que le plateau vire.
  assert.match(JS, /rotate\(' \+ \(-\(r\.rot \+ this\.tour \* 6\)\)/);
  // `attachMovie("extGameNumb", "hour", 1, {…, scale: 85, _y: 52})`
  assert.match(JS, /MD_ECHELLE = 0\.85/);
  assert.match(JS, /MD_HEURE_Y = 52/);
  assert.match(CSS, /\.md-heure \{\s*top: 52px; transform: scale\(\.85\);/);
  // `compteur._x = (−compteur._width / 2) × align` — la boîte d'encre est
  // centrée, pas le texte : l'écart d'époque est reproduit tel quel.
  assert.match(JS, /el\.style\.left = \(-MD_ECHELLE \* \(g1 - g0\) \/ 2\)/);
  // Le réveil se cale sur la MINUTE suivante puis passe à 60 s.
  assert.match(JS, /\(60 - d\.getSeconds\(\)\) \* 1000 \+ 500/);
});

test('l’échange reprend animDisk au chiffre près', () => {
  // list = ["whDayNight", "whFruitMonth"] puis swapWheel() : la roue des
  // frutisignes d'abord.
  assert.match(JS, /liste: \['whDayNight', 'whFruitMonth'\]/);
  assert.match(JS, /this\.pos = \(this\.pos \+ 1\) % this\.liste\.length/);
  // turning = 2, accel = 0,3
  assert.match(JS, /this\.tour = 2; this\.accel = 0\.3;/);
  // accel −= tmod/90 ; r = (1 + accel) ^ tmod ; turning ×= r
  assert.match(JS, /this\.accel -= tmod \/ 90;/);
  assert.match(JS, /Math\.pow\(1 \+ this\.accel, tmod\)/);
  assert.match(JS, /this\.inside\.style\.transform = 'rotate\(' \+ \(this\.tour \* 6\)/);
  // mcOut._alpha = (r − 1) × 400, puis le sens s'inverse et l'ancienne meurt.
  assert.match(JS, /Math\.min\(1, \(r - 1\) \* 4\)/);
  assert.match(JS, /this\.tour \*= -1;/);
  assert.match(JS, /Math\.abs\(this\.tour\) < 0\.1/);
  // La NOUVELLE roue passe DESSOUS : attachMovie à 10000 − dp.
  assert.match(JS, /el\.style\.zIndex = String\(10000 - dp\)/);
  // `pressSwap` ne fait rien tant que l'échange court.
  assert.match(JS, /mandala\.pressSwap = function \(\) \{ if \(!this\.flSwap\) this\.swapWheel\(\); \};/);
  // Les deux triangles rouges sont MUETS d'époque.
  assert.match(JS, /mandala\.pressLeft = function \(\) \{\};/);
  assert.match(JS, /mandala\.pressRight = function \(\) \{\};/);
});

test('le bouton vert replie la barre — hideHeight 220, cornerY 106 → 10', () => {
  assert.match(JS, /mandala\.pressValidate = function \(\) \{ basculerRepli\(\); \};/);
  assert.match(JS, /MD_CACHE = 220/);
  assert.match(JS, /repli\.cible = -MD_CACHE/);
  // `main.cornerY = 10 + 96 × !flHalfHide`
  assert.match(JS, /CORNER_Y = 10 \+ 96 \* \(repli\.actif \? 0 : 1\)/);
  // La barre glisse au ratio 2, la frusion (jumpTo → addSlide sans ratio) à 1.
  assert.match(JS, /Math\.pow\(0\.8, tmod \* 2\), rf = Math\.pow\(0\.8, tmod\)/);
  // Le bureau suit le coin : la rangée d'icônes remonte.
  assert.match(CSS, /top: var\(--cornerY\); left: calc\(var\(--cornerX\) \+ 6px\)/);
  // `main.onResize()` : les fenêtres se recalent — et la FICHE avec elles,
  // puisque c'en est une (`win.Frutiz extends WinStandard`).
  assert.match(JS, /for \(var id in fenetres\) bornerDansEcran\(fenetres\[id\]\.fen\);\s*\n\s*bornerFiche\(\);\s*\n\s*poserFond\(fondCourant\);/);
});

test('la languette « mode rapide » est celle du SWF', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(SPRITES, 'bureau.json'), 'utf8'));
  assert.ok(manifeste['mode-rapide'], 'testRetour (#587) absent du manifeste');
  assert.ok(fs.existsSync(path.join(SPRITES, 'mode-rapide.svg')));
  // `testRetour._y = hideHeight` dans une barre remontée de 220 : au ras du
  // haut de l'écran, à l'abscisse de la barre.
  assert.match(CSS, /#mode-rapide \{[\s\S]*?left: var\(--cornerX\); top: 0;/);
  // Le champ d'époque : Verdana gras 10, `#4D7417`, à 16,3 du dessin.
  assert.match(CSS, /font: 700 10px Verdana, Arial, sans-serif; color: #4D7417;/);
  assert.match(CSS, /#mode-rapide span \{\s*position: absolute; left: 16\.3px;/);
  assert.match(JS, /txt\.textContent = 'mode rapide';/);
  // `_visible = false` jusqu'à `endMove` : elle n'apparaît qu'une fois la
  // barre partie.
  assert.match(CSS, /#mode-rapide \{[\s\S]*?visibility: hidden;/);
  assert.match(CSS, /#mode-rapide\.vu \{ visibility: visible; \}/);
  assert.match(JS, /if \(nub\) nub\.classList\.add\('vu'\);/);
});

test('rien de tout cela ne sort du bureau : le mobile ne bouge pas', () => {
  const lignes = CSS.split('\n').filter((l) => /#frutimandala|#mode-rapide/.test(l)
    && /^[^\s].*\{/.test(l));
  assert.ok(lignes.length > 8, 'les règles de la frutimandala sont introuvables');
  for (const l of lignes) {
    assert.ok(l.startsWith('body.bureau-frutiz'),
      'règle de frutimandala hors du bureau : ' + l.trim());
  }
  // Et la mandala ne se bâtit qu'au démarrage du bureau, DANS la barre.
  assert.match(JS, /coin\.appendChild\(batirMandala\(\)\);/);
});
