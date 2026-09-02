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
    /*
     * LA SILHOUETTE COLORÉE, AJOUTÉE AU DESSIN.
     *
     * On ajoutait la couleur sur toute la boîte du calque (« lighter »), puis
     * on redécoupait à la forme du dessin (« destination-in » en redessinant).
     * Or cette découpe n'opère pas : Chrome ne tient pas compte du mode de
     * composition quand l'image dessinée est un SVG. La boîte ENTIÈRE du
     * bouton se peignait donc en doré opaque pendant les onze images de la
     * pulsation, et redevenait normale deux images — c'est le clignotement
     * que les joueurs voyaient sur les boutons du menu et les tuiles de
     * personnages.
     *
     * On fait l'inverse, avec un seul remplissage : le dessin est peint une
     * seconde fois sur un calque frère, réduit à sa forme par un remplissage
     * « source-in » de la couleur (un rectangle, pas une image : ce mode-là
     * est sûr), et cette silhouette s'AJOUTE au dessin (« lighter »). La
     * couleur ne va que là où il y a du dessin, et sa transparence suit celle
     * des bords.
     */
    peindreSurCalque(ctx, x, y, w, h, dessiner, function (c, bx, by, bw, bh) {
      const bis = calqueBis(c);
      bis.setTransform(c.getTransform());
      bis.globalCompositeOperation = 'source-over';
      bis.globalAlpha = 1;
      dessiner(bis);
      bis.globalCompositeOperation = 'source-in';
      bis.fillStyle = 'rgb(' + Math.round(r) + ',' + Math.round(v) + ',' + Math.round(b) + ')';
      bis.fillRect(bx, by, bw, bh);
      bis.globalCompositeOperation = 'source-over';
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'lighter';
      c.drawImage(bis.canvas, 0, 0);
      c.restore();
    });
  }

  // Le calque frère du calque de travail : même taille, vidé à chaque appel.
  let calque2 = null, calque2Ctx = null;
  function calqueBis(c) {
    const l = c.canvas.width, h = c.canvas.height;
    if (!calque2) { calque2 = document.createElement('canvas'); calque2Ctx = null; }
    if (calque2.width !== l || calque2.height !== h) {
      calque2.width = l;
      calque2.height = h;
      calque2Ctx = calque2.getContext('2d');
    }
    if (!calque2Ctx) calque2Ctx = calque2.getContext('2d');
    calque2Ctx.setTransform(1, 0, 0, 1, 0, 0);
    calque2Ctx.clearRect(0, 0, l, h);
    return calque2Ctx;
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
  // les libellés de boutons et de titres, « impact » pour la barre d'aide et
  // le bandeau des pouvoirs, « cipher » pour le score du parchemin, « doom »
  // pour les chiffres de la partie (chaîne, score flottant, blocage).
  const FONTES = {
    banana: '"PT Banana Split",Verdana,Arial,sans-serif',
    impact: '"Impact SW",Impact,"Arial Narrow",Arial,sans-serif',
    cipher: '"Cipher SW","Courier New",monospace',
    doom: '"DooM SW",Impact,"Arial Narrow",Arial,sans-serif',
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

  /* ── LES FORMES DES CLIPS D’EFFETS, RELEVÉES SUR LE SWF ─────────────────────
   *
   * Tout ce qui suit est le tracé du fichier, en pixels, dans le repère du clip
   * qui le porte (origine = point d’ancrage). Chaque forme est une liste de
   * [couleur, opacité, chemin M/L/Q/Z]. Ces dessins sont repris en chemins
   * plutôt qu’en images parce qu’il faut les DÉCOUPER, les TEINTER ou les
   * MASQUER image par image — le disque de l’explosion tourne et grossit, le
   * reflet d’un fruit est masqué par sa silhouette, les rayons du visage
   * grandissent depuis un point.
   *
   *   particule1..9   le clip « particule » (#66) : 1 éclat BLANC de fruit —
   *                   pas de la couleur du fruit —, 2-3 éclats jaune/orange
   *                   d’étoile, 4-6 morceaux de roche (armure), 7-9 éclats
   *                   blancs de glace
   *   explosion       le disque blanc du clip « explosion » (#70, sub image 1)
   *   explosionGel    son anneau (sub image 2), pour les fruits gelés
   *   etoile          l’étoile blanche (#366) de flyingStar et getPowerStar
   *   eclat*          les reflets des fruits étoile (#172) et gelés (#182) :
   *                   la silhouette qui masque, le trait qui balaie, le flash
   *   plaque*         les deux plaques noires à 35 % du score flottant (#138)
   *   rayon           un rayon blanc du fond « colère » du visage (#224)
   */
  const FORMES = compilerFormes({
    particule1: [   // #57
      ["#ffffff", 1, "M-4.1 3.75L-1.65 -4.6L4.6 3.75L-4.1 3.75Z"],
    ],
    particule2: [   // #58
      ["#ffff00", 1, "M-4 3.75L-1.6 -4.55L4.65 3.75L-4 3.75Z"],
    ],
    particule3: [   // #59
      ["#ffa428", 1, "M-4 3.75L-1.6 -4.55L4.65 3.75L-4 3.75Z"],
    ],
    particule4: [   // #60
      ["#574532", 1, "M6 -2.25L6.3 -3.05Q3.8 -6.75 4.9 -2.05L5.2 -1.95Q5.65 -1.95 6 -2.25ZM10.05 1.3L8.9 5.2L7.05 3.25L-5.1 7.35L-10 4.05Q-8.45 -0.6 -4.1 -4Q0.45 -7.55 5.3 -7.3L9 -5.65L8.65 -0.65L10.05 1.3ZM-6.65 1.65Q-5.05 7.15 1 0.6Q2.2 -0.75 2 -2.5L-0.65 -4.35L-3.75 -3L-6.65 1.65Z"],
      ["#a88762", 1, "M5.2 -1.95L4.9 -2.05Q3.8 -6.75 6.3 -3.05Q4.55 -4.25 5.05 -2.15L5.2 -1.95ZM-1.7 -0.85L-3.75 -3L-0.65 -4.35L2 -2.5Q2.2 -0.75 1 0.6Q-5.05 7.15 -6.65 1.65L-3.55 2.55L-1.7 -0.85Z"],
      ["#f1ecb7", 1, "M6.3 -3.05L6 -2.25Q5.65 -1.95 5.2 -1.95L5.05 -2.15Q4.55 -4.25 6.3 -3.05ZM-3.75 -3L-1.7 -0.85L-3.55 2.55L-6.65 1.65L-3.75 -3Z"],
    ],
    particule5: [   // #61
      ["#b0916a", 1, "M-1.1 -1.9L2.35 -1.8L2.5 -1Q2.4 4.45 -1.65 1.8L-1.1 -1.9Z"],
      ["#5e4a36", 1, "M-4 -0.3Q-4.15 2.75 -1.65 1.8Q2.4 4.45 2.5 -1L2.35 -1.8L-1.1 -1.9L-3.9 -1.15L-4 -0.3ZM-6.3 -5.9L-0.6 -5.45L5.05 -2.5L8.3 1.3L6.4 4.3L-2.75 5.95L-6.9 -1.45L-8.25 -2.9L-8.1 -4.75L-6.3 -5.9Z"],
      ["#f2edb9", 1, "M-1.65 1.8Q-4.15 2.75 -4 -0.3L-3.9 -1.15L-1.1 -1.9L-1.65 1.8Z"],
    ],
    particule6: [   // #62
      ["#927454", 1, "M-6.3 2.7L-6.25 1.2Q-4.8 1.2 -3.8 0.5Q-2.8 -0.2 -2.8 -1.15Q-2.8 -2.15 -3.8 -2.8Q-4.85 -3.5 -6.3 -3.45L-3.1 -5.35L-0.75 -3.2L-2.4 6.4L-5.75 4.45Q-6.2 3.65 -6.3 2.7ZM1.7 -4.25L3 -7.45Q5.1 -9.1 6.6 -7.3Q7.65 -2.45 2.4 -0.7L1.7 -4.25Z"],
      ["#584532", 1, "M-4.4 10.55L-5.75 4.45L-2.4 6.4L-0.75 -3.2L-3.1 -5.35L-6.3 -3.45L-7.05 -0.45L-6.25 1.2L-6.3 2.7L-9.45 1Q-7.6 -6.6 1 -8.4L3.65 -10.55L9.45 -5.2L6.9 1.05L3.85 1L0.6 3.9L1.85 8.2L-4.4 10.55ZM3 -7.45Q-0.15 -8.4 1.3 -4.15L1.7 -4.25L2.4 -0.7Q7.65 -2.45 6.6 -7.3Q5.1 -9.1 3 -7.45Z"],
      ["#f2ecb7", 1, "M-6.25 1.2L-7.05 -0.45L-6.3 -3.45Q-4.85 -3.5 -3.8 -2.8Q-2.8 -2.15 -2.8 -1.15Q-2.8 -0.2 -3.8 0.5Q-4.8 1.2 -6.25 1.2ZM1.3 -4.15Q-0.15 -8.4 3 -7.45L1.7 -4.25L1.3 -4.15Z"],
    ],
    particule7: [   // #63
      ["#ffffff", 1, "M4.85 -8.05L6.75 -6.5L3.5 2.1L-1.3 3.7L-2.4 6.4L-5.75 4.45L-6.55 -2.4L-3.1 -5.35L-1.55 -3.95L0.95 -5.5L1.55 -7.5L4.85 -8.05ZM1.3 1.15Q4.7 -1.55 1.5 -3.85L-4.1 0.6L0.15 1.85L1.3 1.15Z"],
    ],
    particule8: [   // #64
      ["#ffffff", 1, "M4.75 -4Q8.3 0.15 7.2 5.1L4.95 6.6L0.85 8.1L-6.2 -0.9L-1.95 -7.75L-1.8 -7.9Q-0.55 -8.55 0.85 -7.55Q3.05 -6 4.75 -4ZM5.95 3.6L-0.35 -5.6L-4.4 -0.7L1 6.05L5.95 3.6Z"],
    ],
    particule9: [   // #65
      ["#ffffff", 1, "M-5.55 -3.1L1.85 -5.85L6 -4.3L7.2 -2.35Q8.4 0.3 7.15 3Q6.35 4.75 5.15 6.05L-6 3L-3.95 0.05L-5.55 -3.1ZM4.95 2.9L5.75 -2.05L1.5 3.1L4.95 2.9ZM2.55 -2.45L-3.9 -2.5L-2.2 0.45Q-0.6 3.2 2.55 -2.45Z"],
    ],
    explosion: [   // #67
      ["#ffffff", 1, "M12.35 -12.4Q17.5 -7.25 17.5 0Q17.5 7.25 12.35 12.35Q7.25 17.5 0 17.5Q-7.25 17.5 -12.4 12.35Q-17.5 7.25 -17.5 0Q-17.5 -7.25 -12.4 -12.4Q-7.25 -17.5 0 -17.5Q7.25 -17.5 12.35 -12.4Z"],
    ],
    explosionGel: [   // #68
      ["#ffffff", 1, "M15.5 3.55Q15.5 -2.3 11.35 -6.45Q7.2 -10.55 1.35 -10.55Q-4.5 -10.55 -8.65 -6.45Q-12.8 -2.3 -12.8 3.55Q-12.8 9.4 -8.65 13.55Q-5.55 16.65 -1.45 17.45Q-7.75 17 -12.4 12.35Q-17.5 7.25 -17.5 0Q-17.5 -7.25 -12.4 -12.4Q-7.25 -17.5 0 -17.5Q7.25 -17.5 12.35 -12.4Q17.5 -7.25 17.5 0Q17.5 7 12.7 12Q15.5 8.35 15.5 3.55Z"],
    ],
    plaque: [   // #134
      ["#000000", 0.35, "M-17.3 -9.1L17.4 -9.1Q18.85 -9.1 19.9 -8.05Q20.85 -7.1 21 -5.85L21 5.55Q21 7 19.9 8.05Q18.85 9.15 17.4 9.15L-17.3 9.15Q-18.8 9.15 -19.9 8.05Q-20.95 7 -20.95 5.55L-20.95 -5.85L-20.9 -5.85Q-20.8 -7.1 -19.9 -8.05Q-18.8 -9.1 -17.3 -9.1Z"],
    ],
    plaqueLarge: [   // #136
      ["#000000", 0.35, "M35.25 -8.1Q36.2 -7.15 36.35 -5.9L36.35 5.55Q36.35 7.05 35.25 8.1Q34.2 9.2 32.75 9.2L-32.65 9.2Q-34.15 9.2 -35.25 8.1Q-36.3 7.05 -36.3 5.55L-36.3 -5.9Q-36.15 -7.15 -35.25 -8.1Q-34.15 -9.15 -32.65 -9.15L32.75 -9.15Q34.2 -9.15 35.25 -8.1Z"],
    ],
    eclatMasqueEtoile: [   // #169
      ["#cccc00", 1, "M11.05 -7.35Q13 -6.45 14.65 -5.2Q16.3 -4 15.65 -1.7Q15 0.55 11.95 6.05L12 14.9Q9.4 18.6 4.9 15.6Q0.4 12.55 -3.75 15Q-7.95 17.45 -10.3 16.2Q-12.7 14.95 -11.05 9.85Q-9.4 4.75 -11.6 2.8Q-13.85 0.85 -15.3 -2.6Q-16.8 -6.1 -12.15 -6.9Q-7.5 -7.75 -5.75 -11.2Q-4 -14.7 -0.1 -16.05Q3.75 -17.45 7.05 -8.65Q9.05 -8.25 11.05 -7.35Z"],
    ],
    eclatTrait: [   // #170
      ["#ffffff", 1, "M20.05 -5.55L-17 18.6L-17.55 17.1L18.15 -7.75L20.05 -5.55ZM16 -10.35L-18.05 15.75L-20 10.25L8.9 -18.65L16 -10.35Z"],
    ],
    eclatMasqueGel: [   // #179
      ["#cc9900", 1, "M15 -0.7Q15 5.8 10.35 10.4Q5.75 15.05 -0.75 15.05Q-7.25 15.05 -11.9 10.4Q-16.5 5.8 -16.5 -0.7Q-16.5 -7.2 -11.9 -11.85Q-7.25 -16.45 -0.75 -16.45Q5.75 -16.45 10.35 -11.85Q15 -7.2 15 -0.7Z"],
    ],
    eclatFlash: [   // #180
      ["#ffffff", 0.5, "M12.65 -12.65Q17.9 -7.4 17.9 0Q17.9 7.4 12.65 12.65Q7.4 17.9 0 17.9Q-7.4 17.9 -12.65 12.65Q-17.9 7.4 -17.9 0Q-17.9 -7.4 -12.65 -12.65Q-7.4 -17.9 0 -17.9Q7.4 -17.9 12.65 -12.65Z"],
    ],
    rayon: [   // #224
      ["#ffffff", 1, "M-23.8 -20.65L-55 -47.8L-55 -55L-47.8 -55L-22.05 -25.35L-20.65 -23.7L-20.6 -20.6L-23.8 -20.65Z"],
      ["#ffffff", 0.2, "M-14.1 -16.2L-6.5 -7.45L-6.5 -6.5L-7.5 -6.5L-16.25 -14.1L-14.1 -14.1L-14.1 -16.2Z"],
      ["#ffffff", 0.5, "M-20.65 -23.7L-14.1 -16.2L-14.1 -14.1L-16.25 -14.1L-23.8 -20.65L-20.6 -20.6L-20.65 -23.7Z"],
    ],
    etoile: [   // #366
      ["#ffffff", 1, "M2.05 -17.5L2.1 -17.45Q3 -16.8 3.4 -15.7L3.4 -15.6L6.2 -7L15.4 -7Q16.5 -7 17.45 -6.3Q18.35 -5.65 18.7 -4.55Q19.05 -3.5 18.7 -2.4L18.7 -2.35Q18.3 -1.35 17.45 -0.65L10.05 4.75L12.85 13.45L12.9 13.55Q13.2 14.6 12.85 15.6L11.7 17.3L11.6 17.35Q10.65 18 9.55 18.05Q8.4 18 7.5 17.35L0.05 12L-7.35 17.4Q-8.3 18.05 -9.4 18.05Q-10.55 18.05 -11.45 17.4L-11.55 17.3Q-12.4 16.65 -12.75 15.65Q-13.1 14.55 -12.75 13.45L-9.9 4.75L-17.3 -0.65L-17.35 -0.65Q-18.2 -1.35 -18.55 -2.35L-18.6 -2.4Q-18.95 -3.5 -18.6 -4.55Q-18.25 -5.65 -17.3 -6.3Q-16.4 -7 -15.25 -7L-6.1 -7L-3.3 -15.6L-3.25 -15.7Q-2.9 -16.8 -2 -17.45Q-1.1 -18.1 0.05 -18.1Q1.15 -18.1 2.05 -17.5Z"],
    ],
  });
  function compilerFormes(t) {
    const out = {};
    for (const k in t) out[k] = t[k].map((f) => [f[0], f[1], cheminSwf(f[2])]);
    return out;
  }
  // Découpe le contexte à la première pièce d’une forme (le masque d’un clip).
  function decouperForme(ctx, forme) {
    tracerChemin(ctx, forme[0][2], 0, 0);
    ctx.clip('evenodd');
  }
  // Peint une forme compilée à l’origine courante (alpha multiplié).
  function tracerForme(ctx, forme) {
    for (let i = 0; i < forme.length; i++) {
      const f = forme[i];
      tracerChemin(ctx, f[2], 0, 0);
      ctx.fillStyle = f[0];
      if (f[1] < 1) { const a = ctx.globalAlpha; ctx.globalAlpha = a * f[1]; ctx.fill('evenodd'); ctx.globalAlpha = a; }
      else ctx.fill('evenodd');
    }
  }

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

  /* ── LES PELLICULES DES CLIPS D'EFFETS ─────────────────────────────────────
   *
   * Relevées image par image sur le SWF. Un clip posé par attachFx démarre à
   * son image 1 et MEURT EN ATTEIGNANT sa dernière image (Particules.as,
   * animManager) : celle-ci n'est jamais peinte. Les tables ci-dessous ont donc
   * autant d'entrées que le clip a d'images, et la dernière ne sert qu'à
   * compter.
   */
  // « explosion » (#70) : le disque blanc (#67) — l'anneau (#68) pour un fruit
  // gelé — qui grossit en tournant, puis se referme d'un coup. [échelle, rotation]
  const EXPLOSION = [[1, 0], [1.233, -157.5], [1.3995, 90], [1.4994, 22.5], [1.5327, 0],
    [1.3839, -40.1], [0.9455, -160.2], [0.2137, 0]];
  // « getPowerStar » (#369) : l'étoile blanche qui enfle jusqu'à 2,75 fois en
  // s'effaçant — au bout du vol d'une étoile, ou sur le fruit quand la jauge
  // est pleine. Pas de rotation, pas d'étoile dorée. [échelle, alpha]
  const GET_POWER_STAR = [[1, 1], [1.3674, 0.789], [1.6916, 0.605], [1.9726, 0.445],
    [2.2103, 0.309], [2.4049, 0.199], [2.5561, 0.109], [2.6642, 0.051], [2.729, 0.012], [2.7507, 0]];
  // « flyingStar » (#368) : la même étoile, qui tourne d'un cinquième de tour
  // en six images — elle a cinq branches, la boucle est invisible. [dx, dy, rotation]
  const FLYING_STAR = [[0, -0.05, 0], [0.3, 0.15, 14.3], [0.6, 0.35, 28.8], [0.9, 0.6, 43.1],
    [1.2, 0.8, 57.7], [1.5, 1, 72]];
  // « strike » (#389) : trois barres blanches de 13 × 480 posées à mi-hauteur —
  // deux qui s'écartent en s'amincissant, une qui s'élargit au centre puis
  // disparaît à la dixième image. [écart, échelle des côtés, échelle du centre]
  const STRIKE = [[0, 1, 1], [22.35, 0.8563, 2.6294], [42.8, 0.725, 3.1726], [61.25, 0.6062, 3.0881],
    [77.8, 0.5, 2.8347], [92.35, 0.4062, 2.4123], [105, 0.325, 1.821], [115.7, 0.2562, 1.0608],
    [124.45, 0.2, 0.1316], [131.25, 0.1562, 0], [136.1, 0.125, 0], [139.05, 0.1062, 0], [140, 0.1, 0]];
  // « defense » (#361) : le bandeau — la plaque de titre du menu, forme #358 —
  // qui descend de 27 px en s'opacifiant ; le mode PINGPONG le tient trente
  // images puis le remonte. Le nom est en Impact 16, crème. [dy, alpha]
  const BANDEAU = [[-27, 0], [-20.65, 0.234], [-15.2, 0.4375], [-10.55, 0.609], [-6.75, 0.75],
    [-3.8, 0.859], [-1.7, 0.9375], [-0.4, 0.984], [0, 1]];
  // « scorePop » (#138) : le score sur sa plaque noire, qui s'envole en
  // accélérant — 103 px en trente images — et s'efface sur les cinq dernières.
  const SCORE_POP = [0, -0.1, -0.45, -1.05, -1.85, -2.95, -4.2, -5.75, -7.5, -9.5, -11.7, -14.15,
    -16.85, -19.8, -22.95, -26.35, -30, -33.85, -37.95, -42.25, -46.85, -51.65, -56.7, -61.95,
    -67.45, -74.6, -81.7, -88.85, -95.95, -103.1];
  const SCORE_POP_ALPHA = [0.801, 0.602, 0.398, 0.199, 0];   // images 26 à 30
  /* « swapRight / swapDown / swapLeft / swapUp » (#189 à #192) : L'ÉCHANGE.
   *
   * Le portage faisait glisser les deux fruits l'un vers l'autre en arc, en
   * sept images. Le clip d'époque fait tout autre chose, en douze : le fruit
   * BLANCHIT (transformation de couleur vers le blanc, dès la troisième
   * image), S'ÉTIRE vers sa case d'arrivée jusqu'à couvrir les deux cases (le
   * double de sa largeur à la sixième image), se RÉTRACTE dans la nouvelle
   * case, puis retrouve ses couleurs sur trois images. L'échelle part du coin
   * haut-gauche du fruit — c'est l'ancrage du clip, et c'est ce qui fait que
   * l'étirement « pousse » vers l'arrivée. Droite et bas s'aplatissent en
   * plus dans l'autre sens ; gauche et haut ne font que s'étirer.
   *
   * [dx, dy, échelle x, échelle y, part de blanc, alpha]
   */
  const SWAP = {
    droite: [[0, 0, 1, 1, 0, 1], [-0.55, 0, 1.0278, 1, 0.25, 1], [-2.2, 0, 1.1111, 1, 1, 1],
      [-1.9, 0.9, 1.2236, 0.9553, 1, 0.965], [-1.25, 3.6, 1.561, 0.8211, 1, 0.863],
      [0.05, 8.05, 2.1234, 0.5975, 1, 0.69], [20.1, 3.6, 1.4993, 0.8211, 1, 0.69],
      [32.05, 0.9, 1.1248, 0.9553, 1, 0.69], [36, 0, 1, 1, 1, 0.69],
      [36, 0, 1, 1, 0.891, 0.725], [36, 0, 1, 1, 0.555, 0.827], [36, 0, 1, 1, 0, 1]],
    bas: [[0, 0, 1, 1, 0, 1], [0, -0.55, 1, 1.0275, 0.25, 1], [0, -2.2, 1, 1.11, 1, 1],
      [1.15, -1.9, 0.9437, 1.2225, 1, 0.961], [4.5, -1.2, 0.7747, 1.5602, 1, 0.843],
      [10.1, 0, 0.4931, 2.123, 1, 0.651], [4.45, 20, 0.7747, 1.4991, 1, 0.675],
      [1.15, 32, 0.9437, 1.1248, 1, 0.686], [0, 36, 1, 1, 1, 0.69],
      [0, 36, 1, 1, 0.668, 0.792], [0, 36, 1, 1, 0.332, 0.898], [0, 36, 1, 1, 0, 1]],
    gauche: [[0, 0, 1, 1, 0, 1], [-0.55, 0, 1.0278, 1, 0.25, 1], [-2.2, 0, 1.1111, 1, 1, 1],
      [-6.4, 0, 1.2236, 1, 1, 1], [-19.2, 0, 1.561, 1, 1, 1], [-40.35, 0, 2.1234, 1, 1, 1],
      [-37.95, 0, 1.4993, 1, 1, 0.827], [-36.45, 0, 1.1248, 1, 1, 0.725], [-36, 0, 1, 1, 1, 0.69],
      [-36, 0, 1, 1, 0.891, 0.725], [-36, 0, 1, 1, 0.555, 0.827], [-36, 0, 1, 1, 0, 1]],
    haut: [[0, 0, 1, 1, 0, 1], [0, -0.55, 1, 1.0275, 0.25, 1], [0, -2.2, 1, 1.11, 1, 1],
      [0, -6.4, 1, 1.2225, 1, 1], [0, -19.15, 1, 1.5602, 1, 1], [0, -40.3, 1, 2.123, 1, 1],
      [0, -37.9, 1, 1.4991, 1, 0.827], [0, -36.45, 1, 1.1248, 1, 0.725], [0, -36, 1, 1, 1, 0.69],
      [0, -36, 1, 1, 0.668, 0.792], [0, -36, 1, 1, 0.332, 0.898], [0, -36, 1, 1, 0, 1]],
  };

  function drawFx(ctx, mc) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, mc.alpha));
    // L'image courante du clip, en base 0 — bornée à sa pellicule.
    const f = Math.max(1, Math.min(mc.totalFrames, mc.curFrame)) - 1;
    switch (mc.kind) {
      case 'particule': {
        ctx.translate(mc.x, mc.y);
        ctx.rotate(mc.rot * Math.PI / 180);
        ctx.scale(mc.scale, mc.scale);
        tracerForme(ctx, FORMES['particule' + Math.max(1, Math.min(9, mc.frame))]);
        break;
      }
      case 'explosion': {
        const e = EXPLOSION[Math.min(f, EXPLOSION.length - 1)];
        ctx.translate(mc.x, mc.y);
        ctx.rotate(e[1] * Math.PI / 180);
        ctx.scale(e[0], e[0]);
        tracerForme(ctx, mc.data.gel ? FORMES.explosionGel : FORMES.explosion);
        break;
      }
      case 'getPowerStar': {
        const e = GET_POWER_STAR[Math.min(f, GET_POWER_STAR.length - 1)];
        ctx.globalAlpha *= e[1];
        ctx.translate(mc.x, mc.y);
        ctx.scale(e[0], e[0]);
        tracerForme(ctx, FORMES.etoile);
        break;
      }
      case 'strike': {
        const e = STRIKE[Math.min(f, STRIKE.length - 1)];
        ctx.fillStyle = '#ffffff';
        // Le clip est posé en haut du plateau ; ses barres (forme #227,
        // 13 × 480 centrée) sont à y = 240 : elles couvrent tout l'écran.
        ctx.translate(mc.x, mc.y + 240);
        ctx.fillRect(e[0] - 6.5 * e[1], -240, 13 * e[1], 480);
        ctx.fillRect(-e[0] - 6.5 * e[1], -240, 13 * e[1], 480);
        if (e[2] > 0) ctx.fillRect(-6.5 * e[2], -240, 13 * e[2], 480);
        break;
      }
      case 'defense': {
        const e = BANDEAU[Math.min(f, BANDEAU.length - 1)];
        ctx.globalAlpha *= e[1];
        ctx.translate(mc.x, mc.y + e[0]);
        const plaque = A.img('menuTitre');
        if (plaque && plaque.naturalWidth)
          ctx.drawImage(plaque, -98.95, -14.15, plaque.naturalWidth, plaque.naturalHeight);
        // Le champ (#359) : Impact 16, centré, ligne de base à 4,2 sous l'ancrage.
        text(ctx, mc.data.text || '', 0, 4.2,
          { size: 16, color: '#ffe8b7', font: 'impact', baseline: 'alphabetic' });
        break;
      }
      case 'scorePop': {
        const dy = SCORE_POP[Math.min(f, SCORE_POP.length - 1)];
        if (f >= 25) ctx.globalAlpha *= SCORE_POP_ALPHA[Math.min(f - 25, 4)];
        ctx.translate(mc.x, mc.y + dy);
        // La plaque noire à 35 % (#134, ou #136 plus large dès 1000), puis le
        // score en DooM 13, blanc, centré (champ #135).
        tracerForme(ctx, mc.data.big ? FORMES.plaqueLarge : FORMES.plaque);
        text(ctx, String(mc.data.text), 0, 5.5,
          { size: 13, color: '#ffffff', font: 'doom', baseline: 'alphabetic' });
        break;
      }
      case 'swapFruit': {
        const t = mc.data.table[Math.min(f, mc.data.table.length - 1)];
        const img = mc.data.img;
        if (!img || !img.naturalWidth) break;
        ctx.globalAlpha *= t[5];
        ctx.translate(mc.x + t[0], mc.y + t[1]);
        ctx.scale(t[2], t[3]);
        avecEclat(ctx, t[4], 0, 0, 38, 38, function (c) { c.drawImage(img, 0, 0, 38, 38); });
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
  // FACE_WIDTH*0.5.
  //
  // LES FONDS, tels que le clip `bg` (#231) les pose :
  //   1  calme   le dégradé vertical #211 — SOMBRE EN HAUT, clair en bas
  //   2  mort    le dégradé rouge #212, même sens
  //   3  touché  (#218) un carré rose et DEUX SPIRALES violettes qui tournent,
  //              de 20° et de 13° par image, l'une éclaircie
  //   4  joie    (#222) le SOLEIL — une roue de rayons de 360 px centrée sur
  //              le coin bas-gauche de la fenêtre, qui tourne de 1,2° par image
  //   5  colère  (#226) un carré vert sombre, le même soleil teinté en rouge
  //              orangé, et DOUZE RAYONS blancs qui jaillissent du centre :
  //              chacun grandit d'une fois et demie par image, de 4 % à 600 %,
  //              puis repart de 4 % sous un angle au hasard
  //   6  blanc   le fond du `fake` — la copie qui s'estompe à chaque
  //              changement d'expression : le visage passe par un flash blanc
  const FACE_DEGRADES = [
    [[0, '#87913e'], [0.204, '#8ba544'], [1, '#b1c26b']],   // #211
    [[0, '#620b0b'], [0.337, '#aa1111'], [1, '#ea3939']],   // #212
  ];
  const FACE_ROSE = '#fad7fd', FACE_VERT_SOMBRE = '#576228';
  // Les rayons de la colère : max = 12 copies, × 1,5 par image, bornés à 600 %.
  const RAYONS_MAX = 12, RAYONS_FACTEUR = 1.5, RAYONS_LIMITE = 600;

  /* Une image RECOLORÉE pixel par pixel, comme Flash applique une
   * transformation de couleur (c' = c × mult / 256 + add) à un clip : la
   * spirale éclaircie du fond « touché », le soleil rougi de la colère. Le
   * résultat est calculé une fois et gardé ; sans canevas réel (le banc de
   * rendu de Node), l'image d'origine est rendue telle quelle. */
  const teintes = {};
  function imageTeintee(nom, cle, mult, add) {
    const img = A.img(nom);
    if (!img || !img.naturalWidth) return null;
    const k = nom + '/' + cle;
    if (teintes[k] !== undefined) return teintes[k] || img;
    teintes[k] = null;
    if (typeof document === 'undefined') return img;
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, c.width, c.height);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        p[i] = Math.max(0, Math.min(255, p[i] * mult[0] / 256 + add[0]));
        p[i + 1] = Math.max(0, Math.min(255, p[i + 1] * mult[1] / 256 + add[1]));
        p[i + 2] = Math.max(0, Math.min(255, p[i + 2] * mult[2] / 256 + add[2]));
      }
      cx.putImageData(d, 0, 0);
      teintes[k] = c;
      return c;
    } catch (e) { return img; }
  }

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
    // Les fonds animés : les angles des spirales et du soleil, les rayons.
    this.spirale = 0; this.spirale2 = 0; this.soleil = 0; this.rayons = null;
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
    // Les scripts d'image des fonds animés (cf. FACE_DEGRADES).
    if (this.bgId === 2) { this.spirale += 20 * tmod; this.spirale2 += 13 * tmod; }
    else if (this.bgId === 3) this.soleil -= 1.2 * tmod;
    else if (this.bgId === 4) {
      if (!this.rayons) {
        // Image 1 du clip : l'original à 100 %, et onze copies étagées de 4 %
        // à 554 %, chacune tournée au hasard.
        this.rayons = [{ s: 100, r: 0 }];
        for (let i = 1; i < RAYONS_MAX; i++)
          this.rayons.push({ s: 4 + i / RAYONS_MAX * RAYONS_LIMITE, r: random(360) });
      }
      const k = Math.pow(RAYONS_FACTEUR, tmod);
      for (let i = 0; i < this.rayons.length; i++) {
        const ray = this.rayons[i];
        ray.s *= k;
        if (ray.s > RAYONS_LIMITE) { ray.s = 4; ray.r = random(360); }
      }
    }
    if (this.bgId !== 4) this.rayons = null;
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
    // Seul le PORTRAIT tremble (Face.as déplace sub.char) ; le fond reste.
    drawFaceContent(ctx, this.skinId, this.stateId, this.bgId,
      x, y, s, this.flipped, 1, opts.verrou, this, this.shakeX, this.shakeY);
    if (this.fakeAlpha > 0)
      drawFaceContent(ctx, this.fakeSkin, this.fakeState, 5, x, y, s, this.flipped, this.fakeAlpha / 100);
    ctx.restore();
    if (opts.frame !== false) {
      // Le cadre de bois (`border`, #209) est posé en (−11 ; −11) dans le
      // clip swapou2_faceFull — pas aux FACEBORDER_X/Y de Data.as, que le
      // code d'époque a laissés en commentaire.
      const ft = A.img(opts.cadre || 'faceTop');
      if (ft) ctx.drawImage(ft, x - 11 * s / D.FACE_WIDTH, y - 11 * s / D.FACE_HEIGHT,
        130 * s / D.FACE_WIDTH, 133 * s / D.FACE_HEIGHT);
    }
  };

  // Le fond de la fenêtre, dans le repère de la fenêtre (110 × 110, origine
  // en haut à gauche) — cf. la table des fonds au-dessus de FACE_DEGRADES.
  function dessinerFondVisage(ctx, bgId, face) {
    if (bgId === 0 || bgId === 1) {
      const grad = ctx.createLinearGradient(0, 0, 0, D.FACE_HEIGHT);
      for (const [o, c] of FACE_DEGRADES[bgId]) grad.addColorStop(o, c);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, D.FACE_WIDTH, D.FACE_HEIGHT);
      return;
    }
    if (bgId === 2) {
      ctx.fillStyle = FACE_ROSE;
      ctx.fillRect(0, 0, D.FACE_WIDTH, D.FACE_HEIGHT);
      // spirale (éclaircie : × ½ + (125, 108, 127)) en (63,35 ; 52,45),
      // spirale2 telle quelle en (55,1 ; 52,45) ; le bitmap #215 est posé en
      // (−73,8 ; −77,35) dans son clip.
      const claire = imageTeintee('spirale', 'touche', [128, 128, 128], [125, 108, 127]);
      const brute = A.img('spirale');
      const poser = (img, cx, cy, rot) => {
        if (!img) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot * Math.PI / 180);
        ctx.drawImage(img, -73.8, -77.35, 163, 153);
        ctx.restore();
      };
      poser(claire, 63.35, 52.45, face ? face.spirale : 0);
      poser(brute && brute.naturalWidth ? brute : null, 55.1, 52.45, face ? face.spirale2 : 0);
      return;
    }
    if (bgId === 3) {
      // La roue (#219, 360 × 360 centrée) pivote autour de (−2,05 ; 109,9).
      const roue = A.img('soleil');
      if (roue && roue.naturalWidth) {
        ctx.save();
        ctx.translate(-2.05, 109.9);
        ctx.rotate((face ? face.soleil : 0) * Math.PI / 180);
        ctx.drawImage(roue, -180, -180, 360, 360);
        ctx.restore();
      }
      return;
    }
    if (bgId === 4) {
      ctx.fillStyle = FACE_VERT_SOMBRE;
      ctx.fillRect(0, 0, D.FACE_WIDTH, D.FACE_HEIGHT);
      // Le soleil réduit à 30,56 % au centre, teinté : rouge saturé, vert
      // inversé, bleu nul — (255, 255 − v, 0).
      const rouge = imageTeintee('soleil', 'colere', [97, -256, 0], [255, 255, 0]);
      if (rouge) {
        ctx.save();
        ctx.translate(55, 55);
        ctx.scale(0.3056, 0.3056);
        ctx.drawImage(rouge, -180, -180, 360, 360);
        ctx.restore();
      }
      const rayons = face && face.rayons ? face.rayons : [];
      for (let i = 0; i < rayons.length; i++) {
        ctx.save();
        ctx.translate(55, 55);
        ctx.rotate(rayons[i].r * Math.PI / 180);
        ctx.scale(rayons[i].s / 100, rayons[i].s / 100);
        tracerForme(ctx, FORMES.rayon);
        ctx.restore();
      }
      return;
    }
    // 5 : le blanc du `fake`.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, D.FACE_WIDTH, D.FACE_HEIGHT);
  }

  function drawFaceContent(ctx, skinId, stateId, bgId, x, y, s, flipped, alpha, verrou, face, shakeX, shakeY) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    const k = s / D.FACE_WIDTH;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    dessinerFondVisage(ctx, bgId, face);
    ctx.restore();
    // Le portrait est posé à sa place d'origine dans la fenêtre de 110, à sa
    // taille naturelle ; on suit l'échelle de la boîte demandée.
    const pos = FACE_POS[skinId] || { x: 0, y: 0 };
    ctx.translate(x + s / 2 + (shakeX || 0) * k, y + (shakeY || 0) * k);
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

  /* ── Le bouton de pouvoir (SimpleButton.as + clip powerIcon, #378) ─────────
   *
   * Le clip est CENTRÉ sur son ancrage — l'icône de 47 × 35 (powerAtt.png ou
   * powerDef.png) est posée en (−23,5 ; −17,5) — et c'est cet ancrage que
   * l'interface colle au panneau : en (106 ; POWER_Y − (coût − 1) × 27) pour
   * la défense du Challenge. Le portage le prenait pour un coin haut-gauche,
   * et l'icône était 23 px trop à droite.
   *
   * Le survol (SimpleButton.update) fait défiler ses onze images en boucle
   * tant que le curseur y est, et FINIT SON TOUR après : un coup de jaune sur
   * l'icône (décalage de couleur additif rouge + vert) et une étoile blanche
   * qui jaillit à droite, enfle de 0,8 à 1,4 et s'efface. Pas de bosse
   * d'échelle.
   */
  const ICONE_ROUGE = [0, 4, 17, 39, 69, 48, 31, 17, 8, 2, 0];
  const ICONE_VERT = [0, 5, 21, 47, 83, 58, 37, 21, 9, 2, 0];
  const ICONE_ETOILE = [null, [0.8, 0.801], [0.9259, 0.633], [1.037, 0.484], [1.1333, 0.355],
    [1.2148, 0.246], [1.2815, 0.156], [1.3333, 0.09], [1.3703, 0.039], [1.3926, 0.012], [1.4, 0]];
  function IconButton(imgName, cb) {
    this.imgName = imgName;
    this.cb = cb;
    this.x = 0; this.y = 0;      // le CENTRE de l'icône
    this.active = true;
    this.isOver = false;
    this.frame = 1;
    this.visible = true;
  }
  IconButton.prototype.enable = function () { this.active = true; };
  IconButton.prototype.disable = function () { this.active = false; };
  IconButton.prototype.update = function (tmod) {
    if ((this.isOver && this.active) || this.frame > 1) {
      this.frame += tmod;
      if (this.frame >= ICONE_ROUGE.length) this.frame = 1;
    }
  };
  IconButton.prototype.hitTest = function (mx, my) {
    return this.visible && Math.abs(mx - this.x) <= 23.5 && Math.abs(my - this.y) <= 17.5;
  };
  IconButton.prototype.release = function () { if (this.active && this.visible) this.cb(); };
  IconButton.prototype.draw = function (ctx) {
    if (!this.visible) return;
    const img = A.img(this.imgName);
    const f = Math.max(0, Math.min(ICONE_ROUGE.length - 1.001, this.frame - 1));
    const i = Math.floor(f), k = f - i;
    const r = ICONE_ROUGE[i] + (ICONE_ROUGE[i + 1] - ICONE_ROUGE[i]) * k;
    const v = ICONE_VERT[i] + (ICONE_VERT[i + 1] - ICONE_VERT[i]) * k;
    ctx.save();
    ctx.globalAlpha = this.active ? 1 : 0.5;    // disable() : _alpha = 50
    ctx.translate(this.x, this.y);
    avecDecalage(ctx, r, v, 0, -23.5, -17.5, 47, 35, function (c) {
      if (img && img.naturalWidth) c.drawImage(img, -23.5, -17.5);
    });
    const e = ICONE_ETOILE[Math.min(ICONE_ETOILE.length - 1, Math.round(f))];
    if (e && e[1] > 0) {
      ctx.globalAlpha *= e[1];
      ctx.translate(38, 0.1);
      ctx.scale(e[0], e[0]);
      tracerForme(ctx, FORMES.etoile);
    }
    ctx.restore();
  };

  /* ── L'INDICATEUR DE PAIRE (fruitRollOver, sprite #56) ─────────────────────
   *
   * Le portage en dessinait une idée : un cadre arrondi jaune, un trait au
   * milieu et une croix rouge quand l'échange est interdit. Le clip d'époque
   * est tout autre, et ce sont ses trois pièces qu'on retrouve ici :
   *
   *   `sub`  (#50)  L'ANNEAU — un rectangle à bouts ronds ÉVIDÉ, 72,4 × 37,55,
   *                 posé en (31,95 ; 17,25) dans le clip. Deux images : BLANC
   *                 quand l'échange est possible, ROUGE quand il ne l'est pas
   *                 (`sub.gotoAndStop(1)` / `(2)` dans `Interf.displayPair`).
   *                 Pas de trait au milieu, pas de croix.
   *
   *   `mask` (#47)  SEPT BANDES EN BIAIS qui masquent l'anneau et GLISSENT :
   *                 le clip anime leur x de 24,15 à 46,15 en dix images, et
   *                 recommence. Les bandes font 10,9 de large et se répètent
   *                 tous les 21,8 — d'où l'anneau en pointillé oblique qui
   *                 défile, la vraie signature du sélecteur.
   *
   *   `v`    (#55)  LE COMPTEUR de blocage horizontal (la Coupure) : une
   *                 plaquette brune à liseré noir, le petit crâne, et le
   *                 nombre de coups restants. Caché le reste du temps.
   *
   * Les chemins ci-dessous sont ceux des formes du fichier, au centième.
   */
  const ANNEAU = cheminSwf('M35.15 0Q35.15 -6.65 30.5 -11.3Q25.8 -16 19.15 -16L-16.05 -16'
    + 'Q-22.5 -15.85 -27 -11.3Q-31.7 -6.65 -31.7 0Q-31.7 6.65 -27 11.3Q-22.35 16 -15.7 16'
    + 'L-15.7 16.05L19.15 16.05L19.15 16Q25.8 16 30.5 11.3Q35.15 6.65 35.15 0Z'
    + 'M32.45 -13.25Q37.9 -7.75 37.95 0.05Q37.9 7.8 32.45 13.3Q26.95 18.8 19.15 18.8'
    + 'L-16.05 18.8L-17.25 18.75Q-24.05 18.25 -28.95 13.3Q-34.45 7.8 -34.45 0.05'
    + 'Q-34.45 -7.75 -28.95 -13.25Q-24.05 -18.2 -17.25 -18.7L-16.05 -18.75L19.15 -18.75'
    + 'Q26.95 -18.75 32.45 -13.25Z');
  const BANDES = cheminSwf('M20.25 -20.2L-20.15 20.2L-31.05 20.2L9.35 -20.2L20.25 -20.2Z'
    + 'M54.15 -10.5L23.45 20.2L12.55 20.2L52.95 -20.2L54.15 -20.2L54.15 -10.5Z'
    + 'M42.05 -20.2L1.65 20.2L-9.25 20.2L31.15 -20.2L42.05 -20.2Z'
    + 'M-54.15 -11.2L-54.15 -20.2L-45.15 -20.2L-54.15 -11.2Z'
    + 'M-54.15 -0.3L-34.25 -20.2L-23.35 -20.2L-54.15 10.6L-54.15 -0.3Z'
    + 'M-1.55 -20.2L-41.95 20.2L-52.85 20.2L-12.45 -20.2L-1.55 -20.2Z'
    + 'M34.35 20.2L54.15 0.4L54.15 11.3L45.25 20.2L34.35 20.2Z');
  const RO_ANNEAU = { x: 31.95, y: 17.25 };
  const RO_MASQUE = { x0: 24.15, y: 17.7, course: 22, periode: 21.8, images: 9 };
  const RO_V = { x: 34.85, y: 8.5 };

  /* Un chemin de forme SWF — M, L, Q, Z et rien d'autre — mis en commandes
   * une fois pour toutes, puis rejoué sur le contexte. (Path2D ferait l'affaire
   * dans un navigateur ; le banc de rendu, lui, n'a qu'un contexte factice.) */
  function cheminSwf(d) {
    const cmds = [];
    const re = /([MLQZ])([^MLQZ]*)/g;
    let m;
    while ((m = re.exec(d)) !== null) {
      const n = m[2].trim().length
        ? m[2].trim().split(/[\s,]+/).map(Number) : [];
      cmds.push([m[1]].concat(n));
    }
    return cmds;
  }
  function tracerChemin(ctx, cmds, dx, dy) {
    ctx.beginPath();
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      if (c[0] === 'M') ctx.moveTo(dx + c[1], dy + c[2]);
      else if (c[0] === 'L') ctx.lineTo(dx + c[1], dy + c[2]);
      else if (c[0] === 'Q') ctx.quadraticCurveTo(dx + c[1], dy + c[2], dx + c[3], dy + c[4]);
      else ctx.closePath();
    }
  }

  function Rollover() {
    this.visible = false;
    this.x = 0; this.y = 0; this.rot = 0;
    this.tx = 0; this.ty = 0; this.tr = 0;
    this.blocked = false;
    this.lockText = null;
    this.phase = 0;                   // le défilement des bandes, en pixels
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
    // Les bandes défilent : 22 px en neuf pas d'époque, et le motif se répète
    // tous les 21,8 — la boucle du clip est donc invisible, à deux dixièmes.
    const tmod = (typeof SW !== 'undefined' && SW.tmod) || 1;
    this.phase = (this.phase + tmod * (RO_MASQUE.course / RO_MASQUE.images))
      % RO_MASQUE.periode;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot * Math.PI / 180);
    ctx.save();
    tracerChemin(ctx, BANDES, RO_MASQUE.x0 + this.phase, RO_MASQUE.y);
    ctx.clip('evenodd');
    tracerChemin(ctx, ANNEAU, RO_ANNEAU.x, RO_ANNEAU.y);
    ctx.fillStyle = this.blocked ? '#ff0000' : '#ffffff';
    ctx.fill('evenodd');
    ctx.restore();
    if (this.lockText != null) this.dessinerCompteur(ctx);
    ctx.restore();
  };
  // `v` : la plaquette du blocage horizontal (55,3 de large, y 4,6 à 25,7),
  // le crâne à gauche et le compte à droite.
  Rollover.prototype.dessinerCompteur = function (ctx) {
    ctx.save();
    ctx.translate(RO_V.x, RO_V.y);
    roundRect(ctx, -27.15, 4.6, 54.3, 21.1, 2);
    ctx.fillStyle = '#9f673a';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-25.15, 4.9, 50.3, 3.1);
    ctx.fillStyle = '#c9945f';
    ctx.fill();
    const cr = A.img('cursed');
    if (cr) ctx.drawImage(cr, -24, 5.2, 20, 20);
    // Le compte (champ #54) : DooM 14, blanc, sans contour.
    text(ctx, this.lockText, 6, 16.5, { size: 14, color: '#ffffff', font: 'doom' });
    ctx.restore();
  };

  return {
    D: D, FRUIT_COLORS: FRUIT_COLORS,
    getLod: function () { return lod; },
    setLod: function (v) { lod = v; },
    random: random, roundRect: roundRect, drawCentered: drawCentered,
    text: text, wrapText: wrapText, avecEclat: avecEclat, avecDecalage: avecDecalage,
    FORMES: FORMES, tracerForme: tracerForme, decouperForme: decouperForme,
    SWAP: SWAP, FLYING_STAR: FLYING_STAR,
    Particules: Particules, sinManager: sinManager,
    Face: Face, drawFaceMedallion: drawFaceMedallion,
    Rotator: Rotator, RotatorButton: RotatorButton, RotatorFace: RotatorFace,
    IconButton: IconButton, Rollover: Rollover,
  };
})();
