'use strict';
/*
 * LA FICHE DU FRUTIZ, AU BUREAU (`win.Frutiz`, DoInitAction sprite#753 0x583ad)
 *
 * `win.Frutiz extends WinStandard` : c'est une FENÊTRE, pas une boîte de
 * dialogue. Rien ne s'assombrit derrière elle, et `initInterface` la rend
 * glissable par son cadre —
 *
 *     mcInterface.onPress = function() { box.activate(); initDrag(); }
 *
 * `initFrameSet` monte le HAUT sur `base = 42` : la plaque `frutiScreen`
 * (`fix: { w: base + 36, h: base }`), puis `mid` avec `cpFrutizBasicInfo` et
 * la rangée d'icônes — les boutons blancs calés à gauche, et à droite un
 * unique `butPushSmallPink` image 13 qui appelle `toggleAdvancedMode`.
 *
 * Ce bouton ajoute `explorer`, un `cpDocument` au style `frSheet` de
 * 250 × 244 ; `exitAdvancedMode` le retire et remet `pos.h = base`. Chaque
 * page s'ouvre par `getMenuLine` : les quatre catégories en TEXTE gras
 * centré, style 1, sauf la courante qui prend 1 + 10 = 11.
 *
 * Relevé 1:1 (scratchpad/fr-2-ouverte.png, origine au trait sombre) :
 * la fenêtre fait 324 de large, le haut est BLANC de y 5 à 53, la feuille
 * verte commence en 54 (#DDDDDD), 56 (#ADE76B), 58 (le reflet), et le filet
 * sous les onglets tombe en 79-80. Les encres : pseudo à la couleur du genre
 * (#242169 garçon, #BB4A44 fille), âge #404040, onglet courant #842929, tout
 * le reste #335511.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

// Le bloc du bureau seul — le mobile garde SA carte modale, et c'est bien.
const BLOC = CSS.slice(CSS.indexOf('LA FICHE (`win.Frutiz`'), CSS.indexOf('LA BOUTIQUE (`win.Shop`'));

test('rien ne s’assombrit derrière : c’est une FENÊTRE', () => {
  assert.ok(BLOC, 'le bloc de la fiche manque');
  assert.match(BLOC, /#fiche-backdrop \{[\s\S]*?background: none;[\s\S]*?pointer-events: none;/);
  assert.match(BLOC, /#fiche-backdrop\.show \{ display: block; \}/);
  // Et la fiche, elle, reçoit les clics.
  assert.match(BLOC, /#fiche \{[\s\S]*?pointer-events: auto;/);
  // Le mobile n'est pas touché : son voile reste là.
  assert.match(LIGHT, /#fiche-backdrop \{[\s\S]*?background: rgba\(20, 32, 8, \.45\);/);
});

test('elle se pose en escalier et se glisse par son cadre', () => {
  assert.match(JS, /function poserFiche\(\) \{[\s\S]*?f\.style\.setProperty\('--fx'/);
  assert.match(JS, /ficheRang = \(ficheRang \+ 1\) % 8;/);
  // `initDrag` : on l'attrape par le cadre, pas par un bouton ni la feuille.
  assert.match(JS, /if \(ev\.target\.closest\('button, a, input, \.fiche-corps'\)\) return;/);
  assert.match(BLOC, /#fiche \{\s*\n\s*position: absolute; left: var\(--fx, 220px\); top: var\(--fy, 120px\);/);
  // Le light prévient le bureau à l'ouverture.
  assert.match(LIGHT, /if \(window\.BureauFrutiz && BureauFrutiz\.poserFiche\) BureauFrutiz\.poserFiche\(\);/);
});

test('le gabarit : 324 de large, un HAUT blanc de base = 42, une feuille verte', () => {
  assert.match(BLOC, /#fiche \{[\s\S]*?width: 324px;/);
  assert.match(BLOC, /#fiche \{[\s\S]*?background: #FFFFFF;/);
  // `frutiScreen` : `fix { w: base + 36, h: base }` — 76 × 42, cerclé #888888.
  assert.match(BLOC, /\.fiche-plaque \{\s*\n\s*height: 42px; width: 76px;[\s\S]*?border: 1px solid #888888;/);
  assert.match(BLOC, /\.fiche-plaque \.fa-frame \{ width: 36px; height: 36px;/);
  // `explorer` : un `cpDocument` au style frSheet — le vert du bureau.
  assert.match(BLOC, /\.fiche-corps \{[\s\S]*?#CCF599;[\s\S]*?inset 0 2px 0 #ADE76B/);
  // `getPageObj` la borne à 240 de haut.
  assert.match(BLOC, /\.fiche-page \{\s*\n\s*height: 240px;/);
});

test('les quatre onglets : colonnes égales, texte gras, le courant en #842929', () => {
  assert.match(BLOC, /\.fiche-onglets \{[\s\S]*?grid-template-columns: repeat\(4, 1fr\);/);
  assert.match(BLOC, /\.fiche-onglets \{[\s\S]*?border-bottom: 2px solid #ADE76B;/);
  assert.match(BLOC, /\.fiche-onglets button \{[\s\S]*?font: 700 12px Verdana[^;]*; color: #335511;/);
  assert.match(BLOC, /\.fiche-onglets button\.actif \{ color: #842929; \}/);
  // `categoryList` donne des minuscules, et le titre de page reprend la clé.
  assert.match(BLOC, /\.fiche-onglets button \{[\s\S]*?text-transform: lowercase;/);
  assert.match(BLOC, /\.fiche-titre \{\s*\n\s*color: #335511; font-size: 12px; text-transform: lowercase;/);
});

test('les encres relevées, genre compris', () => {
  // `UserSlot.onInfoBasic` : le pseudo prend la couleur du GENRE.
  assert.match(BLOC, /#fiche-pseudo \{\s*\n\s*font: 700 11px Verdana[^;]*; color: #242169;/);
  assert.match(BLOC, /#fiche\.elle #fiche-pseudo \{ color: #BB4A44; \}/);
  assert.match(BLOC, /\.fiche-nom-ligne \.meta \{[\s\S]*?color: #404040;/);
  assert.match(BLOC, /\.fiche-ligne \.lib,\s*\nbody\.bureau-frutiz #fiche \.fiche-ligne \.val \{ color: #335511; \}/);
  // Le serveur donne déjà le sexe, et le bureau le lit.
  assert.match(LIGHT, /window\.ficheDerniere = function \(\) \{ return ficheEtat && ficheEtat\.data; \};/);
  assert.match(JS, /f\.classList\.toggle\('elle', !!\(d && d\.basic && d\.basic\.sexe === 'F'\)\);/);
});

test('rien de tout cela ne touche le mobile', () => {
  const mauvaises = [...BLOC.matchAll(/^([.#a-zA-Z][^{\n]*)\{/gm)]
    .map((m) => m[1].trim())
    .filter((s) => !/^body\.bureau-frutiz/.test(s) && !/^@/.test(s));
  assert.deepStrictEqual(mauvaises, [], 'des règles échappent au cloisonnement mobile');
});
