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
    'dropCorner', 'dropLarge', 'bookBase', 'bookHole', 'bookMask', 'snakeMask',
    'barSide', 'barMid', 'fruitOuter', 'bonusOuter'];
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

  // Le pack de Frutisnake : plateforme.js interroge /api/features au
  // chargement et n'affiche le tableau de bord que si snake3Hud est vrai.
  const options = await (await fetch(BASE + '/api/features?sid=' + sid)).json();
  assert.strictEqual(options.ok, true, JSON.stringify(options));
  assert.strictEqual(options.username, 'serpentin');
  assert.strictEqual(options.features.snake3Hud, false, 'sans achat : pas de tableau de bord');
  // « kasparov » est le testeur nommé du serveur (FEATURE_TESTERS).
  const sidPack = await creerSession('kasparov');
  const avec = await (await fetch(BASE + '/api/features?sid=' + sidPack)).json();
  assert.strictEqual(avec.features.snake3Hud, true, JSON.stringify(avec));
});

// ── L'attribution des clips, prouvée par le bytecode ──────────────────────
//
// Obfu a renommé les exports du SWF : sept clés avaient été devinées à l'œil,
// et six étaient FAUSSES — le fond du menu montrait le creux du livre, la
// « sonnette » était la grimace beurk, le rideau de transition un masque de
// page. La preuve est dans le bytecode : la classe qui fait `attachMovie`
// pousse le nom (renommé) dans sa table de constantes. Ce test refait le
// croisement ConstantPool × ExportAssets et exige que le manifeste s'y tienne.

function clipsAttachesParClasse() {
  const zlib = require('zlib');
  const { ouvrir } = require('../scripts/lib/swf-sprites.js');
  const swf = ouvrir(path.join(RACINE, 'Games/snake3/snake3.swf'));
  const exports_ = new Map([...swf.noms]
    .filter(([n]) => !n.startsWith('__Packages'))
    .map(([n, i]) => [n, i]));
  const classes = new Map();
  for (const [nom, id] of swf.noms) {
    if (nom.startsWith('__Packages.')) classes.set(id, nom.slice('__Packages.'.length));
  }

  let b = fs.readFileSync(path.join(RACINE, 'Games/snake3/snake3.swf'));
  if (b.slice(0, 3).toString('latin1') === 'CWS') b = zlib.inflateSync(b.slice(8));
  const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;

  // Les chaînes des ConstantPool (action 0x88) d'une zone d'actions.
  const motsDuPool = (from, to) => {
    const mots = new Set();
    let p = from;
    while (p < to) {
      const op = b[p];
      if (op === 0) { p++; continue; }
      if (op < 0x80) { p++; continue; }
      const len = b.readUInt16LE(p + 1);
      if (op === 0x88) {
        const n = b.readUInt16LE(p + 3);
        let q = p + 5;
        for (let i = 0; i < n && q < p + 3 + len; i++) {
          let e = q; while (b[e] !== 0) e++;
          mots.add(b.slice(q, e).toString('latin1'));
          q = e + 1;
        }
      }
      p += 3 + len;
    }
    return mots;
  };

  const parClasse = new Map();
  let o = debut;
  while (o < b.length) {
    const hdr = b.readUInt16LE(o); const code = hdr >> 6;
    let len = hdr & 63, hs = 2;
    if (len === 63) { len = b.readUInt32LE(o + 2); hs = 6; }
    if (code === 0) break;
    if (code === 59) {                        // DoInitAction : le corps d'une classe
      const cls = classes.get(b.readUInt16LE(o + hs));
      if (cls) {
        const ids = new Set();
        for (const m of motsDuPool(o + hs + 2, o + hs + len)) {
          if (exports_.has(m)) ids.add(exports_.get(m));
        }
        parClasse.set(cls, ids);
      }
    }
    o += hs + len;
  }
  return parClasse;
}

test('chaque clé du manifeste tombe sur le clip que le bytecode attache', () => {
  const parClasse = clipsAttachesParClasse();
  const id = (cle) => manifeste.clips[cle] && manifeste.clips[cle].id;

  // Menu.as attache menuBackground, title, fleche et menu — et rien d'autre.
  const menu = parClasse.get('snake3.Menu');
  for (const cle of ['menuBackground', 'title', 'fleche', 'menu']) {
    assert.ok(menu.has(id(cle)), `Menu n'attache pas ${cle} (id ${id(cle)})`);
  }
  // MenuOptions attache menuBackground + optionPanel : le fond est donc bien
  // celui que les DEUX classes citent.
  const opts = parClasse.get('snake3.MenuOptions');
  assert.ok(opts.has(id('menuBackground')), 'MenuOptions n\'attache pas le même fond');
  assert.ok(opts.has(id('optionPanel')));
  // Et il est PLEIN ÉCRAN : c'est ce qui distinguait 602 de 376 à l'œil.
  const fond = manifeste.clips.menuBackground.frames[1].cadre;
  assert.ok(fond.w >= 700 && fond.h >= 480, 'le fond du menu ne couvre pas la scène : '
    + JSON.stringify(fond));

  // Encyclo.as attache page, bookBase, bookHole, bookMask, les deux ombres et
  // son conteneur — les trois rectangles unis se répartissent là, pas ailleurs.
  const ency = parClasse.get('snake3.Encyclo');
  for (const cle of ['page', 'bookBase', 'bookHole', 'bookMask', 'dropCorner', 'dropLarge']) {
    assert.ok(ency.has(id(cle)), `Encyclo n'attache pas ${cle} (id ${id(cle)})`);
  }
  assert.ok(!ency.has(id('menuBackground')), 'le fond du menu n\'a rien à faire dans le livre');

  // Transition.as attache le rideau, et lui seul.
  const trans = parClasse.get('snake3.Transition');
  assert.ok(trans.has(id('snakeMask')), 'le rideau de transition n\'est pas celui-là');

  // Popup.as attache beurk et les deux polices de points ; Sonnette la sonnette.
  const pop = parClasse.get('snake3.Popup');
  for (const cle of ['beurk', 'chiffresRouge', 'chiffresJaune']) {
    assert.ok(pop.has(id(cle)), `Popup n'attache pas ${cle} (id ${id(cle)})`);
  }
  assert.ok(parClasse.get('snake3.bonus.Sonnette').has(id('sonnette')),
    'la sonnette n\'est pas celle que Sonnette.as attache');

  // Les autres classes, pour boucler : trou et barreScore (Game), les jauges
  // (Battle), la langue et la bombe (leurs options), le terrain (Level).
  assert.ok(parClasse.get('snake3.Game').has(id('trou')));
  assert.ok(parClasse.get('snake3.Game').has(id('barreScore')));
  assert.ok(parClasse.get('snake3.Battle').has(id('barSide')));
  assert.ok(parClasse.get('snake3.Battle').has(id('barMid')));
  assert.ok(parClasse.get('snake3.bonus.Langue').has(id('langue')));
  assert.ok(parClasse.get('snake3.bonus.Bombe').has(id('bombe')));
  assert.ok(parClasse.get('snake3.Level').has(id('background')));
  assert.ok(parClasse.get('snake3.bonus.Slot').has(id('slot')));
});

test('les potions ont leur liquide (morph) et leur couleur (cxform)', () => {
  // Le liquide d'une fiole est un DefineMorphShape, sa couleur vient du cxform
  // ADDITIF de son placement : sans les deux, les neuf potions sortaient en
  // fioles vides et identiques.
  const POTIONS = [6, 9, 10, 11, 15, 20, 25, 26, 37];
  const couleurs = new Set();
  for (const f of POTIONS) {
    const fr = manifeste.clips.options.frames[f];
    assert.ok(fr, 'image d\'option manquante : ' + f);
    const svg = fs.readFileSync(path.join(SPRITES, fr.fichier), 'utf8');
    // Le filtre de couleur du placement (feComponentTransfer linéaire).
    const m = /<feFuncR type="linear" slope="([-\d.]+)" intercept="([-\d.]+)"\/><feFuncG type="linear" slope="[-\d.]+" intercept="([-\d.]+)"\/><feFuncB type="linear" slope="[-\d.]+" intercept="([-\d.]+)"/.exec(svg);
    assert.ok(m, 'pas de transformation de couleur sur la potion ' + f);
    couleurs.add([m[2], m[3], m[4]].join(','));
    // Et le liquide : au moins deux tracés (le verre, puis le morph).
    assert.ok((svg.match(/<path /g) || []).length >= 2, 'potion ' + f + ' sans liquide');
  }
  assert.strictEqual(couleurs.size, POTIONS.length,
    'deux potions partagent la même couleur : ' + [...couleurs].join(' | '));
});

test('les sous-clips continuent de jouer : ciseaux, potions, cases', () => {
  // En Flash un clip d'objet est FIGÉ sur l'image de son option (gotoAndStop)
  // mais les sous-clips posés dessus jouent leur propre boucle. Sans cela les
  // ciseaux restaient ouverts et le liquide des potions immobile.
  // Le cycle vient du SWF : les ciseaux 21 images, les fioles 15.
  const CYCLES = {
    options: { 1: 21, 2: 21, 3: 21, 6: 15, 9: 15, 10: 15, 11: 15, 15: 15,
      19: 6, 20: 15, 25: 15, 26: 15, 37: 15 },
    slot: { 3: 15, 5: 15, 6: 15, 7: 15, 9: 15, 10: 15, 11: 15, 12: 15, 13: 6, 14: 15 },
  };
  for (const [cle, attendus] of Object.entries(CYCLES)) {
    const frames = manifeste.clips[cle].frames;
    const animees = Object.entries(frames).filter(([, v]) => v.anim).map(([f]) => Number(f));
    assert.deepStrictEqual(animees.sort((a, b) => a - b),
      Object.keys(attendus).map(Number).sort((a, b) => a - b),
      `${cle} : ce ne sont pas les bonnes images qui s'animent`);
    for (const [f, n] of Object.entries(attendus)) {
      const suite = frames[f].anim;
      assert.strictEqual(suite.length, n, `${cle} image ${f} : cycle de ${suite.length} au lieu de ${n}`);
      // Chaque image de la suite existe et porte SON cadre — celui d'un ciseau
      // grand ouvert déborde celui d'un ciseau fermé, et le client dessine au
      // coin du cadre de l'image jouée, pas à celui de l'image figée.
      const fixe = frames[f].cadre;
      for (const a of suite) {
        assert.ok(fs.existsSync(path.join(SPRITES, a.fichier)), 'manque ' + a.fichier);
        assert.ok(a.cadre.w > 0 && a.cadre.h > 0, a.fichier + ' : cadre vide');
        assert.ok(a.cadre.x < fixe.x + fixe.w && a.cadre.x + a.cadre.w > fixe.x
          && a.cadre.y < fixe.y + fixe.h && a.cadre.y + a.cadre.h > fixe.y,
          a.fichier + ' : cadre hors de l\'objet — ' + JSON.stringify(a.cadre));
      }
      // …et la suite BOUGE : au moins deux contenus distincts.
      const vus = new Set(suite.map((a) => fs.readFileSync(path.join(SPRITES, a.fichier), 'utf8')));
      assert.ok(vus.size >= 2, `${cle} image ${f} : la suite ne bouge pas`);
    }
  }
});

test('les identifiants d\'un SVG composé ne se marchent pas dessus', () => {
  // Un dégradé s'appelle `g1` DANS SA FORME ; deux formes réunies dans le même
  // fichier les répétaient, et url(#g1) tombait alors sur la première — la
  // bombe de la case dynamite héritait du dégradé de sa case. Chaque forme
  // porte donc son rang en préfixe.
  let composes = 0;
  for (const clip of Object.values(manifeste.clips)) {
    for (const f of Object.values(clip.frames)) {
      for (const e of [f, ...(f.anim || [])]) {
        const svg = fs.readFileSync(path.join(SPRITES, e.fichier), 'utf8');
        const ids = (svg.match(/ id="([^"]+)"/g) || []).map((s) => s.slice(5, -1));
        if (ids.length < 2) continue;
        composes++;
        assert.strictEqual(new Set(ids).size, ids.length,
          e.fichier + ' : identifiants en double — ' + ids.join(' '));
        for (const u of (svg.match(/url\(#([^)]+)\)/g) || [])) {
          assert.ok(ids.includes(u.slice(5, -1)), e.fichier + ' : ' + u + ' ne pointe sur rien');
        }
      }
    }
  }
  assert.ok(composes > 100, 'trop peu de SVG composés vérifiés : ' + composes);
});

test('rendreAnim retombe sur l\'image figée tant que la suite n\'est pas décodée', () => {
  // Le client ne précharge pas les suites (deux mégaoctets pour des objets qui
  // ne sont pas tous posés) : il les décode au premier besoin et dessine
  // l'image figée en attendant, pour ne pas laisser de trou.
  const cle = 'options', frame = 6;
  const suite = manifeste.clips[cle].frames[frame].anim;
  const noms = [0, 1, 7, 14, 15, 29].map((t) => D.imageAnim(cle, frame, t).fichier);
  assert.deepStrictEqual(noms, [suite[0], suite[1], suite[7], suite[14], suite[0], suite[14]]
    .map((a) => a.fichier), 'la suite ne boucle pas modulo sa longueur');
  // Une image sans suite rend son fichier figé quel que soit le tick.
  const fige = manifeste.clips.fruits.frames[1];
  assert.strictEqual(D.imageAnim('fruits', 1, 9).fichier, fige.fichier);
});

test('la tête ne montre pas son point de collision', () => {
  // `col`, l'enfant que Snake.as rend invisible (col_mc._visible = false),
  // laissait un rectangle blanc sur le museau du serpent. Il ne doit pas être
  // dessiné — mais sa MESURE, elle, sert au moteur (le point de collision).
  const { ouvrir } = require('../scripts/lib/swf-sprites.js');
  const swf = ouvrir(path.join(RACINE, 'Games/snake3/snake3.swf'));
  const tous = swf.aplatir(661, swf.IDENTITE, 0, 1, '', null);
  const sansCol = tous.filter((m) => !(m.chemin || '').includes('col'));
  assert.ok(sansCol.length < tous.length, 'le SWF a bien un `col` dans la tête');

  // Le SVG de chaque image de la tête compte exactement les morceaux HORS col.
  for (const [f, fr] of Object.entries(manifeste.clips.tete.frames)) {
    const svg = fs.readFileSync(path.join(SPRITES, fr.fichier), 'utf8');
    const groupes = (svg.match(/<g transform=/g) || []).length;
    const attendus = swf.aplatir(661, swf.IDENTITE, 0, Number(f), '', null)
      .filter((m) => !(m.chemin || '').includes('col')).length;
    assert.strictEqual(groupes, attendus,
      `tête image ${f} : ${groupes} tracés pour ${attendus} morceaux hors col`);
  }
  // La mesure du col, elle, reste au manifeste — le moteur en a besoin.
  assert.ok(manifeste.cadres.col && manifeste.cadres.col.w > 0, 'la mesure du col reste');
});

test('l\'écran de pause couvre la scène depuis son coin', () => {
  // Game.as attache `screens` SANS le poser : le voile de l'image « pause »
  // est dessiné en (0,0) et couvre déjà les 700×480. Le centrer le décalait
  // d'un demi-écran (le joueur voyait un rectangle en bas à droite).
  const c = manifeste.clips.screens.frames[1].cadre;
  assert.strictEqual(c.x, 0);
  assert.strictEqual(c.y, 0);
  assert.ok(c.w >= 700 && c.h >= 480, 'le voile ne couvre pas la scène : ' + JSON.stringify(c));
  const src = fs.readFileSync(path.join(RACINE, 'public/snake3/game.js'), 'utf8');
  assert.ok(/'screens', ECRANS\.pause, 0, 0/.test(src),
    'la pause doit se poser en (0,0), comme le SWF');
});

// ── Les commandes du client, dans un bac à sable ───────────────────────────
//
// game.js s'exécute dans un navigateur ; on lui en fabrique un minuscule (un
// `window`, un `document` qui rend des canvas muets) pour éprouver ses
// COMMANDES sans rien dessiner. C'est ainsi qu'on vérifie qu'un appui du doigt
// sur l'aire de jeu vaut une pression d'ESPACE — la façon d'utiliser l'option
// quand on joue au pouce.
function bacASable() {
  const vm = require('vm');
  const contexte = {
    console, Math, JSON, Object, Array, String, Number, Boolean, Date, Set, Map,
    Promise, performance, isNaN, parseInt, parseFloat, Error, URLSearchParams,
    requestAnimationFrame: () => 0, setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('hors ligne')),
  };
  const faireCanvas = () => ({
    width: 700, height: 480, style: {},
    parentElement: { clientWidth: 700, clientHeight: 480 },
    getContext: () => new Proxy({}, {
      get: (c, n) => (n === 'canvas' ? faireCanvas()
        : (typeof n === 'string' ? () => {} : undefined)),
      set: () => true,
    }),
    addEventListener: (nom, f) => { (contexte.window.__ecoute[nom] = contexte.window.__ecoute[nom] || []).push(f); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 700, height: 480 }),
  });
  contexte.window = contexte;
  contexte.window.__ecoute = {};
  contexte.devicePixelRatio = 1;
  contexte.location = { search: '' };
  contexte.document = {
    createElement: () => faireCanvas(),
    getElementById: () => faireCanvas(),
  };
  contexte.addEventListener = () => {};
  vm.createContext(contexte);
  for (const f of ['const.js', 'serpent.js', 'niveau.js', 'bonus.js', 'partie.js',
    'bataille.js', 'dessin.js', 'rendu.js', 'menu.js', 'encyclo.js', 'pack.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(RACINE, 'public/snake3', f), 'utf8'), contexte, { filename: f });
  }
  contexte.SnakeDessin.poserManifeste(manifeste);
  return contexte;
}

test('un appui sur l\'aire de jeu vaut une pression d\'ESPACE (jouer au pouce)', () => {
  const w = bacASable();
  const plateforme = { fruits: {}, record: 0, prefs: { $music: true, $sounds: true, $keys: null },
    sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null),
    sauverPrefs: () => Promise.resolve(true) };
  const sons = new Proxy({}, { get: () => () => false });
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'), plateforme, sons);

  // Au repos, ESPACE n'est pas pressé.
  assert.strictEqual(jeu.entreesPartie().espace, false);

  // Une VuePartie, et un appui dessus.
  const vue = new w.SnakeJeu.VuePartie(jeu);
  jeu.mode = vue;
  vue.presser(350, 240);
  assert.strictEqual(jeu.entreesPartie().espace, true, 'l\'appui vaut ESPACE');

  // L'appui RETOMBE : partie.js a le même anti-rebond que le SWF
  // (space_flag), il faut donc que la touche soit vue relâchée ensuite.
  jeu.tapOption = 0;
  assert.strictEqual(jeu.entreesPartie().espace, false, 'et il se relâche');

  // Et il utilise réellement l'option active : les ciseaux quittent la rangée.
  // On passe par vue.main(), qui recopie les commandes dans le moteur avant de
  // l'avancer — c'est ce que fait la boucle du jeu à chaque image.
  const B = w.SnakeBonus;
  vue.partie.add_slot(new B.Ciseaux(vue.partie, 1));
  const avant = vue.partie.slots.length;
  vue.presser(350, 240);
  vue.main(1, 1 / 32);
  assert.ok(vue.partie.slots.length < avant, 'l\'option a été utilisée');
});

// ── Le pack de Frutisnake (tableau de bord) ───────────────────────────────

test('le relevé du pack donne les cinq mêmes valeurs que le pont du SWF', () => {
  // scripts/patch-snake3-hud.js remonte du SWF : snake.len, Pile.counter,
  // slots.length, slots[dernier].time, le compteur de fruits et la pause. Ici
  // le moteur est en JS : Jeu.releve() les lit directement, et doit donner la
  // même chose — en particulier le DERNIER slot pour la minuterie, puisque
  // add_slot empile les options activables par la tête et les temporisées par
  // la queue.
  const w = bacASable();
  const plateforme = { fruits: {}, record: 0, options: { snake3Hud: true },
    prefs: { $music: true, $sounds: true, $keys: null },
    sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null) };
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'), plateforme,
    new Proxy({}, { get: () => () => false }));
  assert.strictEqual(jeu.releve(), null, 'hors partie : rien à relever');

  const vue = new w.SnakeJeu.VuePartie(jeu);
  jeu.mode = vue;
  const B = w.SnakeBonus;
  const p = vue.partie;

  // Un ciseau (activable, empilé par la TÊTE) puis une potion rouge
  // (temporisée, empilée par la QUEUE) : c'est la potion qui donne la durée.
  p.add_slot(new B.Ciseaux(p, 1));
  p.add_slot(new B.PotionRouge(p, 6));
  B.Pile.counter = 2;
  p.nbFruits = 7;
  const r = jeu.releve();
  assert.strictEqual(r.longueur, p.serpent.len);
  assert.strictEqual(r.fruits, 7);
  assert.strictEqual(r.dynamites, 2);
  assert.ok(r.bonus > 0, 'la potion donne une durée : ' + r.bonus);
  assert.strictEqual(r.bonus, p.slots[p.slots.length - 1].time);
  assert.strictEqual(r.pause, false);

  // Un ciseau seul n'a pas de minuterie — le tableau affiche alors 00:00.
  const seul = new w.SnakeJeu.VuePartie(jeu);
  jeu.mode = seul;
  seul.partie.add_slot(new B.Ciseaux(seul.partie, 1));
  assert.strictEqual(jeu.releve().bonus, 0, 'un ciseau n\'a pas de durée');
});

test('le chronomètre du pack ne compte ni la pause ni l\'après-mort', () => {
  const w = bacASable();
  const plateforme = { fruits: {}, record: 0, options: {},
    prefs: { $music: true, $sounds: true, $keys: null },
    sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null) };
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'), plateforme,
    new Proxy({}, { get: () => () => false }));
  const vue = new w.SnakeJeu.VuePartie(jeu);
  jeu.mode = vue;

  for (let i = 0; i < 32; i++) vue.main(1, 1 / 32);
  const apresUneSeconde = vue.chrono;
  assert.ok(Math.abs(apresUneSeconde - 1) < 1e-9, 'une seconde de jeu : ' + apresUneSeconde);

  vue.partie.pause = true;
  for (let i = 0; i < 32; i++) vue.main(1, 1 / 32);
  assert.strictEqual(vue.chrono, apresUneSeconde, 'la pause ne compte pas');

  vue.partie.pause = false;
  vue.partie.game_over_flag = true;
  for (let i = 0; i < 32; i++) vue.main(1, 1 / 32);
  assert.strictEqual(vue.chrono, apresUneSeconde, 'l\'après-mort ne compte pas');
});

test('le compteur de fruits passe par eat_fruit, la seule porte', () => {
  // Le même endroit que le `__nf` injecté dans le SWF : quelle que soit la
  // cause (contact, Langue, Potion noire), un fruit avalé passe par là.
  const w = bacASable();
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'),
    { fruits: {}, record: 0, options: {}, prefs: { $music: true, $sounds: true, $keys: null },
      sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null) },
    new Proxy({}, { get: () => () => false }));
  const partie = new w.SnakeJeu.VuePartie(jeu).partie;
  assert.strictEqual(partie.nbFruits, 0);
  partie.eat_fruit(partie.niveau.generate_fruit(1));
  assert.strictEqual(partie.nbFruits, 1);
  partie.eat_fruit(partie.niveau.generate_fruit(2));
  assert.strictEqual(partie.nbFruits, 2);
  const src = fs.readFileSync(path.join(RACINE, 'public/snake3/partie.js'), 'utf8');
  assert.ok(/eat_fruit\(f\) \{\s*this\.nbFruits\+\+;/.test(src),
    'le compteur doit être en tête d\'eat_fruit');
});

test('le tableau de bord reprend les cinq lignes et la mise en forme du disque', () => {
  const K = require('../public/snake3/pack.js');
  assert.deepStrictEqual(K.LIGNES.map((l) => l.titre),
    ['Longueur', 'Fruits avalés', 'Dynamites', 'Durée bonus en cours', 'Durée de la partie']);
  // Les mêmes intitulés que le disque Flash (game-popup.html).
  const popup = fs.readFileSync(path.join(RACINE, 'public/game-popup.html'), 'utf8');
  for (const l of K.LIGNES) {
    const echappe = l.titre.replace(/é/g, '\\u00e9');
    assert.ok(popup.includes('"' + echappe + '"') || popup.includes('"' + l.titre + '"'),
      'intitulé absent du disque : ' + l.titre);
  }
  assert.strictEqual(K.mmss(0), '00:00');
  assert.strictEqual(K.mmss(9), '00:09');
  assert.strictEqual(K.mmss(75), '01:15');
  assert.strictEqual(K.mmss(-3), '00:00');
  assert.strictEqual(K.mmss(3600 + 61), '61:01', 'au-delà de l\'heure, on compte en minutes');

  // Les chiffres sont tracés à la police Alba du portail, remplis du dégradé
  // et contournés de blanc — comme sur le disque.
  const alba = JSON.parse(fs.readFileSync(path.join(RACINE, 'public/fb/alba-glyphs.json'), 'utf8'));
  const svg = K.tracerNombre('01:23', alba);
  assert.strictEqual((svg.match(/<path /g) || []).length, 5, 'un tracé par caractère');
  assert.ok(svg.includes('preserveAspectRatio="xMaxYMid meet"'), 'aligné à droite');
  // Sans les glyphes : du texte, pas un trou.
  assert.ok(/pk-repli/.test(K.tracerNombre('12', null)));

  const html = fs.readFileSync(path.join(RACINE, 'public/snake3/index.html'), 'utf8');
  assert.ok(html.includes('#83CA22'), 'le vert du panneau du disque');
  assert.ok(/url\(#pk-alba\)/.test(html) && /paint-order: stroke fill/.test(html),
    'dégradé et contour des chiffres');
  assert.ok(html.includes('src="/snake3/pack.js"'), 'pack.js est chargé');
});

test('le pack ne se monte que pour qui l\'a acheté', () => {
  const K = require('../public/snake3/pack.js');
  const faux = { plateforme: { options: {} }, releve: () => null, surImage: null };
  const hote = { innerHTML: '', classList: { add() {} }, querySelectorAll: () => [] };
  return K.monter(faux, hote).then((r) => {
    assert.strictEqual(r, null, 'sans l\'article, pas de tableau de bord');
    assert.strictEqual(faux.surImage, null, 'et rien à faire à chaque image');
    assert.strictEqual(hote.innerHTML, '', 'l\'hôte reste vide (donc sans place occupée)');
  });
});

test('la page se replie selon l\'orientation, sans forcer le paysage', () => {
  // La scène est un 700×480 : en paysage le jeu est bridé par la HAUTEUR (les
  // commandes passent donc sur les côtés et le tableau de bord se glisse dans
  // le vide qui reste), en portrait par la LARGEUR (tout se range dessous).
  const html = fs.readFileSync(path.join(RACINE, 'public/snake3/index.html'), 'utf8');
  assert.ok(/@media \(orientation: landscape\) \{[\s\S]*?#tout \{ flex-direction: row;/.test(html),
    'en paysage, la page passe en rangée');
  assert.ok(/@media \(orientation: landscape\) and \(pointer: coarse\) \{ #commandes \{ display: contents/.test(html),
    'les deux côtés de la manette deviennent des colonnes de #tout');
  assert.ok(/@media \(orientation: landscape\) and \(max-width: 759px\)[\s\S]{0,80}#pack\.pk-actif \{ display: none/.test(html),
    'un paysage court replie la colonne du tableau de bord');
  // Aucune tentative de VERROUILLER l'orientation : impossible sur iOS, et
  // hors de portée depuis le cadre de /light.
  assert.ok(!/orientation\s*\.\s*lock\s*\(|lockOrientation\s*\(/.test(html.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, '')),
    'on ne force pas le paysage');
  assert.ok(/#tourne/.test(html) && /localStorage[\s\S]{0,60}snake3\.tourne/.test(html),
    'le conseil de tourner ne s\'affiche qu\'une fois');
  // Les boutons se serrent : à largeur fixe, un téléphone de 390 points en
  // poussait deux hors de l'écran.
  assert.ok(/\.btn \{[\s\S]*?flex: 0 1 72px; min-width: 42px;/.test(html),
    'les touches doivent pouvoir rétrécir');
});

test('un appui sur un écran le fait avancer, sans utiliser d\'option', () => {
  const w = bacASable();
  const plateforme = { fruits: {}, record: 0, prefs: { $music: true, $sounds: true, $keys: null },
    sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null) };
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'), plateforme,
    new Proxy({}, { get: () => () => false }));
  const vue = new w.SnakeJeu.VuePartie(jeu);
  jeu.mode = vue;
  let suivant = 0;
  vue.ecran = new w.SnakeJeu.Ecran(jeu, 'gameOver', 'Votre score : 12');
  vue.ecran.poserPresse(() => { suivant++; });
  vue.presser(350, 240);
  assert.strictEqual(suivant, 1, 'l\'écran a pris l\'appui');
  assert.strictEqual(jeu.entreesPartie().espace, false, 'et l\'option n\'a pas été consommée');
});
