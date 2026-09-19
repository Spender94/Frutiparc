/*
 * BURNING KIWI — LE PORTAGE (public/bkiwi/), ce qui se vérifie sans navigateur.
 *
 *   · la BIBLIOTHÈQUE extraite est celle du SWF : 350×350 à 40 images par
 *     seconde, la racine pose « main » (sprite 637, trois images : le code,
 *     main(), le retour) ;
 *   · les SCRIPTS D'IMAGE et de BOUTON : chaque DoAction / DefineButton2
 *     relevé par l'extracteur (jeu, intro) a sa transcription ;
 *   · le TIMER de secours (timer.as, _global.gtmod) : à 40 images par seconde
 *     gtmod converge vers 25/32 — c'est lui qui rend la physique
 *     indépendante de la cadence, et les sensations celles du disque ;
 *   · les DONNÉES (gameData.as compilé) : les cinq voitures, les constantes de
 *     la physique, les 218 checkpoints, le demoLabel du fichier compilé ;
 *   · le PONT Frutiparc : les slots (Infinity ↔ 9999999), le score par
 *     circuit, le quota de FD (challenge / essais), la course du jour ;
 *   · le CATALOGUE et le light : le disque bkiwilight, l'onglet, le bureau.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

globalThis.window = undefined;
for (const f of ['public/kaluga/moteur/formes.js', 'public/kaluga/moteur/flash.js', 'public/kaluga/moteur/texte.js',
  'public/bkiwi/jeu/scripts-images.js', 'public/bkiwi/jeu/biblio.js',
  'public/bkiwi/jeu/donnees.js', 'public/bkiwi/jeu/moteur.js', 'public/bkiwi/jeu/menu.js', 'public/bkiwi/jeu/final.js',
  'public/bkiwi/plateforme.js']) {
  require(path.join(ROOT, f));
}
const K = globalThis.KalugaMoteur;
const J = globalThis.BkiwiJeu;
const BIBLIOS = ['bkiwi', 'intro', 'track00', 'track01', 'track02', 'track03', 'track04', 'track05', 'track99'];
const biblio = JSON.parse(lire('public/bkiwi/data/bkiwi.json'));

// ── La bibliothèque et les scripts ────────────────────────────────────────

test('la bibliothèque est celle du SWF : 350×350 à 40 images par seconde, la racine pose « main » (637)', () => {
  assert.deepStrictEqual([biblio.entete.l, biblio.entete.h, biblio.entete.cadence], [350, 350, 40]);
  const racine = biblio.perso[0];
  assert.strictEqual(racine.frames.length, 5, 'cinq images : amorce, préchargeur, holder, main');
  assert.strictEqual(racine.frames[4].lab, 'main');
  const main = racine.frames[4].ops.find((op) => op.n === 'main');
  assert.ok(main && main.c === 637, 'le clip principal est le sprite 637');
  assert.strictEqual(biblio.perso[637].frames.length, 3, 'trois images : code + init, main(), retour');
  assert.strictEqual(biblio.perso[637].frames[0].lab, 'initMain');
  // Les neuf sons embarqués, les dix fontes, les circuits et l'intro.
  for (const s of J.SONS || ['buttonCancel', 'buttonOk', 'buttonSwitch', 'kiwiPickUp', 'loseLifeSound', 'buttonRefuse', 'buttonKeys', 'buttonKeysOk', 'gameOverSound']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/bkiwi/sons', s + '.mp3')), 'son manquant : ' + s);
  }
  // quatorze fontes déclarées, dix avec leurs glyphes (les autres sont des polices système)
  assert.strictEqual(Object.values(biblio.fontes).filter((f) => f.fichier).length, 10);
  for (const b of BIBLIOS) assert.ok(fs.existsSync(path.join(ROOT, 'public/bkiwi/data', b + '.json')), b);
  for (let t = 0; t < 6; t++) {
    const tr = JSON.parse(lire('public/bkiwi/data/track0' + t + '.json'));
    const sub = tr.perso[0].frames[0].ops.find((o) => o.n === 'sub');
    assert.ok(sub, 'track0' + t + ' : le clip sub');
    const noms = new Set();
    for (const f of tr.perso[String(sub.c)].frames) for (const o of f.ops) if (o.n) noms.add(o.n);
    for (const z of ['startZone', 'borderZone', 'outZone']) assert.ok(noms.has(z), 'track0' + t + ' : ' + z);
    if (t === 4) assert.ok(noms.has('labZone'), 'le laboratoire de Kiwix est sur Jupiter IV');
  }
});

test('chaque script d\'image et de bouton relevé dans le jeu et l\'intro a sa transcription', () => {
  const cles = new Set();
  for (const nom of BIBLIOS) {
    const d = JSON.parse(lire('public/bkiwi/data/' + nom + '.json'));
    for (const p of Object.values(d.perso)) {
      if (p.t === 'clip') for (const f of p.frames) if (f.a) cles.add(f.a);
      if (p.t === 'bouton' && p.a) cles.add(p.a);
    }
  }
  assert.strictEqual(cles.size, 104, '91 scripts d\'image du jeu et de l\'intro, 13 boutons');
  const images = [...cles].filter((c) => !/:btn:/.test(c));
  const boutons = [...cles].filter((c) => /:btn:/.test(c));
  assert.deepStrictEqual(images.filter((c) => typeof K.scriptsImages[c] !== 'function'), [], 'scripts d\'image non portés');
  assert.deepStrictEqual(boutons.filter((c) => !K.scriptsBoutons[c] || !Object.keys(K.scriptsBoutons[c]).length), [], 'boutons non portés');
  // Les circuits n'ont aucun script : ce sont des dessins.
  assert.ok(!images.some((c) => /^track/.test(c)));
  // Le clip principal : le code puis init(), main() à chaque image, le retour.
  assert.match(String(K.scriptsImages['bkiwi:637:1']), /J\.initialiserDonnees\(this\);[\s\S]*J\.installerMoteur\(this\);[\s\S]*J\.init\(\);/);
  assert.match(String(K.scriptsImages['bkiwi:637:2']), /J\.main\(\)/);
});

test('le bouton du menu appelle onPush / onOver / onOut sur le clip qui le porte, et la fin lit onEnd', () => {
  const appels = [];
  const mc = { onPush: () => appels.push('push'), onOver: () => appels.push('over'), onOut: () => appels.push('out'), onEnd: () => appels.push('end'),
    id: 140, _parent: { vs: { menuPhase: -1 } }, stop() { appels.push('stop'); } };
  K.scriptsBoutons['bkiwi:btn:165'].release.call(mc);
  K.scriptsBoutons['bkiwi:btn:165'].rollOver.call(mc);
  K.scriptsBoutons['bkiwi:btn:165'].rollOut.call(mc);
  assert.deepStrictEqual(appels, ['push', 'over', 'out']);
  assert.strictEqual(mc.pushed, true);
  K.scriptsImages['bkiwi:166:12'].call(mc);
  assert.deepStrictEqual(appels.slice(3), ['stop', 'end']);
  assert.strictEqual(mc._parent.vs.menuPhase, 140, 'la fin de l\'anim pose la phase du menu');
  assert.strictEqual(mc.kill, true);
  // Les touches à redéfinir : _parent._parent.keyAsked = i
  const manager = { _parent: { _parent: {} } };
  K.scriptsBoutons['bkiwi:btn:564'].release.call(manager);
  assert.strictEqual(manager._parent._parent.keyAsked, 2);
});

test('les attentes au compteur se soustraient gtmod et bouclent sur l\'image précédente', () => {
  J.G.gtmod = 0.5;
  const sauts = [];
  const clip = { _parent: { popUpDuration: 1.2 }, _currentframe: 10, gotoAndPlay: (f) => sauts.push(f), stop() {}, removeMovieClip() { sauts.push('rm'); } };
  K.scriptsImages['bkiwi:123:8'].call(clip);
  assert.strictEqual(clip.cpt, 1.2);
  K.scriptsImages['bkiwi:123:10'].call(clip);   // 0,7 → on reboucle
  K.scriptsImages['bkiwi:123:10'].call(clip);   // 0,2 → on reboucle
  K.scriptsImages['bkiwi:123:10'].call(clip);   // −0,3 → on passe
  assert.deepStrictEqual(sauts, [9, 9]);
  K.scriptsImages['bkiwi:123:20'].call(clip);
  assert.deepStrictEqual(sauts, [9, 9, 'rm']);
});

// ── Le timer de secours ───────────────────────────────────────────────────

test('gtmod : initTimer(32) part de 1 et mainTimer() converge vers 25/32 à 40 images par seconde', () => {
  const M = {};
  let horloge = 0;
  const vrai = K.getTimer;
  K.getTimer = () => horloge;
  try {
    J.initTimer(M, 32);
    assert.strictEqual(J.G.gtmod, 1);
    assert.strictEqual(M.timerOptimalFPS, 32);
    assert.strictEqual(M.timerConstant, 32 / 1000);
    // main() appelle mainTimer() sans argument : la moyenne 0,97 / 0,03
    for (let i = 0; i < 400; i++) { horloge += 25; J.mainTimer(M); }
    assert.ok(Math.abs(J.G.gtmod - 25 / 32) < 1e-4, 'gtmod = ' + J.G.gtmod);
    // averageTimer === false : la valeur brute de l'image
    horloge += 50; J.mainTimer(M, false);
    assert.strictEqual(J.G.gtmod, 50 / 32);
    // randomT : random(round(n / gtmod))
    J.G.gtmod = 0.5;
    for (let i = 0; i < 50; i++) { const r = J.randomT(3); assert.ok(r >= 0 && r < 6 && Number.isInteger(r)); }
  } finally { K.getTimer = vrai; J.G.gtmod = 1; }
});

// ── Les données ───────────────────────────────────────────────────────────

test('gameData compilé : les cinq voitures, la physique, 218 checkpoints, le demoLabel du fichier', () => {
  const M = {};
  J.initialiserDonnees(M);
  assert.deepStrictEqual(M.carStats.map((c) => [c.accel, c.maxSpeed, c.grip, c.rot]),
    [[1.4, 16.2, 0.35, 8.2], [1.8, 13, 0.36, 8.75], [1.5, 10, 0.7, 9], [1, 14, 0.55, 8.6], [1.7, 12, 0.34, 8.9]]);
  assert.deepStrictEqual([M.roadFriction, M.stepMax, M.borderMaxSpeed, M.borderMaxAccelSpeed, M.baseNitroTimer, M.nitroMaxSpeed, M.normalFPS],
    [0.99, 9, 3, 1.5, 60, 18, 32]);
  assert.strictEqual(M.nbTracks, 6);
  assert.strictEqual(M.tracks.length, 100, 'tracks[99] est le tutorial : un tableau creux');
  assert.deepStrictEqual(M.tracks.map((t, i) => (t ? i : null)).filter((i) => i !== null), [0, 1, 2, 3, 4, 5, 99]);
  const cp = [0, 1, 2, 3, 4, 5, 99].reduce((n, t) => n + M.CP[t].length, 0);
  assert.strictEqual(cp, 218, 'les checkpoints des six circuits et du tutorial');
  assert.strictEqual([0, 1, 2, 3, 4, 5].reduce((n, t) => n + M.CP[t].length, 0), 212);
  assert.deepStrictEqual(M.CP[0][0], { x: 454, y: 592, ang: -68, dist: 50, maxSpeed: 99 });
  assert.strictEqual(M.demoLabel, 'PAS ENCORE DEBLOQUE', 'le fichier compilé, pas la source');
  assert.deepStrictEqual(M.defaultControls, [38, 17, 37, 39, 32]);
  assert.strictEqual(M.DP_FXTOP, 13);
  assert.deepStrictEqual([M.ARCADE, M.TRAINING, M.TUTORIAL], [1, 0, 8].map((v, i) => [M.ARCADE, M.TRAINING, M.TUTORIAL][i]));
  assert.strictEqual(M.controls.length, 5);
});

// ── Le pont Frutiparc ─────────────────────────────────────────────────────

test('les slots : Infinity s\'écrit 9999999 et se relit Infinity, une case absente est un objet vide', () => {
  const C = J.Client;
  const slot0 = C.restaurerInfinis(C.analyserSlot('{"$ws":false,"$ts":[{"$fcLap":9999999,"$fcTotal":61230,"$lapCar":2},{"$fcLap":null}]}'));
  assert.strictEqual(slot0.$ts[0].$fcLap, Infinity);
  assert.strictEqual(slot0.$ts[0].$fcTotal, 61230);
  assert.strictEqual(slot0.$ts[1].$fcLap, Infinity, 'null (JSON.stringify d\'un Infinity nu) redevient Infinity');
  // Une sauvegarde d'avant la rustine : Infinity nu dans le texte
  const vieux = C.restaurerInfinis(C.analyserSlot('{"$ts":[{"$fcLap":Infinity,"$fcTotal":Infinity}]}'));
  assert.strictEqual(vieux.$ts[0].$fcTotal, Infinity);
  assert.strictEqual(C.serialiserSlot({ $ts: [{ $fcLap: Infinity, $fcTotal: 1234 }] }), '{"$ts":[{"$fcLap":9999999,"$fcTotal":1234}]}');
  assert.strictEqual(C.analyserSlot(''), undefined);
  assert.strictEqual(C.analyserSlot('pas du json'), undefined);
  const c = new C('');
  c.slots = [undefined, undefined, undefined];
  c.onServiceConnect();
  assert.deepStrictEqual(c.slots, [{}, {}, {}]);
  assert.strictEqual(c.connected, true);
  assert.strictEqual(c.fl_success, true);
});

test('la session est blanche, et c\'est le quota de FD qui dit « challenge » ou « essais »', () => {
  const c = new J.Client('abc');
  assert.deepStrictEqual([c.isWhite(), c.isBlack(), c.isGray(), c.isGrey(), c.isRed()], [true, false, false, false, false]);
  assert.strictEqual(c.isRanked(), true, 'sans nouvelles du quota, on classe');
  c.fd = { ok: true, limited: true, remaining: 0 };
  assert.strictEqual(c.isRanked(), false);
  c.fd.remaining = 1;
  assert.strictEqual(c.isRanked(), true);
  c.fd = { ok: true, limited: false };
  assert.strictEqual(c.isRanked(), true);
  assert.strictEqual(new J.Client('').isRanked(), false, 'sans session, rien ne se classe');
  // checkMode, dans le moteur : ARCADE suit isRanked (ou la course accordée), TRAINING son contraire
  const moteur = lire('public/bkiwi/jeu/moteur.js');
  assert.match(moteur, /if \(mode == M\.ARCADE\) return !!\(c\.gameRunning \|\| \(typeof c\.isRanked === 'function' && c\.isRanked\(\)\)\);/);
  assert.match(moteur, /if \(mode == M\.TRAINING\) return !\(typeof c\.isRanked === 'function' && c\.isRanked\(\)\);/);
  // Les fichiers du disque : l'intro et les circuits sont nos bibliothèques, les musiques celles du disque Flash
  assert.deepStrictEqual(c.getFileInfos('track04.swf'), { name: '/bkiwi/data/track04.json', size: 0 });
  assert.deepStrictEqual(c.getFileInfos('bk04.mp3'), { name: '/swf/games/burningKiwi/bk04.mp3', size: 0 });
  assert.match(lire('public/bkiwi/jeu/menu.js'), /\/\\btrk="\(\\d\+\)"\/\.exec\(String\(client\(\)\.dailyData \|\| ''\)\)/, 'la course du jour se lit dans <daily trk="N"/>');
});

test('le score part avec le circuit et le mode, le claim de FD avec le mode ; le serveur en fait la part', () => {
  const P = lire('public/bkiwi/plateforme.js');
  assert.match(P, /fetch\('\/do\/fdclaim'/);
  assert.match(P, /game: 'bkiwi', track: String\(track\), mode: String\(mode\)/);
  assert.match(P, /if \(\/\^ok=0\/\.test\(texte\)\) \{[\s\S]*?this\.onError\(\);/, 'un refus de FD ramène au menu (client.error)');
  assert.match(P, /fetch\('\/api\/saveScore\?' \+ p\.toString\(\)\)/);
  assert.match(P, /track: String\(track\), gm: String\(mode\),/);
  assert.match(P, /game: 'bkiwi', slotId: String\(n\), data: serialiserSlot\(donnees\)/);
  const S = lire('server.js');
  assert.match(S, /app\.get\('\/api\/bkiwi\/daily', \(req, res\) => \{\s*\n\s*res\.json\(\{ ok: true, trk: getBkiwiDailyTrack\(\) \}\);/);
  assert.match(S, /if \(Number\.isInteger\(bkiwiTrackParam\) && bkiwiTrackParam >= 0 && bkiwiTrackParam <= 5 && users\[username\]\) \{\s*\n\s*users\[username\]\.bkiwiCurrentTrack = bkiwiTrackParam;/);
  assert.match(S, /if \(params\.gm !== undefined && params\.gm !== '' && Number\(params\.gm\) !== 1\) \{\s*\n\s*extraRankingId = null;/,
    'seul le Challenge (ARCADE = 1) alimente la cuve du jour');
});

test('le catalogue : le disque light de Burning Kiwi, l\'onglet du light, la fenêtre du bureau', () => {
  const S = lire('server.js');
  assert.match(S, /bkiwilight: \{\s*discType: '0',\s*playMode: 'single',\s*swfName: 'bkiwi',\s*iconName: 'bkiwi',\s*gameId: 'light\/bkiwi',\s*props: 'w=362;h=376;m=p'/);
  const L = lire('public/light.html');
  assert.match(L, /bkiwi: "#bkiwi-frame"/);
  assert.match(L, /bkiwi: "\/bkiwi\/"/);
  assert.match(L, /<iframe id="bkiwi-frame" title="Burning Kiwi"/);
  assert.match(L, /\$\("#bkiwi-panel"\)\.classList\.toggle\("active", tab === "bkiwi"\);/);
  assert.match(L, /\{ tab: "bkiwi", jaquette: "bkiwi", name: "Burning Kiwi" \}/);
  assert.ok(!/flash: "bkiwi"/.test(L), 'Burning Kiwi n\'est plus dans la liste des jeux Flash du light');
  assert.match(lire('public/ruffle.html'), /"light\/bkiwi": \{ url: "\/bkiwi\/", w: 390, h: 410 \}/);
  const B = lire('public/bureau-frutiz.js');
  assert.match(B, /bkiwi:\s*\{ panneau: '#bkiwi-panel',\s*titre: 'Burning Kiwi',\s*l: 362, h: 376 \}/);
  assert.match(B, /bkiwi: 'bkiwi',\n  \};/, 'le FD noir et le disque light ouvrent le portage');
  const page = lire('public/bkiwi/index.html');
  for (const s of ['/kaluga/moteur/flash.js', '/bkiwi/jeu/scripts-images.js', '/bkiwi/jeu/biblio.js', '/bkiwi/jeu/donnees.js',
    '/bkiwi/jeu/moteur.js', '/bkiwi/jeu/menu.js', '/bkiwi/jeu/final.js', '/bkiwi/plateforme.js', '/bkiwi/jeu/principal.js']) {
    assert.ok(page.includes('<script src="' + s + '"></script>'), s);
  }
  assert.match(page, /<script src="\/js\/eject-watch\.js" data-jeu="bkiwi"><\/script>/);
  assert.match(page, /window\.__relacherCommandes = lacherTout;/);
  assert.match(page, /<canvas id="scene" width="350" height="350"/);
});

test('un champ de texte HTML lié à une variable interprète ses balises (le résumé de la FrutiCoupe)', () => {
  const T = lire('public/kaluga/moteur/texte.js');
  assert.match(T, /if \(this\.html\) \{ if \(s !== this\._html\) this\.htmlText = s; \}\s*\n\s*else if \(s !== this\._texte \|\| this\._html\) \{ this\.text = s; \}/);
  assert.match(lire('public/bkiwi/jeu/final.js'), /M\.summary\['car_' \+ i\] = '<P ALIGN="CENTER">' \+ c\.carName \+ '<\/P>';/);
});
