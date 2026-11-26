/*
 * MiniPixiz — l'IA de l'ARBRE CREUX, pour la capture (Node, hors navigateur).
 *
 * Elle joue une partie d'Arbre creux dans le VRAI moteur (lieux.js, comme le
 * rejeu du serveur : public/minipixiz/rejeu.js), pas à pas, au tmod d'un écran
 * à 60 Hz (546/1024), et en tient le JOURNAL : les quatre commandes (gauche,
 * droite, bas, tourner) à chaque pas. Le journal, rejoué dans la page avec la
 * même graine, redonne la même partie — c'est exactement la garantie sur
 * laquelle le classement de l'arbre repose (le serveur rejoue les journaux).
 *
 * La décision, à chaque nouvelle pièce : toutes les poses possibles (quatre
 * rotations × neuf colonnes) sont simulées sur une copie légère de la grille
 * — chute, gravité, groupes de quatre, souffle sur les armures, étoiles,
 * cascade —, puis la pièce suivante (deux coups d'avance). L'évaluation :
 * les points de la cascade (au barème de l'arbre, où le 2ᵉ maillon vaut cinq
 * fois le premier), les paires et trios de même couleur qui préparent la
 * suivante, et la hauteur, qu'on garde loin de la ligne de mort.
 *
 * L'exécution : tourner (un appui par quart de tour, relâché entre deux),
 * glisser vers la colonne, puis « bas » pour poser. Un joueur pressé, mais
 * qui joue des touches comme tout le monde.
 */
'use strict';

const path = require('path');

const RACINE = path.resolve(__dirname, '../../../..');
const E = require(path.join(RACINE, 'public/minipixiz/engine.js'));
const L = require(path.join(RACINE, 'public/minipixiz/lieux.js'));
const PR = require(path.join(RACINE, 'public/minipixiz/rejeu.js'));

const Q = 546;                        // tmod quantifié d'une image à 60 Hz (rejeu.js)
const VALEURS = [1, 5, 7, 8, 9, 10];  // ARBRE_VALEURS (lieux.js)

// ── La grille légère ──────────────────────────────────────────────────────

function copier(jeu) {
  const g = [];
  for (let x = 0; x < jeu.xMax; x++) {
    g[x] = [];
    for (let y = 0; y < jeu.yMax; y++) {
      const e = jeu.grille[x][y];
      g[x][y] = e ? { j: e.et === E.E.JETON, c: e.type, s: e.special || 0 } : null;
    }
  }
  return g;
}
const clone = (g) => g.map((col) => col.map((c) => (c ? { j: c.j, c: c.c, s: c.s } : null)));

// Les cases d'une liste {x,y} après r quarts de tour (Piece.tourner, sens 1).
function tournee(liste, r) {
  let xMin = 0, xMax = 0, yMin = 0, yMax = 0;
  for (const o of liste) { xMin = Math.min(xMin, o.x); xMax = Math.max(xMax, o.x); yMin = Math.min(yMin, o.y); yMax = Math.max(yMax, o.y); }
  const dRot = Math.min(Math.round((xMax - xMin) % 2), Math.round((yMax - yMin) % 2)) * 0.5;
  let l = liste.map((o) => ({ x: o.x, y: o.y, c: o.c, s: o.s }));
  for (let k = 0; k < r; k++) {
    l = l.map((o) => {
      const x = o.x - dRot, y = o.y - dRot;
      return { x: Math.round(-y + dRot), y: Math.round(x + dRot), c: o.c, s: o.s };
    });
  }
  return l;
}

const libre = (g, x, y) => x >= 0 && x < g.length && y < g[0].length && (y < 0 || !g[x][y]);
function tient(g, l, x, y) { for (const o of l) if (!libre(g, o.x + x, o.y + y)) return false; return true; }

// Gravité : chaque colonne se tasse (tout élément sans sol tombe).
function tasser(g) {
  const H = g[0].length;
  for (let x = 0; x < g.length; x++) {
    let w = H - 1;
    for (let y = H - 1; y >= 0; y--) {
      if (g[x][y]) { const e = g[x][y]; g[x][y] = null; g[x][w--] = e; }
    }
  }
}

// La cascade : rend { points, maillons, detruits }.
function cascade(g, multi) {
  const W = g.length, H = g[0].length;
  let points = 0, maillons = 0, detruits = 0;
  for (let garde = 0; garde < 30; garde++) {
    tasser(g);
    const vu = [];
    for (let x = 0; x < W; x++) vu[x] = new Array(H).fill(false);
    const aDetruire = [];
    let somme = 0;
    const couleursEtoile = new Set();
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const e = g[x][y];
      if (!e || !e.j || e.s === 2 || vu[x][y]) continue;
      const pile = [[x, y]], groupe = [];
      vu[x][y] = true;
      while (pile.length) {
        const [a, b] = pile.pop();
        groupe.push([a, b]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const u = a + dx, v = b + dy;
          if (u < 0 || v < 0 || u >= W || v >= H || vu[u][v]) continue;
          const f = g[u][v];
          if (!f || !f.j || f.s === 2 || f.c !== e.c) continue;
          vu[u][v] = true; pile.push([u, v]);
        }
      }
      const taille = groupe.filter(([a, b]) => g[a][b].s !== 1).length;
      if (taille >= 4) {
        somme += taille;
        for (const p of groupe) { aDetruire.push(p); if (g[p[0]][p[1]].s === 3) couleursEtoile.add(e.c); }
      }
    }
    if (!aDetruire.length) break;
    if (couleursEtoile.size) {
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
        const e = g[x][y];
        if (e && e.j && couleursEtoile.has(e.c)) aDetruire.push([x, y]);
      }
    }
    const tues = new Set(aDetruire.map(([a, b]) => a * 100 + b));
    // Le souffle : les armures voisines redeviennent des jetons.
    for (const k of tues) {
      const a = Math.floor(k / 100), b = k % 100;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = a + dx, v = b + dy;
        if (u < 0 || v < 0 || u >= W || v >= H || tues.has(u * 100 + v)) continue;
        const f = g[u][v];
        if (f && f.j && f.s === 2) f.s = 0;
      }
    }
    for (const k of tues) g[Math.floor(k / 100)][k % 100] = null;
    points += somme * VALEURS[Math.min(maillons, 5)] * multi;
    detruits += tues.size;
    maillons++;
  }
  return { points, maillons, detruits };
}

// Ce que vaut une grille au repos.
function evaluer(g) {
  const W = g.length, H = g[0].length;
  let v = 0, hMax = 0;
  for (let x = 0; x < W; x++) {
    let h = 0;
    for (let y = 0; y < H; y++) if (g[x][y]) { h = H - y; break; }
    hMax = Math.max(hMax, h);
    v -= Math.pow(Math.max(0, h - 6), 2) * 3;
    if (g[x][2] || g[x][3]) v -= 5000;               // la ligne de mort (Game.checkFull : ligne 2)
    else if (g[x][4] || g[x][5]) v -= 600;
  }
  // Les paires et trios connexes de même couleur : la cascade suivante.
  const W2 = W, vu = [];
  for (let x = 0; x < W2; x++) vu[x] = new Array(H).fill(false);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    const e = g[x][y];
    if (!e || !e.j || e.s === 2 || vu[x][y]) continue;
    let n = 0;
    const pile = [[x, y]]; vu[x][y] = true;
    while (pile.length) {
      const [a, b] = pile.pop(); n++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = a + dx, w = b + dy;
        if (u < 0 || w < 0 || u >= W || w >= H || vu[u][w]) continue;
        const f = g[u][w];
        if (!f || !f.j || f.s === 2 || f.c !== e.c) continue;
        vu[u][w] = true; pile.push([u, w]);
      }
    }
    if (n === 2) v += 14; else if (n === 3) v += 40;
  }
  return v;
}

// Toutes les poses d'une forme : { r, x, grille, gain }.
function poses(g, forme, yDepart, multi) {
  const res = [];
  const vus = new Set();
  for (let r = 0; r < 4; r++) {
    const l = tournee(forme, r);
    const cle = l.map((o) => o.x + ',' + o.y).sort().join(';');
    if (vus.has(cle)) continue;
    vus.add(cle);
    for (let x = -3; x < g.length + 3; x++) {
      if (!tient(g, l, x, yDepart)) continue;
      let y = yDepart;
      while (tient(g, l, x, y + 1)) y++;
      const g2 = clone(g);
      for (const o of l) if (o.y + y >= 0) g2[o.x + x][o.y + y] = { j: true, c: o.c, s: o.s };
      const c = cascade(g2, multi);
      res.push({ r, x, grille: g2, gain: c });
    }
  }
  return res;
}

function choisir(jeu, multi) {
  const g = copier(jeu);
  const forme = jeu.piece.list.map((o) => ({ x: o.x, y: o.y, c: o.e.type, s: o.e.special || 0 }));
  const suivante = (jeu.nextPiece || jeu.nextList[0] || []).map((o) => ({ x: o.x, y: o.y, c: o.e.type, s: o.e.special || 0 }));
  const yd = Math.max(0, jeu.piece.y);
  let best = null;
  for (const p of poses(g, forme, yd, multi)) {
    const v1 = p.gain.points * 3 + (p.gain.maillons >= 2 ? 150 * p.gain.maillons : 0);
    let v2 = -Infinity;
    if (suivante.length) {
      for (const q of poses(p.grille, suivante, 0, multi)) {
        const v = q.gain.points * 2.4 + (q.gain.maillons >= 2 ? 120 * q.gain.maillons : 0) + evaluer(q.grille);
        if (v > v2) v2 = v;
      }
    } else v2 = evaluer(p.grille);
    const v = v1 + v2;
    if (!best || v > best.v) best = { r: p.r, x: p.x, v, gain: p.gain };
  }
  return best;
}

/*
 * Joue une partie. Rend { graine, journal (texte du rejeu), pas: [bits…],
 * evenements: [{ pas, chaine, nombre, score }], score, fini }.
 */
function jouer(graine, opts) {
  const o = Object.assign({ pasMax: 60 * 60 * 6 }, opts || {});
  const a = new L.Arbre({ graine: graine >>> 0, carte: null });
  const jeu = a.jeu;
  const e = jeu.entree;
  const bits = [];
  const evenements = [];
  // Le moteur annonce ses destructions : on les relève (pas, maillon, nombre).
  let pasCourant = 0;
  const orig = jeu.onEvent;
  jeu.onEvent = (nom, d) => {
    if (nom === 'destruction') evenements.push({ pas: pasCourant, chaine: d.chaine, nombre: d.nombre });
    if (orig) orig(nom, d);
  };
  let piece = null, plan = null, rotations = 0, tournait = false, lache = 0;
  const scores = [];                   // le score toutes les 60 images (pour vérifier le rejeu de la page)
  for (let i = 0; i < o.pasMax && !a.fini; i++) {
    pasCourant = i;
    if (i % 60 === 0) scores.push(a.score);
    e.gauche = e.droite = e.bas = e.tourner = false;
    if (jeu.step === E.ETAPE.JEU && jeu.piece && !jeu.piece.posee) {
      if (jeu.piece !== piece) {
        piece = jeu.piece;
        plan = choisir(jeu, a.multi || 1);
        rotations = plan ? plan.r : 0;
        tournait = false;
        lache = 0;
      }
      if (plan) {
        if (rotations > 0) {
          // Un appui par quart de tour, relâché entre deux (Piece.flTurn).
          if (!tournait) { e.tourner = true; tournait = true; rotations--; } else tournait = false;
        } else if (tournait) {
          tournait = false;
        } else {
          const p = jeu.piece;
          if (p.x < plan.x || (p.x === plan.x && p.cx < -0.01)) e.droite = true;
          else if (p.x > plan.x || (p.x === plan.x && p.cx > 0.01)) e.gauche = true;
          else if (p.slideWay === 0) {
            // En place : un relâché de « bas » (le boost ne prend qu'après), puis bas.
            if (lache < 2) lache++; else e.bas = true;
          }
        }
      }
    }
    bits.push((e.gauche ? 1 : 0) | (e.droite ? 2 : 0) | (e.bas ? 4 : 0) | (e.tourner ? 8 : 0));
    a.update(Q / 1024);
  }
  // Le journal au format du rejeu (tmod constant) — et sa vérification par le rejeu du serveur.
  const pas = [];
  for (const b of bits) pas.push(Q, b);
  const journal = PR.encoderPas(pas);
  const verif = PR.rejouer(L, graine >>> 0, journal);
  return { graine, journal, bits, evenements, scores, score: a.score, multi: a.multi, fini: !!a.fini, pas: bits.length, verif: { score: verif.score, pas: verif.pas, fini: verif.fini } };
}

module.exports = { jouer, choisir, cascade, evaluer, tournee, Q };
