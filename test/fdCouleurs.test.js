'use strict';
/*
 * LES FD : UN DISQUE PAR JEU, ET UNE COULEUR QUI DIT CE QU'IL EST.
 *
 * « Faisons du ménage dans les Frutidiscs. Certains sont en doublon +
 * rationalisons les couleurs de FDs. »
 *
 * La règle (server.js, « LES COULEURS DES FD ») :
 *
 *   noir  (0) le disque d'époque d'un jeu ;
 *   rouge (3) le disque ajouté pour un portage HTML (gameId `light/…`) ;
 *   gris  (1) MotionBall seul, que son SWF lit comme le disque complet.
 *
 * Et le doublon : un jeu porté a deux disques, l'époque et le portage. Sur le
 * bureau Flash, ce sont deux moteurs ; sur le bureau HTML et le téléphone,
 * les deux ouvrent le même portage — on n'y montre que le rouge.
 *
 * Avant ce ménage, le disque de portage de Burning Kiwi était NOIR : même
 * anneau, même jaquette que bkiwi1, deux disques indiscernables partout.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');

// Le catalogue, lu dans le source : { id → { discType, swfName, gameId } }.
function catalogue() {
  const i = SERVEUR.indexOf('const GAME_DISCS = {');
  const bloc = SERVEUR.slice(i, SERVEUR.indexOf('\n};', i));
  const out = {};
  const re = /^ {2}([a-zA-Z0-9_]+): \{([\s\S]*?)^ {2}\},/gm;
  let m;
  while ((m = re.exec(bloc))) {
    const champ = (nom) => ((new RegExp(nom + ": '([^']*)'")).exec(m[2]) || [])[1];
    out[m[1]] = { discType: champ('discType'), swfName: champ('swfName'), gameId: champ('gameId'),
      iconName: champ('iconName') };
  }
  return out;
}
const estPortage = (d) => String(d.gameId || '').startsWith('light/');

test('la règle des couleurs vaut pour chaque disque du catalogue', () => {
  const cat = catalogue();
  assert.ok(Object.keys(cat).length >= 15, 'le catalogue est lu');
  for (const [id, d] of Object.entries(cat)) {
    const attendu = estPortage(d) ? '3' : (id === 'mb2' ? '1' : '0');
    assert.equal(d.discType, attendu, `${id} : anneau ${d.discType}, la règle dit ${attendu}`);
    // L'anneau existe : fileIcon.swf n'en a que cinq.
    assert.ok(fs.existsSync(path.join(ROOT, 'public/frutiz/sprites/disc_anneau_' + d.discType + '.svg')),
      `${id} : pas d'anneau ${d.discType} dans les sprites d'époque`);
  }
});

test('Burning Kiwi : ses deux disques ne se ressemblent plus', () => {
  const cat = catalogue();
  assert.equal(cat.bkiwi1.discType, '0', 'le disque d\'époque reste noir (le SWF le lit)');
  assert.equal(cat.bkiwilight.discType, '3', 'le disque du portage passe au rouge');
});

test('un jeu porté a exactement un disque d\'époque et un disque de portage', () => {
  const cat = catalogue();
  const parJeu = {};
  for (const [id, d] of Object.entries(cat)) (parJeu[d.swfName] = parJeu[d.swfName] || []).push(id);
  for (const [jeu, ids] of Object.entries(parJeu)) {
    const portages = ids.filter((id) => estPortage(cat[id]));
    assert.ok(portages.length <= 1, `${jeu} : ${portages.length} disques de portage`);
    assert.ok(ids.length - portages.length <= 1, `${jeu} : plusieurs disques d'époque (${ids.join(', ')})`);
  }
});

test('la feuille du téléphone montre le disque que montre le bureau HTML', () => {
  const cat = catalogue();
  const portes = new Set(Object.values(cat).filter(estPortage).map((d) => d.swfName));
  // Les entrées à jaquette de la feuille, et le jeu qu'elles ouvrent.
  const tabVersJeu = { snake3: 'snake3', kaluga: 'kaluga', mb2: 'mb2', bkiwi: 'bkiwi', jamajama: 'jamajama' };
  const i = LIGHT.indexOf('var DISCS = [');
  const bloc = LIGHT.slice(i, LIGHT.indexOf('\n  ];', i));
  const entrees = bloc.match(/\{ tab: "[^"]+", jaquette: "[^"]+"[^}]*\}/g) || [];
  assert.equal(entrees.length, 5, 'cinq disques à jaquette sur la feuille');
  for (const e of entrees) {
    const tab = /tab: "([^"]+)"/.exec(e)[1];
    const anneau = (/anneau: "(\d)"/.exec(e) || [])[1] || '0';
    const attendu = portes.has(tabVersJeu[tab]) ? '3' : '0';
    assert.equal(anneau, attendu, `${tab} : anneau ${anneau} sur la feuille, ${attendu} au bureau`);
  }
  // Et la feuille l'applique bien.
  assert.match(LIGHT, /disc_anneau_' \+ \(d\.anneau \|\| "0"\) \+ '\.svg/);
});

test('le bureau HTML écarte le disque d\'époque d\'un jeu porté', () => {
  assert.match(BUREAU, /portage: n\.getAttribute\('l'\) \|\| '',/);
  assert.match(BUREAU, /if \(uid === 'disccollector' && x\.portage\) return false;/);
});

// ── Ce que le serveur sert ───────────────────────────────────────────────

const PORT = 3793;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5861', FRUTISCORE_PORT: '5862',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

test('« Mes disques » marque chaque disque d\'époque de son disque de portage', async () => {
  const creds = { username: 'fdc' + RUN, password: 'secret123' };
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body: JSON.stringify(creds) });
  const sid = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body: JSON.stringify(creds) })).json()).sid;
  assert.ok(sid, 'connexion');
  const xml = await (await fetch(`${BASE}/ff/ls?uid=disccollector&sid=${sid}`)).text();
  const noeuds = {};
  for (const m of xml.matchAll(/<e u="([^"]+)"([^>]*)>([^<]*)<\/e>/g)) {
    noeuds[m[1]] = { l: (/ l="([^"]*)"/.exec(m[2]) || [])[1] || null, type: m[3].split('\n')[0] };
  }
  const attendu = { kaluga1: 'kalugalight', snake3: 'snake3light', mb2: 'mb2light', bkiwi1: 'bkiwilight',
    miniwave1: 'miniwavelight', minipixiz1: 'minipixizlight' };
  for (const [id, n] of Object.entries(noeuds)) {
    assert.equal(n.l, attendu[id] || null, `${id} : remplaçant ${n.l}`);
  }
  // Ce qui reste au bureau HTML : un disque par jeu, onze en tout — la même
  // liste que la feuille du téléphone.
  const restants = Object.keys(noeuds).filter((id) => !noeuds[id].l);
  assert.equal(restants.length, 11, `un disque par jeu (${restants.join(', ')})`);
  assert.equal(noeuds.bkiwilight.type, '3', 'Burning Kiwi light, rouge sur le fil aussi');
});
