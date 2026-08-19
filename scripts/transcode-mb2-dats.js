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

const NOMS_ITEM = [null, 'BNormal', 'BTime', 'BDeath', 'BMagnet', 'BShadow', 'BBlock',
  'BHole', 'BRed', 'BBlue', 'Teleport', 'Interupt', 'IBlockRed', 'IBlockBlue', 'Zapper', 'ClassicExit'];
let totalRetires = 0, sallesDebloquees = 0;

for (const [txt, dat] of SOURCES) {
  const cible = path.join(OUT, dat);
  const avant = fs.readFileSync(cible, 'utf8');
  const source = path.join(OUT, 'dungeon', txt);
  // Les deux rendus BRUTS servent à identifier l'état du fichier sur disque
  // et à prouver que le transcodage n'est qu'un échange -/_ ; c'est le rendu
  // RÉPARÉ (items hors terrain retirés) qui est effectivement servi.
  const brut = {};
  const swfBrut = mb2.assembleMake(source, mb2.B64_SWF, brut);
  const ocaml = mb2.assembleMake(source, mb2.B64_OCAML);
  const rapport = { reparerHorsChamp: true };
  const swf = mb2.assembleMake(source, mb2.B64_SWF, rapport);
  let etat;
  if (avant === swf) etat = 'déjà transcodé et réparé';
  else if (avant === swfBrut) etat = 'déjà transcodé → réparé';
  else if (avant === ocaml) etat = 'encodage OCaml → transcodé et réparé';
  // Ces fichiers-là sont REGÉNÉRÉS depuis dungeon/*.txt : quand la sortie
  // change (nouvelle réparation), l'archive sur disque ne correspond plus à
  // aucun des trois rendus de référence. Ce n'est pas une anomalie, c'est le
  // signe qu'on sert une version réparée de plus.
  else etat = 'régénéré depuis la source';
  if (avant === ocaml && swfBrut !== avant.split('&ddata=')[0] + '&ddata=' + swap(avant.split('&ddata=')[1])) {
    throw new Error(dat + ' : la sortie SWF n\'est pas le swap -/_ de l\'archive — incohérence, on ne touche à rien');
  }
  fs.writeFileSync(cible, swf);
  const rouges = rapport.retires.filter((r) => r.btype === 8);
  totalRetires += rapport.retires.length;
  sallesDebloquees += new Set(rouges.map((r) => r.x + ',' + r.y)).size;
  let detail = rapport.retires.length
    ? '  — ' + rapport.retires.length + ' item(s) hors terrain retiré(s) : '
      + rapport.retires.map((r) => `${NOMS_ITEM[r.btype]}@${r.ix},${r.iy} salle(${r.x},${r.y})`).join(', ')
    : '';
  // La ligne d'arrivée, quand elle a dû être replacée (course 6) : on le dit
  // seulement si le rendu BRUT avait ses deux zappers dans deux salles.
  const zb = brut.zappers || [], z = rapport.zappers || [];
  const disperse = zb.length === 2 && (zb[0].x !== zb[1].x || zb[0].y !== zb[1].y);
  if (disperse && z.length === 2) {
    detail += `  — ligne d'arrivée replacée dans la salle de départ `
      + `(${z[0].x},${z[0].y}) @${z[0].ix},${z[0].iy}–${z[1].ix},${z[1].iy}`;
  }
  console.log(`${dat.padEnd(16)} ${etat}${detail}`);
}
console.log(`\n${totalRetires} items hors terrain retirés au total, dont des billes rouges `
  + `qui bloquaient ${sallesDebloquees} salle(s) (portes jamais ouvertes).`);

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
