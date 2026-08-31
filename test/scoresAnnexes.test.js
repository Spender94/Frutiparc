'use strict';
/*
 * LES COLONNES ANNEXES DU TABLEAU DES SCORES
 *
 * `cp.Score` (sprite#900) compose chaque ligne dans cet ordre — relevé au
 * bytecode, aux deux `InitArray` de 0xc326e (l'en-tête) et 0xc360a (la ligne) :
 *
 *     rang | frutibouille | Frutiz | Score | <colonnes annexes> | Heure
 *
 * Les colonnes annexes viennent du `<ds>` que le serveur décrit par jeu, et
 * une colonne `t="s"` n'est pas du texte mais un DESSIN : le SWF fabrique un
 * élément `url` d'adresse `/sd/<bibliothèque>.swf` (`Path.scoreDataMisc`,
 * 0xc37a7) et lui passe la donnée annexe de la ligne dans `param.data`.
 *
 * TROIS JEUX en ont, et c'est ce qui manquait au portage :
 *
 *     gs 0  Burning Kiwi   Ecurie (60) · Rang (60)
 *     gs 3  Swapou 2       Perso (45)
 *     gs 4  Kaluga         Tzongre (60)
 *
 * LES QUATRE CONTRATS, tirés de l'image 1 de chaque bibliothèque :
 *
 *   kaluga_tz          data[0].toLowerCase() → kaluga 1 · piwali 2 · nalika 3
 *                      · gomola 4 · makulo 5, sinon 0 ; gotoAndStop(10 + n) —
 *                      l'image 10 étant celle du préchargement, la « pierre ».
 *   bkiwi_team         data[0].toLowerCase() → ultra orange 1 · uwe wing 2
 *                      · fury hun 3 · sonic brain 4 · kiwix 5. `teams` ET
 *                      `cars` vont sur cette image, puis `teams._visible =
 *                      false` : on voit la VOITURE, et `this.onRelease`
 *                      bascule sur l'écusson. Nom inconnu → les deux
 *                      disparaissent.
 *   bkiwi_rank         pos = parseInt(data[2]) · perf = parseInt(data[1]) ;
 *                      `rank.pos.gotoAndStop(pos)` (5 images, la cinquième
 *                      VIDE) et `rank.perfects.gotoAndStop(perf)` (6 images).
 *                      Un `pos` illisible efface tout (`rank._visible=false`).
 *   swapou_score_chars chars.gotoAndStop(parseInt(data[0]) + 2), 8 images —
 *                      la première est le refus (la croix rouge).
 *
 * LE PIÈGE : la donnée arrive SÉRIALISÉE. `cp.Score` fait
 * `MTSerialization.unserialize(attributes.d)` avant de la passer, et
 * « Skiwix:5:1: » devient « kiwix:5:1: ». Sans ce dépouillement, `data[0]`
 * vaut « Skiwix » et aucune écurie ne se reconnaît — les colonnes restaient
 * vides, ou tombaient toutes sur l'image d'inconnu.
 *
 * LES DESSINS viennent de ces SWF mêmes, rendus état par état sous Ruffle
 * (scripts/extract-scores-sd.js) : ni `kaluga_tz` (aucun sprite, cinq images
 * de pellicule racine), ni `swapou_score_chars` (des bitmaps), ni `bkiwi_rank`
 * (deux polices embarquées) ne passent par l'aplatisseur de formes.
 *
 * LE MOBILE NE BOUGE PAS : sans `body.bureau-frutiz`, aucune colonne annexe
 * n'est écrite et la grille reste celle d'avant, au pixel près.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const EXTRACTEUR = fs.readFileSync(path.join(ROOT, 'scripts/extract-scores-sd.js'), 'utf8');

/* ── 1. LE SERVEUR ────────────────────────────────────────────────────────── */

test('le gabarit des colonnes est UNIQUE : le bureau et le light y puisent', () => {
  // Les largeurs et les noms sont ceux du `<desc>` d'époque, à la lettre.
  assert.match(SERVEUR, /const SCORE_DATA_SPEC = \{\s*\n\s*0: \[\{ n: 'Ecurie', w: 60, lib: 'bkiwi_team' \}, \{ n: 'Rang', w: 60, lib: 'bkiwi_rank' \}\],\s*\n\s*3: \[\{ n: 'Perso', w: 45, lib: 'swapou_score_chars' \}\],\s*\n\s*4: \[\{ n: 'Tzongre', w: 60, lib: 'kaluga_tz' \}\],\s*\n\s*\};/);
  // `buildLegacyGameScoreInfo` ne redit plus les colonnes : il les LIT.
  assert.match(SERVEUR, /const inner = \(SCORE_DATA_SPEC\[game\] \|\| \[\]\)\s*\n\s*\.map\(\(c\) => `<desc n="\$\{c\.n\}" t="s" w="\$\{c\.w\}">\$\{c\.lib\}<\/desc>`\)\.join\(''\);/);
  assert.doesNotMatch(SERVEUR, /inner \+= '<desc n="Ecurie"/);
});

test('Burning Kiwi et Kaluga empruntent le descripteur de leur rk d’époque', () => {
  // Le light classe sur `bkiwi_track<N>_challenge` : sans cette normalisation,
  // aucun de ces classements n'aurait de colonne.
  // KALUGA a le même besoin depuis qu'il a deux classements : « Freestyle »,
  // né du partage avec/sans grappe, n'est dans aucun descripteur d'époque et
  // n'avait donc pas de colonne Tzongre du tout.
  const f = /function scoreDataSpecFor\(rankingId\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'scoreDataSpecFor doit exister');
  assert.match(f[0], /\/\^bkiwi_\/\.test\(id\) \? 'bkiwi_track5_classic'/);
  assert.match(f[0], /\/\^kaluga_\/\.test\(id\) \? 'kaluga_classic'/);
  assert.match(SERVEUR, /return \(d && SCORE_DATA_SPEC\[Number\(d\.gs\)\]\) \|\| null;/);
});

test('l’API envoie la donnée annexe par ligne, et le gabarit par jeu', () => {
  // La donnée n'est envoyée QUE si le jeu a une colonne pour la recevoir :
  // ailleurs elle n'a pas de rendu et n'aurait qu'alourdi la réponse.
  assert.match(SERVEUR, /if \(scoreDataSpecFor\(rkId\)\) l\.extra = formatRankingExtraData\(rkId, e\.data, e\.s\);/);
  assert.match(SERVEUR, /extras: scoreDataSpecFor\(rkId\) \|\| undefined,/);
});

/* ── 2. LES QUATRE CONTRATS, REJOUÉS ──────────────────────────────────────── */

test('la donnée est DÉSÉRIALISÉE avant d’être découpée', () => {
  const bloc = LIGHT.slice(LIGHT.indexOf('function sdDeserialiser'), LIGHT.indexOf('function vignetteScoreData'));
  assert.match(bloc, /var m = \/\^S\(\[\^;\]\*\)\$\/\.exec\(s\);/);
  assert.match(bloc, /m = \/\^N\(-\?\\d\+\(\?:\\\.\\d\+\)\?\)\$\/\.exec\(s\);/);
  assert.match(LIGHT, /var d = sdDeserialiser\(data\)\.split\(":"\);/);
});

test('les cinq tzongres et les cinq écuries, dans l’ordre du bytecode', () => {
  assert.match(LIGHT, /var SD_TZONGRES = \["kaluga", "piwali", "nalika", "gomola", "makulo"\];/);
  assert.match(LIGHT, /var SD_ECURIES = \["ultra orange", "uwe wing", "fury hun", "sonic brain", "kiwix"\];/);
  // Un nom hors liste : Kaluga montre son image de préchargement, Burning Kiwi
  // ne montre RIEN (les deux clips passent invisibles).
  assert.match(LIGHT, /return i < 0 \? vignetteSd\(lib, "kaluga_tz_inconnu"\)/);
  assert.match(LIGHT, /if \(e < 0\) return "";/);
});

test('le bornage de gotoAndStop est celui de Flash', () => {
  // Au-delà de la dernière image on RESTE dessus, en deçà de la première on
  // revient à elle, et un NaN ne bouge pas — or ces clips partent tous de leur
  // première image : les trois cas se ramènent au même.
  assert.match(LIGHT, /function sdBorner\(n, max\) \{\s*\n\s*return isFinite\(n\) \? Math\.max\(1, Math\.min\(max, n\)\) : 1;\s*\n\s*\}/);
  assert.match(LIGHT, /"bkiwi_rank_" \+ sdBorner\(pos, 5\) \+ "_" \+ sdBorner\(perf, 6\)/);
  assert.match(LIGHT, /var f = sdBorner\(parseInt\(d\[0\], 10\) \+ 2, 8\);/);
  // `pos` illisible → `rank._visible = false`.
  assert.match(LIGHT, /if \(isNaN\(pos\)\) return "";/);
});

test('l’écurie se retourne au clic — la voiture, puis l’écusson', () => {
  assert.match(LIGHT, /return vignetteSd\(lib, "bkiwi_car_" \+ k, SD_ECURIES\[e\], "bkiwi_team_" \+ k\);/);
  assert.match(LIGHT, /img\.setAttribute\("data-bascule", img\.getAttribute\("src"\)\);/);
  assert.match(LIGHT, /\.sc-ligne \.d img\.sd\[data-bascule\] \{ cursor: pointer; \}/);
});

/* ── 3. LA COLONNE DANS LA GRILLE ─────────────────────────────────────────── */

test('les colonnes annexes se glissent entre le score et l’heure', () => {
  assert.match(LIGHT, /grid-template-columns: var\(--sc-rang, 25px\) 20px minmax\(0,1fr\) auto var\(--sc-annexes, \) 38px;/);
  /* Sur le BUREAU, les largeurs d'époque au pixel (`win.Score.display`) : le
     score à 85, l'heure à 60, le pseudo à 100 au minimum, et pas de gouttière.

     LE SCORE PART DE 85 ET S'ÉTIRE. Ces quatre-vingt-cinq pixels suffisent à
     un nombre — c'est tout ce que le SWF y met. Deux de nos classements y
     écrivent davantage : Mini-Fever raconte d'où viennent les points
     (« 2 370 · 79 épreuves en difficile ») et MiniWave y ajoute le niveau
     atteint, faute de colonne annexe dans le gabarit `gs='1'`. Cent soixante
     pixels de texte dans une case de quatre-vingt-cinq, et le libellé passait
     PAR-DESSUS l'heure. `max-content` rend à la piste ce que son contenu
     demande ; la colonne Frutiz, qui prend le reste, cède d'autant — un score
     court ne bouge donc pas d'un pixel. */
  assert.match(LIGHT, /body\.bureau-frutiz #sc-table \.sc-entete,\n\s+body\.bureau-frutiz #sc-table \.sc-ligne \{\n\s+grid-template-columns: var\(--sc-rang, 25px\) 20px minmax\(100px,1fr\)\n\s+minmax\(85px, max-content\) var\(--sc-annexes, \) 60px;\n\s+gap: 0;/);
  // L'en-tête et la ligne portent les mêmes cellules, au même rang.
  // Le titre de la colonne n'est plus le mot « Score » en dur : il vient de
  // `score.score_type.<t>` (lang_french.as) — « Temps » pour un chrono,
  // « Consécration » pour la consécration, « Expérience » pour l'XP.
  assert.match(LIGHT, /\+ '<span class="s">' \+ xmlEscape\(titreColonneScore\(g\)\) \+ '<\/span>'\s*\n\s*\+ annexes\.map/);
  assert.match(LIGHT, /\+ '<span class="s">' \+ xmlEscape\(s\.label\) \+ '<\/span>'\s*\n\s*\+ annexes\.map/);
});

test('le mobile n’en montre aucune : la grille y reste celle d’avant', () => {
  assert.match(LIGHT, /var annexes = \(document\.body\.classList\.contains\("bureau-frutiz"\) && g\.extras\) \|\| \[\];/);
  assert.match(LIGHT, /box\.style\.removeProperty\("--sc-annexes"\);/);
});

/* ── 4. LES DESSINS ───────────────────────────────────────────────────────── */

test('les cinquante-quatre vignettes sont là, à la taille de leur scène', () => {
  const dir = path.join(ROOT, 'public/fb/sd');
  const attendus = [];
  for (const tz of ['kaluga', 'piwali', 'nalika', 'gomola', 'makulo']) attendus.push('kaluga_tz_' + tz);
  attendus.push('kaluga_tz_inconnu');
  for (const e of ['ultra-orange', 'uwe-wing', 'fury-hun', 'sonic-brain', 'kiwix']) {
    attendus.push('bkiwi_car_' + e, 'bkiwi_team_' + e);
  }
  for (let pos = 1; pos <= 5; pos++) {
    for (let perf = 1; perf <= 6; perf++) attendus.push('bkiwi_rank_' + pos + '_' + perf);
  }
  for (let c = 0; c <= 6; c++) attendus.push('swapou_char_' + c);
  attendus.push('swapou_char_inconnu');
  assert.strictEqual(attendus.length, 54);
  for (const nom of attendus) {
    assert.ok(fs.existsSync(path.join(dir, nom + '.png')), nom + '.png manque');
  }
  // La scène de chaque bibliothèque, en pixels — le portage les pose à cette
  // taille-là, et les fichiers sont rendus au double (écrans denses).
  assert.match(LIGHT, /kaluga_tz: \[18, 18\], bkiwi_team: \[20, 20\],/);
  assert.match(LIGHT, /bkiwi_rank: \[30, 20\], swapou_score_chars: \[20, 20\],/);
});

test('l’écusson vient d’un octet retourné, pas d’un clic simulé', () => {
  // `teams._visible = false` du script d'image 3 devient `cars._visible =
  // false` dans une copie servie le temps de la séance : c'est le seul moyen
  // sûr d'obtenir le second dessin, et le SWF du dépôt n'est pas touché.
  assert.match(EXTRACTEUR, /function swfEcusson\(\) \{/);
  assert.match(EXTRACTEUR, /const motif = Buffer\.from\(\[0x96, 2, 0, 8, iTeams, 0x1C,\s*\n\s*0x96, 4, 0, 8, iVis, 5, 0, 0x4F, 0x96, 2, 0, 8, iThis\]\);/);
  assert.match(EXTRACTEUR, /if \(touche !== 1\) throw new Error/);
  // Le fichier d'origine reste intact.
  const swf = fs.readFileSync(path.join(ROOT, 'public/swf/sd/bkiwi_team.swf'));
  assert.strictEqual(swf.slice(0, 3).toString('ascii'), 'CWS');
});
