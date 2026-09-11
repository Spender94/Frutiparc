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
  // Un DESSIN peut entrer au manifeste — c'est même souvent nécessaire, ne
  // serait-ce que pour échapper au filtre du châssis —, mais à UNE condition :
  // qu'il y garde ses couleurs. `teintes: 'gardees'` n'éteint que les neutres.
  // Sans ce garde-fou, ajouter un fruit à la liste l'éteindrait, et le mode
  // nuit se mettrait à faire exactement le contraire de ce qu'il promet.
  const DESSINS = /^(fruit_|ico_|emote_|feutre-|disc_|sl-presence|medal_|signe_)/;
  for (const e of SVG.MANIFESTE) {
    if (!DESSINS.test(e.f)) continue;
    assert.strictEqual(e.teintes, 'gardees',
      e.f + ' est un dessin : il ne peut entrer qu’en gardant ses couleurs');
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

// Les déclarations d'une propriété, avec le SÉLECTEUR de leur règle : c'est
// lui qui dit si une couleur joue le rôle que son nom annonce. Un `background`
// de remplissage de barre est un signal, pas un fond ; un `color` de feutre
// gras est une encre, pas un texte du thème (cf. ROLES_FORCES). Ces deux-là
// ne relèvent pas de l'invariant des surfaces — un feutre ne s'écrit que sur
// le panneau du chat, et sa lisibilité s'y mesure à part.
function declarations(css, propriete) {
  const out = [];
  let tete = '';
  for (const ligne of css.split('\n')) {
    if (/\{\s*$/.test(ligne)) { tete = ligne.replace(/\s*\{\s*$/, '').trim(); continue; }
    if (!new RegExp('^\\s*' + propriete + '\\s*:').test(ligne)) continue;
    const prop = ligne.slice(0, ligne.indexOf(':')).trim();
    const force = GEN.roleForce(tete, prop);
    if (force && force !== GEN.roleDe(prop)) continue;
    out.push(ligne);
  }
  return out;
}
function clartes(css, propriete) {
  const out = [];
  for (const ligne of declarations(css, propriete)) {
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
  for (const ligne of declarations(css, propriete)) {
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
  assert.ok(chassis > 0, 'le fanage existe toujours pour les sprites sans variante');
  /*
   * CE NOMBRE EST UN RESTE À FAIRE, ET IL BAISSE.
   *
   * Le filtre est un pis-aller : il ternit tout de la même main, il écrase les
   * reliefs, et il ne sait pas qu'un voyant vert et un voyant saumon ne
   * doivent pas sortir de la même couleur. Chaque dessin qui reçoit sa
   * variante lui échappe — le compte est passé de 89 à 24.
   *
   * On ne fixe donc PAS de plancher : il n'y a pas de bonne valeur, seulement
   * une direction. Ce qu'on garde, c'est que ceux qui en sont sortis n'y
   * retombent pas.
   */
  for (const [quoi, regle] of [
    // (`?v=` : l'empreinte du contenu, qui fait qu'une variante refaite est
    // une URL neuve pour un cache « immutable » — cf. variantesNuit.)
    ['le boîtier du Frusion', /#frusion-boite \.fr-avant \{\s*\n\s*background-image: url\('\/frutiz\/sprites\/frusion-avant-nuit\.svg\?v=[0-9a-f]{8}'\);\s*\n\s*\}/],
    ['le « valider » du frutimandala', /#frutimandala \.md-mandalaValider \{\s*\n\s*background-image: url\('\/frutiz\/sprites\/mandalaValider_up-nuit\.svg\?v=[0-9a-f]{8}'\);\s*\n\s*\}/],
    ['le corps des onglets', /url\("\/frutiz\/sprites\/onglet_corps-nuit\.svg\?v=[0-9a-f]{8}"\)/],
    ['le fruit d’une barre-titre', /\.fen-pastille \{\s*\n\s*background: url\('\/frutiz\/sprites\/fruit_default-nuit\.svg\?v=[0-9a-f]{8}'\)/],
    ['le voyant d’un contact', /\.sl-contact \.voyant \{\s*\n\s*--etat: url\('\/frutiz\/sprites\/sl-presence-0-nuit\.svg\?v=[0-9a-f]{8}'\)/],
  ]) {
    assert.match(NUIT, regle, quoi + ' a sa variante, il n’est plus fané');
  }
  for (const [quoi, regle] of [
    ['le Frusion', /#frusion-boite [^{]*\{\s*\n\s*filter: var\(--nuit-chassis\)/],
    ['les commandes du frutimandala', /#frutimandala \.md-mandala[^{]*\{\s*\n\s*filter: var\(--nuit-chassis\)/],
    ['les voyants de la barre de contacts', /\.sl-contact \.voyant \{\s*\n\s*filter: var\(--nuit-chassis\)/],
    ['les fruits des barres-titres', /\.fen-pastille \{\s*\n\s*filter: var\(--nuit-chassis\)/],
  ]) {
    assert.ok(!regle.test(NUIT), quoi + ' : plus une seule pièce ne passe par le filtre');
  }
  // LES DEUX VOYANTS NE DOIVENT PAS SORTIR DE LA MÊME COULEUR. Saumon hors
  // ligne, vert en ligne : c'est tout ce qu'ils disent. Le filtre les passait
  // au même gris violet — deux états, une seule couleur, plus de voyant.
  const lireSp = (f) => lire('public/frutiz/sprites/' + f);
  assert.match(lireSp('sl-presence-0-nuit.svg'), /="#e3756a"/, 'hors ligne reste saumon');
  assert.match(lireSp('sl-presence-1-nuit.svg'), /="#ade76b"/, 'en ligne reste vert');
  // Et les cinq fruits des barres-titres gardent les leurs : c'est à ça qu'on
  // reconnaît un salon d'un explorateur.
  for (const [f, couleur] of [['fruit_default', '#ff9900'], ['fruit_winChat', '#eb1a14'],
    ['fruit_winShop', '#39b315'], ['fruit_winExplorer', '#fefe25']]) {
    assert.ok(lireSp(f + '-nuit.svg').includes('="' + couleur + '"'),
      f + ' garde son ' + couleur);
  }
  // Et la poignée de pièces de châssis qui arrivent par un <img> du HTML.
  assert.match(NUIT, /img\[src\$="\/fb\/cadre_bouille\.svg"\]/);
  // LA ROUE DU FRUTIMANDALA porte ses fruits sur des quartiers verts : aucun
  // filtre ne sait éteindre le quartier sans le fruit. Elle a donc une vraie
  // VARIANTE DE NUIT, et c'est elle qui sert ; la règle CSS n'est qu'un filet.
  assert.match(NUIT, /\[style\*="\/frutiz\/sprites\/frutimandala-roue\.svg"\] \{ background-image: url\("\/frutiz\/sprites\/frutimandala-roue-nuit\.svg\?v=[0-9a-f]{8}"\) !important; filter: none !important; \}/);
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
  // PAR LE MÉDIA, PAS PAR `disabled` : désactiver un <link> fait jeter sa
  // feuille par Chrome, et la réactiver la RECHARGE — asynchrone, avec un
  // aller-retour serveur. Mesuré : nuit.css absente des feuilles actives à
  // l'instant de la bascule, le parc en vert le temps du rechargement, et le
  // voile d'un fond privé lu à la chair du jour. « not all » laisse la feuille
  // en place et ses règles reviennent d'un coup.
  assert.match(LIGHT, /if \(lien\) lien\.media = on \? "all" : "not all";/);
  assert.match(LIGHT, /if \(l2\) l2\.media = on \? "all" : "not all";/);
  assert.ok(!/(lien|l2)\.disabled = !on;/.test(LIGHT), 'plus aucune bascule par `disabled`');
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
  // 1) Partout où le CSS nomme le dessin, il pointe désormais la variante —
  //    avec l'empreinte de son contenu, pour qu'un cache « immutable » ne
  //    serve jamais une variante d'avant (cf. variantesNuit)…
  assert.match(feuille, /url\('\/frutiz\/sprites\/ecran-reflet-nuit\.svg\?v=[0-9a-f]{8}'\)/,
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
  assert.match(feuille, /img\[src\$="\/frutiz\/sprites\/ecran-reflet\.svg"\] \{ content: url\("\/frutiz\/sprites\/ecran-reflet-nuit\.svg\?v=[0-9a-f]{8}"\); filter: none; \}/);
  assert.match(feuille, /\[style\*="\/frutiz\/sprites\/ecran-reflet\.svg"\] \{ background-image: url\("\/frutiz\/sprites\/ecran-reflet-nuit\.svg\?v=[0-9a-f]{8}"\) !important; filter: none !important; \}/);
  // 4) L'empreinte est celle du CONTENU : deux variantes différentes donnent
  //    deux URL différentes — c'est ce qui bat le cache.
  const a = GEN.variantesNuit().get('/frutiz/sprites/frusion-avant.svg');
  const b = GEN.variantesNuit().get('/frutiz/sprites/frusion-milieu.svg');
  assert.match(a, /\?v=[0-9a-f]{8}$/);
  assert.notStrictEqual(a.slice(-8), b.slice(-8), 'deux dessins, deux empreintes');
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
    assert.match(NUIT, new RegExp('url\\("/frutiz/sprites/' + n + '-nuit\\.svg\\?v=[0-9a-f]{8}"\\)'));
  }
  // Le « ? » est vert, et il le reste — c'est précisément le vert que la
  // conversion aurait rangé avec le châssis.
  assert.match(fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites/butWinTop3_up-nuit.svg'), 'utf8'),
    /="#7aef80"/, 'le point d’interrogation garde son vert');
});

test('un plancher écrase, une échelle garde la hiérarchie', () => {
  /*
   * Les deux planchers du rose étaient posés au `Math.max`, et les courbes du
   * thème sortent SOUS eux : toutes les valeurs y retombaient. Mesuré sur la
   * feuille produite avant correction : 34 aplats sur exactement
   * hsl(325 34% 22%), 51 accents sur hsl(325 58% 66%).
   *
   * Ce n'est pas une nuance : c'est de l'information perdue. Une liste y
   * laissait son alternance une ligne sur deux ET son survol, un bouton
   * l'écart entre son repos et son état enfoncé.
   */
  const groupes = {};
  for (const m of NUIT.matchAll(/hsl\(325 \d+% [\d.]+%/g)) {
    groupes[m[0]] = (groupes[m[0]] || 0) + 1;
  }
  const pire = Math.max(...Object.values(groupes));
  assert.ok(pire <= 25,
    'aucune valeur de rose ne doit rassembler tout le monde (la pire en compte ' + pire + ')');
  // Les trois fonds de la liste des salons sont trois valeurs distinctes —
  // rang impair, rang pair, survol.
  const trois = ['#FEC9C9', '#FEABAB', '#FFF2F2'].map((c) => L(teint(c, 'fond')));
  assert.strictEqual(new Set(trois).size, 3, 'trois aplats voisins restent trois : ' + trois);
  for (const v of trois) assert.ok(v >= 22, 'et le plancher est respecté (' + v + ')');
  // Idem pour les liserés, qui sortaient TOUS sur la même valeur.
  const liserets = ['#F28687', '#FFAAAD', '#D16767', '#660000'].map((c) => L(teint(c, 'bordure')));
  assert.ok(new Set(liserets).size >= 3, 'les liserés gardent leur hiérarchie : ' + liserets);
  for (const v of liserets) assert.ok(v >= 66, 'et leur plancher (' + v + ')');
});

test('les trois retouches du parc éteint : feutres, lueur, liste des salons', () => {
  const retouches = lire('scripts/nuit-retouches.css');
  const jour = lire('public/bureau-frutiz.css');

  // 1. LES FEUTRES. Le liseré doit se poser EXACTEMENT là où le thème de jour
  //    dessine les feutres — même sélecteur, mot pour mot. Ailleurs (le tiroir
  //    mobile), ce sont des pastilles rondes qui ont déjà leur cerne, et un
  //    liseré carré les abîmerait.
  const SEL = 'body.bureau-frutiz .fen #chat-panel #pen-bar .pen-swatch';
  assert.ok(jour.includes(SEL + ' {'), 'le thème de jour dessine bien les feutres ici');
  assert.ok(retouches.includes(SEL + ' {'), 'et la retouche vise le même endroit');
  assert.ok(retouches.includes(SEL + '.sel {'), 'le feutre choisi aussi');
  assert.ok(!/^#pen-bar \.pen-swatch/m.test(retouches),
    'et rien ne vise les pastilles rondes du tiroir');

  // 2. PAS DE LUEUR AUTOUR DES VOYANTS. Un halo diffus avait été essayé —
  //    vert quand la personne est là, saumon sinon — et écarté au rendu : sur
  //    une colonne de trente contacts, trente petites lampes font une
  //    guirlande, pas une liste. Le voyant se lit à sa couleur, cela suffit.
  assert.ok(!/--lueur/.test(retouches), "la lueur des voyants a été retirée, elle ne revient pas");

  // 3. LA LISTE DES SALONS rejoint le violet des autres fenêtres, et son
  //    alternance se voit : trois valeurs, et le survol au-dessus des deux.
  const fonds = ['\\.sp-salon \\{\\s*\\n\\s*background: hsl\\(256 30% ([\\d.]+)%\\)',
    '\\.sp-salon\\.paire \\{ background: hsl\\(256 30% ([\\d.]+)%\\)',
    '\\.sp-salon:hover \\{ background: hsl\\(256 34% ([\\d.]+)%\\)']
    .map((r) => Number(new RegExp(r).exec(retouches)[1]));
  assert.strictEqual(new Set(fonds).size, 3, 'trois valeurs distinctes : ' + fonds);
  assert.ok(fonds[2] > fonds[0] && fonds[2] > fonds[1], 'le survol s’allume : ' + fonds);
  assert.ok(Math.abs(fonds[1] - fonds[0]) >= 3, 'l’alternance se voit : ' + fonds);
  // Et plus une trace de prune sur cette liste-là.
  assert.ok(!/#salons-panel \.sp-salon[^{]*\{[^}]*hsl\(325/.test(NUIT.slice(NUIT.indexOf(MARQUE))),
    'la liste des salons ne doit plus rien devoir au rose');
});

test('un voyant EN PARTIE garde son icône de jeu', () => {
  /*
   * LE PIÈGE DES DEUX COUCHES. Le voyant d'un contact en porte deux : le
   * CADRE, et par-dessus ce qui dit l'état — pastille de présence, icône du
   * jeu en cours, statut d'absence. Le JavaScript ne remplace que la seconde.
   *
   * Il l'écrivait en `background-image`, qui est UNE propriété : le cadre y
   * était donc recopié à chaque fois. Et le mode nuit échange le cadre contre
   * sa version de nuit par un `!important` sur `[style*=…]` — qui remplaçait
   * du même geste TOUTE la propriété, icône du jeu comprise. Un joueur en
   * partie n'avait plus qu'un cadre vide.
   *
   * La couche du dessus passe donc par une variable : le JavaScript la pose,
   * la feuille garde le cadre, et les deux ne se marchent plus dessus.
   */
  assert.match(BUREAU, /v\.style\.setProperty\('--etat',\s*\n\s*"url\('" \+ \(jeu \? voyantUrl\(jeu\) : absenceUrl\(absence\)\) \+ "'\)"\);/);
  assert.match(BUREAU, /v\.style\.removeProperty\('--etat'\);/);
  const habiller = BUREAU.slice(BUREAU.indexOf('function habillerLigneContact'),
    BUREAU.indexOf('function ligneContact'));
  assert.ok(habiller.length > 100, 'la fonction du voyant est toujours là');
  assert.ok(!/backgroundImage/.test(habiller),
    'habillerLigneContact ne doit plus réécrire background-image');
  // La feuille de JOUR porte les deux couches, la variable en tête.
  const jour = lire('public/bureau-frutiz.css');
  assert.match(jour, /\.sl-contact \.voyant \{\s*\n\s*--etat: url\('\/frutiz\/sprites\/sl-presence-0\.svg'\);/);
  assert.match(jour, /background: var\(--etat\) center center \/ 8px 8px no-repeat,\s*\n\s*url\('\/frutiz\/sprites\/sl-icone-fond\.svg'\)/);
  assert.match(jour, /\.sl-contact\.en-ligne \.voyant \{\s*\n\s*--etat: url\('\/frutiz\/sprites\/sl-presence-1\.svg'\);\s*\n\s*\}/);
  // Et celle de NUIT change les deux couches, chacune pour sa variante.
  assert.match(NUIT, /\.sl-contact \.voyant \{\s*\n\s*--etat: url\('\/frutiz\/sprites\/sl-presence-0-nuit\.svg\?v=[0-9a-f]{8}'\);\s*\n\s*background: var\(--etat\)[^\n]*\n\s*url\('\/frutiz\/sprites\/sl-icone-fond-nuit\.svg\?v=[0-9a-f]{8}'\)/);
});

test('la fiche : le bouton du détail reste une commande, la silhouette se lit', () => {
  const sp = (f) => lire('public/frutiz/sprites/' + f);
  // Le bouton ROSE du mode avancé : le filtre le passait au gris — un bouton
  // d'action qui avait l'air éteint. La conversion sait qu'un rose de DESSIN
  // est une commande et lui garde sa clarté.
  for (const f of ['fiche-rose', 'fiche-rose-tri']) {
    const roses = [...sp(f + '-nuit.svg').matchAll(/="(hsl\(325[^"]*)"/g)].map((m) => m[1]);
    assert.ok(roses.length, f + ' doit rester rose : ' + sp(f + '-nuit.svg').slice(0, 200));
  }
  // Le bureau sert la variante, et il n’y a plus de filtre sur cette règle-là.
  assert.match(NUIT, /\.fiche-boite \.fiche-actions \.fiche-avance \{\s*\n\s*background: url\('\/frutiz\/sprites\/fiche-rose-nuit\.svg\?v=[0-9a-f]{8}'\)/);
  assert.match(NUIT, /content: url\('\/frutiz\/sprites\/fiche-rose-tri-nuit\.svg\?v=[0-9a-f]{8}'\);/);
  const retouches = lire('scripts/nuit-retouches.css');
  assert.match(retouches, /\.fiche-actions \.fiche-avance,\s*\n\.fiche-actions \.fiche-avance img \{ filter: none; \}/);
  // LA SILHOUETTE D'UN SIGNE NON RÉVÉLÉ est un noir TRANSLUCIDE : lisible
  // comme une ombre sur le parchemin du jour, invisible sur un panneau de
  // nuit. On la renverse — même silhouette, même sens, mais claire.
  assert.match(retouches, /img\[src\$="\/fb\/signe_mystere\.png"\] \{ filter: invert\(1\) opacity\(\.5\); \}/);
  // Et SEULEMENT elle : un signe révélé est un fruit en couleur.
  assert.ok(!/\.fiche-signes img \{[^}]*filter/.test(NUIT),
    'aucune règle ne renverse les signes révélés');
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

test('aucun dessin de nuit ne dort dans le dossier sans être servi', () => {
  /*
   * LE NOM DU FICHIER EST LA DÉCLARATION — c'est toute la convention, et
   * c'est aussi son seul défaut : un fichier MAL nommé ne produit pas
   * d'erreur, il ne produit RIEN. Déposé sous « background_noel_dark.jpg »
   * plutôt que « background_noel_pixiz_dark.jpg », un paysage de nuit reste
   * sur le disque sans jamais atteindre un écran, et rien ne le dit.
   *
   * Ce test est ce qui le dit : tout `…_dark…` du dossier doit retomber sur
   * le radical d'un fond du catalogue.
   */
  const radicaux = FONDS.map(([u, n]) => radical(u, n));
  const orphelins = fichiersFonds()
    .filter((f) => /_dark(_mobile)?\.[a-z]+$/i.test(f))
    .filter((f) => !radicaux.some((r) => f.startsWith(r + '_dark')));
  assert.deepStrictEqual(orphelins, [],
    'ces dessins de nuit ne correspondent au radical d’aucun fond — ils ne '
    + 'seront jamais servis. Radicaux attendus : ' + radicaux.join(', '));
});

test('trois fonds ont leur dessin de nuit, et la bascule les trouve', () => {
  // Les fichiers du jour d'un côté, ceux de la nuit de l'autre : c'est la
  // même image, et le thème choisit. Aucune liste dans le code — on vérifie
  // donc ici QUE la liste du disque est bien celle qu'on croit.
  const avecNuit = FONDS.filter(([u, n]) => cherche(radical(u, n), '_dark')).map(([u]) => u);
  assert.deepStrictEqual(avecNuit.sort(), ['pixiz', 'pixizchristmas', 'utopiz'],
    'la liste des fonds qui passent en nuit a changé — mettre le README à jour');
  // Et le serveur les annonce comme tels : c'est `etatNuitDuFond` qui le dit
  // à l'admin, et `cadragesDuFond` qui le dit au client.
  assert.match(SERVEUR, /if \(wallpaperNuitUrl\(wp, false\) \|\| wallpaperNuitUrl\(wp, true\)\) return 'variante';/);
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
  assert.equal((SERVEUR.match(/\.\.\.cadragesDuFond\(/g) || []).length, 4,
    'les trois charges utiles du light les portent — et la route des cadrages d’un fond reçu en privé');
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

/* ═══════════════════════════════════════════════════════════════════════════
   L'ENCRE DES FEUTRES, ET L'ARBRE DES RÉGLAGES
   ═══════════════════════════════════════════════════════════════════════════ */

// Les dix-sept feutres, tels que light.html les tient — couleur de jour et
// encre de nuit, dans l'ordre du pot.
const feutresDuLight = () => {
  const bloc = LIGHT.slice(LIGHT.indexOf('var FEUTRES = ['), LIGHT.indexOf('var FEUTRE_BY_INDEX'));
  return [...bloc.matchAll(/\{ i: (\d+),\s*name: "([^"]+)",\s*color: "(#[0-9A-Fa-f]{6})",\s*nuit: "([^"]+)"/g)]
    .map((m) => ({ i: +m[1], nom: m[2], jour: m[3], nuit: m[4] }));
};
const hslNombres = (t) => (/hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%/.exec(t) || []).slice(1).map(Number);
// La luminance d'une couleur écrite en hsl(), par les fonctions du thème.
const lumDe = (t) => GEN.luminance(...GEN.hslVersRgb(...hslNombres(t)));
const rapport = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test('l’encre de nuit des dix-sept feutres se recalcule, elle ne se retouche pas', () => {
  const feutres = feutresDuLight();
  assert.strictEqual(feutres.length, 17, 'les dix-sept feutres portent tous une encre de nuit');
  for (const f of feutres) {
    assert.strictEqual(f.nuit, GEN.encreDeNuit(f.jour),
      f.nom + ' : l’encre de nuit écrite dans light.html ne sort pas de encreDeNuit(' + f.jour + ')');
  }
});

test('chaque feutre garde sa teinte, et aucun ne s’éteint', () => {
  const feutres = feutresDuLight();
  // LA TEINTE EST L'IDENTITÉ DU FEUTRE. On a le droit de l'éclaircir, pas de
  // la déplacer : un « bleu pétrole » qui sort violet n'est plus le feutre
  // qu'on a choisi. (C'est ce que faisait la conversion `texte` du thème, qui
  // ramène tout le châssis — donc tous les verts — sur le violet du parc.)
  for (const f of feutres) {
    const [hJour] = GEN.rgbVersHsl(...GEN.hexVersRgb(f.jour));
    const [hNuit, sNuit, lNuit] = hslNombres(f.nuit);
    assert.ok(Math.abs(Math.round(hJour) - hNuit) <= 1,
      f.nom + ' : la teinte a bougé (' + Math.round(hJour) + '° → ' + hNuit + '°)');
    // On RÉCUPÈRE en saturation ce qu'on prend en clarté : une couleur
    // remontée de trente points sans cela n'est plus qu'un pastel.
    const [, sJour, lJour] = GEN.rgbVersHsl(...GEN.hexVersRgb(f.jour));
    assert.ok(lNuit >= lJour - 0.01, f.nom + ' : l’encre ne descend jamais');
    // (Un feutre déjà saturé à fond — l'orange — n'a plus rien à rendre : la
    // compensation plafonne à 100, et c'est la seule exception.)
    if (lNuit - lJour > 0.5 && sJour < 100) {
      assert.ok(sNuit > sJour, f.nom + ' : remontée sans compensation, elle est délavée');
    }
  }
});

test('les dix-sept encres tiennent le rapport du parc, et restent dix-sept', () => {
  const feutres = feutresDuLight();
  // Le fond : le panneau du chat tel que la feuille de nuit le peint.
  const fond = /^#messages \{\n  background: (hsl\([^)]+\));/m.exec(NUIT);
  assert.ok(fond, 'le panneau du chat de nuit n’a pas été trouvé dans la feuille');
  const lf = lumDe(fond[1]);
  for (const f of feutres) {
    const r = rapport(lumDe(f.nuit), lf);
    assert.ok(r >= 5.4, f.nom + ' : ' + r.toFixed(2) + ':1 sur ' + fond[1] + ', c’est trop peu');
  }
  // ET DIX-SEPT COULEURS, PAS HUIT. C'est l'autre moitié du problème : un pot
  // de feutres où l'orange, le kaki et le vert clair s'écrivent pareil n'est
  // plus un pot de feutres.
  assert.strictEqual(new Set(feutres.map((f) => f.nuit)).size, 17,
    'deux feutres sortent de la même encre');
  // Et pas seulement « différentes au chiffre près » : séparées à l'œil. La
  // distance est celle des trois axes, la teinte comptée au tiers (un degré
  // de teinte se voit moins qu'un point de clarté).
  let pire = { d: Infinity };
  for (let a = 0; a < feutres.length; a++) {
    for (let b = a + 1; b < feutres.length; b++) {
      const A = hslNombres(feutres[a].nuit), B = hslNombres(feutres[b].nuit);
      let dh = Math.abs(A[0] - B[0]); if (dh > 180) dh = 360 - dh;
      const d = Math.hypot(dh / 3, A[1] - B[1], A[2] - B[2]);
      if (d < pire.d) pire = { d, a: feutres[a].nom, b: feutres[b].nom };
    }
  }
  assert.ok(pire.d >= 6, 'les plus proches se confondent : ' + pire.a + ' et ' + pire.b
    + ' (distance ' + pire.d.toFixed(1) + ')');
});

test('tout passe par penColorFor, et la nuit repeint ce qui est déjà écrit', () => {
  // UN SEUL ENTONNOIR. La saisie, les lignes du salon, les pastilles du pot,
  // l'aperçu de la boutique : si l'un d'eux lisait `f.color` en direct, il
  // resterait à l'encre du jour une fois la nuit tombée.
  assert.match(LIGHT, /return \(laNuitEstTombee\(\) && f\.nuit\) \|\| f\.color;/);
  assert.ok(!/FEUTRES\.map\(function \(f\) \{ return f\.color; \}\)/.test(LIGHT),
    'l’arc-en-ciel du multicolore lit encore la couleur de jour');
  assert.match(LIGHT, /sw\.style\.background = penColorFor\(f\.i\);/);
  assert.match(LIGHT, /: \(penColorFor\(it\.feutre\) \|\| "#888888"\);/);

  // LE VERT DU PARC NE DOIT PLUS FUIR DANS LA SAISIE. Sans feutre, le jour
  // écrit dans son vert ; la nuit n'écrit rien et laisse la feuille faire.
  assert.match(LIGHT, /return penColorFor\(pen\) \|\| \(laNuitEstTombee\(\) \? "" : "#2C4A0F"\);/);
  assert.ok(!/penColorFor\([^)]*\) \|\| "#2C4A0F"/.test(LIGHT),
    'une saisie écrit encore le vert du jour en dur');

  // ET LES LIGNES D'AVANT. L'encre est posée en `style=""` : basculer en
  // pleine conversation laissait la moitié du salon à l'encre du jour.
  assert.match(LIGHT, /row\.setAttribute\("data-feutre", String\(o\.feutre\)\);/);
  assert.match(LIGHT, /function repeindreLesEncres\(\)/);
  const bascule = LIGHT.slice(LIGHT.indexOf('function appliquerNuit'),
    LIGHT.indexOf('function appliquerNuit') + 2400);
  assert.match(bascule, /repeindreLesEncres\(\);/,
    'la bascule jour/nuit ne repeint pas les lignes déjà écrites');
});

test('les flèches de pagination sont roses, et ne sont plus fanées', () => {
  const retouches = lire('scripts/nuit-retouches.css');
  const manifeste = lire('scripts/nuit-svg.js');
  for (const f of ['fleche_gauche', 'fleche_droite']) {
    assert.ok(!retouches.includes('/fb/' + f + '.svg'),
      f + ' est encore dans la liste des fanés — le filtre gagnerait sur `filter: none`');
    assert.ok(fs.existsSync(path.join(ROOT, 'public/fb', f + '-nuit.svg')),
      f + ' n’a pas de variante de nuit');
    assert.match(NUIT, new RegExp('img\\[src\\$="/fb/' + f + '\\.svg"\\] \\{ content: url'));
  }
  assert.match(manifeste, /\['fleche_gauche', 'fleche_droite'\]/);
  // Roses de part en part : la conversion garde le rose (`roseDeCommande`),
  // et la variante ne doit contenir ni violet ni gris.
  const svg = lire('public/fb/fleche_droite-nuit.svg');
  for (const c of [...svg.matchAll(/fill="hsl\((\d+) /g)].map((m) => +m[1])) {
    assert.strictEqual(c, GEN.ROSE_NUIT, 'une flèche a une couleur qui n’est pas l’accent');
  }
});

test('l’arbre des réglages du bureau désigne ses cartes par identifiant', () => {
  /*
   * LE PIÈGE DU RANG. « Mes préférences » montre les cartes de `#reg-corps`,
   * et il les désignait par POSITION (`local: 0`). Deux cartes ont été
   * ajoutées depuis en tête de liste — « Mentions », puis « Le parc, la
   * nuit » — et chaque ajout décalait tout l'arbre d'un cran : cliquer
   * « Notifications » ouvrait la carte du voisin, et trois cartes n'étaient
   * plus atteignables du tout.
   */
  assert.ok(!/\{ local: \d+,/.test(BUREAU),
    'une rubrique désigne encore sa carte par son rang');
  const entrees = [...BUREAU.matchAll(/\{ local: '([\w-]+)', label: ("[^"]+"|'[^']+')/g)]
    .map((m) => ({ id: m[1], label: m[2].slice(1, -1) }));
  assert.strictEqual(entrees.length, 5, 'les cinq cartes de l’appareil sont dans l’arbre');
  // Chaque identifiant existe dans le HTML, et porte bien le titre annoncé.
  for (const e of entrees) {
    const i = LIGHT.indexOf('<div class="reg-carte" id="' + e.id + '">');
    assert.ok(i > 0, 'la carte ' + e.id + ' n’existe pas dans light.html');
    const titre = /<div class="reg-titre">([^<]+)</.exec(LIGHT.slice(i, i + 400))[1];
    assert.strictEqual(titre.replace(/&nbsp;/g, ' '), e.label,
      e.id + ' : l’arbre annonce « ' + e.label + ' » et ouvre « ' + titre + ' »');
  }
  // Le mode nuit y est, et il n'est pas rangé sous les notifications.
  const nuit = entrees.find((e) => e.id === 'reg-carte-nuit');
  assert.ok(nuit && nuit.label === 'Le parc, la nuit', 'le mode nuit manque de l’arbre');
  assert.ok(entrees.indexOf(nuit) < entrees.findIndex((e) => e.label === 'Notifications'),
    'le mode nuit doit venir AVANT les notifications, pas dedans');
  // Et c'est bien l'identifiant qui sélectionne la carte affichée.
  assert.match(BUREAU, /cartes\[k\]\.hidden = \(cartes\[k\]\.id !== p\.local\);/);
  // Toutes les cartes du HTML portent un identifiant : sans quoi la suivante
  // qu'on ajoute retombe dans le même piège, invisible depuis le bureau.
  const sansId = [...LIGHT.matchAll(/<div class="reg-carte"(?! id=)/g)];
  assert.strictEqual(sansId.length, 0, sansId.length + ' carte(s) de réglages sans identifiant');
});

/* ═══════════════════════════════════════════════════════════════════════════
   LES NUANCES : LE RELIEF D'UN OBJET, LES RÔLES FORCÉS, LES DÉGRADÉS
   ═══════════════════════════════════════════════════════════════════════════ */

const lireSprite = (f) => lire('public/frutiz/sprites/' + f);
const clartesDe = (svg) => [...svg.matchAll(/hsl\(\d+ \d+% ([\d.]+)%/g)].map((m) => Number(m[1]));

test('le Frusion est un objet : ses clartés gardent leur ordre, sans plafond', () => {
  /*
   * Le boîtier est dessiné en volume : une façade claire (#ffffff, #dddddd),
   * un corps gris (#999999), une cuve et un cerne sombres (#444444). La
   * courbe des sprites RENVERSE la clarté — juste pour une surface, faux pour
   * un objet : le cerne ressortait en liseré clair, la façade en aplat noir,
   * et la cuve plus claire que le boîtier qu'elle creuse. Un négatif, plat.
   */
  const arriere = clartesDe(lireSprite('frusion-arriere-nuit.svg'));   // #444444
  const milieu = clartesDe(lireSprite('frusion-milieu-nuit.svg'));     // #999999 … #dedfde
  const slot = clartesDe(lireSprite('frusion-slot-nuit.svg'));         // #999999 … #ffffff
  assert.ok(arriere.length && milieu.length && slot.length, 'les trois couches sont repeintes');
  // Le cerne reste le plus sombre, la face blanche la plus claire : l'ordre du
  // jour, dans l'échelle de la nuit.
  assert.ok(Math.max(...arriere) < Math.min(...milieu), 'le cerne (#444) reste sous le corps : ' + arriere + ' / ' + milieu);
  assert.ok(Math.max(...slot) > Math.max(...milieu), 'la face blanche du tiroir est ce qu’il y a de plus clair');
  assert.strictEqual(Math.max(...slot), GEN.RELIEF_HAUT, 'le blanc atteint le haut de l’échelle du relief');
  for (const l of [...arriere, ...milieu, ...slot]) {
    assert.ok(l >= GEN.RELIEF_BAS - 0.05 && l <= GEN.RELIEF_HAUT + 0.05, 'hors échelle : ' + l);
  }
  // Et c'est bien la courbe qui le dit : monotone croissante, sans plafond.
  const c = GEN.convertirHsl;
  const blanc = c(255, 255, 255, 1, 'relief').l, gris = c(153, 153, 153, 1, 'relief').l, noir = c(0, 0, 0, 1, 'relief').l;
  assert.ok(blanc > gris && gris > noir, 'la courbe du relief ne renverse pas');
  assert.ok(blanc > 36, 'un objet échappe au plafond des surfaces (' + blanc + ')');
  // Le manifeste le déclare pour le lecteur entier, boutons compris.
  const manifeste = lire('scripts/nuit-svg.js');
  assert.match(manifeste, /\.map\(\(n\) => \(\{ f: n \+ '\.svg', blanc: 'teint', relief: 'garde' \}\)\)/);
  assert.match(manifeste, /troisEtats\('frusionCasque'\)\.map\(\(f\) => \(\{ f, blanc: 'teint', relief: 'garde' \}\)\)/);
  assert.match(manifeste, /troisEtats\('frusionEject'\)\.map\(\(f\) => \(\{ f, blanc: 'teint', relief: 'garde' \}\)\)/);
});

test('un remplissage de barre est un signal, pas un fond : il prend la couleur du NIV', () => {
  // Le rôle est forcé par le sélecteur, et seulement pour le remplissage.
  assert.strictEqual(GEN.roleForce('.enc-progress i::before', 'background'), 'texte');
  assert.strictEqual(GEN.roleForce('body.bureau-frutiz #bureau-coin .enc-progress::after', 'background'), 'texte');
  assert.strictEqual(GEN.roleForce('.fiche-plaque .fa-progress i::before', 'background'), 'texte');
  assert.strictEqual(GEN.roleForce('.enc-progress i', 'background'), null, 'la piste vide reste un fond');
  assert.strictEqual(GEN.roleForce('.enc-progress i::before', 'color'), null);
  // Dans la feuille : la barre pleine porte exactement la couleur de texte du
  // même vert — celle du numéro de niveau —, la piste reste sous le plafond.
  const plein = /body\.bureau-frutiz #bureau-coin \.enc-progress::after \{\s*\n\s*background: repeating-linear-gradient\(to top, (hsl\([^)]+\)) 0 2px/.exec(NUIT);
  assert.ok(plein, 'la règle des barres pleines du bureau est là');
  assert.strictEqual(plein[1], GEN.convertir(...GEN.hexVersRgb('#73B01E'), 'texte'));
  const piste = /body\.bureau-frutiz #bureau-coin \.enc-progress \{\s*\n\s*background:\s*\n\s*repeating-linear-gradient\(to top, hsl\(256 30% ([\d.]+)%\)/.exec(NUIT);
  assert.ok(piste, 'la règle de la piste du bureau est là');
  assert.ok(L(plein[1]) - Number(piste[1]) > 40, 'la barre pleine se détache franchement de la piste');
  // Le mobile et la fiche suivent la même règle.
  assert.match(NUIT, /\.enc-progress i::before \{\s*\n\s*background: hsl\(256 13% 8\d\.\d%\);/);
  assert.match(NUIT, /\.fiche-plaque \.fa-progress i::before \{\s*\n\s*background: hsl\(256 13% 8\d\.\d%\);/);
});

test('les feutres gras du modo et de l’animateur sont des encres : rouge et bleu, lisibles', () => {
  assert.strictEqual(GEN.roleForce('.msg.shout, .msg.shout .body, .msg.shout .from, .msg.shout .time', 'color'), 'encre');
  assert.strictEqual(GEN.roleForce('.msg.blue, .msg.blue .body', 'color'), 'encre');
  assert.strictEqual(GEN.roleForce('body.bureau-frutiz .fen #chat-panel #messages .msg:not(.blue):not(.shout) .from.me', 'color'), null);
  const fond = /^#messages \{\n  background: (hsl\([^)]+\));/m.exec(NUIT)[1];
  const lf = lumDe(fond);
  const cri = /^\.msg\.shout[^{]*\{\s*\n\s*color: (hsl\([^)]+\));/m.exec(NUIT);
  const anim = /^\.msg\.blue[^{]*\{\s*\n\s*color: (hsl\([^)]+\));/m.exec(NUIT);
  assert.ok(cri && anim, 'les deux règles sont dans la feuille');
  // La teinte est l'identité : rouge (0°) et bleu marine (240°), pas la rose
  // du thème ni sa lavande.
  assert.strictEqual(H(cri[1]), 0, 'le cri du modo reste rouge : ' + cri[1]);
  assert.strictEqual(H(anim[1]), 240, 'la ligne de l’animateur reste bleue : ' + anim[1]);
  for (const [nom, c] of [['modo', cri[1]], ['animateur', anim[1]]]) {
    const r = rapport(lumDe(c), lf);
    assert.ok(r >= 5.4, nom + ' : ' + r.toFixed(2) + ':1 sur le panneau, c’est trop peu');
  }
  // Et ils se distinguent du texte ordinaire — pas seulement au gras.
  const ordinaire = /^\.msg \.body \{\s*\n\s*color: (hsl\([^)]+\));/m.exec(NUIT)[1];
  assert.ok(Math.abs(S(cri[1]) - S(ordinaire)) > 40, 'le cri est franchement plus saturé que le texte');
});

test('un dégradé garde sa nuance, et dans le sens du jour', () => {
  // `.ma-btn.primaire` : un bouton bombé, deux verts à quinze points d'écart
  // le jour. Pris un à un, ses deux tons arrivaient tous deux au plafond.
  const m = /^\.ma-btn\.primaire \{[^}]*linear-gradient\(180deg, hsl\(256 30% ([\d.]+)%\), hsl\(256 30% ([\d.]+)%\)\)/m.exec(NUIT);
  assert.ok(m, 'le dégradé du bouton est dans la feuille');
  const [haut, bas] = [Number(m[1]), Number(m[2])];
  assert.ok(haut - bas >= 5, 'le bombé a survécu : ' + haut + ' → ' + bas);
  assert.ok(haut <= 36.05, 'et le ton de tête reste sous le plafond : ' + haut);
  // Le ton de tête ne monte jamais au-dessus de SON plafond, même quand un
  // voisin violet sied plus haut : un cyan ou un jaune atteint la luminance
  // limite bien plus bas.
  const arc = GEN.teindreValeur('linear-gradient(#FF6600, #EBB601, #5EA523, #47B9C9, #472899, #962761)', 'fond');
  for (const c of [...arc.matchAll(/hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%\)/g)]) {
    const lum = GEN.luminance(...GEN.hslVersRgb(Number(c[1]), Number(c[2]), Number(c[3])));
    assert.ok(lum <= 0.08, 'un ton du dégradé passe le plafond : ' + c[0]);
  }
  // Deux couches d'un `background` ne sont pas un dégradé : le lustre blanc
  // d'un panneau ne tire pas sa chair vers le noir.
  const panneau = GEN.teindreValeur('linear-gradient(to bottom, rgba(255,255,255,.64) 0, rgba(255,255,255,0) 8px), #CCF599', 'fond');
  assert.match(panneau, /hsl\(256 30% 25\.8%\)$/, 'la chair du fil est intacte : ' + panneau);
});

test('en privé, le fond de l’autre passe en nuit — et le voile suit la feuille', () => {
  // Le serveur dit les cadrages d'une URL de jour…
  assert.match(SERVEUR, /app\.get\('\/api\/light\/fond\/cadrages', \(req, res\) => \{/);
  assert.match(SERVEUR, /res\.json\(\{ ok: true, url: '\/' \+ url, \.\.\.cadragesDuFond\(url\) \}\);/);
  // …le client les demande une fois par URL et pose le dessin de nuit si le
  // parc est éteint, l'image de jour sinon.
  assert.match(LIGHT, /fetch\("\/api\/light\/fond\/cadrages\?sid=" \+ encodeURIComponent\(state\.sid\)/);
  assert.match(LIGHT, /var src = \(laNuitEstTombee\(\) && c && c\.urlNuit\) \|\| url;/);
  // LE VOILE EST DANS LA FEUILLE. Le JS ne pose que l'opacité : ni couleur en
  // dur (le vert du jour voilait une image de nuit), ni couleur LUE à la
  // bascule (Chrome retraite la feuille de nuit de façon asynchrone).
  assert.match(LIGHT, /fil\.style\.setProperty\("--wp-alpha", String\(alpha \/ 100\)\);/);
  assert.ok(!/--wp-voile/.test(LIGHT), 'plus une couleur de voile posée depuis le JavaScript');
  assert.ok(!/getComputedStyle\(fil\)/.test(LIGHT), 'et rien n’est lu à la bascule');
  assert.match(NUIT, /linear-gradient\(hsl\(256 30% 25\.8% \/ var\(--wp-alpha, \.8\)\), hsl\(256 30% 25\.8% \/ var\(--wp-alpha, \.8\)\)\)/,
    'la feuille de nuit porte le voile à la chair du fil, opacité variable');
  // La bascule repose les fonds déjà reçus.
  assert.match(LIGHT, /fil\.setAttribute\("data-fond-brut", t\);/);
  const bascule = LIGHT.slice(LIGHT.indexOf('function appliquerNuit'), LIGHT.indexOf('function poserNuit'));
  assert.match(bascule, /repeindreLesFondsPrives\(\);/);
  assert.match(LIGHT, /function repeindreLesFondsPrives\(\) \{\s*\n\s*Array\.prototype\.forEach\.call\(document\.querySelectorAll\("\.a-fond-prive\[data-fond-brut\]"\)/);
});
