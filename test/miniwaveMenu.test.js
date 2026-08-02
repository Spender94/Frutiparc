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
  assert.deepEqual(Menu.RUBRIQUES.map((r) => r.nom), ['ARCADE', 'BONUS', 'SPÉCIAL', 'STAND']);
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
  for (const id of ['accueil', 'choix', 'escadron', 'boutique', 'clavier', 'message']) {
    assert.ok(html.includes('id="' + id + '"'), `l'écran « ${id} » existe`);
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
