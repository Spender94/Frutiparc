'use strict';
/*
 * Natacha, l'hôtesse d'accueil : un mot de bienvenue sur le forum à chaque
 * inscription.
 *
 *   · natacha.js, à sec : le pseudo est @mentionné, les mots varient d'un
 *     Frutiz à l'autre, se répètent pour le même le même jour, et disent
 *     l'heure, le week-end, le parrain, le rang rond — jamais autre chose ;
 *   · le serveur, avec Postgres (sauté sans base) : l'inscription ouvre le
 *     sujet dans « Frutiz » et y poste le mot ; la deuxième en poste un
 *     autre ; les PNJ ne sont pas salués.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const RACINE = path.join(__dirname, '..');
const N = require(path.join(RACINE, 'natacha.js'));

// Une date de Paris, à l'heure voulue (un mercredi, puis un dimanche).
const mercredi = (h) => new Date(`2026-09-23T${String(h).padStart(2, '0')}:30:00+02:00`);
const dimanche = (h) => new Date(`2026-09-27T${String(h).padStart(2, '0')}:30:00+02:00`);
// La mention telle que le forum la lit (fb/index.html, server.js jetonsMention).
const MENTION = /(^|[\s(])@([A-Za-z0-9_.-]{2,32})/g;
const mentions = (m) => Array.from(m.matchAll(MENTION), (x) => x[2]);

test('le mot mentionne le pseudo, tel quel, et rien ne colle à la mention', () => {
  for (const pseudo of ['Remi', 'pomme_verte', 'Kiwi92', 'xXDarkXx', 'abc']) {
    for (let h = 0; h < 24; h += 3) {
      const m = N.messageBienvenue(pseudo, { date: mercredi(h) });
      assert.ok(m.indexOf('@' + pseudo) >= 0, m);
      assert.deepStrictEqual(mentions(m), [pseudo], 'une seule mention, exacte : ' + m);
      assert.ok(m.split(/[.!?] /).length >= 2, 'au moins deux phrases : ' + m);
      assert.ok(m.length < 400, m);
    }
  }
});

test('les mots varient d’un Frutiz à l’autre, et se répètent pour le même le même jour', () => {
  const vus = new Set();
  for (let i = 0; i < 200; i++) vus.add(N.messageBienvenue('Frutiz' + i, { date: mercredi(9 + (i % 12)) }).replace(/@Frutiz\d+/, '@X'));
  assert.ok(vus.size >= 150, vus.size + ' mots distincts sur 200');
  assert.strictEqual(N.messageBienvenue('Remi', { date: mercredi(10) }), N.messageBienvenue('Remi', { date: mercredi(10) }));
  assert.strictEqual(N.messageBienvenue('Remi', { date: mercredi(10) }), N.messageBienvenue('remi', { date: mercredi(10) }).replace('@remi', '@Remi'), 'la graine ignore la casse');
  // Un autre jour : un autre mot (presque toujours) ; on le vérifie sur vingt pseudos.
  let differents = 0;
  for (let i = 0; i < 20; i++) if (N.messageBienvenue('Frutiz' + i, { date: mercredi(10) }) !== N.messageBienvenue('Frutiz' + i, { date: dimanche(10) })) differents++;
  assert.ok(differents >= 15, differents);
  // Toutes les ouvertures et tous les conseils finissent par sortir.
  const tout = Array.from({ length: 400 }, (_, i) => N.messageBienvenue('F' + i, { date: mercredi(i % 24) })).join('\n');
  for (const o of N.OUVERTURES) assert.ok(tout.indexOf(o('@F').split('@F')[0].slice(0, 12)) >= 0 || tout.indexOf(o('@F').split('@F')[1].slice(0, 12)) >= 0, o('@F'));
  for (const c of N.CONSEILS) assert.ok(tout.indexOf(c()) >= 0, c());
});

test('le clin d’œil suit l’heure de Paris et le week-end ; le parrain et le rang rond sont cités quand ils existent', () => {
  const tirageFixe = (...v) => { let i = 0; return () => v[(i++) % v.length]; };
  // Le tirage [0, 0.1, …] : ouverture 0, clin d'œil oui (0 < 0.4), conseil oui.
  const nuit = N.messageBienvenue('Remi', { date: mercredi(3), tirage: tirageFixe(0) });
  assert.ok(N.MOMENTS.nuit.some((f) => nuit.indexOf(f()) >= 0), nuit);
  const matin = N.messageBienvenue('Remi', { date: mercredi(8), tirage: tirageFixe(0) });
  assert.ok(N.MOMENTS.matin.some((f) => matin.indexOf(f()) >= 0), matin);
  const soir = N.messageBienvenue('Remi', { date: mercredi(21), tirage: tirageFixe(0) });
  assert.ok(N.MOMENTS.soir.some((f) => soir.indexOf(f()) >= 0), soir);
  // Le dimanche, le tirage à 0 choisit le week-end.
  const dim = N.messageBienvenue('Remi', { date: dimanche(15), tirage: tirageFixe(0) });
  assert.ok(dim.indexOf('dimanche') >= 0, dim);
  assert.deepStrictEqual(N.momentDe(dimanche(15)), { heure: 15, jour: 'dimanche', moment: 'apresmidi', weekend: true });
  // Le parrain est mentionné lui aussi ; le rang rond est dit, pas les autres.
  const p = N.messageBienvenue('Remi', { date: mercredi(10), parrain: 'Kiwi92', numero: 1500 });
  assert.deepStrictEqual(mentions(p).sort(), ['Kiwi92', 'Remi'], p);
  assert.ok(p.indexOf('1500') >= 0, p);
  const q = N.messageBienvenue('Remi', { date: mercredi(10), numero: 1501 });
  assert.ok(q.indexOf('1501') < 0, q);
  assert.deepStrictEqual(mentions(q), ['Remi']);
  // Sans rien : jamais de parrain ni de nombre inventé.
  for (let i = 0; i < 100; i++) {
    const m = N.messageBienvenue('Frutiz' + i, { date: mercredi(i % 24) });
    assert.doesNotMatch(m, /parrain|Filleul|Amené|nous l'envoie|Frutiz du parc, ça se fête|chiffre rond|tournis/, m);
  }
  assert.strictEqual(N.BOUILLE, '0o0000010000000000000000');
  assert.strictEqual(N.RUBRIQUE, 'Frutiz');
});

// ── Le serveur, avec Postgres ──────────────────────────────────────────────

const PORT = 3450;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_natacha';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc, dispo = false;

async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-de-test', XMLSOCKET_PORT: '5174', FRUTISCORE_PORT: '5175',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/forum/index')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const get = (url) => fetch(BASE + url).then((r) => r.json());
const inscrire = (username, extra) => fetch(BASE + '/api/auth/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(Object.assign({ username, password: 'secret123' }, extra || {})),
}).then((r) => r.json());

// Le sujet de Natacha, s'il existe : { topic, posts }.
async function sujet() {
  const idx = await get('/api/forum/index');
  const boards = [].concat(...(idx.categories || []).map((c) => c.boards || []));
  const board = boards.find((b) => b.name === N.RUBRIQUE);
  if (!board) return null;
  const b = await get('/api/forum/board/' + board.id);
  const t = (b.topics || []).find((x) => x.title === N.SUJET);
  if (!t) return null;
  const pages = await get('/api/forum/topic/' + t.id + '?page=last');
  return { topic: t, posts: pages.posts || [] };
}
async function attendreMessages(n) {
  for (let i = 0; i < 80; i++) {
    const s = await sujet();
    if (s && s.posts.length >= n) return s;
    await wait(250);
  }
  return sujet();
}

test('à l’inscription, Natacha ouvre le sujet dans « Frutiz » et y souhaite la bienvenue au nouveau', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  assert.strictEqual((await inscrire('PommeVerte')).ok, true);
  const s = await attendreMessages(2);
  assert.ok(s, 'le sujet « ' + N.SUJET + ' » existe dans « Frutiz »');
  assert.strictEqual(s.topic.author, N.NOM);
  assert.strictEqual(s.posts[0].content, N.INTRO);
  const mot = s.posts[s.posts.length - 1];
  assert.strictEqual(mot.author, N.NOM);
  assert.strictEqual(String(mot.bouille || '').slice(0, 24), N.BOUILLE);
  assert.ok(mot.content.indexOf('@PommeVerte') >= 0, mot.content);
  // Un deuxième Frutiz, parrainé : un autre mot, qui le mentionne lui et son parrain.
  assert.strictEqual((await inscrire('Kiwi92', { parrain: 'pommeverte' })).ok, true);
  const s2 = await attendreMessages(3);
  const mot2 = s2.posts[s2.posts.length - 1];
  assert.ok(mot2.content.indexOf('@Kiwi92') >= 0, mot2.content);
  assert.ok(mot2.content.indexOf('@PommeVerte') >= 0, 'le parrain : ' + mot2.content);
  assert.notStrictEqual(mot2.content, mot.content);
  // Rien d'autre n'est posté sans inscription.
  await wait(500);
  assert.strictEqual((await sujet()).posts.length, 3);
});
