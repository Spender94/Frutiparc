'use strict';
/*
 * LES ÉMOTES SE MOQUENT DE LA MAJUSCULE — PAS LES SMILEYS.
 *
 * « Quand un utilisateur tape Tousse ou Rigole (avec majuscule), l'émote ne se
 *   joue pas. » Le clavier d'un téléphone met une capitale en tête de message :
 * « tousse » devient « Tousse », et la correspondance exacte le laissait passer
 * comme du texte.
 *
 * Mais la casse a un sens pour les smileys : « :D » éclate de rire, « :d » tire
 * la langue ; « oO » est un visage, pas un mot. La règle est donc :
 *   1. le message tel quel d'abord ;
 *   2. sinon, s'il s'agit d'un MOT (déclencheur tout en minuscules : lettres,
 *      chiffres), on le compare sans tenir compte de la casse.
 *
 * Serveur (detectChatEmote : mode bleu, bureau, SWF) et light (detectEmote) ont
 * chacun leur fonction : on rejoue les deux, et elles doivent répondre pareil.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');

// Le code, de la table jusqu'à la fin de la fonction de détection.
function charger(source, debut, fonction) {
  const i = source.indexOf(debut);
  const f = source.indexOf('function ' + fonction + '(', i);
  assert.ok(i >= 0 && f > i, 'code introuvable : ' + fonction);
  // La fin de la fonction : l'accolade qui referme la première ouverte.
  let p = source.indexOf('{', f), prof = 0;
  for (; p < source.length; p++) {
    if (source[p] === '{') prof++;
    else if (source[p] === '}' && --prof === 0) break;
  }
  // eslint-disable-next-line no-new-func
  return new Function(source.slice(i, p + 1) + '\nreturn ' + fonction + ';')();
}
const serveur = charger(SRV, 'const CHAT_EMOTES = {};', 'detectChatEmote');
const light = charger(LIGHT, 'var EMOTE_MAP = {};', 'detectEmote');
const animServeur = (t) => { const e = serveur(t); return e ? e.anim : null; };
const animLight = (t) => { const e = light(t); return e.isEmote ? e.anim : null; };

const CAS = [
  // La capitale du téléphone, et le mot crié : l'émote se joue.
  ['tousse', 'tousse'], ['Tousse', 'tousse'], ['TOUSSE', 'tousse'],
  ['Rigole', 'rire'], ['Lol', 'mdr'], ['MDR', 'mdr'], ['Regarde', 'regard'],
  ['Beurk', 'beurk'], ['Clin', 'clin'], ['Assommé', 'assomme'], ['AÏE', 'assomme'],
  ['Sixseven', 'sixsept'], ['Gum2', 'gumm'], ['  Tousse  ', 'tousse'],
  // Les smileys gardent leur casse.
  [':D', 'mdr'], [':d', 'langue'], [':p', 'langue'], [':P', 'langue'],
  ['oO', 'question'], ['OO', null], ['oo', null], ['Oo', null],
  // Une phrase reste une phrase.
  ['Je tousse', null], ['Tousse !', null], ['', null],
];

for (const [texte, attendu] of CAS) {
  test(`« ${texte} » → ${attendu || 'texte'} (serveur et light)`, () => {
    assert.strictEqual(animServeur(texte), attendu, 'serveur');
    assert.strictEqual(animLight(texte), attendu, 'light');
  });
}
