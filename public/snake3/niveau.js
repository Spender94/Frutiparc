/*
 * Frutisnake — le terrain (Level.as), les fruits (Fruit.as) et les options
 * (Bonus.as).
 *
 * Le terrain est un rectangle de 680 × 410 : l'aire de 700 × 480 moins le
 * bandeau du score (60 en haut), la frutibarre (10 en bas) et les bords (10).
 * Les fruits et options y apparaissent à des positions tirées au sort, vivent
 * un temps limité, et se mangent au CADRE : Flash testait les rectangles des
 * clips (Std.hitTest), pas leurs pixels — un grand fruit est donc large à
 * prendre, et c'est une part réelle de l'équilibre du jeu.
 *
 * Les tailles de cadre viennent du SWF (sprites.json, mesurées à
 * l'extraction) : generate_pos les utilise pour ne rien poser à cheval sur un
 * bord — avec le quirk d'époque : la marge se calcule sur la taille NATURELLE
 * du dessin (`fmc._width × 100/_xscale`), pas sur sa taille à l'écran.
 *
 * Et le cadre est celui du CLIP, qui a une vie : snake3_fruit rebondit à
 * l'apparition (un dixième de sa taille à la première image, 1,2 au sommet,
 * cent pour cent au `stop()` de l'image 10 — C.ECHELLES_FRUIT), et
 * Std.hitTest le prenait tel quel. Un fruit à peine posé ne se mangeait donc
 * pas, et un fruit au sommet de son rebond se prenait un peu plus loin. Le
 * moteur tient l'image du clip (`image`, avancée par tmod) pour que sa hitbox
 * suive — et le rendu, qui joue le même clip, dessine ce qu'on mange.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const C = sousNode ? require('./const.js') : racine.SnakeConst;
const S = sousNode ? require('./serpent.js') : racine.SnakeSerpent;

// L'image du clip d'enrobage : une par image d'écran (40 i/s, l'en-tête du
// SWF), quand tmod compte en trente-deuxièmes de seconde. Elle s'arrête au
// `stop()` ; « disparait » n'est pas son affaire (l'objet est déjà retiré).
function avancerClip(o, tmod) {
  if (o.image < C.CLIP_STOP) o.image = Math.min(C.CLIP_STOP, o.image + tmod * C.SWF_FPS / C.WANTED_FPS);
}
function echelleClip(o, echelles) {
  return echelles[Math.min(C.CLIP_STOP, Math.max(1, Math.floor(o.image))) - 1];
}

// Recouvrement de deux cadres centrés (Std.hitTest entre clips : les
// rectangles englobants, en coordonnées de scène).
function cadresSeTouchent(ax, ay, aw, ah, bx, by, bw, bh) {
  return Math.abs(ax - bx) * 2 <= aw + bw && Math.abs(ay - by) * 2 <= ah + bh;
}

/** Fruit.as — un fruit posé (ou en vol). */
class Fruit extends S.Mobile {
  constructor(niveau, id, time) {
    super(niveau.hasard);
    this.niveau = niveau;
    this.id = id;
    this.time = time;
    this.f_timeout = null;
    // on_eat est REMPLAÇABLE : les fruits d'un coffre, d'une croix ou d'une
    // flèche ne font pas grandir (`f.on_eat = undefined` dans les sources).
    this.on_eat = (serpent) => { serpent.add_queue(this.id); };
    this.geant = false;               // la canne : dessiné en « standard » ×3
    this.points_fixes = null;         //   … et dix fois sa valeur, figée
    this.image = 1;                   // l'image du clip d'enrobage (451)
    this.majCadre();
  }

  /** L'échelle du clip à cet instant — Flash mangeait à ce cadre-là. */
  echelleClip() { return echelleClip(this, C.ECHELLES_FRUIT); }

  majCadre() {
    const d = this.niveau.dims.fruit(this.id);
    this.w = d.w * this.scale;
    this.h = d.h * this.scale;
  }

  set_id(new_id) {
    this.id = new_id;
    this.majCadre();
  }

  get_id() {
    return this.id;
  }

  points() {
    if (this.points_fixes != null) return this.points_fixes;
    return C.fruit_points(this.id);
  }

  eat(col) {
    const k = this.echelleClip();
    return this.z === 0 && cadresSeTouchent(
      this.x, this.y, this.w * k, this.h * k, col.x, col.y, col.w, col.h);
  }

  move(tmod) {
    this.bouger(tmod);
    avancerClip(this, tmod);
    if (this.moving) return true;
    this.time -= tmod;
    return this.time > 0;
  }

  on_timeout(f) {
    this.f_timeout = f;
  }

  timeout() {
    if (this.f_timeout) this.f_timeout(this);
  }
}

/** Bonus.as — une option posée. */
class Option extends S.Mobile {
  constructor(niveau, id, time) {
    super(niveau.hasard);
    this.niveau = niveau;
    this.id = id;
    this.time = time;
    this.rotation = 0;
    this.image = 1;                   // l'image du clip d'enrobage (450)
    const d = niveau.dims.bonus(id);
    this.w = d.w;
    this.h = d.h;
  }

  /** L'échelle du clip à cet instant (le rebond de l'option monte à 1,5). */
  echelleClip() { return echelleClip(this, C.ECHELLES_BONUS); }

  update(partie, tmod) {
    this.bouger(tmod);
    avancerClip(this, tmod);
    // La flèche bleue tourne sur elle-même ; la rouge suit l'angle du serpent.
    if (this.id === 23) this.rotation += C.FLECHE_ROTATION_SPEED;
    if (this.id === 24) this.rotation = partie.serpent.ang * 180 / Math.PI;
  }
}

/**
 * Level.as — le terrain.
 *
 * @param {object} o
 *   hasard  (n) → entier
 *   dims    { fruit(id) → {w,h}, bonus(id) → {w,h} } — les cadres du SWF
 *   evenement (nom, données)
 */
class Niveau {
  constructor(o) {
    const opts = o || {};
    this.hasard = opts.hasard || ((n) => Math.floor(Math.random() * n));
    this.dims = opts.dims || {
      fruit: () => ({ w: 30, h: 30 }),
      bonus: () => ({ w: 28, h: 28 }),
    };
    this.evenement = opts.evenement || (() => {});

    this.width = C.WIDTH - C.BORDER * 2;
    this.height = C.HEIGHT - (C.BARRE_DOWN + C.BARRE_UP);
    this.corner = { x: C.BORDER, y: C.BARRE_UP };
    this.corner_down = { x: C.BORDER + this.width, y: C.BARRE_UP + this.height };
    this.fruits = [];
    this.bonuses = [];
  }

  bounds() {
    return {
      left: this.corner.x,
      top: this.corner.y,
      right: this.corner.x + this.width,
      bottom: this.corner.y + this.height,
    };
  }

  nfruits() { return this.fruits.length; }
  nbonus() { return this.bonuses.length; }

  // Level.generate_pos — la marge est b = BORDER + 10, et la hauteur retire
  // aussi la frutibarre. `w` et `h` sont les tailles NATURELLES du dessin.
  generate_pos(mobile, w, h) {
    const b = C.BORDER + 10;
    const x = b + this.hasard(Math.trunc(C.WIDTH - b * 2 - w)) + w / 2;
    const y = b + C.BARRE_UP
      + this.hasard(Math.trunc(C.HEIGHT - b * 2 - h - C.BARRE_UP - C.FRUTIBARRE_SIZE)) + h / 2;
    mobile.x = x;
    mobile.y = y;
  }

  generate_fruit(id) {
    const time = 250 + this.hasard(125);
    const fruit = new Fruit(this, id, time);
    this.generate_pos(fruit, fruit.w, fruit.h);
    this.fruits.push(fruit);
    return fruit;
  }

  generate_bonus(id) {
    const time = 300 + this.hasard(150);
    const bonus = new Option(this, id, time);
    this.generate_pos(bonus, bonus.w, bonus.h);
    this.bonuses.push(bonus);
    return bonus;
  }

  // La chute SCRIPTÉE du tournoi (carte.js) : l'option, sa place et sa durée
  // sont déjà tirées dans la carte — on pose tel quel, sans toucher au hasard.
  poser_bonus(id, x, y, vie) {
    const bonus = new Option(this, id, vie);
    bonus.x = x;
    bonus.y = y;
    this.bonuses.push(bonus);
    return bonus;
  }

  update(partie, tmod) {
    for (let i = 0; i < this.fruits.length; i++) {
      const f = this.fruits[i];
      if (!f.move(tmod)) {
        this.evenement('son', { nom: 'fdisp' });
        f.timeout();
        this.evenement('fruitDisparait', { fruit: f });
        this.fruits.splice(i, 1);
        i--;
      }
    }
    for (let i = 0; i < this.bonuses.length; i++) {
      const b = this.bonuses[i];
      b.update(partie, tmod);
      b.time -= tmod;
      if (b.time <= 0) {
        this.evenement('son', { nom: 'fdisp' });
        this.evenement('bonusDisparait', { bonus: b });
        this.bonuses.splice(i, 1);
        i--;
      }
    }
  }

  // `col` est un cadre {x, y, w, h} — celui du petit clip `col` de la tête.
  get_fruit(col) {
    for (let i = 0; i < this.fruits.length; i++) {
      const f = this.fruits[i];
      if (f.eat(col)) {
        this.fruits.splice(i, 1);
        return f;
      }
    }
    return null;
  }

  // Level.hit_fruit(mc) — la langue : cadre contre cadre, vol compris. Le
  // cadre est celui du clip tel qu'il se dessine : à l'échelle de son image
  // et, en vol, levé de z et grossi de (100 + z) % — ce que Moveable.move pose
  // (`_y = y − z`, `_xscale = (100 + z) × scale`) et que le rendu montre.
  hit_fruit(cadre) {
    for (let i = 0; i < this.fruits.length; i++) {
      const f = this.fruits[i];
      const k = f.echelleClip() * (100 + f.z) / 100;
      if (cadresSeTouchent(f.x, f.y - f.z, f.w * k, f.h * k, cadre.x, cadre.y, cadre.w, cadre.h)) {
        this.fruits.splice(i, 1);
        return f;
      }
    }
    return null;
  }

  pushFruit(f) {
    this.fruits.push(f);
  }

  get_bonus(col) {
    for (let i = 0; i < this.bonuses.length; i++) {
      const b = this.bonuses[i];
      const k = b.echelleClip();
      if (!b.isMoving() && cadresSeTouchent(
        b.x, b.y, b.w * k, b.h * k, col.x, col.y, col.w, col.h)) {
        this.bonuses.splice(i, 1);
        return b;
      }
    }
    return null;
  }
}

const API = { Niveau, Fruit, Option, cadresSeTouchent };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeNiveau = API;

})(typeof window !== 'undefined' ? window : globalThis);
