/*
 * MiniPixiz — l'ARBRE CREUX, rejoué par le serveur.
 *
 * L'arbre creux est le mode classé (minipixiz_classic, le challenge du jour).
 * Son score était calculé par le navigateur et envoyé tel quel : une ligne de
 * console suffisait à poser n'importe quel nombre au classement. Désormais la
 * partie se PROUVE, comme à Swapou :
 *
 *   1. au départ, le serveur donne la graine (et un jeton qui la scelle) ;
 *   2. pendant la partie, l'enregistreur note ce que le moteur reçoit à chaque
 *      pas — le `tmod` (en 1024es, cf. journal-partie.js) et les quatre
 *      commandes (gauche, droite, bas, tourner) ;
 *   3. à la fin, le journal part avec le score ; le serveur remonte un Arbre
 *      sur la même graine, lui repasse le journal pas à pas, et ne classe que
 *      le score qu'il trouve lui-même — à condition que la partie y soit
 *      finie aussi, et au même pas.
 *
 * Pourquoi c'est sûr : le puzzle ne fait que des additions, des produits et
 * des arrondis (aucun sinus dans ce qui décide d'une bille), et son hasard est
 * mulberry32 sur la graine. Le même journal donne donc la même partie dans
 * tous les navigateurs comme sous Node. La fée, ses sorts et leurs trajectoires
 * — les seuls calculs flottants délicats — ne descendent pas dans l'arbre
 * (base/Tree.initGame n'appelle pas initFaerie).
 *
 * Format du journal : une suite d'entiers (journal-partie.js). Chaque groupe
 * décrit un ou plusieurs pas IDENTIQUES :
 *
 *     a = commandes (4 bits) | 16 si le tmod change | 32 si le pas se répète
 *     [zigzag(tmod − tmod précédent)]   si le tmod change
 *     [répétitions − 2]                 si le pas se répète
 *
 * Le tmod de départ vaut 546 (une image à 60 Hz : 32/60 × 1024).
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const J = sousNode ? require('../js/journal-partie.js') : racine.JournalPartie;

const TMOD_DEPART = 546;
const VERSION = 1;
// Bornes du rejeu : au-delà, ce n'est plus une partie, c'est une attaque.
const PAS_MAX = 2000000;            // ≈ 9 h à 60 Hz — aucune partie n'en approche
const JOURNAL_MAX = 3000000;        // caractères

const bitsDe = (e) => (e.gauche ? 1 : 0) | (e.droite ? 2 : 0) | (e.bas ? 4 : 0) | (e.tourner ? 8 : 0);

/**
 * Branche l'enregistreur sur un lieu Arbre déjà construit (avant sa première
 * image). Le pas est quantifié AVANT d'être joué : la partie qu'on voit est
 * exactement celle que le serveur rejouera.
 */
function brancher(lieu) {
  const pas = [];                 // [q, bits] à plat : q0, b0, q1, b1…
  const original = lieu.update.bind(lieu);
  let tmodTotal = 0;
  lieu.update = function (tmod) {
    if (this.fini) return original(tmod);
    const q = J.quantifierTmod(tmod);
    const e = (this.jeu && this.jeu.entree) || {};
    pas.push(q, bitsDe(e));
    tmodTotal += q;
    return original(q / J.QUANTUM_TMOD);
  };
  return {
    get nombre() { return pas.length / 2; },
    get tempsDeJeuMs() { return Math.round(tmodTotal / J.QUANTUM_TMOD / 32 * 1000); },
    journal() { return encoderPas(pas); },
  };
}

function encoderPas(pas) {
  const out = [];
  let prevQ = TMOD_DEPART;
  let i = 0;
  const n = pas.length / 2;
  while (i < n) {
    const q = pas[i * 2], b = pas[i * 2 + 1];
    let r = 1;
    while (i + r < n && pas[(i + r) * 2] === q && pas[(i + r) * 2 + 1] === b) r++;
    const change = q !== prevQ;
    out.push(b | (change ? 16 : 0) | (r > 1 ? 32 : 0));
    if (change) out.push(q - prevQ);
    if (r > 1) out.push(r - 2);
    prevQ = q;
    i += r;
  }
  return 'A' + VERSION + J.encoder(out);
}

/**
 * Relit un journal en pas [q, bits]. Rend { pas } ou { erreur }.
 */
function lireJournal(texte) {
  const s = String(texte || '');
  if (s.length > JOURNAL_MAX) return { erreur: 'journal trop long' };
  if (s.slice(0, 2) !== 'A' + VERSION) return { erreur: 'journal illisible (version)' };
  const ent = J.decoder(s.slice(2));
  if (!ent) return { erreur: 'journal illisible' };
  const pas = [];
  let prevQ = TMOD_DEPART;
  let i = 0;
  while (i < ent.length) {
    const a = ent[i++];
    if (!(a >= 0 && a < 64)) return { erreur: 'journal illisible (commande)' };
    let q = prevQ;
    if (a & 16) {
      if (i >= ent.length) return { erreur: 'journal coupé' };
      q = prevQ + ent[i++];
    }
    let r = 1;
    if (a & 32) {
      if (i >= ent.length) return { erreur: 'journal coupé' };
      r = ent[i++] + 2;
      if (!(r >= 2)) return { erreur: 'journal illisible (répétition)' };
    }
    if (!(q >= 1 && q <= 2048)) return { erreur: `pas de temps hors bornes (${q}/1024)` };
    if (pas.length / 2 + r > PAS_MAX) return { erreur: 'partie démesurée' };
    for (let k = 0; k < r; k++) pas.push(q, a & 15);
    prevQ = q;
  }
  return { pas };
}

/**
 * Le rejeu. `graine` : celle que le serveur a donnée ; `journal` : le texte
 * rendu par le navigateur. Le module des lieux est passé par l'appelant (le
 * serveur le charge une fois pour toutes).
 *
 * @returns {{ ok: boolean, raison?: string, score: number, fini: boolean,
 *             pas: number, tempsJeuMs: number, tmodMoyen: number,
 *             multi: number, couleurs: number }}
 */
function rejouer(Lieux, graine, journal) {
  const lu = lireJournal(journal);
  const vide = { ok: false, score: 0, fini: false, pas: 0, tempsJeuMs: 0, tmodMoyen: 0, multi: 1, couleurs: 3 };
  if (lu.erreur) return Object.assign(vide, { raison: lu.erreur });
  const pas = lu.pas;
  const n = pas.length / 2;
  if (!n) return Object.assign(vide, { raison: 'journal vide' });
  const a = new Lieux.Arbre({ graine: Number(graine) >>> 0, carte: null });
  const e = a.jeu.entree;
  let total = 0;
  let i = 0;
  for (; i < n; i++) {
    if (a.fini) break;
    const q = pas[i * 2], b = pas[i * 2 + 1];
    e.gauche = !!(b & 1); e.droite = !!(b & 2); e.bas = !!(b & 4); e.tourner = !!(b & 8);
    total += q;
    a.update(q / J.QUANTUM_TMOD);
  }
  const res = {
    score: a.score,
    fini: !!a.fini,
    pas: i,
    tempsJeuMs: Math.round(total / J.QUANTUM_TMOD / 32 * 1000),
    tmodMoyen: i ? total / i / J.QUANTUM_TMOD : 0,
    multi: a.multi,
    couleurs: a.jeu.colorList.length,
  };
  if (!a.fini) return Object.assign(res, { ok: false, raison: `la partie rejouée n'est pas finie (${i} pas joués)` });
  if (i < n) return Object.assign(res, { ok: false, raison: `la partie rejouée finit au pas ${i}, le journal en compte ${n}` });
  return Object.assign(res, { ok: true });
}

const API = { brancher, encoderPas, lireJournal, rejouer, VERSION, TMOD_DEPART };

if (sousNode) module.exports = API;
else racine.MinipixizRejeu = API;

})(typeof window !== 'undefined' ? window : globalThis);
