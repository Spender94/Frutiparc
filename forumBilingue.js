'use strict';
/*
 * LES MESSAGES À DEUX LANGUES DES PERSONNAGES DU FORUM.
 *
 * Dimitri (les gros coups, le Prunostiqueur du mois) et VieuxPruneau (la map
 * du jour de Motion Ball 2) postent pour TOUT LE MONDE : un même message, lu
 * par des francophones et des anglophones. On garde UN message — Dimitri
 * complète le sien dans la journée en le modifiant, VieuxPruneau cherche sa
 * marque « (graine X · carte vN) » dans le dernier, et leurs sujets se
 * retrouvent par leur titre français —, et on lui ajoute, APRÈS le français,
 * une version anglaise courte, séparée par un trait et posée en italique :
 *
 *     …le message français…
 *
 *     ────────────
 *     [i]…the English version…[/i]
 *
 * Le bloc anglais ne doit contenir ni [i] ni [/i] : le rendu BBCode du forum
 * (renderBBCode) referme l'italique au premier [/i] qu'il trouve.
 *
 * Natacha, elle, écrit à UN nouveau : son mot est dans la langue du nouveau,
 * sans bloc à part (natacha.js).
 */

const path = require('path');
const FPI18n = require('./public/js/i18n.js');

/*
 * LE TEXTE D'UN PERSONNAGE DANS UNE LANGUE. `fr` est la phrase française déjà
 * écrite (le module du personnage la compose comme avant, au mot près) ;
 * hors français, on prend la traduction de la clé dans la zone « forumbots »
 * (i18n-serveur/<langue>/forumbots.js), et le français s'il n'y en a pas.
 * Le dictionnaire est chargé ici à la première demande : le serveur le charge
 * aussi au démarrage, mais les modules des personnages doivent pouvoir servir
 * seuls (les tests les appellent sans serveur).
 */
const charges = new Set();
function traduire(lang, cle, fr, params) {
  const l = FPI18n.valide(lang) || 'fr';
  if (l === 'fr') return fr;
  if (!charges.has(l)) {
    charges.add(l);
    try { FPI18n.ajouter(l, require(path.join(__dirname, 'i18n-serveur', l, 'forumbots.js'))); } catch (e) { /* pas de dictionnaire */ }
  }
  return FPI18n.possede(l, cle) ? FPI18n.traduire(l, cle, fr, params) : fr;
}

const TRAIT = '────────────';
const SEPARATEUR = `\n\n${TRAIT}\n[i]`;

// Le message entier : le français, puis l'anglais s'il y en a un.
function postBilingue(fr, en) {
  const f = String(fr || '');
  const e = String(en || '').replace(/\[\/?i\]/gi, '').trim();
  return e ? `${f}${SEPARATEUR}${e}[/i]` : f;
}

// Les deux moitiés d'un message (en : '' quand il n'a pas de bloc anglais —
// un message d'avant, ou écrit par un humain).
function separerBilingue(contenu) {
  const s = String(contenu || '');
  const i = s.lastIndexOf(SEPARATEUR);
  if (i < 0) return { fr: s, en: '' };
  return { fr: s.slice(0, i), en: s.slice(i + SEPARATEUR.length).replace(/\[\/i\]\s*$/, '') };
}

module.exports = { TRAIT, SEPARATEUR, postBilingue, separerBilingue, traduire };
