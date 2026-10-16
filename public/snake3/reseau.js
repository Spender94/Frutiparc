/*
 * Frutisnake — le fil avec le serveur du Battle en ligne (enligne.js).
 * (Le même fil sert aux courses en ligne de Burning Kiwi, avec la balise
 * <kw> — options `balise` et `salon` ; voir /bkiwi/multi.js.)
 *
 * Le même WebSocket que le chat et que Grapiz : on s'identifie par `<k l s>`
 * (le pseudo et la session), puis on parle la balise <sb> — voir
 * server/net.js pour le protocole. Les trames arrivent en binaire, séparées
 * par des \0 (le pont XMLSocket de Ruffle) ; on les découpe et on ne garde
 * que les <sb …>.
 *
 * Reconnexion automatique : sur un téléphone, l'arrière-plan ferme la socket
 * de l'iframe. On rétablit, on se ré-identifie, on redit « hello » — et si
 * l'on était en pleine partie, le serveur renvoie l'état entier.
 *
 * LE TEMPS D'ALLER-RETOUR. Le serveur joue la partie et l'écran la miroite :
 * entre le doigt et le virage, il y a un aller-retour entier. Le client doit
 * le CONNAÎTRE pour prédire son propre serpent d'autant (enligne.js). D'où un
 * ping toutes les deux secondes, dont on garde le PLUS PETIT des six derniers
 * relevés — la latence d'un réseau se lit à son plancher, jamais à sa moyenne,
 * qu'un seul paquet en retard suffirait à gonfler.
 */
'use strict';

(function (racine) {

class Reseau {
  constructor(o) {
    const opts = o || {};
    // La balise du jeu : <sb> pour le Battle de Frutisnake, <kw> pour les
    // courses de Burning Kiwi — même socket, même identification, même ping.
    // `salon` : l'événement qui dit « le serveur nous a pris » (le hello cesse).
    this.balise = opts.balise || 'sb';
    this.evenementSalon = opts.salon || 'lobby';
    this.sid = opts.sid || '';
    this.pseudo = opts.pseudo || '';
    this.nom = opts.nom || this.pseudo;
    this.bouille = opts.bouille || '';
    this.surEvenement = opts.surEvenement || (() => {});   // (e, element XML)
    this.surEtat = opts.surEtat || (() => {});             // (texte de statut)
    this.ws = null;
    this.tampon = '';
    this.salonRecu = false;
    this.ferme = false;
    this._helloTimer = null;
    this._reconnexion = null;
    // Le DOMParser se réutilise : quarante trames par seconde en pleine
    // partie, c'était quarante objets jetés par seconde sur un téléphone.
    this._parseur = (typeof DOMParser !== 'undefined') ? new DOMParser() : null;
    this.allerRetour = 0;              // ms, le plancher des derniers relevés
    // L'écart entre l'horloge du serveur et la nôtre (ms), relevé sur le pong
    // le plus court : `st` est l'heure du serveur quand il a répondu. Sert à
    // traduire une heure dite par le serveur (le départ d'une course) en heure
    // locale.
    this.decalage = 0;
    this._decalageRtt = Infinity;
    this._pings = [];
    this._pingTimer = null;
    this._surVisibilite = () => {
      if (!document.hidden && !this.ferme && (!this.ws || this.ws.readyState > 1)) {
        if (this._reconnexion) { clearTimeout(this._reconnexion); this._reconnexion = null; }
        this.connecter();
      }
    };
    document.addEventListener('visibilitychange', this._surVisibilite);
  }

  static xml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  connecter() {
    if (this.ferme) return;
    // Une socket déjà en route (qui s'ouvre, ou ouverte) suffit : en ouvrir
    // une seconde laissait la première vivre en doublon — ses trames
    // arrivaient deux fois, et chaque ouverture refaisait le hello.
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(proto + '://' + location.host + '/'); } catch (e) { this._planifier(); return; }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.surEtat('Identification…');
      this.salonRecu = false;
      this.envoyer('<k l="' + Reseau.xml(this.pseudo) + '" s="' + Reseau.xml(this.sid) + '" />');
      if (this._helloTimer) clearInterval(this._helloTimer);
      this._helloTimer = setInterval(() => {
        if (this.salonRecu || this.ferme) { clearInterval(this._helloTimer); this._helloTimer = null; return; }
        this.sb({ a: 'hello', n: this.nom, f: this.bouille });
      }, 600);
      // Les pings partent une fois la socket ouverte : avant, chaque ping
      // tombait dans le vide et demandait une reconnexion… d'une socket qui
      // était en train de s'ouvrir.
      this._lancerPings();
    };
    ws.onmessage = (ev) => this._recevoir(ev.data);
    ws.onclose = () => { if (this.ws !== ws) return; if (!this.ferme) { this.surEtat('Reconnexion…'); this._planifier(); } };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* déjà fermée */ } };
  }

  // ── Le temps d'aller-retour ──
  _lancerPings() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    // Trois relevés rapprochés au départ — on entre parfois en partie dans la
    // seconde — puis un toutes les deux secondes.
    let rapides = 3;
    const battre = () => {
      this.sb({ a: 'ping', t: String(Math.round(this._horloge())) });
      if (rapides > 0 && --rapides === 0) {
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(battre, 2000);
      }
    };
    this._pingTimer = setInterval(battre, 300);
    battre();
  }
  _horloge() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  _pong(t, st) {
    if (!Number.isFinite(t)) return;
    const maintenant = this._horloge();
    const aller = maintenant - t;
    // Un relevé absurde (onglet endormi, horloge qui a sauté) ne compte pas.
    if (aller < 0 || aller > 3000) return;
    this._pings.push(aller);
    if (this._pings.length > 6) this._pings.shift();
    this.allerRetour = Math.min.apply(null, this._pings);
    // L'horloge du serveur, lue au milieu de l'aller-retour le plus court.
    if (Number.isFinite(st) && aller <= this._decalageRtt) {
      this._decalageRtt = aller;
      this.decalage = st - (t + aller / 2);
    }
  }
  // Une heure du serveur (ms) en heure de la page (performance.now).
  heureLocale(st) { return Number(st) - this.decalage; }

  _planifier() {
    if (this._reconnexion || this.ferme) return;
    this._reconnexion = setTimeout(() => { this._reconnexion = null; this.connecter(); }, 1500);
  }

  envoyer(s) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(s + '\0'); return true; } catch (e) { /* on retombe sur la reconnexion */ }
    }
    // Une socket qui s'ouvre encore (readyState 0) n'a pas besoin d'une
    // seconde : on ne replanifie que si elle est fermée ou en train de l'être.
    if (!this.ws || this.ws.readyState > 1) this._planifier();
    return false;
  }

  // <sb a="…" …/> (ou la balise du jeu)
  sb(attrs) {
    let s = '<' + this.balise;
    for (const k of Object.keys(attrs)) s += ' ' + k + '="' + Reseau.xml(attrs[k]) + '"';
    return this.envoyer(s + ' />');
  }

  _recevoir(data) {
    if (typeof data !== 'string') {
      if (data instanceof Blob) { data.text().then((t) => this._recevoir(t)); return; }
      try { data = new TextDecoder('utf-8').decode(data); } catch (e) { return; }
    }
    this.tampon += data;
    const parts = this.tampon.split('\0');
    this.tampon = parts.pop();
    for (let p of parts) {
      p = p.trim();
      if (p.indexOf('<' + this.balise) !== 0) continue;
      let doc;
      try { doc = this._parseur.parseFromString(p, 'text/xml'); } catch (e) { continue; }
      const el = doc.documentElement;
      if (!el || el.nodeName !== this.balise) continue;
      const e = el.getAttribute('e');
      if (e === 'pong') { this._pong(Number(el.getAttribute('t')), Number(el.getAttribute('st'))); continue; }
      if (e === this.evenementSalon && !this.salonRecu) { this.salonRecu = true; this.surEtat('Connecté'); }
      this.surEvenement(e, el);
    }
  }

  // Quitter le salon pour de bon : la socket se ferme, le serveur nous retire.
  fermer() {
    this.ferme = true;
    document.removeEventListener('visibilitychange', this._surVisibilite);
    if (this._helloTimer) { clearInterval(this._helloTimer); this._helloTimer = null; }
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    if (this._reconnexion) { clearTimeout(this._reconnexion); this._reconnexion = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(); } catch (e) { /* déjà fermée */ } }
  }
}

const API = { Reseau };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else { racine.SnakeReseau = API; racine.ReseauJeu = API; }

})(typeof window !== 'undefined' ? window : globalThis);
