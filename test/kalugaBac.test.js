/*
 * KALUGA — LE BAC À SABLE (mode d'essai) et le masque qui ne se refermait pas.
 *
 * Le bac est un mode d'ESSAI du portage : une partie de Challenge dépeuplée,
 * dont l'administration règle la population de départ (décor, tzongre,
 * pommes, papillons, fourmis, vers, écureuils, grenouilles, corbeaux), et où
 * des touches font naître à volonté pendant le jeu. Ce que ces tests
 * verrouillent, ce sont les trois promesses du mode :
 *
 *   • IL NE COMPTE PAS. Aucun score n'est envoyé, la fruticard est verrouillée
 *     le temps de l'essai, et sans score envoyé aucun Fruit Défendu n'est
 *     consommé.
 *   • IL NE PARAÎT QUE SI ON L'OUVRE. Fermé, le menu du jeu n'en montre rien.
 *   • SES TOUCHES NE SE COGNENT PAS À CELLES DU JEU — P et ÉCHAP sont la
 *     pause (Manager.update), elles ne peuvent pas faire naître une pomme.
 *
 * Et le DÉFAUT DE DESSIN que le bac a mis au jour, qui touchait tout le
 * portage : dans un clip, le masque de scénario ne se refermait jamais (son
 * témoin « aucun masque » valait -1, alors que les profondeurs de scénario
 * sont toutes négatives). Le `save` du contexte restait ouvert et tout ce qui
 * se dessinait ensuite partait avec la transformation du clip masqué — la
 * barre de score disparaissait dès qu'une grenouille était à l'écran.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODES = fs.readFileSync(path.join(ROOT, 'public/kaluga/jeu/modes.js'), 'utf8');
const MENU = fs.readFileSync(path.join(ROOT, 'public/kaluga/jeu/menu.js'), 'utf8');
const PLATEFORME = fs.readFileSync(path.join(ROOT, 'public/kaluga/plateforme.js'), 'utf8');
const FLASH = fs.readFileSync(path.join(ROOT, 'public/kaluga/moteur/flash.js'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');

// Le corps de la classe du bac, pour l'interroger seul.
const BAC = /class BacASable extends Classic \{[\s\S]*?\n\}/.exec(MODES);

test('le bac à sable existe, et c\'est un Challenge dépeuplé', () => {
  assert.ok(BAC, 'la classe BacASable doit exister');
  assert.match(MODES, /K\.registerClass\('gameBac', BacASable\);/);
  // Il hérite du Challenge : mêmes classes, mêmes positions, même physique —
  // ce qu'on observe dans le bac est ce qui se passe en partie.
  assert.match(BAC[0], /this\.type = '\$bac';/);
  assert.match(MENU, /case 99: this\.launchGame\('gameBac'/);
});

test('rien de l’essai ne part : ni score, ni fruticard, ni Fruit Défendu', () => {
  // Le type n'est pas $classic : Game.initEndGame ne déclenche donc pas
  // saveScore. Et le bac réécrit initEndGame sans le saveSlot(0) de Game.
  // (On lit le CODE, pas les commentaires, qui nomment ces méthodes.)
  const code = BAC[0].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\.saveScore\(/);
  assert.doesNotMatch(code, /\.saveSlot\(/);
  // Le verrou d'écriture de la fiche, posé à l'entrée et levé à la sortie.
  assert.match(BAC[0], /this\.mng\.client\.lockList\[0\] = true;/);
  assert.match(BAC[0], /this\.mng\.client\.lockList\[0\] = false;/);
  // Le verrou est celui du client d'époque : saveSlot le respecte.
  assert.match(PLATEFORME, /saveSlot\(n\) \{\s*\n\s*if \(this\.lockList\[n\]\) return Promise\.resolve\(false\);/);
});

test('les touches du bac ne touchent pas à la pause du jeu', () => {
  // Manager.update : ÉCHAP (27) et P (80) sont la pause. Une touche du bac
  // qui s'y poserait mettrait la partie en pause en faisant naître.
  const MANAGER = fs.readFileSync(path.join(ROOT, 'public/kaluga/jeu/manager.js'), 'utf8');
  assert.match(MANAGER, /if \(Key\.isDown\(27\) \|\| Key\.isDown\(80\)\)/);
  const table = /const BAC_TOUCHES = \{[\s\S]*?\n\};/.exec(MODES);
  assert.ok(table, 'la table des touches doit exister');
  const codes = (table[0].match(/(\d+): \[/g) || []).map((s) => parseInt(s, 10));
  assert.ok(codes.length >= 13, 'les huit papillons, les deux pommes et les cinq bestioles');
  for (const interdit of [27, 80]) {
    assert.ok(!codes.includes(interdit), 'la touche ' + interdit + ' est la pause du jeu');
  }
  // Les huit papillons sur la rangée des chiffres, les pommes sur 9 et 0.
  for (let i = 0; i < 8; i++) assert.ok(codes.includes(49 + i), 'le papillon ' + (i + 1));
  assert.ok(codes.includes(57) && codes.includes(48), 'la pomme et la pomme d’or');
});

test('l’entrée ne paraît au menu que si l’administration a ouvert le bac', () => {
  assert.match(MENU, /if \(bac && bac\.actif\) this\.menuList\.push\(\{ id: 99, frame: 9, name: 'BAC A SABLE' \}\);/);
  // Son identifiant sort de la plage d'époque (le switch de selectSlot est
  // celui de 2005) et son image de titre est nommée à part : les entrées du
  // SWF prennent la leur de leur identifiant.
  assert.match(MENU, /const image = info\.frame != null \? info\.frame : info\.id \+ 1;/);
  assert.match(PLATEFORME, /chargerBac\(\)/);
  assert.match(PLATEFORME, /\/api\/kaluga\/bac\?sid=/);
});

test('le serveur borne ce que l’administration envoie', () => {
  assert.match(SERVEUR, /app\.get\('\/api\/kaluga\/bac'/);
  assert.match(SERVEUR, /app\.get\('\/api\/admin\/kaluga-bac', adminAuth/);
  assert.match(SERVEUR, /app\.post\('\/api\/admin\/kaluga-bac', adminAuth/);
  // Les décors : seulement les quatre cartes PLATES (les autres défilent ou
  // montent — 10 000 de large pour olympic_a, 2 820 de haut pour squirrel).
  assert.match(SERVEUR, /const KALUGA_BAC_CARTES = \['challenge', 'forest', 'field', 'mordor'\];/);
  // Un bac mal réglé ne doit pas faire naître trois cents fourmis chez un joueur.
  assert.match(SERVEUR, /const KALUGA_BAC_MAX = \d+;/);
  const nettoyage = /function kalugaBacNettoyer\(brut\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(nettoyage, 'le nettoyage des réglages doit exister');
  for (const champ of ['pommes', 'fourmis', 'vers', 'ecureuils', 'grenouilles', 'corbeaux']) {
    assert.match(nettoyage[0], new RegExp(champ + ': n\\(b\\.' + champ + ', KALUGA_BAC_MAX\\)'));
  }
  assert.match(nettoyage[0], /KALUGA_BAC_CARTES\.includes\(String\(b\.carte\)\) \? String\(b\.carte\) : 'challenge'/);
  // L'écran d'administration, et son chargement à l'ouverture de l'onglet.
  assert.match(ADMIN, /id="kalugabac-actif"/);
  assert.match(ADMIN, /async function loadKalugaBac\(\)/);
  assert.match(ADMIN, /loadTournaments\(\); loadSnakeTournoi\(\); loadKalugaBac\(\);/);
});

/*
 * LE MASQUE QUI NE SE REFERMAIT PAS.
 *
 * Les placements d'auteur vivent à p − 16384 : toutes les profondeurs de
 * scénario sont NÉGATIVES. Le témoin « aucun masque en cours » ne peut donc
 * pas être -1 — la comparaison `finMasque >= 0` était toujours fausse, le
 * masque ne se refermait jamais, et le `ctx.save()` restait ouvert.
 */
test('le masque de scénario se referme (témoin non numérique)', () => {
  const dessine = /dessinerContenu\(ctx, a\) \{[\s\S]*?\n  \}/.exec(FLASH);
  assert.ok(dessine, 'dessinerContenu doit exister');
  assert.doesNotMatch(dessine[0], /finMasque >= 0/, 'un témoin négatif ne peut pas être -1');
  assert.match(dessine[0], /let finMasque = null;/);
  assert.match(dessine[0], /if \(finMasque !== null && e\.\$prof > finMasque\) \{ ctx\.restore\(\); finMasque = null; \}/);
  assert.match(dessine[0], /if \(finMasque !== null\) ctx\.restore\(\);/);
  // Et le décalage qui produit ces profondeurs négatives n'a pas bougé.
  assert.match(FLASH, /const DECALAGE_SCENARIO = 16384;/);
});

test('un mode du portage peut s’attacher sans dessin dans le SWF', () => {
  // « gameBac » n'est pas un symbole du SWF : le lecteur doit accepter une
  // classe enregistrée seule, comme un symbole exporté sans image.
  assert.match(FLASH, /if \(id === undefined && !K\.classes\[lien\]\)/);
  assert.match(FLASH, /new K\.classes\[lien\]\(this\.\$biblio, null\)/);
  const KALUGA = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/kaluga/data/kaluga.json'), 'utf8'));
  assert.ok(!KALUGA.symboles.gameBac, 'le SWF ne connaît pas ce mode : il n’est pas d’époque');
});
