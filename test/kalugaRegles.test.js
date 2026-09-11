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
 *   2. LA POMME D'OR vaut dix fois la moyenne des combos des cinq dernières
 *      pommes encaissées avant elle, grappes exclues, sans plafond — là où
 *      2005 payait dix fois un poids tiré au sort, le reste du kilo. Son
 *      poids, borné entre un et deux, ne dit plus que sa taille.
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
 * LA POMME D'OR : dix fois la moyenne des combos des cinq dernières pommes.
 *
 * Deux jets avant celui-ci. « Dix fois la moyenne des combos de la partie »
 * d'abord ; puis, pour lui donner un plafond et une taille qui dise son prix,
 * le poids : un gramme pour cinq cents points de moyenne, borné entre un et
 * deux, payé cent fois dix. Cette rampe la SOUS-PAYAIT — mille points plus
 * deux fois la moyenne, plafonnés à deux mille, là où l'on attendait dix fois
 * la moyenne : un jeu à 200 rendait 1400, et rien ne passait jamais 2000. Et
 * la moyenne courait sur toute la partie, diluée par les premières pommes.
 *
 * Maintenant le prix est fixé à sa naissance : la moyenne des combos des cinq
 * dernières pommes encaissées avant elle (zéro pour une pomme sans figure,
 * grappes exclues), multipliée par dix, sans plafond — et jamais moins qu'une
 * pomme ordinaire. Le poids ne porte plus que la taille.
 */

// `Classic.noterCombo` et `Classic.pommeOr`, sortis du fichier et rendus
// appelables : on veut les nombres, pas seulement la forme du code.
function classic() {
  const constante = (nom) => {
    const m = new RegExp('const ' + nom + ' = ([^;]*);').exec(MODES);
    assert.ok(m, 'const ' + nom);
    return JSON.parse(m[1]);
  };
  const fabrique = (nom) => {
    const src = new RegExp('\\n  ' + nom + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(MODES);
    assert.ok(src, 'Classic.' + nom);
    return new Function('POMME_OR_POIDS', 'POMME_OR_FENETRE', 'return function ' + src[0].trim() + ';')(
      constante('POMME_OR_POIDS'), constante('POMME_OR_FENETRE'));
  };
  return { combosRecents: [], noterCombo: fabrique('noterCombo'), pommeOr: fabrique('pommeOr') };
}
// Ce que vaut une pomme d'or née après ces combos-là, dans l'ordre.
function pommeOr(combos) {
  const jeu = classic();
  for (const b of combos) jeu.noterCombo(b);
  return jeu.pommeOr();
}

test('la pomme d’or vaut dix fois la moyenne des combos des cinq dernières pommes', () => {
  // Que des granites (200) : deux mille — ce que la rampe au poids ne rendait
  // qu'à 1400.
  assert.equal(pommeOr([200, 200, 200, 200, 200]).prixOr, 2000);
  // Une pomme sans figure compte pour zéro : elle pèse sur la moyenne.
  assert.equal(pommeOr([100, 0, 200, 40, 20]).prixOr, 720);
  // Seules les cinq dernières comptent : deux corbeaux en début de partie ne
  // valent plus rien à la fin, et cinq pommes nues effacent tout.
  assert.equal(pommeOr([760, 760, 100, 100, 100, 100, 100]).prixOr, 1000);
  assert.equal(pommeOr([100, 100, 100, 100, 100, 0, 0, 0, 0, 0]).prixOr, 0);
  // Moins de cinq pommes : la moyenne de ce qu'il y a.
  assert.equal(pommeOr([100, 200]).prixOr, 1500);
  assert.equal(pommeOr([]).prixOr, 0);
  // Pas de plafond : un virtuose est payé comme tel.
  assert.equal(pommeOr([760, 760, 760, 760, 760]).prixOr, 7600);
  // Et la fenêtre est bien de cinq.
  assert.match(MODES, /const POMME_OR_FENETRE = 5;/);
});

test('le prix est fixé à la naissance, et le panier le paie tel quel — jamais moins qu’une pomme', () => {
  const p = methode(SPRITES, 'Panier extends Phys', 'pointsPommeOr');
  assert.match(p, /const p = Math\.max\(base, fruit\.prixOr \| 0\);/);
  assert.match(p, /this\.game\.stat\.setVal\("Pomme d'or", p\);/, 'et le panneau de fin le dit');
  assert.doesNotMatch(p, /combosRecents|\* 10/, 'le panier ne calcule rien : il paie');
  // Rendu appelable : le prix passe tel quel, sauf s'il vaut moins qu'une
  // pomme ordinaire de ce poids (`base`, ce que vaudrait le fruit sans l'or).
  const payer = new Function('fruit', 'base', p);
  const panier = { game: { stat: { valeurs: {}, setVal(k, v) { this.valeurs[k] = v; } } } };
  assert.equal(payer.call(panier, { prixOr: 2000 }, 140), 2000);
  assert.equal(payer.call(panier, { prixOr: 7600 }, 200), 7600, 'sans plafond');
  assert.equal(payer.call(panier, { prixOr: 40 }, 101), 101, 'jamais moins qu’une pomme');
  assert.equal(payer.call(panier, { prixOr: 0 }, 100), 100, 'sans combo, une pomme');
  assert.equal(payer.call(panier, {}, 100), 100, 'sans prix du tout, une pomme aussi');
  assert.equal(panier.game.stat.valeurs["Pomme d'or"], 100);
  // `base` est la valeur ordinaire du fruit, et c'est le FRUIT qu'on passe :
  // le prix voyage avec lui depuis sa naissance.
  const a = methode(SPRITES, 'Panier extends Phys', 'addFruit');
  assert.match(a, /let point = Math\.round\(\(fruit\.weight - fruit\.crunch\) \* 100\);\n\s*if \(fruit\.flGold\) point = this\.pointsPommeOr\(fruit, point\);/);
});

test('les combos se notent pomme par pomme, zéro compris, grappes exclues — et tout repart avec la partie', () => {
  // Hors du `if (b > 0)` : une pomme sans figure compte pour zéro.
  const c = methode(SPRITES, 'Panier extends Phys', 'checkCombo');
  assert.match(c, /if \(b > 0\) this\.game\.scroller\.put\(name, '\+' \+ b\);\n[\s\S]*?this\.game\.noterCombo\(b\);/);
  assert.doesNotMatch(c, /if \(b > 0\) \{/);
  const r = methode(SPRITES, 'Panier extends Phys', 'removeScore');
  assert.doesNotMatch(r, /noterCombo|combosRecents/, 'la grappe n’entre pas dans la moyenne');
  assert.match(GAME, /this\.gOr = 0; this\.gMax = 0;\n\s*this\.combosRecents = \[\];/);
  // La fenêtre glisse : on garde les cinq derniers, dans l'ordre.
  const jeu = classic();
  for (const b of [10, 20, 30, 40, 50, 60, 70]) jeu.noterCombo(b);
  assert.deepEqual(jeu.combosRecents, [30, 40, 50, 60, 70]);
  // Le barème des figures vit dans `figureDe`, sorti de `checkCombo` pour que
  // les Épreuves puissent nommer une figure sans qu'elle rapporte quoi que ce
  // soit (cf. test/kalugaEpreuves.test.js). Un granite = « tete dunk » =
  // (10 + 10) × 10 = 200.
  const f = methode(SPRITES, 'Panier extends Phys', 'figureDe');
  assert.match(f, /if \(fruit\.flScHead\) \{ b \+= 10; name \+= 'tete '; \}/);
  assert.match(f, /if \(fruit\.flScDunk\) \{ b \+= 10; name \+= 'dunk '; \}/);
  assert.match(f, /return \{ name, b: b \* 10 \};/);
  assert.match(SPRITES, /\['tete dunk ', 'granite '\]/);
  // Les trois naissances d'une pomme d'or passent par `pommeOr` : même prix,
  // même poids, d'où qu'elle vienne — le sol, l'arbre, ou le bac à sable.
  const sol = /genGroundFruit\(\) \{[\s\S]*?\n  \}/.exec(MODES)[0];
  assert.match(sol, /if \(this\.kilo === this\.kiloMax\) Object\.assign\(initObj, this\.pommeOr\(\)\);/);
  const arbre = /genTreeFruit\(\) \{[\s\S]*?\n  \}/.exec(MODES)[0];
  assert.match(arbre, /if \(this\.kilo === this\.kiloMax\) \{ Object\.assign\(initObj, this\.pommeOr\(\)\); this\.newBird\(\); \}/);
  assert.match(MODES, /this\.newFruit\(Object\.assign\(\{ x: 40 \+ random\(Cs\.mcw - 80\) \}, this\.pommeOr\(\)\)\)/);
  assert.doesNotMatch(MODES + SPRITES + GAME, /poidsPommeOr|comboSomme|comboNb/, 'l’ancienne moyenne est partie');
});

test('le poids ne porte plus que la taille : bornée, elle grossit avec le jeu', () => {
  // Sans un seul combo, la plus petite : une pomme de un, 24 px de diamètre.
  assert.equal(pommeOr([]).weight, 1);
  assert.equal(pommeOr([0, 0, 0, 0, 0]).weight, 1);
  // Un gramme pour cinq cents points de moyenne, et un plafond de deux —
  // au-delà le fil ne la lève plus.
  assert.equal(pommeOr([200, 200, 200, 200, 200]).weight, 1.4);
  assert.equal(pommeOr([500, 500, 500, 500, 500]).weight, 2);
  assert.equal(pommeOr([760, 760, 760, 760, 760]).weight, 2, 'le plafond tient');
  assert.match(SPRITES, /this\.setRay\(this\.weight \* 12\);/, 'rayon = 12 × poids');
  assert.deepEqual([pommeOr([]).weight * 24, pommeOr([500, 500, 500, 500, 500]).weight * 24], [24, 48]);
  // Plus la pomme est grosse, plus elle vaut : la taille ne ment jamais sur
  // le sens, même si le prix, lui, n'a pas de plafond.
  let precedent = pommeOr([]);
  for (const m of [20, 72, 120, 200, 266, 500, 760]) {
    const p = pommeOr([m, m, m, m, m]);
    assert.ok(p.prixOr > precedent.prixOr && p.weight >= precedent.weight, 'à ' + m + ' de moyenne');
    assert.equal(p.prixOr, m * 10);
    precedent = p;
  }
  // Et la pomme d'or est toujours d'or.
  assert.equal(pommeOr([]).flGold, true);
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
