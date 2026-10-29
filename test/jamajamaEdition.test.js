'use strict';
/*
 * JAMAJAMA — LE MODE ÉDITION ET LES STATISTIQUES, CÔTÉ JEU.
 *
 * « Le mode Edition est inaccessible. Quand on clique sur "Edition" dans le
 * menu principal, ça fait rien. Pareil pour le bouton "Statistiques". » Les
 * deux articles du menu n'étaient pas branchés. Ce fichier tient la
 * transcription des classes du SWF (editor.Playground, editor.Editor,
 * editor.Panel, editlist.EditList, statlist.State) : ce qu'un clic pose, ce
 * qu'une touche change, ce que la liste propose, et la partie d'essai qui
 * rend la main à l'éditeur au lieu du menu.
 *
 * Les écrans tournent ici sans navigateur : un faux rendu (le manifeste des
 * dessins, sans pixels) et un faux document suffisent à leur logique.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const R = require('../public/jamajama/regles.js');
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/jamajama/sprites/sprites.json'), 'utf8'));
const { Element, Direction, Coord, Dimension, Level, Consts } = R;

function fauxElement() {
  return {
    style: {}, value: '', className: '', innerHTML: '', scrollTop: 0,
    addEventListener() {}, remove() {}, appendChild() {}, focus() {}, select() {},
    querySelectorAll: () => [],
  };
}
function charger() {
  const symbole = (cle) => { const s = M.symboles[cle]; if (!s) throw new Error(cle); return s; };
  const Rendu = {
    symbole,
    etatDe: (s, f) => s.etats.find((e) => e.frame === (f || 1)) || s.etats[0],
    zoneBouton: (cle) => symbole(cle).hit || null,
    manifeste: () => M,
    longueur: (cle) => symbole(cle).etats.length,
    dessiner() {}, ecrireChamp() {},
  };
  const fenetre = { JamaRegles: R, JamaRendu: Rendu, addEventListener() {} };
  const doc = { createElement: fauxElement, body: fauxElement() };
  for (const f of ['ecrans.js', 'edition.js', 'stats.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'public/jamajama', f), 'utf8');
    new Function('window', 'document', 'fetch', src)(fenetre, doc,
      () => Promise.resolve({ json: () => ({ ok: false }) }));
  }
  return fenetre;
}
const F = charger();
const E = F.JamaEdition;
const S = F.JamaStats;

function niveauNeuf(w, h) {
  const l = new Level();
  l.id = -1;
  l.title = 'essai';
  l.size = new Dimension(w, h);
  return l;
}
const hoteFactice = () => ({
  canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 384, height: 384 }) },
  echelle: () => 1,
});
// Le centre d'une case du plateau, en coordonnées d'écran.
const caseEcran = (t, x, y) => ({ x: t.padX + x * 32 + 16, y: t.padY + y * 32 + 16 });
const clic = (p) => ({ x: p.x, y: p.y, clic: true });

test('le plateau de l’éditeur : poser vide la case, Tiki est unique, le niveau se relit', () => {
  const t = new E.Terrain(new Dimension(5, 4));
  t.setLevel(niveauNeuf(5, 4));
  assert.ok(t.modifie, 'un niveau neuf (id −1) naît « modifié », comme setLevel');
  assert.equal(t.sprites.length, 1, 'le héros posé sur la case de départ');
  const mur = { id: Element.WALL, orientation: 0, param: -1 };
  assert.ok(t.ajouter(mur, new Coord(2, 1)));
  assert.ok(!t.ajouter(mur, new Coord(5, 1)), 'hors du plateau, rien');
  // Une caisse sur le mur : la case est vidée avant (addSprite efface dessus
  // ET dessous).
  t.ajouter({ id: Element.BOX, orientation: 0, param: -1 }, new Coord(2, 1));
  assert.equal(t.elementEn(new Coord(2, 1)).id, Element.BOX);
  assert.equal(t.sprites.filter((s) => s.pos.x === 2 && s.pos.y === 1).length, 1);
  // Tiki reposé ailleurs : l'ancien s'en va.
  t.ajouter({ id: Element.HERO, orientation: Direction.EAST, param: -1 }, new Coord(4, 3));
  assert.equal(t.sprites.filter((s) => s.id === Element.HERO).length, 1);
  // Les avatars se tournent vers le sud (show), Kohl garde son orientation.
  t.ajouter({ id: Element.LOUKI, orientation: Direction.EAST, param: -1 }, new Coord(0, 0));
  t.ajouter({ id: Element.KOHL, orientation: Direction.WEST, param: -1 }, new Coord(1, 0));
  assert.equal(t.elementEn(new Coord(0, 0)).orientation, Direction.SOUTH);
  assert.equal(t.elementEn(new Coord(1, 0)).orientation, Direction.WEST);
  // Le paramètre d'une bombe absent : son défaut, 5.
  t.ajouter({ id: Element.BOMB, orientation: 0, param: -1 }, new Coord(3, 0));
  assert.equal(t.elementEn(new Coord(3, 0)).param, 5);

  const l = t.toLevel();
  assert.deepEqual([l.startPos.x, l.startPos.y], [4, 3], 'le héros devient la case de départ');
  assert.ok(!l.tiles.some((e) => e.id === Element.HERO), 'et n’est pas une tuile');
  const relu = Level.depuisChaine(l.dump());
  assert.equal(relu.dump(), l.dump(), 'le niveau se réécrit à l’identique');
  // L'ordre de pose est celui des tuiles (l'aide : « De l'importance de
  // l'ordre de placement »).
  assert.deepEqual(l.tiles.map((e) => e.id), [Element.BOX, Element.LOUKI, Element.KOHL, Element.BOMB]);

  const t2 = new E.Terrain(relu.size);
  relu.id = 7;
  t2.setLevel(relu);
  assert.ok(!t2.modifie, 'un niveau relu n’est pas modifié');
  assert.equal(t2.toLevel().dump(), l.dump());
  t2.effacerEn(new Coord(2, 1));
  assert.equal(t2.elementEn(new Coord(2, 1)), null, 'la suppression');
  assert.ok(t2.modifie);
});

test('l’éditeur : la sortie par défaut, les trois curseurs, la palette, les touches', () => {
  const ed = new E.EcranEditeur(hoteFactice(), niveauNeuf(6, 5));
  const t = ed.terrain;
  assert.equal(ed.curseur.id, Element.EXIT, '« par défaut la sortie »');
  assert.equal(ed.palette.length, 22, 'les vingt-deux éléments de l’aide');
  assert.ok(!ed.palette.some((s) => s.id === Element.PIN || s.id === Element.GHOST));

  ed.update(1, clic(caseEcran(t, 4, 3)), []);
  assert.equal(t.elementEn(new Coord(4, 3)).id, Element.EXIT, 'un clic pose l’élément du curseur');

  // Le panneau : la barre de titre en bas (MINIMAL), son bouton l'ouvre.
  ed.update(1, clic({ x: 10, y: 376 }), []);
  assert.equal(ed.mode, 2, 'MEDIUM');
  // Un clic sous le haut du panneau ne pose rien sur le plateau.
  const avant = t.sprites.length;
  ed.update(1, clic({ x: 200, y: 300 }), []);
  assert.equal(t.sprites.length, avant);
  // La flèche droite de la barre : l'élément suivant (Tiki).
  ed.update(1, clic({ x: 368, y: 314 + 30 }), []);
  assert.equal(ed.choisi().id, Element.HERO);
  assert.equal(ed.curseur.id, Element.HERO, 'faire défiler la palette reprend le curseur d’ajout');
  // Le bouton « sauvegarder » remonte à l'état.
  assert.equal(ed.update(1, clic({ x: 50, y: 285 + 8 }), []), 'sauver');
  assert.equal(ed.update(1, clic({ x: 250, y: 285 + 8 }), []), 'tester');
  assert.equal(ed.update(1, clic({ x: 160, y: 285 + 8 }), []), 'valider');
  assert.equal(ed.update(1, clic({ x: 340, y: 285 + 8 }), []), 'quitter');
  // Espace : le panneau se replie, et le curseur d'ajout revient.
  ed.update(1, null, [' ']);
  assert.equal(ed.mode, 1);

  // Les touches du curseur d'élément : Page suivante = élément suivant.
  ed.update(1, { x: 100, y: 100, clic: false }, ['PageUp']);
  assert.equal(ed.curseur.id, Element.FRUIT);
  assert.equal(ed.curseur.param, 1, 'le fruit naît en 1');
  ed.update(1, { x: 100, y: 100, clic: false }, ['ArrowDown']);
  assert.equal(ed.curseur.param, 1, 'sous 1, le fruit repart à 1 (Fruit.setParameter)');
  for (let i = 0; i < 5; i++) ed.update(1, { x: 100, y: 100, clic: false }, ['ArrowUp']);
  assert.equal(ed.curseur.param, 1, 'au-delà de 5, aussi');
  ed.update(1, { x: 100, y: 100, clic: false }, ['ArrowUp']);
  assert.equal(ed.curseur.param, 2);
  ed.update(1, { x: 100, y: 100, clic: false }, ['PageUp', 'PageUp']);
  assert.equal(ed.curseur.id, Element.WALL);
  ed.update(1, { x: 100, y: 100, clic: false }, ['PageUp', 'PageUp', 'PageUp', 'PageUp', 'PageUp']);
  assert.equal(ed.curseur.id, Element.ONE_WAY, 'mur, eau, pont, cailloux, rune, voie unique');
  ed.update(1, { x: 100, y: 100, clic: false }, ['ArrowLeft']);
  assert.equal(ed.curseur.orientation, Direction.WEST, 'les flèches orientent la voie unique');
  ed.update(1, clic(caseEcran(t, 1, 1)), []);
  assert.equal(t.elementEn(new Coord(1, 1)).orientation, Direction.WEST);

  // Inser : le curseur de déplacement soulève l'élément, qui devient le
  // curseur — on le repose ailleurs.
  ed.update(1, null, ['Insert']);
  ed.update(1, clic(caseEcran(t, 1, 1)), []);
  assert.equal(t.elementEn(new Coord(1, 1)), null);
  assert.equal(ed.curseur.id, Element.ONE_WAY);
  assert.equal(ed.curseur.orientation, Direction.WEST);
  ed.update(1, clic(caseEcran(t, 2, 2)), []);
  assert.equal(t.elementEn(new Coord(2, 2)).id, Element.ONE_WAY);
  // Suppr : le curseur de suppression.
  ed.update(1, null, ['Delete']);
  ed.update(1, clic(caseEcran(t, 2, 2)), []);
  assert.equal(t.elementEn(new Coord(2, 2)), null);
  // Fin : retour au curseur d'ajout.
  ed.update(1, null, ['End']);
  assert.equal(ed.curseur.type, 1);
});

test('l’éditeur : la lentille tourne et varie, l’aide ouvre le grand panneau', () => {
  const ed = new E.EcranEditeur(hoteFactice(), niveauNeuf(4, 4));
  ed.basculer();                                  // MEDIUM
  const lx = ed.barreW / 2, ly = 314 + ed.barreH / 2;
  const z = (n) => ({ x: lx + ed.z[n].x + ed.z[n].w / 2, y: ly + ed.z[n].y + ed.z[n].h / 2, clic: true });
  const o = ed.choisi().orientation;
  ed.update(1, z('tourner'), []);
  assert.equal(ed.choisi().orientation, Direction.next(o), 'Π fait pivoter');
  ed.choisirElement(Element.BOMB, Direction.SOUTH, 9);
  const lyB = 314 + ed.barreH / 2;
  ed.update(1, { x: lx + ed.z.varier.x + 5, y: lyB + ed.z.varier.y + 5, clic: true }, []);
  assert.equal(ed.choisi().param, 1, '→ fait varier la bombe, de 9 à 1');
  ed.update(1, z('aide'), []);
  assert.equal(ed.mode, 3, 'le « ? » ouvre le panneau d’aide (FULL)');
  ed.basculer();
  assert.equal(ed.mode, 1);
  ed.basculer();
  assert.equal(ed.mode, 3, 'rouvert, le panneau se souvient de l’aide');
});

test('la liste des niveaux du joueur : cases vides, double clic, boutons', () => {
  const niveaux = [
    { id: 4, titre: 'brouillon', contenu: '10021', valide: false },
    { id: 9, titre: 'publié', contenu: '10021', valide: true, record: 12 },
  ];
  const L = new E.EcranListeEdition(niveaux, 20);
  const entrees = L.entrees();
  assert.equal(entrees.length, 15);
  assert.equal(entrees[2].titre, Consts.EMPTY_LEVEL_TITLE, 'les cases restantes sont « ... vide ... »');
  const ligne = (i) => ({ x: 100, y: 50 + (i - 1) * L.hauteurLigne + 5, clic: true });
  const z = (n) => ({ x: L.z[n].x + 5, y: L.z[n].y + 5, clic: true });
  assert.equal(L.update(1, ligne(2)), null, 'un clic choisit');
  assert.deepEqual(L.update(1, ligne(2)), { action: 'nouveau' }, 'le double clic sur une case vide crée');
  L.update(1, ligne(0));
  assert.deepEqual(L.update(1, z('butEdit')), { action: 'editer', entree: niveaux[0] });
  assert.deepEqual(L.update(1, z('butDelete')), { action: 'supprimer', entree: niveaux[0] });
  assert.deepEqual(L.update(1, z('butProp')), { action: 'proprietes', entree: niveaux[0] });
  assert.equal(L.update(1, z('butPlay')), null, 'le bouton de lecture : « aucun effet. :) »');
  L.update(1, ligne(1));
  assert.equal(L.update(1, z('butEdit')), null, 'un niveau validé ne s’édite plus');
  // La pagination : quinze par page, et la page d'après tant qu'il reste des cases.
  const P = new E.EcranListeEdition(Array.from({ length: 15 }, (_, i) => ({ id: i + 1, titre: 'n' + i })), 60);
  P.update(1, z('butNext'));
  assert.equal(P.page, 1, 'la page suivante, pleine de cases vides');
  assert.equal(P.entrees()[0].id, -1);
  P.update(1, z('butNext'));
  assert.equal(P.page, 1, 'mais pas au-delà');
});

test('la partie d’essai rend la main à l’éditeur, pas au menu', () => {
  const fausse = () => ({ nom: 'partie', update() {}, dessiner() {} });
  const lancer = (chaine) => {
    const r = { bilan: null, source: null };
    r.essai = E.EtatEssai({ partie: (n, s) => { r.source = s; return fausse(); } },
      Level.depuisChaine(chaine), (b) => { r.bilan = b; });
    return r;
  };
  // Tiki, et la sortie à sa droite.
  let r = lancer('10021010-10');
  assert.equal(r.source.type, 'essai', 'rien ne part au classement');
  r.source.surFin([Direction.EAST]);
  assert.equal(r.essai.intercepter({ nom: 'menu' }), true, 'la partie croit rentrer au menu : interceptée');
  assert.ok(r.bilan.victorieux, 'la victoire est rendue à l’éditeur');
  assert.deepEqual(r.bilan.mouvements, [Direction.EAST], 'avec ses mouvements (la validation les envoie)');
  assert.equal(r.essai.intercepter({ nom: 'menu' }), false, 'une fois sorti, l’essai laisse passer');
  // « encore » (le dialogue d'abandon) : la partie relancée remplace l'autre.
  r = lancer('10021010-10');
  r.source.surFin([]);
  assert.equal(r.essai.intercepter(fausse()), true);
  assert.equal(r.bilan, null, 'l’essai continue');
  // « oui » : l'abandon ramène à l'éditeur, sans victoire.
  r.source.surFin([]);
  r.essai.intercepter({ nom: 'menu' });
  assert.ok(r.bilan && !r.bilan.victorieux && !r.bilan.fini);
  // La défaite (une araignée à côté de Tiki) rend l'éditeur aussitôt, sans
  // « Recommencer ? » : c'est onDefeat de TestState et de ValidateState.
  r = lancer('10031610-13020-10');
  r.source.surFin([]);
  r.essai.update(1);
  assert.ok(r.bilan && r.bilan.fini && !r.bilan.victorieux);
});

test('les statistiques : les colonnes de _createStat, onglet par onglet', () => {
  assert.equal(S.MODES, 'PCLO');
  assert.deepEqual(S.LIBELLES, ['Joueurs', 'Createurs', 'Niveaux', 'Mes niveaux']);
  assert.deepEqual(S.colonnes('P', { u: 'bob', s: '3' }), { col1: 'bob', col2: '3' });
  assert.deepEqual(S.colonnes('L', { u: 'Toad06', t: 'La roulette russe', s: '14' }),
    { col1: 'Toad06 -- La roulette russe', col2: '14' });
  assert.deepEqual(S.colonnes('L', { u: 'Toad06', t: 'X', np: '2 essai(s)' }).col2, '2 essai(s)',
    'sans score, le nombre de parties');
  assert.deepEqual(S.colonnes('O', { t: 'Mon niveau', np: '0 essai(s)' }), { col1: 'Mon niveau', col2: '0 essai(s)' });
  assert.deepEqual(S.colonnes('C', { u: 'alice', s: '2' }), { col1: 'alice', col2: '2' });
  // Le menu déroulant s'ouvre vers le haut ; un article choisi devient le courant.
  const ecran = new S.EcranStats();
  assert.equal(ecran.update(1, { x: 50, y: Consts.HEIGHT - 12, clic: true }), null);
  assert.ok(ecran.choix.ouvert);
  const a = ecran.update(1, { x: 50, y: Consts.HEIGHT - 20 - 4 * 20 + 8, clic: true });
  assert.deepEqual(a, { mode: 3 }, '« Mes niveaux », le quatrième, au plus haut');
  assert.ok(!ecran.choix.ouvert);
});

test('le menu branche l’Édition et les Statistiques', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/jamajama/jeu.js'), 'utf8');
  assert.match(src, /id === 4\) passer\(window\.JamaEdition\.EtatEdition\(hote\)\)/);
  assert.match(src, /id === 5\) passer\(window\.JamaStats\.EtatStats\(hote\)\)/);
  const html = fs.readFileSync(path.join(ROOT, 'public/jamajama/index.html'), 'utf8');
  assert.ok(html.indexOf('edition.js') > html.indexOf('ecrans.js') && html.indexOf('edition.js') < html.indexOf('jeu.js'));
  assert.ok(html.indexOf('stats.js') < html.indexOf('jeu.js'));
});
