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
 * (#242169 garçon, #BB4444 fille), âge #404040, onglet courant #842929, tout
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

test('elle se pose DANS LE COIN et se glisse par son cadre', () => {
  // `win.Frutiz` (sprite#819) ne se donne pas de `pos` et n'appelle pas
  // `moveToCenter` : c'est `recal` qui la place, donc (cornerX, cornerY).
  // L'escalier qu'on avait ici était une invention.
  assert.match(JS, /function poserFiche\(\) \{[\s\S]*?f\.style\.setProperty\('--fx', CORNER_X \+ 'px'\);/);
  assert.match(JS, /f\.style\.setProperty\('--fy', CORNER_Y \+ 'px'\);/);
  assert.doesNotMatch(JS, /ficheRang/);
  // `initDrag` : on l'attrape par le cadre, pas par un bouton ni la feuille.
  assert.match(JS, /if \(ev\.target\.closest\('button, a, input, \.fiche-corps'\)\) return;/);
  assert.match(BLOC, /#fiche \{\s*\n\s*position: absolute; left: var\(--fx, 220px\); top: var\(--fy, 120px\);/);
  // Le light prévient le bureau à l'ouverture.
  assert.match(LIGHT, /if \(window\.BureauFrutiz && BureauFrutiz\.poserFiche\) BureauFrutiz\.poserFiche\(\);/);
});

test('le gabarit : 324 de large, un HAUT blanc de base = 42, une feuille verte', () => {
  assert.match(BLOC, /#fiche \{[\s\S]*?width: 324px;/);
  assert.match(BLOC, /#fiche \{[\s\S]*?background: #FFFFFF;/);
  // LE GABARIT DE LA PLAQUE EST CELUI DU MOBILE — décision assumée, pas un
  // oubli. Le relevé d'époque (`frutiScreen`, `fix { w: base + 36, h: base }`
  // = 76 × 42) tient la bouille dans 35 × 31 et le « NIV n » dans huit pixels
  // d'encre : fidèle et illisible. La vignette de 60 reste donc, et le cadre
  // qui l'entoure aussi.
  assert.doesNotMatch(BLOC, /^\s*\.fiche-plaque \{/m);
  assert.doesNotMatch(BLOC, /\.fiche-plaque \.fa-frame \{/);
  assert.doesNotMatch(BLOC, /\.fiche-plaque \.reflet-niv \{/);
  assert.doesNotMatch(BLOC, /\.fiche-plaque \.cadre/);
  // CE QUI NE RESTE PAS, ce sont les FINITIONS du gabarit tactile. Trois
  // d'entre elles ont un équivalent d'époque, et il est déjà dans cette
  // feuille — c'est celui de la main bar, qui pose le MÊME `barLevel` (#431)
  // et les MÊMES neuf barres :
  //   · le remplissage de 3 px (`frutiScreen` cerne ses panneaux à même le
  //     liseré) et la gouttière de 5 (d'époque : UN pixel, x 42 → x 43) ;
  //   · les filets de 1,5 px, qui sont des barres de 2 séparées de 1 ;
  //   · l'afficheur à sept segments, qui est un glyphe plein de la Verdana
  //     pixel du SWF, centré dans une colonne fixe (le champ #430 déclare
  //     `align centre`).
  assert.match(BLOC, /body\.bureau-frutiz #fiche \.fiche-plaque \{ padding: 0; \}/);
  assert.match(BLOC, /#fiche \.fiche-plaque \{\s*\n\s*gap: 1px; border-color: #888888;\s*\n\s*\}/);
  assert.match(BLOC, /#fiche \.fiche-plaque \.fa-progress \{ width: 27px; gap: 1px; \}/);
  assert.match(BLOC, /#fiche \.fiche-plaque \.fa-progress i \{ height: 2px; background: #A2EB56; \}/);
  assert.match(BLOC, /#fiche \.fiche-plaque \.fa-niv img \{ height: 17\.4px; width: 14\.2px; \}/);
  assert.match(BLOC, /#fiche \.fiche-plaque \.fa-niv b \{[\s\S]*?font-family: 'ImpactSwf'/);
  assert.match(BLOC, /#fiche \.fiche-plaque \.fa-niv b \{[\s\S]*?flex: 0 0 12\.7px; text-align: center;/);
  // Et ce sont EXACTEMENT les valeurs de la main bar : les deux blocs ne
  // peuvent plus diverger sans qu'on s'en aperçoive.
  assert.match(CSS, /#bureau-coin \.enc-progress i \{ height: 2px; background: #A2EB56; \}/);
  assert.match(CSS, /#bureau-coin \.enc-niv \.niv-img \{ height: 17\.4px; width: 14\.2px; \}/);
  // Et le haut s'aligne comme sur le mobile : les deux blocs par le HAUT, neuf
  // pixels entre la plaque et la colonne de droite.
  assert.match(BLOC, /\.fiche-haut \{\s*\n\s*align-items: flex-start; gap: 9px;/);
  // Le gabarit mobile, lui, reste celui de light.html : vignette de 60 dans son
  // cadre, neuf barres de 30, le chiffre en afficheur à segments.
  assert.match(LIGHT, /\.fiche-plaque \.fa-frame \{\s*\n\s*position: relative; width: 60px; height: 60px;/);
  assert.match(LIGHT, /\.fiche-plaque \.fa-progress \{ display: flex; flex-direction: column; gap: 1\.5px; width: 30px; \}/);
  assert.match(LIGHT, /\.fiche-plaque \.fa-niv b \{\s*\n\s*font-family: 'DSEG7'/);
  // Le bouton du dépli porte son VRAI dessin — la plaque #359 et le triangle
  // #369, qui ne fait que huit de côté et reste centré.
  assert.match(BLOC, /#fiche-avance \{[\s\S]*?fiche-rose\.svg'\) center \/ 20px 20px/);
  assert.match(BLOC, /#fiche-avance img \{[\s\S]*?fiche-rose-tri\.svg'\);\s*\n\s*width: 9px; height: 9px;/);
  // La croix est au coin HAUT-DROIT de la fenêtre, pas au bout d'une ligne.
  assert.match(BLOC, /#fiche-fermer \{\s*\n\s*position: absolute; right: 5px; top: 5px;/);
  // Le bouton du dépli est CARRÉ : 20 d'art, comme les blancs (x 293..316).
  assert.match(BLOC, /\.fiche-actions button \{\s*\n\s*width: 20px; height: 20px; min-width: 0; min-height: 0;/);
  assert.match(BLOC, /\.fiche-actions button img \{\s*\n\s*width: 20px; height: 20px;[^}]*object-fit: contain;/);
  // `explorer` : un `cpDocument` au style frSheet — le vert du bureau.
  assert.match(BLOC, /\.fiche-corps \{[\s\S]*?#CCF599;[\s\S]*?inset 0 2px 0 #ADE76B/);
  // `getPageObj` la borne à 240 de haut.
  assert.match(BLOC, /\.fiche-page \{\s*\n\s*height: 240px;/);
});

test('la rangée d’icônes suit box.Frutiz.getIconList', () => {
  const EX = fs.readFileSync(path.join(ROOT, 'scripts/extract-frutiz-bureau.js'), 'utf8');
  // Les glyphes sont les IMAGES de la bande `icon` (#500) de
  // butPushSmallWhite — des bitmaps de 20 × 20, sortis du SWF.
  const pieces = [
    ['fiche-ico-chat', 475], ['fiche-ico-mail', 477], ['fiche-ico-contact', 479],
    ['fiche-ico-noire', 481], ['fiche-ico-kick', 483], ['fiche-ico-ban', 485],
    ['fiche-ico-mute', 487], ['fiche-ico-editer', 491], ['fiche-ico-denoire', 495],
    ['fiche-ico-blog', 497], ['fiche-rose', 359], ['fiche-rose-tri', 369],
  ];
  for (const [cle, id] of pieces) {
    assert.match(EX, new RegExp("\\{ cle: '" + cle + "', id: " + id + " \\}"), cle + ' manque à l’extracteur');
    assert.ok(fs.existsSync(path.join(ROOT, 'public/frutiz/sprites', cle + '.svg')), cle + '.svg manque');
  }
  // L'ORDRE d'époque : chat, courrier, blog, carnet, liste noire, puis la
  // modération. Le mobile n'avait que les deux premiers.
  assert.match(JS, /\{ id: 'fiche-mp', +art: 'fiche-ico-chat' \}/);
  assert.match(JS, /\{ id: 'fiche-blog', +art: 'fiche-ico-blog'/);
  assert.match(JS, /\{ id: 'fiche-contact', +art: 'fiche-ico-contact'/);
  assert.match(JS, /\{ id: 'fiche-noire', +art: 'fiche-ico-noire'/);
  // Les trois manquants sont montés à leur place, après le courrier.
  assert.match(JS, /if \(apres && apres\.parentNode === rangee\) rangee\.insertBefore\(b, apres\.nextSibling\);/);
  assert.match(JS, /var apres = \$\('#fiche-mail'\);/);
});

test('les rangées : dix-neuf et demi de pas, et un filet qui les ferme', () => {
  // L'encre des libellés tombe en 187, 208, 227, 244 et 265 — (265-187)/4.
  assert.match(BLOC, /\.fiche-ligne \{\s*\n\s*font-size: 11px; padding: 0; height: 19\.5px;/);
  // Le bloc s'ouvre sur un filet (#ADE76B en 180-181) et se FERME sur un
  // autre (277-278) — c'est celui-là qui manquait.
  assert.match(BLOC, /\.fiche-lignes \{\s*\n\s*padding-bottom: 6px; border-bottom: 2px solid #ADE76B;/);
  assert.match(BLOC, /\.fiche-signes,\s*\nbody\.bureau-frutiz #fiche \.fiche-medailles \{ border-bottom: 2px solid #ADE76B; \}/);
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
  assert.match(BLOC, /#fiche-pseudo \{\s*\n\s*font: 700 11px Verdana[^;]*; color: #242169;/);
  assert.match(BLOC, /\.fiche-nom-ligne \.meta \{[\s\S]*?color: #404040;/);
  assert.match(BLOC, /\.fiche-ligne \.lib,\s*\nbody\.bureau-frutiz #fiche \.fiche-ligne \.val \{ color: #335511; \}/);
  // `UserSlot.onInfoBasic` (0x63a51) : le pseudo prend la couleur du GENRE, et
  // la règle vaut pour LES DEUX mises en page — elle vit donc dans light.html,
  // avec les valeurs exactes du bytecode (celle qui était ici disait #BB4A44,
  // un chiffre de travers). Le bureau n'a plus rien à guetter : `renderFiche`
  // pose l'attribut au moment où il écrit le pseudo.
  assert.match(LIGHT, /#fiche-pseudo\[data-genre="M"\] \{ color: #242169; \}/);
  assert.match(LIGHT, /#fiche-pseudo\[data-genre="F"\] \{ color: #BB4444; \}/);
  assert.match(LIGHT, /var fg = \(d && d\.basic && d\.basic\.sexe === "F"\) \? "F" : \(d && d\.basic \? "M" : ""\);/);
  assert.doesNotMatch(BLOC, /#fiche\.elle/);
  assert.doesNotMatch(JS, /function majGenreFiche|majGenreFiche\(f\);/);
});

test('la bouille de la fiche est dessinée en JS, pas jouée par Ruffle', () => {
  // `FPBouilleVignette` rend la bouille dans un canvas ; le chemin Flash
  // (ruffle.html dans une iframe) n'a plus rien à faire ici. Un seul moteur
  // pour toutes les bouilles du site : accueil, salons, fiche.
  assert.match(LIGHT, /function previewIframe\(state\) \{\s*\n\s*return FPBouilleVignette\.html\(state \|\| DEFAULT_BOUILLE\);/);
  assert.match(LIGHT, /\$\("#fiche-avatar"\)\.innerHTML = \(d && d\.bouille\) \? previewIframe\(d\.bouille\) : "";\s*\n\s*brancherApercus\(\$\("#fiche-avatar"\)\);/);
  assert.doesNotMatch(LIGHT, /rendue par Ruffle comme partout ailleurs/);
});

test('rien de tout cela ne touche le mobile', () => {
  const mauvaises = [...BLOC.matchAll(/^([.#a-zA-Z][^{\n]*)\{/gm)]
    .map((m) => m[1].trim())
    .filter((s) => !/^body\.bureau-frutiz/.test(s) && !/^@/.test(s));
  assert.deepStrictEqual(mauvaises, [], 'des règles échappent au cloisonnement mobile');
});
