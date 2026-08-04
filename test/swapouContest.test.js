// « Swapou Contest » : le classement du plus grand nombre de coups.
//
// Même famille que le Frutisnake Contest, mêmes trois propriétés à protéger :
// ouvert à tous (le Pack de Swapou ne conditionne que l'affichage des cadrans),
// hors du quota FD, et permanent. Deux différences propres à Swapou :
//
//   • le jeu ANNONCE sa fin de partie (getURL "fpswfin:", accroché au
//     constructeur de l'écran de game over) : pas de détection de silence à
//     faire, contrairement à Frutisnake ;
//   • seul le mode CHALLENGE est classé. En mode Classique le compteur du jeu
//     repart à chaque niveau, un « nombre de coups » n'y serait pas comparable
//     d'un joueur à l'autre. Le mode est reconnu à la valeur de départ de
//     `ncoups` : 5 en Challenge (premier envoi 6), 1 en Classique.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3435;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// data/scores.json survit d'une exécution à l'autre : un suffixe par exécution
// donne à chaque test des joueurs vierges.
const RUN = String(Date.now()).slice(-7);
const joueur = (nom) => nom + RUN;

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5140', FRUTISCORE_PORT: '5141',
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
after(async () => {
  if (serverProc) serverProc.kill('SIGKILL');
  // Même ménage que le Frutisnake Contest : le suffixe rend chaque exécution
  // vierge, mais les joueurs s'accumulent et finissent par pousser celui du
  // run courant hors du top 20 — on efface donc LES NÔTRES en sortant.
  await wait(300);
  const fichier = path.join(ROOT, 'data/scores.json');
  try {
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) {
      if (u.slice(-RUN.length) === RUN) delete d.users[u];
    }
    fs.writeFileSync(fichier, JSON.stringify(d));
  } catch { /* pas de fichier : rien à nettoyer */ }
});

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const envoyer = async (sid, v) =>
  await (await fetch(`${BASE}/api/contest/swapou2?sid=${encodeURIComponent(sid)}&v=${v}`,
    { method: 'POST' })).json();
const classement = async () => {
  const j = await (await fetch(`${BASE}/api/club/records?limit=50`)).json();
  return (j.rankings || []).find((r) => r.id === 'swapou2_contest');
};

test('le classement existe, permanent et ouvert au tournoi', async () => {
  const r = await classement();
  assert.ok(r, 'swapou2_contest présent dans les classements');
  assert.equal(r.name, 'Swapou - Contest');
  assert.equal(r.game, 'swapou2');
  assert.equal(r.lowerIsBetter, false, 'le PLUS de coups gagne');

  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ligne = /\{ rk: '11', internal: 'swapou2_contest',[^}]*\}/.exec(src);
  assert.ok(ligne, 'descripteur d\'onglet présent');
  assert.ok(/rn: 'Swapou Contest'/.test(ligne[0]), 'libellé de l\'onglet');
  assert.ok(/section: 'L'/.test(ligne[0]),
    'section L : en section C le classement serait balayé chaque nuit avec les challenges');

  const tournois = await (await fetch(BASE + '/api/admin/tournament-games?key=' + CLE)).json();
  assert.ok(tournois.some((g) => g.ranking_id === 'swapou2_contest'),
    'Swapou Contest proposé comme support de tournoi');
});

test('un joueur SANS le pack concourt, et son quota reste intact', async () => {
  const sid = await sidFor(joueur('swsanspack'));
  const options = await (await fetch(BASE + '/api/features?sid=' + sid)).json();
  assert.equal(options.features.swapouMoves, false, 'ce joueur n\'a pas le pack');

  for (const v of [12, 31, 8]) {
    const r = await envoyer(sid, v);
    assert.equal(r.ok, true, `partie de ${v} coups acceptée`);
  }
  const q = await (await fetch(`${BASE}/api/fd/status?sid=${encodeURIComponent(sid)}&game=swapou2`)).json();
  assert.equal(q.used, 0, 'aucun disque consommé par le concours');
  assert.equal(q.remaining, 2, 'les parties challenge du jour sont intactes');

  const c = await classement();
  const moi = c.scores.find((s) => s.user.toLowerCase() === joueur('swsanspack'));
  assert.ok(moi, 'le joueur figure au classement');
  assert.equal(moi.score, 31, 'seule la meilleure partie est retenue');
});

test('les valeurs aberrantes sont refusées', async () => {
  const sid = await sidFor(joueur('swtriche'));
  for (const v of [0, -3, 999999, 'abc', '']) {
    const r = await fetch(`${BASE}/api/contest/swapou2?sid=${encodeURIComponent(sid)}&v=${encodeURIComponent(v)}`,
      { method: 'POST' });
    assert.equal(r.status, 400, `valeur ${JSON.stringify(v)} refusée`);
  }
  assert.equal((await envoyer(sid, 1)).ok, true, 'un seul coup reste une partie valide');
  const anon = await fetch(`${BASE}/api/contest/swapou2?v=20`, { method: 'POST' });
  assert.equal(anon.status, 401, 'un visiteur non identifié est refusé');
  const inconnu = await fetch(`${BASE}/api/contest/nimportequoi?sid=${encodeURIComponent(sid)}&v=20`,
    { method: 'POST' });
  assert.equal(inconnu.status, 404, 'un concours inconnu est refusé');
});

test('le popup compte les coups pour TOUT LE MONDE, et ne classe que le Challenge', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  // Le pont Swapou est un point d'entrée partagé : les cadrans (gardés par
  // `allowed`) et le Contest s'y abonnent séparément. Si le relevé repassait
  // derrière l'option, la collecte redeviendrait réservée aux acheteurs.
  assert.ok(/window\.fpSwapouCoup = function \(ncoups, star\) \{ diffuser\(/.test(html),
    'fpSwapouCoup distribue aux abonnés');
  assert.ok(/window\.fpSwapouFin = function \(\) \{ diffuser\(/.test(html),
    'fpSwapouFin distribue aux abonnés');
  const bloc = html.slice(html.indexOf('function setupSwapouContest'),
                          html.indexOf('Cadrans Swapou (version SWF)'));
  assert.ok(bloc.length > 200, 'bloc setupSwapouContest présent');
  assert.ok(!/allowed/.test(bloc), 'le relevé du Contest n\'est PAS gardé par l\'option achetée');
  assert.ok(/\/api\/contest\/swapou2/.test(bloc), 'il poste bien au classement');
  assert.ok(/sendBeacon/.test(bloc), 'une fenêtre fermée en pleine partie livre quand même son total');
  assert.ok(/n >= 6/.test(bloc), 'le mode Challenge est reconnu à la valeur de départ de ncoups');
});

test('le compte des coups : Challenge classé, Classique ignoré', () => {
  // On extrait les rappels livrés et on les fait tourner sur un faux réseau.
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  const bloc = html.slice(html.indexOf('function setupSwapouContest'),
                          html.indexOf('Cadrans Swapou (version SWF)'));
  const abonnement = /abonnerSwapou\(function \(ncoups\) \{[\s\S]*?\n    \}\);/.exec(bloc);
  assert.ok(abonnement, 'abonné du Contest présent');

  const envois = [];
  const api = new Function('envois', `
    var coups = 0, ncoupsPrec = null, challenge = false;
    function url(total) { return String(total); }
    function cloturer() {
      var total = (challenge && coups >= 1) ? coups : 0;
      coups = 0; ncoupsPrec = null; challenge = false;
      return total;
    }
    var fetch = function (u) { envois.push(Number(u)); return { then: function () { return this; }, catch: function () {} }; };
    var popupSid = 'x', api = {};
    var abonnerSwapou = function (surCoup, surFin) { api.coup = surCoup; api.fin = surFin; };
    ${abonnement[0]}
    return api;
  `)(envois);

  // Partie Challenge : ncoups démarre à 5, le premier envoi vaut 6.
  [6, 7, 8, 9, 10].forEach((n) => api.coup(n, 0));
  api.fin();
  assert.deepEqual(envois, [5], 'cinq échanges → cinq coups classés');

  // Partie Classique : ncoups démarre à 1 → rien ne doit être classé.
  [2, 3, 4, 5].forEach((n) => api.coup(n, 0));
  api.fin();
  assert.deepEqual(envois, [5], 'le mode Classique n\'alimente pas le concours');

  // Nouvelle partie Challenge : le compteur repart de zéro.
  [6, 7].forEach((n) => api.coup(n, 0));
  api.fin();
  assert.deepEqual(envois, [5, 2], 'la partie suivante est comptée à part');

  // Fin de partie sans aucun coup : rien n'est envoyé.
  api.fin();
  assert.deepEqual(envois, [5, 2], 'aucun envoi à vide');
});

test('le concours apparaît aussi côté mobile', async () => {
  const sid = await sidFor(joueur('swmobile'));
  await envoyer(sid, 44);
  const j = await (await fetch(`${BASE}/api/light/challenge?sid=${encodeURIComponent(sid)}`)).json();
  const onglet = (j.games || []).find((g) => g.id === 'swapou2_contest');
  assert.ok(onglet, 'onglet Swapou Contest présent dans le client mobile');
  assert.equal(onglet.name, 'Swapou Contest');
  assert.equal(onglet.allTime, true, 'affiché comme un classement permanent');
  const moi = onglet.scores.find((s) => s.user.toLowerCase() === joueur('swmobile'));
  assert.ok(moi, 'le joueur y figure');
  assert.equal(moi.label, '44 coups');
  // Et le concours Frutisnake est toujours là, à côté.
  assert.ok((j.games || []).some((g) => g.id === 'snake3_contest'),
    'les deux concours cohabitent');
});
