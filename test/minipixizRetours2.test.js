/*
 * Minipixiz — le quatrième lot de retours joueurs, point par point :
 *
 *   1. LA FÉE DU BASSIN qui, au passage au niveau 2, offrait « rien à
 *      apprendre » en face du +1 : Cm.genFaerieSeed appelle setNextLevelUp,
 *      qui tire le sort LUI-MÊME (Spell.getRandomId). Le portage avait rendu
 *      le tirage injectable et la graine n'en recevait pas — $next naissait
 *      [c, null]. Le tirage du jeu est maintenant le repli par défaut.
 *
 *   2. LA FÉE BLOQUÉE EN MODE COMBAT après la mort du démon : la Cloche
 *      d'immunité (Shield.mt) finissait par endActive + dispel sans jamais
 *      rendre flForceWay — la fée restait aimantée à son dernier point de
 *      sort, et comme Clametorche réécrit `trg` sur le démon, elle faisait
 *      la navette au-dessus du cadavre jusqu'à la fin du niveau, sans
 *      esquiver ni s'écarter des bombes. Même fuite côté démon avec la Nuit
 *      Noire — un démon aimanté finissait poussé dans un coin, parfois dans
 *      la bande cachée au-dessus de l'écran (margeHaut = −32), invisible et
 *      intouchable, la fée mitraillant « exactement le même endroit ».
 *      S'y ajoutaient deux sorts qui PLANTAIENT la boucle de jeu quand leur
 *      cible disparaissait entre le choix et le lancer (Perce-Puits,
 *      Ascension : updateActif après toutFinir).
 *
 *   3. LE BOCAL MUET pendant le rangement de fin de partie : inv/Slot.mt
 *      n'interdit que de DÉPLACER un bocal habité tant qu'il reste des objets
 *      à ranger — l'échange de fée (ESPACE+clic au bureau) reste permis. Le
 *      portage bloquait tout, en silence. Et l'ANCIENNE FÉE « ACTIVE » :
 *      l'inventaire s'ouvrait sur la fée 0 quand $current était nul, au lieu
 *      du médaillon vide de Cm.getCurrentFaerie.
 *
 *   4. LE BOCAL QU'ON NE PEUT PAS DÉPLACER : au bureau, le clic PRENAIT
 *      l'objet en main (inv/Slot.take) et l'échange de fée passait par
 *      ESPACE+clic. Au doigt : l'appui court reste le geste de la fée, le
 *      GLISSER déplace — et la locataire suit son bocal ($pos), comme dans
 *      inv/Slot.swap et inv/Item.addItem.
 *
 *   5. L'ÉVITEMENT DES BOMBES : vérifié contre sp/pe/Faerie.dodge — la fée
 *      n'évite que les TIRS qui la visent, dans un rayon de 30 + rapidité×15.
 *      Aucune caractéristique ne fait éviter les bombes, dans l'original
 *      comme ici — l'intelligence, elle, choisit les sorts et leurs cibles.
 *
 *   6. LE BASSIN REJOUABLE le même jour : la libération s'écrit à l'instant
 *      où la bulle cède ('feeLiberee'), mais l'envoi mourait si le joueur
 *      quittait aussitôt. `keepalive` le fait survivre à la fermeture, et un
 *      échec réseau se retente une fois.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fsLire = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const E = require('../public/minipixiz/engine.js');
const C = require('../public/minipixiz/combat.js');
const F = require('../public/minipixiz/faerie.js');
const S = require('../public/minipixiz/sorts.js');
const O = require('../public/minipixiz/items.js');

function tirage(graine) {
  let s = graine;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function ficheDeCombat(sorts, graine) {
  const alea = tirage(graine || 42);
  const fs = F.genererGraine(alea);
  fs.$spell = sorts.slice();
  fs.$life = 9; fs.$mana = 40;
  fs.$carac = [3, 3, 9, 3, 3, 20];
  const fi = new F.Fee(fs, alea, null);
  fi.carac = fs.$carac.slice();
  fi.sorts = fs.$spell.slice();
  return fi;
}

function monde(sorts, graine) {
  const jeu = new E.Jeu({ graine: graine || 7, niveau: 4 });
  const champ = new C.Champ(jeu, { fee: ficheDeCombat(sorts, graine) });
  return { jeu, champ, fee: champ.faerieList[0] };
}

// ── 1. La fée du bassin apprend un sort dès le premier niveau ─────────────

test('genererGraine prépare un SORT dans $next, comme setNextLevelUp', () => {
  // Spell.getRandomId au niveau 0, mana 1 : les sorts à portée sont ceux de
  // la table avec min 0 et coût ≤ 2 — jamais « rien à apprendre ».
  const eligibles = new Set(
    S.TABLE.filter((o) => o.min <= 0 && o.cost <= 2 && o.freq > 0).map((o) => o.id));
  assert.ok(eligibles.size >= 3, 'la table offre bien des sorts de départ');
  for (let g = 1; g <= 40; g++) {
    const fs = F.genererGraine(tirage(g));
    assert.notEqual(fs.$next[1], null, 'graine ' + g + ' : un sort est réservé');
    assert.ok(eligibles.has(fs.$next[1]),
      'graine ' + g + ' : le sort ' + fs.$next[1] + ' est à sa portée');
    assert.ok(fs.$spell.indexOf(fs.$next[1]) < 0, 'et elle ne le connaît pas déjà');
  }
});

test('le tirage de la graine reste reproductible, et l\'injection des tests aussi', () => {
  const a = F.genererGraine(tirage(9));
  const b = F.genererGraine(tirage(9));
  assert.deepEqual(a.$next, b.$next, 'même graine, même $next');
  // Un appelant qui fournit son tirage garde la main (les tests en dépendent).
  const fee = new F.Fee(F.genererGraine(tirage(5)), tirage(5));
  fee.preparerProchainNiveau(() => 13);
  assert.equal(fee.fs.$next[1], 13);
});

test('la page répare les fiches d\'avant : $next sans sort se retire au moment de monter', () => {
  const page = fsLire.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /nx\[1\] === null \|\| nx\[1\] === undefined/,
    'le panneau de montée vérifie le sort réservé');
  assert.match(page, /mfXp\.fi\.preparerProchainNiveau\(sortAApprendre\);/,
    'et retire comme setNextLevelUp l\'aurait fait');
});

// ── 2. Le combat se dénoue quand le démon meurt ───────────────────────────

test('le démon mort, la fée rend sa cible et cesse de tirer', () => {
  const m = monde([20, 21], 7);          // billes + Théo laser
  const imp = m.champ.naitreImpy(2, 200, 40);
  for (let t = 0; t < 120; t++) { m.jeu.step = E.ETAPE.JEU; m.champ.update(1); }
  assert.equal(m.fee.peTrg, imp, 'le combat est engagé');
  imp.blesser(99999);
  let tirs = 0;
  for (let t = 0; t < 600; t++) {
    const avant = m.champ.shotList.filter((s) => s.lanceur === m.fee).length;
    m.jeu.step = E.ETAPE.JEU;
    m.champ.update(1);
    if (m.champ.shotList.filter((s) => s.lanceur === m.fee).length > avant) tirs++;
  }
  assert.equal(m.fee.peTrg, null, 'la cible est rendue');
  assert.equal(tirs, 0, 'plus un tir après la mort');
  assert.equal(m.champ.impList.length, 0, 'le démon a bien quitté les listes');
});

test('CLOCHE_REND_LE_VOL : après la cloche, la fée reprend son cap libre', () => {
  const m = monde([20, 12], 11);
  m.champ.naitreImpy(2, 200, 40);
  const sort = m.fee.sortList.find((x) => x.sid === 12);
  m.jeu.entree.bas = true;
  sort.ranger();
  let lance = false;
  for (let t = 0; t < 8000; t++) {
    m.jeu.update(1);
    if (sort.flLance) lance = true;
    if (lance && m.jeu.saList.indexOf(sort) < 0) break;
  }
  assert.ok(lance, 'la cloche s\'est jouée');
  assert.equal(m.fee.flForceWay, false,
    'la phase active close, la fée n\'est plus aimantée — elle esquive à nouveau');
});

test('NUIT_REND_LE_VOL : le démon de la Nuit Noire ne reste pas cloué au centre', () => {
  const m = monde([20], 11);
  const imp = m.champ.naitreImpy(2, 200, 40);
  const sort = S.nouveauSortImpy('Nuit', m.champ);
  sort.lanceur = imp;
  sort.imp = imp;
  m.jeu.entree.bas = true;
  sort.ranger();
  let lance = false;
  for (let t = 0; t < 8000; t++) {
    m.jeu.update(1);
    if (sort.flLance) lance = true;
    if (lance && m.jeu.saList.indexOf(sort) < 0) break;
  }
  assert.ok(lance, 'la nuit est tombée');
  assert.ok(m.jeu.nuit, 'et son effet est posé');
  assert.equal(imp.flForceWay, false, 'le démon vole à nouveau librement');
  assert.equal(imp.trg, null, 'sans cible imposée');
});

test('un sort qui se termine net dans son lancer ne plante plus la boucle', () => {
  // Perce-Puits sans colonne choisie, Ascension sans bille : initStep(0) fait
  // toutFinir(), et updateActif ne doit plus être appelé derrière — l'ancien
  // code levait « Cannot read properties of null » à chaque image.
  for (const sid of [1, 7]) {
    const m = monde([20, sid], 11);
    m.champ.naitreImpy(2, 200, 40);
    const sort = m.fee.sortList.find((x) => x.sid === sid);
    m.jeu.entree.bas = true;
    sort.ranger();                       // sans pertinence() : this.best est nul
    assert.doesNotThrow(() => {
      for (let t = 0; t < 2000; t++) {
        m.jeu.update(1);
        if (m.jeu.saList.length === 0 && t > 60) break;
      }
    }, 'sort ' + sid + ' : la partie continue');
    assert.equal(m.jeu.saList.indexOf(sort), -1, 'et le sort a quitté la file');
    assert.equal(m.fee.flForceWay, false, 'sans aimanter la fée');
  }
});

test('le démon qui a fini ses tours quitte l\'écran et meurt au-dessus (y < -20)', () => {
  const m = monde([20], 7);
  const imp = m.champ.naitreImpy(2, 180, 40);
  imp.action = 0;
  let t = 0;
  for (; t < 3000 && !imp.flDeath; t++) { m.jeu.step = E.ETAPE.JEU; m.champ.update(1); }
  assert.ok(imp.flDeath, 'il est bien parti');
  assert.ok(imp.y < -20, 'par le haut, hors de l\'écran (y=' + imp.y.toFixed(1) + ')');
  // La fée rend sa cible à SA prochaine image (People.update) : un pas de plus.
  m.jeu.step = E.ETAPE.JEU;
  m.champ.update(1);
  assert.equal(m.fee.peTrg, null, 'et la fée est libérée');
});

// ── 3 et 4. Le bocal : l'appui échange la fée, le glisser déplace ─────────

function fauxInventaire(carte) {
  if (typeof global.window === 'undefined' || !global.window.addEventListener) {
    global.window = { addEventListener() {}, devicePixelRatio: 1 };
  }
  global.window.MinipixizFee = F;
  if (typeof global.document === 'undefined') {
    global.document = { body: { clientWidth: 240, clientHeight: 240 } };
  }
  const I = require('../public/minipixiz/inventaire.js');
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : () => {}),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const canvas = {
    getContext: () => ctx,
    addEventListener() {},
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    style: {},
    parentElement: null,
    width: 0,
    height: 0,
  };
  const inv = new I.Inventaire({ canvas, plateforme: { carte }, sprites: {} });
  inv.rendre = () => {};
  return inv;
}

function carteAvecBocal() {
  const vieille = F.genererGraine(tirage(3));
  vieille.$name = 'Vieille'; vieille.$level = 11;
  const mimi = F.genererGraine(tirage(8));
  mimi.$name = 'Mimi'; mimi.$level = 3;
  return {
    $current: 1, $bag: 1, $inv: [30, null, null, null],
    $faerie: [vieille, mimi], $mis: [], $key: 0, $star: 0, $diam: 0,
  };
}

test('pendant le rangement, l\'appui sort ENCORE la fée du bocal (inv/Slot.mt)', () => {
  const carte = carteAvecBocal();
  const inv = fauxInventaire(carte);
  inv.ouvrir();
  inv.toucher('joueur', 0);
  assert.equal(carte.$faerie[1].$pos, 0, 'Mimi est au bocal');
  assert.equal(carte.$current, null);

  inv.setExtraList([301, 302]);          // le sac a débordé : rangement imposé
  inv.toucher('joueur', 0);              // l'ESPACE+clic du bureau, l'appui ici
  assert.equal(carte.$faerie[1].$pos, null, 'elle en ressort quand même');
  assert.equal(carte.$current, 1, 'et reprend la main');
  assert.equal(inv.feeCourante, 1, 'le panneau la suit');

  // Le verrou d'origine, lui, tient toujours : le bocal habité ne se DÉPLACE
  // pas tant qu'il reste des objets à ranger — et maintenant il le DIT.
  inv.toucher('joueur', 0);              // Mimi rentre à nouveau
  inv.main = { sac: 'joueur', case: 1 };
  carte.$inv[1] = 301;
  inv.toucher('joueur', 0);
  assert.equal(carte.$inv[0], 30, 'le bocal n\'a pas bougé');
  assert.match(inv.message, /Rangez vos nouveaux objets/, 'et le jeu explique pourquoi');
});

test('$current nul : le sac s\'ouvre sur un médaillon vide, pas sur la fée 0', () => {
  const carte = carteAvecBocal();
  carte.$faerie[1].$pos = 0;             // Mimi dort au bocal
  carte.$current = null;
  const inv = fauxInventaire(carte);
  inv.ouvrir();
  assert.equal(inv.feeCourante, null, 'personne n\'est « active »');
  assert.equal(inv.fee(), null, 'le panneau est vide — plus de fantôme niveau 12');
  // La sortir du bocal la met en main ET à l'écran.
  inv.toucher('joueur', 0);
  assert.equal(carte.$current, 1);
  assert.equal(inv.feeCourante, 1, 'la vraie fée revient au médaillon');
});

test('la locataire SUIT son bocal : déplacement, échange, et jamais hors du sac', () => {
  const carte = carteAvecBocal();
  carte.$faerie[1].$pos = 0;
  // Vers une case vide : $pos suit (inv/Item.addItem).
  assert.ok(O.deplacer(carte, { sac: 'joueur', case: 0 }, { sac: 'joueur', case: 2 }));
  assert.equal(carte.$inv[2], 30);
  assert.equal(carte.$faerie[1].$pos, 2, 'Mimi a déménagé avec son bocal');
  // Échange avec un autre objet : pareil (inv/Slot.swap).
  carte.$inv[0] = 301;
  assert.ok(O.deplacer(carte, { sac: 'joueur', case: 2 }, { sac: 'joueur', case: 0 }));
  assert.equal(carte.$faerie[1].$pos, 0);
  // Mais un bocal HABITÉ ne quitte pas le sac du joueur : $pos n'a de sens
  // que là (et dans le jeu, le bocal n'est pas flEquip).
  assert.equal(O.deplacer(carte, { sac: 'joueur', case: 0 }, { sac: 1, case: 0 }), false);
  assert.equal(carte.$faerie[1].$pos, 0, 'Mimi n\'a pas bougé');
});

test('le GLISSER déplace le bocal, l\'appui court met toujours la fée dedans', () => {
  const carte = carteAvecBocal();
  const inv = fauxInventaire(carte);
  inv.ouvrir();

  // L'appui court (pas de mouvement) laisse le geste au clic : la fée entre.
  inv.doigtPose({ clientX: 61, clientY: 74 });
  inv.doigtLeve({ clientX: 61, clientY: 74 });
  assert.equal(inv.clicApresGlisse, false, 'aucun glisser : le clic garde la main');
  inv.clic({ clientX: 61, clientY: 74 });
  // (les zones du vrai rendu ne sont pas là — on passe par toucher directement)
  inv.toucher('joueur', 0);
  assert.equal(carte.$faerie[1].$pos, 0, 'l\'appui met bien Mimi au bocal');

  // Le glisser, lui, DÉPLACE — bocal habité compris, et $pos suit.
  inv.zones = [];
  inv.zoneRect({ sac: 'joueur', case: 0 }, 45, 58, 32, 32);
  inv.zoneRect({ sac: 'joueur', case: 3 }, 77, 90, 32, 32);
  inv.doigtPose({ clientX: 61, clientY: 74 });
  inv.doigtBouge({ clientX: 70, clientY: 84 });
  assert.ok(inv.glisse && inv.glisse.pris, 'six pixels : l\'objet est pris');
  inv.doigtLeve({ clientX: 93, clientY: 106 });
  assert.equal(carte.$inv[3], 30, 'le bocal est déposé case 3');
  assert.equal(carte.$faerie[1].$pos, 3, 'Mimi a suivi');
  assert.equal(inv.clicApresGlisse, true, 'et le click fantôme du navigateur sera avalé');
  inv.clic({ clientX: 93, clientY: 106 });
  assert.equal(carte.$faerie[1].$pos, 3, 'ce click-là n\'a rien touché');
});

test('la poubelle refuse un bocal habité, et le glisser peut nourrir au portrait', () => {
  const carte = carteAvecBocal();
  carte.$faerie[1].$pos = 0;
  const inv = fauxInventaire(carte);
  inv.ouvrir();
  inv.jeterDepuis({ sac: 'joueur', case: 0 });
  assert.equal(carte.$inv[0], 30, 'le bocal est toujours là');
  assert.match(inv.message, /Sortez d'abord Mimi/, 'et le jeu dit quoi faire');

  // Un aliment glissé sur le portrait se donne (Inventory.giveItem).
  carte.$faerie[1].$pos = null;
  carte.$current = 1;
  inv.ouvrir();
  carte.$inv[1] = 300;                   // une part de brioche
  carte.$faerie[1].$hunger = 4;
  const faimAvant = carte.$faerie[1].$hunger;
  inv.deposer({ sac: 'joueur', case: 1 }, 'portrait');
  assert.ok(carte.$faerie[1].$hunger > faimAvant, 'Mimi a mangé');
});

// ── 5. L'évitement : les tirs oui, les bombes non — comme l'original ──────

test('la fée esquive les TIRS qui la visent ; rien d\'autre (sp/pe/Faerie.dodge)', () => {
  const m = monde([20], 7);
  const fee = m.fee;
  fee.x = 66; fee.y = 120;
  fee.noTrgTimer = 0;

  // Un tir qui la vise, à portée de sa vigilance (30 + rapidité×15) : esquive.
  const s = new C.Tir(m.champ, 'shotImp');
  s.x = fee.x + 20; s.y = fee.y;
  s.cibles.push(fee);
  s.ajouterA(m.champ.shotList);
  fee.esquiver();
  assert.ok(fee.noTrgTimer > 0, 'elle s\'écarte du tir');

  // Une bombe posée à côté (grille) : aucune caractéristique n'en éloigne la
  // fée — c'est le comportement du fichier d'origine, à la lettre.
  s.tuer();
  fee.noTrgTimer = 0;
  const source = fsLire.readFileSync(
    path.join(ROOT, 'public/minipixiz/combat.js'), 'utf8');
  const corps = /esquiver\(\) \{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(corps, 'esquiver est là');
  assert.match(corps[1], /shotList/, 'elle ne regarde que les tirs');
  assert.ok(!/eList|BOMBE/.test(corps[1]), 'jamais la grille ni les bombes');
  fee.esquiver();
  assert.equal(fee.noTrgTimer, 0, 'sans tir, pas d\'esquive');
});

// ── 6. La libération du bassin survit au départ précipité ─────────────────

test('l\'écriture de la fiche survit à la fermeture de la page et se retente', () => {
  const src = fsLire.readFileSync(path.join(ROOT, 'public/minipixiz/plateforme.js'), 'utf8');
  assert.match(src, /keepalive: corps\.length < 60000/,
    'keepalive : l\'envoi survit à la fermeture');
  assert.match(src, /const envoyer = \(\) => fetch\('\/api\/saveFrutiSlot'/,
    'l\'envoi est rejouable');
  assert.match(src, /\.catch\(\(\) => envoyer\(\)/, 'et un échec réseau se retente');

  const page = fsLire.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /if \(nom === 'feeLiberee'\) \{\s*\n\s*plateforme\.ecrire\(plateforme\.carte\);/,
    'la libération s\'écrit à l\'instant où la bulle cède');
});
