/*
 * Miniwave 2 — client de rendu (canvas) et commandes.
 *
 * Le moteur (engine.js) ne dessine rien : il joue la partie et ANNONCE ce qui
 * arrive. Ce fichier écoute ces annonces, pose les dessins extraits du SWF, et
 * transforme les appuis du joueur en commandes. Il ne décide d'aucune règle —
 * si un comportement change ici, c'est un bug.
 *
 * L'aire de jeu fait 240×240, la taille que le disque Frutiparc réserve au jeu.
 * On la rastérise à la résolution physique de l'écran (devicePixelRatio) puis on
 * l'agrandit par une mise à l'échelle ENTIÈRE tant que c'est possible : les
 * dessins d'origine sont des images de 16 à 20 pixels, et un facteur fractionnaire
 * les rendrait floues.
 */
'use strict';

(function () {

const E = window.MiniwaveEngine;
const LARGEUR = E.LARGEUR, HAUTEUR = E.HAUTEUR;
const BASE = '/miniwave/';
const IPS = 40;                       // le jeu d'origine tournait à 40 images/s

// ── Chargement des dessins ────────────────────────────────────────────────
const images = new Map();
function charger(manifeste, surAvancee) {
  const fichiers = new Set();
  for (const s of Object.values(manifeste)) {
    for (const e of s.etats) for (const p of e.pieces) fichiers.add(p.fichier);
  }
  const liste = [...fichiers];
  let faits = 0;
  return Promise.all(liste.map((f) => new Promise((resoudre) => {
    const img = new Image();
    const fini = () => { faits++; if (surAvancee) surAvancee(faits / liste.length); resoudre(); };
    img.onload = () => { images.set(f, img); fini(); };
    img.onerror = fini;               // une pièce manquante ne doit pas bloquer la partie
    img.src = BASE + 'sprites/' + f;
  })));
}

// Pose un état de sprite centré en (x,y). Les pièces d'un dessin composé (le
// boss) portent leur propre matrice, exprimée dans le repère du sprite.
function poser(ctx, sprite, frame, x, y, echelle) {
  if (!sprite) return;
  const etat = sprite.etats.find((e) => e.frame === frame) || sprite.etats[0];
  if (!etat) return;
  for (const p of etat.pieces) {
    const img = images.get(p.fichier);
    if (!img) continue;
    const m = p.m;
    ctx.save();
    ctx.translate(x, y);
    if (echelle && echelle !== 1) ctx.scale(echelle, echelle);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(img, -p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

// ── Le décor ──────────────────────────────────────────────────────────────
// Le fond du jeu est une bande verticale de quatre sections de 240×1000, qu'on
// remonte au fil des niveaux : on décolle au-dessus des nuages d'une planète, on
// traverse un champ d'astéroïdes, on passe une planète rouge fissurée et ses
// galaxies, puis une station orbitale. Ce sont les images du SWF d'origine.
//
// Reproduction fidèle de Game.moveMap : deux sections empilées, celle du niveau
// courant et la suivante, décalées de `dy % 1000`. Chaque image est ancrée PAR
// LE BAS (dans le SWF elle s'étend de -1000 à 0), d'où les soustractions.
const SECTIONS = ['bitmap1.jpg', 'bitmap3.jpg', 'bitmap5.jpg', 'bitmap7.jpg'];
const HAUT_SECTION = 1000;
const decor = new Map();

function chargerDecor() {
  return Promise.all(SECTIONS.map((f) => new Promise((resoudre) => {
    const img = new Image();
    img.onload = () => { decor.set(f, img); resoudre(); };
    img.onerror = resoudre;
    img.src = BASE + 'decor/' + f;
  })));
}

function fond(ctx, dy) {
  ctx.fillStyle = '#1a0f33';
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  const i = Math.floor(dy / HAUT_SECTION);
  const off = dy % HAUT_SECTION;
  for (const k of [0, 1]) {
    // Au-delà de la dernière section, Flash resterait sur la dernière image :
    // on fait pareil plutôt que de laisser un trou noir en fin de parcours.
    const img = decor.get(SECTIONS[Math.min(i + k, SECTIONS.length - 1)]);
    if (img) ctx.drawImage(img, 0, HAUTEUR + off - HAUT_SECTION * (k + 1), LARGEUR, HAUT_SECTION);
  }
}

// ── Particules ────────────────────────────────────────────────────────────
// Le moteur ne les connaît pas : ce sont des annonces. Une explosion projette
// des éclats, un impact fait une étincelle.
const eclats = [];
function eclater(x, y, n, couleur, vitesse) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28;
    const v = vitesse * (0.4 + Math.random() * 0.6);
    eclats.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, t: 10 + Math.random() * 14, c: couleur });
  }
}
function bougerEclats(ctx, tmod) {
  for (let i = eclats.length - 1; i >= 0; i--) {
    const p = eclats[i];
    p.x += p.vx * tmod;
    p.y += p.vy * tmod;
    p.vy += 0.25 * tmod;
    p.t -= tmod;
    if (p.t <= 0) { eclats.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, p.t / 8);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
}

// ── Le client ─────────────────────────────────────────────────────────────
class Client {
  constructor(o) {
    this.canvas = o.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.sprites = o.sprites;
    this.niveaux = o.niveaux;
    this.surEvenement = o.surEvenement || null;
    this.panneau = null;               // texte affiché entre deux niveaux
    this.panneauT = 0;
    this.echelle = 1;
    this.entree = { gauche: false, droite: false, tir: false, bombe: false };
    this.brancherCommandes(o.racine || document);
    this.redimensionner();
    window.addEventListener('resize', () => this.redimensionner());
    window.addEventListener('orientationchange', () => setTimeout(() => this.redimensionner(), 120));
  }

  // `mode` choisit la classe : l'arcade est le moteur nu, les trois autres sont
  // dans modes.js. Le reste des options passe telle quelle — chaque mode y
  // prend ce qui le concerne (missionNum et prime pour une mission, rien pour
  // l'endurance qui n'a pas de parcours).
  nouvellePartie(opts) {
    opts = opts || {};
    const graine = opts.graine === undefined ? (Date.now() & 0x7fffffff) : opts.graine;
    eclats.length = 0;
    const M = window.MiniwaveModes || {};
    const Classe = { mission: M.Mission, survival: M.Survival, letter: M.Letter }[opts.mode] || E.Game;
    this.jeu = new Classe(Object.assign({}, opts, {
      levels: opts.niveaux || this.niveaux,
      graine,
      onEvent: (n, d) => this.annonce(n, d),
    }));
    this.mode = opts.mode || 'arcade';
    this.jeu.entree = this.entree;
    this.dernier = 0;
    this.reste = 0;
    return this.jeu;
  }

  annonce(nom, d) {
    switch (nom) {
      case 'panneau':
        this.panneau = d.boss ? 'BOSS' : ('niveau ' + (d.level + 1) + '\n' + (d.name || ''));
        this.panneauT = d.boss ? 160 : 80;
        break;
      case 'badsExplose': eclater(d.x, d.y, 6, '#ffd76a', 2.6); break;
      case 'badsEcaille': eclater(d.x, d.y, 3, '#ffffff', 1.6); break;
      case 'heroExplose': eclater(d.x, d.y, 14, '#8fd0ff', 3.2); break;
      case 'heroTouche': eclater(d.x, d.y, 5, '#ffffff', 2); break;
      case 'impact': eclater(d.x, d.y, 2, '#ffffff', 1.2); break;
      case 'bossRenvoi': eclater(d.x, d.y, 3, '#cfe8ff', 2); break;
      case 'bossExplose': eclater(d.x, d.y, 40, '#ffb04a', 4); break;
      case 'soucoupeExplose': eclater(d.x, d.y, 10, '#cfe8ff', 3); break;
      case 'ondeChoc': eclater(d.x, d.y, 20, '#ffffff', 3.4); break;
      case 'saut': eclater(LARGEUR / 2, HAUTEUR / 2, 24, '#8fd0ff', 4); break;
      case 'finPartie':
        this.panneau = (d.raison === 'fin') ? 'BRAVO !' : 'GAME OVER';
        this.panneauT = 1e9;
        break;
      default: break;
    }
    if (this.surEvenement) this.surEvenement(nom, d);
  }

  // ── Boucle ──
  // On avance le moteur par pas d'UNE image nominale : le jeu d'origine se règle
  // sur 40 i/s et ses tirages au sort en dépendent. Un écran à 60 Hz exécute
  // donc parfois deux pas, parfois aucun — jamais un pas « à moitié ».
  demarrer() {
    const boucle = (t) => {
      this.raf = requestAnimationFrame(boucle);
      if (!this.dernier) { this.dernier = t; return; }
      let dt = (t - this.dernier) / 1000;
      this.dernier = t;
      if (dt > 0.25) dt = 0.25;                     // onglet revenu au premier plan
      this.reste += dt * IPS;
      let pas = 0;
      while (this.reste >= 1 && pas < 6) { this.jeu.update(1); this.reste -= 1; pas++; }
      this.dessiner(dt * IPS);
    };
    this.raf = requestAnimationFrame(boucle);
  }
  arreter() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; }

  dessiner(tmod) {
    const ctx = this.ctx, jeu = this.jeu;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    fond(ctx, jeu.defilementDecor());

    for (const b of jeu.badsList) {
      // L'image de coque suit les points de vie : intact = image 1, entamé = 2…
      const sp = this.sprites['bads' + b.type];
      const etat = sp ? Math.min(sp.etats.length, (b.profil.hp || 1) - b.hp + 1) : 1;
      poser(ctx, sp, sp ? sp.etats[Math.max(0, etat - 1)].frame : 1, b.x, b.y);
      // Letter Invader : le caractère à taper, posé sur le monstre. C'est la
      // seule information du mode — sans elle il n'y a pas de jeu.
      if (b.affiche) {
        ctx.font = 'bold 13px Verdana, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.strokeText(b.affiche, b.x, b.y + 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.affiche, b.x, b.y + 1);
      }
    }

    // La soucoupe passe au-dessus de la mêlée ; les bonus tombent devant.
    for (const s of jeu.saucerList) poser(ctx, this.sprites.saucer, 1, s.x, s.y);
    for (const o of jeu.optList) this.dessinerBonus(ctx, o);

    if (jeu.boss) this.dessinerBoss(ctx, jeu.boss);

    for (const t of jeu.bShotList) this.dessinerTir(ctx, t, 10 + (t.badsType || 0));
    for (const t of jeu.hShotList) this.dessinerTir(ctx, t, 1 + (t.heroType || 0));

    if (jeu.hero) {
      // Le bouclier d'apparition : le jeu d'origine ne CACHE pas le vaisseau, il
      // le fait palpiter en blanc (une teinte en cosinus). On garde le principe —
      // le masquer par intermittence le rendrait difficile à suivre au moment
      // précis où l'on vient de le perdre.
      const h = jeu.hero;
      ctx.save();
      if (h.newShield) {
        const pulse = 0.55 + Math.cos(h.newShield.t / 3) * 0.45;
        ctx.globalAlpha = 0.55 + pulse * 0.45;
      }
      poser(ctx, this.sprites['hero' + h.type], 1, h.x, h.y);
      ctx.restore();
      if (h.flEMP) {                       // brouillé : plus de tir
        ctx.strokeStyle = 'rgba(120,220,255,.8)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, 10 + Math.sin(Date.now() / 60) * 2, 0, 6.28);
        ctx.stroke();
      }
    }

    bougerEclats(ctx, tmod);
    this.dessinerInterface(ctx, tmod);
  }

  dessinerBoss(ctx, b) {
    const sp = this.sprites.boss;
    if (!sp) return;
    const frame = (b.forme === E.FORME.COQUILLE) ? sp.etats[0].frame : sp.etats[sp.etats.length - 1].frame;
    ctx.save();
    ctx.translate(b.x, b.y);
    if (b.forme === E.FORME.COQUILLE) ctx.rotate(b.rotation * Math.PI / 180);
    if (b.flash > 0) ctx.globalAlpha = 0.6;   // il vient d'encaisser
    poser(ctx, sp, frame, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
    // Jauge de vie du boss, en haut de l'écran.
    const c = Math.max(0, b.hp / b.hpMax);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(30, 6, LARGEUR - 60, 4);
    ctx.fillStyle = c > 0.5 ? '#7ed957' : (c > 0.25 ? '#ffd76a' : '#ff5a5a');
    ctx.fillRect(30, 6, (LARGEUR - 60) * c, 4);
  }

  // Les bonus n'ont pas de dessin extrait (leur clip est composé à l'exécution :
  // couleurs posées par code, atomes dupliqués…). On les rend selon leur famille,
  // avec les couleurs du jeu : pièces, sauts, cartes, vie.
  dessinerBonus(ctx, o) {
    const b = E.BONUS[o.type] || {};
    const pulse = 0.75 + Math.sin(o.y / 6) * 0.25;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (b.credit !== undefined) {
      const cols = ['#F2D1AA', '#FFFFFF', '#FFF58A', '#A5F89E'];   // bronze, argent, or, platine
      ctx.fillStyle = cols[o.type] || '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, 6.28);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.stroke();
    } else if (b.warp !== undefined) {
      ctx.fillStyle = '#8fd0ff';
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, 6.28);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0b1024';
      ctx.font = 'bold 7px Verdana, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(b.warp), 0, 3);
      ctx.textAlign = 'left';
    } else if (b.nom === 'vie') {
      ctx.globalAlpha = pulse;
      poser(ctx, this.sprites.hero0, 1, 0, 0, 0.8);
      ctx.globalAlpha = 1;
    } else {
      const cols = { carteRouge: '#ff4a4a', carteVerte: '#5aff7a', carteBleue: '#5aa8ff' };
      ctx.fillStyle = cols[b.nom] || '#fff';
      ctx.globalAlpha = pulse;
      ctx.fillRect(-5, -7, 10, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.strokeRect(-5, -7, 10, 14);
    }
    ctx.restore();
  }

  dessinerTir(ctx, t, frame) {
    const sp = this.sprites.shot;
    if (sp && sp.etats.some((e) => e.frame === frame)) {
      // Les projectiles sont dessinés pointe à droite ; le jeu les oriente selon
      // leur vitesse (Shot.updateRotation). Sans ça, le rayon de la Cosmirabelle
      // barrerait l'écran à l'horizontale.
      const a = Math.atan2(t.vity, t.vitx);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(a);
      poser(ctx, sp, frame, 0, 0);
      ctx.restore();
      return;
    }
    // Aspect inconnu (un comportement spécial sans image dédiée) : un point,
    // plutôt qu'un projectile invisible qui tuerait sans prévenir.
    ctx.fillStyle = (t.listName === 'hShot') ? '#bff18d' : '#ff8a5a';
    ctx.fillRect(t.x - 1, t.y - 2, 2, 4);
  }

  dessinerInterface(ctx, tmod) {
    const jeu = this.jeu;
    ctx.font = '8px Verdana, Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#cfe8a0';
    ctx.fillText(String(jeu.score), 4, 3);

    // Vies restantes : un petit vaisseau par vie en réserve.
    for (let i = 0; i < Math.min(jeu.heroList.length, 6); i++) {
      poser(ctx, this.sprites['hero' + (jeu.heroList[i] || 0)], 1, LARGEUR - 8 - i * 11, 8, 0.6);
    }
    // Bombe disponible : elle ne sert qu'une fois, autant que ça se voie.
    if (jeu.hero && jeu.hero.flBomb) {
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      ctx.arc(6, 16, 3, 0, 6.28);
      ctx.fill();
    }
    // Pièces ramassées (la monnaie de la boutique interne).
    if (jeu.credits > 0) {
      ctx.font = '8px Verdana, Arial, sans-serif';
      ctx.fillStyle = '#F2D1AA';
      ctx.fillText('¤' + jeu.credits, 12, 13);
    }
    // Letter Invader : les boucliers, à la place des vies (il n'y a pas de
    // vaisseau à perdre, seulement des fautes de frappe à ne pas faire).
    if (jeu.boucliers !== undefined) {
      ctx.textAlign = 'right';
      ctx.fillStyle = jeu.boucliers > 1 ? '#8fd0ff' : '#ff8a5a';
      ctx.fillText('◆'.repeat(Math.max(0, jeu.boucliers)), LARGEUR - 4, 3);
      ctx.textAlign = 'left';
      if (jeu.combo && jeu.combo.num > 1) {
        ctx.fillStyle = '#ffd76a';
        ctx.fillText('combo ' + jeu.combo.num, 4, 13);
      }
    }
    // Endurance : le palier atteint, seule mesure d'avancement du mode. À
    // GAUCHE sous le score — le coin droit appartient aux vies, et un bonus
    // « vie » en cours de partie viendrait s'écrire par-dessus.
    if (this.mode === 'survival') {
      ctx.fillStyle = '#8fd0ff';
      ctx.fillText('palier ' + (jeu.level + 1), 4, HAUTEUR - 11);
    }

    if (this.panneauT > 0 && this.panneau) {
      this.panneauT -= tmod;
      const lignes = this.panneau.split('\n');
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, HAUTEUR / 2 - 16 * lignes.length / 2 - 6, LARGEUR, 16 * lignes.length + 12);
      lignes.forEach((l, i) => {
        ctx.font = (i === 0 ? 'bold 11px' : '9px') + ' Verdana, Arial, sans-serif';
        ctx.fillStyle = i === 0 ? '#ffd76a' : '#cfe8a0';
        ctx.fillText(l, LARGEUR / 2, HAUTEUR / 2 - 16 * lignes.length / 2 + i * 14);
      });
      ctx.textAlign = 'left';
    }
  }

  // ── Mise à l'échelle ──
  // Les dessins font 16 à 20 pixels : un facteur ENTIER les garde nets. Mais un
  // écran de 400 points ne loge que ×1 d'une aire de 240, ce qui laisserait 40 %
  // de largeur inutilisée — on préfère alors remplir. Règle : l'entier s'il
  // occupe au moins 85 % de la place, sinon la valeur exacte.
  redimensionner() {
    const parent = this.canvas.parentElement || document.body;
    const dispo = Math.min(parent.clientWidth, parent.clientHeight) || 240;
    const exact = dispo / LARGEUR;
    const entier = Math.floor(exact);
    const k = (entier >= 1 && entier / exact >= 0.85) ? entier : exact;
    this.echelle = k;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = LARGEUR * this.dpr;
    this.canvas.height = HAUTEUR * this.dpr;
    this.canvas.style.width = (LARGEUR * k) + 'px';
    this.canvas.style.height = (HAUTEUR * k) + 'px';
    this.ctx.imageSmoothingEnabled = false;
  }

  // ── Commandes ──
  // Clavier pour le bureau (les flèches et l'espace, comme le jeu d'origine), et
  // trois zones tactiles pour le téléphone. Le tir est MAINTENU : le vaisseau a
  // sa propre cadence, inutile de marteler.
  brancherCommandes(racine) {
    const touches = {
      ArrowLeft: 'gauche', ArrowRight: 'droite', ' ': 'tir',
      q: 'gauche', d: 'droite', a: 'gauche',
      ArrowUp: 'tir', Shift: 'bombe',
    };
    window.addEventListener('keydown', (ev) => {
      const k = touches[ev.key];
      if (k) { this.entree[k] = true; ev.preventDefault(); }
    });
    window.addEventListener('keyup', (ev) => {
      const k = touches[ev.key];
      if (k) { this.entree[k] = false; ev.preventDefault(); }
    });

    const boutons = racine.querySelectorAll('[data-cmd]');
    Array.prototype.forEach.call(boutons, (b) => {
      const cmd = b.getAttribute('data-cmd');
      const on = (ev) => { ev.preventDefault(); this.entree[cmd] = true; b.classList.add('on'); };
      const off = (ev) => { ev.preventDefault(); this.entree[cmd] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
      b.addEventListener('mousedown', on);
      b.addEventListener('mouseup', off);
      b.addEventListener('mouseleave', off);
    });
  }
}

window.MiniwaveClient = { Client, charger, chargerDecor, images, decor };

})();
