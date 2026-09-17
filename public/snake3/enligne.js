/*
 * Frutisnake — le CHAMPIONNAT EN LIGNE : le Battle à deux, un contre un, sur
 * le modèle du Championnat de Frutibandas (le salon, les défis, la note
 * d'Elo qui monte et descend à chaque partie entre humains).
 *
 * Deux vues, et un fil (reseau.js) qui leur survit :
 *
 *   · le SALON (VueSalon) — la liste des joueurs présents avec leur note,
 *     « Chercher un adversaire » (le premier qui attend est apparié au
 *     suivant qui cherche) et « Défier » (la partie part sur-le-champ, comme
 *     à Grapiz). Le salon est un panneau HTML posé sur la scène : une liste
 *     qui défile et des boutons, ce que le canevas fait mal ;
 *
 *   · la BATAILLE (VueBatailleEnLigne) — LE SERVEUR JOUE, l'écran MIROITE.
 *     La partie tourne sur le serveur (server/session.js), qui envoie chaque
 *     pas : la tête de chaque serpent, ce qu'il a fait à sa file (points
 *     poussés, pousse, segments partis en particules), les objets posés. Le
 *     client tient deux serpents-miroirs (serpent.js, la même file de points)
 *     et leur refait exactement les mêmes gestes, puis les dessine avec le
 *     rendu de la bataille locale. Il n'envoie que ses touches, quand elles
 *     changent.
 *
 * Les OBJETS : des bombes (mèche de cinq secondes, puis un souffle qui
 * emporte la queue prise dedans et tue la tête qui s'y trouve — la toucher
 * la fait sauter aussitôt), et des fruits (trois segments rendus, turbo
 * plein). Le souffle se montre au sol quand la mèche est courte.
 */
'use strict';

(function () {

const C = window.SnakeConst;
const D = window.SnakeDessin;
const R = window.SnakeRendu;
const SS = window.SnakeSerpent;
const J = window.SnakeJeu;
const { Reseau } = window.SnakeReseau;

const MODE_SALON = 20;
const MODE_BATAILLE = 21;
const RAYON_BOMBE = 100;               // OBJETS.rayonBombe (server/session.js)
const MECHE_COURTE = 2.5;              // le souffle se montre sous ce délai

// ── Le contrôleur : le fil et ce qui passe d'une vue à l'autre ─────────────
function controleur(jeu) {
  if (jeu.enligne) return jeu.enligne;
  const pf = jeu.plateforme;
  const ctl = {
    reseau: null,
    vue: null,                         // la vue qui écoute (salon ou bataille)
    joueurs: [],                       // la dernière liste du salon
    depart: null,                      // le <sb e="start"> à consommer par la bataille
    enAttente: [],                     // les pas arrivés avant que la bataille n'écoute
    etat: 'Connexion…',
    moi: (pf.nom || pf.pseudo || 'joueur'),
    ouvrir() {
      if (this.reseau) return;
      this.reseau = new Reseau({
        sid: pf.sid,
        pseudo: this.moi,
        nom: this.moi,
        bouille: pf.bouille || '',
        surEtat: (t) => { this.etat = t; if (this.vue && this.vue.surEtat) this.vue.surEtat(t); },
        surEvenement: (e, el) => this.evenement(e, el),
      });
      this.reseau.connecter();
    },
    fermer() {
      if (this.reseau) { this.reseau.sb({ a: 'part' }); this.reseau.fermer(); }
      this.reseau = null;
      this.vue = null;
      this.depart = null;
      this.enAttente = [];
      jeu.enligne = null;
    },
    evenement(e, el) {
      if (e === 'lobby') {
        this.joueurs = [...el.getElementsByTagName('pl')].map((n) => ({
          u: n.getAttribute('u'), n: n.getAttribute('n'), s: n.getAttribute('s'),
          no: Number(n.getAttribute('no')) || 0, pj: Number(n.getAttribute('pj')) || 0,
          bot: n.getAttribute('bot') === '1',
        }));
      }
      if (e === 'start') {
        // La partie part : la bataille consommera cet état entier.
        this.depart = el;
        this.enAttente = [];
        if (!(this.vue instanceof VueBatailleEnLigne)) { jeu.forcerMode(MODE_BATAILLE); return; }
      }
      if ((e === 'state' || e === 'end') && !(this.vue instanceof VueBatailleEnLigne)) {
        this.enAttente.push([e, el]);
        return;
      }
      if (this.vue && this.vue.evenement) this.vue.evenement(e, el);
    },
  };
  jeu.enligne = ctl;
  return ctl;
}

// ── Le salon ───────────────────────────────────────────────────────────────
class VueSalon {
  constructor(jeu) {
    this.jeu = jeu;
    this.ctl = controleur(jeu);
    this.ctl.vue = this;
    this.ctl.ouvrir();
    this.titre = { echelle: 100, rotation: 0, ds: 2, dr: 0.3 };
    this.panneau = document.getElementById('salon');
    this._rect = '';
    this._construire();
    this.rendre();

    const sons = jeu.sons;
    if (!sons.isPlaying(C.SOUND_MENU_LOOP, C.CHANNEL_MUSIC_1)) {
      sons.setVolume(C.CHANNEL_MUSIC_1, 0);
      sons.fade(C.CHANNEL_MUSIC_2, C.CHANNEL_MUSIC_1, C.MUSIC_FADE_LENGTH);
      sons.loop(C.SOUND_MENU_LOOP, C.CHANNEL_MUSIC_1);
    }
  }

  _construire() {
    const p = this.panneau;
    if (!p) return;
    p.innerHTML = '';
    const el = (tag, cls, texte) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (texte != null) e.textContent = texte;
      return e;
    };
    this.$titre = el('div', 'sl-titre', 'Championnat en ligne — 1 contre 1');
    this.$serie = el('div', 'sl-serie', '');
    this.$etat = el('div', 'sl-etat', this.ctl.etat);
    this.$chercher = el('button', 'sl-btn sl-chercher', 'Chercher un adversaire');
    this.$chercher.addEventListener('click', () => this.chercher());
    this.$liste = el('div', 'sl-liste');
    this.$retour = el('button', 'sl-btn sl-retour', '‹ Retour au menu');
    this.$retour.addEventListener('click', () => this.retour());
    const haut = el('div', 'sl-haut');
    haut.appendChild(this.$titre);
    haut.appendChild(this.$serie);
    p.appendChild(haut);
    p.appendChild(this.$chercher);
    p.appendChild(el('div', 'sl-sous', 'Les joueurs présents — touche un pseudo pour le défier'));
    p.appendChild(this.$liste);
    p.appendChild(this.$etat);
    p.appendChild(this.$retour);
    p.hidden = false;
  }

  moi() { return this.ctl.joueurs.find((j) => j.u === (this.jeu.plateforme.pseudo || '').toLowerCase() || j.n === this.ctl.moi) || null; }

  chercher() {
    const r = this.ctl.reseau;
    if (!r) return;
    const moi = this.moi();
    this.jeu.sons.play(C.SOUND_SELECT_MENU);
    if (moi && moi.s === 'waiting') r.sb({ a: 'cancel' });
    else r.sb({ a: 'seek' });
  }

  defier(u) {
    const r = this.ctl.reseau;
    if (!r) return;
    this.jeu.sons.play(C.SOUND_SELECT_MENU);
    r.sb({ a: 'challenge', u });
  }

  retour() {
    this.ctl.fermer();
    if (this.panneau) this.panneau.hidden = true;
    this.jeu.retourMenu();
  }

  surEtat(t) { if (this.$etat) this.$etat.textContent = t; }

  evenement(e, el) {
    if (e === 'lobby') this.rendre();
    else if (e === 'err') {
      const m = el.getAttribute('m');
      const TXT = {
        'not-logged': 'Connecte-toi à Frutiparc pour jouer en ligne.',
        'target-busy': 'Ce joueur est déjà en partie.',
        'challenger-busy': 'Tu es déjà en partie.',
        'already-busy': 'Tu es déjà en partie.',
        'unknown-player': 'Ce joueur n’est plus là.',
        'self-challenge': 'Te défier toi-même ? Non.',
      };
      this.surEtat(TXT[m] || ('⚠ ' + m));
    } else if (e === 'chat') { /* pas de tchat dans le salon du serpent */ }
  }

  rendre() {
    if (!this.$liste) return;
    const moi = this.moi();
    const enAttente = !!(moi && moi.s === 'waiting');
    this.$chercher.textContent = enAttente ? 'Annuler la recherche…' : 'Chercher un adversaire';
    this.$chercher.classList.toggle('sl-attend', enAttente);
    this.$serie.textContent = moi ? ('Ta note : ' + moi.no + (moi.pj ? ' (' + moi.pj + (moi.pj > 1 ? ' parties)' : ' partie)') : ' (placement)')) : '';
    this.$liste.innerHTML = '';
    const ETAT = { idle: 'disponible', waiting: 'cherche un adversaire', playing: 'en partie' };
    // Les humains par note, les bots (sans note) à la fin.
    const tri = [...this.ctl.joueurs].sort((a, b) => (Number(a.bot) - Number(b.bot)) || (b.no - a.no) || a.n.localeCompare(b.n));
    for (const j of tri) {
      const ligne = document.createElement('button');
      ligne.type = 'button';
      ligne.className = 'sl-joueur sl-' + j.s + (moi && j.u === moi.u ? ' sl-moi' : '');
      const nom = document.createElement('span');
      nom.className = 'sl-nom';
      nom.textContent = j.n + (j.bot ? ' 🤖' : '');
      const serie = document.createElement('span');
      serie.className = 'sl-sr';
      serie.textContent = j.bot ? 'entraînement' : String(j.no);
      const etat = document.createElement('span');
      etat.className = 'sl-statut';
      etat.textContent = (moi && j.u === moi.u) ? 'toi' : (ETAT[j.s] || j.s);
      ligne.appendChild(nom);
      ligne.appendChild(serie);
      ligne.appendChild(etat);
      const peutDefier = !(moi && j.u === moi.u) && j.s !== 'playing';
      ligne.disabled = !peutDefier;
      if (peutDefier) ligne.addEventListener('click', () => this.defier(j.u));
      this.$liste.appendChild(ligne);
    }
    if (!tri.length) {
      const vide = document.createElement('div');
      vide.className = 'sl-vide';
      vide.textContent = 'Personne pour l’instant…';
      this.$liste.appendChild(vide);
    }
  }

  close() { if (this.panneau) this.panneau.hidden = true; }
  presser() {}

  main(tmod) {
    const t = this.titre;
    t.echelle += t.ds;
    t.rotation += t.dr;
    if (t.echelle > 110 || t.echelle < 90) t.ds *= -1;
    if (t.rotation > 2 || t.rotation < -2) t.dr *= -1;
    // Le panneau HTML suit la scène (le canevas se redimensionne avec la
    // fenêtre) : on le cale sur son rectangle, en pixels CSS.
    const p = this.panneau;
    if (p) {
      const c = this.jeu.canvas;
      const k = this.jeu.echelle;
      const cle = c.offsetLeft + ',' + c.offsetTop + ',' + c.offsetWidth + ',' + c.offsetHeight + ',' + k;
      if (cle !== this._rect) {
        this._rect = cle;
        p.style.left = c.offsetLeft + 'px';
        p.style.top = c.offsetTop + 'px';
        p.style.width = c.offsetWidth + 'px';
        p.style.height = c.offsetHeight + 'px';
        p.style.setProperty('--k', String(k));
      }
      if (p.hidden) p.hidden = false;
    }
  }

  dessiner(ctx) {
    D.poser(ctx, 'menuBackground', 1, 0, 0, 1, 1, 0);
    D.poser(ctx, 'title', 1, C.WIDTH / 2, 80,
      this.titre.echelle / 100, this.titre.echelle / 100,
      this.titre.rotation * Math.PI / 180);
  }
}

// ── La bataille en ligne : le miroir ───────────────────────────────────────
class VueBatailleEnLigne {
  constructor(jeu) {
    this.jeu = jeu;
    this.ctl = controleur(jeu);
    this.ctl.vue = this;
    this.enligne = true;
    this.peintToutLeFond = true;
    this.particules = new R.Particules(J.hasard);
    this.ecran = null;
    this.niveau = { corner: { x: C.BORDER, y: C.BARRE_UP }, width: C.WIDTH - C.BORDER * 2,
      height: C.HEIGHT - (C.BARRE_DOWN + C.BARRE_UP) };
    this.serpents = [null, null];
    this.powers = [C.BATTLE_POWER_MAX, C.BATTLE_POWER_MAX];
    this.vivants = [true, true];
    this.joueurs = [];
    this.monEquipe = -1;
    this.phase = 'compte';
    this.compte = 3;
    this.numero = 0;
    this.objets = [];
    this.souffles = [];                // { x, y, frame } — la bombe qui saute
    this.finie = false;
    this.dernierEnvoi = null;
    this.jeu.tmodForce = 1;

    const sons = jeu.sons;
    sons.setVolume(C.CHANNEL_MUSIC_2, 0);
    sons.fade(C.CHANNEL_MUSIC_1, C.CHANNEL_MUSIC_2, C.MUSIC_FADE_LENGTH);
    sons.loop(C.SOUND_GAME_LOOP, C.CHANNEL_MUSIC_2);

    if (this.ctl.depart) { this.appliquerDepart(this.ctl.depart); this.ctl.depart = null; }
    for (const [e, el] of this.ctl.enAttente) this.evenement(e, el);
    this.ctl.enAttente = [];
  }

  enJeu() { return !this.ecran; }

  // ── Les miroirs ──
  _naitre(i, x, y) {
    const s = new SS.Serpent({
      x, y, hasard: J.hasard,
      evenement: (nom, d) => {
        if (nom === 'son') this.jeu.sons.play(d.nom);
        else if (nom === 'explosion') this.particules.eclater(d.x, d.y, d.couleur);
      },
    });
    s.color = C.BATTLE_COLORS[i];
    s.border_color = C.BATTLE_BORDER_COLORS[i];
    if (i > 0) s.tete_frame = 10 + i;
    return s;
  }

  _lireJoueurs(el) {
    const pls = [...el.getElementsByTagName('p')];
    if (!pls.length) return;
    this.joueurs = pls.map((p) => ({
      u: p.getAttribute('u'), n: p.getAttribute('n'), e: Number(p.getAttribute('e')),
      no: Number(p.getAttribute('no')) || 0,
      dn: p.hasAttribute('dn') ? Number(p.getAttribute('dn')) : null,
    }));
    this.classe = el.getAttribute('cl') !== '0';
    const moi = this.joueurs.find((j) => j.n === this.ctl.moi || j.u === (this.jeu.plateforme.pseudo || '').toLowerCase());
    this.monEquipe = moi ? moi.e : -1;
  }

  _lireEntete(el) {
    this.phase = el.getAttribute('ph') || this.phase;
    this.compte = Number(el.getAttribute('cd')) || 0;
    this.numero = Number(el.getAttribute('n')) || 0;
  }

  // <sb e="start"> : l'état ENTIER, files comprises (départ ou reprise).
  appliquerDepart(el) {
    this._lireJoueurs(el);
    this._lireEntete(el);
    for (const n of el.getElementsByTagName('s')) {
      const i = Number(n.getAttribute('i'));
      const x = Number(n.getAttribute('x')), y = Number(n.getAttribute('y'));
      const s = this._naitre(i, x, y);
      const file = n.getAttribute('file');
      if (file) {
        s.queue = file.split(' ').filter(Boolean).map((p) => {
          const [px, py] = p.split(',');
          return { x: Number(px), y: Number(py) };
        });
      }
      this.serpents[i] = s;
      this._poserChamps(s, i, n);
    }
    this._lireObjets(el);
    if (el.getAttribute('end') === '1') this._fin(el);
  }

  _poserChamps(s, i, n) {
    s.x = Number(n.getAttribute('x'));
    s.y = Number(n.getAttribute('y'));
    s.ang = Number(n.getAttribute('a'));
    s.speed = Number(n.getAttribute('v'));
    s.len = Number(n.getAttribute('l'));
    s.eat = Number(n.getAttribute('e'));
    this.powers[i] = Number(n.getAttribute('p'));
    this.vivants[i] = n.getAttribute('k') === '1';
    if (n.getAttribute('fin') === '1') s.vivant = false;
  }

  _lireObjets(el) {
    this.objets = [...el.getElementsByTagName('o')].map((o) => ({
      id: Number(o.getAttribute('i')), type: o.getAttribute('t') === 'b' ? 'bombe' : 'fruit',
      x: Number(o.getAttribute('x')), y: Number(o.getAttribute('y')),
      vie: Number(o.getAttribute('v')), fid: Number(o.getAttribute('f')),
    }));
    for (const ex of el.getElementsByTagName('ex')) {
      this.souffles.push({ x: Number(ex.getAttribute('x')), y: Number(ex.getAttribute('y')), frame: 2 });
      this.jeu.sons.play('dynamite');
    }
    for (const mg of el.getElementsByTagName('mg')) {
      const e = Number(mg.getAttribute('e'));
      this.jeu.sons.play(e === this.monEquipe ? 'glurps' : 'glurps_2');
    }
  }

  // <sb e="state"> : un pas. Les gestes dans L'ORDRE du serveur (Battle.main) :
  // la pousse, les particules, puis les points poussés par le mouvement.
  appliquer(el) {
    this._lireEntete(el);
    for (const n of el.getElementsByTagName('s')) {
      const i = Number(n.getAttribute('i'));
      const s = this.serpents[i];
      if (!s) continue;
      if (n.getAttribute('g') === '1') s.add_queue(-1);
      const xp = Number(n.getAttribute('xp')) || 0;
      for (let k = 0; k < xp; k++) s.explode(s.color);
      const q = Number(n.getAttribute('q')) || 0;
      if (q > 0) {
        const p = { x: Number(n.getAttribute('x')), y: Number(n.getAttribute('y')) };
        for (let k = 0; k < q; k++) s.queue.push(p);
        s.redraw = true;
      }
      this._poserChamps(s, i, n);
    }
    this._lireObjets(el);
    if (el.getAttribute('end') === '1') this._fin(el);
  }

  _fin(el) {
    if (this.finie) return;
    this.finie = true;
    this._lireJoueurs(el);
    const w = Number(el.getAttribute('w'));
    const r = el.getAttribute('r');
    const moi = this.joueurs.find((j) => j.e === this.monEquipe);
    const autre = this.joueurs.find((j) => j.e !== this.monEquipe);
    let texte;
    if (w < 0) texte = C.TXT_BATTLE_DRAW;
    else if (w === this.monEquipe) {
      texte = 'Tu as gagné !' + (r === 'forfeit' ? '\n' + ((autre && autre.n) || 'Ton adversaire') + ' a abandonné.' : '');
    } else texte = C.TXT_BATTLE_WIN(w);
    // La note : de combien elle vient de bouger — ou pourquoi elle n'a pas
    // bougé (un entraînement contre un bot ne compte pas).
    if (moi && moi.dn != null) {
      texte += '\nTa note : ' + moi.no + ' (' + (moi.dn >= 0 ? '+' : '') + moi.dn + ')';
    } else if (!this.classe) {
      texte += '\nEntraînement : la note ne bouge pas.';
    }
    this.ecran = new J.Ecran(this.jeu, 'resultat', texte);
    if (w >= 0) this.ecran.panCouleur = w + 1;
    this.ecran.poserPresse(() => this.jeu.forcerMode(MODE_SALON));
    const sons = this.jeu.sons;
    sons.setVolume(C.CHANNEL_MUSIC_1, 0);
    sons.fade(C.CHANNEL_MUSIC_2, C.CHANNEL_MUSIC_1, C.MUSIC_FADE_LENGTH);
    sons.play('game_over');
  }

  evenement(e, el) {
    if (e === 'state' || e === 'end') this.appliquer(el);
    else if (e === 'start') this.appliquerDepart(el);
  }

  close() {}
  presser() { if (this.ecran) this.ecran.presser(); }

  main(tmod, deltaT) {
    // Mes touches : le joueur 1 du clavier (ou le pavé tactile), envoyées
    // quand elles changent.
    if (!this.finie && this.ctl.reseau) {
      const e = this.jeu.entreesBataille()[0];
      const cle = (e.gauche ? 1 : 0) + ',' + (e.droite ? 1 : 0) + ',' + (e.haut ? 1 : 0);
      if (cle !== this.dernierEnvoi) {
        this.dernierEnvoi = cle;
        this.ctl.reseau.sb({ a: 'input', g: e.gauche ? '1' : '0', d: e.droite ? '1' : '0', h: e.haut ? '1' : '0' });
      }
    }
    this.particules.main(tmod);
    for (let i = 0; i < this.souffles.length; i++) {
      const b = this.souffles[i];
      b.frame += deltaT * C.SWF_FPS;
      if (b.frame > 22) { this.souffles.splice(i, 1); i--; }
    }
    if (this.ecran) this.ecran.main(tmod);
  }

  dessiner(ctx) {
    const jeu = this.jeu;
    J.dessinerFondArene(ctx, jeu, this.niveau);

    // Les objets, au sol : le souffle qui vient quand la mèche est courte,
    // puis la bombe ou le fruit.
    for (const o of this.objets) {
      if (o.type === 'bombe') {
        if (o.vie < MECHE_COURTE) {
          const bat = 0.18 + 0.14 * Math.abs(Math.sin(jeu.temps() * 1.4));
          ctx.save();
          ctx.globalAlpha = bat;
          ctx.fillStyle = '#ff3b1f';
          ctx.beginPath();
          ctx.arc(o.x, o.y, RAYON_BOMBE, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        D.poser(ctx, 'bombe', 1, o.x, o.y, 1, 1, 0);
      } else {
        D.poser(ctx, 'fruits', o.fid, o.x, o.y, 1, 1, 0);
      }
    }
    // Le souffle du clip est taillé pour le rayon du Challenge (160) : on le
    // ramène à celui du Battle.
    const ks = RAYON_BOMBE / C.RAYON_BOMBE;
    for (const b of this.souffles) {
      D.poser(ctx, 'bombe', Math.max(1, Math.min(22, Math.floor(b.frame))), b.x, b.y, ks, ks, 0);
    }

    for (const s of this.serpents) {
      if (!s || s.vivant === false) continue;
      R.dessinerSerpent(ctx, s, jeu.tmod, jeu.temps());
      R.dessinerTete(ctx, s, s.tete_frame || 1);
    }
    this.particules.dessiner(ctx);

    // Les jauges de turbo et les noms : joueur 0 à gauche, 1 à droite.
    for (let i = 0; i < 2; i++) {
      if (!this.vivants[i]) continue;
      const p = this.powers[i] * 5;
      const x = (i === 0) ? 20 : C.WIDTH - p - 20;
      this.dessinerJauge(ctx, x, 20, p, i);
    }
    ctx.save();
    ctx.font = 'bold 12px Verdana12StB, Verdana, sans-serif';
    for (const j of this.joueurs) {
      const couleur = R.rgb(C.BATTLE_COLORS[j.e]);
      ctx.fillStyle = couleur;
      ctx.textAlign = j.e === 0 ? 'left' : 'right';
      const x = j.e === 0 ? 20 : C.WIDTH - 20;
      ctx.fillText(j.n + (j.no ? '  ' + j.no : '') + (j.e === this.monEquipe ? '  (toi)' : ''), x, 48);
    }
    ctx.restore();

    // Le compte à rebours, au centre.
    if (this.phase === 'compte' && !this.finie) {
      const n = Math.ceil(this.compte);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2a5a08';
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.font = 'bold 84px Verdana, sans-serif';
      ctx.strokeText(String(n), C.WIDTH / 2, C.HEIGHT / 2 + 24);
      ctx.fillText(String(n), C.WIDTH / 2, C.HEIGHT / 2 + 24);
      ctx.font = '14px Verdana14St, Verdana, sans-serif';
      ctx.lineWidth = 4;
      const moi = this.joueurs.find((j) => j.e === this.monEquipe);
      const txt = moi ? 'Tu es le serpent ' + C.TXT_COLOR[moi.e].trim() : 'Prêt ?';
      ctx.strokeText(txt, C.WIDTH / 2, C.HEIGHT / 2 + 60);
      ctx.fillText(txt, C.WIDTH / 2, C.HEIGHT / 2 + 60);
      ctx.restore();
    }

    if (this.ecran) this.ecran.dessiner(ctx);
  }

  dessinerJauge(ctx, x, y, v, i) {
    const mid = D.rendre('barMid', i + 1, 1);
    if (mid) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(Math.max(0.001, v / mid.lw), 1);
      ctx.drawImage(mid.c, 0, mid.dy, mid.lw, mid.lh);
      ctx.restore();
    }
    D.poser(ctx, 'barSide', i + 1, x, y, 1, 1, 0);
    D.poser(ctx, 'barSide', i + 1, x + v, y, -1, 1, 0);
  }
}

window.SnakeEnLigne = { VueSalon, VueBatailleEnLigne, controleur, MODE_SALON, MODE_BATAILLE };

})();
