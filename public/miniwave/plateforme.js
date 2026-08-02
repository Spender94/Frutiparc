/*
 * Miniwave 2 — le pont avec Frutiparc.
 *
 * Le serveur sait DÉJÀ lire la sauvegarde de Miniwave : extractGameItemsFromSlot
 * en tire les pictos, et computeConsecration le pourcentage de consécration. On
 * n'a donc rien à inventer — il suffit d'écrire le slot 0 dans le format
 * d'origine, et tout suit : les mêmes pictos que sur le bureau, sur le même
 * compte, sans que le serveur sache que la partie a été jouée en JavaScript.
 *
 * Le format est une chaîne à sept champs séparés par des barres verticales
 * (parseMiniwavePipe, côté serveur) :
 *
 *   $ship | $badsKill | $arcade.$bestLevel | $cons.$bonus | $cons.$letter | $shop | $vs
 *
 * Ce que le serveur en tire :
 *   • $ship[i] vrai            → picto du vaisseau i
 *   • $badsKill[i] ≥ 200       → picto de l'espèce i (deux cents fruits abattus)
 *   • $bestLevel > 0           → picto « arcade »
 *   • $cons.$bonus[i] ≥ 100    → picto de la mission i (i ≤ 4)
 *   • $cons.$letter ≥ 100      → picto « lettre »
 *   • $shop[i] == 0            → picto de l'article acheté (i de 10 à 14)
 *
 * Trois précautions :
 *
 *   • on FUSIONNE avec ce qui est déjà enregistré. Les éliminations
 *     s'accumulent d'une partie à l'autre — c'est le seul moyen d'atteindre
 *     200 — et le meilleur niveau ne redescend jamais ;
 *   • on ne touche PAS aux champs des modes qu'on ne joue pas encore (missions,
 *     lettres, boutique, vaisseaux achetés). Les écraser effacerait la
 *     progression faite sur le bureau ;
 *   • en cas de chargement raté, on n'enregistre rien. Écrire une fiche neuve
 *     par-dessus une vraie, c'est perdre des mois de jeu. Le garde-fou du
 *     serveur refuse déjà les fiches beaucoup plus courtes que la précédente,
 *     mais une fiche neuve fait la même taille qu'une pleine — seul ce
 *     verrou-ci protège vraiment.
 */
'use strict';

(function () {

const NB_ENNEMIS = 51;
const NB_VAISSEAUX = 6;
const NB_ARTICLES = 20;
const VERSION = 0.93;             // Manager.fcVersion : la version de la fiche

// Une sauvegarde neuve, telle que Manager.formatFruticard l'écrit : le vaisseau
// de départ acquis, rien d'autre, et toute la boutique encore à vendre (1 =
// disponible, 0 = acheté — la convention est inversée par rapport à $ship).
function slotNeuf() {
  return {
    ship: [1, 0, 0, 0, 0, 0],
    badsKill: new Array(NB_ENNEMIS).fill(0),
    bestLevel: 0,
    consBonus: [0, 0, 0, 0, 0, 0, 0, 0],
    consLetter: 0,
    shop: new Array(NB_ARTICLES).fill(1),
    vs: VERSION,
  };
}

// Le slot stocké est du JSON aux noms préfixés ($ship, $badsKill…) : c'est la
// sortie de parseMiniwavePipe. On le ramène à notre forme, en complétant ce qui
// manque plutôt qu'en refusant une fiche partielle.
function depuisServeur(o) {
  const s = slotNeuf();
  if (!o || typeof o !== 'object') return s;
  if (Array.isArray(o.$ship)) {
    for (let i = 0; i < NB_VAISSEAUX; i++) s.ship[i] = o.$ship[i] ? 1 : 0;
    s.ship[0] = 1;                                    // le vaisseau de départ est toujours acquis
  }
  if (Array.isArray(o.$badsKill)) {
    for (let i = 0; i < NB_ENNEMIS; i++) s.badsKill[i] = Number(o.$badsKill[i]) || 0;
  }
  if (o.$arcade && Number(o.$arcade.$bestLevel) > 0) s.bestLevel = Number(o.$arcade.$bestLevel);
  if (o.$cons) {
    if (Array.isArray(o.$cons.$bonus) && o.$cons.$bonus.length) {
      s.consBonus = o.$cons.$bonus.map((x) => Number(x) || 0);
    }
    s.consLetter = Number(o.$cons.$letter) || 0;
  }
  if (Array.isArray(o.$shop) && o.$shop.length) s.shop = o.$shop.map((x) => (x ? 1 : 0));
  if (Number(o.$vs)) s.vs = Number(o.$vs);
  return s;
}

function versTuyau(s) {
  return [
    s.ship.map((x) => (x ? 'true' : 'false')).join(','),
    s.badsKill.join(','),
    String(s.bestLevel),
    s.consBonus.join(','),
    String(s.consLetter),
    s.shop.join(','),
    String(s.vs),
  ].join('|');
}

// /api/loadFrutiSlots répond en LoadVars — le format de Flash, pas du JSON :
//   ok=1&slot0=%7B%22%24ship%22%3A…&slot1=…
// On en tire le slot demandé. Une réponse vide (compte neuf) renvoie null, ce
// que l'appelant distingue d'un échec réseau.
function lireLoadVars(texte, slot) {
  const cible = 'slot' + (slot === undefined ? '0' : slot);
  for (const morceau of String(texte).split('&')) {
    const eq = morceau.indexOf('=');
    if (eq < 0) continue;
    if (morceau.slice(0, eq) !== cible) continue;
    try { return decodeURIComponent(morceau.slice(eq + 1).replace(/\+/g, ' ')); } catch (e) { return null; }
  }
  return null;
}

// Ce qu'une partie ajoute : les éliminations s'accumulent, le meilleur niveau
// monte. Le reste est laissé tel quel — c'est la progression des autres modes.
function fusionner(s, jeu) {
  const f = {
    ship: s.ship.slice(),
    badsKill: s.badsKill.slice(),
    bestLevel: s.bestLevel,
    consBonus: s.consBonus.slice(),
    consLetter: s.consLetter,
    shop: s.shop.slice(),
    vs: s.vs,
  };
  for (const [type, n] of Object.entries((jeu && jeu.badsKill) || {})) {
    const i = Number(type);
    if (Number.isInteger(i) && i >= 0 && i < NB_ENNEMIS) f.badsKill[i] += Number(n) || 0;
  }
  // `level` est un index ; le niveau ATTEINT est le suivant. Un joueur qui meurt
  // au premier niveau a donc bien 1, ce qui suffit à décrocher le picto arcade.
  f.bestLevel = Math.max(f.bestLevel, (Number(jeu && jeu.level) || 0) + 1);
  return f;
}

class Plateforme {
  constructor(sid) {
    this.sid = sid || '';
    this.slot = slotNeuf();
    // Tant que la fiche du serveur n'est pas là, on refuse d'enregistrer : on
    // n'a rien à quoi fusionner, et écrire écraserait tout.
    this.charge = false;
  }

  // Sans session (le jeu ouvert hors du site), on joue sans rien enregistrer.
  charger() {
    if (!this.sid) return Promise.resolve(this.slot);
    return fetch('/api/loadFrutiSlots?sid=' + encodeURIComponent(this.sid) + '&game=miniwave',
      { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((txt) => {
        const brut = lireLoadVars(txt, '0');
        // Pas de slot ⇒ compte neuf : on part de la fiche vierge, et on a bien
        // le droit d'enregistrer (il n'y a rien à écraser).
        let o = null;
        if (brut) { try { o = JSON.parse(brut); } catch (e) { o = null; } }
        this.slot = depuisServeur(o);
        this.charge = true;
        return this.slot;
      })
      .catch(() => this.slot);          // charge reste faux : on ne sauvera pas
  }

  // Appelé en fin de partie. Renvoie une promesse résolue avec ce qui a été
  // enregistré — et avec les pictos que cette partie vient d'ouvrir, pour que
  // l'écran de fin puisse les annoncer.
  enregistrer(jeu) {
    const avant = this.slot;
    const fusion = fusionner(avant, jeu);
    const gagnes = nouveauxPictos(avant, fusion);
    if (!this.sid || !this.charge) {
      return Promise.resolve({ enregistre: false, slot: fusion, gagnes });
    }
    this.slot = fusion;
    return fetch('/api/saveFrutiSlot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: this.sid, game: 'miniwave', slotId: '0', data: versTuyau(fusion) }),
    })
      .then((r) => ({ enregistre: r.ok, slot: fusion, gagnes }))
      .catch(() => ({ enregistre: false, slot: fusion, gagnes }));
  }

  // Les espèces dont on approche des 200 éliminations : de quoi montrer au
  // joueur ce qu'il est en train de débloquer.
  progression() {
    const acquis = [], encours = [];
    this.slot.badsKill.forEach((n, i) => {
      if (n >= 200) acquis.push(i);
      else if (n > 0) encours.push({ type: i, n });
    });
    encours.sort((a, b) => b.n - a.n);
    return { acquis, encours, bestLevel: this.slot.bestLevel };
  }
}

// Ce que la partie vient d'ouvrir : les seuils franchis entre les deux fiches.
// Même règle que extractGameItemsFromSlot côté serveur — on ne fait que la
// relire, pour l'annoncer au joueur avant que le serveur ne la confirme.
function nouveauxPictos(avant, apres) {
  const l = [];
  for (let i = 0; i < NB_ENNEMIS; i++) {
    if (apres.badsKill[i] >= 200 && avant.badsKill[i] < 200) l.push({ genre: 'bads', type: i });
  }
  if (apres.bestLevel > 0 && avant.bestLevel === 0) l.push({ genre: 'arcade' });
  return l;
}

window.MiniwavePlateforme = {
  Plateforme, slotNeuf, depuisServeur, versTuyau, fusionner, lireLoadVars, nouveauxPictos,
  NB_ENNEMIS, NB_VAISSEAUX, VERSION,
};

})();
