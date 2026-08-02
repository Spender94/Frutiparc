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
    window: {}, Promise, JSON, Number, Array, Object, String, Error, Math,
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
  assert.equal(p.carte.$arcade.$bestLevel, 0, 'et rien d\'acquis');

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

  const r = await p.enregistrer(Object.assign({ mode: 'arcade', cons: jeu.getCons() }, fin));
  assert.equal(r.enregistre, true, 'la fiche est partie au serveur');

  // Le serveur a-t-il lu la même chose que ce qu'on a écrit ?
  const relu = await new P.Plateforme(sid).charger();
  assert.equal(relu.$arcade.$bestLevel, fin.level + 1, 'le meilleur niveau est enregistré');
  assert.equal(relu.$arcade.$bestScore, fin.score, 'et le meilleur score, que le tuyau ne portait pas');
  for (const [type, n] of Object.entries(fin.badsKill)) {
    assert.equal(relu.$badsKill[Number(type)], n, `espèce ${type} : ${n} éliminations retenues`);
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
  const dejaLa = p.carte.$badsKill[0];

  // Le seuil du jeu est 200 (titemKillLimit). On y va en plusieurs parties,
  // comme un joueur : c'est justement l'accumulation qu'on veut voir marcher.
  let reste = 200 - dejaLa;
  let parties = 0;
  while (reste > 0) {
    const pas = Math.min(reste, 60);
    const r = await p.enregistrer({ mode: 'arcade', badsKill: { 0: pas }, level: 4, score: 1000, cons: 2 });
    assert.equal(r.enregistre, true);
    reste -= pas; parties++;
  }
  assert.ok(parties >= 3, `il a fallu ${parties} parties — l'accumulation est bien nécessaire`);

  const relu = await new P.Plateforme(sid).charger();
  assert.ok(relu.$badsKill[0] >= 200, `${relu.$badsKill[0]} éliminations enregistrées pour la Fraise`);

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
  const record = avant.$arcade.$bestLevel;
  const fraises = avant.$badsKill[0];
  const fraisesBis = avant.$badsKill[1];
  assert.ok(record > 0 && fraises >= 200, 'la fiche porte bien la progression des tests précédents');

  // Une partie catastrophique : morte au premier niveau, un seul fruit.
  await p.enregistrer({ mode: 'arcade', badsKill: { 1: 1 }, level: 0, score: 5, cons: 0 });

  const apres = await new P.Plateforme(sid).charger();
  assert.equal(apres.$arcade.$bestLevel, record, 'le record tient');
  assert.equal(apres.$badsKill[0], fraises, 'les fraises abattues restent');
  assert.equal(apres.$badsKill[1], fraisesBis + 1, 'et la nouvelle espèce s\'ajoute');

  // Le picto durement gagné n'a pas été repris.
  const gi = await pictos();
  const brut = gi.items || gi.gameItems || gi;
  const liste = Array.isArray(brut) ? brut.map((x) => (typeof x === 'string' ? x : x.id)) : [];
  assert.ok(liste.includes('$bads0'), 'le picto de la Fraise est toujours là');
});

test('les modes achetés au stand survivent à une sauvegarde du SWF', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire(JOUEUR);
  const p = new P.Plateforme(sid);
  await p.charger();

  // Le joueur ramasse de quoi acheter, puis achète Endurance et un vaisseau.
  p.carte.$credit = 1000;
  await p.ecrire(p.carte);
  assert.equal((await p.acheter(9)).ok, true, 'Endurance achetée');   // 120
  assert.equal((await p.acheter(0)).ok, true, 'Proto acheté');        // 80
  let relu = await new P.Plateforme(sid).charger();
  assert.equal(relu.$credit, 800, 'le solde est enregistré');
  assert.deepEqual(relu.$mode[2], [0, 1, 0], 'et le mode ouvert aussi');
  assert.equal(relu.$ship[1], 1);

  // Maintenant le SWF du bureau enregistre : un tuyau à sept champs, qui ne
  // porte ni crédits ni modes. Sans la greffe côté serveur, tout serait perdu.
  const tuyau = P.versTuyau(relu);
  assert.equal(tuyau.split('|').length, 7, 'le tuyau du bureau n\'a que sept champs');
  const rep = await fetch(`${BASE}/api/saveFrutiSlot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: tuyau }),
  });
  assert.ok(rep.ok);

  relu = await new P.Plateforme(sid).charger();
  assert.equal(relu.$credit, 800, 'les crédits ont survécu au passage du SWF');
  assert.deepEqual(relu.$mode[2], [0, 1, 0], 'Endurance reste ouverte');
  assert.equal(relu.$ship[1], 1, 'et le vaisseau acheté reste acquis');

  // Les pictos du vaisseau et des articles suivent, comme sur le bureau.
  const brut = (await pictos());
  const liste = (Array.isArray(brut) ? brut : (brut.items || brut.gameItems || []))
    .map((x) => (typeof x === 'string' ? x : x.id));
  assert.ok(liste.includes('$ship01'), `picto du Proto accordé (${liste.join(' ')})`);

  t.diagnostic(`après passage du SWF : ${relu.$credit} crédits, modes ${JSON.stringify(relu.$mode[2])}`);
});

test('chaque mode enregistre son propre record', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire(JOUEUR);
  const p = new P.Plateforme(sid);
  await p.charger();

  await p.enregistrer({ mode: 'survival', score: 24000, level: 9, badsKill: { 2: 40 } });
  await p.enregistrer({ mode: 'letter', score: 7300, cons: 100, badsKill: { 50: 60 } });
  await p.enregistrer({ mode: 'mission', missionNum: 1, cons: 100, score: 3100, prime: 100 });

  const relu = await new P.Plateforme(sid).charger();
  assert.equal(relu.$survival, 24000, 'le record d\'endurance');
  assert.equal(relu.$letter, 7300, 'celui des lettres');
  assert.equal(relu.$cons.$letter, 100, 'et son parcours bouclé');
  assert.equal(relu.$cons.$bonus[1], 100, 'la mission 2 est bouclée');
  assert.equal(relu.$bonus[1], 3100, 'avec son meilleur score');
  assert.equal(relu.$stats.$play.$survival, 1, 'une partie d\'endurance comptée');
  assert.equal(relu.$stats.$play.$letter, 1, 'une de lettres');
  assert.equal(relu.$stats.$play.$mission, 1, 'une de mission');
  assert.ok(relu.$stats.$play.$main > 0, 'et les parties d\'arcade des tests précédents');

  // Boucler une mission et le parcours des lettres ouvre leurs pictos.
  const brut = await pictos();
  const liste = (Array.isArray(brut) ? brut : (brut.items || brut.gameItems || []))
    .map((x) => (typeof x === 'string' ? x : x.id));
  assert.ok(liste.includes('$mis1'), `picto de la mission 2 (${liste.join(' ')})`);
  assert.ok(liste.includes('$letter'), 'picto des lettres');
  const c = await consecration(sid);
  t.diagnostic(`pictos : ${liste.join(' ')} · consécration ${c.overall} %`);
});
