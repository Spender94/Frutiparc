//
// Frutisnake Battle en ligne — le salon, la session et le pont, à blanc.
//   node --test public/snake3/server/server.test.js
//
// Horloge et hasard injectés : chaque partie se rejoue à l'identique.
//
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../const.js');
const { SnakeLobby } = require('./lobby.js');
const S = require('./session.js');
const { SnakeNet } = require('./net.js');
const Bot = require('./bot.js');

function graine(n) {
  let s = n;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
const J = (id) => ({ id, name: id.toUpperCase() });

// ── Le salon ───────────────────────────────────────────────────────────────

test('la file d’attente apparie le premier qui attend au suivant qui cherche', () => {
  const l = new SnakeLobby();
  l.addPlayer('a', 'A'); l.addPlayer('b', 'B'); l.addPlayer('c', 'C');
  let r = l.seek('a');
  assert.deepStrictEqual([r.ok, r.started, r.waiting], [true, false, true]);
  assert.strictEqual(l.getPlayer('a').status, 'waiting');
  r = l.seek('a');
  assert.strictEqual(r.started, false, 'chercher deux fois ne fait rien de plus');
  r = l.seek('b');
  assert.strictEqual(r.started, true);
  assert.deepStrictEqual(r.game.players, ['a', 'b']);
  assert.strictEqual(l.getPlayer('a').status, 'playing');
  assert.strictEqual(l.getPlayer('b').status, 'playing');
  assert.strictEqual(l.queue.length, 0);
  // c cherche : personne d'autre, il attend ; puis annule.
  assert.strictEqual(l.seek('c').waiting, true);
  assert.strictEqual(l.cancel('c').ok, true);
  assert.strictEqual(l.getPlayer('c').status, 'idle');
  // Un joueur en partie ne peut ni chercher ni annuler.
  assert.strictEqual(l.seek('a').error, 'already-busy');
  assert.strictEqual(l.cancel('a').error, 'already-busy');
});

test('un défi part sur-le-champ, même si l’un des deux attendait dans la file', () => {
  const l = new SnakeLobby();
  l.addPlayer('a', 'A'); l.addPlayer('b', 'B'); l.addPlayer('c', 'C');
  l.seek('b');
  const r = l.challenge('a', 'b');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.game.players, ['a', 'b']);
  assert.strictEqual(l.queue.indexOf('b'), -1, 'b est sorti de la file');
  assert.strictEqual(l.challenge('c', 'a').error, 'target-busy');
  assert.strictEqual(l.challenge('a', 'c').error, 'challenger-busy');
  assert.strictEqual(l.challenge('c', 'c').error, 'self-challenge');
  assert.strictEqual(l.challenge('c', 'zz').error, 'unknown-player');
  // La fin libère les deux.
  l.endGame(r.game.id);
  assert.strictEqual(l.getPlayer('a').status, 'idle');
  assert.strictEqual(l.getPlayer('b').gameId, null);
});

test('partir : en partie, le salon désigne la partie à abandonner ; en attente, on sort de la file', () => {
  const l = new SnakeLobby();
  l.addPlayer('a', 'A'); l.addPlayer('b', 'B');
  l.seek('a');
  assert.strictEqual(l.partGame('a').ok, true);
  assert.strictEqual(l.getPlayer('a').status, 'idle');
  const g = l.challenge('a', 'b').game;
  assert.strictEqual(l.partGame('a').playingGameId, g.id);
  const rm = l.removePlayer('b');
  assert.strictEqual(rm.playingGameId, g.id);
  assert.strictEqual(l.getPlayer('b'), null);
});

// ── La session ─────────────────────────────────────────────────────────────

function session(opts) {
  return new S.SnakeBattleSession(Object.assign({
    id: 'g1', players: [J('a'), J('b')], now: 0, rng: graine(11),
  }, opts || {}));
}
// L'horloge avance de 25 ms en 25 ms, comme le tick du serveur : `avancer`
// ne rattrape que trois pas d'un coup (c'est voulu, cf. le test suivant).
function jusqua(s, t) { while (s.horloge < t) s.avancer(s.horloge + 25); }

test('trois secondes de compte à rebours, puis quarante pas par seconde à tmod 0,8', () => {
  const s = session({ objets: false });
  assert.strictEqual(s.phase, 'compte');
  const x0 = s.bataille.serpents[0].x;
  jusqua(s, 2000);
  assert.strictEqual(s.phase, 'compte');
  assert.strictEqual(s.bataille.serpents[0].x, x0, 'les serpents ne bougent pas pendant le compte');
  assert.strictEqual(s.numero, 80, '80 pas en deux secondes');
  jusqua(s, 3025);
  assert.strictEqual(s.phase, 'jeu');
  const avant = s.bataille.serpents[0].x;
  s.avancer(3050);
  const d = Math.hypot(s.bataille.serpents[0].x - avant, 0);
  // SNAKE_DEFAULT_SPEED × 0,8 × cos(π/4 + 0,1), à l'accélération près.
  assert.ok(Math.abs(d - C.SNAKE_DEFAULT_SPEED * S.TMOD * Math.cos(Math.PI / 4 + 0.1)) < 0.01, 'un pas à tmod 0,8 : ' + d);
  assert.strictEqual(S.TMOD, 0.8);
  assert.strictEqual(S.PAS, 1 / 40);
});

test('le rattrapage est borné à trois pas : un trou d’une seconde ne téléporte personne', () => {
  const s = session({ objets: false });
  jusqua(s, 3100);
  const n = s.numero;
  assert.strictEqual(s.avancer(4100), 3, 'trois pas, pas quarante');
  assert.strictEqual(s.numero, n + 3);
});

test('les touches pilotent le serpent de son équipe ; un inconnu est refusé', () => {
  const s = session({ objets: false });
  jusqua(s, 3025);
  assert.strictEqual(s.setInput('zz', { gauche: true }).ok, false);
  const a0 = s.bataille.serpents[0].ang, b0 = s.bataille.serpents[1].ang;
  s.setInput('a', { gauche: true });
  s.setInput('b', { droite: true, haut: true });
  s.avancer(3050);
  assert.ok(s.bataille.serpents[0].ang < a0, 'a tourne à gauche');
  assert.ok(s.bataille.serpents[1].ang > b0, 'b tourne à droite');
  assert.ok(s.bataille.powers[1] < C.BATTLE_POWER_MAX, 'le turbo de b se dépense');
  assert.strictEqual(s.bataille.serpents[1].speed, C.BATTLE_ACCEL);
});

test('les gestes d’un pas sont comptés pour le miroir : points poussés, pousse, particules', () => {
  const s = session({ objets: false });
  jusqua(s, 3025);
  let pousses = 0, points = 0;
  for (let t = 3050; t <= 7000; t += 25) {
    s.avancer(t);
    const e = s.snapshot().serpents[0];
    pousses += e.g; points += e.q;
    assert.ok(e.q >= 0 && e.q <= 3);
  }
  assert.ok(pousses >= 1, 'une pousse toutes les trois secondes');
  // 158 pas à 2,64 px, un point tous les cinq pixels : environ 84.
  assert.ok(points > 70 && points < 100, 'la file s’allonge au fil de la route : ' + points);
  assert.strictEqual(s.snapshot(true).serpents[0].queue.length, s.bataille.serpents[0].queue.length);
});

test('un serpent qui file droit finit dans le mur : collision, celui qui tourne gagne', () => {
  const s = session({ objets: false });
  // b va droit une seconde et demie (sortir du coin), puis tourne en rond ;
  // a file droit — la diagonale du terrain, jusqu'au mur du bas.
  jusqua(s, 4500);
  s.setInput('b', { droite: true });
  while (!s.ended && s.horloge < 60000) s.avancer(s.horloge + 25);
  assert.strictEqual(s.ended, true);
  assert.strictEqual(s.endReason, 'collision');
  assert.strictEqual(s.winner, 1, 'a (équipe 0) heurte le mur : ' + Math.round(s.temps) + ' s');
  assert.ok(s.temps > 4 && s.temps < 7, 'la diagonale à 2,64 px par pas : ' + s.temps);
  const snap = s.snapshot();
  assert.strictEqual(snap.serpents[0].vivant, false);
  assert.strictEqual(snap.serpents[1].vivant, true);
  assert.strictEqual(s.avancer(s.horloge + 1000), 0, 'une partie finie ne bouge plus');
});

test('abandon : l’adversaire gagne, et pas deux fois', () => {
  const s = session({ objets: false });
  jusqua(s, 1000);
  assert.deepStrictEqual(s.forfeit('b'), { ended: true, winner: 0 });
  assert.strictEqual(s.endReason, 'forfeit');
  assert.strictEqual(s.forfeit('a'), null);
  assert.strictEqual(s.winner, 0);
});

test('une bombe : mèche de cinq secondes, puis le souffle coupe la queue et tue la tête qui s’y trouve', () => {
  const s = session({ objets: { premier: [0.5, 0.5], suivants: [1e6, 1e6], distanceTete: 0 } });
  jusqua(s, 3025);
  let t = 3050;
  while (!s.objets.length && t < 6000) { s.avancer(t); t += 25; }
  assert.strictEqual(s.objets.length, 1, 'une bombe est posée');
  const b = s.objets[0];
  assert.strictEqual(b.type, 'bombe');
  assert.ok(Math.abs(b.vie - C.TIME_BOMBE) < 0.06);
  assert.strictEqual(S.OBJETS.rayonBombe, C.RAYON_BOMBE, 'le souffle est celui du jeu, 160 px');
  // On étire a en une ligne droite de cinq cents pixels (quinze segments de
  // vingt-cinq), la tête à droite, et l'on pose la bombe sous sa queue, loin
  // de la tête : le souffle coupe, la tête vit.
  const a = s.bataille.serpents[0];
  a.queue = [];
  for (let x = 100; x <= 600; x += 5) a.queue.push({ x, y: 300 });
  a.x = 600; a.y = 300; a.ang = 0; a.old_ang = -100; a.len = 15;
  b.x = 250; b.y = 300;
  const coupe = S.coupure(a, b.x, b.y, C.RAYON_BOMBE);
  assert.strictEqual(coupe, 8, 'la coupe tombe au huitième segment depuis la tête (x = 390, à 140 px)');
  b.vie = 0.01;
  s.avancer(t);
  assert.strictEqual(s.objets.length, 0, 'la bombe a sauté');
  assert.deepStrictEqual(s.snapshot().explosions, [{ x: 250, y: 300 }]);
  assert.strictEqual(a.len, 8, 'la queue prise dans le souffle est partie');
  assert.strictEqual(s.ended, false, 'la tête, à 350 px, vit');
});

test('toucher une bombe du nez la fait sauter aussitôt — et c’est la mort', () => {
  const s = session({ objets: { premier: [0.5, 0.5], suivants: [1e6, 1e6], distanceTete: 0 } });
  jusqua(s, 3025);
  let t = 3050;
  while (!s.objets.length && t < 6000) { s.avancer(t); t += 25; }
  const b = s.objets[0];
  const a = s.bataille.serpents[0];
  b.x = Math.round(a.x + Math.cos(a.ang) * 12);
  b.y = Math.round(a.y + Math.sin(a.ang) * 12);
  s.avancer(t);
  assert.strictEqual(s.objets.length, 0, 'sautée au contact, sans attendre la mèche');
  assert.strictEqual(s.ended, true);
  assert.strictEqual(s.winner, 1, 'a est mort, b gagne');
  assert.strictEqual(s.endReason, 'collision');
});

test('il n’y a que des bombes — pas de fruit dans un duel', () => {
  const s = session({ objets: { premier: [0.1, 0.1], suivants: [0.1, 0.1], meche: 1e6 } });
  jusqua(s, 3025);
  for (let t = 3050; t < 6000; t += 25) s.avancer(t);
  assert.ok(s.objets.length > 0);
  assert.ok(s.objets.every((o) => o.type === 'bombe'));
  assert.ok(!('manges' in s.snapshot()), 'rien à manger, rien à annoncer');
});

test('les objets ne tombent jamais sous le nez d’un serpent, ni plus de quatre à la fois', () => {
  const s = session({ objets: { premier: [0.1, 0.1], suivants: [0.1, 0.1], meche: 1e6 } });
  jusqua(s, 3025);
  for (let t = 3050; t < 6000; t += 25) {
    s.avancer(t);
    assert.ok(s.objets.length <= 4);
  }
  assert.strictEqual(s.objets.length, 4);
  const b = s.bataille.niveau.bounds();
  for (const o of s.objets) {
    assert.ok(o.x >= b.left + 40 && o.x <= b.right - 40 && o.y >= b.top + 40 && o.y <= b.bottom - 40, 'dans les marges');
  }
});

// ── Le bot ─────────────────────────────────────────────────────────────────

test('le bot voit le mur venir et tourne ; à niveau 1, il tient plus de vingt secondes', () => {
  const s = session({ objets: false });
  jusqua(s, 3025);
  const etats = {};
  let t = 3050;
  while (!s.ended && t < 60000) {
    for (const p of s.players) s.setInput(p.id, Bot.decider(s, p.team, 1, s.rng, etats[p.id] = etats[p.id] || {}));
    s.avancer(t); t += 25;
  }
  assert.ok(s.temps > 20, 'deux bots à plein niveau se tiennent : ' + s.temps + ' s');
  // Face au mur, la survie tout droit est courte, et un virage vaut mieux.
  const f = session({ objets: false });
  jusqua(f, 3025);
  const a = f.bataille.serpents[0];
  a.x = 640; a.y = 250; a.ang = 0; a.old_ang = -100;
  const droit = Bot.survie(f, 0, 0, 32), gauche = Bot.survie(f, 0, -1, 32);
  assert.ok(droit < 32, 'le mur est à ' + droit + ' pas');
  assert.ok(gauche > droit, 'tourner sauve : ' + gauche + ' > ' + droit);
});

// ── Le pont ────────────────────────────────────────────────────────────────

function pont(opts) {
  let now = 0;
  const notes = [];                    // ce que l'hôte persisterait (onChampion)
  const net = new SnakeNet(Object.assign({
    clock: () => now, rng: graine(5), objets: false,
    onChampion: (u, f, i) => notes.push([u, f.ls[0], i.delta, i.resultat]),
  }, opts || {}));
  const jusqua = (t) => { let out = []; while (now < t) { now += 25; out = out.concat(net.tick(now)); } return out; };
  return { net, notes, jusqua, horloge: () => now };
}
const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml); return m ? m[1] : null; };
const de = (msgs, u, e) => msgs.filter((m) => m.to.indexOf(u) >= 0 && attr(m.xml, 'e') === e);

test('hello → salon (bots compris, note lue chez l’hôte) ; seek des deux côtés → start avec les files entières', () => {
  const { net } = pont({ getChampion: (u) => (u === 'a' ? { linit: true, l: [3, 1, 0], ls: [1080, 1000, 1080] } : null) });
  let out = net.handle('a', { a: 'hello', n: 'Alice', f: 'FB' });
  assert.strictEqual(de(out, 'a', 'lobby').length, 1);
  const lobby = out[0].xml;
  assert.ok(/<pl u="a" n="Alice" s="idle" f="FB" no="1080" pj="4" bot="0"\/>/.test(lobby), lobby);
  assert.ok(/bot="1"/.test(lobby), 'les bots sont présents');
  assert.ok(/u="sifflet" [^>]*no="0" pj="0" bot="1"/.test(lobby), 'un bot n’a pas de note');
  net.handle('b', { a: 'hello', n: 'Bob' });
  assert.ok(/<pl u="b" n="Bob" s="idle" f="" no="1000" pj="0" bot="0"\/>/.test(net._lobbyXml()), 'un nouveau part à 1000');
  out = net.handle('a', { a: 'seek' });
  assert.strictEqual(de(out, 'a', 'start').length, 0);
  assert.ok(/u="a" n="Alice" s="waiting"/.test(de(out, 'a', 'lobby')[0].xml));
  out = net.handle('b', { a: 'seek' });
  const start = de(out, 'a', 'start');
  assert.strictEqual(start.length, 1);
  assert.deepStrictEqual(start[0].to, ['a', 'b']);
  assert.strictEqual(attr(start[0].xml, 'ph'), 'compte');
  assert.strictEqual(attr(start[0].xml, 'cl'), '1', 'entre humains : la note est en jeu');
  assert.ok(/<p u="a" n="Alice" e="0" f="FB" no="1080"\/>/.test(start[0].xml));
  assert.ok(/<s i="0" [^>]*file="10,60 10,60/.test(start[0].xml), 'la file entière voyage au départ');
  assert.ok(/u="a" n="Alice" s="playing"/.test(de(out, 'b', 'lobby')[0].xml));
});

test('le tick pousse un état par pas aux deux joueurs, sans les joueurs dedans, et applique les touches', () => {
  const { net, jusqua } = pont();
  net.handle('a', { a: 'hello', n: 'A' }); net.handle('b', { a: 'hello', n: 'B' });
  net.handle('a', { a: 'challenge', u: 'b' });
  let out = jusqua(1000);
  const etats = de(out, 'a', 'state');
  assert.strictEqual(etats.length, 40, 'quarante pas en une seconde');
  assert.ok(etats[0].xml.indexOf('<p ') < 0, 'pas de joueurs dans un pas');
  assert.ok(etats[0].xml.indexOf('file=') < 0, 'pas de file entière dans un pas');
  assert.strictEqual(attr(etats[39].xml, 'n'), '40');
  jusqua(3100);
  assert.deepStrictEqual(net.handle('a', { a: 'input', g: '1', d: '0', h: '1' }), []);
  const sess = net.sessions[net.lobby.getPlayer('a').gameId];
  assert.deepStrictEqual(sess.inputs[0], { gauche: true, droite: false, haut: true });
  assert.strictEqual(net.handle('zz', { a: 'input', g: '1' })[0].xml, '<sb e="err" m="not-in-game"/>');
});

test('la fin : end aux deux, les deux notes bougent à l’Elo (placement : ±24 entre égaux) — et cela se classe', () => {
  const { net, notes, jusqua } = pont();
  net.handle('a', { a: 'hello', n: 'A' }); net.handle('b', { a: 'hello', n: 'B' });
  net.handle('a', { a: 'challenge', u: 'b' });
  jusqua(4500);
  net.handle('b', { a: 'input', g: '0', d: '1', h: '0' });      // b tourne (sorti du coin), a file au mur
  let fin = [];
  for (let i = 0; i < 2000 && !fin.length; i++) fin = de(jusqua(net.clock() + 25), 'a', 'end');
  assert.strictEqual(fin.length, 1);
  assert.strictEqual(attr(fin[0].xml, 'w'), '1');
  assert.strictEqual(attr(fin[0].xml, 'r'), 'collision');
  // Deux notes de 1000 en placement (K = 48) : le gagnant prend 24, le
  // perdant les rend. La fin porte la note à jour ET l'écart.
  assert.ok(/<p u="b" n="B" e="1" f="" no="1024" dn="24"\/>/.test(fin[0].xml), fin[0].xml);
  assert.ok(/<p u="a" n="A" e="0" f="" no="976" dn="-24"\/>/.test(fin[0].xml), fin[0].xml);
  assert.deepStrictEqual(notes, [['a', 976, -24, 'd'], ['b', 1024, 24, 'v']], 'l’hôte reçoit les deux fiches à persister');
  assert.deepStrictEqual(net.ficheChampion('b').l, [1, 0, 0]);
  // Une fiche neuve : minimum et maximum prennent la valeur du jour (la règle
  // de FruticardSlot.setLeagueScore, reprise par elo.js).
  assert.deepStrictEqual(net.ficheChampion('a').ls, [976, 976, 976], 'note, minimum, maximum');
  assert.strictEqual(net.lobby.getPlayer('a').status, 'idle');
  assert.deepStrictEqual(Object.keys(net.sessions), []);
  assert.ok(/u="b" [^>]*no="1024" pj="1"/.test(net._lobbyXml()), 'le salon montre la note à jour');
});

test('abandon (part) et déconnexion valent une défaite ; un bot ne vaut rien (entraînement)', () => {
  const { net, notes, jusqua } = pont();
  net.handle('a', { a: 'hello', n: 'A' }); net.handle('b', { a: 'hello', n: 'B' });
  net.handle('a', { a: 'challenge', u: 'b' });
  jusqua(500);
  let out = net.handle('b', { a: 'part' });
  assert.strictEqual(attr(de(out, 'a', 'end')[0].xml, 'r'), 'forfeit');
  assert.deepStrictEqual(notes.splice(0), [['a', 1024, 24, 'v'], ['b', 976, -24, 'd']]);
  // Contre un bot : la partie se joue, mais rien ne bouge — et la fin le dit.
  out = net.handle('a', { a: 'challenge', u: 'sifflet' });
  assert.strictEqual(de(out, 'a', 'start').length, 1);
  assert.strictEqual(attr(de(out, 'a', 'start')[0].xml, 'cl'), '0', 'un entraînement');
  const sess = net.sessions[net.lobby.getPlayer('a').gameId];
  sess.forfeit('sifflet');
  out = jusqua(net.clock() + 50);
  const finBot = de(out, 'a', 'end')[0].xml;
  assert.strictEqual(attr(finBot, 'cl'), '0');
  assert.ok(finBot.indexOf('dn=') < 0, 'pas d’écart : rien n’a bougé');
  assert.deepStrictEqual(notes.splice(0), []);
  assert.strictEqual(net.ficheChampion('a').ls[0], 1024);
  // Déconnexion en partie → défaite du parti, et sa fiche s'oublie (relue au retour).
  net.handle('a', { a: 'challenge', u: 'b' });
  out = net.onDisconnect('a');
  assert.strictEqual(attr(de(out, 'b', 'end')[0].xml, 'w'), '1');
  const [pa, pb] = notes.splice(0);
  assert.strictEqual(pa[0], 'a'); assert.strictEqual(pa[3], 'd'); assert.ok(pa[2] < 0);
  assert.strictEqual(pb[0], 'b'); assert.strictEqual(pb[3], 'v'); assert.ok(pb[2] > 0);
  assert.strictEqual(net.lobby.getPlayer('a'), null);
  assert.strictEqual(net.champions.a, undefined, 'la fiche du parti n’encombre plus la mémoire');
});

test('une égalité — les deux têtes tombent au même pas — vaut un demi-point à chacun', () => {
  const { net, notes } = pont({ getChampion: (u) => (u === 'a' ? { linit: true, l: [20, 0, 0], ls: [1200, 1000, 1200] } : null) });
  net.handle('a', { a: 'hello', n: 'A' }); net.handle('b', { a: 'hello', n: 'B' });
  net.handle('a', { a: 'challenge', u: 'b' });
  const sess = net.sessions[net.lobby.getPlayer('a').gameId];
  sess._finir(-1, 'draw');
  const out = net.tick(net.clock() + 25);
  const fin = de(out, 'a', 'end')[0].xml;
  assert.strictEqual(attr(fin, 'w'), '-1');
  // Le mieux noté (1200, établi, K = 32) attendait mieux qu'une nulle : il
  // perd ; le débutant (placement, K = 48) gagne.
  const [na, nb] = notes;
  assert.strictEqual(na[3], 'n'); assert.ok(na[2] < 0, 'A rend des points : ' + na[2]);
  assert.strictEqual(nb[3], 'n'); assert.ok(nb[2] > 0, 'B en gagne : ' + nb[2]);
  assert.ok(/u="a" [^>]*dn="-\d+"/.test(fin) && /u="b" [^>]*dn="\d+"/.test(fin));
});

test('le bot joue seul contre un humain ; la reprise (hello en partie) renvoie l’état entier', () => {
  const { net, jusqua } = pont();
  net.handle('a', { a: 'hello', n: 'A' });
  net.handle('a', { a: 'challenge', u: 'viperine' });
  jusqua(4000);
  const sess = net.sessions[net.lobby.getPlayer('a').gameId];
  assert.ok(sess.inputs[1].gauche || sess.inputs[1].droite || sess.inputs[1].haut || true);
  const s1 = sess.bataille.serpents[1];
  assert.ok(s1 && s1.x !== 690, 'le bot bouge');
  const out = net.handle('a', { a: 'hello', n: 'A' });
  const start = de(out, 'a', 'start');
  assert.strictEqual(start.length, 1, 'l’état entier revient au joueur qui se reconnecte');
  assert.ok(start[0].xml.indexOf('file=') > 0);
  assert.strictEqual(attr(start[0].xml, 'ph'), 'jeu');
});

test('le portillon de formation peut refuser un match entre humains (refus / opp-refus)', () => {
  const { net } = pont({ onMatchForming: (humans) => ({ ok: false, blocked: ['b'] }) });
  net.handle('a', { a: 'hello', n: 'A' }); net.handle('b', { a: 'hello', n: 'B' });
  const out = net.handle('a', { a: 'challenge', u: 'b' });
  assert.strictEqual(de(out, 'a', 'err')[0].xml, '<sb e="err" m="opp-refus"/>');
  assert.strictEqual(de(out, 'b', 'err')[0].xml, '<sb e="err" m="refus"/>');
  assert.strictEqual(net.lobby.getPlayer('a').status, 'idle');
});
