'use strict';
/*
 * SWAPOU — LES HORLOGES DU VERDICT (swapouVerdict.js), sans serveur.
 *
 *   · le rejeu dit « divergent » : la partie l'est, quoi que disent les
 *     horloges ;
 *   · une partie rendue plus vite que ses propres animations, une durée
 *     déclarée plus courte qu'elles, ou plus longue que le temps écoulé au
 *     serveur : refusée ;
 *   · une graine gardée longtemps, un journal dont les temps de réflexion
 *     débordent : signalé, pas refusé ;
 *   · et surtout, une VRAIE partie — jouée à pas variable, le temps de
 *     réflexion d'un joueur très rapide — passe : les marges couvrent l'écart
 *     entre le rejeu (pas de six images) et le jeu.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const SV = require('../swapouVerdict.js');
const R = require('../swapouRejeu.js');
const A = require('./aideSwapou.js');

const conforme = (o) => Object.assign({ ok: true, score: 1000, tempsJeuMs: 300000, combos: [] }, o);

test('le rejeu prime : divergent ou sans réponse', () => {
  assert.equal(SV.juger({ ok: false, raison: 'échange impossible au coup 3' }, {}).verdict, 'divergent');
  const v = SV.juger(conforme(), { scoreDeclare: 1200, dureeDeclareeMs: 400000, dureeServeurMs: 410000 });
  assert.equal(v.verdict, 'divergent');
  assert.match(v.raison, /score rejoué 1000, déclaré 1200/);
  assert.equal(SV.juger(null, {}).verdict, 'non_verifiable');
});

test('les durées impossibles sont refusées', () => {
  // 300 s d'animations : il faut au moins 0,85 × 300 − 5 = 250 s.
  const rendueTropVite = SV.juger(conforme(), { scoreDeclare: 1000, dureeDeclareeMs: 300000, dureeServeurMs: 60000 });
  assert.equal(rendueTropVite.verdict, 'refuse');
  assert.match(rendueTropVite.raison, /rendue 1 min 00 s après la graine, il faut au moins 4 min 10 s/);
  const horlogeAcceleree = SV.juger(conforme(), { scoreDeclare: 1000, dureeDeclareeMs: 120000, dureeServeurMs: 400000 });
  assert.equal(horlogeAcceleree.verdict, 'refuse');
  assert.match(horlogeAcceleree.raison, /durée déclarée 2 min 00 s/);
  const plusLongueQueLeServeur = SV.juger(conforme(), { scoreDeclare: 1000, dureeDeclareeMs: 900000, dureeServeurMs: 400000 });
  assert.equal(plusLongueQueLeServeur.verdict, 'refuse');
  assert.match(plusLongueQueLeServeur.raison, /plus longue que les/);
  // Aux bornes, ça passe : 250 s pile, et la marge de 2 % + 10 s.
  assert.equal(SV.juger(conforme(), { scoreDeclare: 1000, dureeDeclareeMs: 250000, dureeServeurMs: 250000 }).verdict, 'conforme');
  assert.equal(SV.juger(conforme(), { scoreDeclare: 1000, dureeDeclareeMs: 400000 * 1.02 + 9000, dureeServeurMs: 400000 }).verdict, 'conforme');
  // Graine locale : pas de durée serveur, seule la déclarée se juge.
  assert.equal(SV.juger(conforme(), { scoreDeclare: 1000, dureeDeclareeMs: 300000, dureeServeurMs: null }).verdict, 'conforme');
});

test('l’étrange est signalé, pas refusé', () => {
  const garde = SV.juger(conforme(), { scoreDeclare: 1000, dureeDeclareeMs: 320000, dureeServeurMs: 3600000 });
  assert.equal(garde.verdict, 'conforme');
  assert.match(garde.indices.join(), /entre la graine et le score/);
  const reflexion = SV.juger(conforme(), { scoreDeclare: 1000, dureeDeclareeMs: 320000, dureeServeurMs: 330000, reflexionMs: 200000 });
  assert.equal(reflexion.verdict, 'conforme');
  assert.match(reflexion.indices.join(), /réflexion déclarée/);
  assert.equal(SV.reflexionTotale('s1,2,0@812;d@100!;s3,3,1@88'), 1000);
});

test('une vraie partie, jouée vite et à pas variable, passe les horloges', () => {
  const sb = A.bac();
  for (let k = 0; k < 4; k++) {
    // Un joueur très rapide : un dixième de seconde de réflexion par coup, et
    // un navigateur saccadé (pas de 0,3 à 4 images).
    const j = A.jouer(sb, { id: 'x', graine: 1000 + k * 7919 }, k, { reflexionMs: 100, pasVariable: true });
    const r = R.rejouer({ graine: 1000 + k * 7919, coups: j.pf.coups, perso: k });
    assert.ok(r.ok, r.raison);
    assert.equal(r.score, j.score);
    assert.ok(r.tempsJeuMs >= j.tempsJeuMs, `le rejeu ne sous-estime pas le temps de jeu (${r.tempsJeuMs} ≥ ${j.tempsJeuMs})`);
    assert.ok(r.tempsJeuMs < j.tempsJeuMs * 1.1, `ni ne l'exagère (${r.tempsJeuMs} < 1,1 × ${j.tempsJeuMs})`);
    // Le serveur a vu passer la durée de la partie et une seconde de réseau.
    const v = SV.juger(r, { scoreDeclare: j.score, dureeDeclareeMs: j.pf.duree, dureeServeurMs: j.pf.duree + 1000,
      reflexionMs: SV.reflexionTotale(j.pf.coups) });
    assert.equal(v.verdict, 'conforme', v.raison);
    assert.deepEqual(v.indices, []);
    // Les combos comptés par le rejeu sont ceux du jeu.
    assert.deepEqual(r.combos, j.combos);
  }
});

test('une vraie partie rendue trois secondes après sa graine est refusée', () => {
  const sb = A.bac();
  const j = A.jouer(sb, { id: 'x', graine: 4242 }, 2, { reflexionMs: 300 });
  const r = R.rejouer({ graine: 4242, coups: j.pf.coups, perso: 2 });
  // Un « joueur » qui rend la partie trois secondes après la graine.
  const v = SV.juger(r, { scoreDeclare: j.score, dureeDeclareeMs: j.pf.duree, dureeServeurMs: 3000 });
  assert.equal(v.verdict, 'refuse');
});
