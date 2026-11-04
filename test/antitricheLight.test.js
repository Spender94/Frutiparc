/*
 * L'anti-triche des portages, au banc (sans serveur) — antitricheLight.js.
 *
 * Les deux classements du challenge que le navigateur calculait seul — l'Arbre
 * creux de MiniPixiz et l'arcade de Mini-Fever — ne prennent plus un score au
 * mot : la partie est REJOUÉE à partir de la graine et du journal. Ce fichier
 * épingle le contrat :
 *
 *   · une partie honnête, enregistrée par le VRAI moteur comme dans la page,
 *     se rejoue au même score et passe ;
 *   · un score impossible, un journal retouché, une partie rendue plus vite
 *     qu'elle ne se joue, une cadence qu'aucun écran ne produit sont écartés ;
 *   · le jeton se refuse falsifié, expiré, d'un autre joueur ou d'un autre jeu ;
 *   · l'audit des scores déjà classés lève ce qui ne peut pas venir du jeu ;
 *   · le rythme d'une partie (points par minute de jeu) signale un gros score
 *     en très peu de temps, sans rien écarter.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AT = require(path.join(ROOT, 'antitricheLight.js'));
const J = require(path.join(ROOT, 'public/js/journal-partie.js'));
const PR = require(path.join(ROOT, 'public/minipixiz/rejeu.js'));
const X = require(path.join(ROOT, 'public/minipixiz/lieux.js'));
const A = require('./aideAntitriche.js');

// ── L'écriture du journal ──────────────────────────────────────────────────

test('le journal : des entiers signés, aller-retour exact, le bruit refusé', () => {
  const l = [0, 1, -1, 31, -32, 1000, -123456, 2 ** 31, 7];
  assert.deepEqual(J.decoder(J.encoder(l)), l);
  assert.equal(J.decoder('ab$'), null, 'un caractère étranger');
  assert.equal(J.decoder(J.encoder([5000]).slice(0, 1)), null, 'un entier coupé');
  // La graine d'une épreuve ne dépend que de la graine et du rang.
  assert.equal(J.graineDe(42, 3), J.graineDe(42, 3));
  assert.notEqual(J.graineDe(42, 3), J.graineDe(42, 4));
});

// ── L'Arbre creux ──────────────────────────────────────────────────────────

const ARBRE = A.arbreHonnete(4242, 7);

test('arbre : une partie honnête se rejoue au même score et passe', () => {
  assert.ok(ARBRE.fini && ARBRE.score > 0, 'la partie de banc est finie, avec des points');
  const v = AT.verifierArbre({ graine: 4242, journal: ARBRE.journal, scoreDeclare: ARBRE.score,
    dureeMs: ARBRE.tempsJeuMs + 4000 });
  assert.equal(v.verdict, 'conforme', v.raison);
  assert.equal(v.scoreVerifie, ARBRE.score);
  assert.deepEqual(v.indices, []);
  // Les PAUSES ne coûtent rien : la fenêtre a perdu le focus une heure.
  const pause = AT.verifierArbre({ graine: 4242, journal: ARBRE.journal, scoreDeclare: ARBRE.score,
    dureeMs: ARBRE.tempsJeuMs + 3600000 });
  assert.equal(pause.verdict, 'conforme', 'une longue pause ne fait pas écarter la partie');
  assert.match(pause.indices.join(), /longues pauses/, 'elle se signale seulement');
});

test('arbre : le score qu\'on déclare doit être celui qu\'on rejoue', () => {
  const v = AT.verifierArbre({ graine: 4242, journal: ARBRE.journal, scoreDeclare: 99999,
    dureeMs: ARBRE.tempsJeuMs + 4000 });
  assert.equal(v.verdict, 'divergent');
  assert.match(v.raison, /score rejoué \d+, déclaré 99999/);
  // Le bon journal sur une AUTRE graine ne donne pas la même partie.
  const g = AT.verifierArbre({ graine: 4243, journal: ARBRE.journal, scoreDeclare: ARBRE.score,
    dureeMs: ARBRE.tempsJeuMs + 4000 });
  assert.equal(g.verdict, 'divergent', 'la graine fait partie de la preuve');
});

test('arbre : un journal retouché ne se rejoue pas', () => {
  // On coupe la fin : la partie rejouée n'est pas finie.
  const coupe = ARBRE.journal.slice(0, Math.floor(ARBRE.journal.length / 2));
  const v = AT.verifierArbre({ graine: 4242, journal: coupe, scoreDeclare: ARBRE.score, dureeMs: ARBRE.tempsJeuMs + 4000 });
  assert.equal(v.verdict, 'divergent');
  // On rallonge : la partie finit avant la fin du journal.
  const lu = PR.lireJournal(ARBRE.journal).pas;
  const plus = PR.encoderPas(lu.concat([546, 1, 546, 2]));
  const v2 = AT.verifierArbre({ graine: 4242, journal: plus, scoreDeclare: ARBRE.score, dureeMs: ARBRE.tempsJeuMs + 4000 });
  assert.equal(v2.verdict, 'divergent');
  assert.match(v2.raison, /finit au pas/);
  // Du bruit.
  const v3 = AT.verifierArbre({ graine: 4242, journal: 'A1$$$', scoreDeclare: ARBRE.score, dureeMs: ARBRE.tempsJeuMs + 4000 });
  assert.equal(v3.verdict, 'divergent');
});

test('arbre : plus de jeu que de temps écoulé, c\'est une partie accélérée', () => {
  const v = AT.verifierArbre({ graine: 4242, journal: ARBRE.journal, scoreDeclare: ARBRE.score,
    dureeMs: Math.round(ARBRE.tempsJeuMs / 3) });
  assert.equal(v.verdict, 'refuse');
  assert.match(v.raison, /plus longue que le temps écoulé/);
});

test('arbre : une cadence qu\'aucun écran ne produit est un ralenti', () => {
  // Le même jeu, mais un pas de 0,02 image : 1 600 images par seconde.
  const lieu = new X.Arbre({ graine: 9, carte: null });
  const rec = PR.brancher(lieu);
  const r = A.de(3);
  for (let i = 0; !lieu.fini && i < 2000000; i++) {
    if (i % 200 === 0) { lieu.jeu.entree.gauche = r() < 0.3; lieu.jeu.entree.tourner = r() < 0.3; }
    lieu.update(0.02);
  }
  const v = AT.verifierArbre({ graine: 9, journal: rec.journal(), scoreDeclare: lieu.score, dureeMs: 24 * 3600 * 1000 });
  assert.equal(v.verdict, 'refuse');
  assert.match(v.raison, /cadence impossible/);
});

// ── L'arcade de Mini-Fever ─────────────────────────────────────────────────

test('arcade : une partie honnête du vrai socle se rejoue, épreuve par épreuve', () => {
  const p = A.arcadeHonnete(777, 1, 5);
  assert.ok(p.fin, 'la partie est allée à son terme');
  const v = AT.verifierArcade({ graine: 777, palier: 1, journal: p.journal,
    declare: { niveau: p.fin.niveau, jouees: p.fin.jouees }, dureeMs: p.tempsJeuMs + 5000 });
  assert.equal(v.verdict, 'conforme', v.raison);
  assert.equal(v.niveauVerifie, p.fin.niveau);
  assert.equal(v.details.accord, p.fin.jouees, 'chaque épreuve rejouée donne le verdict déclaré');
});

const CONSTRUITE = A.arcadeConstruite(555, 0, 6);

test('arcade : les victoires comptées sont celles que le serveur rejoue', () => {
  const c = CONSTRUITE;
  const v = AT.verifierArcade({ graine: 555, palier: 0, journal: c.corps.journal,
    declare: { niveau: c.niveau, jouees: c.jouees }, dureeMs: c.minimumMs + 1000 });
  assert.equal(v.verdict, 'conforme', v.raison);
  assert.equal(v.niveauVerifie, c.niveau);
  assert.deepEqual(v.gagneesVerifiees, c.gagnees, 'les pictos suivront les victoires rejouées');
});

test('arcade : un bilan forgé, une épreuve retouchée, une partie trop rapide sont écartés', () => {
  const c = CONSTRUITE;
  const verif = (journal, declare, dureeMs) => AT.verifierArcade({ graine: 555, palier: 0, journal,
    declare: declare || { niveau: c.niveau, jouees: c.jouees }, dureeMs: dureeMs || c.minimumMs + 1000 });
  // Le bilan déclaré ne colle pas au journal.
  assert.equal(verif(c.corps.journal, { niveau: c.niveau + 3, jouees: c.jouees }).verdict, 'divergent');
  // Une défaite maquillée en victoire : la difficulté qui suit ne tombe plus.
  const j1 = JSON.parse(JSON.stringify(c.corps.journal));
  const k = j1.epreuves.findIndex((e) => !e.g);
  j1.epreuves[k].g = 1;
  assert.equal(verif(j1, { niveau: c.niveau + 1, jouees: c.jouees }).verdict, 'divergent');
  // La dernière épreuve maquillée : la difficulté ne la trahit pas, le rejeu si.
  const j2 = JSON.parse(JSON.stringify(c.corps.journal));
  const der = j2.epreuves[j2.epreuves.length - 1];
  assert.equal(der.g, 0, 'la partie finit sur une défaite');
  // On rejoue une main gagnante au lieu de la perdante : le jeu tiré n'est
  // plus celui du journal.
  der.c = der.c === 'gameBasket' ? 'gameLander' : 'gameBasket';
  const v2 = verif(j2);
  assert.notEqual(v2.verdict, 'conforme');
  // Trop vite : la partie demande ses consoles entre les épreuves.
  const v3 = verif(c.corps.journal, null, Math.round(c.minimumMs / 4));
  assert.equal(v3.verdict, 'refuse');
  assert.match(v3.raison, /plus longue que le temps écoulé/, 'moins de temps que ses seules épreuves');
  const jeu = verif(c.corps.journal, null, 3600000).tempsJeuMs;
  const v3b = verif(c.corps.journal, null, jeu + 1000);
  assert.equal(v3b.verdict, 'refuse');
  assert.match(v3b.raison, /trop vite/, 'le temps des épreuves, mais pas celui des consoles');
  // Interrompue : ni le palier au bout, ni plus de vies.
  const j4 = JSON.parse(JSON.stringify(c.corps.journal));
  j4.epreuves.pop();
  assert.equal(verif(j4, { niveau: c.niveau, jouees: c.jouees - 1 }).verdict, 'divergent');
});

// ── Le jeton ───────────────────────────────────────────────────────────────

test('le jeton : signé, nominatif, d\'un seul jeu, et daté', () => {
  AT.poserSecret('secret-de-banc-0123456789');
  const p = AT.creerJeton({ jeu: 'minipixiz', username: 'Alice', mode: 0 });
  const c = AT.lireJeton(p.jeton, { jeu: 'minipixiz', username: 'alice' });
  assert.equal(c.g, p.graine);
  assert.equal(c.id, p.id);
  assert.match(AT.lireJeton(p.jeton, { jeu: 'minifever', username: 'alice' }).erreur, /autre jeu/);
  assert.match(AT.lireJeton(p.jeton, { jeu: 'minipixiz', username: 'bob' }).erreur, /autre joueur/);
  // La charge retouchée (une autre graine) ne passe plus la signature.
  const [corps, sig] = p.jeton.split('.');
  const charge = JSON.parse(Buffer.from(corps.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  charge.g = 1;
  const faux = Buffer.from(JSON.stringify(charge)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + sig;
  assert.match(AT.lireJeton(faux, { jeu: 'minipixiz', username: 'alice' }).erreur, /falsifié/);
  assert.match(AT.lireJeton('', {}).erreur, /absent/);
  const vieux = AT.creerJeton({ jeu: 'minipixiz', username: 'alice', t: Date.now() - 25 * 3600 * 1000 });
  assert.match(AT.lireJeton(vieux.jeton, { jeu: 'minipixiz', username: 'alice' }).erreur, /expiré/);
  // Un autre secret (un autre serveur) : falsifié.
  AT.poserSecret('un-tout-autre-secret-0123456789');
  assert.match(AT.lireJeton(p.jeton, { jeu: 'minipixiz', username: 'alice' }).erreur, /falsifié/);
});

// ── L'audit des scores déjà classés ────────────────────────────────────────

test('l\'audit lève ce qui ne peut pas venir du jeu, et laisse le reste', () => {
  const s = AT.auditer({
    arbre: [
      { username: 'honnete', jour: '2026-11-01', score: 4000, fiche: { treeMax: 5000, partiesArbre: 12 } },
      { username: 'fiche', jour: '2026-11-01', score: 9000, fiche: { treeMax: 3000, partiesArbre: 4 } },
      { username: 'jamais', jour: '2026-11-01', score: 2000, fiche: { treeMax: 2000, partiesArbre: 0 } },
      { username: 'enorme', jour: '2026-11-01', score: 150000, fiche: { treeMax: 150000, partiesArbre: 40 } },
      { username: 'apres', jour: '2026-11-03', score: 3000, fiche: { treeMax: 3000, partiesArbre: 9 }, verificationActive: true },
      { username: 'verifie', jour: '2026-11-03', score: 3000, fiche: { treeMax: 3000, partiesArbre: 9 }, verificationActive: true, verifie: 3000 },
    ],
    arcade: [
      { username: 'barème', jour: '2026-11-01', score: 125, data: '0', pictos: 10 },
      { username: 'trop', jour: '2026-11-01', score: 4100, data: '3', pictos: 27 },
      { username: 'sanspicto', jour: '2026-11-01', score: 400, data: '0', pictos: 0 },
      { username: 'bon', jour: '2026-11-01', score: 400, data: '0', pictos: 20 },
    ],
  });
  const par = Object.fromEntries(s.map((x) => [x.username, x]));
  assert.ok(!par.honnete, 'un score sous le record de la fiche passe');
  assert.ok(!par.verifie, 'un score adossé à une partie vérifiée passe');
  assert.ok(!par.bon, 'un score d\'arcade au barème, avec ses pictos, passe');
  assert.equal(par.fiche.gravite, 'fort');
  assert.match(par.fiche.raisons.join(), /au-dessus du record personnel/);
  assert.equal(par.jamais.gravite, 'fort');
  assert.equal(par.enorme.gravite, 'moyen');
  assert.equal(par.apres.gravite, 'fort');
  assert.match(par.apres.raisons.join(), /aucune partie vérifiée/);
  assert.equal(par['barème'].gravite, 'fort');
  assert.equal(par.trop.gravite, 'fort');
  assert.equal(par.sanspicto.gravite, 'moyen');
  assert.equal(s[0].gravite, 'fort', 'les plus graves d\'abord');
});

test('l\'audit ne rend que les heures que la base connaît, jamais une durée', () => {
  const s = AT.auditer({
    arbre: [
      { username: 'date', jour: '2026-11-01', score: 9000, fiche: { treeMax: 3000, partiesArbre: 4 },
        enregistreLe: '2026-11-01T13:02:07.000Z', partiesDuJour: 2 },
      { username: 'sansdate', jour: '2026-11-01', score: 9000, fiche: { treeMax: 3000, partiesArbre: 4 } },
    ],
    arcade: [],
  });
  const par = Object.fromEntries(s.map((x) => [x.username, x]));
  assert.equal(par.date.enregistreLe, '2026-11-01T13:02:07.000Z');
  assert.equal(par.date.partiesDuJour, 2);
  assert.equal(par.sansdate.enregistreLe, null, 'sans heure en base, rien d\'inventé');
  assert.equal(par.sansdate.partiesDuJour, null);
  for (const x of s) assert.ok(!('dureeMs' in x) && !('duree' in x), 'aucune durée n\'est fabriquée');
});

// ── Le rythme : durées lisibles, points par minute, signal ─────────────────

test('les durées se lisent « 2 min 13 s »', () => {
  assert.equal(AT.dureeLisible(45000), '45 s');
  assert.equal(AT.dureeLisible(133000), '2 min 13 s');
  assert.equal(AT.dureeLisible(65000), '1 min 05 s');
  assert.equal(AT.dureeLisible(3840000), '1 h 04 min');
  assert.equal(AT.dureeLisible(0), '0 s');
});

test('rythme : une partie honnête rejouée donne ses durées, ses images, et pas de signal', () => {
  const jeu = A.arbreHonnete(4242, 5);
  const v = AT.verifierArbre({ graine: 4242, journal: jeu.journal, scoreDeclare: jeu.score, dureeMs: jeu.tempsJeuMs + 20000 });
  assert.equal(v.verdict, 'conforme');
  // La ligne telle que parties_verifiees la garde.
  const p = { jeu: 'minipixiz', mode: 0, score_declare: jeu.score, score_verifie: v.scoreVerifie,
    duree_ms: jeu.tempsJeuMs + 20000, temps_jeu_ms: v.tempsJeuMs, details: v.details };
  const r = AT.rythmePartie(p);
  assert.equal(r.dureeMs, jeu.tempsJeuMs + 20000);
  assert.equal(r.tempsJeuMs, jeu.tempsJeuMs, 'le temps de jeu du journal, au rejeu près');
  assert.ok(r.images > 1000, 'le nombre d\'images rejouées (details.pas)');
  assert.equal(r.pointsParMinute, Math.round(jeu.score / (jeu.tempsJeuMs / 60000)));
  assert.equal(r.signal, null);
  assert.deepEqual(r.raisons, []);
});

test('rythme : un gros score en peu de temps est signalé, d\'autant plus qu\'il va vite', () => {
  const S = AT.SEUILS;
  const ligne = (score, tempsMs) => ({ jeu: 'minipixiz', mode: 0, score_declare: score, score_verifie: score,
    duree_ms: tempsMs + 5000, temps_jeu_ms: tempsMs, details: { pas: 1000 } });
  // 12 000 points en 2 min 10 s : plus de 5 500 points par minute.
  const fort = AT.rythmePartie(ligne(12000, 130000));
  assert.equal(fort.signal, 'fort');
  assert.match(fort.raisons[0], /12000 points en 2 min 10 s de jeu/);
  assert.match(fort.raisons[0], /il faudrait au moins 4 min 48 s de jeu/);
  // Au-dessus du seuil, sous le double.
  const moyen = AT.rythmePartie(ligne(6000, 120000));
  assert.ok(3000 > S.arbre.pointsParMinute && 3000 < S.arbre.pointsParMinute * S.rythme.facteurFort);
  assert.equal(moyen.signal, 'moyen');
  // Une cascade chanceuse en vingt secondes : rapide, mais elle ne pèse pas.
  const petit = AT.rythmePartie(ligne(S.arbre.scoreRythme - 1, 20000));
  assert.ok(petit.pointsParMinute > S.arbre.pointsParMinute);
  assert.equal(petit.signal, null);
  // Le même score en dix minutes : rien à dire.
  assert.equal(AT.rythmePartie(ligne(12000, 600000)).signal, null);
  // Le score déclaré compte quand rien n'est vérifié ; sans aucune durée, pas de rythme.
  const declare = AT.rythmePartie({ jeu: 'minipixiz', mode: 0, score_declare: 20000, score_verifie: null, duree_ms: 60000, temps_jeu_ms: 0 });
  assert.equal(declare.signal, 'fort');
  assert.match(declare.raisons[0], /réelles/, 'faute de journal, la durée réelle');
  const sansDuree = AT.rythmePartie({ jeu: 'minipixiz', mode: 0, score_declare: 88888, score_verifie: null, duree_ms: 0, temps_jeu_ms: 0 });
  assert.equal(sansDuree.pointsParMinute, null);
  assert.equal(sansDuree.signal, null);
});

test('rythme : au-delà de deux fois le 9e décile des parties conformes, même à Mini-Fever', () => {
  const S = AT.SEUILS;
  // Palier 1 : 10 victoires = 200 points. 400 points en 2 min = 200 par minute.
  const p = { jeu: 'minifever', mode: 1, score_declare: 400, score_verifie: 400, duree_ms: 130000, temps_jeu_ms: 120000, details: { images: 9000 } };
  assert.equal(AT.rythmePartie(p).signal, null, 'sans référence, pas de comparaison');
  assert.equal(AT.rythmePartie(p, { decile: 60, n: S.rythme.referenceMin - 1 }).signal, null, 'trop peu de parties de référence');
  const r = AT.rythmePartie(p, { decile: 60, n: 40 });
  assert.equal(r.signal, 'moyen');
  assert.equal(r.images, 9000, 'details.images pour l\'arcade');
  assert.match(r.raisons[0], /3,3 fois le 9e décile/);
  assert.equal(AT.rythmePartie(p, { decile: 150, n: 40 }).signal, null, 'sous le double du décile');
  // Une partie qui ne pèse pas (moins de dix victoires) n'est pas comparée.
  assert.equal(AT.rythmePartie(Object.assign({}, p, { score_verifie: 100, score_declare: 100, temps_jeu_ms: 5000 }), { decile: 60, n: 40 }).signal, null);
});
