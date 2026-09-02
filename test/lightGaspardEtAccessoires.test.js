'use strict';
/*
 * DEUX RETOUCHES DU LIGHT
 * ═══════════════════════
 *
 * 1. GASPARD PARLE ENCORE FLASH.
 *
 *    « Quand je clique sur une entrée de l'index, j'ai ce message dans la
 *      console : Failed to launch 'asfunction:win.box.getContent,5' because
 *      the scheme does not have a registered handler. »
 *
 *    Les liens que le portage FABRIQUE (`lienGaspard`) portent `data-gs` et
 *    marchent depuis toujours. Mais le CORPS d'une rubrique est de l'HTML
 *    libre, et celui d'époque — recopié du Frutiparc de 2005 — est truffé de
 *    `<a href="asfunction:win.box.getContent,5">`. `asfunction:` est une
 *    invention du lecteur Flash, qui y voyait un appel de méthode ; un
 *    navigateur n'y voit qu'un schéma d'URL inconnu, refuse la navigation, et
 *    le clic ne fait rien. On traduit donc les appels d'époque vers le
 *    vocabulaire du portage, et l'on neutralise ce qu'on ne sait pas traduire.
 *
 * 2. « RETIRER À TOUS » UN ACCESSOIRE.
 *
 *    « Désactiver » ne retire un article que de la VENTE : ceux qui l'ont
 *    gardent. Il manquait le geste d'après. Et il y a DEUX choses à défaire,
 *    pas une : l'inventaire, et la BOUILLE de ceux qui le portent — les neuf
 *    derniers caractères d'une frutibouille sont son accessoire, et les
 *    laisser ferait porter à un joueur un accessoire absent de son armoire.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');

// La traduction, extraite du fichier et exécutée pour de vrai : une
// vérification par expression régulière ne dirait pas si elle FONCTIONNE.
function traducteur() {
  const debut = BUREAU.indexOf('  function traduireLiensGaspard(html) {');
  assert.ok(debut > 0, 'traduireLiensGaspard existe');
  const fin = BUREAU.indexOf('\n  }', debut) + 4;
  const bac = { echapperGaspard: (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  vm.createContext(bac);
  vm.runInContext(BUREAU.slice(debut, fin) + '\n;this.f = traduireLiensGaspard;', bac);
  return bac.f;
}

test('les liens Flash du corps d’une rubrique deviennent des liens qui marchent', () => {
  const t = traducteur();
  // Les trois appels que l'aide d'époque employait.
  assert.strictEqual(t('<a href="asfunction:win.box.getContent,5">x</a>'),
    '<a href="#" data-gs="5">x</a>');
  assert.strictEqual(t('<a href="asfunction:win.box.getContent">x</a>'),
    '<a href="#" data-gs="index">x</a>');
  assert.strictEqual(t('<a href="asfunction:win.box.getPrevious">x</a>'),
    '<a href="#" data-gs="precedent">x</a>');
  assert.strictEqual(t("<a href='asfunction:win.box.openFrutizInfo,alice'>x</a>"),
    '<a href="#" data-gs-fiche="alice">x</a>');
  // Un appel inconnu est neutralisé plutôt que laissé à la barre d'adresse.
  assert.strictEqual(t('<a href="asfunction:win.box.mystere,1">x</a>'),
    '<a href="#" data-gs-inerte="1">x</a>');
  // Plusieurs liens dans un même corps, et les guillemets simples.
  const plusieurs = t('<p>Voir <a href="asfunction:win.box.getContent,5">A</a> ou '
    + "<a href='asfunction:win.box.getContent,6'>B</a>.</p>");
  assert.ok(plusieurs.indexOf('asfunction') < 0, 'plus aucun asfunction : ' + plusieurs);
  assert.match(plusieurs, /data-gs="5"[\s\S]*data-gs="6"/);
  // Ce qui n'est pas un lien Flash n'est pas touché.
  assert.strictEqual(t('<a href="https://frutiparc.com/">x</a>'),
    '<a href="https://frutiparc.com/">x</a>');
  assert.strictEqual(t('<b>du texte</b>'), '<b>du texte</b>');
  assert.strictEqual(t(null), '');
});

test('le corps traduit est celui qu’on affiche, et rien ne peut plus fuir', () => {
  assert.match(BUREAU, /ligneGaspard\(page, 'gs-corps', traduireLiensGaspard\(o\.corps \|\| ''\)\);/);
  // La fiche d'un joueur s'ouvre, comme le faisait `openFrutizInfo`.
  assert.match(BUREAU, /var f = ev\.target\.closest\('a\[data-gs-fiche\]'\);/);
  assert.match(BUREAU, /ouvrirFiche\(f\.getAttribute\('data-gs-fiche'\)\);/);
  // LE GARDE-FOU : ce qu'on n'a pas su traduire — ou qu'un animateur écrira
  // demain — ne part jamais dans la barre d'adresse.
  assert.match(BUREAU,
    /closest\('a\[data-gs-inerte\], a\[href\^="asfunction:"\], a\[href\^="FSCommand:"\]'\)/);
  assert.match(BUREAU, /if \(mort\) ev\.preventDefault\(\);/);
});

test('« Retirer à tous » reprend l’accessoire ET le retire des têtes', () => {
  const bloc = SERVEUR.slice(SERVEUR.indexOf("app.post('/api/admin/shop/:id/retirer-a-tous'"),
    SERVEUR.indexOf('Moderation word lists'));
  assert.ok(bloc.length > 200, 'la route existe');
  // L'inventaire : c'est la clé de LIGNE qu'attend deleteAccessory, pas
  // l'identifiant logique de l'article (« shop_101 ») que porte `id`.
  assert.match(bloc, /for \(const a of miennes\) await db\.deleteAccessory\(a\.dbRowId\);/);
  // La tête : les neuf derniers caractères de la bouille sont l'accessoire.
  assert.match(bloc, /const RIEN9 = DEFAULT_BOUILLE_STATE\.substring\(15\);/);
  assert.match(bloc, /bouille\.substring\(15\) === pack\.suffix9/);
  assert.match(bloc, /const neuve = bouille\.substring\(0, 15\) \+ RIEN9;/);
  assert.match(bloc, /await db\.updateUser\(row\.username, \{ fbouille: neuve \}\);/);
  // Les fonds d'écran n'ont pas de suffixe : pour eux, seule la ligne part.
  assert.match(bloc, /if \(!pack\.wallpaperId && pack\.suffix9/);
  // Ce qui est en mémoire suit, sinon le joueur connecté garderait l'ancien.
  assert.match(bloc, /users\[row\.username\]\.customAccessories = await db\.getUserAccessories\(row\.id\);/);
  assert.match(bloc, /if \(users\[row\.username\]\) users\[row\.username\]\.fbouille = neuve;/);
  // Et le compte-rendu dit les deux chiffres.
  assert.match(bloc, /res\.json\(\{ ok: true, retires, deshabilles \}\);/);
});

test('le bouton d’admin le dit, et prévient que c’est irréversible', () => {
  assert.match(ADMIN, /onclick="retirerPackTous\(\$\{p\.id\},'\$\{esc\(p\.name\)\}'\)"/);
  assert.match(ADMIN, /async function retirerPackTous\(id, name\) \{/);
  assert.match(ADMIN, /irréversible/);
  // Il ne se confond pas avec « Désactiver », et le dit.
  assert.match(ADMIN, /Pour seulement le retirer de la vente, utilisez « Désactiver »/);
  assert.match(ADMIN, /\/api\/admin\/shop\/\$\{id\}\/retirer-a-tous/);
});
