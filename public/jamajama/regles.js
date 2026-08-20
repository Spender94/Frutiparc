// JamaJama — les RÈGLES, et rien qu'elles. Transcription du moteur du SWF
// (Games/poulpi/game.swf, sprite 898, décompilé méthode par méthode) en
// JavaScript pur : pas un pixel ici, seulement l'état du plateau et sa
// mécanique. Le même fichier sert le navigateur (window.JamaRegles) et le
// serveur (require) — c'est ainsi que le replay d'un score se REJOUE côté
// serveur pour être cru, comme l'anti-triche d'origine l'entendait.
//
// ── Le modèle de temps ──
//
// Le jeu d'origine avance au rythme de ses animations : une entrée n'est
// acceptée que quand tout est retombé (turnCleared), et chaque « lot »
// d'animations (flush) sépare deux passes de réaction. Les animations n'y
// sont pourtant pas décoratives : certaines PORTENT des changements d'état à
// leur début ou à leur fin — la caisse disparaît quand l'éclaboussure
// commence, le mur disparaît quand sa flamme s'éteint, la sortie change de
// couche quand sa porte a fini de s'ouvrir, l'archer ressuscite au bout de
// son clignotement. Ici, chaque animation devient un DESCRIPTEUR visuel avec
// deux crochets d'état (surDebut/surFin) ; « jouer un lot », c'est appliquer
// ces crochets dans l'ordre exact du lecteur — les rapides d'abord (et leurs
// fins), puis les effets un à un — et l'état final est identique à celui du
// Flash quand ses animations se sont tues. Le client rejoue les descripteurs
// à son rythme ; le serveur les ignore.
//
// ── L'ordre des réactions ──
//
// Fidèle au fichier : les sprites se mettent à jour par groupes ordonnés
// (les AIMANTS — Jade compris, isMagnet y est vrai —, puis les MÉCHANTS,
// puis le reste, chacun dans l'ordre de création), et le héros est créé
// APRÈS les tuiles du niveau, donc il réagit en dernier du groupe MISC.
//
// ── Les coquilles d'origine, préservées ──
//
// · L'araignée ne tue jamais une cible adjacente à l'OUEST : la boucle
//   d'adjacence s'arrête à SOUTH (0,1,2), l'auteur a oublié WEST.
// · Un aimant en or balaie jusqu'au bord du plateau : là où l'aimant simple
//   s'arrête au premier obstacle, l'or remet sa case d'arrivée à zéro et
//   continue — à travers les murs.
// · Le compteur d'une bombe poussée à paramètre nul repart à 2, pas à 1.
// · La mort du héros pousse DEUX fois la même animation d'yeux (die()).
// · Le mur brûlé porte l'image « 17 » dans sa table d'autotile (_FRAMES).
// · L'« Interrupteur » (PIN) est enregistré mais Sprite.create ne sait pas
//   le construire : un niveau n'en contiendra jamais.

'use strict';
(function (racine, fabrique) {
  if (typeof module !== 'undefined' && module.exports) module.exports = fabrique();
  else racine.JamaRegles = fabrique();
})(typeof self !== 'undefined' ? self : this, function () {

  // ── Direction ──
  const Direction = {
    NORTH: 0, EAST: 1, SOUTH: 2, WEST: 3, NE: 4, NW: 5, SE: 6, SW: 7,
    _Names: ['North', 'East', 'South', 'West'],
    nameOf(d) { return (d >= 0 && d <= 3) ? Direction._Names[d] : 'UnknownDirection:' + d; },
    oposite(d) {
      if (d === Direction.NORTH) return Direction.SOUTH;
      if (d === Direction.SOUTH) return Direction.NORTH;
      if (d === Direction.WEST) return Direction.EAST;
      if (d === Direction.EAST) return Direction.WEST;
      return -1;
    },
    next(d) { return d + 1 > 3 ? 0 : d + 1; },
  };

  // ── Coord ──
  class Coord {
    constructor(x, y) { this.x = x; this.y = y; }
    clone() { return new Coord(this.x, this.y); }
    next(d) {
      switch (d) {
        case Direction.NORTH: return new Coord(this.x, this.y - 1);
        case Direction.EAST: return new Coord(this.x + 1, this.y);
        case Direction.SOUTH: return new Coord(this.x, this.y + 1);
        case Direction.WEST: return new Coord(this.x - 1, this.y);
        case Direction.NE: return new Coord(this.x + 1, this.y - 1);
        case Direction.NW: return new Coord(this.x - 1, this.y - 1);
        case Direction.SE: return new Coord(this.x + 1, this.y + 1);
        case Direction.SW: return new Coord(this.x - 1, this.y + 1);
        default: return new Coord(-1, -1);
      }
    }
    equals(o) { return this.x === o.x && this.y === o.y; }
    directionOf(o) {
      if (this.x === o.x) return this.y > o.y ? Direction.NORTH : Direction.SOUTH;
      return this.x > o.x ? Direction.WEST : Direction.EAST;
    }
    distanceOf(o) {
      if (this.x === o.x) return Math.abs(this.y - o.y);
      if (this.y === o.y) return Math.abs(this.x - o.x);
      return -1;
    }
    toString() { return '[' + this.x + ':' + this.y + ']'; }
  }

  class Dimension {
    constructor(w, h) { this.width = w; this.height = h; }
    clone() { return new Dimension(this.width, this.height); }
  }

  // ── Element : identifiants et registre ──
  class Element {
    constructor(copy) {
      if (copy != null) {
        this.id = copy.id;
        this.pos = copy.pos.clone();
        this.param = copy.param;
        this.orientation = copy.orientation;
      } else {
        this.id = -1;
        this.pos = new Coord(0, 0);
        this.param = -1;
        this.orientation = 0;
      }
    }
    setOrientation(o) { this.orientation = o; }
    toString() { return this.id === Element.NONE ? 'None' : Element._NAMES[this.id]; }
  }
  Element.GHOST = -2;
  Element.NONE = -1;
  Element.EXIT = 0;
  Element.HERO = 1;
  Element.BOX = 2;
  Element.FRUIT = 3;
  Element.PIN = 4;
  Element.ARCHER = 5;
  Element.SPIDER = 6;
  Element.WATER = 7;
  Element.WALL = 8;
  Element.MAGNET = 9;
  Element.GMAGNET = 10;
  Element.ONE_WAY = 11;
  Element.BOMB = 12;
  Element.WINKLE = 13;
  Element.PEEBLE = 14;
  Element.RUNE = 15;
  Element.KOHL = 16;
  Element.LOUKI = 17;
  Element.LURKER = 18;
  Element.JADE = 19;
  Element.ONE_WAY_STRICT = 20;
  Element.EYE = 21;
  Element.BRIDGE = 22;
  Element._NAMES = [];
  Element._TITLES = [];
  // L'ordre de la palette de l'éditeur suit l'ordre d'enregistrement.
  Element.EDITOR_IDS = [];
  (function () {
    const _r = (id, nom, titre, editeur) => {
      Element._NAMES[id] = nom;
      Element._TITLES[id] = titre;
      if (editeur) Element.EDITOR_IDS.push(id);
    };
    _r(Element.EXIT, 'Exit', 'Sortie', true);
    _r(Element.HERO, 'Hero', 'Hero', true);
    _r(Element.FRUIT, 'Fruit', 'Fruit', true);
    _r(Element.BOX, 'Box', 'Caisse', true);
    _r(Element.WALL, 'Wall', 'Mur', true);
    _r(Element.WATER, 'Water', 'Eau', true);
    _r(Element.BRIDGE, 'Bridge', 'Pont foutu', true);
    _r(Element.PEEBLE, 'Peeble', 'Cailloux', true);
    _r(Element.RUNE, 'Rune', 'Rune', true);
    _r(Element.ONE_WAY, 'OneWay', 'Voie unique', true);
    _r(Element.ONE_WAY_STRICT, 'OneWayStrict', 'Voie unique stricte', true);
    _r(Element.MAGNET, 'Magnet', 'Aimant', true);
    _r(Element.GMAGNET, 'GoldMagnet', 'Aimant en or', true);
    _r(Element.BOMB, 'Bomb', 'BoBombe', true);
    _r(Element.LOUKI, 'Louki', 'Louki', true);
    _r(Element.KOHL, 'Kohl', 'Kohl', true);
    _r(Element.WINKLE, 'Winkle', 'Winkle', true);
    _r(Element.ARCHER, 'Archer', 'Electrificator', true);
    _r(Element.SPIDER, 'Spider', 'Araignée', true);
    _r(Element.LURKER, 'Lurker', 'Lurker', true);
    _r(Element.PIN, 'Pin', 'Interrupteur', false);
    _r(Element.GHOST, 'Ghost', 'Fantome', false);
    _r(Element.JADE, 'Jade', 'Jade', true);
    _r(Element.EYE, 'Eye', 'Zoeil', true);
  })();
  Element.nameOf = (id) => Element._NAMES[id];
  Element.titleOf = (id) => Element._TITLES[id];
  Element.idOf = function (name) {
    for (let i = 0; i < Element._NAMES.length; i++) if (Element._NAMES[i] === name) return i;
    if (name === Element._NAMES[Element.NONE]) return Element.NONE;
    if (name === Element._NAMES[Element.GHOST]) return Element.GHOST;
    return -999;
  };

  // ── Chunker : le codec des niveaux. Le grand H manque à l'alphabet —
  // c'est celui du fichier, on ne le répare pas. ──
  const Chunker = {
    CHARS: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGIJKLMNOPQRSTUVWXYZ',
    encode(v) {
      if (v < 0) return '-' + Chunker.CHARS.charAt(-v);
      return Chunker.CHARS.charAt(v);
    },
    lecteur(data) {
      let pos = 0;
      return {
        eos: () => pos >= data.length,
        next() {
          if (pos >= data.length) return -1;
          let c = data.charAt(pos++);
          if (c === '-') {
            c = data.charAt(pos++);
            return -1 * Chunker.CHARS.indexOf(c);
          }
          return Chunker.CHARS.indexOf(c);
        },
      };
    },
  };

  // ── Level : cinq casiers d'en-tête, puis cinq casiers par élément ──
  class Level {
    constructor() {
      this.version = 1;
      this.startPos = new Coord(0, 0);
      this.size = new Dimension(0, 0);
      this.tiles = [];
      this.id = -1;
      this.title = '';
      this.author = '';
      this.bestScore = 0;
    }
    parse(packed) {
      this.tiles = [];
      const c = Chunker.lecteur(packed);
      this.version = c.next();
      this.startPos.x = c.next();
      this.startPos.y = c.next();
      this.size.width = c.next();
      this.size.height = c.next();
      while (!c.eos()) {
        const e = new Element(null);
        e.id = c.next();
        e.pos.x = c.next();
        e.pos.y = c.next();
        e.param = c.next();
        e.orientation = c.next();
        this.tiles.push(e);
      }
    }
    dump() {
      let s = Chunker.encode(this.version)
        + Chunker.encode(this.startPos.x) + Chunker.encode(this.startPos.y)
        + Chunker.encode(this.size.width) + Chunker.encode(this.size.height);
      for (const t of this.tiles) {
        s += Chunker.encode(t.id) + Chunker.encode(t.pos.x) + Chunker.encode(t.pos.y)
          + Chunker.encode(t.param) + Chunker.encode(t.orientation);
      }
      return s;
    }
    clone() {
      const l = new Level();
      l.version = this.version;
      l.startPos = this.startPos.clone();
      l.size = this.size.clone();
      for (const t of this.tiles) l.tiles.push(new Element(t));
      return l;
    }
  }
  Level.depuisChaine = function (packed) {
    const l = new Level();
    l.parse(packed);
    return l;
  };

  // ── Replay ──
  const Replay = {
    MOVE_NORTH: Direction.NORTH, MOVE_EAST: Direction.EAST,
    MOVE_SOUTH: Direction.SOUTH, MOVE_WEST: Direction.WEST,
    START_GHOST: 4, STOP_GHOST: 5,
  };

  // ── Constantes partagées avec l'habillage ──
  const Consts = {
    WIDTH: 384, HEIGHT: 384, SPRITE_WIDTH: 32, SPRITE_HEIGHT: 32,
    MAX_LEVEL_WIDTH: 12, MAX_LEVEL_HEIGHT: 11,
    BLACK_BROWN: 6442280, DARK_BROWN: 12163430, BROWN: 13220225,
    LIGHT_BROWN: 14338204, DARK_GREEN: 4227200, COUNTER_COLOR: 16777215,
    EMPTY_LEVEL_TITLE: '... vide ...', WITHOUT_TITLE: 'sans nom',
  };
  Consts.BACKGROUND = Consts.DARK_GREEN;

  // ── Board : trois couches, celle du fantôme par-dessus tout ──
  class Board {
    constructor(d) {
      this._width = d.width;
      this._height = d.height;
      this._below = [];
      this._over = [];
      this._ether = [];
      this._nullSprite = new NullSprite(null);
    }
    isValid(p) { return p.x >= 0 && p.y >= 0 && p.x < this._width && p.y < this._height; }
    _getIndex(c) { return this._width * c.y + c.x; }
    get(p) {
      if (!this.isValid(p)) return this._nullSprite;
      const i = this._getIndex(p);
      if (this._ether[i] != null) return this._ether[i];
      if (this._over[i] != null) return this._over[i];
      return this.getBelow(p);
    }
    getOver(p) {
      if (!this.isValid(p)) return this._nullSprite;
      const s = this._over[this._getIndex(p)];
      return s == null ? this._nullSprite : s;
    }
    getBelow(p) {
      if (!this.isValid(p)) return this._nullSprite;
      const s = this._below[this._getIndex(p)];
      return s == null ? this._nullSprite : s;
    }
    erase(s) {
      if (!this.isValid(s.pos)) return;
      const i = this._getIndex(s.pos);
      if (this._ether[i] === s) this._ether[i] = null;
      if (this._over[i] === s) this._over[i] = null;
      if (this._below[i] === s) this._below[i] = null;
    }
    set(p, s) {
      if (!this.isValid(p)) return;
      this.erase(s);
      if (s.id === Element.GHOST) this._ether[this._getIndex(p)] = s;
      else if (s.couche === 'below') {
        if (this.getBelow(p).id !== Element.NONE) return;
        this._below[this._getIndex(p)] = s;
      } else {
        if (this.getOver(p).id !== Element.NONE) return;
        this._over[this._getIndex(p)] = s;
      }
      s.pos = p.clone();
    }
    // La sortie ouverte grimpe de la couche du dessous à celle du dessus, à
    // la fin de son animation d'ouverture. Son champ `below`, lui, reste
    // vrai — c'est ainsi dans le fichier, et c'est ce qui laisse l'archer,
    // l'œil et le lurker voir À TRAVERS une sortie ouverte.
    swapLayer(s, versOver) {
      const i = this._getIndex(s.pos);
      if (versOver) {
        if (this._below[i] === s) this._below[i] = null;
        this._over[i] = s;
      } else {
        if (this._over[i] === s) this._over[i] = null;
        this._below[i] = s;
      }
    }
  }

  // ── Les animations : descripteur visuel + crochets d'état ──
  const anims = {
    simple(desc, surDebut, surFin) {
      return { desc, surDebut: surDebut || null, surFin: surFin || null };
    },
  };

  // ── Sprite : la base ──
  let prochainUid = 1;
  class Sprite extends Element {
    constructor(data) {
      super(data);
      this.uid = 0;                    // posé à la création par le playground
      this.attractedByMagnet = false;
      this.isMoving = false;
      this.below = false;
      this.alive = true;
      this.isMagnet = false;
      this.isBadGuy = false;
      this.playground = null;
      this.board = null;
    }
    get couche() { return this.below ? 'below' : 'over'; }
    setPlayground(pg) { this.playground = pg; this.board = pg.getBoard(); }
    destroy() {
      this.alive = false;
      this.playground.emet({ type: 'destroy', uid: this.uid });
      this.playground.spriteDestroyed(this);
    }
    show() {}
    canBeCrossed(sprite, d) { return false; }
    crossed(sprite, d) {}
    canLeave(sprite, d) { return true; }
    canMove(d) { return false; }
    move(d) {}
    canBePushed(sprite) { return false; }
    update(onmove) {}
    isAvatar() { return !!this.IS_AVATAR; }
    requiresParameter() { return false; }
    setParameter(p) { this.param = p; return this.param; }
    defaultParameter() { return -1; }
    // burn() rend l'animation de combustion (null : rien à jouer) ;
    // endBurn() est le crochet de fin. Un sprite SANS burn est incombustible,
    // et la déflagration s'arrête sur lui — le test d'origine est
    // « burn == null » sur la méthode elle-même.
  }

  class NullSprite extends Sprite {
    constructor(data) {
      super(data);
      this.id = Element.NONE;
      this.below = true;
    }
    canBeCrossed() { return true; }
  }

  // ── Avatar (héros, fantôme, créatures possédées) ──
  class Avatar extends Sprite {
    constructor(data) { super(data); this.IS_AVATAR = true; }
    setOrientation(d) {
      if (this.attractedByMagnet) return;
      this.orientation = d;
      this.playground.emet({ type: 'orientation', uid: this.uid, d });
    }
    wakeUp() {
      const pg = this.playground;
      const ghost = pg.getCurrentAvatar();
      const moi = this;
      pg.pushEffect(anims.simple({ type: 'wakeUp', uid: this.uid },
        () => { ghost.destroy(); }));
    }
    canMove(d) {
      if (!this.board.getBelow(this.pos).canLeave(this, d)) return false;
      const over = this.board.get(this.pos.next(d));
      const below = this.board.getBelow(this.pos.next(d));
      if (!below.canBeCrossed(this, d)) return false;
      return over.id === Element.NONE || over.canBeCrossed(this, d)
        || (over.canBePushed(this) && over.canMove(d));
    }
    move(d) {
      const over = this.board.get(this.pos.next(d));
      const below = this.board.getBelow(this.pos.next(d));
      if (over.canBeCrossed(this, d)) {
        over.crossed(this, d);
        this.playground.move(this.pos, d, null);
        if (over !== below) below.crossed(this, d);
        return;
      }
      if (over.canBePushed(this) && over.canMove(d)) {
        over.move(d);
        this.playground.move(this.pos, d, null);
        below.crossed(this, d);
      }
    }
  }

  // ── Hero ──
  class Hero extends Avatar {
    constructor(data) { super(data); this._sleeping = false; }
    victory() { this.playground.emet({ type: 'heroVictory', uid: this.uid }); }
    burn() {
      if (this._sleeping) this.wakeUp();
      const av = this.playground.getCurrentAvatar();
      if (av != null && av.id === Element.GHOST && av.alive) {
        this.playground.emet({ type: 'cacher', uid: av.uid });
      }
      return anims.simple({ type: 'heroBurn', uid: this.uid });
    }
    endBurn() { this.failure(); }
    die() {
      if (this._sleeping) this.wakeUp();
      this.alive = false;
      // L'original pousse DEUX fois l'animation des yeux — on garde le pas.
      this.playground.pushEffect(anims.simple({ type: 'heroMort', uid: this.uid }));
      this.playground.pushEffect(anims.simple({ type: 'heroMort', uid: this.uid }));
      const moi = this;
      this.playground.pushEffect(anims.simple({ type: 'callback' }, null,
        () => { moi.failure(); }));
    }
    canStartGhost() { return this.board.getBelow(this.pos).id !== Element.RUNE; }
    failure() { this.playground.defeat(); }
    sleep() { this._sleeping = true; this.playground.emet({ type: 'heroSleep', uid: this.uid }); }
    wakeUp() {
      this._sleeping = false;
      this.playground.emet({ type: 'heroWake', uid: this.uid });
      this.setOrientation(this.orientation);
    }
  }

  // ── Ghost ──
  class Ghost extends Hero {
    canMove(d) {
      return Avatar.prototype.canMove.call(this, d)
        || this._canPossess(this.board.get(this.pos.next(d)));
    }
    move(d) {
      const cible = this.board.get(this.pos.next(d));
      if (this._canPossess(cible)) {
        this.setOrientation(d);
        cible.wakeUp();
        this.playground.setAvatar(cible);
        this.playground.move(this.pos, d, null);
        return;
      }
      Avatar.prototype.move.call(this, d);
    }
    _canPossess(s) {
      return s.id === Element.LOUKI || s.id === Element.KOHL || s.id === Element.WINKLE;
    }
  }

  // ── Exit ──
  class Exit extends Sprite {
    constructor(data) {
      super(data);
      this.below = true;
      this._opened = false;
      this._openDelayed = false;
    }
    isClosed() { return !this._opened; }
    open() {
      if (this._opened) return;
      if (this.board.getOver(this.pos).id !== Element.NONE) {
        this._openDelayed = true;
        return;
      }
      this._opened = true;
      this._openDelayed = false;
      const moi = this;
      this.playground.pushEffect(anims.simple({ type: 'openExit', uid: this.uid },
        null, () => { moi.board.swapLayer(moi, true); }));
    }
    canBeCrossed(sprite, d) {
      if (this._opened) {
        return sprite.id === Element.HERO && d !== Direction.oposite(this.orientation);
      }
      return true;
    }
    crossed(sprite, d) {
      if (this._opened && sprite.id === Element.HERO) this.playground.victory(this);
    }
    update(onmove) { if (this._openDelayed) this.open(); }
  }

  // ── Box ──
  class Box extends Sprite {
    constructor(data) { super(data); this._inWater = false; }
    canBePushed(s) { return s.id === Element.HERO; }
    canMove(d) {
      const n = this.pos.next(d);
      if (!this.board.isValid(n)) return false;
      return this.board.get(n).canBeCrossed(this, d);
    }
    move(d) {
      const n = this.pos.next(d);
      this.board.get(n).crossed(this, d);
      this.playground.move(this.pos, d, null);
    }
    isInWater() { return this._inWater; }
    setInWater(b) { this._inWater = b; }
    burn() { return anims.simple({ type: 'burn', uid: this.uid }); }
    endBurn() { this.destroy(); }
  }

  // ── Fruit ──
  class Fruit extends Sprite {
    constructor(data) {
      super(data);
      if (!(this.param > 0) || this.param == null) this.param = this.defaultParameter();
    }
    requiresParameter() { return true; }
    defaultParameter() { return 1; }
    setParameter(p) {
      if (p > 5 || !(p > 0)) p = 1;
      this.param = p;
      return this.param;
    }
    canBeCrossed(sprite, d) { return sprite.id === Element.FRUIT && this.param === sprite.param; }
    crossed(sprite, d) {
      // Deux fruits pareils fusionnent : les deux meurent sur place.
      this.playground.push(anims.simple({ type: 'fruitMerge', uid: sprite.uid, avec: this.uid }));
      this.board.erase(this);
      this.alive = false;
      this.board.erase(sprite);
      sprite.alive = false;
    }
    canBePushed(sprite) { return sprite.id === Element.HERO; }
    canMove(d) {
      const n = this.pos.next(d);
      if (!this.board.isValid(n)) return false;
      return this.board.get(n).canBeCrossed(this, d);
    }
    move(d) {
      const n = this.pos.next(d);
      const s = this.board.get(n);
      s.crossed(this, d);
      if (s.id !== Element.FRUIT) this.playground.move(this.pos, d, null);
    }
    burn() { return anims.simple({ type: 'burn', uid: this.uid }); }
    endBurn() { this.destroy(); }
  }

  // ── Wall ──
  class Wall extends Sprite {
    burn() { return anims.simple({ type: 'burn', uid: this.uid }); }
    endBurn() {
      this.alive = false;
      this.destroy();
      this.playground.emet({ type: 'refreshAutour', x: this.pos.x, y: this.pos.y });
    }
  }
  // La table d'autotile, avec son « 17 » d'origine à l'indice 13.
  Wall._FRAMES = ['1', '5', '9', '13', '2', '6', '10', '14', '3', '7', '11', '15', '4', '17', '12', '16'];

  // ── Water / Bridge ──
  class Water extends Sprite {
    constructor(data) {
      super(data);
      this.below = true;
      this._containsBox = false;
      this._watterBelow = false;
    }
    hasWaterBelow() { return this._watterBelow; }
    isFilledWithBox() { return this._containsBox; }
    canBeCrossed(sprite, d) {
      if (sprite.id === Element.WINKLE) return true;
      if (sprite.id === Element.BOX) return true;
      if (this._containsBox) return true;
      return false;
    }
    crossed(sprite, d) {
      if (sprite.id === Element.BOX && !this._containsBox) this._fillWithBox(sprite);
    }
    _fillWithBox(box) {
      const moi = this;
      this.playground.pushEffect(anims.simple(
        { type: 'boxFall', uid: this.uid, box: box.uid },
        () => { box.destroy(); }));
      this._containsBox = true;
      box.setInWater(true);
    }
  }
  Water.isWaterBased = (s) => s.id === Element.WATER || s.id === Element.BRIDGE;
  Water._FRAMES = ['1', '5', '9', '13', '2', '6', '10', '14', '3', '7', '11', '15', '4', '8', '12', '16'];

  class Bridge extends Water {
    constructor(data) {
      super(data);
      this._broken = false;
      this._crossed = false;
    }
    isBroken() { return this._broken; }
    canBeCrossed(sprite, d) {
      if (this._broken) return Water.prototype.canBeCrossed.call(this, sprite, d);
      return true;
    }
    crossed(sprite, d) {
      if (this._broken) Water.prototype.crossed.call(this, sprite, d);
      if (sprite.id === Element.HERO) this._crossed = true;
    }
    update(onMove) {
      // Le pont casse quand le héros l'a foulé ET qu'il n'y a plus personne
      // dessus (get(pos) == this : rien au-dessus de lui).
      if (this._crossed && !this._broken && this.board.get(this.pos) === this) {
        this._broken = true;
        this.playground.push(anims.simple({ type: 'bridgeFall', uid: this.uid }));
      }
    }
  }

  // ── Peeble / Rune / OneWay / OneWayStrict ──
  class Peeble extends Sprite {
    constructor(data) { super(data); this.below = true; }
    canBeCrossed(sprite, d) { return sprite.id === Element.GHOST || sprite.id === Element.KOHL; }
  }
  class Rune extends Sprite {
    constructor(data) { super(data); this.below = true; }
    canBeCrossed(sprite, d) { return sprite.id !== Element.GHOST; }
  }
  class OneWay extends Sprite {
    constructor(data) { super(data); this.below = true; }
    canBeCrossed(s, d) {
      if (s.id === Element.GHOST) return true;
      return d !== Direction.oposite(this.orientation);
    }
  }
  class OneWayStrict extends Sprite {
    constructor(data) { super(data); this.below = true; }
    canBeCrossed(s, d) {
      if (s.id === Element.GHOST) return true;
      return d === this.orientation;
    }
    canLeave(s, d) {
      if (s.id === Element.GHOST) return true;
      return d === this.orientation;
    }
  }

  // ── Bomb ──
  class Bomb extends Sprite {
    constructor(data) {
      super(data);
      this._touched = false;
      if (this.param === -1) this.param = this.defaultParameter();
      this._countDown = this.param;
      this.isBadGuy = true;
      this._progressing = false;
      this._cursors = null;
      this._chainedBombs = null;
    }
    requiresParameter() { return true; }
    defaultParameter() { return 5; }
    setParameter(p) {
      if (p > 9 || !(p > 0)) p = 1;
      this.param = p;
      this._countDown = p;
      return this._countDown;
    }
    update(onmove) {
      if (onmove && this._touched) {
        this._countDown -= 1;
        if (this._countDown <= 0) this.explode();
        else this.playground.emet({ type: 'compteBombe', uid: this.uid, valeur: this._countDown });
      }
    }
    touchByDeflagration() {
      this.alive = false;
      this.initDeflagration();
    }
    canMove(d) {
      const n = this.pos.next(d);
      if (!this.board.isValid(n)) return false;
      return this.board.get(n).canBeCrossed(this, d);
    }
    canBePushed(s) { return s.id === Element.HERO || s.id === Element.WINKLE; }
    move(d) {
      if (!this._touched) this._touch();
      this.playground.move(this.pos, d, null);
    }
    burn() { return null; }
    endBurn() { this.destroy(); }
    _touch() {
      this._touched = true;
      this._countDown = this.param;
      if (this._countDown <= 0) this._countDown = 2;       // coquille d'origine
      this.playground.emet({ type: 'bombeAllumee', uid: this.uid, valeur: this._countDown });
    }
    initDeflagration() {
      this.alive = false;
      this._chainedBombs = [];
      this._cursors = [];
      for (let d = Direction.NORTH; d <= Direction.WEST; d++) this._cursors.push(this.pos.clone());
      this._progressing = true;
    }
    nextDeflagrationStep(lot, delay) {
      if (!this._progressing) return false;
      this._progressing = false;
      const nouvelles = [];
      if (this._cursors != null) {
        for (let d = Direction.NORTH; d <= Direction.WEST; d++) {
          if (this._cursors[d] == null) continue;
          let c = this._cursors[d].next(d);
          const cle = c.y * 100 + c.x;
          if (Bomb._FLAMES[cle] === 1) { this._cursors[d] = null; continue; }
          if (!(c != null && this.board.isValid(c))) continue;
          const s = this.board.get(c);
          if (s.id === Element.NONE || s.id === Element.PEEBLE || s.id === Element.RUNE
            || (s.id === Element.WATER && s.isFilledWithBox())) {
            this._progressing = true;
            lot.push(this._createFlames(c, delay));
          } else if (s.id === Element.GHOST) {
            this._progressing = true;
            lot.push(this._createFlames(c, delay));
            Bomb._FLAMES[cle] = 1;
          } else if (s.id === Element.BOMB) {
            if (s.alive) {
              s.alive = false;
              s.touchByDeflagration();
              nouvelles.push(s);
              lot.push(this._createFlames(c, delay));
              lot.push(this._burnSprite(s, delay));
              s._burnBrigeBelow(lot, delay);
              Bomb._FLAMES[cle] = 1;
            }
            c = null;
          } else if (s.id === Element.BRIDGE) {
            if (!s.isBroken()) {
              // Les flammes brûlent le pont ET CONTINUENT au-delà — le
              // curseur n'est pas éteint, c'est le fichier qui le veut.
              this._progressing = true;
              lot.push(this._createFlames(c, delay));
              lot.push(anims.simple({ type: 'bridgeFall', uid: s.uid, delai: delay + 1 }));
              s._broken = true;
              Bomb._FLAMES[cle] = 1;
            } else {
              c = null;
            }
          } else if (typeof s.burn === 'function') {
            this._progressing = true;
            if (s.alive) {
              s.alive = false;
              lot.push(this._createFlames(c, delay));
              lot.push(this._burnSprite(s, delay));
            }
            c = null;
          } else {
            c = null;
          }
          this._cursors[d] = c;
        }
      }
      if (!this._progressing) this._cursors = null;
      for (const b of this._chainedBombs) {
        this._progressing = b.nextDeflagrationStep(lot, delay) || this._progressing;
      }
      for (const b of nouvelles) {
        b.initDeflagration();
        this._chainedBombs.push(b);
        this._progressing = true;
      }
      return this._progressing;
    }
    explode() {
      Bomb._FLAMES = [];
      this.initDeflagration();
      this._burnBomb();
      let delay = 3;
      const lot = [];
      this._progressing = true;
      while (this._progressing) {
        this.nextDeflagrationStep(lot, delay);
        delay += 3;
      }
      // Toute la déflagration part comme UN effet parallèle, puis le
      // rafraîchissement des autotiles.
      const pg = this.playground;
      this.playground.pushEffect(anims.simple(
        { type: 'deflagration', anims: lot.map((a) => a.desc) },
        () => { for (const a of lot) if (a.surDebut) a.surDebut(); },
        () => { for (const a of lot) if (a.surFin) a.surFin(); }));
      this.playground.pushEffect(anims.simple({ type: 'refresh' }, null,
        () => { pg.emet({ type: 'refresh' }); }));
    }
    _createFlames(c, delay) {
      return anims.simple({ type: 'flammes', x: c.x, y: c.y, delai: delay });
    }
    _burnSprite(s, delay) {
      this.board.erase(s);
      const moi = this;
      return anims.simple({ type: 'burn', uid: s.uid, delai: delay },
        null, () => {
          // BurnSprite : burn() au début, endBurn() à la fin. Les deux
          // crochets se règlent ici, dans l'ordre du lecteur.
          const a = s.burn();
          if (a && a.surDebut) a.surDebut();
          if (a && a.surFin) a.surFin();
          s.endBurn();
        });
    }
    _burnBomb() {
      const lot = [];
      lot.push(anims.simple({ type: 'flammes', x: this.pos.x, y: this.pos.y, delai: 0 }));
      lot.push(this._burnSprite(this, 0));
      // L'original ajoute le pont APRÈS avoir poussé l'effet — le tableau
      // était partagé. Ici l'effet photographie ses descripteurs au moment
      // du push : on ajoute le pont d'abord, l'état est le même.
      this._burnBrigeBelow(lot, 1);
      this.playground.pushEffect(anims.simple(
        { type: 'deflagration', anims: lot.map((a) => a.desc) },
        () => { for (const a of lot) if (a.surDebut) a.surDebut(); },
        () => { for (const a of lot) if (a.surFin) a.surFin(); }));
    }
    _burnBrigeBelow(lot, delay) {
      const dessous = this.board.getBelow(this.pos);
      if (dessous.id === Element.BRIDGE) {
        dessous._broken = true;
        lot.push(anims.simple({ type: 'bridgeFall', uid: dessous.uid, delai: delay }));
      }
    }
  }
  Bomb._FLAMES = [];

  // ── Archer ──
  class Archer extends Sprite {
    constructor(data) { super(data); this.isBadGuy = true; }
    setOrientation(d) { this.orientation = d; }
    update(onmove) {
      // Un seul tir par passe : la chaîne de || s'arrête au premier vrai.
      const r = this._updateDirection(Direction.NORTH) || this._updateDirection(Direction.EAST)
        || this._updateDirection(Direction.SOUTH) || this._updateDirection(Direction.WEST);
      return r;
    }
    burn() {
      // L'archer cligne mais ne meurt pas.
      return anims.simple({ type: 'archerBurn', uid: this.uid });
    }
    endBurn() {
      this.alive = true;
      this.board.set(this.pos, this);
    }
    _updateDirection(d) {
      let c = this.pos.next(d);
      while (this.board.isValid(c)) {
        const s = this.board.get(c);
        if (s.id === Element.HERO || s.id === Element.LOUKI || s.id === Element.KOHL) {
          this._shot(s);
          return true;
        }
        if (s.id === Element.WINKLE && s.isInWater()) {
          // le winkle qui nage est transparent à l'arc
        } else if (s.below === false) {
          return false;
        }
        c = c.next(d);
      }
      return false;
    }
    _shot(a) {
      if (!a.alive) return;
      a.alive = false;                                     // BurnSprite pose alive=false à la création
      const moi = this;
      this.playground.pushEffect(anims.simple(
        { type: 'archerShot', uid: this.uid, cible: a.uid, x: a.pos.x, y: a.pos.y },
        null, () => {
          const an = a.burn();
          if (an && an.surDebut) an.surDebut();
          if (an && an.surFin) an.surFin();
          a.endBurn();
        }));
    }
  }

  // ── Spider ──
  class Spider extends Sprite {
    constructor(data) {
      super(data);
      this.isBadGuy = true;
      this._inCocoon = true;
    }
    isInCocoon() { return this._inCocoon; }
    canBePushed(s) { return s.id === Element.HERO && this._inCocoon === true; }
    canMove(d) {
      const n = this.pos.next(d);
      return this.board.isValid(n) && this.board.get(n).canBeCrossed(this, d);
    }
    move(d) {
      const n = this.pos.next(d);
      this.board.get(n).crossed(this, d);
      this.playground.move(this.pos, d, null);
    }
    update(onmove) {
      if (this._inCocoon) {
        if (this.playground.isExitOpen()) this._leaveCocoon();
        else return;
      }
      // Coquille d'origine : la boucle s'arrête à SOUTH — jamais de morsure
      // sur une cible adjacente à l'OUEST.
      for (let d = Direction.NORTH; d <= Direction.SOUTH; d++) {
        const s = this.board.get(this.pos.next(d));
        if (s.alive && this._canKill(s)) {
          this._kill(s);
          return;
        }
      }
      const r = this._updateWithTarget(this.playground.getHero())
        || this._updateWithTarget(this.playground.getCurrentAvatar());
      return r;
    }
    _canKill(t) {
      return t.id === Element.HERO || t.id === Element.LOUKI || t.id === Element.KOHL;
    }
    _updateWithTarget(t) {
      if ((t.pos.x === this.pos.x || t.pos.y === this.pos.y) && this._canKill(t)) {
        this._tryToKill(t);
        return true;
      }
      return false;
    }
    _tryToKill(a) {
      const d = this.pos.directionOf(a.pos);
      this.setOrientation(d);
      this.playground.emet({ type: 'orientation', uid: this.uid, d });
      if (a.attractedByMagnet) return;
      let dest = this.pos.clone();
      let cur = this.pos.clone();
      let dist = 0;
      for (;;) {
        cur = cur.next(d);
        const s = this.board.get(cur);
        if (!this.board.isValid(cur)) return;
        if (this._canKill(s) && s.alive) {
          if (dist > 0) this._createMovement(dest, dist);
          this._kill(s);
          return;
        }
        if (s.canBeCrossed(this, d)) {
          dist += 1;
          dest = dest.next(d);
        } else {
          if (dist > 0) this._createMovement(dest, dist);
          return;
        }
      }
    }
    _kill(a) {
      this.playground.pushEffect(anims.simple({ type: 'flash' }));
      a.die();
    }
    _createMovement(dest, dist) {
      this.board.set(dest, this);
      this.playground.pushEffect(anims.simple(
        { type: 'spiderMove', uid: this.uid, x: dest.x, y: dest.y, pas: 5 * dist }));
    }
    _leaveCocoon() {
      this._inCocoon = false;
      this.playground.pushEffect(anims.simple({ type: 'cocon', uid: this.uid }));
    }
  }

  // ── Lurker ──
  class Lurker extends Sprite {
    constructor(data) {
      super(data);
      this.below = true;
      this.isBadGuy = true;
    }
    canBeCrossed(s, d) { return s.id === Element.BOX || s.id === Element.HERO; }
    update(onmove) {
      if (this.board.getOver(this.pos).id === Element.BOX) return;
      let c = this.pos.clone().next(this.orientation);
      while (this.board.isValid(c)) {
        const s = this.board.get(c);
        if (s.id === Element.HERO || s.id === Element.LOUKI || s.id === Element.KOHL) {
          if (s.alive && !s.attractedByMagnet) {
            this._shot(s);
            s.die();
          }
          return;
        }
        if (this._canBlockShot(s)) return;
        c = c.next(this.orientation);
      }
    }
    _canBlockShot(s) { return !s.below; }
    _shot(s) {
      let c = this.pos.next(this.orientation);
      let dist = 0;
      while (this.board.isValid(c)) {
        dist += 1;
        const r = this.board.get(c);
        if (r === s) break;
        if (this._canBlockShot(r)) break;
        c = c.next(this.orientation);
      }
      c = c.next(Direction.oposite(this.orientation));
      this.playground.pushEffect(anims.simple(
        { type: 'lurkerShot', uid: this.uid, x: c.x, y: c.y, dist }));
    }
  }

  // ── Eye ──
  class Eye extends Sprite {
    constructor(data) {
      super(data);
      this.below = true;
      this.isBadGuy = true;
      this._opened = false;
    }
    isOpened() { return this._opened; }
    canBeCrossed(s, d) { return s.id === Element.BOX || s.id === Element.HERO; }
    canMove(d) {
      const n = this.pos.next(d);
      return this.board.isValid(n) && this.board.get(n).canBeCrossed(this, d);
    }
    move(d) {
      const n = this.pos.next(d);
      this.board.get(n).crossed(this, d);
      this.playground.move(this.pos, d, null);
    }
    update(onMove) {
      if (this.board.getOver(this.pos).id === Element.BOX) return;
      const av = this.playground.getCurrentAvatar();
      if (av.id !== Element.GHOST) {
        if (this._opened) {
          this._opened = false;
          this.playground.emet({ type: 'oeil', uid: this.uid, ouvert: false });
        }
        return;
      }
      if (!this._opened) {
        this._opened = true;
        this.playground.emet({ type: 'oeil', uid: this.uid, ouvert: true });
      }
      if (this._tryToKill(av, this.playground.getHero())) return;
      this._tryToKill(this.playground.getHero(), av);
    }
    _tryToKill(avatar, other) {
      let d = -1;
      if (avatar.pos.x === this.pos.x) d = avatar.pos.y < this.pos.y ? Direction.NORTH : Direction.SOUTH;
      else if (avatar.pos.y === this.pos.y) d = avatar.pos.x < this.pos.x ? Direction.WEST : Direction.EAST;
      else return false;
      let c = this.pos.next(d);
      while (this.board.isValid(c)) {
        const s = this.board.get(c);
        if (s === avatar) {
          this._shot(avatar, other);
          return true;
        }
        if (!s.below) return false;                        // le rayon passe sur le dessous seulement
        c = c.next(d);
      }
      return false;
    }
    _shot(a, b) {
      if (!a.alive) return;
      a.alive = false;
      b.alive = false;
      const jouer = (s) => {
        const an = s.burn();
        if (an && an.surDebut) an.surDebut();
        if (an && an.surFin) an.surFin();
        s.endBurn();
      };
      this.playground.pushEffect(anims.simple(
        { type: 'eyeShot', uid: this.uid, cible: a.uid, x: a.pos.x, y: a.pos.y },
        null, () => { jouer(a); jouer(b); }));
    }
  }

  // ── Jade — isMagnet, donc dans le PREMIER groupe de réaction ──
  class Jade extends Sprite {
    constructor(data) { super(data); this.isMagnet = true; }
    setOrientation(d) {}
    canBePushed(s) { return s.id === Element.HERO; }
    canMove(d) {
      const n = this.pos.next(d);
      if (!this.board.isValid(n)) return false;
      return this.board.get(n).canBeCrossed(this, d);
    }
    move(d) {
      const n = this.pos.next(d);
      this.board.get(n).crossed(this, d);
      this.playground.move(this.pos, d, null);
    }
    burn() { return null; }
    endBurn() { this.destroy(); }
    update(onmove) {
      const aTuer = [];
      for (const d of [Direction.NE, Direction.NW, Direction.SE, Direction.SW]) {
        const c = this.pos.next(d);
        if (!this.board.isValid(c)) continue;
        const s = this.board.get(c);
        if ((s.id === Element.HERO || s.id === Element.KOHL || s.id === Element.LOUKI) && s.alive) {
          aTuer.push(s);
        }
      }
      if (!aTuer.length) return;
      for (const s of aTuer) s.alive = false;              // BurnSprite à la création
      const moi = this;
      this.playground.pushEffect(anims.simple(
        { type: 'jadeGaz', uid: this.uid, cibles: aTuer.map((s) => s.uid) },
        null, () => {
          for (const s of aTuer) {
            const an = s.burn();
            if (an && an.surDebut) an.surDebut();
            if (an && an.surFin) an.surFin();
            s.endBurn();
          }
        }));
    }
  }

  // ── Magnet / GoldMagnet ──
  class Magnet extends Sprite {
    constructor(data) { super(data); this.isMagnet = true; }
    update(onmove) {
      const vers = Direction.oposite(this.orientation);
      let c = this.pos.clone().next(this.orientation);
      let libre = null;
      while (this.board.isValid(c)) {
        const s = this.board.get(c);
        const dessous = this.board.getBelow(c);
        let franchissable = true;
        if (dessous.id === Element.ONE_WAY_STRICT && dessous.orientation !== vers) franchissable = false;
        if (this._canAttractOn(s)) {
          if (libre == null) libre = c.clone();
        } else if (libre != null && this._canAttract(s) && franchissable) {
          this._attractTo2(s, vers);
          return;
        } else if (this._canAttractOver(s)) {
          libre = null;
        } else {
          return;
        }
        c = c.next(this.orientation);
      }
    }
    _canAttractOver(s) {
      return s.id === Element.WATER || s.id === Element.ONE_WAY || s.id === Element.PEEBLE
        || s.id === Element.RUNE || s.id === Element.BRIDGE || s.id === Element.ONE_WAY_STRICT
        || s.id === Element.EXIT;
    }
    _canAttractOn(s) {
      return s.id === Element.NONE
        || (s.id === Element.EXIT && s.isClosed())
        || (s.id === Element.ONE_WAY && s.orientation !== this.orientation)
        || (s.id === Element.ONE_WAY_STRICT && s.orientation === Direction.oposite(this.orientation))
        || (s.id === Element.WATER && s.isFilledWithBox())
        || (s.id === Element.BRIDGE && !s.isBroken())
        || s.id === Element.EYE || s.id === Element.LURKER || s.id === Element.RUNE;
    }
    _canAttract(s) {
      if (!s.alive) return false;
      return (s.id === Element.BOX && !s.isInWater()) || s.id === Element.BOMB
        || s.id === Element.FRUIT || s.id === Element.HERO || s.id === Element.LOUKI
        || s.id === Element.KOHL || (s.id === Element.WINKLE && !s.isInWater())
        || s.id === Element.JADE || (s.id === Element.SPIDER && s.isInCocoon());
    }
    _attractTo2(s, d) {
      if (s.attractedByMagnet === true) return;
      if (s.isMoving === true) return;
      s.attractedByMagnet = true;
      s.move(d);
    }
  }

  class GoldMagnet extends Magnet {
    update(onmove) {
      const vers = Direction.oposite(this.orientation);
      let c = this.pos.clone().next(this.orientation);
      let libre = null;
      let precedent = null;
      while (this.board.isValid(c)) {
        let s = this.board.get(c);
        const dessous = this.board.getBelow(c);
        let franchissable = true;
        if (dessous.id === Element.ONE_WAY_STRICT && dessous.orientation !== vers) franchissable = false;
        if (this._canAttractOn(s)) {
          if (libre == null) libre = c.clone();
        } else if (libre != null && this._canAttract(s) && precedent != null
          && precedent.canBeCrossed(s, vers) && franchissable) {
          this._attractTo2(s, Direction.oposite(this.orientation));
          s = this.board.getBelow(c);
        } else if (this._canAttractOver(s)) {
          libre = null;
        } else {
          // L'or ne s'arrête sur RIEN : mur ou pas, la case d'arrivée est
          // simplement remise à zéro et le balayage continue jusqu'au bord.
          libre = null;
        }
        precedent = s;
        c = c.next(this.orientation);
      }
    }
    _canAttract(s) {
      return Magnet.prototype._canAttract.call(this, s)
        || s.id === Element.GMAGNET || s.id === Element.MAGNET
        || (s.id === Element.SPIDER && s.isInCocoon());
    }
  }

  // ── Louki ──
  class Louki extends Avatar {
    constructor(data) {
      super(data);
      this._loaded = false;
      this._active = false;
      this._load = null;
    }
    isLoaded() { return this._loaded; }
    isActive() { return this._active; }
    wakeUp() {
      this._active = true;
      Avatar.prototype.wakeUp.call(this);
    }
    release() {
      if (this._loaded) {
        const moi = this;
        this.playground.pushEffect(anims.simple({ type: 'loukiPuke', uid: this.uid },
          () => { moi.unload(); }));
      } else {
        this._active = false;
        this.playground.pushEffect(anims.simple({ type: 'sommeil', uid: this.uid }));
        this.board.set(this.pos, this);
      }
    }
    unload() {
      // Recracher, c'est REDEVENIR ce qu'on a mangé : le louki disparaît et
      // sa charge reprend la case.
      this.destroy();
      this.board.set(this.pos, this._load);
      this.playground.emet({ type: 'refreshPositions' });
    }
    canEat(s) {
      if (this._loaded) return false;
      return s.id === Element.WALL || s.id === Element.BOX || s.id === Element.LOUKI;
    }
    canMove(d) {
      return Avatar.prototype.canMove.call(this, d)
        || this.canEat(this.board.get(this.pos.next(d)));
    }
    move(d) {
      const n = this.pos.next(d);
      if (n == null) return;
      const s = this.board.get(n);
      if (this.canEat(s)) {
        this._eat(s, d);
        return;
      }
      this.setOrientation(d);
      if (s.canBeCrossed(this, d)) {
        s.crossed(this, d);
        if (!this.attractedByMagnet) {
          this.playground.move(this.pos, d,
            anims.simple({ type: 'moveAnime', uid: this.uid, x: n.x, y: n.y },
              null, null));
        } else {
          this.playground.move(this.pos, d, null);
        }
      }
    }
    _eat(s, d) {
      this._loaded = true;
      this._load = s;
      this.playground.push(anims.simple({ type: 'loukiEat', uid: this.uid, cible: s.uid, d }));
      this.board.erase(s);
      this.playground.emet({ type: 'refresh' });
    }
    burn() { return anims.simple({ type: 'burn', uid: this.uid }); }
    endBurn() { this.destroy(); }
    die() {
      this.alive = false;
      const moi = this;
      this.playground.pushEffect(anims.simple({ type: 'burn', uid: this.uid },
        null, () => {
          const an = moi.burn();
          if (an && an.surFin) an.surFin();
          moi.endBurn();
        }));
    }
  }

  // ── Kohl ──
  class Kohl extends Avatar {
    release() {
      // L'échange : le kohl et le héros troquent leurs cases, et les tuiles
      // du dessous sont « traversées » (un pont s'en souvient).
      const autre = this.playground.getCurrentAvatar();
      const posAutre = autre.pos.clone();
      this.board.getBelow(this.pos).crossed(autre, -1);
      this.board.getBelow(posAutre).crossed(this, -1);
      this.board.erase(this);
      this.board.erase(autre);
      this.board.set(this.pos, autre);
      this.board.set(posAutre, this);
      this.playground.emet({ type: 'refreshPositions' });
      this._sleep();
    }
    _sleep() { this.playground.pushEffect(anims.simple({ type: 'sommeil', uid: this.uid })); }
    burn() { return anims.simple({ type: 'burn', uid: this.uid }); }
    endBurn() { this.destroy(); }
    die() {
      this.alive = false;
      const moi = this;
      this.playground.pushEffect(anims.simple({ type: 'burn', uid: this.uid },
        null, () => {
          const an = moi.burn();
          if (an && an.surFin) an.surFin();
          moi.endBurn();
        }));
    }
  }

  // ── Winkle ──
  class Winkle extends Avatar {
    constructor(data) {
      super(data);
      this._inWater = false;
      this._asleep = false;                                // vrai = éveillé, nom d'origine
    }
    isInWater() { return this._inWater; }
    wakeUp() {
      this._asleep = true;
      if (this._inWater) {
        // Réveiller un winkle qui nage COÛTE le fantôme.
        const pg = this.playground;
        this.playground.pushEffect(anims.simple({ type: 'callback' }, null,
          () => { pg.getGhost().destroy(); }));
      } else {
        Avatar.prototype.wakeUp.call(this);
      }
    }
    release() {
      if (!this._inWater) {
        this.playground.pushEffect(anims.simple({ type: 'sommeil', uid: this.uid }));
      }
    }
    canMove(d) {
      const n = this.pos.next(d);
      const s = this.board.get(n);
      if (s.id === Element.WATER && s.canBeCrossed(this, d)) return true;
      return Avatar.prototype.canMove.call(this, d);
    }
    move(d) {
      const n = this.pos.next(d);
      if (!this.board.isValid(n)) return;
      const s = this.board.get(n);
      const versEau = (s.id === Element.WATER && s.canBeCrossed(this, d))
        || (s.id === Element.BRIDGE && s.isBroken() && s.canBeCrossed(this, d));
      if (versEau && !s.isFilledWithBox()) {
        if (this._inWater) {
          this.playground.emet({ type: 'nage', uid: this.uid });
        } else {
          this._inWater = true;
          this.setOrientation(d);
          this.playground.pushEffect(anims.simple({ type: 'entreEau', uid: this.uid }));
        }
        this.playground.move(this.pos, d, null);
        return;
      }
      this._inWater = false;
      Avatar.prototype.move.call(this, d);
    }
    burn() { return anims.simple({ type: 'burn', uid: this.uid }); }
    endBurn() { this.destroy(); }
  }

  // ── La fabrique des sprites ──
  function creerSprite(data) {
    switch (data.id) {
      case Element.HERO: return new Hero(data);
      case Element.BOX: return new Box(data);
      case Element.ARCHER: return new Archer(data);
      case Element.BOMB: return new Bomb(data);
      case Element.FRUIT: return new Fruit(data);
      case Element.LURKER: return new Lurker(data);
      case Element.MAGNET: return new Magnet(data);
      case Element.GMAGNET: return new GoldMagnet(data);
      case Element.PEEBLE: return new Peeble(data);
      case Element.RUNE: return new Rune(data);
      case Element.SPIDER: return new Spider(data);
      case Element.WALL: return new Wall(data);
      case Element.WATER: return new Water(data);
      case Element.WINKLE: return new Winkle(data);
      case Element.KOHL: return new Kohl(data);
      case Element.LOUKI: return new Louki(data);
      case Element.EXIT: return new Exit(data);
      case Element.GHOST: return new Ghost(data);
      case Element.ONE_WAY: return new OneWay(data);
      case Element.JADE: return new Jade(data);
      case Element.ONE_WAY_STRICT: return new OneWayStrict(data);
      case Element.EYE: return new Eye(data);
      case Element.BRIDGE: return new Bridge(data);
      default: return null;                                // le PIN, notamment
    }
  }

  // ── Le plateau de jeu : GamePlayground + GameManager, sans le temps ──
  const MAGNETS = 0, BADS = 1, MISC = 2;

  class Partie {
    constructor(niveau) {
      this._level = niveau;
      this._board = new Board(niveau.size);
      this._sprites = [];
      this._orderedSprites = [[], [], []];
      this._hero = null;
      this._ghost = null;
      this._avatar = null;
      this._ended = false;
      this._victory = false;
      this._exitOpened = false;

      this._inGhostMode = false;
      this._movements = [];
      this._spiritSpaces = 0;
      this._turnCleared = false;

      // Les lots d'animations : _quick / _effects en attente, _lots joués.
      this._quick = [];
      this._effects = [];
      this._lots = [];
      this._evenements = [];                               // hors lot (immédiats)

      this._drawPlayground();
      // Un niveau dont la case de départ est prise n'a pas de héros — le
      // fichier le tolère en silence ; ici la partie est morte-née, pour que
      // le serveur ne s'étrangle pas sur un niveau forgé.
      if (this._hero == null) {
        this._ended = true;
        this._turnCleared = true;
        return;
      }
      // Le fondu d'ouverture du niveau, comme _beginLevelFade + flush.
      this.pushEffect(anims.simple({ type: 'fadeIn',
        x: niveau.startPos.x, y: niveau.startPos.y }));
      this.flush();
      this._resoudre();
    }

    // — accès —
    getBoard() { return this._board; }
    getLevel() { return this._level; }
    getHero() { return this._hero; }
    getGhost() { return this._ghost; }
    getCurrentAvatar() { return this._avatar; }
    setAvatar(s) { this._avatar = s; }
    isExitOpen() { return this._exitOpened; }
    isEnded() { return this._ended; }
    isVictorious() { return this._victory; }
    countMoves() { return this._movements.length - this._spiritSpaces; }
    spiritSpaces() { return this._spiritSpaces; }
    getMovements() { return this._movements.slice(); }
    sprites() { return this._sprites.slice(); }

    // — collecte des animations —
    push(a) { this._quick.push(a); }
    pushEffect(a) { this._effects.push(a); }
    emet(desc) { this._evenements.push(desc); }
    flush() {
      if (!this._quick.length && !this._effects.length) return;
      this._lots.push({ rapides: this._quick, effets: this._effects });
      this._quick = [];
      this._effects = [];
    }

    // Joue un lot : l'état des crochets s'applique dans l'ordre du lecteur —
    // les rapides (débuts puis fins), puis chaque effet l'un après l'autre.
    _jouerLot(lot) {
      for (const a of lot.rapides) if (a.surDebut) a.surDebut();
      for (const a of lot.rapides) if (a.surFin) a.surFin();
      for (const a of lot.effets) {
        if (a.surDebut) a.surDebut();
        if (a.surFin) a.surFin();
      }
    }

    // La boucle de GameManager.update, sans tmod : tant que le tour n'est pas
    // rendu, on joue les lots en attente puis on repasse les réactions.
    //
    // Le garde-fou ne change rien aux niveaux sains : un niveau qui ne
    // converge pas est un niveau où le Flash animait sans fin — mais le
    // serveur, lui, ne doit pas rester pendu sur un replay forgé.
    _resoudre() {
      let joues = 0;
      let garde = 0;
      for (;;) {
        if (++garde > 5000) { this._ended = true; break; }
        this.flush();
        while (joues < this._lots.length) {
          this._jouerLot(this._lots[joues]);
          joues += 1;
          this.flush();
        }
        if (this._turnCleared || this._ended) break;
        const avant = this._lots.length;
        this.processReaction();
        this.flush();
        if (this._lots.length === avant) {
          this._turnCleared = true;
        }
      }
      // Les lots d'une éventuelle fin de partie (défaite pendant le dernier
      // lot) se jouent aussi.
      this.flush();
      while (joues < this._lots.length) {
        this._jouerLot(this._lots[joues]);
        joues += 1;
        this.flush();
      }
    }

    // — construction —
    _drawPlayground() {
      for (const t of this._level.tiles) {
        const s = this._createSprite(t);
        if (s == null) continue;
      }
      this._createHero();
    }
    _createSprite(data) {
      const s = creerSprite(data);
      if (s == null) return null;
      s.uid = prochainUid++;
      s.setPlayground(this);
      this._board.set(s.pos, s);
      this._sprites.push(s);
      if (s.isMagnet) this._orderedSprites[MAGNETS].push(s);
      else if (s.isBadGuy) this._orderedSprites[BADS].push(s);
      else this._orderedSprites[MISC].push(s);
      return s;
    }
    _createHero() {
      if (this._board.get(this._level.startPos).id !== Element.NONE) return;
      const e = new Element(null);
      e.id = Element.HERO;
      e.pos.x = this._level.startPos.x;
      e.pos.y = this._level.startPos.y;
      this._hero = this._createSprite(e);
      this._avatar = this._hero;
    }

    // — mécanique partagée —
    move(coord, direction, animo) {
      const s = this._board.get(coord);
      const dest = coord.next(direction);
      this._board.set(dest, s);
      if (animo == null) {
        animo = anims.simple({ type: 'move', uid: s.uid, x: dest.x, y: dest.y, pas: 10 });
      }
      // MoveAnim : isMoving se lève à la création, retombe à la fin — et
      // l'attraction magnétique avec lui.
      s.isMoving = true;
      const finAvant = animo.surFin;
      animo.surFin = () => {
        s.isMoving = false;
        s.attractedByMagnet = false;
        if (finAvant) finAvant();
      };
      this.push(animo);
    }
    spriteDestroyed(sprite) {
      let i = this._sprites.indexOf(sprite);
      if (i >= 0) this._sprites.splice(i, 1);
      this._board.erase(sprite);
      const groupe = sprite.isMagnet ? MAGNETS : (sprite.isBadGuy ? BADS : MISC);
      i = this._orderedSprites[groupe].indexOf(sprite);
      if (i >= 0) this._orderedSprites[groupe].splice(i, 1);
      // La créature possédée qui meurt rend son fantôme.
      if (sprite === this._avatar && sprite.id !== Element.HERO && this._hero.alive) {
        const e = new Element(this._avatar);
        e.id = Element.GHOST;
        this._ghost = this._createSprite(e);
        this._avatar = this._ghost;
      }
    }
    processReactionAfterMove() {
      if (this._victory || this._ended) {
        for (const s of this._sprites) if (s.id === Element.BRIDGE) s.update(true);
        return;
      }
      let fruits = 0;
      for (const groupe of this._orderedSprites) {
        for (const s of groupe.slice()) {
          if (this._hero.alive) s.update(true);
          if (s.id === Element.FRUIT && s.alive) fruits += 1;
        }
      }
      if (fruits === 0) this._openExitDoors();
    }
    processReaction() {
      if (this._victory) return;
      if (this._ended) return;
      let fruits = 0;
      for (const groupe of this._orderedSprites) {
        for (const s of groupe.slice()) {
          s.update(false);
          if (s.id === Element.FRUIT && s.alive) fruits += 1;
          // La mort du héros interrompt le GROUPE en cours, pas la passe.
          if (!this._hero.alive) break;
        }
      }
      if (fruits === 0) this._openExitDoors();
    }
    _openExitDoors() {
      for (const s of this._sprites) if (s.id === Element.EXIT) s.open();
      this._exitOpened = true;
    }
    activateGhost() {
      const e = new Element(this._hero);
      e.id = Element.GHOST;
      this._ghost = this._createSprite(e);
      this._avatar = this._ghost;
      this._hero.sleep();
    }
    deactivateGhost() {
      const ancien = this._avatar;
      this._avatar = this._hero;
      if (this._hero.alive) this._hero.wakeUp();
      if (ancien.id === Element.GHOST) ancien.destroy();
      else if (ancien.alive) ancien.release();
    }
    victory(exit) {
      this._ended = true;
      this._victory = true;
      this.pushEffect(anims.simple({ type: 'victoire', uid: exit.uid,
        x: exit.pos.x, y: exit.pos.y }));
    }
    defeat() {
      if (this._ended) return;
      this._ended = true;
      this._victory = false;
      this.pushEffect(anims.simple({ type: 'defaite' }));
      this.flush();
    }

    // — les entrées du joueur (les codes du replay) —
    jouer(code) {
      const debutEv = this._evenements.length;
      const debutLots = this._lots.length;
      if (!this._ended) {
        if (code === Replay.START_GHOST) {
          if (!this._inGhostMode) this._startGhost();
        } else if (code === Replay.STOP_GHOST) {
          if (this._inGhostMode) this._stopGhostMode();
        } else if (code >= 0 && code <= 3) {
          this._moveRequest(code);
        }
        this._resoudre();
      }
      return {
        lots: this._lots.slice(debutLots).map((l) => ({
          rapides: l.rapides.map((a) => a.desc),
          effets: l.effets.map((a) => a.desc),
        })),
        evenements: this._evenements.splice(debutEv),
      };
    }
    _moveRequest(direction) {
      const avatar = this._avatar;
      const n = avatar.pos.next(direction);
      if (!this._board.isValid(n)) return;
      avatar.setOrientation(direction);
      if (avatar.canMove(direction)) {
        avatar.move(direction);
        this.processReactionAfterMove();
        this.flush();
        this._movements.push(direction);
        this._turnCleared = false;
      }
    }
    _startGhost() {
      if (!this._hero.canStartGhost()) return;
      this._spiritSpaces += 1;
      this._turnCleared = false;
      this._inGhostMode = true;
      this.activateGhost();
      this.processReaction();
      this.flush();
      this._movements.push(Replay.START_GHOST);
    }
    _stopGhostMode() {
      this._turnCleared = false;
      this._inGhostMode = false;
      this.deactivateGhost();
      this.processReaction();
      this.flush();
      const dernier = this._movements.pop();
      if (dernier === Replay.START_GHOST) {
        // Aller-retour immédiat : le tour fantôme s'annule tout seul.
        this._spiritSpaces -= 1;
      } else {
        this._spiritSpaces += 1;
        this._movements.push(dernier);
        this._movements.push(Replay.STOP_GHOST);
      }
    }
  }

  /**
   * Rejoue une liste de mouvements (les codes du replay, la chaîne que
   * SaveScore transporte) et rend le verdict — c'est la validation serveur.
   */
  function rejouer(niveau, mouvements) {
    const partie = new Partie(niveau.clone ? niveau.clone() : niveau);
    for (const code of mouvements) {
      if (partie.isEnded()) break;
      partie.jouer(code);
    }
    return {
      victorieux: partie.isVictorious(),
      fini: partie.isEnded(),
      coups: partie.countMoves(),
      passesEsprit: partie.spiritSpaces(),
      mouvements: partie.getMovements(),
    };
  }

  // ── L'autotile, partagé entre le rendu et les tests : quelle image pour
  // un mur ou une eau selon ses voisins (N=1, E=2, S=4, W=8) ──
  function autotile(board, pos, estPareil, frames) {
    let masque = 0;
    if (estPareil(board, pos.next(Direction.NORTH))) masque += 1;
    if (estPareil(board, pos.next(Direction.EAST))) masque += 2;
    if (estPareil(board, pos.next(Direction.SOUTH))) masque += 4;
    if (estPareil(board, pos.next(Direction.WEST))) masque += 8;
    return frames[masque];
  }
  const frameMur = (board, pos) => autotile(board, pos,
    (b, p) => b.get(p).id === Element.WALL && b.get(p).alive, Wall._FRAMES);
  const frameEau = (board, pos) => autotile(board, pos,
    (b, p) => Water.isWaterBased(b.getBelow(p)), Water._FRAMES);

  return {
    Direction, Coord, Dimension, Element, Chunker, Level, Replay, Consts,
    Board, Partie, rejouer, creerSprite, frameMur, frameEau,
    Wall, Water,
  };
});
