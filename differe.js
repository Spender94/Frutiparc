'use strict';
/*
 * LES PARTIES EN DIFFÉRÉ — Grapiz et Frutibandas par correspondance.
 *
 * Une partie en direct exige deux joueurs devant leur écran au même moment.
 * En différé, chacun joue son coup quand il passe, et dispose de TROIS JOURS
 * pour le faire ; passé ce délai, la partie est perdue par forfait. On y joue
 * en AMICAL ou en CHAMPIONNAT (la note d'Elo bouge comme en direct), jamais au
 * Challenge : une série « à une vie » ne se joue pas à tempo libre.
 *
 * Ce module tient le CYCLE DE VIE d'une partie :
 *
 *   invitation ──accepter──▶ en_cours ──(fin, forfait, délai)──▶ finie
 *        │                       │
 *     refuser / 3 jours      un coup = l'échéance repart à 3 jours ;
 *     sans réponse           la veille, un rappel au joueur qui doit jouer.
 *
 * Il ne connaît ni les RÈGLES d'un jeu (le pont réseau de chaque jeu applique
 * les coups par ses sessions et lui rend l'état à garder), ni la base, ni les
 * sockets : il rend des résultats et appelle des hooks —
 *   · onSauver(partie) / onSupprimer(id) : la persistance (une partie dort des
 *     jours, elle doit survivre à un redémarrage) ;
 *   · onNotifier({ type, vers, de, partie }) : « X a joué ! À ton tour »,
 *     l'invitation, le rappel, la fin — in-app et sur le téléphone ;
 *   · onFin(partie) : la partie est conclue (note Elo, tournoi, voyants…).
 * L'horloge est injectable : les tests font passer trois jours en une ligne.
 *
 * Une partie est un objet nu, sérialisable tel quel :
 *   { id, jeu, salle, joueurs:[a, b], noms:[…], bouilles:[…], params,
 *     statut:'invitation'|'en_cours'|'finie', tour:0|1, echeance, rappele,
 *     etat (propre au jeu, null tant qu'on n'a pas commencé), coups,
 *     gagnant:null|0|1|-2, raison, cree_le, maj_le, fini_le }
 * `joueurs[0]` est celui qui a invité : il tient l'équipe 0.
 */

const DELAI_COUP = 3 * 24 * 3600 * 1000;      // trois jours par coup
const DELAI_INVITATION = DELAI_COUP;          // une invitation sans réponse s'éteint au bout de trois jours
const RAPPEL_AVANT = 24 * 3600 * 1000;        // la veille de l'échéance, un rappel
const GARDE_FINIES = 7 * 24 * 3600 * 1000;    // une partie finie reste lisible une semaine
const MAX_EN_COURS = 10;                      // parties en cours (invitations comprises) par joueur et par jeu
const SALLES = Object.freeze(['amical', 'champ']);

const cle = (s) => String(s == null ? '' : s).toLowerCase();
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class Differe {
  /**
   * @param {object} opts
   *   jeu        'grapiz' | 'bandas' (porté par chaque partie)
   *   moteur     { nouveau(partie) → etat, tourDe(etat) → 0|1 } : l'état de
   *              départ d'une partie et qui l'ouvre — la seule chose que le
   *              module demande au jeu.
   *   clock      () → ms ; identite(username) → { name, fb } ; existe(username) → bool
   *   onSauver, onSupprimer, onNotifier, onFin : voir en tête.
   *   delai, delaiInvitation, rappelAvant, garde, maxEnCours : les réglages.
   */
  constructor(opts) {
    opts = opts || {};
    this.jeu = opts.jeu || 'jeu';
    this.moteur = opts.moteur || { nouveau: () => ({}), tourDe: () => 0 };
    this.clock = opts.clock || (() => Date.now());
    this.identite = opts.identite || ((u) => ({ name: u, fb: '' }));
    this.existe = opts.existe || (() => true);
    this.onSauver = opts.onSauver || (() => {});
    this.onSupprimer = opts.onSupprimer || (() => {});
    this.onNotifier = opts.onNotifier || (() => {});
    this.onFin = opts.onFin || (() => {});
    this.delai = opts.delai || DELAI_COUP;
    this.delaiInvitation = opts.delaiInvitation || DELAI_INVITATION;
    this.rappelAvant = opts.rappelAvant === undefined ? RAPPEL_AVANT : opts.rappelAvant;
    this.garde = opts.garde || GARDE_FINIES;
    this.maxEnCours = opts.maxEnCours || MAX_EN_COURS;
    this.ids = opts.ids || null;
    this.parties = new Map();   // id → partie
    this._seq = 0;
  }

  // ── Mémoire ───────────────────────────────────────────────────────────────
  /** Au démarrage : les parties que la base connaît. */
  charger(liste) {
    for (const p of liste || []) if (p && p.id) this.parties.set(p.id, p);
    return this.parties.size;
  }
  partie(id) { return this.parties.get(String(id || '')) || null; }
  toutes() { return Array.from(this.parties.values()); }
  /** Les parties d'un joueur : d'abord celles où c'est à lui, puis le reste, les plus récentes en tête. */
  mesParties(username) {
    const u = cle(username);
    return this.toutes().filter((p) => p.joueurs.indexOf(u) >= 0)
      .sort((a, b) => this._rang(a, u) - this._rang(b, u) || (b.maj_le || 0) - (a.maj_le || 0));
  }
  _rang(p, u) {
    if (p.statut === 'invitation') return p.joueurs[1] === u ? 0 : 2;   // une invitation à répondre passe devant
    if (p.statut === 'en_cours') return p.joueurs[p.tour] === u ? 1 : 2;
    return 3;
  }
  nbEnCours(username) {
    const u = cle(username);
    return this.toutes().filter((p) => p.statut !== 'finie' && p.joueurs.indexOf(u) >= 0).length;
  }
  _entre(a, b, salle) {
    return this.toutes().find((p) => p.statut !== 'finie' && p.salle === salle
      && p.joueurs.indexOf(a) >= 0 && p.joueurs.indexOf(b) >= 0) || null;
  }
  _id() {
    if (this.ids) return this.ids();
    // Unique après redémarrage : l'instant, puis un compteur de séance.
    return this.jeu.slice(0, 1) + this.clock().toString(36) + (++this._seq).toString(36);
  }
  _sauver(p, now) { p.maj_le = now; this.onSauver(p); return p; }
  _notifier(type, vers, de, p) {
    try { this.onNotifier({ type, vers, de, partie: p }); } catch (e) { /* la partie prime */ }
  }

  // ── Invitations ───────────────────────────────────────────────────────────
  /**
   * `de` invite `vers` à une partie de `salle`. Rend { ok, partie } ou
   * { ok:false, error } : self-invite, salle inconnue, inconnu, déjà une
   * partie entre eux dans cette salle, trop de parties en cours.
   */
  inviter(de, vers, salle, params, now) {
    now = now === undefined ? this.clock() : now;
    const a = cle(de), b = cle(vers);
    if (!a || !b) return { ok: false, error: 'unknown-player' };
    if (a === b) return { ok: false, error: 'self-challenge' };
    if (SALLES.indexOf(salle) < 0) return { ok: false, error: 'bad-room' };
    if (!this.existe(b)) return { ok: false, error: 'unknown-player' };
    if (this._entre(a, b, salle)) return { ok: false, error: 'already-playing' };
    if (this.nbEnCours(a) >= this.maxEnCours) return { ok: false, error: 'too-many-games' };
    if (this.nbEnCours(b) >= this.maxEnCours) return { ok: false, error: 'target-busy' };
    const ia = this.identite(a) || {}, ib = this.identite(b) || {};
    const p = {
      id: this._id(), jeu: this.jeu, salle,
      joueurs: [a, b], noms: [ia.name || a, ib.name || b], bouilles: [ia.fb || '', ib.fb || ''],
      params: params || {},
      statut: 'invitation', tour: 1, echeance: now + this.delaiInvitation, rappele: false,
      etat: null, coups: 0, gagnant: null, raison: null,
      cree_le: now, maj_le: now, fini_le: null,
    };
    this.parties.set(p.id, p);
    this._sauver(p, now);
    this._notifier('invitation', b, a, p);
    return { ok: true, partie: p };
  }

  /** L'invité accepte : la partie commence, et celui qui doit l'ouvrir est prévenu s'il n'est pas l'accepteur. */
  accepter(username, id, now) {
    now = now === undefined ? this.clock() : now;
    const u = cle(username), p = this.partie(id);
    if (!p || p.statut !== 'invitation') return { ok: false, error: 'no-such-challenge' };
    if (p.joueurs[1] !== u) return { ok: false, error: 'not-invited' };
    // Les têtes peuvent avoir changé depuis l'invitation : on les rafraîchit.
    p.joueurs.forEach((j, i) => { const id2 = this.identite(j) || {}; if (id2.name) p.noms[i] = id2.name; if (id2.fb) p.bouilles[i] = id2.fb; });
    p.etat = this.moteur.nouveau(p);
    p.tour = this.moteur.tourDe(p.etat) ? 1 : 0;
    p.statut = 'en_cours';
    p.echeance = now + this.delai;
    p.rappele = false;
    p.coups = 0;
    this._sauver(p, now);
    this._notifier('acceptee', p.joueurs[0], u, p);
    return { ok: true, partie: p };
  }

  /** L'invité décline, ou l'hôte retire son invitation : elle disparaît. */
  refuser(username, id, now) {
    now = now === undefined ? this.clock() : now;
    const u = cle(username), p = this.partie(id);
    if (!p || p.statut !== 'invitation') return { ok: false, error: 'no-such-challenge' };
    const i = p.joueurs.indexOf(u);
    if (i < 0) return { ok: false, error: 'not-a-player' };
    this.parties.delete(p.id);
    this.onSupprimer(p.id);
    if (i === 1) this._notifier('refus', p.joueurs[0], u, p);
    return { ok: true, partie: p, touches: p.joueurs.slice() };
  }

  // ── Les coups ─────────────────────────────────────────────────────────────
  /**
   * Avant d'appliquer un coup : la partie existe, est en cours, c'est bien le
   * tour de ce joueur, et l'échéance n'est pas passée — sinon la partie est
   * perdue par forfait sur-le-champ (error 'delai', la partie finie jointe).
   * Rend { ok, partie, team }.
   */
  coupAutorise(username, id, now) {
    now = now === undefined ? this.clock() : now;
    const u = cle(username), p = this.partie(id);
    if (!p || p.statut === 'invitation') return { ok: false, error: 'no-such-game' };
    if (p.statut === 'finie') return { ok: false, error: 'game-ended', partie: p };
    const team = p.joueurs.indexOf(u);
    if (team < 0) return { ok: false, error: 'not-a-player' };
    if (team !== p.tour) return { ok: false, error: 'not-your-turn', partie: p };
    if (now >= p.echeance) {
      this._terminer(p, 1 - p.tour, 'delai', now, null);
      return { ok: false, error: 'delai', partie: p };
    }
    return { ok: true, partie: p, team };
  }

  /**
   * Après un coup accepté par le jeu. `res` : { tour (l'équipe qui doit jouer
   * ensuite), fini, gagnant, raison }. L'échéance repart à trois jours et
   * l'adversaire est prévenu — « X a joué ! À ton tour ».
   */
  apresCoup(id, etat, res, now) {
    now = now === undefined ? this.clock() : now;
    const p = this.partie(id);
    if (!p || p.statut !== 'en_cours') return { ok: false, error: 'no-such-game' };
    const acteur = p.joueurs[p.tour];
    p.etat = etat;
    p.coups = (p.coups || 0) + 1;
    if (res && res.fini) {
      this._terminer(p, res.gagnant, res.raison === 'timeout' ? 'delai' : (res.raison || 'victory'), now, acteur);
      return { ok: true, partie: p };
    }
    const suivant = (res && res.tour !== undefined && res.tour !== null) ? (res.tour ? 1 : 0) : 1 - p.tour;
    p.tour = suivant;
    p.echeance = now + this.delai;
    p.rappele = false;
    this._sauver(p, now);
    if (suivant !== p.joueurs.indexOf(acteur)) this._notifier('tour', p.joueurs[suivant], acteur, p);
    return { ok: true, partie: p };
  }

  /** Abandon : l'adversaire gagne. */
  abandonner(username, id, now) {
    now = now === undefined ? this.clock() : now;
    const u = cle(username), p = this.partie(id);
    if (!p || p.statut !== 'en_cours') return { ok: false, error: 'no-such-game' };
    const team = p.joueurs.indexOf(u);
    if (team < 0) return { ok: false, error: 'not-a-player' };
    this._terminer(p, 1 - team, 'forfeit', now, u);
    return { ok: true, partie: p };
  }

  // Conclut : statut, vainqueur, raison ; la persistance ; le hook de fin ; et
  // la nouvelle à ceux qui n'étaient pas là (tous sauf l'acteur). Au délai
  // dépassé, les deux sont prévenus — personne n'a agi.
  _terminer(p, gagnant, raison, now, acteur) {
    p.statut = 'finie';
    p.gagnant = (gagnant === undefined) ? null : gagnant;
    p.raison = raison;
    p.fini_le = now;
    p.echeance = null;
    this._sauver(p, now);
    try { this.onFin(p); } catch (e) { /* la partie est finie quoi qu'il arrive */ }
    for (const j of p.joueurs) {
      if (j === acteur) continue;
      this._notifier(raison === 'delai' ? 'delai' : 'fin', j, acteur, p);
    }
  }

  // ── Le balayage ───────────────────────────────────────────────────────────
  /**
   * Périodique : invitations sans réponse retirées, coups en retard = forfait,
   * rappels la veille, parties finies oubliées au bout d'une semaine. Rend les
   * joueurs dont la liste a changé (à rafraîchir).
   */
  tick(now) {
    now = now === undefined ? this.clock() : now;
    const touches = new Set();
    for (const p of this.toutes()) {
      if (p.statut === 'invitation') {
        if (now >= p.echeance) {
          this.parties.delete(p.id);
          this.onSupprimer(p.id);
          this._notifier('expiree', p.joueurs[0], p.joueurs[1], p);
          p.joueurs.forEach((j) => touches.add(j));
        }
      } else if (p.statut === 'en_cours') {
        if (now >= p.echeance) {
          this._terminer(p, 1 - p.tour, 'delai', now, null);
          p.joueurs.forEach((j) => touches.add(j));
        } else if (!p.rappele && this.rappelAvant > 0 && p.echeance - now <= this.rappelAvant) {
          p.rappele = true;
          this._sauver(p, now);
          this._notifier('rappel', p.joueurs[p.tour], p.joueurs[1 - p.tour], p);
        }
      } else if (p.statut === 'finie' && p.fini_le && now - p.fini_le >= this.garde) {
        this.parties.delete(p.id);
        this.onSupprimer(p.id);
        p.joueurs.forEach((j) => touches.add(j));
      }
    }
    return Array.from(touches);
  }

  // ── Ce que voit un joueur ─────────────────────────────────────────────────
  /**
   * La liste d'un joueur en XML : <tag e="dlist">…<d …/>…</tag>. Chaque <d> :
   *   id, sa (salle), st (statut), a/b (pseudos), na/nb (noms), fa/fb
   *   (bouilles), moi (mon équipe), tour, ech (ms restants), coups, w, r,
   *   maj (ms depuis le dernier mouvement).
   */
  xmlListe(username, tag, now) {
    now = now === undefined ? this.clock() : now;
    const u = cle(username);
    const lignes = this.mesParties(u).map((p) => this.xmlPartie(p, u, now)).join('');
    return `<${tag} e="dlist" n="${this.nbEnCours(u)}" max="${this.maxEnCours}" delai="${this.delai}">${lignes}</${tag}>`;
  }
  xmlPartie(p, username, now) {
    const u = cle(username);
    const moi = p.joueurs.indexOf(u);
    return `<d id="${esc(p.id)}" sa="${esc(p.salle)}" st="${esc(p.statut)}"`
      + ` a="${esc(p.joueurs[0])}" b="${esc(p.joueurs[1])}" na="${esc(p.noms[0])}" nb="${esc(p.noms[1])}"`
      + ` fa="${esc(p.bouilles[0])}" fb="${esc(p.bouilles[1])}" moi="${moi}" tour="${p.tour}"`
      + ` ech="${p.echeance ? Math.max(0, p.echeance - now) : 0}" coups="${p.coups || 0}"`
      + (p.statut === 'finie' ? ` w="${p.gagnant == null ? '' : p.gagnant}" r="${esc(p.raison || '')}"` : '')
      + ` maj="${Math.max(0, now - (p.maj_le || now))}"/>`;
  }

  /**
   * Les actions communes aux deux jeux, depuis les attributs du client :
   *   dinvite u sa | daccept id | ddecline id | dpart id
   * Rend { ok, error?, partie?, touches:[pseudos dont la liste change] }.
   */
  action(username, attrs, now, params) {
    attrs = attrs || {};
    now = now === undefined ? this.clock() : now;
    let r;
    switch (attrs.a) {
      case 'dinvite': r = this.inviter(username, attrs.u, attrs.sa, params, now); break;
      case 'daccept': r = this.accepter(username, attrs.id, now); break;
      case 'ddecline': r = this.refuser(username, attrs.id, now); break;
      case 'dpart': r = this.abandonner(username, attrs.id, now); break;
      default: return { ok: false, error: 'unknown-action' };
    }
    if (!r.ok) return r;
    return { ok: true, partie: r.partie, touches: r.partie.joueurs.slice() };
  }
}

module.exports = {
  Differe, DELAI_COUP, DELAI_INVITATION, RAPPEL_AVANT, GARDE_FINIES, MAX_EN_COURS, SALLES, esc,
};
