/*
 * JamaJama — le pont avec Frutiparc.
 *
 * Le SWF déployé jouait HORS LIGNE (extension.swf remplaçait sa couche réseau
 * par un SharedObject local) : aucun score ne partait, aucun picto ne tombait.
 * Ici, le serveur reprend son rôle de 2005 : il connaît l'aventure, les
 * options, les statuts de tournoi, et il REJOUE chaque partie envoyée (la
 * liste des mouvements — le SaveScore d'origine transportait déjà le replay)
 * avant d'inscrire quoi que ce soit.
 *
 * Tout tient dans /api/jamajama/donnees au démarrage, puis trois envois :
 * le score (avec replay), l'aventure (le format « N[l,l;… » du jeu), les
 * options (« 1:1:1:AvTdS »).
 */
'use strict';

(function () {
  const R = window.JamaRegles;

  /**
   * La sauvegarde d'aventure, au format de chaîne du jeu d'origine :
   * « N[l,l,…;N[…; » — l'indice du pack, un crochet, les niveaux finis,
   * un point-virgule. Le parseur d'origine lisait l'indice par parseInt
   * puis coupait à substring(2) : un pack au-delà de 9 se lirait mal —
   * il y en a 7, la coquille dort, et on garde le format tel quel.
   */
  function AventureData(chaine) {
    this._packs = {};
    for (const morceau of String(chaine || '').split(';')) {
      if (!morceau) continue;
      const pack = parseInt(morceau, 10);
      if (!(pack >= 0)) continue;
      const liste = morceau.substring(String(pack).length + 1);
      const faits = {};
      for (const n of liste.split(',')) {
        const i = parseInt(n, 10);
        if (i >= 0) faits[i] = true;
      }
      this._packs[pack] = faits;
    }
    this._modifie = false;
  }
  AventureData.prototype.hasCompletedLevel = function (pack, niveau) {
    return !!(this._packs[pack] && this._packs[pack][niveau]);
  };
  AventureData.prototype.setLevelCompleted = function (pack, niveau) {
    if (this.hasCompletedLevel(pack, niveau)) return;
    if (!this._packs[pack]) this._packs[pack] = {};
    this._packs[pack][niveau] = true;
    this._modifie = true;
  };
  AventureData.prototype.modified = function () { return this._modifie; };
  AventureData.prototype.dump = function () {
    let s = '';
    for (const pack of Object.keys(this._packs).map(Number).sort((a, b) => a - b)) {
      const faits = Object.keys(this._packs[pack]).map(Number).sort((a, b) => a - b);
      if (!faits.length) continue;
      s += pack + '[' + faits.join(',') + ';';
    }
    return s;
  };

  /** Les options du jeu : fondu d'ouverture, fondu de fin, astuce Echap,
   *  ordre des listes — la chaîne de Consts.setParams. */
  function Options(chaine) {
    this.showBeginFade = true;
    this.showVictoFade = true;
    this.showInfoEsc = true;
    this.listOrder = 'AvTdS';
    const parts = String(chaine || '').split(':');
    if (parts.length >= 3) {
      this.listOrder = parts.pop() || 'AvTdS';
      this.showBeginFade = parts[0] === '1';
      this.showVictoFade = parts[1] === '1';
      if (parts[2] != null) this.showInfoEsc = parts[2] === '1';
    }
  }
  Options.prototype.dump = function () {
    return (this.showBeginFade ? 1 : 0) + ':' + (this.showVictoFade ? 1 : 0)
      + ':' + (this.showInfoEsc ? 1 : 0) + ':' + this.listOrder;
  };

  class Plateforme {
    constructor(sid) {
      this.sid = sid || '';
      this.user = '';
      this.packs = [];
      this.tournoi = [];
      this.aventure = new AventureData('');
      this.options = new Options('');
      this.pret = false;
    }
    charger() {
      if (!this.sid) {
        // Hors du site : les tutoriels gravés dans le SWF, sans enregistrement.
        this.packs = [{ titre: 'Tutoriaux', total: -1, niveaux: [] }];
        this.pret = true;
        return Promise.resolve(this);
      }
      return fetch('/api/jamajama/donnees?sid=' + encodeURIComponent(this.sid),
        { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (!d.ok) throw new Error(d.error || 'donnees');
          this.user = d.user;
          this.packs = d.packs;
          this.tournoi = d.tournoi;
          this.aventure = new AventureData(d.aventure);
          this.options = new Options(d.options);
          this.pret = true;
          return this;
        });
    }
    sauverAventure() {
      if (!this.sid || !this.aventure.modified()) return Promise.resolve({ ok: true });
      const dt = this.aventure.dump();
      return fetch('/api/jamajama/aventure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: this.sid, dt }),
      }).then((r) => r.json()).catch(() => ({ ok: false }));
    }
    sauverOptions() {
      if (!this.sid) return Promise.resolve({ ok: true });
      return fetch('/api/jamajama/options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid: this.sid, p: this.options.dump() }),
      }).then((r) => r.json()).catch(() => ({ ok: false }));
    }
    /**
     * La partie finie part au serveur avec son replay ; lui seul juge.
     * source : {type:'aventure', pack, niveau} ou {type:'tournoi', id}.
     */
    envoyerScore(source, mouvements) {
      if (!this.sid) return Promise.resolve({ ok: false, horsLigne: true });
      const corps = { sid: this.sid, source: source.type, mouvements };
      if (source.type === 'tournoi') corps.id = source.id;
      else { corps.pack = source.pack; corps.niveau = source.niveau; }
      return fetch('/api/jamajama/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      }).then((r) => r.json())
        .then((d) => {
          // Les statuts du tournoi vivent côté serveur : on garde l'écho
          // pour que la liste se rafraîchisse sans recharger.
          if (d && d.ok && source.type === 'tournoi' && d.statut) {
            const t = this.tournoi.find((x) => x.id === source.id);
            if (t) t.moi = d.statut;
          }
          return d;
        })
        .catch(() => ({ ok: false }));
    }
    niveauAventure(pack, indice) {
      const p = this.packs[pack];
      const n = p && p.niveaux[indice];
      return n ? R.Level.depuisChaine(n.contenu) : null;
    }

    /**
     * Les packs OUVERTS, dans l'ordre — la règle d'AdventureSetLevels.
     *
     * Le pack courant est toujours de la partie ; on passe au suivant si son
     * `total` est négatif (« le suivant est toujours accessible ») ou si l'on
     * a fini le niveau total-1. Le premier pack qui bloque ferme la liste,
     * de sorte que les indices restent ceux de levels.xml.
     */
    packsOuverts() {
      const ouverts = [];
      for (let i = 0; i < this.packs.length; i++) {
        ouverts.push(this.packs[i]);
        const total = Number(this.packs[i].total);
        if (total >= 0 && !this.aventure.hasCompletedLevel(i, total - 1)) break;
      }
      return ouverts;
    }
  }

  window.JamaPlateforme = { Plateforme, AventureData, Options };
})();
