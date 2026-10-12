/*
 * Burning Kiwi — LA CADENCE : les touches sont datées, et chaque pas de
 * physique lit le clavier tel qu'il était À SON HEURE.
 *
 * Le lecteur partagé (/kaluga/moteur/flash.js) avance la physique à pas
 * fixes de 25 ms — quarante par seconde, comme le SWF — sur une horloge
 * VIRTUELLE : getTimer(), donc le chrono des courses et le gtmod du timer de
 * secours, ne connaissent que les pas. Quand le navigateur tarde (dans la page
 * du light, le jeu partage son fil avec le chat, le forum et les bouilles
 * animées), la boucle rattrape son retard en jouant plusieurs pas d'un coup,
 * jusqu'à 500 ms. La course est alors la même, à la milliseconde, qu'une
 * course sans à-coups… à PILOTAGE ÉGAL AU PAS : mesuré au pilote automatique
 * qui joue dans le pas, 21,850 s au tour sous une cadence lisse comme sous
 * des images de 150 ms rattrapées par six pas.
 *
 * Or le joueur ne pilote pas au pas, il pilote AU TEMPS : il lâche la flèche
 * à l'instant où la voiture a assez tourné. Et chaque pas lisait Key.isDown
 * au moment de son exécution : six pas joués en rafale lisaient tous le
 * clavier TEL QU'IL EST À LA FIN de la rafale. Une flèche lâchée au milieu des
 * 150 ms était lâchée pour les six pas — ou tenue pour les six, selon le côté
 * où tombait la frappe. Un lecteur Flash à quarante images régulières l'aurait
 * vue au bon pas. C'est un biais qui ne se voit pas (le chrono est juste, la
 * voiture n'a pas sauté) mais qui se sent : « quelques ralentissements
 * imperceptibles », et des temps qu'on ne retrouve pas. Il frappe d'abord
 * ceux qui pilotent au plus près de la bordure.
 *
 * Ici, chaque appui et chaque relâchement est DATÉ — de l'heure de la frappe
 * (ev.timeStamp), pas de celle de son traitement, que l'à-coup retarde —,
 * mis en file, et appliqué devant le pas dont c'est l'instant : un pas joué
 * en retard retrouve le clavier tel qu'il était à son heure. C'est la règle
 * du Flash Player d'époque, dont le minuteur exécutait l'image k à 25·k ms :
 * une frappe compte pour la première image dont l'heure la suit. La physique
 * ne dépend plus que de la suite des frappes et de leurs dates, jamais des
 * durées d'image : le même rejeu de touches (datées depuis le GO) donne la
 * même course, au pixel, à 25 ms réguliers, à 16,7 / 33,3 ms (un écran à
 * 60 Hz) et à 10 / 40 / 70 ms — là où l'ancienne lecture ne bouclait même
 * plus le tour (test/bkiwiCadence.test.js).
 *
 * L'instant d'un pas se lit sur la boucle elle-même : `tPrecedent` est
 * l'horodatage de l'image en cours, `accumule` ce qu'il reste à rattraper
 * après ce pas — leur différence est l'heure à laquelle ce pas AURAIT DÛ
 * tomber. Une frappe arrivée entre cette heure et l'image (jusqu'à 8 ms sur un
 * écran à 60 Hz, qui n'est pas calé sur les 25 ms du jeu) attend le pas
 * suivant : c'est ce que faisait le Flash Player, à la milliseconde près, et
 * c'est le prix d'une course qui ne dépend plus de la régularité des images.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.BkiwiJeu = racine.BkiwiJeu || {};

const horlogePage = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
// Une date plausible : la même base que performance.now(), pas dans le futur,
// pas plus vieille que quelques secondes (un timeStamp d'époque — millisecondes
// depuis 1970, sur de vieux moteurs — serait « dans le futur » et ne passerait
// jamais : on l'écarte, et la touche compte à l'instant où on la traite).
const plausible = (t, n) => typeof t === 'number' && Number.isFinite(t) && t <= n + 50 && t >= n - 5000;

// installerCadence(scene[, options]) — options.maintenant : l'horloge de la
// page (performance.now par défaut ; un banc d'essai donne la sienne).
J.installerCadence = function (scene, options) {
  const Key = K.Key;
  if (!Key || Key.$cadence) return Key && Key.$cadence;
  const maintenant = (options && typeof options.maintenant === 'function') ? options.maintenant : horlogePage;
  const presser0 = Key.presser, relacher0 = Key.relacher, toutRelacher0 = Key.toutRelacher;
  const file = [];                                  // { t, code, v }, triée par t

  // L'heure de la frappe en cours de traitement : relevée en capture (avant le
  // gestionnaire du lecteur, qui appelle presser / relacher), oubliée après.
  let frappe = null;
  if (typeof racine.addEventListener === 'function') {
    for (const type of ['keydown', 'keyup']) {
      racine.addEventListener(type, (ev) => { frappe = { code: ev.keyCode, t: ev.timeStamp }; }, true);
      racine.addEventListener(type, () => { frappe = null; }, false);
    }
  }
  const dater = (code, t) => {
    const n = maintenant();
    if (plausible(t, n)) return t;
    if (frappe && frappe.code === code && plausible(frappe.t, n)) return frappe.t;
    return n;
  };
  const ranger = (e) => {
    let i = file.length;
    while (i > 0 && file[i - 1].t > e.t) i--;
    file.splice(i, 0, e);
  };
  // presser(code[, t]) / relacher(code[, t]) : la date peut être donnée (un
  // rejeu, un banc d'essai) ; sinon c'est celle de la frappe, sinon maintenant.
  Key.presser = function (code, t) { ranger({ t: dater(code, t), code, v: true }); frappe = null; };
  Key.relacher = function (code, t) { ranger({ t: dater(code, t), code, v: false }); frappe = null; };
  // Tout lâcher (l'onglet quitté, le focus perdu) : ce qui attendait n'arrive
  // jamais, ce qui est tenu se lâche à l'instant.
  Key.toutRelacher = function () {
    file.length = 0;
    for (const c of Object.keys(this.enfoncees)) relacher0.call(this, +c);
  };
  // Applique au clavier ce qui est arrivé jusqu'à `limite`.
  const appliquer = (limite) => {
    while (file.length && file[0].t <= limite) {
      const e = file.shift();
      (e.v ? presser0 : relacher0).call(Key, e.code);
    }
  };

  const tick0 = scene.tick;
  scene.tick = function () {
    // L'heure à laquelle ce pas aurait dû tomber ; hors de la boucle (un pas
    // joué à la main), tout ce qui est arrivé jusqu'ici.
    const nominal = (typeof this.tPrecedent === 'number' && typeof this.accumule === 'number') ? this.tPrecedent - this.accumule : maintenant();
    appliquer(nominal);
    return tick0.call(this);
  };

  // Pour défaire (un banc d'essai qui enchaîne plusieurs scènes).
  const defaire = () => { Key.presser = presser0; Key.relacher = relacher0; Key.toutRelacher = toutRelacher0; scene.tick = tick0; delete Key.$cadence; };
  Key.$cadence = { file, appliquer, presser0, relacher0, defaire };
  return Key.$cadence;
};

})(typeof window !== 'undefined' ? window : globalThis);
