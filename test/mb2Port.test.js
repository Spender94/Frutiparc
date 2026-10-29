/*
 * MOTIONBALL — LE PORTAGE (public/mb2/), ce qui se vérifie sans navigateur.
 *
 *   · le DICTIONNAIRE des noms de liaison : chaque nom que les sources AS2
 *     attachent (Games/motionBall2/mb2/*.as) a son symbole dans data/mb2.json,
 *     et chaque son de mb2.Sound son fichier — l'obfuscation du SWF est
 *     entièrement levée ;
 *   · les SCRIPTS D'IMAGE : chaque DoAction repéré par l'extracteur a sa
 *     transcription dans jeu/scripts-images.js ;
 *   · le DÉCODEUR des cartes (ext.util.MTBitcodec, désassemblé) relit les
 *     douze cartes historiques comme le générateur serveur (mb2gen.js) les
 *     relit, salle par salle, bumper par bumper ;
 *   · le SCORE du Challenge (Game.calcScore) et le temps de course
 *     (Interf.makeTime), la fruticard neuve (Card), les TItems de course.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Le moteur (sans DOM) puis les classes du jeu, dans l'ordre de la page.
globalThis.window = undefined;
for (const f of ['public/kaluga/moteur/formes.js', 'public/kaluga/moteur/flash.js', 'public/kaluga/moteur/texte.js',
  'public/mb2/jeu/scripts-images.js', 'public/mb2/jeu/base.js', 'public/mb2/jeu/niveau.js', 'public/mb2/jeu/balle.js',
  'public/mb2/jeu/boss.js', 'public/mb2/jeu/ecrans.js', 'public/mb2/jeu/game.js', 'public/mb2/plateforme.js', 'public/mb2/jeu/manager.js']) {
  require(path.join(ROOT, f));
}
const K = globalThis.KalugaMoteur;
const J = globalThis.Mb2Jeu;
const biblio = JSON.parse(lire('public/mb2/data/mb2.json'));

// ── Le dictionnaire ───────────────────────────────────────────────────────

test('chaque nom de liaison des sources AS2 a son symbole dans la bibliothèque extraite', () => {
  const noms = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'Games/motionBall2/mb2'))) {
    if (!f.endsWith('.as') || f === 'Editor.as' || f === 'BossBlackBall.as') continue;   // pas compilés dans le SWF
    const t = lire('Games/motionBall2/mb2/' + f);
    const re = /(?:\.attach\(|attachMovie\(|attachMC\([^,]+,|duplicateMC\([^,]+,)\s*"([^"]+)"/g;
    let m; while ((m = re.exec(t))) noms.add(m[1]);
  }
  // Le zapper devient « checkpoint » en Course, par une ternaire que l'expression ne voit pas.
  noms.add('checkpoint');
  assert.ok(noms.size >= 50, noms.size + ' noms relevés dans les sources');
  const absents = [...noms].filter((n) => !(n in biblio.symboles) || biblio.perso[biblio.symboles[n]].t !== 'clip');
  assert.deepStrictEqual(absents, [], 'liaisons sans symbole');
});

test('chaque son de mb2.Sound est un fichier MP3 extrait, et les boucles aussi', () => {
  const S = J.Sound;
  const noms = new Set(Object.values(S).filter((v) => typeof v === 'string' && v && !/^[A-Z]/.test(v)));
  for (let i = 1; i <= 5; i++) noms.add('loop$' + i);
  for (let i = 1; i <= 3; i++) noms.add('kata' + i);
  const absents = [...noms].filter((n) => !fs.existsSync(path.join(ROOT, 'public/mb2/sons', n + '.mp3')) && n !== 'menu_select' && n !== 'kata4');
  assert.deepStrictEqual(absents, [], 'sons sans fichier');
  // Et « menu_select » n\'existe qu\'en nom dans le SWF (aucun son exporté) : le
  // portage le sait, et ne va pas le chercher.
  assert.ok(!J.SONS.includes('kata4'), 'kata4 n\'est pas un son du SWF');
});

test('les 110 scripts d\'image du SWF ont leur transcription', () => {
  const cles = new Set();
  for (const p of Object.values(biblio.perso)) if (p.t === 'clip') for (const f of p.frames) if (f.a) cles.add(f.a);
  assert.strictEqual(cles.size, 110);
  const manquants = [...cles].filter((c) => typeof K.scriptsImages[c] !== 'function');
  assert.deepStrictEqual(manquants, [], 'scripts non portés');
});

test('la bibliothèque est celle du SWF : 610×410 à 40 images par seconde, la racine pose « main »', () => {
  assert.deepStrictEqual([biblio.entete.l, biblio.entete.h, biblio.entete.cadence], [610, 410, 40]);
  const racine = biblio.perso[0];
  const main = racine.frames[0].ops.find((op) => op.n === 'main');
  assert.ok(main && main.c === 900, 'le clip principal est le sprite 900');
  assert.strictEqual(biblio.perso[900].frames.length, 3, 'trois images : init, boucle, retour');
});

// ── Le décodeur des cartes ────────────────────────────────────────────────

const CARTES = ['mb2tuto.dat', 'mb2classic.dat', 'mb2adv1.dat', 'mb2adv2.dat', 'mb2adv3.dat', 'mb2adv4.dat', 'mb2adv5.dat',
  'mb2run1.dat', 'mb2run2.dat', 'mb2run3.dat', 'mb2run4.dat', 'mb2run5.dat', 'mb2run6.dat', 'mb2run7.dat'];

// Le décodage de référence, avec le lecteur binaire du générateur serveur
// (alphabet du SWF) et la grammaire de LevelLoader.as.
function decoderReference(ddata) {
  const gen = require('../mb2gen.js');
  // Un lecteur de bits indépendant : six bits par caractère de l'alphabet du
  // SWF (celui que le générateur ÉCRIT), lus d'une traite.
  const bits = [];
  for (const ch of ddata) { const v = gen.B64_SWF.indexOf(ch); if (v < 0) continue; for (let j = 5; j >= 0; j--) bits.push((v >> j) & 1); }
  let pos = 0;
  const bc = { read(n) { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | (bits[pos++] || 0); return v; } };
  const width = bc.read(7), height = bc.read(7), start_x = bc.read(7), start_y = bc.read(7);
  const rooms = [];
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    const r = { rtype: bc.read(3) };
    if (r.rtype === 3 || r.rtype === 5) r.rdata = bc.read(2);
    else if (r.rtype === 4) r.rdata = bc.read(3);
    if (r.rtype !== 0) { r.paths = []; for (let d = 0; d < 4; d++) { const p = { ptype: bc.read(2) }; if (p.ptype === 3) p.pdata = bc.read(2); r.paths.push(p); } }
    rooms.push(r);
  }
  return { width, height, start_x, start_y, rooms };
}

test('LevelLoader relit les cartes historiques comme le lecteur binaire du générateur', () => {
  for (const nom of CARTES) {
    const ddata = J.Loader.decoderLoadVars(lire('Games/motionBall2/' + nom)).ddata;
    assert.ok(ddata && ddata.length > 20, nom + ' : ddata');
    const L = new J.LevelLoader(ddata);
    assert.strictEqual(L.bc.has_error(), false, nom + ' : sans erreur');
    const ref = decoderReference(ddata);
    assert.deepStrictEqual([L.width, L.height, L.start_x, L.start_y], [ref.width, ref.height, ref.start_x, ref.start_y], nom + ' : en-tête');
    let i = 0;
    for (let x = 0; x < L.width; x++) for (let y = 0; y < L.height; y++) {
      const r = L.dungeon[x][y], rr = ref.rooms[i++];
      assert.strictEqual(r.rtype, rr.rtype, `${nom} salle ${x},${y} : rtype`);
      assert.strictEqual(r.rdata, rr.rdata, `${nom} salle ${x},${y} : rdata`);
      assert.deepStrictEqual(r.paths, rr.paths, `${nom} salle ${x},${y} : portes`);
    }
    // Les bumpers de toutes les salles, sans erreur non plus : le fichier est
    // lu jusqu'au bout, en repartant sur une frontière de caractère (next_part).
    L.decodeRoom(L.width - 1, L.height - 1);
    assert.strictEqual(L.bc.has_error(), false, nom + ' : bumpers sans erreur');
    let nb = 0, meubles = 0;
    for (let x = 0; x < L.width; x++) for (let y = 0; y < L.height; y++) { const b = L.dungeon[x][y].bdata; if (b) { meubles++; nb += b.length; } }
    assert.ok(meubles > 0 && nb > 0, nom + ' : des salles meublées (' + meubles + ', ' + nb + ' bumpers)');
    for (let x = 0; x < L.width; x++) for (let y = 0; y < L.height; y++) for (const b of (L.dungeon[x][y].bdata || [])) {
      assert.ok(b.btype >= 1 && b.btype <= 15 && b.x >= 0 && b.x < J.Const.LVL_CWIDTH && b.y >= 0 && b.y < J.Const.LVL_CHEIGHT, `${nom} : bumper plausible ${JSON.stringify(b)}`);
    }
  }
});

test('MTBitcodec : l\'alphabet du SWF (…9-_), six bits par caractère, next_part ne saute rien', () => {
  const bc = new J.MTBitcodec('a-_');
  assert.strictEqual(bc.read(6), 0);
  assert.strictEqual(bc.read(3), 7);    // « - » = 62 = 111110 : ses trois premiers bits
  bc.next_part();                       // les trois bits restants sont oubliés, le caractère suivant est lu
  assert.strictEqual(bc.read(6), 63);   // « _ »
  assert.strictEqual(bc.read(1), -1);   // plus rien : erreur
  assert.strictEqual(bc.has_error(), true);
  const w = new J.MTBitcodec('');
  w.write(7, 8); w.write(7, 8); w.write(7, 3); w.write(7, 4);
  const r2 = new J.MTBitcodec(w.toString());
  assert.deepStrictEqual([r2.read(7), r2.read(7), r2.read(7), r2.read(7)], [8, 8, 3, 4]);
});

// ── Le score, le temps, la fruticard ──────────────────────────────────────

test('calcScore : le pourcentage de salles visitées, plus le temps restant si le boss est vaincu', () => {
  const L = { width: 2, height: 2, dungeon: [[{ rtype: 1, visited: true }, { rtype: 0 }], [{ rtype: 2, visited: true }, { rtype: 1 }]] };
  const g = Object.create(J.Game.prototype);
  g.level = L; g.curtime = 123456;
  J.Manager.play_mode = J.Const.MODE_CHALLENGE;
  // 2 salles visitées sur 3 : int(66,6) − 1 = 65
  assert.strictEqual(g.calcScore(J.Const.CAUSE_NOTIME), 65);
  // Le boss vaincu : + int(1234,56) × 100
  assert.strictEqual(g.calcScore(J.Const.CAUSE_WINS), 65 + 1234 * 100);
  J.Manager.play_mode = J.Const.MODE_CLASSIC;
  g.level.pos_x = 41;
  assert.strictEqual(g.calcScore(J.Const.CAUSE_NOTIME), 42);
  J.Manager.play_mode = J.Const.MODE_COURSE;
  g.curtime = 184.567;
  assert.strictEqual(g.calcScore(J.Const.CAUSE_WINS), 18456);
});

test('Interf.makeTime écrit mm:ss:cc, et la fruticard neuve porte les temps des sept courses', () => {
  assert.strictEqual(J.Interf.makeTime(18456), '03:04:56');
  assert.strictEqual(J.Interf.makeTime(0), '00:00:00');
  const c = new J.Card();
  assert.strictEqual(c.$records.length, 7);
  assert.deepStrictEqual(c.$records[0].map((r) => r.$t), [18000, 22000, 26000]);
  assert.ok(c.$records.every((r) => r.every((e) => e.$c === true)));
  assert.deepStrictEqual([c.$challenge, c.$classic, c.$dungeons, c.$courses, c.$classic_score], [true, true, [true, true, true, true], [true], 0]);
});

test('TItems : la course donne or, argent, bronze selon le rang ; le Classique au niveau 40', () => {
  const fcard = new J.Card();
  const donnes = [];
  J.Manager.client = { fcard, giveItem: (n) => donnes.push(n), saveSlot: () => {} };
  assert.strictEqual(J.TItems.giveCourse(2, 0), 3);
  assert.deepStrictEqual(donnes, ['$c3or', '$c3argent', '$c3']);
  assert.strictEqual(J.TItems.giveCourse(2, 0), 0, 'déjà donnés');
  assert.strictEqual(J.TItems.giveClassic(39), false);
  assert.strictEqual(J.TItems.giveClassic(40), true);
  assert.strictEqual(donnes[donnes.length - 1], '$bfacettes');
  assert.strictEqual(J.TItems.giveAventure(1), true);
  assert.strictEqual(donnes[donnes.length - 1], '$symb1');
  assert.strictEqual(J.TItems.giveAventure(1), true);
  assert.strictEqual(donnes[donnes.length - 1], '$eca1');
});

test('le catalogue : le disque light de MotionBall à côté du disque Flash, et le light l\'ouvre en onglet', () => {
  const serveur = lire('server.js');
  assert.match(serveur, /mb2light: \{\s*discType: '3',\s*playMode: 'single',\s*swfName: 'mb2',\s*iconName: 'mb2',\s*gameId: 'light\/mb2'/);
  const light = lire('public/light.html');
  assert.match(light, /mb2: "#mb2-frame"/);
  assert.match(light, /mb2: "\/mb2\/"/);
  assert.match(light, /\{ tab: "mb2", jaquette: "mb2", name: "Motion-Ball 2" \}/);
  assert.ok(!/flash: "mb2"/.test(light), 'MotionBall n\'est plus dans la liste des jeux Flash du light');
  assert.match(lire('public/ruffle.html'), /"light\/mb2": \{ url: "\/mb2\/"/);
  assert.match(lire('public/bureau-frutiz.js'), /mb2:\s*\{ panneau: '#mb2-panel'/);
});

// ── Les retours des joueurs : la zone de contact et les blocs ─────────────

test('un remplissage par image ne compte que là où l\'image est opaque : le bumper normal est rond, pas carré', () => {
  // Dans le SWF, le bumper normal (bnormal → forme 855) est un CARRÉ de
  // 44 px rempli d'un PNG rond aux coins transparents. Tester le seul tracé
  // en faisait une zone de contact carrée (Collide.gen_hitmap, hitTest avec
  // le drapeau de forme) : la bille rebondissait à huit pixels d'un anneau
  // qu'elle ne touchait pas. Le lecteur, lui, regarde l'image.
  const forme = biblio.perso[String(biblio.symboles.bnormal)].frames[0].ops.find((o) => o.c).c;
  const f = biblio.perso[String(forme)];
  assert.strictEqual(f.t, 'forme');
  assert.ok(f.ops.every((o) => o.f && o.f.bm), 'le bumper normal est fait de remplissages par image');
  assert.match(f.ops[0].d, /^M22 22L-22 22L-22 -22L22 -22L22 22Z$/, 'un carré de 44 px');
  assert.strictEqual(biblio.images[String(f.ops[0].f.bm.id)].f, 'mb2-854.png');
  const formes = lire('public/kaluga/moteur/formes.js');
  assert.match(formes, /function contient\(ctx, dessin, x, y, images\)/, 'le test de contenu reçoit les images');
  assert.match(formes, /if \(alphaImage\(img, u, v\) === 0\) continue;/, 'un pixel transparent ne compte pas');
  assert.match(formes, /if \(f\.bm\.rp\) \{ u = \(\(u % w\) \+ w\) % w; v = \(\(v % h\) \+ h\) % h; \}\s*else if \(u < 0 \|\| v < 0 \|\| u >= w \|\| v >= h\) continue;/, 'hors de l\'image (sans répétition), rien');
  assert.match(lire('public/kaluga/moteur/flash.js'), /return K\.dessinContient\(K\.scene\.ctxMesure, d, x, y, this\.\$biblio\.images\);/, 'la forme passe les images de sa bibliothèque');
});

test('les tuiles d\'un mur se recouvrent de deux pour cent : plus de couture sur un canevas mis à l\'échelle', () => {
  const niveau = lire('public/mb2/jeu/niveau.js');
  assert.match(niveau, /Tools\.set_mcpos\(clip, b\);[\s\S]{0,900}if \(b\.btype === 6\) \{ clip\._xscale = 102; clip\._yscale = 102; \}\s*b\.clip = clip;/);
  // La tuile fait 40 px, centrée : deux pour cent, c'est 0,4 px de chaque côté.
  const tuile = biblio.perso[String(biblio.symboles.wall)].frames[0].ops.find((o) => o.c).c;
  assert.deepStrictEqual(biblio.perso[String(tuile)].b.map(Math.round), [-20, -20, 20, 20]);
});

// ── La pause automatique quand la fenêtre n'est plus au-dessus ────────────
//
// La page (index.html) lève `client.forcePause` — le drapeau de la Frusion,
// que Game.main lit à chaque image — et appelle Client.onPause, qui pose la
// pause d'ÉCHAP TOUT DE SUITE (Game.forcerPause) : une fenêtre cachée n'a
// plus d'images. Seule une partie en cours se met en pause ; le joueur
// relance par ÉCHAP, comme après sa propre pause.

// Une partie sans scène : les champs que `main`, la pause et sa reprise lisent.
function partiePause(etat) {
  K.Key.toutRelacher();
  const jeu = Object.create(J.Game.prototype);
  const parent = { attachMovie(link, nom) { parent[nom] = { link, removeMovieClip() { delete parent[nom]; } }; } };
  Object.assign(jeu, {
    game_over_flag: false, scroll_on: false, pause: null, pause_key_flag: false, pause_differee: false,
    space_key_flag: false, boss_update: null, curtime: 60000,
    options: { has_map: false, has_radar: false },
    main_color: { setTransform() { jeu.teinte = true; }, reset() { jeu.teinte = false; } },
    root_mc: { _parent: parent },
    ball: { hole_death: false, update_jump() {}, update_hole() { return false; }, update() {}, x: 100, y: 100 },
    level: { interf: { update() {} }, updates: [], bonus: [], dungeon: [], pos_x: 0, pos_y: 0 },
  }, etat || {});
  J.Manager.play_mode = J.Const.MODE_CHALLENGE;
  J.Manager.mode = jeu;
  J.Manager.client = new J.Client('');
  return { jeu, parent, client: J.Manager.client };
}
const imageMb2 = (jeu, code) => { if (code) K.Key.presser(code); jeu.main(); if (code) K.Key.relacher(code); };

test('pause automatique : une partie en cours prend la pause d\'ÉCHAP, tout de suite', () => {
  const auto = partiePause();
  auto.client.onPause();
  assert.ok(auto.jeu.pause instanceof J.Pause, 'la partie est en pause');
  assert.ok(auto.parent.pause_mc, 'avec l\'écran de pause');
  assert.strictEqual(auto.jeu.teinte, true, 'et la scène assombrie');
  assert.strictEqual(auto.jeu.pause_key_flag, true, 'comme si ÉCHAP venait d\'être pressée');

  const manuelle = partiePause();
  imageMb2(manuelle.jeu, 27);
  assert.ok(manuelle.jeu.pause instanceof J.Pause);
  assert.strictEqual(manuelle.parent.pause_mc.link, auto.parent.pause_mc.link, 'le même écran que la touche');
});

test('pause automatique : ni hors partie, ni partie finie, ni deux fois', () => {
  const p = partiePause({ game_over_flag: true });
  p.client.onPause();
  assert.strictEqual(p.jeu.pause, null, 'partie finie : rien');
  // L'intro, le menu, un chargement, une transition, un écran de fin : le
  // mode courant n'est pas une partie, et il continue.
  const q = partiePause();
  J.Manager.mode = Object.create(J.GameOver.prototype);
  assert.doesNotThrow(() => q.client.onPause());
  assert.strictEqual(q.jeu.pause, null, 'écran de fin : rien');
  J.Manager.mode = null;
  assert.doesNotThrow(() => q.client.onPause());
  // Déjà en pause : la même pause.
  const r = partiePause();
  r.client.onPause();
  const pause = r.jeu.pause;
  r.client.onPause();
  assert.strictEqual(r.jeu.pause, pause, 'pas de seconde pause');
});

test('pause automatique : pendant un défilement de salle ou une chute, elle attend la fin, comme ÉCHAP', () => {
  for (const [nom, etat, finir] of [
    ['défilement', { scroll_on: true }, (jeu) => { jeu.scroll_on = false; }],
    ['chute dans un trou', null, (jeu) => { jeu.ball.hole_death = false; jeu.ball.update_hole = () => false; }],
  ]) {
    const p = partiePause(etat);
    if (!etat) { p.jeu.ball.hole_death = true; p.jeu.ball.update_hole = () => true; }
    p.jeu.level.interf.scroll_room = () => {};
    p.client.onPause();
    assert.strictEqual(p.jeu.pause, null, nom + ' : pas tout de suite');
    p.client.forcePause = false;                 // même si la fenêtre est déjà revenue
    imageMb2(p.jeu);
    assert.strictEqual(p.jeu.pause, null, nom + ' : toujours pas');
    finir(p.jeu);
    imageMb2(p.jeu);
    assert.ok(p.jeu.pause instanceof J.Pause, nom + ' : la pause se pose à la fin');
  }
});

test('pause automatique : rien ne reprend tout seul ; ÉCHAP relance dès que forcePause retombe', () => {
  const p = partiePause();
  p.client.forcePause = true;
  p.client.onPause();
  for (let i = 0; i < 5; i++) imageMb2(p.jeu);
  assert.ok(p.jeu.pause, 'la pause tient');
  imageMb2(p.jeu, 27);
  assert.ok(p.jeu.pause, 'forcePause levé : ÉCHAP ne relance pas (Pause.main d\'époque)');
  p.client.forcePause = false;
  imageMb2(p.jeu);
  imageMb2(p.jeu, 27);
  assert.strictEqual(p.jeu.pause, null, 'la fenêtre revenue, ÉCHAP relance');
  assert.ok(!p.parent.pause_mc, 'l\'écran de pause s\'en va');
  imageMb2(p.jeu);
  assert.strictEqual(p.jeu.pause, null, 'et la partie repart pour de bon');
});

// Le script de index.html, rejoué dans un bac à sable avec les vraies classes.
function pageMb2() {
  const vm = require('node:vm');
  const html = lire('public/mb2/index.html');
  const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('demarrerMotionBall('));
  assert.ok(src, 'le script de démarrage de la page');
  const ecouteurs = { window: {}, document: {} };
  const ecouter = (cible) => (type, fn) => { (ecouteurs[cible][type] = ecouteurs[cible][type] || []).push(fn); };
  const element = { clientWidth: 610, clientHeight: 410, style: {}, getBoundingClientRect: () => ({ width: 610, height: 410 }), focus() {}, remove() {} };
  const bac = {
    KalugaMoteur: K, Mb2Jeu: J, URLSearchParams, console,
    location: { search: '' }, devicePixelRatio: 1,
    addEventListener: ecouter('window'),
    demarrerMotionBall: () => new Promise(() => {}),
    document: { hidden: false, getElementById: () => element, querySelectorAll: () => [], addEventListener: ecouter('document') },
  };
  bac.window = bac;
  vm.createContext(bac);
  vm.runInContext(src, bac, { filename: 'mb2/index.html' });
  return { bac, emettre: (cible, type) => { for (const fn of ecouteurs[cible][type] || []) fn({ type }); } };
}

test('pause automatique, la page : blur, onglet caché et __relacherCommandes pausent la partie et lâchent les commandes', () => {
  for (const [nom, declencher] of [
    ['blur', (pg) => pg.emettre('window', 'blur')],
    ['visibilitychange caché', (pg) => { pg.bac.document.hidden = true; pg.emettre('document', 'visibilitychange'); }],
    ['__relacherCommandes (onglet du light quitté)', (pg) => pg.bac.__relacherCommandes()],
  ]) {
    const p = partiePause();
    const pg = pageMb2();
    K.Key.presser(37);
    declencher(pg);
    assert.ok(p.jeu.pause instanceof J.Pause, nom + ' : la partie est en pause');
    assert.strictEqual(p.client.forcePause, true, nom + ' : forcePause levé');
    assert.ok(!K.Key.isDown(37), nom + ' : les commandes sont lâchées');
  }
  // Retour (focus, clic, touche) : forcePause retombe, la pause reste.
  for (const retour of ['focus', 'pointerdown', 'keydown']) {
    const p = partiePause();
    const pg = pageMb2();
    pg.emettre('window', 'blur');
    pg.emettre('window', retour);
    assert.strictEqual(p.client.forcePause, false, retour + ' : forcePause retombe');
    assert.ok(p.jeu.pause, retour + ' : la partie reste en pause');
  }
  // Dans le menu : rien en pause. Avant l'init du Manager : rien ne casse.
  partiePause();
  J.Manager.mode = Object.create(J.Menu.prototype);
  const pg = pageMb2();
  assert.doesNotThrow(() => pg.emettre('window', 'blur'));
  J.Manager.client = null;
  assert.doesNotThrow(() => { pg.emettre('window', 'blur'); pg.emettre('window', 'focus'); });
  J.Manager.mode = null;
});
