'use strict';
/*
 * L'ARBRE CREUX — LES PROFILS DE JEU (antitricheLight.analyserArbre,
 * profilsArbre ; l'admin, onglet « Portages vérifiés »).
 *
 * « Il fait beaucoup plus de points par minute que les autres. » Les points
 * par minute d'une partie entière ne se comparent pas (le multiplicateur ne
 * monte qu'avec le temps) : on rejoue chaque partie et on la découpe par
 * palier, puis on regarde ce que fait la main, pièce par pièce.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AT = require(path.join(ROOT, 'antitricheLight.js'));
const A = require('./aideAntitriche.js');

test('le découpage par palier rend tout le score et tout le temps de la partie', () => {
  const p = A.arbreHonnete(13, 91);
  const an = AT.analyserArbre({ graine: 13, journal: p.journal });
  assert.equal(an.v, AT.ANALYSE_VERSION);
  assert.equal(an.score, p.score, 'le rejeu retrouve le score');
  assert.equal(an.paliers.reduce((s, x) => s + x.pts, 0), p.score, 'chaque point est rangé dans un palier');
  assert.ok(Math.abs(an.paliers.reduce((s, x) => s + x.ms, 0) - p.tempsJeuMs) <= 4, 'et chaque instant de jeu');
  assert.deepEqual(an.paliers.map((x) => x.m), [1, 2, 3, 4]);
  assert.ok(an.paliers[0].ms > 0 && an.paliers[0].pieces > 0);
  assert.ok(an.multiMax >= 2, 'la partie de banc passe au moins le premier palier');
  assert.ok(an.paliers[an.multiMax - 1].ms > 0);
  for (let m = an.multiMax + 1; m <= 4; m++) assert.equal(an.paliers[m - 1].ms, 0, 'pas de temps aux paliers jamais atteints');
  assert.equal(an.pieces, an.paliers.reduce((s, x) => s + x.pieces, 0));
  assert.ok(an.reaction.med >= 0 && an.vie.med > 0);
});

test('la main d’un programme ne ressemble pas à celle d’un joueur', () => {
  const humain = AT.analyserArbre({ graine: 21, journal: A.arbreHonnete(21, 5).journal });
  const robot = AT.analyserArbre({ graine: 21, journal: A.arbreRobot(21, 5).journal });
  assert.equal(robot.correctionsPct, 0, 'jamais d’aller-retour');
  assert.ok(humain.correctionsPct > 30, 'le joueur au hasard se corrige sans cesse');
  assert.ok(robot.reaction.cv < 0.2, 'des réactions toutes pareilles : ' + robot.reaction.cv);
  assert.ok(humain.reaction.cv > 0.4, 'des réactions qui varient : ' + humain.reaction.cv);
  assert.ok(robot.reaction.med > 0, 'la réaction court jusqu’à l’image où la touche est lue');
});

test('la vérification garde le profil avec une partie conforme, jamais avec une autre', () => {
  const p = A.arbreHonnete(33, 7);
  const ok = AT.verifierArbre({ graine: 33, journal: p.journal, scoreDeclare: p.score, dureeMs: p.tempsJeuMs + 2000 });
  assert.equal(ok.verdict, 'conforme');
  assert.equal(ok.details.analyse.v, AT.ANALYSE_VERSION);
  assert.equal(ok.details.analyse.score, p.score);
  const faux = AT.verifierArbre({ graine: 33, journal: p.journal, scoreDeclare: p.score + 100, dureeMs: p.tempsJeuMs + 2000 });
  assert.equal(faux.verdict, 'divergent');
  assert.equal(faux.details.analyse, undefined);
  assert.ok(AT.analyserArbreSansRisque({ graine: 1, journal: 'n’importe quoi' }).erreur, 'un journal illisible ne fait rien tomber');
});

test('les profils : par joueur, les points par minute de chaque palier, toutes parties réunies', () => {
  const an = (paliers, extra) => Object.assign({ v: AT.ANALYSE_VERSION, score: paliers.reduce((s, x) => s + x.pts, 0),
    tempsJeuMs: paliers.reduce((s, x) => s + x.ms, 0), paliers: paliers.map((x, k) => Object.assign({ m: k + 1, pieces: 1 }, x)),
    reaction: { med: 300, cv: 0.6 }, correctionsPct: 30, deplacementsParPiece: 3, rotationsParPiece: 1, piecesParMinute: 30, chutePct: 50 }, extra || {});
  const vide = { ms: 0, pts: 0 };
  const lignes = [
    { id: 'a', username: 'lent', cree_le: '2026-11-01', analyse: an([{ ms: 60000, pts: 100 }, { ms: 120000, pts: 600 }, vide, vide]) },
    { id: 'b', username: 'lent', cree_le: '2026-11-02', analyse: an([{ ms: 60000, pts: 300 }, { ms: 20000, pts: 50 }, vide, vide]) },
    { id: 'c', username: 'vif', cree_le: '2026-11-02', analyse: an([{ ms: 60000, pts: 1000 }, vide, vide, vide], { reaction: { med: 80, cv: 0.1 } }) },
    { id: 'd', username: 'vif', cree_le: '2026-11-03', analyse: { v: AT.ANALYSE_VERSION, erreur: 'journal illisible' } },
    { id: 'e', username: 'vieux', cree_le: '2026-11-03', analyse: Object.assign(an([{ ms: 60000, pts: 1 }, vide, vide, vide]), { v: 0 }) },
  ];
  const P = AT.profilsArbre(lignes);
  assert.deepEqual(P.map((p) => p.username), ['vif', 'lent'], 'trié par rythme ; les analyses en erreur ou périmées sont laissées');
  const lent = P[1];
  assert.equal(lent.parties, 2);
  assert.equal(lent.paliers[0].ppm, 200, '×1 : 400 points en 2 minutes');
  assert.equal(lent.paliers[1].ppm, 279, '×2 : 650 points en 140 s');
  assert.equal(lent.paliers[2].ppm, null, 'rien sous trente secondes');
  assert.equal(lent.liste.length, 2);
  assert.equal(P[0].reaction, 80);
  assert.equal(P[0].reactionCv, 0.1);
});

test('la main se lit sur les vraies parties, pas sur celles lâchées au bout de quelques secondes', () => {
  const an = (pieces, corrections, deplacements) => ({ v: AT.ANALYSE_VERSION, score: 10, tempsJeuMs: 60000, pieces,
    paliers: [{ m: 1, ms: 60000, pts: 10, pieces }, { m: 2, ms: 0, pts: 0, pieces: 0 }, { m: 3, ms: 0, pts: 0, pieces: 0 }, { m: 4, ms: 0, pts: 0, pieces: 0 }],
    reaction: { med: 250, cv: 0.7 }, correctionsPct: corrections, deplacementsParPiece: deplacements, rotationsParPiece: 1, piecesParMinute: 40, chutePct: 90 });
  const lignes = [{ id: 'l', username: 'u', cree_le: 'x', analyse: an(120, 30, 2.5) }];
  for (let k = 0; k < 5; k++) lignes.push({ id: 'c' + k, username: 'u', cree_le: 'x', analyse: an(3, 0, 0) });
  const [p] = AT.profilsArbre(lignes);
  assert.equal(p.parties, 6);
  assert.equal(p.partiesMain, 1);
  assert.deepEqual([p.correctionsPct, p.deplacementsParPiece], [30, 2.5], 'la partie longue seule');
  // Sans aucune partie longue, on garde ce qu'on a.
  const [q] = AT.profilsArbre(lignes.slice(1));
  assert.deepEqual([q.partiesMain, q.correctionsPct], [0, 0]);
});

test('l’admin a sa route, son rattrapage et sa section', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ADM = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  const FIL = fs.readFileSync(path.join(ROOT, 'antitricheFil.js'), 'utf8');
  assert.match(SRV, /app\.get\('\/api\/admin\/antitriche\/arbre\/profils', adminAuth,/);
  assert.match(SRV, /AT\.verifierEnFil\('analyseArbre'/);
  assert.match(FIL, /m\.type === 'analyseArbre' \? AT\.analyserArbreSansRisque/);
  assert.match(ADM, /id="pf-profils"/);
  assert.match(ADM, /onclick="loadProfilsArbre\(\)"/);
});
