'use strict';
/*
 * LES NOTES DE CHAMPIONNAT, TENUES PAR LE SERVEUR.
 *
 * La note d'Elo de départ des championnats (Grapiz, Frutibandas, Frutisnake)
 * se lisait dans un slot de la fruticarte que le navigateur peut écrire. Elle
 * vit désormais dans notes_championnat, écrite après chaque partie classée ;
 * le slot n'en est plus qu'une copie. On le vérifie de bout en bout sur
 * Frutisnake, avec la base (il faut un redémarrage : le salon garde la fiche
 * en mémoire une fois lue) :
 *   · une partie classée écrit la note du serveur ;
 *   · un slot retouché ensuite (n'importe quel chemin de côté) ne change rien
 *     à la note : le serveur garde la sienne, réécrit le slot, et le signale ;
 *   · la PREMIÈRE fois, sans note tenue, la fiche du slot est reprise — et
 *     signalée si elle ne dit pas la même chose que le classement.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = 3923;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-notes-championnat';
const DB = process.env.TEST_DATABASE_URL_NOTES || 'postgres://postgres@127.0.0.1:5433/frutiparc_notes_championnat';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-notes-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JSN = { 'Content-Type': 'application/json' };
const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml); return m ? m[1] : null; };

let proc = null, dispo = false;
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
async function sql(q, params) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5925', FRUTISCORE_PORT: '5926', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'notes_championnat'`)).length) {
          await wait(1500);     // le démarrage charge les notes après l'ouverture des sockets
          return;
        }
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
async function arreter() {
  if (!proc) return;
  const fini = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGKILL');
  await fini;
  proc = null;
}
before(async () => {
  dispo = await baseNeuve();
  if (dispo) await demarrer();
});
after(async () => {
  await arreter();
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

async function sidPour(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: JSN, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSN, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
// La socket du jeu : <k> puis <sb a="hello"> (cf. snakeBattle.test.js).
function connecter(pseudo, sid) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    const recus = [];
    let tampon = '';
    ws.on('message', (data) => {
      tampon += data.toString();
      const bouts = tampon.split('\0'); tampon = bouts.pop();
      for (const b of bouts) if (b.trim()) recus.push(b.trim());
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(`<k l="${pseudo}" s="${sid}" />\0`);
      setTimeout(() => {
        ws.send(`<sb a="hello" n="${pseudo}" />\0`);
        setTimeout(() => resolve({
          envoyer: (s) => ws.send(s + '\0'),
          dernier: (e) => recus.filter((m) => m.indexOf('<sb') === 0 && attr(m, 'e') === e).pop() || null,
          fermer: () => ws.close(),
        }), 400);
      }, 300);
    });
  });
}
const noteAuSalon = (salon, pseudo) => {
  const m = new RegExp(`u="${pseudo}" [^>]*no="(\\d+)"`).exec(salon || '');
  return m ? Number(m[1]) : null;
};
async function alertes(pseudo) {
  const j = await (await fetch(`${BASE}/api/admin/triche/alertes?username=${pseudo}`, { headers: { 'x-admin-key': CLE } })).json();
  return j.alertes || [];
}
const fiche = (note) => JSON.stringify({ linit: true, l: [3, 0, 0], ls: [note, 1000, note] });
async function poserSlot(pseudo, data) {
  const [u] = await sql('SELECT id FROM users WHERE LOWER(username) = $1', [pseudo]);
  await sql(`INSERT INTO fruti_slots (user_id, game, slot_id, data) VALUES ($1, 'snake3', 2, $2)
             ON CONFLICT (user_id, game, slot_id) DO UPDATE SET data = $2`, [u.id, data]);
  return u.id;
}

test('la note vient du serveur, pas du slot ; la première fois, le slot est repris', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  // 1. Une partie classée : kiwi gagne par forfait, 1024 contre 976.
  const [sa, sb] = [await sidPour('kiwi'), await sidPour('mangue')];
  await sidPour('vieux');            // un joueur d'avant, qui n'a qu'un slot
  const A = await connecter('kiwi', sa);
  const B = await connecter('mangue', sb);
  A.envoyer('<sb a="seek" />');
  await wait(300);
  B.envoyer('<sb a="seek" />');
  await wait(700);
  assert.ok(A.dernier('start'), 'la partie part');
  B.envoyer('<sb a="part" />');
  await wait(800);
  A.fermer(); B.fermer();
  const tenues = await sql(`SELECT username, jeu, note, origine FROM notes_championnat ORDER BY username`);
  assert.deepStrictEqual(tenues.map((r) => [r.username, r.jeu, r.note, r.origine]),
    [['kiwi', 'snake3', 1024, 'partie'], ['mangue', 'snake3', 976, 'partie']]);

  // 2. Serveur arrêté, on retouche les slots par la base — ce qu'un chemin de
  // côté aurait pu faire avant la liste blanche (ou un import mal venu).
  await arreter();
  const idKiwi = await poserSlot('kiwi', fiche(2900));
  // Le joueur d'avant : un slot, un classement qui ne dit pas la même chose,
  // et aucune note tenue — c'est la reprise.
  const idVieux = await poserSlot('vieux', fiche(1300));
  await sql(`INSERT INTO scores (user_id, ranking_id, score, data) VALUES ($1, 'snake3_battle', 1250, '')`, [idVieux]);
  await demarrer();

  // 3. kiwi revient : c'est la note du serveur qui vaut.
  const A2 = await connecter('kiwi', await sidPour('kiwi'));
  assert.strictEqual(noteAuSalon(A2.dernier('lobby'), 'kiwi'), 1024, 'la note du serveur, pas les 2900 du slot');
  A2.fermer();
  await wait(400);
  const ak = (await alertes('kiwi')).find((a) => a.type === 'elo_slot');
  assert.ok(ak, 'l’écart part en alerte');
  assert.deepStrictEqual([ak.jeu, ak.gravite], ['snake3', 'suspect']);
  assert.match(ak.resume, /le slot porte la note 2900, le serveur tient 1024/);
  const [slotKiwi] = await sql(`SELECT data FROM fruti_slots WHERE user_id = $1 AND game = 'snake3' AND slot_id = 2`, [idKiwi]);
  assert.strictEqual(JSON.parse(slotKiwi.data).ls[0], 1024, 'le slot est remis d’accord');

  // 4. vieux : sa fiche est reprise telle quelle, et l'écart au classement signalé.
  const V = await connecter('vieux', await sidPour('vieux'));
  assert.strictEqual(noteAuSalon(V.dernier('lobby'), 'vieux'), 1300, 'la fiche du slot est reprise');
  V.fermer();
  await wait(400);
  const [rv] = await sql(`SELECT note, origine FROM notes_championnat WHERE username = 'vieux' AND jeu = 'snake3'`);
  assert.deepStrictEqual([rv.note, rv.origine], [1300, 'reprise']);
  const av = (await alertes('vieux')).find((a) => a.type === 'elo_slot');
  assert.ok(av, 'la reprise d’un slot qui contredit le classement est signalée');
  assert.match(av.resume, /reprise du slot : 1300, alors que le classement dit 1250/);
});
