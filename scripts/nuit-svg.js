#!/usr/bin/env node
/*
 * LES DESSINS DE CHÂSSIS, REPEINTS POUR LA NUIT.
 *
 * Le mode nuit garde les dessins d'époque en couleur — ce sont eux qui font
 * le parc — et n'éteint que le CHÂSSIS : les cadres de fenêtre, les onglets,
 * l'écran de l'aquarium, la boîte de la liste des connectés. Un filtre CSS
 * suffisait à les assombrir, mais mal : il ternit tout de la même main, il
 * écrase les reliefs, et il ne sait pas qu'un liseré doit rester un liseré.
 *
 * Ces dessins-là sont des SVG. Leurs couleurs sont donc lisibles, et l'on
 * peut leur appliquer la conversion du thème — la vraie, celle qui décide
 * par famille : le vert et les gris au violet, le rose gardé comme accent,
 * les autres teintes laissées tranquilles. Le résultat est un vrai dessin de
 * nuit, `nom-nuit.svg`, que la convention du mode nuit sert à la place de
 * l'original en lui retirant tout filtre (cf. scripts/generer-nuit.js).
 *
 * DEUX RÈGLES, ET ELLES EXPLIQUENT LE MANIFESTE CI-DESSOUS.
 *
 *   · On ne traite QUE du châssis. Un fruit, une bouille, un picto n'ont
 *     rien à faire ici : le mode nuit les veut en couleur. La roue du
 *     frutimandala est le cas limite — ses fruits sont peints sur ses
 *     quartiers —, d'où sa portée réduite au premier groupe.
 *   · La courbe des sprites ne PLAFONNE pas (cf. COURBES.sprite dans
 *     generer-nuit.js). Un aplat CSS peut s'écraser sur le plafond sans rien
 *     perdre ; un dessin, non — une gélule sans bord et une roue sans
 *     quartiers, c'est ce que donnait la courbe des fonds.
 *
 *   node scripts/nuit-svg.js            écrit les variantes
 *   node scripts/nuit-svg.js --verifier n'écrit rien, sort 1 si périmé
 *
 * Le jour où l'un de ces dessins est repris À LA MAIN, il suffit d'écraser
 * le fichier produit et de retirer son entrée du manifeste.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { convertir, hexVersRgb, estRose, estChassis, rgbVersHsl } = require('./generer-nuit.js');

const RACINE = path.join(__dirname, '..');
const SPRITES = path.join(RACINE, 'public/frutiz/sprites');
// Les dessins d'époque ne sont pas tous rangés au même endroit : le châssis du
// bureau vit dans frutiz/sprites, les pièces de la main bar dans fb/.
const FB = path.join(RACINE, 'public/fb');
const dossierDe = (entree) => entree.dossier || SPRITES;

// Les états d'un bouton vont par trois : on ne les écrit pas trois fois.
const troisEtats = (base) => ['up', 'over', 'down'].map((e) => base + '_' + e + '.svg');

/*
 * LES DEUX NIVEAUX D'UN VOYANT, ÉNONCÉS PLUTÔT QUE CALCULÉS.
 *
 * Les six raccourcis de l'encart sont des VOYANTS : une icône au repos, une
 * seconde qui prend sa place quand il y a du neuf, et les deux alternent. Le
 * thème de jour signale en FONÇANT — vert clair (#a2eb56) au repos, vert
 * sombre (#2C4A0F) allumé, sur un panneau vert pâle. Sur un panneau de nuit
 * c'est l'inverse : on signale en s'éclairant.
 *
 * Aucune conversion couleur→couleur ne peut voir ça. Elle regarde une couleur
 * à la fois, et toutes les courbes du thème gardent la hiérarchie d'origine
 * (« ce qui était le plus clair reste le plus clair ») : le voyant allumé
 * serait ressorti plus SOMBRE que le voyant au repos, c'est-à-dire éteint.
 *
 * Ces dessins-là n'ont qu'une seule couleur : il n'y a pas de relief à
 * préserver, rien à convertir — juste une teinte à DONNER. Le thème dit donc
 * laquelle, et le manifeste dit laquelle pour qui.
 */
const TEINTES = {
  // Un pictogramme de l'encart, et le voyant au repos. Franchement violet —
  // pas un gris lavande — pour qu'on lise une couleur et non une absence.
  glyphe: 'hsl(256 34% 74%)',
  // Le même, ALLUMÉ : presque blanc, avec juste assez de violet pour rester
  // du parc. C'est le clignotement.
  voyant: 'hsl(256 60% 95%)',
};

/*
 * LE MANIFESTE — ce qui est du châssis, et rien d'autre.
 *
 * Ce qui n'y est PAS, volontairement :
 *   · `fruit_win*.svg` (les pastilles de titre de fenêtre), `ico_*`, les
 *     pictos, les feutres : des dessins, pas du châssis. Ils gardent leurs
 *     couleurs ;
 *   · `ecran-reflet.svg` : un reflet de verre, deux traits blancs. Repeint en
 *     violet sombre il disparaîtrait, et c'est justement lui qui fait qu'un
 *     écran éteint ressemble à du verre ;
 *   · `sl-presence-*.svg` : les pastilles de présence. Leur couleur est une
 *     INFORMATION (en ligne / absent / hors ligne), pas une décoration —
 *     les faire virer au violet, c'est effacer le signal. À traiter à part,
 *     et à la main.
 */
const MANIFESTE = [
  // ── L'aquarium ────────────────────────────────────────────────────────
  { f: 'ecran-fond.svg', note: 'l’écran de l’aquarium, et celui de Gaspard' },
  { f: 'encart-reflet.svg', note: 'le liseré de l’encart de la main bar' },

  // ── La liste des connectés ────────────────────────────────────────────
  { f: 'user-list-boite.svg', note: 'la boîte (posée en border-image)' },
  { f: 'user-slot.svg', note: 'la bande d’une personne' },
  { f: 'user-list-pilule.svg', note: 'la gélule rose, en haut et en bas' },

  // ── Le cadre des fenêtres et les onglets ──────────────────────────────
  // `blanc: 'teint'` : sur un onglet le blanc est la FACE, pas une marque —
  // une plaque de la largeur de l'onglet. La garder blanche laissait deux
  // onglets en plein jour en haut d'un bureau éteint.
  ...['onglet_barre', 'onglet_corps', 'onglet_couture', 'onglet_fond',
    'onglet_fondb', 'onglet_fondh', 'onglet_pied'].map((n) => ({ f: n + '.svg', blanc: 'teint' })),
  // Les trois boutons du bandeau de fenêtre — la croix, le trait, le point
  // d’interrogation — se distinguent PAR LEUR COULEUR, comme les commandes du
  // frutimandala : d’où `teintes: 'gardees'`. Le « ? » est vert, et le vert
  // est la couleur du parc de jour : la conversion le rangeait avec le
  // châssis et le passait au violet sombre — un point d’interrogation
  // invisible sur une barre sombre.
  ...troisEtats('butWinTop1').map((f) => ({ f, teintes: 'gardees' })),
  ...troisEtats('butWinTop2').map((f) => ({ f, teintes: 'gardees' })),
  ...troisEtats('butWinTop3').map((f) => ({ f, teintes: 'gardees' })),

  // ── Le lecteur Frusion ────────────────────────────────────────────────
  // Cinq couches empilées, du fond du boîtier à sa façade. Du blanc partout,
  // et c'est du BOÎTIER : d'où `blanc: 'teint'`. La façade porte en plus le
  // petit fruit — rouge, jaune, vert — qui est la seule couleur du lecteur :
  // `teintes: 'gardees'` le sauve du rangement avec la famille rose.
  ...['frusion-arriere', 'frusion-fondslot', 'frusion-milieu', 'frusion-slot']
    .map((n) => ({ f: n + '.svg', blanc: 'teint' })),
  { f: 'frusion-avant.svg', blanc: 'teint', teintes: 'gardees',
    note: 'la façade — le petit fruit garde ses couleurs' },
  // Les deux commandes : un anneau gris et un glyphe. L'anneau s'éteint, le
  // glyphe reste clair — c'est ce qui les rend lisibles sur le boîtier sombre.
  // `blanc: 'teint'` ici aussi : leurs blancs ne sont pas un glyphe mais un
  // REFLET — un dégradé blanc vers transparent posé sur la pastille. Discret
  // sur un gris clair, il devenait une grosse tache laiteuse sur le violet.
  ...troisEtats('frusionCasque').map((f) => ({ f, blanc: 'teint' })),
  ...troisEtats('frusionEject').map((f) => ({ f, blanc: 'teint' })),

  // ── Les quatre boutons du salon, et la languette CONTACTS ─────────────
  ...['chat-but-bouille', 'chat-but-penlist', 'chat-but-userlist', 'chat-but-warning']
    .map((n) => ({ f: n + '.svg' })),
  // La languette CONTACTS est un onglet couché : sa plaque est blanche, ses
  // lettres grises, son cerne noir. Même défaut que les onglets du haut —
  // blanc gardé, plaque en plein jour — et même remède. Le cerne noir devient
  // le liseré clair qui la détache du fond d'écran.
  ...troisEtats('butContact').map((f) => ({ f, blanc: 'teint' })),

  // ── Le frutimandala ───────────────────────────────────────────────────
  // La roue porte ses douze fruits SUR ses quartiers : seul le premier
  // groupe — les deux tracés des quartiers — est repeint. Tout ce qui suit
  // est fruits et décorations, et n'est pas touché d'un pixel.
  { f: 'frutimandala-roue.svg', portee: 'premierGroupe',
    note: 'les quartiers seulement — les fruits gardent leurs couleurs' },
  { f: 'frutimandala-dessus.svg', note: 'le cadran par-dessus' },
  // Les quatre commandes du cadran — deux triangles rouges, le swap jaune, le
  // valider vert. Ce sont des COULEURS DE COMMANDE, pas du décor : on n'y
  // touche pas, on éteint seulement le socle gris sur lequel elles sont
  // posées. Le filtre du châssis les avait toutes passées au gris violet, et
  // trois boutons de trois couleurs devenaient trois boutons identiques.
  ...['mandalaGauche', 'mandalaDroite', 'mandalaSwap', 'mandalaValider']
    .flatMap((n) => troisEtats(n)).map((f) => ({ f, teintes: 'gardees' })),

  // ── L'ENCART DE LA MAIN BAR (public/fb) ───────────────────────────────
  //
  // Le fond de la bouille est le MÊME DESSIN que l'écran de l'aquarium —
  // mêmes trois verts, même dégradé — et il passe donc par la même
  // conversion : les deux ressortent identiques sans qu'on ait à le dire.
  { f: 'cadre_bouille.svg', dossier: FB,
    note: 'le fond de la bouille — la teinte de l’aquarium, par construction' },

  // Les six raccourcis et la coupe : des GLYPHES d'une seule couleur, posés
  // sur le panneau de l'encart. Ils prennent tous la même teinte — c'est ce
  // qui fait une rangée et non un assortiment (la coupe était d'un vert plus
  // sombre que les icônes, elle rejoint la rangée).
  ...['Mail', 'Warning', 'Historique', 'Aide', 'Forum', 'Jeux', 'trophee']
    .map((n) => ({ f: n + '.svg', dossier: FB, teinte: 'glyphe' })),
  // Leurs VOYANTS : la même icône, allumée. Presque blanche — voir TEINTES.
  ...['MailRecu', 'WarningAlerte', 'HistoriqueAlerte', 'ForumAlerte']
    .map((n) => ({ f: n + '.svg', dossier: FB, teinte: 'voyant' })),

  // « NIV » est un DESSIN, le numéro qui le suit est du TEXTE — et les deux se
  // lisent d'un seul tenant (« NIV 14 »). Le dessin passe donc par le rôle
  // `texte`, sur la même couleur d'origine (#73b01e) : la conversion leur
  // donne alors, par construction, exactement la même teinte de nuit.
  { f: 'Niveau.svg', dossier: FB, role: 'texte',
    note: 'accordé au numéro de niveau, qui est du texte' },
];

// ── La reteinte ─────────────────────────────────────────────────────────────

// Les attributs d'un SVG qui portent une couleur. `stroke` comme `fill` : dans
// un dessin, un trait fait partie du dessin — le traiter en « bordure » CSS le
// remonterait à mi-clarté et le liseré deviendrait un trait lumineux.
const RE_COULEUR = /(fill|stroke|stop-color|flood-color|lighting-color)="(#[0-9a-fA-F]{3,8})"/g;

/*
 * LE BLANC PUR RESTE BLANC — quand c'est le SYMBOLE, pas la surface.
 *
 * Les quatre boutons du salon sont bâtis pareil : un corps rose, une face
 * intérieure plus claire, et par-dessus le GLYPHE en blanc — la tête de mort,
 * les barres, le triangle. Passé à la moulinette du châssis (le blanc est un
 * gris, donc du châssis), le glyphe virait au violet presque noir : on avait
 * des boutons roses aveugles. Même chose pour les liserés blancs qui font
 * briller une gélule, une boîte ou le verre du frutimandala.
 *
 * C'est le cas COURANT — dans ces dessins-là un blanc pur est presque toujours
 * une marque posée par-dessus —, donc le défaut. Mais pas toujours : sur un
 * onglet ou sur le boîtier du Frusion, le blanc est la FACE ÉCLAIRÉE, une
 * grande surface. La garder blanche laissait des onglets en plein jour au
 * milieu d'un bureau éteint. Ces dessins-là portent `blanc: 'teint'`.
 *
 * On ne devine pas lequel des deux : le fichier ne le dit pas, seul l'œil le
 * dit. C'est donc écrit dans le manifeste, dessin par dessin.
 */
const estBlancPur = (hex) => /^#(fff|ffffff)$/i.test(hex);

// En dessous, une couleur n'en est plus une : c'est un gris. Le seuil est
// celui du thème (cf. estChassis dans generer-nuit.js), pour que « neutre »
// veuille dire la même chose des deux côtés.
const NEUTRE_MAX = 15;

function reteindre(fragment, compteur, entree) {
  const blancTeint = entree && entree.blanc === 'teint';
  const teintesGardees = entree && entree.teintes === 'gardees';
  const imposee = entree && TEINTES[entree.teinte];
  const role = (entree && entree.role) || 'sprite';
  return fragment.replace(RE_COULEUR, (tout, attr, hex) => {
    // Teinte IMPOSÉE : le dessin est un glyphe d'une seule couleur, le thème
    // dit laquelle. Le blanc reste blanc — c'est encore une marque.
    if (imposee) {
      if (estBlancPur(hex)) { compteur.gardes++; return tout; }
      compteur.reteints++;
      return attr + '="' + imposee + '"';
    }
    if (estBlancPur(hex) && !blancTeint) { compteur.gardes++; return tout; }
    const [r, g, b, a] = hexVersRgb(hex);
    const [h, s] = rgbVersHsl(r, g, b);
    // Un ACCENT n'est pas du châssis : on le laisse. C'est ce qui permet de
    // passer un dessin entier sans y perdre ses couleurs propres.
    if (!estRose(h, s) && !estChassis(h, s)) { compteur.gardes++; return tout; }
    // `teintes: 'gardees'` : seuls les NEUTRES s'éteignent, toute couleur
    // garde la sienne. Les deux règles du thème gênent ici, chacune à sa
    // façon — le rouge est rangé avec les roses et poussé sur l'accent (les
    // triangles du frutimandala viraient au magenta), et le VERT est tenu
    // pour du châssis, parce que c'est la couleur du parc de jour (le bouton
    // « valider » virait au violet, et trois boutons de trois couleurs
    // devenaient trois boutons identiques). Ces dessins-là ne demandent
    // qu'une chose : que leur SOCLE gris s'éteigne.
    if (teintesGardees && s >= NEUTRE_MAX) { compteur.gardes++; return tout; }
    compteur.reteints++;
    return attr + '="' + convertir(r, g, b, a, role) + '"';
  });
}

const ENTETE = (nom, note, intact) => `<!--
  ENGENDRÉ par scripts/nuit-svg.js — ${nom} en mode nuit.
  ${intact
    ? `Ce dessin n'a AUCUNE couleur de châssis : il est déjà de nuit tel quel,
  et cette copie n'est là que pour le dire. Sans elle, la feuille de nuit le
  prendrait pour un dessin de jour oublié et lui poserait le filtre du
  châssis — un bouton de couleur passé au gris violet.`
    : `Le même dessin, ses couleurs de châssis repassées par la conversion du
  thème (vert et gris au violet, rose gardé en accent, le reste intact).`}
  ${note ? note + '\n  ' : ''}Pour le reprendre à la main : écraser ce fichier et retirer son entrée du
  manifeste de scripts/nuit-svg.js.
-->
`;

function fabriquer(entree) {
  const src = fs.readFileSync(path.join(dossierDe(entree), entree.f), 'utf8');
  const compteur = { reteints: 0, gardes: 0 };
  let sortie;
  if (entree.portee === 'premierGroupe') {
    const debut = src.indexOf('<g ');
    const fin = src.indexOf('</g>', debut);
    if (debut < 0 || fin < 0) throw new Error('pas de premier groupe dans ' + entree.f);
    sortie = src.slice(0, debut) + reteindre(src.slice(debut, fin), compteur, entree) + src.slice(fin);
  } else {
    sortie = reteindre(src, compteur, entree);
  }
  /*
   * UN DESSIN PEUT N'ÊTRE QUE DE LA COULEUR — les trois boutons du bandeau de
   * fenêtre sont une croix, un trait et un point d'interrogation, sans un gris
   * autour. On écrit sa variante QUAND MÊME, à l'identique.
   *
   * Ce n'est pas un fichier pour rien. La feuille de nuit fane tout sprite qui
   * n'a pas de variante (cf. porteUnSprite dans generer-nuit.js) : ne rien
   * écrire, c'était laisser le filtre du châssis passer ces boutons au gris
   * violet — précisément ce qu'on veut leur éviter. La variante est ce qui
   * dit « celui-là est réglé, n'y touche pas ».
   */
  const texte = sortie.replace(/(<svg[^>]*>\n?)/,
    '$1' + ENTETE(entree.f, entree.note, !compteur.reteints));
  return { texte, compteur, intact: !compteur.reteints };
}

const cible = (entree) =>
  path.join(dossierDe(entree), entree.f.replace(/\.svg$/, '-nuit.svg'));

function main() {
  const verifier = process.argv.includes('--verifier');
  let perimes = 0, ecrits = 0, gardes = 0, reteints = 0, intacts = [];
  const vus = new Set();
  for (const entree of MANIFESTE) {
    if (vus.has(entree.f)) continue;          // le manifeste se lit, il ne se compte pas
    vus.add(entree.f);
    const { texte, compteur, intact } = fabriquer(entree);
    const chemin = cible(entree);
    const ancien = fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null;
    reteints += compteur.reteints; gardes += compteur.gardes;
    if (intact) intacts.push(entree.f);
    if (verifier) {
      if (ancien !== texte) { console.error('PÉRIMÉ : ' + path.basename(chemin)); perimes++; }
      continue;
    }
    if (ancien !== texte) { fs.writeFileSync(chemin, texte); ecrits++; }
  }
  if (verifier) {
    if (perimes) {
      console.error('\nRelancer : node scripts/nuit-svg.js');
      process.exit(1);
    }
    console.log('Les dessins de nuit sont à jour (' + vus.size + ' variantes).');
    return;
  }
  console.log(vus.size + ' variante(s), ' + ecrits + ' réécrite(s) — '
    + reteints + ' couleur(s) repeinte(s), ' + gardes + ' laissée(s) telles quelles.');
  if (intacts.length) {
    console.log('Copiés à l’identique (que de la couleur, rien de châssis) : ' + intacts.join(', '));
  }
}

if (require.main === module) main();

module.exports = { MANIFESTE, fabriquer, cible, SPRITES, FB, TEINTES };
