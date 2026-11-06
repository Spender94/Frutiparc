'use strict';
/*
 * SWAPOU — LE VERDICT D'UNE PARTIE REJOUÉE, et les horloges.
 *
 * Le rejeu (swapouRejeu.js) dit si les coups mènent au score déclaré. Cela
 * prouve que la partie EXISTE, pas qu'elle a été jouée dans le temps : un
 * tricheur qui connaît la graine peut chercher hors du jeu, à loisir, la
 * meilleure suite de coups, et la rendre comme s'il l'avait jouée. Ce module
 * confronte donc trois horloges, à la manière de celles de antitricheLight.js :
 *
 *   · le TEMPS DE JEU, tiré du rejeu : ce que durent, bout à bout, les
 *     animations de la partie (l'échange, les explosions, la chute, la ligne
 *     qui monte), quand le joueur rejoue à l'instant où le plateau lui rend la
 *     main. Le navigateur ne peut pas aller plus vite : la boucle du jeu
 *     (screens.js) avance de dt × 40 images par seconde de vraie horloge et
 *     plafonne le pas, elle ne l'accélère jamais. C'est le MINIMUM physique ;
 *   · la DURÉE SERVEUR : de la graine donnée au score reçu, à l'horloge du
 *     serveur — la seule que le joueur ne touche pas ;
 *   · la DURÉE DÉCLARÉE par le navigateur (performance.now, du début de la
 *     partie à sa fin), et les temps de réflexion du journal.
 *
 * Ce qui est IMPOSSIBLE écarte la partie (verdict « refuse », gravité grave) :
 *   1. une durée serveur plus courte que le temps de jeu — la partie a été
 *      rendue avant d'avoir pu être jouée ;
 *   2. une durée déclarée plus courte que le temps de jeu — l'horloge du
 *      navigateur a été accélérée, ou la durée inventée ;
 *   3. une durée déclarée plus longue que la durée serveur — le jeu ne peut
 *      pas avoir duré plus longtemps que l'intervalle qui le contient.
 * Ce qui est seulement ÉTRANGE est signalé (un « indice »), sans écarter :
 *   · une durée serveur très au-delà de la durée déclarée (une graine
 *     gardée longtemps avant d'être jouée, ou une durée déclarée rabotée) ;
 *   · des temps de réflexion qui, ajoutés au temps de jeu, dépassent la
 *     durée déclarée (un journal retouché).
 *
 * Le module ne décide que du verdict de la partie elle-même ; d'où vient la
 * graine (donnée à qui, rendue combien de fois) se juge avant, au serveur.
 */

const SEUILS = {
  // Le rejeu tourne au pas de six images : chaque animation y finit un peu
  // après son terme, et le temps de jeu qu'il mesure dépasse le vrai minimum
  // d'environ 5 % (4,6 à 5,7 % mesurés sur des parties du bot rejouées au pas
  // de 0,4 et à pas variable). On n'en retient que 85 % : 10 points de marge
  // sous le vrai minimum, pour ne jamais écarter un joueur rapide.
  tempsJeuPart: 0.85,
  // Et une marge fixe pour l'arrondi des horloges et le réseau.
  margeMs: 5000,
  // La durée déclarée tient dans la durée serveur, au réseau près (le départ
  // et l'arrivée des requêtes) et à la dérive des horloges près (2 %).
  avanceFacteur: 1.02,
  avanceMargeMs: 10000,
  // Une graine gardée plus de cinq minutes au-delà de la partie, et plus de
  // la moitié de sa durée : signalé, pas écarté (une mise en veille de
  // l'appareil fait la même chose).
  ecartSignalMs: 5 * 60000,
  ecartSignalPart: 0.5,
  // La réflexion déclarée + 85 % du temps de jeu dépasse la durée déclarée
  // de plus de 5 % et dix secondes : le journal ne se tient pas.
  reflexionFacteur: 1.05,
  reflexionMargeMs: 10000,
};

const secondes = (ms) => Math.round((Number(ms) || 0) / 1000);
const duree = (ms) => {
  const s = secondes(ms);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};

/**
 * Les trois horloges.
 * @param {{ tempsJeuMs:number, dureeServeurMs:number|null, dureeDeclareeMs:number, reflexionMs?:number }} h
 * @returns {{ refus: string|null, indices: string[], minimumMs: number }}
 */
function horloges(h) {
  const indices = [];
  const tempsJeu = Math.max(0, Number(h.tempsJeuMs) || 0);
  const minimumMs = Math.max(0, Math.round(tempsJeu * SEUILS.tempsJeuPart - SEUILS.margeMs));
  const declaree = Math.max(0, Number(h.dureeDeclareeMs) || 0);
  const serveur = h.dureeServeurMs == null ? null : Math.max(0, Number(h.dureeServeurMs) || 0);
  if (serveur !== null && serveur < minimumMs) {
    return { refus: `partie rendue ${duree(serveur)} après la graine, il faut au moins ${duree(minimumMs)} pour la jouer`, indices, minimumMs };
  }
  if (declaree < minimumMs) {
    return { refus: `durée déclarée ${duree(declaree)}, il faut au moins ${duree(minimumMs)} pour jouer la partie`, indices, minimumMs };
  }
  if (serveur !== null && declaree > serveur * SEUILS.avanceFacteur + SEUILS.avanceMargeMs) {
    return { refus: `durée déclarée ${duree(declaree)}, plus longue que les ${duree(serveur)} écoulées au serveur`, indices, minimumMs };
  }
  if (serveur !== null && serveur - declaree > Math.max(SEUILS.ecartSignalMs, declaree * SEUILS.ecartSignalPart)) {
    indices.push(`${duree(serveur)} entre la graine et le score, pour ${duree(declaree)} de partie déclarée`);
  }
  const reflexion = Math.max(0, Number(h.reflexionMs) || 0);
  if (reflexion + tempsJeu * SEUILS.tempsJeuPart > declaree * SEUILS.reflexionFacteur + SEUILS.reflexionMargeMs) {
    indices.push(`réflexion déclarée (${duree(reflexion)}) et animations (${duree(tempsJeu)}) plus longues que la partie (${duree(declaree)})`);
  }
  return { refus: null, indices, minimumMs };
}

/**
 * Le verdict d'une partie rejouée.
 * @param {object} rejeu   le résultat de swapouRejeu.rejouer (ou null si le rejeu a échoué)
 * @param {{ scoreDeclare:number, dureeDeclareeMs:number, dureeServeurMs:number|null, reflexionMs?:number }} d
 * @returns {{ verdict: 'conforme'|'divergent'|'refuse'|'non_verifiable', raison: string,
 *             indices: string[], minimumMs: number }}
 */
function juger(rejeu, d) {
  if (!rejeu) return { verdict: 'non_verifiable', raison: 'rejeu sans réponse', indices: [], minimumMs: 0 };
  if (!rejeu.ok) return { verdict: 'divergent', raison: rejeu.raison || 'partie non terminée', indices: [], minimumMs: 0 };
  const declare = Math.round(Number(d.scoreDeclare) || 0);
  if (rejeu.score !== declare) {
    return { verdict: 'divergent', raison: `score rejoué ${rejeu.score}, déclaré ${declare}`, indices: [], minimumMs: 0 };
  }
  const h = horloges({ tempsJeuMs: rejeu.tempsJeuMs, dureeServeurMs: d.dureeServeurMs,
    dureeDeclareeMs: d.dureeDeclareeMs, reflexionMs: d.reflexionMs });
  if (h.refus) return { verdict: 'refuse', raison: 'durée impossible : ' + h.refus, indices: h.indices, minimumMs: h.minimumMs };
  return { verdict: 'conforme', raison: '', indices: h.indices, minimumMs: h.minimumMs };
}

// La somme des temps de réflexion d'un journal (« s3,5,0@812 » : 812 ms).
function reflexionTotale(coups) {
  let t = 0;
  for (const m of String(coups || '').matchAll(/@(\d+)/g)) t += Number(m[1]);
  return t;
}

module.exports = { SEUILS, horloges, juger, reflexionTotale };
