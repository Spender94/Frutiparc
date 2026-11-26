/*
 * Kit bande-annonce, section « chat » — LE SITE EN LOCAL, SES COMPTES, SES BOTS.
 *
 * Tout passe par les vraies portes du site :
 *   · le serveur est `server.js` lui-même, lancé SANS base (tout en mémoire) ;
 *   · les comptes naissent par POST /api/auth/register puis /api/auth/login ;
 *   · la bouille se pose par /do/eb (la porte de l'éditeur « Ma Frutibouille »
 *     du light), les rôles par PATCH /api/admin/users/<pseudo> ;
 *   · les figurants parlent le protocole XML du chat (CBee, trames terminées
 *     par \0) sur la WebSocket du site, comme le client light : `<k>` pour
 *     s'identifier, `<o>` pour entrer dans un salon, `<t>` pour parler,
 *     `<af>` pour changer d'humeur, `<y>` pour repartir.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// scripts/kit-bande-annonce/chat/lib → racine du dépôt.
const RACINE = path.resolve(__dirname, '..', '..', '..', '..');
const WebSocket = require(path.join(RACINE, 'node_modules', 'ws'));
const { Client } = require(path.join(RACINE, 'node_modules', 'pg'));

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Les humeurs d'`emoteList`, par leur nom au parc (cf. public/frutiz/BOUILLES.md §4).
const HUMEURS = {
  neutre: 0, colere: 1, colère: 1, triste: 2, sourire: 3, joie: 4,
  determine: 5, déterminé: 5, embarrasse: 6, embarrassé: 6, totoche: 7, totoché: 7,
};

function echapperXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/*
 * Découpe un flux d'octets en trames XML. Le pont WebSocket→TCP du serveur
 * renvoie les morceaux TCP tels quels : une trame peut arriver en deux
 * paquets, et un caractère accentué peut être coupé en deux octets. On coupe
 * donc sur l'octet 0 AVANT de décoder l'UTF-8.
 */
function decoupeur() {
  let reste = Buffer.alloc(0);
  return function (morceau) {
    const buf = Buffer.isBuffer(morceau) ? morceau : Buffer.from(String(morceau), 'utf8');
    reste = Buffer.concat([reste, buf]);
    const trames = [];
    let i;
    while ((i = reste.indexOf(0)) >= 0) {
      const t = reste.subarray(0, i).toString('utf8').trim();
      if (t) trames.push(t);
      reste = reste.subarray(i + 1);
    }
    return trames;
  };
}

// La valeur d'un attribut dans une trame (brute, entités comprises).
function attribut(xml, nom) {
  const m = new RegExp('\\s' + nom + '="([^"]*)"').exec(String(xml).replace(/^<[^\s>]+/, ''));
  return m ? m[1] : null;
}
function balise(xml) {
  const m = /^<([a-zA-Z0-9]+)/.exec(xml);
  return m ? m[1] : '';
}

class Site {
  /**
   * @param {object} o
   * @param {number} o.port       port HTTP (et WebSocket du chat)
   * @param {number} o.portXml    port TCP du chat (XMLSocket)
   * @param {number} o.portScore  port TCP des scores
   * @param {string} o.cle        clé d'administration (ADMIN_KEY)
   * @param {string} o.journal    fichier où écrire la sortie du serveur
   * @param {string} o.base       URL Postgres d'une base À NOUS (recréée à chaque
   *                              démarrage). Les RÔLES (animatrice) ne s'écrivent
   *                              que dans une base : sans elle, pas de quiz.
   */
  constructor(o) {
    this.port = o.port;
    this.portXml = o.portXml;
    this.portScore = o.portScore;
    this.cle = o.cle || 'cle-kit-chat';
    this.journal = o.journal || path.join(os.tmpdir(), 'kit-chat-serveur-' + o.port + '.log');
    this.base = 'http://127.0.0.1:' + this.port;
    this.bdd = o.base || '';
    this.proc = null;
  }

  // Une base neuve à chaque tournage : mêmes comptes, même scène, rien d'hérité.
  async baseNeuve() {
    if (!this.bdd) return false;
    const nom = this.bdd.split('/').pop();
    const admin = new Client({ connectionString: this.bdd.replace(/\/[^/]+$/, '/postgres') });
    try {
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${nom}`);
      return true;
    } catch (e) {
      console.warn('[site] Postgres indisponible (' + e.message + ') : serveur en mémoire, sans rôles');
      this.bdd = '';
      return false;
    } finally { try { await admin.end(); } catch (e) { /* déjà fermée */ } }
  }

  // Le serveur crée son schéma au démarrage : on attend la dernière table.
  async schemaPret() {
    if (!this.bdd) return;
    for (let i = 0; i < 160; i++) {
      const c = new Client({ connectionString: this.bdd });
      try {
        await c.connect();
        const r = await c.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'kikooz_gifts'");
        if (r.rows.length) return;
      } catch (e) { /* pas encore */ } finally { try { await c.end(); } catch (e) { /* */ } }
      await attendre(250);
    }
    throw new Error('le schéma de la base n’est jamais apparu');
  }

  async demarrer() {
    /*
     * UN DÉTAIL QUI COÛTE UNE HEURE : express (le module `send`) refuse de
     * servir un fichier dont le chemin contient un segment CACHÉ — et un
     * arbre de travail git vit souvent sous `.claude/worktrees/…`. /light
     * répondait alors 404. On passe donc par un lien symbolique sans point,
     * et `--preserve-symlinks-main` garde ce chemin-là dans `__dirname`.
     */
    let racine = RACINE;
    if (RACINE.split(path.sep).some((s) => s.startsWith('.'))) {
      const lien = path.join(os.tmpdir(), 'kit-chat-site-' + this.port);
      try { fs.unlinkSync(lien); } catch (e) { /* pas de lien précédent */ }
      fs.symlinkSync(RACINE, lien);
      racine = lien;
    }
    await this.libererPort();
    await this.baseNeuve();
    const sortie = fs.openSync(this.journal, 'w');
    this.proc = spawn(process.execPath,
      ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
        cwd: racine,
        env: Object.assign({}, process.env, {
          PORT: String(this.port), DATABASE_URL: this.bdd, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
          ADMIN_KEY: this.cle, XMLSOCKET_PORT: String(this.portXml), FRUTISCORE_PORT: String(this.portScore),
        }),
        stdio: ['ignore', sortie, sortie],
      });
    this.proc.on('exit', (code) => { this.proc = null; if (code) console.error(`[site] serveur arrêté (code ${code}) — voir ${this.journal}`); });
    for (let i = 0; i < 240; i++) {
      try {
        const r = await fetch(this.base + '/light');
        if (r.ok) { await this.schemaPret(); await attendre(1500); return; }
      } catch (e) { /* pas encore prêt */ }
      await attendre(250);
    }
    throw new Error('le serveur ne répond pas — voir ' + this.journal);
  }

  // Un serveur d'une génération précédente (interrompue) tiendrait encore le port.
  async libererPort() {
    try {
      const r = await fetch(this.base + '/light', { signal: AbortSignal.timeout(800) });
      if (r) throw new Error(`le port ${this.port} est déjà pris : arrête l'ancien serveur d'abord`);
    } catch (e) {
      if (/déjà pris/.test(e.message)) throw e;
    }
  }

  async arreter() {
    if (!this.proc) return;
    const p = this.proc;
    p.kill('SIGTERM');
    for (let i = 0; i < 40 && this.proc; i++) await attendre(100);
    if (this.proc) p.kill('SIGKILL');
  }

  async json(chemin, corps, methode) {
    const r = await fetch(this.base + chemin, {
      method: methode || 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': this.cle },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* pas du JSON */ }
    return { statut: r.status, json: j };
  }

  /** Inscrit (si besoin) puis connecte un compte ; rend le sid. */
  async inscrire(affiche, motDePasse) {
    const corps = { username: affiche, password: motDePasse || 'kit-chat-2026' };
    await this.json('/api/auth/register', corps);
    const r = await this.json('/api/auth/login', corps);
    if (!r.json || !r.json.sid) throw new Error('connexion impossible pour ' + affiche + ' : ' + JSON.stringify(r.json));
    return r.json.sid;
  }

  /** La bouille, par la porte de l'éditeur du light (/do/eb). */
  async poserBouille(sid, etat) {
    const r = await fetch(`${this.base}/do/eb?sid=${encodeURIComponent(sid)}&b=${encodeURIComponent(etat)}`);
    const t = await r.text();
    if (!/state=0/.test(t)) throw new Error('bouille refusée : ' + t);
  }

  /** Rôles et champs d'admin (is_animator, kikooz…). */
  async role(pseudo, champs) {
    if (!this.bdd) { console.warn('[site] pas de base : rôle ignoré pour ' + pseudo); return; }
    const r = await this.json('/api/admin/users/' + encodeURIComponent(pseudo.toLowerCase()), champs, 'PATCH');
    if (r.statut !== 200) throw new Error('PATCH admin refusé pour ' + pseudo + ' : ' + r.statut);
  }

  async reglagesGaspard(reglages) {
    const r = await this.json('/api/admin/gaspard/reglages', reglages, 'POST');
    if (r.statut !== 200) throw new Error('réglages de Gaspard refusés : ' + r.statut);
  }

  /** Un figurant connecté au chat. */
  async bot(affiche, sid) {
    const b = new Bot(this, affiche, sid);
    await b.connecter();
    return b;
  }
}

class Bot {
  constructor(site, affiche, sid) {
    this.site = site;
    this.affiche = affiche;
    this.pseudo = affiche.toLowerCase();
    this.sid = sid;
    this.trames = [];
    this.feutre = '';
    this.salon = null;
  }

  async connecter() {
    this.ws = new WebSocket(this.site.base.replace(/^http/, 'ws') + '/');
    const couper = decoupeur();
    this.ws.on('message', (d) => { for (const t of couper(d)) this.trames.push(t); });
    await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    // lc="1" : la marque du client light (cf. connectWs, public/light.html).
    this.envoyer(`<k l="${echapperXml(this.affiche)}" s="${this.sid}" lc="1" />`);
    await this.guetter((t) => balise(t) === 'k', 'identification');
  }

  envoyer(xml) { this.ws.send(xml + '\0'); }

  async guetter(pred, quoi, ms) {
    const fin = Date.now() + (ms || 5000);
    while (Date.now() < fin) {
      const t = this.trames.find(pred);
      if (t) return t;
      await attendre(30);
    }
    throw new Error(`${this.affiche} : ${quoi} — jamais reçu`);
  }

  rejoindre(salon) { this.salon = salon; this.envoyer(`<o g="${salon}" />`); }
  quitter(salon) { this.envoyer(`<y g="${salon || this.salon}" />`); }

  /** Une ligne au salon. Les émotes (« mdr », « bisou »…) et les commandes
   *  (« /point … », « !cri ») sont du texte comme les autres : c'est le
   *  serveur qui les reconnaît, exactement comme pour un joueur. */
  dire(texte, salon) {
    const p = this.feutre === '' || this.feutre == null ? '' : String(this.feutre);
    this.envoyer(`<t g="${salon || this.salon}" t="m" p="${p}">${echapperXml(texte)}</t>`);
  }

  /** L'humeur voyage dans le statut : `[ext][internal×2][emote]` (BOUILLES.md §5 ter). */
  humeur(h) {
    const n = typeof h === 'number' ? h : HUMEURS[String(h).toLowerCase()];
    if (n === undefined) throw new Error('humeur inconnue : ' + h);
    this.envoyer(`<af s="000${n}" />`);
  }

  /** /donne : le transfert par HTTP (/do/give), puis la trame t="g" au salon,
   *  comme le fait le client (cf. le type "g" du serveur). */
  async donner(cible, kikooz, raison, salon) {
    const r = await fetch(`${this.site.base}/do/give?sid=${this.sid}&k=${kikooz}&u=${encodeURIComponent(cible)}&r=${encodeURIComponent(raison || '')}`);
    const t = await r.text();
    if (!/k="0"/.test(t)) throw new Error('don refusé : ' + t);
    this.envoyer(`<t g="${salon || this.salon}" t="g" p=""><g k="${kikooz}" u="${echapperXml(cible)}" /></t>`);
  }

  fermer() { try { this.ws.close(); } catch (e) { /* déjà fermée */ } }
}

module.exports = { Site, Bot, HUMEURS, RACINE, attendre, decoupeur, attribut, balise, echapperXml };
