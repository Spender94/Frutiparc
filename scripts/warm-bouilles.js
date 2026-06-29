#!/usr/bin/env node
/*
  Pré-génère les images PNG des bouilles du Bouilloscope, EN LOT, dans un
  navigateur piloté par script (≠ l'onglet de l'admin) → ne plante pas, et remplit
  le cache PERSISTANT (disque + base) du serveur cible. Une fois lancé, ouvrir le
  Bouilloscope est instantané (de simples <img>, aucun Ruffle côté visiteur).

  Pourquoi ça ne plante pas, contrairement au bouton admin : on rend une bouille à
  la fois (concurrence basse), on FERME chaque page après capture et on recrée le
  contexte régulièrement → la mémoire WASM de Ruffle est réellement libérée.

  Usage :
    node scripts/warm-bouilles.js <baseUrl> [--csv fichier.csv] [--concurrency 4] [--size 160]
  Exemples :
    node scripts/warm-bouilles.js https://frutiparc.com
    node scripts/warm-bouilles.js https://frutiparc.com --csv mes_bouilles.csv

  Sans --csv, la liste est lue depuis <baseUrl>/api/trombinoscope.
  Le rendu + le stockage se font sur <baseUrl> (qui sert déjà /bouille-capture,
  les SWF de familles et /api/bouille-img). Familles non disponibles = ignorées.
*/
const fs = require('fs');
// Playwright peut être installé dans le node_modules du projet OU globalement
// (npm i -g playwright) OU ailleurs : on tente le chemin local puis un require
// classique, avec un message clair si absent.
const chromium = (function loadChromium() {
  const tries = [require('path').join(__dirname, '..', 'node_modules', 'playwright'), 'playwright'];
  for (const m of tries) { try { return require(m).chromium; } catch (e) {} }
  console.error('\nPlaywright introuvable. Installe-le une fois :\n  npm install playwright\n  npx playwright install chromium\n');
  process.exit(1);
})();

function arg(name, def) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; }
const BASE = (process.argv[2] || '').replace(/\/+$/, '');
const CSV = arg('--csv', null);
const CONC = Math.max(1, Number(arg('--concurrency', 4)) || 4);
const SIZE = Number(arg('--size', 160)) || 160;
const RECYCLE_EVERY = Number(arg('--recycle', 200)) || 200; // recrée le contexte tous les N
const CAP_TIMEOUT = 18000;
if (!BASE || !/^https?:\/\//.test(BASE)) { console.error('Usage: node scripts/warm-bouilles.js <baseUrl> [--csv f] [--concurrency N]'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sanitize(s) { var ss = String(s == null ? '' : s).replace(/[^0-9A-Za-z]/g, '').slice(0, 24); return ss.length >= 2 ? ss : '000000010000000000000000'; }
function dec(c) { if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48; if (c >= 'a' && c <= 'z') return c.charCodeAt(0) - 87; if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 29; return 0; }
// Famille = 2 premiers caractères base62 ("00"→0, "0a"→10 … "0c"→12).
function familyOf(s) { s = sanitize(s); return dec(s.charAt(0)) * 62 + dec(s.charAt(1)); }
const statusUrl = (s) => `${BASE}/api/bouille-img/status?s=${encodeURIComponent(s)}&e=0&size=${SIZE}&fmt=png`;
const captureUrl = (s) => `${BASE}/bouille-capture?s=${encodeURIComponent(s)}&e=0&size=${SIZE}&fmt=png`;
async function jget(url) { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? r.json() : null; }

(async () => {
  // 1) familles disponibles
  const famJson = await jget(`${BASE}/api/bouille-families`).catch(() => null);
  const families = new Set((famJson && famJson.families) || [0, 10, 11, 12, 13, 14, 15, 16, 23, 24]);
  console.log('Familles disponibles :', [...families].join(', '));

  // 2) liste des bouilles
  let codes = [];
  if (CSV) {
    const txt = fs.readFileSync(CSV, 'utf8');
    txt.split(/\r?\n/).forEach((line) => { const parts = line.split(/[,;\t]/); const c = parts[parts.length - 1]; if (c) codes.push(c.trim()); });
  } else {
    const tj = await jget(`${BASE}/api/trombinoscope`);
    codes = ((tj && tj.entries) || []).map((e) => e.bouille);
  }
  // normalise, dédoublonne, filtre familles
  const seen = new Set(); const todo = []; let unsupported = 0;
  for (const raw of codes) {
    const s = sanitize(raw);
    if (seen.has(s)) continue; seen.add(s);
    if (!families.has(familyOf(s))) { unsupported++; continue; }
    todo.push(s);
  }
  console.log(`${codes.length} bouilles → ${todo.length} à traiter (${unsupported} familles indisponibles, doublons retirés)`);
  if (!todo.length) { console.log('Rien à faire.'); process.exit(0); }

  // 3) rendu en lot
  const exe = process.env.PW_CHROMIUM || arg('--exe', null); // sinon auto-détection Playwright
  const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] };
  if (exe) launchOpts.executablePath = exe;
  let browser = await chromium.launch(launchOpts);
  let ctx = await browser.newContext();
  let since = 0;
  let done = 0, captured = 0, skipped = 0, failed = 0;
  const t0 = Date.now();

  async function capture(s) {
    // déjà en cache ? (persistant) → on saute
    try { const st = await jget(statusUrl(s)); if (st && st.cached) { skipped++; return; } } catch (e) {}
    const page = await ctx.newPage();
    try {
      await page.goto(captureUrl(s), { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      // la page capture rend, POST le PNG, puis (en top-level) redirige vers /bouille-img.
      // on attend que le cache soit rempli (poll), robuste.
      const deadline = Date.now() + CAP_TIMEOUT;
      let okNow = false;
      while (Date.now() < deadline) {
        await sleep(500);
        const st = await jget(statusUrl(s)).catch(() => null);
        if (st && st.cached) { okNow = true; break; }
      }
      if (okNow) captured++; else failed++;
    } catch (e) { failed++; }
    finally { await page.close().catch(() => {}); }
  }

  // worker pool
  let idx = 0;
  async function worker() {
    while (idx < todo.length) {
      const s = todo[idx++];
      await capture(s);
      done++; since++;
      if (done % 25 === 0 || done === todo.length) {
        const rate = done / Math.max(1, (Date.now() - t0) / 1000);
        const eta = Math.round((todo.length - done) / Math.max(0.01, rate));
        console.log(`  ${done}/${todo.length} · ${captured} générées · ${skipped} déjà en cache · ${failed} échecs · ~${eta}s restants`);
      }
      // recyclage du contexte pour borner la mémoire
      if (since >= RECYCLE_EVERY) { since = 0; await ctx.close().catch(() => {}); ctx = await browser.newContext(); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));

  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
  console.log(`\nTerminé : ${captured} générées, ${skipped} déjà en cache, ${failed} échecs, ${unsupported} familles indispo. en ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(failed > todo.length / 2 ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
