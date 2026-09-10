'use strict';
/*
 * LE MODE NUIT — « Son temps viendra »
 *
 * « Si on l'écoutait, Frutiparc serait un site aux couleurs totalement
 *   désaturées, avec des petits fruits zombies et des décors de crypte pour
 *   les différentes sections. […] Mais son temps viendra… »
 *
 * Le thème sombre du light n'est PAS écrit à la main : il est ENGENDRÉ depuis
 * le thème de jour, qui compte près de mille huit cents couleurs en dur et pas
 * une variable CSS. Deux outils y pourvoient — `generer-nuit.js` pour les
 * feuilles, `nuit-svg.js` pour les dessins de châssis —, et quatre familles de
 * vérifications, qui ne se remplacent pas l'une l'autre :
 *
 *   1. LA SYNCHRO. Une retouche du thème de jour sans régénération laisserait
 *      la nuit sur une couleur périmée — invisible en développement (on ne
 *      regarde pas le mode nuit à chaque fois), très visible en production.
 *      Les deux outils sont donc relancés en mode `--verifier`.
 *
 *   2. LA RÈGLE. La conversion rejoue la teinte PAR FAMILLE (châssis au
 *      violet, rose gardé en accent, le reste intact) et renverse la clarté
 *      selon le RÔLE de la couleur — fond, bordure, texte, ombre, dessin.
 *      C'est ce qui évite le travers du thème sombre bricolé : du texte sombre
 *      sur un fond sombre. On l'éprouve sur les couleurs réelles du parc.
 *
 *   3. L'INVARIANT, mesuré sur les feuilles produites : aucun fond au-dessus
 *      de LUM_FOND_MAX de luminance, aucun texte en dessous de LUM_TEXTE_MIN,
 *      les deux choisies pour que le PIRE couple possible tienne 4,5:1. Tant
 *      qu'il tient, un texte illisible n'est pas improbable : il est
 *      impossible.
 *
 *   4. LA FRONTIÈRE entre châssis et dessin. Le mode nuit éteint le premier et
 *      garde le second en couleur ; le manifeste de `nuit-svg.js` est l'endroit
 *      où l'on peut se tromper, donc l'endroit qu'on garde.
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
const ADMIN = lire('public/admin.html');
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

test('les dessins de châssis de nuit suivent ceux du jour', () => {
  // Ils sont ENGENDRÉS depuis les dessins de jour, par la conversion du thème :
  // retoucher un dessin de jour sans relancer laisserait la nuit sur une
  // version périmée. Et si quelqu'un en reprend un à la main, le test le dira
  // — il suffira alors de retirer son entrée du manifeste.
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/nuit-svg.js'), '--verifier'],
    { cwd: ROOT, stdio: 'pipe' });
});

test('la roue du frutimandala : quartiers violets, fruits intacts', () => {
  // Le cas limite du manifeste, et celui qui justifie sa portée réduite : les
  // fruits sont PEINTS SUR les quartiers. Seuls les deux tracés du premier
  // groupe changent ; tout ce qui suit est laissé au pixel près.
  const SVG = require('../scripts/nuit-svg.js');
  const entree = SVG.MANIFESTE.find((e) => e.f === 'frutimandala-roue.svg');
  const jour = fs.readFileSync(path.join(SVG.SPRITES, entree.f), 'utf8');
  const nuit = fs.readFileSync(SVG.cible(entree), 'utf8');
  // Les quartiers ont viré, et pas sur la même valeur — le frutimandala est
  // une horloge, ses quartiers alternent pour se compter.
  const violets = [...nuit.matchAll(/fill="hsl\(256 30% ([\d.]+)%\)"/g)].map((m) => m[1]);
  assert.strictEqual(violets.length, 2, 'les deux quartiers, et eux seuls');
  assert.notStrictEqual(violets[0], violets[1], 'ils gardent leur écart');
  for (const vert of ['#ade76b', '#8ad524']) {
    assert.ok(jour.includes(vert), vert + ' est bien un quartier de jour');
    assert.ok(!nuit.includes(vert), 'et il a disparu de la nuit');
  }
  // Les fruits, eux, n'ont pas bougé — un par famille de couleur.
  for (const couleur of ['#dd1c1c', '#ffa004', '#ffcc00', '#b39fd5', '#ffffff']) {
    assert.strictEqual(nuit.split(couleur).length, jour.split(couleur).length,
      couleur + ' (un fruit) n’a pas bougé');
  }
});

test('le manifeste ne contient que du châssis', () => {
  // La garde-fou du chantier : le jour où quelqu'un y ajoute un fruit ou un
  // picto par mégarde, le mode nuit se mettrait à éteindre des dessins — tout
  // le contraire de ce qu'il fait.
  const SVG = require('../scripts/nuit-svg.js');
  const INTERDITS = /^(fruit_|ico_|emote_|feutre-|disc_|sl-presence|medal_|signe_)/;
  for (const e of SVG.MANIFESTE) {
    assert.ok(!INTERDITS.test(e.f), e.f + ' est un dessin, pas du châssis');
  }
  // Et chaque entrée désigne un fichier qui existe vraiment — les dessins ne
  // sont pas tous rangés au même endroit (le châssis du bureau dans
  // frutiz/sprites, les pièces de la main bar dans fb/).
  for (const e of SVG.MANIFESTE) {
    assert.ok(fs.existsSync(path.join(e.dossier || SVG.SPRITES, e.f)), e.f + ' existe');
    assert.ok(fs.existsSync(SVG.cible(e)), e.f + ' a sa variante de nuit');
  }
});

// Le générateur recopie les retouches écrites à la main À LA SUITE de ce qu'il
// produit ; les invariants qui suivent portent sur la partie ENGENDRÉE.
const MARQUE = 'À la main, à partir d\'ici';
// La CONVERSION s'arrête au premier des deux marqueurs : après viennent les
// variantes de nuit déposées à côté des dessins de jour, puis les retouches
// écrites à la main. Ni les unes ni les autres ne sortent de la conversion.
const VARIANTES = 'Les dessins de nuit déposés à côté des dessins de jour';
const engendre = (css) => css.slice(0, Math.min(
  ...[VARIANTES, MARQUE].map((m) => (css.includes(m) ? css.indexOf(m) : css.length))));

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
    // Trois raisons d'être là, et pas une de plus : une couleur convertie, le
    // filtre du châssis, ou l'URL d'un dessin de nuit.
    if (!/hsl\(|var\(--nuit-|-nuit\.[a-z]/.test(m[2])) fuites.push(m[1] + ': ' + m[2]);
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
  assert.ok(L(teint('#ADE76B', 'fond')) <= 38, 'le vert pomme devient un fond de nuit');
  assert.ok(L(teint('#DDDDDD', 'fond')) <= 26, 'le gris des fenêtres s’assombrit');
  assert.ok(L(teint('#FFFFFF', 'fond')) <= 18, 'le blanc devient un violet profond');
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

test('le châssis du parc part au violet', () => {
  // Le vert et les gris — les aplats, les fenêtres, le corps du texte —
  // abandonnent leur teinte : c'est ce qui fait la nuit violette plutôt qu'un
  // parc vert éteint. C'est le SEUL endroit où la conversion change la teinte
  // sans y être forcée par un rôle.
  for (const chassis of ['#ADE76B', '#CCF599', '#335511', '#2C4A0F', '#94DB39',
    '#DDDDDD', '#888888', '#FFFFFF', '#D6F7B5', '#446531']) {
    for (const role of ['fond', 'bordure', 'texte']) {
      assert.strictEqual(H(teint(chassis, role)), GEN.VIOLET,
        chassis + ' (' + role + ') : le châssis est violet');
    }
  }
  // Et il est SATURÉ : un violet lavé donnerait un thème gris à reflets.
  assert.ok(S(teint('#ADE76B', 'fond')) >= 25, 'le fond est un violet franc');
  // Le texte, lui, reste presque blanc : un texte lilas fatiguerait.
  assert.ok(S(teint('#2C4A0F', 'texte')) <= 16, 'le texte n’est pas lilas');
});

test('le rose reste rose — c’est l’accent, pas une couleur à éteindre', () => {
  // Les roses et rouges relevés dans les trois feuilles, plus le saumon du
  // bandeau du forum. Aucun ne s'éteint : ils changent de FONCTION.
  const FAMILLE = ['#D16767', '#F28687', '#FFAAAD', '#FFEAEC', '#E7756B',
    '#FEABAB', '#660000', '#7A1F1F', '#842929', '#BB4444', '#E3756A', '#d2645a'];
  for (const rose of FAMILLE) {
    for (const role of ['fond', 'texte', 'bordure']) {
      const t = teint(rose, role);
      assert.strictEqual(H(t), GEN.ROSE_NUIT, rose + ' (' + role + ') reste rose');
      assert.ok(S(t) >= 30, rose + ' (' + role + ') garde de la couleur : ' + t);
    }
    // En TEXTE, en GLYPHE, en LISERÉ : vif. C'est le rose des pseudos et des
    // quatre boutons du salon.
    assert.ok(L(teint(rose, 'texte')) >= 66, rose + ' en texte est un accent vif');
    // En APLAT : une prune profonde, sur laquelle du texte clair se lit.
    const fond = L(teint(rose, 'fond'));
    assert.ok(fond >= 22 && fond <= 38, rose + ' en fond est une prune (' + fond + ' %)');
  }
  // EN DESSIN, le rose ne s'éteint pas : les quatre boutons du salon, la
  // gélule de la liste sont des COMMANDES, et le rose est ce qui les désigne.
  // C'est l'écart le plus visible avec les captures d'époque quand on
  // l'oublie. Un dessin garde donc sa clarté — le remplissage reste clair, et
  // le trait qui le cerne reste sombre : c'est ce qui fait un bouton et non
  // une pastille.
  for (const remplissage of ['#F28687', '#FFAAAD', '#FFC4C4', '#FFDFDF']) {
    const d = L(teint(remplissage, 'sprite'));
    assert.ok(d >= 50, remplissage + ' remplit une commande (' + d + ' %)');
  }
  assert.ok(L(teint('#660000', 'sprite')) <= 25, 'le rouge sombre reste un trait');
  assert.ok(L(teint('#FFDFDF', 'sprite')) > L(teint('#F28687', 'sprite')),
    'et la hiérarchie du dessin survit');
  // LE PARCHEMIN — l'autre décor du parc de jour. La fenêtre des Scores est
  // un parchemin, la Messagerie un bloc-notes jaune, « Mes disques » et
  // l'inventaire des panneaux crème. Ce n'est pas un accent, c'est un décor :
  // en CSS il suit le châssis, sinon ces fenêtres-là sortaient OLIVE au milieu
  // d'un parc violet.
  for (const hex of ['#FF6600', '#EAEA0F', '#FACE68', '#F8F866', '#FBD888']) {
    for (const role of ['fond', 'texte', 'bordure']) {
      const t = teint(hex, role);
      assert.strictEqual(H(t), GEN.VIOLET, hex + ' (' + role + ') rejoint le châssis : ' + t);
    }
  }
  // MAIS DANS UN DESSIN, un orange est une orange. La petite orange de
  // l'onglet, le fruit du Frusion, le jaune du bouton « swap » : c'est la
  // seule différence entre un aplat de fenêtre et une illustration.
  for (const [hex, teinte] of [['#FF6600', 24], ['#EAEA0F', 60], ['#FACE68', 44]]) {
    const t = teint(hex, 'sprite');
    assert.ok(Math.abs(H(t) - teinte) <= 3, hex + ' garde sa teinte en dessin (' + t + ')');
    assert.ok(S(t) >= 30, hex + ' reste un accent vivant');
  }
  assert.ok(!GEN.estRose(...GEN.rgbVersHsl(255, 102, 0).slice(0, 2)),
    '#FF6600 n’est pas de la famille rose');
  assert.ok(!GEN.estChassis(...GEN.rgbVersHsl(255, 102, 0).slice(0, 2)),
    '#FF6600 n’est pas du VERT non plus — c’est le parchemin qui le prend');
  assert.ok(GEN.estParchemin(...GEN.rgbVersHsl(255, 102, 0).slice(0, 2)));
});

test('les deux décors du parc ressortent au même étage', () => {
  // Le vert et le parchemin ne sont pas à la même clarté le jour — 78 % de
  // médiane contre 69 —, et la courbe RENVERSE la clarté : sans correction le
  // parchemin ressortait plus CLAIR que le vert. Mesuré à l'écran avant
  // correction : corps de fenêtre à 20 %, grille de l'inventaire à 33 %, dans
  // la même fenêtre. Les deux aplats de panneau du thème doivent donc tomber
  // à quelques points l'un de l'autre.
  const vert = L(teint('#CCF599', 'fond'));       // le corps d'un panneau vert
  const parchemin = L(teint('#F8F866', 'fond'));  // celui d'un panneau crème
  assert.ok(Math.abs(vert - parchemin) <= 4,
    'vert à ' + vert + ' %, parchemin à ' + parchemin + ' % : ils doivent s’accorder');
  // Et l'arc-en-ciel du feutre multicolore, que nulle règle de couleur ne peut
  // sauver, est reposé entier à la main.
  const retouches = lire('scripts/nuit-retouches.css');
  assert.match(retouches, /linear-gradient\(90deg, #FF6600, #EBB601, #20D251, #47B9C9, #6666CC, #6E3C8D, #F986E2\)/);
  assert.match(NUIT, /\.pen-swatch\.mc,\s*\n\.mc-text \{/);
});

test('une ombre reste une ombre, un liseré redevient un liseré', () => {
  assert.ok(L(teint('#000000', 'ombre')) <= 2, 'le noir d’une ombre portée ne bouge pas');
  assert.ok(L(teint('#DDDDDD', 'ombre')) <= 26, 'une ombre claire ne devient pas un halo');
  /*
   * LE RÉTROÉCLAIRAGE. Le thème de jour cerne ses panneaux de
   * `box-shadow: 0 0 0 2px #DDDDDD` — pas une ombre portée, un TRAIT. Traité
   * comme une ombre il disparaissait, et les cadres perdaient le halo pâle qui
   * les détache du fond sur les captures d'époque. Une couche sans flou suit
   * donc la courbe des bordures, et se retrouve PLUS CLAIRE que le panneau
   * qu'elle entoure — c'est à ça qu'on la reconnaît.
   */
  const anneau = GEN.teindreValeur('0 0 0 2px #DDDDDD', 'bordure');
  assert.ok(L(anneau) > L(teint('#CCF599', 'fond')) + 4,
    'le liseré se détache du panneau qu’il entoure');
  // Et dans la feuille produite, pas seulement en théorie.
  assert.match(NUIT, /box-shadow: 0 0 0 1px hsl\(256 26% 3[0-9](\.\d)?%\)/);
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

// L'invariant qui compte vraiment n'est pas en clarté mais en LUMINANCE : un
// jaune et un violet de même clarté ne se voient pas du tout pareil, et c'est
// le jaune qui rendait le texte illisible. On relit donc chaque fond de la
// feuille produite, et l'on vérifie que le texte le plus sombre du thème y
// tient les 4,5:1 — sur la feuille, pas sur la théorie.
function couleursDe(css, propriete) {
  const out = [];
  for (const ligne of css.split('\n')) {
    if (!new RegExp('^\\s*' + propriete + '\\s*:').test(ligne)) continue;
    for (const m of ligne.matchAll(/hsl\(([-0-9.]+) ([0-9.]+)% ([0-9.]+)%(?: \/ ([0-9.]+))?\)/g)) {
      // Un fond translucide se pose sur autre chose : ce n'est pas lui qui
      // décide de la lisibilité.
      if (m[4] !== undefined && Number(m[4]) < 0.9) continue;
      out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    }
  }
  return out;
}

for (const [nom, css] of [['le light', NUIT], ['le forum', NUIT_FORUM]]) {
  test('tout fond porte le texte le plus sombre du thème à 4,5:1 — ' + nom, () => {
    const lum = (h, s, l) => {
      const rgb = [0, 8, 4].map((k) => {
        const hh = ((h % 360) + 360) % 360 / 360, ss = s / 100, ll = l / 100;
        if (!ss) return ll;
        const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss, p = 2 * ll - q;
        let x = hh + (k === 0 ? 1 / 3 : k === 8 ? 0 : -1 / 3);
        if (x < 0) x += 1; if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
      });
      const c = rgb.map((v) => (v <= 0.03928 / 1 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const textes = couleursDe(css, 'color');
    const pireTexte = textes.reduce((min, c) => Math.min(min, lum(...c)), 1);
    const mauvais = couleursDe(css, 'background(?:-color)?')
      .map((c) => [c, (pireTexte + 0.05) / (lum(...c) + 0.05)])
      .filter(([, r]) => r < 4.5)
      .map(([c, r]) => `hsl(${c.join(' ')}) → ${r.toFixed(2)}:1`);
    assert.deepStrictEqual([...new Set(mauvais)], [],
      'des fonds ne portent pas le texte le plus sombre du thème');
  });
}

test('seul le châssis s’éteint : les dessins gardent leurs couleurs', () => {
  // C'EST LA DÉCISION QUI FAIT LE THÈME. Les fruits du bureau, les bouilles
  // des émotions, les pictos : ce sont eux qui font le parc, et une nuit où
  // ils seraient éteints serait une nuit sans parc. Un mode sombre, pas un
  // mode terne. Rien ne doit donc les toucher en masse.
  assert.ok(!/^img[ ,{]/m.test(engendre(NUIT) + NUIT.slice(NUIT.indexOf(MARQUE))
    .replace(/img\[src\$=/g, 'X[src$=')),
    'aucune règle ne teint les <img> en bloc');
  assert.ok(!/\[style\*="background-image"\][^{]*\{[^}]*filter/.test(NUIT),
    'ni les fonds que le JavaScript pose');
  // Seul le CHÂSSIS s'assombrit : les cadres, les onglets, l'écran de la main
  // bar, le boîtier du Frusion — des surfaces, pas des illustrations.
  assert.match(NUIT, /--nuit-chassis: grayscale\([^)]*\) sepia\([^)]*\) hue-rotate\(202deg\)/);
  const chassis = (NUIT.match(/filter: var\(--nuit-chassis\);/g) || []).length;
  assert.ok(chassis > 25, 'le générateur teint les sprites de châssis (' + chassis + ' règles)');
  // Ce nombre est un RESTE À FAIRE, et il doit baisser. Le filtre est un
  // pis-aller : il ternit tout de la même main. Chaque dessin qui reçoit sa
  // variante lui échappe — d'où ces trois-là, qui l'ont quittée et ne doivent
  // pas y retomber.
  for (const [quoi, regle] of [
    ['le boîtier du Frusion', /#frusion-boite \.fr-avant \{\s*\n\s*background-image: url\('\/frutiz\/sprites\/frusion-avant-nuit\.svg'\);\s*\n\s*\}/],
    ['le « valider » du frutimandala', /#frutimandala \.md-mandalaValider \{\s*\n\s*background-image: url\('\/frutiz\/sprites\/mandalaValider_up-nuit\.svg'\);\s*\n\s*\}/],
    ['le corps des onglets', /url\("\/frutiz\/sprites\/onglet_corps-nuit\.svg"\)/],
  ]) {
    assert.match(NUIT, regle, quoi + ' a sa variante, il n’est plus fané');
  }
  assert.ok(!/#frusion-boite [^{]*\{\s*\n\s*filter: var\(--nuit-chassis\)/.test(NUIT),
    'plus une seule pièce du Frusion ne passe par le filtre');
  assert.ok(!/#frutimandala \.md-mandala[^{]*\{\s*\n\s*filter: var\(--nuit-chassis\)/.test(NUIT),
    'ni une seule commande du frutimandala');
  // Et la poignée de pièces de châssis qui arrivent par un <img> du HTML.
  assert.match(NUIT, /img\[src\$="\/fb\/cadre_bouille\.svg"\]/);
  // LA ROUE DU FRUTIMANDALA porte ses fruits sur des quartiers verts : aucun
  // filtre ne sait éteindre le quartier sans le fruit. Elle a donc une vraie
  // VARIANTE DE NUIT, et c'est elle qui sert ; la règle CSS n'est qu'un filet.
  assert.match(NUIT, /\[style\*="\/frutiz\/sprites\/frutimandala-roue\.svg"\] \{ background-image: url\("\/frutiz\/sprites\/frutimandala-roue-nuit\.svg"\) !important; filter: none !important; \}/);
  assert.match(NUIT, /#frutimandala \.md-art \{ filter: brightness\([^)]*\) saturate\([^)]*\); \}/);
  // Les dossiers du forum, eux, sont des GIF opaques : baisser leur luminosité
  // rendait le vert sombre, pas violet, et la bande restait — en olive. Ce
  // sont les deux seuls dessins qu'on éteint vraiment.
  assert.match(NUIT_FORUM, /\.folder-icon \{ filter: var\(--nuit-chassis\); \}/);
});

test('la bouille garde ses couleurs', () => {
  // Elle est dessinée dans un <canvas> : aucune règle ne doit la teindre, et
  // aucune ne doit fâcheusement l'attraper par ricochet.
  assert.ok(!/canvas[^{]*\{[^}]*filter/.test(NUIT), 'aucun filtre sur un canevas');
  assert.match(NUIT, /LES DESSINS GARDENT LEURS COULEURS/);
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
  // SANS fond choisi, le vert pomme laisse la place au décor de nuit : le
  // dessin du parc endormi, posé sur le ciel de dégradés qui reprend seul si
  // l'image manque — le mode nuit ne retombe jamais sur le vert.
  assert.match(BUREAU, /bureau\.style\.background = nuit \? DECOR_DE_NUIT : '#ADE76B';/);
  assert.match(BUREAU, /var DECOR_DE_NUIT =\s*\n\s*'url\("' \+ FOND_DE_NUIT \+ '"\) center 38% \/ cover no-repeat, ' \+ CIEL_DE_NUIT;/);
  // AVEC un fond d'écran choisi, l'image du joueur reste — dans son dessin de
  // nuit s'il en a un ; seule la couleur autour s'éteint.
  assert.match(BUREAU, /bureau\.style\.backgroundColor = nuit \? '#171232' : \(hex\(arr\[0\]\) \|\| '#ADE76B'\);/);
  assert.match(BUREAU, /bureau\.style\.backgroundImage = 'url\("' \+ source \+ '"\)';/);
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

test('le forum s’éteint : ses saumons en prune, ciel derrière', () => {
  // Le saumon du forum (#E3756A) reste de la famille rose : il devient une
  // prune profonde, pas un aplat éteint.
  const bloc = NUIT_FORUM.slice(NUIT_FORUM.indexOf('.topbar .close-btn {'));
  const fond = /background: hsl\(([-0-9.]+) ([0-9.]+)% ([0-9.]+)%/.exec(bloc);
  assert.ok(fond, 'le bouton saumon du forum est teint');
  assert.strictEqual(Number(fond[1]), GEN.ROSE_NUIT, 'il reste de la famille rose');
  assert.ok(Number(fond[3]) <= 38, 'et c’est un fond de nuit');
  // Le châssis du forum, lui, part au violet comme celui du light.
  const entete = NUIT_FORUM.slice(NUIT_FORUM.indexOf('.forum-header {'));
  const chassis = /background: hsl\(([-0-9.]+) /.exec(entete);
  assert.strictEqual(Number(chassis[1]), GEN.VIOLET, 'l’en-tête du forum est violet');
  assert.match(NUIT_FORUM, /background: var\(--nuit-ciel\) fixed;/);
});

// ── Le chantier de redessin ─────────────────────────────────────────────────

test('déposer « nom-nuit.svg » suffit : le dessin de nuit prend la place', () => {
  // Le mécanisme se prouve en le faisant. On fabrique une variante le temps du
  // test, on régénère en mémoire, et on la retire — rien ne reste sur le disque.
  const jour = path.join(ROOT, 'public/frutiz/sprites/ecran-reflet.svg');
  const nuit = path.join(ROOT, 'public/frutiz/sprites/ecran-reflet-nuit.svg');
  assert.ok(fs.existsSync(jour), 'le dessin de jour est bien là');
  fs.copyFileSync(jour, nuit);
  let feuille;
  try {
    feuille = GEN.fabriquer(GEN.CIBLES[0]);
  } finally {
    fs.unlinkSync(nuit);
  }
  // 1) Partout où le CSS nomme le dessin, il pointe désormais la variante…
  assert.ok(feuille.includes("url('/frutiz/sprites/ecran-reflet-nuit.svg')"),
    'le CSS pointe la variante');
  assert.ok(!/url\('\/frutiz\/sprites\/ecran-reflet\.svg'\)/.test(feuille),
    'et plus une seule fois l’original');
  // 2) …et la règle n'est PLUS fanée : le dessin est déjà de nuit.
  const regle = feuille.slice(feuille.indexOf('ecran-reflet-nuit.svg') - 400,
    feuille.indexOf('ecran-reflet-nuit.svg') + 120);
  const bloc = regle.slice(regle.lastIndexOf('{', regle.indexOf('ecran-reflet-nuit')));
  assert.ok(!/--nuit-fane/.test(bloc.slice(0, bloc.indexOf('}'))),
    'la variante échappe au fanage');
  // 3) Les <img> et les fonds posés par le JavaScript sont rattrapés par
  //    sélecteur d'attribut — sans toucher au HTML ni au JS.
  assert.ok(feuille.includes('img[src$="/frutiz/sprites/ecran-reflet.svg"] '
    + '{ content: url("/frutiz/sprites/ecran-reflet-nuit.svg"); filter: none; }'));
  assert.ok(feuille.includes('[style*="/frutiz/sprites/ecran-reflet.svg"] '
    + '{ background-image: url("/frutiz/sprites/ecran-reflet-nuit.svg") !important; '
    + 'filter: none !important; }'));
});

test('une variante orpheline ne produit aucune règle', () => {
  // Un « nom-nuit.svg » sans « nom.svg » ne remplace rien : émettre une règle
  // pour lui ne ferait qu'alourdir la feuille d'un sélecteur mort.
  const orphelin = path.join(ROOT, 'public/frutiz/sprites/nexiste-pas-nuit.svg');
  fs.writeFileSync(orphelin, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  let trouvees;
  try {
    trouvees = GEN.variantesNuit();
  } finally {
    fs.unlinkSync(orphelin);
  }
  assert.ok(!trouvees.has('/frutiz/sprites/nexiste-pas.svg'), 'l’orpheline est ignorée');
});

// ── Ce qu'un dessin garde, et ce qu'il rend ─────────────────────────────────

test('la courbe des dessins n’écrase plus la moitié sombre de l’échelle', () => {
  // Le plafond dur était posé à 38 : de #888888 au noir, TOUTE la moitié basse
  // de la rampe des gris sortait sur cette seule valeur. Un bouton du Frusion,
  // c'est un anneau et un pictogramme — les deux en sortaient identiques, et
  // le pictogramme disparaissait. La courbe doit rester strictement monotone.
  const rampe = ['#ffffff', '#dddddd', '#bbbbbb', '#999999', '#888888',
    '#666666', '#444444', '#222222', '#000000'].map((hex) => L(teint(hex, 'sprite')));
  for (let i = 1; i < rampe.length; i++) {
    assert.ok(rampe[i] > rampe[i - 1] + 1,
      'deux gris voisins doivent rester distincts (' + rampe[i - 1] + ' puis ' + rampe[i] + ')');
  }
  // Une face éclairée descend bas, un trait sombre remonte haut : c'est ce qui
  // rend son relief au dessin.
  assert.ok(rampe[0] < 12, 'le blanc devient la face sombre');
  assert.ok(rampe[rampe.length - 1] > 55, 'le noir devient le liseré clair');
});

test('le blanc d’un dessin : glyphe par défaut, face quand on le dit', () => {
  const SVG = require('../scripts/nuit-svg.js');
  const lire = (f) => fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites', f), 'utf8');
  // Le glyphe blanc des boutons du salon reste blanc — sans quoi la tête de
  // mort et le triangle disparaissent sur leur bouton rose.
  assert.match(lire('chat-but-warning-nuit.svg'), /="#ffffff"/);
  // Le blanc d'un onglet, lui, est sa FACE : il s'éteint. C'est le défaut
  // inverse, et il est écrit dans le manifeste.
  for (const f of ['onglet_corps.svg', 'onglet_pied.svg', 'onglet_barre.svg']) {
    const e = SVG.MANIFESTE.find((x) => x.f === f);
    assert.equal(e && e.blanc, 'teint', f + ' doit déclarer son blanc comme une face');
    assert.ok(!/="#(fff|ffffff)"/i.test(lire(f.replace('.svg', '-nuit.svg'))),
      f + ' ne doit plus garder de blanc pur');
  }
});

test('une commande garde SA couleur — rouge, jaune, vert', () => {
  const lire = (f) => fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites', f), 'utf8');
  // Les trois boutons du frutimandala se distinguent par leur couleur. Le
  // filtre du châssis les passait toutes au gris violet ; la conversion, elle,
  // rangeait le rouge avec les roses et le VERT avec le châssis — le parc de
  // jour est vert. Ils gardent donc leurs teintes, socle gris mis à part.
  assert.match(lire('mandalaGauche_up-nuit.svg'), /="#df2b2b"/, 'le triangle reste rouge');
  assert.match(lire('mandalaSwap_up-nuit.svg'), /="#f5ac03"/, 'le swap reste jaune');
  assert.match(lire('mandalaValider_up-nuit.svg'), /="#72a60f"/, 'le valider reste vert');
  // Et leur socle, lui, s'éteint : sans quoi ils flotteraient sur une plaque
  // grise au milieu du cadran violet.
  assert.match(lire('mandalaValider_up-nuit.svg'), /="hsl\(256 /, 'le socle gris part au violet');
  // Le petit fruit du Frusion suit la même règle (rouge, jaune, vert).
  for (const c of ['#ec4242', '#ffcc00', '#8cdb29']) {
    assert.ok(lire('frusion-avant-nuit.svg').includes('="' + c + '"'),
      'le fruit du Frusion garde son ' + c);
  }
});

test('un dessin tout en couleur reçoit quand même sa variante', () => {
  // Les trois boutons du bandeau de fenêtre — croix, trait, « ? » — n'ont
  // aucun gris. Ne rien écrire pour eux les laissait au FILTRE du châssis,
  // qui les passait au gris violet : le « ? » vert devenait invisible. La
  // variante à l'identique est ce qui dit « celui-là est réglé ».
  for (const n of ['butWinTop1_up', 'butWinTop2_up', 'butWinTop3_up']) {
    const nuit = path.join(ROOT, 'public/frutiz/sprites', n + '-nuit.svg');
    assert.ok(fs.existsSync(nuit), n + ' doit avoir sa variante');
    assert.match(fs.readFileSync(nuit, 'utf8'), /Ce dessin n'a AUCUNE couleur de châssis/);
    assert.match(NUIT, new RegExp('url\\("/frutiz/sprites/' + n + '-nuit\\.svg"\\)'));
  }
  // Le « ? » est vert, et il le reste — c'est précisément le vert que la
  // conversion aurait rangé avec le châssis.
  assert.match(fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites/butWinTop3_up-nuit.svg'), 'utf8'),
    /="#7aef80"/, 'le point d’interrogation garde son vert');
});

test('la boutique : le châssis s’éteint, les kikooz gardent leur or', () => {
  const SVG = require('../scripts/nuit-svg.js');
  const sp = (f) => lire('public/frutiz/sprites/' + f);
  const teintes = (svg) => [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8}|hsl\([^"]*\))"/g)]
    .map((m) => m[1]);

  // Le CHÂSSIS s'éteint : cadre d'aperçu, reflet, plaque des commandes. Le
  // reflet est un aplat de blanc PUR sans transparence — gardé blanc il
  // barrait l'aperçu d'un trait laiteux.
  for (const f of ['shop-cadre.svg', 'shop-cadre-reflet.svg', 'shop-but-blanc.svg']) {
    const nuit = teintes(sp(f.replace('.svg', '-nuit.svg')));
    assert.ok(nuit.length && nuit.every((c) => c.startsWith('hsl(256')),
      f + ' doit être entièrement passé au violet du châssis : ' + nuit.join(' '));
  }

  // LES DESSINS GARDENT LEURS COULEURS, et un kikooz est une pièce d'or. Une
  // pièce d'or grise n'est plus un kikooz.
  for (const f of ['shop-kikooz', 'shop-ico-kikooz', 'shop-plus-kikooz', 'shop-puce-article',
    'shop-puce-rubrique']) {
    assert.strictEqual(sp(f + '-nuit.svg').replace(/<!--[\s\S]*?-->\n?/, ''),
      sp(f + '.svg').replace(/(<svg[^>]*>\n?)/, '$1'),
      f + ' ne doit pas changer d’un pixel');
  }

  // « ACHETER » EST UNE COMMANDE. Vert dans le thème de jour, il était rangé
  // avec le châssis : violet sombre sur un panneau violet, l'air d'un bouton
  // désactivé. Il passe par la branche ROSE, celle des boutons du salon.
  const acheter = teintes(sp('shop-but-acheter-nuit.svg'));
  assert.ok(acheter.length >= 3 && acheter.every((c) => c.startsWith('hsl(325')),
    'le bouton « Acheter » doit être rose : ' + acheter.join(' '));
  // Et il garde son RELIEF : un bouton a une face, un liseré et un reflet.
  assert.strictEqual(new Set(acheter).size, 3, 'ses trois valeurs restent distinctes');
  // Son jumeau du tiroir est du CSS : la même décision s'y écrit à la main.
  assert.match(lire('scripts/nuit-retouches.css'),
    /\.bo-acheter \{\s*\n\s*border: 1px solid hsl\(325 68% 63\.3%\);/);
  // Le dossier rose de la boutique mobile est un DESSIN : il sort du fanage.
  assert.ok(!lire('scripts/nuit-retouches.css').includes('/fb/boutique/dossier.png'),
    'le dossier rose ne doit plus être fané');
});

test('l’encart de la main bar : plus un vert, et le voyant s’ÉCLAIRE', () => {
  const SVG = require('../scripts/nuit-svg.js');
  const fb = (f) => lire('public/fb/' + f);

  // 1. Le fond de la bouille est le MÊME DESSIN que l'écran de l'aquarium :
  //    mêmes verts, même dégradé. Passés par la même conversion, ils doivent
  //    ressortir identiques — sans qu'aucune règle n'ait à le dire.
  const couleurs = (svg) => [...svg.matchAll(/(?:fill|stop-color)="(hsl\([^"]*\))"/g)]
    .map((m) => m[1]).sort();
  assert.deepStrictEqual(
    couleurs(fb('cadre_bouille-nuit.svg')),
    couleurs(lire('public/frutiz/sprites/ecran-fond-nuit.svg')),
    'le fond de la bouille doit reprendre la teinte de l’aquarium');

  // 2. La coupe prend la teinte des icônes — elle était d'un vert plus sombre,
  //    et une rangée ne se lit pas si l'un de ses membres est d'une autre
  //    couleur.
  const teinte = (svg) => (/fill="(hsl\([^"]*\))"/.exec(svg) || [])[1];
  for (const n of ['Mail', 'Warning', 'Historique', 'Aide', 'Forum', 'Jeux', 'trophee']) {
    assert.strictEqual(teinte(fb(n + '-nuit.svg')), SVG.TEINTES.glyphe,
      n + ' doit être de la teinte des glyphes');
  }

  // 3. « NIV » est un dessin, le numéro qui le suit est du texte, et ils se
  //    lisent d'un seul tenant. Même couleur d'origine, même rôle : la
  //    conversion leur donne la même teinte de nuit, par construction.
  const duTexte = teint('#73b01e', 'texte');
  assert.strictEqual(teinte(fb('Niveau-nuit.svg')), duTexte);
  assert.ok(NUIT.includes('.enc-niv .lvl {\n  color: ' + duTexte + ';\n}'),
    'le numéro de niveau doit porter exactement la même couleur');

  // 4. LE SENS DU VOYANT S'INVERSE. Le jour, il signale en FONÇANT (vert sombre
  //    sur vert clair) ; la nuit, en s'éclairant. Aucune conversion ne peut le
  //    voir — elle garde la hiérarchie d'origine, et le voyant allumé serait
  //    ressorti plus sombre que le voyant au repos, c'est-à-dire éteint.
  for (const n of ['MailRecu', 'WarningAlerte', 'HistoriqueAlerte', 'ForumAlerte']) {
    assert.strictEqual(teinte(fb(n + '-nuit.svg')), SVG.TEINTES.voyant, n + ' est le voyant allumé');
  }
  assert.ok(L(SVG.TEINTES.voyant) > L(SVG.TEINTES.glyphe) + 15,
    'allumé doit être franchement plus clair qu’au repos');
  assert.ok(L(SVG.TEINTES.voyant) >= 92, 'et presque blanc');

  // 5. Et le FILTRE ne doit plus les toucher : les retouches sont recopiées
  //    APRÈS les règles engendrées, et gagneraient sur leur `filter: none`.
  const retouches = lire('scripts/nuit-retouches.css');
  for (const perime of ['img.cadre,', '/fb/cadre_bouille.svg', '/fb/Niveau.svg']) {
    assert.ok(!retouches.includes(perime),
      perime + ' a sa variante : le laisser au filtre annulerait le travail');
  }
});

// ── Les fonds d'écran de nuit ───────────────────────────────────────────────
//
// Même idée que « nom-nuit.svg » pour le châssis : c'est le NOM DU FICHIER qui
// déclare la variante. Déposer « background_<nom>_dark.jpg » à côté du fond de
// jour suffit à le faire servir quand le parc s'éteint, sans une ligne de code.

const BOUTIQUE = 'public/fb/boutique';
const fichiersFonds = () => fs.readdirSync(path.join(ROOT, BOUTIQUE));
// Les huit fonds du catalogue, tels que server.js les nomme.
const FONDS = [
  ['moutarde', 'Chevalier moutarde'], ['chorale', 'Chorale Frutiparc'],
  ['pixizchristmas', 'Noël Pixiz'], ['snakechristmas', 'Noël Frutisnake'],
  ['pixiz', 'Mini-Pixiz'], ['nostromo', 'Mini-Wave Nostromo'],
  ['ministar', 'Mini-Wave Mini-Star'], ['utopiz', 'Utopiz'],
];
// La transcription du radical calculé par server.js (baseFond + slugFond).
const EXCEPTIONS = { ministar: 'background_mini_wave_ministar', nostromo: 'background_mini_wave_nostromodo' };
const radical = (u, n) => EXCEPTIONS[u] || 'background_' + String(n)
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const cherche = (base, suffixe) =>
  fichiersFonds().find((x) => x.startsWith(base + suffixe + '.')) || null;

test('le radical d’un fond porte tous ses cadrages', () => {
  // Le refactor qui a introduit `_dark` a raccourci les deux exceptions (elles
  // portaient « _mobile » en dur). Si la table repart de travers, ce sont les
  // versions VERTICALES de tous les fonds qui disparaissent d'un coup : on
  // vérifie donc que chacune se retrouve, une par une.
  const sansPortrait = [];
  for (const [u, n] of FONDS) {
    if (!cherche(radical(u, n), '_mobile')) sansPortrait.push(u);
  }
  assert.deepStrictEqual(sansPortrait, ['chorale'],
    'seule la Chorale n’a pas de version verticale');
  assert.match(SERVEUR, /ministar: 'background_mini_wave_ministar',/);
  assert.match(SERVEUR, /nostromo: 'background_mini_wave_nostromodo',/);
  assert.match(SERVEUR, /return fichierFond\(baseFond\(wp\), vertical \? '_dark_mobile' : '_dark'\);/);
  assert.match(SERVEUR, /return wp \? fichierFond\(baseFond\(wp\), '_mobile'\) : null;/);
});

test('Utopiz a son dessin de nuit, et c’est le décor du parc éteint', () => {
  assert.ok(cherche('background_utopiz', '_dark'), 'le paysage de nuit d’Utopiz est là');
  // Le décor par défaut : ce n'est pas un article, c'est le ciel du thème.
  assert.match(SERVEUR, /const FOND_DECOR_NUIT = 'utopiz';/);
  assert.match(SERVEUR, /decorNuit: decorDeNuit\(\),/);
  assert.match(BUREAU, /var FOND_DE_NUIT = '\/fb\/boutique\/background_utopiz_dark\.jpg';/);
  assert.ok(fs.existsSync(path.join(ROOT, BOUTIQUE, 'background_utopiz_dark.jpg')),
    'le fichier que le bureau nomme en dur existe bien');
});

test('les deux Mini-Wave sont déjà des ciels de nuit', () => {
  // Leur couleur de bureau est un bleu nuit : les redessiner n'aurait pas de
  // sens. On le DIT, pour que l'admin ne les compte pas comme un reste à faire.
  assert.match(SERVEUR, /const WALLPAPER_NUIT_OK = new Set\(\['nostromo', 'ministar'\]\);/);
  for (const u of ['nostromo', 'ministar']) {
    const i = SERVEUR.indexOf(`{ u: '${u}',`);
    assert.match(SERVEUR.slice(i, i + 130), /color: '000044;'/, u + ' est bien un bleu nuit');
  }
});

test('le fond du joueur passe en nuit quand il a un dessin de nuit', () => {
  // Le serveur annonce les quatre cadrages…
  assert.match(SERVEUR, /function cadragesDuFond\(url\) \{[\s\S]*?urlNuit: wallpaperNuitUrl\(wp, false\),[\s\S]*?urlNuitMobile: wallpaperNuitUrl\(wp, true\),/);
  assert.equal((SERVEUR.match(/\.\.\.cadragesDuFond\(/g) || []).length, 3,
    'les trois charges utiles du light les portent');
  // …le bureau large prend le paysage de nuit…
  assert.match(BUREAU, /var source = \(nuit && fond\.urlNuit\) \|\| fond\.url;/);
  assert.match(BUREAU, /bureau\.style\.background = nuit \? DECOR_DE_NUIT : '#ADE76B';/);
  // …et le tiroir le portrait de nuit d'abord, le paysage de nuit ensuite, le
  // dessin de jour en dernier recours : la palette avant le cadrage.
  assert.match(LIGHT, /\? \(fond\.urlNuitMobile \? \{ src: fond\.urlNuitMobile, vertical: true \}\s*\n\s*: fond\.urlNuit \? \{ src: fond\.urlNuit, vertical: false \}\s*\n\s*: fond\.urlMobile \? \{ src: fond\.urlMobile, vertical: true \}/);
  // La bascule jour/nuit repeint les deux : le fond est posé en style="".
  assert.match(LIGHT, /if \(window\.BureauFrutiz && BureauFrutiz\.rafraichirFond\) BureauFrutiz\.rafraichirFond\(\);\s*\n\s*if \(invFondActuel\) appliquerFond\(invFondActuel\);/);
});

test('l’admin dit quels fonds restent à redessiner', () => {
  assert.match(SERVEUR, /nuit: etatNuitDuFond\(w\),/);
  assert.match(SERVEUR, /function etatNuitDuFond\(wp\) \{/);
  assert.match(SERVEUR, /return WALLPAPER_NUIT_OK\.has\(wp\.u\) \? 'compatible' : 'a-redessiner';/);
  for (const etat of ['variante', 'compatible', "'a-redessiner'"]) {
    assert.ok(ADMIN.includes(etat), 'l’état « ' + etat + ' » manque du tableau de bord');
  }
  assert.match(ADMIN, /🌙 dessin de nuit/);
  assert.match(ADMIN, /☀️ à redessiner/);
});

// ── Le rayon, ouvert et fermé depuis l'admin ────────────────────────────────
//
// Un thème se juge sur un vrai parc, pas sur une capture. L'article part donc
// RETIRÉ du rayon : l'admin en accorde à quelques joueurs depuis leur fiche,
// regarde ce que ça donne, puis ouvre la vente d'un clic. Trois pièces, et
// chacune a sa raison d'être ci-dessous.

test('l’article part retiré du rayon — on le fait essayer avant de le vendre', () => {
  const bloc = SERVEUR.slice(SERVEUR.indexOf('const SHOP_DECOR_PACKS_DEFAULT = ['),
    SERVEUR.indexOf('// ── Feutres spéciaux'));
  assert.match(bloc, /\n\s*disabled: true,/, 'l’article n’est pas en vente au premier démarrage');
  // Retiré du rayon veut dire INVENDABLE, pas éteint : ces deux-là suffisent.
  assert.match(SERVEUR, /function estPackEnRayon\(p\) \{ return !p\.disabled && !p\.recompense; \}/);
  assert.match(SERVEUR, /if \(!pack \|\| pack\.disabled \|\| pack\.recompense\) return \{ ok: false, code: 1 \};/);
});

test('la bascule de l’admin survit à un redémarrage', () => {
  // Au démarrage, la ligne persistée en base ÉCRASE la définition statique,
  // et quelques champs seulement sont réappliqués par-dessus — ceux que la
  // base ne sait pas porter. `disabled`, lui, A sa colonne : le laisser hors
  // de ce rappel est ce qui fait qu'un « Réactiver » cliqué tient au reboot.
  // Sans quoi l'article se retirerait tout seul à chaque relance du serveur.
  const rappel = /if \(def && def\.gameFeature\) \{ ([^}]*) \}/.exec(SERVEUR);
  assert.ok(rappel, 'le rappel des options de jeu est toujours là');
  assert.ok(!/disabled/.test(rappel[1]),
    'le rappel ne doit pas reposer `disabled` : il annulerait la bascule de l’admin');
  // La colonne existe, et la bascule l'écrit : c'est ce qui donne à la base le
  // dernier mot sur ce champ-là.
  assert.match(lire('db.js'), /ALTER TABLE shop_packs ADD COLUMN IF NOT EXISTS disabled BOOLEAN/);
  assert.match(lire('db.js'), /disabled = \$10/);
  assert.match(ADMIN, /onclick="toggleShopDisabled\(\$\{p\.id\},'\$\{esc\(p\.name\)\}',false\)">Réactiver/);
});

test('l’admin accorde le mode nuit depuis la fiche joueur', () => {
  // C'est ce qui permet de faire tester PENDANT que l'article est retiré : la
  // possession se lit dans `owned_features`, jamais dans le catalogue.
  const i = ADMIN.indexOf('Mode nuit (« Son temps viendra »)');
  assert.ok(i > 0, 'la ligne manque de la fiche joueur');
  const ligne = ADMIN.slice(i, ADMIN.indexOf('</tr>', i));
  assert.ok(ligne.includes("\\'modeNuit\\',true"), 'le bouton « Donner » manque');
  assert.ok(ligne.includes("\\'modeNuit\\',false"), 'le bouton « Retirer » manque');
  assert.ok(ligne.includes("owned_features"), 'l’état se lit dans owned_features');
  // Le portillon ne consulte que la possession — le rayon n'y entre pas.
  assert.match(SERVEUR, /if \(GAME_FEATURES\[feature\]\) \{\s*\n\s*const user = users\[u\];\s*\n\s*if \(userOwnsGameFeature\(user, feature\)\) return true;/);
  assert.match(SERVEUR, /if \(!GAME_FEATURES\[key\]\) return res\.status\(400\)\.json\(\{ error: 'option inconnue : ' \+ key \}\);/);
});

test('« Pousser à tous » et « Retirer à tous » se refusent sur une option', () => {
  // Ces deux routes écrivent dans les INVENTAIRES. Sur un article qui accorde
  // un droit — option, feutre, pass, récompense —, elles déposeraient chez
  // chaque joueur une pièce d'armoire au nom de l'option, sans rien accorder.
  assert.match(SERVEUR, /function accordeUnAccessoire\(p\) \{\s*\n\s*return !!p && !p\.gameFeature && !p\.feutrePen && !p\.fdPassGame && !p\.recompense;\s*\n\}/);
  for (const route of ['push-all', 'retirer-a-tous']) {
    const i = SERVEUR.indexOf("'/api/admin/shop/:id/" + route + "'");
    assert.ok(i > 0, 'la route ' + route + ' existe');
    const corps = SERVEUR.slice(i, i + 900);
    assert.match(corps, /if \(!accordeUnAccessoire\(pack\)\) \{\s*\n\s*return res\.status\(400\)/,
      route + ' laisse passer une option de jeu');
  }
  // Et côté admin, les boutons ne s'affichent même pas — avec un badge qui dit
  // par où passer.
  assert.match(ADMIN, /function accordeUnAccessoire\(p\) \{/);
  assert.match(ADMIN, /\$\{accordeUnAccessoire\(p\) \? `\n\s*<button class="btn-success btn-sm" onclick="pushPackAll/);
  assert.match(ADMIN, /pastille\('option', '#6a4c9c',/);
  assert.match(ADMIN, /\$\{badgeAccorde\(p\)\}/);
});
