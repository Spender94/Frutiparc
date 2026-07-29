// « Frutisnake Contest » : le classement du plus long serpent.
//
// Ce que ces tests verrouillent — ce sont les trois propriétés qui distinguent
// ce classement des autres, et qu'un refactor pourrait casser sans bruit :
//
//   • OUVERT À TOUS. La longueur est relevée par le pont fpSnakeHud, que le SWF
//     appelle pour tout le monde ; le Pack de Frutisnake ne conditionne que
//     l'affichage du tableau de bord. Un joueur sans pack doit pouvoir concourir.
//   • TOUTES LES PARTIES comptent, challenge comme essai : le relevé ne passe pas
//     par le portillon FD, ne consomme rien et n'est jamais bloqué. C'est tout
//     l'intérêt d'un concours à côté du classement au score.
//   • PERMANENT. Le classement est rangé en section « Championnat », donc hors du
//     balayage quotidien qui remet à zéro les classements du Challenge.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3433;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// data/scores.json survit d'une exécution à l'autre : sans suffixe, un record
// laissé par un run précédent fausserait les attentes. Un suffixe par exécution
// donne à chaque test des joueurs vierges.
const RUN = String(Date.now()).slice(-7);
const joueur = (nom) => nom + RUN;

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5130', FRUTISCORE_PORT: '5131',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (serverProc) serverProc.kill('SIGKILL'); });

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const envoyer = async (sid, len) =>
  await (await fetch(`${BASE}/api/contest/snake3?sid=${encodeURIComponent(sid)}&v=${len}`,
    { method: 'POST' })).json();
const quota = async (sid) =>
  await (await fetch(`${BASE}/api/fd/status?sid=${encodeURIComponent(sid)}&game=snake3`)).json();
const classement = async () => {
  const j = await (await fetch(`${BASE}/api/club/records?limit=50`)).json();
  return (j.rankings || []).find((r) => r.id === 'snake3_contest');
};

test('le classement existe et n\'est pas remis à zéro chaque jour', async () => {
  const r = await classement();
  assert.ok(r, 'snake3_contest présent dans les classements');
  assert.equal(r.name, 'Frutisnake - Contest');
  assert.equal(r.game, 'snake3');
  assert.equal(r.lowerIsBetter, false, 'le plus LONG gagne');

  // Le descripteur envoyé aux clients : un onglet à part, en « Championnat ».
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ligne = /\{ rk: '10', internal: 'snake3_contest',[^}]*\}/.exec(src);
  assert.ok(ligne, 'descripteur d\'onglet présent');
  assert.ok(/rn: 'Frutisnake Contest'/.test(ligne[0]), 'libellé de l\'onglet');
  assert.ok(/section: 'L'/.test(ligne[0]),
    'section L : en section C le classement serait balayé chaque nuit avec les challenges');
});

test('un joueur SANS le pack peut concourir', async () => {
  // Le point qui motive tout le dispositif : la collecte ne dépend pas de l'achat.
  const sid = await sidFor(joueur('sanspack'));
  const options = await (await fetch(BASE + '/api/features?sid=' + sid)).json();
  assert.equal(options.features.snake3Hud, false, 'ce joueur n\'a pas le pack');

  const r = await envoyer(sid, 47);
  assert.equal(r.ok, true, `relevé accepté (${JSON.stringify(r)})`);
  assert.equal(r.record, 47);
  const c = await classement();
  assert.ok(c.scores.some((s) => s.user.toLowerCase() === joueur('sanspack') && s.score === 47),
    'le joueur figure au classement');
});

test('le relevé ne touche pas au quota FD, et n\'est jamais bloqué', async () => {
  const sid = await sidFor(joueur('quotacontest'));
  const avant = await quota(sid);
  assert.equal(avant.used, 0, 'quota intact au départ');

  // Cinq parties d'affilée — bien au-delà des deux parties challenge du jour.
  for (const len of [10, 20, 30, 40, 50]) {
    const r = await envoyer(sid, len);
    assert.equal(r.ok, true, `partie de ${len} acceptée`);
  }
  const apres = await quota(sid);
  assert.equal(apres.used, 0, 'aucun disque consommé par le concours');
  assert.equal(apres.remaining, 2, 'les parties challenge du jour sont intactes');
  assert.equal((await classement()).scores.find((s) => s.user.toLowerCase() === joueur('quotacontest')).score, 50);
});

test('seul le record est retenu ; renvoyer moins ne l\'écrase pas', async () => {
  const sid = await sidFor(joueur('recordsnake'));
  await envoyer(sid, 120);
  const moins = await envoyer(sid, 35);
  assert.equal(moins.record, 120, 'une partie plus courte ne dégrade pas le record');
  const pareil = await envoyer(sid, 120);
  assert.equal(pareil.updated, false, 'renvoyer le même maximum ne change rien');
  const mieux = await envoyer(sid, 121);
  assert.equal(mieux.updated, true, 'un anneau de plus, et le record tombe');
  assert.equal(mieux.record, 121);
});

test('les valeurs aberrantes sont refusées', async () => {
  const sid = await sidFor(joueur('trichesnake'));
  for (const len of [0, 2, -5, 999999, 'abc', '']) {
    const r = await fetch(`${BASE}/api/contest/snake3?sid=${encodeURIComponent(sid)}&v=${encodeURIComponent(len)}`,
      { method: 'POST' });
    assert.equal(r.status, 400, `longueur ${JSON.stringify(len)} refusée`);
  }
  // 3 = longueur de départ du serpent : la borne basse, elle, est valide.
  const ok = await envoyer(sid, 3);
  assert.equal(ok.ok, true, 'la longueur de départ est acceptée');
  // Sans session, rien n'est enregistré.
  const anon = await fetch(`${BASE}/api/contest/snake3?v=50`, { method: 'POST' });
  assert.equal(anon.status, 401, 'un visiteur non identifié est refusé');
});

test('le popup relève la longueur pour TOUT LE MONDE, pas seulement les acheteurs', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  // Le pont est désormais un point d'entrée partagé : le tableau de bord (gardé
  // par `allowed`) et le Contest s'y abonnent séparément. Si le Contest se
  // remettait à l'intérieur de la fonction gardée, la collecte redeviendrait
  // réservée aux acheteurs — c'est le piège que ce test surveille.
  assert.ok(/window\.fpSnakeHud = function \(\) \{[\s\S]{0,400}abonnesSnake/.test(html),
    'fpSnakeHud distribue aux abonnés');
  const contest = html.slice(html.indexOf('function setupSnakeContest'),
                             html.indexOf('Tableau de bord Frutisnake'));
  assert.ok(contest.length > 200, 'bloc setupSnakeContest présent');
  assert.ok(!/allowed/.test(contest), 'le relevé du Contest n\'est PAS gardé par l\'option achetée');
  assert.ok(/\/api\/contest\/snake3/.test(contest), 'il poste bien au classement');
  assert.ok(/sendBeacon/.test(contest),
    'une fenêtre fermée en pleine partie doit quand même livrer son record');
  assert.ok(/snake3/.test(contest), 'et seulement pour Frutisnake');
});

test('la fin de partie et la relance sont bien détectées', () => {
  // On extrait l'abonné livré et on le fait tourner sur un faux minuteur : deux
  // parties d'affilée doivent produire DEUX envois, avec le bon maximum chacun.
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  const bloc = html.slice(html.indexOf('function setupSnakeContest'),
                          html.indexOf('Tableau de bord Frutisnake'));
  const corps = /abonnerSnake\(function \(len, dyn, nbSlots, slotTime, fruits\) \{[\s\S]*?\n    \}\);/.exec(bloc);
  assert.ok(corps, 'abonné du Contest présent');

  const envois = [];
  let differe = null;
  const api = new Function('envois', 'poser', `
    var record = 0, envoye = 0, precedent = null, silence = null;
    var SILENCE_MS = 3000;
    function envoyer() {
      if (record <= envoye || record < 3) return;
      envoye = record;
      envois.push(record);
    }
    var setTimeout = function (fn, ms) { poser(fn); return 1; };
    var clearTimeout = function () {};
    var abonnerSnake = function (fn) { api = fn; };
    var api;
    ${corps[0]}
    return { tic: api, finPartie: function () { envoyer(); } };
  `)(envois, (fn) => { differe = fn; });

  // Partie 1 : le serpent grandit jusqu'à 12, puis meurt.
  [[3, 0], [7, 4], [12, 9], [9, 9]].forEach(([len, fruits]) => api.tic(len, 0, 0, 0, fruits));
  api.finPartie();
  assert.deepEqual(envois, [12], 'le maximum de la partie est envoyé, pas la longueur finale');

  // Partie 2 : les compteurs repartent en arrière → la précédente est close, la
  // nouvelle repart de zéro.
  [[3, 0], [30, 27]].forEach(([len, fruits]) => api.tic(len, 0, 0, 0, fruits));
  api.finPartie();
  assert.deepEqual(envois, [12, 30], 'la seconde partie est comptée à part');

  // Silence prolongé sans rien de neuf : aucun envoi en double.
  api.finPartie();
  assert.deepEqual(envois, [12, 30], 'rien n\'est renvoyé deux fois');
});

test('le concours apparaît aussi côté mobile', async () => {
  const sid = await sidFor(joueur('mobilecontest'));
  await envoyer(sid, 88);
  const j = await (await fetch(`${BASE}/api/light/challenge?sid=${encodeURIComponent(sid)}`)).json();
  const onglet = (j.games || []).find((g) => g.id === 'snake3_contest');
  assert.ok(onglet, 'onglet Frutisnake Contest présent dans le client mobile');
  assert.equal(onglet.allTime, true, 'affiché comme un classement permanent (ni « aujourd\'hui » ni podium)');
  const moi = onglet.scores.find((s) => s.user.toLowerCase() === joueur('mobilecontest'));
  assert.ok(moi, 'le joueur y figure');
  assert.equal(moi.label, '88 anneaux');
});

test('un tournoi peut se tenir sur ce classement', async () => {
  // Le système « Maître ÈS … » ne propose que les classements de type C ; sans
  // ça, impossible d'organiser le concours annoncé aux joueurs.
  const liste = await (await fetch(BASE + '/api/admin/tournament-games?key=' + CLE)).json();
  assert.ok(Array.isArray(liste), `liste des classements de tournoi (${JSON.stringify(liste).slice(0, 120)})`);
  assert.ok(liste.some((g) => g.ranking_id === 'snake3_contest'),
    'Frutisnake Contest proposé comme support de tournoi');
});
