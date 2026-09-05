/*
 * Kaluga — le CHARGEUR : les bibliothèques extraites (data/*.json), leurs
 * images, leurs fontes, et les sons.
 *
 * Les cartes (challenge, forest…) et l'animation de fin ne se chargent qu'à
 * la demande — le jeu Flash faisait pareil, par loadClip — et restent en
 * cache ensuite.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur = racine.KalugaMoteur || {};

K.base = '/kaluga/';
const biblios = {};
const enCours = {};

function chargerImage(src) {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });
}

function chargerFonte(famille, url) {
  if (!racine.FontFace || !document.fonts) return Promise.resolve(false);
  const f = new FontFace(famille, `url(${url})`);
  return f.load().then((ff) => { document.fonts.add(ff); return true; }).catch(() => false);
}

/**
 * Charge une bibliothèque (un JSON extrait), ses images et ses fontes.
 * @returns {Promise<K.Bibliotheque>}
 */
K.chargerBiblio = function (nom) {
  if (biblios[nom]) return Promise.resolve(biblios[nom]);
  if (enCours[nom]) return enCours[nom];
  enCours[nom] = fetch(K.base + 'data/' + nom + '.json', { cache: 'force-cache' })
    .then((r) => { if (!r.ok) throw new Error('bibliothèque introuvable : ' + nom); return r.json(); })
    .then(async (json) => {
      const images = {};
      const attentes = [];
      for (const [id, info] of Object.entries(json.images || {})) {
        attentes.push(chargerImage(K.base + 'data/img/' + info.f).then((img) => { if (img) images[id] = img; }));
      }
      for (const f of Object.values(json.fontes || {})) {
        if (f.fichier) attentes.push(chargerFonte(`Kaluga ${f.id}`, K.base + 'fontes/' + f.fichier));
      }
      await Promise.all(attentes);
      const b = new K.Bibliotheque(nom, json, images);
      biblios[nom] = b;
      delete enCours[nom];
      return b;
    });
  return enCours[nom];
};

// Les sons : nom d'auteur → fichier (les ADPCM sont des WAV, les autres des MP3).
const SONS_WAV = new Set(['sBush', 'sFly', 'sGroundHit0', 'sGroundHit1', 'sGroundHit2', 'sJeuLoop0', 'sMenuLoop']);
K.fichierSon = (nom) => 'sons/' + nom + (SONS_WAV.has(nom) ? '.wav' : '.mp3');
K.prechargerSons = function (noms) {
  K.audio.base = K.base;
  return Promise.all(noms.map((n) => K.audio.charger(n, K.fichierSon(n))));
};

})(typeof window !== 'undefined' ? window : globalThis);
