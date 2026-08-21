/*
 * Le Club — la FICHE d'un joueur.
 *
 * On rouvre ce qu'Aidofrutiz montrait à l'adresse `medailles.php?p=<pseudo>` :
 * « X a obtenu N médailles », un tableau par date, un tableau par jeu. Et on y
 * ajoute ce qui manquait — la bouille du joueur, et ses RECORDS.
 *
 * Deux règles tiennent ce fichier :
 *
 *   · les MÉDAILLES se comptent toutes, MotionBall compris — le joueur les a
 *     gagnées, la page d'origine les listait ;
 *   · les RECORDS, eux, écartent MotionBall (son score empile le boss atteint,
 *     le temps et un pourcentage : hors de son tableau il ne veut rien dire) et
 *     les circuits « classiques » de Burning Kiwi (routage d'époque fautif, cf.
 *     /api/club/records).
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3493;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-club-fiche';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

const A = 'clubfa' + RUN;          // le champion
const B = 'clubfb' + RUN;          // son dauphin

let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5250', FRUTISCORE_PORT: '5251',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/club/')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  // Les deux fichiers de données survivent d'une exécution à l'autre : on
  // retire nos joueurs pour ne pas polluer les suites suivantes.
  for (const fichier of ['data/scores.json', 'data/challenge-medals.json']) {
    try {
      const p = path.join(ROOT, fichier);
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (d.users) {
        for (const u of Object.keys(d.users)) if (u.startsWith('clubf')) delete d.users[u];
      }
      if (d.medalsByVisibleDay) {
        for (const [jour, parJoueur] of Object.entries(d.medalsByVisibleDay)) {
          for (const u of Object.keys(parJoueur)) if (u.startsWith('clubf')) delete parJoueur[u];
          if (Object.keys(parJoueur).length === 0) delete d.medalsByVisibleDay[jour];
        }
      }
      fs.writeFileSync(p, JSON.stringify(d));
    } catch { /* rien à nettoyer */ }
  }
});

async function semer(username, ranking, score) {
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: hdr,
    body: JSON.stringify({ username, password: 'secret123' }),
  });
  const r = await fetch(`${BASE}/api/admin/scores/${username}/${ranking}`, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ score }),
  });
  assert.ok(r.ok, `graine ${ranking} posée pour ${username}`);
}

const fiche = (pseudo) =>
  fetch(BASE + '/api/club/player?u=' + encodeURIComponent(pseudo)).then((r) => r.json());

// Les scores d'autres suites survivent dans data/scores.json : nos graines sont
// donc VOLONTAIREMENT hors d'atteinte, pour que la première place nous revienne
// quoi qu'il traîne dans le fichier.
test('les records d\'un joueur : son score, sa place, et les jeux qu\'on tait', async () => {
  await semer(A, 'snake3_classic', 9005000);
  await semer(A, 'kaluga_classic', 9003000);
  await semer(A, 'grapiz_challenge', 9000700);
  await semer(A, 'mb2_classic', 900);                 // MotionBall : jamais montré
  await semer(A, 'bkiwi_track1_classic', 50000);      // circuit « classique » : tu
  await semer(B, 'snake3_classic', 9004000);
  await semer(B, 'kaluga_classic', 9006000);

  const d = await fiche(A);
  assert.equal(d.ok, true, 'la fiche répond');
  assert.equal(d.user, A);
  assert.ok(d.bouille && d.bouille.length >= 2, 'une bouille à dessiner');

  const parId = Object.fromEntries(d.records.map((r) => [r.id, r]));
  assert.ok(parId.snake3_classic, 'Frutisnake est là');
  assert.equal(parId.snake3_classic.rang, 1, 'neuf millions cinq mille devant neuf millions quatre mille');
  assert.ok(parId.snake3_classic.sur >= 2, 'et il y a bien du monde à devancer');
  // Mise en forme française : le séparateur de milliers est une espace — fine
  // et insécable selon la version d'ICU, d'où la comparaison sur les chiffres.
  assert.match(parId.snake3_classic.label, /^9\s005\s000$/, 'le score est mis en forme');
  const kalugaB = Object.fromEntries((await fiche(B)).records.map((r) => [r.id, r]));
  assert.ok(parId.kaluga_classic.rang > kalugaB.kaluga_classic.rang,
    'à Kaluga, c\'est l\'autre qui mène');
  assert.ok(parId.grapiz_challenge, 'le championnat compte aussi');

  assert.equal(d.records.some((r) => r.jeu === 'mb2'), false,
    'MotionBall n\'a pas de ligne sur une fiche');
  assert.equal(d.records.some((r) => /^bkiwi_.*_classic$/.test(r.id)), false,
    'ni les circuits « classiques » de Burning Kiwi');

  // Le nom du jeu est lisible : c'est lui que la carte porte.
  assert.equal(parId.snake3_classic.jeuNom, 'Frutisnake');
});

test('la fiche se trouve quelle que soit la casse, et se tait sur un inconnu', async () => {
  const d = await fiche(A.toUpperCase());
  assert.equal(d.ok, true, 'EN MAJUSCULES aussi');
  assert.equal(d.user, A, 'le pseudo revient tel qu\'il est écrit');

  const rien = await fiche('cepseudonexistepas' + RUN);
  assert.equal(rien.ok, false);
  assert.equal(rien.error, 'inconnu');

  const vide = await fetch(BASE + '/api/club/player').then((r) => r.json());
  assert.equal(vide.ok, false, 'sans pseudo, pas de fiche');
});

test('la liste des joueurs ne retient que ceux qui ont quelque chose à montrer', async () => {
  const d = await fetch(BASE + '/api/club/players').then((r) => r.json());
  assert.ok(Array.isArray(d.joueurs));
  assert.ok(d.joueurs.includes(A), 'le champion y est');
  assert.ok(d.joueurs.includes(B), 'son dauphin aussi');
  const trie = d.joueurs.slice().sort((x, y) => x.localeCompare(y, 'fr'));
  assert.deepEqual(d.joueurs, trie, 'la liste est rangée par ordre alphabétique');
});

test('le livre des records du Club survit au partage de son calcul', async () => {
  const d = await fetch(BASE + '/api/club/records?limit=5').then((r) => r.json());
  const snake = (d.rankings || []).find((r) => r.id === 'snake3_classic');
  assert.ok(snake, 'le classement est toujours servi');
  assert.equal(snake.scores[0].user, A, 'et son podium est le bon');
  assert.equal(snake.scores[0].score, 9005000);
  // MotionBall garde SON tableau : c'est la fiche qui l'écarte, pas le livre.
  assert.ok((d.rankings || []).some((r) => r.game === 'mb2'), 'MotionBall reste au livre');
});

test('les médailles se rangent par mois puis par jeu — MotionBall compris', async () => {
  const roll = await fetch(BASE + '/api/admin/challenge/roll', { method: 'POST', headers: hdr });
  assert.ok(roll.ok, 'le tirage des médailles a tourné');

  const d = await fiche(A);
  assert.equal(d.ok, true);
  assert.ok(d.medailles.total > 0, 'le champion a été médaillé');
  assert.equal(
    d.medailles.or + d.medailles.argent + d.medailles.bronze, d.medailles.total,
    'les trois métaux font le compte'
  );
  assert.ok(d.medailles.rang >= 1, 'et il a une place au tableau des médaillés');

  // Une seule journée tirée, donc un seul mois — celui d'HIER, puisque le
  // tirage attribue les médailles de la veille.
  const hier = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() - 86400000));
  assert.equal(d.medaillesParMois.length, 1, 'un seul mois');
  assert.equal(d.medaillesParMois[0].cle, hier.substring(0, 7));
  assert.match(d.medaillesParMois[0].mois, /^[A-ZÀ-Ý][a-zà-ÿ]+ \d{4}$/,
    'le mois s\'écrit en toutes lettres (« Août 2026 »)');
  assert.equal(d.medaillesParMois[0].total, d.medailles.total,
    'et il porte toutes les médailles');

  const parJeu = Object.fromEntries(d.medaillesParJeu.map((l) => [l.jeu, l]));
  assert.ok(parJeu.snake3, 'Frutisnake a sa ligne');
  assert.equal(parJeu.snake3.nom, 'Frutisnake');
  assert.ok(parJeu.mb2, 'MotionBall AUSSI : une médaille reste une médaille');
  assert.equal(parJeu.mb2.nom, 'MotionBall');
  const somme = d.medaillesParJeu.reduce((n, l) => n + l.total, 0);
  assert.equal(somme, d.medailles.total, 'le tableau par jeu totalise pareil');

  // Le dauphin est médaillé lui aussi, derrière.
  const e = await fiche(B);
  assert.equal(e.ok, true);
  assert.ok(e.medailles.rang > d.medailles.rang, 'et il passe après le champion');
});

test('un joueur sans médaille reçoit une fiche vide, pas une erreur', async () => {
  const seul = 'clubfc' + RUN;
  await semer(seul, 'swapou2_contest', 42);
  const d = await fiche(seul);
  assert.equal(d.ok, true);
  assert.equal(d.medailles.total, 0);
  assert.equal(d.medailles.rang, null, 'pas de place au tableau des médaillés');
  assert.deepEqual(d.medaillesParMois, []);
  assert.deepEqual(d.medaillesParJeu, []);
  assert.ok(d.records.length >= 1, 'mais son record est bien là');
});

test('la page du Club n\'affiche plus la consécration, et ouvre une fiche', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/club/index.html'), 'utf8');
  assert.equal(/data-tab="consecration"/.test(html), false, 'plus d\'onglet consécration');
  assert.ok(/data-tab="fiche"/.test(html), 'un onglet « Fiche joueur » à la place');
  assert.ok(/api\/club\/player\?u=/.test(html), 'qui interroge la fiche');
  assert.ok(/bouille-thumb\.js/.test(html), 'et sait dessiner une bouille');
});

// Les médailles du bureau, pas celles de la police système : le jeton
// d'awards.swf sorti par scripts/extract-medailles-vierges.js.
test('les trois jetons de médaille sont ceux d\'awards.swf', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/club/index.html'), 'utf8');
  assert.equal(/[\u{1F947}-\u{1F949}]/u.test(html), false,
    'plus un seul émoji de médaille dans la page');
  for (const [fichier, teinte] of [
    ['medal_gold.svg', '#fedf0a'],       // le jaune du disque d'or
    ['medal_silver.svg', '#dddddd'],     // le gris de l'argent
    ['medal_bronze.svg', '#e19d37'],     // le cuivre du bronze
  ]) {
    assert.ok(html.includes('/fb/' + fichier), fichier + ' est appelé par la page');
    const svg = fs.readFileSync(path.join(ROOT, 'public/fb', fichier), 'utf8');
    assert.ok(svg.startsWith('<svg'), fichier + ' est bien du vecteur');
    assert.ok(svg.includes(teinte), fichier + ' porte la teinte du métal (' + teinte + ')');
    // La vignette du jeu est restée au SWF : le jeton n'a que ses trois anneaux.
    assert.equal((svg.match(/<path /g) || []).length, 3,
      fichier + ' : le disque et ses deux anneaux, rien d\'autre');
    const r = await fetch(BASE + '/fb/' + fichier);
    assert.ok(r.ok, fichier + ' est servi');
  }
});
