/*
 * Frutisnake — l'Encyclopéfruit (Encyclo.as), le livre qui feuillette.
 *
 * La reliure du SWF : quatre clips « page » — bookLeft (page gauche posée),
 * bookRight (celle qui attend sous la droite), rightPage (la droite posée)
 * et leftPage (celle qui TOURNE, _rotation 0…90) — tous pivotés autour de
 * (BOOK_X+297, BOOK_Y+443+297), le point d'ancrage des pages étant leur
 * coin-pivot (l'art s'étend en x −297…0, y −740…−297). Deux masques en
 * quartier (le même polygone, LINE_LENGTH=1000 à l'angle rotation/2) taillent
 * la page tournante et la page droite ; l'ombre de pli `grad` se dose à
 * rotation/90 sur la tournante, et deux ombres portées (dropCorner/dropLarge)
 * pivotent sous le coin, découpées au rectangle du livre (bookMask).
 *
 * Les images du clip page : 1 gabarit gauche, 2 gabarit droit, 3 couverture
 * (« Encyclopéfruit Édition 2004 »), 4 sommaire, 5 papier vierge.
 *
 * Un fruit jamais ramassé s'affiche en silhouette #7FB438 (le cxform à
 * multiplicateurs nuls d'updateTemplate) ; son nom reste « Inconnu », puis
 * « Analyse en cours... » jusqu'à dix exemplaires (FRUIT_NAME_LEARN).
 */
'use strict';

(function (racine) {

const C = racine.SnakeConst;
const D = racine.SnakeDessin;

const BOOK_X = 53;
const BOOK_Y = 20;
const PAGE_WIDTH = 297;
const PAGE_HEIGHT = 443;
const BOOK_HEIGHT = PAGE_HEIGHT;
const LINE_LENGTH = 1000;
const FLIP_SPEED = 1;
const FRICTION = 0.98;
const AUTOFALL_LIMIT = 20;
const GAUCHE = 0;
const DROITE = 1;

// Les positions d'auteur du gabarit `tpl` (sprite 356, posé à −297,−740 dans
// la page) et de ses champs — relevées dans le SWF. Les champs Alba :
// `name` 20 px centré, `value`/`count` 30 px centrés, les folios 15 px.
const TPL = {
  gauche: { x: -297.1, y: -740.05 },
  droite: { x: -294.1, y: -740.05 },
  skin: { x: 148.3, y: 217.6, k: 1.7 },
  name: { cx: 147.7, y: 60.05, taille: 20 },
  value: { cx: 81.3, y: 350.1, taille: 30 },
  count: { cx: 215.9, y: 350.1, taille: 30 },
  pageLeft: { x: 6.25, y: 14.65, taille: 15 },
  pageRight: { x: 289.55, y: 14.65, taille: 15 },
};
// Le sommaire (page 4) : champ 365, Alba 14 centré multiligne, posé en
// coordonnées de page.
const SOMMAIRE = { cx: -143.58, y: -658.45, taille: 14, interligne: 17 };

class Encyclo {
  constructor(jeu) {
    this.jeu = jeu;
    this.fruits = jeu.plateforme.fruits || [];

    this.nfruits = 0;
    this.nnames = 0;
    this.totfruits = 0;
    this.maxpoints = 0;
    for (const i of Object.keys(this.fruits)) {
      const n = Number(this.fruits[i]) || 0;
      if (n > 0) {
        this.totfruits += n;
        this.nfruits++;
        if (n > C.FRUIT_NAME_LEARN - 1) this.nnames++;
        const s = C.fruit_points(Number(i));
        if (s > this.maxpoints) this.maxpoints = s;
      }
    }

    this.vitesse = 0;
    this.pageCourante = 0;
    this.rotation = 90;               // leftPage._rotation initial
    this.sourisBasse = false;
    this.sourisX = 0;
  }

  close() {}

  presser(x, y) {
    // fback — la flèche de retour, à sa pose d'auteur (706.95, 449.2 : le
    // dessin s'étend vers l'intérieur de l'écran).
    const fb = D.manifeste.cadres.encycloFback;
    if (x > fb.x - 60 && y > fb.y - 30) { this.jeu.retourMenu(); return; }
    this.sourisBasse = true;
    this.sourisX = x;
  }

  relacher() { this.sourisBasse = false; }
  glisser(x) { this.sourisX = x; }

  main(tmod) {
    const jeu = this.jeu;
    let bouge = false;

    if (jeu.toucheEnfoncee(39) || (this.sourisBasse && this.sourisX > C.WIDTH / 2)) {
      if (this.pageCourante !== 322 && Math.abs(this.vitesse) < 0.1) jeu.sons.play(C.SOUND_PAGE);
      this.vitesse -= FLIP_SPEED;
      bouge = true;
    }
    if (jeu.toucheEnfoncee(37) || (this.sourisBasse && this.sourisX < C.WIDTH / 2)) {
      if (this.pageCourante !== 0 && Math.abs(this.vitesse) < 0.1) jeu.sons.play(C.SOUND_PAGE);
      this.vitesse += FLIP_SPEED;
      bouge = true;
    }

    if (!bouge) {
      if (this.rotation >= AUTOFALL_LIMIT) this.vitesse += FLIP_SPEED * 0.5;
      if (this.rotation < AUTOFALL_LIMIT) this.vitesse -= FLIP_SPEED * 0.5;
    }

    this.vitesse *= Math.pow(FRICTION, tmod);
    this.rotation += this.vitesse * tmod;

    if (this.vitesse > 0 && this.rotation > 90) {
      if (bouge && this.pageCourante > 0) {
        this.rotation -= 90;
        this.pageCourante -= 2;
      } else {
        this.rotation = 90;
        this.vitesse = 0;
      }
    }
    if (this.vitesse < 0 && this.rotation < 0) {
      if (bouge && this.pageCourante < C.FRUIT_MAX + C.FRUIT_POURRIS_MAX) {
        this.rotation += 90;
        this.pageCourante += 2;
      } else {
        this.rotation = 0;
        this.vitesse = 0;
      }
    }
  }

  // updatePage — quelle image du clip page pour un numéro « cur ».
  imagePage(cur, cote) {
    if (cur === 0) return 3;          // la couverture
    if (cur === 1) return 5;          // le papier vierge du dos de couverture
    if (cur === 2) return 4;          // le sommaire
    return cote === GAUCHE ? 1 : 2;   // les gabarits
  }

  // updateTemplate — le contenu d'une page de fruit (cur ≥ 3).
  contenuPage(cur, cote) {
    const id = cur - 3;
    let fid = id + 1;
    if (id >= 300) fid += 20;         // les fruits pourris sautent 20 numéros
    const total = Number(this.fruits[fid]) || 0;
    let nom;
    if (total > C.FRUIT_NAME_LEARN - 1) nom = C.FRUIT_NAMES[id];
    else if (total > 0) nom = C.TXT_FRUIT_NAME_EN_COURS;
    else nom = C.TXT_FRUIT_NAME_UNKNOWN;
    let compte, valeur;
    if (total > 0) {
      compte = String(total);
      valeur = String(C.fruit_points(fid));
    } else {
      compte = C.TXT_ENCYCLO_ZEROFRUITS;
      valeur = this.jeu.hasard(1000) === 0 ? C.TXT_ENCYCLO_VALUEUNK_SPECIAL : C.TXT_ENCYCLO_VALUEUNK;
    }
    return { fid, total, nom, compte, valeur, folio: id + 1, cote };
  }

  // Dessine UNE page (image du clip + contenu), le repère déjà pivoté sur le
  // point d'ancrage de la page.
  dessinerPage(ctx, cur, cote, gradAlpha) {
    const image = this.imagePage(cur, cote);
    D.poser(ctx, 'pageSans', image, 0, 0, 1, 1, 0);

    if (image === 4) {
      // Le sommaire : les quatre phrases d'updatePage, en Alba 14.
      const total = C.FRUIT_MAX + C.FRUIT_POURRIS_MAX;
      const lignes = [
        'Vous avez rammassé ' + this.totfruits + ' fruits.', '',
        'Vous avez ' + this.nfruits + ' fruits sur une collection',
        'de ' + total + ' au total.', '',
        'Vous avez découvert le nom',
        'de ' + this.nnames + ' fruits (' + Math.trunc(this.nnames * 100 / total) + '% découverts).', '',
        'Votre plus gros fruit vous a',
        'rapporté ' + this.maxpoints + ' points.',
      ];
      ctx.font = SOMMAIRE.taille + 'px Alba, Verdana, sans-serif';
      ctx.fillStyle = '#578529';
      ctx.textAlign = 'center';
      lignes.forEach((l, i) => {
        if (l) ctx.fillText(l, SOMMAIRE.cx, SOMMAIRE.y + SOMMAIRE.taille + i * SOMMAIRE.interligne);
      });
    }

    if (image === 1 || image === 2) {
      const c = this.contenuPage(cur, cote);
      const t = cote === GAUCHE ? TPL.gauche : TPL.droite;
      ctx.save();
      ctx.translate(t.x, t.y);

      // Le fruit — en silhouette verte tant qu'il n'a jamais été ramassé.
      if (c.total > 0) {
        D.poser(ctx, 'fruits', c.fid, TPL.skin.x, TPL.skin.y, TPL.skin.k, TPL.skin.k, 0);
      } else {
        const r = D.rendreTeinte('fruits', c.fid, TPL.skin.k, '#7fb438');
        if (r) {
          ctx.save();
          ctx.translate(TPL.skin.x, TPL.skin.y);
          ctx.scale(TPL.skin.k, TPL.skin.k);
          ctx.drawImage(r.c, r.dx, r.dy, r.lw, r.lh);
          ctx.restore();
        }
      }

      ctx.fillStyle = '#578529';
      ctx.font = TPL.name.taille + 'px Alba, Verdana, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(c.nom, TPL.name.cx, TPL.name.y + TPL.name.taille);
      ctx.font = TPL.value.taille + 'px Alba, Verdana, sans-serif';
      ctx.fillText(String(c.valeur), TPL.value.cx, TPL.value.y + TPL.value.taille);
      ctx.fillText(String(c.compte), TPL.count.cx, TPL.count.y + TPL.count.taille);
      ctx.fillStyle = '#ffffff';
      ctx.font = TPL.pageLeft.taille + 'px Alba, Verdana, sans-serif';
      if (cote === GAUCHE) {
        ctx.textAlign = 'left';
        ctx.fillText(String(c.folio), TPL.pageLeft.x, TPL.pageLeft.y + TPL.pageLeft.taille);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(String(c.folio), TPL.pageRight.x, TPL.pageRight.y + TPL.pageRight.taille);
      }
      ctx.restore();
    }

    // L'ombre de pli, dosée sur la page qui tourne (grad._alpha = ratio·100).
    if (gradAlpha > 0) {
      const g = D.manifeste.cadres.pageGrad;
      const pose = g.poses[image] || g.poses[1];
      const r = D.rendreFichier('pageGrad.svg', g.cadre, 1);
      if (r) {
        ctx.save();
        ctx.globalAlpha *= Math.min(1, gradAlpha);
        ctx.transform(pose[0], pose[1], pose[2], pose[3], pose[4], pose[5]);
        ctx.drawImage(r.c, r.dx, r.dy, r.lw, r.lh);
        ctx.restore();
      }
    }
  }

  // Le polygone-masque d'update() — le même pour les deux pages taillées.
  cheminMasque(ctx) {
    const ratio = this.rotation / 90;
    const angRad = Math.PI / 180 * (ratio * 45);
    const dx = LINE_LENGTH * Math.sin(angRad);
    const dy = LINE_LENGTH * Math.cos(angRad);
    ctx.beginPath();
    ctx.moveTo(BOOK_X, BOOK_Y - BOOK_HEIGHT * 0.5);
    ctx.lineTo(BOOK_X, BOOK_Y + BOOK_HEIGHT);
    ctx.lineTo(BOOK_X + PAGE_WIDTH, BOOK_Y + BOOK_HEIGHT + PAGE_WIDTH);
    ctx.lineTo(BOOK_X + PAGE_WIDTH + dx, BOOK_Y + BOOK_HEIGHT + PAGE_WIDTH - dy);
    ctx.closePath();
  }

  dessiner(ctx) {
    // Pas de menuBackground ici : Encyclo.as n'attache que `encyclo` (son
    // conteneur, avec la flèche de retour) — le fond reste celui de la scène.
    // Le corps du livre, en dessous de tout (profondeur 0 de init_book).
    D.poser(ctx, 'bookBase', 1, BOOK_X, BOOK_Y, 1, 1, 0);

    const ratio = this.rotation / 90;
    const pivotGauche = { x: BOOK_X + PAGE_WIDTH, y: BOOK_Y + PAGE_HEIGHT + PAGE_WIDTH };
    const pivotDroit = { x: BOOK_X + PAGE_WIDTH * 2 + 1.5, y: pivotGauche.y };

    const page = (pivot, rot, cur, cote, gradAlpha, masque) => {
      ctx.save();
      if (masque) { this.cheminMasque(ctx); ctx.clip(); }
      ctx.translate(pivot.x, pivot.y);
      if (rot) ctx.rotate(rot * Math.PI / 180);
      this.dessinerPage(ctx, cur, cote, gradAlpha || 0);
      ctx.restore();
    };

    // L'ordre des profondeurs d'init_book : bookLeft, bookRight, le creux,
    // les ombres portées, puis rightPage et leftPage au sommet.
    page(pivotGauche, 0, this.pageCourante - 1, GAUCHE, 0, false);
    page(pivotDroit, 0, this.pageCourante + 2, DROITE, 0, false);

    // La couverture du livre (bookHole) tant qu'elle se soulève.
    if (this.pageCourante === 0 && this.rotation > 0) {
      D.poser(ctx, 'bookHole', 1, BOOK_X, BOOK_Y, 1, 1, 0);
    }

    // Les ombres portées sous le coin et sous la page large, découpées au
    // rectangle du livre (bookMask), pivotées de 45°·ratio.
    const bm = D.manifeste.cadres.bookMask;
    const ombre = (cle, alpha) => {
      if (alpha <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(BOOK_X + bm.x, BOOK_Y + bm.y, bm.w, bm.h);
      ctx.clip();
      ctx.globalAlpha *= Math.min(1, alpha);
      ctx.translate(pivotGauche.x, pivotGauche.y);
      ctx.rotate(45 * ratio * Math.PI / 180);
      D.poser(ctx, cle, 1, 0, 0, 1, 1, 0);
      ctx.restore();
    };
    ombre('dropCorner', ratio * 0.85);
    ombre('dropLarge', this.pageCourante >= 2 ? (1 - ratio * 1.5) * 0.9 : 0);

    page(pivotDroit, 0, this.pageCourante, DROITE, 0, true);
    page(pivotGauche, this.rotation, this.pageCourante + 1, GAUCHE, ratio, true);

    // La flèche de retour (fback), à sa pose d'auteur.
    const fb = D.manifeste.cadres.encycloFback;
    D.poser(ctx, 'fleche', 1, fb.x, fb.y, 1, 1, 0);
  }
}

const API = { Encyclo };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeEncyclo = API;

})(typeof window !== 'undefined' ? window : globalThis);
