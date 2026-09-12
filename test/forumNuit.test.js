/*
 * LE FORUM, LA NUIT — ce qui ne se voit pas à l'œil.
 *
 *   · L'ENCRE DES FEUTRES. Un `[color=…]` du BBCode part en `style=""` :
 *     hors de portée de la feuille de nuit. Les feutres foncés du parc y
 *     tombaient sous 1,9 de contraste sur le panneau sombre — illisibles.
 *     Le forum porte donc le calcul du salon (`encreDeNuit`,
 *     scripts/generer-nuit.js) : même teinte, clarté remontée juste assez,
 *     saturation rendue en échange. Ce test RECALCULE les dix-sept encres
 *     avec le générateur et compare à ce que le forum produit : la copie ne
 *     peut pas dériver en silence.
 *   · LES DEUX DOSSIERS DE RUBRIQUE. `folder_big.gif` et `folder_big_new.png`
 *     sont opaques au vert #D6F7B5 : leur plaque courait le long des
 *     rubriques, seule tache de jour dans un forum éteint. Leurs variantes
 *     de nuit sont des PNG SANS FOND, au même gabarit — et la convention
 *     « nom-nuit.<ext> » accepte maintenant une extension différente de
 *     l'originale, parce qu'un GIF ne sait pas porter d'alpha.
 *   · LES DEUX PICTOGRAMMES AU TRAIT. `icon_minipost.gif` (la feuille devant
 *     « Posté le… », « Aperçu », « Sondage ») et `icon_latest_reply.gif` (la
 *     flèche du dernier message) sont noirs sur blanc. Le filtre du châssis
 *     les ASSOMBRIT — c'est son métier — et le noir assombri reste noir : sur
 *     le panneau éteint ils disparaissaient. Leurs variantes sont la table
 *     des 256 gris passée au rôle `sprite` du générateur ; ce test relit les
 *     pixels des PNG et refait le calcul.
 *   · L'INTERRUPTEUR À DISTANCE. Sur le bureau Frutiz le forum s'ouvre dans
 *     une fenêtre de navigateur à lui : le light ne peut plus lui tendre la
 *     feuille. Il écoute donc `storage`, qui prévient les autres documents du
 *     domaine quand le réglage change.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FORUM = lire('public/fb/index.html');
const G = require('../scripts/generer-nuit.js');

// Les dix-sept feutres du parc (light.html, relevés au pixel sur le SWF).
const FEUTRES = ['#FF6600', '#6666CC', '#5EA523', '#962761', '#F986E2', '#EBB601', '#20D251',
  '#47B9C9', '#472899', '#A0752E', '#66451E', '#729236', '#408877', '#5B944B', '#264859',
  '#C8400D', '#6E3C8D'];

/*
 * LE CODE DU FORUM, JOUÉ TEL QUEL. Les fonctions d'encre vivent dans le
 * <script> de la page ; on en découpe le morceau et on l'exécute avec juste
 * ce qu'il demande au navigateur — un élément où poser une couleur, et un
 * getComputedStyle qui la rend. C'est le VRAI code qui est mesuré, pas une
 * transcription.
 */
function encreDuForum() {
  const debut = FORUM.indexOf('var FOND_ENCRE_NUIT');
  const fin = FORUM.indexOf('function renderBBCode');
  assert.ok(debut > 0 && fin > debut, 'le bloc d’encre du forum');
  const source = FORUM.slice(debut, fin);
  const elem = { style: { color: '' } };
  const bac = {
    document: {
      documentElement: { getAttribute: () => '1' },
      createElement: () => elem,
      body: { appendChild() {} },
      querySelectorAll: () => [],
    },
    // Le navigateur normalise « #FF6600 » en « rgb(255, 102, 0) » : ici, à la main.
    getComputedStyle: (el) => ({
      color: (() => {
        const m = /^#([0-9A-Fa-f]{6})$/.exec(el.style.color) || /^#([0-9A-Fa-f]{3})$/.exec(el.style.color);
        if (!m) return 'rgb(0, 0, 0)';
        const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
        return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
      })(),
    }),
    MutationObserver: undefined,
    Math,
  };
  vm.createContext(bac);
  vm.runInContext(source, bac);
  return bac;
}

const hslDe = (t) => (/hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%/.exec(t) || []).slice(1).map(Number);

/*
 * UN PNG, LU AU PIXEL. Les dessins de nuit du forum ne sont pas choisis à la
 * main : ils sortent de la conversion du générateur. Pour le vérifier il faut
 * les rouvrir — d'où ce lecteur minimal (8 bits, couleur vraie + alpha, sans
 * entrelacement : ce qu'écrit un canevas). Le dépaquetage d'un PNG tient en
 * deux gestes, l'inflate et le défiltrage ligne à ligne ; pas de quoi ajouter
 * une dépendance au projet.
 */
function lirePng(rel) {
  const d = fs.readFileSync(path.join(ROOT, rel));
  assert.strictEqual(d.slice(1, 4).toString('latin1'), 'PNG', rel + ' est un PNG');
  let w = 0, h = 0, prof = 0, type = 0, entrelace = 0;
  const morceaux = [];
  for (let i = 8; i + 8 <= d.length;) {
    const n = d.readUInt32BE(i), nom = d.slice(i + 4, i + 8).toString('latin1');
    const corps = d.slice(i + 8, i + 8 + n);
    if (nom === 'IHDR') {
      w = corps.readUInt32BE(0); h = corps.readUInt32BE(4);
      prof = corps[8]; type = corps[9]; entrelace = corps[12];
    } else if (nom === 'IDAT') morceaux.push(corps);
    else if (nom === 'IEND') break;
    i += n + 12;
  }
  assert.deepStrictEqual([prof, type, entrelace], [8, 6, 0], rel + ' : 8 bits, RGBA, non entrelacé');
  const brut = zlib.inflateSync(Buffer.concat(morceaux));
  const px = Buffer.alloc(w * h * 4);
  const pas = w * 4;
  for (let y = 0; y < h; y++) {
    const filtre = brut[y * (pas + 1)];
    const ligne = brut.slice(y * (pas + 1) + 1, (y + 1) * (pas + 1));
    for (let x = 0; x < pas; x++) {
      const a = x >= 4 ? px[y * pas + x - 4] : 0;          // le pixel de gauche
      const b = y > 0 ? px[(y - 1) * pas + x] : 0;         // celui du dessus
      const c = (x >= 4 && y > 0) ? px[(y - 1) * pas + x - 4] : 0;
      let v = ligne[x];
      if (filtre === 1) v += a;
      else if (filtre === 2) v += b;
      else if (filtre === 3) v += (a + b) >> 1;
      else if (filtre === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      px[y * pas + x] = v & 0xff;
    }
  }
  return { w, h, px };
}

// L'encre du texte de nuit : celle dont les pictogrammes au trait sont écrits.
const ENCRE_DU_TRAIT = G.hslVersRgb(...hslDe(G.convertir(0, 0, 0, 1, 'texte'))).map(Math.round);

test('l’encre de nuit du forum est celle du salon, au chiffre près', () => {
  const F = encreDuForum();
  for (const hex of FEUTRES) {
    assert.strictEqual(F.encreDeNuit(hex), G.encreDeNuit(hex), 'feutre ' + hex);
  }
  // Et pour une couleur qui n'est pas du pot : le forum en accepte n'importe
  // laquelle, c'est bien le CALCUL qui est porté, pas une table de dix-sept.
  for (const hex of ['#000000', '#123456', '#7F007F', '#0A0A0A']) {
    assert.strictEqual(F.encreDeNuit(hex), G.encreDeNuit(hex), 'couleur libre ' + hex);
  }
});

test('le fond visé est le panneau du salon de nuit, tel que le générateur le peint', () => {
  const F = encreDuForum();
  // Le panneau du salon, converti par le générateur : c'est cette teinte-là,
  // arrondie comme la feuille l'écrit, que le forum doit viser.
  const attendu = hslDe(G.convertir(...G.hexVersRgb('#CCF599'), 'fond'));
  // Recopié hors du bac à sable : un tableau d'un autre royaume ne se compare
  // pas strictement à un tableau d'ici.
  assert.deepStrictEqual([...F.FOND_ENCRE_NUIT], attendu,
    'FOND_ENCRE_NUIT se régénère, il ne se retouche pas à la main');
});

test('les dix-sept feutres tiennent le rapport sur le panneau du forum, et restent distincts', () => {
  const F = encreDuForum();
  // Le panneau d'un message, la nuit (relevé dans le navigateur) : un peu plus
  // sombre que celui du salon, l'encre y gagne donc du contraste.
  const FOND = [47, 39, 72];
  const lumFond = G.luminance(...FOND);
  const vues = new Set();
  for (const hex of FEUTRES) {
    const rgb = G.hslVersRgb(...hslDe(F.encreDeNuit(hex)));
    const lum = G.luminance(...rgb);
    const ratio = (Math.max(lum, lumFond) + 0.05) / (Math.min(lum, lumFond) + 0.05);
    assert.ok(ratio >= 5.5, hex + ' : ' + ratio.toFixed(2) + ' de contraste');
    const cle = rgb.map(Math.round).join(',');
    assert.ok(!vues.has(cle), hex + ' : deux feutres sortiraient sur ' + cle);
    vues.add(cle);
  }
  // Le noir pur d'un message d'époque devient un gris clair, pas un trou.
  const noir = G.luminance(...G.hslVersRgb(...hslDe(F.encreDeNuit('#000000'))));
  assert.ok((noir + 0.05) / (lumFond + 0.05) >= 5.5, 'le noir pur reste lisible');
});

test('le jour ne bouge pas : la couleur écrite est celle qui sort', () => {
  // `renderBBCode` pose la couleur d'auteur en `style=""` et la garde en
  // `data-encre` ; la nuit n'entre en jeu que si elle est tombée.
  assert.match(FORUM, /data-encre="' \+ col \+ '" style="color:' \+ \(nuit \|\| col\) \+ '"/);
  assert.match(FORUM, /var nuit = laNuitEstTombee\(\) && encreDeNuit\(col\);/);
});

test('basculer la nuit repeint ce qui est déjà écrit', () => {
  // L'encre est en `style=""` : la feuille ne peut rien pour les messages
  // déjà rendus. Le forum écoute donc `data-nuit` — c'est l'attribut que le
  // light lui pose quand le joueur bascule sans recharger la page.
  assert.match(FORUM, /new MutationObserver\(function \(\) \{ repeindreLesEncres\(\); \}\)\.observe\(\s*\n?\s*document\.documentElement, \{ attributes: true, attributeFilter: \['data-nuit'\] \}\)/);
  assert.match(FORUM, /function repeindreLesEncres\(racine\)/);
});

test('un [color=…] ne peut pas glisser une déclaration de plus dans le style', () => {
  const F = encreDuForum();
  for (const bon of ['#abc', '#AABBCC', 'red', 'rebeccapurple']) {
    assert.strictEqual(F.couleurBBCode(bon), bon, bon + ' est une couleur');
  }
  for (const mauvais of ['red;background:url(http://x/y)', '#ab', 'rgb(1,2,3)', 'expression(1)', '', '  ']) {
    assert.strictEqual(F.couleurBBCode(mauvais), null, JSON.stringify(mauvais) + ' est refusé');
  }
});

// ── Les deux dossiers de rubrique ─────────────────────────────────────────

test('les dossiers de rubrique ont leur dessin de nuit, sans fond, au même gabarit', () => {
  for (const [jour, nuit] of [['folder_big.gif', 'folder_big-nuit.png'], ['folder_big_new.png', 'folder_big_new-nuit.png']]) {
    const p = path.join(ROOT, 'public/fb', nuit);
    assert.ok(fs.existsSync(p), nuit + ' manque');
    const d = fs.readFileSync(p);
    assert.strictEqual(d.slice(1, 4).toString('latin1'), 'PNG', nuit + ' est un PNG');
    const i = d.indexOf('IHDR');
    const l = d.readUInt32BE(i + 4), h = d.readUInt32BE(i + 8);
    assert.deepStrictEqual([l, h], [46, 51], nuit + ' garde le gabarit de ' + jour);
    // Couleur vraie + canal alpha : type 6 (RGBA). Sans alpha, la plaque
    // reviendrait — c'est tout l'objet de la variante.
    assert.strictEqual(d[i + 13], 6, nuit + ' porte un canal alpha');
  }
});

test('la feuille de nuit du forum sert les dessins de nuit, sans les éteindre', () => {
  const css = lire('public/fb/nuit.css');
  assert.match(css, /img\[src\$="\/fb\/folder_big\.gif"\] \{ content: url\("\/fb\/folder_big-nuit\.png\?v=[0-9a-f]+"\); filter: none; \}/);
  assert.match(css, /img\[src\$="\/fb\/folder_big_new\.png"\] \{ content: url\("\/fb\/folder_big_new-nuit\.png\?v=[0-9a-f]+"\); filter: none; \}/);
  // Et l'ancien pis-aller a disparu : on n'éteint plus le fruit au filtre.
  assert.doesNotMatch(css, /\.folder-icon \{ filter: var\(--nuit-chassis\); \}/);
});

// ── Les deux pictogrammes au trait ────────────────────────────────────────

test('les pictogrammes du forum sont écrits dans l’encre du texte de nuit, sur rien', () => {
  for (const [nom, l, h] of [['icon_minipost', 12, 9], ['icon_latest_reply', 18, 9]]) {
    const p = lirePng('public/fb/' + nom + '-nuit.png');
    assert.deepStrictEqual([p.w, p.h], [l, h], nom + ' garde le gabarit de son GIF');
    let trait = 0, rien = 0, voile = 0;
    for (let i = 0; i < p.px.length; i += 4) {
      const a = p.px[i + 3];
      if (a === 0) { rien++; continue; }
      // Le canevas travaille en couleurs PRÉMULTIPLIÉES : à alpha 8, tout le
      // voisinage de l'encre retombe sur le même octet, et la couleur relue
      // après division s'en écarte d'autant. C'est donc le produit
      // couleur × alpha — ce que le format garde vraiment — qu'on compare.
      const ecart = Math.max(...ENCRE_DU_TRAIT.map((c, k) =>
        Math.abs(Math.round(p.px[i + k] * a / 255) - Math.round(c * a / 255))));
      assert.ok(ecart <= 1, nom + ' : un pixel à alpha ' + a + ' dérive de ' + ecart);
      if (a >= 250) trait++; else voile++;
    }
    assert.ok(trait > 20, nom + ' : le dessin est là');
    assert.ok(rien > 20, nom + ' : le papier est bien TRANSPARENT — le panneau se voit au travers');
    assert.ok(voile > 0, nom + ' : l’anticrénelage est gardé en alpha');
  }
  // Et ce trait-là se voit partout où le pictogramme se pose : le panneau d'un
  // message, et le bandeau rose d'un sondage.
  for (const [nom, fond] of [['le panneau d’un message', [256, 30, 21.6]], ['le bandeau d’un sondage', [325, 34, 34.6]]]) {
    const l1 = G.luminance(...ENCRE_DU_TRAIT), l2 = G.luminance(...G.hslVersRgb(...fond));
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    assert.ok(ratio >= 4.5, nom + ' : ' + ratio.toFixed(2) + ' seulement');
  }
});

test('la feuille de nuit sert les pictogrammes au lieu de les éteindre au filtre', () => {
  const css = lire('public/fb/nuit.css');
  // Les trois règles qui posent `icon_minipost.gif` en fond — le message,
  // l'aperçu, le sondage — prennent la variante…
  const posés = css.match(/background: url\('\/fb\/icon_minipost-nuit\.png\?v=[0-9a-f]+'\)/g) || [];
  assert.strictEqual(posés.length, 3, 'les trois fonds passent au dessin de nuit');
  // …et perdent le filtre du châssis, qui n'a plus rien à cacher.
  assert.doesNotMatch(css, /\.post-icon \{\n\s*filter: var\(--nuit-chassis\);/);
  assert.doesNotMatch(css, /\.poll-icon \{\n\s*filter: var\(--nuit-chassis\);/);
  assert.match(css, /img\[src\$="\/fb\/icon_latest_reply\.gif"\] \{ content: url\("\/fb\/icon_latest_reply-nuit\.png\?v=[0-9a-f]+"\); filter: none; \}/);
});

// ── La modale de signature ────────────────────────────────────────────────

test('les boutons de la modale de signature prennent le violet du parc, pas un gris de plus', () => {
  // Le forum n'habille pas ces deux boutons-là : ils portent le gris natif du
  // navigateur. La retouche de nuit ne choisit donc pas trois couleurs, elle
  // demande au générateur celles qu'il aurait données au bouton natif.
  const r = lire('scripts/nuit-retouches-forum.css');
  const bloc = r.slice(r.indexOf('.sig-modal .edit-btn'));
  for (const [prop, attendu] of [
    ['background', G.convertir(239, 239, 239, 1, 'fond')],
    ['color', G.convertir(0, 0, 0, 1, 'texte')],
    ['border', '1px solid ' + G.convertir(118, 118, 118, 1, 'bordure')],
  ]) {
    assert.ok(bloc.includes(prop + ': ' + attendu + ';'),
      prop + ' devrait être ' + attendu + ' (le générateur ne se recopie pas à la main)');
  }
  // Et la retouche arrive bien jusqu'à la feuille servie.
  assert.match(lire('public/fb/nuit.css'), /\.sig-modal \.edit-btn \{/);
});

test('le forum éteint donne au navigateur son thème, et aux radios l’accent du choisi', () => {
  // Les pastilles d'un sondage, celles du choix de bouille, les listes que
  // déroulent « Taille », « Couleur » et « Expression » : le navigateur les
  // peint lui-même, pour un thème clair tant qu'on ne lui a rien dit. Sur un
  // téléphone c'est une liste PLEIN ÉCRAN blanche par-dessus un forum éteint.
  const NUIT = lire('public/fb/nuit.css');
  const racine = /\n:root \{([\s\S]*?)\n\}/.exec(NUIT)[1];
  assert.match(racine, /^ {2}color-scheme: dark;$/m);
  // Et nulle part dans le thème de JOUR : la déclaration doit s'en aller avec
  // la feuille quand on rallume. (`prefers-color-scheme` est une requête
  // média, pas la propriété : elle a le droit d'être là.)
  assert.ok(!/(?<!prefers-)color-scheme\s*:/.test(FORUM),
    'public/fb/index.html n’en déclare pas de jour');

  // L'ACCENT. Le forum n'écrit aucun `accent-color` de jour — ses radios sont
  // ceux du navigateur, en bleu —, la conversion n'avait donc rien à teindre.
  // On reprend le rose dont le forum de nuit cerne déjà ce qui est CHOISI :
  // une vignette d'expression sélectionnée et une pastille cochée disent la
  // même chose, elles le disent de la même couleur.
  const accent = /^ {2}accent-color: (hsl\([^)]+\));$/m.exec(racine)[1];
  const choisi = /\.expression-grid \.expr-btn\.active \{[^}]*border-color: (hsl\([^)]+\));/.exec(NUIT);
  assert.ok(choisi, 'la vignette choisie a bien son liseré rose engendré');
  assert.strictEqual(accent, choisi[1]);
  assert.ok(!/accent-color/.test(FORUM), 'et le thème de jour n’en écrit toujours aucun');
});

// ── L'interrupteur, quand le light n'a pas la main ────────────────────────

test('le forum suit le réglage du parc même hors de l’iframe du light', () => {
  // Une fenêtre de navigateur à part (le bureau Frutiz) ou un onglet /fb/
  // ouvert seul : personne au-dessus pour poser `data-nuit`. Le réglage vit
  // dans le même localStorage, et `storage` prévient les autres documents.
  assert.match(FORUM, /window\.addEventListener\("storage", function \(e\) \{\s*\n\s*if \(e\.key && e\.key !== "fp_nuit"\) return;\s*\n\s*appliquer\(choix\(\)\);/);
  // « Comme mon téléphone » suit le système qui bascule le soir.
  assert.match(FORUM, /matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(FORUM, /if \(choix\(\) === "auto"\) appliquer\("auto"\);/);
  // On ne JETTE pas la feuille au retour au jour : « not all » la fait taire.
  assert.match(FORUM, /if \(l\) l\.media = on \? "all" : "not all";/);
});

test('la convention « nom-nuit » accepte une extension différente de l’originale', () => {
  // Un GIF ne sait pas porter d'alpha : le redessin « sans fond » d'un dessin
  // d'époque en GIF est forcément un PNG. Le générateur doit donc apparier
  // `folder_big-nuit.png` à `folder_big.gif`.
  const v = G.variantesNuit();
  assert.strictEqual((v.get('/fb/folder_big.gif') || '').split('?')[0], '/fb/folder_big-nuit.png');
  assert.strictEqual((v.get('/fb/folder_big_new.png') || '').split('?')[0], '/fb/folder_big_new-nuit.png');
});
