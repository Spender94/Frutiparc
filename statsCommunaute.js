'use strict';
/*
 * LA SECTION « COMMUNAUTÉ » DE L'ONGLET STATISTIQUES — le calcul, à part.
 *
 * Le serveur lit les lignes brutes (db.statsCommunaute) et ce module en tire
 * les huit indicateurs : rétention, nouveaux et anciens, jours actifs,
 * joueurs différents par jeu, temps actif et sessions, participants au chat et
 * au forum, activation des inscrits, retours après une absence. Rien que des
 * fonctions pures sur des tableaux : cela se teste sans base.
 *
 * DEUX RÈGLES, partout :
 *
 *   · ON NE COMPTE PAS CE QU'ON N'A PAS VU. La présence n'est relevée que
 *     depuis `premierJour` (presence_jour), le temps actif depuis
 *     `premiereActivite` (activite_jour). Une cohorte, une absence ou une
 *     fenêtre qui commence avant ces dates ne se mesure pas : elle rend `null`,
 *     que l'onglet affiche « – », plutôt qu'un chiffre faux par défaut.
 *   · LES JOURS SONT CEUX DE PARIS, en « AAAA-MM-JJ » — comme presence_jour.
 */

function plus(jour, n) {
  const d = new Date(jour + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function ecart(a, b) {   // b − a, en jours
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}
function lundiDe(jour) {
  const d = new Date(jour + 'T12:00:00Z');
  return plus(jour, -((d.getUTCDay() + 6) % 7));
}
function mediane(l) {
  if (!l.length) return null;
  const t = l.slice().sort((a, b) => a - b), m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}
const arrondi = (v, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const taux = (n, sur) => (sur ? arrondi(100 * n / sur) : null);

// L'ancienneté d'un compte, en tranches : la croissance d'un côté, la
// communauté historique de l'autre.
const TRANCHES = [
  { cle: 'nouveaux', nom: 'moins d’un mois', max: 29 },
  { cle: 'recents', nom: '1 à 6 mois', max: 182 },
  { cle: 'installes', nom: '6 mois à 1 an', max: 365 },
  { cle: 'anciens', nom: 'plus d’un an', max: Infinity },
];
const trancheDe = (age) => TRANCHES.find((t) => age <= t.max).cle;
// Les jours actifs sur 30 jours, en paquets lisibles.
const PAQUETS_30 = [[1, 1], [2, 3], [4, 7], [8, 14], [15, 22], [23, 30]];
// Une rétention se lit sur une SEMAINE de retour : J+7 = revenu entre le 7e et
// le 13e jour après l'inscription, J+30 entre le 30e et le 36e.
const RETOURS = { j7: [7, 13], j30: [30, 36] };
// Une absence, avant le retour : 14 ou 30 jours sans se montrer.
const ABSENCES = [14, 30];

/**
 * @param {object} d
 *   aujourdhui, jours (la fenêtre, du plus ancien au plus récent),
 *   premierJour, presence [{jour,u}], inscrits [{u,jour}], forum [{jour,u}],
 *   activite [{jour,u,minutes,sessions,chat}], premiereActivite,
 *   parties [{jour,u,jeu?|rk?}], actives [u], jeuDe(rk) → jeu, pnj (Set)
 */
function calculer(d) {
  const auj = d.aujourdhui;
  const fen = d.jours || [];
  const debut = fen[0] || auj;
  const pnj = d.pnj || new Set();
  const ok = (u) => u && !pnj.has(String(u).toLowerCase());
  const p0 = d.premierJour || null;
  const vu = (jour) => !!p0 && jour >= p0;

  // Qui s'est montré, quel jour.
  const presence = new Map();   // u → Set(jour)
  const parJour = new Map();    // jour → Set(u)
  for (const r of d.presence || []) {
    if (!ok(r.u)) continue;
    const u = String(r.u).toLowerCase();
    if (!presence.has(u)) presence.set(u, new Set());
    presence.get(u).add(r.jour);
    if (!parJour.has(r.jour)) parJour.set(r.jour, new Set());
    parJour.get(r.jour).add(u);
  }
  const inscrit = new Map();
  for (const r of d.inscrits || []) if (ok(r.u) && r.jour) inscrit.set(String(r.u).toLowerCase(), r.jour);
  const present = (u, de, a) => {
    const s = presence.get(u);
    if (!s) return false;
    for (let j = de; j <= a; j = plus(j, 1)) if (s.has(j)) return true;
    return false;
  };

  /* ── 1. RÉTENTION ─────────────────────────────────────────────────────── */
  // Les inscrits d'une plage de jours, et ceux qui sont revenus dans leur
  // semaine de retour. Une cohorte d'avant les relevés, ou dont la semaine de
  // retour n'est pas finie, ne se mesure pas.
  const cohorte = (de, a, cle) => {
    const [r0, r1] = RETOURS[cle];
    if (!vu(de) || plus(a, r1) > plus(auj, -1)) return null;
    let n = 0, revenus = 0;
    for (const [u, j] of inscrit) {
      if (j < de || j > a) continue;
      n++;
      if (present(u, plus(j, r0), plus(j, r1))) revenus++;
    }
    return { du: de, au: a, inscrits: n, revenus, taux: taux(revenus, n) };
  };
  // Le chiffre du haut : les quatre dernières semaines d'inscrits mesurables.
  const recente = (cle) => {
    const fin = plus(auj, -(RETOURS[cle][1] + 1));
    const c = cohorte(plus(fin, -27), fin, cle);
    if (c || !p0) return c;
    // Les relevés sont plus jeunes que quatre semaines : on prend ce qu'il y a.
    return plus(p0, 0) <= fin ? cohorte(p0, fin, cle) : null;
  };
  const semaines = [];
  const lundi0 = lundiDe(auj);
  for (let k = 11; k >= 0; k--) {
    const l = plus(lundi0, -7 * k), dim = plus(l, 6);
    let n = 0;
    for (const [, j] of inscrit) if (j >= l && j <= dim) n++;
    semaines.push({ lundi: l, inscrits: n, j7: cohorte(l, dim, 'j7'), j30: cohorte(l, dim, 'j30') });
  }
  const retention = { j7: recente('j7'), j30: recente('j30'), semaines };

  /* ── 2. NOUVEAUX ET ANCIENS ───────────────────────────────────────────── */
  // L'âge du compte au dernier jour où on l'a vu dans la fenêtre.
  const actifsFenetre = new Map();   // u → dernier jour vu dans la fenêtre
  for (const [u, s] of presence) {
    for (const j of s) if (j >= debut && j <= auj && (!actifsFenetre.has(u) || j > actifsFenetre.get(u))) actifsFenetre.set(u, j);
  }
  const anciennete = { total: actifsFenetre.size, inconnus: 0, tranches: TRANCHES.map((t) => ({ cle: t.cle, nom: t.nom, n: 0 })) };
  for (const [u, j] of actifsFenetre) {
    const ins = inscrit.get(u);
    if (!ins) { anciennete.inconnus++; continue; }
    anciennete.tranches.find((t) => t.cle === trancheDe(Math.max(0, ecart(ins, j)))).n++;
  }

  /* ── 3. JOURS ACTIFS PAR JOUEUR ───────────────────────────────────────── */
  const joursActifs = (n) => {
    const de = plus(auj, -(n - 1));
    const par = new Map();
    for (const [u, s] of presence) {
      let k = 0;
      for (const j of s) if (j >= de && j <= auj) k++;
      if (k) par.set(u, k);
    }
    const l = Array.from(par.values());
    return {
      complet: vu(de), joueurs: l.length,
      moyenne: l.length ? arrondi(l.reduce((a, b) => a + b, 0) / l.length) : null,
      mediane: mediane(l), par,
    };
  };
  const s7 = joursActifs(7), s30 = joursActifs(30);
  const rep7 = Array.from({ length: 7 }, (_, i) => ({ jours: String(i + 1), n: 0 }));
  for (const k of s7.par.values()) rep7[k - 1].n++;
  const rep30 = PAQUETS_30.map(([a, b]) => ({ jours: a === b ? String(a) : a + '–' + b, n: 0 }));
  for (const k of s30.par.values()) rep30[PAQUETS_30.findIndex(([a, b]) => k >= a && k <= b)].n++;
  const habitues = Array.from(s30.par.entries())
    .map(([u, j30]) => ({ u, j30, j7: s7.par.get(u) || 0 }))
    .sort((a, b) => b.j30 - a.j30 || b.j7 - a.j7 || a.u.localeCompare(b.u)).slice(0, 10);
  const sansPar = (o) => { const c = Object.assign({}, o); delete c.par; return c; };

  /* ── 4. JOUEURS DIFFÉRENTS PAR JEU ────────────────────────────────────── */
  const jeux = {};
  const de7 = plus(auj, -6);
  for (const r of d.parties || []) {
    if (!ok(r.u) || r.jour < debut || r.jour > auj) continue;
    const jeu = r.jeu || (d.jeuDe ? d.jeuDe(r.rk) : null);
    if (!jeu) continue;
    const e = jeux[jeu] || (jeux[jeu] = { fenetre: new Set(), semaine: new Set() });
    const u = String(r.u).toLowerCase();
    e.fenetre.add(u);
    if (r.jour >= de7) e.semaine.add(u);
  }
  const joueursParJeu = {};
  for (const [jeu, e] of Object.entries(jeux)) joueursParJeu[jeu] = { semaine: e.semaine.size, fenetre: e.fenetre.size };

  /* ── 5. TEMPS ACTIF ET SESSIONS ───────────────────────────────────────── */
  const a0 = d.premiereActivite || null;
  const sess = { depuis: a0, joueurs: 0, minutes: 0, sessions: 0, joursJoueur: 0 };
  const sessParJour = new Map();
  const vusSess = new Set();
  const chat7 = new Set(), chatF = new Set();
  for (const r of d.activite || []) {
    if (!ok(r.u) || r.jour < debut || r.jour > auj) continue;
    const u = String(r.u).toLowerCase();
    if (Number(r.chat) > 0) { chatF.add(u); if (r.jour >= de7) chat7.add(u); }
    const m = Number(r.minutes) || 0;
    if (!m) continue;
    vusSess.add(u);
    sess.minutes += m; sess.sessions += Number(r.sessions) || 0; sess.joursJoueur++;
    const e = sessParJour.get(r.jour) || { minutes: 0, sessions: 0, joueurs: 0 };
    e.minutes += m; e.sessions += Number(r.sessions) || 0; e.joueurs++;
    sessParJour.set(r.jour, e);
  }
  sess.joueurs = vusSess.size;
  const sessions = {
    depuis: a0, joueurs: sess.joueurs, heures: arrondi(sess.minutes / 60),
    // Par joueur et par jour où il est venu ; et la longueur d'une session.
    minutesParJour: sess.joursJoueur ? arrondi(sess.minutes / sess.joursJoueur) : null,
    dureeSession: sess.sessions ? arrondi(sess.minutes / sess.sessions) : null,
    sessionsParJour: sess.joursJoueur ? arrondi(sess.sessions / sess.joursJoueur) : null,
  };

  /* ── 6. PARTICIPANTS AU CHAT ET AU FORUM ──────────────────────────────── */
  const forum7 = new Set(), forumF = new Set();
  for (const r of d.forum || []) {
    if (!ok(r.u) || r.jour < debut || r.jour > auj) continue;
    const u = String(r.u).toLowerCase();
    forumF.add(u);
    if (r.jour >= de7) forum7.add(u);
  }
  const union = (a, b) => new Set([...a, ...b]).size;
  const participants = {
    forum: { semaine: forum7.size, fenetre: forumF.size },
    // Le chat n'est relevé par joueur que depuis activite_jour.
    chat: { semaine: chat7.size, fenetre: chatF.size, depuis: a0 },
    ensemble: { semaine: union(forum7, chat7), fenetre: union(forumF, chatF) },
  };

  /* ── 7. ACTIVATION DES INSCRITS ───────────────────────────────────────── */
  const activesSet = new Set((d.actives || []).map((u) => String(u).toLowerCase()));
  let insF = 0, actF = 0;
  for (const [u, j] of inscrit) {
    if (j < debut || j > auj) continue;
    insF++;
    if (activesSet.has(u)) actF++;
  }
  const activation = { inscrits: insF, actives: actF, taux: taux(actF, insF) };

  /* ── 8. LES RETOURS APRÈS UNE ABSENCE ─────────────────────────────────── */
  // Présent le jour J, absent les N jours d'avant, inscrit avant l'absence —
  // et ces N jours relevés : sinon l'absence n'est qu'un trou dans nos notes.
  const retours = {};
  const retoursParJour = new Map();
  const derniers = [];
  for (const n of ABSENCES) retours['j' + n] = new Set();
  for (const [u, s] of presence) {
    const ins = inscrit.get(u);
    const tries = Array.from(s).sort();
    for (let i = 0; i < tries.length; i++) {
      const j = tries[i];
      if (j < debut || j > auj) continue;
      const avant = i ? tries[i - 1] : null;
      for (const n of ABSENCES) {
        const d0 = plus(j, -n);
        if (!vu(d0) || !ins || ins >= d0) continue;
        if (avant && avant >= d0) continue;
        retours['j' + n].add(u);
        if (n === ABSENCES[0]) {
          retoursParJour.set(j, (retoursParJour.get(j) || 0) + 1);
          // Combien de jours d'absence : connu si on l'a vu partir, sinon « au moins ».
          derniers.push({ u, jour: j, absence: avant ? ecart(avant, j) - 1 : null, auMoins: avant ? null : ecart(p0, j) });
        }
      }
    }
  }
  derniers.sort((a, b) => (a.jour < b.jour ? 1 : a.jour > b.jour ? -1 : a.u.localeCompare(b.u)));
  const reactives = { j14: retours.j14.size, j30: retours.j30.size, derniers: derniers.slice(0, 12) };

  /* ── Jour par jour ─────────────────────────────────────────────────────── */
  const jours = {};
  for (const j of fen) {
    const presents = parJour.get(j) || new Set();
    let nouveaux = 0;
    for (const u of presents) { const ins = inscrit.get(u); if (ins && ecart(ins, j) <= TRANCHES[0].max) nouveaux++; }
    const s = sessParJour.get(j);
    // Un jour où personne n'a été relevé reste « – », comme ses connectés.
    const releve = vu(j) && presents.size > 0;
    jours[j] = {
      nouveaux: releve ? nouveaux : null,
      anciens: releve ? presents.size - nouveaux : null,
      reactives: vu(plus(j, -ABSENCES[0])) ? (retoursParJour.get(j) || 0) : null,
      minutesParJoueur: s && s.joueurs ? arrondi(s.minutes / s.joueurs) : null,
    };
  }

  return {
    premierJour: p0, premiereActivite: a0,
    retention, anciennete,
    joursActifs: { s7: sansPar(s7), s30: sansPar(s30), repartition7: rep7, repartition30: rep30, habitues },
    joueursParJeu, sessions, participants, activation, reactives, jours,
  };
}

module.exports = { calculer, plus, ecart, lundiDe, TRANCHES, RETOURS, ABSENCES };
