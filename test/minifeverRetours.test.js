/*
 * Mini-Fever — deux retours de joueurs.
 *
 *   « Pour le jeu des pistons, il y a un décalage gênant entre le pointeur de
 *   la souris et les pistons sélectionnés. »
 *
 *   « Le jeu de la photo est devenu trop facile, on peut faire du hors cadre
 *   sans problème. »
 *
 * Le premier tenait à la ZONE d'appui des capsules (la boîte de la fenêtre
 * entière, 17 px de vide au-dessus du tube visible), pas à la souris : on la
 * vérifie donc de bout en bout — de la position écran, à deux échelles
 * d'affichage, jusqu'à la case teintée. Le second à une règle relâchée au
 * seul centre du poisson : on revient à celle d'époque, plus le poisson
 * entier dans le cadre.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/minifever/engine.js'));
const C = require(path.join(ROOT, 'public/minifever/client.js'));
const J = require(path.join(ROOT, 'public/minifever/jeux.js'));

const MANIFESTE = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/minifever/sprites/sprites.json'), 'utf8'));
const MESURES = C.mesures(MANIFESTE);

/** Un tirage figé : la même suite à chaque exécution. */
function dé(graine) {
  let x = graine || 1;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

/** Un socle nu qui ne joue qu'une épreuve. */
function banc(Classe, o) {
  o = o || {};
  const socle = new E.Socle({
    mesures: MESURES,
    catalogue: [{ cle: 'test', nom: 'test', Classe }],
    rng: dé(o.graine || 7),
  });
  socle.dif = o.dif || 0;
  socle.tirer();
  socle.lancer();
  return {
    socle,
    get jeu() { return socle.jeu; },
    souris(x, y) { socle.bouger(x, y); },
    avancer(n) { for (let i = 0; i < (n || 1); i++) socle.update(1); },
  };
}

/**
 * Un client posé sur une toile FACTICE, affichée à `cote` px de côté en
 * (gauche, haut) de la fenêtre, à la densité `densite` : ce que
 * getBoundingClientRect() rend au navigateur. Il sert à traduire une position
 * d'écran en position de scène (Client.versScene), comme à la souris.
 */
function ecran(cote, gauche, haut, densite) {
  const c = Object.create(C.Client.prototype);
  c.canvas = {
    width: Math.round(240 * (cote / 240) * densite), height: Math.round(240 * (cote / 240) * densite),
    getBoundingClientRect: () => ({ left: gauche, top: haut, width: cote, height: cote }),
  };
  c.echelle = cote / 240;
  return {
    echelle: c.echelle,
    // La position d'écran d'un point de scène, et son retour en scène.
    versEcran: (x, y) => ({ clientX: gauche + x * cote / 240, clientY: haut + y * cote / 240 }),
    versScene: (ev) => c.versScene(ev),
  };
}

/** La case d'une grille de Tubulo, nommée « x,y » (ou « aucune »). */
function nomCase(j, slot) {
  for (let x = 0; x < j.xMax; x++) {
    for (let y = 0; y < j.yMax; y++) if (j.grille[x][y] === slot) return x + ',' + y;
  }
  return 'aucune';
}

// ── LES PISTONS ──

/*
 * La grille est isométrique : (0,0) en (120,80), +x = (+20,+16), +y = (−20,+16).
 * Le piston d'une case, c'est son tube découpé par sa fenêtre : à l'échelle
 * 0,4, de 42 px au-dessus de l'ancre à 11 px en dessous, 40 px de large, le
 * haut arrondi (le sommet du tube), le bas aussi (le fond de la fenêtre). La
 * case du dessous — (1,1) pour (0,0), 32 px plus bas — est posée APRÈS et
 * passe devant là où les deux se recouvrent (de −10 à +11), comme dans le
 * lecteur.
 */
test('PISTONS : le piston sous la souris est celui qu\'on VOIT, à deux échelles d\'affichage', () => {
  // Un bureau (la scène à 480 px, densité 1) et un téléphone (360 px, densité 2),
  // la toile posée ailleurs qu'en haut à gauche de la fenêtre.
  for (const e of [ecran(480, 37, 23, 1), ecran(360, 10, 50, 2)]) {
    const b = banc(J.Tubulo, { dif: 0 });
    const j = b.jeu;
    assert.deepEqual([j.grille[0][0].x, j.grille[0][0].y], [120, 80]);
    const survol = (x, y) => {
      const p = e.versScene(e.versEcran(x, y));
      // La position revient dans le repère de la scène, au poil près.
      assert.ok(Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6, 'versScene (' + x + ',' + y + ')');
      b.souris(p.x, p.y);
      b.avancer(1);
      return nomCase(j, j.survole);
    };
    const ou = 'échelle ' + e.echelle + ' : ';
    // Le corps du piston (0,0), du sommet du tube (y 38) au haut de (1,1) (y 70).
    assert.equal(survol(120, 45), '0,0', ou + 'près du sommet du tube');
    assert.equal(survol(120, 60), '0,0', ou + 'au milieu du piston — c\'était (1,1), 32 px plus bas');
    assert.equal(survol(120, 68), '0,0', ou + 'juste au-dessus du tube de (1,1)');
    // Là où (1,1) recouvre (0,0), c'est (1,1) — posée devant, comme Flash.
    assert.equal(survol(120, 75), '1,1', ou + 'dans le recouvrement, la case devant');
    assert.equal(survol(120, 88), '1,1', ou + 'sur le piston de (1,1) — c\'était (2,2)');
    assert.equal(survol(120, 110), '2,2', ou + 'sur le piston de (2,2)');
    // Les voisines en diagonale : (1,0) en (140,96), (0,1) en (100,96).
    assert.equal(survol(140, 76), '1,0', ou + 'le piston de (1,0) — c\'était (2,1)');
    assert.equal(survol(100, 76), '0,1', ou + 'le piston de (0,1) — c\'était (1,2)');
    // Au-dessus du sommet du tube, il n'y a RIEN de dessiné : la fenêtre y est
    // vide, et le lecteur n'y donnait pas la souris.
    assert.equal(survol(120, 30), 'aucune', ou + 'le vide au-dessus du piston (0,0) n\'appartient à personne');
    // Le coin carré de la boîte, hors de l'arrondi du sommet.
    assert.equal(survol(138, 40), 'aucune', ou + 'hors de l\'arrondi du sommet');
    // Entre deux colonnes, à côté des capsules.
    assert.equal(survol(120, 78), '1,1', ou + 'le centre de la colonne, sur (1,1)');
    // Et la croix teintée suit : (0,0) blanchit, (1,1) non.
    survol(120, 60);
    b.avancer(8);
    assert.ok(j.grille[0][0].mc.blanchi > 0.1, ou + 'la croix de (0,0) blanchit');
    // (2,2), survolée plus haut, s'éteint (rollOut 100) ; (3,0), jamais dans
    // une croix survolée, n'a pas bougé.
    assert.ok(j.grille[2][2].mc.blanchi < j.grille[0][0].mc.blanchi, ou + '(2,2), hors de la croix de (0,0), s\'éteint');
    assert.equal(j.grille[3][0].tp, null, ou + '(3,0) n\'a jamais été teintée');
  }
});

test('PISTONS : l\'appui plonge la croix du piston sous le curseur, pas celle du dessous', () => {
  const e = ecran(360, 10, 50, 2);
  const b = banc(J.Tubulo, { dif: 0 });
  const j = b.jeu;
  const p = e.versScene(e.versEcran(120, 60));
  b.souris(p.x, p.y);
  b.socle.click();
  assert.equal(j.etape, 2, 'la plongée commence');
  assert.ok(j.plongeurs.includes(j.grille[0][0]), 'la case (0,0) mène la croix');
  assert.ok(!j.plongeurs.includes(j.grille[2][2]), '(2,2) — la croix de (1,1) — ne bouge pas');
  b.socle.relache();
});

test('PISTONS : la zone d\'appui suit le tube qui plonge', () => {
  const b = banc(J.Tubulo, { dif: 0 });
  const j = b.jeu;
  const s = j.grille[0][0];
  assert.ok(j.pistonVisible(s, 120, 45), 'au repos, le sommet du tube est à y 38');
  // Le tube descend de 20 px dans sa fenêtre : son sommet aussi.
  s.mc.y = s.y + 20;
  assert.ok(!j.pistonVisible(s, 120, 45), 'plongé, le haut de la fenêtre est vide');
  assert.ok(j.pistonVisible(s, 120, 70), 'et le tube est plus bas');
  assert.ok(!j.pistonVisible(s, 120, 92), 'sans jamais dépasser le fond de la fenêtre');
});

// ── LA PHOTO ──

/*
 * Le poisson (sym180) fait 54 × 11 ; le cadre, à difficulté nulle, 100 de
 * côté (sym163, ±50). La règle d'époque : « setWin(distance<size*0.3) ». Le
 * poisson entier dans le cadre réussit aussi — c'est ce que l'œil appelle
 * une photo cadrée.
 */
function cliche(decalX, decalY, rotCadre, rotPoisson) {
  const b = banc(J.JumpFish, { dif: 0 });
  const j = b.jeu;
  b.socle.timer = 99;
  b.avancer(1);                       // le saut est certain sous 100 au chrono
  assert.equal(j.etape, 2);
  j.poisson.peau.rot = rotPoisson || 0;
  j.cadre.x = j.poisson.x - decalX;
  j.cadre.y = j.poisson.y - decalY;
  j.cadre.peau.rot = rotCadre || 0;
  b.souris(j.cadre.x, j.cadre.y);     // le cadre ne bouge plus d'ici l'appui
  j.photographier();
  b.avancer(60);
  return j.gagnant;
}

test('PHOTO : la photo cadrée est validée', () => {
  assert.equal(cliche(0, 0), true, 'au centre');
  assert.equal(cliche(20, 20), true, 'à 28 px du centre : la règle d\'époque (< 30)');
  assert.equal(cliche(0, 38), true, 'poisson à l\'horizontale, décalé en hauteur : entier dans le cadre');
  assert.equal(cliche(38, 0, 0, 90), true, 'poisson à la verticale, décalé sur le côté : entier dans le cadre');
  assert.equal(cliche(0, 38, 90), true, 'le cadre tourné d\'un quart : toujours entier');
  assert.equal(cliche(0, 30, 45), true, 'le cadre à 45° : le poisson tient dans le carré penché');
});

test('PHOTO : le hors cadre n\'est pas validé', () => {
  // Le centre du poisson DANS le cadre, mais sa tête ou sa queue dehors :
  // accepté par la règle relâchée (centre à moins de 42 %), refusé ici.
  assert.equal(cliche(38, 0), false, 'décalé de 38 px sur le côté : il déborde de 15 px');
  assert.equal(cliche(41, 41), false, 'le centre dans l\'angle, le poisson dehors');
  assert.equal(cliche(-30, 30), false, 'dans un coin, il déborde');
  assert.equal(cliche(0, 46), false, 'à l\'horizontale, 46 px en hauteur : son dos sort');
  assert.equal(cliche(38, 38, 45), false, 'cadre à 45°, poisson vers l\'angle : il sort');
  // Le centre du poisson hors du cadre : raté quel que soit l'angle.
  assert.equal(cliche(55, 0), false, 'hors du cadre');
  assert.equal(cliche(0, -60), false, 'au-dessus du cadre');
  assert.equal(cliche(0, -60, 90), false, 'au-dessus du cadre tourné');
});

test('PHOTO : la règle ne dépend pas du miroir du poisson, et rétrécit avec le cadre', () => {
  // Un poisson qui saute vers la gauche est retourné (sy = −1) : sa boîte,
  // symétrique, donne la même photo.
  const b = banc(J.JumpFish, { dif: 0 });
  const j = b.jeu;
  b.socle.timer = 99;
  b.avancer(1);
  j.poisson.peau.rot = 0;
  j.poisson.peau.sy = -1;
  j.cadre.x = j.poisson.x;
  j.cadre.y = j.poisson.y - 38;
  j.cadre.peau.rot = 0;
  b.souris(j.cadre.x, j.cadre.y);
  j.photographier();
  assert.equal(j.dansLeCadre, true, 'retourné, entier dans le cadre');
  // La difficulté rétrécit le cadre (size = 100 − dif·0.4) : à 100, il fait
  // 60 (±30) — le poisson de 54 × 11 n'y tient qu'à 3 px près en longueur,
  // et son dos sort dès 25 px de décalage en hauteur.
  const petit = (decalY) => {
    const b2 = banc(J.JumpFish, { dif: 100 });
    const j2 = b2.jeu;
    assert.equal(j2.taille, 60);
    b2.socle.timer = 99;
    b2.avancer(1);
    j2.poisson.peau.rot = 0;
    j2.cadre.x = j2.poisson.x;
    j2.cadre.y = j2.poisson.y - decalY;
    j2.cadre.peau.rot = 0;
    b2.souris(j2.cadre.x, j2.cadre.y);
    j2.photographier();
    return j2.dansLeCadre;
  };
  assert.equal(petit(22), true, 'à 22 px en hauteur (plus de 30 % de 60 = 18) : entier, réussi');
  assert.equal(petit(26), false, 'à 26 px : son dos sort du petit cadre, raté');
});

// ── LA PAUSE QUAND LA FENÊTRE PART ──

/*
 * Le jeu d'origine n'a pas de pause : quand la fenêtre n'est plus devant (le
 * chat d'à côté, une autre fenêtre, l'onglet quitté au light, qui envoie un
 * `blur`), l'épreuve filait sans personne. Le client se fige maintenant :
 * plus d'image de jeu, un voile, et c'est un appui sur la scène qui relance —
 * un appui qui ne compte PAS comme un coup. Rien ne repart tout seul.
 *
 * Le vrai Client, sur une fenêtre et une toile factices : on tient la boucle
 * (requestAnimationFrame) et on déclenche nous-mêmes les événements.
 */
function clientEcoute() {
  const fenetre = {}, doc = {}, toile = {};
  const ecouter = (table) => (nom, f) => { (table[nom] = table[nom] || []).push(f); };
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true });
  const avant = { window: global.window, document: global.document, raf: global.requestAnimationFrame };
  let boucle = null;
  global.window = { devicePixelRatio: 1, PointerEvent: function () {}, addEventListener: ecouter(fenetre), focus() {} };
  global.document = { hidden: false, addEventListener: ecouter(doc) };
  global.requestAnimationFrame = (f) => { boucle = f; return 1; };
  const restaurer = () => {
    for (const [k, v] of [['window', avant.window], ['document', avant.document], ['requestAnimationFrame', avant.raf]]) {
      if (v === undefined) delete global[k]; else global[k] = v;
    }
  };
  const client = new C.Client({ canvas: {
    width: 240, height: 240, style: {},
    parentElement: { clientWidth: 240, clientHeight: 240 },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 240 }),
    addEventListener: ecouter(toile),
  } });
  const lancer = (table, nom, ev) => { for (const f of table[nom] || []) f(ev || {}); };
  let t = 0;
  return {
    client, restaurer,
    blur: () => lancer(fenetre, 'blur'),
    focus: () => lancer(fenetre, 'focus'),
    cacher: () => { global.document.hidden = true; lancer(doc, 'visibilitychange'); global.document.hidden = false; },
    appui: () => {
      const ev = { clientX: 120, clientY: 120, pointerType: 'mouse', cancelable: true, preventDefault() {} };
      lancer(fenetre, 'pointerdown', ev);      // la capture de focus, posée sur la fenêtre
      lancer(toile, 'pointerdown', ev);
      lancer(fenetre, 'pointerup', ev);
    },
    images: (n) => { for (let i = 0; i < n; i++) { t += 25; boucle(t); } },
  };
}

/** Une épreuve nue qui compte ses coups. */
class Bidon extends E.Jeu {
  init() { super.init(); this.gameTime = 400; this.coups = 0; }
  click() { this.coups++; }
}
const CATALOGUE = [{ cle: 'bidon', nom: 'bidon', Classe: Bidon }];

test('PAUSE : la fenêtre qui part fige l\'épreuve, un appui relance sans jouer de coup', () => {
  const b = clientEcoute();
  try {
    const socle = b.client.nouvellePartie(E.Fever, CATALOGUE);
    b.client.demarrer();
    b.images(10);
    const t0 = socle.timer;
    assert.ok(t0 < 400, 'la barre de temps descend : ' + t0);

    b.client.socle.click();                  // un doigt posé au moment de partir
    b.blur();
    assert.equal(b.client.enPause, true, 'le blur pose la pause');
    assert.equal(socle.flPresse, false, 'et lâche toujours l\'appui');
    b.images(40);
    assert.equal(socle.timer, t0, 'la barre de temps ne bouge plus');

    // Le retour du focus ne relance pas.
    b.focus();
    b.images(5);
    assert.equal(b.client.enPause, true, 'la pause tient au retour');

    // L'appui qui relance n'est pas un coup.
    const coups = socle.jeu.coups;
    b.appui();
    assert.equal(b.client.enPause, false, 'un appui relance');
    assert.equal(socle.jeu.coups, coups, 'sans compter comme un coup');
    b.images(4);
    assert.ok(socle.timer < t0, 'le temps reprend');
    b.appui();
    assert.equal(socle.jeu.coups, coups + 1, 'l\'appui suivant, lui, joue');

    // L'onglet caché pause aussi.
    b.cacher();
    assert.equal(b.client.enPause, true, 'page cachée → pause');
    // Une nouvelle partie repart sans pause.
    b.client.nouvellePartie(E.Fever, CATALOGUE);
    assert.equal(b.client.enPause, false, 'une nouvelle partie n\'hérite pas de la pause');
  } finally { b.restaurer(); }
});

test('PAUSE : l\'arcade se fige aussi à la console ; ni l\'accueil ni l\'écran de fin', () => {
  const b = clientEcoute();
  try {
    // La console de l'arcade (le briefing) enchaîne seule vers l'épreuve : elle
    // se fige comme le reste de la partie.
    const arcade = b.client.nouvellePartie(E.Arcade, CATALOGUE, { palier: 0 });
    b.client.demarrer();
    assert.equal(arcade.etape, 3, 'le briefing');
    b.blur();
    assert.equal(b.client.enPause, true, 'la console se met en pause');
    const m = arcade.minuteur;
    b.images(20);
    assert.equal(arcade.minuteur, m, 'et ne décompte plus');

    // Une partie close : rien à figer.
    b.client.nouvellePartie(E.Arcade, CATALOGUE, { palier: 0 }).termine = true;
    b.blur();
    assert.equal(b.client.enPause, false, 'pas de pause sur une partie finie');

    // L'écran de fin du fever : il attend un clic, il n'a rien à figer.
    b.client.nouvellePartie(E.Fever, CATALOGUE).ecranFin = true;
    b.blur();
    assert.equal(b.client.enPause, false, 'pas de pause sur l\'écran de fin');

    // L'écran d'accueil.
    b.client.nouvellePartie(E.Menu, CATALOGUE);
    b.blur();
    assert.equal(b.client.enPause, false, 'pas de pause sur l\'accueil');
  } finally { b.restaurer(); }
});
