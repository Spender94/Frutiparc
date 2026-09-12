/*
 * MotionBall — le pont avec Frutiparc (mb2.Client, frusion.gameclient.
 * GameClient, côté HTML).
 *
 * Deux cases de sauvegarde, comme le SWF :
 *   · slot 0 : la FRUTICARD du jeu (Card.as) — { $challenge, $classic,
 *     $items, $dungeons, $dungeons_done, $courses, $classic_score, $dtimes,
 *     $records } : les modes ouverts, les TItems gagnés (que le serveur relit
 *     pour les pictos : extractGameItemsFromSlot), les records de course, les
 *     temps des donjons, le record du Classique ;
 *   · slot 1 : les préférences — { $music, $sounds }.
 *
 * Le score du Challenge part sur /api/saveScore (game=mb2, m=1) : c'est la
 * valeur empaquetée de Game.calcScore (le pourcentage de salles visitées,
 * plus le temps restant si le boss est vaincu), que le serveur range dans
 * mb2_classic / mb2_challenge (routeRankingForSave, mb2Comparator). La
 * barrière Fruit Défendu reste au serveur.
 *
 * Les « couleurs » de session du GameClient : le disque noir ne jouait que
 * le Challenge (isChallengeDisc), le blanc ouvrait tous les modes sans rien
 * classer. Ici la partie est toujours BLANCHE — tous les modes ouverts,
 * progression sur la fruticard — et le score part quand même : c'est le
 * serveur qui tranche, avec le quota de Fruits Défendus.
 *
 * Les cartes (.dat) se lisent sur /swf/games/motionBall2/ — là où le disque
 * Flash les prenait aussi.
 *
 * La règle des autres portages : on ne sauvegarde JAMAIS un slot qu'on n'a
 * pas d'abord chargé.
 */
'use strict';

(function (racine) {

const J = racine.Mb2Jeu = racine.Mb2Jeu || {};

function lireLoadVars(texte, slot) {
  const cible = 'slot' + slot;
  for (const morceau of String(texte).split('&')) {
    const eq = morceau.indexOf('=');
    if (eq < 0) continue;
    if (morceau.slice(0, eq) !== cible) continue;
    try { return decodeURIComponent(morceau.slice(eq + 1).replace(/\+/g, ' ')); } catch (e) { return null; }
  }
  return null;
}

class Client {
  constructor(sid) {
    this.sid = sid || '';
    this.slots = [];
    this.fcard = null;
    this.ranking = null;
    this.forcePause = false;
    this.gameRunning = false;
    this.error = false;
    this.charge = false;              // slot 0 lu (ou compte neuf) : droit d'écrire
    this.fd = null;
    this.pseudo = null;
  }
  isWhite() { return true; }
  isBlack() { return false; }
  isGrey() { return false; }
  isRed() { return false; }
  isChallengeDisc() { return this.isBlack() || this.isGrey(); }

  // La partie ira-t-elle au classement ? (le quota FD du jour, demandé au serveur)
  isRanked() {
    if (!this.sid) return false;
    if (!this.fd) return true;
    if (this.fd.limited === false) return true;
    return (Number(this.fd.remaining) || 0) > 0;
  }
  chargerFd() {
    if (!this.sid) return Promise.resolve();
    return fetch('/api/fd/status?sid=' + encodeURIComponent(this.sid) + '&game=mb2', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.ok) this.fd = j; })
      .catch(() => {});
  }

  // Un fichier du disque (une carte .dat) : son adresse.
  getFileInfos(f) {
    const nom = String(f || '').replace(/^.*\//, '');
    return { name: '/swf/games/motionBall2/' + nom, size: 0 };
  }
  chargerFichier(url) {
    return fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  }

  serviceConnect() {
    if (!this.sid) {
      this.slots = [];
      this.charge = true;
      Promise.resolve().then(() => this.onServiceConnect());
      return;
    }
    const profil = fetch('/api/light/profile?sid=' + encodeURIComponent(this.sid), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p && (p.user || p.username)) this.pseudo = p.user || p.username; })
      .catch(() => {});
    const slots = fetch('/api/loadFrutiSlots?sid=' + encodeURIComponent(this.sid) + '&game=mb2', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((texte) => {
        const brut0 = lireLoadVars(texte, 0);
        const brut1 = lireLoadVars(texte, 1);
        this.slots = [];
        if (brut0) {
          try { this.slots[0] = JSON.parse(brut0); this.charge = true; }
          catch (e) { this.slots[0] = undefined; this.charge = false; }
        } else this.charge = true;                   // compte vierge : on a le droit d'écrire
        if (brut1) { try { this.slots[1] = JSON.parse(brut1); } catch (e) { this.slots[1] = undefined; } }
      })
      .catch(() => { this.slots = []; this.charge = false; });
    Promise.all([profil, slots, this.chargerFd()]).then(() => this.onServiceConnect());
  }

  // Une fiche d'époque peut manquer un champ (sauvegarde tronquée, fiche du
  // disque Flash convertie) : on complète sans rien écraser.
  reparerCard(c) {
    const neuve = new J.Card();
    for (const k of Object.keys(neuve)) if (c[k] === undefined || c[k] === null) c[k] = neuve[k];
    if (!Array.isArray(c.$items)) c.$items = [];
    if (!Array.isArray(c.$dungeons)) c.$dungeons = neuve.$dungeons;
    if (!Array.isArray(c.$dungeons_done)) c.$dungeons_done = [];
    if (!Array.isArray(c.$courses)) c.$courses = [true];
    if (!Array.isArray(c.$dtimes)) c.$dtimes = [];
    if (!Array.isArray(c.$records)) c.$records = [];
    for (let i = 0; i < 7; i++) {
      const r = c.$records[i];
      if (!Array.isArray(r) || r.length < 3 || r.some((e) => !e || typeof e.$t !== 'number')) c.$records[i] = neuve.$records[i];
    }
    return c;
  }

  // ── les rappels (Client.as) ──
  onServiceConnect() {
    let k = this.slots[1];
    if (k === undefined || k === null) {
      k = { $music: true, $sounds: true };
      this.slots[1] = k;
    }
    this.fcard = this.slots[0];
    if (this.fcard === undefined || this.fcard === null) {
      this.fcard = new J.Card();
      this.slots[0] = this.fcard;
    } else this.reparerCard(this.fcard);

    const Prefs = J.Prefs;
    Prefs.challenge_mode_enabled = this.fcard.$challenge;
    Prefs.classic_mode_enabled = this.fcard.$classic;
    Prefs.courses = this.fcard.$courses;
    Prefs.dungeons = this.fcard.$dungeons;

    Prefs.music_enabled = !k.$music;
    Prefs.sound_enabled = !k.$sounds;
    Prefs.toggleMusic();
    Prefs.toggleSounds();
    J.Manager.connected();
  }

  startGame() {
    this.gameRunning = true;
    this.error = false;
    this.onStartGame('');
  }
  onStartGame() { J.Manager.started(); }
  endGame() { this.gameRunning = false; }
  closeService() { J.Manager.forceNextMode(0); }

  savePrefs() {
    this.slots[1] = { $music: J.Prefs.music_enabled, $sounds: J.Prefs.sound_enabled };
    this.saveSlot(1);
  }

  saveScore(score, data) {
    const finir = (r) => {
      this.ranking = {
        rankingScore: score, rankingData: data,
        oldScore: r ? r.oldScore : undefined, oldPos: r ? r.oldPos : undefined,
        bestScorePos: r ? r.newPos : undefined, bestScore: r ? r.newScore : undefined,
        ok: !!(r && r.ok), fdBlocked: !!(r && r.fdBlocked), error: r ? r.error : 'hors_ligne',
      };
      if (this.fd) this.fd.remaining = (r && r.fdBlocked) ? 0 : Math.max(0, (Number(this.fd.remaining) || 0) - 1);
      this.chargerFd();
      this.onSaveScore();
    };
    if (!this.sid) { Promise.resolve().then(() => finir(null)); return; }
    const p = new URLSearchParams({ sid: this.sid, game: 'mb2', m: '1', score: String(Math.max(0, Math.floor(score))), data: data === undefined ? '' : String(data) });
    fetch('/api/saveScore?' + p.toString())
      .then((r) => r.json().catch(() => null).then((j) => (j && typeof j === 'object' ? j : { ok: r.ok, error: 'reseau' })))
      .catch(() => ({ ok: false, error: 'reseau' }))
      .then(finir);
  }
  onSaveScore() {
    const r = this.ranking;
    J.Manager.scoreSaved(r.rankingScore, r.oldScore, r.oldPos, r.bestScorePos);
  }

  saveClassicScore(score) {
    let record = this.slots[0].$classic_score;
    if (score > record) {
      record = score;
      this.slots[0].$classic_score = record;
      this.saveSlot(0);
    }
    return record;
  }

  saveSlot(n) {
    if (!this.sid || !this.charge) return Promise.resolve(false);
    const donnees = this.slots[n];
    if (donnees === undefined) return Promise.resolve(false);
    return fetch('/api/saveFrutiSlot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sid: this.sid, game: 'mb2', slotId: String(n), data: JSON.stringify(donnees) }).toString(),
    }).then((r) => r.ok).catch(() => false);
  }
  // Les pictos se déduisent de la fruticard ($items) côté serveur, à chaque sauvegarde.
  giveItem() {}
}
J.Client = Client;

})(typeof window !== 'undefined' ? window : globalThis);
