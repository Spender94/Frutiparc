/*
 * Le troisième lot de retours MiniPixiz — la version light au banc.
 *
 *   · « Les graphismes sont pixellisés et flous » sur bureau : la scène se
 *     pense en 240 × 240 mais s'affiche trois fois plus grande, et tout —
 *     le tampon d'écran comme les caches de rendre() — était tramé à 240
 *     puis étiré par le navigateur. Les dessins sont pourtant des SVG.
 *   · « La boule de feu entourée de 8 billes clignote » au bassin : le clip
 *     `fireball` du SWF a dix-sept images, mais la dix-septième ne s'affiche
 *     JAMAIS sous Flash — elle porte le gotoAndPlay(1) du bouclage, exécuté
 *     avant tout rendu. Le portage la jouait comme les autres : une image
 *     quasi vide, un trou d'un dix-septième de cycle.
 *   · « Cliquer le bouton en bas à gauche du portrait affiche les préférences
 *     de la fée au lieu de tourner le volet » : la zone du portrait, posée
 *     APRÈS celles des boutons, les recouvrait — zoneSous() prend la dernière
 *     posée, et le carré du portrait déborde sur les deux boutons.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── LA BOULE DE FEU ───────────────────────────────────────────────────────

test('fireball : la 17e image du SWF est le bouclage, pas une image à montrer', () => {
  // La preuve par le fichier : dans root.swf, l'image 17 du sprite `fireball`
  // retire la boule et la flamme (une seule pièce reste) et porte un DoAction
  // — gotoAndPlay(1). Sous Flash, l'action s'exécute en ENTRANT dans l'image,
  // avant tout rendu : elle ne se voit jamais.
  const { ouvrir } = require(path.join(ROOT, 'scripts/lib/swf-sprites.js'));
  const swf = ouvrir(path.join(ROOT, 'Games/miniTroll/swf/root.swf'));
  const id = swf.noms.get('fireball');
  assert.ok(id, 'le SWF exporte fireball');

  let actionFrame = null;
  swf.parcourir((code, corps, len, spriteId, frame) => {
    if (spriteId === id && code === 12) actionFrame = { frame, octet: swf.b[corps] };
  });
  assert.ok(actionFrame, 'le clip porte un DoAction');
  assert.equal(actionFrame.frame, 17, 'sur sa dernière image');
  assert.equal(actionFrame.octet, 0x81, 'et c\'est un ActionGotoFrame (0x81)');

  // L'extraction, fidèle, a bien la 17e quasi vide — et les seize autres
  // pleines : c'est le portage qui ne doit pas la jouer.
  const sprites = JSON.parse(lire('public/minipixiz/sprites/sprites.json'));
  const fb = sprites.fireball;
  assert.equal(fb.etats.length, 17, 'dix-sept images extraites');
  for (const e of fb.etats) {
    if (e.frame === 17) assert.ok(e.pieces.length < 3, 'la 17e a perdu la boule');
    else assert.equal(e.pieces.length, 3, `l'image ${e.frame} est entière`);
  }
});

test('fireball : le portage boucle sur les seize images peintes', () => {
  const src = lire('public/minipixiz/game.js');
  // Le cycle exclut la dernière image (le bouclage) : etats.length - 1.
  assert.match(src, /const n = s\.fireball \? s\.fireball\.etats\.length - 1 : 0;/,
    'la pulsation tourne sur n - 1 images');
  assert.match(src, /gotoAndPlay\(1\)/, 'et le pourquoi est écrit sur place');
});

// ── LES ZONES DU PANNEAU DE LA FÉE ────────────────────────────────────────

test('inventaire : le portrait se pose SOUS les boutons, comme dans le SWF', () => {
  const src = lire('public/minipixiz/inventaire.js');

  // La géométrie qui rend l'ordre décisif : le carré du portrait (58,8 centré)
  // couvre l'ancre du bouton swap (-23.4, 27.15) — ces nombres viennent du
  // fichier (invPanneau.ancrages) et se recoupent ici pour que le test casse
  // si l'un des deux bouge sans l'autre.
  const sprites = JSON.parse(lire('public/minipixiz/sprites/sprites.json'));
  const a = sprites.invPanneau.ancrages;
  assert.ok(Math.abs(a.swap.x) < 29.4 && Math.abs(a.swap.y) < 29.4,
    'l\'ancre du bouton swap tombe DANS le carré du portrait — l\'ordre des zones décide');

  // L'ordre du code : la zone du portrait d'abord, celles des boutons ensuite
  // (zoneSous prend la dernière posée, comme Flash prend le clip le plus haut).
  const iPortrait = src.indexOf("this.zoneRect('portrait'");
  const iVolet = src.indexOf("zone('volet', a.swap");
  const iLiberer = src.indexOf("zone('liberer', a.quit");
  assert.ok(iPortrait >= 0 && iVolet >= 0 && iLiberer >= 0, 'les trois zones existent');
  assert.ok(iPortrait < iVolet, 'portrait posé avant le bouton de volet');
  assert.ok(iPortrait < iLiberer, 'et avant le bouton de libération');
  // La pastille de niveau vit elle aussi au-dessus du portrait.
  const iPastille = src.indexOf('{ pastille: 1 }');
  assert.ok(iPastille < 0 || iPortrait < iPastille, 'et avant la pastille de niveau');
});

// ── LE BOCAL ET LA CLAIRIÈRE ──────────────────────────────────────────────

test('ranger sa fée en bocal la retire de la clairière (le sac s\'ouvre par-dessus le menu)', () => {
  const src = lire('public/minipixiz/index.html');
  // Le sac s'ouvre PAR-DESSUS la clairière, qui ne repasse pas par
  // ouvrirMenu() à sa fermeture : sans re-pose, la fée qu'on venait de
  // ranger en bocal continuait de voleter derrière — « elle est à la fois
  // dans le bocal ET dehors », le retour joueur mot pour mot.
  const i = src.indexOf('surChangement: function () {');
  assert.ok(i >= 0, 'le sac annonce ses changements');
  const bloc = src.slice(i, src.indexOf('},', i));
  assert.match(bloc, /menu\.poserFee\(feeCouranteSeed\(\)\)/,
    'chaque changement du sac repose la fée de la clairière');
  // Et la main VIDE se propage : feeEnMain rend null pour une fée en bocal,
  // poserFee(null) efface le vol — la symétrie existe déjà côté plateforme.
  const p = lire('public/minipixiz/plateforme.js');
  assert.match(p, /if \(fs && \(enMission\(fs\) \|\| enBocal\(fs\)\)\) fs = null;/,
    'feeEnMain écarte la fée en bocal');
});

// ── LA NETTETÉ ────────────────────────────────────────────────────────────

test('les trois écrans couvrent les pixels physiques affichés, pas 240 × dpr', () => {
  for (const f of ['public/minipixiz/game.js', 'public/minipixiz/menu.js',
    'public/minipixiz/inventaire.js']) {
    const src = lire(f);
    // Le tampon suit `nettete` = échelle × dpr : c'est la surface réellement
    // affichée. L'ancien SCENE * dpr laissait le navigateur étirer un rendu
    // de 240 sur un bureau à l'échelle 3 — le « pixellisé et flou » remonté.
    assert.match(src, /this\.nettete = /, f + ' calcule sa netteté');
    assert.match(src, /Math\.round\(SCENE \* this\.nettete\)/, f + ' en dimensionne son tampon');
    assert.match(src, /setTransform\(this\.nettete, 0, 0, this\.nettete, 0, 0\)/,
      f + ' et dessine à cette échelle');
    assert.equal(/canvas\.width = SCENE \* this\.dpr/.test(src), false,
      f + ' : plus de tampon à 240 × dpr');
  }
});

test('les caches de rendre() se trament à la densité et se reposent en logique', () => {
  const src = lire('public/minipixiz/game.js');
  // Le cache est tramé à kd = k × DENSITE…
  assert.match(src, /const kd = k \* DENSITE;/, 'l\'échelle physique existe');
  assert.match(src, /Math\.floor\(x0 \* kd\)/, 'et cadre le canevas du cache');
  // …et se repose à sa taille logique : sans lw/lh, un cache dense se
  // dessinerait DENSITE fois trop grand.
  assert.match(src, /lw: l \/ DENSITE, lh: h \/ DENSITE/, 'le rendu déclare ses cotes logiques');
  assert.match(src, /ctx\.drawImage\(r\.c, x \+ r\.dx, y \+ r\.dy, r\.lw, r\.lh\)/,
    'poserRendu les respecte');
  // Changer de densité invalide les caches — sinon un redimensionnement
  // mélangerait deux trames.
  assert.match(src, /teintes\.clear\(\);\s*\n\s*peintes\.clear\(\);/, 'poserDensite vide les caches');
  // Et le menu comme l'inventaire alignent le module sur leur écran.
  for (const f of ['public/minipixiz/menu.js', 'public/minipixiz/inventaire.js']) {
    assert.match(lire(f), /poserDensite\(this\.nettete\)/, f + ' pousse sa densité');
  }
});

test('les clics restent en coordonnées CSS : la densité ne les décale pas', () => {
  // La conversion écran → scène divise par `echelle` (le rapport CSS), pas par
  // la netteté : le tampon peut être quatre fois plus dense, le doigt tombe au
  // même endroit. C'est ce qui garantit que la correction du flou ne décale
  // aucune hitbox.
  for (const f of ['public/minipixiz/game.js', 'public/minipixiz/menu.js',
    'public/minipixiz/inventaire.js']) {
    const src = lire(f);
    assert.match(src, /\/ this\.echelle/, f + ' convertit par l\'échelle CSS');
    assert.equal(/clientX - r\.left\) \/ this\.nettete/.test(src), false,
      f + ' : jamais par la netteté');
  }
});
