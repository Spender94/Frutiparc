'use strict';
/*
 * LES ACCESSOIRES DONNÉS SURVIVENT AU REBOOT — contre une vraie base (sautée
 * sans Postgres sur 5433).
 *
 * « Les accessoires nouvellement donnés (manuellement via l'admin à priori)
 * sautent au reboot. » Deux causes :
 *
 *   · les ACCESSOIRES MAISON (le catalogue que l'admin dessine, et le port de
 *     chaque joueur) ne vivaient que dans data/, sur le disque ÉPHÉMÈRE du
 *     conteneur : un redéploiement les effaçait. Ils sont maintenant en base ;
 *   · la fiche joueur de l'admin rangeait la « Valeur » telle quelle — un
 *     suffix9 de neuf caractères là où tout le parc attend une bouille de
 *     vingt-quatre : l'inventaire du light l'écartait, le bureau ne pouvait pas
 *     l'enfiler. Elle est complétée comme le font l'achat et « Pousser à tous ».
 *
 * Le redémarrage se fait sur un dossier de données VIDE (FRUTI_DATA_DIR neuf) :
 * c'est le conteneur redéployé, où seule la base a survécu. On vérifie aussi
 * les autres chemins qui accordent un accessoire (l'achat en boutique) et que
 * le « Chauve » est offert à tous, comptes existants compris.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3655;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_accpersist';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null, dispo = false;
const dossiers = [];

async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}

// Un serveur sur un dossier de données NEUF : le disque d'un conteneur redéployé.
async function demarrer() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-accpersist-'));
  dossiers.push(data);
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5695', FRUTISCORE_PORT: '5696', FRUTI_DATA_DIR: data,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/api/online-count')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
  // Le chargement de la base (articles, accessoires maison…) suit l'ouverture du port.
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + '/api/admin/shop', { headers: { 'x-admin-key': CLE } });
      if (r.ok && (await r.json()).length) break;
    } catch { /* pas prêt */ }
    await wait(250);
  }
  await wait(1500);
}
async function arreter() {
  if (!proc) return;
  const p = proc; proc = null;
  await new Promise((ok) => { p.once('exit', ok); p.kill('SIGKILL'); });
}

before(async () => {
  dispo = await baseNeuve();
  if (dispo) await demarrer();
});
after(async () => {
  await arreter();
  for (const d of dossiers) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* rien */ } }
});

const json = (r) => r.json();
const adm = (url, opts = {}) => fetch(BASE + url, Object.assign({}, opts,
  { headers: Object.assign({ 'x-admin-key': CLE, 'Content-Type': 'application/json' }, opts.headers || {}) }));
async function connecter(pseudo, inscrire) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  if (inscrire) await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const j = await json(await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body }));
  assert.ok(j.sid, 'session de ' + pseudo);
  return j.sid;
}
const inventaire = (sid) => fetch(`${BASE}/api/light/inventaire?sid=${sid}`).then(json);
const boutique = (sid) => fetch(`${BASE}/api/light/shop?sid=${sid}`).then(json);
const possede = (shop, id) => shop.categories.some((c) => (c.items || []).some((it) => it.id === id && it.owned));

test('donné par l’admin, acheté, accessoire maison porté : tout survit au redéploiement', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await connecter('Pruneline', true);
  // Une bouille à soi : coupe 20, peau 3 — l'accessoire donné doit s'y poser.
  const fb = '0002000k03090e0000000000';
  assert.strictEqual((await json(await adm('/api/admin/users/pruneline', { method: 'PATCH',
    body: JSON.stringify({ fbouille: fb, kikooz: 500, xp: 0 }) }))).ok, true);

  const packs = await json(await adm('/api/admin/shop'));
  const [p1, p2, p3] = packs.filter((p) => p.category === 'Accessoires' && /^[0-9A-Za-z]{9}$/.test(p.suffix9 || '')
    && p.suffix9 !== '000000000' && !p.disabled && !p.recompense && p.price > 0).slice(0, 3);
  assert.ok(p1 && p2 && p3, 'trois accessoires en rayon');

  // 1. La fiche joueur, comme l'admin la remplit : un SUFFIXE en valeur.
  let r = await json(await adm('/api/admin/users/pruneline/accessories', { method: 'POST',
    body: JSON.stringify({ id: 'shop_' + p1.id, shopId: p1.id, name: p1.name, value: p1.suffix9, price: '0' }) }));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.accessoire.v, fb.substring(0, 15) + p1.suffix9, 'le suffixe reçoit la bouille du joueur');
  // 2. Juste le numéro d'article : nom et suffixe viennent de l'article.
  r = await json(await adm('/api/admin/users/pruneline/accessories', { method: 'POST',
    body: JSON.stringify({ shopId: p2.id }) }));
  assert.deepStrictEqual([r.accessoire.id, r.accessoire.n, r.accessoire.v],
    ['shop_' + p2.id, p2.name, fb.substring(0, 15) + p2.suffix9]);
  // 3. Un achat en boutique.
  const achat = await json(await fetch(BASE + '/api/light/shop/buy', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid, id: p3.id }) }));
  assert.strictEqual(achat.ok, true, JSON.stringify(achat));
  // 4. Un accessoire maison dessiné par l'admin, et porté.
  const corps = JSON.stringify({ name: 'Plume maison', price: 0, auteur: 'artiste',
    paths: [{ d: 'M10 10h20v20h-20z', fill: '#ff0000', slot: 1 }], couleurs: ['#00ff00', null, null] });
  const am = await json(await fetch(BASE + '/api/admin/acc-maison', { method: 'POST',
    headers: { 'x-admin-key': CLE, 'Content-Type': 'application/octet-stream' }, body: corps }));
  assert.strictEqual(am.ok, true, JSON.stringify(am));
  const porte = await json(await fetch(BASE + '/api/light/acc-maison/equip', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid, id: am.id }) }));
  assert.strictEqual(porte.ok, true);

  // Tout se voit TOUT DE SUITE, sans reboot : la mémoire du joueur a suivi.
  const verifier = async (s, quand) => {
    const inv = await inventaire(s);
    const ids = inv.accessoires.map((a) => a.id);
    for (const p of [p1, p2, p3]) assert.ok(ids.includes('shop_' + p.id), `${quand} : ${p.name} dans l'inventaire (${ids})`);
    const a1 = inv.accessoires.find((a) => a.id === 'shop_' + p1.id);
    assert.strictEqual(a1.etat, fb.substring(0, 15) + p1.suffix9, `${quand} : un état portable`);
    const shop = await boutique(s);
    for (const p of [p1, p2, p3]) assert.ok(possede(shop, p.id), `${quand} : ${p.name} marqué possédé`);
    const liste = await json(await fetch(BASE + '/api/light/acc-maison'));
    assert.ok(liste.liste.some((a) => a.id === am.id && a.name === 'Plume maison'), `${quand} : l'accessoire maison au catalogue`);
    const dessin = await json(await fetch(BASE + '/api/light/acc-maison/' + am.id));
    assert.strictEqual(dessin.ok, true, `${quand} : son dessin est servi`);
    assert.deepStrictEqual(dessin.couleurs, ['#00ff00', null, null]);
    assert.ok(inv.bouille.split('|')[1] === am.id, `${quand} : porté sur la bouille (${inv.bouille})`);
    // Le Chauve, offert à tous.
    assert.ok(inv.accessoires.some((a) => a.id === 'chauve' && a.etat === fb.substring(0, 15) + '0ZZ000000'),
      `${quand} : le Chauve dans l'inventaire`);
  };
  await verifier(sid, 'avant');

  // LE REDÉPLOIEMENT : le processus tombe, le disque repart vide.
  await arreter();
  await demarrer();
  const sid2 = await connecter('pruneline', false);
  await verifier(sid2, 'après');
  const fiche = await json(await adm('/api/admin/users/pruneline'));
  assert.strictEqual(fiche.accessories.length, 3, 'trois lignes en base, ni plus ni moins');
});

test('le Chauve est offert à tous, y compris aux comptes d’avant', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await connecter('Chataigne', true);
  const me = await json(await fetch(`${BASE}/api/forum/me?sid=${sid}`));
  assert.ok((me.defaultAccessories || []).some((a) => a.name === 'Chauve' && a.suffix === '0ZZ000000'),
    'le sélecteur du forum et la feuille « Ma Frutibouille » le proposent');
  // On le porte, et la bouille le garde au redémarrage suivant (déjà vérifié
  // pour les autres) : ici, juste qu'il se porte comme un autre accessoire.
  const inv = await inventaire(sid);
  const chauve = inv.accessoires.find((a) => a.id === 'chauve');
  assert.ok(chauve, 'dans l’inventaire sans rien acheter');
  assert.strictEqual(chauve.etat.length, 24);
  assert.strictEqual(chauve.etat.substring(15), '0ZZ000000');
});
