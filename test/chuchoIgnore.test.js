/*
 * /IGNORE ET /! — ne plus lire quelqu'un, parler à un seul.
 *
 * Ce que ces épreuves tiennent :
 *
 *   · /IGNORE, C'EST LA LISTE NOIRE. `/ignore pseudo` range le frutiz dans la
 *     liste noire (en base), `/ignore` seul la montre, `/unignore` l'en sort.
 *     Et la réciproque : un frutiz mis en liste noire par la fiche (`/ff/mk`)
 *     est ignoré sur les salons de la même façon.
 *   · LE FILTRE EST AU RELAIS. Les lignes de l'ignoré — paroles et émotes —
 *     ne partent pas vers celui qui l'ignore : ni en direct, ni au rejeu, ni
 *     dans les logs (/api/chat/histo). Les autres les lisent comme avant.
 *   · CE QUI PASSE TOUJOURS : un modérateur (on ne peut même pas l'ignorer),
 *     et les annonces de modération — la totoche de l'ignoré se lit.
 *   · /! PSEUDO MESSAGE. Seul le destinataire le reçoit (« (de X) »), l'auteur
 *     en a l'écho (« (à X) »), les autres rien ; rien dans l'historique ni les
 *     logs. Le destinataire doit être dans le salon ; sa liste noire arrête le
 *     message (réponse neutre) ; la trame d'époque du SWF (`<bk>`) mène au
 *     même endroit, sans écho en double ; la cadence est bornée.
 *   · /AIDE répond au light, et cite les deux commandes.
 *
 * PostgreSQL de test requis (cluster port 5433), sinon tout est sauté.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3641;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-chucho';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_chucho';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SAGE = 'sage' + RUN;       // celui qui ignore
const RELOU = 'relou' + RUN;     // celui qu'on ignore
const TEMOIN = 'temoin' + RUN;   // le reste du salon
const MODO = 'modo' + RUN;       // le modérateur

let proc = null, dispo = false;
const sids = {};

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
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5641', FRUTISCORE_PORT: '5642',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
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

async function client(pseudo, light = true) {
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
  ws.send(`<k l="${pseudo}" s="${sids[pseudo]}"${light ? ' lc="1"' : ''} />\0`);
  const c = {
    pseudo, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    dire: (texte) => ws.send(`<t g="pomme" t="m" p="">${texte}</t>\0`),
    attendre: async (pred, quoi, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(-900)}`);
    },
    rejoindre: async (g = 'pomme') => {
      ws.send(`<o g="${g}" />\0`);
      await c.attendre((x) => x.startsWith('<p') && x.includes(`g="${g}"`), 'liste du salon ' + g);
    },
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}

const ligne = (bout) => (x) => x.startsWith('<t') && x.includes(bout);

test('mise en place : quatre comptes, dont un modérateur', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  for (const p of [SAGE, RELOU, TEMOIN, MODO]) sids[p] = await inscrire(p);
  const role = await fetch(`${BASE}/api/admin/users/${MODO}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ is_moderator: true }),
  });
  assert.equal(role.status, 200, 'rôle modérateur posé');
});

test('/ignore : l\'ignoré se tait pour celui qui l\'ignore — en direct, au rejeu, dans les logs', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const sage = await client(SAGE);
  const relou = await client(RELOU);
  const temoin = await client(TEMOIN);
  const modo = await client(MODO);
  try {
    for (const c of [sage, relou, temoin, modo]) await c.rejoindre();

    // 1. La liste est vide, puis l'on ignore.
    sage.dire('/ignore');
    await sage.attendre(ligne('Tu n\'ignores personne'), 'la liste vide');
    sage.dire(`/ignore ${RELOU}`);
    const ok = await sage.attendre(ligne('Tu ignores désormais'), 'la confirmation');
    assert.match(ok, new RegExp(RELOU, 'i'), 'elle nomme l\'ignoré : ' + ok);
    assert.match(ok, /liste noire/, 'et dit la liste noire : ' + ok);
    sage.dire(`/ignore ${RELOU}`);
    await sage.attendre(ligne('Tu ignores déjà'), 'le doublon signalé');
    sage.dire('/ignore');
    const liste = await sage.attendre(ligne('Tu ignores sur les salons'), 'la liste');
    assert.match(liste, new RegExp(RELOU, 'i'), 'la liste le contient : ' + liste);

    // C'est bien la liste noire, en base.
    const c = new Client({ connectionString: DB });
    await c.connect();
    let rows = [];
    for (let i = 0; i < 40 && !rows.length; i++) {      // l'écriture en base part sans attendre
      ({ rows } = await c.query(
        'SELECT b.blocked_name FROM blacklist b JOIN users u ON u.id = b.user_id WHERE lower(u.username) = $1', [SAGE]));
      if (!rows.length) await wait(100);
    }
    await c.end();
    assert.ok(rows.some((r) => r.blocked_name.toLowerCase().startsWith(RELOU)), 'rangé dans la table blacklist : ' + JSON.stringify(rows));

    // 2. Ses paroles et ses émotes : le témoin les lit, le sage non.
    relou.dire('je-parle-fort');
    relou.dire('mdr');
    temoin.dire('le-temoin-parle');
    await temoin.attendre(ligne('je-parle-fort'), 'la parole de l\'ignoré (témoin)');
    await temoin.attendre((x) => x.startsWith('<t') && /\seu="/.test(x) && x.includes(RELOU), 'l\'émote de l\'ignoré (témoin)');
    await sage.attendre(ligne('le-temoin-parle'), 'la parole du témoin');
    await wait(300);
    assert.ok(!sage.trames.some((x) => x.includes('je-parle-fort')), 'la parole de l\'ignoré ne parvient pas');
    assert.ok(!sage.trames.some((x) => x.startsWith('<t') && /\seu="/.test(x) && x.includes(RELOU)), 'son émote non plus');

    // 3. On n'ignore pas un modérateur, et ce qu'il dit passe.
    sage.dire(`/ignore ${MODO}`);
    await sage.attendre(ligne('est modérateur'), 'le refus d\'ignorer un modérateur');
    // 4. La modération passe toujours : la totoche de l'ignoré se lit.
    modo.dire(`/totoch ${RELOU}`);
    await sage.attendre(ligne('a été totoché'), 'l\'annonce de la totoche de l\'ignoré');

    // 5. Le rejeu : le sage revient — la ligne du témoin revient, pas celle de l'ignoré.
    sage.fermer();
    const sage2 = await client(SAGE);
    try {
      await sage2.rejoindre();
      await sage2.attendre((x) => x.startsWith('<t') && x.includes('rj="1"') && x.includes('le-temoin-parle'), 'le rejeu du témoin');
      await wait(300);
      assert.ok(!sage2.trames.some((x) => x.includes('je-parle-fort')), 'l\'ignoré ne revient pas au rejeu');
    } finally { sage2.fermer(); }

    // 6. Les logs : filtrés pour le sage, entiers pour le témoin.
    const logsSage = await (await fetch(`${BASE}/api/chat/histo?sid=${sids[SAGE]}&g=pomme`)).text();
    const logsTemoin = await (await fetch(`${BASE}/api/chat/histo?sid=${sids[TEMOIN]}&g=pomme`)).text();
    assert.ok(logsTemoin.includes('je-parle-fort'), 'le témoin relit l\'ignoré');
    assert.ok(logsSage.includes('le-temoin-parle'), 'le sage relit le témoin');
    assert.ok(!logsSage.includes('je-parle-fort'), 'le sage ne relit pas l\'ignoré');
  } finally { for (const c of [sage, relou, temoin, modo]) c.fermer(); }
});

test('/unignore rend la parole ; la liste noire posée par la fiche vaut /ignore', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const sage = await client(SAGE);
  const relou = await client(RELOU);
  const temoin = await client(TEMOIN);
  const modo = await client(MODO);
  try {
    for (const c of [sage, relou, temoin, modo]) await c.rejoindre();
    // La totoche de l'épreuve précédente : on la lève, l'ignoré doit pouvoir parler.
    modo.envoyer(`<ba u="${RELOU}" />`);           // unmute
    await relou.attendre((x) => x.startsWith('<bc'), 'la fin de la totoche');

    sage.dire(`/unignore ${RELOU}`);
    await sage.attendre(ligne('Tu n\'ignores plus'), 'la confirmation du retrait');
    relou.dire('me-revoila');
    await sage.attendre(ligne('me-revoila'), 'la parole revenue');

    // Le témoin met l'ignoré en liste noire par la fiche (/ff/mk) : effet identique.
    const r = await fetch(`${BASE}/ff/mk?sid=${sids[TEMOIN]}&t=contact&folder=blacklist&u=${RELOU}`);
    assert.equal(r.status, 200);
    relou.dire('apres-la-fiche');
    await sage.attendre(ligne('apres-la-fiche'), 'le sage, lui, le lit de nouveau');
    await wait(300);
    assert.ok(!temoin.trames.some((x) => x.includes('apres-la-fiche')), 'la liste noire de la fiche ignore sur les salons');
  } finally { for (const c of [sage, relou, temoin, modo]) c.fermer(); }
});

test('/! : seul le destinataire le lit, l\'auteur a son écho, rien n\'est rangé', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const sage = await client(SAGE);
  const relou = await client(RELOU);
  const temoin = await client(TEMOIN);
  const modo = await client(MODO);
  try {
    for (const c of [sage, relou, temoin, modo]) await c.rejoindre();

    // 1. Le message : au destinataire « (de X) », à l'auteur « (à X) », à personne d'autre.
    sage.dire(`/! ${MODO} un-secret &lt;3`);
    const recu = await modo.attendre(ligne('un-secret'), 'le message privé');
    assert.match(recu, / st="pv"/, 'marqué message privé : ' + recu);
    assert.match(recu, new RegExp(`\\(de <b>${SAGE}</b>\\)`, 'i'), 'il dit de qui : ' + recu);
    assert.match(recu, /&lt;3/, 'le texte reste du texte : ' + recu);
    assert.ok(!/ mi="/.test(recu), 'pas de numéro de message : il n\'est pas rangé');
    const echo = await sage.attendre(ligne('un-secret'), 'l\'écho de l\'auteur');
    assert.match(echo, new RegExp(`\\(à <b>${MODO}</b>\\)`, 'i'), 'l\'écho dit à qui : ' + echo);
    await wait(300);
    assert.ok(!temoin.trames.some((x) => x.includes('un-secret')), 'le témoin ne le voit pas');
    assert.ok(!relou.trames.some((x) => x.includes('un-secret')), 'le reste du salon non plus');

    // Ni logs, ni rejeu.
    const logs = await (await fetch(`${BASE}/api/chat/histo?sid=${sids[TEMOIN]}&g=pomme`)).text();
    assert.ok(!logs.includes('un-secret'), 'rien dans les logs');
    const modo2 = await client(MODO);
    try {
      await modo2.rejoindre();
      await wait(500);
      assert.ok(!modo2.trames.some((x) => x.includes('un-secret')), 'rien au rejeu, pas même pour le destinataire');
    } finally { modo2.fermer(); }

    // 2. Les refus : syntaxe, absent du salon, soi-même.
    sage.dire('/!');
    await sage.attendre(ligne('Syntaxe : /!'), 'la syntaxe');
    sage.dire('/! personne_ici bonjour');
    await sage.attendre(ligne('n\'est pas dans ce salon'), 'l\'absent');
    sage.dire(`/! ${SAGE} moi-meme`);
    await sage.attendre(ligne('à toi-même'), 'soi-même');

    // 3. La liste noire du destinataire arrête le message — sauf d'un modérateur.
    temoin.dire(`/ignore ${SAGE}`);
    await temoin.attendre(ligne('Tu ignores désormais'), 'le témoin ignore le sage');
    sage.dire(`/! ${TEMOIN} tu-m-entends`);
    await sage.attendre(ligne('ne reçoit pas les messages privés'), 'la réponse neutre');
    temoin.dire(`/ignore ${MODO}`);
    await temoin.attendre(ligne('est modérateur'), 'on n\'ignore pas un modérateur');
    modo.dire(`/! ${TEMOIN} parole-de-modo`);
    await temoin.attendre(ligne('parole-de-modo'), 'le modérateur passe');
    await wait(300);
    assert.ok(!temoin.trames.some((x) => x.includes('tu-m-entends')), 'le message de l\'ignoré n\'est pas remis');
    temoin.dire(`/unignore ${SAGE}`);
    await temoin.attendre(ligne('Tu n\'ignores plus'), 'retrait');

    // 4. La trame d'époque du SWF : <bk g u t="w">, même chemin, pas d'écho sur sa socket.
    const bureau = await client(SAGE, false);
    try {
      await bureau.rejoindre();
      bureau.envoyer(`<bk g="pomme" u="${TEMOIN}" t="w">depuis-le-bureau</bk>`);
      const viaSwf = await temoin.attendre(ligne('depuis-le-bureau'), 'le message venu du SWF');
      assert.match(viaSwf, / st="pv"/);
      await sage.attendre(ligne('depuis-le-bureau'), 'l\'écho sur l\'autre fenêtre de l\'auteur');
      await wait(300);
      assert.ok(!bureau.trames.some((x) => x.includes('depuis-le-bureau')), 'le SWF a déjà écrit « Envoyé à » : pas de doublon');
      assert.ok(!relou.trames.some((x) => x.includes('depuis-le-bureau')), 'personne d\'autre');
    } finally { bureau.fermer(); }

    // 5. /aide répond au light et cite les deux commandes.
    sage.dire('/aide');
    const aide = await sage.attendre(ligne('Commandes du chat'), 'l\'aide');
    assert.match(aide, /\/! pseudo message/);
    assert.match(aide, /\/ignore pseudo/);

    // 6. La cadence : cinq d'affilée passent, le sixième attend.
    for (let i = 1; i <= 6; i++) relou.dire(`/! ${MODO} rafale-${i}`);
    await relou.attendre(ligne('Doucement'), 'le frein');
    await modo.attendre(ligne('rafale-5'), 'les cinq premiers');
    await wait(300);
    assert.ok(!modo.trames.some((x) => x.includes('rafale-6')), 'le sixième ne part pas');
  } finally { for (const c of [sage, relou, temoin, modo]) c.fermer(); }
});
