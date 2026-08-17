// Transcode les mb2*.dat servis à motionball.swf vers l'alphabet que le SWF
// lit VRAIMENT.
//
// L'outillage OCaml d'époque (mb2gen.exe) encodait les valeurs 62/63 en
// « _ » puis « - » ; le MTBitcodec compilé dans motionball.swf lit l'ordre
// inverse (« - »=62, « _ »=63 — désassemblage du DoInitAction
// __Packages.ext.util.MTBitcodec). Chaque tiret/underscore des .dat archivés
// avait donc son dernier bit lu à l'envers par le client Flash : listes
// d'items coupées net, salles « vides » impossibles à ouvrir, rouge↔bleue…
// C'est le « tous les modes sont bugués » constaté en jeu, alors que les
// mêmes fichiers passent sans accroc sur les plateformes qui ont réécrit le
// lecteur (elles reproduisent l'ordre OCaml, pas celui du SWF).
//
// Ce script réexprime le MÊME contenu dans l'alphabet du SWF :
//   · mb2adv1..5, mb2run1..7, mb2tuto — regénérés depuis leurs sources
//     dungeon/*.txt (déterministe, donc relançable sans risque). On vérifie
//     au passage que la sortie est EXACTEMENT le swap -/_ de l'archive quand
//     celle-ci est encore en encodage OCaml ;
//   · mb2classic.dat — pas de source texte (il fut généré par mb2gen.exe,
//     graine 845889385, et notre Random n'est pas celui d'OCaml) : on swap
//     les -/_ de son ddata, RIEN d'autre (le \n final d'époque est conservé).
//     Garde-fou md5 : refuse de toucher un fichier dans un état inconnu, et
//     ne re-swappe jamais un fichier déjà transcodé.
//
// mb2data.dat (challenge du jour) n'est pas concerné : gitignoré, regénéré à
// chaque boot par mb2gen.js — qui écrit désormais l'alphabet SWF nativement.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'Games', 'motionBall2');
const mb2 = require(path.join(ROOT, 'mb2gen.js'));

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const swap = (s) => s.replace(/[-_]/g, (c) => (c === '-' ? '_' : '-'));

// L'état connu du classic canonique (graine 845889385, 100 niveaux × 5) :
const CLASSIC_MD5_OCAML = '4c2af85e0676bd88797b6f5f21d84719';
const CLASSIC_MD5_SWF = 'af3198cd78ef50527de4376533f5b479';

mb2.loadBumpers();

const SOURCES = [
  ['tuto.txt', 'mb2tuto.dat'],
  ...[1, 2, 3, 4, 5].map((i) => [`adv_${i}.txt`, `mb2adv${i}.dat`]),
  ...[1, 2, 3, 4, 5, 6, 7].map((i) => [`course_${i}.txt`, `mb2run${i}.dat`]),
];

for (const [txt, dat] of SOURCES) {
  const cible = path.join(OUT, dat);
  const avant = fs.readFileSync(cible, 'utf8');
  const swf = mb2.assembleMake(path.join(OUT, 'dungeon', txt), mb2.B64_SWF);
  const ocaml = mb2.assembleMake(path.join(OUT, 'dungeon', txt), mb2.B64_OCAML);
  let etat;
  if (avant === swf) etat = 'déjà transcodé';
  else if (avant === ocaml) etat = 'encodage OCaml → transcodé';
  else etat = 'ÉTAT INATTENDU (ni OCaml ni SWF) → réécrit depuis la source';
  if (avant === ocaml && swf !== avant.split('&ddata=')[0] + '&ddata=' + swap(avant.split('&ddata=')[1])) {
    throw new Error(dat + ' : la sortie SWF n\'est pas le swap -/_ de l\'archive — incohérence, on ne touche à rien');
  }
  fs.writeFileSync(cible, swf);
  console.log(`${dat.padEnd(16)} ${etat}`);
}

{
  const cible = path.join(OUT, 'mb2classic.dat');
  const avant = fs.readFileSync(cible, 'utf8');
  const h = md5(avant);
  if (h === CLASSIC_MD5_SWF) {
    console.log('mb2classic.dat   déjà transcodé');
  } else if (h === CLASSIC_MD5_OCAML) {
    const i = avant.indexOf('&ddata=') + 7;
    const fin = avant.endsWith('\n') ? avant.length - 1 : avant.length;
    const apres = avant.slice(0, i) + swap(avant.slice(i, fin)) + avant.slice(fin);
    if (md5(apres) !== CLASSIC_MD5_SWF) throw new Error('mb2classic.dat : transcodage ≠ md5 attendu');
    fs.writeFileSync(cible, apres);
    console.log('mb2classic.dat   encodage OCaml → transcodé (491 caractères swappés)');
  } else {
    throw new Error('mb2classic.dat : md5 inconnu (' + h + ') — fichier modifié hors procédure, on ne touche à rien');
  }
}
console.log('Terminé.');
