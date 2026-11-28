'use strict';
/*
 * LE CHAT DANS LA LANGUE DE CHACUN — des salons PARTAGÉS.
 *
 * Choix de l'admin : francophones et anglophones lisent les mêmes salons, et
 * chacun lit dans SA langue ce que le SERVEUR écrit (lignes système, réponses
 * aux commandes, émotes, PNJ) ; ce que tape un joueur part tel quel à tous.
 * Le bureau Flash d'époque reste en français.
 *
 * Ici, deux clients light dans le même salon — l'un annonce `la="fr"`, l'autre
 * `la="en"` — et un troisième sans `la` ni `lc`, comme le SWF du bureau :
 *   · les réponses aux commandes (/aide, commande inconnue) dans la langue de
 *     qui tape ;
 *   · une émote : la phrase (`el` et le corps) dans la langue de chaque
 *     lecteur, sous le même numéro `mi` ;
 *   · un message de joueur : le même, octet pour octet, pour tous ;
 *   · M'dam Irma : chaque réplique dans les deux langues, son frutisigne
 *     compris ;
 *   · l'historique : rangé en français avec `k`/`kp` ; le rejeu d'un client
 *     anglais refait les lignes à clé en anglais, celui d'un français les rend
 *     telles qu'envoyées ; la page des logs en anglais aussi — et, avec une
 *     base PostgreSQL de test (port 5433), APRÈS un redémarrage, quand les
 *     lignes ne viennent plus que de la table chat_history.
 *
 * Sans base, le serveur tourne en mémoire et seul le redémarrage est sauté.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 4931;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-chat-langues';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_chatlangues';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null, avecBase = false;
let journal = '';              // ce que disent les serveurs successifs

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
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: avecBase ? DB : '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '4932', FRUTISCORE_PORT: '4933',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { journal += d; });
  proc.stderr.on('data', (d) => { journal += d; });
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(BASE + '/do/prefdef')).ok) {
        if (!avecBase) return;
        // Une base neuve : on attend aussi sa dernière table.
        const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'kikooz_gifts'`);
        await c.end();
        if (rows.length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
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

const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml.slice(0, xml.indexOf('>'))); return m ? m[1] : null; };
const corps = (xml) => xml.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, '');

// Un client : light avec sa langue (`la`), ou sans rien comme le SWF du bureau.
async function client(pseudo, sid, { la, light = true } = {}) {
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
  ws.send(`<k l="${pseudo}" s="${sid}"${light ? ' lc="1"' : ''}${la ? ` la="${la}"` : ''} />\0`);
  const c = {
    trames,
    dire: (texte) => ws.send(`<t g="pomme" t="m" p="">${texte}</t>\0`),
    envoyer: (xml) => ws.send(xml + '\0'),
    attendre: async (pred, quoi, ms = 6000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(-1200)}`);
    },
    messages: () => trames.filter((t) => /^<t[\s>]/.test(t)),
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  ws.send('<o g="pomme" />\0');
  await c.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'liste du salon');
  return c;
}

const FR = 'franco' + RUN, EN = 'anglo' + RUN, SWF = 'bureau' + RUN;
let sidFr, sidEn, sidSwf, fr, en, swf;

test('mise en place : un francophone, un anglophone et un bureau Flash dans le même salon', async () => {
  [sidFr, sidEn, sidSwf] = [await inscrire(FR), await inscrire(EN), await inscrire(SWF)];
  fr = await client(FR, sidFr, { la: 'fr' });
  en = await client(EN, sidEn, { la: 'en' });
  // Le bureau d'époque n'annonce rien. Même un compte réglé en anglais…
  const r = await fetch(BASE + '/api/light/langue', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: sidSwf, lang: 'en' }),
  });
  assert.strictEqual(r.status, 200);
  swf = await client(SWF, sidSwf, { light: false });
});

test('les réponses aux commandes : dans la langue de qui tape', async () => {
  fr.dire('/commande-qui-nexiste-pas');
  en.dire('/commande-qui-nexiste-pas');
  const f = await fr.attendre((x) => x.includes('Commande inconnue.'), 'commande inconnue (fr)');
  const e = await en.attendre((x) => x.includes('Unknown command.'), 'commande inconnue (en)');
  assert.match(f, /^<t u="admin" t="m" p="" g="pomme" h="[^"]*" d="[^"]*"><!\[CDATA\[<i>Commande inconnue\.<\/i>\]\]><\/t>$/,
    'le français, octet pour octet comme avant');
  assert.strictEqual(corps(e), '<![CDATA[<i>Unknown command.</i>]]>');
  assert.ok(!fr.trames.some((x) => x.includes('Unknown command')), 'le francophone ne lit pas la réponse de l\'autre');

  en.dire('/aide');
  const aide = await en.attendre((x) => x.includes('Chat commands:'), '/aide en anglais');
  assert.match(aide, /\/give kikooz username \[message\] — give kikooz/);
  assert.ok(!/Commandes du chat/.test(aide));
  fr.dire('/help');
  await fr.attendre((x) => x.includes('Commandes du chat :') && x.includes('/donne kikooz pseudo [message] — offrir des kikooz'), '/aide en français');
});

test('le bureau Flash reste en français, même pour un compte anglais', async () => {
  swf.dire('/commande-inconnue');
  await swf.attendre((x) => x.includes('Commande inconnue.'), 'la réponse en français');
  assert.ok(!swf.trames.some((x) => x.includes('Unknown command')));
});

test('une émote : la phrase dans la langue de chaque lecteur, sous le même numéro', async () => {
  for (const c of [fr, en, swf]) c.trames.length = 0;
  fr.dire('lol');
  const quiFr = await fr.attendre((x) => x.includes(' e="mdr"'), 'émote (fr)');
  const quiEn = await en.attendre((x) => x.includes(' e="mdr"'), 'émote (en)');
  const quiSwf = await swf.attendre((x) => x.includes(' e="mdr"'), 'émote (bureau)');
  assert.strictEqual(attr(quiFr, 'el'), 'éclate de rire');
  assert.strictEqual(corps(quiFr), `<![CDATA[<i>${FR} éclate de rire</i>]]>`);
  assert.strictEqual(attr(quiEn, 'el'), 'bursts out laughing');
  assert.strictEqual(corps(quiEn), `<![CDATA[<i>${FR} bursts out laughing</i>]]>`);
  assert.strictEqual(quiSwf, quiFr, 'le bureau lit la trame française');
  assert.strictEqual(attr(quiEn, 'mi'), attr(quiFr, 'mi'), 'un seul message, un seul numéro');
  assert.strictEqual(attr(quiEn, 'eu'), FR);
  for (const x of [quiFr, quiEn]) assert.ok(!/ kp?="/.test(x), 'pas de k/kp en direct : ' + x);

  // Les mots anglais jouent les mêmes animations, tapés seuls.
  for (const c of [fr, en]) c.trames.length = 0;
  en.dire('Wink');
  const clinFr = await fr.attendre((x) => x.includes(' e="clin"'), '« wink » vu du francophone');
  const clinEn = await en.attendre((x) => x.includes(' e="clin"'), '« wink » vu de l\'anglophone');
  assert.strictEqual(attr(clinFr, 'el'), 'fait un clin d’œil');
  assert.strictEqual(attr(clinEn, 'el'), 'winks');
  en.dire('I cry every time');
  const phrase = await fr.attendre((x) => x.includes('I cry every time'), 'une phrase reste une phrase');
  assert.ok(!/ e="/.test(phrase));
});

test('un message de joueur : le même pour tous, octet pour octet', async () => {
  for (const c of [fr, en, swf]) c.trames.length = 0;
  fr.dire('bonjour à tous, ça roule ?');
  const a = await fr.attendre((x) => x.includes('ça roule'), 'le message (fr)');
  const b = await en.attendre((x) => x.includes('ça roule'), 'le message (en)');
  const c = await swf.attendre((x) => x.includes('ça roule'), 'le message (bureau)');
  assert.strictEqual(b, a);
  assert.strictEqual(c, a);
});

test('M\'dam Irma parle à chacun dans sa langue — son frutisigne compris', async () => {
  for (const c of [fr, en, swf]) c.trames.length = 0;
  const r = await fetch(BASE + '/api/admin/visiteurs/irma', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ salon: 'pomme', pas: 150 }),
  });
  assert.strictEqual(r.status, 200);
  const irma = (x) => attr(x, 'u') && /irma/i.test(attr(x, 'u')) && /^<t /.test(x);
  await fr.attendre((x) => irma(x) && x.includes("B'nj'ur mes gentils petits frutiz."), 'le bonjour (fr)', 10000);
  await en.attendre((x) => irma(x) && x.includes("'Ello my lovely leetle frutiz."), 'le bonjour (en)', 10000);
  await swf.attendre((x) => irma(x) && x.includes("B'nj'ur mes gentils petits frutiz."), 'le bonjour (bureau)', 10000);
  // Tous les nouveaux venus sont sans frutisigne : elle en révèle un.
  const revFr = await fr.attendre((x) => irma(x) && x.includes('ascendant'), 'la révélation (fr)', 15000);
  const revEn = await en.attendre((x) => irma(x) && x.includes('rising!'), 'la révélation (en)', 15000);
  const SIGNES_FR = ['pomme', 'abricot', 'poire', 'fraise', 'citron', 'kiwi', 'raisin', 'orange', 'cerise', 'banane'];
  const SIGNES_EN = ['apple', 'apricot', 'pear', 'strawberry', 'lemon', 'kiwi', 'grape', 'orange', 'cherry', 'banana'];
  const mf = /Mé petit (\S+) est (\S+) ascendant (\S+) !/.exec(corps(revFr));
  const me = /My leetle (\S+) ees (\S+), (\S+) rising!/.exec(corps(revEn));
  assert.ok(mf && me, corps(revFr) + ' / ' + corps(revEn));
  assert.strictEqual(me[1], mf[1], 'le même frutiz');
  assert.strictEqual(SIGNES_EN[SIGNES_FR.indexOf(mf[2])], me[2], 'le signe, traduit');
  assert.strictEqual(SIGNES_EN[SIGNES_FR.indexOf(mf[3])], me[3], 'l\'ascendant, traduit');
  assert.strictEqual(attr(revEn, 'mi'), attr(revFr, 'mi'));
  await en.attendre((x) => irma(x) && x.includes('Toodle-oo, leetle frutiz...'), 'l\'au revoir (en)', 10000);
  await fr.attendre((x) => irma(x) && x.includes("A b'entot lé' frutiz..."), 'l\'au revoir (fr)', 10000);
});

test('le quiz d\'un animateur : l\'annonce et les points, dans la langue de chacun', async () => {
  const ANIM = 'animo' + RUN;
  const sidAnim = await inscrire(ANIM);
  let r;
  for (let i = 0; i < 40; i++) {
    r = await fetch(`${BASE}/api/admin/users/${ANIM}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
      body: JSON.stringify({ is_animator: true }),
    });
    if (r.status === 200) break;
    await wait(250);
  }
  if (r.status !== 200) return;          // sans base, pas de rôle à donner : on passe
  const anim = await client(ANIM, sidAnim, { la: 'en' });
  try {
    for (const c of [fr, en]) c.trames.length = 0;
    anim.dire('/initpoint Quelle couleur ?');
    await fr.attendre((x) => x.includes(`Quiz lancé par ${ANIM} : Quelle couleur ?`), 'quiz (fr)');
    await en.attendre((x) => x.includes(`Quiz started by ${ANIM}: Quelle couleur ?`), 'quiz (en) — la question reste telle quelle');
    anim.dire(`/point ${FR} 3`);
    await fr.attendre((x) => x.includes(`+3 points pour ${FR} (total : 3)`), 'points (fr)');
    await en.attendre((x) => x.includes(`+3 points for ${FR} (total: 3)`), 'points (en)');
    anim.dire(`/point ${EN} -1`);
    await en.attendre((x) => x.includes(`-1 point for ${EN} (total: -1)`), 'un point en moins (en)');
    anim.dire('/showpoint');
    const cf = await fr.attendre((x) => x.includes('Classement — Quelle couleur ?'), 'classement (fr)');
    const ce = await en.attendre((x) => x.includes('Rankings — Quelle couleur ?'), 'classement (en)');
    assert.strictEqual(corps(cf), `<![CDATA[Classement — Quelle couleur ?<br/>1. ${FR} — 3 pts<br/>2. ${EN} — -1 pt]]>`);
    assert.strictEqual(corps(ce), `<![CDATA[Rankings — Quelle couleur ?<br/>1. ${FR} — 3 pts<br/>2. ${EN} — -1 pt]]>`);
    anim.dire('/d6');
    const df = await fr.attendre((x) => x.includes('lance un dé (1–6)'), 'le dé (fr)');
    const de = await en.attendre((x) => x.includes('rolls a die (1–6)'), 'le dé (en)');
    assert.match(corps(de), new RegExp(`^<!\\[CDATA\\[<b><font color="#C10000">${ANIM}</font></b> rolls a die \\(1–6\\): <b><font color="#C10000">[1-6]</font></b>\\]\\]>$`));
    assert.strictEqual(attr(de, 'mi'), attr(df, 'mi'));
  } finally { anim.fermer(); }
});

// Une commande tapée par `c`, et la réponse qu'il doit lire.
async function repond(c, commande, attendu, quoi) {
  c.trames.length = 0;
  c.dire(commande);
  return c.attendre((x) => x.includes(attendu), quoi || commande);
}

test('chaque commande répond en anglais à l\'anglophone (et rien de français ne lui échappe)', async () => {
  // Un joueur ordinaire.
  await repond(en, '/ignore', 'You\'re not ignoring anyone.');
  await repond(en, '/ignore personneXYZ', 'No frutiz is called “personneXYZ”.');
  await repond(en, `/ignore ${EN}`, 'You can\'t ignore yourself.');
  await repond(en, '/unignore', 'Syntax: /unignore username');
  await repond(en, '/invite', 'Syntax: /invite username');
  await repond(en, '/invite personneXYZ', 'No frutiz is called personneXYZ.');
  await repond(en, `/invite ${FR}`, `${FR} is already in this chat room.`);
  const stats = await repond(en, '/stats', 'Users online:');
  assert.ok(!/Utilisateurs/.test(stats));
  await repond(en, '/d0', 'Syntax: /d6, /d20… (from 1 to 1000).');
  await repond(en, '/status bidule', 'Unknown status.');
  await repond(en, '/status away', 'Status “away” on.');
  await repond(en, '/status off', 'Status cleared — back online.');
  await repond(en, '/multipen', 'You don\'t own the Rainbow felt pen yet.');
  await repond(en, '/topic un sujet', 'Only the chat room\'s team can change its topic.');
  await repond(en, '/!', 'Syntax: /! username message');
  await repond(en, '/! personneXYZ coucou', 'personneXYZ isn\'t in this chat room');
  await repond(en, `/! ${EN} coucou`, 'You can\'t send a private message to yourself.');
  await repond(en, '/image 1', 'Syntax: /image width height url title');
  await repond(en, '/blueoff', 'Blue mode off.');
  await repond(en, '/chatlogs', '... see previous messages ...');
  // Le mot doux : « (de X) » chez le francophone, « (to X) » chez l'auteur.
  fr.trames.length = 0;
  const moi = await repond(en, `/! ${FR} psst`, 'psst');
  assert.match(moi, new RegExp(`\\(to <b>${FR}</b>\\) psst`));
  const lui = await fr.attendre((x) => x.includes('psst'), 'le mot doux (fr)');
  assert.match(lui, new RegExp(`\\(de <b>${EN}</b>\\) psst`));
  // Rien, dans tout ça, n'est passé par le francophone.
  assert.ok(!fr.trames.some((x) => /Syntax|Unknown|You can't/.test(x)));
});

test('les commandes d\'animation répondent en anglais ; leurs annonces partent dans chaque langue', async (t) => {
  const ANIM = 'anima' + RUN;
  const sidAnim = await inscrire(ANIM);
  let r;
  for (let i = 0; i < 40; i++) {
    r = await fetch(`${BASE}/api/admin/users/${ANIM}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
      body: JSON.stringify({ is_animator: true }),
    });
    if (r.status === 200) break;
    await wait(250);
  }
  if (r.status !== 200) return t.skip('pas de rôle d\'animateur sans base');
  const anim = await client(ANIM, sidAnim, { la: 'en' });
  try {
    await repond(anim, '/point', 'Syntax: /point username [points]');
    // (le quiz d'avant se clôt : le classement final, puis plus rien)
    await repond(anim, '/endpoint', 'Quiz over! Final rankings:');
    await repond(anim, '/showpoint', 'No points handed out.');
    await repond(anim, '/poll', 'Syntax: /poll Question?');
    await repond(anim, '/poll Une question | une seule réponse', 'You need a question and at least two answers');
    const aide = await repond(anim, '/blind', 'Blindtest — /blind &lt;YouTube link&gt; [start] [duration]');
    assert.match(aide, /<br\/>Example: \/blind/);
    await repond(anim, '/blind http://exemple.fr/', 'YouTube link not recognised.');
    await repond(anim, '/mesdons', 'My gifts — I have');
    await repond(anim, '/don', 'Usage: /don &lt;username&gt; &lt;amount&gt;');
    await repond(anim, '/blueon', 'Blue mode on.');
    await repond(anim, '/blueoff', 'Blue mode off.');
    for (const c of [fr, en]) c.trames.length = 0;
    anim.dire(`/don ${FR} 5`);
    await fr.attendre((x) => x.includes(`offre 5 kikooz à ${FR} !`), 'le don (fr)');
    await en.attendre((x) => x.includes(`gives 5 kikooz to ${FR}!`), 'le don (en)');
    anim.dire('/blind dQw4w9WgXcQ 0 10');
    await fr.attendre((x) => x.includes(`Blindtest ! ${ANIM} lance un extrait de 10 secondes.`), 'le blindtest (fr)');
    await en.attendre((x) => x.includes(`Blindtest! ${ANIM} plays a 10-second clip.`), 'le blindtest (en)');
    anim.dire('/blindstop');
    await fr.attendre((x) => x.includes('Blindtest : extrait arrêté.'), 'l\'arrêt (fr)');
    await en.attendre((x) => x.includes('Blindtest: clip stopped.'), 'l\'arrêt (en)');
    // L'appel au modérateur : l'animateur est l'équipe du salon Pomme…
    en.trames.length = 0;
    en.envoyer('<bo g="pomme" />');
    await en.attendre((x) => x.startsWith('<bo') && x.includes('One or more moderators are already in this chat room.'), 'appel refusé');
  } finally { anim.fermer(); }
  await wait(300);
  // …parti, l'appel passe : la ligne rouge dans la langue de chacun.
  for (const c of [fr, en]) c.trames.length = 0;
  en.envoyer('<bo g="pomme" />');
  await fr.attendre((x) => x.includes(`${EN} indique qu'il y a des problèmes sur ce salon !`), 'l\'appel (fr)');
  await en.attendre((x) => x.includes(`${EN} says there's trouble in this chat room!`), 'l\'appel (en)');
  en.envoyer('<bo g="pomme" />');
  await en.attendre((x) => x.includes('You\'ve just alerted the moderators!'), 'un seul appel par minute');
});

// Le rejeu (cinq minutes) d'un client qui revient — dans SA langue.
async function rejeu(pseudo, sid, la) {
  const c = await client(pseudo, sid, { la });
  await wait(400);
  const r = c.messages().filter((x) => attr(x, 'rj') === '1');
  c.fermer();
  return r;
}

test('le rejeu : les lignes à clé refaites en anglais, les messages de joueurs tels quels', async () => {
  fr.fermer(); en.fermer();
  await wait(300);
  const rejeuEn = await rejeu(EN, sidEn, 'en');
  const rejeuFr = await rejeu(FR, sidFr, 'fr');
  const trouver = (liste, morceau) => liste.find((x) => x.includes(morceau));
  assert.ok(trouver(rejeuEn, `${FR} bursts out laughing`), 'l\'émote, en anglais');
  assert.ok(trouver(rejeuEn, 'el="bursts out laughing"'));
  assert.ok(trouver(rejeuEn, "'Ello my lovely leetle frutiz."), 'Irma, en anglais');
  assert.ok(trouver(rejeuEn, 'rising!'), 'sa révélation, signe traduit');
  assert.ok(trouver(rejeuEn, 'bonjour à tous, ça roule ?'), 'le joueur, tel quel');
  assert.ok(!trouver(rejeuEn, 'éclate de rire') && !trouver(rejeuEn, "B'nj'ur"), 'rien de français à refaire');
  assert.ok(trouver(rejeuFr, `${FR} éclate de rire`) && trouver(rejeuFr, "B'nj'ur mes gentils petits frutiz."));
  for (const x of rejeuEn.concat(rejeuFr)) assert.ok(!/ kp?="/.test(x.slice(0, x.indexOf('>'))), 'pas de k/kp au rejeu : ' + x);
  // Même numéro que la ligne d'origine, dans les deux langues.
  const emEn = trouver(rejeuEn, ' e="mdr"'), emFr = trouver(rejeuFr, ' e="mdr"');
  assert.strictEqual(attr(emEn, 'mi'), attr(emFr, 'mi'));
});

async function logs(sid, lang) {
  const r = await fetch(`${BASE}/api/chat/histo?sid=${sid}&g=pomme${lang ? '&lang=' + lang : ''}`);
  assert.strictEqual(r.status, 200);
  return r.text();
}

test('la page des logs : en anglais pour l\'anglophone, en français sinon', async () => {
  const en1 = await logs(sidEn, 'en');
  assert.match(en1, /<html lang="en">/);
  assert.match(en1, /messages from the last 24 hours/);
  assert.match(en1, new RegExp(`${FR} bursts out laughing`));
  assert.match(en1, /&#39;Ello my lovely leetle frutiz\.|'Ello my lovely leetle frutiz\./);
  assert.match(en1, /bonjour à tous, ça roule \?/);
  // Sans `lang`, la langue du compte ; le compte du francophone est français.
  const fr1 = await logs(sidFr);
  assert.match(fr1, /<html lang="fr">/);
  assert.match(fr1, /les messages des 24 dernières heures/);
  assert.match(fr1, new RegExp(`${FR} éclate de rire`));
  assert.ok(!/bursts out laughing/.test(fr1));
});

test('l\'historique rangé : le français, et la clé pour le refaire', async (t) => {
  if (!avecBase) return t.skip('pas de base PostgreSQL de test (port 5433)');
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const c = new Client({ connectionString: DB });
  await c.connect();
  let rows;
  try { ({ rows } = await c.query(`SELECT xml FROM chat_history WHERE channel = 'pomme' ORDER BY at_ms`)); }
  finally { await c.end(); }
  const xs = rows.map((r) => r.xml);
  const emote = xs.find((x) => x.includes(' e="mdr"'));
  assert.ok(emote, 'l\'émote est rangée');
  assert.match(emote, /^<t mi="[^"]+" k="chat\.emote\.mdr" kp="\{&quot;nom&quot;:&quot;[^&]+&quot;\}" u="admin"/);
  assert.match(emote, /el="éclate de rire"/);
  assert.ok(emote.includes(`<![CDATA[<i>${FR} éclate de rire</i>]]>`), 'le corps rangé est français');
  const rev = xs.find((x) => x.includes(' k="irma.revelation"'));
  assert.ok(rev, 'la révélation d\'Irma est rangée avec sa clé');
  assert.match(rev, /kp="\{&quot;nom&quot;:.*&quot;signe&quot;:\{&quot;k&quot;:&quot;frutisigne\./, 'son signe, un texte à clé');
  assert.ok(/Mé petit \S+ est \S+ ascendant \S+ !/.test(rev));
  const joueur = xs.find((x) => x.includes('ça roule'));
  assert.ok(joueur && !/ k="/.test(joueur), 'un message de joueur n\'a pas de clé');
});

test('après un redémarrage, l\'historique relu de la base se refait en anglais', async (t) => {
  if (!avecBase) return t.skip('pas de base PostgreSQL de test (port 5433)');
  swf.fermer();
  await arreter();
  await lancer();
  await wait(500);
  const rejeuEn = await rejeu(EN, sidEn, 'en');
  const trouver = (morceau) => rejeuEn.find((x) => x.includes(morceau));
  assert.ok(trouver(`${FR} bursts out laughing`), 'l\'émote, refaite depuis la base');
  assert.ok(trouver("'Ello my lovely leetle frutiz."), 'Irma aussi');
  assert.ok(trouver('rising!'));
  assert.ok(trouver('bonjour à tous, ça roule ?'));
  // Les lignes à rendu (le classement, le dé) et les pluriels aussi.
  assert.ok(trouver(`Rankings — Quelle couleur ?<br/>1. ${FR} — 3 pts<br/>2. ${EN} — -1 pt`), 'le classement');
  assert.ok(trouver(`+3 points for ${FR} (total: 3)`) && trouver(`-1 point for ${EN} (total: -1)`), 'les points');
  assert.ok(trouver('rolls a die (1–6)'), 'le dé');
  assert.ok(!rejeuEn.some((x) => /éclate de rire|Classement|lance un dé|B'nj'ur/.test(x)), 'plus rien de français à refaire');
  const en1 = await logs(sidEn, 'en');
  assert.match(en1, new RegExp(`${FR} bursts out laughing`));
  assert.match(en1, /Rankings — Quelle couleur \?/);
  const fr1 = await logs(sidFr, 'fr');
  assert.match(fr1, /Classement — Quelle couleur \?/);
});

test('le journal du serveur ne signale aucune ligne hors du moule', () => {
  assert.ok(/\[CBee\]/.test(journal), 'le journal est bien lu');
  assert.ok(!/\[i18n\] ligne non rejouable/.test(journal), 'aucune ligne rangée sans sa clé');
});

test('les dictionnaires du serveur : une zone par fichier, chaque clé dans sa zone', () => {
  const dossier = path.join(ROOT, 'i18n-serveur', 'en');
  for (const f of fs.readdirSync(dossier).filter((x) => x.endsWith('.js'))) {
    const zone = f.replace(/\.js$/, '');
    const table = require(path.join(dossier, f));
    assert.ok(Object.keys(table).length > 0, f + ' n\'est pas vide');
    for (const k of Object.keys(table)) assert.ok(k.startsWith(zone + '.'), `${f} : ${k} hors de sa zone`);
  }
  // Et rien de tout ça n'est servi au navigateur.
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'i18n-serveur')));
});
