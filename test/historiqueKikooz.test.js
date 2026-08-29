'use strict';
/*
 * L'HISTORIQUE KIKOOZ — LE TROISIÈME JOURNAL DU BUREAU.
 *
 * « Ajouter historique kikooz dans la boutique (reproduction fidèle) »
 *
 * ── CE QUE C'EST ──────────────────────────────────────────────────────────
 * `box.KikoozLog` (0x8b46e) n'est pas une page à part : c'est un `win.Log`
 * comme `box.SiteLog` et `box.UserLog`, avec `winType = "winKikoozLog"`, le
 * titre `kikooz_log.title` et sa propre bande d'icônes. On y entre par le
 * petit bouton blanc du haut de la boutique — `butPushSmallWhite` image 20,
 * tipId « shop_kikooz_log », `uniqWinMng.open("kikoozLog")` (0x79fe9).
 *
 * Le bouton existait déjà côté bureau, mais il renvoyait vers le Club dans un
 * onglet du navigateur : le journal n'existait pas.
 *
 * ── CE QU'IL AFFICHE ──────────────────────────────────────────────────────
 * `onLog` (0x8b630) lit le XML de `ft/log` — racine `<l>` — et parcourt les
 * enfants du premier au dernier. Chaque nœud choisit UNE clé de phrase et UN
 * numéro d'image, puis part dans `{ time, content, type }` :
 *
 *   <b n= k= t=/>  kikooz_log.buy        image 20
 *   <c c= k= t=/>  kikooz_log.kcall      image  1
 *   <g f= k= t=/>  kikooz_log.godfather  image 10
 *   <a f= k= t=/>  kikooz_log.anim       image  1
 *
 * Ni tri ni renversement : `setLog(list)` prend la liste telle quelle. Un nœud
 * d'un autre nom est simplement sauté. Liste vide → `displayError` écrit
 * `kikooz_log.empty` à la place.
 *
 * ── LES IMAGES ────────────────────────────────────────────────────────────
 * `win.Log.updatePage` (0x5779d) pose l'icône en `gfxList` sur `linkIco`, à la
 * frame `entry.type`. `box.KikoozLog` pose `linkIco = "icoKikoozLog"`
 * (0x91cab) : le sprite #594, trois frames étiquetées, une forme chacune.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const LANG = fs.readFileSync(path.join(ROOT, 'frutiparc/lang_french.as'), 'latin1');

/* ── 1. LES PHRASES, MOT POUR MOT ─────────────────────────────────────────── */

// La table d'époque est en latin-1 et pleine de caractères accentués : on la
// relit telle quelle et on compare le SQUELETTE (tout sauf les accents), pour
// que le test tienne quel que soit l'encodage du fichier source.
const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\x20-\x7e]/g, '?');

// `kikooz_log.buy` contient des guillemets ÉCHAPPÉS (\" autour de $n) : la
// chaîne ne s'arrête donc pas au premier guillemet venu.
function phraseEpoque(cle) {
  const m = new RegExp('langText\\.kikooz_log\\.' + cle + ' = "((?:[^"\\\\]|\\\\.)*)"').exec(LANG);
  assert.ok(m, 'kikooz_log.' + cle + ' doit exister dans lang_french.as');
  return m[1].replace(/\\"/g, '"');
}

test('les quatre phrases sont celles de la table d’époque', () => {
  // On extrait la table du serveur, on rejoue chaque phrase sur un événement
  // témoin, et on compare au gabarit d'époque une fois ses $-variables
  // substituées de la même façon.
  const bloc = /const LIGHT_KIKOOZ_KINDS = \{[\s\S]*?\n\};/.exec(SERVEUR);
  assert.ok(bloc, 'LIGHT_KIKOOZ_KINDS doit exister');
  const table = {};
  const re = /\n  (\w): \{ type: (\d+),\s+icone: '([^']+)',\s*\n\s*phrase: \(e\) => `([^`]*)` \},/g;
  let m;
  while ((m = re.exec(bloc[0]))) table[m[1]] = { type: Number(m[2]), icone: m[3], gabarit: m[4] };
  assert.deepStrictEqual(Object.keys(table).sort(), ['a', 'b', 'c', 'g']);

  const temoin = { n: 'Bonnet de nuit', k: 60, c: 'zaza', f: 'bibi' };
  const attendu = {
    b: phraseEpoque('buy'), c: phraseEpoque('kcall'),
    g: phraseEpoque('godfather'), a: phraseEpoque('anim'),
  };
  for (const cle of ['b', 'c', 'g', 'a']) {
    // Le gabarit du serveur : `${e.n}` → la valeur témoin.
    const nous = table[cle].gabarit
      .replace(/\$\{e\.n \|\| ''\}/g, temoin.n)
      .replace(/\$\{Number\(e\.k\) \|\| 0\}/g, String(temoin.k))
      .replace(/\$\{e\.c \|\| ''\}/g, temoin.c)
      .replace(/\$\{e\.f \|\| ''\}/g, temoin.f);
    // Celui d'époque : $n, $k, $c, $f → les mêmes.
    const eux = attendu[cle]
      .replace(/\$n/g, temoin.n).replace(/\$k/g, String(temoin.k))
      .replace(/\$c/g, temoin.c).replace(/\$f/g, temoin.f);
    assert.strictEqual(sansAccents(nous), sansAccents(eux),
      'kikooz_log.' + { b: 'buy', c: 'kcall', g: 'godfather', a: 'anim' }[cle]);
  }
});

test('les numéros d’image sont ceux de onLog', () => {
  // 20 l'achat, 1 le kcall, 10 le filleul, 1 encore l'animation.
  assert.match(SERVEUR, /\n  b: \{ type: 20, icone: 'kikooz_buy',/);
  assert.match(SERVEUR, /\n  c: \{ type: 1,  icone: 'kikooz_kcall',/);
  assert.match(SERVEUR, /\n  g: \{ type: 10, icone: 'kikooz_godfather',/);
  // `anim` partage l'image 1 avec `kcall` — d'époque aussi.
  assert.match(SERVEUR, /\n  a: \{ type: 1,  icone: 'kikooz_kcall',/);
});

test('le libellé du vide est celui de la table', () => {
  const m = /langText\.kikooz_log\.empty = "([^"]*)"/.exec(LANG);
  assert.ok(m, 'kikooz_log.empty doit exister');
  const nous = /vide: "([^"]*)",\n    \},\n  \};/.exec(LIGHT);
  assert.ok(nous, 'le libellé du vide du journal kikooz doit exister');
  assert.strictEqual(sansAccents(nous[1]), sansAccents(m[1]));
});

/* ── 2. LES TROIS IMAGES DE LA BANDE #594 ─────────────────────────────────── */

test('les trois icônes d’époque sont dans le dépôt', () => {
  for (const nom of ['kikooz_kcall', 'kikooz_godfather', 'kikooz_buy']) {
    const p = path.join(ROOT, 'public/fb', nom + '.svg');
    assert.ok(fs.existsSync(p), nom + '.svg doit exister');
    const svg = fs.readFileSync(p, 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/,
      nom + ' doit être le SVG sorti du SWF, pas un dessin refait');
    // Sorties de `extract-swf-shapes.js` : elles gardent le repère du SWF,
    // donc un viewBox à origine négative — la preuve qu'on n'a rien retracé.
    assert.match(svg, /viewBox="-\d/, nom + ' doit garder le repère du SWF');
  }
});

test('le serveur nomme le fichier, comme pour les deux autres journaux', () => {
  // `kind` + `kindExt`, la même mécanique que LIGHT_EVENT_KINDS et
  // LIGHT_HISTORY_KINDS : un seul bout décide de la correspondance type→image.
  assert.match(SERVEUR, /kind: d\.icone,\n\s+kindExt: 'svg',/);
  // Et le client ne connaît AUCUNE adresse en dur : il compose /fb/<kind>.<ext>.
  assert.match(LIGHT, /var src = "\/fb\/" \+ \(e\.kind \|\| def\.repli\) \+ "\." \+ \(e\.kindExt \|\| "svg"\);/);
});

/* ── 3. LA ROUTE ──────────────────────────────────────────────────────────── */

test('/api/light/kikooz miroite /ft/log sans le retrier', () => {
  const f = /app\.get\('\/api\/light\/kikooz'[\s\S]*?\n\}\);/.exec(SERVEUR);
  assert.ok(f, 'la route doit exister');
  assert.match(f[0], /const username = resolveUsernameFromSid\(req\.query\.sid \|\| ''\);/);
  assert.match(f[0], /if \(!username\) return res\.status\(401\)\.json\(\{ error: 'auth' \}\);/);
  // Aucun tri : `user.kikoozLog` est déjà rangé du plus récent au plus ancien
  // (unshift), et `setLog` d'époque prend la liste telle qu'elle vient.
  assert.ok(!/\.sort\(/.test(f[0]), 'la route ne doit pas retrier la liste');
  // Un nœud d'un type inconnu est SAUTÉ, comme dans `onLog`.
  assert.match(f[0], /if \(!d\) return null;/);
  assert.match(f[0], /\.filter\(Boolean\)/);
  // Rien n'y est « non lu » : ni voyant, ni trame de poussée.
  assert.match(f[0], /nouveau: false,/);
  assert.match(f[0], /unread: 0/);
});

test('la liste lue est bien celle que /ft/log sert au SWF', () => {
  // Une seule source pour les deux façades — sinon le bureau et le light
  // pourraient diverger sur ce qui s'est passé.
  const f = /app\.get\('\/api\/light\/kikooz'[\s\S]*?\n\}\);/.exec(SERVEUR)[0];
  assert.match(f, /Array\.isArray\(user\.kikoozLog\) \? user\.kikoozLog : \[\]/);
  const xml = /app\.get\('\/ft\/log'[\s\S]*?\n\}\);/.exec(SERVEUR);
  assert.ok(xml, '/ft/log doit exister');
  assert.match(xml[0], /Array\.isArray\(user\.kikoozLog\) \? user\.kikoozLog : \[\]/);
});

/* ── 4. LE PARRAINAGE NOMME LE FILLEUL ────────────────────────────────────── */

test('le parrain reçoit un nœud <g> qui NOMME son filleul', () => {
  // Le nœud `g` — « $k kikooz obtenus grâce à votre filleul $f » — n'était
  // jamais produit : les deux côtés du parrainage étaient écrits en
  // `<c c="parrainage">`, et le parrain ne savait pas LEQUEL de ses filleuls
  // venait de passer le palier.
  const f = /function grantReferralReward\(username, role, filleul\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'grantReferralReward doit prendre le filleul');
  assert.match(f[0], /\{ type: 'g', t: quand, k: REFERRAL\.kikooz, f: getDisplayName\(filleul\) \}/);
  // Le FILLEUL, lui, garde `c` : il n'a pas de filleul à nommer.
  assert.match(f[0], /\{ type: 'c', t: quand, k: REFERRAL\.kikooz, c: 'parrainage' \}/);
  // Les deux points d'appel passent le nom, et seulement pour le parrain.
  assert.match(SERVEUR, /grantReferralReward\(filleulName, 'Filleul'\);\n\s+if \(parrain\) grantReferralReward\(parrainName, 'Parrain', filleulName\);/);
  assert.match(SERVEUR, /if \(parrain\) grantReferralReward\(u\.referredBy, 'Parrain', username\);/);
});

/* ── 5. LE JOURNAL CÔTÉ LIGHT ─────────────────────────────────────────────── */

test('le troisième journal est déclaré comme les deux autres', () => {
  const f = /kikoozlog: \{[\s\S]*?\n    \},/.exec(LIGHT);
  assert.ok(f, 'JOURNAUX.kikoozlog doit exister');
  assert.match(f[0], /titre: "Historique Kikooz", route: "kikooz", raccourci: null/);
  // Le repli est l'image 1 de la bande, pas celle d'un autre journal.
  assert.match(f[0], /repli: "kikooz_kcall"/);
  assert.match(LIGHT, /kikoozlog:  \{ nonLus: 0, liste: \[\], charge: false, page: 0 \}/);
});

test('la table des journaux décide, on ne réénumère pas les clés', () => {
  // #evt-panel sert les TROIS : ajouter un quatrième journal ne doit pas
  // demander de retoucher `activateTab` en deux endroits.
  assert.match(LIGHT, /\$\("#evt-panel"\)\.classList\.toggle\("active", !!JOURNAUX\[tab\]\);/);
  assert.match(LIGHT, /if \(JOURNAUX\[tab\]\) loadJournal\(tab\);/);
});

test('l’Historique Kikooz n’allume rien et ne se sonde pas', () => {
  // Pas de raccourci sur le bureau : `setJournalNonLus` ne doit pas appeler
  // `majVoyant(null, …)`.
  assert.match(LIGHT, /if \(JOURNAUX\[cle\]\.raccourci\) majVoyant\(JOURNAUX\[cle\]\.raccourci, v\);/);
  // Et il ne coûte pas une requête de plus à chaque reconnexion : il se charge
  // quand on l'ouvre.
  const f = /function rafraichirCompteursJournaux\(\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(f, 'rafraichirCompteursJournaux doit exister');
  assert.match(f[0], /if \(JOURNAUX\[cle\]\.raccourci\) rafraichirCompteurJournal\(cle\);/);
});

/* ── 6. LA FENÊTRE DU BUREAU ──────────────────────────────────────────────── */

test('la fenêtre est celle de win.Log — même panneau, même gabarit', () => {
  const f = /kikoozlog:  \{[\s\S]*?min: minFenetre\(300, 200\) \},/.exec(JS);
  assert.ok(f, 'RUBRIQUES.kikoozlog doit exister');
  assert.match(f[0], /panneau: '#evt-panel'/);
  assert.match(f[0], /titre: 'Historique Kikooz'/);
  // 314 × 246 comme les deux autres journaux, et `win.Log.init` pose
  // `flResizable = false`.
  assert.match(f[0], /l: 314, h: 246, fixe: true/);
});

test('le bouton blanc de la boutique passe par activateTab', () => {
  // `ouvrirFenetre` seul montrerait le panneau du journal PRÉCÉDENT : c'est
  // `activateTab` qui déclenche `loadJournal` avant de rendre la main à
  // `apresActivateTab`.
  const f = /\[\['shop-ico-journal'[\s\S]*?\}\], \['shop-ico-kikooz'/.exec(JS);
  assert.ok(f, 'le premier bouton blanc doit exister');
  assert.match(f[0], /'shop-ico-journal', 'Historique Kikooz'/);
  assert.match(f[0], /if \(window\.activateTab\) window\.activateTab\('kikoozlog'\);/);
  assert.match(f[0], /else ouvrirFenetre\('kikoozlog'\);/);
  // Il ne renvoie plus vers le Club dans un onglet du navigateur.
  assert.ok(!/'shop-ico-journal'[\s\S]{0,200}window\.open\('\/club\//.test(JS));
});
