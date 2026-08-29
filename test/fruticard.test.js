'use strict';
/*
 * LES FRUTICARDS — `Standard.getFrutiCardLines` (main.swf 0x5c370), portée.
 *
 * « Il s'agit des informations relatives aux jeux complets. Par exemple sur
 *   snake : combien de fruits ramassés, records... etc sur Burning Kiwi il me
 *   semble que les visuels des coupes apparaissent (à confirmer). »
 *
 * Confirmé : les coupes sont là, quatre, aux images 1 à 4 de `/sd/bkiwi_cup.swf`.
 *
 * Ce fichier ne teste pas « ça marche » mais « c'est bien ÇA » : chaque
 * assertion tient une valeur relevée dans le bytecode — une largeur, un ordre,
 * une faute d'orthographe d'époque —, de sorte qu'une retouche qui s'en écarte
 * se voie. Les offsets cités renvoient à `scratchpad/main-disasm.txt`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FC = require(path.join(ROOT, 'fruticard.js'));
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// Aplatit une carte pour interroger ses textes et ses images.
function textes(lignes) {
  const out = [];
  (function marche(ls) {
    (ls || []).forEach((l) => {
      if (!l || typeof l !== 'object') return;
      if (l.list) marche(l.list);
      else if (l.lineList) marche(l.lineList);
      else if (l.type === 'text') out.push(l.param.text);
    });
  })(lignes);
  return out;
}
function images(lignes) {
  const out = [];
  (function marche(ls) {
    (ls || []).forEach((l) => {
      if (!l || typeof l !== 'object') return;
      if (l.type === 'url') out.push(l);
      if (l.list) marche(l.list);
      if (l.lineList) marche(l.lineList);
    });
  })(lignes);
  return out;
}

/* ── LE DÉCOR COMMUN ──────────────────────────────────────────────────────── */

test('getTitleLine : deux espaces de 14, deux filets de 2, le texte au style 2', () => {
  // 0x5b60d. La largeur par défaut est `titre.length × 10`.
  const t = FC.getTitleLine('voitures');
  assert.deepStrictEqual(t.list.map((x) => x.type),
    ['spacer', 'line', 'text', 'line', 'spacer']);
  assert.strictEqual(t.list[0].width, 14);
  assert.strictEqual(t.list[4].width, 14);
  assert.strictEqual(t.list[1].size, 2);
  assert.strictEqual(t.list[2].width, 80);           // 8 lettres × 10
  assert.strictEqual(t.list[2].param.sid, 2);
  assert.strictEqual(t.list[2].param.textFormat.align, 'center');
  // La marge des filets : `getMargin()` puis y.min = 8, y.ratio = 1.
  assert.deepStrictEqual(t.list[1].param.margin, { y: { min: 8, ratio: 1 } });
  // Une largeur donnée l'emporte.
  assert.strictEqual(FC.getTitleLine('x', 200).list[2].width, 200);
});

test('getRecordLines : un titre, la valeur centrée sur 200, dix pixels d’air', () => {
  // 0x609e9 — TROIS lignes, pas une.
  const r = FC.getRecordLines('meileur score', '4210 points');
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[1].list[1].width, 200);
  assert.strictEqual(r[1].list[1].param.textFormat.align, 'center');
  assert.deepStrictEqual(r[2], { height: 10 });
});

test('les deux lignes de score : 160+60 large, 58+20 étroite', () => {
  // 0x6043b et 0x60563. La valeur est TOUJOURS à droite.
  const s = FC.getSimpleScoreLine('meilleur score :', 42);
  assert.deepStrictEqual(s.list.map((x) => x.width), [undefined, 160, 60, undefined]);
  assert.strictEqual(s.list[2].param.textFormat.align, 'right');
  const w = FC.getWildScoreLine('force', 7);
  assert.deepStrictEqual(w.list.map((x) => x.width), [58, 20]);
});

test('le chronomètre d’époque : minutes ’ secondes ’’ centièmes', () => {
  // `ext.util.MTNumber.getTimeStr(ms, "'", "''")`.
  assert.strictEqual(FC.tempsStr(0), "0'00''00");
  assert.strictEqual(FC.tempsStr(65432), "1'05''43");
  assert.strictEqual(FC.tempsStr(600000), "10'00''00");
});

test('getKalugaModeLines se TAIT quand elle n’a rien à dire', () => {
  // 0x6064b : un niveau à 0 ou à 600000 ne compte pas, et un tableau réduit à
  // son seul titre est jeté (`length == 1` → `new Array()`).
  assert.deepStrictEqual(FC.getKalugaModeLines('chrono', { $level: [] }, 'time'), []);
  assert.deepStrictEqual(
    FC.getKalugaModeLines('chrono', { $level: [{ $s: 0 }, { $s: 600000 }] }, 'time'), []);
  const l = FC.getKalugaModeLines('olympique',
    { $level: [{ $name: 'plantapomme', $t: 2, $s: 412 }] }, 'cm');
  assert.strictEqual(l.length, 2);
  assert.deepStrictEqual(textes(l), ['olympique', 'plantapomme', '412 cm']);
  // Le tzongre : image `$t + 1` de `kaluga_tz`.
  assert.strictEqual(images(l)[0].param.param.frame, 3);
  assert.strictEqual(images(l)[0].src, '/fb/sd/kaluga_tz_nalika.png');
});

/* ── LES SEPT CARTES ──────────────────────────────────────────────────────── */

test('Grapiz et Frutibandas n’ont PAS de carte', () => {
  // Leur branche (0x5d4e8) retombe sur le retour commun : rien.
  assert.strictEqual(FC.aUneCarte('grapiz'), false);
  assert.strictEqual(FC.aUneCarte('bandas'), false);
  assert.deepStrictEqual(FC.lignes('grapiz', {}, 'x'), []);
  assert.strictEqual(FC.aUneCarte('bkiwi'), true);
});

test('Burning Kiwi : les quatre coupes, les cinq voitures, les circuits', () => {
  const carte = FC.lignes('bkiwi', {
    $wss: true, $ws: false, $wcs: false, $wc: true,
    $ac: [true, false, false, false, false],
    $ts: { $t0: { $fcLap: 61230, $fcTotal: 187400, $lapCar: 1, $totalCar: 4 } },
  }, 'Zorro');
  const im = images(carte);
  // Les coupes viennent EN PREMIER, images 1 à 4, dans l'ordre des clés
  // ["$wss","$ws","$wcs","$wc"] — celui du bytecode, à l'envers de la poussée.
  assert.deepStrictEqual(im.slice(0, 4).map((x) => x.src), [
    '/fb/sd/bkiwi_cup_1.png', '/fb/sd/bkiwi_cup_2.png',
    '/fb/sd/bkiwi_cup_3.png', '/fb/sd/bkiwi_cup_4.svg',
  ]);
  // `available` suit la clé : gagnée pleine, pas gagnée effacée.
  assert.deepStrictEqual(im.slice(0, 4).map((x) => x.param.param.available),
    [true, false, false, true]);
  // Les voitures : le même 20/100 que le SWF pose sur ses écussons.
  const voitures = im.slice(4, 9);
  assert.deepStrictEqual(voitures.map((x) => x.param.param.data[0]), FC.ECURIES_BKIWI);
  assert.deepStrictEqual(voitures.map((x) => x.param.param._alpha), [100, 20, 20, 20, 20]);
  assert.strictEqual(voitures[0].src, '/fb/sd/bkiwi_car_ultra-orange.png');
  // Le circuit joué donne DEUX lignes — le tour puis la course — chacune avec
  // la voiture qui l'a faite.
  const t = textes(carte);
  assert.ok(t.includes('green hill'), 'le circuit joué est titré');
  assert.ok(t.includes('meilleur tour :') && t.includes('meilleur course :'));
  assert.ok(t.includes(FC.tempsStr(61230)) && t.includes(FC.tempsStr(187400)));
  // …et les cinq autres circuits, jamais courus, ne paraissent pas.
  assert.ok(!t.includes('solstice'), 'un circuit sans $fcLap fini est sauté');
});

test('Frutisnake : les points ramassés, la collection, le plus gros fruit', () => {
  // `$fruits` est INDEXÉ PAR FRUIT. On en découvre quatre, dont un pourri.
  const f = [];
  [3, 42, 288, 331].forEach((id) => { f[id] = FC.pointsFruit(id); });
  const t = textes(FC.lignes('snake3', { $fruits: f, $record: 48210 }, 'Zorro'));
  // Le premier texte additionne les POINTS, il ne compte pas les fruits.
  const somme = 15 + 220 + 8800 - 2750;
  assert.strictEqual(t[0], 'Zorro a ramassé ' + somme + ' fruits !');
  // La faute est d'époque : « meileur », un seul L.
  assert.ok(t.includes('meileur score'), '« meileur » avec un seul L');
  assert.ok(t.includes('48210 points'));
  assert.ok(t.includes('4 sur 322 ont été découverts'));
  // Le pourcentage colle son « % » au chiffre — c'est `getTimeStr` du pauvre :
  // `round(n/322*1000)/10 + "%"`, puis « ( … ) » autour.
  assert.ok(t.includes('( 1.2% )'), 'le % est collé : ' + t.join(' | '));
  // Le plus gros : 288 (les pourris, au-delà de 300, ne comptent pas).
  assert.ok(t.includes('le plus gros fruit') && t.includes('8800 points'));
});

test('le barème des fruits est celui du jeu', () => {
  // `Const.fruit_points` (public/snake3/const.js) et le bytecode (0x5cf13)
  // disent la même chose ; le serveur en a besoin pour garnir `$fruits`.
  const C = require(path.join(ROOT, 'public/snake3/const.js'));
  for (const id of [0, 1, 40, 41, 90, 91, 150, 151, 220, 221, 260, 261, 300, 321, 342]) {
    assert.strictEqual(FC.pointsFruit(id), C.fruit_points(id), 'fruit ' + id);
  }
});

test('Swapou : les sept persos en cercle, les verrouillés à l’image i+10', () => {
  const carte = FC.lignes('swapou2',
    { $chars: [true, false, true, false, false, false, false],
      $record: 900, $classic_record: 400, $swap: 12 }, 'Zorro');
  const im = images(carte);
  assert.strictEqual(im.length, 7);
  assert.deepStrictEqual(im.map((x) => x.param.param.frame), [0, 11, 2, 13, 14, 15, 16]);
  // Le cercle : rayon 60, centre (0, 80), premier angle −2 radians.
  assert.strictEqual(Math.round(im[0].dx), Math.round(Math.cos(-2) * 60));
  assert.strictEqual(Math.round(im[0].dy), Math.round(80 + Math.sin(-2) * 60));
  const t = textes(carte);
  assert.deepStrictEqual(t, ['personnages', 'normal', '900 points',
    'classic', '400 points', 'swaps', '12 swaps']);
});

test('MotionBall : le cinquième donjon se glisse au MILIEU', () => {
  // `list.splice(5, 0, tuile, spacer)` — un choix d'époque, pas une coquille.
  const carte = FC.lignes('mb2', {
    $dungeons_done: [true, false, false, false, true],
    $records: [[{ $t: 1234, $c: true }, { $t: 999 }]],
    $classic_score: 17,
  }, 'Zorro');
  const im = images(carte);
  assert.deepStrictEqual(im.map((x) => x.param.nom),
    ['1_done', '2', '5_done', '3', '4']);
  assert.strictEqual(im[0].src, '/sd/mb2/1_done.png');
  const t = textes(carte);
  // Le premier record NON challenge de la course jaune, et lui seul.
  assert.ok(t.includes('jaune') && t.includes(FC.tempsStr(9990)));
  assert.ok(!t.includes(FC.tempsStr(12340)), 'un temps `$c` ne compte pas');
  assert.ok(t.includes('17 niveaux'));
});

test('Kaluga : les modes qui ont servi, et le panier', () => {
  const carte = FC.lignes('kaluga', {
    $classic: { $s: 3200, $t: 1 },
    $trial: { $tria: { $s: 0 }, $hept: { $s: 900, $t: 2 },
      $list: [{ $tz: [{ $s: 120 }, { $s: 340 }] }] },
    $stat: { $fruit: 4096 },
  }, 'Zorro');
  const t = textes(carte);
  assert.ok(t.includes('épreuve') && t.includes('essai') && t.includes('3200 pts'));
  assert.ok(t.includes('heptathlon') && t.includes('900 pts'));
  assert.ok(!t.includes('triathlon'), 'un mode à 0 ne paraît pas');
  assert.ok(t.includes('olympique') && t.includes('lancer de vers') && t.includes('340 cm'));
  assert.ok(t.includes('panier') && t.includes('4096 fruits !'));
  // Le panier suit `floor(fruits^0.3)`.
  const panier = images(carte).filter((x) => x.param.url === 'kaluga_panier')[0];
  assert.strictEqual(panier.param.param.frame, Math.floor(Math.pow(4096, 0.3)));
  assert.deepStrictEqual(panier.param.min, { w: 160, h: 130 });
});

test('MiniWave : une section vide REPREND son titre', () => {
  // `if (empty) lines.pop()` — deux fois, pour « bonus » et « spécial ».
  const vide = textes(FC.lignes('miniwave',
    { $lvl: 3, $ship: [1, 0], $arcade: { $bestScore: 12, $bestLevel: 4 },
      $cons: { $bonus: [0, 0] }, $letter: 0, $survival: 0, $time: 0,
      $badsKill: [] }, 'Zorro'));
  assert.ok(!vide.includes('bonus') && !vide.includes('spécial'));
  assert.ok(vide.includes('arcade') && vide.includes('tableau de chasse'));
  const plein = textes(FC.lignes('miniwave',
    { $lvl: 3, $ship: [1, 1], $arcade: {}, $cons: { $bonus: [80, 0] },
      $letter: 5, $survival: 0, $time: 0,
      $badsKill: [7, 3, 0] }, 'Zorro'));
  assert.ok(plein.includes('bonus') && plein.includes('mission 1 :') && plein.includes('80 %'));
  assert.ok(plein.includes('spécial') && plein.includes('mode lettre'));
  // Le tableau de chasse s'arrête à `length − 1` : le dernier ne sort jamais.
  assert.ok(plein.includes('Fraise-bouclier') && plein.includes('Orangeonaute'));
  assert.strictEqual(FC.MINIWAVE_BADS.length, 51);
  assert.strictEqual(FC.MINIWAVE_BADS[0], 'Fraise-bouclier');
  assert.strictEqual(FC.MINIWAVE_BADS[50], 'Letter-monster');
});

test('MiniPixiz : le grade, la fée courante, les statistiques', () => {
  const carte = FC.lignes('minipixiz', {
    $stat: { $run: 900, $forestMax: 4, $treeMax: 2, $misNum: 3,
      $item: [1, null, 3], $eat: [null, 2], $game: [12, 0, 5], $kill: [9, 1, 0, 0, 0] },
    $dungeon: { $lvl: 2, $loop: 1 },
    $time: { $d: 41 }, $diam: 2, $star: 1, $current: 0,
    $faerie: [{ $name: 'Zia', $level: 3, $skin: [2, 1, 4, 6],
      $carac: [10, 11, 12, 13, 14, 15], $spell: [0, 5] }],
  }, 'Zorro');
  const t = textes(carte);
  // `floor(min(900^0.16, 8))` = 3 → « Chercheur en esoterisme ».
  assert.strictEqual(t[0], FC.MINIPIXIZ_GRADES[Math.floor(Math.min(Math.pow(900, 0.16), 8))]);
  assert.ok(t.includes('Zia ( niveau 4 )'), 'le niveau est affiché +1');
  assert.ok(t.includes('force') && t.includes('mana'));
  assert.ok(t.includes('record forêt') && t.includes('niv. 5'), '+1 sur la forêt');
  assert.ok(t.includes('record arbre creux') && t.includes('niv. 2'), 'rien sur l’arbre');
  assert.ok(t.includes('donjons terminés') && t.includes('7'), '2 + 1×5');
  assert.ok(t.includes('objets différents') && t.includes('plats différents'));
  assert.ok(t.includes('parties forêts') && t.includes('parties donjon'));
  assert.ok(!t.includes('parties bassin'), 'un lieu jamais joué ne paraît pas');
  assert.ok(t.includes('diablotin') && t.includes('furie'));
});

/* ── LE SERVEUR ───────────────────────────────────────────────────────────── */

test('la fiche liste les jeux, et une route rend la carte', () => {
  assert.match(SERVEUR, /const FCard = require\('\.\/fruticard\.js'\);/);
  assert.match(SERVEUR, /const FCARD_DESSINABLES = FCARD_GAMES\.filter\(\(g\) => FCard\.aUneCarte\(g\)\);/);
  assert.match(SERVEUR, /fcards: FCARD_DESSINABLES\.map\(\(g\) => \(\{ id: g, nom: FCard\.nomJeu\(g\) \}\)\)/);
  assert.match(SERVEUR, /app\.get\('\/api\/light\/fruticard', async \(req, res\) => \{/);
  assert.match(SERVEUR, /lignes: FCard\.lignes\(jeu, carte, getDisplayName\(u\)\),/);
  // La sauvegarde vient des MÊMES trois sources que `fcardgetpublicslot`.
  assert.match(SERVEUR, /if \(!FCard\.aUneCarte\(jeu\)\) return res\.status\(400\)\.json\(\{ ok: false, error: 'jeu' \}\);/);
  assert.match(SERVEUR, /carte = JSON\.parse\(patchSlot0\(u, jeu, brut, ctx\)\) \|\| \{\};/);
});

test('`patchSlot0` garnit `$fruits` PAR FRUIT', () => {
  // Une liste dense d'identifiants faisait dire « 5 fruits ramassés » à un
  // joueur qui en avait des milliers, et trompait « le plus gros fruit ».
  assert.match(SERVEUR, /saved\.\$fruits = \[\];\s*\n\s*for \(const id of trouves\) \{\s*\n\s*if \(id >= 0 && id < 343\) saved\.\$fruits\[id\] = FCard\.pointsFruit\(id\);/);
  // Et Burning Kiwi reçoit ses deux indices d'écurie, mais pas de temps
  // inventé : la carte saute d'elle-même un circuit sans `$fcLap`.
  assert.match(SERVEUR, /if \(saved\.\$ts\[key\]\.\$lapCar === undefined\) saved\.\$ts\[key\]\.\$lapCar = 0;/);
  assert.match(SERVEUR, /if \(saved\.\$ts\[key\]\.\$totalCar === undefined\) saved\.\$ts\[key\]\.\$totalCar = 0;/);
  assert.doesNotMatch(SERVEUR, /\$fcLap = /);
});

/* ── LE LIGHT ─────────────────────────────────────────────────────────────── */

test('la section « Fruticard ! » est là, après les scores du jour', () => {
  // 0x5b040 : médailles, scores du jour, PUIS les cartes.
  const f = /} else if \(ficheEtat\.onglet === "scores"\) \{[\s\S]*?\n    \} else if \(ficheEtat\.onglet === "bonus"\)/.exec(LIGHT);
  assert.ok(f, 'l’onglet Scores doit exister');
  assert.ok(f[0].indexOf('Scores du jour') < f[0].indexOf('Fruticard !'),
    'les cartes viennent après les scores du jour');
  assert.match(f[0], /var cartes = \(d\.scores && d\.scores\.fcards\) \|\| \[\];/);
  assert.match(f[0], /b\.textContent = g\.nom \|\| g\.id;/);
});

test('la carte REMPLACE la page, et éteint les onglets', () => {
  // `onFrutiCard` (0x612cc) pose un `pageObj` neuf précédé du seul
  // `getMenuLine("queDalle")` : aucune catégorie en surbrillance.
  assert.match(LIGHT, /if \(ficheEtat\.carte\) \{[\s\S]*?b\.classList\.remove\("actif"\);[\s\S]*?page\.appendChild\(dessinerCarte\(ficheEtat\.carte\)\);/);
  // …et un onglet la quitte.
  assert.match(LIGHT, /if \(onglet\) \{ f\.onglet = onglet; f\.carte = null; renderFiche\(\); return; \}/);
});

test('le dessinateur parle le vocabulaire de `cpDocument`', () => {
  const f = /function dessinerLignes\(lignes, dans\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(f, 'dessinerLignes doit exister');
  // Les six formes du bytecode : rangée, colonne, texte, image, filet, blanc.
  assert.match(f[0], /if \(l\.list\) \{/);
  assert.match(f[0], /if \(l\.type === "page"\) \{/);
  assert.match(f[0], /if \(l\.type === "text"\) \{/);
  assert.match(f[0], /if \(l\.type === "url"\) \{/);
  assert.match(f[0], /if \(l\.type === "line"\) \{/);
  assert.match(f[0], /if \(l\.type === "spacer" \|\| l\.big !== undefined\) \{/);
  // `sid` 2 = le style des titres ; `big` = un `flex-grow`, ce qui centre.
  assert.match(f[0], /Number\(l\.param && l\.param\.sid\) === 2 \? " fc-titre" : ""/);
  assert.match(f[0], /if \(l\.big\) s\.style\.flexGrow = String\(l\.big\);/);
  // Une bibliothèque pas encore extraite laisse la PLACE, pas une image cassée.
  assert.match(f[0], /im\.onerror = function \(\) \{ im\.remove\(\); \};/);
  // Et l'écart assumé est nommé.
  assert.match(LIGHT, /ÉCART ASSUMÉ : l'époque ne NOMME pas la carte/);
});

test('les dessins déjà sortis du SWF sont sur le disque', () => {
  const attendus = ['bkiwi_cup_1.png', 'bkiwi_cup_2.png', 'bkiwi_cup_3.png',
    'bkiwi_cup_4.svg', 'bkiwi_car_ultra-orange.png', 'swapou_char_0.png',
    'swapou_char_inconnu.png', 'kaluga_tz_nalika.png'];
  for (const f of attendus) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/fb/sd', f)), f + ' manque');
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'public/sd/mb2/1_done.png')));
});

test('ce qui n’est pas extrait rend `null`, pas une adresse morte', () => {
  // Cinq bibliothèques de `/sd/` restent à sortir : ce sont des clips COMPOSÉS,
  // pas des feuilles à une forme par image. Leurs lignes gardent leur place.
  for (const lib of ['miniwave_rank', 'miniwave_ship', 'miniwave_bads',
    'kaluga_panier', 'minipixiz_award', 'minipixiz_spell', 'minipixiz_faeries',
    'minipixiz_luz']) {
    assert.strictEqual(FC.resoudre(lib, { frame: 1 }), null, lib);
  }
});
