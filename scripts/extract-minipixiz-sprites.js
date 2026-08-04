#!/usr/bin/env node
// Sort les dessins de Minipixiz (miniTroll) du SWF, pour le portage natif.
//
//   node scripts/extract-minipixiz-sprites.js            → écrit public/minipixiz/sprites/
//   node scripts/extract-minipixiz-sprites.js --liste    → montre ce qui serait extrait
//
// ── Quel SWF ──
//
// Games/miniTroll/minipixiz.swf est OBFUSQUÉ : ses noms de symboles sont du
// bruit (« ;dO4) », « [Ryaj »…), on n'y retrouve rien. Games/miniTroll/swf/root.swf
// est le même jeu avant obfuscation, avec ses vrais noms — token, stone,
// impCell, bomb, elItem. C'est celui-là qu'on lit.
//
// ── Le jeton, et pourquoi il demande un traitement à part ──
//
// Un jeton n'est pas une image mais DEUX clips superposés, que Group.draw envoie
// tous les deux sur la même image :
//
//     e.skin.gotoAndStop(frame)              // le contour, qui dit à quels
//                                            // voisins le jeton est relié
//     e.skin.skin.gotoAndStop(frame)         // le corps, dont la forme suit
//
// L'image va de 1 à 16 : un bit par côté relié (haut 1, droite 2, bas 4, gauche
// 8). C'est ce qui fait que quatre jetons d'une même couleur se fondent en une
// seule tache au lieu de rester quatre carrés — toute la lisibilité du jeu tient
// là-dedans. L'image 20 est à part : c'est l'armure.
//
// Aplatir naïvement le clip donnerait seize contours corrects et seize fois le
// MÊME corps (la première image du clip imbriqué). D'où le paramètre `frame`
// d'aplatir(), qui synchronise l'enfant sur l'image du parent.
//
// ── La couleur ──
//
// Les dessins sont en niveaux de gris : le jeu teinte à l'exécution
// (Mc.setColor(mc, Cs.colorList[type])). On garde le principe — un seul jeu de
// dessins pour les huit couleurs.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');
const { lireMorphs, versSvg } = require('./lib/swf-morph.js');

const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'public/minipixiz/sprites');

// Le jeu se joue à DEUX fichiers. root.swf porte le décor, l'interface et les
// personnages ; gfx.swf porte les objets — itemCarac, itemFood, itemPotion, la
// bille des sorts… — que le jeu charge à part. Chercher les objets dans root.swf
// ne donnait rien, et c'est pour ça qu'on s'était rabattu sur les GIF de
// l'album : les vrais dessins étaient simplement dans l'autre fichier.
const SOURCES = {
  root: path.join(RACINE, 'Games/miniTroll/swf/root.swf'),
  gfx: path.join(RACINE, 'Games/miniTroll/swf/gfx.swf'),
};
const swfs = {};
for (const [cle, chemin] of Object.entries(SOURCES)) swfs[cle] = ouvrir(chemin);
// Les préfixes de fichier, pour que deux formes portant le même identifiant
// dans les deux SWF ne s'écrasent pas.
const PREFIXE = { root: '', gfx: 'g' };

// Ce qu'on va chercher. `synchro` demande que les clips imbriqués suivent
// l'image du parent — voir l'en-tête.
// `images` limite ce qu'on garde : les clips continuent souvent bien au-delà de
// ce que le jeu utilise, et tout ce qui suit n'est que du remplissage de
// scénario qui alourdirait le manifeste et le chargement.
const CIBLES = [
  // Le jeton : seize images de liaison (1 à 16) plus l'armure (20). L'image
  // porte les côtés reliés — haut 1, droite 2, bas 4, gauche 8, plus un. Le
  // contour n'est posé que sur les images SANS voisin du dessus : c'est le
  // rebord supérieur de la tache, et il n'a pas lieu d'être ailleurs.
  { cle: 'token', symbole: 'token', etiquette: 'Jeton', synchro: true,
    images: [...Array(16)].map((_, i) => i + 1).concat([20]) },
  { cle: 'stone', symbole: 'stone', etiquette: 'Pierre' },
  { cle: 'impCell', symbole: 'impCell', etiquette: 'Cellule d\'impy' },
  { cle: 'bomb', symbole: 'bomb', etiquette: 'Bombe' },
  { cle: 'elItem', symbole: 'elItem', etiquette: 'Objet' },
  { cle: 'star', symbole: 'mcTokenStar', etiquette: 'Étoile' },
  { cle: 'marble', symbole: 'mcBlackMarble', etiquette: 'Perle noire' },
  { cle: 'imp', symbole: 'imp', etiquette: 'Impy' },
  // L'œil : la boule teintée (`col`) et sa pupille (`center`), que le jeu fait
  // grossir à mesure que l'œil se charge (Eye.updateLight : 20 + light×40 %).
  { cle: 'eye', symbole: 'eye', etiquette: 'Œil' },

  // ── Le cadre du jeu ──
  // interfaceRacine porte les trois morceaux du cadre de la forêt : les racines
  // du haut (image 1), le montant du milieu (2) et le sol (3). base/Forest les
  // attache tels quels, sur trois profondeurs.
  { cle: 'cadre', symbole: 'interfaceRacine', etiquette: 'Cadre de la forêt' },
  // Les autres lieux ont chacun leur cadre, bâti sur le même principe : trois
  // images pour trois profondeurs. Celui du bassin porte en plus un fond dont
  // l'image dit l'heure qu'il est (`sub.bg.gotoAndStop(nuit×100 + 1)`).
  { cle: 'cadreBassin', symbole: 'interfaceFountain', etiquette: 'Cadre du bassin' },
  { cle: 'cadreDonjon', symbole: 'interfaceDungeon', etiquette: 'Cadre du donjon' },
  { cle: 'cadreArbre', symbole: 'interfaceTree', etiquette: 'Cadre de l\'arbre creux' },
  { cle: 'cadreArcEnCiel', symbole: 'interfaceRainbow', etiquette: 'Cadre de l\'arc-en-ciel' },
  { cle: 'fireball', symbole: 'fireball', etiquette: 'Boule de feu' },

  // ── Le décor ──
  // Dix plans, du ciel au premier plan, chacun avec son coefficient de
  // parallaxe (Menu.initDecor). Le ciel a son extraction à part — voir
  // extraireCiel : ce n'est pas une forme mais deux MORPHS.
  { cle: 'horizon', symbole: 'decorPlanHorizon', etiquette: 'Horizon', exclure: ['rainbow'] },
  { cle: 'collines', symbole: 'decorPlanHill', etiquette: 'Collines', exclure: ['windMill', 'dungeon'] },
  { cle: 'foret3', symbole: 'decorPlanForest3', etiquette: 'Forêt lointaine' },
  { cle: 'foret2', symbole: 'decorPlanForest2', etiquette: 'Forêt moyenne' },
  { cle: 'foret', symbole: 'decorPlanForest', etiquette: 'Forêt',
    exclure: ['fountain', 'forest', 'house'] },
  { cle: 'milieu', symbole: 'decorPlanMid', etiquette: 'Plan médian', exclure: ['tree'] },
  { cle: 'arbre', symbole: 'decorPlanTree', etiquette: 'Arbre', exclure: ['bag'] },
  { cle: 'herbe', symbole: 'decorPlanHerb', etiquette: 'Herbe' },
  { cle: 'premier', symbole: 'decorPlanFirst', etiquette: 'Premier plan', exclure: ['frog'] },
  { cle: 'nuage', symbole: 'cloud', etiquette: 'Nuage' },

  // ── Les lieux du menu ──
  // Chacun est un clip que le jeu pilote : le donjon change de forme selon son
  // niveau, l'arbre grandit avec $treeMax, le sac montre celui qu'on porte, le
  // bassin s'allume quand une fée y dort. Ils ne sont pas exportés sous un nom :
  // on les prend par leur identifiant, celui que le plan leur donne.
  { cle: 'mArcEnCiel', id: 379, etiquette: 'Arc-en-ciel' },
  { cle: 'mMoulin', id: 337, etiquette: 'Moulin' },
  { cle: 'mDonjon', id: 394, etiquette: 'Donjon' },
  { cle: 'mBassin', id: 424, etiquette: 'Bassin aux fées' },
  { cle: 'mForet', id: 427, etiquette: 'Forêt enchantée' },
  { cle: 'mCabane', id: 430, etiquette: 'Cabane de Gromelin' },
  { cle: 'mArbre', id: 443, etiquette: 'Arbre creux' },
  { cle: 'mSac', id: 454, etiquette: 'Sac' },
  { cle: 'mGrenouille', id: 464, etiquette: 'Ornegon' },

  // ── La fée et son interface ──
  // faerie porte toutes ses animations, picFace ses portraits. On ne garde pas
  // les soixante-et-onze images du clip : le jeu n'en joue qu'une poignée, et
  // le reste alourdirait le chargement pour rien.
  { cle: 'fee', symbole: 'faerie', etiquette: 'Fée', synchro: true,
    images: [...Array(24)].map((_, i) => i + 1) },
  // picFace ne garde que ses DIX premières images. Au-delà, les dix-neuf
  // suivantes ne sont qu'une seule et même photo de Jane Fonda en Barbarella —
  // une blague d'atelier laissée dans le fichier. Cm.genFaerieSeed tire de toute
  // façon `$skin[0] = Std.random(6)`, donc six visages ; les quatre autres
  // restent au cas où une fée de mission en demanderait un.
  { cle: 'portrait', symbole: 'picFace', etiquette: 'Portrait de fée', synchro: true,
    images: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  // inter.Life et inter.Mana ne sont que des boîtes vides : ce qu'on voit, ce
  // sont des cœurs posés tous les 14 px et des gouttes tous les 6, chacun à
  // deux images — vide, plein.
  //
  // Mais le cadre du portrait, le cœur et la goutte ont chacun un sous-clip de
  // PEAU, que le lieu choisit : la forêt garde la première, le donjon prend la
  // deuxième (`intLife.skinFrame = 2`), l'arc-en-ciel la troisième. Sans cette
  // distinction, le cœur PLEIN portait le fond de pierre du donjon jusqu'en
  // forêt — le sous-clip suivait l'image du parent au lieu de la peau.
  ...[1, 2, 3].flatMap((peau) => {
    const suf = peau > 1 ? String(peau) : '';
    const dit = ['', '', ' (donjon)', ' (arc-en-ciel)'][peau];
    return [
      { cle: 'interFace' + suf, symbole: 'interFace', sousImage: peau,
        etiquette: 'Cadre du portrait' + dit },
      { cle: 'coeur' + suf, symbole: 'mcHeart', sousImage: peau,
        etiquette: 'Cœur de vie' + dit },
      { cle: 'mana' + suf, symbole: 'mcMana', sousImage: peau,
        etiquette: 'Goutte de mana' + dit },
    ];
  }),
  { cle: 'suivante', symbole: 'mcNext', etiquette: 'Pièce suivante' },
  { cle: 'nuit', symbole: 'mcNightMask', etiquette: 'Masque de nuit' },

  // ── L'arbre creux (base/Tree) ──
  // Son tableau de bord tient en trois clips : la plaque du score en (2,2),
  // l'escargot qui grimpe le long du tronc à mesure que le chronomètre tourne
  // — c'est LUI qui annonce la prochaine accélération —, et les fruits du
  // multiplicateur, qui pendent du haut au bout d'un élastique.
  { cle: 'panScore', symbole: 'panScore', etiquette: 'Plaque du score' },
  { cle: 'escargot', symbole: 'mcEscargot', etiquette: 'Escargot du chronomètre' },
  { cle: 'multiFruit', symbole: 'mcMultiFruit', etiquette: 'Fruit du multiplicateur' },

  // ── Le donjon (base/Dungeon.initElevator) ──
  // Le plancher qui monte, et les trois roues qui l'entraînent — devant et
  // derrière. C'est la seule chose qui dise au joueur que le sol se rapproche.
  // Les six roues sont SIX COPIES d'un même dessin, à six places et six
  // tailles : on ne sort donc que la roue, et le client la repose. Sortir les
  // deux assemblages tout faits aurait obligé à les redessiner en entier à
  // chaque image, puisqu'ils tournent.
  { cle: 'ascenseur', symbole: 'mcElevator', etiquette: 'Ascenseur du donjon' },
  { cle: 'roue', id: 818, etiquette: 'Roue du treuil' },

  // ── L'arc-en-ciel (inter.Wheel) ──
  // Une roue de 80 sur 80, douze flammes en couronne à quarante-deux pixels du
  // centre, et le LOT au milieu. Chaque flamme qui s'éteint est une pièce de
  // moins avant la récompense.
  { cle: 'roueLot', symbole: 'interWheel', etiquette: 'Roue de l\'arc-en-ciel' },
  { cle: 'flamme', symbole: 'mcFlame', etiquette: 'Flamme de la roue', images: [1] },

  // ── L'inventaire (Inventory.mt) ──
  // Un fond, un cadre par-dessus, des cases de 32 px, le panneau de la fée avec
  // son portrait et ses quatre volets — caractéristiques, sortilèges, sac,
  // santé —, le bandeau de message en bas et la poubelle.
  // Le grand panneau clair de l'écran est le dessin du CLIP D'ÉCRAN lui-même
  // (Slot.link = « inventory »), pas un décor attaché : invBg ne porte que les
  // lianes. Sans lui, tout l'inventaire flottait sur du noir.
  // ── La fin de partie et la carte de la forêt ──
  // Perdre, dans le jeu, ne pose pas de question : l'écran vire au noir, le
  // panneau « game over » s'affiche une centaine d'images, puis la clairière
  // revient d'elle-même (Base.gameOver → tryToClose).
  { cle: 'panPerdu', symbole: 'panGameOver', etiquette: 'Panneau de fin de partie' },
  // La PAUSE (Manager.setPause) : un voile violet, le panneau, et le mot.
  { cle: 'panPause', symbole: 'mcPause', etiquette: 'Panneau de pause' },
  // Chez ORNEGON (Frog.mt) : la grenouille demande à la fée ses sorts
  // préférés — une barre par sort appris, et un curseur qui écrit $spellCoef.
  // Le symbole est celui des sorts, déjà extrait ; le curseur est la forme du
  // bouton, que l'extracteur ne sait pas traverser.
  { cle: 'ecranOrnegon', symbole: 'frog', etiquette: 'Chez Ornegon' },
  // Chez GROMELIN (Mission.mt) : la porte fermée, la porte ouverte, le panneau
  // des missions, le panneau d'envoi. Les champs sont redessinés ; la case à
  // cocher d'une fée est son propre clip.
  { cle: 'ecranMission', symbole: 'mission', etiquette: 'Chez Gromelin',
    images: [1, 2, 3, 4] },
  { cle: 'caseMission', symbole: 'mcMissionFaerieSlot', etiquette: 'Fée à envoyer' },
  // Le bocal d'une fée EN MISSION (it/Flask.updatePic) : l'icône qui remplace
  // la locataire absente — posée à 360 % dans le dessin de l'objet.
  { cle: 'iconeMission', symbole: 'mcIconMission', etiquette: 'Fée en mission' },
  // Le COURRIER (Menu.initMsgIcon / displayLog) : l'enveloppe qui clignote au
  // bord droit de la clairière tant qu'un message n'est pas lu, et la lettre
  // qui s'ouvre au centre. Le parchemin est le clip `inside` ; le voile `out`
  // et les flèches `up`/`down` sont des BOUTONS, que l'extracteur ne traverse
  // pas — le voile est de toute façon invisible (état HitTest seul), et la
  // flèche sort par sa forme, comme le curseur d'Ornegon.
  { cle: 'iconeCourrier', symbole: 'mcMailIcone', etiquette: 'Enveloppe du courrier' },
  { cle: 'lettreCourrier', symbole: 'mcMail', etiquette: 'Lettre du courrier' },
  { cle: 'flecheCourrier', id: 1042, etiquette: 'Flèche du courrier' },
  // La rangée des objets à ranger (Inventory.setExtraList) : sa flèche de
  // défilement est un bouton, on sort la forme de son état haut.
  { cle: 'flecheExtra', id: 680, etiquette: 'Flèche des objets à ranger' },
  { cle: 'barreSort', symbole: 'mcSpellBar', etiquette: 'Barre de sort', exclure: ['symbole'] },
  { cle: 'curseurSort', id: 1173, etiquette: 'Curseur de sort' },
  // Le BOUQUET (Aventure.initBouquet) : chaque niveau s'ouvre sur cette gerbe
  // qui jaillit d'un point, porte le numéro du niveau, tient un instant et se
  // referme avant que les pièces ne tombent.
  { cle: 'bouquet', symbole: 'bouquet', etiquette: 'Bouquet d\'ouverture' },
  // Et l'entrée en forêt, quand on a des relais, est une CARTE (mcForestMap) :
  // une pancarte par relais (mcCheckpointPicture, une image chacune), qui
  // défile sous la souris, et le bouton pour repartir.
  // Les NOUVELLES (News.mt) : l'écran qui célèbre un relais gagné (image 1,
  // avec la photo du lieu) ou un record à l'arbre creux (image 2). Le texte est
  // un champ, redessiné par le client ; la photo est le clip `pic`, sorti à
  // part — le plan la pose à 130 %.
  { cle: 'nouvelle', symbole: 'news', etiquette: 'Écran de nouvelle',
    images: [1, 2], exclure: ['pic'] },
  { cle: 'nouvelleImage', id: 1012, etiquette: 'Photo de relais' },
  { cle: 'carteForet', symbole: 'mcForestMap', etiquette: 'Carte de la forêt' },
  { cle: 'relaisImage', symbole: 'mcCheckpointPicture', etiquette: 'Pancarte de relais',
    images: [1, 2, 3, 4, 5, 6, 7, 8] },
  { cle: 'boutonQuitter', symbole: 'mcButQuit', etiquette: 'Bouton de sortie' },

  { cle: 'invEcran', symbole: 'inventory', etiquette: 'Panneau de l\'inventaire' },
  { cle: 'invFond', symbole: 'invBg', etiquette: 'Fond de l\'inventaire' },
  { cle: 'invDevant', symbole: 'invFront', etiquette: 'Cadre de l\'inventaire' },
  { cle: 'invCase', symbole: 'invSlot', etiquette: 'Case' },
  // La rangée du bas — la clé, l'étoile, les cinq diamants (initExtraDisplay).
  // C'est UN clip à trois images, dont le sous-clip `sub` porte le contenu et
  // s'efface quand on n'a rien : on sort donc l'alvéole vide d'un côté et les
  // trois contenus de l'autre. Le diamant est le seul à avoir cinq images —
  // cinq teintes additives sur le même dessin, une par diamant trouvé.
  { cle: 'invPetiteCase', symbole: 'invSmallSlot', etiquette: 'Petite case', exclure: ['sub'] },
  { cle: 'invCle', id: 789, etiquette: 'Clé' },
  { cle: 'invEtoile', id: 1193, etiquette: 'Étoile' },
  { cle: 'invDiamant', id: 1186, etiquette: 'Diamant' },
  // Le panneau de la fée porte SON portrait — `Mc.setPic(facePanel.pic, fi.skin)`
  // envoie le clip sur l'image du visage tiré. On sort donc le panneau une fois
  // par visage, et le médaillon rond du fichier découpe chacun d'eux.
  // Ses deux boutons et sa pastille de niveau sortent à part : ils ont leur
  // propre image (le bouton de gauche montre le volet SUIVANT, celui de droite
  // toujours la sixième — « libérer la fée »), et les laisser dedans les aurait
  // fait défiler avec les visages.
  { cle: 'invPanneau', symbole: 'invFace', etiquette: 'Panneau de la fée',
    sousImage: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], exclure: ['swap', 'quit', 'level'] },
  { cle: 'invBouton', id: 615, etiquette: 'Bouton du panneau' },
  { cle: 'invNiveau', id: 619, etiquette: 'Pastille de niveau' },
  { cle: 'invBarre', symbole: 'invFaerieBar', etiquette: 'Barre de caractéristique' },
  { cle: 'invPoint', symbole: 'invFaerieBarPoint', etiquette: 'Point de caractéristique' },
  { cle: 'invMessage', symbole: 'msgPanel', etiquette: 'Bandeau de message' },
  { cle: 'invPoubelle', symbole: 'mcTrashcan', etiquette: 'Poubelle' },
  { cle: 'invSante', symbole: 'mcManPower', etiquette: 'Cadrans de faim et de moral' },

  // ── Les objets (gfx.swf) ──
  // Item.getPic choisit l'image par famille : itemCarac.gotoAndStop(type+1),
  // itemPotion(id+1), itemFood(id+1) avec sa part dans le sous-clip `sub`…
  { cle: 'itCarac', symbole: 'itemCarac', etiquette: 'Objet de caractéristique', swf: 'gfx', synchro: true },
  { cle: 'itPouvoir', symbole: 'itemSpecialPower', etiquette: 'Pouvoir spécial', swf: 'gfx', synchro: true },
  { cle: 'itGlobe', symbole: 'itemCaracAll', etiquette: 'Globe', swf: 'gfx', synchro: true },
  { cle: 'itColoration', symbole: 'itemColor', etiquette: 'Coloration', swf: 'gfx', synchro: true },
  { cle: 'itPotion', symbole: 'itemPotion', etiquette: 'Potion', swf: 'gfx', synchro: true },
  { cle: 'itParchemin', symbole: 'itemScroll', etiquette: 'Parchemin', swf: 'gfx', synchro: true },
  { cle: 'itGrimoire', symbole: 'itemSpellBook', etiquette: 'Grimoire', swf: 'gfx', synchro: true },
  // L'aliment se dessine à deux index : l'image du clip dit LEQUEL, celle du
  // sous-clip `sub` dit quelle PART il en reste. D'où trois extractions.
  { cle: 'itAliment1', symbole: 'itemFood', etiquette: 'Aliment (grande part)', swf: 'gfx', sousImage: 1 },
  { cle: 'itAliment2', symbole: 'itemFood', etiquette: 'Aliment (moyenne part)', swf: 'gfx', sousImage: 2 },
  { cle: 'itAliment3', symbole: 'itemFood', etiquette: 'Aliment (petite part)', swf: 'gfx', sousImage: 3 },
  { cle: 'itBocal', symbole: 'itemFlask', etiquette: 'Bocal', swf: 'gfx' },
  { cle: 'sortBille', symbole: 'spellBall', etiquette: 'Bille de sort', swf: 'gfx' },
  { cle: 'sortSymbole', symbole: 'spellSymbol', etiquette: 'Symboles des sorts', swf: 'gfx' },
].concat(effets());

/**
 * Les effets — tout ce que les sorts, les tirs et les combats font apparaître
 * au-dessus du plateau.
 *
 * `Game.newPart(link)` attache le clip qui porte ce nom et le pilote depuis
 * l'ActionScript : position, échelle, rotation, transparence. Le clip lui-même
 * n'est souvent qu'un dessin fixe — sa vie vient du code, pas du scénario. Ceux
 * qui S'ANIMENT sont ceux que le jeu lance par `gotoAndPlay` : l'éclaboussure,
 * l'explosion, la mort d'un impy. On garde pour eux toutes leurs images.
 *
 * Les noms sont ceux du fichier ; les traduire n'aiderait personne, puisque
 * c'est sous ce nom que le code d'origine les demande.
 */
function effets() {
  // Les clips que le jeu fait JOUER : on garde la séquence entière.
  const ANIMES = {
    partJet: 12, partMiniExplosion: 12, partDeadImp: 12, partPaint: 1,
    partLightStar: 9, partFlipGlow: 2, partBombEplosion: 12,
    partDynColorFlower: 12, partRoundBlink: 12, partSuperNova: 2,
    partQueueStandard: 12, partQueuePhantom: 8, partOnde: 4,
    partBlackJuice: 15, partConcentrationRay: 11, partFlameBall: 13,
    partShieldBall: 30, shotImp: 5,
  };
  const NOMS = [
    // les tirs
    'shotLightBall', 'shotLightBeam', 'shotSolero', 'shotWisp', 'shotGlue',
    'shotHolyBall', 'shotPhantom', 'shotImp', 'shotFireball',
    // les traînées et les auras
    'partQueueStandard', 'partQueuePhantom', 'partFader', 'partGlue',
    'mcDashAura', 'mcGlow', 'mcPeopleStatus', 'mcFaerieBubble',
    'mcBlackRing', 'mcBlackBallSpark',
    // les sorts
    'partLightBall', 'partLightBallFlip', 'partLightCircle', 'partLightStar',
    'partLightTube', 'partLightGrim', 'partFlipGlow', 'partVertiLight',
    'partHoriLight', 'partShieldBall', 'partForceBubble', 'partSlash',
    'partMiniStar', 'partMiniStarFull', 'partMiniCircle', 'partMiniExplosion',
    'partSuperNova', 'partBlackJuice', 'partBlackBall', 'partConcentrationRay',
    'partMeteore', 'partMeteoreStone', 'partFlameBall', 'partDust',
    'partStoneCrack', 'partStone', 'partOnde', 'partFaerieWhiteShade',
    'partPaint', 'partJet', 'partStar', 'partDeadImp', 'partBubble',
    'partElementCrystal', 'partElementCrystalDark', 'partEyeBall',
    'partBombEplosion', 'partBallColor', 'partDynColorFlower', 'partRay',
    'partFullRay', 'partRoundBlink', 'partPentacle', 'partCloud',
  ];
  const vus = new Set();
  return NOMS.filter((n) => !vus.has(n) && vus.add(n)).map((nom) => {
    const c = { cle: nom, symbole: nom, etiquette: nom };
    if (ANIMES[nom]) { c.synchro = true; c.images = [...Array(ANIMES[nom])].map((_, i) => i + 1); }
    return c;
  });
}

// Quelle image chaque forme utilise-t-elle ? extract-swf-shapes.js le dit.
function tableFormes(source) {
  const brut = execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), SOURCES[source]],
    { cwd: RACINE, encoding: 'utf8', maxBuffer: 128e6 });
  const t = new Map();
  for (const ligne of brut.split('\n')) {
    const m = /^#(\d+)\t\S+\t(\S+)\t(.*)$/.exec(ligne);
    if (!m) continue;
    const images = [...m[3].matchAll(/bitmap#(\d+)/g)]
      .map((x) => Number(x[1])).filter((id) => id !== 65535);
    const [w, h] = m[2].split('x').map(Number);
    t.set(Number(m[1]), { images, w, h });
  }
  return t;
}

/**
 * Le ciel — cent une images d'un dégradé qui se déforme du lever au coucher.
 *
 * decorPlanSky ne contient pas une forme mais DEUX MORPHS et une forme :
 *
 *     images   1 à  50   morph #373, minuit → midi
 *     images  51 à 100   morph #374, midi → minuit
 *     image  101         forme #375, la nuit revenue
 *
 * et chaque image porte son propre taux de mélange (le champ `ratio` du
 * placement, de 0 à 65535). Menu.setNight y envoie l'heure du jeu :
 *
 *     sky.gotoAndStop( int(nc*100) + 1 )        nc = $time.$s / un jour
 *
 * On écrit donc les cent une images, chacune interpolée à son propre taux.
 * C'est peu de place — un dégradé tient en six cents octets — et c'est le seul
 * moyen d'avoir EXACTEMENT le ciel du jeu à chaque heure.
 */
function extraireCiel(manifeste) {
  const swf = swfs.root;
  const id = swf.noms.get('decorPlanSky');
  if (id === undefined) return;
  const frames = swf.parSprite.get(id);
  if (!frames) return;
  const morphs = lireMorphs(SOURCES.root);

  const dossier = path.join(SORTIE, 'ciel');
  fs.mkdirSync(dossier, { recursive: true });
  const etats = [];
  for (const f of [...frames.keys()].sort((a, b) => a - b)) {
    const p = frames.get(f)[0];
    if (!p) continue;
    const m = morphs.get(p.ch);
    let svg = null;
    if (m) {
      svg = versSvg(m, (p.ratio || 0) / 65535);
    } else if (swf.estForme(p.ch)) {
      // La dernière image n'est plus un morph : c'est le ciel de minuit, figé.
      // On le tire par le même chemin que le reste, et on le lira ensuite.
      continue;
    }
    if (!svg) continue;
    const nom = 'ciel/ciel' + String(f).padStart(3, '0') + '.svg';
    fs.writeFileSync(path.join(SORTIE, nom), svg, 'utf8');
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
    const c = vb ? { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] } : { x: 0, y: 0, w: 240, h: 240 };
    etats.push({
      frame: f,
      pieces: [{ fichier: nom, x: c.x, y: c.y, w: c.w, h: c.h,
        vb: [c.x, c.y, c.w, c.h], m: [1, 0, 0, 1, 0, 0] }],
    });
  }
  if (!etats.length) return;
  // L'image 101 est une forme ordinaire : on recopie la centième plutôt que de
  // laisser un trou d'une image à minuit pile.
  if (!etats.some((e) => e.frame === 101)) {
    const derniere = etats[etats.length - 1];
    etats.push({ frame: 101, pieces: derniere.pieces });
  }
  manifeste.ciel = { nom: 'Ciel (heure par heure)', symbole: 'decorPlanSky', etats };
  console.log(`ciel : ${etats.length} images`);
}

function principal() {
  const manifeste = {};
  const ancrages = {};               // plan → nom du clip → point d'accroche
  const formes = new Map();          // clé « source#forme » → { source, shape }
  const absents = [];

  for (const item of CIBLES) {
    const source = item.swf || 'root';
    const { noms, parSprite, aplatir } = swfs[source];
    const id = (item.id !== undefined) ? item.id : noms.get(item.symbole);
    if (id === undefined) { absents.push(item.symbole); continue; }
    // Une FORME nue (le curseur d'Ornegon est la forme d'un bouton, que
    // l'extracteur ne traverse pas) : on la présente comme un clip d'une image.
    const frames = parSprite.get(id) || (swfs[source].estForme(id)
      ? new Map([[1, [{ ch: id, M: swfs[source].IDENTITE, prof: 1, nom: null,
        masque: 0, cx: null, ratio: null }]]])
      : undefined);
    if (!frames || frames.size === 0) { absents.push(item.symbole + ' (sans image)'); continue; }
    const etats = [];
    const voulues = item.images ? new Set(item.images) : null;
    // Le plus souvent une image du symbole donne un état. Mais quand
    // `sousImage` est une LISTE, c'est le sous-clip qui défile pendant que le
    // symbole reste sur sa seule image : le panneau de l'inventaire est ainsi
    // le même dessin pour les dix visages qu'il peut abriter, et son médaillon
    // rond découpe chacun d'eux.
    const parEnfant = Array.isArray(item.sousImage) ? item.sousImage : null;
    const cadres = parEnfant
      ? parEnfant.map((n) => ({ sortie: n, parent: [...frames.keys()][0], enfant: n }))
      : [...frames.keys()].sort((a, c) => a - c).map((f) => ({ sortie: f, parent: f }));
    for (const cadreDe of cadres) {
      const f = cadreDe.parent;
      if (voulues && !voulues.has(f)) continue;
      const pieces = [];
      // Les clips que le jeu pilote lui-même (la fontaine, le donjon, le sac…)
      // sont sortis du plan et extraits à part : c'est le jeu qui choisit leur
      // image et décide s'ils sont visibles. On garde en revanche l'endroit où
      // le plan les accroche, sans quoi on ne saurait pas où les reposer.
      const exclus = new Set(item.exclure || []);
      if (exclus.size) {
        ancrages[item.cle] = ancrages[item.cle] || {};
        for (const p of frames.get(f)) {
          if (p.nom && exclus.has(p.nom)) {
            const a = {
              x: Math.round(p.M.e / 20 * 100) / 100,
              y: Math.round(p.M.f / 20 * 100) / 100,
            };
            // Le plan ne fait pas que POSER un lieu : il peut le réduire (le
            // moulin est à 70 %) ou le voiler (l'arc-en-ciel est posé avec un
            // multiplicateur d'alpha de 77/256 — c'est ce qui rend ses couleurs
            // si douces). Perdre ces deux-là donnait un moulin trop grand et un
            // arc-en-ciel criard.
            if (Math.abs(p.M.a - 1) > 0.01) a.k = Math.round(p.M.a * 1000) / 1000;
            if (p.cx && p.cx.ma !== 256) a.alpha = Math.round(p.cx.ma / 256 * 1000) / 1000;
            ancrages[item.cle][p.nom] = a;
          }
        }
      }
      // Le masque de premier niveau et sa TRANCHE : il découpe les profondeurs
      // qui vont de la sienne à son ClipDepth, et elles seules. Le cadre rond du
      // portrait de l'inventaire s'arrête à la profondeur 11 ; le fond du
      // panneau, ses deux boutons et sa pastille de niveau vivent au-dessus.
      // Les appliquer au dessin entier rognait le panneau à son médaillon.
      let masqueOuvert = null;
      let numeroDeMasque = 0;
      for (const p of frames.get(f)) {
        if (p.nom && exclus.has(p.nom)) continue;
        if (masqueOuvert && p.prof > masqueOuvert.clip) masqueOuvert = null;
        // `sousImage` envoie les clips ENFANTS sur une image fixe pendant que le
        // parent parcourt les siennes. C'est ce que fait it.Food.getPic :
        //
        //     pic.gotoAndStop( floor((type-300)/3) + 1 )   // quel aliment
        //     pic.sub.gotoAndStop( ((type-300)%3) + 1 )    // quelle part
        //
        // deux index indépendants ; `synchro` seul enverrait les deux au même
        // et ne montrerait jamais que la grande part.
        const fEnfant = (cadreDe.enfant !== undefined) ? cadreDe.enfant
          : (item.sousImage !== undefined) ? item.sousImage
            : (item.synchro ? f : undefined);
        // La transformation de couleur du placement de PREMIER niveau se
        // transmet comme le masque : aplatir() ne la voit pas, puisqu'on
        // l'appelle placement par placement.
        const morceaux = aplatir(p.ch, p.M, 0, fEnfant, p.nom || '', p.cx || null);
        // Le masque posé au PREMIER niveau du symbole visé : aplatir() ne le
        // voit pas, puisqu'on l'appelle placement par placement. Sans ce
        // rattrapage, le rectangle rouge qui découpe la colonne des pièces à
        // venir se dessinait par-dessus elle.
        if (p.masque) {
          masqueOuvert = { clip: p.masque, num: ++numeroDeMasque };
          for (const m of morceaux) { m.masque = true; m.numeroMasque = masqueOuvert.num; }
        } else if (masqueOuvert) {
          for (const m of morceaux) m.sousMasque = masqueOuvert.num;
        }
        pieces.push(...morceaux);
      }
      if (!pieces.length) continue;
      for (const pc of pieces) {
        pc.source = source;
        formes.set(source + '#' + pc.shape, { source, shape: pc.shape });
      }
      etats.push({ frame: cadreDe.sortie, pieces });
    }
    if (!etats.length) { absents.push(item.symbole + ' (aucune forme)'); continue; }
    manifeste[item.cle] = { nom: item.etiquette, symbole: item.symbole, etats };
    if (ancrages[item.cle]) manifeste[item.cle].ancrages = ancrages[item.cle];
  }

  if (absents.length) console.log('introuvables : ' + absents.join(', '));
  const total = Object.values(manifeste).reduce((n, m) => n + m.etats.length, 0);
  console.log(`${Object.keys(manifeste).length} sprites, ${total} états, ${formes.size} formes distinctes`);

  if (process.argv.includes('--liste')) {
    for (const [cle, m] of Object.entries(manifeste)) {
      console.log(`  ${cle.padEnd(9)} ${m.nom.padEnd(16)} ${m.etats.length} état(s) : `
        + m.etats.map((e) => 'f' + e.frame + '=' + e.pieces.map((p) => '#' + p.shape).join('+')).join(' '));
    }
    return;
  }

  fs.mkdirSync(SORTIE, { recursive: true });

  // Chaque SWF a sa propre numérotation : on les traite séparément, et on
  // préfixe les fichiers du second pour que deux formes numéro 42 ne se
  // marchent pas dessus.
  const infos = new Map();           // « source#forme » → { images, w, h }
  const ecrites = new Map();         // « source#img|shp N » → fichier écrit
  for (const source of Object.keys(SOURCES)) {
    const voulues = [...formes.values()].filter((f) => f.source === source);
    if (!voulues.length) continue;
    const t = tableFormes(source);
    for (const [id, v] of t) infos.set(source + '#' + id, v);

    const images = new Set(), traces = new Set();
    for (const f of voulues) {
      const info = t.get(f.shape);
      if (info && info.images.length === 1) images.add(info.images[0]);
      else traces.add(f.shape);
    }
    console.log(`${source} : ${images.size} images, ${traces.size} tracés`);

    const sortie = PREFIXE[source] ? path.join(SORTIE, PREFIXE[source]) : SORTIE;
    if (PREFIXE[source]) fs.mkdirSync(sortie, { recursive: true });
    const relatif = (nom) => (PREFIXE[source] ? PREFIXE[source] + '/' + nom : nom);

    if (images.size) {
      const brut = execFileSync(process.execPath,
        [path.join(__dirname, 'extract-swf-bitmaps.js'), SOURCES[source], sortie, ...[...images].map(String)],
        { cwd: RACINE, encoding: 'utf8', maxBuffer: 128e6 });
      for (const m of brut.matchAll(/^#(\d+) → \S*?([^/\s]+\.(?:png|svg|jpg|gif))/gm)) {
        ecrites.set(source + '#img' + m[1], relatif(m[2]));
      }
    }
    if (traces.size) {
      const brut = execFileSync(process.execPath,
        [path.join(__dirname, 'extract-swf-shapes.js'), SOURCES[source], sortie, ...[...traces].map(String)],
        { cwd: RACINE, encoding: 'utf8', maxBuffer: 128e6 });
      for (const m of brut.matchAll(/^#(\d+) → \S*?([^/\s]+\.svg)/gm)) {
        ecrites.set(source + '#shp' + m[1], relatif(m[2]));
      }
    }
  }

  // Le cadre exact de chaque dessin, lu dans le viewBox du SVG écrit.
  //
  // C'est indispensable ici, et ça ne l'était pas pour Miniwave : les contours
  // du jeton ne sont pas centrés sur la case (le rebord supérieur occupe le
  // haut, pas le milieu). Les poser centrés les décalerait tous. Le SVG porte
  // déjà l'information — autant la lire là plutôt que d'inventer un format.
  function cadre(fichier) {
    const t = fs.readFileSync(path.join(SORTIE, fichier), 'utf8');

    const m = /viewBox="([-\d.eE]+) ([-\d.eE]+) ([-\d.eE]+) ([-\d.eE]+)"/.exec(t);
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
  }

  // Une pièce qu'on n'a pas su sortir ne doit pas disparaître en silence : le
  // client afficherait un trou à la place d'un jeton.
  const perdues = [];
  for (const [cle, m] of Object.entries(manifeste)) {
    m.etats = m.etats.map((e) => {
      const pieces = [];
      const masques = [];
      for (const pc of e.pieces) {
        const src = pc.source || 'root';
        const info = infos.get(src + '#' + pc.shape);
        const k = src + '#' + ((info && info.images.length === 1)
          ? 'img' + info.images[0] : 'shp' + pc.shape);
        const fichier = ecrites.get(k);
        if (!fichier) { perdues.push(`${cle} ${src}#${pc.shape}`); continue; }
        const c = cadre(fichier) || { x: -50, y: -50, w: 100, h: 100 };
        // La matrice absolue, translation convertie en pixels. Le client s'en
        // sert telle quelle : c'est le seul moyen exact de poser une pièce
        // MIROIR (l'aile droite de la fée est l'aile gauche à l'envers, a = -1)
        // ou TOURNÉE. Un simple coin haut-gauche et une taille ne suffisent
        // pas — le masque du portrait, étiré de 32 à 94 px, en est la preuve.
        const M = [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20];
        const coin = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
        const pts = [coin(c.x, c.y), coin(c.x + c.w, c.y),
          coin(c.x, c.y + c.h), coin(c.x + c.w, c.y + c.h)];
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const arr = (v) => Math.round(v * 1e4) / 1e4;
        const p = {
          fichier,
          // Le cadre du dessin APRÈS transformation : c'est lui qui dit au
          // client quelle taille de canevas préparer.
          x: arr(Math.min(...xs)), y: arr(Math.min(...ys)),
          w: arr(Math.max(...xs) - Math.min(...xs)),
          h: arr(Math.max(...ys) - Math.min(...ys)),
          // Le viewBox propre du SVG, et la matrice pour l'y poser.
          vb: [arr(c.x), arr(c.y), arr(c.w), arr(c.h)],
          m: M.map(arr),
        };
        // Un masque ne se dessine pas : il DÉCOUPE. On n'en garde que le cadre,
        // et le client s'en sert comme fenêtre — sans quoi le rectangle rouge
        // qui découpe le portrait de la fée se collerait en travers du cadre.
        //
        // Seuls les masques de PREMIER NIVEAU sont retenus. Ceux qui vivent au
        // fond d'un sous-clip ne découpent que ce sous-clip : les deux petits
        // masques des pupilles de la fée, appliqués au dessin entier,
        // réduiraient son portrait à treize pixels sur six.
        if (pc.masque) {
          // On garde le DESSIN du masque, pas seulement son cadre : celui du
          // médaillon de l'inventaire est un disque, et s'en tenir à son carré
          // laisserait dépasser les quatre coins du portrait.
          masques.push(Object.assign({}, p, { chemin: pc.chemin || '',
            num: pc.numeroMasque || 0 }));
          continue;
        }
        if (pc.sousMasque) p.msq = pc.sousMasque;
        // Le chemin des clips nommés qui portent la forme : c'est par lui que
        // le client sait quelle couleur de la fée appliquer à quel morceau.
        if (pc.chemin) p.nom = pc.chemin;
        // La transformation de couleur POSÉE dans le fichier (sortie = source
        // × mult/256 + add). C'est elle qui teinte en bleu ardoise le symbole
        // blanc d'un sort pour qu'il se lise sur sa bille blanche : sans elle,
        // les vingt-cinq symboles étaient invisibles.
        if (pc.cx) {
          p.cx = [pc.cx.mr, pc.cx.mv, pc.cx.mb, pc.cx.ma,
            pc.cx.ar, pc.cx.av, pc.cx.ab, pc.cx.aa].map(arr);
        }
        pieces.push(p);
      }
      // Un masque ne découpe que ses FRÈRES — ce qui vit sous le même clip que
      // lui. On ne garde donc que ceux qui couvrent tout le dessin, c'est-à-dire
      // ceux dont le clip parent contient toutes les pièces. Les deux petits
      // masques des pupilles de la fée, appliqués au dessin entier, réduiraient
      // son portrait à treize pixels sur six.
      const couvreTout = (m) => pieces.every((p) => {
        const n = p.nom || '';
        const parLeNom = m.chemin !== '' && (n === m.chemin || n.indexOf(m.chemin + '.') === 0);
        return parLeNom || (m.num !== 0 && p.msq === m.num);
      });
      const gardes = masques.filter(couvreTout).map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h }));
      const etat = { frame: e.frame, pieces };
      if (gardes.length) {
        // Un masque qui prend TOUT le dessin devient la fenêtre du canevas : rien
        // ne peut en sortir, autant ne pas préparer plus grand.
        etat.masques = gardes;
        for (const p of pieces) delete p.msq;
      } else {
        // Un masque PARTIEL, lui, ne découpe que sa tranche. Le client garde le
        // cadre entier et ne pose sous fenêtre que les pièces marquées.
        //
        // On sort AUSSI ceux que rien ne référence : la découpe de la colonne
        // des pièces à venir ne s'applique qu'à un clip vide (`mcNext.zone`),
        // que le jeu remplit lui-même à chaque pièce. Sans son cadre, elles
        // déborderaient du cadre du portrait en montant.
        const partiels = masques.filter((m) => m.num !== 0);
        if (partiels.length) {
          etat.masquesPartiels = partiels.map((m) => {
            const q = Object.assign({}, m); delete q.chemin; return q;
          });
        }
        for (const p of pieces) if (p.msq && !partiels.some((m) => m.num === p.msq)) delete p.msq;
      }
      return etat;
    }).filter((e) => e.pieces.length);
  }
  if (perdues.length) console.log('pièces perdues : ' + perdues.join(', '));

  // Le ciel arrive APRÈS le tri des formes : ses images ne viennent pas du
  // catalogue mais d'une interpolation, et repasser par la résolution des
  // formes les jetterait.
  extraireCiel(manifeste);

  const dest = path.join(SORTIE, 'sprites.json');
  fs.writeFileSync(dest, JSON.stringify(manifeste), 'utf8');
  console.log(`→ ${path.relative(RACINE, dest)} (${Object.keys(manifeste).length} sprites)`);
}

principal();
