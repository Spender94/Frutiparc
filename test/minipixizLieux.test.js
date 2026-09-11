/*
 * Minipixiz — les quatre derniers lieux du menu.
 *
 * Le donjon, l'arbre creux, l'arc-en-ciel et la cabane de Gromelin. Trois modes
 * de jeu bâtis sur le même puzzle, et un écran de missions dont les textes sont
 * assemblés à partir d'une graine — ce qui se vérifie au caractère près.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const E = require('../public/minipixiz/engine.js');
const X = require('../public/minipixiz/lieux.js');
const M = require('../public/minipixiz/missions.js');
const N = require('../public/minipixiz/nuit.js');
const P = require('../public/minipixiz/plateforme.js');
const F = require('../public/minipixiz/faerie.js');
const L = require('../public/minipixiz/langue.js');

function tirage(g) {
  let s = g;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function carte(o) {
  const opts = o || {};
  const c = P.carteNeuve(1700000000000);
  const fs = F.genererGraine(tirage(opts.graine || 3));
  fs.$carac = opts.carac || [3, 3, 3, 3, 3, 4];
  fs.$life = 3; fs.$mana = 8; fs.$pos = 0;
  c.$faerie.push(fs);
  c.$current = 0;
  c.$key = 3;
  c.$bag = 2;
  c.$dungeon.$lvl = opts.rang || 0;
  return { c, fs };
}

// Vider la grille et clore le tour : c'est ainsi qu'on gagne un niveau.
function viderEtFinirLeTour(lieu) {
  lieu.jeu.eList.slice().forEach((e) => e.tuer());
  lieu.jeu.nouveauTour();
}

// ── Le donjon ─────────────────────────────────────────────────────────────

test('le donjon prend une clé à l\'entrée, et ne la rend pas', () => {
  const { c, fs } = carte();
  assert.equal(c.$key, 3);
  new X.Donjon({ carte: c, fee: fs, graine: 1 });
  assert.equal(c.$key, 2);
  assert.equal(c.$stat.$game[2], 1, 'et la visite est comptée');
});

test('la pile du donjon a une dalle de pierre en surface', () => {
  const { c, fs } = carte({ rang: 2 });
  const d = new X.Donjon({ carte: c, fee: fs, graine: 1 });
  const pierres = d.jeu.eList.filter((e) => e.et === E.E.PIERRE);
  assert.equal(pierres.length, d.jeu.xMax, 'une pierre par colonne');
  const ligne = pierres[0].py;
  assert.ok(pierres.every((p) => p.py === ligne), 'toutes sur la même ligne');
  // Et rien au-dessus : c'est bien la surface.
  assert.ok(!d.jeu.eList.some((e) => e.py < ligne));
  // Sous la dalle, aucune bille ordinaire : elles sont toutes marquées.
  const jetons = d.jeu.eList.filter((e) => e.et === E.E.JETON);
  assert.ok(jetons.length > 0);
  assert.ok(jetons.every((j) => j.special === 1 || j.special === 2),
    'perle ou armure, jamais une bille nue');
});

test('la pile monte avec le niveau', () => {
  const { c, fs } = carte({ rang: 4 });
  const d = new X.Donjon({ carte: c, fee: fs, graine: 1 });
  const hauteur = () => d.jeu.yMax - Math.min(...d.jeu.eList.map((e) => e.py));
  const h0 = hauteur();
  d.level = 6;
  d.commencer();
  assert.ok(hauteur() > h0, 'le sixième niveau part de plus haut que le premier');
});

test('l\'ascenseur fait monter la grille et rétrécir l\'aire', () => {
  const { c, fs } = carte();
  const d = new X.Donjon({ carte: c, fee: fs, graine: 1 });
  const yMax = d.jeu.yMax;
  const bas = Math.max(...d.jeu.eList.map((e) => e.py));
  // On force les deux conditions : le compte écoulé, et la roue lancée.
  d.heightTimer = -1;
  d.wSpeed = 20;
  d.surNouveauTour();
  assert.equal(d.jeu.yMax, yMax - 1, 'une ligne de moins');
  assert.equal(Math.max(...d.jeu.eList.map((e) => e.py)), bas - 1, 'et tout a monté');
  assert.equal(d.heightTimer, d.heightCycle, 'le compte repart');
});

test('l\'ascenseur ne bouge pas tant que la roue n\'a pas pris de vitesse', () => {
  const { c, fs } = carte();
  const d = new X.Donjon({ carte: c, fee: fs, graine: 1 });
  const yMax = d.jeu.yMax;
  d.heightTimer = -1;
  d.wSpeed = 2;                        // il en faut plus de huit
  d.surNouveauTour();
  assert.equal(d.jeu.yMax, yMax);
});

test('le donjon s\'enchaîne sur dix niveaux, et le dernier a ses démons', () => {
  const { c, fs } = carte({ rang: 1 });
  const niveaux = [];
  const d = new X.Donjon({
    carte: c, fee: fs, graine: 7,
    surEvenement: (n, o) => { if (n === 'niveauDonjon') niveaux.push(o.niveau); },
  });
  let tours = 0;
  while (!d.fini && tours < 40) { viderEtFinirLeTour(d); tours++; }
  assert.equal(tours, X.DONJON_NIVEAUX, 'dix niveaux');
  assert.deepEqual(niveaux, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(d.gagne, true);
});

/*
 * « JE TERMINE DES DONJONS MAIS RIEN NE SE PASSE. » La fiche, elle, avait
 * bien son diamant (Cm.winDungeon, gagnerLeDonjon) ; mais l'annonce
 * `donjonGagne` ne trouvait personne, et la clairière revenait sans un mot ni
 * une image. Le client joue maintenant la chute du diamant (base/Dungeon
 * .initStep(21-22)) et la page dit la nouvelle au retour.
 */
test('le donjon vaincu paie — le diamant, le rang suivant, la rangée de l\'inventaire — et l\'annonce', () => {
  const { c, fs } = carte({ rang: 1 });
  const gains = [];
  const d = new X.Donjon({
    carte: c, fee: fs, graine: 7,
    surEvenement: (n, o) => { if (n === 'donjonGagne') gains.push(o); },
  });
  let tours = 0;
  while (!d.fini && tours < 40) { viderEtFinirLeTour(d); tours++; }
  assert.equal(d.gagne, true);
  assert.equal(gains.length, 1, 'une annonce, au dixième niveau');
  assert.equal(gains[0].diamant, 1, 'le diamant du rang joué (premier tour)');
  assert.equal(gains[0].ornegon, false);
  assert.equal(gains[0].arcEnCiel, false);
  assert.equal(c.$dungeon.$lvl, 2, 'le rang suivant');
  assert.equal(c.$dungeon.$f, false);
  assert.equal(c.$diam, 2, 'la rangée de diamants de l\'inventaire');

  // Le client : l'annonce ouvre la scène du diamant, qui finit sur « rideau ».
  const fsMod = require('fs');
  const path = require('path');
  const js = fsMod.readFileSync(path.join(__dirname, '../public/minipixiz/game.js'), 'utf8');
  assert.match(js, /if \(nom === 'donjonGagne'\) \{[\s\S]*?this\.cine = \{ phase: 'diamant', diamant,/);
  assert.match(js, /if \(c\.phase === 'diamant'\) \{ this\.dessinerDiamant\(ctx, c, tmod\); return; \}/);
  const scene = /\n  dessinerDiamant\(ctx, c, tmod\) \{[\s\S]*?\n  \}\n/.exec(js);
  assert.ok(scene, 'dessinerDiamant');
  assert.match(scene[0], /c\.y \+= c\.vity \* tmod;/, 'le diamant descend');
  assert.match(scene[0], /for \(let i = 0; i < 3; i\+\+\) \{\s*c\.rayons\.push/, 'trois rayons par image (lightDiam)');
  assert.match(scene[0], /if \(c\.y > SCENE \* 0\.5\) c\.flash = \{ prc: 1 \};/, 'arrivé au milieu, l\'éclair');
  assert.match(scene[0], /rendre\(s\.invDiamant, Math\.min\(5, Math\.max\(1, c\.diamant \+ 1\)\)/, 'la teinte du rang');
  assert.match(scene[0], /this\.annonce\('rideau', \{\}, c\.cible\);/, 'et la sortie');
  // La page attend cette sortie-là, et dit la nouvelle à la clairière.
  const page = fsMod.readFileSync(path.join(__dirname, '../public/minipixiz/index.html'), 'utf8');
  assert.match(page, /if \(nom === 'donjonGagne'\) \{[\s\S]*?gainsDonjon = info \|\| \{\};[\s\S]*?plateforme\.ecrire\(avant\);/);
  assert.match(page, /if \(client\.cine && client\.cine\.phase === 'diamant'\) return;/);
  assert.match(page, /if \(nom === 'rideau'\) \{ ouvrirMenu\(\); direLesGainsDuDonjon\(\); return; \}/);
  assert.match(page, /un diamant de plus dans le sac/);
  assert.match(page, /Ornegon est libéré !/);
});

/*
 * « LE BUG QUI NOUS FAIT RÉCUPÉRER TOUT LE MANA À CHAQUE FIN DE NIVEAU. »
 * base/Aventure.new pose `fi.fs.$mana = carac[MANA]*2` à l'ENTRÉE du lieu, et
 * les niveaux s'enchaînent ensuite dans la même base (setWin : level += 1,
 * initStep(2)) sur ce qu'il reste. Le portage rechargeait à chaque niveau, en
 * reconstruisant la fée.
 */
test('la mana est pleine à l\'entrée du donjon, et pas rendue entre deux niveaux', () => {
  const { c, fs } = carte({ rang: 1 });
  fs.$mana = 1;
  const d = new X.Donjon({ carte: c, fee: fs, graine: 7 });
  const max = new F.Fee(fs, null, c).manaMax();
  assert.equal(max, 8, 'carac.mana 4, fois deux');
  assert.equal(fs.$mana, max, 'base/Aventure.new : pleine à l\'entrée');
  assert.equal(d.champ.faerieList[0].mana, max);
  // Un niveau de dépensé : il reste un point, et le suivant se joue avec.
  d.champ.faerieList[0].poserMana(1);
  assert.equal(fs.$mana, 1);
  viderEtFinirLeTour(d);
  assert.equal(d.level, 1);
  assert.equal(fs.$mana, 1, 'pas de recharge entre deux niveaux');
  assert.equal(d.champ.faerieList[0].mana, 1, 'la fée du niveau suivant entre avec ce qu\'elle a');
  // La forêt aussi : la course recharge à son départ, et le combat ne
  // recharge plus jamais de lui-même.
  const fsMod = require('fs');
  const path = require('path');
  const combat = fsMod.readFileSync(path.join(__dirname, '../public/minipixiz/combat.js'), 'utf8');
  assert.doesNotMatch(combat, /fi\.fs\.\$mana = nombre\(fi\.carac\[MANA\]\) \* 2/, 'plus de recharge à la naissance de la fée');
  const page = fsMod.readFileSync(path.join(__dirname, '../public/minipixiz/index.html'), 'utf8');
  assert.match(page, /function nouvelleCourse\(depart\) \{[\s\S]*?var fiDepart = feeCourante\(\);\s*if \(fiDepart\) fiDepart\.rechargerMana\(\);\s*lancerNiveau\(\);/);
  assert.doesNotMatch(page, /function lancerNiveau\(\) \{[\s\S]{0,400}rechargerMana/, 'pas à chaque niveau');
});

/*
 * « LA FÉE QUI PARLE EN MODE CHALLENGE (ALORS QU'ELLE EST ABSENTE). » L'arbre
 * creux se joue sans fée ; le client gardait pourtant la fiche de la dernière
 * course et la faisait commenter les cascades depuis nulle part. La fée qui
 * parle est celle que le lieu fait jouer — Game.mt ne fait réagir que
 * faerieList[0].
 */
test('l\'arbre creux ne fait parler personne : la fée du client est celle du lieu, ou personne', () => {
  const { c, fs } = carte({ rang: 0 });
  const arbre = new X.Arbre({ carte: c, fee: fs, graine: 3 });
  assert.equal(arbre.fi, null, 'l\'arbre n\'emmène pas la fée');
  const fsMod = require('fs');
  const path = require('path');
  const js = fsMod.readFileSync(path.join(__dirname, '../public/minipixiz/game.js'), 'utf8');
  const ouvrir = /\n  nouveauLieu\(classe, opts\) \{[\s\S]*?\n  \}\n/.exec(js);
  assert.ok(ouvrir, 'nouveauLieu');
  assert.match(ouvrir[0], /this\.fee = this\.lieu\.fi \|\| null;/, 'à l\'ouverture');
  assert.doesNotMatch(ouvrir[0], /if \(this\.lieu\.fi\) this\.fee = this\.lieu\.fi;/);
  assert.match(js, /if \(nom === 'niveauDonjon' && this\.lieu\) \{[\s\S]*?this\.fee = this\.lieu\.fi \|\| null;/, 'et à chaque niveau du donjon');
  // Tout ce qui parle passe par `this.fee` : sans fée, pas un mot.
  for (const m of [/\n  react\(rangees\) \{\n    const fee = this\.fee;\n    if \(!fee \|\| !rangees\) return;/,
    /if \(this\.fee && this\.fee\.salutObjet\)/,
    /&& this\.fee\n\s*&& !this\.dialogue && Math\.random\(\) \* 500 < pas\)/]) {
    assert.match(js, m);
  }
});

test('l\'annonce niveauDonjon part une fois la partie neuve en place', () => {
  const { c, fs } = carte({ rang: 1 });
  const vu = [];
  const boite = {};
  boite.d = new X.Donjon({
    carte: c, fee: fs, graine: 7,
    surEvenement: (n, o) => {
      if (n !== 'niveauDonjon') return;
      // Le client se raccroche au moteur du lieu EN RECEVANT l'annonce
      // (game.js) : elle doit donc partir après commencer(). Émise avant, le
      // client repartait sur le moteur FINI du niveau vidé — l'écran du
      // donjon restait figé sur une grille vide, sans retour possible (le
      // retour de 3l_professor).
      vu.push({
        niveau: o.niveau,
        termine: boite.d.jeu.termine,
        garni: boite.d.jeu.eList.length > 0,
      });
    },
  });
  viderEtFinirLeTour(boite.d);
  assert.equal(vu.length, 1, 'un niveau vidé, une annonce');
  assert.equal(vu[0].niveau, 1);
  assert.equal(vu[0].termine, false, 'le moteur reçu n\'est pas celui du niveau fini');
  assert.equal(vu[0].garni, true, 'la pile du niveau suivant est déjà dressée');
});

test('le client reprend moteur, fée et bouquet à chaque niveau du donjon', () => {
  const fsMod = require('fs');
  const path = require('path');
  const js = fsMod.readFileSync(
    path.join(__dirname, '..', 'public/minipixiz/game.js'), 'utf8');
  // Le raccrochage complet : la partie, le champ, l'entrée, la fée — et le
  // bouquet du niveau, comme base/Aventure.initStep(0) le rejoue à chaque fois.
  const bloc = js.match(/if \(nom === 'niveauDonjon' && this\.lieu\) \{[\s\S]*?\n    \}/);
  assert.ok(bloc, 'le gestionnaire niveauDonjon existe');
  for (const attendu of [
    'this.jeu = this.lieu.jeu', 'this.champ = this.lieu.champ',
    'this.jeu.entree = this.entree', 'this.fee = this.lieu.fi',
    'this.commencerOuverture(',
  ]) {
    assert.ok(bloc[0].indexOf(attendu) >= 0, 'niveauDonjon : ' + attendu);
  }
  // Et entre deux niveaux, la halte d'évolution de tryToCloseGame — le
  // panneau de choix s'ouvre dans le donjon aussi quand la fée peut monter.
  const html = fsMod.readFileSync(
    path.join(__dirname, '..', 'public/minipixiz/index.html'), 'utf8');
  const halte = html.match(/if \(info && info\.gagne && lieu && !lieu\.fini\) \{[\s\S]*?ouvrirEvolution/);
  assert.ok(halte, 'le panneau de montée de niveau s\'ouvre entre deux niveaux');
  assert.match(html, /client\.commencerOuverture\(\(\(client\.lieu[\s\S]*?\.level\) \|\| 0\) \+ 1\)/,
    'et le bouquet du niveau suivant repart après le choix');
});

test('le panneau d\'évolution n\'affiche rien sans survol', () => {
  const fsMod = require('fs');
  const path = require('path');
  const js = fsMod.readFileSync(
    path.join(__dirname, '..', 'public/minipixiz/game.js'), 'utf8');
  // Le retour des joueurs : la description du sort s'écrivait d'office. Elle
  // ne suit plus que la case désignée — comme la bulle Mc.makeHint d'origine.
  assert.ok(js.indexOf('quoi = resumes[1] ? 1 : 0') < 0,
    'plus de description par défaut');
  assert.match(js, /sv !== null && sv !== undefined && resumes\[sv\]/,
    'la bande du bas ne s\'écrit qu\'au survol');
  // Le nom vit dans le bandeau, à la place de « Faites votre choix ! » —
  // c'est le fieldName du jeu (initExpSlot.onRollOver).
  assert.match(js, /noms\[sv\]\) \|\| 'Faites votre choix !'/);
  // Au doigt, le premier appui sur une case vaut survol, le second confirme.
  const toucher = js.match(/if \(this\.evolution\) \{[\s\S]*?preventDefault[\s\S]*?survole = c\.i;/);
  assert.ok(toucher, 'l\'appui de désignation existe au toucher');
});

test('le dernier niveau du donjon lâche deux démons', () => {
  const { c, fs } = carte({ rang: 3 });
  const d = new X.Donjon({ carte: c, fee: fs, graine: 7 });
  assert.equal(d.champ.impList.length, 0, 'pas de démon au premier niveau');
  d.level = 9;
  d.commencer();
  assert.equal(d.champ.impList.length, 2);
  assert.equal(d.champ.impList[0].level, 3, 'du rang du donjon');
  assert.equal(d.heightCycle, 500, 'et il laisse deux fois plus de temps');
});

test('gagner le donjon fait tourner la fiche', () => {
  // Rang 2 : Ornegon est libéré.
  {
    const { c, fs } = carte({ rang: 2 });
    const d = new X.Donjon({ carte: c, fee: fs, graine: 7 });
    while (!d.fini) viderEtFinirLeTour(d);
    assert.equal(c.$frog, true, 'Ornegon est libre');
    assert.equal(c.$dungeon.$lvl, 3, 'et le donjon passe au rang suivant');
    assert.equal(c.$dungeon.$f, false, 'il disparaît du menu');
    assert.equal(c.$diam, 3);
  }
  // Rang 4 : un arc-en-ciel apparaît, la boucle repart, une couleur de plus.
  {
    const { c, fs } = carte({ rang: 4 });
    const d = new X.Donjon({ carte: c, fee: fs, graine: 7 });
    while (!d.fini) viderEtFinirLeTour(d);
    assert.equal(c.$rainbow.$f, true, 'un arc-en-ciel');
    assert.ok(c.$rainbow.$it !== null);
    assert.equal(c.$dungeon.$loop, 1, 'la boucle repart');
    assert.equal(c.$dungeon.$lvl, 0, 'au premier rang');
    const suivant = new X.Donjon({ carte: c, fee: fs, graine: 8 });
    assert.equal(suivant.jeu.colorList.length, 4, 'avec une couleur de plus');
  }
});

test('traverser le donjon donne de l\'expérience à chaque niveau', () => {
  const { c, fs } = carte({ rang: 3 });
  const d = new X.Donjon({ carte: c, fee: fs, graine: 7 });
  const avant = d.fi ? d.fi.fs.$exp : null;
  assert.ok(avant !== null, 'la fée est du voyage');
  while (!d.fini) viderEtFinirLeTour(d);
  // 1×4 + 2×4 + … + 9×4 pour les neuf premiers, puis 100×3 au dernier.
  const attendu = [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((s, n) => s + n * 4, 0) + 100 * 3;
  assert.equal(d.fi.fs.$exp - avant, attendu);
});

// ── L'arbre creux ─────────────────────────────────────────────────────────

test('l\'arbre creux se joue sans fée, sur une aire décalée', () => {
  const { c, fs } = carte();
  const a = new X.Arbre({ carte: c, fee: fs, graine: 11 });
  assert.equal(a.jeu.margeGauche, 48, 'le tronc mange la colonne de gauche');
  assert.equal(a.jeu.largeur, 196);
  assert.equal(a.champ.faerieList.length, 0, 'elle reste dehors');
  assert.equal(a.jeu.eList.length, 0, 'et la grille est vide');
  assert.equal(a.jeu.monteeAuto, false, 'la chute n\'accélère pas d\'elle-même');
});

test('une bille sur huit arrive blindée', () => {
  const { c, fs } = carte();
  const a = new X.Arbre({ carte: c, fee: fs, graine: 11 });
  let total = 0, blindees = 0;
  for (let i = 0; i < 200; i++) {
    for (const o of a.jeu.nouvelleForme()) {
      total++;
      if (o.e.special === E.SPECIAL.ARMURE) blindees++;
    }
    a.blinder();
  }
  // On mesure sur la réserve, que `blinder` repasse : la proportion visée est
  // d'un huitième.
  const forme = a.jeu.nextList.flat();
  assert.ok(forme.length > 0);
  assert.ok(total > 100, 'assez de billes pour juger');
  assert.ok(blindees === 0, 'nouvelleForme seule n\'en blinde aucune');
  let n = 0, m = 0;
  for (let i = 0; i < 400; i++) {
    a.jeu.viderReserve();
    a.blinder();
    for (const o of a.jeu.nextList.flat()) { n++; if (o.e.special === E.SPECIAL.ARMURE) m++; }
  }
  const part = m / n;
  assert.ok(part > 0.07 && part < 0.19, 'environ un huitième (' + part.toFixed(3) + ')');
});

test('les paliers de l\'arbre ajoutent couleur et multiplicateur ensemble', () => {
  const { c, fs } = carte();
  const paliers = [];
  const a = new X.Arbre({
    carte: c, fee: fs, graine: 11,
    surEvenement: (n, o) => { if (n === 'multiplicateur') paliers.push([o.multi, o.couleurs]); },
  });
  assert.equal(a.multi, 1);
  for (let i = 0; i < 200000 && a.jeu.colorList.length < 6 && !a.fini; i++) {
    if (a.jeu.step === E.ETAPE.JEU) { a.timer += 60; a.jeu.entree.bas = true; }
    a.update(1);
  }
  assert.deepEqual(paliers, [[2, 4], [3, 5], [4, 6]]);
  assert.equal(a.jeu.colorList.length, 6, 'et ça s\'arrête à six couleurs');
});

test('le score de l\'arbre récompense la chaîne, pas la pièce', () => {
  const { c, fs } = carte();
  const a = new X.Arbre({ carte: c, fee: fs, graine: 11 });
  a.score = 0;
  a.multi = 2;
  a.surScore({ liste: [4, 4, 4] });
  // VALUE_LIMIT = [1,5,7,…] : le troisième maillon vaut sept fois le premier.
  assert.equal(a.score, 4 * 1 * 2 + 4 * 5 * 2 + 4 * 7 * 2);
  a.score = 0;
  a.multi = 1;
  a.surScore({ liste: [12] });
  assert.equal(a.score, 12, 'douze billes d\'un coup ne valent que douze');
});

test('le record de l\'arbre entre dans la fiche', () => {
  const { c, fs } = carte();
  const a = new X.Arbre({ carte: c, fee: fs, graine: 11 });
  a.score = 4242;
  a.surFinDePartie({ gagne: false });
  assert.equal(c.$stat.$treeMax, 4242);
  const b = new X.Arbre({ carte: c, fee: fs, graine: 12 });
  b.score = 10;
  b.surFinDePartie({ gagne: false });
  assert.equal(c.$stat.$treeMax, 4242, 'un score moindre ne l\'écrase pas');
});

// ── L'arc-en-ciel ─────────────────────────────────────────────────────────

test('l\'arc-en-ciel part avec ses huit couleurs et sa roue pleine', () => {
  const { c, fs } = carte();
  c.$rainbow = { $f: true, $day: 0, $it: 71 };
  const r = new X.ArcEnCiel({ carte: c, fee: fs, graine: 13 });
  assert.equal(r.jeu.colorList.length, 8);
  assert.equal(r.jeu.hauteur, 226, 'l\'aire est moins haute qu\'ailleurs');
  assert.equal(r.jeu.eList.length, 0);
  assert.equal(r.roue, X.ROUE_DEPART);
  assert.equal(r.prix, 71);
  assert.equal(r.etat().tours, 87, 'quatre-vingt-sept pièces à tenir');
});

test('tenir la roue jusqu\'à zéro donne l\'objet', () => {
  const { c, fs } = carte();
  c.$rainbow = { $f: true, $day: 0, $it: 71 };
  const r = new X.ArcEnCiel({ carte: c, fee: fs, graine: 13 });
  const avant = r.fi.fs.$exp;

  // Quatre-vingt-sept pièces posées, et la roue touche zéro.
  let tours = 0;
  while (!r.sortie && tours < 200) { r.jeu.nouveauTour(); tours++; }
  assert.equal(tours, 87);
  assert.equal(r.fi.fs.$exp - avant, 100, 'la fée y gagne cent points, tout de suite');

  // La SORTIE (base/Rainbow.initStep 21 → 23) commence alors seulement : le
  // lieu n'est pas fini, et l'objet n'est pas encore pris. C'est elle qui rend
  // la clairière — sans elle, on restait bloqué devant un plateau gelé.
  assert.equal(r.fini, false, 'la partie n\'est pas close à l\'instant zéro');
  assert.equal(c.$inv.indexOf(71), -1, 'et l\'objet n\'est pas encore ramassé');

  let images = 0;
  while (!r.fini && images < 5000) { r.update(1); images++; }
  assert.ok(r.fini, `la sortie se termine (bloquée après ${images} images)`);
  assert.equal(r.gagne, true);
  assert.ok(c.$inv.indexOf(71) >= 0, 'l\'objet est dans le sac');
  assert.equal(c.$rainbow.$f, false, 'et l\'arc-en-ciel a quitté le ciel');
  assert.equal(r.fi.fs.$exp - avant, 100, 'l\'expérience n\'a pas été comptée deux fois');
});

test('déborder avant la fin ne donne rien', () => {
  const { c, fs } = carte();
  c.$rainbow = { $f: true, $day: 0, $it: 71 };
  const r = new X.ArcEnCiel({ carte: c, fee: fs, graine: 13 });
  for (let i = 0; i < 20; i++) r.jeu.nouveauTour();
  r.surFinDePartie({ gagne: false });
  assert.equal(r.recolte, false);
  assert.equal(c.$inv.indexOf(71), -1);
  assert.equal(c.$rainbow.$f, true, 'l\'arc-en-ciel est encore là — on peut réessayer');
});

// ── Les missions de Gromelin ──────────────────────────────────────────────

test('les textes de mission sont bien extraits de Lang.mt', () => {
  assert.equal(L.MISSION.length, 8);
  for (const m of L.MISSION) {
    assert.equal(m.desc.length, 4, 'titre, énoncé, réussite, échec');
    assert.ok(m.type.length > 0);
    assert.ok(m.test.length > 0, 'et des caractéristiques à éprouver');
  }
  assert.equal(L.MISSION_DIF.length, 7);
  assert.equal(L.MISSION_DIF_RANK.length, 7);
  assert.ok(L.WORD_BAD_NAME.length > 10);
  assert.ok(L.nameSyl0.every((s) => /^[a-zé]/i.test(s)), 'les syllabes sont nettoyées');
});

test('une même graine raconte toujours la même histoire', () => {
  const info = [2, 0, 7, 300, 4242];
  const a = M.decrire(info, tirage(1));
  const b = M.decrire(info, tirage(999));
  assert.equal(a.titre, b.titre);
  assert.equal(a.enonce, b.enonce);
  assert.equal(a.reussite, b.reussite);
  const autre = M.decrire([2, 0, 7, 300, 4243], tirage(1));
  assert.notEqual(autre.titre, a.titre, 'une autre graine, une autre histoire');
});

test('l\'énoncé remplace tous ses jetons', () => {
  for (let g = 0; g < 60; g++) {
    for (let type = 0; type < L.MISSION.length; type++) {
      const d = M.decrire([3, type, 10, 300, g * 137], tirage(g + 1));
      for (const s of [d.titre, d.enonce, d.reussite, d.echec]) {
        assert.ok(s.indexOf('$') < 0, 'jeton oublié dans « ' + s + ' »');
        assert.ok(s.length > 5);
      }
    }
  }
});

test('la difficulté et la durée s\'écrivent dans l\'énoncé', () => {
  const d = M.decrire([5, 1, 15, 300, 77], tirage(1));
  assert.ok(d.enonce.indexOf('15 jours') >= 0);
  assert.ok(d.enonce.indexOf(L.MISSION_DIF[5].trim()) >= 0);
  assert.equal(d.rang, L.MISSION_DIF_RANK[5].trim());
});

test('les chances montent avec les caractéristiques et tombent avec la difficulté', () => {
  const { c } = carte();
  const faible = F.genererGraine(tirage(1));
  faible.$carac = [1, 1, 1, 1, 1, 1];
  const forte = F.genererGraine(tirage(2));
  forte.$carac = [7, 7, 7, 7, 7, 7];
  const facile = [0, 0, 3, 300, 11];
  const dure = [6, 0, 30, 300, 11];
  assert.ok(M.chances(facile, [forte], c) > M.chances(facile, [faible], c));
  assert.ok(M.chances(facile, [forte], c) > M.chances(dure, [forte], c));
  assert.equal(M.chances(facile, [], c), 0, 'sans personne, aucune chance');
  assert.ok(M.chances(facile, [forte], c) <= 1, 'et jamais plus de cent pour cent');
});

test('envoyer deux fées aide, mais pas au double', () => {
  const { c } = carte();
  const a = F.genererGraine(tirage(1));
  a.$carac = [3, 3, 3, 3, 3, 3];
  const b = F.genererGraine(tirage(2));
  b.$carac = [3, 3, 3, 3, 3, 3];
  const info = [6, 0, 30, 300, 11];
  const une = M.chances(info, [a], c);
  const deux = M.chances(info, [a, b], c);
  assert.ok(deux > une, 'à deux on est meilleur');
  assert.ok(deux < une * 2, 'mais le groupe ne compte pas double');
  // 1 + (2-1)×0,3 = 1,3 : deux fées valent 2/1,3 ≈ 1,54 fois une seule.
  assert.ok(Math.abs(deux / une - 2 / 1.3) < 0.001);
});

test('Gromelin ne prend que les fées en bocal', () => {
  const { c } = carte();
  assert.equal(M.feesDisponibles(c).length, 1);
  c.$faerie[0].$pos = null;
  assert.equal(M.feesDisponibles(c).length, 0, 'une fée libre n\'a pas de laisse');
  c.$faerie[0].$pos = 0;
  c.$faerie[0].$mission = 0;
  assert.equal(M.feesDisponibles(c).length, 0, 'et une fée déjà partie non plus');
});

test('accepter une mission fige le sort tout de suite', () => {
  const { c, fs } = carte();
  c.$stat.$run = 5000;
  N.genererMissions(c, tirage(4));
  const avant = c.$mission.length;
  const r = M.accepter(c, 1, [fs], tirage(5), true);
  assert.ok(r);
  assert.equal(r.victoire, true);
  assert.equal(c.$mission.length, avant - 1, 'la mission quitte l\'étal');
  assert.equal(c.$mis.length, 1, 'et entre dans la sauvegarde');
  assert.equal(fs.$mission, 0, 'la fée est partie');
  assert.equal(c.$mis[0].$gift, r.description.cadeau, 'le cadeau est déjà réservé');
  assert.equal(c.$mis[0].$string, r.description.reussite, 'et la phrase de fin écrite');
  assert.equal(c.$stat.$misNum, 1);
});

test('une mission perdue ne réserve aucun cadeau', () => {
  const { c, fs } = carte();
  c.$stat.$run = 5000;
  N.genererMissions(c, tirage(4));
  const r = M.accepter(c, 0, [fs], tirage(5), false);
  assert.equal(r.victoire, false);
  assert.equal(c.$mis[0].$gift, null);
  assert.equal(c.$mis[0].$string, r.description.echec);
});

test('la mission acceptée se solde à son échéance', () => {
  const { c, fs } = carte();
  c.$stat.$run = 5000;
  N.genererMissions(c, tirage(4));
  const jours = c.$mission[0][2];
  const r = M.accepter(c, 0, [fs], tirage(5), true);
  let messages = [];
  for (let i = 0; i < jours; i++) messages = N.entretien(c, tirage(6)).messages;
  assert.equal(c.$mis.length, 0, 'la mission est close');
  assert.equal(fs.$mission, null, 'la fée est rentrée');
  assert.ok(messages.some((m) => m.indexOf(r.description.reussite) >= 0),
    'et on lit la phrase écrite le jour du départ');
});

test('Gromelin ne travaille pas la nuit', () => {
  const { c } = carte();
  c.$stat.$run = 5000;
  N.genererMissions(c, tirage(4));
  assert.equal(M.accueil(c, 0.1, true).ouvre, false, 'il dort');
  assert.equal(M.accueil(c, 0.5, true).ouvre, true, 'en plein jour, il ouvre');
  c.$mission = null;
  assert.equal(M.accueil(c, 0.5, true).ouvre, false, 'et sans missions, il ne répond pas');
});

test('Gromelin dit ce qu\'il faut selon ce qu\'on lui amène', () => {
  const { c } = carte();
  c.$stat.$run = 5000;
  N.genererMissions(c, tirage(4));
  const premiere = M.accueil(c, 0.5, false);
  assert.equal(premiere.missions, false, 'la première fois, il explique');
  assert.ok(premiere.dial.some((d) => /bocal/.test(d)), 'et il pose sa condition');
  const avec = M.accueil(c, 0.5, true);
  assert.equal(avec.missions, true);
  assert.equal(avec.fees.length, 1);
  c.$faerie[0].$pos = null;
  const sans = M.accueil(c, 0.5, true);
  assert.equal(sans.missions, false);
  assert.ok(sans.dial.some((d) => /bocal/.test(d)));
});

test('la page charge les quatre lieux, et chacun est atteignable', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public/minipixiz/index.html'), 'utf8');
  for (const f of ['langue', 'missions', 'lieux']) {
    assert.match(html, new RegExp('src="/minipixiz/' + f + '\\.js"'));
  }
  assert.match(html, /ouvrirLieu\('Donjon'\)/);
  assert.match(html, /ouvrirLieu\('Arbre'\)/);
  assert.match(html, /ouvrirLieu\('ArcEnCiel'\)/);
  assert.match(html, /ouvrirGromelin\(\)/);
  assert.match(html, /client\.nouveauLieu\(/);
});
