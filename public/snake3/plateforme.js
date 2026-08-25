/*
 * Frutisnake — le pont avec Frutiparc (SnakeClient.as, côté HTML).
 *
 * Deux cases de sauvegarde, comme le SWF :
 *   · slot 0 : { $fruits, $record } — la collection (fruit → nombre ramassé)
 *     et le record personnel. C'est elle que le serveur lit pour les pictos
 *     (« Fruit N » dès vingt ramassés — extractGameItemsFromSlot) ;
 *   · slot 1 : { $music, $sounds, $keys } — les préférences.
 *
 * Le score part sur /api/saveScore en mode 0 (classique) : la même table que
 * le disque Flash (snake3_classic), la barrière Fruit Défendu restant côté
 * serveur — le client n'a pas à savoir si la partie compte.
 *
 * La règle héritée des autres portages : on ne sauvegarde JAMAIS un slot
 * qu'on n'a pas d'abord chargé — une fiche neuve écrite par-dessus une vraie
 * effacerait la collection.
 */
'use strict';

(function (racine) {

const C = racine.SnakeConst;

// /api/loadFrutiSlots répond en LoadVars (le format de Flash) : slot0=…&slot1=…
function lireLoadVars(texte, slot) {
  const cible = 'slot' + slot;
  for (const morceau of String(texte).split('&')) {
    const eq = morceau.indexOf('=');
    if (eq < 0) continue;
    if (morceau.slice(0, eq) !== cible) continue;
    try { return decodeURIComponent(morceau.slice(eq + 1).replace(/\+/g, ' ')); } catch (e) { return null; }
  }
  return null;
}

class Plateforme {
  constructor(sid) {
    this.sid = sid || '';
    this.fruits = [];                 // Encyclo.fruits — fruit id → compte
    this.record = 0;
    this.prefs = { $music: true, $sounds: true, $keys: C.DEFAULT_KEYS.slice() };
    this.charge = false;              // slot 0 lu (ou compte neuf) : droit d'écrire
    this.pseudo = null;
    // Les options de confort achetées en boutique. `snake3Hud` est le « pack
    // de Frutisnake » (article 40, 300 kikooz) : le tableau de bord de partie.
    this.options = {};
    // Le TOURNOI (la carte partagée, mode « Entraînement ») : l'état public
    // servi par /api/snake3/tournoi. Fermé tant que le serveur n'a rien dit.
    this.tournoi = { ouvert: false, graine: null, carte: null };
  }

  // L'état du tournoi — public (la pastille du menu s'affiche aussi aux
  // visiteurs), rafraîchi à chaque retour au menu principal.
  chargerTournoi() {
    return fetch('/api/snake3/tournoi', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) {
          this.tournoi = {
            ouvert: !!j.ouvert,
            graine: j.graine || null,
            carte: Array.isArray(j.carte) ? j.carte : null,
          };
        }
        return this.tournoi;
      })
      .catch(() => this.tournoi);
  }

  // SnakeClient.serviceConnect + onServiceConnect.
  charger() {
    if (!this.sid) {
      this.fruits = [];
      this.charge = true;
      // Même sans compte, la pastille du tournoi doit se montrer si le mode
      // est ouvert (on peut regarder ; le score, lui, demandera une session).
      return this.chargerTournoi().then(() => this);
    }
    const tournoi = this.chargerTournoi();
    const profil = fetch('/api/light/profile?sid=' + encodeURIComponent(this.sid), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p && p.username) this.pseudo = p.username; })
      .catch(() => {});
    const options = fetch('/api/features?sid=' + encodeURIComponent(this.sid), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.features) this.options = j.features; })
      .catch(() => {});
    const slots = fetch('/api/loadFrutiSlots?sid=' + encodeURIComponent(this.sid) + '&game=snake3',
      { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((texte) => {
        const brut0 = lireLoadVars(texte, 0);
        if (brut0) {
          try {
            const s0 = JSON.parse(brut0);
            this.fruits = s0.$fruits || [];
            this.record = Number(s0.$record) || 0;
            this.charge = true;
          } catch (e) {
            // Une sauvegarde qu'on ne sait pas lire : on JOUE mais on ne
            // sauvera pas par-dessus (elle vaut plus que notre partie).
            this.fruits = [];
            this.charge = false;
          }
        } else {
          this.fruits = [];
          this.charge = true;         // compte vierge : on a le droit d'écrire
        }
        const brut1 = lireLoadVars(texte, 1);
        if (brut1) {
          try {
            const s1 = JSON.parse(brut1);
            if (s1 && typeof s1 === 'object') {
              // La bascule de SnakeClient.onServiceConnect : $music absent → true.
              this.prefs.$music = s1.$music !== false;
              this.prefs.$sounds = s1.$sounds !== false;
              if (Array.isArray(s1.$keys) && s1.$keys.length >= 12) this.prefs.$keys = s1.$keys;
            }
          } catch (e) { /* préférences illisibles : défauts */ }
        }
      })
      .catch(() => { this.charge = false; });
    return Promise.all([profil, options, slots, tournoi]).then(() => this);
  }

  // SnakeClient.onSaveScore — la collection et le record, slot 0.
  sauverSlot0() {
    if (!this.sid || !this.charge) return Promise.resolve(false);
    const donnees = { $fruits: this.fruits, $record: this.record };
    return fetch('/api/saveFrutiSlot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        sid: this.sid, game: 'snake3', slotId: '0', data: JSON.stringify(donnees),
      }).toString(),
    }).then((r) => r.ok).catch(() => false);
  }

  // SnakeClient.savePrefs — slot 1.
  sauverPrefs() {
    if (!this.sid) return Promise.resolve(false);
    return fetch('/api/saveFrutiSlot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        sid: this.sid, game: 'snake3', slotId: '1', data: JSON.stringify(this.prefs),
      }).toString(),
    }).then((r) => r.ok).catch(() => false);
  }

  // GameClient.saveScore, mode 0 (classique). Répond { ok, oldScore, oldPos,
  // bestScorePos } — ce que Manager.scoreSaved met en phrases.
  sauverScore(score) {
    if (!this.sid) return Promise.resolve(null);
    const p = new URLSearchParams({
      sid: this.sid, game: 'snake3', m: '0', score: String(Math.max(0, Math.floor(score))),
    });
    return fetch('/api/saveScore?' + p.toString())
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  // Le score du TOURNOI part sur son propre guichet : classement dédié
  // (snake3_tournoi), pas de quota Fruit Défendu, et la graine voyage avec le
  // score — le serveur écarte une partie jouée sur une carte périmée.
  sauverScoreTournoi(score) {
    if (!this.sid) return Promise.resolve(null);
    return fetch('/api/snake3/tournoi/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        sid: this.sid,
        score: String(Math.max(0, Math.floor(score))),
        graine: this.tournoi.graine || '',
      }).toString(),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
}

const API = { Plateforme };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakePlateforme = API;

})(typeof window !== 'undefined' ? window : globalThis);
