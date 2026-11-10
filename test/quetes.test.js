'use strict';
/*
 * LES QUÊTES DE GROMELIN
 * ══════════════════════
 *
 * Le module pur (quetes.js) : la semaine (lundi minuit, heure de Paris, heure
 * d'été comprise), le tirage (composition, familles, reproductible, retouches
 * de l'admin), l'avancement de chaque type de quête, la parole de Gromelin.
 *
 * Puis le parc entier, sur Postgres :
 *   · fermées par défaut ; ouvertes à un testeur, et à lui seul ;
 *   · un score classé, une épreuve de Kaluga déclarée par le jeu : la quête
 *     avance, se fait, et Gromelin paie TOUT DE SUITE — une seule fois, même
 *     quand l'événement revient, même après un redémarrage ;
 *   · ce que dit Gromelin, ce qui est « neuf », la visite ;
 *   · l'admin : réglages persistants, semaine retouchée, seuil abaissé qui
 *     paie aussitôt, remise à zéro d'un testeur ;
 *   · la semaine qui tourne : un nouveau tirage, l'avancement repart de zéro ;
 *   · le contrat « rien que pour toi » (en réserve) : trois propositions
 *     taillées sur l'archive du Challenge du joueur, une signature (une
 *     seule), et seuls les résultats d'après la signature comptent ;
 *   · les quêtes INDIVIDUELLES (le mode par défaut) : taillées sur l'archive
 *     de chacun, complétées de quêtes faciles pour qui joue peu, un score
 *     joué avant d'ouvrir la fenêtre qui compte quand même, tout figé et
 *     gardé au redémarrage.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const Q = require(path.join(ROOT, 'quetes.js'));

// ── Le module ────────────────────────────────────────────────────────────────

test('la semaine : du lundi au dimanche, et elle finit lundi à minuit, heure de Paris', () => {
  assert.equal(Q.lundiDe('2026-10-05'), '2026-10-05');
  assert.equal(Q.lundiDe('2026-10-07'), '2026-10-05');
  assert.equal(Q.lundiDe('2026-10-11'), '2026-10-05', 'le dimanche est encore de la semaine');
  assert.equal(Q.lundiDe('2026-10-12'), '2026-10-12');
  // Heure d'été : minuit à Paris = 22 h UTC ; heure d'hiver : 23 h UTC.
  assert.equal(new Date(Q.finDeSemaine('2026-10-05')).toISOString(), '2026-10-11T22:00:00.000Z');
  // Le changement d'heure tombe dans la semaine du 19 (dimanche 25 octobre).
  assert.equal(new Date(Q.finDeSemaine('2026-10-19')).toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(Q.semaineLisible('2026-10-05'), 'du 5 au 11 octobre');
  assert.equal(Q.semaineLisible('2026-09-28'), 'du 28 septembre au 4 octobre');
});

test('le tirage : 2 faciles, 2 moyennes, 1 difficile, des jeux différents, reproductible', () => {
  for (const lundi of ['2026-10-05', '2026-10-12', '2026-10-19', '2027-01-04']) {
    const t = Q.tirer({}, 'gromelin:' + lundi);
    assert.deepEqual(t.map((q) => q.niveau), ['facile', 'facile', 'moyenne', 'moyenne', 'difficile']);
    assert.equal(new Set(t.map((q) => q.famille)).size, 5, lundi + ' : ' + t.map((q) => q.id));
    assert.equal(new Set(t.map((q) => q.etiquette)).size, 5, 'cinq jeux différents : ' + t.map((q) => q.id));
    assert.ok(t.every((q) => q.actif), 'seulement des quêtes actives');
    assert.deepEqual(Q.tirer({}, 'gromelin:' + lundi).map((q) => q.id), t.map((q) => q.id), 'même graine, même tirage');
  }
});

test('le catalogue : des résultats, plus de volumes', () => {
  for (const q of Q.CATALOGUE) {
    assert.ok(['mesure', 'record', 'action'].includes(q.type), q.id + ' : ' + q.type);
    if (q.type === 'action') assert.ok(['kiloute', 'medaille'].includes(q.params.action), 'une victoire, pas un compteur : ' + q.id);
    if (q.type === 'mesure') {
      assert.ok(Q.MESURES[q.params.mesure], q.id + ' : mesure connue');
      assert.ok(Number(q.params.seuil) > 0, q.id + ' : un seuil');
    }
  }
  assert.ok(!JSON.stringify(Q.CATALOGUE).match(/"(parties|jours)"|chatMsg|forumPost|"pari"/), 'ni parties, ni jours, ni messages, ni paris');
  // Les repères viennent des jeux : objectifs de niveau de Kaluga, temps de l'ordinateur à MotionBall.
  assert.deepEqual(Q.reperes(Q.MESURES['kaluga-chrono0']).map((r) => r.texte), ['1 min']);
  assert.deepEqual(Q.reperes(Q.MESURES['mb2-course1']).map((r) => [r.nom, r.texte]),
    [['Or (ordinateur)', '4 min'], ['Argent', '4 min 40 s'], ['Bronze', '5 min 20 s']]);
  assert.equal(Q.titre(Q.definition('mb2-course-verte-argent', {})), 'Finis la course verte en moins de 4 min 40 s');
  assert.equal(Q.titre(Q.definition('kaluga-chrono-difficile', {})), 'Finis le Chrono difficile en moins de 45 s');
  // Aucun titre ne répète son unité (« 20 épreuves épreuves »).
  for (const x of Q.catalogue({})) assert.doesNotMatch(Q.titre(x), /(?:^|\s)(\p{L}{3,}) \1(?:\s|$)/u, Q.titre(x));
  for (const m of Object.values(Q.MESURES)) {
    const t = m.titre.replace('{seuil}', Q.formater(m, 12));
    assert.doesNotMatch(t, /(points|épreuves|coups|victoires|cm|salle|niveau) \1/, t);
  }
  // Chaque mode déclaré par un jeu est une mesure, avec sa borne.
  for (const k of ['kaluga:chrono0', 'kaluga:survie3', 'kaluga:invasion1', 'kaluga:piste2', 'kaluga:defi2', 'kaluga:epreuve6',
    'kaluga:triathlon', 'kaluga:heptathlon', 'mb2:course6', 'mb2:classique', 'mb2:aventure4', 'minifever:fever', 'swapou2:classique']) {
    assert.ok(Q.MODES[k], k);
  }
});

test('les valeurs : écrites et relues dans l’unité de leur mesure', () => {
  const M = Q.MESURES;
  assert.equal(Q.formater(M['kaluga-chrono0'], 45230), '45,23 s');
  assert.equal(Q.formater(M['kaluga-chrono0'], 65000), '1 min 05 s');
  assert.equal(Q.formater(M['mb2-course1'], 28050), '4 min 40,50 s');
  assert.equal(Q.formater(M['swapou-challenge'], 25000), '25 000 points');
  assert.equal(Q.formater(M['mb2-challenge-salles'], 80), '80 %');
  for (const [k, texte, attendu] of [
    ['mb2-course1', '4:40', 28000], ['mb2-course1', '4:40,5', 28050], ['mb2-course1', '4 min 40 s', 28000], ['mb2-course1', '280', 28000],
    ['kaluga-chrono0', '45,5', 45500], ['kaluga-chrono0', '1:05', 65000], ['kaluga-chrono0', '1 min', 60000],
    ['swapou-challenge', '25 000', 25000], ['swapou-challenge', '25 000 points', 25000], ['minifever-arcade0', '20 épreuves', 20],
  ]) assert.equal(Q.lireValeur(M[k], texte), attendu, k + ' ← ' + texte);
  assert.equal(Q.lireValeur(M['mb2-course1'], 'bof'), null);
  assert.equal(Q.lireValeur(M['swapou-challenge'], ''), null);
});

test('les retouches de l\'admin : composition, niveau, seuil, quête désactivée, quêtes créées', () => {
  const R = Q.reglagesNormalises({
    composition: { facile: 1, moyenne: 0, difficile: 3 },
    catalogue: { 'swapou-25000': { seuil: 30000, niveau: 'moyenne' }, kiloute: { actif: false } },
    perso: [
      { id: 'perso-1', mesure: 'bkiwi-circuit0', seuil: 72000, niveau: 'difficile' },
      { id: 'perso-2', mesure: 'inconnue', seuil: 1, niveau: 'facile' },
      { id: 'perso-3', mesure: 'mb2-course1', seuil: 0, niveau: 'facile' },
      { id: 'pas-perso', mesure: 'mb2-course1', seuil: 1, niveau: 'facile' },
    ],
  });
  assert.deepEqual(R.perso.map((x) => x.id), ['perso-1'], 'seules les quêtes créées valides restent');
  const t = Q.tirer(R, 'g');
  assert.deepEqual(t.map((q) => q.niveau), ['facile', 'difficile', 'difficile', 'difficile']);
  assert.ok(!t.some((q) => q.id === 'kiloute'));
  const d = Q.definition('swapou-25000', R);
  assert.equal(d.niveau, 'moyenne');
  assert.equal(Q.titre(d), 'Dépasse 30 000 points à Swapou');
  const p = Q.definition('perso-1', R);
  assert.equal(Q.titre(p), 'Boucle Green Hill en moins de 1 min 12 s');
  assert.equal(p.etiquette, 'bkiwi');
  assert.ok(Q.catalogue(R).some((x) => x.id === 'perso-1'));
  // Un titre choisi par l'admin remplace celui de la mesure.
  const R2 = Q.reglagesNormalises({ perso: [{ id: 'perso-4', mesure: 'mb2-course1', seuil: 27000, niveau: 'moyenne', titre: 'La verte en {seuil}, chiche ?' }] });
  assert.equal(Q.titre(Q.definition('perso-4', R2)), 'La verte en 4 min 30 s, chiche ?');
  // Des réglages absurdes retombent sur les défauts.
  const B = Q.reglagesNormalises({ ouverture: 'n’importe', gains: { facile: -3, moyenne: 'x', difficile: 20000 }, testeurs: [' Papaye ', 'papaye', ''] });
  assert.equal(B.ouverture, 'ferme');
  assert.deepEqual(B.gains, { facile: 5, moyenne: 10, difficile: 20 });
  assert.deepEqual(B.testeurs, ['papaye']);
});

test('l’avancement des quêtes à mesure : le meilleur de la semaine, dans le bon sens', () => {
  const jour = '2026-10-06';
  // Au score (classement) : le meilleur, sur le bon classement seulement.
  const sw = Q.definition('swapou-25000', {});
  let e = Q.appliquer(sw, {}, { type: 'score', rk: 'swapou2_classic', v: 21340 }, jour);
  assert.deepEqual(e, { m: 21340 });
  assert.equal(Q.appliquer(sw, e, { type: 'score', rk: 'swapou2_classic', v: 9000 }, jour), null, 'moins bien : rien ne change');
  assert.equal(Q.appliquer(sw, e, { type: 'score', rk: 'snake3_classic', v: 99999 }, jour), null, 'un autre jeu : rien');
  assert.equal(Q.estFaite(sw, e), false);
  assert.equal(Q.avancement(sw, e).ligne, 'ton meilleur cette semaine : 21 340 points');
  e = Q.appliquer(sw, e, { type: 'score', rk: 'swapou2_classic', v: 25000 }, jour);
  assert.equal(Q.estFaite(sw, e), true);
  assert.equal(Q.avancement(sw, e).pc, 1);
  // Un temps (déclaré par le jeu) : plus petit = meilleur.
  const verte = Q.definition('mb2-course-verte-or', {});
  let t = Q.appliquer(verte, {}, { type: 'mode', jeu: 'mb2', mode: 'course1', v: 26000 }, jour);
  assert.equal(Q.estFaite(verte, t), false);
  assert.equal(Q.appliquer(verte, t, { type: 'mode', jeu: 'mb2', mode: 'course1', v: 27000 }, jour), null, 'plus lent : rien');
  assert.equal(Q.appliquer(verte, t, { type: 'mode', jeu: 'mb2', mode: 'course0', v: 1000 }, jour), null, 'une autre course : rien');
  assert.equal(Q.avancement(verte, t).ligne, 'ton meilleur cette semaine : 4 min 20 s');
  assert.ok(Q.avancement(verte, t).pc > 0.9 && Q.avancement(verte, t).pc < 1);
  t = Q.appliquer(verte, t, { type: 'mode', jeu: 'mb2', mode: 'course1', v: 24000 }, jour);
  assert.ok(Q.estFaite(verte, t), 'pile 4 min : c’est fait');
  // Le palier de Mini-Fever voyage dans la donnée ; le score se ramène en épreuves.
  const mf = Q.definition('minifever-arcade-facile', {});
  assert.equal(Q.appliquer(mf, {}, { type: 'score', rk: 'minifever_arcade', v: 800, data: '1' }, jour), null, 'un autre palier : rien');
  const f = Q.appliquer(mf, {}, { type: 'score', rk: 'minifever_arcade', v: 400, data: '0' }, jour);
  assert.deepEqual(f, { m: 40 });
  assert.ok(Q.estFaite(mf, f));
  // Le Challenge de MotionBall : la part des salles, et le poulpe.
  const salles = Q.definition('mb2-salles-50', {});
  assert.deepEqual(Q.appliquer(salles, {}, { type: 'score', rk: 'mb2_classic', v: 41 }, jour), { m: 42 });
  assert.deepEqual(Q.appliquer(salles, {}, { type: 'score', rk: 'mb2_classic', v: 15300 }, jour), { m: 100 });
  const poulpe = Q.definition('mb2-poulpe', {});
  assert.equal(Q.estFaite(poulpe, Q.appliquer(poulpe, {}, { type: 'score', rk: 'mb2_classic', v: 99 }, jour)), false);
  assert.equal(Q.avancement(poulpe, {}).ligne, 'pas encore vaincu cette semaine');
  assert.ok(Q.estFaite(poulpe, Q.appliquer(poulpe, {}, { type: 'score', rk: 'mb2_classic', v: 12500 }, jour)));
  // Le record d'épreuve, toujours là.
  const rec = Q.definition('vers-record', {});
  assert.equal(Q.appliquer(rec, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 500 }, jour), null, 'sans record, rien');
  const r = Q.appliquer(rec, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 640, record: true }, jour);
  assert.ok(Q.estFaite(rec, r));
  assert.equal(Q.avancement(rec, r).ligne, 'record battu : 640 cm');
  // Les anciens types (une semaine tirée avant la refonte) restent lisibles.
  const vieux = { id: 'vieux', type: 'parties', params: { jeu: 'snake3', n: 1 }, titre: 'Joue {n} partie' };
  assert.ok(Q.estFaite(vieux, Q.appliquer(vieux, {}, { type: 'partie', jeu: 'snake3' }, jour)));
});

test('le calibrage : où se situe un seuil parmi les meilleurs de chacun', () => {
  const m = Q.MESURES['mb2-course1'];
  const c = Q.calibrer(m, [25000, 27000, 30000, 33000, 40000], 28000);
  assert.equal(c.joueurs, 5);
  assert.equal(c.meilleur, 25000);
  assert.equal(c.atteint, 2);
  assert.match(c.texte, /4 min 40 s : atteint par 2 \(40 %\)/);
  assert.equal(Q.calibrer(m, []).joueurs, 0);
});

test('le contrat : trois propositions taillées sur les scores du joueur, une par jeu', () => {
  const histo = {
    'swapou-challenge': [12000, 15000, 18000, 14000, 16500, 13000],   // 6 jours
    'snake-challenge': [800, 1240, 950, 1100],                          // 4 jours
    'kaluga-grappe': [3000, 4200, 3900],                                // 3 jours
    'kaluga-freestyle': [9000, 9500, 9900, 9100, 9800],                 // Kaluga encore : un jeu ne sert qu'une fois
    'mb2-challenge-salles': [40, 55],                                   // 2 jours : trop peu
    'mb2-course1': [27000, 26000, 25000],                               // pas une mesure « perso »
  };
  const props = Q.proposerContrat(histo, Q.aleaSeme('contrat:kiwi:2026-10-05'), { minJours: 3 });
  assert.deepEqual(props.map((p) => p.niveau), ['facile', 'moyenne', 'difficile']);
  const jeux = props.map((p) => Q.MESURES[p.mesure].jeu);
  assert.equal(new Set(jeux).size, 3, 'trois jeux différents : ' + jeux);
  assert.deepEqual(jeux.slice().sort(), ['kaluga', 'snake3', 'swapou2'], 'les jeux les plus pratiqués, pas MotionBall (2 jours)');
  assert.ok(props.some((p) => p.mesure === 'kaluga-freestyle'), 'Kaluga : sa mesure la plus jouée (5 jours) passe avant la grappe (3)');
  assert.deepEqual(Q.proposerContrat(histo, Q.aleaSeme('contrat:kiwi:2026-10-05'), { minJours: 3 }), props, 'même graine, mêmes propositions');
  // Les cibles : médiane (facile), meilleur quart (moyenne), record battu (difficile).
  const solo = (h) => {
    const r = {};
    for (const niveau of Q.NIVEAUX) r[niveau] = Q.proposerContrat({ 'swapou-challenge': h }, () => 0.3, { minJours: 3 }).find((p) => p.niveau === niveau);
    return r;
  };
  const sw = solo([12000, 15000, 18000, 14000, 16500, 13000]);
  assert.equal(sw.facile.seuil, 14000, 'six jours : la médiane basse (le 4e meilleur), dans le sens du joueur');
  assert.equal(sw.moyenne.seuil, 16500);
  assert.deepEqual([sw.difficile.seuil, sw.difficile.strict], [18000, true], 'battre 18 000, strictement');
  // Un seul jeu : les trois niveaux le visent, du plus doux au plus dur.
  assert.ok(sw.facile.seuil < sw.moyenne.seuil && sw.moyenne.seuil <= sw.difficile.seuil);
  // L'arrondi va dans le sens du joueur : vers le bas pour un score, vers le haut pour un temps.
  assert.equal(Q.arrondir(Q.MESURES['swapou-challenge'], 18437), 18400);
  assert.equal(Q.arrondir(Q.MESURES['snake-challenge'], 1237), 1200);
  assert.equal(Q.arrondir(Q.MESURES['minifever-arcade0'], 17.5), 17);
  assert.equal(Q.arrondir(Q.MESURES['mb2-course1'], 27120), 27150, 'un temps en centièmes : au 1/2 s au-dessus');
  assert.equal(Q.arrondir(Q.MESURES['kaluga-chrono0'], 45230), 45500);
  // Trop peu de jours partout : pas de contrat.
  assert.deepEqual(Q.proposerContrat({ 'swapou-challenge': [1, 2] }, () => 0.5, { minJours: 3 }), []);
  assert.deepEqual(Q.proposerContrat({}, () => 0.5), []);
  // MotionBall déjà à 100 % des salles : on vise d'y revenir, pas l'impossible.
  const mb = Q.proposerContrat({ 'mb2-challenge-salles': [100, 80, 60, 100] }, () => 0.5, { minJours: 3 }).find((p) => p.niveau === 'difficile');
  assert.deepEqual([mb.seuil, mb.strict], [100, false]);
});

test('le contrat signé : une quête « contrat », battre son record se compte strictement', () => {
  const d = Q.definitionContrat({ niveau: 'difficile', mesure: 'swapou-challenge', seuil: 18000, strict: true, jours: 6, repere: { record: 18000 } });
  assert.equal(d.id, 'contrat');
  assert.equal(d.contrat, true);
  assert.equal(d.etiquette, 'swapou2');
  assert.equal(Q.titre(d).replace(/\s/g, ' '), 'Bats ton record à Swapou : plus de 18 000 points');
  assert.match(Q.detail(d), /ton record des dernières semaines/);
  const jour = '2026-10-06';
  const e = Q.appliquer(d, {}, { type: 'score', rk: 'swapou2_classic', v: 18000 }, jour);
  assert.equal(Q.estFaite(d, e), false, 'égaler son record ne suffit pas');
  assert.equal(Q.estFaite(d, Q.appliquer(d, e, { type: 'score', rk: 'swapou2_classic', v: 18010 }, jour)), true);
  // Un temps (le moins est le mieux) : strictement moins.
  const t = Q.definitionContrat({ niveau: 'difficile', mesure: 'kaluga-chrono0', seuil: 50000, strict: true, jours: 3, repere: {} });
  assert.equal(Q.estFaite(t, { m: 50000 }), false);
  assert.equal(Q.estFaite(t, { m: 49990 }), true);
  // Facile et moyenne : le titre de la mesure, et ce qui le justifie.
  const f = Q.definitionContrat({ niveau: 'facile', mesure: 'snake-challenge', seuil: 1000, strict: false, jours: 4, repere: { mediane: 1025 } });
  assert.equal(Q.estFaite(f, { m: 1000 }), true);
  assert.match(Q.detail(f), /ton niveau habituel \(4 jours de jeu\)/);
  const m = Q.definitionContrat({ niveau: 'moyenne', mesure: 'snake-challenge', seuil: 1100, strict: false, jours: 4, repere: { mediane: 1025, haut: 1100 } });
  assert.match(Q.detail(m), /tes bons jours \(médiane : 1\s025 points\)/);
  assert.equal(Q.definitionContrat({ niveau: 'facile', mesure: 'inconnue', seuil: 1 }), null);
  // Les réglages : individuelles par défaut, contrat en réserve, lecture bornée.
  const R0 = Q.reglagesNormalises({});
  assert.equal(R0.mode, 'individuelles');
  assert.deepEqual(R0.contrat, { actif: false });
  assert.deepEqual(R0.individuelles, { fenetre: 28, minJours: 3 });
  const R1 = Q.reglagesNormalises({ mode: 'bof', contrat: { actif: true }, individuelles: { fenetre: 2, minJours: 99 } });
  assert.deepEqual([R1.mode, R1.contrat.actif, R1.individuelles.fenetre, R1.individuelles.minJours], ['individuelles', true, 7, 20]);
  assert.equal(Q.reglagesNormalises({ mode: 'deux' }).mode, 'deux');
});

test('les quêtes individuelles : la composition, taillée sur les jeux du joueur, jamais deux fois la même cible', () => {
  const histo = {
    'swapou-challenge': [12000, 15000, 18000, 14000, 16500, 13000],
    'snake-challenge': [800, 1240, 950, 1100],
    'kaluga-grappe': [3000, 4200, 3900],
    'kaluga-freestyle': [9000, 9500, 9900, 9100, 9800],
    'mb2-challenge-salles': [40, 55],
  };
  const props = Q.proposerPerso(histo, Q.aleaSeme('perso:kiwi:2026-10-05'), {});
  assert.deepEqual(props.map((p) => p.niveau), ['facile', 'facile', 'moyenne', 'moyenne', 'difficile']);
  assert.ok(!props.some((p) => p.mesure === 'mb2-challenge-salles'), 'MotionBall : deux jours, trop peu');
  assert.equal(new Set(props.map((p) => p.mesure + ':' + p.niveau)).size, 5);
  assert.deepEqual(Q.proposerPerso(histo, Q.aleaSeme('perso:kiwi:2026-10-05'), {}), props, 'même graine, mêmes quêtes');
  // Un seul jeu : trois quêtes (facile, moyenne, difficile), pas cinq redites.
  const seul = Q.proposerPerso({ 'swapou-challenge': histo['swapou-challenge'] }, () => 0.4, {});
  assert.deepEqual(seul.map((p) => [p.niveau, p.seuil, p.strict]), [['facile', 14000, false], ['moyenne', 16500, false], ['difficile', 18000, true]]);
  // Deux jeux : chacun a sa facile et sa moyenne, l'un des deux sa difficile.
  const deux = Q.proposerPerso({ 'swapou-challenge': histo['swapou-challenge'], 'snake-challenge': histo['snake-challenge'] }, () => 0.4, {});
  assert.equal(deux.length, 5);
  assert.deepEqual(deux.filter((p) => p.niveau === 'facile').map((p) => p.mesure).sort(), ['snake-challenge', 'swapou-challenge']);
  // La composition de l'admin est suivie.
  assert.deepEqual(Q.proposerPerso(histo, () => 0.4, { composition: { facile: 1, moyenne: 0, difficile: 2 } }).map((p) => p.niveau), ['facile', 'difficile', 'difficile']);
  assert.deepEqual(Q.proposerPerso({}, () => 0.4, {}), []);
  // La quête : un id, la marque « taillée », le titre et la raison.
  const d = Q.definitionPerso(seul[0], 'ind-1');
  assert.deepEqual([d.id, d.taillee, d.niveau, d.etiquette], ['ind-1', true, 'facile', 'swapou2']);
  assert.equal(Q.titre(d).replace(/\s/g, ' '), 'Dépasse 14 000 points à Swapou');
  assert.match(Q.detail(d), /ton niveau habituel \(6 jours de jeu\)/);
  assert.equal(Q.estFaite(d, { m: 14000 }), true);
});

test('les paliers du parc : cinq seuils communs, le niveau d’un joueur, la paie au palier et le budget', () => {
  const m = Q.MESURES['swapou-challenge'];
  // Un parc de 100 meilleurs du jour, de 100 à 10 000 points.
  const parc = Array.from({ length: 100 }, (_, i) => (i + 1) * 100);
  // (un tableau plat : un joueur par valeur)
  const P = Q.paliersDe(m, parc);
  assert.deepEqual([P.bronze, P.argent, P.or, P.platine, P.legende], [5100, 7100, 8600, 9600, 10000]);
  assert.ok(P.decouverte < P.bronze);
  assert.equal(Q.paliersDe(m, parc.slice(0, 10)), null, 'trop peu de journées');
  assert.equal(Q.paliersDe(m, [parc]), null, 'trop peu de joueurs (un seul, cent journées)');
  // UN JOUEUR, UNE VOIX : l'habitué qui joue vingt-huit jours à 25 000 ne pèse
  // pas vingt-huit fois le joueur du dimanche. Le Bronze est le score habituel
  // du joueur médian, pas la journée médiane du parc.
  const voix = Q.paliersDe(m, [Array(28).fill(25000), [10000, 11000, 12000], [8000, 9000, 7000], [12000, 13000, 12500], [6000, 6500]]);
  assert.equal(voix.bronze, 11000, 'cinq joueurs : médianes 25 000, 12 500, 11 000, 8 000, 6 000 → le troisième');
  assert.equal(voix.legende, 25000);
  // Un temps (le moins est le mieux) : les paliers descendent.
  const t = Q.paliersDe(Q.MESURES['mb2-course1'], parc.map((v) => v * 10));
  assert.ok(t.bronze > t.argent && t.argent > t.legende);
  assert.equal(Q.palierAtteint(m, P, 7200), 1, 'Argent');
  assert.equal(Q.palierAtteint(m, P, 3000), -1, 'sous le Bronze');
  const paliers = { 'swapou-challenge': P, 'snake-challenge': Q.paliersDe(Q.MESURES['snake-challenge'], parc.map((v) => v / 10)),
    'kaluga-grappe': Q.paliersDe(Q.MESURES['kaluga-grappe'], parc.map((v) => v / 2)) };
  const gains = { bronze: 5, argent: 8, or: 12, platine: 18, legende: 25 };
  // (Les scores seuls ici : la vie du parc et les exploits ont leur propre test.)
  const sansParc = { activites: 0, exploits: 0 };
  // Les cibles du parc : une facile, ce qu'atteignent 55 % des joueurs
  // (4 500), une moyenne 25 % (7 600), une difficile 12,5 % (8 800) — un joueur,
  // une voix. Le record du parc (10 000) les borne toutes.
  assert.deepEqual([P.facile, P.moyenne, P.difficile, P.record], [4500, 7600, 8800, 10000]);
  // LES CIBLES SONT À SA MESURE : son score habituel, ses bons jours, son
  // meilleur — chacune au moins un cran au-dessus de la précédente. Un habitué
  // de niveau Or, toujours à 8 800 : 8 800, 8 850, 8 900 (le cran de Swapou à
  // ce niveau : 50), payées à l'Or. Rien sur le nombre de jours joués.
  const habitue = Q.proposerV2({ historique: { 'swapou-challenge': Array(40).fill(8800) }, paliers }, () => 0.3, sansParc);
  assert.equal(habitue.niveaux['swapou-challenge'], 'or');
  const sw = habitue.quetes.filter((q) => q.mesure === 'swapou-challenge');
  assert.deepEqual(sw.map((q) => [q.niveau, q.palier, q.seuil, q.gain, q.borne]),
    [['facile', 'or', 8800, 12, null], ['moyenne', 'or', 8850, 12, null], ['difficile', 'or', 8900, 12, null]]);
  const occasionnel = Q.proposerV2({ historique: { 'swapou-challenge': [8800, 8800, 8800] }, paliers }, () => 0.3, sansParc);
  assert.deepEqual(occasionnel.quetes.filter((q) => q.mesure === 'swapou-challenge').map((q) => q.seuil), sw.map((q) => q.seuil),
    'trois jours ou quarante : les mêmes cibles');
  // LE RETOUR DES JOUEURS : sous les cibles du parc, on ne lui demande plus
  // celles du parc (4 500, 7 600, 8 800 pour qui n'a jamais passé 3 000), mais
  // les siennes — son habituel, ses bons jours, un cran au-dessus de son
  // meilleur —, payées au palier qu'elles atteignent (ici, le Bronze).
  const faible = Q.proposerV2({ historique: { 'swapou-challenge': [2000, 2500, 3000] }, paliers }, () => 0.3, sansParc);
  assert.deepEqual(faible.quetes.filter((q) => q.mesure === 'swapou-challenge').map((q) => [q.niveau, q.palier, q.seuil, q.part]),
    [['facile', 'bronze', 2500, null], ['moyenne', 'bronze', 3000, null], ['difficile', 'bronze', 3050, null]]);
  // LE PARC ADOUCIT : quand sa cible d'un niveau est plus facile que la
  // sienne (et lui demande encore quelque chose), c'est elle qu'il reçoit.
  // Habitué à 7 000, de bons jours à 9 500 : la moyenne du parc (7 600) au
  // lieu de ses 8 750, la difficile du parc (8 800) au lieu de ses 9 800.
  const entre = Q.proposerV2({ historique: { 'swapou-challenge': [6500, 7000, 7000, 9500, 9800] }, paliers }, () => 0.3, sansParc);
  assert.deepEqual(entre.quetes.filter((q) => q.mesure === 'swapou-challenge').map((q) => [q.niveau, q.palier, q.seuil, q.part]),
    [['facile', 'bronze', 7000, null], ['moyenne', 'argent', 7600, 0.25], ['difficile', 'or', 8800, 0.125]]);
  // UN JOUR DE CHANCE NE FAIT PAS UNE CIBLE : la difficile s'arrête à son
  // habituel × `pas.difficile` (ici réglé à 1,2 : 9 600), pas à ses 12 000 —
  // et la difficile du parc (8 800), plus facile encore, l'emporte.
  const serre = Q.proposerV2({ historique: { 'swapou-challenge': [8000, 8000, 8000, 12000] }, paliers }, () => 0.3, Object.assign({ pas: { moyenne: 1.1, difficile: 1.2, moyenneTemps: 1.1, difficileTemps: 1.2 } }, sansParc));
  assert.deepEqual(serre.quetes.filter((q) => q.mesure === 'swapou-challenge').map((q) => q.seuil), [8000, 8050, 8800]);
  // Et jamais au-delà du record du parc (10 000) : au-dessus, une seule quête, le record.
  const fort = Q.proposerV2({ historique: { 'swapou-challenge': [11000, 11000, 11000] }, paliers }, () => 0.3, sansParc);
  assert.deepEqual(fort.quetes.filter((q) => q.mesure === 'swapou-challenge').map((q) => [q.seuil, q.borne]), [[10000, 'record']]);
  assert.deepEqual(Q.reglagesNormalises({ paliers: { pas: { moyenne: 0.5, difficile: 1.4 } } }).paliers.pas, { moyenne: 1.25, difficile: 1.4, moyenneTemps: 1.1, difficileTemps: 1.2 });
  // Les parts se règlent aussi — dans l'ordre (la facile la plus large), sinon celles par défaut.
  assert.deepEqual(Q.REGLAGES_DEFAUT.paliers.parts, { facile: 0.55, moyenne: 0.25, difficile: 0.125 });
  assert.deepEqual(Q.reglagesNormalises({ paliers: { parts: { facile: 0.6, moyenne: 0.2, difficile: 0.1 } } }).paliers.parts, { facile: 0.6, moyenne: 0.2, difficile: 0.1 });
  assert.deepEqual(Q.reglagesNormalises({ paliers: { parts: { facile: 0.1, moyenne: 0.2, difficile: 0.3 } } }).paliers.parts, Q.REGLAGES_DEFAUT.paliers.parts);
  const reparti = Q.paliersDe(m, parc, { parts: { facile: 0.6, moyenne: 0.2, difficile: 0.1 } });
  assert.deepEqual([reparti.facile, reparti.moyenne, reparti.difficile], [4100, 8100, 9100]);
  // Les repères connus : Swapou.
  assert.deepEqual(Q.PALIERS_CONNUS['swapou-challenge'], { bronze: 10000, argent: 20000, or: 25000, platine: 30000 });
  // Le budget : un faible reçoit plus de quêtes (plus douces), un fort moins.
  for (const r of [habitue, faible]) {
    const total = r.quetes.reduce((n, q) => n + q.gain, 0);
    assert.ok(r.quetes.length >= 3 && r.quetes.length <= 7);
    // Le budget atteint, ou la limite, ou plus rien à proposer (ici, trois jeux
    // seulement ont des paliers ; « un cran plus bas » ne sert qu'à l'échange).
    const plusBas = (x) => x.genre === 'palier' && x.niveau === 'facile' && x.part === undefined;
    assert.ok(total >= 50 || r.quetes.length === 7 || r.reserve.every(plusBas), JSON.stringify(r.quetes.map((q) => [q.palier, q.gain])));
    for (const q of r.quetes) assert.equal(q.gain, gains[q.palier]);
  }
  // Le faible n'en a pas moins (ici, tout ce que trois jeux offrent), payées moins.
  const somme = (r) => r.quetes.reduce((n, q) => n + q.gain, 0);
  assert.ok(faible.quetes.length >= habitue.quetes.length, `${faible.quetes.length} contre ${habitue.quetes.length}`);
  assert.ok(somme(faible) < somme(habitue), `${somme(faible)} contre ${somme(habitue)}`);
  // Les découvertes : des jeux qu'il n'a pas joués (ici Frutisnake et Kaluga).
  // On ne sait rien de son niveau : trois parties, pas un score.
  const dec = faible.quetes.filter((q) => q.genre === 'decouverte');
  assert.ok(dec.length >= 1);
  for (const q of dec) {
    assert.notEqual(Q.MESURES[q.mesure].jeu, 'swapou2');
    const d = Q.definitionV2(q, 'ind-9');
    assert.deepEqual([d.type, d.params, d.decouverte, d.etiquette], ['parties', { jeu: Q.MESURES[q.mesure].jeu, n: 3 }, true, Q.MESURES[q.mesure].jeu]);
    assert.match(Q.titre(d), /^Découvre .* : joue trois parties$/);
    assert.equal(Q.estFaite(d, { c: 2 }), false);
    assert.equal(Q.estFaite(d, { c: 3 }), true);
  }
  // Premiers pas : en tête, une fois chacun ; un parc sans repères n'en propose pas d'autre.
  const nouveau = Q.proposerV2({ historique: {}, paliers: {}, premiersPas: ['pas-forum', 'pas-prunostic', 'pas-jeux'] }, () => 0.3, sansParc);
  assert.deepEqual(nouveau.quetes.map((q) => q.cle), ['pas-forum', 'pas-prunostic', 'pas-jeux']);
  // La réserve des échanges : ce qui n'a pas été pris.
  assert.ok(habitue.reserve.length >= 1);
  assert.ok(!habitue.reserve.some((r) => habitue.quetes.includes(r)));
  // Les définitions.
  const d = Q.definitionV2(sw[0], 'ind-1');
  assert.deepEqual([d.id, d.palier, d.gain, d.type, d.etiquette], ['ind-1', 'or', 12, 'mesure', 'swapou2']);
  assert.equal(Q.titre(d).replace(/\s/g, ' '), 'Dépasse 8 800 points à Swapou');
  assert.match(Q.detail(d), /ton score habituel/);
  assert.match(Q.detail(Q.definitionV2(sw[1], 'ind-2')), /tes bons jours$/);
  assert.match(Q.detail(Q.definitionV2(sw[2], 'ind-3')), /à hauteur de tes meilleurs jours$/);
  assert.match(Q.detail(Q.definitionV2(fort.quetes.find((q) => q.borne), 'ind-2')), /le record du parc$/);
  assert.match(Q.detail(Q.definitionV2(entre.quetes.find((q) => q.niveau === 'difficile'), 'ind-3')), /atteint par 12,5 % du parc$/);
  assert.match(Q.detail(Q.definitionV2(entre.quetes.find((q) => q.niveau === 'moyenne'), 'ind-3')), /atteint par 25 % du parc$/);
  // Une réserve d'avant les parts (son palier seul) garde sa ligne.
  assert.match(Q.detail(Q.definitionV2({ genre: 'palier', mesure: 'swapou-challenge', palier: 'or', seuil: 8600, niveau: 'difficile', gain: 12, parc: true }, 'r')), /atteint par 15 % du parc/);
  assert.equal(Q.estFaite(d, { m: 8800 }), true);
  assert.match(Q.detail(Q.definitionV2(dec[0], 'ind-9')), /^Découverte/);
});

test('Mini-Fever : jamais plus d’épreuves qu’une partie n’en offre — les cibles aux parts du parc, le plafond, les temps', () => {
  const m = Q.MESURES['minifever-arcade2'];
  // Les maxima théoriques : les épreuves de chaque palier d'arcade, 100 % des
  // salles, le dernier niveau de MiniWave, un boss vaincu.
  assert.deepEqual([0, 1, 2, 3].map((p) => Q.MESURES['minifever-arcade' + p].plafond), [40, 80, 100, 100]);
  assert.deepEqual(['mb2-challenge-salles', 'mb2-challenge-boss', 'mb2-donjon0', 'miniwave-niveau'].map((k) => Q.MESURES[k].plafond), [100, 1, 1, 40]);
  // L'HISTORIQUE DU SIGNALEMENT : dix-neuf joueurs habitués de 10 à 82 épreuves
  // en arcade difficile, et le meilleur du parc, habitué à 83 (un jour à 95).
  const joueurs = Array.from({ length: 19 }, (_, i) => Array(5).fill(10 + 4 * i));
  joueurs.push([83, 83, 83, 83, 95]);
  const P = Q.paliersDe(m, joueurs);
  assert.equal(P.legende, 83, 'le meilleur du parc est Légende');
  // L'ancien calcul : Légende, rien au-dessus dans le parc, donc le pas seul —
  // 83 × 1,25 = 103 en moyenne, 83 × 1,5 = 124 en difficile, sans plafond.
  assert.deepEqual([Q.arrondir(m, 83 * 1.25), Q.arrondir(m, 83 * 1.5)], [103, 124]);
  // LES CIBLES DU PARC : 55 % du parc atteint 46 épreuves, 25 % 70, 12,5 % 78
  // (un joueur, une voix : son score habituel) ; le record, 95.
  assert.deepEqual([P.facile, P.moyenne, P.difficile, P.record], [46, 70, 78, 95]);
  assert.equal(Q.plafondDe(m, P), 100, 'le maximum théorique d’abord, pas le record du parc');
  const sansParc = { activites: 0, exploits: 0, decouverte: false };
  const cibles = (h) => Q.proposerV2({ historique: { 'minifever-arcade2': h }, paliers: { 'minifever-arcade2': P } }, () => 0.3, sansParc)
    .quetes.map((q) => [q.niveau, q.seuil, q.palier, q.gain]);
  // Le joueur du signalement : son score habituel, un cran au-dessus, son
  // meilleur (95) — jamais 124.
  assert.deepEqual(cibles([83, 83, 83, 83, 95]), [['facile', 83, 'legende', 25], ['moyenne', 84, 'legende', 25], ['difficile', 95, 'legende', 25]]);
  // Un joueur à 20 épreuves : 20, 21, 22 — plus les 46, 70 et 78 du parc
  // (« le Fever est plus du double de mon record »).
  assert.deepEqual(cibles([20, 20, 20]).map((q) => q.slice(0, 2)), [['facile', 20], ['moyenne', 21], ['difficile', 22]]);
  assert.deepEqual(cibles([50, 50, 50]).map((q) => q.slice(0, 2)), [['facile', 50], ['moyenne', 51], ['difficile', 52]]);
  // Qui finit déjà le mode d'habitude : une seule quête, le mode en entier.
  assert.deepEqual(cibles([100, 100, 100]), [['facile', 100, 'legende', 25]]);
  // Au bord du mode : le cran au-delà de 100 retombe sur 100.
  assert.deepEqual(cibles([99, 99, 99]).map((q) => q.slice(0, 2)), [['facile', 99], ['moyenne', 100]]);
  const d = Q.definitionV2(Q.proposerV2({ historique: { 'minifever-arcade2': [83, 83, 83] }, paliers: { 'minifever-arcade2': P } }, () => 0.3, sansParc)
    .quetes.find((q) => q.niveau === 'moyenne'), 'ind-2');
  assert.equal(Q.titre(d), 'Remporte 84 épreuves en arcade difficile');
  assert.match(Q.detail(d), /tes bons jours$/);
  // Tous les joueurs, tous les paliers d'arcade : aucune cible au-delà du mode.
  for (let p = 0; p < 4; p++) {
    const mp = Q.MESURES['minifever-arcade' + p];
    const parc = Array.from({ length: 30 }, (_, i) => Array(4).fill(Math.round(mp.plafond * (i + 1) / 30)));
    const Pp = Q.paliersDe(mp, parc);
    for (let v = 1; v <= mp.plafond; v++) {
      const r = Q.proposerV2({ historique: { ['minifever-arcade' + p]: [v, v, v] }, paliers: { ['minifever-arcade' + p]: Pp } }, () => 0.3, sansParc);
      for (const q of r.quetes.concat(r.reserve)) assert.ok(q.seuil <= mp.plafond, `arcade ${p}, habitué à ${v} : ${q.niveau} ${q.seuil}`);
    }
  }
  // Une mesure sans maximum (Swapou) : le record du parc borne, arrondi sous lui.
  const sw = Q.MESURES['swapou-challenge'];
  assert.deepEqual(Q.borner(sw, 13200, { record: 10049 }), { seuil: 10000, borne: 'record' });
  assert.deepEqual(Q.borner(sw, 9000, { record: 10049 }), { seuil: 9000, borne: null });
  assert.deepEqual(Q.borner(sw, 13200, null), { seuil: 13200, borne: null }, 'ni maximum ni record : rien ne borne');

  // LES TEMPS (le moins est le mieux) : les parts se lisent depuis le plus
  // rapide, le record est le temps le plus court, et le plafond s'arrondit
  // au-dessus de lui (58,321 s → 58,5 s) : jamais plus vite que le record.
  const t = Q.MESURES['bkiwi-circuit0'];
  const tj = Array.from({ length: 20 }, (_, i) => Array(3).fill(60000 + 2000 * i));
  tj[0] = [60000, 60000, 58321];
  const PT = Q.paliersDe(t, tj);
  assert.deepEqual([PT.facile, PT.moyenne, PT.difficile, PT.record], [80000, 68000, 64000, 58321]);
  assert.ok(PT.bronze > PT.argent && PT.argent > PT.or);
  assert.equal(Q.plafondDe(t, PT), 58500);
  assert.deepEqual(Q.borner(t, 55000, PT), { seuil: 58500, borne: 'record' });
  // (Aucune mesure de temps n'est taillée aux paliers aujourd'hui : on en prête une.)
  t.perso = true;
  try {
    const temps = (h) => Q.proposerV2({ historique: { 'bkiwi-circuit0': h }, paliers: { 'bkiwi-circuit0': PT } }, () => 0.3, sansParc)
      .quetes.map((q) => [q.niveau, q.seuil, q.borne]);
    // À sa mesure, dans le bon sens : une demi-seconde plus vite à chaque niveau.
    assert.deepEqual(temps([100000, 100000, 100000]), [['facile', 100000, null], ['moyenne', 99500, null], ['difficile', 99000, null]]);
    // Un bon jour plus rapide : la difficile le vise, sans passer sous ÷1,2.
    assert.deepEqual(temps([100000, 100000, 100000, 70000]), [['facile', 100000, null], ['moyenne', 99500, null], ['difficile', 83500, null]]);
    // Le plus rapide du parc : la moyenne tombe sur le record du parc (58,5 s),
    // la difficile passerait dessous — ramenée au record, déjà demandé.
    assert.deepEqual(temps([59000, 59000, 59000]), [['facile', 59000, null], ['moyenne', 58500, null]]);
    assert.deepEqual(temps([58000, 58000, 58000]), [['facile', 58500, 'record']]);
  } finally { delete t.perso; }
});

test('le rattrapage : une cible distribuée au-delà du maximum revient au plafond, sans rien perdre', () => {
  const P = { record: 95 };
  // La quête du signalement, telle que l'ancien calcul l'a figée.
  const vieille = { id: 'ind-3', niveau: 'difficile', palier: 'legende', gain: 25, type: 'mesure', etiquette: 'minifever', famille: 'minifever-arcade2',
    taillee: true, v2: true, decouverte: false, params: { mesure: 'minifever-arcade2', seuil: 124 }, detail: 'Arcade difficile : épreuves remportées · bien au-dessus de tes scores habituels' };
  assert.equal(Q.titre(vieille), 'Remporte 124 épreuves en arcade difficile');
  const r = Q.rattraper(vieille, P);
  assert.equal(Q.titre(r), 'Remporte 100 épreuves en arcade difficile');
  assert.deepEqual([r.id, r.gain, r.palier, r.niveau, r.rattrapee.de], ['ind-3', 25, 'legende', 'difficile', 124], 'même id, même gain promis');
  assert.match(r.detail, /maximum possible en une partie \(cible corrigée\)$/);
  assert.equal(vieille.params.seuil, 124, 'une copie : l’original ne bouge pas');
  // Son meilleur de la semaine (100 épreuves) la fait désormais.
  assert.equal(Q.estFaite(vieille, { m: 100 }), false);
  assert.equal(Q.estFaite(r, { m: 100 }), true);
  // Rien à corriger : sous le plafond, une autre sorte de quête, une mesure sans borne connue.
  assert.equal(Q.rattraper(Object.assign({}, vieille, { params: { mesure: 'minifever-arcade2', seuil: 90 } }), P), null);
  assert.equal(Q.rattraper({ type: 'action', params: { action: 'forumPost', n: 3 } }, P), null);
  assert.equal(Q.rattraper({ type: 'mesure', params: { mesure: 'swapou-challenge', seuil: 40000 } }, null), null);
  assert.equal(Q.rattraper(r, P), null, 'idempotent');
  // Sans maximum théorique : le record du parc.
  const sw = Q.rattraper({ type: 'mesure', params: { mesure: 'swapou-challenge', seuil: 13200 }, gain: 25 }, { record: 10049 });
  assert.deepEqual([sw.params.seuil, sw.gain], [10000, 25]);
  assert.match(sw.detail, /le record du parc \(cible corrigée\)$/);
  // « Bats ton record » strictement, au maximum : impossible aussi — on vise de l'égaler.
  const strict = Q.rattraper({ type: 'mesure', params: { mesure: 'minifever-arcade0', seuil: 40, strict: true }, titre: 'Bats ton record à {seuil}' }, null);
  assert.deepEqual([strict.params.seuil, strict.params.strict, strict.titre], [40, false, undefined]);
  // Les temps : plus vite que le record, ramené au record.
  const t = Q.rattraper({ type: 'mesure', params: { mesure: 'bkiwi-circuit0', seuil: 50000 } }, { record: 58321 });
  assert.equal(t.params.seuil, 58500);
  // La réserve des échanges suit.
  const sp = Q.rattraperSpec({ genre: 'palier', mesure: 'minifever-arcade1', palier: 'legende', seuil: 98, niveau: 'difficile', gain: 25, parc: false }, null);
  assert.deepEqual([sp.seuil, sp.borne, sp.gain], [80, 'max', 25]);
  assert.equal(Q.rattraperSpec({ genre: 'palier', mesure: 'minifever-arcade1', seuil: 60 }, null), null);
  assert.equal(Q.rattraperSpec({ genre: 'parc', cle: 'parc-forum' }, null), null);
  // Les retouches de l'admin : jamais au-delà du maximum théorique.
  assert.equal(Q.horsPlafond(Q.MESURES['minifever-arcade2'], 124), true);
  assert.equal(Q.horsPlafond(Q.MESURES['minifever-arcade2'], 100), false);
  assert.equal(Q.horsPlafond(Q.MESURES['swapou-challenge'], 1e9), false);
});

test('ce qu’un joueur ne peut pas faire ne lui est pas proposé : la Question à 60 kikooz pour l’équipe qui la pose', () => {
  const parc = Array.from({ length: 100 }, (_, i) => (i + 1) * 100);
  const paliers = { 'swapou-challenge': Q.paliersDe(Q.MESURES['swapou-challenge'], parc) };
  const historique = { 'swapou-challenge': Array(10).fill(9000) };   // niveau Or : les exploits s'ouvrent
  const o = { activites: 0, exploits: 1, decouverte: false };
  const vus = (opts) => {
    const cles = new Set();
    for (let g = 0; g < 60; g++) {
      const r = Q.proposerV2({ historique, paliers }, Q.aleaSeme('exclus:' + g), opts);
      for (const q of r.quetes.concat(r.reserve)) if (q.genre === 'parc') cles.add(q.cle);
    }
    return cles;
  };
  assert.ok(vus(o).has('exploit-question'), 'proposée à un joueur');
  const equipe = vus(Object.assign({ exclus: ['exploit-question'] }, o));
  assert.ok(!equipe.has('exploit-question'), 'jamais à l’équipe, ni en réserve d’échange');
  assert.ok(equipe.has('exploit-podium'), 'les autres exploits restent');
  // Le serveur passe l'exclusion aux animateurs (badge, ou rôle « animateur »).
  const SERVEUR = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(SERVEUR, /function quetesExclusPour\(u\)[\s\S]*?isAnimator[\s\S]*?'animateur'[\s\S]*?\['exploit-question'\]/);
  assert.match(SERVEUR, /exclus: quetesExclusPour\(u\)/);
});

test('la vie du parc et les exploits : des actions sur le site, pas seulement des scores', () => {
  const parc = Array.from({ length: 100 }, (_, i) => (i + 1) * 100);
  const paliers = { 'swapou-challenge': Q.paliersDe(Q.MESURES['swapou-challenge'], parc),
    'snake-challenge': Q.paliersDe(Q.MESURES['snake-challenge'], parc.map((v) => v / 10)) };
  const gains = { bronze: 5, argent: 8, or: 12, platine: 18, legende: 25 };
  const tirage = (historique, premiersPas, graine, o) => Q.proposerV2({ historique, paliers, premiersPas }, Q.aleaSeme(graine), o || {});
  // Un habitué de niveau Or : deux activités (jamais deux du même coin), un exploit,
  // au moins deux quêtes de score ; le budget compte tout.
  for (let i = 0; i < 20; i++) {
    const r = tirage({ 'swapou-challenge': Array(10).fill(8800) }, [], 'or:' + i);
    const act = r.quetes.filter((q) => q.genre === 'parc' && q.sorte === 'activite');
    const exp = r.quetes.filter((q) => q.genre === 'parc' && q.sorte === 'exploit');
    assert.equal(act.length, 2);
    assert.equal(exp.length, 1);
    assert.notEqual(Q.PARC[act[0].cle].etiquette, Q.PARC[act[1].cle].etiquette, 'deux du même coin');
    assert.ok(r.quetes.filter((q) => q.genre === 'palier' || q.genre === 'decouverte').length >= 2);
    assert.ok(r.quetes.length <= 7);
    for (const q of r.quetes) assert.equal(q.gain, gains[q.palier]);
    // À l'affichage : les scores d'abord, puis la vie du parc, puis l'exploit.
    const genres = r.quetes.map((q) => (q.genre === 'parc' ? q.sorte : 'score'));
    assert.deepEqual(genres, genres.slice().sort((a, b) => ['score', 'activite', 'exploit'].indexOf(a) - ['score', 'activite', 'exploit'].indexOf(b)));
    // La réserve des échanges en propose d'autres.
    assert.ok(r.reserve.some((x) => x.genre === 'parc'));
  }
  // Le podium : seulement pour qui a atteint l'Or quelque part.
  const exploits = (h) => new Set(Array.from({ length: 30 }, (_, i) => tirage(h, [], 'x:' + i).quetes.filter((q) => q.sorte === 'exploit').map((q) => q.cle)).flat());
  assert.ok(!exploits({ 'swapou-challenge': [2000, 2500, 3000] }).has('exploit-podium'), 'un joueur sous le Bronze');
  assert.ok(exploits({ 'swapou-challenge': Array(5).fill(9700) }).has('exploit-podium'), 'un Platine');
  // Un débutant : pas de doublon avec ses premiers pas (forum, Prunostic, jours de Challenge).
  const deb = tirage({}, ['pas-forum', 'pas-prunostic', 'pas-jeux'], 'deb');
  const cles = deb.quetes.filter((q) => q.genre === 'parc').map((q) => q.cle);
  assert.ok(cles.length >= 1);
  for (const c of cles) assert.ok(!['parc-forum', 'parc-sujet', 'parc-prunostics', 'parc-assidu', 'exploit-podium'].includes(c), c);
  // Réglables : zéro activité, zéro exploit.
  assert.ok(!tirage({ 'swapou-challenge': Array(10).fill(8800) }, [], 'z', { activites: 0, exploits: 0 }).quetes.some((q) => q.genre === 'parc'));
  const R = Q.reglagesNormalises({ paliers: { activites: 9, exploits: -1 } });
  assert.deepEqual([R.paliers.activites, R.paliers.exploits], [2, 1]);
  // Les définitions, et leur avancement par les événements du site.
  const forum = Q.definitionV2({ genre: 'parc', cle: 'parc-forum', palier: 'bronze', niveau: 'facile', gain: 5 }, 'ind-7');
  assert.deepEqual([forum.id, forum.type, forum.etiquette, forum.famille, forum.parc, forum.gain], ['ind-7', 'action', 'forum', 'parc-forum', 'activite', 5]);
  assert.match(Q.detail(forum), /^Vie du parc/);
  let e = {};
  for (let i = 0; i < 2; i++) e = Q.appliquer(forum, e, { type: 'action', action: 'forumPost' }, 'j') || e;
  assert.equal(Q.appliquer(forum, e, { type: 'action', action: 'chatMsg' }, 'j'), null);
  assert.equal(Q.avancement(forum, e).ligne, '2 / 3');
  assert.ok(Q.estFaite(forum, Q.appliquer(forum, e, { type: 'action', action: 'forumPost' }, 'j')));
  const sujet = Q.definitionV2({ genre: 'parc', cle: 'parc-sujet', gain: 8 }, 'ind-8');
  assert.ok(Q.estFaite(sujet, Q.appliquer(sujet, {}, { type: 'action', action: 'forumTopic' }, 'j')));
  const podium = Q.definitionV2({ genre: 'parc', cle: 'exploit-podium', gain: 18 }, 'ind-9');
  assert.ok(Q.estFaite(podium, Q.appliquer(podium, {}, { type: 'action', action: 'medaille' }, 'j')));
  const vers = Q.definitionV2({ genre: 'parc', cle: 'exploit-vers', gain: 8 }, 'ind-10');
  assert.equal(Q.appliquer(vers, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 9, record: false }, 'j'), null, 'pas un record');
  assert.ok(Q.estFaite(vers, Q.appliquer(vers, {}, { type: 'mode', jeu: 'kaluga', mode: 'epreuve0', v: 12, record: true }, 'j')));
  const assidu = Q.definitionV2({ genre: 'parc', cle: 'parc-assidu', gain: 8 }, 'ind-11');
  e = {};
  for (const j of ['a', 'a', 'b', 'c']) e = Q.appliquer(assidu, e, { type: 'score', challenge: true, rk: 'swapou2_classic', v: 1 }, j) || e;
  assert.equal(Q.avancement(assidu, e).ligne, '3 / 4 jours');
  assert.equal(Q.definitionV2({ genre: 'parc', cle: 'inconnue' }, 'x'), null);
});

test('les premiers pas : le forum, un Prunostic qui coûte plus qu’il ne rapporte, trois jeux', () => {
  const forum = Q.definitionV2(Object.assign({ gain: 5 }, Q.PREMIERS_PAS['pas-forum']));
  assert.equal(forum.id, 'pas-forum');
  assert.ok(Q.estFaite(forum, Q.appliquer(forum, {}, { type: 'action', action: 'forumPost' }, 'j')));
  assert.ok(Q.estFaite(forum, Q.appliquer(forum, {}, { type: 'action', action: 'forumTopic' }, 'j')));
  assert.equal(Q.appliquer(forum, {}, { type: 'action', action: 'chatMsg' }, 'j'), null, 'le chat ne compte pas');
  const pari = Q.definitionV2(Object.assign({ gain: 5 }, Q.PREMIERS_PAS['pas-prunostic']));
  assert.equal(pari.params.mise, 10, 'la mise dépasse le gain');
  assert.match(Q.titre(pari), /au moins 10 kikooz/);
  assert.equal(Q.appliquer(pari, {}, { type: 'pari', mise: 3 }, 'j'), null, 'un pari d’un kikooz ne compte pas');
  assert.ok(Q.estFaite(pari, Q.appliquer(pari, {}, { type: 'pari', mise: 12 }, 'j')));
  const jeux = Q.definitionV2(Object.assign({ gain: 5 }, Q.PREMIERS_PAS['pas-jeux']));
  let e = {};
  for (const jeu of ['swapou2', 'swapou2', 'snake3']) e = Q.appliquer(jeux, e, { type: 'score', challenge: true, jeu }, 'j') || e;
  assert.equal(Q.avancement(jeux, e).ligne, '2 / 3 jeux');
  assert.equal(Q.appliquer(jeux, e, { type: 'score', challenge: false, jeu: 'kaluga' }, 'j'), null, 'hors Challenge : non');
  e = Q.appliquer(jeux, e, { type: 'score', challenge: true, jeu: 'kaluga' }, 'j');
  assert.equal(Q.estFaite(jeux, e), true);
  // Les réglages du modèle.
  const R = Q.reglagesNormalises({ paliers: { gains: { or: -1, legende: 40 }, budget: 1, maxQuetes: 99, depuis: 'bof', seuils: { 'swapou-challenge': { bronze: 100, or: 'x' }, inconnue: { bronze: 1 } } } });
  assert.deepEqual(R.paliers.gains, { bronze: 5, argent: 8, or: 12, platine: 18, legende: 40 });
  assert.deepEqual([R.paliers.budget, R.paliers.maxQuetes, R.paliers.depuis], [50, 7, '2026-10-12']);
  assert.deepEqual(R.paliers.seuils, { 'swapou-challenge': { bronze: 100 } });
  assert.deepEqual(Q.reglagesNormalises({}).primes, { actif: true, gain: 500, relance: 100, pas: 50, plafond: 5000, classements: null });
  // La valeur d'une mise à prix : base + pas par semaine tenue, au plafond.
  const PR = { gain: 500, relance: 100, pas: 50, plafond: 5000 };
  assert.equal(Q.primeValeur(PR, 500, '2026-10-14', '2026-10-12'), 500, 'un record de la semaine : la base');
  assert.equal(Q.primeValeur(PR, 500, '2026-10-01', '2026-10-12'), 600, 'deux lundis passés : deux pas');
  assert.equal(Q.primeValeur(PR, 100, '2026-09-28', '2026-10-12'), 200, 'après relance : 100 + 2 × 50');
  assert.equal(Q.primeValeur(PR, 500, '2024-01-01', '2026-10-12'), 5000, 'un vieux record vaut le plafond');
  assert.equal(Q.primeValeur(PR, undefined, null, '2026-10-12'), 500, 'sans état : le gain d’un record neuf');
});

test('une déclaration de mode : connue et vraisemblable, ou refusée', () => {
  assert.deepEqual(Q.modeRecevable('kaluga', 'epreuve0', '412.5'), { jeu: 'kaluga', mode: 'epreuve0', v: 412.5 });
  assert.equal(Q.modeRecevable('kaluga', 'epreuve9', 1), null);
  assert.equal(Q.modeRecevable('swapou2', 'epreuve0', 1), null);
  assert.equal(Q.modeRecevable('kaluga', 'epreuve0', -1), null);
  assert.equal(Q.modeRecevable('kaluga', 'epreuve0', 1e9), null);
  assert.equal(Q.modeRecevable('kaluga', 'epreuve0', 'abc'), null);
  assert.deepEqual(Q.modeRecevable('mb2', 'course1', 27000), { jeu: 'mb2', mode: 'course1', v: 27000 });
  assert.equal(Q.modeRecevable('mb2', 'course1', 9e9), null, 'au-delà de la borne');
});

test('Gromelin parle : ses répliques, leurs trous remplis', () => {
  const t = Q.parole('faite', { titre: 'Place un Prunostic', gain: 5 }, () => 0);
  assert.match(t, /« Place un Prunostic »/);
  assert.match(t, /<em>5 kikooz<\/em>/);
  assert.doesNotMatch(Q.parole('semaine', { n: 5 }, () => 0.99), /\{n\}/);
  for (const cle of Object.keys(Q.PAROLES)) for (const l of Q.PAROLES[cle]) {
    assert.equal((l.match(/<em>/g) || []).length, (l.match(/<\/em>/g) || []).length, l);
  }
});

test('les bricoles de Gromelin : vite faites, de la vie du parc, jamais du coin d’une quête en main', () => {
  // Le catalogue : des actions sur le site surtout (salons, forum, Prunostics,
  // Challenge), deux parties de jeu — rien qui demande un score.
  const cles = Object.keys(Q.GROMELIN);
  assert.ok(cles.length >= 6);
  assert.ok(cles.every((k) => /^grom-/.test(k)));
  assert.ok(!cles.some((k) => Q.GROMELIN[k].type === 'mesure' || Q.GROMELIN[k].type === 'score'), 'pas de seuil de score');
  const horsJeu = cles.filter((k) => ['salons', 'forum', 'prunostics', 'challenge'].includes(Q.GROMELIN[k].etiquette));
  assert.ok(horsJeu.length > cles.length / 2, 'surtout la vie du parc');
  // La quête : bronze, facile, le gain donné, marquée de son passage.
  const d = Q.definitionGromelin('grom-salons', 'grom-1', 7, { jour: '2026-10-17', at: 123 });
  assert.deepEqual([d.id, d.niveau, d.palier, d.gain, d.type, d.etiquette, d.famille], ['grom-1', 'facile', 'bronze', 7, 'action', 'salons', 'grom-salons']);
  assert.deepEqual(d.gromelin, { cle: 'grom-salons', jour: '2026-10-17', at: 123 });
  assert.equal(Q.titre(d), 'Papote dans les salons : cinq messages');
  assert.match(Q.detail(d), /^Une bricole de Gromelin/);
  assert.equal(Q.definitionGromelin('grom-rien', 'grom-1', 7), null);
  // Elle avance et se fait comme une quête de la vie du parc.
  let e = {};
  for (let i = 0; i < 5; i++) e = Q.appliquer(d, e, { type: 'action', action: 'chatMsg' }, 'j');
  assert.equal(Q.avancement(d, e).ligne, '5 / 5');
  assert.ok(Q.estFaite(d, e));
  assert.equal(Q.appliquer(d, {}, { type: 'action', action: 'forumPost' }, 'j'), null);
  const c = Q.definitionGromelin('grom-course', 'grom-2', 7);
  assert.ok(Q.estFaite(c, Q.appliquer(c, {}, { type: 'partie', jeu: 'bkiwi' }, 'j')));
  assert.equal(Q.appliquer(c, {}, { type: 'partie', jeu: 'swapou2' }, 'j'), null);
  // Le tirage évite les coins des quêtes en main : les salons et le forum pris, on n'a ni l'un ni l'autre.
  const enMain = [{ etiquette: 'salons' }, { etiquette: 'forum' }];
  for (let i = 0; i < 30; i++) {
    const k = Q.bricole(enMain, Math.random);
    assert.ok(!['salons', 'forum'].includes(Q.GROMELIN[k].etiquette), k);
  }
  // Tout pris : n'importe laquelle, plutôt que rien.
  const tout = cles.map((k) => ({ etiquette: Q.GROMELIN[k].etiquette }));
  assert.ok(Q.GROMELIN[Q.bricole(tout, () => 0.5)]);
  // Sa réplique, à la fenêtre.
  assert.match(Q.parole('bricole', { titre: 'Place un Prunostic', gain: 7 }, () => 0), /« Place un Prunostic »[\s\S]*<em>7 kikooz<\/em>/);
});

test('le défi au doigt : un circuit, le record du parc plus quinze secondes, et seules les courses au doigt comptent', () => {
  assert.deepEqual(Q.reglagesNormalises({}).doigt, { actif: true, ecart: 15, palier: 'or' });
  assert.deepEqual(Q.reglagesNormalises({ doigt: { actif: false, ecart: 9999, palier: 'diamant' } }).doigt, { actif: false, ecart: 15, palier: 'or' });
  // Record de Solstice : 1 min 12,345 s → au doigt, en moins de 1 min 28 s (arrondi à la seconde au-dessus).
  const d = Q.definitionDoigt(3, 72345, 15, 'doigt-3', 12, 'or', 'Bob');
  assert.deepEqual([d.id, d.doigt, d.palier, d.gain, d.etiquette, d.params.mesure, d.params.seuil], ['doigt-3', true, 'or', 12, 'bkiwi', 'bkiwi-doigt3', 88000]);
  assert.equal(Q.titre(d), 'Boucle Solstice au doigt en moins de 1 min 28 s');
  assert.match(Q.detail(d), /^Défi au doigt · .*record du parc est à 1 min 12,35 s \(Bob\)$/);
  assert.equal(Q.definitionDoigt(3, 0, 15, 'x', 12), null, 'pas de record : pas de défi');
  // Une course classée ordinaire (au clavier) ne compte pas ; une course au doigt, si.
  assert.equal(Q.appliquer(d, {}, { type: 'score', rk: 'bkiwi_track3_classic', v: 80000, data: '' }, 'j'), null);
  assert.equal(Q.appliquer(d, {}, { type: 'doigt', rk: 'bkiwi_track2_classic', v: 80000 }, 'j'), null, 'pas un autre circuit');
  const e1 = Q.appliquer(d, {}, { type: 'doigt', rk: 'bkiwi_track3_classic', v: 95000 }, 'j');
  assert.equal(Q.avancement(d, e1).ligne, 'ton meilleur cette semaine : 1 min 35 s');
  assert.ok(!Q.estFaite(d, e1));
  assert.ok(Q.estFaite(d, Q.appliquer(d, e1, { type: 'doigt', rk: 'bkiwi_track3_classic', v: 87990 }, 'j')));
  // Et l'inverse : une course au doigt ne compte pas deux fois aux mesures ordinaires du circuit.
  assert.equal(Q.valeurDe(Q.MESURES['bkiwi-circuit3'], { type: 'doigt', rk: 'bkiwi_track3_classic', v: 80000 }), null);
});

test('le client : un message s’écrit lettre à lettre, ses balises toujours refermées', () => {
  globalThis.window = globalThis;
  require(path.join(ROOT, 'public/js/quetes-light.js'));
  const L = globalThis.QuetesLight;
  const m = '<em>Grumpf.</em> Te revoilà. <em>10 kikooz</em> &amp; rien d’autre.';
  assert.equal(L._longueur(m), 'Grumpf. Te revoilà. 10 kikooz & rien d’autre.'.length);
  assert.equal(L._debut(m, 3), '<em>Gru</em>');
  assert.equal(L._debut(m, 9), '<em>Grumpf.</em> T');
  assert.equal(L._debut(m, 999), m);
  const c = L._carte({ id: 'x', niveau: 'difficile', niveauNom: 'Difficile', gain: 20, titre: 'A <b>', detail: 'd', ligne: '0 / 1', pc: 0.5,
    fait: true, jeu: 'swapou2', palier: 'platine', palierNom: 'Platine', etiquette: { nom: 'Swapou', couleur: '#E2862A' } });
  assert.match(c, /A &lt;b&gt;/, 'le titre est échappé');
  // Les assets du parc : le voyant du jeu, la frutibarre (ici pleine), pas de médaille.
  assert.match(c, /src="\/fb\/voyant_swapou\.png"/);
  assert.match(c, /<div class="qt-barre"><i style="width:100%"><\/i><\/div>/);
  assert.doesNotMatch(c, /medal_/);
  // La case de mission de Gromelin (MiniPixiz), cochée.
  assert.match(c, /class="qt-case cochee"/);
  assert.match(c, /shape981\.svg[^]*shape983\.svg/);
  assert.match(c, /\+20/);
  assert.doesNotMatch(c, /qt-palier|Platine|Légende/, 'plus de pastille de palier');
  // Une proposition de contrat : son bouton « Signer », qui porte son numéro.
  const p = L._proposition({ i: 2, niveau: 'moyenne', niveauNom: 'Moyenne', gain: 10, titre: 'Fais 1 100 points', detail: 'tes bons jours',
    etiquette: { nom: 'Frutisnake', couleur: '#5E9E1C' } });
  assert.match(p, /<button type="button" class="qt-gelule qt-signer" data-i="2">Signer<\/button>/);
  assert.match(p, /qt-sceau vide/);
  // « Changer » : le bouton orange de Swapou.
  L._etat({ echange: { possible: true } });
  assert.match(L._carte({ id: 'ind-2', gain: 8, titre: 't', detail: '', ligne: '', pc: 0, jeu: 'forum' }),
    /<button type="button" class="qt-swapou qt-changer" data-id="ind-2"/);
  // Les mises à prix : sous l'enseigne, des affiches sans « RECHERCHÉ ».
  L._etat({ primes: [{ rk: 'swapou2_classic', jeu: 'swapou2', ouverte: true, record: '26 777 points', tenant: 'goyave29', gain: 500,
    etiquette: { nom: 'Swapou' } },
  { rk: 'bkiwi_track3_challenge', jeu: 'bkiwi', ouverte: true, record: '1 min 12 s', tenant: 'cerise', gain: 500, circuit: 'Solstice',
    etiquette: { nom: 'Burning Kiwi' } }] });
  const af = L._primes();
  assert.match(af, /class="qt-enseigne" data-texte="Mises à prix"/);
  assert.match(af, /\/images\/swapou\.png/);
  assert.doesNotMatch(af, /RECHERCH/);
  // Un circuit de Burning Kiwi : l'affiche le nomme.
  assert.match(af, /<div class="qt-aff-circuit">Solstice<\/div>/);
  assert.equal((af.match(/qt-aff-circuit/g) || []).length, 1, 'le circuit, pour les seuls circuits');
  L._etat(null);
  // Le contrat signé : scellé de cire, pas de case à cocher.
  const sc = L._carte({ id: 'contrat', contrat: true, niveau: 'facile', niveauNom: 'Facile', gain: 5, titre: 'x', detail: '', ligne: '', pc: 0 });
  assert.match(sc, /qt-ligne qt-signee/);
  assert.match(sc, /class="qt-sceau"/);
});

test('la forêt de Gromelin : le cadrage, le ciel de l’heure, le voile de nuit, l’extrait des sprites', () => {
  globalThis.window = globalThis;
  require(path.join(ROOT, 'public/js/quetes-foret.js'));
  const F = globalThis.QuetesForet;
  // Le cadrage : 400 unités de décor de large dans une fenêtre, 300 sur un téléphone.
  const b = F._cadre(540), m = F._cadre(380);
  assert.deepEqual([b.H, b.etroit, b.gromelin], [230, false, 160]);
  assert.deepEqual([m.H, m.etroit, m.gromelin], [200, true, 130]);
  assert.ok(Math.abs(b.k - 540 / 400) < 1e-9 && Math.abs(m.k - 380 / 300) < 1e-9);
  assert.ok(b.y0 > 0 && b.y0 + b.H / b.k === 240, 'le bas du paysage reste en bas');
  // Le ciel : minuit, midi (la 51e image), presque minuit.
  assert.equal(F._ciel(0), '/minipixiz/sprites/ciel/ciel001.svg');
  assert.equal(F._ciel(12), '/minipixiz/sprites/ciel/ciel051.svg');
  assert.equal(F._ciel(23.99), '/minipixiz/sprites/ciel/ciel100.svg');
  for (const h of [0, 6, 12, 18, 23.99]) assert.ok(fs.existsSync(path.join(ROOT, 'public', F._ciel(h))), F._ciel(h));
  // La nuit : rien à midi, plus fort au loin qu'au premier plan.
  assert.equal(F._nuit(12), 0);
  assert.equal(F._voile(0.25, 0), '');
  const loin = Number(/brightness\(([\d.]+)/.exec(F._voile(0.25, 1))[1]), pres = Number(/brightness\(([\d.]+)/.exec(F._voile(3.2, 1))[1]);
  assert.ok(loin < pres, `${loin} contre ${pres}`);
  // L'extrait des sprites : à jour (scripts/extraire-foret.js), et chaque pièce existe.
  const X = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/minipixiz/sprites/foret.json'), 'utf8'));
  const TOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  for (const s of ['horizon', 'collines', 'foret3', 'foret2', 'foret', 'milieu', 'arbre', 'herbe', 'premier', 'nuage', 'mCabane', 'mArbre', 'mMoulin', 'mDonjon', 'invMessage']) {
    assert.ok(X[s], s);
    assert.deepEqual(X[s].etats[0].pieces.map((p) => p.fichier), TOUT[s].etats[0].pieces.map((p) => p.fichier), s + ' à jour');
    for (const p of X[s].etats[0].pieces) assert.ok(fs.existsSync(path.join(ROOT, 'public/minipixiz/sprites', p.fichier)), p.fichier);
  }
  assert.deepEqual(X.foret.ancrages.house, TOUT.foret.ancrages.house);
  // Gromelin (l'écran de mission), la feuille du courrier, la bulle de fée, les boutons de Swapou.
  for (const f of ['minipixiz/sprites/shape990.svg', 'minipixiz/sprites/shape1039.svg', 'minipixiz/sprites/shape764.svg',
    'swapou/ui/bouton-orange.svg', 'swapou/ui/bouton-vert.svg', 'swapou/ui/max.svg']) assert.ok(fs.existsSync(path.join(ROOT, 'public', f)), f);
});

test('le light : la tuile, la feuille, le script, et le bureau qui adopte la feuille', () => {
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(LIGHT, /id="tuile-quetes" style="display:none"/);
  assert.match(LIGHT, /<script src="\/js\/quetes-foret.js"><\/script>\n<script src="\/js\/quetes-light.js"><\/script>/);
  assert.match(LIGHT, /<link rel="stylesheet" href="\/quetes.css">/);
  assert.match(LIGHT, /id="quetes-sheet" class="sheet sheet-quetes"/);
  assert.match(LIGHT, /if \(go === "quetes"\)/);
  assert.match(LIGHT, /attr\(xml, "type"\) === "72" && window.QuetesLight/);
  const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
  assert.match(BUREAU, /quetes: +\{ panneau: '#quetes-sheet'/);
  assert.match(BUREAU, /ouvrirQuetes: ouvrirQuetes/);
  assert.match(BUREAU, /idPanneau === 'quetes-sheet' && window.QuetesLight\) QuetesLight.ferme\(\)/);
  // Kaluga déclare chaque épreuve jouée.
  const MODES = fs.readFileSync(path.join(ROOT, 'public/kaluga/jeu/modes.js'), 'utf8');
  assert.match(MODES, /rapporterQuete\('epreuve' \+ this.trialId, this.score, ancienMax > 0 && this.score > ancienMax\)/);
  for (const mode of ['chrono', 'invasion', 'survie', 'piste', 'defi']) {
    assert.match(MODES, new RegExp(`rapporterQuete\\('${mode}' \\+ this.level, this.score\\)`), mode);
  }
  assert.match(MODES, /rapporterQuete\(this.mode, score\)/, 'triathlon et heptathlon');
  // MotionBall : la course (centièmes), le classique, l'aventure.
  const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.match(lire('public/mb2/jeu/ecrans.js'), /rapporterQuete\('course' \+ J.Manager.play_mode_param, score\)/);
  assert.match(lire('public/mb2/plateforme.js'), /this.rapporterQuete\('classique', score\)/);
  assert.match(lire('public/mb2/jeu/base.js'), /rapporterQuete\('aventure' \+ id, score\)/);
  // Mini-Fever (fever) et Swapou (classique).
  assert.match(lire('public/minifever/index.html'), /jeu: 'minifever', mode: 'fever', v: d.niveau - 1/);
  assert.match(lire('public/swapou/game.js'), /jeu: 'swapou2', mode: 'classique'/);
});

// ── Le parc ──────────────────────────────────────────────────────────────────

const PORT = 3597;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-quetes';
const DB = process.env.TEST_DATABASE_URL_QUETES || 'postgres://postgres@127.0.0.1:5433/frutiparc_quetes';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-quetes-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };
const ADMIN = Object.assign({ 'x-admin-key': CLE }, H);

let proc = null, dispo = false;
async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch {} return false; }
}
async function sql(q, params) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5470', FRUTISCORE_PORT: '5471', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'quetes_progres'`)).length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
async function arreter() {
  if (!proc) return;
  const fini = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGKILL');
  await fini;
  proc = null;
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/api/loadFrutiSlots?game=snake3'); } catch { return; }
    await wait(100);
  }
}
before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  await demarrer();
  // Les tests qui suivent exercent le premier modèle (les quêtes taillées sur
  // les seuls scores du joueur, le catalogue) : le modèle des paliers, en
  // production depuis le 12 octobre 2026, attend ici un lundi lointain — le
  // test du modèle des paliers le rapproche lui-même.
  await post('/api/admin/quetes', { paliers: { depuis: '2099-01-04' } }, ADMIN);
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body, headers) => fetch(BASE + url, { method: 'POST', headers: headers || H, body: JSON.stringify(body) }).then((r) => r.json());
const sids = {};
async function compte(pseudo) {
  await post('/api/auth/register', { username: pseudo, password: 'secret123' });
  sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).sid;
}
// Après un redémarrage, les sessions dormantes se réveillent ; on se reconnecte quand même.
async function reconnecter(pseudo) {
  sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).sid;
}
const etat = async (qui) => (await fetch(BASE + '/api/quetes/etat?sid=' + sids[qui])).json();
const solde = async (qui) => (await (await fetch(BASE + '/api/paris?sid=' + sids[qui])).json()).solde;
// Le paiement suit l'écriture en base (asynchrone) : on laisse le solde arriver, 3 s au plus.
async function soldeVaut(qui, attendu) {
  let v;
  for (let i = 0; i < 30; i++) { v = await solde(qui); if (v === attendu) return v; await wait(100); }
  return v;
}
const adminEtat = async () => (await fetch(BASE + '/api/admin/quetes', { headers: ADMIN })).json();
// Un score de Swapou au point près : depuis que le rejeu décide, il passe par
// le classement à la main de l'admin, qui suit le même chemin (persistScore)
// qu'une partie admise (cf. test/aideSwapou.js).
const AS = require('./aideSwapou.js');
async function swapou(pseudo, score) {
  const r = await AS.classerParLAdmin(BASE, sql, ADMIN, sids[pseudo], pseudo, score);
  assert.ok(r.ok, JSON.stringify(r));
}
const quete = (e, id) => e.quetes.find((q) => q.id === id);
const lundiCourant = () => Q.lundiDe(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()));

// La semaine, posée à la main : trois quêtes connues.
async function semaineConnue(ids) {
  for (const q of (await adminEtat()).semaine.quetes) {
    assert.ok((await post('/api/admin/quetes/semaine', { action: 'retirer', id: q.id }, ADMIN)).ok);
  }
  for (const id of ids) assert.ok((await post('/api/admin/quetes/semaine', { action: 'ajouter', id }, ADMIN)).ok, id);
}

test('le lancement les ouvre à tous (une fois) ; l’admin les referme, puis les ouvre à un testeur — et à lui seul', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await compte('papaye');
  await compte('grenade');
  // Le premier démarrage : ouvertes à tous, individuelles, et c'est noté.
  let e0 = await etat('grenade');
  assert.equal(e0.acces, true, 'le lancement : ouvertes à tous');
  assert.equal(e0.quetes.length, 5);
  assert.ok(e0.quetes.every((q) => q.niveau === 'facile' && /^ind-/.test(q.id)), 'individuelles (pas d’historique : faciles)');
  const lanceA = (await sql(`SELECT value FROM app_state WHERE key = 'quetes_lancement'`))[0];
  assert.ok(lanceA && lanceA.value, 'le lancement est noté');
  const R0 = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_reglages'`))[0].value);
  assert.deepEqual([R0.ouverture, R0.mode, R0.contrat.actif], ['tous', 'individuelles', false]);
  // L'admin les referme.
  assert.equal((await post('/api/admin/quetes', { ouverture: 'ferme' }, ADMIN)).reglages.ouverture, 'ferme');
  assert.deepEqual(await etat('papaye'), { ok: true, acces: false }, 'fermées');
  // Le mode collectif (le tirage commun) pour les tests qui suivent ; les quêtes individuelles ont leur test plus bas.
  const r = await post('/api/admin/quetes', { ouverture: 'testeurs', testeurs: 'Papaye, inconnu42', mode: 'collectives' }, ADMIN);
  assert.ok(r.ok);
  assert.deepEqual(r.reglages.testeurs, ['papaye', 'inconnu42']);
  assert.deepEqual(r.inconnus, ['inconnu42'], 'l’admin est prévenu des pseudos inconnus');
  const e = await etat('papaye');
  assert.equal(e.acces, true);
  assert.equal(e.quetes.length, 5);
  assert.deepEqual(e.quetes.map((q) => q.niveau), ['facile', 'facile', 'moyenne', 'moyenne', 'difficile']);
  assert.equal(e.semaine.lundi, lundiCourant());
  assert.equal(e.nouveau, true, 'une semaine jamais vue : le baluchon gigote');
  assert.equal(e.messages.length, 1);
  assert.match(e.messages[0], /5/);
  assert.equal(e.gromelin.bouille, '0d0000010000000000000000');
  assert.deepEqual(await etat('grenade'), { ok: true, acces: false }, 'pas testeur : rien');
  // Le tirage est celui du module, semé par le lundi.
  const reglages = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_reglages'`))[0].value);
  assert.deepEqual(e.quetes.map((q) => q.id), Q.tirer(reglages, 'gromelin:' + e.semaine.lundi).map((q) => q.id));
  assert.equal(JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_semaine'`))[0].value).lundi, e.semaine.lundi);
});

const declarer = (qui, jeu, mode, v, record) => post('/api/quetes/mode', { sid: sids[qui], jeu, mode, v, record });

test('un score, un chrono, un record : la quête se fait, Gromelin paie tout de suite, une seule fois', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await semaineConnue(['swapou-15000', 'kaluga-chrono-facile', 'vers-record']);
  const avant = await solde('papaye');
  // Un score classé (Swapou, au Challenge).
  await swapou('papaye', 12000);
  let e = await etat('papaye');
  assert.equal(quete(e, 'swapou-15000').fait, false);
  assert.equal(quete(e, 'swapou-15000').ligne, 'ton meilleur cette semaine : 12 000 points');
  assert.equal(quete(e, 'swapou-15000').pc, 0.8);
  await swapou('papaye', 16000);
  e = await etat('papaye');
  assert.equal(quete(e, 'swapou-15000').fait, true);
  assert.equal(await solde('papaye'), avant + 10, '+10 kikooz (moyenne), versés sur-le-champ');
  // Un temps déclaré par Kaluga (Chrono facile, en ms) : trop lent, puis dans l'objectif.
  assert.ok((await declarer('papaye', 'kaluga', 'chrono0', 62000)).ok);
  e = await etat('papaye');
  assert.equal(quete(e, 'kaluga-chrono-facile').titre, 'Finis le Chrono facile en moins de 1 min');
  assert.equal(quete(e, 'kaluga-chrono-facile').ligne, 'ton meilleur cette semaine : 1 min 02 s');
  assert.equal(quete(e, 'kaluga-chrono-facile').fait, false);
  assert.equal((await declarer('papaye', 'kaluga', 'chrono0', 30000)).ignore, true, 'trop tôt : ignorée');
  await wait(1600);
  assert.ok((await declarer('papaye', 'kaluga', 'chrono0', 58250)).ok);
  // Le record d'une épreuve olympique.
  await wait(1600);
  assert.ok((await declarer('papaye', 'kaluga', 'epreuve0', 512, true)).ok);
  e = await etat('papaye');
  assert.equal(quete(e, 'kaluga-chrono-facile').fait, true);
  assert.equal(quete(e, 'vers-record').fait, true);
  assert.equal(quete(e, 'vers-record').ligne, 'record battu : 512 cm');
  assert.equal(await solde('papaye'), avant + 10 + 5 + 5);
  assert.equal(e.gagnes, 20);
  assert.equal(e.total, 20);
  // Refusée, et sans effet pour qui n'a pas accès.
  assert.equal((await declarer('papaye', 'kaluga', 'epreuve42', 1)).error, 'mode_invalide');
  const g = await solde('grenade');
  await declarer('grenade', 'kaluga', 'chrono0', 40000);
  await swapou('grenade', 30000);
  assert.equal(await solde('grenade'), g);
  // Le même événement, encore : rien de plus.
  await swapou('papaye', 17000);
  await wait(1600);
  await declarer('papaye', 'kaluga', 'chrono0', 41000);
  assert.equal(await solde('papaye'), avant + 20);
  // En base : l'avancement, et une ligne d'historique par quête.
  const lignes = await sql(`SELECT quete_id, gain, fait_at IS NOT NULL AS fait FROM quetes_progres WHERE username = 'papaye' ORDER BY quete_id`);
  assert.deepEqual(lignes.map((l) => [l.quete_id, l.gain, l.fait]), [['kaluga-chrono-facile', 5, true], ['swapou-15000', 10, true], ['vers-record', 5, true]]);
  const histo = await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id WHERE u.username = 'papaye' AND l.entry_type = 72 ORDER BY l.id`);
  assert.equal(histo.length, 3);
  assert.match(histo[0].content, /^Quête accomplie : « Dépasse 15 000 points à Swapou »\. Gromelin te verse 10 kikooz\.$/);
  const journal = await sql(`SELECT k.amount, k.label FROM kikooz_log k JOIN users u ON u.id = k.user_id WHERE u.username = 'papaye' AND k.label LIKE 'la quête%' ORDER BY k.id`);
  assert.deepEqual(journal.map((j) => Number(j.amount)), [10, 5, 5]);
});

test('Gromelin raconte ce qui est arrivé depuis la dernière visite ; la visite éteint le neuf', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  let e = await etat('papaye');
  assert.equal(e.nouveau, true);
  const faites = e.messages.filter((m) => /kikooz<\/em>/.test(m));
  assert.equal(faites.length, 3, e.messages.join('\n'));
  assert.match(faites[0], /« Dépasse 15 000 points à Swapou »/);
  assert.match(e.messages[e.messages.length - 1], /Reviens lundi/, 'tout est fait');
  assert.ok((await post('/api/quetes/vu', { sid: sids.papaye })).ok);
  e = await etat('papaye');
  assert.equal(e.nouveau, false);
  assert.equal(e.messages.length, 1);
  assert.match(e.messages[0], /Reviens lundi/);
});

test('les réglages et l’avancement survivent au redémarrage ; rien ne se repaie', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const avant = await solde('papaye');
  const ids = (await etat('papaye')).quetes.map((q) => q.id);
  await arreter();
  await demarrer();
  await reconnecter('papaye');
  await reconnecter('grenade');
  const e = await etat('papaye');
  assert.equal(e.acces, true, 'toujours testeur');
  assert.equal(JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_reglages'`))[0].value).ouverture, 'testeurs',
    'le lancement ne se refait pas au redémarrage');
  assert.deepEqual(e.quetes.map((q) => q.id), ids, 'la même semaine');
  assert.ok(e.quetes.every((q) => q.fait));
  assert.equal(e.nouveau, false, 'la visite aussi est gardée');
  await swapou('papaye', 18000);
  await declarer('papaye', 'kaluga', 'epreuve0', 800, true);
  assert.equal(await solde('papaye'), avant);
  assert.deepEqual(await etat('grenade'), { ok: true, acces: false });
});

test('l’admin crée une quête (la course verte), la calibre, abaisse son seuil — payé aussitôt — et remet un testeur à zéro', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Un seuil illisible est refusé ; une mesure inconnue aussi.
  assert.equal((await post('/api/admin/quetes/perso', { mesure: 'mb2-course1', seuil: 'bof', niveau: 'difficile' }, ADMIN)).error, 'seuil_illisible');
  assert.equal((await post('/api/admin/quetes/perso', { mesure: 'nimporte', seuil: '1', niveau: 'difficile' }, ADMIN)).error, 'mesure_inconnue');
  const c = await post('/api/admin/quetes/perso', { mesure: 'mb2-course1', seuil: '4:30', niveau: 'difficile' }, ADMIN);
  assert.ok(c.ok, JSON.stringify(c));
  assert.equal(c.quete.id, 'perso-1');
  assert.equal(c.quete.titre, 'Finis la course verte en moins de 4 min 30 s');
  assert.ok((await post('/api/admin/quetes/semaine', { action: 'ajouter', id: 'perso-1' }, ADMIN)).ok);
  const avant = await solde('papaye');
  await wait(1600);
  assert.ok((await declarer('papaye', 'mb2', 'course1', 27500)).ok);
  let e = await etat('papaye');
  assert.equal(quete(e, 'perso-1').fait, false);
  assert.equal(quete(e, 'perso-1').ligne, 'ton meilleur cette semaine : 4 min 35 s');
  assert.equal(quete(e, 'perso-1').etiquette.nom, 'MotionBall');
  // Le calibrage d'une mesure au classement : les joueurs de Swapou.
  const cal = await (await fetch(BASE + '/api/admin/quetes/calibrage?mesure=swapou-challenge&seuil=20000', { headers: ADMIN })).json();
  assert.match(cal.texte, /joueur\(s\)/);
  assert.match(cal.texte, /20 000 points : atteint par 1/, cal.texte);
  // Le seuil abaissé à 4:40 : papaye l'a déjà, elle est payée sans rejouer.
  const r = await post('/api/admin/quetes/catalogue', { id: 'perso-1', seuil: '4:40' }, ADMIN);
  assert.ok(r.ok && r.semaineMiseAJour, JSON.stringify(r));
  assert.equal(await soldeVaut('papaye', avant + 20), avant + 20, '+20 (difficile)');
  e = await etat('papaye');
  assert.equal(quete(e, 'perso-1').titre, 'Finis la course verte en moins de 4 min 40 s');
  assert.equal(quete(e, 'perso-1').fait, true);
  // Tout est gardé : la quête créée et son seuil.
  const reglages = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_reglages'`))[0].value);
  assert.deepEqual(reglages.perso.map((x) => [x.id, x.mesure, x.seuil, x.niveau]), [['perso-1', 'mb2-course1', 28000, 'difficile']]);
  // Ce que voit l'admin.
  const A = await adminEtat();
  assert.ok(A.mesures.some((m) => m.cle === 'kaluga-chrono0' && m.reperes[0].texte === '1 min'));
  const ligne = A.catalogue.find((q) => q.id === 'perso-1');
  assert.equal(ligne.valeurTexte, '4 min 40 s');
  assert.equal(ligne.sens, 'au plus');
  assert.equal(A.semaine.quetes.length, 4);
  assert.equal(A.joueurs[0].username, 'papaye');
  assert.equal(A.joueurs[0].faites, 4);
  assert.equal(A.historique[0].kikooz, 40);
  // Remettre à zéro : l'avancement part, la visite aussi, les kikooz restent.
  const k = await solde('papaye');
  const z = await post('/api/admin/quetes/reinitialiser', { username: 'papaye' }, ADMIN);
  assert.ok(z.ok);
  assert.equal(z.lignes, 4);
  e = await etat('papaye');
  assert.ok(e.quetes.every((q) => !q.fait));
  assert.equal(e.nouveau, true);
  assert.equal(await solde('papaye'), k);
  // Et l'on peut refaire la quête : elle se repaie (c'est le but d'un test).
  await wait(1600);
  await declarer('papaye', 'mb2', 'course1', 27900);
  assert.equal(await soldeVaut('papaye', k + 20), k + 20);
});

test('ouvertes à tous, puis la semaine tourne : nouveau tirage, avancement neuf', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.ok((await post('/api/admin/quetes', { ouverture: 'tous' }, ADMIN)).ok);
  assert.equal((await etat('grenade')).acces, true);
  // « La semaine passe » : l'avancement et la semaine tirée reculent d'une semaine.
  const lundi = lundiCourant();
  const passe = Q.jourPlus(lundi, -7);
  await sql(`UPDATE quetes_progres SET semaine = $1`, [passe]);
  const sem = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_semaine'`))[0].value);
  sem.lundi = passe;
  await sql(`UPDATE app_state SET value = $1 WHERE key = 'quetes_semaine'`, [JSON.stringify(sem)]);
  await arreter();
  await demarrer();
  await reconnecter('papaye');
  const e = await etat('papaye');
  assert.equal(e.semaine.lundi, lundi);
  const reglages = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_reglages'`))[0].value);
  assert.deepEqual(e.quetes.map((q) => q.id), Q.tirer(reglages, 'gromelin:' + lundi).map((q) => q.id));
  assert.ok(e.quetes.every((q) => !q.fait && q.pc === 0), 'tout repart de zéro : ' + JSON.stringify(e.quetes.map((q) => [q.id, q.fait, q.pc, q.ligne])));
  assert.equal(e.nouveau, true);
  // Les semaines passées restent en base (pour l'historique de l'admin).
  const A = await adminEtat();
  // (papaye avait été remise à zéro, puis avait refait la course verte : 1 quête, 20 kikooz)
  const h = A.historique.find((x) => x.semaine === passe);
  assert.deepEqual([h.joueurs, h.faites, h.kikooz], [1, 1, 20]);
});

test('le contrat : taillé sur l’archive du joueur, signé une fois, payé sur les seuls résultats d’après', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await compte('kiwi');
  // Deux parties de Swapou par jour, sans pass : on lui en donne trois de plus.
  const pass = await (await fetch(BASE + '/api/admin/users/kiwi/fd-pass', { method: 'POST', headers: ADMIN, body: JSON.stringify({ game: 'swapou2', delta: 3 }) })).json();
  assert.equal(pass.passes, 3, JSON.stringify(pass));
  await semaineConnue(['kaluga-chrono-facile']);   // rien à Swapou cette semaine : seul le contrat paie
  assert.equal((await post('/api/admin/quetes', { contrat: { actif: true } }, ADMIN)).reglages.contrat.actif, true, 'le contrat est en réserve : on l’allume');
  const lundi = lundiCourant();
  // Trois semaines de Challenge archivées : Swapou 6 jours, Frutisnake 4, Kaluga 3, MotionBall 2 (trop peu).
  const archive = {
    swapou2_classic: [12000, 15000, 18000, 14000, 16500, 13000],
    snake3_classic: [800, 1240, 950, 1100],
    kaluga_classic: [3000, 4200, 3900],
    mb2_classic: [40, 55],
  };
  for (const [rk, scores] of Object.entries(archive)) {
    for (let i = 0; i < scores.length; i++) {
      await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data) VALUES ($1, $2, 'kiwi', $3, '')`,
        [Q.jourPlus(lundi, -2 - i * 3), rk, scores[i]]);
    }
  }
  // Hors fenêtre (40 jours) : ignoré, sinon ce serait son record.
  await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data) VALUES ($1, 'swapou2_classic', 'kiwi', 99999, '')`,
    [Q.jourPlus(lundi, -40)]);
  let e = await etat('kiwi');
  assert.equal(e.contrat.etat, 'a_signer', JSON.stringify(e.contrat));
  assert.deepEqual(e.contrat.propositions.map((p) => p.niveau), ['facile', 'moyenne', 'difficile']);
  assert.deepEqual(e.contrat.propositions.map((p) => p.gain), [5, 10, 20]);
  assert.deepEqual(e.contrat.propositions.map((p) => p.etiquette.nom).sort(), ['Frutisnake', 'Kaluga', 'Swapou']);
  assert.match(e.messages[e.messages.length - 1], /contrat/, 'Gromelin propose le contrat');
  assert.equal(e.total, 5, 'pas signé : le contrat ne compte pas encore dans le total');
  // Ce sont les propositions du module, semées par le joueur et le lundi.
  const historique = { 'swapou-challenge': archive.swapou2_classic, 'snake-challenge': archive.snake3_classic, 'kaluga-grappe': archive.kaluga_classic,
    'mb2-challenge-salles': archive.mb2_classic.map((v) => v + 1) };
  const props = Q.proposerContrat(historique, Q.aleaSeme('contrat:kiwi:' + lundi), { minJours: 3 });
  assert.deepEqual(e.contrat.propositions.map((p) => p.titre), props.map((p) => Q.titre(Q.definitionContrat(p))));
  const ligne = (await sql(`SELECT propositions, choix FROM quetes_contrats WHERE username = 'kiwi' AND semaine = $1`, [lundi]))[0];
  assert.equal(ligne.propositions.length, 3);
  assert.equal(ligne.choix, null);
  assert.equal((await adminEtat()).contrats.find((c) => c.username === 'kiwi').etat, 'a_signer');
  // Sans archive : pas de contrat, et l'on dit pourquoi.
  assert.deepEqual((await etat('grenade')).contrat, { etat: 'aucun', minJours: 3, fenetre: 28 });

  // Un score d'AVANT la signature ne compte pas.
  await swapou('kiwi', 30000);
  assert.equal((await post('/api/quetes/contrat', { sid: sids.kiwi, choix: 7 })).error, 'choix_invalide');
  const i = props.findIndex((p) => p.mesure === 'swapou-challenge');
  const P = props[i];
  const avant = await solde('kiwi');
  const r = await post('/api/quetes/contrat', { sid: sids.kiwi, choix: i });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.contrat.etat, 'signe');
  assert.equal(r.contrat.choix, i);
  assert.equal(r.contrat.quete.fait, false);
  assert.equal(r.contrat.quete.pc, 0, 'les 30 000 d’avant la signature ne comptent pas');
  assert.match(r.messages[0], /Signé/);
  assert.equal(r.total, 5 + r.contrat.quete.gain);
  assert.equal((await post('/api/quetes/contrat', { sid: sids.kiwi, choix: (i + 1) % 3 })).error, 'deja_signe');
  assert.equal((await sql(`SELECT choix FROM quetes_contrats WHERE username = 'kiwi'`))[0].choix, i);
  // Juste en dessous (ou égal à son record, quand il faut le battre) : pas encore.
  await swapou('kiwi', P.strict ? P.seuil : P.seuil - 100);
  e = await etat('kiwi');
  assert.equal(e.contrat.quete.fait, false);
  assert.match(e.contrat.quete.ligne, /^ton meilleur depuis la signature : /);
  await swapou('kiwi', P.seuil + 100);
  e = await etat('kiwi');
  assert.equal(e.contrat.quete.fait, true);
  const gain = { facile: 5, moyenne: 10, difficile: 20 }[P.niveau];
  assert.equal(await solde('kiwi'), avant + gain, 'payé tout de suite');
  assert.equal(e.gagnes, gain);
  assert.ok(e.messages.some((m) => m.includes('kikooz</em>') && m.includes(e.contrat.quete.titre.split(' ')[0])), e.messages.join('\n'));
  const histo = await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id WHERE u.username = 'kiwi' AND l.entry_type = 72`);
  assert.equal(histo.length, 1);
  assert.match(histo[0].content, new RegExp(`^Contrat rempli : « .+ »\\. Gromelin te verse ${gain} kikooz\\.$`));
  const A = await adminEtat();
  const c = A.contrats.find((x) => x.username === 'kiwi');
  assert.deepEqual([c.etat, c.choix, c.gain], ['fait', i, gain]);

  // Redémarrage : toujours signé, toujours rempli, rien ne se repaie.
  await arreter();
  await demarrer();
  await reconnecter('kiwi');
  e = await etat('kiwi');
  assert.equal(e.contrat.etat, 'signe');
  assert.equal(e.contrat.quete.fait, true);
  assert.deepEqual(e.contrat.propositions.map((p) => p.titre), props.map((p) => Q.titre(Q.definitionContrat(p))));
  await swapou('kiwi', P.seuil + 500);
  assert.equal(await solde('kiwi'), avant + gain);

  // L'admin le coupe : plus de contrat nulle part ; puis le rouvre.
  assert.ok((await post('/api/admin/quetes', { contrat: { actif: false } }, ADMIN)).ok);
  assert.deepEqual((await etat('kiwi')).contrat, { etat: 'inactif' });
  const R = (await post('/api/admin/quetes', { contrat: { actif: true }, individuelles: { fenetre: 21, minJours: 4 } }, ADMIN)).reglages;
  assert.deepEqual([R.contrat, R.individuelles], [{ actif: true }, { fenetre: 21, minJours: 4 }]);
  assert.equal((await etat('kiwi')).contrat.etat, 'signe');
});

test('les quêtes individuelles : taillées sur l’archive de chacun, faciles pour qui débute, un score d’avant la visite compte', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const r = await post('/api/admin/quetes', { mode: 'individuelles', contrat: { actif: false }, individuelles: { fenetre: 28, minJours: 3 } }, ADMIN);
  assert.equal(r.reglages.mode, 'individuelles');
  await compte('mangue');
  await compte('banane');
  const lundi = lundiCourant();
  const archive = {
    swapou2_classic: [12000, 15000, 18000, 14000, 16500, 13000],
    snake3_classic: [800, 1240, 950, 1100],
    kaluga_classic: [3000, 4200, 3900],
  };
  for (const [rk, scores] of Object.entries(archive)) {
    for (let i = 0; i < scores.length; i++) {
      await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data) VALUES ($1, $2, 'mangue', $3, '')`,
        [Q.jourPlus(lundi, -1 - i * 2), rk, scores[i]]);
    }
  }
  // Ce que le module taillera pour elle.
  const historique = { 'swapou-challenge': archive.swapou2_classic, 'snake-challenge': archive.snake3_classic, 'kaluga-grappe': archive.kaluga_classic };
  const props = Q.proposerPerso(historique, Q.aleaSeme('perso:mangue:' + lundi), { minJours: 3 });
  assert.equal(props.length, 5);
  const titres = props.map((p, i) => Q.titre(Q.definitionPerso(p, 'ind-' + (i + 1))));
  // Elle joue AVANT d'avoir ouvert la fenêtre : la plus douce de ses cibles à Swapou.
  const sw = props.map((p, i) => Object.assign({ i }, p)).filter((p) => p.mesure === 'swapou-challenge' && !p.strict).sort((a, b) => a.seuil - b.seuil)[0];
  assert.ok(sw, 'une cible Swapou atteignable : ' + JSON.stringify(props));
  const avant = await solde('mangue');
  await swapou('mangue', sw.seuil);
  await wait(400);
  let e = await etat('mangue');
  assert.deepEqual(e.quetes.map((q) => q.titre), titres);
  assert.deepEqual(e.quetes.map((q) => q.id), ['ind-1', 'ind-2', 'ind-3', 'ind-4', 'ind-5']);
  assert.ok(e.quetes.every((q) => q.taillee));
  assert.equal(e.quetes[sw.i].fait, true, 'le score d’avant la visite a compté');
  const gain = { facile: 5, moyenne: 10, difficile: 20 }[sw.niveau];
  assert.equal(await solde('mangue'), avant + gain);
  assert.match(e.messages[0], /taillées|mesure/, e.messages.join('\n'));
  assert.equal(e.contrat.etat, 'inactif');
  const ligne = (await sql(`SELECT quetes, connu FROM quetes_individuelles WHERE username = 'mangue' AND semaine = $1`, [lundi]))[0];
  assert.deepEqual([ligne.quetes.length, ligne.connu], [5, true]);
  // Pas d'historique : des quêtes faciles du catalogue, et Gromelin explique.
  e = await etat('banane');
  assert.equal(e.quetes.length, 5);
  assert.ok(e.quetes.every((q) => q.niveau === 'facile' && !q.taillee && /^ind-\d$/.test(q.id)), JSON.stringify(e.quetes.map((q) => [q.id, q.niveau])));
  assert.ok(e.messages.some((m) => /Je ne te connais pas encore/.test(m)), e.messages.join('\n'));
  // L'admin voit chacun avec ses quêtes.
  const A = await adminEtat();
  const jm = A.joueurs.find((j) => j.username === 'mangue');
  assert.deepEqual([jm.total, jm.faites, jm.gagnes, jm.connu], [5, 1, gain, true]);
  assert.equal(A.joueurs.find((j) => j.username === 'banane').connu, false);
  // Retoucher le tirage commun ne touche pas aux quêtes individuelles.
  assert.ok((await post('/api/admin/quetes/semaine', { action: 'tirer' }, ADMIN)).ok);
  // Redémarrage : les mêmes quêtes, l'avancement gardé, rien ne se repaie.
  await arreter();
  await demarrer();
  await reconnecter('mangue');
  e = await etat('mangue');
  assert.deepEqual(e.quetes.map((q) => q.titre), titres);
  assert.equal(e.quetes[sw.i].fait, true);
  await swapou('mangue', sw.seuil + 100);
  await wait(300);
  assert.equal(await solde('mangue'), avant + gain);
});

test('le modèle des paliers : paliers du parc, paie au palier, échange, bonus de la semaine, mise à prix, premiers pas', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const lundi = lundiCourant();
  // Le record « hors fenêtre » d'un test précédent fausserait la mise à prix.
  await sql(`DELETE FROM challenge_score_archive WHERE ranking_id = 'swapou2_classic' AND score >= 30000`);
  // Un parc : dix joueurs, six jours de Swapou et de Frutisnake avant ce lundi.
  for (let j = 0; j < 10; j++) {
    for (let d = 0; d < 6; d++) {
      await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data) VALUES ($1, 'swapou2_classic', $2, $3, ''), ($1, 'snake3_classic', $2, $4, '')`,
        [Q.jourPlus(lundi, -1 - d), 'pj' + j, 5000 + 1500 * j + 100 * d, 300 + 100 * j + 10 * d]);
    }
  }
  await compte('cerise');
  await compte('figue');
  await compte('olive');
  // Cerise, joueuse régulière de Swapou (vers 14 000) ; Figue, Swapou seulement.
  for (let d = 0; d < 6; d++) {
    await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data) VALUES ($1, 'swapou2_classic', 'cerise', $2, ''), ($1, 'snake3_classic', 'cerise', $3, '')`,
      [Q.jourPlus(lundi, -1 - d), 14000 + 50 * d, 900]);
    await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data) VALUES ($1, 'swapou2_classic', 'figue', $2, '')`,
      [Q.jourPlus(lundi, -1 - d), 9000]);
  }
  const R = (await post('/api/admin/quetes', { mode: 'individuelles', paliers: { depuis: lundi, budget: 50, maxQuetes: 7, premiersPas: false, echange: true, bonusXp: 25000 },
    primes: { actif: true, gain: 500 } }, ADMIN)).reglages;
  assert.equal(R.paliers.depuis, lundi);
  // Redémarrage : les records du parc se relisent (l'archive vient d'être écrite).
  await arreter();
  await demarrer();
  for (const u of ['cerise', 'figue', 'olive']) await reconnecter(u);

  // CERISE : des quêtes aux paliers, payées au palier, jusqu'au budget.
  let e = await etat('cerise');
  assert.equal(e.v2, true);
  assert.deepEqual(e.gainsPaliers, { bronze: 5, argent: 8, or: 12, platine: 18, legende: 25 });
  assert.ok(e.quetes.length >= 3 && e.quetes.length <= 7, String(e.quetes.length));
  for (const q of e.quetes) {
    assert.ok(q.palier, q.titre);
    assert.equal(q.gain, e.gainsPaliers[q.palier], q.titre);
  }
  assert.ok(e.total >= 50 || e.quetes.length === 7, `${e.total} kikooz, ${e.quetes.length} quêtes`);
  assert.deepEqual([e.echange.possible, e.echange.fait, e.bonus.xp, e.bonus.verse], [true, null, 25000, false]);
  // Pas seulement des scores : deux quêtes de la vie du parc et un exploit, après les jeux.
  const horsScores = e.quetes.filter((q) => /^(Vie du parc|Exploit) ·/.test(q.detail));
  assert.deepEqual(horsScores.map((q) => q.detail.split(' ·')[0]), ['Vie du parc', 'Vie du parc', 'Exploit'], JSON.stringify(e.quetes.map((q) => q.detail)));
  assert.deepEqual(e.quetes.slice(-3).map((q) => q.id), horsScores.map((q) => q.id), 'en fin de liste');
  const A = await adminEtat();
  assert.equal(A.v2, true);
  const swp = A.paliers.mesures.find((m) => m.cle === 'swapou-challenge');
  assert.ok(swp.calcules && swp.effectifs, JSON.stringify(swp));
  // Le record de Swapou du parc (tenu par un joueur d'un test précédent) : une prime ouverte.
  const affiche = A.primes.find((p) => p.rk === 'swapou2_classic');
  assert.ok(affiche && affiche.ouverte && affiche.gain === 500 && !['figue', 'cerise'].includes(affiche.tenantPseudo), JSON.stringify(A.primes));
  const tenant = affiche.tenantPseudo;
  // L'aperçu de lundi prochain passe par le même calcul.
  const ap = await (await fetch(BASE + '/api/admin/quetes/apercu?u=cerise', { headers: ADMIN })).json();
  assert.ok(ap.ok && ap.quetes.length >= 3, JSON.stringify(ap));
  assert.ok(ap.niveaux.some((n) => /Swapou/.test(n.mesure)));

  // L'ÉCHANGE : une fois, une quête pas faite ; la nouvelle part de zéro.
  const vieille = e.quetes[0];
  const ech = await post('/api/quetes/echanger', { sid: sids.cerise, id: vieille.id });
  assert.ok(ech.ok, JSON.stringify(ech));
  assert.ok(!ech.quetes.some((q) => q.id === vieille.id), 'l’ancienne est partie');
  assert.equal(ech.quetes.length, e.quetes.length);
  assert.deepEqual([ech.echange.possible, ech.echange.fait.titre], [false, vieille.titre]);
  assert.match(ech.messages[0], /dernière fois|Changée/);
  assert.equal((await post('/api/quetes/echanger', { sid: sids.cerise, id: ech.quetes[1].id })).error, 'deja_echange');
  // Une quête de Swapou se fait : payée au palier.
  const ligne = (await sql(`SELECT quetes, echange FROM quetes_individuelles WHERE username = 'cerise' AND semaine = $1`, [lundi]))[0];
  assert.equal(ligne.echange.de, vieille.id);
  const cible = ligne.quetes.filter((q) => q.params && q.params.mesure === 'swapou-challenge').sort((a, b) => a.params.seuil - b.params.seuil)[0];
  assert.ok(cible, JSON.stringify(ligne.quetes));
  const avant = await solde('cerise');
  await swapou('cerise', cible.params.seuil);
  assert.equal(await soldeVaut('cerise', avant + cible.gain), avant + cible.gain);

  // FIGUE : trois quêtes au plus, un budget minuscule — un seul score les fait toutes,
  // bat le record du parc : la semaine complète (XP) et la mise à prix.
  assert.ok((await post('/api/admin/quetes', { paliers: { budget: 5, maxQuetes: 3, activites: 0, exploits: 0 } }, ADMIN)).ok);
  e = await etat('figue');
  assert.equal(e.quetes.length, 3, JSON.stringify(e.quetes.map((q) => q.titre)));
  const xpAvant = Number((await sql(`SELECT xp FROM users WHERE username = 'figue'`))[0].xp) || 0;
  const avantF = await solde('figue');
  await swapou('figue', 35000);
  e = await etat('figue');
  assert.ok(e.quetes.every((q) => q.fait), JSON.stringify(e.quetes.map((q) => [q.titre, q.ligne])));
  const gainsF = e.quetes.reduce((n, q) => n + q.gain, 0);
  assert.equal(await soldeVaut('figue', avantF + gainsF + 500), avantF + gainsF + 500, 'ses quêtes, plus la prime de 500');
  assert.equal(e.bonus.verse, true);
  let xp = xpAvant;
  for (let i = 0; i < 30 && xp < xpAvant + 25000; i++) { await wait(100); xp = Number((await sql(`SELECT xp FROM users WHERE username = 'figue'`))[0].xp) || 0; }
  assert.ok(xp >= xpAvant + 25000, `XP ${xpAvant} → ${xp}`);
  const logs = await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id WHERE u.username = 'figue' AND l.entry_type = 72 ORDER BY l.id`);
  assert.ok(logs.some((l) => new RegExp(`Record absolu battu .*devant ${tenant}.*500 kikooz`).test(l.content)), logs.map((l) => l.content).join('\n'));
  assert.ok(logs.some((l) => /bonus de 25\s000 XP/.test(l.content)), logs.map((l) => l.content).join('\n'));
  // La prime est prise pour la semaine : Cerise bat Figue, pas de seconde prime ; l'affiche le dit.
  const avantC = await solde('cerise');
  await swapou('cerise', 36000);
  await wait(400);
  const gagneC = (await etat('cerise')).quetes.filter((q) => q.fait).reduce((n, q) => n + q.gain, 0);
  assert.ok(await solde('cerise') - avantC < 500, 'pas de seconde prime');
  // … mais Gromelin le lui dit : la prime de la semaine est déjà prise.
  const logsC = await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id WHERE u.username = 'cerise' AND l.entry_type = 72 ORDER BY l.id`);
  assert.ok(logsC.some((l) => /Nouveau record absolu .*déjà été prise par figue/i.test(l.content)), logsC.map((l) => l.content).join('\n'));
  const journal = (await adminEtat()).primesJournal;
  assert.deepEqual(journal.slice(0, 2).map((e) => e.issue), ['prise', 'payee'], JSON.stringify(journal));
  assert.ok(gagneC >= cible.gain);
  const prime = (await etat('cerise')).primes.find((p) => p.rk === 'swapou2_classic');
  assert.deepEqual([prime.ouverte, prime.prisePar, prime.tenant], [false, 'figue', 'cerise']);
  // La prime payée valait 500 (un record neuf) ; le record repart à la relance,
  // 100 kikooz, à compter d'aujourd'hui — et cet état survit en base.
  assert.deepEqual([prime.gain, prime.prochaine, prime.semaines], [500, 100, 0], JSON.stringify(prime));
  assert.equal(journal[1].gain, 500);
  const etatPrimes = JSON.parse((await sql(`SELECT value FROM app_state WHERE key = 'quetes_primes_etat'`))[0].value);
  assert.equal(etatPrimes.swapou2_classic.base, 100);
  // Les circuits de Burning Kiwi sont mis à prix sur les records que le Club
  // affiche sous « Challenge (Classique) » : le Challenge du circuit
  // (bkiwi_track{n}_challenge), où entre toute course faite le jour où le
  // circuit est celui du défi. Un temps lisible, et l'affiche nomme le circuit.
  const CIRCUITS = ['Green Hill', 'Banana Derby', 'Terre Grise', 'Solstice', 'Jupiter IV', 'Mistral Kiwi'];
  const jourBk = (await (await fetch(BASE + '/api/bkiwi/daily')).json()).trk;
  const rkBk = `bkiwi_track${jourBk}_challenge`;
  const bk = new URLSearchParams({ sid: sids['cerise'], game: 'bkiwi', m: '0', score: '72345', data: 'Fury Hun:1:1', track: String(jourBk) });
  assert.ok((await (await fetch(BASE + '/api/saveScore', { method: 'POST', body: bk })).json()).ok);
  await wait(300);
  const A2 = await adminEtat();
  const kiwi = A2.primes.find((p) => p.rk === rkBk);
  assert.ok(kiwi && kiwi.tenantPseudo === 'cerise' && /1\s*min\s*12|1:12|72/.test(kiwi.record) && kiwi.jeu === 'bkiwi', JSON.stringify(kiwi));
  assert.deepEqual([kiwi.circuit, kiwi.source], [CIRCUITS[jourBk], 'classement'], 'l’affiche nomme le circuit');
  assert.match(kiwi.nom, new RegExp(CIRCUITS[jourBk] + '$'));
  assert.ok(!A2.primes.some((p) => /^bkiwi_track\d_classic$/.test(p.rk)), 'pas le classement permanent : son circuit y était deviné');
  assert.ok(!A2.primes.some((p) => /_champion$/.test(p.rk)), 'pas les championnats : des notes, pas des records');
  assert.ok(!A2.primes.some((p) => p.rk === 'mb2_classic'), 'pas le Challenge MotionBall');
  // Grapiz et Frutibandas : la série de victoires du Challenge, comme le livre des records.
  const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(SERVEUR, /const QUETES_PRIMES_EN_PLUS = \['grapiz_challenge', 'bandas_challenge'\]/);
  assert.ok(!/quetesNoteChampion/.test(SERVEUR), 'plus de note de championnat poussée aux mises à prix');
  assert.equal((await sql(`SELECT username, ancien, gain FROM quetes_primes WHERE semaine = $1`, [lundi])).map((r) => [r.username, r.ancien, r.gain]).join(), `figue,${tenant},500`);
  // UN CONTRE-LA-MONTRE ne s'écrit que dans la fruticard ($ts[rang].$fcTotal) :
  // le livre des records le range au classement permanent du circuit, mais la
  // mise à prix, elle, suit le Challenge — elle ne bouge pas.
  const carte = (sid, ts) => fetch(BASE + '/api/saveFrutiSlot', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sid, game: 'bkiwi', slotId: '0', data: JSON.stringify({ $ws: false, $wss: false, $wc: false, $wcs: false, $ac: [false, false, true, true, false], $ts: ts }) }) });
  const ts = (t, total) => { const a = []; for (let i = 0; i < 6; i++) a[i] = { $fcLap: 9999999, $fcTotal: i === t ? total : 9999999 }; return a; };
  assert.ok((await carte(sids['figue'], ts(jourBk, 61000))).ok);
  await wait(300);
  const club = await (await fetch(BASE + '/api/club/records?limit=3')).json();
  const rkPerm = club.rankings.find((r) => r.id === `bkiwi_track${jourBk}_classic`);
  assert.deepEqual([rkPerm.scores[0].user.toLowerCase(), rkPerm.scores[0].score], ['figue', 61000], 'le livre des records lit la carte');
  const sol = (await adminEtat()).primes.find((p) => p.rk === rkBk);
  assert.deepEqual([sol.tenantPseudo, sol.ouverte], ['cerise', true], 'la carte ne touche pas à la mise à prix');
  // Figue bat le record du Challenge : quelqu'un d'autre détrôné — la mise à prix est payée.
  const avantFigue = await solde('figue');
  const bk2 = new URLSearchParams({ sid: sids['figue'], game: 'bkiwi', m: '0', score: '60000', data: 'Fury Hun:1:1', track: String(jourBk) });
  assert.ok((await (await fetch(BASE + '/api/saveScore', { method: 'POST', body: bk2 })).json()).ok);
  assert.equal(await soldeVaut('figue', avantFigue + 500), avantFigue + 500, 'la prime du Challenge');
  const sol2 = (await adminEtat()).primes.find((p) => p.rk === rkBk);
  assert.deepEqual([sol2.tenantPseudo, sol2.source, sol2.ouverte, sol2.prisePar], ['figue', 'classement', false, 'figue']);
  // La même course renvoyée ne repaie rien.
  assert.ok((await (await fetch(BASE + '/api/saveScore', { method: 'POST', body: bk2 })).json()).ok);
  await wait(300);
  assert.equal(await solde('figue'), avantFigue + 500);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM quetes_primes WHERE semaine = $1 AND ranking_id = $2`, [lundi, rkBk]))[0].n, 1);

  // LE DÉFI AU DOIGT : à la visite, Cerise reçoit un circuit qui a un record du
  // parc, à boucler au doigt à moins de quinze secondes de lui ; une course au
  // clavier ne compte pas, une course au doigt (doigt=1) sous le temps la paie.
  const ec = await etat('cerise');
  const dg = ec.quetes.find((q) => q.doigt);
  assert.ok(dg && /^doigt-[0-5]$/.test(dg.id) && dg.jeu === 'bkiwi' && dg.palier === 'or', JSON.stringify(ec.quetes.map((q) => q.id)));
  assert.match(dg.titre, /au doigt en moins de/);
  const piste = Number(dg.id.slice(-1));
  const rec = (await adminEtat()).primes.find((p) => p.rk === 'bkiwi_track' + piste + '_challenge');
  assert.ok(rec, 'le circuit tiré a un record du parc');
  const ligneDg = (await sql(`SELECT quetes FROM quetes_individuelles WHERE username = 'cerise' AND semaine = $1`, [lundi]))[0].quetes.find((q) => q.doigt);
  assert.equal(ligneDg.params.seuil, Math.ceil((ligneDg.record + 15000) / 1000) * 1000, 'record + 15 s, à la seconde au-dessus');
  assert.equal((await etat('cerise')).quetes.filter((q) => q.doigt).length, 1, 'un seul défi par semaine');
  const course = (doigt, v) => fetch(BASE + '/api/saveScore', { method: 'POST',
    body: new URLSearchParams({ sid: sids['cerise'], game: 'bkiwi', m: '0', score: String(v), data: 'Fury Hun:1:1', track: String(piste), gm: '3', doigt }) }).then((r) => r.json());
  const avantDg = await solde('cerise');
  assert.ok((await course('0', ligneDg.params.seuil - 2000)).ok);
  await wait(300);
  assert.ok(!(await etat('cerise')).quetes.find((q) => q.doigt).fait, 'au clavier : rien');
  assert.ok((await course('1', ligneDg.params.seuil + 5000)).ok);
  await wait(300);
  let dg2 = (await etat('cerise')).quetes.find((q) => q.doigt);
  assert.ok(!dg2.fait && /ton meilleur cette semaine/.test(dg2.ligne), JSON.stringify(dg2));
  assert.ok((await course('1', ligneDg.params.seuil - 100)).ok);
  assert.equal(await soldeVaut('cerise', avantDg + dg.gain), avantDg + dg.gain, 'le défi payé');
  dg2 = (await etat('cerise')).quetes.find((q) => q.doigt);
  assert.ok(dg2.fait);
  // Il ne s'échange pas.
  const echDg = await post('/api/quetes/echanger', { sid: sids['cerise'], id: dg.id });
  assert.equal(echDg.ok, false);

  // OLIVE : une débutante (premiers pas rallumés) ; un score de Challenge compte pour « trois jeux ».
  assert.ok((await post('/api/admin/quetes', { paliers: { budget: 50, maxQuetes: 7, premiersPas: true, activites: 2, exploits: 1 } }, ADMIN)).ok);
  e = await etat('olive');
  assert.deepEqual(e.quetes.filter((q) => q.premiersPas).map((q) => q.id), ['pas-forum', 'pas-prunostic', 'pas-jeux']);
  assert.ok(e.quetes.some((q) => q.decouverte), 'des découvertes');
  await swapou('olive', 6000);
  await wait(300);
  assert.equal(quete(await etat('olive'), 'pas-jeux').ligne, '1 / 3 jeux');

  // PRUNE : la vie du parc au complet (quatre activités : l'une est forcément
  // une quête de forum) ; des messages sur le forum la font, et Gromelin paie.
  assert.ok((await post('/api/admin/quetes', { paliers: { premiersPas: false, activites: 4 } }, ADMIN)).ok);
  await compte('prune');
  e = await etat('prune');
  const forum = e.quetes.find((q) => /forum/.test(q.titre) && /^Vie du parc/.test(q.detail));
  assert.ok(forum, JSON.stringify(e.quetes.map((q) => q.titre)));
  const board = (await sql(`SELECT id FROM forum_boards WHERE name = 'Frutiz' LIMIT 1`))[0];
  const avantP = await solde('prune');
  for (let i = 0; i < 3; i++) {
    const sujet = await post('/api/forum/topic', { sid: sids.cerise, boardId: board.id, title: 'Les quêtes, épisode ' + (i + 1), content: 'Qui a déjà fini ses quêtes de la semaine ?' });
    assert.ok(sujet.topicId || sujet.id || sujet.ok, JSON.stringify(sujet));
    const tid = sujet.topicId || sujet.id || (sujet.topic && sujet.topic.id);
    const rep = await post('/api/forum/post', { sid: sids.prune, topicId: tid, content: 'Moi, presque : il me manque la grenouille !' });
    assert.ok(!rep.error, JSON.stringify(rep));
  }
  assert.ok(!(await post('/api/forum/topic', { sid: sids.prune, boardId: board.id, title: 'Mon premier sujet', content: 'Bonjour à tous, je viens pour les quêtes.' })).error);
  await wait(400);
  const faite = (await etat('prune')).quetes.find((q) => q.id === forum.id);
  assert.ok(faite.fait, JSON.stringify(faite));
  assert.equal(await soldeVaut('prune', avantP + forum.gain), avantP + forum.gain);
  assert.ok((await post('/api/admin/quetes', { paliers: { activites: 2 } }, ADMIN)).ok);

  // Redémarrage : l'échange, le bonus et la prime tiennent.
  await arreter();
  await demarrer();
  await reconnecter('cerise');
  await reconnecter('figue');
  e = await etat('cerise');
  assert.deepEqual([e.echange.possible, e.echange.fait.titre], [false, vieille.titre]);
  assert.equal((await etat('figue')).bonus.verse, true);
  assert.equal((await etat('cerise')).primes.find((p) => p.rk === 'swapou2_classic').prisePar, 'figue');
});

test('l’admin retaille la semaine : les quêtes faites restent, les autres suivent le modèle du moment', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const avant = await etat('cerise');
  const faites = avant.quetes.filter((q) => q.fait);
  assert.ok(faites.length >= 1 && faites.length < avant.quetes.length, JSON.stringify(avant.quetes.map((q) => [q.titre, q.fait])));
  // Un pas serré : les cibles pas faites changent toutes.
  assert.ok((await post('/api/admin/quetes', { paliers: { pas: { moyenne: 1.05, difficile: 1.1, moyenneTemps: 1.02, difficileTemps: 1.04 } } }, ADMIN)).ok);
  const r = await post('/api/admin/quetes/retailler', {}, ADMIN);
  assert.ok(r.ok && r.joueurs >= 2 && r.remplacees >= 1, JSON.stringify(r));
  const apres = await etat('cerise');
  for (const f of faites) {
    const g = apres.quetes.find((q) => q.id === f.id);
    assert.ok(g && g.fait && g.titre === f.titre && g.gain === f.gain, 'une quête faite reste, payée et cochée : ' + f.titre);
  }
  // Les quêtes en plus (défi au doigt, bricoles) restent hors du plafond de sept.
  const ordinaires = apres.quetes.filter((q) => !q.doigt && !q.gromelin);
  const neuves = ordinaires.filter((q) => !q.fait);
  assert.ok(neuves.length >= 1 && ordinaires.length <= 7, JSON.stringify(apres.quetes.map((q) => [q.id, q.fait])));
  const anciens = avant.quetes.filter((q) => !q.fait).map((q) => q.id);
  for (const q of neuves) assert.ok(!anciens.includes(q.id), 'les nouvelles portent des numéros neufs : ' + q.id);
  assert.equal(apres.gagnes, avant.gagnes, 'rien de repayé');
  assert.deepEqual([apres.echange.possible, apres.echange.fait.titre], [avant.echange.possible, avant.echange.fait.titre], 'l’échange de la semaine n’est pas rendu');
  // Figue avait tout fini (le bonus versé) : rien ne bouge chez elle — son
  // défi au doigt, en plus, ne compte pas pour dire la semaine finie.
  const f = await etat('figue');
  const fReg = f.quetes.filter((q) => !q.doigt && !q.gromelin);
  assert.ok(fReg.length === 3 && fReg.every((q) => q.fait), JSON.stringify(f.quetes.map((q) => [q.titre, q.fait])));
  assert.equal(f.quetes.filter((q) => q.doigt).length, 1, 'son défi au doigt reste');
  // La base dit la même chose, et l'avancement des quêtes remplacées est parti.
  const ligne = (await sql(`SELECT quetes FROM quetes_individuelles WHERE username = 'cerise' AND semaine = $1`, [lundiCourant()]))[0];
  assert.deepEqual(ligne.quetes.map((q) => q.id), apres.quetes.map((q) => q.id));
  const restes = await sql(`SELECT quete_id FROM quetes_progres WHERE username = 'cerise' AND semaine = $1 AND fait_at IS NULL`, [lundiCourant()]);
  for (const x of restes) assert.ok(!anciens.includes(x.quete_id), 'avancement effacé : ' + x.quete_id);
  assert.ok((await post('/api/admin/quetes', { paliers: { pas: { moyenne: 1.25, difficile: 1.5, moyenneTemps: 1.1, difficileTemps: 1.2 } } }, ADMIN)).ok);
});

test('le rattrapage : « 124 épreuves » distribuées avant le plafond reviennent au maximum d’une partie — payées si déjà atteintes, les faites intactes', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const lundi = lundiCourant();
  await compte('pomelo');
  const mf = (id, p, seuil, gain, palier) => ({ id, niveau: 'difficile', palier, gain, type: 'mesure', etiquette: 'minifever', famille: 'minifever-arcade' + p,
    taillee: true, v2: true, decouverte: false, params: { mesure: 'minifever-arcade' + p, seuil }, detail: 'bien au-dessus de tes scores habituels' });
  // Ses quêtes de la semaine, telles que l'ancien calcul les a figées.
  const quetes = [
    mf('ind-1', 2, 124, 25, 'legende'),   // impossible, et ses 100 épreuves de la semaine l'auraient faite
    mf('ind-2', 1, 95, 18, 'platine'),    // impossible (80 épreuves en arcade normal), rien de joué
    mf('ind-3', 0, 50, 12, 'or'),         // impossible, mais déjà marquée faite : on n'y touche pas
    { id: 'ind-4', niveau: 'facile', palier: 'bronze', gain: 5, type: 'mesure', etiquette: 'swapou2', famille: 'swapou-challenge',
      taillee: true, v2: true, params: { mesure: 'swapou-challenge', seuil: 900000 } },   // au-delà du record du parc
    { id: 'ind-5', niveau: 'facile', palier: 'bronze', gain: 5, type: 'mesure', etiquette: 'swapou2', famille: 'swapou-challenge',
      taillee: true, v2: true, params: { mesure: 'swapou-challenge', seuil: 6000 } },     // possible : intacte
  ];
  const reserve = [{ genre: 'palier', mesure: 'minifever-arcade3', palier: 'legende', seuil: 150, niveau: 'difficile', jours: 5, gain: 25, parc: false }];
  await sql(`INSERT INTO quetes_individuelles (semaine, username, quetes, connu, reserve, niveaux) VALUES ($1, 'pomelo', $2::jsonb, true, $3::jsonb, '{}'::jsonb)`,
    [lundi, JSON.stringify(quetes), JSON.stringify(reserve)]);
  await sql(`INSERT INTO quetes_progres (semaine, username, quete_id, etat) VALUES ($1, 'pomelo', 'ind-1', '{"m": 100}'::jsonb)`, [lundi]);
  await sql(`INSERT INTO quetes_progres (semaine, username, quete_id, etat, fait_at, gain) VALUES ($1, 'pomelo', 'ind-3', '{"m": 40}'::jsonb, now(), 12)`, [lundi]);
  const avant = await solde('pomelo');
  // Le serveur les relit au démarrage, comme après la mise en ligne du correctif.
  await arreter();
  await demarrer();
  for (const u of ['pomelo', 'cerise', 'figue']) await reconnecter(u);
  const e = await etat('pomelo');
  const vue = (id) => quete(e, id);
  assert.equal(vue('ind-1').titre, 'Remporte 100 épreuves en arcade difficile');
  assert.equal(vue('ind-2').titre, 'Remporte 80 épreuves en arcade normal');
  assert.match(vue('ind-1').detail, /maximum possible en une partie \(cible corrigée\)/);
  assert.deepEqual([vue('ind-1').gain, vue('ind-2').gain], [25, 18], 'le gain promis ne bouge pas');
  assert.deepEqual([vue('ind-1').fait, vue('ind-2').fait], [true, false], 'ses 100 épreuves de la semaine font la première');
  assert.equal(await soldeVaut('pomelo', avant + 25), avant + 25, 'payée tout de suite');
  assert.deepEqual([vue('ind-3').titre, vue('ind-3').fait, vue('ind-3').gain], ['Remporte 50 épreuves en arcade facile', true, 12], 'une quête faite reste telle quelle');
  assert.equal(vue('ind-5').titre.replace(/\s/g, ' '), 'Dépasse 6 000 points à Swapou');
  // Swapou n'a pas de maximum : le record du parc sur la fenêtre, arrondi sous lui.
  const rec = Number((await sql(`SELECT max(score) AS m FROM challenge_score_archive WHERE ranking_id = 'swapou2_classic' AND day_key >= $1 AND day_key < $2`,
    [Q.jourPlus(lundi, -28), lundi]))[0].m);
  assert.equal(vue('ind-4').titre.replace(/\s/g, ' '), `Dépasse ${Q.nombre(Q.arrondir(Q.MESURES['swapou-challenge'], rec))} points à Swapou`.replace(/\s/g, ' '));
  assert.match(vue('ind-4').detail, /record du parc/);
  // La base suit (la réserve des échanges aussi), et un second passage ne change plus rien.
  const ligne = (await sql(`SELECT quetes, reserve FROM quetes_individuelles WHERE username = 'pomelo' AND semaine = $1`, [lundi]))[0];
  assert.deepEqual(ligne.quetes.map((q) => q.params.seuil).slice(0, 3), [100, 80, 50]);
  assert.equal(ligne.reserve[0].seuil, 100);
  await arreter();
  await demarrer();
  for (const u of ['pomelo', 'cerise', 'figue']) await reconnecter(u);
  const e2 = await etat('pomelo');
  assert.deepEqual(e2.quetes.filter((q) => /^ind-[1-5]$/.test(q.id)).map((q) => [q.id, q.titre, q.fait]), e.quetes.filter((q) => /^ind-[1-5]$/.test(q.id)).map((q) => [q.id, q.titre, q.fait]));
  assert.equal(await solde('pomelo'), avant + 25, 'rien de repayé');
  // L'admin ne peut plus poser une cible au-delà du maximum d'une partie.
  const refus = await post('/api/admin/quetes/perso', { mesure: 'minifever-arcade2', niveau: 'difficile', seuil: '124' }, ADMIN);
  assert.equal(refus.error, 'hors_plafond', JSON.stringify(refus));
  // Et il voit les cibles des niveaux et le plafond de chaque mesure.
  const A = await adminEtat();
  const ligneMf = A.paliers.mesures.find((x) => x.cle === 'minifever-arcade2');
  assert.deepEqual(ligneMf.plafond, { texte: '100 épreuves', source: 'max' });
  assert.deepEqual(A.reglages.paliers.parts, { facile: 0.55, moyenne: 0.25, difficile: 0.125 });
  const R = (await post('/api/admin/quetes', { paliers: { parts: { difficile: 0.1 } } }, ADMIN)).reglages;
  assert.deepEqual(R.paliers.parts, { facile: 0.55, moyenne: 0.25, difficile: 0.1 });
  assert.ok((await post('/api/admin/quetes', { paliers: { parts: { difficile: 0.125 } } }, ADMIN)).ok);
});

test('l’admin retouche les quêtes d’un joueur une à une : un seuil, le gain, le titre ; en retire, en ajoute', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const joueur = async (u) => (await fetch(BASE + '/api/admin/quetes/joueur?u=' + u, { headers: ADMIN })).json();
  const agir = (qui, corps) => post('/api/admin/quetes/joueur', Object.assign({ username: qui }, corps), ADMIN);
  const numero = (id) => Number((/^ind-(\d+)$/.exec(id) || [])[1]) || 0;
  assert.equal((await joueur('personne')).error, 'joueur_inconnu');

  // MIRABELLE, un compte neuf (ses FD de la journée intacts) : l'admin lui ajoute
  // un résultat au seuil et au gain de son choix, avant même qu'elle ouvre son baluchon.
  await compte('mirabelle');
  let d = await joueur('mirabelle');
  assert.ok(d.ok && d.quetes.length >= 1, JSON.stringify(d));
  assert.ok(d.modeles.some((m) => m.cle === 'parc:parc-salons') && d.modeles.some((m) => m.cle === 'mesure:swapou-challenge' && m.seuil));
  const max = d.quetes.reduce((n, q) => Math.max(n, numero(q.id)), 0);
  let r = await agir('mirabelle', { action: 'ajouter', modele: 'mesure:swapou-challenge', valeur: '12 000', gain: '9' });
  assert.ok(r.ok, JSON.stringify(r));
  const neuve = r.quetes.find((q) => numero(q.id) === max + 1);
  assert.ok(neuve, JSON.stringify(r.quetes.map((q) => q.id)));
  assert.deepEqual([neuve.titre, neuve.gain, neuve.reglable, neuve.fait, neuve.retouchee], [`Dépasse ${Q.nombre(12000)} points à Swapou`, 9, 'seuil', false, true]);
  assert.equal((await agir('mirabelle', { action: 'ajouter', modele: 'mesure:swapou-challenge', valeur: 'beaucoup' })).error, 'seuil_illisible');
  assert.equal((await agir('mirabelle', { action: 'ajouter', modele: 'truc:machin' })).error, 'modele_inconnu');
  await swapou('mirabelle', 11500);
  await wait(500);
  let e = await etat('mirabelle');
  assert.ok(quete(e, neuve.id) && !quete(e, neuve.id).fait && quete(e, neuve.id).pc > 0, 'en cours, pas faite : 11 500 < 12 000 — ' + JSON.stringify(quete(e, neuve.id)));
  const avant = await solde('mirabelle');

  // Retouchée : le seuil descend sous son score du jour, le gain et le titre changent — et c'est payé tout de suite.
  r = await agir('mirabelle', { action: 'modifier', id: neuve.id, valeur: '11000', gain: '11', titre: 'Dépasse {seuil} à Swapou, dit Gromelin' });
  assert.ok(r.ok, JSON.stringify(r));
  const retouchee = r.quetes.find((q) => q.id === neuve.id);
  assert.deepEqual([retouchee.titre, retouchee.gain, retouchee.valeur, retouchee.fait], [`Dépasse ${Q.nombre(11000)} points à Swapou, dit Gromelin`, 11, 11000, true]);
  assert.equal(await soldeVaut('mirabelle', avant + 11), avant + 11, 'payée au nouveau gain');
  e = await etat('mirabelle');
  assert.deepEqual([quete(e, neuve.id).fait, quete(e, neuve.id).gain, quete(e, neuve.id).titre], [true, 11, `Dépasse ${Q.nombre(11000)} points à Swapou, dit Gromelin`]);
  // Faite : plus de retouche.
  assert.equal((await agir('mirabelle', { action: 'modifier', id: neuve.id, gain: '50' })).error, 'deja_faite');
  assert.equal((await agir('mirabelle', { action: 'modifier', id: 'ind-999', gain: '50' })).error, 'quete_inconnue');

  // CERISE : une quête retirée part de sa liste, son avancement avec.
  d = await joueur('cerise');
  const sortante = d.quetes.find((q) => !q.fait);
  assert.ok(sortante, 'une quête pas faite à retirer');
  r = await agir('cerise', { action: 'retirer', id: sortante.id });
  assert.ok(r.ok && !r.quetes.some((q) => q.id === sortante.id), JSON.stringify(r));
  assert.ok(!quete(await etat('cerise'), sortante.id));
  assert.equal((await sql(`SELECT 1 FROM quetes_progres WHERE username = 'cerise' AND semaine = $1 AND quete_id = $2 AND fait_at IS NULL`, [lundiCourant(), sortante.id])).length, 0);
  assert.equal((await agir('cerise', { action: 'retirer', id: sortante.id })).error, 'quete_inconnue');

  // La vie du parc et les premiers pas s'ajoutent aussi ; un compte se règle ; un premier pas une seule fois.
  const gains = (await adminEtat()).reglages.paliers.gains;
  r = await agir('cerise', { action: 'ajouter', modele: 'parc:parc-salons' });
  const salons = r.quetes.find((q) => q.titre === 'Papote dans les salons : quinze messages');
  assert.ok(salons && salons.gain === gains.bronze && salons.reglable === 'n' && salons.valeur === 15, JSON.stringify(r.quetes));
  r = await agir('cerise', { action: 'modifier', id: salons.id, valeur: '5', titre: 'Papote dans les salons : cinq messages', gain: '' });
  assert.ok(r.ok, JSON.stringify(r));
  const s2 = r.quetes.find((q) => q.id === salons.id);
  assert.deepEqual([s2.valeur, s2.titre, s2.gain], [5, 'Papote dans les salons : cinq messages', gains.bronze]);
  r = await agir('cerise', { action: 'ajouter', modele: 'pas:pas-forum', gain: '7' });
  assert.ok(r.ok && r.quetes.some((q) => q.id === 'pas-forum' && q.gain === 7), JSON.stringify(r));
  assert.equal((await agir('cerise', { action: 'ajouter', modele: 'pas:pas-forum' })).error, 'deja_la');

  // Redémarrage : tout tient.
  await arreter();
  await demarrer();
  await reconnecter('cerise');
  await reconnecter('mirabelle');
  e = await etat('cerise');
  assert.ok(!quete(e, sortante.id) && quete(e, 'pas-forum'), JSON.stringify(e.quetes.map((q) => q.id)));
  assert.equal(quete(e, salons.id).titre, 'Papote dans les salons : cinq messages');
  const ligne = (await sql(`SELECT quetes FROM quetes_individuelles WHERE username = 'cerise' AND semaine = $1`, [lundiCourant()]))[0];
  assert.deepEqual(ligne.quetes.map((q) => q.id).sort(), e.quetes.map((q) => q.id).sort());
  e = await etat('mirabelle');
  assert.deepEqual([quete(e, neuve.id).fait, quete(e, neuve.id).gain], [true, 11]);
});

/*
 * Un client de salon (la WebSocket du chat), pour mettre quelqu'un au salon
 * des animations et l'y faire papoter.
 */
const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
async function salon(pseudo) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const trames = [];
  let tampon = '';
  ws.on('message', (d) => {
    tampon += d.toString('utf8');
    const bouts = tampon.split('\0');
    tampon = bouts.pop();
    for (const b of bouts) if (b.trim()) trames.push(b.trim());
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sids[pseudo]}" lc="1" />\0`);
  const c = {
    trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    attendre: async (pred, quoi, ms = 6000) => {
      for (let i = 0; i < ms / 50; i++) { const t = trames.find(pred); if (t) return t; await wait(50); }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 900)}`);
    },
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d’identification');
  c.envoyer('<o g="pomme" />');
  await c.attendre((t) => t.startsWith('<p') && t.includes('g="pomme"'), 'liste du salon');
  return c;
}

test('Gromelin passe au salon des animations : il nomme un présent, lui confie une bricole, une par jour, qui se paie comme les autres', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.ok((await post('/api/admin/quetes', { ouverture: 'tous', mode: 'individuelles' }, ADMIN)).ok);
  await compte('coing');
  const avant = await etat('coing');
  const n0 = avant.quetes.length;
  const coing = await salon('coing');
  try {
    // Personne d'autre au salon : c'est coing qui reçoit la bricole (forcée par l'admin : papoter).
    const r = await post('/api/admin/quetes/gromelin', { cle: 'grom-salons' }, ADMIN);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.cible, 'coing');
    assert.deepEqual([r.quete.id, r.quete.titre], ['grom-1', 'Papote dans les salons : cinq messages']);
    // Au salon : Gromelin entre, et la ligne qui nomme coing s'adresse à lui (mn=), son onglet clignote.
    await coing.attendre((x) => x.startsWith('<v') && /u="Gromelin"/i.test(x) && x.includes('g="pomme"'), 'l’arrivée de Gromelin');
    const ligne = await coing.attendre((x) => x.startsWith('<t') && /u="Gromelin"/.test(x) && x.includes('Oui, toi'), 'Gromelin qui le nomme', 12000);
    assert.match(ligne, /mn="coing"/, 'la ligne s’adresse à coing : ' + ligne);
    await coing.attendre((x) => x.startsWith('<t') && x.includes('Papote dans les salons'), 'la bricole dite au salon', 12000);
    // La ligne d'historique, poussée en direct.
    const aw = await coing.attendre((x) => x.startsWith('<aw') && x.includes('bricole'), 'la ligne d’historique');
    assert.match(aw, /type="72"/);
    assert.match(aw, /« Papote dans les salons : cinq messages »/);
    // La fenêtre des quêtes : la bricole en plus, marquée, pas encore faite, et Gromelin en parle.
    let e = await etat('coing');
    assert.equal(e.quetes.length, n0 + 1);
    const b = quete(e, 'grom-1');
    assert.ok(b && b.gromelin && !b.fait && b.ligne === '0 / 5' && b.palier === 'bronze', JSON.stringify(b));
    assert.match(b.detail, /^Une bricole de Gromelin/);
    assert.ok(e.messages.some((m) => /bricole/.test(m) && /Papote dans les salons/.test(m)), JSON.stringify(e.messages));
    assert.ok(e.nouveau, 'la fenêtre a du neuf');
    assert.ok(!e.quetes.some((q) => q.id === 'grom-2'));
    // Une seule par jour : le second passage ne confie rien.
    const r2 = await post('/api/admin/quetes/gromelin', { username: 'coing', cle: 'grom-forum' }, ADMIN);
    assert.ok(r2.ok && r2.cible === 'coing' && r2.quete === null, JSON.stringify(r2));
    assert.equal((await etat('coing')).quetes.length, n0 + 1);
    // En base : la liste individuelle porte la bricole.
    const ligneBase = (await sql(`SELECT quetes FROM quetes_individuelles WHERE username = 'coing' AND semaine = $1`, [lundiCourant()]))[0];
    assert.ok(ligneBase.quetes.some((q) => q.id === 'grom-1' && q.gromelin && q.gromelin.cle === 'grom-salons'), JSON.stringify(ligneBase.quetes.map((q) => q.id)));
    // Elle se fait en papotant : cinq messages, et Gromelin paie.
    const solde0 = await solde('coing');
    for (let i = 1; i <= 5; i++) { coing.envoyer(`<t g="pomme" t="m" p="">message ${i}</t>`); await wait(120); }
    assert.equal(await soldeVaut('coing', solde0 + b.gain), solde0 + b.gain, 'la bricole payée');
    e = await etat('coing');
    assert.ok(quete(e, 'grom-1').fait);
    // Personne au salon : Gromelin ne confie rien (et le dit à l'admin).
    coing.fermer();
    await wait(600);
    const r3 = await post('/api/admin/quetes/gromelin', {}, ADMIN);
    assert.equal(r3.ok, false);
    assert.equal(r3.error, 'personne');
  } finally { coing.fermer(); }
});

test('Kaluga : le record d’une épreuve, jugé par le serveur d’après la fruticard qu’il garde', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Le jeu peut n'avoir en main qu'une carte vide (il dit alors « pas de
  // record ») : le serveur, lui, garde la vraie — 500 cm au lancer de vers.
  assert.ok((await post('/api/admin/quetes', { ouverture: 'tous', mode: 'individuelles' }, ADMIN)).ok);
  const ajouterVers = async (qui) => {
    await etat(qui);
    const r = await post('/api/admin/quetes/joueur', { username: qui, action: 'ajouter', modele: 'parc:exploit-vers' }, ADMIN);
    assert.ok(r.ok, JSON.stringify(r));
    return (await etat(qui)).quetes.find((q) => /lancer de vers/.test(q.titre));
  };
  const carteKaluga = (qui, max) => fetch(BASE + '/api/saveFrutiSlot', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sid: sids[qui], game: 'kaluga', slotId: '0', data: JSON.stringify({ $trial: { $st: 1, $tria: { $s: 0 }, $hept: { $s: 0 },
      $list: [{ $list: [], $tz: [], $max: max }] } }) }) });
  // 1. À la déclaration : 612 cm, le jeu dit « pas de record », le serveur voit 500 sur la carte.
  await compte('nefle');
  assert.ok((await carteKaluga('nefle', 500)).ok);
  const q1 = await ajouterVers('nefle');
  assert.ok(q1 && !q1.fait, JSON.stringify(q1));
  const r1 = await declarer('nefle', 'kaluga', 'epreuve0', 612, false);
  assert.ok(r1.ok && r1.record, JSON.stringify(r1));
  assert.ok((await etat('nefle')).quetes.find((q) => q.id === q1.id).fait, 'record battu : la quête est faite');
  // 2. À la sauvegarde de la carte (le jeu n'a rien déclaré, ou trop tard) : 500 → 640.
  await compte('sorbe');
  assert.ok((await carteKaluga('sorbe', 500)).ok);
  const q2 = await ajouterVers('sorbe');
  assert.ok((await carteKaluga('sorbe', 640)).ok);
  await wait(300);
  assert.ok((await etat('sorbe')).quetes.find((q) => q.id === q2.id).fait, 'le $max qui monte sur la carte suffit');
  // 3. Pas de record : moins bien que la carte, ou un premier record contre une carte vide.
  await compte('alise');
  assert.ok((await carteKaluga('alise', 500)).ok);
  const q3 = await ajouterVers('alise');
  await wait(1600);
  assert.equal((await declarer('alise', 'kaluga', 'epreuve0', 480, false)).record, false);
  assert.ok((await carteKaluga('alise', 500)).ok);
  assert.ok(!(await etat('alise')).quetes.find((q) => q.id === q3.id).fait);
  await compte('cormier');
  assert.ok((await carteKaluga('cormier', 0)).ok);
  const q4 = await ajouterVers('cormier');
  assert.equal((await declarer('cormier', 'kaluga', 'epreuve0', 300, false)).record, false, 'un premier lancer ne bat aucun record');
  assert.ok((await carteKaluga('cormier', 300)).ok);
  await wait(300);
  assert.ok(!(await etat('cormier')).quetes.find((q) => q.id === q4.id).fait);
});

test('Kaluga : un ver retombé derrière la ligne n’est pas une faute de dépassement', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/kaluga/jeu/modes.js'), 'utf8');
  assert.match(src, /this\.loose\(this\.flValidate === false \? 'Vous avez dépassé la ligne de lancé !' : 'Votre ver n’a pas franchi la ligne de lancer !'\);/);
});

test('RGPD : l’export du joueur contient ses quêtes', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const D = require(path.join(ROOT, 'db.js'));
  assert.ok(D.RENOMMAGE_COLONNES.some(([tb, c]) => tb === 'quetes_progres' && c === 'username'));
  assert.ok(D.RENOMMAGE_COLONNES.some(([tb, c]) => tb === 'quetes_visites' && c === 'username'));
  assert.ok(D.RENOMMAGE_COLONNES.some(([tb, c]) => tb === 'quetes_contrats' && c === 'username'));
  assert.ok(D.RENOMMAGE_COLONNES.some(([tb, c]) => tb === 'quetes_individuelles' && c === 'username'));
  assert.ok(D.RENOMMAGE_COLONNES.some(([tb, c]) => tb === 'quetes_primes' && c === 'username'));
  assert.match(fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8'), /quetes_contrats: await q\('SELECT semaine, propositions, choix, signe_at FROM quetes_contrats WHERE username = \$1/);
  const SRC = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(SRC, /quetes: await q\('SELECT semaine, quete_id, etat, fait_at, gain FROM quetes_progres WHERE username = \$1/);
  assert.match(SRC, /\['quetes_progres', 'username', 'brut'\],\n\s+\['quetes_visites', 'username', 'brut'\]/);
});
