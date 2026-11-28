'use strict';
/*
 * LES PNJ DANS LA LANGUE DE CHACUN — des salons PARTAGÉS.
 *
 * L'étape d'après le chat (test/chatLangues.test.js) : les personnages du
 * parc parlent à chaque lecteur dans SA langue, dans le même salon. Ici, un
 * client light francophone (`la="fr"`) et un anglophone (`la="en"`) sur
 * pomme, et l'on vérifie, chaque ligne vue des deux côtés sous le même `mi` :
 *   · Gaspard : sa bienvenue (trois lignes), une question posée en anglais et
 *     une en français — chacun lit la réponse dans sa langue ;
 *   · Gromelin : la bricole qu'il confie au salon ;
 *   · MikeHorny : un quiz dont la question a sa version anglaise, posée à
 *     chacun dans sa langue — et une réponse ANGLAISE qui marque ;
 *   · le loup-garou : plusieurs phases (nuit, aube, jour, vote, soir, fin),
 *     le rôle secret et la vue JSON du mobile (t="lg") en anglais ;
 *   · le rejeu en anglais de tout cela, et après un redémarrage (la base de
 *     test, port 5433) ;
 *   · aucune ligne « non rejouable » au journal du serveur ;
 *   · en HTTP, les répliques de Gromelin dans la fenêtre des quêtes, en
 *     anglais pour un compte anglais.
 * Sans base, les cas qui demandent un animateur ou les quêtes sont sautés.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 5074;          // (pas 5060-5061 : ports SIP, que fetch refuse)
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-pnj-langues';
const DB = process.env.TEST_DATABASE_URL_PNJ || 'postgres://postgres@127.0.0.1:5433/frutiparc_pnjlangues';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null, avecBase = false;
let journal = '';

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

async function lancer() {
  const debut = journal.length;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: avecBase ? DB : '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5075', FRUTISCORE_PORT: '5076',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { journal += d; });
  proc.stderr.on('data', (d) => { journal += d; });
  for (let i = 0; i < 480; i++) {
    try {
      if ((await fetch(BASE + '/do/prefdef')).ok) {
        if (!avecBase) return;
        // Une base neuve : on attend aussi sa dernière table, et le semis des quiz.
        const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'kikooz_gifts'`);
        await c.end();
        if (rows.length && /Loaded \d+ quiz|Seeded default quiz/.test(journal.slice(debut))) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible : ' + journal.slice(-1500));
}
async function arreter() {
  if (!proc) return;
  const p = proc;
  proc = null;
  await new Promise((r) => { p.on('exit', r); p.kill('SIGKILL'); });
}

before(async () => {
  avecBase = await baseNeuve();
  await lancer();
});
after(async () => { await arreter(); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session pour ' + pseudo);
  return j.sid;
}
const admin = (url, corps, methode) => fetch(BASE + url, {
  method: methode || (corps ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
  body: corps ? JSON.stringify(corps) : undefined,
});
async function animateur(pseudo) {
  for (let i = 0; i < 40; i++) {
    const r = await admin(`/api/admin/users/${pseudo}`, { is_animator: true }, 'PATCH');
    if (r.status === 200) return true;
    await wait(250);
  }
  return false;
}

const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml.slice(0, xml.indexOf('>'))); return m ? m[1] : null; };
const corps = (xml) => xml.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, '');
const de = (qui) => (x) => /^<t /.test(x) && attr(x, 'u') === qui;

// Un client light, dans sa langue, sur pomme.
async function client(pseudo, sid, la) {
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
  ws.send(`<k l="${pseudo}" s="${sid}" lc="1" la="${la}" />\0`);
  const c = {
    trames,
    dire: (texte) => ws.send(`<t g="pomme" t="m" p="">${texte}</t>\0`),
    attendre: async (pred, quoi, ms = 8000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(-1500)}`);
    },
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  ws.send('<o g="pomme" />\0');
  await c.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'liste du salon');
  return c;
}
// Une même ligne, vue des deux côtés : même numéro.
function memeLigne(a, b) { assert.strictEqual(attr(a, 'mi'), attr(b, 'mi'), 'un seul message, un seul numéro'); }

const FR = 'franc' + RUN, EN = 'angl' + RUN;
let sidFr, sidEn, fr, en;

test('Gaspard accueille chaque nouveau : chacun lit la bienvenue dans sa langue', async () => {
  [sidFr, sidEn] = [await inscrire(FR), await inscrire(EN)];
  fr = await client(FR, sidFr, 'fr');
  en = await client(EN, sidEn, 'en');
  // Les deux sont nouveaux : chacun a sa bienvenue, que tout le salon entend.
  const g = de('Gaspard');
  const bfr = await fr.attendre((x) => g(x) && x.includes(`Bienvenue ${EN} ! Je suis Gaspard, l’hôte du parc.`), 'la bienvenue de l’anglophone, en français', 12000);
  const ben = await en.attendre((x) => g(x) && x.includes(`Welcome ${EN}! I'm Gaspard, your host in the park.`), 'sa bienvenue, en anglais', 12000);
  memeLigne(bfr, ben);
  assert.match(corps(ben), /here are \d+ kikooz as a welcome gift/);
  assert.match(corps(bfr), /voici \d+ kikooz de bienvenue/);
  assert.strictEqual(attr(ben, 'mn'), EN, 'adressée à lui');
  await en.attendre((x) => g(x) && x.includes('A few pointers: the apples at the top are the chat rooms'), 'les repères (en)', 15000);
  await fr.attendre((x) => g(x) && x.includes('Quelques repères : les pommes en haut sont les salons'), 'les repères (fr)', 15000);
  await en.attendre((x) => g(x) && x.includes('Got a question? Put @Gaspard in front of it'), 'la troisième ligne (en)', 15000);
  await fr.attendre((x) => g(x) && x.includes(`Bienvenue ${FR} !`), 'la bienvenue du francophone', 15000);
  await en.attendre((x) => g(x) && x.includes(`Welcome ${FR}!`), 'et la même en anglais', 15000);
});

test('Gaspard comprend une question anglaise et une française ; chacun lit la réponse dans sa langue', async () => {
  for (const c of [fr, en]) c.trames.length = 0;
  const g = de('Gaspard');
  en.dire('@Gaspard how do I earn kikooz?');
  const ren = await en.attendre((x) => g(x) && x.includes(`@${EN} Kikooz are the park's currency`), 'la réponse à la question anglaise (en)');
  const rfr = await fr.attendre((x) => g(x) && x.includes(`@${EN} Les kikooz sont la monnaie du parc`), 'la même, en français');
  memeLigne(rfr, ren);
  assert.strictEqual(attr(ren, 'mn'), EN);
  assert.ok(!fr.trames.some((x) => x.includes('park\'s currency')), 'le francophone ne lit pas l’anglais');
  await wait(2200);                 // et par salon toutes les deux secondes
  fr.dire('@Gaspard c’est quoi les quêtes de Gromelin ?');
  const qfr = await fr.attendre((x) => g(x) && x.includes(`@${FR} Chaque lundi, Gromelin te confie tes quêtes de la semaine`), 'la réponse à la question française (fr)');
  const qen = await en.attendre((x) => g(x) && x.includes(`@${FR} Every Monday, Gromelin hands you your quests for the week`), 'la même, en anglais');
  memeLigne(qfr, qen);
});

test('Gromelin confie sa bricole au salon : chacun l’entend ronchonner dans sa langue', async (t) => {
  if (!avecBase) return t.skip('les quêtes demandent la base de test (port 5433)');
  for (const c of [fr, en]) c.trames.length = 0;
  const r = await (await admin('/api/admin/quetes/gromelin', { username: EN, cle: 'grom-salons' })).json();
  assert.ok(r.ok, JSON.stringify(r));
  const g = de('Gromelin');
  const nen = await en.attendre((x) => g(x) && x.includes(`${EN}. Yes, you. Come here.`), 'Gromelin le nomme (en)', 15000);
  const nfr = await fr.attendre((x) => g(x) && x.includes(`${EN}. Oui, toi. Approche.`), 'Gromelin le nomme (fr)', 15000);
  memeLigne(nfr, nen);
  assert.strictEqual(attr(nen, 'mn'), EN, 'la ligne s’adresse à lui');
  await en.attendre((x) => g(x) && x.includes('I\'ve got a little job for you: “') && x.includes('kikooz if it\'s done before Sunday midnight.'), 'la bricole (en)', 15000);
  await fr.attendre((x) => g(x) && x.includes('J\'ai une bricole pour toi : « ') && x.includes('avant dimanche minuit.'), 'la bricole (fr)', 15000);
  await en.attendre((x) => g(x) && x.includes(`It's in your quest log, ${EN}. Don't make me regret it.`), 'le dernier mot (en)', 15000);
});

test('la fenêtre des quêtes : Gromelin parle anglais à un compte anglais, français à un compte français', async (t) => {
  if (!avecBase) return t.skip('les quêtes demandent la base de test (port 5433)');
  const r = await fetch(BASE + '/api/light/langue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: sidEn, lang: 'en' }) });
  assert.strictEqual(r.status, 200);
  const ee = await (await fetch(`${BASE}/api/quetes/etat?sid=${sidEn}`)).json();
  assert.ok(ee.acces && ee.messages.length, JSON.stringify(ee).slice(0, 300));
  const tout = ee.messages.join('\n');
  assert.ok(/(cut to fit you|your size|made to measure|for the week|New week, new quests|I don't know you yet)/.test(tout), tout);
  assert.ok(!/semaine|quêtes|bricole|Je ne te connais/.test(tout), 'rien de français : ' + tout);
  // La bricole confiée au salon, rappelée dans la fenêtre.
  assert.ok(ee.messages.some((m) => /little job/.test(m)), tout);
  const ef = await (await fetch(`${BASE}/api/quetes/etat?sid=${sidFr}`)).json();
  assert.ok(ef.acces && ef.messages.length);
  assert.ok(ef.messages.every((m) => !/quests|Monday|little job|week/i.test(m)), ef.messages.join('\n'));
});

test('MikeHorny pose la question à chacun dans sa langue, et une réponse anglaise marque', async () => {
  // Un quiz d'une question, avec sa version anglaise (la réponse diffère).
  const cree = await (await admin('/api/admin/kiloute/quizzes', {
    name: 'Fruits ' + RUN, nameEn: 'Fruit ' + RUN, reward: 7, windowSec: 30,
    questions: [{ q: 'Quel fruit jaune se mange en le pelant ?', a: ['banane'], r: 'La banane',
      qEn: 'Which yellow fruit do you peel before eating it?', aEn: ['banana'], rEn: 'The banana' }],
  })).json();
  assert.ok(cree.ok, JSON.stringify(cree));
  assert.strictEqual(cree.quiz.questions[0].qEn, 'Which yellow fruit do you peel before eating it?');
  for (const c of [fr, en]) c.trames.length = 0;
  const lance = await admin('/api/admin/kiloute/session/start', { quizId: cree.quiz.id, channel: 'pomme', pas: 300 });
  assert.strictEqual(lance.status, 200, await lance.text());
  const m = de('MikeHorny');
  await en.attendre((x) => m(x) && x.includes(`Today's quiz is “Fruit ${RUN}”: 1 question, and 7 kikooz per right answer!`), 'l’annonce du quiz (en)', 15000);
  await fr.attendre((x) => m(x) && x.includes(`Aujourd'hui, le quiz « Fruits ${RUN} » : 1 question, et 7 kikooz par bonne réponse !`), 'l’annonce du quiz (fr)', 15000);
  const qen = await en.attendre((x) => m(x) && x.includes('Which yellow fruit do you peel before eating it?'), 'la question (en)', 15000);
  const qfr = await fr.attendre((x) => m(x) && x.includes('Quel fruit jaune se mange en le pelant ?'), 'la question (fr)', 15000);
  memeLigne(qfr, qen);
  assert.strictEqual(attr(qen, 't'), 'c', 'le bleu des animateurs');
  // La réponse ANGLAISE (absente des réponses françaises) marque.
  en.dire('banana!');
  const ben = await en.attendre((x) => m(x) && x.includes(EN) && x.includes('The banana'), 'le bravo, la réponse en anglais', 10000);
  const bfr = await fr.attendre((x) => m(x) && x.includes(EN) && x.includes('La banane'), 'le bravo, la réponse en français', 10000);
  memeLigne(bfr, ben);
  await en.attendre((x) => m(x) && /\+?7 (more |well-earned )?kikooz/.test(x) && x.includes(EN), 'le gain (en)', 10000);
  await en.attendre((x) => m(x) && x.includes(`${EN} — 7 kikooz (1 right answer)`), 'le podium (en)', 20000);
  await fr.attendre((x) => m(x) && x.includes(`${EN} — 7 kikooz (1 bonne)`), 'le podium (fr)', 20000);
  await en.attendre((x) => m(x) && x.includes('Thank you all for playing, you\'re fantastic!'), 'le mot de la fin (en)', 20000);
  await fr.attendre((x) => m(x) && x.includes('Merci à toutes et à tous d\'avoir joué'), 'le mot de la fin (fr)', 20000);
});

test('le loup-garou : les phases, le rôle secret et la vue du mobile en anglais pour l’anglophone', async (t) => {
  if (!avecBase) return t.skip('pas d’animateur sans base');
  const ANIM = 'meneu' + RUN, FR2 = 'fran2' + RUN, EN2 = 'angl2' + RUN;
  const [sidAnim, sidFr2, sidEn2] = [await inscrire(ANIM), await inscrire(FR2), await inscrire(EN2)];
  assert.ok(await animateur(ANIM), 'le rôle d’animateur');
  const anim = await client(ANIM, sidAnim, 'fr');
  const fr2 = await client(FR2, sidFr2, 'fr');
  const en2 = await client(EN2, sidEn2, 'en');
  const joueurs = [fr, en, fr2, en2];
  try {
    for (const c of joueurs.concat([anim])) c.trames.length = 0;
    const lg = (x) => /^<t /.test(x) && attr(x, 'u') === 'admin';
    anim.dire('/lg ouvrir');
    const ofr = await fr.attendre((x) => lg(x) && x.includes('Une partie de LOUP-GAROU commence ! Meneur : ' + ANIM), 'l’ouverture (fr)');
    const oen = await en.attendre((x) => lg(x) && x.includes('A WEREWOLF game is starting! Host: ' + ANIM), 'l’ouverture (en)');
    memeLigne(ofr, oen);
    assert.ok(oen.includes('To play, type <b>/lg join</b>'), 'le gras et la commande anglaise : ' + oen);
    assert.ok(oen.includes('<br/>'), 'le retour à la ligne');
    // On s'inscrit dans sa langue : « join » pour les uns, « jouer » pour les autres.
    fr.dire('/lg jouer');
    await fr.attendre((x) => lg(x) && x.includes(`${FR} rejoint la partie (1 joueur).`), 'l’inscription (fr)');
    en.dire('/lg join');
    await en.attendre((x) => lg(x) && x.includes(`${EN} joins the game (2 players).`), 'l’inscription (en)');
    fr2.dire('/lg jouer');
    en2.dire('/lg join');
    await en.attendre((x) => lg(x) && x.includes(`${EN2} joins the game (4 players).`), 'la quatrième inscription (en)');
    // La vue du mobile, avant le lancement.
    const vueEn = (c, pred, quoi) => c.attendre((x) => attr(x, 't') === 'lg' && (() => { try { return pred(JSON.parse(corps(x).replace(/^<!\[CDATA\[|\]\]>$/g, ''))); } catch { return false; } })(), quoi, 10000);
    for (const c of joueurs.concat([anim])) c.trames.length = 0;
    anim.dire('/lg lancer');
    const dfr = await fr.attendre((x) => lg(x) && x.includes('Les rôles sont distribués ! Dans ce village de 4 : 1 Loup-garou, 1 Voyante, 2 Simples villageois.'), 'la distribution (fr)');
    const den = await en.attendre((x) => lg(x) && x.includes('The roles have been dealt! In this village of 4: 1 Werewolf, 1 Seer, 2 Plain Villagers.'), 'la distribution (en)');
    memeLigne(dfr, den);
    // Le rôle secret : violet, pour lui seul, dans sa langue.
    const secret = await en.attendre((x) => attr(x, 'st') === 'lg' && x.includes('Your role: <b>'), 'son rôle secret (en)');
    assert.match(secret, /Your role: <b>(Werewolf|Seer|Plain Villager)<\/b>\. /);
    await fr.attendre((x) => attr(x, 'st') === 'lg' && x.includes('Tu es <b>'), 'son rôle secret (fr)');
    await en.attendre((x) => lg(x) && /NIGHT 1\. .*<br\/>\(The chat room falls silent until morning\./.test(x), 'la nuit tombe (en)');
    await fr.attendre((x) => lg(x) && /NUIT 1\. .*<br\/>\(Le salon se tait jusqu’au matin\./.test(x), 'la nuit tombe (fr)');
    const v = await vueEn(en, (j) => j.phase === 'nuit' && j.moi, 'la vue de la nuit (en)');
    const v0 = JSON.parse(corps(v).replace(/^<!\[CDATA\[|\]\]>$/g, ''));
    assert.ok(['Werewolf', 'Seer', 'Plain Villager'].includes(v0.moi.roleNom), JSON.stringify(v0.moi));
    assert.ok(!/[éèàù]|Loup|Voyante|villageois/.test(v0.moi.desc), 'la description en anglais : ' + v0.moi.desc);
    assert.strictEqual(v0.composition, '1 Werewolf, 1 Seer, 2 Plain Villagers');
    if (v0.action) assert.ok(['Devour…', 'Probe…'].includes(v0.action.libelle), v0.action.libelle);
    const vf = await vueEn(fr, (j) => j.phase === 'nuit' && j.moi, 'la vue de la nuit (fr)');
    assert.strictEqual(JSON.parse(corps(vf).replace(/^<!\[CDATA\[|\]\]>$/g, '')).composition, '1 Loup-garou, 1 Voyante, 2 Simples villageois');
    // Le meneur fait avancer : l'aube, le jour, le vote, le soir.
    anim.dire('/lg suite');
    await en.attendre((x) => lg(x) && /The rooster crows|The sun rises over Frutiparc|The first light of dawn/.test(x), 'l’aube (en)');
    await en.attendre((x) => lg(x) && x.includes('DAY 1: the village debates. Who are the wolves?'), 'le jour (en)');
    await fr.attendre((x) => lg(x) && x.includes('JOUR 1 : le village débat. Qui sont les loups ?'), 'le jour (fr)');
    anim.dire('/lg suite');
    const urnes = await en.attendre((x) => lg(x) && x.includes('TO THE POLLS! <b>/lg vote &lt;number&gt;</b>'), 'le vote (en)');
    assert.ok(urnes.includes('<br/>'), urnes);
    await fr.attendre((x) => lg(x) && x.includes('AUX URNES ! <b>/lg voter &lt;numéro&gt;</b>'), 'le vote (fr)');
    await vueEn(en, (j) => j.phase === 'vote' && j.action && j.action.libelle === 'Vote against…', 'la vue du vote (en) : « Vote against… »');
    await vueEn(fr, (j) => j.phase === 'vote' && j.action && j.action.libelle === 'Vote contre…', 'la vue du vote (fr)');
    // Un vote blanc en anglais (« blank »), lu des deux côtés — blanc : personne
    // n'est chassé, la partie continue.
    en.dire('/lg vote blank');
    const ben = await en.attendre((x) => lg(x) && x.includes(`${EN} casts a blank vote.`), 'son vote (en)');
    const bfr = await fr.attendre((x) => lg(x) && x.includes(`${EN} vote blanc.`), 'son vote (fr)');
    memeLigne(bfr, ben);
    assert.ok(ben.includes('<i>'), 'la petite ligne grise, en italique');
    anim.dire('/lg suite');
    await en.attendre((x) => lg(x) && x.includes('The vote is closed.'), 'le dépouillement (en)');
    await fr.attendre((x) => lg(x) && x.includes('Le vote est clos.'), 'le dépouillement (fr)');
    await en.attendre((x) => lg(x) && x.includes('The sun is setting… night falls in 8 s.'), 'le soir (en)');
    anim.dire('/lg fin');
    const fen = await en.attendre((x) => lg(x) && /The host stops the game\. The roles were:<br\/>1\. /.test(x), 'la fin (en)');
    assert.ok(/ — (Werewolf|Seer|Plain Villager)/.test(fen), fen);
    await fr.attendre((x) => lg(x) && /Le meneur arrête la partie\. Les rôles étaient :<br\/>1\. /.test(x), 'la fin (fr)');
  } finally { for (const c of [anim, fr2, en2]) c.fermer(); }
});

// Le rejeu (cinq minutes) d'un client qui revient — dans SA langue.
async function rejeu(pseudo, sid, la) {
  const c = await client(pseudo, sid, la);
  await wait(500);
  const r = c.trames.filter((x) => /^<t /.test(x) && attr(x, 'rj') === '1');
  c.fermer();
  return r;
}
function verifierRejeuAnglais(rejeuEn) {
  const trouver = (morceau) => rejeuEn.find((x) => x.includes(morceau));
  assert.ok(trouver(`Welcome ${EN}! I'm Gaspard`), 'la bienvenue de Gaspard');
  assert.ok(trouver(`@${EN} Kikooz are the park's currency`), 'sa réponse à la question anglaise');
  assert.ok(trouver(`@${FR} Every Monday, Gromelin hands you your quests`), 'et à la française');
  assert.ok(trouver('Which yellow fruit do you peel before eating it?'), 'la question de MikeHorny');
  assert.ok(trouver('The banana'), 'sa réponse');
  if (avecBase) {
    assert.ok(trouver(`${EN}. Yes, you. Come here.`), 'Gromelin');
    assert.ok(trouver('A WEREWOLF game is starting!'), 'l’ouverture du loup-garou, son gras et ses retours à la ligne');
    assert.ok(trouver('TO THE POLLS! <b>/lg vote &lt;number&gt;</b>'), 'le vote, refait avec son gras');
    assert.ok(trouver('The vote is closed.'));
    assert.ok(trouver(`<i>${EN} casts a blank vote.</i>`), 'une ligne grise, en italique');
    assert.ok(rejeuEn.some((x) => /The host stops the game\. The roles were:<br\/>1\. /.test(x)), 'la fin, ses lignes');
  }
  assert.ok(!rejeuEn.some((x) => /Bienvenue \S+ ! Je suis Gaspard|Les kikooz sont la monnaie|Oui, toi\. Approche|Quel fruit jaune|AUX URNES|LOUP-GAROU commence/.test(x)),
    'plus rien de français à refaire');
  for (const x of rejeuEn) assert.ok(!/ kp?="/.test(x.slice(0, x.indexOf('>'))), 'pas de k/kp au rejeu : ' + x);
}

test('le rejeu en anglais refait les lignes des PNJ ; en français, telles qu’envoyées', async () => {
  fr.fermer(); en.fermer();
  await wait(300);
  verifierRejeuAnglais(await rejeu(EN, sidEn, 'en'));
  const rejeuFr = await rejeu(FR, sidFr, 'fr');
  assert.ok(rejeuFr.some((x) => x.includes(`@${EN} Les kikooz sont la monnaie du parc`)));
  assert.ok(rejeuFr.some((x) => x.includes('Quel fruit jaune se mange en le pelant ?')));
  assert.ok(!rejeuFr.some((x) => /park's currency|Which yellow fruit|Welcome \S+! I'm Gaspard/.test(x)));
});

test('après un redémarrage, l’historique relu de la base se refait en anglais', async (t) => {
  if (!avecBase) return t.skip('pas de base PostgreSQL de test (port 5433)');
  await arreter();
  await lancer();
  await wait(800);
  verifierRejeuAnglais(await rejeu(EN, sidEn, 'en'));
});

test('le journal du serveur ne signale aucune ligne hors du moule', () => {
  assert.ok(/\[CBee\]/.test(journal), 'le journal est bien lu');
  assert.ok(!/\[i18n\] ligne non rejouable/.test(journal), 'aucune ligne rangée sans sa clé : '
    + (journal.match(/\[i18n\] ligne non rejouable[^\n]*/g) || []).join(' | '));
});

test('les textes des PNJ : chaque clé française a son anglais, et le français de Gaspard sort tel qu’avant', () => {
  const FPI18n = require(path.join(ROOT, 'public', 'js', 'i18n.js'));
  for (const z of ['gaspard', 'gromelin', 'kiloute', 'loupgarou']) FPI18n.ajouter('en', require(path.join(ROOT, 'i18n-serveur', 'en', z + '.js')));
  const G = require(path.join(ROOT, 'gaspard.js'));
  for (const e of G.BASE) {
    assert.ok(FPI18n.possede('en', 'gaspard.reponse.' + e.cle), 'la réponse anglaise de ' + e.cle);
    const r = G.repondre(e.mots.split(' ')[0], [], 'Remi');
    if (r.cle === e.cle) assert.strictEqual(r.texte, e.reponse, 'le français tel quel');
  }
  // Le lecteur anglais : quelques questions, et la langue de la question.
  for (const [q, cle] of [['how do I earn kikooz?', 'kikooz'], ['what are the quests?', 'quetes'], ['how do I play werewolf?', 'loupgarou'],
    ['I forgot my password', 'motdepasse'], ['how do I install the app on my iphone?', 'appli'], ['night mode', 'nuit'],
    ['how do I send a private message?', 'mp'], ['how do I block someone', 'ignorer'], ['what is the daily challenge?', 'challenge']]) {
    assert.strictEqual(G.repondre(q, [], 'x').cle, cle, q);
  }
  assert.strictEqual(G.langueDeQuestion('how do I earn kikooz?'), 'en');
  assert.strictEqual(G.langueDeQuestion('comment gagner des kikooz ?'), 'fr');
  // Une rubrique de l'aide avec sa version anglaise : trouvée en anglais, dite en anglais.
  const rub = [{ title: 'Le loup-garou du jeudi', keywords: 'jeudi soiree', body: 'Tous les jeudis à 21 h.',
    title_en: 'Thursday werewolf', keywords_en: 'thursday evening', body_en: 'Every Thursday at 9pm.' }];
  const r = G.repondre('when is the thursday evening?', rub, 'x');
  assert.strictEqual(r.source, 'aide');
  assert.strictEqual(FPI18n.traduire('en', r.tr.k, r.tr.fr, r.tr.p), 'Thursday werewolf — Every Thursday at 9pm. (more in the help: the Gaspard icon)');
  // Le loup-garou : chaque clé que le moteur écrit a son anglais.
  const LG = require(path.join(ROOT, 'loupgarou.js'));
  const p = LG.creer({ salon: 'pomme', meneur: 'anim', meneurNom: 'Anim', now: 1 });
  const cles = new Set();
  const noter = (evts) => { for (const e of evts) if (e.tr) (function voir(t) { cles.add(t.k); for (const v of Object.values(t.p || {})) if (v && v.k) voir(v); })(e.tr); };
  for (const x of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) noter(LG.commande(p, { u: x.toLowerCase(), nom: x }, 'join', { now: 1, rnd: () => 0.9999 }));
  noter(LG.commande(p, { u: 'anim', nom: 'Anim', staff: true }, 'start +idiot', { now: 1, rnd: () => 0.9999 }));
  noter(LG.commande(p, { u: 'a', nom: 'A' }, 'eat 5', { now: 1, rnd: () => 0.9999 }));
  noter(LG.commande(p, { u: 'c', nom: 'C' }, 'see 1', { now: 1, rnd: () => 0.9999 }));
  for (const k of cles) assert.ok(FPI18n.possede('en', k), 'l’anglais de ' + k);
  assert.ok(cles.size > 15);
  assert.strictEqual(LG.vue(p, 'a', false, 1, 'en').moi.roleNom, 'Werewolf');
  assert.strictEqual(LG.vue(p, 'a', false, 1).moi.roleNom, 'Loup-garou', 'le français par défaut');
});
