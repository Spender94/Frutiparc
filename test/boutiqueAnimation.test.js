'use strict';
/*
 * LA COLONNE DE LA BOUTIQUE N'ARRIVE QU'UNE FOIS
 * ══════════════════════════════════════════════
 *
 * `cp.Tree.addPhysElement` anime CHAQUE entrée qu'on ajoute à un arbre : d'où
 * l'arrivée en glissant de la liste des rayons quand la boutique s'ouvre. Le
 * portage, lui, repeignait la colonne entière à chaque clic — `renderShop`
 * refait tout, y compris quand on choisit un ARTICLE, qui ne change pourtant
 * que la fiche de droite. La liste repartait donc en mouvement à chaque
 * pression, et c'est le même défaut que le tableau des scores avait avant elle.
 *
 * Deux gardes, comme pour les scores :
 *
 *   · `data-sig` — la SIGNATURE de ce que la colonne montre déjà. Identique,
 *     on ne touche pas au DOM : on déplace la marque `.on`, rien d'autre. Les
 *     nœuds restent, donc rien ne se recharge et rien ne réanime.
 *   · `boAnimerColonne` — l'animation d'arrivée n'est ARMÉE que par la porte
 *     d'ouverture de la fenêtre (`MagasinLight.charger`), et se désarme dès
 *     qu'elle a servi.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('la colonne ne se refait que si elle change', () => {
  // La signature tient le rayon ouvert ET ses articles (dont le « déjà eu »,
  // qui change au moment d'un achat).
  assert.match(LIGHT, /var sig = boRubrique \+ '\|' \+ shopCategories\.map\(function \(c, i\) \{/);
  assert.match(LIGHT, /return x\.name \+ \(x\.owned \? '\*' : ''\);/);
  // Signature identique : on ne fait que déplacer la marque.
  assert.match(LIGHT, /if \(box\.getAttribute\('data-sig'\) === sig && box\.querySelector\('\.bo-art'\)\) \{/);
  assert.match(LIGHT, /b\.classList\.toggle\('on', b\.hasAttribute\('data-a'\)/);
  assert.match(LIGHT, /\n\s*return;\s*\n\s*\}\s*\n\s*box\.setAttribute\('data-sig', sig\);/,
    'le DOM ne se refait qu’après la garde');
});

test('l’animation d’arrivée ne se joue qu’à l’ouverture de la fenêtre', () => {
  assert.match(LIGHT, /var boAnimerColonne = false;/, 'désarmée au repos');
  assert.match(LIGHT,
    /if \(boAnimerColonne && window\.BureauFrutiz && BureauFrutiz\.animerEntrees\) \{\s*\n\s*BureauFrutiz\.animerEntrees\(box\);\s*\n\s*\}\s*\n\s*boAnimerColonne = false;/,
    'elle se désarme aussitôt jouée');
  // La SEULE porte qui l'arme : celle qui ouvre la boutique.
  assert.match(LIGHT, /charger: function \(\) \{ boAnimerColonne = true; loadShop\(\); \},/);
  const armements = (LIGHT.match(/boAnimerColonne = true/g) || []).length;
  assert.strictEqual(armements, 1, 'une seule porte arme l’animation');
});

test('c’est la même garde que le tableau des scores', () => {
  // Le tableau des scores a été corrigé de la même façon : une signature, et
  // l'animation d'entrée seulement quand la liste change vraiment. Les deux
  // vivent côte à côte — si l'une s'en va, l'autre doit s'expliquer.
  assert.match(LIGHT, /if \(box\.getAttribute\("data-sig"\) === signature && box\.querySelector\("\.sc-rk"\)\) \{/);
  assert.match(LIGHT, /box\.setAttribute\("data-sig", signature\);/);
});
