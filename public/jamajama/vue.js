/*
 * JamaJama — la VUE du plateau : ce que le moteur de règles décide,
 * dessiné et animé comme le lecteur Flash le faisait.
 *
 * regles.js produit des LOTS de descripteurs (un par flush du jeu
 * d'origine) : les « rapides » jouent en parallèle avec leurs délais, les
 * « effets » l'un après l'autre. La vue tient son propre état visuel (image,
 * position, transparence de chaque sprite) et ne le change qu'au rythme des
 * descripteurs — l'état du moteur, lui, est déjà final. À la fin des lots
 * d'une entrée, la vue se RECALE sur le moteur : toute dérive s'efface.
 *
 * Les cadences sont celles du fichier : 32 images par seconde (Timer),
 * dix pas par case (MoveAnim), quarante images d'arc électrique, l'iris de
 * fin qui se referme à 15 par image. Le hasard de l'arc est le même
 * Math.random×10 alterné que _drawLines.
 */
'use strict';

(function () {
  const R = window.JamaRegles;
  const Rendu = window.JamaRendu;
  const { Direction, Element, Consts } = R;

  const teinte = (n) => '#' + n.toString(16).padStart(6, '0');
  const NOMS_DIR = ['North', 'East', 'South', 'West'];

  // La plage d'images d'une étiquette : de son image à la veille de la
  // suivante (ou à la fin du clip).
  function plage(cle, etiquette) {
    const etqs = Rendu.etiquettes(cle);
    const debut = etqs[etiquette];
    if (debut === undefined) return null;
    let fin = Rendu.longueur(cle);
    for (const f of Object.values(etqs)) if (f > debut && f - 1 < fin) fin = f - 1;
    return { debut, fin };
  }

  class VueJeu {
    /**
     * @param partie   la Partie de regles.js (état final au fil des entrées)
     * @param options  { showBeginFade, showVictoFade } — les options du joueur
     */
    constructor(partie, options) {
      this.partie = partie;
      this.options = options || { showBeginFade: true, showVictoFade: true };
      const dim = partie.getLevel().size;
      this.dim = dim;
      this.padX = Math.floor((Consts.WIDTH - dim.width * 32) / 2);
      this.padY = Math.floor((Consts.HEIGHT - dim.height * 32) / 2);
      this.vues = new Map();               // uid → état visuel
      this.fx = [];                        // arcs, flammes, flash… au-dessus
      this.voile = null;                   // le fondu (iris) au premier plan
      this.compteur = 0;
      this._lots = [];                     // les lots en attente
      this._courant = null;                // {rapides:[anims], effets:[anims], t}
      this._finis = true;
      for (const s of partie.sprites()) this._creerVue(s);
      this._recaler();
    }

    // ── la vue d'un sprite, dans l'état de son show() ──
    _creerVue(s) {
      const v = {
        uid: s.uid,
        sprite: s,
        cle: 'jama_' + Element.nameOf(s.id === Element.GHOST ? Element.HERO : s.id),
        x: s.pos.x * 32, y: s.pos.y * 32,
        dx: 0, dy: 0,                      // le ballottement du vol (héros)
        frame: 1,
        clips: {},
        alpha: s.id === Element.GHOST ? 0.5 : 1,
        visible: true,
        jJoue: false,                      // le sous-clip j avance tout seul
        bande: s.id === Element.GHOST ? 2 : (s.below ? 0 : 1),
      };
      this.vues.set(s.uid, v);
      this._poserEtat(v);
      return v;
    }

    // L'image de repos d'un sprite — la transcription de chaque show().
    _poserEtat(v) {
      const s = v.sprite;
      const b = this.partie.getBoard();
      switch (s.id) {
        case Element.EXIT:
          v.frame = s._opened ? undefined : NOMS_DIR[s.orientation];
          if (s._opened) {
            const p = plage(v.cle, NOMS_DIR[s.orientation]);
            v.frame = p ? p.debut + 14 : 1;
          }
          break;
        case Element.WATER:
          v.frame = 1;
          v.clips = { j: Number(R.frameEau(b, s.pos)) };
          break;
        case Element.BRIDGE:
          v.frame = s._broken ? 2 : 1;
          v.clips = { j: Number(R.frameEau(b, s.pos)) };
          break;
        case Element.WALL:
          v.frame = Number(R.frameMur(b, s.pos));
          break;
        case Element.ONE_WAY:
        case Element.ONE_WAY_STRICT:
        case Element.MAGNET:
        case Element.GMAGNET:
          v.frame = NOMS_DIR[s.orientation];
          break;
        case Element.LURKER:
          v.frame = NOMS_DIR[s.orientation];
          v.clips = { j: 1 };
          break;
        case Element.FRUIT:
          v.frame = 1;
          v.clips = { j: s.param };
          break;
        case Element.HERO:
        case Element.GHOST:
          v.frame = 1;
          v.clips = { j: s.orientation + 1 };
          break;
        case Element.LOUKI:
          v.frame = s._active ? ('move' + (s._loaded ? 'Full' : '') + NOMS_DIR[s.orientation]) : 'default';
          break;
        case Element.KOHL:
          v.frame = s._active === undefined ? 1 : 1;
          break;
        case Element.WINKLE:
          v.frame = s._inWater ? 'swim' : 'default';
          break;
        case Element.SPIDER:
          v.frame = s._inCocoon ? 'cocon' : NOMS_DIR[s.orientation];
          break;
        case Element.EYE:
          v.frame = s._opened ? 'Open' : 'Close';
          break;
        case Element.JADE:
          v.frame = 'normal';
          break;
        case Element.ARCHER:
          v.frame = 'default';
          break;
        case Element.BOMB:
          v.frame = 1;
          v.compteur = s._countDown > 0 ? s._countDown : 0;
          break;
        default:
          v.frame = 1;
      }
    }

    // ── recalage : la vérité du moteur reprend la main ──
    _recaler() {
      const vivants = new Set();
      for (const s of this.partie.sprites()) {
        vivants.add(s.uid);
        let v = this.vues.get(s.uid);
        if (!v) v = this._creerVue(s);
        v.x = s.pos.x * 32;
        v.y = s.pos.y * 32;
        v.visible = s.alive || s.id === Element.EXIT;
        v.jJoue = false;
        v.alpha = s.id === Element.GHOST ? 0.5 : 1;
        this._poserEtat(v);
      }
      for (const [uid, v] of this.vues) {
        if (!vivants.has(uid)) this.vues.delete(uid);
      }
      this.fx = [];
      this.compteur = this.partie.countMoves();
    }

    // ── réception d'une entrée jouée : les lots + les événements immédiats ──
    jouer(resultat) {
      for (const e of resultat.evenements) this._evenement(e);
      for (const lot of resultat.lots) this._lots.push(lot);
      this.compteur = this.partie.countMoves();
    }
    _evenement(e) {
      const v = e.uid !== undefined ? this.vues.get(e.uid) : null;
      switch (e.type) {
        case 'orientation':
          if (!v) break;
          if (v.sprite.isAvatar && v.sprite.isAvatar()) v.clips.j = e.d + 1;
          else if (v.sprite.id !== Element.JADE) v.frame = NOMS_DIR[e.d] || v.frame;
          break;
        case 'compteBombe':
        case 'bombeAllumee':
          if (v) { v.compteur = e.valeur; v.brule = true; }
          break;
        case 'refresh': this._refreshAutotiles(); break;
        case 'refreshPositions':
          for (const [, w] of this.vues) {
            w.x = w.sprite.pos.x * 32;
            w.y = w.sprite.pos.y * 32;
          }
          this._refreshAutotiles();
          break;
        case 'heroSleep': if (v) v.frame = 'sleep'; break;
        case 'heroWake': if (v) v.frame = 1; break;
        case 'cacher': if (v) v.visible = false; break;
        case 'nage': if (v) { v.frame = 'swim'; v.jJoue = true; } break;
        case 'oeil': if (v) v.frame = e.ouvert ? 'Open' : 'Close'; break;
        default: break;                    // destroy & co : le recalage s'en charge
      }
    }
    _refreshAutotiles() {
      const b = this.partie.getBoard();
      for (const [, v] of this.vues) {
        const s = v.sprite;
        if (s.id === Element.WALL && s.alive) v.frame = Number(R.frameMur(b, s.pos));
        if ((s.id === Element.WATER || s.id === Element.BRIDGE) && !v.enChute) {
          v.clips = Object.assign({}, v.clips, { j: Number(R.frameEau(b, s.pos)) });
        }
      }
    }

    libre() { return this._finis && !this._lots.length; }

    // ── la marche du temps ──
    update(tmod) {
      // Le ballottement du héros (FlyAnim : _y = -1 + cos(t)·2, t += tmod/5).
      for (const [, v] of this.vues) {
        if ((v.sprite.id === Element.HERO || v.sprite.id === Element.GHOST) && v.sprite.alive) {
          v.vol = (v.vol || 0) + tmod / 5;
          v.dy = -1 + Math.cos(v.vol) * 2;
        }
        if (v.jJoue) {
          const long = this._longueurJ(v);
          if (long > 1) {
            v.jT = (v.jT || v.clips.j || 1) + tmod;
            if (v.jT > long) v.jT -= long - 0;
            v.clips = Object.assign({}, v.clips, { j: Math.max(1, Math.round(v.jT)) });
          }
        }
      }
      if (!this._courant) {
        const lot = this._lots.shift();
        if (!lot) { this._finis = true; return; }
        this._finis = false;
        this._courant = {
          rapides: lot.rapides.map((d) => this._creerAnim(d)).filter(Boolean),
          effets: lot.effets.map((d) => this._creerAnim(d)).filter(Boolean),
        };
      }
      const c = this._courant;
      let resteRapide = false;
      for (const a of c.rapides) {
        if (a.finie) continue;
        if (!a.update(tmod)) a.finie = true; else resteRapide = true;
      }
      let resteEffet = false;
      for (const a of c.effets) {
        if (a.finie) continue;
        if (!a.update(tmod)) { a.finie = true; continue; }
        resteEffet = true;
        break;                             // les effets jouent l'un après l'autre
      }
      if (!resteRapide && !resteEffet) {
        this._courant = null;
        if (!this._lots.length) {
          this._finis = true;
          this._recaler();
        }
      }
    }
    _longueurJ(v) {
      // La longueur du sous-clip j au cadre courant (pour le faire boucler).
      const s = Rendu.symbole(v.cle);
      const etat = Rendu.etatDe(s, v.frame);
      const p = (etat.pieces || []).find((x) => x.nom === 'j' && x.clip);
      return p ? Rendu.longueur(p.clip) : 1;
    }

    // ── chaque descripteur devient un petit automate ──
    _creerAnim(d) {
      const vue = (uid) => this.vues.get(uid);
      const moi = this;
      switch (d.type) {
        case 'move': {
          const v = vue(d.uid);
          if (!v) return null;
          return this._animMove(v, d.x * 32, d.y * 32, d.pas, d.delai || 0);
        }
        case 'moveAnime': {
          const v = vue(d.uid);
          if (!v) return null;
          v.jJoue = true; v.jT = 1;
          const a = this._animMove(v, d.x * 32, d.y * 32, 13, 0);
          return { update(t) { const r = a.update(t); if (!r) { v.jJoue = false; v.clips.j = 1; } return r; } };
        }
        case 'spiderMove': {
          const v = vue(d.uid);
          if (!v) return null;
          v.jJoue = true; v.jT = 1;
          const a = this._animMove(v, d.x * 32, d.y * 32, d.pas, 0);
          return { update(t) { const r = a.update(t); if (!r) { v.jJoue = false; v.clips.j = 1; } return r; } };
        }
        case 'fruitMerge': {
          const v = vue(d.uid), w = vue(d.avec);
          if (!v || !w) return null;
          const a = this._animMove(v, w.x, w.y, 15, 0);
          let alpha = 1;
          return { update(t) {
            const r = a.update(t);
            alpha = Math.max(0, alpha - t / 15);
            v.alpha = alpha; w.alpha = alpha;
            if (alpha <= 0) { v.visible = false; w.visible = false; return false; }
            return r || alpha > 0;
          } };
        }
        case 'boxFall': {
          const eau = vue(d.uid), caisse = vue(d.box);
          if (!eau) return null;
          const p = plage(eau.cle, 'fallBox') || { debut: 5, fin: Rendu.longueur(eau.cle) };
          let etape = null;
          return { update(t) {
            if (etape == null) {
              if (caisse) caisse.visible = false;
              eau.enChute = true;
              eau.clips = { mask: eau.sprite.hasWaterBelow && eau.sprite.hasWaterBelow() ? 2 : 1 };
              etape = p.debut;
            }
            etape += t;
            eau.frame = Math.min(p.fin, Math.round(etape));
            return etape < p.fin;
          } };
        }
        case 'bridgeFall': {
          const v = vue(d.uid);
          if (!v) return null;
          const p = plage(v.cle, 'break') || { debut: 2, fin: 23 };
          const fin = (plage(v.cle, 'fallBox') || { debut: Rendu.longueur(v.cle) + 1 }).debut - 1;
          let etape = null;
          const delai = (d.delai || 0);
          let attente = delai;
          return { update(t) {
            if (attente > 0) { attente -= t; return true; }
            if (etape == null) etape = p.debut;
            etape += t;
            v.frame = Math.min(fin, Math.round(etape));
            return etape < fin;
          } };
        }
        case 'openExit': {
          const v = vue(d.uid);
          if (!v) return null;
          // La porte coulisse sur quatorze images (ManualAnim) ; le TROU,
          // lui, est un second clip que le fichier attache juste en dessous
          // — ici c'est `_dessinerSortie` qui le pose, sous la porte.
          const debut = typeof v.frame === 'string'
            ? (plage(v.cle, v.frame) || { debut: 1 }).debut : v.frame;
          let etape = debut;
          return { update(t) {
            etape += t;
            v.frame = Math.min(debut + 14, Math.round(etape));
            return etape < debut + 14;
          } };
        }
        case 'flammes': {
          const fx = { genre: 'flamme', x: d.x * 32, y: d.y * 32, frame: 1, actif: false };
          this.fx.push(fx);
          const fin = Rendu.longueur('jama_fx_Fire');
          let attente = (d.delai || 0);
          return { update(t) {
            if (attente > 0) { attente -= t; return true; }
            fx.actif = true;
            fx.frame += t;
            if (fx.frame >= fin) { fx.mort = true; return false; }
            return true;
          } };
        }
        case 'burn': {
          const v = vue(d.uid);
          if (!v) return null;
          let attente = (d.delai || 0);
          let p = null, etape = null;
          return { update(t) {
            if (attente > 0) { attente -= t; return true; }
            if (etape == null) {
              p = plage(v.cle, 'burn');
              if (!p) { v.visible = false; return false; }
              etape = p.debut;
            }
            etape += t;
            v.frame = Math.min(p.fin, Math.round(etape));
            if (etape >= p.fin) { v.visible = false; return false; }
            return true;
          } };
        }
        case 'archerBurn': {
          const v = vue(d.uid);
          if (!v) return null;
          const p = plage(v.cle, 'burn');
          if (!p) return null;
          // mc.counter = 2 : le clignotement se joue deux fois.
          let etape = p.debut, tours = 2;
          return { update(t) {
            etape += t;
            if (etape >= p.fin) {
              tours -= 1;
              if (tours <= 0) { v.frame = 'default'; return false; }
              etape = p.debut;
            }
            v.frame = Math.min(p.fin, Math.round(etape));
            return true;
          } };
        }
        case 'deflagration': {
          const anims = d.anims.map((x) => this._creerAnim(x)).filter(Boolean);
          return { update(t) {
            let reste = false;
            for (const a of anims) {
              if (a.finie) continue;
              if (!a.update(t)) a.finie = true; else reste = true;
            }
            return reste;
          } };
        }
        case 'archerShot': case 'eyeShot': {
          const tireur = vue(d.uid);
          const arc = { genre: 'arc', x1: 0, y1: 0, x2: 0, y2: 0 };
          if (tireur) {
            arc.x1 = tireur.x + 15;
            arc.y1 = tireur.y + (d.type === 'eyeShot' ? 20 : 0);
          }
          arc.x2 = d.x * 32 + 15;
          arc.y2 = d.y * 32 + 15;
          this.fx.push(arc);
          let pas = 40;
          const avantFrame = tireur ? tireur.frame : null;
          return { update(t) {
            if (tireur) tireur.frame = 3;
            pas -= t;
            if (pas <= 0) {
              arc.mort = true;
              if (tireur) tireur.frame = d.type === 'eyeShot' ? avantFrame : 'default';
              return false;
            }
            return true;
          } };
        }
        case 'lurkerShot': {
          const v = vue(d.uid);
          const tir = { genre: 'tir', x: v ? v.x : 0, y: v ? v.y : 0, visible: true };
          this.fx.push(tir);
          const dx = d.x * 32, dy = d.y * 32;
          const pas = Math.max(1, d.dist * 4);
          const vx = (dx - tir.x) / pas, vy = (dy - tir.y) / pas;
          let t0 = 0, flash = 0;
          if (v) { v.frame = NOMS_DIR[v.sprite.orientation] + 'Shot'; v.jJoue = true; v.jT = 1; }
          return { update(t) {
            if (t0 < pas) {
              t0 += t;
              tir.x += vx * t; tir.y += vy * t;
              if (t0 >= pas) { tir.mort = true; flash = 2; moi.fx.push({ genre: 'flash', vie: flash }); }
              return true;
            }
            if (v) { v.jJoue = false; moi._poserEtat(v); }
            return false;
          } };
        }
        case 'flash': {
          const fx = { genre: 'flash', vie: 2 };
          this.fx.push(fx);
          return { update(t) { fx.vie -= t; if (fx.vie <= 0) { fx.mort = true; return false; } return true; } };
        }
        case 'cocon': {
          const v = vue(d.uid);
          const fx = { genre: 'cocon', x: v ? v.x : 0, y: v ? v.y : 0, frame: 1 };
          this.fx.push(fx);
          const fin = Rendu.longueur('jama_fx_cocon');
          let pose = false;
          return { update(t) {
            if (!pose && v) { v.frame = NOMS_DIR[v.sprite.orientation]; pose = true; }
            fx.frame += t;
            if (fx.frame >= fin) { fx.mort = true; return false; }
            return true;
          } };
        }
        case 'jadeGaz': {
          const v = vue(d.uid);
          const gazs = [Direction.NE, Direction.NW, Direction.SE, Direction.SW].map((dir) => {
            const c = v ? v.sprite.pos.next(dir) : null;
            const fx = { genre: 'gaz', x: c ? c.x * 32 : 0, y: c ? c.y * 32 : 0, frame: 1 };
            this.fx.push(fx);
            return fx;
          });
          const fin = Rendu.longueur('jama_fx_Gaz');
          const brulures = (d.cibles || []).map((uid) => this._creerAnim({ type: 'burn', uid }));
          let vie = 0;
          return { update(t) {
            vie += t;
            if (v) v.frame = vie < 40 ? 'fire' : 'normal';
            let reste = false;
            for (const g of gazs) {
              g.frame += t;
              if (g.frame >= fin) g.mort = true; else reste = true;
            }
            for (const a of brulures) {
              if (!a || a.finie) continue;
              if (!a.update(t)) a.finie = true; else reste = true;
            }
            return reste || vie < 40;
          } };
        }
        case 'loukiEat': {
          const v = vue(d.uid), cible = vue(d.cible);
          if (!v) return null;
          v.frame = 'pump' + NOMS_DIR[d.d];
          if (cible) cible.visible = false;
          const long = this._longueurJ(v);
          let etape = 1;
          return { update(t) {
            etape += t;
            v.clips = Object.assign({}, v.clips, { j: Math.min(long, Math.round(etape)) });
            return etape < long;
          } };
        }
        case 'loukiPuke': {
          const v = vue(d.uid);
          return { update() {
            if (v) v.visible = false;
            for (const [, w] of moi.vues) { w.x = w.sprite.pos.x * 32; w.y = w.sprite.pos.y * 32; }
            moi._refreshAutotiles();
            return false;
          } };
        }
        case 'sommeil': case 'wakeUp': case 'entreEau': {
          const v = vue(d.uid);
          if (!v) return null;
          if (d.type === 'wakeUp') {
            const fantome = moi.partie.getGhost();
            if (fantome) { const g = moi.vues.get(fantome.uid); if (g) g.visible = false; }
          }
          const etiquette = d.type === 'sommeil' ? 'sleep' : (d.type === 'wakeUp' ? 'wakeUp' : 'enterWater');
          v.frame = etiquette;
          v.jJoue = false;
          const long = this._longueurJ(v);
          let etape = 1;
          return { update(t) {
            etape += t;
            v.clips = Object.assign({}, v.clips, { j: Math.min(long, Math.round(etape)) });
            if (etape >= long) {
              if (d.type === 'entreEau') { v.frame = 'swim'; v.jJoue = true; }
              return false;
            }
            return true;
          } };
        }
        case 'heroBurn': {
          const v = vue(d.uid);
          if (!v) return null;
          let etat = 0, compteur = 0, etape = 2;
          const flash = { genre: 'flash', vie: 2 };
          this.fx.push(flash);
          return { update(t) {
            switch (etat) {
              case 0: etat = 1; return true;
              case 1:
                flash.vie -= t;
                if (flash.vie <= 0) { flash.mort = true; etat = 2; etape = 2; compteur = 2; }
                return true;
              case 2:
                etape += t;
                v.frame = Math.min(8, Math.round(etape));
                if (etape >= 8) {
                  compteur -= 1;
                  if (compteur > 0) etape = 2;
                  else { etat = 3; compteur = 60; }
                }
                return true;
              case 3:
                compteur -= t;
                if (compteur <= 0) { etat = 4; etape = 2; }
                return true;
              case 4:
                etape += t;
                v.frame = Math.min(11, Math.round(etape));
                return etape < 11;
              default: return false;
            }
          } };
        }
        case 'heroMort': {
          const v = vue(d.uid);
          if (!v) return null;
          let etape = 15;
          return { update(t) {
            etape += t;
            v.clips = Object.assign({}, v.clips, { j: Math.min(24, Math.round(etape)) });
            return etape < 24;
          } };
        }
        case 'heroVictory': {
          const v = vue(d.uid);
          if (!v) return null;
          let etape = 5;
          return { update(t) {
            etape += t;
            v.clips = Object.assign({}, v.clips, { j: Math.min(14, Math.round(etape)) });
            return etape < 14;
          } };
        }
        case 'fadeIn': {
          if (!this.options.showBeginFade) return null;
          const voile = { genre: 'entree', x: this.padX + d.x * 32 + 16, y: this.padY + d.y * 32 + 16,
            rayon: 0, rotation: 0, etat: 1, compteur: 60 };
          this.voile = voile;
          return { update(t) {
            voile.rotation += t * 15;
            if (voile.etat === 1) {
              voile.rayon += t * 10 / 2;
              if (voile.rayon * 2 >= 40) { voile.etat = 2; voile.compteur = 80; }
            } else if (voile.etat === 2) {
              voile.compteur -= t;
              if (voile.compteur <= 0) voile.etat = 3;
            } else {
              voile.rayon += t * 15 / 2;
              if (voile.rayon * 2 > Consts.WIDTH * 3) { moi.voile = null; return false; }
            }
            return true;
          } };
        }
        case 'victoire': case 'defaite': {
          if (!this.options.showVictoFade) {
            if (d.type === 'victoire') this._poserHerosSurSortie(d);
            return null;
          }
          let centre;
          if (d.type === 'victoire') {
            centre = { x: this.padX + d.x * 32 + 16, y: this.padY + d.y * 32 + 16 };
            this._poserHerosSurSortie(d);
          } else {
            const h = this.partie.getHero();
            centre = { x: this.padX + (h ? h.pos.x : 0) * 32 + 16, y: this.padY + (h ? h.pos.y : 0) * 32 + 16 };
          }
          const voile = { genre: 'sortie', x: centre.x, y: centre.y,
            rayon: Consts.WIDTH * 3 / 2, rotation: 0, etat: 1, compteur: 80, plein: false };
          this.voile = voile;
          return { update(t) {
            voile.rotation += t * 15;
            if (voile.etat === 1) {
              voile.compteur -= t;
              voile.rayon -= t * 15 / 2;
              if (voile.compteur <= 0) { voile.etat = 2; voile.compteur = 30; }
            } else if (voile.etat === 2) {
              voile.compteur -= t;
              voile.rayon += t * 2 / 2;
              if (voile.compteur <= 0) { voile.etat = 3; voile.compteur = 17; }
            } else if (voile.etat === 3) {
              voile.compteur -= t;
              if (voile.compteur <= 0) { voile.etat = 4; voile.compteur = 17; }
            } else if (voile.etat === 4) {
              voile.compteur -= t;
              voile.rayon -= t * 10 / 2;
              if (voile.compteur <= 0 || voile.rayon <= 0) { voile.etat = 5; voile.compteur = 50; voile.plein = true; }
            } else {
              voile.compteur -= t;
              if (voile.compteur <= 0) return false;
            }
            return true;
          } };
        }
        case 'callback': case 'refresh': case 'destroy':
          return null;
        default:
          return null;
      }
    }
    _poserHerosSurSortie(d) {
      const h = this.partie.getHero();
      const v = h && this.vues.get(h.uid);
      if (v) { v.x = d.x * 32; v.y = d.y * 32; v.clips = { j: 5 }; }
      const exitVue = this.vues.get(d.uid);
      if (exitVue) {
        const p = typeof exitVue.frame === 'string' ? plage(exitVue.cle, exitVue.frame) : null;
        // le héros saute dans le trou : l'animation de fin de la sortie
        exitVue.frame = 'endAnim';
      }
    }
    _animMove(v, dx, dy, pas, delai) {
      let attente = delai || 0;
      let vx = null, vy = null;
      return { update(t) {
        if (attente > 0) { attente -= t; return true; }
        if (vx == null) { vx = (dx - v.x) / pas; vy = (dy - v.y) / pas; }
        v.x += vx * t; v.y += vy * t;
        if ((vx > 0 && v.x > dx) || (vx < 0 && v.x < dx) || (vy > 0 && v.y > dy) || (vy < 0 && v.y < dy)
          || (v.x === dx && v.y === dy)) {
          v.x = dx; v.y = dy;
          return false;
        }
        return true;
      } };
    }

    // ── le dessin d'une image ──
    dessiner(ctx) {
      ctx.fillStyle = teinte(Consts.BLACK_BROWN);
      ctx.fillRect(0, 0, Consts.WIDTH, Consts.HEIGHT);
      ctx.save();
      // Le voile d'entrée/sortie découpe le PLATEAU (le fond brun reste).
      if (this.voile && !this.voile.plein) {
        ctx.save();
        ctx.fillStyle = teinte(Consts.LIGHT_BROWN);
        ctx.fillRect(0, 0, Consts.WIDTH, Consts.HEIGHT);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(this.voile.x, this.voile.y, Math.max(0, this.voile.rayon), 0, Math.PI * 2);
        ctx.clip();
      } else if (this.voile && this.voile.plein) {
        ctx.fillStyle = teinte(Consts.LIGHT_BROWN);
        ctx.fillRect(0, 0, Consts.WIDTH, Consts.HEIGHT);
        ctx.restore();
        this._dessinerCompteur(ctx);
        return;
      }
      ctx.fillStyle = teinte(Consts.BACKGROUND);
      ctx.fillRect(this.padX, this.padY, this.dim.width * 32, this.dim.height * 32);
      ctx.save();
      ctx.translate(this.padX, this.padY);
      this._dessinerBords(ctx);
      const tri = [...this.vues.values()].filter((v) => v.visible);
      tri.sort((a, b) => {
        if (a.sous !== b.sous) return a.sous ? -1 : 1;
        if (a.bande !== b.bande) return a.bande - b.bande;
        const ia = Math.round(a.y / 32) * this.dim.width + Math.round(a.x / 32);
        const ib = Math.round(b.y / 32) * this.dim.width + Math.round(b.x / 32);
        return ia - ib;
      });
      for (const v of tri) {
        ctx.save();
        ctx.translate(v.x + v.dx, v.y + v.dy);
        ctx.globalAlpha *= v.alpha;
        try {
          // Une sortie OUVERTE, c'est deux clips : le trou (image « Hole »)
          // et la porte qui a coulissé par-dessus. Le fichier attache le
          // premier à la profondeur d'en dessous au moment de l'ouverture.
          if (v.sprite.id === Element.EXIT && v.sprite._opened) {
            Rendu.dessiner(ctx, v.cle, 'Hole');
          }
          Rendu.dessiner(ctx, v.cle, v.frame, { clips: this._clipsDe(v) });
        } catch (e) { /* une image manquante ne fige pas la partie */ }
        if (v.sprite.id === Element.BOMB && v.compteur > 0 && v.sprite.alive) {
          ctx.translate(16, 0);
          try { Rendu.dessiner(ctx, 'jama_fx_BombCounter', String(v.compteur)); } catch (e) {}
        }
        ctx.restore();
      }
      for (const fx of this.fx.filter((f) => !f.mort)) this._dessinerFx(ctx, fx);
      this.fx = this.fx.filter((f) => !f.mort);
      ctx.restore();
      ctx.restore();
      this._dessinerCompteur(ctx);
    }
    _clipsDe(v) {
      const c = {};
      for (const [nom, f] of Object.entries(v.clips)) c[nom] = f;
      return c;
    }
    _dessinerBords(ctx) {
      const larg = this.dim.width, haut = this.dim.height;
      const cote = (frame, x, y) => {
        ctx.save(); ctx.translate(x, y);
        try { Rendu.dessiner(ctx, 'jama_Side', frame); } catch (e) {}
        ctx.restore();
      };
      for (let x = 0; x < larg; x++) { cote(1, x * 32, 0); cote(3, x * 32, (haut - 1) * 32); }
      for (let y = 0; y < haut; y++) { cote(4, 0, y * 32); cote(2, (larg - 1) * 32, y * 32); }
      cote(5, 0, 0); cote(6, (larg - 1) * 32, 0);
      cote(7, (larg - 1) * 32, (haut - 1) * 32); cote(8, 0, (haut - 1) * 32);
    }
    _dessinerFx(ctx, fx) {
      if (fx.genre === 'flamme' && fx.actif) {
        ctx.save(); ctx.translate(fx.x, fx.y);
        try { Rendu.dessiner(ctx, 'jama_fx_Fire', Math.max(1, Math.round(fx.frame))); } catch (e) {}
        ctx.restore();
      } else if (fx.genre === 'gaz') {
        ctx.save(); ctx.translate(fx.x, fx.y);
        try { Rendu.dessiner(ctx, 'jama_fx_Gaz', Math.max(1, Math.round(fx.frame))); } catch (e) {}
        ctx.restore();
      } else if (fx.genre === 'cocon') {
        ctx.save(); ctx.translate(fx.x, fx.y);
        try { Rendu.dessiner(ctx, 'jama_fx_cocon', Math.max(1, Math.round(fx.frame))); } catch (e) {}
        ctx.restore();
      } else if (fx.genre === 'tir') {
        ctx.save(); ctx.translate(fx.x, fx.y);
        try { Rendu.dessiner(ctx, 'jama_fx_LurkerShot', 1); } catch (e) {}
        ctx.restore();
      } else if (fx.genre === 'flash') {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-this.padX, -this.padY, Consts.WIDTH, Consts.HEIGHT);
        ctx.restore();
      } else if (fx.genre === 'arc') {
        // Les trois éclairs de _drawLines, refaits à chaque image.
        const x1 = Math.min(fx.x1, fx.x2), y1 = Math.min(fx.y1, fx.y2);
        const x2 = Math.max(fx.x1, fx.x2), y2 = Math.max(fx.y1, fx.y2);
        const qx = Math.abs(x2 - x1) / 4, qy = Math.abs(y2 - y1) / 4;
        const ligne = (larg, couleur, alpha, points) => {
          ctx.save();
          ctx.strokeStyle = couleur; ctx.globalAlpha = alpha; ctx.lineWidth = larg;
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
          ctx.stroke();
          ctx.restore();
        };
        ligne(1, '#ffe9ee', 0.8, [{ x: fx.x1, y: fx.y1 }, { x: fx.x2, y: fx.y2 }]);
        for (const [couleur, alpha] of [['#ffb300', 0.7], ['#ffe900', 0.6]]) {
          let alterne = 1;
          const points = [{ x: fx.x1, y: fx.y1 }];
          for (let i = 1; i <= 3; i++) {
            points.push({ x: x2 - i * qx + Math.random() * 10 * alterne,
              y: y2 - i * qy + Math.random() * 10 * alterne });
            alterne = 1 - alterne;
          }
          points.push({ x: fx.x2, y: fx.y2 });
          ligne(2, couleur, alpha, points);
        }
      }
    }
    _dessinerCompteur(ctx) {
      ctx.save();
      ctx.font = '12px "Times New Roman", serif';
      ctx.fillStyle = teinte(Consts.COUNTER_COLOR);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(this.compteur), 2, 2);
      ctx.restore();
    }
  }

  window.JamaVue = { VueJeu, plage };
})();
