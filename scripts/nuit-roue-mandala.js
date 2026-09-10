#!/usr/bin/env node
/*
 * LA ROUE DU FRUTIMANDALA, EN NUIT.
 *
 * Le mode nuit garde les dessins d'époque en couleur — ce sont eux qui font
 * le parc. La roue du frutimandala résistait, parce que son DÉCOR est peint
 * dans l'image : ses fruits sont posés sur douze quartiers vert pomme, et
 * aucun filtre CSS ne sait éteindre le quartier sans éteindre le fruit avec.
 *
 * Or c'est un SVG, et sa structure est limpide : le PREMIER groupe ne
 * contient que deux tracés — les quartiers, `#ade76b` et `#8ad524` —, et
 * tout ce qui suit est fruits et décorations. Il suffit donc de reteindre
 * ces deux tracés-là. Ce n'est pas un redessin : c'est le même dessin, avec
 * ses quartiers passés au violet du parc de nuit.
 *
 * Le résultat s'appelle `frutimandala-roue-nuit.svg` et la convention du
 * mode nuit fait le reste : `generer-nuit.js` le trouve, pointe l'URL dessus
 * et lui retire tout filtre. Les fruits gardent donc leurs couleurs pleines
 * sur une roue sombre — ce qu'aucun filtre ne pouvait donner.
 *
 * Le jour où quelqu'un redessine la roue à la main, il écrase simplement le
 * fichier produit ici : rien d'autre à changer.
 *
 *   node scripts/nuit-roue-mandala.js            écrit la variante
 *   node scripts/nuit-roue-mandala.js --verifier sort 1 si elle est périmée
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const JOUR = path.join(RACINE, 'public/frutiz/sprites/frutimandala-roue.svg');
const NUIT = path.join(RACINE, 'public/frutiz/sprites/frutimandala-roue-nuit.svg');

// Les deux quartiers, et le violet qui les remplace. Ils ne prennent PAS la
// même valeur : le frutimandala est une horloge, ses quartiers alternent pour
// se compter — deux violets identiques en feraient un disque uni. On garde
// donc l'écart, et le renversement du thème : le quartier le plus clair de
// jour devient le plus sombre de nuit.
const QUARTIERS = {
  '#ade76b': '#2a223f',    // hsl(256 30% 19 %)
  '#8ad524': '#3b3059',    // hsl(256 30% 27 %)
};

const ENTETE = `<!--
  ENGENDRÉ par scripts/nuit-roue-mandala.js — la roue du frutimandala, en nuit.
  Le même dessin que frutimandala-roue.svg, ses douze quartiers repassés au
  violet du parc de nuit ; les fruits n'ont pas bougé d'un pixel.
  Pour la redessiner à la main : écraser ce fichier, rien d'autre à changer.
-->
`;

function fabriquer() {
  const src = fs.readFileSync(JOUR, 'utf8');
  // Le premier groupe, et lui seul : les quartiers. `indexOf('</g>')` borne la
  // reteinte — au-delà commencent les fruits, qu'on ne touche pas.
  const debut = src.indexOf('<g ');
  const fin = src.indexOf('</g>', debut);
  if (debut < 0 || fin < 0) throw new Error('structure inattendue dans ' + JOUR);
  let quartiers = src.slice(debut, fin);
  let vus = 0;
  for (const [jour, nuit] of Object.entries(QUARTIERS)) {
    const avant = quartiers;
    quartiers = quartiers.split(jour).join(nuit);
    if (quartiers !== avant) vus++;
  }
  if (vus !== Object.keys(QUARTIERS).length) {
    throw new Error('les quartiers ont changé de couleur dans le dessin de jour : '
      + 'relire QUARTIERS dans ' + path.basename(__filename));
  }
  // La reteinte ne doit pas avoir mordu sur les fruits : ils sont APRÈS.
  const reste = src.slice(fin);
  for (const jour of Object.keys(QUARTIERS)) {
    if (reste.includes(jour)) {
      console.warn('[roue] ' + jour + ' sert aussi hors des quartiers : il y reste tel quel.');
    }
  }
  const tete = src.slice(0, debut);
  return tete.replace(/(<svg[^>]*>\n?)/, '$1' + ENTETE) + quartiers + reste;
}

function main() {
  const texte = fabriquer();
  const ancien = fs.existsSync(NUIT) ? fs.readFileSync(NUIT, 'utf8') : null;
  if (process.argv.includes('--verifier')) {
    if (ancien !== texte) {
      console.error('PÉRIMÉ : public/frutiz/sprites/frutimandala-roue-nuit.svg');
      console.error('Relancer : node scripts/nuit-roue-mandala.js');
      process.exit(1);
    }
    console.log('La roue de nuit est à jour.');
    return;
  }
  fs.writeFileSync(NUIT, texte);
  console.log('frutimandala-roue-nuit.svg  ' + (texte.length / 1024).toFixed(1) + ' Ko'
    + (ancien === texte ? '  (inchangé)' : ''));
}

if (require.main === module) main();

module.exports = { fabriquer, QUARTIERS, JOUR, NUIT };
