/*
 * Swapou 2 — gameplay (traduction de Player.as, IAPlayer.as, Animator.as,
 * AnimatorChallenge.as, Interf*.as, Challenge.as, Classic.as, Duel.as,
 * Pause.as, TItem.as, Client.as).
 *
 * SW est l'espace partagé avec screens.js (Menu/HistoMap/GameOver/Manager).
 */
'use strict';

var SW = {}; // var : attaché au global (accessible aux tests headless via vm)

(function () {
  const E = SwapouEngine;
  const U = SwapouUI;
  const A = SwapouAssets;
  const D = U.D;
  const random = U.random;

  SW.E = E; SW.U = U; SW.A = A; SW.D = D;

  // état d'entrée global (renseigné par index.html)
  SW.mouse = { x: -1000, y: -1000, touching: false };
  // Geste de balayage tactile : (sx,sy) = point d'appui initial, (dx,dy) =
  // direction dominante du glissé (∈ {-1,0,1}). Tant que dx=dy=0 c'est un simple
  // appui (ciblage par quadrant). Renseigné par les handlers tactiles (screens.js).
  SW.swipe = { active: false, sx: 0, sy: 0, dx: 0, dy: 0 };
  SW.tmod = 1;
  SW.deltaT = 1 / 40;

  // Paire visée par l'entrée courante, partagée par tous les modes jouables.
  // Si un balayage a donné une direction, on échange le fruit posé (sx,sy) avec
  // son voisin dans cette direction (fiable au doigt) ; sinon on retombe sur le
  // ciblage par quadrant au point courant (souris, ou simple tap).
  SW.pickPair = function (player) {
    if (SW.swipe.dx || SW.swipe.dy)
      return player.getPairWithDir(SW.swipe.sx, SW.swipe.sy, SW.swipe.dx, SW.swipe.dy);
    return player.getPair(SW.mouse.x, SW.mouse.y);
  };

  // ── Données globales (Data.as globals) ───────────────────────────────────
  SW.Data = {
    CHALLENGE: 0, DUEL: 1, HISTORY: 2, CLASSIC: 3,
    players: [-1, -1],
    difficulty: 0,
    gameMode: 0,
    histoPhase: 0,
    chars: [false],
  };

  // ── Client (pont plateforme HTTP — remplace frusion.gameclient) ─────────
  function Client() {
    this.sid = '';
    this.slots = [undefined, undefined];
    this.nswaps = 0;
    this.standalone = false;
    this.connected = false;
    this.forcePause = false;
  }
  Client.prototype.isWhite = function () { return false; };
  Client.prototype.serviceConnect = function (cb) {
    const me = this;
    function done() {
      // défauts (Client.as:onServiceConnect)
      let k = me.slots[1];
      if (k == null) {
        k = { $sound: true, $music: true, $lod: D.HIGH };
        me.slots[1] = k;
      }
      U.setLod(k.$lod || D.HIGH);
      A.enableSoundMusic(k.$sound !== false, k.$music !== false);
      let s = me.slots[0];
      if (s == null) {
        s = { $chars: [true, true, false, false, false, false, false, false, false], $record: 0, $classic_record: 0, $swap: 0, $items: [], $combos: [] };
        me.slots[0] = s;
      }
      if (!Array.isArray(s.$items)) s.$items = [];
      if (!Array.isArray(s.$combos)) s.$combos = [];
      if (!Array.isArray(s.$chars)) s.$chars = [true, true, false, false, false, false, false, false, false];
      me.nswaps = s.$swap || 0;
      SW.Data.chars = s.$chars;
      me.connected = true;
      cb();
    }
    if (!this.sid) { this.standalone = true; done(); return; }
    fetch('/api/loadFrutiSlots?sid=' + encodeURIComponent(this.sid) + '&game=swapou2', { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        const params = new URLSearchParams(txt);
        if (params.get('ok') === '1') {
          try { if (params.get('slot0')) me.slots[0] = JSON.parse(params.get('slot0')); } catch (e) {}
          try { if (params.get('slot1')) me.slots[1] = JSON.parse(params.get('slot1')); } catch (e) {}
        }
        done();
      })
      .catch(function () { me.standalone = true; done(); });
  };
  Client.prototype.saveSlot = function (i) {
    if (this.standalone || !this.sid) return;
    const body = new URLSearchParams();
    body.set('sid', this.sid);
    body.set('game', 'swapou2');
    body.set('slotId', String(i));
    body.set('data', JSON.stringify(this.slots[i]));
    fetch('/api/saveFrutiSlot', { method: 'POST', body: body }).catch(function () {});
  };
  Client.prototype.savePrefs = function () {
    this.slots[1] = {
      $sound: A.soundEnabled(),
      $music: A.musicEnabled(),
      $lod: U.getLod(),
    };
    this.saveSlot(1);
  };
  Client.prototype.saveClassicScore = function (score) {
    const s = this.slots[0];
    const old = s.$classic_record || 0;
    if (score > old) s.$classic_record = score;
    s.$swap = this.nswaps;
    this.saveSlot(0);
    return old;
  };
  Client.prototype.unlockCharacter = function (ch) {
    const s = this.slots[0];
    if (!s.$chars[ch]) {
      s.$chars[ch] = true;
      this.saveSlot(0);
    }
  };
  Client.prototype.giveItem = function () { /* le serveur extrait les titems du slot 0 */ };
  // envoi d'un score au classement (m=1 challenge, m=0 classique).
  // data = perso au format sérialisé Motion-Twin « S<charId>: » (colonne
  // « Perso » du tableau, identique à ce que le serveur normalise) → lignes
  // desktop (SWF) et mobile strictement interchangeables.
  Client.prototype.saveScore = function (score, mode, cb) {
    if (this.standalone || !this.sid) { cb(null); return; }
    const body = new URLSearchParams();
    body.set('sid', this.sid);
    body.set('game', 'swapou2');
    body.set('m', String(mode));
    body.set('score', String(score));
    body.set('data', 'S' + SW.Data.players[0] + ':');
    fetch('/api/saveScore', { method: 'POST', body: body })
      .then(function (r) { return r.json(); })
      .then(function (j) { cb(j); })
      .catch(function () { cb(null); });
  };
  // fin de partie challenge (Client.as:doEndGame).
  // IMPORTANT : le mode « Challenge » du jeu se classe dans le ranking
  // `swapou2_classic` (mode 0) — c'est le bucket que l'onglet « Challenge »
  // du front-end affiche (LEGACY_RANKINGS rk 3) et celui où le SWF desktop
  // écrit (son saveScore ne transmet pas de `m`, donc mode 0 par défaut).
  // Envoyer m=1 enverrait vers `swapou2_challenge` (section « Championnat »,
  // non surfacée) → scores invisibles. On reste donc en mode 0 pour être
  // strictement interchangeable avec le desktop.
  Client.prototype.doEndGame = function (score) {
    const s = this.slots[0];
    const oldRecord = s.$record || 0;
    if (score > oldRecord) s.$record = score;
    s.$swap = this.nswaps;
    this.saveSlot(0);
    this.saveScore(score, 0, function (j) {
      if (j && j.ok)
        SW.Manager.scoreSaved(score, j.oldScore || 0, j.oldPos || 0, j.newPos || 0);
      else
        SW.Manager.scoreSaved(score, oldRecord, 0, 0);
    });
  };
  SW.Client = Client;

  // ── TItem (TItem.as) ─────────────────────────────────────────────────────
  const TItem = {
    TITEMS: ['$sel', '', '$poivre', '$epee', '$piment', '$dent', '$sucre',
      '$metal01', '$metal02', '$metal03', '$ice01', '$ice02', '$ice03', '$star01', '$star02', '$star03',
      '$fruit01', '$fruit02', '$fruit03', '$fruit04', '$fruit05', '$fruit06', '$fruit07', '$fruit08', '$fruit09', '$fruit10', '$fruit11',
      '$combo01', '$combo02', '$combo03', '$combo04', '$combo05', '$combo06', '$combo07', '$combo08', '$combo09', '$combo10', '$combo11',
      '$photo01', '$photo02', '$photo03', '$photo04', '$photo05', '$photo06', '$photo07', '$photo08'],
    combo_nitems: 0,
    HISTO_TITEMS: 0,
    HISTO_END_TITEMS: 7,
    FRUIT_TITEMS: 16,
    COMBO_TITEMS: 27,
    PHOTO_TITEMS: 38,
    giveItem: function (i) {
      const fc = SW.Manager.client.slots[0].$items;
      if (fc[i] || TItem.TITEMS[i] === '') return false;
      fc[i] = true;
      SW.Manager.client.giveItem(TItem.TITEMS[i]);
      SW.Manager.client.saveSlot(0);
      return true;
    },
    histoItems: function () {
      let n = 0;
      if (TItem.giveItem(TItem.HISTO_TITEMS + SW.Data.histoPhase)) n++;
      if (SW.Data.histoPhase === 6) {
        let ntrys = 100;
        while (ntrys-- > 0) {
          if (TItem.giveItem(TItem.HISTO_END_TITEMS + random(9))) { n++; break; }
        }
      }
      return n;
    },
    addCombo: function (n) {
      const ac = SW.Manager.client.slots[0].$combos;
      if (ac[n] == null) ac[n] = 0;
      ac[n]++;
      if (ac[n] >= 5 && TItem.giveItem(TItem.COMBO_TITEMS + n)) {
        TItem.combo_nitems++;
        SW.Manager.client.saveSlot(0);
      } else if (ac[n] < 5) {
        SW.Manager.client.saveSlot(0);
      }
    },
    duelItem: function () {
      return TItem.giveItem(TItem.PHOTO_TITEMS + SW.Data.players[1]) ? 1 : 0;
    },
    classicItems: function (level) {
      let n = 0;
      level = Math.min(level, 11);
      while (level >= 0) {
        if (TItem.giveItem(level + TItem.FRUIT_TITEMS)) n++;
        level--;
      }
      return n;
    },
  };
  SW.TItem = TItem;

  // ── Animator (Animator.as) ───────────────────────────────────────────────
  function Animator(player, pos_x, pos_y) {
    this.player = player;
    this.pos_x = pos_x;
    this.pos_y = pos_y;
    this.animPhase = -1;
    this.particules = new U.Particules();
    this.wait = -1;
    this.invisibleList = [];
    this.moveUpList = [];
    this.suddens = [];
    this.skipMoveUp = false;
    this.endExpTimer = 0;
    this.gravityList = [];
    this.explosions = { list: [], armors: [] };
    this.fallList = [];
    this.specialName = null;
    this.specialTimer = 0;
    this.specialCallback = null;
    this.specialData = null;
    this.specialEndTimer = 0;
    this.extraFruits = []; // fruits hors grille à dessiner (rems/mc1/mc2…)
    this.fruitsVisible = true;
    this.lod = U.getLod();
    if (player.isIA()) {
      this.lod = D.LOW;
      this.particules.generate = null;
    }
  }
  SW.Animator = Animator;

  Animator.prototype.attachFruit = function (x, y, color, flags) {
    // hook utilisé par Level.onAttach — crée le sprite
    return null;
  };
  Animator.prototype.initSprite = function (f, x, y) {
    f.spr = {
      x: this.pos_x + D.FRUIT_WIDTH * x,
      y: this.pos_y + D.FRUIT_HEIGHT * y,
      alpha: 100, visible: true, subx: 0, suby: 0,
      overrideImg: null,
    };
  };
  Animator.prototype.getInfos = function () {
    return { px: this.pos_x, py: this.pos_y, sx: D.FRUIT_WIDTH, sy: D.FRUIT_HEIGHT };
  };
  Animator.prototype.hideMC = function (f) {
    f.spr.visible = false;
    this.invisibleList.push(f);
  };
  Animator.prototype.showAll = function () {
    for (let i = 0; i < this.invisibleList.length; i++)
      this.invisibleList[i].spr.visible = true;
    this.invisibleList = [];
  };
  Animator.prototype.setFruitsVisible = function (b) { this.fruitsVisible = b; };
  Animator.prototype.setPhase = function (p) {
    this.animPhase = p;
    for (let i = 0; i < this.moveUpList.length; i++)
      this.moveUpList[i].spr.y -= D.FRUIT_HEIGHT / 2;
    this.moveUpList = [];
  };

  Animator.prototype.swap = function (f1, f2) {
    A.play(A.SWAP);
    this.setPhase(D.A_SWAP);
    this.hideMC(f1);
    this.hideMC(f2);
    this.particules.attachFx('swapAnim', 0, 0, {
      totalFrames: 7,
      img1: A.fruitImage(f1), img2: A.fruitImage(f2),
      x1: f1.spr.x, y1: f1.spr.y, x2: f2.spr.x, y2: f2.spr.y,
    });
    const x = f2.spr.x, y = f2.spr.y;
    f2.spr.x = f1.spr.x; f2.spr.y = f1.spr.y;
    f1.spr.x = x; f1.spr.y = y;
  };

  Animator.prototype.explode = function (mcs, armorMcs, score) {
    this.setPhase(D.A_EXPLODE);
    const armors = [];
    for (let i = 0; i < armorMcs.length; i++) {
      const d = armorMcs[i];
      const ghostImg = A.fruitImage(d); // gelé, avant peteArmure
      d.peteArmure();
      if (this.lod === D.HIGH)
        armors.push({ img: ghostImg, x: d.spr.x, y: d.spr.y, alpha: 100 });
      this.particules.explodeFrozen(d.spr.x, d.spr.y);
    }
    let sumX = 0, sumY = 0;
    for (let i = 0; i < mcs.length; i++) {
      const mc = mcs[i];
      mc.spr.x0 = mc.spr.x;
      mc.spr.y0 = mc.spr.y;
      mc.spr.expTimer = random(Math.round(mcs.length * 2));
      sumX += mc.spr.x;
      sumY += mc.spr.y;
    }
    this.endExpTimer = D.END_EXPLOSION_TIMER;
    this.explosions = {
      list: mcs.slice(), armors: armors,
      x: Math.round(sumX / mcs.length), y: Math.round(sumY / mcs.length),
    };
  };

  Animator.prototype.explodeFruit = function (f) {
    this.particules.explodeFruit(f.spr.x, f.spr.y, U.FRUIT_COLORS[f.save_t] || '#e8542c');
    this.particules.attachFx('explosion',
      Math.round(f.spr.x + D.FRUIT_WIDTH / 2), Math.round(f.spr.y + D.FRUIT_HEIGHT / 2),
      { totalFrames: 6 });
    f.spr.dead = true;
  };

  Animator.prototype.moveUp = function (f) {
    if (this.lod === D.HIGH) {
      this.skipMoveUp = true;
      f.spr.y -= D.FRUIT_HEIGHT / 2;
      this.moveUpList.push(f);
    } else {
      f.spr.y -= D.FRUIT_HEIGHT;
    }
  };

  Animator.prototype.gravity = function (mcList) {
    this.setPhase(D.A_GRAVITY);
    this.gravityList = mcList.slice();
    for (let i = 0; i < this.gravityList.length; i++) {
      const mc = this.gravityList[i];
      mc.ty = mc.f.spr.y + mc.delta * D.FRUIT_HEIGHT;
    }
  };

  Animator.prototype.falling = function (mcList) {
    this.fallList = mcList.slice();
    for (let i = 0; i < this.fallList.length; i++) {
      const f = this.fallList[i];
      f.spr.x0 = f.spr.x;
      f.spr.ty = f.spr.y;
      f.spr.y = -D.DOCHEIGHT + f.spr.y;
      f.spr.cpt = random(300) / 100;
    }
    this.setPhase(D.A_FALL);
  };

  Animator.prototype.main = function (tmod) {
    this.particules.main(tmod);

    for (let i = 0; i < this.suddens.length; i++) {
      const f = this.suddens[i];
      f.spr.subx = random(20) / 10 * (random(2) * 2 - 1);
      f.spr.suby = random(20) / 10 * (random(2) * 2 - 1);
    }

    switch (this.animPhase) {
      case -1:
        break;
      case D.A_SWAP: {
        if (this.particules.fxList.length === 0) {
          if (this.wait <= 0) { this.showAll(); this.wait = 3; }
          this.wait -= tmod;
          if (this.wait <= 0) {
            this.animPhase = -1;
            this.player.swapDone();
          }
        }
        break;
      }
      case D.A_GRAVITY: {
        if (this.suddens.length > 0) this.clearSuddenFruits();
        for (let i = 0; i < this.gravityList.length; i++) {
          const mc = this.gravityList[i];
          mc.f.spr.y += tmod * D.GRAVITY_DELTA;
          if (mc.f.spr.y >= mc.ty) {
            mc.f.spr.y = mc.ty;
            this.gravityList.splice(i, 1);
            i--;
            if (this.gravityList.length === 0) {
              this.animPhase = -1;
              this.player.gravityDone();
            }
          }
        }
        break;
      }
      case D.A_EXPLODE:
        this.explodeMain(tmod);
        break;
      case D.A_FALL: {
        for (let i = 0; i < this.fallList.length; i++) {
          const f = this.fallList[i];
          if (this.lod === D.HIGH) {
            f.spr.cpt += 0.8 * tmod;
            f.spr.x = f.spr.x0 + Math.sin(f.spr.cpt) * 5;
          }
          f.spr.y += D.PARASITE_SPEED * tmod;
          if (f.spr.y >= f.spr.ty) {
            f.spr.x = f.spr.x0;
            f.spr.y = f.spr.ty;
            this.fallList.splice(i, 1);
            i--;
          }
        }
        if (this.fallList.length === 0) {
          this.animPhase = -1;
          this.player.fallingDone();
        }
        break;
      }
      case D.A_GAMEOVER: {
        for (let i = 0; i < this.explosions.list.length; i++) {
          const mc = this.explosions.list[i];
          mc.spr.timer -= tmod;
          if (mc.spr.timer <= 0) {
            A.play(random(2) === 0 ? A.POP1 : A.POP2);
            this.explodeFruit(mc);
            this.explosions.list.splice(i, 1);
            i--;
          }
        }
        break;
      }
      case D.A_SPECIAL: {
        if (this.specialCallback != null) {
          this.specialTimer -= tmod;
          if (this.specialTimer <= 0)
            this.specialCallback.call(this, this.specialData, tmod);
        }
        if (this.specialEndTimer > 0) {
          this.specialEndTimer -= tmod;
          if (this.specialEndTimer <= 0) {
            this.animPhase = -1;
            this.player.specialDone();
          }
        }
        break;
      }
    }

    if (!this.skipMoveUp && this.moveUpList.length > 0) {
      for (let i = 0; i < this.moveUpList.length; i++)
        this.moveUpList[i].spr.y -= D.FRUIT_HEIGHT / 2;
      this.moveUpList = [];
    }
    this.skipMoveUp = false;
  };

  Animator.prototype.explodeMain = function (data, tmod) {
    if (tmod === undefined) tmod = data; // appelé soit en phase, soit en callback
    for (let i = 0; i < this.explosions.list.length; i++) {
      const mc = this.explosions.list[i];
      if (this.lod >= D.HIGH) {
        mc.spr.x = mc.spr.x0 + random(30) / 10 * (random(2) * 2 - 1);
        mc.spr.y = mc.spr.y0 + random(30) / 10 * (random(2) * 2 - 1);
        mc.spr.alpha = random(30) + 40;
      } else mc.spr.alpha = 65;
      mc.spr.expTimer -= tmod;
      if (mc.spr.expTimer <= 0) {
        A.play(random(2) === 0 ? A.POP1 : A.POP2);
        this.explodeFruit(mc);
        this.explosions.list.splice(i, 1);
        i--;
      }
    }
    for (let i = 0; i < this.explosions.armors.length; i++) {
      const mc = this.explosions.armors[i];
      mc.alpha -= tmod * 5;
      if (mc.alpha <= 10) {
        this.explosions.armors.splice(i, 1);
        i--;
      }
    }
    if (this.explosions.list.length === 0 && this.explosions.armors.length === 0) {
      this.endExpTimer -= tmod;
      if (this.endExpTimer <= 0) {
        this.animPhase = -1;
        this.player.explodeDone();
      }
    }
  };

  Animator.prototype.gameOver = function (wins, fruits) {
    this.clearSuddenFruits();
    if (!wins) {
      this.explosions = { list: [], armors: [], x: 0, y: 0 };
      for (let x = 0; x < fruits.length; x++)
        for (let y = 0; y < fruits[x].length; y++) {
          const f = fruits[x][y];
          if (f != null) {
            f.spr.timer = (D.DOCHEIGHT - f.spr.y) * 0.2;
            const xmin = (f.spr.x - this.pos_x) * 100;
            const xmax = (f.spr.x - this.pos_x) * 200;
            f.spr.timer += (random(Math.max(1, xmax - xmin)) + xmin) / 1000;
            f.spr.timer *= 0.6;
            this.explosions.list.push(f);
          }
        }
    }
    this.setPhase(D.A_GAMEOVER);
  };

  Animator.prototype.comboScore = function () {};
  Animator.prototype.finalComboScore = function () {};

  Animator.prototype.suddenFruits = function (mcs) {
    this.clearSuddenFruits();
    for (let i = 0; i < mcs.length; i++) this.suddens.push(mcs[i]);
  };
  Animator.prototype.clearSuddenFruits = function () {
    for (let i = 0; i < this.suddens.length; i++) {
      this.suddens[i].spr.subx = 0;
      this.suddens[i].spr.suby = 0;
    }
    this.suddens = [];
  };

  Animator.prototype.showBanner = function (txt) {
    const width = this.player.getLevelWidth() * D.FRUIT_WIDTH;
    const mc = this.particules.attachFx('defense', this.pos_x + width / 2, D.SPECIAL_Y, { totalFrames: 8, text: txt + ' !' });
    mc.animMode = D.PINGPONG;
    A.play(A.COMBO);
  };
  Animator.prototype.showAttack = function (name) { this.showBanner(name); };

  Animator.prototype.setCallback = function (c, d) {
    this.setPhase(D.A_SPECIAL);
    this.specialCallback = c;
    this.specialData = d;
  };
  Animator.prototype.specialDoneAnim = function () {
    this.specialCallback = null;
    this.specialEndTimer = 10;
  };

  Animator.prototype.dispatchDefense = function (data, fruits) {
    this.clearSuddenFruits();
    switch (data.id) {
      case 0: this.ecarteur(data.mc1, data.mc2, fruits); break;
      case 1: this.egaliseur(data.rems, data.adds, fruits); break;
      case 2: this.coupeur(data.cuts, fruits); break;
      case 3: this.pete1Ligne(data.cuts, fruits); break;
      case 4: this.convertisseur(data.converts, data.src, data.dst, fruits); break;
      case 5: this.peteArmures(data.mcs, fruits); break;
      case 6: this.combos2(data.mcs, data.arms); break;
    }
    this.showBanner(this.specialName != null ? this.specialName : '');
  };

  // ── défenses : inits ──────────────────────────────────────────────────────
  Animator.prototype.ecarteur = function (mc1, mc2, fruits) {
    const mid = fruits.length / 2;
    const left = [], right = [], expl = [];
    const timer = 10;
    for (let i = 0; i < fruits.length; i++)
      for (let j = 0; j < fruits[i].length; j++) {
        const mc = fruits[i][j];
        if (mc != null) {
          mc.spr.timer = timer + Math.abs(i - mid) * 4;
          mc.spr.cpt = 0;
          mc.spr.oldX = mc.spr.x;
          if (i <= Math.floor(mid)) {
            mc.spr.tx = mc.spr.x - D.FRUIT_WIDTH;
            left.push(mc);
          } else {
            mc.spr.tx = mc.spr.x + D.FRUIT_WIDTH;
            right.push(mc);
          }
        }
      }
    for (let i = 0; i < mc1.length; i++) {
      const mc = mc1[i];
      if (mc != null) {
        mc.spr.timer = mc.spr.y / D.FRUIT_HEIGHT * 2;
        expl.push(mc);
        this.extraFruits.push(mc);
      }
    }
    for (let i = 0; i < mc2.length; i++) {
      const mc = mc2[i];
      if (mc != null) {
        mc.spr.timer = mc.spr.y / D.FRUIT_HEIGHT * 2;
        expl.push(mc);
        this.extraFruits.push(mc);
      }
    }
    this.specialName = E.DEFENSE_NAMES[0];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.ecarteurMain, { timer: timer, left: left, right: right, expl: expl, fruits: fruits });
  };

  Animator.prototype.egaliseur = function (rems, adds, fruits) {
    const falls = [], ups = [];
    for (let i = 0; i < rems.length; i++) {
      const mc = rems[i];
      if (mc != null) {
        mc.spr.timer = 4 * i;
        this.extraFruits.push(mc);
        for (let j = 0; j < fruits[i].length; j++)
          if (fruits[i][j] != null) {
            fruits[i][j].spr.ty = fruits[i][j].spr.y + D.FRUIT_HEIGHT;
            falls.push(fruits[i][j]);
          }
      }
    }
    for (let i = 0; i < adds.length; i++) {
      const mc = adds[i];
      if (mc != null) {
        mc.spr.alpha = 0;
        mc.spr.timer = 4 * i + 2;
        for (let j = 0; j < fruits[i].length - 1; j++)
          if (fruits[i][j] != null) {
            fruits[i][j].spr.ty = fruits[i][j].spr.y - D.FRUIT_HEIGHT;
            ups.push(fruits[i][j]);
          }
      }
    }
    this.specialName = E.DEFENSE_NAMES[1];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.egaliseurMain, { rems: rems, adds: adds, fruits: fruits, falls: falls, ups: ups });
  };

  Animator.prototype.coupeur = function (cuts, fruits) {
    for (let i = 0; i < cuts.length; i++) {
      cuts[i].spr.timer = 2 * i;
      this.extraFruits.push(cuts[i]);
    }
    this.specialName = E.DEFENSE_NAMES[2];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.coupeurMain, { cuts: cuts, fruits: fruits });
  };

  Animator.prototype.pete1Ligne = function (cuts, fruits) {
    for (let i = 0; i < cuts.length; i++) {
      cuts[i].spr.timer = 3 * Math.abs(cuts.length / 2 - i);
      this.extraFruits.push(cuts[i]);
    }
    this.specialName = E.DEFENSE_NAMES[3];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.pete1LigneMain, { cuts: cuts, fruits: fruits });
  };

  Animator.prototype.convertisseur = function (converts, src, dst, fruits) {
    for (let i = 0; i < converts.length; i++) {
      converts[i].spr.timer = 3 * (D.DOCHEIGHT - converts[i].spr.y) / D.FRUIT_HEIGHT;
      // skin figé jusqu'au flash de conversion
      converts[i].spr.overrideImg = converts[i].spr.preImg || null;
    }
    this.specialName = E.DEFENSE_NAMES[4] + String(dst);
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.convertisseurMain, { converts: converts, src: src, dst: dst, fruits: fruits });
  };

  Animator.prototype.peteArmures = function (mcs, fruits) {
    for (let i = 0; i < mcs.length; i++) {
      const mc = mcs[i];
      mc.spr.timer = (D.DOCHEIGHT - mc.spr.y) / D.FRUIT_HEIGHT;
      mc.spr.timer += (D.DOCWIDTH - mc.spr.x) / D.FRUIT_WIDTH;
      mc.spr.overrideImg = mc.spr.preImg || null;
    }
    this.specialName = E.DEFENSE_NAMES[5];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.peteArmuresMain, { mcs: mcs, fruits: fruits });
  };

  Animator.prototype.combos2 = function (mcs, arms) {
    this.explode(mcs, arms, 0);
    this.specialName = E.DEFENSE_NAMES[6];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.explodeMain, undefined);
  };

  // ── attaques : inits ─────────────────────────────────────────────────────
  Animator.prototype.tremblementDeTerre = function (rems, adds, fruits) {
    const falls = [], ups = [];
    for (let i = 0; i < rems.length; i++) {
      const mc = rems[i];
      if (mc != null) {
        mc.spr.timer = 4 * i;
        this.extraFruits.push(mc);
        for (let j = 0; j < fruits[i].length; j++)
          if (fruits[i][j] != null) {
            fruits[i][j].spr.ty = this.pos_y + D.FRUIT_HEIGHT * j;
            falls.push(fruits[i][j]);
          }
      }
    }
    for (let i = 0; i < adds.length; i++) {
      const mc = adds[i];
      if (mc != null) {
        mc.spr.alpha = 0;
        mc.spr.timer = 4 * i + 2;
        for (let j = 0; j < fruits[i].length - 1; j++)
          if (fruits[i][j] != null) {
            fruits[i][j].spr.ty = this.pos_y + D.FRUIT_HEIGHT * j;
            ups.push(fruits[i][j]);
          }
      }
    }
    this.specialTimer = D.SPECIAL_ATTACK_TIMER;
    this.setCallback(this.tremblementDeTerreMain, { rems: rems, adds: adds, fruits: fruits, falls: falls, ups: ups });
  };

  Animator.prototype.couleeMetal = function (mcs, fruits) {
    this.specialTimer = D.SPECIAL_ATTACK_TIMER;
    this.setCallback(this.couleeMetalMain, { mcs: mcs, fruits: fruits });
  };

  // ── défenses/attaques : boucles ──────────────────────────────────────────
  Animator.prototype.egaliseurMain = function (data, tmod) {
    for (let i = 0; i < data.falls.length; i++) {
      const mc = data.falls[i];
      mc.spr.timer -= tmod;
      mc.spr.y += (random(4) + 2) * tmod;
      if (mc.spr.y >= mc.spr.ty) {
        mc.spr.y = mc.spr.ty;
        data.falls.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.ups.length; i++) {
      const mc = data.ups[i];
      mc.spr.timer -= tmod;
      mc.spr.y -= (random(4) + 2) * tmod;
      if (mc.spr.y <= mc.spr.ty) {
        mc.spr.y = mc.spr.ty;
        data.ups.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.rems.length; i++) {
      const mc = data.rems[i];
      if (mc == null) { continue; }
      mc.spr.alpha -= tmod * 4;
      if (mc.spr.alpha <= 0) {
        this.removeExtra(mc);
        data.rems.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.adds.length; i++) {
      const mc = data.adds[i];
      if (mc == null) { continue; }
      mc.spr.alpha += tmod * 4;
      if (mc.spr.alpha >= 100) {
        mc.spr.alpha = 100;
        data.adds.splice(i, 1); i--;
      }
    }
    if (data.rems.filter(Boolean).length === 0 && data.adds.filter(Boolean).length === 0 &&
      data.falls.length === 0 && data.ups.length === 0)
      this.specialDoneAnim();
  };

  Animator.prototype.tremblementDeTerreMain = function (data, tmod) {
    for (let i = 0; i < data.falls.length; i++) {
      const mc = data.falls[i];
      mc.spr.timer -= tmod;
      mc.spr.y += Math.abs(random(5) - 2) * tmod;
      if (mc.spr.y >= mc.spr.ty) {
        mc.spr.y = mc.spr.ty;
        data.falls.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.ups.length; i++) {
      const mc = data.ups[i];
      mc.spr.timer -= tmod;
      mc.spr.y -= Math.abs(random(5) - 2) * tmod;
      if (mc.spr.y <= mc.spr.ty) {
        mc.spr.y = mc.spr.ty;
        data.ups.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.rems.length; i++) {
      const mc = data.rems[i];
      if (mc == null) continue;
      mc.spr.alpha -= tmod * 4;
      if (mc.spr.alpha <= 0) {
        this.removeExtra(mc);
        data.rems.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.adds.length; i++) {
      const mc = data.adds[i];
      if (mc == null) continue;
      mc.spr.alpha += tmod * 4;
      if (mc.spr.alpha >= 100) {
        mc.spr.alpha = 100;
        data.adds.splice(i, 1); i--;
      }
    }
    if (data.rems.filter(Boolean).length === 0 && data.adds.filter(Boolean).length === 0 &&
      data.falls.length === 0 && data.ups.length === 0)
      this.specialDoneAnim();
  };

  Animator.prototype.coupeurMain = function (data, tmod) {
    for (let i = 0; i < data.cuts.length; i++) {
      const mc = data.cuts[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        this.explodeFruit(mc);
        this.removeExtra(mc);
        data.cuts.splice(i, 1); i--;
      }
    }
    if (data.cuts.length === 0) this.specialDoneAnim();
  };

  Animator.prototype.pete1LigneMain = function (data, tmod) {
    for (let i = 0; i < data.cuts.length; i++) {
      const mc = data.cuts[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        this.explodeFruit(mc);
        this.removeExtra(mc);
        data.cuts.splice(i, 1); i--;
      }
    }
    if (data.cuts.length === 0) {
      this.specialCallback = null;
      this.animPhase = -1;
      this.player.specialDoneGravity();
    }
  };

  Animator.prototype.convertisseurMain = function (data, tmod) {
    for (let i = 0; i < data.converts.length; i++) {
      const mc = data.converts[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        this.particules.attachFx('explosion',
          Math.round(mc.spr.x + D.FRUIT_WIDTH / 2), Math.round(mc.spr.y + D.FRUIT_HEIGHT / 2),
          { totalFrames: 6 });
        mc.spr.overrideImg = null; // updateSkin
        data.converts.splice(i, 1); i--;
      }
    }
    if (data.converts.length === 0) this.specialDoneAnim();
  };

  Animator.prototype.peteArmuresMain = function (data, tmod) {
    for (let i = 0; i < data.mcs.length; i++) {
      const mc = data.mcs[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        this.particules.attachFx('explosion',
          Math.round(mc.spr.x + D.FRUIT_WIDTH / 2), Math.round(mc.spr.y + D.FRUIT_HEIGHT / 2),
          { totalFrames: 6 });
        this.particules.explodeFrozen(mc.spr.x, mc.spr.y);
        mc.spr.overrideImg = null;
        data.mcs.splice(i, 1); i--;
      }
    }
    if (data.mcs.length === 0) this.specialDoneAnim();
  };

  Animator.prototype.couleeMetalMain = function (data) {
    for (let i = 0; i < data.mcs.length; i++) {
      data.mcs.splice(i, 1); i--; // skins déjà à jour (dérivés des flags)
    }
    if (data.mcs.length === 0) this.specialDoneAnim();
  };

  Animator.prototype.ecarteurMain = function (data, tmod) {
    data.timer -= tmod;
    if (data.timer <= 0) {
      this.particules.attachFx('strike',
        this.pos_x + (data.fruits.length * D.FRUIT_WIDTH) / 2, 0, { totalFrames: 10 });
      data.timer = 999999;
    }
    for (let i = 0; i < data.left.length; i++) {
      const mc = data.left[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        mc.spr.cpt += 0.4 * tmod;
        mc.spr.x = mc.spr.tx + Math.cos(mc.spr.cpt) * D.FRUIT_WIDTH * 0.7;
        if (mc.spr.cpt >= Math.PI * 1.5) {
          mc.spr.x = mc.spr.tx;
          data.left.splice(i, 1); i--;
        }
      }
    }
    for (let i = 0; i < data.right.length; i++) {
      const mc = data.right[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        mc.spr.cpt += 0.4 * tmod;
        mc.spr.x = mc.spr.tx - Math.cos(mc.spr.cpt) * D.FRUIT_WIDTH * 0.7;
        if (mc.spr.cpt >= Math.PI * 1.5) {
          mc.spr.x = mc.spr.tx;
          data.right.splice(i, 1); i--;
        }
      }
    }
    for (let i = 0; i < data.expl.length; i++) {
      const mc = data.expl[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        this.explodeFruit(mc);
        this.removeExtra(mc);
        data.expl.splice(i, 1); i--;
      }
    }
    if (data.expl.length === 0 && data.left.length === 0 && data.right.length === 0)
      this.specialDoneAnim();
  };

  Animator.prototype.removeExtra = function (f) {
    const i = this.extraFruits.indexOf(f);
    if (i >= 0) this.extraFruits.splice(i, 1);
  };

  Animator.prototype.destroy = function () {
    this.particules.destroy();
    this.extraFruits = [];
    this.explosions = { list: [], armors: [] };
  };

  // dessine la grille + fruits annexes du joueur
  Animator.prototype.drawFruits = function (ctx, level) {
    if (!this.fruitsVisible) return;
    const fruits = level.getFruits();
    for (let x = 0; x < level.width; x++)
      for (let y = 0; y < level.height; y++) {
        const f = fruits[x][y];
        if (f != null) drawFruit(ctx, f);
      }
    for (let i = 0; i < this.explosions.list.length; i++)
      drawFruit(ctx, this.explosions.list[i]);
    for (let i = 0; i < this.extraFruits.length; i++)
      drawFruit(ctx, this.extraFruits[i]);
    for (let i = 0; i < this.explosions.armors.length; i++) {
      const g = this.explosions.armors[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, g.alpha / 100);
      if (g.img) ctx.drawImage(g.img, g.x - 1.5, g.y - 1.5, 38, 38);
      ctx.restore();
    }
  };

  function drawFruit(ctx, f) {
    const s = f.spr;
    if (!s || s.dead || !s.visible) return;
    const img = s.overrideImg || A.fruitImage(f);
    if (!img || !img.naturalWidth) return;
    const a = s.alpha / 100;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(img, s.x + s.subx - 1.5, s.y + s.suby - 1.5, 38, 38);
    ctx.restore();
  }
  SW.drawFruit = drawFruit;

  // ── AnimatorChallenge (AnimatorChallenge.as) ─────────────────────────────
  function AnimatorChallenge(player, pos_x, pos_y) {
    Animator.call(this, player, pos_x, pos_y);
    this.comboStar = null; // { value, scale, flash, distort, animCpt, flying }
    this.comboName = null; // { imgIdx, classic }
    this.comboId = 0;
  }
  AnimatorChallenge.prototype = Object.create(Animator.prototype);
  SW.AnimatorChallenge = AnimatorChallenge;

  AnimatorChallenge.prototype.attachComboStar = function () {
    this.comboStar = {
      value: this.comboId, scale: D.COMBOSTAR_SCALE,
      flash: 0, distort: false, animCpt: 0, flying: false, done: false,
    };
  };
  AnimatorChallenge.prototype.swap = function (f1, f2) {
    Animator.prototype.swap.call(this, f1, f2);
    this.comboId = 0;
    this.comboStar = null;
    this.comboName = null;
  };
  AnimatorChallenge.prototype.explode = function (mcs, peteArmures, score) {
    Animator.prototype.explode.call(this, mcs, peteArmures, score);
    this.comboId++;
    if (this.comboStar == null) this.attachComboStar();
    else {
      this.comboStar.flash = 6;
      this.comboStar.value = this.comboId;
    }
  };
  AnimatorChallenge.prototype.main = function (tmod) {
    Animator.prototype.main.call(this, tmod);
    const cs = this.comboStar;
    if (cs != null) {
      if (cs.flash > 0) cs.flash -= tmod;
      if (cs.distort) {
        cs.animCpt += tmod * 0.4;
        cs.scaleX = 100 + Math.cos(cs.animCpt) * 5;
        cs.scaleY = 100 + Math.sin(cs.animCpt) * 5;
      }
    }
  };
  AnimatorChallenge.prototype.comboScore = function (score, nbCombos) {
    const mc = this.particules.attachFx('scorePop', this.explosions.x, this.explosions.y,
      { totalFrames: 24, text: score, big: score >= 1000 });
    if (U.getLod() === D.HIGH) mc.managers.push(U.sinManager);
    if (nbCombos > 0 && this.comboStar != null) {
      const scale = (nbCombos / E.COMBOS[E.COMBOS.length - 2]) * (100 - D.COMBOSTAR_SCALE);
      this.comboStar.scale = Math.min(100, D.COMBOSTAR_SCALE + scale);
      this.comboStar.flash = 6;
      this.comboStar.value = nbCombos;
    }
  };
  AnimatorChallenge.prototype.finalComboScore = function (score, nbCombos) {
    if (score > 0) {
      A.play(A.SHOW_SCORE);
      if (this.comboStar == null) this.attachComboStar();
      const cs = this.comboStar;
      cs.scale = 100;
      cs.flash = 6;
      cs.value = score;
      cs.distort = true;
      cs.done = true;
      cs.flying = score >= D.MIN_SUPER_COMBO;
      let i = 0;
      if (SW.Data.gameMode === SW.Data.CLASSIC) {
        while (i < E.COMBOS_CLASSIC.length && nbCombos >= E.COMBOS_CLASSIC[i]) i++;
      } else {
        while (i < E.COMBOS.length && nbCombos >= E.COMBOS[i]) i++;
        if (i > 0) TItem.addCombo(i - 1);
      }
      if (i > 0)
        this.comboName = { idx: i - 1, classic: SW.Data.gameMode === SW.Data.CLASSIC, timer: 90 };
    }
  };
  AnimatorChallenge.prototype.drawOverlays = function (ctx) {
    const cs = this.comboStar;
    if (cs != null) {
      ctx.save();
      ctx.translate(D.COMBOSTAR_X, D.COMBOSTAR_Y);
      const sx = (cs.scaleX || cs.scale) / 100;
      const sy = (cs.scaleY || cs.scale) / 100;
      const fl = cs.flash > 0 ? 1.18 : 1;
      ctx.scale(sx * fl, sy * fl);
      U.drawCentered(ctx, A.img('comboStar'), 0, 0, 1);
      U.text(ctx, String(cs.value), 0, 6, {
        size: cs.done ? 22 : 30, color: '#a04000', stroke: '#fff7d0', strokeWidth: 4,
      });
      ctx.restore();
    }
    const cn = this.comboName;
    if (cn != null) {
      cn.timer -= SW.tmod;
      if (cn.timer <= 0) this.comboName = null;
      else {
        const img = cn.classic ? A.img('comboClassic') : A.img('combo' + cn.idx);
        const k = Math.min(1, (90 - cn.timer) / 5);
        ctx.save();
        ctx.globalAlpha = Math.min(1, cn.timer / 15);
        ctx.translate(D.COMBO_X + D.CHALLENGE_X, D.COMBO_Y);
        ctx.scale(k, k);
        U.drawCentered(ctx, img, 0, 20, 1);
        ctx.restore();
      }
    }
  };

  // ── Player (Player.as) ───────────────────────────────────────────────────
  function Player(game, pid, infos, px, py, challengeAnimator) {
    this.id = pid;
    this.infos = infos;
    this.game = game;
    this.animator = challengeAnimator
      ? new AnimatorChallenge(this, px, py)
      : new Animator(this, px, py);
    const me = this;
    infos.onAttach = function (f, x, y) { me.animator.initSprite(f, x, y); };
    infos.onMoveUp = function (f) { me.animator.moveUp(f); };
    infos.onDestroy = function (f) { if (f.spr) f.spr.dead = true; };
    this.level = new E.Level(infos);
    this.game_over_flag = undefined;
    this.star_counter = 0;
    this.score = 0;
    this.horizontal_lock = 0;
    this.next_combo_double = false;
    this.sync_attacks = [];
    this.combo = [];
    this.combo_number = 0;
    this.combo_score = 0;
  }
  SW.Player = Player;

  Player.prototype.isIA = function () { return false; };
  Player.prototype.setVisible = function (b) { this.animator.setFruitsVisible(b); };
  Player.prototype.getLevelWidth = function () { return this.level.getWidth(); };
  Player.prototype.getLevelHeight = function () { return this.level.getHeight(); };

  Player.prototype.noMoreLine = function () {
    const fruits = this.level.getFruits();
    const w = this.level.getWidth();
    const y = this.level.getHeight() - 1;
    let prev = false;
    for (let x = 0; x < w; x++) {
      if (fruits[x][y] != null) {
        if (prev) return false;
        prev = true;
      } else prev = false;
    }
    return true;
  };

  Player.prototype.checkAttacks = function () {
    if (this.sync_attacks.length === 0) return false;
    const aid = this.sync_attacks[0];
    this.sync_attacks.splice(0, 1);
    this.attacked(aid, true);
    return true;
  };

  Player.prototype.main = function (tmod, deltaT) {
    if (this.horizontal_lock > 0) {
      this.horizontal_lock -= deltaT;
      if (this.horizontal_lock < 0) this.horizontal_lock = 0;
    }
    this.animator.main(tmod);
  };

  Player.prototype.destroy = function () {
    this.animator.destroy();
  };

  Player.prototype.swapDone = function () {
    let x = null;
    if (this.game_over_flag === undefined) {
      const combos = this.level.calc();
      if (combos != null) x = this.level.explode(combos);
    }
    if (x != null) {
      let nexpl = 0;
      this.combo_number++;
      for (let i = 0; i < x.combos.length; i++) nexpl += x.combos[i].v;
      const mcs = x.mcs;
      for (let i = 0; i < mcs.length; i++)
        if ((mcs[i].flags & E.FLAG_STAR) !== 0) {
          this.game.getPower(this, mcs[i]);
          this.star_counter++;
          if (this.star_counter > D.MAX_POWER) this.star_counter = D.MAX_POWER;
        }
      this.combo.push(nexpl);
      let explScore;
      if (SW.Data.gameMode === SW.Data.CLASSIC)
        explScore = E.calcScoreClassic(nexpl, this.combo_number, this.game.level);
      else
        explScore = E.calcScore(nexpl, this.combo_number);
      this.animator.explode(x.mcs, x.pete_armures, explScore);
      this.animator.comboScore(explScore, this.combo_number);
      this.combo_score += explScore;
    } else if (!this.checkAttacks())
      this.turnDone();
  };

  Player.prototype.explodeDone = function () {
    const p = this.combo.length - 1;
    const c = this.combo[p];
    this.game.sendFruits(this, c, p);
    if (this.next_combo_double) this.game.sendFruits(this, c, p);
    const mcs = this.level.gravity();
    if (mcs != null) this.animator.gravity(mcs);
    else this.swapDone();
  };

  Player.prototype.gravityDone = function () { this.swapDone(); };
  Player.prototype.fallingDone = function () { this.skipTurn(); };

  Player.prototype.skipTurn = function () {
    this.combo = [];
    this.combo_number = 0;
    this.combo_score = 0;
    this.swapDone();
  };

  Player.prototype.turnDone = function () {
    this.score += this.combo_score;
    this.animator.finalComboScore(this.combo_score, this.combo_number);
    this.next_combo_double = false;
    this.game.turnDone(this, this.combo);
  };

  Player.prototype.fallFruits = function () {
    const fruits = [];
    const sendList = this.game.getPool(this);
    const highs = [], sortedHighs = [];
    const tbl = this.level.getFruits();
    for (let x = 0; x < this.infos.width; x++) {
      let y;
      for (y = 0; y < this.infos.height; y++)
        if (tbl[x][y] != null) break;
      const k = { x: x, h: this.infos.height - y };
      highs.push(k);
      sortedHighs.push(k);
    }
    sortedHighs.sort(function (a, b) { return a.h - b.h; });

    while (sendList.length > 0) {
      const send = sendList[0];
      let n = 0;
      if (send.x === -1) {
        while (true) {
          if (this.isIA()) send.x = sortedHighs[random(4)].x;
          else send.x = random(this.infos.width);
          n++;
          if (n > 500 || this.level.getFruit(send.x, 1) == null) break;
        }
      }
      const f = this.level.addFruit(send.x, send.col, send.flags);
      highs[send.x].h++;
      sortedHighs.sort(function (a, b) { return a.h - b.h; });
      if (f == null) {
        this.game_over_flag = true;
        break;
      }
      fruits.push(f);
      sendList.splice(0, 1);
    }
    if (fruits.length > 0) {
      this.animator.falling(fruits);
      return true;
    }
    return false;
  };

  Player.prototype.updateSudden = function () {
    const f = this.level.getFruits();
    const sudden = [];
    const w = this.level.getWidth();
    for (let i = 0; i < w; i++)
      if (f[i][0] != null) sudden.push(f[i][0]);
    this.animator.suddenFruits(sudden);
  };

  Player.prototype.panic = function () {
    const w = this.level.getWidth();
    let x;
    for (x = 0; x < w; x++)
      if (this.level.getFruit(x, 1) != null) break;
    return x !== w;
  };

  Player.prototype.getPair = function (x, y) {
    return this.level.getPair(x, y, this.animator.getInfos());
  };
  Player.prototype.getPairWithDir = function (x, y, dx, dy) {
    return this.level.getPairWithDir(x, y, dx, dy, this.animator.getInfos());
  };

  Player.prototype.swapPair = function (p) {
    if (this.horizontal_lock > 0 && p != null && p.dx !== 0) return false;
    if (this.level.swapPair(p)) {
      this.combo = [];
      this.combo_number = 0;
      this.combo_score = 0;
      this.animator.swap(p.f1, p.f2);
      return true;
    }
    return false;
  };

  Player.prototype.isGameOver = function () { return this.game_over_flag === true; };
  Player.prototype.genLine = function () { return this.level.genLine(); };
  Player.prototype.canAttack = function () { return this.star_counter >= E.ATTACK_STARS[this.id]; };
  Player.prototype.canDefend = function () { return this.star_counter >= E.DEFENSE_STARS[this.id]; };
  Player.prototype.gameOver = function (wins) {
    this.animator.gameOver(wins, this.level.getFruits());
  };
  Player.prototype.specialDone = function () { this.swapDone(); };
  Player.prototype.specialDoneGravity = function () { this.explodeDone(); };
  Player.prototype.reset = function () { /* IA uniquement */ };

  // capture des skins courants (pour les révélations différées)
  Player.prototype.snapshotSkins = function (list) {
    for (let i = 0; i < list.length; i++)
      if (list[i] && list[i].spr) list[i].spr.preImg = A.fruitImage(list[i]);
  };

  Player.prototype.attacked = function (aid, sync) {
    const w = this.level.getWidth();
    const fruits = this.level.getFruits();
    switch (aid) {
      case 0: // VERTIGE : verrou horizontal
        if (!sync) { this.sync_attacks.push(aid); return false; }
        this.reset();
        this.horizontal_lock = E.HORIZ_LOCK_TIME;
        this.animator.tremblementDeTerre([], [], fruits);
        return true;
      case 1: // GROS NOYAU : 2 lignes gelées
        for (let y = 0; y < 2; y++)
          for (let x = 0; x < w; x++)
            this.game.sendTo(this, { col: this.infos.gen_fruit_color(), flags: E.FLAG_ARMURE, x: -1 });
        return false;
      case 2: // PETIT PEPIN : 1 ligne gelée
        for (let x = 0; x < w; x++)
          this.game.sendTo(this, { col: this.infos.gen_fruit_color(), flags: E.FLAG_ARMURE, x: -1 });
        return false;
      case 3: { // COLONNADE : 4 gelés sur une colonne
        const x = E.pickColonnadeColumn(this.level, random);
        for (let y = 0; y < 4; y++)
          this.game.sendTo(this, { col: this.infos.gen_fruit_color(), flags: E.FLAG_ARMURE, x: x });
        return false;
      }
      case 4: { // TREMBLETERRE
        if (!sync) { this.sync_attacks.push(aid); return false; }
        this.reset();
        const r = E.attackEarthquake(this.level);
        this.animator.tremblementDeTerre(r.rems, r.adds, fruits);
        return true;
      }
      case 5: // DOUBLE LA MISE (géré par l'attaquant)
        return false;
      case 6: { // COULEE DE METAL
        if (!sync) { this.sync_attacks.push(aid); return false; }
        this.reset();
        const r = E.attackCouleeMetal(this.level);
        this.animator.couleeMetal(r.acier, fruits);
        return true;
      }
    }
    return false;
  };

  Player.prototype.attack = function (p, sync) {
    const attackId = E.ATTACK_PLAYERS[this.id];
    this.star_counter -= E.ATTACK_STARS[this.id];
    this.animator.showAttack(E.ATTACK_NAMES[attackId]);
    if (attackId === 5) this.next_combo_double = true;
    return p.attacked(attackId, sync);
  };

  Player.prototype.defend = function () {
    const defenseId = E.DEFENSE_PLAYERS[this.id];
    this.star_counter -= E.DEFENSE_STARS[this.id];
    const fruits = this.level.getFruits();
    this.combo = [];
    this.combo_number = 0;
    this.combo_score = 0;
    let data = null;
    switch (defenseId) {
      case 0: data = E.defenseEcarteur(this.level); break;
      case 1: data = E.defenseEgaliseur(this.level); break;
      case 2: data = E.defenseCoupeur(this.level); break;
      case 3: data = E.defensePete1Ligne(this.level); break;
      case 4: {
        // skins capturés avant conversion pour la révélation différée
        const all = [];
        for (let x = 0; x < this.level.width; x++)
          for (let y = 0; y < this.level.height; y++)
            if (fruits[x][y] != null) all.push(fruits[x][y]);
        this.snapshotSkins(all);
        data = E.defenseConvertisseur(this.level, this.infos.gen_fruit_color);
        break;
      }
      case 5: {
        const all = [];
        for (let x = 0; x < this.level.width; x++)
          for (let y = 0; y < this.level.height; y++)
            if (fruits[x][y] != null) all.push(fruits[x][y]);
        this.snapshotSkins(all);
        data = E.defensePeteArmures(this.level);
        break;
      }
      case 6: data = E.defenseCombos2(this.level); break;
    }
    this.animator.dispatchDefense(data, fruits);
  };

  // ── IAPlayer (IAPlayer.as) ───────────────────────────────────────────────
  function IAPlayer(game, pid, infos, px, py, maxTime) {
    Player.call(this, game, pid, infos, px, py, false);
    this.ia = new E.IA(this.level, random);
    this.ia_lock = true;
    this.need_end = false;
    this.max_time = maxTime;
    this.ia_pair = null;
    this.ia_timer = 0;
    this.ia_counter = 0;
  }
  IAPlayer.prototype = Object.create(Player.prototype);
  SW.IAPlayer = IAPlayer;

  IAPlayer.prototype.isIA = function () { return true; };
  IAPlayer.prototype.start = function () {
    this.ia_lock = false;
    this.ia_pair = null;
    this.ia.processStart(this.horizontal_lock > 0);
    this.need_end = true;
    this.ia_timer = 0;
    this.ia_counter = 0;
  };
  IAPlayer.prototype.getIAPair = function () { return this.ia_pair; };
  IAPlayer.prototype.reset = function () {
    if (this.need_end) {
      this.ia.processEnd();
      this.need_end = false;
    }
    this.ia_lock = true;
    this.ia_pair = null;
  };
  IAPlayer.prototype.swapPair = function (p) {
    if (!Player.prototype.swapPair.call(this, p)) {
      // contournement historique (IAPlayer.as)
      this.reset();
      this.start();
      return false;
    }
    return true;
  };
  IAPlayer.prototype.main = function (tmod, deltaT) {
    Player.prototype.main.call(this, tmod, deltaT);
    if (!this.ia_lock) {
      if (random(Math.max(1, Math.floor(100 / tmod))) === 0 || this.star_counter === D.MAX_POWER) {
        let h = this.level.calcAvgHigh();
        let h2 = this.game.player.level.calcAvgHigh();
        if (random(6) === 0) { const t = h; h = h2; h2 = t; }
        if (h < h2) {
          if (this.canAttack()) this.game.iaAttack();
          else if (this.star_counter >= D.MAX_POWER - 1 && this.canDefend()) this.game.iaDefend();
        } else {
          if (this.canDefend()) this.game.iaDefend();
          else if (this.star_counter >= D.MAX_POWER - 1 && this.canAttack()) this.game.iaAttack();
        }
        if (this.ia_lock) return;
      }
      this.ia_timer += deltaT;
      const delta = 1 / E.IA_TIMES[this.id][2];
      while (this.ia_timer > delta) {
        this.ia_pair = this.ia.process(50);
        if (this.ia_pair != null) { this.need_end = false; break; }
        this.ia_timer -= delta;
        this.ia_counter++;
      }
      if (this.ia_pair != null && this.ia_counter * delta > this.max_time) {
        this.need_end = false;
        this.ia_pair = this.ia.processEnd();
      }
      if (this.ia_pair != null) this.ia_lock = true;
    }
  };

  // ── Pause (Pause.as) ─────────────────────────────────────────────────────
  function Pause(toggles, xOffset) {
    this.toggles = toggles;
    this.flag = false;
    this.key_flag = false;
    this.xOffset = xOffset;
    this.want = false; // demande via bouton tactile / Échap
  }
  SW.Pause = Pause;
  Pause.prototype.activated = function () { return this.flag; };
  Pause.prototype.togglesVisible = function (b) {
    for (let i = 0; i < this.toggles.length; i++) this.toggles[i].setVisible(b);
  };
  Pause.prototype.main = function () {
    const pressed = SW.escDown || this.want;
    this.want = false;
    if (this.flag) {
      if (pressed) {
        if (!this.key_flag) {
          this.togglesVisible(true);
          this.flag = false;
          this.key_flag = true;
          return false;
        }
      } else this.key_flag = false;
      return true;
    }
    if (pressed) {
      if (!this.key_flag) {
        this.key_flag = true;
        this.flag = true;
        this.togglesVisible(false);
        return true;
      }
    } else this.key_flag = false;
    return false;
  };
  Pause.prototype.draw = function (ctx) {
    if (!this.flag) return;
    ctx.save();
    ctx.fillStyle = 'rgba(20,40,10,0.35)';
    ctx.fillRect(0, 0, D.DOCWIDTH, D.DOCHEIGHT);
    const img = A.img('pauseBox');
    const x = D.DOCWIDTH / 2 + this.xOffset, y = D.DOCHEIGHT / 2;
    if (img) ctx.drawImage(img, x - 53.5, y - 23);
    U.text(ctx, 'pause', x, y, { size: 17, color: '#3a7a1a', stroke: '#fff3d8', strokeWidth: 3 });
    ctx.restore();
  };

  // bouton pause tactile (ajout mobile — Échap reste actif au clavier)
  SW.pauseBtnRect = { x: D.DOCWIDTH - 30, y: 4, w: 26, h: 26 };
  SW.drawPauseButton = function (ctx) {
    const r = SW.pauseBtnRect;
    ctx.save();
    ctx.globalAlpha = 0.55;
    U.roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fillStyle = '#2a4a10';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(r.x + 8, r.y + 7, 3.5, 12);
    ctx.fillRect(r.x + 14.5, r.y + 7, 3.5, 12);
    ctx.restore();
  };

  // ── Interf (Interf.as) ───────────────────────────────────────────────────
  function Interf(game, nbPlayers) {
    this.game = game;
    this.particules = new U.Particules();
    this.pl = [];
    for (let i = 0; i < nbPlayers; i++) this.pl[i] = newInterfPlayer();
    this.powerFx = [];
    this.lock = false;
    this.starScale = 0;
    this.rollover = new U.Rollover();
  }
  SW.Interf = Interf;

  function newInterfPlayer() {
    return {
      face: null, maxIndicator: false, powerList: [],
      power: 0, oldPower: 0, powerX: 0, powerY: 0,
    };
  }

  Interf.prototype.main = function (tmod) {
    for (let p = 0; p < this.pl.length; p++) {
      const player = this.pl[p];
      player.face.update(tmod);
      if (player.powerList.length > 0) {
        this.starScale += 0.25;
        if (this.starScale >= Math.PI * D.POWER_JUMP_CYCLES)
          this.starScale -= Math.PI * D.POWER_JUMP_CYCLES;
        for (let i = 0; i < player.powerList.length; i++) {
          const mc = player.powerList[i];
          if (!mc) continue; // index 0 inutilisé (liste 1-based, cf. AS2)
          const cpt = this.starScale - i * 0.6;
          if (cpt >= 0 && cpt <= Math.PI)
            mc.scale = Math.abs(Math.sin(cpt)) * D.POWER_JUMP_SCALE + D.POWER_SCALE;
          else mc.scale = D.POWER_SCALE;
        }
      }
    }
    for (let i = 0; i < this.powerFx.length; i++) {
      const mc = this.powerFx[i];
      mc.x += mc.dx * tmod;
      mc.y += mc.dy * tmod;
      if ((mc.dx < 0 && mc.x <= mc.tx) || (mc.dx > 0 && mc.x >= mc.tx)) {
        this.particules.attachFx('getPowerStar', mc.tx, mc.ty, { totalFrames: 10 });
        this.particules.heavyExplosion(mc.tx, mc.ty, mc.dx, mc.dy);
        this.updatePower(mc.plId);
        this.powerFx.splice(i, 1);
        i--;
      }
    }
    this.particules.main(tmod);
  };

  Interf.prototype.setLock = function (flag) { this.lock = flag; };

  Interf.prototype.updatePower = function (plId) {
    const player = this.pl[plId];
    while (player.power > player.oldPower) {
      const mc = {
        x: player.powerX,
        y: player.powerY - player.oldPower * D.POWER_HEIGHT,
        scale: D.POWER_SCALE,
        rot: random(40) / 10 * (random(2) * 2 - 1),
      };
      this.particules.explodeStar(mc.x, mc.y);
      player.oldPower++;
      player.powerList[player.oldPower] = mc;
    }
    while (player.power < player.oldPower) {
      const mc = player.powerList[player.oldPower];
      if (mc) this.particules.explodeStar(mc.x, mc.y);
      player.powerList.splice(player.oldPower, 1);
      player.oldPower--;
    }
    player.maxIndicator = player.power === D.MAX_POWER;
  };

  Interf.prototype.addPower = function (plId, fruit) {
    const player = this.pl[plId];
    player.power++;
    if (player.power > D.MAX_POWER) {
      player.power = D.MAX_POWER;
      this.particules.attachFx('getPowerStar',
        fruit.spr.x + D.FRUIT_WIDTH / 2, fruit.spr.y + D.FRUIT_HEIGHT / 2, { totalFrames: 10 });
    } else {
      const mc = {
        x: fruit.spr.x + D.FRUIT_WIDTH / 2,
        y: fruit.spr.y + D.FRUIT_HEIGHT / 2,
        tx: player.powerX,
        ty: player.powerY - D.POWER_HEIGHT * player.power + D.POWER_HEIGHT,
        plId: plId,
      };
      mc.dx = (mc.tx - mc.x) * 0.1;
      mc.dy = (mc.ty - mc.y) * 0.1;
      this.powerFx.push(mc);
    }
  };

  Interf.prototype.displayPair = function (p) {
    this.rollover.setPair(p, this.game.player.animator.getInfos(), this.game.player.horizontal_lock);
  };

  Interf.prototype.gameOver = function () {
    this.pl[0].face.shakeItBaby(50);
  };

  Interf.prototype.doAttack = function (plId) {
    const player = this.pl[plId];
    if (player.power >= E.ATTACK_STARS[SW.Data.players[plId]]) {
      player.face.setAttack(100);
      player.power -= E.ATTACK_STARS[SW.Data.players[plId]];
      this.updatePower(plId);
      return true;
    }
    return false;
  };
  Interf.prototype.attack = function () {
    if (this.doAttack(0)) this.game.attack();
  };
  Interf.prototype.doDefend = function (plId) {
    const player = this.pl[plId];
    if ((plId === 1 || !this.lock) && player.power >= E.DEFENSE_STARS[SW.Data.players[plId]]) {
      player.power -= E.DEFENSE_STARS[SW.Data.players[plId]];
      player.face.setAttack(100);
      this.updatePower(plId);
      return true;
    }
    return false;
  };
  Interf.prototype.defend = function () {
    if (this.doDefend(0)) this.game.defend();
  };

  Interf.prototype.drawPowerStars = function (ctx) {
    const img = A.img('powerStar');
    for (let p = 0; p < this.pl.length; p++) {
      const player = this.pl[p];
      for (let i = 1; i <= player.oldPower; i++) {
        const mc = player.powerList[i];
        if (!mc) continue;
        ctx.save();
        ctx.translate(mc.x, mc.y);
        ctx.rotate(mc.rot * Math.PI / 180);
        const s = mc.scale / 100;
        if (img) ctx.drawImage(img, -18 * s, -18.5 * s, 36 * s, 37 * s);
        ctx.restore();
      }
      if (player.maxIndicator) {
        U.text(ctx, 'max !', player.powerX, player.powerY - D.POWER_HEIGHT * player.power - 16,
          { size: 13, color: '#fff04a', stroke: '#7a3000', strokeWidth: 3 });
      }
    }
  };

  Interf.prototype.destroy = function () { this.particules.destroy(); };

  // fond commun : tuile bg + ligne de mort subite
  function drawBg(ctx, imgName) {
    const img = A.img(imgName);
    if (img && img.naturalWidth) {
      for (let x = 0; x < D.DOCWIDTH; x += img.naturalWidth)
        ctx.drawImage(img, x, 0);
    } else {
      ctx.fillStyle = '#7da33c';
      ctx.fillRect(0, 0, D.DOCWIDTH, D.DOCHEIGHT);
    }
    const sd = A.img('sd');
    if (sd) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.drawImage(sd, 0, D.SUDDEN_Y);
      ctx.restore();
    }
  }
  SW.drawBg = drawBg;

  function drawLeaves(ctx, x, y) {
    const img = A.img('feuilles');
    if (img) ctx.drawImage(img, x, y);
  }

  // ── InterfChallenge (InterfChallenge.as) ─────────────────────────────────
  function InterfChallenge(game) {
    Interf.call(this, game, 1);
    this.classic = SW.Data.gameMode === SW.Data.CLASSIC;
    this.pl[0].powerX = D.POWER_X;
    this.pl[0].powerY = D.POWER_Y;
    this.pl[0].face = new U.Face(SW.Data.players[0]);
    this.defenseIcon = new U.IconButton('powerDef', this.defend.bind(this));
    this.defenseIcon.x = D.ATTDEF_ICON_X;
    this.defenseIcon.y = D.POWER_Y - (E.DEFENSE_STARS[SW.Data.players[0]] - 1) * D.POWER_HEIGHT - 17;
    this.score = 0;
    this.viewScore = 0;
    this.classicModeOn = false;
  }
  InterfChallenge.prototype = Object.create(Interf.prototype);
  SW.InterfChallenge = InterfChallenge;

  InterfChallenge.prototype.classicMode = function () {
    this.classicModeOn = true;
    this.defenseIcon.visible = false;
    this.pl[0].face.visible = false;
  };

  InterfChallenge.prototype.main = function (tmod) {
    Interf.prototype.main.call(this, tmod);
    this.defenseIcon.update(tmod);
    this.defenseIcon.isOver = this.defenseIcon.hitTest(SW.mouse.x, SW.mouse.y);
    if (this.viewScore < this.score) {
      if (this.score - this.viewScore >= 1000)
        this.viewScore += Math.round(D.SCORE_SPEED * 2 * tmod);
      else
        this.viewScore += Math.round(D.SCORE_SPEED * tmod);
      if (this.viewScore >= this.score) this.viewScore = this.score;
    }
  };
  InterfChallenge.prototype.updateScore = function (score) { this.score = score; };
  InterfChallenge.prototype.setLock = function (flag) {
    Interf.prototype.setLock.call(this, flag);
    if (this.lock) this.defenseIcon.disable();
    else this.defenseIcon.enable();
  };
  InterfChallenge.prototype.handleClick = function (mx, my) {
    if (this.defenseIcon.visible && this.defenseIcon.hitTest(mx, my)) {
      this.defenseIcon.release();
      return true;
    }
    return false;
  };
  InterfChallenge.prototype.drawBack = function (ctx) {
    drawBg(ctx, this.classicModeOn || this.classic ? 'bgClassic' : 'bg');
    const lp = A.img(this.classicModeOn || this.classic ? 'leftPanelClassic' : 'leftPanel');
    if (lp) ctx.drawImage(lp, 0, 0);
    const rp = A.img(this.classicModeOn || this.classic ? 'rightPanelClassic' : 'rightPanel');
    if (rp) ctx.drawImage(rp, D.DOCWIDTH - rp.naturalWidth, 0);
  };
  InterfChallenge.prototype.drawFront = function (ctx) {
    // score sur le parchemin
    U.text(ctx, String(this.viewScore), 88, 38, { size: 20, color: '#5a3a10', align: 'center' });
    if (!this.classicModeOn) drawLeaves(ctx, D.LEAVES_X, D.LEAVES_Y);
    this.drawPowerStars(ctx);
    this.defenseIcon.draw(ctx);
    this.rollover.draw(ctx);
    if (this.pl[0].face.visible)
      this.pl[0].face.draw(ctx, D.FACE_X, D.FACE_Y, D.FACE_WIDTH);
    this.particules.draw(ctx);
  };

  // ── Interf2P (Interf2P.as) ───────────────────────────────────────────────
  function Interf2P(game) {
    Interf.call(this, game, 2);
    this.pl[0].powerX = D.DUEL_POWER_X;
    this.pl[0].powerY = D.POWER_Y;
    this.pl[0].face = new U.Face(SW.Data.players[0]);
    this.pl[1].powerX = D.DOCWIDTH - D.DUEL_POWER_X;
    this.pl[1].powerY = D.POWER_Y;
    this.pl[1].face = new U.Face(SW.Data.players[1]);
    this.pl[1].face.flip();
    this.attackIcon = new U.IconButton('powerAtt', this.attack.bind(this));
    this.attackIcon.x = D.DUEL_ATTDEF_ICON_X;
    this.attackIcon.y = D.POWER_Y - (E.ATTACK_STARS[SW.Data.players[0]] - 1) * D.POWER_HEIGHT - 17;
    this.defenseIcon = new U.IconButton('powerDef', this.defend.bind(this));
    this.defenseIcon.x = D.DUEL_ATTDEF_ICON_X;
    this.defenseIcon.y = D.POWER_Y - (E.DEFENSE_STARS[SW.Data.players[0]] - 1) * D.POWER_HEIGHT - 17;
    this.arrowRot = 90;
    this.pool = [];      // items visuels {x,y,scale,targetScale,scaleSpeed,timer,img}
    this.pool_temp = [];
    this.pool_for_ia = false;
  }
  Interf2P.prototype = Object.create(Interf.prototype);
  SW.Interf2P = Interf2P;

  Interf2P.prototype.main = function (tmod) {
    Interf.prototype.main.call(this, tmod);
    for (let i = 0; i < this.pool_temp.length; i++) {
      const f = this.pool_temp[i];
      if (f.timer > 0) f.timer -= tmod * Math.max(10 - i, 2);
      else {
        f.scale += f.scaleSpeed * tmod;
        if (f.scale <= 0) {
          this.pool_temp.splice(i, 1); i--;
        } else if (f.scale >= f.targetScale) {
          f.scale = f.targetScale;
          this.pool_temp.splice(i, 1); i--;
        }
      }
    }
    this.attackIcon.update(tmod);
    this.defenseIcon.update(tmod);
    this.attackIcon.isOver = this.attackIcon.hitTest(SW.mouse.x, SW.mouse.y);
    this.defenseIcon.isOver = this.defenseIcon.hitTest(SW.mouse.x, SW.mouse.y);
    this.updateArrow(tmod);
  };

  Interf2P.prototype.updateArrow = function (tmod) {
    let trot;
    if (this.pool.length === 0) trot = 90;
    else if (this.pool_for_ia) trot = 0;
    else trot = 179;
    let rot = this.arrowRot;
    if (rot < trot) { rot += tmod * 20; if (rot > trot) rot = trot; }
    else if (rot > trot) { rot -= tmod * 20; if (rot < trot) rot = trot; }
    this.arrowRot = rot;
  };

  Interf2P.prototype.destroyPoolItem = function () {
    const f = this.pool[this.pool.length - 1];
    this.pool.splice(this.pool.length - 1, 1);
    f.scaleSpeed = -12;
    if (f.timer <= 0) {
      f.timer = 50;
      this.pool_temp.push(f);
    }
  };

  Interf2P.prototype.addPoolItem = function (col, flags) {
    const fake = new E.Fruit(col, flags);
    const f = {
      img: A.fruitImage(fake),
      x: random(5) - 2 + D.DOCWIDTH / 2 - 3,
      y: 380 - this.pool.length * 16,
      timer: 50, scale: 0, scaleSpeed: 12, targetScale: 60 + random(10),
    };
    this.pool_temp.push(f);
    this.pool.push(f);
  };

  Interf2P.prototype.updatePool = function (mcs, pool_for_ia) {
    while (this.pool.length > mcs.length) this.destroyPoolItem();
    while (this.pool.length < mcs.length && this.pool.length < 19) {
      const p = mcs[this.pool.length];
      this.addPoolItem(p.col, p.flags);
    }
    this.pool_for_ia = pool_for_ia;
    const plface = this.pl[0].face;
    const iaface = this.pl[1].face;
    if (this.pool.length >= 10) {
      if (pool_for_ia) { plface.setHappy(50); iaface.panic(); }
      else { iaface.setHappy(50); plface.panic(); }
    }
  };

  Interf2P.prototype.setLock = function (flag) {
    Interf.prototype.setLock.call(this, flag);
    if (flag) this.defenseIcon.disable();
    else this.defenseIcon.enable();
  };
  Interf2P.prototype.lockAttack = function (flag) {
    if (flag) this.attackIcon.disable();
    else this.attackIcon.enable();
  };
  Interf2P.prototype.handleClick = function (mx, my) {
    if (this.attackIcon.hitTest(mx, my)) { this.attackIcon.release(); return true; }
    if (this.defenseIcon.hitTest(mx, my)) { this.defenseIcon.release(); return true; }
    return false;
  };

  Interf2P.prototype.drawBack = function (ctx) {
    drawBg(ctx, 'bg');
    const lp = A.img('leftPanelDuel');
    if (lp) ctx.drawImage(lp, 0, 0);
    const rp = A.img('rightPanelDuel');
    if (rp) ctx.drawImage(rp, D.DOCWIDTH - rp.naturalWidth, 0);
    const cp = A.img('centerPanel');
    if (cp) ctx.drawImage(cp, D.DOCWIDTH / 2 - cp.naturalWidth / 2, 0);
  };
  Interf2P.prototype.drawMask = function (ctx) {
    const m = A.img('centerPanelMask');
    if (m) ctx.drawImage(m, D.DOCWIDTH / 2 - m.naturalWidth / 2, 0);
  };
  Interf2P.prototype.drawFront = function (ctx) {
    this.drawMask(ctx);
    drawLeaves(ctx, D.DUEL_LEAVES_X, D.DUEL_LEAVES_Y);
    // pool de parasites au centre
    const items = this.pool.concat(this.pool_temp.filter(f => this.pool.indexOf(f) < 0));
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      const s = f.scale / 100;
      if (s <= 0 || !f.img) continue;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(s, s);
      ctx.drawImage(f.img, -19, -19, 38, 38);
      ctx.restore();
    }
    // flèche du pool
    const arrow = A.img('arrow');
    if (arrow) {
      ctx.save();
      ctx.translate(D.DOCWIDTH / 2, D.DOCHEIGHT - 32);
      ctx.rotate((this.arrowRot - 90) * Math.PI / 180);
      ctx.drawImage(arrow, -22, -16);
      ctx.restore();
    }
    this.drawPowerStars(ctx);
    this.attackIcon.draw(ctx);
    this.defenseIcon.draw(ctx);
    this.rollover.draw(ctx);
    const fs = D.FACE_WIDTH * D.DUEL_FACE_SCALE;
    this.pl[0].face.draw(ctx, D.DUEL_FACE_X, D.DUEL_FACE_Y, fs);
    this.pl[1].face.draw(ctx, D.DUEL_FACE_IA_X, D.DUEL_FACE_Y, fs);
    this.particules.draw(ctx);
  };

  // ── Challenge (Challenge.as) ─────────────────────────────────────────────
  function Challenge() {
    A.playMusic(A.MUSIC_CHALLENGE);
    TItem.combo_nitems = 0;
    this.ncoups = 5;
    this.star_counter = E.CHALLENGE_STAR_COUNTER;
    this.player = new Player(this, SW.Data.players[0], this.gameParams(), D.GAMEX, D.GAMEY, true);
    this.interf = new InterfChallenge(this);
    this.pause = new Pause([], D.CHALLENGE_X);
    this.special_power = false;
    this.lock = false;
    this.setLock(false);
    this.gameInit();
  }
  SW.Challenge = Challenge;

  Challenge.prototype.gameParams = function () {
    const me = this;
    return {
      width: E.CHALLENGE_LEVEL_WIDTH,
      height: E.CHALLENGE_LEVEL_HEIGHT,
      min: E.CHALLENGE_MIN_COMBO,
      gen_fruit_flags: function () { return me.genFruitFlags(); },
      gen_fruit_color: function () { return me.genFruitColor(); },
    };
  };
  Challenge.prototype.gameInit = function () {
    for (let i = 0; i < 3; i++) this.player.genLine();
  };
  Challenge.prototype.send = function () {};
  Challenge.prototype.sendTo = function () {};
  Challenge.prototype.getPool = function () { return []; };
  Challenge.prototype.setLock = function (flag) {
    this.lock = flag;
    this.interf.setLock(flag);
  };
  Challenge.prototype.getPower = function (context, mc) {
    this.interf.addPower(0, mc);
  };
  Challenge.prototype.genFruitFlags = function () {
    const isArmure = (random(130) < random(this.ncoups));
    const isNoswap = !isArmure && (random(250) < random(this.ncoups));
    let isStar = !isArmure && !isNoswap && (--this.star_counter === 0);
    if (isStar) this.star_counter = E.CHALLENGE_STAR_COUNTER;
    return (isArmure ? E.FLAG_ARMURE : 0) | (isStar ? E.FLAG_STAR : 0) | (isNoswap ? E.FLAG_NOSWAP : 0);
  };
  Challenge.prototype.genFruitColor = function () {
    return random(E.CHALLENGE_MAX_COLORS);
  };
  Challenge.prototype.destroy = function () {
    this.interf.destroy();
    this.player.destroy();
  };
  Challenge.prototype.sendFruits = function () {};
  Challenge.prototype.turnDone = function () {
    this.interf.updateScore(this.player.score);
    if (this.special_power && this.player.noMoreLine())
      this.special_power = false;
    if (this.special_power === false && !this.player.genLine()) {
      this.interf.gameOver(true);
      this.interf.pl[0].face.setDead(0xFFFFF);
      this.player.gameOver(false);
      const g = SW.Manager.gameOver(this.player.score);
      if (SW.Data.gameMode === SW.Data.CLASSIC)
        g.winTitem(TItem.classicItems(this.level));
      else
        g.winTitem(TItem.combo_nitems);
    } else {
      this.player.updateSudden();
      this.special_power = false;
      this.setLock(false);
      if (this.player.panic()) this.interf.pl[0].face.panic();
      else this.interf.pl[0].face.normal();
      if (this.player.combo_score > D.CHALLENGE_HAPPY_SCORE)
        this.interf.pl[0].face.setHappy(D.CHALLENGE_HAPPY_TIME);
    }
  };
  Challenge.prototype.gameClick = function () {
    if (this.lock || this.pause.activated()) return;
    if (this.interf.handleClick(SW.mouse.x, SW.mouse.y)) return;
    const fpair = SW.pickPair(this.player);
    if (this.player.swapPair(fpair)) {
      SW.Manager.client.nswaps++;
      this.ncoups++;
      this.setLock(true);
    }
  };
  Challenge.prototype.defend = function () {
    if (!this.lock && this.player.canDefend()) {
      this.setLock(true);
      this.special_power = true;
      this.player.defend();
    }
  };
  Challenge.prototype.iaAttack = function () {};
  Challenge.prototype.iaDefend = function () {};
  Challenge.prototype.main = function (tmod, deltaT) {
    if (this.pause.main()) return;
    let fpair = null;
    if (!this.lock && !SW.mouse.outside)
      fpair = SW.pickPair(this.player);
    this.interf.displayPair(fpair);
    this.player.main(tmod, deltaT);
    this.interf.main(tmod);
  };
  Challenge.prototype.draw = function (ctx) {
    this.interf.drawBack(ctx);
    this.player.animator.drawFruits(ctx, this.player.level);
    this.player.animator.particules.draw(ctx);
    this.interf.drawFront(ctx);
    if (this.player.animator.drawOverlays) this.player.animator.drawOverlays(ctx);
    this.drawExtra(ctx);
    SW.drawPauseButton(ctx);
    this.pause.draw(ctx);
  };
  Challenge.prototype.drawExtra = function () {};
  Challenge.prototype.onClickDown = function () { this.gameClick(); };

  // ── Classic (Classic.as) ─────────────────────────────────────────────────
  function Classic() {
    Challenge.call(this);
    this.ncoups = 1;
    this.level = 0;
    this.lup = null;
    this.lupShow = 0;
    this.interf.classicMode();
    this.player.genLine();
  }
  Classic.prototype = Object.create(Challenge.prototype);
  SW.Classic = Classic;

  Classic.prototype.gameParams = function () {
    const me = this;
    return {
      width: E.CHALLENGE_LEVEL_WIDTH,
      height: E.CHALLENGE_LEVEL_HEIGHT,
      min: 2,
      gen_fruit_flags: function () { return me.genFruitFlags(); },
      gen_fruit_color: function () { return me.genFruitColor(); },
    };
  };
  Classic.prototype.gameInit = function () {};
  Classic.prototype.genFruitFlags = function () { return 0; };
  Classic.prototype.genFruitColor = function () {
    const nfruits = Math.min(this.level + 2, 11);
    return random(nfruits);
  };
  Classic.prototype.main = function (tmod, deltaT) {
    if (this.ncoups > E.CLASSIC_LEVELS[this.level]) {
      this.ncoups = 0;
      this.level++;
      this.lup = 'Niveau ' + this.level;
    }
    if (this.lup != null && !this.lock) {
      this.lupShow = 70;
      this.lupText = this.lup;
      this.lup = null;
    }
    if (this.lupShow > 0) this.lupShow -= tmod;
    Challenge.prototype.main.call(this, tmod, deltaT);
  };
  Classic.prototype.drawExtra = function (ctx) {
    if (this.lupShow > 0) {
      const k = Math.min(1, (70 - this.lupShow) / 6);
      const y = D.DOCHEIGHT - 60 * k;
      const img = A.img('levelBox');
      const x = D.CHALLENGE_X + D.DOCWIDTH / 2;
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.lupShow / 10);
      if (img) ctx.drawImage(img, x - 53.5, y - 23);
      U.text(ctx, this.lupText, x, y, { size: 15, color: '#3a7a1a', stroke: '#fff3d8', strokeWidth: 3 });
      ctx.restore();
    }
  };

  // ── Duel (Duel.as) ───────────────────────────────────────────────────────
  function Duel() {
    if (SW.Data.gameMode !== SW.Data.DUEL) {
      if (SW.Data.gameMode === SW.Data.HISTORY && SW.Data.histoPhase === 6)
        SW.Data.difficulty = 3; // Wasabii 2e forme
      else
        SW.Data.difficulty = 2;
    }
    A.playMusic(A.MUSIC_DUEL);
    this.interf = new Interf2P(this);
    this.player = new Player(this, SW.Data.players[0], this.duelParams(false), D.DUEL_PLX, D.DUEL_PLY, false);
    this.ia = new IAPlayer(this, SW.Data.players[1], this.duelParams(true), D.DUEL_IAX, D.DUEL_IAY,
      E.IA_TIMES[SW.Data.players[1]][1]);
    this.pause = new Pause([this.player, this.ia], 0);
    this.plface = this.interf.pl[0].face;
    this.iaface = this.interf.pl[1].face;
    this.pool = [];
    this.pool_for_ia = false;
    this.ia_star_counter = E.DUEL_IA_STAR_COUNTER[SW.Data.difficulty];
    this.pl_star_counter = E.DUEL_STAR_COUNTER;
    for (let i = 0; i < 3; i++) {
      this.player.genLine();
      this.ia.genLine();
    }
    this.game_over_flag = false;
    this.player_special_combo = false;
    this.ia_special_combo = false;
    this.pl_lock = false;
    this.ia_lock = false;
    this.player_timer = 0;
    this.ia_timer = 0;
    this.playerStart();
    this.iaStart();
  }
  SW.Duel = Duel;

  Duel.prototype.duelParams = function (isIa) {
    const me = this;
    return {
      width: E.DUEL_LEVEL_WIDTH,
      height: E.DUEL_LEVEL_HEIGHT,
      min: E.CHALLENGE_MIN_COMBO,
      gen_fruit_flags: function () { return me.genFruitFlags(isIa); },
      gen_fruit_color: function () { return me.genFruitColor(isIa); },
    };
  };

  Duel.prototype.send = function (from, fruit) {
    if (from === this.player) {
      if (this.pool_for_ia) this.pool.push(fruit);
      else {
        if (this.pool.length > 0) this.pool.splice(this.pool.length - 1, 1);
        else {
          this.pool.push(fruit);
          this.pool_for_ia = true;
        }
      }
    } else {
      if (this.pool_for_ia) {
        if (this.pool.length > 0) this.pool.splice(this.pool.length - 1, 1);
        else {
          this.pool.push(fruit);
          this.pool_for_ia = false;
        }
      } else this.pool.push(fruit);
    }
    this.interf.updatePool(this.pool, this.pool_for_ia);
  };
  Duel.prototype.sendTo = function (to, fruit) {
    if (to === this.player) this.send(this.ia, fruit);
    else this.send(this.player, fruit);
  };
  Duel.prototype.setPlLock = function (flag) {
    this.interf.setLock(flag);
    this.pl_lock = flag;
  };
  Duel.prototype.playerStart = function () {
    this.setPlLock(false);
    this.player_timer = E.DUEL_MAX_TIME[SW.Data.difficulty];
  };
  Duel.prototype.iaStart = function () {
    this.ia_lock = false;
    this.ia_timer = E.IA_TIMES[SW.Data.players[1]][0];
    this.ia.start();
  };
  Duel.prototype.genFruitFlags = function (isIa) {
    const isArmure = (random(10) === 0);
    const isNoswap = !isArmure && (random(40) === 0);
    let isStar;
    if (isIa) {
      isStar = !isArmure && !isNoswap && (--this.ia_star_counter === 0);
      if (isStar) this.ia_star_counter = E.DUEL_IA_STAR_COUNTER[SW.Data.difficulty];
    } else {
      isStar = !isArmure && !isNoswap && (--this.pl_star_counter === 0);
      if (isStar) this.pl_star_counter = E.DUEL_STAR_COUNTER;
    }
    return (isArmure ? E.FLAG_ARMURE : 0) | (isStar ? E.FLAG_STAR : 0) | (isNoswap ? E.FLAG_NOSWAP : 0);
  };
  Duel.prototype.genFruitColor = function () {
    return random(E.DUEL_MAX_COLORS);
  };
  Duel.prototype.getPool = function (pl) {
    if ((pl === this.ia && this.pool_for_ia) || (pl === this.player && !this.pool_for_ia)) {
      if (this.pool.length > 0) {
        if (this.pool_for_ia) this.iaface.setHit(30);
        else this.plface.setHit(30);
      }
      const p = this.pool;
      this.pool = [];
      this.interf.updatePool(this.pool, this.pool_for_ia);
      return p;
    }
    return [];
  };
  Duel.prototype.destroy = function () {
    this.player.destroy();
    this.ia.destroy();
    this.interf.destroy();
  };
  Duel.prototype.sendFruits = function (pl, c, p) {
    let nsend = E.sendFruitsCount(pl === this.ia, c, p, SW.Data.difficulty);
    while (nsend > 0) {
      this.send(pl, { col: random(E.DUEL_MAX_COLORS), flags: E.FLAG_ARMURE, x: -1 });
      nsend--;
    }
  };
  Duel.prototype.getPower = function (context, mc) {
    if (context === this.player) this.interf.addPower(0, mc);
    else this.interf.addPower(1, mc);
  };
  Duel.prototype.turnDone = function (pl) {
    if (this.game_over_flag) return;
    if (pl === this.player) {
      if (this.player.isGameOver() || (!this.player_special_combo && !this.player.genLine())) {
        this.game_over_flag = true;
        this.interf.gameOver(true);
        this.player.gameOver(false);
        this.ia.game_over_flag = false;
        this.plface.setDead(0xFFFFF);
        this.iaface.setHappy(0xFFFFF);
        SW.Manager.gameOver(0);
      } else {
        if (this.player.fallFruits()) {
          this.player_special_combo = true;
          return;
        }
        this.interf.lockAttack(false);
        this.player.updateSudden();
        this.player_special_combo = false;
        if (this.player.panic()) this.plface.panic();
        else this.plface.normal();
        this.playerStart();
      }
    } else {
      if (this.ia.isGameOver() || (!this.ia_special_combo && !this.ia.genLine())) {
        this.game_over_flag = true;
        this.interf.gameOver(false);
        this.plface.setHappy(0xFFFFF);
        this.iaface.setDead(0xFFFFF);
        this.ia.gameOver(false);
        this.player.game_over_flag = false;
        const g = SW.Manager.gameOver(1);
        if (SW.Data.gameMode === SW.Data.HISTORY)
          g.winTitem(TItem.histoItems());
        else if (SW.Data.gameMode === SW.Data.DUEL && SW.Data.difficulty === 4)
          g.winTitem(TItem.duelItem());
      } else {
        if (this.ia.fallFruits()) {
          this.ia_special_combo = true;
          return;
        }
        this.ia.updateSudden();
        this.ia_special_combo = false;
        if (this.ia.panic()) this.iaface.panic();
        else this.iaface.normal();
        this.iaStart();
      }
    }
  };
  Duel.prototype.gameClick = function () {
    if (this.pause.activated()) return;
    if (this.interf.handleClick(SW.mouse.x, SW.mouse.y)) return;
    if (this.pl_lock) return;
    const fpair = SW.pickPair(this.player);
    if (this.player.swapPair(fpair)) {
      SW.Manager.client.nswaps++;
      this.setPlLock(true);
    }
  };
  Duel.prototype.defend = function () {
    if (this.pause.activated()) return;
    if (!this.pl_lock && this.player.canDefend()) {
      this.setPlLock(true);
      this.player_special_combo = true;
      this.player.defend();
    }
  };
  Duel.prototype.attack = function () {
    if (this.pause.activated()) return;
    if (this.player.canAttack()) {
      this.interf.lockAttack(true);
      if (this.ia_lock)
        this.player.attack(this.ia, false);
      else {
        if (this.player.attack(this.ia, true)) {
          this.ia_lock = true;
          this.ia_special_combo = true;
        }
      }
    }
  };
  Duel.prototype.iaAttack = function () {
    if (this.ia.canAttack()) {
      this.interf.doAttack(1);
      if (this.pl_lock)
        this.ia.attack(this.player, false);
      else {
        if (this.ia.attack(this.player, true)) {
          this.setPlLock(true);
          this.player_special_combo = true;
        }
      }
    }
  };
  Duel.prototype.iaDefend = function () {
    if (!this.ia_lock && this.ia.canDefend()) {
      this.interf.doDefend(1);
      this.ia_lock = true;
      this.ia.reset();
      this.ia_special_combo = true;
      this.ia.defend();
    }
  };
  Duel.prototype.main = function (tmod, deltaT) {
    if (this.pause.main()) return;
    if (!this.pl_lock) {
      this.player_timer -= deltaT;
      if (this.player_timer <= 0) {
        this.setPlLock(true);
        this.player.skipTurn();
      }
    }
    this.player.main(tmod, deltaT);
    this.ia.main(tmod, deltaT);
    this.interf.main(tmod);
    if (!this.ia_lock) {
      const iaPair = this.ia.getIAPair();
      this.ia_timer -= deltaT;
      if (iaPair != null && this.ia_timer <= 0) {
        this.ia_lock = true;
        this.ia.swapPair(iaPair);
      }
    }
    let fpair = null;
    if (!this.pl_lock && !SW.mouse.outside)
      fpair = SW.pickPair(this.player);
    this.interf.displayPair(fpair);
  };
  Duel.prototype.draw = function (ctx) {
    this.interf.drawBack(ctx);
    this.player.animator.drawFruits(ctx, this.player.level);
    this.ia.animator.drawFruits(ctx, this.ia.level);
    this.player.animator.particules.draw(ctx);
    this.ia.animator.particules.draw(ctx);
    this.interf.drawFront(ctx);
    SW.drawPauseButton(ctx);
    this.pause.draw(ctx);
  };
  Duel.prototype.onClickDown = function () { this.gameClick(); };
})();
