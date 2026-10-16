//
// Burning Kiwi MULTI — le pont des courses en ligne, à blanc.
//   node --test public/bkiwi/server/net.test.js
//
// Horloge injectée : chaque scénario se rejoue à l'identique.
//
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BkiwiNet, DELAI_CHARGEMENT, DELAI_ARRIVEE, DELAI_DEPART } = require('./net.js');

function monde() {
  let t = 1000000;
  const departs = [], fins = [];
  const net = new BkiwiNet({ clock: () => t, onDepart: (l) => departs.push(l.slice()), onFin: (l) => fins.push(l.slice()) });
  return { net, departs, fins, avancer: (ms) => { t += ms; }, maintenant: () => t };
}
const xmlDe = (msgs, e) => msgs.map((m) => m.xml).filter((x) => x.indexOf('<kw e="' + e + '"') === 0);
const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml); return m ? m[1] : null; };
const pour = (msgs, u, e) => msgs.filter((m) => m.to.includes(u) && (!e || m.xml.indexOf('<kw e="' + e + '"') === 0));

test('le hub : qui est là, quels salons ; créer, rejoindre, quitter', () => {
  const { net } = monde();
  let out = net.handle('ana', { a: 'hello', n: 'Ana', f: 'FB1' });
  assert.ok(xmlDe(out, 'hub')[0].includes('<j u="ana" n="Ana" f="FB1"/>'));
  net.handle('bob', { a: 'hello', n: 'Bob' });
  out = net.handle('ana', { a: 'creer', p: '2' });
  const salon = xmlDe(out, 'salon')[0];
  assert.ok(salon, 'le salon est dit à son hôte');
  assert.strictEqual(attr(salon, 'h'), 'ana');
  assert.strictEqual(attr(salon, 'p'), '2');
  assert.strictEqual(attr(salon, 'et'), 'attente');
  const hub = xmlDe(out, 'hub')[0];
  assert.ok(hub.includes('<s i="s1" h="Ana" p="2" n="1" e="attente"/>'), hub);
  assert.ok(!hub.includes('<j u="ana"'), 'Ana n’est plus dans la liste des pilotes libres');
  assert.strictEqual(xmlDe(net.handle('ana', { a: 'creer' }), 'err').length, 1, 'déjà en salon');
  // Bob rejoint ; le salon est dit aux deux.
  assert.strictEqual(attr(xmlDe(net.handle('bob', { a: 'rejoindre', s: 'zz' }), 'err')[0], 'm'), 'salon-inconnu');
  out = net.handle('bob', { a: 'rejoindre', s: 's1' });
  const s2 = pour(out, 'bob', 'salon')[0];
  assert.deepStrictEqual(s2.to.sort(), ['ana', 'bob']);
  assert.ok(s2.xml.includes('<j u="bob"') && s2.xml.includes('i="1"'), 'Bob a la deuxième place de la grille');
  assert.strictEqual(attr(xmlDe(net.handle('bob', { a: 'rejoindre', s: 's1' }), 'err')[0], 'm'), 'deja-en-salon');
  // La piste : l'hôte seul ; la voiture : chacun la sienne.
  assert.strictEqual(attr(xmlDe(net.handle('bob', { a: 'piste', p: '4' }), 'err')[0], 'm'), 'pas-l-hote');
  assert.strictEqual(attr(xmlDe(net.handle('ana', { a: 'piste', p: '4' }), 'salon')[0], 'p'), '4');
  assert.strictEqual(attr(xmlDe(net.handle('ana', { a: 'piste', p: '9' }), 'salon')[0], 'p'), '4', 'une piste hors du jeu est ignorée');
  out = net.handle('bob', { a: 'voiture', c: '5' });
  assert.ok(xmlDe(out, 'salon')[0].includes('<j u="bob" n="Bob" f="" c="5"'), 'la X Violet');
  // Ana quitte : Bob devient l'hôte ; Bob quitte : le salon disparaît.
  out = net.handle('ana', { a: 'quitter' });
  assert.strictEqual(attr(pour(out, 'bob', 'salon')[0].xml, 'h'), 'bob');
  assert.ok(xmlDe(out, 'hub')[0].includes('<j u="ana"'), 'Ana est de retour parmi les pilotes libres');
  out = net.handle('bob', { a: 'quitter' });
  assert.ok(!xmlDe(out, 'hub')[0].includes('<s i='), 'plus de salon');
  assert.deepStrictEqual(Object.keys(net.salons), []);
});

test('quatre places, pas une de plus ; on ne rejoint pas une course lancée', () => {
  const { net } = monde();
  for (const u of ['a', 'b', 'c', 'd', 'e']) net.handle(u, { a: 'hello', n: u.toUpperCase() });
  net.handle('a', { a: 'creer' });
  for (const u of ['b', 'c', 'd']) assert.strictEqual(xmlDe(net.handle(u, { a: 'rejoindre', s: 's1' }), 'err').length, 0);
  assert.strictEqual(attr(xmlDe(net.handle('e', { a: 'rejoindre', s: 's1' }), 'err')[0], 'm'), 'salon-plein');
  for (const u of ['b', 'c', 'd']) net.handle(u, { a: 'pret' });
  net.handle('d', { a: 'quitter' });
  assert.strictEqual(xmlDe(net.handle('a', { a: 'lancer' }), 'depart').length, 1);
  assert.strictEqual(attr(xmlDe(net.handle('e', { a: 'rejoindre', s: 's1' }), 'err')[0], 'm'), 'course-en-cours');
});

test('le départ : l’hôte lance quand les autres sont prêts, chacun charge, et le go part à la même heure pour tous', () => {
  const { net, departs, avancer, maintenant } = monde();
  net.handle('ana', { a: 'hello', n: 'Ana' });
  net.handle('bob', { a: 'hello', n: 'Bob' });
  net.handle('ana', { a: 'creer', p: '0' });
  assert.strictEqual(attr(xmlDe(net.handle('ana', { a: 'lancer' }), 'err')[0], 'm'), 'seul');
  net.handle('bob', { a: 'rejoindre', s: 's1' });
  assert.strictEqual(attr(xmlDe(net.handle('ana', { a: 'lancer' }), 'err')[0], 'm'), 'pas-prets');
  assert.strictEqual(attr(xmlDe(net.handle('bob', { a: 'lancer' }), 'err')[0], 'm'), 'pas-l-hote');
  net.handle('bob', { a: 'pret', r: '1' });
  let out = net.handle('ana', { a: 'lancer' });
  const depart = xmlDe(out, 'depart')[0];
  assert.ok(depart && depart.includes('<j u="ana"') && depart.includes('<j u="bob"'));
  assert.strictEqual(attr(depart, 'p'), '0');
  assert.deepStrictEqual(departs, [['ana', 'bob']], 'le voyant du parc');
  assert.ok(xmlDe(out, 'hub')[0].includes('e="chargement"'));
  // Ana a chargé, pas Bob : on attend.
  assert.deepStrictEqual(net.handle('ana', { a: 'charge' }), []);
  avancer(500);
  out = net.handle('bob', { a: 'charge' });
  const go = xmlDe(out, 'go')[0];
  assert.ok(go, 'tous ont chargé : go');
  assert.deepStrictEqual(out[0].to.sort(), ['ana', 'bob']);
  assert.strictEqual(Number(attr(go, 'at')), maintenant() + DELAI_DEPART, 'l’heure du départ, celle du serveur');
  assert.strictEqual(net.salons.s1.etat, 'course');
  // Rejouer « charge » en course ne fait rien.
  assert.deepStrictEqual(net.handle('ana', { a: 'charge' }), []);
});

test('un pilote qui ne charge pas : le départ part sans lui au bout du délai', () => {
  const { net, avancer, maintenant } = monde();
  net.handle('ana', { a: 'hello' }); net.handle('bob', { a: 'hello' });
  net.handle('ana', { a: 'creer' }); net.handle('bob', { a: 'rejoindre', s: 's1' }); net.handle('bob', { a: 'pret' });
  net.handle('ana', { a: 'lancer' });
  net.handle('ana', { a: 'charge' });
  avancer(DELAI_CHARGEMENT - 1);
  assert.deepStrictEqual(net.tick(maintenant()), []);
  avancer(1);
  assert.strictEqual(xmlDe(net.tick(maintenant()), 'go').length, 1);
});

test('les positions sont relayées aux autres, jamais au serveur ni à soi', () => {
  const { net } = monde();
  for (const u of ['a', 'b', 'c']) net.handle(u, { a: 'hello' });
  net.handle('a', { a: 'creer' }); net.handle('b', { a: 'rejoindre', s: 's1' }); net.handle('c', { a: 'rejoindre', s: 's1' });
  assert.deepStrictEqual(net.handle('a', { a: 'pos', x: '1', y: '2' }), [], 'pas en course : rien');
  net.handle('b', { a: 'pret' }); net.handle('c', { a: 'pret' }); net.handle('a', { a: 'lancer' });
  for (const u of ['a', 'b', 'c']) net.handle(u, { a: 'charge' });
  const out = net.handle('a', { a: 'pos', x: '414.5', y: '670', r: '-70', v: '12.3', n: '1', l: '0', c: '3', k: '3' });
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].to.sort(), ['b', 'c']);
  assert.strictEqual(out[0].xml, '<kw e="pos" u="a" x="414.5" y="670" r="-70" v="12.3" n="1" l="0" c="3" k="3"/>');
  // Le ping porte l'heure du serveur : le client en déduit l'heure du go.
  const pong = net.handle('a', { a: 'ping', t: '12345' })[0].xml;
  assert.strictEqual(attr(pong, 't'), '12345');
  assert.strictEqual(attr(pong, 'st'), String(net.clock()));
});

test('l’arrivée : classement au temps, résultat quand tous sont là, puis le salon est prêt pour la revanche', () => {
  const { net, fins } = monde();
  for (const u of ['a', 'b', 'c']) net.handle(u, { a: 'hello', n: u.toUpperCase() });
  net.handle('a', { a: 'creer' }); net.handle('b', { a: 'rejoindre', s: 's1' }); net.handle('c', { a: 'rejoindre', s: 's1' });
  net.handle('c', { a: 'voiture', c: '5' });
  net.handle('b', { a: 'pret' }); net.handle('c', { a: 'pret' }); net.handle('a', { a: 'lancer' });
  for (const u of ['a', 'b', 'c']) net.handle(u, { a: 'charge' });
  // B arrive le premier chez le serveur, mais A, arrivé après, a le meilleur temps.
  let out = net.handle('b', { a: 'fin', t: '65000' });
  let arr = xmlDe(out, 'arrivee')[0];
  assert.strictEqual(attr(arr, 'u'), 'b');
  assert.ok(arr.includes('<a u="b" n="B" c="0" t="65000" g="1"/>'));
  assert.ok(arr.includes('<a u="a" n="A" c="0" t="0" g="0"/>'), 'A et C pas encore arrivés : sans temps, sans rang');
  assert.strictEqual(xmlDe(out, 'resultat').length, 0);
  out = net.handle('a', { a: 'fin', t: '64500' });
  arr = xmlDe(out, 'arrivee')[0];
  assert.ok(arr.includes('<a u="a" n="A" c="0" t="64500" g="1"/><a u="b" n="B" c="0" t="65000" g="2"/>'), arr);
  assert.strictEqual(net.joueurs.b.rang, 2, 'B recule d’une place');
  assert.deepStrictEqual(net.handle('a', { a: 'fin', t: '1' }), [], 'on n’arrive qu’une fois');
  assert.strictEqual(attr(xmlDe(net.handle('c', { a: 'fin', t: 'abc' }), 'err')[0], 'm'), 'temps-invalide');
  out = net.handle('c', { a: 'fin', t: '70000' });
  const res = xmlDe(out, 'resultat')[0];
  assert.ok(res, 'tous arrivés : le résultat');
  assert.ok(res.includes('<a u="a" n="A" c="0" t="64500" g="1"/><a u="b" n="B" c="0" t="65000" g="2"/><a u="c" n="C" c="5" t="70000" g="3"/>'), res);
  assert.deepStrictEqual(fins, [['a', 'b', 'c']]);
  // Le salon est de nouveau en attente, personne n'est prêt, les temps sont oubliés.
  const salon = xmlDe(out, 'salon')[0];
  assert.strictEqual(attr(salon, 'et'), 'attente');
  assert.ok(!salon.includes(' t=') && !salon.includes('r="1"'), salon);
  assert.ok(xmlDe(out, 'hub')[0].includes('e="attente"'));
  assert.strictEqual(attr(xmlDe(net.handle('a', { a: 'lancer' }), 'err')[0], 'm'), 'pas-prets', 'la revanche attend que chacun se dise prêt');
});

test('abandon et déconnexion en course : la course continue, le résultat se ferme sans eux, et le délai après le premier arrivé', () => {
  const { net, avancer, maintenant } = monde();
  for (const u of ['a', 'b', 'c']) net.handle(u, { a: 'hello', n: u.toUpperCase() });
  net.handle('a', { a: 'creer' }); net.handle('b', { a: 'rejoindre', s: 's1' }); net.handle('c', { a: 'rejoindre', s: 's1' });
  net.handle('b', { a: 'pret' }); net.handle('c', { a: 'pret' }); net.handle('a', { a: 'lancer' });
  for (const u of ['a', 'b', 'c']) net.handle(u, { a: 'charge' });
  // L'hôte abandonne : les autres l'apprennent, B devient l'hôte, la course continue.
  let out = net.handle('a', { a: 'quitter' });
  assert.ok(pour(out, 'b', 'quitte')[0] && attr(pour(out, 'b', 'quitte')[0].xml, 'u') === 'a');
  assert.strictEqual(net.salons.s1.hote, 'b');
  assert.strictEqual(net.salons.s1.etat, 'course');
  assert.strictEqual(net.joueurs.a.salon, null);
  // C se déconnecte avant d'arriver.
  out = net.onDisconnect('c');
  assert.ok(pour(out, 'b', 'quitte').length === 1);
  assert.strictEqual(net.joueurs.c, undefined);
  // B arrive : seul resté, la course se ferme aussitôt — classement à un.
  out = net.handle('b', { a: 'fin', t: '80000' });
  const res = xmlDe(out, 'resultat')[0];
  assert.ok(res && res.includes('<a u="b" n="B" c="0" t="80000" g="1"/>') && !res.includes('u="a"'), res);
  // Une autre course : le premier arrivé ouvre le délai, le traînard est classé sans temps.
  net.handle('a', { a: 'hello' }); net.handle('a', { a: 'rejoindre', s: 's1' }); net.handle('a', { a: 'pret' });
  net.handle('b', { a: 'lancer' });
  net.handle('a', { a: 'charge' }); net.handle('b', { a: 'charge' });
  net.handle('b', { a: 'fin', t: '50000' });
  avancer(DELAI_ARRIVEE - 1);
  assert.deepStrictEqual(net.tick(maintenant()), []);
  avancer(1);
  out = net.tick(maintenant());
  const res2 = xmlDe(out, 'resultat')[0];
  assert.ok(res2 && res2.includes('<a u="b" n="B" c="0" t="50000" g="1"/><a u="a" n="A" c="0" t="0" g="0"/>'), res2);
  assert.strictEqual(net.salons.s1.etat, 'attente');
});

test('l’abandon : on reste dans le salon, classé sans temps, et la course se ferme quand tous ont fini ou renoncé', () => {
  const { net } = monde();
  for (const u of ['a', 'b', 'c']) net.handle(u, { a: 'hello', n: u.toUpperCase() });
  net.handle('a', { a: 'creer' }); net.handle('b', { a: 'rejoindre', s: 's1' }); net.handle('c', { a: 'rejoindre', s: 's1' });
  net.handle('b', { a: 'pret' }); net.handle('c', { a: 'pret' }); net.handle('a', { a: 'lancer' });
  for (const u of ['a', 'b', 'c']) net.handle(u, { a: 'charge' });
  let out = net.handle('c', { a: 'abandon' });
  assert.ok(pour(out, 'a', 'abandon')[0] && attr(pour(out, 'a', 'abandon')[0].xml, 'u') === 'c', 'les autres l’apprennent');
  assert.strictEqual(net.joueurs.c.salon, 's1', 'C reste dans le salon');
  assert.deepStrictEqual(net.handle('c', { a: 'fin', t: '1000' }), [], 'un abandon ne finit pas');
  net.handle('a', { a: 'fin', t: '60000' });
  out = net.handle('b', { a: 'fin', t: '61000' });
  const res = xmlDe(out, 'resultat')[0];
  assert.ok(res && res.includes('<a u="a" n="A" c="0" t="60000" g="1"/><a u="b" n="B" c="0" t="61000" g="2"/><a u="c" n="C" c="0" t="0" g="0"/>'), res);
});

test('le salon se vide pendant une course : il disparaît', () => {
  const { net } = monde();
  net.handle('a', { a: 'hello' }); net.handle('b', { a: 'hello' });
  net.handle('a', { a: 'creer' }); net.handle('b', { a: 'rejoindre', s: 's1' }); net.handle('b', { a: 'pret' });
  net.handle('a', { a: 'lancer' });
  net.onDisconnect('a');
  net.onDisconnect('b');
  assert.deepStrictEqual(Object.keys(net.salons), []);
  assert.deepStrictEqual(net.enCourse(), []);
});
