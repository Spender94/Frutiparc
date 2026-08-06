/*
 * Minipixiz (miniTroll) — les missions de Gromelin.
 *
 * Traduction de Mission.mt (l'écran) et de ce que Cm en garde.
 *
 * C'est la seule façon de gagner des objets sans jouer. On confie une ou
 * plusieurs fées à Gromelin, elles partent pour trois à trente jours, et au
 * retour on gagne — ou pas. Pendant tout ce temps elles ne sont plus là : ni
 * pour courir en forêt, ni pour manger, ni pour déprimer.
 *
 * ── Le texte ──
 *
 * Une mission n'est pas écrite, elle est ASSEMBLÉE. Le canevas dit
 * « Libérer $victims du terrible $badName » ; la GRAINE, tirée une fois pour
 * toutes à la génération, choisit dans chaque liste de mots. La même mission
 * raconte donc toujours la même histoire, d'une visite à l'autre — sans que la
 * sauvegarde ait à retenir une phrase.
 *
 * La graine se transforme entre deux mots :
 *
 *     mot = liste[graine % liste.length]
 *     graine = (graine²) % (10000 + mot.length)
 *
 * C'est rudimentaire, et c'est justement pour ça qu'il faut le reproduire au
 * caractère près : une mission tirée par le SWF et relue ici doit donner
 * exactement la même phrase.
 *
 * ── La réussite ──
 *
 * Chaque canevas dit quelles caractéristiques il met à l'épreuve. On fait la
 * moyenne sur les fées envoyées, on divise par la difficulté, et on obtient un
 * pourcentage — que le joueur voit AVANT d'accepter. Envoyer deux fées aide,
 * mais pas au double : le groupe compte pour `1 + (n-1)×0,3`, ce qui punit les
 * expéditions inutiles.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const L = sousNode ? require('./langue.js') : racine.MinipixizLangue;
const O = sousNode ? require('./items.js') : racine.MinipixizObjets;
const F = sousNode ? require('./faerie.js') : racine.MinipixizFee;

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const borner = (a, v, b) => Math.min(Math.max(a, v), b);

// Mission.getNameList : les jetons à remplacer, dans CET ordre. Il compte —
// `$2fromLocation` doit passer avant `$fromLocation`, sans quoi le remplacement
// du second couperait le premier en deux.
const JETONS = [
  ['$thief', 'WORD_THIEF'],
  ['$kingdom', 'WORD_KINGDOM'],
  ['$history', 'WORD_HISTORY'],
  ['$funGame', 'WORD_FUN_GAME'],
  ['$longTime', 'WORD_LONG_TIME'],
  ['$victims', 'WORD_VICTIMS'],
  ['$2fromLocation', 'WORD_FROM_LOCATION'],
  ['$fromLocation', 'WORD_FROM_LOCATION'],
  ['$2atLocation', 'WORD_AT_LOCATION'],
  ['$atLocation', 'WORD_AT_LOCATION'],
  ['$badName', 'WORD_BAD_NAME'],
  ['$actionPastFun', 'WORD_ACTION_PAST_FUN'],
  ['$lostObject', 'WORD_LOST_OBJECT'],
  ['$period', 'WORD_PERIOD'],
  ['$super', 'WORD_SUPER'],
  ['$fromInvader', 'WORD_FROM_INVADER'],
];

/**
 * Le tirage semé de Mission.mt. Un objet, parce que la graine se transforme à
 * chaque mot pris et que l'ordre des prises fait toute la phrase.
 */
class Semeur {
  constructor(graine) { this.graine = nombre(graine); }

  mot(liste) {
    if (!liste || liste.length === 0) return '';
    const s = liste[this.graine % liste.length];
    this.graine = Math.floor(Math.pow(this.graine, 2) % (10000 + s.length));
    return s;
  }

  // Mission.getSeedFaerieName : deux syllabes, prises à la même graine — les
  // deux listes n'ayant pas la même longueur, on n'obtient pas deux fois la
  // même moitié.
  nomDeFee() {
    const p0 = L.nameSyl0[this.graine % L.nameSyl0.length];
    const p1 = L.nameSyl1[this.graine % L.nameSyl1.length];
    const s = p0 + p1;
    this.graine = Math.floor(Math.pow(this.graine, 2) % (10000 + s.length));
    return s;
  }
}

/**
 * Mission.getNameList — la table de remplacement d'une mission, tirée de sa
 * graine. On la construit une seule fois : les quatre phrases (titre, énoncé,
 * réussite, échec) partagent les mêmes mots, ce qui fait qu'elles se répondent.
 */
function motsDeLaMission(graine) {
  const s = new Semeur(graine);
  const table = [];
  for (const [jeton, cle] of JETONS) table.push([jeton, s.mot(L[cle])]);
  table.push(['$2faerieName', s.nomDeFee()]);
  table.push(['$faerieName', s.nomDeFee()]);
  return table;
}

/**
 * Mission.getMissionText — remplace, dans l'ordre.
 *
 * `$faerieName` restant après la table est remplacé par un nom TIRÉ AU HASARD à
 * chaque affichage, dans l'original (Cm.genFaerieName). Ce n'est pas une
 * négligence : la table le pose déjà, et ce dernier passage n'attrape que les
 * occurrences en trop. On garde le geste, avec le tirage de l'appelant pour
 * rester reproductible.
 */
function texte(canevas, table, alea) {
  let s = canevas;
  for (const [jeton, mot] of table) s = s.split(jeton).join(mot);
  if (s.indexOf('$faerieName') >= 0) {
    s = s.split('$faerieName').join(F.genererNom(alea || Math.random));
  }
  return s;
}

/**
 * Ce que l'écran de Gromelin affiche pour une mission proposée.
 *
 * @param {Array} info  [difficulté, type, jours, cadeau, graine]
 */
function decrire(info, alea) {
  const canevas = L.MISSION[info[1]] || L.MISSION[0];
  const table = motsDeLaMission(info[4]);
  const objet = O.info(info[3]);
  return {
    titre: texte(canevas.desc[0], table, alea),
    enonce: texte(canevas.desc[1], table, alea)
      .split('$day').join(info[2] + ' jours')
      .split('$dif').join(L.MISSION_DIF[info[0]] || ''),
    reussite: texte(canevas.desc[2], table, alea),
    echec: texte(canevas.desc[3], table, alea),
    type: canevas.type,
    rang: (L.MISSION_DIF_RANK[info[0]] || '').trim(),
    difficulte: info[0],
    jours: info[2],
    cadeau: info[3],
    nomCadeau: objet ? objet.nom : '?',
    test: canevas.test,
  };
}

/**
 * Mission.getCoef — les chances de réussite, entre 0 et 1.
 *
 * On fait la moyenne des caractéristiques éprouvées pour chaque fée, on
 * additionne, on divise par `1 + (n-1)×0,3` — un groupe rapporte, mais moins
 * que la somme de ses membres — puis par `2 + difficulté×2`.
 */
function chances(info, fiches, carte) {
  const canevas = L.MISSION[info[1]] || L.MISSION[0];
  const test = canevas.test;
  if (!fiches.length || !test.length) return 0;
  let somme = 0;
  for (const fs of fiches) {
    const fi = new F.Fee(fs, null, carte);
    let m = 0;
    for (const c of test) m += nombre(fi.carac[c]);
    somme += m / test.length;
  }
  const resultat = somme / (1 + (fiches.length - 1) * 0.3);
  return Math.min(resultat / (2 + info[0] * 2), 1);
}

/**
 * FaerieInfo.isAvailable + Mission.init — quelles fées Gromelin accepte.
 *
 * Deux conditions, et la seconde surprend : il faut que la fée soit DANS UN
 * BOCAL (`$pos != null`). « Je ne m'occupe que des fées correctement
 * conditionnées », dit-il. Une fée libre n'a pas de laisse, et il ne veut pas
 * courir après.
 */
function feesDisponibles(carte) {
  return (carte.$faerie || []).filter(
    (fs) => (fs.$mission === null || fs.$mission === undefined)
      && (fs.$pos !== null && fs.$pos !== undefined));
}

/**
 * Cm.addMission — le joueur accepte. Le sort en est jeté MAINTENANT : on tire
 * la réussite tout de suite et on range la phrase de fin dans la sauvegarde. Le
 * jour de l'échéance, il n'y aura plus qu'à la lire.
 */
function accepter(carte, index, fiches, alea, forcer) {
  const info = carte.$mission[index];
  if (!info || !fiches.length) return null;
  const d = decrire(info, alea);
  const c = chances(info, fiches, carte);
  const victoire = (forcer === undefined) ? ((alea || Math.random)() < c) : !!forcer;

  const id = carte.$mis.length;
  carte.$mis[id] = {
    $d: info[2],
    $gift: victoire ? info[3] : null,
    $type: info[1],
    $string: victoire ? d.reussite : d.echec,
  };
  for (const fs of fiches) {
    if (fs.$mission === null || fs.$mission === undefined) fs.$mission = id;
  }
  carte.$mission.splice(index, 1);
  carte.$stat.$misNum = nombre(carte.$stat.$misNum) + 1;
  return { id, victoire, chances: c, mission: carte.$mis[id], description: d };
}

/**
 * Mission.init — ce que Gromelin dit quand on frappe.
 *
 * Il ne travaille pas la nuit (getNightCoef < 0,2) et n'a rien à dire sans
 * missions : dans ces deux cas on toque dans le vide. Sinon il ouvre, et la
 * suite dépend de ce qu'on lui amène.
 */
function accueil(carte, coefNuit, dejaVu) {
  const dial = [];
  const nuit = (coefNuit === undefined) ? 0.5 : coefNuit;
  if (!carte.$mission || nuit < 0.2) {
    return {
      ouvre: false,
      dial: ['Toc, toc...', '...', 'Toc, toc, toc...', 'Apparemment, il n\'y a personne...'],
    };
  }
  dial.push('Toc, toc...');
  if (!dejaVu) {
    dial.push('Que fais-tu là petit homme ?');
    if ((carte.$faerie || []).length > 0) {
      dial.push('Ho mais c\'est une fée que tu as là ?');
      dial.push('J\'ai peut-être du travail pour tes fées...');
    } else {
      dial.push('C\'est pas ici que tu trouveras une fée, tu ferais mieux d\'aller voir '
        + 'du côté du bassin...');
    }
    dial.push('Si tu veux gagner de chouettes objets sans te fatiguer, envoie-moi tes fées...');
    dial.push('...Je peux leur trouver du travail, je connais bien ce pays.');
    dial.push('Reviens me voir avec tes fées !');
    dial.push('Attention ! Je ne m\'occupe que des fées correctement conditionnées... '
      + 'Pas de fées sans bocal !');
    return { ouvre: true, dial, missions: false };
  }
  if ((carte.$faerie || []).length === 0) {
    dial.push('Grrr... Reviens me voir quand tu auras des fées, petit homme...');
    return { ouvre: true, dial, missions: false };
  }
  // Accepter une mission RETIRE l'offre de la liste (`accepter` la splice, comme
  // Cm.addMission), et les six ne se renouvellent qu'à la nuit. Prendre les
  // dernières vide donc le tableau — et un tableau vide n'est pas `null` : le
  // test d'entrée le laissait passer, la porte s'ouvrait, et le joueur se
  // retrouvait devant un parchemin nu sans un mot d'explication. Le jeu
  // d'origine a le même trou ; on le bouche du seul côté qui manquait.
  if (!(carte.$mission || []).length) {
    dial.push('Grumph... Je n\'ai plus rien sous la main aujourd\'hui.');
    dial.push('Repasse demain, j\'aurai retrouvé du travail pour tes fées.');
    return { ouvre: true, dial, missions: false };
  }
  const libres = feesDisponibles(carte);
  if (libres.length === 0) {
    dial.push('Grumph.... Tu m\'as dérangé pour rien...');
    dial.push('Tu n\'as pas de fées prêtes à recevoir une mission...');
    dial.push('N\'oublie pas que je ne m\'occupe que des fées qui sont dans un bocal !');
    return { ouvre: true, dial, missions: false };
  }
  dial.push('Voyons voir...');
  dial.push('Mmmmhhh... J\'ai peut-être du boulot pour ' + enumerer(libres.map((f) => f.$name)) + '.');
  dial.push('Rentre donc à l\'intérieur...');
  return { ouvre: true, dial, missions: true, fees: libres };
}

// « a, b et c » — la façon dont Gromelin et Cm.validateMission énumèrent.
function enumerer(noms) {
  return noms.reduce((s, v, i) => {
    if (i === 0) return v;
    return s + (i === noms.length - 1 ? ' et ' : ', ') + v;
  }, '');
}

const API = {
  Semeur, motsDeLaMission, texte, decrire, chances, feesDisponibles, accepter,
  accueil, enumerer, JETONS,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizMissions = API;

})(typeof window !== 'undefined' ? window : globalThis);
