'use strict';
/*
 * LES ICÔNES DE JEU DANS LE FRUTIJOB.
 *
 * « Maître ÈS Frutisnake 2026 » — mais un joueur peut cumuler les titres. Le
 * frutijob accepte donc des codes entre crochets :
 *
 *     Maître ÈS [snake] [kaluga] 2026
 *
 * sans rien changer en base : c'est toujours le même texte de 80 caractères.
 *   · le light dessine l'icône du jeu (la même que le voyant « en partie ») ;
 *   · le bureau (le SWF d'origine, qu'on ne retouche pas) reçoit du texte :
 *     « Maître ÈS Frutisnake, Kaluga 2026 » ;
 *   · un code inconnu reste tel quel — une faute de frappe se voit ;
 *   · l'admin rappelle tous les codes sous le champ.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');

// Le code du serveur, de la table jusqu'à la fin de `frutijobEnTexte`.
function charger() {
  const i = SRV.indexOf('const FRUTIJOB_JEUX = {');
  const f = SRV.indexOf('function frutijobEnTexte(', i);
  assert.ok(i >= 0 && f > i, 'table et fonctions du frutijob introuvables');
  let p = SRV.indexOf('{', f), prof = 0;
  for (; p < SRV.length; p++) {
    if (SRV[p] === '{') prof++;
    else if (SRV[p] === '}' && --prof === 0) break;
  }
  // eslint-disable-next-line no-new-func
  return new Function(SRV.slice(i, p + 1) + '\nreturn { FRUTIJOB_JEUX, frutijobMorceaux, frutijobEnTexte };')();
}
const { FRUTIJOB_JEUX, frutijobMorceaux, frutijobEnTexte } = charger();

test('bureau : les codes deviennent les noms des jeux, séparés par des virgules', () => {
  assert.strictEqual(frutijobEnTexte('Maître ÈS [snake] [kaluga] 2026'), 'Maître ÈS Frutisnake, Kaluga 2026');
  assert.strictEqual(frutijobEnTexte('Maître ÈS [snake] 2026'), 'Maître ÈS Frutisnake 2026');
  assert.strictEqual(frutijobEnTexte('[kiwi][swapou][bandas]'), 'Burning Kiwi, Swapou, Frutibandas');
  assert.strictEqual(frutijobEnTexte('Roi de [SNAKE]'), 'Roi de Frutisnake', 'la casse du code ne compte pas');
  assert.strictEqual(frutijobEnTexte('[snake] et [kaluga]'), 'Frutisnake et Kaluga', 'du texte entre deux codes reste');
  assert.strictEqual(frutijobEnTexte('Maître ÈS [toto] 2026'), 'Maître ÈS [toto] 2026', 'un code inconnu reste visible');
  assert.strictEqual(frutijobEnTexte('Animateur'), 'Animateur');
  assert.strictEqual(frutijobEnTexte(''), '');
});

test('light : le titre en morceaux — du texte et des jeux', () => {
  assert.deepStrictEqual(frutijobMorceaux('Maître ÈS [snake] [kaluga] 2026'), [
    { texte: 'Maître ÈS ' },
    { jeu: 'snake3', nom: 'Frutisnake' },
    { texte: ' ' },
    { jeu: 'kaluga', nom: 'Kaluga' },
    { texte: ' 2026' },
  ]);
  assert.strictEqual(frutijobMorceaux('Maître ÈS [toto]'), null, 'aucun code connu : le texte suffit');
  assert.deepStrictEqual(frutijobMorceaux('[snake] [toto]'), [
    { jeu: 'snake3', nom: 'Frutisnake' },
    { texte: ' [toto]' },
  ], 'un code inconnu reste du texte à côté d\'un code connu');
  assert.strictEqual(frutijobMorceaux('Animateur'), null, 'sans icône, pas de morceaux : le texte suffit');
});

test('chaque code mène à une icône qui existe', () => {
  const codes = Object.keys(FRUTIJOB_JEUX);
  assert.ok(codes.length >= 11, 'les onze jeux');
  for (const code of codes) {
    const j = FRUTIJOB_JEUX[code];
    assert.match(code, /^[a-z0-9]+$/, 'code simple : ' + code);
    assert.ok(j.nom, 'nom pour ' + code);
    assert.ok(fs.existsSync(path.join(ROOT, 'public', 'fb', 'voyant_' + j.voyant + '.png')), 'icône de ' + code);
  }
});

test('le bureau reçoit le texte, le light les morceaux', () => {
  const fj = SRV.match(/fj="\$\{escapeXml\([^}]*\)\}"/g) || [];
  assert.strictEqual(fj.length, 2, 'les deux trames de fiche');
  for (const x of fj) assert.match(x, /frutijobEnTexte\(getFrutizJob\(/, x);
  assert.match(SRV, /job: frutijobEnTexte\(getFrutizJob\(u, ud\)\),\s*jobMorceaux: frutijobMorceaux\(getFrutizJob\(u, ud\)\),/);
  assert.match(LIGHT, /ligneFiche\("frutiJob", frutijobAvecIcones\(d\.frutiz\)\)/);
  assert.match(LIGHT, /function frutijobAvecIcones\(f\) \{[\s\S]*?srcVoyant\(m\.jeu\)/);
});

test('l\'admin rappelle tous les codes sous le champ FrutiJob', () => {
  assert.match(SRV, /app\.get\('\/api\/frutijob\/jeux'/);
  assert.match(ADMIN, /<input id="edit-frutijob"[^>]*>[\s\S]{0,400}id="frutijob-aide"/);
  assert.match(ADMIN, /fetch\('\/api\/frutijob\/jeux'\)/);
});
