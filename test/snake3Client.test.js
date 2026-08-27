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

test('les clips de l\'ARÈNE sont préchargés (sinon le premier effet est perdu)', () => {
  // Une image n'est chargée qu'au premier appel à rendreFichier, qui renvoie
  // null en attendant : le tout premier effet d'un clip non préchargé ne se
  // peint PAS. C'est ce qui rendait la première dynamite d'une partie
  // invisible (les débris `qparticule` ne durent que dix images) — et « ça
  // marchait ensuite », l'image étant alors en cache.
  const src = fs.readFileSync(path.join(RACINE, 'public/snake3/game.js'), 'utf8');
  const bloc = /D\.precharger\(\[([\s\S]*?)\]\)/.exec(src);
  assert.ok(bloc, 'la liste de préchargement est là');
  const preches = new Set((bloc[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
  for (const cle of ['qparticule', 'bombe', 'sonnette', 'langue', 'trou', 'beurk',
    'snakeMask', 'barSide', 'barMid', 'fbarre', 'tete', 'fruits', 'options', 'slot']) {
    assert.ok(preches.has(cle), 'clip d\'arène non préchargé : ' + cle);
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
    // Le jeu écoute `visibilitychange` pour lâcher ses commandes quand la page
    // passe au second plan (cf. test/jeuCommandesRelachees.test.js) : le bac à
    // sable doit offrir ce que tout document offre.
    addEventListener: () => {},
    removeEventListener: () => {},
    hidden: false,
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

// ── L'assistant de bombe (pack de Frutisnake) ─────────────────────────────
//
// Il ne doit PAS pouvoir mentir : ce qu'il annonce et ce que la bombe fait
// sortent de la même fonction, et le test le vérifie en faisant réellement
// exploser la bombe.
function serpentPose(w, n) {
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'),
    { fruits: {}, record: 0, options: { snake3Hud: true },
      prefs: { $music: true, $sounds: true, $keys: null },
      sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null) },
    new Proxy({}, { get: () => () => false }));
  const vue = new w.SnakeJeu.VuePartie(jeu);
  jeu.mode = vue;
  const s = vue.partie.serpent;
  // Une queue écrite à la main : un point tous les 5 px de route, un segment
  // tous les 5 points — la géométrie de Snake.move.
  const pts = [];
  for (let i = 0; i < n * 5 + 12; i++) pts.push({ x: 40 + i * 5, y: 240 });
  s.queue = pts;
  s.len = n;
  s.x = pts[pts.length - 1].x;
  s.y = pts[pts.length - 1].y;
  return { jeu, vue, s, pts };
}

test('l\'assistant de bombe annonce EXACTEMENT ce que la bombe fera', () => {
  const w = bacASable();
  const R = w.SnakeRendu;
  const B = w.SnakeBonus;
  const C = w.SnakeConst;

  // Le serpent est droit : le segment i (depuis la tête) est à 25·i pixels
  // derrière elle. Une bombe posée sur le segment 8 doit donc couper là.
  for (const cible of [3, 8, 14]) {
    const { vue, s, pts } = serpentPose(w, 20);
    const p = pts[pts.length - cible * 5 - 3];
    const annonce = R.dangerBombe(s, p.x, p.y);
    assert.strictEqual(annonce.coupe, B.coupureBombe(s, p.x, p.y));

    // …et la bombe coupe bien là où l'assistant l'annonçait.
    const bombe = new B.Bombe(vue.partie);
    bombe.x = p.x; bombe.y = p.y;
    const avant = s.len;
    bombe.explose();
    assert.strictEqual(s.len, annonce.coupe,
      `bombe sur le segment ${cible} : ${avant} → ${s.len}, annoncé ${annonce.coupe}`);
  }

  // Le rayon dessiné est celui du bytecode (Bombe.as : `d < 160*160`).
  const as = fs.readFileSync(path.join(RACINE, 'Games/snake3/bonus/Bombe.as'), 'utf8');
  assert.ok(as.includes('d < ' + C.RAYON_BOMBE + '*' + C.RAYON_BOMBE),
    'C.RAYON_BOMBE doit être le rayon du SWF');
});

test('les trois états de l\'assistant : sûr, la queue, la mort', () => {
  const w = bacASable();
  const R = w.SnakeRendu;
  const C = w.SnakeConst;
  const { s } = serpentPose(w, 20);

  // Loin derrière : rien n'entre dans le cercle.
  const loin = R.dangerBombe(s, s.x - 20 * 25 - C.RAYON_BOMBE * 2, 240);
  assert.strictEqual(loin.niveau, 0);
  assert.strictEqual(loin.coupe, s.len, 'aucun segment touché : pas de coupe');

  // À mi-corps : la queue y passe, la tête non.
  const milieu = R.dangerBombe(s, s.x - 250, 240);
  assert.strictEqual(milieu.niveau, 1);
  assert.ok(milieu.coupe > 1 && milieu.coupe < s.len, 'coupe ' + milieu.coupe);

  // Sous la tête : c'est la mort — Bombe.explose appelle game_over sous 2.
  const sousLaTete = R.dangerBombe(s, s.x, s.y);
  assert.strictEqual(sousLaTete.coupe, 1);
  assert.strictEqual(sousLaTete.niveau, 2);
});

test('l\'assistant ne se dessine que pour qui a le pack', () => {
  const src = fs.readFileSync(path.join(RACINE, 'public/snake3/game.js'), 'utf8');
  assert.ok(/if \(jeu\.pack\) R\.dessinerZoneBombe/.test(src),
    'l\'empreinte au sol est réservée au pack');
  assert.ok(/if \(jeu\.pack\) R\.dessinerQueueCondamnee/.test(src),
    'le halo de la queue aussi');
  // L'empreinte se pose AVANT le serpent (c'est une marque au sol), le halo
  // JUSTE avant lui (c'est une lueur qui déborde de son tracé).
  const iZone = src.indexOf('dessinerZoneBombe');
  const iHalo = src.indexOf('dessinerQueueCondamnee');
  const iSerpent = src.indexOf('R.dessinerSerpent(ctx, partie.serpent');
  assert.ok(iZone < iHalo && iHalo < iSerpent, 'ordre des plans');
  // La mèche dessinée est celle du moteur : même départ, même décompte.
  assert.ok(/meche: C\.TIME_BOMBE/.test(src) && /b\.meche -= deltaT;/.test(src),
    'le compte à rebours doit suivre celui de Bombe.use');
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

// ── La sonnette : une cloche PENDUE à la queue, pas un effet fugace ───────
test('la sonnette pend au bout de la queue, orientée, et sonne à l\'espace', () => {
  // Sonnette.as attache le clip `sonnette` à la prise, le replace et
  // l'oriente à CHAQUE image, et le retire à la fermeture : la cloche est
  // visible en permanence. Le portage ne peignait qu'un anneau de 0,6 s au
  // coup de cloche — la sonnette ne se voyait donc jamais sur le serpent.
  const w = bacASable();
  const { vue, s } = serpentPose(w, 6);
  const partie = vue.partie;
  assert.strictEqual(partie.sonnetteMc, null, 'aucune cloche sans sonnette');

  partie.get_bonus({ id: 31, x: 200, y: 200 });
  const mc = partie.sonnetteMc;
  assert.ok(mc, 'la prise attache la cloche');

  // Une image de jeu : la cloche se pose sur le DERNIER point de la queue et
  // s'oriente le long de la queue (Math.atan2(p1.y-p2.y, p1.x-p2.x)).
  partie.entree = { gauche: false, droite: false, haut: false, bas: false, espace: false, echap: false };
  for (const u of partie.unique_slots) u.permanent(1, 1 / 32);
  const q = s.end_queue_pos(0);
  assert.strictEqual(Math.round(mc.x), Math.round(q.x));
  assert.strictEqual(Math.round(mc.y), Math.round(q.y));
  // La queue posée par serpentPose file plein est : l'angle vaut π (la cloche
  // regarde vers l'arrière). En radians — c'est ce qu'attend le rendu, quand
  // Flash écrivait le même angle en degrés dans _rotation.
  assert.ok(Math.abs(Math.abs(mc.ang) - Math.PI) < 1e-6, 'orientée le long de la queue : ' + mc.ang);
  assert.strictEqual(mc.frame, 1, 'au repos, image 1');

  // ESPACE : le coup de cloche passe à l'image 2 (le clip y superpose son
  // fantôme à 50 %) et y reste le temps du coup.
  partie.entree.espace = true;
  for (const u of partie.unique_slots) u.permanent(1, 1 / 32);
  assert.strictEqual(mc.frame, 2, 'pendant le coup, image 2');
  partie.entree.espace = false;
  for (let i = 0; i < 20; i++) for (const u of partie.unique_slots) u.permanent(1, 1 / 32);
  assert.strictEqual(mc.frame, 1, 'le coup passé, retour à l\'image 1');

  // Et la vue la dessine depuis le moteur, pas depuis une liste d'effets.
  const src = fs.readFileSync(path.join(RACINE, 'public/snake3/game.js'), 'utf8');
  assert.ok(/partie\.sonnetteMc/.test(src), 'la vue lit la cloche du moteur');
  assert.ok(!/this\.sonnettes/.test(src), 'plus de liste d\'anneaux fugaces');
});

test('une partie ne poste qu\'UN score, même si finPartie revient', () => {
  const w = bacASable();
  const envois = [];
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'),
    { fruits: {}, record: 0, options: {}, prefs: { $music: true, $sounds: true, $keys: null },
      sauverSlot0: () => Promise.resolve(true),
      sauverScore: (s) => { envois.push(s); return Promise.resolve(null); } },
    new Proxy({}, { get: () => () => false }));
  const vue = new w.SnakeJeu.VuePartie(jeu);
  jeu.mode = vue;
  vue.finDePartie(1200);
  vue.finDePartie(30);
  assert.deepStrictEqual(envois, [1200], 'le second appel ne repart pas au serveur');
});

test('le tableau de bord reprend les cinq lignes et les couleurs du disque', () => {
  const K = require('../public/snake3/pack.js');
  assert.deepStrictEqual(K.LIGNES.map((l) => l.titre),
    ['Longueur', 'Fruits avalés', 'Dynamites', 'Durée bonus en cours', 'Vitesse']);
  // Quatre viennent du disque Flash (game-popup.html) ; la cinquième, la
  // vitesse, remplace sa « durée de la partie » — Frutisnake n'a pas de
  // chronomètre à battre, alors que l'allure du serpent se joue.
  const popup = fs.readFileSync(path.join(RACINE, 'public/game-popup.html'), 'utf8');
  for (const l of K.LIGNES.slice(0, 4)) {
    const echappe = l.titre.replace(/é/g, '\\u00e9');
    assert.ok(popup.includes('"' + echappe + '"') || popup.includes('"' + l.titre + '"'),
      'intitulé absent du disque : ' + l.titre);
  }
  assert.strictEqual(K.mmss(0), '00:00');
  assert.strictEqual(K.mmss(9), '00:09');
  assert.strictEqual(K.mmss(75), '01:15');
  assert.strictEqual(K.mmss(-3), '00:00');
  assert.strictEqual(K.mmss(3600 + 61), '61:01', 'au-delà de l\'heure, on compte en minutes');

  // Hors partie : cinq zéros, jamais un panneau vide (sa place est prise dans
  // la scène une fois pour toutes).
  assert.deepStrictEqual(K.valeurs(null),
    { longueur: '0', fruits: '0', dynamites: '0', bonus: '00:00', vitesse: '100' });
  assert.deepStrictEqual(
    K.valeurs({ longueur: 7, fruits: 12, dynamites: 3, bonus: 29.2, vitesse: 214 }),
    { longueur: '7', fruits: '12', dynamites: '3', bonus: '00:30', vitesse: '214' },
    'la durée d\'un bonus s\'arrondit au-dessus : 29,2 s restantes = 30 s affichées');

  // Le panneau se peint DANS le canvas, en prolongement du cadre du jeu : son
  // vert doit être celui du décor, pas une approximation. Le décor du SWF est
  // un simple aplat cerné de deux points de blanc — c'est ce qui permet de le
  // prolonger sans rien déformer.
  const bord = fs.readFileSync(path.join(SPRITES, 'backgroundBord.svg'), 'utf8');
  assert.ok(bord.includes('fill="' + K.VERT + '"'),
    'le vert du panneau (' + K.VERT + ') n\'est pas celui de backgroundBord.svg');
  assert.strictEqual((bord.match(/<path /g) || []).length, 2,
    'le décor doit rester deux tracés : l\'aplat et son liseré');
  assert.ok(bord.includes('M2 2') || bord.includes('L2 2'),
    'le liseré fait bien ' + K.LISERE + ' points');

  const html = fs.readFileSync(path.join(RACINE, 'public/snake3/index.html'), 'utf8');
  assert.ok(html.includes('src="/snake3/pack.js"'), 'pack.js est chargé');
});

test('le panneau s\'ajoute du côté où le jeu ne se sert de rien', () => {
  const K = require('../public/snake3/pack.js');
  const C = require('../public/snake3/const.js');
  const pack = new K.Pack();

  // PAYSAGE : le jeu est bridé par la hauteur → une colonne à droite, à
  // taille fixe, et pas un point de hauteur en plus.
  pack.poserSens(true);
  const p = pack.scene(852, 393);
  assert.strictEqual(p.h, C.HEIGHT, 'la colonne ne doit rien coûter en hauteur');
  assert.strictEqual(p.w, C.WIDTH + K.L_COLONNE - K.LISERE, 'la colonne chevauche le liseré');

  // PORTRAIT : le jeu est bridé par la largeur → le bandeau prend la hauteur
  // laissée libre, entre son minimum lisible et son maximum.
  pack.poserSens(false);
  const serre = pack.scene(393, 300);       // presque pas de place
  assert.strictEqual(serre.w, C.WIDTH, 'le bandeau ne doit rien coûter en largeur');
  assert.strictEqual(serre.h, C.HEIGHT + K.H_MIN - K.LISERE, 'plancher du bandeau');
  const large = pack.scene(393, 3000);      // beaucoup trop de place
  assert.strictEqual(large.h, C.HEIGHT + K.H_MAX - K.LISERE, 'plafond du bandeau');
  assert.ok(K.H_MAX < C.HEIGHT / 2,
    'le bandeau doit rester bien plus petit que le jeu (' + K.H_MAX + ')');
  // Entre les deux, il colle à la place offerte : la scène remplit l'aire.
  const juste = pack.scene(393, 393 / C.WIDTH * (C.HEIGHT + 200));
  assert.ok(Math.abs(juste.h - (C.HEIGHT + 200 - K.LISERE)) < 1,
    'le bandeau doit épouser la hauteur libre : ' + juste.h);
});

test('le pack ne se monte que pour qui l\'a acheté', async () => {
  const K = require('../public/snake3/pack.js');
  const sans = { plateforme: { options: {} }, pack: null, redimensionner() { this.redim = true; } };
  assert.strictEqual(await K.monter(sans), null, 'sans l\'article, pas de tableau de bord');
  assert.strictEqual(sans.pack, null, 'et rien à peindre à chaque image');
  assert.ok(!sans.redim, 'la scène n\'a pas bougé');

  const avec = { plateforme: { options: { snake3Hud: true } }, pack: null,
    redimensionner() { this.redim = true; } };
  const pack = await K.monter(avec);
  assert.ok(pack instanceof K.Pack);
  assert.strictEqual(avec.pack, pack, 'le jeu peint désormais le panneau');
  assert.ok(avec.redim, 'la scène s\'est agrandie tout de suite');
});

test('la page se replie selon l\'orientation, sans forcer le paysage', () => {
  // La scène est un 700×480 : en paysage le jeu est bridé par la HAUTEUR (les
  // commandes passent donc sur les côtés), en portrait par la LARGEUR (elles
  // se rangent en ligne dessous).
  const html = fs.readFileSync(path.join(RACINE, 'public/snake3/index.html'), 'utf8');
  assert.ok(/@media \(orientation: landscape\) \{[\s\S]*?#tout \{ flex-direction: row;/.test(html),
    'en paysage, la page passe en rangée');
  assert.ok(/@media \(orientation: landscape\) and \(pointer: coarse\) \{ #commandes \{ display: contents/.test(html),
    'les deux côtés de la manette deviennent des colonnes de #tout');
  // Les parts 3/2 du portrait sont posées par identifiant : sans les reprendre
  // par identifiant en paysage, une classe ne les emporte pas et la manette
  // droite sortait de l'écran.
  assert.ok(/@media \(orientation: landscape\)[\s\S]*?#cote-droit \{ order: 9; flex: 0 0 auto;/.test(html),
    'les côtés doivent reprendre leur taille naturelle en paysage');
  // Et #aire ne doit pas se caler sur le canvas : le jeu calcule la taille du
  // canvas D'APRÈS #aire, les deux se pousseraient l'un l'autre.
  assert.ok(/#aire \{\s*flex: 1 1 0;/.test(html), '#aire prend ce qui reste, base 0');
  // Aucune tentative de VERROUILLER l'orientation : impossible sur iOS, et
  // hors de portée depuis le cadre de /light.
  assert.ok(!/orientation\s*\.\s*lock\s*\(|lockOrientation\s*\(/.test(html.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, '')),
    'on ne force pas le paysage');
  assert.ok(/#tourne/.test(html) && /localStorage[\s\S]{0,60}snake3\.tourne/.test(html),
    'le conseil de tourner ne s\'affiche qu\'une fois');
});

test('la manette : cinq touches, aux couleurs du jeu, sans bouton « option »', () => {
  const html = fs.readFileSync(path.join(RACINE, 'public/snake3/index.html'), 'utf8');
  const touches = [...html.matchAll(/data-touche="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(touches, ['gauche', 'droite', 'haut', 'bas', 'echap'],
    'le turbo (haut) rejoint les virages, et « option » a disparu');
  // « option » faisait double emploi : un appui sur l'aire de jeu l'utilise.
  const jeuSrc = fs.readFileSync(path.join(RACINE, 'public/snake3/game.js'), 'utf8');
  assert.ok(/impulsionOption\(\);/.test(jeuSrc));
  // Les touches reprennent le décor du jeu : l'aplat du cadre, cerné de blanc.
  const K = require('../public/snake3/pack.js');
  assert.ok(new RegExp('background: ' + K.VERT + ';').test(html),
    'les touches doivent porter le vert du décor');
  assert.ok(/border: 3px solid #fff/.test(html), 'et son liseré blanc');
});

test('un appui hors du cadre du jeu n\'utilise pas l\'option', () => {
  // Le tableau de bord du pack est DANS le canvas, mais hors des 700×480 du
  // jeu : y poser le doigt ne doit rien déclencher.
  const w = bacASable();
  const C = w.SnakeConst;
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'),
    { fruits: {}, record: 0, options: {}, prefs: { $music: true, $sounds: true, $keys: null },
      sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null) },
    new Proxy({}, { get: () => () => false }));
  const vue = new w.SnakeJeu.VuePartie(jeu);
  jeu.mode = vue;
  vue.presser(350, C.HEIGHT + 40);
  assert.strictEqual(jeu.entreesPartie().espace, false, 'sous le jeu : rien');
  vue.presser(C.WIDTH + 40, 200);
  assert.strictEqual(jeu.entreesPartie().espace, false, 'à droite du jeu : rien');
  vue.presser(350, 240);
  assert.strictEqual(jeu.entreesPartie().espace, true, 'dans le jeu : l\'option');
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

// ── La cadence du lecteur et le décor de scène ────────────────────────────

test('la cadence du jeu est celle de l\'en-tête du SWF, pas celle de l\'écran', () => {
  const { lireSwf } = require('../scripts/lib/swf-sprites.js');
  const b = lireSwf(path.join(RACINE, 'Games/snake3/snake3.swf'));
  // L'en-tête : le RECT de la scène, puis FrameRate en 8.8, puis FrameCount.
  const finRect = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8);
  const cadence = b.readUInt16LE(finRect) / 256;
  const C = require('../public/snake3/const.js');
  assert.strictEqual(C.SWF_FPS, cadence, 'le pas du jeu doit être celui du lecteur');

  // Et la boucle doit s'y tenir quel que soit le rafraîchissement : tout ce que
  // le jeu fait UNE FOIS PAR IMAGE sans passer par tmod (le titre qui respire,
  // le carrousel, la flèche bleue) en dépend directement.
  const compter = (hz, secondes) => {
    const w = bacASable();
    const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'),
      { fruits: {}, record: 0, options: {}, prefs: { $music: true, $sounds: true, $keys: null },
        sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null) },
      new Proxy({}, { get: () => () => false }));
    let t = 0;
    const file = [];
    w.performance = { now: () => t };
    w.requestAnimationFrame = (f) => { file.push(f); return 0; };
    jeu.demarrer();
    let pas = 0;
    const brut = jeu.mode.main.bind(jeu.mode);
    jeu.mode.main = (tmod, dt) => { pas++; return brut(tmod, dt); };
    for (let i = 0; i < hz * secondes; i++) {
      t += 1000 / hz;
      const f = file.shift();
      if (f) f(t);
    }
    return { pas, tmod: jeu.tmod, echelle: jeu.mode.titre.echelle };
  };
  // Deux secondes de jeu font quatre-vingts pas — à un près, le reliquat de
  // l'accumulateur pouvant tomber juste avant un pas de plus.
  const a = compter(60, 2), z = compter(120, 2);
  assert.ok(Math.abs(a.pas - 80) <= 1, '60 Hz : 40 pas par seconde, pas ' + a.pas / 2);
  assert.ok(Math.abs(z.pas - 80) <= 1, '120 Hz : la même allure, pas ' + z.pas / 2);
  assert.ok(Math.abs(a.echelle - z.echelle) <= 2, 'le titre respire à la même allure');
  // Le pas étant fixe, tmod converge vers 40/32 — exactement celui du lecteur.
  assert.ok(Math.abs(a.tmod - C.WANTED_FPS / C.SWF_FPS) < 0.01, 'tmod ≈ 0,8 : ' + a.tmod);
});

test('le décor de scène du SWF : l\'aplat sombre sous le jeu, le cadre blanc dessus', () => {
  // Le montage de snake3.swf empile trois choses autour du jeu, et le rideau de
  // Transition.as ne masque QUE le jeu (mc.setMask) : les deux autres restent
  // entières pendant le fondu. Sans elles, le fondu s'ouvrait sur le vert clair
  // du portail au lieu du vert profond du film.
  const { lireSwf } = require('../scripts/lib/swf-sprites.js');
  const b = lireSwf(path.join(RACINE, 'Games/snake3/snake3.swf'));
  const C = require('../public/snake3/const.js');

  // 1. SetBackgroundColor (tag 9) — le vert du portail.
  const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;
  const enTete = b.readUInt16LE(debut);
  assert.strictEqual(enTete >> 6, 9, 'le premier tag est SetBackgroundColor');
  assert.strictEqual('#' + b.slice(debut + 2, debut + 5).toString('hex'), C.FOND_PORTAIL);

  // Les placements de la racine, dans l'ordre des profondeurs, et les formes
  // qu'ils posent. On relit le SWF plutôt que de faire confiance à un relevé.
  const bits = (o) => {
    let bit = 0;
    const u = (n) => { let v = 0; for (let i = 0; i < n; i++) { v = v * 2 + ((b[o + (bit >> 3)] >> (7 - (bit & 7))) & 1); bit++; } return v; };
    const s = (n) => { const v = u(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v; };
    return { u, s, fin: () => o + ((bit + 7) >> 3) };
  };
  const forme = (o) => {                 // DefineShape : id, RECT, FILLSTYLEARRAY
    const r = bits(o + 2);
    const n = r.u(5);
    const boite = [r.s(n), r.s(n), r.s(n), r.s(n)].map((v) => v / 20);
    let p = r.fin();
    const nf = b[p++];
    const styles = [];
    for (let i = 0; i < nf; i++) { const t = b[p++]; styles.push({ t, c: '#' + b.slice(p, p + 3).toString('hex') }); p += 3; }
    return { boite, styles };
  };
  const formes = new Map();
  const places = [];
  (function scan(o, fin) {
    while (o < fin) {
      const h = b.readUInt16LE(o), code = h >> 6;
      let len = h & 0x3f, hs = 2;
      if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
      if (code === 0) break;
      const corps = o + hs;
      if (code === 2) formes.set(b.readUInt16LE(corps), forme(corps));
      if (code === 26 && (b[corps] & 0x02)) {
        places.push({ depth: b.readUInt16LE(corps + 1), char: b.readUInt16LE(corps + 3) });
      }
      if (code === 1) return;            // on s'arrête à la fin de la 1re image
      o = corps + len;
    }
  })(debut, b.length);
  places.sort((a, z) => a.depth - z.depth);

  // 2. La profondeur la plus basse : un aplat 700×480, SOUS le clip du jeu.
  const fond = formes.get(places[0].char);
  assert.ok(fond, 'la profondeur 1 pose bien une forme');
  assert.deepStrictEqual(fond.boite, [0, C.WIDTH, 0, C.HEIGHT], 'il couvre toute la scène');
  assert.strictEqual(fond.styles.length, 1);
  assert.strictEqual(fond.styles[0].c, C.FOND_SCENE, 'c\'est le vert que le fondu découvre');

  // 3. La profondeur la plus haute : le cadre blanc de deux points, PAR-DESSUS.
  const cadre = formes.get(places[places.length - 1].char);
  assert.ok(cadre, 'la profondeur du dessus pose bien une forme');
  assert.strictEqual(cadre.styles[0].c, '#ffffff', 'le cadre est blanc');
  assert.deepStrictEqual(cadre.boite,
    [C.CADRE_SCENE.x, C.CADRE_SCENE.x + C.WIDTH, 0, C.HEIGHT],
    'aux mesures — le demi-point de décalage compris');
  assert.ok(places[places.length - 1].depth > places[1].depth,
    'le cadre est au-dessus du clip du jeu');

  // 4. Et le client peint tout ça dans cet ordre.
  const src = fs.readFileSync(path.join(RACINE, 'public/snake3/game.js'), 'utf8');
  const ordre = ['C.FOND_PORTAIL', 'C.FOND_SCENE', 'this.mode.dessiner(ctx)', 'this.cadreScene(ctx)']
    .map((m) => src.indexOf(m, src.indexOf('  dessiner() {')));
  assert.ok(ordre.every((i) => i > 0) && ordre.every((v, i) => !i || v > ordre[i - 1]),
    'portail, puis aplat, puis le mode, puis le cadre : ' + ordre);
});

test('le rideau de transition ne rasterise pas le masque à chaque échelle', () => {
  // mask_size va de 400 % à 0 : une rasterisation par échelle ferait une
  // centaine de canvas, dont des 1350×1720, pour un seul fondu.
  const src = fs.readFileSync(path.join(RACINE, 'public/snake3/game.js'), 'utf8');
  const m = src.match(/D\.rendre\('snakeMask'[^;]*/);
  assert.ok(m, 'le rideau tire bien snakeMask');
  assert.ok(/Math\.min\(1,\s*k\)/.test(m[0]), 'la finesse est plafonnée : ' + m[0]);
});

// ── Les deux retours de jeu ───────────────────────────────────────────────

test('deux dynamites laissent le serpent à sa seule tête — c\'est la TROISIÈME qui tue', () => {
  // Pile.as : `counter++` puis `for(i=0;i<counter;i++) if(len>0) explode(); else
  // game_over();`. La première dynamite coûte un segment, la deuxième deux, la
  // troisième trois — et la mort n'arrive que si `len` vaut DÉJÀ zéro en entrant
  // dans un tour de boucle. Un serpent neuf (len 3) encaisse donc les deux
  // premières et se retrouve réduit à sa tête, bien vivant.
  const w = bacASable();
  const C = w.SnakeConst, B = w.SnakeBonus, P = w.SnakePartie;
  const partie = new P.Partie({ hasard: () => 0 });
  assert.strictEqual(partie.serpent.len, C.SNAKE_DEFAULT_LENGTH, 'len de départ');
  assert.strictEqual(B.Pile.counter, 0, 'le compteur repart à zéro à chaque partie');

  B.Pile.activate(partie);
  assert.strictEqual(partie.serpent.len, 2, 'première dynamite : un segment');
  assert.strictEqual(partie.game_over_flag, false);

  B.Pile.activate(partie);
  assert.strictEqual(partie.serpent.len, 0, 'deuxième dynamite : deux segments');
  assert.strictEqual(partie.game_over_flag, false, 'réduit à sa tête, il VIT');

  // Et il continue de jouer. On le pose au milieu du terrain, cap à droite :
  // cent images à ~2,6 points l'une, il lui reste largement de quoi rouler
  // avant le mur. S'il meurt là, c'est que quelque chose tue à len 0.
  const b = partie.niveau.bounds();
  partie.serpent.x = (b.left + b.right) / 2;
  partie.serpent.y = (b.top + b.bottom) / 2;
  partie.serpent.ang = 0;
  partie.serpent.old_ang = null;
  for (let i = 0; i < 100 && !partie.game_over_flag; i++) partie.main(0.8, 1 / C.SWF_FPS);
  assert.strictEqual(partie.game_over_flag, false, 'la tête seule reste jouable');
  assert.strictEqual(partie.serpent.len, 0, 'et elle reste seule');

  B.Pile.activate(partie);
  assert.strictEqual(partie.game_over_flag, true, 'la troisième dynamite tue');
});

test('la tête se dessine tant que le serpent vit, même réduite à elle seule', () => {
  // Snake.draw place et redimensionne `tete` à CHAQUE image, avant même son
  // `if(!redraw) return` ; seul game_over la cache (`tete._visible = false`),
  // et seulement une fois la queue explosée. La masquer à len 0 rendait le
  // serpent invisible après deux dynamites — on jouait à l'aveugle.
  const w = bacASable();
  const R = w.SnakeRendu;
  const poses = [];
  const D = w.SnakeDessin;
  const brut = D.poser;
  D.poser = (ctx, cle, ...r) => { poses.push(cle); return brut(ctx, cle, ...r); };
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  const serpent = { x: 100, y: 100, ang: 0, len: 0, vivant: true, tete_frame: 1 };

  R.dessinerTete(ctx, serpent, 1);
  assert.ok(poses.includes('tete'), 'à len 0 et vivant, la tête est posée');

  poses.length = 0;
  serpent.vivant = false;
  R.dessinerTete(ctx, serpent, 1);
  assert.strictEqual(poses.length, 0, 'morte et queue explosée, elle disparaît');

  // La taille suit le SWF : tete._xscale = 30 + 70 · min(10, len+3)/10.
  poses.length = 0;
  const echelles = [];
  D.poser = (c, cle, f, x, y, kx) => { poses.push(cle); echelles.push(kx); };
  serpent.vivant = true;
  R.dessinerTete(ctx, serpent, 1);
  assert.ok(Math.abs(echelles[0] - (30 + 70 * 0.3) / 100) < 1e-9,
    'la tête seule se dessine à 51 % : ' + echelles[0]);
  D.poser = brut;
});

test('la langue affiche ses munitions, aux mesures exactes du SWF', () => {
  // Langue.as : `Std.cast(mc).count.n = n`. Le compteur n'est pas un texte
  // libre mais un clip du montage — on relit le SWF pour ses mesures plutôt
  // que de les inventer :
  //   · le clip `count` posé dans le clip `slot` à l'image de la langue ;
  //   · dedans DEUX champs `n` superposés, l'un doré (l'ombre), l'autre blanc.
  const { lireSwf } = require('../scripts/lib/swf-sprites.js');
  const b = lireSwf(path.join(RACINE, 'Games/snake3/snake3.swf'));
  const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;

  // Lecture des bits non alignés (MATRIX, RECT).
  function bits(o) {
    let bit = 0;
    const u = (n) => { let v = 0; for (let i = 0; i < n; i++) { v = v * 2 + ((b[o + (bit >> 3)] >> (7 - (bit & 7))) & 1); bit++; } return v; };
    const s = (n) => { const v = u(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v; };
    return { u, s, fin: () => o + ((bit + 7) >> 3) };
  }
  function matrice(o) {
    const r = bits(o); const M = { e: 0, f: 0 };
    if (r.u(1)) { const n = r.u(5); r.s(n); r.s(n); }          // échelle
    if (r.u(1)) { const n = r.u(5); r.s(n); r.s(n); }          // rotation
    const n = r.u(5); M.e = r.s(n) / 20; M.f = r.s(n) / 20;
    return { M, fin: r.fin() };
  }
  const placements = new Map();   // sprite → [{ frame, char, M }]
  const textes = new Map();       // id → { boite, taille, couleur, centre }
  (function scan(from, to, id) {
    let o = from, frame = 1;
    while (o < to) {
      const h = b.readUInt16LE(o), code = h >> 6;
      let len = h & 0x3f, hs = 2;
      if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
      if (code === 0) break;
      const c = o + hs;
      if (code === 39) scan(c + 4, c + len, b.readUInt16LE(c));
      if (code === 26 && (b[c] & 0x02)) {
        const f = b[c]; let p = c + 3;
        const char = b.readUInt16LE(p); p += 2;
        let M = { e: 0, f: 0 };
        if (f & 0x04) M = matrice(p).M;
        if (!placements.has(id)) placements.set(id, []);
        placements.get(id).push({ frame, char, M });
      }
      if (code === 37) {                                        // DefineEditText
        const id2 = b.readUInt16LE(c);
        const r = bits(c + 2); const nb = r.u(5);
        const boite = [r.s(nb), r.s(nb), r.s(nb), r.s(nb)].map((v) => v / 20);
        let p = r.fin();
        const f1 = b[p], f2 = b[p + 1]; p += 2;
        let taille = null, couleur = null, centre = null;
        if (f1 & 1) { p += 2; taille = b.readUInt16LE(p) / 20; p += 2; }
        if (f1 & 4) { couleur = '#' + b.slice(p, p + 3).toString('hex'); p += 4; }
        if (f1 & 2) p += 2;
        if (f2 & 0x20) { centre = b[p] === 2; }
        textes.set(id2, { boite, taille, couleur, centre });
      }
      if (code === 1) frame++;
      o = c + len;
    }
  })(debut, b.length, 0);

  // Le clip `slot` du manifeste, et l'image de la langue (Langue → super(game,2)).
  const idSlot = manifeste.clips.slot.id;
  const dansSlot = (placements.get(idSlot) || []).filter((p) => p.frame === 2);
  // Le compteur est le seul placement de cette image qui contienne les champs `n`.
  const compteur = dansSlot.find((p) => (placements.get(p.char) || [])
    .some((q) => textes.has(q.char) && textes.get(q.char).taille === 12));
  assert.ok(compteur, 'le clip du compteur est posé sur l\'image de la langue');

  const champs = (placements.get(compteur.char) || [])
    .filter((q) => textes.has(q.char)).map((q) => ({ M: q.M, t: textes.get(q.char) }));
  assert.strictEqual(champs.length, 2, 'deux passes : l\'ombre et le chiffre');
  const blanc = champs.find((c) => c.t.couleur === '#ffffff');
  const dore = champs.find((c) => c.t.couleur !== '#ffffff');
  assert.ok(blanc && dore, 'un champ blanc et un champ doré : ' + JSON.stringify(champs.map((c) => c.t.couleur)));
  assert.ok(blanc.t.centre, 'le chiffre est centré dans sa boîte');

  // Ce que le SWF impose, en coordonnées de scène pour une case au centre (cx, cy).
  const cx = 130, cy = 30;                                   // la 3e case (pos 2)
  const attendu = (ch) => ({
    x: cx + compteur.M.e + ch.M.e + (ch.t.boite[0] + ch.t.boite[1]) / 2,
    y: cy + compteur.M.f + ch.M.f + (ch.t.boite[2] + ch.t.boite[3]) / 2,
  });

  // Ce que le client dessine, relevé sur un contexte espion.
  const w = bacASable();
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'),
    { fruits: {}, record: 0, options: {}, prefs: { $music: true, $sounds: true, $keys: null },
      sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null) },
    new Proxy({}, { get: () => () => false }));
  const vue = new w.SnakeJeu.VuePartie(jeu);
  const ecrits = [];
  let couleur = null, police = null, aligne = null;
  const espion = new Proxy({}, {
    get: (o, n) => (n === 'fillText' ? (t, x, y) => ecrits.push({ t, x, y, couleur, police, aligne })
      : () => {}),
    set: (o, n, v) => {
      if (n === 'fillStyle') couleur = v;
      if (n === 'font') police = v;
      if (n === 'textAlign') aligne = v;
      return true;
    },
  });
  vue.dessinerMunitions(espion, cx, cy, 10);

  assert.strictEqual(ecrits.length, 2, 'deux passes dessinées');
  assert.deepStrictEqual(ecrits.map((e) => e.t), ['10', '10']);
  assert.strictEqual(ecrits[0].couleur, dore.t.couleur, 'l\'ombre dorée d\'abord');
  assert.strictEqual(ecrits[1].couleur, '#ffffff', 'puis le chiffre blanc');
  assert.ok(/Lithograph/.test(ecrits[1].police), 'en Lithograph, la police du champ');
  assert.ok(/12px/.test(ecrits[1].police), 'à la taille du champ (12)');
  assert.strictEqual(ecrits[1].aligne, 'center');
  for (const [i, ref] of [[0, dore], [1, blanc]]) {
    const a = attendu(ref);
    assert.ok(Math.abs(ecrits[i].x - a.x) < 0.01 && Math.abs(ecrits[i].y - a.y) < 0.01,
      'passe ' + i + ' à sa place : ' + JSON.stringify(ecrits[i]) + ' vs ' + JSON.stringify(a));
  }
  // Et il est bien DANS la case, en haut à gauche — pas sous son bord.
  assert.ok(ecrits[1].y < cy, 'le compteur est au-dessus du centre de la case');
});

// ── Les hitbox : celle de la bouche, celle du corps ─────────────────────────
//
// Manger, c'est `Std.hitTest(fruit, col_mc)` : DEUX CLIPS, donc Flash compare
// leurs cadres alignés sur les axes de la SCÈNE. Or `col` vit dans `tete`, et
// Snake.draw pose `tete._rotation = ang·180/π` — le petit rectangle tourne, et
// le cadre aligné d'un rectangle tourné grandit avec l'angle. On testait la
// taille droite quel que soit le cap : les fruits étaient plus durs à prendre
// qu'en Flash partout sauf aux quatre points cardinaux.

test('la bouche s\'élargit quand la tête tourne, comme le cadre d\'un clip tourné', () => {
  const w = bacASable();
  const plateforme = { fruits: {}, record: 0, prefs: { $music: true, $sounds: true, $keys: null },
    sauverSlot0: () => Promise.resolve(true), sauverScore: () => Promise.resolve(null),
    sauverPrefs: () => Promise.resolve(true) };
  const sons = new Proxy({}, { get: () => () => false });
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'), plateforme, sons);
  const vue = new w.SnakeJeu.VuePartie(jeu);
  const partie = vue.partie;

  // Le cadre mesuré DANS le SWF, arbitre du test.
  const d = manifeste.cadres.col;
  assert.ok(d && d.w > 0 && d.h > 0, 'le manifeste porte le cadre de `col`');

  const s = partie.serpent;
  s.x = 300; s.y = 200;
  const echelle = (30 + 70 * (Math.min(10, s.len + 3) / 10)) / 100;

  const droit = (ang) => {
    s.ang = ang;
    s.dx = Math.cos(ang); s.dy = Math.sin(ang);
    return partie.colDeTete(s);
  };

  // À l'horizontale, le cadre est celui du clip, à l'échelle près.
  const a0 = droit(0);
  assert.ok(Math.abs(a0.w - d.w * echelle) < 0.01, 'à 0° : la largeur du clip');
  assert.ok(Math.abs(a0.h - d.h * echelle) < 0.01, 'à 0° : la hauteur du clip');

  // À 45°, W = H = (w + h)·cos45 — le cadre aligné d'un rectangle tourné.
  const a45 = droit(Math.PI / 4);
  const attendu45 = (d.w + d.h) * Math.SQRT1_2 * echelle;
  assert.ok(Math.abs(a45.w - attendu45) < 0.01, 'à 45° : ' + a45.w + ' vs ' + attendu45);
  assert.ok(Math.abs(a45.h - attendu45) < 0.01, 'à 45° : hauteur pareille');
  assert.ok(a45.w > a0.w * 1.3, 'la bouche est nettement plus large en biais qu\'à plat');

  // Et la loi complète tient à tous les caps.
  for (const ang of [0.3, 1.1, 2.4, -0.8, 3.9]) {
    const a = droit(ang);
    const co = Math.abs(Math.cos(ang)), si = Math.abs(Math.sin(ang));
    assert.ok(Math.abs(a.w - (d.w * co + d.h * si) * echelle) < 0.01, 'largeur à ' + ang);
    assert.ok(Math.abs(a.h - (d.w * si + d.h * co) * echelle) < 0.01, 'hauteur à ' + ang);
  }
});

// Le corps, lui, est tracé en COURBES quadratiques (draw_queue : contrôle
// queue[n-2], fin queue[n-5]). On approchait chaque segment par sa corde
// droite — 25 px d'un bout à l'autre — et la corde coupe le virage : elle
// passe DEDANS. Un point à l'intérieur d'une boucle se retrouvait donc plus
// près d'elle que du trait réel : on mourait en FRÔLANT sa propre queue.

test('le corps tue selon sa courbe tracée, pas selon la corde qui coupe le virage', () => {
  const S = require('../public/snake3/serpent.js');
  const C = require('../public/snake3/const.js');

  // Une file de points telle que Snake.move la remplit : un point tous les
  // cinq pixels de route, en virage au braquage maximum.
  const tmod = C.WANTED_FPS / C.SWF_FPS;
  const vitesse = C.SNAKE_DEFAULT_SPEED * tmod;
  const q = [];
  let x = 0, y = 0, ang = 0, dist = 0;
  while (q.length < 200) {
    ang += C.SNAKE_DEFAULT_TURN * tmod;
    x += Math.cos(ang) * vitesse; y += Math.sin(ang) * vitesse;
    dist += vitesse / 5;
    while (dist >= 1) { dist--; q.push({ x, y }); }
  }

  const s = new S.Serpent({ x: 0, y: 0 });
  s.queue = q;
  s.len = 12;
  s.eat = 0;
  s.tmod_dessin = tmod;          // la branche « courbes » de draw_queue

  const n = q.length - 1;
  const echelle = Math.min(10, s.len + 3) / 10;
  const pas = echelle * 15 / s.len;

  // On prend le deuxième segment (près de la tête, corde bien courbée) et le
  // point PILE sur la limite de la corde, du côté intérieur du virage.
  const i = s.len - 1;
  const p0 = q[n - 5], ctrl = q[n - 7], p1 = q[n - 10];
  const r = (i * pas + 8) / 2;
  const vx = p0.x - p1.x, vy = p0.y - p1.y, L = Math.hypot(vx, vy);
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;

  // Distance réelle à la courbe, échantillonnée finement.
  const dCourbe = (px, py) => {
    let best = Infinity;
    for (let k = 0; k <= 400; k++) {
      const t = k / 400, u = 1 - t;
      const bx = u * u * p1.x + 2 * u * t * ctrl.x + t * t * p0.x;
      const by = u * u * p1.y + 2 * u * t * ctrl.y + t * t * p0.y;
      best = Math.min(best, Math.hypot(px - bx, py - by));
    }
    return best;
  };

  // Le côté où la corde coupe le virage : celui où la courbe s'éloigne.
  let cote = 1;
  if (dCourbe(mx - vy / L * r, my + vx / L * r) < dCourbe(mx + vy / L * r, my - vx / L * r)) cote = -1;
  const px = mx + (-vy / L) * cote * r, py = my + (vx / L) * cote * r;

  // Ce point est à la limite de la CORDE (donc « touché » avec l'ancienne
  // approximation) mais franchement hors du TRAIT réellement dessiné.
  assert.ok(dCourbe(px, py) > r + 0.5,
    'le point est bien hors du trait tracé (' + dCourbe(px, py).toFixed(2) + ' > ' + r.toFixed(2) + ')');
  assert.strictEqual(s.toucheLeCorps(px, py), false, 'frôler la courbe ne tue pas');

  // Et l'intérieur du trait tue toujours : on ne l'a pas rétréci.
  const surLaCourbe = (t) => {
    const u = 1 - t;
    return { x: u * u * p1.x + 2 * u * t * ctrl.x + t * t * p0.x,
      y: u * u * p1.y + 2 * u * t * ctrl.y + t * t * p0.y };
  };
  for (const t of [0.15, 0.5, 0.85]) {
    const c = surLaCourbe(t);
    assert.strictEqual(s.toucheLeCorps(c.x, c.y), true, 'le cœur du trait tue (t=' + t + ')');
    assert.strictEqual(s.toucheLeCorps(c.x + (-vy / L) * (r * 0.8), c.y + (vx / L) * (r * 0.8)), true,
      'le bord intérieur du trait tue aussi (t=' + t + ')');
  }
});
