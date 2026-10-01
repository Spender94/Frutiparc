'use strict';
/*
 * LES PARIS DES TOURNOIS — la règle du pari mutuel (paris.js)
 *
 * Ce que le module promet, et que ce fichier vérifie :
 *   · le pot entier va à ceux qui ont vu juste, au prorata de leurs mises ;
 *   · jusqu'au dernier kikooz : la somme des gains est la somme des mises ;
 *   · personne n'a vu juste → chacun récupère sa mise ;
 *   · les refus : son propre match, l'autre camp, le plafond, le solde, un
 *     match fermé ou dont les joueurs ne sont pas connus.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const P = require(path.join(__dirname, '..', 'paris.js'));

const pari = (id, username, choix, mise) => ({ id, username, choix, mise });

test('le pot va aux gagnants, au prorata de leurs mises', () => {
  const r = P.regler([
    pari(1, 'ana', 'bob', 30),
    pari(2, 'cid', 'bob', 10),
    pari(3, 'dan', 'eve', 60),
  ], 'bob');
  const par = Object.fromEntries(r.map((x) => [x.username, x]));
  assert.deepEqual([par.ana.statut, par.cid.statut, par.dan.statut], ['gagne', 'gagne', 'perdu']);
  assert.equal(par.ana.gain, 75);       // 30 × 100 / 40
  assert.equal(par.cid.gain, 25);       // 10 × 100 / 40
  assert.equal(par.dan.gain, 0);
});

test('jusqu’au dernier kikooz : la somme des gains est la somme des mises', () => {
  // Des parts qui ne tombent pas juste, sur mille tirages.
  let graine = 7;
  const alea = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
  for (let k = 0; k < 1000; k++) {
    const n = 1 + Math.floor(alea() * 12);
    const liste = [];
    for (let i = 0; i < n; i++) liste.push(pari(i, 'u' + i, alea() < 0.5 ? 'a' : 'b', 1 + Math.floor(alea() * 100)));
    const pot = liste.reduce((s, p) => s + p.mise, 0);
    const r = P.regler(liste, alea() < 0.5 ? 'a' : 'b');
    assert.equal(r.reduce((s, x) => s + x.gain, 0), pot, 'rien de créé, rien de perdu');
    for (const x of r) {
      const p = liste.find((y) => y.id === x.id);
      if (x.statut === 'gagne') assert.ok(x.gain >= p.mise, 'un gagnant récupère au moins sa mise');
      assert.ok(Number.isInteger(x.gain));
    }
  }
});

test('un arrondi : les kikooz qui restent vont aux plus gros restes', () => {
  // Pot de 10, trois gagnants à 1 : 10/3 = 3,33… chacun → 4, 3, 3.
  const r = P.regler([pari(1, 'a', 'x', 1), pari(2, 'b', 'x', 1), pari(3, 'c', 'x', 1), pari(4, 'd', 'y', 7)], 'x');
  assert.deepEqual(r.filter((x) => x.statut === 'gagne').map((x) => x.gain), [4, 3, 3], 'le premier arrivé départage');
});

test('personne n’a vu juste : chacun récupère sa mise ; tout le monde a vu juste : idem', () => {
  const r = P.regler([pari(1, 'a', 'x', 20), pari(2, 'b', 'x', 5)], 'y');
  assert.deepEqual(r.map((x) => [x.statut, x.gain]), [['rembourse', 20], ['rembourse', 5]]);
  const r2 = P.regler([pari(1, 'a', 'x', 20), pari(2, 'b', 'x', 5)], 'x');
  assert.deepEqual(r2.map((x) => [x.statut, x.gain]), [['gagne', 20], ['gagne', 5]]);
  assert.deepEqual(P.regler([], 'x'), []);
});

test('le pot et la cote, côté par côté (la casse des pseudos ne compte pas)', () => {
  const pot = P.pot([pari(1, 'a', 'Bob', 30), pari(2, 'c', 'bob', 10), pari(3, 'd', 'eve', 60)], 'bob', 'Eve');
  assert.equal(pot.total, 100);
  assert.deepEqual(pot.joueurs.bob, { mises: 40, parieurs: 2, cote: 2.5 });
  assert.deepEqual(pot.joueurs.eve, { mises: 60, parieurs: 1, cote: 1.67 });
  assert.equal(P.pot([], 'a', 'b').joueurs.a.cote, null, 'sans mise, pas de cote');
});

test('les refus', () => {
  const t = { id: 1, paris_actifs: true, status: 'bracket', format: 'score', paris_plafond: 100 };
  const m = { id: 9, tournament_id: 1, player1: 'bob', player2: 'eve', status: 'pending', winner: null, paris_fermes: false, score1: null, score2: null };
  const base = { tournoi: t, match: m, parieur: 'ana', choix: 'bob', mise: 50, solde: 500 };
  const code = (extra) => { const r = P.refus(Object.assign({}, base, extra)); return r && r.code; };
  assert.equal(code({}), null, 'un pari normal passe');
  assert.equal(code({ parieur: 'Bob' }), 'soi', 'pas sur son propre match');
  assert.equal(code({ choix: 'zed' }), 'choix');
  assert.equal(code({ choixPrecedent: 'eve' }), 'camp', 'on ne change pas de camp');
  assert.equal(code({ misePrecedente: 60 }), 'plafond', '60 + 50 > 100');
  assert.equal(code({ misePrecedente: 50 }), null, '50 + 50 = 100 : au plafond, ça passe');
  assert.equal(code({ mise: 0 }), 'mise');
  assert.equal(code({ mise: 2.5 }), 'mise');
  assert.equal(code({ solde: 49 }), 'solde');
  assert.equal(code({ tournoi: Object.assign({}, t, { paris_actifs: false }) }), 'fermes', 'option baissée');
  assert.equal(code({ tournoi: Object.assign({}, t, { status: 'qualif' }) }), 'fermes');
  assert.equal(code({ match: Object.assign({}, m, { paris_fermes: true }) }), 'joue');
  assert.equal(code({ match: Object.assign({}, m, { winner: 'bob', status: 'done' }) }), 'joue');
  assert.equal(code({ match: Object.assign({}, m, { player2: null }) }), 'match', 'adversaire inconnu');
  assert.equal(code({ match: Object.assign({}, m, { tournament_id: 2 }) }), 'match');
  // Duel : une manche jouée ferme le match.
  const duel = Object.assign({}, t, { format: 'duel', status: 'poules' });
  assert.equal(code({ tournoi: duel, match: Object.assign({}, m, { score1: 0, score2: 0 }) }), null);
  assert.equal(code({ tournoi: duel, match: Object.assign({}, m, { score1: 1, score2: 0 }) }), 'joue');
  assert.match(P.refus(Object.assign({}, base, { misePrecedente: 80 })).message, /encore ajouter 20/);
});
