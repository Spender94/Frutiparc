/*
 * Frutisnake — le menu-carrousel (Menu.as) et le panneau d'options
 * (MenuOptions.as), au pixel du SWF.
 *
 * Le carrousel : les pastilles tournent sur une ellipse (WIDTH/3 × 100),
 * triées par profondeur (sortOn y), à l'échelle 30 + p·50 % plus une
 * respiration sinusoïdale, teintées vers le sombre au fond (le cxform
 * ra=p·100, ga=p·60+40, ba=p·100 — et alpha 50 % pour une entrée grisée).
 * Le titre respire entre 90 et 110 % en oscillant de ±2°.
 *
 * BackgroundFX, hérité par les deux, est NEUTRALISÉ à la source
 * (`npoints = 0` en tête du constructeur) : les blobs verts ne se dessinent
 * jamais dans le jeu d'origine — donc pas ici non plus.
 */
'use strict';

(function (racine) {

const C = racine.SnakeConst;
const D = racine.SnakeDessin;

class Menu {
  constructor(jeu, ids, surChoix) {
    this.jeu = jeu;                        // le chef d'orchestre (game.js)
    this.surChoix = surChoix;
    this.nmenus = ids.length;
    this.menus = ids.map((id, i) => ({
      id: Math.abs(id),
      inactif: id < 0,
      a: i / ids.length * Math.PI * 2,
      x: 0, y: 0,
      dr: jeu.hasard(20) / 100,
    }));

    const sons = jeu.sons;
    if (!sons.isPlaying(C.SOUND_MENU_LOOP, C.CHANNEL_MUSIC_1)) {
      sons.setVolume(C.CHANNEL_MUSIC_1, 0);
      sons.fade(C.CHANNEL_MUSIC_2, C.CHANNEL_MUSIC_1, C.MUSIC_FADE_LENGTH);
      sons.loop(C.SOUND_MENU_LOOP, C.CHANNEL_MUSIC_1);
    }

    this.menu_ts = 0;
    this.titre = { echelle: 100, rotation: 0, ds: 2, dr: 0.3 };
    this.delta_ang = 0.1;
    this.cur_ang = Math.PI / 2;
    this.target_ang = this.cur_ang;
    this.main(1);
  }

  close() {}

  // Menu.on_press — les flèches font tourner, une pastille choisit.
  presser(x, y) {
    // Les flèches : à (0, H/2) tournée de 180° et (W, H/2). Leur dessin
    // s'étend d'environ 45 px vers l'intérieur — on prend une zone franche.
    const H2 = C.HEIGHT / 2;
    if (y > H2 - 60 && y < H2 + 60) {
      if (x < 70) {
        this.jeu.sons.play(C.SOUND_ROTATION_MENU);
        this.target_ang += -2 * Math.PI / this.nmenus;
        return;
      }
      if (x > C.WIDTH - 70) {
        this.jeu.sons.play(C.SOUND_ROTATION_MENU);
        this.target_ang += 2 * Math.PI / this.nmenus;
        return;
      }
    }
    // Les pastilles, de la plus proche à la plus lointaine.
    const c = D.cadre('menu', 1);
    for (const m of [...this.menus].sort((a, b) => b.y - a.y)) {
      if (m.inactif) continue;
      const px = m.x + C.WIDTH / 2;
      const py = m.y + C.HEIGHT / 2 - 50;
      const p = (m.y + 100) / 200;
      const s = (30 + p * 50) / 100;
      const w = (c ? c.w : 120) * s / 2, h = (c ? c.h : 120) * s / 2;
      if (x > px - w && x < px + w && y > py - h && y < py + h) {
        this.jeu.sons.play(C.SOUND_SELECT_MENU);
        this.surChoix(m.id);
        return;
      }
    }
  }

  main(tmod) {
    const t = this.titre;
    t.echelle += t.ds;
    t.rotation += t.dr;
    if (t.echelle > 110 || t.echelle < 90) t.ds *= -1;
    if (t.rotation > 2 || t.rotation < -2) t.dr *= -1;

    if (this.cur_ang !== this.target_ang) {
      if (Math.sin(this.cur_ang - this.target_ang) < 0) {
        this.cur_ang += this.delta_ang;
        if (Math.sin(this.cur_ang - this.target_ang) > 0) this.cur_ang = this.target_ang;
      } else {
        this.cur_ang -= this.delta_ang;
        if (Math.sin(this.cur_ang - this.target_ang) < 0) this.cur_ang = this.target_ang;
      }
    }

    for (const m of this.menus) {
      const a = m.a + this.cur_ang;
      m.x = Math.cos(a) * C.WIDTH / 3;
      m.y = Math.sin(a) * 100 + m.id / 100;
    }
    this.menu_ts += 0.1;
  }

  dessiner(ctx) {
    D.poser(ctx, 'menuBackground', 1, 0, 0, 1, 1, 0);

    // Les pastilles, du fond vers l'avant (sortOn y).
    const tri = [...this.menus].sort((a, b) => a.y - b.y);
    for (let i = 0; i < tri.length; i++) {
      const m = tri[i];
      const p = (m.y + 100) / 200;
      const s = (30 + p * 50 + Math.sin(this.menu_ts + this.menus.indexOf(m)) * 3) / 100;
      const x = m.x + C.WIDTH / 2;
      const y = m.y + C.HEIGHT / 2 - 50;
      // Le cxform de Menu.main : multiplicateurs (p, p·0.6+0.4, p) — la
      // pastille s'assombrit vers le fond (et s'éteint à moitié si inactive).
      const r = D.rendreMultiplie('menu', m.id, s, p, p * 0.6 + 0.4, p);
      if (!r) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.globalAlpha *= m.inactif ? 0.5 : 1;
      ctx.drawImage(r.c, r.dx, r.dy, r.lw, r.lh);
      ctx.restore();
    }

    // Le titre qui respire, à (W/2, 80).
    D.poser(ctx, 'title', 1, C.WIDTH / 2, 80,
      this.titre.echelle / 100, this.titre.echelle / 100,
      this.titre.rotation * Math.PI / 180);

    // Les deux flèches (la gauche est la même, tournée de 180°).
    D.poser(ctx, 'fleche', 1, C.WIDTH, C.HEIGHT / 2, 1, 1, 0);
    D.poser(ctx, 'fleche', 1, 0, C.HEIGHT / 2, 1, 1, Math.PI);
  }
}

// ── MenuOptions.as ────────────────────────────────────────────────────────
// Le panneau centré, quatre zones cliquables : musique, effets sonores,
// retour au menu — et « Formatter l'encyclopédie », masqué par le fichier
// lui-même (`format._visible = false; // HACK`).
class MenuOptions {
  constructor(jeu) {
    this.jeu = jeu;
    const c = D.cadre('optionPanel', 1);
    this.px = (C.WIDTH - (c ? c.w : 480)) / 2 - (c ? c.x : 0);
    this.py = (C.HEIGHT - (c ? c.h : 440)) / 2 - (c ? c.y : 0);
  }

  close() {}
  main() {}

  // Les zones cliquables : les pilules `music` (18,56) et `sound` (18,104),
  // et `returnMenu` (296,391) — leurs poses d'auteur dans le panneau.
  presser(x, y) {
    const lx = x - this.px, ly = y - this.py;
    const dans = (zx, zy, zw, zh) => lx >= zx && lx <= zx + zw && ly >= zy && ly <= zy + zh;
    if (dans(18, 52, 285, 26)) this.jeu.basculerMusique();
    else if (dans(18, 100, 285, 26)) this.jeu.basculerSons();
    else if (dans(290, 385, 180, 30)) {
      this.jeu.plateforme.prefs.$music = this.jeu.musique;
      this.jeu.plateforme.prefs.$sounds = this.jeu.bruitages;
      this.jeu.plateforme.sauverPrefs();
      this.jeu.retourMenu();
    }
  }

  // Le nom d'une touche, pour la grille des contrôles (champ toucheCode).
  nomTouche(code) {
    const SPECIALES = { 37: 'gauche', 39: 'droite', 38: 'haut', 40: 'bas', 32: 'espace' };
    if (SPECIALES[code]) return SPECIALES[code];
    if (code >= 48 && code <= 57) return String(code - 48);
    if (code >= 65 && code <= 90) return String.fromCharCode(code);
    if (code >= 96 && code <= 105) return 'pav ' + (code - 96);
    return String(code);
  }

  dessiner(ctx) {
    D.poser(ctx, 'menuBackground', 1, 0, 0, 1, 1, 0);
    D.poser(ctx, 'optionPanel', 1, this.px, this.py, 1, 1, 0);

    // Les libellés du panneau sont des champs texte (pas des formes) : ils se
    // dessinent ici, aux positions d'auteur, dans les Verdana pixel du SWF.
    ctx.save();
    ctx.translate(this.px, this.py);
    ctx.fillStyle = '#daeea2';
    ctx.textAlign = 'left';
    ctx.font = '14px Verdana14St, Verdana, sans-serif';
    ctx.fillText('musique', 23, 53);
    ctx.fillText('effets sonores', 23, 101);
    ctx.fillText('Controles :', 23, 151);
    ctx.fillText('Retour au Menu >', 300, 406);
    ctx.font = '12px Verdana12StB, Verdana, sans-serif';
    ctx.fillText('joueur 1 :', 36, 219);
    ctx.fillText('joueur 2 :', 36, 241);
    ctx.fillText('joueur 3 :', 36, 263);
    ctx.fillText('joueur 4 :', 36, 285);

    // Les valeurs, centrées dans leurs pilules (champs 619/617).
    ctx.textAlign = 'center';
    ctx.fillText(this.jeu.musique ? 'activée' : 'desactivée', 160, 70);
    ctx.fillText(this.jeu.bruitages ? 'activés' : 'désactivés', 160, 118);

    // La grille des touches (cellules 629 : trois colonnes par joueur).
    const touches = this.jeu.plateforme.prefs.$keys || C.DEFAULT_KEYS;
    ctx.fillStyle = '#ffffff';
    const colonnes = [179.9, 279, 379.45];
    const rangs = [215.5, 238.1, 260.45, 282.5];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 3; i++) {
        ctx.fillText(this.nomTouche(touches[j * 3 + i]), colonnes[i], rangs[j] + 9);
      }
    }
    ctx.restore();
  }
}

const API = { Menu, MenuOptions };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeMenu = API;

})(typeof window !== 'undefined' ? window : globalThis);
