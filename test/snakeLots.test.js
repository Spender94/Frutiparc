'use strict';
/*
 * FRUTISNAKE — PLUS LÉGER, PLUS FLUIDE
 * ═══════════════════════════════════
 *
 * « Les joueurs continuent de se plaindre qu'il y a des lenteurs importantes
 *   sur snake light. »
 *
 * Deux lenteurs, mesurées (scratchpad/perf-snake3.js, perf-charge.js) :
 *
 *   1. EN PARTIE, le serpent. `dessinerSerpent` traçait 2·len traits épais à
 *      bouts ronds : à soixante segments, dix millisecondes par image sur un
 *      ordinateur de bureau — cinq à dix fois plus sur un téléphone — quand
 *      tout le reste de l'image en coûtait 0,06. Le corps est maintenant un
 *      TUBE rempli d'un coup, bordure puis corps : mêmes largeurs, mêmes bouts
 *      ronds, deux remplissages au lieu de cent vingt traits. Avec lui : le
 *      décor composé une fois (quatre pleins écrans par image → une recopie),
 *      le tableau du pack rendu hors écran (texte contouré ×5 par image → une
 *      recopie par case), la rasterisation des dessins par paliers (23 tampons
 *      par fruit qui apparaît → 1), et les listes nettoyées sur place (le
 *      ramasse-miettes prenait dix pour cent du fil).
 *
 *   2. AU CHARGEMENT, 1 247 fichiers SVG tirés un par un : huit secondes et
 *      demie pour l'arène à froid, quatorze au téléphone — le temps du nombre
 *      de requêtes. Ils sont maintenant rangés en cinq LOTS nommés par leur
 *      empreinte (une requête chacun, cache long), et le rideau n'attend que
 *      ce que l'arène dessine : six écrans sur cent quarante, soixante fruits
 *      sur quatre cent vingt-neuf. Les sons ne partent qu'une fois le menu
 *      ouvert.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const RENDU = lire('public/snake3/rendu.js');
const GAME = lire('public/snake3/game.js');
const DESSIN = lire('public/snake3/dessin.js');
const PACK = lire('public/snake3/pack.js');
const SONS = lire('public/snake3/sons.js');
const PAGE = lire('public/snake3/index.html');

// ── un contexte qui note ce qu'on lui demande ──────────────────────────────
function mouchard() {
  const n = { fill: 0, stroke: 0, arc: 0, lineTo: 0, bezier: 0, moveTo: 0 };
  const ctx = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    beginPath() {}, closePath() {}, moveTo() { n.moveTo++; }, lineTo() { n.lineTo++; },
    bezierCurveTo() { n.bezier++; }, arc() { n.arc++; }, fill() { n.fill++; }, stroke() { n.stroke++; },
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, drawImage() {},
  };
  return { ctx, n };
}
function serpentLong(len) {
  const S = require('../public/snake3/serpent.js');
  const C = require('../public/snake3/const.js');
  const s = new S.Serpent({ x: 400, y: 300, hasard: () => 0, evenement: () => {} });
  s.len = len; s.ang = 0; s.queue_collide = false;
  const bornes = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
  for (let i = 0; i < len * 6; i++) { s.ang += C.SNAKE_DEFAULT_TURN / 3; s.old_ang = null; s.move(bornes, 1); }
  return s;
}

test('le corps est deux remplissages, plus 2·len traits', () => {
  const R = require('../public/snake3/rendu.js');
  const s = serpentLong(60);
  const { ctx, n } = mouchard();
  R.dessinerSerpent(ctx, s, 0.8, 0);
  assert.strictEqual(n.fill, 2, 'bordure puis corps : deux remplissages');
  assert.strictEqual(n.stroke, 0, 'et aucun trait en régime ordinaire');
  assert.strictEqual(n.arc, 4, 'deux demi-disques par passe : les bouts ronds');
  // Le tube passe par CHAQUE point de file : 5·len + 1 points par flanc
  // (le premier posé par moveTo), deux flancs, deux passes.
  assert.strictEqual(n.moveTo, 2);
  assert.strictEqual(n.lineTo, 2 * 2 * (5 * 60));
  // Ce que le fichier dessine encore au trait : la pointe qui s'efface (potion
  // verte) et le curseur des ciseaux — un segment chacun.
  s.alpha_val = 40;
  s.color_qpos = 7; s.color_val = 0xff0000;
  const m2 = mouchard();
  R.dessinerSerpent(m2.ctx, s, 0.8, 0);
  assert.strictEqual(m2.n.fill, 2);
  assert.strictEqual(m2.n.stroke, 3, 'la pointe (deux passes) et le curseur (une)');
  assert.strictEqual(m2.n.bezier, 10, 'cinq cubiques par segment tracé — la pointe une fois pour ses deux passes');
  // Le gondolement de la potion violette garde les traits du fichier.
  s.alpha_val = 100; s.color_qpos = -1; s.distort = true; s.distort_val = 1;
  const m3 = mouchard();
  R.dessinerSerpent(m3.ctx, s, 0.8, 0);
  assert.strictEqual(m3.n.fill, 0);
  assert.strictEqual(m3.n.stroke, 120, 'deux passes de soixante traits');
});

test('le tube a les largeurs du fichier, aux mêmes points, et suit la file', () => {
  const R = require('../public/snake3/rendu.js');
  const s = serpentLong(20);
  s.eat = 6;                            // le renflement de bouchée, lui aussi
  const g = R.geometrieCorps(s, 1);
  assert.strictEqual(g.M, 100, 'cinq points par segment');
  const q = s.queue, n0 = q.length - 1;
  const scale = Math.min(10, s.len + 3) / 10, ss = scale * 15 / s.len;
  const largeur = (i) => i * ss * (s.eat > 0 ? Math.max(1, 2 - (i - s.eat) * (i - s.eat) / 2) : 1);
  for (let j = 0; j <= 100; j++) {
    assert.strictEqual(g.x[j], q[n0 - j].x);
    assert.strictEqual(g.y[j], q[n0 - j].y);
    // Le segment i du point j (len à la tête), le plus large aux joints.
    const i = j === 0 ? 20 : 20 - Math.ceil(j / 5) + 1;
    const attendu = (j > 0 && j % 5 === 0 && i > 1) ? Math.max(largeur(i), largeur(i - 1)) : largeur(i);
    assert.ok(Math.abs(g.base[j] - attendu) < 1e-9, 'largeur au point ' + j);
    // La normale est unitaire et perpendiculaire à la corde des voisins.
    const a = j > 0 ? j - 1 : 0, b = j < 100 ? j + 1 : 100;
    const tx = g.x[a] - g.x[b], ty = g.y[a] - g.y[b];
    assert.ok(Math.abs(Math.hypot(g.nx[j], g.ny[j]) - 1) < 1e-9);
    assert.ok(Math.abs(g.nx[j] * tx + g.ny[j] * ty) < 1e-6, 'normale au point ' + j);
  }
  // Et le hitTest lit toujours la même file, corde à corde (serpent.js).
  assert.match(lire('public/snake3/serpent.js'), /const w = q\[Math\.max\(0, n - k\)\];/);
});

test('le décor est composé une fois, les aplats ne se repeignent plus', () => {
  assert.match(GAME, /const fondArene = \{ c: null, cle: '' \};/);
  assert.match(GAME, /dessinerFondArene\(ctx, jeu, partie\.niveau\);/, 'l\'arène');
  assert.match(GAME, /dessinerFondArene\(ctx, jeu, b\.niveau\);/, 'la bataille');
  assert.match(GAME, /if \(!\(this\.mode && this\.mode\.peintToutLeFond\)\) \{/);
  assert.match(GAME, /this\.peintToutLeFond = true;/);
  // Plus de recopie de tableaux ni d'ensemble à chaque image.
  const main = /main\(tmod, deltaT\) \{\s*\n\s*const partie = this\.partie;[\s\S]*?\n  \}/.exec(GAME)[0];
  assert.ok(!/\[\.\.\.partie\.slots/.test(main) && !/new Set\(\)/.test(main) && !/\.filter\(/.test(main),
    'les listes se nettoient sur place');
  // La chaîne de couleur est mise en cache (rendu.js).
  assert.match(RENDU, /const couleursCss = new Map\(\);/);
});

test('une rasterisation par palier, pas par vingtième d\'échelle', () => {
  assert.match(DESSIN, /function palier\(k, im\) \{\s*\n\s*if \(k <= 1\.25\) return 1;/);
  assert.match(DESSIN, /return k <= 2\.5 \? 2 : 4;/);
  assert.match(DESSIN, /clef: fichier \+ '@' \+ kp/);
  assert.ok(!/Math\.round\(k \* 20\) \/ 20/.test(DESSIN), 'plus de clef au vingtième');
  // Les grands dessins restent au palier 1.
  assert.match(DESSIN, /if \(im\.naturalWidth \* DENSITE > 300 \|\| im\.naturalHeight \* DENSITE > 300\) return 1;/);
});

test('le tableau du pack est rendu hors écran et recopié', () => {
  assert.match(PACK, /this\.cellules = new Map\(\);/);
  assert.match(PACK, /if \(c\.canvas\) ctx\.drawImage\(c\.canvas, x, y, l, h\);/);
  assert.match(GAME, /this\.pack\.dessiner\(ctx, this\.releve\(\), this\.nettete\);/);
  // Sans DOM (ici), la case se peint directement — et la même peinture.
  const P = require('../public/snake3/pack.js');
  const pack = new P.Pack();
  let textes = 0, contours = 0;
  const ctx = { save() {}, restore() {}, fillRect() {}, fillText() { textes++; }, strokeText() { contours++; },
    measureText() { return { width: 10 }; }, beginPath() {}, roundRect() {}, fill() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} }; } };
  pack.dessiner(ctx, { longueur: 3, fruits: 4, dynamites: 0, bonus: 12, vitesse: 100, pause: false }, 2);
  assert.strictEqual(textes, 10, 'cinq intitulés et cinq nombres');
  assert.strictEqual(contours, 5);
});

test('les dessins arrivent en lots, et le rideau n\'attend que ce que l\'arène dessine', () => {
  // Le script de fabrication, ses cinq lots, et l'index qu'il écrit.
  const lots = lire('public/snake3/lots.js');
  assert.match(lots, /window\.SnakeLots = \{/);
  const idx = JSON.parse(lots.slice(lots.indexOf('{'), lots.lastIndexOf('}') + 1));
  for (const nom of ['menu', 'arene', 'fruits2', 'suites', 'encyclo']) {
    assert.match(idx.lots[nom], new RegExp('^lots/' + nom + '\\.[0-9a-f]{10}\\.json$'), 'lot ' + nom);
    assert.ok(fs.existsSync(path.join(ROOT, 'public/snake3/sprites', idx.lots[nom])), 'fichier du lot ' + nom);
  }
  assert.match(idx.manifeste, /^sprites\.json\?v=[0-9a-f]{10}$/);
  // Chaque lot est un dictionnaire fichier → SVG, et aucun fichier n'est dans
  // deux lots.
  const vus = new Set();
  for (const nom of Object.keys(idx.lots)) {
    const lot = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/snake3/sprites', idx.lots[nom]), 'utf8'));
    for (const [f, svg] of Object.entries(lot)) {
      assert.ok(!vus.has(f), f + ' dans deux lots');
      vus.add(f);
      assert.ok(svg.startsWith('<svg'), f);
      assert.ok(fs.existsSync(path.join(ROOT, 'public/snake3/sprites', f)), f + ' existe');
    }
  }
  // Ce que le menu et l'arène dessinent est bien dans leurs lots : la
  // frutibarre (six pièces hors clip), le terrain, les six écrans, les
  // soixante premiers fruits et les pourris.
  const manifeste = JSON.parse(lire('public/snake3/sprites/sprites.json'));
  const menu = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/snake3/sprites', idx.lots.menu), 'utf8'));
  for (const p of manifeste.cadres.fbarre.pieces) assert.ok(menu[p.fichier], 'frutibarre : ' + p.fichier);
  assert.ok(menu['backgroundBord.svg'] && menu['backgroundField.svg']);
  const arene = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/snake3/sprites', idx.lots.arene), 'utf8'));
  for (const n of [1, 7, 15, 24, 32, 39]) assert.ok(arene[manifeste.clips.screensSans.frames[n].fichier], 'écran ' + n);
  assert.ok(arene[manifeste.clips.screens.frames[1].fichier], 'la pause');
  assert.ok(!arene[manifeste.clips.screensSans.frames[2].fichier], 'un écran jamais affiché reste dehors');
  for (const n of [1, 60, 321, 342]) assert.ok(arene[manifeste.clips.fruits.frames[n].fichier], 'fruit ' + n);
  assert.ok(!arene[manifeste.clips.fruits.frames[61].fichier], 'le fruit 61 attend le lot fruits2');
  // Le client : le lot du menu, puis l'arène, puis le reste en fond ; l'index
  // est chargé par la page avant les dessins.
  assert.match(PAGE, /<script src="\/snake3\/lots\.js"><\/script>/);
  assert.ok(PAGE.indexOf('/snake3/lots.js') < PAGE.indexOf('/snake3/dessin.js'));
  assert.match(GAME, /return D\.chargerLot\('menu'\)\.then\(\(\) => D\.precharger\(DESSINS_MENU\)\)\.then\(\(\) => \{/);
  assert.match(GAME, /\}\)\.then\(\(\) => D\.chargerLot\('suites'\)\)\.then\(\(\) => \{/);
  assert.match(GAME, /return D\.chargerLot\('encyclo'\);/);
  assert.match(GAME, /const DESSINS_JEU = \[\['screens', \[ECRANS\.pause\]\], \['screensSans', Object\.values\(ECRANS\)\],\s*\n\s*\['fruits', FRUITS_DEPART\],/);
  assert.match(DESSIN, /const seules = Array\.isArray\(entree\) \? new Set\(entree\[1\]\) : null;/);
  // Les images d'un lot naissent d'un blob, par paquets de quarante.
  assert.match(DESSIN, /new Blob\(\[lot\[f\]\], \{ type: 'image\/svg\+xml' \}\)/);
  assert.match(DESSIN, /const fin = Math\.min\(noms\.length, i \+ 40\);/);
  // Et sans lots.js, tout continue de marcher fichier par fichier.
  assert.match(DESSIN, /if \(!L \|\| !L\.lots \|\| !L\.lots\[nom\] \|\| typeof fetch === 'undefined'\) return Promise\.resolve\(false\);/);
  const D = require('../public/snake3/dessin.js');
  return D.chargerLot('menu').then((ok) => assert.strictEqual(ok, false, 'pas de lots sous Node : faux, sans casser'));
});

test('les sons partent après le menu, pas devant ses dessins', () => {
  assert.match(SONS, /charger\(\) \{\s*\n\s*if \(this\.chargeLance\) return;/);
  assert.ok(!/constructor\(\) \{[\s\S]*?fetch\(BASE \+ nom/.test(SONS.slice(0, SONS.indexOf('charger() {'))),
    'plus de fetch dans le constructeur');
  assert.match(GAME, /sons\.charger\(\);/);
  assert.match(SONS, /ouvrir\(\) \{\s*\n\s*this\.charger\(\);/, 'le premier geste aussi');
});
