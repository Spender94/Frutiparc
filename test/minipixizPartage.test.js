/*
 * Minipixiz — l'état PARTAGÉ entre le SWF et le portage natif.
 *
 * Un joueur doit pouvoir jouer au Minipixiz Flash puis au Minipixiz natif, et
 * retrouver la même partie. Les deux clients n'écrivent pourtant pas pareil :
 *
 *   le SWF (patché)   poste un PIPE de trente-cinq champs, que le serveur
 *                     convertit en JSON (parseMinipixizPipe) ;
 *   le portage natif  poste directement le JSON de la fiche.
 *
 * Le serveur, lui, sert la MÊME fiche JSON aux deux (padMinipixizSlot0). Ce
 * fichier vérifie que rien ne se perd sur ce chemin — c'est la seule garantie
 * qu'un joueur ne verra pas sa progression fondre en changeant de client.
 *
 * On travaille ici sans serveur : on éprouve les deux bouts (le format du pipe
 * d'un côté, ce que le portage lit et réécrit de l'autre) sur les mêmes
 * fonctions que le serveur emploie.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const P = require('../public/minipixiz/plateforme.js');
const O = require('../public/minipixiz/items.js');
const M = require('../public/minipixiz/missions.js');
const { parseFaerieField } = require('../minipixizFaerie.js');

// Le champ « fée » du pipe, tel que le SWF le sérialise.
// minipixizFaerie.parseFaerieToken en donne l'ordre ; les tableaux se séparent
// au tilde, les champs aux deux-points, les fées à la virgule.
const FEE_PIPE = [
  'Zaltina', '3', '5', '740', '12', '7', '4', '0', '2', '6', '', '1',
  '4~2~3~2~5~3', '2~16711680~255~65280', '3~1', '70~~301',
  '20~0~7', '10~10~30', '', '0~0~1', '2~5', '7',
].join(':');

// Une sauvegarde Flash complète, avec une progression reconnaissable.
const PIPE = [
  'true,false,true,,,true',       // 0  $stat.$item
  '3,0,7,1',                      // 1  $stat.$eat
  '11,4,2,0,0',                   // 2  $stat.$kill
  '18320',                        // 3  $stat.$run
  '9,2,1,0,3',                    // 4  $stat.$game
  '41',                           // 5  $stat.$forestMax
  '2750',                         // 6  $stat.$treeMax
  '4',                            // 7  $stat.$misNum
  '2',                            // 8  $diam
  '3',                            // 9  $key
  '5',                            // 10 $star
  '2',                            // 11 $bag
  '3',                            // 12 $dungeon.$lvl
  'true',                         // 13 $dungeon.$f
  'true',                         // 14 $rainbow.$f
  '2',                            // 15 $pond.$q
  'true',                         // 16 $frog
  FEE_PIPE,                       // 17 $faerie
  '1.2',                          // 18 $vs
  '70,,301,45',                   // 19 $inv
  '0',                            // 20 $current
  '40',                           // 21 $checkpoint
  '1700000000000',                // 22 $time.$t
  '57',                           // 23 $time.$d
  '36000000',                     // 24 $time.$s
  '1',                            // 25 $pond.$d
  '50',                           // 26 $dungeon.$day
  '1',                            // 27 $dungeon.$loop
  '0',                            // 28 $rainbow.$day
  '71',                           // 29 $rainbow.$it
  '0.42',                         // 30 $wind
  'true,false,false',             // 31 $god
  'true,true,true',               // 32 $help
  '4~300~1~a%20r%E9ussi%20la%20mission%20%21',    // 33 $mis
  '0~2~3~300~4242,2~1~5~301~77',                  // 34 $mission
].join('|');

// Le serveur est un gros fichier qui démarre des écoutes : on n'en prend que
// les deux fonctions qui nous regardent, en les isolant de leur module.
function fonctionsDuServeur() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const morceau = (nom) => {
    const debut = src.indexOf('function ' + nom + '(');
    assert.ok(debut > 0, nom + ' introuvable dans server.js');
    let prof = 0, i = src.indexOf('{', debut);
    for (; i < src.length; i++) {
      if (src[i] === '{') prof++;
      else if (src[i] === '}') { prof--; if (prof === 0) return src.slice(debut, i + 1); }
    }
    throw new Error(nom + ' : accolade non fermée');
  };
  const code = morceau('parseMinipixizPipe') + '\n' + morceau('padMinipixizSlot0')
    + '\n' + morceau('minipixizReconcileMissions')
    + '\nreturn { parseMinipixizPipe, padMinipixizSlot0 };';
  // eslint-disable-next-line no-new-func
  return new Function('parseFaerieField', 'synthesizeFaerieDefaults', code)(
    parseFaerieField, require('../minipixizFaerie.js').synthesizeFaerieDefaults);
}

const S = fonctionsDuServeur();

// Le chemin complet d'une sauvegarde Flash jusqu'à la fiche que le portage lit.
function ficheDepuisLeSwf() {
  const obj = S.parseMinipixizPipe(PIPE);
  assert.ok(obj, 'le pipe se lit');
  return JSON.parse(S.padMinipixizSlot0(JSON.stringify(obj)));
}

// ── Ce que le portage lit d'une partie Flash ──────────────────────────────

test('la progression d\'une partie Flash arrive entière dans le portage', () => {
  const c = ficheDepuisLeSwf();
  assert.equal(c.$stat.$run, 18320);
  assert.equal(c.$stat.$forestMax, 41);
  assert.equal(c.$stat.$treeMax, 2750);
  assert.equal(c.$stat.$misNum, 4);
  assert.deepEqual(c.$stat.$kill, [11, 4, 2, 0, 0]);
  assert.deepEqual(c.$stat.$game, [9, 2, 1, 0, 3]);
  assert.deepEqual(c.$stat.$eat, [3, 0, 7, 1]);
  assert.equal(c.$diam, 2);
  assert.equal(c.$key, 3);
  assert.equal(c.$star, 5);
  assert.equal(c.$bag, 2);
  assert.equal(c.$checkpoint, 40);
  assert.equal(c.$frog, true);
  assert.equal(c.$current, 0);
  assert.equal(c.$wind, 0.42);
  assert.deepEqual(c.$god, [true, false, false]);
  assert.equal(c.$time.$d, 57);
  assert.deepEqual(c.$inv, [70, null, 301, 45], 'les trous du sac restent des trous');
});

test('l\'album passe en entier, et à la longueur que le SWF attend', () => {
  const c = ficheDepuisLeSwf();
  assert.equal(c.$stat.$item.length, 222, 'padMinipixizSlot0 complète à 222');
  assert.equal(c.$stat.$item[0], true);
  assert.equal(c.$stat.$item[2], true);
  assert.equal(c.$stat.$item[5], true);
  assert.equal(c.$stat.$item[1], null, 'et les cases non gagnées valent null, pas false');
});

test('les lieux de l\'aventure arrivent avec leur état', () => {
  const c = ficheDepuisLeSwf();
  assert.deepEqual(
    { l: c.$dungeon.$lvl, f: c.$dungeon.$f, d: c.$dungeon.$day, b: c.$dungeon.$loop },
    { l: 3, f: true, d: 50, b: 1 });
  assert.deepEqual(
    { f: c.$rainbow.$f, d: c.$rainbow.$day, i: c.$rainbow.$it },
    { f: true, d: 0, i: 71 });
  assert.equal(c.$pond.$q, 2);
  assert.equal(c.$pond.$d, 1);
});

test('la fée arrive avec tout ce qui fait la sienne', () => {
  const f = ficheDepuisLeSwf().$faerie[0];
  assert.equal(f.$name, 'Zaltina');
  assert.equal(f.$level, 3);
  assert.equal(f.$exp, 740);
  assert.equal(f.$hunger, 12);
  assert.equal(f.$moral, 7);
  assert.equal(f.$bagMax, 4);
  assert.deepEqual(f.$carac, [4, 2, 3, 2, 5, 3]);
  assert.deepEqual(f.$spell, [20, 0, 7], 'y compris le sort appris');
  assert.deepEqual(f.$inv, [70, null, 301], 'et son propre sac');
  assert.deepEqual(f.$taste, [[2, 5], [7]], 'ses goûts');
  assert.deepEqual(f.$behaviour, [0, 0, 1], 'son travers de caractère');
  assert.deepEqual(f.$skin.slice(0, 2), [2, 16711680], 'son portrait et ses couleurs');
});

test('les missions traversent, les actives comme celles du jour', () => {
  const c = ficheDepuisLeSwf();
  assert.equal(c.$mis.length, 1);
  assert.equal(c.$mis[0].$d, 4);
  assert.equal(c.$mis[0].$gift, 300);
  assert.equal(c.$mis[0].$string, 'a réussi la mission !',
    'le texte est désescapé comme Flash l\'avait échappé');
  assert.equal(c.$mission.length, 2);
  assert.deepEqual(c.$mission[0], [0, 2, 3, 300, 4242]);
  // Et le portage sait en refaire un texte lisible.
  const d = M.decrire(c.$mission[0]);
  assert.ok(d.titre.length > 5 && d.titre.indexOf('$') < 0);
});

// ── Ce que le portage ne casse pas en relisant ────────────────────────────

test('reparer ne touche à rien d\'une fiche Flash saine', () => {
  const c = ficheDepuisLeSwf();
  const r = P.reparer(c);
  assert.deepEqual(r.reparations, [], 'aucune réparation à faire');
  // Les champs des modes non portés, ou inconnus, survivent tels quels.
  const avec = Object.assign({}, c, { $unModeFutur: { a: 1 }, $god: [true, false, false] });
  const r2 = P.reparer(avec);
  assert.deepEqual(r2.carte.$unModeFutur, { a: 1 },
    'ce qu\'on ne comprend pas est recopié, jamais jeté');
});

test('une course native garde tout ce que le Flash avait posé', () => {
  const c = P.reparer(ficheDepuisLeSwf()).carte;
  // Le ramassage écrit la fiche à l'instant (Base.grab), la fusion solde.
  P.ramasser(c, 46);
  const apres = P.fusionner(c, { niveaux: [41, 42], dernier: 43, objets: [46], entree: true });

  // Ce que la course change.
  assert.ok(apres.$stat.$run > 18320, '$run monte');
  assert.equal(apres.$stat.$forestMax, 44,
    'setWin fait level += 1 avant endGame : finir le 43 inscrit 44');
  assert.equal(apres.$stat.$game[0], 10, 'une entrée en forêt de plus');
  assert.equal(apres.$stat.$item[46], true, 'l\'objet ramassé entre à l\'album');
  assert.equal(apres.$inv[1], 46, 'et se range dans le trou du sac');

  // Ce qu'elle ne doit PAS toucher.
  assert.equal(apres.$stat.$treeMax, 2750);
  assert.equal(apres.$stat.$misNum, 4);
  assert.deepEqual(apres.$stat.$kill, [11, 4, 2, 0, 0]);
  assert.equal(apres.$diam, 2);
  assert.equal(apres.$star, 5);
  assert.equal(apres.$frog, true);
  assert.equal(apres.$wind, 0.42);
  assert.deepEqual(apres.$god, [true, false, false]);
  assert.equal(apres.$dungeon.$loop, 1);
  assert.equal(apres.$rainbow.$it, 71);
  assert.equal(apres.$time.$d, 57);
  assert.equal(apres.$faerie[0].$name, 'Zaltina');
  assert.equal(apres.$faerie[0].$exp, 740);
  assert.deepEqual(apres.$faerie[0].$carac, [4, 2, 3, 2, 5, 3]);
  assert.equal(apres.$mis.length, 1);
  assert.equal(apres.$mission.length, 2);
});

test('la fiche réécrite par le portage reste lisible par le SWF', () => {
  const c = P.reparer(ficheDepuisLeSwf()).carte;
  const jouee = P.fusionner(c, { niveaux: [41], dernier: 42, objets: [], entree: false });
  // Le serveur repasse par padMinipixizSlot0 avant de servir : c'est là que la
  // forme attendue par fromJSON est garantie.
  const servie = JSON.parse(S.padMinipixizSlot0(JSON.stringify(jouee)));
  const exige = ['$stat', '$diam', '$key', '$star', '$bag', '$vs', '$frog', '$dungeon',
    '$rainbow', '$pond', '$faerie', '$inv', '$current', '$help', '$mis', '$wind',
    '$god', '$time', '$mission', '$checkpoint'];
  for (const cle of exige) {
    assert.ok(servie[cle] !== undefined, cle + ' manque à la fiche servie');
  }
  assert.equal(servie.$stat.$item.length, 222);
  assert.equal(servie.$faerie[0].$name, 'Zaltina');
  assert.equal(typeof servie.$vs, 'number');
});

// ── Le bocal, et pourquoi Gromelin l'exige ────────────────────────────────

test('le serveur ne persiste JAMAIS le bocal d\'une fée', () => {
  // C'est délibéré : une fée persistée « en bocal » apparaissait à la fois
  // dedans et dehors, ce qui la dupliquait. $pos est donc une notion de
  // session — le pipe la porte, la fiche servie la remet à null.
  const brut = S.parseMinipixizPipe(PIPE);
  assert.equal(brut.$faerie[0].$pos, 1, 'le pipe du SWF la porte');
  const servie = JSON.parse(S.padMinipixizSlot0(JSON.stringify(brut)));
  assert.equal(servie.$faerie[0].$pos, null, 'la fiche servie ne la garde pas');
});

test('sans bocal posé dans la séance, Gromelin ne prend personne', () => {
  const c = P.reparer(ficheDepuisLeSwf()).carte;
  assert.equal(c.$faerie[0].$pos, null);
  assert.equal(M.feesDisponibles(c).length, 0, 'il refuse une fée « en main »');
  const a = M.accueil(c, 0.5, true);
  assert.equal(a.missions, false);
  assert.ok(a.dial.some((d) => /bocal/.test(d)), 'et il dit pourquoi');
});

test('poser la fée dans un bocal du sac la rend acceptable', () => {
  const c = P.reparer(ficheDepuisLeSwf()).carte;
  // Le sac porte un bocal en case 0 (item 70 dans le pipe) : on en met un vrai.
  c.$inv[0] = O.IT_BOCAL;
  const I = require('../public/minipixiz/inventaire.js');
  const inv = Object.create(I.Inventaire.prototype);
  inv.plateforme = { carte: c };
  inv.feeCourante = 0;
  inv.message = ''; inv.titre = '';
  inv.dire = function (m) { this.message = m; };
  inv.changer = function () {};

  assert.equal(inv.bocal(0), true);
  assert.equal(c.$faerie[0].$pos, 0, 'elle est dans le bocal de la case 0');
  assert.equal(M.feesDisponibles(c).length, 1, 'Gromelin la prend');
  const a = M.accueil(c, 0.5, true);
  assert.equal(a.missions, true);

  // Et on peut l'en sortir.
  inv.bocal(0);
  assert.equal(c.$faerie[0].$pos, null);
  assert.equal(M.feesDisponibles(c).length, 0);
});

test('l\'inventaire propose bien le geste du bocal', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public/minipixiz/inventaire.js'), 'utf8');
  assert.match(src, /famille === 'bocal'/, 'toucher un bocal déclenche le geste');
  assert.match(src, /\$pos = index/, 'et pose bien l\'index de la case');
});

// ── Le disque, sur /light ─────────────────────────────────────────────────

test('le disque Minipixiz est dans la pochette de /light', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public/light.html'), 'utf8');
  assert.match(html, /tab: "minipixiz", img: "\/fb\/fd_minipixiz\.png", name: "Minipixiz"/,
    'le disque figure dans la feuille « Mes disques »');
  assert.match(html, /id="minipixiz-panel"/, 'et son panneau existe');
  assert.match(html, /"\/minipixiz\/\?sid="/, 'qui charge le jeu avec la session');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public/fb/fd_minipixiz.png')),
    'la pochette du disque est là');
});
