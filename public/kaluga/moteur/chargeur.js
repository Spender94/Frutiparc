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

/*
 * TÉLÉCHARGER EN DISANT OÙ L'ON EN EST.
 *
 * `fetch(...).then(r => r.json())` ne rend la main qu'une fois le fichier
 * entier arrivé : un jeu qui veut montrer une jauge de chargement n'a rien à
 * montrer, puis tout d'un coup. On lit donc le corps par morceaux et l'on
 * rapporte les octets au fur et à mesure.
 *
 * LA TAILLE TOTALE. `Content-Length` la donne — sauf quand la réponse est
 * compressée, et c'est le cas de tous nos JSON : le serveur passe alors en
 * « chunked » et ne l'annonce plus. Le serveur pose donc `X-Taille-Reelle`
 * (la taille du fichier sur le disque, avant compression) sur ses fichiers
 * statiques ; à défaut, on se rabat sur ce qu'on a déjà reçu, et la jauge
 * avance sans jamais promettre de fin.
 */
K.telecharger = function (url, surProgres, options) {
  return fetch(url, options).then((r) => {
    if (!r.ok) throw new Error('introuvable : ' + url);
    const total = Number(r.headers.get('X-Taille-Reelle'))
      || Number(r.headers.get('Content-Length')) || 0;
    if (!surProgres || !r.body || typeof r.body.getReader !== 'function') {
      return r.arrayBuffer().then((b) => {
        if (surProgres) surProgres(b.byteLength, b.byteLength);
        return b;
      });
    }
    const lecteur = r.body.getReader();
    const bouts = [];
    let recus = 0;
    surProgres(0, total);
    const suite = () => lecteur.read().then(({ done, value }) => {
      if (done) {
        const tout = new Uint8Array(recus);
        let d = 0;
        for (const b of bouts) { tout.set(b, d); d += b.length; }
        surProgres(recus, total || recus);
        return tout.buffer;
      }
      bouts.push(value);
      recus += value.length;
      // Les octets reçus sont ceux du corps DÉCOMPRESSÉ : ils se comparent
      // bien à la taille réelle. Si celle-ci manque, on prend le plus grand
      // des deux pour ne jamais dépasser cent pour cent.
      surProgres(recus, Math.max(total, recus));
      return suite();
    });
    return suite();
  });
};

/**
 * Charge une bibliothèque (un JSON extrait), ses images et ses fontes.
 *
 * `surProgres(octets, total)` est appelé au fil du téléchargement. Les
 * images et les fontes arrivent APRÈS le JSON et l'on n'en connaît pas le
 * poids d'avance : on leur réserve le dernier dixième de la jauge, qu'elles
 * remplissent à mesure qu'elles se posent. Le gros du temps est dans le
 * JSON — un mégaoctet pour la bibliothèque du jeu, contre quelques dizaines
 * de kilo-octets d'images par circuit.
 *
 * @returns {Promise<K.Bibliotheque>}
 */
const PART_JSON = 0.9;
K.chargerBiblio = function (nom, surProgres) {
  if (biblios[nom]) { if (surProgres) surProgres(1, 1); return Promise.resolve(biblios[nom]); }
  if (enCours[nom]) return enCours[nom];
  // L'échelle de la jauge : on la tient en centièmes de la taille du JSON,
  // pour que le passage aux images ne fasse pas sauter le chiffre.
  let echelle = 0;
  const dire = (octets, total) => {
    if (!surProgres) return;
    echelle = total || echelle;
    surProgres(Math.min(octets, echelle), echelle ? Math.round(echelle / PART_JSON) : 0);
  };
  enCours[nom] = K.telecharger(K.base + 'data/' + nom + '.json', surProgres ? dire : null, { cache: 'force-cache' })
    .then((buf) => {
      try { return JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buf))); }
      catch (e) { throw new Error('bibliothèque introuvable : ' + nom); }
    })
    .then(async (json) => {
      const images = {};
      const attentes = [];
      for (const [id, info] of Object.entries(json.images || {})) {
        attentes.push(chargerImage(K.base + 'data/img/' + info.f).then((img) => { if (img) images[id] = img; }));
      }
      for (const f of Object.values(json.fontes || {})) {
        if (f.fichier) attentes.push(chargerFonte(`Kaluga ${f.id}`, K.base + 'fontes/' + f.fichier));
      }
      if (surProgres && attentes.length && echelle) {
        // Le dernier dixième, une pièce à la fois.
        const total = Math.round(echelle / PART_JSON);
        const pas = (total - echelle) / attentes.length;
        let faits = 0;
        for (const a of attentes) a.then(() => { faits++; surProgres(Math.min(total, echelle + pas * faits), total); });
      }
      await Promise.all(attentes);
      const b = new K.Bibliotheque(nom, json, images);
      biblios[nom] = b;
      delete enCours[nom];
      if (surProgres) { const total = echelle ? Math.round(echelle / PART_JSON) : 1; surProgres(total, total); }
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
