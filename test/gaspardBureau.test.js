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
  // LE GABARIT NE S'ÉCRIT PAS DANS LA RUBRIQUE. `win.Help` ne pose ni `pos`
  // ni `moveToCenter` : `recal` en fait le minimum de son contenu, comme pour
  // une conversation neuve. (Le portage avait d'abord écrit
  // `minFenetre(100 + 16, …)`, hérité de `win.Dialog.initMainField` — mais
  // `win.Help` RÉÉCRIT cette méthode, cf. 0xbddd9 : son champ ne descend pas
  // sous 200 × 200, pas 100 × 100.)
  assert.match(m[0], /min: function \(\) \{ return minGaspard\(\); \}/);
  assert.ok(!/centre: true/.test(m[0]), 'elle ne s’ouvre pas au milieu');
});

/*
 * L'ÉCORCE DE DIALOGUE. `win.Help` (0xbd7db) étend `win.Dialog` : ce sont les
 * mêmes cadres que ceux d'un salon, et les mesures sortent du bytecode.
 */
test('la colonne d’icônes porte les deux gélules du bytecode', () => {
  // `genLeftIconList` (0xbd8bc) : DEUX `butPush` de param `butPushSmallPink`,
  // image 3 → toggleScreenList, image 2 → toggleUserList. Ce sont les mêmes
  // dessins que les 3e et 2e gélules du salon.
  const p = /function panneauGaspard\(\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(p, 'le panneau doit exister');
  assert.match(p[0], /gelule\('ecrans'/, 'la gélule des bouilles');
  assert.match(p[0], /gelule\('users'/, 'la gélule des présents');
  // …et DEUX seulement : ni feutres ni cri modérateur, `win.Help` n'en a pas.
  assert.strictEqual((p[0].match(/gelule\(/g) || []).length, 2,
    'deux gélules, pas quatre');
  assert.match(CSS, /\.gs-but-ecrans \{\s*background-image: url\('\/frutiz\/sprites\/chat-but-bouille\.svg'\)/);
  assert.match(CSS, /\.gs-but-users \{\s*background-image: url\('\/frutiz\/sprites\/chat-but-userlist\.svg'\)/);
  // Le PAS d'une gélule : `lefIconListHMaxThin = 4 + 26 × len`.
  assert.match(JS, /var GS_ICONE = 26;/);
});

test('les deux panneaux s’ouvrent fermés, et relèvent le minimum', () => {
  // `win.Help.init` (0xbd840) commence par `flUserList = false` et
  // `flScreenList = false` : la fenêtre naît nue, comme une conversation.
  const p = /function panneauGaspard\(\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.ok(!/gs-a-ecrans|gs-a-users/.test(p),
    'aucun des deux panneaux n’est ouvert à la construction');
  const b = /function basculerPanneauGaspard\(quoi\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(b, 'les deux bascules doivent exister');
  // `toggleScreenList` couche la colonne (`lefIconListHMaxLarge`) ; les deux
  // finissent par `frameSet.update()`, qui relève le minimum de la fenêtre.
  assert.match(b[0], /classList\.toggle\('en-rangee', ouvert\)/);
  assert.match(b[0], /appliquerMinimum\(f\)/);
  // Le minimum, cadre par cadre — les mins sont ceux du bytecode.
  const min = /function minGaspard\(\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(min, 'minGaspard doit exister');
  assert.match(min[0], /ecrans \? 112 : 32/, 'cpScreenList 100 + 12 de marge, sinon la colonne (32)');
  assert.match(min[0], /w: 200, h: 200 \+ 6 \+ 14/, 'showFrame 200×200, saisie 14 + 6 de marge');
  assert.match(min[0], /users \? 134 : 0/, 'cpUserList 122 + 12 de marge');
});

test('les présents sont deux : le joueur, puis Gaspard', () => {
  // `box.Help.init` (0x7fdf6) :
  //     if (me.logged) userList.addUser(me.name);
  //     userList.addUser(Lang.fv("help.name"));
  const g = /function gensDeGaspard\(\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(g, 'la liste des deux noms doit exister');
  assert.match(g[0], /if \(moi\) gens\.push\(moi\);/, 'le joueur seulement s’il est identifié');
  assert.match(g[0], /gens\.push\(GS_MOTS\.nom\);/, 'puis Gaspard, toujours');
  // Et c'est la bande `userSlot` du salon, pas une tuile inventée.
  assert.match(CSS, /#gaspard-panel \.gs-ul-defile \.u \{[\s\S]*?user-slot\.svg/);
  assert.match(CSS, /#gaspard-panel \.gs-ul-defile \.u:nth-child\(even\) \{ background-image: none; \}/);
});

test('les mots sont ceux de lang_french.as, pas des inventions', () => {
  const m = /var GS_MOTS = \{[\s\S]*?\n  \};/.exec(JS);
  assert.ok(m, 'la table des mots doit exister');
  // help.link_type.* — le portage avait inventé « Voir aussi » et « Les
  // rubriques », qui n'existent nulle part.
  assert.match(m[0], /cat_tree: 'Rubriques :'/);
  assert.match(m[0], /cat_ls: 'Dans cette rubrique :'/);
  assert.match(m[0], /seealso: 'Voir également :'/);
  assert.ok(!/Voir aussi|Les rubriques/.test(m[0]),
    'les libellés inventés doivent avoir disparu');
  // please_wait, et les deux phrases de résultat avec leur $n.
  assert.match(m[0], /attente: 'Veuillez patienter\.\.\.'/);
  assert.match(m[0], /e: 'J’ai trouvé \$n résultats correspondants à votre recherche :'/);
  assert.match(m[0], /s: 'J’ai trouvé \$n résultats proches de votre recherche :'/);
  // help.link_back : DEUX liens, `getPrevious` et `getContent` sans argument.
  assert.match(JS, /var GS_RETOUR = '<a href="#" data-gs="precedent">Précédent<\/a> - '/);
  assert.match(JS, /data-gs="index">Index de l’aide<\/a>/);
  // `getContent()` sans argument vaut `getContent(1)` (0x7ff27).
  const c = /function contenuGaspard\(id\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(c, /if \(id === undefined\) id = 1;/);
});

test('la page porte les encres de `frSheet`, et les liens celles du styleSheet', () => {
  // Standard.getDocStyle(frSheet) : color = [green, green, pink] →
  //   s[0] green.darkest #558811 · s[2] green.overdark #335511 (12 gras)
  //   s[4] pink.darkest  #852929 (15 gras)
  assert.match(CSS, /#gaspard-panel \.gs-page \{[\s\S]*?color: #558811;/);
  assert.match(CSS, /#gaspard-panel \.gs-titre \{[\s\S]*?color: #852929;/);
  assert.match(CSS, /#gaspard-panel \.gs-groupe \{[\s\S]*?color: #335511;/);
  // Standard.getStyleSheet() : `a:link` #344D67, souligné au SURVOL seulement.
  assert.match(CSS, /#gaspard-panel \.gs-l a \{ color: #344D67; text-decoration: none; \}/);
  assert.match(CSS, /#gaspard-panel \.gs-l a:hover \{ text-decoration: underline; \}/);
  // Et la chair du composant, la même qu'au salon : #CCF599 dans un liseré
  // #ADE76B, cerclé de #DDDDDD hors boîte.
  const page = /#gaspard-panel \.gs-page \{[\s\S]*?\n\}/.exec(CSS)[0];
  assert.match(page, /#CCF599/);
  assert.match(page, /border: 2px solid #ADE76B/);
  assert.match(page, /box-shadow: 0 0 0 2px #DDDDDD/);
  // La ligne de saisie, c'est `inputField` (#170) : 14 de haut, #EEEEEE,
  // arête #CCCCCC — le même dessin qu'au salon.
  const saisie = /#gaspard-panel \.gs-in \{[\s\S]*?\n\}/.exec(CSS)[0];
  assert.match(saisie, /height: 14px/);
  assert.match(saisie, /background: #EEEEEE/);
  assert.match(saisie, /box-shadow: inset 0 1px 0 #CCCCCC/);
});

test('rouvrir la fenêtre bâtit une boîte NEUVE', () => {
  // `box.Help.close` fait `uniqWinMng.unsetBox("help")` : la boîte s'en va
  // tout entière. Rouvrir en construit une autre — `previousArr = []`,
  // `lastSearchTimer = 0`, `flUserList` et `flScreenList` à faux — et son
  // `init` recharge `{i: 1}`. (Relevé au banc : 454 × 270 avec les deux
  // panneaux et une page fille, puis 240 × 248 et « Gaspard - Bienvenue »
  // après fermeture-réouverture.)
  const o = /function ouvrirGaspard\(\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(o, 'ouvrirGaspard doit exister');
  assert.match(o[0], /gsEtat\.precedents = \[\];/);
  assert.match(o[0], /gsEtat\.derniere = 0;/);
  assert.match(o[0], /\['gs-a-ecrans', 'gs-a-users'\]\.forEach/);
  // …et le chargement passe par `loadContent`, pas `getContent` : l'index
  // n'est pas un « précédent » de lui-même.
  assert.match(o[0], /chargerGaspard\(\{ i: 1 \}\)/);
  assert.ok(!/contenuGaspard\(1\)/.test(o[0]),
    'passer par getContent empilerait la page d’accueil dans sa propre pile');
});

test('une panne du serveur ouvre une alerte, pas une ligne dans la page', () => {
  // `onGetContent` / `onSearch` (0x803c3, 0x8014c) : `openErrorAlert(
  // Lang.fv("error.host_unreachable"))`, et pour un `k` renvoyé,
  // `Lang.fv("error.http." + k)`.
  const e = /function erreurGaspard\(txt\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(e, 'le chemin d’erreur doit exister');
  assert.match(e[0], /alerte\('', txt\)/);
  const m = /var GS_ERREURS = \{[\s\S]*?\n  \};/.exec(JS);
  assert.ok(m, 'les motifs `error.http.<k>` doivent être portés');
  assert.match(m[0], /2: 'Action non autorisée'/);
  assert.match(m[0], /3: 'Requête non valide'/);
  const charge = /function chargerGaspard\(o\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(charge, /GS_ERREURS\[k\] \|\| GS_ERREURS\[1\]/);
});
