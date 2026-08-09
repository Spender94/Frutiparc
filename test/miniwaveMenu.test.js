// Le menu de Miniwave 2 : ce qu'il propose, et ce qu'il refuse.
//
// C'est lui qui relie la fiche du joueur aux modes : une mission n'apparaît que
// si elle a été achetée, l'escadron ne se compose qu'avec les vaisseaux qu'on
// possède, et le stand ne vend que ce qu'on peut payer. Un menu trop permissif
// laisserait lancer un mode fermé ; trop strict, il rendrait la boutique inutile.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'public/miniwave/plateforme.js'));
const Menu = require(path.join(ROOT, 'public/miniwave/menu.js'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));

test('l\'accueil reprend les rubriques du jeu', () => {
  // « SPECIAL » sans accent : c'est l'étiquette de page/Main.as, et la
  // Jawbreaker du SWF n'a de toute façon pas le É.
  assert.deepEqual(Menu.RUBRIQUES.map((r) => r.nom), ['ARCADE', 'BONUS', 'SPECIAL', 'STAND']);
});

test('sur une fiche neuve, seule l\'arcade est ouverte', () => {
  const e = Menu.entrees(P.carteNeuve(), NIVEAUX);
  assert.equal(e.arcade[0].ouvert, true, 'l\'arcade est offerte');
  assert.equal(e.arcade[0].detail, 'jamais joué');
  assert.equal(e.bonus.length, 5, 'les cinq missions du jeu sont listées');
  assert.ok(e.bonus.every((m) => !m.ouvert), 'toutes fermées');
  assert.ok(e.bonus.every((m) => /acheter/i.test(m.pourAcheter)), 'et on dit pourquoi');
  assert.equal(e.special.length, 2, 'Letter Invader et Endurance');
  assert.ok(e.special.every((s) => !s.ouvert));
});

test('acheter au stand ouvre l\'entrée correspondante au menu', () => {
  const c = P.carteNeuve();
  c.$credit = 1000;
  P.acheter(c, 5);                                  // Mission 1
  P.acheter(c, 9);                                  // Endurance
  const e = Menu.entrees(c, NIVEAUX);
  assert.equal(e.bonus[0].ouvert, true, 'la première mission s\'ouvre');
  assert.equal(e.bonus[1].ouvert, false, 'les autres restent fermées');
  const endurance = e.special.find((s) => s.id === 'survival');
  assert.equal(endurance.ouvert, true);
  assert.equal(e.special.find((s) => s.id === 'letter').ouvert, false);
});

test('chaque entrée sait exactement quoi lancer', () => {
  const c = P.carteNeuve();
  c.$credit = 5000;
  for (const id of [5, 6, 7, 8, 9, 15, 16]) P.acheter(c, id);
  const e = Menu.entrees(c, NIVEAUX);

  const arcade = e.arcade[0].lancement;
  assert.equal(arcade.mode, 'arcade');
  assert.equal(arcade.vies, 4, 'l\'arcade emmène quatre vaisseaux');
  assert.equal(arcade.niveaux.length, 200);

  e.bonus.forEach((m, i) => {
    assert.equal(m.lancement.mode, 'mission');
    assert.equal(m.lancement.missionNum, i, 'la mission connaît son numéro — c\'est lui qui indexe le picto');
    assert.equal(m.lancement.prime, NIVEAUX.bonus[i].prime);
    assert.equal(m.lancement.vies, NIVEAUX.bonus[i].ship);
    assert.equal(m.lancement.niveaux, NIVEAUX.bonus[i].levels);
  });

  const lettres = e.special.find((s) => s.id === 'letter').lancement;
  assert.equal(lettres.mode, 'letter');
  assert.equal(lettres.niveaux.length, 50);
  assert.equal(lettres.vies, 1);
  const endurance = e.special.find((s) => s.id === 'survival').lancement;
  assert.equal(endurance.mode, 'survival');
  assert.deepEqual(endurance.niveaux, [], 'l\'endurance n\'a pas de parcours');
  assert.equal(endurance.vies, 1, 'et un seul vaisseau');
});

test('l\'arcade rappelle le meilleur résultat une fois jouée', () => {
  const c = P.fusionner(P.carteNeuve(), { mode: 'arcade', score: 8400, level: 51, cons: 25 });
  const e = Menu.entrees(c, NIVEAUX);
  assert.match(e.arcade[0].detail, /niveau 52/);
  assert.match(e.arcade[0].detail, /8400/);
});

test('une mission jouée affiche son avancement', () => {
  const c = P.carteNeuve();
  c.$credit = 100;
  P.acheter(c, 5);
  const joue = P.fusionner(c, { mode: 'mission', missionNum: 0, cons: 44, score: 900, prime: 50 });
  const e = Menu.entrees(joue, NIVEAUX);
  assert.match(e.bonus[0].detail, /44 %/);
  assert.match(e.bonus[0].detail, /prime 50/);
});

test('l\'escadron ne se compose qu\'avec les vaisseaux acquis', () => {
  const c = P.carteNeuve();
  assert.deepEqual(Menu.vaisseauxDisponibles(c), [0], 'un seul au départ');
  c.$credit = 2000;
  P.acheter(c, 0);                                  // Proto → vaisseau 1
  P.acheter(c, 3);                                  // Sacuro → vaisseau 4
  assert.deepEqual(Menu.vaisseauxDisponibles(c), [0, 1, 4]);
  assert.deepEqual(Menu.vaisseauxDisponibles(c).map((n) => P.VAISSEAUX[n]),
    ['aliquet', 'proto', 'sacuro']);
});

test('le rayon dit le prix, l\'état et ce que l\'article ouvre', () => {
  const c = P.carteNeuve();
  c.$credit = 100;
  const r = Menu.rayon(c);
  assert.equal(r.length, P.BOUTIQUE.length);

  const proto = r.find((a) => a.id === 0);
  assert.equal(proto.prix, 80);
  assert.equal(proto.achete, false);
  assert.equal(proto.abordable, true);
  assert.equal(proto.ouvre, 'vaisseau proto');

  const rycher = r.find((a) => a.id === 4);
  assert.equal(rycher.abordable, false, '680 crédits, on n\'a que 100');

  assert.equal(r.find((a) => a.id === 5).ouvre, 'mission 1');
  assert.equal(r.find((a) => a.id === 8).ouvre, 'Letter Invader');
  assert.equal(r.find((a) => a.id === 9).ouvre, 'Endurance');
  assert.equal(r.find((a) => a.id === 10).ouvre, 'picto Frutiparc');

  P.acheter(c, 0);
  assert.equal(Menu.rayon(c).find((a) => a.id === 0).achete, true, 'l\'article passe à « acquis »');
});

test('la page monte le menu, la boutique et le clavier des lettres', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/miniwave/index.html'), 'utf8');
  // Le menu est DESSINÉ sur le canevas du jeu, comme dans le SWF : il n'a pas
  // de balisage propre. Ce qu'on vérifie, c'est qu'il est branché.
  assert.match(html, /new Menu\.Interface\(/, 'l\'interface du menu est construite');
  assert.match(html, /poser: window\.MiniwaveClient\.poser/, 'et reçoit le poseur de dessins');
  assert.match(html, /client\.avant = ui/, 'le client lui laisse le canevas quand elle est ouverte');
  assert.match(html, /ui\.auClic\(/, 'les appuis sur le canevas lui sont transmis');
  for (const id of ['clavier', 'message']) {
    assert.ok(html.includes('id="' + id + '"'), `l'élément « ${id} » existe`);
  }
  for (const src of ['modes.js', 'menu.js', 'plateforme.js', 'engine.js', 'game.js', 'sons.js']) {
    assert.ok(html.includes('/miniwave/' + src), `${src} est chargé`);
  }
  // Le clavier ne s'affiche QUE pour Letter Invader — sinon il mangerait la
  // moitié de l'écran pendant les parties qui se jouent à la manette.
  assert.match(html, /\$\('#clavier'\)\.classList\.toggle\('on', lettres\)/);
  assert.match(html, /\$\('#manette'\)\.style\.display = lettres \? 'none' : ''/);
  // Le mode joué DOIT partir avec le relevé de fin : sans lui, une partie
  // d'endurance s'enregistrerait comme une partie d'arcade et fausserait le
  // meilleur niveau, donc le picto.
  assert.match(html, /mode: l\.mode \|\| 'arcade', missionNum: l\.missionNum, prime: l\.prime/);
});

test('le client sait instancier chaque mode', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(src, /\{ mission: M\.Mission, survival: M\.Survival, letter: M\.Letter \}\[opts\.mode\] \|\| E\.Game/,
    'le mode choisit la classe, l\'arcade reste le moteur nu');
  // Et il dessine les lettres, sans quoi le mode serait injouable.
  assert.match(src, /if \(b\.affiche\)/, 'le caractère du monstre est posé sur son dessin');
  assert.match(src, /jeu\.boucliers !== undefined/, 'les boucliers s\'affichent');
});

// ── L'aspect : les mesures et les couleurs viennent du SWF ─────────────────

test('les mesures du menu sont celles des sources', () => {
  // Menu.margin = 10, Menu.marginUp = 54 : la page occupe le reste de l'aire.
  assert.equal(Menu.MARGE, 10);
  assert.equal(Menu.MARGE_HAUT, 54);
  assert.equal(Menu.PAGE_L, 220);              // 240 - 2×10
  assert.equal(Menu.PAGE_H, 176);              // 240 - (10 + 54)
  // Box.init : les deux jeux de couleurs, ouvert et verrouillé.
  assert.deepEqual(Menu.OUVERT, { fond: '#BCBCDA', trait: '#FFFFFF' });
  assert.deepEqual(Menu.FERME, { fond: '#8A8ABD', trait: '#BCBCDA' });
  // Le fond du menu, le rectangle plein de miniWave2Menu.
  assert.equal(Menu.FOND, '#4a4a84');
});

test('un encadré s\'ouvre depuis son coin, puis se referme sur l\'autre', () => {
  // Box.tweenAll : il part de sa position à taille nulle et grandit à vitesse
  // proportionnelle au reste, plafonnée. C'est l'animation du menu — sans elle,
  // les mêmes couleurs paraissent mortes.
  const b = new Menu.Boite({ gx: 20, gy: 30, gw: 100, gh: 20, attente: 0 });
  assert.equal(b.w, 0, 'il naît plat');
  assert.equal(b.x, 20, 'à sa place');
  // La première image ne fait qu'écouler l'attente — c'est le `case 0` de
  // Box.update, qui ne tourne pas la même image que le `case 1`.
  b.update(1);
  assert.equal(b.w, 0, 'l\'attente passe d\'abord');
  b.update(1);
  assert.ok(b.w > 0 && b.w < 100, `puis il s'ouvre (${b.w.toFixed(1)})`);
  let n = 0;
  while (b.etape !== 2 && n++ < 200) b.update(1);
  assert.ok(n < 60, `il finit de s'ouvrir vite (${n} images)`);
  assert.equal(b.w, 100, 'à la taille exacte');
  assert.equal(b.h, 20);
  assert.equal(b.ouverte, true, 'et son contenu apparaît');

  // Box.vanish : il se referme sur son coin bas-droit, puis disparaît.
  b.disparaitre(0);
  assert.equal(b.ouverte, false, 'le contenu s\'efface tout de suite');
  n = 0;
  while (!b.morte && n++ < 200) b.update(1);
  assert.ok(b.morte, 'il finit par disparaître');
  assert.equal(b.gw, 4, 'réduit à un point');
  assert.equal(b.gx, 116, 'sur son coin bas-droit (20 + 100 - 4)');
});

test('un encadré verrouillé n\'ouvre jamais son contenu', () => {
  // Box.tryToInitContent : `if(!this.flLock)`. Un article déjà acheté, une
  // mission qu'on ne possède pas : la case reste sombre et vide.
  const b = new Menu.Boite({ gx: 0, gy: 0, gw: 50, gh: 20, attente: 0, verrou: true });
  for (let i = 0; i < 100 && b.etape !== 2; i++) b.update(1);
  assert.equal(b.etape, 2, 'il s\'ouvre quand même');
  assert.equal(b.ouverte, false, 'mais reste vide');
  assert.deepEqual(b.couleurs, Menu.FERME, 'et sombre');
});

test('l\'attente échelonne les encadrés', () => {
  // Shop.initBox : waitTimer = slotIndex*3. C'est ce décalage qui fait que la
  // grille se déploie en cascade au lieu d'apparaître d'un bloc.
  const a = new Menu.Boite({ gx: 0, gy: 0, gw: 40, gh: 40, attente: 0 });
  const b = new Menu.Boite({ gx: 0, gy: 0, gw: 40, gh: 40, attente: 12 });
  for (let i = 0; i < 8; i++) { a.update(1); b.update(1); }
  assert.ok(a.w > 0, 'le premier est déjà ouvert');
  assert.equal(b.w, 0, 'le second attend encore son tour');
  assert.equal(b.etape, 0);
});

test('le stand garde la grille cinq par trois du jeu', () => {
  // page/Shop.as : xMax=5, yMax=3, marge de 5, bandeau bas de 20.
  const faux = {
    canvas: { getContext: () => ({}), width: 240 },
    sprites: {}, poser: () => {},
    plateforme: { carte: P.carteNeuve() },
    niveaux: NIVEAUX,
  };
  const ui = new Menu.Interface(faux);
  ui.poserPage('stand');
  const cases = ui.boites.filter((b) => b.article);
  assert.equal(cases.length, 15, 'quinze emplacements, comme le jeu');
  const l = (Menu.PAGE_L - 4 * 5) / 5;
  const h = (Menu.PAGE_H - (2 * 5 + 20 + 7)) / 3;
  assert.ok(Math.abs(cases[0].gw - l) < 1e-9, `largeur d'une case (${cases[0].gw})`);
  assert.ok(Math.abs(cases[0].gh - h) < 1e-9, `hauteur d'une case (${cases[0].gh})`);
  // Les cases sont bien alignées en cinq colonnes.
  const colonnes = [...new Set(cases.map((c) => Math.round(c.gx)))];
  assert.equal(colonnes.length, 5);
  assert.equal(cases[5].gx, cases[0].gx, 'la deuxième rangée repart à gauche');
  // Le compteur de crédits et le retour ferment la page.
  assert.ok(ui.boites.some((b) => b.credits), 'le compteur est là');
  assert.ok(ui.boites.some((b) => b.texte === 'RETOUR'), 'et le retour aussi');
  // Et chaque case connaît l'image du clip d'origine (ico.gotoAndStop(id+1)).
  assert.equal(cases[0].article.ico, 1, 'le Proto est à l\'image 1');
  assert.equal(cases[8].article.ico, 9, 'Letter Invader à la 9');
});

test('le stand fait tourner ses deux emplacements, comme le jeu', () => {
  // Shop.initBox : une fois la mission 1 achetée, son emplacement laisse place
  // à la mission 4. La grille ne s'allonge jamais.
  const carte = P.carteNeuve();
  const faux = {
    canvas: { getContext: () => ({}), width: 240 },
    sprites: {}, poser: () => {}, plateforme: { carte }, niveaux: NIVEAUX,
  };
  const ui = new Menu.Interface(faux);
  ui.poserPage('stand');
  assert.equal(ui.boites.filter((b) => b.article)[5].article.id, 5, 'd\'abord la mission 1');

  carte.$credit = 1000;
  P.acheter(carte, 5);
  ui.poserPage('stand');
  const cases = ui.boites.filter((b) => b.article);
  assert.equal(cases[5].article.id, 15, 'puis la mission 4 à sa place');
  assert.equal(cases.length, 15, 'toujours quinze cases');
});

test('les icônes du stand sont bien celles du SWF', () => {
  const sprites = require(path.join(ROOT, 'public/miniwave/sprites/sprites.json'));
  const s = sprites.sprites || sprites;
  assert.ok(s.shopIco, 'le clip des icônes est extrait');
  // Dix-huit articles, donc dix-huit images utilisables.
  for (let f = 1; f <= 18; f++) {
    const e = s.shopIco.etats.find((x) => x.frame === f);
    assert.ok(e && e.pieces.length, `l'image ${f} a un dessin`);
  }
  // Les trois plaques de mission partagent leur fond : c'est ce que le clip
  // d'origine fait, et c'est ce que la liste d'affichage devait retrouver.
  const m1 = s.shopIco.etats.find((x) => x.frame === 6);
  const m2 = s.shopIco.etats.find((x) => x.frame === 7);
  assert.equal(m1.pieces.length, 2, 'un fond plus le numéro');
  assert.equal(m1.pieces[0].fichier, m2.pieces[0].fichier, 'le même fond pour les deux');
  assert.notEqual(m1.pieces[1].fichier, m2.pieces[1].fichier, 'mais pas le même numéro');

  assert.ok(s.titre, 'le logo « mini2wave » est extrait');
  assert.ok(s.piece, 'la pièce du compteur aussi');
  assert.ok(s.specialIco, 'et les vignettes des modes spéciaux');
});
