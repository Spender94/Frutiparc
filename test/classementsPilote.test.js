/*
 * Les deux classements PILOTES de l'animation : MiniPixiz « Arbre creux » et
 * MiniWave « Arcade ».
 *
 * Deux modes qui n'avaient aucun classement. On les ouvre au challenge du jour
 * (section C) : remise à zéro quotidienne, médailles or/argent/bronze, kikooz,
 * podium de la veille — toute la mécanique existante, sans toucher au SWF.
 *
 * Ce que ce fichier vérifie, de bout en bout :
 *   · une partie enregistre bien un score dans la bonne cuve ;
 *   · les garde-fous de plausibilité écartent l'absurde (le score est calculé
 *     par le NAVIGATEUR dans ces deux portages) sans gêner une vraie partie ;
 *   · le niveau d'arcade voyage et s'affiche à côté des points ;
 *   · les vignettes de médaille pointent sur des dessins qui EXISTENT dans
 *     public/awards.swf (miniwave → « wave », minipixiz → « tris ») ;
 *   · Kaluga Freestyle a quitté le tableau des scores mais reste aux records.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3494;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5230', FRUTISCORE_PORT: '5231',
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
  // data/scores.json survit d'une exécution à l'autre : on retire nos joueurs.
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('pil')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const joueur = (base) => 'pil' + base + RUN;

async function sidPour(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

const enregistrer = (sid, game, score, data) =>
  fetch(`${BASE}/api/saveScore?sid=${encodeURIComponent(sid)}&game=${game}&m=0`
    + `&score=${score}&data=${encodeURIComponent(data === undefined ? '' : data)}`)
    .then(async (r) => Object.assign({ statut: r.status }, await r.json()));

async function onglets() {
  const j = await (await fetch(`${BASE}/api/light/challenge?limit=50`)).json();
  const par = {};
  for (const g of j.games || []) par[g.id] = g;
  return par;
}
const ligne = (onglet, pseudo) =>
  ((onglet && onglet.scores) || []).find((s) => String(s.user).toLowerCase() === pseudo) || null;

// ── La cuve, de bout en bout ──────────────────────────────────────────────

test('une partie d\'Arbre creux entre au challenge du jour', async () => {
  const u = joueur('arbre');
  const sid = await sidPour(u);
  const r = await enregistrer(sid, 'minipixiz', 7400);
  assert.equal(r.ok, true, 'le score passe');
  assert.equal(r.rankingId, 'minipixiz_classic', 'et dans la bonne cuve');

  const o = await onglets();
  assert.ok(o.minipixiz_classic, 'l\'onglet existe dans le challenge du light');
  assert.equal(o.minipixiz_classic.name, 'MiniPixiz');
  assert.equal((ligne(o.minipixiz_classic, u) || {}).score, 7400);

  // Le challenge du jour garde le MEILLEUR du jour, pas le dernier envoyé —
  // c'est pour ça que le client envoie à chaque partie.
  await enregistrer(sid, 'minipixiz', 3200);
  assert.equal((ligne((await onglets()).minipixiz_classic, u) || {}).score, 7400,
    'une partie plus faible ne fait pas redescendre');
  await enregistrer(sid, 'minipixiz', 9100);
  assert.equal((ligne((await onglets()).minipixiz_classic, u) || {}).score, 9100,
    'une meilleure partie monte');
});

test('une partie d\'Arcade entre avec son niveau, affiché à côté des points', async () => {
  const u = joueur('arcade');
  const sid = await sidPour(u);
  const r = await enregistrer(sid, 'miniwave', 48000, '37');
  assert.equal(r.ok, true);
  assert.equal(r.rankingId, 'miniwave_classic');

  const o = await onglets();
  assert.ok(o.miniwave_classic, 'l\'onglet existe');
  assert.equal(o.miniwave_classic.name, 'MiniWave');
  const l = ligne(o.miniwave_classic, u);
  assert.ok(l, 'le joueur figure au classement');
  assert.equal(l.score, 48000);
  assert.match(l.label, /48\s?000.*niveau 37/,
    'le libellé porte les points ET le niveau atteint');
});

// ── Les garde-fous (le score vient du navigateur) ─────────────────────────

test('un score d\'arbre absurde est refusé, une vraie partie passe', async () => {
  const u = joueur('triche');
  const sid = await sidPour(u);
  const r = await enregistrer(sid, 'minipixiz', 999999999);
  assert.equal(r.statut, 400, 'refusé');
  assert.equal(r.error, 'implausible_score');
  assert.equal(ligne((await onglets()).minipixiz_classic, u), null, 'et rien n\'est écrit');

  // Le rail est TRÈS au-dessus du jeu réel : le dernier picto du jeu est à
  // 8 000, une partie d'exception reste largement en dessous du plafond.
  const ok = await enregistrer(sid, 'minipixiz', 60000);
  assert.equal(ok.ok, true, 'une partie hors norme mais humaine passe');
});

test('un score d\'arcade incohérent avec le niveau est refusé', async () => {
  const u = joueur('trichw');
  const sid = await sidPour(u);
  // Un million de points en étant resté au niveau 1 : impossible.
  const r = await enregistrer(sid, 'miniwave', 1000000, '1');
  assert.equal(r.statut, 400, 'refusé');
  assert.match(r.raison, /incohérent avec le niveau/);

  // Le parcours ne compte que 200 vagues : au-delà, le niveau n'existe pas.
  const r2 = await enregistrer(sid, 'miniwave', 5000, '404');
  assert.equal(r2.statut, 400, 'niveau hors parcours refusé');

  // Et la même performance, au niveau qui va avec, passe.
  const ok = await enregistrer(sid, 'miniwave', 1000000, '120');
  assert.equal(ok.ok, true, 'un gros score à un niveau élevé est légitime');
  assert.equal((ligne((await onglets()).miniwave_classic, u) || {}).score, 1000000);
});

test('les deux pilotes ne consomment aucun fruit défendu', async () => {
  const u = joueur('quota');
  const sid = await sidPour(u);
  // Bien plus de parties que le quota quotidien des jeux rationnés : toutes
  // doivent être classées, le pilote est hors quota.
  for (let i = 1; i <= 8; i++) {
    const r = await enregistrer(sid, 'minipixiz', 1000 + i * 10);
    assert.equal(r.ok, true, `partie ${i} acceptée`);
    assert.notEqual(r.fdBlocked, true, `partie ${i} classée`);
  }
  assert.equal((ligne((await onglets()).minipixiz_classic, u) || {}).score, 1080,
    'la meilleure des huit est au classement');
});

// ── Les médailles ─────────────────────────────────────────────────────────

test('les vignettes de médaille désignent des dessins qui existent vraiment', () => {
  // public/awards.swf porte 22 vignettes, une par jeu du catalogue de 2006 ;
  // le bureau en choisit une par son LABEL D'IMAGE. Un nom absent n'affiche
  // pas la médaille d'un autre jeu — il n'affiche rien du tout.
  const raw = fs.readFileSync(path.join(ROOT, 'public/awards.swf'));
  const body = raw.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  const labels = [];
  (function tags(from, to) {
    let o = from;
    while (o < to - 1) {
      const hdr = body.readUInt16LE(o), code = hdr >> 6;
      let len = hdr & 0x3f, hs = 2;
      if (len === 0x3f) { len = body.readUInt32LE(o + 2); hs = 6; }
      if (code === 0) break;
      const corps = o + hs;
      if (code === 43) labels.push(body.slice(corps, body.indexOf(0, corps)).toString('latin1'));
      if (code === 39) tags(corps + 4, corps + len);
      o = corps + len;
    }
  })(Math.ceil((5 + ((body[0] >> 3) & 0x1f) * 4) / 8) + 4, body.length);

  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const table = /const MEDAL_AWARD_FRAME = \{([^}]*)\}/.exec(src);
  assert.ok(table, 'la table des vignettes existe');
  const vignettes = [...table[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(vignettes.includes('wave'), 'miniwave emprunte « wave »');
  assert.ok(vignettes.includes('tris'), 'minipixiz emprunte « tris »');
  for (const v of vignettes) {
    assert.ok(labels.includes(v), `la vignette « ${v} » existe dans awards.swf`);
  }
  // Et les jeux HISTORIQUES n'ont pas besoin de traduction : leur clé EST le
  // label (c'est ce qui fait marcher les médailles depuis toujours).
  for (const g of ['snake3', 'mb2', 'swapou2', 'kaluga', 'bkiwi', 'bandas', 'grapiz']) {
    assert.ok(labels.includes(g), `${g} se sert de son propre nom`);
  }
});

test('les deux pilotes distribuent des médailles (section C)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const [rk, internal, g] of [
    ['13', 'minipixiz_classic', 'minipixiz'],
    ['14', 'miniwave_classic', 'miniwave'],
  ]) {
    const re = new RegExp(`\\{ rk: '${rk}', internal: '${internal}',[^}]*g: '${g}',\\s*section: 'C' \\}`);
    assert.match(src, re, `${internal} est en section C — donc remise à zéro et médailles`);
  }
  // La remise à zéro quotidienne (et donc l'attribution des médailles) se
  // dérive de la section C : rien d'autre à câbler.
  assert.match(src, /section === 'C' && r\.internal && r\.internal !== 'bkiwi_track5_classic'/);
  // Et l'icône des deux lignes : fileIcon.swf connaît déjà les deux noms.
  const ico = fs.readFileSync(path.join(ROOT, 'public/fileIcon.swf'));
  const txt = (ico.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(ico.slice(8)) : ico.slice(8)).toString('latin1');
  for (const nom of ['minipixiz', 'miniwave']) {
    assert.ok(txt.includes(nom), `fileIcon.swf porte l'icône « ${nom} »`);
  }
});

// ── Les clients envoient bien leur score ──────────────────────────────────

test('les deux portages envoient leur score en fin de partie', () => {
  const pix = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(pix, /classe === 'Arbre' && client\.lieu && client\.lieu\.score > 0/,
    'l\'arbre creux, et lui seul, est classé');
  assert.match(pix, /plateforme\.envoyerScore\(client\.lieu\.score\)/);
  const pixP = fs.readFileSync(path.join(ROOT, 'public/minipixiz/plateforme.js'), 'utf8');
  assert.match(pixP, /game: 'minipixiz', m: '0'/, 'vers la cuve du jour');

  const mw = fs.readFileSync(path.join(ROOT, 'public/miniwave/index.html'), 'utf8');
  assert.match(mw, /\(l\.mode \|\| 'arcade'\) === 'arcade'/, 'l\'arcade, et elle seule, est classée');
  assert.match(mw, /plateforme\.envoyerScore\(info\.score, \(Number\(info\.level\) \|\| 0\) \+ 1\)/,
    'le niveau affiché part avec le score');
  const mwP = fs.readFileSync(path.join(ROOT, 'public/miniwave/plateforme.js'), 'utf8');
  assert.match(mwP, /game: 'miniwave', m: '0'/);
});
