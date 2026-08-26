/*
 * Frutisnake — une partie (Game.as).
 *
 * La boucle d'origine, geste pour geste : la frutibarre qui fuit, les fruits
 * qui tombent d'autant plus riches qu'elle est haute, les options tirées aux
 * probabilités du fichier, la rangée de cases dont la PREMIÈRE s'utilise à
 * ESPACE, l'accélération à la flèche HAUT rendue par la friction, et la mort
 * en mordant — soi-même ou le mur.
 *
 * Le moteur ne dessine rien et n'entend rien : il lit `entree`, avance, et
 * ANNONCE (evenement). Le client pose les dessins et joue les sons.
 *
 * `entree` : { gauche, droite, haut, bas, espace, echap } — des booléens
 * tenus par le client (clavier ou doigt).
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const C = sousNode ? require('./const.js') : racine.SnakeConst;
const SS = sousNode ? require('./serpent.js') : racine.SnakeSerpent;
const N = sousNode ? require('./niveau.js') : racine.SnakeNiveau;
const B = sousNode ? require('./bonus.js') : racine.SnakeBonus;

class Partie {
  /**
   * @param {object} o
   *   hasard      (n) → entier de 0 à n-1 — injectable pour les tests
   *   dims        les cadres du SWF (fruit(id), bonus(id), col)
   *   evenement   (nom, données)
   *   fruits      l'encyclopédie : { id → nombre ramassé } (Encyclo.fruits)
   *   carte       le script d'options du tournoi [{ t, id, x, y, vie }, …]
   *               (carte.js) — remplace le tirage aléatoire des options
   */
  constructor(o) {
    const opts = o || {};
    this.hasard = opts.hasard || ((n) => Math.floor(Math.random() * n));
    this.evenement = opts.evenement || (() => {});
    this.dims = opts.dims || null;
    this.fruitsEncyclo = opts.fruits || {};

    this.entree = { gauche: false, droite: false, haut: false, bas: false, espace: false, echap: false };
    this.forcePause = false;

    this.score = 0;
    this.fcounter = 0;
    this.bonus_time = 0;
    this.speed_normal = 1;
    this.speed_up = C.CHALLENGE_SPEED_COEF;
    this.pause = false;
    this.pause_flag = false;
    this.score_factor = 1;
    this.fruit_time_factor = 1;
    this.loose_frutibar = true;
    this.game_over_flag = false;
    this.finie = false;               // après l'explosion complète de la queue
    this.pieu = false;
    // Le compteur du tableau de bord (pack de Frutisnake) : il ne sert à rien
    // au jeu, il est là comme le `__nf` que scripts/patch-snake3-hud.js injecte
    // dans le SWF — au même endroit, eat_fruit, la seule porte par laquelle un
    // fruit est avalé (contact, Langue ou Potion noire).
    this.nbFruits = 0;

    this.fbarre = 0;
    // Game.as : `Pile.counter = 0` et `Sonnette.activated = false` — les
    // statiques se remettent à zéro à CHAQUE partie.
    B.Pile.counter = 0;
    this.sonnette_active = false;
    // La cloche pendue à la queue, tant qu'une Sonnette est en jeu : le clip
    // `sonnette` de PLAN_DUMMIES (cf. bonus.js). null = aucune sonnette prise.
    this.sonnetteMc = null;

    this.slots = [];
    this.unique_slots = [];
    this.space_flag = false;
    this.enable_snake_keys = true;
    this.do_call_on_eat = true;

    // Les tics annexes (bombe qui compte, croix qui sème, cloche qui fond…).
    this.updates = new Set();

    this.niveau = new N.Niveau({
      hasard: this.hasard,
      dims: this.dims,
      evenement: this.evenement,
    });
    const p = { x: this.niveau.corner.x + 50, y: this.niveau.corner.y + 50 };
    this.serpent = new SS.Serpent({
      x: p.x, y: p.y,
      hasard: this.hasard,
      evenement: this.evenement,
    });
    this.serpent.ang = Math.PI / 4;
    this.trou = { x: p.x, y: p.y };   // le terrier du départ, pour le décor

    this.bonus_probabilities = C.PROBABILITIES.slice();

    // La CARTE du tournoi (carte.js) : une liste [{ t, id, x, y, vie }, …]
    // triée par t. Quand elle est là, les options ne se tirent plus au dé —
    // elles tombent aux instants de la carte, aux mêmes endroits pour tous.
    // Les fruits, eux, restent tirés normalement (ils suivent la frutibarre,
    // donc le jeu de chacun — c'est le contrat du mode).
    this.carte = Array.isArray(opts.carte) ? opts.carte : null;
    this.carteIndex = 0;
    this.horlogeCarte = 0;            // la somme des tmod écoulés, l'axe de la carte

    // Les fruits déjà « débloqués » à l'entrée en partie : endGame n'annonce
    // que les NOUVEAUX passages de seuil.
    this.fruit_flags = {};
    for (const k of Object.keys(this.fruitsEncyclo)) {
      this.fruit_flags[k] = (Number(this.fruitsEncyclo[k]) >= C.FRUIT_DEBLOK);
    }

    // call_on_eat est une PROPRIÉTÉ remplaçable : le pentacle la détourne.
    this.call_on_eat = (f) => {
      if (this.do_call_on_eat && f.on_eat) f.on_eat(this.serpent);
    };
    // gen_fruit_id aussi : la potion rouge le remplace.
    this.gen_fruit_id = () => {
      return Math.min(1 + this.hasard(Math.round(C.FRUIT_BASE + this.fbarre * 1.6)), C.FRUIT_MAX);
    };
  }

  // ── Le cadre du petit clip `col` de la tête — la bouche, un peu en avant ──
  //
  // Manger, c'est `Std.hitTest(fruit, col_mc)` : DEUX CLIPS, donc Flash compare
  // leurs cadres alignés sur les axes de la scène. Or `col` est un enfant de
  // `tete`, et Snake.draw pose `tete._rotation = ang·180/π` : le petit
  // rectangle TOURNE avec la tête, et le cadre aligné d'un rectangle tourné
  // grandit avec l'angle —
  //
  //     W = |w·cos θ| + |h·sin θ|      H = |w·sin θ| + |h·cos θ|
  //
  // À 45°, les 12,44 × 13,66 mesurés dans le SWF deviennent 18,5 × 18,5, une
  // demi-fois plus large. On gardait la taille droite quel que soit le cap :
  // les fruits étaient donc plus durs à prendre qu'en Flash partout sauf à
  // l'horizontale et à la verticale. Le décalage du clip tourne lui aussi.
  colDeTete(serpent) {
    const s = serpent || this.serpent;
    const scale = (30 + 70 * (Math.min(10, s.len + 3) / 10)) / 100;
    const d = (this.dims && this.dims.col) || { dx: 0.8, dy: -6.85, w: 12.44, h: 13.66 };
    const cx = d.dx + d.w / 2;          // le centre du cadre, dans le repère de la tête
    const cy = (d.dy || 0) + d.h / 2;
    const co = Math.cos(s.ang), si = Math.sin(s.ang);
    return {
      x: s.x + (cx * co - cy * si) * scale,
      y: s.y + (cx * si + cy * co) * scale,
      w: (d.w * Math.abs(co) + d.h * Math.abs(si)) * scale,
      h: (d.w * Math.abs(si) + d.h * Math.abs(co)) * scale,
    };
  }

  game_over() {
    if (this.game_over_flag) return;
    this.serpent.eat = -1;
    if (this.slots[0]) this.slots[0].activate(false);
    for (const s of this.slots) s.close();
    for (const s of this.unique_slots) s.close();

    this.game_over_flag = true;
    if (this.serpent.len === 0) this.serpent.vivant = false;
    this.evenement('gameOver', { score: this.score });
    this.evenement('son', { nom: 'game_over' });
  }

  is_unique_bonus(id) {
    return id === 8 || id === 12 || id === 14 || id === 21 || id === 28 || id === 31 || id === 33;
  }

  add_slot(s) {
    if (s.activable()) {
      if (this.slots[0]) this.slots[0].activate(false);
      this.slots.unshift(s);
      for (let i = 0; i < this.slots.length; i++) this.slots[i].update_pos(i);
      this.slots[0].activate(true);
    } else {
      s.update_pos(this.slots.length);
      this.slots.push(s);
    }
  }

  add_unique_slot(s) {
    this.unique_slots.unshift(s);
    for (let i = 0; i < this.unique_slots.length; i++) {
      this.unique_slots[i].update_pos(9.5 - i);
    }
  }

  remove_slot(s) {
    s.close();
    const i = this.slots.indexOf(s);
    if (i >= 0) this.slots.splice(i, 1);
    for (let j = 0; j < this.slots.length; j++) this.slots[j].update_pos(j);
    if (this.slots[0]) this.slots[0].activate(true);
  }

  remove_unique_slot(s) {
    s.close();
    const i = this.unique_slots.indexOf(s);
    if (i >= 0) this.unique_slots.splice(i, 1);
    for (let j = 0; j < this.unique_slots.length; j++) {
      this.unique_slots[j].update_pos(9.5 - j);
    }
  }

  // Game.get_bonus — l'aiguillage des trente-sept options.
  get_bonus(b) {
    let son = 'option';

    switch (b.id) {
      case 1: case 2: case 3:
        this.add_slot(new B.Ciseaux(this, b.id));
        break;
      case 4:
        this.add_slot(new B.Langue(this));
        break;
      case 5:
        son = 'coffre';
        B.Coffre.activate(this, b.x, b.y);
        break;
      case 6:
        son = 'potion';
        this.add_slot(new B.PotionRouge(this));
        break;
      case 7:
        this.add_slot(new B.Steroids(this, b.x, b.y));
        break;
      case 8:
        this.add_unique_slot(new B.Bague(this));
        break;
      case 9:
        son = 'potion';
        this.add_slot(new B.PotionBleue(this));
        break;
      case 10:
        son = 'potion';
        this.add_slot(new B.PotionRose(this));
        break;
      case 11:
        son = 'potion';
        this.add_slot(new B.PotionViolette(this));
        break;
      case 12:
        this.add_unique_slot(new B.Ressort(this));
        break;
      case 13:
        this.add_slot(new B.Rondelle(this));
        break;
      case 14:
        this.add_unique_slot(new B.Inverseur(this));
        break;
      case 15:
        son = 'potion';
        this.add_slot(new B.PotionNoire(this));
        break;
      case 16:
        B.Canne.activate(this, b.x, b.y);
        break;
      case 17:
        B.Molecule.activate(this, false);
        break;
      case 18:
        B.Molecule.activate(this, true);
        break;
      case 19:
        this.add_slot(new B.Bombe(this));
        break;
      case 20:
        son = 'potion';
        this.add_slot(new B.PotionVerte(this));
        break;
      case 21:
        this.add_unique_slot(new B.Plume(this));
        break;
      case 22:
        B.Oeil.activate(this);
        break;
      case 23: {
        const _ = new B.FlecheBleue(this, b.rotation, b.x, b.y);
        break;
      }
      case 24: {
        const _ = new B.FlecheRouge(this, b.x, b.y);
        break;
      }
      case 25:
        son = 'potion';
        this.add_slot(new B.PotionOrange(this));
        break;
      case 26:
        son = 'potion';
        this.add_slot(new B.PotionJaune(this));
        break;
      case 27:
        son = 'dynamite';
        B.Pile.activate(this);
        break;
      case 28:
        this.add_unique_slot(new B.Poupee(this));
        break;
      case 29:
        B.Aureole.activate(this, b.x, b.y);
        break;
      case 30: {
        const _ = new B.Croix(this, b.x, b.y);
        break;
      }
      case 31:
        this.add_unique_slot(new B.Sonnette(this));
        break;
      case 32:
        son = 'cloche';
        B.Cloche.activate(this);
        break;
      case 33:
        this.add_unique_slot(new B.Pentacle(this));
        break;
      case 34:
        son = 'sabre';
        B.Sabre.activate(this);
        break;
      case 35:
        son = 'coffre';
        B.CoffreOptions.activate(this, b.x, b.y);
        break;
      case 36:
        this.add_slot(new B.Pieu(this));
        break;
      case 37:
        son = 'potion';
        this.add_slot(new B.PotionFuca(this));
        break;
    }
    this.evenement('bonusPris', { bonus: b });
    if (son != null) this.evenement('son', { nom: son });
  }

  popup(x, y, txt) {
    this.evenement('popup', { x, y, valeur: txt });
  }

  gen_fruit() {
    let id = this.gen_fruit_id();
    if (this.hasard(100) === 0) {
      id = Math.trunc((id - 1) * C.FRUIT_POURRIS_MAX / C.FRUIT_MAX) + 321;
    }
    const f = this.niveau.generate_fruit(id);
    f.time *= this.fruit_time_factor;
    f.on_timeout((fr) => this.on_fruit_timeout(fr));
    this.evenement('fruitPose', { fruit: f });
    return f;
  }

  gen_bonus() {
    const id = 1 + C.randomProbas(this.bonus_probabilities, this.hasard);
    const b = this.niveau.generate_bonus(id);
    if (this.is_unique_bonus(id)) this.bonus_probabilities[id - 1] = 0;
    this.evenement('bonusPose', { bonus: b });
    return b;
  }

  on_fruit_timeout(f) {
    if (this.loose_frutibar && f.points() > 0) {
      this.fbarre += C.FBARRE_FRUIT_TIMEOUT;
      if (this.fbarre < 0) this.fbarre = 0;
    }
  }

  eat_fruit(f) {
    this.nbFruits++;
    this.call_on_eat(f);
    this.evenement('son', { nom: this.hasard(2) === 0 ? 'glurps' : 'glurps_2' });

    const id = f.get_id();
    if (this.fruitsEncyclo[id] === undefined) this.fruitsEncyclo[id] = 1;
    else this.fruitsEncyclo[id]++;
    const points = f.points() * this.score_factor;
    this.score += points;
    this.popup(f.x, f.y, points);
    this.fbarre += C.FBARRE_EAT_FRUIT;
    this.evenement('fruitMange', { fruit: f, points });
  }

  // Les fruits dont la partie vient de franchir le seuil des vingt : ceux que
  // l'écran de fin annonce un à un (Game.endGame).
  fruitsFraichementDebloques() {
    const l = [];
    for (const k of Object.keys(this.fruitsEncyclo)) {
      if (Number(this.fruitsEncyclo[k]) > C.FRUIT_DEBLOK - 1 && !this.fruit_flags[k]) {
        l.push({ id: Number(k), nombre: Number(this.fruitsEncyclo[k]) });
      }
    }
    l.sort((a, b) => a.id - b.id);
    return l;
  }

  marquerFruitAnnonce(id) {
    this.fruit_flags[id] = true;
  }

  /** Game.main — une image. */
  main(tmod, deltaT) {
    // La pause, avec le même anti-rebond que le fichier.
    if (this.pause) {
      if (!this.forcePause && this.entree.echap) {
        if (!this.pause_flag) {
          this.pause = false;
          this.pause_flag = true;
          this.evenement('pause', { active: false });
        }
      } else {
        this.pause_flag = false;
      }
      return;
    }

    for (const tic of [...this.updates]) tic(tmod, deltaT);

    if (this.score < 0) this.score = 0;

    if (this.game_over_flag) {
      if (this.serpent.len > 0) {
        let timer = 4;
        if (this.serpent.len > 10) timer = 3;
        if (this.serpent.len > 50) timer = 2;
        if (this.serpent.len > 100) timer = 1;
        if ((this.fcounter++) % Math.max(1, Math.trunc(timer / tmod)) === 0) {
          this.serpent.explode(this.serpent.color);
        }
        if (this.serpent.len === 0) this.serpent.vivant = false;
      } else if (!this.finie) {
        this.finie = true;
        this.evenement('finPartie', { score: this.score });
      }
      return;
    }

    this.fbarre -= C.FBARRE_PERMANENT_LOOSE * tmod;
    if (this.fbarre < 0) this.fbarre = 0;
    else if (this.fbarre > C.FBARRE_MAX) this.fbarre = C.FBARRE_MAX;

    // Le clin d'œil de la tête, à l'occasion.
    if (this.hasard(Math.round(100 / tmod)) === 0) this.evenement('clignement', {});

    if (this.hasard(Math.round(C.FRUITS_FREQ * this.niveau.nfruits() / tmod)) === 0) {
      this.gen_fruit();
    }

    if (this.carte) {
      // Le TOURNOI : les options tombent aux instants de la carte, pas au dé.
      // Pas de plafond ici — il dépendrait des cases en main, donc du joueur,
      // et la carte doit tomber pareil pour tous (il est tenu à la génération,
      // sur les options posées — carte.js).
      this.horlogeCarte += tmod;
      while (this.carteIndex < this.carte.length
        && this.carte[this.carteIndex].t <= this.horlogeCarte) {
        const e = this.carte[this.carteIndex++];
        const b = this.niveau.poser_bonus(e.id, e.x, e.y, e.vie);
        this.evenement('bonusPose', { bonus: b });
      }
    } else if (this.slots.length + this.unique_slots.length + this.niveau.nbonus() < 10) {
      const k = Math.round((C.BONUS_FREQ + this.score / 500)
        * (this.niveau.nbonus() + 1) / tmod - this.bonus_time / 6);
      if (this.hasard(Math.max(1, k)) === 0) {
        this.bonus_time = 0;
        this.gen_bonus();
      } else {
        this.bonus_time += tmod;
      }
    }

    if (this.enable_snake_keys) {
      if (this.entree.gauche) this.serpent.ang -= this.serpent.delta_ang * tmod;
      if (this.entree.droite) this.serpent.ang += this.serpent.delta_ang * tmod;
    }

    this.serpent.base_speed *= Math.pow(C.CHALLENGE_FRICTION, tmod);

    if (this.entree.haut) {
      this.serpent.base_speed = this.pieu ? 1 : this.speed_up;
    }
    if (this.serpent.base_speed < 1) {
      this.serpent.base_speed = this.pieu ? 0 : this.speed_normal;
    }

    if (this.entree.espace) {
      if (this.space_flag === false) {
        this.space_flag = true;
        if (this.slots[0] && this.slots[0].use()) this.remove_slot(this.slots[0]);
      }
    } else {
      this.space_flag = false;
    }

    if (this.forcePause || this.entree.echap) {
      if (!this.pause_flag) {
        this.pause = true;
        this.pause_flag = true;
        this.evenement('pause', { active: true });
      }
    } else {
      this.pause_flag = false;
    }

    const hit = this.serpent.move(this.niveau.bounds(), tmod);
    const col = this.colDeTete(this.serpent);

    if (this.slots[0]) this.slots[0].update(tmod, deltaT);
    // La liste peut fondre pendant qu'on la parcourt (TimedSlot.permanent
    // retire sa case) : on fige la photo, comme le for(i) d'AS2 encaissait
    // les remove() en sautant un élément — sans jamais planter.
    for (const s of [...this.slots]) s.permanent(tmod, deltaT);
    for (const s of [...this.unique_slots]) s.permanent(tmod, deltaT);

    if (hit) {
      this.game_over();
      return;
    }

    this.niveau.update(this, tmod);

    const f = this.niveau.get_fruit(col);
    if (f != null) this.eat_fruit(f);

    const b = this.niveau.get_bonus(col);
    if (b != null) this.get_bonus(b);
  }
}

const API = { Partie };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakePartie = API;

})(typeof window !== 'undefined' ? window : globalThis);
