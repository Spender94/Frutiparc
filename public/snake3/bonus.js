/*
 * Frutisnake — les trente-sept options (bonus/*.as), une classe par fichier
 * d'origine, dans l'ordre des identifiants de Game.get_bonus.
 *
 * Deux familles :
 *
 *   Slot        une case dans la rangée du haut. La PREMIÈRE case est
 *               l'active : ESPACE l'utilise (use), certaines s'animent
 *               (update — appelée sur la seule case active), toutes vivent
 *               (permanent — appelée sur chacune, chaque image).
 *   UniqueSlot  les acquis définitifs (bague, ressort, plume…), rangés à
 *               droite. `is_unique_bonus` les reconnaît, et leur PROBABILITÉ
 *               tombe à zéro une fois tirés : on ne les gagne qu'une fois.
 *
 * Les autres options (coffre, molécule, dynamite…) agissent SUR-LE-CHAMP :
 * une fonction statique `activate`, et rien ne reste.
 *
 * Les numéros de case (le paramètre du constructeur de Slot) sont les images
 * du clip `slot` du SWF — l'icône affichée dans la rangée.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const C = sousNode ? require('./const.js') : racine.SnakeConst;
const SS = sousNode ? require('./serpent.js') : racine.SnakeSerpent;

// ── Slot.as ───────────────────────────────────────────────────────────────
class Slot {
  constructor(game, id) {
    this.game = game;
    this.slotFrame = id;              // l'image du clip `slot`
    this.pos = 0;                     // update_pos : la place dans la rangée
    this.actif = false;
    this.compteur = null;             // la langue affiche ses munitions
  }

  update_pos(i) { this.pos = i; }
  close() {}
  activate(flag) { this.actif = !!flag; }
  update(tmod, deltaT) {}
  use() { return false; }
  activable() { return false; }
  permanent(tmod, deltaT) {}
}

// ── TimedSlot.as ──────────────────────────────────────────────────────────
class TimedSlot extends Slot {
  constructor(game, slotnb, max_time) {
    super(game, slotnb);
    this.time = max_time;
  }

  permanent(tmod, deltaT) {
    this.time -= deltaT;
    if (this.time < 0) {
      this.game.evenement('son', { nom: 'effect_end' });
      this.game.remove_slot(this);
      return;
    }
    this.effect(tmod, deltaT);
  }

  effect(tmod, deltaT) {}
}

// ── 1-3. Ciseaux — le curseur rouge oscille, ESPACE coupe là ──────────────
class Ciseaux extends Slot {
  static get CUTS() { return [3, 7, 12]; }

  constructor(game, lvl) {
    super(game, 1);
    this.level = lvl;
    this.q_pos = 0;
    this.q_time = 0;
    this.q_delta = 1;
  }

  update(tmod, deltaT) {
    this.q_time += deltaT / (3.5 - this.level);
    while (this.q_time > 0.1) {
      this.q_pos += this.q_delta;
      this.q_time -= 0.1;
    }

    if (this.q_pos <= 0) {
      this.q_pos = 0;
      this.q_delta = 1;
    }

    let q_max = Math.min(Ciseaux.CUTS[this.level - 1], this.game.serpent.len - 4) - 1;

    if (q_max < 0) {
      q_max = 0;
      this.q_pos = -1;
    }

    if (this.q_pos >= q_max) {
      this.q_pos = q_max;
      this.q_delta = -1;
    }

    this.game.serpent.set_color(this.q_pos + 1, C.COLOR_CISEAUX);
  }

  activate(b) {
    super.activate(b);
    if (!b) this.game.serpent.set_color(0, 0);
  }

  use() {
    this.activate(false);
    this.game.evenement('son', { nom: 'ciseaux' });
    this.game.serpent.cut(this.q_pos + 1);
    return true;
  }

  activable() { return true; }
}

// ── 4. Langue — s'étend, gobe un fruit, points doublés ────────────────────
class Langue extends Slot {
  constructor(game) {
    super(game, 2);
    this.n = 10;
    this.compteur = 10;
    this.got_fruit = null;
    this.l_using = false;
    this.l_delta = 0;
    this.l_size = 0;
    // L'état pour le rendu : la langue part de la tête, vers l'avant.
    this.langue = null;               // { x, y, ang, xscale } quand elle sort
  }

  update(tmod, deltaT) {
    this.compteur = this.n;
    if (!this.l_using) return;

    this.l_delta *= Math.pow(1.05, tmod);
    this.l_size += this.l_delta * tmod;
    if (this.l_size > 100) {
      this.l_size = 100;
      this.l_delta = -Math.abs(this.l_delta);
    }
    if (this.l_delta < 0 && this.l_size < 40) {
      if (this.got_fruit != null) {
        this.game.score_factor *= 2;
        this.game.eat_fruit(this.got_fruit);
        this.game.score_factor /= 2;
        this.got_fruit = null;
      }
      this.activate(false);
      return;
    }

    const serpent = this.game.serpent;
    const dist = 15;
    const lx = serpent.x + Math.cos(serpent.ang) * dist;
    const ly = serpent.y + Math.sin(serpent.ang) * dist;
    const xscale = (this.l_size / 100) * (this.l_size / 100) * 100 * 1.4;
    this.langue = { x: lx, y: ly, ang: serpent.ang, xscale };

    if (this.got_fruit == null) {
      // Le petit col au bout de la langue (dans le repère du clip, à x =
      // xscale) : un cadre d'une douzaine de pixels.
      const cx = lx + Math.cos(serpent.ang) * xscale;
      const cy = ly + Math.sin(serpent.ang) * xscale;
      this.got_fruit = this.game.niveau.hit_fruit({ x: cx, y: cy, w: 12, h: 12 });
    } else {
      this.got_fruit.x = lx + Math.cos(serpent.ang) * xscale;
      this.got_fruit.y = ly + Math.sin(serpent.ang) * xscale;
    }
  }

  activate(b) {
    super.activate(b);
    if (!b) {
      if (this.got_fruit != null) {
        this.game.niveau.pushFruit(this.got_fruit);
        this.got_fruit = null;
      }
      this.langue = null;
      this.l_using = false;
      if (this.n === 0) this.game.remove_slot(this);
    }
  }

  use() {
    if (!this.l_using) {
      this.n--;
      this.l_using = true;
      this.l_delta = 7;
      this.l_size = 0;
      this.game.evenement('son', { nom: 'langue' });
    }
    return false;
  }

  activable() { return true; }
}

// ── 5. Coffre — une pluie de fruits qui ne font pas grandir ───────────────
const Coffre = {
  activate(game, x, y) {
    const nfruits = 10 + game.hasard(10);
    for (let i = 0; i < nfruits; i++) {
      const f = game.gen_fruit();
      f.set_pos(x, y);
      f.on_eat = null;
      f.jump_near(game.hasard(50) + 50, game.hasard(10) + 20, 0.05, game.niveau.bounds());
    }
  },
};

// ── 6. Potion rouge — le tirage ne donne plus que des fruits rouges ───────
class PotionRouge extends TimedSlot {
  static get FRUITS_ROUGES() {
    return [2, 3, 11, 13, 27, 37, 45, 50, 51, 53, 57, 74, 79, 80, 82, 83, 93,
      98, 103, 107, 116, 119, 124, 131, 140, 143, 149, 156, 159, 167, 182, 186,
      199, 200, 201, 203, 214, 220, 226, 230, 235, 240, 251, 258, 262, 263,
      266, 267, 269, 272, 281, 296];
  }

  constructor(game) {
    super(game, 3, C.TIME_POTIONROUGE);
    this.save_f = game.gen_fruit_id;
    game.gen_fruit_id = () => {
      const l = PotionRouge.FRUITS_ROUGES;
      return l[game.hasard(l.length)];
    };
  }

  close() {
    this.game.gen_fruit_id = this.save_f;
    super.close();
  }
}

// ── 7. Stéroïdes — deux fois plus vite, 3000 points cadeau ────────────────
class Steroids extends TimedSlot {
  constructor(game, x, y) {
    super(game, 4, C.TIME_STEROIDS);
    game.serpent.speed *= 2;
    game.score += 3000;
    game.popup(x, y, 3000);
  }

  close() {
    this.game.serpent.speed /= 2;
    super.close();
  }
}

// ── 8. Bague — le serpent tourne 1,7 fois plus court (définitif) ──────────
class Bague extends Slot {
  constructor(game) {
    super(game, 40);
    game.serpent.delta_ang *= 1.7;
  }
}

// ── 9. Potion bleue — invincible à soi-même, robe grise, clignote à la fin ─
class PotionBleue extends TimedSlot {
  constructor(game) {
    super(game, 6, C.TIME_POTIONBLEUE);
    this.counter = 0;
  }

  color(flag) {
    const s = this.game.serpent;
    if (flag) {
      s.color = C.COLOR_SNAKE_INVINCIBLE;
      s.border_color = C.COLOR_SNAKE_BORDER_INVINCIBLE;
      s.tete_frame = 2;
    } else {
      s.color = C.COLOR_SNAKE_DEFAULT;
      s.border_color = C.COLOR_SNAKE_BORDER_DEFAULT;
      s.tete_frame = 1;
    }
    s.redraw = true;
  }

  close() {
    this.color(false);
    this.game.serpent.queue_collide = true;
    super.close();
  }

  effect() {
    if (this.time < 2 && (this.counter++ & 2) === 0) this.color(false);
    else this.color(true);
    this.game.serpent.queue_collide = false;
  }
}

// ── 10. Potion rose — points ×2, fruits sauteurs qui ne font pas grandir ──
class PotionRose extends TimedSlot {
  constructor(game) {
    super(game, 5, C.TIME_POTIONROSE);
    game.score_factor *= 2;
    game.fruit_time_factor *= 2;
  }

  close() {
    this.game.do_call_on_eat = true;
    this.game.score_factor /= 2;
    this.game.fruit_time_factor /= 2;
    super.close();
  }

  jump_fruit() {
    const fruits = this.game.niveau.fruits;
    const f = fruits[this.game.hasard(fruits.length)];
    if (!f || f.isMoving()) return;
    f.jump_near(this.game.hasard(50) + 20, this.game.hasard(10) + 20, 0.1,
      this.game.niveau.bounds());
  }

  effect(tmod) {
    this.game.do_call_on_eat = false;
    if (this.game.hasard(Math.trunc(30 / tmod)) === 0) this.jump_fruit();
  }
}

// ── 11. Potion violette — le corps ondule (dessin seulement) ──────────────
class PotionViolette extends TimedSlot {
  constructor(game) {
    super(game, 7, C.TIME_POTIONVIOLETTE);
  }

  close() {
    this.game.serpent.distort = false;
    super.close();
  }

  effect() {
    const s = this.game.serpent;
    if (!s.can_move) s.redraw = true;
    s.distort = true;
    s.distort_val = (this.time < 5) ? this.time / 5 : 1;
  }
}

// ── 12. Ressort — les murs renvoient (définitif) ──────────────────────────
class Ressort extends Slot {
  constructor(game) {
    super(game, 41);
    game.serpent.wall_rebonds = true;
  }
}

// ── 13. Rondelle psychique — la frutibarre gèle, les fruits pleuvent ──────
class Rondelle extends TimedSlot {
  constructor(game) {
    super(game, 8, C.TIME_RONDELLE);
    game.loose_frutibar = false;
  }

  close() {
    this.game.loose_frutibar = true;
    super.close();
  }

  effect(tmod) {
    if (this.game.hasard(Math.trunc(15 / tmod)) === 0) this.game.gen_fruit();
  }
}

// ── 14. Inverseur — BAS retourne le serpent (définitif) ───────────────────
class Inverseur extends Slot {
  constructor(game) {
    super(game, 42);
    this.down_flag = false;
  }

  permanent() {
    if (this.game.entree.bas) {
      if (!this.down_flag) this.game.serpent.reverse();
      this.down_flag = true;
    } else {
      this.down_flag = false;
    }
  }
}

// ── 15. Potion noire — un serpent fantôme mange les fruits à votre place ──
class PotionNoire extends Slot {
  constructor(game) {
    super(game, 12);
    const s = new SS.Serpent({
      x: game.serpent.x,
      y: game.serpent.y,
      hasard: game.hasard,
      evenement: game.evenement,
    });
    s.color = 0;
    s.border_color = 0;
    s.tete_frame = 3;
    s.ang = game.serpent.ang;
    s.len = 3;
    s.queue_collide = false;
    const q = game.serpent.queue;
    for (let i = 0; i < q.length; i++) s.queue.push(q[i]);
    this.serpent = s;
    this.hit = false;
    game.evenement('serpentNoir', { serpent: s });
  }

  permanent(tmod) {
    const game = this.game;
    const s = this.serpent;

    if (this.hit) {
      s.explode(0);
      if (s.len === 0) {
        game.evenement('serpentNoirParti', { serpent: s });
        game.remove_slot(this);
      }
      return;
    }

    const fruits = game.niveau.fruits;
    let fnear = null;
    let dnear = 10000000;
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      const d = (f.x - s.x) * (f.x - s.x) + (f.y - s.y) * (f.y - s.y);
      if (d < dnear) {
        dnear = d;
        fnear = f;
      }
    }

    this.hit = s.move(game.niveau.bounds(), tmod);

    if (fnear) {
      const ang = Math.atan2(fnear.y - s.y, fnear.x - s.x);
      if (Math.sin(ang - s.ang) < 0) s.ang -= 0.1 * tmod;
      else s.ang += 0.1 * tmod;
    }

    // Le fantôme mange au même petit col que la tête du joueur.
    const col = game.colDeTete(s);
    const f = game.niveau.get_fruit(col);
    if (f != null) {
      f.on_eat = null;
      game.eat_fruit(f);
    }
  }
}

// ── 16. Canne (baguette magique) — un fruit géant à dix fois sa valeur ────
const Canne = {
  activate(game, x, y) {
    const f = game.gen_fruit();
    const pts = f.points() * 10;
    f.points_fixes = pts;
    f.geant = true;                   // dessiné sur l'image « standard »
    f.z = 100;
    f.scale = 3;
    f.majCadre();
    f.fall(0.08);
  },
};

// ── 17-18. Molécule — de la frutibarre en gélule ──────────────────────────
const Molecule = {
  activate(game, big) {
    game.fbarre += big ? 20 : 5;
  },
};

// ── 22. Mauvais œil — la frutibarre à zéro ────────────────────────────────
const Oeil = {
  activate(game) {
    game.fbarre = 0;
  },
};

// ── 19. Bombe — posée à la tête, souffle la queue autour d'elle ───────────
class Bombe extends Slot {
  constructor(game) {
    super(game, 13);
    this.x = 0;
    this.y = 0;
  }

  explose() {
    const game = this.game;
    const q = game.serpent.queue;
    const l = q.length;
    let i;
    for (i = 1; i < game.serpent.len; i++) {
      const p = q[Math.max(0, l - i * 5 - 3)];
      const d = (p.x - this.x) * (p.x - this.x) + (p.y - this.y) * (p.y - this.y);
      if (d < 160 * 160) break;
    }
    const di = Math.trunc(i / 3);
    while (i < game.serpent.len) {
      game.serpent.explode(0xFFFFFF);
      game.serpent.len -= di;
      if (game.serpent.len <= i) game.serpent.len = i;
    }
    if (i < 2) game.game_over();
  }

  use() {
    const game = this.game;
    this.x = game.serpent.x;
    this.y = game.serpent.y;
    game.evenement('bombePosee', { x: this.x, y: this.y });
    let time = C.TIME_BOMBE;
    const moi = this;
    const tic = (tmod, deltaT) => {
      time -= deltaT;
      if (time <= 0) {
        game.evenement('bombeExplose', { x: moi.x, y: moi.y });
        game.evenement('son', { nom: 'explose' });
        moi.explose();
        game.updates.delete(tic);
      }
    };
    game.updates.add(tic);
    return true;
  }

  activable() { return true; }
}

// ── 20. Potion verte — la queue fond, segment par segment ─────────────────
class PotionVerte extends TimedSlot {
  constructor(game) {
    super(game, 9, C.TIME_POTIONVERTE);
    this.t = 100;
  }

  close() {
    this.game.serpent.alpha_val = 100;
    super.close();
  }

  effect(tmod, deltaT) {
    this.t -= deltaT * 100;
    if (this.t < 0) {
      this.t = 100;
      this.game.serpent.len--;
      if (this.game.serpent.len <= 0) this.game.game_over();
    }
    this.game.serpent.alpha_val = this.t;
    this.game.serpent.redraw = true;
  }
}

// ── 21. Plume — un cran de vitesse en moins (définitif) ───────────────────
class Plume extends Slot {
  constructor(game) {
    super(game, 43);
    game.serpent.speed--;
  }
}

// ── 23. Flèche bleue — sème des fruits en ligne, id croissant ─────────────
class FlecheBleue {
  constructor(game, rotation, x, y) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.id = game.gen_fruit_id();
    this.ang = rotation * Math.PI / 180;
    this.tic = (tmod) => this.update(tmod);
    game.updates.add(this.tic);
  }

  close() {
    this.game.updates.delete(this.tic);
  }

  update() {
    this.x += Math.cos(this.ang) * C.FLECHE_BLEUE_GENSPEED;
    this.y += Math.sin(this.ang) * C.FLECHE_BLEUE_GENSPEED;

    const b = this.game.niveau.bounds();
    if (this.x - 50 <= b.left || this.y - 50 <= b.top
      || this.x + 50 >= b.right || this.y + 50 >= b.bottom) this.close();

    const f = this.game.gen_fruit();
    if (this.id === C.FRUIT_MAX) this.id--;
    f.on_eat = null;
    f.set_id(this.id++);
    f.set_pos(this.x, this.y);
  }
}

// ── 24. Flèche rouge — pareille, mais suit l'angle du serpent ─────────────
class FlecheRouge {
  constructor(game, x, y) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.id = game.gen_fruit_id();
    // Le fichier d'origine fait `this.ang = ang * Math.PI / 180` sur un `ang`
    // jamais reçu : NaN, aussitôt écrasé par update(). On garde le geste.
    this.ang = NaN;
    this.tic = (tmod) => this.update(tmod);
    game.updates.add(this.tic);
  }

  close() {
    this.game.updates.delete(this.tic);
  }

  update() {
    this.ang = this.game.serpent.ang;
    this.x += Math.cos(this.ang) * C.FLECHE_ROUGE_GENSPEED;
    this.y += Math.sin(this.ang) * C.FLECHE_ROUGE_GENSPEED;

    const b = this.game.niveau.bounds();
    if (this.x - 50 <= b.left || this.y - 50 <= b.top
      || this.x + 50 >= b.right || this.y + 50 >= b.bottom) this.close();

    const f = this.game.gen_fruit();
    if (this.id === C.FRUIT_MAX) this.id--;
    f.on_eat = null;
    f.set_id(this.id++);
    f.set_pos(this.x, this.y);
  }
}

// ── 25. Potion orange — la barre est ivre ─────────────────────────────────
class PotionOrange extends TimedSlot {
  constructor(game) {
    super(game, 10, C.TIME_POTIONORANGE);
    this.delta = 0;
  }

  effect(tmod) {
    this.delta += tmod * (this.game.hasard(3) - 1) * 0.02;
    if (this.delta < -0.07) this.delta = -0.07;
    if (this.delta > 0.07) this.delta = 0.07;
    this.game.serpent.ang += this.delta;
  }
}

// ── 26. Potion jaune — le serpent se pilote en croix, comme un vieux snake ─
class PotionJaune extends TimedSlot {
  constructor(game) {
    super(game, 11, C.TIME_POTIONJAUNE);
    this.dir = -1;
    game.enable_snake_keys = false;
  }

  close() {
    this.game.enable_snake_keys = true;
    super.close();
  }

  effect() {
    const s = this.game.serpent;
    switch (this.dir) {
      case 0: s.ang = 0; break;
      case 1: s.ang = -Math.PI / 2; break;
      case 2: s.ang = Math.PI; break;
      case 3: s.ang = Math.PI / 2; break;
    }
    // Le fichier lit les FLÈCHES en dur (Key.LEFT…), pas la configuration.
    const e = this.game.entree;
    if (e.gauche && this.dir !== 0) this.dir = 2;
    if (e.droite && this.dir !== 2) this.dir = 0;
    if (e.haut && this.dir !== 3) this.dir = 1;
    if (e.bas && this.dir !== 1) this.dir = 3;
  }
}

// ── 27. Dynamite — chaque dynamite de la partie coûte un segment DE PLUS ──
const Pile = {
  counter: 0,
  activate(game) {
    Pile.counter++;
    for (let i = 0; i < Pile.counter; i++) {
      if (game.serpent.len > 0) game.serpent.explode(game.serpent.color);
      else {
        game.game_over();
        return;
      }
    }
  },
};

// ── 28. Poupée — les fruits rampent vers le serpent (définitif) ───────────
class Poupee extends Slot {
  constructor(game) {
    super(game, 44);
  }

  permanent() {
    const fruits = this.game.niveau.fruits;
    const s = this.game.serpent;
    for (let i = 0; i < fruits.length; i++) {
      const f = fruits[i];
      if (!f.isMoving()) {
        const dx = s.x - f.x;
        const dy = s.y - f.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0) {
          f.x += dx / d;
          f.y += dy / d;
        }
      }
    }
  }
}

// ── 29. Auréole — une couronne de douze fruits jumeaux ────────────────────
const Aureole = {
  activate(game, x, y) {
    const ray = 100;
    const b = game.niveau.bounds();
    const nfruits = 12;
    let id;
    do {
      id = game.gen_fruit_id();
    } while (id % 10 !== 0);
    for (let i = 0; i < nfruits; i++) {
      const ang = i / nfruits * Math.PI * 2;
      const fx = x + ray * Math.cos(ang);
      const fy = y + ray * Math.sin(ang);
      if (fx >= b.left + 10 && fy >= b.top + 10 && fx <= b.right - 10 && fy <= b.bottom - 10) {
        const f = game.gen_fruit();
        f.set_id(id);
        f.set_pos(fx, fy);
        f.on_eat = null;
      }
    }
  },
};

// ── 30. Croix — quatre rayons de fruits, id croissant avec la distance ────
class Croix {
  constructor(game, x, y) {
    this.game = game;
    this.sx = x;
    this.sy = y;
    this.dist = 10;
    this.id = game.gen_fruit_id();
    this.tic = (tmod) => this.update(tmod);
    game.updates.add(this.tic);
  }

  close() {
    this.game.updates.delete(this.tic);
  }

  gen_fruit(ang) {
    const x = this.sx + Math.cos(ang) * this.dist;
    const y = this.sy + Math.sin(ang) * this.dist;
    const b = this.game.niveau.bounds();

    if (x - 10 <= b.left || y - 10 <= b.top || x + 10 >= b.right || y + 10 >= b.bottom) {
      return false;
    }

    const f = this.game.gen_fruit();
    f.set_id(this.id);
    f.set_pos(x, y);
    f.on_eat = null;
    return true;
  }

  update() {
    this.dist += C.CROIX_GENSPEED;

    let flag = false;
    if (this.gen_fruit(Math.PI / 4)) flag = true;
    if (this.gen_fruit(Math.PI * 3 / 4)) flag = true;
    if (this.gen_fruit(-Math.PI * 3 / 4)) flag = true;
    if (this.gen_fruit(-Math.PI / 4)) flag = true;

    if (!flag) this.close();

    if (this.id === C.FRUIT_MAX) this.id--;
    this.id++;
  }
}

// ── 31. Sonnette — une cloche au bout de la queue, qui gobe au passage ────
class Sonnette extends Slot {
  constructor(game) {
    super(game, 45);
    this.balance = 0;                 // > 0 : l'animation du coup joue
    this.cloche = { x: 0, y: 0, ang: 0 };
    this.permanent(1, 0);
    game.sonnette_active = true;
  }

  close() {
    super.close();
  }

  permanent(tmod, deltaT) {
    const game = this.game;
    const s = game.serpent;

    if (s.len <= 1) {
      game.remove_unique_slot(this);
      return;
    }

    if (!game.sonnette_active) return;

    let delta = 2;
    const p1 = s.end_queue_pos(0);
    let p2;
    do {
      p2 = s.end_queue_pos(delta++);
    } while (p1 === p2 && delta < 100);

    const ang = Math.atan2(p1.y - p2.y, p1.x - p2.x);
    this.cloche = { x: p1.x, y: p1.y, ang: ang * 180 / Math.PI };

    if (this.balance > 0) this.balance -= deltaT;

    if (this.balance <= 0 && game.entree.espace) {
      this.balance = 0.6;             // la durée du coup de cloche du clip
      game.evenement('son', { nom: 'sonnette' });
      game.evenement('sonnetteSonne', { x: p1.x, y: p1.y });
    }

    // La cloche mange ce qu'elle touche — en permanence, coup ou pas : c'est
    // `get_fruit(s_mc)` à chaque image dans le fichier d'origine.
    const f = game.niveau.get_fruit({ x: p1.x, y: p1.y, w: 22, h: 22 });
    if (f != null) {
      game.eat_fruit(f);
      s.eat = -1;
    }
  }
}

// ── 32. Cloche — le serpent se change en fruits verts, segment à segment ──
const Cloche = {
  FRUITS_VERTS: [76],
  game: null,
  tic: null,
  activate(game) {
    Cloche.game = game;
    game.sonnette_active = false;
    Cloche.tic = () => Cloche.removeQueue();
    game.updates.add(Cloche.tic);
  },
  removeQueue() {
    const game = Cloche.game;
    if (game.serpent.len <= 0) {
      game.sonnette_active = true;
      game.updates.delete(Cloche.tic);
      Cloche.game = null;
      return;
    }

    const p = game.serpent.end_queue_pos(0);
    const f = game.gen_fruit();
    f.set_id(Cloche.FRUITS_VERTS[game.hasard(Cloche.FRUITS_VERTS.length)]);
    f.x = p.x;
    f.y = p.y;

    game.serpent.explode(game.serpent.color);
  },
};

// ── 33. Pentacle — les fruits ne nourrissent plus : ils rongent ───────────
class Pentacle extends Slot {
  constructor(game) {
    super(game, 46);
    game.call_on_eat = () => {
      if (game.serpent.len === 0) game.game_over();
      else game.serpent.explode(game.serpent.color);
    };
  }

  permanent() {}
}

// ── 34. Sabre — moitié de frutibarre, moitié de serpent ───────────────────
const Sabre = {
  activate(game) {
    game.fbarre /= 2;
    game.serpent.len = Math.trunc(game.serpent.len / 2);
  },
};

// ── 35. Coffre à options — trois options en jaillissent ───────────────────
const CoffreOptions = {
  activate(game, x, y) {
    const nbonus = 3;
    for (let i = 0; i < nbonus; i++) {
      const b = game.gen_bonus();
      b.set_pos(x, y);
      b.jump_near(game.hasard(50) + 100, game.hasard(20) + 35, 0.05, game.niveau.bounds());
    }
  },
};

// ── 36. Pieu — HAUT fige au lieu d'accélérer ──────────────────────────────
class Pieu extends TimedSlot {
  constructor(game) {
    super(game, 15, C.TIME_PIEU);
  }

  close() {
    this.game.pieu = false;
    super.close();
  }

  effect() {
    this.game.pieu = true;
  }
}

// ── 37. Potion Fuca — on digère deux fois plus vite… et tout ressort ──────
class PotionFuca extends TimedSlot {
  constructor(game) {
    super(game, 14, C.TIME_POTIONFUCA);
  }

  close() {
    this.game.serpent.eat_speed = 1;
    this.game.serpent.fuca_game = null;
    super.close();
  }

  effect() {
    this.game.serpent.eat_speed = 2;
    this.game.serpent.fuca_game = this.game;
  }
}

const API = {
  Slot, TimedSlot,
  Ciseaux, Langue, Coffre, PotionRouge, Steroids, Bague, PotionBleue,
  PotionRose, PotionViolette, Ressort, Rondelle, Inverseur, PotionNoire,
  Canne, Molecule, Oeil, Bombe, PotionVerte, Plume, FlecheBleue, FlecheRouge,
  PotionOrange, PotionJaune, Pile, Poupee, Aureole, Croix, Sonnette, Cloche,
  Pentacle, Sabre, CoffreOptions, Pieu, PotionFuca,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeBonus = API;

})(typeof window !== 'undefined' ? window : globalThis);
