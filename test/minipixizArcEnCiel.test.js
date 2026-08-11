/*
 * Trois accrocs de MiniPixiz light, relevés en jeu.
 *
 * 1. L'ARC-EN-CIEL NE RENDAIT JAMAIS LA MAIN. La roue vidée, le portage gelait
 *    la partie, empochait l'objet… et s'arrêtait là. Le joueur restait devant
 *    un plateau figé, la fée volant dans le vide, sans autre issue que de
 *    recharger la page. Il manquait les trois temps que base/Rainbow.mt joue
 *    avant de rendre la clairière (initStep 21 → 23) : la roue qui s'en va, la
 *    vague de lumière qui balaie le plateau, le lot qui remonte — et le
 *    `tryToClose` du bout.
 *
 * 2. LES PARCHEMINS NE DISAIENT PAS LEUR SORT. « Ce parchemin permet à la fée
 *    qui le porte de lancer ce sort » : on le savait déjà. Le nom et l'effet
 *    du sort existaient (Spell.getName / getDesc) mais n'arrivaient pas
 *    jusqu'à l'objet.
 *
 * 3. LE PANNEAU DE GAME OVER ÉTAIT DÉCADRÉ. Dessiné à 240 % au lieu de 100, et
 *    posé au centre : on n'en voyait qu'un morceau, poussé en bas à droite.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const L = require(path.join(ROOT, 'public/minipixiz/lieux.js'));
const P = require(path.join(ROOT, 'public/minipixiz/plateforme.js'));
const O = require(path.join(ROOT, 'public/minipixiz/items.js'));
const S = require(path.join(ROOT, 'public/minipixiz/sorts.js'));

// Un arc-en-ciel prêt à être gagné, sur une fiche neuve.
function arcEnCiel(surEvenement) {
  const carte = P.carteNeuve();
  carte.$rainbow = { $day: 0, $f: true, $it: 100 };   // le lot : un parchemin
  const lieu = new L.ArcEnCiel({ carte, graine: 7, fee: null, surEvenement });
  return { carte, lieu };
}

// On joue jusqu'à ce que la pile existe — le balayage doit avoir de quoi
// effacer — mais SANS déborder : une partie perdue n'a pas de sortie.
function garnir(lieu, combien) {
  for (let i = 0; i < 4000 && !lieu.fini && lieu.jeu.eList.length < combien; i++) lieu.update(1);
  assert.ok(!lieu.fini, 'la partie de préparation ne doit pas être perdue');
  assert.ok(lieu.jeu.eList.length > 0, 'le plateau porte des billes');
}

// ── 1 · L'arc-en-ciel rend la main ────────────────────────────────────────

test('la roue vidée, l\'arc-en-ciel joue sa sortie et ferme la partie', () => {
  const vus = [];
  const { carte, lieu } = arcEnCiel((n) => vus.push(n));
  garnir(lieu, 20);
  const billes = lieu.jeu.eList.length;

  lieu.roue = L.ROUE_PAS;
  lieu.surNouveauTour();
  assert.equal(lieu.fini, false, 'la sortie commence, le lieu n\'est pas encore fini');
  assert.equal(lieu.sortie.etape, 21, 'on entre par l\'étape 21 (la roue s\'en va)');

  let images = 0;
  while (!lieu.fini && images < 5000) { lieu.update(1); images++; }

  assert.ok(lieu.fini, `la partie se ferme (bloquée après ${images} images)`);
  assert.ok(lieu.gagne, 'et elle est gagnée');
  assert.ok(images > 60, 'la sortie prend le temps de se jouer, elle ne saute pas');
  assert.equal(lieu.jeu.eList.length, 0, 'le plateau a été balayé');
  assert.equal(vus.filter((n) => n === 'balaiLumiere').length, billes,
    'chaque bille effacée a jeté sa gerbe de lumière');
  assert.equal(vus.filter((n) => n === 'finPartie').length, 1,
    'un finPartie, et un seul — c\'est lui que la page attend pour rouvrir la clairière');
  assert.ok(vus.indexOf('prixMonte') >= 0, 'le lot est remonté du bas de l\'écran');
  assert.equal(carte.$rainbow.$f, false, 'l\'arc-en-ciel s\'est effacé du ciel');
});

test('l\'objet n\'est empoché qu\'une fois la roue sortie', () => {
  // base/Rainbow : `grab` est à l'étape 22, pas quand la roue touche zéro. Le
  // ramassage anticipé aurait rendu l'objet même si l'on quittait pendant la
  // sortie.
  const vus = [];
  const { carte, lieu } = arcEnCiel((n) => vus.push(n));
  garnir(lieu, 20);
  lieu.roue = L.ROUE_PAS;
  lieu.surNouveauTour();

  assert.equal(vus.indexOf('prix'), -1, 'rien n\'est pris à l\'instant où la roue se vide');
  assert.equal(carte.$rainbow.$f, true, 'et l\'arc-en-ciel est toujours au ciel');

  // La pause de l'étape 21 dure vingt images, puis la roue glisse.
  for (let i = 0; i < 15; i++) lieu.update(1);
  assert.equal(lieu.sortie.etape, 21, 'pendant la pause, on est encore à l\'étape 21');
  assert.equal(vus.indexOf('prix'), -1, 'toujours rien de pris');

  let images = 0;
  while (lieu.sortie && lieu.sortie.etape === 21 && images < 2000) { lieu.update(1); images++; }
  assert.ok(vus.indexOf('prix') >= 0, 'l\'objet est pris quand la roue a quitté l\'écran');
});

test('la sortie donne au client de quoi la dessiner', () => {
  const { lieu } = arcEnCiel(() => {});
  garnir(lieu, 20);
  assert.equal(lieu.etat().sortie, null, 'rien à dessiner tant qu\'on joue');

  lieu.roue = L.ROUE_PAS;
  lieu.surNouveauTour();
  for (let i = 0; i < 40; i++) lieu.update(1);
  const e = lieu.etat();
  assert.equal(e.sortie.etape, 21, 'l\'étape voyage');
  assert.ok(e.sortie.roueX > 0, 'et le décalage de la roue aussi');

  let images = 0;
  while (lieu.sortie && lieu.sortie.etape !== 23 && images < 5000) { lieu.update(1); images++; }
  const lot = lieu.etat().sortie.lot;
  assert.ok(lot && lot.y > 0, 'à l\'étape 23, le lot a une position');
  assert.ok(lot.vy < 0, 'et il monte');
});

// ── 2 · Les parchemins disent leur sort ───────────────────────────────────

test('un parchemin annonce le sort qu\'il enseigne, et ce qu\'il fait', () => {
  const it = O.info(103);                       // 100 + 3 → le Météore
  const sort = S.nouveauSort(3, null);
  assert.match(it.nom, /Parchemin/, 'ça reste un parchemin');
  assert.ok(it.nom.indexOf(sort.nom()) >= 0, `le nom du sort y figure (${it.nom})`);
  assert.equal(it.desc, sort.description(), 'et la description est celle du sort');
  assert.notEqual(it.desc, 'Ce parchemin permet à la fée qui le porte de lancer ce sort.',
    'plus la phrase qui n\'apprenait rien');
  assert.equal(it.sort, 3, 'le sort reste lisible pour le reste du jeu');
  assert.equal(it.flEquip, true, 'et il se porte toujours');
});

test('un grimoire aussi, et tous les sorts de la table savent se présenter', () => {
  const g = O.info(210);
  assert.match(g.nom, /Livre/, 'le grimoire reste un livre');
  assert.equal(g.desc, S.nouveauSort(10, null).description(), 'il décrit son sort');

  // La table de tirage est ce qu'un joueur peut réellement trouver : aucun de
  // ces parchemins ne doit retomber sur le texte passe-partout.
  for (const o of S.TABLE) {
    const it = O.info(100 + o.id);
    assert.ok(it, `le parchemin du sort ${o.id} existe`);
    assert.ok(it.desc && it.desc.length > 10, `sort ${o.id} : une description (${it.desc})`);
    assert.notEqual(it.desc, 'Ce parchemin permet à la fée qui le porte de lancer ce sort.',
      `sort ${o.id} : pas le texte passe-partout`);
    assert.notEqual(it.nom, 'Parchemin de sort', `sort ${o.id} : pas le nom passe-partout`);
  }
});

test('un sort inconnu retombe sur le texte d\'époque plutôt que de casser', () => {
  const it = O.info(199);                       // 100 + 99 : ce sort n'existe pas
  assert.ok(it, 'l\'objet existe quand même');
  assert.equal(it.nom, 'Parchemin de sort', 'nom d\'époque');
  assert.equal(it.desc, 'Ce parchemin permet à la fée qui le porte de lancer ce sort.',
    'description d\'époque');
});

// ── 3 · Le panneau de Game Over tient dans l'écran ────────────────────────

test('le panneau de défaite est dessiné à sa taille, pas à 240 %', () => {
  // Le dessin fait DÉJÀ 240 × 240 unités (comme les `cadre…`), pas cent. Le
  // rendre à `SCENE` revenait à l'agrandir 2,4 fois, et le poser au centre
  // n'en laissait voir qu'un coin.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /rendre\(this\.sprites\.panPerdu, 1, 100\), 0, 0\)/,
    'panPerdu : échelle 100, coin en (0,0)');
  assert.doesNotMatch(src, /rendre\(this\.sprites\.panPerdu, 1, SCENE\)/,
    'plus de rendu à 240 %');

  // Et le dessin est bien aux dimensions de la scène : c'est ce qui justifie
  // l'échelle 100. Si un jour le sprite est ré-extrait sur cent unités, ce
  // test tombe et il faudra revoir l'appel.
  const sprites = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  const etat = sprites.panPerdu.etats[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of etat.pieces) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h);
  }
  assert.equal(Math.round(x1 - x0), 240, 'panPerdu fait 240 unités de large');
  assert.equal(Math.round(y1 - y0), 240, 'et 240 de haut');
  assert.equal(Math.round(x0), 0, 'son coin est à l\'origine');
  assert.equal(Math.round(y0), 0, 'en x comme en y');
});
