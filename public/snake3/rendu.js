/*
 * Frutisnake — le rendu d'une partie (et d'une bataille) sur canvas.
 *
 * Le moteur (partie.js / bataille.js) est pur calcul : ce fichier le DESSINE,
 * en recopiant Snake.draw/draw_queue, Moveable, Level et Game.as côté écran.
 *
 * Le serpent est deux passes de traits sur les points de la queue (un point
 * tous les 5 px de route) : d'abord la bordure épaisse (i·s·q + 8), puis le
 * corps par-dessus (i·s·q + 5) — i décroît vers la queue, s = scale·15/len,
 * q le renflement de bouchée. Flash trace en bouts ronds : le canvas aussi.
 * En cadence lente (tmod ≥ 1,7), le fichier troque les courbes contre des
 * segments droits — on garde la bascule.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const C = sousNode ? require('./const.js') : racine.SnakeConst;
const D = sousNode ? require('./dessin.js') : racine.SnakeDessin;
const B = sousNode ? require('./bonus.js') : racine.SnakeBonus;

// La couleur en texte CSS — mise en cache : rebâtir la chaîne à chaque
// segment et chaque image nourrissait le ramasse-miettes pour rien.
const couleursCss = new Map();
const rgb = (n) => {
  let s = couleursCss.get(n);
  if (s === undefined) {
    s = '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0');
    couleursCss.set(n, s);
  }
  return s;
};

// Les échelles de l'enfant `f` des clips snake3_fruit (451) et snake3_bonus
// (450), image par image — lues dans le SWF (PlaceObject2, a=d uniformes).
// 1-9 : « apparait » (rebond), 10-15 : « standard », 16-23 : « disparait »,
// et la 24e du fruit est l'ombre (teinte figée #4E8114 dans le clip).
const ECHELLES_FRUIT = [0.1, 0.436, 0.711, 0.925, 1.078, 1.169, 1.2, 1.178,
  1.089, 1, 1, 1, 1, 1, 1, 0.986, 0.944, 0.873, 0.775, 0.648, 0.494, 0.311, 0.1];
const ECHELLES_BONUS = [0.1, 0.528, 0.878, 1.15, 1.344, 1.461, 1.5, 1.444,
  1.278, 1, 1, 1, 1, 1, 1, 0.986, 0.944, 0.873, 0.775, 0.648, 0.494, 0.311, 0.1];
const F_STANDARD_FRUIT = 9;          // étiquette « standard » de 451
const F_DISPARAIT_FRUIT = 15;
const F_DISPARAIT_BONUS = 15;        // 450 : étiquette « disparait » (f15, encore à 100 %)
const OMBRE_FRUIT = '#4e8114';       // le cxform de l'image « ombre » de 451
const OMBRE_BONUS = rgb(C.COLOR_FRUIT_OMBRE);

// Popup.as — les nombres qui sautent sur les fruits mangés.
class PopupPoints {
  constructor(hasard, x, y, n) {
    this.nombre = new D.Nombre(n < 0 ? 'chiffresJaune' : 'chiffresRouge');
    this.nombre.centre = true;
    this.nombre.poserVal(Math.abs(n));
    this.negatif = n < 0;
    this.x = x;
    this.y = y;
    this.xtime = 0;
    this.ytime = 0;
    this.ptime = 1;
    this.max_size = Math.min(200, 50 + Math.abs(n) / 100);
    this.xspeed = (1 + hasard(10) / 10) / 0.4;
    this.yspeed = (1 + hasard(10) / 10) / 0.4;
    this.xphase = true;
    this.yphase = true;
    this.pphase = false;
    this.mort = false;
  }

  main(deltaT) {
    if (this.pphase) {
      this.ptime -= deltaT;
      if (this.ptime < 0) { this.xphase = true; this.yphase = true; this.pphase = false; }
      else return;
    }
    if (this.xphase) this.xtime += deltaT * this.xspeed;
    if (this.yphase) this.ytime += deltaT * this.yspeed;
    if (this.ptime > 0) {
      if (this.xphase && this.xtime > 1) {
        this.xphase = false;
        if (!this.yphase) this.pphase = true;
        this.xspeed *= -1;
      }
      if (this.yphase && this.ytime > 1) {
        this.yphase = false;
        if (!this.xphase) this.pphase = true;
        this.yspeed *= -1;
      }
    }
    if ((this.xspeed < 0 && this.xtime <= 0.3) || (this.yspeed < 0 && this.ytime <= 0.3)) {
      this.mort = true;
    }
  }

  dessiner(ctx) {
    const sx = this.xtime * this.max_size / 100;
    const sy = this.ytime * this.max_size / 100;
    if (sx <= 0 || sy <= 0) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(sx, sy);
    this.nombre.dessiner(ctx, 0, 0, 1);
    if (this.negatif) {
      // Popup.as encadre les pertes de deux grimaces « beurk » : à droite du
      // premier chiffre (+5) et à 38 px en deçà du dernier.
      const l = this.nombre.largeur, h = this.nombre.hauteur;
      D.poser(ctx, 'beurk', 1, l / 2 + 5, -h / 2, 1, 1, 0);
      D.poser(ctx, 'beurk', 1, -l / 2 - 38, -h / 2, 1, 1, 0);
    }
    ctx.restore();
  }
}

// Les débris de queue (Snake.explode : dix particules par segment éclaté).
class Particules {
  constructor(hasard) {
    this.hasard = hasard;
    this.liste = [];
  }

  eclater(x, y, couleur) {
    for (let i = 0; i < 10; i++) {
      this.liste.push({
        x, y,
        ang: this.hasard(180) / Math.PI,
        vitesse: 1 + this.hasard(100) / 100,
        rotation: 0,
        alpha: 100,
        couleur,
      });
    }
  }

  main(tmod) {
    for (let i = 0; i < this.liste.length; i++) {
      const p = this.liste[i];
      const s = p.vitesse * tmod;
      p.x += Math.cos(p.ang) * s;
      p.y += Math.sin(p.ang) * s;
      p.rotation += s * 10;
      p.alpha -= s * 10;
      if (p.alpha <= 0) { this.liste.splice(i, 1); i--; }
    }
  }

  dessiner(ctx) {
    for (const p of this.liste) {
      // La particule est le clip qparticule teinté aux couleurs du serpent
      // (Color.setRGB) — silhouette rendue une fois par couleur, en cache.
      const r = D.rendreTeinte('qparticule', 1, 1, rgb(p.couleur));
      if (!r) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.globalAlpha *= Math.max(0, p.alpha / 100);
      ctx.drawImage(r.c, r.dx, r.dy, r.lw, r.lh);
      ctx.restore();
    }
  }
}

/* Un point de la file, borné aux deux bouts et décalé par le gondolement de
 * la potion violette. Le bornage sert aux VOISINS : la première cubique du
 * corps veut un point avant la tête, la dernière un point après la pointe. */
function pointFile(q, k, delta) {
  const p = q[k < 0 ? 0 : (k >= q.length ? q.length - 1 : k)];
  return delta ? { x: p.x + delta, y: p.y - delta } : p;
}

/* ── LE CORPS, TRAIT POUR TRAIT (Snake.draw_queue) ─────────────────────────
 *
 * Le fichier trace UNE quadratique par segment : de la file [n] à la file
 * [n−5], point de contrôle la file [n−2]. Deux conséquences, invisibles sur
 * une ligne droite et criantes en virage :
 *
 *   · la courbe ne passe PAS par les points intermédiaires — elle coupe le
 *     virage. Mesuré à plein braquage (7,16°/image, 3,3 px/image, soit 54° de
 *     virage par segment) : jusqu'à 2,83 px entre le trait et le chemin que
 *     le serpent a réellement suivi ;
 *   · et deux segments voisins ne se raccordent qu'en POSITION. La tangente,
 *     elle, saute — mesuré : 27° à CHAQUE joint. Le corps devenait une
 *     enfilade d'arcs à angles vifs. C'est le « saccadé » des virages.
 *
 * On garde tout le reste — les mêmes segments, les mêmes largeurs, les mêmes
 * couleurs, les mêmes bouts ronds, la même voie rapide au-delà de 1,7 de tmod
 * — et l'on remplace la seule quadratique par CINQ cubiques de Catmull-Rom,
 * une par point de file. Chacune passe par ses deux extrémités et prend sa
 * tangente des voisins : le trait suit donc exactement les points que la tête
 * a semés, sans cassure nulle part, joints compris. Le serpent ne bouge pas
 * d'un pouce là où il allait droit ; en virage, il suit sa propre trace.
 *
 * ── ET EN DEUX REMPLISSAGES, PAS EN 2·len TRAITS ──────────────────────────
 *
 * Mesuré au banc (scratchpad, rendu logiciel, échelle 2) : à soixante
 * segments, ces deux passes de traits épais à bouts ronds coûtaient DIX
 * MILLISECONDES par image sur un ordinateur de bureau — cinq à dix fois plus
 * sur un téléphone — quand tout le reste de l'image en coûtait 0,06. Le
 * serpent était tout le coût : cent vingt tracés de courbes larges, dont
 * chacun oblige le moteur de dessin à calculer le contour du trait puis à le
 * remplir, tous les vingt-cinquièmes de seconde. C'est la « lenteur » de fin
 * de partie, quand le corps est long.
 *
 * Un trait épais à bouts ronds n'est pourtant qu'un tube. On le construit
 * donc DIRECTEMENT : pour chaque point de file, le point décalé à gauche et le
 * point décalé à droite de la demi-largeur du segment, le long de la normale
 * de la courbe (celle-là même que les cubiques prennent chez les voisins) ; un
 * demi-disque à chaque bout ; et l'on remplit ce contour d'un coup. Deux
 * remplissages — la bordure, puis le corps — au lieu de cent vingt traits.
 * Mêmes largeurs aux mêmes points, mêmes bouts ronds, même tube ; là où les
 * traits du fichier se recouvrent (le serpent qui se croise), les deux passes
 * entières donnaient déjà le même aplat que deux remplissages.
 *
 * Ce que le remplissage ne sait pas faire seul reste au trait, tel quel :
 *   · la pointe de la queue qui S'EFFACE (potion verte, alpha_val < 100) :
 *     ce segment-là est tracé à part, avec son alpha ;
 *   · le CURSEUR des ciseaux (color_qpos) : son segment est retracé par-dessus
 *     dans sa couleur ;
 *   · le GONDOLEMENT de la potion violette (distort), qui décale chaque
 *     segment d'un delta propre — les traits du fichier, le temps qu'il dure.
 */
function dessinerSerpent(ctx, s, tmod, temps) {
  if (s.len <= 0 || s.queue.length === 0) return;
  // Snake.draw pose `time` avant de tracer ; on note aussi la branche choisie.
  // C'est cette forme-là que le hitTest du corps interrogera (toucheLeCorps).
  s.time = temps;
  s.tmod_dessin = tmod;

  if (s.distort) {
    passeTraits(ctx, s, s.border_color, 8, tmod, temps);
    passeTraits(ctx, s, s.color, 5, tmod, temps);
    return;
  }

  const courbe = tmod < 1.7;
  const queueAPart = s.alpha_val < 100;
  // Les segments du tube : de la tête (len) à `derniere` — 2 quand la pointe
  // s'efface à part, 1 sinon.
  const derniere = (queueAPart && s.len > 1) ? 2 : 1;
  const geo = geometrieCorps(s, derniere);
  ctx.globalAlpha = 1;
  remplirTube(ctx, geo, rgb(s.border_color), 8);
  remplirTube(ctx, geo, rgb(s.color), 5);

  const q = s.queue;
  const n0 = q.length - 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (queueAPart) {
    // Le segment 1 (la pointe), avec son alpha — ses deux passes, comme dans
    // le fichier. Quand il est seul (len 1), c'est tout le serpent.
    const n = n0 - 5 * (s.len - 1);
    ctx.globalAlpha = Math.max(0, s.alpha_val / 100);
    tracerSegment(ctx, q, n, courbe);
    ctx.lineWidth = geo.largeur(1) + 8;
    ctx.strokeStyle = rgb(s.border_color);
    ctx.stroke();
    ctx.lineWidth = geo.largeur(1) + 5;
    ctx.strokeStyle = rgb(s.color);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (s.color_qpos > 0 && s.color_qpos <= s.len) {
    // Le curseur des ciseaux : les deux passes du fichier le peignent de la
    // même couleur, la bordure (la plus large) décide de la forme.
    const i = s.color_qpos;
    tracerSegment(ctx, q, n0 - 5 * (s.len - i), courbe);
    ctx.lineWidth = geo.largeur(i) + 8;
    ctx.strokeStyle = rgb(s.color_val);
    ctx.stroke();
  }
}

// Le trait d'UN segment de corps, tel que le fichier le trace (moins le
// gondolement) : cinq cubiques de Catmull-Rom, une par point de file, la
// tangente donnée par les voisins — ou une corde droite quand la machine
// peine (tmod ≥ 1,7, la voie rapide du fichier).
function tracerSegment(ctx, q, n, courbe) {
  const p0 = pointFile(q, n, 0);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  if (!courbe) {
    const p1 = pointFile(q, n - 5, 0);
    ctx.lineTo(p1.x, p1.y);
    return;
  }
  let av = pointFile(q, n + 1, 0);
  let ici = p0;
  for (let j = 1; j <= 5; j++) {
    const suiv = pointFile(q, n - j, 0);
    const apres = pointFile(q, n - j - 1, 0);
    ctx.bezierCurveTo(
      ici.x + (suiv.x - av.x) / 6, ici.y + (suiv.y - av.y) / 6,
      suiv.x - (apres.x - ici.x) / 6, suiv.y - (apres.y - ici.y) / 6,
      suiv.x, suiv.y);
    av = ici; ici = suiv;
  }
}

/* La géométrie du tube : un point par point de file, de la tête (j = 0) au
 * bout du segment `derniere` (j = M), sa normale, et la part VARIABLE de la
 * largeur du segment qui le porte (i·s·q — la bordure ajoute 8, le corps 5).
 * Aux joints, c'est le plus large des deux segments qui gagne, comme le bout
 * rond du trait le plus épais recouvrait l'autre. Les tampons sont réutilisés
 * d'une image à l'autre : rien n'est alloué en régime de croisière. */
const geo = {
  M: 0, x: new Float64Array(64), y: new Float64Array(64),
  nx: new Float64Array(64), ny: new Float64Array(64), base: new Float64Array(64),
  ss: 0, eat: 0, eatFlag: false,
  largeur(i) {
    const qf = this.eatFlag ? Math.max(1, 2 - (i - this.eat) * (i - this.eat) / 2) : 1;
    return i * this.ss * qf;
  },
};
function geometrieCorps(s, derniere) {
  const q = s.queue;
  const n0 = q.length - 1;
  const segments = s.len - derniere + 1;
  const M = 5 * segments;
  if (geo.x.length < M + 1) {
    const n = Math.max(M + 1, geo.x.length * 2);
    geo.x = new Float64Array(n); geo.y = new Float64Array(n);
    geo.nx = new Float64Array(n); geo.ny = new Float64Array(n); geo.base = new Float64Array(n);
  }
  geo.M = M;
  geo.ss = Math.min(10, s.len + 3) / 10 * 15 / s.len;
  geo.eat = s.eat;
  geo.eatFlag = s.eat > 0;
  const x = geo.x, y = geo.y, nx = geo.nx, ny = geo.ny, base = geo.base;
  for (let j = 0; j <= M; j++) {
    const k = n0 - j;
    const p = q[k < 0 ? 0 : k];
    x[j] = p.x; y[j] = p.y;
    // Le segment qui porte le point : len pour j = 0, puis un de moins tous
    // les cinq points ; aux joints, le plus large des deux.
    const fin = j === 0 ? s.len : s.len - Math.ceil(j / 5) + 1;
    let b = geo.largeur(fin);
    if (j > 0 && j % 5 === 0 && fin - 1 >= derniere) b = Math.max(b, geo.largeur(fin - 1));
    base[j] = b;
  }
  // Les normales : la tangente de chaque point est celle des cubiques du
  // trait — la corde entre ses deux voisins. Là où la file se répète (elle
  // est bornée à son premier point), on garde la normale précédente.
  let pnx = 1, pny = 0;
  for (let j = 0; j <= M; j++) {
    const a = j > 0 ? j - 1 : 0, b = j < M ? j + 1 : M;
    const tx = x[a] - x[b], ty = y[a] - y[b];     // vers la tête
    const l = Math.sqrt(tx * tx + ty * ty);
    if (l > 1e-6) { pnx = -ty / l; pny = tx / l; }
    nx[j] = pnx; ny[j] = pny;
  }
  return geo;
}

// Le contour du tube, rempli : le flanc gauche de la tête à la queue, le
// demi-disque de la queue, le flanc droit de la queue à la tête, le
// demi-disque de la tête.
function remplirTube(ctx, g, couleur, lsize) {
  const M = g.M;
  const x = g.x, y = g.y, nx = g.nx, ny = g.ny, base = g.base;
  ctx.fillStyle = couleur;
  ctx.beginPath();
  for (let j = 0; j <= M; j++) {
    const r = (base[j] + lsize) / 2;
    if (j === 0) ctx.moveTo(x[0] + nx[0] * r, y[0] + ny[0] * r);
    else ctx.lineTo(x[j] + nx[j] * r, y[j] + ny[j] * r);
  }
  // La normale est le quart de tour de la tangente (qui pointe vers la
  // tête) : de +N, un demi-tour d'angle passe par −T — le bout de la queue.
  const rq = (base[M] + lsize) / 2, aq = Math.atan2(ny[M], nx[M]);
  ctx.arc(x[M], y[M], rq, aq, aq + Math.PI, false);
  for (let j = M - 1; j >= 0; j--) {
    const r = (base[j] + lsize) / 2;
    ctx.lineTo(x[j] - nx[j] * r, y[j] - ny[j] * r);
  }
  const rt = (base[0] + lsize) / 2, at = Math.atan2(ny[0], nx[0]);
  ctx.arc(x[0], y[0], rt, at + Math.PI, at + 2 * Math.PI, false);
  ctx.closePath();
  ctx.fill();
}

// Les deux passes de traits du fichier, segment par segment — gardées pour le
// gondolement de la potion violette, qui décale chaque segment d'un delta
// propre (les bouts ronds comblent les écarts entre segments voisins).
function passeTraits(ctx, s, couleur, lsize, tmod, temps) {
  const scale = Math.min(10, s.len + 3) / 10;
  const q = s.queue;
  let n = q.length - 1;
  let p = q[n];
  const ss = scale * 15 / s.len;
  const eatFlag = s.eat > 0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let px = p.x, py = p.y;
  if (tmod < 1.7) {
    for (let i = s.len; i > 0; i--) {
      const qf = eatFlag ? Math.max(1, 2 - (i - s.eat) * (i - s.eat) / 2) : 1;
      const c = (i === s.color_qpos) ? s.color_val : couleur;
      const a = (i === 1) ? s.alpha_val : 100;
      const delta = s.distort
        ? Math.cos(i + temps) * Math.min(6, s.len - i) * s.distort_val : 0;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineWidth = i * ss * qf + lsize;
      ctx.strokeStyle = rgb(c);
      ctx.globalAlpha = Math.max(0, a / 100);
      // Une cubique par POINT DE FILE, tangente donnée par les voisins.
      let av = pointFile(q, n + 1, delta);
      let ici = { x: px, y: py };
      for (let j = 1; j <= 5; j++) {
        const suiv = pointFile(q, n - j, delta);
        const apres = pointFile(q, n - j - 1, delta);
        ctx.bezierCurveTo(
          ici.x + (suiv.x - av.x) / 6, ici.y + (suiv.y - av.y) / 6,
          suiv.x - (apres.x - ici.x) / 6, suiv.y - (apres.y - ici.y) / 6,
          suiv.x, suiv.y);
        av = ici; ici = suiv;
      }
      px = ici.x; py = ici.y;
      ctx.stroke();
      n -= 5;
    }
  } else {
    // La voie rapide du fichier quand la machine peine : des segments.
    for (let i = s.len; i > 0; i--) {
      n -= 5;
      p = q[Math.max(0, n)];
      const qf = eatFlag ? Math.max(1, 2 - (i - s.eat) * (i - s.eat) / 2) : 1;
      const c = (i === s.color_qpos) ? s.color_val : couleur;
      const a = (i === 1) ? s.alpha_val : 100;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineWidth = i * ss * qf + lsize;
      ctx.strokeStyle = rgb(c);
      ctx.globalAlpha = Math.max(0, a / 100);
      if (s.distort) {
        const delta = Math.cos(i + temps) * Math.min(6, s.len - i) * s.distort_val;
        ctx.lineTo(p.x + delta, p.y - delta);
        px = p.x + delta; py = p.y - delta;
      } else {
        ctx.lineTo(p.x, p.y);
        px = p.x; py = p.y;
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// La tête : image du clip `tete` (1 verte, 2 grise invincible, 3 noire,
// 11-13 les couleurs de bataille), tournée au cap, à 30+70·scale %.
function dessinerTete(ctx, s, frame) {
  // `vivant` est le `tete._visible` du SWF, et RIEN D'AUTRE ne cache la tête.
  // Snake.draw la place, l'oriente et la redimensionne à CHAQUE image, avant
  // même son `if(!redraw) return` ; seul Game.game_over la fait disparaître,
  // et seulement une fois la queue entièrement explosée.
  //
  // Un serpent réduit à sa seule tête (len 0) est un état de jeu NORMAL : deux
  // dynamites le laissent là (Pile.as ne tue qu'à la troisième, quand len vaut
  // déjà 0 en entrant dans la boucle), et il continue de se piloter. Le
  // masquer ici le rendait invisible : le joueur avançait à l'aveugle jusqu'au
  // mur et croyait que la dynamite l'avait tué.
  if (s.vivant === false) return;
  const scale = Math.min(10, s.len + 3) / 10;
  const k = (30 + 70 * scale) / 100;
  D.poser(ctx, 'tete', frame || s.tete_frame || 1, s.x, s.y, k, k, s.ang);
}

// Un fruit ou une option, avec la vie du clip d'enrobage (apparait/standard/
// disparait) et l'ombre du saut (Moveable).
class Enrobage {
  constructor(objet, genre) {
    this.objet = objet;                    // le Fruit/Option du moteur
    this.genre = genre;                    // 'fruit' | 'bonus'
    this.frame = 1;
    this.tempsFrame = 0;
    // Le film du sous-clip : en Flash, le clip d'objet est figé sur l'image de
    // SON option (gotoAndStop) mais la fiole/les ciseaux qu'elle porte jouent
    // leur propre boucle, depuis l'instant où l'objet a été posé. Chaque objet
    // a donc sa phase — deux potions posées à une seconde d'écart ne ballottent
    // pas ensemble.
    this.film = 0;
    this.disparait = false;
    this.mort = false;
  }

  main(deltaT) {
    // Le clip d'enrobage court à la cadence du LECTEUR (40 images/s, l'en-tête
    // du SWF) : un clip Flash avance d'une image par image d'écran, pas au
    // rythme de tmod.
    this.tempsFrame += deltaT * C.SWF_FPS;
    const echelles = this.genre === 'fruit' ? ECHELLES_FRUIT : ECHELLES_BONUS;
    const standard = this.genre === 'fruit' ? F_STANDARD_FRUIT : 10;
    const dispar = this.genre === 'fruit' ? F_DISPARAIT_FRUIT : F_DISPARAIT_BONUS;
    while (this.tempsFrame >= 1) {
      this.tempsFrame -= 1;
      this.film++;
      if (this.disparait) {
        this.frame++;
        if (this.frame > echelles.length) { this.mort = true; break; }
      } else if (this.frame < standard) {
        this.frame++;
      }
      if (!this.disparait && this.frame >= standard) this.frame = standard;
    }
    if (this.disparait && this.frame < dispar) this.frame = dispar;
  }

  echelle() {
    const echelles = this.genre === 'fruit' ? ECHELLES_FRUIT : ECHELLES_BONUS;
    return echelles[Math.min(echelles.length, Math.max(1, this.frame)) - 1];
  }
}

function dessinerEnrobe(ctx, enr) {
  const o = enr.objet;
  const cle = enr.genre === 'fruit' ? 'fruits' : 'options';
  const kClip = enr.echelle();
  const kZ = (100 + (o.z || 0)) / 100 * (o.echelle || 1);
  // L'ombre du saut (Moveable.move) : le même dessin, teinté, au sol.
  if (o.z && o.z !== 0) {
    const kO = (100 - o.z / 2) / 100 * (o.echelle || 1);
    teinter(ctx, cle, o.id, o.x + o.z / 4, o.y + o.z / 3, kClip * kO,
      enr.genre === 'fruit' ? OMBRE_FRUIT : OMBRE_BONUS, enr.film);
  }
  const rot = (o.rotation || 0) * Math.PI / 180;
  D.poserAnim(ctx, cle, o.id, enr.film, o.x, o.y - (o.z || 0), kClip * kZ, kClip * kZ, rot);
}

// Dessine une frame d'un clip en silhouette teintée (Color.setRGB / le
// cxform de l'image « ombre » : tous les pixels prennent la couleur).
function teinter(ctx, cle, frame, x, y, k, couleur, film) {
  const r = film == null ? D.rendreTeinte(cle, frame, k, couleur)
    : D.rendreTeinteAnim(cle, frame, film, k, couleur);
  if (!r) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.drawImage(r.c, r.dx, r.dy, r.lw, r.lh);
  ctx.restore();
}

// ── L'assistant de bombe (pack de Frutisnake) ─────────────────────────────
//
// Une bombe posée coupe le serpent au PREMIER segment (depuis la tête) qui
// entre dans son rayon de 160 px — tout ce qui est derrière part, et si c'est
// la tête qui y est, c'est la mort. Rien à l'écran ne le disait : la mèche
// brûle cinq secondes et on découvre le résultat.
//
// L'assistant montre les deux choses qui manquent, dans le vocabulaire du
// jeu (aplats cernés de blanc, couleurs tirées de ses propres dessins) :
//   · le CERCLE du souffle, posé au sol comme une empreinte, avec l'arc de la
//     mèche qui se vide dessus — l'où et le quand dans une seule forme ;
//   · le HALO sur la portion de queue qui serait emportée, juste sous le
//     serpent, qui dit d'un coup d'œil ce qu'on va perdre.
// Trois états : blanc tant que rien n'est menacé, jaune (celui de l'étincelle
// de la dynamite) quand la queue va être coupée, rouge (celui de la potion
// rouge) et battement rapide quand la tête est dans le cercle.
const ASSIST = {
  sur: { trait: '#ffffff', voile: 'rgba(255,255,255,0.10)' },
  queue: { trait: '#ffcc00', voile: 'rgba(255,204,0,0.16)' },
  mort: { trait: '#cc0000', voile: 'rgba(204,0,0,0.20)' },
};

// Le niveau de danger d'une bombe, maintenant : 0 rien, 1 la queue, 2 la tête.
function dangerBombe(serpent, x, y) {
  const coupe = B.coupureBombe(serpent, x, y);
  return { coupe, niveau: coupe < 2 ? 2 : (coupe < serpent.len ? 1 : 0) };
}

// L'empreinte au sol : à poser AVANT le serpent et les objets. Elle est
// DÉCOUPÉE AU TERRAIN — c'est une marque peinte sur le sol, elle n'a rien à
// faire sur le cadre ni sur la frutibarre.
function dessinerZoneBombe(ctx, partie, bombes) {
  const serpent = partie.serpent;
  const n = partie.niveau;
  for (const b of bombes) {
    if (b.explose) continue;
    const d = dangerBombe(serpent, b.x, b.y);
    const t = d.niveau === 2 ? ASSIST.mort : (d.niveau === 1 ? ASSIST.queue : ASSIST.sur);
    // Le battement s'accélère avec le danger et à mesure que la mèche brûle.
    const reste = Math.max(0, Math.min(1, (b.meche || 0) / C.TIME_BOMBE));
    const cadence = 3 + (1 - reste) * 5 + d.niveau * 3;
    const battement = 0.72 + 0.28 * Math.sin((C.TIME_BOMBE - reste * C.TIME_BOMBE) * cadence);

    ctx.save();
    ctx.beginPath();
    ctx.rect(n.corner.x, n.corner.y, n.width, n.height);
    ctx.clip();
    ctx.globalAlpha = battement;
    ctx.beginPath();
    ctx.arc(b.x, b.y, C.RAYON_BOMBE, 0, Math.PI * 2);
    ctx.fillStyle = t.voile;
    ctx.fill();
    // L'ÉTENDUE en pointillé (le liseré blanc du jeu, puis la couleur), le
    // TEMPS en trait plein : deux informations, deux traits qu'on ne confond
    // pas d'un coup d'œil.
    ctx.lineCap = 'butt';
    ctx.setLineDash([15, 11]);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = t.trait;
    ctx.stroke();
    // L'arc de la mèche se vide dans le sens des aiguilles, depuis le haut.
    if (reste > 0) {
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, C.RAYON_BOMBE, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reste);
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineWidth = 5.5;
      ctx.strokeStyle = t.trait;
      ctx.stroke();
      /*
       * LE DÉCOMPTE, au centre du cercle.
       *
       * L'arc dit « bientôt » ; il ne dit pas « dans deux secondes ». Or c'est
       * le chiffre qu'on lit d'un coup d'œil quand on décide de traverser ou
       * de contourner — et c'est ce qui manquait.
       *
       * Ce sont les CHIFFRES DU JEU (asml.NumberMC, les mêmes clips que le
       * score et les bulles de points), pas une police du navigateur, et ils
       * prennent la couleur du danger : verts tant que rien n'est menacé,
       * jaunes quand la queue va tomber, rouges quand c'est la tête. On
       * arrondit VERS LE HAUT — « 1 » couvre la dernière seconde, et le zéro
       * n'apparaît jamais avant que ça saute.
       */
      const secondes = Math.max(1, Math.ceil(b.meche || 0));
      const police = d.niveau === 2 ? 'chiffresRouge'
        : (d.niveau === 1 ? 'chiffresJaune' : 'chiffresVert');
      if (!b._compte || b._compte.police !== police) {
        b._compte = new D.Nombre(police);
        b._compte.police = police;
        b._compte.centre = true;
      }
      b._compte.poserVal(secondes);
      // Il grossit sur la dernière seconde : le dernier battement se voit sans
      // qu'on ait à lire.
      const k = 2.4 + (reste < 1 / C.TIME_BOMBE ? (1 - reste * C.TIME_BOMBE) * 1.4 : 0);
      b._compte.dessiner(ctx, b.x, b.y, k);
    }
    ctx.restore();
  }
}

// Le halo sur la portion condamnée : à poser JUSTE AVANT le serpent, pour
// qu'il déborde de lui comme une lueur.
function dessinerQueueCondamnee(ctx, serpent, bombes) {
  const q = serpent.queue;
  const l = q.length;
  if (serpent.len <= 0 || l === 0) return;
  // Plusieurs bombes peuvent brûler : c'est la plus mordante qui décide.
  let coupe = serpent.len, niveau = 0;
  for (const b of bombes) {
    if (b.explose) continue;
    const d = dangerBombe(serpent, b.x, b.y);
    if (d.coupe < coupe) { coupe = d.coupe; niveau = d.niveau; }
  }
  if (niveau === 0) return;
  const t = niveau === 2 ? ASSIST.mort : ASSIST.queue;
  // La même marche que draw_queue : i = len à la tête, 1 à la queue, un point
  // tous les cinq échantillons. La portion emportée va de la queue à `coupe`.
  const scale = Math.min(10, serpent.len + 3) / 10;
  const ss = scale * 15 / serpent.len;
  const point = (i) => q[Math.max(0, l - 6 - 5 * (serpent.len - i))];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = t.trait;
  let p = point(1);
  for (let i = 2; i <= serpent.len - coupe + 1 && i <= serpent.len; i++) {
    const s = point(i);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(s.x, s.y);
    ctx.lineWidth = i * ss + 16;      // le serpent fait i·ss+8 : le halo déborde
    ctx.stroke();
    p = s;
  }
  ctx.restore();
}

const API = {
  rgb, PopupPoints, Particules, dessinerSerpent, dessinerTete,
  geometrieCorps, remplirTube, tracerSegment, passeTraits,
  Enrobage, dessinerEnrobe, teinter,
  dangerBombe, dessinerZoneBombe, dessinerQueueCondamnee, ASSIST,
  ECHELLES_FRUIT, ECHELLES_BONUS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeRendu = API;

})(typeof window !== 'undefined' ? window : globalThis);
