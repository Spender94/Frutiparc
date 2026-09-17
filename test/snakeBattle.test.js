/*
 * Frutisnake — le BATTLE EN LIGNE, de bout en bout sur le serveur.
 *
 * On parle le protocole du jeu (<k> puis <sb>, sur le WebSocket), pas une
 * API de raccourci : c'est le chemin qu'emprunte une vraie partie. Deux
 * joueurs se cherchent, la partie part avec les files entières, le serveur
 * pousse ses pas à quarante par seconde aux SEULES sockets du jeu, l'abandon
 * fait gagner l'autre, et les deux notes d'Elo bougent — la fiche vit dans le
 * slot 2 du disque snake3, la note au classement « Frutisnake - Championnat »,
 * que le livre des records montre.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const RACINE = path.join(__dirname, '..');
const PORT = 3447;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-7);
const joueur = (nom) => nom + RUN;

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5162', FRUTISCORE_PORT: '5163',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(async () => {
  if (serverProc) serverProc.kill('SIGKILL');
  await wait(300);
  try {
    const fichier = path.join(RACINE, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) {
      if (u.slice(-RUN.length) === RUN) delete d.users[u];
    }
    fs.writeFileSync(fichier, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml); return m ? m[1] : null; };

// Une socket du jeu : <k> (identification), puis <sb a="hello">. `recus`
// garde tout ce qui arrive ; `tag` ne garde que <sb>, `autres` le reste.
function connecter(pseudo, sid, jeu) {
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
        if (jeu !== false) ws.send(`<sb a="hello" n="${pseudo}" />\0`);
        setTimeout(() => resolve({
          ws, recus, pseudo,
          envoyer: (s) => ws.send(s + '\0'),
          sb: () => recus.filter((m) => m.indexOf('<sb') === 0),
          dernier: (e) => recus.filter((m) => m.indexOf('<sb') === 0 && attr(m, 'e') === e).pop() || null,
          fermer: () => ws.close(),
        }), 400);
      }, 300);
    });
  });
}

const livre = async () => {
  const j = await (await fetch(BASE + '/api/club/records?limit=50')).json();
  return (j.rankings || []).find((r) => r.id === 'snake3_battle');
};

test('deux joueurs se cherchent, la partie part, le serveur pousse ses pas aux seules sockets du jeu', async () => {
  const [sa, sb] = [await sidFor(joueur('kiwi')), await sidFor(joueur('mangue'))];
  const A = await connecter(joueur('kiwi'), sa);
  const B = await connecter(joueur('mangue'), sb);
  // Une socket du MÊME joueur qui ne joue pas (son salon de chat) : elle ne
  // doit pas recevoir les quarante pas par seconde.
  const chatA = await connecter(joueur('kiwi'), sa, false);

  const salon = A.dernier('lobby');
  assert.ok(salon, 'le salon arrive au hello');
  assert.ok(salon.indexOf(`u="${joueur('kiwi')}"`) > 0 && salon.indexOf(`u="${joueur('mangue')}"`) > 0, salon);
  assert.ok(/bot="1"/.test(salon), 'les bots sont là');

  A.envoyer('<sb a="seek" />');
  await wait(300);
  assert.ok(/s="waiting"/.test(A.dernier('lobby')), 'A attend');
  B.envoyer('<sb a="seek" />');
  await wait(600);
  const startA = A.dernier('start'), startB = B.dernier('start');
  assert.ok(startA && startB, 'la partie part des deux côtés');
  assert.strictEqual(attr(startA, 'ph'), 'compte');
  assert.ok(startA.indexOf('file="10,60') > 0, 'la file entière voyage au départ');
  assert.ok(startA.indexOf(`<p u="${joueur('kiwi')}"`) > 0);

  // Les pas : quarante par seconde, à peu près, aux deux joueurs.
  const nA = A.sb().filter((m) => attr(m, 'e') === 'state').length;
  await wait(1000);
  const dA = A.sb().filter((m) => attr(m, 'e') === 'state').length - nA;
  assert.ok(dA >= 30 && dA <= 50, 'environ quarante pas en une seconde : ' + dA);
  assert.ok(B.sb().filter((m) => attr(m, 'e') === 'state').length >= 30);
  assert.strictEqual(chatA.sb().length, 0, 'la socket de chat ne reçoit rien du jeu');

  // Les touches d'A, puis l'abandon de B : A gagne 24 points, B les rend (placement).
  A.envoyer('<sb a="input" g="1" d="0" h="0" />');
  B.envoyer('<sb a="part" />');
  await wait(600);
  const finA = A.dernier('end'), finB = B.dernier('end');
  assert.ok(finA && finB, 'la fin arrive aux deux');
  assert.strictEqual(attr(finA, 'w'), '0');
  assert.strictEqual(attr(finA, 'r'), 'forfeit');
  assert.ok(finA.indexOf(`<p u="${joueur('kiwi')}" n="${joueur('kiwi')}" e="0" f="" no="1024" dn="24"/>`) > 0, finA);
  assert.ok(finA.indexOf(`<p u="${joueur('mangue')}" n="${joueur('mangue')}" e="1" f="" no="976" dn="-24"/>`) > 0, finA);
  assert.ok(/s="idle"/.test(A.dernier('lobby')), 'le salon a rendu les deux');
  assert.ok(new RegExp(`u="${joueur('kiwi')}" [^>]*no="1024" pj="1"`).test(A.dernier('lobby')), 'la note se voit au salon');

  // Le classement : les deux notes, au livre des records.
  await wait(300);
  const l = await livre();
  assert.ok(l, 'snake3_battle au livre des records');
  assert.strictEqual(l.name, 'Frutisnake - Championnat');
  assert.ok(l.scores.some((s) => s.user === joueur('kiwi') && s.score === 1024), 'la note d’A');
  assert.ok(l.scores.some((s) => s.user === joueur('mangue') && s.score === 976), 'celle de B');
  // La fiche vit dans le slot 2 du disque snake3 — victoires, défaites, nulles,
  // note, minimum, maximum — sans toucher à la collection (slot 0).
  const txt = await (await fetch(BASE + '/api/loadFrutiSlots?sid=' + sa + '&game=snake3')).text();
  const slot2 = /(?:^|&)slot2=([^&]*)/.exec(txt);
  assert.ok(slot2, 'le slot 2 est servi : ' + txt.slice(0, 80));
  assert.deepStrictEqual(JSON.parse(decodeURIComponent(slot2[1])), { linit: true, l: [1, 0, 0], ls: [1024, 1024, 1024] });
  // Une reconnexion relit la fiche chez l'hôte : la note tient.
  A.fermer();
  await wait(300);
  const A2 = await connecter(joueur('kiwi'), sa);
  assert.ok(new RegExp(`u="${joueur('kiwi')}" [^>]*no="1024" pj="1"`).test(A2.dernier('lobby')), 'la note revient avec le joueur');
  A2.fermer();

  A.fermer(); B.fermer(); chatA.fermer();
  await wait(300);
});

test('la déconnexion en partie vaut abandon, et un défi part sur-le-champ', async () => {
  const [sa, sb] = [await sidFor(joueur('cerise')), await sidFor(joueur('prune'))];
  const A = await connecter(joueur('cerise'), sa);
  const B = await connecter(joueur('prune'), sb);
  A.envoyer(`<sb a="challenge" u="${joueur('prune')}" />`);
  await wait(500);
  assert.ok(B.dernier('start'), 'le défié est en partie sans rien accepter');
  A.fermer();
  await wait(800);
  const fin = B.dernier('end');
  assert.ok(fin, 'la fin arrive au joueur resté');
  assert.strictEqual(attr(fin, 'w'), '1');
  assert.strictEqual(attr(fin, 'r'), 'forfeit');
  assert.ok(!new RegExp(`u="${joueur('cerise')}"`).test(B.dernier('lobby')), 'le parti n’est plus au salon');
  B.fermer();
  await wait(300);
});
