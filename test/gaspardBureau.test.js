'use strict';
/*
 * GASPARD — l'icône de l'encart et la fenêtre d'aide.
 *
 * Rien ici n'est inventé : les six noms, l'aiguillage du clic, les deux
 * adresses et la forme de leurs réponses sont écrits dans main.swf, et ce
 * fichier commence par le vérifier — les chaînes sont dans le SWF livré.
 *
 *     initNameList  0xb56c0   Push "jeux","evenements","historique",
 *                             "messages","forum","gaspard", 6 ; InitArray
 *                             → InitArray DÉPILE : l'indice 0 est « gaspard »
 *     select(id)    0x6cdf5   0 → uniqWinMng.open("help")
 *     box.Help      0x7fc9f   loadContent(o) → HTTP("fh/get", o)
 *                             search(s)      → HTTP("fh/search", {s: s})
 *     analyseInput  0x806f3   getTimer() − lastSearchTimer > 2500
 *     onGetContent  0x80396   racine `h` sans attribut `k` ; `i`, `n` ;
 *                             `c` = le corps ; les liens sont les ENFANTS
 *                             d'un `l`, chacun avec `t`, `i`, `n`
 *     onSearch      0x8011f   racine : `n` = le nombre, `m` = la méthode,
 *                             comparée à la seule lettre « e »
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function corpsSwf(chemin) {
  const b = fs.readFileSync(chemin);
  const sig = b.toString('latin1', 0, 3);
  if (sig === 'CWS') return zlib.inflateSync(b.slice(8));
  if (sig === 'FWS') return b.slice(8);
  throw new Error('signature inconnue : ' + sig);
}
const SWF = corpsSwf(path.join(ROOT, 'legacy/main.swf')).toString('latin1');

test('main.swf porte bien les chaînes de l’aide', () => {
  for (const s of ['fh/get', 'fh/search', 'gaspard', 'help.name',
    'help.title', 'help.link_type.', 'help.link_back', 'help.no_result']) {
    assert.ok(SWF.includes(s), 'chaîne absente du SWF : ' + s);
  }
});

test('la rangée de l’encart porte les six noms, gaspard en tête', () => {
  // `nameList` après le retournement d'InitArray, et l'ordre d'affichage —
  // la feuille de style pose les six `order` de 0 à 5.
  const attendu = ['Aide', 'Forum', 'Mail', 'Historique', 'Warning', 'Jeux'];
  attendu.forEach((sc, i) => {
    const re = new RegExp('\\.sc-btn\\[data-sc="' + sc + '"\\] \\{ order: ' + i + '; \\}');
    assert.match(CSS, re, sc + ' doit être en position ' + i);
  });
  // Et les noms d'époque, ceux que le survol écrit dans le champ du rang.
  const m = /var GS_NOMS = \{([\s\S]*?)\};/.exec(JS);
  assert.ok(m, 'la table des noms doit exister');
  assert.match(m[1], /Aide: 'gaspard'/);
  assert.match(m[1], /Warning: 'evenements'/);
  assert.match(m[1], /Mail: 'messages'/);
});

test('l’icône ouvre la fenêtre, et le survol nomme la rubrique', () => {
  const m = /function brancherRangeeEncart\(coin\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(m, 'le câblage de la rangée doit exister');
  const f = m[0];
  // `onPress` → select(id) ; seul l'indice 0 nous concerne ici.
  assert.match(f, /data-sc'\) !== 'Aide'/, 'le clic vise l’icône de l’aide');
  assert.match(f, /ouvrirGaspard\(\)/, 'et il ouvre Gaspard');
  // `onRollOver` → field.text = nameList[id] ; `onRollOut` → ladderPos.
  assert.match(f, /mouseover/);
  assert.match(f, /mouseout/);
  assert.match(f, /enc-trophy \.val/, 'le champ écrit est celui du rang');
});

test('le pas entre deux recherches est celui du bytecode : 2500 ms', () => {
  assert.match(JS, /var GASPARD_ATTENTE = 2500;/);
  const m = /function analyserSaisieGaspard\(brut\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(m, 'analyseInput doit être portée');
  // « rien à envoyer si la saisie est vide », puis le pas, puis la remise à
  // zéro du compteur — et elle n'a lieu QUE si la recherche part.
  assert.match(m[0], /if \(!s\.length\) return false;/);
  assert.match(m[0], /t - gsEtat\.derniere > GASPARD_ATTENTE/);
  assert.match(m[0], /gsEtat\.derniere = t;\s*\n\s*chercherGaspard\(s\);/);
});

test('la pile de retour se remplit avant de partir, et se vide en revenant', () => {
  const avant = /function contenuGaspard\(id\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(avant, /if \(gsEtat\.courant\) gsEtat\.precedents\.push\(gsEtat\.courant\);/);
  const retour = /function pagePrecedenteGaspard\(\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(retour, /if \(!gsEtat\.precedents\.length\) return;/);
  assert.match(retour, /gsEtat\.precedents\.pop\(\)/);
});

test('le client lit la forme d’époque, pas une autre', () => {
  const bloc = (nom) => {
    const d = JS.indexOf('  function ' + nom + '(');
    assert.ok(d >= 0, 'fonction introuvable : ' + nom);
    const f = JS.indexOf('\n  }\n', d);
    return JS.slice(d, f);
  };
  const charge = bloc('chargerGaspard');
  assert.match(charge, /'\/fh\/get'/);
  // La racine : nom `h`, et un `k` veut dire « erreur ».
  assert.match(charge, /h\.nodeName !== 'h'/);
  assert.match(charge, /getAttribute\('k'\)/);
  assert.match(charge, /getAttribute\('i'\)/, 'l’identifiant est dans `i`');
  assert.match(charge, /e\.nodeName === 'c'/, 'le corps est dans `c`');
  assert.match(charge, /e\.nodeName !== 'l'/, 'les liens sont dans `l`');
  assert.match(charge, /getAttribute\('t'\)/, 'et groupés par `t`');

  const cherche = bloc('chercherGaspard');
  assert.match(cherche, /'\/fh\/search'/);
  assert.match(cherche, /Number\(r && r\.getAttribute\('n'\)\)/, 'le nombre est dans `n`');
  assert.match(cherche, /getAttribute\('m'\) \|\| ''\) === 'e'/, 'la méthode se compare à « e »');
  assert.match(cherche, /if \(n === 1 && liste\.length\) return contenuGaspard/,
    'un seul résultat s’ouvre directement');
});

test('le serveur écrit la forme d’époque', () => {
  // fh/get : `i` et non `id`, un conteneur `l`, et chaque lien porte t/i/n.
  assert.match(SERVEUR, /<l t="\$\{groupe\}" i="\$\{c\.id\}" n="\$\{escapeXmlText\(c\.title\)\}"\/>/);
  assert.match(SERVEUR, /const liens = \(dedans\) => \(dedans \? `<l>\$\{dedans\}<\/l>` : ''\);/);
  assert.match(SERVEUR, /<h i="\$\{topic\.id\}" n="\$\{safeTitle\}"/);
  // Et plus aucun conteneur inventé. `cat_tree` et `cat_ls` restent, mais
  // comme NOMS DE GROUPE (l'attribut `t`) : ce ne sont plus des balises. Les
  // commentaires en parlent — on ne relit donc que le CODE.
  const code = SERVEUR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/<\$\{container\}>|<cat_tree>|<cat_ls>/.test(code),
    'les conteneurs `cat_tree`/`cat_ls` ne doivent plus être des balises');
  // fh/search : `n` est un nombre, `m` vaut « e » ou « s ».
  assert.match(SERVEUR, /<r n="\$\{hits\.length\}" m="\$\{mode === 'exact' \? 'e' : 's'\}">/);
  assert.match(SERVEUR, /<e i="\$\{t\.id\}" n="\$\{escapeXmlText\(t\.title\)\}"\/>/);
  assert.ok(!/n="no_result"/.test(SERVEUR),
    '« no_result » passait par Number() et donnait NaN : le vide s’écrit n="0"');
  // L'erreur se dit par l'attribut `k` de la racine.
  assert.match(SERVEUR, /<h k="1" n="Erreur"\/>/);
});

test('la fenêtre est un dialogue, avec la pastille du chat', () => {
  const m = /gaspard:\s*\{[^}]*\}/.exec(JS);
  assert.ok(m, 'la rubrique doit exister');
  // `getIconLabel()` renvoie « winChat » (0x8068a).
  assert.match(m[0], /fruit: 'winChat'/);
  assert.match(m[0], /panneau: '#gaspard-panel'/);
  // `win.Dialog.initMainField` : le champ ne descend pas sous 100 × 100, avec
  // 8 px de marge de chaque côté ; la ligne de saisie prend le reste.
  assert.match(m[0], /min: minFenetre\(100 \+ 16, 100 \+ 16 \+ 24\)/);
  // Ni `pos` ni `centre` : elle se pose dans le coin comme les autres.
  assert.ok(!/centre: true/.test(m[0]), 'elle ne s’ouvre pas au milieu');
});
