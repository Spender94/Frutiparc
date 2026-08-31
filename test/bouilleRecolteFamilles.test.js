'use strict';
/*
 * PUISER LES ACCESSOIRES DES AUTRES FAMILLES
 * ══════════════════════════════════════════
 *
 * Les incarnations de boutique — le ninja, le hippo, l'orc, l'elfe,
 * l'explorateur, le champignon… — sont des familles à part entière : leur SWF
 * porte tout le personnage, et le moteur y cherche les mêmes clips que dans la
 * famille 0. D'où la question que l'atelier d'accessoires pose maintenant :
 * portent-elles, elles aussi, un ROULEAU D'ACCESSOIRE dont on pourrait
 * reprendre les dessins pour les poser sur une bouille classique ?
 *
 * LE RECENSEMENT DIT NON, SAUF UNE. Seule la famille 12 (le ninja) a la chaîne
 * complète `ca → c → acc` : vingt-cinq casquettes, huit chapeaux, et onze
 * images derrière la tête. Les autres n'ont pas de rouleau d'accessoire du
 * tout — leur couvre-chef est dessiné DANS LEUR COIFFURE, à même le rouleau
 * `ca`, et il n'y a rien à en détacher qui ne soit aussi la tête. (La
 * famille 16 range bien un `acc` sous `ca`, mais hors de la chaîne, et son
 * unique image est vide.)
 *
 * LES DOUBLONS. Onze des seize types de la famille 12 pointent sur le MÊME
 * dessin : leur rouleau ne compte qu'une image, et `gotoAndStop` s'y borne.
 * Les annoncer comme onze pièces, ce serait promettre onze dessins qu'on n'a
 * pas. Rassemblés par empreinte, il reste trente-quatre pièces distinctes.
 *
 * Ce fichier tient ces trois faits, et la GREFFE elle-même : un dessin de la
 * famille 12 injecté dans la famille 0 devient une vraie variante, à sa place
 * et recolorable — c'est tout l'intérêt de la récolte.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Swf = require(path.join(ROOT, 'public/js/bouille-swf.js'));
require(path.join(ROOT, 'public/js/bouille-avm.js'));
const Moteur = require(path.join(ROOT, 'public/js/bouille-moteur.js'));
const Variante = require(path.join(ROOT, 'public/js/bouille-variante.js'));
const Palette = require(path.join(ROOT, 'public/js/bouille-palette.js'));

const DOSSIER = path.join(ROOT, 'public/fbouille');
const PAGE = fs.readFileSync(path.join(ROOT, 'public/bouille-accessoire.html'), 'utf8');
// Les familles que la page recense — celles qu'on sert en boutique.
const FAMILLES = [10, 11, 12, 13, 14, 15, 16, 23, 24];
const COIF = 8;

function lire(fichier) {
  const brut = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength))
    .then(Swf.lire);
}

// L'empreinte d'un dessin, la même que celle de la page : ce qui le distingue
// d'un autre, sans le peser.
function empreinte(paths) {
  return paths.map((p) => [p.slot, p.avant, p.fill, (p.d || '').length,
    (p.d || '').slice(0, 48)].join('|')).join('¶');
}

// Le recensement d'une famille : ses pièces DISTINCTES.
function recenser(defs) {
  const vues = new Set();
  const pieces = [];
  for (let t = 1; t < Palette.ACCESSORIES.length; t++) {
    let r = null;
    try { r = Variante.repere(defs, t, COIF); } catch (e) { r = null; }
    if (!r || r.variantes < 1) continue;
    for (let v = 0; v < r.variantes; v++) {
      let paths = null;
      try {
        if (!Variante.dessinee(defs, t, v, COIF)) continue;
        paths = Variante.exporter(defs, t, v, COIF);
      } catch (e) { continue; }
      if (!paths || !paths.length) continue;
      const emp = empreinte(paths);
      if (vues.has(emp)) continue;
      vues.add(emp);
      pieces.push({ type: t, variante: v, paths });
    }
  }
  return pieces;
}

test('une seule autre famille porte un rouleau d’accessoire : le ninja', async () => {
  const avec = [];
  for (const f of FAMILLES) {
    const defs = await lire('famille' + f + '.swf');
    if (recenser(defs).length) avec.push(f);
  }
  assert.deepStrictEqual(avec, [12],
    'les autres incarnations dessinent leur couvre-chef dans leur coiffure');
});

test('la famille 12 donne trente-quatre pièces distinctes', async () => {
  const defs = await lire('famille12.swf');
  const pieces = recenser(defs);
  assert.strictEqual(pieces.length, 34);
  // Deux types portent l'essentiel : la casquette et le chapeau cowboy.
  const parType = {};
  pieces.forEach((p) => { parType[p.type] = (parType[p.type] || 0) + 1; });
  assert.strictEqual(parType[3], 24, 'vingt-cinq casquettes, dont deux identiques');
  assert.strictEqual(parType[4], 8, 'huit chapeaux cowboy');
  // Et chaque pièce porte vraiment un dessin.
  pieces.forEach((p) => assert.ok(p.paths.length > 0,
    'type ' + p.type + ' variante ' + p.variante + ' : aucun tracé'));
});

test('les doublons sont bien des doublons, pas un tri trop zélé', async () => {
  /* Onze types de la famille 12 rendent le MÊME dessin que le type 6 : leur
     rouleau ne compte qu'une image. On vérifie que c'est le fichier qui le
     veut, et non l'empreinte qui confond deux dessins voisins. */
  const defs = await lire('famille12.swf');
  const ref = Variante.exporter(defs, 6, 0, COIF);
  assert.ok(ref.length > 0);
  for (const t of [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    const autre = Variante.exporter(defs, t, 0, COIF);
    assert.strictEqual(empreinte(autre), empreinte(ref),
      'le type ' + t + ' devrait rendre le dessin du type 6');
    // Au tracé près, vraiment le même : ce n'est pas l'empreinte qui triche.
    assert.deepStrictEqual(autre.map((p) => p.d), ref.map((p) => p.d));
  }
  // Et les casquettes, elles, sont bien vingt-cinq images pour vingt-quatre
  // dessins : une seule paire se répète.
  const vues = new Map();
  let repetes = 0;
  for (let v = 0; v < Variante.repere(defs, 3, COIF).variantes; v++) {
    if (!Variante.dessinee(defs, 3, v, COIF)) continue;
    const e = empreinte(Variante.exporter(defs, 3, v, COIF));
    if (vues.has(e)) repetes++; else vues.set(e, v);
  }
  assert.strictEqual(repetes, 1);
});

test('une pièce du ninja, greffée, devient une variante classique à sa place', async () => {
  const src = await lire('famille12.swf');
  const hote = await lire('famille0.swf');
  const rep0 = Variante.repere(hote, 4, COIF);          // le chapeau cowboy classique
  const avant = rep0.variantes;

  const paths = Variante.exporter(src, 4, 1, COIF);      // un chapeau du ninja
  assert.ok(paths.length > 0);
  const inj = Variante.injecter(hote, { type: 4, paths, coiffureRef: COIF });
  assert.ok(inj, 'la greffe passe');
  assert.strictEqual(inj.variante, avant, 'elle s’ajoute au bout du rouleau');
  assert.strictEqual(inj.accId, rep0.accId, 'dans le rouleau du MÊME type');

  // Relue depuis la famille 0, elle rend les mêmes tracés : rien ne s'est
  // perdu au passage d'une famille à l'autre.
  const relue = Variante.exporter(hote, 4, inj.variante, COIF);
  assert.deepStrictEqual(relue.map((p) => p.d), paths.map((p) => p.d));

  /* ET ELLE EST À SA PLACE. C'est le point qui décide de tout : les deux
     familles dessinent-elles dans le même repère ? On compare la boîte du
     chapeau récolté à celle d'un chapeau CLASSIQUE du même type — s'ils
     tombent au même endroit, la greffe se pose comme une variante née là.

     La boîte se prend sur les tracés TRANSFORMÉS : `d` vit dans un repère
     local, et c'est `m` — un tableau [a, b, c, d, e, f] — qui le mène à la
     scène. */
  const boite = (liste) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    liste.forEach((p) => {
      const n = (p.d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const m = p.m || [1, 0, 0, 1, 0, 0];
      for (let i = 0; i + 1 < n.length; i += 2) {
        const X = m[0] * n[i] + m[2] * n[i + 1] + m[4];
        const Y = m[1] * n[i] + m[3] * n[i + 1] + m[5];
        if (X < x0) x0 = X; if (X > x1) x1 = X;
        if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
      }
    });
    return { x0, y0, x1, y1 };
  };
  const natif = boite(Variante.exporter(hote, 4, 0, COIF));
  const greffe = boite(relue);
  ['x0', 'y0', 'x1', 'y1'].forEach((k) => {
    assert.ok(Math.abs(greffe[k] - natif[k]) < 6,
      k + ' : le chapeau récolté tombe où tombe un chapeau classique — '
      + JSON.stringify(greffe) + ' contre ' + JSON.stringify(natif));
  });

  // Et elle se PORTE : l'état qui la demande dessine plus que la tête nue.
  const paire = (n) => Moteur.encode62(n, 2);
  const etat = (t, v) => paire(0) + paire(3) + paire(0) + paire(COIF) + paire(0) + paire(2)
    + paire(7) + paire(t) + paire(v) + paire(29) + paire(19) + paire(24);
  const mo = new Moteur.Moteur(hote, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(etat(4, inj.variante));
  assert.ok(mo.racine.face, 'la bouille se monte avec la pièce greffée');
});

test('l’atelier recense pour de vrai, et ne salit pas son propre rouleau', () => {
  /* Le recensement est REFAIT à l'ouverture plutôt qu'écrit en dur : si les
     SWF changent, la liste reste vraie. */
  assert.match(PAGE, /var FAMILLES = \[10, 11, 12, 13, 14, 15, 16, 23, 24\];/);
  assert.match(PAGE, /function recenser\(\) \{/);
  assert.match(PAGE, /Swf\.charger\("\/fbouille\/famille" \+ f \+ "\.swf"\)/);
  // Les doublons sont écartés par empreinte.
  assert.match(PAGE, /if \(vues\[emp\]\) continue;/);
  /* L'HÔTE EST NEUF À CHAQUE PASSE : greffer, c'est ALLONGER le rouleau de la
     famille 0. Garder le même hôte d'un rendu à l'autre l'allongerait de
     trente-quatre à chaque changement de coiffure — et l'atelier, lui, ne doit
     jamais recevoir les greffes de la récolte. */
  assert.match(PAGE, /return Swf\.charger\("\/fbouille\/famille0\.swf"\)\.then\(function \(hote\) \{/);
  const rendu = PAGE.slice(PAGE.indexOf('function rendreRecolte()'),
    PAGE.indexOf('function telechargerPiece'));
  assert.ok(!/V\.injecter\(defs,/.test(rendu), 'la récolte n’injecte jamais dans `defs`');
  // Reprendre un gabarit cale le créneau de destination sur le bon type :
  // l'import de l'encart 3 écrit là où pointe le sélecteur, pas là d'où vient
  // le dessin.
  assert.match(PAGE, /if \(sel\.value !== String\(piece\.type\)\) \{/);
  // Le gabarit montre une tête CLASSIQUE dessous : c'est là qu'on l'adapte.
  assert.match(PAGE, /fondTete: V\.fondTete\(defs, co, 512\),/);
});
