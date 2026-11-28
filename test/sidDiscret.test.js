'use strict';
/*
 * LE SID NE RESTE PAS DANS L'ADRESSE DES FENÊTRES DU LIGHT (sid-discret.js).
 *
 * Forum, historique d'un salon, jeux portés : la page range le sid de son
 * adresse pour l'onglet, l'efface de la barre d'adresse et le lit dans
 * `FPSid.sid` ; au F5, elle le reprend de l'onglet. Les jeux Flash
 * (game-popup.html, /legacy) n'en sont pas : leurs scores se reconnaissent à
 * l'adresse de leur fenêtre.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const SCRIPT = fs.readFileSync(path.join(PUBLIC, 'js', 'sid-discret.js'), 'utf8');
const SID = 'c'.repeat(32);

function stockage(bloque) {
  const m = new Map();
  return {
    m,
    getItem: (k) => { if (bloque) throw new Error('bloqué'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (bloque) throw new Error('bloqué'); m.set(k, String(v)); },
  };
}
function charger(adresse, ss) {
  const u = new URL(adresse, 'https://frutiparc.test');
  const remplacements = [];
  const ctx = {
    URLSearchParams, sessionStorage: ss,
    location: { search: u.search, pathname: u.pathname, hash: u.hash },
    history: { state: null, replaceState: (s, t, url) => remplacements.push(url) },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  return { sid: ctx.FPSid.sid, remplacements };
}

test('arrivée : sid lu, rangé pour l\'onglet, effacé de l\'adresse (le reste demeure)', () => {
  const ss = stockage();
  const r = charger('/snake3/?sid=' + SID + '&from=light#x', ss);
  assert.strictEqual(r.sid, SID);
  assert.deepStrictEqual(r.remplacements, ['/snake3/?from=light#x']);
  assert.strictEqual(ss.m.get('fp_sid_page:/snake3/'), SID);
});

test('F5 : plus de sid dans l\'adresse, on reprend celui de l\'onglet', () => {
  const ss = stockage();
  charger('/fb/?sid=' + SID, ss);
  const r = charger('/fb/', ss);
  assert.strictEqual(r.sid, SID);
  assert.deepStrictEqual(r.remplacements, []);
});

test('une clé par page : le sid du forum ne sert pas à un jeu ouvert sans sid', () => {
  const ss = stockage();
  charger('/fb/?sid=' + SID, ss);
  assert.strictEqual(charger('/kaluga/', ss).sid, '');
});

test('stockage bloqué : l\'adresse reste, la page lit quand même son sid', () => {
  const r = charger('/kaluga/?sid=' + SID, stockage(true));
  assert.strictEqual(r.sid, SID);
  assert.deepStrictEqual(r.remplacements, []);
});

const PAGES = ['fb', 'grapiz', 'bandas', 'swapou', 'miniwave', 'minipixiz', 'snake3', 'kaluga', 'mb2',
  'minifever', 'jamajama', 'bkiwi'];

test('chaque page le charge dans <head>, AVANT tout autre script', () => {
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(PUBLIC, p, 'index.html'), 'utf8');
    const i = html.indexOf('<script src="/js/sid-discret.js"></script>');
    assert.ok(i > 0 && i < html.indexOf('</head>'), p + ' : dans <head>');
    assert.strictEqual(html.indexOf('<script'), i, p + ' : premier script de la page');
  }
});

test('chaque lecture du sid passe d\'abord par FPSid', () => {
  const fichiers = ['fb/index.html', 'grapiz/index.html', 'bandas/ui.js', 'swapou/index.html',
    'miniwave/index.html', 'minipixiz/index.html', 'snake3/game.js', 'kaluga/index.html', 'mb2/index.html',
    'minifever/index.html', 'jamajama/jeu.js', 'bkiwi/index.html', 'js/fd-badge.js', 'js/eject-watch.js'];
  for (const f of fichiers) {
    const src = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    const lectures = src.match(/[^\n]*\.get\(['"]sid['"]\)[^\n]*/g) || [];
    assert.ok(lectures.length > 0, f + ' lit un sid');
    for (const l of lectures) assert.match(l, /\(window\.FPSid && FPSid\.sid\) \|\| /, f + ' : ' + l.trim());
  }
  // Le retour « ‹ Salons » du forum reprend SID, pas l'adresse (effacée).
  assert.match(fs.readFileSync(path.join(PUBLIC, 'fb', 'index.html'), 'utf8'), /var sid = SID;\s*window\.location\.href = '\/light'/);
});

test('les fenêtres Flash gardent leur sid (scores reconnus par l\'adresse)', () => {
  for (const f of ['game-popup.html', 'ruffle.html']) {
    assert.ok(!fs.readFileSync(path.join(PUBLIC, f), 'utf8').includes('sid-discret.js'), f);
  }
});

test('historique d\'un salon : le script, et la reprise après F5', () => {
  const S = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  // (le titre se dit dans la langue de la page : sa clé, et son français)
  assert.match(S, /<title>\$\{esc\(t\(lang, 'chat\.logs\.titre', 'Salon \{salon\} — messages précédents', \{ salon: g \}\)\)\}<\/title>/);
  assert.match(S, /<script src="\/js\/sid-discret\.js"><\/script>\n<title>\$\{esc\(t\(lang, 'chat\.logs\.titre'/);
  assert.match(S, /if \(!demandeur && !req\.query\.sid\) \{[\s\S]{0,400}sessionStorage\.getItem\("fp_sid_page:"\+location\.pathname\)/);
});

test('Snake 2 VK (compilé depuis Frutiback) : même règle, dans sa page', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'snake2vk', 'index.html'), 'utf8');
  const i = html.indexOf("var cle = 'fp_sid_page:' + location.pathname");
  assert.ok(i > 0 && i < html.indexOf('<script type="module"'), 'relevé avant le jeu');
  assert.match(html, /history\.replaceState\(history\.state, '', location\.pathname/);
  assert.match(html, /if \(window\.FPSid\.sid\) \{\s*document\.documentElement\.classList\.add\('embed'\)/);
  const m = html.match(/src="\/snake2vk\/assets\/(index-[^"]+\.js)"/);
  const jeu = fs.readFileSync(path.join(PUBLIC, 'snake2vk', 'assets', m[1]), 'utf8');
  assert.ok(jeu.includes('FPSid'), 'le jeu lit le sid relevé, pas l\'adresse effacée');
});
