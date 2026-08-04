// Les trois autres modes de Miniwave 2 : Mission, Endurance, Letter Invader.
//
// Ils partagent le moteur de l'arcade mais en changent les règles — la table
// des bonus, la façon dont les vagues arrivent, et jusqu'à la manière de tirer.
// Ce qui est vérifié ici, ce sont ces différences : ce qui est commun est déjà
// couvert par miniwaveEngine.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const M = require(path.join(ROOT, 'public/miniwave/modes.js'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));

// Fait tourner une partie en tirant sans arrêt, avec un va-et-vient qui évite
// de mourir aussitôt. On s'arrête à la fin ou au bout de `images`.
function jouer(jeu, images, pilote) {
  for (let i = 0; i < images && !jeu.termine; i++) {
    if (pilote) pilote(jeu, i);
    else {
      jeu.entree.tir = true;
      jeu.entree.gauche = (i % 140) < 70;
      jeu.entree.droite = !jeu.entree.gauche;
    }
    jeu.update(1);
  }
  return jeu;
}

// ── MISSION ────────────────────────────────────────────────────────────────

test('les missions n\'offrent aucun saut de niveau', () => {
  // C'est LA différence de leur table de bonus : sauter des niveaux d'un
  // parcours de quarante fausserait le pourcentage d'achèvement, donc la prime
  // et le picto. Les trois entrées « warp » sont donc à zéro.
  assert.deepEqual(M.BONUS_MISSION.slice(4, 7), [0, 0, 0], 'les trois sauts sont neutralisés');
  assert.deepEqual(M.BONUS_MISSION.length, E.BONUS.length, 'même nombre de bonus que l\'arcade');
  // Et la preuve par le tirage : sur des milliers de bonus, jamais de saut.
  const m = new M.Mission({ levels: NIVEAUX.bonus[0].levels, graine: 4, missionNum: 0 });
  const vus = new Set();
  for (let i = 0; i < 20000; i++) vus.add(m.typeDeBonus());
  assert.ok(![4, 5, 6].some((i) => vus.has(i)), `aucun saut tiré (vus : ${[...vus].sort().join(',')})`);
  assert.ok(vus.has(0) && vus.has(10), 'les pièces et la vie sortent bien');
});

test('la prime d\'une mission ne se touche qu\'une fois, et seulement à 100 %', () => {
  const info = NIVEAUX.bonus[2];                    // « Canon à pulpe », prime 500
  const m = new M.Mission({ levels: info.levels, graine: 1, missionNum: 2, prime: info.prime });
  assert.equal(m.prime, 500);
  // Mission commencée : pas de prime.
  assert.equal(m.getCons(), 0);
  assert.equal(m.primeGagnee(0), 0, 'rien tant que ce n\'est pas bouclé');
  // Mission bouclée, première fois.
  m.level = info.levels.length;
  assert.equal(m.getCons(), 100);
  assert.equal(m.primeGagnee(0), 500, 'la prime tombe');
  // Rebouclée : la fiche porte déjà 100, plus rien.
  assert.equal(m.primeGagnee(100), 0, 'et pas deux fois');
  // Un parcours à moitié fait ne paie pas non plus.
  m.level = Math.floor(info.levels.length / 2);
  assert.ok(m.getCons() > 40 && m.getCons() < 60, `mi-parcours (${m.getCons()} %)`);
  assert.equal(m.primeGagnee(0), 0);
});

test('les cinq missions se jouent, et rendent leur pourcentage', () => {
  NIVEAUX.bonus.forEach((info, i) => {
    const m = new M.Mission({
      levels: info.levels, graine: 6 + i, vies: info.ship,
      missionNum: i, prime: info.prime, nom: info.name,
    });
    assert.equal(m.heroList.length, info.ship, `« ${info.name} » : escadron de ${info.ship}`);
    // « Fruit d'artifice » part avec cinq vaisseaux : il en faut de quoi tenir.
    jouer(m, 20000);
    assert.ok(m.termine, `« ${info.name} » : la partie se termine`);
    assert.ok(Number.isInteger(m.cons) && m.cons >= 0 && m.cons <= 100,
      `« ${info.name} » : pourcentage rendu (${m.cons} %)`);
    assert.equal(m.missionNum, i, 'la mission sait laquelle elle est');
  });
});

// ── ENDURANCE (Survival) ───────────────────────────────────────────────────

test('l\'endurance n\'a pas de parcours : elle pose ses rangées elle-même', () => {
  const s = new M.Survival({ graine: 5 });
  assert.equal(s.step, E.ETAPE.COMBAT, 'ni panneau ni vol d\'entrée : on joue tout de suite');
  assert.equal(s.badsList.length, 12, 'trois rangées de quatre');
  assert.deepEqual([...new Set(s.badsList.map((b) => b.y))].sort((a, b) => a - b), [24, 48, 72]);
  assert.ok(s.badsList.every((b) => b.flReady), 'la formation est déjà en place');
  // Survival.init : une seule vie. C'est ce qui fait le mode.
  assert.equal(s.heroList.length + (s.hero ? 1 : 0), 1, 'un seul vaisseau');
  // Les rangées sont centrées sur l'écran.
  const xs = [...new Set(s.badsList.map((b) => b.x))].sort((a, b) => a - b);
  assert.equal(xs.length, 4);
  assert.equal(xs[0] + xs[3] + 24, E.LARGEUR + 24 - 24, 'formation centrée');
});

test('une rangée neuve tombe dès que la précédente est descendue', () => {
  const s = new M.Survival({ graine: 5, vies: 50 });
  const avant = s.badsList.length;
  // On fait descendre la formation à la main jusqu'au seuil.
  s.badsList.forEach((b) => { b.ty = M.SURVIVAL_SEUIL_SPAWN + 1; });
  s.verifierDerniere();
  assert.equal(s.badsList.length, avant + s.waveWidth, 'une rangée de plus');
  const neufs = s.badsList.slice(avant);
  assert.ok(neufs.every((b) => b.ty === M.SURVIVAL_ESPACE), 'elle vise le haut de l\'aire');
  assert.ok(neufs.every((b) => b.y < 0), 'et arrive de hors champ');
  // Tant que rien n'est descendu, on n'en ajoute pas d'autre.
  const compte = s.badsList.length;
  s.verifierDerniere();
  assert.equal(s.badsList.length, compte, 'pas de rangée en trop');
});

test('l\'endurance monte vraiment en difficulté', () => {
  // Le point de la correction assumée : dans l'original, levelTimer n'est
  // jamais initialisé (« this.levelTimer = this.levelTimer »), devient NaN à la
  // première soustraction, et levelUp() n'est plus jamais atteint. Le mode reste
  // à quatre colonnes, vitesse 0,6 et trois espèces — pour toujours.
  const s = new M.Survival({ graine: 5, vies: 400 });
  assert.equal(typeof s.levelTimer, 'number', 'le compte à rebours part d\'une vraie valeur');
  assert.ok(Number.isFinite(s.levelTimer), 'et pas de NaN');

  const paliers = [];
  s.onEvent = (n, d) => { if (n === 'palier') paliers.push(d); };
  jouer(s, 30000);
  assert.ok(paliers.length >= 10, `la difficulté monte par paliers (${paliers.length})`);

  // Les formules de Survival.levelUp, vérifiées palier par palier.
  paliers.forEach((p) => {
    assert.equal(p.largeur, Math.min(3 + Math.floor(Math.sqrt(p.level)), 8),
      `palier ${p.level} : largeur en racine`);
    assert.ok(Math.abs(p.vitesse - (0.6 + p.level * 0.03)) < 1e-9,
      `palier ${p.level} : vitesse`);
  });
  assert.ok(paliers[paliers.length - 1].largeur > 4, 'la formation s\'élargit');
  assert.ok(paliers[paliers.length - 1].vitesse > 0.6, 'et accélère');
  // Chaque palier dure 10 % de plus que le précédent : la montée ralentit.
  assert.ok(s.paliersuivant > M.SURVIVAL_PALIER * 1.1, 'les paliers s\'allongent');
  // Et le bestiaire s'ouvre : au palier 0 on n'a que trois espèces.
  assert.ok(Object.keys(s.badsKill).length > 5,
    `des espèces variées apparaissent (${Object.keys(s.badsKill).length})`);
});

test('l\'endurance ne prétend pas à un pourcentage de parcours', () => {
  // Sans parcours, level/waveInfo.length ne veut rien dire : le mode ne
  // contribue pas à la consécration, il n'a qu'un meilleur score.
  const s = new M.Survival({ graine: 1 });
  s.level = 12;
  assert.equal(s.getCons(), 0);
});

// ── LETTER INVADER ─────────────────────────────────────────────────────────

const LETTRES = NIVEAUX.letter[0].levels;
const jusquAuCombat = (jeu) => {
  for (let i = 0; i < 400 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  return jeu;
};

test('chaque monstre porte un caractère tapable', () => {
  const l = jusquAuCombat(new M.Letter({ levels: LETTRES, graine: 3 }));
  assert.ok(l.badsList.length > 0, 'des monstres sont en piste');
  for (const b of l.badsList) {
    assert.equal(b.type, 50, 'ce sont des Letter-monsters');
    assert.equal(typeof b.affiche, 'string');
    assert.equal(b.affiche.length, 1, `« ${b.affiche} » est un caractère`);
    assert.ok(Array.isArray(b.touches) && b.touches.length >= 1, 'et au moins une touche l\'abat');
    assert.equal(b.touches[0], b.affiche.charCodeAt(0), 'la touche correspond au caractère affiché');
  }
});

test('les deux codes pièges ne sortent jamais', () => {
  // 15 donnerait « P » — la touche de pause, écartée à la frappe : le monstre
  // serait indestructible. 26 donnerait « 0 », qu'on ne distingue pas du « O ».
  const l = new M.Letter({ levels: LETTRES, graine: 9 });
  const codes = new Set();
  for (let i = 0; i < 4000; i++) codes.add(l.newBads(50, { x: 0, y: 0 }).code);
  assert.ok(!codes.has(15), 'pas de « P »');
  assert.ok(!codes.has(26), 'pas de « 0 »');
  assert.ok(codes.size >= 20, `le reste de l'alphabet sort (${codes.size} codes)`);
});

test('les chiffres n\'apparaissent qu\'après le niveau 10, et se tapent aux deux endroits', () => {
  const l = new M.Letter({ levels: LETTRES, graine: 2 });
  const avant = new Set();
  for (let i = 0; i < 2000; i++) avant.add(l.newBads(50, { x: 0, y: 0 }).code);
  assert.ok([...avant].every((c) => c < 26), 'que des lettres au début du parcours');

  l.level = 11;
  const apres = new Set();
  for (let i = 0; i < 2000; i++) apres.add(l.newBads(50, { x: 0, y: 0 }).code);
  assert.ok([...apres].some((c) => c >= 26), 'les chiffres entrent en jeu');

  // Un chiffre accepte la rangée du haut ET le pavé numérique.
  const t = M.traduireCode(27);
  assert.equal(String.fromCharCode(t.affiche), '1');
  assert.deepEqual(t.touches, [49, 97], 'rangée du haut (49) et pavé (97)');
  assert.deepEqual(M.traduireCode(0), { affiche: 65, touches: [65] }, '« A »');
});

test('la bonne touche détruit, la mauvaise coûte un bouclier', () => {
  const l = jusquAuCombat(new M.Letter({ levels: LETTRES, graine: 3 }));
  assert.equal(l.boucliers, M.LETTER_BOUCLIERS, 'quatre boucliers au départ');
  const cible = l.badsList[0];
  const avant = l.badsList.length;

  const r = l.frapper(cible.touches[0]);
  assert.equal(r.touche, true, 'la touche porte');
  l.rangerMorts();
  assert.equal(l.badsList.length, avant - 1, 'le monstre a explosé');
  assert.equal(l.boucliers, M.LETTER_BOUCLIERS, 'sans rien coûter');

  // Une touche qu'aucun monstre ne porte.
  const portees = new Set(l.badsList.flatMap((b) => b.touches));
  let fausse = 65;
  while (portees.has(fausse)) fausse++;
  l.frapper(fausse);
  assert.equal(l.boucliers, M.LETTER_BOUCLIERS - 1, 'la faute coûte un bouclier');
});

test('quatre fautes mettent fin à la partie', () => {
  const l = jusquAuCombat(new M.Letter({ levels: LETTRES, graine: 3 }));
  const portees = new Set(l.badsList.flatMap((b) => b.touches));
  let fausse = 65;
  while (portees.has(fausse)) fausse++;
  for (let i = 0; i < M.LETTER_BOUCLIERS; i++) {
    assert.equal(l.termine, false, `encore en jeu après ${i} faute(s)`);
    l.frapper(fausse);
  }
  assert.equal(l.termine, true, 'la quatrième faute est fatale');
});

test('les touches hors jeu sont ignorées, pause comprise', () => {
  const l = jusquAuCombat(new M.Letter({ levels: LETTRES, graine: 3 }));
  const avant = l.boucliers;
  // 80 = « P » (pause), 16 = majuscule, 32 = espace, 13 = entrée.
  for (const c of [80, 16, 32, 13, 27, 112]) {
    assert.equal(l.frapper(c), null, `la touche ${c} ne joue pas`);
  }
  assert.equal(l.boucliers, avant, 'et ne coûte rien');
  assert.equal(M.toucheJouable(80), false, '« P » est réservée à la pause');
  assert.equal(M.toucheJouable(65), true);
  assert.equal(M.toucheJouable(49), true);
  assert.equal(M.toucheJouable(97), true);
});

test('un enchaînement rapporte le carré du nombre de touches', () => {
  const l = jusquAuCombat(new M.Letter({ levels: LETTRES, graine: 3 }));
  const scoreAvant = l.score;
  // Cinq monstres abattus coup sur coup : la fenêtre d'enchaînement est de huit
  // images, on frappe sans laisser le temps de la clore.
  const cibles = l.badsList.slice(0, 5);
  assert.ok(cibles.length === 5, 'assez de monstres pour la démonstration');
  for (const b of cibles) l.frapper(b.touches[0]);
  assert.equal(l.combo.num, 5, 'cinq d\'affilée');

  let prime = null;
  l.onEvent = (n, d) => { if (n === 'comboFini') prime = d; };
  for (let i = 0; i < 12; i++) l.update(1);
  assert.ok(prime, 'l\'enchaînement se clôt tout seul');
  assert.equal(prime.num, 5);
  assert.equal(prime.points, 250, '5² × 10');
  assert.ok(l.score >= scoreAvant + 250, 'les points sont versés');
  assert.equal(l.combo, null, 'et le compteur repart à zéro');

  // Un seul monstre abattu ne fait pas d'enchaînement.
  const seul = l.badsList[0];
  if (seul) {
    l.frapper(seul.touches[0]);
    let bis = null;
    l.onEvent = (n, d) => { if (n === 'comboFini') bis = d; };
    for (let i = 0; i < 12; i++) l.update(1);
    assert.equal(bis, null, 'une touche isolée ne rapporte pas de prime');
  }
});

test('un monstre qui atteint le bas met fin à la partie', () => {
  const l = jusquAuCombat(new M.Letter({ levels: LETTRES, graine: 3 }));
  assert.equal(l.termine, false);
  // On en fait descendre un jusqu'au sol.
  const b = l.badsList[0];
  b.y = E.HAUTEUR;
  b.ty = E.HAUTEUR;
  l.update(1);
  assert.equal(l.termine, true, 'la ligne est franchie, la partie s\'arrête');
});

test('le mode lettres se passe de soucoupe et attend la fin des enchaînements', () => {
  const l = new M.Letter({ levels: LETTRES, graine: 3 });
  assert.equal(l.avecSoucoupe(), false, 'pas de soucoupe : on n\'y tire pas');
  const arcade = new E.Game({ levels: NIVEAUX.main[0].levels, graine: 1 });
  assert.equal(arcade.avecSoucoupe(), true, 'l\'arcade, si');

  jusquAuCombat(l);
  l.toKill = 0;
  l.combo = { num: 3, timer: 8 };
  assert.equal(l.peutAvancer(), false, 'un enchaînement en cours retient le niveau');
  l.combo = null;
  assert.equal(l.peutAvancer(), true);

  // Et la partie entière tient debout : on tape tout ce qui passe.
  const j = jusquAuCombat(new M.Letter({ levels: LETTRES, graine: 8 }));
  for (let i = 0; i < 8000 && !j.termine; i++) {
    const b = j.badsList[0];
    if (b && i % 3 === 0) j.frapper(b.touches[0]);
    j.update(1);
  }
  assert.ok(j.level > 0 || j.termine, `le parcours avance (niveau ${j.level + 1})`);
  assert.equal(j.saucerList.length, 0, 'aucune soucoupe n\'est jamais venue');
});

test('les modes sont chargeables dans le navigateur comme sous Node', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/modes.js'), 'utf8');
  assert.match(src, /racine\.MiniwaveModes = API/, 'exposé sur window pour la page');
  assert.match(src, /module\.exports = API/, 'et exporté pour les tests');
  // La correction assumée doit rester expliquée dans le code : c'est le seul
  // endroit où le portage s'écarte de l'original.
  assert.match(src, /SURVIVAL_MONTEE_EN_DIFFICULTE/, 'l\'écart au jeu d\'origine est documenté');
});

test('l\'endurance ne connaît pas la retraite de la vague', () => {
  // game.Survival redéfinit onHeroKill : le mode n'a pas de grille d'entrée
  // (ses rangées naissent en haut et descendent), il n'y a donc aucune case de
  // départ où renvoyer quiconque. Seuls l'arcade et les missions — game.Main —
  // font battre l'escadre en retraite. Ce test garde la frontière : c'est en
  // la franchissant qu'on faisait planter le mode.
  const s = new M.Survival({ graine: 3, vies: 3 });
  jouer(s, 400);
  assert.ok(s.badsList.length > 0, 'des ennemis sont en piste');
  const avant = s.badsList.map((b) => ({ x: b.x, y: b.y }));
  const vies = s.heroList.length;

  assert.ok(s.hero, 'le vaisseau est là');
  s.hero.exploser();                       // ne doit ni planter ni tout replacer

  assert.equal(s.step, E.ETAPE.COMBAT, 'le mode reste en combat');
  s.badsList.forEach(function (b, i) {
    assert.ok(Math.abs(b.x - avant[i].x) < 1 && Math.abs(b.y - avant[i].y) < 1,
      'chaque ennemi est resté exactement où il était');
  });
  // La réserve ne bouge qu'au moment où le vaisseau suivant décolle
  // (verifierHero le prend dans la liste) : on laisse passer l'image.
  s.update(1);
  assert.equal(s.heroList.length, vies - 1, 'seule la vie est décomptée');
  jouer(s, 200);                            // et la partie continue de tourner
  assert.ok(!s.termine || s.heroList.length === 0, 'la partie suit son cours');
});
