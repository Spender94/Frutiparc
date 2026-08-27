'use strict';
/*
 * UN DISQUE POSÉ SANS COORDONNÉES, ET LE BUREAU QUI RESTE NU.
 *
 * Quand main.swf pose un disque sur le bureau, `/ff/mv` appelle
 * `desktopAdd(user, file, 'disc')` SANS position : l'objet n'a ni x ni y, et
 * `bureauObjetEnrichi` renvoie `pos: null`. C'est prévu — `fitInGrid` d'époque
 * donne sa place à un fichier qui n'en a pas, et le portage fait pareil :
 *
 *     objetsBureau.forEach((o) => { if (!o.pos) o.pos = caseLibreBureau(…); })
 *
 * Sauf que `caseLibreBureau` relit TOUTE la liste pour savoir quelles cases
 * sont prises, et y lisait `o.pos.x` — y compris sur les objets dont le `pos`
 * est justement ce qu'on vient chercher. Le TypeError partait dans le `.catch`
 * de `chargerObjetsBureau`, celui qui devait couvrir la coupure réseau, et le
 * bureau restait NU : pas une icône, pas un message. Un seul disque posé
 * depuis le Flash suffisait à effacer tout le bureau du portage.
 *
 * Relevé au banc, avant : « icônes VISIBLES sur le bureau : AUCUNE » pour deux
 * disques posés sans position ; après : « snake3, bandas1 ».
 *
 * Ce fichier n'inspecte pas le code, il l'EXÉCUTE : la fonction est extraite
 * du fichier livré et posée sur un bureau en carton.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');

// Le corps d'une fonction `function <nom>(…) { … }` du fichier livré.
function fonction(nom) {
  const debut = JS.indexOf('  function ' + nom + '(');
  assert.ok(debut >= 0, 'fonction introuvable : ' + nom);
  const fin = JS.indexOf('\n  }\n', debut);
  assert.ok(fin > debut, 'fin de fonction introuvable : ' + nom);
  return JS.slice(debut + 2, fin + 4);
}

// Un bureau en carton : la grille, la liste, et de quoi mesurer.
function bureau(objets) {
  const GRILLE_PAS = 80;
  const faux = { clientWidth: 800, clientHeight: 600 };
  // eslint-disable-next-line no-new-func
  const f = new Function('$', 'GRILLE_PAS', 'objetsBureau',
    fonction('caseLibreBureau') + '\nreturn caseLibreBureau;')(
    () => faux, GRILLE_PAS, objets);
  return { caseLibre: f, PAS: GRILLE_PAS };
}

test('une case libre se trouve même quand personne n’est encore placé', () => {
  const objets = [{ uid: 'snake3', parent: 'root', pos: null },
    { uid: 'bandas1', parent: 'root', pos: null }];
  const { caseLibre } = bureau(objets);
  const p = caseLibre('root');
  assert.deepStrictEqual(p, { x: 0, y: 0 }, 'la première case, sans lever d’erreur');
});

test('la boucle de placement donne à chacun sa case', () => {
  // C'est exactement ce que fait `dessinerObjetsBureau` avant de dessiner.
  const objets = [{ uid: 'snake3', parent: 'root', pos: null },
    { uid: 'bandas1', parent: 'root', pos: null },
    { uid: 'grapiz1', parent: 'root', pos: null }];
  const { caseLibre, PAS } = bureau(objets);
  objets.forEach((o) => { if (!o.pos) o.pos = caseLibre(o.parent || 'root'); });
  const vues = objets.map((o) => o.pos.x + ':' + o.pos.y);
  assert.strictEqual(new Set(vues).size, 3, 'trois places distinctes : ' + vues.join(', '));
  assert.deepStrictEqual(objets[0].pos, { x: 0, y: 0 });
  assert.deepStrictEqual(objets[1].pos, { x: PAS, y: 0 });
});

test('les objets DÉJÀ placés gardent leur case', () => {
  const objets = [{ uid: 'a', parent: 'root', pos: { x: 0, y: 0 } },
    { uid: 'b', parent: 'root', pos: null }];
  const { caseLibre, PAS } = bureau(objets);
  assert.deepStrictEqual(caseLibre('root'), { x: PAS, y: 0 },
    'la case 0 est prise, la suivante est la bonne');
});

test('un dossier ne compte pas les cases du bureau', () => {
  const objets = [{ uid: 'a', parent: 'root', pos: { x: 0, y: 0 } },
    { uid: 'b', parent: 'fbd1', pos: null }];
  const { caseLibre } = bureau(objets);
  assert.deepStrictEqual(caseLibre('fbd1'), { x: 0, y: 0 });
});

test('AVANT le correctif, la même liste levait une erreur', () => {
  // On rejoue l'ancienne boucle — sans la garde — pour montrer d'où venait
  // le bureau nu.
  const objets = [{ uid: 'snake3', parent: 'root', pos: null }];
  const ancienne = fonction('caseLibreBureau')
    .replace(/\n\s*\/\/[^\n]*/g, '')
    .replace("if (!o.pos) return;", '');
  assert.ok(!/if \(!o\.pos\) return;/.test(ancienne), 'la garde doit avoir sauté');
  // eslint-disable-next-line no-new-func
  const f = new Function('$', 'GRILLE_PAS', 'objetsBureau',
    ancienne + '\nreturn caseLibreBureau;')(
    () => ({ clientWidth: 800, clientHeight: 600 }), 80, objets);
  assert.throws(() => f('root'), TypeError,
    'l’ancienne version devait buter sur un `pos` nul');
});

test('le filet du chargement ne couvre plus le DESSIN', () => {
  // Le `.catch` enveloppait `rafraichirBureau()` : une erreur de code y
  // disparaissait sans un mot. Il ne couvre plus que la lecture.
  const bloc = fonction('chargerObjetsBureau');
  const iCatch = bloc.indexOf('.catch(');
  const iRendu = bloc.indexOf('rafraichirBureau()');
  assert.ok(iCatch >= 0 && iRendu >= 0, 'les deux doivent être là');
  assert.ok(iCatch < iRendu, 'le filet vient AVANT le rendu, il ne l’enveloppe plus');
});
