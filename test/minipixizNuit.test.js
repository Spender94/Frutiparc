/*
 * Minipixiz — la nuit, et le bassin aux fées.
 *
 * Tout ce qui fait avancer l'aventure se passe pendant qu'on n'est pas là :
 * les fées mangent, le bassin s'allume, le donjon se bâtit, les missions se
 * soldent. Un joueur qui revient au bout d'une semaine doit retrouver sept
 * nuits jouées, dans le bon ordre — c'est ce que ce fichier vérifie.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const E = require('../public/minipixiz/engine.js');
const N = require('../public/minipixiz/nuit.js');
const P = require('../public/minipixiz/plateforme.js');
const F = require('../public/minipixiz/faerie.js');
const B = require('../public/minipixiz/bassin.js');
const C = require('../public/minipixiz/combat.js');

function tirage(graine) {
  let s = graine;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function carteNeuve() { return P.carteNeuve(1700000000000); }

function ajouterFee(carte, opts) {
  const o = opts || {};
  const fs = F.genererGraine(tirage(o.graine || 3));
  Object.assign(fs, o.fs || {});
  carte.$faerie.push(fs);
  return fs;
}

// ── Le temps qui passe ────────────────────────────────────────────────────

test('une journée entière fait passer une nuit, et pas une de plus', () => {
  const c = carteNeuve();
  c.$time.$t = 0; c.$time.$s = 0; c.$time.$d = 0;
  assert.equal(N.passerLeTemps(c, N.JOUR - 1, tirage(1)).nuits, 0, 'presque un jour : rien');
  c.$time.$t = 0; c.$time.$s = 0;
  assert.equal(N.passerLeTemps(c, N.JOUR + 1, tirage(1)).nuits, 1);
  assert.equal(c.$time.$d, 1);
});

test('une semaine d\'absence rattrape sept nuits', () => {
  const c = carteNeuve();
  c.$time.$t = 0; c.$time.$s = 0; c.$time.$d = 0;
  const r = N.passerLeTemps(c, N.JOUR * 7 + 5000, tirage(2));
  assert.equal(r.nuits, 7);
  assert.equal(c.$time.$d, 7);
  assert.equal(c.$time.$s, 5000, 'le reste ne se perd pas : l\'heure de la nuit ne dérive pas');
});

test('une horloge revenue à zéro n\'immobilise pas le navigateur', () => {
  // Une fiche dont $t vaudrait 0 demanderait cinquante-six ans de nuits.
  const c = carteNeuve();
  c.$time.$t = 0; c.$time.$s = 0; c.$time.$d = 0;
  const r = N.passerLeTemps(c, 1700000000000, tirage(3), 50);
  assert.ok(r.nuits > 19000, 'la date avance quand même');
  assert.equal(r.jouees, 50, 'mais on ne joue que la limite');
  assert.equal(c.$time.$d, r.nuits);
});

// ── Le bassin ─────────────────────────────────────────────────────────────

test('sans aucune fée, la lueur s\'allume à coup sûr dès la première nuit', () => {
  // Sinon une partie perdue serait sans issue : il faut une fée pour courir,
  // et le bassin est le seul endroit où en trouver.
  for (let g = 1; g <= 10; g++) {
    const c = carteNeuve();
    N.entretien(c, tirage(g));
    assert.ok(c.$pond.$fs, 'graine ' + g + ' : une lueur');
  }
});

test('la lueur tient deux nuits, puis s\'éteint', () => {
  const c = carteNeuve();
  const alea = tirage(7);
  N.entretien(c, alea);
  const fs = c.$pond.$fs;
  assert.ok(fs);
  N.entretien(c, alea);
  assert.equal(c.$pond.$fs, fs, 'la deuxième nuit, elle est toujours là');
  const r = N.entretien(c, alea);
  assert.equal(c.$pond.$fs, null, 'la troisième, elle s\'éteint');
  assert.ok(r.messages.some((m) => /éteinte/.test(m)));
});

test('la qualité de la fée du bassin monte avec l\'ancienneté de la partie', () => {
  const moyenne = (jour) => {
    let somme = 0, n = 0;
    for (let g = 1; g <= 60; g++) {
      const c = carteNeuve();
      c.$time.$d = jour;
      N.entretien(c, tirage(g * 17));
      if (c.$pond.$fs) { somme += c.$pond.$q; n++; }
    }
    return somme / Math.max(1, n);
  };
  const jeune = moyenne(2);
  const ancienne = moyenne(400);
  assert.ok(ancienne > jeune,
    'au bout d\'un an (' + ancienne.toFixed(2) + ') mieux qu\'au deuxième jour (' + jeune.toFixed(2) + ')');
});

// ── Les fées, la nuit ─────────────────────────────────────────────────────

test('une fée qu\'on n\'a pas nourrie meurt, et quitte la fiche', () => {
  const c = carteNeuve();
  const fs = ajouterFee(c, { fs: { $hunger: 0, $life: 1, $carac: [2, 2, 2, 2, 2, 2] } });
  c.$current = 0;
  N.entretien(c, tirage(5));
  assert.equal(fs.$life, 0, 'elle perd son dernier cœur');
  assert.equal(c.$faerie.length, 1, 'mais elle est encore là');
  const r = N.entretien(c, tirage(5));
  assert.equal(c.$faerie.length, 0, 'la nuit suivante l\'emporte');
  assert.equal(c.$current, null, 'et le joueur n\'emmène plus personne');
  assert.ok(r.messages.some((m) => /faim/.test(m)));
});

test('effacer une fée recale celle que le joueur emmène', () => {
  const c = carteNeuve();
  const a = ajouterFee(c, { graine: 1 });
  const b = ajouterFee(c, { graine: 2 });
  const d = ajouterFee(c, { graine: 3 });
  c.$current = 2;
  N.effacerFee(c, a);
  assert.equal(c.$current, 1, 'la troisième est devenue la deuxième');
  assert.deepEqual(c.$faerie, [b, d]);
  N.effacerFee(c, d);
  assert.equal(c.$current, null, 'effacer la sienne le laisse sans fée');
});

test('une fée en mission ne passe pas la nuit à la maison', () => {
  const c = carteNeuve();
  const fs = ajouterFee(c, { fs: { $hunger: 0, $life: 1, $mission: 0 } });
  c.$mis = [{ $d: 5, $gift: null, $type: 0, $string: 'testé' }];
  N.entretien(c, tirage(9));
  assert.equal(fs.$life, 1, 'elle ne perd rien');
  assert.equal(fs.$hunger, 0, 'et ne mange pas non plus');
});

test('la cannibale dévore une sœur bien plus faible', () => {
  const c = carteNeuve();
  const forte = ajouterFee(c, { graine: 1, fs: { $level: 10, $hunger: 0, $life: 1 } });
  forte.$behaviour = [];
  forte.$behaviour[F.CANNIBALISME] = 1;
  const faible = ajouterFee(c, { graine: 2, fs: { $level: 2 } });
  c.$current = 0;
  const r = N.entretien(c, tirage(4));
  assert.equal(c.$faerie.indexOf(faible), -1, 'la faible a disparu');
  assert.ok(r.messages.some((m) => /dévoré/.test(m)));
  assert.ok(forte.$hunger > 0, 'et la cannibale n\'a plus faim');
});

test('la schizophrène permute ses six caractéristiques', () => {
  const fs = F.genererGraine(tirage(11));
  fs.$carac = [1, 2, 3, 4, 5, 6];
  const fi = new F.Fee(fs, null, null);
  fi.echangerSesCaracs();
  assert.deepEqual(fs.$carac, [4, 5, 6, 1, 2, 3], 'force contre intelligence');
});

test('la psychanalyste ne fige plus le jeu (PSY_BOUCLE_INFINIE)', () => {
  // L'original incrémentait la mauvaise variable : deux fées et une
  // psychanalyste suffisaient à bloquer Flash pour de bon.
  const c = carteNeuve();
  const psy = ajouterFee(c, { graine: 1 });
  psy.$behaviour = [];
  psy.$behaviour[F.PSYCHANALYSTE] = 1;
  const autre = ajouterFee(c, { graine: 2 });
  autre.$behaviour = [];
  autre.$behaviour[F.CLEPTOMANIE] = 1;
  const fi = new F.Fee(psy, null, null);
  fi.messages = [];
  fi.psychanalyser({
    carte: c, entier: (n) => n - 1, choisir: (l) => l[0], jour: 0,
    effacer: () => {}, nomObjet: () => '?',
  });
  assert.ok(fi.messages.some((m) => /cleptomanie/.test(m)), 'elle a vu juste');
});

test('une fée engourdie ou malade ne se bat pas', () => {
  const fs = F.genererGraine(tirage(13));
  const fi = new F.Fee(fs, null, null);
  assert.equal(fi.preteAuCombat(), true);
  fs.$mood = [];
  fs.$mood[0] = 1;
  assert.equal(fi.preteAuCombat(), false, 'engourdie');
  fs.$mood = [];
  fs.$mood[1] = 1;
  assert.equal(fi.preteAuCombat(), false, 'malade');
});

// ── Le donjon, l'arc-en-ciel, les missions ────────────────────────────────

test('le donjon se bâtit à la course, pas au calendrier', () => {
  const c = carteNeuve();
  c.$time.$d = 10;
  N.entretien(c, tirage(3));
  assert.equal(c.$dungeon.$f, false, 'sans avoir couru, rien');
  c.$stat.$run = 6000;
  const r = N.entretien(c, tirage(3));
  assert.equal(c.$dungeon.$f, true, 'passé cinq mille niveaux, il apparaît');
  assert.ok(r.messages.some((m) => /construite pendant la nuit/.test(m)));
});

test('l\'arc-en-ciel ne dure qu\'un jour et se fait attendre', () => {
  const c = carteNeuve();
  c.$rainbow = { $f: false, $day: 0, $it: null };
  const alea = tirage(6);
  let apparu = 0;
  for (let i = 0; i < 40; i++) {
    const avant = c.$rainbow.$f;
    N.entretien(c, alea);
    if (!avant && c.$rainbow.$f) {
      apparu++;
      assert.ok(c.$rainbow.$it !== null, 'il apporte toujours quelque chose');
    }
    if (avant) assert.equal(c.$rainbow.$f, false, 'et il repart le lendemain');
  }
  assert.ok(apparu >= 3 && apparu <= 12, 'ni tous les jours, ni jamais (' + apparu + ' fois)');
});

test('le troisième sac gagné, l\'arc-en-ciel ne donne plus que du mana', () => {
  const c = carteNeuve();
  c.$bag = 3;
  for (let i = 0; i < 30; i++) assert.equal(N.objetArcEnCiel(c, tirage(i + 1)), 83);
});

test('les missions n\'arrivent qu\'après mille niveaux, et avec une fée', () => {
  const c = carteNeuve();
  c.$stat.$run = 2000;
  N.entretien(c, tirage(2));
  assert.equal(c.$mission, null, 'sans fée, Gromelin n\'a rien à proposer');
  ajouterFee(c);
  N.entretien(c, tirage(2));
  assert.equal(c.$mission.length, 6, 'six missions, une par durée');
  const durees = c.$mission.map((m) => m[2]);
  assert.deepEqual(durees, N.MISSION_DUREES);
  for (const m of c.$mission) {
    assert.ok(m[0] >= 0 && m[0] <= 6, 'difficulté dans la table');
    assert.ok(m[1] >= 0 && m[1] < N.NB_TYPES_MISSION, 'type connu');
    assert.ok(m[3] !== undefined && m[3] !== null, 'une récompense');
  }
});

test('une mission dure aboutit à une plus belle récompense', () => {
  const liste = N.listeTriee();
  assert.ok(liste.length > 20);
  for (let i = 1; i < liste.length; i++) {
    assert.ok(liste[i].score >= liste[i - 1].score, 'la liste va du banal au rare');
  }
});

test('une mission arrivée à échéance rend les fées et donne l\'objet', () => {
  const c = carteNeuve();
  c.$bag = 1;                          // sans sac, il n'y a nulle part où le mettre
  const fs = ajouterFee(c);
  fs.$mission = 0;
  c.$mis = [{ $d: 1, $gift: 300, $type: 0, $string: 'réussi la mission !' }];
  const r = N.entretien(c, tirage(8));
  assert.equal(c.$mis.length, 0, 'la mission est soldée');
  assert.equal(fs.$mission, null, 'la fée est rentrée');
  assert.ok(c.$inv.indexOf(300) >= 0, 'et l\'objet est dans le sac');
  assert.ok(r.messages.some((m) => /Félicitations/.test(m)));
});

test('sans place dans le sac, la récompense part à l\'AFD', () => {
  const c = carteNeuve();                // $bag vaut zéro : aucune place
  const fs = ajouterFee(c);
  fs.$mission = 0;
  c.$mis = [{ $d: 1, $gift: 300, $type: 0, $string: 'réussi !' }];
  const r = N.entretien(c, tirage(8));
  assert.equal(c.$inv.indexOf(300), -1);
  assert.ok(r.messages.some((m) => /AFD/.test(m)), 'et le jeu le dit franchement');
});

test('un échec ne donne rien, et le dit', () => {
  const c = carteNeuve();
  c.$bag = 1;
  const fs = ajouterFee(c);
  fs.$mission = 0;
  c.$mis = [{ $d: 1, $gift: null, $type: 0, $string: 'pas réussi leur mission...' }];
  const avant = c.$inv.slice();
  const r = N.entretien(c, tirage(8));
  assert.deepEqual(c.$inv, avant, 'rien dans le sac');
  assert.ok(r.messages.some((m) => /n'a pas réussi/.test(m)));
});

test('les index de mission des fées se recalent quand une mission part', () => {
  const c = carteNeuve();
  const a = ajouterFee(c, { graine: 1 });
  const b = ajouterFee(c, { graine: 2 });
  a.$mission = 0;
  b.$mission = 1;
  c.$mis = [
    { $d: 1, $gift: null, $type: 0, $string: 'x' },
    { $d: 9, $gift: null, $type: 0, $string: 'y' },
  ];
  N.entretien(c, tirage(8));
  assert.equal(c.$mis.length, 1);
  assert.equal(b.$mission, 0, 'la seconde fée suit sa mission, qui a glissé');
});

// ── Le bassin, en jeu ─────────────────────────────────────────────────────

function bassinPret(graine) {
  const c = carteNeuve();
  N.entretien(c, tirage(graine || 42));
  return { carte: c, bassin: new B.Bassin({ carte: c, graine: graine || 5 }) };
}

test('le bassin se joue sur toute la scène, avec une seule pièce à venir', () => {
  const { bassin } = bassinPret();
  assert.equal(bassin.jeu.largeur, 240);
  assert.equal(bassin.jeu.hauteur, 240);
  assert.equal(bassin.jeu.xMax, 14, 'quatorze colonnes au lieu de huit');
  assert.equal(bassin.jeu.yMax, 17);
  assert.equal(bassin.jeu.nextLimit, 1);
  assert.equal(bassin.jeu.eList.length, 0, 'et la grille est vide au départ');
});

test('la toute première pièce est la croix de boule de feu', () => {
  const { bassin } = bassinPret();
  const p = bassin.jeu.nextList[0];
  assert.equal(p.length, 9, 'trois sur trois');
  const centre = p.find((o) => o.x === 0 && o.y === 0);
  assert.equal(centre.e.et, E.E.BOULE, 'la boule au milieu');
  for (const o of p) {
    if (o === centre) continue;
    assert.equal(o.e.et, E.E.JETON);
    assert.equal(o.e.special, E.SPECIAL.ARMURE, 'et huit billes blindées autour');
  }
});

test('la croix ne revient qu\'une fois sur onze', () => {
  const { bassin } = bassinPret();
  let croix = 0;
  for (let i = 0; i < 33; i++) {
    const p = bassin.jeu.nouvelleForme();
    if (p.some((o) => o.e.et === E.E.BOULE)) croix++;
  }
  assert.equal(croix, 3, 'trois croix en trente-trois pièces');
});

test('la bulle tient cinq coups, plus trois par point de qualité', () => {
  const { carte, bassin } = bassinPret();
  assert.ok(bassin.bulle, 'il y a une bulle');
  assert.equal(bassin.bulle.vie, 5 + carte.$pond.$q * 3);
});

test('sans lueur, on peut descendre au bassin mais il n\'y a rien à prendre', () => {
  const c = carteNeuve();
  const bassin = new B.Bassin({ carte: c, graine: 3 });
  assert.equal(bassin.bulle, null);
  bassin.update(1);
  assert.equal(bassin.fini, false, 'et la partie tourne quand même');
});

test('une boule soufflée devient un projectile qui poursuit la bulle', () => {
  const { bassin } = bassinPret();
  bassin.jeu.eList.slice().forEach((e) => e.tuer());
  const boule = bassin.jeu.genElement(E.E.BOULE, 5, 10, 0);
  assert.equal(bassin.champ.shotList.length, 0);
  boule.souffler();
  assert.equal(bassin.champ.shotList.length, 1);
  const s = bassin.champ.shotList[0];
  assert.equal(s.cibles[0], bassin.bulle);
  assert.equal(s.degats, 80);
  assert.ok(s.vLim < 0, 'elle a le droit de sortir de l\'écran et de revenir');
  assert.equal(boule.vivant, false, 'la boule a quitté la grille');
});

test('crever la bulle donne la fée au joueur, et éteint le bassin', () => {
  const { carte, bassin } = bassinPret();
  const nom = carte.$pond.$fs.$name;
  const vie = bassin.bulle.vie;
  bassin.jeu.step = E.ETAPE.JEU;
  let boules = 0, images = 0;
  while (bassin.bulle && images < 40000) {
    if (bassin.champ.shotList.length === 0) {
      bassin.jeu.genElement(E.E.BOULE, 5 + (boules % 4), 10, 0).souffler();
      boules++;
    }
    bassin.champ.update(1);
    images++;
  }
  assert.equal(boules, vie, 'exactement autant de boules que de vie');
  assert.equal(carte.$faerie.length, 1, 'la fée entre dans la fiche');
  assert.equal(carte.$faerie[0].$name, nom);
  assert.equal(carte.$current, 0, 'et c\'est elle que le joueur emmène');
  assert.equal(carte.$pond.$fs, null, 'la lueur s\'est éteinte');
  assert.ok(bassin.fee, 'elle vole');
  assert.equal(bassin.fee.trg.y, -20, 'et elle monte');

  let n = 0;
  while (!bassin.fini && n < 30000) { bassin.update(1); n++; }
  assert.equal(bassin.gagne, true, 'sortie par le haut : c\'est gagné');
});

test('les couleurs du bassin s\'ajoutent avec le temps, et n\'en sortent jamais', () => {
  const { bassin } = bassinPret();
  assert.equal(bassin.jeu.colorList.length, 3);
  assert.equal(bassin.limiteCouleur(3), Math.pow(3, 4) * 16);
  // On force le compteur : c'est le temps PASSÉ À JOUER qui compte.
  bassin.jeu.mainTimer = bassin.limiteCouleur(3) + 1;
  bassin.update(1);
  assert.equal(bassin.jeu.colorList.length, 4);
  // Une grille vide ne doit pas gagner la partie, contrairement à la forêt.
  bassin.jeu.eList.slice().forEach((e) => e.tuer());
  bassin.jeu.nouveauTour();
  assert.equal(bassin.jeu.termine, false);
  assert.equal(bassin.jeu.colorList.length, 4, 'aucune couleur ne sort du tirage');
});

test('la bulle rebondit sur les bords et reste dans l\'aire', () => {
  const { bassin } = bassinPret();
  const b = bassin.bulle;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 0; i < 6000; i++) {
    b.update(1);
    minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
    minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y);
  }
  assert.ok(minX >= b.ray - 1 && maxX <= 240 - b.ray + 1, 'jamais hors du cadre');
  assert.ok(minY >= b.ray - 1 && maxY <= 240 - b.ray + 1);
  assert.ok(maxX - minX > 80 && maxY - minY > 80, 'et elle dérive vraiment');
});

test('la page charge la nuit et le bassin, et le bassin est atteignable', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /src="\/minipixiz\/nuit\.js"/);
  assert.match(html, /src="\/minipixiz\/bassin\.js"/);
  assert.match(html, /ouvrirBassin\(\)/, 'toucher le bassin y descend');
  assert.match(html, /client\.nouveauBassin\(/);
  assert.match(html, /plateforme\.messagesDeNuit/, 'et les nuits passées se racontent');
});
