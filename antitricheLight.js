'use strict';
/*
 * ══════════════════════════════════════════════════════════════════════════
 * L'ANTI-TRICHE DES PORTAGES — l'Arbre creux de MiniPixiz, l'arcade de
 * Mini-Fever
 * ══════════════════════════════════════════════════════════════════════════
 *
 * CE QUI SE FORGEAIT. Les deux classements du challenge prenaient au mot ce
 * que le navigateur disait :
 *
 *   · MiniPixiz (minipixiz_classic) — un nombre, par trois portes : le
 *     /api/saveScore du portage (`?game=minipixiz&score=…`, une ligne de
 *     console), le repli `loadVariables` des SWF (/swf/games/minipixiz/s…,
 *     sans même le plafond de plausibilité) et la fiche du bureau, dont le
 *     `$stat.$treeMax` montait au classement dès qu'il montait dans la fiche
 *     — fiche que le navigateur écrit lui aussi. Le seul garde-fou était un
 *     plafond à 200 000.
 *   · Mini-Fever (minifever_arcade) — trois nombres (palier, épreuves
 *     gagnées, jouées) contrôlés pour leur seule cohérence : la partie
 *     parfaite de l'infernal (4 000 points) se postait à la main, en une
 *     requête, sans jouer.
 *
 * CE QUI LES PROTÈGE DÉSORMAIS — le rejeu, comme Swapou et JamaJama :
 *
 *   1. un JETON au départ, signé par le serveur (HMAC) : il scelle le jeu, le
 *      joueur, la graine, le palier et l'heure. Sans jeton, pas de classement ;
 *      un jeton ne se rend qu'UNE fois ;
 *   2. le JOURNAL de la partie (public/minipixiz/rejeu.js,
 *      public/minifever/rejeu.js) : ce que le moteur a reçu, pas à pas ;
 *   3. le REJEU : le serveur repasse le même moteur sur la même graine et ne
 *      classe que ce qu'il trouve lui-même ;
 *   4. les HORLOGES : le temps de jeu que dit le journal ne peut pas dépasser
 *      le temps écoulé depuis le jeton (une partie « accélérée », ou fabriquée
 *      d'avance, tombe là) — et la cadence doit être celle d'un écran.
 *
 * Ce qui ne fait que SIGNALER (indices, l'admin juge) : les très longues
 * pauses (le jeu se fige quand la fenêtre perd le focus : légitime, mais c'est
 * aussi ce que ferait un ralenti), une cadence à la limite du possible, un
 * rythme de commandes surhumain, un score très au-dessus de l'exploit connu.
 *
 * Personne n'est banni par ce module : un score écarté n'entre pas au
 * classement, la partie est notée (table parties_verifiees), l'admin la relit
 * et peut la classer à la main.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const J = require('./public/js/journal-partie.js');
const PixizRejeu = require('./public/minipixiz/rejeu.js');
const FeverRejeu = require('./public/minifever/rejeu.js');

/*
 * LES SEUILS, et d'où ils viennent.
 *
 * Le temps. `tmod` vaut une image de 1/32 s (Timer.wantedFPS, le même dans
 * les deux jeux) : la somme des tmod d'un journal, divisée par 32, est le
 * temps de jeu en secondes. Elle suit l'horloge du navigateur à la moyenne
 * glissante près (Timer.tmod_factor = 0,95), et une image de plus d'une
 * demi-seconde est PERDUE (Timer.maxDeltaTime) : le temps de jeu ne peut donc
 * qu'être en retard sur le temps réel, de quelques images d'inertie près
 * après un gros ralentissement. 10 % et quinze secondes de marge couvrent
 * largement cette inertie et l'aller-retour du réseau.
 *
 * La cadence. Arbre : un pas par image rendue, tmod ≈ 32 / fréquence — 0,53
 * à 60 Hz, 0,22 à 144 Hz, 0,13 à 240 Hz, 0,064 à 500 Hz (les écrans les plus
 * rapides du commerce). Sous 0,05 en moyenne (plus de 640 images par
 * seconde), aucun écran ne l'a produit : c'est un ralenti. Mini-Fever : la
 * boucle n'appelle le jeu qu'à la cadence Flash (40 fois par seconde au plus,
 * client.js) — tmod ≈ 0,8 ; sous 0,4 en moyenne, c'est la moitié de ce que
 * la boucle peut produire.
 *
 * La console de Mini-Fever. Entre deux épreuves, le débriefing, le tirage, le
 * briefing et les fondus prennent un temps FIXE, mesuré sur le moteur
 * lui-même (FeverRejeu.consoleMinimale : 145 images aujourd'hui, ≈ 4,5 s). Une
 * partie de n épreuves dure au moins n consoles plus ses épreuves.
 *
 * L'exploit de l'Arbre. Le jeu d'origine plafonne ses récompenses à 8 000
 * (Cs.treeLimit) et l'exploit humain connu tourne autour de 10 000 : au-delà
 * de 30 000, une partie même vérifiée mérite un regard (un programme qui joue
 * à la place du joueur rejoue parfaitement — le rejeu prouve qu'une partie a
 * été jouée, pas QUI l'a jouée).
 */
const SEUILS = {
  jetonDureeMs: 24 * 3600 * 1000,
  tempsMarge: 1.10,
  tempsMargeMs: 15000,
  arbre: { tmodMin: 0.05, tmodSuspect: 0.08, exploit: 30000, commandesParSeconde: 20 },
  arcade: { tmodMin: 0.4, tmodSuspect: 0.6, tolerance: 25, epreuvesMax: 400 },
  // Longues pauses : plus de trois fois le temps de jeu, et cinq minutes.
  pauseFacteur: 3,
  pauseMargeMs: 300000,
};

// ── Le jeton ────────────────────────────────────────────────────────────
let secret = crypto.randomBytes(32);
function poserSecret(s) {
  if (s && String(s).length >= 16) secret = Buffer.from(String(s));
}
const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const signer = (corps) => b64(crypto.createHmac('sha256', secret).update(corps).digest()).slice(0, 32);

/** Un jeton neuf : { id, graine, jeton }. */
function creerJeton(o) {
  const id = o.id || crypto.randomBytes(12).toString('hex');
  const graine = o.graine === undefined ? crypto.randomBytes(4).readUInt32LE(0) : (o.graine >>> 0);
  const charge = { j: String(o.jeu), u: String(o.username || '').toLowerCase(), g: graine,
    m: Math.trunc(Number(o.mode) || 0), t: Number(o.t) || Date.now(), id };
  const corps = b64(JSON.stringify(charge));
  return { id, graine, t: charge.t, jeton: corps + '.' + signer(corps) };
}

/**
 * Lit un jeton. Rend la charge ({ j, u, g, m, t, id }) ou { erreur }.
 */
function lireJeton(jeton, attendu) {
  const s = String(jeton || '');
  const i = s.indexOf('.');
  if (i <= 0 || s.length > 600) return { erreur: 'jeton absent ou illisible' };
  const corps = s.slice(0, i), sig = s.slice(i + 1);
  const bon = signer(corps);
  if (sig.length !== bon.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(bon))) {
    return { erreur: 'jeton falsifié' };
  }
  let c;
  try { c = JSON.parse(Buffer.from(corps.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch { return { erreur: 'jeton illisible' }; }
  if (!c || typeof c !== 'object') return { erreur: 'jeton illisible' };
  if (attendu && attendu.jeu && c.j !== attendu.jeu) return { erreur: 'jeton d’un autre jeu' };
  if (attendu && attendu.username && c.u !== String(attendu.username).toLowerCase()) return { erreur: 'jeton donné à un autre joueur' };
  const age = (attendu && attendu.maintenant ? attendu.maintenant : Date.now()) - Number(c.t);
  if (!(age >= -5000)) return { erreur: 'jeton daté du futur' };
  if (age > SEUILS.jetonDureeMs) return { erreur: 'jeton expiré' };
  return c;
}

// Les jetons RENDUS, en mémoire (la base double ce registre : cf. le serveur).
const rendus = new Map();          // id -> horodatage
function dejaRendu(id) { return rendus.has(String(id)); }
function marquerRendu(id) {
  rendus.set(String(id), Date.now());
  if (rendus.size > 50000) {
    const limite = Date.now() - SEUILS.jetonDureeMs - 3600000;
    for (const [k, t] of rendus) if (t < limite) rendus.delete(k);
  }
}

// ── Les moteurs, chargés une fois ───────────────────────────────────────
let lieux = null;
function moteurArbre() {
  if (!lieux) lieux = require('./public/minipixiz/lieux.js');
  return lieux;
}
let fever = null;
function moteurFever() {
  if (!fever) {
    const E = require('./public/minifever/engine.js');
    const C = require('./public/minifever/client.js');
    const JX = require('./public/minifever/jeux.js');
    const manifeste = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/minifever/sprites/sprites.json'), 'utf8'));
    fever = { E, JEUX: JX.JEUX, mesures: C.mesures(manifeste), consoleMin: FeverRejeu.consoleMinimale(E) };
  }
  return fever;
}

// Les horloges, communes aux deux jeux.
function horloges(indices, tempsJeuMs, dureeMs, minimumMs) {
  // Le journal dit plus de jeu que le temps écoulé : la partie a été jouée
  // en accéléré, ou fabriquée hors du temps réel.
  if (tempsJeuMs > dureeMs * SEUILS.tempsMarge + SEUILS.tempsMargeMs) {
    return `partie plus longue que le temps écoulé depuis le départ (${Math.round(tempsJeuMs / 1000)} s de jeu en ${Math.round(dureeMs / 1000)} s)`;
  }
  if (minimumMs !== undefined && dureeMs * SEUILS.tempsMarge + SEUILS.tempsMargeMs < minimumMs) {
    return `partie rendue trop vite (${Math.round(dureeMs / 1000)} s, il en faut au moins ${Math.round(minimumMs / 1000)})`;
  }
  if (dureeMs > (minimumMs || tempsJeuMs) * SEUILS.pauseFacteur + SEUILS.pauseMargeMs) {
    indices.push(`longues pauses : ${Math.round(dureeMs / 60000)} min écoulées pour ${Math.round((minimumMs || tempsJeuMs) / 60000)} min de jeu`);
  }
  return null;
}

/**
 * L'ARBRE CREUX. `partie` = { graine, journal, scoreDeclare, dureeMs }.
 *
 * @returns {{ verdict: 'conforme'|'divergent'|'refuse', scoreVerifie: number|null,
 *             raison: string, indices: string[], details: object, tempsJeuMs: number }}
 */
function verifierArbre(partie) {
  const indices = [];
  const r = PixizRejeu.rejouer(moteurArbre(), partie.graine, partie.journal);
  const details = { pas: r.pas, tmodMoyen: Math.round(r.tmodMoyen * 1000) / 1000, multi: r.multi, couleurs: r.couleurs };
  const sortie = (verdict, raison) => ({
    verdict, raison: raison || '', indices, details, tempsJeuMs: r.tempsJeuMs,
    scoreVerifie: verdict === 'conforme' ? r.score : (r.ok ? r.score : null),
  });
  if (!r.ok) return sortie('divergent', r.raison);
  const declare = Math.round(Number(partie.scoreDeclare));
  if (r.score !== declare) return sortie('divergent', `score rejoué ${r.score}, déclaré ${declare}`);
  if (r.tmodMoyen < SEUILS.arbre.tmodMin) {
    return sortie('refuse', `cadence impossible (${details.tmodMoyen} image par pas : plus de ${Math.round(32 / r.tmodMoyen)} images par seconde)`);
  }
  if (r.tmodMoyen < SEUILS.arbre.tmodSuspect) indices.push(`cadence très haute (${Math.round(32 / r.tmodMoyen)} images par seconde)`);
  const horl = horloges(indices, r.tempsJeuMs, Number(partie.dureeMs) || 0);
  if (horl) return sortie('refuse', horl);
  // Le rythme des commandes : combien de fois l'une des quatre change d'état
  // par seconde de jeu. Un joueur rapide en fait quelques-unes ; un programme,
  // autant qu'il veut.
  const lu = PixizRejeu.lireJournal(partie.journal);
  let changements = 0;
  for (let i = 2; i < lu.pas.length; i += 2) if (lu.pas[i + 1] !== lu.pas[i - 1]) changements++;
  const parSeconde = r.tempsJeuMs ? changements / (r.tempsJeuMs / 1000) : 0;
  details.commandesParSeconde = Math.round(parSeconde * 10) / 10;
  if (parSeconde > SEUILS.arbre.commandesParSeconde) indices.push(`rythme de commandes surhumain (${details.commandesParSeconde} par seconde)`);
  if (r.score > SEUILS.arbre.exploit) indices.push(`score très au-dessus de l'exploit connu (${r.score} > ${SEUILS.arbre.exploit})`);
  return sortie('conforme', '');
}

/**
 * L'ARCADE DE MINI-FEVER. `partie` = { graine, palier, journal (objet ou
 * texte JSON), declare: { niveau, jouees, gagnee }, dureeMs }.
 *
 * @returns {{ verdict, niveauVerifie, gagneesVerifiees: string[], raison,
 *             indices, details, tempsJeuMs }}
 */
function verifierArcade(partie) {
  const { E, JEUX, mesures, consoleMin } = moteurFever();
  const indices = [];
  const details = {};
  const sortie = (verdict, raison, extra) => Object.assign({
    verdict, raison: raison || '', indices, details, niveauVerifie: 0, gagneesVerifiees: [], tempsJeuMs: 0,
  }, extra || {});
  const info = E.PALIERS[partie.palier];
  if (!info || !info.nom) return sortie('refuse', 'palier inconnu');
  let j = partie.journal;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { j = null; } }
  if (!j || j.v !== FeverRejeu.VERSION || !Array.isArray(j.epreuves)) return sortie('divergent', 'journal illisible');
  const eps = j.epreuves;
  if (!eps.length) return sortie('divergent', 'journal vide');
  if (eps.length > SEUILS.arcade.epreuvesMax) return sortie('divergent', 'partie démesurée');
  // Le déroulé : les difficultés et la fin de partie suivent la règle du jeu.
  const verdicts = eps.map((e) => !!(e && e.g));
  const d = FeverRejeu.derouler(info, verdicts);
  details.epreuves = eps.length;
  if (!d.ok) return sortie('divergent', d.raison);
  for (let k = 0; k < eps.length; k++) {
    if (Math.trunc(Number(eps[k].d)) !== d.difs[k]) {
      return sortie('divergent', `épreuve ${k + 1} : difficulté ${eps[k].d}, le jeu donne ${d.difs[k]}`);
    }
  }
  const dec = partie.declare || {};
  if (Number(dec.niveau) !== d.niveau || Number(dec.jouees) !== d.jouees) {
    return sortie('divergent', `bilan déclaré (${dec.niveau}/${dec.jouees}) ≠ journal (${d.niveau}/${d.jouees})`);
  }
  // Chaque épreuve, rejouée seule sur sa graine.
  let accord = 0, ecarts = 0, tmod = 0, images = 0;
  const gagnees = [];
  const raisons = [];
  for (let k = 0; k < eps.length; k++) {
    const r = FeverRejeu.rejouerEpreuve({ E, JEUX, mesures }, partie.graine, k, eps[k]);
    tmod += r.tmod; images += r.images;
    if (r.ok && r.gagne === verdicts[k]) {
      accord++;
      if (r.gagne) gagnees.push(eps[k].c);
    } else {
      ecarts++;
      if (raisons.length < 3) raisons.push(r.ok ? `épreuve ${k + 1} (${eps[k].c}) : rejouée ${r.gagne ? 'gagnée' : 'perdue'}, déclarée ${verdicts[k] ? 'gagnée' : 'perdue'}` : r.raison);
    }
  }
  const tempsJeuMs = Math.round(tmod / J.QUANTUM_TMOD / 32 * 1000);
  const tmodMoyen = images ? tmod / images / J.QUANTUM_TMOD : 0;
  Object.assign(details, { accord, ecarts, images, tmodMoyen: Math.round(tmodMoyen * 1000) / 1000, consoleMin });
  const extra = { niveauVerifie: gagnees.length, gagneesVerifiees: gagnees, tempsJeuMs };
  // Une épreuve d'écart sur vingt-cinq est tolérée : les mini-jeux calculent
  // en sinus et en puissances, que deux navigateurs peuvent arrondir au
  // dernier bit près différemment. Elle ne rapporte rien (seules les
  // victoires rejouées comptent), mais ne jette pas la partie.
  const tolere = Math.max(1, Math.floor(eps.length / SEUILS.arcade.tolerance));
  if (ecarts > tolere) return sortie('divergent', `${ecarts} épreuve(s) sur ${eps.length} ne se rejouent pas comme déclaré — ${raisons.join(' ; ')}`, extra);
  if (tmodMoyen < SEUILS.arcade.tmodMin) {
    return sortie('refuse', `cadence impossible (${details.tmodMoyen} image par appel, la boucle en donne 0,8)`, extra);
  }
  if (tmodMoyen < SEUILS.arcade.tmodSuspect) indices.push(`cadence anormale (${details.tmodMoyen} image par appel)`);
  // Le minimum : les épreuves elles-mêmes, plus une console entre chacune.
  const minimumMs = Math.round((tmod / J.QUANTUM_TMOD + eps.length * consoleMin) / 32 * 1000);
  details.minimumMs = minimumMs;
  const horl = horloges(indices, tempsJeuMs, Number(partie.dureeMs) || 0, minimumMs);
  if (horl) return sortie('refuse', horl, extra);
  if (ecarts) {
    indices.push(`${ecarts} épreuve(s) rejouée(s) autrement que déclaré (${raisons.join(' ; ')})`);
    return sortie('ecart', '', extra);
  }
  return sortie('conforme', '', extra);
}

/*
 * ── L'AUDIT des scores déjà classés (lecture seule) ─────────────────────
 *
 * Les scores d'avant la vérification n'ont pas de journal : on ne peut que
 * les CONFRONTER à ce que le reste de la base sait du joueur.
 *
 *   MiniPixiz — la fiche (slot 0) tient le record personnel de l'arbre
 *   ($stat.$treeMax, écrit par le portage à chaque record) et le compte des
 *   parties d'arbre ($stat.$game[4], +1 à chaque entrée dans l'arbre). Un
 *   score du challenge AU-DESSUS du record de la fiche, ou un joueur classé
 *   qui n'est jamais entré dans l'arbre, n'a pas été joué dans le portage.
 *
 *   Mini-Fever — une épreuve gagnée pour la première fois donne son picto.
 *   Celui qui a gagné n épreuves tirées au sort parmi 27 en a vu, en
 *   moyenne, 27 × (1 − (26/27)^n) différentes : un joueur classé avec bien
 *   moins de pictos que ça a posté son score sans jouer (la requête forgée
 *   oublie la liste des épreuves gagnées). Et un score qui n'est pas un
 *   multiple exact du barème ne sort pas du serveur.
 *
 *   Les deux — après la mise en service, un score classé sans partie
 *   vérifiée du même jour derrière lui est passé par une porte dérobée.
 *
 * `gravite` : 'fort' (le score ne peut pas venir du jeu), 'moyen' (très
 * improbable), 'faible' (à regarder).
 */
const NB_EPREUVES = 27;
function pictosAttendus(n) { return NB_EPREUVES * (1 - Math.pow((NB_EPREUVES - 1) / NB_EPREUVES, n)); }

function auditer(o) {
  const out = [];
  const PALIERS = (o && o.paliers) || require('./public/minifever/engine.js').PALIERS;
  const pire = (a, b) => (['faible', 'moyen', 'fort'].indexOf(a) >= ['faible', 'moyen', 'fort'].indexOf(b) ? a : b);
  for (const s of (o && o.arbre) || []) {
    const raisons = [];
    let g = null;
    const note = (grav, txt) => { raisons.push(txt); g = g ? pire(grav, g) : grav; };
    const f = s.fiche;
    const score = Number(s.score) || 0;
    // Adossé à une partie rejouée conforme : la preuve est faite, la fiche
    // n'a plus rien à dire.
    if (Number(s.verifie) >= score) continue;
    if (!f) note('faible', 'pas de fiche MiniPixiz à confronter');
    else {
      if (score > (Number(f.treeMax) || 0)) note('fort', `score au-dessus du record personnel de la fiche (${Number(f.treeMax) || 0})`);
      if (!(Number(f.partiesArbre) > 0)) note('fort', 'aucune partie d’arbre dans la fiche');
    }
    if (score > SEUILS.arbre.exploit) note('moyen', `au-delà de l'exploit connu (${SEUILS.arbre.exploit})`);
    if (s.verificationActive && !(Number(s.verifie) >= score)) note('fort', 'aucune partie vérifiée derrière ce score');
    if (raisons.length) out.push({ jeu: 'minipixiz', username: s.username, jour: s.jour, score, gravite: g, raisons });
  }
  for (const s of (o && o.arcade) || []) {
    const raisons = [];
    let g = null;
    const note = (grav, txt) => { raisons.push(txt); g = g ? pire(grav, g) : grav; };
    const score = Number(s.score) || 0;
    if (Number(s.verifie) >= score) continue;
    const p = Number.parseInt(String(s.data == null ? '' : s.data), 10);
    const info = PALIERS[p];
    let niveau = null;
    if (!info || !info.nom) note('fort', `palier illisible (« ${String(s.data).slice(0, 10)} »)`);
    else {
      const unite = 10 * (1 + p);
      if (score % unite !== 0) note('fort', `score qui n'est pas un multiple du barème (${unite})`);
      else {
        niveau = score / unite;
        if (niveau > info.lvl) note('fort', `plus d'épreuves gagnées (${niveau}) que le palier n'en compte (${info.lvl})`);
        else if (niveau === info.lvl && p >= 2) note('faible', `palier ${info.nom} terminé`);
      }
    }
    if (niveau !== null && niveau >= 10 && s.pictos !== null && s.pictos !== undefined) {
      const attendu = pictosAttendus(niveau);
      if (Number(s.pictos) < Math.floor(attendu / 3)) {
        note('moyen', `${s.pictos} picto(s) Mini-Fever pour ${niveau} épreuves gagnées (on en attend ≈ ${Math.round(attendu)})`);
      }
    }
    if (s.verificationActive && !(Number(s.verifie) >= score)) note('fort', 'aucune partie vérifiée derrière ce score');
    if (raisons.length) out.push({ jeu: 'minifever', username: s.username, jour: s.jour, score, gravite: g, raisons });
  }
  const ordre = { fort: 0, moyen: 1, faible: 2 };
  return out.sort((a, b) => ordre[a.gravite] - ordre[b.gravite] || String(b.jour).localeCompare(String(a.jour)) || b.score - a.score);
}

/*
 * ── LE FIL DU REJEU ─────────────────────────────────────────────────────
 *
 * Rejouer coûte du calcul pur : quelques dizaines de millisecondes pour une
 * partie ordinaire, quelques centaines pour un quart d'heure d'arbre sur un
 * écran rapide ou cent épreuves d'arcade. Dans la boucle du serveur, ce serait
 * le chat et les autres jeux figés d'autant. Le rejeu tourne donc dans un fil
 * à part (antitricheFil.js), une partie après l'autre — comme Swapou. Si le
 * fil tombe ou traîne, la partie est « non vérifiable » : elle n'est pas
 * classée, et l'admin peut la rejouer puis la classer.
 */
const DELAI_FIL_MS = 30000;
let fil = null;
let numero = 0;
const enAttente = new Map();          // n -> { resoudre, minuteur }
function filDuRejeu() {
  if (fil) return fil;
  const { Worker } = require('worker_threads');
  const w = new Worker(path.join(__dirname, 'antitricheFil.js'));
  w.unref();
  w.on('message', (m) => {
    const a = m && enAttente.get(m.n);
    if (!a) return;
    enAttente.delete(m.n);
    clearTimeout(a.minuteur);
    a.resoudre(m.erreur ? nonVerifiable('rejeu en panne : ' + m.erreur) : m.resultat);
  });
  const tomber = (raison) => {
    if (fil !== w) return;
    fil = null;
    for (const [n, a] of enAttente) {
      clearTimeout(a.minuteur);
      a.resoudre(nonVerifiable(raison));
      enAttente.delete(n);
    }
  };
  w.on('error', (e) => tomber('fil de rejeu en panne : ' + e.message));
  w.on('exit', () => tomber('fil de rejeu arrêté'));
  fil = w;
  return w;
}
function nonVerifiable(raison) {
  return { verdict: 'non_verifiable', raison, indices: [], details: {}, scoreVerifie: null,
    niveauVerifie: 0, gagneesVerifiees: [], tempsJeuMs: 0 };
}
/** Le rejeu, hors de la boucle du serveur. `type` : 'arbre' ou 'arcade'. */
function verifierEnFil(type, partie) {
  return new Promise((resoudre) => {
    let w;
    try { w = filDuRejeu(); } catch (e) { resoudre(nonVerifiable('fil de rejeu indisponible : ' + e.message)); return; }
    const n = ++numero;
    const minuteur = setTimeout(() => {
      enAttente.delete(n);
      resoudre(nonVerifiable('rejeu trop long'));
      // Un rejeu qui ne rend pas la main : on relance un fil neuf.
      if (fil === w) { fil = null; w.terminate().catch(() => {}); }
    }, DELAI_FIL_MS);
    if (minuteur.unref) minuteur.unref();
    enAttente.set(n, { resoudre, minuteur });
    try { w.postMessage({ n, type, partie }); } catch (e) {
      enAttente.delete(n);
      clearTimeout(minuteur);
      resoudre(nonVerifiable('fil de rejeu indisponible : ' + e.message));
    }
  });
}

module.exports = {
  SEUILS, poserSecret, creerJeton, lireJeton, dejaRendu, marquerRendu,
  verifierArbre, verifierArcade, verifierEnFil, auditer, pictosAttendus, moteurFever,
};
