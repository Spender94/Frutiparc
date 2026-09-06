/*
 * Kaluga — le pont avec Frutiparc (kaluga.Client, frusion.gameclient.GameClient,
 * côté HTML).
 *
 * Deux cases de sauvegarde, comme le SWF :
 *   · slot 0 : la FRUTICARD du jeu — { $vs, $tz, $seq, $bonus, $mode, $stat,
 *     $classic, $trial, $chrono, $survival, $invasion, $ring } : les tzongres
 *     et modes débloqués, les records. C'est elle que le serveur relit pour
 *     les pictos (extractGameItemsFromSlot : papillons, drapeaux, tzongres,
 *     objets spéciaux) ;
 *   · slot 1 : les préférences — { $key: [haut, gauche, droite, bas, fil],
 *     $param: [musique, sons, particules] }.
 *
 * Le score du mode Challenge part sur /api/saveScore (game=kaluga, m=0) avec
 * la donnée « tz:g » du disque Flash rustiné (scripts/patch-kaluga-grappe.js) :
 * la tzongre jouée, puis le OU binaire des tailles de grappes encaissées —
 * c'est ce qui départage classement Kaluga et record Freestyle côté serveur.
 * La barrière Fruit Défendu reste au serveur.
 *
 * Les « couleurs » de session du GameClient (blanc = partie normale, noir et
 * gris = partie classée, rouge) : ici la partie est toujours blanche — la
 * progression s'enregistre sur la fruticard, le classement passe par le FD.
 *
 * La règle des autres portages : on ne sauvegarde JAMAIS un slot qu'on n'a
 * pas d'abord chargé — une fiche neuve écrite par-dessus une vraie effacerait
 * les tzongres débloquées.
 */
'use strict';

(function (racine) {

const J = racine.KalugaJeu = racine.KalugaJeu || {};

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
    this.mng = null;
    this.slots = [];
    this.lockList = [];
    this.ranking = null;
    this.forcePause = false;
    this.charge = false;              // slot 0 lu (ou compte neuf) : droit d'écrire
    this.pseudo = null;
  }
  isWhite() { return true; }
  isBlack() { return false; }
  isGrey() { return false; }
  isRed() { return false; }
  isAutoDestruct() { return false; }

  /*
   * LA PARTIE COMPTE-T-ELLE ? — ce qui décide du nom du premier mode.
   *
   * D'époque, le menu s'appelait CHALLENGE, sauf en session BLANCHE où il
   * devenait ESSAIS (Menu.genMenuList) : la session blanche, c'était le
   * disque de DÉMONSTRATION (`kalugademo`, playMode « preview »), qui jouait
   * sans rien classer. Le disque noir, lui, consommait un Fruit Défendu et
   * envoyait le score.
   *
   * Ici la progression est TOUJOURS blanche (la fruticard s'enregistre à
   * chaque partie, `isWhite`), mais le score part toujours lui aussi : c'est
   * le SERVEUR qui tranche, avec le quota de Fruits Défendus (kaluga est
   * dans FD_LIMITED_GAMES). On demande donc ce quota, et le menu dit la
   * vérité au joueur AVANT qu'il joue — CHALLENGE quand la partie ira au
   * classement, ESSAIS quand elle n'ira pas (plus de FD, ou pas de session).
   */
  isRanked() {
    if (!this.sid) return false;              // ouvert à la main : aucun classement
    if (!this.fd) return true;                // quota inconnu : le score part quand même
    if (this.fd.limited === false) return true;
    return (Number(this.fd.remaining) || 0) > 0;
  }
  chargerFd() {
    if (!this.sid) return Promise.resolve();
    return fetch('/api/fd/status?sid=' + encodeURIComponent(this.sid) + '&game=kaluga', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.ok) this.fd = j; })
      .catch(() => {});
  }

  /*
   * LE BAC À SABLE — le mode d'essai, réglé depuis le panneau
   * d'administration (data/kaluga-bac.json). Fermé, le menu n'en montre
   * rien ; ouvert, il ajoute une entrée qui ne compte ni au classement ni à
   * la fruticard. C'est un outil de vérification du portage, pas un mode de
   * jeu : le Kaluga de 2005 n'en avait pas.
   */
  chargerBac() {
    if (!this.sid) return Promise.resolve();
    return fetch('/api/kaluga/bac?sid=' + encodeURIComponent(this.sid), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.ok) this.bac = j.bac; })
      .catch(() => {});
  }

  // Un fichier chargé par le jeu (carte, séquence) : la bibliothèque du même nom.
  getFileInfos(f) {
    const nom = String(f || '').replace(/^.*\//, '').replace(/\.swf$/i, '');
    return { name: nom, size: 0 };
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
    const slots = fetch('/api/loadFrutiSlots?sid=' + encodeURIComponent(this.sid) + '&game=kaluga', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((texte) => {
        const brut0 = lireLoadVars(texte, 0);
        const brut1 = lireLoadVars(texte, 1);
        this.slots = [];
        if (brut0) {
          try { this.slots[0] = JSON.parse(brut0); this.charge = true; }
          catch (e) { this.slots[0] = undefined; this.charge = false; }
        } else {
          this.charge = true;                        // compte vierge : on a le droit d'écrire
        }
        if (brut1) { try { this.slots[1] = JSON.parse(brut1); } catch (e) { this.slots[1] = undefined; } }
      })
      .catch(() => { this.slots = []; this.charge = false; });
    // Le quota FD et le bac à sable arrivent avec le reste : le menu se
    // construit juste après, et c'est lui qui nomme le premier mode et qui
    // décide de montrer, ou non, l'entrée d'essai.
    Promise.all([profil, slots, this.chargerFd(), this.chargerBac()]).then(() => this.onServiceConnect());
  }
  onServiceConnect() {
    this.mng.card = this.slots[0];
    this.mng.pref = this.slots[1];
    this.mng.connected();
  }
  startGame() { this.mng.started(); }
  endGame() {}
  closeService() { this.mng.backToMenu(); }

  saveScore(score, data) {
    const tz = data && data.tz != null ? data.tz : 0;
    const gOr = data && data.gOr != null ? data.gOr : 0;
    const finir = (r) => {
      this.ranking = {
        rankingScore: score, rankingData: data,
        oldScore: r ? r.oldScore : undefined, oldPos: r ? r.oldPos : undefined,
        bestScorePos: r ? r.newPos : undefined, bestScore: r ? r.newScore : undefined,
        ok: !!(r && r.ok), fdBlocked: !!(r && r.fdBlocked), error: r ? r.error : 'hors_ligne',
      };
      // La partie vient de consommer un Fruit Défendu (ou de se heurter au
      // quota vide) : on rafraîchit, pour que le menu suivant dise juste.
      if (this.fd) this.fd.remaining = (r && r.fdBlocked) ? 0 : Math.max(0, (Number(this.fd.remaining) || 0) - 1);
      this.chargerFd();
      this.onSaveScore();
    };
    if (!this.sid) { Promise.resolve().then(() => finir(null)); return; }
    const p = new URLSearchParams({ sid: this.sid, game: 'kaluga', m: '0', score: String(Math.max(0, Math.floor(score))), data: tz + ':' + gOr });
    fetch('/api/saveScore?' + p.toString())
      .then((r) => r.json().catch(() => null).then((j) => (j && typeof j === 'object' ? j : { ok: r.ok, error: 'reseau' })))
      .catch(() => ({ ok: false, error: 'reseau' }))
      .then(finir);
  }
  onSaveScore() { this.mng.scoreSaved(); }

  saveSlot(n) {
    if (this.lockList[n]) return Promise.resolve(false);
    if (!this.sid || !this.charge) return Promise.resolve(false);
    const donnees = this.slots[n];
    if (donnees === undefined) return Promise.resolve(false);
    return fetch('/api/saveFrutiSlot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sid: this.sid, game: 'kaluga', slotId: String(n), data: JSON.stringify(donnees) }).toString(),
    }).then((r) => r.ok).catch(() => false);
  }
  // Les pictos se déduisent de la fruticard côté serveur, à chaque sauvegarde.
  giveItem() {}
  giveAccessory() {}
}
J.Client = Client;

})(typeof window !== 'undefined' ? window : globalThis);
