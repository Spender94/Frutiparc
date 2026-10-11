/*
 * KALUGA — LES TITEMS (PICTOS) : la table item → condition, telle que 2005.
 *
 * Remonté par les joueurs : « la fourmi devrait se débloquer en infernal, pas
 * avant ». Le source (Games/kaluga/class/kaluga/Game.as, checkUnlock) dit :
 * un Titem par NIVEAU GAGNÉ, dans chacun des quatre modes à niveaux —
 *
 *   mode (n)        facile         standard      difficile        infernal
 *   Chrono   (2)    $butterfly0    $smiley0      $tz1 Piwali      $basket
 *   Survie   (3)    $butterfly1    $smiley1      $tz4 Makulo      $bird
 *   Invasion (4)    $butterfly2    $smiley2      $tz3 Gomola      $ring
 *   Piste    (5)    $butterfly3    $smiley3      $tz2 Nalika      $ant (FOURMI)
 *
 * — et la fourmi est bien l'objet de l'INFERNAL, à la PISTE. Le portage
 * (jeu/game.js) suit ce texte ; ce qui s'en écartait, c'est le chemin du
 * picto : `giveItem` était vide et le serveur déduisait les pictos de
 * `$mode[n][k]` en lisant « niveau k gagné » là où la fiche dit « niveau k
 * OUVERT » — tout décalé d'un niveau. Le portage note désormais sur la fiche
 * ce que le jeu accorde (`$titem`), et ce fichier verrouille :
 *
 *   1. la table d'origine, lue dans le source AS2 ;
 *   2. le portage, au texte (game.js, modes.js, manager.js) ;
 *   3. le portage, EXÉCUTÉ : Game.checkUnlock pour les seize cas (n, niveau),
 *      avec le vrai Client.giveItem, et ce qu'il laisse sur la fiche ;
 *   4. le serveur, s'il lit `$titem` : ce qu'il accorde, fiche par fiche.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'latin1');
const lireUtf8 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const AS_GAME = lire('Games/kaluga/class/kaluga/Game.as');
const AS_MANAGER = lire('Games/kaluga/class/kaluga/Manager.as');
const AS_MODES = {
  2: lire('Games/kaluga/class/kaluga/game/Chrono.as'),
  3: lire('Games/kaluga/class/kaluga/game/Survival.as'),
  4: lire('Games/kaluga/class/kaluga/game/Invasion.as'),
  5: lire('Games/kaluga/class/kaluga/game/Ring.as'),
};
const GAME = lireUtf8('public/kaluga/jeu/game.js');
const MODES = lireUtf8('public/kaluga/jeu/modes.js');
const MANAGER = lireUtf8('public/kaluga/jeu/manager.js');
const PLATEFORME = lireUtf8('public/kaluga/plateforme.js');
// Le serveur à vérifier : server.js, ou une copie (KALUGA_SERVEUR_JS) pour
// essayer une rustine avant de l'appliquer.
const SERVEUR_JS = process.env.KALUGA_SERVEUR_JS || path.join(ROOT, 'server.js');
const SERVEUR = fs.readFileSync(SERVEUR_JS, 'utf8');

// ── La table d'origine ─────────────────────────────────────────────────────

const NIVEAUX = ['facile', 'standard', 'difficile', 'infernal'];
const MODES_A_NIVEAUX = { 2: 'Chrono', 3: 'Survival', 4: 'Invasion', 5: 'Ring' };
const TZ_UNLOCK = [1, 4, 3, 2];
const SPECIAUX = ['$basket', '$bird', '$ring', '$ant'];
// Les objectifs d'époque (goalList), et le sens de la victoire.
const OBJECTIFS = {
  2: { goalList: [60000, 50000, 45000, 42000], gagne: '<=' },
  3: { goalList: [45000, 60000, 80000, 150000], gagne: '>' },
  4: { goalList: [90000, 120000, 150000, 180000], gagne: '>' },
  5: { goalList: [45000, 90000, 90000, 90000], gagne: '<=' },
};
function titemAttendu(n, niveau) {
  switch (niveau) {
    case 0: return '$butterfly' + (n - 2);
    case 1: return '$smiley' + (n - 2);
    case 2: return '$tz' + TZ_UNLOCK[n - 2];
    case 3: return SPECIAUX[n - 2];
    default: return null;
  }
}
const TOUS_LES_TITEMS = [];
for (let n = 2; n <= 5; n++) for (let l = 0; l < 4; l++) TOUS_LES_TITEMS.push(titemAttendu(n, l));

// Le corps d'une méthode de classe, accolade à accolade.
function methode(source, classe, nom) {
  const debutClasse = source.indexOf('class ' + classe + ' ');
  assert.ok(debutClasse >= 0, 'classe ' + classe);
  const re = new RegExp('\\n  ' + nom + '\\([^)]*\\) \\{');
  const m = re.exec(source.slice(debutClasse));
  assert.ok(m, classe + '.' + nom);
  const debut = debutClasse + m.index + m[0].length;
  let prof = 1, i = debut;
  while (prof > 0 && i < source.length) { const c = source[i++]; if (c === '{') prof++; else if (c === '}') prof--; }
  return source.slice(debut, i - 1);
}
// Un bloc `{…}` complet à partir d'une position d'ouverture.
function bloc(source, debut) {
  assert.equal(source[debut], '{');
  let prof = 0, i = debut;
  do { const c = source[i++]; if (c === '{') prof++; else if (c === '}') prof--; } while (prof > 0 && i < source.length);
  return source.slice(debut, i);
}

// ── 1. Le source AS2 ───────────────────────────────────────────────────────

test('Game.as : checkUnlock donne un Titem par niveau gagné — papillon, drapeau, tzongre, objet spécial', () => {
  const i = AS_GAME.indexOf('function checkUnlock(n)');
  assert.ok(i >= 0, 'checkUnlock');
  const corps = AS_GAME.slice(i, AS_GAME.indexOf('function addTitem', i));
  // Session blanche seulement, et le niveau suivant s'ouvre (jamais au-delà du 3).
  assert.match(corps, /if\( this\.mng\.client\.isWhite\(\) \)\{/);
  assert.match(corps, /if\( this\.level<3 && !list\[this\.level\+1\] \)\{/);
  assert.match(corps, /this\.mng\.card\.\$mode\[n\]\[this\.level\+1\] = 1;/);
  // Les quatre cas, dans l'ordre des niveaux.
  assert.match(corps, /switch\(this\.level\)\{\s*case 0:\s*this\.addTitem\("\$butterfly"\+\(n-2\)\)/);
  assert.match(corps, /case 1:\s*this\.addTitem\("\$smiley"\+\(n-2\)\)/);
  assert.match(corps, /case 2:\s*var tzUnlockList = \[1,4,3,2\]\s*var id = tzUnlockList\[n-2\]/);
  assert.match(corps, /this\.mng\.card\.\$tz\[id\] = 1;\s*this\.addTitem\("\$tz"\+id\)/);
  assert.match(corps, /case 3:\s*var unlockList = \[ "\$basket", "\$bird", "\$ring", "\$ant" \]\s*this\.addTitem\(unlockList\[n-2\]\)/);
  // addTitem : l'annonce, puis giveItem.
  assert.match(AS_GAME, /function addTitem\(str\)\{[\s\S]*?this\.mng\.client\.giveItem\(str\)/);
  // Les noms des niveaux, dans l'ordre des cas.
  assert.match(AS_MANAGER, /this\.difNameList = \[\s*"facile",\s*"standard",\s*"difficile",\s*"infernal"\s*\]/);
});

test('Game.as : les quatre modes appellent checkUnlock(n) avec leur n, quand l’objectif du niveau est atteint', () => {
  for (const n of [2, 3, 4, 5]) {
    const src = AS_MODES[n];
    const o = OBJECTIFS[n];
    assert.match(src, new RegExp('this\\.goalList = \\[\\s*' + o.goalList.join(',\\s*') + '\\s*\\]'), MODES_A_NIVEAUX[n] + ' goalList');
    const cond = o.gagne === '<=' ? 'this\\.score <= this\\.goalList\\[this\\.level\\]' : 'this\\.score > this\\.goalList\\[this\\.level\\]';
    assert.match(src, new RegExp('if\\( ' + cond + ' \\)\\{\\s*this\\.checkUnlock\\(' + n + '\\)'), MODES_A_NIVEAUX[n] + ' → checkUnlock(' + n + ')');
  }
  // Personne d'autre n'appelle checkUnlock : ni le Challenge, ni les épreuves.
  const appels = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'Games/kaluga/class/kaluga/game'))) {
    if (!f.endsWith('.as')) continue;
    const s = lire('Games/kaluga/class/kaluga/game/' + f);
    for (const m of s.matchAll(/checkUnlock\((\d)\)/g)) appels.push(f + ':' + m[1]);
  }
  assert.deepEqual(appels.sort(), ['Chrono.as:2', 'Invasion.as:4', 'Ring.as:5', 'Survival.as:3']);
});

test('Game.as : la fourmi ($ant) est l’objet de l’INFERNAL, à la PISTE (Ring, n = 5)', () => {
  assert.equal(titemAttendu(5, 3), '$ant');
  assert.equal(NIVEAUX[3], 'infernal');
  // Et pas de l'Invasion, qui donne le Kaluga Spécial ($ring).
  assert.equal(titemAttendu(4, 3), '$ring');
  // Aucun niveau inférieur ne la donne.
  for (let l = 0; l < 3; l++) for (let n = 2; n <= 5; n++) assert.notEqual(titemAttendu(n, l), '$ant');
});

test('Manager.as : $tz0 est le premier Titem, à la création de la fiche ; la kagulga est un accessoire', () => {
  assert.match(AS_MANAGER, /\/\/ FIRST TITEM KALUGA\s*if\( this\.client\.isWhite\(\) \)\{\s*this\.client\.giveItem\("\$tz0"\)/);
  assert.match(AS_GAME, /function addKagulga\(\)\{[\s\S]*?this\.mng\.client\.giveAccessory\("\$kagulga"\);/);
  // Deux appels à giveItem dans tout le source, pas un de plus.
  const tous = [];
  const parcourir = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) parcourir(p);
      else if (f.endsWith('.as')) for (const m of fs.readFileSync(p, 'latin1').matchAll(/giveItem\(([^)]*)\)/g)) tous.push(m[1]);
    }
  };
  parcourir(path.join(ROOT, 'Games/kaluga/class'));
  assert.deepEqual(tous.sort(), ['"$tz0"', 'str']);
});

// ── 2. Le portage, au texte ────────────────────────────────────────────────

test('game.js : Game.checkUnlock est la traduction mot à mot du source', () => {
  const corps = methode(GAME, 'Game', 'checkUnlock');
  assert.match(corps, /if \(this\.mng\.client\.isWhite\(\)\) \{/);
  assert.match(corps, /if \(this\.level < 3 && !list\[this\.level \+ 1\]\) \{/);
  assert.match(corps, /this\.mng\.card\.\$mode\[n\]\[this\.level \+ 1\] = 1;/);
  assert.match(corps, /case 0: this\.addTitem\('\$butterfly' \+ \(n - 2\)\); break;/);
  assert.match(corps, /case 1: this\.addTitem\('\$smiley' \+ \(n - 2\)\); break;/);
  assert.match(corps, /const tzUnlockList = \[1, 4, 3, 2\];/);
  assert.match(corps, /this\.mng\.card\.\$tz\[id\] = 1;\s*this\.addTitem\('\$tz' \+ id\);/);
  assert.match(corps, /case 3: \{\s*const unlockList = \['\$basket', '\$bird', '\$ring', '\$ant'\];\s*this\.addTitem\(unlockList\[n - 2\]\);/);
  assert.match(methode(GAME, 'Game', 'addTitem'), /this\.mng\.client\.giveItem\(str\);/);
  assert.match(MANAGER, /this\.difNameList = \['facile', 'standard', 'difficile', 'infernal'\];/);
  assert.match(MANAGER, /if \(this\.client\.isWhite\(\)\) this\.client\.giveItem\('\$tz0'\);/);
});

test('modes.js : mêmes objectifs, mêmes conditions, mêmes n qu’en 2005', () => {
  for (const n of [2, 3, 4, 5]) {
    const o = OBJECTIFS[n];
    assert.match(MODES, new RegExp('this\\.goalList = \\[' + o.goalList.join(', ') + '\\];'), MODES_A_NIVEAUX[n] + ' goalList');
    const cond = o.gagne === '<=' ? 'this\\.score <= this\\.goalList\\[this\\.level\\]' : 'this\\.score > this\\.goalList\\[this\\.level\\]';
    assert.match(MODES, new RegExp('if \\(' + cond + '\\) this\\.checkUnlock\\(' + n + '\\);'), MODES_A_NIVEAUX[n] + ' → checkUnlock(' + n + ')');
  }
  const appels = [...MODES.matchAll(/checkUnlock\((\d)\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(appels, ['2', '3', '4', '5']);
  assert.equal((GAME.match(/checkUnlock\(\d\)/g) || []).length, 0, 'game.js ne l’appelle pas lui-même');
});

test('plateforme.js : giveItem note le Titem sur la fiche ($titem), que la fiche réparée porte toujours', () => {
  const corps = methode(PLATEFORME, 'Client', 'giveItem');
  assert.match(corps, /const carte = this\.slots\[0\];/);
  assert.match(corps, /if \(!Array\.isArray\(carte\.\$titem\)\) carte\.\$titem = \[\];/);
  assert.match(corps, /if \(!carte\.\$titem\.includes\(nom\)\) carte\.\$titem\.push\(nom\);/);
  assert.match(MANAGER, /if \(!Array\.isArray\(c\.\$titem\)\) c\.\$titem = \[\];/);
  // Et saveSlot(0) suit toujours l'accord : dans checkUnlock comme dans formatCard.
  assert.match(methode(GAME, 'Game', 'checkUnlock'), /this\.mng\.client\.saveSlot\(0\);\s*\}\s*$/);
  assert.match(methode(MANAGER, 'Manager', 'formatCard'), /this\.client\.giveItem\('\$tz0'\);\s*this\.client\.saveSlot\(0\);/);
});

// ── 3. Le portage, exécuté ─────────────────────────────────────────────────

function chargerClient() {
  const bac = { window: {}, Promise, JSON, Number, Array, Object, String, Error, Math, URLSearchParams, fetch: () => Promise.reject(new Error('hors ligne')) };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(PLATEFORME, bac, { filename: 'plateforme.js' });
  return bac.window.KalugaJeu.Client;
}

function ficheNeuve() {
  // Manager.formatCard, le strict nécessaire.
  return {
    $vs: 2, $tz: [1, 0, 0, 0, 0],
    $mode: [1, [1, 1, 1, 0, 0, 0, 0, 1, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]],
    $chrono: { $st: 2, $level: [[6000], [7000], [8000], [9000, 54000]] },
    $survival: { $st: 2, $level: [{ $s: 0, $t: 0 }, { $s: 0, $t: 0 }, { $s: 0, $t: 0 }, { $s: 0, $t: 0 }] },
    $invasion: { $st: 2, $level: [{ $s: 0, $t: 0 }, { $s: 0, $t: 0 }, { $s: 0, $t: 0 }, { $s: 0, $t: 0 }] },
    $ring: { $st: 2, $level: [{ $s: 600000, $t: 0 }, { $s: 600000, $t: 0 }, { $s: 600000, $t: 0 }, { $s: 600000, $t: 0 }] },
  };
}

// Une partie de Game réduite à ce que checkUnlock/addTitem touchent, avec les
// VRAIES méthodes du portage (extraites de game.js) et le VRAI Client.
function jeuFactice(Client, carte, { blanc = true } = {}) {
  const client = new Client('');
  client.isWhite = () => blanc;
  client.sauvegardes = 0;
  client.saveSlot = () => { client.sauvegardes++; return Promise.resolve(true); };
  client.slots[0] = carte;
  const jeu = {
    level: 0, endPanelMiddle: [],
    mng: { client, card: carte, difNameList: NIVEAUX, tzInfo: [{ name: 'Kaluga' }, { name: 'Piwali' }, { name: 'Nalika' }, { name: 'Gomola' }, { name: 'Makulo' }] },
  };
  jeu.checkUnlock = new Function('n', methode(GAME, 'Game', 'checkUnlock')).bind(jeu);
  jeu.addTitem = new Function('str', methode(GAME, 'Game', 'addTitem')).bind(jeu);
  return jeu;
}

test('exécuté : les seize cas (mode, niveau) donnent exactement le Titem de la table, et ouvrent le niveau suivant', () => {
  const Client = chargerClient();
  for (let n = 2; n <= 5; n++) {
    for (let niveau = 0; niveau < 4; niveau++) {
      const carte = ficheNeuve();
      const jeu = jeuFactice(Client, carte);
      jeu.level = niveau;
      jeu.checkUnlock(n);
      const attendu = titemAttendu(n, niveau);
      assert.deepEqual(carte.$titem, [attendu], MODES_A_NIVEAUX[n] + ' ' + NIVEAUX[niveau]);
      // Le niveau suivant s'ouvre (pas après l'infernal) ; les autres modes ne bougent pas.
      const modeAttendu = [1, 0, 0, 0];
      if (niveau < 3) modeAttendu[niveau + 1] = 1;
      assert.deepEqual(carte.$mode[n], modeAttendu, MODES_A_NIVEAUX[n] + ' ' + NIVEAUX[niveau] + ' $mode');
      for (let m = 2; m <= 5; m++) if (m !== n) assert.deepEqual(carte.$mode[m], [1, 0, 0, 0]);
      // La tzongre : au difficile seulement.
      const tzAttendu = [1, 0, 0, 0, 0];
      if (niveau === 2) tzAttendu[TZ_UNLOCK[n - 2]] = 1;
      assert.deepEqual(carte.$tz, tzAttendu, MODES_A_NIVEAUX[n] + ' ' + NIVEAUX[niveau] + ' $tz');
      // L'annonce, et la sauvegarde qui emporte la fiche.
      assert.ok(jeu.endPanelMiddle.some((o) => o.list[0].text.indexOf('Un nouveau Titem') === 0));
      assert.equal(jeu.mng.client.sauvegardes, 1);
    }
  }
});

test('exécuté : la FOURMI ne sort que de la Piste infernale — le difficile donne Nalika, l’Invasion infernale le Kaluga Spécial', () => {
  const Client = chargerClient();
  // La Piste, du facile à l'infernal, sur la même fiche.
  const carte = ficheNeuve();
  const jeu = jeuFactice(Client, carte);
  for (let niveau = 0; niveau < 4; niveau++) {
    jeu.level = niveau;
    jeu.checkUnlock(5);
    const aLaFourmi = carte.$titem.includes('$ant');
    assert.equal(aLaFourmi, niveau === 3, 'Piste ' + NIVEAUX[niveau] + ' : fourmi ' + aLaFourmi);
  }
  assert.deepEqual(carte.$titem, ['$butterfly3', '$smiley3', '$tz2', '$ant']);
  assert.deepEqual(carte.$mode[5], [1, 1, 1, 1]);
  // L'Invasion jusqu'au bout : pas de fourmi.
  const carte2 = ficheNeuve();
  const jeu2 = jeuFactice(Client, carte2);
  for (let niveau = 0; niveau < 4; niveau++) { jeu2.level = niveau; jeu2.checkUnlock(4); }
  assert.deepEqual(carte2.$titem, ['$butterfly2', '$smiley2', '$tz3', '$ring']);
  assert.ok(!carte2.$titem.includes('$ant'));
});

test('exécuté : hors session blanche, rien — ni Titem, ni niveau, ni sauvegarde', () => {
  const Client = chargerClient();
  const carte = ficheNeuve();
  const jeu = jeuFactice(Client, carte, { blanc: false });
  jeu.level = 3;
  jeu.checkUnlock(5);
  assert.equal(carte.$titem, undefined);
  assert.deepEqual(carte.$mode[5], [1, 0, 0, 0]);
  assert.equal(jeu.mng.client.sauvegardes, 0);
});

test('Client.giveItem : sans doublon, sans fiche rien, et $tz0 à la création', () => {
  const Client = chargerClient();
  const client = new Client('');
  // Pas de fiche : on ne plante pas et on n'invente rien.
  client.giveItem('$ant');
  assert.equal(client.slots[0], undefined);
  // Une fiche : la liste, dédoublonnée, les noms vides ignorés.
  client.slots[0] = ficheNeuve();
  client.giveItem('$tz0');
  client.giveItem('$ant');
  client.giveItem('$ant');
  client.giveItem('');
  client.giveItem(undefined);
  assert.deepEqual(client.slots[0].$titem, ['$tz0', '$ant']);
  // Une fiche d'époque avec un $titem abîmé : remplacé par une liste.
  client.slots[0] = Object.assign(ficheNeuve(), { $titem: 'n’importe quoi' });
  client.giveItem('$basket');
  assert.deepEqual(client.slots[0].$titem, ['$basket']);
});

// ── 4. Le serveur ──────────────────────────────────────────────────────────

// Le serveur lit-il la trace ? Tant que la rustine n'est pas appliquée, cette
// partie est sautée (avec le message), et le reste du fichier tient quand même.
const SERVEUR_LIT_TITEM = /game === 'kaluga'[\s\S]{0,4000}parsed\.\$titem/.test(SERVEUR);

function chargerExtracteur() {
  const iFn = SERVEUR.indexOf('function extractGameItemsFromSlot(');
  assert.ok(iFn >= 0, 'extractGameItemsFromSlot');
  // L'accolade du CORPS — pas celle du paramètre déstructuré `{ silent… }`.
  const iAcc = SERVEUR.indexOf(') {', iFn) + 2;
  const fn = SERVEUR.slice(iFn, iAcc) + bloc(SERVEUR, iAcc);
  const iInfo = SERVEUR.indexOf('const GAME_ITEM_INFO = {');
  assert.ok(iInfo >= 0, 'GAME_ITEM_INFO');
  const info = 'const GAME_ITEM_INFO = ' + bloc(SERVEUR, iInfo + 'const GAME_ITEM_INFO = '.length) + ';';
  const bac = {
    console: { log() {}, warn() {}, error() {} }, JSON, Number, Array, Object, String, Math,
    users: {}, db: {}, addAndNotifyUserLog() {}, USER_LOG_TYPE: { PICTO: 10 },
    parseMiniwavePipe() { return null; }, parseMinipixizPipe() { return null; }, parseMb2Pipe() { return null; },
    SWAPOU2_TITEMS: [], MB2_TITEMS: [],
  };
  vm.createContext(bac);
  vm.runInContext(info + '\n' + fn + '\nthis.extraire = extractGameItemsFromSlot; this.INFO = GAME_ITEM_INFO;', bac, { filename: 'server.js' });
  return {
    pictos(fiche, deja = []) {
      const u = { gameItems: deja.slice() };
      bac.extraire('pilote', 'kaluga', JSON.stringify(fiche), { silent: true, userOverride: u });
      return u.gameItems.filter((x) => !deja.includes(x)).sort();
    },
    INFO: bac.INFO,
  };
}

test('serveur : les 16 Titems et la kagulga sont dans GAME_ITEM_INFO, au jeu Kaluga', () => {
  const { INFO } = chargerExtracteur();
  for (const nom of TOUS_LES_TITEMS.concat(['$kagulga'])) {
    assert.ok(INFO[nom], nom);
    assert.equal(INFO[nom].game, 'Kaluga', nom);
  }
  assert.equal(INFO.$ant.name, 'Fourmi');
});

test('serveur : la fiche est lue comme le jeu l’écrit — la fourmi à la Piste INFERNALE gagnée, pas avant', { skip: SERVEUR_LIT_TITEM ? false : 'server.js ne lit pas encore $titem (rustine à appliquer : voir le rapport)' }, () => {
  const { pictos } = chargerExtracteur();
  // Une fiche neuve : rien des seize (le papillon n'est pas offert sans jouer).
  assert.deepEqual(pictos(Object.assign(ficheNeuve(), { $titem: ['$tz0'] })).filter((x) => TOUS_LES_TITEMS.includes(x)), []);
  // La Piste gagnée au facile : le papillon violet, et rien d'autre.
  const facile = ficheNeuve(); facile.$mode[5] = [1, 1, 0, 0];
  assert.deepEqual(pictos(facile), ['$butterfly3']);
  // La Piste gagnée jusqu'au DIFFICILE (l'infernal ouvert, pas gagné) : papillon,
  // drapeau, Nalika — PAS la fourmi.
  const difficile = ficheNeuve(); difficile.$mode[5] = [1, 1, 1, 1]; difficile.$tz[2] = 1;
  assert.deepEqual(pictos(difficile), ['$butterfly3', '$smiley3', '$tz2']);
  // L'infernal gagné (record du niveau 3 sous l'objectif de 90000) : la fourmi.
  const infernal = ficheNeuve(); infernal.$mode[5] = [1, 1, 1, 1]; infernal.$tz[2] = 1; infernal.$ring.$level[3] = { $s: 85000, $t: 2 };
  assert.deepEqual(pictos(infernal), ['$ant', '$butterfly3', '$smiley3', '$tz2']);
  // Au-dessus de l'objectif, ce n'est pas une victoire.
  const rate = ficheNeuve(); rate.$mode[5] = [1, 1, 1, 1]; rate.$ring.$level[3] = { $s: 90001, $t: 2 };
  assert.ok(!pictos(rate).includes('$ant'));
  // Les trois autres objets spéciaux, à leur infernal.
  const chrono = ficheNeuve(); chrono.$mode[2] = [1, 1, 1, 1]; chrono.$chrono.$level[3] = [5000, 41000];
  assert.ok(pictos(chrono).includes('$basket'));
  const survie = ficheNeuve(); survie.$mode[3] = [1, 1, 1, 1]; survie.$survival.$level[3] = { $s: 150001, $t: 4 };
  assert.ok(pictos(survie).includes('$bird'));
  const invasion = ficheNeuve(); invasion.$mode[4] = [1, 1, 1, 1]; invasion.$invasion.$level[3] = { $s: 180001, $t: 3 };
  assert.ok(pictos(invasion).includes('$ring'));
  // Juste à l'objectif : Chrono et Piste gagnent (<=), Survie et Invasion non (>).
  const egal = ficheNeuve();
  egal.$mode[2] = egal.$mode[3] = egal.$mode[4] = egal.$mode[5] = [1, 1, 1, 1];
  egal.$chrono.$level[3] = [42000]; egal.$survival.$level[3] = { $s: 150000, $t: 0 };
  egal.$invasion.$level[3] = { $s: 180000, $t: 0 }; egal.$ring.$level[3] = { $s: 90000, $t: 0 };
  const p = pictos(egal);
  assert.ok(p.includes('$basket') && p.includes('$ant') && !p.includes('$bird') && !p.includes('$ring'));
  // La trace du portage, telle quelle — mais seulement des Titems de Kaluga.
  assert.deepEqual(pictos(Object.assign(ficheNeuve(), { $titem: ['$ant', '$tz0', '$pixiz_item3', 'nimportequoi', '$kagulga'] })), ['$ant']);
  // Rien ne se perd : ce qu'on a déjà reste, le neuf seul est compté.
  assert.deepEqual(pictos(infernal, ['$ant', '$tz2']), ['$butterfly3', '$smiley3']);
  // La kagulga, elle, vient toujours du triathlon ($mode[1][8]).
  const tria = ficheNeuve(); tria.$mode[1][8] = 1;
  assert.deepEqual(pictos(tria), ['$kagulga']);
});
