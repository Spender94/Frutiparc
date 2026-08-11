/*
 * Miniwave 2 — la fiche du joueur, et le pont avec Frutiparc.
 *
 * Le serveur sait DÉJÀ lire la sauvegarde de Miniwave : extractGameItemsFromSlot
 * en tire les pictos, et computeConsecration le pourcentage de consécration. On
 * n'a donc rien à inventer côté serveur — il suffit d'écrire le slot 0 dans le
 * format d'origine, et tout suit : les mêmes pictos que sur le bureau, sur le
 * même compte.
 *
 * Ce que le serveur en tire :
 *   • $ship[i] vrai            → picto du vaisseau i
 *   • $badsKill[i] ≥ 200       → picto de l'espèce i (deux cents fruits abattus)
 *   • $arcade.$bestLevel > 0   → picto « arcade »
 *   • $cons.$bonus[i] ≥ 100    → picto de la mission i (i ≤ 4)
 *   • $cons.$letter ≥ 100      → picto « lettre »
 *   • $shop[i] == 0            → picto de l'article acheté (i de 10 à 14)
 *
 * ── Pourquoi du JSON et non le tuyau ──
 *
 * Le SWF du bureau enregistre par une chaîne à sept champs séparés par des
 * barres (parseMiniwavePipe côté serveur). Sept champs, pas plus : le solde de
 * crédits, les modes achetés, les records d'Endurance et de Letter Invader n'y
 * tiennent pas. Sur le bureau, ils ne survivent que dans le SharedObject de
 * Flash — que Ruffle ne conserve pas d'une session à l'autre. Autrement dit, la
 * boutique du jeu d'origine est aujourd'hui sans mémoire : on achète, et à la
 * partie suivante c'est reparti de zéro.
 *
 * On envoie donc la fiche COMPLÈTE, en JSON. /api/saveFrutiSlot la range telle
 * quelle (la conversion tuyau→JSON ne se déclenche que sur une chaîne à barres)
 * et extractGameItemsFromSlot y lit exactement les mêmes champs qu'avant. Rien
 * n'est perdu, tout est gagné — et pour qu'une partie jouée sur le bureau
 * n'efface pas ce surplus, le serveur regreffe les champs absents du tuyau.
 *
 * ── La règle qui protège tout le reste ──
 *
 * On ne sauvegarde JAMAIS sans avoir chargé. Une fiche neuve écrite par-dessus
 * une vraie ne plante pas, ne rétrécit pas assez pour déclencher le garde-fou
 * des 50 % du serveur, et efface simplement des mois de jeu.
 */
'use strict';

(function () {

const NB_ENNEMIS = 51;
const NB_VAISSEAUX = 6;
const NB_ARTICLES = 20;
const NB_MISSIONS = 8;              // $mode[1] et $cons.$bonus en comptent huit
const VERSION = 0.93;               // Manager.fcVersion

// Les six vaisseaux (inc/heroName.as). Le 0 est offert, les cinq autres
// s'achètent — dans cet ordre, qui est celui de la boutique.
const VAISSEAUX = ['aliquet', 'proto', 'gapatsa', 'namazan', 'sacuro', 'rycher'];

// Les treize grades (Manager.gradeName), gagnés à l'ancienneté et au tableau
// de chasse. Menu.checkPowerUp en fait tout un écran ; ici c'est un titre.
const GRADES = ['Apprenti', 'Aspirant', 'Cornette', 'Pilote', 'Patrouilleur',
  'Chef d\'escadre', 'Sergent', 'Major', 'SousLieutenant', 'Lieutenant',
  'Capitaine', 'Commandant', 'Colonel'];

// ── La boutique (page/Shop.as + box/ShopSlot.as) ──
// `debloque` dit ce que l'achat ouvre :
//   ship:n     → $ship[n]           (et le picto $ship0n)
//   mission:n  → $mode[1][n]        (une mission de plus au menu BONUS)
//   special:n  → $mode[2][n]        (0 = Letter Invader, 1 = Endurance)
//   picto:id   → un picto Frutiparc, via $shop[id] == 0
// Les prix sont ceux du jeu, au crédit près.
const BOUTIQUE = [
  { id: 0, nom: 'Proto', prix: 80, debloque: { ship: 1 } },
  { id: 1, nom: 'Gapatsa', prix: 140, debloque: { ship: 2 } },
  { id: 2, nom: 'Namazan', prix: 160, debloque: { ship: 3 } },
  { id: 3, nom: 'Sacuro', prix: 320, debloque: { ship: 4 } },
  { id: 4, nom: 'Rycher', prix: 680, debloque: { ship: 5 } },
  { id: 5, nom: 'Mission 1', prix: 10, debloque: { mission: 0 } },
  { id: 6, nom: 'Mission 2', prix: 50, debloque: { mission: 1 } },
  { id: 7, nom: 'Mission 3', prix: 80, debloque: { mission: 2 } },
  { id: 8, nom: 'Letter Invader', prix: 120, debloque: { special: 0 } },
  { id: 9, nom: 'Endurance', prix: 120, debloque: { special: 1 } },
  { id: 10, nom: 'Smiley 1', prix: 30, debloque: { picto: '$smiley_love' } },
  { id: 11, nom: 'Smiley 2', prix: 220, debloque: { picto: '$smiley_laugh' } },
  { id: 12, nom: 'Smiley 3', prix: 480, debloque: { picto: '$smiley_twirl' } },
  { id: 13, nom: 'Fond d\'écran 1', prix: 1600, debloque: { picto: '$wpMinistar' } },
  { id: 14, nom: 'Fond d\'écran 2', prix: 2400, debloque: { picto: '$wpNostromo' } },
  { id: 15, nom: 'Mission 4', prix: 200, debloque: { mission: 3 } },
  { id: 16, nom: 'Mission 5', prix: 400, debloque: { mission: 4 } },
  // L'article 17 (« Mission 6 ») ouvrirait $mode[1][5], une mission restée vide
  // dans le jeu d'origine (« level bonus no6 »). Le vendre reviendrait à faire
  // payer un menu qui ne mène nulle part : on ne le propose pas.
];

// Manager.formatFruticard, au champ près. Les clés portent leur « $ » : c'est
// la forme que le serveur stocke et relit, aucune traduction en route.
function carteNeuve() {
  return {
    $vs: VERSION,
    $ship: [1, 0, 0, 0, 0, 0],
    // $mode : [arcade, missions[8], spéciaux[3], boutique, options]
    $mode: [1, new Array(NB_MISSIONS).fill(0), [0, 0, 0], 1, 1],
    $arcade: { $bestScore: 0, $bestLevel: 0 },
    $letter: 0,
    $survival: 0,
    $time: 0,
    $bonus: new Array(NB_MISSIONS).fill(0),
    $cons: { $main: 0, $bonus: new Array(NB_MISSIONS).fill(0), $letter: 0 },
    $badsKill: new Array(NB_ENNEMIS).fill(0),
    $saucerKill: 0,
    $credit: 0,
    // 1 = à vendre, 0 = acheté. La convention est l'inverse de celle de $ship —
    // s'y tromper offrirait les vingt articles d'un coup.
    $shop: new Array(NB_ARTICLES).fill(1),
    $lvl: 0,
    $stats: { $play: { $main: 0, $mission: 0, $survival: 0, $letter: 0 }, $buy: [] },
  };
}

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function tableau(v, n, defaut) {
  const a = new Array(n).fill(defaut);
  if (Array.isArray(v)) for (let i = 0; i < n; i++) if (v[i] !== undefined) a[i] = v[i];
  return a;
}

// Complète une fiche partielle plutôt que de la refuser : une carte écrite par
// le SWF du bureau n'a que sept champs, et il faut pouvoir jouer avec.
function normaliser(o) {
  const c = carteNeuve();
  if (!o || typeof o !== 'object') return c;
  c.$ship = tableau(o.$ship, NB_VAISSEAUX, 0).map((x) => (x ? 1 : 0));
  c.$ship[0] = 1;                                   // le vaisseau de départ est acquis
  if (Array.isArray(o.$mode)) {
    c.$mode[0] = o.$mode[0] === undefined ? 1 : o.$mode[0];
    c.$mode[1] = tableau(o.$mode[1], NB_MISSIONS, 0).map((x) => (x ? 1 : 0));
    c.$mode[2] = tableau(o.$mode[2], 3, 0).map((x) => (x ? 1 : 0));
    c.$mode[3] = o.$mode[3] === undefined ? 1 : o.$mode[3];
    c.$mode[4] = o.$mode[4] === undefined ? 1 : o.$mode[4];
  }
  if (o.$arcade) {
    c.$arcade.$bestScore = nombre(o.$arcade.$bestScore);
    c.$arcade.$bestLevel = nombre(o.$arcade.$bestLevel);
  }
  c.$letter = nombre(o.$letter);
  c.$survival = nombre(o.$survival);
  c.$time = nombre(o.$time);
  c.$bonus = tableau(o.$bonus, NB_MISSIONS, 0).map(nombre);
  if (o.$cons) {
    c.$cons.$main = nombre(o.$cons.$main);
    c.$cons.$bonus = tableau(o.$cons.$bonus, NB_MISSIONS, 0).map(nombre);
    c.$cons.$letter = nombre(o.$cons.$letter);
  }
  c.$badsKill = tableau(o.$badsKill, NB_ENNEMIS, 0).map(nombre);
  c.$saucerKill = nombre(o.$saucerKill);
  c.$credit = Math.max(0, nombre(o.$credit));
  c.$shop = tableau(o.$shop, NB_ARTICLES, 1).map((x) => (x ? 1 : 0));
  c.$lvl = nombre(o.$lvl);
  if (o.$stats && o.$stats.$play) {
    for (const k of ['$main', '$mission', '$survival', '$letter']) {
      c.$stats.$play[k] = nombre(o.$stats.$play[k]);
    }
  }
  if (o.$stats && Array.isArray(o.$stats.$buy)) c.$stats.$buy = o.$stats.$buy.slice();
  if (Number(o.$vs)) c.$vs = Number(o.$vs);
  return c;
}

// Le format du bureau, gardé pour ce qu'il vaut : c'est lui que le SWF écrit,
// et savoir le produire prouve qu'on parle bien la même langue que lui.
function versTuyau(c) {
  return [
    c.$ship.map((x) => (x ? 'true' : 'false')).join(','),
    c.$badsKill.join(','),
    String(c.$arcade.$bestLevel),
    c.$cons.$bonus.join(','),
    String(c.$cons.$letter),
    c.$shop.join(','),
    String(c.$vs),
    // Huitième champ, ajouté après coup : sans lui, une partie d'arcade jouée
    // au bureau ne pouvait jamais entrer au classement du jour — le tuyau
    // portait le NIVEAU atteint, jamais les points.
    String(c.$arcade.$bestScore),
  ].join('|');
}

// /api/loadFrutiSlots répond en LoadVars — le format de Flash, pas du JSON :
//   ok=1&slot0=%7B%22%24ship%22%3A…&slot1=…
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

// ── Ce qu'une partie ajoute à la fiche ──
// `jeu` est le relevé de fin de partie du moteur, augmenté du mode joué.
// Ce qui s'accumule s'accumule (les éliminations, les crédits, le nombre de
// parties) ; ce qui est un record ne redescend pas.
function fusionner(carte, jeu) {
  const c = JSON.parse(JSON.stringify(carte));
  jeu = jeu || {};
  const score = nombre(jeu.score);
  const niveau = nombre(jeu.level);

  for (const [type, n] of Object.entries(jeu.badsKill || {})) {
    const i = Number(type);
    if (Number.isInteger(i) && i >= 0 && i < NB_ENNEMIS) c.$badsKill[i] += nombre(n);
  }
  c.$saucerKill += nombre(jeu.saucerKill);
  c.$credit += nombre(jeu.credits);

  const mode = jeu.mode || 'arcade';
  switch (mode) {
    case 'arcade':
      c.$stats.$play.$main++;
      c.$cons.$main = Math.max(c.$cons.$main, nombre(jeu.cons));
      c.$arcade.$bestScore = Math.max(c.$arcade.$bestScore, score);
      // `level` est un index ; le niveau ATTEINT est le suivant. Un joueur qui
      // meurt au premier niveau a donc bien 1, ce qui suffit au picto arcade.
      c.$arcade.$bestLevel = Math.max(c.$arcade.$bestLevel, niveau + 1);
      break;
    case 'mission': {
      c.$stats.$play.$mission++;
      const n = nombre(jeu.missionNum);
      if (n >= 0 && n < NB_MISSIONS) {
        const avant = c.$cons.$bonus[n];
        const cons = nombre(jeu.cons);
        if (cons > avant) {
          c.$cons.$bonus[n] = cons;
          c.$bonus[n] = Math.max(c.$bonus[n], score);
          // Mission.getEndMsg : la prime ne tombe qu'à la première mission
          // bouclée entièrement.
          if (cons >= 100 && avant < 100) c.$credit += nombre(jeu.prime);
        }
      }
      break;
    }
    case 'survival':
      c.$stats.$play.$survival++;
      c.$survival = Math.max(c.$survival, score);
      break;
    case 'letter':
      c.$stats.$play.$letter++;
      c.$letter = Math.max(c.$letter, score);
      c.$cons.$letter = Math.max(c.$cons.$letter, nombre(jeu.cons));
      break;
    default:
      break;
  }
  return c;
}

// ── La boutique ──
const article = (id) => BOUTIQUE.find((a) => a.id === id) || null;

function estAchete(carte, id) { return carte.$shop[id] === 0; }

// ShopSlot.select : on paie, on marque l'article vendu, et on ouvre ce qu'il
// ouvre. Renvoie ce qui s'est passé plutôt que de jeter — l'appelant en fait un
// message, et le refus fait partie du jeu (le « beep wrong » de l'original).
function acheter(carte, id) {
  const a = article(id);
  if (!a) return { ok: false, raison: 'inconnu' };
  if (estAchete(carte, id)) return { ok: false, raison: 'deja' };
  if (carte.$credit < a.prix) return { ok: false, raison: 'credit', manque: a.prix - carte.$credit };

  carte.$credit -= a.prix;
  carte.$shop[id] = 0;
  const d = a.debloque;
  if (d.ship !== undefined) carte.$ship[d.ship] = 1;
  if (d.mission !== undefined) carte.$mode[1][d.mission] = 1;
  if (d.special !== undefined) carte.$mode[2][d.special] = 1;
  // Le picto d'un article est accordé par le serveur, à la lecture de $shop.
  const parties = carte.$stats.$play;
  carte.$stats.$buy.push({ id, g: parties.$main + parties.$mission + parties.$survival + parties.$letter });
  return { ok: true, article: a };
}

// Menu.checkPowerUp : le grade, tiré du tableau de chasse pondéré par
// l'avancement. La formule est celle du jeu, à la ligne près.
function grade(carte) {
  const moteur = (typeof module !== 'undefined' && module.exports)
    ? require('./engine.js')
    : (typeof window !== 'undefined' ? window.MiniwaveEngine : null);
  const valeurs = moteur ? moteur.ENNEMIS : null;
  if (!valeurs) return 0;
  const max = carte.$cons.$bonus.length;
  let c = carte.$cons.$main * 0.1 * (10 - max);
  for (let i = 0; i < max; i++) c += carte.$cons.$bonus[i] * 0.1;
  let score = 0;
  for (let i = 0; i < carte.$badsKill.length; i++) {
    score += (valeurs[i] ? valeurs[i].value : 0) * carte.$badsKill[i];
  }
  score = Math.round(score * c / 10000);
  return Math.min(Math.round(Math.pow(score, 0.2)), GRADES.length - 1);
}

// Ce que le menu a le droit de proposer.
function modesOuverts(carte) {
  return {
    arcade: true,
    missions: carte.$mode[1].slice(),
    letter: !!carte.$mode[2][0],
    survival: !!carte.$mode[2][1],
  };
}

// Ce que la partie vient d'ouvrir : les seuils franchis entre les deux fiches.
// Même règle que extractGameItemsFromSlot côté serveur — on ne fait que la
// relire, pour l'annoncer au joueur avant que le serveur ne la confirme.
function nouveauxPictos(avant, apres) {
  const l = [];
  for (let i = 0; i < NB_ENNEMIS; i++) {
    if (apres.$badsKill[i] >= 200 && avant.$badsKill[i] < 200) l.push({ genre: 'bads', type: i });
  }
  if (apres.$arcade.$bestLevel > 0 && avant.$arcade.$bestLevel === 0) l.push({ genre: 'arcade' });
  for (let i = 0; i < 5; i++) {
    if (apres.$cons.$bonus[i] >= 100 && avant.$cons.$bonus[i] < 100) l.push({ genre: 'mission', num: i });
  }
  if (apres.$cons.$letter >= 100 && avant.$cons.$letter < 100) l.push({ genre: 'letter' });
  for (let i = 0; i < NB_ARTICLES; i++) {
    if (apres.$shop[i] === 0 && avant.$shop[i] !== 0) {
      const a = article(i);
      if (a && a.debloque.picto) l.push({ genre: 'article', num: i, nom: a.nom });
      if (a && a.debloque.ship !== undefined) l.push({ genre: 'vaisseau', num: a.debloque.ship });
    }
  }
  return l;
}

class Plateforme {
  constructor(sid) {
    this.sid = sid || '';
    this.carte = carteNeuve();
    // Tant que la fiche du serveur n'est pas là, on refuse d'enregistrer : on
    // n'a rien à quoi fusionner, et écrire écraserait tout.
    this.charge = false;
    // Le PSEUDO, pour le salut du panneau d'accueil (box/InfoMain lit
    // `client.getUser()`). Il n'est pas dans la fiche de jeu : on va le
    // chercher à part, et le menu s'en passe tant qu'il n'est pas là plutôt que
    // d'écrire « undefined » comme le faisait le SWF.
    this.pseudo = '';
  }

  // Le nom du joueur, une fois, sans bloquer le chargement du jeu.
  chargerPseudo() {
    if (!this.sid) return Promise.resolve('');
    return fetch('/api/light/profile?sid=' + encodeURIComponent(this.sid), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { this.pseudo = (d && d.user) || ''; return this.pseudo; })
      .catch(() => '');
  }

  // Sans session (le jeu ouvert hors du site), on joue sans rien enregistrer.
  charger() {
    if (!this.sid) return Promise.resolve(this.carte);
    return fetch('/api/loadFrutiSlots?sid=' + encodeURIComponent(this.sid) + '&game=miniwave',
      { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((txt) => {
        const brut = lireLoadVars(txt, '0');
        // Pas de slot ⇒ compte neuf : on part de la fiche vierge, et on a bien
        // le droit d'enregistrer (il n'y a rien à écraser).
        let o = null;
        if (brut) { try { o = JSON.parse(brut); } catch (e) { o = null; } }
        this.carte = normaliser(o);
        this.charge = true;
        return this.carte;
      })
      .catch(() => this.carte);        // charge reste faux : on ne sauvera pas
  }

  // Envoie la fiche telle quelle. Renvoie ce qui a été enregistré et ce que
  // l'opération vient d'ouvrir, pour que l'écran puisse l'annoncer.
  ecrire(avant) {
    const gagnes = nouveauxPictos(avant, this.carte);
    if (!this.sid || !this.charge) return Promise.resolve({ enregistre: false, carte: this.carte, gagnes });
    return fetch('/api/saveFrutiSlot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sid: this.sid, game: 'miniwave', slotId: '0', data: JSON.stringify(this.carte),
      }),
    })
      .then((r) => ({ enregistre: r.ok, carte: this.carte, gagnes }))
      .catch(() => ({ enregistre: false, carte: this.carte, gagnes }));
  }

  /**
   * Le score d'une partie d'ARCADE part au classement du jour.
   *
   * Le challenge quotidien veut le meilleur score DU JOUR, pas le record
   * personnel : on envoie donc à chaque fin de partie d'arcade, et c'est le
   * serveur qui garde le meilleur. Le NIVEAU atteint voyage dans la donnée —
   * il s'affiche à côté des points, et il sert au serveur à juger la
   * cohérence du score.
   *
   * Sans session (le jeu ouvert hors du site), il n'y a personne à classer.
   *
   * @param {number} score
   * @param {number} niveau  le niveau ATTEINT (1 à 200)
   */
  envoyerScore(score, niveau) {
    const n = Math.max(0, Math.round(Number(score) || 0));
    if (!this.sid || n <= 0) return Promise.resolve({ ok: false });
    const lvl = Math.max(1, Math.min(200, Math.round(Number(niveau) || 1)));
    const p = new URLSearchParams({
      sid: this.sid, game: 'miniwave', m: '0', score: String(n), data: String(lvl),
    });
    return fetch('/api/saveScore?' + p.toString())
      .then((r) => r.json())
      .catch(() => ({ ok: false }));
  }

  // Appelé en fin de partie.
  enregistrer(jeu) {
    const avant = this.carte;
    this.carte = fusionner(avant, jeu);
    return this.ecrire(avant);
  }

  // Appelé depuis la boutique. L'achat n'a lieu que s'il aboutit.
  acheter(id) {
    const avant = JSON.parse(JSON.stringify(this.carte));
    const r = acheter(this.carte, id);
    if (!r.ok) return Promise.resolve(Object.assign({ enregistre: false }, r));
    return this.ecrire(avant).then((e) => Object.assign({}, r, e));
  }

  // Les espèces dont on approche des 200 éliminations : de quoi montrer au
  // joueur ce qu'il est en train de débloquer.
  progression() {
    const acquis = [], encours = [];
    this.carte.$badsKill.forEach((n, i) => {
      if (n >= 200) acquis.push(i);
      else if (n > 0) encours.push({ type: i, n });
    });
    encours.sort((a, b) => b.n - a.n);
    return { acquis, encours, bestLevel: this.carte.$arcade.$bestLevel, credit: this.carte.$credit };
  }
}

const API = {
  Plateforme, carteNeuve, normaliser, versTuyau, lireLoadVars, fusionner,
  acheter, estAchete, article, grade, modesOuverts, nouveauxPictos,
  BOUTIQUE, VAISSEAUX, GRADES, NB_ENNEMIS, NB_VAISSEAUX, NB_ARTICLES, NB_MISSIONS, VERSION,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else window.MiniwavePlateforme = API;

})();
