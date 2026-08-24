//
// Le format DUEL des tournois : poules, classement, qualification, coupe, et
// la marche d'un match « à deux victoires d'écart ».
//
const test = require('node:test');
const assert = require('node:assert');
const T = require('../tournoiDuel.js');

// Un tirage rejouable : sans lui, un test de tirage au sort ne prouve rien.
function graine(n) {
  let s = n;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
const DOUZE = ['Kasparov', 'Quento6', 'Smowk', 'Sandek', 'Oli8', 'Near',
  'MajoMagic', 'Istari', 'Moad', 'AfidaTurnover', 'Ramoutchooo', 'Crazynou'];

test('les poules : douze joueurs, quatre groupes de trois', () => {
  const p = T.tirerPoules(DOUZE, 3, graine(7));
  assert.strictEqual(p.length, 12);
  const groupes = {};
  for (const j of p) (groupes[j.poule] = groupes[j.poule] || []).push(j.username);
  assert.deepStrictEqual(Object.keys(groupes).sort(), ['A', 'B', 'C', 'D']);
  for (const g of Object.keys(groupes)) assert.strictEqual(groupes[g].length, 3, 'poule ' + g);
  // Tout le monde est là, une seule fois, en minuscules (la clé du serveur).
  const tous = p.map((j) => j.username).sort();
  assert.deepStrictEqual(tous, DOUZE.map((u) => u.toLowerCase()).sort());
  // Le même tirage rejoué donne le même résultat ; un autre, un autre.
  assert.deepStrictEqual(T.tirerPoules(DOUZE, 3, graine(7)), p);
  assert.notDeepStrictEqual(T.tirerPoules(DOUZE, 3, graine(8)), p);
});

test('un compte qui ne tombe pas juste répartit à la ronde, sans poule orpheline', () => {
  // 7 joueurs par 3 → 3 poules. En tranches, la dernière n'aurait qu'un seul
  // joueur (3+3+1) : personne à rencontrer. À la ronde, 3+2+2.
  const p = T.tirerPoules(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3, graine(3));
  const tailles = {};
  for (const j of p) tailles[j.poule] = (tailles[j.poule] || 0) + 1;
  const l = Object.values(tailles).sort();
  assert.deepStrictEqual(l, [2, 2, 3]);
  assert.ok(l.every((n) => n >= 2), 'aucune poule à un seul joueur');
});

test('chacun rencontre chacun : trois affiches par poule de trois', () => {
  const p = [
    { username: 'a', poule: 'A' }, { username: 'b', poule: 'A' }, { username: 'c', poule: 'A' },
    { username: 'd', poule: 'B' }, { username: 'e', poule: 'B' }, { username: 'f', poule: 'B' },
  ];
  const m = T.matchsDeGroupes(p, T.TOUR_POULES);
  assert.strictEqual(m.length, 6, 'deux poules de trois = six matchs');
  assert.strictEqual(m.filter((x) => x.poule === 'A').length, 3);
  // Aucune affiche en double, aucun face-à-soi-même.
  const vues = new Set();
  for (const x of m) {
    assert.notStrictEqual(x.player1, x.player2);
    const k = [x.player1, x.player2].sort().join('|');
    assert.ok(!vues.has(k), 'affiche unique : ' + k);
    vues.add(k);
  }
});

// Petit atelier : jouer un match jusqu'à l'écart.
function jouer(matchs, tours, a, b, suite, ecart) {
  let dernier = null;
  for (const gagnant of suite) {
    const r = T.manche(matchs, tours, a, b, gagnant, ecart);
    if (!r) return null;
    r.match.score1 = r.score1; r.match.score2 = r.score2;
    if (r.fini) { r.match.winner = r.winner; r.match.status = 'done'; }
    dernier = r;
    if (r.fini) break;
  }
  return dernier;
}

test('un match se plie à DEUX victoires d\'écart, pas au nombre de manches', () => {
  const m = [{ round: 0, slot: 0, poule: 'A', player1: 'ana', player2: 'bo', status: 'pending' }];
  // 1-1 : personne ne mène, on continue.
  let r = T.manche(m, [0], 'ana', 'bo', 'ana', 2);
  m[0].score1 = r.score1; m[0].score2 = r.score2;
  assert.strictEqual(r.fini, false, '1-0 ne suffit pas');
  r = T.manche(m, [0], 'ana', 'bo', 'bo', 2);
  m[0].score1 = r.score1; m[0].score2 = r.score2;
  assert.strictEqual(r.fini, false, '1-1 ne suffit pas');
  // 3-1 : deux d'écart, c'est plié.
  r = T.manche(m, [0], 'ana', 'bo', 'ana', 2);
  m[0].score1 = r.score1; m[0].score2 = r.score2;
  assert.strictEqual(r.fini, false, '2-1 ne suffit pas');
  r = T.manche(m, [0], 'ana', 'bo', 'ana', 2);
  assert.strictEqual(r.fini, true, '3-1 : deux d\'écart');
  assert.strictEqual(r.winner, 'ana');
  assert.deepStrictEqual([r.score1, r.score2], [3, 1]);
});

test('une manche nulle se joue mais ne rapproche personne', () => {
  const m = [{ round: 0, slot: 0, player1: 'ana', player2: 'bo', status: 'pending' }];
  const r = T.manche(m, [0], 'ana', 'bo', null, 2);
  assert.deepStrictEqual([r.score1, r.score2], [0, 0]);
  assert.strictEqual(r.fini, false);
});

test('une manche hors affiche ne touche à rien', () => {
  const m = [{ round: 0, slot: 0, player1: 'ana', player2: 'bo', status: 'pending' }];
  assert.strictEqual(T.manche(m, [0], 'ana', 'cyd', 'ana', 2), null, 'pas leur match');
  assert.strictEqual(T.manche(m, [1], 'ana', 'bo', 'ana', 2), null, 'pas le bon tour');
  m[0].status = 'done';
  assert.strictEqual(T.manche(m, [0], 'ana', 'bo', 'ana', 2), null, 'match déjà plié');
});

test('le classement d\'une poule : matchs gagnés, puis la confrontation directe', () => {
  const j = [{ username: 'ana' }, { username: 'bo' }, { username: 'cyd' }];
  // ana bat cyd, bo bat ana, cyd bat bo : tout le monde à 1 victoire.
  const m = [
    { round: 0, poule: 'A', player1: 'ana', player2: 'cyd', score1: 2, score2: 0, winner: 'ana', status: 'done' },
    { round: 0, poule: 'A', player1: 'bo', player2: 'ana', score1: 2, score2: 0, winner: 'bo', status: 'done' },
    { round: 0, poule: 'A', player1: 'cyd', player2: 'bo', score1: 3, score2: 1, winner: 'cyd', status: 'done' },
  ];
  const t = T.classementPoule(j, m);
  assert.deepStrictEqual(t.map((l) => l.gagnes), [1, 1, 1], 'triangulaire parfaite');
  // Tout le monde à une victoire, et la différence de manches est nulle pour
  // les trois (ana 2-2, bo 3-3, cyd 3-3). C'est donc le nombre de manches
  // GAGNÉES qui écarte ana (2 contre 3), puis la CONFRONTATION DIRECTE qui
  // départage les deux qui restent : cyd a battu bo 3-1, il passe devant.
  assert.deepStrictEqual(t.map((l) => l.username), ['cyd', 'bo', 'ana']);

  // Deux à égalité : c'est la confrontation directe qui tranche, pas l'alphabet.
  const j2 = [{ username: 'ana' }, { username: 'bo' }, { username: 'cyd' }];
  const m2 = [
    { round: 0, poule: 'A', player1: 'ana', player2: 'bo', score1: 0, score2: 2, winner: 'bo', status: 'done' },
    { round: 0, poule: 'A', player1: 'ana', player2: 'cyd', score1: 2, score2: 0, winner: 'ana', status: 'done' },
    { round: 0, poule: 'A', player1: 'bo', player2: 'cyd', score1: 2, score2: 0, winner: 'bo', status: 'done' },
  ];
  const t2 = T.classementPoule(j2, m2);
  assert.strictEqual(t2[0].username, 'bo', 'bo a tout gagné');
  assert.strictEqual(t2[1].username, 'ana');
});

test('la sortie des poules : deux par groupe en coupe, les autres au repêchage', () => {
  const joueurs = [];
  const matchs = [];
  ['A', 'B', 'C', 'D'].forEach((p, k) => {
    const trio = [p + '1', p + '2', p + '3'];
    trio.forEach((u) => joueurs.push({ username: u, poule: p }));
    // Le 1 bat le 2 et le 3 ; le 2 bat le 3.
    matchs.push({ round: 0, poule: p, player1: trio[0], player2: trio[1], score1: 2, score2: 0, winner: trio[0], status: 'done' });
    matchs.push({ round: 0, poule: p, player1: trio[0], player2: trio[2], score1: 2, score2: 0, winner: trio[0], status: 'done' });
    matchs.push({ round: 0, poule: p, player1: trio[1], player2: trio[2], score1: 3, score2: 1, winner: trio[1], status: 'done' });
  });
  assert.ok(T.poulesTerminees(matchs, T.TOUR_POULES), 'toutes les poules sont allées au bout');
  const s = T.sortieDesPoules(joueurs, matchs, 2);
  assert.strictEqual(s.qualifies.length, 8, 'huit qualifiés');
  assert.strictEqual(s.repeches.length, 4, 'quatre au repêchage');
  // Les premiers d'abord, puis les deuxièmes.
  assert.deepStrictEqual(s.qualifies.slice(0, 4).map((q) => q.username), ['a1', 'b1', 'c1', 'd1']);
  assert.deepStrictEqual(s.qualifies.slice(4).map((q) => q.username), ['a2', 'b2', 'c2', 'd2']);
  assert.deepStrictEqual(s.repeches.map((q) => q.username), ['a3', 'b3', 'c3', 'd3']);
});

test('la coupe se retire au sort en ENTIER à chaque tour', () => {
  const huit = ['a1', 'b1', 'c1', 'd1', 'a2', 'b2', 'c2', 'd2'];
  const q = T.tirerTour(huit, 1, graine(11));
  assert.strictEqual(q.length, 4, 'quatre quarts');
  const dedans = q.flatMap((m) => [m.player1, m.player2]).sort();
  assert.deepStrictEqual(dedans, huit.slice().sort(), 'les huit sont placés, une fois chacun');
  // Aucun seed ne protège : le tirage change avec la graine.
  assert.notDeepStrictEqual(T.tirerTour(huit, 1, graine(12)), q);
  assert.deepStrictEqual(T.tirerTour(huit, 1, graine(11)), q, 'et il est rejouable');

  // Les vainqueurs passent, dans l'ordre des affiches.
  q.forEach((m, i) => { m.winner = i % 2 ? m.player2 : m.player1; m.status = 'done'; });
  assert.ok(T.tourTermine(q, 1));
  const demis = T.vainqueursDuTour(q, 1);
  assert.strictEqual(demis.length, 4);
  assert.strictEqual(T.nomDuTour(1, 4), 'Quarts de finale');
  assert.strictEqual(T.nomDuTour(2, 2), 'Demi-finales');
  assert.strictEqual(T.nomDuTour(3, 1), 'Finale');
});

test('un nombre impair laisse un exempt, qui passe sans jouer', () => {
  const t = T.tirerTour(['a', 'b', 'c'], 1, graine(5));
  assert.strictEqual(t.length, 2);
  const bye = t.filter((m) => m.player2 === null);
  assert.strictEqual(bye.length, 1, 'un seul exempt');
  assert.strictEqual(bye[0].status, 'done');
  assert.strictEqual(bye[0].winner, bye[0].player1, 'il est déjà vainqueur de son tour');
});

test('un tournoi complet se déroule de bout en bout', () => {
  const alea = graine(2026);
  // Poules.
  const joueurs = T.tirerPoules(DOUZE, 3, alea);
  const matchs = T.matchsDeGroupes(joueurs, T.TOUR_POULES).map((m) =>
    Object.assign({ score1: 0, score2: 0, winner: null, status: 'pending' }, m));
  assert.strictEqual(matchs.length, 12, 'quatre poules de trois = douze matchs');

  // On joue chaque match à l'écart, le premier nommé l'emportant 2-0.
  for (const m of matchs) {
    const r = jouer(matchs, [T.TOUR_POULES], m.player1, m.player2, [m.player1, m.player1], 2);
    assert.ok(r && r.fini, 'match plié');
  }
  assert.ok(T.poulesTerminees(matchs, T.TOUR_POULES));

  // Qualification.
  const s = T.sortieDesPoules(joueurs, matchs, 2);
  assert.strictEqual(s.qualifies.length, 8);
  assert.strictEqual(s.repeches.length, 4);

  // Coupe : quarts, demies, finale — tirage intégral à chaque tour.
  let restants = s.qualifies.map((q) => q.username);
  let tour = 1;
  const coupe = [];
  while (restants.length > 1) {
    const affiches = T.tirerTour(restants, tour, alea).map((m) =>
      Object.assign({ score1: 0, score2: 0, winner: m.winner || null }, m));
    coupe.push(...affiches);
    for (const m of affiches) {
      if (m.status === 'done') continue;
      const r = jouer(coupe, [tour], m.player1, m.player2, [m.player2, m.player2], 2);
      assert.ok(r && r.fini);
    }
    assert.ok(T.tourTermine(coupe, tour), 'tour ' + tour + ' terminé');
    restants = T.vainqueursDuTour(coupe, tour);
    tour++;
  }
  assert.strictEqual(restants.length, 1, 'un champion');
  assert.strictEqual(tour, 4, 'quarts, demies, finale');
  assert.ok(DOUZE.map((u) => u.toLowerCase()).includes(restants[0]),
    'le champion est bien un des douze : ' + restants[0]);
});
