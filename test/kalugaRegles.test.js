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
 *      pommes encaissées avant elle, grappes exclues, ARRONDIS À LA CENTAINE
 *      et sans plafond — là où 2005 payait dix fois un poids tiré au sort, le
 *      reste du kilo. Son poids ne dit plus que sa taille, et il la dit pour
 *      de bon : jusqu'au plus gros fruit que le panier sache prendre.
 *   3. LE POIDS DES POMMES EST BORNÉ à ce que le panier encaisse. Le tirage
 *      d'époque n'avait pas de plafond et sortait, en fin de partie, des
 *      pommes trop larges pour l'ouverture : le joueur en voyait passer qu'il
 *      ne pouvait pas attraper.
 *   4. LE TÉMOIN DE GRAPPE : le portage envoie aussi la PLUS GROSSE grappe
 *      (« tz:g:max »), pour que le partage Grappe / Freestyle se lise à la
 *      taille près (le OU du disque Flash ne sait pas dire « sept »).
 *   5. LE FIL DE LA FOURMI : une fourmi qui rejoignait une pomme avec son fil
 *      restait « accrochée » pour toujours et n'en recevait plus jamais. Le
 *      défaut est d'époque (le même AS2) ; on le corrige.
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

test('la tzongre alterne : un fil jaune, puis une chaîne orange (la plus courte), puis un jaune…', () => {
  const s = methode(SPRITES, 'Tzongre extends Phys', 'search');
  // Le tour repart du jaune quand la tzongre n'a plus de fil.
  assert.match(s, /if \(this\.linkList\.length === 0\) \{ this\.tourChaine = false; this\.attenteChaine = 0; \}/);
  // Une chaîne peut s'allonger tant qu'elle n'a pas combo + 1 pommes.
  assert.match(s, /const chainePossible = combo > 0 && this\.linkList\.length > 0 && min < combo \+ 1;/);
  // Un fil direct posé donne la main aux chaînes.
  assert.match(s, /if \(direct === true\) \{ this\.tourChaine = combo > 0; this\.attenteChaine = 0; return; \}/);
  // Une recharge en cours se respecte (on attend son fil direct).
  assert.match(s, /if \(direct === undefined && this\.linkList\.length < this\.range && !this\.tourChaine\) return;/);
  // Seules les chaînes les plus courtes s'allongent ; une chaîne allongée rend la main au jaune.
  assert.match(s, /if \(tailles\[i\] <= min\) this\.linkList\[i\]\.search\(combo - 1\);/);
  assert.match(s, /if \(apres > avant\) \{ this\.tourChaine = false; this\.attenteChaine = 0; return; \}/);
  // Rien trouvé en deux recharges : le tour revient au jaune.
  assert.match(s, /if \(this\.attenteChaine > 24\) \{ this\.tourChaine = false; this\.attenteChaine = 0; \}/);
  assert.match(SPRITES, /chainLength\(\) \{ let n = 1; for \(const l of this\.linkList\) n \+= l\.chainLength\(\); return n; \}/);
  assert.match(methode(SPRITES, 'Tzongre extends Phys', 'init'), /this\.tourChaine = false; this\.attenteChaine = 0;/);
});

test('l’alternance, simulée : J, O, J, O… — ni chaînes affamées, ni rangée de fils directs', () => {
  /* Une simulation du jeu de fils, à plat : la recharge de douze temps, la
     portée, l'ordre d'appel — tout ce qui compte pour la RÉPARTITION, et rien
     d'autre (pas de physique). On rejoue l'ordre de 2005 et l'alternance sur
     les mêmes pommes alignées, et l'on note l'ordre des fils (J : direct,
     O : chaîne). */
  function simuler(range, combo, nbPommes, alterne) {
    const noeud = (x) => ({ x, linkList: [], parentLink: null, searchTimer: 0, range: 1, nbTake: 80, flLinkable: true });
    const pommes = Array.from({ length: nbPommes }, (_, i) => noeud(20 + i * 10));
    const tz = noeud(60); tz.range = range; tz.nbTake = 140; tz.tourChaine = false; tz.attenteChaine = 0;
    const journal = [];
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
      journal.push(n === tz ? 'J' : 'O');
      return true;
    };
    const searchPomme = (n, c) => { chercherDirect(n); for (const l of n.linkList) if (c > 0) searchPomme(l, c - 1); };
    const searchTz2005 = (c) => searchPomme(tz, c);
    const searchAlterne = (c) => {
      if (tz.linkList.length === 0) { tz.tourChaine = false; tz.attenteChaine = 0; }
      const tailles = tz.linkList.map(chainLength);
      const min = tailles.length ? Math.min.apply(null, tailles) : 0;
      const chainePossible = c > 0 && tz.linkList.length > 0 && min < c + 1;
      if (!tz.tourChaine || !chainePossible) {
        const direct = chercherDirect(tz);
        if (direct === true) { tz.tourChaine = c > 0; tz.attenteChaine = 0; return; }
        if (direct === undefined && tz.linkList.length < tz.range && !tz.tourChaine) return;
      }
      if (!chainePossible) return;
      const avant = tailles.reduce((a, b) => a + b, 0);
      tz.linkList.forEach((l, i) => { if (tailles[i] <= min) searchPomme(l, c - 1); });
      const apres = tz.linkList.reduce((a, l) => a + chainLength(l), 0);
      if (apres > avant) { tz.tourChaine = false; tz.attenteChaine = 0; return; }
      if (tz.tourChaine) { tz.attenteChaine += 1; if (tz.attenteChaine > 24) { tz.tourChaine = false; tz.attenteChaine = 0; } }
    };
    for (let t = 0; t < 400; t++) (alterne ? searchAlterne : searchTz2005)(combo);
    return { forme: tz.linkList.map(chainLength).sort((a, b) => b - a), ordre: journal.join('') };
  }
  // 2005 : la première chaîne mange ce qui aurait dû faire l'autre fil.
  assert.deepEqual(simuler(2, 3, 4, false).forme, [3, 1], '2005, un jaune, quatre pommes : 1 et 3');
  assert.deepEqual(simuler(3, 3, 8, false).forme, [4, 3, 1], '2005, deux jaunes, huit pommes : une chaîne affamée');
  // L'alternance : un jaune, un orange, un jaune…
  assert.deepEqual(simuler(2, 3, 4, true), { forme: [2, 2], ordre: 'JOJO' });
  assert.deepEqual(simuler(2, 3, 8, true), { forme: [4, 4], ordre: 'JOJOOOOO' }, 'places pleines : les chaînes finissent');
  assert.deepEqual(simuler(3, 3, 6, true), { forme: [2, 2, 2], ordre: 'JOJOJO' });
  assert.deepEqual(simuler(3, 3, 8, true), { forme: [3, 3, 2], ordre: 'JOJOJOOO' });
  // Sans jaune, une seule chaîne ; sans orange, que des fils directs.
  assert.deepEqual(simuler(1, 3, 4, true), { forme: [4], ordre: 'JOOO' });
  assert.deepEqual(simuler(2, 0, 8, true), { forme: [1, 1], ordre: 'JJ' });
  // Le deuxième fil direct n'est jamais lancé avant qu'une chaîne ait poussé.
  for (const [r, c, n] of [[2, 3, 6], [3, 3, 8], [4, 3, 8], [3, 1, 8]]) {
    const o = simuler(r, c, n, true).ordre;
    assert.ok(!/JJ/.test(o), `${r}/${c}/${n} : jamais deux jaunes d’affilée (${o})`);
  }
});

function classic() {
  /*
   * Une constante du fichier, TELLE QU'ELLE Y EST ÉCRITE — et certaines se
   * disent l'une par l'autre (`POMME_OR_POIDS = [1, FRUIT_POIDS_MAX]`). On ne
   * la lit donc pas comme du JSON : on l'évalue, avec celles d'avant sous la
   * main. Le lien qui les tient est justement ce qu'on veut éprouver.
   */
  const vues = {};
  const constante = (nom) => {
    if (nom in vues) return vues[nom];
    const m = new RegExp('const ' + nom + ' = ([^;]*);').exec(MODES);
    assert.ok(m, 'const ' + nom);
    const noms = Object.keys(vues);
    vues[nom] = new Function(...noms, 'return (' + m[1] + ');')(...noms.map((k) => vues[k]));
    return vues[nom];
  };
  constante('FRUIT_POIDS_MAX');
  const fabrique = (nom) => {
    const src = new RegExp('\\n  ' + nom + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(MODES);
    assert.ok(src, 'Classic.' + nom);
    return new Function('POMME_OR_POIDS', 'POMME_OR_FENETRE', 'POMME_OR_RAMPE',
      'return function ' + src[0].trim() + ';')(
      constante('POMME_OR_POIDS'), constante('POMME_OR_FENETRE'), constante('POMME_OR_RAMPE'));
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
  // Une pomme sans figure compte pour zéro : elle pèse sur la moyenne. Et le
  // prix s'arrondit à la CENTAINE — un gros lot s'annonce en compte rond.
  assert.equal(pommeOr([100, 0, 200, 40, 20]).prixOr, 700);
  assert.equal(pommeOr([244, 244, 244, 244, 244]).prixOr, 2400, '2440 s’annonçait mal');
  assert.equal(pommeOr([266, 266, 266, 266, 266]).prixOr, 2700, 'et l’arrondi va au plus proche');
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
  // Un gramme pour DEUX CENTS points de moyenne — cinq fois la pente d'avant,
  // parce qu'à l'ancienne une pomme d'or à 2440 pesait 1,49 : moins qu'une
  // pomme ordinaire de fin de partie, et la taille ne disait plus rien.
  assert.equal(pommeOr([200, 200, 200, 200, 200]).weight, 2);
  assert.equal(Math.round(pommeOr([244, 244, 244, 244, 244]).weight * 100) / 100, 2.22);
  // Et le plafond est celui du panier : la plus grosse pomme qu'il encaisse.
  const max = JSON.parse(/const FRUIT_POIDS_MAX = ([^;]*);/.exec(MODES)[1]);
  assert.match(MODES, /const POMME_OR_POIDS = \[1, FRUIT_POIDS_MAX\];/);
  assert.equal(pommeOr([500, 500, 500, 500, 500]).weight, max, 'le plafond tient');
  assert.equal(pommeOr([760, 760, 760, 760, 760]).weight, max);
  assert.match(SPRITES, /this\.setRay\(this\.weight \* 12\);/, 'rayon = 12 × poids');
  assert.deepEqual([pommeOr([]).weight * 24, pommeOr([200, 200, 200, 200, 200]).weight * 24], [24, 48]);
  // Plus la pomme est grosse, plus elle vaut : la taille ne ment jamais sur
  // le sens, même si le prix, lui, n'a pas de plafond.
  let precedent = pommeOr([]);
  for (const m of [20, 72, 120, 200, 266, 500, 760]) {
    const p = pommeOr([m, m, m, m, m]);
    assert.ok(p.prixOr > precedent.prixOr && p.weight >= precedent.weight, 'à ' + m + ' de moyenne');
    assert.equal(p.prixOr, Math.round(m * 10 / 100) * 100);
    precedent = p;
  }
  // Et la pomme d'or est toujours d'or.
  assert.equal(pommeOr([]).flGold, true);
});

// ── 3. Le poids des pommes, et la bouche du panier ─────────────────────────

/*
 * LE PANIER N'AVALE QUE CE QUI TIENT DANS SON OUVERTURE. `Fruit.update` ne
 * l'encaisse que si la pomme y tient TOUT ENTIÈRE — `x - r >= -openRay` et
 * `x + r <= openRay` —, si bien que la fenêtre de tir vaut
 * `2 · (openRay − 12·poids)` pixels et se referme à mesure que la pomme
 * grossit. Le tirage d'époque n'avait pas de plafond : en fin de partie il
 * sortait des pommes de 3,4 dont la fenêtre faisait 2,4 px, et des pommes de
 * 3,5 qui ne pouvaient littéralement plus entrer.
 */
test('aucune pomme n’est trop large pour le panier — et il lui reste de quoi viser', () => {
  const openRay = Number(/this\.ray = 90; this\.openLevel = 53; this\.openRay = (\d+);/.exec(SPRITES)[1]);
  assert.equal(openRay, 42, 'l’ouverture du panier, telle quelle');
  const max = JSON.parse(/const FRUIT_POIDS_MAX = ([^;]*);/.exec(MODES)[1]);
  // La condition d'encaissement, au mot près — c'est elle qui fixe le plafond.
  assert.match(methode(SPRITES, 'Fruit extends Phys', 'update'),
    /if \(x - r >= -pr && x \+ r <= pr && this\.y \+ r > niv && !this\.game\.flEndGame\)/);
  // La plus grosse pomme laisse une vraie fenêtre : vingt pixels au moins.
  const fenetre = 2 * (openRay - max * 12);
  assert.ok(fenetre >= 20, 'la plus grosse pomme ne laisse que ' + fenetre.toFixed(1) + ' px');

  // Et le tirage ne peut pas la dépasser, à aucun niveau. On le rejoue tel
  // qu'il est écrit, avec un `random` qui rend toujours son plus grand tirage.
  const g = methode(MODES, 'Classic extends J.Game', 'getFruitWeight');
  const etendue = /const FRUIT_ETENDUE_MAX = ([^;]*);/.exec(MODES)[1];
  const tirer = new Function('random', 'FRUIT_ETENDUE_MAX', 'return function (niveau) {'
    + 'const this_ = { level: niveau, kilo: 0, kiloMax: 1000 };'
    + 'return (function () {' + g + '}).call(this_); };')(
    (n) => n - 1, new Function('FRUIT_POIDS_MAX', 'return (' + etendue + ');')(max));
  for (let niveau = 0; niveau <= 60; niveau++) {
    const w = Math.round(tirer(niveau) * 1000) / 1000;
    assert.ok(w <= max, 'au niveau ' + niveau + ' le tirage sort ' + w);
  }
  // Le niveau alourdit toujours les pommes — il cesse seulement de le faire
  // une fois le maximum atteint.
  assert.ok(tirer(6) > tirer(0), 'le niveau compte encore');
  assert.equal(tirer(12), max, 'et il touche le plafond au douzième');
});

// ── 4. Le fil de la fourmi ─────────────────────────────────────────────────

test('une fourmi qui rejoint une pomme avec son fil peut en recevoir un autre', () => {
  /*
   * `attachMovie(lien, nom, prof, mc)` sait prendre un CLIP pour objet
   * d'initialisation et en recopie toutes les propriétés de jeu. Le jeu s'en
   * sert pour faire passer un sprite d'un parent à l'autre : `Fruit.addAnt`
   * pose la fourmi sur la pomme, `Fruit.dropLastAnt` l'en secoue. `linkList`
   * est refait à l'init, mais `parentLink` voyageait avec la copie — et
   * `chercherDirect` saute tout ce dont le `parentLink` n'est pas nul.
   */
  assert.match(methode(SPRITES, 'Fruit extends Phys', 'addAnt'),
    /this\.attachMovie\('spBadsAnt', 'ant_' \+ d, 10 \+ d, mc\);/, 'la recopie d’époque est là');
  assert.match(methode(SPRITES, 'Fruit extends Phys', 'dropLastAnt'),
    /const mc = this\.game\.newAnt\(mcf\);/, 'et la seconde aussi');
  // La cure : un sprite naît libre. `init` efface le souvenir du fil.
  const i = methode(SPRITES, 'Phys extends Sprite', 'init');
  assert.match(i, /this\.linkList = \[\];/);
  assert.match(i, /this\.parentLink = undefined;/);
  // Et l'on refait le chemin : fourmi accrochée → pomme → secouée → libre.
  const initPhys = new Function('sprite', 'sprite.linkList = []; sprite.parentLink = undefined; return sprite;');
  const copier = (mc) => initPhys(Object.assign({}, mc));   // K.finaliser, puis constructeur → init
  const tz = initPhys({ linkList: [] });
  const fourmi = initPhys({});
  tz.linkList.push(fourmi); fourmi.parentLink = tz;          // un fil part
  const surLaPomme = copier(fourmi);                          // Fruit.addAnt
  const libre = copier(surLaPomme);                           // Fruit.dropLastAnt
  assert.equal(libre.parentLink, undefined,
    'la fourmi libérée se croyait encore accrochée : plus jamais de fil');
  // La règle qui la rejetait, pour mémoire.
  assert.match(methode(SPRITES, 'Phys extends Sprite', 'chercherDirect'), /if \(mc\.parentLink == null &&/);
});

// ── 5. Le témoin de grappe ─────────────────────────────────────────────────

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
