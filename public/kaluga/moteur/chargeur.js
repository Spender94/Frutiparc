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

/*
 * UNE PIÈCE QUI N'ARRIVE PAS LAISSAIT UN TROU, ET LE TROU RESTAIT.
 *
 * Les aplats du SWF sont rangés en IMAGES : le corps d'une pomme de Kaluga,
 * par exemple, est un remplissage par bitmap (kaluga-136.svg). Quand l'image
 * manque, `dessinerDessin` saute ce remplissage — et rien ne pouvait plus la
 * ramener : `chargerImage` rendait `null` au premier échec, l'identifiant
 * n'entrait jamais dans la table de la bibliothèque, et la session entière se
 * jouait avec des POMMES FANTÔMES, réduites à leur reflet et à leur queue.
 * Une seule requête perdue au chargement — un hoquet de réseau sur un
 * téléphone suffit, et il y en a cinquante-sept à tirer d'un coup — et
 * c'était pour toute la partie, sans un mot dans la console.
 *
 * On réessaie donc : trois fois vite, le chargement attend ; puis de loin en
 * loin, en arrière-plan, sans retenir le jeu. Et comme la table d'images est
 * RELUE À CHAQUE IMAGE par le dessin, une image qui finit par arriver se
 * remet en place toute seule — la pomme redevient rouge en cours de partie,
 * sans rien relancer.
 *
 * Les essais de rattrapage portent un paramètre d'adresse : on veut une
 * requête neuve, pas la réponse en échec que le navigateur tiendrait encore.
 */
const ESSAIS_BLOQUANTS = 3;          // ce que le chargement attend avant de rendre la main
const ESSAIS_MAX = 8;                // au-delà, la pièce est tenue pour perdue
const PAUSES = [300, 900, 2500, 6000, 15000, 30000];
const patience = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = (essai) => PAUSES[Math.min(essai, PAUSES.length - 1)];
const adresseNeuve = (src, essai) => (essai === 0 ? src : src + (src.indexOf('?') < 0 ? '?' : '&') + 'ressai=' + essai);

function tenterImage(src) {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });
}

/*
 * `poser(img)` range l'image là où le dessin la cherchera. Il peut être
 * rappelé BIEN APRÈS que la promesse soit retombée : c'est tout l'intérêt.
 * La promesse, elle, ne fait attendre que les premiers essais.
 */
function chargerImage(src, poser) {
  let essai = 0;
  const coup = () => tenterImage(adresseNeuve(src, essai)).then((img) => {
    if (img) {
      if (essai && typeof console !== 'undefined') console.warn('[kaluga] ' + src + ' : obtenue au bout de ' + (essai + 1) + ' essais');
      if (poser) poser(img);
      return img;
    }
    essai++;
    if (essai >= ESSAIS_MAX) {
      if (typeof console !== 'undefined') console.warn('[kaluga] image introuvable après ' + ESSAIS_MAX + ' essais : ' + src);
      return null;
    }
    if (essai >= ESSAIS_BLOQUANTS) {
      // On rend la main au jeu, et l'on continue derrière.
      patience(pause(essai)).then(coup);
      return null;
    }
    return patience(pause(essai)).then(coup);
  });
  return coup();
}
K.chargerImage = chargerImage;

function chargerFonte(famille, url) {
  if (!racine.FontFace || !document.fonts) return Promise.resolve(false);
  let essai = 0;
  const coup = () => {
    const f = new FontFace(famille, `url(${adresseNeuve(url, essai)})`);
    return f.load().then((ff) => { document.fonts.add(ff); return true; }).catch(() => {
      essai++;
      // Une fonte absente ne fait pas de trou — le texte retombe sur une
      // fonte du système — mais elle change l'allure : on réessaie de même.
      if (essai >= ESSAIS_MAX) { if (typeof console !== 'undefined') console.warn('[kaluga] fonte introuvable : ' + url); return false; }
      if (essai >= ESSAIS_BLOQUANTS) { patience(pause(essai)).then(coup); return false; }
      return patience(pause(essai)).then(coup);
    });
  };
  return coup();
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
K.telecharger = function (url, surProgres, options, essai) {
  essai = essai || 0;
  /*
   * ET SI LE TÉLÉCHARGEMENT LUI-MÊME ÉCHOUE. Une bibliothèque perdue, c'est
   * le jeu qui ne démarre pas (« bibliothèque introuvable ») ou le circuit
   * qui ne charge pas. Un hoquet de réseau ou un 5xx passager se rattrape ;
   * un 404 est une vraie absence et ne se rattrape pas — on le dit tout de
   * suite. La jauge repart de zéro à chaque essai, ce qui est la vérité.
   */
  const absent = () => { const e = new Error('introuvable : ' + url); e.kalugaAbsent = true; return e; };
  const rattraper = (raison) => {
    // Une vraie absence ne se rattrape pas : inutile de faire attendre.
    if (raison && raison.kalugaAbsent) throw raison;
    if (essai >= ESSAIS_BLOQUANTS) throw (raison instanceof Error ? raison : new Error('introuvable : ' + url));
    if (typeof console !== 'undefined') console.warn('[kaluga] ' + url + ' : essai ' + (essai + 2) + ' (' + ((raison && raison.message) || raison) + ')');
    return patience(pause(essai)).then(() => K.telecharger(adresseNeuve(url, essai + 1), surProgres, options, essai + 1));
  };
  // `catch` et non un second argument de `then` : une coupure EN COURS de
  // lecture du flux doit se rattraper comme un échec de connexion.
  return fetch(url, options).then((r) => {
    if (r.status === 404 || r.status === 410) throw absent();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' : ' + url);
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
  }).catch(rattraper);
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
        // `images` est CELLE de la bibliothèque (Bibliotheque garde la
        // référence) : une image qui arrive en retard s'y range et le dessin
        // la prend à l'image suivante.
        attentes.push(chargerImage(K.base + 'data/img/' + info.f, (img) => { images[id] = img; }));
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
    })
    // Un échec ne doit pas rester en travers : sans cela, la bibliothèque
    // serait « en cours » pour toujours et aucune tentative ultérieure ne
    // repartirait.
    .catch((e) => { delete enCours[nom]; throw e; });
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
