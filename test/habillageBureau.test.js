/*
 * SIX RETOUCHES D'HABILLAGE DU BUREAU, toutes tirées du SWF.
 *
 * 1. La feuille verte de la fiche garde deux pixels de blanc sur ses trois
 *    côtés libres, comme la plaque d'une fenêtre laisse voir son liseré.
 * 2. Le voyant « en partie » tient dans la bande de 18 px du `userSlot`.
 * 3. La poignée de redimensionnement se dessine DERRIÈRE la fenêtre — les
 *    profondeurs de `win.Advance` le disent au chiffre près.
 * 4. Les pastilles « staff » et « toi » n'existent pas d'époque.
 * 5. La bande des contacts n'a pas d'ascenseur : ce n'est pas un `cpDocument`.
 * 6. L'ascenseur des fenêtres est celui de `sb.Round` (sprite#865), qui n'est
 *    pas un dessin mais un TRACÉ : deux gélules à liseré d'un pixel.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const GLOBAL = fs.readFileSync(path.join(ROOT, 'frutiparc/global.as'), 'latin1');
const STANDARD = fs.readFileSync(path.join(ROOT, 'frutiparc/Standard.as'), 'latin1');

/* ── 1. LA FEUILLE DE LA FICHE ────────────────────────────────────────────── */

test('la feuille verte de la fiche laisse deux pixels de blanc', () => {
  assert.match(CSS, /#fiche \.fiche-corps \{\s*\n\s*margin: 0 2px 2px;/);
});

/* ── 2. LE VOYANT « EN PARTIE » ───────────────────────────────────────────── */

test('le voyant tient dans la bande de 18 du userSlot', () => {
  // La bande fait 18 px (`userSlot` #261) ; le gabarit mobile en met 22, qui
  // la débordent de quatre et poussent le pseudo hors du centre.
  // La règle est désormais COMMUNE au salon et à la fenêtre de Gaspard :
  // `cp.UserList` monte le même `userSlot` dans les deux.
  assert.match(CSS, /#users-drawer \.u,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u \{[\s\S]*?height: 18px; min-height: 18px;/);
  // Le voyant est POSÉ, pas rangé dans un flux : `UserSlot.init` (0x63541)
  // attache le champ du pseudo à `_x = 20` et laisse les vingt pixels de
  // gauche au clip `icon`. Le pseudo, lui, part de la gauche.
  const bloc = /#users-drawer \.u \.voyant,[\s\S]*?\.u \.voyant \{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(bloc, 'la règle du voyant doit exister');
  assert.match(bloc[1], /position: absolute; left: 3px; top: 2px;/);
  assert.match(bloc[1], /width: 14px; height: 14px; flex: 0 0 14px;/);
  assert.match(CSS, /#users-drawer \.u,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u \{[\s\S]*?padding: 0 4px 0 22px;/);
  assert.match(CSS, /#users-drawer \.u,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u \{[\s\S]*?justify-content: flex-start;/);
  // Le mobile, lui, garde ses 22 : la tuile y est assez grande.
  assert.match(LIGHT, /#users-drawer \.u \.voyant \{ width: 22px; height: 22px;/);
});

/* ── 3. LA POIGNÉE PASSE DERRIÈRE ─────────────────────────────────────────── */

test('le dessin de la poignée se peint sous la fenêtre', () => {
  // `win.Advance` : dp_outline 10 · dp_inline 20 · dp_resizeArrow 30 · …
  // dp_interface 100 · dp_frameBg 112 · dp_butResize 160. Le DESSIN (30) passe
  // donc sous la plaque (112) ; seule la zone sensible (160) reste au-dessus.
  assert.match(CSS, /\.fen-poignee-vue \{[\s\S]*?z-index: -1;/);
  assert.match(CSS, /\.fen-poignee \{[\s\S]*?z-index: 3;/);
  // La plaque blanche de la fenêtre est bien au-dessus du négatif.
  assert.match(CSS, /\.fen::before \{[\s\S]*?inset: 2px; z-index: 0;/);
});

/* ── 4. LES PASTILLES ─────────────────────────────────────────────────────── */

test('ni « staff » ni « toi » dans la liste des connectés du bureau', () => {
  // La règle est désormais COMMUNE au salon et à la fenêtre de Gaspard :
  // `cp.UserList` monte le même `userSlot` dans les deux.
  assert.match(CSS, /#users-drawer \.u \.badge,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u \.badge \{ display: none; \}/);
  // Et plus de règle qui les habillerait : elles ne s'affichent plus du tout.
  assert.doesNotMatch(CSS, /#users-drawer \.u \.badge \{\s*\n\s*flex: 0 0 auto;/);
  // Le mobile les garde — `ligneConnecte` continue de les poser.
  assert.match(LIGHT, /if \(staff\) \{ var s = el\("span", "badge staff"\); s\.textContent = "staff";/);
  assert.match(LIGHT, /var b = el\("span", "badge moi"\); b\.textContent = "toi";/);
});

/* ── 5. LA BANDE DES CONTACTS ─────────────────────────────────────────────── */

test('la bande des contacts n’a pas d’ascenseur', () => {
  assert.match(CSS, /#side-list \.sl-liste \{[\s\S]*?scrollbar-width: none;/);
  assert.match(CSS, /#side-list \.sl-liste::-webkit-scrollbar \{ display: none; width: 0; height: 0; \}/);
});

/* ── 6. L'ASCENSEUR DES FENÊTRES ──────────────────────────────────────────── */

test('l’ascenseur reprend le tracé de sb.Round, encres comprises', () => {
  // `sb.Round.init` : size 12 par défaut, mais le `scrollInfo` d'un composant
  // (`initMask`, 0x460e2) impose size 14 et margin { top: 4, side: 2 }.
  // `shadeSpace = 1`, `curve = size / 2 = 7`, `minSquareSize = 16`.
  assert.match(CSS, /\.fen \*::-webkit-scrollbar,[\s\S]{0,80}\{\s*\n\s*width: 18px; height: 18px;/);
  assert.match(CSS, /::-webkit-scrollbar-track,[\s\S]{0,90}\{\s*\n\s*background-color: var\(--asc-glissiere\);[\s\S]*?border: 4px solid transparent; border-left-width: 2px; border-right-width: 2px;[\s\S]*?box-shadow: inset 0 0 0 1px var\(--asc-liseret\);/);
  assert.match(CSS, /::-webkit-scrollbar-thumb,[\s\S]{0,90}\{\s*\n\s*min-height: 16px;[\s\S]*?background-color: #FFFFFF;[\s\S]*?box-shadow: inset 0 0 0 1px #DDDDDD;/);
  // Ni flèches ni coin : `sb.Round` n'en dessine aucun.
  assert.match(CSS, /::-webkit-scrollbar-button,[\s\S]{0,90}\{ display: none; \}/);

  // Le CURSEUR est blanc partout : `color.fore = win.style.global.color[0]`,
  // et `getWinStyle().global.color[0]` vaut `colorSet.white`.
  const white = GLOBAL.slice(GLOBAL.indexOf('white:{'), GLOBAL.indexOf('green:{'));
  assert.match(white, /main:\s*0xFFFFFF/);
  assert.match(white, /shade:\s*0xDDDDDD/);
  assert.match(STANDARD, /global:\{\s*\n\s*color:\[\s*\n\s*_global\.colorSet\.white,/);
});

test('la GLISSIÈRE prend la couleur du composant, fenêtre par fenêtre', () => {
  // `color.back = composant.style.color[0]` : c'est le style DU COMPOSANT qui
  // décide, pas celui de la fenêtre. Chaque teinte est le `shade` (le corps) et
  // le `dark` (le liseré) du jeu de couleurs que `getWinStyle()` lui donne.
  const jeu = (nom, suivant) => GLOBAL.slice(GLOBAL.indexOf(nom + ':{'), GLOBAL.indexOf(suivant + ':{'));
  const teinte = (nom, suivant) => {
    const bloc = jeu(nom, suivant);
    return {
      shade: '#' + /shade:\s*0x([0-9A-F]{6})/.exec(bloc)[1],
      dark: '#' + /dark:\s*0x([0-9A-F]{6})/.exec(bloc)[1],
    };
  };
  const vert = teinte('green', 'pink');
  const rose = teinte('pink', 'yellow');
  const jaune = teinte('yellow', 'orange');
  const orange = teinte('orange', 'purple');

  // Le défaut — `frSheet` / `frDef`, dont `color[0]` est le vert.
  assert.match(CSS, new RegExp('--asc-glissiere: ' + vert.shade + ';[\\s\\S]{0,80}--asc-liseret:   ' + vert.dark + ';'));
  // « Salons publics » : `cpRoomList`, `mainStyleName: "frRoomList"` → le rose.
  assert.match(STANDARD, /frRoomList:\{\s*\n\s*color:\[\s*\n\s*_global\.colorSet\.pink,/);
  assert.match(CSS, new RegExp('#salons-panel\\)[\\s\\S]{0,120}--asc-glissiere: ' + rose.shade + ';[\\s\\S]{0,80}--asc-liseret:   ' + rose.dark + ';'));
  // Les Scores : l'arbre comme les colonnes sont en `frScore` → l'orange.
  assert.match(STANDARD, /frScore:\{\s*\n\s*color:\[\s*\n\s*_global\.colorSet\.orange,/);
  assert.match(CSS, new RegExp('#scores-panel\\)[\\s\\S]{0,120}--asc-glissiere: ' + orange.shade + ';[\\s\\S]{0,80}--asc-liseret:   ' + orange.dark + ';'));
  // L'explorateur : `listerFrame` prend `folderType.styleName`, soit
  // `frFileStandard` pour un dossier ordinaire → le jaune.
  assert.match(STANDARD, /frFileStandard:\{\s*\n\s*color:\[\s*\n\s*_global\.colorSet\.yellow,/);
  assert.match(CSS, new RegExp('\\.ex-panel\\)[\\s\\S]{0,180}--asc-glissiere: ' + jaune.shade + ';[\\s\\S]{0,80}--asc-liseret:   ' + jaune.dark + ';'));
  // Le courrier et les dossiers du bureau sont la MÊME fenêtre.
  assert.match(CSS, /\.fen:has\(#mail-panel\),\s*\nbody\.bureau-frutiz \.fen:has\(\.ex-panel\),\s*\nbody\.bureau-frutiz \.fen:has\(\.fb-dossier-panneau\)/);
});

test('scrollbar-color reste sous @supports, sinon Chromium jette le reste', () => {
  // Depuis Chrome 121, poser `scrollbar-color` bascule l'élément sur la barre
  // STANDARD et met les ::-webkit-scrollbar au rebut — la mise en forme
  // d'époque disparaissait sans un mot. C'est le garde-fou que light.html
  // utilisait déjà pour `.fiche-page` et `#trombi-body`.
  const gardes = [...CSS.matchAll(/@supports not selector\(::-webkit-scrollbar\) \{/g)];
  assert.ok(gardes.length >= 1, 'les scrollbar-color doivent vivre sous @supports');
  for (const m of CSS.matchAll(/^(?!\s*\/).*scrollbar-color:/gm)) {
    const avant = CSS.slice(0, m.index);
    const ouvert = (avant.match(/@supports not selector\(::-webkit-scrollbar\) \{/g) || []).length;
    assert.ok(ouvert > 0, 'un scrollbar-color hors @supports : ' + m[0].trim());
  }
});
