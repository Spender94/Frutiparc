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

test('la cote d’un habitué : fréquence lissée, au centième inférieur — 10 % de marge en médaillé, 5 % en or', () => {
  const as = C.cotesDuJeu(historique()).joueurs.as;
  assert.deepEqual([as.joues, as.podiums, as.ors, as.eligible], [30, 12, 6, true]);
  // podium : (12 + 5 × 0,3) / (30 + 5) = 0,3857… → 0,9 / 0,3857 = 2,333…
  assert.equal(as.podium.cote, 2.33);
  // or : (6 + 5 × 0,1) / 35 = 0,1857… → 0,95 / 0,1857 = 5,115…
  assert.equal(as.or.cote, 5.11);
});

test('les bornes : médaillé de ×1,1 à ×10, or de ×1,65 à ×15', () => {
  const h = historique();
  // « roi » : tous les jours en or. « fantome » : tous les jours, jamais rien.
  for (const jour of JOURS) {
    h.joues.push({ username: 'roi', jour }, { username: 'fantome', jour });
    h.medailles.push({ username: 'roi', jour, rang: 1 });
  }
  const r = C.cotesDuJeu(h).joueurs;
  assert.equal(r.roi.podium.cote, 1.1);
  assert.equal(r.roi.or.cote, 1.65);
  assert.equal(r.fantome.podium.cote, 10);
  assert.equal(r.fantome.or.cote, 15);
});

test('l’or paie toujours au moins 1,5 fois le médaillé', () => {
  const h = historique();
  // « second » : toujours deuxième — jamais d'or, mais un podium sûr.
  for (const jour of JOURS) {
    h.joues.push({ username: 'second', jour });
    h.medailles.push({ username: 'second', jour, rang: 2 });
  }
  const r = C.cotesDuJeu(h).joueurs;
  for (const u of Object.keys(r)) {
    if (!r[u].eligible) continue;
    assert.ok(r[u].or.cote >= Math.min(15, Math.floor(r[u].podium.cote * 1.5 * 100 + 1e-9) / 100), u);
    assert.ok(r[u].or.cote > r[u].podium.cote, u);
  }
  assert.equal(r.second.podium.cote, 1.1);
  assert.equal(r.second.or.cote, 15, 'jamais d’or en 30 jours : la cote plafond');
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
  assert.equal(mi.podium.cote, C.coteDe(attendu, 'podium'));
});

test('moins de 7 jours joués : la cote de découverte, jamais plus que ses quelques jours', () => {
  const h = historique();
  for (const jour of JOURS.slice(0, 6)) h.joues.push({ username: 'nouveau', jour });
  for (const jour of JOURS.slice(0, 7)) h.joues.push({ username: 'sept', jour });
  // « flash » : 5 jours, 5 médailles d'or.
  for (const jour of JOURS.slice(0, 5)) {
    h.joues.push({ username: 'flash', jour });
    h.medailles.push({ username: 'flash', jour, rang: 1 });
  }
  const r = C.cotesDuJeu(h);
  const d = r.decouverte;
  // Le joueur moyen : base 90 podiums / 311 participations… la cote suit le taux de base.
  assert.equal(d.podium, C.coteDe(r.base.podium, 'podium'));
  assert.ok(d.or >= Math.floor(d.podium * 1.5 * 100 + 1e-9) / 100);
  assert.equal(r.joueurs.nouveau.eligible, false);
  assert.deepEqual([r.joueurs.nouveau.podium.cote, r.joueurs.nouveau.or.cote], [d.podium, d.or], 'rien gagné : la découverte');
  assert.ok(r.joueurs.flash.or.cote < d.or, 'cinq ors en cinq jours : moins que la découverte');
  assert.ok(r.joueurs.flash.podium.cote < d.podium);
  assert.equal(r.joueurs.sept.eligible, true);
  // Un inconnu du jeu : la découverte ; un joueur peu venu : la sienne.
  assert.deepEqual(C.coteDuJoueur(r, 'Personne', 'or'), { cote: d.or, decouverte: true });
  assert.deepEqual(C.coteDuJoueur(r, 'flash', 'or'), { cote: r.joueurs.flash.or.cote, decouverte: true });
  assert.deepEqual(C.coteDuJoueur(r, 'as', 'podium'), { cote: 2.33, decouverte: false });
});

test('un jeu trop peu joué : découverte par défaut, ×3 et ×5', () => {
  const r = C.cotesDuJeu({ joues: [{ username: 'a', jour: '2026-09-01' }], medailles: [] });
  assert.deepEqual(r.decouverte, { podium: 3, or: 5 });
  assert.deepEqual(C.cotesDuJeu({ joues: [], medailles: [] }).decouverte, { podium: 3, or: 5 });
  assert.deepEqual(C.coteDuJoueur(null, 'x', 'podium'), { cote: 3, decouverte: true });
});

test('une médaille sans score archivé vaut un jour joué', () => {
  const r = C.cotesDuJeu({ joues: [], medailles: [{ username: 'x', jour: '2026-09-01', rang: 1 }] });
  assert.equal(r.jours, 1);
  assert.deepEqual([r.joueurs.x.joues, r.joueurs.x.podiums, r.joueurs.x.ors], [1, 1, 1]);
  assert.equal(r.joueurs.x.eligible, false);
});

test('sur soi : ×3 au plus en médaillé, ×4,5 en or', () => {
  assert.equal(C.coteProposee(4.84, true, 'podium'), 3);
  assert.equal(C.coteProposee(4.84, false, 'podium'), 4.84);
  assert.equal(C.coteProposee(2.33, true, 'podium'), 2.33);
  assert.equal(C.coteProposee(12, true, 'or'), 4.5);
  assert.equal(C.coteProposee(4.2, true, 'or'), 4.2);
  assert.equal(C.coteProposee(null, true, 'or'), null);
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

// ── LE DÉFI MÉDAILLE (cotesDefi) : sur soi, plus la couleur est haute, plus ça paie ──
test('le défi médaille : trois cotes croissantes, bornées, tirées de mes jours joués', () => {
  const r = C.cotesDuJeu(historique());
  assert.equal(r.participations, 300);
  assert.ok(Math.abs(r.base.argent - 0.2) < 1e-9, 'deux médailles sur dix (or et argent) chaque jour');
  assert.equal(r.joueurs.as.argents, 12, 'six ors et six argents');
  const as = C.cotesDefi(r, 'As');
  const D = C.REGLES.defi;
  // Le podium : (12 + 5 × 0,3) / (30 + 5) ; pas de facteur de présence.
  const pBronze = (12 + 5 * 0.3) / 35;
  assert.equal(as.bronze, Math.floor((0.85 / pBronze) * 100) / 100);
  assert.deepEqual([as.joues, as.podiums, as.argents, as.ors, as.decouverte], [30, 12, 12, 6, false]);
  for (const x of [as, C.cotesDefi(r, 'b'), C.cotesDefi(r, 'inconnu')]) {
    assert.ok(x.bronze >= D.bronze.min && x.bronze <= D.bronze.max);
    assert.ok(x.or <= D.or.max);
    assert.ok(x.argent >= Math.min(D.argent.max, Math.floor(x.bronze * D.ecart * 100) / 100), 'l’argent paie au moins 1,05 × le bronze');
    assert.ok(x.or >= Math.min(D.or.max, Math.floor(x.argent * D.ecart * 100) / 100), 'l’or paie au moins 1,05 × l’argent');
    assert.ok(x.bronze < x.argent && x.argent <= x.or, JSON.stringify(x));
  }
  // Un inconnu du jeu : la chance d'un joueur moyen (le taux de base).
  const inconnu = C.cotesDefi(r, 'inconnu');
  assert.equal(inconnu.decouverte, true);
  assert.equal(inconnu.bronze, Math.floor((0.85 / 0.3) * 100) / 100);
  // L'inconnu (rien gagné ici) paie plus cher que le grand habitué.
  assert.ok(inconnu.or > as.or && inconnu.bronze > as.bronze, JSON.stringify([inconnu, as]));
});

test('le défi médaille : pas de défi sur un jeu trop peu joué, et un champion ne gagne pas d’avance', () => {
  // Trois jours, deux joueurs : on y serait presque seul, la médaille serait donnée.
  const maigre = C.cotesDuJeu({ joues: [{ username: 'a', jour: '2026-09-01' }, { username: 'b', jour: '2026-09-02' }], medailles: [] });
  assert.equal(C.cotesDefi(maigre, 'a'), null);
  assert.equal(C.cotesDefi(null, 'a'), null);
  // Le champion : l'or tous les jours. Ses cotes touchent les planchers bas :
  // son gain moyen ne dépasse pas sa mise (p ≈ 0,87 pour l'or, × 1,15 ≈ 1).
  const joues = [], medailles = [];
  JOURS.forEach((jour) => {
    for (const u of ['champion'].concat(AUTRES)) joues.push({ username: u, jour });
    ['champion', 'b', 'c'].forEach((u, i) => medailles.push({ username: u, jour, rang: i + 1 }));
  });
  const ch = C.cotesDefi(C.cotesDuJeu({ joues, medailles }), 'champion');
  assert.deepEqual([ch.bronze, ch.argent, ch.or], [C.REGLES.defi.bronze.min, C.REGLES.defi.argent.min, C.REGLES.defi.or.min]);
  assert.ok(((30 + 5 * 0.1) / 35) * ch.or <= 1.01, 'pas de gain moyen au-dessus de la mise');
});
