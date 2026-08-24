/*
 * Frutisnake — le portage HTML du jeu Flash de 2004, jouable au doigt.
 *
 * Ce fichier est le chef d'orchestre : Manager.as (les modes et leurs
 * transitions), Text.as (les écrans à panneau), et les deux VUES — la partie
 * classique (Game.as côté écran, le moteur étant partie.js) et la bataille.
 *
 * La scène fait 700×480 pixels logiques, à 32 images par seconde de rythme
 * interne (Std.wantedFPS ; tmod = tmod·0,95 + images_écoulées·0,05, l'écart
 * borné à une demi-seconde — la même horloge élastique que le SWF). Le canvas
 * couvre les pixels PHYSIQUES (échelle × devicePixelRatio) pour rester net
 * sur tout écran, les entrées restant en pixels CSS.
 *
 * Écarts assumés avec le SWF, tous commentés en place :
 *   · la dualité disque blanc/noir n'existe pas en light — le menu offre
 *     Challenge, Battle, Options et Encyclopédie à la fois, la barrière
 *     Fruit Défendu restant côté serveur (comme les autres portages light) ;
 *   · le clignement des yeux de la tête et le frétillement des chiffres du
 *     score restent immobiles (des sous-clips d'ambiance du SWF).
 */
'use strict';

(function () {

const C = window.SnakeConst;
const D = window.SnakeDessin;
const R = window.SnakeRendu;
const SS = window.SnakeSerpent;
const B = window.SnakeBonus;
const P = window.SnakePartie;
const BA = window.SnakeBataille;
const M = window.SnakeMenu;
const E = window.SnakeEncyclo;

const hasard = (n) => Math.floor(Math.random() * (n || 0));

// ── Text.as — un écran à panneau (screens 483), qui rebondit en entrant ───
// Étiquettes du clip : pause=1, gameOver=7, connexion=15, resultat=24,
// fruit=32, text=39. Le panneau `pan` reste sur sa première image (vert) —
// sauf en bataille, où le vainqueur teinte l'écran de sa couleur.
const ECRANS = { pause: 1, gameOver: 7, connexion: 15, resultat: 24, fruit: 32, text: 39 };

class Ecran {
  constructor(jeu, ecran, texte) {
    this.jeu = jeu;
    this.frame = ECRANS[ecran] || ECRANS.text;
    this.texte = texte || '';
    this.titre = null;
    this.fruit = null;
    this.panCouleur = 1;
    this.surPresse = null;
    // PopupFX(screen, 0, 100, 10, 3, 1.2, 0.6, 0.5, 1) — l'entrée élastique.
    this.fx = new D.PopupFX(0, 100, 10, 3, 1.2, 0.6, 0.5, 1);
    this.fx.main(1);
  }

  poserEcran(ecran) { this.frame = ECRANS[ecran] || ECRANS.text; }
  poserTexte(t) { this.texte = t; }
  poserTitre(t) { this.titre = t; }
  poserFruit(id) { this.fruit = id; }
  poserPresse(f) { this.surPresse = f; }
  close() {}

  presser() {
    if (this.surPresse) {
      const f = this.surPresse;
      this.surPresse = null;
      f();
    }
  }

  main(tmod) { this.fx.main(tmod); }

  dessiner(ctx) {
    const k = this.fx.z / 100;
    if (k <= 0) return;
    ctx.save();
    ctx.translate(C.WIDTH / 2, C.HEIGHT / 2);
    ctx.scale(k, k);
    // Le panneau d'abord (sa couleur : verte, ou celle du vainqueur en
    // Battle — Text.setBgColor), puis l'écran sans panneau par-dessus.
    const pose = D.manifeste.cadres.panPose;
    D.poser(ctx, 'pan', this.panCouleur, pose[4], pose[5], 1, 1, 0);
    D.poser(ctx, 'screensSans', this.frame, 0, 0, 1, 1, 0);

    // Le texte du panneau (fieldText — verdana_12pt_st 12 px, blanc, centré,
    // recentré verticalement comme Text.setText). Sur l'écran « fruit », le
    // champ est décalé à droite du fruit.
    const surFruit = this.frame === ECRANS.fruit;
    const cx = surFruit ? 64.55 : 7.05;
    ctx.font = '12px Verdana12St, Verdana, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    const lignes = String(this.texte).split('\n');
    const interligne = 15;
    const y0 = -((lignes.length - 1) * interligne) / 2;
    lignes.forEach((l, i) => { if (l) ctx.fillText(l, cx, y0 + i * interligne + 4); });

    // Le titre des écrans « text » (champ 477 — Verdana 12 grise, en haut).
    if (this.titre && this.frame === ECRANS.text) {
      ctx.fillStyle = '#999999';
      ctx.fillText(this.titre, 7, -115);
    }

    // Le fruit annoncé (mcFruit à −124.8, 9.8).
    if (surFruit && this.fruit != null) {
      D.poser(ctx, 'fruits', this.fruit, -124.8, 9.8, 1, 1, 0);
    }
    ctx.restore();
  }
}

// ── Transition.as — le rideau-masque entre deux modes ─────────────────────
// Un rectangle (snakeMask) centré, qui rétrécit de 400 % vers 0 (le mode
// suivant naît à zéro), puis regrandit — |taille| fait l'aller-retour.
class Transition {
  constructor(jeu, mode) {
    this.jeu = jeu;
    this.mode = mode;
    this.reversed = false;
    this.taille = 400;
    this.main(1);
  }

  main(tmod, deltaT) {
    this.taille -= tmod * 15;
    if (this.mode && this.mode.main) this.mode.main(tmod, deltaT);
    if (!this.reversed && this.taille < 0) {
      this.reversed = true;
      if (this.mode && this.mode.close) this.mode.close();
      this.mode = this.jeu.modeSuivant();
    }
    if (this.taille < -400) {
      const m = this.mode;
      this.mode = null;
      this.jeu.basculerMode(m);
    }
  }

  // Manager.switchMode a déjà décroché `mode` quand la transition s'achève :
  // close() ne doit alors rien fermer (en AS2, l'appel sur null se tait).
  close() { if (this.mode && this.mode.close) this.mode.close(); }
  presser(x, y) { if (this.mode && this.mode.presser) this.mode.presser(x, y); }
  relacher() { if (this.mode && this.mode.relacher) this.mode.relacher(); }
  glisser(x, y) { if (this.mode && this.mode.glisser) this.mode.glisser(x, y); }

  dessiner(ctx) {
    if (!this.mode || !this.mode.dessiner) return;
    const k = Math.abs(this.taille) / 100;
    const masque = D.rendre('snakeMask', 1, Math.max(0.05, k));
    if (!masque) { this.mode.dessiner(ctx); return; }
    // Transition.as pose le rideau au centre de la scène et lui donne
    // |mask_size| % d'échelle, puis `mc.setMask(mask)`. On refait exactement
    // ça : le mode se dessine dans un tampon, que la silhouette du rideau
    // découpe (destination-in) avant d'être collée sur la scène.
    const tampon = Transition.tampon(this.jeu);
    const t = tampon.getContext('2d');
    const n = this.jeu.nettete;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, tampon.width, tampon.height);
    t.setTransform(n, 0, 0, n, 0, 0);
    this.mode.dessiner(t);
    t.globalCompositeOperation = 'destination-in';
    t.translate(C.WIDTH / 2, C.HEIGHT / 2);
    t.scale(k, k);
    t.drawImage(masque.c, masque.dx, masque.dy, masque.lw, masque.lh);
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tampon, 0, 0);
    ctx.restore();
  }

  // Un seul tampon pour toutes les transitions, à la taille du canvas.
  static tampon(jeu) {
    const l = jeu.canvas.width, h = jeu.canvas.height;
    if (!Transition._t || Transition._t.width !== l || Transition._t.height !== h) {
      Transition._t = document.createElement('canvas');
      Transition._t.width = l;
      Transition._t.height = h;
    }
    return Transition._t;
  }
}

// ── La partie classique, côté écran (Game.as) ─────────────────────────────
class VuePartie {
  constructor(jeu) {
    this.jeu = jeu;
    this.popups = [];
    this.particules = new R.Particules(hasard);
    this.enrobages = new Map();       // objet moteur → Enrobage
    this.bombes = [];                 // { x, y, frame } — la mèche puis le souffle
    this.serpentsNoirs = [];
    this.sonnettes = [];              // { x, y, temps }
    this.trouFx = null;
    this.ecran = null;                // l'écran par-dessus (sauvegarde, gameOver…)
    this.scoreMc = new D.Nombre('chiffresVert');
    this.finie = false;

    const sons = jeu.sons;
    sons.setVolume(C.CHANNEL_MUSIC_2, 0);
    sons.fade(C.CHANNEL_MUSIC_1, C.CHANNEL_MUSIC_2, C.MUSIC_FADE_LENGTH);
    sons.loop(C.SOUND_GAME_LOOP, C.CHANNEL_MUSIC_2);

    this.fbarreMid = 0;               // mid._width, lissé à 0,9/0,1 chaque image

    this.partie = new P.Partie({
      hasard,
      dims: jeu.dims,
      fruits: jeu.plateforme.fruits,
      evenement: (nom, d) => this.surEvenement(nom, d),
    });
    // Le terrier d'où sort le serpent : PopupFX(100, 0, 0, 3, 1, 0, 0, 0),
    // détruit sous z = 3 (Game.as).
    this.trouFx = new D.PopupFX(100, 0, 0, 3, 1, 0, 0, 0);
  }

  surEvenement(nom, d) {
    const jeu = this.jeu;
    switch (nom) {
      case 'son': jeu.sons.play(d.nom); break;
      case 'popup': this.popups.push(new R.PopupPoints(hasard, d.x, d.y, d.valeur)); break;
      case 'explosion': this.particules.eclater(d.x, d.y, d.couleur); break;
      case 'fruitPose': this.enrobages.set(d.fruit, new R.Enrobage(d.fruit, 'fruit')); break;
      case 'bonusPose': this.enrobages.set(d.bonus, new R.Enrobage(d.bonus, 'bonus')); break;
      case 'fruitMange': this.enrobages.delete(d.fruit); break;
      case 'bonusPris': this.enrobages.delete(d.bonus); break;
      case 'fruitDisparait': {
        const e = this.enrobages.get(d.fruit);
        if (e) e.disparait = true;
        break;
      }
      case 'bonusDisparait': {
        const e = this.enrobages.get(d.bonus);
        if (e) e.disparait = true;
        break;
      }
      case 'bombePosee': this.bombes.push({ x: d.x, y: d.y, frame: 1, explose: false }); break;
      case 'bombeExplose': {
        const b = this.bombes.find((v) => v.x === d.x && v.y === d.y && !v.explose);
        if (b) { b.explose = true; b.frame = 2; }
        break;
      }
      case 'serpentNoir': this.serpentsNoirs.push(d.serpent); break;
      case 'serpentNoirParti': {
        const i = this.serpentsNoirs.indexOf(d.serpent);
        if (i >= 0) this.serpentsNoirs.splice(i, 1);
        break;
      }
      case 'sonnetteSonne': this.sonnettes.push({ x: d.x, y: d.y, temps: 0.6 }); break;
      case 'gameOver': {
        // Game.game_over — la musique bascule sur le jingle.
        const sons = jeu.sons;
        sons.setVolume(C.CHANNEL_MUSIC_1, 0);
        sons.fade(C.CHANNEL_MUSIC_2, C.CHANNEL_MUSIC_1, C.MUSIC_FADE_LENGTH);
        sons.playSound(C.SOUND_GAME_OVER, C.CHANNEL_MUSIC_1);
        break;
      }
      case 'finPartie': this.finDePartie(d.score); break;
      case 'pause': break;            // l'affichage lit partie.pause en direct
      default: break;
    }
  }

  // Game.as fin de partie : « Sauvegarde en cours... », le score part au
  // serveur, la réponse fait l'écran gameOver, puis la chaîne des fruits
  // fraîchement débloqués, et retour au menu.
  finDePartie(score) {
    const jeu = this.jeu;
    this.finie = true;
    this.ecran = new Ecran(jeu, 'connexion', C.TXT_SCORE_SAVING);

    const pf = jeu.plateforme;
    const ancienRecord = pf.record;
    if (score > pf.record) pf.record = score;
    // La collection enrichie par la partie est déjà dans pf.fruits (le
    // moteur partage l'objet). On la range, puis le score.
    const scoreEnvoye = Math.max(0, Math.floor(score));
    Promise.all([pf.sauverSlot0(), pf.sauverScore(scoreEnvoye)]).then(([, rep]) => {
      // Manager.scoreSaved, mot pour mot.
      let texte = C.TXT_VOTRE_SCORE(scoreEnvoye) + '\n';
      const vieux = rep && rep.oldScore != null ? rep.oldScore : ancienRecord;
      const oldPos = rep ? rep.oldPos : 0;
      const newPos = rep ? rep.newPos : 0;
      if (scoreEnvoye > vieux && oldPos > 0) texte += C.TXT_SCORE_BATTU + '\n';
      if (newPos > 0 && newPos < oldPos && oldPos > 0) texte += C.TXT_PLACE_GAGNEES(oldPos - newPos) + '\n';
      if (newPos > 0) texte += C.TXT_VOTRE_PLACE(newPos) + '\n';
      else texte += C.TXT_VOTRE_RECORD(Math.max(scoreEnvoye, ancienRecord)) + '\n';

      this.ecran.poserEcran('gameOver');
      this.ecran.poserTexte(texte);
      this.ecran.poserPresse(() => this.chaineFruits());
    });
  }

  // Game.endGame — un écran par fruit passé au seuil des vingt pendant la
  // partie, puis le retour au menu.
  chaineFruits() {
    const partie = this.partie;
    const fruits = this.jeu.plateforme.fruits;
    for (const k of Object.keys(fruits)) {
      if (fruits[k] > C.FRUIT_DEBLOK - 1 && !partie.fruit_flags[k]) {
        partie.marquerFruitAnnonce(k);
        this.ecran = new Ecran(this.jeu, 'fruit', C.TXT_SCORE_WIN_FRUIT(Number(k), fruits[k]));
        this.ecran.poserFruit(Number(k));
        this.ecran.poserPresse(() => this.chaineFruits());
        return;
      }
    }
    this.jeu.forcerMode(0);           // Manager.restartGame → le menu
  }

  close() {}

  presser(x, y) {
    if (this.ecran) { this.ecran.presser(); return; }
    // Au doigt, un appui sur l'aire de jeu UTILISE l'option active — c'est ce
    // que fait la barre d'espace au clavier. La manette garde son bouton ;
    // celui-ci évite d'avoir à le viser en pleine course.
    this.jeu.impulsionOption();
  }

  main(tmod, deltaT) {
    const partie = this.partie;
    partie.entree = this.jeu.entreesPartie();
    partie.main(tmod, deltaT);

    if (this.trouFx) {
      this.trouFx.main(tmod);
      if (this.trouFx.z < 3) this.trouFx = null;
    }

    // La frutibarre : mid._width glisse vers fb, b2 suit (Game.as).
    const fb = partie.fbarre / C.FBARRE_MAX * (C.WIDTH - 125);
    if (this.fbarreMid !== fb) this.fbarreMid = this.fbarreMid * 0.9 + fb * 0.1;

    for (const e of this.enrobages.values()) {
      e.main(deltaT);
      if (e.mort) this.enrobages.delete(e.objet);
    }
    for (const b of this.bombes) {
      // La mèche brûle pendant TIME_BOMBE (5 s) sur les premières images du
      // clip ; le souffle jaillit à l'explosion et joue jusqu'au bout.
      if (b.explose) {
        b.frame += deltaT * C.WANTED_FPS;
        if (b.frame > 22) b.mort = true;
      }
    }
    this.bombes = this.bombes.filter((b) => !b.mort);
    for (const s of this.sonnettes) s.temps -= deltaT;
    this.sonnettes = this.sonnettes.filter((s) => s.temps > 0);
    for (const p of this.popups) p.main(deltaT);
    this.popups = this.popups.filter((p) => !p.mort);
    this.particules.main(tmod);
    if (this.ecran) this.ecran.main(tmod);
  }

  dessiner(ctx) {
    const partie = this.partie;
    const jeu = this.jeu;

    // Le décor : la bordure, puis le champ étiré au rectangle de jeu
    // (Level.as : playField posé au coin, _width/_height au terrain).
    const pf = D.manifeste.cadres.playField;
    const bordure = D.rendreFichier('backgroundBord.svg', pf.bord, 1);
    if (bordure) ctx.drawImage(bordure.c, 0, 0, C.WIDTH, C.HEIGHT);
    const champ = D.rendreFichier('backgroundField.svg', pf.champ, 1);
    if (champ) {
      const n = partie.niveau;
      ctx.drawImage(champ.c, n.corner.x, n.corner.y, n.width, n.height);
    }

    // Le terrier du départ, qui se referme (PLAN_FRUITSHADE).
    if (this.trouFx) {
      const k = this.trouFx.z / 100;
      if (k > 0) D.poser(ctx, 'trou', 1, partie.trou.x, partie.trou.y, k, k, 0);
    }

    // Fruits et options (PLAN_FRUITS/PLAN_BONUSES).
    for (const e of this.enrobages.values()) R.dessinerEnrobe(ctx, e);

    // Les bombes posées (PLAN_BONUSES).
    for (const b of this.bombes) {
      D.poser(ctx, 'bombe', Math.max(1, Math.min(22, Math.floor(b.frame))), b.x, b.y, 1, 1, 0);
    }

    // La langue, si elle est sortie (PLAN_LANGUE — sous le serpent).
    for (const s of [...partie.slots, ...partie.unique_slots]) {
      if (s.langue) {
        const l = s.langue;
        // Le clip langue : la base s'étire en x (xscale %), le col au bout.
        D.poser(ctx, 'langue', 1, l.x, l.y, l.xscale / 100, 1, l.ang);
      }
    }

    // Les serpents noirs de la potion (PLAN_SNAKE).
    for (const s of this.serpentsNoirs) {
      R.dessinerSerpent(ctx, s, 1, jeu.temps());
      R.dessinerTete(ctx, s, 3);
    }

    // Le serpent du joueur.
    R.dessinerSerpent(ctx, partie.serpent, jeu.tmod, jeu.temps());
    R.dessinerTete(ctx, partie.serpent, partie.serpent.tete_frame);

    // La sonnette qui tinte à la queue (PLAN_DUMMIES).
    for (const s of this.sonnettes) D.poser(ctx, 'sonnette', 1, s.x, s.y, 1, 1, 0);

    // Les débris d'explosion (PLAN_DUMMIES).
    this.particules.dessiner(ctx);

    // ── L'interface (PLAN_INTERFACE) ──
    // Le bandeau du score, ancré au bord droit ; le score en chiffres verts
    // à (WIDTH−BORDER, 30) — l'ancre du nombre est son bord droit.
    D.poser(ctx, 'barreScore', 1, C.WIDTH, 0, 1, 1, 0);
    this.scoreMc.poserVal(partie.score);
    this.scoreMc.dessiner(ctx, C.WIDTH - 10, 30, 1);

    // La frutibarre (fond, b1, mid étiré, b2 recalé, boîtier, étiquette).
    this.dessinerFbarre(ctx, 10, C.HEIGHT - 10);

    // La rangée de cases (PLAN_SLOTS) : i·50+30, 30.
    const rangee = [...partie.slots, ...partie.unique_slots];
    for (const s of rangee) {
      D.poser(ctx, 'slot', s.slotFrame, s.pos * 50 + 30, 30, 1, 1, 0);
      if (s.compteur != null) {
        ctx.font = '12px Alba, Verdana, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(String(s.compteur), s.pos * 50 + 30, 48);
      }
    }

    // Les nombres qui sautent, puis l'écran éventuel (PLAN_DUMMIES dessus).
    for (const p of this.popups) p.dessiner(ctx);

    if (partie.pause) {
      // Game.as : `pause_mc = dmanager.attach("screens", …)` puis
      // `gotoAndPlay("pause")` — sans _x/_y. Le voile de l'image « pause »
      // couvre déjà toute la scène depuis (0,0) : le centrer le décalait.
      D.poser(ctx, 'screens', ECRANS.pause, 0, 0, 1, 1, 0);
    }
    if (this.ecran) this.ecran.dessiner(ctx);
  }

  dessinerFbarre(ctx, x, y) {
    const pieces = D.manifeste.cadres.fbarre.pieces;
    ctx.save();
    ctx.translate(x, y);
    for (const p of pieces) {
      const r = D.rendreFichier(p.fichier, p.cadre, 1);
      if (!r) continue;
      ctx.save();
      if (p.nom === 'mid') {
        // mid._width = fbarreMid : l'échelle x = largeur voulue / naturelle.
        ctx.transform(1, 0, 0, 1, p.matrice[4], p.matrice[5]);
        ctx.scale(Math.max(0.001, this.fbarreMid / p.cadre.w), 1);
      } else if (p.nom === 'b2') {
        // b2._x = b1._x + mid._width (le bouchon droit suit le remplissage).
        ctx.transform(p.matrice[0], p.matrice[1], p.matrice[2], p.matrice[3],
          91.4 + this.fbarreMid, p.matrice[5]);
      } else {
        ctx.transform(p.matrice[0], p.matrice[1], p.matrice[2], p.matrice[3],
          p.matrice[4], p.matrice[5]);
      }
      ctx.drawImage(r.c, r.dx, r.dy, r.lw, r.lh);
      ctx.restore();
    }
    ctx.restore();
  }
}

// ── La bataille, côté écran (Battle.as) ───────────────────────────────────
class VueBataille {
  constructor(jeu, njoueurs) {
    this.jeu = jeu;
    this.particules = new R.Particules(hasard);
    this.ecran = null;
    this.jeu.tmodForce = 1;           // Std.tmod = 1 « reset because slow menu »

    const sons = jeu.sons;
    sons.setVolume(C.CHANNEL_MUSIC_2, 0);
    sons.fade(C.CHANNEL_MUSIC_1, C.CHANNEL_MUSIC_2, C.MUSIC_FADE_LENGTH);
    sons.loop(C.SOUND_GAME_LOOP, C.CHANNEL_MUSIC_2);

    this.bataille = new BA.Bataille({
      hasard,
      nplayers: njoueurs,
      evenement: (nom, d) => {
        if (nom === 'son') jeu.sons.play(d.nom);
        else if (nom === 'explosion') this.particules.eclater(d.x, d.y, d.couleur);
        else if (nom === 'finBataille') {
          this.ecran = new Ecran(jeu, 'resultat', d.texte);
          if (d.vainqueur !== -1) this.ecran.panCouleur = d.vainqueur + 1;
          this.ecran.poserPresse(() => jeu.forcerMode(0));
        }
      },
    });
  }

  close() {}
  presser() { if (this.ecran) this.ecran.presser(); }

  main(tmod, deltaT) {
    this.bataille.main(tmod, deltaT, this.jeu.entreesBataille());
    this.particules.main(tmod);
    if (this.ecran) this.ecran.main(tmod);
  }

  dessiner(ctx) {
    const jeu = this.jeu;
    const b = this.bataille;
    const pf = D.manifeste.cadres.playField;
    const bordure = D.rendreFichier('backgroundBord.svg', pf.bord, 1);
    if (bordure) ctx.drawImage(bordure.c, 0, 0, C.WIDTH, C.HEIGHT);
    const champ = D.rendreFichier('backgroundField.svg', pf.champ, 1);
    if (champ) {
      const n = b.niveau;
      ctx.drawImage(champ.c, n.corner.x, n.corner.y, n.width, n.height);
    }

    const tous = [...b.serpents, ...b.destroys];
    for (const s of tous) {
      if (!s || s.vivant === false) continue;
      R.dessinerSerpent(ctx, s, jeu.tmod, jeu.temps());
      R.dessinerTete(ctx, s, s.tete_frame || 1);
    }
    this.particules.dessiner(ctx);

    // Les jauges de turbo : joueur 0 en haut-gauche, 1 en haut-droite (qui
    // grandit vers la gauche), 2 et 3 en dessous — largeur = pouvoir × 5.
    for (let i = 0; i < b.serpents.length; i++) {
      if (!b.serpents[i]) continue;
      const p = b.powers[i] * 5;
      const y = i < 2 ? 20 : 40;
      const x = (i % 2 === 0) ? 20 : C.WIDTH - p - 20;
      this.dessinerJauge(ctx, x, y, p, i);
    }

    if (this.ecran) this.ecran.dessiner(ctx);
  }

  dessinerJauge(ctx, x, y, v, i) {
    // battleBarSide/battleBarMid, image i+1 pour la couleur du joueur ;
    // bend est le même bout en miroir à x+v, bmid s'étire sur v.
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

// ── Le chef d'orchestre (Manager.as) ──────────────────────────────────────
class Jeu {
  constructor(canvas, plateforme, sons) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.plateforme = plateforme;
    this.sons = sons;
    this.hasard = hasard;

    this.mode = null;
    this.next_mode = -1;
    this.echelle = 1;
    this.nettete = 1;
    this.tmod = 1;
    this.tmodForce = null;
    this.horloge = 0;                 // getTimer()/100, pour l'ondulation
    this.touches = new Set();
    this.pointeur = { x: 0, y: 0, bas: false };
    this.tapOption = 0;               // le reste d'un appui « utiliser l'option »

    this.musique = true;
    this.bruitages = true;

    // Les cadres dont le moteur a besoin (hitboxes).
    const m = D.manifeste;
    this.dims = {
      fruit: (id) => m.cadres.fruits[id] || { w: 20, h: 20 },
      bonus: (id) => m.cadres.options[id] || { w: 20, h: 20 },
      col: m.cadres.col,
      langueCol: m.cadres.langueCol,
    };
  }

  temps() { return this.horloge; }

  // Un appui compte comme une pression d'ESPACE le temps de quelques images :
  // partie.js a le même anti-rebond que le SWF (space_flag), il faut donc que
  // la touche soit vue enfoncée puis relâchée.
  impulsionOption() { this.tapOption = 0.12; }
  toucheEnfoncee(code) { return this.touches.has(code); }

  // Manager.onServiceConnect — les préférences chargées s'appliquent par la
  // bascule (music part « à l'envers » puis toggleMusic la remet).
  appliquerPrefs() {
    const p = this.plateforme.prefs;
    this.musique = !p.$music; this.basculerMusique();
    this.bruitages = !p.$sounds; this.basculerSons();
  }

  basculerMusique() {
    this.musique = !this.musique;
    this.sons.enable(C.CHANNEL_MUSIC_1, this.musique);
    this.sons.enable(C.CHANNEL_MUSIC_2, this.musique);
  }

  basculerSons() {
    this.bruitages = !this.bruitages;
    this.sons.enable(C.CHANNEL_SOUNDS, this.bruitages);
  }

  // Manager.nextMode. En light, pas de disque blanc : le menu principal
  // offre les quatre entrées, actives (cf. l'en-tête du fichier).
  modeSuivant() {
    switch (this.next_mode) {
      case 0: return new M.Menu(this, [1, 2, 3, 4], (n) => this.choixMenu(n));
      case 2: return new VueBataille(this, this.nplayers || 2);
      case 3: return new M.MenuOptions(this);
      case 4: return new E.Encyclo(this);
      case 5: return new M.Menu(this, [6, 7, 8, 5], (n) => this.choixMenu(n));
      case 97: { this.tmodForce = 1; return new VuePartie(this); }
      default: return null;
    }
  }

  // Manager.run_main_menu.
  choixMenu(n) {
    switch (n) {
      case 1: case 9: this.forcerMode(97); break;   // Challenge — le jeu part
      case 2: this.poserModeSuivant(5); break;      // le menu Battle
      case 3: this.poserModeSuivant(3); break;
      case 4: this.poserModeSuivant(4); break;
      case 5: this.poserModeSuivant(0); break;
      case 6: case 7: case 8:
        this.nplayers = n - 4;
        this.poserModeSuivant(2);
        break;
      default: break;
    }
  }

  poserModeSuivant(i) {
    if (this.next_mode === -1) {
      this.mode = new Transition(this, this.mode);
      this.next_mode = i;
    }
  }

  forcerMode(i) {
    if (this.next_mode === -1) this.poserModeSuivant(i);
    else if (this.mode instanceof Transition) {
      this.mode.reversed = false;
      this.next_mode = i;
    } else this.next_mode = i;
  }

  basculerMode(m) {
    if (this.mode && this.mode.close) this.mode.close();
    this.next_mode = -1;
    this.mode = m;
  }

  retourMenu() {
    this.sons.play(C.SOUND_RETURN_MENU);
    this.poserModeSuivant(0);
  }

  // ── Les entrées ──
  entreesPartie() {
    const t = this.touches;
    const pad = this.pad || {};
    return {
      gauche: t.has(37) || !!pad.gauche,
      droite: t.has(39) || !!pad.droite,
      haut: t.has(38) || !!pad.haut,
      bas: t.has(40) || !!pad.bas,
      espace: t.has(32) || !!pad.espace || this.tapOption > 0,
      echap: t.has(27) || !!pad.echap,
    };
  }

  entreesBataille() {
    // DEFAULT_KEYS (ou celles du slot 1) : gauche/droite/haut par joueur.
    const k = this.plateforme.prefs.$keys || C.DEFAULT_KEYS;
    const t = this.touches;
    const e = [];
    for (let i = 0; i < 4; i++) {
      e.push({ gauche: t.has(k[i * 3]), droite: t.has(k[i * 3 + 1]), haut: t.has(k[i * 3 + 2]) });
    }
    // Au doigt, le pad pilote le joueur 1.
    const pad = this.pad || {};
    e[0].gauche = e[0].gauche || !!pad.gauche;
    e[0].droite = e[0].droite || !!pad.droite;
    e[0].haut = e[0].haut || !!pad.haut;
    return e;
  }

  // ── La boucle ──
  demarrer() {
    this.redimensionner();
    window.addEventListener('resize', () => this.redimensionner());

    window.addEventListener('keydown', (ev) => {
      const code = ev.keyCode || ev.which;
      this.touches.add(code);
      if ([32, 37, 38, 39, 40].includes(code)) ev.preventDefault();
    });
    window.addEventListener('keyup', (ev) => this.touches.delete(ev.keyCode || ev.which));
    window.addEventListener('blur', () => this.touches.clear());

    const position = (ev) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / this.echelle, y: (ev.clientY - r.top) / this.echelle };
    };
    this.canvas.addEventListener('pointerdown', (ev) => {
      const p = position(ev);
      this.pointeur = { x: p.x, y: p.y, bas: true };
      if (this.mode && this.mode.presser) this.mode.presser(p.x, p.y);
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      const p = position(ev);
      this.pointeur.x = p.x;
      this.pointeur.y = p.y;
      if (this.pointeur.bas && this.mode && this.mode.glisser) this.mode.glisser(p.x, p.y);
    });
    const fin = () => {
      this.pointeur.bas = false;
      if (this.mode && this.mode.relacher) this.mode.relacher();
    };
    this.canvas.addEventListener('pointerup', fin);
    this.canvas.addEventListener('pointercancel', fin);

    this.mode = new M.Menu(this, [1, 2, 3, 4], (n) => this.choixMenu(n));
    this.next_mode = -1;

    let avant = performance.now();
    const cadre = (maintenant) => {
      // L'horloge élastique d'asml : dt borné à une demi-seconde, tmod lissé
      // à 95/5 sur le nombre d'images de 1/32 s écoulées.
      let dt = (maintenant - avant) / 1000;
      avant = maintenant;
      if (dt > C.MAX_DELTA_TIME) dt = C.MAX_DELTA_TIME;
      const images = dt * C.WANTED_FPS;
      this.tmod = this.tmod * C.TMOD_FACTOR + images * (1 - C.TMOD_FACTOR);
      if (this.tmodForce != null) { this.tmod = this.tmodForce; this.tmodForce = null; }
      this.horloge += dt * 10;        // getTimer()/100
      if (this.tapOption > 0) this.tapOption -= dt;

      this.sons.main(dt);
      if (this.mode && this.mode.main) this.mode.main(this.tmod, dt);

      const ctx = this.ctx;
      ctx.setTransform(this.nettete, 0, 0, this.nettete, 0, 0);
      // Le fond de scène du SWF (SetBackgroundColor) : le vert Frutiparc.
      ctx.fillStyle = '#ade76b';
      ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
      if (this.mode && this.mode.dessiner) this.mode.dessiner(ctx);

      requestAnimationFrame(cadre);
    };
    requestAnimationFrame(cadre);
  }

  redimensionner() {
    const aire = this.canvas.parentElement;
    const kx = aire.clientWidth / C.WIDTH;
    const ky = aire.clientHeight / C.HEIGHT;
    this.echelle = Math.max(0.2, Math.min(kx, ky));
    // Le tampon couvre les pixels PHYSIQUES (échelle × devicePixelRatio) —
    // la netteté des autres portages light.
    this.nettete = this.echelle * (window.devicePixelRatio || 1);
    this.canvas.width = Math.round(C.WIDTH * this.nettete);
    this.canvas.height = Math.round(C.HEIGHT * this.nettete);
    this.canvas.style.width = Math.round(C.WIDTH * this.echelle) + 'px';
    this.canvas.style.height = Math.round(C.HEIGHT * this.echelle) + 'px';
    D.poserDensite(this.nettete);
  }
}

// ── Le démarrage ──────────────────────────────────────────────────────────
window.SnakeJeu = { Jeu, Ecran, VuePartie, VueBataille };

window.demarrerFrutisnake = function (options) {
  const opts = options || {};
  const canvas = document.getElementById(opts.canvas || 'scene');
  const sid = new URLSearchParams(window.location.search).get('sid') || '';
  const plateforme = new window.SnakePlateforme.Plateforme(sid);
  const sons = new window.SnakeSons.Sons();

  return Promise.all([D.chargerManifeste(), plateforme.charger()]).then(() => {
    const jeu = new Jeu(canvas, plateforme, sons);
    jeu.appliquerPrefs();
    if (opts.pad) jeu.pad = opts.pad;
    return D.precharger(['menu', 'title', 'menuBackground', 'fleche', 'screens',
      'screensSans', 'pan', 'background', 'tete', 'fruits', 'options', 'slot',
      'barreScore', 'chiffresVert', 'chiffresRouge', 'chiffresJaune']).then(() => {
      jeu.demarrer();
      window.__frutisnake = jeu;      // la poignée des tests de bout en bout
      return jeu;
    });
  });
};

})();
