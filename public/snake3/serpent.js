/*
 * Frutisnake — le serpent (Snake.as) et ce qui bouge (Moveable.as).
 *
 * ── Le modèle, tel que le jeu de 2004 l'écrit ──
 *
 * Le serpent n'est pas une grille : c'est une FILE de points (`queue`). À
 * chaque cinq unités de route parcourue, la tête pousse sa position dans la
 * file ; le corps est fait de `len` segments, chacun enjambant CINQ points de
 * file, dessinés en courbes de plus en plus fines vers la tête. Manger
 * rallonge la file par l'arrière (add_queue) ; l'animation `eat` fait courir
 * un renflement le long du corps.
 *
 * ── La collision, sans hitTest ──
 *
 * Flash testait `gfx.hitTest(x, y, true)` : le point d'avance de la tête
 * contre le DESSIN du corps — les traits, larges de `i·s·q + 8` (la passe de
 * bordure, la plus large), aux bouts et coudes RONDS. On refait ce test à la
 * géométrie : distance du point aux segments de la file, contre la
 * demi-largeur du trait du segment. Les bouts ronds de Flash sont exactement
 * la distance euclidienne au segment — même figure, même verdict.
 *
 * Le point testé n'est PAS la tête : c'est un point d'AVANCE à
 * min(10+len, 18) pixels devant, et la traversée d'une image se teste par
 * crans de cinq pixels (ncols) pour qu'une grande vitesse ne saute pas à
 * travers un anneau. C'est ce qui rend le péril lisible : on meurt en
 * ENTRANT, pas une fois dedans.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const C = sousNode ? require('./const.js') : racine.SnakeConst;

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Le serpent.
 *
 * @param {object} o
 *   x, y      la position de départ
 *   hasard    (n) → entier de 0 à n-1 (Std.random)
 *   evenement (nom, données) — 'son', 'explosion', 'rebond'
 */
class Serpent {
  constructor(o) {
    const opts = o || {};
    this.evenement = opts.evenement || (() => {});
    this.hasard = opts.hasard || ((n) => Math.floor(Math.random() * n));

    this.color = C.COLOR_SNAKE_DEFAULT;
    this.border_color = C.COLOR_SNAKE_BORDER_DEFAULT;
    this.tete_frame = 1;              // tete.gotoAndStop : 1 normal, 2 bleu, 3 noir, 11-13 battle
    this.base_speed = 1;
    this.eat_speed = 1;
    this.queue = [];
    this.x = nombre(opts.x);
    this.y = nombre(opts.y);
    this.dx = 0;
    this.dy = 0;
    this.ang = 0;
    this.eat = 0;
    this.fuca_game = null;
    this.old_ang = -100;
    this.delta_ang = C.SNAKE_DEFAULT_TURN;
    this.speed = C.SNAKE_DEFAULT_SPEED;
    this.len = C.SNAKE_DEFAULT_LENGTH;
    this.dist = 0;
    this.can_move = true;
    this.distort = false;
    this.distort_val = 0;
    this.redraw = true;
    this.queue_collide = true;
    this.wall_rebonds = false;
    this.alpha_val = 100;
    this.color_qpos = -1;
    this.color_val = 0;
    this.last_fruit_id = 0;
    this.vivant = true;               // tete._visible, pour le rendu
    this.col_pt = { x: this.x, y: this.y };
    // L'horloge du dessin (getTimer()/100 dans draw) : le client la fournit,
    // la distorsion de la potion violette s'anime avec elle.
    this.time = 0;

    const pos = { x: this.x, y: this.y };
    for (let i = 0; i < 50; i++) this.queue.push(pos);
  }

  end_queue_pos(delta) {
    return this.queue[Math.max(0, this.queue.length - this.len * 5 + delta)];
  }

  /**
   * Snake.move — avance d'une image. `bounds` est le rectangle du terrain.
   * Rend vrai si le serpent vient de se mordre ou de heurter un mur.
   */
  move(bounds, tmod) {
    let hit = false;

    // La toute petite accélération permanente : la partie se durcit seule.
    this.speed += tmod / 10000;

    if (this.eat > 0) {
      this.eat -= this.eat_speed * tmod / 2;
      this.redraw = true;
      // Potion Fuca : le renflement fini, le fruit ressort par la queue —
      // même id, à la position du bout — et le serpent rend le segment.
      if (this.eat < 0 && this.fuca_game != null) {
        this.len--;
        const f = this.fuca_game.gen_fruit();
        const p = this.end_queue_pos(0);
        f.set_id(this.last_fruit_id);
        f.set_pos(p.x, p.y);
      }
    }

    if (this.old_ang !== this.ang) {
      // int() d'AS2 tronque VERS ZÉRO (pas floor) : -1,5 devient -1.
      this.ang -= Math.trunc(this.ang / (Math.PI * 2)) * Math.PI * 2;
      this.old_ang = this.ang;
      this.dx = Math.cos(this.ang);
      this.dy = Math.sin(this.ang);
    }

    let speed = this.speed * tmod * this.base_speed;
    if (!this.can_move) speed = 0;

    // Le point d'avance, puis la traversée par crans de cinq pixels.
    const ds = Math.min(10 + this.len, 18);
    const col_pt = { x: this.x + this.dx * ds, y: this.y + this.dy * ds };
    let ncols = Math.trunc(speed / 5) + 1;

    while (ncols > 0) {
      ncols--;
      const delta_speed = (ncols > 0) ? 5 : (speed % 5);
      col_pt.x += this.dx * delta_speed;
      col_pt.y += this.dy * delta_speed;
      if (this.queue_collide && this.toucheLeCorps(col_pt.x, col_pt.y)) {
        hit = true;
        break;
      }
    }

    this.x += this.dx * speed;
    this.y += this.dy * speed;

    this.dist += speed / 5;
    const curp = { x: this.x, y: this.y };
    while (this.dist >= 1) {
      this.dist--;
      this.queue.push(curp);
      this.redraw = true;
    }

    const px = col_pt.x;
    const py = col_pt.y;
    if (px < bounds.left || py < bounds.top || px > bounds.right || py > bounds.bottom) {
      if (this.wall_rebonds) {
        if (px < bounds.left || px > bounds.right) this.dx *= -1;
        else this.dy *= -1;
        this.ang = Math.atan2(this.dy, this.dx);
        // Snake.as pose old_ang implicitement au prochain move (ang ≠ old_ang
        // recalcule dx/dy depuis ang — qui redonne les mêmes) ; on garde le
        // même enchaînement en laissant old_ang tel quel.
        this.evenement('son', { nom: 'ressort' });
      } else {
        hit = true;
      }
    }
    this.col_pt = col_pt;
    return hit;
  }

  collision_pt() {
    return this.col_pt;
  }

  /*
   * gfx.hitTest(x, y, true) — le point contre le dessin du corps.
   *
   * Le dessin : pour chaque segment i (de len à 1), une courbe entre les
   * points de file [n-5(k+1)] et [n-5k], tracée deux fois — bordure large de
   * `i·s·q + 8`, corps large de `i·s·q + 5`. Le test « forme » de Flash voit
   * l'union : la bordure, la plus large, décide. Les traits de Flash ont
   * bouts et joints ronds : géométriquement, être touché = être à moins d'une
   * demi-largeur d'un point de la ligne. On approche la courbe par la
   * POLYLIGNE des points de file (espacés de cinq pixels : l'écart de flèche
   * d'une quadratique sur un pas pareil est inférieur au pixel).
   *
   * Comme dans draw_queue, le segment 1 (la pointe de la queue) au alpha nul
   * compte quand même : hitTest ignore la transparence du TRAIT (seul le clip
   * invisible est ignoré) — mourir sur la pointe presque invisible de sa
   * propre queue faisait partie du jeu.
   */
  toucheLeCorps(px, py) {
    const q = this.queue;
    const n = q.length - 1;
    const scale = Math.min(10, this.len + 3) / 10;
    const s = scale * 15 / this.len;
    const eat_flag = (this.eat > 0);

    for (let i = this.len; i > 0; i--) {
      const a = q[Math.max(0, n - 5 * (this.len - i + 1))];
      const b = q[Math.max(0, n - 5 * (this.len - i))];
      let qc = 1;
      if (eat_flag) qc = Math.max(1, 2 - (i - this.eat) * (i - this.eat) / 2);
      const largeur = i * s * qc + 8;      // la passe de bordure, la plus large
      const r = largeur / 2;
      if (distanceSegment2(px, py, a.x, a.y, b.x, b.y) <= r * r) return true;
    }
    return false;
  }

  // Snake.hit(pt) — le corps OU la tête (Battle seulement). Le SWF fait un
  // hitTest vectoriel sur le clip de la tête ; ici une capsule calée sur son
  // cadre mesuré (x −13,1 … +20,2, demi-hauteur 12,85 px à 100 %), portée par
  // le cap et à l'échelle 30+70·scale % comme le dessin.
  hit(pt) {
    if (this.toucheLeCorps(pt.x, pt.y)) return true;
    const scale = Math.min(10, this.len + 3) / 10;
    const k = (30 + 70 * scale) / 100;
    const ux = Math.cos(this.ang), uy = Math.sin(this.ang);
    const ax = this.x - 0.25 * k * ux, ay = this.y - 0.25 * k * uy;
    const bx = this.x + 7.35 * k * ux, by = this.y + 7.35 * k * uy;
    const rayon = 12.85 * k;
    return distanceSegment2(pt.x, pt.y, ax, ay, bx, by) <= rayon * rayon;
  }

  add_queue(fid) {
    this.last_fruit_id = fid;
    this.queue.splice(0, Math.max(0, this.queue.length - this.len * 5 - 1));
    const p = this.queue[0];
    for (let i = 0; i < 10; i++) this.queue.unshift(p);
    this.len++;
    this.redraw = true;
    this.eat = Math.trunc(this.len - 1);
  }

  reverse() {
    let delta = -1;
    const p1 = this.end_queue_pos(delta);
    let p2;
    do {
      p2 = this.end_queue_pos(delta++);
    } while (p1 === p2 && delta < 20);

    this.queue.splice(0, Math.max(0, this.queue.length - this.len * 5 - 1));
    const qlen = this.queue.length;
    for (let i = 0; i < Math.trunc(qlen / 2); i++) {
      const q = this.queue[i];
      this.queue[i] = this.queue[qlen - i - 1];
      this.queue[qlen - i - 1] = q;
    }

    this.ang = Math.atan2(p1.y - p2.y, p1.x - p2.x);
    this.x = p1.x;
    this.y = p1.y;
    this.redraw = true;
  }

  set_color(qpos, qcolor) {
    if (qpos !== this.color_qpos) this.redraw = true;
    this.color_qpos = qpos;
    this.color_val = qcolor;
  }

  // Snake.explode — un segment part en particules. Le moteur raccourcit et
  // ANNONCE ; c'est le client qui fait voler les dix débris.
  explode(rgb) {
    const pos = this.queue[Math.max(0, this.queue.length - (this.len * 5))];
    this.len--;
    this.evenement('explosion', { x: pos.x, y: pos.y, couleur: rgb });
    this.evenement('son', { nom: 'explose' });
    this.redraw = true;
  }

  cut(qpos) {
    this.len -= qpos;
    this.redraw = true;
  }
}

// Distance au carré d'un point au segment [a, b].
function distanceSegment2(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? (wx * vx + wy * vy) / l2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
  return dx * dx + dy * dy;
}

/*
 * Moveable.as — le saut parabolique des fruits et des options.
 *
 * `z` est la hauteur : le dessin se pose à `y - z`, grossi de `z` pour cent,
 * et l'ombre glisse en dessous (x + z/4, y + z/3), rétrécie. Un objet en vol
 * (`z ≠ 0`) ne se mange pas — Fruit.eat exige `z == 0`.
 */
class Mobile {
  constructor(hasard) {
    this.hasard = hasard || ((n) => Math.floor(Math.random() * n));
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.scale = 1;
    this.moving = false;
    this.ombre = false;               // l'ombre se voit pendant le vol
    this.rotation = 0;
    this.t = 0;
    this.speed = 0;
    this.x_start = 0; this.y_start = 0; this.z_start = 0;
    this.x_dest = 0; this.y_dest = 0;
    this.coef_a = 0; this.coef_b = 0;
    // Le cadre du dessin, posé par le niveau (les demi-tailles servent aux
    // bornes du saut, comme _width/2 du clip).
    this.w = 20;
    this.h = 20;
  }

  set_pos(px, py) {
    this.x = px;
    this.y = py;
    this.z = 0;
    this.moving = false;
    this.ombre = false;
  }

  isMoving() {
    return this.moving;
  }

  bouger(tmod) {
    if (this.moving) {
      this.t += tmod * this.speed;
      if (this.t >= 1) {
        this.x = this.x_dest;
        this.y = this.y_dest;
        this.z = 0;
        this.ombre = false;
        this.moving = false;
      } else {
        this.x = this.x_start + (this.x_dest - this.x_start) * this.t;
        this.y = this.y_start + (this.y_dest - this.y_start) * this.t;
        this.z = this.coef_a * this.t * this.t + this.coef_b * this.t + this.z_start;
      }
    }
    return true;
  }

  jump_near(ray, zmax, speed, bounds) {
    this.speed = speed;
    this.x_start = this.x;
    this.y_start = this.y;
    this.z_start = this.z;

    this.t = 0;
    this.coef_b = zmax * 4 - this.z;
    this.coef_a = -this.coef_b - this.z;

    // Le quirk d'époque : random(360) / (2π) — des DEGRÉS divisés par deux pi.
    // L'angle ne couvre qu'un éventail de ~57 tours de cadran ramenés à
    // [0, 57.3 rad] : la direction reste uniforme en pratique, et on garde le
    // même geste que le fichier.
    const ang = this.hasard(360) / (Math.PI * 2);
    this.x_dest = this.x + Math.cos(ang) * ray;
    this.y_dest = this.y + Math.sin(ang) * ray;

    const dw = this.w / 2;
    const dh = this.h / 2;
    if (this.x_dest - dw < bounds.left || this.x_dest + dw > bounds.right
      || this.y_dest - dh < bounds.top || this.y_dest + dh > bounds.bottom) {
      this.jump_near(ray, zmax, speed, bounds);
      return;
    }

    this.ombre = true;
    this.moving = true;
  }

  fall(speed) {
    this.speed = speed;
    this.x_start = this.x;
    this.y_start = this.y;
    this.z_start = this.z;
    this.x_dest = this.x;
    this.y_dest = this.y;
    this.t = 0;
    this.coef_a = 5;
    this.coef_b = -this.z - this.coef_a;
    this.ombre = true;
    this.moving = true;
  }
}

const API = { Serpent, Mobile, distanceSegment2 };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeSerpent = API;

})(typeof window !== 'undefined' ? window : globalThis);
