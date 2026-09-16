/*
 * TROIS PAYS DE PLUS SUR LA FICHE : Maroc, Pays-Bas, Royaume-Uni.
 *
 * La table <ct> de public/xml/lang_french.xml n'offrait que cinq pays — ceux
 * de 2005 : France, Belgique, Luxembourg, Canada, Suisse. Des joueurs
 * demandaient les leurs. On prolonge donc la table, aux trois index libres qui
 * suivent (6, 7, 8), avec le découpage régional de chacun.
 *
 * UN SEUL RÉFÉRENTIEL, ET C'EST LUI. Le bureau comme le mobile ne gardent que
 * des index (`countryIndex` / `regionIndex`) et lisent les noms ici : la fiche,
 * la bulle de survol des salons, les deux menus de la recherche avancée et le
 * formulaire « modifier ma fiche » sortent tous de cette table. Ajouter un pays
 * n'est donc qu'une entrée de plus — sauf pour UNE chose, le drapeau du listing
 * de recherche, qui est une image et pas un nom.
 *
 * L'ORDRE EST LA DONNÉE. L'index EST ce qui est stocké dans le compte : les
 * nouveaux pays s'AJOUTENT à la fin, jamais au milieu — intercaler le Maroc
 * entre la Belgique et le Luxembourg déplacerait tous les Luxembourgeois au
 * Canada. Le tableau des drapeaux suit le même ordre, et son repli « ot » y
 * reste en dernier.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const XML = lire('public/xml/lang_french.xml');
const BUREAU = lire('public/bureau-frutiz.js');

/** La table <ct>, lue comme le serveur la lit (tablePays). */
function tablePays() {
  const bloc = /<ct>([\s\S]*?)<\/ct>/.exec(XML);
  assert.ok(bloc, 'le bloc <ct>');
  const out = [];
  const reC = /<c c="([^"]*)" n="([^"]*)"([^>]*)>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = reC.exec(bloc[1])) !== null) {
    const regions = [];
    const reR = /<r c="([^"]*)">([^<]*)<\/r>/g;
    let r;
    while ((r = reR.exec(m[4])) !== null) regions.push({ code: r[1], nom: r[2] });
    const tn = /\btn="([^"]*)"/.exec(m[3]);
    const dc = /\bd="([^"]*)"/.exec(m[3]);
    out.push({
      code: m[1], nom: m[2], regions,
      nomRegion: tn ? tn[1] : '',
      afficherCode: !!(dc && dc[1] === '1'),
    });
  }
  return out;
}

test('les cinq pays d’origine n’ont pas bougé d’un index', () => {
  const t = tablePays();
  assert.deepStrictEqual(t.slice(0, 5).map((c) => [c.code, c.nom]),
    [['1', 'France'], ['2', 'Belgique'], ['3', 'Luxembourg'], ['4', 'Canada'], ['5', 'Suisse']],
    'l’index est ce qui est stocké dans les comptes : il ne se renumérote pas');
  // Et leurs découpages non plus : la France garde ses cent-un départements.
  assert.strictEqual(t[0].regions.length, 101);
  assert.ok(t[0].regions.some((r) => r.code === '94' && r.nom === 'Val-de-Marne'));
});

test('les trois nouveaux pays sont là, avec leur découpage', () => {
  const t = tablePays();
  const par = Object.fromEntries(t.map((c) => [c.nom, c]));

  const maroc = par['Maroc'];
  assert.ok(maroc, 'le Maroc');
  assert.strictEqual(maroc.code, '6');
  assert.strictEqual(maroc.regions.length, 12, 'les douze régions du découpage de 2015');
  assert.strictEqual(maroc.regions[0].nom, 'Tanger-Tétouan-Al Hoceïma');
  assert.ok(maroc.regions.some((r) => r.nom === 'Casablanca-Settat'));
  assert.ok(maroc.regions.some((r) => r.nom === 'Dakhla-Oued Ed-Dahab'));

  const nl = par['Pays-Bas'];
  assert.ok(nl, 'les Pays-Bas');
  assert.strictEqual(nl.code, '7');
  assert.strictEqual(nl.regions.length, 12, 'les douze provinces');
  assert.ok(nl.regions.some((r) => r.nom === 'Hollande-Septentrionale'));
  assert.ok(nl.regions.some((r) => r.nom === 'Zélande'));

  const uk = par['Royaume-Uni'];
  assert.ok(uk, 'le Royaume-Uni');
  assert.strictEqual(uk.code, '8');
  assert.deepStrictEqual(uk.regions.map((r) => r.nom),
    ['Angleterre', 'Écosse', 'Pays de Galles', 'Irlande du Nord'], 'les quatre nations');
});

test('leurs régions se nomment en toutes lettres, sans code devant', () => {
  const t = tablePays();
  for (const nom of ['Maroc', 'Pays-Bas', 'Royaume-Uni']) {
    const c = t.find((x) => x.nom === nom);
    // `tn` titre le menu des régions (« Tout(e) $n… ») : les pays de 2005 y
    // portent leur code de pays (« Tout(e) be… »), ce qu'on n'imite pas —
    // c'était une donnée bâclée, pas une règle.
    assert.ok(/^(région|province|nation)$/.test(c.nomRegion),
      nom + ' : le découpage se nomme (« ' + c.nomRegion + ' »)');
    // `d="1"` préfixe chaque entrée de son code (« 01 - Ain », utile pour un
    // département) : sur une province numérotée à partir de zéro, cela donne
    // « 0 - Drenthe ». On s'en passe.
    assert.strictEqual(c.afficherCode, false, nom + ' : pas de code devant le nom');
    // Les codes partent de zéro et se suivent, comme les autres pays courts.
    assert.deepStrictEqual(c.regions.map((r) => r.code),
      c.regions.map((r, i) => String(i)), nom + ' : des codes qui se suivent');
  }
});

test('chaque pays de la table a son drapeau, et « ot » ferme la marche', () => {
  const t = tablePays();
  const d = BUREAU.slice(BUREAU.indexOf('var RC_DRAPEAUX ='), BUREAU.indexOf('var rcPanneau = null;'));
  const codes = JSON.parse(/var RC_DRAPEAUX = (\[[^\]]*\]);/.exec(d)[1].replace(/'/g, '"'));
  assert.strictEqual(codes.length, t.length + 1,
    'un drapeau par pays, plus le repli — ' + codes.length + ' pour ' + t.length + ' pays');
  assert.strictEqual(codes[codes.length - 1], 'ot', '« ot » en dernier : c’est le repli du borneur');
  for (const c of codes) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/frutiz/sprites/recherche-pays-' + c + '.svg')),
      'recherche-pays-' + c + '.svg manque');
  }

  // Le borneur du listing, tel qu'il tourne : chaque index de la table tombe
  // sur SON drapeau, et tout ce qui déborde sur « ot ».
  const drapeauDe = new Function('RC_DRAPEAUX', 'return '
    + /function drapeauDe\(co\) \{[\s\S]*?\n  \}/.exec(BUREAU)[0]
      .replace('function drapeauDe(co) {', 'function drapeauDe(co) {') + ';')(codes);
  t.forEach((c, i) => assert.strictEqual(drapeauDe(c.code), codes[i], c.nom));
  assert.strictEqual(drapeauDe('6'), 'mo', 'le Maroc');
  assert.strictEqual(drapeauDe('7'), 'nl', 'les Pays-Bas');
  assert.strictEqual(drapeauDe('8'), 'uk', 'le Royaume-Uni');
  assert.strictEqual(drapeauDe(String(t.length + 1)), 'ot', 'au-delà du dernier pays : le repli');
  assert.strictEqual(drapeauDe(''), 'ot', 'un code vide aussi');
  assert.strictEqual(drapeauDe('0'), 'fr', 'au-dessous de 1, Flash reste sur la France');
});

test('les trois drapeaux ont le gabarit des six autres', () => {
  const D = path.join(ROOT, 'public/frutiz/sprites');
  for (const c of ['mo', 'nl', 'uk']) {
    const svg = fs.readFileSync(path.join(D, 'recherche-pays-' + c + '.svg'), 'utf8');
    // `countryBox` fait 16 × 16 et son dessin part de (1, 1) : c'est ce cadre
    // que la CSS du listing place, pas une taille libre.
    assert.match(svg, /viewBox="1 1 16 16"/, c + ' : le cadre de countryBox');
    assert.match(svg, /width="16"/, c);
    assert.match(svg, /height="16"/, c);
    // Le liseré gris des six d'origine (#dddddd, `global.color[0].shade`) :
    // sans lui, un drapeau clair se perdrait sur le fond de l'entrée.
    assert.match(svg, /#dddddd/i, c + ' : le liseré du listing');
  }
});
