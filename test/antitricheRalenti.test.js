/*
 * LE RALENTI (antitricheLight.js) — les battements datés par le serveur.
 *
 * Un « speed hack » ralentit l'horloge du navigateur : le jeu tourne deux
 * fois moins vite, le journal est authentique et se rejoue juste. Seule
 * l'horloge du serveur le voit : pendant la partie, le jeu envoie toutes les
 * deux secondes où en est son journal, et le serveur date chaque battement.
 *
 * Ici, le calcul lui-même, sur de VRAIES parties (le vrai moteur, joué au
 * hasard par le banc d'essai) et des battements simulés comme le navigateur
 * les enverrait : un joueur normal, un joueur qui fait deux longues pauses,
 * un ralenti ×2 et ×1,3, des battements bloqués, des fausses pauses un
 * battement sur deux, un compteur qui ment ; la ligne du temps de Mini-Fever
 * (épreuves et consoles) ; le registre (à qui la partie, combien, à quel
 * débit) ; l'écriture des battements gardés ; la tendance partie après partie.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AT = require(path.join(ROOT, 'antitricheLight.js'));
const PR = require(path.join(ROOT, 'public/minipixiz/rejeu.js'));
const FR = require(path.join(ROOT, 'public/minifever/rejeu.js'));
const E = require(path.join(ROOT, 'public/minifever/engine.js'));
const A = require('./aideAntitriche.js');

const QMS = 1000 / 32 / 1024;

// ── Les simulateurs ──────────────────────────────────────────────────────

/*
 * La ligne du temps d'une partie, en millisecondes de JEU : des segments
 * « jeu » (une liste de durées d'image, comptées au compteur `pas`) et
 * « console » (une durée, le compteur ne bouge pas). Rend `a(g)` : l'état
 * du jeu au temps de jeu g — { pas, console } — et la durée totale.
 */
function ligne(segments) {
  const pts = [];          // { g, pas, console } : chaque début de segment, puis chaque image
  let g = 0, pas = 0;
  for (const s of segments) {
    if (s.console) { pts.push({ g, pas, console: 1, fin: g + s.ms }); g += s.ms; continue; }
    for (const ms of s.images) { pts.push({ g, pas, console: 0 }); g += ms; pas++; }
  }
  pts.push({ g, pas, console: 0, dernier: true });
  return {
    total: g, pasFinal: pas,
    a(x) {
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].g <= x) lo = m; else hi = m - 1; }
      const p = pts[lo];
      if (p.console && x >= p.fin) return { pas: p.pas, console: 0 };
      return { pas: p.pas, console: p.console };
    },
  };
}

function ligneArbre(journal) {
  const lu = PR.lireJournal(journal);
  const images = [];
  for (let i = 0; i < lu.pas.length; i += 2) images.push(lu.pas[i] * QMS);
  return ligne([{ images }]);
}

function ligneArcade(journal) {
  const C = FR.consoleMinimale(E) * 1000 / 32;
  const segs = [];
  journal.epreuves.forEach((ep, k) => {
    if (k) segs.push({ console: true, ms: C });
    const images = [];
    let q = FR.TMOD_DEPART;
    for (const o of FR.lireOps(ep.o).ops) if (o.t === 0) { q += o.dq; for (let i = 0; i < o.n; i++) images.push(q * QMS); }
    segs.push({ images });
  });
  return ligne(segs);
}

/*
 * Les battements qu'enverrait le navigateur. `lent` : le facteur du speed hack
 * (0,5 : ×2 ; le temps de jeu avance de `lent` ms par ms réelle, les
 * minuteries aussi). `pauses` : [{ a: temps de jeu, ms: durée réelle }].
 * `fausses` : une fausse pause un battement sur deux. `gigue` : le réseau.
 * Un battement part toutes les deux secondes du NAVIGATEUR (donc 2 / lent
 * secondes réelles), aussitôt à chaque changement d'état, et un juste avant
 * la fin.
 */
function battements(lg, o) {
  const opt = Object.assign({ lent: 1, pauses: [], fausses: false, gigue: 0, t0: 1e12, depart: 2500 }, o || {});
  let x = 12345;
  const hasard = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const liste = [];
  let n = 0, reel = opt.t0 + opt.depart, g = 0, prochain = 0;
  const pauses = opt.pauses.slice();
  const envoyer = (etat, pause) => {
    n++;
    liste.push({ t: Math.round(reel + hasard() * opt.gigue), n, pas: etat.pas, console: etat.console,
      pause: opt.fausses ? (n % 2 ? 1 : 0) : (pause ? 1 : 0) });
  };
  let avant = lg.a(0);
  envoyer(avant, 0);
  const pasG = 2000 * opt.lent / 20;        // le pas de la simulation : un vingtième de battement
  while (g < lg.total) {
    if (pauses.length && g >= pauses[0].a) {
      const p = pauses.shift();
      envoyer(lg.a(g), 1);                   // la pause posée : aussitôt
      for (let k = 10000; k < p.ms; k += 10000) { reel += 10000; envoyer(lg.a(g), 1); }
      reel += p.ms % 10000 || 10000;
      envoyer(lg.a(g), 0);                   // la pause levée : aussitôt
      prochain = 0;
    }
    g = Math.min(lg.total, g + pasG);
    reel += pasG / opt.lent;
    prochain += pasG;
    const e = lg.a(g);
    if (e.console !== avant.console || prochain >= 2000) { envoyer(e, 0); prochain = 0; }
    avant = e;
  }
  envoyer(lg.a(lg.total), 0);                 // juste avant la fin
  return { liste, exiges: true, plein: false, fin: reel + 80, t0: opt.t0 };
}

const jeuArbre = A.arbreHonnete(4000, 4);               // ≈ 108 s de jeu
const lgArbre = ligneArbre(jeuArbre.journal);
const arbre = (bat) => AT.verifierArbre({ graine: 4000, journal: jeuArbre.journal, scoreDeclare: jeuArbre.score,
  dureeMs: bat.fin - bat.t0, battements: bat });

// ── L'Arbre creux ────────────────────────────────────────────────────────

test('ralenti : un joueur normal suit l’horloge du serveur (rapport ≈ 1), la partie est conforme', () => {
  assert.ok(lgArbre.total > 90000, 'une partie qui pèse');
  const v = arbre(battements(lgArbre, { gigue: 60 }));
  assert.equal(v.verdict, 'conforme', v.raison);
  const b = v.details.battements;
  assert.ok(b.rapportMedian > 0.97 && b.rapportMedian < 1.03, 'médiane ' + b.rapportMedian);
  assert.ok(b.actifs >= 40, b.actifs + ' intervalles actifs');
  assert.ok(b.couverture > 0.9);
  assert.equal(b.transitions, 0);
  assert.deepEqual(v.indices, []);
  assert.equal(v.alerte, undefined);
});

test('ralenti : deux longues pauses (la fenêtre passée derrière) ne changent rien', () => {
  const bat = battements(lgArbre, { pauses: [{ a: 20000, ms: 35000 }, { a: 60000, ms: 42000 }] });
  const v = arbre(bat);
  assert.equal(v.verdict, 'conforme', v.raison);
  const b = v.details.battements;
  assert.ok(b.rapportMedian > 0.97, 'médiane ' + b.rapportMedian);
  assert.equal(b.pauses, 2);
  assert.equal(b.transitions, 4);
  assert.ok(b.pauseMs >= 77000, 'les pauses se mesurent');
  assert.ok(b.partMasquee < 0.05, 'une vraie pause ne masque presque rien : ' + b.partMasquee);
});

test('ralenti : ×2 est refusé (médiane ≈ 0,5), en alerte « ralenti » grave', () => {
  const v = arbre(battements(lgArbre, { lent: 0.5, gigue: 60 }));
  assert.equal(v.verdict, 'refuse');
  assert.match(v.raison, /^ralenti : le jeu avance à 0,5/);
  assert.equal(v.scoreVerifie, jeuArbre.score, 'le score rejoué reste lisible');
  assert.equal(v.alerte.type, 'ralenti');
  assert.equal(v.alerte.gravite, 'grave');
  assert.equal(v.alerte.jeu, 'minipixiz');
  assert.ok(Math.abs(v.details.battements.rapportMedian - 0.5) < 0.03);
});

test('ralenti : ×1,3 tombe sous 0,8 (refusé), ×1,15 n’est qu’un indice', () => {
  const v13 = arbre(battements(lgArbre, { lent: 1 / 1.3 }));
  assert.equal(v13.verdict, 'refuse');
  assert.ok(Math.abs(v13.details.battements.rapportMedian - 0.77) < 0.02, String(v13.details.battements.rapportMedian));
  const v115 = arbre(battements(lgArbre, { lent: 1 / 1.15 }));
  assert.equal(v115.verdict, 'conforme');
  assert.ok(v115.indices.some((i) => /en retard sur l'horloge du serveur \(0,8/.test(i)), v115.indices.join(' | '));
});

test('ralenti : sans battements, une partie de plus d’une minute est refusée (« battements absents », suspect)', () => {
  const vide = { liste: [], exiges: true, plein: false, fin: 1e12 + 200000, t0: 1e12 };
  const v = arbre(vide);
  assert.equal(v.verdict, 'refuse');
  assert.match(v.raison, /^battements absents/);
  assert.equal(v.alerte.gravite, 'suspect');
  // Deux battements, au début et à la fin : pas mieux.
  const deux = battements(lgArbre);
  deux.liste = [deux.liste[0], deux.liste[deux.liste.length - 1]];
  assert.match(arbre(deux).raison, /^battements absents/);
  // Une partie née avant le redémarrage du serveur : on n'exige rien.
  assert.equal(arbre(Object.assign({}, vide, { exiges: false })).verdict, 'conforme');
  // Une partie dont le plafond de battements est atteint : non plus.
  assert.equal(arbre(Object.assign({}, vide, { plein: true })).verdict, 'conforme');
  // Et une partie sans champ `battements` (d'avant les battements) n'est pas examinée.
  const ancienne = AT.verifierArbre({ graine: 4000, journal: jeuArbre.journal, scoreDeclare: jeuArbre.score, dureeMs: 200000 });
  assert.equal(ancienne.verdict, 'conforme');
  assert.equal(ancienne.details.battements, undefined);
});

test('ralenti : bloquer les battements le temps de jouer au ralenti laisse un trou, qui n’est pas couvert', () => {
  // Les battements passent la première moitié (à vitesse normale), puis le
  // tricheur les bloque et ralentit ×2 jusqu'à la fin, sauf le dernier.
  const lg = lgArbre;
  const t0 = 1e12;
  const liste = [];
  let n = 0;
  const moitie = lg.total / 2;
  for (let g = 0; g <= moitie; g += 2000) liste.push({ t: t0 + 2500 + g, n: ++n, pas: lg.a(g).pas, pause: 0, console: 0 });
  const finReel = t0 + 2500 + moitie + (lg.total - moitie) * 2;
  liste.push({ t: finReel, n: ++n, pas: lg.pasFinal, pause: 0, console: 0 });
  const v = arbre({ liste, exiges: true, plein: false, fin: finReel + 80, t0 });
  assert.equal(v.verdict, 'refuse');
  assert.match(v.raison, /^battements absents .*1 trou\(s\) de plus de 20 s/);
  assert.equal(v.details.battements.trous, 1);
  assert.ok(v.details.battements.rapportMedian > 0.97, 'la médiane, elle, ne voyait rien');
  // Un battement perdu de temps en temps (le réseau) ne fait pas de trou.
  const troue = battements(lgArbre);
  troue.liste = troue.liste.filter((b, i) => i % 3 !== 1);
  const v2 = arbre(troue);
  assert.equal(v2.verdict, 'conforme', v2.raison);
  assert.equal(v2.details.battements.trous, 0);
});

test('ralenti : de fausses pauses un battement sur deux, au ralenti ×2, sont refusées', () => {
  const v = arbre(battements(lgArbre, { lent: 0.5, fausses: true }));
  assert.equal(v.verdict, 'refuse');
  assert.match(v.raison, /^fausses pauses/);
  assert.equal(v.alerte.gravite, 'grave');
  const b = v.details.battements;
  assert.equal(b.actifs, 0);
  assert.ok(b.partMasquee > 0.9);
  assert.ok(b.transitionsParMinute > 6);
});

test('ralenti : un compteur qui recule, ou qui dépasse le journal, est un mensonge', () => {
  const recule = battements(lgArbre);
  recule.liste[10].pas = recule.liste[9].pas - 5;
  const v = arbre(recule);
  assert.equal(v.verdict, 'refuse');
  assert.match(v.raison, /le compteur de pas recule/);
  const trop = battements(lgArbre);
  trop.liste[5].pas = lgArbre.pasFinal + 1;
  trop.liste.splice(6);
  assert.match(arbre(trop).raison, /annonce \d+ pas, le journal en compte/);
});

test('ralenti : le compteur qui prend de l’avance puis reste figé « en jeu » est vu (somme, puis avance)', () => {
  // Un ralenti ×2 où le compteur annonce le jeu au rythme de l'horloge du
  // serveur, puis reste figé (sans se dire en pause) jusqu'à la fin.
  const bat = battements(lgArbre, { lent: 0.5 });
  const t0 = bat.liste[0].t;
  for (const b of bat.liste) {
    const reel = b.t - t0;
    b.pas = lgArbre.a(Math.min(reel, lgArbre.total * 0.98)).pas;
  }
  const v = arbre(bat);
  assert.equal(v.verdict, 'refuse');
  assert.match(v.raison, /hors pauses/);
});

test('ralenti : des battements arrivés croisés, ou en double, ne trompent pas le calcul', () => {
  const bat = battements(lgArbre, { gigue: 40 });
  // Deux battements partis ensemble, arrivés dans l'autre ordre, et un doublon.
  const a = bat.liste[20], b = bat.liste[21];
  [a.t, b.t] = [b.t + 300, a.t];
  bat.liste.push(Object.assign({}, bat.liste[30]));
  const v = arbre(bat);
  assert.equal(v.verdict, 'conforme', v.raison);
  assert.ok(v.details.battements.rapportMedian > 0.97);
});

test('ralenti : le jeu qui va plus vite que l’horloge du serveur entre deux battements est refusé', () => {
  const bat = battements(lgArbre);
  // Toutes les heures serrées vers la fin : vingt secondes de jeu en deux.
  const k = Math.floor(bat.liste.length / 2);
  for (let i = k; i < k + 10; i++) bat.liste[i].t = bat.liste[k].t + (i - k) * 200;
  const v = arbre(bat);
  assert.equal(v.verdict, 'refuse');
  assert.match(v.raison, /de jeu de plus que l'heure écoulée/);
});

// ── Mini-Fever : épreuves et consoles ────────────────────────────────────

const jeuArcade = A.arcadeHonnete(77, 0, 5);
const lgArcade = ligneArcade(jeuArcade.journal);
const arcade = (bat) => AT.verifierArcade({ graine: 77, palier: 0, journal: jeuArcade.journal,
  declare: { niveau: jeuArcade.fin.niveau, jouees: jeuArcade.fin.jouees }, dureeMs: bat.fin - bat.t0, battements: bat });

test('ralenti : la ligne du temps de Mini-Fever reconstitue les consoles (positionsArcade)', () => {
  const C = FR.consoleMinimale(E);
  const pa = AT.positionsArcade([[1024, 1024], [2048]], C);
  const ms = (q) => q * QMS;
  assert.equal(pa.position({ pas: 0, console: 0 }), 0);
  assert.equal(pa.position({ pas: 1, console: 0 }), ms(1024));
  assert.equal(pa.position({ pas: 2, console: 1 }), null, 'dans une console : position inconnue');
  // Pile sur la frontière, hors console : l'épreuve 2 vient de commencer.
  assert.equal(pa.position({ pas: 2, console: 0 }), ms(2048 + C * 1024));
  assert.equal(pa.position({ pas: 3, console: 0 }), null, 'après la dernière épreuve : la console de fin');
  assert.equal(Math.round(pa.totalMs), Math.round(ms(4096 + C * 1024)));
});

test('ralenti : Mini-Fever normal ≈ 1, ×2 refusé, pauses légitimes conformes', () => {
  assert.ok(lgArcade.total > 60000, 'une arcade qui pèse : ' + lgArcade.total);
  const n = arcade(battements(lgArcade, { gigue: 50 }));
  assert.equal(n.verdict, 'conforme', n.raison);
  assert.ok(n.details.battements.rapportMedian > 0.97 && n.details.battements.rapportMedian < 1.03, String(n.details.battements.rapportMedian));
  // La console n'est pas une pause : aucune bascule.
  assert.equal(n.details.battements.transitions, 0);
  const p = arcade(battements(lgArcade, { pauses: [{ a: 15000, ms: 33000 }, { a: 50000, ms: 31000 }] }));
  assert.equal(p.verdict, 'conforme', p.raison);
  // Une pause qui tombe PENDANT une console (le joueur passe au chat entre
  // deux épreuves) : ses battements n'ont pas de position, mais l'intervalle
  // qui l'enjambe est bien une pause — il ne tire pas la somme vers le bas.
  let enConsole = 0;
  while (!lgArcade.a(enConsole).console) enConsole += 100;
  const pc = arcade(battements(lgArcade, { pauses: [{ a: enConsole + 1000, ms: 35000 }] }));
  assert.equal(pc.verdict, 'conforme', pc.raison);
  assert.ok(pc.details.battements.rapportGlobal > 0.95, 'somme ' + pc.details.battements.rapportGlobal);
  assert.equal(pc.details.battements.trous, 0);
  const x2 = arcade(battements(lgArcade, { lent: 0.5 }));
  assert.equal(x2.verdict, 'refuse');
  assert.match(x2.raison, /^ralenti/);
  assert.equal(x2.alerte.jeu, 'minifever');
  assert.equal(x2.niveauVerifie, jeuArcade.fin.niveau, 'le bilan rejoué reste lisible');
});

test('ralenti : Mini-Fever, battements bloqués ou fausses pauses — refusés', () => {
  const vide = { liste: [], exiges: true, plein: false, fin: 1e12 + 300000, t0: 1e12 };
  assert.match(arcade(vide).raison, /^battements absents/);
  assert.match(arcade(battements(lgArcade, { lent: 0.5, fausses: true })).raison, /^fausses pauses/);
});

// ── Le registre ──────────────────────────────────────────────────────────

test('registre : un battement n’est noté que pour la partie de ce joueur, borné et lisible', () => {
  const id = 'reg' + Date.now();
  assert.deepEqual(AT.noterBattement(id, 'alice', { n: 1, pas: 0 }), { erreur: 'inconnue' });
  AT.ouvrirBattements(id, 'Alice', 'minipixiz', Date.now());
  assert.deepEqual(AT.noterBattement(id, 'bob', { n: 1, pas: 0 }), { erreur: 'autre_joueur' });
  assert.deepEqual(AT.noterBattement(id, 'alice', { n: 1, pas: -3 }), { erreur: 'battement' });
  assert.deepEqual(AT.noterBattement(id, 'alice', { n: 'x', pas: 3 }), { erreur: 'battement' });
  assert.deepEqual(AT.noterBattement(id, 'alice', { n: 1, pas: 0, pause: 1 }, 1000), { ok: true });
  assert.deepEqual(AT.noterBattement(id, 'alice', { n: 2, pas: 50, console: 1 }, 3000), { ok: true });
  const f = AT.fermerBattements(id, 'alice', AT.DEMARRAGE + 1);
  assert.equal(f.exiges, true);
  assert.deepEqual(f.liste, [{ t: 1000, n: 1, pas: 0, pause: 1, console: 0 }, { t: 3000, n: 2, pas: 50, pause: 0, console: 1 }]);
  assert.deepEqual(AT.noterBattement(id, 'alice', { n: 3, pas: 60 }), { erreur: 'inconnue' }, 'une partie rendue ne bat plus');
  // Une partie inconnue du registre : exigée si elle est née depuis le démarrage.
  assert.equal(AT.fermerBattements('jamais', 'alice', AT.DEMARRAGE + 1).exiges, true);
  assert.equal(AT.fermerBattements('jamais', 'alice', AT.DEMARRAGE - 1).exiges, false);
  // Réinscrite après un redémarrage : ses battements ne sont plus exigés.
  AT.ouvrirBattements(id + 'r', 'alice', 'minifever', AT.DEMARRAGE - 1000, { reprise: true });
  assert.equal(AT.fermerBattements(id + 'r', 'alice', AT.DEMARRAGE - 1000).exiges, false);
});

test('registre : le plafond par partie, par joueur, et le débit', () => {
  const id = 'plein' + Date.now();
  AT.ouvrirBattements(id, 'carole', 'minipixiz', Date.now());
  for (let i = 0; i < AT.SEUILS.battements.parPartie; i++) AT.noterBattement(id, 'carole', { n: i, pas: i });
  assert.deepEqual(AT.noterBattement(id, 'carole', { n: 1e6, pas: 1 }), { erreur: 'pleine' });
  assert.equal(AT.fermerBattements(id, 'carole', Date.now()).plein, true);
  // Sept parties ouvertes : la plus ancienne est oubliée.
  const ids = [];
  for (let i = 0; i < 7; i++) { ids.push(id + 'j' + i); AT.ouvrirBattements(ids[i], 'denis', 'minifever', Date.now()); }
  assert.deepEqual(AT.noterBattement(ids[0], 'denis', { n: 1, pas: 0 }), { erreur: 'inconnue' });
  assert.deepEqual(AT.noterBattement(ids[6], 'denis', { n: 1, pas: 0 }), { ok: true });
  // Le débit : trente d'un coup, puis deux par seconde.
  const t = 5e12;
  let ok = 0;
  for (let i = 0; i < 40; i++) if (AT.debitBattement('emile', t)) ok++;
  assert.equal(ok, AT.SEUILS.battements.debitCapacite);
  assert.equal(AT.debitBattement('emile', t + 400), false);
  assert.equal(AT.debitBattement('emile', t + 1000), true);
});

test('les battements gardés se relisent à l’identique (details.battementsBruts)', () => {
  const bat = battements(lgArbre, { pauses: [{ a: 10000, ms: 31000 }] });
  bat.liste[3].console = 1;
  const s = AT.encoderBattements(bat, bat.t0);
  assert.match(s, /^B1[A-Za-z0-9_-]+$/);
  assert.ok(s.length < bat.liste.length * 12, `${s.length} caractères pour ${bat.liste.length} battements`);
  const d = AT.decoderBattements(s, bat.t0);
  assert.equal(d.exiges, true);
  assert.equal(d.fin, Math.round(bat.fin));
  assert.deepEqual(d.liste.map((b) => [b.t, b.n, b.pas, b.pause, b.console]),
    bat.liste.map((b) => [b.t, b.n, b.pas, b.pause, b.console]));
  assert.equal(AT.decoderBattements('n’importe quoi', 0), null);
  // Et rejouée avec eux, la partie dit la même chose.
  assert.deepEqual(arbre(d).details.battements, arbre(bat).details.battements);
});

// ── La tendance ──────────────────────────────────────────────────────────

test('tendance : cinq parties conformes d’affilée bien plus longues que leur temps de jeu lèvent l’alerte', () => {
  const p = (id, duree, jeu, extra) => Object.assign({ id, jeu: jeu || 'minipixiz', duree_ms: duree, temps_jeu_ms: 100000 }, extra || {});
  assert.equal(AT.rapportReelJeu(p('a', 153000)), 1.53);
  // Mini-Fever : la référence est le minimum (épreuves + consoles), pas les seules épreuves.
  assert.equal(AT.rapportReelJeu(p('b', 210000, 'minifever', { temps_jeu_ms: 100000, details: { minimumMs: 200000 } })), 1.05);
  const quatre = [1, 2, 3, 4].map((i) => p('x' + i, 180000));
  assert.equal(AT.tendanceRalenti(quatre).alerte, null);
  assert.equal(AT.tendanceRalenti(quatre).serie, 4);
  const cinq = quatre.concat([p('x5', 170000)]);
  const t = AT.tendanceRalenti(cinq);
  assert.equal(t.serie, 5);
  assert.match(t.alerte.resume, /^5 parties d'affilée dont la durée réelle dépasse 1,5 fois le temps de jeu/);
  assert.deepEqual(t.alerte.details.parties, ['x1', 'x2', 'x3', 'x4', 'x5']);
  // Une partie normale au milieu casse la série ; les parties courtes ne comptent pas.
  assert.equal(AT.tendanceRalenti([p('y', 105000)].concat(cinq)).alerte, null);
  const courte = p('c', 50000, 'minipixiz', { temps_jeu_ms: 20000 });
  assert.equal(AT.tendanceRalenti([courte].concat(cinq)).serie, 5, 'une partie de vingt secondes est sautée');
  // À six, pas de nouvelle alerte ; à dix, une.
  const six = [p('z', 190000)].concat(cinq);
  assert.equal(AT.tendanceRalenti(six).alerte, null);
  const dix = [1, 2, 3, 4, 5].map((i) => p('w' + i, 200000)).concat(cinq);
  assert.equal(AT.tendanceRalenti(dix).serie, 10);
  assert.ok(AT.tendanceRalenti(dix).alerte);
});
