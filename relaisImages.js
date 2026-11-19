'use strict';
/*
 * LE RELAIS DES IMAGES DU CHAT (`/image`, `/img`) : UN TÉLÉCHARGEMENT PAR IMAGE.
 *
 * Le serveur diffuse au salon `/api/imgproxy?url=…`, et CHAQUE joueur qui
 * affiche le message le demande. Le relais allait chercher l'image chez son
 * hébergeur à chaque demande : dix joueurs dans le salon, dix téléchargements
 * dans la même seconde, depuis la même adresse de serveur. Les hébergeurs
 * (les miniatures de Google Images, presque tout ce qui se partage) limitent
 * ces rafales : les premiers voyaient l'image, les suivants « [image
 * indisponible] ». Même image, même moment, pas le même résultat.
 *
 * Désormais :
 *   · une image relayée est gardée (cache borné en octets, cacheBorne.js) ;
 *   · les demandes simultanées de la même adresse attendent LE MÊME
 *     téléchargement ;
 *   · un échec passager (réseau, délai, 429, 5xx) est retenté une fois ;
 *   · un échec est journalisé (`[IMGPROXY]`), hôte et motif.
 *
 * Les garde-fous restent ceux de la route : http(s), hôtes privés refusés
 * (vérifiés AVANT d'appeler `obtenir`), redirections refusées, type image/*,
 * 5 Mo au plus.
 */

const MAX_OCTETS = 5 * 1024 * 1024;

function creerRelaisImages(o) {
  o = o || {};
  const fetchFn = o.fetchFn || ((...a) => fetch(...a));
  const cache = o.cache || null;
  const delaiMs = o.delaiMs || 8000;
  const essais = Math.max(1, o.essais || 2);
  const pauseMs = o.pauseMs == null ? 400 : o.pauseMs;
  const journal = o.journal || ((m) => console.log(m));
  const enCours = new Map();          // url -> promesse du téléchargement
  const compteurs = { servis: 0, depuisCache: 0, regroupes: 0, telecharges: 0, echecs: 0, reessais: 0 };

  async function uneFois(url) {
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), delaiMs);
    try {
      const r = await fetchFn(url, {
        redirect: 'error',           // une redirection pourrait viser une adresse interne
        signal: ctrl.signal,
        headers: { 'User-Agent': 'FrutiparcImageProxy/1.0', 'Accept': 'image/*' },
      });
      if (!r.ok) return { ok: false, status: 502, motif: 'hébergeur ' + r.status, passager: r.status === 429 || r.status >= 500 };
      const type = String(r.headers.get('content-type') || '');
      if (!type.startsWith('image/')) return { ok: false, status: 415, motif: 'pas une image (' + (type || 'sans type') + ')' };
      const annonce = Number(r.headers.get('content-length') || 0);
      if (annonce && annonce > MAX_OCTETS) return { ok: false, status: 413, motif: 'trop lourde' };
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_OCTETS) return { ok: false, status: 413, motif: 'trop lourde' };
      return { ok: true, type, buf };
    } catch (e) {
      const motif = ctrl.signal.aborted ? 'délai dépassé' : ('réseau : ' + ((e && e.cause && e.cause.message) || (e && e.message) || 'échec'));
      return { ok: false, status: 502, motif, passager: true };
    } finally {
      clearTimeout(minuterie);
    }
  }

  async function telecharger(url) {
    compteurs.telecharges++;
    let r;
    for (let i = 0; i < essais; i++) {
      if (i > 0) { compteurs.reessais++; if (pauseMs) await new Promise((ok) => setTimeout(ok, pauseMs)); }
      r = await uneFois(url);
      if (r.ok || !r.passager) break;
    }
    if (r.ok) {
      if (cache) cache.set(url, { mime: r.type, buf: r.buf });
    } else {
      compteurs.echecs++;
      let hote = '?';
      try { hote = new URL(url).hostname; } catch { /* adresse déjà validée par la route */ }
      journal(`[IMGPROXY] échec ${hote} : ${r.motif}`);
    }
    return r;
  }

  function obtenir(url) {
    compteurs.servis++;
    const garde = cache && cache.get(url);
    if (garde) { compteurs.depuisCache++; return Promise.resolve({ ok: true, type: garde.mime, buf: garde.buf }); }
    if (enCours.has(url)) { compteurs.regroupes++; return enCours.get(url); }
    const p = telecharger(url).finally(() => enCours.delete(url));
    enCours.set(url, p);
    return p;
  }

  return { obtenir, compteurs, enCours };
}

module.exports = { creerRelaisImages, MAX_OCTETS };
