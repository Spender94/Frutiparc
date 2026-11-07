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
 *   5. les BATTEMENTS (cf. plus bas, « LE RALENTI ») : pendant la partie, le
 *      jeu dit toutes les deux secondes où en est son journal, et c'est
 *      l'horloge du SERVEUR qui date chaque battement. Un jeu ralenti par une
 *      extension (« speed hack ») avance moins vite que cette horloge-là :
 *      sa partie n'est pas classée.
 *
 * Ce qui ne fait que SIGNALER (indices, l'admin juge) : les très longues
 * pauses (le jeu se fige quand la fenêtre perd le focus : légitime, mais c'est
 * aussi ce que ferait un ralenti), une cadence à la limite du possible, un
 * rythme de commandes surhumain, un score très au-dessus de l'exploit connu,
 * un jeu un peu en retard sur l'horloge du serveur, des pauses en rafale.
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
 *
 * Le rythme de l'Arbre (un indice pour l'admin, il n'écarte rien). Le
 * multiplicateur ne monte qu'avec le TEMPS DE JEU (base/Tree : un tour
 * d'escargot = ARBRE_TEMPS = 1000 images ≈ 31 s, la chute accélère à chaque
 * tour) : ×1 jusqu'à 1 min 34 s de jeu, ×2 jusqu'à 5 min 12 s, ×3 jusqu'à
 * 10 min 25 s, ×4 ensuite. Un gros score se gagne donc surtout en durant. Le
 * joueur au hasard du banc d'essai (test/aideAntitriche.js, vingt-cinq
 * graines) fait 100 à 430 points par minute de jeu ; l'exploit connu
 * (≈ 10 000) en une dizaine de minutes en fait un millier. Au-delà de 2 500
 * points par minute sur une partie qui pèse (3 000 points et plus), la partie
 * mérite un regard ; au double, un regard appuyé. Ces deux nombres sont des
 * estimations à revoir quand les vraies parties se seront accumulées : le
 * second signal, lui, se cale tout seul — une partie qui va plus de deux fois
 * plus vite que le 9e décile des parties conformes de la période (même jeu,
 * même palier, au moins dix parties de référence).
 */
const SEUILS = {
  jetonDureeMs: 24 * 3600 * 1000,
  tempsMarge: 1.10,
  tempsMargeMs: 15000,
  arbre: { tmodMin: 0.05, tmodSuspect: 0.08, exploit: 30000, commandesParSeconde: 20,
    pointsParMinute: 2500, scoreRythme: 3000 },
  arcade: { tmodMin: 0.4, tmodSuspect: 0.6, tolerance: 25, epreuvesMax: 400, victoiresRythme: 10 },
  // Longues pauses : plus de trois fois le temps de jeu, et cinq minutes.
  pauseFacteur: 3,
  pauseMargeMs: 300000,
  // Le rythme comparé aux autres : facteur au-dessus du 9e décile, nombre
  // minimal de parties conformes pour que ce décile veuille dire quelque chose ;
  // `facteurFort` : au-delà de tant de fois le seuil, le signal est fort.
  rythme: { facteurDecile: 2, referenceMin: 10, facteurFort: 2 },
  // Les battements et le ralenti : cf. « LE RALENTI », plus bas, pour la
  // provenance de chaque nombre.
  battements: {
    periodeMs: 2000, periodePauseMs: 10000,
    parPartie: 3000, partiesParJoueur: 6, partiesMax: 20000,
    debitCapacite: 30, debitParSeconde: 2,
    intervalleMinMs: 1000,
    rapportRefus: 0.8, rapportIndice: 0.9, intervallesMin: 20,
    globalRefus: 0.6, globalIndice: 0.75, globalReelMinMs: 40000,
    jeuSignificatifMs: 60000, couvertureMin: 0.75, actifsMinAbsents: 10, trouMs: 20000,
    masqueRefus: 0.5, masqueIndice: 0.2, masqueRefusMs: 30000, masqueIndiceMs: 15000,
    excesFacteur: 1.1, excesIndiceMs: 5000, excesRefusMs: 10000,
    transitionsParMinute: 6, transitionsDureeMinMs: 120000, pauseCourteMs: 5000,
  },
  // La tendance : cinq parties conformes d'affilée (de plus d'une minute de
  // jeu chacune) dont la durée réelle dépasse une fois et demie le temps de
  // jeu. Une alerte à 5, 10, 15… parties de suite, pas à chacune.
  tendance: { parties: 5, rapport: 1.5, jeuMinMs: 60000, lecture: 20 },
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

/*
 * ══════════════════════════════════════════════════════════════════════════
 * LE RALENTI — les battements, datés par le serveur
 * ══════════════════════════════════════════════════════════════════════════
 *
 * LA FAILLE. Les deux moteurs avancent selon l'horloge du NAVIGATEUR
 * (requestAnimationFrame, performance.now). Une extension de « speed hack »
 * ralentit cette horloge — et les minuteries avec elle : tout le jeu tourne
 * deux fois moins vite, le joueur a deux fois plus de temps pour réfléchir à
 * chaque pièce. Le journal est authentique (c'est bien ce que le moteur a
 * reçu), le rejeu retombe juste, la partie se classe. Aucun contrôle d'avant
 * ne l'attrapait :
 *   · la cadence : un ralenti ×2 sur un écran à 60 Hz donne des pas de
 *     0,27 image — ce que donne un écran à 120 Hz ;
 *   · les horloges : le temps de jeu reste SOUS le temps réel (c'est l'inverse
 *     de l'accéléré), et un temps réel très supérieur n'est qu'un indice
 *     « longues pauses » — le jeu se fige légitimement quand la fenêtre perd
 *     le focus.
 *
 * LA PARADE. Seule l'horloge du serveur est sûre. Pendant une partie
 * vérifiée (du jeton à l'envoi de la fin), le jeu envoie un BATTEMENT toutes
 * les deux secondes (public/js/journal-partie.js, battements) :
 * `{ id, n, pas, pause, console }` — le numéro d'ordre, le nombre de pas déjà
 * écrits au journal, et l'état. Il en envoie un AUSSITÔT à chaque changement
 * d'état (pause posée ou levée, épreuve finie ou lancée) et un juste avant la
 * fin. Le serveur note l'heure d'ARRIVÉE (noterBattement). À la fin, il
 * recalcule depuis le journal le temps de jeu à chaque pas — la somme des
 * tmod / 32, comme le rejeu — et compare, battement après battement, le jeu
 * écoulé à l'heure écoulée (examinerBattements). Un speed hack ralentit
 * aussi les minuteries : les battements arrivent plus espacés, et c'est sans
 * importance, puisque c'est le serveur qui date.
 *
 * Le compteur `pas`, jeu par jeu :
 *   · l'Arbre — le nombre de pas de l'enregistreur (rejeu.js, `nombre`), un
 *     par appel du moteur. Le serveur relit le journal et cumule les tmod.
 *     La pause de l'Arbre (P, Échap, le bouton, la fenêtre passée derrière)
 *     ne fait AUCUN pas, et cache le plateau sous un voile violet à 90 % :
 *     le jeu dit `pause: 1`, comme pendant le bouquet d'ouverture, le panneau
 *     d'expérience et les cinématiques, où le moteur de l'arbre ne fait pas
 *     de pas non plus.
 *   · Mini-Fever — le journal ne garde QUE les épreuves (de leur lancement à
 *     leur verdict) ; la console qui les sépare (débriefing, tirage,
 *     briefing, fondus) n'y est pas. Le compteur est donc celui des images
 *     JOURNALISÉES, toutes épreuves bout à bout, et le battement dit
 *     `console: 1` quand aucune épreuve n'est en cours. Le serveur sait
 *     reconstituer la console : elle dure un temps de jeu FIXE
 *     (FeverRejeu.consoleMinimale, 145 images à une image par pas ; mesuré à
 *     0,4, 0,53, 0,8 et 1,6 image par pas, irrégulier ou non : 136 à 147,
 *     ±4 %). La ligne du temps de jeu d'une arcade est donc : les images de
 *     l'épreuve 1, une console, les images de l'épreuve 2, une console… Un
 *     battement pris DANS une console n'a pas de position connue (on ne sait
 *     pas où elle en est) : il est sauté, et l'intervalle qui l'enjambe va du
 *     dernier battement d'une épreuve au premier de la suivante, console
 *     comprise. La console n'est donc PAS une pause : elle se compte. La
 *     vraie pause de Mini-Fever (la fenêtre passée derrière) fige tout, ne
 *     fait aucune image, et pose un voile noir à 50 %.
 *
 * Ce qu'on en tire (examinerBattements), sur les battements remis dans
 * l'ordre où le jeu les a envoyés (`n`), dans cet ordre :
 *   1. le compteur ne recule jamais et ne dépasse jamais le journal final —
 *      sinon le battement ment : REFUS ;
 *   2. les intervalles ACTIFS — aucun battement en pause d'un bout à l'autre
 *      (ni aux deux bouts, ni sur un battement de console sauté entre eux :
 *      la pause peut tomber pendant une console), du jeu entre eux, au moins
 *      une seconde réelle — donnent chacun un rapport jeu / réel. Leur
 *      MÉDIANE vaut ≈ 1 chez un joueur normal, ≈ 0,5 sous un ralenti ×2. La
 *      médiane, et pas la somme : une pause commencée en cours d'intervalle
 *      (un battement perdu) fait un intervalle aberrant, pas une tendance.
 *      Sous le seuil, sur assez d'intervalles : REFUS ; entre le seuil et
 *      0,9 : indice ;
 *   3. le jeu sous les pauses : un intervalle en pause ne compte pas — mais
 *      le jeu qui s'y écoule se mesure. Une vraie pause n'en masque presque
 *      rien (le battement part à l'instant où elle commence et à l'instant où
 *      elle finit). Des pauses déclarées un battement sur deux pour masquer
 *      le ralenti en masquent presque tout : REFUS au-delà de la moitié du
 *      jeu (et trente secondes), indice au-delà d'un cinquième. Les bascules
 *      pause ↔ jeu par minute et les pauses très courtes se lisent aussi
 *      (indice au-delà de six par minute sur deux minutes) ;
 *   4. une partie qui pèse (plus d'une minute de jeu) dont le jeu n'est pas
 *      couvert aux trois quarts par des intervalles actifs : les battements
 *      ont été bloqués — en tout, ou le temps de jouer au ralenti, ce qui
 *      laisse un TROU (plus de vingt secondes sans battement en plein jeu ;
 *      le jeu d'un trou n'est pas couvert) — REFUS (« battements absents »,
 *      gravité « suspect »). Tant pis pour un réseau très capricieux : l'admin
 *      peut classer à la main ;
 *   5. la SOMME des intervalles actifs (temps de jeu sur temps réel,
 *      intervalles sans jeu et trous compris) : elle attrape le compteur qui
 *      « prend de l'avance » puis reste figé sans se dire en pause, que la
 *      médiane ne voit pas ;
 *   6. entre DEUX battements quelconques (et jusqu'à la fin, reçue elle aussi
 *      à l'heure du serveur), le jeu n'a pas pu avancer plus vite que
 *      l'horloge du serveur, au facteur 1,1 près et dix secondes de marge —
 *      celle d'un battement resté coincé dans le réseau : REFUS. C'est le
 *      compteur qui « rattrape » d'un coup ce qu'il avait annoncé en retard.
 *
 * Les SEUILS (SEUILS.battements) ont été relevés le 7 novembre 2026 sur de
 * vraies parties jouées dans Chromium (sans écran, 60 Hz) par un script —
 * clavier pour l'Arbre, souris pour l'arcade facile —, contre ce serveur :
 *
 *                              Arbre creux           Mini-Fever
 *     normale                  médiane 1,00          1,00
 *                              somme 1,004           1,001
 *     deux pauses de 32 s      1,00 (1,2 % masqué)   1,00 (0,3 à 3,6 %)
 *     ralenti ×2               0,50                  0,50
 *     ralenti ×1,3             0,769                 0,769
 *     battements bloqués       0 reçu : refusée      0 reçu : refusée
 *     fausses pauses, ×2       0 actif, 100 % masqué 6 actifs, 76 % masqué
 *                              90 bascules           85 bascules
 *
 * (La couverture d'une partie normale : 98 à 99 % ; 94 % quand une pause
 * tombe pendant une console, que l'intervalle qui l'enjambe masque. Le
 * rapport réel / jeu : 1,01 et 0,97 à 0,98 en partie normale, 1,37 et 1,50
 * à 1,60 avec les deux pauses, 2,01 et 1,96 au ralenti ×2.)
 *
 * D'où : le refus sous 0,8 — un ralenti de 25 % et plus ; à ×1,3 la partie
 * tombe à 0,77 et elle est refusée —, l'indice sous 0,9 (un ralenti de 10 à
 * 25 % : on le voit, l'admin juge), sur au moins vingt intervalles (≈
 * quarante secondes de jeu ; une partie plus courte ne pèse rien au
 * classement, l'Arbre reste à ×1 jusqu'à 1 min 34 s de jeu). Un écran normal
 * ne perd que les images de plus d'une demi-seconde (Timer.maxDeltaTime) :
 * les parties relevées tournaient jusqu'à cinq navigateurs à la fois sur la
 * même machine, et la médiane n'a pas bougé de 1,00. La somme : refus sous
 * 0,6, indice sous 0,75 — plus large que la médiane, parce qu'une image figée
 * par le système, non déclarée, la tire vers le bas sans rien dire. Le jeu sous les
 * pauses : une vraie pause en masque au plus un battement (deux secondes) ;
 * trente pauses dans une partie de dix minutes, c'est encore 10 %, loin des
 * 50 % du refus. La couverture : 98 % d'ordinaire, le refus à 75 % laisse une
 * minute de réseau coupé sur cinq.
 *
 * CE QUI RESTE CONTOURNABLE (dit tel quel) — le battement est écrit par le
 * navigateur, le serveur n'en garantit que l'HEURE :
 *   · un ralenti léger : ×1,1 donne 0,91 (rien), ×1,15 donne 0,87 (un
 *     indice) ; c'est 10 à 15 % de temps de réflexion en plus ;
 *   · de FAUSSES pauses longues (et non plus un battement sur deux) : le
 *     tricheur outillé fait « avancer » son compteur au rythme de l'horloge
 *     du serveur, puis se déclare en pause le temps que le jeu ralenti
 *     rattrape — la partie ressemble à celle d'un joueur qui fait de grandes
 *     pauses. Le temps réel le trahit quand même : la TENDANCE
 *     (tendanceRalenti) relève les joueurs dont les parties durent, l'une
 *     après l'autre, bien plus que leur temps de jeu (2 sous un ralenti ×2) ;
 *   · bloquer les battements d'une partie de moins d'une minute de jeu : rien
 *     n'est exigé d'elle (elle ne pèse rien) ; en bloquer un quart sur une
 *     partie plus longue : la couverture passe encore ;
 *   · la pause elle-même, honnête : elle fige le jeu, mais laisse voir le
 *     plateau sous son voile (90 % à l'Arbre, 50 % à Mini-Fever) — qui pause
 *     sans arrêt pour réfléchir n'est pas un ralenti ; la tendance et les
 *     « pauses en rafale » le montrent, l'admin juge ;
 *   · et toujours : le rejeu prouve qu'une partie a été jouée, pas QUI l'a
 *     jouée (un programme qui joue à la place du joueur suit l'horloge).
 */
const B = SEUILS.battements;
const DEMARRAGE = Date.now();          // une partie née avant ce démarrage n'a pas pu tout battre

// Le registre, en mémoire : id -> { u, jeu, t0, liste, plein, reprise, vu }.
const registre = new Map();
const parJoueur = new Map();           // username -> [id…], du plus ancien au plus récent

function oublier(id) {
  const e = registre.get(id);
  if (!e) return;
  registre.delete(id);
  const l = parJoueur.get(e.u);
  if (l) {
    const i = l.indexOf(id);
    if (i >= 0) l.splice(i, 1);
    if (!l.length) parJoueur.delete(e.u);
  }
}

/**
 * Une partie vérifiée commence (le jeton vient d'être donné). `reprise` : la
 * partie est née avant ce démarrage du serveur et se réinscrit à son premier
 * battement — ses battements d'avant sont perdus, on ne les exigera pas.
 */
function ouvrirBattements(id, username, jeu, t0, o) {
  id = String(id);
  const u = String(username || '').toLowerCase();
  if (registre.has(id)) return registre.get(id);
  const maintenant = Date.now();
  // Le ménage : les jetons expirés, puis le plafond global.
  if (registre.size >= B.partiesMax) {
    for (const [k, e] of registre) if (maintenant - e.t0 > SEUILS.jetonDureeMs) oublier(k);
    for (const k of registre.keys()) { if (registre.size < B.partiesMax) break; oublier(k); }
  }
  const e = { u, jeu: String(jeu || ''), t0: Number(t0) || maintenant, liste: [], plein: false,
    reprise: !!(o && o.reprise), vu: maintenant };
  registre.set(id, e);
  const l = parJoueur.get(u) || [];
  l.push(id);
  // Un joueur ne mène pas six parties à la fois : la plus ancienne, sans
  // doute abandonnée, part. (Si elle revient, ses battements manquent — et
  // c'est voulu : ouvrir des parties pour en chasser une ne la blanchit pas.)
  while (l.length > B.partiesParJoueur) {
    const vieux = l.shift();
    registre.delete(vieux);
  }
  parJoueur.set(u, l);
  return e;
}

/** Le débit : un seau de trente battements, qui se remplit de deux par seconde. */
const seaux = new Map();               // username -> { j, t }
function debitBattement(username, maintenant) {
  const t = maintenant || Date.now();
  const u = String(username || '').toLowerCase();
  const s = seaux.get(u) || { j: B.debitCapacite, t };
  s.j = Math.min(B.debitCapacite, s.j + (t - s.t) / 1000 * B.debitParSeconde);
  s.t = t;
  if (s.j < 1) { seaux.set(u, s); return false; }
  s.j -= 1;
  seaux.set(u, s);
  if (seaux.size > 20000) for (const [k, v] of seaux) if (t - v.t > 60000) seaux.delete(k);
  return true;
}

const entier = (v, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

/**
 * Un battement reçu. Rend { ok: true } ou { erreur } :
 *   'inconnue'      aucune partie ouverte sous ce numéro ;
 *   'autre_joueur'  la partie est à quelqu'un d'autre ;
 *   'battement'     un champ illisible ;
 *   'pleine'        le plafond de battements de la partie est atteint.
 */
function noterBattement(id, username, b, maintenant) {
  const e = registre.get(String(id || ''));
  if (!e) return { erreur: 'inconnue' };
  if (e.u !== String(username || '').toLowerCase()) return { erreur: 'autre_joueur' };
  const pas = entier(b && b.pas, 2000000);          // PAS_MAX de rejeu.js
  const n = entier(b && b.n, 1e7);
  if (pas === null || n === null) return { erreur: 'battement' };
  if (e.liste.length >= B.parPartie) { e.plein = true; return { erreur: 'pleine' }; }
  const t = Number(maintenant) || Date.now();
  e.liste.push({ t, n, pas, pause: b.pause ? 1 : 0, console: b.console ? 1 : 0 });
  e.vu = t;
  return { ok: true };
}

/**
 * La partie est rendue : ses battements sortent du registre. `t0` : l'heure
 * du jeton. Rend { liste, exiges, plein } — `exiges` est faux pour une partie
 * née avant ce démarrage du serveur (ses premiers battements sont perdus).
 */
function fermerBattements(id, username, t0) {
  id = String(id || '');
  const e = registre.get(id);
  const ne = Number(t0) || 0;
  if (!e || e.u !== String(username || '').toLowerCase()) {
    return { liste: [], exiges: ne >= DEMARRAGE, plein: false };
  }
  oublier(id);
  return { liste: e.liste, exiges: !e.reprise && ne >= DEMARRAGE, plein: e.plein };
}

// Les battements, gardés dans details.battementsBruts pour pouvoir rejouer
// la partie plus tard (onglet « Portages vérifiés ») : « B1 », puis des
// entiers (journal-partie.js) — exigés, plein, fin − t0, et par battement
// l'écart d'heure, l'écart de pas, l'état (pause + 2 × console), l'écart de
// numéro. Trois mille battements tiennent en une vingtaine de kilo-octets.
function encoderBattements(bat, t0) {
  if (!bat || !Array.isArray(bat.liste)) return '';
  const ent = [bat.exiges ? 1 : 0, bat.plein ? 1 : 0, Math.round((Number(bat.fin) || 0) - (Number(t0) || 0))];
  let t = Number(t0) || 0, pas = 0, n = 0;
  for (const b of bat.liste) {
    ent.push(Math.round(b.t - t), b.pas - pas, (b.pause ? 1 : 0) + (b.console ? 2 : 0), b.n - n);
    t = b.t; pas = b.pas; n = b.n;
  }
  return 'B1' + J.encoder(ent);
}
function decoderBattements(s, t0) {
  const txt = String(s || '');
  if (txt.slice(0, 2) !== 'B1') return null;
  const ent = J.decoder(txt.slice(2));
  if (!ent || ent.length < 3 || (ent.length - 3) % 4) return null;
  const base = Number(t0) || 0;
  const out = { exiges: !!ent[0], plein: !!ent[1], fin: base + ent[2], t0: base, liste: [] };
  let t = base, pas = 0, n = 0;
  for (let i = 3; i < ent.length; i += 4) {
    t += ent[i]; pas += ent[i + 1]; n += ent[i + 3];
    out.liste.push({ t, pas, pause: ent[i + 2] & 1, console: (ent[i + 2] >> 1) & 1, n });
  }
  return out;
}

const QMS = 1000 / 32 / J.QUANTUM_TMOD;   // un tmod en 1024es → des millisecondes de jeu
const arrondi = (x, k) => (x === null || !Number.isFinite(x) ? null : Math.round(x * (k || 1000)) / (k || 1000));
function mediane(v) {
  if (!v.length) return null;
  const t = v.slice().sort((a, b) => a - b);
  return t.length % 2 ? t[(t.length - 1) / 2] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2;
}

/**
 * La position de l'Arbre : le temps de jeu (ms) au pas p, pour chaque pas
 * demandé. `pas` : le journal relu ([q, bits] à plat, lireJournal).
 */
function positionsArbre(pas) {
  const n = pas.length / 2;
  return (voulus) => {
    const tri = [...new Set(voulus)].sort((a, b) => a - b);
    const m = new Map();
    let cumul = 0, i = 0;
    for (const p of tri) {
      while (i < p && i < n) { cumul += pas[i * 2]; i++; }
      m.set(p, p <= n ? cumul * QMS : null);
    }
    return m;
  };
}

/**
 * La position d'une arcade : la ligne du temps de jeu, épreuves bout à bout
 * avec une console (temps fixe) entre chacune. `images` : pour chaque
 * épreuve, la liste de ses tmod (1024es) journalisés. Un battement en
 * console n'a pas de position ; un battement « hors console » au pas p est
 * dans l'épreuve qui contient l'image p + 1 (celle qui vient), donc juste
 * après la console qui la précède quand il tombe pile sur une frontière.
 */
function positionsArcade(images, consoleImages) {
  const fins = [];          // le nombre d'images au bout de chaque épreuve
  const debuts = [];        // le temps de jeu (1024es) au début de chaque épreuve, consoles comprises
  let total = 0, temps = 0;
  const C = consoleImages * J.QUANTUM_TMOD;
  for (let k = 0; k < images.length; k++) {
    if (k) temps += C;
    debuts.push(temps);
    for (const q of images[k]) temps += q;
    total += images[k].length;
    fins.push(total);
  }
  return {
    totalMs: temps * QMS,
    position(b) {
      if (b.console) return null;
      const p = b.pas;
      // la première épreuve dont le bout est AU-DELÀ de p
      let lo = 0, hi = fins.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (fins[mid] <= p) lo = mid + 1; else hi = mid; }
      if (lo >= fins.length) return null;            // après la dernière épreuve : une console
      const avant = lo ? fins[lo - 1] : 0;
      let t = debuts[lo];
      const imgs = images[lo];
      for (let i = 0; i < p - avant; i++) t += imgs[i];
      return t * QMS;
    },
  };
}

/**
 * L'EXAMEN des battements d'une partie (cf. « LE RALENTI »).
 *
 * @param {object} bat  { liste: [{ t, n, pas, pause, console }], exiges, plein, fin }
 * @param {object} o    { position(b) → ms | null, pasFinal, totalMs }
 * @returns {{ refus: null | { gravite, raison }, indices: string[], details: object }}
 */
function examinerBattements(bat, o) {
  const indices = [];
  const liste = (bat && Array.isArray(bat.liste)) ? bat.liste : [];
  // L'ordre d'envoi, les doublons écartés. Deux battements partis presque
  // ensemble peuvent arriver croisés : celui qui part avant ne peut pas être
  // arrivé APRÈS l'arrivée du suivant — on lui prend l'heure la plus tôt.
  const vus = new Set();
  const bs = liste.filter((b) => b && Number.isFinite(b.t) && Number.isInteger(b.n) && Number.isInteger(b.pas))
    .slice().sort((a, b) => a.n - b.n)
    .filter((b) => (vus.has(b.n) ? false : (vus.add(b.n), true)))
    .map((b) => ({ t: b.t, n: b.n, pas: b.pas, pause: b.pause ? 1 : 0, console: b.console ? 1 : 0 }));
  for (let i = bs.length - 2; i >= 0; i--) if (bs[i].t > bs[i + 1].t) bs[i].t = bs[i + 1].t;
  const totalMs = Number(o.totalMs) || 0;
  const d = { recus: bs.length, exiges: !!(bat && bat.exiges), plein: !!(bat && bat.plein),
    actifs: 0, rapportMedian: null, rapportGlobal: null, transitions: 0, transitionsParMinute: 0,
    pauses: 0, pausesCourtes: 0, pauseMs: 0, jeuMasqueMs: 0, partMasquee: 0, couverture: 0, excesMs: 0,
    trous: 0, jeuTrouMs: 0 };
  const fin = (refus) => ({ refus: refus || null, indices, details: d });

  // 1. Le compteur ne recule pas et ne dépasse pas le journal.
  for (let i = 0; i < bs.length; i++) {
    if (i && bs[i].pas < bs[i - 1].pas) {
      return fin({ gravite: 'grave', raison: `battements incohérents : le compteur de pas recule (${bs[i - 1].pas} puis ${bs[i].pas})` });
    }
    if (bs[i].pas > o.pasFinal) {
      return fin({ gravite: 'grave', raison: `battements incohérents : un battement annonce ${bs[i].pas} pas, le journal en compte ${o.pasFinal}` });
    }
  }

  // Les positions dans le temps de jeu (null : inconnue — une console).
  const pos = bs.map((b) => {
    const g = o.position(b);
    return g === null || g === undefined || !Number.isFinite(g) ? null : g;
  });

  // 2. Les pauses : bascules, durées, pauses courtes — sur TOUS les battements.
  let debutPause = null;
  for (let i = 0; i < bs.length; i++) {
    if (i && bs[i].pause !== bs[i - 1].pause) d.transitions++;
    if (i && bs[i - 1].pause) d.pauseMs += bs[i].t - bs[i - 1].t;
    if (bs[i].pause && debutPause === null) { debutPause = bs[i].t; d.pauses++; }
    if (!bs[i].pause && debutPause !== null) {
      if (bs[i].t - debutPause < B.pauseCourteMs) d.pausesCourtes++;
      debutPause = null;
    }
  }

  // 3. Les intervalles, d'un battement placé au suivant.
  const rapports = [];
  let jeuActif = 0, reelActif = 0, masque = 0, couvert = 0;
  let prec = -1;
  let minExces = Infinity;
  const exces = (g, t) => {
    const v = g - B.excesFacteur * t;
    if (minExces !== Infinity) d.excesMs = Math.max(d.excesMs, v - minExces);
    minExces = Math.min(minExces, v);
  };
  // Un battement sauté (en console) qui se dit en pause met en pause tout
  // l'intervalle qui l'enjambe : la pause peut tomber pendant une console.
  let pauseEntre = false;
  for (let i = 0; i < bs.length; i++) {
    if (pos[i] === null) { if (bs[i].pause) pauseEntre = true; continue; }
    exces(pos[i], bs[i].t);
    if (prec >= 0) {
      const a = bs[prec], b = bs[i];
      const dj = pos[i] - pos[prec], dr = b.t - a.t;
      if (!a.pause && !b.pause && !pauseEntre) {
        jeuActif += Math.max(0, dj);
        reelActif += Math.max(0, dr);
        // Un TROU : plus de vingt secondes sans battement en plein jeu. Le jeu
        // qui s'y écoule n'est pas couvert (les battements ont pu être
        // bloqués le temps de jouer au ralenti) ; il compte dans la somme.
        if (dr > B.trouMs) { d.trous++; d.jeuTrouMs += Math.max(0, dj); } else couvert += Math.max(0, dj);
        if (dj > 0 && dr >= B.intervalleMinMs) rapports.push(dj / dr);
      } else {
        masque += Math.max(0, dj);
      }
    }
    pauseEntre = false;
    prec = i;
  }
  // La fin elle-même est un battement : l'heure où le serveur l'a reçue, au
  // bout du journal. Le jeu ne peut pas l'avoir rejointe plus vite que l'heure.
  if (bat && Number.isFinite(Number(bat.fin)) && Number(bat.fin) > 0 && prec >= 0) exces(totalMs, Number(bat.fin));

  const span = bs.length > 1 ? bs[bs.length - 1].t - bs[0].t : 0;
  d.actifs = rapports.length;
  d.rapportMedian = arrondi(mediane(rapports));
  d.rapportGlobal = reelActif > 0 ? arrondi(jeuActif / reelActif) : null;
  d.transitionsParMinute = span > 0 ? arrondi(d.transitions / (span / 60000), 10) : 0;
  d.jeuMasqueMs = Math.round(masque);
  d.partMasquee = totalMs > 0 ? arrondi(Math.min(1, masque / totalMs)) : 0;
  d.couverture = totalMs > 0 ? arrondi(Math.min(1, couvert / totalMs)) : 0;
  d.jeuTrouMs = Math.round(d.jeuTrouMs);
  d.pauseMs = Math.round(d.pauseMs);
  d.excesMs = Math.round(d.excesMs);
  const pct = (x) => Math.round(x * 100) + ' %';
  const virg = (x) => String(x).replace('.', ',');

  // 4. Le ralenti : la médiane des intervalles actifs.
  if (d.actifs >= B.intervallesMin && d.rapportMedian !== null) {
    if (d.rapportMedian < B.rapportRefus) {
      return fin({ gravite: 'grave', raison: `ralenti : le jeu avance à ${virg(d.rapportMedian)} fois l'horloge du serveur`
        + ` (médiane de ${d.actifs} intervalles ; un jeu normal la suit à 1)` });
    }
    if (d.rapportMedian < B.rapportIndice) indices.push(`jeu en retard sur l'horloge du serveur (${virg(d.rapportMedian)} fois, ${d.actifs} intervalles)`);
  }

  // 5. Le jeu sous les pauses déclarées.
  if (d.jeuMasqueMs >= B.masqueRefusMs && d.partMasquee >= B.masqueRefus) {
    return fin({ gravite: 'grave', raison: `fausses pauses : ${pct(d.partMasquee)} du jeu s'écoule entre des battements « en pause »`
      + ` (${d.transitions} bascules pause ↔ jeu)` });
  }
  if (d.jeuMasqueMs >= B.masqueIndiceMs && d.partMasquee >= B.masqueIndice) {
    indices.push(`pauses suspectes : ${pct(d.partMasquee)} du jeu s'écoule entre des battements « en pause »`);
  }
  if (span >= B.transitionsDureeMinMs && d.transitionsParMinute > B.transitionsParMinute) {
    indices.push(`pauses en rafale : ${virg(d.transitionsParMinute)} bascules pause ↔ jeu par minute`
      + (d.pausesCourtes ? `, dont ${d.pausesCourtes} pause(s) de moins de ${B.pauseCourteMs / 1000} s` : ''));
  }

  // 6. Les battements absents.
  if (d.exiges && !d.plein && totalMs >= B.jeuSignificatifMs
      && (d.couverture < B.couvertureMin || d.actifs < B.actifsMinAbsents)) {
    return fin({ gravite: 'suspect', raison: `battements absents : ${d.recus} reçu(s), ${d.actifs} intervalle(s) actif(s)`
      + ` pour ${Math.round(totalMs / 1000)} s de jeu (couverture ${pct(d.couverture)}`
      + `${d.trous ? `, ${d.trous} trou(s) de plus de ${B.trouMs / 1000} s` : ''})` });
  }

  // 7. La somme des intervalles actifs : le compteur figé sans se dire en pause.
  if (reelActif >= B.globalReelMinMs && d.rapportGlobal !== null) {
    if (d.rapportGlobal < B.globalRefus) {
      return fin({ gravite: 'grave', raison: `ralenti : ${virg(d.rapportGlobal)} s de jeu par seconde réelle hors pauses`
        + ` (${Math.round(jeuActif / 1000)} s de jeu en ${Math.round(reelActif / 1000)} s)` });
    }
    if (d.rapportGlobal < B.globalIndice) indices.push(`jeu en retard sur l'horloge hors pauses (${virg(d.rapportGlobal)})`);
  }

  // 8. Le jeu qui va plus vite que l'horloge du serveur (le compteur qui
  // « rattrape » d'un coup ce qu'il avait annoncé en retard, ou l'inverse).
  if (d.excesMs > B.excesRefusMs) {
    return fin({ gravite: 'grave', raison: `battements incohérents : ${Math.round(d.excesMs / 1000)} s de jeu de plus que l'heure écoulée entre deux battements` });
  }
  if (d.excesMs > B.excesIndiceMs) indices.push(`jeu en avance sur l'horloge du serveur entre deux battements (${Math.round(d.excesMs / 1000)} s)`);
  return fin(null);
}

// L'alerte d'un refus des battements, pour le registre (signalerTriche).
function alerteRalenti(jeu, examen) {
  const r = examen.refus;
  const dt = examen.details;
  return { jeu, type: 'ralenti', gravite: r.gravite, resume: r.raison,
    details: { rapportMedian: dt.rapportMedian, rapportGlobal: dt.rapportGlobal, actifs: dt.actifs, recus: dt.recus,
      transitions: dt.transitions, partMasquee: dt.partMasquee, couverture: dt.couverture, excesMs: dt.excesMs } };
}

/**
 * L'ARBRE CREUX. `partie` = { graine, journal, scoreDeclare, dureeMs,
 * battements? } — `battements` : ce que fermerBattements a rendu, plus `fin`
 * (l'heure de réception de la fin). Sans ce champ (une partie d'avant les
 * battements, rejouée par l'admin), rien n'est examiné.
 *
 * @returns {{ verdict: 'conforme'|'divergent'|'refuse', scoreVerifie: number|null,
 *             raison: string, indices: string[], details: object, tempsJeuMs: number,
 *             alerte?: object }}  alerte : un refus des battements, pour signalerTriche
 */
function verifierArbre(partie) {
  const indices = [];
  const r = PixizRejeu.rejouer(moteurArbre(), partie.graine, partie.journal);
  const details = { pas: r.pas, tmodMoyen: Math.round(r.tmodMoyen * 1000) / 1000, multi: r.multi, couleurs: r.couleurs };
  let alerte = null;
  const sortie = (verdict, raison) => Object.assign({
    verdict, raison: raison || '', indices, details, tempsJeuMs: r.tempsJeuMs,
    scoreVerifie: verdict === 'conforme' ? r.score : (r.ok ? r.score : null),
  }, alerte ? { alerte } : {});
  // Les battements, examinés sur le journal tel qu'il est écrit.
  let examen = null;
  if (partie.battements) {
    const lu = PixizRejeu.lireJournal(partie.journal);
    if (lu.pas) {
      const n = lu.pas.length / 2;
      const placer = positionsArbre(lu.pas);
      const pl = placer(partie.battements.liste.map((b) => b.pas).concat([n]));
      examen = examinerBattements(partie.battements, { position: (b) => pl.get(b.pas), pasFinal: n, totalMs: pl.get(n) });
      details.battements = examen.details;
    }
  }
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
  if (examen) {
    for (const i of examen.indices) indices.push(i);
    if (examen.refus) {
      alerte = alerteRalenti('minipixiz', examen);
      return sortie('refuse', examen.refus.raison);
    }
  }
  return sortie('conforme', '');
}

/**
 * L'ARCADE DE MINI-FEVER. `partie` = { graine, palier, journal (objet ou
 * texte JSON), declare: { niveau, jouees, gagnee }, dureeMs, battements? }
 * (cf. verifierArbre pour les battements).
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
  // Les battements, sur la ligne du temps « épreuves et consoles ».
  if (partie.battements) {
    const images = eps.map((ep) => {
      const lu = FeverRejeu.lireOps(ep && ep.o);
      const l = [];
      let q = FeverRejeu.TMOD_DEPART;
      for (const o of lu.ops || []) if (o.t === 0) { q += o.dq; for (let i = 0; i < o.n; i++) l.push(q); }
      return l;
    });
    const ligne = positionsArcade(images, consoleMin);
    const pasFinal = images.reduce((s, l) => s + l.length, 0);
    const examen = examinerBattements(partie.battements, { position: ligne.position, pasFinal, totalMs: ligne.totalMs });
    details.battements = examen.details;
    for (const i of examen.indices) indices.push(i);
    if (examen.refus) {
      return sortie('refuse', examen.refus.raison, Object.assign({ alerte: alerteRalenti('minifever', examen) }, extra));
    }
  }
  if (ecarts) {
    indices.push(`${ecarts} épreuve(s) rejouée(s) autrement que déclaré (${raisons.join(' ; ')})`);
    return sortie('ecart', '', extra);
  }
  return sortie('conforme', '', extra);
}

/*
 * ── LE RYTHME d'une partie notée, pour l'admin ──────────────────────────
 *
 * Trois mesures, toutes gardées dans parties_verifiees : la durée RÉELLE (du
 * jeton à la fin, duree_ms — cree_le → fini_le), le TEMPS DE JEU que dit le
 * journal (temps_jeu_ms, la somme des tmod : les pauses n'y sont pas, le jeu
 * se fige quand la fenêtre perd le focus) et le nombre d'IMAGES rejouées
 * (details.pas pour l'arbre, details.images pour l'arcade). Le rythme se
 * mesure sur le temps de jeu ; à défaut (partie sans journal rejoué), sur la
 * durée réelle. Rien n'est écarté ici : c'est un signal, l'admin juge.
 */
function dureeLisible(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s';
  return Math.floor(s / 3600) + ' h ' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ' min';
}

// Le score qui compte pour le rythme : le vérifié s'il existe, sinon le déclaré
// (un score trafiqué posé en trente secondes se lit aussi).
const scoreDuRythme = (p) => Number(p.score_verifie != null ? p.score_verifie : p.score_declare) || 0;
const tempsDuRythme = (p) => (Number(p.temps_jeu_ms) > 0 ? Number(p.temps_jeu_ms) : Number(p.duree_ms) || 0);

/** Les points par minute d'une partie notée, ou null s'il n'y a rien à mesurer. */
function pointsParMinute(p) {
  const score = scoreDuRythme(p), ms = tempsDuRythme(p);
  return score > 0 && ms > 0 ? score / (ms / 60000) : null;
}

// Une partie qui PÈSE : en dessous, une cascade chanceuse en vingt secondes
// fait un rythme énorme qui ne veut rien dire.
function partiePese(p) {
  const score = scoreDuRythme(p);
  if (p.jeu === 'minifever') return score >= SEUILS.arcade.victoiresRythme * 10 * (1 + (Number(p.mode) || 0));
  return score >= SEUILS.arbre.scoreRythme;
}

/**
 * Le rythme d'une partie de parties_verifiees. `ref` : { decile, n } — le
 * 9e décile des points par minute des parties conformes de la période, pour
 * le même jeu et le même palier (db.rythmesDeReference).
 *
 * @returns {{ dureeMs, tempsJeuMs, images, pointsParMinute: number|null,
 *             signal: null|'moyen'|'fort', raisons: string[] }}
 */
function rythmePartie(p, ref) {
  const d = (p && p.details) || {};
  const out = {
    dureeMs: Number(p.duree_ms) || 0,
    tempsJeuMs: Number(p.temps_jeu_ms) || 0,
    images: Number(p.jeu === 'minifever' ? d.images : d.pas) || 0,
    pointsParMinute: null, signal: null, raisons: [],
  };
  const ppm = pointsParMinute(p);
  if (ppm === null) return out;
  out.pointsParMinute = Math.round(ppm);
  if (!partiePese(p)) return out;
  const note = (g, txt) => { out.raisons.push(txt); if (out.signal !== 'fort') out.signal = g; };
  const score = scoreDuRythme(p);
  const quoi = `${score} points en ${dureeLisible(tempsDuRythme(p))} ${out.tempsJeuMs > 0 ? 'de jeu' : 'réelles'}`;
  const seuil = SEUILS.arbre.pointsParMinute;
  if (p.jeu === 'minipixiz' && ppm > seuil) {
    note(ppm > seuil * SEUILS.rythme.facteurFort ? 'fort' : 'moyen',
      `${quoi} : ${out.pointsParMinute} points par minute (au-delà de ${seuil}, il faudrait au moins ${dureeLisible(score / seuil * 60000)} de jeu)`);
  }
  if (ref && Number(ref.n) >= SEUILS.rythme.referenceMin && Number(ref.decile) > 0
      && ppm > Number(ref.decile) * SEUILS.rythme.facteurDecile) {
    note('moyen', `${quoi} : ${String(Math.round(ppm / ref.decile * 10) / 10).replace('.', ',')} fois le 9e décile`
      + ` des parties conformes de la période (${Math.round(ref.decile)} points par minute, ${ref.n} parties)`);
  }
  return out;
}

/*
 * ── LA TENDANCE au ralenti, partie après partie ─────────────────────────
 *
 * Le rapport DURÉE RÉELLE / TEMPS DE JEU d'une partie notée : duree_ms (du
 * jeton à la fin, pauses comprises) sur le temps de jeu de référence. À
 * l'Arbre, c'est temps_jeu_ms. À Mini-Fever, temps_jeu_ms ne compte que les
 * ÉPREUVES (la console n'est pas au journal) : la référence est donc
 * details.minimumMs, les épreuves plus leurs consoles — sans quoi une arcade
 * honnête vaudrait déjà ≈ 2.
 *
 * Une partie normale tourne autour de 1,05 : à l'Arbre, le bouquet
 * d'ouverture et le chargement (quelques secondes) avant le premier pas ; à
 * Mini-Fever, le premier briefing et le dernier débriefing, qui ne sont pas
 * dans le minimum. Ralentie ×2, elle vaut 2. Un joueur qui laisse sa fenêtre
 * de côté une fois de temps en temps monte au-dessus de 1,5 sur UNE partie ;
 * cinq parties de plus d'une minute de suite, toutes au-dessus, c'est ou bien
 * un joueur qui pause sans arrêt (la pause de l'Arbre voile le plateau, mais
 * elle laisse le temps de réfléchir), ou bien un ralenti que les battements
 * n'ont pas vu — les parties d'avant les battements, ou le tricheur outillé
 * qui déclare de fausses longues pauses. Une alerte « suspect », l'admin
 * juge. Les parties de moins d'une minute de jeu ne comptent pas : quelques
 * secondes de chargement suffisent à les pousser au-delà de 1,5.
 */
function rapportReelJeu(p) {
  const d = (p && p.details) || {};
  const ref = p && p.jeu === 'minifever' ? Number(d.minimumMs != null ? d.minimumMs : p.minimum_ms) : Number(p && p.temps_jeu_ms);
  const duree = Number(p && p.duree_ms);
  return ref > 0 && duree > 0 ? Math.round(duree / ref * 100) / 100 : null;
}
const referenceJeu = (p) => (p.jeu === 'minifever'
  ? Number((p.details && p.details.minimumMs) != null ? p.details.minimumMs : p.minimum_ms) || 0
  : Number(p.temps_jeu_ms) || 0);

/**
 * `parties` : les parties conformes (ou à écart toléré) d'UN jeu d'un joueur,
 * de la plus récente à la plus ancienne. Rend la série en cours (les
 * parties pesantes consécutives au-dessus du rapport) et, quand elle vient
 * d'atteindre 5, 10, 15…, l'alerte à lever.
 *
 * @returns {{ serie: number, rapports: number[], alerte: null|{ resume, details } }}
 */
function tendanceRalenti(parties) {
  const T = SEUILS.tendance;
  const pesantes = (parties || []).filter((p) => referenceJeu(p) >= T.jeuMinMs);
  const rapports = pesantes.map(rapportReelJeu);
  let serie = 0;
  while (serie < rapports.length && rapports[serie] !== null && rapports[serie] > T.rapport) serie++;
  const out = { serie, rapports: rapports.slice(0, T.parties), alerte: null };
  if (serie >= T.parties && serie % T.parties === 0) {
    const r = rapports.slice(0, T.parties);
    out.alerte = {
      resume: `${serie} parties d'affilée dont la durée réelle dépasse ${String(T.rapport).replace('.', ',')} fois le temps de jeu`
        + ` (dernières : ${r.map((x) => String(x).replace('.', ',')).join(', ')})`,
      details: { serie, rapports: r, parties: pesantes.slice(0, T.parties).map((p) => p.id) },
    };
  }
  return out;
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
 *   LA DURÉE de ces parties-là ne se reconstitue PAS. Le serveur ne gardait
 *   que la FIN : l'heure où le meilleur score du jour a été écrit
 *   (scores.updated_at, recopiée chaque nuit dans
 *   challenge_score_archive.updated_at). Le départ, lui, n'a jamais été écrit
 *   nulle part : le voyant « en partie » (/api/light/jeu-en-cours) ne vivait
 *   qu'en mémoire (partiesEnCours, une échéance et rien d'autre), et un score
 *   qui ne battait pas le meilleur du jour ne laissait qu'un +1 sans heure
 *   (parties_joueur_jour.n). L'audit montre donc ces deux faits — l'heure du
 *   score (`enregistreLe`) et le nombre de parties envoyées ce jour-là
 *   (`partiesDuJour`) — et rien de plus.
 *
 * `gravite` : 'fort' (le score ne peut pas venir du jeu), 'moyen' (très
 * improbable), 'faible' (à regarder).
 */
const NB_EPREUVES = 27;
function pictosAttendus(n) { return NB_EPREUVES * (1 - Math.pow((NB_EPREUVES - 1) / NB_EPREUVES, n)); }

// Ce que la base sait vraiment de l'heure d'un score ancien (cf. plus haut) :
// la fin, et le nombre de parties du jour. Jamais une durée.
function traces(s) {
  const t = s.enregistreLe ? new Date(s.enregistreLe) : null;
  return {
    enregistreLe: t && !Number.isNaN(t.getTime()) ? t.toISOString() : null,
    partiesDuJour: s.partiesDuJour == null ? null : (Number(s.partiesDuJour) || 0),
  };
}

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
    if (raisons.length) out.push({ jeu: 'minipixiz', username: s.username, jour: s.jour, score, gravite: g, raisons, ...traces(s) });
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
    if (raisons.length) out.push({ jeu: 'minifever', username: s.username, jour: s.jour, score, gravite: g, raisons, ...traces(s) });
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
  rythmePartie, pointsParMinute, dureeLisible,
  DEMARRAGE, ouvrirBattements, noterBattement, fermerBattements, debitBattement,
  encoderBattements, decoderBattements, examinerBattements, positionsArbre, positionsArcade,
  rapportReelJeu, tendanceRalenti,
};
