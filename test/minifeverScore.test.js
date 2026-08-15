/*
 * Mini-Fever — la fin de partie côté serveur.
 *
 * Le jeu n'a jamais eu de score : Arcade.mt compte des ÉPREUVES et des VIES,
 * rien d'autre. Le classement est donc de nous, et il tient à deux décisions —
 * le client n'envoie PAS de points, il envoie le déroulé de sa partie (le
 * serveur calcule, et refuse ce qui ne tient pas debout au regard des paliers
 * du jeu) ; et UN SEUL tableau, au barème affiché : dix points l'épreuve
 * remportée, fois (1 + palier) — choisir plus dur rapporte plus, et la règle
 * s'écrit sur la page du jeu comme dans le libellé de chaque ligne.
 *
 * L'album suit la même règle que les monstres de MiniWave : une épreuve
 * remportée pour la première fois donne son picto.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3505;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PALIERS = require(path.join(ROOT, 'public/minifever/engine.js')).PALIERS;
const JEUX = require(path.join(ROOT, 'public/minifever/jeux.js')).JEUX;

let proc = null;
before(async () => {
  // Des lignes de la PARENTHÈSE aux quatre tableaux, semées avant le
  // démarrage : 30 épreuves en difficile et 40 en facile. Le boot doit les
  // replier dans le tableau unique en gardant la meilleure au barème —
  // 30 × 10 × 3 = 900 bat 40 × 10 × 1 = 400.
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { users: {} };
    if (!d.users) d.users = {};
    d.users['fevmig' + RUN] = {
      minifever_difficile: { score: 30, data: '', updatedAt: new Date().toISOString() },
      minifever_facile: { score: 40, data: '', updatedAt: new Date().toISOString() },
    };
    fs.writeFileSync(f, JSON.stringify(d));
  } catch (e) { throw new Error('semis de migration impossible : ' + e.message); }

  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5232', FRUTISCORE_PORT: '5233',
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
after(() => {
  if (proc) proc.kill('SIGKILL');
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('fev')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const joueur = (base) => 'fev' + base + RUN;

async function sidPour(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

const finir = (sid, corps) => fetch(BASE + '/api/minifever/score', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(Object.assign({ sid }, corps)),
}).then((r) => r.json());

test('le barème du tableau unique : dix points l\'épreuve, fois (1 + palier)', async () => {
  const sid = await sidPour(joueur('a'));
  const facile = await finir(sid, { palier: 0, niveau: 12, jouees: 15 });
  assert.equal(facile.ok, true);
  assert.equal(facile.score, 12 * 10 * 1);
  assert.equal(facile.classe, true);

  // La règle, noir sur blanc : la même partie en infernal vaut quatre fois
  // plus — choisir plus dur rapporte plus, dans le MÊME tableau.
  const infernal = await finir(sid, { palier: 3, niveau: 12, jouees: 15 });
  assert.equal(infernal.score, 12 * 10 * 4, 'une épreuve infernale vaut quatre faciles');
  assert.equal(infernal.classe, true, 'et elle passe donc devant');

  // Un score MOINDRE au barème ne remplace pas le record.
  const petit = await finir(sid, { palier: 0, niveau: 20, jouees: 22 });
  assert.equal(petit.score, 200);
  assert.equal(petit.classe, false, 'deux cents points ne délogent pas quatre cent quatre-vingts');
});

test('une partie qui ne tient pas debout est refusée', async () => {
  const sid = await sidPour(joueur('b'));
  const p = PALIERS[0];
  // Plus d'épreuves réussies que le palier n'en compte.
  assert.equal((await finir(sid, { palier: 0, niveau: p.lvl + 1, jouees: p.lvl + 1 })).error, 'niveau');
  // Plus d'échecs que de vies.
  assert.equal((await finir(sid, { palier: 0, niveau: 5, jouees: 5 + p.vies + 1 })).error, 'partie');
  // Moins d'épreuves jouées que réussies.
  assert.equal((await finir(sid, { palier: 0, niveau: 5, jouees: 4 })).error, 'partie');
  // Un palier qui n'existe pas — dont le cinquième, jamais utilisé par le jeu.
  assert.equal((await finir(sid, { palier: 9, niveau: 1, jouees: 1 })).error, 'palier');
  assert.equal((await finir(sid, { palier: 4, niveau: 1, jouees: 1 })).error, 'palier');
  // Et sans session valable, personne à classer. (Un sid VIDE ne prouverait
  // rien : la plateforme rattrape alors la dernière session vue depuis la même
  // adresse — getSidFromRequest, pour les vieux appels Flash qui l'omettent.)
  const anonyme = await finir('sid-qui-nexiste-pas', { palier: 0, niveau: 5, jouees: 5 });
  assert.equal(anonyme.error, 'session');
});

test('une épreuve remportée entre à l\'album, une seule fois', async () => {
  const u = joueur('c');
  const sid = await sidPour(u);
  const r = await finir(sid, { palier: 0, niveau: 2, jouees: 3, gagnees: ['gameBasket', 'gameLander'] });
  assert.deepEqual(r.pictos.sort(), ['Alunissage', 'Panier']);

  // Rejouée, elle ne redonne rien ; une nouvelle, si.
  const r2 = await finir(sid, { palier: 0, niveau: 3, jouees: 3, gagnees: ['gameBasket', 'gameFlower'] });
  assert.deepEqual(r2.pictos, ['Arrosage']);

  // Une clef inconnue ne débloque rien.
  const r3 = await finir(sid, { palier: 0, niveau: 1, jouees: 1, gagnees: ['gameInexistant', '$ultitem'] });
  assert.deepEqual(r3.pictos, []);

  // Et l'album affiche bien ce qu'on a gagné.
  const inv = await (await fetch(`${BASE}/api/pictos?sid=${encodeURIComponent(sid)}`)).json();
  const miens = inv.filter((p) => (p.game || p.category) === 'Mini-Fever').map((p) => p.name || p.item);
  assert.equal(miens.length, 3, `trois pictos Mini-Fever (${JSON.stringify(miens)})`);
});

/*
 * Le piège à éviter : la consécration partage cent points entre les jeux
 * ACTIFS (computeConsecration : 100 / enabled.length). Y ajouter Mini-Fever
 * ferait baisser le pourcentage de TOUS les joueurs du jour au lendemain, et
 * donnerait à quatre épreuves sur vingt-sept le même poids qu'à MiniWave tout
 * entier. Ses pictos comptent donc pour l'album, pas pour la consécration —
 * comme les pictos inédits de l'admin.
 */
test('les pictos Mini-Fever ne touchent pas à la consécration', async () => {
  const sid = await sidPour(joueur('e'));
  const avant = await (await fetch(`${BASE}/api/consecration?sid=${encodeURIComponent(sid)}`)).json();
  await finir(sid, { palier: 0, niveau: 4, jouees: 4, gagnees: JEUX.map((j) => j.cle) });
  const apres = await (await fetch(`${BASE}/api/consecration?sid=${encodeURIComponent(sid)}`)).json();
  assert.equal(apres.enabledCount, avant.enabledCount, 'le nombre de jeux comptés ne bouge pas');
  assert.equal(apres.overall, avant.overall, 'et le pourcentage non plus');
  assert.ok(!(apres.games || []).some((g) => g.id === 'minifever'),
    'Mini-Fever n\'apparaît pas dans le détail');
  // Mais les pictos, eux, sont bien là.
  const inv = await (await fetch(`${BASE}/api/pictos?sid=${encodeURIComponent(sid)}`)).json();
  assert.equal(inv.filter((p) => (p.game || p.category) === 'Mini-Fever').length, JEUX.length);
});

test('chaque épreuve portée a son picto, et son image existe', async () => {
  for (const j of JEUX) {
    const nom = j.cle.replace(/^game/, '').toLowerCase();
    const f = path.join(ROOT, 'public/minifever/pictos', nom + '.svg');
    assert.ok(fs.existsSync(f), `${j.cle} a son image (${nom}.svg)`);
    const svg = fs.readFileSync(f, 'utf8');
    assert.match(svg, /^<\?xml/, 'un vrai SVG');
    assert.ok(svg.length > 500, `${nom}.svg n'est pas vide`);
  }
  // La jaquette du disque, pour la feuille de lancement du light.
  assert.ok(fs.existsSync(path.join(ROOT, 'public/fb/fd_minifever.svg')));
});

test('le classement du light : un seul onglet Mini-Fever, la règle sur chaque ligne', async () => {
  const sid = await sidPour(joueur('d'));
  await finir(sid, { palier: 2, niveau: 30, jouees: 33 });
  const d = await (await fetch(`${BASE}/api/light/challenge?sid=${encodeURIComponent(sid)}`)).json();
  const onglets = (d.games || []).filter((g) => g.game === 'minifever');
  assert.equal(onglets.length, 1, 'un seul tableau pour tous les modes');
  assert.equal(onglets[0].id, 'minifever_arcade');
  assert.equal(onglets[0].name, 'Mini-Fever');
  const moi = onglets[0].scores.find((s) => s.isMe);
  assert.ok(moi, 'ma partie y figure');
  assert.equal(moi.score, 30 * 10 * 3);
  assert.equal(moi.label, '900 · 30 épreuves en difficile',
    'le libellé dit les points ET d\'où ils viennent');
});

test('la parenthèse des tableaux par palier se replie au boot, meilleure ligne gardée', async () => {
  // Les lignes semées avant le démarrage : 30 épreuves en difficile, 40 en
  // facile. Au barème, 900 bat 400 — le tableau unique doit montrer 900,
  // palier difficile, et les tableaux par palier ne plus exister.
  const d = await (await fetch(`${BASE}/api/light/challenge`)).json();
  assert.ok(!(d.games || []).some((g) => /^minifever_(facile|normal|difficile|infernal)$/.test(g.id)),
    'plus de tableaux par palier');
  const jeu = (d.games || []).find((g) => g.id === 'minifever_arcade');
  const migre = jeu.scores.find((s) => s.user === 'fevmig' + RUN);
  assert.ok(migre, 'la ligne a rejoint le tableau unique');
  assert.equal(migre.score, 900, 'la meilleure des deux au barème');
  assert.equal(migre.label, '900 · 30 épreuves en difficile');
});

test('le FD du bureau : un disque à anneau rouge, détourné vers le portage HTML', async () => {
  const sid = await sidPour(joueur('f'));
  // Le disque est dans « Mes disques » de main.swf (catalogue statique).
  const coll = await (await fetch(`${BASE}/ff/ls?uid=disccollector&sid=${encodeURIComponent(sid)}`)).text();
  assert.match(coll, /u="minifeverlight"/, 'le disque est au catalogue');
  assert.match(coll, /u="minifeverlight"[^>]*>3\n/, 'anneau rouge (discType 3) : jamais consommé');
  // Son lancement (do/ld) porte le marqueur `light/minifever`, que ruffle.html
  // détourne vers /minifever/ au lieu de Ruffle.
  const ld = await (await fetch(`${BASE}/do/ld?u=minifeverlight&sid=${encodeURIComponent(sid)}`)).text();
  assert.match(ld, /u="light\/minifever"/, 'le marqueur light');
  assert.match(ld, /t="3"/, 'et le type rouge voyage avec');
  const ruffle = await (await fetch(`${BASE}/ruffle.html`)).text();
  assert.match(ruffle, /"light\/minifever": \{ url: "\/minifever\/"/, 'ruffle.html sait où l\'ouvrir');
});

test('le jeu se sert et se lance depuis le light', async () => {
  const page = await (await fetch(BASE + '/minifever/')).text();
  assert.match(page, /Mini-Fever/);
  assert.match(page, /10 pts par épreuve remportée/, 'le barème est écrit sur la page');
  for (const f of ['engine.js', 'client.js', 'jeux.js']) {
    const r = await fetch(BASE + '/minifever/' + f);
    assert.equal(r.status, 200, `/minifever/${f} est servi`);
  }
  const m = await (await fetch(BASE + '/minifever/sprites/sprites.json')).json();
  assert.ok(m.gameBasket, 'les dessins aussi');

  const light = await (await fetch(BASE + '/light.html')).text();
  assert.match(light, /minifever-frame/, 'le panneau existe');
  assert.match(light, /fd_minifever\.svg/, 'et son disque est dans la feuille de lancement');
});
