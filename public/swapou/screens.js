/*
 * Swapou 2 — écrans (Menu.as, HistoMap.as, GameOver.as) + Manager.as,
 * boucle de jeu et entrées.
 */
'use strict';

(function () {
  const E = SwapouEngine;
  const U = SwapouUI;
  const A = SwapouAssets;
  const D = U.D;
  const DATA = SwapouData;
  const random = U.random;

  // ── Menu (Menu.as) ───────────────────────────────────────────────────────
  function Menu() {
    if (!Manager.start_menu) A.playMusic(A.MUSIC_MENU);
    this.btList = [];
    this.phase = 10;
    this.animPhase = 0;
    this.stack = [];
    this.titles = []; // { text, kill, frame }
    this.onEnd = null;
    this.wait = 10;
    this.selectedButton = 0;
    this.clicked = false;
    this.lock = false;
    this.wins_flag = undefined;
    this.wantedPlayer = 0;
    this.netLocked = false;
    this.helpText = '';
    this.versus = null;
    this.versusHide = 0;

    // gros fruit du menu
    this.menuFruitImg = ['menuPomme', 'menuPoire', 'menuOrange'][random(3)];
    this.fruit = {
      x: D.MENU_FRUIT_X, y: D.MENU_FRUIT_Y, curX: D.MENU_FRUIT_X, curY: D.MENU_FRUIT_Y,
      scale: 20, alpha: 100, cpt: 0, scaleCpt: 0, ds: 0, visible: false,
    };
    this.leftCharX = 200;
    this.rightCharX = D.DOCWIDTH - 200;
    this.charScale = D.CHAR_SCALE;
    this.charsVisible = true;
    this.logoVisible = false;
    this.logoHide = 0;
    this.barVisible = false;
  }
  Menu.prototype.destroy = function () {};

  Menu.prototype.main = function (tmod) {
    const f = this.fruit;
    if (U.getLod() >= D.MEDIUM) {
      f.curX = f.x + Math.cos(f.cpt) * D.MENU_FRUIT_MOVE / 2;
      f.curY = f.y + Math.sin(f.cpt) * D.MENU_FRUIT_MOVE;
    } else { f.curX = f.x; f.curY = f.y; }
    f.cpt += 0.05 * tmod;

    switch (this.animPhase) {
      case 0:
        this.logoVisible = true;
        this.waitClick();
        this.animPhase++;
        break;
      case 1:
        this.wait -= tmod;
        if (this.clicked) {
          this.logoHide = 12;
          this.barVisible = true;
          f.visible = true;
          this.animPhase = 15;
        }
        break;
      case 10:
        this.charScale += (100 - this.charScale) * 0.3;
        if (this.charScale >= D.CHAR_SCALE - 3) {
          this.charScale = D.CHAR_SCALE;
          this.animPhase = 15;
        }
        break;
      case 15:
        this.leftCharX -= this.leftCharX * 0.3;
        this.rightCharX += (D.DOCWIDTH - this.rightCharX) * 0.3;
        if (this.leftCharX <= 5) {
          this.leftCharX = 0;
          this.rightCharX = D.DOCWIDTH;
          f.ds = 0;
          this.animPhase++;
        }
        break;
      case 16:
        f.scale += tmod * (100 - f.scale) * 0.2;
        if (f.scale >= D.MENU_FRUIT_SCALE - 3) {
          f.scale = D.MENU_FRUIT_SCALE;
          this.animPhase++;
        }
        break;
      case 17:
        if (!this.lock) {
          this.jump(this.phase);
          this.animPhase = 20;
        }
        break;
      case 20:
        if (U.getLod() >= D.HIGH) {
          f.scaleX = Math.sin(f.scaleCpt + Math.PI) * 5 + D.MENU_FRUIT_SCALE;
          f.scaleY = Math.sin(f.scaleCpt) * 5 + D.MENU_FRUIT_SCALE;
        } else { f.scaleX = f.scaleY = D.MENU_FRUIT_SCALE; }
        f.scaleCpt += 0.13 * tmod;
        break;
      case 30:
        f.ds += D.MENU_MOVE * tmod;
        f.scale -= f.ds * tmod;
        f.scaleX = f.scaleY = f.scale;
        f.alpha = f.scale;
        if (f.scale < 0) this.animPhase++;
        break;
      case 31:
        this.leftCharX -= 13 * tmod;
        this.rightCharX += 13 * tmod;
        if (this.leftCharX <= -220) {
          if ((SW.Data.gameMode === SW.Data.CHALLENGE && !this.lock) ||
            SW.Data.gameMode === SW.Data.HISTORY || SW.Data.gameMode === SW.Data.CLASSIC)
            this.onEnd();
          if (SW.Data.gameMode === SW.Data.DUEL) this.animPhase = 40;
        }
        break;
      case 40:
        this.attachVersus();
        this.waitClick();
        this.animPhase++;
        break;
      case 41:
        if (this.clicked) {
          this.versusHide = 10;
          this.animPhase++;
        }
        break;
      case 42:
        this.versusHide -= tmod;
        if (this.versusHide <= 0) {
          this.versus = null;
          this.animPhase++;
        }
        break;
      case 43:
        if (!this.lock) this.onEnd();
        break;
    }
    if (this.logoHide > 0) this.logoHide -= tmod;
    if (this.logoHide < 0) { this.logoHide = 0; this.logoVisible = false; }

    for (let i = 0; i < this.titles.length; i++) {
      const t = this.titles[i];
      if (!t.kill) t.frame = Math.min(t.frame + tmod, 8);
      else {
        t.frame -= tmod;
        if (t.frame <= 0) { this.titles.splice(i, 1); i--; }
      }
    }

    for (let i = 0; i < this.btList.length; i++) {
      const bt = this.btList[i];
      bt.move(tmod);
      if (bt.kill) {
        this.btList.splice(i, 1);
        i--;
        if (this.btList.length === 0) this.onHidden();
      }
    }

    // survol (souris uniquement)
    for (let i = 0; i < this.btList.length; i++) {
      const bt = this.btList[i];
      bt.setOver(bt.hitTest && bt.hitTest(SW.mouse.x, SW.mouse.y));
    }
  };

  Menu.prototype.attachButton = function (y, label, gotoPhase, help) {
    const bt = new U.RotatorButton(this, y, label, gotoPhase, help);
    if (this.lock) bt.lock();
    this.btList.push(bt);
    return bt;
  };
  Menu.prototype.attachSwitch = function (y, label, func, help) {
    const bt = new U.RotatorButton(this, y, label, this.phase, help);
    bt.releaseCallback = func;
    this.btList.push(bt);
    return bt;
  };
  Menu.prototype.attachFace = function (gridPos, faceId, gotoPhase, help) {
    const bt = new U.RotatorFace(this, gridPos, faceId, gotoPhase, help);
    if (!SW.Data.chars[faceId]) bt.disable();
    if (this.lock) bt.lock();
    this.btList.push(bt);
  };
  Menu.prototype.attachFaces = function (wantedPlayer, gotoPhase, title) {
    this.wantedPlayer = wantedPlayer;
    this.attachTitle(title);
    if (gotoPhase === 51) { // HISTORY
      this.attachFace(0, 0, gotoPhase, E.CHAR_NAMES[0]);
      this.attachFace(2, 1, gotoPhase, E.CHAR_NAMES[1]);
    } else {
      for (let i = 0; i < 6; i++)
        this.attachFace(i, i, gotoPhase, E.CHAR_NAMES[i]);
      this.attachFace(7, 6, gotoPhase, E.CHAR_NAMES[6]);
    }
  };
  Menu.prototype.attachTitle = function (title) {
    this.titles.push({ text: title, kill: false, frame: 0 });
  };
  Menu.prototype.removeAnims = function () {
    for (let i = 0; i < this.titles.length; i++) this.titles[i].kill = true;
  };

  Menu.prototype.jump = function (gotoPhase) {
    for (let i = 0; i < this.btList.length; i++) this.btList[i].hide();
    if (gotoPhase >= 0) {
      if (this.phase !== gotoPhase && this.stack[this.stack.length - 1] !== this.phase)
        this.stack.push(this.phase);
      this.phase = gotoPhase;
    } else {
      if (gotoPhase === -2) Manager.client.savePrefs();
      this.phase = this.stack[this.stack.length - 1];
      this.stack.splice(this.stack.length - 1, 1);
    }
    this.removeAnims();
    this.hideHelp();

    switch (this.phase) {
      case 0:
      case -1:
        break;
      case 10:
        this.attachButton(0, ' jouer ', 20, 'Choisir un mode de jeu');
        this.attachButton(1, ' options ', 11, 'Paramètres de jeu');
        break;
      case 11: {
        this.attachTitle('Paramètres de jeu');
        const me = this;
        this.attachSwitch(0, 'son : ' + (A.soundEnabled() ? ' oui ' : ' non '),
          function () { A.toggleSound(); }, 'Activer ou désactiver les effets sonore');
        this.attachSwitch(1, 'musique : ' + (A.musicEnabled() ? ' oui ' : ' non '),
          function () { A.toggleMusic(); }, 'Activer ou désactiver la musique');
        let label = ' hauts ';
        if (U.getLod() === D.MEDIUM) label = ' moyens ';
        if (U.getLod() === D.LOW) label = ' bas ';
        this.attachSwitch(2, 'details : ' + label, function () {
          switch (U.getLod()) {
            case D.HIGH: U.setLod(D.MEDIUM); break;
            case D.MEDIUM: U.setLod(D.LOW); break;
            case D.LOW: U.setLod(D.HIGH); break;
          }
        }, 'Régler le niveau de qualité graphique du jeu');
        this.attachButton(3, ' retour ', -2, '');
        break;
      }
      case 20: {
        this.attachTitle(' Modes ');
        this.attachButton(0, ' challenge ', 30, 'Affrontez les autres Frutiz sur le classement');
        this.attachButton(1, ' duel ', 40, 'Match amical en Un contre Un');
        this.attachButton(2, 'pot au feu', 50, 'Progressez et accédez à de nouveaux personnages');
        const bt = this.attachButton(3, ' classique ', 60, 'La version classique de swapou');
        const items = Manager.client.slots[0] && Manager.client.slots[0].$items;
        if (!items || !items[6]) bt.disable();
        this.attachButton(4, ' retour ', -1, '');
        break;
      }
      case 30:
        this.attachFaces(0, this.phase + 1, ' Personnage ');
        this.attachButton(4, ' retour ', -1, '');
        break;
      case 40:
        this.attachFaces(0, this.phase + 1, ' Personnage ');
        this.attachButton(4, ' retour ', -1, '');
        break;
      case 41:
        this.attachFaces(1, this.phase + 1, ' Adversaire ');
        this.attachButton(4, ' retour ', -1, '');
        break;
      case 42: {
        let line = 0;
        this.attachTitle('Difficulté');
        this.attachButton(line++, ' enfantin ', this.phase + 1, '');
        this.attachButton(line++, ' facile ', this.phase + 1, '');
        this.attachButton(line++, ' moyen ', this.phase + 1, '');
        this.attachButton(line++, ' difficile ', this.phase + 1, '');
        this.attachButton(line++, ' sauvage ', this.phase + 1, '');
        this.attachButton(line++, ' retour ', -1, '');
        break;
      }
      case 50:
        this.attachFaces(0, this.phase + 1, ' Personnage ');
        this.attachButton(4, ' retour ', -1, '');
        break;
    }
  };

  Menu.prototype.onFaceSelect = function (gotoPhase, faceId) {
    SW.Data.players[this.wantedPlayer] = faceId;
    this.jump(gotoPhase);
  };
  Menu.prototype.onButtonSelect = function (gotoPhase, id) {
    this.selectedButton = id;
    this.jump(gotoPhase);
  };
  Menu.prototype.onHidden = function () {
    switch (this.phase) {
      case 31: this.end(SW.Data.CHALLENGE); break;
      case 41: break;
      case 42: break;
      case 43:
        SW.Data.difficulty = this.selectedButton;
        this.end(SW.Data.DUEL);
        break;
      case 51: this.end(SW.Data.HISTORY); break;
      case 60: this.end(SW.Data.CLASSIC); break;
    }
  };
  Menu.prototype.end = function (mode) {
    SW.Data.gameMode = mode;
    this.animPhase = 30;
    this.fruit.ds = 0;
    this.onEnd = null;
    switch (mode) {
      case SW.Data.CHALLENGE: this.onEnd = Manager.startChallenge; break;
      case SW.Data.DUEL: this.onEnd = Manager.startDuel; break;
      case SW.Data.HISTORY: this.onEnd = Manager.startHistoryMap; break;
      case SW.Data.CLASSIC: this.onEnd = Manager.startClassic; break;
    }
  };

  Menu.prototype.help = function (msg) { this.helpText = msg || ''; };
  Menu.prototype.hideHelp = function () { this.helpText = ''; };
  Menu.prototype.waitClick = function () { this.clicked = false; };
  Menu.prototype.netLock = function () {
    for (let i = 0; i < this.btList.length; i++) this.btList[i].lock();
    this.lock = true;
    this.netLocked = true;
  };
  Menu.prototype.netUnlock = function () {
    for (let i = 0; i < this.btList.length; i++) this.btList[i].unlock();
    this.lock = false;
    this.netLocked = false;
    A.playMusic(A.MUSIC_MENU);
  };

  Menu.prototype.attachVersus = function () {
    const pid1 = SW.Data.players[0];
    const pid2 = SW.Data.players[1];
    let p1bg, p2bg, p1Frame, p2Frame, p1Taunts, p2Taunts, vs;
    if (this.wins_flag === undefined) {
      vs = 1;
      p1Taunts = DATA.TAUNT_QUESTION[pid1];
      p2Taunts = DATA.TAUNT_ANSWER[pid2];
      p1Frame = 2; p2Frame = 2; // colère
      p1bg = 0; p2bg = 1;
    } else if (this.wins_flag) {
      p1Frame = 4; p2Frame = 5; // joie / mort
      p1Taunts = DATA.TAUNT_WINS[pid1];
      p2Taunts = DATA.TAUNT_LOOSE[pid2];
      vs = 3; p1bg = 3; p2bg = 1;
    } else {
      p1Frame = 5; p2Frame = 4;
      p1Taunts = DATA.TAUNT_LOOSE[pid1];
      p2Taunts = DATA.TAUNT_WINS[pid2];
      vs = 2; p1bg = 1; p2bg = 3;
    }
    this.versus = {
      pid1: pid1, pid2: pid2,
      f1: p1Frame, f2: p2Frame, bg1: p1bg, bg2: p2bg, vs: vs,
      t1: p1Taunts[random(p1Taunts.length)],
      t2: p2Taunts[random(p2Taunts.length)],
    };
  };
  Menu.prototype.showVersus = function (wins, fOnEnd) {
    this.wins_flag = wins;
    this.charsVisible = false;
    this.barVisible = false;
    this.animPhase = 40;
    this.onEnd = fOnEnd;
  };

  Menu.prototype.onClickDown = function () {
    // versus / logo : clic global
    if (this.animPhase === 1 || this.animPhase === 41) {
      this.clicked = true;
      return;
    }
    for (let i = 0; i < this.btList.length; i++) {
      const bt = this.btList[i];
      if (bt.hitTest && bt.hitTest(SW.mouse.x, SW.mouse.y)) {
        bt.release();
        return;
      }
    }
  };

  Menu.prototype.draw = function (ctx) {
    SW.drawBg(ctx, 'bg');
    const f = this.fruit;
    // ombre + fruit
    if (f.visible && f.scale > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha / 100));
      const sx = (f.scaleX || f.scale) / 100;
      const sy = (f.scaleY || f.scale) / 100;
      ctx.fillStyle = 'rgba(30,50,10,0.3)';
      ctx.beginPath();
      ctx.ellipse(f.curX, D.DOCHEIGHT - 40, 130 * sx, 18 * sx, 0, 0, Math.PI * 2);
      ctx.fill();
      const img = A.img(this.menuFruitImg);
      if (img) ctx.drawImage(img, f.curX - img.naturalWidth * sx / 2, f.curY - img.naturalHeight * sy / 2,
        img.naturalWidth * sx, img.naturalHeight * sy);
      ctx.restore();
    }
    // personnages
    if (this.charsVisible) {
      const dimi = A.img('fullDimitri');
      const nata = A.img('fullNatacha');
      const cs = this.charScale / 100;
      ctx.save();
      if (dimi) ctx.drawImage(dimi, this.leftCharX - dimi.naturalWidth * cs / 2,
        D.DOCHEIGHT - dimi.naturalHeight * cs + 10, dimi.naturalWidth * cs, dimi.naturalHeight * cs);
      if (nata) ctx.drawImage(nata, this.rightCharX - nata.naturalWidth * cs / 2,
        D.DOCHEIGHT - nata.naturalHeight * cs + 10, nata.naturalWidth * cs, nata.naturalHeight * cs);
      ctx.restore();
    }
    // titres
    for (let i = 0; i < this.titles.length; i++) {
      const t = this.titles[i];
      const k = Math.min(1, t.frame / 8);
      ctx.save();
      ctx.globalAlpha = k;
      const img = A.img('levelBox');
      if (img) ctx.drawImage(img, D.BUTTON_X - 80, D.TITLE_Y - 26, 160, 52);
      U.text(ctx, t.text, D.BUTTON_X, D.TITLE_Y, { size: 16, color: '#3a7a1a', stroke: '#fff3d8', strokeWidth: 3 });
      ctx.restore();
    }
    // boutons (arrière puis avant pour l'orbite)
    for (let i = 0; i < this.btList.length; i++)
      if (this.btList[i].behind) this.btList[i].draw(ctx);
    for (let i = 0; i < this.btList.length; i++)
      if (!this.btList[i].behind) this.btList[i].draw(ctx);
    // barre d'aide
    if (this.barVisible && this.helpText) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      U.roundRect(ctx, D.DOCWIDTH / 2 - 240, 8, 480, 26, 13);
      ctx.fillStyle = '#fff7dd';
      ctx.fill();
      ctx.strokeStyle = '#8a5a2a';
      ctx.lineWidth = 2;
      ctx.stroke();
      U.text(ctx, this.helpText, D.DOCWIDTH / 2, 21, { size: 12, color: '#5a3a10' });
      ctx.restore();
    }
    // logo
    if (this.logoVisible || this.logoHide > 0) {
      const img = A.img('logo');
      ctx.save();
      const wob = 1 - Math.cos(this.wait / 5) * 0.03;
      let a = 1, s = wob;
      if (this.logoHide > 0) { a = this.logoHide / 12; s = wob + (1 - a) * 0.6; }
      ctx.globalAlpha = a;
      U.drawCentered(ctx, img, D.DOCWIDTH / 2, D.DOCHEIGHT / 2, 0.95 * s);
      ctx.restore();
      if (this.animPhase === 1 && Math.floor(Date.now() / 600) % 2 === 0)
        U.text(ctx, '— cliquez pour commencer —', D.DOCWIDTH / 2, D.DOCHEIGHT - 40,
          { size: 14, color: '#fff7dd', stroke: '#3a5a10', strokeWidth: 3 });
    }
    // versus
    if (this.versus) this.drawVersus(ctx);
    // netBox (visible seulement une fois le menu en place, cf. Menu.as)
    if (this.netLocked && this.animPhase >= 16) {
      const img = A.img('netBox');
      if (img) U.drawCentered(ctx, img, D.DOCWIDTH / 2, D.DOCHEIGHT / 2, 1);
      U.text(ctx, 'connexion...', D.DOCWIDTH / 2, D.DOCHEIGHT / 2, { size: 15, color: '#5a3a10' });
    }
  };

  Menu.prototype.drawVersus = function (ctx) {
    const v = this.versus;
    ctx.save();
    if (this.versusHide > 0) ctx.globalAlpha = this.versusHide / 10;
    const cx = D.DOCWIDTH / 2, cy = D.DOCHEIGHT / 2;
    const box = A.img('versusBox');
    // bulle 1 (haut) : visage gauche + texte
    if (box) ctx.drawImage(box, cx - 184 + 40, cy - 150);
    drawVersusFace(ctx, v.pid1, v.f1, v.bg1, cx - 184 - 60, cy - 155, false);
    drawBubbleText(ctx, v.t1, cx - 184 + 40 + 184, cy - 100);
    // bulle 2 (bas) : texte + visage droit
    if (box) ctx.drawImage(box, cx - 184 - 40, cy + 50);
    drawVersusFace(ctx, v.pid2, v.f2, v.bg2, cx + 184 - 50, cy + 45, true);
    drawBubbleText(ctx, v.t2, cx - 184 - 40 + 184, cy + 100);
    // logo VS
    const vsImg = A.img('versus');
    let glow = 1;
    if (v.vs === 2) glow = 0.5;
    ctx.save();
    if (v.vs === 2) ctx.globalAlpha *= 0.8;
    U.drawCentered(ctx, vsImg, cx, cy - 10, 0.9);
    ctx.restore();
    if (v.vs === 3)
      U.text(ctx, 'GAGNÉ !', cx, cy + 38, { size: 20, color: '#fff04a', stroke: '#7a3000', strokeWidth: 4 });
    else if (v.vs === 2)
      U.text(ctx, 'PERDU...', cx, cy + 38, { size: 20, color: '#cfd8ff', stroke: '#20243a', strokeWidth: 4 });
    ctx.restore();
  };

  function drawVersusFace(ctx, pid, state, bg, x, y, flip) {
    const face = new U.Face(pid);
    face.stateId = state;
    face.bgId = bg;
    if (flip) face.flipped = true;
    face.draw(ctx, x, y, 110);
  }
  function drawBubbleText(ctx, txt, cx, cy) {
    const lines = U.wrapText(ctx, txt, 330, 'bold 13px Verdana,Arial,sans-serif');
    for (let i = 0; i < lines.length; i++)
      U.text(ctx, lines[i], cx, cy - (lines.length - 1) * 8 + i * 16, { size: 13, color: '#5a3a10' });
  }

  // ── HistoMap (HistoMap.as) ───────────────────────────────────────────────
  function HistoMap() {
    this.lock = true;
    this.zooming = true;
    this.scale = 0;
    this.target_scale = 100;
    this.dialog_pos = -1;
    this.movie = null;       // index de cinématique courant
    this.walking = false;
    this.walkFrom = null;
    this.walkTo = null;
    this.walkT = 0;
    this.altChar = null;     // { from, to, t, char } — poivre / wasabii en fuite
    this.dial = null;        // { left, txt, face, state, bg }
    this.brumeX = 0;

    // adversaire (HistoMap.as)
    let opponent;
    if (SW.Data.histoPhase === 0) opponent = 2;
    else if (SW.Data.histoPhase === 1) opponent = 1 - SW.Data.players[0];
    else if (SW.Data.histoPhase === 6) opponent = 6;
    else opponent = SW.Data.histoPhase + 1;
    SW.Data.players[1] = opponent;

    this.heroEtape = this.startEtape();
    this.nextDialog();
  }
  HistoMap.prototype.destroy = function () {};

  HistoMap.prototype.startEtape = function () {
    switch (SW.Data.histoPhase) {
      case 0: return 0;
      case 1:
      case 2: return 1;
      default: return SW.Data.histoPhase - 1;
    }
  };
  HistoMap.prototype.endEtape = function () {
    switch (SW.Data.histoPhase) {
      case 0:
      case 1: return 1;
      default: return SW.Data.histoPhase;
    }
  };

  HistoMap.prototype.nextDialog = function () {
    this.dialog_pos++;
    // disparition de wasabii en phase 6 (hack d'origine)
    if (this.dialog_pos === 6 && SW.Data.histoPhase === 6) this.altChar = null;
    const d = DATA.SCENARIO[SW.Data.histoPhase][this.dialog_pos];
    if (d === undefined) return false;
    if (d.walk === 'scenario') {
      this.walking = true;
      this.walkFrom = this.heroEtape;
      this.walkTo = this.endEtape();
      this.walkT = 0;
      this.lock = true;
      return true;
    }
    if (d.walk === 'poivre') {
      this.altChar = { from: 1, to: 2, t: 0, char: 3 };
      return this.nextDialog();
    }
    if (d.walk === 'wasabii') {
      this.altChar = { from: 5, to: 6, t: 0, char: 6 };
      return this.nextDialog();
    }
    if (d.stop) {
      A.stopMusic();
      return this.nextDialog();
    }
    if (d.loop) {
      A.playMusic(d.loop);
      return this.nextDialog();
    }
    if (d.movie !== undefined) {
      this.movie = d.movie;
      return this.nextDialog();
    }
    if (d.txt === undefined) return this.nextDialog();
    this.display(d.left, d.txt, d.face, d.state, d.bg);
    return true;
  };

  HistoMap.prototype.display = function (left, txt, face, state, bg) {
    let pname = E.CHAR_NAMES[SW.Data.players[0]];
    pname = pname.substr(0, pname.length - 1);
    txt = txt.split('$#').join(pname);
    pname = E.CHAR_NAMES[1 - SW.Data.players[0]];
    pname = pname.substr(0, pname.length - 1);
    txt = txt.split('$*').join(pname);
    switch (face) {
      case -1: face = SW.Data.players[0]; left = true; break;
      case -2: face = 1 - SW.Data.players[0]; break;
      case -3: face = SW.Data.players[1]; break;
    }
    this.dial = { left: left, txt: txt, face: face, state: state, bg: bg };
  };

  HistoMap.prototype.onClickDown = function () {
    if (this.lock) return;
    if (!this.nextDialog()) {
      this.zooming = true;
      this.target_scale = 0;
    }
  };

  HistoMap.prototype.main = function (tmod) {
    this.brumeX += tmod * 0.3;
    if (this.zooming) {
      let s = this.scale + (this.target_scale - this.scale) * Math.pow(0.3, 1 / tmod);
      if (Math.abs(this.scale - this.target_scale) < 2) {
        s = this.target_scale;
        this.zooming = false;
        this.lock = false;
        if (s === 0) {
          if (SW.Data.histoPhase === 7) {
            Manager.startMenu();
            return;
          }
          Manager.startDuel();
          return;
        }
      }
      this.scale = s;
      return;
    }
    if (this.walking) {
      this.walkT += tmod / 80;
      if (this.walkT >= 1) {
        this.walkT = 1;
        this.heroEtape = this.walkTo;
        this.walking = false;
        this.lock = false;
        this.nextDialog();
      }
    }
    if (this.altChar) {
      this.altChar.t = Math.min(1, this.altChar.t + tmod / 100);
    }
  };

  function etapePos(i) {
    const p = DATA.MAP_ETAPES[Math.max(0, Math.min(DATA.MAP_ETAPES.length - 1, i))];
    return { x: p[0], y: p[1] };
  }

  HistoMap.prototype.draw = function (ctx) {
    SW.drawBg(ctx, 'bg');
    if (this.scale <= 0) return;
    const s = this.scale / 100;
    const mapImg = A.img('worldMap');

    // ── carte (à gauche quand une cinématique est affichée) ──
    const showCin = this.movie != null;
    const mapCx = showCin ? 160 : D.DOCWIDTH / 2;
    const mapCy = 165;
    ctx.save();
    ctx.translate(mapCx, mapCy);
    ctx.scale(s, s);
    if (mapImg) ctx.drawImage(mapImg, -mapImg.naturalWidth / 2, -mapImg.naturalHeight / 2);
    const ox = -138.5, oy = -143.5;
    // étapes parcourues
    for (let i = 1; i <= this.startEtape(); i++) {
      const p = etapePos(i);
      ctx.fillStyle = '#d8262a';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ox + p.x, oy + p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // perso en fuite (poivre / wasabii)
    if (this.altChar) {
      const a = etapePos(this.altChar.from), b = etapePos(this.altChar.to);
      const x = a.x + (b.x - a.x) * this.altChar.t;
      const y = a.y + (b.y - a.y) * this.altChar.t;
      U.drawFaceMedallion(ctx, this.altChar.char, ox + x, oy + y, 9, {});
    }
    // héros
    {
      let hx, hy;
      if (this.walking) {
        const a = etapePos(this.walkFrom), b = etapePos(this.walkTo);
        const wob = Math.sin(this.walkT * 30) * 1.5;
        hx = a.x + (b.x - a.x) * this.walkT;
        hy = a.y + (b.y - a.y) * this.walkT + wob;
      } else {
        const p = etapePos(this.heroEtape);
        hx = p.x; hy = p.y;
      }
      U.drawFaceMedallion(ctx, SW.Data.players[0], ox + hx, oy + hy, 11, {});
    }
    ctx.restore();

    // ── cinématique (panneau droit) ──
    if (showCin) {
      const frameImg = A.img('historyAnimBox');
      const cx = 520, cy = 165;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      const sceneName = DATA.CIN_SCENES[this.movie] || 'scene1';
      ctx.save();
      ctx.beginPath();
      ctx.rect(-120, -120, 240, 240);
      ctx.clip();
      if (sceneName === 'TEMPLE') {
        const t = A.img('scene6_temple'), b = A.img('scene6_brume'), p = A.img('scene6_poteau');
        ctx.fillStyle = '#3a1020';
        ctx.fillRect(-120, -120, 240, 240);
        if (t) U.drawCentered(ctx, t, 0, 0, 240 / Math.max(t.naturalWidth, t.naturalHeight));
        if (b) {
          ctx.globalAlpha = 0.5;
          const bx = (this.brumeX % 360) - 180;
          U.drawCentered(ctx, b, bx, 40, 1);
          U.drawCentered(ctx, b, bx + 360, 40, 1);
          ctx.globalAlpha = 1;
        }
        if (p) U.drawCentered(ctx, p, -80, 30, 1);
      } else {
        const img = A.img(sceneName);
        if (img) ctx.drawImage(img, -120, -120, 240, 240);
      }
      ctx.restore();
      if (frameImg) ctx.drawImage(frameImg, -frameImg.naturalWidth / 2, -frameImg.naturalHeight / 2);
      else {
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#6a4520';
        ctx.strokeRect(-124, -124, 248, 248);
      }
      ctx.restore();
    }

    // ── bandeau de dialogue ──
    if (this.dial && !this.walking) {
      const chat = A.img('historyChat');
      const by = D.DOCHEIGHT - 130;
      ctx.save();
      if (chat) ctx.drawImage(chat, (D.DOCWIDTH - 640) / 2, by, 640, 122);
      else {
        U.roundRect(ctx, 30, by, D.DOCWIDTH - 60, 122, 10);
        ctx.fillStyle = '#7a5527';
        ctx.fill();
      }
      const d = this.dial;
      let textX = D.DOCWIDTH / 2, textW = 520;
      if (d.left === true) {
        drawDialFace(ctx, d, 52, by + 8);
        textX = D.DOCWIDTH / 2 + 55;
        textW = 450;
      } else if (d.left === false) {
        drawDialFace(ctx, d, D.DOCWIDTH - 160, by + 8);
        textX = D.DOCWIDTH / 2 - 55;
        textW = 450;
      }
      const lines = U.wrapText(ctx, d.txt, textW, 'bold 14px Verdana,Arial,sans-serif');
      for (let i = 0; i < lines.length; i++)
        U.text(ctx, lines[i], textX, by + 61 - (lines.length - 1) * 9 + i * 18,
          { size: 14, color: '#ffe9b0', stroke: '#4a2a08', strokeWidth: 3 });
      if (!this.lock && Math.floor(Date.now() / 500) % 2 === 0)
        U.text(ctx, '▼', D.DOCWIDTH / 2 + 295, by + 105, { size: 12, color: '#ffe9b0' });
      ctx.restore();
    }
  };

  function drawDialFace(ctx, d, x, y) {
    if (d.face > 6) {
      // visage mystérieux (frame 9 du MC d'origine) : masque sombre
      ctx.save();
      U.roundRect(ctx, x, y, 106, 106, 6);
      const g = ctx.createRadialGradient(x + 53, y + 40, 8, x + 53, y + 53, 70);
      g.addColorStop(0, '#3a4a52');
      g.addColorStop(1, '#0c1014');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = '#cfe8e0';
      ctx.beginPath(); // deux yeux en amande
      ctx.ellipse(x + 36, y + 48, 13, 5, -0.35, 0, Math.PI * 2);
      ctx.ellipse(x + 70, y + 48, 13, 5, 0.35, 0, Math.PI * 2);
      ctx.fill();
      const ft = A.img('faceTop');
      if (ft) ctx.drawImage(ft, x - 10, y - 11, 127, 130);
      ctx.restore();
      return;
    }
    const face = new U.Face(d.face);
    face.stateId = d.state;
    face.bgId = d.bg;
    face.draw(ctx, x, y, 106);
  }

  // ── GameOver (GameOver.as) ───────────────────────────────────────────────
  function GameOver(mode) {
    this.mode = mode;
    this.lock = false;
    this.win_flag = false;
    this.lock_time = 2;
    this.boxX = D.DOCWIDTH / 2 + D.CHALLENGE_X;
    this.boxY = D.DOCHEIGHT / 2 + 40;
    this.frame = 1; // 1 texte, 2 connexion, 3 win/lose, 4 perso débloqué
    this.text = '';
    this.titemText = null;
    this.unlockedChar = null;
  }
  GameOver.prototype.connecting = function () { this.frame = 2; };
  GameOver.prototype.netLock = function () { this.lock = true; };
  GameOver.prototype.netUnlock = function () { this.lock = false; };
  GameOver.prototype.wins = function (cond) {
    this.boxX = D.DOCWIDTH / 2;
    this.win_flag = cond;
    this.frame = 3;
  };
  GameOver.prototype.unlockCharacter = function (cid) {
    this.wins(true);
    this.frame = 4;
    this.unlockedChar = cid;
  };
  GameOver.prototype.winTitem = function (n) {
    if (n === 0) return;
    this.titemText = 'Vous avez gagné ' + ((n === 1) ? 'un nouveau titem' : (n + ' nouveaux titems')) + ' Frutiparc !';
  };
  GameOver.prototype.setText = function (txt) {
    this.frame = 1;
    this.text = txt;
  };
  GameOver.prototype.scoreSaved = function (score, oldScore, oldRank, newRank) {
    this.netUnlock();
    let text = DATA.TXT_VOTRE_SCORE(score) + '\n';
    if (score > oldScore && (oldRank > 0 || Manager.client.isWhite()))
      text += DATA.TXT_SCORE_BATTU + '\n';
    if (newRank < oldRank && oldRank > 0)
      text += DATA.TXT_PLACE_GAGNEES(oldRank - newRank) + '\n';
    if (Manager.client.isWhite())
      text += DATA.TXT_VOTRE_RECORD(Math.max(score, oldScore)) + '\n';
    else if (newRank > 0)
      text += DATA.TXT_VOTRE_PLACE(newRank) + '\n';
    else
      text += DATA.TXT_VOTRE_RECORD(Math.max(score, oldScore)) + '\n';
    this.setText(text);
  };
  GameOver.prototype.onClickDown = function () {
    if (this.lock || this.lock_time > 0) return;
    Manager.endGame(this.win_flag);
  };
  GameOver.prototype.main = function (tmod, deltaT) {
    this.lock_time -= deltaT;
    this.mode.main(tmod, deltaT);
  };
  GameOver.prototype.destroy = function () {
    this.mode.destroy();
  };
  GameOver.prototype.draw = function (ctx) {
    this.mode.draw(ctx);
    const box = A.img('box');
    const bw = 316, bh = 296;
    let by = this.boxY;
    if (this.titemText) by -= 30;
    ctx.save();
    if (box) ctx.drawImage(box, this.boxX - bw / 2, by - bh / 2);
    else {
      U.roundRect(ctx, this.boxX - bw / 2, by - bh / 2, bw, bh, 16);
      ctx.fillStyle = '#a8762f';
      ctx.fill();
    }
    if (this.frame === 2) {
      U.text(ctx, 'connexion...', this.boxX, by, { size: 16, color: '#fff3d8', stroke: '#5a3a10', strokeWidth: 3 });
    } else if (this.frame === 3) {
      const img = A.img(this.win_flag ? 'endingWin' : 'endingLose');
      if (img) U.drawCentered(ctx, img, this.boxX, by - 40, 0.9);
      else U.text(ctx, this.win_flag ? 'GAGNÉ !' : 'PERDU...', this.boxX, by - 40,
        { size: 26, color: '#fff04a', stroke: '#5a3a10', strokeWidth: 4 });
    } else if (this.frame === 4) {
      const img = A.img('endingWin');
      if (img) U.drawCentered(ctx, img, this.boxX, by - 90, 0.75);
      const face = new U.Face(this.unlockedChar);
      face.stateId = 4; // joie
      face.bgId = 3;
      face.draw(ctx, this.boxX - 55, by - 55, 110);
      U.text(ctx, 'Nouveau personnage débloqué !', this.boxX, by + 85,
        { size: 14, color: '#fff3d8', stroke: '#5a3a10', strokeWidth: 3 });
    } else {
      const lines = [];
      this.text.split('\n').forEach(function (l) {
        if (l) U.wrapText(ctx, l, 260, 'bold 14px Verdana,Arial,sans-serif').forEach(function (x) { lines.push(x); });
      });
      for (let i = 0; i < lines.length; i++)
        U.text(ctx, lines[i], this.boxX, by - (lines.length - 1) * 11 + i * 22,
          { size: 14, color: '#fff3d8', stroke: '#5a3a10', strokeWidth: 3 });
    }
    if (this.lock_time <= 0 && !this.lock)
      U.text(ctx, '— cliquez pour continuer —', this.boxX, by + bh / 2 - 24,
        { size: 11, color: '#ffe9b0', stroke: '#5a3a10', strokeWidth: 2 });
    if (this.titemText) {
      const ty = by + bh / 2 + 26;
      U.roundRect(ctx, this.boxX - 170, ty - 22, 340, 44, 10);
      ctx.fillStyle = 'rgba(60,40,10,0.85)';
      ctx.fill();
      const lines = U.wrapText(ctx, this.titemText, 320, 'bold 12px Verdana,Arial,sans-serif');
      for (let i = 0; i < lines.length; i++)
        U.text(ctx, lines[i], this.boxX, ty - (lines.length - 1) * 7 + i * 14,
          { size: 12, color: '#ffe06a' });
    }
    ctx.restore();
  };

  // ── Manager (Manager.as) ─────────────────────────────────────────────────
  const Manager = {
    mode: null,
    start_menu: true,
    client: null,
    init: function (sid) {
      A.enableSoundMusic(true, true);
      this.client = new SW.Client();
      this.client.sid = sid || '';
      this.start_menu = true;
      this.startMenu();
      this.start_menu = false;
      this.mode.netLock();
      const me = this;
      this.client.serviceConnect(function () { me.connected(); });
    },
    main: function (tmod, deltaT) {
      if (this.mode) this.mode.main(tmod, deltaT);
    },
    draw: function (ctx) {
      if (this.mode && this.mode.draw) this.mode.draw(ctx);
    },
    startChallenge: function () {
      // FD : le mode Challenge est rationné (2 parties/jour + pass boutique).
      // On réserve la partie auprès du serveur AVANT de démarrer — même modèle
      // que l'AS2 d'origine (startGame attendait le serveur). Refus → on reste
      // au menu (déverrouillé) et un panneau explique. Panne réseau → on joue
      // (fail-open : le portillon au save protège le classement).
      var sid = (Manager.client && Manager.client.sid) || '';
      if (!sid) { Manager.started(); return; }
      if (Manager.mode && Manager.mode.netLock) Manager.mode.netLock();
      var body = new URLSearchParams();
      body.set('sid', sid);
      body.set('game', 'swapou2');
      fetch('/do/fdclaim', { method: 'POST', body: body })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          if (/(^|&)ok=1(&|$)/.test(t)) { Manager.started(); return; }
          if (Manager.mode && Manager.mode.netUnlock) Manager.mode.netUnlock();
          SW.showFdRefus(t);
        })
        .catch(function () { Manager.started(); });
    },
    startDuel: function () {
      Manager.mode.destroy();
      Manager.mode = new SW.Duel();
    },
    startHistoryMap: function () {
      Manager.mode.destroy();
      Manager.mode = new HistoMap();
    },
    startClassic: function () {
      Manager.mode.destroy();
      Manager.mode = new SW.Classic();
    },
    startMenu: function () {
      if (Manager.mode) Manager.mode.destroy();
      SW.Data.histoPhase = 0;
      Manager.mode = new Menu();
    },
    started: function () {
      Manager.mode.destroy();
      Manager.mode = new SW.Challenge();
    },
    connected: function () {
      if (Manager.mode && Manager.mode.netUnlock) Manager.mode.netUnlock();
    },
    endGame: function (wins) {
      if (SW.Data.gameMode === SW.Data.HISTORY) {
        if (wins) {
          Manager.client.unlockCharacter(SW.Data.players[1]);
          SW.Data.histoPhase++;
          Manager.startHistoryMap();
        } else {
          const m = new Menu();
          m.showVersus(false, Manager.startMenu);
          Manager.mode.destroy();
          Manager.mode = m;
        }
        return;
      }
      Manager.startMenu();
    },
    gameOver: function (score) {
      const wins = (score !== 0);
      const g = new GameOver(Manager.mode);
      Manager.mode = g;
      switch (SW.Data.gameMode) {
        case SW.Data.CLASSIC: {
          // Comme le SWF d'origine : le mode classique n'alimente AUCUN
          // classement (swapou2_classic est le bucket du mode Challenge,
          // cf. Client.as:doEndGame → saveScore mode 0). Seul le record
          // personnel $classic_record est conservé sur la fruticard.
          const oldScore = Manager.client.saveClassicScore(score);
          g.scoreSaved(score, oldScore, 0, 0);
          break;
        }
        case SW.Data.CHALLENGE:
          g.connecting();
          g.netLock();
          Manager.client.doEndGame(score);
          break;
        case SW.Data.DUEL:
          g.wins(wins);
          break;
        case SW.Data.HISTORY: {
          const pid = SW.Data.players[1];
          if (wins && !SW.Data.chars[pid]) g.unlockCharacter(pid);
          else g.wins(wins);
          break;
        }
      }
      return g;
    },
    scoreSaved: function (score, oldScore, oldRank, newRank) {
      if (Manager.mode && Manager.mode.scoreSaved)
        Manager.mode.scoreSaved(score, oldScore, oldRank, newRank);
    },
  };
  SW.Manager = Manager;
  SW.Menu = Menu;
  SW.HistoMap = HistoMap;
  SW.GameOver = GameOver;

  // ── Boucle + entrées ─────────────────────────────────────────────────────
  SW.escDown = false;
  SW.canvasScale = 1; // résolution de rendu (devicePixelRatio × échelle CSS)
  SW.setCanvasScale = function (k) { SW.canvasScale = k; };
  SW.boot = function (canvas, sid) {
    const ctx = canvas.getContext('2d');
    Manager.init(sid);
    let last = performance.now();
    function frame(now) {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      const tmod = dt * 40;
      SW.tmod = tmod;
      SW.deltaT = dt;
      try {
        Manager.main(tmod, dt);
        const k = SW.canvasScale;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.clearRect(0, 0, D.DOCWIDTH, D.DOCHEIGHT);
        Manager.draw(ctx);
      } catch (e) {
        console.error(e);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  // Seuil de balayage en coordonnées logiques (cases = 35 px) : au-delà, le
  // glissé est interprété comme une direction de swap ; en deçà, c'est un appui.
  var SWIPE_TH = 12;
  SW.handleMouseMove = function (x, y) {
    SW.mouse.x = x;
    SW.mouse.y = y;
    SW.mouse.outside = (x < 0 || y < 0 || x > D.DOCWIDTH || y > D.DOCHEIGHT);
    // En tactile, on déduit la direction dominante du glissé depuis le point
    // d'appui. La case de départ reste figée (sx,sy) : viser puis glisser.
    if (SW.mouse.touching && SW.swipe.active) {
      var ddx = x - SW.swipe.sx, ddy = y - SW.swipe.sy;
      if (Math.abs(ddx) > SWIPE_TH || Math.abs(ddy) > SWIPE_TH) {
        if (Math.abs(ddx) >= Math.abs(ddy)) { SW.swipe.dx = ddx > 0 ? 1 : -1; SW.swipe.dy = 0; }
        else { SW.swipe.dx = 0; SW.swipe.dy = ddy > 0 ? 1 : -1; }
      } else { SW.swipe.dx = 0; SW.swipe.dy = 0; }
    } else if (!SW.mouse.touching) {
      SW.swipe.dx = 0; SW.swipe.dy = 0; // souris : jamais de direction héritée
    }
  };
  // action au point courant (clic souris ou relâcher tactile)
  function dispatchPress() {
    const mode = Manager.mode;
    if (!mode) return;
    // bouton pause tactile (modes de jeu uniquement)
    if (mode.pause) {
      const r = SW.pauseBtnRect;
      const x = SW.mouse.x, y = SW.mouse.y;
      if ((x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || mode.pause.flag) {
        mode.pause.want = true;
        return;
      }
    }
    if (mode.onClickDown) mode.onClickDown();
  }
  SW.handleMouseDown = function (x, y) {
    // souris : pas de balayage, on garde le ciblage par quadrant historique.
    SW.swipe.active = false; SW.swipe.dx = 0; SW.swipe.dy = 0;
    SW.handleMouseMove(x, y);
    A.unlock();
    dispatchPress();
  };
  // tactile : l'appui fige la case de départ et montre le sélecteur de paire,
  // le glissé choisit la direction du voisin, le relâcher effectue l'échange.
  SW.handleTouchStart = function (x, y) {
    SW.mouse.touching = true;
    SW.swipe.active = true; SW.swipe.sx = x; SW.swipe.sy = y; SW.swipe.dx = 0; SW.swipe.dy = 0;
    SW.handleMouseMove(x, y);
    A.unlock();
  };
  SW.handleTouchEnd = function (x, y) {
    SW.handleMouseMove(x, y);   // fige la direction finale du balayage
    dispatchPress();            // onClickDown lit SW.swipe via SW.pickPair
    SW.mouse.touching = false;
    SW.mouse.outside = true;    // pas de survol persistant après le relâcher
    SW.swipe.active = false;    // après le dispatch : laisse pickPair lire la direction
  };
  SW.setEsc = function (down) { SW.escDown = down; };

  // ── Pop-in « Plus de FD » — reproduction de la popin NATIVE Frutiparc ──
  // Même rendu que l'overlay du popup de jeu (game-popup.html) : bordure noire
  // + liseré gris, coins arrondis, ombre portée, icône + titre, bouton
  // /fb/bouton_popin.png (Verdana bold #660000). Un seul bouton « Fermer » :
  // le joueur retourne au menu (Classique/Duel/Pot au feu restent libres).
  SW.showFdRefus = function (lvText) {
    if (document.getElementById('fd-overlay')) return;
    var wrap = document.createElement('div');
    wrap.id = 'fd-overlay';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.30)';
    wrap.innerHTML =
      '<div style="background:#fff;border:1px solid #000;border-radius:12px;padding:3px;box-shadow:0 7px 8px rgba(0,0,0,.5);max-width:378px;width:calc(100% - 14px)">' +
        '<div style="border:2px solid #ccc;border-radius:9px;padding:13px 16px 16px;font-family:Verdana,Arial,sans-serif;color:#000">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
            '<img src="/fb/icone_popin.png" alt="" width="19" height="24" style="display:block">' +
            '<b style="font-size:15px">Challenge</b>' +
          '</div>' +
          '<p style="font-size:14px;line-height:1.5;margin:0 0 20px">Nom d\u2019un Pamplefrousse ! Tu as \u00e9puis\u00e9 ton quota de parties Challenge pour aujourd\u2019hui ! Retente ta chance demain ou ach\u00e8te un pass en boutique !</p>' +
          '<div style="text-align:center">' +
            '<button id="fd-later" style="width:124px;height:30px;border:0;padding:0 0 2px;background:url(/fb/bouton_popin.png) no-repeat center/100% 100%;font-family:Verdana,Arial,sans-serif;font-weight:bold;font-size:13px;color:#660000;cursor:pointer">Fermer</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    var bt = document.getElementById('fd-later');
    bt.onmousedown = function () { bt.style.transform = 'translateY(1px)'; };
    bt.onmouseup = function () { bt.style.transform = ''; };
    bt.onclick = function () { wrap.remove(); };
  };
})();
