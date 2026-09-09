/*
 * KALUGA — LES ÉPREUVES, et l'accessoire qui se gagne.
 *
 * Un mode qui n'est pas de 2005 : trois niveaux chronométrés où l'on ne
 * compte pas des points mais des FIGURES — les combos que le panier nomme
 * déjà. Ce que ces tests verrouillent, ce sont les promesses du mode :
 *
 *   • LES TROIS RÈGLES sont celles demandées : dix dunks en une minute, dix
 *     granites en une minute trente, puis la liste du difficile — et le poids
 *     des pommes est borné entre 80 et 230 sur les deux niveaux à granites,
 *     sans quoi le granite tient de la chance.
 *   • UNE FIGURE, UNE CASE : une pomme coche au plus un objectif, le plus
 *     exigeant de ceux qu'elle satisfait encore. Sans cela un triple-impact —
 *     qui est une double-bande plus une tête — en cocherait deux d'un coup.
 *   • LE MODE ENTEND LES FIGURES. `checkCombo` ne tourne que sous le
 *     Challenge, qui seul compte des points : le crochet doit donc vivre dans
 *     `Panier.addFruit`, pas dedans, sinon les Épreuves ne voient rien.
 *   • RIEN NE PART AU CLASSEMENT : le type n'est pas `$classic`, donc pas de
 *     score envoyé, donc pas de Fruit Défendu consommé.
 *   • L'ACCESSOIRE EST ACCORDÉ PAR LE SERVEUR, une fois, et c'est un ARTICLE
 *     DE BOUTIQUE ordinaire (`shopId`) : l'admin le dessine, le renomme ou le
 *     retire, et la possession, l'essai et la revente marchent sans un mot de
 *     plus. L'article absent ne casse pas la partie gagnée.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MODES = lire('public/kaluga/jeu/modes.js');
const MENU = lire('public/kaluga/jeu/menu.js');
const MANAGER = lire('public/kaluga/jeu/manager.js');
const SPRITES = lire('public/kaluga/jeu/sprites.js');
const PLATEFORME = lire('public/kaluga/plateforme.js');
const SERVEUR = lire('server.js');

const DEFI = /class Defi extends J\.Game \{[\s\S]*?\n\}/.exec(MODES);
const NIVEAUX = /const DEFI_NIVEAUX = \[[\s\S]*?\n\];/.exec(MODES);

// ── Les règles ─────────────────────────────────────────────────────────────

test('les trois niveaux sont ceux demandés', () => {
  assert.ok(NIVEAUX, 'la table DEFI_NIVEAUX doit exister');
  const t = NIVEAUX[0];
  // FACILE — dix pommes, une minute, dix dunks, poids libre.
  assert.match(t, /nom: 'FACILE', pommes: 10, temps: 60000, poids: null/);
  assert.match(t, /cle: 'dunk', label: 'Dunk', n: 10, test: \(f\) => !!f\.flScDunk/);
  // MOYEN — huit pommes, une minute trente, dix granites, poids borné, panier
  // au bord (c'est lui qui ouvre le granite à rebond).
  assert.match(t, /nom: 'MOYEN', pommes: 8, temps: 90000, poids: \[0\.8, 2\.3\]/);
  assert.match(t, /panierAuBord: true, ecureuil: false/);
  assert.match(t, /cle: 'granite', label: 'Granite', n: 10, test: estGranite/);
  // DIFFICILE — huit pommes, panier au bord, un écureuil, et la liste.
  assert.match(t, /nom: 'DIFFICILE', pommes: 8, temps: 120000, poids: \[0\.8, 2\.3\]/);
  assert.match(t, /panierAuBord: true, ecureuil: true/);
  assert.match(t, /toutAuPanier: true/);
  assert.match(t, /cle: 'triple'[\s\S]*?n: 1,\s*\n\s*test: \(f\) => !!\(f\.flScSide && f\.flScBound && f\.flScHead\)/);
  assert.match(t, /cle: 'granite', label: 'Granite', n: 2, test: estGranite/);
  assert.match(t, /cle: 'ecureuil', label: 'Écureuil', n: 1, test: \(f\) => !!f\.flScSquirrel/);
  assert.match(t, /cle: 'bande', label: 'Double-bande', n: 1,\s*\n\s*test: \(f\) => !!\(f\.flScSide && f\.flScBound\)/);
});

test('le granite se lit aux DRAPEAUX, pas au nom composé', () => {
  // « granite » s'écrit `tete dunk`, mais la table des noms le renomme :
  // « pure tete dunk » devient « pure granite », « tete déviée dunk » devient
  // « du mammouth ». Lire le nom, c'est rater les deux.
  assert.match(MODES, /function estGranite\(f\) \{ return !!\(f\.flScHead && f\.flScDunk\); \}/);
  assert.match(SPRITES, /\['tete dunk ', 'granite '\]/);
  assert.match(SPRITES, /\['déviée dunk ', 'du mammouth '\]/);
});

test('le poids des pommes est borné sur les niveaux à granites', () => {
  // Une pomme vaut `(poids − croqué) × 100` : [0.8 ; 2.3] donne bien 80 à 230.
  const g = /genGroundFruit\(\) \{[\s\S]*?\n  \}/.exec(DEFI[0]);
  assert.ok(g, 'Defi.genGroundFruit');
  assert.match(g[0], /const b = this\.regle\.poids;/);
  assert.match(g[0], /b\[0\] \+ \(random\(Math\.round\(\(b\[1\] - b\[0\]\) \* 100\)\) \/ 100\)/);
  // Et sans borne (le facile), c'est le tirage du Challenge : 1 à 1,8.
  assert.match(g[0], /: \(1 \+ random\(80\) \/ 100\)/);
});

test('le terrain se regarnit, et jamais dans le panier', () => {
  // « N pommes sur le terrain » est une POPULATION : le moyen demande dix
  // granites et ne pose que huit pommes.
  assert.match(DEFI[0], /while \(this\.fruitList\.length < this\.regle\.pommes\) this\.genGroundFruit\(\);/);
  // Le panier est au bord sur deux niveaux : une pomme qui naît dessus s'y
  // coince. On retire au sort, à distance de l'ouverture.
  const g = /genGroundFruit\(\) \{[\s\S]*?\n  \}/.exec(DEFI[0])[0];
  assert.match(g, /Math\.abs\(x - this\.panier\.x\) > this\.panier\.openRay \+ r/);
});

test('le panier au bord et l’écureuil ne paraissent que là où on les demande', () => {
  const s = /initSprites\(\) \{[\s\S]*?\n  \}/.exec(DEFI[0])[0];
  assert.match(s, /if \(this\.regle\.panierAuBord\) \{\s*\n\s*this\.panier\.x = this\.panier\.openRay \+ 6;/);
  assert.match(s, /if \(this\.regle\.ecureuil\) \{/);
  assert.match(s, /for \(let i = 0; i < this\.regle\.pommes; i\+\+\) this\.genGroundFruit\(\);/);
});

test('le panneau de consigne est ARRÊTÉ, et il n’y en a qu’un', () => {
  /*
   * `Game.initStartPanel` cale le panneau par `pano.gotoAndStop(this.type)`.
   * Ce rouleau porte une image par mode DE 2005 ; `$defi` n'y est pas, et
   * `gotoAndStop` d'une étiquette inconnue ne fait rien — le clip continuait
   * donc de jouer, et les treize panneaux du jeu défilaient en clignotant.
   */
  const GAME = lire('public/kaluga/jeu/game.js');
  assert.match(GAME, /this\.startPanel\.pano\.gotoAndStop\(this\.type\);/,
    'le cadrage d’époque, par le type du mode');
  const s = /initStartPanel\(\) \{[\s\S]*?\n  \}/.exec(DEFI[0])[0];
  assert.match(s, /pano\.gotoAndStop\('\$chrono'\);/,
    'les Épreuves se calent sur une étiquette QUI EXISTE');
  assert.match(s, /this\.startPanel\.toRead = 1;/, 'une seule lecture');
  // Le champ de texte du Contre-la-montre ne fait qu'une ligne de haut : on lui
  // en donne de quoi porter la consigne entière.
  assert.match(s, /if \(e && typeof e\.multiline === 'boolean'\) \{ e\.multiline = true; e\._height = 58; \}/);
  // Et l'étiquette visée est bien une de celles du rouleau.
  const kaluga = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/kaluga/data/kaluga.json'), 'utf8'));
  const pano = kaluga.perso[String(kaluga.symboles.startPanel)];
  assert.ok(pano, 'le panneau de départ est dans la bibliothèque');
  const etiquettes = [];
  for (const f of (kaluga.perso['1074'].frames || [])) if (f.lab) etiquettes.push(f.lab);
  assert.ok(etiquettes.includes('$chrono'), '« $chrono » existe');
  assert.ok(!etiquettes.includes('$defi'), 'et « $defi » n’existe pas — d’où le calage');
});

// ── Le comptage ────────────────────────────────────────────────────────────

test('une pomme coche AU PLUS une case, la plus exigeante', () => {
  const c = /onCombo\(nom, bonus, fruit\) \{[\s\S]*?\n  \}/.exec(DEFI[0]);
  assert.ok(c, 'Defi.onCombo');
  // La boucle s'arrête à la première case cochée (`return`), et la table est
  // rangée du plus exigeant au moins exigeant.
  assert.match(c[0], /if \(this\.fait\[o\.cle\] >= o\.n\) continue;/);
  assert.match(c[0], /this\.fait\[o\.cle\]\+\+;[\s\S]*?return;/);
  // Hors partie, on ne coche rien.
  assert.match(c[0], /if \(this\.masterStep !== 1 \|\| this\.step !== 2\) return;/);
});

test('le difficile exige AUSSI le compte des pommes au panier', () => {
  const o = /objectifsRemplis\(\) \{[\s\S]*?\n  \}/.exec(DEFI[0])[0];
  assert.match(o, /for \(const o of this\.regle\.objectifs\) if \(\(this\.fait\[o\.cle\] \|\| 0\) < o\.n\) return false;/);
  assert.match(o, /if \(this\.regle\.toutAuPanier && this\.pommesAuPanier < this\.regle\.pommes\) return false;/);
  assert.match(DEFI[0], /onAddFruit\(\) \{\s*\n\s*this\.pommesAuPanier\+\+;/);
});

test('le mode ENTEND les figures : le crochet est dans addFruit, pas dans checkCombo', () => {
  // `checkCombo` ne tourne que pour `$classic` (le seul mode qui compte des
  // points) : y loger le crochet, c'était ne jamais l'appeler sous `$defi`.
  const add = /addFruit\(fruit\) \{[\s\S]*?\n  \}/.exec(SPRITES)[0];
  assert.match(add, /if \(this\.game\.onCombo && fruit\.flScoreAble && fruit\.antList\.length === 0\) \{/);
  assert.match(add, /const fig = this\.figureDe\(fruit\);\s*\n\s*this\.game\.onCombo\(fig\.name, fig\.b, fruit\);/);
  // Et le nom de la figure se calcule à part, pour servir les deux.
  assert.match(SPRITES, /figureDe\(fruit\) \{/);
  assert.match(SPRITES, /checkCombo\(fruit\) \{\s*\n\s*const \{ name, b \} = this\.figureDe\(fruit\);/);
  // La garde d'époque du Challenge est la même : une pomme croquée jusqu'au
  // trognon ne vaut pas figure.
  assert.match(add, /if \(this\.game\.type === '\$classic'\) \{/);
});

test('rien ne part au classement : pas de score, donc pas de Fruit Défendu', () => {
  // Game.initEndGame n'envoie un score que pour `$classic`.
  const code = DEFI[0].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(DEFI[0], /this\.type = '\$defi';/);
  assert.doesNotMatch(code, /\.saveScore\(/);
  const GAME = lire('public/kaluga/jeu/game.js');
  assert.match(GAME, /if \(this\.type === '\$classic' && this\.tournament == null\) this\.saveScore\(this\.score\);/);
});

// ── Le menu et la fruticard ────────────────────────────────────────────────

test('les trois niveaux se gagnent l’un après l’autre', () => {
  // Une fiche neuve n'ouvre que le facile.
  assert.match(MANAGER, /if \(!Array\.isArray\(c\.\$defi\)\) c\.\$defi = \[1, 0, 0\];/);
  assert.match(MANAGER, /this\.card\.\$defi = \[1, 0, 0\];/);
  // Le menu casse les niveaux fermés, et l'entrée entière s'il n'en reste rien.
  assert.match(MENU, /const defi = this\.mng\.card\.\$defi \|\| \[1, 0, 0\];/);
  assert.match(MENU, /if \(!defi\[i\]\) epreuves\.list\[i\] = undefined;/);
  // La réussite ouvre le suivant sur la fiche.
  assert.match(DEFI[0], /carte\.\$defi\[this\.level \+ 1\] = 1;/);
});

test('l’entrée du menu sort de la plage de 2005 sans rien y cogner', () => {
  // L'identifiant 8 est « retour au menu » : le sous-menu prend le 19, et ses
  // niveaux 70 à 72 — au-delà de tout ce que le switch d'époque connaît.
  assert.match(MENU, /\{ id: 19, frame: 9, name: 'EPREUVES', list: \[/);
  assert.match(MENU, /case 19: this\.toggle\(id\); break;/);
  assert.match(MENU, /case 8: this\.displayMenu\(\); break;/);
  assert.match(MENU, /case 70: case 71: case 72: this\.launchGame\('gameDefi', \{ level: id - 70 \}\); break;/);
  assert.match(MODES, /K\.registerClass\('gameDefi', Defi\);/);
});

// ── Les records ────────────────────────────────────────────────────────────

test('le meilleur temps de chaque niveau se range sur la fruticard', () => {
  // Rangés comme les records des modes d'époque : un `$level` par niveau,
  // `$s` le temps (0 = jamais réussi), `$t` la tzongre qui l'a fait.
  assert.match(MANAGER, /if \(!c\.\$defiScore \|\| !Array\.isArray\(c\.\$defiScore\.\$level\)\) c\.\$defiScore = \{ \$st: 2, \$level: \[\] \};/);
  assert.match(MANAGER, /for \(let i = 0; i < 3; i\+\+\) if \(!c\.\$defiScore\.\$level\[i\]\) c\.\$defiScore\.\$level\[i\] = \{ \$s: 0, \$t: 0 \};/);
  assert.match(MANAGER, /this\.card\.\$defiScore = \{ \$st: 2, \$level: \[\{ \$s: 0, \$t: 0 \}, \{ \$s: 0, \$t: 0 \}, \{ \$s: 0, \$t: 0 \}\] \};/);
  // Le plus COURT gagne, et la première réussite s'inscrit toujours.
  assert.match(DEFI[0], /const battu = !!rec && \(!ancien \|\| this\.score < ancien\);/);
  assert.match(DEFI[0], /if \(battu\) \{ rec\.\$s = this\.score; rec\.\$t = Number\(this\.tzongreInfo\.id\) \|\| 0; \}/);
  // Et c'est `saveSlot(0)` qui les envoie au serveur — le même chemin que les
  // tzongres et les modes : ils survivent au redémarrage.
  assert.match(DEFI[0], /this\.mng\.client\.saveSlot\(0\);/);
  assert.match(PLATEFORME, /fetch\('\/api\/saveFrutiSlot'/);
});

test('la fruticard montre les Épreuves comme un mode chronométré', () => {
  const FCARD = lire('fruticard.js');
  assert.match(FCARD, /const KALUGA_DEFIS = \['facile', 'moyen', 'difficile'\];/);
  assert.match(FCARD, /lignes = lignes\.concat\(getKalugaModeLines\('mode épreuves', defis, 'time'\)\);/);
  // Et elle rend vraiment ce qu'on lui donne : le niveau jamais réussi ($s = 0)
  // ne paraît pas, les autres en minutes'secondes''centièmes.
  const F = require(path.join(ROOT, 'fruticard.js'));
  const carte = { $vs: 1, $tz: [1, 0, 0, 0, 0], $stat: { $fruit: 0 },
    $defiScore: { $st: 2, $level: [{ $s: 61250, $t: 0 }, { $s: 87400, $t: 4 }, { $s: 0, $t: 0 }] } };
  const texte = F.lignes('kaluga', carte)
    .map((l) => (l.list || []).map((p) => (p.param && p.param.text) || '').join(' ')).join('\n');
  assert.match(texte, /mode épreuves/);
  assert.match(texte, /facile\s+1'01''25/);
  assert.match(texte, /moyen\s+1'27''40/);
  assert.doesNotMatch(texte, /difficile/, 'le niveau jamais réussi ne paraît pas');
});

test('les Épreuves n’ont AUCUN classement : ni cuve, ni ligne d’époque', () => {
  // La demande est explicite : les scores vont sur la fruticard, pas au
  // Challenge. Aucune cuve `$defi` ne doit exister côté serveur.
  assert.doesNotMatch(SERVEUR, /kaluga_defi|kaluga_epreuve/);
  // Et le mode ne demande jamais de score : `saveScore` est réservé à
  // `$classic` (cf. le test « rien ne part au classement »).
  assert.match(DEFI[0], /this\.score = this\.barTimer\.time;/, 'le score du mode est un TEMPS');
});

// ── L'accessoire ───────────────────────────────────────────────────────────

test('le jeu ne fait que DEMANDER : c’est le serveur qui accorde', () => {
  // Le crochet est celui de 2005 (`giveAccessory`), que le portage avait
  // laissé vide. Il mène maintenant au serveur.
  assert.match(PLATEFORME, /giveAccessory\(cle, retour\) \{/);
  assert.match(PLATEFORME, /fetch\('\/api\/kaluga\/accessoire', \{/);
  assert.match(PLATEFORME, /body: JSON\.stringify\(\{ sid: this\.sid, cle: String\(cle\) \}\)/);
  // Sans session, il n'y a pas de compte à récompenser.
  assert.match(PLATEFORME, /if \(!this\.sid \|\| !cle\) return;/);
  // Et c'est le DIFFICILE qui le demande.
  assert.match(DEFI[0], /if \(this\.level === DEFI_NIVEAUX\.length - 1\) \{/);
  assert.match(DEFI[0], /this\.mng\.client\.giveAccessory\('\$makulo', \(reponse\) => \{/);
});

test('l’annonce se lit sur la fruticard, parce que le panneau de fin est figé', () => {
  // `Game.setEndGamePanel` RECOPIE les pages au moment où le panneau s'ouvre :
  // une réponse qui arrive après ne s'y ajouterait plus. On annonce donc
  // d'après la carte — et l'on n'y marque que ce qui est vraiment au vestiaire.
  const GAME = lire('public/kaluga/jeu/game.js');
  assert.match(GAME, /const initObj = \{ game: this, list: this\.endPanelStart\.concat\(this\.endPanelMiddle\)\.concat\(this\.endPanelEnd\) \};/);
  assert.match(DEFI[0], /if \(carte && !carte\.\$makulo\) \{/);
  assert.match(DEFI[0], /if \(!carte \|\| carte\.\$makulo \|\| !reponse \|\| reponse\.absent\) return;/);
  assert.match(DEFI[0], /carte\.\$makulo = 1;/);
  assert.match(MANAGER, /if \(c\.\$makulo == null\) c\.\$makulo = 0;/);
});

test('la récompense est un ARTICLE DE BOUTIQUE, accordé une seule fois', () => {
  const bloc = /app\.post\('\/api\/kaluga\/accessoire',[\s\S]*?\n\}\);/.exec(SERVEUR);
  assert.ok(bloc, 'l’endpoint /api/kaluga/accessoire doit exister');
  const e = bloc[0];
  // La table ne connaît qu'un NUMÉRO D'ARTICLE : le dessin, le nom et le prix
  // restent à l'admin.
  assert.match(SERVEUR, /const KALUGA_RECOMPENSES = \{\s*\n\s*'\$makulo': \{ packId: 88888 \}/);
  // Session obligatoire, clé connue obligatoire.
  assert.match(e, /if \(!username\) return res\.status\(401\)\.json\(\{ ok: false, error: 'auth_required' \}\);/);
  assert.match(e, /if \(!recompense\) return res\.status\(404\)\.json\(\{ ok: false, error: 'unknown_reward' \}\);/);
  // L'entrée d'inventaire est celle de la boutique — shopId compris, sans quoi
  // possession, essai, revente et purges d'admin ne la reconnaîtraient pas.
  assert.match(e, /id: 'shop_' \+ pack\.id,\s*\n\s*shopId: pack\.id,/);
  assert.match(e, /v: bouilleOf\(user, username\)\.substring\(0, 15\) \+ pack\.suffix9,/);
  assert.match(e, /if \(userOwnsShopPack\(user, pack\.id\)\) \{/);
  assert.match(e, /return res\.json\(\{ ok: true, accorde: false, nom: pack\.name \}\);/);
  // L'article retiré du rayon ne se gagne plus — et ne casse pas la partie.
  assert.match(e, /if \(!pack \|\| pack\.disabled\) \{/);
  assert.match(e, /return res\.json\(\{ ok: true, accorde: false, nom: '', absent: true \}\);/);
  // Une récompense n'est pas une vente : rien n'est débité, rien n'est versé.
  assert.doesNotMatch(e, /verserCommission|kikooz|insertShopPurchase/);
});

test('l’entrée d’inventaire est LA MÊME que celle d’un achat', () => {
  // Si les deux chemins divergeaient, l'un des deux finirait invisible dans
  // « Mes accessoires ». On épingle donc la forme commune.
  const achat = /function purchaseShopPack\(user, username, packIdRaw\) \{[\s\S]*?\n\}/.exec(SERVEUR)[0];
  assert.match(achat, /shopId: pack\.id,/);
  assert.match(achat, /bouilleOf\(user\)\.substring\(0, 15\) \+ pack\.suffix9/);
  assert.match(achat, /at: nowStr,/);
  assert.match(SERVEUR, /return user\.customAccessories\.some\(\(a\) => a && a\.shopId === nid\);/);
});
