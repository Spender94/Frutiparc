/*
 * Frutisnake — le « pack de Frutisnake », côté light.
 *
 * L'article 40 de la boutique (300 kikooz) ouvre un tableau de bord de partie :
 * longueur du serpent, fruits avalés, dynamites ramassées, durée du bonus en
 * cours, durée de la partie. C'est la même option de confort que sur le disque
 * Flash — là-bas game-popup.html la dessine à côté de la scène, à partir des
 * valeurs que le SWF patché remonte par fpSnakeHud ; ici le moteur est en JS,
 * les valeurs se lisent donc directement (Jeu.releve()).
 *
 * Le panneau est repris trait pour trait du disque : fond #83CA22, bordure
 * blanche de 2 px, intitulés en Verdana gras 11 px, valeurs tracées avec les
 * glyphes de la police Alba du portail (public/fb/alba-glyphs.json), remplies
 * d'un dégradé rose et contournées de blanc. Sans les glyphes (fichier absent),
 * on retombe sur du texte : le tableau reste lisible.
 *
 * Deux dispositions, selon la place :
 *   · en colonne, à côté du jeu — bureau et téléphone tenu en PAYSAGE, là où
 *     le jeu est limité par la HAUTEUR et laisse du vide sur les côtés ;
 *   · en bandeau, sous le jeu — téléphone tenu en PORTRAIT, où le jeu est
 *     limité par la largeur et laisse du vide dessous.
 * Le basculement est fait par la feuille de style (index.html) ; ce module ne
 * s'occupe que du contenu.
 */
'use strict';

(function (racine) {

// Les intitulés du disque, et leur abrégé pour le BANDEAU d'un téléphone en
// portrait : cinq cases de soixante-dix points ne logent pas « Durée bonus en
// cours ». En colonne (paysage, bureau) c'est l'intitulé complet, comme sur le
// disque — il tient sur deux lignes s'il le faut.
const LIGNES = [
  { cle: 'longueur', titre: 'Longueur', court: 'Longueur' },
  { cle: 'fruits', titre: 'Fruits avalés', court: 'Fruits' },
  { cle: 'dynamites', titre: 'Dynamites', court: 'Dynamites' },
  { cle: 'bonus', titre: 'Durée bonus en cours', court: 'Bonus' },
  { cle: 'chrono', titre: 'Durée de la partie', court: 'Partie' },
];

function mmss(sec) {
  const n = Math.max(0, Math.floor(sec));
  const m = Math.floor(n / 60), r = n % 60;
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

// Un nombre → un <svg> de tracés Alba. La boîte est calée sur la hauteur RÉELLE
// des chiffres, pas sur l'ascendante déclarée par la police (qui couvre accents
// et hampes et rendrait les nombres deux fois trop petits).
function tracerNombre(txt, alba) {
  txt = String(txt);
  if (!alba) return '<span class="pk-repli">' + txt + '</span>';
  let x = 0, chemins = '';
  for (const c of txt) {
    const g = alba.glyphes[c];
    if (!g) continue;
    chemins += '<path transform="translate(' + x + ',0)" d="' + g.d + '"/>';
    x += g.adv;
  }
  if (!x) return '';
  const m = 60;
  const haut = alba.hautChiffres - m;
  const ht = (alba.basChiffres - alba.hautChiffres) + 2 * m;
  return '<svg class="pk-num" viewBox="' + (-m) + ' ' + haut + ' ' + (x + 2 * m) + ' ' + ht
    + '" preserveAspectRatio="xMaxYMid meet"><g>' + chemins + '</g></svg>';
}

class Pack {
  constructor(hote) {
    this.hote = hote;                  // le <div id="pack">
    this.alba = null;
    this.cases = null;
    this.dernier = '';
  }

  // Le squelette : un dégradé partagé, puis un intitulé + une pastille par
  // ligne. La pastille blanche reprend la jauge du jeu, le nombre repose
  // dessus et la déborde — comme le gabarit du disque.
  construire() {
    let html = '<svg width="0" height="0" class="pk-defs"><defs>'
      + '<linearGradient id="pk-alba" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="#E7A8A8"/><stop offset="1" stop-color="#E46A6A"/>'
      + '</linearGradient></defs></svg>';
    for (const l of LIGNES) {
      html += '<div class="pk-ligne">'
        + '<div class="pk-lab"><span class="pk-long">' + l.titre + '</span>'
        + '<span class="pk-court">' + l.court + '</span></div>'
        + '<div class="pk-case"><div class="pk-pastille"></div>'
        + '<div class="pk-val" data-cle="' + l.cle + '"></div></div>'
        + '</div>';
    }
    this.hote.innerHTML = html;
    this.cases = this.hote.querySelectorAll('.pk-val');
    this.hote.classList.add('pk-actif');
  }

  // Appelé à chaque image : ne touche au DOM que si un chiffre a changé.
  rafraichir(r) {
    if (!this.cases) this.construire();
    const valeurs = r ? {
      longueur: r.longueur,
      fruits: r.fruits,
      dynamites: r.dynamites,
      bonus: mmss(Math.ceil(r.bonus)),
      chrono: mmss(r.chrono),
    } : { longueur: 0, fruits: 0, dynamites: 0, bonus: '00:00', chrono: '00:00' };
    const signature = LIGNES.map((l) => valeurs[l.cle]).join('|');
    if (signature === this.dernier) return;
    this.dernier = signature;
    for (const c of this.cases) {
      c.innerHTML = tracerNombre(valeurs[c.getAttribute('data-cle')], this.alba);
    }
  }
}

// Monte le tableau de bord si le joueur possède le pack. `jeu` est le Jeu déjà
// démarré : on lui demande son relevé à chaque image (c'est une lecture de
// champs, le coût est nul ; le DOM, lui, ne bouge qu'au changement).
function monter(jeu, hote) {
  if (!hote || !jeu.plateforme.options || !jeu.plateforme.options.snake3Hud) {
    return Promise.resolve(null);
  }
  const pack = new Pack(hote);
  pack.construire();
  pack.rafraichir(null);
  jeu.surImage = () => pack.rafraichir(jeu.releve());
  return fetch('/fb/alba-glyphs.json', { cache: 'force-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((f) => {
      if (f && f.glyphes) { pack.alba = f; pack.dernier = ''; pack.rafraichir(jeu.releve()); }
      return pack;
    })
    .catch(() => pack);
}

const API = { Pack, monter, mmss, tracerNombre, LIGNES };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakePack = API;

})(typeof window !== 'undefined' ? window : globalThis);
