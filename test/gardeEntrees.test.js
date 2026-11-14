'use strict';
/*
 * LA GARDE DES ENTRÉES (public/js/garde-entrees.js) — MiniPixiz et Mini-Fever.
 *
 * « Retirer l'état du jeu de la page ; signaler ou refuser les touches
 * simulées. » Un script qui lit `window.__client` ou qui « appuie » par
 * `dispatchEvent` ne joue plus, et l'admin le sait.
 *
 *   1. le module, seul ;
 *   2. le câblage des deux jeux et de la route (lecture des sources) ;
 *   3. dans un vrai navigateur, sur un nom d'hôte qui n'est PAS local (le
 *      site, donc) : l'état a disparu, le piège et la touche simulée lèvent
 *      chacun leur alerte, et une vraie touche joue toujours.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('le module : un événement qui se dit simulé est refusé et compté', () => {
  const G = require(path.join(ROOT, 'public/js/garde-entrees.js'));
  const avant = G.bilan().refuses;
  assert.equal(G.vraie({ type: 'keydown', isTrusted: true }), true);
  assert.equal(G.vraie({ type: 'keydown' }), true, 'un simple objet (les bacs à sable des tests) passe');
  assert.equal(G.vraie({ type: 'keydown', isTrusted: false }), false);
  assert.equal(G.vraie({ type: 'pointerdown', isTrusted: false }), false);
  const b = G.bilan();
  assert.equal(b.refuses, avant + 2);
  assert.ok(b.types.keydown >= 1 && b.types.pointerdown >= 1);
  assert.ok(Object.isFrozen(G), 'la garde ne se remplace pas');
});

test('le câblage : la garde est chargée avant le jeu, et tient ses écouteurs', () => {
  const pixiz = lire('public/minipixiz/index.html');
  const fever = lire('public/minifever/index.html');
  for (const [page, moteur] of [[pixiz, '/minipixiz/engine.js'], [fever, '/minifever/engine.js']]) {
    const g = page.indexOf('<script src="/js/garde-entrees.js"></script>');
    assert.ok(g > 0 && g < page.indexOf(`<script src="${moteur}"></script>`), 'avant le moteur');
  }
  assert.match(pixiz, /GardeEntrees\.surveiller\(\{ jeu: 'minipixiz', sid: sid \}\)/);
  assert.match(fever, /GardeEntrees\.surveiller\(\{ jeu: 'minifever', sid \}\)/);
  // L'état du jeu : plus rien sur `window` hors du local.
  assert.match(pixiz, /if \(!EN_LOCAL\) window\.GardeEntrees\.piege\(\['__client', 'minipixizClient'/);
  const hors = pixiz.replace(/if \(EN_LOCAL\) \{[\s\S]*?\n      \}/, '').replace(/if \(EN_LOCAL\) window\.__\w+ = [^\n]*/g, '');
  assert.ok(!/window\.(__\w+|minipixizClient) = /.test(hors), 'aucune pose hors de EN_LOCAL');
  // Les écouteurs de jeu.
  const jeu = lire('public/minipixiz/game.js');
  assert.match(jeu, /addEventListener\('keydown', \(ev\) => \{\s*if \(!Garde\.vraie\(ev\)\) return;/);
  assert.equal((jeu.match(/addEventListener\('keyup', \(ev\) => \{\s*if \(!Garde\.vraie\(ev\)\) return;/g) || []).length, 2);
  assert.match(jeu, /const on = \(ev\) => \{ if \(!Garde\.vraie\(ev\)\) return;/);
  assert.match(jeu, /canvas\.addEventListener\('touchstart', \(ev\) => \{\s*if \(!Garde\.vraie\(ev\)\) return;/);
  const cf = lire('public/minifever/client.js');
  assert.match(cf, /const bouger = \(ev\) => \{ if \(Garde\.vraie\(ev\)\) deplacer\(ev\); \};/);
  assert.match(cf, /const bas = \(ev\) => \{\s*if \(!Garde\.vraie\(ev\)\) return;/);
  assert.match(lire('server.js'), /app\.post\('\/api\/antitriche\/entrees'/);
});

function chromium() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p).chromium; } catch { /* suivant */ }
  }
  return null;
}

test('dans Chromium, sur le site : état caché, piège et touche simulée signalés, vraie touche jouée', async (t) => {
  const pw = chromium();
  if (!pw) { t.skip('Playwright absent'); return; }
  const { spawn } = require('node:child_process');
  const PORT = 5621, CLE = 'cle-garde';
  const BASE = `http://127.0.0.1:${PORT}`;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5622', FRUTISCORE_PORT: '5623',
    }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let navigateur = null;
  const pseudo = 'garde' + Date.now().toString(36).slice(-5);
  try {
    let pret = false;
    for (let i = 0; i < 120 && !pret; i++) {
      try { pret = (await fetch(BASE + '/minipixiz/index.html')).ok; } catch { /* pas encore */ }
      if (!pret) await new Promise((r) => setTimeout(r, 100));
    }
    if (!pret) { t.skip('le serveur ne répond pas'); return; }
    const h = { 'Content-Type': 'application/json' };
    const corps = JSON.stringify({ username: pseudo, password: 'secret123' });
    await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body: corps });
    const sid = (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body: corps })).json()).sid;
    assert.ok(sid);
    // « jeu.test » : le même serveur, sous un nom qui n'est pas local.
    try { navigateur = await pw.launch({ args: ['--host-resolver-rules=MAP jeu.test 127.0.0.1'] }); }
    catch (e) { t.skip('Chromium absent : ' + e.message); return; }
    const alertes = async (type) => (await (await fetch(`${BASE}/api/admin/triche/alertes?username=${pseudo}&type=${type}`,
      { headers: { 'x-admin-key': CLE } })).json()).alertes || [];
    const attendre = async (type) => {
      for (let i = 0; i < 60; i++) { const a = await alertes(type); if (a.length) return a; await new Promise((r) => setTimeout(r, 100)); }
      return [];
    };

    // ── MiniPixiz, comme sur le site ──
    const p = await navigateur.newPage({ viewport: { width: 760, height: 760 } });
    await p.goto(`http://jeu.test:${PORT}/minipixiz/index.html?sid=${sid}`);
    await p.waitForFunction(() => { const c = document.querySelector('#chargement'); return !c || getComputedStyle(c).display === 'none' || !c.offsetParent; }, null, { timeout: 20000 });
    const vu = await p.evaluate(() => ({
      enumerables: Object.keys(window).filter((k) => /^__|minipixizClient/.test(k)),
      avant: window.GardeEntrees.bilan(),
    }));
    assert.deepEqual(vu.enumerables, [], 'rien du jeu sur window');
    assert.deepEqual(vu.avant, { refuses: 0, types: {}, sondes: {} }, 'parcourir window ne déclenche rien');
    assert.equal(await p.evaluate(() => window.__client), undefined, 'l’état n’est plus là');
    assert.equal(await p.evaluate(() => typeof window.__entrerEnForet), 'undefined');
    const sonde = await attendre('sonde_etat');
    assert.equal(sonde.length, 1, 'la lecture du piège est signalée');
    assert.equal(sonde[0].jeu, 'minipixiz');
    assert.match(sonde[0].resume, /__client/);
    // Une touche fabriquée par un script : refusée, signalée.
    await p.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', keyCode: 37, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', keyCode: 37, bubbles: true }));
    });
    assert.deepEqual((await p.evaluate(() => window.GardeEntrees.bilan())).types, { keydown: 1, keyup: 1 });
    // Une vraie touche ne compte pas.
    await p.keyboard.press('ArrowLeft');
    assert.equal((await p.evaluate(() => window.GardeEntrees.bilan())).refuses, 2);
    // Le joueur quitte la page avant la demi-minute : le compte part quand même.
    await p.goto('about:blank');
    await p.close();

    // ── En local (les vérifications automatisées) : l'état est là, et l'on
    //    VOIT la différence entre la touche simulée et la vraie.
    const q = await navigateur.newPage({ viewport: { width: 760, height: 760 } });
    await q.goto(`${BASE}/minipixiz/index.html`);
    await q.waitForFunction(() => window.__client && window.__client.entree);
    await q.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', keyCode: 37, bubbles: true })));
    assert.notEqual(await q.evaluate(() => window.__client.entree.gauche), true, 'la touche simulée ne joue pas');
    await q.keyboard.down('ArrowLeft');
    assert.equal(await q.evaluate(() => window.__client.entree.gauche), true, 'la vraie, si');
    await q.keyboard.up('ArrowLeft');
    assert.notEqual(await q.evaluate(() => window.__client.entree.gauche), true);
    await q.close();

    // ── Mini-Fever : un appui fabriqué sur la scène.
    const f = await navigateur.newPage({ viewport: { width: 600, height: 700 } });
    await f.goto(`http://jeu.test:${PORT}/minifever/index.html?sid=${sid}`);
    await f.waitForFunction(() => window.GardeEntrees && document.querySelector('#etat') && !/chargement/.test(document.querySelector('#etat').textContent), null, { timeout: 20000 });
    await f.evaluate(() => {
      const c = document.querySelector('#stage');
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true, pointerType: 'mouse' }));
    });
    assert.equal((await f.evaluate(() => window.GardeEntrees.bilan())).types.pointerdown, 1);
    await f.mouse.click(120, 120);
    assert.equal((await f.evaluate(() => window.GardeEntrees.bilan())).refuses, 1, 'un vrai clic ne compte pas');
    await f.goto('about:blank');
    await f.close();

    let sim = [];
    for (let i = 0; i < 60 && sim.length < 2; i++) { sim = await alertes('entrees_simulees'); if (sim.length < 2) await new Promise((r) => setTimeout(r, 100)); }
    assert.deepEqual(sim.map((a) => a.jeu).sort(), ['minifever', 'minipixiz'], 'une alerte par jeu');
    assert.match(sim.find((a) => a.jeu === 'minipixiz').resume, /keydown/);
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
    proc.kill('SIGKILL');
    try {
      const fichier = path.join(ROOT, 'data/scores.json');
      const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
      if (d.users && d.users[pseudo]) { delete d.users[pseudo]; fs.writeFileSync(fichier, JSON.stringify(d)); }
    } catch { /* rien à nettoyer */ }
  }
});
