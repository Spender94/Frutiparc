'use strict';
/*
 * LES ÉMOTES EN MODE BLEU.
 *
 * « Abilité de faire les emotes (lol, regarde, etc) quand /blueon est actif. »
 *
 * Le mode bleu (/blueon, animateurs) est tenu par le SERVEUR : le light, le
 * bureau et le SWF envoient tous la ligne telle quelle, en t="m". Dans le
 * `case 'send'`, la branche du mode bleu était testée AVANT la détection
 * d'émote : « lol » partait en t="c" comme une phrase — « lol » en bleu gras,
 * pas de « pseudo éclate de rire », pas de bouille qui rit, et ce sur les
 * trois clients à la fois. L'émote est désormais relevée avant, et le mode
 * bleu la laisse passer ; une phrase ordinaire reste bleue.
 *
 * Partie « serveur vivant » : PostgreSQL de test (port 5433) ; sinon sautée.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('serveur : l\'émote est relevée AVANT le mode bleu, qui la laisse passer', () => {
  const releve = SRV.indexOf("const emo = (type === 'm') ? detectChatEmote(unescapeXml(text)) : null;");
  const bleu = SRV.indexOf('if (!emo && blueModeUsers.has(client.username) && isAnimator(client.username)) {');
  const emote = SRV.indexOf('    if (emo) {\n      const who = getDisplayName(client.username);');
  assert.ok(releve > 0, 'la détection d\'émote existe');
  assert.ok(bleu > releve, 'le mode bleu vient après, et cède à l\'émote');
  assert.ok(emote > bleu, 'la diffusion de l\'émote suit');
  assert.strictEqual(SRV.split("detectChatEmote(unescapeXml(text))").length - 1, 1,
    'une seule détection (pas de second `const emo`)');
});

// LES DEUX TABLES NE FONT QU'UNE. En mode bleu, c'est la table du SERVEUR qui
// décide si un mot est une émote ; hors mode bleu, c'est celle du light. Le
// light avait reçu beurk, jutsu, tousse, gumm, clin, bisou, 67 et confus ; le
// serveur, non : « tousse » tapé en /blueon partait en ligne bleue. On rejoue
// ici les deux listes d'`add(…)` et on les compare entrée par entrée.
function tableDe(source, debut) {
  const i = source.indexOf(debut);
  assert.ok(i >= 0, 'table introuvable : ' + debut);
  const corps = source.slice(source.indexOf('(function () {', i) + '(function () {'.length, source.indexOf('})();', i))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*function add\(.*$/m, '');
  const table = {};
  // eslint-disable-next-line no-new-func
  new Function('add', corps)((anim, label, toks) => { for (const t of toks) table[t] = anim + ' / ' + label; });
  return table;
}

test('serveur et light reconnaissent exactement les mêmes émotes', () => {
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
  const client = tableDe(LIGHT, 'var EMOTE_MAP = {};');
  const serveur = tableDe(SRV, 'const CHAT_EMOTES = {};');
  assert.ok(Object.keys(client).length > 40, 'la table du light est bien lue');
  assert.deepStrictEqual(serveur, client);
});

// ── Le serveur vivant ───────────────────────────────────────────────────────

// (Pas 3659 : fetch refuse ce port, qu'il range parmi les ports « dangereux ».)
const PORT = 3663;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-emote-bleu';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_emotebleu';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null, dispo = false;

async function baseNeuve() {
  let Client;
  try { ({ Client } = require(path.join(ROOT, 'node_modules', 'pg'))); } catch { return false; }
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
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5663', FRUTISCORE_PORT: '5664',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    // Le serveur répond avant que le schéma d'une base neuve soit posé : on
    // attend aussi sa dernière table (comme test/animateurs.test.js).
    try {
      if ((await fetch(BASE + '/do/prefdef')).ok) {
        const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'kikooz_gifts'`);
        await c.end();
        if (rows.length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session pour ' + pseudo);
  return j.sid;
}

async function client(pseudo, sid, light) {
  const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const trames = [];
  let tampon = '';
  ws.on('message', (d) => {
    tampon += d.toString('utf8');
    const bouts = tampon.split('\0');
    tampon = bouts.pop();
    for (const b of bouts) if (b.trim()) trames.push(b.trim());
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sid}"${light ? ' lc="1"' : ''} />\0`);
  const c = {
    trames,
    dire: (texte) => ws.send(`<t g="pomme" t="m" p="">${texte}</t>\0`),
    attendre: async (pred, quoi, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(-900)}`);
    },
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  ws.send('<o g="pomme" />\0');
  await c.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'liste du salon');
  return c;
}

test('serveur vivant : en /blueon, « lol » et « regarde » sont des émotes ; une phrase reste bleue', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const ANIM = 'animbleu' + RUN, BUREAU = 'swfbleu' + RUN;
  const sidAnim = await inscrire(ANIM);
  // Le schéma d'une base neuve finit parfois de se poser après le premier
  // accès : on redemande le rôle quelques fois.
  let r;
  for (let i = 0; i < 40; i++) {
    r = await fetch(`${BASE}/api/admin/users/${ANIM}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
      body: JSON.stringify({ is_animator: true }),
    });
    if (r.status === 200) break;
    await wait(250);
  }
  assert.strictEqual(r.status, 200, 'rôle d\'animateur');
  const anim = await client(ANIM, sidAnim, true);                  // le light
  const swf = await client(BUREAU, await inscrire(BUREAU), false);  // le SWF du bureau
  try {
    anim.dire('/blueon');
    await anim.attendre((x) => x.includes('Mode bleu activé'), 'le mode bleu');

    for (const [mot, anime, phrase] of [['lol', 'mdr', 'éclate de rire'], ['regarde', 'regard', 'regarde ailleurs']]) {
      swf.trames.length = 0;
      anim.dire(mot);
      const e = await swf.attendre((x) => x.includes(`e="${anime}"`), `l'émote « ${mot} »`);
      assert.match(e, /^<t [^>]*\bu="admin" t="m"/, `« ${mot} » : une ligne d'action, pas une ligne bleue`);
      assert.match(e, new RegExp(`el="${phrase}"`));
      assert.match(e, new RegExp(`eu="${ANIM}"`, 'i'), 'la bouille de l\'animateur rejoue l\'émote');
      assert.ok(!swf.trames.some((x) => x.includes('t="c"') && x.includes(`>${mot}<`)),
        `« ${mot} » ne part plus en bleu gras`);
    }

    // Le mode bleu, lui, tient toujours pour une phrase.
    swf.trames.length = 0;
    anim.dire('bonsoir le salon');
    const bleu = await swf.attendre((x) => x.includes('bonsoir le salon'), 'la phrase bleue');
    assert.match(bleu, /t="c"/, 'une phrase ordinaire reste en mode bleu');
    assert.ok(!/\se="/.test(bleu));
  } finally { anim.fermer(); swf.fermer(); }
});
