#!/usr/bin/env node
// Sort les trois MÉDAILLES VIERGES d'awards.swf — le jeton d'or, d'argent et de
// bronze, sans la vignette du jeu.
//
//   node scripts/extract-medailles-vierges.js
//
// ── Où elles se trouvent ──
//
// awards.swf est la pellicule des médailles du bureau : une image par jeu,
// étiquetée (« snake3 », « kaluga », « bkiwi »…), que le client choisit par
// `gotoAndStop(<vignette>)`. Sur chacune de ces images, trois calques :
//
//     profondeur 2   #2    le disque vert du fond
//     profondeur 3   #6    le JETON — un clip de trois images, `ico`, dont
//                          `ico.gotoAndStop(<rang>)` choisit le métal
//     profondeur 5   …     la vignette du jeu, un dessin par image
//
// Le jeton, c'est donc le sprite #6, et ses trois images ne posent qu'une forme
// chacune, à la profondeur 1 :
//
//     image 1 → #3   or
//     image 2 → #4   argent
//     image 3 → #5   bronze
//
// Ce sont ces trois formes qu'on sort ici, telles quelles : disque dégradé et
// double anneau, le dessin exact de 2006. Le disque vert du fond (#2) reste au
// SWF — il porte un trait de repère oublié par le graphiste (une ligne coraline
// de 1/20 de pixel) et n'a pas de sens hors de la pellicule.
//
// Le résultat est du VECTEUR : les tableaux du Club les affichent à quatorze
// pixels, la fiche d'un joueur à seize, et le jour où quelqu'un en veut une
// grande, elle est déjà nette.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..');
const SWF = path.join(RACINE, 'public', 'awards.swf');
const SORTIE = path.join(RACINE, 'public', 'fb');
const TAMPON = path.join(RACINE, 'public', 'fb', '.medailles-tmp');

// forme → nom de fichier. On garde la famille des médailles déjà sorties
// (medal_gold_kaluga.png et compagnie) : même préfixe, sans jeu.
const METAUX = [
  { forme: 3, fichier: 'medal_gold.svg', nom: 'or' },
  { forme: 4, fichier: 'medal_silver.svg', nom: 'argent' },
  { forme: 5, fichier: 'medal_bronze.svg', nom: 'bronze' },
];

if (!fs.existsSync(SWF)) {
  console.error('awards.swf est introuvable : ' + SWF);
  process.exit(1);
}

execFileSync(process.execPath, [
  path.join(__dirname, 'extract-swf-shapes.js'), SWF, TAMPON,
  ...METAUX.map((m) => String(m.forme)),
], { stdio: 'inherit' });

fs.mkdirSync(SORTIE, { recursive: true });
for (const m of METAUX) {
  const source = path.join(TAMPON, `shape${m.forme}.svg`);
  if (!fs.existsSync(source)) throw new Error(`la forme #${m.forme} n'est pas sortie`);
  const dest = path.join(SORTIE, m.fichier);
  fs.writeFileSync(dest, fs.readFileSync(source));
  console.log(`${m.fichier} — la médaille ${m.nom}, ${fs.statSync(dest).size} o`);
}
fs.rmSync(TAMPON, { recursive: true, force: true });
