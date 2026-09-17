/*
 * Frutisnake — le fil avec le serveur du Battle en ligne (enligne.js).
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
 */
'use strict';

(function (racine) {

class Reseau {
  constructor(o) {
    const opts = o || {};
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
    };
    ws.onmessage = (ev) => this._recevoir(ev.data);
    ws.onclose = () => { if (this.ws !== ws) return; if (!this.ferme) { this.surEtat('Reconnexion…'); this._planifier(); } };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* déjà fermée */ } };
  }

  _planifier() {
    if (this._reconnexion || this.ferme) return;
    this._reconnexion = setTimeout(() => { this._reconnexion = null; this.connecter(); }, 1500);
  }

  envoyer(s) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(s + '\0'); return true; } catch (e) { /* on retombe sur la reconnexion */ }
    }
    this._planifier();
    return false;
  }

  // <sb a="…" …/>
  sb(attrs) {
    let s = '<sb';
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
      if (p.indexOf('<sb') !== 0) continue;
      let doc;
      try { doc = new DOMParser().parseFromString(p, 'text/xml'); } catch (e) { continue; }
      const el = doc.documentElement;
      if (!el || el.nodeName !== 'sb') continue;
      const e = el.getAttribute('e');
      if (e === 'lobby' && !this.salonRecu) { this.salonRecu = true; this.surEtat('Connecté'); }
      this.surEvenement(e, el);
    }
  }

  // Quitter le salon pour de bon : la socket se ferme, le serveur nous retire.
  fermer() {
    this.ferme = true;
    document.removeEventListener('visibilitychange', this._surVisibilite);
    if (this._helloTimer) { clearInterval(this._helloTimer); this._helloTimer = null; }
    if (this._reconnexion) { clearTimeout(this._reconnexion); this._reconnexion = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(); } catch (e) { /* déjà fermée */ } }
  }
}

const API = { Reseau };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeReseau = API;

})(typeof window !== 'undefined' ? window : globalThis);
