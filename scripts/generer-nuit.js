#!/usr/bin/env node
/*
 * LE MODE NUIT, FABRIQUÉ PLUTÔT QU'ÉCRIT.
 *
 * « Si on l'écoutait, Frutiparc serait un site aux couleurs totalement
 *   désaturées, avec des petits fruits zombies et des décors de crypte […].
 *   Mais son temps viendra… »
 *
 * Il y a près de mille huit cents couleurs en dur dans les trois feuilles du
 * site (le <style> de light.html, bureau-frutiz.css, le <style> du forum) et
 * pas une seule variable CSS. Les reprendre à la main, c'était réécrire le
 * site ; et surtout c'était devoir le refaire à chaque retouche du thème de
 * jour. On fabrique donc la feuille de nuit AU LIEU de l'écrire : chaque
 * couleur passe par une conversion, et le résultat est une feuille de
 * SURCHARGE, chargée par-dessus les originales quand le mode est allumé.
 *
 * Le thème de jour n'est jamais touché. Éteindre le mode nuit, c'est retirer
 * une feuille : il ne peut rien casser.
 *
 * LA CONVERSION tient en deux idées.
 *
 *  1. La CLARTÉ se renverse, mais pas de la même façon selon le RÔLE de la
 *     couleur, et c'est là tout le sel : un FOND descend, un TEXTE monte, une
 *     BORDURE se pose entre les deux, une ombre déjà sombre ne bouge pas. Une
 *     simple fonction couleur→couleur ne peut pas savoir ce qu'elle teint ;
 *     le nom de la propriété, lui, le sait. C'est ce qui évite le travers
 *     classique du thème sombre bricolé : du texte sombre sur un fond sombre.
 *  2. La TEINTE se rejoue par FAMILLE — le châssis au violet, le rose gardé
 *     comme accent, les autres couleurs laissées tranquilles. Voir la longue
 *     note devant `convertir` : c'est elle qui décide de quoi le parc a l'air
 *     la nuit.
 *
 * Le rouge des cris de modération n'est PAS dans les feuilles (le serveur
 * l'écrit dans le message) : l'alerte garde donc sa couleur d'alerte sans
 * qu'on ait à la protéger.
 *
 * LES DESSINS D'ÉPOQUE GARDENT LEURS COULEURS. Les fruits du bureau, les
 * bouilles des émotions, ceux du frutimandala : ce sont eux qui font le parc,
 * et une nuit où ils seraient éteints serait une nuit sans parc. Seul le
 * CHÂSSIS — les cadres de fenêtre, les onglets, l'écran de la main bar, le
 * boîtier du Frusion — s'assombrit, parce qu'il n'illustre rien : il encadre.
 * Un fichier « nom-nuit.svg » déposé à côté de « nom.svg » prend
 * automatiquement sa place et échappe au filtre — c'est ainsi que le chantier
 * de redessin avance un fichier à la fois, sans liste à tenir.
 *
 *   node scripts/generer-nuit.js            écrit les feuilles
 *   node scripts/generer-nuit.js --verifier n'écrit rien, sort 1 si périmé
 *
 * Le test test/modeNuit.test.js appelle la seconde forme : une retouche du
 * thème de jour sans régénération est une erreur de test, pas une surprise
 * en production.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const P = (...x) => path.join(RACINE, ...x);

// ── Couleurs ────────────────────────────────────────────────────────────────

function hexVersRgb(t) {
  let v = t.slice(1);
  if (v.length === 3 || v.length === 4) v = v.split('').map((c) => c + c).join('');
  const a = v.length === 8 ? parseInt(v.slice(6, 8), 16) / 255 : 1;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), a];
}

function rgbVersHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let s = 0, h = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

function hslVersRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  if (!s) return [l, l, l].map((v) => v * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const t = (x) => {
    if (x < 0) x += 1; if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [t(h + 1 / 3), t(h), t(h - 1 / 3)].map((v) => v * 255);
}

/*
 * LA CLARTÉ N'EST PAS LA LUMINANCE, et c'est le piège de tout thème sombre.
 *
 * `hsl(60 50% 26%)` — le jaune du panneau d'inventaire — et `hsl(256 30% 26%)`
 * — le violet des fenêtres — annoncent la même clarté ; l'œil, lui, voit le
 * jaune deux fois plus lumineux (l'œil pèse surtout le vert, dont le jaune est
 * plein et le violet dépourvu). Le texte le plus sombre du thème s'y lisait
 * donc très bien sur l'un et mal sur l'autre.
 *
 * On plafonne donc les FONDS à une LUMINANCE, pas à une clarté : celle sur
 * laquelle le texte le plus sombre du thème tient encore le rapport visé. Le
 * reste du thème n'a pas à s'en soucier.
 */
function luminance(r, g, b) {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
// Les deux teintes du parc de nuit. Ce qu'elles veulent dire : voir la note
// devant `convertir`.
const VIOLET = 256;          // la teinte du châssis
const ROSE_NUIT = 325;       // celle des accents

/*
 * LES DEUX BORNES QUI RENDENT LE THÈME LISIBLE PAR CONSTRUCTION.
 *
 * Aucun fond au-dessus de LUM_FOND_MAX, aucun texte en dessous de
 * LUM_TEXTE_MIN, et les deux sont choisies pour que le pire couple possible
 * tienne RATIO_VISE. Ce n'est alors plus une relecture écran par écran : c'est
 * garantie arithmétique, valable pour toute couleur du parc, y compris celles
 * qu'on n'a pas encore écrites.
 *
 * Et en LUMINANCE, pas en clarté — sans quoi un texte bleu vif et un texte
 * lavande, tous deux « à 68 % », seraient tenus pour équivalents alors que
 * l'un est deux fois plus sombre que l'autre.
 */
// LE NIVEAU DU PARC, ET IL SE MESURE. Relevé sur une capture du bureau de
// nuit : les panneaux y sont autour de 33 % de clarté violette, le texte
// presque blanc. À 0,045 — la première valeur essayée — les panneaux tombaient
// quinze points plus bas : le parc paraissait ÉTEINT, pas nocturne. 0,078
// place le plafond des fonds à ~36 % et remonte d'autant le plancher du texte,
// puisque les deux sont liés par RATIO_VISE.
const LUM_FOND_MAX = 0.078;
// LE RAPPORT VISÉ, et il est plus haut que le minimum réglementaire. À 4,5
// pile — le seuil AA — le texte tenait, mais le parc paraissait mou : c'est un
// plancher d'accessibilité, pas un réglage d'écran. À 5,5 le texte se détache
// franchement de son panneau, ce qui est aussi ce qu'on voit sur les captures
// du bureau de nuit. Deux effets d'un seul chiffre : remonter le plancher du
// texte, et garder de la marge sur les arrondis (les deux bornes s'atteignent
// par pas d'un demi-point de clarté, puis s'écrivent au dixième — viser le
// seuil exact, c'est le rater d'un centième une fois sur vingt).
const RATIO_VISE = 5.5;
const LUM_TEXTE_MIN = RATIO_VISE * (LUM_FOND_MAX + 0.05) - 0.05;

function plafonnerLuminance(h, s, l) {
  let v = l;
  while (v > 1 && luminance(...hslVersRgb(h, s, v)) > LUM_FOND_MAX) v -= 0.5;
  return v;
}
function releverLuminance(h, s, l) {
  let v = l;
  while (v < 100 && luminance(...hslVersRgb(h, s, v)) < LUM_TEXTE_MIN) v += 0.5;
  return v;
}

const arrondi = (x, n) => Number(x.toFixed(n));

function hsl(h, s, l, a) {
  const t = `hsl(${arrondi(h, 0)} ${arrondi(s, 0)}% ${arrondi(l, 1)}%`;
  return a >= 1 ? `${t})` : `${t} / ${arrondi(a, 3)})`;
}

// Les trois rôles d'une couleur, et la courbe de clarté de chacun.
// L'exposant creuse : les grands aplats clairs tombent vite, les valeurs
// sombres — celles du texte d'origine — remontent doucement.
const COURBES = {
  // LES FONDS. Le thème de jour range presque tous ses aplats entre 65 % et
  // 100 % de clarté et se sert d'écarts de deux ou trois points pour séparer
  // une carte de la page. Une courbe creusée écraserait ces écarts-là ; on
  // étale donc le haut de l'échelle sur toute la plage utile de la nuit
  // (16 % → 36 %), et l’on plafonne. Un fond DÉJÀ sombre, lui, ne se renverse
  // pas : un voile noir doit rester noir, pas devenir un voile gris clair.
  // Le plafond n'est pas un choix d'esthète : c'est le fond le plus clair sur
  // lequel le texte le plus sombre du thème tient encore 4,5:1 (LUM_FOND_MAX
  // le borne pour de bon, en luminance).
  fond: (l) => (l <= 20 ? l * 0.85 : Math.min(10 + 72 * (100 - l) / 100, 36)),
  // Les bordures se posent entre les deux, et toujours visibles.
  bordure: (l) => 30 + 32 * (100 - l) / 100,                  // 30 % → 62 %
  // Le texte ne se renverse pas : il MONTE, toujours, en gardant sa hiérarchie
  // d'origine (ce qui était le plus clair reste le plus clair).
  texte: (l) => 74 + 22 * (l / 100),                          // 96 % → 74 %
  // Une ombre sombre reste une ombre : on la décolore sans toucher à sa
  // clarté. Une ombre CLAIRE, elle — les liserés et les reliefs d'époque —,
  // deviendrait un halo lumineux : on la traite comme un fond.
  ombre: (l) => (l <= 40 ? l : COURBES.fond(l)),
  /*
   * LES DESSINS DE CHÂSSIS (scripts/nuit-svg.js) — une courbe à part, et
   * voici pourquoi. Un aplat CSS est seul dans son coin : l'écraser sur le
   * plafond ne coûte rien. Un sprite, lui, est un DESSIN : un liseré plus
   * sombre autour d'un fond plus clair, une face éclairée et une face à
   * l'ombre. La courbe des fonds, qui plafonne, aplatissait ces écarts-là et
   * rendait une gélule sans bord et une roue sans quartiers.
   *
   * Celle-ci est donc MONOTONE sur toute la plage utile : elle comprime, mais
   * elle n'écrase jamais deux valeurs voisines l'une sur l'autre.
   *
   * LE PLAFOND DUR A SAUTÉ, et c'est ce qui a rendu leur relief aux dessins.
   * Il était posé à 38 : tout ce qui, dans le dessin de jour, était plus
   * sombre qu'un gris moyen — les traits, les cernes, les glyphes, TOUTE la
   * moitié basse de l'échelle — retombait sur cette seule valeur. Un bouton
   * du Frusion, c'est un anneau et un pictogramme : les deux sortaient de la
   * même couleur, et le pictogramme disparaissait. Mesuré sur la rampe des
   * gris : de #888888 à #000000, une seule et même sortie.
   *
   * Au-dessus de 38 la courbe COMPRIME donc au lieu de couper (0,55 par point
   * de clarté). Ce qui était clair ne bouge pas d'un cheveu — les dessins déjà
   * réglés le restent —, et ce qui était sombre s'étale de 38 à 61 : le trait
   * redevient un liseré clair sur une face sombre, comme sur un vrai boîtier
   * de nuit.
   */
  sprite: (l) => {
    const v = 8 + 0.72 * (100 - l);
    return v <= 38 ? v : 38 + (v - 38) * 0.55;
  },
};

/*
 * LES TROIS FAMILLES DU PARC, ET CE QU'ELLES DEVIENNENT LA NUIT.
 *
 * Le thème de jour se lit en trois couleurs : le VERT (les aplats, les
 * fenêtres, le corps du texte), le ROSE (les boutons, les en-têtes, les
 * pseudos) et une poignée d'ACCENTS (le jaune des kikooz, l'orange du fil
 * d'Ariane, le bleu des voyants). La nuit ne les traite pas pareil :
 *
 *   · le vert et les gris — le CHÂSSIS — partent au VIOLET. C'est eux qui
 *     donnent le ton, et c'est le seul endroit où l'on abandonne la teinte
 *     d'origine : un parc de nuit vert sombre reste un parc en vert, un parc
 *     de nuit violet est autre chose ;
 *   · le rose RESTE ROSE. Il ne s'éteint pas, il change de fonction : vif en
 *     texte, en glyphe et en liseré — les pseudos, les quatre boutons du
 *     salon —, prune profonde quand il porte un aplat. C'est l'accent qui
 *     empêche le violet de tourner au monochrome ;
 *   · les accents gardent leur teinte. Un jaune de kikooz violet ne serait
 *     plus un kikooz.
 */
// La famille rose/rouge : ses teintes relevées dans les trois feuilles vont de
// 335° à 16°. L'orange (#FF6600, 24°) en est dehors.
const ROSE_DE = 335, ROSE_A = 16;
const estRose = (h, s) => s > 12 && (h >= ROSE_DE || h <= ROSE_A);

// Le vert du parc est remarquablement groupé : les vingt verts des trois
// feuilles tiennent entre 85° et 95°. La bande est large pour attraper aussi
// les kakis et les olives, sans mordre sur le jaune (60°) ni sur le cyan.
const estChassis = (h, s) => s < 15 || (h >= 70 && h <= 165);

/*
 * LE PARCHEMIN — la SECONDE famille de décor du thème de jour.
 *
 * Le parc ne s'habille pas qu'en vert. La fenêtre des Scores est un parchemin
 * (#FACE68, #FBD888, texte #433005), la Messagerie un bloc-notes jaune
 * (#F8F866, #EAEA0E, texte #5A5A00), « Mes disques », l'inventaire, la grille
 * des accessoires, le bandeau du jour : tous crème et or. Ce n'est pas un
 * accent, c'est un DÉCOR — au même titre que le vert.
 *
 * La conversion les rangeait pourtant avec les accents, qui gardent leur
 * teinte : au milieu d'un parc violet, ces fenêtres-là sortaient OLIVE, un
 * jaune éteint qui ne va avec rien. Elles suivent donc le châssis.
 *
 * MAIS SEULEMENT EN CSS. Dans un DESSIN, un orange est une orange : la petite
 * orange de l'onglet, le fruit du Frusion, le jaune du bouton « swap ». Le
 * rôle `sprite` échappe donc à cette règle — c'est toute la différence entre
 * un aplat de fenêtre et une illustration.
 *
 * Reste ce qu'aucune règle de couleur ne peut sauver : l'arc-en-ciel du feutre
 * multicolore, dont l'orange et le jaune ne valent que par leurs voisins. Il
 * est rendu à la main dans scripts/nuit-retouches.css.
 */
const PARCHEMIN_DE = 17, PARCHEMIN_A = 70;
const estParchemin = (h, s) => s > 20 && h >= PARCHEMIN_DE && h <= PARCHEMIN_A;

/*
 * ET IL FAUT LE NIVELER SUR LE VERT, sans quoi il reste plus clair.
 *
 * Les deux familles ne sont pas au même étage dans le thème de JOUR. Relevé
 * sur les aplats des trois feuilles : le vert a une clarté médiane de 78 %,
 * le parchemin de 69 %. Neuf points d'écart, et la courbe RENVERSE la clarté
 * — le parchemin, plus sombre le jour, ressortait donc plus CLAIR la nuit.
 * Mesuré à l'écran avant correction : le corps d'une fenêtre à 20 %, la grille
 * de l'inventaire à 33 %, dans la même fenêtre.
 *
 * On remonte donc le parchemin de ces neuf points AVANT la courbe : il
 * traverse alors la conversion à la place qu'occupe le vert, et les deux
 * décors ressortent au même étage. L'écart est mesuré sur les FONDS ; sur les
 * autres rôles il pèse moins d'un point après la courbe.
 */
const PARCHEMIN_ECART = 9;

// Un aplat rose ne descend pas aussi bas que le châssis : sous 22 % il ne se
// distingue plus du violet, et l'accent disparaît.
const ROSE_FOND_MIN = 22;
// Un rose d'accent — glyphe, liseré — ne descend jamais sous ce seuil : c'est
// ce qui le fait lire comme un accent et non comme une couleur éteinte. En
// TEXTE il monte encore, parce qu'il lui arrive de se poser sur un aplat rose,
// et que deux roses voisins ne se lisent pas.
const ROSE_ACCENT_MIN = 66;
const ROSE_TEXTE_MIN = 74;

function convertir(r, g, b, a, role) {
  const [h, s, lJour] = rgbVersHsl(r, g, b);
  // Le parchemin rejoint le châssis — mais en CSS seulement, et nivelé sur le
  // vert (cf. estParchemin et PARCHEMIN_ECART). Dans un dessin, un orange est
  // une orange.
  const parchemin = role !== 'sprite' && estParchemin(h, s);
  const l = parchemin ? Math.min(100, lJour + PARCHEMIN_ECART) : lJour;
  let nh = h, ns, nl = COURBES[role](l);
  // Un dessin de châssis EST une surface : mêmes teintes et mêmes bornes
  // qu'un aplat, seule sa courbe de clarté diffère (elle ne plafonne pas).
  const surface = role === 'fond' || role === 'sprite';
  if (estRose(h, s)) {
    nh = ROSE_NUIT;
    // LE ROSE D'UN DESSIN NE S'ÉTEINT PAS. Les quatre boutons du salon, la
    // gélule de la liste, la barre de saisie : ce sont des COMMANDES, et le
    // rose y est ce qui les désigne comme telles. Passées en prune avec les
    // aplats, elles disparaissaient dans le violet — c'est la différence la
    // plus visible avec les captures d'époque. Elles gardent donc leur clarté
    // (à peine baissée), et leur hiérarchie interne avec : un dessin a un
    // fond et un liseré, pas une seule teinte.
    //
    // Un APLAT rose, lui, reste une prune : il peut porter du texte, et du
    // texte clair sur du rose clair ne se lit pas. Les commandes, elles, ne
    // portent que des glyphes.
    if (role === 'sprite') { ns = 68; nl = 0.92 * l; }
    else if (surface) { ns = 34; nl = Math.max(nl, ROSE_FOND_MIN); }
    else { ns = 58; nl = Math.max(nl, role === 'texte' ? ROSE_TEXTE_MIN : ROSE_ACCENT_MIN); }
  } else if (estChassis(h, s) || parchemin) {
    nh = VIOLET;
    // Le châssis est saturé, mais pas également : un fond violet franc, un
    // texte presque blanc — sans quoi tout vire au lilas.
    ns = surface ? 30 : role === 'bordure' ? 26 : 13;
  } else {
    // Un accent garde sa teinte, et une saturation qui le tient éveillé.
    ns = Math.min(Math.max(s * 0.55, 30), 62);
  }
  nl = Math.max(0, Math.min(100, nl));
  // Les deux bornes : un fond porte du texte, un texte se pose sur un fond.
  // Le rose d'un dessin échappe au plafond — il ne porte pas de texte, et
  // c'est justement sa clarté qui en fait une commande.
  const roseDeCommande = role === 'sprite' && estRose(h, s);
  // LE RELIEF D'UN DESSIN N'EST PAS UN FOND. Le plafond existe pour qu'un
  // aplat porte du texte ; il vaut donc pour la FACE d'un dessin — l'écran de
  // l'aquarium, le corps d'un onglet, tous nés d'une valeur claire. Mais ce
  // qui était SOMBRE dans le dessin de jour n'est pas une face : c'est un
  // trait, un cerne, un glyphe. Le rabattre sous le plafond des fonds, c'est
  // le ramener au niveau de la surface qu'il est censé détacher — et un
  // boîtier sans arêtes n'est plus qu'une tache.
  const reliefDeDessin = role === 'sprite' && lJour < 50;
  if (surface && !roseDeCommande && !reliefDeDessin) nl = plafonnerLuminance(nh, ns, nl);
  else if (role === 'texte') nl = releverLuminance(nh, ns, nl);
  return hsl(nh, ns, nl, a);
}

/*
 * « nom-nuit.svg » — LE CHANTIER DE REDESSIN, UN FICHIER À LA FOIS.
 *
 * Teindre un dessin d'époque au filtre, c'est un pis-aller : ça l'empêche de
 * jurer, ça ne le rend pas beau. La vraie réponse est de le redessiner. Mais
 * il y en a des centaines, et attendre qu'ils soient TOUS refaits pour en
 * servir un seul serait absurde.
 *
 * D'où la convention : on dépose « nom-nuit.svg » à côté de « nom.svg », on
 * relance le générateur, et c'est en ligne. Aucune liste à tenir à jour,
 * aucun code à toucher — le fichier sur le disque EST la déclaration. La
 * feuille de nuit fait alors deux choses pour lui :
 *   · elle pointe l'URL sur la variante, partout où le CSS la mentionne ;
 *   · elle lui RETIRE le filtre, puisqu'il n'a plus rien à cacher.
 *
 * Restent les dessins que le JavaScript pose lui-même (les fruits d'onglet,
 * la roue du frutimandala) et les <img> du HTML : le CSS les atteint par
 * sélecteur d'attribut, `content: url()` pour les uns, `background-image`
 * pour les autres.
 */
const SUFFIXE_NUIT = '-nuit';

function variantesNuit(racine = P('public')) {
  const trouve = new Map();               // « /chemin/jour.svg » → « /chemin/jour-nuit.svg »
  (function marcher(dir) {
    let entrees;
    try { entrees = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entrees) {
      const complet = path.join(dir, e.name);
      if (e.isDirectory()) { marcher(complet); continue; }
      const m = /^(.*)-nuit(\.[A-Za-z0-9]+)$/.exec(e.name);
      if (!m) continue;
      const jour = path.join(dir, m[1] + m[2]);
      // Une variante sans original ne remplace rien : on l'ignore plutôt que
      // d'émettre une règle qui ne s'appliquerait jamais.
      if (!fs.existsSync(jour)) continue;
      const web = (p) => '/' + path.relative(racine, p).split(path.sep).join('/');
      trouve.set(web(jour), web(complet));
    }
  }(racine));
  return trouve;
}

let VARIANTES = new Map();

// Les URL d'une valeur CSS, telles qu'elles y sont écrites.
const RE_URL = /url\((\s*['"]?)([^)'"]+)(['"]?\s*)\)/g;
const aUneVariante = (valeur) => {
  RE_URL.lastIndex = 0;
  let m, vu = false;
  while ((m = RE_URL.exec(valeur))) {
    if (!VARIANTES.has(m[2].trim())) return false;   // une seule manque : on fane
    vu = true;
  }
  return vu;
};
const poserVariantes = (valeur) =>
  valeur.replace(RE_URL, (m, a, u, b) => {
    const v = VARIANTES.get(u.trim());
    return v ? `url(${a}${v}${b})` : m;
  });

const RE_HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const RE_RGB = /\brgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*(?:[,/]\s*([0-9.%]+)\s*)?\)/g;

function teindreValeur(valeur, role) {
  return valeur
    .replace(RE_HEX, (m) => {
      const [r, g, b, a] = hexVersRgb(m);
      return convertir(r, g, b, a, role);
    })
    .replace(RE_RGB, (m, r, g, b, a) => {
      let alpha = a === undefined ? 1 : (String(a).endsWith('%') ? parseFloat(a) / 100 : parseFloat(a));
      return convertir(+r, +g, +b, alpha, role);
    });
}

const aUneCouleur = (v) => { RE_HEX.lastIndex = 0; RE_RGB.lastIndex = 0; return RE_HEX.test(v) || RE_RGB.test(v); };

/*
 * UNE OMBRE SANS FLOU N'EST PAS UNE OMBRE : C'EST UN LISERÉ.
 *
 * Le thème de jour cerne ses panneaux de `box-shadow: 0 0 0 2px #DDDDDD` —
 * pas une ombre portée, un trait. Traité comme une ombre, il gardait sa
 * clarté d'origine, se retrouvait plus clair que le fond de nuit… puis se
 * faisait rattraper par la règle qui rabat les ombres claires, et
 * disparaissait. Les panneaux perdaient leur contour, et le bureau son
 * rétroéclairage — ce halo pâle qui, sur les captures d'époque, détache
 * chaque cadre du fond.
 *
 * On les sépare donc couche par couche : flou nul, c'est une bordure ; flou
 * non nul, c'est bien une ombre.
 */
function couchesDOmbre(valeur) {
  const couches = [];
  let profondeur = 0, debut = 0;
  for (let i = 0; i < valeur.length; i++) {
    const c = valeur[i];
    if (c === '(') profondeur++;
    else if (c === ')') profondeur--;
    else if (c === ',' && !profondeur) { couches.push(valeur.slice(debut, i)); debut = i + 1; }
  }
  couches.push(valeur.slice(debut));
  return couches;
}

function estLisere(couche) {
  // Ce qui précède la couleur : `inset`, puis les longueurs.
  const avant = couche.split(/#|\brgba?\(|\bhsla?\(/)[0];
  const longueurs = avant.match(/-?[\d.]+(?:px|em|rem|pt)?/g) || [];
  if (!longueurs.length) return false;              // `box-shadow: none`, etc.
  const flou = longueurs.length >= 3 ? parseFloat(longueurs[2]) : 0;
  return flou === 0;
}

function teindreOmbre(valeur) {
  return couchesDOmbre(valeur)
    .map((couche) => teindreValeur(couche, estLisere(couche) ? 'bordure' : 'ombre'))
    .join(',');
}

// Le rôle d'une déclaration, d'après son nom de propriété.
function roleDe(propriete) {
  const p = propriete.trim().toLowerCase();
  if (/shadow$/.test(p) || p === 'filter' || p === 'backdrop-filter') return 'ombre';
  if (/^background/.test(p) || p === 'fill' || p === 'accent-color') return 'fond';
  if (p === 'color' || p === '-webkit-text-fill-color' || p === 'caret-color'
      || p === '-webkit-tap-highlight-color') return 'texte';
  if (/^(border|outline|column-rule|text-decoration|stroke|scrollbar)/.test(p)) return 'bordure';
  // Une variable CSS n'a pas de rôle lisible dans son nom : on la traite en
  // bordure, la courbe du milieu, la moins risquée des trois.
  return 'bordure';
}

// ── Un découpeur de CSS, juste assez fin pour nos trois feuilles ─────────────
// On ne cherche pas à analyser le CSS du monde : seulement le nôtre. Il suffit
// de savoir traverser commentaires, chaînes et parenthèses sans se faire
// piéger par une accolade ou un point-virgule qui s'y cache (`url(a;b)`).

function decouper(css) {
  let i = 0;
  const n = css.length;

  function sauterInsignifiant() {
    for (;;) {
      if (css.startsWith('/*', i)) {
        const f = css.indexOf('*/', i + 2);
        i = f < 0 ? n : f + 2;
      } else if (/\s/.test(css[i])) i++;
      else return;
    }
  }

  // Avance jusqu'au premier caractère de `stops` rencontré au niveau zéro.
  function jusqua(stops) {
    const debut = i;
    let paren = 0;
    while (i < n) {
      const c = css[i];
      if (css.startsWith('/*', i)) { const f = css.indexOf('*/', i + 2); i = f < 0 ? n : f + 2; continue; }
      if (c === '"' || c === "'") {
        const q = c; i++;
        while (i < n && css[i] !== q) i += css[i] === '\\' ? 2 : 1;
        i++; continue;
      }
      if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (paren === 0 && stops.includes(c)) break;
      i++;
    }
    return css.slice(debut, i);
  }

  function corps() {
    // On entre juste après '{' ; on sort juste après le '}' correspondant.
    const noeuds = [];
    for (;;) {
      sauterInsignifiant();
      if (i >= n) return noeuds;
      if (css[i] === '}') { i++; return noeuds; }
      const tete = jusqua('{};').trim();
      if (i >= n) return noeuds;
      const c = css[i];
      if (c === '{') {
        i++;
        noeuds.push({ type: 'bloc', tete, enfants: corps() });
      } else {
        i++;                                        // ';' ou '}'
        if (tete) noeuds.push({ type: 'decl', texte: tete });
        if (c === '}') return noeuds;
      }
    }
  }

  const racine = [];
  for (;;) {
    sauterInsignifiant();
    if (i >= n) return racine;
    const tete = jusqua('{};').trim();
    if (i >= n) { if (tete) racine.push({ type: 'decl', texte: tete }); return racine; }
    if (css[i] === '{') { i++; racine.push({ type: 'bloc', tete, enfants: corps() }); }
    else { i++; if (tete) racine.push({ type: 'decl', texte: tete }); }
  }
}

// ── La feuille de surcharge ─────────────────────────────────────────────────

const inconnues = new Set();

function teindreDecl(texte, { tout }) {
  const coupe = texte.indexOf(':');
  if (coupe < 0) return null;
  const prop = texte.slice(0, coupe);
  const valeur = texte.slice(coupe + 1);
  // Une déclaration sans couleur n'entre normalement pas dans la surcharge —
  // sauf si son dessin a une variante de nuit : c'est alors elle, et elle
  // seule, qui a quelque chose à dire.
  if (aUneVariante(valeur)) {
    return `${prop.trim()}:${poserVariantes(aUneCouleur(valeur)
      ? teindreValeur(valeur, roleDe(prop)) : valeur)}`;
  }
  if (!aUneCouleur(valeur)) return tout ? `${prop.trim()}:${valeur}` : null;
  // Un nom de couleur en valeur nous échapperait : il n'y en a aucun dans les
  // trois feuilles, mais si l'on en ajoutait un jour, autant le savoir.
  const nom = /(?:^|[\s,(])(white|black|red|green|blue|yellow|orange|purple|pink|gr[ae]y|gold|silver|brown|coral|crimson|tomato|salmon|ivory|beige|olive|navy|teal|lime|aqua|fuchsia|maroon)(?=[\s,)!;]|$)/i.exec(valeur);
  if (nom) inconnues.add(prop.trim() + ': ' + nom[1]);
  // Une ombre se lit couche par couche : certaines sont des liserés.
  if (/shadow$/.test(prop.trim().toLowerCase())) {
    return `${prop.trim()}:${teindreOmbre(valeur)}`;
  }
  return `${prop.trim()}:${teindreValeur(valeur, roleDe(prop))}`;
}

// Une règle @keyframes se REMPLACE en entier : une copie partielle effacerait
// les propriétés non colorées de l'animation d'origine. On la recopie donc
// complète, teinte comprise.
const estKeyframes = (tete) => /^@(-\w+-)?keyframes\b/i.test(tete);
// @font-face ne porte aucune couleur, et @import/@charset n'ont rien à faire
// dans une surcharge.
const aIgnorer = (tete) => /^@(font-face|import|charset|namespace)\b/i.test(tete);

// LES SPRITES D'ÉPOQUE POSÉS EN FOND. Les boutons de fenêtre, les onglets,
// le lecteur Frusion, le frutimandala : quatre-vingt-neuf règles habillent un
// élément d'un dessin par `background-image: url(…)`. Ce ne sont pas des
// <img> — la règle qui fane les images ne les atteint donc pas, et ils
// resteraient éclatants au milieu d'un bureau éteint. On leur ajoute le
// fanage ici, à la source : une règle de plus dans le générateur les prend
// tous, aujourd'hui comme le jour où l'on en ajoutera un.
//
// Et SEULEMENT eux : un sprite posé en fond est presque toujours une SURFACE
// — le cadre d'une fenêtre, l'onglet, l'écran de la main bar, le boîtier du
// Frusion —, pas une illustration. Les dessins, eux (les fruits du bureau,
// les émotions, la roue du frutimandala) arrivent par un <img> ou par le
// JavaScript, et gardent leurs couleurs : c'est ce qui fait la différence
// entre un parc éteint et un parc de nuit.
// `background` couvre l'essentiel, mais pas tout : la boîte de la liste des
// connectés est un `border-image` (une bordure de neuf tranches), et deux
// pseudo-éléments posent leur dessin par `content`. Trois familles, un seul
// motif — le nom de la propriété, encore.
const RE_FOND_IMAGE = /^\s*(background[a-z-]*|border-image[a-z-]*|content)\s*:[\s\S]*url\(/i;
const RE_FILTRE = /^\s*filter\s*:/i;
function porteUnSprite(enfants) {
  let image = false;
  for (const nd of enfants) {
    if (nd.type !== 'decl') continue;
    if (RE_FILTRE.test(nd.texte)) return false;   // la règle gère déjà son filtre
    if (!RE_FOND_IMAGE.test(nd.texte)) continue;
    // Un dessin qui a sa variante de nuit n'a pas à être fané : il EST déjà
    // de nuit. C'est le seul intérêt du chantier de redessin.
    if (aUneVariante(nd.texte.slice(nd.texte.indexOf(':') + 1))) continue;
    image = true;
  }
  return image;
}

function rendre(noeuds, indent, tout) {
  const out = [];
  for (const nd of noeuds) {
    if (nd.type === 'decl') {
      const d = teindreDecl(nd.texte, { tout });
      if (d) out.push(indent + d + ';');
      continue;
    }
    if (aIgnorer(nd.tete)) continue;
    const k = estKeyframes(nd.tete);
    const dedans = rendre(nd.enfants, indent + '  ', tout || k);
    const sprite = !k && !tout && !nd.tete.startsWith('@') && porteUnSprite(nd.enfants);
    if (sprite) dedans.push(indent + '  filter: var(--nuit-chassis);');
    if (!dedans.length) continue;
    out.push(indent + nd.tete + ' {', ...dedans, indent + '}');
  }
  return out;
}

function surcharge(css) {
  return rendre(decouper(css), '', false).join('\n');
}

// ── Les sources ─────────────────────────────────────────────────────────────

function styleDe(fichier) {
  const html = fs.readFileSync(fichier, 'utf8');
  const morceaux = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html))) morceaux.push(m[1]);
  if (!morceaux.length) throw new Error('aucun <style> dans ' + fichier);
  return morceaux.join('\n');
}

const ENTETE = (sources) => `/* ENGENDRÉ — NE PAS MODIFIER À LA MAIN.
 *
 * La feuille du mode nuit. Produite par scripts/generer-nuit.js à partir de :
${sources.map((s) => ' *   · ' + s).join('\n')}
 *
 * Toute retouche du thème de jour demande de relancer :
 *   node scripts/generer-nuit.js
 * (test/modeNuit.test.js échoue si l'on oublie.)
 *
 * Les corrections à la main, elles, vivent dans scripts/nuit-retouches*.css
 * et sont recopiées à la fin de ce fichier — donc elles gagnent.
 */
`;

const CIBLES = [
  {
    sortie: 'public/nuit.css',
    sources: ['public/light.html (son <style>)', 'public/bureau-frutiz.css'],
    lire: () => [styleDe(P('public/light.html')), fs.readFileSync(P('public/bureau-frutiz.css'), 'utf8')],
    retouches: 'scripts/nuit-retouches.css',
    // Les documents ENTIERS — HTML et JavaScript compris. Ils ne servent pas
    // à la conversion (qui ne lit que le CSS) mais à savoir quels dessins ce
    // client-là emploie : sans ce filtre, la feuille du forum embarquerait
    // les règles de tous les sprites du bureau, qu'il n'affiche jamais.
    emploie: () => [P('public/light.html'), P('public/bureau-frutiz.css'), P('public/bureau-frutiz.js')],
  },
  {
    sortie: 'public/fb/nuit.css',
    sources: ['public/fb/index.html (son <style>)'],
    lire: () => [styleDe(P('public/fb/index.html'))],
    retouches: 'scripts/nuit-retouches-forum.css',
    emploie: () => [P('public/fb/index.html')],
  },
];

/*
 * LES VARIANTES QUE LE CSS SEUL N'ATTEINT PAS.
 *
 * Le CSS de la feuille de jour ne mentionne qu'une partie des dessins : le
 * reste arrive par un `<img src>` du HTML ou par un `style.backgroundImage`
 * posé depuis le JavaScript. Deux sélecteurs d'attribut suffisent à les
 * rattraper, sans toucher au HTML ni au JS :
 *
 *   img[src$="…"]        `content: url()` remplace l'image rendue ;
 *   [style*="…"]         `background-image` la remplace dans l'attribut.
 *
 * `$=` et non `=` : le JavaScript construit ses URL par concaténation, avec
 * ou sans origine, et l'on ne veut pas dépendre de la forme exacte.
 */
function blocVariantes(cible) {
  const textes = (cible.emploie ? cible.emploie() : []).map((f) => {
    try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  // On filtre sur le DOSSIER, pas sur le chemin complet : le JavaScript
  // fabrique la plupart de ses URL par concaténation (`'/frutiz/sprites/' +
  // conf.fichier + '.svg'`), et un filtre exact laisserait donc tomber
  // justement les dessins qu'il pose — la roue du frutimandala la première.
  const dossier = (u) => u.slice(0, u.lastIndexOf('/') + 1);
  const utiles = [...VARIANTES].filter(([jour]) => !textes || textes.includes(dossier(jour)));
  if (!utiles.length) return '';
  const lignes = ['', '/* ── Les dessins de nuit déposés à côté des dessins de jour ───────── */',
    '/* Ils remplacent l’original et échappent au fanage : ils n’ont plus rien */',
    '/* à cacher. Déposer « nom-nuit.svg » à côté de « nom.svg » suffit.      */'];
  for (const [jour, nuit] of utiles.sort()) {
    lignes.push(
      `img[src$="${jour}"] { content: url("${nuit}"); filter: none; }`,
      `[style*="${jour}"] { background-image: url("${nuit}") !important; filter: none !important; }`);
  }
  return lignes.join('\n') + '\n';
}

function fabriquer(cible) {
  VARIANTES = variantesNuit();
  const corps = cible.lire().map(surcharge).join('\n\n');
  const main = fs.existsSync(P(cible.retouches)) ? fs.readFileSync(P(cible.retouches), 'utf8') : '';
  return ENTETE(cible.sources) + '\n' + corps + '\n' + blocVariantes(cible) + '\n'
    + '/* ── À la main, à partir d\'ici ────────────────────────────────────── */\n'
    + main.replace(/\s*$/, '') + '\n';
}

function main() {
  const verifier = process.argv.includes('--verifier');
  let perime = 0;
  for (const cible of CIBLES) {
    const texte = fabriquer(cible);
    const chemin = P(cible.sortie);
    const ancien = fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null;
    if (verifier) {
      if (ancien !== texte) { console.error('PÉRIMÉ : ' + cible.sortie); perime++; }
      continue;
    }
    fs.writeFileSync(chemin, texte);
    const lignes = texte.split('\n').length;
    console.log(cible.sortie.padEnd(20) + String(lignes).padStart(6) + ' lignes, '
      + (Buffer.byteLength(texte) / 1024).toFixed(1) + ' Ko'
      + (ancien === texte ? '  (inchangé)' : ''));
  }
  if (inconnues.size) {
    console.log('\nCouleurs NOMMÉES rencontrées (non converties) :');
    for (const x of inconnues) console.log('  ' + x);
  }
  if (verifier) {
    if (perime) {
      console.error('\nRelancer : node scripts/generer-nuit.js');
      process.exit(1);
    }
    console.log('Les feuilles de nuit sont à jour.');
  }
}

if (require.main === module) main();

module.exports = {
  convertir, teindreValeur, roleDe, surcharge, fabriquer, CIBLES,
  estRose, estChassis, estParchemin, rgbVersHsl, hexVersRgb, variantesNuit,
  VIOLET, ROSE_NUIT,
};
