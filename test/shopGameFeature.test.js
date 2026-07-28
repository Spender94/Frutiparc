// Rubrique « Packs » de la boutique : les OPTIONS DE JEU.
//
// La rubrique vendait à l'origine les jeux complets — offerts à tout le monde
// sur ce serveur, donc sans intérêt. Elle sert désormais à vendre des options de
// confort par jeu ; la première est le tableau de bord de Frutisnake (longueur,
// dynamites, durée du bonus), à 300 kikooz.
//
// Ce que ces tests verrouillent :
//   - la rubrique ne contient QUE ce produit, au bon prix, et il est ACHETABLE
//     (sans `notDefault`, la rubrique Packs est réputée déjà possédée et l'achat
//     serait refusé sans autre signe) ;
//   - les huit anciens packs de jeux ne peuvent pas ressusciter depuis la base ;
//   - l'option accordée ouvre bien le tableau de bord, et son retrait le referme.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3429;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5110', FRUTISCORE_PORT: '5111',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (serverProc) serverProc.kill('SIGKILL'); });

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const packs = async () => (await (await fetch(BASE + '/api/admin/shop?key=' + CLE)).json());
const options = async (sid) => (await (await fetch(BASE + '/api/features?sid=' + sid)).json()).features;

// Les produits attendus dans la rubrique, et rien d'autre.
const ATTENDUS = [
  { nom: 'Pack de Frutisnake', option: 'snake3Hud', prix: 300, picto: 'pack,12' },
  { nom: 'Pack de Swapou', option: 'swapouMoves', prix: 300, picto: 'pack,14' },
];

test('la rubrique Packs contient les options de jeu, à 300 kikooz, et rien d\'autre', async () => {
  const liste = await packs();
  assert.ok(Array.isArray(liste), 'catalogue lisible');
  const rubrique = liste.filter((p) => String(p.category || '').toLowerCase() === 'packs');
  assert.equal(rubrique.length, ATTENDUS.length,
    `${rubrique.length} produits dans la rubrique Packs : ${rubrique.map((p) => p.name).join(', ')}`);
  for (const attendu of ATTENDUS) {
    const p = rubrique.find((x) => x.gameFeature === attendu.option);
    assert.ok(p, `produit accordant ${attendu.option} présent`);
    assert.equal(p.name, attendu.nom);
    assert.equal(p.price, attendu.prix);
    assert.equal(p.notDefault, true,
      'sans notDefault la rubrique Packs est réputée offerte : le produit serait invendable');
    // Le picto désigne une image du porte-vignettes de shopitem.swf : 12 pour
    // Frutisnake, 14 pour Swapou 2 (étiquettes d'images relevées dans le SWF).
    assert.equal(p.picto, attendu.picto, `vignette du jeu (${attendu.picto})`);
  }
  // Deux produits ne doivent pas partager un identifiant de boutique.
  const ids = rubrique.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `identifiants en double : ${ids.join(', ')}`);

  // Les huit anciens packs de jeux complets ont disparu du catalogue.
  for (const id of [10, 11, 12, 13, 14, 15, 16, 17]) {
    assert.ok(!liste.some((x) => x.id === id), `ancien pack #${id} retiré`);
  }
});

test('les produits sont bien EN VENTE : un joueur sans kikooz est refusé faute d\'argent', async () => {
  const liste = await packs();
  for (const attendu of ATTENDUS) {
    const sid = await sidFor('sanssou' + attendu.option.toLowerCase());
    const id = liste.find((p) => p.gameFeature === attendu.option).id;
    const r = await fetch(BASE + '/api/light/shop/buy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid, id }),
    });
    const j = await r.json();
    // code 3 = kikooz insuffisants. Surtout PAS 2 (« déjà possédé ») : ce serait le
    // signe que la rubrique est encore traitée comme offerte par défaut.
    assert.equal(j.ok, false);
    assert.equal(j.code, 3, `${attendu.nom} : attendu « kikooz insuffisants », reçu ${JSON.stringify(j)}`);
  }
});

test('l\'option accordée ouvre le tableau de bord, son retrait le referme', async () => {
  const sid = await sidFor('packsnake2');
  assert.equal((await options(sid)).snake3Hud, false, 'au départ : pas d\'option');

  const donne = await fetch(BASE + '/api/admin/users/packsnake2/game-feature', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ feature: 'snake3Hud', owned: true }),
  });
  assert.equal(donne.status, 200, 'octroi admin accepté');
  assert.equal((await options(sid)).snake3Hud, true, 'option accordée → tableau de bord ouvert');

  await fetch(BASE + '/api/admin/users/packsnake2/game-feature', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ feature: 'snake3Hud', owned: false }),
  });
  assert.equal((await options(sid)).snake3Hud, false, 'option retirée → tableau de bord refermé');
});

test('une option inconnue est refusée', async () => {
  const r = await fetch(BASE + '/api/admin/users/packsnake2/game-feature', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ feature: 'nimporteQuoi', owned: true }),
  });
  assert.equal(r.status, 400);
});
