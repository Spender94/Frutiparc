/*
 * MiniWave — LE GRADE SUIT LA FICHE (« les grades ne se mettent pas à jour »).
 *
 * L'insigne de la fruticard (miniwave_rank) lit `$lvl`. Le jeu d'origine ne
 * l'écrivait qu'à la promotion (Menu.checkPowerUp, à l'accueil du menu), et le
 * portage light calculait le grade pour saluer le pilote sans jamais l'écrire.
 * Trois verrous, maintenant :
 *   · la fiche monte (majGrade / Plateforme.promouvoir) et le menu félicite ;
 *   · le serveur recalcule `$lvl` à chaque sauvegarde de la fiche ;
 *   · la fruticard pose l'insigne du grade CALCULÉ, jamais moins que l'écrit —
 *     même pour une fiche riche sauvée avant le correctif.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const P = require(path.join(RACINE, 'public/miniwave/plateforme.js'));
const Menu = require(path.join(RACINE, 'public/miniwave/menu.js'));
const NIVEAUX = require(path.join(RACINE, 'public/miniwave/levels.json'));
const FCard = require(path.join(RACINE, 'fruticard.js'));

// Une fiche de pilote chevronné : tableau de chasse plein, missions faites.
function ficheRiche() {
  const c = P.carteNeuve();
  c.$cons.$main = 100;
  c.$cons.$bonus = [100, 100, 100, 100, 100, 0, 0, 0];
  c.$badsKill = c.$badsKill.map(() => 5000);
  c.$arcade = { $bestScore: 12345, $bestLevel: 30 };
  c.$credit = 7;
  return c;
}
const insigne = (jeu, carte) => {
  const lignes = FCard.lignes(jeu, carte, 'pilote');
  for (const l of lignes) {
    for (const p of (l.list || [])) {
      if (p.type === 'url' && p.param && p.param.url === 'miniwave_rank') return p.param.param.frame;
    }
  }
  return null;
};

test('majGrade : la fiche monte au grade calculé, félicite, et ne redescend jamais', () => {
  const neuve = P.carteNeuve();
  assert.equal(P.majGrade(neuve), 0, 'un apprenti reste apprenti : rien à écrire');
  assert.equal(neuve.$lvl, 0);
  const c = ficheRiche();
  const attendu = P.grade(c);
  assert.ok(attendu > 0, 'un chevronné a un grade : ' + attendu);
  assert.equal(P.majGrade(c), attendu, 'la promotion rend le nouveau grade');
  assert.equal(c.$lvl, attendu, '…et la fiche le porte');
  assert.equal(P.majGrade(c), 0, 'déjà à ce grade : rien de neuf');
  c.$lvl = attendu + 3;
  assert.equal(P.majGrade(c), 0, 'une fiche qui porte plus haut garde son grade');
  assert.equal(c.$lvl, attendu + 3);
  assert.equal(P.majGrade({}), 0, 'une fiche cassée ne casse rien');
});

test('Plateforme.promouvoir écrit la fiche à la promotion, et seulement alors', async () => {
  const pf = new P.Plateforme('sid-test');
  pf.carte = ficheRiche();
  pf.charge = true;
  const ecrits = [];
  pf.ecrire = (avant) => { ecrits.push(JSON.parse(JSON.stringify(pf.carte))); return Promise.resolve({ enregistre: true }); };
  const g = pf.promouvoir();
  assert.ok(g > 0);
  assert.equal(ecrits.length, 1, 'une sauvegarde, celle de la promotion');
  assert.equal(ecrits[0].$lvl, g);
  assert.equal(pf.promouvoir(), 0);
  assert.equal(ecrits.length, 1, 'pas de sauvegarde pour rien');
});

test('à l’accueil du menu, la promotion s’annonce (Menu.checkPowerUp)', () => {
  const pf = new P.Plateforme('');
  pf.carte = ficheRiche();
  pf.charge = true;
  pf.ecrire = () => Promise.resolve({ enregistre: false });
  const sons = [];
  const menu = new Menu.Interface({
    canvas: { getContext: () => ({}) }, sprites: {}, poser: () => {},
    plateforme: pf, niveaux: NIVEAUX, surSon: (n) => sons.push(n), surChoix: () => {},
  });
  menu.ouvrir('accueil');
  assert.ok(pf.carte.$lvl > 0, 'la fiche porte le grade dès l’accueil');
  assert.match(String(menu.message || ''), /nouveau grade est : /);
  assert.ok(menu.message.indexOf(P.GRADES[pf.carte.$lvl]) > 0, menu.message);
  assert.ok(sons.indexOf('achat') >= 0, 'le son de la bonne nouvelle');
  // Le grade acquis, l'accueil suivant ne dit plus rien.
  menu.message = '';
  menu.ouvrir('accueil');
  assert.equal(menu.message, '');
});

test('la fruticard pose l’insigne du grade calculé, jamais moins que le $lvl écrit', () => {
  const c = ficheRiche();                       // $lvl encore à 0 : une fiche d'avant
  const g = P.grade(c);
  assert.equal(insigne('miniwave', c), g, 'l’insigne suit le tableau de chasse');
  assert.equal(insigne('miniwave2', c), g);
  c.$lvl = g + 2;
  assert.equal(insigne('miniwave', c), g + 2, 'un $lvl plus haut garde le dessus');
  assert.equal(insigne('miniwave', P.carteNeuve()), 0);
  assert.equal(insigne('miniwave', { $lvl: 4 }), 4, 'une fiche sans tableau de chasse : le $lvl écrit');
});

// ── Le serveur ─────────────────────────────────────────────────────────────

const PORT = 3449;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-7);
let proc;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-de-test', XMLSOCKET_PORT: '5166', FRUTISCORE_PORT: '5167',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(async () => {
  if (proc) proc.kill('SIGKILL');
  await wait(300);
  try {
    const fs = require('node:fs');
    const fichier = path.join(RACINE, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.slice(-RUN.length) === RUN) delete d.users[u];
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

test('le serveur recalcule $lvl à chaque sauvegarde de la fiche, et la fruticard le montre', async () => {
  const sid = await sidFor('pilote' + RUN);
  const c = ficheRiche();                       // $lvl à 0, comme une fiche du light d'avant
  const g = P.grade(c);
  const r = await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: JSON.stringify(c) }),
  });
  assert.ok(r.ok);
  const txt = await (await fetch(BASE + '/api/loadFrutiSlots?sid=' + sid + '&game=miniwave')).text();
  const fiche = JSON.parse(P.lireLoadVars(txt, '0'));
  assert.equal(fiche.$lvl, g, 'la fiche rangée porte le grade calculé');
  assert.equal(fiche.$credit, 7, 'le reste de la fiche est intact');
  const carte = await (await fetch(BASE + '/api/light/fruticard?sid=' + sid + '&g=miniwave')).json();
  assert.ok(carte && Array.isArray(carte.lignes), 'la fruticard se dessine');
  let frame = null;
  for (const l of carte.lignes) {
    for (const p of (l.list || [])) if (p.type === 'url' && p.param && p.param.url === 'miniwave_rank') frame = p.param.param.frame;
  }
  assert.equal(frame, g, 'l’insigne de la fruticard est celui du grade');
});
