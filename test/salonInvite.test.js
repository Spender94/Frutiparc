'use strict';
/*
 * /invite pseudo — FAIRE ENTRER QUELQU'UN DANS UN SALON, depuis le light.
 *
 * « La commande /invite pseudo ne fonctionne pas sur light, c'est pourtant
 * primordial pour pouvoir créer des salons privés. » Le bureau Flash tape la
 * commande et c'est SON client qui l'envoie en trame `<ab u g r>` ; le light
 * envoyait la ligne telle quelle, et elle tombait en « Commande inconnue ». Et
 * l'invité sur le light ne savait pas lire `<ab>` : il ne voyait rien.
 *
 * Ici, deux frutiz branchés comme le light : l'un crée un salon de joueur,
 * l'invite par la commande tapée, l'autre reçoit l'invitation et entre. Les
 * réponses au demandeur sont en clair ; le chemin du Flash reste le même.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
const PORT = 3871;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOTE = 'invh' + RUN, INVITE = 'invi' + RUN, ABSENT = 'inva' + RUN;
const sids = {};
let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5871', FRUTISCORE_PORT: '5872',
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
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body })).json();
  assert.ok(j.sid, 'session pour ' + pseudo);
  return j.sid;
}

async function client(pseudo) {
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
  ws.send(`<k l="${pseudo}" s="${sids[pseudo]}" lc="1" />\0`);
  const c = {
    trames,
    envoyer: (x) => ws.send(x + '\0'),
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
  return c;
}

test('/invite pseudo, tapé dans le light : l’invité reçoit l’invitation et entre dans le salon privé', async () => {
  for (const p of [HOTE, INVITE, ABSENT]) sids[p] = await inscrire(p);
  const hote = await client(HOTE);
  const invite = await client(INVITE);
  try {
    // Le salon de joueur, comme le bouton « créer un salon » du light.
    hote.envoyer('<createChannel r="c1" n="Thé chez moi" />');
    const cree = await hote.attendre((x) => x.startsWith('<createChannel') && x.includes('r="c1"'), 'le salon créé');
    const g = /g="([^"]+)"/.exec(cree)[1];
    assert.match(g, /^sal_/);
    hote.envoyer(`<o g="${g}" />`);
    await hote.attendre((x) => x.startsWith('<p') && x.includes(`g="${g}"`), 'la liste du salon');
    const dire = (texte) => hote.envoyer(`<t g="${g}" t="m" p="">${texte}</t>`);
    const reponse = async (motif, quoi) => {
      const t = await hote.attendre((x) => x.startsWith('<t') && motif.test(x), quoi);
      hote.trames.splice(hote.trames.indexOf(t), 1);
      return t;
    };

    // L'invitation part, l'hôte le lit, l'invité la reçoit — avec le sujet.
    dire('/invite ' + INVITE);
    await reponse(/Invitation envoyée à/, 'l’accusé');
    const recue = await invite.attendre((x) => x.startsWith('<ab') && x.includes(`g="${g}"`), 'l’invitation');
    assert.ok(recue.includes(`u="${HOTE}"`), 'de la part de l’hôte : ' + recue);
    assert.match(recue, />Thé chez moi<\/ab>$/);
    assert.ok(!hote.trames.some((x) => /Commande inconnue/.test(x)), 'plus de « Commande inconnue »');

    // L'invité entre (le bouton « Rejoindre » du light envoie ce join).
    invite.envoyer(`<o g="${g}" />`);
    await invite.attendre((x) => x.startsWith('<p') && x.includes(`g="${g}"`), 'la liste du salon');
    dire('/invite ' + INVITE);
    await reponse(/est déjà dans ce salon/, 'déjà là');

    // Les autres réponses, en clair, à l'hôte seul.
    dire('/invite ' + ABSENT);
    await reponse(/n'est pas connecté\(e\)/, 'hors ligne');
    dire('/invite personne' + RUN);
    await reponse(/Aucun frutiz ne s'appelle/, 'inconnu');
    dire('/invite');
    await reponse(/Syntaxe : \/invite pseudo/, 'la syntaxe');
    await wait(200);
    assert.ok(!invite.trames.some((x) => /Syntaxe|Aucun frutiz|pas connecté/.test(x)), 'l’invité ne voit pas les réponses de l’hôte');

    // Le chemin du bureau Flash ne bouge pas : `<ab u g r>` → l'accusé `<ab u r>`.
    hote.envoyer(`<ab u="${ABSENT}" g="${g}" r="r9" />`);
    const acc = await hote.attendre((x) => x.startsWith('<ab') && x.includes('r="r9"'), 'l’accusé Flash');
    assert.ok(!/k="/.test(acc), 'succès : pas de code d’erreur — ' + acc);
    hote.envoyer(`<ab u="${INVITE}" g="${g}" r="r10" />`);
    assert.match(await hote.attendre((x) => x.startsWith('<ab') && x.includes('r="r10"'), 'déjà là, côté Flash'), /k="205"/);
  } finally { hote.fermer(); invite.fermer(); }
});

test('le light lit l’invitation : une ligne et un bouton « Rejoindre »', () => {
  const bloc = LIGHT.slice(LIGHT.indexOf('case "ab": {'), LIGHT.indexOf('// ── Invitation reçue : quelqu\'un nous écrit en privé ──'));
  assert.ok(bloc.length > 50, 'le case "ab" existe');
  assert.match(bloc, /if \(!salonInvite \|\| attr\(xml, "r"\) \|\| attr\(xml, "k"\)\) break;/, 'les accusés ne sont pas des invitations');
  assert.match(bloc, /systemAction\([\s\S]*?t'invite dans le salon[\s\S]*?"Rejoindre", function \(\) \{ ouvrirSalon\(salonInvite\); \}\);/);
});
