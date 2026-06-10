/*
 * Swapou 2 — chargement des assets + audio.
 * Images : bitmaps d'origine servis depuis /games/swapou2 (extraits du .fla).
 * Sons : MP3 extraits du SWF (public/swapou/sounds), via WebAudio.
 */
'use strict';

const SwapouAssets = (function () {
  const IMG_BASE = '/games/swapou2/';
  const CHAR_DIRS = ['dimitri', 'natacha', 'salt', 'poivre', 'moutarde', 'piment', 'wasabi'];
  const CHAR_STATES = ['normal', 'panic', 'bad', 'fear', 'happy', 'dead'];

  // nom logique → chemin relatif
  const MANIFEST = {
    bg: 'images/bg.jpg',
    bgClassic: 'images/bgClassic.jpg',
    leftPanel: 'images/leftPanel.png',
    leftPanelClassic: 'images/leftPanelClassic.png',
    leftPanelDuel: 'images/leftPanelDuel.png',
    rightPanel: 'images/rightPanel.png',
    rightPanelClassic: 'images/rightPanelClassic.png',
    rightPanelDuel: 'images/rightPanelDuel.png',
    centerPanel: 'images/centerPanel.png',
    centerPanelMask: 'images/centerPanelMask.png',
    sd: 'images/sd.png',
    feuilles: 'images/feuilles.png',
    arrow: 'images/arrow.png',
    box: 'images/box.png',
    netBox: 'images/netBox.png',
    levelBox: 'images/levelBox.png',
    pauseBox: 'images/pauseBox.png',
    versus: 'images/versus.png',
    versusBox: 'images/versusBox.png',
    logo: 'images/logo.png',
    worldMap: 'images/worldMap.png',
    historyChat: 'images/historyChat.png',
    historyAnimBox: 'images/historyAnimBox.png',
    menuPomme: 'images/menuPomme.png',
    menuPoire: 'images/menuPoire.png',
    menuOrange: 'images/menuOrange.png',
    faceTop: 'images/faceTop.png',
    menuFaceTop: 'images/menuFaceTop.png',
    endingWin: 'images/endingWin.png',
    endingLose: 'images/endingLose.png',
    powerAtt: 'images/powerAtt.png',
    powerDef: 'images/powerDef.png',
    powerStar: 'images/powerStar.png',
    comboStar: 'images/comboStar.png',
    fullDimitri: 'character/bitmap/menu/dimitri.png',
    fullNatacha: 'character/bitmap/menu/natacha.png',
    scene6_temple: 'character/bitmap/cinematique/scene6/temple.png',
    scene6_brume: 'character/bitmap/cinematique/scene6/brume.png',
    scene6_poteau: 'character/bitmap/cinematique/scene6/poteau.png',
  };
  // fruits : couleurs 0..10 + variantes des 3 couleurs de base
  const FRUIT_FILES = ['pomme', 'poire', 'orange',
    'classic-04', 'classic-05', 'classic-06', 'classic-07',
    'classic-08', 'classic-09', 'classic-10', 'classic-11'];
  FRUIT_FILES.forEach(function (n, i) { MANIFEST['fruit' + i] = 'images/fruits/' + n + '.png'; });
  ['pomme', 'poire', 'orange'].forEach(function (n, i) {
    MANIFEST['frozen' + i] = 'images/fruits/frozen-' + n + '.png';
    MANIFEST['metal' + i] = 'images/fruits/metal-' + n + '.png';
    MANIFEST['star' + i] = 'images/fruits/star-' + n + '.png';
  });
  // combos (ordre des paliers — déduit des pictos combo_NN.gif)
  const COMBO_IMGS = ['confiture', 'confitureOrange', 'tarte', 'tarteKiwis',
    'tarteCreme', 'tarteCremeOrange', 'tarteOranges', 'eclair', 'eclairExtra',
    'coupeGlace', 'coupeAncestrale'];
  COMBO_IMGS.forEach(function (n, i) { MANIFEST['combo' + i] = 'images/combos/' + n + '.png'; });
  MANIFEST.comboClassic = 'images/combos/classic.png';
  // visages 7 persos × 6 états
  CHAR_DIRS.forEach(function (dir, ci) {
    CHAR_STATES.forEach(function (st, si) {
      MANIFEST['face' + ci + '_' + si] = 'character/bitmap/' + dir + '/' + st + '.png';
    });
  });
  // cinématiques
  for (let i = 1; i <= 9; i++) MANIFEST['scene' + i] = 'character/bitmap/cinematique/scene' + i + '.png';

  const images = {};
  let loadedCount = 0, totalCount = 0;

  function loadImages(onProgress) {
    const names = Object.keys(MANIFEST);
    totalCount = names.length;
    return Promise.all(names.map(function (name) {
      return new Promise(function (resolve) {
        const img = new Image();
        img.onload = img.onerror = function () {
          loadedCount++;
          if (onProgress) onProgress(loadedCount, totalCount);
          resolve();
        };
        img.src = IMG_BASE + MANIFEST[name];
        images[name] = img;
      });
    }));
  }

  function img(name) { return images[name]; }
  function has(name) {
    const i = images[name];
    return !!(i && i.complete && i.naturalWidth > 0);
  }

  // image d'un fruit selon couleur/flags (Fruit.as:updateSkin)
  function fruitImage(f) {
    if ((f.flags & 2) !== 0) return images['metal' + (f.save_t % 3)];   // NOSWAP
    if ((f.flags & 1) !== 0) return images['frozen' + (f.save_t % 3)]; // ARMURE
    if ((f.flags & 4) !== 0) return images['star' + (f.save_t % 3)];   // STAR
    return images['fruit' + f.t];
  }

  // ── Audio (Sounds.as) ─────────────────────────────────────────────────────
  const SND_BASE = 'sounds/';
  const SND_NAMES = ['sound_menu', 'sound_game', 'sound_swap', 'sound_combo',
    'sound_pop1', 'sound_pop2', 'sound_show_score', 'sound_menu_click',
    'sound_menu_activate', 'loop_forest', 'loop_wind', 'loop_fall',
    'loop_bridge', 'loop_swamp', 'loop_night', 'wasabi_cry'];

  let actx = null;
  const buffers = {};
  let soundEnabled = true, musicEnabled = true;
  let musicSource = null, musicGain = null, musicName = null;
  let pendingMusic = null;
  let unlocked = false;

  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { actx = null; return; }
    SND_NAMES.forEach(function (n) {
      fetch(SND_BASE + n + '.mp3').then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return actx.decodeAudioData(ab); })
        .then(function (buf) {
          buffers[n] = buf;
          if (pendingMusic === n) { pendingMusic = null; playMusic(n); }
        }).catch(function () {});
    });
  }

  // à appeler sur la 1re interaction utilisateur (politique autoplay mobile)
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    initAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    if (pendingMusic && buffers[pendingMusic]) { const n = pendingMusic; pendingMusic = null; playMusic(n); }
  }

  function play(name) {
    if (!soundEnabled || !actx || !buffers[name]) return;
    const src = actx.createBufferSource();
    src.buffer = buffers[name];
    src.connect(actx.destination);
    src.start();
  }

  function playMusic(name) {
    if (musicName === name && musicSource) return;
    musicName = name;
    if (!actx || !buffers[name]) { pendingMusic = name; return; }
    stopMusicNow();
    if (!musicEnabled) return;
    musicGain = actx.createGain();
    musicGain.gain.value = 0;
    musicGain.gain.linearRampToValueAtTime(1, actx.currentTime + 1); // fade 1 s
    musicGain.connect(actx.destination);
    musicSource = actx.createBufferSource();
    musicSource.buffer = buffers[name];
    musicSource.loop = true;
    musicSource.connect(musicGain);
    musicSource.start();
  }

  function stopMusicNow() {
    if (musicSource) { try { musicSource.stop(); } catch (e) {} musicSource = null; }
    musicGain = null;
  }
  function stopMusic() { musicName = null; pendingMusic = null; stopMusicNow(); }

  function toggleMusic() {
    musicEnabled = !musicEnabled;
    if (!musicEnabled) stopMusicNow();
    else if (musicName) { const n = musicName; musicName = null; playMusic(n); }
  }
  function toggleSound() { soundEnabled = !soundEnabled; }
  // Client.as : enableSoundMusic(sflag,mflag) inverse puis re-toggle
  function enableSoundMusic(s, m) {
    soundEnabled = !!s;
    if (musicEnabled !== !!m) toggleMusic(); else if (musicEnabled && musicName) { const n = musicName; musicName = null; playMusic(n); }
    musicEnabled = !!m;
    if (!musicEnabled) stopMusicNow();
  }

  return {
    loadImages: loadImages, img: img, has: has, fruitImage: fruitImage,
    unlock: unlock, play: play, playMusic: playMusic, stopMusic: stopMusic,
    toggleMusic: toggleMusic, toggleSound: toggleSound,
    enableSoundMusic: enableSoundMusic,
    soundEnabled: function () { return soundEnabled; },
    musicEnabled: function () { return musicEnabled; },
    // noms standard (Sounds.as)
    MUSIC_MENU: 'sound_menu', MUSIC_CHALLENGE: 'sound_game', MUSIC_DUEL: 'sound_game',
    SWAP: 'sound_swap', COMBO: 'sound_combo', POP1: 'sound_pop1', POP2: 'sound_pop2',
    SHOW_SCORE: 'sound_show_score', MENU_CLICK: 'sound_menu_click',
    MENU_ACTIVATE: 'sound_menu_activate',
  };
})();
