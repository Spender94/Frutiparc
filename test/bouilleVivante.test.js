/*
 * LA BOUILLE VIVANTE — deux oublis qui se voyaient beaucoup.
 *
 * 1. LA BOUCHE PERDAIT SA COULEUR. `apply(s)` ne teinte qu'UNE FOIS, en
 *    parcourant l'arbre tel qu'il est à cet instant. Une pellicule qui change
 *    d'image remplace ses pièces (Flash ne garde un enfant que s'il retrouve sa
 *    PROFONDEUR avec le MÊME caractère) : dès que la bouche changeait de dessin,
 *    la nouvelle pièce arrivait vierge.
 *
 *    L'époque ne rattrape pas le coup après coup : chaque pièce colorée porte
 *    sur SA propre image 1 un script de soixante et onze octets qui rappelle
 *    `_parent._parent._parent._parent.applyColor(this.col)`. Trente-six pièces
 *    le font dans famille0.swf. Le portage jouait bien ces scripts — mais la
 *    racine ne savait pas répondre à `applyColor`.
 *
 * 2. LA BOUILLE D'UN SALON ÉTAIT FIGÉE au moment où l'on entrait dans la
 *    fenêtre. Le statut d'époque (`StatusMng.send`, 0x33eb0) empile TROIS
 *    champs en base 62 — external, internal, ET emote — que le serveur
 *    reconstruit sur quatre caractères. On ne lisait que le voyant de jeu ;
 *    l'humeur, quatrième caractère, était jetée, et personne ne prévenait la
 *    colonne d'écrans quand une bouille changeait.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MOTEUR = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');
const VIGNETTE = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const Swf = require('../public/js/bouille-swf.js');
const M = require('../public/js/bouille-moteur.js');

const FAMILLE = path.join(ROOT, 'public/swf/fbouille/famille0.swf');
let defs = null;
async function famille() {
  if (!defs) defs = Swf.lire(await Swf.decompresser(new Uint8Array(fs.readFileSync(FAMILLE))));
  return defs;
}

/* ── 1. LA BOUCHE GARDE SA COULEUR ────────────────────────────────────────── */

test('le SWF de famille fait rappeler la teinte par les pièces elles-mêmes', async () => {
  // C'est le fait qui justifie tout le reste : trente-six sprites portent, sur
  // leur image 1, un script qui contient le nom `applyColor`.
  const d = await famille();
  let n = 0;
  for (const [, p] of d.sprites) {
    for (const o of (p.images[0] || [])) {
      if (o.t === 'script' && Buffer.from(o.code).toString('latin1').includes('applyColor')) n++;
    }
  }
  assert.ok(n >= 30, 'seulement ' + n + ' pièce(s) se recolorent elles-mêmes');
});

test('la racine sait répondre à applyColor, et lit faceColor', () => {
  assert.match(MOTEUR, /applyColor: function \(mc\) \{[\s\S]*?mc\.teinte = PALETTE\[this\.faceColor\] \|\| PALETTE\[0\];/);
  // `apply(s)` du SWF pose ses douze valeurs en variables de RACINE : c'est là
  // que `applyColor` va chercher `faceColor`.
  assert.match(MOTEUR, /Object\.assign\(this\.racine, this\.etat\);/);
});

test('la bouche reste teintée d’une humeur à l’autre', async () => {
  const d = await famille();
  const etat = '000305020a0f00000000000000'.slice(0, 24);
  const teinteBouche = (m) => {
    const face = m.racine.face;
    const bb = face.enfantNomme('b').enfantNomme('b');
    const col = bb.enfantNomme('col');
    const dedans = col && col.enfantNomme('col');
    return dedans ? dedans.teinte : null;
  };

  const m = new M.Moteur(d, { alea: () => 0.5 });
  m.definir(etat);
  const attendue = teinteBouche(m);
  assert.ok(Array.isArray(attendue) && attendue.length === 3, 'la bouche démarre teintée');
  for (const h of [1, 2, 3, 4, 5, 6, 7, 0]) {
    m.humeur(h);
    assert.deepStrictEqual(teinteBouche(m), attendue, 'la bouche perd sa couleur à l’humeur ' + h);
  }

  // Et SANS `applyColor`, elle la perd : c'est bien lui qui tient l'édifice.
  const nu = new M.Moteur(d, { alea: () => 0.5 });
  nu.racine.applyColor = function () { return undefined; };
  nu.definir(etat);
  nu.humeur(3);
  assert.strictEqual(teinteBouche(nu), null);
});

test('revenir au visage neutre est une humeur comme une autre', () => {
  // `humeur(0)` est le visage NEUTRE, pas « pas d'humeur ». Le tester
  // interdisait tout retour au calme — une bouille fâchée le restait.
  assert.match(VIGNETTE, /\/\/ `humeur\(0\)` est le visage NEUTRE[\s\S]*?b\.humeur\(e\);/);
  assert.doesNotMatch(VIGNETTE, /if \(e\) b\.humeur\(e\);/);
});

/* ── 2. L'ÉTAT SUIT SON PROPRIÉTAIRE ──────────────────────────────────────── */

test('le statut porte QUATRE champs, et le quatrième est l’humeur', () => {
  // `StatusMng.send` (0x33eb0) : encode62(external) + encode62(internal)
  // + encode62(emote). Le serveur en fait `[ext][internal×2][emote]`.
  assert.match(SERVEUR, /return `\$\{encode62\(ext, 1\)\}\$\{encode62\(internal, 2\)\}\$\{encode62\(emote, 1\)\}`;/);
  // Le light lisait les deux du milieu (le voyant de jeu) et jetait le dernier.
  assert.match(LIGHT, /var interne = decode62\(String\(s\)\.substring\(1, 3\)\);/);
  assert.match(LIGHT, /var em = String\(s\)\.length > 3 \? decode62\(String\(s\)\.substring\(3, 4\)\) : 0;/);
  assert.match(LIGHT, /state\.humeurByUser\[cle\] = em;/);
});

test('changer d’humeur le dit au salon', () => {
  // `StatusMng.setEmote(eId)` (0x33e29) pose le champ puis appelle `send()`.
  assert.match(LIGHT, /envoyerMonStatut\(\{ emote: homeMood \}\);/);
  assert.match(LIGHT, /wsSend\('<af s="' \+ neuf \+ '" \/>'\);/);
  // Les deux autres champs se relisent dans le dernier statut connu : changer
  // d'humeur ne doit pas éteindre le voyant du jeu en cours.
  assert.match(LIGHT, /var s = String\(state\.statutMien \|\| "0000"\);/);
  assert.match(LIGHT, /if \(cle === state\.userLower\) \{/);
  // Et le serveur accepte le code court comme le nom long.
  assert.match(SERVEUR, /const cmdName = CMD_REV\[msg\.tag\] \|\| msg\.tag;/);
  assert.match(SERVEUR, /status: +'af',/);
});

test('un changement de bouille ou d’humeur rafraîchit les fenêtres ouvertes', () => {
  assert.match(LIGHT, /function majBouillesPartout\(\) \{[\s\S]*?BureauFrutiz\.majBouilles\(\);/);
  assert.match(LIGHT, /if \(avant && avant !== clean\) majBouillesPartout\(\);/);
  assert.match(LIGHT, /if \(avantEm !== em\) majBouillesPartout\(\);/);
  // L'humeur voyage avec les membres, comme la bouille.
  assert.match(LIGHT, /humeur: humeurDe\(n\),/);
});

test('l’écran d’un salon se refait quand l’état OU l’humeur change', () => {
  assert.match(JS, /function poserBouille\(ecran, bouille, pseudo, humeur\) \{/);
  assert.match(JS, /var memeEtat = ecran\.getAttribute\('data-bouille'\) === bouille;/);
  assert.match(JS, /var memeHumeur = ecran\.getAttribute\('data-humeur'\) === em;/);
  assert.match(JS, /if \(memeEtat && memeHumeur\) return;/);
  // Une humeur seule ne recharge RIEN : l'arbre est déjà monté.
  assert.match(JS, /if \(memeEtat && toile\) \{ FPBouilleVignette\.rafraichir\(toile, bouille, Number\(em\)\); return; \}/);
  assert.match(JS, /poserBouille\(ecran, g\.bouille, g\.pseudo, g\.humeur\);/);
});
