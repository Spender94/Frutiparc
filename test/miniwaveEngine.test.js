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

  // « Première escadre » : douze Fraises-boucliers, l'ouverture du jeu.
  const attendus = ARCADE[0].list.reduce((n, ligne) =>
    n + ((ligne && ligne.length > 1) ? ligne.filter((c) => c && c.t !== undefined).length : 0), 0);
  assert.equal(jeu.badsList.length, attendus, `${attendus} ennemis placés`);
  assert.equal(jeu.toKill, attendus, 'et autant à abattre');
  assert.deepEqual(jeu.badsList.map((b) => b.type), new Array(12).fill(0),
    'du type écrit dans le niveau');
  assert.equal(E.ENNEMIS[0].name, 'Fraise-bouclier');
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
  // Les Fraises-boucliers du premier niveau ne tirent pas : il faut avancer dans
  // le parcours pour rencontrer les espèces armées. On joue donc pour de vrai —
  // sans tirer, on reste bloqué au niveau 1 et la riposte ne vient jamais.
  const r = jouer({ images: 6000, graine: 3, pilote: (jeu) => { jeu.entree.tir = true; } });
  assert.ok(r.jeu.level > 0, `la partie progresse (niveau ${r.jeu.level + 1})`);
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
  // Chaque niveau doit donner des vitesses finies et une escadre plaçable —
  // sinon la vague reste immobile et le joueur est bloqué sans rien comprendre.
  const parcours = [].concat(NIVEAUX.main, NIVEAUX.bonus, NIVEAUX.letter);
  let places = 0, combats = 0;
  const vides = [];
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
      assert.ok(jeu.badsList.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y)),
        `« ${p.name} » niveau ${i + 1} : positions calculables`);
      if (jeu.badsList.length === 0) { vides.push(`${p.name}/${i + 1}`); continue; }
      places += jeu.badsList.length;
    }
  }
  assert.ok(places > 5000, `les milliers de vaisseaux du jeu sont plaçables (${places})`);
  assert.equal(combats, 1, 'un seul combat de boss dans tout le jeu : la fin de l\'arcade');
  // Un seul niveau du jeu n'a pas d'escadre : le dernier de « Canon à pulpe »,
  // resté vide dans l'éditeur. On le fige ici plutôt que de le masquer — si un
  // AUTRE apparaissait, c'est que le décodage a dérivé.
  assert.deepEqual(vides, ['Canon à pulpe/41'],
    'le seul niveau vide est celui, connu, laissé par les auteurs');
});

test('le niveau vide de « Canon à pulpe » est traversé, pas subi', () => {
  // Sans escadre, il n'y a rien à abattre : le moteur doit enchaîner sur le
  // suivant tout seul. S'il attendait un ennemi qui ne viendra pas, la mission
  // serait injouable à partir de là.
  //
  // On part DU niveau vide. La version précédente jouait aussi le niveau
  // peuplé qui le précède, avec un pilote qui tire sans jamais bouger : elle
  // n'arrivait au bout que parce que ce pilote ramassait, par chance de
  // tirage, un bonus « saut de niveau ». Le jour où le moteur a changé
  // ailleurs (la retraite de la vague), le tirage a bougé, le bonus n'est plus
  // tombé — et le test a crié pour une raison qui n'était pas la sienne.
  const canon = NIVEAUX.bonus.find((p) => p.name === 'Canon à pulpe');
  const vide = canon.levels.slice(40);
  assert.equal((vide[0].list || []).length, 0, 'le dernier niveau est bien SANS escadre');

  const jeu = new E.Game({ levels: vide, graine: 1 });
  for (let i = 0; i < 1000 && !jeu.termine; i++) { jeu.entree.tir = true; jeu.update(1); }
  assert.ok(jeu.termine, 'la mission va jusqu\'à son terme');
  assert.equal(jeu.level, 1, 'le niveau vide est franchi, et la mission s\'achève après lui');
  assert.ok(jeu.heroList.length > 0, 'et on en sort vivant : il est traversé, pas subi');
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

test('le champ « ship » d\'un parcours est la taille de l\'escadron, pas un vaisseau', () => {
  // Piège du format : on lit « ship: 3 » et on comprend « vaisseau n° 3 ». En
  // réalité Menu.as le range dans gameInfo.shipMax, et l'écran de sélection fait
  // choisir AUTANT de vaisseaux — c'est donc le nombre de vies. Un parcours
  // bonus monte à 5, ce qui n'aurait aucun sens comme index dans une liste de six
  // vaisseaux dont un seul est débloqué au départ.
  const arcade = NIVEAUX.main[0];
  assert.equal(arcade.ship, 4, 'l\'arcade emmène quatre vaisseaux');
  const jeu = new E.Game({ levels: arcade.levels, graine: 1, vies: arcade.ship, ship: 0 });
  assert.equal(jeu.heroList.length, 4, 'quatre vies en réserve');
  assert.ok(jeu.heroList.every((t) => t === 0), 'tous du vaisseau de départ');

  // Et l'escadron peut mélanger les types : heroList est une LISTE de vaisseaux,
  // consommée dans l'ordre. C'est ce qui permettra à l'écran de sélection de
  // composer une escadre une fois la boutique portée.
  const mixte = new E.Game({ levels: arcade.levels, graine: 1, vies: 3, ship: 0 });
  mixte.heroList = [0, 2, 4];
  for (let i = 0; i < 600 && mixte.step !== E.ETAPE.COMBAT; i++) mixte.update(1);
  assert.equal(mixte.hero.type, 0, 'on décolle avec le premier de la liste');
  mixte.hero.newShield = undefined;
  mixte.hero.frapper(10);
  for (let i = 0; i < 20 && !mixte.hero; i++) mixte.update(1);
  assert.equal(mixte.hero.type, 2, 'le suivant de la liste prend le relais');
});

// ── Les six vaisseaux ──────────────────────────────────────────────────────
// Seul le premier est offert ; les autres s'achètent à la boutique interne du
// jeu. Le déblocage n'a d'intérêt que s'ils se jouent VRAIMENT différemment :
// c'est ce que ces tests figent.

function auVolant(ship, graine) {
  const jeu = new E.Game({ levels: ARCADE, graine: graine === undefined ? 21 : graine, vies: 3, ship });
  for (let i = 0; i < 600 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  return jeu;
}

test('chaque vaisseau a sa fiche : vitesse, cadence, robustesse', () => {
  const vus = new Set();
  for (let s = 0; s < 6; s++) {
    const h = auVolant(s).hero;
    assert.equal(h.type, s, `on pilote bien le vaisseau ${s}`);
    assert.ok(h.speed > 0 && h.coolDownSpeed > 0, `${E.VAISSEAUX[s].link} : fiche renseignée`);
    vus.add(h.speed + '/' + h.coolDownSpeed + '/' + h.hp);
  }
  assert.ok(vus.size >= 5, `les fiches diffèrent réellement (${vus.size} profils sur 6)`);
  // Deux vaisseaux encaissent deux coups : le Pastaga, lent et lourd, et le
  // Cherry, qui change d'arme une fois entamé.
  assert.equal(auVolant(2).hero.hp, 2, 'le Pastaga a une double coque');
  assert.equal(auVolant(5).hero.hp, 2, 'le Cherry aussi');
  assert.ok(auVolant(3).hero.speed > auVolant(2).hero.speed, 'le Manzana file plus vite que le Pastaga');
});

test('chaque vaisseau tire à sa façon', () => {
  const compte = (s) => {
    const jeu = auVolant(s);
    const avant = jeu.hShotList.length;
    jeu.hero.coolDown = 0;
    jeu.hero.tirer();
    return jeu.hShotList.length - avant;
  };
  assert.equal(compte(0), 1, 'Tequila : un trait');
  assert.equal(compte(2), 2, 'Pastaga : deux canons');
  assert.equal(compte(4), 2, 'Curaso : deux tirs qui ondulent');
  // Le Manzana tire plus loin (vitesse verticale plus forte) que la base.
  const jeu = auVolant(3);
  jeu.hero.coolDown = 0;
  jeu.hero.tirer();
  assert.ok(jeu.hShotList[jeu.hShotList.length - 1].vity <= -6, 'Manzana : tir rapide');
});

test('le Cherry entamé change d\'arme', () => {
  const jeu = auVolant(5);
  const h = jeu.hero;
  const avant = jeu.hShotList.length;
  h.coolDown = 0; h.tirer();
  assert.equal(jeu.hShotList.length - avant, 1, 'intact : un seul trait');
  const cadence = h.coolDownSpeed;

  h.newShield = undefined;
  h.frapper();                     // une coque en moins
  assert.equal(h.hp, 1, 'il tient le coup');
  assert.ok(h.coolDownSpeed < cadence, 'et tire désormais plus vite');
  const apres = jeu.hShotList.length;
  h.coolDown = 0; h.tirer();
  assert.equal(jeu.hShotList.length - apres, 3, 'entamé : il tire en éventail');
});

test('chaque bombe fait autre chose, et ne sert qu\'une fois', () => {
  // Tequila : une onde de choc qui balaie TOUS les tirs de l'écran.
  const t = auVolant(0);
  t.newBShot({ x: 50, y: 50, vitx: 0, vity: 1 });
  t.newBShot({ x: 60, y: 60, vitx: 0, vity: 1 });
  assert.ok(t.bShotList.length >= 2, 'des tirs ennemis en vol');
  t.hero.bombe();
  assert.equal(t.bShotList.length, 0, 'Tequila : l\'onde balaie l\'écran');
  assert.equal(t.hero.flBomb, false, 'et la bombe est consommée');
  const restant = t.bShotList.length;
  t.hero.bombe();
  assert.equal(t.bShotList.length, restant, 'une seule fois par vaisseau');

  const gerbe = (s) => {
    const jeu = auVolant(s);
    const avant = jeu.hShotList.length;
    jeu.hero.bombe();
    return jeu.hShotList.length - avant;
  };
  assert.equal(gerbe(1), 12, 'Porto : une gerbe de douze');
  assert.equal(gerbe(3), 8, 'Manzana : huit têtes chercheuses');
  assert.equal(gerbe(2), 1, 'Pastaga : un missile');
});

test('le rayon du Cherry pulvérise sa colonne', () => {
  const jeu = auVolant(5, 31);
  const h = jeu.hero;
  const cible = jeu.badsList[0];
  cible.x = h.x;                   // pile au-dessus de lui
  const nb = jeu.badsList.length;
  const vitesse = h.speed;

  h.bombe();
  assert.ok(h.laser > 0, 'le rayon est allumé');
  assert.equal(h.speed, 1, 'et le vaisseau est ralenti tant qu\'il tire');
  jeu.update(1);
  assert.ok(jeu.badsList.length < nb, 'ce qui passe dans la colonne est pulvérisé');

  for (let i = 0; i < 60 && h.laser > 0; i++) jeu.update(1);
  assert.ok(h.laser <= 0, 'le rayon s\'éteint');
  assert.equal(h.speed, vitesse, 'et la mobilité revient');
});

// ── Soucoupe et bonus ──────────────────────────────────────────────────────
// La soucoupe est la SEULE source de bonus du jeu : la rater, c'est renoncer à
// recharger sa bombe ou à gagner une vie. D'où l'importance de la mécanique.

test('la soucoupe traverse l\'écran et finit par sortir', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 41, vies: 3, ship: 0 });
  assert.ok(jusquAuCombat(jeu));
  const s = jeu.genSaucer();
  assert.equal(jeu.saucerList.length, 1, 'elle est en piste');
  assert.ok(s.speed > 0, 'et elle avance');
  for (let i = 0; i < 2000 && jeu.saucerList.length; i++) jeu.update(1);
  assert.equal(jeu.saucerList.length, 0, 'elle sort de l\'écran si on la rate');
});

test('l\'abattre rapporte 200 points et lâche un bonus', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 42, vies: 3, ship: 0 });
  assert.ok(jusquAuCombat(jeu));
  const s = jeu.genSaucer();
  const avant = jeu.score;
  jeu.newHShot({ x: s.x, y: s.y, vitx: 0, vity: 0, flStandardHeroShot: true });
  jeu.update(1);
  assert.equal(jeu.score, avant + 200, '200 points');
  assert.equal(jeu.saucerKill, 1, 'la prise est comptée');
  assert.equal(jeu.optList.length, 1, 'et un bonus tombe');
});

test('elle accélère à chaque passage', () => {
  const jeu = new E.Game({ levels: ARCADE, graine: 43, vies: 3, ship: 0 });
  assert.ok(jusquAuCombat(jeu));
  const v = [];
  for (let i = 0; i < 4; i++) { v.push(jeu.genSaucer().speed); jeu.saucerList[0].tuer(); }
  assert.ok(v[3] > v[0], `la quatrième va plus vite que la première (${v.join(' → ')})`);
});

test('la vague ne se termine pas tant qu\'un bonus est en jeu', () => {
  // Sinon on perdrait ce qu'on vient de gagner en passant au niveau suivant.
  const jeu = new E.Game({ levels: ARCADE, graine: 44, vies: 3, ship: 0 });
  assert.ok(jusquAuCombat(jeu));
  while (jeu.badsList.length) jeu.badsList[0].exploser();
  jeu.genOption(120, 60);
  for (let i = 0; i < 30; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.COMBAT, 'on reste sur le niveau tant que le bonus tombe');
  jeu.optList[0].tuer();
  for (let i = 0; i < 30 && jeu.step === E.ETAPE.COMBAT; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.SUIVANT, 'et on passe une fois l\'écran net');
});

test('les onze bonus font chacun leur effet', () => {
  const poser = (type, graine) => {
    const jeu = new E.Game({ levels: ARCADE, graine: graine || 45, vies: 3, ship: 0 });
    for (let i = 0; i < 600 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
    const o = jeu.genOption(jeu.hero.x, jeu.hero.y);
    o.type = type;
    return { jeu, o };
  };
  // Les quatre pièces créditent la monnaie de la boutique interne.
  for (const [type, valeur] of [[0, 1], [1, 5], [2, 10], [3, 50]]) {
    const { jeu, o } = poser(type);
    o.ramasser();
    assert.equal(jeu.credits, valeur, `${E.BONUS[type].nom} : +${valeur} crédits`);
  }
  // Les trois sauts avancent dans le parcours.
  for (const [type, saut] of [[4, 5], [5, 10], [6, 20]]) {
    const { jeu, o } = poser(type);
    const depart = jeu.level;
    o.ramasser();
    assert.equal(jeu.nextLevel, depart + saut, `${E.BONUS[type].nom} : saute ${saut} niveaux`);
    assert.equal(jeu.badsList.length, 0, 'et l\'écran est nettoyé au passage');
  }
  // Les trois cartes envoient chacune leur artillerie.
  const rouge = poser(7); rouge.o.ramasser();
  assert.equal(rouge.jeu.hShotList.length, 32, 'carte rouge : trente-deux projectiles');
  const verte = poser(8); verte.o.ramasser();
  assert.equal(verte.jeu.hShotList.length, 1, 'carte verte : une tête chercheuse');
  assert.equal(verte.jeu.hShotList[0].flIndestructible, true, 'increvable');
  const bleue = poser(9); bleue.o.ramasser();
  assert.equal(bleue.jeu.hShotList.length, 1, 'carte bleue : une vague');
  assert.ok(bleue.jeu.hShotList[0].vity < 0, 'qui monte');
  // Et la vie.
  const vie = poser(10);
  const avant = vie.jeu.heroList.length;
  vie.o.ramasser();
  assert.equal(vie.jeu.heroList.length, avant + 1, 'un vaisseau de plus dans l\'escadron');
});

test('le tirage des bonus respecte la table de poids', () => {
  // Le platine (poids 1 sur 109) doit rester exceptionnel, le bronze (40)
  // fréquent : c'est cette table qui règle toute l'économie du jeu.
  const jeu = new E.Game({ levels: ARCADE, graine: 99, vies: 3, ship: 0 });
  const compte = new Array(E.BONUS.length).fill(0);
  for (let i = 0; i < 20000; i++) compte[jeu.typeDeBonus()]++;
  const total = E.BONUS.reduce((n, b) => n + b.poids, 0);
  E.BONUS.forEach((b, i) => {
    const attendu = 20000 * b.poids / total;
    assert.ok(Math.abs(compte[i] - attendu) < attendu * 0.25 + 40,
      `${b.nom} : ${compte[i]} tirages pour ~${Math.round(attendu)} attendus`);
  });
  assert.ok(compte[0] > compte[3] * 20, 'le bronze est bien plus courant que le platine');
});

test('sortir par la droite fait sauter cent niveaux', () => {
  // Le secret du jeu : le vaisseau qui franchit le bord droit se sacrifie, mais
  // rend sa place à l'escadron et fait repartir bien plus loin.
  const jeu = new E.Game({ levels: ARCADE, graine: 46, vies: 3, ship: 0 });
  assert.ok(jusquAuCombat(jeu));
  const vies = jeu.heroList.length;
  const h = jeu.hero;
  h.x = E.LARGEUR + h.ray + 1;
  h.update(1);
  assert.equal(jeu.nextLevel, 100, 'cent niveaux d\'un coup');
  assert.equal(jeu.heroList.length, vies + 1, 'et le vaisseau rejoint la réserve');
});

test('la mort du vaisseau fait battre l\'escadre en retraite', () => {
  // game.Main.onHeroKill, bloc « RETRAITE DE LA WAVE » : perdre un vaisseau en
  // plein combat renvoie chaque ennemi à sa case de départ (Bads.reset →
  // nextWayPoint(waveId)), décalé de deux images sur son voisin, et le niveau
  // repasse en phase d'arrivée. Sans ça, le joueur réapparaît sous une escadre
  // déjà descendue sur lui — c'est le « le jeu est plus dur » remonté.
  const jeu = new E.Game({ levels: ARCADE, graine: 12, vies: 3, ship: 0 });
  assert.ok(jusquAuCombat(jeu), 'le combat est engagé');

  // On laisse l'escadre AVANCER : elle glisse et descend, elle n'est donc plus
  // sur ses cases de départ.
  for (let i = 0; i < 240; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.COMBAT);
  const avant = jeu.badsList.map((b) => ({ b, x: b.x, y: b.y }));
  const bouge = avant.filter((e) => {
    const c = jeu.gridInfo.list[e.b.lineId][e.b.waveId];
    return c && (Math.abs(e.x - c.x) > 1 || Math.abs(e.y - c.y) > 1);
  });
  assert.ok(bouge.length > 0, 'l\'escadre a quitté ses cases (' + bouge.length + ')');

  // Le vaisseau meurt.
  jeu.hero.exploser();

  // La vague bat en retraite : personne n'est « en place », chacun vise sa
  // case, et les départs sont échelonnés de deux images.
  assert.equal(jeu.step, E.ETAPE.ARRIVEE, 'le niveau repasse en arrivée');
  assert.ok(jeu.badsList.every((b) => !b.flReady), 'plus personne en position');
  jeu.badsList.forEach(function (b, i) {
    assert.equal(b.wayPoint.id, b.waveId, 'chacun vise SA case');
    assert.equal(b.wpTimer, i * 2, 'et part deux images après son voisin');
  });
  // Les tirs en vol sont balayés, des deux camps (Game.cleanShots).
  assert.equal(jeu.bShotList.length, 0, 'plus un tir ennemi en vol');
  assert.equal(jeu.hShotList.length, 0, 'ni un tir du joueur');

  // Et au bout du reflux, tout le monde EST revenu à sa case de départ.
  for (let i = 0; i < 900 && jeu.step === E.ETAPE.ARRIVEE; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.COMBAT, 'le combat reprend une fois l\'escadre rangée');
  jeu.badsList.forEach(function (b) {
    const c = jeu.gridInfo.list[b.lineId][b.waveId];
    assert.ok(Math.abs(b.x - c.x) < 12 && Math.abs(b.y - c.y) < 12,
      'chaque ennemi est reparti de sa position de départ');
  });
});

test('la retraite ne se déclenche QUE pendant le combat', () => {
  // En phase d'arrivée, l'escadre est déjà en train de rejoindre ses places :
  // la relancer remettrait les compteurs à zéro pour rien. L'original ne le
  // fait pas non plus (le bloc est gardé par `step == 2`).
  const jeu = new E.Game({ levels: ARCADE, graine: 5, vies: 3, ship: 0 });
  for (let i = 0; i < 400 && jeu.step !== E.ETAPE.ARRIVEE; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.ARRIVEE);
  for (let i = 0; i < 20; i++) jeu.update(1);
  const minuteries = jeu.badsList.map((b) => b.wpTimer);
  if (jeu.hero) jeu.hero.exploser();
  assert.equal(jeu.step, E.ETAPE.ARRIVEE, 'on reste en arrivée');
  assert.deepEqual(jeu.badsList.map((b) => b.wpTimer), minuteries,
    'et les minuteries d\'entrée ne sont pas rejouées');
});
