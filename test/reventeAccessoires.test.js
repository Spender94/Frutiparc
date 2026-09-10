'use strict';
/*
 * LA BOUTIQUE DANS LES DEUX SENS — ET LA PART DE L'ARTISTE
 * ═══════════════════════════════════════════════════════
 *
 * Quatre demandes d'un même lot, qui tiennent ensemble :
 *
 *   · « une sous-catégorie pour séparer les accessoires homemade et les
 *     accessoires officiels » — un article signé d'un AUTEUR (ou issu d'une
 *     variante de l'atelier, identifiant à partir de 700000) va au rayon
 *     « Accessoires maison », juste après les accessoires d'époque ;
 *   · « 10 % de commission kikooz par vente pour les créateurs » — l'auteur
 *     touche un dixième du prix à chaque achat ;
 *   · « revendre des accessoires » — double-clic sur un article possédé, une
 *     popin « Voulez-vous vendre … ? », et l'exemplaire quitte l'inventaire
 *     contre la MOITIÉ du prix payé, ou TRENTE kikooz s'il a été offert ;
 *   · « changer un fichier d'accessoire déjà uploadé » et « effacer les tests
 *     déjà supprimés » — l'admin remplace le SVG d'une variante (même index)
 *     et purge de sa liste les variantes retirées (leur place reste prise).
 *
 * Un vrai serveur sur une vraie base : acheté ou offert se lit dans les
 * registres d'achats et de reventes, et c'est cela qu'on vérifie.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3571;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-revente';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_revente';
const RUN = Date.now().toString(36).slice(-4);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
async function baseDisponible() {
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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5302', FRUTISCORE_PORT: '5303',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = 'shop_packs' AND column_name = 'auteur'`);
        const t = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'shop_sales'`);
        await c.end();
        if (rows.length && t.rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
let dispo = false;
before(async () => { dispo = await baseDisponible(); if (dispo) await demarrer(); });
after(async () => { if (proc) proc.kill('SIGKILL'); });

const HDR = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const admin = (methode, chemin, corps) => fetch(BASE + chemin, {
  method: methode, headers: HDR, body: corps === undefined ? undefined : JSON.stringify(corps),
});
// Les routes de l'atelier prennent un Blob JSON en octet-stream.
const adminBrut = (methode, chemin, corps) => fetch(BASE + chemin, {
  method: methode, headers: { 'Content-Type': 'application/octet-stream', 'x-admin-key': CLE },
  body: JSON.stringify(corps),
});
async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: HDR, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: HDR, body });
  const sid = (await r.json()).sid;
  assert.ok(sid, 'session de ' + pseudo);
  return sid;
}
const boutique = async (sid) => (await fetch(`${BASE}/api/light/shop?sid=${sid}`)).json();
const rayon = (d, nom) => (d.categories || []).find((c) => c.name === nom);
const historique = async (sid) => (await (await fetch(`${BASE}/api/light/kikooz?sid=${sid}`)).json()).events;
const offre = async (sid, id) => (await fetch(`${BASE}/api/light/shop/revente?sid=${sid}&id=${id}`)).json();
const vendre = async (sid, id) => (await fetch(BASE + '/api/light/shop/vendre', {
  method: 'POST', headers: HDR, body: JSON.stringify({ sid, id }) })).json();
const acheter = async (sid, id) => (await fetch(BASE + '/api/light/shop/buy', {
  method: 'POST', headers: HDR, body: JSON.stringify({ sid, id }) })).json();
// L'INVENTAIRE — c'est de là qu'on revend, pas de la boutique. Le mobile le lit
// par /api/forum/me (`shopId` désigne l'article, `revendable` dit que la
// boutique le reprend) ; le bureau par /ff/ls, où le même fait s'écrit v="1".
const inventaire = async (sid) => (await (await fetch(`${BASE}/api/forum/me?sid=${sid}`)).json()).accessories;
const invLigne = async (sid, id) => (await inventaire(sid)).find((a) => Number(a.shopId) === Number(id));
const invXml = async (sid) => (await fetch(`${BASE}/ff/ls?sid=${sid}&uid=inv_accessories`)).text();

const PACK = 700900;
const CREATEUR = 'artiste' + RUN, ACHETEUR = 'client' + RUN, OFFERT = 'cadeau' + RUN;
const S = {};

test('un article signé d’un auteur va au rayon « Accessoires maison », juste après les accessoires', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  S.createur = await inscrire(CREATEUR);
  S.acheteur = await inscrire(ACHETEUR);
  S.offert = await inscrire(OFFERT);
  const r = await admin('POST', '/api/admin/shop', {
    id: PACK, name: 'Béret d’essai', category: 'Accessoires', price: 100, suffix9: '30a0t0j0o', auteur: CREATEUR,
  });
  assert.equal(r.status, 200, 'article créé');
  const d = await boutique(S.acheteur);
  const noms = d.categories.map((c) => c.name);
  assert.equal(noms[0], 'Accessoires');
  assert.equal(noms[1], 'Accessoires maison', 'le rayon maison vient juste après, pas en queue');
  const maison = rayon(d, 'Accessoires maison');
  const art = maison.items.find((it) => it.id === PACK);
  assert.ok(art, 'l’article est au rayon maison');
  assert.equal(art.auteur, CREATEUR, 'et signé');
  assert.equal(art.maison, true);
  assert.equal(art.kind, 'accessoire');
  assert.ok(!rayon(d, 'Accessoires').items.some((it) => it.id === PACK), 'plus au rayon d’époque');
  assert.ok(!d.items.some((it) => it.id === PACK), 'ni dans la vieille clef « items »');
  assert.equal(art.owned, false, 'un rayon qui commence par « Accessoir » reste payant');
  // L'arbre du bureau Flash range de même.
  const xml = await (await fetch(`${BASE}/ft/tree?sid=${S.acheteur}`)).text();
  const m = /<c n="Accessoires maison">([\s\S]*?)<\/c>/.exec(xml);
  assert.ok(m && m[1].includes(`i="${PACK}"`), 'le SWF a son rayon maison');
});

test('à l’achat, l’auteur touche dix pour cent', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  assert.equal((await admin('PATCH', `/api/admin/users/${ACHETEUR}`, { kikooz: 500 })).status, 200);
  const avant = (await boutique(S.createur)).kikooz;
  const a = await acheter(S.acheteur, PACK);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.kikooz, 400, 'l’acheteur paie le prix entier');
  assert.equal((await boutique(S.createur)).kikooz, avant + 10, 'et l’auteur reçoit sa part');
  const h = await historique(S.createur);
  assert.ok(h.some((e) => e.text === `10 kikooz obtenus par la vente de "Béret d’essai" à ${ACHETEUR}.`),
    'dans son historique, du côté des kikooz reçus : ' + JSON.stringify(h.map((e) => e.text)));
  // L'acheteur possède l'article : la boutique le dit acquis, et c'est son
  // INVENTAIRE qui porte la reprise — les deux clients, chacun dans sa langue.
  const art = rayon(await boutique(S.acheteur), 'Accessoires maison').items.find((it) => it.id === PACK);
  assert.equal(art.owned, true);
  assert.ok(!('revendable' in art), 'la boutique ne propose plus la revente : c’est l’inventaire qui la porte');
  const ligne = await invLigne(S.acheteur, PACK);
  assert.equal(ligne.revendable, true, 'dans l’inventaire du mobile');
  assert.match(await invXml(S.acheteur), new RegExp(`<e u="shop_${PACK}" t="bouille" s="10" d="0" a="0" v="1">`),
    'et dans celui du bureau');
});

test('revendre un accessoire acheté rend la moitié du prix payé, et l’exemplaire s’en va', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  const o = await offre(S.acheteur, PACK);
  assert.deepEqual({ ok: o.ok, prix: o.prix, achete: o.achete }, { ok: true, prix: 50, achete: true });
  // Il le porte : la tête se découvre à la revente.
  const base = (await boutique(S.acheteur)).bouille.substring(0, 15);
  assert.equal((await admin('PATCH', `/api/admin/users/${ACHETEUR}`, { fbouille: base + '30a0t0j0o' })).status, 200);
  const v = await vendre(S.acheteur, PACK);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.prix, 50);
  assert.equal(v.kikooz, 450);
  assert.ok(v.bouille && v.bouille.substring(15) !== '30a0t0j0o', 'plus sur la tête');
  const d = await boutique(S.acheteur);
  assert.equal(d.kikooz, 450);
  const art = rayon(d, 'Accessoires maison').items.find((it) => it.id === PACK);
  assert.equal(art.owned, false, 'l’article n’est plus possédé');
  assert.equal(await invLigne(S.acheteur, PACK), undefined, 'et il a quitté l’inventaire');
  assert.doesNotMatch(await invXml(S.acheteur), new RegExp(`u="shop_${PACK}"`), 'y compris pour le bureau');
  assert.ok((await historique(S.acheteur)).some((e) => e.text === '50 kikooz obtenus par la revente de "Béret d’essai".'));
  // On ne vend pas ce qu'on n'a plus.
  const encore = await vendre(S.acheteur, PACK);
  assert.equal(encore.ok, false);
  // La revente est inscrite : à la base, une ligne.
  const c = new Client({ connectionString: DB }); await c.connect();
  const { rows } = await c.query('SELECT username, pack_id, price FROM shop_sales');
  await c.end();
  assert.deepEqual(rows, [{ username: ACHETEUR, pack_id: PACK, price: 50 }]);
});

test('un accessoire offert se revend trente kikooz', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  const r = await (await admin('POST', `/api/admin/shop/${PACK}/push-all`)).json();
  assert.ok(r.ok, JSON.stringify(r));
  // Celui qui n'a jamais rien acheté : offert, trente.
  const o1 = await offre(S.offert, PACK);
  assert.deepEqual({ prix: o1.prix, achete: o1.achete }, { prix: 30, achete: false });
  const v1 = await vendre(S.offert, PACK);
  assert.equal(v1.ok, true);
  assert.equal(v1.prix, 30);
  // Celui qui avait acheté PUIS revendu : l'exemplaire en poche est le cadeau.
  const o2 = await offre(S.acheteur, PACK);
  assert.deepEqual({ prix: o2.prix, achete: o2.achete }, { prix: 30, achete: false },
    'un achat, une revente : ce qu’il tient vient de la poussée');
  // Rien ne se vend hors des accessoires : un pass, une option, un fond.
  const d = await boutique(S.acheteur);
  for (const nom of ['Pass', 'Packs', "Fonds d'écran", 'Feutres']) {
    const rub = rayon(d, nom);
    if (!rub) continue;
    const refus = await vendre(S.acheteur, rub.items[0].id);
    assert.equal(refus.ok, false, nom + ' : refusé');
  }
  // Un accessoire d'ÉPOQUE (celui de tout le monde, sans article derrière) n'a
  // pas de ligne d'inventaire à rendre : rien à revendre non plus.
  const xml = await invXml(S.acheteur);
  assert.match(xml, /<e u="bananocle" t="bouille" s="10" d="0" a="0">/, 'les accessoires d’époque restent nus');
});

test('l’auteur ne se paie pas lui-même, et un article sans auteur ne verse rien', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  assert.equal((await admin('PATCH', `/api/admin/users/${CREATEUR}`, { kikooz: 200 })).status, 200);
  // Il a reçu le béret par la poussée : il le rend, puis le rachète.
  const rendu = await vendre(S.createur, PACK);
  assert.equal(rendu.ok, true, JSON.stringify(rendu));
  const a = await acheter(S.createur, PACK);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.kikooz, 230 - 100, 'débité du prix, sans commission à lui-même');
  // Un article d'époque (sans auteur) : l'acheteur paie, personne ne touche.
  const r = await admin('POST', '/api/admin/shop', {
    id: 650001, name: 'Chapeau d’époque', category: 'Accessoires', price: 50, suffix9: '20a0t0j0o',
  });
  assert.equal(r.status, 200);
  const d = await boutique(S.acheteur);
  assert.ok(rayon(d, 'Accessoires').items.some((it) => it.id === 650001), 'sans auteur ni identifiant de variante : rayon d’époque');
  assert.ok(!rayon(d, 'Accessoires maison').items.some((it) => it.id === 650001));
});

test('remplacer le SVG d’une variante garde son index ; purger efface les retirées de la liste seulement', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  const trace = (n) => Array.from({ length: n }, (_, i) => ({ d: `M${i} 0h10v10h-10z`, fill: '#ff0000' }));
  const pub = await (await adminBrut('POST', '/api/admin/variantes', {
    nom: 'Plume d’essai', famille: 0, type: 3, coiffureRef: 8, base: 5, paths: trace(2), auteur: CREATEUR,
  })).json();
  assert.equal(pub.ok, true, JSON.stringify(pub));
  let liste = await (await admin('GET', '/api/admin/variantes')).json();
  let v = liste.find((x) => x.id === pub.id);
  assert.equal(v.auteur, CREATEUR, 'l’auteur suit la variante');
  assert.equal(v.nb, 2);
  // Le nouveau dessin : même identifiant, même index, plus de tracés.
  const rem = await (await adminBrut('PUT', `/api/admin/variantes/${pub.id}`, { paths: trace(7) })).json();
  assert.equal(rem.ok, true, JSON.stringify(rem));
  assert.equal(rem.index, pub.index, 'l’index ne bouge pas');
  assert.equal(rem.nb, 7);
  const publique = (await (await fetch(BASE + '/api/light/variantes')).json()).liste;
  assert.equal(publique.find((x) => x.index === pub.index).paths.length, 7, 'le site voit le nouveau dessin');
  // Retirée puis purgée : elle quitte la liste de l'admin…
  assert.equal((await admin('POST', `/api/admin/variantes/${pub.id}/purger`)).status, 400, 'on ne purge qu’une retirée');
  await admin('DELETE', `/api/admin/variantes/${pub.id}`);
  liste = await (await admin('GET', '/api/admin/variantes')).json();
  assert.equal(liste.find((x) => x.id === pub.id).retire, true);
  assert.equal((await admin('POST', `/api/admin/variantes/${pub.id}/purger`)).status, 200);
  liste = await (await admin('GET', '/api/admin/variantes')).json();
  assert.ok(!liste.some((x) => x.id === pub.id), 'purgée : plus dans la liste');
  // …mais sa place reste prise : le site l'injecte encore, vide.
  const apres = (await (await fetch(BASE + '/api/light/variantes')).json()).liste;
  const fantome = apres.find((x) => x.index === pub.index);
  assert.ok(fantome && fantome.retire && fantome.paths.length === 0, 'la place est gardée, vide');
  // Et une publication suivante prend l'index d'après, jamais le sien.
  const pub2 = await (await adminBrut('POST', '/api/admin/variantes', {
    nom: 'Plume bis', famille: 0, type: 3, coiffureRef: 8, base: 5, paths: trace(1),
  })).json();
  assert.equal(pub2.index, pub.index + 1);
  // L'accessoire maison (SVG posé) se remplace de même.
  const am = await (await adminBrut('POST', '/api/admin/acc-maison', { name: 'Aplat d’essai', price: 10, paths: trace(3) })).json();
  assert.equal(am.ok, true);
  const rem2 = await (await adminBrut('PUT', `/api/admin/acc-maison/${am.id}`, { paths: trace(4) })).json();
  assert.deepEqual({ ok: rem2.ok, nb: rem2.nb }, { ok: true, nb: 4 });
});

test('l’auteur se voit et se corrige partout : article, variante, accessoire maison', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  const trace = (n) => Array.from({ length: n }, (_, i) => ({ d: `M${i} 0h9v9h-9z`, fill: '#123456' }));
  // Une faute de frappe dans un pseudo, c'est une commission qui ne part
  // nulle part : les trois listes se corrigent.
  const art = await (await admin('GET', '/api/admin/shop')).json();
  assert.equal(art.find((p) => p.id === PACK).auteur, CREATEUR, 'l’article dit son auteur');
  assert.equal((await admin('PATCH', `/api/admin/shop/${PACK}`, { auteur: OFFERT })).status, 200);
  assert.equal((await (await admin('GET', '/api/admin/shop')).json()).find((p) => p.id === PACK).auteur, OFFERT);
  // Vide = plus d'auteur : l'article redevient « d'époque » et sort du rayon
  // maison… sauf qu'il garde son identifiant de variante, qui l'y range aussi.
  assert.equal((await admin('PATCH', `/api/admin/shop/${PACK}`, { auteur: '' })).status, 200);
  assert.equal((await (await admin('GET', '/api/admin/shop')).json()).find((p) => p.id === PACK).auteur, undefined);
  assert.equal((await admin('PATCH', `/api/admin/shop/${PACK}`, { auteur: CREATEUR })).status, 200);

  const am = await (await adminBrut('POST', '/api/admin/acc-maison',
    { name: 'Signé', price: 20, auteur: CREATEUR, paths: trace(2) })).json();
  const lignes = await (await admin('GET', '/api/admin/acc-maison')).json();
  assert.equal(lignes.find((a) => a.id === am.id).auteur, CREATEUR, 'l’accessoire maison aussi');
  assert.equal((await adminBrut('PUT', `/api/admin/acc-maison/${am.id}`, { auteur: OFFERT })).status, 200);
  assert.equal((await (await admin('GET', '/api/admin/acc-maison')).json()).find((a) => a.id === am.id).auteur, OFFERT,
    'et il se corrige sans toucher au dessin');
  assert.equal((await (await admin('GET', '/api/admin/acc-maison')).json()).find((a) => a.id === am.id).nb, 2,
    'le dessin est intact');
  // Le catalogue public le porte aussi (le sélecteur « porter un accessoire »).
  const pub = await (await fetch(BASE + '/api/light/acc-maison')).json();
  assert.equal(pub.liste.find((a) => a.id === am.id).auteur, OFFERT);
});

test('UN ARTICLE SUPPRIMÉ EMPORTE SES EXEMPLAIRES — plus d’orphelins', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  /* L'inventaire garde le NUMÉRO D'ARTICLE de chaque pièce. Supprimer l'article
     sans toucher aux inventaires laissait ces pièces orphelines : le joueur les
     voyait toujours — la liste se lit dans son inventaire, pas dans le
     catalogue — mais la revente comme la mise au rebut passent par l'article,
     introuvable, et refusaient de les prendre. Invendables, indéboulonnables. */
  const JETABLE = 700931;
  const sid = await inscrire('jetab' + RUN);
  assert.equal((await admin('POST', '/api/admin/shop', {
    id: JETABLE, name: 'À jeter', category: 'Accessoires', price: 10, suffix9: '9020t0b00',
    description: 'un article de passage',
  })).status, 200);
  assert.equal((await acheter(sid, JETABLE)).ok, true, 'acheté');
  assert.ok(await invLigne(sid, JETABLE), 'l’exemplaire est dans l’inventaire');

  const sup = await (await admin('DELETE', `/api/admin/shop/${JETABLE}`)).json();
  assert.equal(sup.ok, true);
  assert.equal(sup.exemplaires, 1, 'un exemplaire repris');
  assert.equal(sup.inventaires, 1, 'à un joueur');
  assert.equal(await invLigne(sid, JETABLE), undefined, 'et l’inventaire ne le porte plus');
});

test('LA RÉPARATION : les orphelins d’avant se recensent puis se purgent', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  /* Ceux-là ont été semés du temps où la suppression ne touchait pas aux
     inventaires. On les fabrique comme l'histoire les a faits — une ligne
     d'inventaire pointant un article qui n'existe plus — et on vérifie que
     l'outil les voit, puis les retire. */
  const sid = await inscrire('orph' + RUN);
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows } = await c.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', ['orph' + RUN]);
  const uid = rows[0].id;
  // Un ORPHELIN : son article n'existe nulle part au catalogue.
  await c.query(`INSERT INTO user_accessories (user_id, acc_id, shop_id, name, value)
                 VALUES ($1, 'shop_999777', 999777, 'Fantôme', '000000010000000000000000')`, [uid]);
  // Et un CADEAU : sans numéro d'article, il n'a jamais eu d'article à
  // retrouver — ce n'est pas un orphelin, il doit survivre à la purge.
  await c.query(`INSERT INTO user_accessories (user_id, acc_id, shop_id, name, value)
                 VALUES ($1, 'cadeau_test', NULL, 'Cadeau', '000000010000000000000000')`, [uid]);

  const avant = await (await admin('GET', '/api/admin/shop/orphelins')).json();
  assert.equal(avant.ok, true);
  assert.ok(avant.enBase >= 1, 'la base compte au moins l’orphelin : ' + avant.enBase);

  const purge = await (await admin('POST', '/api/admin/shop/orphelins/purger')).json();
  assert.equal(purge.ok, true);
  assert.ok(purge.enBase >= 1, 'la purge en a retiré : ' + purge.enBase);

  const apres = await (await admin('GET', '/api/admin/shop/orphelins')).json();
  assert.equal(apres.enBase, 0, 'plus aucun orphelin');

  const reste = await c.query('SELECT acc_id FROM user_accessories WHERE user_id = $1', [uid]);
  const gardes = reste.rows.map((r) => r.acc_id);
  await c.end();
  assert.ok(!gardes.includes('shop_999777'), 'le fantôme est parti');
  assert.ok(gardes.includes('cadeau_test'), 'LE CADEAU RESTE : il n’a pas d’article, il n’est pas orphelin');
  assert.ok(sid);
});

test('L’APERÇU SUIT LE DESSIN : un SVG remplacé ne resert pas l’ancien', () => {
  /* Le dessin d'un accessoire maison est mis en cache PAR IDENTIFIANT — et un
     accessoire dont on remplace le SVG garde le sien, c'est même tout
     l'intérêt (« même identifiant, ceux qui le portent voient le nouveau »).
     La table des vignettes servait donc l'ancien dessin, à la ligne du bon
     accessoire : on déposait un fichier et l'on revoyait le précédent. */
  const VIG = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
  const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(VIG, /function oublierCustom\(id\) \{/);
  assert.match(VIG, /oublierCustom: oublierCustom,/, 'et il est exposé');
  // Vider notre table ne suffit pas : le navigateur reservirait sa réponse.
  assert.match(VIG, /customFrais\[id\] = true;/);
  assert.match(VIG, /neuf \? \{ cache: 'no-store' \} : undefined/);
  // L'admin l'appelle aux trois gestes qui changent (ou retirent) un dessin.
  assert.match(ADMIN, /function oublierDessin\(id\) \{/);
  for (const f of ['creerAccMaison', 'remplacerAccMaison', 'supprimerAccMaison']) {
    const bloc = new RegExp('async function ' + f + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}').exec(ADMIN);
    assert.ok(bloc, f);
    assert.match(bloc[0], /oublierDessin\(/, f + ' doit oublier le dessin');
  }
  // L'aperçu de l'éditeur porte son NUMÉRO DE TOUR : une demande dépassée ne
  // peint plus par-dessus la neuve avec les réglages d'après.
  assert.match(ADMIN, /const tour = \+\+amTour;/);
  assert.match(ADMIN, /if \(tour !== amTour \|\| !canvas\.isConnected\) return;/);
  assert.match(ADMIN, /const teintes = \(couleurs \|\| amCouleurs\)\.slice\(\);/,
    'les couleurs sont saisies AU DÉPART, pas lues au retour');
});

test('ESSAYER UN ACCESSOIRE SUR LA BOUILLE D’UN FRUTIZ', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  // Six têtes en dur ne disent rien de ce que l'accessoire donne sur une vraie
  // coiffure — et la première portait le nom d'un joueur qui n'était pas le
  // sien. On va chercher la bouille du frutiz nommé.
  const pseudo = 'tete' + RUN;
  await inscrire(pseudo);
  const r = await admin('GET', '/api/admin/bouille/' + pseudo);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(typeof d.fbouille, 'string');
  assert.ok(d.fbouille.split('|')[0].length >= 24, 'une bouille entière : ' + d.fbouille);
  // La casse ne compte pas — on tape un pseudo à la main.
  assert.equal((await admin('GET', '/api/admin/bouille/' + pseudo.toUpperCase())).status, 200);
  // Un inconnu se dit, il ne casse pas ; et la route reste fermée sans la clé.
  assert.equal((await admin('GET', '/api/admin/bouille/personne' + RUN)).status, 404);
  assert.equal((await fetch(BASE + '/api/admin/bouille/' + pseudo)).status, 403);

  const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(ADMIN, /async function essayerSurFrutiz\(\) \{/);
  assert.match(ADMIN, /'\/api\/admin\/bouille\/' \+ encodeURIComponent\(pseudo\)/);
  // Les quinze premiers caractères font la base ; les neuf derniers, c'est
  // l'accessoire, que l'aperçu remplace. Et un accessoire maison suffixé
  // (« <état>|<id> ») ne doit pas polluer la base.
  assert.match(ADMIN, /String\(d\.fbouille \|\| ''\)\.split\('\|'\)\[0\]\.substring\(0, 15\)/);
  // L'étiquette ne prête plus le nom d'un joueur à un état écrit en dur.
  assert.match(ADMIN, /<option value="0004060h0407000">Tête témoin \(famille 0\)<\/option>/);
  assert.doesNotMatch(ADMIN, /Kasparov \(défaut\)/);
});

test('le double-clic, la popin et l’admin sont branchés dans les pages', () => {
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
  // ON REVEND DEPUIS SON INVENTAIRE, pas depuis la boutique : le double-clic
  // est sur la vignette de la grille, et sur la case de la fenêtre du bureau.
  assert.match(LIGHT, /if \(ac\.revendable\) \{[\s\S]{0,200}item\.addEventListener\("dblclick", function \(\) \{ revendreAccessoire\(ac\); \}\);/);
  assert.match(BUREAU, /faireDouble: e\.vendable \? function \(\) \{ revendreAccessoire\(e\.uid, nomDe\(e\), e\.desc\[1\]\); \} : null,/);
  assert.match(BUREAU, /if \(opts\.faireDouble\) d\.addEventListener\('dblclick', opts\.faireDouble\);/);
  assert.match(BUREAU, /vendable: n\.getAttribute\('v'\) === '1',/);
  // Et la boutique ne s'en mêle plus.
  assert.doesNotMatch(LIGHT, /proposerRevente/);
  assert.doesNotMatch(LIGHT, /bo-revente/);
  // La question, dans la popin d'époque, Oui à droite, Non à gauche.
  const p = /function revendreAccessoire\(ac\) \{[\s\S]*?\n  \}/.exec(LIGHT)[0];
  assert.match(p, /message: 'Voulez-vous vendre "' \+ xmlEscape\(nom\) \+ '" pour ' \+ \(Number\(o\.prix\) \|\| 0\) \+ ' kikooz \?',/);
  assert.match(p, /okLabel: "Oui",\s*\n\s*cancelLabel: "Non",/);
  assert.match(p, /"\/api\/light\/shop\/revente\?sid="/);
  assert.match(p, /fetch\("\/api\/light\/shop\/vendre", \{/);
  // Le premier clic du double-clic vient peut-être de POSER l'accessoire : on
  // se découvre aussi côté client, sans attendre que le serveur l'ait vu.
  assert.match(p, /if \(d\.bouille \|\| accSel\.suffix === ac\.suffix\) \{/);
  // La fiche de la boutique garde la phrase d'époque, et la signature.
  assert.match(LIGHT, /\(achetable \? 'Prix : ' \+ prix \+ ' kikooz' : 'Vous possédez déjà ce produit'\)/);
  assert.match(LIGHT, /'<div class="bo-auteur">Dessiné par ' \+ xmlEscape\(it\.auteur\) \+ '<\/div>'/);
  // L'admin : l'auteur d'un article et d'une variante, le remplacement, la purge.
  assert.match(ADMIN, /<input id="pack-auteur"/);
  assert.match(ADMIN, /auteur: \$\('#pack-auteur'\)\.value\.trim\(\),/);
  assert.match(ADMIN, /<input id="va-auteur"/);
  assert.match(ADMIN, /function variantEnBoutique\(id, type, index, nom, auteur\) \{/);
  assert.match(ADMIN, /\$\('#pack-auteur'\)\.value = auteur \|\| '';/);
  assert.match(ADMIN, /async function remplacerVariante\(id\) \{/);
  assert.match(ADMIN, /async function remplacerAccMaison\(id\) \{/);
  assert.match(ADMIN, /async function purgerVariantesRetirees\(\) \{/);
  // L'auteur : une colonne dans les TROIS listes, et le crayon qui la corrige.
  assert.match(ADMIN, /<th>Catégorie<\/th><th>Auteur<\/th>/);
  assert.match(ADMIN, /<th>Nom<\/th><th>Auteur<\/th><th>Prix<\/th><th>Aplats<\/th>/);
  assert.match(ADMIN, /function auteurCell\(auteur, appel\) \{/);
  assert.match(ADMIN, /auteurCell\(p\.auteur, `changerAuteurPack\(\$\{p\.id\}\)`\)/);
  assert.match(ADMIN, /auteurCell\(v\.auteur, 'changerAuteurVariante/);
  assert.match(ADMIN, /auteurCell\(a\.auteur, 'changerAuteurAccMaison/);
  assert.match(ADMIN, /<input id="am-auteur"/);
  assert.match(ADMIN, /auteur: \(\$\('#am-auteur'\)\.value \|\| ''\)\.trim\(\)/);
  assert.match(ADMIN, /method: 'PUT', headers: h,\s*\n\s*body: new Blob\(\[JSON\.stringify\(\{ paths \}\)\]/);
});
