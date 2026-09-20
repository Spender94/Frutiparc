/*
 * Burning Kiwi — le MOTEUR : la traduction, fonction par fonction, de
 * Games/burningKiwi/inc/code.as (le scrolling, les angles, les chocs entre
 * voitures, les checkpoints, le classement, le chrono, la fruticard, les
 * modes, le fantôme, le départ), mainGame.as (la boucle de course et la
 * PHYSIQUE de la voiture du joueur), IA.as (les trois autres), gameMovies.as
 * (les clips : circuit, voitures, fumées, panneau, popups), sounds.as (les
 * musiques), preload.as (les circuits et les musiques chargés à la demande)
 * et main.as (les phases : menu, course, fin, chargement).
 *
 * TOUT VIT SUR LE CLIP PRINCIPAL. Le fichier est un scénario : ses fonctions
 * sont définies sur le clip « main » (sprite 637), ses variables sont les
 * propriétés de ce clip — `cars`, `track`, `carPJ`, `panelMC`, `hitBorder`,
 * `preSinA`… —, et une variable qu'aucun `var` ne déclare y SURVIT d'une
 * fonction à l'autre et d'une image à l'autre. Le portage écrit donc `M.x`
 * pour chacune : c'est ce qui fait que moveIA(), appelée au milieu de
 * manageGame() avant que preSinA ne soit recalculé, dessine sa fumée de
 * dérapage avec le sinus de l'image PRÉCÉDENTE, comme dans le fichier. Seul
 * gtmod est global (J.G.gtmod — voir biblio.js).
 *
 * Ce que l'AVM1 faisait en silence, on le garde et on le dit : un
 * removeMovieClip sur un clip absent ne fait rien (J.rm) ; `startAnim._x ==
 * undefined` teste si le clip existe (un clip retiré n'a plus de _x — ici,
 * plus de parent : J.vif) ; `mc.nitroAgg = 0.95` du Duel écrit sur le
 * DERNIER décor de premier plan attaché, pas sur la voiture, qui garde ses
 * 0,90 puis en perd la moitié ; `id` dans initGame n'est jamais posé, la
 * nuit n'est donc jamais doublée ; vs.vsInit() n'existe pas.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.BkiwiJeu = racine.BkiwiJeu || {};
const G = J.G;
const Key = K.Key;
const random = J.random;
const rm = J.rm;
// Un clip encore posé quelque part (un clip retiré n'a plus de _x en AVM1).
const vif = (mc) => !!(mc && mc._parent);
J.vif = vif;

J.installerMoteur = function (M) {
  const client = () => M.client;
  const getTimer = K.getTimer;
  const gdebug = J.gdebug, warning = J.warning, error = J.error;

  // ═══════════════════════════ code.as ═══════════════════════════

  // SCROLLING MANAGER
  J.scrolling = function (mc) {
    const side = M.docWidth;
    M.halfSide = M.docWidth / 2;
    M.track._x = 0.4 * M.track._x + 0.6 * (-mc.x + M.halfSide);
    M.track._y = 0.4 * M.track._y + 0.6 * (-mc.y + M.halfSide);
    if (M.track._x > 0) M.track._x = 0;
    if (M.track._y > 0) M.track._y = 0;
    if (M.track._x < -M.track._width + side) M.track._x = -M.track._width + side;
    if (M.track._y < -M.track._height + side) M.track._y = -M.track._height + side;
  };

  // CORRECTION D'ANGLES
  J.getAngle = function (ang) {
    let retour = ang;
    if (retour >= 180) retour -= 360;
    if (retour <= -180) retour += 360;
    return retour;
  };
  const getAngle = J.getAngle;

  // RENVOIE LES COORDONNEES D'UN CHECKPOINT (pour l'IA, avec sa maladresse)
  J.getPosCP = function (id, skill) {
    const cp = M.CP[M.track.id][id];
    M.x = cp.x;
    M.y = cp.y;
    M.distance = random(cp.dist) * (random(2) * 2 - 1);
    M.distance *= 1 - skill;
    M.angRad = (Math.PI / 180) * getAngle(cp.ang + 90);
    M.dx = Math.cos(M.angRad) * M.distance;
    M.dy = Math.sin(M.angRad) * M.distance;
    M.pt = { x: M.x + M.dx, y: M.y + M.dy };
    return M.pt;
  };

  // POIDS DES PNEUS DE mcA EN COLLISION AVEC mcB
  J.testHitCar = function (mcA, mcB) {
    let poids = 0;
    let oldAngA, oldSpeed, oldSpeedA;
    if (M.specials[3].state) { // Cheat GHOST
      oldSpeed = mcB.speed;
      oldSpeedA = mcB.speedA;
      oldAngA = mcB.angA;
    }
    M.tolerance = 17;
    if (!M.EDITORMODE && !mcA.finished && !mcB.finished
        && !mcA.vs.immuneHit && !mcB.vs.immuneHit
        && Math.abs(mcA._x - mcB._x) <= M.tolerance
        && Math.abs(mcA._y - mcB._y) <= M.tolerance) {
      M.pt = { x: mcA.tire1._x, y: mcA.tire1._y };
      mcA.localToGlobal(M.pt);
      if (mcB.hitTest(M.pt.x, M.pt.y, true)) poids += 1;
      M.pt = { x: mcA.tire2._x, y: mcA.tire2._y };
      mcA.localToGlobal(M.pt);
      if (mcB.hitTest(M.pt.x, M.pt.y, true)) poids += 2;
      M.pt = { x: mcA.tire4._x, y: mcA.tire4._y };
      mcA.localToGlobal(M.pt);
      if (mcB.hitTest(M.pt.x, M.pt.y, true)) poids += 4;
      M.pt = { x: mcA.tire8._x, y: mcA.tire8._y };
      mcA.localToGlobal(M.pt);
      if (mcB.hitTest(M.pt.x, M.pt.y, true)) poids += 8;

      if (poids > 0) {
        // 1 arrière gauche, 2 arrière droit, 4 avant gauche, 8 avant droit
        mcA.panic = M.baseImmuneHit / 2;
        mcB.panic = M.baseImmuneHit / 2;

        // Avant de B touchant A
        if (poids < 4) {
          if (mcA.spawnImmune == 0) {                                        // eslint-disable-line eqeqeq
            mcA.spawnImmune = 15;
            mcA.vs.collisions++;
            mcB.vs.collisions++;
            if (M.gameQuality >= M.MEDIUM) {
              for (M.i = 0; M.i < mcA.speed * 0.7; M.i++) J.spawnHitCar(mcA._x, mcA._y, -mcA.dx, -mcA.dy);
            }
          }
          mcA.speed = mcA.speed * 0.9;
          if (mcB === M.carPJ) mcB.speed = -Math.abs(mcB.speed);
          else mcB.speedA = -Math.abs(mcB.speed * 0.9);
          mcA.preImmune = 5;
        }

        // Avant de A touchant B
        if (poids >= 4) {
          if (mcA.spawnImmune == 0 && M.gameQuality >= M.MEDIUM) {           // eslint-disable-line eqeqeq
            mcA.spawnImmune = 15;
            mcA.vs.collisions++;
            mcB.vs.collisions++;
            for (M.i = 0; M.i < mcA.speed * 0.7; M.i++) J.spawnHitCar(mcA._x, mcA._y, mcA.dx, mcA.dy);
          }
          if (mcA === M.carPJ) mcA.speed = -Math.abs(mcA.speed);
          else mcA.speedA = -Math.abs(mcA.speed * 0.9);
          mcB.speed = mcB.speed * 0.9;
          mcB.preImmune = 5;
        }

        if (poids == 4) mcA._rotation += random(40) + 10;                    // eslint-disable-line eqeqeq
        if (poids == 8) mcA._rotation -= random(40) + 10;                    // eslint-disable-line eqeqeq
        if (poids == 1) mcA._rotation -= random(30) + 10;                    // eslint-disable-line eqeqeq
        if (poids == 2) mcA._rotation += random(30) + 10;                    // eslint-disable-line eqeqeq
        // Touché sur l'aile gauche
        if (poids == 5) {                                                    // eslint-disable-line eqeqeq
          mcB.speed = mcA.speed;
          mcB.speedA = mcA.speedA;
          mcA.angA = getAngle(mcA._rotation + random(40) + 50);
        }
        // Touché sur l'aile droite
        if (poids == 10) {                                                   // eslint-disable-line eqeqeq
          mcB.speed = mcA.speed;
          mcB.speedA = mcA.speedA;
          mcA.angA = getAngle(mcA._rotation - (random(40) + 50));
        }
      }

      if (M.specials[3].state) { // Cheat GHOST
        mcB.speed = oldSpeed;
        mcB.speedA = oldSpeedA;
        mcB.angA = oldAngA;
        mcB.vs.collisions--;
      }
    }
  };

  // GESTION DES CHECKPOINTS POUR UNE VOITURE
  J.testCheckPoints = function (idCar) {
    const car = M.cars[idCar];
    const CPt = M.CP[M.track.id];

    // Si le prochain checkpoint est le 0, on vérifie si on passe sur la grille de départ
    if (car.didAllCP) {
      M.pt = { x: car.x, y: car.y };
      M.track.localToGlobal(M.pt);
      if (M.track.skin.sub.startZone.hitTest(M.pt.x, M.pt.y, true)) {
        // Grille de départ franchie
        car.didAllCP = false;
        car.totalCP++;
        if (idCar == 0 || !M.specials[2].state) {                            // eslint-disable-line eqeqeq
          if (!M.EDITORMODE) car.vs.laps++;
        }
        // Course terminée
        if (car.vs.laps >= M.track.stats.totalLaps) {
          car.finished = true;
          J.stopBoostAnim(car);
          if (idCar == 0) M.timerEnd = M.delaiFin;                            // eslint-disable-line eqeqeq
          M.orderFinal.push(idCar);
        }

        M.temps = getTimer() - car.timerLap;
        car.vs.bestLap = Math.min(car.vs.bestLap, M.temps);
        // Temps au tour battu
        let best = false;
        if (!M.vs.useSpecials) {
          if (M.vs.gameMode == M.TIMETRIAL && idCar == 0 && car.vs.bestLap < M.trackStats[M.vs.selectedTrack].$fcLap) {   // eslint-disable-line eqeqeq
            M.trackStats[M.vs.selectedTrack].$fcLap = car.vs.bestLap;
            M.trackStats[M.vs.selectedTrack].$lapCar = M.vs.selectedCar;
            best = true;
          }
        }

        // Pop up de temps au tour
        if (idCar == M.trackedCar && !car.finished) J.attachLap(car.vs.laps);   // eslint-disable-line eqeqeq

        // Perfect
        let perfect = false;
        if (idCar == 0 && car.vs.offRoad == 0 && car.vs.collisions == 0) {    // eslint-disable-line eqeqeq
          perfect = true;
          car.vs.perfects++;
          J.attachPerfect();
        }

        // Indicateur permanent de temps au tour — en haut à gauche, un tour
        // par ligne, avec l'écart au tour précédent.
        //
        // Le GHOSTRUN s'ajoute ici à la liste du fichier. Le bouton n'ayant
        // jamais été posé dans le SWF (menu.as, bloc commenté), le mode n'a
        // jamais figuré dans aucune de ces listes — mais c'est une course
        // contre le chrono comme le contre-la-montre, et courir sans voir ses
        // temps au tour n'a pas de sens : on ne sait pas où l'on perd.
        if (idCar == 0 && (M.vs.gameMode == M.TIMETRIAL || M.vs.gameMode == M.ARCADE   // eslint-disable-line eqeqeq
            || M.vs.gameMode == M.TRAINING || M.vs.gameMode == M.GHOSTRUN)) {          // eslint-disable-line eqeqeq
          J.attachTimeLine(car.vs.laps - 1, M.temps, perfect, best, false, car.previousLapTime);
        }
        car.previousLapTime = M.temps;

        // Update des données de jeu pour cette voiture
        car.vs.totalTime += M.temps;
        car.vs.collisionsTotal += car.vs.collisions;
        car.vs.collisions = 0;
        car.vs.offRoadTotal += car.vs.offRoad;
        car.vs.offRoad = 0;
        car.timerLap = getTimer();

        // Mode ghost
        //
        // LE SEUL ENDROIT OÙ L'ON S'ÉCARTE DU FICHIER, ET IL LE FAUT.
        // D'origine, cette ligne comparait le temps CUMULÉ DEPUIS LE DÉPART
        // au temps d'une COURSE ENTIÈRE, à chaque fin de tour :
        //
        //     if ( ghost.raceTime < previousGhost.raceTime || previousGhost == undefined )
        //       previousGhost = ghost ;
        //
        // Au premier tour, le cumul d'un tour est forcément plus petit qu'une
        // course de trois : le fantôme qu'on affrontait était donc remplacé
        // par l'enregistrement EN COURS. Le lecteur se mettait alors à relire
        // le tableau qu'il était en train d'écrire, au même indice : la
        // voiture fantôme collait à la nôtre et le mode ne voulait plus rien
        // dire passé le premier tour. Le bouton n'ayant jamais été posé dans
        // le fichier (menu.as, bloc commenté), personne n'a vu ce défaut, et
        // il n'y a donc aucune habitude de joueur à respecter ici.
        //
        // On garde donc le fantôme chargé pour TOUTE la course, et le
        // remplacement se décide à l'arrivée, sur les temps complets
        // (J.sauverFantome).
        if (M.vs.gameMode == M.GHOSTRUN) {                                    // eslint-disable-line eqeqeq
          M.ghost.raceTime = car.vs.totalTime;
        }

        // Temps à la course battu
        if (!M.vs.useSpecials) {
          if (M.vs.gameMode == M.TIMETRIAL && idCar == 0 && car.finished && M.trackStats[M.vs.selectedTrack].$fcTotal > car.vs.totalTime) {   // eslint-disable-line eqeqeq
            J.attachTimeLine(car.vs.laps + 1, 0, false, false, true);
            M.trackStats[M.vs.selectedTrack].$fcTotal = car.vs.totalTime;
            M.trackStats[M.vs.selectedTrack].$totalCar = M.vs.selectedCar;
          }
        }
      }
    }

    // Si on est proche du current checkpoint, on passe au suivant
    if (idCar == 0) M.distance = M.distanceCP;                                // eslint-disable-line eqeqeq
    else M.distance = M.distanceCPIA * Math.max(1, G.gtmod * 0.5);

    // Multiplicateur pour certains checkpoints (cas des routes multiples)
    if (CPt[car.currentCP] && CPt[car.currentCP].distanceCheckFactor) M.distance *= CPt[car.currentCP].distanceCheckFactor;

    // Vérifie si le CP est franchi
    if (car.currentCP == -1                                                   // eslint-disable-line eqeqeq
        || (Math.abs(car.x - car.nextX) <= M.distance / 2 && Math.abs(car.y - car.nextY) <= M.distance / 2)) {
      car.lastCP = car.currentCP;
      car.currentCP++;
      car.totalCP++;

      if (car.currentCP >= CPt.length) {
        car.currentCP = 0;
        car.didAllCP = true;
      }

      if (idCar == 0) {                                                       // eslint-disable-line eqeqeq
        car.nextX = CPt[car.currentCP].x;
        car.nextY = CPt[car.currentCP].y;
      } else {
        M.pt = J.getPosCP(car.currentCP, car.skill);
        car.nextX = M.pt.x;
        car.nextY = M.pt.y;
        car.statRotTemp = car.statRot;
      }
    }
  };

  // Init des voitures au départ
  J.resetGame = function () {
    for (let i = 0; i < M.cars.length; i++) {
      M.mc = M.cars[i];
      M.mc.finished = false;
      M.mc.timerLap = getTimer();
      if (!M.specials[2].state) { // Cheat DRONE
        M.mc.totalCP = 0;
        M.mc.currentCP = -1;
      }
      M.mc.vs.laps = 0;
      M.mc.derapage = 0;
    }
    M.orderFinal = [];
  };

  // CLASSE LES VOITURES DANS LA TABLE
  J.getOrder = function (trackedId) {
    let temp;
    let CPprevX, CPprevY, CPX, CPY, distCar, distCP, referenceCP, rapport;
    const pos = [];
    const CPt = M.CP[M.track.id];
    const cpDe = (n) => CPt[n] || {};           // CP[…][-1] : undefined.x, comme en AVM1

    for (M.i = 0; M.i < M.cars.length; M.i++) {
      pos[M.i] = M.i;
      const car = M.cars[M.i];

      // Détermine l'indice du dernier checkpoint réellement franchi
      CPprevX = cpDe(car.currentCP - 1).x;
      CPprevY = cpDe(car.currentCP - 1).y;
      CPX = cpDe(car.currentCP).x;
      CPY = cpDe(car.currentCP).y;
      distCar = Math.sqrt((car.x - CPX) * (car.x - CPX) + (car.y - CPY) * (car.y - CPY));
      distCP = Math.sqrt((CPprevX - CPX) * (CPprevX - CPX) + (CPprevY - CPY) * (CPprevY - CPY));

      car.posCounter = car.totalCP - 1;
      referenceCP = car.currentCP;
      if (distCP < distCar) {
        car.posCounter--;
        referenceCP--;
      }

      // Distance entre les checkpoints qui encadrent cette voiture
      if (cpDe(referenceCP - 1).x === undefined) {
        CPprevX = CPt[CPt.length - 1].x;
        CPprevY = CPt[CPt.length - 1].y;
      } else {
        CPprevX = CPt[referenceCP - 1].x;
        CPprevY = CPt[referenceCP - 1].y;
      }
      CPX = cpDe(referenceCP).x;
      CPY = cpDe(referenceCP).y;
      distCar = Math.sqrt((car.x - CPX) * (car.x - CPX) + (car.y - CPY) * (car.y - CPY));
      distCP = Math.sqrt((CPprevX - CPX) * (CPprevX - CPX) + (CPprevY - CPY) * (CPprevY - CPY));

      rapport = 1 - distCar / distCP;
      car.posCounter += rapport;
    }

    // Bubble-sort !
    for (M.j = 0; M.j < M.cars.length; M.j++) {
      for (M.i = M.cars.length - 1; M.i > M.j; M.i--) {
        if (M.cars[pos[M.i]].posCounter > M.cars[pos[M.i - 1]].posCounter) {
          temp = pos[M.i];
          pos[M.i] = pos[M.i - 1];
          pos[M.i - 1] = temp;
        }
      }
    }

    // Mise à jour des MCs
    for (M.i = 0; M.i < pos.length; M.i++) {
      M.mc = M.panelMC ? M.panelMC['jeton_' + (M.i + 1)] : undefined;
      if (!M.mc) continue;                        // sans panneau : panelMC.jeton_n n'existe pas
      if (pos[M.i] == trackedId) M.mc.gotoAndStop(3);                        // eslint-disable-line eqeqeq
      else M.mc.gotoAndStop(2);
    }

    M.orderList = pos;
  };

  // EFFACE LE CONTENU DU CHRONO DU PANEL
  J.hideChrono = function () {
    if (!M.panelMC) return;
    if (M.panelMC.chrono_txt != '') {                                         // eslint-disable-line eqeqeq
      M.panelMC.chrono_txt = '';
      M.panelMC.chronoMilli_txt = '';
    }
  };

  // MET À JOUR L'AFFICHAGE DU CHRONO DANS LE PANEL
  J.updateChrono = function (timerLap) {
    M.temps = getTimer() - timerLap;
    M.mins = Math.floor(M.temps / 60000);
    M.temps -= M.mins * 60000;
    M.secs = Math.floor(M.temps / 1000);
    M.temps -= M.secs * 1000;
    M.milli = M.temps;
    if (M.secs < 10) M.secs = '0' + M.secs;
    if (M.milli < 10) M.milli = '00' + M.milli;
    else if (M.milli < 100) M.milli = '0' + M.milli;
    if (!M.panelMC) return;
    M.panelMC.chrono_txt = M.mins + '"' + M.secs;
    M.panelMC.chronoMilli_txt = M.milli;
  };

  // RENVOIE UN TEMPS SOUS FORME DE CHAINE FORMATÉE
  J.timeToString = function (temps, minChar, secChar, milliChar) {
    if (minChar == null) minChar = "'";                                       // eslint-disable-line eqeqeq
    if (secChar == null) secChar = '"';                                       // eslint-disable-line eqeqeq
    if (milliChar == null) milliChar = '';                                    // eslint-disable-line eqeqeq
    let mins, secs, milli;
    mins = Math.floor(temps / 60000);
    temps -= mins * 60000;
    secs = Math.floor(temps / 1000);
    temps -= secs * 1000;
    milli = temps;
    if (secs < 10) secs = '0' + secs;
    if (milli < 10) milli = '00' + milli;
    else if (milli < 100) milli = '0' + milli;
    return '' + mins + minChar + secs + secChar + milli + milliChar;
  };

  // MET A JOUR L'OBJET STAT DE COURSE
  J.updateRace = function () {
    M.race = {};
    J.vsInit(M.race, 'race');
    M.race.trackName = M.tracks[M.vs.selectedTrack].title;
    M.race.totalLaps = M.tracks[M.vs.selectedTrack].totalLaps;
    M.race.carName = M.cars[0].carName;
    M.race.raceTime = M.cars[0].vs.totalTime;
    M.race.bestLap = M.cars[0].vs.bestLap;
    M.race.topSpeed = M.cars[0].vs.topSpeed;
    M.race.offRoadTotal = M.cars[0].vs.offRoadTotal;
    M.race.collisions = M.cars[0].vs.collisionsTotal;
    M.race.perfects = M.cars[0].vs.perfects;
    J.vsSecureAll(M.race);
  };

  // DÉTERMINE LE GRADE SELON LES RÉSULTATS
  J.getRank = function () {
    const rank = {};
    rank.perfectsRank = 6;
    if (M.vs.gameMode != M.KIWIRUN && !M.vs.giveUp) {                       // eslint-disable-line eqeqeq
      if (M.race.perfects == M.race.totalLaps) rank.perfectsRank = 5;         // eslint-disable-line eqeqeq
      else rank.perfectsRank = M.race.perfects + 1;
    }
    if (M.vs.gameMode != M.KIWIRUN && !M.vs.giveUp) rank.posRank = M.classement;   // eslint-disable-line eqeqeq
    else rank.posRank = 5;
    return rank;
  };

  // INITIALISE UN NOUVEAU TOURNOI
  J.initTournament = function () {
    M.tournament = {};
    M.tournament.cars = new Array(4);
    for (let i = 0; i < 4; i++) {
      M.tournament.cars[i] = {};
      M.tournament.cars[i].carName = M.cars[i].carName;
      M.tournament.cars[i].totalTime = 0;
      M.tournament.cars[i].totalPts = 0;
      M.tournament.cars[i].pos = 99;
    }
    M.tournament.vs = {};
    M.tournament.vs.lives = M.survivorLives;
  };

  // MET A JOUR LES INFOS DU TOURNOI
  J.updateTournament = function () {
    let i, j;

    // (DEBUG : forcePosition — jamais posé)
    if (M.forcePosition != null) {                                            // eslint-disable-line eqeqeq
      M.orderFinal = [0, 1, 2, 3];
      let swapA, swapB;
      for (i = 0; i < M.orderFinal.length; i++) {
        if (M.orderFinal[i] == 0) swapA = i;                                  // eslint-disable-line eqeqeq
        if (i == M.forcePosition) swapB = i;                                  // eslint-disable-line eqeqeq
      }
      const tmp = M.orderFinal[swapA];
      M.orderFinal[swapA] = M.orderFinal[swapB];
      M.orderFinal[swapB] = tmp;
      for (i = 0; i < M.cars.length; i++) M.cars[i].vs.totalTime = random(500);
    }
    delete M.forcePosition;

    // Certaines voitures n'ont pas franchi l'arrivée avant la fin de partie
    if (M.orderFinal.length < M.maxCars) {
      const missing = [];
      for (i = 0; i < M.maxCars; i++) {
        let found = false;
        for (j = 0; j < M.orderFinal.length; j++) if (M.orderFinal[j] == i) found = true;   // eslint-disable-line eqeqeq
        if (!found) missing.push(i);
      }
      while (missing.length > 0) {
        const id = random(missing.length);
        M.orderFinal.push(missing[id]);
        missing.splice(id, 1);
      }
    }

    for (i = 0; i < M.cars.length; i++) {
      let pos, pts;
      for (j = 0; j < M.orderFinal.length; j++) if (M.orderFinal[j] == i) pos = j + 1;   // eslint-disable-line eqeqeq
      switch (pos) {
        case 1: pts = 4; break;
        case 2: pts = 2; break;
        case 3: pts = 1; break;
        case 4: pts = 0; break;
        default: break;
      }
      M.tournament.cars[i].totalTime += M.cars[i].vs.totalTime;
      M.tournament.cars[i].raceTime = M.cars[i].vs.totalTime;
      M.tournament.cars[i].totalPts += pts;
      M.tournament.cars[i].racePts = pts;
      M.tournament.cars[i].pos = pos;
    }

    // Survivor : perte de vie
    if (M.vs.gameMode == M.SURVIVOR && M.tournament.cars[0].pos > 2) M.tournament.vs.lives--;   // eslint-disable-line eqeqeq

    // Classement de la course
    M.tournament.podiumRace = [];
    for (i = 0; i < M.tournament.cars.length; i++) M.tournament.podiumRace[i] = i;
    for (j = 0; j < M.tournament.podiumRace.length; j++) {
      for (i = M.tournament.podiumRace.length - 1; i > j; i--) {
        if (M.tournament.cars[M.tournament.podiumRace[i]].racePts > M.tournament.cars[M.tournament.podiumRace[i - 1]].racePts) {
          const tmp = M.tournament.podiumRace[i - 1];
          M.tournament.podiumRace[i - 1] = M.tournament.podiumRace[i];
          M.tournament.podiumRace[i] = tmp;
        }
      }
    }

    // Classement du tournoi
    M.tournament.podium = [];
    for (i = 0; i < M.tournament.cars.length; i++) M.tournament.podium[i] = i;
    for (j = 0; j < M.tournament.podium.length; j++) {
      for (i = M.tournament.podium.length - 1; i > j; i--) {
        if (M.tournament.cars[M.tournament.podium[i]].totalPts > M.tournament.cars[M.tournament.podium[i - 1]].totalPts) {
          const tmp = M.tournament.podium[i - 1];
          M.tournament.podium[i - 1] = M.tournament.podium[i];
          M.tournament.podium[i] = tmp;
        }
      }
    }
  };

  // EVENT : CLIC SUR LE MAIN
  J.eventMainRelease = function () { M.mainClicked = true; };

  // TESTE LES CONTROLES POUR PASSER À L'ECRAN SUIVANT
  J.skipTest = function () {
    if (M.onRelease === undefined) M.onRelease = J.eventMainRelease;
    const result = !!(M.mainClicked || Key.isDown(M.controls[4]) || Key.isDown(Key.SPACE) || Key.isDown(Key.ENTER) || Key.isDown(Key.ESCAPE));
    if (result) {
      delete M.onRelease;
      delete M.mainClicked;
    }
    return result;
  };

  // MET À JOUR L'ÉTAT DE PAUSE
  J.togglePause = function () {
    M.gamePaused = !M.gamePaused;
    rm(M.pauseBox);
    if (M.gamePaused) {
      const d = M.calcDepth(M.DP_MENU);
      M.attachMovie('pauseBox', 'pauseBox', d);
      M.pauseBox._x = M.docWidth / 2;
      M.pauseBox._y = 130;
      M.vs.pauseDuration = getTimer();
    } else {
      M.vs.pauseDuration = getTimer() - M.vs.pauseDuration;
      if (M.carPJ.offRoadTimer != null) M.carPJ.offRoadTimer += M.vs.pauseDuration;   // eslint-disable-line eqeqeq
      for (M.i = 0; M.i < M.cars.length; M.i++) {
        M.mc = M.cars[M.i];
        M.mc.timerLap += M.vs.pauseDuration;
      }
    }
  };

  // QUALITÉ GRAPHIQUE
  J.setDetailLevel = function (q) {
    M.gameQuality = Math.max(0, Math.min(M.HIGH, q));
    J.updateDetailLevel(q);
  };
  J.updateDetailLevel = function () { /* _quality : le canvas n'a qu'une qualité */ };
  // readFrutiCard appelle setLevelDetail — qui n'existe pas : rien (AVM1).
  J.setLevelDetail = function () {};

  // *** FRUTICARD
  J.initFrutiCard = function () {
    M.frutiSlots = [];
    M.frutiSlots[M.SLOT_PUBLIC] = {};
    M.frutiSlots[M.SLOT_PREFS] = {};
    M.frutiSlots[M.SLOT_MODES] = [];
  };

  // CRÉATION DU PROFIL PAR DÉFAUT
  J.initFrutiCardContent = function () {
    M.musicON = true;
    M.soundsON = true;
    if (M.USEFAKESERVER) { M.musicON = false; M.soundsON = false; }
    M.qualitySetting = M.AUTO;
    J.setDetailLevel(M.qualitySetting);
    M.panelON = true;

    M.vs.$ws = false;
    M.vs.$wss = false;
    M.vs.$wc = false;
    M.vs.$wcs = false;

    M.availableCars = [];
    M.availableCars[0] = false;
    M.availableCars[1] = false;
    M.availableCars[2] = true;
    M.availableCars[3] = true;
    M.availableCars[4] = false;

    M.trackStats = [];
    for (let i = 0; i < M.nbTracks; i++) {
      M.trackStats[i] = {};
      M.trackStats[i].$fcLap = Infinity;
      M.trackStats[i].$fcTotal = Infinity;
    }

    for (let i = 0; i < M.controls.length; i++) {
      if (M.controls[i] === undefined) M.controls[i] = M.defaultControls[i];
    }
  };

  // INITIALISE LE SLOT DES MODES
  J.initSlotModes = function () {
    M.frutiSlots[M.SLOT_MODES] = [];
    for (let i = 0; i < 9; i++) M.frutiSlots[M.SLOT_MODES][i] = false;
    client().saveSlot(M.SLOT_MODES, M.frutiSlots[M.SLOT_MODES]);
  };

  // CONVERSION DE CARD
  J.updateCard = function () {
    let ver = M.frutiSlots[M.SLOT_PREFS].$ver;
    if (M.frutiSlots[M.SLOT_PUBLIC].$ver == '1.2' && ver === undefined) ver = '1.2';   // eslint-disable-line eqeqeq
    switch (ver) {
      case undefined:
        break;
      case '1.2':
        M.frutiSlots[M.SLOT_PREFS].$ver = '1.3';
        // falls through
      case '1.3':
        M.frutiSlots[M.SLOT_PREFS].$ver = '1.4';
        // falls through
      case '1.4':
        M.frutiSlots[M.SLOT_PREFS].$ver = '1.5';
        J.initSlotModes();
        // falls through
      case '1.5':
        M.frutiSlots[M.SLOT_PREFS].$ver = '1.6';
        if (client().isWhite()) {
          if (M.frutiSlots[M.SLOT_PUBLIC].$wcs) J.giveItem('$fruticup');
          if (M.frutiSlots[M.SLOT_PUBLIC].$wc) J.giveItem('$fruticupxl');
          if (M.frutiSlots[M.SLOT_PUBLIC].$wss) J.giveItem('$elite');
          if (M.frutiSlots[M.SLOT_PUBLIC].$ws) J.giveItem('$elitexl');
          const ac = M.frutiSlots[M.SLOT_PUBLIC].$ac || [];
          if (ac[0]) J.giveItem('$logo01');
          if (ac[1]) J.giveItem('$logo02');
          if (ac[4]) J.giveItem('$logo05');
        }
        // falls through
      case '1.6':
      case '1.7':
        // « frutiSlots[SLOT_MODES][i] » : i n'est pas posé — la case undefined
        // d'un tableau vaut undefined, et les modes repartent de zéro.
        if (M.frutiSlots[M.SLOT_MODES][M.i] == null) J.initSlotModes();      // eslint-disable-line eqeqeq
        break;
      default: break;
    }
  };

  // LIT LES INFOS DE LA FRUTICARD
  J.readFrutiCard = function () {
    J.updateCard();

    // Préférences
    if (M.frutiSlots[M.SLOT_PREFS].$mus !== undefined) {
      M.musicON = M.frutiSlots[M.SLOT_PREFS].$mus;
      M.soundsON = M.frutiSlots[M.SLOT_PREFS].$snd;
      M.qualitySetting = M.frutiSlots[M.SLOT_PREFS].$det;
      J.setLevelDetail(M.qualitySetting);
      M.panelON = M.frutiSlots[M.SLOT_PREFS].$bar;
      M.controls = M.frutiSlots[M.SLOT_PREFS].$ctr;
    } else {
      M.frutiSlots[M.SLOT_PREFS] = {};
    }

    // Données publiques
    if (M.frutiSlots[M.SLOT_PUBLIC].$ws !== undefined) {
      delete M.frutiSlots[M.SLOT_PUBLIC].$tmpCard;
      M.vs.$ws = M.frutiSlots[M.SLOT_PUBLIC].$ws;
      M.vs.$wss = M.frutiSlots[M.SLOT_PUBLIC].$wss;
      M.vs.$wc = M.frutiSlots[M.SLOT_PUBLIC].$wc;
      M.vs.$wcs = M.frutiSlots[M.SLOT_PUBLIC].$wcs;
      M.availableCars = M.frutiSlots[M.SLOT_PUBLIC].$ac;
      M.trackStats = M.frutiSlots[M.SLOT_PUBLIC].$ts;
    } else {
      M.frutiSlots[M.SLOT_PUBLIC] = {};
      if (!client().isWhite()) M.frutiSlots[M.SLOT_PUBLIC].$tmpCard = true;
    }

    // Modes
    if (M.frutiSlots[M.SLOT_MODES].length === undefined) J.initSlotModes();

    // Patch 1.5+ : déblocage des modes fcard
    if (client().isWhite() && M.vs.$wcs) {
      if (!J.checkMode(M.DUEL)) J.unlockMode(M.DUEL);
      if (!J.checkMode(M.SURVIVOR)) J.unlockMode(M.SURVIVOR);
    }

    J.savePreferences();
    J.savePublic();
  };

  // ENVOIE LES PRÉFÉRENCES AU SERVEUR
  J.savePreferences = function () {
    M.frutiSlots[M.SLOT_PREFS].$ver = M.SLOTVERSION;
    M.frutiSlots[M.SLOT_PREFS].$mus = M.musicON;
    M.frutiSlots[M.SLOT_PREFS].$snd = M.soundsON;
    M.frutiSlots[M.SLOT_PREFS].$det = M.qualitySetting;
    M.frutiSlots[M.SLOT_PREFS].$bar = M.panelON;
    M.frutiSlots[M.SLOT_PREFS].$ctr = M.controls;
    client().saveSlot(M.SLOT_PREFS, M.frutiSlots[M.SLOT_PREFS]);
  };

  // ENVOIE LES DONNÉES DE JEU AU SERVEUR
  J.savePublic = function () {
    if (M.frutiSlots[M.SLOT_PUBLIC].$tmpCard) { warning('(savePublic) skipped (tmp card)'); return; }
    delete M.frutiSlots[M.SLOT_PUBLIC].$ver;
    M.frutiSlots[M.SLOT_PUBLIC].$ws = M.vs.$ws;
    M.frutiSlots[M.SLOT_PUBLIC].$wss = M.vs.$wss;
    M.frutiSlots[M.SLOT_PUBLIC].$wc = M.vs.$wc;
    M.frutiSlots[M.SLOT_PUBLIC].$wcs = M.vs.$wcs;
    M.frutiSlots[M.SLOT_PUBLIC].$ac = M.availableCars;
    M.frutiSlots[M.SLOT_PUBLIC].$ts = M.trackStats;
    client().saveSlot(M.SLOT_PUBLIC, M.frutiSlots[M.SLOT_PUBLIC]);
  };

  // *** MODES
  // TESTE LA DISPONIBILITÉ D'UN MODE
  J.checkMode = function (mode) {
    const c = client();
    if (c.isBlack() || c.isGray()) return (mode == M.ARCADE || mode == M.TUTORIAL);   // eslint-disable-line eqeqeq
    if (c.isRed()) return M.frutiSlots[M.SLOT_MODES][mode];
    if (c.isWhite()) {
      // D'époque, le disque blanc ouvrait les « essais » (TRAINING) et jamais
      // le Challenge. Ici la session est blanche pour tout le monde, et c'est
      // le quota de Fruits Défendus qui tranche entre les deux (plateforme.js,
      // Client.isRanked) : un FD restant — ou la course déjà accordée par
      // /do/fdclaim (gameRunning) —, c'est le Challenge classé ; sinon les
      // essais libres sur la course du jour.
      if (mode == M.ARCADE) return !!(c.gameRunning || (typeof c.isRanked === 'function' && c.isRanked()));   // eslint-disable-line eqeqeq
      if (mode == M.TRAINING) return !(typeof c.isRanked === 'function' && c.isRanked());   // eslint-disable-line eqeqeq
      // Le GHOSTRUN rejoint les modes ouverts. D'époque il dépendait du slot
      // des modes, que seul le serveur de 2005 pouvait poser — et son bouton
      // était commenté : aucun joueur n'a jamais pu y entrer. Rien ne le
      // rationne (il ne se classe pas contre les autres), il s'ouvre donc
      // comme le contre-la-montre.
      if (mode == M.TUTORIAL || mode == M.FRUTICUP || mode == M.TIMETRIAL || mode == M.GHOSTRUN) return true;   // eslint-disable-line eqeqeq
      return M.frutiSlots[M.SLOT_MODES][mode];
    }
    return undefined;
  };

  // DÉBLOQUE UN MODE
  J.unlockMode = function (mode) {
    M.frutiSlots[M.SLOT_MODES][mode] = true;
    client().saveSlot(M.SLOT_MODES, M.frutiSlots[M.SLOT_MODES]);
  };

  // *** GHOST MODE
  J.ghostStore = function (g, usedNitro) { g.moves.push({ x: M.carPJ.x, y: M.carPJ.y, r: M.carPJ._rotation, n: usedNitro }); };
  J.ghostRead = function (g) {
    if (g.current >= g.moves.length) g.current = g.moves.length - 1;
    return g.moves[g.current++];
  };
  J.createGhost = function () { return { current: 0, moves: [], raceTime: Infinity }; };

  // GARDE LE FANTÔME DE LA COURSE QUI VIENT DE FINIR, S'IL EST MEILLEUR
  //
  // Appelée à l'arrivée (initFinal). Le serveur retranche à son tour : il ne
  // remplace la trace que si le temps la bat, donc deux onglets qui finissent
  // ensemble ne peuvent pas se voler la place. Une course abandonnée ou
  // trichée ne laisse pas de fantôme.
  J.sauverFantome = function () {
    if (M.vs.gameMode != M.GHOSTRUN) return;                                  // eslint-disable-line eqeqeq
    if (M.vs.giveUp || M.vs.useSpecials) return;
    const temps = Number(M.race && M.race.raceTime);
    if (!Number.isFinite(temps) || temps <= 0) return;
    if (!M.ghost || !M.ghost.moves || !M.ghost.moves.length) return;
    // Le fantôme affronté reste le meilleur tant que le nouveau ne le bat pas.
    if (M.previousGhost != null && Number.isFinite(M.fantomeTemps) && M.fantomeTemps <= temps) return;   // eslint-disable-line eqeqeq
    M.previousGhost = M.ghost;
    M.fantomeTemps = temps;
    M.fantomeCar = M.vs.selectedCar;
    M.fantomeTrack = M.vs.selectedTrack;
    client().enregistrerFantome(M.vs.selectedTrack, M.vs.selectedCar, temps, M.ghost);
  };

  // BOUCLE D'ANIM DE LA PHASE DE DÉPART
  J.mainStart = function () {
    if (M.gameQuality >= M.HIGH) J.animGrid();
    if (!vif(M.startAnim)) {
      // Attachement
      const d = M.calcDepth(M.DP_BG);
      if (M.gameQuality >= M.HIGH) J.initGrid();
      else {
        M.attachMovie('blackBg', 'blackBg', d);
        M.blackBg._width = M.docWidth;
        M.blackBg._height = M.docHeight;
        M.blackBg.stop();
      }
      // Anim de décompte
      M.attachMovie('startAnim', 'startAnim', M.calcDepth(M.DP_INTERF));
      M.startAnim._x = M.docWidth / 2;
      M.startAnim._y = M.docHeight / 2;
      M.startAnim.sub.frame = 0;
      M.startAnim.stop();
      M.startAnim.sub.stop();
      M.startAnim.sub.sub.gotoAndStop(1);
      M.track.setMask(M.startAnim);
      M.fakeSpeed = 0;
      M.fakeSpeedCounter = 0;
    } else {
      // Affichage de la fausse accélération
      M.fakeSpeedCounter = 0.8 * M.fakeSpeedCounter + 0.2 * M.fakeSpeed;
      if (M.panelMC) M.panelMC.maskSpeedBar._width = (M.fakeSpeedCounter * 95) / M.carPJ.statMaxSpeed;

      // Avancement de l'anim
      M.startAnim.sub.frame += G.gtmod;
      while (M.startAnim.sub.frame >= 1) {
        M.startAnim.sub.nextFrame();
        M.startAnim.sub.frame--;
      }
      // Chiffre en cours terminé
      if (M.startAnim.sub._currentframe >= M.startAnim.sub._totalframes) {
        // Décompte terminé, départ !
        if (M.startAnim._currentframe == 2) {                                 // eslint-disable-line eqeqeq
          M.track.setMask(null);
          rm(M.startAnim);
          rm(M.blackBg);
          rm(M.grille);
          M.gamePaused = false;
          M.starting = false;
          J.resetGame();
          M.vs.startBoost = 1 - Math.abs(M.optimalStartSpeed - M.fakeSpeed) / M.superStartMaxGap;
          if (M.vs.startBoost > 1 || M.vs.startBoost < 0) M.vs.startBoost = 0;
        }
        // Bascule sur le GO. Le fichier enchaîne ces lignes même quand le
        // décompte vient de retirer startAnim (et blackBg) : sur un clip
        // retiré, tout y est sans effet en AS2 — on s'arrête là.
        if (vif(M.startAnim)) {
          if (M.startAnim.sub.sub._currentframe == M.startAnim.sub.sub._totalframes) {   // eslint-disable-line eqeqeq
            // « startAnim._xscale == 120 » : une comparaison, sans effet (le fichier)
            M.startAnim.gotoAndStop(2);
            M.startAnim.sub.frame = 0;
            if (M.vs.selectedTrack != 3) { if (vif(M.blackBg)) M.blackBg.gotoAndStop(2); }   // eslint-disable-line eqeqeq
          } else {
            M.startAnim._xscale += 60;
          }
          M.startAnim._yscale = M.startAnim._xscale;
          M.startAnim.sub.sub.nextFrame();
          M.startAnim.sub.gotoAndStop(1);
        }
      }
    }

    // Super départ
    if (M.starting) {
      if (Key.isDown(M.controls[0])) {
        M.fakeSpeed += G.gtmod * (((M.carPJ.statMaxSpeed - M.fakeSpeed) / (M.carPJ.statMaxSpeed + 15)) * M.carPJ.statAccel);
        M.fakeSpeed *= Math.pow(M.roadFriction, G.gtmod);
      } else {
        M.fakeSpeed *= Math.pow(M.carPJ.statBrake, G.gtmod);
      }
    }
  };

  // DONNE UNE COUPE SUR FRUTIPARC
  J.giveCup = function (flag, name) {
    if (M.vs.useSpecials) return;
    if (!flag) J.giveItem(name);
    J.giveItem('$car0' + (M.vs.selectedCar + 1));
  };

  // GIVEITEM
  J.giveItem = function (name) {
    if (M.vs.useSpecials) return;
    gdebug('(giveItem) ' + name);
    client().giveItem(name);
  };

  // ERREUR CRITIQUE
  /*
   * L'ERREUR FATALE, ET LA PORTE DE SORTIE.
   *
   * `M.stop()` arrête le clip principal : sa boucle de deux images ne rappelle
   * plus `J.main()`, donc plus rien ne tourne — ni menu, ni touches, ni clic.
   * C'est ce que fait le fichier, et c'était tenable en 2004 : la plateforme
   * des Fruits Défendus, autour du jeu, montrait l'erreur et refermait le
   * disque. Ici il n'y a pas de plateforme autour : le joueur se retrouvait
   * devant une image morte, sans un mot, et n'avait plus qu'à éjecter le FD
   * pour relancer une partie — ce que les joueurs décrivent.
   *
   * On garde donc l'arrêt (le jeu est dans un état où il ne faut plus rien
   * écrire), mais on DIT ce qui s'est passé et on rouvre le jeu d'un clic.
   */
  J.fatal = function (msgUser, msg) {
    error('(FATAL ) ' + msgUser);
    error('(FATAL ) ' + msg);
    client().logError(msgUser + '\n----------\nInformations complémentaires:\n' + msg + ' (' + M.buildVersion + '/' + M.buildDate + ') ');
    M.stop();
    M.fatalError = msgUser;
    if (typeof J.montrerPanneEtRelancer === 'function') J.montrerPanneEtRelancer(msgUser);
  };
  J.report = function (msg) {
    warning('(REPORT) ' + msg);
    client().logError(msg + ' (' + M.buildVersion + '/' + M.buildDate + ')');
  };
  J.traceObject = function (obj) {
    let msg = '';
    for (const item in obj) msg += '  . ' + item + ' = ' + obj[item] + '\n';
    return msg;
  };

  // ═══════════════════════════ mainGame.as ═══════════════════════════

  // BOUCLE MAIN GAME
  J.mainGame = function () {
    // Mode AUTO de gestion de la qualité
    if (!M.gamePaused && M.qualitySetting == M.AUTO && M.gameQuality > M.LOW) {   // eslint-disable-line eqeqeq
      M.checkFPS -= G.gtmod;
      if (M.checkFPS <= 0) {
        if (M.FPS <= M.qualitySteps[M.gameQuality]) J.setDetailLevel(M.gameQuality - 1);
        M.checkFPS = M.baseCheckFPS;
      }
    }

    // Départ
    if (M.gamePaused && M.starting) J.mainStart();

    // Forçage de la pause par le serveur
    if (!M.gamePaused && client().forcePause == true) J.togglePause();       // eslint-disable-line eqeqeq

    // Fin de partie
    if (M.timerEnd > 0) {
      M.timerEnd -= G.gtmod;
      if (M.timerEnd <= 0) {
        if (M.vs.gameMode == M.FRUTICUP || M.vs.gameMode == M.SURVIVOR) J.updateTournament();   // eslint-disable-line eqeqeq
        J.updateRace();
        M.vs.mainPhase = 2;
      }
    }

    // Saisie des touches de jeu (pas les touches de contrôle du joueur)
    J.getControls();

    if (!M.gamePaused) {
      J.moveFx();
      J.manageGame();

      // Panneau d'affichage du jeu
      const suivi = M.cars[M.trackedCar];
      if (M.panelON && !M.starting) {
        // Gestion du classement
        if (!suivi.finished && M.vs.gameMode != M.TUTORIAL && M.vs.gameMode != M.TIMETRIAL && M.vs.gameMode != M.DUEL) {   // eslint-disable-line eqeqeq
          M.orderSkip += G.gtmod;
          if (M.orderSkip >= 3) {
            M.orderSkip = 0;
            J.getOrder(M.trackedCar);
            for (let i = 0; i < M.orderList.length; i++) {
              if (M.orderList[i] == 0) { M.panelMC.pos_txt.text = i + 1; break; }   // eslint-disable-line eqeqeq
            }
          }
        }
        suivi.vs.topSpeed = Math.max(suivi.vs.topSpeed, suivi.speed);
        suivi.speedCounter = 0.8 * suivi.speedCounter + 0.2 * suivi.realSpeed;
        M.panelMC.maskSpeedBar._width = (suivi.speedCounter * 95) / suivi.statMaxSpeed;
        if (suivi.speedCounter >= suivi.statMaxSpeed) M.panelMC.bar.play();
        else M.panelMC.bar.gotoAndStop(1);
      }
      // Affichage du chrono
      if (suivi.finished) J.hideChrono();
      else J.updateChrono(suivi.timerLap);
    }

    // Recalage du scrolling sur une voiture
    J.scrolling(M.cars[M.trackedCar]);

    // Kiwi-run
    if (M.vs.gameMode == M.KIWIRUN) { if (!M.gamePaused) J.manageKiwis(); }  // eslint-disable-line eqeqeq
  };

  // CODE DU JEU — la physique de la voiture du joueur
  J.manageGame = function () {
    const carPJ = M.carPJ;
    const track = M.track;

    if (M.vs.nitroFlag) carPJ.pct = 0.01;
    else carPJ.pct = 0.02;

    if (carPJ.preImmune > 0) {
      carPJ.preImmune -= G.gtmod;
      if (carPJ.preImmune <= 0) carPJ.vs.immuneHit = M.baseImmuneHit;
    }
    if (carPJ.vs.immuneHit > 0) {
      carPJ.vs.immuneHit -= G.gtmod;
      if (carPJ.vs.immuneHit <= 0) carPJ.vs.immuneHit = 0;
    }

    // Correction du bug de hittest foireux d'une frame sur l'autre
    if (!M.EDITORMODE) {
      M.pt = { x: carPJ.x, y: carPJ.y };
      track.localToGlobal(M.pt);
      if (track.skin.sub.outZone.hitTest(M.pt.x, M.pt.y, true) == true) {   // eslint-disable-line eqeqeq
        carPJ.x = carPJ.oldX;
        carPJ.y = carPJ.oldY;
      }
    }

    // (var previousSpeed — inutilisé : le son moteur est en commentaire dans le fichier)

    // ** BOOST DE NITRO
    if (!carPJ.finished) {
      if (M.vs.nitroFlag && (carPJ.nitroTimer > 0 || M.nitroStopped)) {
        carPJ.nitroTimer -= G.gtmod;
        if (M.vs.startBoost == 0) {                                           // eslint-disable-line eqeqeq
          const n = M.panelMC && M.panelMC['nitro_' + carPJ.vs.kiwis];
          if (n && n.nitro && n.nitro.liquid) n.nitro.liquid._y = 12 - (carPJ.nitroTimer * 19) / M.baseNitroTimer;
        }
        if (carPJ.nitroTimer <= 0 || M.nitroStopped) {
          J.stopBoostAnim(carPJ);
          carPJ.nitroTimer = 0;
          M.vs.nitroFlag = false;
          M.nitroStopped = false;
          M.accelBoost = 1;
          if (!M.specials[3].state) carPJ.vs.immuneHit = 0; // Cheat GHOST
          carPJ.currentMaxSpeed = carPJ.statMaxSpeed;
          if (M.vs.startBoost == 0) {                                         // eslint-disable-line eqeqeq
            const n = M.panelMC && M.panelMC['nitro_' + carPJ.vs.kiwis];
            if (n) n.gotoAndStop(3);
          }
          M.vs.startBoost = 0;
        }
      }

      if ((Key.isDown(M.controls[4]) && !M.vs.nitroFlag && !M.hitBorder && carPJ.vs.kiwis)
          || (!M.vs.nitroFlag && M.vs.startBoost > 0)) {
        // Coût du boost
        if (M.vs.startBoost == 0) {                                           // eslint-disable-line eqeqeq
          carPJ.vs.kiwis--;
          carPJ.usedKiwis++;
        } else {
          J.attachSuperStart();
          carPJ.vs.immuneHit = M.baseImmuneHit;
        }
        // Anim dans le panel
        if (M.vs.startBoost == 0) {                                           // eslint-disable-line eqeqeq
          const n = M.panelMC && M.panelMC['nitro_' + carPJ.vs.kiwis];
          if (n) n.gotoAndStop(2);
        }
        // Facteur modifiant le boost, pour le cas du super départ
        let factor = M.vs.startBoost / 2;
        if (factor == 0) factor = 1;                                          // eslint-disable-line eqeqeq
        // Application du boost
        M.vs.nitroFlag = true;
        J.startBoostAnim(carPJ);
        M.accelBoost = Math.pow(9 * factor, 1 / G.gtmod);
        carPJ.currentMaxSpeed = M.nitroMaxSpeed;
        if (M.specials[1].state) carPJ.currentMaxSpeed *= 1.5; // cheat BOOST
        M.nitroStopped = false;
        carPJ.nitroTimer = M.baseNitroTimer * factor;
      }

      // Calcul des pertes sur les rotations selon la vitesse
      M.rotationVitesseLente = Math.max(0, carPJ.statRot - (carPJ.speed * 5) * 0.7);
      if (M.vs.nitroFlag) {
        if (M.specials[1].state) M.rotationVitesseRapide = Math.max(0, carPJ.speed * 0.15); // Cheat BOOST
        else M.rotationVitesseRapide = Math.max(0, carPJ.speed * 0.3);
      } else {
        M.rotationVitesseRapide = Math.max(0, carPJ.speed * 0.52);
      }

      // ** ROTATIONS
      if (Key.isDown(M.controls[2])) {
        carPJ._rotation -= G.gtmod * (Math.max(0, carPJ.statRot - M.rotationVitesseRapide - M.rotationVitesseLente));
        carPJ.speed *= Math.pow(carPJ.statTurning, G.gtmod);
        carPJ.signLastRotation = -1;
      }
      if (Key.isDown(M.controls[3])) {
        carPJ._rotation += G.gtmod * (Math.max(0, carPJ.statRot - M.rotationVitesseRapide - M.rotationVitesseLente));
        carPJ.speed *= Math.pow(carPJ.statTurning, G.gtmod);
        carPJ.signLastRotation = 1;
      }

      // ** ACCÉLÉRATION
      if (Key.isDown(M.controls[0]) || M.debugAutoAccel || carPJ.nitroTimer > 0) {
        M.ecart = getAngle(carPJ._rotation - carPJ.accelAng);
        carPJ.accelAng = getAngle(carPJ.accelAng + G.gtmod * (carPJ.pct * M.ecart * 2));
        carPJ.speed += G.gtmod * (((carPJ.currentMaxSpeed - carPJ.speed) / (carPJ.currentMaxSpeed + 15)) * carPJ.statAccel * M.accelBoost);
        if (M.hitBorder == 0 && carPJ.speed <= carPJ.statMaxSpeed * 0.7) {   // eslint-disable-line eqeqeq
          if (M.gameQuality >= M.MEDIUM) J.spawnSmoke('smokeAccel', carPJ.x, carPJ.y, 0, 0, Math.max(10, 100 - carPJ.speed * 2), 6, true);
        }
      } else {
        if (carPJ.speed <= 0.05) carPJ.speed = 0;
        if (carPJ.speed > carPJ.currentMaxSpeed) carPJ.speed *= Math.pow(0.99, G.gtmod);
      }
    }

    // ** FREINAGE
    if (carPJ.finished || Key.isDown(M.controls[1])) {
      if (carPJ.finished && carPJ.skinId == 5) carPJ.speed *= 0.98; // KiwiX   // eslint-disable-line eqeqeq
      else carPJ.speed *= Math.pow(carPJ.statBrake, G.gtmod);
      if (carPJ.speed <= 0.4) carPJ.speed = 0;
    }

    // Dérapage en fin de course
    if (carPJ.finished) {
      if (carPJ.derapage == 0) {                                              // eslint-disable-line eqeqeq
        carPJ.targetRotation = carPJ._rotation + (90 + random(50)) * (random(2) * 2 - 1);
        carPJ.derapage = 1;
        carPJ.oldRotation = carPJ._rotation;
      }
      if (carPJ.derapage == 1) {                                              // eslint-disable-line eqeqeq
        carPJ._rotation += G.gtmod * ((carPJ.targetRotation - carPJ._rotation) / 20);
        if (Math.abs(carPJ.targetRotation - carPJ._rotation) <= 10 * G.gtmod || Math.abs(carPJ.targetRotation - carPJ._rotation) > 160) carPJ.derapage = 2;
        if (M.gameQuality >= M.MEDIUM) {
          J.spawnSmoke('smokeSkid', carPJ.x, carPJ.y, random(80) + 20, M.preSinA * carPJ.speedA * 1.5 * ((random(4) + 6) / 10), carPJ.speedA * 100 / 10, 5, false);
        }
      }
    }

    // Gestion des IAs
    J.moveIA();

    // Frictions et plafonds
    carPJ.speed *= Math.pow(M.roadFriction, G.gtmod);
    M.ratio = Math.pow(0.9, G.gtmod);
    carPJ.speedA = carPJ.speedA * M.ratio + carPJ.speed * (1 - M.ratio);
    M.speedLeft = G.gtmod * carPJ.speed;
    M.speedALeft = G.gtmod * carPJ.speedA;

    // On précalcule les constantes
    M.pi180 = Math.PI / 180;
    M.rotRadA = M.pi180 * carPJ.accelAng;
    M.preCosA = Math.cos(M.rotRadA);
    M.preSinA = Math.sin(M.rotRadA);
    if (carPJ.derapage) M.rotRad = M.pi180 * carPJ.oldRotation;
    else M.rotRad = M.pi180 * carPJ._rotation;
    M.preCos = Math.cos(M.rotRad);
    M.preSin = Math.sin(M.rotRad);

    carPJ.oldX = carPJ.x;
    carPJ.oldY = carPJ.y;
    carPJ.dx = 0;
    carPJ.dy = 0;
    carPJ.realSpeed = 0;

    // ** STEPPING
    do {
      M.step = M.stepMax;
      if (M.step >= M.speedLeft) M.step = M.speedLeft;
      M.speedLeft -= M.step;

      M.stepA = M.stepMax;
      if (M.stepA > M.speedALeft) M.stepA = M.speedALeft;
      M.speedALeft -= M.stepA;

      M.recalc = false;
      do {
        // Application des mouvements
        M.dxA = M.preCosA * M.stepA;
        M.dyA = M.preSinA * M.stepA;
        M.dx = M.preCos * M.step;
        M.dy = M.preSin * M.step;
        // Calcul des DX,DY finaux
        M.dxTotal = (carPJ.statGrip * M.dx + (1 - carPJ.statGrip) * M.dxA);
        M.dyTotal = (carPJ.statGrip * M.dy + (1 - carPJ.statGrip) * M.dyA);

        // Si on est dans la terre, on modifie le step par la friction et on recalcule
        if (M.recalc) M.recalc = false;
        else if (!M.EDITORMODE) {
          M.pt = { x: carPJ.x + M.dxTotal, y: carPJ.y + M.dyTotal };
          track.localToGlobal(M.pt);
          if (track.skin.sub.borderZone.hitTest(M.pt.x, M.pt.y, true)) {
            M.hitBorder = 3;
            if (carPJ.offRoadTimer == null && !carPJ.finished) carPJ.offRoadTimer = getTimer();   // eslint-disable-line eqeqeq
          }
          if (M.hitBorder) {
            M.step = Math.min(M.borderMaxSpeed, M.step);
            M.stepA = Math.min(M.borderMaxAccelSpeed, M.stepA);
            M.recalc = true;
          } else if (carPJ.offRoadTimer) {
            carPJ.vs.offRoad += getTimer() - carPJ.offRoadTimer;
            delete carPJ.offRoadTimer;
          }
        }
      } while (M.recalc);

      if (M.hitBorder && !M.EDITORMODE) {
        track.skin.sub.outZone._visible = true;
        M.pt = { x: carPJ.x + M.dxTotal, y: carPJ.y + M.dyTotal };
        track.localToGlobal(M.pt);
        if (track.skin.sub.outZone.hitTest(M.pt.x, M.pt.y, true) == true) { // eslint-disable-line eqeqeq
          carPJ.speed = 1;
          carPJ._rotation = getAngle(carPJ._rotation + G.gtmod * (carPJ.signLastRotation * 3));
          carPJ.accelAng = carPJ._rotation;
          break;
        }
      }

      carPJ.realSpeed += M.step;
      carPJ.x += M.dxTotal;
      carPJ.y += M.dyTotal;
      carPJ.dx += M.dxTotal;
      carPJ.dy += M.dyTotal;

      // Test si le joueur ramasse le kiwi en cours (kiwi-run)
      if (M.vs.gameMode == M.KIWIRUN) {                                       // eslint-disable-line eqeqeq
        if (vif(M.kiwiItem) && carPJ.hitTest(M.kiwiItem)) {
          rm(M.kiwiItem);
          J.playSoundBK('kiwiPickUp');
          M.currentKiwi++;
          M.kiwiCounter.txt = M.currentKiwi + '/' + M.kiwiMap[track.id].length;
          if (M.currentKiwi >= M.kiwiMap[track.id].length) {
            carPJ.vs.totalTime = getTimer() - carPJ.timerLap;
            carPJ.finished = true;
            M.timerEnd = M.delaiFin;
            M.arrow._visible = false;
          }
        }
      }

      // Labo Kiwix
      if (M.vs.selectedTrack == 4) {                                          // eslint-disable-line eqeqeq
        M.pt = { x: carPJ.x + M.dxTotal, y: carPJ.y + M.dyTotal };
        track.localToGlobal(M.pt);
        if (track.skin.sub.labZone && track.skin.sub.labZone.hitTest(M.pt.x, M.pt.y, true)) {
          if (carPJ.skin._currentframe <= 5) {
            M.attachMovie('specialsBox', 'sBox', M.calcDepth(M.DP_SPECIALSBOX));
            M.sBox._x = M.docWidth / 2;
            M.sBox._y = 100;
            M.sBox.txt = M.specials[4].chaine;
            M.sBox.underTxt = 'activé';
            carPJ.skin.gotoAndStop(carPJ.skinId + 20);
          }
        }
      }
    } while (Math.abs(M.speedLeft) != 0 && Math.abs(M.speedALeft) != 0);     // eslint-disable-line eqeqeq

    carPJ.realSpeed = (1 / G.gtmod) * carPJ.realSpeed;

    if (M.hitBorder > 0) {
      M.nitroStopped = true;
      carPJ.vibre = 20;
      if (M.gameQuality >= M.MEDIUM) J.spawnSmoke('smokeMud', carPJ.x, carPJ.y, 0, 0, random(60) + 50, 5, false);
      M.hitBorder--;
      if (M.hitBorder <= 0) {
        track.skin.sub.outZone._visible = false;
        carPJ.vibre = 0;
        M.hitBorder = 0;
        M.pt = { x: carPJ.x, y: carPJ.y };
        track.localToGlobal(M.pt);
        carPJ.speed = M.borderMaxSpeed;
        carPJ.speedA = M.borderMaxAccelSpeed;
      }
    }

    // Test des checkpoints
    if (M.vs.gameMode != M.KIWIRUN) J.testCheckPoints(0);                    // eslint-disable-line eqeqeq

    // Update des coordonnées du MC avec les coordonnées en flottant
    M.vx = 0;
    M.vy = random(carPJ.vibre) / 10;
    carPJ._x = carPJ.x + M.vx;
    carPJ._y = carPJ.y + M.vy;
    M.carShadows[0]._x = carPJ._x + M.shadowShift;
    M.carShadows[0]._y = carPJ._y + M.shadowShift;
    if (carPJ.speed > 7) {
      const randomShift = -random(2);
      M.carShadows[0]._x += randomShift;
      M.carShadows[0]._y += randomShift;
    }
    M.carShadows[0]._rotation = carPJ._rotation;

    // Affichage mode Ghost (cheat GHOST ou super départ)
    if ((M.vs.startBoost && carPJ.vs.immuneHit) || M.specials[3].state) {
      if (carPJ._alpha > M.ghostAlpha) {
        carPJ._alpha -= G.gtmod * 9;
        carPJ._alpha = Math.max(M.ghostAlpha, carPJ._alpha);
      }
    } else if (carPJ._alpha < 100) {
      carPJ._alpha += G.gtmod * 9;
      carPJ._alpha = Math.min(100, carPJ._alpha);
    }

    // Atténuation de l'inertie latérale pour les dérapages
    M.ecart = getAngle(carPJ._rotation - carPJ.accelAng);
    // Fumée en dérapage
    if (M.hitBorder == 0 && Math.abs(M.ecart) > 30) {                         // eslint-disable-line eqeqeq
      if (M.gameQuality >= M.MEDIUM) {
        J.spawnSmoke('smokeSkid', carPJ.x, carPJ.y, M.preCosA * carPJ.speedA * ((random(4) + 6) / 10), M.preSinA * carPJ.speedA * 1.5 * ((random(4) + 6) / 10), carPJ.speedA * 100 / 10, 5, false);
      }
      carPJ.vibre = 13;
    } else {
      carPJ.vibre = false;
    }
    if (carPJ.speed < 4 || (M.vs.nitroFlag && M.specials[1].state)) carPJ.pct = 0.06;

    if (carPJ.derapage) carPJ.accelAng = getAngle(carPJ.accelAng + G.gtmod * (0.3 * carPJ.pct * M.ecart));
    else carPJ.accelAng = getAngle(carPJ.accelAng + G.gtmod * (carPJ.pct * M.ecart));

    if (carPJ.spawnImmune > 0) carPJ.spawnImmune--;

    // Ghost
    if (M.vs.gameMode == M.GHOSTRUN) {                                        // eslint-disable-line eqeqeq
      if (!M.skipGhost) {
        J.ghostStore(M.ghost, false);
        if (M.previousGhost != null) {                                        // eslint-disable-line eqeqeq
          const infos = J.ghostRead(M.previousGhost);
          M.ghostCar._x = infos.x;
          M.ghostCar._y = infos.y;
          M.ghostCar._rotation = infos.r;
        }
      } else if (M.previousGhost != null) {                                   // eslint-disable-line eqeqeq
        const infos = J.ghostRead(M.previousGhost);
        M.previousGhost.current--;
        M.ghostCar._x = (M.ghostCar._x + infos.x) / 2;
        M.ghostCar._y = (M.ghostCar._y + infos.y) / 2;
        M.ghostCar._rotation = (M.ghostCar._rotation + infos.r) / 2;
      }
      M.skipGhost = !M.skipGhost;
    }
  };

  // GESTION DES CONTROLES DU JEU (pas les touches de contrôle du joueur)
  J.getControls = function () {
    // Abandon
    if (!M.starting) {
      if (M.lockQuit && !Key.isDown(Key.ESCAPE)) M.lockQuit = false;
      if (!M.lockQuit && Key.isDown(Key.ESCAPE)) {
        if (!client().forcePause) J.togglePause();
        if (M.gamePaused) {
          M.waitingGiveUp = true;
          const d = M.calcDepth(M.DP_MENU);
          rm(M.giveUpBox);
          M.attachMovie('giveUpBox', 'giveUpBox', d);
          M.giveUpBox._x = M.docWidth / 2;
          M.giveUpBox._y = 200;
          M.giveUpBox.yes._visible = false;
          delete M.giveUpBt;
        } else {
          M.waitingGiveUp = false;
          rm(M.giveUpBox);
          rm(M.pauseBox);
        }
        M.lockQuit = true;
      }
    }

    // Gestion de la boîte de confirmation d'abandon
    if (M.waitingGiveUp) {
      if (Key.isDown(Key.LEFT) || Key.isDown(M.controls[2])) {
        M.giveUpBox.yes._visible = true;
        M.giveUpBox.no._visible = false;
      }
      if (Key.isDown(Key.RIGHT) || Key.isDown(M.controls[3])) {
        M.giveUpBox.yes._visible = false;
        M.giveUpBox.no._visible = true;
      }
      if (M.giveUpBt != null || Key.isDown(M.controls[4]) || Key.isDown(Key.SPACE) || Key.isDown(Key.ENTER) || Key.isDown(Key.CONTROL)) {   // eslint-disable-line eqeqeq
        if (M.giveUpBt == 1 || M.giveUpBox.yes._visible) {                    // eslint-disable-line eqeqeq
          M.vs.giveUp = true;
          delete M.giveUpBt;
          M.vs.mainPhase = 2;
          M.skipToTrackPresent = false;
        }
        if (M.giveUpBt == 2 || M.giveUpBox.no._visible) {                     // eslint-disable-line eqeqeq
          M.vs.giveUp = false;
          delete M.giveUpBt;
          J.togglePause();
          M.waitingGiveUp = false;
          rm(M.giveUpBox);
        }
      }
    }

    // Pause
    if (M.lockPause && !Key.isDown(80)) M.lockPause = false;
    if (!M.lockPause && Key.isDown(80) && !M.starting && !M.waitingGiveUp && !client().forcePause) {
      J.togglePause();
      M.lockPause = true;
    }

    if (!M.gamePaused) {
      if (M.EDITORMODE) J.getEditorControls();
      if (M.GAMEDEBUG) J.getDebugControls();
    }
  };
  J.getEditorControls = function () {};
  J.getDebugControls = function () {};

  // Déplacement des FX
  J.moveFx = function () {
    let mc, i;
    for (i = 0; i < M.fx.length; i++) {
      mc = M.fx[i];
      mc._x += G.gtmod * mc.dx;
      mc._y += G.gtmod * mc.dy;
      mc.dx *= mc.friction;
      mc.dy *= mc.friction;
      if (mc.kill || M.gameQuality < M.MEDIUM) {
        mc.removeMovieClip();
        M.fx.splice(i, 1);
        i--;
      }
    }
  };

  // GESTION DU KIWI RUN
  J.manageKiwis = function () {
    // S'il n'y a pas de kiwi en jeu, on en attache un
    if (!vif(M.kiwiItem) && M.currentKiwi < M.kiwiMap[M.track.id].length) {
      const d = M.track.calcDepth(M.DP_KIWIS);
      M.track.attachMovie('kiwi', 'kiwiItem', d);
      M.kiwiItem = M.track.kiwiItem;
      M.kiwiItem._x = M.kiwiMap[M.track.id][M.currentKiwi].x;
      M.kiwiItem._y = M.kiwiMap[M.track.id][M.currentKiwi].y;
      M.arrow._visible = true;
    }

    // Gestion de la flèche indiquant la position du prochain kiwi
    const pt = { x: vif(M.kiwiItem) ? M.kiwiItem._x : undefined, y: vif(M.kiwiItem) ? M.kiwiItem._y : undefined };
    M.track.localToGlobal(pt);
    M.arrow._x = Math.max(M.arrowBorderMargin, Math.min(350 - M.arrowBorderMargin, pt.x));
    M.arrow._y = Math.max(M.arrowBorderMargin, Math.min(350 - M.arrowBorderMargin, pt.y));

    if (pt.x >= M.arrowBorderMargin && pt.x <= 350 - M.arrowBorderMargin
        && pt.y >= M.arrowBorderMargin && pt.y <= 350 - M.arrowBorderMargin) {
      M.arrow._rotation = 0;
      M.arrow.gotoAndStop(2);
    } else {
      const angRad = Math.atan2(M.carPJ.y - (vif(M.kiwiItem) ? M.kiwiItem._y : NaN), M.carPJ.x - (vif(M.kiwiItem) ? M.kiwiItem._x : NaN));
      const ang = angRad / (Math.PI / 180) - 180;
      M.arrow._rotation = ang;
      M.arrow.gotoAndStop(1);
    }
  };

  // INITIALISATIONS DE MAIN GAME
  J.initGame = function () {
    // Sons
    if (M.musicON) {
      J.stopMusic(M.musicMenu);
      J.startMusic(M.musicGame);
    }

    const today = new Date();
    if (M.specials[6].state || today.getHours() <= 7 || today.getHours() >= 20) {
      M.nightMode = true;
      M.nightOffset = M.NIGHT_LUM;
      // `id` n'est pas posé (M.id) : la nuit n'est jamais doublée — le fichier
      if (M.id == 3 || M.id == 4 || M.id == 5) M.nightOffset *= 2;            // eslint-disable-line eqeqeq
    } else {
      M.nightMode = false;
    }

    // Circuit et voitures
    J.attachTrack(M.vs.selectedTrack);
    M.carPJ = M.cars[0];
    if (M.specials[3].state) M.carPJ.vs.immuneHit = M.baseImmuneHit;

    // Tournoi
    if (M.newTournament) {
      J.initTournament();
      M.newTournament = false;
    }

    // Kiwi-run
    if (M.vs.gameMode == M.KIWIRUN) {                                         // eslint-disable-line eqeqeq
      M.attachMovie('arrowIndicator', 'arrow', M.calcDepth(M.DP_ARROW));
      M.arrow._x = M.docWidth / 2;
      M.arrow._y = M.docHeight / 2;
      M.arrow.stop();
      M.arrow._visible = false;
      M.currentKiwi = 0;
      M.attachMovie('kiwiCounter', 'kiwiCounter', M.calcDepth(M.DP_ARROW));
      M.kiwiCounter._x = M.docWidth / 2;
      M.kiwiCounter._y = 50;
      M.kiwiCounter.txt = M.currentKiwi + '/' + M.kiwiMap[M.track.id].length;
    }

    // Panel du jeu
    if (M.panelON) J.attachPanel();

    // Divers
    M.hitBorder = 0;
    M.trackedCar = 0;
    M.orderSkip = 0;
    M.activeIAKiwis = 0;

    // Boost de nitro
    M.vs.nitroFlag = false;
    M.accelBoost = 1;
    M.nitroStopped = false;

    // Check du mode de jeu
    if (!J.checkMode(M.vs.gameMode)) J.fatal('Fichier introuvable sur ce FD', 'Illegal mode');

    // Qualité graphique
    M.checkFPS = M.baseCheckFPS;

    // Initialisations diverses
    M.vs.giveUp = false;
    M.waitingGiveUp = false;
    M.gamePaused = true;
    M.starting = true;
    M.timerEnd = 0;
    if (M.panelMC) {
      M.panelMC.maskSpeedBar._width = 0;
      M.panelMC.chrono_txt = '0"00';
      M.panelMC.chronoMilli_txt = '000';
    }
    J.getOrder();
    delete M.forcePosition;
  };

  // ═══════════════════════════ IA.as ═══════════════════════════

  J.moveIA = function () {
    for (let i = 1; i < M.cars.length; i++) {
      const carIA = M.cars[i];
      M.carIA = carIA;

      // BUG : currentMaxSpeed foireux, origine inconnue (le fichier)
      if (carIA.currentMaxSpeed < carIA.statMaxSpeed) carIA.currentMaxSpeed = carIA.statMaxSpeed;

      // Checkpoint
      J.testCheckPoints(i);

      if (carIA.preImmune > 0) {
        carIA.preImmune -= G.gtmod;
        if (carIA.preImmune <= 0) carIA.vs.immuneHit = M.baseImmuneHit;
      }
      if (carIA.vs.immuneHit > 0) {
        carIA.vs.immuneHit -= G.gtmod;
        if (carIA.vs.immuneHit < 0) carIA.vs.immuneHit = 0;
      }

      // IA : hit-tests avec le joueur
      J.testHitCar(carIA, M.cars[0]);

      // IA : aller vers le checkpoint
      if (carIA.panic <= 0 && !carIA.finished) {
        M.rotationVitesseLente = Math.max(0, carIA.statRot - (carIA.speed * 5) * 0.7);
        M.rotationVitesseRapide = Math.max(0, carIA.speed * 0.52);
        M.angCPrad = Math.atan2(carIA.y - carIA.nextY, carIA.x - carIA.nextX);
        M.angCP = M.angCPrad / (Math.PI / 180) - 180;
        M.ecart = getAngle(M.angCP - carIA._rotation);
        if (M.ecart >= -15 && M.ecart <= 15) {
          carIA._rotation = M.angCP;
        } else {
          if (M.ecart < -3) {
            carIA._rotation -= G.gtmod * (Math.max(0, carIA.statRotTemp - M.rotationVitesseRapide)) * carIA.rotationBoost;
            carIA.speed *= Math.pow(carIA.statTurning, G.gtmod);
          }
          if (M.ecart > 3) {
            carIA._rotation += G.gtmod * (Math.max(0, carIA.statRotTemp - M.rotationVitesseRapide)) * carIA.rotationBoost;
            carIA.speed *= Math.pow(carIA.statTurning, G.gtmod);
          }
        }
        // Caler la voiture sur l'angle à atteindre si elle passe « au-dessus »
        M.newEcart = getAngle(M.angCP - carIA._rotation);
        if (M.newEcart != 0) {                                                // eslint-disable-line eqeqeq
          M.signe = M.ecart / M.newEcart;
          if (M.signe < 0) carIA._rotation = M.angCP;
        }
      }

      // IA : utilisation de nitro
      if (carIA.vs.kiwis && carIA.nitroTimer == 0) {                          // eslint-disable-line eqeqeq
        if (J.randomT(40 * 1 / carIA.nitroAgg) == 0) {                        // eslint-disable-line eqeqeq
          const suivant = M.CP[M.track.id][carIA.currentCP + 1];
          // CP[…][currentCP + 1] peut manquer (dernier checkpoint) : undefined.maxSpeed >= 10 est faux
          if (suivant && suivant.maxSpeed >= 10) {
            if (M.carPJ.totalCP - carIA.totalCP > carIA.CPdistanceTolerance && M.activeIAKiwis <= M.maxIAKiwis) {
              carIA.vs.kiwis--;
              M.activeIAKiwis++;
              carIA.nitroTimer = M.baseNitroTimer * 1.5;
              carIA.currentMaxSpeed = M.nitroMaxSpeedIA;
              carIA.rotationBoost = 1.5;
              J.startBoostAnim(carIA);
            }
          }
        }
      }

      if (carIA.nitroTimer) {
        carIA.nitroTimer -= G.gtmod;
        if (carIA.nitroTimer <= 0) {
          carIA.nitroTimer = 0;
          M.activeIAKiwis--;
          carIA.currentMaxSpeed = carIA.statMaxSpeed;
          carIA.rotationBoost = 1;
          J.stopBoostAnim(carIA);
        }
      }

      // IA : accélération
      if (!carIA.finished) {
        if (Math.abs(M.ecart) < 45 || carIA.speed < 0.5) {
          carIA.speed += G.gtmod * (((carIA.currentMaxSpeed - carIA.speed) / (carIA.currentMaxSpeed + 15)) * carIA.statAccel);
        }
      }
      // IA : freinage
      if (Math.abs(M.ecart) > 55 || carIA.finished) carIA.speed *= Math.pow(carIA.statBrake, G.gtmod);

      // Dérapage en fin de course
      if (carIA.finished) {
        if (carIA.derapage == 0) {                                            // eslint-disable-line eqeqeq
          carIA.targetRotation = carIA._rotation + (90 + random(50)) * (random(2) * 2 - 1);
          if (carIA.targetRotation <= -180) carIA.targetRotation = 360 - Math.abs(carIA.targetRotation);
          if (carIA.targetRotation >= 180) carIA.targetRotation = carIA.targetRotation - 360;
          carIA.derapage = 1;
          carIA.oldRotation = carIA._rotation;
        }
        if (carIA.derapage == 1) {                                            // eslint-disable-line eqeqeq
          carIA._rotation += G.gtmod * ((carIA.targetRotation - carIA._rotation) / 20);
          if (Math.abs(carIA.targetRotation - carIA._rotation) <= 10 * G.gtmod || Math.abs(carIA.targetRotation - carIA._rotation) > 160) carIA.derapage = 2;
          if (M.gameQuality >= M.MEDIUM) {
            J.spawnSmoke('smokeSkid', carIA.x, carIA.y, random(80) + 20, M.preSinA * carIA.speedA * 1.5 * ((random(4) + 6) / 10), carIA.speedA * 100 / 10, 5, false);
          }
        }
      }

      // Calcul des vitesses
      carIA.speed *= Math.pow(M.roadFriction, G.gtmod);
      carIA.speed = Math.min(carIA.speed, carIA.currentMaxSpeed);

      // IA : freinage dans les zones dangereuses
      if (!carIA.finished) {
        const cp = M.CP[M.track.id][carIA.currentCP];
        if (cp && carIA.speed > cp.maxSpeed) carIA.speed *= Math.pow(0.85, G.gtmod);
      }

      carIA.realSpeed = carIA.speed;

      M.ratio = Math.pow(0.9, G.gtmod);
      carIA.speedA = carIA.speedA * M.ratio + carIA.speed * (1 - M.ratio);
      M.ecart = getAngle(carIA._rotation - carIA.accelAng);
      M.pi180 = Math.PI / 180;
      if (carIA.derapage) {
        carIA.accelAng = getAngle(carIA.accelAng + G.gtmod * (0.005 * M.ecart * 2));
        M.rotRad = M.pi180 * carIA.oldRotation;
      } else {
        carIA.accelAng = getAngle(carIA.accelAng + G.gtmod * (0.1 * M.ecart * 2));
        M.rotRad = M.pi180 * carIA._rotation;
      }

      M.dx = Math.cos(M.rotRad) * carIA.speed;
      M.dy = Math.sin(M.rotRad) * carIA.speed;
      M.rotRadA = M.pi180 * carIA.accelAng;
      M.dxA = Math.cos(M.rotRadA) * carIA.speedA;
      M.dyA = Math.sin(M.rotRadA) * carIA.speedA;

      M.dxTotal = (carIA.statGrip * M.dx + (1 - carIA.statGrip) * M.dxA);
      M.dyTotal = (carIA.statGrip * M.dy + (1 - carIA.statGrip) * M.dyA);
      M.dxTotal = G.gtmod * M.dxTotal;
      M.dyTotal = G.gtmod * M.dyTotal;
      carIA.dx = M.dxTotal;
      carIA.dy = M.dyTotal;
      carIA.x += M.dxTotal;
      carIA.y += M.dyTotal;
      carIA._x = carIA.x;
      carIA._y = carIA.y;
      M.carShadows[i]._x = carIA._x + M.shadowShift;
      M.carShadows[i]._y = carIA._y + M.shadowShift;
      if (carIA.speed > 7) {
        const randomShift = -random(2);
        M.carShadows[i]._x += randomShift;
        M.carShadows[i]._y += randomShift;
      }
      M.carShadows[i]._rotation = carIA._rotation;

      // Baisse du taux de « panic »
      if (carIA.panic > 0) {
        carIA.panic -= G.gtmod;
        if (carIA.panic < 0) carIA.panic = 0;
      }

      if (carIA.spawnImmune > 0) carIA.spawnImmune--;
    }
  };

  // ═══════════════════════════ gameMovies.as ═══════════════════════════

  // CLEAN EM ALL !
  J.cleanAll = function () {
    let i;
    for (i = 0; i < M.cars.length; i++) M.cars[i].removeMovieClip();
    for (i = 0; i < M.fx.length; i++) M.fx[i].removeMovieClip();
    for (i = 0; i < M.bgFx.length; i++) M.bgFx[i].removeMovieClip();
    for (i = 0; i < M.trackTopItems.length; i++) M.trackTopItems[i].removeMovieClip();
    // `timeLines` n'est jamais posé avant : undefined.length, la boucle ne tourne pas — puis un tableau vide
    if (M.timeLines) for (i = 0; i < M.timeLines.length; i++) M.timeLines[i].removeMovieClip();
    for (i = 0; i < M.buttons.length; i++) M.buttons[i].removeMovieClip();

    M.cars = [];
    M.fx = [];
    M.bgFx = [];
    M.trackTopItems = [];
    M.timeLines = [];
    M.buttons = [];

    rm(M.announce);
    rm(M.arrow);
    rm(M.blackBg);
    rm(M.chronoSummary);
    rm(M.finalScrolls);
    rm(M.gameOver);
    rm(M.ghostCar);
    rm(M.giveUpBox);
    rm(M.goBox);
    rm(M.grille);
    rm(M.intro);
    rm(M.keys);
    rm(M.kiwiCounter);
    rm(M.kiwiItem);
    rm(M.limited);
    rm(M.logo);
    rm(M.menuMC);
    rm(M.panelMC);
    rm(M.pauseBox);
    rm(M.perfectMC);
    rm(M.preloader);
    rm(M.startAnim);
    rm(M.sBox);
    rm(M.summary);
    rm(M.teamList);
    if (M.track && M.track.skin) M.track.skin.unloadMovie();
    rm(M.track);
  };

  // MAIN TRACK LOADER
  J.attachTrack = function (id) {
    let i;
    const track = M.track;

    track._visible = true;
    track.skin.sub._xscale = 100;
    track.skin.sub._yscale = 100;

    track.id = id;
    track.skin.sub.outZone._visible = false;

    // Stats de course
    track.stats = M.tracks[id];
    track.difficulty = track.stats.difficulty;

    // Objets de premier plan présents sur la course
    i = 0;
    const topItems = M.tracks[id].topItems;
    while (topItems && i < topItems.length) {
      M.item = topItems[i];
      M.d = track.calcDepth(M.DP_TRACKTOP);
      track.attachMovie(M.item.id, 'trackTopItem_' + M.d, M.d);
      M.mc = track['trackTopItem_' + M.d];
      M.mc._x = M.item.x;
      M.mc._y = M.item.y;
      M.mc._rotation = M.item.ang;
      M.trackTopItems.push(M.mc);
      i++;
    }

    // Voitures
    M.skinPool = [];
    for (i = 0; i < 4; i++) M.skinPool.push(i + 1);
    i = 0;

    // Spécificités des modes de jeu
    M.maxCars = 4;
    if (M.vs.gameMode == M.DUEL) {                                            // eslint-disable-line eqeqeq
      M.maxCars = 2;
      // `mc.nitroAgg` : mc est le DERNIER clip touché (un décor, ou n'importe
      // quoi) — pas la voiture, qui n'existe pas encore. Sans effet sur le jeu.
      const mcBidon = M.mc || {};
      switch (M.vs.selectedAdv) {
        case 0: mcBidon.nitroAgg = 0.95; track.difficulty *= 0.95; break; // UltraOrange
        case 1: mcBidon.nitroAgg = 0.75; track.difficulty *= 0.87; break; // UWE wing
        case 2: mcBidon.nitroAgg = 0.95; track.difficulty *= 0.85; break; // Fury Hun
        case 3: mcBidon.nitroAgg = 1.10; track.difficulty *= 0.90; break; // Sonic Brain
        case 4: mcBidon.nitroAgg = 1.50; track.difficulty *= 1.18; break; // KiwiX
        default: break;
      }
    }

    if (M.vs.gameMode == M.ARCADE || M.vs.gameMode == M.TRAINING) track.difficulty *= 0.79;   // eslint-disable-line eqeqeq
    if (M.vs.gameMode == M.KIWIRUN || M.vs.gameMode == M.TUTORIAL) M.maxCars = 1;             // eslint-disable-line eqeqeq
    if (M.vs.gameMode == M.TIMETRIAL) M.maxCars = 1;                                          // eslint-disable-line eqeqeq

    if (M.vs.gameMode == M.GHOSTRUN) {                                        // eslint-disable-line eqeqeq
      M.maxCars = 1;
      M.skipGhost = false;
      M.ghost = J.createGhost();
      if (M.previousGhost != null) {                                          // eslint-disable-line eqeqeq
        // Le fantôme court avec la voiture qui a fait le temps, pas avec
        // celle qu'on a choisie aujourd'hui : c'est sa course à lui.
        const ecurie = (M.fantomeCar === undefined) ? M.vs.selectedCar : M.fantomeCar;
        J.attachGhost(ecurie);
        M.previousGhost.current = 0;
      }
    }

    if (M.specials[2].state) track.difficulty *= 0.60;

    if (M.vs.gameMode == M.FRUTICUP) {                                        // eslint-disable-line eqeqeq
      if (!M.vs.$wcs) track.difficulty *= 0.72;
      else track.difficulty *= 1.15;
    }

    while (i < M.tracks[id].startPoints.length && i < M.maxCars) {
      M.startPoint = M.tracks[id].startPoints[i];
      M.carId = M.startPoint.id;
      if (M.carId == 0) J.attachCar(M.startPoint.id, M.carStats[M.vs.selectedCar], M.startPoint.x, M.startPoint.y, M.startPoint.ang);   // eslint-disable-line eqeqeq
      else J.attachCar(M.startPoint.id, M.tracks[id].carStatsIA, M.startPoint.x, M.startPoint.y, M.startPoint.ang);
      i++;
    }

    if (M.specials[2].state) { // Cheat DRONE
      let maxDrones = 5;
      if (M.vs.gameMode == M.TUTORIAL) maxDrones = 10;                       // eslint-disable-line eqeqeq
      for (let k = 0; k < maxDrones; k++) {
        const rCPid = random(M.CP[id].length - 4) + 3;
        const rCP = M.CP[id][rCPid];
        J.attachCar(k + 4, M.tracks[id].carStatsIA, rCP.x, rCP.y, rCP.ang);
        M.cars[k + 4].currentCP = rCPid;
        M.cars[k + 4].totalCP = -30;
        M.cars[k + 4].nextX = M.CP[id][rCPid].x;
        M.cars[k + 4].nextY = M.CP[id][rCPid].y;
      }
    }

    // Mode nocturne
    if (M.nightMode) {
      J.setColor(track, 100, M.nightOffset, 100, M.nightOffset, 100, M.nightOffset * 0.3);
      if (track.skin.sub.lights) J.setColor(track.skin.sub.lights, 100, -M.nightOffset, 100, -M.nightOffset, 100, -M.nightOffset * 0.3);
    }
  };

  // ATTACHE LE GHOST
  J.attachGhost = function (id) {
    M.d = M.track.calcDepth(M.DP_CARS);
    M.track.attachMovie('car', 'ghostCar', M.d);
    M.ghostCar = M.track.ghostCar;
    M.ghostCar._alpha = M.ghostAlpha;
    M.ghostCar.stop();
    J.stopBoostAnim(M.ghostCar);
    M.ghostCar.skin.gotoAndStop(M.carStats[id].skin);
  };

  // ATTACHE UNE VOITURE
  J.attachCar = function (id, stats, x, y, rot) {
    let mc, mcSh;

    M.d = M.track.calcDepth(M.DP_SHADOWS);
    M.track.attachMovie('carShadow', 'carShadow_' + id, M.d);
    mcSh = M.track['carShadow_' + id];
    M.d = M.track.calcDepth(M.DP_CARS);
    M.track.attachMovie('car', 'car_' + id, M.d);
    mc = M.track['car_' + id];

    if (M.nightMode) J.setColor(mc, 100, -M.nightOffset, 100, -M.nightOffset, 100, -M.nightOffset);
    else mc.lights._visible = false;

    mc.x = x;
    mc.y = y;
    mc._x = x;
    mc._y = y;
    mc._rotation = rot;

    // Ombre
    mcSh._x = mc._x + M.shadowShift;
    mcSh._y = mc._y + M.shadowShift;
    mcSh._rotation = mc._rotation;

    // Objet secure de la voiture
    mc.vs = {};
    mc.vs.laps = 0;
    mc.vs.kiwis = stats.kiwis;
    mc.vs.offRoad = 0;
    mc.vs.offRoadTotal = 0;
    mc.vs.collisions = 0;
    mc.vs.perfects = 0;
    mc.vs.collisionsTotal = 0;
    mc.vs.totalTime = 0;
    mc.vs.bestLap = Infinity;
    mc.vs.topSpeed = 0;
    mc.vs.immuneHit = 0;

    mc.nitroAgg = 0.90;
    mc.preImmune = 0;

    if (mc.vs.kiwis > M.maxKiwis) J.fatal('Surchauffe du moteur', 'invalid ' + mc.vs.kiwis + ' nitros (car id=' + id + ')');

    // Caractéristiques du véhicule
    mc.statRot = stats.rot;
    mc.statAccel = stats.accel;
    mc.statBrake = stats.brake;
    mc.statTurning = stats.turning;
    mc.statMaxSpeed = stats.maxSpeed;
    mc.statGrip = stats.grip;
    mc.currentMaxSpeed = stats.maxSpeed;
    mc.statKiwis = stats.kiwis;

    // L'IA a des stats déclinées d'une base commune, pondérées par quelques facteurs
    if (stats.skin == -1) {                                                   // eslint-disable-line eqeqeq
      M.fact = (0.85 + random(30) / 100) * M.track.difficulty;
      mc.statAccel *= M.fact;

      M.fact = (0.80 + random(40) / 100) * M.track.difficulty;
      if (M.specials[2].state) M.fact *= random(80) / 100 + 0.5; // Cheat DRONE
      mc.statMaxSpeed *= M.fact;

      M.fact = (0.85 + random(30) / 100) * M.track.difficulty;
      mc.statGrip *= M.fact;

      mc.nitroBoost = 0;
      mc.vs.kiwis = Infinity;
      mc.rotationBoost = 1;
      mc.CPdistanceTolerance = 1;
      if (M.vs.gameMode == M.DUEL || random(4) == 0) { // duel ou voiture « agressive »   // eslint-disable-line eqeqeq
        mc.CPdistanceTolerance = 1;
        mc.nitroAgg *= 0.5;
      }

      if (M.EDITORMODE) mc.skill = 0;
      else if (M.vs.gameMode == M.DUEL) mc.skill = 0.90 + random(10) / 100;  // eslint-disable-line eqeqeq
      else mc.skill = random(20) / 100;
    }

    // On enlève la voiture du pool restant
    if (stats.skin != -1) {                                                   // eslint-disable-line eqeqeq
      mc.skinId = stats.skin;
      if (id == 0 && mc.skinId == 1 && M.specials[5].state) mc.skinId = 41;   // eslint-disable-line eqeqeq
      else if (id == 0 && M.specials[4].state) mc.skinId += 20;               // eslint-disable-line eqeqeq
      mc.carName = M.carSkinNames[mc.skinId - 1];
      gdebug('Driving : ' + mc.carName);
      for (M.n = 0; M.n < M.skinPool.length; M.n++) {
        if (M.skinPool[M.n] == mc.skinId) { M.skinPool.splice(M.n, 1); break; }   // eslint-disable-line eqeqeq
      }
    } else if (M.vs.gameMode == M.DUEL) {                                      // eslint-disable-line eqeqeq
      mc.skinId = M.vs.selectedAdv + 1;
      mc.carName = M.carSkinNames[mc.skinId - 1];
    } else if (M.specials[2].state) { // Cheat DRONE
      mc.carName = 'Drone';
      mc.skinId = 6;
    } else {
      // ou on lui attribue un skin du pool restant
      mc.skinId = M.skinPool[0] + 7;
      M.skinPool.splice(0, 1);
      mc.carName = M.carSkinNames[mc.skinId - 8];
    }

    mc.skin.gotoAndStop(mc.skinId);

    // Initialisation des forces
    mc.speed = 0;
    mc.speedA = 0;
    mc.accelAng = mc._rotation;

    mc.speedCounter = 0;
    mc.currentCP = -1;

    // Variables de gameplay
    mc.nitroTimer = 0;
    mc.panic = 0;
    mc.spawnImmune = 0;
    mc.didAllCP = false;
    mc.derapage = 0;

    mc.stop();
    J.stopBoostAnim(mc);

    M.cars[id] = mc;
    M.carShadows[id] = mcSh;
  };

  // FX : fumée
  J.spawnSmoke = function (id, x, y, dx, dy, scale, ecartRandom, onTop) {
    let d, mc;
    if (onTop) d = M.track.calcDepth(M.DP_FXTOP, false);
    else d = M.track.calcDepth(M.DP_FX, false);
    M.track.attachMovie(id, 'smoke_' + d, d);
    mc = M.track['smoke_' + d];

    x += random(ecartRandom) * (random(2) * 2 - 1);
    y += random(ecartRandom) * (random(2) * 2 - 1);
    mc._x = x;
    mc._y = y;
    mc.dx = dx;
    mc.dy = dy;
    mc.friction = Math.pow(0.8, G.gtmod);
    mc._xscale = scale;
    mc._yscale = scale;

    if (dx != 0 || dy != 0) M.fx.push(mc);                                    // eslint-disable-line eqeqeq
  };

  // FX : chocs car-car
  J.spawnHitCar = function (x, y, dx, dy) {
    const d = M.track.calcDepth(M.DP_FX);
    M.track.attachMovie('hitCar', 'hitCar_' + d, d);
    const mc = M.track['hitCar_' + d];

    x += random(4) * (random(2) * 2 - 1);
    y += random(4) * (random(2) * 2 - 1);
    mc._x = x;
    mc._y = y;
    mc.dx = 0.5 * dx + 0.2 * (random(5) * (random(2) * 2 - 1));
    mc.dy = 0.5 * dy + 0.2 * (random(5) * (random(2) * 2 - 1));
    mc.friction = Math.pow(0.9, G.gtmod);
    mc._xscale = random(50) + 80;
    mc._yscale = mc._xscale;
    mc.gotoAndPlay(random(20) + 1);

    M.fx.push(mc);
  };

  // Panel d'affichage dans le jeu
  J.attachPanel = function () {
    let d = M.calcDepth(M.DP_INTERF);
    M.attachMovie('panel', 'panelMC', d);
    M.panelMC._x = 0;
    M.panelMC._y = 346;
    M.panelMC.initDepth();
    M.panelMC.bar.stop();
    M.panelMC.pos_txt.text = '';

    // Jetons de classement (jeton1… : ces noms n'existent pas — jeton_1 si ;
    // l'appel tombe dans le vide, et les jetons jouent leur scénario)
    for (const n of ['jeton1', 'jeton2', 'jeton3', 'jeton4']) if (M.panelMC[n]) M.panelMC[n].stop();

    // Kiwis
    for (let i = 0; i < M.cars[0].vs.kiwis; i++) {
      d = M.panelMC.calcDepth(M.DP_INTERF);
      M.panelMC.attachMovie('nitroMC', 'nitro_' + i, d);
      const mc = M.panelMC['nitro_' + i];
      mc._x = 189 + i * 24;
      mc._y = -14;
      mc.stop();
    }
  };

  // AFFICHE LE TEMPS D'UN TOUR
  J.attachTimeLine = function (lap, time, perfect, bestLap, bestRace, prevTime) {
    const d = M.calcDepth(M.DP_INTERF);
    M.attachMovie('timeLine', 'timeLine_' + d, d);
    const mc = M['timeLine_' + d];
    mc._y = lap * M.timeLinesHeight + M.timeLinesY;
    mc.txt = 'Tour ' + (lap + 1) + ' - ' + J.timeToString(time);

    if (lap == 0) mc.progress._visible = false;                               // eslint-disable-line eqeqeq
    else {
      if (time == prevTime) mc.progress_txt = 'Même temps !';                 // eslint-disable-line eqeqeq
      if (time > prevTime) mc.progress_txt = '+ ' + J.timeToString(time - prevTime);
      if (time < prevTime) mc.progress_txt = '- ' + J.timeToString(prevTime - time);
    }

    if (perfect) mc.txt += ' (P)';

    let frame = 1;
    if (bestLap) { mc.txt += ' *'; frame = 2; }
    if (bestRace) { mc.txt += ' *'; mc.progress._visible = false; frame = 3; }
    mc.gotoAndStop(frame);

    if (!M.timeLines) M.timeLines = [];
    M.timeLines.push(mc);
  };

  // AFFICHE LE PERFECT LAP
  J.attachPerfect = function () {
    // « perfectMC.removeMovieClip » sans parenthèses : rien n'est retiré (le fichier)
    M.attachMovie('perfect', 'perfectMC', M.calcDepth(M.DP_FXTOP));
    M.perfectMC._x = M.docWidth / 2;
    M.perfectMC._y = 37;
  };

  // AFFICHE L'INDICATEUR DE SUPER DÉPART
  J.attachSuperStart = function () {
    M.attachMovie('superPop', 'superPop', M.calcDepth(M.DP_FXTOP));
    M.superPop._x = M.docWidth / 2;
    M.superPop._y = M.docHeight - 50;
    if (M.vs.startBoost > 0.6) M.superPop.sub.sub.gotoAndStop(1);
    else M.superPop.sub.sub.gotoAndStop(2);
  };

  // AFFICHE LE NOUVEAU TOUR
  J.attachLap = function (lap) {
    const d = M.calcDepth(M.DP_FXTOP);
    rm(M.chronoSummary);
    M.attachMovie('chronoSummary', 'chronoSummary', d);
    M.chronoSummary._x = M.docWidth / 2;
    M.chronoSummary._y = 5;
    M.chronoSummary.tour = lap + 1;
  };

  // AFFICHE L'ANNONCE DU DEPART
  J.attachGoPop = function () {
    const d = M.calcDepth(M.DP_FXTOP);
    rm(M.goBox);
    M.attachMovie('goBox', 'goBox', d);
    M.goBox._x = M.docWidth / 2;
    M.goBox._y = 50;
  };

  // L'INDICATEUR DE TRANSFERT
  J.attachNetworkPop = function () {
    J.detachNetworkPop();
    M.attachMovie('networkPop', 'networkPop', M.calcDepth(M.DP_FXTOP));
    M.networkPop._x = M.docWidth / 2;
    M.networkPop._y = M.docHeight / 2;
  };
  J.detachNetworkPop = function () { rm(M.networkPop); };

  // L'ANIM DE BOOST NITRO
  J.startBoostAnim = function (car) {
    car.boost._visible = true;
    car.boost.gotoAndPlay(1);
    car.instantBoost._visible = true;
    car.instantBoost.gotoAndPlay(1);
  };
  J.stopBoostAnim = function (car) {
    car.boost._visible = false;
    car.boost.stop();
    car.instantBoost._visible = false;
    car.instantBoost.stop();
  };

  // UN FILTRE DE COULEUR SUR LE MC
  J.setColor = function (mc, rPct, rAlpha, gPct, gAlpha, bPct, bAlpha) {
    const obj = { ra: rPct, rb: rAlpha, ga: gPct, gb: gAlpha, ba: bPct, bb: bAlpha, aa: 100, ab: 0 };
    new K.Color(mc).setTransform(obj);
  };
  J.setLuminosity = function (mc, offset) { J.setColor(mc, 100, offset, 100, offset, 100, -offset); };

  // ═══════════════════════════ sounds.as ═══════════════════════════

  J.startMusic = function (soundObj) {
    if (!soundObj) return;
    if (!soundObj.isPlaying) {
      soundObj.start(0, 9999);
      soundObj.isPlaying = true;
    }
  };
  J.stopMusic = function (soundObj) {
    if (!soundObj) return;
    if (soundObj.isPlaying) {
      soundObj.stop();
      soundObj.isPlaying = false;
    }
  };
  J.playSoundBK = function (soundId) { if (M.soundsON) J.playSound(soundId); };
  J.initSounds = function () {
    M.createEmptyMovieClip('musicGameMC', M.calcDepth(M.DP_SOUNDS));
    M.createEmptyMovieClip('musicMenuMC', M.calcDepth(M.DP_SOUNDS));
    M.createEmptyMovieClip('engineUpMC', M.calcDepth(M.DP_SOUNDS));
    M.createEmptyMovieClip('engineDownMC', M.calcDepth(M.DP_SOUNDS));
    M.createEmptyMovieClip('engineMiscMC', M.calcDepth(M.DP_SOUNDS));
    // musicGame / musicMenu n'existent pas encore : leur isPlaying tombe dans le vide
    if (M.musicGame) M.musicGame.isPlaying = false;
    if (M.musicMenu) M.musicMenu.isPlaying = false;
  };
  // Le son du moteur (initEngine / playEngine) : jamais appelé par le jeu,
  // et le fichier n'a pas les sons engineUp / engineDown / engineOff.

  // ═══════════════════════════ preload.as ═══════════════════════════

  // BOUCLE MAIN PRELOAD
  J.mainPreload = function () {
    const p = M.preloadData;
    if (p && p.obj.getBytesTotal() > 7000) {
      J.showProgress(p.obj.getBytesLoaded(), p.obj.getBytesTotal());
      if (vif(M.preloader)) M.preloader.txt = p.msg;
    }
    if (p && p.loadComplete) {
      rm(M.preloader);
      return true;
    }
    return undefined;
  };

  // BOUCLE MAIN DU LOADER DE COURSE
  J.mainTrackLoader = function () {
    if (J.mainPreload()) {
      M.track.initDepth();                    // « this object use another depth manager ! » : -1, sans effet
      if (M.musicON) M.vs.mainPhase = 4;
      else M.vs.mainPhase = 1;
      rm(M.grille);
    }
  };

  // INITIALISATION DU LOADER DE COURSE
  J.initTrackLoader = function (trackId) {
    rm(M.track);
    M.createEmptyMovieClip('track', M.calcDepth(M.DP_TRACK));
    M.track.createEmptyMovieClip('skin', 1);
    M.track.initDepth();
    M.track._visible = false;

    let fileName;
    if (trackId < 10) fileName = 'track0' + trackId + '.swf';
    else fileName = 'track' + trackId + '.swf';

    J.startPreload(M.track.skin, fileName, 'Chargement de course');
  };

  // LE LOADER DE MUSIQUE
  J.mainMusicLoader = function () { if (J.mainPreload()) return true; return undefined; };
  J.initMusicLoader = function (soundMC, fileId) {
    let fileName;
    if (typeof fileId === 'string') fileName = fileId;
    else if (fileId < 10) fileName = 'bk0' + fileId + '.mp3';
    else fileName = 'bk' + fileId + '.mp3';

    const soundObject = new K.Sound(soundMC);
    soundObject.onLoad = J.eventSoundComplete;
    soundObject.isPlaying = false;
    J.startPreload(soundObject, fileName, 'Chargement musique');
    return soundObject;
  };

  // INDIQUE L'ÉVOLUTION D'UN PRELOAD
  J.showProgress = function (loadedBytes, totalBytes) {
    if (!vif(M.preloader)) return;
    M.pct = Math.round(loadedBytes * 100 / totalBytes);
    for (let i = 0; i < M.nbPreloadIcons; i++) {
      const step1 = i * (100 / M.nbPreloadIcons);
      const step2 = (i + 1) * (100 / M.nbPreloadIcons);
      if (M.pct >= step2) M.preloader['k_' + i].gotoAndStop(3);
      if (M.pct > step1 && M.pct < step2) {
        const k = M.preloader['k_' + i];
        k.gotoAndStop(2);
        if (k.nitro && k.nitro.liquid) k.nitro.liquid._y = -12 + ((M.pct - step1) * 19) / (100 / M.nbPreloadIcons);
      }
    }
  };

  // ÉVÉNEMENT : LOADING DE SON TERMINÉ
  J.eventSoundComplete = function (success) {
    if (success) M.preloadData.loadComplete = true;
    else J.loadingError('Musique introuvable', M.preloadData.shortFileName);
  };
  J.eventOnLoadComplete = function () { M.preloadData.loadComplete = true; };
  J.eventOnLoadError = function (mc, errorCode) {
    const msg = (errorCode === 'URLNotFound') ? 'Fichier introuvable' : 'Téléchargement interrompu';
    J.loadingError(msg + ' (' + mc + ')', M.preloadData.shortFileName);
  };

  // ERREUR DE PRELOADING
  J.loadingError = function (errorMsg, fileName) {
    if (vif(M.preloader)) {
      M.preloader.error = errorMsg;
      M.preloader.gotoAndStop(2);
      M.preloader.file = fileName;
    }
    if (client().gameRunning) client().endGame();
    J.fatal('Fichier ' + fileName + ' non trouvé sur le FD', 'loadingError: ' + errorMsg + ' filename=' + fileName);
  };

  // LANCEMENT D'UN PRELOAD — un circuit (un clip à remplir) ou une musique
  J.startPreload = function (obj, fileName, message) {
    J.attachPreloader();

    const p = M.preloadData = {};
    p.obj = obj;
    p.shortFileName = fileName;
    p.fileInfos = client().getFileInfos(fileName);
    p.msg = message;
    p.loadComplete = false;
    p.octets = 0;
    p.total = 0;
    // getBytesTotal / getBytesLoaded : ce que le lecteur rendait de l'objet chargé
    obj.getBytesTotal = () => p.total;
    obj.getBytesLoaded = () => p.octets;

    // La jauge : les octets à mesure qu'ils arrivent (K.telecharger). Le
    // lecteur Flash les rendait par getBytesLoaded / getBytesTotal ; ici ce
    // sont les mêmes, tirés du corps de la réponse.
    const avance = (octets, total) => {
      if (M.preloadData !== p) return;                  // un autre chargement a pris la place
      p.octets = octets;
      p.total = total || p.fileInfos.size || 0;
    };

    if (obj instanceof K.Clip) {
      // MovieClip : la bibliothèque du fichier (data/<nom>.json) prend la
      // place du clip vide, à sa profondeur et sous son nom — c'est ce que
      // loadClip faisait de track.skin et de l'intro.
      const nom = fileName.replace(/\.swf$/i, '');
      K.chargerBiblio(nom, avance).then((biblio) => {
        if (M.preloadData !== p) return;                  // un autre chargement a pris la place
        const parent = obj._parent;
        if (!parent) return;
        const neuf = K.instancier(biblio, 0);
        neuf.$prof = obj.$prof;
        neuf.$visible = obj.$visible;
        neuf.$tickNaissance = K.scene ? K.scene.numeroTick : -1;
        const nomClip = obj._name;
        parent.retirerEnfant(obj);
        parent.insererEnfant(neuf);
        parent.nommer(neuf, nomClip);
        // Le clip chargé hérite du gestionnaire de profondeurs qu'on avait posé
        neuf.depthTable = obj.depthTable; neuf.depthLocks = obj.depthLocks; neuf.depthSteps = obj.depthSteps; neuf.defaultProtectFlag = obj.defaultProtectFlag;
        K.finaliser(neuf, null);
        p.obj = neuf;
        neuf.getBytesTotal = () => p.total;
        neuf.getBytesLoaded = () => p.octets;
        p.total = p.total || p.fileInfos.size || 100000;
        p.octets = p.total;
        J.eventOnLoadComplete(neuf);
      }).catch((e) => { console.error('[bkiwi] chargement', fileName, e); J.eventOnLoadError(fileName, 'URLNotFound'); });
    } else {
      // Objet son : le MP3 est décodé, puis attaché au Sound
      const nom = fileName.replace(/\.mp3$/i, '');
      obj.attachSound(nom);
      K.audio.charger(nom, p.fileInfos.name, avance).then((buf) => {
        if (M.preloadData !== p) return;
        p.total = p.total || p.fileInfos.size || 100000;
        p.octets = p.total;
        if (typeof obj.onLoad === 'function') obj.onLoad(!!buf);
      });
    }
  };

  // ATTACHE LE PRELOADER
  J.attachPreloader = function () {
    rm(M.preloader);
    const d = M.calcDepth(M.DP_PRELOAD);
    M.attachMovie('preloader', 'preloader', d);
    M.preloader._x = M.preloaderX;
    M.preloader._y = M.preloaderY;
    M.preloader.gotoAndStop(1);
    M.preloader.txt = '...RECHERCHE';
    M.timeoutPreload = M.baseTimeOut;
    for (let i = 0; i < M.nbPreloadIcons; i++) M.preloader['k_' + i].gotoAndStop(1);
  };
  J.initPreloader = function () { /* le MovieClipLoader : porté par startPreload */ };

  // ═══════════════════════════ main.as ═══════════════════════════

  // BOUCLE MAIN
  J.main = function () {
    // Timer de secours
    J.mainTimer(M);

    // Gestion du FPS
    M.updateFPS += G.gtmod;
    if (M.updateFPS > 6) {
      M.FPS = Math.floor(M.normalFPS / G.gtmod);
      M.updateFPS = 0;
    }

    if (!M.fl_allowReset) client().reseting = false;

    // Exécute le bon init dès le changement de phase de jeu
    if (client().reseting || M.previousPhase != M.vs.mainPhase) {             // eslint-disable-line eqeqeq
      J.vsCheckAll();
      // Reset
      if (client().reseting) {
        J.cleanAll();
        client().reseting = false;
        M.vs.mainPhase = 0;
        J.playSoundBK('gameOverSound');
        if (M.musicON) {
          J.stopMusic(M.musicGame);
          J.stopMusic(M.musicMenu);
          J.startMusic(M.musicMenu);
        }
      }
      if (M.previousPhase != 3 && M.previousPhase != 4) J.cleanAll();         // eslint-disable-line eqeqeq

      switch (M.vs.mainPhase) {
        case 0: J.initMenu(); break;
        case 1: J.initGame(); break;
        case 2: J.initFinal(); break;
        case 3:
          J.initGrid();
          J.initTrackLoader(M.vs.selectedTrack);
          break;
        case 4:
          J.initGrid();
          if (M.musicON) {
            if (M.vs.gameMode == M.TUTORIAL) M.musicGame = J.initMusicLoader(M.musicGameMC, 1);   // eslint-disable-line eqeqeq
            else M.musicGame = J.initMusicLoader(M.musicGameMC, M.vs.selectedTrack);
          }
          break;
        default: break;
      }
      M.previousPhase = M.vs.mainPhase;
    }

    // Exécute le bon main()
    switch (M.vs.mainPhase) {
      case 0: J.mainMenu(); break;
      case 1: J.mainGame(); break;
      case 2: J.mainFinal(); break;
      case 3:
        J.animGrid();
        J.mainTrackLoader();
        break;
      case 4:
        J.animGrid();
        if (J.mainMusicLoader()) M.vs.mainPhase = 1;
        break;
      default: break;
    }
  };

  // INITIALISATION
  J.init = function () {
    M.client = J.client;
    gdebug('Build: ' + M.buildVersion);

    // Var secure (vsInit et vsSecureAll n'existent pas : rien)
    M.vs = {};
    M.vs.$ws = false;
    M.vs.$wss = false;
    M.vs.$wc = false;
    M.vs.$wcs = false;
    M.vs.selectedTrack = 0;
    M.vs.selectedCar = 2;
    M.vs.selectedAdv = 0;
    M.vs.useSpecials = false;
    M.vs.pauseDuration = 0;
    M.vs.menuPhase = 0;
    M.vs.mainPhase = 0;
    M.vs.finalPhase = 0;
    M.vs.gameMode = 0;
    M.vs.giveUp = false;
    M.vs.startBoost = 0;

    // Traductions des touches
    J.initKeyNames(M, 'fr');

    // Variables diverses
    M.previousPhase = -1;
    M.fl_allowReset = false;

    // Depths
    M.initDepth(40, 150);

    // Timer « de secours »
    J.initTimer(M, M.normalFPS);
    M.updateFPS = 0;

    J.initPreloader();
    J.initSounds();

    // Qualité
    M.qualitySetting = M.HIGH;

    // Sons
    M.createEmptyMovieClip('soundMC', M.calcDepth(M.DP_SOUNDS));
    J.forceSoundMC(M.soundMC);

    // Fruticard
    J.initFrutiCard();
  };
};

})(typeof window !== 'undefined' ? window : globalThis);
