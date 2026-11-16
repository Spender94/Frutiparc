'use strict';
/*
 * UN CACHE D'IMAGES À LA TAILLE BORNÉE.
 *
 * Les images servies depuis la base (forum, fonds, quiz, pictos maison,
 * boutique) passaient par des `Map` qui ne se vidaient jamais : chaque image
 * affichée une fois restait en mémoire jusqu'au redémarrage. Le forum seul
 * pèse 330 Mo en base (novembre 2026) pour une instance de 512 Mo : la
 * mémoire montait d'environ 100 Mo par jour, et le 6 novembre le serveur a
 * cessé de répondre à 526 Mo.
 *
 * Ce cache garde les images vues RÉCEMMENT, dans un budget d'octets :
 *   · au-delà du budget, les moins récemment servies sortent ;
 *   · une image plus grosse que `maxElement` n'entre pas (elle repassera par
 *     la base, que le navigateur ne redemande pas : les images sont servies
 *     avec un long Cache-Control) ;
 *   · la base reste la source : une image sortie du cache se relit.
 *
 * Même interface que la `Map` qu'il remplace (get, set, has, delete, clear,
 * size), plus `stats()` pour l'admin.
 */
class CacheBorne {
  constructor(o) {
    o = o || {};
    this.nom = String(o.nom || 'cache');
    this.maxOctets = Math.max(0, Number(o.maxOctets) || 0);
    this.maxElement = Math.max(0, Number(o.maxElement) || this.maxOctets);
    this.m = new Map();            // clé -> { valeur, octets } ; l'ordre = du plus ancien au plus récent
    this.octets = 0;
    this.compteurs = { lus: 0, ratés: 0, refusés: 0, sortis: 0 };
  }

  static tailleDe(v) {
    if (!v) return 0;
    if (Buffer.isBuffer(v)) return v.length;
    if (Buffer.isBuffer(v.buf)) return v.buf.length;
    if (typeof v.buf === 'string') return Buffer.byteLength(v.buf);
    return 0;
  }

  get size() { return this.m.size; }

  has(cle) { return this.m.has(cle); }

  get(cle) {
    const e = this.m.get(cle);
    if (!e) { this.compteurs.ratés++; return undefined; }
    // Servie à l'instant : elle passe en queue (la plus récente).
    this.m.delete(cle);
    this.m.set(cle, e);
    this.compteurs.lus++;
    return e.valeur;
  }

  set(cle, valeur) {
    this.delete(cle);
    const octets = CacheBorne.tailleDe(valeur);
    if (octets > this.maxElement || octets > this.maxOctets) {
      this.compteurs.refusés++;
      return this;
    }
    this.m.set(cle, { valeur, octets });
    this.octets += octets;
    // Les plus anciennes sortent jusqu'à rentrer dans le budget.
    for (const [k, e] of this.m) {
      if (this.octets <= this.maxOctets) break;
      this.m.delete(k);
      this.octets -= e.octets;
      this.compteurs.sortis++;
    }
    return this;
  }

  delete(cle) {
    const e = this.m.get(cle);
    if (!e) return false;
    this.m.delete(cle);
    this.octets -= e.octets;
    return true;
  }

  clear() {
    this.m.clear();
    this.octets = 0;
  }

  stats() {
    return {
      nom: this.nom, elements: this.m.size, octets: this.octets,
      maxOctets: this.maxOctets, maxElement: this.maxElement,
      ...this.compteurs,
    };
  }
}

// Un budget lu dans l'environnement (en Mo), avec sa valeur par défaut.
function moEnv(nom, defaut) {
  const v = Number(process.env[nom]);
  return Math.round((Number.isFinite(v) && v >= 0 ? v : defaut) * 1024 * 1024);
}

module.exports = { CacheBorne, moEnv };
