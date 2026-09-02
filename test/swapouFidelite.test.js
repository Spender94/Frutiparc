'use strict';
/*
 * SWAPOU — LE CHALLENGE, AU PLUS PRÈS DU FLASH
 * ═══════════════════════════════════════════
 *
 * Deux demandes : « le compteur d'étoiles n'est pas capé » (à confirmer), et
 * « les animations et assets 100 % identiques au jeu Flash ». La première est
 * une simulation ; la seconde, un relevé image par image des clips du SWF
 * (Games/swapou2/swapou.swf) confronté au portage.
 *
 * Ce qui était FAUX ou MANQUANT, et que ce fichier verrouille :
 *
 *   · L'ÉCHANGE : sept images en arc, contre douze où le fruit blanchit et
 *     S'ÉTIRE vers sa case (clips swapLeft/Right/Up/Down). La phase de swap
 *     dure treize images, comme Animator.as.
 *   · L'EXPLOSION : un cercle qui s'estompe, contre le disque (ou l'anneau,
 *     pour une armure) qui grossit en tournant sur huit images.
 *   · LES PARTICULES : des triangles colorés, contre les neuf formes du clip
 *     — éclats blancs de fruit, jaune/orange d'étoile, roches, glace.
 *   · L'ÉTOILE VOLANTE : déplacée mais JAMAIS DESSINÉE. C'est l'étoile
 *     blanche qui tourne en volant vers la jauge.
 *   · LE « MAX ! » : un texte Verdana, contre le libellé vectoriel du clip,
 *     qui clignote (treize images en boucle).
 *   · L'ICÔNE DE POUVOIR : posée par son coin, 23 px trop à droite, avec une
 *     bosse d'échelle inventée ; le clip est centré et son survol lance une
 *     étoile.
 *   · L'ÉTOILE DE COMBO : figée après le score ; le clip la tient une seconde
 *     et demie puis la retire. Ses chiffres sont en DooM, inclinés de 10,5°.
 *   · L'ANNONCE DU COCKTAIL : une demi-seconde, contre le maintien d'une
 *     seconde et demie qu'imposent ses scripts d'image.
 *   · LE SCORE : Verdana, contre la fonte « cipher » étirée de 1,6 en hauteur.
 *   · LE SCORE FLOTTANT : trente images sur sa plaque noire, en DooM.
 *   · LE BANDEAU DE DÉFENSE : un cadre dessiné, contre la plaque #358 et
 *     Impact 16.
 *   · LES PANNEAUX qui glissent en place à l'ouverture ; la ligne de mort
 *     subite deux pixels plus haut et à pleine opacité ; la pause sans voile ;
 *     les fruits posés en (0, 0) dans leur case, pas centrés ; les reflets des
 *     fruits étoile et gelés ; le fond blanc du fondu de visage, les dégradés
 *     dans le bon sens, et les trois fonds animés.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const JEU = lire('public/swapou/game.js');
const UI = lire('public/swapou/ui.js');
const ASSETS = lire('public/swapou/assets.js');
const PAGE = lire('public/swapou/index.html');

// ── un client dans son bac à sable, comme draw.test.js ─────────────────────
function client() {
  const sandbox = {
    console: console, setTimeout: setTimeout, URLSearchParams: URLSearchParams,
    performance: { now: function () { return Date.now(); } },
    Date: Date, Math: Math, JSON: JSON,
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'].forEach(function (f) {
    vm.runInContext(lire('public/swapou/' + f), sandbox, { filename: f });
  });
  const SW = sandbox.SW;
  const fakeImg = { naturalWidth: 38, naturalHeight: 38, complete: true };
  SW.A.img = function () { return fakeImg; };
  SW.A.fruitImage = function () { return fakeImg; };
  SW.A.has = function () { return true; };
  SW.Manager.init('');
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.players = [1, -1];
  SW.Manager.mode.destroy();
  SW.Manager.mode = new SW.Challenge();
  return { SW: SW, chal: SW.Manager.mode, E: sandbox.SwapouEngine, U: sandbox.SwapouUI };
}
function pump(SW, n) { for (let i = 0; i < n; i++) SW.Manager.main(1, 1 / 40); }
// Joue une paire échangeable (souris + clic, comme un joueur) : de
// préférence une qui fait un combo — l'échange est essayé puis défait sur la
// grille —, sinon la première venue.
function jouer(SW, chal, combo) {
  const lvl = chal.player.level;
  const info = chal.player.animator.getInfos();
  let premiere = null;
  for (let x = 0; x < lvl.width - 1; x++)
    for (let y = 0; y < lvl.height; y++) {
      const f1 = lvl.getFruit(x, y), f2 = lvl.getFruit(x + 1, y);
      if (!(f1 && f2 && f1.canSwap() && f2.canSwap())) continue;
      const p = { x: x, y: y, dx: 1, dy: 0, f1: f1, f2: f2 };
      if (!premiere) premiere = p;
      if (!combo) break;
      lvl.swapPair(p);
      const c = lvl.calc();
      lvl.swapPair(p);
      if (c != null) { premiere = p; x = lvl.width; break; }
    }
  if (!premiere) return false;
  SW.handleMouseMove(info.px + premiere.x * 35 + 30, info.py + premiere.y * 35 + 17);
  chal.onClickDown();
  return true;
}
// Un contexte qui compte ce qu'on lui demande.
function compteur() {
  const n = { fill: 0, drawImage: 0, fillText: 0, clip: 0 };
  const grad = { addColorStop() {} };
  const ctx = {
    canvas: { width: 700, height: 480 },
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
    arc() {}, arcTo() {}, rect() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    stroke() {}, strokeText() {}, measureText() { return { width: 10 }; },
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }, setTransform() {},
    fill() { n.fill++; }, drawImage() { n.drawImage++; }, fillText() { n.fillText++; },
    clip() { n.clip++; },
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
    lineWidth: 1, lineJoin: 'miter', font: '', textAlign: 'left', textBaseline: 'alphabetic',
  };
  return { ctx, n };
}

test('les étoiles de pouvoir sont plafonnées à six — logique ET affichage', () => {
  const { SW, chal, E } = client();
  // Une étoile sur deux : la jauge se remplit vite, et déborde souvent.
  chal.genFruitFlags = function () { return Math.random() < 0.5 ? E.FLAG_STAR : 0; };
  let recoltees = 0, maxLogique = 0, maxAffiche = 0;
  const getPower = chal.getPower.bind(chal);
  chal.getPower = function (ctx, mc) { recoltees++; return getPower(ctx, mc); };
  let coups = 0, garde = 0;
  while (recoltees < 15 && garde++ < 60000 && !chal.player.isGameOver()) {
    if (!chal.lock && jouer(SW, chal, true)) coups++;
    pump(SW, 1);
    maxLogique = Math.max(maxLogique, chal.player.star_counter);
    maxAffiche = Math.max(maxAffiche, chal.interf.pl[0].power);
  }
  assert.ok(recoltees >= 15, 'des étoiles ont été récoltées : ' + recoltees + ' (' + coups + ' coups)');
  assert.strictEqual(maxLogique, 6, 'Player.star_counter plafonne à MAX_POWER');
  assert.strictEqual(maxAffiche, 6, 'Interf.pl[0].power aussi');
  // Et le code le dit noir sur blanc, aux deux endroits (Player.as, Interf.as).
  assert.match(JEU, /this\.star_counter\+\+;\s*\n\s*if \(this\.star_counter > D\.MAX_POWER\) this\.star_counter = D\.MAX_POWER;/);
  assert.match(JEU, /player\.power\+\+;\s*\n\s*if \(player\.power > D\.MAX_POWER\) \{\s*\n\s*player\.power = D\.MAX_POWER;/);
});

test('l’échange joue les douze images du clip d’époque, et la phase dure treize', () => {
  // Les quatre pellicules, relevées sur #189 à #192 : blanchiment dès la
  // troisième image, étirement au double à la sixième, rétraction en 36.
  assert.match(UI, /droite: \[\[0, 0, 1, 1, 0, 1\], \[-0\.55, 0, 1\.0278, 1, 0\.25, 1\], \[-2\.2, 0, 1\.1111, 1, 1, 1\],/);
  assert.match(UI, /\[0\.05, 8\.05, 2\.1234, 0\.5975, 1, 0\.69\], \[20\.1, 3\.6, 1\.4993, 0\.8211, 1, 0\.69\],/);
  assert.match(UI, /gauche: \[\[0, 0, 1, 1, 0, 1\], \[-0\.55, 0, 1\.0278, 1, 0\.25, 1\], \[-2\.2, 0, 1\.1111, 1, 1, 1\],\s*\n\s*\[-6\.4, 0, 1\.2236, 1, 1, 1\], \[-19\.2, 0, 1\.561, 1, 1, 1\], \[-40\.35, 0, 2\.1234, 1, 1, 1\],/);
  assert.match(JEU, /\{ totalFrames: 12, img: A\.fruitImage\(f1\), table: U\.SWAP\[s1\] \}/);
  assert.ok(!/swapAnim/.test(JEU) && !/swapAnim/.test(UI), 'plus d’arc inventé');
  // Le blanc est une interpolation (source-atop), appliquée depuis le coin.
  assert.match(UI, /avecEclat\(ctx, t\[4\], 0, 0, 38, 38, function \(c\) \{ c\.drawImage\(img, 0, 0, 38, 38\); \}\);/);

  const { SW, chal } = client();
  pump(SW, 2);
  assert.ok(jouer(SW, chal), 'un échange joué');
  const anim = chal.player.animator;
  assert.strictEqual(anim.particules.fxList.length, 2, 'un clip par fruit');
  assert.strictEqual(anim.particules.fxList[0].kind, 'swapFruit');
  let ticks = 0;
  while (anim.animPhase === SW.U.D.A_SWAP && ticks < 50) { pump(SW, 1); ticks++; }
  // Animator.as : les clips meurent à leur douzième image (onze pas), puis
  // trois images d'attente avant swapDone.
  assert.strictEqual(ticks, 13, 'treize images de phase A_SWAP (11 + 3 − 1)');
});

test('l’explosion, les particules, l’éclair et le bandeau sont ceux du fichier', () => {
  assert.match(UI, /const EXPLOSION = \[\[1, 0\], \[1\.233, -157\.5\], \[1\.3995, 90\], \[1\.4994, 22\.5\], \[1\.5327, 0\],/);
  assert.match(JEU, /this\.particules\.explodeFruit\(f\.spr\.x, f\.spr\.y\);/, 'des éclats BLANCS');
  assert.match(JEU, /\{ totalFrames: 8 \}\);\s*\n\s*f\.spr\.dead = true;/);
  assert.match(JEU, /\{ totalFrames: 8, gel: true \}\);/, 'l’anneau pour les armures');
  // Les neuf formes du clip particule, telles quelles.
  assert.match(UI, /particule1: \[\s*\/\/ #57\s*\n\s*\["#ffffff", 1, "M-4\.1 3\.75L-1\.65 -4\.6L4\.6 3\.75L-4\.1 3\.75Z"\],/);
  assert.match(UI, /particule4: \[\s*\/\/ #60\s*\n\s*\["#574532", 1,/);
  assert.match(UI, /particule9: \[\s*\/\/ #65\s*\n\s*\["#ffffff", 1,/);
  assert.match(UI, /tracerForme\(ctx, FORMES\['particule' \+ Math\.max\(1, Math\.min\(9, mc\.frame\)\)\]\);/);
  // L'éclair de l'écarteur : trois barres, treize images.
  assert.match(UI, /const STRIKE = \[\[0, 1, 1\], \[22\.35, 0\.8563, 2\.6294\], \[42\.8, 0\.725, 3\.1726\],/);
  assert.match(JEU, /attachFx\('strike',\s*\n[^\n]*\{ totalFrames: 13 \}\);/);
  // Le bandeau : la plaque #358 (celle du titre du menu) et Impact 16 crème.
  assert.match(UI, /const BANDEAU = \[\[-27, 0\], \[-20\.65, 0\.234\], \[-15\.2, 0\.4375\],/);
  assert.match(UI, /const plaque = A\.img\('menuTitre'\);/);
  assert.match(UI, /\{ size: 16, color: '#ffe8b7', font: 'impact', baseline: 'alphabetic' \}/);
  assert.match(JEU, /attachFx\('defense', this\.pos_x \+ width \/ 2, D\.SPECIAL_Y, \{ totalFrames: 9, text: txt \+ ' !' \}\)/);
  // Le score flottant : trente images, plaque noire à 35 %, DooM 13.
  assert.match(UI, /const SCORE_POP = \[0, -0\.1, -0\.45, -1\.05, -1\.85, -2\.95, -4\.2, -5\.75, -7\.5, -9\.5, -11\.7, -14\.15,/);
  assert.match(UI, /plaque: \[\s*\/\/ #134\s*\n\s*\["#000000", 0\.35,/);
  assert.match(JEU, /\{ totalFrames: 30, text: score, big: score >= 1000 \}/);
});

test('l’étoile volante se dessine, l’éclat d’arrivée est blanc, le « max ! » clignote', () => {
  // flyingStar (#368) : l'étoile blanche tournée d'un cinquième de tour en six.
  assert.match(UI, /const FLYING_STAR = \[\[0, -0\.05, 0\], \[0\.3, 0\.15, 14\.3\], \[0\.6, 0\.35, 28\.8\],/);
  assert.match(JEU, /mc\.spin = \(mc\.spin \|\| 0\) \+ tmod;/);
  assert.match(JEU, /Interf\.prototype\.drawFx = function \(ctx\) \{/);
  // getPowerStar (#369) : plus d'étoile dorée qui tourne.
  assert.match(UI, /const GET_POWER_STAR = \[\[1, 1\], \[1\.3674, 0\.789\], \[1\.6916, 0\.605\],/);
  assert.ok(!/ctx\.rotate\(t \* 1\.2\);/.test(UI), 'plus de rotation inventée');
  // maxIndicator (#372) : le vectoriel, en boucle de treize images.
  assert.match(JEU, /const MAX_IMAGES = \[\[1\.2889, 1\], \[1\.2212, 0\.762\], \[1\.1625, 0\.559\],/);
  assert.match(JEU, /const max = A\.img\('max'\);/);
  assert.match(ASSETS, /max: '\/swapou\/ui\/max\.svg'/);
  assert.ok(fs.existsSync(path.join(ROOT, 'public/swapou/ui/max.svg')));
  assert.ok(!/'max !'/.test(JEU), 'plus de texte « max ! » en Verdana');

  const { SW, chal } = client();
  pump(SW, 2);
  // Une étoile qui part d'un fruit : elle se DESSINE en vol.
  chal.interf.addPower(0, { spr: { x: 300, y: 200 } });
  assert.strictEqual(chal.interf.powerFx.length, 1);
  pump(SW, 1);
  const { ctx, n } = compteur();
  chal.interf.drawFx(ctx);
  assert.ok(n.fill > 0, 'l’étoile en vol est peinte (' + n.fill + ' remplissages)');
  // Elle arrive en dix images, et la jauge s'incrémente alors seulement.
  pump(SW, 12);
  assert.strictEqual(chal.interf.powerFx.length, 0, 'arrivée');
  assert.strictEqual(chal.interf.pl[0].oldPower, 1, 'une étoile posée');
});

test('l’étoile de combo se tient une seconde et demie puis se retire ; l’annonce aussi', () => {
  const { SW, chal } = client();
  const anim = chal.player.animator;
  anim.attachComboStar();
  anim.finalComboScore(600, 3);
  const cs = anim.comboStar;
  assert.ok(cs.done && cs.flying, 'score final, super combo');
  assert.ok(anim.comboName, 'une annonce de cocktail (palier 3)');
  // Après le flash (image 7 → 9), le maintien : 60 images à l'image 11 — le
  // décompte commence à la cinquième image, l'attente tombe à zéro à la 64e,
  // et le retrait (12 → 22) retire l'étoile à la 74e.
  for (let i = 0; i < 40; i++) anim.main(1);
  assert.ok(anim.comboStar === cs, 'l’étoile tient encore à 40 images');
  assert.strictEqual(Math.round(cs.anim), 11, 'sur son image 11');
  assert.ok(anim.comboName, 'l’annonce aussi');
  assert.strictEqual(Math.round(anim.comboName.frame), 14, 'sur son image 14');
  for (let i = 0; i < 30; i++) anim.main(1);
  assert.ok(anim.comboStar === cs && cs.anim > 11, 'à 70 images, le retrait a commencé (' + cs.anim + ')');
  assert.ok(anim.comboName && Math.round(anim.comboName.frame) === 14, 'l’annonce tient encore (armée à la 11e, décomptée dès la 14e)');
  for (let i = 0; i < 20; i++) anim.main(1);
  assert.strictEqual(anim.comboStar, null, 'à 90 images, l’étoile est retirée (image 22)');
  assert.strictEqual(anim.comboName, null, 'et l’annonce est sortie (image 20)');
  // Les chiffres : DooM, jaune, inclinés — 43 pendant la chaîne, 25 + « pts » après.
  assert.match(JEU, /\{ size: 43, color: '#fffd58', font: 'doom', baseline: 'alphabetic' \}/);
  assert.match(JEU, /\{ size: 25, color: '#fffd58', font: 'doom', baseline: 'alphabetic' \}/);
  assert.match(JEU, /U\.text\(c, 'pts', 28, 21,/);
  assert.match(JEU, /c\.rotate\(10\.5 \* Math\.PI \/ 180\);/);
});

test('le score en « cipher » étiré, les panneaux qui glissent, la ligne, la pause, les fruits', () => {
  assert.match(JEU, /dessinerScore\(ctx, this\.viewScore, 68\.4, 9\.15, 1\.6143, '#aa724b'\);/);
  assert.match(JEU, /U\.text\(ctx, String\(valeur\), cx, 23\.58,\s*\n\s*\{ size: 24, color: couleur, font: 'cipher', baseline: 'alphabetic' \}\);/);
  assert.match(JEU, /U\.text\(ctx, 'pts', 61\.7, 56\.25,/);
  assert.match(UI, /cipher: '"Cipher SW","Courier New",monospace',/);
  assert.match(UI, /doom: '"DooM SW",Impact,"Arial Narrow",Arial,sans-serif',/);
  assert.match(PAGE, /font-family: "Cipher SW";/);
  assert.match(PAGE, /font-family: "DooM SW";/);
  assert.match(PAGE, /document\.fonts\.load\('16px "DooM SW"'\),/);
  assert.ok(fs.existsSync(path.join(ROOT, 'public/swapou/fontes/cipher.woff')));
  assert.ok(fs.existsSync(path.join(ROOT, 'public/swapou/fontes/doom.woff')));
  // Les panneaux : sept et six images, depuis hors champ.
  assert.match(JEU, /const PANNEAU_GAUCHE = \[-177, -122\.9, -78\.65, -44\.25, -19\.65, -4\.9, 0\];/);
  assert.match(JEU, /const PANNEAU_DROIT = \[104, 66\.55, 37\.45, 16\.65, 4\.15, 0\];/);
  assert.match(JEU, /this\.intro \+= tmod;/);
  // La ligne de mort subite : posée en (0, −2), pleine opacité.
  assert.match(JEU, /if \(sd\) ctx\.drawImage\(sd, 0, D\.SUDDEN_Y - 2\);/);
  assert.ok(!/ctx\.globalAlpha = 0\.7;/.test(JEU), 'plus de 70 % inventés');
  // La pause : le seul clip pauseBox.
  assert.ok(!/rgba\(20,40,10,0\.35\)/.test(JEU), 'plus de voile');
  assert.ok(!/U\.text\(ctx, 'pause'/.test(JEU), 'plus de texte par-dessus l’image');
  // Les fruits : le bitmap de 38 posé en (0, 0) dans la case, pas centré.
  assert.match(JEU, /ctx\.drawImage\(img, s\.x \+ s\.subx, s\.y \+ s\.suby, 38, 38\);/);
  assert.match(JEU, /if \(g\.img\) ctx\.drawImage\(g\.img, g\.x, g\.y, 38, 38\);/);
  // L'icône de pouvoir, centrée là où le panneau la colle.
  assert.match(JEU, /this\.defenseIcon\.y = D\.POWER_Y - \(E\.DEFENSE_STARS\[SW\.Data\.players\[0\]\] - 1\) \* D\.POWER_HEIGHT;/);
  assert.match(UI, /return this\.visible && Math\.abs\(mx - this\.x\) <= 23\.5 && Math\.abs\(my - this\.y\) <= 17\.5;/);
  assert.match(UI, /const ICONE_ROUGE = \[0, 4, 17, 39, 69, 48, 31, 17, 8, 2, 0\];/);
  // Le visage : le blanc du fondu, les dégradés du fichier, les fonds animés.
  assert.match(UI, /\[\[0, '#87913e'\], \[0\.204, '#8ba544'\], \[1, '#b1c26b'\]\],/);
  assert.match(UI, /ctx\.fillStyle = '#ffffff';\s*\n\s*ctx\.fillRect\(0, 0, D\.FACE_WIDTH, D\.FACE_HEIGHT\);/);
  assert.match(UI, /this\.spirale \+= 20 \* tmod; this\.spirale2 \+= 13 \* tmod;/);
  assert.match(UI, /this\.soleil -= 1\.2 \* tmod;/);
  assert.match(ASSETS, /soleil: '\/swapou\/ui\/soleil\.png'/);
  // Les reflets des fruits étoile et gelés, en Challenge et en qualité haute.
  assert.match(JEU, /if \(this\.lod !== D\.HIGH \|\| SW\.Data\.gameMode !== SW\.Data\.CHALLENGE\) return;/);
  assert.match(JEU, /const ECLAT_ATTENTE = \{ etoile: 350, gel: 300 \};/);
});

test('l’écran de jeu se peint dans l’ordre des profondeurs du SWF, et l’icône réagit au survol', () => {
  const { SW, chal } = client();
  pump(SW, 10);
  const { ctx, n } = compteur();
  chal.draw(ctx);
  assert.ok(n.drawImage > 0 && n.fillText > 0, 'panneaux, fruits, score');
  // L'ordre : l'interface AVANT les effets, l'annonce APRÈS.
  const d = JEU.slice(JEU.indexOf('Challenge.prototype.draw = function'), JEU.indexOf('Challenge.prototype.drawExtra'));
  const i1 = d.indexOf('this.interf.drawFront(ctx);'), i2 = d.indexOf('drawOverlays(ctx);'),
    i3 = d.indexOf('this.player.animator.particules.draw(ctx);'), i4 = d.indexOf('this.interf.drawFx(ctx);'),
    i5 = d.indexOf('drawAnnonce(ctx);');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3 && i3 < i4 && i4 < i5, 'interface, étoile de combo, effets, annonce');
  // Le survol de l'icône fait défiler sa pellicule, qui finit son tour.
  const ic = chal.interf.defenseIcon;
  SW.handleMouseMove(ic.x, ic.y);
  pump(SW, 3);
  assert.ok(ic.frame > 1, 'la pellicule du survol tourne : ' + ic.frame);
  SW.handleMouseMove(400, 400);
  pump(SW, 3);
  assert.ok(ic.frame > 1, 'et finit son tour après le départ du curseur');
  pump(SW, 12);
  assert.strictEqual(ic.frame, 1, 'revenue à sa première image');
});
