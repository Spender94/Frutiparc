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

test('la rubrique Packs ne contient que le tableau de bord de Frutisnake, à 300 kikooz', async () => {
  const liste = await packs();
  assert.ok(Array.isArray(liste), 'catalogue lisible');
  const rubrique = liste.filter((p) => String(p.category || '').toLowerCase() === 'packs');
  assert.equal(rubrique.length, 1, 'un seul produit dans la rubrique Packs');
  const p = rubrique[0];
  assert.equal(p.name, 'Pack de Frutisnake');
  assert.equal(p.price, 300);
  assert.equal(p.gameFeature, 'snake3Hud', 'le produit accorde bien l\'option');
  assert.equal(p.notDefault, true,
    'sans notDefault la rubrique Packs est réputée offerte : le produit serait invendable');

  // Les huit anciens packs de jeux complets ont disparu du catalogue.
  for (const id of [10, 11, 12, 13, 14, 15, 16, 17]) {
    assert.ok(!liste.some((x) => x.id === id), `ancien pack #${id} retiré`);
  }
});

test('le produit est bien EN VENTE : un joueur sans kikooz est refusé faute d\'argent', async () => {
  const sid = await sidFor('packsnake1');
  const liste = await packs();
  const id = liste.find((p) => p.gameFeature === 'snake3Hud').id;
  const r = await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, id }),
  });
  const j = await r.json();
  // code 3 = kikooz insuffisants. Surtout PAS 2 (« déjà possédé ») : ce serait le
  // signe que la rubrique est encore traitée comme offerte par défaut.
  assert.equal(j.ok, false);
  assert.equal(j.code, 3, `attendu « kikooz insuffisants », reçu ${JSON.stringify(j)}`);
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
