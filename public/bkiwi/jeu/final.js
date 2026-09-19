/*
 * Burning Kiwi — la FIN DE COURSE (Games/burningKiwi/inc/mainFinal.as) : le
 * classement (finalPosition, avec les confettis du vainqueur), les stats de
 * la course (raceStats : temps, vitesse de pointe, hors-piste, collisions,
 * perfects, et le grade), puis selon le mode le bilan du tournoi
 * (tournamentSummary — la course, puis le total —, les coupes gagnées sur les
 * courses 4 et 6), le bilan du Survivor (les vies, la vie perdue), le duel
 * gagné (l'écurie débloquée), le game over, l'envoi du score au serveur
 * (phase 40-41 : saveScore ou endGame sur abandon) et l'annonce du classement
 * Frutiparc (phase 50 : la place, la progression).
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.BkiwiJeu = racine.BkiwiJeu || {};
const G = J.G;
const random = J.random;
const rm = J.rm;

J.installerFinal = function (M) {
  const client = () => M.client;
  const gdebug = J.gdebug;

  // MAIN DE LA PHASE FINALE
  J.mainFinal = function () {
    J.animGrid();
    J.moveConfettis();

    switch (M.vs.finalPhase) {
      case -1: break;

      // *** CLASSEMENT DE COURSE
      case 0:
        if (M.vs.giveUp) M.vs.finalPhase = 30;
        else if (M.vs.gameMode == M.KIWIRUN) M.vs.finalPhase = 3;             // eslint-disable-line eqeqeq
        else M.vs.finalPhase++;
        break;

      case 1: {
        const d = M.calcDepth(M.DP_INTERF);
        M.attachMovie('finalPosition', 'finalPosition', d);
        // Confettis pour la première place
        if (M.classement == 1) for (let i = 0; i < 20; i++) J.spawnConfetti();   // eslint-disable-line eqeqeq
        M.vs.finalPhase++;
        break;
      }

      case 2:
        if (J.skipTest()) {
          J.playSoundBK('buttonOk');
          rm(M.finalPosition);
          gdebug('fl_localScore = ' + client().fl_localScore);
          M.vs.finalPhase++;
          if (J.gameEnded()) {
            if (M.vs.gameMode == M.ARCADE && !M.vs.giveUp) M.vs.finalPhase = 50;   // eslint-disable-line eqeqeq
          }
        }
        break;

      // *** STATS DE COURSE
      case 3:
        if (!J.skipTest()) {
          const d = M.calcDepth(M.DP_INTERF);
          M.attachMovie('raceStats', 'raceStats', d);
          const rs = M.raceStats;
          rs._x = M.docWidth / 2;
          rs._y = M.docHeight / 2;
          rs.trackName_txt = M.race.trackName;
          rs.carName_txt = M.race.carName;
          rs.raceTime_txt = J.timeToString(M.race.raceTime);
          rs.maxSpeed_txt = Math.round(M.race.topSpeed * M.kmhFact) + ' km/h';
          rs.offRoadTotal_txt = J.timeToString(M.race.offRoadTotal);
          if (M.vs.gameMode == M.KIWIRUN) rs.bestLap_txt = 'N/A';             // eslint-disable-line eqeqeq
          else rs.bestLap_txt = J.timeToString(M.race.bestLap);
          if (M.vs.gameMode == M.KIWIRUN || M.vs.gameMode == M.TIMETRIAL) rs.collisions_txt = 'N/A';   // eslint-disable-line eqeqeq
          else rs.collisions_txt = M.race.collisions;
          if (M.vs.gameMode == M.KIWIRUN) rs.perfects_txt = 'N/A';            // eslint-disable-line eqeqeq
          else rs.perfects_txt = M.race.perfects + ' / ' + M.race.totalLaps;
          // Perfect ?
          if (M.race.offRoadTotal == 0 && M.race.collisions == 0) rs.perfect = true;   // eslint-disable-line eqeqeq
          // Grade
          rs.perfectsRank = M.race.rank.perfectsRank;
          rs.posRank = M.race.rank.posRank;
          M.vs.finalPhase++;
        }
        break;

      case 4:
        if (J.skipTest()) {
          J.playSoundBK('buttonOk');
          rm(M.raceStats);
          if (M.vs.gameMode == M.FRUTICUP) { M.vs.finalPhase = 10; break; }   // eslint-disable-line eqeqeq
          if (M.vs.gameMode == M.SURVIVOR) { M.vs.finalPhase = 20; break; }   // eslint-disable-line eqeqeq
          if (M.vs.gameMode == M.DUEL) {                                      // eslint-disable-line eqeqeq
            if (M.classement == 1) M.vs.finalPhase = 60;                      // eslint-disable-line eqeqeq
            else M.vs.finalPhase = 30;
            break;
          }
          if ((M.vs.gameMode == M.TRAINING || M.vs.gameMode == M.ARCADE) && M.classement != 1) {   // eslint-disable-line eqeqeq
            M.vs.finalPhase = 30;
            break;
          }
          M.skipToTrackPresent = false;
          rm(M.finalScrolls);
          J.gotoMenu();
        }
        break;

      // *** FRUTICOUPE
      case 10:
        if (!J.skipTest()) {
          const d = M.calcDepth(M.DP_INTERF);
          M.attachMovie('tournamentSummary', 'summary', d);
          M.summary._x = M.docWidth / 2;
          M.summary._y = M.docHeight / 2;
          M.summary.titre = 'BILAN DE LA COURSE';
          for (let i = 0; i < M.tournament.podiumRace.length; i++) {
            const c = M.tournament.cars[M.tournament.podiumRace[i]];
            M.summary['car_' + i] = '<P ALIGN="CENTER">' + c.carName + '</P>';
            M.summary['pts_' + i] = '<P ALIGN="CENTER">' + c.racePts + '</P>';
            if (M.tournament.podiumRace[i] == 0) {                            // eslint-disable-line eqeqeq
              M.summary['car_' + i] = '<B>' + M.summary['car_' + i] + '</B>';
              M.summary['pts_' + i] = '<B>' + M.summary['pts_' + i] + '</B>';
            }
          }
          M.summary.timeTxt = J.timeToString(M.tournament.cars[0].raceTime, ' min ', ' sec ', '');
          M.vs.finalPhase++;
        }
        break;

      case 11:
        if (J.skipTest()) { J.playSoundBK('buttonOk'); M.vs.finalPhase++; }
        break;

      case 12:
        if (!J.skipTest()) {
          M.vs.finalPhase++;
          M.summary.titre = 'BILAN DU TOURNOI';
          for (let i = 0; i < M.tournament.podium.length; i++) {
            const c = M.tournament.cars[M.tournament.podium[i]];
            M.summary['car_' + i] = '<P ALIGN="CENTER">' + c.carName + '</P>';
            M.summary['pts_' + i] = '<P ALIGN="CENTER">' + c.totalPts + '</P>';
            if (M.tournament.podium[i] == 0) {                                // eslint-disable-line eqeqeq
              M.summary['car_' + i] = '<B>' + M.summary['car_' + i] + '</B>';
              M.summary['pts_' + i] = '<B>' + M.summary['pts_' + i] + '</B>';
            }
          }
          M.summary.timeTxt = J.timeToString(M.tournament.cars[0].totalTime, ' min ', ' sec ', '');
        }
        break;

      case 13:
        if (J.skipTest()) { J.playSoundBK('buttonOk'); M.vs.finalPhase++; }
        break;

      case 14:
        if (!J.skipTest()) {
          rm(M.summary);
          rm(M.finalScrolls);
          if (M.vs.giveUp) {
            M.skipToTrackPresent = false;
            J.gotoMenu();
          } else {
            M.vs.selectedTrack++;
          }
          // Gagne une coupe si on est premier sur une des courses finales
          if (!M.vs.useSpecials
              && ((M.vs.selectedTrack == 4 && M.tournament.podium[0] == 0)       // eslint-disable-line eqeqeq
                || (M.vs.selectedTrack == 6 && M.tournament.podium[0] == 0))) {   // eslint-disable-line eqeqeq
            const d = M.calcDepth(M.DP_INTERF);
            M.attachMovie('announce', 'announce', d);
            M.announce._x = M.docWidth / 2;
            M.announce._y = M.docHeight / 2;
            if (M.vs.selectedTrack == 6) { // Coupe d'or                     // eslint-disable-line eqeqeq
              M.announce.win.gotoAndStop(4);
              J.giveCup(M.vs.$wc, '$fruticupxl');
              M.vs.$wc = true;
              J.savePublic();
            } else { // Coupe d'argent
              M.announce.win.gotoAndStop(3);
              J.giveCup(M.vs.$wcs, '$fruticup');
              J.unlockMode(M.DUEL);
              J.unlockMode(M.SURVIVOR);
              M.vs.$wcs = true;
              J.savePublic();
            }
            M.vs.finalPhase++;
          } else {
            M.vs.finalPhase += 2;
          }
        }
        break;

      case 15:
        if (J.skipTest()) {
          J.playSoundBK('buttonOk');
          rm(M.announce);
          if (M.vs.selectedTrack == 4 && M.vs.$wss) M.vs.finalPhase++;         // eslint-disable-line eqeqeq
          else M.vs.finalPhase = 30;
        }
        break;

      case 16:
        if ((M.vs.selectedTrack == 4 && M.tournament.podium[0] != 0)          // eslint-disable-line eqeqeq
            || (M.vs.selectedTrack == 4 && (!M.vs.$wss || !J.checkMode(M.SURVIVOR)))   // eslint-disable-line eqeqeq
            || (M.vs.selectedTrack == 6)) {                                   // eslint-disable-line eqeqeq
          M.vs.finalPhase = 30;
        } else {
          J.gotoMenu();
          M.skipToTrackPresent = true;
        }
        break;

      // *** SURVIVOR
      case 20:
        if (!J.skipTest()) {
          const d = M.calcDepth(M.DP_INTERF);
          M.attachMovie('survivorSummary', 'summary', d);
          M.summary._x = M.docWidth / 2;
          M.summary._y = M.docHeight / 2;
          if (M.vs.giveUp || J.gameEnded()) M.summary.summary.msg._visible = false;
          else if (M.classement == 1) M.summary.summary.msg.gotoAndStop(3);   // eslint-disable-line eqeqeq
          else if (M.classement == 2) M.summary.summary.msg.gotoAndStop(1);   // eslint-disable-line eqeqeq
          else M.summary.summary.msg.gotoAndStop(2);

          // Attachement des MCs des vies restantes
          for (let i = 0; i < M.survivorLives; i++) {
            M.summary.summary.attachMovie('survivorLife', 'survivorLife_' + i, i);
            const mc = M.summary.summary['survivorLife_' + i];
            const w = 50;
            mc._x = w / 2 + i * w - (M.survivorLives * w / 2);
            mc._y = 5;
            if (i + 1 > M.tournament.vs.lives) {
              mc.gotoAndStop(2);
              // Anim de perte de vie
              if (M.classement > 2 && i + 1 == M.tournament.vs.lives + 1) {   // eslint-disable-line eqeqeq
                M.summary.summary.attachMovie('loseLife', 'loseLife', 100 + i);
                M.summary.summary.loseLife._x = mc._x;
                M.summary.summary.loseLife._y = mc._y;
              }
            } else {
              mc.gotoAndStop(1);
            }
          }
          M.canPlaySound = false;
          M.vs.finalPhase++;
        }
        break;

      case 21:
        // canPlaySound est mis à TRUE par l'anim de la bille qui explose
        if (M.canPlaySound) {
          J.playSoundBK('loseLifeSound');
          M.canPlaySound = false;
        }
        if (J.skipTest()) { J.playSoundBK('buttonOk'); M.vs.finalPhase++; }
        break;

      case 22:
        if (!J.skipTest()) {
          rm(M.summary);
          rm(M.finalScrolls);
          if (M.tournament.vs.lives > 0) {
            if (M.classement == 1) M.vs.selectedTrack++;                      // eslint-disable-line eqeqeq
            // Gagne une coupe ?
            if (M.classement == 1 && !M.vs.useSpecials                        // eslint-disable-line eqeqeq
                && ((M.vs.selectedTrack == 4) || (M.vs.selectedTrack >= 6))) {   // eslint-disable-line eqeqeq
              const d = M.calcDepth(M.DP_INTERF);
              M.attachMovie('announce', 'announce', d);
              M.announce._x = M.docWidth / 2;
              M.announce._y = M.docHeight / 2;
              if (M.vs.selectedTrack == 6) { // Coupe d'or                   // eslint-disable-line eqeqeq
                M.announce.win.gotoAndStop(2);
                J.giveCup(M.vs.$ws, '$elitexl');
                M.vs.$ws = true;
                J.savePublic();
              } else { // Coupe d'argent
                M.announce.win.gotoAndStop(1);
                J.giveCup(M.vs.$wss, '$elite');
                M.vs.$wss = true;
                J.savePublic();
              }
              M.vs.finalPhase++;
            } else if (M.vs.useSpecials && M.vs.selectedTrack >= 6) {
              M.vs.finalPhase = 30;
            } else {
              M.skipToTrackPresent = true;
              J.gotoMenu();
            }
          } else {
            M.vs.finalPhase = 30;
          }
        }
        break;

      case 23:
        if (J.skipTest()) {
          J.playSoundBK('buttonOk');
          rm(M.announce);
          if (M.vs.selectedTrack == 4 && M.vs.$wss) {                          // eslint-disable-line eqeqeq
            M.skipToTrackPresent = true;
            J.gotoMenu();
          } else {
            M.vs.finalPhase = 30;
          }
        }
        break;

      // *** GAME OVER
      case 30:
        if (!J.skipTest()) {
          const d = M.calcDepth(M.DP_INTERF);
          M.attachMovie('gameOver', 'gameOver', d);
          M.gameOver._x = M.docWidth / 2;
          M.gameOver._y = M.docHeight / 2;
          rm(M.finalScrolls);
          J.playSoundBK('gameOverSound');
          M.vs.finalPhase++;
        }
        break;

      case 31:
        if (J.skipTest()) {
          J.playSoundBK('buttonOk');
          rm(M.gameOver);
          M.skipToTrackPresent = false;
          J.gotoMenu();
        }
        break;

      // *** SAVESCORE OU ENDGAME
      case 40:
        J.attachNetworkPop();
        gdebug('saving score...');
        if (M.vs.giveUp || M.vs.useSpecials) {
          client().endGame();
          client().fl_localScore = true;
        } else {
          const miscData = [M.race.carName, M.race.rank.perfectsRank, M.race.rank.posRank];
          // Patch : score invalide
          if (M.race.raceTime == 0 || M.race.raceTime == null || Number.isNaN(M.race.raceTime)) {   // eslint-disable-line eqeqeq
            const msg = 'Invalid score, time=' + M.race.raceTime + ' object=' + J.traceObject(M.race);
            J.report(msg);
            J.fatal('Défaillance du chronomètre', msg);
            break;
          }
          client().saveScore(M.race.raceTime, miscData);
        }
        M.vs.finalPhase++;
        break;

      case 41:
        if (client().fl_success) {
          J.detachNetworkPop();
          M.vs.finalPhase = 0;
        }
        break;

      // *** CLASSEMENT SERVEUR
      case 50:
        if (!J.skipTest()) {
          const d = M.calcDepth(M.DP_INTERF);
          const ranking = client().ranking || {};
          M.attachMovie('announce', 'announce', d);
          M.announce._x = M.docWidth / 2;
          M.announce._y = M.docHeight / 2;
          M.announce.pos_txt = ranking.bestScorePos;
          M.announce.raceTime_txt = J.timeToString(M.race.raceTime);

          const ecart = ranking.oldPos - ranking.bestScorePos;
          if (ecart != 0) {                                                   // eslint-disable-line eqeqeq
            M.announce.win.gotoAndStop(7);
            M.announce.details = '';
            if (ecart == 1) M.announce.details = 'Vous avez progressé de 1 place';   // eslint-disable-line eqeqeq
            else if (ranking.oldPos != 0) M.announce.details = 'Vous avez progressé de ' + ecart + ' places !';   // eslint-disable-line eqeqeq
          } else {
            M.announce.win.gotoAndStop(8);
          }
          M.vs.finalPhase++;
        }
        break;

      case 51:
        if (J.skipTest()) {
          J.playSoundBK('buttonOk');
          rm(M.announce);
          M.vs.finalPhase = 3;
        }
        break;

      // *** DUEL
      case 60:
        if (!J.skipTest()) {
          const d = M.calcDepth(M.DP_INTERF);
          M.attachMovie('announce', 'announce', d);
          M.announce._x = M.docWidth / 2;
          M.announce._y = M.docHeight / 2;
          M.announce.win.gotoAndStop(9);
          if (M.announce.win.team) M.announce.win.team.gotoAndStop(M.vs.selectedAdv + 1);
          if (!M.vs.useSpecials) {
            J.giveItem('$logo0' + (M.vs.selectedAdv + 1));
            M.availableCars[M.vs.selectedAdv] = true;
          }
          J.savePublic();
          rm(M.finalScrolls);
          M.vs.finalPhase++;
        }
        break;

      case 61:
        if (J.skipTest()) {
          J.playSoundBK('buttonOk');
          rm(M.announce);
          M.skipToTrackPresent = false;
          J.gotoMenu();
        }
        break;

      default: break;
    }
  };

  // ANIM DES CONFETTIS
  J.moveConfettis = function () {
    for (let i = 0; i < M.fx.length; i++) {
      const mc = M.fx[i];
      if (mc.isConfetti) {
        mc.cpt += 0.05 * G.gtmod;
        mc._x = mc.baseX + Math.cos(mc.cpt) * mc.margeX;
        mc._y += mc.dy * G.gtmod;
        if (mc._y > 370) {
          mc.removeMovieClip();
          M.fx.splice(i, 1);
          if (!M.killConfettis) J.spawnConfetti();
        }
      }
    }
  };

  // INIT DES CONFETTIS
  J.spawnConfetti = function () {
    const d = M.calcDepth(M.DP_FXTOP);
    M.attachMovie('confetti', 'confetti_' + d, d);
    const mc = M['confetti_' + d];
    mc._x = random(300) + 20;
    mc._y = -random(150);
    mc._rotation = random(360);
    mc.dy = random(40) / 10 + 2;
    mc.cpt = random(Math.PI * 100) / 100;
    mc.baseX = mc._x;
    mc.margeX = random(50);
    mc.anim.gotoAndPlay(random(20) + 1);
    mc.isConfetti = true;
    M.fx.push(mc);
  };

  J.clearConfettis = function () {
    for (let i = M.fx.length - 1; i >= 0; i--) {
      if (M.fx[i].isConfetti) {
        M.fx[i].removeMovieClip();
        M.fx.splice(i, 1);
      }
    }
  };

  // DÉTERMINE SI LA PARTIE EST TERMINÉE
  J.gameEnded = function () {
    let ended = false;
    switch (M.vs.gameMode) {
      case M.FRUTICUP:
        if (M.vs.giveUp
            || (M.vs.selectedTrack == 3 && !M.vs.$wss)                       // eslint-disable-line eqeqeq
            || (M.vs.selectedTrack == 3 && M.tournament.podium[0] != 0)      // eslint-disable-line eqeqeq
            || (M.vs.selectedTrack == 5)) ended = true;                       // eslint-disable-line eqeqeq
        break;
      case M.ARCADE: case M.TRAINING: case M.DUEL: case M.TIMETRIAL: case M.KIWIRUN: case M.TUTORIAL:
        ended = true;
        break;
      case M.SURVIVOR:
        if (M.vs.giveUp || (M.tournament.vs.lives <= 0) || (M.vs.selectedTrack == 5 && M.classement == 1)) ended = true;   // eslint-disable-line eqeqeq
        break;
      default:
        ended = true;
        break;
    }
    return ended;
  };

  // RETOUR AU MENU
  J.gotoMenu = function () {
    M.vs.finalPhase = -1;
    if (M.vs.gameMode == M.TUTORIAL || client().isWhite()) M.vs.mainPhase = 0;   // eslint-disable-line eqeqeq
    else client().closeService();
  };

  // INIT DE LA PHASE FINALE
  J.initFinal = function () {
    if (M.musicON) {
      J.stopMusic(M.musicGame);
      J.startMusic(M.musicMenu);
    }

    // Classement
    if (M.vs.giveUp) {
      M.classement = 4;
    } else {
      for (M.i = 0; M.i < M.orderFinal.length; M.i++) {
        if (M.orderFinal[M.i] == 0) M.classement = M.i + 1;                   // eslint-disable-line eqeqeq
      }
    }
    M.race.rank = J.getRank();

    // Anim des scrolls
    M.d = M.calcDepth(M.DP_INTERF);
    M.attachMovie('finalScrolls', 'finalScrolls', M.d);
    M.finalScrolls._x = M.docWidth / 2;
    M.finalScrolls._y = M.docHeight / 2;

    M.killConfettis = false;
    J.initGrid();
    J.setDetailLevel(M.qualitySetting);

    // Envoi des données au serveur si la partie est finie
    J.savePublic();
    // …et le fantôme, s'il y a mieux qu'avant sur ce circuit.
    J.sauverFantome();
    if (J.gameEnded() && M.vs.gameMode != M.TUTORIAL) M.vs.finalPhase = 40;  // eslint-disable-line eqeqeq
    else M.vs.finalPhase = 0;
  };
};

})(typeof window !== 'undefined' ? window : globalThis);
