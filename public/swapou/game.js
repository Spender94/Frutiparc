/*
 * Swapou 2 — gameplay (traduction de Player.as, IAPlayer.as, Animator.as,
 * AnimatorChallenge.as, Interf*.as, Challenge.as, Classic.as, Duel.as,
 * Pause.as, TItem.as, Client.as).
 *
 * SW est l'espace partagé avec screens.js (Menu/HistoMap/GameOver/Manager).
 */
'use strict';

var SW = {}; // var : attaché au global (accessible aux tests headless via vm)

(function () {
  const E = SwapouEngine;
  const U = SwapouUI;
  const A = SwapouAssets;
  const D = U.D;
  const random = U.random;

  SW.E = E; SW.U = U; SW.A = A; SW.D = D;

  // état d'entrée global (renseigné par index.html)
  SW.mouse = { x: -1000, y: -1000, touching: false };
  // Geste de balayage tactile : (sx,sy) = point d'appui initial, (dx,dy) =
  // direction dominante du glissé (∈ {-1,0,1}). Tant que dx=dy=0 c'est un simple
  // appui (ciblage par quadrant). Renseigné par les handlers tactiles (screens.js).
  SW.swipe = { active: false, sx: 0, sy: 0, dx: 0, dy: 0 };
  SW.tmod = 1;
  SW.deltaT = 1 / 40;

  // Paire visée par l'entrée courante, partagée par tous les modes jouables.
  // Si un balayage a donné une direction, on échange le fruit posé (sx,sy) avec
  // son voisin dans cette direction (fiable au doigt) ; sinon on retombe sur le
  // ciblage par quadrant au point courant (souris, ou simple tap).
  SW.pickPair = function (player) {
    if (SW.swipe.dx || SW.swipe.dy)
      return player.getPairWithDir(SW.swipe.sx, SW.swipe.sy, SW.swipe.dx, SW.swipe.dy);
    return player.getPair(SW.mouse.x, SW.mouse.y);
  };

  // ── Données globales (Data.as globals) ───────────────────────────────────
  SW.Data = {
    CHALLENGE: 0, DUEL: 1, HISTORY: 2, CLASSIC: 3,
    players: [-1, -1],
    difficulty: 0,
    gameMode: 0,
    histoPhase: 0,
    chars: [false],
  };

  // ── Client (pont plateforme HTTP — remplace frusion.gameclient) ─────────
  function Client() {
    this.sid = '';
    this.slots = [undefined, undefined];
    this.nswaps = 0;
    this.standalone = false;
    this.connected = false;
    this.forcePause = false;
    // Options de confort accordées au joueur (cf. /api/features côté serveur).
    // Renseigné à la connexion ; false tant que la réponse n'est pas arrivée,
    // donc l'affichage n'apparaît jamais pour un joueur non autorisé.
    this.features = {};
  }
  // Interroge le serveur pour savoir quelles options d'affichage sont accordées.
  // Silencieux en cas d'échec : le jeu fonctionne exactement comme avant.
  Client.prototype.loadFeatures = function () {
    const me = this;
    if (!this.sid) return;
    fetch('/api/features?sid=' + encodeURIComponent(this.sid), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.features) me.features = j.features; })
      .catch(function () {});
  };
  Client.prototype.isWhite = function () { return false; };
  Client.prototype.serviceConnect = function (cb) {
    const me = this;
    function done() {
      // défauts (Client.as:onServiceConnect)
      let k = me.slots[1];
      if (k == null) {
        k = { $sound: true, $music: true, $lod: D.HIGH };
        me.slots[1] = k;
      }
      U.setLod(k.$lod || D.HIGH);
      A.enableSoundMusic(k.$sound !== false, k.$music !== false);
      let s = me.slots[0];
      if (s == null) {
        s = { $chars: [true, true, false, false, false, false, false, false, false], $record: 0, $classic_record: 0, $swap: 0, $items: [], $combos: [] };
        me.slots[0] = s;
      }
      if (!Array.isArray(s.$items)) s.$items = [];
      if (!Array.isArray(s.$combos)) s.$combos = [];
      if (!Array.isArray(s.$chars)) s.$chars = [true, true, false, false, false, false, false, false, false];
      me.nswaps = s.$swap || 0;
      SW.Data.chars = s.$chars;
      me.connected = true;
      cb();
    }
    if (!this.sid) { this.standalone = true; done(); return; }
    this.loadFeatures();   // options de confort (compteur de coups…) en parallèle
    fetch('/api/loadFrutiSlots?sid=' + encodeURIComponent(this.sid) + '&game=swapou2', { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        const params = new URLSearchParams(txt);
        if (params.get('ok') === '1') {
          try { if (params.get('slot0')) me.slots[0] = JSON.parse(params.get('slot0')); } catch (e) {}
          try { if (params.get('slot1')) me.slots[1] = JSON.parse(params.get('slot1')); } catch (e) {}
        }
        done();
      })
      .catch(function () { me.standalone = true; done(); });
  };
  Client.prototype.saveSlot = function (i) {
    if (this.standalone || !this.sid) return;
    const body = new URLSearchParams();
    body.set('sid', this.sid);
    body.set('game', 'swapou2');
    body.set('slotId', String(i));
    body.set('data', JSON.stringify(this.slots[i]));
    fetch('/api/saveFrutiSlot', { method: 'POST', body: body }).catch(function () {});
  };
  Client.prototype.savePrefs = function () {
    this.slots[1] = {
      $sound: A.soundEnabled(),
      $music: A.musicEnabled(),
      $lod: U.getLod(),
    };
    this.saveSlot(1);
  };
  Client.prototype.saveClassicScore = function (score) {
    const s = this.slots[0];
    const old = s.$classic_record || 0;
    if (score > old) s.$classic_record = score;
    s.$swap = this.nswaps;
    this.saveSlot(0);
    return old;
  };
  Client.prototype.unlockCharacter = function (ch) {
    const s = this.slots[0];
    if (!s.$chars[ch]) {
      s.$chars[ch] = true;
      this.saveSlot(0);
    }
  };
  Client.prototype.giveItem = function () { /* le serveur extrait les titems du slot 0 */ };
  // envoi d'un score au classement (m=1 challenge, m=0 classique).
  // data = perso au format sérialisé Motion-Twin « S<charId>: » (colonne
  // « Perso » du tableau, identique à ce que le serveur normalise) → lignes
  // desktop (SWF) et mobile strictement interchangeables.
  // Le voyant « en partie » à côté du pseudo — le serveur l'éteint de
  // lui-même quand le score part (saveScore) ou que la socket tombe.
  Client.prototype.direEnPartie = function (on) {
    if (!this.sid) return;
    var corps = JSON.stringify({ sid: this.sid, jeu: 'swapou2', on: on ? '1' : '0' });
    if (!on && navigator.sendBeacon) {
      navigator.sendBeacon('/api/light/jeu-en-cours', new Blob([corps], { type: 'application/json' }));
      return;
    }
    fetch('/api/light/jeu-en-cours', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps,
    }).catch(function () {});
  };

  Client.prototype.saveScore = function (score, mode, cb) {
    if (this.standalone || !this.sid) { cb(null); return; }
    const body = new URLSearchParams();
    body.set('sid', this.sid);
    body.set('game', 'swapou2');
    body.set('m', String(mode));
    body.set('score', String(score));
    body.set('data', 'S' + SW.Data.players[0] + ':');
    fetch('/api/saveScore', { method: 'POST', body: body })
      .then(function (r) { return r.json(); })
      .then(function (j) { cb(j); })
      .catch(function () { cb(null); });
  };
  // fin de partie challenge (Client.as:doEndGame).
  // IMPORTANT : le mode « Challenge » du jeu se classe dans le ranking
  // `swapou2_classic` (mode 0) — c'est le bucket que l'onglet « Challenge »
  // du front-end affiche (LEGACY_RANKINGS rk 3) et celui où le SWF desktop
  // écrit (son saveScore ne transmet pas de `m`, donc mode 0 par défaut).
  // Envoyer m=1 enverrait vers `swapou2_challenge` (section « Championnat »,
  // non surfacée) → scores invisibles. On reste donc en mode 0 pour être
  // strictement interchangeable avec le desktop.
  Client.prototype.doEndGame = function (score) {
    const s = this.slots[0];
    const oldRecord = s.$record || 0;
    if (score > oldRecord) s.$record = score;
    s.$swap = this.nswaps;
    this.saveSlot(0);
    this.saveScore(score, 0, function (j) {
      // `iaNonClasse` : le joueur a l'analyse en partie, le serveur a rangé
      // le score à part (fiche admin) et ne l'a classé nulle part.
      if (j && j.ok && j.iaNonClasse)
        SW.Manager.scoreSaved(score, oldRecord, 0, 0, 'partie jouée avec l\'IA : score non classé');
      else if (j && j.ok)
        SW.Manager.scoreSaved(score, j.oldScore || 0, j.oldPos || 0, j.newPos || 0);
      else
        SW.Manager.scoreSaved(score, oldRecord, 0, 0);
    });
  };
  SW.Client = Client;

  // ── TItem (TItem.as) ─────────────────────────────────────────────────────
  const TItem = {
    TITEMS: ['$sel', '', '$poivre', '$epee', '$piment', '$dent', '$sucre',
      '$metal01', '$metal02', '$metal03', '$ice01', '$ice02', '$ice03', '$star01', '$star02', '$star03',
      '$fruit01', '$fruit02', '$fruit03', '$fruit04', '$fruit05', '$fruit06', '$fruit07', '$fruit08', '$fruit09', '$fruit10', '$fruit11',
      '$combo01', '$combo02', '$combo03', '$combo04', '$combo05', '$combo06', '$combo07', '$combo08', '$combo09', '$combo10', '$combo11',
      '$photo01', '$photo02', '$photo03', '$photo04', '$photo05', '$photo06', '$photo07', '$photo08'],
    combo_nitems: 0,
    HISTO_TITEMS: 0,
    HISTO_END_TITEMS: 7,
    FRUIT_TITEMS: 16,
    COMBO_TITEMS: 27,
    PHOTO_TITEMS: 38,
    giveItem: function (i) {
      const fc = SW.Manager.client.slots[0].$items;
      if (fc[i] || TItem.TITEMS[i] === '') return false;
      fc[i] = true;
      SW.Manager.client.giveItem(TItem.TITEMS[i]);
      SW.Manager.client.saveSlot(0);
      return true;
    },
    histoItems: function () {
      let n = 0;
      if (TItem.giveItem(TItem.HISTO_TITEMS + SW.Data.histoPhase)) n++;
      if (SW.Data.histoPhase === 6) {
        let ntrys = 100;
        while (ntrys-- > 0) {
          if (TItem.giveItem(TItem.HISTO_END_TITEMS + random(9))) { n++; break; }
        }
      }
      return n;
    },
    addCombo: function (n) {
      const ac = SW.Manager.client.slots[0].$combos;
      if (ac[n] == null) ac[n] = 0;
      ac[n]++;
      if (ac[n] >= 5 && TItem.giveItem(TItem.COMBO_TITEMS + n)) {
        TItem.combo_nitems++;
        SW.Manager.client.saveSlot(0);
      } else if (ac[n] < 5) {
        SW.Manager.client.saveSlot(0);
      }
    },
    duelItem: function () {
      return TItem.giveItem(TItem.PHOTO_TITEMS + SW.Data.players[1]) ? 1 : 0;
    },
    classicItems: function (level) {
      let n = 0;
      level = Math.min(level, 11);
      while (level >= 0) {
        if (TItem.giveItem(level + TItem.FRUIT_TITEMS)) n++;
        level--;
      }
      return n;
    },
  };
  SW.TItem = TItem;

  // ── Animator (Animator.as) ───────────────────────────────────────────────
  function Animator(player, pos_x, pos_y) {
    this.player = player;
    this.pos_x = pos_x;
    this.pos_y = pos_y;
    this.animPhase = -1;
    this.particules = new U.Particules();
    this.wait = -1;
    this.invisibleList = [];
    this.moveUpList = [];
    this.suddens = [];
    this.skipMoveUp = false;
    this.endExpTimer = 0;
    this.gravityList = [];
    this.explosions = { list: [], armors: [] };
    this.fallList = [];
    this.specialName = null;
    this.specialTimer = 0;
    this.specialCallback = null;
    this.specialData = null;
    this.specialEndTimer = 0;
    this.extraFruits = []; // fruits hors grille à dessiner (rems/mc1/mc2…)
    this.fruitsVisible = true;
    this.lod = U.getLod();
    if (player.isIA()) {
      this.lod = D.LOW;
      this.particules.generate = null;
    }
  }
  SW.Animator = Animator;

  Animator.prototype.attachFruit = function (x, y, color, flags) {
    // hook utilisé par Level.onAttach — crée le sprite
    return null;
  };
  Animator.prototype.initSprite = function (f, x, y) {
    f.spr = {
      x: this.pos_x + D.FRUIT_WIDTH * x,
      y: this.pos_y + D.FRUIT_HEIGHT * y,
      alpha: 100, visible: true, subx: 0, suby: 0,
      overrideImg: null,
    };
  };
  Animator.prototype.getInfos = function () {
    return { px: this.pos_x, py: this.pos_y, sx: D.FRUIT_WIDTH, sy: D.FRUIT_HEIGHT };
  };
  Animator.prototype.hideMC = function (f) {
    f.spr.visible = false;
    this.invisibleList.push(f);
  };
  Animator.prototype.showAll = function () {
    for (let i = 0; i < this.invisibleList.length; i++)
      this.invisibleList[i].spr.visible = true;
    this.invisibleList = [];
  };
  Animator.prototype.setFruitsVisible = function (b) { this.fruitsVisible = b; };
  Animator.prototype.setPhase = function (p) {
    this.animPhase = p;
    for (let i = 0; i < this.moveUpList.length; i++)
      this.moveUpList[i].spr.y -= D.FRUIT_HEIGHT / 2;
    this.moveUpList = [];
  };

  Animator.prototype.swap = function (f1, f2) {
    A.play(A.SWAP);
    this.setPhase(D.A_SWAP);
    // Un clip PAR FRUIT (swapLeft/Right/Up/Down), posé sur le fruit avec sa
    // peau, qui joue ses douze images (la pellicule est dans ui.js, SWAP) ;
    // les fruits eux-mêmes restent cachés jusqu'à ce que les deux clips soient
    // morts, plus trois images (cf. A_SWAP dans main).
    let s1 = null, s2 = null;
    if (f1.spr.x > f2.spr.x) { s1 = 'gauche'; s2 = 'droite'; }
    if (f1.spr.x < f2.spr.x) { s1 = 'droite'; s2 = 'gauche'; }
    if (f1.spr.y > f2.spr.y) { s1 = 'haut'; s2 = 'bas'; }
    if (f1.spr.y < f2.spr.y) { s1 = 'bas'; s2 = 'haut'; }
    this.hideMC(f1);
    this.hideMC(f2);
    this.particules.attachFx('swapFruit', f1.spr.x, f1.spr.y,
      { totalFrames: 12, img: A.fruitImage(f1), table: U.SWAP[s1] });
    this.particules.attachFx('swapFruit', f2.spr.x, f2.spr.y,
      { totalFrames: 12, img: A.fruitImage(f2), table: U.SWAP[s2] });
    const x = f2.spr.x, y = f2.spr.y;
    f2.spr.x = f1.spr.x; f2.spr.y = f1.spr.y;
    f1.spr.x = x; f1.spr.y = y;
  };

  Animator.prototype.explode = function (mcs, armorMcs, score) {
    this.setPhase(D.A_EXPLODE);
    const armors = [];
    for (let i = 0; i < armorMcs.length; i++) {
      const d = armorMcs[i];
      const ghostImg = A.fruitImage(d); // gelé, avant peteArmure
      d.peteArmure();
      if (this.lod === D.HIGH)
        armors.push({ img: ghostImg, x: d.spr.x, y: d.spr.y, alpha: 100 });
      this.particules.explodeFrozen(d.spr.x, d.spr.y);
    }
    let sumX = 0, sumY = 0;
    for (let i = 0; i < mcs.length; i++) {
      const mc = mcs[i];
      mc.spr.x0 = mc.spr.x;
      mc.spr.y0 = mc.spr.y;
      mc.spr.expTimer = random(Math.round(mcs.length * 2));
      sumX += mc.spr.x;
      sumY += mc.spr.y;
    }
    this.endExpTimer = D.END_EXPLOSION_TIMER;
    this.explosions = {
      list: mcs.slice(), armors: armors,
      x: Math.round(sumX / mcs.length), y: Math.round(sumY / mcs.length),
    };
  };

  Animator.prototype.explodeFruit = function (f) {
    // Trois éclats BLANCS (le clip particule, image 1 — pas la couleur du
    // fruit), et le disque de l'explosion, huit images (cf. EXPLOSION, ui.js).
    this.particules.explodeFruit(f.spr.x, f.spr.y);
    this.particules.attachFx('explosion',
      Math.round(f.spr.x + D.FRUIT_WIDTH / 2), Math.round(f.spr.y + D.FRUIT_HEIGHT / 2),
      { totalFrames: 8 });
    f.spr.dead = true;
  };

  Animator.prototype.moveUp = function (f) {
    if (this.lod === D.HIGH) {
      this.skipMoveUp = true;
      f.spr.y -= D.FRUIT_HEIGHT / 2;
      this.moveUpList.push(f);
    } else {
      f.spr.y -= D.FRUIT_HEIGHT;
    }
  };

  Animator.prototype.gravity = function (mcList) {
    this.setPhase(D.A_GRAVITY);
    this.gravityList = mcList.slice();
    for (let i = 0; i < this.gravityList.length; i++) {
      const mc = this.gravityList[i];
      mc.ty = mc.f.spr.y + mc.delta * D.FRUIT_HEIGHT;
    }
  };

  Animator.prototype.falling = function (mcList) {
    this.fallList = mcList.slice();
    for (let i = 0; i < this.fallList.length; i++) {
      const f = this.fallList[i];
      f.spr.x0 = f.spr.x;
      f.spr.ty = f.spr.y;
      f.spr.y = -D.DOCHEIGHT + f.spr.y;
      f.spr.cpt = random(300) / 100;
    }
    this.setPhase(D.A_FALL);
  };

  Animator.prototype.main = function (tmod) {
    this.particules.main(tmod);
    this.animerReflets(tmod);

    for (let i = 0; i < this.suddens.length; i++) {
      const f = this.suddens[i];
      f.spr.subx = random(20) / 10 * (random(2) * 2 - 1);
      f.spr.suby = random(20) / 10 * (random(2) * 2 - 1);
    }

    switch (this.animPhase) {
      case -1:
        break;
      case D.A_SWAP: {
        if (this.particules.fxList.length === 0) {
          if (this.wait <= 0) { this.showAll(); this.wait = 3; }
          this.wait -= tmod;
          if (this.wait <= 0) {
            this.animPhase = -1;
            this.player.swapDone();
          }
        }
        break;
      }
      case D.A_GRAVITY: {
        if (this.suddens.length > 0) this.clearSuddenFruits();
        for (let i = 0; i < this.gravityList.length; i++) {
          const mc = this.gravityList[i];
          mc.f.spr.y += tmod * D.GRAVITY_DELTA;
          if (mc.f.spr.y >= mc.ty) {
            mc.f.spr.y = mc.ty;
            this.gravityList.splice(i, 1);
            i--;
            if (this.gravityList.length === 0) {
              this.animPhase = -1;
              this.player.gravityDone();
            }
          }
        }
        break;
      }
      case D.A_EXPLODE:
        this.explodeMain(tmod);
        break;
      case D.A_FALL: {
        for (let i = 0; i < this.fallList.length; i++) {
          const f = this.fallList[i];
          if (this.lod === D.HIGH) {
            f.spr.cpt += 0.8 * tmod;
            f.spr.x = f.spr.x0 + Math.sin(f.spr.cpt) * 5;
          }
          f.spr.y += D.PARASITE_SPEED * tmod;
          if (f.spr.y >= f.spr.ty) {
            f.spr.x = f.spr.x0;
            f.spr.y = f.spr.ty;
            this.fallList.splice(i, 1);
            i--;
          }
        }
        if (this.fallList.length === 0) {
          this.animPhase = -1;
          this.player.fallingDone();
        }
        break;
      }
      case D.A_GAMEOVER: {
        for (let i = 0; i < this.explosions.list.length; i++) {
          const mc = this.explosions.list[i];
          mc.spr.timer -= tmod;
          if (mc.spr.timer <= 0) {
            A.play(random(2) === 0 ? A.POP1 : A.POP2);
            this.explodeFruit(mc);
            this.explosions.list.splice(i, 1);
            i--;
          }
        }
        break;
      }
      case D.A_SPECIAL: {
        if (this.specialCallback != null) {
          this.specialTimer -= tmod;
          if (this.specialTimer <= 0)
            this.specialCallback.call(this, this.specialData, tmod);
        }
        if (this.specialEndTimer > 0) {
          this.specialEndTimer -= tmod;
          if (this.specialEndTimer <= 0) {
            this.animPhase = -1;
            this.player.specialDone();
          }
        }
        break;
      }
    }

    if (!this.skipMoveUp && this.moveUpList.length > 0) {
      for (let i = 0; i < this.moveUpList.length; i++)
        this.moveUpList[i].spr.y -= D.FRUIT_HEIGHT / 2;
      this.moveUpList = [];
    }
    this.skipMoveUp = false;
  };

  Animator.prototype.explodeMain = function (data, tmod) {
    if (tmod === undefined) tmod = data; // appelé soit en phase, soit en callback
    for (let i = 0; i < this.explosions.list.length; i++) {
      const mc = this.explosions.list[i];
      if (this.lod >= D.HIGH) {
        mc.spr.x = mc.spr.x0 + random(30) / 10 * (random(2) * 2 - 1);
        mc.spr.y = mc.spr.y0 + random(30) / 10 * (random(2) * 2 - 1);
        mc.spr.alpha = random(30) + 40;
      } else mc.spr.alpha = 65;
      mc.spr.expTimer -= tmod;
      if (mc.spr.expTimer <= 0) {
        A.play(random(2) === 0 ? A.POP1 : A.POP2);
        this.explodeFruit(mc);
        this.explosions.list.splice(i, 1);
        i--;
      }
    }
    for (let i = 0; i < this.explosions.armors.length; i++) {
      const mc = this.explosions.armors[i];
      mc.alpha -= tmod * 5;
      if (mc.alpha <= 10) {
        this.explosions.armors.splice(i, 1);
        i--;
      }
    }
    if (this.explosions.list.length === 0 && this.explosions.armors.length === 0) {
      this.endExpTimer -= tmod;
      if (this.endExpTimer <= 0) {
        this.animPhase = -1;
        this.player.explodeDone();
      }
    }
  };

  Animator.prototype.gameOver = function (wins, fruits) {
    this.clearSuddenFruits();
    if (!wins) {
      this.explosions = { list: [], armors: [], x: 0, y: 0 };
      for (let x = 0; x < fruits.length; x++)
        for (let y = 0; y < fruits[x].length; y++) {
          const f = fruits[x][y];
          if (f != null) {
            f.spr.timer = (D.DOCHEIGHT - f.spr.y) * 0.2;
            const xmin = (f.spr.x - this.pos_x) * 100;
            const xmax = (f.spr.x - this.pos_x) * 200;
            f.spr.timer += (random(Math.max(1, xmax - xmin)) + xmin) / 1000;
            f.spr.timer *= 0.6;
            this.explosions.list.push(f);
          }
        }
    }
    this.setPhase(D.A_GAMEOVER);
  };

  Animator.prototype.comboScore = function () {};
  Animator.prototype.finalComboScore = function () {};

  Animator.prototype.suddenFruits = function (mcs) {
    this.clearSuddenFruits();
    for (let i = 0; i < mcs.length; i++) this.suddens.push(mcs[i]);
  };
  Animator.prototype.clearSuddenFruits = function () {
    for (let i = 0; i < this.suddens.length; i++) {
      this.suddens[i].spr.subx = 0;
      this.suddens[i].spr.suby = 0;
    }
    this.suddens = [];
  };

  Animator.prototype.showBanner = function (txt) {
    const width = this.player.getLevelWidth() * D.FRUIT_WIDTH;
    const mc = this.particules.attachFx('defense', this.pos_x + width / 2, D.SPECIAL_Y, { totalFrames: 9, text: txt + ' !' });
    mc.animMode = D.PINGPONG;
    A.play(A.COMBO);
  };
  Animator.prototype.showAttack = function (name) { this.showBanner(name); };

  Animator.prototype.setCallback = function (c, d) {
    this.setPhase(D.A_SPECIAL);
    this.specialCallback = c;
    this.specialData = d;
  };
  Animator.prototype.specialDoneAnim = function () {
    this.specialCallback = null;
    this.specialEndTimer = 10;
  };

  Animator.prototype.dispatchDefense = function (data, fruits) {
    this.clearSuddenFruits();
    switch (data.id) {
      case 0: this.ecarteur(data.mc1, data.mc2, fruits); break;
      case 1: this.egaliseur(data.rems, data.adds, fruits); break;
      case 2: this.coupeur(data.cuts, fruits); break;
      case 3: this.pete1Ligne(data.cuts, fruits); break;
      case 4: this.convertisseur(data.converts, data.src, data.dst, fruits); break;
      case 5: this.peteArmures(data.mcs, fruits); break;
      case 6: this.combos2(data.mcs, data.arms); break;
    }
    this.showBanner(this.specialName != null ? this.specialName : '');
  };

  // ── défenses : inits ──────────────────────────────────────────────────────
  Animator.prototype.ecarteur = function (mc1, mc2, fruits) {
    const mid = fruits.length / 2;
    const left = [], right = [], expl = [];
    const timer = 10;
    for (let i = 0; i < fruits.length; i++)
      for (let j = 0; j < fruits[i].length; j++) {
        const mc = fruits[i][j];
        if (mc != null) {
          mc.spr.timer = timer + Math.abs(i - mid) * 4;
          mc.spr.cpt = 0;
          mc.spr.oldX = mc.spr.x;
          if (i <= Math.floor(mid)) {
            mc.spr.tx = mc.spr.x - D.FRUIT_WIDTH;
            left.push(mc);
          } else {
            mc.spr.tx = mc.spr.x + D.FRUIT_WIDTH;
            right.push(mc);
          }
        }
      }
    for (let i = 0; i < mc1.length; i++) {
      const mc = mc1[i];
      if (mc != null) {
        mc.spr.timer = mc.spr.y / D.FRUIT_HEIGHT * 2;
        expl.push(mc);
        this.extraFruits.push(mc);
      }
    }
    for (let i = 0; i < mc2.length; i++) {
      const mc = mc2[i];
      if (mc != null) {
        mc.spr.timer = mc.spr.y / D.FRUIT_HEIGHT * 2;
        expl.push(mc);
        this.extraFruits.push(mc);
      }
    }
    this.specialName = E.DEFENSE_NAMES[0];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.ecarteurMain, { timer: timer, left: left, right: right, expl: expl, fruits: fruits });
  };

  Animator.prototype.egaliseur = function (rems, adds, fruits) {
    const falls = [], ups = [];
    for (let i = 0; i < rems.length; i++) {
      const mc = rems[i];
      if (mc != null) {
        mc.spr.timer = 4 * i;
        this.extraFruits.push(mc);
        for (let j = 0; j < fruits[i].length; j++)
          if (fruits[i][j] != null) {
            fruits[i][j].spr.ty = fruits[i][j].spr.y + D.FRUIT_HEIGHT;
            falls.push(fruits[i][j]);
          }
      }
    }
    for (let i = 0; i < adds.length; i++) {
      const mc = adds[i];
      if (mc != null) {
        mc.spr.alpha = 0;
        mc.spr.timer = 4 * i + 2;
        for (let j = 0; j < fruits[i].length - 1; j++)
          if (fruits[i][j] != null) {
            fruits[i][j].spr.ty = fruits[i][j].spr.y - D.FRUIT_HEIGHT;
            ups.push(fruits[i][j]);
          }
      }
    }
    this.specialName = E.DEFENSE_NAMES[1];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.egaliseurMain, { rems: rems, adds: adds, fruits: fruits, falls: falls, ups: ups });
  };

  Animator.prototype.coupeur = function (cuts, fruits) {
    for (let i = 0; i < cuts.length; i++) {
      cuts[i].spr.timer = 2 * i;
      this.extraFruits.push(cuts[i]);
    }
    this.specialName = E.DEFENSE_NAMES[2];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.coupeurMain, { cuts: cuts, fruits: fruits });
  };

  Animator.prototype.pete1Ligne = function (cuts, fruits) {
    for (let i = 0; i < cuts.length; i++) {
      cuts[i].spr.timer = 3 * Math.abs(cuts.length / 2 - i);
      this.extraFruits.push(cuts[i]);
    }
    this.specialName = E.DEFENSE_NAMES[3];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.pete1LigneMain, { cuts: cuts, fruits: fruits });
  };

  Animator.prototype.convertisseur = function (converts, src, dst, fruits) {
    for (let i = 0; i < converts.length; i++) {
      converts[i].spr.timer = 3 * (D.DOCHEIGHT - converts[i].spr.y) / D.FRUIT_HEIGHT;
      // skin figé jusqu'au flash de conversion
      converts[i].spr.overrideImg = converts[i].spr.preImg || null;
    }
    this.specialName = E.DEFENSE_NAMES[4] + String(dst);
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.convertisseurMain, { converts: converts, src: src, dst: dst, fruits: fruits });
  };

  Animator.prototype.peteArmures = function (mcs, fruits) {
    for (let i = 0; i < mcs.length; i++) {
      const mc = mcs[i];
      mc.spr.timer = (D.DOCHEIGHT - mc.spr.y) / D.FRUIT_HEIGHT;
      mc.spr.timer += (D.DOCWIDTH - mc.spr.x) / D.FRUIT_WIDTH;
      mc.spr.overrideImg = mc.spr.preImg || null;
    }
    this.specialName = E.DEFENSE_NAMES[5];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.peteArmuresMain, { mcs: mcs, fruits: fruits });
  };

  Animator.prototype.combos2 = function (mcs, arms) {
    this.explode(mcs, arms, 0);
    this.specialName = E.DEFENSE_NAMES[6];
    this.specialTimer = D.SPECIAL_TIMER;
    this.setCallback(this.explodeMain, undefined);
  };

  // ── attaques : inits ─────────────────────────────────────────────────────
  Animator.prototype.tremblementDeTerre = function (rems, adds, fruits) {
    const falls = [], ups = [];
    for (let i = 0; i < rems.length; i++) {
      const mc = rems[i];
      if (mc != null) {
        mc.spr.timer = 4 * i;
        this.extraFruits.push(mc);
        for (let j = 0; j < fruits[i].length; j++)
          if (fruits[i][j] != null) {
            fruits[i][j].spr.ty = this.pos_y + D.FRUIT_HEIGHT * j;
            falls.push(fruits[i][j]);
          }
      }
    }
    for (let i = 0; i < adds.length; i++) {
      const mc = adds[i];
      if (mc != null) {
        mc.spr.alpha = 0;
        mc.spr.timer = 4 * i + 2;
        for (let j = 0; j < fruits[i].length - 1; j++)
          if (fruits[i][j] != null) {
            fruits[i][j].spr.ty = this.pos_y + D.FRUIT_HEIGHT * j;
            ups.push(fruits[i][j]);
          }
      }
    }
    this.specialTimer = D.SPECIAL_ATTACK_TIMER;
    this.setCallback(this.tremblementDeTerreMain, { rems: rems, adds: adds, fruits: fruits, falls: falls, ups: ups });
  };

  Animator.prototype.couleeMetal = function (mcs, fruits) {
    this.specialTimer = D.SPECIAL_ATTACK_TIMER;
    this.setCallback(this.couleeMetalMain, { mcs: mcs, fruits: fruits });
  };

  // ── défenses/attaques : boucles ──────────────────────────────────────────
  Animator.prototype.egaliseurMain = function (data, tmod) {
    for (let i = 0; i < data.falls.length; i++) {
      const mc = data.falls[i];
      mc.spr.timer -= tmod;
      mc.spr.y += (random(4) + 2) * tmod;
      if (mc.spr.y >= mc.spr.ty) {
        mc.spr.y = mc.spr.ty;
        data.falls.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.ups.length; i++) {
      const mc = data.ups[i];
      mc.spr.timer -= tmod;
      mc.spr.y -= (random(4) + 2) * tmod;
      if (mc.spr.y <= mc.spr.ty) {
        mc.spr.y = mc.spr.ty;
        data.ups.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.rems.length; i++) {
      const mc = data.rems[i];
      if (mc == null) { continue; }
      mc.spr.alpha -= tmod * 4;
      if (mc.spr.alpha <= 0) {
        this.removeExtra(mc);
        data.rems.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.adds.length; i++) {
      const mc = data.adds[i];
      if (mc == null) { continue; }
      mc.spr.alpha += tmod * 4;
      if (mc.spr.alpha >= 100) {
        mc.spr.alpha = 100;
        data.adds.splice(i, 1); i--;
      }
    }
    if (data.rems.filter(Boolean).length === 0 && data.adds.filter(Boolean).length === 0 &&
      data.falls.length === 0 && data.ups.length === 0)
      this.specialDoneAnim();
  };

  Animator.prototype.tremblementDeTerreMain = function (data, tmod) {
    for (let i = 0; i < data.falls.length; i++) {
      const mc = data.falls[i];
      mc.spr.timer -= tmod;
      mc.spr.y += Math.abs(random(5) - 2) * tmod;
      if (mc.spr.y >= mc.spr.ty) {
        mc.spr.y = mc.spr.ty;
        data.falls.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.ups.length; i++) {
      const mc = data.ups[i];
      mc.spr.timer -= tmod;
      mc.spr.y -= Math.abs(random(5) - 2) * tmod;
      if (mc.spr.y <= mc.spr.ty) {
        mc.spr.y = mc.spr.ty;
        data.ups.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.rems.length; i++) {
      const mc = data.rems[i];
      if (mc == null) continue;
      mc.spr.alpha -= tmod * 4;
      if (mc.spr.alpha <= 0) {
        this.removeExtra(mc);
        data.rems.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < data.adds.length; i++) {
      const mc = data.adds[i];
      if (mc == null) continue;
      mc.spr.alpha += tmod * 4;
      if (mc.spr.alpha >= 100) {
        mc.spr.alpha = 100;
        data.adds.splice(i, 1); i--;
      }
    }
    if (data.rems.filter(Boolean).length === 0 && data.adds.filter(Boolean).length === 0 &&
      data.falls.length === 0 && data.ups.length === 0)
      this.specialDoneAnim();
  };

  Animator.prototype.coupeurMain = function (data, tmod) {
    for (let i = 0; i < data.cuts.length; i++) {
      const mc = data.cuts[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        this.explodeFruit(mc);
        this.removeExtra(mc);
        data.cuts.splice(i, 1); i--;
      }
    }
    if (data.cuts.length === 0) this.specialDoneAnim();
  };

  Animator.prototype.pete1LigneMain = function (data, tmod) {
    for (let i = 0; i < data.cuts.length; i++) {
      const mc = data.cuts[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        this.explodeFruit(mc);
        this.removeExtra(mc);
        data.cuts.splice(i, 1); i--;
      }
    }
    if (data.cuts.length === 0) {
      this.specialCallback = null;
      this.animPhase = -1;
      this.player.specialDoneGravity();
    }
  };

  Animator.prototype.convertisseurMain = function (data, tmod) {
    for (let i = 0; i < data.converts.length; i++) {
      const mc = data.converts[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        // L'anneau de l'explosion (sub.gotoAndStop(2)) : c'est une armure.
        this.particules.attachFx('explosion',
          Math.round(mc.spr.x + D.FRUIT_WIDTH / 2), Math.round(mc.spr.y + D.FRUIT_HEIGHT / 2),
          { totalFrames: 8, gel: true });
        mc.spr.overrideImg = null; // updateSkin
        data.converts.splice(i, 1); i--;
      }
    }
    if (data.converts.length === 0) this.specialDoneAnim();
  };

  Animator.prototype.peteArmuresMain = function (data, tmod) {
    for (let i = 0; i < data.mcs.length; i++) {
      const mc = data.mcs[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        // L'anneau de l'explosion (sub.gotoAndStop(2)) : c'est une armure.
        this.particules.attachFx('explosion',
          Math.round(mc.spr.x + D.FRUIT_WIDTH / 2), Math.round(mc.spr.y + D.FRUIT_HEIGHT / 2),
          { totalFrames: 8, gel: true });
        this.particules.explodeFrozen(mc.spr.x, mc.spr.y);
        mc.spr.overrideImg = null;
        data.mcs.splice(i, 1); i--;
      }
    }
    if (data.mcs.length === 0) this.specialDoneAnim();
  };

  Animator.prototype.couleeMetalMain = function (data) {
    for (let i = 0; i < data.mcs.length; i++) {
      data.mcs.splice(i, 1); i--; // skins déjà à jour (dérivés des flags)
    }
    if (data.mcs.length === 0) this.specialDoneAnim();
  };

  Animator.prototype.ecarteurMain = function (data, tmod) {
    data.timer -= tmod;
    if (data.timer <= 0) {
      this.particules.attachFx('strike',
        this.pos_x + (data.fruits.length * D.FRUIT_WIDTH) / 2, 0, { totalFrames: 13 });
      data.timer = 999999;
    }
    for (let i = 0; i < data.left.length; i++) {
      const mc = data.left[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        mc.spr.cpt += 0.4 * tmod;
        mc.spr.x = mc.spr.tx + Math.cos(mc.spr.cpt) * D.FRUIT_WIDTH * 0.7;
        if (mc.spr.cpt >= Math.PI * 1.5) {
          mc.spr.x = mc.spr.tx;
          data.left.splice(i, 1); i--;
        }
      }
    }
    for (let i = 0; i < data.right.length; i++) {
      const mc = data.right[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        mc.spr.cpt += 0.4 * tmod;
        mc.spr.x = mc.spr.tx - Math.cos(mc.spr.cpt) * D.FRUIT_WIDTH * 0.7;
        if (mc.spr.cpt >= Math.PI * 1.5) {
          mc.spr.x = mc.spr.tx;
          data.right.splice(i, 1); i--;
        }
      }
    }
    for (let i = 0; i < data.expl.length; i++) {
      const mc = data.expl[i];
      mc.spr.timer -= tmod;
      if (mc.spr.timer <= 0) {
        this.explodeFruit(mc);
        this.removeExtra(mc);
        data.expl.splice(i, 1); i--;
      }
    }
    if (data.expl.length === 0 && data.left.length === 0 && data.right.length === 0)
      this.specialDoneAnim();
  };

  Animator.prototype.removeExtra = function (f) {
    const i = this.extraFruits.indexOf(f);
    if (i >= 0) this.extraFruits.splice(i, 1);
  };

  Animator.prototype.destroy = function () {
    this.particules.destroy();
    this.extraFruits = [];
    this.explosions = { list: [], armors: [] };
  };

  // dessine la grille + fruits annexes du joueur
  Animator.prototype.drawFruits = function (ctx, level) {
    if (!this.fruitsVisible) return;
    const fruits = level.getFruits();
    for (let x = 0; x < level.width; x++)
      for (let y = 0; y < level.height; y++) {
        const f = fruits[x][y];
        if (f != null) drawFruit(ctx, f);
      }
    for (let i = 0; i < this.explosions.list.length; i++)
      drawFruit(ctx, this.explosions.list[i]);
    for (let i = 0; i < this.extraFruits.length; i++)
      drawFruit(ctx, this.extraFruits[i]);
    for (let i = 0; i < this.explosions.armors.length; i++) {
      const g = this.explosions.armors[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, g.alpha / 100);
      if (g.img) ctx.drawImage(g.img, g.x, g.y, 38, 38);
      ctx.restore();
    }
  };

  /* ── LES REFLETS DES FRUITS ÉTOILE ET GELÉS ────────────────────────────────
   *
   * Les peaux 40-42 (étoile) et 60-62 (gelé) du clip du fruit portent un
   * sous-clip `shine` que Fruit.updateSkin ne fige QU'en qualité basse ou hors
   * Challenge : en Challenge, il joue. Il attend un temps au hasard — 50 à 400
   * images pour l'étoile (#172), 50 à 350 pour le gel (#182) —, puis un trait
   * blanc balaie le fruit en diagonale, découpé par sa silhouette ; le gel y
   * ajoute un flash rond qui s'efface. Puis il attend de nouveau.
   *
   * Le sous-clip est posé en (17,9 ; 18,1) dans le fruit étoile, (18 ; 18,75)
   * dans le fruit gelé. [dx, dy, rotation] du trait, image par image.
   */
  const ECLAT_ETOILE = [[-11.85, -17.4, 0], [-11.45, -16.75, 0.5], [-10.15, -14.8, 2.3],
    [-8.05, -11.5, 5.3], [-5.1, -6.95, 9.3], [-1.35, -1, 14.6], [3.3, 6.15, 21.1],
    [8.75, 14.65, 28.8], [15.1, 24.4, 37.6]];
  const ECLAT_GEL_TRAIT = [[-11.85, -17.4], [-11.25, -16.65], [-9.4, -14.35], [-6.3, -10.5],
    [-2, -5.1], [3.55, 1.8], [10.35, 10.2], [18.35, 20.2], [18.35, 20.2], [18.35, 20.2]];
  const ECLAT_GEL_FLASH = [null, null, null, [1, 1], [0.964, 0.64], [0.936, 0.36],
    [0.916, 0.16], [0.904, 0.04], [0.9, 0], [0.9, 0]];   // [échelle, alpha], dès l'image 6
  const ECLAT_ATTENTE = { etoile: 350, gel: 300 };

  Animator.prototype.animerReflets = function (tmod) {
    if (this.lod !== D.HIGH || SW.Data.gameMode !== SW.Data.CHALLENGE) return;
    const fruits = this.player.level.fruits;
    for (let x = 0; x < fruits.length; x++)
      for (let y = 0; y < fruits[x].length; y++) {
        const f = fruits[x][y];
        if (!f || !f.spr) continue;
        const etoile = (f.flags & E.FLAG_STAR) !== 0;
        if (!etoile && (f.flags & E.FLAG_ARMURE) === 0) { f.spr.eclat = null; continue; }
        const duree = etoile ? ECLAT_ETOILE.length : ECLAT_GEL_TRAIT.length;
        let e = f.spr.eclat;
        if (!e) e = f.spr.eclat = { wait: random(etoile ? ECLAT_ATTENTE.etoile : ECLAT_ATTENTE.gel) + 50, frame: 0 };
        if (e.frame <= 0) {
          e.wait -= tmod;
          if (e.wait <= 0) e.frame = 1;
        } else {
          e.frame += tmod;
          if (e.frame >= duree + 1) {
            e.frame = 0;
            e.wait = random(etoile ? ECLAT_ATTENTE.etoile : ECLAT_ATTENTE.gel) + 50;
          }
        }
      }
  };

  function dessinerReflet(ctx, f, x, y, frame) {
    const i = Math.floor(frame) - 1;
    if ((f.flags & E.FLAG_STAR) !== 0) {
      const e = ECLAT_ETOILE[i];
      if (!e) return;
      ctx.save();
      ctx.translate(x + 17.9, y + 18.1);
      U.decouperForme(ctx, U.FORMES.eclatMasqueEtoile);
      ctx.translate(e[0], e[1]);
      ctx.rotate(e[2] * Math.PI / 180);
      U.tracerForme(ctx, U.FORMES.eclatTrait);
      ctx.restore();
    } else {
      const t = ECLAT_GEL_TRAIT[i];
      if (!t) return;
      ctx.save();
      ctx.translate(x + 18, y + 18.75);
      U.decouperForme(ctx, U.FORMES.eclatMasqueGel);
      ctx.save();
      ctx.translate(t[0], t[1]);
      U.tracerForme(ctx, U.FORMES.eclatTrait);
      ctx.restore();
      const fl = ECLAT_GEL_FLASH[i];
      if (fl && fl[1] > 0) {
        ctx.globalAlpha *= fl[1];
        ctx.translate(-0.6, -0.3);
        ctx.scale(fl[0], fl[0]);
        U.tracerForme(ctx, U.FORMES.eclatFlash);
      }
      ctx.restore();
    }
  }

  function drawFruit(ctx, f) {
    const s = f.spr;
    if (!s || s.dead || !s.visible) return;
    const img = s.overrideImg || A.fruitImage(f);
    if (!img || !img.naturalWidth) return;
    const a = s.alpha / 100;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, a);
    // Le bitmap de 38 × 38 est posé EN (0, 0) dans le clip du fruit, dont
    // l'ancrage est le coin haut-gauche de la case de 35 : il déborde de trois
    // pixels à droite et en bas, il n'est pas centré sur la case.
    ctx.drawImage(img, s.x + s.subx, s.y + s.suby, 38, 38);
    if (s.eclat && s.eclat.frame > 0 && !s.overrideImg)
      dessinerReflet(ctx, f, s.x + s.subx, s.y + s.suby, s.eclat.frame);
    ctx.restore();
  }
  SW.drawFruit = drawFruit;

  // ── AnimatorChallenge (AnimatorChallenge.as) ─────────────────────────────
  function AnimatorChallenge(player, pos_x, pos_y) {
    Animator.call(this, player, pos_x, pos_y);
    this.comboStar = null; // { value, scale, flash, distort, animCpt, flying }
    this.comboName = null; // { imgIdx, classic }
    this.comboId = 0;
  }
  AnimatorChallenge.prototype = Object.create(Animator.prototype);
  SW.AnimatorChallenge = AnimatorChallenge;

  /* ── L'ÉTOILE DE COMBO, RELEVÉE SUR SA PELLICULE ────────────────────────
   *
   * `comboStar` est le sprite #81 du SWF : vingt et une images, l'étiquette
   * « flash » à la septième, et trois scripts d'image. Ce que le clip fait :
   *
   *   · LE JAILLISSEMENT (images 1 à 10). L'étoile naît à 0,28, légèrement
   *     décalée et penchée de 8,7°, dépasse à 1,2 puis retombe à 1 ;
   *     « flash » rejoue le sommet (image 7) à chaque explosion de la chaîne.
   *     C'est ce rebond qui donne son coup de poing au combo.
   *   · L'ÉCLAT BLANC. Chaque image porte une transformation de couleur dont
   *     multiplicateur et terme additif font toujours 256 : une interpolation
   *     VERS LE BLANC, jusqu'à 52 % au sommet.
   *   · LE MAINTIEN. L'image 9 arme une attente de 60 ; l'image 11 boucle sur
   *     10-11 tant que la chaîne court (`done` faux), puis, le score final
   *     affiché, décompte l'attente — une seconde et demie — et laisse filer
   *   · LE RETRAIT (images 12 à 21) : l'étoile rapetisse en cinq images, puis
   *     s'efface en cinq. L'image 22 retire le clip.
   *
   * Dans l'étoile, `sub` (#80) a deux images : la 2 pendant la chaîne — le
   * compte des explosions en DooM 43, jaune —, la 1 pour le score final — en
   * DooM 25, suivi de « pts » —, les deux champs inclinés de 10,5°.
   *
   * [dx, dy, échelle, rotation, part de blanc, alpha] pour chaque image.
   */
  const CS_IMAGES = [
    [2.55, -4.2, 0.2807, -8.7, 0, 1], [1.85, -3.1, 0.5614, -6.3, 0.160, 1],
    [1.3, -2.15, 0.7911, -4.3, 0.289, 1], [0.85, -1.4, 0.97, -2.6, 0.391, 1],
    [0.55, -0.85, 1.0977, -1.5, 0.461, 1], [0.3, -0.55, 1.1743, -0.8, 0.504, 1],
    [0.3, -0.45, 1.1999, -0.8, 0.520, 1], [0.25, -0.45, 1.1777, -0.5, 0.461, 1],
    [0.15, -0.25, 1.1111, -0.3, 0.289, 1], [0, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 1],
    [0.45, -0.9, 0.8564, -1.8, 0, 1], [0.9, -1.8, 0.7128, -3.6, 0, 1],
    [1.35, -2.65, 0.5692, -5.5, 0, 1], [1.8, -3.55, 0.4257, -7.3, 0, 1],
    [2.25, -4.45, 0.2824, -9.3, 0, 1], [2.25, -4.45, 0.2823, -9.3, 0, 0.801],
    [2.25, -4.45, 0.2823, -9.3, 0, 0.602], [2.25, -4.45, 0.2823, -9.3, 0, 0.398],
    [2.25, -4.45, 0.2823, -9.3, 0, 0.199], [2.25, -4.45, 0.2824, -9.3, 0, 0],
  ];
  const CS_FLASH = 7;                 // l'étiquette « flash » du sprite #81
  const CS_ATTENTE = 60;              // le script de l'image 9
  const CS_FIN = 22;                  // l'image qui retire le clip
  // Les trois étoiles qui tournent DERRIÈRE la grande (sprite `flying` #74) :
  // trois copies de `powerStar` à 120°, sur un cercle de 56,5, qui avancent
  // d'un tiers de tour en quinze images — 8° par image. Elles n'apparaissent
  // que sur le score final, et seulement s'il dépasse MIN_SUPER_COMBO.
  const CS_ORBITE = 56.5, CS_VITESSE = 8;

  function csAnim(t) {
    const f = Math.max(0, Math.min(CS_IMAGES.length - 1.001, (t || 1) - 1));
    const i = Math.floor(f), k = f - i;
    const m = (n) => CS_IMAGES[i][n] + (CS_IMAGES[i + 1][n] - CS_IMAGES[i][n]) * k;
    return { x: m(0), y: m(1), s: m(2), rot: m(3), blanc: m(4), alpha: m(5) };
  }

  /* ── L'ANNONCE DU COMBO — l'encart, le nom, l'image ────────────────────────
   *
   * `AnimatorChallenge.as` attache le clip `comboName` et fait
   * `comboName.sub.gotoAndStop(i)` : `sub` (sprite #128) a trente-neuf images,
   * et CHACUNE en pose trois — l'ENCART au fond (la forme #83, qui n'est autre
   * que `versusBox.png`, 368 × 100), le NOM du cocktail par-dessus, et le
   * DESSIN du cocktail à gauche. Le portage ne posait que le dessin : d'où
   * l'impression, juste, qu'il manquait quelque chose.
   *
   * Les onze premières images sont les paliers du Challenge, les images 31 à
   * 39 ceux du Classique (`gotoAndStop(i+30)`) — et là, c'est la même vignette
   * (`classic.png`) qu'on décale d'un palier à l'autre.
   *
   * Tout ce qui suit est relevé sur le fichier : la position du dessin est
   * celle de sa forme (chaque cocktail est cadré différemment dans son
   * bitmap), et chaque ligne de nom porte son propre décalage et sa propre
   * hauteur — la « recette crêmeuse » est écrite plus gros, le « suprême
   * crême-orange » plus petit, faute de place.
   */
  const CN_ENCART = { x: -179.65, y: -50, w: 368, h: 100 };
  // { img, ix, iy, [texte, tx, ty, taille] … }
  const CN_CHALLENGE = [
    ['combo0', -121.05, -54, ['confiture ', -41.15, -10.65, 40], ['de fraise', -41.15, 25.35, 40]],
    ['combo1', -141.95, -55, ['confiture ', -62.05, -11.65, 40], ['aux abricots', -62.05, 24.35, 40]],
    ['combo2', -152.55, -53.4, ['tarte aux ', -59.5, -13.25, 40], ['fruits rouges', -59.5, 22.75, 40]],
    ['combo3', -135.35, -53.4, ['recette ', -38.3, -9.25, 45], ['crêmeuse', -38.3, 21.75, 45]],
    ['combo4', -154.65, -53, ['suprême', -57.6, -13.35, 38], ['crême-orange', -57.6, 20.65, 38]],
    ['combo5', -141, -53, ['kiwi-ti-kiwi', -43.95, 7.2, 40]],
    ['combo6', -106.15, -52, ['orange', -9.1, -12.65, 40], ["folie's", -9.1, 23.35, 40]],
    ['combo7', -121, -49.65, ['douceur', -22.05, -12.65, 40], ['pistache', -22.05, 23.35, 40]],
    ['combo8', -125, -49, ['éclair', -21.4, -12.65, 40], ['suprême', -21.4, 23.35, 40]],
    ['combo9', -119.85, -52, ['iceberg', -22.8, -12.65, 40], ['de fruits', -22.8, 23.35, 40]],
    ['combo10', -136.35, -52, ['cocktail', -39.3, -12.65, 40], ['swapolotof', -39.3, 23.35, 40]],
  ];
  // Le Classique : une seule vignette, posée à un x différent par palier.
  const CN_CLASSIC = [
    ['comboClassic', -126.45, -54, ['mini fruti', -36.45, 11.15, 40]],
    ['comboClassic', -134.5, -54, ['super fruti', -44.5, 11.15, 40]],
    ['comboClassic', -133.4, -54, ['mega fruti', -43.4, 11.15, 40]],
    ['comboClassic', -127.7, -54, ['maxi pulp', -37.7, 11.15, 40]],
    ['comboClassic', -120.55, -54, ['confiture', -30.55, -10.65, 40], ['combo', -30.55, 25.35, 40]],
    ['comboClassic', -96.65, -54, ['tarte ', -6.65, -11.65, 40], ['combo', -6.65, 24.35, 40]],
    ['comboClassic', -117.1, -54, ['vitamine', -27.1, -9.65, 40], ['combo', -27.1, 26.35, 40]],
    ['comboClassic', -110.05, -54, ['cocktail', -20.05, -10.65, 40], ['fruti', -20.05, 25.35, 40]],
    ['comboClassic', -133.55, -54, ['cocktail', -43.55, -10.65, 40], ['ancestral !', -43.55, 25.35, 40]],
  ];
  /* La chute, le rebond, la sortie — les dix-neuf images du clip `comboName`
   * (sprite #129) : il TOMBE du haut de l'écran en huit images, se gonfle d'un
   * douzième et revient en quatre, se tient deux, puis remonte et s'efface.
   * L'image vingt fait `this.removeMovieClip()` : l'annonce dure une
   * demi-seconde, pas les deux secondes et quart que le portage lui donnait. */
  const CN_IMAGES = [
    [-166.75, 1], [-122.5, 1], [-85.05, 1], [-54.45, 1], [-30.65, 1], [-13.6, 1],
    [-3.4, 1], [0, 1], [0, 1.04], [0, 1.08], [0, 1.0533], [0, 1.0267], [0, 1],
    [0, 1], [-6.25, 1], [-25.05, 1], [-56.4, 1], [-100.3, 1], [-156.7, 1],
  ];

  function dessinerAnnonce(ctx, cn) {
    const table = cn.classic ? CN_CLASSIC : CN_CHALLENGE;
    const e = table[cn.idx];
    if (!e) return;
    const f = Math.max(0, Math.min(CN_IMAGES.length - 1, Math.floor(cn.frame) - 1));
    const [dy, ech] = CN_IMAGES[f];
    ctx.save();
    ctx.translate(D.COMBO_X + D.CHALLENGE_X, D.COMBO_Y + dy);
    ctx.scale(ech, ech);
    const boite = A.img('versusBox');
    if (boite) ctx.drawImage(boite, CN_ENCART.x, CN_ENCART.y, CN_ENCART.w, CN_ENCART.h);
    const vignette = A.img(e[0]);
    if (vignette) ctx.drawImage(vignette, e[1], e[2], 85, 100);
    for (let i = 3; i < e.length; i++) {
      // Les repères du fichier donnent la LIGNE DE BASE, pas le milieu.
      U.text(ctx, e[i][0], e[i][1], e[i][2],
        { size: e[i][3], color: '#ffffff', align: 'left', baseline: 'alphabetic', font: 'banana' });
    }
    ctx.restore();
  }

  AnimatorChallenge.prototype.attachComboStar = function () {
    this.comboStar = {
      value: this.comboId, scale: D.COMBOSTAR_SCALE,
      anim: 1, wait: 0, tourne: 0, distort: false, animCpt: 0, flying: false, done: false,
    };
  };
  AnimatorChallenge.prototype.swap = function (f1, f2) {
    Animator.prototype.swap.call(this, f1, f2);
    this.comboId = 0;
    this.comboStar = null;
    this.comboName = null;
  };
  AnimatorChallenge.prototype.explode = function (mcs, peteArmures, score) {
    Animator.prototype.explode.call(this, mcs, peteArmures, score);
    this.comboId++;
    if (this.comboStar == null) this.attachComboStar();
    else {
      this.comboStar.anim = CS_FLASH;
      this.comboStar.value = this.comboId;
    }
  };
  AnimatorChallenge.prototype.main = function (tmod) {
    Animator.prototype.main.call(this, tmod);
    const cs = this.comboStar;
    if (cs != null) {
      // La pellicule du clip #81 et ses scripts d'image (cf. CS_IMAGES) : la 9
      // arme l'attente, la 11 retient tant que la chaîne court, puis tant que
      // l'attente dure ; au-delà, le retrait file jusqu'à l'image 22.
      const avant = cs.anim;
      cs.anim += tmod;
      if (avant < 9 && cs.anim >= 9) cs.wait = CS_ATTENTE;
      if (avant <= 11 && cs.anim > 11) {
        if (!cs.done) cs.anim = 11;
        else { cs.wait -= tmod; if (cs.wait > 0) cs.anim = 11; }
      }
      if (cs.anim >= CS_FIN) this.comboStar = null;
      else {
        if (cs.flying) cs.tourne += tmod;
        if (cs.distort) {
          cs.animCpt += tmod * 0.4;
          cs.scaleX = 100 + Math.cos(cs.animCpt) * 5;
          cs.scaleY = 100 + Math.sin(cs.animCpt) * 5;
        }
      }
    }
    const cn = this.comboName;
    if (cn != null) {
      // Le clip #129 : l'image 12 arme une attente de 60, la 14 boucle sur
      // 13-14 tant qu'elle court — l'annonce SE TIENT une seconde et demie —,
      // puis la sortie file ; l'image 20 retire le clip.
      const avant = cn.frame;
      cn.frame += tmod;
      if (avant < 12 && cn.frame >= 12) cn.wait = CS_ATTENTE;
      if (avant <= 14 && cn.frame > 14) { cn.wait -= tmod; if (cn.wait > 0) cn.frame = 14; }
      if (cn.frame >= CN_IMAGES.length + 1) this.comboName = null;
    }
  };
  AnimatorChallenge.prototype.comboScore = function (score, nbCombos) {
    const mc = this.particules.attachFx('scorePop', this.explosions.x, this.explosions.y,
      { totalFrames: 30, text: score, big: score >= 1000 });
    if (U.getLod() === D.HIGH) mc.managers.push(U.sinManager);
    if (nbCombos > 0 && this.comboStar != null) {
      const scale = (nbCombos / E.COMBOS[E.COMBOS.length - 2]) * (100 - D.COMBOSTAR_SCALE);
      this.comboStar.scale = Math.min(100, D.COMBOSTAR_SCALE + scale);
      this.comboStar.anim = CS_FLASH;
      this.comboStar.value = nbCombos;
    }
  };
  AnimatorChallenge.prototype.finalComboScore = function (score, nbCombos) {
    if (score > 0) {
      A.play(A.SHOW_SCORE);
      if (this.comboStar == null) this.attachComboStar();
      const cs = this.comboStar;
      cs.scale = 100;
      cs.anim = CS_FLASH;
      cs.value = score;
      cs.distort = true;
      cs.done = true;
      cs.flying = score >= D.MIN_SUPER_COMBO;
      let i = 0;
      if (SW.Data.gameMode === SW.Data.CLASSIC) {
        while (i < E.COMBOS_CLASSIC.length && nbCombos >= E.COMBOS_CLASSIC[i]) i++;
      } else {
        while (i < E.COMBOS.length && nbCombos >= E.COMBOS[i]) i++;
        if (i > 0) TItem.addCombo(i - 1);
      }
      if (i > 0)
        this.comboName = { idx: i - 1, classic: SW.Data.gameMode === SW.Data.CLASSIC, frame: 1, wait: 0 };
    }
  };
  // L'étoile de combo — profondeur DP_INTERF : sous les effets.
  AnimatorChallenge.prototype.drawOverlays = function (ctx) {
    const cs = this.comboStar;
    if (cs == null) return;
    const a = csAnim(cs.anim);
    ctx.save();
    ctx.globalAlpha *= a.alpha;
    ctx.translate(D.COMBOSTAR_X, D.COMBOSTAR_Y);
    // Deux clips emboîtés, comme dans le SWF : l'étoile (#81, que `distort`
    // fait onduler et que la longueur de la chaîne fait grandir), puis sa
    // pellicule interne (`sub` #80) — décalage, rotation et échelle de
    // l'image courante.
    ctx.scale((cs.scaleX || cs.scale) / 100, (cs.scaleY || cs.scale) / 100);
    ctx.translate(a.x, a.y);
    ctx.rotate(a.rot * Math.PI / 180);
    ctx.scale(a.s, a.s);
    const incliner = (c, x, y) => { c.translate(x, y); c.rotate(10.5 * Math.PI / 180); };
    U.avecEclat(ctx, a.blanc, -70, -75, 140, 150, function (c) {
      // Les trois étoiles qui tournent passent DERRIÈRE (profondeur 1 dans
      // le SWF, contre 7 pour l'étoile) : le super combo se signale par une
      // ronde qui déborde de la grande étoile.
      if (cs.flying) {
        const ps = A.img('powerStar');
        if (ps) {
          for (let i = 0; i < 3; i++) {
            const ang = (-CS_VITESSE * cs.tourne + 60 + i * 120) * Math.PI / 180;
            c.drawImage(ps, CS_ORBITE * Math.cos(ang) - 18,
              CS_ORBITE * Math.sin(ang) - 18.5, 36, 37);
          }
        }
      }
      U.drawCentered(c, A.img('comboStar'), 0, 0, 1);
      if (cs.done) {
        // Image 1 de `sub` : le score final (champ #77, DooM 25) et « pts »
        // (texte #78, DooM 20), inclinés de 10,5° autour de leur ancrage.
        c.save();
        incliner(c, -46, -32.9);
        U.text(c, String(cs.value), 50, 26.3,
          { size: 25, color: '#fffd58', font: 'doom', baseline: 'alphabetic' });
        c.restore();
        c.save();
        incliner(c, -49.95, -11.8);
        U.text(c, 'pts', 28, 21,
          { size: 20, color: '#fcd256', font: 'doom', align: 'left', baseline: 'alphabetic' });
        c.restore();
      } else {
        // Image 2 : le compte de la chaîne (champ #79, DooM 43).
        c.save();
        incliner(c, -44.05, -35.95);
        U.text(c, String(cs.value), 48.25, 45.2,
          { size: 43, color: '#fffd58', font: 'doom', baseline: 'alphabetic' });
        c.restore();
      }
    });
    ctx.restore();
  };
  // L'annonce du cocktail — profondeur DP_LAST : par-dessus tout.
  AnimatorChallenge.prototype.drawAnnonce = function (ctx) {
    if (this.comboName != null) dessinerAnnonce(ctx, this.comboName);
  };

  // ── Player (Player.as) ───────────────────────────────────────────────────
  function Player(game, pid, infos, px, py, challengeAnimator) {
    this.id = pid;
    this.infos = infos;
    this.game = game;
    this.animator = challengeAnimator
      ? new AnimatorChallenge(this, px, py)
      : new Animator(this, px, py);
    const me = this;
    infos.onAttach = function (f, x, y) { me.animator.initSprite(f, x, y); };
    infos.onMoveUp = function (f) { me.animator.moveUp(f); };
    infos.onDestroy = function (f) { if (f.spr) f.spr.dead = true; };
    this.level = new E.Level(infos);
    this.game_over_flag = undefined;
    this.star_counter = 0;
    this.score = 0;
    this.horizontal_lock = 0;
    this.next_combo_double = false;
    this.sync_attacks = [];
    this.combo = [];
    this.combo_number = 0;
    this.combo_score = 0;
  }
  SW.Player = Player;

  Player.prototype.isIA = function () { return false; };
  Player.prototype.setVisible = function (b) { this.animator.setFruitsVisible(b); };
  Player.prototype.getLevelWidth = function () { return this.level.getWidth(); };
  Player.prototype.getLevelHeight = function () { return this.level.getHeight(); };

  Player.prototype.noMoreLine = function () {
    const fruits = this.level.getFruits();
    const w = this.level.getWidth();
    const y = this.level.getHeight() - 1;
    let prev = false;
    for (let x = 0; x < w; x++) {
      if (fruits[x][y] != null) {
        if (prev) return false;
        prev = true;
      } else prev = false;
    }
    return true;
  };

  Player.prototype.checkAttacks = function () {
    if (this.sync_attacks.length === 0) return false;
    const aid = this.sync_attacks[0];
    this.sync_attacks.splice(0, 1);
    this.attacked(aid, true);
    return true;
  };

  Player.prototype.main = function (tmod, deltaT) {
    if (this.horizontal_lock > 0) {
      this.horizontal_lock -= deltaT;
      if (this.horizontal_lock < 0) this.horizontal_lock = 0;
    }
    this.animator.main(tmod);
  };

  Player.prototype.destroy = function () {
    this.animator.destroy();
  };

  Player.prototype.swapDone = function () {
    let x = null;
    if (this.game_over_flag === undefined) {
      const combos = this.level.calc();
      if (combos != null) x = this.level.explode(combos);
    }
    if (x != null) {
      let nexpl = 0;
      this.combo_number++;
      for (let i = 0; i < x.combos.length; i++) nexpl += x.combos[i].v;
      const mcs = x.mcs;
      for (let i = 0; i < mcs.length; i++)
        if ((mcs[i].flags & E.FLAG_STAR) !== 0) {
          this.game.getPower(this, mcs[i]);
          this.star_counter++;
          if (this.star_counter > D.MAX_POWER) this.star_counter = D.MAX_POWER;
        }
      this.combo.push(nexpl);
      let explScore;
      if (SW.Data.gameMode === SW.Data.CLASSIC)
        explScore = E.calcScoreClassic(nexpl, this.combo_number, this.game.level);
      else
        explScore = E.calcScore(nexpl, this.combo_number);
      this.animator.explode(x.mcs, x.pete_armures, explScore);
      this.animator.comboScore(explScore, this.combo_number);
      this.combo_score += explScore;
    } else if (!this.checkAttacks())
      this.turnDone();
  };

  Player.prototype.explodeDone = function () {
    const p = this.combo.length - 1;
    const c = this.combo[p];
    this.game.sendFruits(this, c, p);
    if (this.next_combo_double) this.game.sendFruits(this, c, p);
    const mcs = this.level.gravity();
    if (mcs != null) this.animator.gravity(mcs);
    else this.swapDone();
  };

  Player.prototype.gravityDone = function () { this.swapDone(); };
  Player.prototype.fallingDone = function () { this.skipTurn(); };

  Player.prototype.skipTurn = function () {
    this.combo = [];
    this.combo_number = 0;
    this.combo_score = 0;
    this.swapDone();
  };

  Player.prototype.turnDone = function () {
    this.score += this.combo_score;
    this.animator.finalComboScore(this.combo_score, this.combo_number);
    this.next_combo_double = false;
    this.game.turnDone(this, this.combo);
  };

  Player.prototype.fallFruits = function () {
    const fruits = [];
    const sendList = this.game.getPool(this);
    const highs = [], sortedHighs = [];
    const tbl = this.level.getFruits();
    for (let x = 0; x < this.infos.width; x++) {
      let y;
      for (y = 0; y < this.infos.height; y++)
        if (tbl[x][y] != null) break;
      const k = { x: x, h: this.infos.height - y };
      highs.push(k);
      sortedHighs.push(k);
    }
    sortedHighs.sort(function (a, b) { return a.h - b.h; });

    while (sendList.length > 0) {
      const send = sendList[0];
      let n = 0;
      if (send.x === -1) {
        while (true) {
          if (this.isIA()) send.x = sortedHighs[random(4)].x;
          else send.x = random(this.infos.width);
          n++;
          if (n > 500 || this.level.getFruit(send.x, 1) == null) break;
        }
      }
      const f = this.level.addFruit(send.x, send.col, send.flags);
      highs[send.x].h++;
      sortedHighs.sort(function (a, b) { return a.h - b.h; });
      if (f == null) {
        this.game_over_flag = true;
        break;
      }
      fruits.push(f);
      sendList.splice(0, 1);
    }
    if (fruits.length > 0) {
      this.animator.falling(fruits);
      return true;
    }
    return false;
  };

  Player.prototype.updateSudden = function () {
    const f = this.level.getFruits();
    const sudden = [];
    const w = this.level.getWidth();
    for (let i = 0; i < w; i++)
      if (f[i][0] != null) sudden.push(f[i][0]);
    this.animator.suddenFruits(sudden);
  };

  Player.prototype.panic = function () {
    const w = this.level.getWidth();
    let x;
    for (x = 0; x < w; x++)
      if (this.level.getFruit(x, 1) != null) break;
    return x !== w;
  };

  Player.prototype.getPair = function (x, y) {
    return this.level.getPair(x, y, this.animator.getInfos());
  };
  Player.prototype.getPairWithDir = function (x, y, dx, dy) {
    return this.level.getPairWithDir(x, y, dx, dy, this.animator.getInfos());
  };

  Player.prototype.swapPair = function (p) {
    if (this.horizontal_lock > 0 && p != null && p.dx !== 0) return false;
    if (this.level.swapPair(p)) {
      this.combo = [];
      this.combo_number = 0;
      this.combo_score = 0;
      this.animator.swap(p.f1, p.f2);
      return true;
    }
    return false;
  };

  Player.prototype.isGameOver = function () { return this.game_over_flag === true; };
  Player.prototype.genLine = function () { return this.level.genLine(); };
  Player.prototype.canAttack = function () { return this.star_counter >= E.ATTACK_STARS[this.id]; };
  Player.prototype.canDefend = function () { return this.star_counter >= E.DEFENSE_STARS[this.id]; };
  Player.prototype.gameOver = function (wins) {
    this.animator.gameOver(wins, this.level.getFruits());
  };
  Player.prototype.specialDone = function () { this.swapDone(); };
  Player.prototype.specialDoneGravity = function () { this.explodeDone(); };
  Player.prototype.reset = function () { /* IA uniquement */ };

  // capture des skins courants (pour les révélations différées)
  Player.prototype.snapshotSkins = function (list) {
    for (let i = 0; i < list.length; i++)
      if (list[i] && list[i].spr) list[i].spr.preImg = A.fruitImage(list[i]);
  };

  Player.prototype.attacked = function (aid, sync) {
    const w = this.level.getWidth();
    const fruits = this.level.getFruits();
    switch (aid) {
      case 0: // VERTIGE : verrou horizontal
        if (!sync) { this.sync_attacks.push(aid); return false; }
        this.reset();
        this.horizontal_lock = E.HORIZ_LOCK_TIME;
        this.animator.tremblementDeTerre([], [], fruits);
        return true;
      case 1: // GROS NOYAU : 2 lignes gelées
        for (let y = 0; y < 2; y++)
          for (let x = 0; x < w; x++)
            this.game.sendTo(this, { col: this.infos.gen_fruit_color(), flags: E.FLAG_ARMURE, x: -1 });
        return false;
      case 2: // PETIT PEPIN : 1 ligne gelée
        for (let x = 0; x < w; x++)
          this.game.sendTo(this, { col: this.infos.gen_fruit_color(), flags: E.FLAG_ARMURE, x: -1 });
        return false;
      case 3: { // COLONNADE : 4 gelés sur une colonne
        const x = E.pickColonnadeColumn(this.level, random);
        for (let y = 0; y < 4; y++)
          this.game.sendTo(this, { col: this.infos.gen_fruit_color(), flags: E.FLAG_ARMURE, x: x });
        return false;
      }
      case 4: { // TREMBLETERRE
        if (!sync) { this.sync_attacks.push(aid); return false; }
        this.reset();
        const r = E.attackEarthquake(this.level);
        this.animator.tremblementDeTerre(r.rems, r.adds, fruits);
        return true;
      }
      case 5: // DOUBLE LA MISE (géré par l'attaquant)
        return false;
      case 6: { // COULEE DE METAL
        if (!sync) { this.sync_attacks.push(aid); return false; }
        this.reset();
        const r = E.attackCouleeMetal(this.level);
        this.animator.couleeMetal(r.acier, fruits);
        return true;
      }
    }
    return false;
  };

  Player.prototype.attack = function (p, sync) {
    const attackId = E.ATTACK_PLAYERS[this.id];
    this.star_counter -= E.ATTACK_STARS[this.id];
    this.animator.showAttack(E.ATTACK_NAMES[attackId]);
    if (attackId === 5) this.next_combo_double = true;
    return p.attacked(attackId, sync);
  };

  Player.prototype.defend = function () {
    const defenseId = E.DEFENSE_PLAYERS[this.id];
    this.star_counter -= E.DEFENSE_STARS[this.id];
    const fruits = this.level.getFruits();
    this.combo = [];
    this.combo_number = 0;
    this.combo_score = 0;
    let data = null;
    switch (defenseId) {
      case 0: data = E.defenseEcarteur(this.level); break;
      case 1: data = E.defenseEgaliseur(this.level); break;
      case 2: data = E.defenseCoupeur(this.level); break;
      case 3: data = E.defensePete1Ligne(this.level); break;
      case 4: {
        // skins capturés avant conversion pour la révélation différée
        const all = [];
        for (let x = 0; x < this.level.width; x++)
          for (let y = 0; y < this.level.height; y++)
            if (fruits[x][y] != null) all.push(fruits[x][y]);
        this.snapshotSkins(all);
        data = E.defenseConvertisseur(this.level, this.infos.gen_fruit_color);
        break;
      }
      case 5: {
        const all = [];
        for (let x = 0; x < this.level.width; x++)
          for (let y = 0; y < this.level.height; y++)
            if (fruits[x][y] != null) all.push(fruits[x][y]);
        this.snapshotSkins(all);
        data = E.defensePeteArmures(this.level);
        break;
      }
      case 6: data = E.defenseCombos2(this.level); break;
    }
    this.animator.dispatchDefense(data, fruits);
  };

  // ── IAPlayer (IAPlayer.as) ───────────────────────────────────────────────
  function IAPlayer(game, pid, infos, px, py, maxTime) {
    Player.call(this, game, pid, infos, px, py, false);
    this.ia = new E.IA(this.level, random);
    this.ia_lock = true;
    this.need_end = false;
    this.max_time = maxTime;
    this.ia_pair = null;
    this.ia_timer = 0;
    this.ia_counter = 0;
  }
  IAPlayer.prototype = Object.create(Player.prototype);
  SW.IAPlayer = IAPlayer;

  IAPlayer.prototype.isIA = function () { return true; };
  IAPlayer.prototype.start = function () {
    this.ia_lock = false;
    this.ia_pair = null;
    this.ia.processStart(this.horizontal_lock > 0);
    this.need_end = true;
    this.ia_timer = 0;
    this.ia_counter = 0;
  };
  IAPlayer.prototype.getIAPair = function () { return this.ia_pair; };
  IAPlayer.prototype.reset = function () {
    if (this.need_end) {
      this.ia.processEnd();
      this.need_end = false;
    }
    this.ia_lock = true;
    this.ia_pair = null;
  };
  IAPlayer.prototype.swapPair = function (p) {
    if (!Player.prototype.swapPair.call(this, p)) {
      // contournement historique (IAPlayer.as)
      this.reset();
      this.start();
      return false;
    }
    return true;
  };
  IAPlayer.prototype.main = function (tmod, deltaT) {
    Player.prototype.main.call(this, tmod, deltaT);
    if (!this.ia_lock) {
      if (random(Math.max(1, Math.floor(100 / tmod))) === 0 || this.star_counter === D.MAX_POWER) {
        let h = this.level.calcAvgHigh();
        let h2 = this.game.player.level.calcAvgHigh();
        if (random(6) === 0) { const t = h; h = h2; h2 = t; }
        if (h < h2) {
          if (this.canAttack()) this.game.iaAttack();
          else if (this.star_counter >= D.MAX_POWER - 1 && this.canDefend()) this.game.iaDefend();
        } else {
          if (this.canDefend()) this.game.iaDefend();
          else if (this.star_counter >= D.MAX_POWER - 1 && this.canAttack()) this.game.iaAttack();
        }
        if (this.ia_lock) return;
      }
      this.ia_timer += deltaT;
      const delta = 1 / E.IA_TIMES[this.id][2];
      while (this.ia_timer > delta) {
        this.ia_pair = this.ia.process(50);
        if (this.ia_pair != null) { this.need_end = false; break; }
        this.ia_timer -= delta;
        this.ia_counter++;
      }
      if (this.ia_pair != null && this.ia_counter * delta > this.max_time) {
        this.need_end = false;
        this.ia_pair = this.ia.processEnd();
      }
      if (this.ia_pair != null) this.ia_lock = true;
    }
  };

  // ── Pause (Pause.as) ─────────────────────────────────────────────────────
  function Pause(toggles, xOffset) {
    this.toggles = toggles;
    this.flag = false;
    this.key_flag = false;
    this.xOffset = xOffset;
    this.want = false; // demande via bouton tactile / Échap
  }
  SW.Pause = Pause;
  Pause.prototype.activated = function () { return this.flag; };
  Pause.prototype.togglesVisible = function (b) {
    for (let i = 0; i < this.toggles.length; i++) this.toggles[i].setVisible(b);
  };
  Pause.prototype.main = function () {
    const pressed = SW.escDown || this.want;
    this.want = false;
    if (this.flag) {
      if (pressed) {
        if (!this.key_flag) {
          this.togglesVisible(true);
          this.flag = false;
          this.key_flag = true;
          return false;
        }
      } else this.key_flag = false;
      return true;
    }
    if (pressed) {
      if (!this.key_flag) {
        this.key_flag = true;
        this.flag = true;
        this.togglesVisible(false);
        return true;
      }
    } else this.key_flag = false;
    return false;
  };
  Pause.prototype.draw = function (ctx) {
    if (!this.flag) return;
    // Pause.as ne pose que le clip `pauseBox` (#458) : son image, qui porte
    // déjà le mot — pas de voile sur le jeu, pas de texte en plus.
    const img = A.img('pauseBox');
    const x = D.DOCWIDTH / 2 + this.xOffset, y = D.DOCHEIGHT / 2;
    if (img) ctx.drawImage(img, x - 53.5, y - 23);
  };

  // bouton pause tactile (ajout mobile — Échap reste actif au clavier)
  SW.pauseBtnRect = { x: D.DOCWIDTH - 30, y: 4, w: 26, h: 26 };
  SW.drawPauseButton = function (ctx) {
    const r = SW.pauseBtnRect;
    ctx.save();
    ctx.globalAlpha = 0.55;
    U.roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fillStyle = '#2a4a10';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(r.x + 8, r.y + 7, 3.5, 12);
    ctx.fillRect(r.x + 14.5, r.y + 7, 3.5, 12);
    ctx.restore();
  };

  // ── Interf (Interf.as) ───────────────────────────────────────────────────
  function Interf(game, nbPlayers) {
    this.game = game;
    this.particules = new U.Particules();
    this.pl = [];
    for (let i = 0; i < nbPlayers; i++) this.pl[i] = newInterfPlayer();
    this.powerFx = [];
    this.lock = false;
    this.starScale = 0;
    this.maxFrame = 0;     // la pellicule du clip « max ! » (13 images en boucle)
    this.rollover = new U.Rollover();
  }
  SW.Interf = Interf;

  function newInterfPlayer() {
    return {
      face: null, maxIndicator: false, powerList: [],
      power: 0, oldPower: 0, powerX: 0, powerY: 0,
    };
  }

  Interf.prototype.main = function (tmod) {
    for (let p = 0; p < this.pl.length; p++) {
      const player = this.pl[p];
      player.face.update(tmod);
      if (player.powerList.length > 0) {
        this.starScale += 0.25;
        if (this.starScale >= Math.PI * D.POWER_JUMP_CYCLES)
          this.starScale -= Math.PI * D.POWER_JUMP_CYCLES;
        for (let i = 0; i < player.powerList.length; i++) {
          const mc = player.powerList[i];
          if (!mc) continue; // index 0 inutilisé (liste 1-based, cf. AS2)
          const cpt = this.starScale - i * 0.6;
          if (cpt >= 0 && cpt <= Math.PI)
            mc.scale = Math.abs(Math.sin(cpt)) * D.POWER_JUMP_SCALE + D.POWER_SCALE;
          else mc.scale = D.POWER_SCALE;
        }
      }
    }
    for (let i = 0; i < this.powerFx.length; i++) {
      const mc = this.powerFx[i];
      mc.x += mc.dx * tmod;
      mc.y += mc.dy * tmod;
      mc.spin = (mc.spin || 0) + tmod;     // le clip flyingStar tourne en volant
      if ((mc.dx < 0 && mc.x <= mc.tx) || (mc.dx > 0 && mc.x >= mc.tx)) {
        this.particules.attachFx('getPowerStar', mc.tx, mc.ty, { totalFrames: 10 });
        this.particules.heavyExplosion(mc.tx, mc.ty, mc.dx, mc.dy);
        this.updatePower(mc.plId);
        this.powerFx.splice(i, 1);
        i--;
      }
    }
    this.maxFrame += tmod;
    this.particules.main(tmod);
  };

  Interf.prototype.setLock = function (flag) { this.lock = flag; };

  Interf.prototype.updatePower = function (plId) {
    const player = this.pl[plId];
    while (player.power > player.oldPower) {
      const mc = {
        x: player.powerX,
        y: player.powerY - player.oldPower * D.POWER_HEIGHT,
        scale: D.POWER_SCALE,
        rot: random(40) / 10 * (random(2) * 2 - 1),
      };
      this.particules.explodeStar(mc.x, mc.y);
      player.oldPower++;
      player.powerList[player.oldPower] = mc;
    }
    while (player.power < player.oldPower) {
      const mc = player.powerList[player.oldPower];
      if (mc) this.particules.explodeStar(mc.x, mc.y);
      player.powerList.splice(player.oldPower, 1);
      player.oldPower--;
    }
    // L'indicateur « max ! » est ATTACHÉ quand la jauge se remplit : sa
    // pellicule repart de la première image (le flash blanc).
    const plein = player.power === D.MAX_POWER;
    if (plein && !player.maxIndicator) this.maxFrame = 0;
    player.maxIndicator = plein;
  };

  Interf.prototype.addPower = function (plId, fruit) {
    const player = this.pl[plId];
    player.power++;
    if (player.power > D.MAX_POWER) {
      player.power = D.MAX_POWER;
      this.particules.attachFx('getPowerStar',
        fruit.spr.x + D.FRUIT_WIDTH / 2, fruit.spr.y + D.FRUIT_HEIGHT / 2, { totalFrames: 10 });
    } else {
      const mc = {
        x: fruit.spr.x + D.FRUIT_WIDTH / 2,
        y: fruit.spr.y + D.FRUIT_HEIGHT / 2,
        tx: player.powerX,
        ty: player.powerY - D.POWER_HEIGHT * player.power + D.POWER_HEIGHT,
        plId: plId,
      };
      mc.dx = (mc.tx - mc.x) * 0.1;
      mc.dy = (mc.ty - mc.y) * 0.1;
      this.powerFx.push(mc);
    }
  };

  Interf.prototype.displayPair = function (p) {
    this.rollover.setPair(p, this.game.player.animator.getInfos(), this.game.player.horizontal_lock);
  };

  Interf.prototype.gameOver = function () {
    this.pl[0].face.shakeItBaby(50);
  };

  Interf.prototype.doAttack = function (plId) {
    const player = this.pl[plId];
    if (player.power >= E.ATTACK_STARS[SW.Data.players[plId]]) {
      player.face.setAttack(100);
      player.power -= E.ATTACK_STARS[SW.Data.players[plId]];
      this.updatePower(plId);
      return true;
    }
    return false;
  };
  Interf.prototype.attack = function () {
    if (this.doAttack(0)) this.game.attack();
  };
  Interf.prototype.doDefend = function (plId) {
    const player = this.pl[plId];
    if ((plId === 1 || !this.lock) && player.power >= E.DEFENSE_STARS[SW.Data.players[plId]]) {
      player.power -= E.DEFENSE_STARS[SW.Data.players[plId]];
      player.face.setAttack(100);
      this.updatePower(plId);
      return true;
    }
    return false;
  };
  Interf.prototype.defend = function () {
    if (this.doDefend(0)) this.game.defend();
  };

  // « maxIndicator » (#372) : le « max ! » vectoriel (forme #370, 39,75 × 13,25
  // centrée) posé au-dessus de la sixième étoile. Le clip n'a pas de stop :
  // ses treize images BOUCLENT — un flash blanc à 1,29 fois qui retombe en
  // huit images, puis cinq images de repos — le libellé clignote toutes les
  // 0,33 s. [échelle, part de blanc]
  const MAX_IMAGES = [[1.2889, 1], [1.2212, 0.762], [1.1625, 0.559], [1.1129, 0.391],
    [1.0722, 0.25], [1.0406, 0.141], [1.0181, 0.0625], [1.0045, 0.0156],
    [1, 0], [1, 0], [1, 0], [1, 0], [1, 0]];

  Interf.prototype.drawPowerStars = function (ctx) {
    const img = A.img('powerStar');
    for (let p = 0; p < this.pl.length; p++) {
      const player = this.pl[p];
      for (let i = 1; i <= player.oldPower; i++) {
        const mc = player.powerList[i];
        if (!mc) continue;
        ctx.save();
        ctx.translate(mc.x, mc.y);
        ctx.rotate(mc.rot * Math.PI / 180);
        const s = mc.scale / 100;
        if (img) ctx.drawImage(img, -18 * s, -18.5 * s, 36 * s, 37 * s);
        ctx.restore();
      }
      if (player.maxIndicator) {
        const im = MAX_IMAGES[Math.floor(this.maxFrame) % MAX_IMAGES.length];
        const max = A.img('max');
        ctx.save();
        ctx.translate(player.powerX, player.powerY - D.POWER_HEIGHT * player.power);
        ctx.scale(im[0], im[0]);
        U.avecEclat(ctx, im[1], -19, -6.3, 39.75, 13.25, function (c) {
          if (max && max.naturalWidth) c.drawImage(max, -19, -6.3, 39.75, 13.25);
        });
        ctx.restore();
      }
    }
  };

  // Les effets de l'interface, à la profondeur DP_FX : les étoiles EN VOL
  // (le clip flyingStar, #368 — l'étoile blanche qui tourne d'un cinquième de
  // tour en six images) et leurs éclats à l'arrivée. Le portage déplaçait ces
  // étoiles sans jamais les dessiner.
  Interf.prototype.drawFx = function (ctx) {
    for (let i = 0; i < this.powerFx.length; i++) {
      const mc = this.powerFx[i];
      const e = U.FLYING_STAR[Math.floor(mc.spin || 0) % U.FLYING_STAR.length];
      ctx.save();
      ctx.translate(mc.x + e[0], mc.y + e[1]);
      ctx.rotate(e[2] * Math.PI / 180);
      U.tracerForme(ctx, U.FORMES.etoile);
      ctx.restore();
    }
    this.particules.draw(ctx);
  };

  Interf.prototype.destroy = function () { this.particules.destroy(); };

  // fond commun : tuile bg + ligne de mort subite
  function drawBg(ctx, imgName) {
    const img = A.img(imgName);
    if (img && img.naturalWidth) {
      for (let x = 0; x < D.DOCWIDTH; x += img.naturalWidth)
        ctx.drawImage(img, x, 0);
    } else {
      ctx.fillStyle = '#7da33c';
      ctx.fillRect(0, 0, D.DOCWIDTH, D.DOCHEIGHT);
    }
    // La ligne de mort subite (`sdLimit`, #421) : le bitmap de 700 × 2 est posé
    // en (0, −2) dans son clip, et le clip à SUDDEN_Y — la ligne occupe donc
    // les pixels 28 et 29, à pleine opacité (l'image est déjà à moitié
    // transparente).
    const sd = A.img('sd');
    if (sd) ctx.drawImage(sd, 0, D.SUDDEN_Y - 2);
  }
  SW.drawBg = drawBg;

  function drawLeaves(ctx, x, y) {
    const img = A.img('feuilles');
    if (img) ctx.drawImage(img, x, y);
  }

  // ── InterfChallenge (InterfChallenge.as) ─────────────────────────────────
  function InterfChallenge(game) {
    Interf.call(this, game, 1);
    this.classic = SW.Data.gameMode === SW.Data.CLASSIC;
    this.pl[0].powerX = D.POWER_X;
    this.pl[0].powerY = D.POWER_Y;
    this.pl[0].face = new U.Face(SW.Data.players[0]);
    // L'icône est COLLÉE au panneau par son centre (InterfChallenge.as :
    // glue(leftPanel.sub, defenseIcon, ATTDEF_ICON_X, POWER_Y − (coût − 1) × 27)).
    this.defenseIcon = new U.IconButton('powerDef', this.defend.bind(this));
    this.defenseIcon.x = D.ATTDEF_ICON_X;
    this.defenseIcon.y = D.POWER_Y - (E.DEFENSE_STARS[SW.Data.players[0]] - 1) * D.POWER_HEIGHT;
    this.score = 0;
    this.viewScore = 0;
    this.classicModeOn = false;
    this.intro = 0;        // l'entrée des panneaux, en images (cf. PANNEAU_GAUCHE)
  }
  InterfChallenge.prototype = Object.create(Interf.prototype);
  SW.InterfChallenge = InterfChallenge;

  InterfChallenge.prototype.classicMode = function () {
    this.classicModeOn = true;
    this.defenseIcon.visible = false;
    this.pl[0].face.visible = false;
  };

  InterfChallenge.prototype.main = function (tmod) {
    Interf.prototype.main.call(this, tmod);
    this.intro += tmod;
    this.defenseIcon.update(tmod);
    this.defenseIcon.isOver = this.defenseIcon.hitTest(SW.mouse.x, SW.mouse.y);
    if (this.viewScore < this.score) {
      if (this.score - this.viewScore >= 1000)
        this.viewScore += Math.round(D.SCORE_SPEED * 2 * tmod);
      else
        this.viewScore += Math.round(D.SCORE_SPEED * tmod);
      if (this.viewScore >= this.score) this.viewScore = this.score;
    }
  };
  InterfChallenge.prototype.updateScore = function (score) { this.score = score; };
  InterfChallenge.prototype.setLock = function (flag) {
    Interf.prototype.setLock.call(this, flag);
    if (this.lock) this.defenseIcon.disable();
    else this.defenseIcon.enable();
  };
  InterfChallenge.prototype.handleClick = function (mx, my) {
    if (this.defenseIcon.visible && this.defenseIcon.hitTest(mx, my)) {
      this.defenseIcon.release();
      return true;
    }
    return false;
  };
  // ── Second parchemin : compteur de coups ─────────────────────────────────
  // Plutôt que d'entasser deux informations sur le parchemin du score, on
  // RÉPLIQUE celui-ci plus bas. La bande est recopiée depuis le panneau lui-même
  // (mêmes pixels, donc mêmes rouleaux de cuivre et même parchemin), à la même
  // abscisse : le veinage vertical du bois reste aligné, le raccord ne se voit
  // pas. Aucun nouvel asset n'est nécessaire.
  const COUPS_BANDE_H = 76;   // hauteur de la bande recopiée (rouleaux compris)
  const COUPS_DY = 82;        // décalage vertical du second parchemin
  const ETOILE_DY = 164;      // …et du troisième
  const COUPS_LARGEUR = 150;  // au-delà commence la colonne de bambou

  InterfChallenge.prototype.drawMovePanel = function (ctx) {
    const lp = A.img(this.classicModeOn || this.classic ? 'leftPanelClassic' : 'leftPanel');
    if (!lp) return;
    ctx.drawImage(lp, 0, 0, COUPS_LARGEUR, COUPS_BANDE_H,
                      0, COUPS_DY, COUPS_LARGEUR, COUPS_BANDE_H);
    // Le troisième parchemin — l'étoile — n'existe qu'en Challenge : le mode
    // Classique n'a pas de pouvoir, donc pas d'étoile à attendre.
    if (this.etoilesEnabled())
      ctx.drawImage(lp, 0, 0, COUPS_LARGEUR, COUPS_BANDE_H,
                        0, ETOILE_DY, COUPS_LARGEUR, COUPS_BANDE_H);
  };

  InterfChallenge.prototype.movesEnabled = function () {
    return !!(SW.Manager.client && SW.Manager.client.features && SW.Manager.client.features.swapouMoves);
  };
  /*
   * LE SECOND CADRAN DU PACK : LES FRUITS AVANT LA PROCHAINE ÉTOILE.
   *
   * Le pack en promet deux — « le nombre de coups que tu as joués, et le
   * nombre de fruits qui te séparent de la prochaine étoile de pouvoir » — et
   * seul le premier était dessiné. Le second se lit sans rien calculer :
   * `Challenge.star_counter` DÉCOMPTE les fruits engendrés depuis la dernière
   * étoile (`genFruitFlags` : `--this.star_counter === 0` fait naître
   * l'étoile puis remet le compteur à cent). C'est exactement le nombre
   * annoncé.
   *
   * En mode Classique, il n'y a ni pouvoir ni étoile : le cadran s'efface.
   */
  InterfChallenge.prototype.etoilesEnabled = function () {
    return this.movesEnabled() && !(this.classicModeOn || this.classic);
  };

  /* ── L'ENTRÉE DES PANNEAUX ─────────────────────────────────────────────────
   *
   * À l'ouverture de la partie, les deux panneaux GLISSENT en place : le
   * gauche vient de 177 px hors champ en sept images (clip #37), le droit de
   * 104 px en six (#45) — un cinquième de seconde. Tout ce qui est collé au
   * panneau gauche (Interf.glue : les feuilles, le visage, l'icône de pouvoir)
   * et ce qu'il contient (le score) le suivent. Les étoiles de pouvoir, elles,
   * sont posées en absolu — mais il n'y en a pas encore.
   */
  const PANNEAU_GAUCHE = [-177, -122.9, -78.65, -44.25, -19.65, -4.9, 0];
  const PANNEAU_DROIT = [104, 66.55, 37.45, 16.65, 4.15, 0];
  function glissement(table, t) {
    return table[Math.max(0, Math.min(table.length - 1, Math.floor(t)))];
  }
  /* LE SCORE, tel que le champ `scoreTxt` l'écrit : la fonte « cipher » en 24,
   * centrée sur son champ, et le champ ÉTIRÉ EN HAUTEUR par sa matrice
   * (× 1,6143 en Challenge, × 1,2235 en Classique) — d'où ces chiffres hauts
   * et serrés. La ligne de base est à 2 px de gutter plus l'ascendante de la
   * fonte (1006/1024) sous le haut du champ. */
  function dessinerScore(ctx, valeur, cx, haut, etirement, couleur) {
    ctx.save();
    ctx.translate(0, haut);
    ctx.scale(1, etirement);
    U.text(ctx, String(valeur), cx, 23.58,
      { size: 24, color: couleur, font: 'cipher', baseline: 'alphabetic' });
    ctx.restore();
  }

  InterfChallenge.prototype.drawBack = function (ctx) {
    drawBg(ctx, this.classicModeOn || this.classic ? 'bgClassic' : 'bg');
    const dx = glissement(PANNEAU_GAUCHE, this.intro);
    const lp = A.img(this.classicModeOn || this.classic ? 'leftPanelClassic' : 'leftPanel');
    if (lp) ctx.drawImage(lp, dx, 0);
    if (this.movesEnabled()) {
      ctx.save();
      ctx.translate(dx, 0);
      this.drawMovePanel(ctx);
      ctx.restore();
    }
    const rp = A.img(this.classicModeOn || this.classic ? 'rightPanelClassic' : 'rightPanel');
    if (rp) ctx.drawImage(rp, D.DOCWIDTH - rp.naturalWidth + glissement(PANNEAU_DROIT, this.intro), 0);
  };
  // Ce qui est posé aux profondeurs DP_INTERF et DP_INTERFTOP — sous les
  // effets de la partie, qui viennent après (Challenge.draw).
  InterfChallenge.prototype.drawFront = function (ctx) {
    const classique = this.classicModeOn || this.classic;
    ctx.save();
    ctx.translate(glissement(PANNEAU_GAUCHE, this.intro), 0);
    // Le score sur le parchemin (champ #29, brun ; #35 en Classique, jaune),
    // et son « pts » (texte #30, cipher 12).
    if (classique) dessinerScore(ctx, this.viewScore, 84.45, 16.85, 1.2235, '#fddf43');
    else {
      dessinerScore(ctx, this.viewScore, 68.4, 9.15, 1.6143, '#aa724b');
      U.text(ctx, 'pts', 61.7, 56.25,
        { size: 12, color: '#b37851', font: 'cipher', align: 'left', baseline: 'alphabetic' });
    }
    // Compteur de coups : sur SON parchemin, à la même place relative que le
    // score sur le sien, surmonté de son étiquette. N'apparaît que si le serveur
    // accorde l'option au joueur.
    if (this.movesEnabled()) {
      const n = (this.game && this.game.nmoves) || 0;
      U.text(ctx, 'COUPS', 88, 22 + COUPS_DY, { size: 9, color: '#8a6a37', align: 'center' });
      U.text(ctx, String(n), 88, 42 + COUPS_DY, { size: 20, color: '#5a3a10', align: 'center' });
    }
    // …et les fruits qui restent avant la prochaine étoile de pouvoir.
    if (this.etoilesEnabled()) {
      const e = (this.game && this.game.star_counter) || 0;
      U.text(ctx, 'ÉTOILE', 88, 22 + ETOILE_DY, { size: 9, color: '#8a6a37', align: 'center' });
      U.text(ctx, String(e), 88, 42 + ETOILE_DY, { size: 20, color: '#5a3a10', align: 'center' });
    }
    if (!this.classicModeOn) drawLeaves(ctx, D.LEAVES_X, D.LEAVES_Y);
    if (this.pl[0].face.visible)
      this.pl[0].face.draw(ctx, D.FACE_X, D.FACE_Y, D.FACE_WIDTH);
    this.defenseIcon.draw(ctx);
    ctx.restore();
    this.rollover.draw(ctx);
    this.drawPowerStars(ctx);
  };

  // ── Interf2P (Interf2P.as) ───────────────────────────────────────────────
  function Interf2P(game) {
    Interf.call(this, game, 2);
    this.pl[0].powerX = D.DUEL_POWER_X;
    this.pl[0].powerY = D.POWER_Y;
    this.pl[0].face = new U.Face(SW.Data.players[0]);
    this.pl[1].powerX = D.DOCWIDTH - D.DUEL_POWER_X;
    this.pl[1].powerY = D.POWER_Y;
    this.pl[1].face = new U.Face(SW.Data.players[1]);
    this.pl[1].face.flip();
    // Icônes collées au panneau par leur CENTRE (Interf2P.as, glue).
    this.attackIcon = new U.IconButton('powerAtt', this.attack.bind(this));
    this.attackIcon.x = D.DUEL_ATTDEF_ICON_X;
    this.attackIcon.y = D.POWER_Y - (E.ATTACK_STARS[SW.Data.players[0]] - 1) * D.POWER_HEIGHT;
    this.defenseIcon = new U.IconButton('powerDef', this.defend.bind(this));
    this.defenseIcon.x = D.DUEL_ATTDEF_ICON_X;
    this.defenseIcon.y = D.POWER_Y - (E.DEFENSE_STARS[SW.Data.players[0]] - 1) * D.POWER_HEIGHT;
    this.arrowRot = 90;
    this.pool = [];      // items visuels {x,y,scale,targetScale,scaleSpeed,timer,img}
    this.pool_temp = [];
    this.pool_for_ia = false;
  }
  Interf2P.prototype = Object.create(Interf.prototype);
  SW.Interf2P = Interf2P;

  Interf2P.prototype.main = function (tmod) {
    Interf.prototype.main.call(this, tmod);
    for (let i = 0; i < this.pool_temp.length; i++) {
      const f = this.pool_temp[i];
      if (f.timer > 0) f.timer -= tmod * Math.max(10 - i, 2);
      else {
        f.scale += f.scaleSpeed * tmod;
        if (f.scale <= 0) {
          this.pool_temp.splice(i, 1); i--;
        } else if (f.scale >= f.targetScale) {
          f.scale = f.targetScale;
          this.pool_temp.splice(i, 1); i--;
        }
      }
    }
    this.attackIcon.update(tmod);
    this.defenseIcon.update(tmod);
    this.attackIcon.isOver = this.attackIcon.hitTest(SW.mouse.x, SW.mouse.y);
    this.defenseIcon.isOver = this.defenseIcon.hitTest(SW.mouse.x, SW.mouse.y);
    this.updateArrow(tmod);
  };

  Interf2P.prototype.updateArrow = function (tmod) {
    let trot;
    if (this.pool.length === 0) trot = 90;
    else if (this.pool_for_ia) trot = 0;
    else trot = 179;
    let rot = this.arrowRot;
    if (rot < trot) { rot += tmod * 20; if (rot > trot) rot = trot; }
    else if (rot > trot) { rot -= tmod * 20; if (rot < trot) rot = trot; }
    this.arrowRot = rot;
  };

  Interf2P.prototype.destroyPoolItem = function () {
    const f = this.pool[this.pool.length - 1];
    this.pool.splice(this.pool.length - 1, 1);
    f.scaleSpeed = -12;
    if (f.timer <= 0) {
      f.timer = 50;
      this.pool_temp.push(f);
    }
  };

  Interf2P.prototype.addPoolItem = function (col, flags) {
    const fake = new E.Fruit(col, flags);
    const f = {
      img: A.fruitImage(fake),
      x: random(5) - 2 + D.DOCWIDTH / 2 - 3,
      y: 380 - this.pool.length * 16,
      timer: 50, scale: 0, scaleSpeed: 12, targetScale: 60 + random(10),
    };
    this.pool_temp.push(f);
    this.pool.push(f);
  };

  Interf2P.prototype.updatePool = function (mcs, pool_for_ia) {
    while (this.pool.length > mcs.length) this.destroyPoolItem();
    while (this.pool.length < mcs.length && this.pool.length < 19) {
      const p = mcs[this.pool.length];
      this.addPoolItem(p.col, p.flags);
    }
    this.pool_for_ia = pool_for_ia;
    const plface = this.pl[0].face;
    const iaface = this.pl[1].face;
    if (this.pool.length >= 10) {
      if (pool_for_ia) { plface.setHappy(50); iaface.panic(); }
      else { iaface.setHappy(50); plface.panic(); }
    }
  };

  Interf2P.prototype.setLock = function (flag) {
    Interf.prototype.setLock.call(this, flag);
    if (flag) this.defenseIcon.disable();
    else this.defenseIcon.enable();
  };
  Interf2P.prototype.lockAttack = function (flag) {
    if (flag) this.attackIcon.disable();
    else this.attackIcon.enable();
  };
  Interf2P.prototype.handleClick = function (mx, my) {
    if (this.attackIcon.hitTest(mx, my)) { this.attackIcon.release(); return true; }
    if (this.defenseIcon.hitTest(mx, my)) { this.defenseIcon.release(); return true; }
    return false;
  };

  Interf2P.prototype.drawBack = function (ctx) {
    drawBg(ctx, 'bg');
    const lp = A.img('leftPanelDuel');
    if (lp) ctx.drawImage(lp, 0, 0);
    const rp = A.img('rightPanelDuel');
    if (rp) ctx.drawImage(rp, D.DOCWIDTH - rp.naturalWidth, 0);
    const cp = A.img('centerPanel');
    if (cp) ctx.drawImage(cp, D.DOCWIDTH / 2 - cp.naturalWidth / 2, 0);
  };
  Interf2P.prototype.drawMask = function (ctx) {
    const m = A.img('centerPanelMask');
    if (m) ctx.drawImage(m, D.DOCWIDTH / 2 - m.naturalWidth / 2, 0);
  };
  Interf2P.prototype.drawFront = function (ctx) {
    this.drawMask(ctx);
    drawLeaves(ctx, D.DUEL_LEAVES_X, D.DUEL_LEAVES_Y);
    // pool de parasites au centre
    const items = this.pool.concat(this.pool_temp.filter(f => this.pool.indexOf(f) < 0));
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      const s = f.scale / 100;
      if (s <= 0 || !f.img) continue;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(s, s);
      ctx.drawImage(f.img, -19, -19, 38, 38);
      ctx.restore();
    }
    // flèche du pool
    const arrow = A.img('arrow');
    if (arrow) {
      ctx.save();
      ctx.translate(D.DOCWIDTH / 2, D.DOCHEIGHT - 32);
      ctx.rotate((this.arrowRot - 90) * Math.PI / 180);
      ctx.drawImage(arrow, -22, -16);
      ctx.restore();
    }
    this.drawPowerStars(ctx);
    this.attackIcon.draw(ctx);
    this.defenseIcon.draw(ctx);
    this.rollover.draw(ctx);
    const fs = D.FACE_WIDTH * D.DUEL_FACE_SCALE;
    this.pl[0].face.draw(ctx, D.DUEL_FACE_X, D.DUEL_FACE_Y, fs);
    this.pl[1].face.draw(ctx, D.DUEL_FACE_IA_X, D.DUEL_FACE_Y, fs);
    this.drawFx(ctx);
  };

  /* ── L'ANALYSE EN PARTIE (option admin `swapouAnalyse`) ──────────────────
   *
   * Le meilleur coup, dessiné par-dessus le plateau : un cadre pulsant sur la
   * paire à échanger (ou un anneau sur l'icône de défense), et un petit
   * panneau qui dit sa NATURE et sa RAISON — « combo, 9 fruits en 3 phases :
   * +540 », « coup silencieux : prépare 610 pts ». Le calcul (analyse.js,
   * une seconde environ) tourne dans un Worker : le jeu ne se fige jamais.
   *
   * Trois règles :
   *   · CHALLENGE SEULEMENT — le mode Classique, qui partage ce code, n'a
   *     pas l'option (AnalyseChallenge.active regarde le mode) ;
   *   · ON DEMANDE quand le plateau est stable — au départ, puis à chaque fin
   *     de tour, une fois la ligne montée et le verrou levé ;
   *   · ON JETTE ce qui est périmé — chaque demande porte un numéro, et une
   *     réponse arrivée après le coup suivant est ignorée.
   *
   * L'option ne se vend pas : c'est l'admin qui l'accorde (fiche joueur), et
   * elle ne vaut que sur ce compte-là — le serveur ne la rend qu'à lui.
   */
  function AnalyseChallenge(game) {
    this.game = game;
    this.worker = null;
    this.serie = 0;             // numéro de la demande en cours
    this.conseil = null;        // { coups, meilleur, profondeur, tempsMs }
    this.enCours = false;
    this.panne = false;         // Worker refusé ou planté : on se tait
    this.pulse = 0;
  }
  SW.AnalyseChallenge = AnalyseChallenge;

  AnalyseChallenge.active = function () {
    const c = SW.Manager && SW.Manager.client;
    return SW.Data.gameMode === SW.Data.CHALLENGE
      && !!(c && c.features && c.features.swapouAnalyse)
      && typeof Worker === 'function';
  };

  // La grille légère de l'analyseur ({t, s, fl} ou null), sans les sprites.
  AnalyseChallenge.prototype.grille = function () {
    const lvl = this.game.player.level;
    const g = [];
    for (let x = 0; x < lvl.width; x++) {
      g[x] = [];
      for (let y = 0; y < lvl.height; y++) {
        const f = lvl.fruits[x][y];
        g[x][y] = f == null ? null : { t: f.t, s: f.save_t, fl: f.flags };
      }
    }
    return g;
  };
  AnalyseChallenge.prototype.etat = function () {
    const p = this.game.player, id = SW.Data.players[0];
    return {
      charId: id,
      canDefend: p.canDefend() && this.game.interf.pl[0].power >= E.DEFENSE_STARS[id],
      stars: p.star_counter,
      ncoups: this.game.ncoups,
    };
  };

  AnalyseChallenge.prototype.demander = function () {
    if (this.panne) return;
    if (!this.worker) {
      const me = this;
      try {
        this.worker = new Worker('analyse.worker.js');
      } catch (e) { this.panne = true; return; }
      this.worker.onmessage = function (ev) {
        const m = ev.data || {};
        if (m.id !== me.serie) return;          // périmée : un coup a été joué depuis
        me.conseil = (m.resultat && m.resultat.meilleur) ? m.resultat : null;
        me.enCours = false;
      };
      this.worker.onerror = function () { me.panne = true; me.enCours = false; me.conseil = null; };
    }
    this.serie++;
    this.conseil = null;
    this.enCours = true;
    this.worker.postMessage({
      id: this.serie, grille: this.grille(), etat: this.etat(), options: { budgetMs: 1500 },
    });
  };
  // Le coup vient d'être joué : ce qui était conseillé ne vaut plus rien.
  AnalyseChallenge.prototype.oublier = function () {
    this.serie++;
    this.conseil = null;
    this.enCours = false;
  };
  AnalyseChallenge.prototype.destroy = function () {
    if (this.worker) { try { this.worker.terminate(); } catch (e) { /* déjà mort */ } }
    this.worker = null;
    this.conseil = null;
    this.enCours = false;
  };
  AnalyseChallenge.prototype.main = function (tmod) { this.pulse += 0.12 * tmod; };

  /* ── JOUER LE COUP CONSEILLÉ ──────────────────────────────────────────────
   *
   * Le panneau disait le coup ; il le JOUE maintenant. Le bouton ne répond
   * que lorsqu'il y a un conseil et que le plateau est rendu (`lock` levé) —
   * exactement les conditions dans lesquelles le joueur pourrait le jouer
   * lui-même. Ce n'est pas un raccourci : c'est le même coup, par le même
   * chemin (`jouerPaire` / `defend`), donc les mêmes compteurs, le même verrou
   * et le même oubli du conseil.
   */
  AnalyseChallenge.prototype.jouable = function () {
    const m = this.conseil && this.conseil.meilleur;
    if (!m || this.game.lock || this.game.pause.activated()) return null;
    if (m.type === 'defend') return m;
    return (m.type === 'swap' && m.pair) ? m : null;
  };
  AnalyseChallenge.prototype.surLeBouton = function (x, y) {
    const b = IA_BOUTON;
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  };
  AnalyseChallenge.prototype.clic = function (x, y) {
    if (this.panne || !this.surLeBouton(x, y)) return false;
    const m = this.jouable();
    if (!m) return true;                 // le bouton est là, mais il attend
    if (m.type === 'defend') { this.game.defend(); return true; }
    // La paire de l'analyseur est en cases ; le jeu la veut avec ses fruits.
    const lvl = this.game.player.level, p = m.pair;
    const col2 = lvl.fruits[p.x + p.dx];
    this.game.jouerPaire({
      x: p.x, y: p.y, dx: p.dx, dy: p.dy,
      f1: lvl.fruits[p.x] ? lvl.fruits[p.x][p.y] : null,
      f2: col2 ? (col2[p.y + p.dy] === undefined ? null : col2[p.y + p.dy]) : null,
    });
    return true;
  };
  AnalyseChallenge.prototype.dessinerBouton = function (ctx) {
    const b = IA_BOUTON;
    const pret = !!this.jouable();
    const survol = pret && this.surLeBouton(SW.mouse.x, SW.mouse.y);
    ctx.save();
    U.roundRect(ctx, b.x, b.y, b.w, b.h, 5);
    ctx.fillStyle = pret ? (survol ? '#ffd23f' : '#c8931f') : '#4a3a22';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pret ? '#ffe9a0' : '#6a5636';
    U.roundRect(ctx, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 5);
    ctx.stroke();
    ctx.restore();
    U.text(ctx, 'JOUER', b.x + b.w / 2, b.y + b.h / 2 + 1,
      { size: 11, color: pret ? '#3a2200' : '#8a7a5a' });
  };

  const IA_COULEURS = { combo: '#5ee06a', preparation: '#5fb8ff', attente: '#e0d8a0', defense: '#ff9d3f' };
  const IA_NOMS = { combo: 'COMBO', preparation: 'COUP SILENCIEUX', attente: 'SANS COMBO', defense: 'DÉFENSE' };
  // Le panneau : la zone libre du panneau de gauche, entre le parchemin des
  // coups (qui finit vers y = 158) et le visage (qui commence à 357), à
  // gauche de l'icône de défense (x = 106) et de la colonne d'étoiles.
  const IA_PANNEAU = { x: 6, y: 176, w: 94, h: 140 };
  // Le bouton « JOUER CE COUP », au bas du panneau.
  const IA_BOUTON = { x: 13, y: 286, w: 80, h: 22 };

  AnalyseChallenge.prototype.draw = function (ctx) {
    if (this.panne) return;
    const c = this.conseil, m = c && c.meilleur;
    if (m && !this.game.lock) {
      if (m.type === 'swap' && m.pair) this.drawPaire(ctx, m);
      else if (m.type === 'defend') this.drawDefense(ctx);
    }
    this.drawPanneau(ctx, c);
  };

  // Même géométrie que U.Rollover.setPair : le cadre part du fruit de gauche
  // (ou du haut) et tourne de 90° pour une paire verticale.
  AnalyseChallenge.prototype.drawPaire = function (ctx, m) {
    const lvl = this.game.player.level, p = m.pair;
    const f1 = lvl.getFruit(p.x, p.y), f2 = lvl.getFruit(p.x + p.dx, p.y + p.dy);
    if (!f1 || !f2 || !f1.spr || !f2.spr) return;
    let tx = f1.spr.x, ty = f1.spr.y, rot = 0;
    if (p.dy > 0) { rot = 90; tx += D.FRUIT_HEIGHT; }
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(rot * Math.PI / 180);
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(this.pulse));
    ctx.lineWidth = 4;
    ctx.strokeStyle = IA_COULEURS[m.nature] || '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    U.roundRect(ctx, 1, 1, D.FRUIT_WIDTH * 2 - 2, D.FRUIT_HEIGHT - 2, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(D.FRUIT_WIDTH, 4);
    ctx.lineTo(D.FRUIT_WIDTH, D.FRUIT_HEIGHT - 4);
    ctx.stroke();
    ctx.restore();
  };
  // L'icône de défense se dessine à (−23,5 ; −17,5) de son point : un anneau
  // centré sur le point la cerne.
  AnalyseChallenge.prototype.drawDefense = function (ctx) {
    const ic = this.game.interf.defenseIcon;
    if (!ic || ic.visible === false) return;
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(this.pulse));
    ctx.lineWidth = 4;
    ctx.strokeStyle = IA_COULEURS.defense;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(ic.x, ic.y, 27, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
  AnalyseChallenge.prototype.drawPanneau = function (ctx, c) {
    const P = IA_PANNEAU;
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#2b1a0a';
    U.roundRect(ctx, P.x, P.y, P.w, P.h, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#a8803a';
    U.roundRect(ctx, P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1, 7);
    ctx.stroke();
    ctx.restore();
    const x = P.x + 6, tx = P.x + P.w / 2;
    U.text(ctx, 'IA', x, P.y + 12, { size: 10, color: '#ffd23f', align: 'left' });
    const m = c && c.meilleur;
    this.dessinerBouton(ctx);
    if (this.enCours && !m) {
      U.text(ctx, 'réflexion…', tx, P.y + 40, { size: 10, color: '#d8ccb0', bold: false });
      return;
    }
    if (!m) return;
    // Une défense se nomme par son POUVOIR et son prix — « GLISSEMENT 2★ » —
    // plutôt que par un « DÉFENSE » qui ne dit ni quoi ni combien.
    const id = SW.Data.players[0];
    const titre = m.nature === 'defense'
      ? E.DEFENSE_NAMES[E.DEFENSE_PLAYERS[id]].trim() + ' ' + E.DEFENSE_STARS[id] + '★'
      : (IA_NOMS[m.nature] || '');
    U.text(ctx, titre, tx, P.y + 28, { size: 9, color: IA_COULEURS[m.nature] || '#fff' });
    const g = m.gain || {};
    let l1 = '', l2 = '';
    if (m.nature === 'combo') {
      l1 = '+' + g.score;
      l2 = g.pieces + ' fruits · ' + g.phases + ' phase' + (g.phases > 1 ? 's' : '');
    } else if (m.nature === 'preparation') {
      l1 = m.suite ? 'prépare ' + m.suite.score : 'range';
      l2 = m.suite ? (m.suite.pieces + ' fruits · ' + m.suite.phases + ' ph.') : '';
    } else if (m.nature === 'defense') {
      l1 = g.score > 0 ? '+' + g.score : 'pouvoir';
      l2 = g.cracked > 0 ? g.cracked + ' armure' + (g.cracked > 1 ? 's' : '') : '';
    } else {
      l1 = 'aucun combo';
      l2 = m.suite ? 'suite : ' + m.suite.score : '';
    }
    U.text(ctx, l1, tx, P.y + 48, { size: 15, color: '#fff' });
    if (l2) U.text(ctx, l2, tx, P.y + 64, { size: 8, color: '#d8ccb0', bold: false });
    // Pourquoi MAINTENANT : une défense à plateau bas surprend, sauf si la
    // banque est pleine — la prochaine étoile serait perdue.
    const indice = m.nature === 'defense' && (m.pleine || m.crise);
    if (indice)
      U.text(ctx, m.pleine ? 'banque pleine : à dépenser' : 'plateau au plafond', tx, P.y + 74,
        { size: 7, color: '#ffd23f', bold: false });
    // les deux suivants, en petit : de quoi comparer (un peu plus bas quand
    // l'indice occupe la ligne au-dessus)
    let y = P.y + (indice ? 87 : 82);
    for (let i = 1; i < Math.min(3, c.coups.length); i++) {
      const a = c.coups[i];
      const s = (i + 1) + '. ' + (a.nature === 'combo' ? '+' + a.gain.score
        : a.nature === 'preparation' ? 'prép. ' + (a.suite ? a.suite.score : '')
          : a.nature === 'defense' ? 'défense' : 'sans combo');
      U.text(ctx, s, x, y, { size: 8, color: IA_COULEURS[a.nature] || '#ccc', align: 'left', bold: false });
      y += 12;
    }
    // Le temps de calcul, en haut à droite : le bas du panneau est au bouton.
    if (c.tempsMs !== undefined)
      U.text(ctx, c.tempsMs + ' ms', P.x + P.w - 6, P.y + 12, { size: 7, color: '#8a7a5a', align: 'right', bold: false });
  };

  // ── Challenge (Challenge.as) ─────────────────────────────────────────────
  function Challenge() {
    A.playMusic(A.MUSIC_CHALLENGE);
    TItem.combo_nitems = 0;
    this.ncoups = 5;
    // Compteur de coups AFFICHABLE : nombre d'échanges joués depuis le début de
    // la partie. Distinct de `ncoups`, qui est un paramètre de difficulté (il
    // démarre à 5 en Challenge et se remet à zéro à chaque niveau en Classique).
    this.nmoves = 0;
    this.star_counter = E.CHALLENGE_STAR_COUNTER;
    this.player = new Player(this, SW.Data.players[0], this.gameParams(), D.GAMEX, D.GAMEY, true);
    this.interf = new InterfChallenge(this);
    this.pause = new Pause([], D.CHALLENGE_X);
    this.special_power = false;
    this.lock = false;
    this.setLock(false);
    this.gameInit();
    // L'analyse en partie, si l'admin l'a accordée — et en Challenge seulement.
    this.analyse = AnalyseChallenge.active() ? new AnalyseChallenge(this) : null;
    if (this.analyse) this.analyse.demander();
  }
  SW.Challenge = Challenge;

  Challenge.prototype.gameParams = function () {
    const me = this;
    return {
      width: E.CHALLENGE_LEVEL_WIDTH,
      height: E.CHALLENGE_LEVEL_HEIGHT,
      min: E.CHALLENGE_MIN_COMBO,
      gen_fruit_flags: function () { return me.genFruitFlags(); },
      gen_fruit_color: function () { return me.genFruitColor(); },
    };
  };
  Challenge.prototype.gameInit = function () {
    for (let i = 0; i < 3; i++) this.player.genLine();
  };
  Challenge.prototype.send = function () {};
  Challenge.prototype.sendTo = function () {};
  Challenge.prototype.getPool = function () { return []; };
  Challenge.prototype.setLock = function (flag) {
    this.lock = flag;
    this.interf.setLock(flag);
  };
  Challenge.prototype.getPower = function (context, mc) {
    this.interf.addPower(0, mc);
  };
  Challenge.prototype.genFruitFlags = function () {
    const isArmure = (random(130) < random(this.ncoups));
    const isNoswap = !isArmure && (random(250) < random(this.ncoups));
    let isStar = !isArmure && !isNoswap && (--this.star_counter === 0);
    if (isStar) this.star_counter = E.CHALLENGE_STAR_COUNTER;
    return (isArmure ? E.FLAG_ARMURE : 0) | (isStar ? E.FLAG_STAR : 0) | (isNoswap ? E.FLAG_NOSWAP : 0);
  };
  Challenge.prototype.genFruitColor = function () {
    return random(E.CHALLENGE_MAX_COLORS);
  };
  Challenge.prototype.destroy = function () {
    this.interf.destroy();
    this.player.destroy();
    if (this.analyse) { this.analyse.destroy(); this.analyse = null; }
  };
  Challenge.prototype.sendFruits = function () {};
  Challenge.prototype.turnDone = function () {
    this.interf.updateScore(this.player.score);
    if (this.special_power && this.player.noMoreLine())
      this.special_power = false;
    if (this.special_power === false && !this.player.genLine()) {
      this.interf.gameOver(true);
      this.interf.pl[0].face.setDead(0xFFFFF);
      this.player.gameOver(false);
      const g = SW.Manager.gameOver(this.player.score);
      if (SW.Data.gameMode === SW.Data.CLASSIC)
        g.winTitem(TItem.classicItems(this.level));
      else
        g.winTitem(TItem.combo_nitems);
    } else {
      this.player.updateSudden();
      this.special_power = false;
      this.setLock(false);
      if (this.player.panic()) this.interf.pl[0].face.panic();
      else this.interf.pl[0].face.normal();
      if (this.player.combo_score > D.CHALLENGE_HAPPY_SCORE)
        this.interf.pl[0].face.setHappy(D.CHALLENGE_HAPPY_TIME);
      // Le plateau est stable et la ligne a monté : c'est LÀ qu'on analyse.
      if (this.analyse) this.analyse.demander();
    }
  };
  // Un échange, d'où qu'il vienne : la souris, le doigt, ou le bouton de l'IA.
  Challenge.prototype.jouerPaire = function (fpair) {
    if (!this.player.swapPair(fpair)) return false;
    SW.Manager.client.nswaps++;
    this.ncoups++;
    this.nmoves = (this.nmoves || 0) + 1;     // compteur affichable (cf. drawFront)
    this.setLock(true);
    if (this.analyse) this.analyse.oublier();
    return true;
  };
  Challenge.prototype.gameClick = function () {
    if (this.lock || this.pause.activated()) return;
    if (this.interf.handleClick(SW.mouse.x, SW.mouse.y)) return;
    if (this.analyse && this.analyse.clic(SW.mouse.x, SW.mouse.y)) return;
    this.jouerPaire(SW.pickPair(this.player));
  };
  Challenge.prototype.defend = function () {
    if (!this.lock && this.player.canDefend()) {
      this.setLock(true);
      this.special_power = true;
      this.player.defend();
      if (this.analyse) this.analyse.oublier();
    }
  };
  Challenge.prototype.iaAttack = function () {};
  Challenge.prototype.iaDefend = function () {};
  Challenge.prototype.main = function (tmod, deltaT) {
    if (this.pause.main()) return;
    let fpair = null;
    if (!this.lock && !SW.mouse.outside)
      fpair = SW.pickPair(this.player);
    this.interf.displayPair(fpair);
    this.player.main(tmod, deltaT);
    this.interf.main(tmod);
    if (this.analyse) this.analyse.main(tmod);
  };
  // Dans l'ordre des profondeurs du SWF : le fond et les panneaux (DP_BG), les
  // fruits (DP_FRUITS), l'interface et l'étoile de combo (DP_INTERF, DP_INTERFTOP),
  // les effets de la partie et de l'interface (DP_FX, DP_FXTOP), l'annonce du
  // cocktail (DP_LAST).
  Challenge.prototype.draw = function (ctx) {
    this.interf.drawBack(ctx);
    this.player.animator.drawFruits(ctx, this.player.level);
    this.interf.drawFront(ctx);
    if (this.player.animator.drawOverlays) this.player.animator.drawOverlays(ctx);
    this.player.animator.particules.draw(ctx);
    this.interf.drawFx(ctx);
    if (this.player.animator.drawAnnonce) this.player.animator.drawAnnonce(ctx);
    // Le conseil de l'IA, par-dessus tout — sauf la pause.
    if (this.analyse) this.analyse.draw(ctx);
    this.drawExtra(ctx);
    SW.drawPauseButton(ctx);
    this.pause.draw(ctx);
  };
  Challenge.prototype.drawExtra = function () {};
  Challenge.prototype.onClickDown = function () { this.gameClick(); };

  // ── Classic (Classic.as) ─────────────────────────────────────────────────
  function Classic() {
    Challenge.call(this);
    this.ncoups = 1;
    this.level = 0;
    this.lup = null;
    this.lupShow = 0;
    this.interf.classicMode();
    this.player.genLine();
  }
  Classic.prototype = Object.create(Challenge.prototype);
  SW.Classic = Classic;

  Classic.prototype.gameParams = function () {
    const me = this;
    return {
      width: E.CHALLENGE_LEVEL_WIDTH,
      height: E.CHALLENGE_LEVEL_HEIGHT,
      min: 2,
      gen_fruit_flags: function () { return me.genFruitFlags(); },
      gen_fruit_color: function () { return me.genFruitColor(); },
    };
  };
  Classic.prototype.gameInit = function () {};
  Classic.prototype.genFruitFlags = function () { return 0; };
  Classic.prototype.genFruitColor = function () {
    const nfruits = Math.min(this.level + 2, 11);
    return random(nfruits);
  };
  Classic.prototype.main = function (tmod, deltaT) {
    if (this.ncoups > E.CLASSIC_LEVELS[this.level]) {
      this.ncoups = 0;
      this.level++;
      this.lup = 'Niveau ' + this.level;
    }
    if (this.lup != null && !this.lock) {
      this.lupShow = 70;
      this.lupText = this.lup;
      this.lup = null;
    }
    if (this.lupShow > 0) this.lupShow -= tmod;
    Challenge.prototype.main.call(this, tmod, deltaT);
  };
  Classic.prototype.drawExtra = function (ctx) {
    if (this.lupShow > 0) {
      const k = Math.min(1, (70 - this.lupShow) / 6);
      const y = D.DOCHEIGHT - 60 * k;
      const img = A.img('levelBox');
      const x = D.CHALLENGE_X + D.DOCWIDTH / 2;
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.lupShow / 10);
      if (img) ctx.drawImage(img, x - 53.5, y - 23);
      U.text(ctx, this.lupText, x, y, { size: 15, color: '#3a7a1a', stroke: '#fff3d8', strokeWidth: 3 });
      ctx.restore();
    }
  };

  // ── Duel (Duel.as) ───────────────────────────────────────────────────────
  function Duel() {
    if (SW.Data.gameMode !== SW.Data.DUEL) {
      if (SW.Data.gameMode === SW.Data.HISTORY && SW.Data.histoPhase === 6)
        SW.Data.difficulty = 3; // Wasabii 2e forme
      else
        SW.Data.difficulty = 2;
    }
    A.playMusic(A.MUSIC_DUEL);
    this.interf = new Interf2P(this);
    this.player = new Player(this, SW.Data.players[0], this.duelParams(false), D.DUEL_PLX, D.DUEL_PLY, false);
    this.ia = new IAPlayer(this, SW.Data.players[1], this.duelParams(true), D.DUEL_IAX, D.DUEL_IAY,
      E.IA_TIMES[SW.Data.players[1]][1]);
    this.pause = new Pause([this.player, this.ia], 0);
    this.plface = this.interf.pl[0].face;
    this.iaface = this.interf.pl[1].face;
    this.pool = [];
    this.pool_for_ia = false;
    this.ia_star_counter = E.DUEL_IA_STAR_COUNTER[SW.Data.difficulty];
    this.pl_star_counter = E.DUEL_STAR_COUNTER;
    for (let i = 0; i < 3; i++) {
      this.player.genLine();
      this.ia.genLine();
    }
    this.game_over_flag = false;
    this.player_special_combo = false;
    this.ia_special_combo = false;
    this.pl_lock = false;
    this.ia_lock = false;
    this.player_timer = 0;
    this.ia_timer = 0;
    this.playerStart();
    this.iaStart();
  }
  SW.Duel = Duel;

  Duel.prototype.duelParams = function (isIa) {
    const me = this;
    return {
      width: E.DUEL_LEVEL_WIDTH,
      height: E.DUEL_LEVEL_HEIGHT,
      min: E.CHALLENGE_MIN_COMBO,
      gen_fruit_flags: function () { return me.genFruitFlags(isIa); },
      gen_fruit_color: function () { return me.genFruitColor(isIa); },
    };
  };

  Duel.prototype.send = function (from, fruit) {
    if (from === this.player) {
      if (this.pool_for_ia) this.pool.push(fruit);
      else {
        if (this.pool.length > 0) this.pool.splice(this.pool.length - 1, 1);
        else {
          this.pool.push(fruit);
          this.pool_for_ia = true;
        }
      }
    } else {
      if (this.pool_for_ia) {
        if (this.pool.length > 0) this.pool.splice(this.pool.length - 1, 1);
        else {
          this.pool.push(fruit);
          this.pool_for_ia = false;
        }
      } else this.pool.push(fruit);
    }
    this.interf.updatePool(this.pool, this.pool_for_ia);
  };
  Duel.prototype.sendTo = function (to, fruit) {
    if (to === this.player) this.send(this.ia, fruit);
    else this.send(this.player, fruit);
  };
  Duel.prototype.setPlLock = function (flag) {
    this.interf.setLock(flag);
    this.pl_lock = flag;
  };
  Duel.prototype.playerStart = function () {
    this.setPlLock(false);
    this.player_timer = E.DUEL_MAX_TIME[SW.Data.difficulty];
  };
  Duel.prototype.iaStart = function () {
    this.ia_lock = false;
    this.ia_timer = E.IA_TIMES[SW.Data.players[1]][0];
    this.ia.start();
  };
  Duel.prototype.genFruitFlags = function (isIa) {
    const isArmure = (random(10) === 0);
    const isNoswap = !isArmure && (random(40) === 0);
    let isStar;
    if (isIa) {
      isStar = !isArmure && !isNoswap && (--this.ia_star_counter === 0);
      if (isStar) this.ia_star_counter = E.DUEL_IA_STAR_COUNTER[SW.Data.difficulty];
    } else {
      isStar = !isArmure && !isNoswap && (--this.pl_star_counter === 0);
      if (isStar) this.pl_star_counter = E.DUEL_STAR_COUNTER;
    }
    return (isArmure ? E.FLAG_ARMURE : 0) | (isStar ? E.FLAG_STAR : 0) | (isNoswap ? E.FLAG_NOSWAP : 0);
  };
  Duel.prototype.genFruitColor = function () {
    return random(E.DUEL_MAX_COLORS);
  };
  Duel.prototype.getPool = function (pl) {
    if ((pl === this.ia && this.pool_for_ia) || (pl === this.player && !this.pool_for_ia)) {
      if (this.pool.length > 0) {
        if (this.pool_for_ia) this.iaface.setHit(30);
        else this.plface.setHit(30);
      }
      const p = this.pool;
      this.pool = [];
      this.interf.updatePool(this.pool, this.pool_for_ia);
      return p;
    }
    return [];
  };
  Duel.prototype.destroy = function () {
    this.player.destroy();
    this.ia.destroy();
    this.interf.destroy();
  };
  Duel.prototype.sendFruits = function (pl, c, p) {
    let nsend = E.sendFruitsCount(pl === this.ia, c, p, SW.Data.difficulty);
    while (nsend > 0) {
      this.send(pl, { col: random(E.DUEL_MAX_COLORS), flags: E.FLAG_ARMURE, x: -1 });
      nsend--;
    }
  };
  Duel.prototype.getPower = function (context, mc) {
    if (context === this.player) this.interf.addPower(0, mc);
    else this.interf.addPower(1, mc);
  };
  Duel.prototype.turnDone = function (pl) {
    if (this.game_over_flag) return;
    if (pl === this.player) {
      if (this.player.isGameOver() || (!this.player_special_combo && !this.player.genLine())) {
        this.game_over_flag = true;
        this.interf.gameOver(true);
        this.player.gameOver(false);
        this.ia.game_over_flag = false;
        this.plface.setDead(0xFFFFF);
        this.iaface.setHappy(0xFFFFF);
        SW.Manager.gameOver(0);
      } else {
        if (this.player.fallFruits()) {
          this.player_special_combo = true;
          return;
        }
        this.interf.lockAttack(false);
        this.player.updateSudden();
        this.player_special_combo = false;
        if (this.player.panic()) this.plface.panic();
        else this.plface.normal();
        this.playerStart();
      }
    } else {
      if (this.ia.isGameOver() || (!this.ia_special_combo && !this.ia.genLine())) {
        this.game_over_flag = true;
        this.interf.gameOver(false);
        this.plface.setHappy(0xFFFFF);
        this.iaface.setDead(0xFFFFF);
        this.ia.gameOver(false);
        this.player.game_over_flag = false;
        const g = SW.Manager.gameOver(1);
        if (SW.Data.gameMode === SW.Data.HISTORY)
          g.winTitem(TItem.histoItems());
        else if (SW.Data.gameMode === SW.Data.DUEL && SW.Data.difficulty === 4)
          g.winTitem(TItem.duelItem());
      } else {
        if (this.ia.fallFruits()) {
          this.ia_special_combo = true;
          return;
        }
        this.ia.updateSudden();
        this.ia_special_combo = false;
        if (this.ia.panic()) this.iaface.panic();
        else this.iaface.normal();
        this.iaStart();
      }
    }
  };
  Duel.prototype.gameClick = function () {
    if (this.pause.activated()) return;
    if (this.interf.handleClick(SW.mouse.x, SW.mouse.y)) return;
    if (this.pl_lock) return;
    const fpair = SW.pickPair(this.player);
    if (this.player.swapPair(fpair)) {
      SW.Manager.client.nswaps++;
      this.setPlLock(true);
    }
  };
  Duel.prototype.defend = function () {
    if (this.pause.activated()) return;
    if (!this.pl_lock && this.player.canDefend()) {
      this.setPlLock(true);
      this.player_special_combo = true;
      this.player.defend();
    }
  };
  Duel.prototype.attack = function () {
    if (this.pause.activated()) return;
    if (this.player.canAttack()) {
      this.interf.lockAttack(true);
      if (this.ia_lock)
        this.player.attack(this.ia, false);
      else {
        if (this.player.attack(this.ia, true)) {
          this.ia_lock = true;
          this.ia_special_combo = true;
        }
      }
    }
  };
  Duel.prototype.iaAttack = function () {
    if (this.ia.canAttack()) {
      this.interf.doAttack(1);
      if (this.pl_lock)
        this.ia.attack(this.player, false);
      else {
        if (this.ia.attack(this.player, true)) {
          this.setPlLock(true);
          this.player_special_combo = true;
        }
      }
    }
  };
  Duel.prototype.iaDefend = function () {
    if (!this.ia_lock && this.ia.canDefend()) {
      this.interf.doDefend(1);
      this.ia_lock = true;
      this.ia.reset();
      this.ia_special_combo = true;
      this.ia.defend();
    }
  };
  Duel.prototype.main = function (tmod, deltaT) {
    if (this.pause.main()) return;
    if (!this.pl_lock) {
      this.player_timer -= deltaT;
      if (this.player_timer <= 0) {
        this.setPlLock(true);
        this.player.skipTurn();
      }
    }
    this.player.main(tmod, deltaT);
    this.ia.main(tmod, deltaT);
    this.interf.main(tmod);
    if (!this.ia_lock) {
      const iaPair = this.ia.getIAPair();
      this.ia_timer -= deltaT;
      if (iaPair != null && this.ia_timer <= 0) {
        this.ia_lock = true;
        this.ia.swapPair(iaPair);
      }
    }
    let fpair = null;
    if (!this.pl_lock && !SW.mouse.outside)
      fpair = SW.pickPair(this.player);
    this.interf.displayPair(fpair);
  };
  Duel.prototype.draw = function (ctx) {
    this.interf.drawBack(ctx);
    this.player.animator.drawFruits(ctx, this.player.level);
    this.ia.animator.drawFruits(ctx, this.ia.level);
    this.player.animator.particules.draw(ctx);
    this.ia.animator.particules.draw(ctx);
    this.interf.drawFront(ctx);
    SW.drawPauseButton(ctx);
    this.pause.draw(ctx);
  };
  Duel.prototype.onClickDown = function () { this.gameClick(); };
})();
