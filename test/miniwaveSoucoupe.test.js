/*
 * Retours de joueur sur Mini-Wave light — quatre écarts avec le Flash.
 *
 * 1. LA SOUCOUPE NE PASSAIT PLUS. Le tirage est 1 sur 3 + 3^(n+1), donc une
 *    chance sur six au premier passage, sur douze au deuxième, sur trente au
 *    troisième… game/Main.initLevel remet ce compteur à ZÉRO à chaque niveau ;
 *    le portage ne le faisait pas, et après trois ou quatre soucoupes on
 *    tombait à une chance sur sept cents. « Quasi nulle », disait le rapport,
 *    « contre quasi une par niveau sur le Flash ».
 *
 * 2. SON BOURDONNEMENT NE S'ARRÊTAIT PLUS. sp/Saucer.kill coupe la boucle quoi
 *    qu'il arrive ; le portage ne la coupait qu'à l'explosion. Une soucoupe
 *    LOUPÉE laissait donc son son tourner jusqu'à la fin de la partie.
 *
 * 3. LE VAISSEAU SCINTILLAIT EN PERMANENCE. sp/Hero.init appelle `stop()` : la
 *    coque est figée sur sa première image. Le Tequila — le vaisseau de départ,
 *    celui que tout le monde pilote en arcade — porte douze images sur sa ligne
 *    de temps, que le portage déroulait en boucle.
 *
 * 4. LE CLAVIER NE RÉPONDAIT PAS SUR /light. Le jeu y tourne dans une iframe,
 *    et le pilotage au pointeur appelle preventDefault() sur pointerdown — ce
 *    qui annule aussi le transfert de focus. Les touches partaient à la page
 *    parente.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));
const ARCADE = NIVEAUX.main[0].levels;

// ── 1 · La soucoupe repasse à chaque niveau ───────────────────────────────

test('le compteur de soucoupes repart de zéro à chaque niveau', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 3 });
  jeu.saucerCompt = 5;                     // comme après cinq passages
  jeu.initLevel();
  assert.equal(jeu.saucerCompt, 0, 'game/Main.initLevel remet le compteur à zéro');
  assert.equal(jeu.eventTimer, 100, 'et rearme l\'horloge des événements');
});

test('la chance de voir passer une soucoupe reste jouable de niveau en niveau', () => {
  // Sans la remise à zéro, la probabilité s'effondre : 1/6, 1/12, 1/30, 1/84…
  // On mesure la borne du tirage telle que le moteur la calcule.
  const borne = (n) => 3 + Math.pow(3, n + 1);
  assert.equal(borne(0), 6, 'premier passage : une chance sur six');
  assert.equal(borne(5), 732, 'sixième : une sur sept cent trente-deux');

  // Le niveau remis à neuf revient donc toujours à la première marche.
  const jeu = new E.Game({ levels: ARCADE, graine: 3 });
  for (let n = 0; n < 6; n++) jeu.genSaucer();
  assert.equal(jeu.saucerCompt, 6, 'six soucoupes vues');
  jeu.initLevel();
  assert.equal(borne(jeu.saucerCompt), 6, 'le niveau suivant repart à une chance sur six');
});

// ── 2 · Le son s'arrête quand la soucoupe s'en va ─────────────────────────

test('une soucoupe LOUPÉE annonce sa disparition', () => {
  // C'est le cas du rapport : elle traverse, on la rate, elle sort par le bord.
  const vus = [];
  const jeu = new E.Game({ levels: ARCADE, graine: 3, onEvent: (n, d) => vus.push(n) });
  const s = jeu.genSaucer();
  assert.ok(vus.indexOf('soucoupe') >= 0, 'son arrivée lance la boucle sonore');

  // On la pousse hors cadre sans jamais la toucher.
  let images = 0;
  while (jeu.saucerList.length && images < 5000) { s.update(1); images++; }
  assert.equal(jeu.saucerList.length, 0, 'elle a quitté l\'écran');
  assert.ok(vus.indexOf('soucoupeExplose') < 0, 'sans avoir été abattue');
  assert.ok(vus.indexOf('soucoupeFin') >= 0,
    'et elle annonce sa disparition — c\'est ce qui coupe le son');
});

test('une soucoupe ABATTUE l\'annonce aussi', () => {
  const vus = [];
  const jeu = new E.Game({ levels: ARCADE, graine: 3, onEvent: (n, d) => vus.push(n) });
  const s = jeu.genSaucer();
  s.exploser();
  assert.ok(vus.indexOf('soucoupeExplose') >= 0, 'la détonation');
  assert.ok(vus.indexOf('soucoupeFin') >= 0, 'et la fin de la boucle');
  assert.equal(jeu.saucerList.length, 0);
});

test('le son de la soucoupe se coupe sur sa disparition, pas seulement sur l\'explosion', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/sons.js'), 'utf8');
  assert.match(src, /case 'soucoupeFin': this\.arreter\(CANAL\.soucoupe\);/,
    'sons.js écoute la disparition');
});

// ── 3 · La coque ne s'anime pas ───────────────────────────────────────────

test('la coque du vaisseau est figée, comme le stop() de Hero.init', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  const bloc = /dessinerHero\(ctx, h\) \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(bloc, 'la méthode dessinerHero existe');
  assert.doesNotMatch(bloc[0], /etatIdx = Math\.floor\(this\.animT\)/,
    'la coque ne déroule plus ses images');

  // Le Tequila EST le cas à surveiller : douze images sur sa ligne de temps.
  // Si un jour on ré-anime la coque, c'est lui qui scintillera à nouveau.
  const sprites = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/miniwave/sprites/sprites.json'), 'utf8'));
  assert.equal(sprites.hero0.etats.length, 12,
    'le vaisseau de départ porte bien douze images — figées');

  // L'image « fissurée » des vaisseaux à deux points de vie, elle, reste.
  assert.match(bloc[0], /fiche\.hp === 2 && sp\.etats\.length >= 2/,
    'le Pastaga et le Cherry gardent leur coque fissurée à un point de vie');
});

// ── 4 · Le clavier reprend le focus ───────────────────────────────────────

test('le jeu réclame le focus au premier appui — sinon l\'iframe reste sourde', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(src, /window\.focus\(\)/, 'le jeu appelle window.focus()');
  assert.match(src, /for \(const ev of \['pointerdown', 'touchstart', 'mousedown'\]\)/,
    'sur les trois familles d\'appui');
  assert.match(src, /capture: true/, 'en capture — avant tout preventDefault');
});

test('/light donne le focus au cadre du jeu quand on ouvre son onglet', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(src, /function donnerFocusAuJeu\(tab\)/, 'la fonction existe');
  assert.match(src, /donnerFocusAuJeu\(tab\);/, 'et activateTab l\'appelle');
  assert.match(src, /miniwave: "#miniwave-frame"/, 'Mini-Wave y figure');
  assert.match(src, /contentWindow\.focus\(\)/, 'elle vise la fenêtre du cadre');
});

// ── 5 · Le tuyau du bureau porte enfin le score d'arcade ──────────────────
//
// « les parties jouées sur le flash ne s'enregistrent pas » : le SWF n'appelle
// pas saveScore (tout le bloc SCORE de class/miniwave/Client.as est commenté),
// et le seul canal qui sortait de lui — le tuyau à sept champs que notre patch
// injecte pour contourner Ruffle — portait le NIVEAU atteint, jamais les
// points. Le record restait donc enfermé dans le jeu.

test('le tuyau du SWF porte le meilleur score d\'arcade', () => {
  const P = require(path.join(ROOT, 'public/miniwave/plateforme.js'));
  const c = P.carteNeuve();
  c.$arcade.$bestScore = 31000;
  c.$arcade.$bestLevel = 24;
  const champs = P.versTuyau(c).split('|');
  assert.equal(champs.length, 8, 'huit champs, pas sept');
  assert.equal(champs[2], '24', 'le niveau reste à sa place');
  assert.equal(champs[7], '31000', 'et le score ferme la marche');
});

test('le bytecode injecté dans le SWF émet bien $arcade.$bestScore', () => {
  // C'est le patch qui fabrique le tuyau : si la ligne saute, tout le reste
  // devient silencieusement inutile. On lit le SWF livré, pas le script.
  const zlib = require('node:zlib');
  const raw = fs.readFileSync(path.join(ROOT, 'Games/miniWave2/miniwave.swf'));
  const corps = raw.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  const texte = corps.toString('latin1');
  assert.ok(texte.indexOf('$bestScore') >= 0, '« $bestScore » figure dans le SWF patché');
  assert.ok(texte.indexOf('slot:miniwave:') >= 0, 'et le canal de sauvegarde est bien là');
});

test('un vieux client à sept champs ne remet pas le record à zéro', () => {
  // Le SWF relit sa fiche depuis le SharedObject LOCAL : sans garde, une visite
  // au bureau avec un cache en retard ferait redescendre le record.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const bloc = /function miniwaveGreffeHorsTuyau[\s\S]*?\n\}/.exec(src);
  assert.ok(bloc, 'la regreffe existe');
  assert.match(bloc[0], /Math\.max\(Number\(prev\.\$arcade\.\$bestScore\)/,
    'le record garde toujours la plus grande des deux valeurs');
  assert.match(bloc[0], /neuf\.\$arcade\.\$bestScore === undefined\)\s*\n?\s*\? prev\.\$arcade\.\$bestScore/,
    'et un tuyau à sept champs se voit regreffer l\'ancien');
});
