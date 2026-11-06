'use strict';
/*
 * LES SVG DES ACCESSOIRES CUSTOM, TÉLÉCHARGEABLES DEPUIS L'ADMIN.
 *
 * « Merci également de rendre téléchargeables les svg des accessoires custom
 * via l'admin. »
 *
 * Les deux tableaux de l'admin — accessoires maison et variantes — ont un
 * bouton « ⬇ SVG ». Il rend le dessin publié au format du gabarit
 * (FPBouilleVariante.exporterSVG, celui de l'atelier), que « Remplacer le SVG »
 * relit tel quel. Une variante se retrouve par son identifiant
 * (GET /api/admin/variantes/:id) ; un accessoire maison, par la route publique
 * que le lecteur emploie déjà.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3685;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-admin-svg';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-admin-svg-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
const Variante = require(path.join(ROOT, 'public', 'js', 'bouille-variante.js'));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: CLE,
      XMLSOCKET_PORT: '5823', FRUTISCORE_PORT: '5824', FRUTI_DATA_DIR: DONNEES,
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
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const BRUT = { 'x-admin-key': CLE, 'Content-Type': 'application/octet-stream' };
const TRACES = [
  { d: 'M10 10L60 10L60 40Z', fill: '#ffffff', slot: 1 },
  { d: 'M12 12L50 12L50 30Z', fill: '#000000', alpha: 0.4, blend: 'multiply' },
  { d: 'M0 0L20 0L20 20Z', fill: '#ff0000', avant: false },
  { d: 'M30 0L40 0L40 10Z', fill: '#00ff00', image: 1 },
  { d: 'M30 0L45 0L45 12Z', fill: '#0000ff', image: 2 },
];

test('une variante se relit par son identifiant, tracés et animation compris', async () => {
  const cree = await (await fetch(BASE + '/api/admin/variantes', { method: 'POST', headers: BRUT,
    body: JSON.stringify({ nom: 'Hélice', type: 3, famille: 0, base: 30, paths: TRACES, anim: { durees: [3, 5] } }) })).json();
  assert.ok(cree.ok, JSON.stringify(cree));
  const r = await fetch(BASE + '/api/admin/variantes/' + cree.id, { headers: { 'x-admin-key': CLE } });
  assert.equal(r.status, 200);
  const v = await r.json();
  assert.deepEqual([v.id, v.nom, v.type, v.famille, v.index, v.coiffureRef], [cree.id, 'Hélice', 3, 0, 30, 8]);
  assert.equal(v.paths.length, TRACES.length);
  assert.deepEqual(v.anim, { durees: [3, 5] });
  assert.equal(v.paths.find((p) => p.blend).blend, 'multiply');
  // Réservée à l'admin ; un identifiant inconnu ne rend rien.
  assert.ok([401, 403].includes((await fetch(BASE + '/api/admin/variantes/' + cree.id)).status));
  assert.equal((await fetch(BASE + '/api/admin/variantes/v999', { headers: { 'x-admin-key': CLE } })).status, 404);
});

test('le gabarit garde calques, niveaux, images et mode de fusion', () => {
  const svg = Variante.exporterSVG({ scene: { x: 0, y: 0, w: 100, h: 100 } },
    { type: 3, variante: 30, source: { paths: TRACES, anim: { durees: [3, 5] } }, nom: 'Hélice' });
  assert.match(svg, /<g id="accessoire-arriere">\n {6}<path d="M0 0L20 0L20 20Z" fill="#ff0000" \/>/);
  assert.match(svg, /<g id="couleur1">\n {6}<path d="M10 10L60 10L60 40Z" fill="#ffffff" \/>/);
  assert.match(svg, /<path d="M12 12L50 12L50 30Z" fill="#000000" opacity="0.4" style="mix-blend-mode:multiply" \/>/,
    'l’ombre en « Produit » reste une ombre au retour');
  assert.match(svg, /<g id="image1_x3">/);
  assert.match(svg, /<g id="image2_x5">/);
  assert.match(svg, /viewBox="0 0 100 100"/);
});

test('les deux tableaux de l’admin ont leur bouton « ⬇ SVG »', () => {
  assert.match(ADMIN, /onclick="telechargerSvgVariante\(\\'' \+ v\.id \+ '\\'\)"[^>]*>⬇ SVG<\/button>/);
  assert.match(ADMIN, /onclick="telechargerSvgAccMaison\(\\'' \+ a\.id \+ '\\'\)"[^>]*>⬇ SVG<\/button>/);
  // Les deux partent des tracés stockés, au format du gabarit, tête en repère.
  assert.match(ADMIN, /return FPBouilleVariante\.exporterSVG\(defs, \{[\s\S]{0,160}source: \{ paths: o\.paths \|\| \[\], anim: o\.anim \|\| null \},[\s\S]{0,120}fondTete: FPBouilleVariante\.fondTete\(defs, co, 512\),/);
  assert.match(ADMIN, /fetch\('\/api\/admin\/variantes\/' \+ encodeURIComponent\(id\), \{ headers: hdr\(\) \}\)/);
  assert.match(ADMIN, /fetch\('\/api\/light\/acc-maison\/' \+ encodeURIComponent\(id\), \{ cache: 'no-store' \}\)/);
  assert.match(ADMIN, /a\.download = fichier;/);
});
