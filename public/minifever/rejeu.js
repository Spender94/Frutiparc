/*
 * Mini-Fever — l'ARCADE, rejouée par le serveur.
 *
 * Le classement Mini-Fever (minifever_arcade) se calculait sur ce que le
 * navigateur DISAIT de sa partie : un palier, un nombre d'épreuves gagnées, un
 * nombre de jouées. Trois nombres qu'une requête à la main remplissait sans
 * jouer. Désormais chaque épreuve se PROUVE :
 *
 *   1. au départ, le serveur donne la graine de la partie (et un jeton qui la
 *      scelle avec le palier et l'heure) ;
 *   2. chaque épreuve tire son jeu et son hasard d'une graine À ELLE, tirée de
 *      celle de la partie et de son rang (journal-partie.js, graineDe) — une
 *      épreuve se rejoue donc seule, sans dépendre des autres ;
 *   3. l'enregistreur note, de l'apparition de l'épreuve à son verdict, ce que
 *      le socle reçoit : chaque image (son `tmod`, en 1024es), la position du
 *      pointeur quand elle a changé (au quart de pixel), l'appui et le
 *      relâché ;
 *   4. le serveur remonte chaque épreuve sur sa graine, lui repasse le
 *      journal, et ne compte que les victoires qu'il voit lui-même.
 *
 * Le socle est déjà prêt pour ça : son hasard passe par `rng` (jamais par
 * Math.random), et les mini-jeux ne lisent du monde que la souris, l'appui et
 * le temps. Le pointeur est arrondi au quart de pixel, le temps au 1024e
 * d'image : la partie jouée est exactement celle qu'on rejoue.
 *
 * Écriture d'une épreuve (une suite d'entiers, cf. journal-partie.js) :
 *     0 dq          une image (dq : écart au tmod précédent, 819 au départ)
 *     4 dq n        n + 2 images identiques
 *     1 dx dy       le pointeur a bougé (quarts de pixel, depuis la position
 *                   précédente — celle du début de l'épreuve au départ)
 *     2 t           l'appui (t : 1 au doigt, 0 à la souris)
 *     3             le relâché
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const J = sousNode ? require('../js/journal-partie.js') : racine.JournalPartie;

const VERSION = 1;
const TMOD_DEPART = 819;            // 0,8 × 1024 : une image Flash à l'aise
const QUART = 4;                    // le pointeur, au quart de pixel
const OPS_MAX = 200000;             // par épreuve : bien plus qu'une épreuve n'en produit
const IMAGES_MAX = 4000;            // une épreuve dure 200 images au plus (+ sa fin)

const quart = (v) => Math.round((Number(v) || 0) * QUART);

/**
 * Branche l'enregistreur sur une partie d'arcade fraîchement construite (AVANT
 * `demarrer`). Il pose la graine de chaque épreuve, arrondit le temps et le
 * pointeur, et tient le journal.
 */
function brancher(socle, graine, premier) {
  const epreuves = [];
  let k = premier || 0;             // le rang de la prochaine épreuve tirée
  let cur = null;                   // l'épreuve en cours d'enregistrement
  let dirty = false;
  let tmodTotal = 0;                // toutes les images, console comprise
  let qEnCours = 0;                 // le tmod de l'image qui se joue (0 hors image)

  const orig = {
    tirer: socle.tirer.bind(socle),
    lancer: socle.lancer.bind(socle),
    bouger: socle.bouger.bind(socle),
    click: socle.click.bind(socle),
    relache: socle.relache.bind(socle),
    update: socle.update.bind(socle),
    resultat: socle.resultat.bind(socle),
  };

  // Les opérations de l'épreuve en cours, en objets : { t: 0, dq, n } une
  // série d'images, { t: 1, dx, dy } le pointeur, { t: 2, v } l'appui,
  // { t: 3 } le relâché. `serie` : la dernière série d'images, tant que rien
  // d'autre ne s'est glissé derrière elle.
  const pousser = (o) => { cur.ops.push(o); cur.serie = null; };
  const vider = () => {
    if (!cur || !dirty) return;
    const x = quart(socle.souris.x), y = quart(socle.souris.y);
    if (x !== cur.px || y !== cur.py) {
      pousser({ t: 1, dx: x - cur.px, dy: y - cur.py });
      cur.px = x; cur.py = y;
    }
    dirty = false;
  };

  socle.tirer = function () {
    this.rng = J.generateur(J.graineDe(graine, k));
    k++;
    return orig.tirer();
  };
  socle.lancer = function () {
    const x = quart(this.souris.x), y = quart(this.souris.y);
    cur = {
      c: this.suivant ? this.suivant.cle : '', d: this.dif,
      x, y, p: this.flPresse ? 1 : 0, t: this.flTactile ? 1 : 0,
      // L'épreuve naît PENDANT une image : le fondu qui se referme
      // (Socle.majFondu → apresFondu → lancer) passe avant le chrono, et
      // celui-ci décompte donc déjà cette image-là. On note son tmod.
      l: qEnCours,
      ops: [], px: x, py: y, q: TMOD_DEPART, serie: null,
    };
    dirty = false;
    return orig.lancer();
  };
  socle.bouger = function (x, y) {
    orig.bouger(quart(x) / QUART, quart(y) / QUART);
    if (cur) dirty = true;
  };
  socle.click = function () {
    if (cur) { vider(); pousser({ t: 2, v: this.flTactile ? 1 : 0 }); }
    return orig.click();
  };
  socle.relache = function () {
    if (cur) { vider(); pousser({ t: 3 }); }
    return orig.relache();
  };
  socle.update = function (tmod) {
    const q = J.quantifierTmod(tmod);
    tmodTotal += q;
    if (cur) {
      vider();
      if (cur.serie && q === cur.q) {
        cur.serie.n++;              // une image de plus, identique : la série s'allonge
      } else {
        const o = { t: 0, dq: q - cur.q, n: 1 };
        pousser(o);
        cur.serie = o;
        cur.q = q;
      }
    }
    qEnCours = q;
    try { return orig.update(q / J.QUANTUM_TMOD); } finally { qEnCours = 0; }
  };
  socle.resultat = function (gagne) {
    if (cur) {
      epreuves.push({ c: cur.c, d: cur.d, x: cur.x, y: cur.y, p: cur.p, t: cur.t, l: cur.l,
        g: gagne ? 1 : 0, o: encoderOps(cur.ops) });
      cur = null;
    }
    return orig.resultat(gagne);
  };

  return {
    get epreuves() { return epreuves.length; },
    get tempsDeJeuMs() { return Math.round(tmodTotal / J.QUANTUM_TMOD / 32 * 1000); },
    journal() { return { v: VERSION, epreuves: epreuves.slice() }; },
  };
}

function encoderOps(liste) {
  const ent = [];
  for (const o of liste) {
    if (o.t === 0) {
      if (o.n > 1) ent.push(4, o.dq, o.n - 2);
      else ent.push(0, o.dq);
    } else if (o.t === 1) ent.push(1, o.dx, o.dy);
    else if (o.t === 2) ent.push(2, o.v);
    else ent.push(3);
  }
  return J.encoder(ent);
}

/** Relit les opérations d'une épreuve. Rend { ops } ou { erreur }. */
function lireOps(texte) {
  const ent = J.decoder(texte, OPS_MAX);
  if (!ent) return { erreur: 'journal illisible' };
  const ops = [];
  let i = 0;
  const lire = () => (i < ent.length ? ent[i++] : NaN);
  while (i < ent.length) {
    const c = lire();
    if (c === 0) ops.push({ t: 0, dq: lire(), n: 1 });
    else if (c === 4) ops.push({ t: 0, dq: lire(), n: lire() + 2 });
    else if (c === 1) ops.push({ t: 1, dx: lire(), dy: lire() });
    else if (c === 2) ops.push({ t: 2, v: lire() });
    else if (c === 3) ops.push({ t: 3 });
    else return { erreur: 'journal illisible (opération)' };
    const o = ops[ops.length - 1];
    for (const v of Object.values(o)) if (!Number.isFinite(v)) return { erreur: 'journal coupé' };
    if (o.t === 0 && !(o.n >= 1)) return { erreur: 'journal illisible (série)' };
  }
  return { ops };
}

/**
 * Rejoue UNE épreuve. `ctx` porte le moteur (E), le catalogue (JEUX) et les
 * mesures des dessins ; `ep` est l'épreuve telle que le journal la décrit.
 *
 * @returns {{ ok: boolean, gagne: boolean|null, raison?: string,
 *             images: number, tmod: number }}  tmod : la somme jouée, en 1024es
 */
function rejouerEpreuve(ctx, graine, k, ep) {
  const { E, JEUX, mesures } = ctx;
  const res = { ok: false, gagne: null, images: 0, tmod: 0 };
  const lu = lireOps(ep && ep.o);
  if (lu.erreur) return Object.assign(res, { raison: lu.erreur });
  const socle = new E.Socle({ mesures, catalogue: JEUX, rng: J.generateur(J.graineDe(graine, k)) });
  socle.dif = Math.trunc(Number(ep.d) || 0);
  socle.tirer();
  if (!socle.suivant || socle.suivant.cle !== ep.c) {
    return Object.assign(res, { raison: `épreuve ${k + 1} : le tirage donne ${socle.suivant && socle.suivant.cle}, le journal dit ${ep.c}` });
  }
  let x = Math.trunc(Number(ep.x) || 0), y = Math.trunc(Number(ep.y) || 0);
  socle.souris.x = x / QUART; socle.souris.y = y / QUART;
  socle.flPresse = !!ep.p;
  socle.flTactile = !!ep.t;
  let verdict = null;
  socle.resultat = (g) => { verdict = !!g; socle.flTimer = false; };
  // L'image où l'épreuve est née (cf. brancher) : le moteur la voyait passer,
  // le chrono en décomptait la fin.
  const l = Math.trunc(Number(ep.l) || 0);
  if (!(l >= 0 && l <= 16 * J.QUANTUM_TMOD)) return Object.assign(res, { raison: `épreuve ${k + 1} : image de départ illisible` });
  if (l) E.Temps.tmod = l / J.QUANTUM_TMOD;
  socle.lancer();
  if (l && socle.flTimer && socle.jeu) {
    res.tmod += l;
    socle.timer -= l / J.QUANTUM_TMOD;
    if (socle.timer < 0) { socle.jeu.horsTemps(); socle.timer = 0; }
  }
  let q = TMOD_DEPART;
  for (let i = 0; i < lu.ops.length; i++) {
    const o = lu.ops[i];
    if (verdict !== null) return Object.assign(res, { raison: `épreuve ${k + 1} : le journal continue après le verdict` });
    if (o.t === 0) {
      q += o.dq;
      if (!(q >= 1 && q <= 16 * J.QUANTUM_TMOD)) return Object.assign(res, { raison: `épreuve ${k + 1} : pas de temps hors bornes (${q}/1024)` });
      for (let n = 0; n < o.n; n++) {
        if (verdict !== null) return Object.assign(res, { raison: `épreuve ${k + 1} : le journal continue après le verdict` });
        if (++res.images > IMAGES_MAX) return Object.assign(res, { raison: `épreuve ${k + 1} : démesurée` });
        res.tmod += q;
        socle.update(q / J.QUANTUM_TMOD);
      }
    } else if (o.t === 1) {
      x += o.dx; y += o.dy;
      socle.bouger(x / QUART, y / QUART);
    } else if (o.t === 2) {
      socle.flTactile = !!o.v;
      socle.click();
    } else {
      socle.relache();
    }
  }
  if (verdict === null) return Object.assign(res, { raison: `épreuve ${k + 1} : inachevée` });
  return Object.assign(res, { ok: true, gagne: verdict });
}

/**
 * Le déroulé d'une arcade, recalculé à partir des verdicts DÉCLARÉS : la
 * difficulté de chaque épreuve (Arcade.incLevel — zéro tant que rien n'est
 * gagné, puis min + (max − min) × niveau / lvl), et la fin de partie (le
 * palier au bout, ou plus de vies). Un journal dont les épreuves ne suivent
 * pas cette règle ne vient pas du jeu.
 *
 * @returns {{ ok: boolean, raison?: string, niveau: number, jouees: number,
 *             gagnee: boolean, difs: number[] }}
 */
function derouler(palierInfo, verdicts) {
  const o = palierInfo;
  let niveau = 0, vies = o.vies, dif = 0;
  const difs = [];
  for (let i = 0; i < verdicts.length; i++) {
    if (niveau >= o.lvl || vies <= 0) return { ok: false, raison: `épreuve ${i + 1} jouée après la fin de partie`, niveau, jouees: i, gagnee: niveau >= o.lvl, difs };
    difs.push(dif);
    if (verdicts[i]) {
      niveau++;
      if (niveau < o.lvl) dif = o.min + Math.round((o.max - o.min) * (niveau / o.lvl));
    } else {
      vies--;
    }
  }
  const gagnee = niveau >= o.lvl;
  if (!gagnee && vies > 0) return { ok: false, raison: 'partie interrompue (ni palier fini, ni vies épuisées)', niveau, jouees: verdicts.length, gagnee, difs };
  return { ok: true, niveau, jouees: verdicts.length, gagnee, difs };
}

/**
 * La durée MINIMALE de la console entre deux épreuves (débriefing, tirage,
 * briefing et les fondus), en images, mesurée sur le moteur lui-même : une
 * arcade dont chaque épreuve se gagne dès sa première image. Le serveur s'en
 * sert pour savoir combien de temps une partie de n épreuves prend AU MOINS.
 */
function consoleMinimale(E) {
  class Eclair extends E.Jeu {
    init() { super.init(); this.gameTime = 200; }
    update() { if (this.etapePrincipale === 1) this.gagne(true); super.update(); }
  }
  let t = 0, finDerniere = null, mesure = null;
  const a = new E.Arcade({
    catalogue: [{ cle: 'eclair', Classe: Eclair }], rng: J.generateur(1), palier: 0,
    surEvenement: (n) => {
      if (n === 'resultat') finDerniere = t;
      if (n === 'jeu' && finDerniere !== null && mesure === null) mesure = t - finDerniere;
    },
  });
  a.demarrer();
  for (let i = 0; i < 5000 && mesure === null; i++) { a.update(1); t += 1; }
  return mesure || 0;
}

const API = { brancher, lireOps, rejouerEpreuve, derouler, consoleMinimale, VERSION, QUART, TMOD_DEPART };

if (sousNode) module.exports = API;
else racine.MinifeverRejeu = API;

})(typeof window !== 'undefined' ? window : globalThis);
