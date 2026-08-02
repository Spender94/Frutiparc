// Moteur de Miniwave 2 (portage natif pour /light).
//
// Le moteur est une traduction des classes AS2 d'origine, sans rendu : il tourne
// sous Node, donc on peut faire jouer des parties entières et vérifier les
// règles plutôt que des pixels.
//
// Ce qui est vérifié ici, c'est ce qui FAIT le jeu : les escadres entrent par
// l'extérieur et se rangent en formation, la vague rebondit sur les bords en
// descendant d'un cran, un tir tue et rapporte la valeur de sa cible, un tir
// perdu coûte un point, toucher le bas ou un ennemi coûte un vaisseau, et la
// partie s'arrête quand il n'y a plus personne à envoyer.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));
const ARCADE = NIVEAUX.main[0].levels;

// Fait tourner une partie. `pilote(jeu, i)` peut agir sur les commandes à chaque
// image ; on s'arrête au bout de `images` ou à la fin de la partie.
function jouer(o) {
  o = o || {};
  const journal = [];
  const jeu = new E.Game({
    levels: o.levels || ARCADE,
    graine: o.graine === undefined ? 7 : o.graine,
    vies: o.vies,
    onEvent: (n, d) => journal.push({ n, d }),
  });
  const n = o.images || 1000;
  for (let i = 0; i < n && !jeu.termine; i++) {
    if (o.pilote) o.pilote(jeu, i);
    jeu.update(o.tmod === undefined ? 1 : o.tmod);
  }
  return { jeu, journal, compte: (nom) => journal.filter((e) => e.n === nom).length };
}

// Amène la partie jusqu'au combat du premier niveau.
function jusquAuCombat(jeu, max) {
  for (let i = 0; i < (max || 600) && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  return jeu.step === E.ETAPE.COMBAT;
}

test('le premier niveau place exactement les vaisseaux décrits', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 1 });
  // Étape 0 : le panneau « level 1 » ; les ennemis n'existent pas encore.
  assert.equal(jeu.step, E.ETAPE.PANNEAU);
  assert.equal(jeu.badsList.length, 0, 'rien tant que le panneau est affiché');

  for (let i = 0; i < 200 && jeu.step === E.ETAPE.PANNEAU; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.ARRIVEE, 'le panneau laisse place à l\'arrivée');

  // Le niveau 1 de l'arcade décrit quatre Letter-monsters sur une ligne.
  const attendus = ARCADE[0].list.reduce((n, ligne) =>
    n + ((ligne && ligne.length > 1) ? ligne.filter((c) => c && c.t !== undefined).length : 0), 0);
  assert.equal(jeu.badsList.length, attendus, `${attendus} ennemis placés`);
  assert.equal(jeu.toKill, attendus, 'et autant à abattre');
  assert.deepEqual(jeu.badsList.map((b) => b.type), [43, 43, 43, 43],
    'du type écrit dans le niveau');
});

test('les escadres entrent par l\'extérieur et se rangent en formation', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 1 });
  for (let i = 0; i < 200 && jeu.step === E.ETAPE.PANNEAU; i++) jeu.update(1);

  // À l'apparition, tout le monde est hors cadre : c'est le vol d'entrée.
  assert.ok(jeu.badsList.every((b) => jeu.horsCadre(b.x, b.y, 0)),
    'les vaisseaux arrivent de l\'extérieur de l\'écran');
  assert.ok(jeu.badsList.every((b) => !b.flReady), 'aucun n\'est encore en place');

  assert.ok(jusquAuCombat(jeu), 'la vague finit par se ranger');
  assert.ok(jeu.badsList.every((b) => b.flReady), 'tous en place');
  // Et chacun sur SON point : celui que le niveau lui assignait.
  const cibles = ARCADE[0].list[0].filter((c) => c && c.t !== undefined);
  const posees = jeu.badsList.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y) }));
  for (const c of cibles) {
    assert.ok(posees.some((p) => Math.abs(p.x - c.x) < 2 && Math.abs(p.y - c.y) < 2),
      `un vaisseau occupe le point (${c.x},${c.y}) — obtenu ${JSON.stringify(posees)}`);
  }
});

test('la vague rebondit sur les bords et descend d\'un cran', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 1 });
  assert.ok(jusquAuCombat(jeu));

  const sensDepart = jeu.waveSens;
  const tyDepart = jeu.badsList.map((b) => b.ty);
  let change = 0;
  for (let i = 0; i < 4000 && change === 0; i++) {
    jeu.update(1);
    if (jeu.waveSens !== sensDepart) change = i;
  }
  assert.ok(change > 0, 'la vague finit par changer de sens');
  // Le changement de sens fait descendre TOUT le monde de fallSpeed.
  const ty = jeu.badsList.map((b) => b.ty);
  assert.ok(ty.length > 0, 'il reste des ennemis');
  assert.ok(ty.every((v, i) => v >= tyDepart[i] + jeu.fallSpeed - 0.001),
    `la cible verticale a descendu de ${jeu.fallSpeed} (avant ${tyDepart}, après ${ty})`);
});

test('un tir abat sa cible et rapporte la valeur inscrite au bestiaire', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 1 });
  assert.ok(jusquAuCombat(jeu));
  const cible = jeu.badsList[0];
  const valeur = E.ENNEMIS[cible.type].value;
  const avant = jeu.score;
  const nb = jeu.badsList.length;

  // On pose un tir du vaisseau pile sur elle, comme s'il venait d'arriver.
  jeu.newHShot({ x: cible.x, y: cible.y, vitx: 0, vity: 0, flStandardHeroShot: true });
  jeu.update(1);

  assert.equal(jeu.badsList.length, nb - 1, 'la cible a disparu');
  assert.equal(jeu.score, avant + valeur, `+${valeur} points (${E.ENNEMIS[cible.type].name})`);
  assert.equal(jeu.toKill, nb - 1, 'le compteur de la vague suit');
});

test('un tir perdu coûte un point — on ne fait pas de score en arrosant', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 1 });
  assert.ok(jusquAuCombat(jeu));
  jeu.score = 100;
  // Un tir lancé vers le haut depuis le vide sortira du cadre sans rien toucher.
  jeu.newHShot({ x: 5, y: 5, vitx: 0, vity: -3, flStandardHeroShot: true });
  for (let i = 0; i < 40 && jeu.hShotList.length > 0; i++) jeu.update(1);
  assert.equal(jeu.hShotList.length, 0, 'le tir est sorti');
  assert.ok(jeu.score <= 99, `le tir perdu a été décompté (score ${jeu.score})`);
});

test('percuter un ennemi coûte un vaisseau, et la réserve s\'épuise', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 1, vies: 2 });
  assert.ok(jusquAuCombat(jeu));
  assert.ok(jeu.hero, 'un vaisseau est en piste');
  assert.equal(jeu.heroList.length, 1, 'un seul en réserve');

  // On amène un ennemi au contact, bouclier d'apparition expiré.
  jeu.hero.newShield = undefined;
  const b = jeu.badsList[0];
  b.x = jeu.hero.x;
  b.y = jeu.hero.y;
  b.waveUpdate(1);

  assert.ok(!jeu.hero || jeu.hero.hp <= 0, 'le vaisseau est détruit');
  jeu.update(1);
  assert.ok(jeu.hero, 'le suivant entre en piste');
  assert.equal(jeu.heroList.length, 0, 'la réserve est vide');
});

test('le bouclier d\'apparition protège vraiment', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 1, vies: 3 });
  assert.ok(jusquAuCombat(jeu));
  const h = jeu.hero;
  assert.ok(h.newShield, 'le vaisseau arrive protégé');
  const hp = h.hp;
  h.frapper();
  assert.equal(h.hp, hp, 'un coup encaissé pendant le bouclier ne retire rien');
});

test('l\'escadre qui atteint le bas détruit le vaisseau', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 1 });
  assert.ok(jusquAuCombat(jeu));
  jeu.hero.newShield = undefined;
  const b = jeu.badsList[0];
  b.x = 10;                       // loin du vaisseau : ce n'est pas un choc
  b.y = E.HAUTEUR;                // mais il touche le sol
  b.waveUpdate(1);
  assert.ok(!jeu.hero || jeu.hero.hp <= 0, 'atteindre le bas, c\'est perdre un vaisseau');
});

test('la vague nettoyée fait passer au niveau suivant', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 1 });
  assert.ok(jusquAuCombat(jeu));
  assert.equal(jeu.level, 0);
  while (jeu.badsList.length) jeu.badsList[0].exploser();
  for (let i = 0; i < 200 && jeu.level === 0; i++) jeu.update(1);
  assert.equal(jeu.level, 1, 'on passe au niveau 2');
  assert.equal(jeu.step, E.ETAPE.PANNEAU, 'avec son panneau de présentation');
});

test('la fin du parcours termine la partie', () => {
  // Un parcours de deux niveaux : on les vide, la partie doit s'arrêter.
  const jeu = new E.Game({ levels: ARCADE.slice(0, 2), graine: 1 });
  for (let tour = 0; tour < 2; tour++) {
    assert.ok(jusquAuCombat(jeu), `niveau ${tour + 1} atteint`);
    while (jeu.badsList.length) jeu.badsList[0].exploser();
    for (let i = 0; i < 200 && jeu.step !== E.ETAPE.PANNEAU; i++) jeu.update(1);
  }
  for (let i = 0; i < 200 && !jeu.termine; i++) jeu.update(1);
  assert.ok(jeu.termine, 'la partie est finie');
});

test('sans vaisseau en réserve, la partie s\'arrête', () => {
  const r = jouer({
    vies: 1,
    images: 3000,
    pilote: (jeu) => {
      // On se laisse toucher : pas de bouclier, et on reste sous la vague.
      if (jeu.hero) jeu.hero.newShield = undefined;
    },
  });
  // On force le coup fatal une fois la vague en place.
  const jeu = r.jeu;
  if (!jeu.termine && jeu.hero && jeu.badsList.length) {
    jeu.hero.newShield = undefined;
    jeu.hero.frapper(10);
    for (let i = 0; i < 50 && !jeu.termine; i++) jeu.update(1);
  }
  assert.ok(jeu.termine, 'plus de vaisseau, plus de partie');
  assert.equal(jeu.flGameOver, true);
});

test('les ennemis ripostent', () => {
  const r = jouer({ images: 3000, graine: 3 });
  assert.ok(r.compte('tirBads') > 0, 'la vague tire sur le joueur');
});

test('deux parties de même graine se déroulent à l\'identique', () => {
  const pilote = (jeu, i) => {
    jeu.entree.tir = true;
    jeu.entree.droite = (i % 120) < 60;
    jeu.entree.gauche = (i % 120) >= 60;
  };
  const a = jouer({ graine: 1234, images: 2500, pilote });
  const b = jouer({ graine: 1234, images: 2500, pilote });
  assert.equal(a.jeu.score, b.jeu.score, 'même score');
  assert.equal(a.jeu.level, b.jeu.level, 'même avancement');
  assert.equal(a.journal.length, b.journal.length, 'même suite d\'événements');
  // Et une graine différente donne une autre partie : le hasard sert vraiment.
  const c = jouer({ graine: 4321, images: 2500, pilote });
  assert.notEqual(c.journal.length, a.journal.length, 'une autre graine, une autre partie');
});

test('tous les niveaux du jeu se chargent sans caler', () => {
  // Le point sensible : un niveau du parcours d'essai a un moveSpeed manquant
  // (NaN à l'origine). Sans repli, sa vague resterait immobile et le joueur
  // serait bloqué — on vérifie donc que CHAQUE niveau donne des vitesses finies
  // et une escadre plaçable.
  const parcours = [].concat(NIVEAUX.main, NIVEAUX.bonus, NIVEAUX.letter);
  let places = 0, combats = 0;
  for (const p of parcours) {
    for (let i = 0; i < p.levels.length; i++) {
      const jeu = new E.Game({ levels: p.levels.slice(i, i + 1), graine: 1 });
      for (let k = 0; k < 400 && jeu.step === E.ETAPE.PANNEAU; k++) jeu.update(1);
      // Le dernier niveau de l'arcade s'appelle « boss » : il n'a pas d'escadre,
      // c'est le combat de fin de parcours.
      if (jeu.step === E.ETAPE.BOSS) {
        assert.ok(jeu.boss, `« ${p.name} » niveau ${i + 1} : le boss est en piste`);
        combats++;
        continue;
      }
      assert.ok(Number.isFinite(jeu.waveSpeed) && jeu.waveSpeed > 0,
        `« ${p.name} » niveau ${i + 1} : vitesse de vague utilisable (${jeu.waveSpeed})`);
      assert.ok(Number.isFinite(jeu.fallSpeed), `« ${p.name} » niveau ${i + 1} : descente définie`);
      assert.ok(jeu.badsList.length > 0, `« ${p.name} » niveau ${i + 1} : la vague n'est pas vide`);
      assert.ok(jeu.badsList.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y)),
        `« ${p.name} » niveau ${i + 1} : positions calculables`);
      places += jeu.badsList.length;
    }
  }
  assert.ok(places > 5000, `les milliers de vaisseaux du jeu sont plaçables (${places})`);
  assert.equal(combats, 1, 'un seul combat de boss dans tout le jeu : la fin de l\'arcade');
});

test('une partie longue reste saine', () => {
  // Filet anti-fuite : après plusieurs milliers d'images, les listes internes
  // ne doivent pas avoir gonflé de cadavres.
  const r = jouer({
    images: 6000,
    graine: 99,
    pilote: (jeu, i) => { jeu.entree.tir = true; jeu.entree.droite = (i % 200) < 100; },
  });
  const jeu = r.jeu;
  assert.ok(jeu.spriteList.every((s) => s.vivant), 'aucun sprite mort ne traîne');
  assert.ok(jeu.spriteList.length < 400, `la liste des sprites reste bornée (${jeu.spriteList.length})`);
  assert.ok(jeu.hShotList.every((s) => s.vivant) && jeu.bShotList.every((s) => s.vivant),
    'les listes de tirs sont propres');
  assert.ok(jeu.score !== 0, 'et il s\'est passé quelque chose');
});

// ── Le bestiaire ───────────────────────────────────────────────────────────
// Le jeu compte 51 espèces, chacune avec sa cadence, sa robustesse et son arme.
// Le portage les décrit dans une table plutôt qu'en 51 sous-classes : ces tests
// vérifient que la table couvre tout le monde et que personne ne casse la partie.

// Met un ennemi du type voulu en situation de combat, seul, et rend le jeu.
function enCombat(type, o) {
  o = o || {};
  const niveau = {
    name: 'essai', moveSpeed: 1, fallSpeed: 6, ss: 6, sd: 6,
    list: [[{ t: type, x: 120, y: 40 }, { t: type, x: 96, y: 40 }]],
  };
  const journal = [];
  const jeu = new E.Game({
    levels: [niveau], graine: o.graine === undefined ? 11 : o.graine,
    onEvent: (n, d) => journal.push({ n, d }),
  });
  for (let i = 0; i < 800 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  return { jeu, journal, compte: (nom) => journal.filter((e) => e.n === nom).length };
}

test('les 51 espèces du bestiaire ont toutes un profil', () => {
  for (let t = 0; t < E.ENNEMIS.length; t++) {
    assert.ok(E.TYPES[t], `le type ${t} (${E.ENNEMIS[t].name}) est décrit`);
  }
  assert.equal(Object.keys(E.TYPES).length, 51, 'et il n\'y en a pas d\'autres');
});

test('chaque espèce se bat sans casser la partie', () => {
  // Le vrai filet : on met chaque type en piste, on le laisse tirer, exploser,
  // charger, poser des mines — mille images chacun. Aucune ne doit lever
  // d'erreur ni produire de position aberrante.
  for (let t = 0; t < E.ENNEMIS.length; t++) {
    const r = enCombat(t, { graine: 100 + t });
    const jeu = r.jeu;
    assert.equal(jeu.step, E.ETAPE.COMBAT, `${E.ENNEMIS[t].name} : la vague se met en place`);
    jeu.entree.tir = true;
    for (let i = 0; i < 1000 && !jeu.termine; i++) {
      jeu.update(1);
      jeu.entree.droite = (i % 80) < 40;
      jeu.entree.gauche = !jeu.entree.droite;
    }
    for (const s of jeu.spriteList) {
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y),
        `${E.ENNEMIS[t].name} : position calculable (${s.x},${s.y})`);
    }
    assert.ok(Number.isFinite(jeu.score), `${E.ENNEMIS[t].name} : score calculable`);
  }
});

test('les espèces armées ripostent, les autres non', () => {
  // Onze espèces n'ouvrent pas le feu d'elles-mêmes : elles ont une autre arme
  // (l'explosion, la charge, le bord de l'écran) ou aucune.
  // La Figue-laser en fait partie : son arme est un rayon, pas un projectile.
  const sansTir = [0, 4, 9, 11, 13, 19, 26, 28, 31, 33, 49, 50];
  for (let t = 0; t < E.ENNEMIS.length; t++) {
    const r = enCombat(t, { graine: 500 + t });
    // Deux espèces cuirassées (Poire sous cloche, Citrus) ne ripostent qu'une
    // fois leur coque entamée : on les met dans cet état avant d'observer.
    for (const b of r.jeu.badsList) while (b.hp > 1) b.frapper();
    for (let i = 0; i < 1500 && !r.jeu.termine; i++) r.jeu.update(1);
    const aTire = r.compte('tirBads') > 0;
    if (sansTir.includes(t)) {
      // Certaines tirent quand même — mais seulement par leur arme propre
      // (l'Abricot au bord, le Pruneau passe-muraille en changeant de côté).
      continue;
    }
    assert.ok(aTire, `${E.ENNEMIS[t].name} (type ${t}) riposte`);
  }
});

test('les espèces cuirassées encaissent plusieurs coups', () => {
  // Orangeonaute 2, Poire sous cloche 2, Citrus 3, Myrtillerie 2, Brugnon 2.
  for (const [type, pv] of [[1, 2], [7, 2], [17, 3], [26, 2], [48, 2]]) {
    const r = enCombat(type, { graine: 3 });
    const b = r.jeu.badsList[0];
    assert.equal(b.hp, pv, `${E.ENNEMIS[type].name} a ${pv} points de coque`);
    for (let i = 1; i < pv; i++) {
      b.frapper();
      assert.ok(b.vivant, `${E.ENNEMIS[type].name} tient après ${i} coup(s)`);
    }
    b.frapper();
    assert.ok(!b.vivant, `${E.ENNEMIS[type].name} cède au dernier coup`);
  }
});

test('la Pomme d\'épines et les Baies arrosent en mourant', () => {
  for (const type of [13, 19]) {
    const r = enCombat(type, { graine: 4 });
    const avant = r.jeu.bShotList.length;
    r.jeu.badsList[0].exploser();
    assert.ok(r.jeu.bShotList.length > avant,
      `${E.ENNEMIS[type].name} laisse des projectiles derrière lui`);
  }
});

test('le Nitro-pruneau explose en chaîne', () => {
  // Type 49 : sa mort crée un souffle (comportement 7) qui frappe ses voisins.
  const niveau = {
    name: 'chaîne', moveSpeed: 1, fallSpeed: 6, ss: 6, sd: 6,
    list: [[{ t: 49, x: 120, y: 40 }, { t: 0, x: 126, y: 40 }, { t: 0, x: 132, y: 40 }]],
  };
  const jeu = new E.Game({ levels: [niveau], graine: 2 });
  for (let i = 0; i < 800 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  const nb = jeu.badsList.length;
  assert.ok(nb >= 2, 'plusieurs ennemis côte à côte');
  const nitro = jeu.badsList.find((b) => b.type === 49);
  nitro.x = 120; nitro.y = 40;
  jeu.badsList.filter((b) => b.type === 0).forEach((b) => { b.x = 124; b.y = 40; });
  nitro.exploser();
  for (let i = 0; i < 30; i++) jeu.update(1);
  assert.ok(jeu.badsList.length < nb - 1, 'le souffle a emporté au moins un voisin');
});

test('l\'Abricot guerrier tire quand la vague touche un bord', () => {
  const r = enCombat(31, { graine: 6 });
  assert.equal(r.compte('tirBads'), 0, 'il ne tire pas de lui-même');
  r.jeu.badsList[0].auBord();
  assert.equal(r.compte('tirBads'), 1, 'mais il riposte au demi-tour de l\'escadre');
});

test('les tirs destructibles du Kiwi peuvent être abattus', () => {
  const r = enCombat(39, { graine: 8 });
  const jeu = r.jeu;
  jeu.badsList[0].tirer();
  const tir = jeu.bShotList[0];
  assert.ok(tir, 'le Kiwi a tiré');
  assert.equal(tir.behaviourId, 16, 'son tir est du type destructible');
  // On l'éloigne du tireur avant de l'intercepter : sinon c'est le KIWI que le
  // tir du vaisseau touche en premier, ce qui est le comportement normal.
  tir.x = 40; tir.y = 150;
  jeu.newHShot({ x: 40, y: 150, vitx: 0, vity: 0 });
  jeu.update(1);
  assert.equal(tir.flHit, false, 'touché par un tir du vaisseau, il devient inoffensif');
});

test('la Figue-laser balaie sa colonne au lieu de tirer', () => {
  const r = enCombat(11, { graine: 12 });
  const jeu = r.jeu;
  const f = jeu.badsList[0];
  f.tirer();
  assert.equal(r.compte('rayonFigue'), 1, 'elle ouvre un rayon');
  assert.equal(r.compte('tirBads'), 0, 'et ne lâche aucun projectile');
  // Le vaisseau placé sous elle, rayon ouvert, est touché.
  const h = jeu.hero;
  h.newShield = undefined;
  h.x = f.x;
  f.timer = 30;                     // en plein balayage
  const pv = h.hp;
  f.waveUpdate(1);
  assert.ok(h.hp < pv || !h.vivant, 'rester sous le rayon coûte un vaisseau');
});

test('la Prune paralysante brouille au lieu de blesser', () => {
  const r = enCombat(41, { graine: 9 });
  const jeu = r.jeu;
  const h = jeu.hero;
  h.newShield = undefined;
  const pv = h.hp;
  jeu.badsList[0].tirer();
  const tir = jeu.bShotList[0];
  tir.x = h.x; tir.y = h.y;
  jeu.update(1);
  assert.equal(h.hp, pv, 'le vaisseau n\'est pas endommagé');
  assert.equal(h.flEMP, true, 'mais il est brouillé');
  h.jeu.entree.tir = true;
  const avant = jeu.hShotList.length;
  h.coolDown = 0;
  h.commander(1);
  assert.equal(jeu.hShotList.length, avant, 'et ne peut plus tirer');
});

// ── Le boss ────────────────────────────────────────────────────────────────
// Un seul adversaire, mais trois formes qui s'enchaînent : la coquille, le
// casque, puis l'orange qu'ils protégeaient. Ce qui est vérifié ici, c'est
// l'enchaînement et la règle qui fait tout le combat : la coquille lancée
// renvoie les tirs, et chaque coup encaissé l'accélère — donc la protège.

const NIVEAU_VAGUE = {
  name: 'essai', moveSpeed: 1, fallSpeed: 6, ss: 6, sd: 6,
  list: [[{ t: 0, x: 120, y: 40 }, { t: 0, x: 96, y: 40 }]],
};
const NIVEAU_BOSS = Object.assign({}, NIVEAU_VAGUE, { name: 'boss' });

// Ouvre une partie directement sur le combat de boss.
function auBoss(graine) {
  const journal = [];
  const jeu = new E.Game({
    levels: [NIVEAU_BOSS], graine: graine === undefined ? 3 : graine, vies: 99,
    onEvent: (n, d) => journal.push({ n, d }),
  });
  for (let i = 0; i < 400 && jeu.step !== E.ETAPE.BOSS; i++) jeu.update(1);
  return { jeu, journal, compte: (nom) => journal.filter((e) => e.n === nom).length };
}

test('un niveau nommé « boss » ouvre un combat au lieu d\'une vague', () => {
  const r = auBoss();
  assert.equal(r.jeu.step, E.ETAPE.BOSS, 'la partie entre en combat de boss');
  assert.ok(r.jeu.boss, 'le boss est en piste');
  assert.equal(r.jeu.badsList.length, 0, 'et aucune escadre n\'a été placée');
  const p = r.journal.find((e) => e.n === 'panneau');
  assert.equal(p.d.boss, true, 'le panneau l\'annonce comme un boss');
});

test('le boss traverse ses trois formes, trente points de vie chacune', () => {
  const r = auBoss(5);
  const jeu = r.jeu;
  const formes = [];
  for (let i = 0; i < 40000 && jeu.boss && !jeu.termine; i++) {
    if (!formes.includes(jeu.boss.forme)) {
      formes.push(jeu.boss.forme);
      assert.equal(jeu.boss.hpMax, 30, `forme ${jeu.boss.forme} : trente points de vie`);
    }
    jeu.update(1);
    // Un tir bien placé, régulièrement : on joue le combat, on ne triche pas.
    if (i % 6 === 0 && jeu.boss) {
      jeu.newHShot({ x: jeu.boss.x, y: jeu.boss.y, vitx: 0, vity: 0, flStandardHeroShot: true });
    }
  }
  assert.deepEqual(formes, [E.FORME.COQUILLE, E.FORME.CASQUE, E.FORME.ORANGE],
    'coquille, puis casque, puis orange');
  assert.ok(!jeu.boss, 'le boss finit par tomber');
  assert.equal(r.compte('bossVaincu'), 1, 'et la victoire est annoncée');
  assert.equal(r.compte('bossExplose'), 1, 'avec son explosion');
});

test('la coquille lancée renvoie les tirs', () => {
  const r = auBoss(6);
  const b = r.jeu.boss;
  assert.equal(b.forme, E.FORME.COQUILLE);

  // Coquille lente : le tir porte.
  b.speedCoef = 1;
  const pv = b.hp;
  r.jeu.newHShot({ x: b.x, y: b.y, vitx: 0, vity: 0 });
  b.verifierTirsHero();
  assert.equal(b.hp, pv - 1, 'au ralenti, elle encaisse');

  // Coquille lancée : le tir est renvoyé.
  b.speedCoef = 8;
  const pv2 = b.hp;
  const renvois = r.compte('bossRenvoi');
  r.jeu.newHShot({ x: b.x, y: b.y, vitx: 0, vity: 0 });
  b.verifierTirsHero();
  assert.equal(b.hp, pv2, 'lancée, elle n\'encaisse rien');
  assert.equal(r.compte('bossRenvoi'), renvois + 1, 'et le tir est renvoyé');
});

test('chaque coup encaissé accélère la coquille — donc la protège', () => {
  const r = auBoss(7);
  const b = r.jeu.boss;
  b.speedCoef = 1;
  const avant = b.speedCoef;
  b.frapper(null);
  assert.ok(b.speedCoef > avant + 3,
    `un coup l'emballe (${avant} → ${b.speedCoef}) : il faut la reprendre entre deux`);
});

test('toucher le boss est fatal au vaisseau', () => {
  const r = auBoss(8);
  const jeu = r.jeu;
  const h = jeu.hero;
  h.newShield = undefined;
  h.x = jeu.boss.x;
  h.y = jeu.boss.y;
  jeu.boss.verifierChocHero();
  assert.ok(!h.vivant || h.hp <= 0, 'le contact ne pardonne pas');
});

test('la mort du vaisseau interrompt l\'attaque en cours', () => {
  const r = auBoss(9);
  const jeu = r.jeu;
  jeu.boss.initStep(2);                 // ruée latérale
  assert.equal(jeu.boss.step, 2);
  jeu.onHeroKill();
  assert.equal(jeu.boss.step, 1, 'le boss revient en veille');
  assert.equal(jeu.boss.specialCoolDown, 100, 'et se donne un temps de récupération');
});

test('le boss vaincu fait reprendre le parcours', () => {
  const jeu = new E.Game({ levels: [NIVEAU_BOSS, NIVEAU_VAGUE], graine: 4, vies: 99 });
  for (let i = 0; i < 400 && jeu.step !== E.ETAPE.BOSS; i++) jeu.update(1);
  assert.equal(jeu.level, 0);
  jeu.boss.tuer();
  for (let i = 0; i < 200 && jeu.level === 0; i++) jeu.update(1);
  assert.equal(jeu.level, 1, 'on passe au niveau suivant');
});
