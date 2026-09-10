'use strict';
/*
 * LE MODE NUIT — « Son temps viendra »
 *
 * « Si on l'écoutait, Frutiparc serait un site aux couleurs totalement
 *   désaturées, avec des petits fruits zombies et des décors de crypte pour
 *   les différentes sections. […] Mais son temps viendra… »
 *
 * Le thème sombre du light n'est PAS écrit à la main : il est ENGENDRÉ depuis
 * les feuilles de jour (scripts/generer-nuit.js), qui comptent près de mille
 * huit cents couleurs en dur et pas une variable CSS. D'où trois familles de
 * vérifications, et elles ne se remplacent pas l'une l'autre :
 *
 *   1. LA SYNCHRO. Une retouche du thème de jour sans régénération laisserait
 *      la nuit sur une couleur périmée — invisible en développement (on ne
 *      regarde pas le mode nuit à chaque fois), très visible en production.
 *      Le test relance donc le générateur en mode `--verifier`.
 *
 *   2. LA RÈGLE. La conversion n'est pas un miroir : la teinte reste, la
 *      saturation tombe, et la clarté suit une courbe DIFFÉRENTE selon le rôle
 *      de la couleur — fond, bordure, texte, ombre. C'est ce qui évite le
 *      travers du thème sombre bricolé : du texte sombre sur un fond sombre.
 *      On l'éprouve sur les couleurs réelles du parc.
 *
 *   3. L'INVARIANT. Le corollaire de la règle, mesuré sur la feuille produite :
 *      AUCUN fond au-dessus de 40 % de clarté, AUCUN texte en dessous de 55 %.
 *      Tant qu'il tient, un couple texte/fond illisible est impossible — ce
 *      n'est plus une relecture, c'est une garantie.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SERVEUR = lire('server.js');
const LIGHT = lire('public/light.html');
const FORUM = lire('public/fb/index.html');
const BUREAU = lire('public/bureau-frutiz.js');
const NUIT = lire('public/nuit.css');
const NUIT_FORUM = lire('public/fb/nuit.css');
const GEN = require('../scripts/generer-nuit.js');

// ── 1. La feuille engendrée suit le thème de jour ────────────────────────────

test('les feuilles de nuit sont à jour', () => {
  // Le générateur sort 1 et nomme le fichier périmé ; on laisse remonter son
  // message, c'est lui qui dit quoi relancer.
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/generer-nuit.js'), '--verifier'],
    { cwd: ROOT, stdio: 'pipe' });
});

// Le générateur recopie les retouches écrites à la main À LA SUITE de ce qu'il
// produit ; les invariants qui suivent portent sur la partie ENGENDRÉE.
const MARQUE = 'À la main, à partir d\'ici';
const engendre = (css) => css.slice(0, css.indexOf(MARQUE));

test('la feuille de nuit ne fait que surcharger : elle ne garde que des couleurs', () => {
  // Une déclaration sans couleur n'a rien à faire dans une surcharge : elle
  // rejouerait une mise en page déjà posée par le thème de jour, et le jour où
  // les deux divergeraient, la nuit gagnerait à tort. Deux exceptions
  // assumées : le fanage des sprites, et les corps de @keyframes — une règle
  // d'animation se REMPLACE en entier, une copie partielle effacerait ses
  // propriétés non colorées.
  const corps = engendre(NUIT)
    .replace(/@(?:-\w+-)?keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/\s+/g, ' ');
  const fuites = [];
  for (const m of corps.matchAll(/([-a-zA-Z]+)\s*:\s*([^;{}]*?)\s*(?=[;}])/g)) {
    if (!/hsl\(|var\(--nuit-/.test(m[2])) fuites.push(m[1] + ': ' + m[2]);
  }
  assert.deepStrictEqual(fuites, [], 'des déclarations sans couleur ont fui dans la surcharge');
});

// ── 2. La règle de conversion ────────────────────────────────────────────────

const L = (css) => Number(/hsl\([-0-9.]+ [0-9.]+% ([0-9.]+)%/.exec(css)[1]);
const S = (css) => Number(/hsl\([-0-9.]+ ([0-9.]+)%/.exec(css)[1]);
const H = (css) => Number(/hsl\(([-0-9.]+)/.exec(css)[1]);
const rgb = (hex) => GEN.hexVersRgb(hex);
const teint = (hex, role) => GEN.convertir(...rgb(hex), role);

test('un fond clair descend, un fond déjà sombre ne se renverse pas', () => {
  // Le vert du parc, le gris des fenêtres, le blanc des cartes.
  assert.ok(L(teint('#ADE76B', 'fond')) <= 22, 'le vert pomme devient un fond de nuit');
  assert.ok(L(teint('#DDDDDD', 'fond')) <= 14, 'le gris des fenêtres s’assombrit');
  assert.ok(L(teint('#FFFFFF', 'fond')) <= 6, 'le blanc devient presque noir');
  // Et l'inverse ne se produit PAS : un voile noir reste noir.
  assert.ok(L(teint('#000000', 'fond')) <= 2, 'un voile noir reste un voile noir');
  // La hiérarchie du jour survit : ce qui était plus clair reste plus clair.
  assert.ok(L(teint('#FFFFFF', 'fond')) < L(teint('#DDDDDD', 'fond')));
  assert.ok(L(teint('#DDDDDD', 'fond')) < L(teint('#ADE76B', 'fond')));
});

test('un texte monte toujours, quelle que soit sa clarté d’origine', () => {
  // Le vert foncé du corps de texte, et le blanc des boutons : les deux
  // doivent finir CLAIRS — c'est tout l'objet de la conversion par rôle.
  assert.ok(L(teint('#2C4A0F', 'texte')) >= 62, 'le vert foncé du texte s’éclaircit');
  assert.ok(L(teint('#FFFFFF', 'texte')) >= 85, 'le blanc reste clair');
  assert.ok(L(teint('#000000', 'texte')) >= 60, 'le noir devient un gris clair');
  // Et la hiérarchie tient : le blanc reste le plus clair des deux.
  assert.ok(L(teint('#FFFFFF', 'texte')) > L(teint('#2C4A0F', 'texte')));
});

test('la teinte du parc survit, sa saturation non', () => {
  const vert = teint('#ADE76B', 'fond');
  assert.ok(Math.abs(H(vert) - 88) <= 3, 'le vert reste vert (teinte gardée)');
  assert.ok(S(vert) <= 24, '« couleurs totalement désaturées »');
  const jaune = teint('#EAEA0F', 'fond');
  assert.ok(Math.abs(H(jaune) - 60) <= 3, 'le jaune reste jaune');
});

test('toute la famille rose du parc part au graphite', () => {
  // « Passer les boutons roses en noir. » Les huit roses et rouges relevés
  // dans les trois feuilles, plus le saumon du bandeau du forum.
  for (const rose of ['#D16767', '#F28687', '#FFAAAD', '#FFEAEC', '#E7756B',
    '#FEABAB', '#660000', '#7A1F1F', '#842929', '#BB4444', '#E3756A', '#d2645a']) {
    const t = teint(rose, 'fond');
    assert.ok(S(t) <= 6, rose + ' : plus de rose, du graphite (' + t + ')');
  }
  // Les fonds roses deviennent des NOIRS, pas des gris moyens.
  assert.ok(L(teint('#D16767', 'fond')) <= 16, 'un bouton rose devient un bouton noir');
  assert.ok(L(teint('#FFEAEC', 'fond')) <= 8, 'un aplat rose pâle devient presque noir');
  // Mais l'orange, lui, reste un accent : il est HORS de la bande.
  assert.ok(!GEN.estRose(...GEN.rgbVersHsl(255, 102, 0).slice(0, 2)),
    '#FF6600 n’est pas de la famille rose');
  assert.ok(S(teint('#FF6600', 'fond')) > 10, 'l’orange garde sa couleur');
});

test('une ombre sombre reste sombre, une ombre claire cesse d’être un halo', () => {
  assert.ok(L(teint('#000000', 'ombre')) <= 2, 'le noir d’une ombre portée ne bouge pas');
  assert.ok(L(teint('#DDDDDD', 'ombre')) <= 20, 'un liseré clair ne devient pas un halo');
});

test('le rôle se lit dans le nom de la propriété', () => {
  assert.strictEqual(GEN.roleDe('background'), 'fond');
  assert.strictEqual(GEN.roleDe('background-color'), 'fond');
  assert.strictEqual(GEN.roleDe('color'), 'texte');
  assert.strictEqual(GEN.roleDe('border-top'), 'bordure');
  assert.strictEqual(GEN.roleDe('box-shadow'), 'ombre');
  assert.strictEqual(GEN.roleDe('text-shadow'), 'ombre');
  assert.strictEqual(GEN.roleDe('filter'), 'ombre');
  // Une variable CSS n'annonce pas son rôle : on prend la courbe du milieu.
  assert.strictEqual(GEN.roleDe('--fond-txt'), 'bordure');
});

// ── 3. L'invariant, mesuré sur les feuilles produites ────────────────────────

function clartes(css, propriete) {
  const out = [];
  for (const ligne of css.split('\n')) {
    if (!new RegExp('^\\s*' + propriete + '\\s*:').test(ligne)) continue;
    for (const m of ligne.matchAll(/hsl\([-0-9.]+ [0-9.]+% ([0-9.]+)%/g)) out.push(Number(m[1]));
  }
  return out;
}

for (const [nom, css] of [['le light', NUIT], ['le forum', NUIT_FORUM]]) {
  test('aucun fond clair ni texte sombre ne subsiste — ' + nom, () => {
    const fonds = clartes(css, 'background(?:-color)?');
    const textes = clartes(css, 'color');
    assert.ok(fonds.length > 100, 'la feuille teint bien des fonds (' + fonds.length + ')');
    assert.ok(textes.length > 50, 'la feuille teint bien des textes (' + textes.length + ')');
    const fondClair = fonds.filter((l) => l > 40);
    const texteSombre = textes.filter((l) => l < 55);
    assert.deepStrictEqual(fondClair, [], 'des fonds sont restés clairs');
    assert.deepStrictEqual(texteSombre, [], 'des textes sont restés sombres');
  });
}

test('les dessins d’époque fanent au lieu d’être redessinés', () => {
  assert.match(NUIT, /--nuit-fane: saturate\(\.26\) brightness\(\.78\) contrast\(1\.06\);/);
  assert.match(NUIT, /^img, video \{ filter: var\(--nuit-fane\); \}$/m);
  // Les sprites posés en `background-image` ne sont pas des <img> : le
  // générateur leur ajoute le fanage règle par règle.
  const spritees = (NUIT.match(/filter: var\(--nuit-fane\);/g) || []).length;
  assert.ok(spritees > 60, 'les sprites de fond fanent aussi (' + spritees + ' règles)');
  // Et ceux que le JavaScript pose, par sélecteur d'attribut — sauf le bureau,
  // dont le fond d'écran appartient au joueur.
  assert.match(NUIT, /\[style\*="background-image"\]:not\(#bureau\) \{ filter: var\(--nuit-fane\); \}/);
});

test('la bouille garde ses couleurs', () => {
  // Elle est dessinée dans un <canvas> : aucune règle ne doit la teindre, et
  // aucune ne doit fâcheusement l'attraper par ricochet.
  assert.ok(!/canvas[^{]*\{[^}]*filter/.test(NUIT), 'aucun filtre sur un canevas');
  assert.match(NUIT, /LA BOUILLE GARDE SES COULEURS/);
});

// ── L'allumage ───────────────────────────────────────────────────────────────

test('le thème est posé avant le premier rendu, et après les feuilles de jour', () => {
  // L'amorce doit venir APRÈS bureau-frutiz.css : ce qu'elle ajoute en fin de
  // <head> ne gagne la cascade que si les feuilles de jour y sont déjà.
  const apres = LIGHT.indexOf('localStorage.getItem("fp_nuit")');
  const feuille = LIGHT.indexOf('<link rel="stylesheet" href="/bureau-frutiz.css">');
  const corps = LIGHT.indexOf('<body>');
  assert.ok(feuille > 0 && apres > feuille, 'l’amorce vient après la feuille du bureau');
  assert.ok(apres < corps, 'et avant le corps de la page : rien n’est encore peint');
  assert.match(LIGHT, /l\.href = "\/nuit\.css"; l\.id = "nuit-css";/);
  // Le forum a la sienne, sur la même clé et le même domaine.
  assert.match(FORUM, /localStorage\.getItem\("fp_nuit"\)/);
  assert.match(FORUM, /l\.href = "\/fb\/nuit\.css"; l\.id = "nuit-css";/);
});

test('trois positions, par appareil, et le système suivi', () => {
  assert.match(LIGHT, /\{ v: "0",\s+lib: "Jour" \}/);
  assert.match(LIGHT, /\{ v: "1",\s+lib: "Nuit" \}/);
  assert.match(LIGHT, /\{ v: "auto", lib: "Comme mon téléphone" \}/);
  assert.match(LIGHT, /matchMedia\("\(prefers-color-scheme: dark\)"\)\.matches/);
  // Le choix vit dans l'appareil, pas dans le compte.
  assert.match(LIGHT, /localStorage\.setItem\(NUIT_CLE, v\)/);
  // Éteindre, c'est désactiver la feuille — pas la retirer : rebasculer est
  // alors instantané.
  assert.match(LIGHT, /if \(lien\) lien\.disabled = !on;/);
});

test('le serveur a le dernier mot sur la possession', () => {
  assert.match(LIGHT, /fetch\("\/api\/features\?sid=" \+ encodeURIComponent\(state\.sid\)/);
  assert.match(LIGHT, /if \(!state\.nuitPossedee && nuitChoix\(\) !== "0"\) poserNuit\("0"\);/);
  assert.match(LIGHT, /verifierNuit\(\);/);
});

test('le fond du bureau et le forum ouvert suivent la bascule', () => {
  // Le fond d'écran est posé en `style=""` : seule une redemande le change.
  assert.match(BUREAU, /rafraichirFond: function \(\) \{ poserFond\(fondCourant\); \}/);
  assert.match(BUREAU, /var nuit = document\.documentElement\.getAttribute\('data-nuit'\) === '1';/);
  assert.match(BUREAU, /bureau\.style\.background = nuit \? CIEL_DE_NUIT : '#ADE76B';/);
  // AVEC un fond d'écran choisi, l'image du joueur reste : seule la couleur
  // autour s'éteint.
  assert.match(BUREAU, /bureau\.style\.backgroundColor = nuit \? '#141a12' : \(hex\(arr\[0\]\) \|\| '#ADE76B'\);/);
  assert.match(BUREAU, /bureau\.style\.backgroundImage = 'url\("' \+ fond\.url \+ '"\)';/);
  // Le forum est un autre document, même domaine : on lui tend la main plutôt
  // que de le recharger (le joueur y a peut-être un message en cours).
  assert.match(LIGHT, /var cadre = document\.getElementById\("forum-frame"\);/);
  assert.match(LIGHT, /l2\.href = "\/fb\/nuit\.css"; l2\.id = "nuit-css";/);
});

// ── L'article ────────────────────────────────────────────────────────────────

test('l’option existe, avec son numéro d’article et son prix', () => {
  assert.match(SERVEUR, /modeNuit: \{\s*\n\s*shopId: 42,\s*\n\s*price: 300,\s*\n\s*name: 'Son temps viendra',\s*\n\s*label: 'mode nuit',/);
  // Le message d'achat des autres options promet un affichage « dès que tu
  // lances une partie » : faux pour un thème, qui a un interrupteur.
  assert.match(SERVEUR, /annonce: 'Son temps viendra ! Le mode nuit s’allume dans Réglages/);
  assert.match(SERVEUR, /content: \(opt && opt\.annonce\)\s*\n\s*\|\| `\$\{pack\.name\} acheté !/);
  // 300 kikooz : le prix des trois autres options permanentes du parc.
  for (const bloc of ['snake3Hud', 'swapouMoves']) {
    const i = SERVEUR.indexOf(bloc + ': {');
    assert.match(SERVEUR.slice(i, i + 200), /price: 300,/, bloc + ' est au même prix');
  }
});

test('l’article est en rayon dans « Décors », et il n’est pas offert', () => {
  const bloc = SERVEUR.slice(SERVEUR.indexOf('const SHOP_DECOR_PACKS_DEFAULT = ['),
    SERVEUR.indexOf('// ── Feutres spéciaux'));
  assert.match(bloc, /id: GAME_FEATURES\.modeNuit\.shopId,/);
  assert.match(bloc, /category: 'Décors',/);
  assert.match(bloc, /gameFeature: 'modeNuit',/);
  // SANS `notDefault`, « Décors » serait tenue pour une rubrique offerte :
  // l'article appartiendrait à tout le monde et l'achat serait refusé.
  assert.match(bloc, /notDefault: true,/);
  assert.match(bloc, /picto: 'img,\/fb\/boutique\/nuit\.svg',/);
  assert.match(SERVEUR, /\.\.\.SHOP_DECOR_PACKS_DEFAULT,/);
  assert.ok(fs.existsSync(path.join(ROOT, 'public/fb/boutique/nuit.svg')), 'la vignette existe');
});

test('une vignette « img,… » arrive jusqu’au client', () => {
  assert.match(SERVEUR, /const img = \/\^img,\(\\\/\[\\w\.\/-\]\+\)\$\/\.exec\(p\);/);
  assert.match(SERVEUR, /return img \? img\[1\] : null;/);
});

// ── Le forum ─────────────────────────────────────────────────────────────────

test('le forum n’écrit plus ses couleurs dans des attributs `style`', () => {
  // Un attribut de style l'emporte sur toute feuille : les onze couleurs qui
  // y vivaient restaient en plein jour quand le forum s'éteignait.
  const enDur = FORUM.match(/style="[^"]*(?:#[0-9a-fA-F]{3,8}|rgba?\()[^"]*"/g) || [];
  assert.deepStrictEqual(enDur, [], 'une couleur est revenue dans un attribut style');
  // Elles sont remontées dans la feuille, à l'identique.
  for (const regle of ['#back-chat-link, #pictos-link { color: #2C4A0F; }',
    '.fb-note-grise { font-size: 10px; color: #888; }',
    '.editor-input-fige { background: #E8F5D4; }']) {
    assert.ok(FORUM.includes(regle), 'la règle « ' + regle + ' » manque');
  }
  assert.match(FORUM, /m\.className = 'sig-modal';/);
  assert.match(FORUM, /'<div class="sig-boite">'/);
});

test('le forum s’éteint : bandeau au graphite, ciel derrière', () => {
  // Le saumon du bandeau (#E3756A) devient un noir.
  const entete = NUIT_FORUM.slice(NUIT_FORUM.indexOf('.forum-header {'));
  const fond = /background[^;]*hsl\([-0-9.]+ ([0-9.]+)% ([0-9.]+)%/.exec(entete);
  assert.ok(fond, 'le bandeau du forum est teint');
  assert.ok(Number(fond[1]) <= 6, 'plus de saumon : du graphite');
  assert.ok(Number(fond[2]) <= 22, 'et c’est un fond de nuit');
  assert.match(NUIT_FORUM, /background: var\(--nuit-ciel\) fixed;/);
});
