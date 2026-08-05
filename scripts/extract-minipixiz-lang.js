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

/*
 * Le TABLEAU IMBRIQUÉ, lu comme le compilateur d'origine le lisait.
 *
 * `liste` et `rangs` ramassent les guillemets à plat : cela suffit tant que le
 * tableau a une ou deux profondeurs et que chaque phrase est écrite d'un seul
 * tenant. Deux listes échappent aux deux règles. SENT_GET_FOOD compte TROIS
 * étages (aimé / détesté / rare / ordinaire, puis l'humeur, puis les variantes)
 * et surtout, à deux endroits, l'auteur a oublié une virgule :
 *
 *     [ "Ho, on dirait $food.", "$food!" "Tiens? $food, ca faisait longtemps!" ]
 *
 * Deux littéraux qui se touchent — le compilateur de Motion-Twin les COLLE en
 * une seule phrase, et le jeu d'origine dit donc « $food!Tiens? $food, ca
 * faisait longtemps! ». Les découper en deux répliques serait plus propre et
 * moins fidèle : on colle pareil.
 */
function tableau(nom, profondeur) {
  const debut = texte.indexOf('static var ' + nom);
  if (debut < 0) throw new Error('tableau introuvable : ' + nom);
  const ouvre = texte.indexOf('[', debut);
  return corpsDeTableau(texte.slice(ouvre + 1, fermant(ouvre, '[', ']')), profondeur);
}

function corpsDeTableau(corps, profondeur) {
  const sortie = [];
  if (profondeur === 1) {
    // Les feuilles : `null`, ou des littéraux dont les ADJACENTS se collent.
    let colle = false;
    for (const m of corps.matchAll(/null|,|"((?:[^"\\]|\\.)*)"/g)) {
      if (m[0] === ',') { colle = false; continue; }
      if (m[0] === 'null') { sortie.push(null); colle = false; continue; }
      if (colle && sortie.length) sortie[sortie.length - 1] += m[1];
      else sortie.push(m[1]);
      colle = true;                    // pas de virgule depuis : le suivant colle
    }
    return sortie;
  }
  for (let i = 0; i < corps.length; i++) {
    if (corps[i] !== '[') continue;
    let n = 0, f = -1;
    for (let k = i; k < corps.length; k++) {
      if (corps[k] === '[') n++;
      else if (corps[k] === ']') { n--; if (n === 0) { f = k; break; } }
    }
    if (f < 0) break;
    sortie.push(corpsDeTableau(corps.slice(i + 1, f), profondeur - 1));
    i = f;
  }
  return sortie;
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

// Les listes À RANGS : une rangée de phrases par humeur, avec des trous — un
// null est un silence, et il compte dans le tirage. La fée bavarde pioche dans
// sa rangée ; la timide a plus de trous que de mots.
function rangs(nom) {
  const debut = texte.indexOf('static var ' + nom);
  if (debut < 0) throw new Error('rangs introuvables : ' + nom);
  const ouvre = texte.indexOf('[', debut);
  const fin = fermant(ouvre, '[', ']');
  const corps = texte.slice(ouvre + 1, fin);
  const sortie = [];
  let i = 0;
  for (;;) {
    const o = corps.indexOf('[', i);
    if (o < 0) break;
    let n = 0, f = -1;
    for (let k = o; k < corps.length; k++) {
      if (corps[k] === '[') n++;
      else if (corps[k] === ']') { n--; if (n === 0) { f = k; break; } }
    }
    if (f < 0) break;
    const rang = corps.slice(o + 1, f);
    sortie.push([...rang.matchAll(/null|"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => (m[0] === 'null' ? null : m[1])));
    i = f + 1;
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
  // Ce que la fée DIT : sa rangée d'humeur, dans chaque liste.
  CLOUD_SHAPE: liste('CLOUD_SHAPE'),
  END_CHEER: rangs('endCheerList'),
  // FaerieInfo.reactCombo : au-dessus de seize points de cascade la fée
  // félicite, au-dessus de trente-six elle s'emballe. C'est le SEUL écho d'une
  // chaîne réussie dans le jeu d'origine — aucun nombre ne s'affiche.
  COMBO_CHEER: rangs('comboCheerList'),
  SUPER_COMBO_CHEER: rangs('superComboCheerList'),
  AMBIANCE_NORMAL: rangs('SENT_GAME_AMBIENT_NORMAL'),
  AMBIANCE_FINISH: rangs('SENT_GAME_AMBIENT_FINISH'),
  AMBIANCE_BATTLE: rangs('SENT_GAME_AMBIENT_BATTLE'),
  AMBIANCE_STRESS: rangs('SENT_GAME_AMBIENT_STRESS'),
  // Ce que la fée dit d'un objet qui DÉCOLLE (FaerieInfo.reactItem). Un aliment
  // (type ≥ 300) passe par SENT_GET_FOOD : quatre rangées — aimé, détesté, rare
  // (identifiant ≥ 10), ordinaire — puis l'humeur choisit la ligne, puis le
  // hasard la variante. Tout le reste passe par SENT_GET_ITEM, une rangée par
  // humeur. TRUC sert aux objets qu'elle ne sait pas nommer.
  TRUC: liste('TRUC'),
  SENT_GET_FOOD: tableau('SENT_GET_FOOD', 3),
  SENT_GET_ITEM: tableau('SENT_GET_ITEM', 2),
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

// Lang.getItemFamily — comment la fée NOMME un objet qu'elle ne connaît pas :
// par sa famille, jamais par son nom exact.
LANGUE.getItemFamily = function (n, alea) {
  const hasard = alea || Math.random;
  if (n >= 0 && n < 30) return "un objet magique";
  if (n >= 40 && n < 50) return LANGUE.TRUC[Math.floor(hasard() * LANGUE.TRUC.length)];
  if (n >= 50 && n < 60) return "une orbe";
  if (n >= 60 && n < 70) return LANGUE.TRUC[Math.floor(hasard() * LANGUE.TRUC.length)] + " coloré";
  if (n >= 70 && n < 80) return "une potion";
  if (n >= 80 && n < 90) return "un nouveau sac";
  if (n >= 100 && n < 200) return "un parchemin";
  if (n >= 200 && n < 300) return "un livre";
  if (n === 30) return "un bocal";
  if (n === 31) return "une clé";
  return "un Kouglof";
};

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
