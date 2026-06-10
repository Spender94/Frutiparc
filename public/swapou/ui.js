/*
 * Swapou 2 — couche d'affichage canvas : constantes visuelles (Data.as),
 * particules/FX (Particules.as), visages (Face.as), boutons du menu
 * (Rotator*.as, SimpleButton.as), indicateur de paire (fruitRollOver).
 */
'use strict';

const SwapouUI = (function () {
  const A = SwapouAssets;

  // ── Constantes visuelles (Data.as) ────────────────────────────────────────
  const D = {
    DOCWIDTH: 700, DOCHEIGHT: 480,
    GRAVITY_DELTA: 8, PARASITE_SPEED: 16,
    LOW: 1, MEDIUM: 2, HIGH: 3,
    MIN_SUPER_COMBO: 500,
    MAX_FX: 20, FX_GRAVITY: 1, FX_ALPHA_SPEED: 1, FX_SPEED: 8,
    FX_FRUIT_EXPLOSION: 3, FX_METAL_EXPLOSION: 5, FX_STAR_EXPLOSION: 4,
    FX_LIFETIME: 10, END_EXPLOSION_TIMER: 13, SPECIAL_Y: 124,
    CHALLENGE_X: 38, GAMEX: 182, GAMEY: -10, ROLLOVER_FACTOR: 1.0,
    COMBOSTAR_X: 636, COMBOSTAR_Y: 371, COMBOSTAR_SCALE: 40,
    COMBO_X: 380, COMBO_Y: 55,
    POWER_X: 145, POWER_Y: 254, DUEL_POWER_X: 54,
    POWER_HEIGHT: 27, POWER_SCALE: 70, POWER_JUMP_SCALE: 25,
    POWER_JUMP_CYCLES: 6, POWER_SPEED: 2.7, POWER_MAXSPEED: 13, MAX_POWER: 6,
    LEAVES_X: 124, LEAVES_Y: 107, DUEL_LEAVES_X: 33, DUEL_LEAVES_Y: 107,
    SCORE_SPEED: 9.57, SUDDEN_Y: 30,
    DUEL_PLX: 84, DUEL_PLY: -10, DUEL_IAX: 371, DUEL_IAY: -10,
    FACE_X: 10, FACE_Y: 480 - 123, FACE_WIDTH: 110, FACE_HEIGHT: 110,
    FACE_SPEED: 15, FACEBORDER_X: 10, FACEBORDER_Y: 11,
    DUEL_FACE_X: 3, DUEL_FACE_IA_X: 615, DUEL_FACE_Y: 3, DUEL_FACE_SCALE: 0.75,
    SPECIAL_TIMER: 60, SPECIAL_ATTACK_TIMER: 0,
    ATTDEF_ICON_X: 106, DUEL_ATTDEF_ICON_X: 15,
    MENU_FRUIT_X: 350, MENU_FRUIT_Y: 240, MENU_FRUIT_MOVE: 8,
    MENU_FRUIT_SCALE: 95, MENU_MOVE: 1,
    BUTTON_SPEED: 0.28, BUTTON_DELAY: 3, BUTTON_XMOVE: 180,
    BUTTON_X: 355, BUTTON_Y: 150, BUTTON_HEIGHT: 49,
    CHAR_SCALE: 100, FACES_BY_LINE: 3,
    ROTATOR_FACE_WIDTH: 62, ROTATOR_FACE_HEIGHT: 62,
    ROTATOR_FACE_X: 293, ROTATOR_FACE_Y: 180, TITLE_Y: 120,
    FRUIT_WIDTH: 35, FRUIT_HEIGHT: 35,
    EMOTE_NORMAL: 1, EMOTE_PANIC: 2, EMOTE_COLERE: 3, EMOTE_PEUR: 4,
    EMOTE_HAPPY: 5, EMOTE_DEAD: 6,
    CHALLENGE_HAPPY_SCORE: 300, CHALLENGE_HAPPY_TIME: 100,
    DUEL_TURN_FRUITS: 7,
    // phases d'animation
    A_EXPLODE: 1, A_GRAVITY: 2, A_SWAP: 3, A_FALL: 4, A_GAMEOVER: 5, A_SPECIAL: 6,
    FORWARD: 1, BACKWARD: 2, PINGPONG: 3,
  };

  let lod = D.HIGH;

  function random(n) { return Math.floor(Math.random() * n); }

  // ── helpers dessin ────────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCentered(ctx, img, cx, cy, scale) {
    if (!img || !img.naturalWidth) return;
    const s = scale == null ? 1 : scale;
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }

  // texte style jeu (Verdana bold + contour sombre optionnel)
  function text(ctx, str, x, y, opt) {
    opt = opt || {};
    ctx.save();
    ctx.font = (opt.bold === false ? '' : 'bold ') + (opt.size || 13) + 'px Verdana,Arial,sans-serif';
    ctx.textAlign = opt.align || 'center';
    ctx.textBaseline = opt.baseline || 'middle';
    if (opt.stroke) {
      ctx.lineWidth = opt.strokeWidth || 3;
      ctx.strokeStyle = opt.stroke;
      ctx.lineJoin = 'round';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = opt.color || '#fff';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  // découpe un texte en lignes ≤ maxW
  function wrapText(ctx, str, maxW, font) {
    ctx.save();
    ctx.font = font;
    const out = [];
    String(str).split('\n').forEach(function (para) {
      const words = para.split(' ');
      let line = '';
      for (let i = 0; i < words.length; i++) {
        const tryLine = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(tryLine).width > maxW && line) {
          out.push(line);
          line = words[i];
        } else line = tryLine;
      }
      out.push(line);
    });
    ctx.restore();
    return out;
  }

  // ── couleurs des fruits (particules) ─────────────────────────────────────
  const FRUIT_COLORS = ['#e8542c', '#9fce30', '#f5a623', '#a06ee0', '#4aa3e8',
    '#e84a8a', '#7ddb6f', '#f0e040', '#40c8c0', '#c08050', '#8090a0'];

  // ── Particules (Particules.as) ────────────────────────────────────────────
  function Particules() {
    this.fxList = [];
    this.generate = this._generate; // mis à undefined pour l'IA (lod LOW)
  }

  Particules.prototype.attachFx = function (link, x, y, opts) {
    const mc = {
      kind: link, x: x, y: y, frame: 0, curFrame: 1,
      totalFrames: (opts && opts.totalFrames) || 12,
      animMode: D.FORWARD, managers: [animManager], kill: false,
      alpha: 1, scaleX: 1, scaleY: 1,
      data: opts || {},
    };
    this.fxList.push(mc);
    return mc;
  };

  Particules.prototype.explodeFruit = function (x, y, color) {
    let total = D.FX_FRUIT_EXPLOSION;
    if (lod === D.MEDIUM) total = Math.round(total / 2);
    if (lod === D.LOW || !this.generate) return;
    for (let i = 0; i < total; i++)
      this.generate(x + D.FRUIT_WIDTH / 2, y + D.FRUIT_HEIGHT / 2, 1, color);
  };
  Particules.prototype.explodeMetal = function (x, y) {
    let total = D.FX_METAL_EXPLOSION;
    if (lod === D.MEDIUM) total = Math.round(total / 2);
    if (lod === D.LOW || !this.generate) return;
    for (let i = 0; i < total; i++)
      this.generate(x + D.FRUIT_WIDTH / 2, y + D.FRUIT_HEIGHT / 2, random(3) + 4);
  };
  Particules.prototype.explodeFrozen = function (x, y) {
    let total = D.FX_METAL_EXPLOSION;
    if (lod === D.MEDIUM) total = Math.round(total / 2);
    if (lod === D.LOW || !this.generate) return;
    for (let i = 0; i < total; i++)
      this.generate(x + D.FRUIT_WIDTH / 2, y + D.FRUIT_HEIGHT / 2, random(3) + 7);
  };
  Particules.prototype.explodeStar = function (x, y) {
    let total = D.FX_STAR_EXPLOSION;
    if (lod === D.MEDIUM) total = Math.round(total / 2);
    if (lod === D.LOW || !this.generate) return;
    for (let i = 0; i < total; i++)
      this.generate(x, y, random(2) + 2);
  };
  Particules.prototype.heavyExplosion = function (x, y, dx, dy) {
    let total = Math.round(D.FX_STAR_EXPLOSION * 2.5);
    if (lod === D.MEDIUM) total = Math.round(total / 2);
    if (lod === D.LOW || !this.generate) return;
    for (let i = 0; i < total; i++) {
      const mc = this.generate(x, y, 1);
      if (mc !== undefined) {
        mc.dx = dx * random(100) / 100;
        mc.dy = dy * random(100) / 100;
      }
    }
  };

  Particules.prototype._generate = function (x, y, frame, color) {
    if (this.fxList.length >= D.MAX_FX) return undefined;
    const mc = {
      kind: 'particule', x: x, y: y, frame: frame, color: color,
      rot: random(360), scale: (random(60) + 40) / 100,
      alpha: 1, dalpha: 0, kill: false,
      dx: (random(2) * 2 - 1) * (random(D.FX_SPEED * 100) / 100 + 1),
      dy: -(random(D.FX_SPEED * 2 * 100) / 100 + 1),
      dr: 0,
      lifeTime: lod === D.HIGH ? D.FX_LIFETIME : 0,
      managers: [fallManager],
    };
    if (lod === D.HIGH) mc.dr = mc.dx < 0 ? -D.FX_SPEED * 2 : D.FX_SPEED * 2;
    this.fxList.push(mc);
    return mc;
  };

  function fallManager(mc, tmod) {
    mc.rot += tmod * mc.dr;
    mc.x += mc.dx * tmod;
    mc.y += mc.dy * tmod;
    mc.alpha -= mc.dalpha * tmod / 100;
    mc.dy += D.FX_GRAVITY * tmod;
    if (mc.lifeTime > 0) mc.lifeTime -= tmod;
    else {
      mc.dalpha += D.FX_ALPHA_SPEED * tmod;
      if (mc.alpha <= 0) mc.kill = true;
    }
  }

  function animManager(mc, tmod) {
    if (mc.waitBack !== undefined && mc.waitBack > 0) {
      mc.waitBack -= tmod;
      return;
    }
    mc.frame += tmod;
    while (mc.frame >= 1) {
      if (mc.animMode === D.BACKWARD) mc.curFrame--;
      else mc.curFrame++;
      mc.frame--;
    }
    if (mc.animMode === D.BACKWARD && mc.curFrame <= 1) mc.kill = true;
    if (mc.animMode === D.FORWARD && mc.curFrame >= mc.totalFrames) mc.kill = true;
    if (mc.animMode === D.PINGPONG && mc.curFrame >= mc.totalFrames) {
      mc.waitBack = 30;
      mc.animMode = D.BACKWARD;
    }
  }

  Particules.prototype.main = function (tmod) {
    for (let i = 0; i < this.fxList.length; i++) {
      const mc = this.fxList[i];
      for (let m = 0; m < mc.managers.length; m++) mc.managers[m](mc, tmod);
      if (mc.kill) {
        this.fxList.splice(i, 1);
        i--;
      }
    }
  };

  function sinManager(mc, tmod) {
    if (mc.sinCpt === undefined) { mc.sinCpt = 0; mc.x0 = mc.x; }
    mc.sinCpt += 0.4 * tmod;
    mc.x = mc.x0 + Math.sin(mc.sinCpt) * 7;
  }

  Particules.prototype.draw = function (ctx) {
    for (let i = 0; i < this.fxList.length; i++) drawFx(ctx, this.fxList[i]);
  };

  function drawFx(ctx, mc) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, mc.alpha));
    const t = mc.curFrame / mc.totalFrames; // progression 0..1
    switch (mc.kind) {
      case 'particule': {
        ctx.translate(mc.x, mc.y);
        ctx.rotate(mc.rot * Math.PI / 180);
        ctx.scale(mc.scale, mc.scale);
        let col = '#ffd23f';
        if (mc.frame === 1) col = mc.color || '#e8542c';            // morceau de fruit
        else if (mc.frame >= 2 && mc.frame <= 3) col = '#ffd23f';   // étoile
        else if (mc.frame >= 4 && mc.frame <= 6) col = '#9aa2ab';   // métal
        else col = '#bfe8ff';                                       // glace
        ctx.fillStyle = col;
        if (mc.frame >= 2 && mc.frame <= 3) { // éclat d'étoile
          ctx.beginPath();
          for (let k = 0; k < 5; k++) {
            const a = -Math.PI / 2 + k * 2 * Math.PI / 5;
            const a2 = a + Math.PI / 5;
            ctx.lineTo(Math.cos(a) * 6, Math.sin(a) * 6);
            ctx.lineTo(Math.cos(a2) * 2.6, Math.sin(a2) * 2.6);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(-4, 2); ctx.lineTo(0, -5); ctx.lineTo(4, 2);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'explosion': { // flash circulaire à la destruction d'un fruit
        const r = 6 + mc.curFrame * 2.2;
        ctx.globalAlpha *= Math.max(0, 1 - t);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(mc.x, mc.y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'getPowerStar': { // flash d'étoile au gain de pouvoir
        ctx.translate(mc.x, mc.y);
        ctx.rotate(t * 1.2);
        ctx.globalAlpha *= Math.max(0, 1 - t);
        const img = A.img('powerStar');
        const s = 1 + t * 1.6;
        if (img) ctx.drawImage(img, -18 * s, -18.5 * s, 36 * s, 37 * s);
        break;
      }
      case 'strike': { // éclair vertical de l'écarteur
        ctx.globalAlpha *= Math.max(0, 1 - t);
        ctx.fillStyle = '#fff';
        ctx.fillRect(mc.x - 3 - t * 8, 0, 6 + t * 16, D.DOCHEIGHT);
        break;
      }
      case 'defense': { // bannière du nom d'attaque/défense (PINGPONG)
        const txt = mc.data.text || '';
        const k = Math.min(1, mc.curFrame / 5);
        ctx.translate(mc.x, mc.y);
        ctx.scale(k, k);
        ctx.font = 'bold 24px Verdana,Arial,sans-serif';
        const w = ctx.measureText(txt).width + 46;
        const grad = ctx.createLinearGradient(0, -26, 0, 26);
        grad.addColorStop(0, '#ffd23f');
        grad.addColorStop(1, '#f08c00');
        roundRect(ctx, -w / 2, -26, w, 52, 24);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#7a4a00';
        ctx.stroke();
        ctx.fillStyle = '#7a3000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, 0, 1);
        break;
      }
      case 'scorePop': { // score flottant d'une explosion
        const big = mc.data.big;
        ctx.translate(mc.x, mc.y - mc.curFrame * 1.6);
        ctx.globalAlpha *= mc.curFrame > mc.totalFrames * 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.4) : 1;
        text(ctx, String(mc.data.text), 0, 0, {
          size: big ? 26 : 18,
          color: big ? '#fff04a' : '#ffffff',
          stroke: '#5a3000', strokeWidth: 4,
        });
        break;
      }
      case 'swapAnim': { // échange de deux fruits (arc au-dessus/dessous)
        const p = Math.min(1, mc.curFrame / mc.totalFrames);
        const d = mc.data;
        const lift = Math.sin(p * Math.PI) * 9;
        const ix1 = d.img1, ix2 = d.img2;
        const x1 = d.x1 + (d.x2 - d.x1) * p, y1 = d.y1 + (d.y2 - d.y1) * p - lift;
        const x2 = d.x2 + (d.x1 - d.x2) * p, y2 = d.y2 + (d.y1 - d.y2) * p + lift;
        if (ix2) ctx.drawImage(ix2, x2 - 1.5, y2 - 1.5, 38, 38);
        if (ix1) ctx.drawImage(ix1, x1 - 1.5, y1 - 1.5, 38, 38);
        break;
      }
    }
    ctx.restore();
  }

  Particules.prototype.destroy = function () { this.fxList = []; };

  // ── Visage (Face.as) ─────────────────────────────────────────────────────
  // états : 0 normal, 1 panique, 2 colère, 3 peur, 4 joie, 5 mort
  const FACE_BGS = [
    ['#9fd4f5', '#3d7fc1'], // 0 calme (ciel)
    ['#9aa0ad', '#3c4250'], // 1 sombre (défaite)
    ['#f59a8a', '#b8322a'], // 2 touché (rouge)
    ['#ffe98a', '#f0a020'], // 3 joie (soleil)
    ['#ffb060', '#d84810'], // 4 attaque (feu)
    ['#e8e0cc', '#a09878'], // 5 neutre
  ];

  function Face(charId) {
    this.skinId = charId || 0;
    this.stateId = 0;
    this.bgId = 0;
    this.normalBg = 0;
    this.normalState = 0;
    this.currentState = 0;
    this.shake = 0;
    this.timer = 0;
    this.flipped = false;
    this.fakeAlpha = 0;
    this.fakeSkin = 0; this.fakeState = 0;
    this.shakeX = 0; this.shakeY = 0;
    this.visible = true;
  }
  Face.prototype.flip = function () { this.flipped = true; this.normalBg = 1; this.setBg(0, 1); };
  Face.prototype._duplicate = function () {
    this.fakeSkin = this.skinId;
    this.fakeState = this.stateId;
    this.fakeAlpha = 100;
  };
  Face.prototype.setBg = function (t, id) { this.timer = t; this._duplicate(); this.bgId = id; };
  Face.prototype.setSkin = function (id) { this._duplicate(); this.skinId = id; };
  Face.prototype._setFace = function (skinId, stateId, bgId) {
    this._duplicate();
    this.skinId = skinId; this.stateId = stateId; this.bgId = bgId;
  };
  Face.prototype.shakeItBaby = function (t) { this.shake = t; };
  Face.prototype.reset = function () {
    this.currentState = this.normalState;
    this._setFace(this.skinId, this.normalState, this.normalBg);
    if (this.shake > 0) this.shake = 1;
  };
  Face.prototype.setAngry = function (t) { this.timer = t; this._setFace(this.skinId, 2, 4); this.currentState = 2; };
  Face.prototype.setHappy = function (t) { this.timer = t; this._setFace(this.skinId, 4, 3); this.currentState = 4; };
  Face.prototype.setDead = function (t) { this.timer = t; this._setFace(this.skinId, 5, 1); this.currentState = 5; };
  Face.prototype.setAttack = function (t) { this.timer = t; this._setFace(this.skinId, 2, 4); this.currentState = 2; };
  Face.prototype.setHit = function (t) { this.timer = t; this._setFace(this.skinId, 3, 2); this.currentState = 3; this.shakeItBaby(t); };
  Face.prototype.normal = function () { this.normalState = 0; };
  Face.prototype.panic = function () { this.normalState = 1; };
  Face.prototype.update = function (tmod) {
    if (this.timer > 0) {
      this.timer -= tmod;
      if (this.timer <= 0) { this.timer = 0; this.reset(); }
    }
    if (this.timer === 0 && this.currentState !== this.normalState) this.reset();
    if (this.fakeAlpha > 0) {
      this.fakeAlpha -= tmod * D.FACE_SPEED;
      if (this.fakeAlpha < 0) this.fakeAlpha = 0;
    }
    if (this.shake > 0) {
      this.shake -= tmod;
      if (this.shake <= 0) { this.shakeX = 0; this.shakeY = 0; }
      else {
        this.shakeX = random(10) / 10 * (random(2) * 2 - 1);
        this.shakeY = random(10) / 10 * (random(2) * 2 - 1);
      }
    }
  };
  // dessine la face dans une boîte size×size en (x,y)
  Face.prototype.draw = function (ctx, x, y, size, opts) {
    if (!this.visible) return;
    const s = size || D.FACE_WIDTH;
    ctx.save();
    roundRect(ctx, x, y, s, s, 6);
    ctx.clip();
    drawFaceContent(ctx, this.skinId, this.stateId, this.bgId, x + this.shakeX, y + this.shakeY, s, this.flipped, 1);
    if (this.fakeAlpha > 0)
      drawFaceContent(ctx, this.fakeSkin, this.fakeState, 5, x, y, s, this.flipped, this.fakeAlpha / 100);
    ctx.restore();
    if (opts && opts.frame !== false) {
      const ft = A.img('faceTop');
      if (ft) ctx.drawImage(ft, x - D.FACEBORDER_X * s / D.FACE_WIDTH, y - D.FACEBORDER_Y * s / D.FACE_HEIGHT,
        130 * s / D.FACE_WIDTH, 133 * s / D.FACE_HEIGHT);
    }
  };

  function drawFaceContent(ctx, skinId, stateId, bgId, x, y, s, flipped, alpha) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    const bg = FACE_BGS[bgId] || FACE_BGS[0];
    const grad = ctx.createRadialGradient(x + s / 2, y + s * 0.38, s * 0.1, x + s / 2, y + s / 2, s * 0.75);
    grad.addColorStop(0, bg[0]);
    grad.addColorStop(1, bg[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, s, s);
    const img = A.img('face' + skinId + '_' + stateId);
    if (img && img.naturalWidth) {
      // art 182×131 env. : cadrage « buste » ancré en bas de boîte
      const sc = (s / img.naturalHeight) * 1.04;
      const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
      ctx.translate(x + s / 2, y + s);
      if (flipped) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h, w, h);
    }
    ctx.restore();
  }

  // tête seule (médaillon menu / dialogues) — recadrage haut de l'art
  function drawFaceMedallion(ctx, charId, cx, cy, r, opts) {
    opts = opts || {};
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const grad = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.2, cx, cy, r * 1.2);
    grad.addColorStop(0, opts.locked ? '#5a6a8a' : '#bfe2f8');
    grad.addColorStop(1, opts.locked ? '#243048' : '#4d8bc8');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const img = A.img('face' + charId + '_' + (opts.state || 0));
    if (img && img.naturalWidth) {
      const sc = (r * 2 / img.naturalHeight) * 1.15;
      const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
      if (opts.locked) ctx.filter = 'brightness(0.25) saturate(0.3)';
      ctx.drawImage(img, cx - w / 2, cy - r + r * 0.16, w, h);
      ctx.filter = 'none';
    }
    ctx.restore();
    ctx.save();
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = opts.locked ? '#3a4a6a' : '#8a5a2a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── Rotator (Rotator.as) : entité orbitant autour du fruit du menu ───────
  function Rotator(menu, x, y, delay, help) {
    this.menu = menu;
    this.x = x; this.y = y;
    this.help = help;
    this.cpt = Math.PI;
    this.phase = 'show';
    this.stable = false;
    this.kill = false;
    this.isOver = false;
    this.active = true;
    this.locked = false;
    this.alpha = 1;
    this.delay = delay;
    this.wait = 10 + delay * D.BUTTON_DELAY;
    this.visible = false;
    this.xMove = D.BUTTON_XMOVE;
    this.speed = D.BUTTON_SPEED;
    this.curX = x; this.curY = y; this.scale = 0.4;
    this.behind = true;
    this.hoverFrame = 0;
  }
  Rotator.prototype.hide = function () {
    this.isOver = false;
    if (this.stable) { this.wait = this.delay * 5; this.stable = false; }
    this.phase = 'hide';
  };
  Rotator.prototype.enable = function () { this.active = true; this.alpha = 1; };
  Rotator.prototype.disable = function () { this.active = false; this.alpha = 0.5; };
  Rotator.prototype.lock = function () { this.locked = true; };
  Rotator.prototype.unlock = function () { this.locked = false; };
  Rotator.prototype.updatePos = function () {
    this.curX = Math.sin(this.cpt) * this.xMove + this.x;
    this.curY = Math.cos(this.cpt) * 20 + this.y;
    this.scale = (Math.cos(this.cpt) * 30 + 70) / 100;
  };
  Rotator.prototype.move = function (tmod) {
    if (this.wait > 0) {
      this.wait -= tmod;
      if (this.wait <= 0) { this.wait = 0; this.visible = true; }
    }
    if (!this.stable && this.wait === 0) {
      switch (this.phase) {
        case 'show':
          this.cpt += this.speed * tmod;
          if (this.cpt >= Math.PI * 2.03) this.phase = 'bump';
          break;
        case 'bump':
          this.cpt -= this.speed * 0.3 * tmod;
          if (this.cpt <= Math.PI * 2) { this.cpt = Math.PI * 2; this.stable = true; }
          break;
        case 'hide':
          this.cpt += this.speed * tmod;
          if (this.cpt >= Math.PI * 3) { this.stable = true; this.kill = true; }
          break;
      }
      if (this.behind && this.cpt >= Math.PI * 1.5) this.behind = false;
      if (!this.behind && this.cpt >= Math.PI * 2.5) this.behind = true;
    }
    // anim de rollover (avance de frame → pulsation)
    if (this.isOver && this.active && !this.locked) this.hoverFrame = Math.min(this.hoverFrame + tmod, 6);
    else this.hoverFrame = Math.max(this.hoverFrame - tmod, 0);
  };
  Rotator.prototype.setOver = function (over) {
    if (over && !this.isOver && this.stable) {
      A.play(A.MENU_ACTIVATE);
      this.menu.help(this.help);
    }
    if (!over && this.isOver) this.menu.hideHelp();
    this.isOver = over;
  };

  // bouton texte du menu (RotatorButton.as)
  function RotatorButton(menu, yLine, label, linkId, help) {
    Rotator.call(this, menu, D.BUTTON_X, yLine * D.BUTTON_HEIGHT + D.BUTTON_Y, yLine, help);
    this.yId = Math.floor(yLine);
    this.label = label;
    this.linkId = linkId;
    this.isBack = linkId < 0;
    this.releaseCallback = null;
    this.w = 230; this.h = 40;
  }
  RotatorButton.prototype = Object.create(Rotator.prototype);
  RotatorButton.prototype.hitTest = function (mx, my) {
    if (!this.visible || !this.stable) return false;
    const w = this.w * this.scale, h = this.h * this.scale;
    return mx >= this.curX - w / 2 && mx <= this.curX + w / 2 &&
      my >= this.curY - h / 2 && my <= this.curY + h / 2;
  };
  RotatorButton.prototype.release = function () {
    if (!this.active || this.locked) return;
    A.play(A.MENU_CLICK);
    if (this.releaseCallback) this.releaseCallback();
    this.menu.onButtonSelect(this.linkId, this.yId);
  };
  RotatorButton.prototype.draw = function (ctx) {
    if (!this.visible) return;
    this.updatePos();
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.curX, this.curY);
    const bump = 1 + this.hoverFrame * 0.012;
    ctx.scale(this.scale * bump, this.scale * bump);
    const w = this.w, h = this.h;
    // plaque de bois (style levelBox), texte vert comme l'original
    const plate = A.img('levelBox');
    if (plate && plate.naturalWidth) {
      const cap = 18;
      ctx.drawImage(plate, 0, 0, cap, 46, -w / 2, -h / 2, cap, h);
      ctx.drawImage(plate, cap, 0, 107 - cap * 2, 46, -w / 2 + cap, -h / 2, w - cap * 2, h);
      ctx.drawImage(plate, 107 - cap, 0, cap, 46, w / 2 - cap, -h / 2, cap, h);
    } else {
      const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      grad.addColorStop(0, '#e8b269'); grad.addColorStop(0.5, '#c08540'); grad.addColorStop(1, '#92602a');
      roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#5d3c14';
      ctx.stroke();
    }
    text(ctx, this.label, 0, 1, {
      size: 17,
      color: this.isBack ? '#2f6b16' : '#3a7a1a',
      stroke: '#fff3d8', strokeWidth: 3,
    });
    ctx.restore();
  };

  // visage sélectionnable du menu (RotatorFace.as)
  function RotatorFace(menu, gridPos, faceId, linkId, help) {
    const yf = Math.floor(gridPos / D.FACES_BY_LINE);
    const xf = Math.floor(gridPos - yf * D.FACES_BY_LINE);
    let x = D.ROTATOR_FACE_X + xf * D.ROTATOR_FACE_WIDTH;
    let y = D.ROTATOR_FACE_Y + yf * D.ROTATOR_FACE_HEIGHT;
    if (xf === Math.floor(D.FACES_BY_LINE * 0.5)) y -= D.ROTATOR_FACE_HEIGHT * 0.5;
    Rotator.call(this, menu, x, y, gridPos * 0.5, help);
    this.saveHelp = help;
    this.linkId = linkId;
    this.faceId = faceId;
    this.xMove *= 0.8;
    this.r = 27;
  }
  RotatorFace.prototype = Object.create(Rotator.prototype);
  RotatorFace.prototype.disable = function () {
    this.active = false;
    this.help = '?????';
  };
  RotatorFace.prototype.enable = function () {
    this.active = true;
    this.help = this.saveHelp;
  };
  RotatorFace.prototype.hitTest = function (mx, my) {
    if (!this.visible || !this.stable) return false;
    const r = this.r * this.scale + 4;
    const dx = mx - this.curX, dy = my - this.curY;
    return dx * dx + dy * dy <= r * r;
  };
  RotatorFace.prototype.release = function () {
    if (!this.active || this.locked) return;
    A.play(A.MENU_CLICK);
    this.menu.onFaceSelect(this.linkId, this.faceId);
  };
  RotatorFace.prototype.draw = function (ctx) {
    // case verte arrondie (vide si perso verrouillé), cf. capture d'époque
    if (!this.visible) return;
    this.updatePos();
    ctx.save();
    const bump = 1 + this.hoverFrame * 0.018;
    const s = this.scale * bump;
    ctx.translate(this.curX, this.curY);
    ctx.scale(s, s);
    const r = this.r + 2;
    const grad = ctx.createLinearGradient(0, -r, 0, r);
    if (this.active) {
      grad.addColorStop(0, '#9ccb4a');
      grad.addColorStop(1, '#5f9a23');
    } else {
      grad.addColorStop(0, '#86b13e');
      grad.addColorStop(1, '#557f22');
    }
    roundRect(ctx, -r, -r, r * 2, r * 2, 9);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#c9a248';
    ctx.stroke();
    if (this.active) {
      ctx.save();
      roundRect(ctx, -r + 3, -r + 3, r * 2 - 6, r * 2 - 6, 7);
      ctx.clip();
      const img = A.img('face' + this.faceId + '_0');
      if (img && img.naturalWidth) {
        const sc = (r * 2 / img.naturalHeight) * 1.18;
        ctx.drawImage(img, -img.naturalWidth * sc / 2, -r + 4, img.naturalWidth * sc, img.naturalHeight * sc);
      }
      ctx.restore();
    }
    ctx.restore();
  };

  // ── bouton-icône attaque/défense (SimpleButton + powerIcon) ──────────────
  function IconButton(imgName, cb) {
    this.imgName = imgName;
    this.cb = cb;
    this.x = 0; this.y = 0;
    this.active = true;
    this.isOver = false;
    this.hoverFrame = 0;
    this.visible = true;
  }
  IconButton.prototype.enable = function () { this.active = true; };
  IconButton.prototype.disable = function () { this.active = false; };
  IconButton.prototype.update = function (tmod) {
    if (this.isOver && this.active) this.hoverFrame = Math.min(this.hoverFrame + tmod, 5);
    else this.hoverFrame = Math.max(this.hoverFrame - tmod, 0);
  };
  IconButton.prototype.hitTest = function (mx, my) {
    return this.visible && mx >= this.x - 6 && mx <= this.x + 53 && my >= this.y - 6 && my <= this.y + 41;
  };
  IconButton.prototype.release = function () { if (this.active && this.visible) this.cb(); };
  IconButton.prototype.draw = function (ctx) {
    if (!this.visible) return;
    const img = A.img(this.imgName);
    ctx.save();
    ctx.globalAlpha = this.active ? 1 : 0.5;
    const b = 1 + this.hoverFrame * 0.03;
    if (img) {
      ctx.translate(this.x + 23.5, this.y + 17.5);
      ctx.scale(b, b);
      ctx.drawImage(img, -23.5, -17.5);
    }
    ctx.restore();
  };

  // ── indicateur de paire (fruitRollOver) ──────────────────────────────────
  function Rollover() {
    this.visible = false;
    this.x = 0; this.y = 0; this.rot = 0;
    this.tx = 0; this.ty = 0; this.tr = 0;
    this.blocked = false;
    this.lockText = null;
  }
  Rollover.prototype.setPair = function (p, geo, hlock) {
    if (p == null || p.f1 == null || p.f2 == null) { this.visible = false; return; }
    this.visible = true;
    let tx, ty, tr = 0;
    const f1s = p.f1.spr, f2s = p.f2.spr;
    if (p.dx >= 0) { tx = f1s.x; ty = f1s.y; }
    else { tx = f2s.x; ty = f2s.y; }
    if (p.dy > 0) { tr = 90; tx += D.FRUIT_HEIGHT; }
    else if (p.dy < 0) { tr = 90; tx += D.FRUIT_HEIGHT; ty -= D.FRUIT_HEIGHT; }
    this.tx = tx; this.ty = ty; this.tr = tr;
    this.x += (this.tx - this.x) * D.ROLLOVER_FACTOR;
    this.y += (this.ty - this.y) * D.ROLLOVER_FACTOR;
    this.rot += (this.tr - this.rot) * D.ROLLOVER_FACTOR;
    if (p.f1.canSwap() && p.f2.canSwap() && (p.dy !== 0 || hlock === 0)) {
      this.blocked = false;
      this.lockText = null;
    } else {
      this.blocked = true;
      this.lockText = (hlock > 0 && p.dy === 0) ? String(Math.floor(hlock)) : null;
    }
  };
  Rollover.prototype.draw = function (ctx) {
    if (!this.visible) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot * Math.PI / 180);
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.blocked ? 'rgba(190,190,190,0.9)' : '#ffd23f';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 3;
    roundRect(ctx, 1, 1, D.FRUIT_WIDTH * 2 - 2, D.FRUIT_HEIGHT - 2, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(D.FRUIT_WIDTH, 3);
    ctx.lineTo(D.FRUIT_WIDTH, D.FRUIT_HEIGHT - 3);
    ctx.stroke();
    if (this.blocked) {
      ctx.strokeStyle = 'rgba(220,60,60,0.95)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(8, 8); ctx.lineTo(D.FRUIT_WIDTH * 2 - 8, D.FRUIT_HEIGHT - 8);
      ctx.moveTo(D.FRUIT_WIDTH * 2 - 8, 8); ctx.lineTo(8, D.FRUIT_HEIGHT - 8);
      ctx.stroke();
    }
    ctx.restore();
    if (this.lockText != null)
      text(ctx, this.lockText, this.x + D.FRUIT_WIDTH, this.y - 10, { size: 14, color: '#ff5050', stroke: '#400000', strokeWidth: 3 });
  };

  return {
    D: D, FRUIT_COLORS: FRUIT_COLORS,
    getLod: function () { return lod; },
    setLod: function (v) { lod = v; },
    random: random, roundRect: roundRect, drawCentered: drawCentered,
    text: text, wrapText: wrapText,
    Particules: Particules, sinManager: sinManager,
    Face: Face, drawFaceMedallion: drawFaceMedallion,
    Rotator: Rotator, RotatorButton: RotatorButton, RotatorFace: RotatorFace,
    IconButton: IconButton, Rollover: Rollover,
  };
})();
