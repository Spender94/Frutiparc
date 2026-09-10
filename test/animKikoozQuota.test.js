// Quota hebdomadaire de dons des animateurs (/meskikooz).
//
// Un animateur distribue des kikooz avec /don, dans la limite d'une allocation
// remise à zéro chaque lundi. La commande qui la consulte — /meskikooz, alias
// /mykikooz et /kikoozrestants — interroge /do/give SANS paramètre. Le serveur
// n'avait pas ce cas : la requête tombait dans la validation des paramètres et
// repartait en refus, si bien que main.swf affichait « MyKikooz error » et que
// l'animateur n'avait aucun moyen de savoir ce qu'il lui restait.
//
// Ce test attribue vraiment le rôle (donc une vraie base), fait distribuer des
// kikooz par le chat, et vérifie que le reste annoncé suit. Il vérifie aussi que
// la question est refusée à qui n'a aucun pouvoir de don — sans quoi n'importe
// quel joueur lirait l'allocation du staff.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3444;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-quota-anim';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_quota';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ANIM = 'animquota';
const CIBLE = 'ciblequota';
const SIMPLE = 'simplequota';

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
  } catch { try { await admin.end(); } catch {} return false; }
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5164', FRUTISCORE_PORT: '5165',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  // Le serveur répond en HTTP avant d'avoir fini ses migrations : on attend que
  // la table des comptes existe, sinon l'inscription tombe dessus.
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'users'`);
        await c.end();
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const attr = (xml, n) => {
  const m = new RegExp(`\\b${n}="([^"]*)"`).exec(xml);
  return m ? m[1] : '';
};

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}

async function client(pseudo, sid) {
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
  ws.send(`<k l="${pseudo}" s="${sid}" lc="1" />\0`);
  const c = {
    pseudo, sid, ws, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    attendre: async (pred, quoi, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 700)}`);
    },
    fermer: () => { try { ws.close(); } catch {} },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}

// L'appel exact que fait /meskikooz : /do/give sans le moindre paramètre.
const quota = (sid) => fetch(`${BASE}/do/give?sid=${encodeURIComponent(sid)}`).then((r) => r.text());

test('le quota hebdomadaire répond, et suit les dons faits au chat', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire(ANIM);
  const sidCible = await inscrire(CIBLE);

  // On attribue vraiment le rôle : c'est lui qui ouvre /don ET la question.
  const pose = await fetch(`${BASE}/api/admin/users/${ANIM}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ is_animator: true }),
  });
  assert.equal(pose.status, 200, 'rôle d\'animateur attribué');

  const depart = await quota(sidAnim);
  assert.equal(attr(depart, 'k'), '0', `la question aboutit (${depart})`);
  assert.equal(attr(depart, 'p'), '1', 'l\'animateur EST plafonné');
  const restant = Number(attr(depart, 'a'));
  assert.ok(restant > 0, `allocation de départ non nulle (${restant})`);

  // Un don réel, par le chemin du jeu : la commande /don, dans un salon.
  const anim = await client(ANIM, sidAnim);
  const cible = await client(CIBLE, sidCible);
  try {
    anim.envoyer('<o g="pomme" />');
    cible.envoyer('<o g="pomme" />');
    await wait(600);
    anim.envoyer(`<t g="pomme" t="m" p="">/don ${CIBLE} 300</t>`);
    await anim.attendre((t) => /offre 300 kikooz/.test(t), 'annonce du don au salon');

    const apres = await quota(sidAnim);
    assert.equal(attr(apres, 'k'), '0', 'la question aboutit toujours');
    assert.equal(Number(attr(apres, 'a')), restant - 300,
      'le reste annoncé a bien baissé du montant distribué');
  } finally { anim.fermer(); cible.fermer(); }
});

test('un joueur ordinaire n\'a pas de quota à consulter', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await inscrire(SIMPLE);
  const rep = await quota(sid);
  assert.equal(attr(rep, 'k'), '2', `refusé faute de pouvoir de don (${rep})`);
});

test('la question de quota ne se confond pas avec un don', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sid = await inscrire(SIMPLE);
  // Un don auquel il manque un paramètre reste un don MAL FORMÉ (code 1), pas une
  // question de quota : sans quoi « /donne 5 » répondrait une allocation.
  const partiel = await fetch(`${BASE}/do/give?sid=${sid}&k=5`).then((r) => r.text());
  assert.equal(attr(partiel, 'k'), '1', `don incomplet refusé (${partiel})`);
  const sansMontant = await fetch(`${BASE}/do/give?sid=${sid}&u=quelquun`).then((r) => r.text());
  assert.equal(attr(sansMontant, 'k'), '1', `don sans montant refusé (${sansMontant})`);
});
