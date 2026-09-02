/*
 * Frutisnake — le « pack de Frutisnake », côté light.
 *
 * L'article 40 de la boutique (300 kikooz) ouvre un tableau de bord de partie :
 * longueur du serpent, fruits avalés, dynamites ramassées, durée du bonus en
 * cours, durée de la partie. C'est la même option de confort que sur le disque
 * Flash — là-bas game-popup.html la dessine en HTML à côté de la scène, à
 * partir des valeurs que le SWF patché remonte par fpSnakeHud ; ici le moteur
 * est en JS, les valeurs se lisent donc directement (Jeu.releve()).
 *
 * Le tableau est peint DANS LE CANVAS, en prolongement du cadre du jeu, et non
 * en HTML autour : le décor de Frutisnake n'est qu'un aplat #83ca22 cerné de
 * deux points de blanc (backgroundBord.svg), qui se prolonge donc sans la
 * moindre distorsion. Le panneau chevauche le liseré du jeu de deux points :
 * les deux boîtes n'en font plus qu'une.
 *
 * Il s'ajoute du côté où le jeu ne se sert de rien :
 *   · PORTRAIT — un bandeau sous la frutibarre. Le jeu y est bridé par la
 *     LARGEUR : toute la hauteur qu'il laisse est perdue si on ne la prend
 *     pas. Le bandeau S'ÉTIRE donc pour que la scène remplisse la place
 *     offerte (entre un minimum lisible et un maximum raisonnable), et ses
 *     cinq relevés s'étalent en rangées pleine largeur.
 *   · PAYSAGE — une colonne à droite, à taille fixe. Le jeu y est bridé par la
 *     hauteur : la largeur ne lui coûte presque rien.
 *
 * Les intitulés sont ceux du disque, en Verdana gras ; les valeurs sont
 * tracées à l'Alba du portail (la fonte embarquée du jeu), remplies du même
 * dégradé rose et contournées de blanc.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const C = sousNode ? require('./const.js') : racine.SnakeConst;

// Les cinq relevés, avec l'abrégé des dispositions serrées : une colonne de
// cent-soixante points ne loge pas « Durée bonus en cours ».
//
// Quatre viennent du disque Flash. Le cinquième, la VITESSE, remplace sa
// « durée de la partie » : Frutisnake n'a pas de chronomètre à battre, savoir
// qu'on joue depuis trois minutes n'aide à rien — alors que l'allure du
// serpent, qui monte toute la partie et triple sous turbo, se joue.
// Elle est donnée en indice, cent valant l'allure de départ.
const LIGNES = [
  { cle: 'longueur', titre: 'Longueur', court: 'Longueur' },
  { cle: 'fruits', titre: 'Fruits avalés', court: 'Fruits' },
  { cle: 'dynamites', titre: 'Dynamites', court: 'Dynamites' },
  { cle: 'bonus', titre: 'Durée bonus en cours', court: 'Bonus' },
  { cle: 'vitesse', titre: 'Vitesse', court: 'Vitesse' },
];
// Le bandeau du portrait tient sur DEUX rangées : trois compteurs puis les
// deux mesures, plutôt que cinq cases étroites côte à côte.
const RANGEES = [3, 2];

// Les mesures, en points de scène (la scène du jeu fait 700×480).
const VERT = '#83ca22';                // l'aplat de backgroundBord.svg
const BLANC = '#ffffff';
const LISERE = 2;                      // le liseré du décor, deux points
const MARGE = 10;
const ENTRE = 8;                       // entre deux cases
// Le bandeau du portrait tient sur deux rangées : en deçà de 168 points les
// chiffres ne se lisent plus, au-delà de 224 il prendrait au jeu la place qui
// lui revient (la scène du jeu en fait 480).
const H_MIN = 168;
const H_MAX = 224;
const L_COLONNE = 168;
const DEGRADE = ['#E7A8A8', '#E46A6A'];

function mmss(sec) {
  const n = Math.max(0, Math.floor(sec));
  const m = Math.floor(n / 60), r = n % 60;
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

// Les cinq valeurs à afficher. Hors partie elles sont à zéro : le panneau ne
// disparaît jamais, sa place est prise dans la scène une fois pour toutes.
function valeurs(r) {
  if (!r) return { longueur: '0', fruits: '0', dynamites: '0', bonus: '00:00', vitesse: '100' };
  return {
    longueur: String(r.longueur),
    fruits: String(r.fruits),
    dynamites: String(r.dynamites),
    bonus: mmss(Math.ceil(r.bonus)),
    vitesse: String(r.vitesse),
  };
}

function rectArrondi(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

class Pack {
  constructor() {
    this.paysage = false;
    this.sup = { l: 0, h: 0 };         // ce que le panneau ajoute à la scène
    this.cellules = new Map();         // relevé → sa case rendue, tant qu'elle ne change pas
  }

  // La scène complète, pour une aire d'affichage donnée (pixels CSS).
  scene(aireL, aireH) {
    if (this.paysage) {
      this.sup = { l: L_COLONNE - LISERE, h: 0 };
    } else {
      // Le jeu est bridé par la largeur : l'échelle est connue d'avance, et
      // tout ce qui dépasse en hauteur est du vide. On l'offre au bandeau.
      const k = Math.max(0.01, aireL / C.WIDTH);
      const voulu = aireH / k - C.HEIGHT;
      this.sup = { l: 0, h: Math.max(H_MIN, Math.min(H_MAX, voulu)) - LISERE };
    }
    return { w: C.WIDTH + this.sup.l, h: C.HEIGHT + this.sup.h };
  }

  poserSens(paysage) { this.paysage = !!paysage; }

  // `nettete` : les pixels physiques par point de scène, pour rendre les cases
  // nettes hors écran (cf. cellule).
  dessiner(ctx, releve, nettete) {
    this.nettete = nettete || 1;
    const v = valeurs(releve);
    // La boîte chevauche le liseré du jeu : le trait du cadre est partagé, les
    // deux n'en font plus qu'une.
    const b = this.paysage
      ? { x: C.WIDTH - LISERE, y: 0, w: L_COLONNE, h: C.HEIGHT }
      : { x: 0, y: C.HEIGHT - LISERE, w: C.WIDTH, h: this.sup.h + LISERE };
    ctx.fillStyle = BLANC;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = VERT;
    ctx.fillRect(b.x + LISERE, b.y + LISERE, b.w - 2 * LISERE, b.h - 2 * LISERE);

    ctx.save();
    const x0 = b.x + LISERE + MARGE;
    const y0 = b.y + LISERE + MARGE;
    const l = b.w - 2 * (LISERE + MARGE);
    const haut = b.h - 2 * (LISERE + MARGE);
    if (this.paysage) {
      // Cinq cases empilées.
      const c = (haut - 4 * ENTRE) / 5;
      LIGNES.forEach((ligne, i) => {
        this.cellule(ctx, x0, y0 + i * (c + ENTRE), l, c, ligne, v[ligne.cle]);
      });
    } else {
      // Deux rangées sous la frutibarre : les trois compteurs, puis les deux
      // mesures, centrées sous eux. Toutes les cases ont la même largeur —
      // celle d'un tiers de bandeau — pour rester alignées.
      const hr = (haut - ENTRE) / RANGEES.length;
      const lc = (l - (RANGEES[0] - 1) * ENTRE) / RANGEES[0];
      let k = 0;
      RANGEES.forEach((n, r) => {
        const xr = x0 + (l - (n * lc + (n - 1) * ENTRE)) / 2;
        for (let j = 0; j < n; j++, k++) {
          const ligne = LIGNES[k];
          this.cellule(ctx, xr + j * (lc + ENTRE), y0 + r * (hr + ENTRE),
            lc, hr, ligne, v[ligne.cle]);
        }
      });
    }
    ctx.restore();
  }

  /* Une case : l'intitulé au-dessus, le nombre posé sur sa jauge — le gabarit
   * du disque, le même dans les deux dispositions.
   *
   * Elle est RENDUE HORS ÉCRAN et gardée tant que rien n'y change : peinte à
   * chaque image, elle coûtait deux mesures de texte, un dégradé, un texte
   * CONTOURÉ (le plus cher des tracés de glyphes) et un texte plein — cinq
   * cases, quarante fois par seconde, pour des valeurs qui ne bougent que
   * quand on mange. Mesuré au banc : le tableau doublait le coût d'une image.
   * Maintenant : une recopie par case, et la peinture seulement quand la
   * valeur, la place ou la netteté change. */
  cellule(ctx, x, y, l, h, ligne, valeur) {
    const k = this.nettete || 1;
    const clef = l.toFixed(2) + '|' + h.toFixed(2) + '|' + valeur + '|' + k;
    let c = this.cellules.get(ligne.cle);
    if (!c || c.clef !== clef) {
      c = { clef, canvas: null };
      if (typeof document !== 'undefined') {
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.ceil(l * k));
        cv.height = Math.max(1, Math.ceil(h * k));
        const t = cv.getContext('2d');
        t.scale(k, k);
        this.peindreCellule(t, 0, 0, l, h, ligne, valeur);
        c.canvas = cv;
      }
      this.cellules.set(ligne.cle, c);
    }
    if (c.canvas) ctx.drawImage(c.canvas, x, y, l, h);
    else this.peindreCellule(ctx, x, y, l, h, ligne, valeur);
  }

  peindreCellule(ctx, x, y, l, h, ligne, valeur) {
    const tLab = Math.max(10, Math.round(h * 0.3));
    const tNb = Math.max(12, Math.round(h * 0.56));
    ctx.font = 'bold ' + tLab + 'px Verdana, Geneva, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = BLANC;
    // L'intitulé complet s'il tient, son abrégé sinon.
    const titre = ctx.measureText(ligne.titre).width <= l ? ligne.titre : ligne.court;
    ctx.fillText(titre, x + l / 2, y, l);
    this.jauge(ctx, x, y + tLab + 2, l, h - tLab - 2, tNb, valeur);
  }

  // La jauge blanche et son nombre, aligné à droite et posé dessus.
  jauge(ctx, x, y, l, h, taille, valeur) {
    const e = Math.max(6, Math.round(h * 0.3));
    rectArrondi(ctx, x, y + (h - e) / 2, l, e, e / 2);
    ctx.fillStyle = BLANC;
    ctx.fill();

    // La taille vient de la hauteur de la case, mais un « 00:30 » est cinq
    // fois plus large qu'un « 3 » : on la RÉDUIT plutôt que de laisser le
    // navigateur écraser les chiffres (maxWidth les comprime en largeur).
    // Le contour blanc déborde le tracé, et l'Alba déborde ses chasses : le
    // bord droit rentre d'autant, sinon le dernier chiffre mord le liseré.
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = BLANC;
    const dispo = l - 2 * (taille * 0.1);
    ctx.font = taille + 'px Alba, Verdana, Geneva, sans-serif';
    const large = ctx.measureText(valeur).width;
    if (large > dispo) {
      taille = Math.max(10, Math.floor(taille * dispo / large));
      ctx.font = taille + 'px Alba, Verdana, Geneva, sans-serif';
    }
    ctx.lineWidth = taille * 0.13;
    const xd = x + l - taille * 0.1;
    ctx.strokeText(valeur, xd, y + h / 2);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, DEGRADE[0]);
    g.addColorStop(1, DEGRADE[1]);
    ctx.fillStyle = g;
    ctx.fillText(valeur, xd, y + h / 2);
  }
}

// Monte le tableau de bord si le joueur possède le pack : il devient une
// partie de la scène, que la boucle du jeu peint à chaque image.
function monter(jeu) {
  const options = jeu.plateforme && jeu.plateforme.options;
  if (!options || !options.snake3Hud) return Promise.resolve(null);
  const pack = new Pack();
  jeu.pack = pack;
  jeu.redimensionner();
  // L'Alba est la fonte embarquée du jeu : sans elle, les chiffres sortiraient
  // en Verdana le temps du chargement.
  let pret = Promise.resolve();
  try {
    if (racine.document && racine.document.fonts && racine.document.fonts.load) {
      pret = racine.document.fonts.load('40px Alba');
    }
  } catch (e) { /* pas de police chargeable : Verdana fera l'affaire */ }
  return Promise.resolve(pret).catch(() => {}).then(() => pack);
}

const API = {
  Pack, monter, mmss, valeurs, LIGNES,
  H_MIN, H_MAX, L_COLONNE, VERT, LISERE,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakePack = API;

})(typeof window !== 'undefined' ? window : globalThis);
