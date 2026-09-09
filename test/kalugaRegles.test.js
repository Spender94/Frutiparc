/*
 * KALUGA — TROIS RÈGLES DU PORTAGE QUI S'ÉCARTENT DE 2005, à la demande.
 *
 * Le portage reproduit le Flash au mot près ; ces trois points sont des
 * ÉCARTS VOULUS, décidés pour la version light, et il faut qu'on sache qu'ils
 * sont là — d'où ce fichier, qui les épingle un par un.
 *
 *   1. LE FIL : les fils directs d'abord, et des chaînes égales. Le `search`
 *      d'époque laissait la première pomme accrochée allonger sa chaîne
 *      pendant que la tzongre rechargeait son deuxième fil ; huit pommes
 *      partaient en 3 + 5 avec un papillon jaune, en 1-2-5 avec deux. La
 *      tzongre impose maintenant son ordre — les pommes, elles, cherchent
 *      exactement comme avant.
 *   2. LA POMME D'OR pèse ce que vaut le jeu du joueur : la moyenne de ses
 *      combos, grappes exclues, bornée entre un et deux — là où 2005 lui
 *      laissait le reste d'un tirage. Le PRIX, lui, reste celui d'époque (dix
 *      fois cent fois le poids), si bien que sa taille dit sa valeur.
 *   3. LE TÉMOIN DE GRAPPE : le portage envoie aussi la PLUS GROSSE grappe
 *      (« tz:g:max »), pour que le partage Grappe / Freestyle se lise à la
 *      taille près (le OU du disque Flash ne sait pas dire « sept »).
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SPRITES = lire('public/kaluga/jeu/sprites.js');
const MODES = lire('public/kaluga/jeu/modes.js');
const GAME = lire('public/kaluga/jeu/game.js');
const PLATEFORME = lire('public/kaluga/plateforme.js');
const SERVEUR = lire('server.js');

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

// ── 1. Le fil ──────────────────────────────────────────────────────────────

test('les pommes cherchent comme en 2005 : Phys.search est la recherche d’époque', () => {
  // Le corps d'époque, sorti tel quel dans chercherDirect : la pomme libre la
  // plus proche à portée, la recharge de douze temps pour les deux bouts.
  const cd = methode(SPRITES, 'Phys extends Sprite', 'chercherDirect');
  assert.match(cd, /if \(this\.searchTimer > 0\) \{ this\.searchTimer -= Cs\.tmod; return undefined; \}/);
  assert.match(cd, /if \(this\.linkList\.length >= this\.range\) return undefined;/);
  assert.match(cd, /const dist = Math\.abs\(difx\) \+ Math\.abs\(dify\);/, 'la distance de Manhattan d’époque');
  assert.match(cd, /this\.searchTimer = 12;\n\s*link\.searchTimer = 12;/);
  // Et search enchaîne exactement comme avant : un direct, puis chaque pomme
  // accrochée, `combo` niveaux plus loin.
  const s = methode(SPRITES, 'Phys extends Sprite', 'search');
  assert.equal(s.trim(), "this.chercherDirect();\n    for (const link of this.linkList) if (combo > 0) link.search(combo - 1);");
});

test('la tzongre impose son ordre : fils directs d’abord, chaînes les plus courtes ensuite', () => {
  const s = methode(SPRITES, 'Tzongre extends Phys', 'search');
  // La recherche directe passe TOUJOURS en premier.
  assert.match(s, /^\s*if \(this\.linkList\.length === 0\) this\.flDirectVide = false;\n\s*const direct = this\.chercherDirect\(\);/);
  // Tant qu'il reste une place ET que la dernière recherche directe a trouvé,
  // les chaînes attendent ; si elle n'a rien trouvé, elles repartent.
  assert.match(s, /if \(direct === true\) this\.flDirectVide = false;\n\s*else if \(direct === false\) this\.flDirectVide = true;/);
  assert.match(s, /if \(this\.linkList\.length < this\.range && !this\.flDirectVide\) return;/);
  // Seules les chaînes les plus courtes s'allongent.
  assert.match(s, /const tailles = this\.linkList\.map\(\(l\) => l\.chainLength\(\)\);/);
  assert.match(s, /const min = Math\.min\.apply\(null, tailles\);/);
  assert.match(s, /if \(tailles\[i\] <= min\) this\.linkList\[i\]\.search\(combo - 1\);/);
  // La longueur d'une chaîne : les pommes suspendues, elle comprise.
  assert.match(SPRITES, /chainLength\(\) \{ let n = 1; for \(const l of this\.linkList\) n \+= l\.chainLength\(\); return n; \}/);
  // Le témoin repart à zéro avec la tzongre.
  assert.match(methode(SPRITES, 'Tzongre extends Phys', 'init'), /this\.flDirectVide = false;/);
});

test('l’équilibre, simulé : huit pommes font 4 + 4 avec un jaune, 3-3-2 avec deux', () => {
  /* Une simulation du jeu de fils, à plat : la recharge de douze temps, la
     portée, l'ordre d'appel — tout ce qui compte pour la RÉPARTITION, et rien
     d'autre (pas de physique). On rejoue les deux ordres, celui de 2005 et le
     nouveau, sur les mêmes pommes alignées, et l'on compte les fils. */
  function simuler(range, combo, nbPommes, ordreNouveau) {
    const noeud = (x) => ({ x, linkList: [], parentLink: null, searchTimer: 0, range: 1, nbTake: 80, flLinkable: true });
    // Les pommes en rang serré, la tzongre à portée de toutes (le rang fait
    // moins que sa prise) : ce qui décide, c'est l'ordre, pas la géométrie.
    const pommes = Array.from({ length: nbPommes }, (_, i) => noeud(20 + i * 10));
    const tz = noeud(60); tz.range = range; tz.nbTake = 140; tz.flDirectVide = false;
    const chainLength = (n) => 1 + n.linkList.reduce((s, l) => s + chainLength(l), 0);
    const chercherDirect = (n) => {
      if (n.searchTimer > 0) { n.searchTimer -= 1; return undefined; }
      if (n.linkList.length >= n.range) return undefined;
      let link, max = n.nbTake;
      for (const mc of pommes) {
        if (mc.parentLink == null && mc !== n && mc.linkList.length === 0 && mc.flLinkable) {
          const d = Math.abs(mc.x - n.x);
          if (d < max) { link = mc; max = d; }
        }
      }
      if (!link) return false;
      n.linkList.push(link); n.searchTimer = 12; link.searchTimer = 12; link.parentLink = n;
      return true;
    };
    const searchPomme = (n, c) => { chercherDirect(n); for (const l of n.linkList) if (c > 0) searchPomme(l, c - 1); };
    const searchTz2005 = (c) => searchPomme(tz, c);
    const searchTzNouveau = (c) => {
      if (tz.linkList.length === 0) tz.flDirectVide = false;
      const direct = chercherDirect(tz);
      if (direct === true) tz.flDirectVide = false; else if (direct === false) tz.flDirectVide = true;
      if (c <= 0 || tz.linkList.length === 0) return;
      if (tz.linkList.length < tz.range && !tz.flDirectVide) return;
      const tailles = tz.linkList.map(chainLength);
      const min = Math.min.apply(null, tailles);
      tz.linkList.forEach((l, i) => { if (tailles[i] <= min) searchPomme(l, c - 1); });
    };
    for (let t = 0; t < 400; t++) (ordreNouveau ? searchTzNouveau : searchTz2005)(combo);
    return tz.linkList.map(chainLength).sort((a, b) => b - a);
  }
  // 2005 : la première chaîne mange ce qui aurait dû faire l'autre fil — c'est
  // le « 1 et 3, 2 et 4 » relevé par les joueurs, et « 1-2-5 » à deux jaunes.
  // (À huit pommes et chaînes de quatre, 2005 fait déjà 4 + 4 : c'est le
  // PLAFOND de profondeur qui égalise, pas l'ordre — le déséquilibre se voit
  // dès que les pommes manquent pour remplir toutes les chaînes.)
  assert.deepEqual(simuler(2, 3, 4, false), [3, 1], '2005, un jaune, quatre pommes : 1 et 3');
  assert.deepEqual(simuler(2, 3, 6, false), [4, 2], '2005, un jaune, six pommes : 2 et 4');
  assert.deepEqual(simuler(3, 3, 8, false), [4, 3, 1], '2005, deux jaunes, huit pommes : une chaîne affamée');
  // Nouveau : à une pomme près, toujours.
  assert.deepEqual(simuler(2, 3, 4, true), [2, 2], 'un jaune, quatre pommes : 2 + 2');
  assert.deepEqual(simuler(2, 3, 6, true), [3, 3], 'un jaune, six pommes : 3 + 3');
  assert.deepEqual(simuler(2, 3, 8, true), [4, 4], 'un jaune, huit pommes : 4 + 4');
  assert.deepEqual(simuler(3, 3, 8, true), [3, 3, 2], 'deux jaunes, huit pommes : 3-3-2');
  assert.deepEqual(simuler(2, 1, 8, true), [2, 2], 'un jaune, un orange : deux chaînes de deux, ni plus');
  // Sans papillon orange, aucune chaîne : les fils directs, et c'est tout.
  assert.deepEqual(simuler(2, 0, 8, true), [1, 1], 'sans orange, deux pommes');
});

// ── 2. La pomme d'or ───────────────────────────────────────────────────────

/*
 * LA POMME D'OR : ce que vaut le jeu du joueur passe par son POIDS.
 *
 * Premier jet : « dix fois la moyenne des combos ». Le hasard sortait bien du
 * calcul, mais deux choses cassaient. Le prix n'avait plus de plafond — un
 * virtuose à 500 de moyenne encaissait CINQ MILLE points d'une pomme, quand
 * 2005 n'en payait jamais plus de mille sept cents. Et surtout la pomme d'or
 * est celle qui SOLDE le kilo : son poids était le reste de la barre, souvent
 * une miette. On voyait donc un petit pois valoir cinq mille points et une
 * belle pomme en valoir mille — la taille ne disait plus rien du prix, d'où la
 * plainte des « pommes d'or trop grosses ».
 *
 * Le prix revient donc au poids (la règle d'époque, `× 100 × 10`), et c'est le
 * POIDS qu'on tire de la moyenne des combos, borné entre un et deux. Bien
 * jouer fait GROSSIR la pomme, et une grosse pomme vaut cher : rayon et prix
 * disent enfin la même chose.
 */

// `Classic.poidsPommeOr`, sortie du fichier et rendue appelable : on veut les
// nombres, pas seulement la forme du code.
function poidsPommeOr(comboSomme, comboNb) {
  const src = /\n  poidsPommeOr\(\) \{[\s\S]*?\n  \}/.exec(MODES);
  assert.ok(src, 'Classic.poidsPommeOr');
  const bornes = /const POMME_OR_POIDS = (\[[^\]]*\]);/.exec(MODES);
  assert.ok(bornes, 'const POMME_OR_POIDS');
  const f = new Function('POMME_OR_POIDS', 'return function ' + src[0].trim() + ';')(
    JSON.parse(bornes[1]));
  return f.call({ comboSomme, comboNb });
}

test('la pomme d’or est payée à son poids — la règle de 2005, rendue telle quelle', () => {
  const p = methode(SPRITES, 'Panier extends Phys', 'pointsPommeOr');
  assert.match(p, /const p = base \* 10;/, 'dix fois ce que vaudrait une pomme ordinaire');
  assert.doesNotMatch(p, /comboSomme|comboNb/, 'le prix ne regarde plus la moyenne');
  assert.match(p, /this\.game\.stat\.setVal\("Pomme d'or", p\);/, 'et le panneau de fin le dit');
  // `base` est la valeur ordinaire du fruit : c'est là que le poids entre.
  const a = methode(SPRITES, 'Panier extends Phys', 'addFruit');
  assert.match(a, /let point = Math\.round\(\(fruit\.weight - fruit\.crunch\) \* 100\);\n\s*if \(fruit\.flGold\) point = this\.pointsPommeOr\(point\);/);
});

test('c’est le POIDS qui porte le jeu du joueur : moyenne des combos, grappes exclues', () => {
  // La moyenne se nourrit dans checkCombo — des combos seulement, pas des
  // grappes (qui vivent dans removeScore).
  const c = methode(SPRITES, 'Panier extends Phys', 'checkCombo');
  assert.match(c, /if \(b > 0\) \{[\s\S]*?this\.game\.comboSomme = \(this\.game\.comboSomme \| 0\) \+ b;\n\s*this\.game\.comboNb = \(this\.game\.comboNb \| 0\) \+ 1;/);
  const r = methode(SPRITES, 'Panier extends Phys', 'removeScore');
  assert.doesNotMatch(r, /comboSomme/, 'la grappe n’entre pas dans la moyenne');
  // Et tout repart de zéro avec la partie.
  assert.match(GAME, /this\.gOr = 0; this\.gMax = 0;\n\s*this\.comboSomme = 0; this\.comboNb = 0;/);
  // Le barème des figures vit dans `figureDe`, sorti de `checkCombo` pour que
  // les Épreuves puissent nommer une figure sans qu'elle rapporte quoi que ce
  // soit (cf. test/kalugaEpreuves.test.js). Un granite = « tete dunk » =
  // (10 + 10) × 10 = 200.
  const f = methode(SPRITES, 'Panier extends Phys', 'figureDe');
  assert.match(f, /if \(fruit\.flScHead\) \{ b \+= 10; name \+= 'tete '; \}/);
  assert.match(f, /if \(fruit\.flScDunk\) \{ b \+= 10; name \+= 'dunk '; \}/);
  assert.match(f, /return \{ name, b: b \* 10 \};/);
  assert.match(SPRITES, /\['tete dunk ', 'granite '\]/);
  // Le poids n'est plus le reste du kilo : les deux naissances d'une pomme
  // d'or l'écrasent par celui que vaut le jeu.
  const sol = /genGroundFruit\(\) \{[\s\S]*?\n  \}/.exec(MODES)[0];
  assert.match(sol, /initObj\.flGold = true; initObj\.weight = this\.poidsPommeOr\(\);/);
  const arbre = /genTreeFruit\(\) \{[\s\S]*?\n  \}/.exec(MODES)[0];
  assert.match(arbre, /initObj\.flGold = true; initObj\.weight = this\.poidsPommeOr\(\);/);
  // Le bac à sable la fait naître à la main : même poids, sinon l'essai ment.
  assert.match(MODES, /weight: this\.poidsPommeOr\(\), flGold: true/);
});

test('la pomme d’or est bornée : jamais un petit pois, jamais une enclume', () => {
  // Sans un seul combo, le plancher : une pomme de un, mille points.
  assert.equal(poidsPommeOr(0, 0), 1);
  // Un jeu de virtuose (500 de moyenne) atteint le plafond, et rien ne le
  // dépasse — c'était le défaut du premier jet.
  assert.equal(poidsPommeOr(3000, 6), 2);
  assert.equal(poidsPommeOr(100000, 10), 2, 'le plafond tient');
  // Entre les deux, la rampe est douce : un gramme pour cinq cents points de
  // moyenne, ce qui couvre tout l'éventail des combos (100 à 760) au lieu de
  // saturer dès le granite (200).
  assert.equal(poidsPommeOr(600, 5), 1 + 120 / 500);
  assert.equal(poidsPommeOr(1400, 7), 1.4);
});

test('la TAILLE de la pomme d’or dit son PRIX : rayon et valeur sont proportionnels', () => {
  /*
   * Un fruit a pour rayon douze fois son poids ; la pomme d'or vaut cent fois
   * son poids, dix fois. Le rapport valeur / rayon est donc une CONSTANTE —
   * c'est là toute la demande : qu'on voie d'un coup d'œil ce qu'elle vaut.
   */
  assert.match(SPRITES, /this\.setRay\(this\.weight \* 12\);/, 'rayon = 12 × poids');
  // Le seul jeu entre les deux est l'ARRONDI du score à l'unité — `addFruit`
  // paie un nombre entier de points. Un demi-point sur mille cinq cents : le
  // rapport tient à un demi pour cent près, ce qu'aucun œil ne voit.
  const attendu = 1000 / 12;
  for (const [somme, nb] of [[0, 0], [600, 5], [1862, 7], [1400, 7], [3000, 6]]) {
    const poids = poidsPommeOr(somme, nb);
    const rayon = poids * 12;
    const valeur = Math.round(poids * 100) * 10;      // addFruit, puis pointsPommeOr
    assert.ok(valeur >= 1000 && valeur <= 2000, 'entre mille et deux mille : ' + valeur);
    const ecart = Math.abs((valeur / rayon) - attendu) / attendu;
    assert.ok(ecart < 0.005, 'rayon ' + rayon.toFixed(1) + ' px pour ' + valeur
      + ' points : ' + (ecart * 100).toFixed(2) + ' % d’écart');
  }
  // Une pomme deux fois plus large vaut bien deux fois plus cher.
  assert.equal(Math.round(poidsPommeOr(3000, 6) * 100) * 10,
    2 * Math.round(poidsPommeOr(0, 0) * 100) * 10);
  // Et les extrêmes, en clair : la plus petite fait 24 px de diamètre pour
  // mille points, la plus grosse 48 px pour deux mille.
  assert.deepEqual([poidsPommeOr(0, 0) * 12 * 2, poidsPommeOr(3000, 6) * 12 * 2], [24, 48]);
});

// ── 3. Le témoin de grappe ─────────────────────────────────────────────────

test('le portage envoie la plus grosse grappe, en troisième champ', () => {
  const r = methode(SPRITES, 'Panier extends Phys', 'removeScore');
  assert.match(r, /this\.game\.gOr = \(this\.game\.gOr \| 0\) \| this\.grappe;/, 'le OU du disque rustiné reste');
  assert.match(r, /this\.game\.gMax = Math\.max\(this\.game\.gMax \| 0, this\.grappe\);/, 'et le maximum s’y ajoute');
  assert.match(GAME, /saveScore\(score, \{ tz: this\.tzongreInfo\.id, gOr: this\.gOr \| 0, gMax: this\.gMax \| 0 \}\)/);
  assert.match(PLATEFORME, /data: tz \+ ':' \+ gOr \+ ':' \+ gMax/, '« tz:g:max »');
  // Côté serveur, le partage se fait sur ce maximum quand il est là — et une
  // partie SANS TÉMOIN n'entre dans aucun des deux tableaux plutôt que d'aller
  // au jugé dans celui des grappes.
  assert.match(SERVEUR, /const grappe = kalugaAvecGrappe\(scoreData\);\n\s*if \(grappe === false\) \{\n\s*return \{ rankingId: 'kaluga_freestyle_classic'/);
  assert.match(SERVEUR, /if \(grappe === null\) \{\n\s*return \{ rankingId: null,[\s\S]*?sansTemoin: true \};/);
  // Et le défi Freestyle est rationné comme l'autre.
  assert.match(SERVEUR, /if \(g === 'kaluga' && rankingId === 'kaluga_freestyle_classic'\) return g;/);
  // Les deux défis du jour, dans le tableau du light.
  assert.match(SERVEUR, /\{ game: 'kaluga',  ranking: 'kaluga_classic' \},\n\s*\{ game: 'kaluga',  ranking: 'kaluga_freestyle_classic' \},/);
});
