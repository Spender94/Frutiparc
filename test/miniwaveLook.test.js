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

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

test('les pièces qui tombent sont le dessin du SWF, teinté par valeur', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/miniwave/sprites/sprites.json'), 'utf8'));
  assert.ok(manifeste.piece && manifeste.piece.etats.length >= 2,
    'la pièce du compteur est extraite (tranche et face)');
  const jeu = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(jeu, /0xF2, 0xD1, 0xAA\], \[0xFF, 0xFF, 0xFF\], \[0xFF, 0xF5, 0x8A\], \[0xA5, 0xF8, 0x9E/,
    'les quatre teintes de MC.setColor');
  assert.match(jeu, /pieceTeintee/, 'et le rendu colore la pièce par sa lumière');
  assert.match(jeu, /Math\.cos\(o\.y \/ 5\)/, 'la toupie suit la chute');
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

// ── 5. Les smileys du stand au forum ──────────────────────────────────────

test('les trois smileys animés existent et portent les dessins du SWF', () => {
  for (const f of ['smiley_love.svg', 'smiley_laugh.svg', 'smiley_twirl.svg']) {
    const p = path.join(ROOT, 'public/fb', f);
    assert.ok(fs.existsSync(p), f + ' existe');
    const svg = fs.readFileSync(p, 'utf8');
    assert.match(svg, /@keyframes/, f + ' est animé');
    assert.match(svg, /data:image\/png;base64,/, f + ' embarque le dessin d\'origine');
  }
});

test('le forum connaît les smileys du stand : rendu pour tous, rangée pour les acheteurs', () => {
  const forum = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');
  assert.match(forum, /MINIWAVE_EMOTICONS/, 'la table des smileys du stand');
  assert.match(forum, /smiley_love\.svg/, 'le Love');
  assert.match(forum, /:laugh:/, 'le code du Laugh');
  assert.match(forum, /mySmileys\.indexOf\(s\.code\) < 0\) continue/, 'la rangée est réservée aux acheteurs');
  // Le RENDU, lui, passe par _buildEmoSubs qui inclut tout le monde.
  assert.match(forum, /entries\.push\(\{ code: MINIWAVE_EMOTICONS\[k\]\.code/, 'le rendu les montre à tous');

  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(serveur, /MINIWAVE_FORUM_SMILEYS/, 'le serveur porte la table');
  assert.match(serveur, /smileys,/, 'et /api/forum/me l\'expose');
});

// ── Bout en bout : l'achat au stand ouvre la rangée du forum ─────────────

const PORT = 3487;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5218', FRUTISCORE_PORT: '5219',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

test('acheter un smiley au stand l\'ajoute à la rangée du forum du joueur', async () => {
  const corps = JSON.stringify({ username: 'fumeur2smiley', password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
  const { sid } = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps,
  })).json();
  assert.ok(sid, 'connecté');

  // Avant l'achat : pas de smiley du stand dans la rangée.
  let moi = await (await fetch(BASE + '/api/forum/me?sid=' + sid)).json();
  assert.deepEqual((moi.smileys || []).map((s) => s.code), [], 'rien avant l\'achat');

  // L'achat au stand : la fiche part avec $shop[10] et [12] à 0 (achetés) —
  // c'est ce que le SWF comme le light enregistrent.
  const carte = {
    $ship: [true, false, false, false, false, false],
    $badsKill: new Array(51).fill(0),
    $arcade: { $bestLevel: 1, $bestScore: 120 },
    $cons: { $main: 0, $bonus: [0, 0, 0, 0, 0, 0, 0, 0], $letter: 0 },
    $shop: new Array(20).fill(1),
    $credit: 0,
    $vs: 0.93,
  };
  carte.$shop[10] = 0;                     // Smiley Love acheté
  carte.$shop[12] = 0;                     // Smiley Twirl acheté
  const r = await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: JSON.stringify(carte) }),
  });
  assert.ok(r.ok, 'la fiche est enregistrée');

  // Après : les deux smileys achetés sont dans la rangée — pas le troisième.
  moi = await (await fetch(BASE + '/api/forum/me?sid=' + sid)).json();
  const codes = (moi.smileys || []).map((s) => s.code).sort();
  assert.deepEqual(codes, [':love:', ':twirl:'], 'les smileys achetés, et eux seuls');

  // Et leurs images se servent en SVG animé (le picto du stand aussi).
  const svg = await fetch(BASE + '/fb/smiley_love.svg');
  assert.ok(svg.ok, 'le smiley se sert depuis /fb/');
  const picto = await fetch(BASE + '/api/picto/%24smiley_love');
  assert.ok(picto.ok, 'le picto du stand se sert');
  assert.match(picto.headers.get('content-type') || '', /image\/svg\+xml/, 'en SVG, pas en GIF menteur');
});
