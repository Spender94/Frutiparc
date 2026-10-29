'use strict';
/*
 * JAMAJAMA — LA FLÈCHE « SUIVANTE » DU PARCHEMIN.
 *
 * « Impossible de naviguer entre les niveaux… jusqu'à ce que je réalise qu'en
 * cliquant à droite de la flèche droite, on peut effectivement changer de
 * niveau. » La flèche suivante est la précédente posée en miroir (matrice
 * a = −1) ; le cadre de clic d'un clip enfant ne prenait que la translation
 * de cette matrice, et tombait donc à droite du dessin.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const R = require('../public/jamajama/regles.js');
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/jamajama/sprites/sprites.json'), 'utf8'));

function chargerEcrans() {
  const symbole = (cle) => { const s = M.symboles[cle]; if (!s) throw new Error(cle); return s; };
  const Rendu = {
    symbole,
    etatDe: (s, f) => s.etats.find((e) => e.frame === (f || 1)) || s.etats[0],
    zoneBouton: (cle) => symbole(cle).hit || null,
    manifeste: () => M,
    dessiner() {},
  };
  const fenetre = { JamaRegles: R, JamaRendu: Rendu };
  const src = fs.readFileSync(path.join(ROOT, 'public/jamajama/ecrans.js'), 'utf8');
  new Function('window', 'document', src)(fenetre, {});
  return fenetre.JamaEcrans;
}

test('la flèche suivante se clique sur son dessin, plus à droite de lui', () => {
  const E = chargerEcrans();
  const sel = new E.EcranSelect();
  sel.prevActif = true; sel.nextActif = true;
  const W = R.Consts.WIDTH, H = R.Consts.HEIGHT;
  const clic = (dx, dy) => sel.update(1, { x: W / 2 + dx, y: H / 2 + dy, clic: true });
  // Les deux flèches sont symétriques autour du centre du parchemin : la
  // précédente couvre x ∈ [−149, −97], la suivante x ∈ [97, 150].
  assert.strictEqual(clic(-120, 0), 'prev', 'la flèche précédente');
  assert.strictEqual(clic(120, 0), 'next', 'la flèche suivante, sur son dessin');
  assert.strictEqual(clic(175, 0), null, 'à droite de la flèche, plus rien');
  const p = sel._zones.prev, n = sel._zones.next;
  assert.ok(Math.abs((p.x + p.w / 2) + (n.x + n.w / 2)) < 3, 'les deux zones se répondent en miroir');
  assert.ok(Math.abs(p.w - n.w) < 0.01 && Math.abs(p.h - n.h) < 0.01, 'et ont la même taille');
});
