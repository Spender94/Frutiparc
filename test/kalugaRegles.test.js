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
 *   2. LA POMME D'OR vaut dix fois la moyenne des combos de la partie, grappes
 *      exclues — et non dix fois son poids, qui était le reste d'un tirage.
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

test('la pomme d’or vaut dix fois la moyenne des combos, grappes exclues', () => {
  const p = methode(SPRITES, 'Panier extends Phys', 'pointsPommeOr');
  assert.match(p, /const nb = this\.game\.comboNb \| 0;\n\s*if \(!nb\) return base;/, 'sans combo : une pomme comme une autre');
  assert.match(p, /const p = Math\.round\(\(this\.game\.comboSomme \| 0\) \/ nb\) \* 10;/);
  assert.match(p, /this\.game\.stat\.setVal\("Pomme d'or", p\);/, 'et le panneau de fin le dit');
  // Elle remplace le « × 10 du poids » d'époque dans addFruit.
  const a = methode(SPRITES, 'Panier extends Phys', 'addFruit');
  assert.match(a, /let point = Math\.round\(\(fruit\.weight - fruit\.crunch\) \* 100\);\n\s*if \(fruit\.flGold\) point = this\.pointsPommeOr\(point\);/);
  assert.doesNotMatch(a, /flGold \? 10 : 1/, 'plus de multiplicateur sur le poids');
  // La moyenne se nourrit dans checkCombo — des combos seulement, pas des
  // grappes (qui vivent dans removeScore).
  const c = methode(SPRITES, 'Panier extends Phys', 'checkCombo');
  assert.match(c, /if \(b > 0\) \{[\s\S]*?this\.game\.comboSomme = \(this\.game\.comboSomme \| 0\) \+ b;\n\s*this\.game\.comboNb = \(this\.game\.comboNb \| 0\) \+ 1;/);
  const r = methode(SPRITES, 'Panier extends Phys', 'removeScore');
  assert.doesNotMatch(r, /comboSomme/, 'la grappe n’entre pas dans la moyenne');
  // Et tout repart de zéro avec la partie.
  assert.match(GAME, /this\.gOr = 0; this\.gMax = 0;\n\s*this\.comboSomme = 0; this\.comboNb = 0;/);
  // L'exemple de la demande : que des granites (200) → 2000. Un granite =
  // « tete dunk » = (10 + 10) × 10.
  assert.match(c, /if \(fruit\.flScHead\) \{ b \+= 10; name \+= 'tete '; \}/);
  assert.match(c, /if \(fruit\.flScDunk\) \{ b \+= 10; name \+= 'dunk '; \}/);
  assert.match(SPRITES, /\['tete dunk ', 'granite '\]/);
  assert.equal(Math.round((200 + 200 + 200) / 3) * 10, 2000);
});

// ── 3. Le témoin de grappe ─────────────────────────────────────────────────

test('le portage envoie la plus grosse grappe, en troisième champ', () => {
  const r = methode(SPRITES, 'Panier extends Phys', 'removeScore');
  assert.match(r, /this\.game\.gOr = \(this\.game\.gOr \| 0\) \| this\.grappe;/, 'le OU du disque rustiné reste');
  assert.match(r, /this\.game\.gMax = Math\.max\(this\.game\.gMax \| 0, this\.grappe\);/, 'et le maximum s’y ajoute');
  assert.match(GAME, /saveScore\(score, \{ tz: this\.tzongreInfo\.id, gOr: this\.gOr \| 0, gMax: this\.gMax \| 0 \}\)/);
  assert.match(PLATEFORME, /data: tz \+ ':' \+ gOr \+ ':' \+ gMax/, '« tz:g:max »');
  // Côté serveur, le partage se fait sur ce maximum quand il est là.
  assert.match(SERVEUR, /if \(rankingId === 'kaluga_classic' && kalugaAvecGrappe\(scoreData\) === false\) \{\n\s*return \{ rankingId: 'kaluga_freestyle_classic'/);
  // Et le défi Freestyle est rationné comme l'autre.
  assert.match(SERVEUR, /if \(g === 'kaluga' && rankingId === 'kaluga_freestyle_classic'\) return g;/);
  // Les deux défis du jour, dans le tableau du light.
  assert.match(SERVEUR, /\{ game: 'kaluga',  ranking: 'kaluga_classic' \},\n\s*\{ game: 'kaluga',  ranking: 'kaluga_freestyle_classic' \},/);
});
