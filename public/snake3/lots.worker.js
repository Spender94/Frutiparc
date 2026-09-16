/*
 * Frutisnake — le décodage d'un lot de dessins, HORS du fil principal.
 *
 * Un lot est un JSON { fichier → texte SVG } d'un à deux mégaoctets et demi.
 * Le lire (`response.json()`), en faire un Blob par fichier et enregistrer
 * l'adresse de chacun (`createObjectURL`) coûtait, mesuré sur un téléphone
 * bridé, deux secondes de fil principal pour les mille cent fichiers du jeu —
 * et cela tombait pendant les premières secondes de la partie, en même temps
 * que le décodage des SVG eux-mêmes. C'est une part des « petits lags du
 * début » que les joueurs décrivent.
 *
 * Tout cela se fait donc ici, dans un ouvrier : le fil principal ne reçoit
 * que des adresses `blob:` prêtes à poser dans une Image. (Le décodage du SVG
 * à proprement parler, lui, ne peut pas quitter le fil principal — c'est
 * dessin.js qui le cadence, par petites vagues et jamais pendant la partie.)
 *
 * Protocole :
 *   ← { nom, url }             charger ce lot
 *   → { nom, urls: [[fichier, adresse], …] }
 *   → { nom, erreur }          le lot n'a pas pu être lu : dessin.js retombe
 *                              sur le chemin fichier par fichier
 *   ← { revoquer: [adresse…] } les images sont décodées, les blobs peuvent partir
 */
'use strict';

self.onmessage = function (e) {
  const d = e.data || {};
  if (Array.isArray(d.revoquer)) {
    for (const u of d.revoquer) { try { URL.revokeObjectURL(u); } catch (err) { /* déjà partie */ } }
    return;
  }
  if (!d.nom || !d.url) return;
  fetch(d.url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((lot) => {
      const urls = [];
      for (const f of Object.keys(lot)) {
        urls.push([f, URL.createObjectURL(new Blob([lot[f]], { type: 'image/svg+xml' }))]);
      }
      self.postMessage({ nom: d.nom, urls });
    })
    .catch((err) => self.postMessage({ nom: d.nom, erreur: String((err && err.message) || err) }));
};
