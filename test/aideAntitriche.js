/*
 * Les parties de banc d'essai de l'anti-triche des portages (Arbre creux de
 * MiniPixiz, arcade de Mini-Fever) — partagées par test/antitriche*.test.js.
 *
 * Ce fichier ne porte AUCUN test : il fabrique des parties.
 *
 *   · arbreHonnete / arcadeHonnete : le VRAI moteur, avec l'enregistreur du
 *     portage branché comme dans la page, piloté par un joueur au hasard. C'est
 *     exactement ce que le navigateur rend — la preuve qu'une partie honnête
 *     passe.
 *   · arcadeConstruite : une arcade dont on CHOISIT les verdicts, chaque
 *     épreuve cherchée au hasard dans un bac à sable jusqu'à donner l'issue
 *     voulue. C'est ce que ferait un tricheur outillé (cf. les limites
 *     annoncées dans antitricheLight.js) ; ici, cela sert à poser des scores
 *     précis au classement.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const J = require(path.join(ROOT, 'public/js/journal-partie.js'));
const X = require(path.join(ROOT, 'public/minipixiz/lieux.js'));
const PR = require(path.join(ROOT, 'public/minipixiz/rejeu.js'));
const E = require(path.join(ROOT, 'public/minifever/engine.js'));
const C = require(path.join(ROOT, 'public/minifever/client.js'));
const JX = require(path.join(ROOT, 'public/minifever/jeux.js'));
const FR = require(path.join(ROOT, 'public/minifever/rejeu.js'));

const MESURES = C.mesures(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/minifever/sprites/sprites.json'), 'utf8')));

function de(graine) {
  let x = (graine >>> 0) || 1;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

/** Une partie d'arbre jouée au hasard, enregistrée comme dans la page. */
function arbreHonnete(graine, hasard) {
  const r = de(hasard || 12345);
  const lieu = new X.Arbre({ graine, carte: null });
  const rec = PR.brancher(lieu);
  const en = lieu.jeu.entree;
  for (let i = 0; !lieu.fini && i < 400000; i++) {
    if (i % 7 === 0) {
      en.gauche = r() < 0.3; en.droite = !en.gauche && r() < 0.4;
      en.tourner = r() < 0.3; en.bas = r() < 0.2;
    }
    // Un écran à 60 Hz, un peu irrégulier, comme Timer.update le lisse.
    lieu.update(0.5 + r() * 0.07);
  }
  return { score: lieu.score, journal: rec.journal(), tempsJeuMs: rec.tempsDeJeuMs, fini: lieu.fini };
}

/** Une arcade jouée au hasard par le VRAI socle, enregistrée comme dans la page. */
function arcadeHonnete(graine, palier, hasard) {
  const r = de(hasard || 99);
  let fin = null;
  const a = new E.Arcade({ mesures: MESURES, catalogue: JX.JEUX, palier,
    surEvenement: (n, d) => { if (n === 'finPartie') fin = d; } });
  const rec = FR.brancher(a, graine);
  a.demarrer();
  for (let i = 0; !a.termine && i < 400000; i++) {
    const n = Math.floor(r() * 3);
    for (let k = 0; k < n; k++) a.bouger(r() * 240, r() * 240);
    if (r() < 0.08) { a.flTactile = r() < 0.5; a.click(); }
    if (r() < 0.08) a.relache();
    a.update(0.75 + r() * 0.1);
  }
  return { fin, journal: rec.journal(), tempsJeuMs: rec.tempsDeJeuMs };
}

/**
 * UNE épreuve à l'issue voulue : le bac à sable rejoue le tirage de l'épreuve
 * k, essaie des mains au hasard, et garde la première qui donne `veut`.
 */
function epreuveVoulue(graine, k, dif, veut) {
  for (let essai = 0; essai < 400; essai++) {
    const r = de(graine * 31 + k * 977 + essai * 7919 + 1);
    const s = new E.Socle({ mesures: MESURES, catalogue: JX.JEUX });
    const rec = FR.brancher(s, graine, k);
    s.dif = dif;
    s.tirer();
    s.bouger(120, 120);
    s.lancer();
    // Une main sur deux ne fait RIEN : certaines épreuves se gagnent en
    // attendant, d'autres se perdent ainsi à coup sûr.
    const passif = essai % 2 === 1;
    for (let i = 0; rec.epreuves === 0 && i < 4000; i++) {
      if (!passif) {
        if (r() < 0.5) s.bouger(r() * 240, r() * 240);
        if (r() < 0.1) { s.flTactile = false; s.click(); }
        if (r() < 0.1) s.relache();
      }
      s.update(0.8);
    }
    const ep = rec.journal().epreuves[0];
    if (ep && !!ep.g === veut) return ep;
  }
  return null;
}

/**
 * Une arcade construite : `victoires` épreuves gagnées, puis des défaites
 * jusqu'à la fin des vies (ou le palier au bout). Rend le corps à poster
 * (sans sid ni jeton) et ce que la partie vaut.
 */
function arcadeConstruite(graine, palier, victoires) {
  const info = E.PALIERS[palier];
  const eps = [];
  let niveau = 0, vies = info.vies, dif = 0, tmod = 0;
  while (niveau < info.lvl && vies > 0) {
    const veut = niveau < victoires;
    let ep = epreuveVoulue(graine, eps.length, dif, veut);
    if (!ep) ep = epreuveVoulue(graine, eps.length, dif, !veut);
    if (!ep) throw new Error('épreuve introuvable');
    eps.push(ep);
    const lu = FR.lireOps(ep.o);
    for (const o of lu.ops) if (o.t === 0) tmod += 819 * o.n;
    if (ep.g) {
      niveau++;
      if (niveau < info.lvl) dif = info.min + Math.round((info.max - info.min) * (niveau / info.lvl));
    } else vies--;
  }
  const consoleMin = FR.consoleMinimale(E);
  const minimumMs = Math.round((tmod / J.QUANTUM_TMOD + eps.length * consoleMin) / 32 * 1000);
  return {
    corps: { palier, niveau, jouees: eps.length, gagnee: niveau >= info.lvl, journal: { v: FR.VERSION, epreuves: eps } },
    niveau, jouees: eps.length, minimumMs,
    gagnees: eps.filter((e) => e.g).map((e) => e.c),
  };
}

module.exports = { arbreHonnete, arcadeHonnete, arcadeConstruite, epreuveVoulue, MESURES, de };
