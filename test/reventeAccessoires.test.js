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
  // L'acheteur possède l'article : la boutique le dit revendable.
  const art = rayon(await boutique(S.acheteur), 'Accessoires maison').items.find((it) => it.id === PACK);
  assert.equal(art.owned, true);
  assert.equal(art.revendable, true);
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
  assert.ok(!art.revendable);
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
    for (const it of rub.items) assert.ok(!it.revendable, `${it.name} ne se revend pas`);
    const refus = await vendre(S.acheteur, rub.items[0].id);
    assert.equal(refus.ok, false, nom + ' : refusé');
  }
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

test('le double-clic, la popin et l’admin sont branchés dans les pages', () => {
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  // Le double-clic sur l'article possédé, dans l'arbre et sur l'aperçu.
  assert.match(LIGHT, /if \(art && art\.revendable\) b\.addEventListener\("dblclick", function \(\) \{ proposerRevente\(art\); \}\);/);
  assert.match(LIGHT, /var vue = it\.revendable && box\.querySelector\("\.bo-vue \.cadre"\);\s*\n\s*if \(vue\) vue\.addEventListener\("dblclick", function \(\) \{ proposerRevente\(it\); \}\);/);
  // La question, dans la popin d'époque, Oui à droite, Non à gauche.
  const p = /function proposerRevente\(it\) \{[\s\S]*?\n  \}/.exec(LIGHT)[0];
  assert.match(p, /message: 'Voulez-vous vendre "' \+ xmlEscape\(it\.name\) \+ '" pour ' \+ \(Number\(o\.prix\) \|\| 0\) \+ ' kikooz \?',/);
  assert.match(p, /okLabel: "Oui",\s*\n\s*cancelLabel: "Non",/);
  assert.match(p, /"\/api\/light\/shop\/revente\?sid="/);
  assert.match(p, /fetch\("\/api\/light\/shop\/vendre", \{/);
  // La fiche garde la phrase d'époque, et dit le geste en dessous.
  assert.match(LIGHT, /\(achetable \? 'Prix : ' \+ prix \+ ' kikooz' : 'Vous possédez déjà ce produit'\)/);
  assert.match(LIGHT, /Double-clic sur l’article pour le revendre à la boutique\./);
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
  assert.match(ADMIN, /method: 'PUT', headers: h,\s*\n\s*body: new Blob\(\[JSON\.stringify\(\{ paths \}\)\]/);
});
