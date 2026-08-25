/*
 * Le quatrième lot de retours MiniPixiz — le dump après la netteté desktop.
 *
 *   · « Les iris s'affichent au-dessus de toutes les autres couches » : le
 *     dessin de chaque pupille est bien plus grand que l'œil — c'est un masque
 *     AU FOND du clip de l'œil qui la contient, et l'extracteur jetait les
 *     masques imbriqués (« les deux petits masques des pupilles », disait son
 *     propre commentaire). La pupille teintée s'étalait sur la chevelure.
 *   · « En jeu les éléments du portrait débordent du cadre » : la fenêtre de
 *     découpe du portrait prenait la taille du CANEVAS du cache — tramé
 *     DENSITE fois plus grand depuis la netteté desktop — au lieu de ses
 *     cotes logiques. Une régression du correctif de netteté.
 *   · « Clametorche tire des billes de lumière au lieu de flammes » : les
 *     TIRS ne déroulaient pas leurs images — partFlameBall en a treize, la
 *     bille qui prend feu, et restait figée sur la première.
 *   · « Le mana continue de se régénérer après élimination d'une couleur » :
 *     Aventure.getManaReplenishCoef rend `flColorKill ? 0 : 3`, et le portage
 *     n'avait pas le drapeau — la recharge ne se coupait jamais.
 *   · « On recommence un niveau avec le mana du niveau d'avant » :
 *     base/Aventure.new fait `fi.fs.$mana = carac[MANA]*2` à CHAQUE entrée en
 *     partie (chaque niveau ré-attache l'écran chez Flash) ; le portage ne
 *     remplissait la réserve qu'à la naissance de la fée.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manifeste = JSON.parse(lire('public/minipixiz/sprites/sprites.json'));

const E = require('../public/minipixiz/engine.js');
const C = require('../public/minipixiz/combat.js');
const F = require('../public/minipixiz/faerie.js');

// Un vrai tirage à graine : genererGraine pioche les goûts dans un
// `while (rng()*table < 1)` qui exige que le tirage BOUGE — un rng constant
// retombe toujours sur le même goût, jamais ajouté, et la boucle ne se
// referme pas.
function seeded(s) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

// ── LES YEUX DU PORTRAIT ──────────────────────────────────────────────────

test('chaque pupille du portrait est contenue par son masque d\'orbite', () => {
  let orbitesUtiles = 0;
  for (const etat of manifeste.portrait.etats) {
    const partiels = new Map((etat.masquesPartiels || []).map((m) => [m.num, m]));
    for (const nomOeil of ['f.o0.p', 'f.o1.p']) {
      const pupille = etat.pieces.find((p) => p.nom === nomOeil);
      if (!pupille) continue;          // certains visages n'ont qu'un œil visible
      assert.ok(pupille.msq, 'frame ' + etat.frame + ' : ' + nomOeil + ' porte un masque');
      const m = partiels.get(pupille.msq);
      assert.ok(m, 'frame ' + etat.frame + ' : son masque est dans masquesPartiels');
      // Le débordement que le masque empêche : sur une partie des visages, le
      // dessin de la pupille est plus grand que son orbite — c'est là que
      // l'iris s'étalait sur la chevelure. (Pas sur tous : certains visages
      // dessinent la pupille plus petite, le masque y est sans travail.)
      if (pupille.w > m.w || pupille.h > m.h) orbitesUtiles++;
    }
  }
  assert.ok(orbitesUtiles >= 2,
    'au moins un visage a une pupille qui déborde de son orbite (' + orbitesUtiles + ')');
});

test('le médaillon de l\'inventaire garde ses pupilles masquées aussi', () => {
  for (const etat of manifeste.invPanneau.etats) {
    const partiels = new Map((etat.masquesPartiels || []).map((m) => [m.num, m]));
    for (const nomOeil of ['pic.f.o0.p', 'pic.f.o1.p']) {
      const pupille = etat.pieces.find((p) => p.nom === nomOeil);
      if (!pupille) continue;
      assert.ok(pupille.msq && partiels.get(pupille.msq),
        'frame ' + etat.frame + ' : ' + nomOeil + ' est découpée par son orbite');
      // Et ce masque n'est PAS le médaillon : chaque œil a le sien.
      const disque = etat.pieces.find((p) => p.nom === 'pic.f.k0');
      if (disque && disque.msq) {
        assert.notStrictEqual(pupille.msq, disque.msq,
          'frame ' + etat.frame + ' : l\'orbite de la pupille n\'est pas le médaillon');
      }
    }
  }
});

// ── LE CADRE DU PORTRAIT EN JEU ───────────────────────────────────────────

test('la fenêtre du portrait se découpe en cotes logiques, pas en pixels du cache', () => {
  const src = lire('public/minipixiz/game.js');
  assert.match(src, /ctx\.rect\(cx \+ fond\.dx, cy \+ fond\.dy, fond\.lw, fond\.lh\)/,
    'le clip du portrait lit lw/lh');
  assert.ok(!/ctx\.rect\(cx \+ fond\.dx, cy \+ fond\.dy, fond\.c\.width/.test(src),
    'plus jamais la taille physique du canevas du cache');
});

// ── CLAMETORCHE ───────────────────────────────────────────────────────────

test('un tir déroule ses images comme une particule (la Clametorche flambe)', () => {
  // partFlameBall a bien ses treize images dans le manifeste…
  const frames = manifeste.partFlameBall.etats.map((e) => e.frame);
  assert.ok(frames.length >= 13, 'partFlameBall : ' + frames.length + ' images extraites');
  // …et un tir qui l'utilise JOUE : init() lève `joue` (treize images à la
  // table IMAGES), et le dessin des tirs suit l'âge comme celui des parts.
  const jeu = new E.Jeu({ graine: 3, niveau: 0, grille: null });
  const champ = new C.Champ(jeu, {});
  const tir = new C.Tir(champ, 'partFlameBall');
  tir.initDirect(4);
  tir.init();
  assert.strictEqual(tir.joue, true, 'le tir partFlameBall se déroule');
  const src = lire('public/minipixiz/game.js');
  assert.match(src, /jeu\.shotList\) \{\s*\n\s*poserVif\(ctx, s\[t\.lien\], t\.joue \? t\.frame \+ Math\.floor\(t\.age\) : t\.frame/,
    'le dessin des tirs anime les clips qui jouent');
  // Les tirs shot* (l\'orbe du démon fixe son image à 1+niveau) ne bougent pas.
  const orbe = new C.Tir(champ, 'shotImp');
  orbe.frame = 3;
  orbe.init();
  assert.strictEqual(orbe.joue, false, 'un tir shot* reste sur son image');
});

// ── LE MANA ───────────────────────────────────────────────────────────────

function partieAvecFee(graine) {
  const jeu = new E.Jeu({ graine: graine || 5, niveau: 0, grille: null });
  const fiche = F.genererGraine(seeded(41));
  fiche.$carac = [1, 1, 1, 1, 1, 3];   // mana 3 → réserve 6
  const fi = new F.Fee(fiche, null, null);
  const champ = new C.Champ(jeu, { fee: fi });
  return { jeu, champ, fi, fee: jeu.faerieList[0] };
}

test('éliminer une couleur coupe la recharge de mana pour le reste du niveau', () => {
  const { jeu, fee } = partieAvecFee(7);
  assert.strictEqual(jeu.flColorKill, false, 'drapeau baissé au départ');

  // Une cascade AVANT toute élimination recharge : quatre jetons × coef 3
  // font passer le compteur sous zéro, la goutte tombe (+80, mana +1).
  fee.poserMana(0);
  fee.manaTimer = 1;                     // la prochaine goutte est proche
  jeu.initStatsChute();
  jeu.fs.list.push(4);
  jeu.fs.sum = 4;
  jeu.verifierStatsChute();
  assert.strictEqual(fee.mana, 1, 'la goutte est tombée');

  // …on épuise une couleur : le drapeau se lève…
  jeu.eList.slice().forEach((el) => { if (el.et === E.E.JETON && el.type === 0) el.tuer(); });
  jeu.majCouleurs();
  assert.strictEqual(jeu.flColorKill, true, 'couleur éliminée → flColorKill');

  // …et la même cascade ne recharge PLUS RIEN.
  fee.poserMana(0);
  fee.manaTimer = 1;
  jeu.initStatsChute();
  jeu.fs.list.push(4);
  jeu.fs.sum = 4;
  jeu.verifierStatsChute();
  assert.strictEqual(fee.mana, 0, 'plus une goutte : la recharge est coupée');
  assert.strictEqual(fee.manaTimer, 1, 'le compteur n\'a même pas bougé');
});

test('le bassin recharge au taux de l\'aventure — Fountain descend d\'Aventure', () => {
  const B = require('../public/minipixiz/bassin.js');
  const b = new B.Bassin({ graine: 3, fees: [] });
  assert.strictEqual(b.jeu.manaCoef, 3, 'même coefficient que la forêt');
});

test('la fée entre en partie la réserve pleine, comme Aventure.new', () => {
  const fiche = F.genererGraine(seeded(43));
  fiche.$carac = [1, 1, 1, 1, 1, 3];   // mana 3 → réserve 6
  fiche.$mana = 1;                      // il lui restait UNE goutte hier
  const fi = new F.Fee(fiche, null, null);

  const jeu = new E.Jeu({ graine: 5, niveau: 0, grille: null });
  const champ = new C.Champ(jeu, { fee: fi });
  assert.strictEqual(fiche.$mana, 6, 'la réserve est refaite au lancement');
  assert.strictEqual(champ.faerieList[0].mana, 6, 'et la fée du champ la porte');

  // Mais RELIRE la fiche en cours de partie (elle mange, reçoit un objet) ne
  // recharge pas : poserInfo n'est pas une entrée en partie.
  fiche.$mana = 2;
  champ.faerieList[0].poserInfo(fi);
  assert.strictEqual(fiche.$mana, 2, 'manger ne remplit pas la réserve');
});
