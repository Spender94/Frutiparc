/*
 * Les VOYANTS de jeu — l'icône à côté du pseudo d'un joueur en pleine partie.
 *
 * Le bureau les tient depuis toujours : le serveur diffuse un code INTERNE
 * dans la chaîne de statut (quatre caractères base 62 : absence, JEU sur
 * deux, émote). Ce code est un INDEX dans StatusMng.internalList — lu dans le
 * bytecode de main.swf :
 *
 *   [ ∅, forum, bkiwi, mb2, swapou2, snake3, bandas, grapiz, kaluga,
 *     miniwave ]
 *
 * — et l'affichage fait gotoAndStop(nom) sur la feuille d'icônes (clip 246),
 * dont chaque image porte l'ÉTIQUETTE de son jeu. Les étiquettes disent vrai
 * (bandas = le béret, grapiz = la bille, swapou2 = la grappe, miniwave = le
 * vaisseau) ; la vieille règle « code + 3 » était une coïncidence qui donnait
 * au mobile le bolide de Burning Kiwi pour Grapiz et la tomate de Costomate
 * pour Frutibandas.
 *
 * Ce fichier garde trois choses :
 *   1. la table serveur — dont la fée de Minipixiz, absente de la liste
 *      d'origine (pas d'icône possible au bureau, le mobile la montre) ;
 *   2. les chemins qui allument et éteignent le voyant (natifs et matchs) ;
 *   3. l'affichage mobile — les PNG extraits PAR ÉTIQUETTE de la même
 *      feuille, et le code de light.html qui les pose à côté des pseudos.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('la table du bureau suit internalList, et l\'extracteur suit les étiquettes', () => {
  // Les codes = les index d'internalList (main.swf) : ils ne bougent pas.
  for (const [jeu, code] of [['bandas', 6], ['grapiz', 7], ['swapou2', 4],
    ['miniwave', 9], ['bkiwi', 2], ['mb2', 3], ['snake3', 5], ['kaluga', 8]]) {
    assert.match(serveur, new RegExp(jeu + ':\\s*' + code + ','), jeu + ' → ' + code);
  }
  // Minipixiz et Mini-Fever sont HORS liste d'origine (elle s'arrête à
  // miniwave = 9) : leurs codes 12 et 13 sont branchés au bureau par les deux
  // rustines DoInitAction, et le serveur le dit.
  assert.match(serveur, /minipixiz:\s*12,/, 'minipixiz → interne 12');
  assert.match(serveur, /minifever:\s*13,/, 'minifever → interne 13');
  assert.match(serveur, /OUTSIDE the SWF's original internalList/);
  // L'extracteur choisit les images PAR ÉTIQUETTE — la source de vérité du
  // gotoAndStop(nom) du SWF — plus jamais par décalage.
  const extracteur = fs.readFileSync(
    path.join(ROOT, 'scripts/extract-voyants-jeux.js'), 'utf8');
  assert.match(extracteur, /etiquettesDuClip\(SWF, 246\)/);
  for (const [jeu, etiquette] of [['bandas', 'bandas'], ['grapiz', 'grapiz'],
    ['swapou', 'swapou2'], ['miniwave', 'miniwave'], ['minipixiz', 'minipixiz']]) {
    assert.match(extracteur,
      new RegExp("jeu: '" + jeu + "', etiquette: '" + etiquette + "'"),
      jeu + ' ← étiquette ' + etiquette);
  }
});

test('main.swf porte les rustines qui branchent la fée et les cerises au bureau', () => {
  // internalList s'arrête à miniwave (index 9) dans la classe compilée : les
  // patchs appendent des DoInitAction après celui de StatusMng —
  // _global.StatusMng.internalList[12] = "minipixiz" (la fée-papillon), puis
  // [13] = "minifever" (les cerises, dont l'image est greffée à la feuille).
  const zlib = require('zlib');
  const raw = fs.readFileSync(path.join(ROOT, 'legacy/main.swf'));
  const corps = zlib.inflateSync(raw.slice(8));
  const graineDe = (index) => Buffer.concat([
    Buffer.from([0x96, 14, 0, 0]), Buffer.from('internalList'), Buffer.from([0]),
    Buffer.from([0x4e]),                          // getMember
    Buffer.from([0x96, 5, 0, 7, index, 0, 0, 0]), // push int <index>
  ]);
  // Et elles sont LISIBLES et EXÉCUTÉES AU CHARGEMENT : en marchant les tags,
  // chaque graine doit tomber dans un DoInitAction (code 59). Les deux pièges
  // déjà rencontrés : un en-tête 0x33F tronqué en octet (tag End long —
  // lecteurs stricts arrêtés, rustine jamais exécutée), et un DoAction
  // ordinaire (la classe vit sur l'image 10 de 23, qu'un gotoAndStop peut ne
  // jamais afficher — l'init action, elle, s'exécute au chargement, vérifié
  // sous Ruffle par une balise /api/diag : icone12=minipixiz).
  const nbits = (corps[0] >> 3) & 0x1f;
  const debut = Math.ceil((5 + nbits * 4) / 8) + 4;
  const initsParSprite = new Map();
  let o = debut;
  while (o < corps.length) {
    const hdr = corps.readUInt16LE(o), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = corps.readUInt32LE(o + 2); hs = 6; }
    if (code === 59) {
      const id = corps.readUInt16LE(o + hs);
      initsParSprite.set(id, (initsParSprite.get(id) || 0) + 1);
    }
    if (code === 0) break;
    o += hs + len;
  }
  const porteurs = new Set();
  for (const [index, nom] of [[12, 'minipixiz'], [13, 'minifever']]) {
    const graine = graineDe(index);
    let n = 0, i = 0;
    while ((i = corps.indexOf(graine, i)) >= 0) { n++; i++; }
    assert.equal(n, 1, 'l\'injection [' + index + ']=' + nom + ' est là, une seule fois');
    let porteur = -1, sprite = -1;
    o = debut;
    while (o < corps.length) {
      const hdr = corps.readUInt16LE(o), code = hdr >> 6;
      let len = hdr & 0x3f, hs = 2;
      if (len === 0x3f) { len = corps.readUInt32LE(o + 2); hs = 6; }
      if (corps.slice(o + hs, o + hs + len).indexOf(graine) >= 0) {
        porteur = code;
        sprite = corps.readUInt16LE(o + hs);
        break;
      }
      if (code === 0) break;
      o += hs + len;
    }
    assert.equal(porteur, 59, nom + ' : la graine vit dans un DoInitAction atteignable');
    // Un seul DoInitAction par sprite fait foi : le porteur doit être le seul,
    // et chaque rustine a le SIEN (le second réutiliserait un sprite déjà pris
    // et ne s'exécuterait jamais).
    assert.equal(initsParSprite.get(sprite), 1,
      nom + ' : le sprite porteur (' + sprite + ') n\'a que cette init action');
    assert.ok(!porteurs.has(sprite), nom + ' : un porteur à soi');
    porteurs.add(sprite);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/patch-main-statusmng-minipixiz.js')),
    'le patch de la fée est rejouable');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/patch-main-statusmng-minifever.js')),
    'celui des cerises aussi');
});

test('le serveur sait traduire le code interne en nom de jeu', () => {
  assert.match(serveur, /STATUS_INTERNAL_JEU/, 'la table inverse existe');
  assert.match(serveur, /statusInternalOf/, 'et la lecture du code d\'un joueur');
  // La vue « tout le site » du mobile porte le jeu de chacun.
  assert.match(serveur, /o\.jeu = jeu;/, '/api/light/online expose `jeu`');
});

test('les jeux natifs ont leur balise « je joue »', () => {
  assert.match(serveur, /app\.post\('\/api\/light\/jeu-en-cours'/, 'la route existe');
  assert.match(serveur, /JEUX_NATIFS_VOYANT/, 'et ne prend que les jeux connus');
  // Les six jeux jouables nativement.
  assert.match(serveur, /'bandas', 'grapiz', 'swapou2', 'miniwave', 'minipixiz', 'minifever'/,
    'bandas, grapiz, swapou, miniwave, minipixiz, minifever');
  // Les clients solo l'appellent au départ et à l'arrêt.
  for (const fichier of ['public/minipixiz/index.html', 'public/miniwave/index.html',
    'public/minifever/index.html']) {
    const t = fs.readFileSync(path.join(ROOT, fichier), 'utf8');
    assert.match(t, /jeu-en-cours/, fichier + ' porte la balise');
    assert.match(t, /sendBeacon/, fichier + ' éteint à la fermeture de l\'onglet');
    assert.match(t, /direEnPartie\(true\)/, fichier + ' : allumée au départ');
    assert.match(t, /direEnPartie\(false\)/, fichier + ' : éteinte à la fin');
  }
  const swapou = fs.readFileSync(path.join(ROOT, 'public/swapou/game.js'), 'utf8');
  assert.match(swapou, /direEnPartie/, 'swapou aussi');
  const ecrans = fs.readFileSync(path.join(ROOT, 'public/swapou/screens.js'), 'utf8');
  assert.match(ecrans, /direEnPartie\(true\)/, 'allumée au départ d\'un mode');
  assert.match(ecrans, /direEnPartie\(false\)/, 'éteinte au retour au menu');
});

test('les matchs Grapiz et Frutibandas allument le voyant côté serveur', () => {
  // Le match qui part allume ; le résultat éteint chaque humain.
  const grapiz = serveur.indexOf('const grapizNet = new GrapizNet');
  const bandas = serveur.indexOf('const bandasNet = new BandasNet');
  for (const [nom, debut] of [['grapiz', grapiz], ['bandas', bandas]]) {
    const bloc = serveur.slice(debut, debut + 2200);
    assert.match(bloc, new RegExp("marquerEnPartie\\(u, '" + nom + "'\\)"),
      nom + ' : allumé quand le match se forme');
    assert.match(bloc, /marquerFinDePartie\(p\.id\)/,
      nom + ' : éteint au résultat');
  }
});

test('les six voyants ont leur PNG (extraits de la feuille, ou dessinés pour la greffe)', () => {
  // Les cinq d'époque viennent de la feuille du bureau (extract-voyants-jeux) ;
  // celui de Mini-Fever est né avec la greffe (make-minifever-emblemes.js) —
  // les cerises, le même dessin que l'image ajoutée au clip 246.
  for (const jeu of ['bandas', 'grapiz', 'swapou', 'miniwave', 'minipixiz', 'minifever']) {
    const f = path.join(ROOT, 'public/fb/voyant_' + jeu + '.png');
    assert.ok(fs.existsSync(f), 'voyant_' + jeu + '.png existe');
    assert.ok(fs.statSync(f).size > 800, 'et porte un vrai dessin');
  }
});

test('le mobile pose le voyant à côté des pseudos', () => {
  // La même table que le bureau, traduite en icônes.
  assert.match(light,
    /VOYANTS_JEU = \{ 6: "bandas", 7: "grapiz", 4: "swapou", 9: "miniwave", 12: "minipixiz",\s*13: "minifever" \}/,
    'les codes internes du bureau');
  // La chaîne de statut est lue au format du bureau : base 62, le jeu au milieu.
  assert.match(light, /decode62\(String\(s\)\.substring\(1, 3\)\)/, 'les deux caractères du jeu');
  // Mémorisée à l'arrivée de la liste ET des traces — les deux formes.
  assert.match(light, /rememberStatut\(uname, attr\(frag, "s"\)\)/, 'depuis la liste du salon');
  assert.match(light, /rememberStatut\(attr\(zf, "u"\), attr\(zf, "s"\)\)/, 'depuis les traces imbriquées');
  assert.match(light, /rememberStatut\(attr\(xml, "u"\), attr\(xml, "s"\)\)/, 'et les traces directes');
  // Et posée dans la ligne, pour le salon comme pour tout le site.
  assert.match(light, /voyant_" \+ jeu \+ "\.png/, 'l\'icône vient des PNG extraits');
  assert.match(light, /Joue à " \+ VOYANTS_NOM\[jeu\]/, 'avec le nom du jeu en infobulle');
  assert.match(light, /\.u \.voyant \{/, 'et son style');
});


// ── Le voyant sur la FICHE ───────────────────────────────────────────────
//
// L'en-tête de la fiche ne montrait qu'un point de présence : connecté, ou pas.
// C'est déjà ce que dit la liste des connectés. Le voyant de jeu, lui, dit ce
// qu'on ne lit nulle part ailleurs sur la fiche — qu'il est AU MILIEU d'une
// partie. Un animateur sur le point de redémarrer le serveur veut le savoir
// avant, pas après.

test('la fiche publie le jeu en cours, lu sur la socket du joueur', () => {
  assert.match(serveur, /const jeu = enLigne \? \(STATUS_INTERNAL_JEU\[statusInternalOf\(u\)\] \|\| ''\) : '';/,
    'la fiche lit le code comme la liste des connectés');
  assert.match(serveur, /^\s*jeu,$/m, 'et le publie dans sa réponse');
  // Hors ligne, pas de jeu : une socket fermée ne joue à rien.
  assert.match(serveur, /const jeu = enLigne \?/, 'le voyant suppose la présence');
});

test('le voyant remplace le point de présence, sans l\'écraser', () => {
  assert.match(light, /var jeuFiche = \(d && d\.jeu\) \|\| "";/);
  assert.match(light, /st\.src = "\/fb\/voyant_" \+ jeuFiche \+ "\.png";/,
    'la même icône que la liste des connectés');
  assert.match(light, /st\.title = "En partie — " \+ VOYANTS_NOM\[jeuFiche\];/,
    'et elle dit à quoi il joue');
  // Sans partie, le point revient — et il dit lui aussi ce qu'il montre.
  assert.match(light, /st\.src = "\/fb\/fiche\/" \+ \(\(d && d\.enLigne\) \? "statut_present" : "statut_absent"\) \+ "\.png";/);
  assert.match(light, /st\.title = \(d && d\.enLigne\) \? "En ligne" : "Hors ligne";/);
  // Le voyant est dessiné plus large que le point : on lui rend ses 22 px
  // plutôt que de l'écraser dans les 18 du point.
  assert.match(light, /\.fiche-nom-ligne \.statut\.en-partie \{ width: 22px; height: 22px; \}/);
});

test('Swapou retrouve son voyant : swapou2 côté SWF, swapou côté assets', () => {
  // L'internalList du SWF nomme le jeu « swapou2 » (le second opus) ; les
  // icônes du mobile s'appellent « voyant_swapou ». Sans alias, le client
  // cherchait VOYANTS_NOM['swapou2'] — qui n'existe pas —, et un joueur de
  // Swapou n'avait aucun voyant dans la vue « tout le site ».
  assert.match(serveur, /const STATUS_JEU_ALIAS = \{ swapou2: 'swapou' \};/);
  assert.match(serveur, /\.map\(\(\[nom, code\]\) => \[code, STATUS_JEU_ALIAS\[nom\] \|\| nom\]\)\);/);
  // Le client, lui, ne connaît que « swapou » — des deux côtés, même mot.
  assert.match(light, /var VOYANTS_NOM = \{ bandas: "Frutibandas", grapiz: "Grapiz", swapou: "Swapou",/);
  assert.ok(!/VOYANTS_NOM\s*=\s*\{[^}]*swapou2/.test(light), 'le client ignore « swapou2 »');
  // Et la table code → nom, rejouée : le 4 doit sortir « swapou ».
  const FRAME = { bkiwi: 2, mb2: 3, swapou2: 4, snake3: 5, bandas: 6, grapiz: 7,
    kaluga: 8, miniwave: 9, minipixiz: 12, minifever: 13, forum: 1 };
  const ALIAS = { swapou2: 'swapou' };
  const table = Object.fromEntries(Object.entries(FRAME)
    .filter(([nom]) => nom !== 'forum')
    .map(([nom, code]) => [code, ALIAS[nom] || nom]));
  assert.equal(table[4], 'swapou', 'le code 4 sort « swapou »');
  assert.equal(table[6], 'bandas');
  assert.equal(table[12], 'minipixiz');
  assert.equal(table[13], 'minifever');
  assert.equal(table[1], undefined, 'et le forum n\'est pas une partie');
  // Chaque nom publié a bien son PNG.
  for (const nom of Object.values(table)) {
    if (!['bandas', 'grapiz', 'swapou', 'miniwave', 'minipixiz', 'minifever'].includes(nom)) continue;
    const f = path.join(ROOT, 'public/fb/voyant_' + nom + '.png');
    assert.ok(fs.existsSync(f), 'voyant_' + nom + '.png existe');
  }
});
