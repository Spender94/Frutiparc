// Miniwave sur /light : une partie jouée débloque-t-elle vraiment des pictos ?
//
// C'est LA question qui compte pour ce portage. Le moteur peut être parfait et
// la fiche bien écrite : si le serveur n'en tire pas les pictos, le joueur n'a
// rien gagné. Ce test ferme donc la boucle complète, sur un vrai serveur et une
// vraie base :
//
//   moteur (partie réelle) → plateforme (fiche) → /api/saveFrutiSlot
//     → extractGameItemsFromSlot (pictos) → computeConsecration (pourcentage)
//
// Rien n'est simulé du côté serveur : c'est le même chemin que le SWF d'origine
// emprunte depuis le bureau, au même endroit, dans le même format.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3448;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-miniwave-pictos';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_mwpictos';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const JOUEUR = 'pilotemw';

let proc = null, dispo = false;

// Le module plateforme est écrit pour le navigateur ; on lui fabrique un
// `window` et un `fetch` qui parlent au vrai serveur. C'est donc bien le
// fichier servi au joueur qui est exercé, pas une réécriture.
function chargerPlateforme() {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/plateforme.js'), 'utf8');
  const bac = {
    window: {}, Promise, JSON, Number, Array, Object, String, Error,
    fetch: (url, opt) => fetch(url.indexOf('http') === 0 ? url : BASE + url, opt),
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(src, bac, { filename: 'plateforme.js' });
  return bac.window.MiniwavePlateforme;
}

async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch {} return false; }
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5172', FRUTISCORE_PORT: '5173',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'users'`);
        await c.end();
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}

const pictos = async () => (await fetch(
  `${BASE}/api/admin/users/${JOUEUR}/gameitems?key=${CLE}`)).json();
const consecration = async (sid) => (await fetch(
  `${BASE}/api/consecration?sid=${encodeURIComponent(sid)}`)).json();

test('une partie jouée pour de vrai finit par se voir dans la fiche', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
  const ARCADE = require(path.join(ROOT, 'public/miniwave/levels.json')).main[0].levels;

  const sid = await inscrire(JOUEUR);
  const p = new P.Plateforme(sid);
  await p.charger();
  assert.equal(p.charge, true, 'le compte neuf donne bien une fiche vierge');
  assert.equal(p.slot.bestLevel, 0, 'et rien d\'acquis');

  // Une vraie partie : on tire sans discontinuer jusqu'à la fin.
  let fin = null;
  const jeu = new E.Game({
    levels: ARCADE, graine: 3,
    onEvent: (n, d) => { if (n === 'finPartie') fin = d; },
  });
  for (let i = 0; i < 8000 && !jeu.termine; i++) {
    jeu.entree.tir = true;
    jeu.entree.gauche = (i % 160) < 80;
    jeu.entree.droite = !jeu.entree.gauche;
    jeu.update(1);
  }
  if (!jeu.termine) jeu.finPartie('gameover');
  assert.ok(fin, 'la partie s\'est terminée');
  const abattus = Object.values(fin.badsKill).reduce((a, b) => a + b, 0);
  assert.ok(abattus > 0, `des fruits ont été abattus (${abattus})`);

  const r = await p.enregistrer(fin);
  assert.equal(r.enregistre, true, 'la fiche est partie au serveur');

  // Le serveur a-t-il lu la même chose que ce qu'on a écrit ?
  const relu = await new P.Plateforme(sid).charger();
  assert.equal(relu.bestLevel, fin.level + 1, 'le meilleur niveau est enregistré');
  for (const [type, n] of Object.entries(fin.badsKill)) {
    assert.equal(relu.badsKill[Number(type)], n, `espèce ${type} : ${n} éliminations retenues`);
  }

  // Le picto « arcade » s'obtient dès le premier niveau atteint : c'est le
  // premier que ce portage doit savoir donner.
  const gi = await pictos();
  const ids = (gi.items || gi.gameItems || gi).map ? (gi.items || gi.gameItems || gi) : [];
  const liste = Array.isArray(ids) ? ids.map((x) => (typeof x === 'string' ? x : x.id)) : [];
  assert.ok(liste.includes('$arcade'), `picto arcade accordé (reçu : ${liste.join(', ') || 'aucun'})`);
  assert.ok(liste.includes('$ship00'), 'et le picto du vaisseau de départ');

  t.diagnostic(`partie : ${fin.score} points, niveau ${fin.level + 1}, ${abattus} fruits, pictos ${liste.join(' ')}`);
});

test('deux cents éliminations d\'une espèce donnent son picto, et la consécration monte', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire(JOUEUR);            // même compte : on reprend sa fiche

  const avant = await consecration(sid);
  const p = new P.Plateforme(sid);
  await p.charger();
  const dejaLa = p.slot.badsKill[0];

  // Le seuil du jeu est 200 (titemKillLimit). On y va en plusieurs parties,
  // comme un joueur : c'est justement l'accumulation qu'on veut voir marcher.
  let reste = 200 - dejaLa;
  let parties = 0;
  while (reste > 0) {
    const pas = Math.min(reste, 60);
    const r = await p.enregistrer({ badsKill: { 0: pas }, level: 4, score: 1000 });
    assert.equal(r.enregistre, true);
    reste -= pas; parties++;
  }
  assert.ok(parties >= 3, `il a fallu ${parties} parties — l'accumulation est bien nécessaire`);

  const relu = await new P.Plateforme(sid).charger();
  assert.ok(relu.badsKill[0] >= 200, `${relu.badsKill[0]} éliminations enregistrées pour la Fraise`);

  const gi = await pictos();
  const brut = gi.items || gi.gameItems || gi;
  const liste = Array.isArray(brut) ? brut.map((x) => (typeof x === 'string' ? x : x.id)) : [];
  assert.ok(liste.includes('$bads0'), `picto de la Fraise accordé (reçu : ${liste.join(', ')})`);

  // Et la consécration, qui n'est qu'une lecture des pictos, doit avoir bougé.
  const apres = await consecration(sid);
  assert.ok(apres.overall > avant.overall,
    `la consécration progresse (${avant.overall} → ${apres.overall})`);
  const mw = (apres.games || []).find((g) => /miniwave/i.test(g.id || g.name || ''));
  if (mw) assert.ok(mw.unlocked >= 2, `Miniwave compte ses pictos (${mw.unlocked})`);

  t.diagnostic(`consécration ${avant.overall} → ${apres.overall} ; pictos : ${liste.join(' ')}`);
});

test('une deuxième partie n\'efface pas la première', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire(JOUEUR);
  const p = new P.Plateforme(sid);
  const avant = await p.charger();
  const record = avant.bestLevel;
  const fraises = avant.badsKill[0];
  assert.ok(record > 0 && fraises >= 200, 'la fiche porte bien la progression des tests précédents');

  // Une partie catastrophique : morte au premier niveau, un seul fruit.
  await p.enregistrer({ badsKill: { 1: 1 }, level: 0, score: 5 });

  const apres = await new P.Plateforme(sid).charger();
  assert.equal(apres.bestLevel, record, 'le record tient');
  assert.equal(apres.badsKill[0], fraises, 'les fraises abattues restent');
  assert.equal(apres.badsKill[1], avant.badsKill[1] + 1, 'et la nouvelle espèce s\'ajoute');

  // Le picto durement gagné n'a pas été repris.
  const gi = await pictos();
  const brut = gi.items || gi.gameItems || gi;
  const liste = Array.isArray(brut) ? brut.map((x) => (typeof x === 'string' ? x : x.id)) : [];
  assert.ok(liste.includes('$bads0'), 'le picto de la Fraise est toujours là');
});
