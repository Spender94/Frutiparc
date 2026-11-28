/*
 * LA VERSION ANGLAISE DES JEUX — lot A : Grapiz, Frutibandas, Mini-Fever,
 * Miniwave 2.
 *
 * Chaque page de jeu charge /js/i18n.js juste après sid-discret.js, puis son
 * dictionnaire (`/<jeu>/lang/en.js`) quand la langue est l'anglais
 * (docs/I18N.md, « Les jeux »). Ce que ces tests verrouillent, dans un vrai
 * Chromium, jeu par jeu :
 *
 *   · avec `localStorage.fp_lang = 'en'` : <html lang="en">, un échantillon
 *     de l'anglais du menu, de l'aide et de l'écran de fin, aucune requête
 *     ratée vers /lang/en.js ou /i18n/, aucune erreur de page ;
 *   · avec `fp_lang = 'fr'` : le français d'avant, à l'octet près, et aucun
 *     dictionnaire chargé ;
 *   · les DEUX jeux qui dessinent sur une toile de 240 × 240 (Mini-Fever,
 *     Miniwave) : chaque texte posé par fillText est relevé (un espion sur
 *     CanvasRenderingContext2D), et l'anglais doit tenir — dans la scène, dans
 *     son encadré — et s'écrire dans sa police : les fontes de Miniwave sont
 *     des sous-ensembles sortis du SWF de 2004 (l'Arcade Classic n'a que les
 *     chiffres, ABCDEINORSTUV et elv). Un caractère qu'une fonte n'a pas
 *     retombe sur la police suivante de la pile : on le repère en mesurant le
 *     caractère avec deux replis différents — la largeur ne bouge pas s'il
 *     est dans la fonte.
 *
 * Grapiz et Frutibandas demandent un vrai compte (ils n'ont pas de mode
 * invité) ; leur fin de partie arrive par des trames <gz>/<bd> glissées dans
 * leur WebSocket, comme le serveur les enverrait. Mini-Fever et Miniwave
 * s'ouvrent en invité (`?invite=1`) et vont au bout par leurs propres routines
 * de fin.
 *
 * Le serveur tourne sans base (DATABASE_URL vide), ses fichiers dans un
 * dossier temporaire. Express refuse un chemin qui traverse un dossier caché
 * (un arbre de travail rangé sous un dossier à point) : on passe alors par un
 * lien symbolique sans point. Sans Playwright, les tests sont sautés.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 5381;
const BASE = `http://127.0.0.1:${PORT}`;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function playwright() {
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* suivant */ }
  }
  return null;
}
const PW = playwright();
const SAUTER = PW ? false : 'Playwright absent';

let proc = null;
let navigateur = null;
let lien = null;
let donnees = null;
let SID = '';
let PSEUDO = '';

before(async () => {
  if (!PW) return;
  let racine = ROOT;
  if (ROOT.split(path.sep).some((s) => s.startsWith('.'))) {
    lien = path.join(os.tmpdir(), 'i18n-jeux-a-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(ROOT, lien);
    racine = lien;
  }
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-jeux-a-donnees-'));
  proc = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
    cwd: racine,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: '5382', FRUTISCORE_PORT: '5383',
      REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000', FRUTI_DATA_DIR: donnees,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let pret = false;
  for (let i = 0; i < 240 && !pret; i++) {
    try { pret = (await fetch(BASE + '/grapiz/index.html')).ok; } catch { /* pas prêt */ }
    if (!pret) await attendre(250);
  }
  if (!pret) throw new Error('serveur indisponible');
  navigateur = await PW.chromium.launch();
  // Un vrai compte : Grapiz et Frutibandas n'ont pas de mode invité.
  PSEUDO = 'langue' + (Date.now() % 100000);
  const corps = JSON.stringify({ username: PSEUDO, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
  SID = (await r.json()).sid || '';
});

after(async () => {
  if (navigateur) await navigateur.close().catch(() => {});
  if (proc) proc.kill('SIGKILL');
  if (lien) { try { fs.unlinkSync(lien); } catch { /* déjà parti */ } }
  if (donnees) { try { fs.rmSync(donnees, { recursive: true, force: true }); } catch { /* rien */ } }
});

// ── Les outils ──────────────────────────────────────────────────────────────

/*
 * Une page dans une langue. Avant tout script de la page : la langue posée
 * dans fp_lang, l'espion des textes de la toile (chaque texte une fois, avec
 * sa police, son alignement et sa largeur), et les WebSockets relevées pour y
 * glisser des trames (`__trame`).
 */
async function ouvrir(chemin, langue, viewport) {
  const ctx = await navigateur.newContext({ viewport: viewport || { width: 1000, height: 760 } });
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('fp_lang', l); } catch (e) { /* stockage refusé */ }
    window.__textes = new Map();
    const C = CanvasRenderingContext2D.prototype;
    const fillText = C.fillText;
    C.fillText = function (t, x, y) {
      const s = String(t);
      const k = this.font + '|' + s;
      if (s.trim() && !window.__textes.has(k)) {
        window.__textes.set(k, { t: s, f: this.font, a: this.textAlign, w: this.measureText(s).width, x, y });
      }
      return fillText.apply(this, arguments);
    };
    const W = window.WebSocket;
    window.__ws = [];
    window.WebSocket = function (u, p) { const w = p ? new W(u, p) : new W(u); window.__ws.push(w); return w; };
    window.WebSocket.prototype = W.prototype;
    window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;
    window.__trame = (x) => { const w = window.__ws[window.__ws.length - 1]; w.onmessage({ data: x + '\0' }); };
  }, langue);
  const page = await ctx.newPage();
  const erreurs = [];
  const ratees = [];
  const dictionnaires = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('request', (r) => { if (/\/lang\/|\/i18n\//.test(r.url())) dictionnaires.push(r.url()); });
  page.on('requestfailed', (r) => { if (/\/lang\/|\/i18n\//.test(r.url())) ratees.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400 && /\/lang\/|\/i18n\//.test(r.url())) ratees.push(r.status() + ' ' + r.url()); });
  await page.goto(BASE + chemin);
  return { ctx, page, erreurs, ratees, dictionnaires };
}

const textes = (page) => page.evaluate(() => [...window.__textes.values()]);
const texte = (page, sel) => page.evaluate((s) => document.querySelector(s).textContent, sel);
const attr = (page, sel, a) => page.evaluate(([s, n]) => document.querySelector(s).getAttribute(n), [sel, a]);

// Les quatre choses que chaque page en anglais doit tenir.
async function verifierAnglais(o, jeu) {
  assert.strictEqual(await o.page.evaluate(() => document.documentElement.lang), 'en', jeu + ' : <html lang="en">');
  assert.ok(o.dictionnaires.some((u) => u.endsWith('/' + jeu + '/lang/en.js')), jeu + ' : le dictionnaire du jeu est demandé');
  assert.deepStrictEqual(o.ratees, [], jeu + ' : aucune requête de dictionnaire ratée');
  assert.deepStrictEqual(o.erreurs, [], jeu + ' : aucune erreur de page');
}
async function verifierFrancais(o, jeu) {
  assert.strictEqual(await o.page.evaluate(() => document.documentElement.lang), 'fr', jeu + ' : <html lang="fr">');
  assert.deepStrictEqual(o.dictionnaires, [], jeu + ' : en français, aucun dictionnaire chargé');
  assert.deepStrictEqual(o.erreurs, [], jeu + ' : aucune erreur de page');
}

/*
 * La police d'un texte de la toile : chaque caractère est mesuré avec deux
 * replis (serif, monospace) derrière la fonte du jeu. S'il est dans la fonte,
 * le repli ne sert pas et les deux largeurs sont égales. Rend les caractères
 * manquants, texte par texte.
 */
function horsPolice(page, liste) {
  return page.evaluate((l) => {
    const c = document.createElement('canvas').getContext('2d');
    const out = [];
    for (const e of l) {
      const m = e.f.match(/^(.*?\d+px)\s+([^,]+),/);
      if (!m) continue;
      const fam = m[2].replace(/['"]/g, '').trim();
      if (!/^(ArcadeClassic|Jawbreaker|VerdanaPix)$/.test(fam)) continue;
      const manque = [];
      for (const ch of e.t) {
        if (ch === ' ') continue;
        c.font = m[1] + ' ' + fam + ', serif'; const a = c.measureText(ch).width;
        c.font = m[1] + ' ' + fam + ', monospace'; const b = c.measureText(ch).width;
        if (Math.abs(a - b) > 0.01 && manque.indexOf(ch) < 0) manque.push(ch);
      }
      if (manque.length) out.push(fam + ' « ' + e.t + ' » : ' + manque.join(''));
    }
    return out;
  }, liste);
}

// ── GRAPIZ ──────────────────────────────────────────────────────────────────
//
// Le menu des modes, le salon (et son aide : « clique sur un joueur… »), puis
// une partie perdue : la trame `start`, deux spectateurs, la trame `end`.

async function grapizFin(page) {
  await page.evaluate((moi) => {
    const pl = '<p u="' + moi + '" n="' + moi + '" e="0" rt="60000" sr="3"/><p u="pepino" n="Pépino" e="1" rt="60000" sr="0"/>';
    window.__trame('<gz e="start" g="t1" sz="4" turn="1" end="0" sp="0">' + pl + '<t e="0" x="0" y="4"/><t e="1" x="8" y="4"/></gz>');
    window.__trame('<gz e="spec" g="t1" ns="2" l="Kiwi, Pomme"/>');
    window.__trame('<gz e="end" g="t1" sz="4" turn="1" end="1" w="1">' + pl + '<t e="1" x="8" y="4"/></gz>');
  }, PSEUDO);
  await page.waitForFunction(() => document.getElementById('g-end').style.display === 'block', null, { timeout: 5000 });
}

test('Grapiz en anglais : modes, salon, aide et fin de partie', { skip: SAUTER, timeout: 90000 }, async () => {
  const o = await ouvrir('/grapiz/?sid=' + SID, 'en');
  const { page } = o;
  try {
    await page.waitForSelector('#screen-mode.on', { timeout: 30000 });
    assert.strictEqual(await texte(page, '#mode-champ .mname'), 'CHAMPIONSHIP');
    assert.strictEqual(await texte(page, '#mode-amical .mname'), 'FRIENDLY MATCHES');
    assert.strictEqual(await texte(page, '#mode-champ .j span'), 'YOUR TURN');
    assert.match(await texte(page, '#ma-note'), /^Correspondence · 3 days per move/);
    assert.match(await texte(page, '#status'), new RegExp('^Connected — ' + PSEUDO, 'i'));

    await page.click('#mode-chall');
    await page.waitForSelector('#screen-lobby.on');
    assert.strictEqual(await texte(page, '#btn-create'), 'Create a game');
    assert.strictEqual(await texte(page, '#defis-title'), 'Challenge list');
    assert.strictEqual(await attr(page, '#lobby-say', 'placeholder'), 'Write a message…');
    assert.strictEqual(await attr(page, '#lobby-back', 'title'), 'Back');
    assert.match(await texte(page, '#players'), /\d+ playing\s*\d+ waiting/);
    // L'aide du panneau des défis.
    await page.evaluate(() => document.querySelector('[data-exp="defis"]').click());
    assert.strictEqual(await texte(page, '.defis-empty'), 'Click a player in the list on the right to see their status and challenge them.');

    await grapizFin(page);
    assert.strictEqual(await texte(page, '#g-end'), 'Defeat — Pépino wins. Streak over.');
    assert.strictEqual(await texte(page, '#g-spec'), '👁 2 spectators: Kiwi, Pomme');
    assert.match(await texte(page, '.g-warn'), /^WARNING: F5, Alt-F4, Control-W/);
    assert.strictEqual(await attr(page, '#game-say', 'placeholder'), 'Chat…');
    await verifierAnglais(o, 'grapiz');
  } finally { await o.ctx.close(); }
});

test('Grapiz en français : le texte d’avant, à l’identique', { skip: SAUTER, timeout: 90000 }, async () => {
  const o = await ouvrir('/grapiz/?sid=' + SID, 'fr');
  const { page } = o;
  try {
    await page.waitForSelector('#screen-mode.on', { timeout: 30000 });
    assert.strictEqual(await texte(page, '#mode-champ .mname'), 'CHAMPIONNAT');
    assert.strictEqual(await texte(page, '#mode-champ .j span'), 'À TOI DE JOUER');
    assert.match(await texte(page, '#ma-note'), /^En différé · 3 jours par coup/);
    await page.click('#mode-chall');
    await page.waitForSelector('#screen-lobby.on');
    assert.strictEqual(await texte(page, '#btn-create'), 'Créer une partie');
    assert.strictEqual(await attr(page, '#lobby-say', 'placeholder'), 'Écris un message…');
    assert.match(await texte(page, '#players'), /\d+ qui joue\s*\d+ en attente/);
    await grapizFin(page);
    assert.strictEqual(await texte(page, '#g-end'), 'Défaite — Pépino gagne. Série terminée.');
    assert.strictEqual(await texte(page, '#g-spec'), '👁 2 spectateurs : Kiwi, Pomme');
    assert.strictEqual(await texte(page, '.g-warn'), 'ATTENTION : Les touches F5, Alt-F4, Control-W, ou autres ferment ou relancent Frutiparc et vous font perdre la partie. Ne les utilisez pas !');
    assert.strictEqual(await attr(page, '#game-say', 'placeholder'), 'Discuter…');
    await verifierFrancais(o, 'grapiz');
  } finally { await o.ctx.close(); }
});

// ── FRUTIBANDAS ─────────────────────────────────────────────────────────────
//
// Le menu des salles, le salon, puis une partie : une carte de la main
// survolée (son nom et son texte, les noms des bannières anglaises
// d'origine), et la fin — perdue.

async function bandasPartie(page) {
  await page.evaluate((moi) => {
    const pl = '<p u="' + moi + '" n="' + moi + '" e="0" rt="60000" sr="3" c="1:6"/><p u="pepino" n="Pépino" e="1" rt="60000" sr="0" c="6"/>';
    window.__trame('<bd e="start" g="t1" sa="chall" ph="2" t="0" c="" end="0">' + pl
      + '<b size="4" x1="0" x2="3" y1="0" y2="3">7878878778788787</b></bd>');
    window.__trame('<bd e="spec" g="t1" ns="1" l="Kiwi"/>');
  }, PSEUDO);
  await page.waitForSelector('#screen-game.on', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#slots0 .cardslot'), null, { timeout: 5000 });
  await page.evaluate(() => document.querySelector('#slots0 .cardslot').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
}
async function bandasFin(page) {
  await page.evaluate(() => window.__trame('<bd e="ev" g="t1" t="end" tm="0" w="1"/>'));
  await page.waitForFunction(() => document.getElementById('bd-end').style.display === 'block', null, { timeout: 5000 });
}

test('Frutibandas en anglais : salles, salon, cartes et fin de partie', { skip: SAUTER, timeout: 90000 }, async () => {
  const o = await ouvrir('/bandas/?sid=' + SID, 'en', { width: 1100, height: 760 });
  const { page } = o;
  try {
    await page.waitForSelector('#screen-mode.on', { timeout: 30000 });
    assert.strictEqual(await texte(page, '#mode-champ .mname'), 'CHAMPIONSHIP');
    assert.strictEqual(await texte(page, '#mode-amical .mname'), 'FRIENDLY MATCHES');
    assert.strictEqual(await texte(page, '#mode-chall .j span'), 'PLAYERS');
    await page.waitForFunction(() => /Correspondence/.test(document.getElementById('dif-champ').textContent), null, { timeout: 10000 });

    await page.click('#mode-chall');
    await page.waitForSelector('#screen-lobby.on');
    assert.strictEqual(await texte(page, '#lobby-title'), 'CHALLENGE');
    assert.strictEqual(await texte(page, '#btn-create'), 'Create a game');
    assert.strictEqual(await texte(page, '.defis-empty'), 'Click a player in the list on the right to see their status and challenge them.');

    await bandasPartie(page);
    assert.strictEqual(await texte(page, '#bd-info .iname'), 'Second Wave');
    assert.strictEqual(await texte(page, '#bd-info .idesc'), 'You can play a second time this turn.');
    assert.strictEqual(await texte(page, '#btn-giveup'), 'Give up');
    assert.strictEqual(await texte(page, '#btn-sound'), 'Sound');
    assert.strictEqual(await attr(page, '#bd-input', 'placeholder'), 'Chat… (Enter to send)');
    assert.match(await texte(page, '#bd-chatbox'), /WARNING: F5[\s\S]*👁 Kiwi is watching the game\./);
    // Les douze cartes : les noms des bannières anglaises d'origine.
    assert.deepStrictEqual(await page.evaluate(() => T.table('bandas.cartes', new Array(12).fill(''))),
      ['Anvil', 'Second Wave', 'Confiscation', 'Reinforcement', 'Disorder', 'Petrification', 'Cow', 'Conversion',
        'Charge', 'Intermission', 'Solo', 'Trap']);

    await bandasFin(page);
    assert.strictEqual(await texte(page, '#bd-endtitle'), 'Leave the game');
    assert.strictEqual(await texte(page, '#bd-endtext'), 'You lost!\nSee you soon in the Frutibandas challenge.');
    assert.strictEqual(await texte(page, '#bd-endsub'), 'Pépino wins the game.');
    await verifierAnglais(o, 'bandas');
  } finally { await o.ctx.close(); }
});

test('Frutibandas en français : le texte d’avant, à l’identique', { skip: SAUTER, timeout: 90000 }, async () => {
  const o = await ouvrir('/bandas/?sid=' + SID, 'fr', { width: 1100, height: 760 });
  const { page } = o;
  try {
    await page.waitForSelector('#screen-mode.on', { timeout: 30000 });
    assert.strictEqual(await texte(page, '#mode-champ .mname'), 'CHAMPIONNAT');
    await page.waitForFunction(() => /En différé/.test(document.getElementById('dif-champ').textContent), null, { timeout: 10000 });
    await page.click('#mode-chall');
    await page.waitForSelector('#screen-lobby.on');
    assert.strictEqual(await texte(page, '#btn-create'), 'Créer une partie');
    await bandasPartie(page);
    assert.strictEqual(await texte(page, '#bd-info .iname'), 'Célérité');
    assert.strictEqual(await texte(page, '#bd-info .idesc'), 'Vous pouvez jouer une seconde fois à ce tour.');
    assert.strictEqual(await texte(page, '#btn-giveup'), 'Abandon');
    assert.match(await texte(page, '#bd-chatbox'), /ATTENTION : Les touches F5[\s\S]*👁 Kiwi observe la partie\./);
    await bandasFin(page);
    assert.strictEqual(await texte(page, '#bd-endtitle'), 'Quitter la partie');
    assert.strictEqual(await texte(page, '#bd-endtext'), 'Vous avez perdu !\nÀ bientôt sur le challenge Frutibandas.');
    assert.strictEqual(await texte(page, '#bd-endsub'), 'Pépino remporte la partie.');
    await verifierFrancais(o, 'bandas');
  } finally { await o.ctx.close(); }
});

// ── MINI-FEVER ──────────────────────────────────────────────────────────────
//
// L'écran d'accueil (les cases du menu, sur la toile), le bandeau, puis une
// arcade « facile » menée à son terme comme le fait modeInviteJeuxA : le
// débriefing du moteur sur la dernière vie, douze épreuves gagnées. Le panneau
// de l'invité vient se poser, en anglais.

const feverPret = (page) => page.waitForFunction(() => window.__minifever && window.__minifever.socle, null, { timeout: 60000 });
async function feverArcade(page, palier) {
  await page.evaluate((p) => [...document.querySelectorAll('#modes a')].find((a) => a.textContent === p).click(), palier);
  await page.waitForFunction(() => { const s = window.__minifever.socle; return s && s.palier === 0 && s.info && !s.termine; }, null, { timeout: 30000 });
  // Un débriefing gagné d'abord : le verdict et le compte, sur la toile.
  await page.evaluate(() => { const s = window.__minifever.socle; s.niveau = 4; s.derniere = true; s.initEtape(1); });
  await attendre(2500);
  await page.evaluate(() => { const s = window.__minifever.socle; s.niveau = 12; s.vies = 1; s.derniere = false; s.initEtape(1); });
  await page.waitForFunction(() => window.__minifever.socle.termine, null, { timeout: 30000 });
}

test('Mini-Fever en anglais : menu, bandeau, scène et fin d’arcade — et tout tient dans 240 × 240', { skip: SAUTER, timeout: 120000 }, async () => {
  const o = await ouvrir('/minifever/?invite=1', 'en', { width: 600, height: 700 });
  const { page } = o;
  try {
    await feverPret(page);
    await page.waitForFunction(() => window.__minifever.socle.etape >= 2, null, { timeout: 20000 });
    assert.deepStrictEqual(await page.$$eval('#modes a', (l) => l.map((a) => a.textContent)),
      ['menu', 'fever', 'easy', 'normal', 'hard', 'infernal']);
    assert.strictEqual(await texte(page, '#etat'), 'choose your mode');
    assert.match(await texte(page, '#bareme'), /^arcade: 10 pts per round won, × \d+ on normal, × \d+ on hard, × \d+ on infernal/);
    await page.evaluate(() => {
      window.__appels = [];
      const vrai = window.FPInvite.finDePartie;
      window.FPInvite.finDePartie = function (op) { window.__appels.push(op); return vrai.apply(this, arguments); };
    });
    await feverArcade(page, 'easy');
    assert.strictEqual(await texte(page, '#etat'), '12/40 rounds — pick a mode to play again');
    await page.waitForSelector('#fp-invite', { timeout: 5000 });
    assert.strictEqual(await texte(page, '#fp-invite .fpi-score'), 'Your score: 120 pts');
    assert.strictEqual(await texte(page, '#fp-invite .fpi-titre'), 'Game over!');
    assert.strictEqual((await page.evaluate(() => window.__appels[0].libelleEn)), 'Your score');

    // La toile : l'anglais a bien été dessiné…
    const l = await textes(page);
    const vus = l.map((e) => e.t);
    for (const t of ['ARCADE', 'FEVER', 'won!', 'missed!', 'out of 40']) assert.ok(vus.includes(t), 'dessiné : ' + t + ' — ' + vus.join(' / '));
    assert.ok(!vus.some((t) => /gagné|raté|sur \d/.test(t)), 'plus de français sur la toile');
    // … et tient dans la scène.
    for (const e of l) assert.ok(e.w <= 236, 'trop large pour la scène : « ' + e.t + ' » (' + Math.round(e.w) + ' px)');
    // Tous les noms d'épreuves, de paliers et de cases, mesurés dans leur police.
    const mesures = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('2d');
      const r = [];
      c.font = 'bold 15px "Trebuchet MS", sans-serif';
      for (const j of window.MinifeverJeux.JEUX) { const t = T('minifever.jeu.' + j.cle, j.nom); r.push([t, c.measureText(t).width, 230]); }
      c.font = 'bold 13px "Trebuchet MS", sans-serif';
      for (let i = 0; i < 4; i++) { const t = T('minifever.palier' + i, '').toUpperCase(); r.push([t, c.measureText(t).width, 140]); }
      c.font = 'bold 12px "Trebuchet MS", sans-serif';
      r.push(['click to resume', c.measureText(T('minifever.reprendre', '')).width, 230]);
      return r;
    });
    for (const [t, w, max] of mesures) {
      assert.ok(t && !/[àâéèêëîïôùûç]/i.test(t), 'traduit : ' + t);
      assert.ok(w <= max, '« ' + t + ' » déborde (' + Math.round(w) + ' > ' + max + ' px)');
    }
    await verifierAnglais(o, 'minifever');
  } finally { await o.ctx.close(); }
});

test('Mini-Fever en français : le texte d’avant, à l’identique', { skip: SAUTER, timeout: 120000 }, async () => {
  const o = await ouvrir('/minifever/?invite=1', 'fr', { width: 600, height: 700 });
  const { page } = o;
  try {
    await feverPret(page);
    await page.waitForFunction(() => window.__minifever.socle.etape >= 2, null, { timeout: 20000 });
    assert.deepStrictEqual(await page.$$eval('#modes a', (l) => l.map((a) => a.textContent)),
      ['menu', 'fever', 'facile', 'normal', 'difficile', 'infernal']);
    assert.strictEqual(await texte(page, '#etat'), 'choisis ton mode');
    assert.match(await texte(page, '#bareme'), /^arcade : 10 pts par épreuve remportée, × \d+ en normal, × \d+ en difficile, × \d+ en infernal/);
    await feverArcade(page, 'facile');
    assert.strictEqual(await texte(page, '#etat'), '12/40 épreuves — choisir un mode pour rejouer');
    await page.waitForSelector('#fp-invite', { timeout: 5000 });
    assert.strictEqual(await texte(page, '#fp-invite .fpi-score'), 'Ton score : 120 pts');
    const vus = (await textes(page)).map((e) => e.t);
    for (const t of ['ARCADE', 'gagné !', 'raté !', 'sur 40']) assert.ok(vus.includes(t), 'dessiné : ' + t);
    await verifierFrancais(o, 'minifever');
  } finally { await o.ctx.close(); }
});

// ── MINIWAVE 2 ──────────────────────────────────────────────────────────────
//
// Le menu (les rubriques, le panneau d'accueil survolé rubrique par rubrique,
// l'escadron), une partie d'endurance (son palier, l'alerte du boss, le
// panneau de niveau, la pause, la fin du parcours) puis l'écran de fin de la
// page. Les noms de niveaux et de missions, des jeux de mots, restent en
// français — « Fruit d'artifice » sous « level 12 ».

const wavePret = (page) => page.waitForFunction(() => window.__ui && window.__ui.visible && window.__ui.boites.length, null, { timeout: 60000 });
async function waveParcours(page) {
  for (let i = 0; i < 5; i++) {
    await page.evaluate((i) => {
      const b = window.__ui.boites.find((x) => x.rubrique === i);
      window.__ui.auSurvol(10 + b.x + 20, 54 + b.y + 5);
    }, i);
    await attendre(3600);                                     // le texte s'écrit lettre à lettre
  }
  await page.evaluate(() => { window.__ui.auSurvol(-1, -1); window.__ui.choisirRubrique('arcade'); });
  await attendre(2500);
  await page.evaluate(() => window.__ui.lancer({ mode: 'survival', niveaux: [], vies: 1, nom: 'Endurance' }, [0]));
  await attendre(800);
  await page.evaluate(() => window.miniwaveClient.annonce('panneau', { boss: true }));
  await attendre(700);
  await page.evaluate(() => window.miniwaveClient.annonce('panneau', { boss: false, level: 11, name: 'Fruit d\'artifice' }));
  await attendre(700);
  await page.evaluate(() => window.miniwaveClient.pauser(true));
  await attendre(300);
  await page.evaluate(() => { window.miniwaveClient.pauser(false); window.miniwaveClient.panneau = { type: 2, titre: '', texte: T('miniwave.felicitations', 'vous avez repoussé l\'attaque des fruits mutants'), alpha: 1, ta: 1 }; window.miniwaveClient.panneauT = 50; });
  await attendre(400);
  await page.evaluate(() => window.miniwaveClient.jeu.finPartie('gameover'));
  await page.waitForSelector('#fin.on', { timeout: 10000 });
}

test('Miniwave en anglais : menu, partie et fin — dans ses polices, sans déborder', { skip: SAUTER, timeout: 150000 }, async () => {
  const o = await ouvrir('/miniwave/?invite=1', 'en', { width: 520, height: 760 });
  const { page } = o;
  try {
    await wavePret(page);
    assert.match(await page.evaluate(() => document.querySelector('#pave-tactile .mode-emploi').innerHTML), /^slide your thumb — the ship follows it and fires<br>double-tap: special attack$/);
    assert.strictEqual(await texte(page, '#aide'), '← → to move · space to fire · shift for the bomb · P to pause');
    assert.strictEqual(await attr(page, '#muet', 'aria-label'), 'Mute');
    await waveParcours(page);
    assert.strictEqual(await texte(page, '#fin-score'), '0 points · stage 1');
    assert.strictEqual(await texte(page, '#rejouer'), 'Play again');

    const l = await textes(page);
    const vus = l.map((e) => e.t);
    for (const t of ['ARCADE', 'BONUS', 'SPECIAL', 'CHALLENGE', 'SHOP', 'Welcome', 'Action', 'Missions', 'Secret?', 'Shop',
      'squadron selection', 'stage 1', 'level 12', 'Fruit d\'artifice', 'PAUSE', 'P, Esc or the pause button to resume', 'BRAVO']) {
      assert.ok(vus.includes(t), 'dessiné : ' + t + ' — ' + vus.join(' / '));
    }
    const tout = vus.join(' ');
    // (Le panneau d'accueil coupe ses textes en lignes de 100 px : on cherche
    // des morceaux d'une ligne.)
    for (const m of ['Drive the mutant', 'choose your', 'section.', 'Spend your', 'Warning!', 'driven']) {
      assert.ok(tout.includes(m), 'dessiné : ' + m);
    }
    assert.ok(vus.includes('Apprentice,') && (vus.includes('Good evening') || vus.some((t) => /^Hello\b/.test(t))),
      'le salut et le grade en anglais — ' + vus.join(' / '));
    assert.ok(!/Repoussez|Bienvenue|Bonjour|Bonsoir|Apprenti\b|escadron selection|palier \d|Échap/.test(tout), 'plus de français dans l’interface');
    // Chaque texte s'écrit dans sa police (les sous-ensembles du SWF)…
    assert.deepStrictEqual(await horsPolice(page, l), [], 'des caractères hors de la police du SWF');
    // … et tient : dans la scène, et les rubriques dans leurs encadrés de 100.
    for (const e of l) assert.ok(e.w <= 238, 'trop large pour la scène : « ' + e.t + ' » (' + Math.round(e.w) + ' px)');
    for (const t of ['ARCADE', 'BONUS', 'SPECIAL', 'CHALLENGE', 'SHOP']) {
      const e = l.find((x) => x.t === t && /Jawbreaker/.test(x.f));
      assert.ok(e && e.w <= 96, t + ' tient dans son encadré (' + (e && Math.round(e.w)) + ' px)');
    }
    // Les lignes du panneau d'accueil : 100 px de large au plus (110 - 10).
    for (const e of l.filter((x) => /VerdanaPix/.test(x.f) && Math.abs(x.x - 165) < 1 && x.y >= 90)) {
      assert.ok(e.w <= 100, 'ligne du panneau trop large : « ' + e.t + ' » (' + Math.round(e.w) + ' px)');
    }
    // Les grades, d'un bloc : treize, tous traduits.
    const grades = await page.evaluate(() => T.table('miniwave.grades', window.MiniwavePlateforme.GRADES));
    assert.strictEqual(grades.length, 13);
    assert.deepStrictEqual(grades.slice(0, 3), ['Apprentice', 'Cadet', 'Cornet']);
    await verifierAnglais(o, 'miniwave');
  } finally { await o.ctx.close(); }
});

test('Miniwave en français : le texte d’avant, à l’identique', { skip: SAUTER, timeout: 150000 }, async () => {
  const o = await ouvrir('/miniwave/?invite=1', 'fr', { width: 520, height: 760 });
  const { page } = o;
  try {
    await wavePret(page);
    assert.strictEqual(await texte(page, '#aide'), '← → pour se déplacer · espace pour tirer · majuscule pour la bombe · P pour la pause');
    await waveParcours(page);
    assert.strictEqual(await texte(page, '#fin-score'), '0 points · palier 1');
    assert.strictEqual(await texte(page, '#rejouer'), 'Rejouer');
    const vus = (await textes(page)).map((e) => e.t);
    for (const t of ['STAND', 'Bienvenue', 'Achats', 'escadron selection', 'palier 1', 'level 12', 'P, Échap ou ⏸ pour reprendre', 'BRAVO']) {
      assert.ok(vus.includes(t), 'dessiné : ' + t + ' — ' + vus.join(' / '));
    }
    assert.ok(vus.join(' ').includes('Repoussez les'), 'la description de l’arcade');
    await verifierFrancais(o, 'miniwave');
  } finally { await o.ctx.close(); }
});
