'use strict';
/*
 * PARLER, C'EST ENTRER DANS L'AQUARIUM — QUEL QUE SOIT LE FEUTRE
 *
 * « Lorsqu'on utilise un feutre gras sur le salon (rouge modo, blueon, feutre
 * multicolore), la bouille n'apparaît pas dans l'aquarium. »
 *
 * Le client Light range les trames `<t>` dans un `switch` : chaque façon de
 * parler y a sa branche, et la bouille n'entrait dans la colonne d'écrans que
 * tout en bas, sur le chemin du TEXTE ORDINAIRE. Trois branches en sortaient
 * avant :
 *
 *   · le mode bleu       `t="c"`   (/blueon, animateurs et modérateurs)
 *   · le cri rouge       `st="r"`  (« !message », staff du salon)
 *   · le multicolore     `st="mc"` (le feutre de boutique)
 *
 * Chacune faisait son rendu puis `break`. Résultat : les gens dont on veut
 * justement voir la tête — le staff qui annonce, celui qui crie — restaient
 * invisibles dans l'aquarium.
 *
 * Le cri pose un problème de plus : il part en `u="admin"` (c'est ce qui donne
 * au SWF son rendu sans préfixe, le pseudo étant DANS le corps). Le client
 * n'avait donc personne à faire entrer. Le serveur y ajoute `au` — un attribut
 * que le SWF ignore, et qui rend au cri sa bouille.
 *
 * Relevé au navigateur (scratchpad/aquarium-feutres.js), un modérateur qui
 * possède le feutre multicolore, vu par un tiers :
 *
 *     texte ordinaire              aquarium : « <pseudo> parle »
 *     cri rouge (!)                aquarium : « <pseudo> parle »
 *     ligne en mode bleu           aquarium : « <pseudo> parle »
 *     ligne arc-en-ciel            aquarium : « <pseudo> parle »
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Le corps du `case` des trames de chat, depuis la lecture du pseudo jusqu'à la
// branche du texte ordinaire.
const BLOC = LIGHT.slice(
  LIGHT.indexOf('var from = attr(xml, "u");'),
  LIGHT.indexOf('// ── Ouverture d\'une discussion privée, demandée par nous ──'));

test('une seule porte pour entrer dans l’aquarium, et elle écarte l’admin', () => {
  assert.match(BLOC, /var entrerDansLAquarium = function \(qui\) \{/);
  // Une ligne d'admin (annonce, quiz) n'a personne derrière elle ; un rejeu
  // ferait rentrer tout le salon au retour sur l'onglet.
  assert.match(BLOC, /if \(!q \|\| q === "admin" \|\| enRejeu\) return;/);
  assert.match(BLOC, /showBouilleOverlay\(q, "parle", null, salon\);/);
});

test('les trois feutres gras y passent, chacun par sa branche', () => {
  // Mode bleu : `t="c"`.
  const bleu = BLOC.slice(BLOC.indexOf('if (ty === "c") {'));
  assert.match(bleu.slice(0, bleu.indexOf('break;')), /entrerDansLAquarium\(\);/,
    'le mode bleu fait entrer son auteur');
  // Multicolore : `st="mc"`.
  const mc = BLOC.slice(BLOC.indexOf('if (attr(xml, "st") === "mc") {'));
  assert.match(mc.slice(0, mc.indexOf('break;')), /entrerDansLAquarium\(\);/,
    'le feutre multicolore aussi');
  // Cri rouge : `st="r"` — et par son attribut `au`, le pseudo n'étant pas
  // dans `u`.
  const cri = BLOC.slice(BLOC.indexOf('var isShout = (attr(xml, "st") === "r");'));
  assert.match(cri.slice(0, cri.indexOf('break;')),
    /if \(isShout\) entrerDansLAquarium\(xmlUnescape\(attr\(xml, "au"\)\)\);/,
    'le cri rouge entre sous le nom que porte `au`');
});

test('le serveur signe le cri rouge de son auteur', () => {
  const bloc = SERVEUR.slice(SERVEUR.indexOf('const redStamp ='),
    SERVEUR.indexOf('pousserNotifMentionChat(g, client.username, shout, mentionnes);'));
  assert.match(bloc, /st="r" au="\$\{escapeXml\(getDisplayName\(client\.username\)\)\}"/,
    'la trame du cri porte `au`');
  // Et elle reste en u="admin" : c'est ce qui donne au SWF son rendu sans
  // préfixe. On ajoute, on ne remplace pas.
  assert.match(bloc, /u="admin" t="m"/);
});

test('le texte ordinaire garde son chemin — l’émote comprise', () => {
  // Ce qui marchait déjà ne doit pas changer : la ligne ordinaire fait entrer
  // son auteur avec l'animation détectée (« mdr », « siffle »…), pas avec
  // « parle » forcé.
  assert.match(BLOC, /if \(from && !isAdmin && !enRejeu\) showBouilleOverlay\(from, em\.anim, em\.label, salon\);/);
});
