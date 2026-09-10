'use strict';
/*
 * « CRÉER UN ÉVÈNEMENT ANNIVERSAIRE — chaque jour on doit être informé des
 *   Frutiz dont c'est l'anniversaire. Exclue la date définie par défaut à
 *   l'inscription pour éviter le spam. »
 *
 * Chaque matin à 9 h (Paris), le site diffuse un événement comme les autres :
 * la fenêtre « Évènements » de chacun, la trame des connectés, la
 * notification des absents.
 *
 * LES DEUX DATES PAR DÉFAUT SONT EXCLUES, et c'est tout l'enjeu : un compte
 * neuf naît avec le 15 mai 1990, un profil jamais rempli porte le 1er janvier
 * 2000. Sans ce filtre, ce sont des centaines de comptes qu'on fêterait le
 * même matin.
 *
 * Le serveur tourne ici SANS base : le chemin mémoire et le chemin SQL suivent
 * les mêmes règles, et c'est le premier qu'on éprouve (l'autre est la même
 * requête, écrite une fois).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3572;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-anniv';
const RUN = Date.now().toString(36).slice(-4);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5304', FRUTISCORE_PORT: '5305',
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
after(() => { if (proc) proc.kill('SIGKILL'); });

const HDR = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: HDR, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: HDR, body });
  const sid = (await r.json()).sid;
  assert.ok(sid, 'session de ' + pseudo);
  return sid;
}
// `do/smi` — l'enregistrement du profil d'époque : `d` porte la date de
// naissance. C'est par là qu'un frutiz corrige la date posée à l'inscription.
const naitLe = (sid, date) => fetch(`${BASE}/do/smi?sid=${sid}&d=${date}&sx=M&ci=Paris&fn=&ln=&co=1&rg=1`);
const anniversaires = async () => (await (await fetch(BASE + '/api/admin/anniversaires', { headers: HDR })).json());
const annoncer = async () => (await (await fetch(BASE + '/api/admin/anniversaires/annoncer', { method: 'POST', headers: HDR })).json());
const evenements = async (sid) => (await (await fetch(`${BASE}/api/light/events?sid=${sid}`)).json()).events;

// Aujourd'hui à Paris, mais d'une AUTRE année : c'est le jour et le mois qui
// font l'anniversaire, jamais l'année.
const jourParis = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const [, MM, JJ] = jourParis.split('-');
const NE_AUJOURDHUI = `1988-${MM}-${JJ}`;
const NE_DEMAIN = (() => {
  const d = new Date(jourParis + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return '1988-' + d.toISOString().substring(5, 10);
})();

const FETE = 'fete' + RUN, FETE2 = 'fetebis' + RUN, DEFAUT = 'defaut' + RUN, DEMAIN = 'demain' + RUN;
const S = {};

test('le site fête ceux du jour, et personne d’autre', async () => {
  S.fete = await inscrire(FETE);
  S.fete2 = await inscrire(FETE2);
  S.defaut = await inscrire(DEFAUT);
  S.demain = await inscrire(DEMAIN);
  assert.equal((await naitLe(S.fete, NE_AUJOURDHUI)).status, 200);
  assert.equal((await naitLe(S.fete2, NE_AUJOURDHUI)).status, 200);
  assert.equal((await naitLe(S.demain, NE_DEMAIN)).status, 200);
  // `defaut` garde la date posée à l'inscription : le 15 mai 1990.
  const liste = await anniversaires();
  assert.equal(liste.ok, true);
  assert.deepEqual(liste.noms.slice().sort(), [FETE, FETE2].sort(),
    'les deux du jour, et eux seuls : ' + JSON.stringify(liste.noms));
  assert.ok(!liste.noms.includes(DEMAIN), 'celui de demain attendra demain');
  assert.equal(liste.dejaAnnonce, false);
  assert.match(liste.message, /^🎂 Aujourd'hui, c'est l'anniversaire de .* et .*\. Joyeux anniversaire à eux !$/);
});

test('la phrase se dit bien : l’élision, l’accord, et la liste qui ne déborde pas', () => {
  // Une fonction pure, éprouvée hors du serveur : c'est le texte que tout le
  // parc lira au réveil.
  const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const src = /const ANNIV_MARQUE[\s\S]*?\nfunction annivMessage\(noms\) \{[\s\S]*?\n\}/.exec(SERVEUR)[0];
  const bac = { ANNIV_NOMS_MAX: 12 };
  require('node:vm').createContext(bac);
  require('node:vm').runInContext(src + '\nthis.annivMessage = annivMessage;', bac);
  const m = bac.annivMessage;
  assert.equal(m(['Bob']), '🎂 Aujourd\'hui, c\'est l\'anniversaire de Bob. Joyeux anniversaire !');
  assert.equal(m(['Alice']), '🎂 Aujourd\'hui, c\'est l\'anniversaire d\'Alice. Joyeux anniversaire !',
    'devant une voyelle, on élide');
  assert.equal(m(['Bob', 'Carol']), '🎂 Aujourd\'hui, c\'est l\'anniversaire de Bob et Carol. Joyeux anniversaire à eux !');
  assert.equal(m(['Bob', 'Carol', 'Zoé']), '🎂 Aujourd\'hui, c\'est l\'anniversaire de Bob, Carol et Zoé. Joyeux anniversaire à eux !');
  // Quinze frutiz nés le même jour : on en nomme douze et on compte les autres.
  const quinze = Array.from({ length: 15 }, (_, i) => 'F' + (i + 1));
  const long = m(quinze);
  assert.ok(long.includes('F12 et 3 autres frutiz'), long);
  assert.ok(!long.includes('F13'), 'les trois derniers ne sont pas nommés');
});

test('la date posée à l’inscription ne fête personne', async () => {
  // Le 15 mai 1990 (inscription) et le 1er janvier 2000 (profil jamais rempli)
  // : deux dates que des centaines de comptes portent sans les avoir choisies.
  for (const defaut of ['1990-05-15', '2000-01-01']) {
    assert.equal((await naitLe(S.defaut, defaut)).status, 200);
    const liste = await anniversaires();
    assert.ok(!liste.noms.includes(DEFAUT), defaut + ' : exclue');
  }
  // La même date, décalée d'un jour, redevient un vrai anniversaire — c'est
  // la porte de sortie pour qui est vraiment né ce jour-là.
  assert.equal((await naitLe(S.defaut, NE_AUJOURDHUI)).status, 200);
  assert.ok((await anniversaires()).noms.includes(DEFAUT), 'une vraie date, elle, compte');
});

test('l’annonce part une fois, et arrive chez tout le monde', async () => {
  const r = await annoncer();
  assert.equal(r.annonce, true, JSON.stringify(r));
  assert.equal(r.noms.length, 3, 'les trois du jour');
  // L'événement est dans la fenêtre « Évènements » de chacun — y compris de
  // celui qui ne fête rien.
  const evts = await evenements(S.demain);
  assert.ok(evts.some((e) => e.text === r.message), 'chez celui qui ne fête rien : '
    + JSON.stringify(evts.map((e) => e.text)));
  assert.ok((await evenements(S.fete)).some((e) => e.text === r.message), 'et chez le fêté');
  // …et dans la liste des événements poussés de l'admin.
  const pousses = await (await fetch(BASE + '/api/admin/broadcast', { headers: HDR })).json();
  assert.ok(pousses.events.some((e) => e.message === r.message));
  // DEUX FOIS LE MÊME MATIN, NON : le garde-fou du jour tient.
  assert.equal((await anniversaires()).dejaAnnonce, true);
  const avant = (await evenements(S.demain)).length;
  const bis = await annoncer();
  assert.equal(bis.annonce, true, 'le bouton de l’admin, lui, force l’annonce');
  assert.equal((await evenements(S.demain)).length, avant + 1);
});

test('un matin sans anniversaire est un matin silencieux', () => {
  const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(SERVEUR, /if \(!noms\.length\) return \{ annonce: false, raison: 'personne', noms \};/);
  // Le rendez-vous : 9 h, heure de Paris, une fois par jour.
  assert.match(SERVEUR, /const ANNIV_HEURE = 9;/);
  assert.match(SERVEUR, /if \(h < ANNIV_HEURE\) return;/);
  assert.match(SERVEUR, /if \(annivRdv\.cle === parisDayKey\(maintenant\)\) return;/);
  assert.match(SERVEUR, /setInterval\(\(\) => \{\s*\n\s*try \{ tickAnniversaires\(\); \}/);
  // La preuve durable qu'un jour est fait : la marque, relue dans les journaux
  // — la mémoire, elle, s'efface au redémarrage.
  assert.match(SERVEUR, /const ANNIV_MARQUE = '🎂';/);
  assert.match(SERVEUR, /if \(await db\.evenementSiteDuJour\(ANNIV_MARQUE \+ '%', jour\)\)/);
  // Les deux dates par défaut, nommées une seule fois.
  assert.match(SERVEUR, /const ANNIV_DATES_PAR_DEFAUT = \['1990-05-15', '2000-01-01'\];/);
  // Le décor ne fête rien.
  assert.match(SERVEUR, /\.filter\(\(r\) => !NPC_USERNAMES\.has\(String\(r\.username\)\.toLowerCase\(\)\)\)/);
});
