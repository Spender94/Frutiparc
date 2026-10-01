'use strict';
/*
 * LES COTES DU CHALLENGE — la règle pure (coteChallenge.js) : de l'historique
 * d'un jeu à la cote de chacun, et le règlement à cote fixe.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../coteChallenge.js');

// Trente jours, dix joueurs venus tous les jours. « as » monte douze fois sur
// le podium, dont six fois en or ; les autres se partagent le reste.
const JOURS = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
const AUTRES = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
function historique() {
  const joues = [], medailles = [];
  let k = 0;
  const autre = () => AUTRES[(k++) % AUTRES.length];
  JOURS.forEach((jour, i) => {
    for (const u of ['as'].concat(AUTRES)) joues.push({ username: u, jour });
    const podium = i < 6 ? ['as', autre(), autre()] : i < 12 ? [autre(), 'as', autre()] : [autre(), autre(), autre()];
    podium.forEach((u, r) => medailles.push({ username: u, jour, rang: r + 1 }));
  });
  return { joues, medailles };
}

test('le taux de base du jeu : ses médailles sur ses participations', () => {
  const r = C.cotesDuJeu(historique());
  assert.equal(r.jours, 30);
  assert.ok(Math.abs(r.base.podium - 0.3) < 1e-9);
  assert.ok(Math.abs(r.base.or - 0.1) < 1e-9);
});

test('la cote d’un habitué : fréquence lissée, marge de 10 %, au centième inférieur', () => {
  const as = C.cotesDuJeu(historique()).joueurs.as;
  assert.deepEqual([as.joues, as.podiums, as.ors, as.eligible], [30, 12, 6, true]);
  // podium : (12 + 5 × 0,3) / (30 + 5) = 0,3857… → 0,9 / 0,3857 = 2,333…
  assert.equal(as.podium.cote, 2.33);
  // or : (6 + 5 × 0,1) / 35 = 0,1857… → 4,846…
  assert.equal(as.or.cote, 4.84);
});

test('les bornes : ×1,1 au moins, ×10 au plus', () => {
  const h = historique();
  // « roi » : tous les jours en or. « fantome » : tous les jours, jamais rien.
  for (const jour of JOURS) {
    h.joues.push({ username: 'roi', jour }, { username: 'fantome', jour });
    h.medailles.push({ username: 'roi', jour, rang: 1 });
  }
  const r = C.cotesDuJeu(h).joueurs;
  assert.equal(r.roi.podium.cote, 1.1);
  assert.equal(r.roi.or.cote, 1.1);
  assert.equal(r.fantome.podium.cote, 10);
  assert.equal(r.fantome.or.cote, 10);
});

test('un jour d’absence compte comme un jour sans podium', () => {
  const h = { joues: [], medailles: [] };
  JOURS.forEach((jour, i) => {
    for (const u of AUTRES) h.joues.push({ username: u, jour });
    if (i % 2 === 0) h.joues.push({ username: 'mi', jour });        // un jour sur deux
  });
  // « mi » : 6 podiums sur ses 15 jours.
  for (const i of [0, 2, 4, 6, 8, 10]) h.medailles.push({ username: 'mi', jour: JOURS[i], rang: 2 });
  const r = C.cotesDuJeu(h);
  const mi = r.joueurs.mi;
  assert.equal(mi.joues, 15);
  assert.equal(mi.podiums, 6);
  const attendu = (15 / 30) * (6 + 5 * r.base.podium) / (15 + 5);
  assert.ok(Math.abs(mi.podium.p - attendu) < 1e-12);
  assert.equal(mi.podium.cote, C.coteDe(attendu));
});

test('moins de 7 jours joués : pas de cote', () => {
  const h = historique();
  for (const jour of JOURS.slice(0, 6)) h.joues.push({ username: 'nouveau', jour });
  for (const jour of JOURS.slice(0, 7)) h.joues.push({ username: 'sept', jour });
  const r = C.cotesDuJeu(h).joueurs;
  assert.equal(r.nouveau.eligible, false);
  assert.equal(r.nouveau.podium.cote, null);
  assert.equal(r.nouveau.or.cote, null);
  assert.equal(r.sept.eligible, true);
  assert.ok(r.sept.podium.cote > 1);
});

test('une médaille sans score archivé vaut un jour joué', () => {
  const r = C.cotesDuJeu({ joues: [], medailles: [{ username: 'x', jour: '2026-09-01', rang: 1 }] });
  assert.equal(r.jours, 1);
  assert.deepEqual([r.joueurs.x.joues, r.joueurs.x.podiums, r.joueurs.x.ors], [1, 1, 1]);
  assert.equal(r.joueurs.x.eligible, false);
});

test('sur soi : ×3 au plus', () => {
  assert.equal(C.coteProposee(4.84, true), 3);
  assert.equal(C.coteProposee(4.84, false), 4.84);
  assert.equal(C.coteProposee(2.33, true), 2.33);
  assert.equal(C.coteProposee(null, true), null);
});

test('le retour d’une mise : mise × cote, au kikooz inférieur', () => {
  assert.equal(C.retourDe(10, 2.33), 23);
  assert.equal(C.retourDe(100, 1.1), 110);
  assert.equal(C.retourDe(7, 2.3), 16);
  assert.equal(C.retourDe(50, 10), 500);
  assert.equal(C.retourDe(3, 1.1), 3);
});

test('le règlement : le gagnant reçoit son retour, le perdant rien ; pas de médaillé, tout revient', () => {
  const paris = [
    { id: 1, username: 'p1', choix: 'As', mise: 10, retour: 23 },
    { id: 2, username: 'p2', choix: 'b', mise: 20, retour: 60 },
  ];
  assert.deepEqual(C.reglerCotes(paris, ['as', 'c', 'd']), [
    { id: 1, username: 'p1', statut: 'gagne', gain: 23 },
    { id: 2, username: 'p2', statut: 'perdu', gain: 0 },
  ]);
  assert.deepEqual(C.reglerCotes(paris, []).map((d) => [d.statut, d.gain]), [['rembourse', 10], ['rembourse', 20]]);
});
