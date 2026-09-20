/*
 * Burning Kiwi — le pont avec Frutiparc (bkiwi.KiwiClient, extension de
 * frusion.gameclient.GameClient, côté HTML).
 *
 * Trois cases de sauvegarde, comme le SWF (code.as, initFrutiCard) :
 *   · slot 0 (SLOT_PUBLIC) : la FRUTICARD publique — { $ws, $wss, $wc, $wcs }
 *     les quatre coupes, $ac[5] les écuries disponibles, $ts[6] les records
 *     par circuit { $fcLap, $fcTotal, $lapCar, $totalCar } : c'est elle que le
 *     serveur relit pour les pictos (extractGameItemsFromSlot) et la carte ;
 *   · slot 1 (SLOT_PREFS) : { $ver, $mus, $snd, $det, $bar, $ctr } ;
 *   · slot 2 (SLOT_MODES) : neuf booléens, les modes débloqués.
 *
 * INFINITY. Un circuit jamais couru a $fcLap = Infinity. Le JSON n'a pas
 * d'infini : le SWF rustiné (scripts/patch-bkiwi-client.js) écrit 9999999,
 * et l'on fait pareil — à la lecture, 9999999 et plus redevient Infinity, pour
 * que `raceTime < trackStats[t].$fcTotal` garde son sens.
 *
 * Le score part sur /api/saveScore (game=bkiwi, score = temps en ms, data =
 * « voiture:rangPerfects:rangPosition ») avec le circuit couru en clair
 * (track=N) : le serveur range le record permanent dans
 * bkiwi_track<N>_classic et, si la course était un Challenge payé d'un Fruit
 * Défendu (/do/fdclaim, mode=1 = ARCADE), le miroir du jour. Le classement
 * rendu (oldPos / bestScorePos) fait l'annonce « vous avez progressé de… ».
 *
 * Les COULEURS de session du GameClient : le disque noir ne jouait que le
 * Challenge, le blanc ouvrait tout. Ici la partie est toujours BLANCHE — tous
 * les modes, la fruticard —, et c'est le quota de FD qui décide si le premier
 * bouton dit « challenge » ou « essais » (Client.isRanked, lu par checkMode).
 *
 * Les fichiers du disque (l'intro, les circuits) sont nos bibliothèques
 * extraites (/bkiwi/data/<nom>.json) ; les musiques (bk00..05, bkMenu) se
 * lisent là où le disque Flash les prenait : /swf/games/burningKiwi/.
 *
 * Les drapeaux fl_success / fl_localScore / connected / error / reseting /
 * forcePause / gameRunning sont ceux que le jeu sonde d'image en image
 * (KiwiClient.as) : chaque commande abaisse fl_success, son événement le
 * relève.
 */
'use strict';

(function (racine) {

const J = racine.BkiwiJeu = racine.BkiwiJeu || {};

const INFINI_JSON = 9999999;

function lireLoadVars(texte, cle) {
  for (const morceau of String(texte).split('&')) {
    const eq = morceau.indexOf('=');
    if (eq < 0) continue;
    if (morceau.slice(0, eq) !== cle) continue;
    try { return decodeURIComponent(morceau.slice(eq + 1).replace(/\+/g, ' ')); } catch (e) { return null; }
  }
  return null;
}

// Un slot tel que le serveur le rend : du JSON, où un `Infinity` nu (une
// sauvegarde d'avant la rustine) se lit comme 9999999.
function analyserSlot(brut) {
  if (brut === null || brut === undefined || brut === '') return undefined;
  try { return JSON.parse(String(brut).replace(/(^|[^\w$."])-?Infinity(?=[^\w$]|$)/g, '$1' + INFINI_JSON)); }
  catch (e) { return undefined; }
}
// À la lecture : les temps « infinis » redeviennent Infinity.
function restaurerInfinis(slot0) {
  if (!slot0 || typeof slot0 !== 'object') return slot0;
  const ts = slot0.$ts;
  if (ts && typeof ts === 'object') {
    for (const k of Object.keys(ts)) {
      const piste = ts[k];
      if (!piste || typeof piste !== 'object') continue;
      for (const c of ['$fcLap', '$fcTotal']) {
        if (typeof piste[c] === 'number' && piste[c] >= INFINI_JSON) piste[c] = Infinity;
        else if (piste[c] === null) piste[c] = Infinity;
      }
    }
  }
  return slot0;
}
// À l'écriture : Infinity → 9999999 (JSON.stringify en ferait null).
function serialiserSlot(obj) {
  return JSON.stringify(obj, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? (v > 0 ? INFINI_JSON : -INFINI_JSON) : v));
}

/*
 * AUCUNE REQUÊTE NE DOIT POUVOIR FIGER LE JEU.
 *
 * Le jeu attend le réseau à cinq endroits, et à chaque fois il attend un
 * drapeau (`fl_success`, `connected`, `error`) en boucle, avec un voyant
 * « réseau » à l'écran : l'ouverture de la session au menu, le départ d'une
 * course (le portillon des Fruits Défendus), l'enregistrement du score À
 * L'ARRIVÉE, l'écriture des cases de la fruticard et le fantôme.
 *
 * Or `fetch` N'A PAS DE DÉLAI. Une connexion qui part et ne revient pas — un
 * téléphone qui change d'antenne, un mobile qui passe en veille, un proxy qui
 * avale la requête — laisse la promesse en suspens POUR TOUJOURS. Le jeu
 * reste alors sur son voyant, la boucle de phase tourne dans le vide, et
 * aucune touche n'en sort : il n'y a plus qu'à éjecter le disque. C'est
 * exactement ce que décrivent les joueurs après une course — la phase 40 de
 * la fin (`saveScore`) est le premier écran qui suit l'arrivée.
 *
 * Toute requête passe donc par ici, avec un délai. Passé ce délai on tranche
 * comme un échec réseau ordinaire — chemin que chaque appelant sait déjà
 * traiter : on perd le classement de cette course, jamais la partie.
 */
const DELAI_RESEAU = 9000;            // ms — au-delà, la requête est perdue
function requete(url, options, delai) {
  const ms = delai || DELAI_RESEAU;
  if (typeof AbortController !== 'function') return fetch(url, options);
  const ctl = new AbortController();
  const minuterie = setTimeout(() => ctl.abort(), ms);
  const opts = Object.assign({}, options, { signal: ctl.signal });
  return fetch(url, opts).then(
    (r) => { clearTimeout(minuterie); return r; },
    (e) => {
      clearTimeout(minuterie);
      throw (e && e.name === 'AbortError') ? new Error('délai dépassé : ' + url) : e;
    },
  );
}
J.requete = requete;

/*
 * LE PANNEAU DE PANNE.
 *
 * Quand le jeu s'arrête pour de bon (J.fatal, moteur.js), il n'y a plus de
 * boucle pour dessiner quoi que ce soit : le panneau est donc posé DANS LA
 * PAGE, par-dessus la toile. Il dit ce qui s'est passé et rouvre le jeu d'un
 * clic — c'est ce que le joueur obtenait en éjectant le disque et en le
 * remettant, sans le disque à éjecter.
 */
J.montrerPanneEtRelancer = function (message) {
  if (typeof document === 'undefined' || document.getElementById('bkiwi-panne')) return;
  const boite = document.createElement('div');
  boite.id = 'bkiwi-panne';
  boite.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483600', 'display:flex',
    'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:14px',
    'background:rgba(28,10,44,.92)', 'color:#fff', 'text-align:center', 'padding:24px',
    'font:bold 13px Verdana,Arial,sans-serif', 'cursor:pointer',
  ].join(';');
  const titre = document.createElement('div');
  titre.textContent = String(message || 'Le jeu s’est arrêté');
  titre.style.cssText = 'max-width:300px;line-height:1.5;text-shadow:0 1px 0 rgba(0,0,0,.4)';
  const bouton = document.createElement('div');
  bouton.textContent = 'Relancer le jeu';
  bouton.style.cssText = [
    'border:3px solid #fff', 'border-radius:14px', 'background:#c9531b',
    'padding:10px 22px', 'font:bold 15px Verdana,Arial,sans-serif',
  ].join(';');
  boite.appendChild(titre);
  boite.appendChild(bouton);
  boite.addEventListener('click', () => { try { location.reload(); } catch (e) { /* rien à faire de plus */ } });
  (document.body || document.documentElement).appendChild(boite);
};

class Client {
  constructor(sid) {
    this.sid = sid || '';
    this.slots = [];
    this.charge = false;              // slots lus (ou compte neuf) : droit d'écrire
    this.fd = null;
    this.pseudo = null;
    // KiwiClient / GameClient
    this.reseting = false;
    this.forcePause = false;
    this.forceClose = false;
    this.connected = false;
    this.error = false;
    this.fl_success = false;
    this.fl_localScore = false;
    this.gameRunning = false;
    this.dailyData = undefined;
    this.ranking = undefined;
    this.version = '1.7';
  }
  // Les couleurs du disque : la session est blanche (tous les modes).
  isWhite() { return true; }
  isBlack() { return false; }
  isGray() { return false; }
  isGrey() { return false; }
  isRed() { return false; }
  getVersion() { return this.version; }

  // La course ira-t-elle au classement ? (le quota de Fruits Défendus du jour)
  isRanked() {
    if (!this.sid) return false;
    if (!this.fd) return true;
    if (this.fd.limited === false) return true;
    return (Number(this.fd.remaining) || 0) > 0;
  }
  chargerFd() {
    if (!this.sid) return Promise.resolve();
    return requete('/api/fd/status?sid=' + encodeURIComponent(this.sid) + '&game=bkiwi', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.ok) this.fd = j; })
      .catch(() => {});
  }
  // La course du jour, dite par le serveur : dailyData = <daily trk="N"/>,
  // ce que le menu (phase 140) lit comme le XML d'époque.
  chargerCourseDuJour() {
    return requete('/api/bkiwi/daily' + (this.sid ? '?sid=' + encodeURIComponent(this.sid) : ''), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && j.ok && Number.isFinite(Number(j.trk))) this.dailyData = '<daily trk="' + Number(j.trk) + '"/>';
      })
      .catch(() => {});
  }

  // ── LE FANTÔME (mode Ghost-Run) ──
  //
  // Une trace par circuit, celle du meilleur temps, chez le serveur
  // (/api/bkiwi/ghost). Elle ne voyage QUE quand on entre en Ghost-Run : elle
  // pèse une dizaine de kilo-octets, elle n'a rien à faire dans la fruticard
  // qu'on relit à chaque ouverture du jeu.
  chargerFantome(track) {
    const M = J.M;
    if (!M) return Promise.resolve(null);
    // Le fantôme de la course précédente ne vaut que pour SON circuit : on
    // change de piste, on repart seul. Sur la même piste, il reste — c'est le
    // filet quand le serveur n'a pas pu garder la trace (partie sans session,
    // réseau muet), et le mode continue de tourner dans la séance.
    if (M.fantomeTrack !== track) {
      M.previousGhost = null;
      M.fantomeTemps = undefined;
      M.fantomeCar = undefined;
      M.fantomeTrack = track;
    }
    if (!this.sid) return Promise.resolve(M.previousGhost);
    return requete('/api/bkiwi/ghost?sid=' + encodeURIComponent(this.sid) + '&track=' + encodeURIComponent(track), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !j.ok || !j.ghost) return M.previousGhost;
        // Le serveur garde le meilleur : s'il a mieux que ce qu'on tient en
        // mémoire, on prend le sien ; sinon on garde le nôtre.
        const temps = Number(j.ghost.t);
        if (Number.isFinite(M.fantomeTemps) && M.fantomeTemps <= temps) return M.previousGhost;
        const trace = J.decoderFantome(j.ghost.p);
        if (!trace) return M.previousGhost;
        trace.raceTime = temps;
        M.previousGhost = trace;
        M.fantomeTemps = temps;
        M.fantomeCar = Number(j.ghost.c) || 0;
        return trace;
      })
      .catch(() => M.previousGhost);   // pas de réponse : on garde ce qu'on a
  }
  enregistrerFantome(track, car, temps, ghost) {
    if (!this.sid) return Promise.resolve(false);
    const data = J.encoderFantome(ghost);
    if (!data) return Promise.resolve(false);
    return requete('/api/bkiwi/ghost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        sid: this.sid, track: String(track), car: String(car),
        time: String(Math.round(temps)), data,
      }).toString(),
    }).then((r) => (r.ok ? r.json() : null)).then((j) => !!(j && j.saved)).catch(() => false);
  }

  // Un fichier du disque : l'intro et les circuits sont nos bibliothèques
  // (chargées par leur nom), les musiques les MP3 du disque Flash.
  getFileInfos(f) {
    const nom = String(f || '').replace(/^.*\//, '');
    if (/\.mp3$/i.test(nom)) return { name: '/swf/games/burningKiwi/' + nom, size: 0 };
    return { name: '/bkiwi/data/' + nom.replace(/\.swf$/i, '.json'), size: 0 };
  }

  // ── les commandes (KiwiClient.as) ──
  serviceConnect() {
    this.fl_success = false;
    this.error = false;
    if (!this.sid) {
      // Sans session (la page ouverte à la main) : pas de fruticard, mais la
      // course du jour reste celle du serveur.
      this.slots = [];
      this.charge = true;
      this.chargerCourseDuJour().then(() => this.onServiceConnect());
      return;
    }
    const profil = requete('/api/light/profile?sid=' + encodeURIComponent(this.sid), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p && (p.user || p.username)) this.pseudo = p.user || p.username; })
      .catch(() => {});
    const slots = requete('/api/loadFrutiSlots?sid=' + encodeURIComponent(this.sid) + '&game=bkiwi', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('loadFrutiSlots ' + r.status);
        return r.text();
      })
      .then((texte) => {
        if (/^ok=0/.test(texte)) throw new Error('loadFrutiSlots refusé');
        this.slots = [];
        for (let i = 0; i < 3; i++) this.slots[i] = analyserSlot(lireLoadVars(texte, 'slot' + i));
        restaurerInfinis(this.slots[0]);
        this.charge = true;
      })
      .catch((e) => { console.error('[bkiwi] ' + (e && e.message ? e.message : e)); this.slots = []; this.charge = false; this.error = true; });
    Promise.all([profil, slots, this.chargerFd(), this.chargerCourseDuJour()]).then(() => {
      if (this.error) { this.onError(); return; }
      this.onServiceConnect();
    });
  }
  onServiceConnect() {
    // Une case absente est un objet vide : c'est ainsi que le jeu la lit
    // (frutiSlots[SLOT_PREFS].$mus == undefined → préférences par défaut).
    for (let i = 0; i < 3; i++) if (this.slots[i] === undefined || this.slots[i] === null) this.slots[i] = {};
    if (J.M) J.M.frutiSlots = this.slots;
    this.connected = true;
    this.fl_success = true;
  }
  onError() { this.error = true; }

  startGame() {
    this.fl_success = false;
    this.error = false;
    this.gameRunning = true;
    const M = J.M;
    const track = M && M.vs ? M.vs.selectedTrack : undefined;
    const mode = M && M.vs ? M.vs.gameMode : undefined;
    // GHOST-RUN : on profite du pop-up réseau du départ (phases 92-93) pour
    // aller chercher le fantôme du circuit. Le jeu attend déjà `fl_success`
    // là : rien de neuf à inventer côté menu, et la course ne démarre pas
    // avant que la trace soit là.
    const fantome = (mode === (M && M.GHOSTRUN))
      ? this.chargerFantome(track) : Promise.resolve(null);

    if (!this.sid) { fantome.then(() => this.onStartGame()); return; }
    // Le portillon des Fruits Défendus : seul le Challenge (ARCADE = 1) en
    // consomme un ; un refus (ok=0) ramène au menu, comme le SWF rustiné.
    Promise.all([fantome, requete('/do/fdclaim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sid: this.sid, game: 'bkiwi', track: String(track), mode: String(mode) }).toString(),
    }).then((r) => (r.ok ? r.text() : 'ok=1'))])
      .then(([, texte]) => {
        if (/^ok=0/.test(texte)) {
          this.gameRunning = false;
          if (this.fd) this.fd.remaining = 0;
          this.onError();
          return;
        }
        const reste = /(?:^|&)remaining=(\d+)/.exec(texte);
        if (reste && this.fd) this.fd.remaining = Number(reste[1]);
        this.onStartGame();
      })
      .catch(() => this.onStartGame());     // réseau muet : on laisse courir, le serveur tranchera au score
  }
  onStartGame() { this.fl_success = true; }

  endGame() {
    this.fl_success = false;
    this.gameRunning = false;
    Promise.resolve().then(() => this.onEndGame());
  }
  onEndGame() { this.fl_success = true; }

  saveScore(score, misc) {
    this.fl_success = false;
    this.fl_localScore = false;
    this.gameRunning = false;
    const M = J.M;
    const track = M && M.vs ? M.vs.selectedTrack : undefined;
    const mode = M && M.vs ? M.vs.gameMode : undefined;
    const data = Array.isArray(misc) ? misc.join(':') : (misc === undefined ? '' : String(misc));
    const finir = (r) => {
      this.ranking = {
        rankingScore: score, rankingData: data,
        oldScore: r ? r.oldScore : undefined, oldPos: r ? (Number(r.oldPos) || 0) : 0,
        bestScorePos: r ? (Number(r.newPos) || 0) : 0, bestScore: r ? r.newScore : undefined,
        ok: !!(r && r.ok), fdBlocked: !!(r && r.fdBlocked), error: r ? r.error : 'hors_ligne',
      };
      this.chargerFd();
      this.onSaveScore();
    };
    if (!this.sid) { Promise.resolve().then(() => finir(null)); return; }
    const p = new URLSearchParams({
      sid: this.sid, game: 'bkiwi', score: String(Math.max(0, Math.floor(Number(score) || 0))), data,
      track: String(track), gm: String(mode),
    });
    requete('/api/saveScore?' + p.toString())
      .then((r) => r.json().catch(() => null).then((j) => (j && typeof j === 'object' ? j : { ok: r.ok, error: 'reseau' })))
      .catch(() => ({ ok: false, error: 'reseau' }))
      .then(finir);
  }
  onSaveScore() {
    this.fl_success = true;
    if (this.forceClose) this.closeService();
  }

  closeService() { this.connected = false; }
  // Les pictos se déduisent de la fruticard (slot 0) côté serveur, à chaque sauvegarde.
  giveItem() {}
  logError(msg) { console.error('[bkiwi] ' + msg); }

  // saveSlot(id, obj) : on n'écrit JAMAIS une case qu'on n'a pas d'abord lue.
  saveSlot(n, obj) {
    if (obj !== undefined) this.slots[n] = obj;
    if (!this.sid || !this.charge) return Promise.resolve(false);
    const donnees = this.slots[n];
    if (donnees === undefined) return Promise.resolve(false);
    return requete('/api/saveFrutiSlot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sid: this.sid, game: 'bkiwi', slotId: String(n), data: serialiserSlot(donnees) }).toString(),
    }).then((r) => r.ok).catch(() => false);
  }
}
Client.analyserSlot = analyserSlot;
Client.restaurerInfinis = restaurerInfinis;
Client.serialiserSlot = serialiserSlot;
J.Client = Client;

})(typeof window !== 'undefined' ? window : globalThis);
