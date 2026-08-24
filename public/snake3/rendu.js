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

const rgb = (n) => '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0');

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

// Snake.draw_queue, trait pour trait.
function dessinerSerpent(ctx, s, tmod, temps) {
  if (s.len <= 0 || s.queue.length === 0) return;
  const scale = Math.min(10, s.len + 3) / 10;

  const passe = (couleur, lsize) => {
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
        p = q[Math.max(0, n - 5)];
        const p2 = q[Math.max(0, n - 2)];
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
          ctx.quadraticCurveTo(p2.x + delta, p2.y - delta, p.x + delta, p.y - delta);
          px = p.x + delta; py = p.y - delta;
        } else {
          ctx.quadraticCurveTo(p2.x, p2.y, p.x, p.y);
          px = p.x; py = p.y;
        }
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
  };

  passe(s.border_color, 8);
  passe(s.color, 5);
}

// La tête : image du clip `tete` (1 verte, 2 grise invincible, 3 noire,
// 11-13 les couleurs de bataille), tournée au cap, à 30+70·scale %.
function dessinerTete(ctx, s, frame) {
  if (s.vivant === false || s.len <= 0) return;
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
    // Le clip d'enrobage court à la cadence du SWF (32 images/s).
    this.tempsFrame += deltaT * C.WANTED_FPS;
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

const API = {
  rgb, PopupPoints, Particules, dessinerSerpent, dessinerTete,
  Enrobage, dessinerEnrobe, teinter,
  ECHELLES_FRUIT, ECHELLES_BONUS,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeRendu = API;

})(typeof window !== 'undefined' ? window : globalThis);
