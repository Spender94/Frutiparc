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

// Les résultats de mode que le serveur accepte, et leur borne de vraisemblance :
// au-delà, la déclaration est ignorée.
const MODES = {};
KALUGA_EPREUVES.forEach((nom, i) => {
  MODES['kaluga:epreuve' + i] = { nom, unite: i === 0 || i === 6 ? 'cm' : 'pts', max: 1e6 };
});

/*
 * LE CATALOGUE. Les seuils sont des points de départ : l'admin les retouche
 * (onglet Quêtes), en voyant la part des joueurs qui les atteignent.
 */
const CATALOGUE = [
  // ── Faciles ──
  { id: 'challenge-2j', niveau: 'facile', type: 'jours', etiquette: 'challenge', famille: 'challenge-jours',
    params: { n: 2 }, titre: 'Joue au Challenge {n} jours différents', detail: 'N’importe quel jeu du jour' },
  { id: 'prunostic-1', niveau: 'facile', type: 'action', etiquette: 'prunostics', famille: 'prunostics',
    params: { action: 'pari', n: 1 }, titre: 'Place un Prunostic', detail: 'Sur un match de tournoi ou le Challenge de demain' },
  { id: 'forum-2', niveau: 'facile', type: 'action', etiquette: 'forum', famille: 'forum',
    params: { action: 'forumPost', n: 2 }, titre: 'Réponds {n} fois sur le forum', detail: 'N’importe quel sujet' },
  { id: 'salons-20', niveau: 'facile', type: 'action', etiquette: 'salons', famille: 'salons',
    params: { action: 'chatMsg', n: 20 }, titre: 'Écris {n} messages dans les salons', detail: 'Salons publics ou privés' },
  { id: 'snake3-3p', niveau: 'facile', type: 'parties', etiquette: 'snake3', famille: 'snake3',
    params: { jeu: 'snake3', n: 3 }, titre: 'Joue {n} parties de Frutisnake', detail: 'Parties classées' },
  { id: 'swapou2-3p', niveau: 'facile', type: 'parties', etiquette: 'swapou2', famille: 'swapou2',
    params: { jeu: 'swapou2', n: 3 }, titre: 'Joue {n} parties de Swapou', detail: 'Parties classées' },
  { id: 'kaluga-3p', niveau: 'facile', type: 'parties', etiquette: 'kaluga', famille: 'kaluga',
    params: { jeu: 'kaluga', n: 3 }, titre: 'Joue {n} parties de Kaluga', detail: 'Parties classées' },
  { id: 'minifever-3p', niveau: 'facile', type: 'parties', etiquette: 'minifever', famille: 'minifever',
    params: { jeu: 'minifever', n: 3 }, titre: 'Joue {n} parties de Mini-Fever', detail: 'Parties classées' },
  { id: 'bkiwi-3p', niveau: 'facile', type: 'parties', etiquette: 'bkiwi', famille: 'bkiwi',
    params: { jeu: 'bkiwi', n: 3 }, titre: 'Fais {n} courses de Burning Kiwi', detail: 'Courses classées' },
  { id: 'vers-3', niveau: 'facile', type: 'mode', etiquette: 'kaluga', famille: 'kaluga-epreuves',
    params: { jeu: 'kaluga', mode: 'epreuve0', n: 3 }, titre: 'Fais {n} lancers de vers', detail: 'Kaluga, mode Épreuves' },
  { id: 'grenouille-3', niveau: 'facile', type: 'mode', etiquette: 'kaluga', famille: 'kaluga-epreuves',
    params: { jeu: 'kaluga', mode: 'epreuve6', n: 3 }, titre: 'Fais {n} courses de grenouille', detail: 'Kaluga, mode Épreuves' },

  // ── Moyennes ──
  { id: 'challenge-4j', niveau: 'moyenne', type: 'jours', etiquette: 'challenge', famille: 'challenge-jours',
    params: { n: 4 }, titre: 'Joue au Challenge {n} jours différents', detail: 'N’importe quel jeu du jour' },
  { id: 'prunostic-3', niveau: 'moyenne', type: 'action', etiquette: 'prunostics', famille: 'prunostics',
    params: { action: 'pari', n: 3 }, titre: 'Place {n} Prunostics', detail: 'Tournois ou Challenge, un nouveau pari à chaque fois' },
  { id: 'forum-5', niveau: 'moyenne', type: 'action', etiquette: 'forum', famille: 'forum',
    params: { action: 'forumPost', n: 5 }, titre: 'Réponds {n} fois sur le forum', detail: 'N’importe quel sujet' },
  { id: 'swapou2-15000', niveau: 'moyenne', type: 'score', etiquette: 'swapou2', famille: 'swapou2',
    params: { rk: 'swapou2_classic', seuil: 15000 }, titre: 'Dépasse {seuil} points à Swapou', detail: 'Au Challenge' },
  { id: 'snake3-10p', niveau: 'moyenne', type: 'parties', etiquette: 'snake3', famille: 'snake3',
    params: { jeu: 'snake3', n: 10 }, titre: 'Joue {n} parties de Frutisnake', detail: 'Parties classées' },
  { id: 'snake3-100a', niveau: 'moyenne', type: 'score', etiquette: 'snake3', famille: 'snake3-long',
    params: { rk: 'snake3_contest', seuil: 100, unite: 'anneaux' }, titre: 'Fais un serpent de {seuil} anneaux', detail: 'Frutisnake, n’importe quelle partie' },
  { id: 'vers-record', niveau: 'moyenne', type: 'record', etiquette: 'kaluga', famille: 'kaluga-epreuves',
    params: { jeu: 'kaluga', mode: 'epreuve0' }, titre: 'Bats ton record au lancer de vers', detail: 'Kaluga, mode Épreuves' },
  { id: 'vers-seuil', niveau: 'moyenne', type: 'mode', etiquette: 'kaluga', famille: 'kaluga-epreuves', actif: false,
    params: { jeu: 'kaluga', mode: 'epreuve0', seuil: 400 }, titre: 'Fais {seuil} cm au lancer de vers', detail: 'Kaluga, mode Épreuves' },
  { id: 'minipixiz-5p', niveau: 'moyenne', type: 'parties', etiquette: 'minipixiz', famille: 'minipixiz',
    params: { jeu: 'minipixiz', n: 5 }, titre: 'Termine {n} parties de MiniPixiz', detail: 'Parties classées' },

  // ── Difficiles ──
  { id: 'swapou2-25000', niveau: 'difficile', type: 'score', etiquette: 'swapou2', famille: 'swapou2',
    params: { rk: 'swapou2_classic', seuil: 25000 }, titre: 'Dépasse {seuil} points à Swapou', detail: 'Au Challenge' },
  { id: 'kiloute', niveau: 'difficile', type: 'action', etiquette: 'kiloute', famille: 'kiloute',
    params: { action: 'kiloute', n: 1 }, titre: 'Remporte une Question à 60 kikooz', detail: 'Tous les soirs à 19 h, dans les salons' },
  { id: 'medaille', niveau: 'difficile', type: 'action', etiquette: 'challenge', famille: 'medaille',
    params: { action: 'medaille', n: 1 }, titre: 'Monte sur le podium d’un Challenge', detail: 'Médaille d’or, d’argent ou de bronze, versée au changement de jour' },
  { id: 'challenge-6j', niveau: 'difficile', type: 'jours', etiquette: 'challenge', famille: 'challenge-jours',
    params: { n: 6 }, titre: 'Joue au Challenge {n} jours différents', detail: 'N’importe quel jeu du jour' },
  { id: 'snake3-200a', niveau: 'difficile', type: 'score', etiquette: 'snake3', famille: 'snake3-long',
    params: { rk: 'snake3_contest', seuil: 200, unite: 'anneaux' }, titre: 'Fais un serpent de {seuil} anneaux', detail: 'Frutisnake, n’importe quelle partie' },
  { id: 'grenouille-record', niveau: 'difficile', type: 'record', etiquette: 'kaluga', famille: 'kaluga-epreuves',
    params: { jeu: 'kaluga', mode: 'epreuve6' }, titre: 'Bats ton record à la course de grenouille', detail: 'Kaluga, mode Épreuves' },
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
  return R;
}

/** La quête du catalogue, avec les retouches de l'admin. */
function definition(id, reglages) {
  const base = CATALOGUE.find((q) => q.id === id);
  if (!base) return null;
  const r = ((reglages || {}).catalogue || {})[id] || {};
  const def = JSON.parse(JSON.stringify(base));
  def.actif = r.actif !== undefined ? !!r.actif : base.actif !== false;
  if (NIVEAUX.includes(r.niveau)) def.niveau = r.niveau;
  if (def.params.seuil !== undefined && Number(r.seuil) > 0) def.params.seuil = Number(r.seuil);
  if (def.params.n !== undefined && Number(r.n) >= 1) def.params.n = Math.floor(Number(r.n));
  return def;
}
function catalogue(reglages) { return CATALOGUE.map((q) => definition(q.id, reglages)); }

/** Le titre d'une quête, ses nombres posés. */
function titre(def) {
  const p = def.params || {};
  return String(def.titre).replace('{seuil}', nombre(p.seuil)).replace('{n}', nombre(p.n));
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
  for (const niveau of NIVEAUX) {
    const pool = catalogue(R).filter((q) => q.actif && q.niveau === niveau && !sauf.has(q.id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(alea() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const voulu = R.composition[niveau];
    let pris = 0;
    for (const q of pool) { if (pris >= voulu) break; if (familles.has(q.famille)) continue; choisies.push(q); familles.add(q.famille); pris++; }
    for (const q of pool) { if (pris >= voulu) break; if (choisies.includes(q)) continue; choisies.push(q); pris++; }
  }
  return choisies;
}

// ── L'avancement ─────────────────────────────────────────────────────────────

/** La quête est-elle accomplie, vu son état ? */
function estFaite(def, etat) {
  const p = def.params || {}, e = etat || {};
  switch (def.type) {
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
};
function parole(cle, vars, alea) {
  const l = PAROLES[cle] || [''];
  const t = l[Math.floor((alea || Math.random)() * l.length) % l.length];
  return t.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? String(vars[k]) : ''));
}

module.exports = {
  NIVEAUX, NIVEAU_NOM, REGLAGES_DEFAUT, CATALOGUE, ETIQUETTES, KALUGA_EPREUVES, MODES,
  nombre, jourPlus, lundiDe, minuitParis, finDeSemaine, semaineLisible,
  reglagesNormalises, definition, catalogue, titre, tirer,
  estFaite, appliquer, avancement, modeRecevable, parole, PAROLES,
};
