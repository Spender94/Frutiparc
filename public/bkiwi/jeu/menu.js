/*
 * Burning Kiwi — le MENU (Games/burningKiwi/inc/menu.as) : une machine à
 * phases (vs.menuPhase), chacune attachant ses boutons (attachButton : le
 * clip menuButton, son libellé, son habillage — 1 normal, 2 petit, 3 choix,
 * 4 grisé —, ses rappels onPush / onUpdate / onEnd / onOver / onOut) puis se
 * mettant en attente (-1). Le bouton lui-même joue : pressé, il se plie
 * (image 6 → 12) ; à sa dernière image, s'il a été pressé et qu'il a un
 * onEnd, il écrit SON id dans vs.menuPhase — c'est ainsi que le menu avance
 * — puis appelle onEnd ; killAll (removeAllButtons) plie tous les autres.
 *
 * Les phases : 1 modes de jeu, 2 options, 3 courses, 4 voitures, 5 alerte
 * des codes, 6 évolution, 7 épreuves, 8 courses extras, 20 palmarès, 21
 * temps, 25 coupes, 30-32 touches, 90-93 présentation de la course (et
 * l'envoi au serveur), 99 menu principal, 100-105 l'intro et le logo,
 * 110-111 la musique du menu, 120-122 la connexion, 130-131 la sauvegarde
 * des préférences, 140 la course du jour, 150 l'adversaire du duel.
 *
 * CHALLENGE OU ESSAIS. D'époque, le disque noir (isBlack) n'ouvrait que le
 * Challenge (ARCADE, classé) et le tutorial ; le disque blanc ouvrait tout,
 * avec les « essais » (TRAINING, jamais classés) à la place du Challenge.
 * Ici la session est BLANCHE — tous les modes —, et c'est le quota de Fruits
 * Défendus du jour qui décide du premier bouton (plateforme.js,
 * Client.isRanked) : un FD restant, le bouton dit « challenge » et la course
 * part au classement ; sinon « essais ». Le serveur tranche à /do/fdclaim,
 * comme pour le SWF patché, et un refus ramène au menu (phase 93).
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.BkiwiJeu = racine.BkiwiJeu || {};
const G = J.G;
const Key = K.Key;
const random = J.random;
const rm = J.rm;
const vif = J.vif;

J.installerMenu = function (M) {
  const client = () => M.client;
  const gdebug = J.gdebug;

  // BOUCLE MAIN MENU
  J.mainMenu = function () {
    let i, mc;
    let onPush, onEnd, onOver, onOut, onUpdate, skinBt, onPushAllow, onPushDisallow, onPushDisallowMode;

    J.animGrid();
    J.manageButtons();
    J.manageSpecials();
    J.moveConfettis();
    J.moveBgFx();

    // Le refus, sur un bouton grisé
    const refuser = (label) => {
      J.playSoundBK('buttonRefuse');
      if (!M.limited._visible) {
        M.limited.label = label;
        M.limited._visible = true;
        M.limited.gotoAndPlay(1);
      }
    };

    switch (M.vs.menuPhase) {
      case -1: break;

      // ***** MODES DE JEU *****
      case 1:
        J.stack(M.vs.menuPhase);
        M.menuMC.bande._visible = true;
        M.menuMC.infoPanel.txt = '';
        if (!M.menuMC.infoPanel._visible) {
          M.menuMC.infoPanel.gotoAndPlay(1);
          M.menuMC.infoPanel._visible = true;
        }
        onPushAllow = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); M.menuMC.infoPanel.gotoAndPlay('hide'); };
        onPushDisallow = function () { refuser(M.demoLabel); };

        M.menuMC.menuTitleANIM.menuTitle.title = 'modes de jeu';

        // Entraînement
        if (J.checkMode(M.TRAINING)) {
          skinBt = M.skinAllow;
          onPush = onPushAllow;
          onEnd = function () { M.vs.menuPhase = 140; M.vs.gameMode = M.TRAINING; };
          onOver = function () { M.menuMC.infoPanel.txt = 'La piste est à vous ! Entrainement illimité sur la course du jour !'; };
          onOut = function () { M.menuMC.infoPanel.txt = ''; };
          J.attachButton(11, 'essais', skinBt, 10, 80, onPush, undefined, onEnd, onOver, onOut);
        } else {
          // Arcade
          if (J.checkMode(M.ARCADE)) {
            skinBt = 2;
            onPush = onPushAllow;
            onEnd = function () { M.vs.menuPhase = 140; M.vs.gameMode = M.ARCADE; };
          } else {
            skinBt = M.skinDisallow;
            onPush = onPushDisallow;
            onEnd = undefined;
          }
          onOver = function () { M.menuMC.infoPanel.txt = 'Faites le meilleur temps sur la course du jour'; };
          onOut = function () { M.menuMC.infoPanel.txt = ''; };
          J.attachButton(11, 'challenge', skinBt, 10, 80, onPush, undefined, onEnd, onOver, onOut);
        }

        // Tutorial
        if (J.checkMode(M.TUTORIAL)) {
          skinBt = M.skinAllow;
          onPush = onPushAllow;
          onEnd = function () { M.vs.menuPhase = 4; M.vs.gameMode = M.TUTORIAL; M.vs.selectedTrack = 99; };
        } else {
          skinBt = M.skinDisallow;
          onPush = onPushDisallow;
          onEnd = undefined;
        }
        onOver = function () { M.menuMC.infoPanel.txt = 'Découvrez les principes du jeu et entraînez-vous librement'; };
        onOut = function () { M.menuMC.infoPanel.txt = ''; };
        J.attachButton(12, 'tutorial', skinBt, -5, 120, onPush, undefined, onEnd, onOver, onOut);

        // Évolution
        onPush = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); };
        onEnd = function () { M.vs.menuPhase = 6; };
        onOver = function () { M.menuMC.infoPanel.txt = 'Débloquez de nouvelles fonctionnalités'; };
        onOut = function () { M.menuMC.infoPanel.txt = ''; };
        J.attachButton(13, 'evolution', 1, -20, 160, onPush, undefined, onEnd, onOver, onOut);

        // Épreuves
        onPush = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); };
        onEnd = function () { M.vs.menuPhase = 7; };
        onOver = function () { M.menuMC.infoPanel.txt = 'Participez aux épreuves organisées sur Frutiparc !'; };
        onOut = function () { M.menuMC.infoPanel.txt = ''; };
        J.attachButton(14, 'epreuves', 1, -25, 200, onPush, undefined, onEnd, onOver, onOut);

        onPush = function () { J.back(); J.playSoundBK('buttonCancel'); J.removeAllButtons(); M.menuMC.infoPanel.gotoAndPlay('hide'); };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;

      // ***** OPTIONS *****
      case 2:
        M.menuMC.menuTitleANIM.menuTitle.title = 'options';

        // Bouton détails
        onPush = function () {
          J.playSoundBK('buttonSwitch');
          this.pushed = false;
          M.qualitySetting--;
          if (M.qualitySetting < M.LOW) M.qualitySetting = M.AUTO;
          this.onUpdate();
        };
        onUpdate = function () {
          this.pushed = false;
          if (M.qualitySetting == M.AUTO) M.menuButton_21.skin.label = 'details: auto';      // eslint-disable-line eqeqeq
          if (M.qualitySetting == M.HIGH) M.menuButton_21.skin.label = 'details: hauts';     // eslint-disable-line eqeqeq
          if (M.qualitySetting == M.MEDIUM) M.menuButton_21.skin.label = 'details: moyen';   // eslint-disable-line eqeqeq
          if (M.qualitySetting == M.LOW) M.menuButton_21.skin.label = 'details: bas';        // eslint-disable-line eqeqeq
          J.setDetailLevel(M.qualitySetting);
        };
        onEnd = function () {};
        J.attachButton(21, 'details: hauts', 1, 45, 80, onPush, onUpdate, onEnd);

        // Bouton interface
        onPush = function () { J.playSoundBK('buttonSwitch'); this.pushed = false; M.panelON = !M.panelON; this.onUpdate(); };
        onUpdate = function () { M.menuButton_22.skin.label = M.panelON ? 'interface: oui' : 'interface: non'; };
        onEnd = function () {};
        J.attachButton(22, 'interface: oui', 1, 30, 120, onPush, onUpdate, onEnd);

        // Bouton Sons
        onPush = function () {
          if (M.soundsON) J.playSoundBK('buttonSwitch');
          this.pushed = false;
          M.soundsON = !M.soundsON;
          if (M.soundsON) J.playSoundBK('buttonSwitch');
          this.onUpdate();
        };
        onUpdate = function () { M.menuButton_23.skin.label = M.soundsON ? 'sons: oui' : 'sons: non'; };
        onEnd = function () {};
        J.attachButton(23, 'sons: oui', 1, 20, 160, onPush, onUpdate, onEnd);

        // Bouton Musique
        onPush = function () {
          J.playSoundBK('buttonSwitch');
          this.pushed = false;
          M.musicON = !M.musicON;
          if (M.musicON) J.startMusic(M.musicMenu);
          else J.stopMusic(M.musicMenu);
          this.onUpdate();
        };
        onUpdate = function () { M.menuButton_24.skin.label = M.musicON ? 'musique: oui' : 'musique: non'; };
        onEnd = function () {};
        J.attachButton(24, 'musique: oui', 1, 13, 200, onPush, onUpdate, onEnd);

        onPush = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); };
        onEnd = function () { M.vs.menuPhase = 30; };
        J.attachButton(25, 'touches', 1, 9, 240, onPush, undefined, onEnd);

        onPush = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(130, 'valider', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;

      // ***** COURSES *****
      case 3: {
        J.stack(M.vs.menuPhase);
        M.menuMC.bande._visible = false;
        M.menuMC.infoPanel._visible = false;
        M.menuMC.menuTitleANIM.menuTitle.title = 'courses';
        M.menuMC.trackSel._visible = true;
        if (M.vs.selectedTrack > 3 && !M.vs.$wss) M.vs.selectedTrack = 0;
        if (M.vs.selectedTrack == 99) M.vs.selectedTrack = 0;                 // eslint-disable-line eqeqeq
        for (i = 0; i < M.tracks.length; i++) {
          mc = M.menuMC.trackSel['track' + i];
          if (!mc) continue;
          mc._visible = (i == M.vs.selectedTrack);                            // eslint-disable-line eqeqeq
        }
        const choisir = (n) => function () {
          J.playSoundBK('buttonSwitch');
          this.pushed = false;
          M.mc = M.menuMC.trackSel['track' + M.vs.selectedTrack];
          if (M.mc) M.mc._visible = false;
          M.vs.selectedTrack = n;
          M.mc = M.menuMC.trackSel['track' + M.vs.selectedTrack];
          if (M.mc) M.mc._visible = true;
        };
        J.attachButton(31, M.tracks[0].title, 3, -8, 80, choisir(0), undefined, undefined);
        J.attachButton(32, M.tracks[1].title, 3, -8, 120, choisir(1), undefined, undefined);
        J.attachButton(33, M.tracks[2].title, 3, -8, 160, choisir(2), undefined, undefined);
        J.attachButton(34, M.tracks[3].title, 3, -8, 200, choisir(3), undefined, undefined);

        if (J.checkMode(M.SURVIVOR) && M.vs.$wss) {
          onPush = function () { J.playSoundBK('buttonOk'); M.menuMC.trackSel._visible = false; J.removeAllButtons(); };
          onEnd = function () {};
          J.attachButton(8, 'extras', 2, -8, 240, onPush, undefined, onEnd);
        } else {
          onPush = function () { J.playSoundBK('buttonRefuse'); };
          onEnd = undefined;
          J.attachButton(35, 'extras', 4, -8, 240, onPush, undefined, onEnd);
        }

        onPush = function () { J.playSoundBK('buttonOk'); M.menuMC.trackSel._visible = false; J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(4, 'ok', 2, -70, 280, onPush, undefined, onEnd);

        onPush = function () { J.back(); J.playSoundBK('buttonCancel'); M.menuMC.trackSel._visible = false; J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;
      }

      // ***** VOITURES *****
      case 4: {
        J.stack(M.vs.menuPhase);
        M.menuMC.bande._visible = false;
        M.menuMC.infoPanel._visible = false;
        M.menuMC.menuTitleANIM.menuTitle.title = 'voitures';
        M.menuMC.carSel._visible = true;

        let currentName;
        J.updateStats(M.vs.selectedCar);

        const choisir = (n) => function () {
          J.playSoundBK('buttonSwitch');
          this.pushed = false;
          M.vs.selectedCar = n;
          J.updateStats(M.vs.selectedCar);
        };
        // Ultra
        skinBt = M.availableCars[0] ? 3 : 4;
        currentName = M.carSkinNames[0];
        if (M.specials[5].state) currentName = 'UltraCop';
        if (M.specials[4].state) currentName = M.carSkinNames[20];
        J.attachButton(41, currentName.toLowerCase(), skinBt, -15, 80, choisir(0), undefined, undefined);
        // UWE
        skinBt = M.availableCars[1] ? 3 : 4;
        currentName = M.carSkinNames[1];
        if (M.specials[4].state) currentName = M.carSkinNames[21];
        J.attachButton(42, currentName.toLowerCase(), skinBt, -15, 120, choisir(1), undefined, undefined);
        // Fury
        skinBt = M.availableCars[2] ? 3 : 4;
        currentName = M.carSkinNames[2];
        if (M.specials[4].state) currentName = M.carSkinNames[22];
        J.attachButton(43, currentName.toLowerCase(), skinBt, -15, 160, choisir(2), undefined, undefined);
        // Sonic
        skinBt = M.availableCars[3] ? 3 : 4;
        currentName = M.carSkinNames[3];
        if (M.specials[4].state) currentName = M.carSkinNames[23];
        J.attachButton(44, currentName.toLowerCase(), skinBt, -15, 200, choisir(3), undefined, undefined);
        // KiwiX
        if (M.availableCars[4]) {
          skinBt = 3;
          currentName = M.carSkinNames[4];
          if (M.specials[4].state) currentName = M.carSkinNames[24];
          J.attachButton(45, currentName.toLowerCase(), skinBt, -15, 240, choisir(4), undefined, undefined);
        }

        onPush = function () {
          if (!M.availableCars[M.vs.selectedCar]) {
            // Véhicule non autorisé (« isWhite() » nu : une fonction qui n'existe
            // pas sur le scénario — undefined, donc le libellé de la démo)
            J.playSoundBK('buttonRefuse');
            if (!M.limited._visible) {
              M.limited.label = M.demoLabel;
              M.limited._visible = true;
              M.limited.gotoAndPlay(1);
            }
            this.pushed = false;
          } else {
            J.playSoundBK('buttonOk');
            M.menuMC.carSel._visible = false;
            J.removeAllButtons();
            if (M.vs.gameMode != M.DUEL) {                                    // eslint-disable-line eqeqeq
              M.menuMC.fondMenu.play();
              M.menuMC.menuTitleANIM.play();
            }
          }
        };
        onEnd = function () {};
        let nextPhase = 5;
        if (M.vs.gameMode == M.DUEL) nextPhase = 150;                         // eslint-disable-line eqeqeq
        J.attachButton(nextPhase, 'ok', 2, -70, 280, onPush, undefined, onEnd);

        onPush = function () { J.back(); J.playSoundBK('buttonCancel'); M.menuMC.carSel._visible = false; J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;
      }

      // ***** AVERTISSEMENT CHEAT *****
      case 5:
        J.stack(M.vs.menuPhase);
        M.menuMC.bande._visible = false;
        if (M.vs.useSpecials && (M.vs.gameMode == M.ARCADE || M.vs.gameMode == M.FRUTICUP || M.vs.gameMode == M.SURVIVOR || M.vs.gameMode == M.TIMETRIAL)) {   // eslint-disable-line eqeqeq
          M.menuMC.warningSpecials._visible = true;
          onPush = function () { J.playSoundBK('buttonOk'); M.menuMC.warningSpecials._visible = false; J.removeAllButtons(); };
          onEnd = function () {};
          J.attachButton(90, 'ok', 2, -70, 320, onPush, undefined, onEnd);
          M.vs.menuPhase = -1;
        } else {
          M.vs.menuPhase = 90;
        }
        break;

      // ***** ÉVOLUTION *****
      case 6:
        J.stack(M.vs.menuPhase);
        M.menuMC.bande._visible = true;
        M.menuMC.infoPanel.txt = '';
        if (!M.menuMC.infoPanel._visible) {
          M.menuMC.infoPanel.gotoAndPlay(1);
          M.menuMC.infoPanel._visible = true;
        }
        onPushAllow = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); M.menuMC.infoPanel.gotoAndPlay('hide'); };
        onPushDisallow = function () { refuser(M.demoLabel); };
        onPushDisallowMode = function () { refuser(M.modeLabel); };

        M.menuMC.menuTitleANIM.menuTitle.title = 'evolution';

        // Duel
        if (J.checkMode(M.DUEL) && M.vs.$wcs) {
          skinBt = M.skinAllow;
          onPush = onPushAllow;
          onEnd = function () { M.vs.menuPhase = 4; M.vs.gameMode = M.DUEL; M.vs.selectedTrack = M.duelTrack; };
        } else {
          skinBt = M.skinDisallow;
          onPush = !J.checkMode(M.DUEL) ? onPushDisallow : onPushDisallowMode;
          onEnd = undefined;
        }
        onOver = function () { M.menuMC.infoPanel.txt = 'Affrontez une écurie pour accéder à leur véhicule'; };
        onOut = function () { M.menuMC.infoPanel.txt = ''; };
        J.attachButton(61, 'duel', skinBt, 10, 80, onPush, undefined, onEnd, onOver, onOut);

        // TimeTrial
        if (J.checkMode(M.TIMETRIAL)) {
          skinBt = M.skinAllow;
          onPush = onPushAllow;
          onEnd = function () { M.vs.menuPhase = 3; M.vs.gameMode = M.TIMETRIAL; };
        } else {
          skinBt = M.skinDisallow;
          onPush = onPushDisallow;
          onEnd = undefined;
        }
        onOver = function () { M.menuMC.infoPanel.txt = 'Un accès exclusif aux pistes pour des courses contre la montre!'; };
        onOut = function () { M.menuMC.infoPanel.txt = ''; };
        J.attachButton(62, 'TimeTrial', skinBt, 13, 120, onPush, undefined, onEnd, onOver, onOut);

        // Fruticoupe
        {
          let skinBtSmall;
          if (J.checkMode(M.FRUTICUP)) {
            skinBt = M.skinAllow;
            skinBtSmall = 3;
            onPush = onPushAllow;
            onEnd = function () { M.vs.menuPhase = 4; M.vs.selectedTrack = 0; M.vs.gameMode = M.FRUTICUP; M.newTournament = true; };
          } else {
            skinBt = M.skinDisallow;
            skinBtSmall = M.skinDisallow;
            onPush = onPushDisallow;
            onEnd = undefined;
          }
          onOver = function () { M.menuMC.infoPanel.txt = 'Gagnez la FrutiCoupe pour activer de nouveaux modes de jeu'; };
          onOut = function () { M.menuMC.infoPanel.txt = ''; };
          if (M.vs.$wss) J.attachButton(63, 'fruticoupe XL', skinBtSmall, 7, 160, onPush, undefined, onEnd, onOver, onOut);
          else J.attachButton(63, 'fruticoupe', skinBt, 16, 160, onPush, undefined, onEnd, onOver, onOut);
        }

        // Survivor
        if (J.checkMode(M.SURVIVOR) && M.vs.$wcs) {
          skinBt = M.skinAllow;
          onPush = onPushAllow;
          onEnd = function () { M.vs.menuPhase = 4; M.vs.selectedTrack = 0; M.vs.gameMode = M.SURVIVOR; M.newTournament = true; };
        } else {
          skinBt = M.skinDisallow;
          onPush = !J.checkMode(M.SURVIVOR) ? onPushDisallow : onPushDisallowMode;
          onEnd = undefined;
        }
        onOver = function () { M.menuMC.infoPanel.txt = 'Débloquez les circuits et les coupes XL dans ce tournoi d\'endurance !'; };
        onOut = function () { M.menuMC.infoPanel.txt = ''; };
        if (M.vs.$wss) J.attachButton(64, 'elite XL', skinBt, -4, 200, onPush, undefined, onEnd, onOver, onOut);
        else J.attachButton(64, 'elite', skinBt, -4, 200, onPush, undefined, onEnd, onOver, onOut);

        // Ghost-Run
        //
        // LE BOUTON QUE LE FICHIER PORTE EN COMMENTAIRE (menu.as, après
        // « elite »), replacé au mot et au pixel près : même identifiant, même
        // place, même phrase d'aide. Tout le mode est compilé dans le SWF —
        // l'enregistrement, la relecture interpolée, la voiture translucide —
        // et seul ce bouton manquait, si bien que personne n'y a jamais joué.
        // La trace, elle, ne mourait qu'avec la page ; elle vit désormais au
        // serveur, un fantôme par circuit (plateforme.js, chargerFantome).
        if (J.checkMode(M.GHOSTRUN)) {
          skinBt = M.skinAllow;
          onPush = onPushAllow;
          onEnd = function () { M.vs.menuPhase = 3; M.vs.gameMode = M.GHOSTRUN; };
        } else {
          skinBt = M.skinDisallow;
          onPush = !J.checkMode(M.GHOSTRUN) ? onPushDisallow : onPushDisallowMode;
          onEnd = undefined;
        }
        onOver = function () { M.menuMC.infoPanel.txt = 'Rivalisez avec votre pire adversaire: vous !'; };
        onOut = function () { M.menuMC.infoPanel.txt = ''; };
        J.attachButton(65, 'ghost run', skinBt, -23, 240, onPush, undefined, onEnd, onOver, onOut);

        onPush = function () { J.back(); J.playSoundBK('buttonCancel'); J.removeAllButtons(); M.limited.gotoAndPlay('hide'); };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;

      // ***** EVENTS *****
      case 7:
        J.stack(M.vs.menuPhase);
        M.menuMC.bande._visible = true;
        M.menuMC.infoPanel.txt = '';
        if (!M.menuMC.infoPanel._visible) {
          M.menuMC.infoPanel.gotoAndPlay(1);
          M.menuMC.infoPanel._visible = true;
        }
        onPushAllow = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); M.menuMC.infoPanel.gotoAndPlay('hide'); };
        onPushDisallow = function () { refuser(M.demoLabel); };

        M.menuMC.menuTitleANIM.menuTitle.title = 'epreuves';

        // KiwiRun
        if (J.checkMode(M.KIWIRUN)) {
          skinBt = M.skinAllow;
          onPush = onPushAllow;
          onEnd = function () { M.vs.menuPhase = 4; M.vs.selectedTrack = 0; M.vs.gameMode = M.KIWIRUN; };
        } else {
          skinBt = M.skinDisallow;
          onPush = onPushDisallow;
          onEnd = undefined;
        }
        onOver = function () { M.menuMC.infoPanel.txt = 'Ramassez au plus vite les bonus placés sur la course !'; };
        onOut = function () { M.menuMC.infoPanel.txt = ''; };
        J.attachButton(71, 'kiwi run', skinBt, 10, 80, onPush, undefined, onEnd, onOver, onOut);

        onPush = function () { J.back(); J.playSoundBK('buttonCancel'); J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;

      // ***** COURSES EXTRAS *****
      case 8: {
        M.menuMC.bande._visible = false;
        M.menuMC.infoPanel._visible = false;
        M.menuMC.menuTitleANIM.menuTitle.title = 'extras';
        M.menuMC.trackSel._visible = true;
        for (i = 0; i < M.tracks.length; i++) {
          mc = M.menuMC.trackSel['track' + i];
          if (!mc) continue;
          mc._visible = (i == M.vs.selectedTrack);                            // eslint-disable-line eqeqeq
        }
        const choisir = (n) => function () {
          J.playSoundBK('buttonSwitch');
          this.pushed = false;
          M.mc = M.menuMC.trackSel['track' + M.vs.selectedTrack];
          if (M.mc) M.mc._visible = false;
          M.vs.selectedTrack = n;
          M.mc = M.menuMC.trackSel['track' + M.vs.selectedTrack];
          if (M.mc) M.mc._visible = true;
        };
        J.attachButton(31, M.tracks[4].title, 3, -8, 80, choisir(4), undefined, undefined);
        J.attachButton(32, M.tracks[5].title, 3, -8, 120, choisir(5), undefined, undefined);

        if (M.vs.$wss) {
          onPush = function () { J.playSoundBK('buttonOk'); M.menuMC.trackSel._visible = false; J.removeAllButtons(); };
          onEnd = function () {};
          J.attachButton(3, 'normales', 2, -8, 240, onPush, undefined, onEnd);
        }

        onPush = function () { J.playSoundBK('buttonOk'); M.menuMC.trackSel._visible = false; J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(4, 'ok', 2, -70, 280, onPush, undefined, onEnd);

        onPush = function () { J.back(); J.playSoundBK('buttonCancel'); M.menuMC.trackSel._visible = false; J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;
      }

      // ***** PALMARÈS *****
      case 20:
        J.stack(M.vs.menuPhase);
        M.menuMC.menuTitleANIM.menuTitle.title = 'palmares';
        onPush = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(21, 'Temps', 1, 10, 80, onPush, undefined, onEnd);
        onPush = function () { J.removeAllButtons(); J.playSoundBK('buttonOk'); };
        onEnd = function () {};
        J.attachButton(25, 'Coupes', 1, -5, 120, onPush, undefined, onEnd);
        onPush = function () { J.back(); J.playSoundBK('buttonCancel'); J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);
        M.vs.menuPhase = -1;
        break;

      // ***** TEMPS *****
      case 21: {
        J.stack(M.vs.menuPhase);
        const d = M.calcDepth(M.DP_INTERF);
        M.attachMovie('announce', 'announce', d);
        M.announce._x = M.docWidth / 2;
        M.announce._y = M.docHeight / 2;
        M.announce.win.gotoAndStop(6);
        for (i = 0; i < M.nbTracks; i++) {
          const lapCar = M.announce.win['lapCar_' + i], totalCar = M.announce.win['totalCar_' + i];
          // Temps au tour
          if (M.trackStats[i].$fcLap == Infinity) {                           // eslint-disable-line eqeqeq
            M.announce['b' + i] = '     -';
            if (lapCar) lapCar._visible = false;
          } else {
            M.announce['b' + i] = J.timeToString(M.trackStats[i].$fcLap);
            if (lapCar) {
              lapCar.skin.gotoAndStop(M.carStats[M.trackStats[i].$lapCar].skin);
              lapCar.boost._visible = false;
            }
          }
          // Temps total
          if (M.trackStats[i].$fcTotal == Infinity) {                         // eslint-disable-line eqeqeq
            M.announce['t' + i] = '     -';
            if (totalCar) totalCar._visible = false;
          } else {
            M.announce['t' + i] = J.timeToString(M.trackStats[i].$fcTotal);
            if (totalCar) {
              totalCar.skin.gotoAndStop(M.carStats[M.trackStats[i].$totalCar].skin);
              totalCar.boost._visible = false;
            }
          }
        }

        M.menuMC.fondMenu.play();
        M.menuMC.menuTitleANIM.play();
        M.menuMC.bande._visible = false;

        onPush = function () {
          J.back();
          J.playSoundBK('buttonCancel');
          J.removeAllButtons();
          rm(M.announce);
          M.menuMC.fondMenu.gotoAndPlay(1);
          M.menuMC.menuTitleANIM.gotoAndPlay(1);
          M.menuMC.bande._visible = true;
          M.killConfettis = true;
          J.clearShines();
        };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;
      }

      // ***** COUPES *****
      case 25: {
        J.stack(M.vs.menuPhase);
        const d = M.calcDepth(M.DP_INTERF);
        M.attachMovie('announce', 'announce', d);
        M.announce._x = M.docWidth / 2;
        M.announce._y = M.docHeight / 2;
        M.announce.win.gotoAndStop(5);

        let maxConfettis = 0;
        J.clearConfettis();
        M.killConfettis = false;

        if (!M.vs.$wcs) M.announce.win.classicSilv._visible = false; else maxConfettis += 3;
        if (!M.vs.$wc) M.announce.win.classic._visible = false; else maxConfettis += 15;
        if (!M.vs.$wss) M.announce.win.survSilv._visible = false; else maxConfettis += 3;
        if (!M.vs.$ws) M.announce.win.surv._visible = false; else maxConfettis += 7;
        // Étoile de l33t
        if (M.announce.win.stars) M.announce.win.stars._visible = !!(M.vs.$ws && M.vs.$wc);

        M.menuMC.fondMenu.play();
        M.menuMC.menuTitleANIM.play();
        M.menuMC.bande._visible = false;

        for (i = 0; i < maxConfettis; i++) J.spawnConfetti();

        onPush = function () {
          J.playSoundBK('buttonCancel');
          J.back();
          J.removeAllButtons();
          rm(M.announce);
          M.menuMC.fondMenu.gotoAndPlay(1);
          M.menuMC.menuTitleANIM.gotoAndPlay(1);
          M.menuMC.bande._visible = true;
          M.killConfettis = true;
          J.clearShines();
        };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.canMoveShines = false; // mis à TRUE par le clip announce
        M.vs.menuPhase++;
        break;
      }

      // ***** PALMARÈS : attente *****
      case 26:
        if (M.canMoveShines) J.moveShines();
        break;

      // ***** TOUCHES : affichage *****
      case 30:
        M.menuMC.menuTitleANIM.menuTitle.title = 'touches';
        M.attachMovie('keysManager', 'keys', M.calcDepth(M.DP_INTERF));
        M.keys._x = M.docWidth / 2;
        M.keys._y = M.docHeight / 2;
        M.keys.manager.stop();
        M.keys.manager.conflict._visible = false;
        M.keyAsked = undefined;
        for (i = 0; i < M.controlNames.length; i++) {
          M.keys.manager['controlName_' + i] = M.controlNames[i];
          M.keys.manager['control_' + i] = M.keyNames[M.controls[i]];
        }
        onPush = function () { rm(M.keys); J.playSoundBK('buttonOk'); J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(2, 'valider', 2, -70, 320, onPush, undefined, onEnd);
        M.vs.menuPhase = 31;
        break;

      // ***** TOUCHES : attente du choix d'un contrôle à modifier *****
      case 31:
        if (M.keyAsked !== undefined) {
          J.playSoundBK('buttonKeys');
          M.keys.manager.gotoAndStop(2);
          M.keys.manager.current = M.controlNames[M.keyAsked];
          M.vs.menuPhase = 32;
        }
        break;

      // ***** TOUCHES : attente d'une touche *****
      case 32: {
        const touche = J.getAnyKey();
        if (touche !== undefined) {
          if (touche != Key.ESCAPE) {                                         // eslint-disable-line eqeqeq
            M.controls[M.keyAsked] = touche;
            M.keys.manager['control_' + M.keyAsked] = M.keyNames[touche];
            J.playSoundBK('buttonKeysOk');
          } else {
            J.playSoundBK('buttonCancel');
          }
          M.keyAsked = undefined;
          M.keys.manager.gotoAndStop(1);
          const conflict = J.checkConflicts();
          M.keys.manager.conflict._visible = conflict;
          if (M.menuButton_2) M.menuButton_2._visible = !conflict;
          M.vs.menuPhase = 31;
        }
        break;
      }

      // ***** INTRO COURSE *****
      case 90:
        J.stack(M.vs.menuPhase);
        M.menuMC.bande._visible = false;
        M.menuMC.introCourseANIM._visible = true;
        M.menuMC.introCourseANIM.gotoAndPlay(1);
        if (M.tracks[M.vs.selectedTrack].totalLaps <= 1) M.menuMC.introCourseANIM.toursTxt = M.tracks[M.vs.selectedTrack].totalLaps + ' tour';
        else M.menuMC.introCourseANIM.toursTxt = M.tracks[M.vs.selectedTrack].totalLaps + ' tours';
        for (i = 0; i < M.tracks.length; i++) {
          mc = M.menuMC.introCourseANIM.introCourse.trackSel['track' + i];
          if (!mc) continue;
          mc._visible = (i == M.vs.selectedTrack);                            // eslint-disable-line eqeqeq
        }
        M.menuMC.introCourseANIM.introCourse.title = M.tracks[M.vs.selectedTrack].title.toLowerCase();
        M.menuMC.introCourseANIM.introCourse.summary = M.tracks[M.vs.selectedTrack].summary;
        M.vs.menuPhase++;
        break;

      // ***** INTRO COURSE : attente *****
      case 91:
        if (J.skipTest()) {
          J.playSoundBK('buttonOk');
          if (M.skipToTrackPresent) M.vs.mainPhase = 3;
          else M.vs.menuPhase++;
        }
        break;

      // ***** INTRO COURSE : envoi au serveur *****
      case 92:
        if (M.vs.gameMode == M.TUTORIAL) { M.vs.mainPhase = 3; break; }       // eslint-disable-line eqeqeq
        J.attachNetworkPop();
        J.savePublic();
        gdebug('startgame');
        client().startGame();
        M.vs.menuPhase++;
        break;

      // ***** INTRO COURSE : données reçues *****
      case 93:
        if (client().error) {
          J.detachNetworkPop();
          M.menuMC.introCourseANIM._visible = false;
          M.menuMC.fondMenu.gotoAndPlay(1);
          M.menuMC.menuTitleANIM.gotoAndPlay(1);
          M.menuMC.bande._visible = true;
          M.vs.menuPhase = 99;
        }
        if (client().fl_success) {
          J.detachNetworkPop();
          M.vs.mainPhase = 3;
        }
        break;

      // ***** MENU PRINCIPAL *****
      case 99: {
        J.stack(99);
        M.menuMC.bande._visible = true;
        M.menuMC.infoPanel._visible = false;
        M.menuMC.menuTitleANIM.menuTitle.title = 'menu principal';
        // Bouton jouer
        onPush = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(1, 'jouer', 1, 10, 80, onPush, undefined, onEnd);

        let skin;
        if (client().isWhite()) {
          onPush = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); };
          onEnd = function () {};
          skin = M.skinAllow;
        } else {
          onPush = function () { refuser(M.demoLabel); };
          onEnd = undefined;
          skin = M.skinDisallow;
        }
        J.attachButton(20, 'palmares', skin, -5, 120, onPush, undefined, onEnd);

        // Bouton options
        onPush = function () { J.playSoundBK('buttonOk'); J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(2, 'options', 1, -20, 160, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;
      }

      // ***** INTRO : affichage *****
      case 100:
        M.createEmptyMovieClip('intro', M.calcDepth(M.DP_PRELOAD));
        M.intro._visible = false;
        J.startPreload(M.intro, 'intro.swf', 'Chargement de l\'intro');
        M.vs.menuPhase++;
        break;
      case 101:
        if (J.mainPreload()) {
          M.grille._visible = false;
          M.intro._visible = true;
          M.vs.menuPhase++;
          if (M.musicON) {
            if (!M.musicMenu.isPlaying) {
              J.stopMusic(M.musicGame);
              J.startMusic(M.musicMenu);
            }
          }
        }
        break;
      case 102:
        if (J.skipTest()) {
          rm(M.intro);
          M.grille._visible = true;
          M.vs.menuPhase++;
        }
        break;

      case 103: {
        J.stack(M.vs.menuPhase);
        const d = M.calcDepth(M.DP_PRELOAD);
        M.attachMovie('logo', 'logo', d);
        M.logo._x = M.docWidth / 2;
        M.logo._y = M.docHeight / 2;
        if (M.musicON) {
          if (!M.musicMenu.isPlaying) {
            J.stopMusic(M.musicGame);
            J.startMusic(M.musicMenu);
          }
        }
        M.vs.menuPhase++;
        break;
      }

      // ***** INTRO : anti-skip *****
      case 104:
        if (!J.skipTest()) M.vs.menuPhase++;
        break;

      // ***** INTRO : attente *****
      case 105:
        if (J.skipTest()) {
          J.playSoundBK('buttonOk');
          M.logo.gotoAndPlay('hide');
          M.menuMC.fondMenu.gotoAndPlay(1);
          M.menuMC.menuTitleANIM.gotoAndPlay(1);
          M.menuMC.bande._visible = true;
          M.vs.menuPhase = 99;
        }
        break;

      // ***** LOADER MUSIC DE MENU : init *****
      case 110:
        if (M.menuMusicLoaded) { M.vs.menuPhase = 103; break; }
        M.musicMenu = J.initMusicLoader(M.musicMenuMC, 'bkMenu.mp3');
        M.vs.menuPhase++;
        break;

      // ***** LOADER MUSIC DE MENU : boucle *****
      case 111:
        if (J.mainPreload()) {
          M.menuMusicLoaded = true;
          M.vs.menuPhase = 100;
        }
        break;

      // ***** CONNEXION : ouverture de la connexion *****
      case 120:
        J.attachNetworkPop();
        client().serviceConnect();
        gdebug('Connecting to service...');
        M.vs.menuPhase++;
        break;

      /*
       * CONNEXION : connecté et prêt (onServerReady)
       *
       * D'ÉPOQUE, un échec ici posait `menuPhase = -1` et s'en remettait à la
       * plateforme des Fruits Défendus, autour du jeu, pour montrer l'erreur
       * et refermer le disque. Ici il n'y a pas de plateforme autour : la
       * phase -1 est l'attente d'un bouton, et AUCUN bouton n'a encore été
       * posé (on n'a pas atteint la phase 99). Le joueur se retrouvait devant
       * un fond de menu vide et muet — plus qu'à éjecter le FD.
       *
       * On réessaie donc une fois, puis on entre QUAND MÊME dans le menu, en
       * mode hors ligne : `charge` reste faux, donc aucune case de la
       * fruticard ne sera écrite (Client.saveSlot le refuse) — on ne risque
       * pas d'écraser des records avec une carte vide. On joue, on ne garde
       * rien, et c'est infiniment mieux qu'un écran mort.
       */
      case 121:
        if (client().error) {
          if (!M.reconnexionFaite) {
            M.reconnexionFaite = true;
            client().serviceConnect();
            break;
          }
          M.fl_allowReset = true;
          J.initFrutiCardContent();
          J.readFrutiCard();
          J.detachNetworkPop();
          J.report('service indisponible : menu en mode hors ligne');
          M.vs.menuPhase++;
          break;
        }
        if (client().connected) {
          M.reconnexionFaite = false;
          M.fl_allowReset = true;
          J.initFrutiCardContent();
          J.readFrutiCard();
          J.detachNetworkPop();
          M.vs.menuPhase++;
        }
        break;

      // ***** CONNEXION : test du Stage *****
      case 122:
        if (J.Stage.width == 350 && J.Stage.height == 350) M.vs.menuPhase = 110;   // eslint-disable-line eqeqeq
        else {
          J.fatal('Votre frusion ne peut afficher correctement ce jeu', 'bad size: ' + J.Stage.width + 'x' + J.Stage.height);
          M.vs.menuPhase = -1;
        }
        break;

      // ***** CONNEXION : sauvegarde des préférences *****
      case 130:
        J.attachNetworkPop();
        J.savePreferences();
        M.vs.menuPhase++;
        break;
      case 131:
        if (client().fl_success) {
          J.detachNetworkPop();
          M.vs.menuPhase = 99;
        }
        break;

      // ***** COURSE CHALLENGE *****
      case 140: {
        J.stack(M.vs.menuPhase);
        M.menuMC.bande._visible = false;
        M.menuMC.infoPanel._visible = false;
        M.menuMC.menuTitleANIM.menuTitle.title = '';
        M.menuMC.menuTitleANIM.play();
        M.menuMC.fondMenu.play();
        M.menuMC.dailyTrack._visible = true;

        // <daily trk="N"/> : la course du jour, dite par le serveur
        const trk = /\btrk="(\d+)"/.exec(String(client().dailyData || ''));
        M.vs.selectedTrack = trk ? parseInt(trk[1], 10) : NaN;
        if (client().dailyData == null) {                                     // eslint-disable-line eqeqeq
          J.fatal('La course du jour n\'a pas été choisie par le grand jury', 'dailyData undefined');
        }
        M.menuMC.dailyTrack.trackName = M.tracks[M.vs.selectedTrack] ? M.tracks[M.vs.selectedTrack].title.toLowerCase() : '';

        for (i = 0; i < M.tracks.length; i++) {
          mc = M.menuMC.dailyTrack.track['track' + i];
          if (!mc) continue;
          mc._visible = (i == M.vs.selectedTrack);                            // eslint-disable-line eqeqeq
        }

        // Nombre de tours
        if (M.tracks[M.vs.selectedTrack] && M.tracks[M.vs.selectedTrack].totalLaps <= 1) M.menuMC.toursTxt = M.tracks[M.vs.selectedTrack].totalLaps + ' tour';
        else if (M.tracks[M.vs.selectedTrack]) M.menuMC.toursTxt = M.tracks[M.vs.selectedTrack].totalLaps + ' tours';

        onPush = function () {
          M.menuMC.menuTitleANIM.gotoAndPlay(1);
          M.menuMC.fondMenu.gotoAndPlay(1);
          J.playSoundBK('buttonOk');
          J.removeAllButtons();
          M.menuMC.dailyTrack._visible = false;
        };
        onEnd = function () {};
        J.attachButton(4, 'jouer', 2, -70, 280, onPush, undefined, onEnd);

        onPush = function () {
          M.menuMC.menuTitleANIM.gotoAndPlay(1);
          M.menuMC.fondMenu.gotoAndPlay(1);
          J.playSoundBK('buttonCancel');
          J.back();
          J.removeAllButtons();
          M.menuMC.dailyTrack._visible = false;
        };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;
      }

      // ***** DUEL : choix adversaire *****
      case 150: {
        J.stack(M.vs.menuPhase);
        M.menuMC.bande._visible = false;
        M.menuMC.infoPanel.gotoAndPlay(1);
        M.menuMC.infoPanel._visible = true;
        M.menuMC.infoPanel.txt = 'Choisissez l\'écurie que vous affronterez.';
        M.menuMC.menuTitleANIM.menuTitle.title = 'adversaire';

        M.attachMovie('teamList', 'teamList', M.calcDepth(M.DP_INTERF));
        M.teamList._x = M.docWidth - 75;
        M.teamList._y = 120;
        M.teamList._xscale = 57;
        M.teamList._yscale = M.teamList._xscale;
        M.teamList.gotoAndStop(M.vs.selectedAdv + 1);

        const choisir = (n) => function () {
          J.playSoundBK('buttonSwitch');
          this.pushed = false;
          M.vs.selectedAdv = n;
          M.teamList.gotoAndStop(M.vs.selectedAdv + 1);
        };
        J.attachButton(41, M.carSkinNames[0].toLowerCase(), 3, -15, 80, choisir(0), undefined, undefined);
        J.attachButton(42, M.carSkinNames[1].toLowerCase(), 3, -15, 120, choisir(1), undefined, undefined);
        J.attachButton(43, M.carSkinNames[2].toLowerCase(), 3, -15, 160, choisir(2), undefined, undefined);
        J.attachButton(44, M.carSkinNames[3].toLowerCase(), 3, -15, 200, choisir(3), undefined, undefined);
        J.attachButton(45, M.carSkinNames[4].toLowerCase(), 3, -15, 240, choisir(4), undefined, undefined);

        onPush = function () {
          rm(M.teamList);
          J.playSoundBK('buttonOk');
          M.menuMC.infoPanel.gotoAndPlay('hide');
          M.menuMC.fondMenu.play();
          M.menuMC.menuTitleANIM.play();
          J.removeAllButtons();
        };
        onEnd = function () {};
        J.attachButton(90, 'ok', 2, -70, 280, onPush, undefined, onEnd);

        onPush = function () { J.back(); rm(M.teamList); J.playSoundBK('buttonCancel'); J.removeAllButtons(); };
        onEnd = function () {};
        J.attachButton(J.getPrevious(), 'retour', 2, -70, 320, onPush, undefined, onEnd);

        M.vs.menuPhase = -1;
        break;
      }
      default: break;
    }
  };

  // BOUCLES DE GESTION DES BOUTONS
  J.manageButtons = function () {
    for (let i = 0; i < M.buttons.length; i++) {
      M.mc = M.buttons[i];
      if (!M.mc.kill && M.killAll) M.mc.play();
      if (M.mc.kill) {
        M.buttons.splice(i, 1);
        M.mc.removeMovieClip();
        i--;
      }
    }
    if (M.killAll) M.killAll = false;
  };

  // BOUCLES DE GESTION DES CHEAT CODES
  J.manageSpecials = function () {
    if (M.skipToTrackPresent) return;
    for (let i = 0; i < M.specials.length; i++) {
      const sp = M.specials[i];
      if (Key.isDown(String(sp.chaine).charCodeAt(sp.pos))) {
        sp.pos++;
        if (sp.pos >= String(sp.chaine).length) {
          sp.pos = 0;
          if (client().isWhite()) {
            M.specialsUsed = true;
            sp.state = !sp.state;
            rm(M.sBox);
            M.attachMovie('specialsBox', 'sBox', M.calcDepth(M.DP_SPECIALSBOX));
            M.sBox._x = M.docWidth / 2;
            M.sBox._y = 100;
            M.sBox.txt = String(sp.chaine);
            M.sBox.underTxt = sp.state ? 'activé' : 'désactivé';
            // Au moins un code de gameplay actif ?
            M.vs.useSpecials = false;
            for (let j = 0; j < M.specials.length; j++) {
              if (M.specials[j].state && j != 4 && j != 5 && j != 6) M.vs.useSpecials = true;   // eslint-disable-line eqeqeq
            }
            // Si la KiwiX est choisie alors que le code est désactivé…
            if (M.vs.selectedCar == 4 && !sp.state && i == 0) M.vs.selectedCar = 0;   // eslint-disable-line eqeqeq
          } else if (!M.limited._visible) {
            M.limited.label = M.demoLabel;
            M.limited._visible = true;
            M.limited.gotoAndPlay(1);
          }
        }
        M.specTimeOut = 40;
      }
    }
    if (M.specTimeOut) {
      M.specTimeOut -= G.gtmod;
      if (M.specTimeOut <= 0) {
        M.specTimeOut = 0;
        for (let i = 0; i < M.specials.length; i++) M.specials[i].pos = 0;
      }
    }
  };

  // EFFACE LES REFLETS SUR LES COUPES
  J.clearShines = function () {
    for (let i = 0; i < M.fx.length; i++) {
      if (M.fx[i].isShine) {
        M.fx[i].removeMovieClip();
        M.fx.splice(i, 1);
        i--;
      }
    }
  };

  // BOUCLE DES REFLETS SUR LES COUPES
  J.moveShines = function () {
    if (random(10) == 0) {                                                    // eslint-disable-line eqeqeq
      const maxTries = 15;
      let tries = 0, valid = false, x, y;
      const win = M.announce.win;
      do {
        x = random(M.docWidth);
        y = random(M.docHeight);
        if ((win.classic.hitTest(x, y, true) && win.classic._visible)
            || (win.classicSilv.hitTest(x, y, true) && win.classicSilv._visible)
            || (win.surv.hitTest(x, y, true) && win.surv._visible)
            || (win.survSilv.hitTest(x, y, true) && win.survSilv._visible)) valid = true;
        tries++;
      } while (tries < maxTries && !valid);

      if (tries < maxTries) {
        const d = M.calcDepth(M.DP_FXTOP, true);
        M.attachMovie('shine', 'shine_' + d, d);
        const mc = M['shine_' + d];
        mc._x = x;
        mc._y = y;
        mc._xscale = random(40) + 20;
        mc._yscale = mc._xscale;
        mc._rotation = random(360);
        mc.kill = false;
        mc.isShine = true;
        M.fx.push(mc);
      }
    }
    for (let i = 0; i < M.fx.length; i++) {
      if (M.fx[i].kill) {
        M.fx[i].removeMovieClip();
        M.fx.splice(i, 1);
        i--;
      }
    }
  };

  // BOUCLE DES ANIMS DE FOND DE MENU
  J.moveBgFx = function () {
    if (M.bgFx.length < 2 && M.gameQuality >= M.MEDIUM) J.attachBgFx();
    for (let i = 0; i < M.bgFx.length; i++) {
      const f = M.bgFx[i];
      f.timer -= G.gtmod;
      f._xscale += G.gtmod;
      f._yscale = f._xscale;
      if (M.gameQuality < M.MEDIUM) f.timer = 0;
      if (f.timer <= 0) {
        if (!f.doOnce) {
          f.doOnce = true;
          if (M.gameQuality >= M.MEDIUM) J.attachBgFx();
        }
        f._alpha -= G.gtmod;
        if (f._alpha <= 0) {
          f.removeMovieClip();
          M.bgFx.splice(i, 1);
        }
      } else {
        f._alpha += G.gtmod;
        f._alpha = Math.min(f._alpha, f.maxAlpha);
      }
    }
  };

  // ATTACHE UN EFFET FOND DE MENU
  J.attachBgFx = function () {
    const d = M.calcDepth(M.DP_FXBG);
    M.attachMovie('backgroundFx', 'bgFx_' + d, d);
    const mc = M['bgFx_' + d];
    mc._x = random(290) + 30;
    mc._y = random(290) + 30;
    mc.gotoAndStop(random(M.nbBgFx) + 1);
    mc.timer = random(80) + 40;
    mc._alpha = 0;
    mc._xscale = random(50) + 20;
    mc._yscale = mc._xscale;
    mc.maxAlpha = random(20) + 30;
    M.bgFx.push(mc);
  };

  // ATTACH D'UN BOUTON DU MENU
  J.attachButton = function (id, label, skin, x, y, pushFunction, updateFunction, endFunction, overFunction, outFunction) {
    const d = M.calcDepth(M.DP_INTERF);
    M.attachMovie('menuButton', 'menuButton_' + id, d);
    const mc = M['menuButton_' + id];
    mc._x = x;
    mc._y = y;
    mc.id = id;
    mc.skin.label = String(label).toLowerCase();
    mc.skin.gotoAndStop(skin);
    mc.onPush = pushFunction;
    mc.onUpdate = updateFunction;
    mc.onEnd = endFunction;
    mc.onOver = overFunction;
    mc.onOut = outFunction;
    M.buttons.push(mc);
    return mc;
  };

  // DISPARITION DE TOUS LES BOUTONS
  J.removeAllButtons = function () { M.killAll = true; };

  // MET A JOUR LES JAUGES DE STATS DU PANNEAU DES ECURIES
  J.updateStats = function (idCar) {
    M.menuMC.carSel.car_5._visible = false;
    for (let i = 0; i < M.carStats.length; i++) {
      if (i == idCar) {                                                       // eslint-disable-line eqeqeq
        if (idCar == 0 && M.specials[5].state && !M.specials[4].state) M.menuMC.carSel.car_5._visible = true;   // eslint-disable-line eqeqeq
        else M.menuMC.carSel['car_' + i]._visible = true;
      } else {
        M.menuMC.carSel['car_' + i]._visible = false;
      }
    }
    // Met à jour les stats
    const mc = M.menuMC.carSel.stats;
    M.mc = mc;
    mc.speed.mask._xscale = M.staticStats[idCar].maxSpeed * 100;
    mc.accel.mask._xscale = M.staticStats[idCar].accel * 100;
    mc.grip.mask._xscale = M.staticStats[idCar].grip * 100;
    mc.rot.mask._xscale = M.staticStats[idCar].rot * 100;
    let i = 0;
    while (mc['kiwi_' + i] !== undefined) {
      mc['kiwi_' + i]._visible = (i < M.carStats[idCar].kiwis);
      i++;
    }
  };

  // ANIMATION DU SCROLLING EN FOND
  J.animGrid = function () {
    if (M.gameQuality < M.HIGH) return;
    const g = M.grille;
    if (!vif(g)) return;                                  // sans grille, ses champs tombent dans le vide
    if (g.nbCycles >= g.nbCyclesMax) {
      g.nbCycles = 0;
      g.nbCyclesMax = random(50) + 50;
      g.tang = random(180) * (random(2) * 2 - 1);
    }
    if (g.ang < g.tang) {
      g.ang += 5;
      if (g.ang > g.tang) g.ang = g.tang;
    }
    if (g.ang > g.tang) {
      g.ang -= 5;
      if (g.ang < g.tang) g.ang = g.tang;
    }
    g.angRad = (Math.PI / 180) * g.ang;
    g.dx = Math.cos(g.angRad) * g.speed;
    g.dy = Math.sin(g.angRad) * g.speed;
    g._x += g.dx;
    g._y += g.dy;
    if (g._x > 100) g._x -= 68;
    if (g._x < 0) g._x += 68;
    if (g._y > 100) g._y -= 68;
    if (g._y < 0) g._y += 68;
    g.nbCycles++;
  };

  // INITIALISATION DE LA GRILLE
  J.initGrid = function () {
    if (!vif(M.grille)) {
      rm(M.grille);
      M.d = M.calcDepth(M.DP_GRID);
      M.attachMovie('grille', 'grille', M.d);
      M.grille.dx = 0;
      M.grille.dy = 0;
      M.grille.speed = 7;
      M.grille.ang = 0;
      M.grille.nbCycles = 0;
      M.grille.nbCyclesMax = 0;
      M.grille._x = 0;
      M.grille._y = 0;
    }
  };

  J.endMenu = function () { M.vs.mainPhase = 3; };

  // RENVOIE true S'IL Y A UN CONFLIT DE CONTRÔLES
  J.checkConflicts = function () {
    let conflict = false;
    for (let i = 0; i < M.controls.length; i++) {
      for (let j = i + 1; j < M.controls.length; j++) if (M.controls[i] == M.controls[j]) conflict = true;   // eslint-disable-line eqeqeq
    }
    return conflict;
  };

  // L'HISTORIQUE DES PHASES
  J.stack = function (phaseId) { if (M.history[M.history.length - 1] != phaseId) M.history.push(phaseId); };   // eslint-disable-line eqeqeq
  J.back = function () { M.history.splice(M.history.length - 1); };
  J.getPrevious = function () { return M.history[M.history.length - 2]; };

  // INITIALISATION DU MENU
  J.initMenu = function () {
    if (M.vs.selectedTrack == 99) M.vs.selectedTrack = 0;                     // eslint-disable-line eqeqeq

    // Attache le menu
    const d = M.calcDepth(M.DP_MENU);
    M.attachMovie('mainMenu', 'menuMC', d);
    M.menuMC._x = M.docWidth / 2;
    M.menuMC._y = M.docHeight / 2;

    J.initGrid();

    // Effets de fond
    J.attachBgFx();
    J.attachBgFx();

    // Divers
    M.killConfettis = false;
    M.newTournament = false;
    if (M.skipToTrackPresent) {
      M.menuMC.fondMenu._visible = false;
      M.menuMC.menuTitleANIM._visible = false;
      M.vs.menuPhase = 90; // pour les tournois, on zappe direct à la présentation de la course
    } else if (client().connected) {
      M.vs.menuPhase = 110; // Loader musique de menu
    } else {
      M.vs.menuPhase = 120; // Loading des données du serveur
    }
    M.history = [];

    // Qualité
    J.setDetailLevel(M.qualitySetting);

    // Masquages
    M.menuMC.dailyTrack._visible = false;
    M.menuMC.trackSel._visible = false;
    M.menuMC.carSel._visible = false;
    M.menuMC.introCourseANIM._visible = false;
    M.menuMC.introCourseANIM.gotoAndStop(1);
    M.menuMC.infoPanel.stop();
    M.menuMC.infoPanel._visible = false;
    // (limited.stop() / _visible : le clip n'est attaché que plus bas — le vide)
    M.menuMC.warningSpecials._visible = false;
    M.menuMC.bande._visible = false;
    M.menuMC.fondMenu.gotoAndStop(1);
    M.menuMC.menuTitleANIM.gotoAndStop(1);

    // Indicateur de refus
    M.attachMovie('limited', 'limited', M.calcDepth(M.DP_FXTOP));
    M.limited._x = 80;
    M.limited._y = 240;
    M.limited.stop();
    M.limited._visible = false;
  };
};

})(typeof window !== 'undefined' ? window : globalThis);
