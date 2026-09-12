/*
 * MotionBall — le MANAGER (Manager.as) : l'état courant du jeu (`mode` :
 * l'intro, le menu, un chargement, une partie, un panneau de fin, une
 * transition), les changements de mode à travers la Transition, la boucle
 * `main` (la position du jeu dans la scène, les rappels, le compteur
 * d'images des interrupteurs, les sons), le lancement d'une partie et sa fin
 * (score, fruticard, TItems).
 *
 * Et l'amorçage de la page : demarrerMotionBall() charge la bibliothèque et
 * les sons, pose la scène à 40 images par seconde et lui donne pour racine
 * le clip 0 du SWF lui-même — le cadre, le clip `main`, le cadre du dessus.
 * C'est la première image de `main` qui appelle Manager.init, et sa boucle
 * de deux images qui fait `Std.update(); Manager.main()` (voir
 * scripts-images.js) : le jeu tourne exactement comme dans le fichier.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.Mb2Jeu;
const { Const } = J;
const Sound = J.Sound;

const Manager = {
  play_mode: undefined,
  play_mode_param: undefined,
  mc: null,
  mode: null,
  next_mode: -1,
  client: null,
  updates: null,

  init(mc) {
    if (Manager.mode) Manager.mode.destroy();
    Manager.updates = new J.UpdateList();
    Sound.init(mc);
    Manager.client = J.client || new J.Client('');
    Manager.mc = mc;
    Manager.next_mode = -1;
    Manager.mode = new J.Text(mc, 'Connexion en cours...');
    Manager.client.serviceConnect();
  },

  main() {
    Const.POS_X = 0;
    Const.POS_Y = 0;
    let p = Manager.mc;
    while (p && p._parent != null) {
      Const.POS_X += p._x;
      Const.POS_Y += p._y;
      p = p._parent;
    }
    Manager.updates.main();
    J.Collide.frame_nb++;
    Sound.main();
    if (Manager.mode) Manager.mode.main();
  },

  do_start_game() {
    Manager.client.startGame();
    Manager.updates.remove(Manager, Manager.do_start_game);
  },

  nextMode() {
    switch (Manager.next_mode) {
      case 0: return new J.Menu(Manager.mc);
      case 2: return new J.Text(Manager.mc, ' ERREUR ');
      case 3: return new J.Game(Manager.mc);
      default: return null;
    }
  },

  setNextMode(i) {
    if (Manager.next_mode === -1) {
      Manager.mode = new J.Transition(Manager.mc, Manager.mode);
      Manager.next_mode = i;
    }
  },

  forceNextMode(i) {
    if (Manager.next_mode === -1) Manager.setNextMode(i);
    else {
      const trans = Manager.mode;
      if (!trans || trans.reversed === undefined) {
        Manager.next_mode = -1;
        Manager.setNextMode(i);
        return;
      }
      trans.reversed = false;
      Manager.next_mode = i;
    }
  },

  switchMode(m) {
    if (Manager.mode) Manager.mode.destroy();
    Manager.next_mode = -1;
    Manager.mode = m;
  },

  gotoAide() {
    if (Manager.mode) Manager.mode.destroy();
    Manager.mode = new J.Aide(Manager.mc);
  },

  startGame(gameMode, modeParam) {
    Manager.play_mode = gameMode;
    Manager.play_mode_param = modeParam;
    if (Manager.mode) Manager.mode.destroy();
    switch (gameMode) {
      case Const.MODE_CHALLENGE: Manager.mode = new J.Loader(Manager.mc, Const.CHALLENGE_DATA); break;
      case Const.MODE_CLASSIC: Manager.mode = new J.Loader(Manager.mc, Const.CLASSIC_DATA); break;
      case Const.MODE_AIDE: Manager.mode = new J.Loader(Manager.mc, Const.TUTO_DATA); break;
      case Const.MODE_AVENTURE: Manager.mode = new J.Loader(Manager.mc, Const.AVENTURE_DATA(modeParam)); break;
      case Const.MODE_COURSE: Manager.mode = new J.Loader(Manager.mc, Const.COURSE_DATA(modeParam)); break;
      default: Manager.mode = null; break;
    }
  },

  connected() {
    if (Manager.mode) Manager.mode.destroy();
    Manager.next_mode = -1;
    Manager.mode = new J.Intro(Manager.mc);
  },

  started() { Manager.forceNextMode(3); },

  scoreSaved(score, old, old_pos, new_pos) {
    if (Manager.mode && typeof Manager.mode.onScore === 'function') Manager.mode.onScore(score, old, old_pos, new_pos, false);
  },

  error() { Manager.setNextMode(2); },

  loadDone() {
    switch (Manager.play_mode) {
      case Const.MODE_CHALLENGE:
        Manager.mode.setText('Connexion en cours...');
        Manager.updates.push(Manager, Manager.do_start_game);
        break;
      case Const.MODE_AVENTURE:
      case Const.MODE_AIDE:
      case Const.MODE_CLASSIC:
      case Const.MODE_COURSE:
        Manager.forceNextMode(3);
        break;
      default: break;
    }
  },

  gotoMenu() { Manager.setNextMode(0); },

  gameFinished() {
    if (Manager.client.isWhite()) {
      Sound.stopMix();
      Sound.playMusic(Sound.MUSIC_MENU);
      Manager.forceNextMode(0);
    } else {
      Sound.destroy();
      Manager.client.closeService();
    }
  },

  gameOver(cause) {
    const client = Manager.client;
    const score = Manager.mode.calcScore(cause);
    switch (Manager.play_mode) {
      case Const.MODE_CHALLENGE:
        Manager.mode = new J.GameOver(Manager.mc, Manager.mode, cause);
        client.saveScore(score);
        break;
      case Const.MODE_AVENTURE: {
        if (cause === Const.CAUSE_WINS && !client.fcard.$dungeons_done[Manager.play_mode_param]) {
          client.fcard.$dungeons_done[Manager.play_mode_param] = true;
          let i;
          for (i = 0; i < 4; i++) if (!client.fcard.$dungeons_done[i]) break;
          if (i === 4) client.fcard.$dungeons[4] = true;
          client.saveSlot(0);
        }
        let ti = false;
        if (cause === Const.CAUSE_WINS) ti = J.TItems.giveAventure(Manager.play_mode_param);
        Manager.mode = new J.GameOver(Manager.mc, Manager.mode, cause);
        Manager.mode.onScore(score, J.Card.scoreDonjon(client.fcard, score), 0, 0, ti);
        break;
      }
      case Const.MODE_AIDE:
        Manager.forceNextMode(0);
        break;
      case Const.MODE_COURSE:
        Manager.mode = new J.GameOverCourse(Manager.mc, Manager.mode, score);
        break;
      case Const.MODE_CLASSIC: {
        const record = client.saveClassicScore(score);
        Manager.mode = new J.GameOver(Manager.mc, Manager.mode, cause);
        Manager.mode.onClassicScore(score, record, J.TItems.giveClassic(score));
        break;
      }
      default: break;
    }
  },
};
J.Manager = Manager;

// Les 33 sons du SWF, à précharger.
const SONS = ['wind', 'water', 'wall_bump', 'sound_zapper', 'touched', 'sound_bdeath', 'sound_grelot', 'eye_new', 'eye', 'object_found',
  'sound_poulpe', 'menu_select', 'menu_enter', 'menu', 'loop$5', 'loop$4', 'loop$3', 'loop$2', 'loop$1', 'kata3', 'kata2', 'kata1', 'hide',
  'game_over', 'sound_casse', 'earth', 'door_open', 'bumper_metal', 'sound_boss_saut', 'boss_loop', 'bonus_blip3', 'bonus_blip2', 'bonus_blip'];
J.SONS = SONS;

/**
 * Démarre MotionBall dans un canvas. Résout avec { scene, manager, client }
 * une fois la bibliothèque chargée et la scène partie (l'intro suit la
 * lecture de la fruticard).
 */
racine.demarrerMotionBall = function (options) {
  const canvas = typeof options.canvas === 'string' ? document.getElementById(options.canvas) : options.canvas;
  K.base = '/mb2/';
  K.fichierSon = (nom) => 'sons/' + nom + '.mp3';
  return K.chargerBiblio('mb2').then((biblio) => {
    K.prechargerSons(SONS).catch(() => {});
    // Un son que le SWF n'a pas (« kata4 », que la Tourneboule demande à son
    // dernier kata ; « menu_select » n'existe qu'en son nom) : Flash
    // l'attachait en silence — on ne va pas le chercher sur le serveur.
    const chargerSon = K.audio.charger.bind(K.audio);
    K.audio.charger = (nom, fichier) => (SONS.includes(nom) ? chargerSon(nom, fichier) : Promise.resolve(null));
    const scene = new K.Scene(canvas, biblio, { cadence: 40 });
    const client = new J.Client(options.sid || '');
    J.client = client;
    // La racine : le clip 0 du SWF (cadre, `main`, cadre). Sa première image
    // pose `main`, dont le script d'image 1 appelle Manager.init.
    const racineSwf = K.instancier(biblio, 0);
    scene.racine = racineSwf;
    K.finaliser(racineSwf, null);
    scene.demarrer();
    return { scene, manager: Manager, client };
  });
};

})(typeof window !== 'undefined' ? window : globalThis);
