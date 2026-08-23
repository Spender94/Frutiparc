/*
 * Frutisnake — le mode Battle (Battle.as) : deux à quatre serpents sur un
 * même clavier, chacun sa jauge de turbo, le dernier en vie gagne.
 *
 * Les serpents grandissent TOUT SEULS — un segment toutes les trois secondes
 * — et il n'y a ni fruit ni option : l'arène rétrécit d'elle-même, à mesure
 * que les corps s'allongent. `scores` retient les victoires de la session,
 * comme la statique du fichier.
 *
 * `entrees` : un tableau de { gauche, droite, haut } par joueur.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const C = sousNode ? require('./const.js') : racine.SnakeConst;
const SS = sousNode ? require('./serpent.js') : racine.SnakeSerpent;
const N = sousNode ? require('./niveau.js') : racine.SnakeNiveau;

const scores = [];                    // Battle.scores — les victoires de la session

class Bataille {
  constructor(o) {
    const opts = o || {};
    this.evenement = opts.evenement || (() => {});
    this.hasard = opts.hasard || ((n) => Math.floor(Math.random() * n));
    const nplayers = Math.max(2, Math.min(4, opts.nplayers || 2));
    this.nplayers = nplayers;

    this.niveau = new N.Niveau({ hasard: this.hasard, evenement: this.evenement });
    this.serpents = [];
    this.destroys = [];
    this.powers = [];
    this.fcounter = 0;
    this.q_time = 0;
    this.winner = null;
    this.finie = false;

    for (let i = 0; i < 10; i++) if (scores[i] === undefined) scores[i] = 0;

    const naitre = (x, y, ang) => {
      const s = new SS.Serpent({ x, y, hasard: this.hasard, evenement: this.evenement });
      s.ang = ang;
      this.serpents.push(s);
    };
    const coin = this.niveau.corner;
    const coinBas = this.niveau.corner_down;
    naitre(coin.x, coin.y, Math.PI / 4 + 0.1);
    naitre(coinBas.x, coinBas.y, -3 * Math.PI / 4);
    if (nplayers > 2) naitre(coin.x, coinBas.y, -Math.PI / 4 + 0.1);
    if (nplayers > 3) naitre(coinBas.x, coin.y, 3 * Math.PI / 4);

    for (let i = 0; i < nplayers; i++) {
      this.powers[i] = C.BATTLE_POWER_MAX;
      this.serpents[i].color = C.BATTLE_COLORS[i];
      this.serpents[i].border_color = C.BATTLE_BORDER_COLORS[i];
      if (i > 0) this.serpents[i].tete_frame = 10 + i;
    }
  }

  static get scores() { return scores; }

  gameOver(winner) {
    this.winner = winner;
    if (winner !== -1) scores[winner]++;
    this.finie = true;
    this.evenement('finBataille', {
      vainqueur: winner,
      texte: winner === -1 ? C.TXT_BATTLE_DRAW : C.TXT_BATTLE_WIN(winner),
    });
    this.evenement('son', { nom: 'game_over' });
  }

  /** Battle.main — une image. `entrees[i]` pilote le serpent i. */
  main(tmod, deltaT, entrees) {
    this.fcounter++;
    if (this.finie) return;

    // La pousse automatique : un segment par serpent toutes les trois secondes.
    this.q_time += deltaT;
    if (this.q_time > 3) {
      this.q_time -= 3;
      for (const s of this.serpents) {
        if (!s) continue;
        s.add_queue(-1);
        s.eat = -1;
      }
    }

    // Les vaincus fondent en particules, un segment sur quatre images.
    for (let i = 0; i < this.destroys.length; i++) {
      const s = this.destroys[i];
      if (this.fcounter % 4 === 0) {
        s.explode(s.color);
        if (s.len <= 0) {
          this.destroys.splice(i, 1);
          i--;
          s.vivant = false;
        }
      }
    }

    const hits = [];
    const bounds = this.niveau.bounds();
    for (let i = 0; i < this.serpents.length; i++) {
      const s = this.serpents[i];
      if (s == null) continue;

      this.powers[i] += C.BATTLE_POWER_RECUP * tmod;
      if (this.powers[i] > C.BATTLE_POWER_MAX) this.powers[i] = C.BATTLE_POWER_MAX;

      s.speed *= Math.pow(C.BATTLE_FRICTION, tmod);
      if (s.speed < C.SNAKE_DEFAULT_SPEED) s.speed = C.SNAKE_DEFAULT_SPEED;
      hits[i] = s.move(bounds, tmod);
    }

    // Chacun contre le corps des autres.
    for (let i = 0; i < this.serpents.length; i++) {
      if (this.serpents[i] == null) continue;
      const c = this.serpents[i].collision_pt();
      for (let j = 0; j < this.serpents.length; j++) {
        if (i !== j && this.serpents[j] != null && this.serpents[j].hit(c)) hits[i] = true;
      }
    }

    // Tous morts le même tour : égalité.
    let i;
    for (i = 0; i < this.serpents.length; i++) {
      if (this.serpents[i] != null && !hits[i]) break;
    }
    if (i === this.serpents.length) {
      this.gameOver(-1);
      return;
    }

    for (let k = 0; k < this.serpents.length; k++) {
      if (hits[k]) {
        this.destroys.push(this.serpents[k]);
        this.serpents[k] = null;
      }
    }

    let winner = -1;
    for (let k = 0; k < this.serpents.length; k++) {
      if (this.serpents[k] != null) {
        if (winner === -1) winner = k;
        else { winner = -1; break; }
      }
    }
    if (winner !== -1) {
      this.gameOver(winner);
      return;
    }

    for (let k = 0; k < this.serpents.length; k++) {
      const s = this.serpents[k];
      const e = (entrees && entrees[k]) || {};
      if (!s) continue;
      if (e.gauche) s.ang -= s.delta_ang * tmod;
      if (e.droite) s.ang += s.delta_ang * tmod;
      if (e.haut && this.powers[k] > tmod) {
        this.powers[k] -= tmod;
        s.speed = C.BATTLE_ACCEL;
      }
    }
  }
}

const API = { Bataille };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeBataille = API;

})(typeof window !== 'undefined' ? window : globalThis);
