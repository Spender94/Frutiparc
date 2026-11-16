'use strict';
/*
 * ══════════════════════════════════════════════════════════════════════════
 * LA MÉMOIRE DU SERVEUR — relevés, historique en base, inventaire
 * ══════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI. En novembre 2026, la mémoire de l'instance Render (512 Mo) montait
 * d'environ 100 Mo par jour jusqu'à la limite ; le 6 novembre, le serveur a
 * cessé de répondre à 526 Mo. Render ne voit que le TOTAL, et ses courbes ne
 * disent pas d'où il vient. Ce module donne à l'admin (onglet Statistiques,
 * « Le serveur ») :
 *
 *   · LES RELEVÉS — toutes les cinq minutes, la mémoire du processus (le RSS,
 *     ce que Render compte, fils de rejeu compris), le tas JavaScript, la
 *     mémoire hors tas (les Buffer) et ce que tiennent les caches d'images ;
 *   · L'HISTORIQUE — ces relevés gardés en base trente jours, pour que la
 *     courbe survive aux redémarrages et aux déploiements ;
 *   · L'INVENTAIRE — le nombre d'éléments de chaque grande structure gardée
 *     en mémoire (sessions, comptes chargés, salons, files, registres…),
 *     relevé une fois par heure : celle qui grossit avec la courbe est la
 *     coupable. Il COMPTE, il ne copie rien.
 *
 * LA BASE, SANS RISQUE POUR LE DÉMARRAGE. La table `memoire_releves` n'est
 * PAS créée par db.initSchema (que le serveur attend pour démarrer) : elle
 * l'est ici, après le démarrage, au premier relevé. Toute erreur de base
 * (création, écriture, lecture, purge) est attrapée : l'admin affiche
 * « historique indisponible », les relevés continuent en mémoire (vingt-quatre
 * heures), et la base est retentée une heure plus tard. La table ne contient
 * que des nombres — aucune donnée de joueur — et se purge au-delà de trente
 * jours.
 *
 * LE POIDS EN BASE. Un relevé sans inventaire : une centaine d'octets, 288
 * par jour. L'inventaire (≈ 100 compteurs, 2 à 3 Ko) n'est écrit qu'une fois
 * par heure. Trente jours : ≈ 9 000 lignes, 2 à 3 Mo.
 */
const os = require('os');

const TABLE = 'memoire_releves';
const SQL_CREER = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id          BIGSERIAL PRIMARY KEY,
    t           TIMESTAMPTZ NOT NULL DEFAULT now(),
    instance    TEXT,
    demarre     TIMESTAMPTZ,
    rss         BIGINT,
    tas         BIGINT,
    externe     BIGINT,
    caches      BIGINT,
    inventaire  JSONB
  );
  CREATE INDEX IF NOT EXISTS ${TABLE}_t ON ${TABLE} (t);
`;

// Compter une valeur : la taille d'une collection, rien pour le reste.
function tailleDe(v) {
  if (!v || typeof v !== 'object') return null;
  if (v instanceof Map || v instanceof Set) return v.size;
  if (Array.isArray(v)) return v.length;
  if (Buffer.isBuffer(v) || ArrayBuffer.isView(v)) return null;
  return null;
}
function estObjetSimple(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}
function valeursDe(v) {
  if (v instanceof Map || v instanceof Set) return v.values();
  if (Array.isArray(v)) return v;
  if (estObjetSimple(v)) return Object.values(v);
  return [];
}
// Le contenu d'une collection, un cran plus bas : la somme des collections
// qu'elle tient directement, ou que tiennent les objets qu'elle tient (un
// salon { historique: [...] }). Une Map dont le nombre de clés ne bouge pas
// peut grossir par ses valeurs : c'est ce compteur-là qui le dit.
const CONTENU_MAX_OPERATIONS = 2000000;
function contenuDe(v) {
  let total = 0, ops = 0;
  for (const x of valeursDe(v)) {
    if (++ops > CONTENU_MAX_OPERATIONS) return { total, tronque: true };
    const t = tailleDe(x);
    if (t !== null) { total += t; continue; }
    if (estObjetSimple(x)) {
      for (const k in x) {
        if (++ops > CONTENU_MAX_OPERATIONS) return { total, tronque: true };
        const t2 = tailleDe(x[k]);
        if (t2 !== null) total += t2;
      }
    }
  }
  return { total, tronque: false };
}
function typeDe(v) {
  if (v instanceof Map) return 'Map';
  if (v instanceof Set) return 'Set';
  if (Array.isArray(v)) return 'tableau';
  if (estObjetSimple(v)) return 'objet';
  return typeof v;
}

class MemoireServeur {
  /**
   * @param {object} o
   *   pool        le pool Postgres (db.pool), ou null sans base
   *   limite      la limite de l'instance, en octets
   *   caches      () => [{ nom, octets, ... }] les stats des caches d'images
   *   periodeMs   l'intervalle des relevés (5 min)
   *   inventaireChaque  un inventaire en base tous les n relevés (12 : une fois par heure)
   *   gardeJours  la durée de l'historique en base (30)
   *   retenteMs   le délai avant de retenter une base en panne (1 h)
   *   memoire     process.memoryUsage (remplaçable dans les tests)
   *   maintenant  Date.now (idem)
   */
  constructor(o) {
    o = o || {};
    this.pool = o.pool || null;
    this.limite = Number(o.limite) || 512 * 1024 * 1024;
    this.caches = typeof o.caches === 'function' ? o.caches : () => [];
    this.periodeMs = Number(o.periodeMs) || 5 * 60 * 1000;
    this.inventaireChaque = Math.max(1, Number(o.inventaireChaque) || 12);
    this.gardeJours = Number(o.gardeJours) || 30;
    this.retenteMs = Number(o.retenteMs) || 60 * 60 * 1000;
    this.memoire = o.memoire || (() => process.memoryUsage());
    this.maintenant = o.maintenant || (() => Date.now());
    this.instance = String(o.instance || process.env.RENDER_INSTANCE_ID || os.hostname() || '').slice(0, 80);
    this.demarre = new Date(this.maintenant() - process.uptime() * 1000);
    this.surveilles = [];          // [{ nom, lire }]
    this.releves = [];             // en mémoire, 24 h : [{ t, rss, tas, externe, caches, inventaire? }]
    this.n = 0;
    this.base = { etat: this.pool ? 'en attente' : 'sans base', erreur: null, prete: false, prochainEssai: 0, ecrits: 0, echecs: 0 };
    this.minuteur = null;
    this.derniereDureeInventaireMs = 0;
  }

  /** Une structure à compter. `lire` rend la valeur (une Map, un tableau, un objet…). */
  surveiller(nom, lire) {
    if (typeof lire === 'function') this.surveilles.push({ nom: String(nom), lire });
    return this;
  }

  /** L'inventaire à l'instant : [{ nom, type, elements, contenu, tronque? }]. */
  inventaire() {
    const debut = Date.now();
    const out = [];
    for (const s of this.surveilles) {
      try {
        const v = s.lire();
        let elements = tailleDe(v);
        if (elements === null && estObjetSimple(v)) elements = Object.keys(v).length;
        if (elements === null) continue;
        const c = contenuDe(v);
        out.push(Object.assign({ nom: s.nom, type: typeDe(v), elements, contenu: c.total }, c.tronque ? { tronque: true } : {}));
      } catch (e) { /* une structure illisible n'empêche pas les autres */ }
    }
    this.derniereDureeInventaireMs = Date.now() - debut;
    return out;
  }

  // L'inventaire, compact pour la base : { nom: [éléments, contenu] }.
  static compacter(inv) {
    const o = {};
    for (const x of inv) o[x.nom] = [x.elements, x.contenu];
    return o;
  }

  /** Un relevé : mémoire + caches (+ inventaire une fois sur `inventaireChaque`). */
  releve(avecInventaire) {
    const m = this.memoire();
    const caches = this.caches();
    const r = {
      t: this.maintenant(),
      rss: m.rss, tas: m.heapUsed, externe: m.external,
      caches: caches.reduce((a, c) => a + (Number(c.octets) || 0), 0),
    };
    if (avecInventaire) r.inventaire = MemoireServeur.compacter(this.inventaire());
    return r;
  }

  async _base(sql, params) {
    return this.pool.query(sql, params);
  }

  // La table, créée une fois, à part du démarrage. Rend vrai si elle est prête.
  async _preparer() {
    if (!this.pool) return false;
    if (this.base.prete) return true;
    if (this.maintenant() < this.base.prochainEssai) return false;
    try {
      await this._base(SQL_CREER);
      this.base.prete = true;
      this.base.etat = 'ok';
      this.base.erreur = null;
      await this._purger();
      return true;
    } catch (e) {
      this._panne(e);
      return false;
    }
  }

  _panne(e) {
    this.base.prete = false;
    this.base.etat = 'indisponible';
    this.base.erreur = String((e && e.message) || e).slice(0, 200);
    this.base.prochainEssai = this.maintenant() + this.retenteMs;
    this.base.echecs++;
    console.error('[MEMOIRE] historique en base indisponible :', this.base.erreur);
  }

  async _purger() {
    await this._base(`DELETE FROM ${TABLE} WHERE t < now() - ($1::int * interval '1 day')`, [this.gardeJours]);
  }

  /** Prend un relevé, le garde en mémoire, l'écrit en base si elle va bien. Ne rejette jamais. */
  async relever() {
    try {
      const avecInventaire = this.n % this.inventaireChaque === 0;
      this.n++;
      const r = this.releve(avecInventaire);
      this.releves.push(r);
      const avant = r.t - 24 * 3600 * 1000;
      while (this.releves.length && this.releves[0].t < avant) this.releves.shift();
      if (await this._preparer()) {
        try {
          await this._base(`INSERT INTO ${TABLE} (t, instance, demarre, rss, tas, externe, caches, inventaire)
            VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7, $8)`,
          [r.t, this.instance, this.demarre, r.rss, r.tas, r.externe, r.caches, r.inventaire ? JSON.stringify(r.inventaire) : null]);
          this.base.ecrits++;
          // La purge, une fois par jour environ.
          if (this.n % 288 === 0) await this._purger();
        } catch (e) { this._panne(e); }
      }
      return r;
    } catch (e) {
      console.error('[MEMOIRE] relevé :', e.message);
      return null;
    }
  }

  demarrer() {
    if (this.minuteur) return this;
    this.relever();
    this.minuteur = setInterval(() => { this.relever(); }, this.periodeMs);
    if (this.minuteur.unref) this.minuteur.unref();
    return this;
  }

  arreter() {
    if (this.minuteur) clearInterval(this.minuteur);
    this.minuteur = null;
  }

  /**
   * La courbe sur `heures` : depuis la base (le pic de chaque tranche, au plus
   * ~300 points, avec les démarrages), sinon depuis la mémoire.
   * @returns {Promise<{ source: 'base'|'memoire', points: [{ t, rss, tas, externe, caches, demarre? }] }>}
   */
  async historique(heures) {
    const h = Math.max(1, Math.min(24 * this.gardeJours, Number(heures) || 24));
    if (this.base.prete) {
      try {
        // Secondes par point : au plus ~300 points, jamais moins d'un relevé.
        const pas = Math.max(Math.round(this.periodeMs / 1000), Math.ceil(h * 3600 / 300));
        const r = await this._base(`
          SELECT to_timestamp(floor(extract(epoch FROM t) / $2) * $2) AS t,
                 max(rss) AS rss, max(tas) AS tas, max(externe) AS externe, max(caches) AS caches,
                 max(demarre) AS demarre
            FROM ${TABLE}
           WHERE t > now() - ($1::int * interval '1 hour')
           GROUP BY 1 ORDER BY 1`, [h, pas]);
        return {
          source: 'base',
          points: r.rows.map((x) => ({ t: new Date(x.t).getTime(), rss: Number(x.rss), tas: Number(x.tas),
            externe: Number(x.externe), caches: Number(x.caches), demarre: x.demarre ? new Date(x.demarre).getTime() : null })),
        };
      } catch (e) { this._panne(e); }
    }
    const depuis = this.maintenant() - h * 3600 * 1000;
    return { source: 'memoire', points: this.releves.filter((r) => r.t >= depuis).map((r) => ({
      t: r.t, rss: r.rss, tas: r.tas, externe: r.externe, caches: r.caches, demarre: this.demarre.getTime() })) };
  }

  /**
   * L'inventaire à l'instant, avec ce qu'il valait il y a environ une heure et
   * vingt-quatre heures (relevés d'inventaire de la base, ou de la mémoire),
   * trié par croissance sur vingt-quatre heures.
   */
  async inventaireCompare() {
    const ici = this.inventaire();
    const cherche = async (heures) => {
      const cible = this.maintenant() - heures * 3600 * 1000;
      if (this.base.prete) {
        try {
          const r = await this._base(`SELECT t, inventaire FROM ${TABLE}
             WHERE inventaire IS NOT NULL AND instance = $2 AND t <= to_timestamp($1 / 1000.0)
             ORDER BY t DESC LIMIT 1`, [cible + 15 * 60 * 1000, this.instance]);
          if (r.rows[0]) return { t: new Date(r.rows[0].t).getTime(), inv: r.rows[0].inventaire };
          return null;
        } catch (e) { this._panne(e); }
      }
      let mieux = null;
      for (const x of this.releves) if (x.inventaire && x.t <= cible + 15 * 60 * 1000) mieux = x;
      return mieux ? { t: mieux.t, inv: mieux.inventaire } : null;
    };
    const h1 = await cherche(1);
    const h24 = await cherche(24);
    const delta = (ref, nom, i) => (ref && ref.inv && ref.inv[nom] ? i - ref.inv[nom][0] : null);
    const deltaC = (ref, nom, c) => (ref && ref.inv && ref.inv[nom] ? c - ref.inv[nom][1] : null);
    const lignes = ici.map((x) => Object.assign({}, x, {
      d1: delta(h1, x.nom, x.elements), d24: delta(h24, x.nom, x.elements),
      d1Contenu: deltaC(h1, x.nom, x.contenu), d24Contenu: deltaC(h24, x.nom, x.contenu),
    }));
    const poids = (x) => Math.max(Math.abs(x.d24 || 0) + Math.abs(x.d24Contenu || 0), Math.abs(x.d1 || 0) + Math.abs(x.d1Contenu || 0));
    lignes.sort((a, b) => poids(b) - poids(a) || (b.elements + b.contenu) - (a.elements + a.contenu));
    return { lignes, depuis1h: h1 ? h1.t : null, depuis24h: h24 ? h24.t : null, dureeMs: this.derniereDureeInventaireMs };
  }

  etat() {
    return { etat: this.base.etat, erreur: this.base.erreur, ecrits: this.base.ecrits, echecs: this.base.echecs,
      prochainEssai: this.base.prete ? null : (this.base.prochainEssai || null) };
  }
}

module.exports = { MemoireServeur, tailleDe, contenuDe, TABLE };
