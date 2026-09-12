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
