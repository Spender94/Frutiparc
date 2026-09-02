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

  // ── Décalage de couleur additif (le CXFORM de Flash) ─────────────────────
  //
  // Les pulsations de survol du menu ne changent pas de dessin : elles AJOUTENT
  // du rouge et du vert aux couleurs du clip (c' = c + décalage), ce qui fait
  // virer la plaque verte au doré et allume la tuile d'un personnage. Le canvas
  // n'a pas cette opération : on passe donc par un calque, où l'on ajoute la
  // couleur (« lighter » sature aussi l'alpha) avant de redécouper le tout à
  // l'alpha du dessin (« destination-in »).
  //
  // Sans décalage — le cas de repos, donc l'immense majorité des dessins — on
  // peint directement, sans calque.
  let calque = null, calqueCtx = null;
  function avecDecalage(ctx, r, v, b, x, y, w, h, dessiner) {
    // Sans décalage — ou sans DOM pour tenir le calque — on peint tel quel.
    if ((r < 0.5 && v < 0.5 && b < 0.5) || typeof document === 'undefined'
      || !ctx.getTransform) { dessiner(ctx); return; }
    /*
     * LE CALQUE NE FAIT QUE LA TAILLE DU DESSIN.
     *
     * Il faisait celle du CANEVAS, et les trois opérations de composition
     * (peindre, ajouter la couleur, découper) balayaient donc 700 × 480 fois
     * la densité d'écran — plus d'un million de pixels, trois fois, pour un
     * bouton de 161 × 35. Sur le menu, cela coûtait une image sur trois : la
     * pulsation du survol avançait par à-coups et le bouton semblait
     * CLIGNOTER, alors que le calcul, lui, était juste. (Mesuré : 28 images
     * sur 85 au-delà de 25 ms sous la souris, zéro ailleurs.)
     *
     * On calcule donc la boîte du dessin dans le repère du canevas — les
     * quatre coins passés par la matrice courante — et l'on ne travaille que
     * là. Le calque est gardé d'un appel à l'autre et ne fait que grandir.
     */
    peindreSurCalque(ctx, x, y, w, h, dessiner, function (c, bx, by, bw, bh) {
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = 'rgb(' + Math.round(r) + ',' + Math.round(v) + ',' + Math.round(b) + ')';
      c.fillRect(bx, by, bw, bh);
      c.globalCompositeOperation = 'destination-in';
      dessiner(c);
    });
  }

  /*
   * L'ÉCLAT BLANC — la transformation de couleur des « flashs » du SWF.
   *
   * Flash l'écrit en multiplicateur + terme additif ; relevée sur la
   * comboStar (sprite #81), la paire vaut toujours `m + a ≈ 256` — autrement
   * dit une interpolation VERS LE BLANC, de rapport `1 − m/256`. On la refait
   * telle quelle : le dessin, puis du blanc en `source-atop`, qui ne peint que
   * là où il y a déjà quelque chose.
   */
  function avecEclat(ctx, t, x, y, w, h, dessiner) {
    if (t <= 0.002 || typeof document === 'undefined' || !ctx.getTransform) {
      dessiner(ctx); return;
    }
    peindreSurCalque(ctx, x, y, w, h, dessiner, function (c, bx, by, bw, bh) {
      c.globalCompositeOperation = 'source-atop';
      c.globalAlpha = Math.min(1, t);
      c.fillStyle = '#ffffff';
      c.fillRect(bx, by, bw, bh);
      c.globalAlpha = 1;
    });
  }

  // Le calque de travail, borné au dessin (cf. avecDecalage) : `dessiner` peint
  // dedans, `finir` y applique l'effet, et le tout est recollé sur la scène.
  function peindreSurCalque(ctx, x, y, w, h, dessiner, finir) {
    const cible = ctx.canvas;
    const m = ctx.getTransform();
    const marge = 8;
    const bx = x - marge, by = y - marge, bw = w + marge * 2, bh = h + marge * 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]) {
      const dx = m.a * px + m.c * py + m.e;
      const dy = m.b * px + m.d * py + m.f;
      if (dx < x0) x0 = dx;
      if (dy < y0) y0 = dy;
      if (dx > x1) x1 = dx;
      if (dy > y1) y1 = dy;
    }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(cible.width, Math.ceil(x1)); y1 = Math.min(cible.height, Math.ceil(y1));
    const lw = x1 - x0, lh = y1 - y0;
    if (lw <= 0 || lh <= 0) return;              // hors écran : rien à peindre
    if (!calque) { calque = document.createElement('canvas'); calqueCtx = null; }
    if (calque.width < lw || calque.height < lh) {
      calque.width = Math.max(calque.width, lw);
      calque.height = Math.max(calque.height, lh);
      calqueCtx = calque.getContext('2d');
    }
    if (!calqueCtx) calqueCtx = calque.getContext('2d');
    calqueCtx.setTransform(1, 0, 0, 1, 0, 0);
    calqueCtx.clearRect(0, 0, lw, lh);
    // Le repère du dessin, décalé pour que la boîte tombe en (0,0) du calque.
    calqueCtx.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
    calqueCtx.globalCompositeOperation = 'source-over';
    calqueCtx.globalAlpha = 1;
    dessiner(calqueCtx);
    finir(calqueCtx, bx, by, bw, bh);
    calqueCtx.globalCompositeOperation = 'source-over';
    ctx.save();
    const a = ctx.globalAlpha;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = a;
    ctx.drawImage(calque, 0, 0, lw, lh, x0, y0, lw, lh);
    ctx.restore();
  }

  function drawCentered(ctx, img, cx, cy, scale) {
    if (!img || !img.naturalWidth) return;
    const s = scale == null ? 1 : scale;
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }

  // texte style jeu (Verdana bold + contour sombre optionnel).
  // `opt.font` bascule sur une des fontes embarquées du SWF : « banana » pour
  // les libellés de boutons et de titres, « impact » pour la barre d'aide.
  const FONTES = {
    banana: '"PT Banana Split",Verdana,Arial,sans-serif',
    impact: '"Impact SW",Impact,"Arial Narrow",Arial,sans-serif',
  };
  function text(ctx, str, x, y, opt) {
    opt = opt || {};
    ctx.save();
    ctx.font = (opt.bold === false || opt.font ? '' : 'bold ') + (opt.size || 13) + 'px '
      + (FONTES[opt.font] || 'Verdana,Arial,sans-serif');
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
  //
  // Le symbole `face` du SWF (sprite #328) est une fenêtre de 110×110 : un fond
  // (`bg`, dont chaque frame est un fond différent) puis le portrait (`char`),
  // posé au CENTRE de la fenêtre — Face.as le dit lui-même, sub.char._x =
  // FACE_WIDTH*0.5. Les deux premiers fonds sont les dégradés d'origine
  // (formes #211 et #212) ; les suivants sont des compositions animées
  // (rayons, étincelles) qu'on approche par un dégradé de mêmes tons.
  const FACE_BGS = [
    ['#b1c26b', '#87913e'], // 0 calme — dégradé olive de la forme #211
    ['#ea3939', '#620b0b'], // 1 rouge — forme #212 (mort)
    ['#f59a8a', '#b8322a'], // 2 touché
    ['#ffe98a', '#f0a020'], // 3 joie
    ['#ffb060', '#d84810'], // 4 colère / attaque
    ['#e8e0cc', '#a09878'], // 5 neutre (fondu du « fake »)
  ];

  // Où chaque portrait se pose dans la fenêtre de 110×110, en pixels depuis son
  // coin haut-gauche. Ces valeurs sont RELEVÉES sur le SWF (recalage image par
  // image de l'écran de choix de personnage) : chaque dessin a sa propre taille
  // et son propre cadrage dans la bibliothèque du .fla, il n'y a pas de règle
  // qui s'en déduise. Le sel et le poivre ont en plus un corps commun.
  const FACE_POS = [
    { x: -53, y: -1 },   // 0 Dimitri  (182×132)
    { x: -9, y: 9 },     // 1 Natacha  (119×109)
    { x: 47, y: 21, base: { x: -9, y: 1 } },   // 2 Sel     (yeux 53×40 sur un corps 126×117)
    { x: 37, y: 17, base: { x: -9, y: 1 } },   // 3 Poivre  (yeux 62×43, même corps)
    { x: -9, y: -1 },    // 4 Moutarde (139×134)
    { x: 13, y: -25 },   // 5 Piment   (65×188)
    { x: -7, y: -7 },    // 6 Wasabi   (127×123)
  ];

  // Teinte des personnages VERROUILLÉS, telle que RotatorFace.disable l'écrit :
  // multiplicateurs à zéro et décalages (106, 134, −51) — donc toute la boîte du
  // portrait, transparence comprise (aa=100, ab=100), devient ce vert plat.
  const FACE_VERROU = '#6a8600';

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
  // dessine la face dans une boîte size×size en (x,y). `opts.cadre` choisit le
  // cadre : 'faceTop' en jeu, 'menuFaceTop' sur l'écran de choix de personnage
  // (le même bois, mais avec les feuilles vertes des coins).
  Face.prototype.draw = function (ctx, x, y, size, opts) {
    if (!this.visible) return;
    opts = opts || {};
    const s = size || D.FACE_WIDTH;
    ctx.save();
    roundRect(ctx, x, y, s, s, 6);
    ctx.clip();
    drawFaceContent(ctx, this.skinId, this.stateId, this.bgId,
      x + this.shakeX, y + this.shakeY, s, this.flipped, 1, opts.verrou);
    if (this.fakeAlpha > 0)
      drawFaceContent(ctx, this.fakeSkin, this.fakeState, 5, x, y, s, this.flipped, this.fakeAlpha / 100);
    ctx.restore();
    if (opts.frame !== false) {
      const ft = A.img(opts.cadre || 'faceTop');
      if (ft) ctx.drawImage(ft, x - D.FACEBORDER_X * s / D.FACE_WIDTH, y - D.FACEBORDER_Y * s / D.FACE_HEIGHT,
        130 * s / D.FACE_WIDTH, 133 * s / D.FACE_HEIGHT);
    }
  };

  function drawFaceContent(ctx, skinId, stateId, bgId, x, y, s, flipped, alpha, verrou) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    const bg = FACE_BGS[bgId] || FACE_BGS[0];
    // Fond : dégradé vertical, comme les formes #211/#212 du SWF.
    const grad = ctx.createLinearGradient(x, y, x, y + s);
    grad.addColorStop(0, bg[0]);
    grad.addColorStop(1, bg[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, s, s);
    // Le portrait est posé à sa place d'origine dans la fenêtre de 110, à sa
    // taille naturelle ; on suit l'échelle de la boîte demandée.
    const k = s / D.FACE_WIDTH;
    const pos = FACE_POS[skinId] || { x: 0, y: 0 };
    ctx.translate(x + s / 2, y);
    if (flipped) ctx.scale(-1, 1);
    // Verrouillé : toute la boîte du portrait vire au vert plat — transparence
    // comprise, ce qui remplit la fenêtre entière (cf. FACE_VERROU).
    if (verrou) {
      ctx.fillStyle = FACE_VERROU;
      ctx.fillRect(-s / 2, 0, s, s);
      ctx.restore();
      return;
    }
    const poser = (img, p) => {
      if (!img || !img.naturalWidth) return;
      ctx.drawImage(img, (p.x - D.FACE_WIDTH / 2) * k, p.y * k,
        img.naturalWidth * k, img.naturalHeight * k);
    };
    if (pos.base) poser(A.img('face' + skinId + '_base'), pos.base);
    poser(A.img('face' + skinId + '_' + stateId), pos);
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
    // Frame de la pulsation de survol. Le SWF ne fait pas un « état survolé » :
    // Rotator*.update avance d'une frame par tour tant que le curseur est là,
    // et revient à 1 en fin de bande — c'est donc une boucle. Hors survol, la
    // bande FINIT son tour au lieu de s'arrêter net (cf. le `else if`).
    this.frame = 1;
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
    // Pulsation de survol : une frame par tour, retour à 1 en fin de bande.
    const n = this.nbFrames || 1;
    if ((this.isOver && this.active && !this.locked) || this.frame > 1) {
      this.frame += tmod;
      if (this.frame >= n) this.frame = 1;
    }
  };
  Rotator.prototype.setOver = function (over) {
    if (over && !this.isOver && this.stable) {
      A.play(A.MENU_ACTIVATE);
      this.menu.help(this.help);
    }
    if (!over && this.isOver) this.menu.hideHelp();
    this.isOver = over;
  };

  // ── Pulsation du bouton de menu (sprite #206 du SWF) ─────────────────────
  //
  // Treize frames, relevées telles quelles dans la timeline : une bosse
  // d'échelle qui monte à 1,15 puis retombe, un léger glissement vers le bas,
  // et une transformation de couleur ADDITIVE (rouge et vert montent, le bleu
  // ne bouge pas) — c'est elle qui fait virer la plaque du vert au doré.
  const BT_ECHELLE = [1, 1.02, 1.1175, 1.15, 1.1481, 1.1426, 1.1333, 1.1204,
    1.1037, 1.0833, 1.0592, 1.0315, 1];
  const BT_DY = [1.1, 1.2, 1.6, 1.7, 1.65, 1.65, 1.65, 1.55, 1.5, 1.4, 1.3, 1.2, 1.1];
  const BT_ROUGE = [0, 0, 86, 115, 114, 109, 102, 92, 80, 64, 45, 24, 0];
  const BT_VERT = [0, 0, 38, 51, 50, 48, 45, 41, 35, 28, 20, 11, 0];
  // La plaque d'origine (formes #202 vert / #204 orange), au pixel près.
  const BT_L = 161.45, BT_H = 34.8, BT_HAUT = 16.4;
  // Le champ texte du bouton est posé ÉTIRÉ en hauteur dans le SWF — sa matrice
  // vaut 1 en x et 1,5512 en y. D'où des lettres hautes et serrées, qu'un
  // simple choix de corps ne reproduit pas.
  // Corps et ligne de base calés sur le rendu du SWF, à un pixel près.
  const BT_TEXTE_ETIRE = 1.5512, BT_TEXTE_CORPS = 20, BT_TEXTE_Y = -1.3;

  // bouton texte du menu (RotatorButton.as)
  function RotatorButton(menu, yLine, label, linkId, help) {
    Rotator.call(this, menu, D.BUTTON_X, yLine * D.BUTTON_HEIGHT + D.BUTTON_Y, yLine, help);
    this.yId = Math.floor(yLine);
    this.label = label;
    this.linkId = linkId;
    // sub.gotoAndStop(2) quand linkId < 0 : les boutons « retour » sont orange.
    this.isBack = linkId < 0;
    this.releaseCallback = null;
    this.nbFrames = BT_ECHELLE.length;
  }
  RotatorButton.prototype = Object.create(Rotator.prototype);
  // La bosse de survol, interpolée entre deux frames de la bande.
  RotatorButton.prototype.pulse = function () {
    const f = Math.max(0, Math.min(BT_ECHELLE.length - 1.001, this.frame - 1));
    const i = Math.floor(f), k = f - i;
    const m = (t) => t[i] + (t[i + 1] - t[i]) * k;
    return { s: m(BT_ECHELLE), dy: m(BT_DY), r: m(BT_ROUGE), v: m(BT_VERT) };
  };
  RotatorButton.prototype.hitTest = function (mx, my) {
    if (!this.visible || !this.stable) return false;
    const p = this.pulse();
    const s = this.scale * p.s;
    // La plaque n'est pas centrée sur son point d'ancrage : elle descend de
    // 18,4 sous lui et ne monte que de 16,4 (la lèvre sombre du bas).
    const haut = this.curY + p.dy * s - BT_HAUT * s;
    return mx >= this.curX - BT_L * s / 2 && mx <= this.curX + BT_L * s / 2 &&
      my >= haut && my <= haut + BT_H * s;
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
    const p = this.pulse();
    const s = this.scale * p.s;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.curX, this.curY + p.dy * s);
    ctx.scale(s, s);
    const plaque = A.img(this.isBack ? 'menuBoutonRetour' : 'menuBouton');
    // Le décalage de couleur du survol s'applique à la plaque ET au libellé :
    // dans le SWF c'est le clip entier qui porte la transformation.
    avecDecalage(ctx, p.r, p.v, 0, -BT_L / 2, -BT_HAUT, BT_L, BT_H, function (c) {
      if (plaque && plaque.naturalWidth) c.drawImage(plaque, -BT_L / 2, -BT_HAUT, BT_L, BT_H);
      // Le libellé est blanc, dans la fonte embarquée « PT Banana Split ».
      c.save();
      c.scale(1, BT_TEXTE_ETIRE);
      text(c, this.label, 0, BT_TEXTE_Y, { size: BT_TEXTE_CORPS, color: '#ffffff', font: 'banana' });
      c.restore();
    }.bind(this));
    ctx.restore();
  };

  // ── Pulsation de la tuile de personnage (sprite #332 du SWF) ─────────────
  //
  // Onze frames, et cette fois PAS de bosse d'échelle : seulement un coup de
  // rouge sur le contenu de la tuile, qui monte très haut (+255) puis retombe.
  const TUILE_ROUGE = [0, 28, 113, 255, 187, 130, 83, 47, 21, 5, 0];
  const TUILE_VERT = [0, 6, 24, 55, 40, 28, 18, 10, 4, 1, 0];
  // La tuile est le symbole `face` (fenêtre de 110, cadre de 130×133 en
  // (−65, −66,5)) posé à la MOITIÉ de sa taille.
  const TUILE_ECHELLE = 0.5;

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
    this.face = new Face(faceId);
    this.nbFrames = TUILE_ROUGE.length;
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
    // La zone sensible est le CADRE de la tuile, pas un disque : les cases se
    // touchent, et c'est ainsi qu'on peut viser celle du milieu.
    const d = D.FACE_WIDTH * TUILE_ECHELLE * this.scale / 2;
    return mx >= this.curX - d && mx <= this.curX + d &&
      my >= this.curY - d && my <= this.curY + d;
  };
  RotatorFace.prototype.release = function () {
    if (!this.active || this.locked) return;
    A.play(A.MENU_CLICK);
    this.menu.onFaceSelect(this.linkId, this.faceId);
  };
  RotatorFace.prototype.draw = function (ctx) {
    if (!this.visible) return;
    this.updatePos();
    const f = Math.max(0, Math.min(TUILE_ROUGE.length - 1.001, this.frame - 1));
    const i = Math.floor(f), k = f - i;
    const r = TUILE_ROUGE[i] + (TUILE_ROUGE[i + 1] - TUILE_ROUGE[i]) * k;
    const v = TUILE_VERT[i] + (TUILE_VERT[i + 1] - TUILE_VERT[i]) * k;
    const s = D.FACE_WIDTH * TUILE_ECHELLE * this.scale;   // côté de la fenêtre
    const x = this.curX - s / 2, y = this.curY - s / 2;
    const me = this;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    // Le coup de rouge du survol ne touche que le CONTENU (depth 1 du sprite) —
    // le cadre de bois et ses feuilles restent tels quels.
    avecDecalage(ctx, r, v, 0, x, y, s, s, function (c) {
      me.face.draw(c, x, y, s, { frame: false, verrou: !me.active });
    });
    const cadre = A.img('menuFaceTop');
    if (cadre) ctx.drawImage(cadre,
      x - D.FACEBORDER_X * s / D.FACE_WIDTH, y - D.FACEBORDER_Y * s / D.FACE_HEIGHT,
      130 * s / D.FACE_WIDTH, 133 * s / D.FACE_HEIGHT);
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
    text: text, wrapText: wrapText, avecEclat: avecEclat,
    Particules: Particules, sinManager: sinManager,
    Face: Face, drawFaceMedallion: drawFaceMedallion,
    Rotator: Rotator, RotatorButton: RotatorButton, RotatorFace: RotatorFace,
    IconButton: IconButton, Rollover: Rollover,
  };
})();
