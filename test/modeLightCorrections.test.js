/*
 * Les corrections du mode light qui se jouent AU SERVEUR — vrai serveur, vraie
 * base, vrais clients de chat.
 *
 * 1. LA LISTE NOIRE « ne fonctionnait pas ». D'époque elle ne vivait que dans
 *    le client (openFunctions.as, chooseInviteBehavior) ; le light n'a jamais
 *    eu cette logique. Le serveur la tient désormais : discussion privée et
 *    invitation refusées, courrier dans la Boîte noire sans sonnerie.
 * 2. L'HISTORIQUE KIKOOZ ne vivait qu'en mémoire — chaque redémarrage
 *    l'effaçait — et les dons de l'animation (/don) n'y avaient que le nœud
 *    « obtenus par ». Il est en base, relu à l'hydratation, reconstitué depuis
 *    le registre des dons s'il est vide, et l'admin qui crédite y laisse aussi
 *    sa ligne.
 * 3. L'IA DE SWAPOU : un score joué avec l'analyse en partie ne va dans aucun
 *    classement — il se range pour l'admin.
 * 4. Les questions à 60 kikooz s'importent en JSON, au format des quizz.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3471;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-corrections-light';
const DB = process.env.TEST_DATABASE_URL_LIGHT || 'postgres://postgres@127.0.0.1:5433/frutiparc_light_corr';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function lancer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5218', FRUTISCORE_PORT: '5219',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name IN ('kikooz_log', 'swapou_ia_scores')`);
        await c.end();
        if (rows.length === 2) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
async function arreter() {
  if (!proc) return;
  const p = proc; proc = null;
  await new Promise((r) => { p.once('exit', r); p.kill('SIGKILL'); });
  await wait(400);
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  await lancer();
});
after(() => arreter());

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}
const entetes = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const patchUser = (pseudo, champs) => fetch(`${BASE}/api/admin/users/${pseudo}`, {
  method: 'PATCH', headers: entetes, body: JSON.stringify(champs),
});
const admin = (chemin) => fetch(BASE + chemin, { headers: { 'x-admin-key': CLE } }).then((r) => r.json());
const json = (chemin) => fetch(BASE + chemin, { cache: 'no-store' }).then((r) => r.json());

// `lc="1"` est la marque du client Light ; le bureau (main.swf) ne l'envoie pas.
async function client(pseudo, sid, light = true) {
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
    pseudo, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    attendre: async (pred, quoi, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 900)}`);
    },
    fermer: () => { try { ws.close(); } catch {} },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}
const clientBureau = (pseudo, sid) => client(pseudo, sid, false);

// ── 1. La liste noire ─────────────────────────────────────────────────────

test('la liste noire ferme les discussions privées et les invitations, et fait taire le courrier', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidListe = await inscrire('listenoire');
  const sidNoir = await inscrire('indesirable');
  const sidAmi = await inscrire('amiliste');

  // La mise en liste noire, par la route de la fiche (bouton « fiche-noire »).
  const mk = await fetch(`${BASE}/ff/mk?sid=${sidListe}&folder=blacklist&t=contact&u=indesirable`).then((r) => r.text());
  assert.match(mk, /f="blacklist"/, 'l\'entrée est posée');
  assert.match(mk, /indesirable@frutiparc\.com/, 'sous forme d\'adresse, comme d\'époque');

  const liste = await client('listenoire', sidListe);
  const noir = await client('indesirable', sidNoir);
  const noirBureau = await clientBureau('indesirable', sidNoir);
  const ami = await client('amiliste', sidAmi);
  try {
    // L'indésirable demande une discussion privée : refusée. Le light reçoit
    // son code (206) ; rien ne part chez l'autre.
    noir.envoyer('<r u="listenoire" r="q1" />');
    const r1 = await noir.attendre((x) => x.startsWith('<r') && x.includes('r="q1"'), 'réponse à la demande');
    assert.match(r1, /k="206"/, 'le light reçoit son code');
    await wait(300);
    assert.ok(!liste.trames.some((x) => x.startsWith('<s')), 'et aucune invitation ne part chez le bloqueur');

    // Le SWF, lui, lit « pas connecté » (201) — le seul refus qu'il sache rendre.
    noirBureau.envoyer('<r u="listenoire" r="q2" />');
    const r2 = await noirBureau.attendre((x) => x.startsWith('<r') && x.includes('r="q2"'), 'réponse au bureau');
    assert.match(r2, /k="201"/, 'le bureau lit « pas connecté »');

    // Un ami, lui, passe.
    ami.envoyer('<r u="listenoire" r="q3" />');
    const r3 = await ami.attendre((x) => x.startsWith('<r') && x.includes('r="q3"'), 'réponse à l\'ami');
    assert.ok(!/ k="/.test(r3), 'la discussion s\'ouvre');
    await liste.attendre((x) => x.startsWith('<s') && x.includes('u="amiliste"'), 'l\'invitation de l\'ami');

    // Une discussion que le BLOQUEUR ouvre lui-même avec l'indésirable
    // s'ouvre (chat.warnblacklist d'époque) — mais ce que l'indésirable y
    // écrit ne lui parvient pas ; lui, en revanche, peut écrire.
    liste.envoyer('<r u="indesirable" r="q4" />');
    const r4 = await liste.attendre((x) => x.startsWith('<r') && x.includes('r="q4"'), 'ouverture par le bloqueur');
    assert.ok(!/ k="/.test(r4));
    const g = /g="([^"]+)"/.exec(r4)[1];
    await noir.attendre((x) => x.startsWith('<s') && x.includes(`g="${g}"`), 'l\'indésirable est invité');
    liste.trames.length = 0; noir.trames.length = 0;
    noir.envoyer(`<t g="${g}" t="m" p="">coucou quand même</t>`);
    const refus = await noir.attendre((x) => x.includes('ne reçoit pas les messages privés'), 'le refus');
    assert.match(refus, /u="admin"/, 'en ligne système');
    await wait(400);
    assert.ok(!liste.trames.some((x) => x.includes('coucou quand même')), 'rien chez le bloqueur');
    liste.envoyer(`<t g="${g}" t="m" p="">je te vois</t>`);
    await noir.attendre((x) => x.includes('je te vois'), 'le bloqueur, lui, parle');

    // L'invitation dans un salon : l'indésirable invite le bloqueur — le
    // demandeur lit le refus d'époque, le bloqueur ne reçoit rien.
    noir.envoyer('<o g="poire" />');
    ami.envoyer('<o g="poire" />');
    await ami.attendre((x) => x.startsWith('<p') && x.includes('g="poire"'), 'userlist de poire');
    liste.trames.length = 0; noir.trames.length = 0;
    noir.envoyer('<ab u="listenoire" g="poire" r="i1" />');
    await noir.attendre((x) => x.includes('a refusé l\'invitation à rejoindre ce salon'), 'le refus d\'époque');
    await wait(300);
    assert.ok(!liste.trames.some((x) => x.startsWith('<ab')), 'aucune invitation chez le bloqueur');
    ami.envoyer('<ab u="listenoire" g="poire" r="i2" />');
    await liste.attendre((x) => x.startsWith('<ab') && x.includes('u="amiliste"'), 'l\'invitation de l\'ami passe');

    // Le courrier : Boîte noire, et pas de sonnerie.
    liste.trames.length = 0;
    const envoi = await fetch(`${BASE}/api/light/mail/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sidNoir, to: 'listenoire', subject: 'pub', body: 'achetez mes kikooz' }),
    }).then((r) => r.json());
    assert.equal(envoi.ok, true, 'l\'envoi part (l\'expéditeur ne sait rien)');
    await wait(400);
    assert.equal((await json(`/api/light/mail?sid=${sidListe}&folder=blackbox`)).mails.length, 1, 'dans la Boîte noire');
    assert.equal((await json(`/api/light/mail?sid=${sidListe}&folder=inbox`)).mails.length, 0, 'pas dans la boîte de réception');
    assert.ok(!liste.trames.some((x) => x.startsWith('<ax')), 'et pas de « nouveau courrier »');
    // D'un ami : boîte de réception, ET la sonnerie.
    await fetch(`${BASE}/api/light/mail/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sidAmi, to: 'listenoire', subject: 'salut', body: 'on se voit ce soir ?' }),
    });
    await liste.attendre((x) => x.startsWith('<ax') && x.includes('amiliste'), 'la sonnerie du courrier');
    assert.equal((await json(`/api/light/mail?sid=${sidListe}&folder=inbox`)).mails.length, 1);
  } finally { liste.fermer(); noir.fermer(); noirBureau.fermer(); ami.fermer(); }
});

// ── 2. L'Historique Kikooz ────────────────────────────────────────────────

test('les dons — animateur, admin — entrent dans l\'Historique Kikooz, et y restent après un redémarrage', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire('animhisto');
  assert.equal((await patchUser('animhisto', { is_animator: true })).status, 200);
  let sidJoueur = await inscrire('joueurhisto');
  const anim = await client('animhisto', sidAnim);
  const joueur = await client('joueurhisto', sidJoueur);
  try {
    anim.envoyer('<o g="pomme" />');
    joueur.envoyer('<o g="pomme" />');
    await joueur.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'userlist');
    anim.envoyer('<t g="pomme" t="m" p="">/don joueurhisto 50</t>');
    await joueur.attendre((x) => x.includes('50'), 'l\'annonce du don');
    await wait(600);
  } finally { anim.fermer(); joueur.fermer(); }

  const histo = (sid) => json(`/api/light/kikooz?sid=${sid}`).then((h) => h.events.map((e) => e.text));
  const dons = (l) => l.filter((x) => /offerts par/.test(x));
  let h = await histo(sidJoueur);
  assert.equal(h[0], '50 kikooz offerts par animhisto.', 'le nœud <a> de l\'animation, en tête');
  // /ft/log, la façade du SWF, sert la même liste.
  const xml = await fetch(`${BASE}/ft/log?sid=${sidJoueur}`).then((r) => r.text());
  assert.match(xml, /<a t="[^"]+" k="50" f="animhisto"\/>/);

  // Un crédit posé par l'admin est un don comme un autre.
  const avant = Number((await admin('/api/admin/users/joueurhisto')).user.kikooz) || 0;
  assert.equal((await patchUser('joueurhisto', { kikooz: avant + 100 })).status, 200);
  await wait(300);
  h = await histo(sidJoueur);
  assert.equal(h[0], '100 kikooz offerts par l\'équipe Frutiparc.');
  assert.equal((await admin('/api/admin/users/joueurhisto')).user.kikooz, avant + 100, 'et le solde suit');

  // Le redémarrage : l'historique revient de la base.
  await arreter(); await lancer();
  sidJoueur = await inscrire('joueurhisto');
  h = await histo(sidJoueur);
  assert.deepEqual(dons(h), ['100 kikooz offerts par l\'équipe Frutiparc.', '50 kikooz offerts par animhisto.'],
    'rien ne s\'est perdu au redémarrage');

  // Un journal VIDE en base se reconstitue depuis le registre des dons : le
  // /don y est (source « enveloppe »), le crédit de l'admin, lui, n'y est pas.
  const c = new Client({ connectionString: DB });
  await c.connect();
  await c.query(`DELETE FROM kikooz_log WHERE user_id = (SELECT id FROM users WHERE username = 'joueurhisto')`);
  await c.end();
  await arreter(); await lancer();
  sidJoueur = await inscrire('joueurhisto');
  await wait(1000);
  h = await histo(sidJoueur);
  assert.deepEqual(dons(h), ['50 kikooz offerts par animhisto.'], 'le /don revient du registre');
});

// ── 3. L'IA de Swapou ─────────────────────────────────────────────────────

test('un score de Swapou joué avec l\'IA ne se classe pas — il se range pour l\'admin', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sid = await inscrire('joueuria');
  const option = (owned) => fetch(`${BASE}/api/admin/users/joueuria/game-feature`, {
    method: 'POST', headers: entetes, body: JSON.stringify({ feature: 'swapouAnalyse', owned }),
  });
  assert.equal((await option(true)).status, 200, 'l\'admin accorde l\'IA');
  const sauver = (score) => fetch(`${BASE}/api/saveScore`, {
    method: 'POST',
    body: new URLSearchParams({ sid, game: 'swapou2', m: '0', score: String(score), data: 'S0:' }),
  }).then((r) => r.json());

  const r1 = await sauver(4321);
  assert.equal(r1.ok, true);
  assert.equal(r1.iaNonClasse, true, 'le serveur le dit au jeu');
  assert.equal(r1.updated, false);
  await wait(300);
  const fiche = await admin('/api/admin/users/joueuria');
  assert.equal((fiche.iaScores || []).length, 1, 'rangé pour l\'admin');
  assert.equal(fiche.iaScores[0].score, 4321);
  assert.ok(!(fiche.scores && fiche.scores.swapou2_classic), 'et rien au classement');

  // Sans l'option, le score suit le chemin normal. (Un point, pas plus : le
  // fichier des scores est partagé par tous les serveurs d'essai, et un score
  // qui prendrait la tête d'un classement dérèglerait les tests des médailles.)
  assert.equal((await option(false)).status, 200);
  const r2 = await sauver(1);
  assert.equal(r2.ok, true);
  assert.equal(r2.iaNonClasse, undefined);
  await wait(300);
  assert.equal((await admin('/api/admin/users/joueuria')).iaScores.length, 1, 'pas de ligne IA pour une partie sans IA');
});

// ── 4. L'import des questions à 60 kikooz ─────────────────────────────────

test('les questions à 60 kikooz s\'importent en JSON, au format des quizz', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const post = (body) => fetch(`${BASE}/api/admin/kiloute/questions/import`, {
    method: 'POST', headers: entetes, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const r = await post([
    { q: 'Capitale de l\'Italie ?', a: ['Rome', 'rome'], r: 'Rome' },
    { question: 'Combien de pattes a une araignée ?', answers: '8;huit', reveal: '8' },
    { q: '', a: [] },
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 2, 'deux questions valides');
  assert.equal(r.body.errors.length, 1, 'la vide est ignorée, et dite');

  const liste = await admin('/api/admin/kiloute/questions');
  const rome = liste.find((q) => q.q === 'Capitale de l\'Italie ?');
  const pattes = liste.find((q) => q.q === 'Combien de pattes a une araignée ?');
  assert.ok(rome && pattes, 'dans le backlog quotidien');
  assert.deepEqual(rome.a, ['Rome', 'rome']);
  assert.equal(rome.r, 'Rome');
  assert.deepEqual(pattes.a, ['8', 'huit'], 'les alias question/answers/reveal sont lus');

  // { questions: [...] } aussi ; une question seule aussi ; un corps illisible, non.
  assert.equal((await post({ questions: [{ q: 'Bleu + jaune ?', a: 'vert' }] })).body.count, 1);
  assert.equal((await post({ q: 'Rouge + jaune ?', a: ['orange'] })).body.count, 1);
  assert.equal((await post({ foo: 1 })).status, 400);
});
