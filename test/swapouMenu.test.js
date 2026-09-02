/*
 * Le menu de Swapou 2 en mode light, et son écran de choix de personnage.
 *
 * Le portage redessinait ces deux écrans « de mémoire » : une barre de bois
 * découpée dans levelBox.png, du texte vert en Verdana, des cases vertes à
 * bord doré. L'original n'a rien de tout ça. Il a des plaques VECTORIELLES
 * vert et orange à dégradé (formes #202 et #204 du SWF), une plaque de titre
 * (#358), un cadre de tuile en bois à feuilles (menuFaceTop.png), et deux
 * fontes embarquées : « PT Banana Split » pour les boutons, « Impact » pour
 * les titres et la barre d'aide.
 *
 * Ce fichier vérifie que le portage tient ces pièces-là, et qu'il rejoue les
 * animations telles que les timelines du SWF les décrivent — pulsation des
 * boutons (13 images, bosse à 1,15 et virage au doré par décalage additif) et
 * des tuiles (11 images, coup de rouge à +255).
 *
 * Les valeurs sont RELEVÉES sur le fichier : scripts/extract-swapou-menu.js
 * en sort les dessins et les fontes, inspect-swf.js en sort les timelines.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const SWAPOU = path.join(ROOT, 'public', 'swapou');

// ── un client Swapou complet, sans navigateur ───────────────────────────────
// Même montage que public/swapou/draw.test.js : le contexte 2D factice n'a que
// les méthodes réelles, donc un appel inventé lève au lieu de passer.
function client() {
  const bac = {
    console: console, setTimeout: setTimeout, URLSearchParams: URLSearchParams,
    performance: { now: function () { return Date.now(); } },
    Date: Date, Math: Math, JSON: JSON,
  };
  bac.self = bac;
  bac.window = bac;
  vm.createContext(bac);
  for (const f of ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'])
    vm.runInContext(fs.readFileSync(path.join(SWAPOU, f), 'utf8'), bac, { filename: f });
  // Images factices, mais aux VRAIES dimensions pour celles dont la pose se
  // calcule à partir de leur taille.
  const tailles = {
    fullDimitri: [218, 436], fullNatacha: [165, 470],
    menuFaceTop: [130, 133], faceTop: [130, 133],
    menuPomme: [285, 439], menuPoire: [285, 439], menuOrange: [285, 439],
  };
  bac.SW.A.img = function (n) {
    const t = tailles[n] || [130, 133];
    return { nom: n, naturalWidth: t[0], naturalHeight: t[1], complete: true };
  };
  bac.SW.A.has = function () { return true; };
  bac.SW.A.play = function () {};
  bac.SW.A.playMusic = function () {};
  return bac.SW;
}

// Contexte 2D mouchard : on garde la trace des remplissages et des images.
function ctxMouchard() {
  const grad = { addColorStop: function (o, c) { this.stops.push(c); }, stops: [] };
  const rien = function () {};
  return {
    canvas: { width: 700, height: 480 },
    fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1,
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    shadowColor: '', shadowBlur: 0, lineJoin: 'miter', filter: 'none',
    globalCompositeOperation: 'source-over',
    remplis: [], images: [], textes: [], polices: [],
    save: rien, restore: rien, translate: rien, scale: rien, rotate: rien,
    beginPath: rien, closePath: rien, moveTo: rien, lineTo: rien, arc: rien,
    arcTo: rien, ellipse: rien, rect: rien, stroke: rien, clip: rien,
    strokeRect: rien, clearRect: rien, strokeText: rien,
    getTransform: function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    setTransform: rien,
    fill: function () { this.remplis.push(this.fillStyle); },
    fillRect: function () { this.remplis.push(this.fillStyle); },
    drawImage: function (i) { this.images.push(i && i.nom); },
    fillText: function (t) { this.textes.push(t); this.polices.push(this.font); },
    measureText: function () { return { width: 10 }; },
    createLinearGradient: function () { return { addColorStop: grad.addColorStop.bind(grad), stops: grad.stops }; },
    createRadialGradient: function () { return { addColorStop: rien }; },
    grad: grad,
  };
}

// Amène le menu à une phase donnée, boutons posés et stabilisés.
function menuEn(SW, phase) {
  SW.Manager.init('');
  SW.Manager.main(1, 0.025);
  SW.Manager.mode.onClickDown();
  for (let i = 0; i < 300; i++) SW.Manager.main(2, 0.05);
  SW.Manager.mode.jump(phase);
  for (let i = 0; i < 200; i++) SW.Manager.main(2, 0.05);
  return SW.Manager.mode;
}

test('les dessins du menu sont bien ceux du SWF, pas des à-peu-près', () => {
  // On ré-extrait les formes du SWF et on les compare aux fichiers livrés.
  // Seule retouche admise : le filet d'épaisseur nulle de Flash, écrit 0.05
  // par l'extracteur, qu'on ramène à 1 — ce que le lecteur affichait.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swapou-test-'));
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'extract-swf-shapes.js'),
    path.join(ROOT, 'Games', 'swapou2', 'swapou.swf'), tmp, '202', '204', '358',
  ], { stdio: 'ignore' });
  const paires = [[202, 'bouton-vert.svg'], [204, 'bouton-orange.svg'], [358, 'titre.svg']];
  for (const [id, nom] of paires) {
    const brut = fs.readFileSync(path.join(tmp, `shape${id}.svg`), 'utf8')
      .replace(/stroke-width="0\.05"/g, 'stroke-width="1"');
    const livre = fs.readFileSync(path.join(SWAPOU, 'ui', nom), 'utf8');
    assert.equal(livre, brut, `${nom} doit être la forme #${id} du SWF, au tracé près`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  // Les deux plaques ont la taille exacte du symbole d'origine.
  const vert = fs.readFileSync(path.join(SWAPOU, 'ui', 'bouton-vert.svg'), 'utf8');
  assert.match(vert, /viewBox="-80\.7 -16\.4 161\.45 34\.8"/,
    'la plaque de bouton fait 161,45 × 34,80, ancrée 16,4 au-dessus de son milieu');
  assert.match(fs.readFileSync(path.join(SWAPOU, 'ui', 'titre.svg'), 'utf8'),
    /viewBox="-98\.95 -14\.15 197\.95 28\.3"/, 'la plaque de titre fait 197,95 × 28,30');
});

test('les deux fontes embarquées sont livrées et déclarées', () => {
  for (const [f, mini] of [['banana.woff', 10000], ['impact.woff', 5000]]) {
    const p = path.join(SWAPOU, 'fontes', f);
    const buf = fs.readFileSync(p);
    assert.equal(buf.toString('latin1', 0, 4), 'wOFF', `${f} doit être un WOFF`);
    assert.ok(buf.length > mini, `${f} doit porter ses glyphes (${buf.length} o)`);
  }
  const html = fs.readFileSync(path.join(SWAPOU, 'index.html'), 'utf8');
  assert.match(html, /font-family:\s*"PT Banana Split"/, 'la fonte des boutons est déclarée');
  assert.match(html, /font-family:\s*"Impact SW"/, 'la fonte des titres est déclarée');
  // Un canvas ne sait pas attendre une fonte : il faut les charger avant de
  // démarrer, sinon les libellés sortent en police de secours.
  assert.match(html, /document\.fonts\.load\('16px "PT Banana Split"'\)/,
    'les fontes doivent être chargées avant le premier dessin');
});

test('le bouton de menu porte la plaque du SWF et son libellé blanc', () => {
  const SW = client();
  const menu = menuEn(SW, 10);                       // menu principal
  const bt = menu.btList[0];
  assert.equal(bt.label, ' jouer ');

  const ctx = ctxMouchard();
  bt.draw(ctx);
  assert.ok(ctx.images.includes('menuBouton'),
    'la plaque verte vectorielle est dessinée : ' + ctx.images.join(','));
  assert.ok(!ctx.images.includes('levelBox'),
    'plus de barre de bois découpée dans levelBox');
  assert.deepEqual(ctx.textes, [' jouer ']);
  assert.match(ctx.polices[0], /PT Banana Split/, 'libellé dans la fonte d’origine');

  // Le « retour » prend la plaque orange : c'est la frame 2 de sub, choisie
  // dans le SWF par `if (linkId < 0) sub.gotoAndStop(2)`.
  const retour = new SW.U.RotatorButton(menu, 4, ' retour ', -1, '');
  retour.visible = true;
  const c2 = ctxMouchard();
  retour.draw(c2);
  assert.ok(c2.images.includes('menuBoutonRetour'), 'le « retour » est orange');
});

test('la boîte sensible du bouton est celle de la plaque, pas un rectangle inventé', () => {
  const SW = client();
  const menu = menuEn(SW, 10);
  const bt = menu.btList[0];
  bt.updatePos();
  // Au repos le rotator est à cpt = 2π : pas de décalage en x, +20 en y,
  // échelle 100. La plaque descend alors de 18,4 sous son ancrage et ne monte
  // que de 16,4 — elle n'est pas centrée dessus.
  const cx = bt.curX, cy = bt.curY + 1.1;
  assert.ok(bt.hitTest(cx, cy), 'le centre de la plaque répond');
  assert.ok(bt.hitTest(cx - 80, cy) && bt.hitTest(cx + 80, cy), 'toute la largeur répond');
  assert.ok(!bt.hitTest(cx - 82, cy) && !bt.hitTest(cx + 82, cy), 'et rien au-delà');
  assert.ok(bt.hitTest(cx, cy - 16) && bt.hitTest(cx, cy + 18), 'toute la hauteur répond');
  assert.ok(!bt.hitTest(cx, cy - 17.5) && !bt.hitTest(cx, cy + 19),
    'la boîte est décalée vers le bas, comme le dessin');
});

test('la pulsation de survol suit la timeline du SWF (bosse à 1,15, virage au doré)', () => {
  const SW = client();
  const menu = menuEn(SW, 10);
  const bt = menu.btList[0];
  assert.equal(bt.nbFrames, 13, 'treize images, comme le sprite #206');

  let repos = bt.pulse();
  assert.equal(repos.s, 1, 'au repos, pas de bosse');
  assert.equal(repos.r, 0, 'ni décalage de couleur');

  // Frame 4 = sommet : échelle 1,15 et décalage (rouge +115, vert +51).
  bt.frame = 4;
  const sommet = bt.pulse();
  assert.equal(sommet.s, 1.15);
  assert.equal(sommet.r, 115);
  assert.equal(sommet.v, 51);
  assert.equal(bt.pulse().b, undefined, 'le bleu ne bouge pas — d’où le doré');

  // La bande TOURNE tant que le curseur reste : Rotator*.update avance d'une
  // image par tour et revient à 1 en fin de bande.
  bt.isOver = true;
  bt.frame = 12.5;
  bt.move(1);
  assert.equal(bt.frame, 1, 'en fin de bande, la pulsation reprend à 1');

  // Hors survol, la bande FINIT son tour au lieu de s'arrêter net.
  bt.isOver = false;
  bt.frame = 5;
  bt.move(1);
  assert.equal(bt.frame, 6, 'la pulsation se termine même après le départ du curseur');
  bt.frame = 1;
  bt.move(1);
  assert.equal(bt.frame, 1, 'puis elle reste au repos');
});

test('les tuiles de personnage portent le cadre à feuilles et le portrait d’origine', () => {
  const SW = client();
  const menu = menuEn(SW, 30);                       // challenge → choix du perso
  const tuiles = menu.btList.filter((b) => b.faceId !== undefined);
  assert.equal(tuiles.length, 7, 'les sept personnages');

  const ctx = ctxMouchard();
  tuiles[0].draw(ctx);
  assert.ok(ctx.images.includes('menuFaceTop'),
    'le cadre du menu (bois + feuilles vertes) est posé : ' + ctx.images.join(','));
  assert.ok(ctx.images.includes('face0_0'), 'et le portrait du personnage');
  // Fond du symbole `face` : le dégradé olive de la forme #211, pas un ciel
  // bleu — et dans le sens du fichier : sombre en haut, clair en bas, trois
  // arrêts (0 ; 0,204 ; 1).
  assert.deepEqual(ctx.grad.stops.slice(0, 3), ['#87913e', '#8ba544', '#b1c26b']);
});

test('un personnage verrouillé est un aplat vert, pas une case vide', () => {
  const SW = client();
  const menu = menuEn(SW, 30);
  const tuiles = menu.btList.filter((b) => b.faceId !== undefined);
  const bloque = tuiles.find((t) => !t.active);
  assert.ok(bloque, 'sur une fiche neuve, seuls Dimitri et Natacha sont ouverts');
  assert.equal(bloque.help, '?????', 'et son nom est masqué');

  const ctx = ctxMouchard();
  bloque.draw(ctx);
  // RotatorFace.disable pose une transformation de couleur à multiplicateurs
  // nuls et décalages (106, 134, −51) : tout le portrait, transparence
  // comprise, vire à ce vert-là.
  assert.ok(ctx.remplis.includes('#6a8600'),
    'la fenêtre est remplie du vert de la teinte : ' + ctx.remplis.join(','));
  assert.ok(!ctx.images.includes('face' + bloque.faceId + '_0'),
    'le portrait n’est pas dessiné sous l’aplat');
  assert.ok(ctx.images.includes('menuFaceTop'), 'mais le cadre reste');
});

test('le sel et le poivre ont un corps, pas seulement des yeux', () => {
  const SW = client();
  // Le portrait de ces deux-là ne porte que l'expression ; le corps est dans
  // un base.png commun à tous leurs états.
  const assets = fs.readFileSync(path.join(SWAPOU, 'assets.js'), 'utf8');
  assert.match(assets, /face2_base.*salt\/base\.png/, 'le corps du sel est chargé');
  assert.match(assets, /face3_base.*poivre\/base\.png/, 'celui du poivre aussi');
  for (const f of ['salt/base.png', 'poivre/base.png'])
    assert.ok(fs.existsSync(path.join(ROOT, 'Games/swapou2/character/bitmap', f)), f + ' existe');

  const SW2 = SW;
  const face = new SW2.U.Face(2);                    // Monsieur Sel
  const ctx = ctxMouchard();
  face.draw(ctx, 0, 0, 110);
  assert.ok(ctx.images.includes('face2_base'), 'le corps est posé en premier');
  assert.ok(ctx.images.includes('face2_0'), 'puis l’expression');
  assert.ok(ctx.images.indexOf('face2_base') < ctx.images.indexOf('face2_0'),
    'dans cet ordre — sinon les yeux passent dessous');
});

test('les personnages du menu tiennent dans le cadre au lieu d’être coupés en deux', () => {
  const SW = client();
  const menu = menuEn(SW, 10);
  // Menu.as amène Dimitri à _x = 0 et Natacha à _x = DOCWIDTH : centrer les
  // dessins sur ces abscisses en perdait la moitié. Chaque image a son propre
  // point d'ancrage, relevé sur le SWF.
  assert.equal(menu.leftCharX, 0);
  assert.equal(menu.rightCharX, SW.U.D.DOCWIDTH);
  const ctx = ctxMouchard();
  const poses = [];
  ctx.drawImage = function (i, x, y, w) { poses.push({ nom: i && i.nom, x: x, y: y, w: w }); };
  menu.draw(ctx);
  const d = poses.find((p) => p.nom === 'fullDimitri');
  const n = poses.find((p) => p.nom === 'fullNatacha');
  assert.ok(d && d.x > -5 && d.x < 5, 'Dimitri démarre au bord gauche : x = ' + (d && d.x));
  assert.ok(n && n.x + n.w > SW.U.D.DOCWIDTH - 5,
    'Natacha finit au bord droit : x + l = ' + (n && (n.x + n.w)));
  assert.ok(d.y > 0 && n.y >= 0, 'et tous deux posent les pieds en bas de l’écran');
});

test('le gros fruit garde l’ancrage de son dessin (la pomme n’est pas centrée)', () => {
  const SW = client();
  const menu = menuEn(SW, 10);
  const D = SW.U.D;
  const pose = (nom) => {
    menu.menuFruitImg = nom;
    // On fige la respiration pour comparer des chiffres stables.
    menu.fruit.curX = D.MENU_FRUIT_X;
    menu.fruit.curY = D.MENU_FRUIT_Y;
    menu.fruit.scaleX = menu.fruit.scaleY = 100;
    const ctx = ctxMouchard();
    const vus = [];
    ctx.drawImage = function (i, x, y, w, h) { vus.push({ nom: i && i.nom, x, y, w, h }); };
    menu.draw(ctx);
    return vus.find((v) => v.nom === nom);
  };
  // Les trois dessins font 285×439. L'orange et la poire sont centrés sur leur
  // milieu ; la POMME est ancrée 42,75 px plus bas — sur le cœur du fruit,
  // feuilles exclues. La centrer la posait trop bas d'autant.
  const orange = pose('menuOrange');
  assert.equal(orange.y, D.MENU_FRUIT_Y - 219.5, 'l’orange est centrée');
  const poire = pose('menuPoire');
  assert.equal(poire.y, D.MENU_FRUIT_Y - 219.5, 'la poire aussi');
  const pomme = pose('menuPomme');
  assert.equal(pomme.y, D.MENU_FRUIT_Y - 262.25, 'la pomme est ancrée plus bas');
  assert.equal(pomme.x, D.MENU_FRUIT_X - 142.5, 'et centrée horizontalement, elle');
});

test('la barre d’aide est une ligne de texte, pas un encart', () => {
  const SW = client();
  const menu = menuEn(SW, 10);
  menu.barVisible = true;
  menu.help('Choisir un mode de jeu');
  const ctx = ctxMouchard();
  menu.draw(ctx);
  assert.ok(ctx.textes.includes('Choisir un mode de jeu'), 'l’aide est écrite');
  const i = ctx.textes.indexOf('Choisir un mode de jeu');
  assert.match(ctx.polices[i], /Impact SW/, 'en Impact, comme le champ #357 du SWF');
  // L'encart cerné qu'on dessinait avant n'existe pas dans l'original.
  assert.ok(!ctx.remplis.includes('#fff7dd'), 'plus de cartouche crème derrière');
});
