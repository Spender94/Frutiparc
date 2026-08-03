#!/usr/bin/env node
// Sort les textes des missions de Lang.mt, pour le portage natif de Minipixiz.
//
//   node scripts/extract-minipixiz-lang.js   → écrit public/minipixiz/langue.js
//
// ── Pourquoi une extraction, et pas une recopie ──
//
// Les missions de Gromelin ne sont pas écrites : elles sont ASSEMBLÉES. Huit
// canevas de phrases, quatorze listes de mots, et une graine qui choisit dans
// chacune. « Libérer les farfadets du terrible Sorog le rouge » et « Libérer
// les coccinelles du terrible Pigrom le dodu » sortent du même moule.
//
// Recopier tout cela à la main, c'est plus de deux cents phrases à retaper sans
// se tromper d'accent. On lit donc le fichier d'origine — il est en cp1252, ce
// que Node sait convertir — et on écrit un module qui en est la traduction
// exacte.

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SOURCE = path.join(RACINE, 'Games/miniTroll/src/Lang.mt');
const SORTIE = path.join(RACINE, 'public/minipixiz/langue.js');

const brut = fs.readFileSync(SOURCE);
// Le fichier date de Flash : accents en cp1252, pas en UTF-8.
const texte = new TextDecoder('windows-1252').decode(brut);

// Le crochet (ou l'accolade) qui ferme celui ouvert à `ouvre`.
function fermant(depuis, o, f) {
  let n = 0;
  for (let i = depuis; i < texte.length; i++) {
    if (texte[i] === o) n++;
    else if (texte[i] === f) { n--; if (n === 0) return i; }
  }
  return -1;
}

// Les chaînes d'une liste `static var NOM = [ ... ]`, dans l'ordre. Le langage
// de Motion-Twin se passe de virgules : on ne peut pas découper, il faut
// ramasser les guillemets.
function liste(nom) {
  const debut = texte.indexOf('static var ' + nom);
  if (debut < 0) throw new Error('liste introuvable : ' + nom);
  const ouvre = texte.indexOf('[', debut);
  const fin = fermant(ouvre, '[', ']');
  const corps = texte.slice(ouvre + 1, fin);
  return [...corps.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

// Les huit canevas de mission : un type, les caractéristiques mises à
// l'épreuve, et quatre phrases — titre, énoncé, réussite, échec.
function missions() {
  const debut = texte.indexOf('static var MISSION =');
  const ouvre = texte.indexOf('[', debut);
  const corps = texte.slice(ouvre + 1, fermant(ouvre, '[', ']'));

  const sortie = [];
  let prof = 0, depart = -1;
  for (let i = 0; i < corps.length; i++) {
    if (corps[i] === '{') { if (prof === 0) depart = i; prof++; continue; }
    if (corps[i] !== '}') continue;
    prof--;
    if (prof !== 0) continue;
    const bloc = corps.slice(depart + 1, i);
    const type = /type\s*:\s*"([^"]*)"/.exec(bloc);
    const test = /test\s*:\s*\[([0-9,\s]*)\]/.exec(bloc);
    const desc = /desc\s*:\s*\[([\s\S]*?)\n\s*\]/.exec(bloc);
    sortie.push({
      type: (type ? type[1] : '').trim(),
      test: test ? test[1].split(',').map((v) => Number(v.trim())).filter((v) => !isNaN(v)) : [],
      desc: desc ? [...desc[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]) : [],
    });
  }
  return sortie;
}

const MOTS = [
  'WORD_THIEF', 'WORD_KINGDOM', 'WORD_HISTORY', 'WORD_FUN_GAME', 'WORD_LONG_TIME',
  'WORD_VICTIMS', 'WORD_FROM_LOCATION', 'WORD_AT_LOCATION', 'WORD_BAD_NAME',
  'WORD_ACTION_PAST_FUN', 'WORD_LOST_OBJECT', 'WORD_PERIOD', 'WORD_SUPER',
  'WORD_FROM_INVADER',
];

const donnees = {
  MISSION: missions(),
  MISSION_DIF: liste('MISSION_DIF'),
  MISSION_DIF_RANK: liste('MISSION_DIF_RANK'),
  nameSyl0: liste('nameSyl0').map((s) => s.slice(1)),
  nameSyl1: liste('nameSyl1').map((s) => s.slice(1)),
};
for (const m of MOTS) donnees[m] = liste(m);

const entete = `/*
 * Minipixiz (miniTroll) — les textes des missions.
 *
 * EXTRAIT de Games/miniTroll/src/Lang.mt par scripts/extract-minipixiz-lang.js.
 * Ne pas modifier à la main : relancer le script.
 *
 * Les missions de Gromelin sont ASSEMBLÉES, pas écrites. Huit canevas de
 * phrases, quatorze listes de mots, et une graine qui choisit dans chacune :
 * « Libérer les farfadets du terrible Sorog le rouge » et « Libérer les
 * coccinelles du terrible Pigrom le dodu » sortent du même moule. C'est ce qui
 * permet à six missions de paraître neuves chaque jour sans qu'on ait écrit six
 * cents textes.
 *
 * Chaque canevas dit aussi quelles CARACTÉRISTIQUES la mission met à l'épreuve
 * (\`test\`) : une mission de magie regarde la concentration et le mana, une
 * course regarde la rapidité. C'est de là que sort le pourcentage de réussite.
 *
 * Les syllabes de noms ont perdu leur caractère de tête, que
 * Mission.getSeedFaerieName retirait à chaque appel (\`substring(1)\`).
 */
'use strict';

(function (racine) {

const LANGUE = `;

const pied = `;

if (typeof module !== 'undefined' && module.exports) module.exports = LANGUE;
else racine.MinipixizLangue = LANGUE;

})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.writeFileSync(SORTIE, entete + JSON.stringify(donnees, null, 2) + pied, 'utf8');

console.log(donnees.MISSION.length + ' canevas de mission');
for (const m of donnees.MISSION) {
  console.log('  ' + m.type.padEnd(20) + ' test[' + m.test.join(',') + ']  '
    + m.desc.length + ' phrases');
}
for (const m of MOTS) console.log('  ' + m.padEnd(24) + donnees[m].length + ' entrées');
console.log('  noms : ' + donnees.nameSyl0.length + ' × ' + donnees.nameSyl1.length + ' syllabes');
console.log('→ ' + path.relative(RACINE, SORTIE));
