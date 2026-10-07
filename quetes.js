'use strict';
/*
 * LES QUÊTES DE GROMELIN — le module pur.
 *
 * Chaque lundi à minuit (heure de Paris), Gromelin tire cinq quêtes dans un
 * catalogue : deux faciles, deux moyennes, une difficile. Les mêmes pour tout
 * le monde — on peut en parler entre Frutiz. Une quête faite rapporte des
 * kikooz selon sa difficulté (5, 10, 20 par défaut), versés sur-le-champ. Une
 * quête non finie le dimanche à minuit est perdue.
 *
 * Pas de base, pas d'horloge, pas d'utilisateurs ici : on décrit le catalogue,
 * on tire une semaine, on fait avancer une quête à partir d'un ÉVÉNEMENT, et
 * on dit où elle en est. server.js écoute le parc, range l'avancement en base
 * et paie.
 *
 * LES ÉVÉNEMENTS que le serveur pousse ici, tels qu'il les voit :
 *   { type: 'score',  rk, v, challenge }  un score classé (persistScore) ;
 *                                         `challenge` : un classement du jour
 *   { type: 'partie', jeu }               une partie classée (noterPartie)
 *   { type: 'action', action }            pari, chatMsg, forumPost, forumTopic,
 *                                         kiloute (la Question à 60 kikooz),
 *                                         quiz (un quiz de MikeHorny), medaille
 *   { type: 'mode',   jeu, mode, v, record }  un résultat de mode de jeu hors
 *                                         classement, déclaré par le jeu light
 *                                         (les épreuves de Kaluga)
 *
 * LES TYPES DE QUÊTE et ce qu'ils retiennent de la semaine (`etat`) :
 *   score   { rk, seuil, inverse }   m : le meilleur score de la semaine
 *   jours   { n }                    j : les jours joués au Challenge
 *   parties { jeu, n }               c : le nombre de parties
 *   action  { action, n }            c : le nombre d'actions
 *   mode    { jeu, mode, seuil }     m : le meilleur résultat de la semaine
 *   mode    { jeu, mode, n }         c : le nombre de résultats
 *   record  { jeu, mode }            c : 1 dès que le record est battu
 */

const NIVEAUX = ['facile', 'moyenne', 'difficile'];
const NIVEAU_NOM = { facile: 'Facile', moyenne: 'Moyenne', difficile: 'Difficile' };

const REGLAGES_DEFAUT = Object.freeze({
  // 'ferme' : personne · 'testeurs' : les pseudos listés · 'tous' : tout le parc
  ouverture: 'ferme',
  testeurs: [],
  gains: { facile: 5, moyenne: 10, difficile: 20 },
  composition: { facile: 2, moyenne: 2, difficile: 1 },
  // Les retouches de l'admin, quête par quête : { id: { actif, niveau, seuil, n } }
  catalogue: {},
  // Le contrat de la semaine, propre à chaque joueur (voir proposerContrat).
  contrat: { actif: true, fenetre: 28, minJours: 3 },
});

// L'étiquette de couleur posée devant le titre.
const ETIQUETTES = {
  swapou2:    { nom: 'Swapou',      couleur: '#E2862A' },
  snake3:     { nom: 'Frutisnake',  couleur: '#4F9A2A' },
  kaluga:     { nom: 'Kaluga',      couleur: '#3E8FC4' },
  bkiwi:      { nom: 'Burning Kiwi', couleur: '#8C6BB8' },
  mb2:        { nom: 'MotionBall',  couleur: '#2E9E9A' },
  minifever:  { nom: 'Mini-Fever',  couleur: '#D9534F' },
  jamajama:   { nom: 'JamaJama',    couleur: '#C77B1E' },
  minipixiz:  { nom: 'MiniPixiz',   couleur: '#B04CB7' },
  miniwave:   { nom: 'MiniWave',    couleur: '#3C7DD9' },
  grapiz:     { nom: 'Grapiz',      couleur: '#7A9E1C' },
  bandas:     { nom: 'Frutibandas', couleur: '#C0392B' },
  challenge:  { nom: 'Challenge',   couleur: '#5E9E1C' },
  prunostics: { nom: 'Prunostics',  couleur: '#7E5AA8' },
  forum:      { nom: 'Forum',       couleur: '#D9822B' },
  salons:     { nom: 'Salons',      couleur: '#3E8FC4' },
  kiloute:    { nom: 'MikeHorny',   couleur: '#B04CB7' },
};

// Les épreuves de Kaluga, dans l'ordre de leur `trialId` (fruticard.js,
// KALUGA_EPREUVES) — le mode déclaré est `epreuve<trialId>`.
const KALUGA_EPREUVES = ['lancer de vers', 'dexteripomme', "lancer d'écureuil",
  'planter de vers', 'lancer de fourmi', 'plantapomme', 'course de grenouille'];
const KALUGA_NIVEAUX = ['facile', 'standard', 'difficile', 'infernal'];
const KALUGA_DEFIS = ['facile', 'moyen', 'difficile'];
const MB2_COURSES = ['jaune', 'verte', 'rouge', 'orange', 'bleue', 'métal', 'violette'];
const MB2_DONJONS = ['de l’eau', 'du feu', 'de l’air', 'de la terre', 'de la Tourneboule'];
const BKIWI_CIRCUITS = ['Green Hill', 'Banana Derby', 'Terre Grise', 'Solstice', 'Jupiter IV', 'Mistral Kiwi'];
const MINIFEVER_PALIERS = ['facile', 'normal', 'difficile', 'infernal'];
const MINIFEVER_OBJECTIFS = [40, 80, 100, 100];
const JAMAJAMA_AUTEUR = [41, 95, 51, 188, 5, 5, 62];

/*
 * LES MESURES — ce que le parc sait mesurer d'une partie, et rien d'autre :
 * un résultat (points, temps, distance, salles…), jamais un volume.
 *
 * Deux sources :
 *   · `rk` : un score CLASSÉ, que le serveur a reçu et rangé (persistScore).
 *     Le plus sûr. `data` filtre ou `valeur(v, data)` transforme ce qui arrive ;
 *   · `mode` : un résultat de mode HORS classement, déclaré par le jeu light
 *     (POST /api/quetes/mode). Le navigateur le calcule : à récompenser
 *     modestement. `max` en est la borne de vraisemblance.
 *
 * `unite` : points, temps (en `base` : ms ou cs), cm, %, salles, épreuves,
 * victoires, coups, niveau, boss (oui/non). `inverse` : plus petit = meilleur.
 * `titre` : la quête, `{seuil}` y est posé. `reperes` : les chiffres que le
 * JEU LUI-MÊME donne (objectifs de niveau, temps de l'ordinateur) — de quoi
 * régler un seuil sans statistiques. `carte(fiche)` : où lire le record du
 * joueur sur sa fruticard (slot 0), pour le calibrage de l'admin.
 */
const MESURES = {};
function mesure(cle, m) { MESURES[cle] = Object.assign({ cle }, m); }
const sec = (s) => s * 1000;          // ms
const mncs = (m, s) => (m * 60 + s) * 100;   // cs (MotionBall)

// ── Swapou ──
mesure('swapou-challenge', { jeu: 'swapou2', groupe: 'Swapou', nom: 'Challenge : points',
  source: { rk: 'swapou2_classic' }, unite: 'points',
  titre: 'Dépasse {seuil} à Swapou', detail: 'Au Challenge' });
mesure('swapou-classique', { jeu: 'swapou2', groupe: 'Swapou', nom: 'Classique : points',
  source: { mode: 'classique' }, unite: 'points', max: 1e8,
  titre: 'Fais {seuil} en Swapou classique', detail: 'Mode classique',
  carte: (c) => c.$classic_record });
// ── Frutisnake ──
mesure('snake-challenge', { jeu: 'snake3', groupe: 'Frutisnake', nom: 'Challenge : points',
  source: { rk: 'snake3_classic' }, unite: 'points',
  titre: 'Fais {seuil} à Frutisnake', detail: 'Au Challenge' });
// ── Kaluga ──
mesure('kaluga-grappe', { jeu: 'kaluga', groupe: 'Kaluga', nom: 'Challenge (grappe) : points',
  source: { rk: 'kaluga_classic' }, unite: 'points',
  titre: 'Fais {seuil} à Kaluga', detail: 'Au Challenge, avec une grappe de 8 fruits ou plus' });
mesure('kaluga-freestyle', { jeu: 'kaluga', groupe: 'Kaluga', nom: 'Challenge (freestyle) : points',
  source: { rk: 'kaluga_freestyle_classic' }, unite: 'points',
  titre: 'Fais {seuil} à Kaluga en freestyle', detail: 'Au Challenge, sans grande grappe' });
KALUGA_NIVEAUX.forEach((n, i) => {
  mesure('kaluga-chrono' + i, { jeu: 'kaluga', groupe: 'Kaluga', nom: `Chrono ${n} : temps`,
    source: { mode: 'chrono' + i }, unite: 'temps', base: 'ms', inverse: true, max: sec(1800),
    titre: `Finis le Chrono ${n} en moins de {seuil}`, detail: 'Kaluga, mode Olympique',
    reperes: [{ nom: 'Objectif du jeu', v: [60000, 50000, 45000, 42000][i] }],
    carte: (c) => { const l = c.$chrono && c.$chrono.$level && c.$chrono.$level[i]; return Array.isArray(l) && l.length ? l[l.length - 1] : null; } });
  mesure('kaluga-survie' + i, { jeu: 'kaluga', groupe: 'Kaluga', nom: `Survie ${n} : temps tenu`,
    source: { mode: 'survie' + i }, unite: 'temps', base: 'ms', max: sec(3600),
    titre: `Tiens {seuil} en Survie ${n}`, detail: 'Kaluga, mode Olympique',
    reperes: [{ nom: 'Objectif du jeu', v: [45000, 60000, 80000, 150000][i] }],
    carte: (c) => { const l = c.$survival && c.$survival.$level && c.$survival.$level[i]; return l ? l.$s : null; } });
  mesure('kaluga-invasion' + i, { jeu: 'kaluga', groupe: 'Kaluga', nom: `Invasion ${n} : temps tenu`,
    source: { mode: 'invasion' + i }, unite: 'temps', base: 'ms', max: sec(3600),
    titre: `Tiens {seuil} en Invasion ${n}`, detail: 'Kaluga, mode Olympique',
    reperes: [{ nom: 'Objectif du jeu', v: [90000, 120000, 150000, 180000][i] }],
    carte: (c) => { const l = c.$invasion && c.$invasion.$level && c.$invasion.$level[i]; return l ? l.$s : null; } });
  mesure('kaluga-piste' + i, { jeu: 'kaluga', groupe: 'Kaluga', nom: `Piste ${n} : temps`,
    source: { mode: 'piste' + i }, unite: 'temps', base: 'ms', inverse: true, max: sec(1800),
    titre: `Boucle la Piste ${n} en moins de {seuil}`, detail: 'Kaluga, mode Olympique',
    reperes: [{ nom: 'Objectif du jeu', v: [45000, 90000, 90000, 90000][i] }],
    carte: (c) => { const l = c.$ring && c.$ring.$level && c.$ring.$level[i]; return l && l.$s < 600000 ? l.$s : null; } });
});
KALUGA_DEFIS.forEach((n, i) => {
  mesure('kaluga-defi' + i, { jeu: 'kaluga', groupe: 'Kaluga', nom: `Épreuve ${n} : temps`,
    source: { mode: 'defi' + i }, unite: 'temps', base: 'ms', inverse: true, max: sec(600),
    titre: `Réussis l’épreuve ${n} en moins de {seuil}`, detail: 'Kaluga, mode Épreuves',
    reperes: [{ nom: 'Temps imparti', v: [60000, 90000, 110000][i] }],
    carte: (c) => { const l = c.$defiScore && c.$defiScore.$level && c.$defiScore.$level[i]; return l && l.$s ? l.$s : null; } });
});
KALUGA_EPREUVES.forEach((nom, i) => {
  mesure('kaluga-epreuve' + i, { jeu: 'kaluga', groupe: 'Kaluga', nom: `Olympique, ${nom} : distance`,
    source: { mode: 'epreuve' + i }, unite: 'cm', max: 1e6,
    titre: `Fais {seuil} au ${nom}`, detail: 'Kaluga, épreuve olympique',
    carte: (c) => { const t = c.$trial && c.$trial.$list && c.$trial.$list[i]; return t && t.$max > 0 ? t.$max : null; } });
});
mesure('kaluga-triathlon', { jeu: 'kaluga', groupe: 'Kaluga', nom: 'Triathlon : points',
  source: { mode: 'triathlon' }, unite: 'points', max: 1e7,
  titre: 'Fais {seuil} au triathlon', detail: 'Kaluga, mode Olympique',
  carte: (c) => (c.$trial && c.$trial.$tria ? c.$trial.$tria.$s : null) });
mesure('kaluga-heptathlon', { jeu: 'kaluga', groupe: 'Kaluga', nom: 'Heptathlon : points',
  source: { mode: 'heptathlon' }, unite: 'points', max: 1e7,
  titre: 'Fais {seuil} à l’heptathlon', detail: 'Kaluga, mode Olympique',
  carte: (c) => (c.$trial && c.$trial.$hept ? c.$trial.$hept.$s : null) });
// ── MotionBall ──
mesure('mb2-challenge-salles', { jeu: 'mb2', groupe: 'MotionBall', nom: 'Challenge : salles explorées',
  source: { rk: 'mb2_classic' }, unite: '%', valeur: (v) => (v >= 100 ? 100 : v + 1),
  titre: 'Explore {seuil} des salles du Challenge MotionBall', detail: 'Au Challenge du jour' });
mesure('mb2-challenge-boss', { jeu: 'mb2', groupe: 'MotionBall', nom: 'Challenge : poulpe vaincu',
  source: { rk: 'mb2_classic' }, unite: 'boss', valeur: (v) => (v >= 100 ? 1 : 0),
  titre: 'Vaincs le poulpe au Challenge MotionBall', detail: 'Au Challenge du jour' });
mesure('mb2-classique', { jeu: 'mb2', groupe: 'MotionBall', nom: 'Classique : salle atteinte',
  source: { mode: 'classique' }, unite: 'salles', max: 1000,
  titre: 'Atteins la {seuil} en Classique MotionBall', detail: 'Mode classique',
  reperes: [{ nom: 'Titem du jeu', v: 40 }], carte: (c) => c.$classic_score });
MB2_COURSES.forEach((coul, i) => {
  const cpu = [[mncs(3, 0), mncs(3, 40), mncs(4, 20)], [mncs(4, 0), mncs(4, 40), mncs(5, 20)], [mncs(4, 30), mncs(5, 15), mncs(6, 0)],
    [mncs(2, 30), mncs(3, 0), mncs(3, 30)], [mncs(3, 0), mncs(3, 30), mncs(4, 0)], [mncs(4, 0), mncs(4, 40), mncs(5, 20)],
    [mncs(4, 0), mncs(4, 40), mncs(5, 20)]][i];
  mesure('mb2-course' + i, { jeu: 'mb2', groupe: 'MotionBall', nom: `Course ${coul} : temps`,
    source: { mode: 'course' + i }, unite: 'temps', base: 'cs', inverse: true, max: mncs(30, 0),
    titre: `Finis la course ${coul} en moins de {seuil}`, detail: 'MotionBall, mode Course (trois tours)',
    reperes: [{ nom: 'Or (ordinateur)', v: cpu[0] }, { nom: 'Argent', v: cpu[1] }, { nom: 'Bronze', v: cpu[2] }],
    carte: (c) => { const r = c.$records && c.$records[i]; const moi = Array.isArray(r) ? r.find((x) => x && !x.$c) : null; return moi ? moi.$t : null; } });
});
MB2_DONJONS.forEach((nom, i) => {
  mesure('mb2-donjon' + i, { jeu: 'mb2', groupe: 'MotionBall', nom: `Aventure : boss du donjon ${nom}`,
    source: { mode: 'aventure' + i }, unite: 'boss', valeur: (v) => (v >= 100 ? 1 : 0), max: 1e7,
    titre: `Vaincs le boss du donjon ${nom}`, detail: 'MotionBall, mode Aventure',
    carte: (c) => (Array.isArray(c.$dungeons_done) ? (c.$dungeons_done[i] ? 1 : 0) : null) });
});
// ── Burning Kiwi ── (tous les modes de course rangent leur temps au record du circuit)
BKIWI_CIRCUITS.forEach((nom, i) => {
  mesure('bkiwi-circuit' + i, { jeu: 'bkiwi', groupe: 'Burning Kiwi', nom: `${nom} : temps de course`,
    source: { rk: `bkiwi_track${i}_classic` }, unite: 'temps', base: 'ms', inverse: true,
    titre: `Boucle ${nom} en moins de {seuil}`, detail: 'Burning Kiwi, n’importe quel mode de course', records: true });
});
// ── Mini-Fever ──
MINIFEVER_PALIERS.forEach((nom, p) => {
  mesure('minifever-arcade' + p, { jeu: 'minifever', groupe: 'Mini-Fever', nom: `Arcade ${nom} : épreuves remportées`,
    source: { rk: 'minifever_arcade', data: String(p) }, unite: 'épreuves', valeur: (v) => v / (10 * (1 + p)),
    titre: `Remporte {seuil} en arcade ${nom}`, detail: 'Mini-Fever, mode arcade',
    reperes: [{ nom: 'Mode terminé', v: MINIFEVER_OBJECTIFS[p] }] });
});
mesure('minifever-fever', { jeu: 'minifever', groupe: 'Mini-Fever', nom: 'Fever : épreuves enchaînées',
  source: { mode: 'fever' }, unite: 'épreuves', max: 10000,
  titre: 'Enchaîne {seuil} en mode fever', detail: 'Mini-Fever, mode fever' });
// ── JamaJama ── (le tournoi : le niveau voyage dans la donnée du score)
JAMAJAMA_AUTEUR.forEach((auteur, k) => {
  mesure('jamajama-tournoi' + (k + 1), { jeu: 'jamajama', groupe: 'JamaJama', nom: `Tournoi, niveau ${k + 1} : coups`,
    source: { rk: 'jamajama_classic', data: String(200001 + k) }, unite: 'coups', inverse: true,
    titre: `Résous le niveau ${k + 1} du tournoi en {seuil} au plus`, detail: 'JamaJama, tournoi',
    reperes: [{ nom: 'Or (score de l’auteur)', v: auteur }] });
});
// ── MiniPixiz, MiniWave ──
mesure('minipixiz-arbre', { jeu: 'minipixiz', groupe: 'MiniPixiz', nom: 'Arbre creux : points',
  source: { rk: 'minipixiz_classic' }, unite: 'points',
  titre: 'Fais {seuil} dans l’arbre creux', detail: 'MiniPixiz, au Challenge' });
mesure('miniwave-challenge', { jeu: 'miniwave', groupe: 'MiniWave', nom: 'Challenge : points',
  source: { rk: 'miniwave_classic' }, unite: 'points',
  titre: 'Fais {seuil} au Challenge MiniWave', detail: 'MiniWave, au Challenge' });
mesure('miniwave-niveau', { jeu: 'miniwave', groupe: 'MiniWave', nom: 'Challenge : niveau atteint',
  source: { rk: 'miniwave_classic' }, unite: 'niveau', valeur: (v, d) => (Number(d) > 0 ? Number(d) : null),
  titre: 'Atteins le {seuil} au Challenge MiniWave', detail: 'MiniWave, au Challenge',
  reperes: [{ nom: 'Dernier niveau', v: 40 }] });
// ── Grapiz, Frutibandas ──
mesure('grapiz-serie', { jeu: 'grapiz', groupe: 'Grapiz', nom: 'Challenge : victoires d’affilée',
  source: { rk: 'grapiz_challenge' }, unite: 'victoires',
  titre: 'Enchaîne {seuil} d’affilée au Challenge Grapiz', detail: 'Grapiz, au Challenge' });
mesure('bandas-serie', { jeu: 'bandas', groupe: 'Frutibandas', nom: 'Challenge : victoires d’affilée',
  source: { rk: 'bandas_challenge' }, unite: 'victoires',
  titre: 'Enchaîne {seuil} d’affilée au Challenge Frutibandas', detail: 'Frutibandas, au Challenge' });

// Les résultats de mode que le serveur accepte (« jeu:mode »), avec leur borne.
const MODES = {};
for (const m of Object.values(MESURES)) {
  if (m.source.mode) MODES[m.jeu + ':' + m.source.mode] = { nom: m.nom, unite: m.unite, max: m.max || 1e7 };
}

// ── Écrire et lire une valeur, dans l'unité de sa mesure ──
function formater(m, v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  switch (m && m.unite) {
    case 'temps': {
      const cs = Math.round(m.base === 'cs' ? n : n / 10);
      const min = Math.floor(cs / 6000), s = Math.floor(cs / 100) % 60, c = cs % 100;
      const cc = c ? ',' + String(c).padStart(2, '0') : '';
      return min ? `${min} min ${String(s).padStart(2, '0')}${c ? cc : ''} s`.replace(' 00 s', '') : `${s}${cc} s`;
    }
    case '%': return nombre(n) + ' %';
    case 'boss': return n >= 1 ? 'vaincu' : 'pas encore';
    case 'points': return nombre(n) + ' point' + (n > 1 ? 's' : '');
    case 'cm': return nombre(n) + ' cm';
    case 'salles': return 'salle ' + nombre(n);
    case 'niveau': return 'niveau ' + nombre(n);
    case 'coups': return nombre(n) + ' coup' + (n > 1 ? 's' : '');
    case 'victoires': return nombre(n) + ' victoire' + (n > 1 ? 's' : '');
    case 'épreuves': return nombre(n) + ' épreuve' + (n > 1 ? 's' : '');
    default: return nombre(n);
  }
}
/** Ce que l'admin tape (« 4:40 », « 4:40,50 », « 45 », « 45,5 s », « 25 000 ») → la valeur. */
function lireValeur(m, texte) {
  const t = String(texte == null ? '' : texte).trim().toLowerCase().replace(/\s| /g, '').replace(/(s|sec|secondes?|points?|pts|cm|%|coups?)$/, '');
  if (!t) return null;
  if (m && m.unite === 'temps') {
    const r = /^(?:(\d+)(?:min|:|'|m))?(\d+(?:[.,]\d+)?)?(?:")?$/.exec(t.replace(/min$/, 'min0'));
    if (!r || (r[1] === undefined && r[2] === undefined)) return null;
    const secondes = (Number(r[1]) || 0) * 60 + (Number(String(r[2] || '0').replace(',', '.')) || 0);
    if (!(secondes > 0)) return null;
    return m.base === 'cs' ? Math.round(secondes * 100) : Math.round(secondes * 1000);
  }
  const chiffres = /^(?:salle|niveau)?([\d]+(?:[.,]\d+)?)/.exec(t);
  const n = chiffres ? Number(chiffres[1].replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** La valeur d'un événement pour une mesure, ou null s'il ne la concerne pas. */
function valeurDe(m, evt) {
  if (!m || !evt) return null;
  const s = m.source;
  let v;
  if (s.rk) {
    if (evt.type !== 'score' || evt.rk !== s.rk) return null;
    if (s.data !== undefined && String(evt.data == null ? '' : evt.data) !== s.data) return null;
  } else if (s.mode) {
    if (evt.type !== 'mode' || evt.jeu !== m.jeu || evt.mode !== s.mode) return null;
  } else return null;
  v = Number(evt.v);
  if (!Number.isFinite(v)) return null;
  if (m.valeur) v = m.valeur(v, evt.data);
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}
const atteint = (m, v, seuil, strict) => (strict
  ? (m.inverse ? v < seuil : v > seuil)
  : (m.inverse ? v <= seuil : v >= seuil));
const mieux = (m, v, ancien) => ancien == null || (m.inverse ? v < ancien : v > ancien);

/*
 * LE CATALOGUE : des quêtes de RÉSULTAT, calées sur les repères que les jeux
 * donnent eux-mêmes (objectifs de niveau de Kaluga, temps de l'ordinateur à
 * MotionBall, fin d'un mode d'arcade). Tout le reste — un temps à Burning
 * Kiwi, un score de Frutisnake — l'admin le crée à partir d'une mesure, avec
 * son seuil (onglet Quêtes, « Créer une quête »).
 */
const q = (id, niveau, cle, seuil, extra) => Object.assign({ id, niveau, type: 'mesure', etiquette: MESURES[cle].jeu,
  famille: cle, params: { mesure: cle, seuil } }, extra || {});
const CATALOGUE = [
  // ── Faciles ──
  q('kaluga-chrono-facile', 'facile', 'kaluga-chrono0', 60000),
  q('kaluga-survie-facile', 'facile', 'kaluga-survie0', 45000),
  q('mb2-course-jaune-bronze', 'facile', 'mb2-course0', mncs(4, 20)),
  q('minifever-arcade-facile-20', 'facile', 'minifever-arcade0', 20),
  q('mb2-salles-50', 'facile', 'mb2-challenge-salles', 50),
  { id: 'vers-record', niveau: 'facile', type: 'record', etiquette: 'kaluga', famille: 'kaluga-epreuve0',
    params: { jeu: 'kaluga', mode: 'epreuve0' }, titre: 'Bats ton record au lancer de vers', detail: 'Kaluga, épreuve olympique' },
  // ── Moyennes ──
  q('swapou-15000', 'moyenne', 'swapou-challenge', 15000),
  q('kaluga-chrono-standard', 'moyenne', 'kaluga-chrono1', 50000),
  q('kaluga-invasion-facile', 'moyenne', 'kaluga-invasion0', 90000),
  q('mb2-course-verte-argent', 'moyenne', 'mb2-course1', mncs(4, 40)),
  q('minifever-arcade-facile', 'moyenne', 'minifever-arcade0', 40),
  q('kaluga-defi-facile', 'moyenne', 'kaluga-defi0', 60000),
  { id: 'grenouille-record', niveau: 'moyenne', type: 'record', etiquette: 'kaluga', famille: 'kaluga-epreuve6',
    params: { jeu: 'kaluga', mode: 'epreuve6' }, titre: 'Bats ton record à la course de grenouille', detail: 'Kaluga, épreuve olympique' },
  // ── Difficiles ──
  q('swapou-25000', 'difficile', 'swapou-challenge', 25000),
  q('kaluga-chrono-difficile', 'difficile', 'kaluga-chrono2', 45000),
  q('mb2-course-verte-or', 'difficile', 'mb2-course1', mncs(4, 0)),
  q('mb2-poulpe', 'difficile', 'mb2-challenge-boss', 1),
  q('minifever-arcade-normal', 'difficile', 'minifever-arcade1', 80),
  { id: 'kiloute', niveau: 'difficile', type: 'action', etiquette: 'kiloute', famille: 'kiloute',
    params: { action: 'kiloute', n: 1 }, titre: 'Remporte une Question à 60 kikooz', detail: 'Tous les soirs à 19 h, dans les salons' },
  { id: 'medaille', niveau: 'difficile', type: 'action', etiquette: 'challenge', famille: 'medaille',
    params: { action: 'medaille', n: 1 }, titre: 'Monte sur le podium d’un Challenge', detail: 'Médaille d’or, d’argent ou de bronze, versée au changement de jour' },
];

// ── Les nombres et les dates ─────────────────────────────────────────────────

const nombre = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function jourPlus(jour, n) {
  const d = new Date(String(jour) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Le lundi de la semaine d'un jour (YYYY-MM-DD). */
function lundiDe(jour) {
  const d = new Date(String(jour) + 'T12:00:00Z');
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}
// L'écart entre l'heure de Paris et l'UTC, à un instant donné.
function decalageParis(t) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t));
  const g = (k) => Number(p.find((x) => x.type === k).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - t;
}
/** L'instant (ms) de minuit à Paris, au début d'un jour. */
function minuitParis(jour) {
  const [y, m, d] = String(jour).split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  let t = base;
  for (let i = 0; i < 3; i++) t = base - decalageParis(t);
  return t;
}
/** La fin d'une semaine : le lundi suivant, à minuit, heure de Paris. */
const finDeSemaine = (lundi) => minuitParis(jourPlus(lundi, 7));

function semaineLisible(lundi) {
  const f = (j, o) => new Date(j + 'T12:00:00Z').toLocaleDateString('fr-FR', Object.assign({ timeZone: 'UTC' }, o));
  const dim = jourPlus(lundi, 6);
  const memeMois = lundi.slice(0, 7) === dim.slice(0, 7);
  return memeMois
    ? `du ${f(lundi, { day: 'numeric' })} au ${f(dim, { day: 'numeric', month: 'long' })}`
    : `du ${f(lundi, { day: 'numeric', month: 'long' })} au ${f(dim, { day: 'numeric', month: 'long' })}`;
}

// ── Le catalogue, retouché par l'admin ───────────────────────────────────────

function reglagesNormalises(brut) {
  const R = Object.assign({}, REGLAGES_DEFAUT, brut || {});
  R.ouverture = ['ferme', 'testeurs', 'tous'].includes(R.ouverture) ? R.ouverture : 'ferme';
  R.testeurs = Array.from(new Set((Array.isArray(R.testeurs) ? R.testeurs : [])
    .map((u) => String(u || '').trim().toLowerCase()).filter(Boolean)));
  const gains = {}, compo = {};
  for (const n of NIVEAUX) {
    const g = Math.floor(Number((R.gains || {})[n]));
    gains[n] = Number.isFinite(g) && g >= 0 && g <= 1000 ? g : REGLAGES_DEFAUT.gains[n];
    const c = Math.floor(Number((R.composition || {})[n]));
    compo[n] = Number.isFinite(c) && c >= 0 && c <= 10 ? c : REGLAGES_DEFAUT.composition[n];
  }
  R.gains = gains;
  R.composition = compo;
  R.catalogue = (R.catalogue && typeof R.catalogue === 'object') ? R.catalogue : {};
  const C = Object.assign({}, REGLAGES_DEFAUT.contrat, (R.contrat && typeof R.contrat === 'object') ? R.contrat : {});
  R.contrat = {
    actif: C.actif !== false,
    fenetre: Math.max(7, Math.min(90, Math.floor(Number(C.fenetre)) || 28)),
    minJours: Math.max(1, Math.min(20, Math.floor(Number(C.minJours)) || 3)),
  };
  // Les quêtes créées par l'admin : une mesure, un seuil, un niveau.
  R.perso = (Array.isArray(R.perso) ? R.perso : []).filter((x) => x && /^perso-\d+$/.test(String(x.id))
    && MESURES[x.mesure] && NIVEAUX.includes(x.niveau) && Number(x.seuil) > 0)
    .map((x) => ({ id: String(x.id), mesure: x.mesure, seuil: Number(x.seuil), niveau: x.niveau,
      titre: x.titre ? String(x.titre).slice(0, 120) : '', actif: x.actif !== false }));
  return R;
}

/** La quête du catalogue, avec les retouches de l'admin. */
function definition(id, reglages) {
  const perso = (((reglages || {}).perso) || []).find((x) => x.id === id);
  if (perso) {
    return { id: perso.id, niveau: perso.niveau, type: 'mesure', etiquette: MESURES[perso.mesure].jeu,
      famille: perso.mesure, params: { mesure: perso.mesure, seuil: perso.seuil },
      titre: perso.titre || undefined, actif: perso.actif, perso: true };
  }
  const base = CATALOGUE.find((x) => x.id === id);
  if (!base) return null;
  const r = ((reglages || {}).catalogue || {})[id] || {};
  const def = JSON.parse(JSON.stringify(base));
  def.actif = r.actif !== undefined ? !!r.actif : base.actif !== false;
  if (NIVEAUX.includes(r.niveau)) def.niveau = r.niveau;
  if (def.params.seuil !== undefined && Number(r.seuil) > 0) def.params.seuil = Number(r.seuil);
  if (def.params.n !== undefined && Number(r.n) >= 1) def.params.n = Math.floor(Number(r.n));
  return def;
}
function catalogue(reglages) {
  return CATALOGUE.map((x) => definition(x.id, reglages))
    .concat((((reglages || {}).perso) || []).map((x) => definition(x.id, reglages)));
}

/** Le titre d'une quête, ses nombres posés. */
function titre(def) {
  const p = def.params || {};
  if (def.type === 'mesure') {
    const m = MESURES[p.mesure];
    const modele = def.titre || (m && m.titre) || '';
    return String(modele).replace('{seuil}', formater(m, p.seuil));
  }
  return String(def.titre).replace('{seuil}', nombre(p.seuil)).replace('{n}', nombre(p.n));
}
/** La ligne sous le titre. */
function detail(def) {
  if (def.type === 'mesure') { const m = MESURES[(def.params || {}).mesure]; return def.detail || (m && m.detail) || ''; }
  return def.detail || '';
}

// ── Le tirage du lundi ───────────────────────────────────────────────────────

function aleaSeme(graine) {
  let a = 0;
  for (const ch of String(graine)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 0x9E3779B9) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Les quêtes de la semaine : `composition` par niveau, tirées parmi les quêtes
 * actives, jamais deux de la même famille (deux seuils de Swapou, deux
 * lancers de vers) tant qu'il en reste d'autres. Reproductible : même graine,
 * même tirage. Rend des DÉFINITIONS complètes (figées pour la semaine).
 */
function tirer(reglages, graine, exclues) {
  const R = reglagesNormalises(reglages);
  const alea = aleaSeme(graine);
  const sauf = new Set(exclues || []);
  const choisies = [];
  const familles = new Set();
  const jeux = new Set();
  for (const niveau of NIVEAUX) {
    const pool = catalogue(R).filter((q) => q.actif && q.niveau === niveau && !sauf.has(q.id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(alea() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const voulu = R.composition[niveau];
    let pris = 0;
    // D'abord des jeux différents, puis des familles différentes, puis ce qui reste.
    const passes = [
      (x) => !familles.has(x.famille) && !jeux.has(x.etiquette),
      (x) => !familles.has(x.famille),
      () => true,
    ];
    for (const ok of passes) {
      for (const x of pool) {
        if (pris >= voulu) break;
        if (choisies.includes(x) || !ok(x)) continue;
        choisies.push(x); familles.add(x.famille); jeux.add(x.etiquette); pris++;
      }
    }
  }
  return choisies;
}

// ── L'avancement ─────────────────────────────────────────────────────────────

/** La quête est-elle accomplie, vu son état ? */
function estFaite(def, etat) {
  const p = def.params || {}, e = etat || {};
  switch (def.type) {
    case 'mesure': {
      const m = MESURES[p.mesure];
      return !!m && e.m != null && atteint(m, Number(e.m), Number(p.seuil), !!p.strict);
    }
    case 'score':
    case 'mode':
      if (p.seuil !== undefined) {
        if (e.m == null) return false;
        return p.inverse ? Number(e.m) <= p.seuil : Number(e.m) >= p.seuil;
      }
      return (Number(e.c) || 0) >= p.n;
    case 'jours': return (Array.isArray(e.j) ? e.j.length : 0) >= p.n;
    case 'parties':
    case 'action': return (Number(e.c) || 0) >= p.n;
    case 'record': return (Number(e.c) || 0) >= 1;
    default: return false;
  }
}

/**
 * Un événement fait-il avancer cette quête ? Rend le NOUVEL état, ou null si
 * l'événement ne la concerne pas (ou ne change rien). `jour` : le jour de Paris.
 */
function appliquer(def, etat, evt, jour) {
  const p = def.params || {};
  const e = Object.assign({}, etat || {});
  if (!evt || !evt.type) return null;
  switch (def.type) {
    case 'mesure': {
      const m = MESURES[p.mesure];
      const v = valeurDe(m, evt);
      if (v == null || !mieux(m, v, e.m)) return null;
      e.m = v;
      return e;
    }
    case 'score': {
      if (evt.type !== 'score' || evt.rk !== p.rk) return null;
      const v = Number(evt.v);
      if (!Number.isFinite(v)) return null;
      const mieux = e.m == null || (p.inverse ? v < e.m : v > e.m);
      if (!mieux) return null;
      e.m = v;
      return e;
    }
    case 'jours': {
      if (evt.type !== 'score' || !evt.challenge || !jour) return null;
      const j = Array.isArray(e.j) ? e.j.slice() : [];
      if (j.includes(jour)) return null;
      j.push(jour);
      e.j = j;
      return e;
    }
    case 'parties': {
      if (evt.type !== 'partie' || evt.jeu !== p.jeu) return null;
      e.c = (Number(e.c) || 0) + 1;
      return e;
    }
    case 'action': {
      if (evt.type !== 'action' || evt.action !== p.action) return null;
      e.c = (Number(e.c) || 0) + 1;
      return e;
    }
    case 'mode': {
      if (evt.type !== 'mode' || evt.jeu !== p.jeu || evt.mode !== p.mode) return null;
      if (p.seuil !== undefined) {
        const v = Number(evt.v);
        if (!Number.isFinite(v) || (e.m != null && v <= e.m)) return null;
        e.m = v;
        return e;
      }
      e.c = (Number(e.c) || 0) + 1;
      return e;
    }
    case 'record': {
      if (evt.type !== 'mode' || evt.jeu !== p.jeu || evt.mode !== p.mode || !evt.record) return null;
      if ((Number(e.c) || 0) >= 1) return null;
      e.c = 1;
      e.m = Number(evt.v) || 0;
      return e;
    }
    default: return null;
  }
}

/**
 * Où en est la quête, pour l'affichage : la ligne de détail, la part faite
 * (0..1) et le compte « valeur / cible ».
 */
function avancement(def, etat) {
  const p = def.params || {}, e = etat || {};
  const fait = estFaite(def, e);
  let valeur = 0, cible = 1, ligne = '';
  const unite = p.unite || ((def.type === 'mode' || def.type === 'record') ? (MODES[p.jeu + ':' + p.mode] || {}).unite : '') || 'points';
  switch (def.type) {
    case 'mesure': {
      const m = MESURES[p.mesure];
      if (!m) break;
      cible = Number(p.seuil);
      valeur = e.m == null ? 0 : Number(e.m);
      if (m.unite === 'boss') {
        ligne = fait ? 'vaincu' : 'pas encore vaincu cette semaine';
        return { fait, valeur, cible, ligne, pc: fait ? 1 : 0 };
      }
      ligne = e.m == null ? 'pas encore de résultat cette semaine' : `ton meilleur cette semaine : ${formater(m, e.m)}`;
      const pc = e.m == null ? 0 : (m.inverse ? (e.m > 0 ? cible / e.m : 0) : e.m / cible);
      return { fait, valeur, cible, ligne, pc: fait ? 1 : Math.max(0, Math.min(0.99, pc)) };
    }
    case 'score':
    case 'mode':
      if (p.seuil !== undefined) {
        cible = p.seuil;
        valeur = e.m == null ? 0 : Number(e.m);
        ligne = e.m == null ? 'pas encore de résultat cette semaine'
          : `ton meilleur cette semaine : ${nombre(e.m)} ${unite}`;
        const pc = e.m == null ? 0 : (p.inverse ? (e.m > 0 ? p.seuil / e.m : 0) : e.m / p.seuil);
        return { fait, valeur, cible, ligne, pc: fait ? 1 : Math.max(0, Math.min(0.99, pc)) };
      }
      cible = p.n; valeur = Math.min(p.n, Number(e.c) || 0);
      ligne = `${valeur} / ${cible}`;
      break;
    case 'jours':
      cible = p.n; valeur = Math.min(p.n, Array.isArray(e.j) ? e.j.length : 0);
      ligne = `${valeur} / ${cible} jour${cible > 1 ? 's' : ''}`;
      break;
    case 'parties':
    case 'action':
      cible = p.n; valeur = Math.min(p.n, Number(e.c) || 0);
      ligne = `${valeur} / ${cible}`;
      break;
    case 'record':
      cible = 1; valeur = (Number(e.c) || 0) >= 1 ? 1 : 0;
      ligne = valeur ? `record battu : ${nombre(e.m)} ${unite}` : 'pas encore battu cette semaine';
      break;
    default: break;
  }
  return { fait, valeur, cible, ligne, pc: fait ? 1 : Math.max(0, Math.min(0.99, valeur / cible)) };
}

/** Une déclaration de mode est-elle recevable ? Rend { jeu, mode, v } ou null. */
function modeRecevable(jeu, mode, v) {
  const def = MODES[String(jeu) + ':' + String(mode)];
  const n = Number(v);
  if (!def || !Number.isFinite(n) || n < 0 || n > def.max) return null;
  return { jeu: String(jeu), mode: String(mode), v: n };
}

/** Les repères d'une mesure, mis en forme pour l'admin. */
function reperes(m) {
  return ((m && m.reperes) || []).map((r) => ({ nom: r.nom, v: r.v, texte: formater(m, r.v) }));
}
/**
 * Le calibrage : les meilleurs résultats de chaque joueur (une valeur par
 * joueur), et un seuil — combien l'atteignent, et où il se situe.
 */
function calibrer(m, valeurs, seuil) {
  const v = (valeurs || []).map(Number).filter(Number.isFinite).sort((a, b) => (m.inverse ? a - b : b - a));
  if (!v.length) return { joueurs: 0, texte: 'Aucun résultat connu pour cette mesure.' };
  const rang = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  const res = { joueurs: v.length, meilleur: v[0], top10: rang(0.1), top25: rang(0.25), mediane: rang(0.5) };
  const f = (x) => formater(m, x);
  let texte = `${v.length} joueur(s) · meilleur ${f(res.meilleur)} · top 10 % ${f(res.top10)} · top 25 % ${f(res.top25)} · médiane ${f(res.mediane)}`;
  if (Number(seuil) > 0) {
    res.atteint = v.filter((x) => atteint(m, x, Number(seuil))).length;
    texte += ` — ${f(seuil)} : atteint par ${res.atteint} (${Math.round(100 * res.atteint / v.length)} %)`;
  }
  res.texte = texte;
  return res;
}

// ── Gromelin parle ───────────────────────────────────────────────────────────
// Ses répliques, choisies au hasard (le serveur passe son tirage). Le texte est
// du HTML simple : `<em>` pour ce qui compte ; tout ce qui vient d'ailleurs
// (titres, nombres) est échappé par l'appelant.

const PAROLES = {
  semaine: [
    '<em>Grumpf.</em> Encore toi ? Bon. Nouvelle semaine, nouvelles quêtes : {n}, pas une de plus. Et que ça saute.',
    'Lundi. Je déteste les lundis. Tiens, voilà tes {n} quêtes de la semaine. Ne traîne pas.',
    '<em>Grumpf.</em> T’as l’air reposé, ça ne va pas durer : {n} quêtes t’attendent. Dimanche minuit, dernier délai.',
  ],
  faite: [
    '« {titre} » : c’est fait. Pas mal, pour un Frutiz. <em>{gain} kikooz</em>, comme convenu.',
    '« {titre} » ? Fait. J’aurais fait mieux, mais bon. <em>{gain} kikooz</em> pour toi.',
    'Bon. « {titre} », c’est réglé. Voilà tes <em>{gain} kikooz</em>. Ne les dépense pas tous au même endroit.',
  ],
  reste: [
    'Il te reste {reste} quête{s}. <em>Dimanche minuit</em>, pas une minute de plus.',
    '{reste} quête{s} à faire. Qu’est-ce que tu attends ? Que je les fasse à ta place ?',
    '<em>Grumpf.</em> Encore {reste} quête{s}. Le temps file, et moi je n’ai pas que ça à faire.',
  ],
  fini: [
    'Tout est fait. Je n’ai plus rien pour toi. <em>Reviens lundi.</em> Grumpf.',
    'Tout est coché. Ne crois pas que je sois impressionné. <em>Reviens lundi.</em>',
  ],
  rien: [
    'Pas de quêtes cette semaine. Profites-en, ça ne durera pas.',
  ],
  // Le contrat de la semaine, proposé et pas encore signé.
  contrat: [
    'Et pour toi, j’ai préparé un <em>contrat</em>. Taillé sur tes propres scores, pas sur ceux des autres. Choisis-en un, signe, et au travail.',
    'J’ai regardé tes scores. <em>Grumpf.</em> Je t’ai préparé trois contrats à ta mesure. Un seul, tu signes, et après on n’en parle plus.',
  ],
  contratSigne: [
    'Signé. Je garde ça au chaud. Seuls les résultats <em>à partir de maintenant</em> comptent, alors file.',
  ],
};
function parole(cle, vars, alea) {
  const l = PAROLES[cle] || [''];
  const t = l[Math.floor((alea || Math.random)() * l.length) % l.length];
  return t.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? String(vars[k]) : ''));
}

// ── Le contrat de la semaine : rien que pour toi ─────────────────────────────
/*
 * Chaque lundi, Gromelin prépare pour chaque joueur TROIS quêtes calées sur ses
 * propres résultats des dernières semaines (le meilleur de chaque jour, au
 * Challenge, tel que le serveur l'a archivé) — une facile, une moyenne, une
 * difficile, dans les jeux qu'il pratique vraiment. Le joueur en signe une ;
 * seuls les résultats obtenus APRÈS la signature comptent.
 *
 *   facile    : son niveau habituel   — la médiane de ses meilleurs du jour ;
 *   moyenne   : ses bons jours        — le meilleur quart ;
 *   difficile : battre son record de la période (strictement).
 *
 * Seuls les jeux joués au moins `minJours` jours sur la fenêtre comptent : sur
 * deux parties, on ne sait rien de quelqu'un. Les cibles s'arrondissent dans
 * le sens du joueur (vers le bas pour un score, vers le haut pour un temps).
 */
const MESURES_PERSO = ['swapou-challenge', 'snake-challenge', 'kaluga-grappe', 'kaluga-freestyle', 'mb2-challenge-salles',
  'minipixiz-arbre', 'miniwave-challenge', 'minifever-arcade0', 'minifever-arcade1', 'minifever-arcade2', 'minifever-arcade3'];
for (const k of MESURES_PERSO) MESURES[k].perso = true;
MESURES['mb2-challenge-salles'].plafond = 100;

function pas(v) { const a = Math.abs(v); return a >= 10000 ? 100 : a >= 1000 ? 50 : a >= 100 ? 10 : 1; }
/** Une cible ronde, arrondie dans le sens du joueur. */
function arrondir(m, v) {
  if (m.unite === 'temps') { const q = m.base === 'cs' ? 50 : 500; return Math.ceil(v / q) * q; }
  const p = m.unite === 'points' ? pas(v) : 1;
  return m.inverse ? Math.ceil(v / p) * p : Math.max(p, Math.floor(v / p) * p);
}
function quantile(tries, q) { return tries[Math.min(tries.length - 1, Math.floor(q * tries.length))]; }

/**
 * Les trois propositions d'un joueur.
 * @param {{ [cle]: number[] }} historique — par mesure, le meilleur de chaque jour joué
 * @param {() => number} alea — semé par le joueur et la semaine
 * @returns {Array<{ niveau, mesure, seuil, strict, jours, repere }>}
 */
function proposerContrat(historique, alea, options) {
  const minJours = (options && options.minJours) || REGLAGES_DEFAUT.contrat.minJours;
  const rnd = alea || Math.random;
  const cands = [];
  for (const [cle, valeurs] of Object.entries(historique || {})) {
    const m = MESURES[cle];
    const v = (valeurs || []).map(Number).filter(Number.isFinite);
    if (!m || !m.perso || v.length < minJours) continue;
    // du meilleur au moins bon
    const tries = v.slice().sort((a, b) => (m.inverse ? a - b : b - a));
    cands.push({ m, jours: v.length, tries, tirage: rnd() });
  }
  // Les jeux les plus pratiqués d'abord ; un jeu ne sert qu'une fois tant qu'il y en a d'autres.
  cands.sort((a, b) => b.jours - a.jours || a.tirage - b.tirage);
  const parJeu = [];
  for (const c of cands) if (!parJeu.some((x) => x.m.jeu === c.m.jeu)) parJeu.push(c);
  if (!parJeu.length) return [];
  const choix = parJeu.slice(0, 3);
  for (let i = choix.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [choix[i], choix[j]] = [choix[j], choix[i]]; }
  const props = [];
  NIVEAUX.forEach((niveau, i) => {
    const c = choix[i % choix.length];
    const { m, tries } = c;
    const record = tries[0];
    const haut = quantile(tries, 0.25);
    const mediane = quantile(tries, 0.5);
    if (niveau === 'difficile') {
      if (m.plafond != null && !m.inverse && record >= m.plafond) {
        // Déjà au plafond (100 % des salles) : on vise d'y revenir.
        props.push({ niveau, mesure: m.cle, seuil: m.plafond, strict: false, jours: c.jours, repere: { record } });
        return;
      }
      props.push({ niveau, mesure: m.cle, seuil: record, strict: true, jours: c.jours, repere: { record } });
      return;
    }
    let seuil = arrondir(m, niveau === 'facile' ? mediane : haut);
    if (niveau === 'moyenne') {
      const facile = props.find((x) => x.niveau === 'facile' && x.mesure === m.cle);
      if (facile && seuil === facile.seuil) seuil = arrondir(m, record);
    }
    props.push({ niveau, mesure: m.cle, seuil, strict: false, jours: c.jours, repere: { mediane, haut, record } });
  });
  return props;
}

/** La définition de quête d'une proposition (id « contrat »). */
function definitionContrat(prop) {
  const m = MESURES[prop.mesure];
  if (!m) return null;
  const titre = prop.strict
    ? `Bats ton record à ${m.groupe} : ${m.inverse ? 'moins de' : 'plus de'} {seuil}`
    : undefined;
  const r = prop.repere || {};
  const detail = prop.niveau === 'facile'
    ? `${m.nom} · ton niveau habituel (${prop.jours} jours de jeu)`
    : prop.niveau === 'moyenne'
      ? `${m.nom} · tes bons jours (médiane : ${formater(m, r.mediane)})`
      : `${m.nom} · ton record des dernières semaines`;
  return { id: 'contrat', niveau: prop.niveau, type: 'mesure', etiquette: m.jeu, famille: m.cle, contrat: true,
    params: { mesure: m.cle, seuil: prop.seuil, strict: !!prop.strict }, titre, detail };
}

module.exports = {
  MESURES_PERSO, proposerContrat, definitionContrat, arrondir, aleaSeme,
  NIVEAUX, NIVEAU_NOM, REGLAGES_DEFAUT, CATALOGUE, ETIQUETTES, KALUGA_EPREUVES, MODES,
  nombre, jourPlus, lundiDe, minuitParis, finDeSemaine, semaineLisible,
  reglagesNormalises, definition, catalogue, titre, tirer,
  estFaite, appliquer, avancement, modeRecevable, parole, PAROLES,
  MESURES, formater, lireValeur, valeurDe, reperes, calibrer, detail,
};
