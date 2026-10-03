'use strict';
/*
 * LES PARTIES EN DIFFÉRÉ — le cycle de vie (differe.js), sans base ni jeu.
 * Un faux moteur suffit : l'état est un compteur, le tour alterne.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { Differe, DELAI_COUP, RAPPEL_AVANT } = require('../differe.js');

const JOUR = 24 * 3600 * 1000;

function monte(opts) {
  const sauves = [], supprimes = [], notifs = [], fins = [];
  let horloge = 1000;
  const d = new Differe(Object.assign({
    jeu: 'test', clock: () => horloge,
    moteur: { nouveau: () => ({ n: 0 }), tourDe: () => 0 },
    identite: (u) => ({ name: u.toUpperCase(), fb: 'fb-' + u }),
    existe: (u) => u !== 'inconnu',
    onSauver: (p) => sauves.push(JSON.parse(JSON.stringify(p))),
    onSupprimer: (id) => supprimes.push(id),
    onNotifier: (n) => notifs.push({ type: n.type, vers: n.vers, de: n.de, id: n.partie.id }),
    onFin: (p) => fins.push(p.id),
  }, opts || {}));
  return { d, sauves, supprimes, notifs, fins, avancer: (ms) => { horloge += ms; return horloge; }, maintenant: () => horloge };
}

test('inviter : garde-fous, persistance, notification de l’invité', () => {
  const m = monte();
  assert.equal(m.d.inviter('alice', 'alice', 'amical').error, 'self-challenge');
  assert.equal(m.d.inviter('alice', 'inconnu', 'amical').error, 'unknown-player');
  assert.equal(m.d.inviter('alice', 'bob', 'chall').error, 'bad-room', 'pas de différé au Challenge');
  const r = m.d.inviter('Alice', 'Bob', 'champ', { boardSize: 4 });
  assert.ok(r.ok);
  assert.deepEqual(r.partie.joueurs, ['alice', 'bob']);
  assert.deepEqual(r.partie.noms, ['ALICE', 'BOB']);
  assert.equal(r.partie.statut, 'invitation');
  assert.equal(r.partie.echeance, 1000 + DELAI_COUP);
  assert.equal(m.sauves.length, 1);
  assert.deepEqual(m.notifs, [{ type: 'invitation', vers: 'bob', de: 'alice', id: r.partie.id }]);
  assert.equal(m.d.inviter('bob', 'alice', 'champ').error, 'already-playing', 'une seule partie à la fois entre deux joueurs par salle');
  assert.ok(m.d.inviter('bob', 'alice', 'amical').ok, '…mais une autre dans l’autre salle');
});

test('trop de parties en cours : refus', () => {
  const m = monte({ maxEnCours: 2 });
  assert.ok(m.d.inviter('alice', 'bob', 'amical').ok);
  assert.ok(m.d.inviter('alice', 'carl', 'amical').ok);
  assert.equal(m.d.inviter('alice', 'dora', 'amical').error, 'too-many-games');
  assert.equal(m.d.inviter('dora', 'alice', 'amical').error, 'target-busy');
});

test('accepter / refuser : qui peut, ce qui en sort', () => {
  const m = monte({ moteur: { nouveau: () => ({ n: 0 }), tourDe: () => 1 } });
  const p = m.d.inviter('alice', 'bob', 'amical').partie;
  assert.equal(m.d.accepter('alice', p.id).error, 'not-invited', 'l’hôte n’accepte pas à la place de l’invité');
  assert.equal(m.d.accepter('bob', 'nimportequoi').error, 'no-such-challenge');
  m.avancer(JOUR);
  const a = m.d.accepter('bob', p.id);
  assert.ok(a.ok);
  assert.equal(p.statut, 'en_cours');
  assert.deepEqual(p.etat, { n: 0 });
  assert.equal(p.tour, 1, 'le moteur dit qui ouvre');
  assert.equal(p.echeance, m.maintenant() + DELAI_COUP, 'trois jours pour le premier coup');
  assert.equal(m.notifs[1].type, 'acceptee');
  assert.equal(m.notifs[1].vers, 'alice');
  // refus d'une autre invitation
  const q = m.d.inviter('carl', 'alice', 'champ').partie;
  assert.ok(m.d.refuser('alice', q.id).ok);
  assert.equal(m.d.partie(q.id), null);
  assert.deepEqual(m.supprimes, [q.id]);
  assert.equal(m.notifs.pop().type, 'refus');
  // l'hôte retire la sienne : pas de notification
  const s = m.d.inviter('alice', 'carl', 'champ').partie;
  const avant = m.notifs.length;
  assert.ok(m.d.refuser('alice', s.id).ok);
  assert.equal(m.notifs.length, avant);
});

test('un coup : le tour passe, l’échéance repart, l’adversaire est prévenu', () => {
  const m = monte();
  const p = m.d.inviter('alice', 'bob', 'amical').partie;
  m.d.accepter('bob', p.id);
  assert.equal(m.d.coupAutorise('bob', p.id).error, 'not-your-turn');
  assert.equal(m.d.coupAutorise('zoe', p.id).error, 'not-a-player');
  const c = m.d.coupAutorise('alice', p.id);
  assert.ok(c.ok); assert.equal(c.team, 0);
  m.avancer(2 * JOUR);
  const r = m.d.apresCoup(p.id, { n: 1 }, { tour: 1, fini: false });
  assert.ok(r.ok);
  assert.equal(p.tour, 1);
  assert.equal(p.coups, 1);
  assert.deepEqual(p.etat, { n: 1 });
  assert.equal(p.echeance, m.maintenant() + DELAI_COUP);
  const n = m.notifs.pop();
  assert.deepEqual(n, { type: 'tour', vers: 'bob', de: 'alice', id: p.id });
  // un coup qui conclut : l'adversaire apprend la fin, pas l'acteur
  m.d.apresCoup(p.id, { n: 2 }, { fini: true, gagnant: 1, raison: 'connection' });
  assert.equal(p.statut, 'finie');
  assert.equal(p.gagnant, 1);
  assert.equal(p.raison, 'connection');
  assert.deepEqual(m.fins, [p.id]);
  assert.deepEqual(m.notifs.pop(), { type: 'fin', vers: 'alice', de: 'bob', id: p.id });
  assert.equal(m.d.coupAutorise('alice', p.id).error, 'game-ended');
});

test('trois jours sans jouer : forfait du joueur au trait, les deux prévenus', () => {
  const m = monte();
  const p = m.d.inviter('alice', 'bob', 'champ').partie;
  m.d.accepter('bob', p.id);
  m.avancer(DELAI_COUP - RAPPEL_AVANT + 1);
  assert.deepEqual(m.d.tick(), [], 'le rappel ne change pas la liste');
  assert.equal(m.notifs.pop().type, 'rappel');
  assert.equal(p.rappele, true);
  assert.deepEqual(m.d.tick(), []);
  assert.equal(m.notifs[m.notifs.length - 1].type, 'acceptee', 'un seul rappel');
  m.avancer(RAPPEL_AVANT);
  const touches = m.d.tick();
  assert.deepEqual(touches.sort(), ['alice', 'bob']);
  assert.equal(p.statut, 'finie');
  assert.equal(p.gagnant, 1, 'alice devait jouer : bob gagne');
  assert.equal(p.raison, 'delai');
  const deux = m.notifs.slice(-2);
  assert.deepEqual(deux.map((n) => n.type), ['delai', 'delai']);
  assert.deepEqual(deux.map((n) => n.vers).sort(), ['alice', 'bob']);
  assert.deepEqual(m.fins, [p.id]);
});

test('jouer après l’échéance, c’est déjà perdu', () => {
  const m = monte();
  const p = m.d.inviter('alice', 'bob', 'amical').partie;
  m.d.accepter('bob', p.id);
  m.avancer(DELAI_COUP);
  const c = m.d.coupAutorise('alice', p.id);
  assert.equal(c.error, 'delai');
  assert.equal(c.partie.statut, 'finie');
  assert.equal(c.partie.gagnant, 1);
});

test('abandon, invitation sans réponse, oubli des parties finies', () => {
  const m = monte();
  const p = m.d.inviter('alice', 'bob', 'amical').partie;
  m.d.accepter('bob', p.id);
  assert.equal(m.d.abandonner('zoe', p.id).error, 'not-a-player');
  assert.ok(m.d.abandonner('bob', p.id).ok);
  assert.equal(p.gagnant, 0);
  assert.equal(p.raison, 'forfeit');
  assert.deepEqual(m.notifs.pop(), { type: 'fin', vers: 'alice', de: 'bob', id: p.id });
  const q = m.d.inviter('alice', 'carl', 'amical').partie;
  m.avancer(DELAI_COUP);
  m.d.tick();
  assert.equal(m.d.partie(q.id), null, 'l’invitation s’est éteinte');
  assert.equal(m.notifs.pop().type, 'expiree');
  assert.ok(m.d.partie(p.id), 'la partie finie reste lisible…');
  m.avancer(7 * JOUR);
  m.d.tick();
  assert.equal(m.d.partie(p.id), null, '…une semaine');
  assert.ok(m.supprimes.indexOf(p.id) >= 0);
});

test('la liste XML d’un joueur : à lui de jouer d’abord, les attributs utiles', () => {
  const m = monte({ ids: (() => { let i = 0; return () => 'p' + (++i); })() });
  const p1 = m.d.inviter('alice', 'bob', 'amical').partie;   // p1 : bob doit répondre
  const p2 = m.d.inviter('carl', 'bob', 'champ').partie;     // p2 : carl → bob
  m.d.accepter('bob', p2.id);                                 // carl ouvre
  m.d.apresCoup(p2.id, { n: 1 }, { tour: 1 });                // à bob
  m.d.inviter('bob', 'dora', 'amical');                       // p3 : dora doit répondre
  const xml = m.d.xmlListe('bob', 'gz');
  assert.match(xml, /^<gz e="dlist" n="3" max="10" delai="259200000">/);
  const ids = Array.from(xml.matchAll(/<d id="(p\d)"/g)).map((x) => x[1]);
  assert.deepEqual(ids, ['p1', 'p2', 'p3'], 'invitation à répondre, puis à moi de jouer, puis le reste');
  assert.match(xml, /<d id="p2" sa="champ" st="en_cours" a="carl" b="bob" na="CARL" nb="BOB" fa="fb-carl" fb="fb-bob" moi="1" tour="1" ech="259200000" coups="1" maj="0"\/>/);
  assert.equal(m.d.xmlListe('zoe', 'bd'), '<bd e="dlist" n="0" max="10" delai="259200000"></bd>');
  m.d.abandonner('bob', p2.id);
  assert.match(m.d.xmlListe('carl', 'bd'), /st="finie"[^>]* w="0" r="forfeit"/);
});

test('charger : les parties de la base reviennent, et le balayage les reprend', () => {
  const m = monte();
  const p = m.d.inviter('alice', 'bob', 'amical').partie;
  m.d.accepter('bob', p.id);
  const copie = JSON.parse(JSON.stringify(m.sauves[m.sauves.length - 1]));
  const m2 = monte();
  assert.equal(m2.d.charger([copie]), 1);
  m2.avancer(DELAI_COUP + 5);
  m2.d.tick();
  assert.equal(m2.d.partie(p.id).statut, 'finie');
  assert.equal(m2.d.partie(p.id).raison, 'delai');
});

test('action : le dispatch des attributs du client', () => {
  const m = monte();
  const r = m.d.action('alice', { a: 'dinvite', u: 'bob', sa: 'champ' }, undefined, { boardSize: 8 });
  assert.ok(r.ok);
  assert.deepEqual(r.touches, ['alice', 'bob']);
  assert.deepEqual(r.partie.params, { boardSize: 8 });
  assert.equal(m.d.action('bob', { a: 'daccept', id: r.partie.id }).ok, true);
  assert.equal(m.d.action('bob', { a: 'dpart', id: r.partie.id }).ok, true);
  assert.equal(m.d.action('bob', { a: 'dfoo' }).error, 'unknown-action');
});
