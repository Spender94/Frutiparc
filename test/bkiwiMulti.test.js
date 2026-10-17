/*
 * BURNING KIWI EN LIGNE — le parc de bout en bout, sans navigateur.
 *
 * Deux pilotes sur la WebSocket du parc (la balise <kw>, server.js →
 * public/bkiwi/server/net.js) : le hub, un salon, la X Violet, le prêt et le
 * lancement, le chargement et le go commun, les positions relayées à l'autre
 * (et à lui seul), l'arrivée au temps, le résultat, et le salon prêt pour la
 * revanche. Le voyant « joue à Burning Kiwi » s'allume pour les deux.
 *
 * Et ce que le client embarque : le mode dans le menu, la voiture du mode, le
 * fil partagé (reseau.js) qui parle <kw>.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── Le client, statiquement ────────────────────────────────────────────────

test('le menu propose « en ligne », la X Violet n’est que là, et le fil parle <kw>', () => {
  const menu = lire('public/bkiwi/jeu/menu.js');
  assert.match(menu, /attachButton\(15, 'en ligne'/);
  assert.match(menu, /attachButton\(46, 'x violet'/);
  assert.match(menu, /case 160:/);
  const multi = lire('public/bkiwi/multi.js');
  assert.match(multi, /balise: 'kw'/);
  assert.match(multi, /kiwis: 7, skin: 41, violet: true, phares: true/);
  const reseau = lire('public/snake3/reseau.js');
  assert.match(reseau, /this\.balise = opts\.balise \|\| 'sb'/);
  assert.match(reseau, /heureLocale\(st\)/);
  const page = lire('public/bkiwi/index.html');
  assert.match(page, /<div id="bk-multi"><\/div>/);
  assert.match(page, /\/snake3\/reseau\.js/);
  assert.match(page, /\/bkiwi\/multi\.js/);
  // « bk » est déjà un code du protocole : la route est « kw ».
  const serveur = lire('server.js');
  assert.match(serveur, /case 'kw': \{/);
  assert.ok(!/case 'bk': \{/.test(serveur));
});

test('la X Violet prend le meilleur de chaque colonne des cinq écuries', () => {
  globalThis.window = undefined;
  for (const f of ['public/kaluga/moteur/formes.js', 'public/kaluga/moteur/flash.js', 'public/bkiwi/jeu/scripts-images.js',
    'public/bkiwi/jeu/biblio.js', 'public/bkiwi/jeu/donnees.js', 'public/bkiwi/multi.js']) require(path.join(ROOT, f));
  const J = globalThis.BkiwiJeu;
  const M = {};
  J.initialiserDonnees(M);
  J.installerMulti(M);
  const cinq = M.carStats.slice(0, 5);
  const v = M.carStats[M.X_VIOLET];
  assert.strictEqual(v.rot, Math.max(...cinq.map((c) => c.rot)));
  assert.strictEqual(v.accel, Math.max(...cinq.map((c) => c.accel)));
  assert.strictEqual(v.maxSpeed, Math.max(...cinq.map((c) => c.maxSpeed)));
  assert.strictEqual(v.grip, Math.max(...cinq.map((c) => c.grip)));
  assert.strictEqual(v.turning, Math.max(...cinq.map((c) => c.turning)));
  assert.strictEqual(v.brake, Math.min(...cinq.map((c) => c.brake)), 'le frein le plus mordant');
  assert.strictEqual(v.kiwis, M.maxKiwis, 'sept nitros, le plafond du jeu');
  // Son aspect : l'UltraCop (41), teinte en violet, phares allumés — rien de commun avec les cinq.
  assert.strictEqual(v.skin, 41);
  assert.ok(v.violet && v.phares);
  assert.ok(!cinq.some((c) => c.skin === v.skin || c.phares));
  assert.strictEqual(M.MULTI, 9);
  assert.strictEqual(J.nomVoiture(5), 'X Violet');
  assert.strictEqual(J.nomVoiture(2), 'Fury Hun');
});

// ── Le parc ──────────────────────────────────────────────────────────────────

const PORT = 3614;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.TEST_DATABASE_URL_BKMULTI || 'postgres://postgres@127.0.0.1:5433/frutiparc_bkmulti_test';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-bkmulti-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };

let proc = null, dispo = false;
async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch {} return false; }
}
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5486', FRUTISCORE_PORT: '5487', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=bkiwi')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
}
before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  await demarrer();
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json());
async function compte(pseudo) {
  await post('/api/auth/register', { username: pseudo, password: 'secret123' });
  return (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).sid;
}

// Un pilote : la socket du parc, identifiée, qui ne garde que les trames <kw>.
class Pilote {
  constructor(pseudo, sid) {
    this.pseudo = pseudo; this.sid = sid; this.recues = []; this.tampon = '';
  }
  async ouvrir() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    this.ws.binaryType = 'arraybuffer';
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = (ev) => {
      const t = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
      this.tampon += t;
      const parts = this.tampon.split('\0');
      this.tampon = parts.pop();
      for (const p of parts) if (p.trim().startsWith('<kw')) this.recues.push(p.trim());
    };
    this.envoyer(`<k l="${this.pseudo}" s="${this.sid}" />`);
    await wait(400);
  }
  envoyer(xml) { this.ws.send(xml + '\0'); }
  kw(attrs) { this.envoyer('<kw ' + Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ') + ' />'); }
  // La prochaine trame d'un événement donné (déjà reçue, ou à venir).
  async attendre(e, delai) {
    const depuis = this._lu || 0;
    for (let i = 0; i < (delai || 4000) / 50; i++) {
      for (let k = depuis; k < this.recues.length; k++) {
        if (this.recues[k].startsWith(`<kw e="${e}"`)) { this._lu = k + 1; return this.recues[k]; }
      }
      await wait(50);
    }
    return null;
  }
  oublier() { this._lu = this.recues.length; }
  fermer() { try { this.ws.close(); } catch { /* déjà fermée */ } }
}
const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml || ''); return m ? m[1] : null; };

test('deux pilotes : salon, X Violet, départ commun, positions relayées, arrivée au temps, résultat', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  const ana = new Pilote('anakiwi', await compte('anakiwi'));
  const bob = new Pilote('bobkiwi', await compte('bobkiwi'));
  await ana.ouvrir(); await bob.ouvrir();
  try {
    ana.kw({ a: 'hello', n: 'Ana' });
    bob.kw({ a: 'hello', n: 'Bob' });
    let hub = await bob.attendre('hub');
    assert.ok(hub, 'le hub répond au hello');
    // Ana ouvre une course sur Banana Derby, prend la X Violet ; Bob rejoint, prêt.
    ana.kw({ a: 'creer', p: '1' });
    const salon = await ana.attendre('salon');
    assert.strictEqual(attr(salon, 'h'), 'anakiwi');
    const id = attr(salon, 's');
    ana.kw({ a: 'voiture', c: '5' });
    await ana.attendre('salon');
    hub = await bob.attendre('hub');
    // Le nom montré aux autres est celui du parc, pas celui que la page a dit.
    assert.ok(hub.includes(`<s i="${id}" h="anakiwi" p="1" n="1" e="attente"/>`), hub);
    bob.oublier();
    bob.kw({ a: 'rejoindre', s: id });
    const s2 = await bob.attendre('salon');
    assert.ok(s2.includes('<j u="anakiwi" n="anakiwi" f="" c="5" i="0"') && s2.includes('<j u="bobkiwi" n="bobkiwi" f="" c="0" i="1"'), s2);
    bob.kw({ a: 'pret', r: '1' });
    await bob.attendre('salon');
    ana.oublier();
    // Le lancement : le départ chez les deux, puis chacun charge, puis le go — la même heure.
    ana.kw({ a: 'lancer' });
    const dA = await ana.attendre('depart'), dB = await bob.attendre('depart');
    assert.ok(dA && dB, 'le départ est dit aux deux');
    assert.strictEqual(attr(dA, 'p'), '1');
    ana.kw({ a: 'charge' });
    assert.strictEqual(await bob.attendre('go', 600), null, 'Bob n’a pas chargé : pas encore de go');
    bob.kw({ a: 'charge' });
    const gA = await ana.attendre('go'), gB = await bob.attendre('go');
    assert.ok(gA && gB);
    assert.strictEqual(attr(gA, 'at'), attr(gB, 'at'), 'la même heure de départ pour les deux');
    assert.ok(Number(attr(gA, 'at')) > Number(attr(gA, 't')), 'dans le futur');
    // Les positions : celles d'Ana vont à Bob, et à lui seul.
    ana.oublier(); bob.oublier();
    ana.kw({ a: 'pos', x: '414.5', y: '670.0', r: '-70.0', v: '12.30', n: '1', l: '0', c: '3', k: '3', f: '0' });
    const pos = await bob.attendre('pos');
    assert.strictEqual(pos, '<kw e="pos" u="anakiwi" x="414.5" y="670.0" r="-70.0" v="12.30" n="1" l="0" c="3" k="3" f="0"/>');
    assert.strictEqual(await ana.attendre('pos', 400), null, 'jamais à soi');
    // Le ping porte l'heure du serveur.
    ana.kw({ a: 'ping', t: '777' });
    const pong = await ana.attendre('pong');
    assert.strictEqual(attr(pong, 't'), '777');
    assert.ok(Number(attr(pong, 'st')) > 1e12);
    // L'arrivée : Bob arrive le premier chez le serveur, Ana a le meilleur temps.
    bob.kw({ a: 'fin', t: '61000' });
    let arr = await ana.attendre('arrivee');
    assert.ok(arr.includes('<a u="bobkiwi" n="bobkiwi" c="0" t="61000" g="1"/>'), arr);
    ana.kw({ a: 'fin', t: '60500' });
    const res = await bob.attendre('resultat');
    assert.ok(res && res.includes('<a u="anakiwi" n="anakiwi" c="5" t="60500" g="1"/><a u="bobkiwi" n="bobkiwi" c="0" t="61000" g="2"/>'), res);
    const apres = await bob.attendre('salon');
    assert.strictEqual(attr(apres, 'et'), 'attente', 'le salon est prêt pour la revanche');
    // Bob part : Ana reste seule, hôte ; le hub de Bob ne compte plus qu'un pilote.
    ana.oublier(); bob.oublier();
    bob.kw({ a: 'quitter' });
    const seule = await ana.attendre('salon');
    assert.ok(seule && seule.includes('<j u="anakiwi"') && !seule.includes('bobkiwi'), seule);
    hub = await bob.attendre('hub');
    assert.ok(hub && hub.includes(`<s i="${id}" h="anakiwi" p="1" n="1" e="attente"/>`) && hub.includes('<j u="bobkiwi"'), hub);
    // Ana se déconnecte : le salon disparaît du hub de Bob.
    bob.oublier();
    ana.fermer();
    hub = await bob.attendre('hub', 6000);
    assert.ok(hub && !hub.includes('<s i='), hub);
  } finally {
    ana.fermer(); bob.fermer();
  }
});
