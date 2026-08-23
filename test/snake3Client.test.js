/*
 * Frutisnake — le portage light, côté client et côté serveur.
 *
 * Trois familles de vérifications :
 *   · le MANIFESTE d'extraction (sprites.json) : tout ce que le client
 *     consomme doit y être, fichiers compris — un renommage dans
 *     l'extracteur casserait le jeu sans bruit ;
 *   · les MÉCANIQUES décompilées du SWF : PopupFX (sprite 719) et NumberMC
 *     (sprite 715), rejouées contre leurs invariants ; et les tables
 *     d'échelles des clips d'enrobage relues DANS le SWF ;
 *   · le SERVEUR : le disque light, les slots game=snake3 (collection +
 *     préférences), le score en classement snake3_classic, et le picto
 *     « Fruit N » dès vingt exemplaires.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const SPRITES = path.join(RACINE, 'public/snake3/sprites');
const manifeste = JSON.parse(fs.readFileSync(path.join(SPRITES, 'sprites.json'), 'utf8'));

// ── Le manifeste ──────────────────────────────────────────────────────────

test('le manifeste porte tous les clips que le client consomme', () => {
  const requis = ['fruits', 'options', 'slot', 'tete', 'fbarre', 'barreScore',
    'screens', 'screensSans', 'pan', 'menu', 'title', 'fleche', 'menuBackground',
    'optionPanel', 'bombe', 'langue', 'sonnette', 'trou', 'beurk', 'qparticule',
    'chiffresVert', 'chiffresRouge', 'chiffresJaune', 'page', 'pageSans',
    'dropCorner', 'dropLarge', 'bookHole', 'snakeMask', 'barSide', 'barMid',
    'fruitOuter', 'bonusOuter'];
  for (const cle of requis) {
    assert.ok(manifeste.clips[cle], 'clip manquant : ' + cle);
  }
  // Chaque fichier référencé existe sur disque.
  for (const [cle, clip] of Object.entries(manifeste.clips)) {
    for (const f of Object.values(clip.frames)) {
      assert.ok(fs.existsSync(path.join(SPRITES, f.fichier)), cle + ' → ' + f.fichier);
    }
  }
});

test('les mesures du moteur et des vues sont là', () => {
  const c = manifeste.cadres;
  assert.ok(c.col && c.col.w > 0, 'col de la tête');
  assert.ok(c.langueCol && typeof c.langueCol.x === 'number', 'col de la langue');
  assert.ok(c.playField && c.playField.champ.w > 0, 'pièces du terrain');
  assert.ok(fs.existsSync(path.join(SPRITES, 'backgroundField.svg')));
  assert.ok(fs.existsSync(path.join(SPRITES, 'backgroundBord.svg')));
  assert.strictEqual(c.fbarre.pieces.length, 6, 'six pièces de frutibarre');
  assert.ok(c.fbarre.pieces.some((p) => p.nom === 'mid'), 'la pièce mid');
  assert.ok(c.fbarre.pieces.some((p) => p.nom === 'b2'), 'la pièce b2');
  assert.ok(c.bookMask && c.bookMask.w > 500, 'le masque du livre');
  assert.ok(c.encycloFback && c.encycloFback.x > 600, 'la flèche de retour');
  assert.ok(c.pageGrad && c.pageGrad.poses[1], 'l\'ombre de pli des pages');
  assert.deepStrictEqual(Object.keys(manifeste.clips.pan.frames).sort(), ['1', '2', '3', '4'],
    'les quatre couleurs du panneau');
  // Les cinq images de page sans leur ombre.
  assert.deepStrictEqual(Object.keys(manifeste.clips.pageSans.frames).sort(),
    ['1', '2', '3', '4', '5']);
  // Les fruits : 342 vrais + les pourris (la planche 354 déborde à 449).
  assert.ok(Object.keys(manifeste.clips.fruits.frames).length >= 342);
});

test('les vingt-deux sons extraits répondent aux noms du jeu', () => {
  const C = require('../public/snake3/const.js');
  const sons = fs.readdirSync(path.join(RACINE, 'public/snake3/sons'));
  assert.strictEqual(sons.filter((f) => f.endsWith('.mp3')).length, 22);
  for (const nom of [C.SOUND_MENU_LOOP, C.SOUND_GAME_LOOP, C.SOUND_GAME_OVER,
    C.SOUND_FRUIT_EAT_1, C.SOUND_FRUIT_EAT_2, C.SOUND_EXPLOSE, C.SOUND_PAGE,
    C.SOUND_RETURN_MENU, C.SOUND_ROTATION_MENU, C.SOUND_SELECT_MENU,
    C.SOUND_SONNETTE, C.SOUND_DISAPPEAR]) {
    assert.ok(sons.includes(nom + '.mp3'), 'son manquant : ' + nom);
  }
});

test('les pages sans ombre n\'embarquent ni grad ni skin, et s\'auto-suffisent', () => {
  // La planche des fruits du gabarit est dessinée à l'exécution : la figer
  // dans la page montrerait toujours le fruit nº 1. Et un SVG chargé comme
  // image n'a pas le droit aux références externes : les photos du livre
  // doivent être inlinées en data:.
  const p1 = fs.readFileSync(path.join(SPRITES, 'pageSans001.svg'), 'utf8');
  assert.ok(!/href="bitmap/.test(p1), 'référence externe dans pageSans001');
  const p3 = fs.readFileSync(path.join(SPRITES, 'pageSans003.svg'), 'utf8');
  assert.ok(p3.includes('data:image/jpeg;base64,'), 'la couverture inline sa photo');
});

// ── Les mécaniques décompilées ────────────────────────────────────────────

const D = require('../public/snake3/dessin.js');

test('PopupFX : l\'entrée d\'écran rebondit puis se verrouille à 100', () => {
  // Text.as : PopupFX(screen, 0, 100, 10, 3, 1.2, 0.6, 0.5, 1).
  const fx = new D.PopupFX(0, 100, 10, 3, 1.2, 0.6, 0.5, 1);
  let sommet = 0, rebonds = 0, dernier = fx.monte;
  for (let i = 0; i < 400; i++) {
    fx.main(1);
    sommet = Math.max(sommet, fx.z);
    if (fx.monte !== dernier) { rebonds++; dernier = fx.monte; }
  }
  assert.strictEqual(fx.z, 100, 'z verrouillé sur la cible');
  assert.strictEqual(fx.vitesse, 0);
  // Le premier dépassement plafonne exactement à cible + dépassement.
  assert.ok(Math.abs(sommet - 110) < 1e-9, 'le premier rebond touche 110');
  // 10 → 6 → 3,6 → 2,16 → 1,296 → 0,7776 < 1 : au moins cinq inversions.
  assert.ok(rebonds >= 5, 'la série de rebonds décroissante (' + rebonds + ')');
});

test('PopupFX : le terrier descend tout droit et passe sous 3', () => {
  // Game.as : PopupFX(trou, 100, 0, 0, 3, 1, 0, 0, 0), détruit dès z < 3.
  const fx = new D.PopupFX(100, 0, 0, 3, 1, 0, 0, 0);
  let images = 0;
  while (fx.z >= 3 && images < 200) { fx.main(1); images++; }
  assert.ok(fx.z < 3, 'le terrier se referme');
  // À vitesse constante 3 : ~33 images pour perdre 97 points d'échelle.
  assert.ok(images >= 30 && images <= 36, images + ' images');
});

test('Nombre : l\'ancre au bord droit, chaque chiffre reculé de sa chasse', () => {
  D.poserManifeste(manifeste);
  const n = new D.Nombre('chiffresVert');
  n.poserVal(305);
  // NumberMC pose les unités d'abord : 5 à −ch(5), 0 à −ch(5)−ch(0), etc.
  const ch = (d) => manifeste.clips.chiffresVert.frames[d + 1].cadre.w;
  assert.strictEqual(n.chiffres.length, 3);
  assert.strictEqual(n.chiffres[0].d, 5);
  assert.ok(Math.abs(n.chiffres[0].x + ch(5)) < 1e-9);
  assert.strictEqual(n.chiffres[1].d, 0);
  assert.ok(Math.abs(n.chiffres[1].x + ch(5) + ch(0)) < 1e-9);
  assert.strictEqual(n.chiffres[2].d, 3);
  assert.ok(Math.abs(n.largeur - (ch(5) + ch(0) + ch(3))) < 1e-9);
});

test('les échelles d\'enrobage recopiées collent au SWF, image par image', () => {
  const { ouvrir } = require('../scripts/lib/swf-sprites.js');
  const swf = ouvrir(path.join(RACINE, 'Games/snake3/snake3.swf'));
  const R = require('../public/snake3/rendu.js');
  for (const [id, table] of [[451, R.ECHELLES_FRUIT], [450, R.ECHELLES_BONUS]]) {
    const frames = swf.parSprite.get(id);
    for (let f = 1; f <= table.length; f++) {
      const p = frames.get(f).find((q) => q.nom === 'f');
      assert.ok(Math.abs(p.M.a - table[f - 1]) < 0.002,
        `sprite ${id} image ${f} : ${p.M.a} ≠ ${table[f - 1]}`);
    }
  }
});

// ── Le serveur ────────────────────────────────────────────────────────────

const PORT = 3523;
const BASE = 'http://127.0.0.1:' + PORT;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function demarrerServeur() {
  const p = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-snake3-light', XMLSOCKET_PORT: '5294', FRUTISCORE_PORT: '5295',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', () => {});
  p.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + '/api/health').catch(() => null);
      if (r && r.ok) return p;
      if (r) return p;
    } catch (e) { /* pas prêt */ }
    await attendre(250);
  }
  p.kill('SIGKILL');
  throw new Error('serveur indisponible');
}

async function creerSession(pseudo) {
  await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: pseudo, password: 'secret123' }),
  });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: pseudo, password: 'secret123' }),
  });
  const corps = await r.json();
  assert.ok(corps.sid, 'sid de session');
  return corps.sid;
}

test('serveur : le disque light, les slots et le classement de Frutisnake', async (t) => {
  const serveur = await demarrerServeur();
  t.after(() => serveur.kill('SIGKILL'));

  // Le client est servi, manifeste compris.
  const index = await fetch(BASE + '/snake3/index.html');
  assert.strictEqual(index.status, 200);
  const spritesJson = await fetch(BASE + '/snake3/sprites/sprites.json');
  assert.strictEqual(spritesJson.status, 200);
  const m = await spritesJson.json();
  assert.ok(m.clips.fruits && m.cadres.fbarre);

  const sid = await creerSession('serpentin');

  // La collection s'écrit et se relit (slot 0), les préférences aussi (slot 1).
  const fruits = { 5: 25, 12: 3 };
  const s0 = await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sid, game: 'snake3', slotId: '0', data: JSON.stringify({ $fruits: fruits, $record: 800 }) }).toString(),
  });
  assert.ok(s0.ok);
  const s1 = await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sid, game: 'snake3', slotId: '1', data: JSON.stringify({ $music: false, $sounds: true, $keys: [37, 39, 38] }) }).toString(),
  });
  assert.ok(s1.ok);

  const relu = await (await fetch(BASE + '/api/loadFrutiSlots?sid=' + sid + '&game=snake3')).text();
  assert.ok(relu.includes('slot0='), 'slot 0 relu');
  const brut0 = decodeURIComponent(relu.split('&').find((x) => x.startsWith('slot0=')).slice(6).replace(/\+/g, ' '));
  const donnees0 = JSON.parse(brut0);
  assert.strictEqual(donnees0.$record, 800);
  assert.strictEqual(Number(donnees0.$fruits['5']), 25);

  // Vingt-cinq exemplaires du fruit 5 : le picto « Fruit 5 » est accordé,
  // pas le « Fruit 12 » (trois seulement) — extractGameItemsFromSlot.
  const brut = await (await fetch(BASE + '/api/admin/users/serpentin/gameitems?key=cle-snake3-light')).json();
  const liste = brut.items || brut.gameItems || brut;
  const pictos = (Array.isArray(liste) ? liste : []).map((x) => (typeof x === 'string' ? x : x.id));
  assert.ok(pictos.includes('Fruit 5'), 'picto Fruit 5 : ' + JSON.stringify(pictos));
  assert.ok(!pictos.includes('Fruit 12'));

  // Le score part en classement classique (m=0 → snake3_classic), la même
  // table que le disque Flash.
  const score = await (await fetch(BASE + '/api/saveScore?' + new URLSearchParams({
    sid, game: 'snake3', m: '0', score: '4321',
  }))).json();
  assert.strictEqual(score.rankingId, 'snake3_classic', JSON.stringify(score));
  assert.ok(score.newPos >= 1, 'classé : ' + JSON.stringify(score));
});
