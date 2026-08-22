/*
  Le calendrier de la vitrine : « chaque lundi à 18 h, heure de Paris ».

  Une règle d'apparence anodine qui casse deux fois par an. Le lundi 18 h de
  Paris n'est pas à intervalle fixe : le passage à l'heure d'été rapproche deux
  lundis de 167 h, celui d'hiver les éloigne de 169 h. Une frontière posée dans
  le temps absolu — un numéro tiré d'une division de millisecondes — dérive donc
  d'une heure dans le calendrier parisien au dernier week-end de mars et
  d'octobre : la vitrine tournerait une heure trop tôt, puis une heure trop
  tard, et un lundi 17 h se retrouverait du mauvais côté.

  On compte donc en JOURS DE CALENDRIER, sur la date PARISIENNE : Intl donne le
  jour et l'heure qu'il est à Paris (heure d'été comprise), Date.UTC transforme
  cette date en un numéro de jour exact, et l'arithmétique se fait là — jamais
  sur des timestamps.

  Partagé par le serveur (rotation hebdomadaire, server.js) et ses tests.
*/
(function (global) {
  "use strict";

  var JOUR_MS = 86400000;
  // 1970-01-01 était un JEUDI ; 1970-01-05, un lundi, porte le numéro de jour 4.
  var LUNDI_ZERO = 4;

  // Ce qu'il est à Paris, en composantes. Le « 24 » que rendent certains ICU
  // pour minuit est ramené à 0.
  function composantesParis(date) {
    var g = {};
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false
    }).formatToParts(date || new Date());
    for (var i = 0; i < parts.length; i++) g[parts[i].type] = parts[i].value;
    return { y: +g.year, m: +g.month, d: +g.day, h: (+g.hour) % 24 };
  }

  // Numéro de jour (depuis 1970-01-01) de la date parisienne courante.
  function jourParis(date) {
    var p = composantesParis(date);
    return Date.UTC(p.y, p.m - 1, p.d) / JOUR_MS;
  }

  // Numéro de la semaine de vitrine EN COURS : celle qu'a ouverte le dernier
  // lundi `heure`:00 passé. Un lundi à 17 h 59, la vitrine en cours est encore
  // celle du lundi précédent.
  function semaineDeVitrine(date, heure) {
    var p = composantesParis(date);
    var jour = Date.UTC(p.y, p.m - 1, p.d) / JOUR_MS;
    var dow = ((jour + 4) % 7 + 7) % 7;                 // 0 = dimanche
    var recul = (dow + 6) % 7;                          // jours écoulés depuis lundi
    if (recul === 0 && p.h < (heure == null ? 18 : heure)) recul = 7;
    return (jour - recul - LUNDI_ZERO) / 7;
  }

  // La date (AAAA-MM-JJ) du lundi qui ouvre une semaine donnée.
  function dateLundi(semaine) {
    return new Date((semaine * 7 + LUNDI_ZERO) * JOUR_MS).toISOString().substring(0, 10);
  }

  var API = {
    JOUR_MS: JOUR_MS,
    composantesParis: composantesParis,
    jourParis: jourParis,
    semaineDeVitrine: semaineDeVitrine,
    dateLundi: dateLundi
  };

  global.FPVitrineCalendrier = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
