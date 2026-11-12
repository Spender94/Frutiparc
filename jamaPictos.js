'use strict';
/*
 * LES 28 PICTOS DE JAMAJAMA — noms et conditions.
 *
 * Les images sont celles de l'album d'époque (une planche de 2007, 28/28),
 * redessinées depuis les tracés du jeu (scripts/make-jamajama-pictos.js) — la
 * 28e est l'originale. Les NOMS et les CONDITIONS sont la proposition du forum
 * de novembre 2026 (1Cevin, discutée avec acgi et Toad06), adoptée par le
 * parc : l'album d'époque n'en a laissé aucune trace, et le mode Aventure de
 * 2005 était quasiment vide (Toad06 a écrit les séries depuis).
 *
 * RIEN NE VIENT DU NAVIGATEUR. Tout se lit au REJEU que le serveur fait déjà
 * de chaque partie finie (/api/jamajama/score) : le moteur de règles
 * (public/jamajama/regles.js) compte en jouant — fusions, fruits brûlés,
 * bombes, attractions d'aimant, cocons, caisses à l'eau, bouchées de Louki,
 * passages de sens unique, pas en fantôme, échanges avec Kohl, Winkle relâché
 * dans l'eau, flammes passées sur des cailloux ou des runes, Zoeils bouchés,
 * araignées mortes — et le verdict dit la victoire et le nombre de coups.
 *
 * L'état du joueur tient dans son slot « jamajama », que seul le serveur
 * écrit (`pictos` : les compteurs, les niveaux gagnés, quelques drapeaux).
 * Un même replay ne compte qu'une fois (empreinte du niveau et des coups) :
 * renvoyer cent fois la même partie n'avance aucun compteur.
 *
 * Ce module ne connaît ni le serveur ni la base : il range une partie dans
 * l'état, puis dit quels pictos sont acquis et où en est chacun.
 */
const crypto = require('crypto');

// Les compteurs relevés par le moteur (Partie.stats) et cumulés ici.
const COMPTEURS = ['fusion', 'fruitBrule', 'bombe', 'aimant', 'flammeCaillou', 'cocon', 'caisseEau',
  'louki', 'voieUnique', 'fantome', 'kohl', 'winkleEau', 'zoeil'];

/*
 * Les 28, dans l'ordre de la planche (= jamaNN.png). `objet` dit ce que le
 * picto représente ; `nom` est son titre (le nom d'affichage) ; `quoi` la
 * condition telle qu'on l'affiche au joueur. `seuil` + `compteur` pour les
 * cumuls, `regle` pour le reste (voir `acquis`).
 */
const PICTOS = [
  { n: 1, objet: 'Banane', nom: 'Première pulpe', quoi: 'Fusionner ses 10 premières paires de fruits', compteur: 'fusion', seuil: 10 },
  { n: 2, objet: 'Orange', nom: 'Orange pressée', quoi: 'Fusionner 100 paires de fruits', compteur: 'fusion', seuil: 100 },
  { n: 3, objet: 'Pêche', nom: 'Pêche d’enfer', quoi: 'Brûler 25 fruits avec une BoBombe', compteur: 'fruitBrule', seuil: 25 },
  { n: 4, objet: 'Poire', nom: 'Bonne poire', quoi: 'Finir un niveau où au moins un fruit a été brûlé et un autre fusionné', regle: 'poire' },
  { n: 5, objet: 'Prune', nom: 'Pour des prunes', quoi: 'Fusionner 1 000 paires de fruits', compteur: 'fusion', seuil: 1000 },
  { n: 6, objet: 'Aimant', nom: 'Attraction fatale', quoi: 'Faire attirer 50 objets par un aimant', compteur: 'aimant', seuil: 50 },
  { n: 7, objet: 'Aimant en or', nom: 'Le cœur en or', quoi: 'Finir les niveaux de l’Aventure qui contiennent un aimant en or', regle: 'aimantOr' },
  { n: 8, objet: 'Araignée', nom: 'Arachnophobe', quoi: 'Finir 10 niveaux à araignées sans qu’aucune araignée ne meure', regle: 'araignees', seuil: 10 },
  { n: 9, objet: 'BoBombe', nom: 'Artificier', quoi: 'Faire exploser 100 BoBombes', compteur: 'bombe', seuil: 100 },
  { n: 10, objet: 'Cailloux', nom: 'Petit poucet', quoi: 'Laisser passer les flammes d’une BoBombe à travers 10 cailloux ou runes', compteur: 'flammeCaillou', seuil: 10 },
  { n: 11, objet: 'Cocon', nom: 'Réveil difficile', quoi: 'Faire sortir 20 araignées de leur cocon', compteur: 'cocon', seuil: 20 },
  { n: 12, objet: 'Eau', nom: 'Plouf !', quoi: 'Faire couler 50 caisses dans l’eau', compteur: 'caisseEau', seuil: 50 },
  { n: 13, objet: 'Électrificator', nom: 'Électrificator grillé', quoi: 'Finir les niveaux de l’Aventure qui contiennent un Électrificator et une BoBombe', regle: 'electro' },
  { n: 14, objet: 'Voie unique', nom: 'Sens interdit', quoi: 'Passer 200 fois sur une voie unique', compteur: 'voieUnique', seuil: 200 },
  { n: 15, objet: 'Jade', nom: 'Pierre précieuse', quoi: 'Finir un niveau contenant du jade', regle: 'jade' },
  { n: 16, objet: 'Kohl', nom: 'Téléportation', quoi: 'Échanger sa place avec Kohl 50 fois', compteur: 'kohl', seuil: 50 },
  { n: 17, objet: 'Louki', nom: 'Copain goinfre', quoi: 'Faire manger 100 murs, caisses ou Loukis par un Louki', compteur: 'louki', seuil: 100 },
  { n: 18, objet: 'Lurker', nom: 'Le Lurker se fend la poire', quoi: 'Finir les niveaux à Lurker de l’Aventure sans perdre entre deux', regle: 'lurker' },
  { n: 19, objet: 'Mur', nom: 'Créateur', quoi: 'Publier un niveau validé dans l’Édition', regle: 'createur' },
  { n: 20, objet: 'Petit Louki', nom: 'Little Star', quoi: 'Finir la Grotte 14 « Winkle, Little Star » en moins de 40 coups', regle: 'littleStar' },
  { n: 21, objet: 'Rune', nom: 'Runes du Pilat', quoi: 'Finir la Caverne II-9 « Les runes du Pilat »', regle: 'runes' },
  { n: 22, objet: 'Tiki', nom: 'Héros dactylographe', quoi: 'Finir une Caverne étoile (I-*, II-*…)', regle: 'etoile' },
  { n: 23, objet: 'Tiki endormi', nom: 'Fantôme', quoi: 'Faire 1 000 déplacements en fantôme', compteur: 'fantome', seuil: 1000 },
  { n: 24, objet: 'Poulpi ailé', nom: 'Prêt pour la grande aventure', quoi: 'Finir les 16 niveaux de « Premiers pas »', regle: 'premiersPas' },
  { n: 25, objet: 'Poulpi souriant', nom: 'Tout feu tout flamme', quoi: 'Terminer la série « Tout feu tout flamme » (sa Caverne II-*)', regle: 'tftf' },
  { n: 26, objet: 'Winkle', nom: 'Petite étoile', quoi: 'Posséder un Winkle et le relâcher dans l’eau 25 fois', compteur: 'winkleEau', seuil: 25 },
  { n: 27, objet: 'Zoeil', nom: 'Le mauvais Zoeil', quoi: 'Bloquer un Zoeil en poussant une caisse dessus', compteur: 'zoeil', seuil: 1 },
  { n: 28, objet: 'Tiki et ses amis', nom: 'Le chemin de la délivrance', quoi: 'Obtenir les 27 autres pictos JamaJama', regle: 'tous' },
];
const ID = (n) => '$jama_picto' + String(n).padStart(2, '0');
const VUS_MAX = 400;                       // les empreintes de replays déjà comptés

/*
 * Les niveaux de l'Aventure que nomment les conditions, lus dans levels.xml
 * (le serveur les passe tels quels : [{ titre, total, niveaux: [{ titre, contenu }] }]).
 * `R` est le moteur de règles, pour reconnaître les éléments d'un niveau.
 */
function elementsDe(R, contenu) {
  const ids = new Set();
  if (!contenu) return ids;
  try { for (const t of R.Level.depuisChaine(contenu).tiles) ids.add(t.id); } catch (e) { /* niveau illisible */ }
  return ids;
}
function niveauxCibles(R, packs) {
  const E = R.Element;
  const cle = (p, i) => 'a' + p + '.' + i;
  const c = { premiersPas: [], tftf: [], etoiles: [], aimantOr: [], lurker: [], electro: [], littleStar: [], runes: [] };
  (packs || []).forEach((pack, p) => {
    const nomPack = String(pack.titre || '').trim().toLowerCase();
    // La dernière série, « Le chemin de la délivrance », ne s'ouvre qu'après
    // l'énigme finale — qui demande des séries pas encore écrites (Toad06) :
    // ses niveaux ne comptent dans aucune condition.
    if (/d[ée]livrance/.test(nomPack)) return;
    const jouables = [];
    (pack.niveaux || []).forEach((n, i) => {
      if (!n.contenu) return;
      jouables.push(i);
      const titre = String(n.titre || '').replace(/\s+/g, ' ');
      const ids = elementsDe(R, n.contenu);
      if (p === 0) c.premiersPas.push(cle(p, i));
      if (/\*\s*:/.test(titre)) c.etoiles.push(cle(p, i));
      if (ids.has(E.GMAGNET)) c.aimantOr.push(cle(p, i));
      if (ids.has(E.LURKER)) c.lurker.push(cle(p, i));
      if (ids.has(E.ARCHER) && ids.has(E.BOMB)) c.electro.push(cle(p, i));
      if (/little star/i.test(titre)) c.littleStar.push(cle(p, i));
      if (/runes du pilat/i.test(titre)) c.runes.push(cle(p, i));
    });
    // « Tout feu tout flamme » : une série est TERMINÉE quand son dernier
    // niveau est réussi (la règle du jeu, cf. packsOuverts) — sa Caverne II-*.
    if (/tout feu tout flamme/.test(nomPack) && jouables.length) c.tftf.push(cle(p, jouables[jouables.length - 1]));
  });
  return c;
}

function etatVide() {
  const c = {};
  for (const k of COMPTEURS) c[k] = 0;
  return { v: 1, c, g: {}, araignees: [], lurkerSerie: [], drapeaux: {}, vus: [] };
}
function normaliser(e) {
  const x = etatVide();
  if (!e || typeof e !== 'object') return x;
  for (const k of COMPTEURS) x.c[k] = Math.max(0, Math.floor(Number(e.c && e.c[k]) || 0));
  if (e.g && typeof e.g === 'object') for (const k of Object.keys(e.g)) if (/^[at][\d.]+$/.test(k)) x.g[k] = 1;
  x.araignees = Array.isArray(e.araignees) ? e.araignees.filter((k) => typeof k === 'string').slice(0, 1000) : [];
  x.lurkerSerie = Array.isArray(e.lurkerSerie) ? e.lurkerSerie.filter((k) => typeof k === 'string').slice(0, 50) : [];
  if (e.drapeaux && typeof e.drapeaux === 'object') for (const k of Object.keys(e.drapeaux)) if (e.drapeaux[k]) x.drapeaux[k] = true;
  x.vus = Array.isArray(e.vus) ? e.vus.filter((k) => typeof k === 'string').slice(-VUS_MAX) : [];
  if (e.importe) x.importe = true;
  return x;
}

// La chaîne d'aventure du jeu (« N[l,l,…; ») : les niveaux qu'il dit finis.
function niveauxDeLAventure(chaine) {
  const out = [];
  for (const morceau of String(chaine || '').split(';')) {
    if (!morceau) continue;
    const pack = parseInt(morceau, 10);
    if (!(pack >= 0)) continue;
    for (const n of morceau.substring(String(pack).length + 1).split(',')) {
      const i = parseInt(n, 10);
      if (i >= 0) out.push('a' + pack + '.' + i);
    }
  }
  return out;
}
/*
 * L'IMPORT, une fois : les niveaux d'Aventure que le joueur avait déjà finis
 * avant les pictos (sa sauvegarde du jeu) comptent comme gagnés. Les
 * compteurs, eux, partent de zéro — aucune partie passée n'a été gardée.
 */
function importerAventure(etat, chaine) {
  if (etat.importe) return etat;
  for (const k of niveauxDeLAventure(chaine)) etat.g[k] = 1;
  etat.importe = true;
  return etat;
}

/*
 * Range une partie FINIE (rejouée par le serveur) dans l'état.
 *   partie = { cle: 'a1.7' | 't200004', mouvements, victorieux, coups, stats,
 *              elements: Set des ids d'éléments du niveau }
 * `E` : les identifiants d'éléments du moteur (R.Element).
 * Rend l'état (modifié en place).
 */
function enregistrerPartie(etat, partie, cibles, E) {
  const stats = partie.stats || {};
  const empreinte = crypto.createHash('sha1')
    .update(partie.cle + ':' + (partie.mouvements || []).join('')).digest('hex').slice(0, 20);
  // Les cumuls : un replay déjà compté n'ajoute rien.
  if (!etat.vus.includes(empreinte)) {
    for (const k of COMPTEURS) etat.c[k] += Math.max(0, Math.floor(Number(stats[k]) || 0));
    etat.vus.push(empreinte);
    if (etat.vus.length > VUS_MAX) etat.vus.splice(0, etat.vus.length - VUS_MAX);
  }
  const els = partie.elements || new Set();
  if (partie.victorieux) {
    etat.g[partie.cle] = 1;
    if ((stats.fruitBrule || 0) > 0 && (stats.fusion || 0) > 0) etat.drapeaux.poire = true;
    if (els.has(E.JADE)) etat.drapeaux.jade = true;
    if (els.has(E.SPIDER) && !(stats.araigneeMorte > 0) && !etat.araignees.includes(partie.cle)) etat.araignees.push(partie.cle);
    if ((cibles.littleStar || []).includes(partie.cle) && partie.coups < 40) etat.drapeaux.littleStar = true;
  }
  // Le Lurker « sans perdre » : les niveaux à lurker de l'Aventure gagnés à
  // la suite ; une défaite sur l'un d'eux remet la série à zéro.
  if ((cibles.lurker || []).includes(partie.cle)) {
    if (partie.victorieux) { if (!etat.lurkerSerie.includes(partie.cle)) etat.lurkerSerie.push(partie.cle); }
    else etat.lurkerSerie = [];
    if (cibles.lurker.length && cibles.lurker.every((k) => etat.lurkerSerie.includes(k))) etat.drapeaux.lurker = true;
  }
  return etat;
}

// Tous les niveaux d'une liste sont-ils gagnés ? (une liste vide ne se gagne pas)
const tousGagnes = (etat, liste) => !!(liste && liste.length && liste.every((k) => etat.g[k]));

/*
 * Où en est chaque picto : { n, id, nom, quoi, acquis, actuel, cible }.
 * `ctx` = { cibles, publies, possedes: Set des ids de pictos déjà obtenus }.
 */
function progression(etat, ctx) {
  const c = ctx.cibles || {};
  const possedes = ctx.possedes || new Set();
  const compte = (liste) => (liste || []).filter((k) => etat.g[k]).length;
  const lignes = PICTOS.map((p) => {
    let actuel = 0, cible = 1;
    if (p.compteur) { actuel = etat.c[p.compteur] || 0; cible = p.seuil; }
    else switch (p.regle) {
      case 'poire': actuel = etat.drapeaux.poire ? 1 : 0; break;
      case 'jade': actuel = etat.drapeaux.jade ? 1 : 0; break;
      case 'littleStar': actuel = etat.drapeaux.littleStar ? 1 : 0; break;
      case 'lurker': actuel = etat.drapeaux.lurker ? (c.lurker || []).length : etat.lurkerSerie.length; cible = (c.lurker || []).length || 1; break;
      case 'araignees': actuel = etat.araignees.length; cible = p.seuil; break;
      case 'aimantOr': actuel = compte(c.aimantOr); cible = (c.aimantOr || []).length || 1; break;
      case 'electro': actuel = compte(c.electro); cible = (c.electro || []).length || 1; break;
      case 'premiersPas': actuel = compte(c.premiersPas); cible = (c.premiersPas || []).length || 1; break;
      case 'tftf': actuel = tousGagnes(etat, c.tftf) ? 1 : 0; break;
      case 'runes': actuel = tousGagnes(etat, c.runes) ? 1 : 0; break;
      case 'etoile': actuel = (c.etoiles || []).some((k) => etat.g[k]) ? 1 : 0; break;
      case 'createur': actuel = Math.min(1, Math.floor(Number(ctx.publies) || 0)); break;
      default: break;
    }
    const id = ID(p.n);
    return { n: p.n, id, nom: p.nom, quoi: p.quoi, actuel: Math.min(actuel, cible), cible,
      acquis: possedes.has(id) || (p.regle !== 'tous' && actuel >= cible) };
  });
  // Le 28e : les 27 autres.
  const autres = lignes.filter((l) => l.n !== 28 && l.acquis).length;
  const der = lignes[27];
  der.actuel = autres; der.cible = 27;
  der.acquis = possedes.has(der.id) || autres >= 27;
  return lignes;
}

module.exports = {
  PICTOS, COMPTEURS, ID, etatVide, normaliser, niveauxCibles, elementsDe,
  importerAventure, niveauxDeLAventure, enregistrerPartie, progression,
};
