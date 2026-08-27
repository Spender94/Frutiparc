'use strict';
/*
 * LES SEPT BOUTONS D'HUMEUR, ET LA LARGEUR DE LA BARRE.
 *
 * ── 1. LE CÂBLAGE DES HUMEURS ────────────────────────────────────────────
 *
 * `MainBar.initEmoteIconList` (0x6b6a4) monte la rangée dans une boucle, et
 * la boucle dit tout :
 *
 *     for (i = 0; i < 7; i++)
 *       emoteIconList.push({ link: "butPush", param: {
 *         link: "butPushEmoteIcon", frame: 1 + i,        ← l'image de la bande
 *         outline: 2, curve: 8,
 *         buttonAction: [{ onPress: { obj: me.status,
 *                                     method: "setEmote", args: i } }] }});
 *
 * Donc **image i+1 ↔ humeur i**, et les sept boutons couvrent les humeurs
 * **0 à 6** : le premier est le visage NEUTRE, et « Totoché » (7) n'a pas de
 * bouton dans la barre.
 *
 * L'ORDRE DES IMAGES se lit dans la bande elle-même : `butPushEmoteIcon`
 * (#103) n'enveloppe que le clip #102, qui pose ch89, 91, 93, 95, 97, 99, 101
 * aux profondeurs 1 à 7 — une par image. Les SVG extraits portent ces numéros
 * dans leur `PatternID`, ce qui donne la correspondance sans supposition.
 *
 * Le recoupement avec `emoteList` est net : l'humeur 5 est `[œil 1, bouche 4]`,
 * soit les sourcils de la colère sur le sourire à pleines dents — exactement
 * le rictus de l'image 6 (`emote_fou`) ; et l'humeur 6 est `[œil 2, bouche 3]`,
 * les yeux clos de la tristesse sur le sourire — l'image 7 (`emote_transi`).
 *
 * LE PIÈGE, tombé une fois : l'ordre d'AFFICHAGE avait été relevé juste et
 * refait en CSS (`order:`), mais le DOM partagé gardait `e = 1..7`. La rangée
 * paraissait d'époque et cliquer le visage neutre posait « Déterminé ». Le
 * décalage se voyait sur la bouille, pas sur la barre.
 *
 * ── 2. LA LARGEUR DE LA BARRE ────────────────────────────────────────────
 *
 * La barre tient trois mesures d'époque — la bouille (64), l'écart (5) et la
 * colonne de droite (146) —, soit 215 px. On l'écrivait `width: max-content`
 * sous un `max-width: calc(100% - 25px)`, et la colonne de droite restait
 * rétrécissable (`flex: 1 1 auto; min-width: 0`) : deux tailles INTRINSÈQUES
 * là où le SWF n'a que des fixes. Sous Firefox l'encart se faisait rogner —
 * ses raccourcis disparaissaient dans son `overflow: hidden` — pendant que la
 * rangée d'émotions, elle, gardait ses sept boutons de 21 px et débordait par
 * la droite. Une largeur fixe ne peut pas diverger d'un moteur à l'autre.
 *
 * Mesuré au banc (Chromium) : barre 215, encart 146 × 41, colonne 146,
 * rangée 146, six raccourcis dans l'encart.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');

/* ── LE CÂBLAGE ───────────────────────────────────────────────────────────── */

const TABLE = LIGHT.slice(LIGHT.indexOf('var HOME_EMOTES = ['),
  LIGHT.indexOf('];', LIGHT.indexOf('var HOME_EMOTES = [')));

test('les sept boutons portent les humeurs 0 à 6, dans l’ordre de la bande', () => {
  const lus = [];
  const re = /\{ file: "([a-z_]+)",\s*e: (\d),/g;
  let m;
  while ((m = re.exec(TABLE)) !== null) lus.push([m[1], Number(m[2])]);
  assert.deepStrictEqual(lus, [
    ['emote_stoique', 0], ['emote_mechant', 1], ['emote_triste', 2],
    ['emote_content', 3], ['emote_ravi', 4], ['emote_fou', 5],
    ['emote_transi', 6],
  ]);
});

test('l’ordre vient des PatternID des SVG, qui sont ceux de la bande #102', () => {
  // ch89, 91, 93, 95, 97, 99, 101 aux profondeurs 1 à 7 de #102.
  const attendus = [['emote_stoique', 89], ['emote_mechant', 91], ['emote_triste', 93],
    ['emote_content', 95], ['emote_ravi', 97], ['emote_fou', 99], ['emote_transi', 101]];
  for (const [nom, ch] of attendus) {
    const svg = fs.readFileSync(path.join(ROOT, 'public/fb', nom + '.svg'), 'utf8');
    const m = /PatternID_(\d+)_/.exec(svg);
    assert.ok(m, nom + ' : pas de PatternID');
    assert.strictEqual(Number(m[1]), ch, nom + ' devrait être ch' + ch);
  }
});

test('« Totoché » n’a pas de bouton : la boucle d’époque s’arrête à sept', () => {
  assert.doesNotMatch(TABLE, /e: 7,/);
  assert.strictEqual((TABLE.match(/\{ file: /g) || []).length, 7);
});

test('un clic pose l’humeur du bouton, sans bascule vers le neutre', () => {
  // La rangée A un bouton neutre : il n'y a rien à basculer. (`setEmote(i)`.)
  assert.match(LIGHT, /b\.addEventListener\("click", function \(\) \{ setHomeMood\(it\.e\); \}\);/);
  assert.doesNotMatch(LIGHT, /setHomeMood\(homeMood === it\.e \? 0 : it\.e\)/);
});

test('le bureau ne réordonne plus rien : le DOM sort déjà juste', () => {
  assert.doesNotMatch(CSS, /#bureau-coin \.em-btn\[data-e="\d"\] \{ order:/);
  // La rangée garde en revanche son gabarit d'époque.
  assert.match(CSS, /#bureau-coin \.em-btn \{\s*\n\s*flex: 0 0 21px; width: 21px; height: 21px;/);
});

/* ── LA LARGEUR ───────────────────────────────────────────────────────────── */

test('la barre a une largeur DONNÉE, pas déduite', () => {
  const bloc = CSS.slice(CSS.indexOf('body.bureau-frutiz #bureau-coin .mainbar {'),
    CSS.indexOf('body.bureau-frutiz #bureau-coin .mb-top'));
  assert.match(bloc, /width: 215px; max-width: none;/);
  assert.doesNotMatch(bloc, /max-content/);
});

test('la colonne de droite ne peut pas rétrécir sous ses 146 px', () => {
  const bloc = CSS.slice(CSS.indexOf('body.bureau-frutiz #bureau-coin .mb-right {'),
    CSS.indexOf('}', CSS.indexOf('body.bureau-frutiz #bureau-coin .mb-right {')));
  assert.match(bloc, /flex: 0 0 146px;/);
  assert.match(bloc, /width: 146px;/);
  // Le tiroir mobile, lui, garde son `flex: 1 1 auto; min-width: 0`.
  assert.match(LIGHT, /\.mb-right \{ flex: 1 1 auto; min-width: 0;/);
});
