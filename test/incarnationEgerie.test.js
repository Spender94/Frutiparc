'use strict';
/*
 * L'INCARNATION EGERIE — une bouille ENTIÈRE d'une autre famille, en boutique.
 *
 * « Incarnation Egerie : j'aimerais le proposer en boutique dans la rubrique
 * incarnation. » Un article `incarnation` porte la chaîne d'état complète
 * de la famille 14 ; l'achat la met à l'inventaire telle quelle, et on la
 * porte, on la retire, comme une paire de prunelles — la bouille principale
 * reste dessous.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3583;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-egerie';
const RUN = Date.now().toString(36).slice(-5);
const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const EGERIE = 620014;
const ETAT = '0e0000010000000000000000';

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5452', FRUTISCORE_PORT: '5453',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch { /* pas prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('le serveur de test n’a pas démarré');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function joueur(nom, etat) {
  const corps = JSON.stringify({ username: nom, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr, body: corps });
  const r = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: hdr, body: corps })).json();
  assert.ok(r.sid, 'session ouverte pour ' + nom);
  if (etat) await fetch(BASE + '/do/eb?sid=' + r.sid + '&b=' + encodeURIComponent(etat));
  return r.sid;
}

test('Egerie est au rayon Incarnations, à son numéro figé, avec son état entier', async () => {
  const sid = await joueur('egr' + RUN, '00030507020f0m09020t0a00');
  const s = await (await fetch(BASE + '/api/light/shop?sid=' + sid)).json();
  const rayon = (s.categories || []).find((c) => c.name === 'Incarnations');
  assert.ok(rayon);
  const a = rayon.items.find((x) => x.id === EGERIE);
  assert.ok(a, 'l’article 620014');
  assert.strictEqual(a.name, 'Egerie');
  assert.strictEqual(a.kind, 'incarnation');
  assert.strictEqual(a.incarnation, true, 'une bouille entière');
  assert.strictEqual(a.etat, ETAT, 'l’aperçu est Egerie, pas la bouille du joueur');
  assert.strictEqual(a.price, 200);
  assert.strictEqual(a.owned, false); assert.strictEqual(a.offert, false);
});

test('on l’achète, on l’enfile, on la retire — sa bouille est intacte dessous', async () => {
  const mienne = '00030507020f0m09020t0a00';
  const sid = await joueur('ega' + RUN, mienne);
  const r = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: EGERIE }),
  })).json();
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.bouille, ETAT, 'l’inventaire reçoit Egerie telle quelle');
  const encore = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: hdr, body: JSON.stringify({ sid, id: EGERIE }),
  })).json();
  assert.strictEqual(encore.ok, false, 'pas deux fois');
  const inv = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  const inc = (inv.incarnations || []).find((i) => i.etat === ETAT);
  assert.ok(inc, 'rangée parmi les incarnations');
  assert.strictEqual(inc.entiere, true, 'et marquée entière : le light ne la recompose pas sur sa bouille');
  assert.strictEqual(inc.cle, 'famille14');
  assert.ok(!(inv.accessoires || []).some((x) => x.etat === ETAT), 'pas parmi les accessoires');
  // On l'enfile.
  await fetch(BASE + '/do/eb?sid=' + sid + '&b=' + encodeURIComponent(ETAT));
  const porte = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  assert.strictEqual(porte.bouillePrincipale, mienne, 'la principale ne suit pas');
  const moi = await (await fetch(BASE + '/api/forum/me?sid=' + sid)).json();
  assert.ok(JSON.stringify(moi).includes(ETAT), 'mais c’est bien Egerie qu’on montre');
  // On la retire.
  await fetch(BASE + '/do/eb?sid=' + sid + '&b=' + encodeURIComponent(mienne));
  const retire = await (await fetch(BASE + '/api/light/inventaire?sid=' + sid)).json();
  assert.strictEqual(retire.bouillePrincipale, mienne);
});

test('la base et le light savent qu’une incarnation peut être une bouille entière', () => {
  const db = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(db, /ADD COLUMN IF NOT EXISTS incarnation TEXT DEFAULT ''/);
  assert.match(db, /if \(r\.incarnation\) p\.incarnation = r\.incarnation;/);
  assert.match(db, /incarnation = \$14/);
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(serveur, /if \(def && def\.incarnation && !p\.incarnation\) p\.incarnation = def\.incarnation;/);
  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(light, /if \(i\.entiere\) return \{ nom: i\.nom \|\| "Incarnation", etat: e \};/);
  const vignette = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
  assert.match(vignette, /var FAMILLES = \[[^\]]*\b14\b/, 'le lecteur sait dessiner la famille 14');
});
