'use strict';
/*
 * LA SECTION « COMMUNAUTÉ » DES STATISTIQUES — le calcul (statsCommunaute.js),
 * sur des lignes construites à la main : chaque indicateur, et la règle qui
 * les tient tous — ce qu'on n'a pas relevé ne se compte pas.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../statsCommunaute.js');

const AUJ = '2026-10-24';                 // un samedi
const j = (n) => S.plus(AUJ, n);          // j(-1) = hier
const fenetre = (n) => Array.from({ length: n }, (_, i) => j(i - n + 1));

function base(extra) {
  return Object.assign({
    aujourdhui: AUJ, jours: fenetre(30), premierJour: j(-200),
    presence: [], inscrits: [], forum: [], activite: [], premiereActivite: null,
    parties: [], actives: [], pnj: new Set(['gromelin']),
    jeuDe: (rk) => ({ swapou2_classic: 'swapou2', bkiwi_track3_challenge: 'bkiwi' })[rk] || null,
  }, extra);
}
const presents = (u, ...decalages) => decalages.map((n) => ({ jour: j(n), u }));

test('la rétention : revenu dans sa semaine de retour, cohortes finies seulement', () => {
  // Quatre inscrits il y a 20 jours (dans la cohorte J+7 du haut : de j-41 à j-14).
  const inscrits = ['ana', 'bob', 'cid', 'dan'].map((u) => ({ u, jour: j(-20) }));
  const presence = [
    ...presents('ana', -20, -13),        // J+7 : revenu au 7e jour
    ...presents('bob', -20, -8),         // J+12 : dans la semaine
    ...presents('cid', -20, -19),        // le lendemain seulement : pas un retour à J+7
    ...presents('dan', -20, -5),         // J+15 : trop tard pour J+7
  ];
  const c = S.calculer(base({ inscrits, presence }));
  assert.deepStrictEqual([c.retention.j7.inscrits, c.retention.j7.revenus, c.retention.j7.taux], [4, 2, 50]);
  assert.deepStrictEqual([c.retention.j7.du, c.retention.j7.au], [j(-41), j(-14)]);
  // J+30 : il faut un inscrit d'au moins 37 jours ; les nôtres sont trop jeunes.
  assert.strictEqual(c.retention.j30.inscrits, 0);
  // La semaine d'inscription de nos quatre : J+7 mesuré, J+30 pas encore.
  const sem = c.retention.semaines.find((w) => w.lundi === S.lundiDe(j(-20)));
  assert.strictEqual(sem.inscrits, 4);
  assert.strictEqual(sem.j7.taux, 50);
  assert.strictEqual(sem.j30, null, 'le mois de retour n’est pas fini');
  // La semaine en cours : rien de mesurable.
  assert.strictEqual(c.retention.semaines[11].j7, null);
});

test('la rétention ne se mesure pas avant les relevés de présence', () => {
  const c = S.calculer(base({ premierJour: j(-10), inscrits: [{ u: 'ana', jour: j(-20) }], presence: presents('ana', -5) }));
  assert.strictEqual(c.retention.j7, null, 'la cohorte précède presence_jour');
  assert.strictEqual(c.retention.j30, null);
});

test('nouveaux et anciens : l’âge du compte au dernier jour vu', () => {
  const inscrits = [
    { u: 'neuf', jour: j(-3) }, { u: 'mois', jour: j(-90) },
    { u: 'an', jour: j(-300) }, { u: 'vieux', jour: '2005-06-01' },
  ];
  const presence = [...presents('neuf', -1), ...presents('mois', -2), ...presents('an', 0), ...presents('vieux', -6),
    ...presents('inconnu', -1), ...presents('gromelin', 0)];
  const c = S.calculer(base({ inscrits, presence }));
  assert.deepStrictEqual(c.anciennete.tranches.map((t) => t.n), [1, 1, 1, 1]);
  assert.strictEqual(c.anciennete.inconnus, 1);
  assert.strictEqual(c.anciennete.total, 5, 'les PNJ ne comptent pas');
  assert.deepStrictEqual([c.jours[j(-1)].nouveaux, c.jours[j(-1)].anciens], [1, 1]);
});

test('les jours actifs : répartition sur 7 et 30 jours, les habitués', () => {
  const presence = [
    ...presents('fidele', 0, -1, -2, -3, -4, -5, -6, -10, -20),
    ...presents('passant', -15),
    ...presents('hebdo', -2, -9, -16, -23),
  ];
  const c = S.calculer(base({ presence }));
  const ja = c.joursActifs;
  assert.deepStrictEqual([ja.s7.joueurs, ja.s7.moyenne, ja.s7.mediane], [2, 4, 4]);
  assert.deepStrictEqual(ja.repartition7.map((x) => x.n), [1, 0, 0, 0, 0, 0, 1]);
  assert.deepStrictEqual(ja.repartition30.map((x) => [x.jours, x.n]),
    [['1', 1], ['2–3', 0], ['4–7', 1], ['8–14', 1], ['15–22', 0], ['23–30', 0]]);
  assert.deepStrictEqual(ja.habitues.map((h) => [h.u, h.j30, h.j7]), [['fidele', 9, 7], ['hebdo', 4, 1], ['passant', 1, 0]]);
  assert.strictEqual(ja.s30.complet, true);
  assert.strictEqual(S.calculer(base({ presence, premierJour: j(-12) })).joursActifs.s30.complet, false);
});

test('les joueurs différents d’un jeu : relevé par joueur, archive et records réunis', () => {
  const parties = [
    { jour: j(0), u: 'ana', jeu: 'swapou2' }, { jour: j(-1), u: 'ana', jeu: 'swapou2' },
    { jour: j(-3), u: 'bob', rk: 'swapou2_classic' },          // un record amélioré
    { jour: j(-12), u: 'cid', rk: 'swapou2_classic' },         // hors des 7 jours
    { jour: j(-40), u: 'dan', jeu: 'swapou2' },                // hors de la fenêtre
    { jour: j(-2), u: 'ana', rk: 'bkiwi_track3_challenge' },   // l'archive du Challenge
    { jour: j(-2), u: 'gromelin', jeu: 'swapou2' },
    { jour: j(-2), u: 'eve', rk: 'inconnu_classic' },
  ];
  const c = S.calculer(base({ parties }));
  assert.deepStrictEqual(c.joueursParJeu, { swapou2: { semaine: 2, fenetre: 3 }, bkiwi: { semaine: 1, fenetre: 1 } });
});

test('le temps actif et les sessions, les participants au chat et au forum', () => {
  const activite = [
    { jour: j(0), u: 'ana', minutes: 40, sessions: 2, chat: 3 },
    { jour: j(-1), u: 'ana', minutes: 20, sessions: 1, chat: 0 },
    { jour: j(-10), u: 'bob', minutes: 30, sessions: 1, chat: 1 },
    { jour: j(-2), u: 'cid', minutes: 0, sessions: 0, chat: 2 },     // a parlé sans minute active relevée
  ];
  const forum = [{ jour: j(-1), u: 'ana' }, { jour: j(-20), u: 'dan' }, { jour: j(-40), u: 'eve' }];
  const c = S.calculer(base({ activite, forum, premiereActivite: j(-15) }));
  assert.deepStrictEqual([c.sessions.joueurs, c.sessions.heures, c.sessions.minutesParJour, c.sessions.dureeSession], [2, 1.5, 30, 22.5]);
  assert.strictEqual(c.jours[j(0)].minutesParJoueur, 40);
  assert.deepStrictEqual(c.participants.chat, { semaine: 2, fenetre: 3, depuis: j(-15) });
  assert.deepStrictEqual(c.participants.forum, { semaine: 1, fenetre: 2 });
  assert.deepStrictEqual(c.participants.ensemble, { semaine: 2, fenetre: 4 }, 'ana écrit aux deux : comptée une fois');
});

test('l’activation : les inscrits de la période qui ont fait quelque chose', () => {
  const inscrits = [{ u: 'ana', jour: j(-2) }, { u: 'bob', jour: j(-5) }, { u: 'cid', jour: j(-29) }, { u: 'dan', jour: j(-60) }];
  const c = S.calculer(base({ inscrits, actives: ['ana', 'cid', 'dan'] }));
  assert.deepStrictEqual(c.activation, { inscrits: 3, actives: 2, taux: 66.7 });
});

test('les retours : absent 14 ou 30 jours, inscrit avant, absence relevée', () => {
  const inscrits = [
    { u: 'revenant', jour: j(-100) }, { u: 'fidele', jour: j(-100) },
    { u: 'nouveau', jour: j(-5) }, { u: 'lointain', jour: j(-100) },
  ];
  const presence = [
    ...presents('revenant', -40, -3),      // 36 jours sans venir : retour à 14 et à 30
    ...presents('fidele', -59, -52, -45, -38, -31, -24, -17, -10, -3),   // chaque semaine : jamais absent
    ...presents('nouveau', -5, -3),        // inscrit pendant « l'absence » : pas un retour
    ...presents('lointain', -1),           // jamais vu avant, inscrit il y a 100 jours : retour
  ];
  const c = S.calculer(base({ inscrits, presence }));
  assert.deepStrictEqual([c.reactives.j14, c.reactives.j30], [2, 2]);
  assert.deepStrictEqual(c.reactives.derniers.map((r) => [r.u, r.absence]), [['lointain', null], ['revenant', 36]]);
  assert.strictEqual(c.reactives.derniers[0].auMoins, 199, 'absent depuis au moins le début des relevés');
  assert.strictEqual(c.jours[j(-3)].reactives, 1);
  // Des relevés trop jeunes : une absence de 14 jours ne se voit pas.
  const court = S.calculer(base({ inscrits, presence, premierJour: j(-8) }));
  assert.deepStrictEqual([court.reactives.j14, court.reactives.j30], [0, 0]);
  assert.strictEqual(court.jours[j(-3)].reactives, null, '« – » plutôt que zéro');
});

test('un jour sans personne de relevé reste « – »', () => {
  const c = S.calculer(base({ presence: presents('ana', -1) }));
  assert.strictEqual(c.jours[j(-2)].nouveaux, null);
  assert.strictEqual(c.jours[j(-1)].anciens, 1);
});

test('l’onglet de l’admin : son script se compile (deux déclarations du même nom le cassaient tout entier)', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public/admin.html'), 'utf8');
  const blocs = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  assert.ok(blocs.length);
  for (const b of blocs) assert.doesNotThrow(() => new vm.Script(b.replace(/^<script>|<\/script>$/g, '')));
  assert.match(html, /function statsCommunaute\(c, erreur\)/);
  assert.match(html, /statsCommunaute\(d\.communaute, d\.erreurCommunaute\);/);
});
