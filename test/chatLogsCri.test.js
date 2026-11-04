/*
 * LE CRI ROUGE NE FAIT PLUS CLIGNOTER, ET /LOG OUVRE LES LOGS.
 *
 * Deux signalements de l'admin sur les salons :
 *
 *   · « Quand quelqu'un écrit en rouge, le chat clignote comme pour une
 *     authentification. » Le rouge, c'est le cri d'un modérateur (`!message`,
 *     trame `st="r"`, aussi l'appel « il y a des problèmes sur ce salon »).
 *     Le light le comptait parmi ce qui « s'adresse à moi » (`pourMoi`) et
 *     faisait donc clignoter l'onglet du salon (BureauFrutiz.avertirConversation)
 *     comme pour un message privé. Il ne clignote plus ; une mention DANS le
 *     cri, un « @all », un « /! » reçu et une discussion privée, si.
 *   · « /log /logs /chatlog /chatlogs ne marchent pas. » Le light (et le
 *     bureau, qui passe par le même `traiterCommande`) n'en connaissait
 *     aucune : la ligne partait au serveur → « Commande inconnue ». Elles
 *     ouvrent désormais /api/chat/histo du salon où l'on tape. Le serveur, lui,
 *     répond à ce qui lui parvient encore (le SWF fait suivre /chatlog et
 *     /chatlogs) par le lien d'époque, au seul demandeur — rien n'est diffusé.
 *     Et le SWF ouvre /log, /logs, /histo à tous (patch-main-logs-tous.js).
 *
 * La partie « serveur vivant » demande le PostgreSQL de test (port 5433) ;
 * sans lui, elle est sautée.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const BUREAU = fs.readFileSync(path.join(ROOT, 'public', 'bureau-frutiz.js'), 'utf8');

// ── A. Le clignotement ──────────────────────────────────────────────────────

// La ligne `var pourMoi = …` du light, évaluée pour de bon avec des doublures.
function pourMoiPour({ st, au, mn = [], ma = false, rj = false, prive = false, moi = 'moi' }) {
  const t = LIGHT.indexOf('case "t":');
  const ligne = LIGHT.slice(t).match(/var chuchoPourMoi = [^\n]+\n\s*var pourMoi = [^\n]+/);
  assert.ok(ligne, 'les lignes chuchoPourMoi / pourMoi existent');
  const attrs = { st: st || '', au: au || '' };
  const ctx = {
    xml: null,
    enRejeu: rj,
    nommes: mn.slice(),
    aTous: ma,
    salon: prive ? 'pm_moi_toi' : 'pomme',
    state: { user: moi, userLower: moi.toLowerCase() },
    attr: (_x, n) => attrs[n] || '',
    xmlUnescape: (s) => s,
    sameName: (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
    estPrive: (s) => /^pm2?_/.test(s),
    meMentionne: (noms) => noms.some((n) => n.toLowerCase() === moi.toLowerCase()),
  };
  vm.runInNewContext(ligne[0] + '\nthis.resultat = pourMoi;', ctx);
  return ctx.resultat;
}

test('un cri rouge (st="r") ne fait plus clignoter l\'onglet d\'un salon public', () => {
  assert.doesNotMatch(LIGHT, /var pourMoi = [^\n]*"st"\) === "r"/,
    'le cri n\'entre plus dans « ce qui s\'adresse à moi »');
  assert.strictEqual(pourMoiPour({ st: 'r', au: 'modo' }), false, 'un cri seul : rien ne clignote');
  // L'appel « il y a des problèmes sur ce salon » part aussi en st="r", sans auteur.
  assert.strictEqual(pourMoiPour({ st: 'r' }), false, 'l\'appel aux modérateurs non plus');
  // Le reste du salon : rien non plus, comme avant.
  assert.strictEqual(pourMoiPour({}), false, 'une ligne ordinaire : rien');
});

test('les vrais appels clignotent toujours : mention, @all, /! reçu, privé', () => {
  assert.strictEqual(pourMoiPour({ st: 'r', mn: ['Moi'] }), true, 'un cri qui ME nomme avertit (par la mention)');
  assert.strictEqual(pourMoiPour({ mn: ['moi'] }), true, 'une @mention');
  assert.strictEqual(pourMoiPour({ ma: true }), true, 'un « @all » du staff');
  assert.strictEqual(pourMoiPour({ st: 'pv', au: 'toi' }), true, 'un « /! » reçu');
  assert.strictEqual(pourMoiPour({ st: 'pv', au: 'moi' }), false, 'pas l\'écho de mon propre « /! »');
  assert.strictEqual(pourMoiPour({ prive: true }), true, 'une discussion privée');
  assert.strictEqual(pourMoiPour({ mn: ['moi'], rj: true }), false, 'jamais un rejeu');
  // Le câblage autour ne bouge pas : le salon regardé passe par pourMoi, une
  // conversation privée en arrière-plan avertit toujours, le bureau relaie.
  assert.match(LIGHT, /if \(!enRejeu\) avertirOngletChat\(ty, salon, pourMoi\);/);
  assert.match(LIGHT, /conv\.nonLus \+= 1;[\s\S]*?avertirOngletChat\(ty, salon, true\);/);
  assert.match(LIGHT, /function avertirOngletChat\(ty, salon, pourMoi\) \{\s*\n\s*if \(ty === "b" \|\| ty === "i"\) return;\s*\n\s*if \(pourMoi === false\) return;/);
  assert.match(BUREAU, /function avertirConversation\(salon\) \{[\s\S]*?return avertirSlot\(f\.onglet \|\| 'bureau'\);/);
  // Le bureau ne regarde pas lui-même la couleur d'une ligne : seul le light décide.
  assert.doesNotMatch(BUREAU, /st[=:]\s*["']r["']|"st"\)\s*===\s*"r"/, 'bureau-frutiz.js ne lit pas st="r"');
});

test('le cri garde son rendu rouge — seule l\'alerte s\'en va', () => {
  assert.match(LIGHT, /var isShout = \(attr\(xml, "st"\) === "r"\);/);
  assert.match(LIGHT, /kind: isShout \? "shout" : "admin"/);
});

// ── B. /log, /logs, /chatlog, /chatlogs ─────────────────────────────────────

// `traiterCommande` et `ouvrirLogs`, extraits et lancés avec un window.open espion.
function lightCommandes() {
  const debut = LIGHT.indexOf('var CMD_LOGS = ');
  const fin = LIGHT.indexOf('\n  }\n', LIGHT.indexOf('function traiterCommande(texte, salon) {')) + 4;
  const fo = LIGHT.indexOf('function ouvrirLogs(room) {');
  const foFin = LIGHT.indexOf('\n  }\n', fo) + 4;
  assert.ok(debut > 0 && fin > debut && fo > 0, 'CMD_LOGS, traiterCommande et ouvrirLogs existent');
  const ouverts = [];
  const autres = [];
  const ctx = {
    state: { sid: 'SID123', room: 'pomme' },
    window: { open: (u, nom) => ouverts.push({ u, nom }) },
    CMD_DON: ['/donne'], CMD_IMAGE: ['/image'], CMD_QUOTA: ['/quota'], CMD_KICK: ['/kick'], CMD_TOTOCHE: ['/totoch'],
    commandeDon: () => autres.push('don'), commandeImage: () => autres.push('image'),
    commandeQuota: () => autres.push('quota'), commandeModeration: () => autres.push('modo'),
    encodeURIComponent,
  };
  vm.runInNewContext(LIGHT.slice(debut, fin) + '\n' + LIGHT.slice(fo, foFin)
    + '\nthis.traiterCommande = traiterCommande;', ctx);
  return { traiter: ctx.traiterCommande, ouverts, autres, state: ctx.state };
}

test('light et bureau : /log, /logs, /chatlog, /chatlogs (et /histo) ouvrent les logs du salon', () => {
  const L = lightCommandes();
  for (const cmd of ['/log', '/logs', '/chatlog', '/chatlogs', '/histo', '/LOGS', '  /chatlogs  ']) {
    L.ouverts.length = 0;
    assert.strictEqual(L.traiter(cmd, 'sal_bavards'), true, cmd + ' est traitée (elle ne part pas au serveur)');
    assert.strictEqual(L.ouverts.length, 1, cmd + ' ouvre une fenêtre');
    assert.strictEqual(L.ouverts[0].u, '/api/chat/histo?sid=SID123&g=sal_bavards', cmd + ' : les logs DU salon où l\'on tape');
    assert.strictEqual(L.ouverts[0].nom, 'fp_histo');
  }
  // Sans salon donné, celui qu'on regarde.
  L.ouverts.length = 0;
  L.traiter('/logs', '');
  assert.strictEqual(L.ouverts[0].u, '/api/chat/histo?sid=SID123&g=pomme');
  // Pas de faux positifs : /login, /logsx… ne sont pas des commandes de logs.
  L.ouverts.length = 0;
  assert.strictEqual(L.traiter('/login', 'pomme'), false);
  assert.strictEqual(L.traiter('/logsx', 'pomme'), false);
  assert.strictEqual(L.ouverts.length, 0);
  // Les commandes d'avant passent toujours.
  assert.strictEqual(L.traiter('/donne 3 toto', 'pomme'), true);
  assert.deepStrictEqual(L.autres, ['don']);

  // Les deux saisies — le panneau mobile et chaque fenêtre de salon du bureau
  // (envoyerDansSalon) — passent par traiterCommande, avec LEUR salon.
  assert.match(LIGHT, /if \(text\.charAt\(0\) === "\/" && traiterCommande\(text, state\.room\)\)/);
  assert.match(LIGHT, /function envoyerDansSalon\(salon, texte, inp\) \{[\s\S]*?traiterCommande\(text, salon\)/);
  assert.match(LIGHT, /envoyerDansSalon\(c\.salon, inp \? inp\.value : "", inp\);/);
  // Le lien « … voir les messages précédents … » ouvre la même fenêtre.
  assert.match(LIGHT, /systemAction\("", "\.\.\. voir les messages précédents \.\.\.", function \(\) \{\s*ouvrirLogs\(room\);/);
});

test('serveur : /log… répond au seul demandeur par le lien des logs, avant « Commande inconnue »', () => {
  const i = SRV.indexOf("if (/^\\/(log|logs|chatlog|chatlogs|histo)\\s*$/i.test(text)) {");
  assert.ok(i > 0, 'le serveur reconnaît les cinq mots');
  const bloc = SRV.slice(i, SRV.indexOf('break;', i));
  assert.match(bloc, /sendToClient\(socket,/, 'réponse privée');
  assert.doesNotMatch(bloc, /broadcastToChannel/, 'rien n\'est diffusé au salon');
  assert.match(bloc, /javascript:fp_openHisto\('\$\{propre\(client\.sid\)\}','\$\{propre\(g\)\}'\)/, 'le lien d\'époque (box.Chat.onIamMode)');
  const inconnue = SRV.indexOf('<i>Commande inconnue.</i>');
  assert.ok(inconnue > i, 'traité avant le rejet des commandes inconnues');
  // /aide les cite.
  const aide = SRV.slice(SRV.indexOf("if (/^\\/(aide|help|\\?|commandes)\\s*$/i.test(text)) {"));
  assert.match(aide.slice(0, 1500), /'\/log, \/logs, \/chatlog ou \/chatlogs — les logs du salon/);
});

test('SWF : /log, /logs et /histo sautent la garde du staff et ouvrent fp_openHisto', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'legacy', 'main.swf'));
  const corps = raw.slice(0, 3).toString('latin1') === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  for (const [adr, mot] of [[0x2a8d4, '/log'], [0x2a8e4, '/logs'], [0x2a8f4, '/histo']]) {
    assert.strictEqual(corps[adr], 0x9d, mot + ' : un ActionIf');
    assert.strictEqual(adr + 5 + corps.readInt16LE(adr + 3), 0x2c15e, mot + ' mène droit à l\'ouverture');
  }
  // L'ouverture est bien le getURL de fp_openHisto (le Push passe par le
  // ConstantPool : on lit le désassemblage plutôt que les octets).
  const { execFileSync } = require('node:child_process');
  const asm = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'disasm-as2.js'),
    path.join(ROOT, 'legacy', 'main.swf'), '0x2a48a'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.match(asm, /0x2c15e\s+Push "javascript:fp_openHisto\('"/);
  assert.match(asm, /Push "\/logs"\s*\n\s*0x[0-9a-f]+\s+StrictEquals\s*\n\s*0x2a8e4\s+If -> 0x2c15e/);
  // Et la page la reçoit.
  const ruffle = fs.readFileSync(path.join(ROOT, 'public', 'ruffle.html'), 'utf8');
  assert.match(ruffle, /window\.fp_openHisto = function \(sid, group\)/);
});

// ── C. Le serveur vivant ────────────────────────────────────────────────────

const PORT = 3647;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_logscri';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LECTEUR = 'lecteur' + RUN;
const VOISIN = 'voisin' + RUN;
let proc = null, dispo = false;
const sids = {};

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
      ADMIN_KEY: 'cle-de-test-logs', XMLSOCKET_PORT: '5647', FRUTISCORE_PORT: '5648',
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

async function client(pseudo, light) {
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
  ws.send(`<k l="${pseudo}" s="${sids[pseudo]}"${light ? ' lc="1"' : ''} />\0`);
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
    rejoindre: async () => {
      ws.send('<o g="pomme" />\0');
      await c.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'liste du salon');
    },
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}

test('serveur vivant : /chatlog(s) du SWF → le lien, à lui seul ; la page s\'ouvre à un frutiz ordinaire', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  for (const p of [LECTEUR, VOISIN]) sids[p] = await inscrire(p);
  const lecteur = await client(LECTEUR, false);     // le SWF
  const voisin = await client(VOISIN, true);
  try {
    await lecteur.rejoindre();
    await voisin.rejoindre();
    for (const cmd of ['/chatlog', '/chatlogs', '/log', '/logs']) {
      lecteur.trames.length = 0;
      lecteur.dire(cmd);
      const rep = await lecteur.attendre((x) => x.startsWith('<t') && x.includes('fp_openHisto'), 'le lien des logs pour ' + cmd);
      assert.ok(rep.includes(`fp_openHisto('${sids[LECTEUR]}','pomme')`), cmd + ' : sa session et le salon — ' + rep);
      assert.ok(!rep.includes('Commande inconnue'), cmd + ' n\'est plus inconnue');
    }
    lecteur.dire('/aide');
    const aide = await lecteur.attendre((x) => x.startsWith('<t') && x.includes('Commandes du chat'), '/aide');
    assert.match(aide, /\/chatlogs/, '/aide cite les commandes des logs');
    await wait(300);
    assert.ok(!voisin.trames.some((x) => /chatlog|fp_openHisto|\/logs?\b/.test(x)), 'le voisin ne voit rien passer');
    // Les logs sont à tous : un frutiz sans rôle les ouvre.
    const page = await fetch(`${BASE}/api/chat/histo?sid=${sids[LECTEUR]}&g=pomme`);
    assert.strictEqual(page.status, 200, 'la page des logs répond à un frutiz ordinaire');
  } finally { lecteur.fermer(); voisin.fermer(); }
});
