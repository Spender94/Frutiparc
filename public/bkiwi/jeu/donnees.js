/*
 * Burning Kiwi — les DONNÉES (Games/burningKiwi/inc/gameData.as), posées sur
 * le clip principal comme le fichier les pose sur son scénario : les
 * profondeurs (DP_*, dans l'ordre du c++ — DP_FXTOP est assigné deux fois,
 * il vaut 13), les modes, les constantes de la physique (roadFriction 0,99,
 * stepMax 9, borderMaxSpeed 3, borderMaxAccelSpeed 1,5, baseNitroTimer 60,
 * nitroMaxSpeed 18…), les cinq voitures (carStats : rot, accel, brake,
 * turning, maxSpeed, grip, kiwis, skin) et leurs jauges (staticStats), les
 * six circuits et le square du tutorial (tracks[99]) — points de départ,
 * décors de premier plan, IA, tours, difficulté —, les checkpoints (CP,
 * avec leur tolérance dist, leur maxSpeed où l'IA freine et leur
 * distanceCheckFactor), la carte des kiwis du Kiwi-Run, les codes spéciaux.
 *
 * Ce fichier est ENGENDRÉ du source par scripts/gen-bkiwi-donnees.js (le
 * gameData.as s'évalue tel quel), et vérifié contre le bytecode du SWF :
 * les 218 checkpoints y sont, au pixel près. Une seule valeur diffère du
 * source, et c'est celle du fichier compilé qu'on garde : demoLabel, le
 * libellé du refus, « PAS ENCORE DEBLOQUE » (le source dit « JEU COMPLET
 * UNIQUEMENT »).
 */
'use strict';

(function (racine) {

const J = racine.BkiwiJeu = racine.BkiwiJeu || {};

J.initialiserDonnees = function (M) {
  M.DP_GRID = 0;
  M.DP_BG = 1;
  M.DP_TRACK = 2;
  M.DP_SHADOWS = 3;
  M.DP_FX = 4;
  M.DP_CARS = 5;
  M.DP_KIWIS = 6;
  M.DP_ARROW = 7;
  M.DP_FXTOP = 13;
  M.DP_TRACKTOP = 9;
  M.DP_FXBG = 10;
  M.DP_MENU = 11;
  M.DP_INTERF = 12;
  M.DP_SPECIALSBOX = 14;
  M.DP_PRELOAD = 15;
  M.DP_DEBUG = 16;
  M.DP_SOUNDS = 17;
  M.FRUTICUP = 0;
  M.ARCADE = 1;
  M.DUEL = 2;
  M.TIMETRIAL = 3;
  M.KIWIRUN = 4;
  M.TUTORIAL = 5;
  M.SURVIVOR = 6;
  M.GHOSTRUN = 7;
  M.TRAINING = 8;
  M.SLOTVERSION = "1.8";
  M.baseTimeOut = 50;
  M.SLOT_PUBLIC = 0;
  M.SLOT_PREFS = 1;
  M.SLOT_MODES = 2;
  M.controlNames = ["Accélérer", "Freiner", "Tourner à gauche", "Tourner à droite", "Kiwi-Boost"];
  M.controls = new Array(5);
  M.defaultControls = [38, 17, 37, 39, 32];
  M.cars = [];
  M.carShadows = [];
  M.maxSpeed = 7;
  M.orderList = [];
  M.orderFinal = [];
  M.shadowShift = 2;
  M.ghostAlpha = 20;
  M.maxIAKiwis = 2;
  M.buttons = [];
  M.limitedPopUpDuration = 30;
  M.demoLabel = "PAS ENCORE DEBLOQUE";
  M.carsLabel = "PROTOTYPE INACCESSIBLE";
  M.modeLabel = "FRUTICOUPE NECESSAIRE";
  M.skinAllow = 1;
  M.skinDisallow = 4;
  M.docWidth = 350;
  M.docHeight = 350;
  M.seuilFumeeAccel = 8;
  M.borderFriction = 0.65;
  M.borderFrictionSteps = 0.5;
  M.borderMaxSpeed = 3;
  M.borderMaxAccelSpeed = 1.5;
  M.roadFriction = 0.99;
  M.stepMax = 9;
  M.delaiFin = 140;
  M.baseNitroTimer = 60;
  M.survivorLives = 3;
  M.baseImmuneHit = 10;
  M.optimalStartSpeed = 8;
  M.superStartMaxGap = 1;
  M.popUpDuration = 85;
  M.arrowBorderMargin = 50;
  M.timeLinesY = 3;
  M.timeLinesHeight = 17;
  M.preloaderX = 175;
  M.preloaderY = 205;
  M.normalFPS = 32;
  M.LOW = 0;
  M.MEDIUM = 1;
  M.HIGH = 2;
  M.AUTO = 3;
  M.baseCheckFPS = 40;
  M.qualitySteps = [0, 16, 20];
  M.kmhFact = 10;
  M.fx = [];
  M.bgFx = [];
  M.nbBgFx = 6;
  M.trackTopItems = [];
  M.duelTrack = 3;
  M.distanceCP = 235;
  M.distanceCPIA = 30;
  M.carStats = [
    { rot: 8.2, accel: 1.4, brake: 0.93, turning: 0.992, maxSpeed: 16.2, grip: 0.35, kiwis: 2, skin: 1 }, // 0
    { rot: 8.75, accel: 1.8, brake: 0.95, turning: 0.99, maxSpeed: 13, grip: 0.36, kiwis: 4, skin: 2 }, // 1
    { rot: 9, accel: 1.5, brake: 0.95, turning: 0.98, maxSpeed: 10, grip: 0.7, kiwis: 4, skin: 3 }, // 2
    { rot: 8.6, accel: 1, brake: 0.95, turning: 0.98, maxSpeed: 14, grip: 0.55, kiwis: 4, skin: 4 }, // 3
    { rot: 8.9, accel: 1.7, brake: 0.93, turning: 0.98, maxSpeed: 12, grip: 0.34, kiwis: 7, skin: 5 }, // 4
  ];
  M.staticStats = [
    { maxSpeed: 1, accel: 0.4, grip: 0.3, rot: 0.2 }, // 0
    { maxSpeed: 0.65, accel: 1, grip: 0.4, rot: 0.6 }, // 1
    { maxSpeed: 0.3, accel: 0.8, grip: 1, rot: 1 }, // 2
    { maxSpeed: 0.8, accel: 0.2, grip: 0.7, rot: 0.4 }, // 3
    { maxSpeed: 0.5, accel: 0.6, grip: 0.3, rot: 0.8 }, // 4
  ];
  M.nitroMaxSpeed = 18;
  M.nitroMaxSpeedIA = 20;
  M.maxKiwis = 7;
  M.carSkinNames = (function () {
    const a = ["Ultra Orange", "UWE Wing", "Fury Hun", "Sonic Brain", "KiwiX"];
    a[20] = "OrangiX";
    a[21] = "UWE Wing II";
    a[22] = "Crazy Hun";
    a[23] = "SuperSonic";
    a[24] = "Final KiwiX";
    a[40] = "UltraCop";
    return a;
  })();
  M.nbTracks = 6;
  M.tracks = (function () {
    const a = [
      {
        startPoints: [
          { id: 0, x: 414, y: 670, ang: -70 },
          { id: 1, x: 390, y: 670, ang: -70 },
          { id: 2, x: 440, y: 670, ang: -70 },
          { id: 3, x: 420, y: 620, ang: -70 }
        ],
        topItems: [
          { id: "tubeYellow", x: 460, y: 556, ang: 23 },
          { id: "tubeGreen", x: 1349, y: 1112, ang: 73 },
          { id: "tubeGreen", x: 1491, y: 1044, ang: 57 },
          { id: "tubeGreen", x: 1602, y: 941, ang: 40 }
        ],
        carStatsIA: { rot: 13, accel: 1.1, brake: 0.94, turning: 0.99, maxSpeed: 16, grip: 0.15, skin: -1 },
        totalLaps: 3,
        difficulty: 0.87,
        title: "Green Hill",
        summary: "Pilote Frutiz, faites chauffer les kiwis ! La route de Green Hill est réputée pour sa vitesse excessive..."
      }, // 0
      {
        startPoints: [
          { id: 0, x: 446, y: 1201, ang: 82 },
          { id: 1, x: 443, y: 1252, ang: 73 },
          { id: 2, x: 489, y: 1246, ang: 73 },
          { id: 3, x: 402, y: 1257, ang: 73 }
        ],
        topItems: [
          { id: "tunnelLargeGray", x: 1936, y: 560, ang: 33.1 }
        ],
        carStatsIA: { rot: 13, accel: 1, brake: 0.94, turning: 0.99, maxSpeed: 14, grip: 0.15, skin: -1 },
        totalLaps: 2,
        difficulty: 0.77,
        title: "Banana Derby",
        summary: "La légende dit que le concepteur de Banana Derby est interné dans un hôpital psychatrique... Allez savoir pourquoi !"
      }, // 1
      {
        startPoints: [
          { id: 0, x: 1369, y: 1312, ang: -44 },
          { id: 1, x: 1399, y: 1281, ang: -52 },
          { id: 2, x: 1375, y: 1255, ang: -49 },
          { id: 3, x: 1436, y: 1316, ang: -51 }
        ],
        topItems: [],
        carStatsIA: { rot: 13, accel: 1, brake: 0.94, turning: 0.99, maxSpeed: 14, grip: 0.15, skin: -1 },
        totalLaps: 2,
        difficulty: 0.75,
        title: "Terre Grise",
        summary: "Les forêts de Terre Grise sont le domaine des Noisettines. Mais pas le temps de s'arrêter, le podium vous attend !"
      }, // 2
      {
        startPoints: [
          { id: 0, x: 880, y: 274, ang: -165 },
          { id: 1, x: 859, y: 234, ang: -165 },
          { id: 2, x: 850, y: 274, ang: -165 },
          { id: 3, x: 830, y: 300, ang: -165 }
        ],
        topItems: [
          { id: "tubeWhite", x: 395, y: 464, ang: 6 }, // 0
          { id: "tubeBlue", x: 372, y: 1234, ang: 4 }, // 1
          { id: "tubeWhite", x: 560, y: 1556, ang: -68 }, // 2
          { id: "tubeWhite", x: 822, y: 1561, ang: -106 }, // 3
          { id: "tunnelGray", x: 1122, y: 808, ang: 0 }, // 4
        ],
        carStatsIA: { rot: 13, accel: 1, brake: 0.94, turning: 0.99, maxSpeed: 15, grip: 0.15, skin: -1 },
        totalLaps: 4,
        difficulty: 0.8,
        title: "Solstice",
        summary: "Le froid de Solstice ne vous epargnera pas, alors sortez les moufles et mettez les kiwis bien au chaud !"
      }, // 3
      {
        startPoints: [
          { id: 0, x: 2171, y: 1605, ang: -90 },
          { id: 1, x: 2133, y: 1559, ang: -90 },
          { id: 2, x: 2175, y: 1559, ang: -90 },
          { id: 3, x: 2209, y: 1559, ang: -90 }
        ],
        topItems: [
          { id: "kiwixLab", x: 1072, y: 1588, ang: 0 },
          { id: "elecLine01", x: 1641, y: 1142, ang: 0 },
          { id: "elecLine02", x: 1859, y: 886, ang: 0 },
          { id: "elecLine03", x: 1032, y: 530, ang: 0 }
        ],
        carStatsIA: { rot: 13, accel: 1, brake: 0.94, turning: 0.99, maxSpeed: 15, grip: 0.15, skin: -1 },
        totalLaps: 3,
        difficulty: 0.765,
        title: "Jupiter IV",
        summary: "Embarquement immédiat pour la colonnie de l'asteroïde Jupiter IV, dans la constellation du Kiwi !"
      }, // 4
      {
        startPoints: [
          { id: 0, x: 1048, y: 631, ang: -180 },
          { id: 1, x: 986, y: 584, ang: -180 },
          { id: 2, x: 986, y: 630, ang: -180 },
          { id: 3, x: 986, y: 665, ang: -180 }
        ],
        topItems: [
          { id: "bigorneau", x: 1534, y: 860, ang: 0 }
        ],
        carStatsIA: { rot: 13, accel: 1, brake: 0.94, turning: 0.99, maxSpeed: 16.5, grip: 0.15, skin: -1 },
        totalLaps: 3,
        difficulty: 0.8,
        title: "Mistral kiwi",
        summary: "Dernière ligne droite avant la consécration ! Soleil, bonne humeur et sorbet kiwi sont au bout de la route !"
      }, // 5
    ];
    a[99] = {
      startPoints: [
        { id: 0, x: 982, y: 1170, ang: 165 },
        { id: 1, x: 982, y: 1170, ang: 165 },
        { id: 2, x: 982, y: 1170, ang: 165 },
        { id: 3, x: 982, y: 1170, ang: 165 }
      ],
      topItems: undefined,
      carStatsIA: { rot: 13, accel: 1, brake: 0.94, turning: 0.99, maxSpeed: 15, grip: 0.15, skin: -1 },
      totalLaps: 3,
      difficulty: 0.7,
      title: "Le square",
      summary: "Profitez pleinement de cette piste privée pour tester votre véhicule !"
    };
    return a;
  })();
  M.specials = [
    { chaine: "--NULL--", pos: 0, state: false }, // 0
    { chaine: "BOOST", pos: 0, state: false }, // 1
    { chaine: "DRONE", pos: 0, state: false }, // 2
    { chaine: "GHOST", pos: 0, state: false }, // 3
    { chaine: "PROTO", pos: 0, state: false }, // 4
    { chaine: "GTA", pos: 0, state: false }, // 5
    { chaine: "NIGHT", pos: 0, state: false }, // 6
  ];
  M.specialsUsed = undefined;
  M.NIGHT_LUM = -70;
  M.CP = (function () {
    const a = [
      [
        { x: 454, y: 592, ang: -68, dist: 50, maxSpeed: 99 }, // 0
        { x: 535, y: 386, ang: -61, dist: 45, maxSpeed: 99 }, // 1
        { x: 675, y: 180, ang: -31, dist: 23, maxSpeed: 9 }, // 2
        { x: 814, y: 214, ang: 37, dist: 18, maxSpeed: 99 }, // 3
        { x: 885, y: 416, ang: 76, dist: 44, maxSpeed: 99 }, // 4
        { x: 919, y: 690, ang: 77, dist: 35, maxSpeed: 11 }, // 5
        { x: 1018, y: 789, ang: 35, dist: 0, maxSpeed: 9 }, // 6
        { x: 1084, y: 803, ang: -11, dist: 13, maxSpeed: 5 }, // 7
        { x: 1144, y: 772, ang: -57, dist: 24, maxSpeed: 7 }, // 8
        { x: 1255, y: 591, ang: -76, dist: 53, maxSpeed: 99 }, // 9
        { x: 1330, y: 337, ang: -53, dist: 37, maxSpeed: 8 }, // 10
        { x: 1423, y: 280, ang: 5, dist: 27, maxSpeed: 6 }, // 11
        { x: 1574, y: 372, ang: 57, dist: 33, maxSpeed: 9 }, // 12
        { x: 1697, y: 663, ang: 90, dist: 54, maxSpeed: 99 }, // 13
        { x: 1601, y: 941, ang: 127, dist: 42, maxSpeed: 99 }, // 14
        { x: 1471, y: 1056, ang: 143, dist: 44, maxSpeed: 99 }, // 15
        { x: 1293, y: 1141, ang: 164, dist: 53, maxSpeed: 99 }, // 16
        { x: 1122, y: 1165, ang: 177, dist: 54, maxSpeed: 99 }, // 17
        { x: 824, y: 1169, ang: -177, dist: 50, maxSpeed: 99 }, // 18
        { x: 435, y: 1098, ang: -132, dist: 31, maxSpeed: 11 }, // 19
        { x: 389, y: 937, ang: -101, dist: 13, maxSpeed: 9 }, // 20
        { x: 396, y: 819, ang: -83, dist: 17, maxSpeed: 99 }, // 21
      ],
      [
        { x: 529, y: 1552, ang: 61, dist: 22, maxSpeed: 99 }, // 0
        { x: 666, y: 1768, ang: 54, dist: 63, maxSpeed: 99 }, // 1
        { x: 813, y: 1962, ang: 42, dist: 66, maxSpeed: 99 }, // 2
        { x: 1015, y: 2241, ang: 56, dist: 30, maxSpeed: 99 }, // 3
        { x: 1183, y: 2439, ang: 33, dist: 38, maxSpeed: 99, distanceCheckFactor: 1.2 }, // 4
        { x: 1455, y: 2578, ang: 6, dist: 45, maxSpeed: 99 }, // 5
        { x: 1812, y: 2595, ang: -1, dist: 43, maxSpeed: 99 }, // 6
        { x: 2203, y: 2576, ang: -21, dist: 28, maxSpeed: 99 }, // 7
        { x: 2395, y: 2527, ang: -59, dist: 31, maxSpeed: 12, distanceCheckFactor: 1.2 }, // 8
        { x: 2463, y: 2378, ang: -83, dist: 48, maxSpeed: 99 }, // 9
        { x: 2426, y: 2077, ang: -95, dist: 27, maxSpeed: 99, distanceCheckFactor: 2 }, // 10
        { x: 2427, y: 1968, ang: -64, dist: 0, maxSpeed: 10, distanceCheckFactor: 2 }, // 11
        { x: 2625, y: 1706, ang: -141, dist: 0, maxSpeed: 9, distanceCheckFactor: 3.5 }, // 12
        { x: 2577, y: 1410, ang: -118, dist: 35, maxSpeed: 8, distanceCheckFactor: 2 }, // 13
        { x: 2457, y: 1203, ang: -100, dist: 21, maxSpeed: 9, distanceCheckFactor: 2.2 }, // 14
        { x: 2450, y: 1090, ang: -90, dist: 0, maxSpeed: 99, distanceCheckFactor: 2 }, // 15
        { x: 2490, y: 880, ang: -91, dist: 24, maxSpeed: 99, distanceCheckFactor: 2 }, // 16
        { x: 2469, y: 735, ang: -96, dist: 40, maxSpeed: 99 }, // 17
        { x: 2465, y: 504, ang: -96, dist: 55, maxSpeed: 12 }, // 18
        { x: 2395, y: 307, ang: 175, dist: 24, maxSpeed: 10 }, // 19
        { x: 2173, y: 305, ang: 148, dist: 41, maxSpeed: 99 }, // 20
        { x: 1910, y: 594, ang: 137, dist: 43, maxSpeed: 99 }, // 21
        { x: 1724, y: 1020, ang: 73, dist: 28, maxSpeed: 99 }, // 22
        { x: 1848, y: 1331, ang: 71, dist: 28, maxSpeed: 99, distanceCheckFactor: 1.2 }, // 23
        { x: 1780, y: 1732, ang: 98, dist: 35, maxSpeed: 14 }, // 24
        { x: 1844, y: 2030, ang: 23, dist: 31, maxSpeed: 8 }, // 25
        { x: 1967, y: 2032, ang: -31, dist: 36, maxSpeed: 10 }, // 26
        { x: 2095, y: 1902, ang: -71, dist: 36, maxSpeed: 99 }, // 27
        { x: 2144, y: 1629, ang: -88, dist: 40, maxSpeed: 99 }, // 28
        { x: 2093, y: 1253, ang: -100, dist: 22, maxSpeed: 99 }, // 29
        { x: 1913, y: 1126, ang: -168, dist: 15, maxSpeed: 13 }, // 30
        { x: 1720, y: 1171, ang: 148, dist: 48, maxSpeed: 99, distanceCheckFactor: 1.2 }, // 31
        { x: 1619, y: 1239, ang: 137, dist: 16, maxSpeed: 99 }, // 32
        { x: 1475, y: 1511, ang: 106, dist: 45, maxSpeed: 99 }, // 33
        { x: 1342, y: 1938, ang: 82, dist: 30, maxSpeed: 10, distanceCheckFactor: 1.2 }, // 34
        { x: 1389, y: 2134, ang: 114, dist: 22, maxSpeed: 11, distanceCheckFactor: 1.2 }, // 35
        { x: 1257, y: 2299, ang: 131, dist: 45, maxSpeed: 99 }, // 36
        { x: 1065, y: 2458, ang: 143, dist: 15, maxSpeed: 99 }, // 37
        { x: 823, y: 2549, ang: 174, dist: 19, maxSpeed: 12, distanceCheckFactor: 1.2 }, // 38
        { x: 688, y: 2448, ang: -86, dist: 0, maxSpeed: 8, distanceCheckFactor: 1.5 }, // 39
        { x: 689, y: 2335, ang: -70, dist: 0, maxSpeed: 12, distanceCheckFactor: 1.5 }, // 40
        { x: 763, y: 2171, ang: -63, dist: 28, maxSpeed: 99 }, // 41
        { x: 967, y: 1973, ang: -39, dist: 43, maxSpeed: 99 }, // 42
        { x: 1169, y: 1676, ang: -100, dist: 49, maxSpeed: 16, distanceCheckFactor: 1.6 }, // 43
        { x: 1013, y: 1260, ang: -117, dist: 32, maxSpeed: 12, distanceCheckFactor: 1.6 }, // 44
        { x: 989, y: 1112, ang: -59, dist: 30, maxSpeed: 10, distanceCheckFactor: 3 }, // 45
        { x: 1138, y: 983, ang: -24, dist: 16, maxSpeed: 10, distanceCheckFactor: 1.5 }, // 46
        { x: 1339, y: 976, ang: -65, dist: 25, maxSpeed: 14, distanceCheckFactor: 3 }, // 47
        { x: 1317, y: 734, ang: -111, dist: 49, maxSpeed: 99, distanceCheckFactor: 1.6 }, // 48
        { x: 1283, y: 429, ang: -122, dist: 24, maxSpeed: 10, distanceCheckFactor: 1.6 }, // 49
        { x: 1133, y: 404, ang: 162, dist: 63, maxSpeed: 12, distanceCheckFactor: 3 }, // 50
        { x: 862, y: 602, ang: 138, dist: 29, maxSpeed: 12, distanceCheckFactor: 4 }, // 51
        { x: 635, y: 807, ang: 127, dist: 17, maxSpeed: 10, distanceCheckFactor: 3 }, // 52
        { x: 517, y: 1020, ang: 104, dist: 28, maxSpeed: 13, distanceCheckFactor: 2 }, // 53
        { x: 453, y: 1222, ang: 93, dist: 57, maxSpeed: 99, distanceCheckFactor: 1.1 }, // 54
      ],
      [
        { x: 1553, y: 1078, ang: -56, dist: 48, maxSpeed: 99 }, // 0
        { x: 1806, y: 769, ang: -62, dist: 36, maxSpeed: 99 }, // 1
        { x: 1956, y: 501, ang: -81, dist: 19, maxSpeed: 11 }, // 2
        { x: 1946, y: 424, ang: -133, dist: 29, maxSpeed: 8 }, // 3
        { x: 1772, y: 441, ang: 132, dist: 57, maxSpeed: 24 }, // 4
        { x: 1473, y: 735, ang: 143, dist: 23, maxSpeed: 99 }, // 5
        { x: 1242, y: 770, ang: -137, dist: 25, maxSpeed: 12 }, // 6
        { x: 1039, y: 429, ang: -123, dist: 28, maxSpeed: 99 }, // 7
        { x: 883, y: 285, ang: -153, dist: 37, maxSpeed: 99 }, // 8
        { x: 675, y: 318, ang: 162, dist: 14, maxSpeed: 99 }, // 9
        { x: 520, y: 436, ang: 92, dist: 13, maxSpeed: 10 }, // 10
        { x: 576, y: 571, ang: 43, dist: 25, maxSpeed: 99 }, // 11
        { x: 714, y: 688, ang: 70, dist: 12, maxSpeed: 7 }, // 12
        { x: 703, y: 770, ang: 121, dist: 21, maxSpeed: 8 }, // 13
        { x: 623, y: 905, ang: 89, dist: 22, maxSpeed: 10 }, // 14
        { x: 693, y: 1034, ang: 46, dist: 24, maxSpeed: 7 }, // 15
        { x: 708, y: 1088, ang: 77, dist: 8, maxSpeed: 5 }, // 16
        { x: 599, y: 1122, ang: -150, dist: 34, maxSpeed: 99 }, // 17
        { x: 380, y: 1096, ang: 142, dist: 44, maxSpeed: 99 }, // 18
        { x: 265, y: 1333, ang: 81, dist: 70, maxSpeed: 99 }, // 19
        { x: 302, y: 1763, ang: 92, dist: 37, maxSpeed: 99 }, // 20
        { x: 293, y: 2119, ang: 76, dist: 41, maxSpeed: 99 }, // 21
        { x: 507, y: 2430, ang: 23, dist: 40, maxSpeed: 99 }, // 22
        { x: 1010, y: 2509, ang: 2, dist: 27, maxSpeed: 99 }, // 23
        { x: 1634, y: 2490, ang: -3, dist: 47, maxSpeed: 99 }, // 24
        { x: 2119, y: 2428, ang: -38, dist: 29, maxSpeed: 99 }, // 25
        { x: 2220, y: 2290, ang: -75, dist: 20, maxSpeed: 99 }, // 26
        { x: 2278, y: 2066, ang: -87, dist: 22, maxSpeed: 99 }, // 27
        { x: 2281, y: 1820, ang: -125, dist: 0, maxSpeed: 99 }, // 28
        { x: 2217, y: 1692, ang: -135, dist: 52, maxSpeed: 99 }, // 29
        { x: 2114, y: 1417, ang: -92, dist: 32, maxSpeed: 99 }, // 30
        { x: 2135, y: 1121, ang: -88, dist: 27, maxSpeed: 99 }, // 31
        { x: 2146, y: 780, ang: -84, dist: 0, maxSpeed: 13 }, // 32
        { x: 2199, y: 700, ang: -60, dist: 0, maxSpeed: 7 }, // 33
        { x: 2277, y: 765, ang: 76, dist: 18, maxSpeed: 10 }, // 34
        { x: 2271, y: 979, ang: 88, dist: 16, maxSpeed: 99 }, // 35
        { x: 2280, y: 1252, ang: 88, dist: 26, maxSpeed: 99 }, // 36
        { x: 2243, y: 1592, ang: 110, dist: 45, maxSpeed: 99 }, // 37
        { x: 2128, y: 1732, ang: 129, dist: 38, maxSpeed: 99 }, // 38
        { x: 1839, y: 2011, ang: 144, dist: 22, maxSpeed: 99 }, // 39
        { x: 1616, y: 2141, ang: 169, dist: 2, maxSpeed: 99 }, // 40
        { x: 1064, y: 2201, ang: 179, dist: 55, maxSpeed: 99 }, // 41
        { x: 703, y: 2149, ang: -168, dist: 23, maxSpeed: 99 }, // 42
        { x: 583, y: 1995, ang: -79, dist: 46, maxSpeed: 99 }, // 43
        { x: 616, y: 1862, ang: -30, dist: 19, maxSpeed: 12 }, // 44
        { x: 722, y: 1789, ang: -38, dist: 18, maxSpeed: 99 }, // 45
        { x: 1001, y: 1556, ang: -31, dist: 63, maxSpeed: 99 }, // 46
        { x: 1337, y: 1338, ang: -43, dist: 53, maxSpeed: 99 }, // 47
      ],
      [
        { x: 756, y: 258, ang: 178, dist: 42, maxSpeed: 99 }, // 0
        { x: 622, y: 277, ang: 169, dist: 40, maxSpeed: 99 }, // 1
        { x: 415, y: 396, ang: 124, dist: 38, maxSpeed: 99 }, // 2
        { x: 439, y: 609, ang: 74, dist: 23, maxSpeed: 99 }, // 3
        { x: 517, y: 715, ang: 55, dist: 11, maxSpeed: 99 }, // 4
        { x: 623, y: 889, ang: 88, dist: 30, maxSpeed: 99 }, // 5
        { x: 603, y: 1066, ang: 117, dist: 36, maxSpeed: 10 }, // 6
        { x: 487, y: 1138, ang: -159, dist: 39, maxSpeed: 8 }, // 7
        { x: 302, y: 1096, ang: -169, dist: 49, maxSpeed: 11 }, // 8
        { x: 223, y: 1012, ang: -100, dist: 37, maxSpeed: 9 }, // 9
        { x: 247, y: 871, ang: -47, dist: 22, maxSpeed: 7 }, // 10
        { x: 345, y: 843, ang: 15, dist: 21, maxSpeed: 9 }, // 11
        { x: 417, y: 935, ang: 92, dist: 34, maxSpeed: 99 }, // 12
        { x: 390, y: 1129, ang: 97, dist: 48, maxSpeed: 99 }, // 13
        { x: 381, y: 1319, ang: 85, dist: 45, maxSpeed: 99 }, // 14
        { x: 498, y: 1500, ang: 36, dist: 36, maxSpeed: 99 }, // 15
        { x: 708, y: 1583, ang: -14, dist: 38, maxSpeed: 99 }, // 16
        { x: 903, y: 1510, ang: -40, dist: 38, maxSpeed: 99 }, // 17
        { x: 1033, y: 1378, ang: -54, dist: 24, maxSpeed: 99 }, // 18
        { x: 1111, y: 1212, ang: -78, dist: 25, maxSpeed: 99 }, // 19
        { x: 1128, y: 974, ang: -88, dist: 18, maxSpeed: 99 }, // 20
        { x: 1123, y: 782, ang: -95, dist: 14, maxSpeed: 99 }, // 21
        { x: 1096, y: 648, ang: -131, dist: 13, maxSpeed: 7 }, // 22
        { x: 1006, y: 619, ang: 145, dist: 30, maxSpeed: 7 }, // 23
        { x: 898, y: 633, ang: -125, dist: 19, maxSpeed: 5 }, // 24
        { x: 879, y: 575, ang: -71, dist: 24, maxSpeed: 6 }, // 25
        { x: 920, y: 491, ang: -51, dist: 25, maxSpeed: 99 }, // 26
        { x: 964, y: 385, ang: -85, dist: 20, maxSpeed: 99 }, // 27
        { x: 879, y: 278, ang: -168, dist: 35, maxSpeed: 11 }, // 28
      ],
      [
        { x: 2176, y: 1149, ang: -94, dist: 66, maxSpeed: 99, distanceCheckFactor: 1.2 }, // 0
        { x: 2110, y: 981, ang: -139, dist: 35, maxSpeed: 99, distanceCheckFactor: 1.3 }, // 1
        { x: 1799, y: 968, ang: 160, dist: 21, maxSpeed: 12, distanceCheckFactor: 1.2 }, // 2
        { x: 1707, y: 1021, ang: 113, dist: 25, maxSpeed: 7, distanceCheckFactor: 1.3 }, // 3
        { x: 1581, y: 1276, ang: 136, dist: 20, maxSpeed: 99, distanceCheckFactor: 1.3 }, // 4
        { x: 1337, y: 1321, ang: -177, dist: 41, maxSpeed: 99 }, // 5
        { x: 1186, y: 1284, ang: -117, dist: 31, maxSpeed: 10, distanceCheckFactor: 1.3 }, // 6
        { x: 1126, y: 994, ang: -74, dist: 27, maxSpeed: 99 }, // 7
        { x: 1258, y: 810, ang: -49, dist: 24, maxSpeed: 99, distanceCheckFactor: 1.1 }, // 8
        { x: 1320, y: 703, ang: -79, dist: 20, maxSpeed: 10, distanceCheckFactor: 1.3 }, // 9
        { x: 1311, y: 602, ang: -131, dist: 22, maxSpeed: 7, distanceCheckFactor: 1.3 }, // 10
        { x: 1097, y: 575, ang: -168, dist: 40, maxSpeed: 99, distanceCheckFactor: 1.2 }, // 11
        { x: 805, y: 553, ang: 174, dist: 18, maxSpeed: 11 }, // 12
        { x: 700, y: 636, ang: 109, dist: 21, maxSpeed: 7, distanceCheckFactor: 1.3 }, // 13
        { x: 643, y: 1018, ang: 121, dist: 37, maxSpeed: 13 }, // 14
        { x: 573, y: 1109, ang: 140, dist: 12, maxSpeed: 8, distanceCheckFactor: 1.5 }, // 15
        { x: 424, y: 1171, ang: 176, dist: 38, maxSpeed: 99, distanceCheckFactor: 1.1 }, // 16
        { x: 327, y: 1261, ang: 119, dist: 53, maxSpeed: 10, distanceCheckFactor: 1.2 }, // 17
        { x: 343, y: 1505, ang: 30, dist: 44, maxSpeed: 11, distanceCheckFactor: 1.1 }, // 18
        { x: 543, y: 1572, ang: 14, dist: 18, maxSpeed: 14, distanceCheckFactor: 1.3 }, // 19
        { x: 625, y: 1608, ang: 55, dist: 0, maxSpeed: 9, distanceCheckFactor: 1.4 }, // 20
        { x: 668, y: 1743, ang: 48, dist: 25, maxSpeed: 15 }, // 21
        { x: 765, y: 1822, ang: 26, dist: 25, maxSpeed: 99, distanceCheckFactor: 1.2 }, // 22
        { x: 978, y: 1901, ang: 14, dist: 34, maxSpeed: 15, distanceCheckFactor: 1.3 }, // 23
        { x: 1114, y: 1931, ang: -6, dist: 31, maxSpeed: 13, distanceCheckFactor: 1.6 }, // 24
        { x: 1362, y: 1913, ang: -17, dist: 21, maxSpeed: 12, distanceCheckFactor: 1.5 }, // 25
        { x: 1596, y: 1808, ang: 3, dist: 29, maxSpeed: 12, distanceCheckFactor: 1.6 }, // 26
        { x: 1868, y: 1834, ang: 9, dist: 13, maxSpeed: 99, distanceCheckFactor: 1.5 }, // 27
        { x: 2018, y: 1841, ang: -17, dist: 25, maxSpeed: 14, distanceCheckFactor: 1.1 }, // 28
        { x: 2103, y: 1815, ang: -56, dist: 14, maxSpeed: 12, distanceCheckFactor: 1.5 }, // 29
        { x: 2145, y: 1622, ang: -83, dist: 25, maxSpeed: 99, distanceCheckFactor: 1.1 }, // 30
      ],
      [
        { x: 737, y: 652, ang: 165, dist: 56, maxSpeed: 99 }, // 0
        { x: 573, y: 722, ang: 149, dist: 40, maxSpeed: 99 }, // 1
        { x: 439, y: 932, ang: 100, dist: 43, maxSpeed: 99 }, // 2
        { x: 504, y: 1144, ang: 55, dist: 38, maxSpeed: 99 }, // 3
        { x: 668, y: 1351, ang: 68, dist: 24, maxSpeed: 8 }, // 4
        { x: 650, y: 1487, ang: 110, dist: 29, maxSpeed: 10 }, // 5
        { x: 607, y: 1737, ang: 81, dist: 19, maxSpeed: 13 }, // 6
        { x: 647, y: 1922, ang: 52, dist: 26, maxSpeed: 99 }, // 7
        { x: 934, y: 2054, ang: -3, dist: 61, maxSpeed: 99 }, // 8
        { x: 1141, y: 1862, ang: -79, dist: 27, maxSpeed: 99 }, // 9
        { x: 1167, y: 1478, ang: -82, dist: 27, maxSpeed: 99 }, // 10
        { x: 1234, y: 1305, ang: -13, dist: 33, maxSpeed: 7 }, // 11
        { x: 1374, y: 1413, ang: 70, dist: 36, maxSpeed: 99 }, // 12
        { x: 1533, y: 1600, ang: 37, dist: 20, maxSpeed: 11 }, // 13
        { x: 1675, y: 1629, ang: -25, dist: 25, maxSpeed: 9 }, // 14
        { x: 1778, y: 1546, ang: -60, dist: 27, maxSpeed: 99 }, // 15
        { x: 1785, y: 1293, ang: -121, dist: 51, maxSpeed: 99 }, // 16
        { x: 1539, y: 993, ang: -136, dist: 19, maxSpeed: 13 }, // 17
        { x: 1469, y: 845, ang: -69, dist: 28, maxSpeed: 7 }, // 18
        { x: 1622, y: 752, ang: -1, dist: 34, maxSpeed: 99 }, // 19
        { x: 1780, y: 680, ang: -44, dist: 21, maxSpeed: 99 }, // 20
        { x: 1852, y: 594, ang: -77, dist: 32, maxSpeed: 99 }, // 21
        { x: 1803, y: 424, ang: -138, dist: 26, maxSpeed: 99 }, // 22
        { x: 1697, y: 358, ang: -169, dist: 24, maxSpeed: 99 }, // 23
        { x: 1465, y: 352, ang: 155, dist: 30, maxSpeed: 99 }, // 24
        { x: 1279, y: 474, ang: 133, dist: 26, maxSpeed: 99 }, // 25
        { x: 1139, y: 588, ang: 155, dist: 21, maxSpeed: 99 }, // 26
      ]
    ];
    a[99] = [
      { x: 771, y: 1206, ang: -177, dist: 0, maxSpeed: 99, distanceCheckFactor: 1.5 }, // 0
      { x: 318, y: 1103, ang: -115, dist: 0, maxSpeed: 99, distanceCheckFactor: 1.5 }, // 1
      { x: 583, y: 689, ang: -36, dist: 0, maxSpeed: 99, distanceCheckFactor: 1.5 }, // 2
      { x: 1083, y: 360, ang: -11, dist: 0, maxSpeed: 99, distanceCheckFactor: 1.5 }, // 3
      { x: 1225, y: 667, ang: 96, dist: 0, maxSpeed: 99, distanceCheckFactor: 1.5 }, // 4
      { x: 1068, y: 1130, ang: 153, dist: 0, maxSpeed: 99, distanceCheckFactor: 1.5 }, // 5
    ];
    return a;
  })();
  M.kiwiMap = [
    [
      { x: 552, y: 345 }, // 0
      { x: 788, y: 174 }, // 1
      { x: 588, y: 246 }, // 2
      { x: 393, y: 1001 }, // 3
      { x: 971, y: 1134 }, // 4
      { x: 1221, y: 589 }, // 5
      { x: 1650, y: 880 }, // 6
      { x: 1503, y: 1033 }, // 7
      { x: 1303, y: 1136 }, // 8
      { x: 883, y: 491 }, // 9
      { x: 1232, y: 460 }, // 10
      { x: 1721, y: 594 }, // 11
      { x: 446, y: 1176 }, // 12
      { x: 1105, y: 1022 }, // 13
      { x: 478, y: 527 }, // 14
    ]
  ];
};

})(typeof window !== 'undefined' ? window : globalThis);
