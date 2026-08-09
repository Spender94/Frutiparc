/*
 * Le « look & feel » de Miniwave light doit être celui du Flash — troisième
 * vague de retours joueurs :
 *
 *   1. La TYPO : le SWF embarque Jawbreaker Hard BRK (score 24, encadrés 14),
 *      Arcade Classic (titres de niveaux, 32) et une Verdana pixel 10. Elles
 *      sont extraites en WOFF et posées partout — le menu n'est plus en
 *      Verdana système.
 *   2. L'ÉCRAN DE CHARGEMENT : celui du disque d'origine (loader_miniwave.swf)
 *      — fond blanc, cadre à tuiles, logo frusion, pourcentage.
 *   3. Les PIÈCES : le dessin du clip Opt du SWF, teinté par valeur comme
 *      MC.setColor (bronze F2D1AA, argent FFFFFF, or FFF58A, platine A5F89E).
 *   4. L'INTERFACE : score en Jawbreaker CENTRÉ en haut avec ses pointillés
 *      (panel/Score.as), vies en bas à droite à 40 % (LifePanel.as), panneaux
 *      de niveau du SWF (miniWave2Msg) avec leurs polices.
 *   5. Les SMILEYS du stand ($smiley_love/laugh/twirl) rejoignent le forum :
 *      rangée de l'éditeur pour les acheteurs, rendu pour tout le monde.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// ── 1. La typo ────────────────────────────────────────────────────────────

test('les polices du SWF sont extraites et déclarées', () => {
  for (const f of ['jawbreaker.woff', 'arcade.woff', 'verdana10.woff']) {
    const p = path.join(ROOT, 'public/miniwave/fontes', f);
    assert.ok(fs.existsSync(p), f + ' existe');
    const octets = fs.readFileSync(p);
    assert.equal(octets.slice(0, 4).toString('ascii'), 'wOFF', f + ' est un WOFF');
  }
  const page = fs.readFileSync(path.join(ROOT, 'public/miniwave/index.html'), 'utf8');
  assert.match(page, /font-family: 'Jawbreaker'/, 'Jawbreaker déclarée');
  assert.match(page, /font-family: 'ArcadeClassic'/, 'Arcade Classic déclarée');
  assert.match(page, /font-family: 'VerdanaPix'/, 'la Verdana pixel déclarée');
  assert.match(page, /document\.fonts\.load\('24px Jawbreaker'\)/, 'chargées avant le premier dessin');
});

test('le menu et le jeu écrivent avec les polices du SWF', () => {
  const menu = fs.readFileSync(path.join(ROOT, 'public/miniwave/menu.js'), 'utf8');
  assert.ok(!/Verdana, Arial/.test(menu), 'plus de Verdana système dans le menu');
  assert.match(menu, /14px Jawbreaker/, 'les encadrés en Jawbreaker 14 (le champ du stand)');
  assert.match(menu, /10px VerdanaPix/, 'les petits textes en Verdana pixel 10');
  assert.match(menu, /const ENCRE = '#4e5387'/, 'l\'encre des encadrés est celle du SWF');

  const jeu = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(jeu, /24px Jawbreaker/, 'le score en Jawbreaker 24 (champ #1121)');
  assert.match(jeu, /32px ArcadeClassic/, 'les titres de niveau en Arcade Classic 32 (champ #1068)');
  assert.match(jeu, /rgba\(255,255,255,\.6\)/, 'blanc à 60 %, comme le champ du score');
});

// ── 2. L'écran de chargement ──────────────────────────────────────────────

test('l\'écran de chargement est celui du disque d\'origine', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/miniwave/loader/loader.json'), 'utf8'));
  assert.ok(manifeste.cadre && manifeste.cadre.etats.length >= 1, 'le cadre à tuiles est extrait');
  assert.ok(manifeste.logo && manifeste.logo.etats.length === 1, 'le logo frusion est extrait');
  for (const cle of Object.keys(manifeste)) {
    for (const e of manifeste[cle].etats) {
      for (const p of e.pieces) {
        assert.ok(fs.existsSync(path.join(ROOT, 'public/miniwave/loader', p.fichier)),
          'la pièce ' + p.fichier + ' est là');
      }
    }
  }
  const page = fs.readFileSync(path.join(ROOT, 'public/miniwave/index.html'), 'utf8');
  assert.match(page, /chargement-toile/, 'la toile de chargement est posée');
  assert.match(page, /loader\/loader\.json/, 'et compose le manifeste du loader');
  assert.match(page, /background: #ffffff/, 'sur le fond blanc du SWF');
  assert.ok(!/MINIWAVE 2<\/div>/.test(page), 'l\'ancien écran vert a disparu');
});

// ── 3. Les pièces ─────────────────────────────────────────────────────────

test('les pièces qui tombent sont RONDES, teintées par valeur, et toupillent', () => {
  const jeu = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  // Le corps est un DISQUE (la pièce du compteur, elle, est un carré arrondi —
  // pas la bonne forme pour le bonus qui tombe).
  assert.match(jeu, /cc\.arc\(0, 0, r, 0, 6\.2832\)/, 'le corps de la pièce est un disque');
  assert.match(jeu, /shape1381\.svg/, 'coiffé du vrai reflet extrait du SWF');
  assert.match(jeu, /0xF2, 0xD1, 0xAA\], \[0xFF, 0xFF, 0xFF\], \[0xFF, 0xF5, 0x8A\], \[0xA5, 0xF8, 0x9E/,
    'les quatre teintes de MC.setColor');
  assert.match(jeu, /pieceTeintee/, 'et le rendu colore la pièce par sa lumière');
  assert.match(jeu, /Math\.cos\(o\.y \/ 5\)/, 'la toupie suit la chute');
});

test('les niveaux s\'annoncent en « level » minuscule — les seuls glyphes de la police', () => {
  const jeu = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  // L'Arcade Classic du SWF n'embarque QUE les caractères que le jeu tapait :
  // e, l, v (minuscules), B, R, A, V, O, les chiffres… Un « LEVEL » majuscule
  // ferait retomber le L sur la police de secours.
  assert.match(jeu, /'level ' \+ \(d\.level \+ 1\)/, 'la chaîne exacte de game/Main.as');
  assert.ok(!/'LEVEL ' \+/.test(jeu), 'plus de LEVEL majuscule');
  // GAME OVER : ni G ni M dans l'Arcade Classic — c'est la Jawbreaker qui s'y colle.
  assert.match(jeu, /24px Jawbreaker[^']*';\s*\n\s*ctx\.fillStyle = '#ffffff';\s*\n\s*ctx\.fillText\('GAME OVER'/,
    'GAME OVER en Jawbreaker');
});

// ── 4. L'interface ────────────────────────────────────────────────────────

test('score centré avec ses pointillés, vies en bas à droite, panneaux du SWF', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/miniwave/sprites/sprites.json'), 'utf8'));
  assert.ok(manifeste.scoreOrne, 'l\'ornement du score est extrait');
  assert.equal(manifeste.msg.etats.length, 4, 'les quatre panneaux de message sont extraits');
  assert.ok(manifeste.menuFond, 'le fond du menu aussi');

  const jeu = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(jeu, /\(LARGEUR - tw\) \/ 2/, 'le score est CENTRÉ (panel/Score.as)');
  assert.match(jeu, /scoreOrne/, 'avec ses pointillés de part et d\'autre');
  assert.match(jeu, /HAUTEUR - 6, 0\.4/, 'les vies en bas à droite à 40 % (LifePanel.as)');
  assert.match(jeu, /dessinerMessage/, 'les panneaux de niveau du SWF');
  assert.match(jeu, /alpha \* 0\.8 \+ p\.ta \* 0\.2/, 'avec le fondu de Msg.update');
});

// ── 5. Les smileys du stand : en ATTENTE de leurs GIF d'origine ──────────
// Les animations recréées ont été retirées à la demande : les vrais GIF
// d'époque seront posés dans public/fb/ quand ils auront été retrouvés, et
// la rangée du forum rebranchée à ce moment-là. D'ici là, le forum ne doit
// porter AUCUNE trace des smileys du stand.

test('le forum ne porte pas de smileys du stand tant que les GIF d\'origine manquent', () => {
  const forum = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');
  assert.ok(!/MINIWAVE_EMOTICONS/.test(forum), 'pas de table de smileys du stand');
  assert.ok(!/smiley_love/.test(forum), 'pas de fichier smiley référencé');
  for (const f of ['smiley_love.svg', 'smiley_laugh.svg', 'smiley_twirl.svg']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'public/fb', f)), f + ' a été retiré');
  }
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(!/MINIWAVE_FORUM_SMILEYS/.test(serveur), 'le serveur non plus');
  // L'achat au stand continue de donner le picto ($smiley_*) — seule la
  // partie forum attend.
  assert.match(serveur, /'\$smiley_love'/, 'le picto du stand existe toujours');
});
