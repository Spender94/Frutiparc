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
  let places = 0;
  for (const p of parcours) {
    for (let i = 0; i < p.levels.length; i++) {
      const jeu = new E.Game({ levels: p.levels.slice(i, i + 1), graine: 1 });
      for (let k = 0; k < 200 && jeu.step === E.ETAPE.PANNEAU; k++) jeu.update(1);
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
