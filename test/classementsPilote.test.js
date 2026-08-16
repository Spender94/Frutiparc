/*
 * Les deux classements PILOTES de l'animation : MiniPixiz « Arbre creux » et
 * MiniWave « Challenge » (la map du jour — l'arcade, connue par cœur, ne
 * classe pas : un parcours commun est ce qui permet de comparer les scores).
 *
 * Deux modes qui n'avaient aucun classement. On les ouvre au challenge du jour
 * (section C) : remise à zéro quotidienne, médailles or/argent/bronze, kikooz,
 * podium de la veille — toute la mécanique existante, sans toucher au SWF.
 *
 * Ce que ce fichier vérifie, de bout en bout :
 *   · une partie enregistre bien un score dans la bonne cuve ;
 *   · les garde-fous de plausibilité écartent l'absurde (le score est calculé
 *     par le NAVIGATEUR dans ces deux portages) sans gêner une vraie partie ;
 *   · le niveau atteint voyage et s'affiche à côté des points ;
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

// La taille de la map du Challenge : la borne de niveau du classement MiniWave
// se dérive du module du mode (même source que le serveur).
const NB_NIVEAUX_DEFI = require(path.join(ROOT, 'public/miniwave/challenge.js')).NIVEAUX_PAR_JOUR;

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

test('une partie de Challenge entre avec son niveau, affiché à côté des points', async () => {
  const u = joueur('defi');
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

test('un score de Challenge incohérent avec le niveau est refusé', async () => {
  const u = joueur('trichw');
  const sid = await sidPour(u);
  // Cent mille points en étant resté au niveau 1 : impossible (le niveau le
  // plus riche que le générateur sache produire vaut ~6 000 points).
  const r = await enregistrer(sid, 'miniwave', 100000, '1');
  assert.equal(r.statut, 400, 'refusé');
  assert.match(r.raison, /incohérent avec le niveau/);

  // La map du jour compte NIVEAUX_PAR_JOUR niveaux, pas un de plus : au-delà,
  // le niveau n'existe pas. Le garde-fou se dérive du module du mode — la
  // borne suit la map si elle est un jour retaillée.
  const r2 = await enregistrer(sid, 'miniwave', 5000, String(NB_NIVEAUX_DEFI + 1));
  assert.equal(r2.statut, 400, 'niveau hors map refusé');
  const r3 = await enregistrer(sid, 'miniwave', 5000, '404');
  assert.equal(r3.statut, 400, 'le niveau d\'arcade d\'hier ne passe plus');

  // Et une grosse performance, au niveau qui va avec, passe — y compris au
  // tout dernier niveau de la map.
  const ok = await enregistrer(sid, 'miniwave', 300000, String(NB_NIVEAUX_DEFI));
  assert.equal(ok.ok, true, 'un gros score au bout de la map est légitime');
  assert.equal((ligne((await onglets()).miniwave_classic, u) || {}).score, 300000);
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

// Les étiquettes d'images de public/awards.swf, avec leur NUMÉRO d'image :
// c'est `gotoAndStop(<étiquette>)` qui choisit le dessin de la médaille.
function vignettesAwards() {
  const raw = fs.readFileSync(path.join(ROOT, 'public/awards.swf'));
  const body = raw.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  const parImage = {};                 // étiquette → numéro d'image, PELLICULE RACINE
  const labels = [];                   // toutes les étiquettes, sprites compris
  let image = 1;
  (function tags(from, to, racine) {
    let o = from;
    while (o < to - 1) {
      const hdr = body.readUInt16LE(o), code = hdr >> 6;
      let len = hdr & 0x3f, hs = 2;
      if (len === 0x3f) { len = body.readUInt32LE(o + 2); hs = 6; }
      if (code === 0) break;
      const corps = o + hs;
      if (code === 43) {
        const nom = body.slice(corps, body.indexOf(0, corps)).toString('latin1');
        labels.push(nom);
        if (racine) parImage[nom] = image;   // le numéro n'a de sens qu'ici
      }
      if (code === 1 && racine) image++;
      if (code === 39) tags(corps + 4, corps + len, false);
      o = corps + len;
    }
  })(Math.ceil((5 + ((body[0] >> 3) & 0x1f) * 4) / 8) + 4, body.length, true);
  return { labels, parImage };
}

test('les deux pilotes ont une vignette de médaille SOUS LEUR PROPRE NOM', () => {
  // Deux endroits du bureau demandent une médaille, et ils ne nomment pas
  // l'étiquette de la même façon :
  //
  //   · la FICHE (awarduser) prend le nom dans la réponse du serveur — c'est
  //     nous qui choisissons, d'où MEDAL_AWARD_FRAME ;
  //   · le TABLEAU DES SCORES, lui, ne demande rien : main.swf construit
  //     `{frame: currentRanking.game}` avec l'identifiant du jeu
  //     (« miniwave », « minipixiz »). Hors de portée du serveur.
  //
  // D'où les étiquettes ALIAS posées sur les images existantes : les deux noms
  // mènent au même dessin, et les médailles apparaissent des deux côtés.
  const { parImage } = vignettesAwards();
  assert.ok(parImage.wave, 'l\'image d\'époque de Mini-Wave est là');
  assert.ok(parImage.tris, 'celle de Tris — empruntée par MiniPixiz — aussi');
  assert.equal(parImage.miniwave, parImage.wave,
    '« miniwave » désigne la MÊME image que « wave »');
  assert.equal(parImage.minipixiz, parImage.tris,
    '« minipixiz » désigne la même image que « tris »');
});

test('les vignettes de médaille désignent des dessins qui existent vraiment', () => {
  // public/awards.swf porte une vignette par jeu du catalogue de 2006 ;
  // le bureau en choisit une par son LABEL D'IMAGE. Un nom absent n'affiche
  // pas la médaille d'un autre jeu — il n'affiche rien du tout.
  const { labels } = vignettesAwards();

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
  // dérive de la section C : rien d'autre à câbler. Un seul exclu, le proxy
  // bkiwi — remplacé par les vrais classements par circuit, il ferait doublon.
  assert.match(src, /section === 'C' && r\.internal\s*&& r\.internal !== 'bkiwi_track5_classic'\)/);
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
  assert.match(mw, /l\.mode === 'challenge'/, 'le Challenge, et lui seul, est classé');
  assert.match(mw, /plateforme\.envoyerScore\(info\.score, \(Number\(info\.level\) \|\| 0\) \+ 1\)/,
    'le niveau affiché part avec le score');
  const mwP = fs.readFileSync(path.join(ROOT, 'public/miniwave/plateforme.js'), 'utf8');
  assert.match(mwP, /game: 'miniwave', m: '0'/);
});

// ── L'Arbre creux : le contrat d'événement dont dépend la remontée ────────
//
// Le portage envoie son score sur « finPartie ». Or l'arbre émet AUSSI
// « record » quand le record personnel tombe, et le gestionnaire de la page
// traite « record » par un `return` anticipé. Si les deux se confondaient, une
// partie sur deux ne remonterait pas. Ce test épingle le contrat : « finPartie »
// arrive TOUJOURS, record ou pas — et le score de l'arbre est lisible dessus.

test('l\'arbre émet finPartie à chaque partie, record personnel ou non', () => {
  const X = require('../public/minipixiz/lieux.js');
  const P = require('../public/minipixiz/plateforme.js');
  const F = require('../public/minipixiz/faerie.js');

  const partie = (treeMaxAvant, score) => {
    const c = P.carteNeuve(1700000000000);
    c.$stat.$treeMax = treeMaxAvant;
    const vus = [];
    const a = new X.Arbre({
      carte: c, fee: F.genererGraine(() => 0.5), graine: 11,
      surEvenement: (n, d) => vus.push({ n, score: d && d.score }),
    });
    a.score = score;
    a.jeu.finPartie(false);
    return { vus: vus.map((v) => v.n), score: a.score, treeMax: c.$stat.$treeMax };
  };

  // Record battu : « record » ET « finPartie ».
  const bat = partie(0, 4200);
  assert.ok(bat.vus.includes('record'), 'le record est annoncé');
  assert.ok(bat.vus.includes('finPartie'), 'et la fin de partie aussi');
  assert.equal(bat.treeMax, 4200, 'le record personnel monte');

  // SOUS le record : pas de « record », mais « finPartie » quand même — c'est
  // LE cas qui doit continuer d'alimenter le challenge du jour.
  const sous = partie(99999, 1500);
  assert.ok(!sous.vus.includes('record'), 'pas de record personnel');
  assert.ok(sous.vus.includes('finPartie'), 'mais la fin de partie est bien annoncée');
  assert.equal(sous.score, 1500, 'et le score de l\'arbre est lisible sur le lieu');
  assert.equal(sous.treeMax, 99999, 'le record personnel ne bouge pas');
});

// ── Le rattrapage du BUREAU (le SWF n'envoie aucun score) ─────────────────

test('un record d\'arbre battu au bureau entre au classement du jour', async () => {
  const u = joueur('bureau');
  const sid = await sidPour(u);
  const fiche = (treeMax) => JSON.stringify({
    $stat: { $item: [], $eat: [], $kill: [0, 0, 0, 0, 0], $run: 40,
      $game: [0, 0, 0, 0, 3], $forestMax: 5, $treeMax: treeMax, $misNum: 0 },
    $diam: 0, $key: 2, $star: 4, $bag: 2, $frog: false, $checkpoint: 0,
    $dungeon: { $lvl: 0, $f: false, $loop: 0, $day: 0 },
    $rainbow: { $f: false, $day: 0, $it: 0 }, $pond: { $q: 0, $d: 0, $fs: null },
    $faerie: [], $vs: 1.2, $inv: [], $current: null, $help: [true, true, true],
    $mis: [], $mission: [], $wind: 0, $god: [false, false, false],
    $time: { $t: Date.now(), $d: 3, $s: 21600000 },
  });
  const sauver = (treeMax) => fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'minipixiz', slotId: '0', data: fiche(treeMax) }),
  }).then((r) => r.text());

  await sauver(2000);                       // la fiche d'arrivée : rien à classer
  assert.equal(ligne((await onglets()).minipixiz_classic, u), null,
    'une fiche posée ne classe rien toute seule');

  await sauver(5600);                       // le record monte : une partie l'a battu
  assert.equal((ligne((await onglets()).minipixiz_classic, u) || {}).score, 5600,
    'le record battu au bureau entre au classement du jour');

  // Et la LIMITE, assumée : une partie du bureau qui ne bat pas le record ne
  // laisse aucune trace dans la fiche, donc rien à rattraper.
  await sauver(5600);
  assert.equal((ligne((await onglets()).minipixiz_classic, u) || {}).score, 5600,
    'le classement ne bouge pas — le bureau ne dit rien des parties non-records');
});

test('le record d\'arcade du bureau n\'entre PAS au classement — le Challenge classe', async () => {
  // Le classement MiniWave mesure la MAP DU JOUR, un mode du portage light
  // seulement : le SWF du bureau n'a que l'arcade, dont le parcours connu par
  // cœur ne départage personne. Une fiche du bureau dont $arcade.$bestScore
  // monte reste donc un RECORD PERSONNEL (conservé sur la carte, jamais
  // écrasé — miniwaveGreffeHorsTuyau y veille), mais ne classe rien.
  const u = joueur('arcbur');
  const sid = await sidPour(u);
  const P = require('../public/miniwave/plateforme.js');
  const fiche = (score, niveau) => {
    const c = P.carteNeuve();
    c.$arcade.$bestScore = score;
    c.$arcade.$bestLevel = niveau;
    return JSON.stringify(c);
  };
  const sauver = (score, niveau) => fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: fiche(score, niveau) }),
  }).then((r) => r.text());

  await sauver(12000, 9);
  assert.equal(ligne((await onglets()).miniwave_classic, u), null,
    'une fiche posée ne classe rien');

  await sauver(31000, 24);                  // le record d'arcade monte…
  assert.equal(ligne((await onglets()).miniwave_classic, u), null,
    '…et ne classe toujours rien : l\'arcade ne nourrit pas le classement du Challenge');

  // La fiche, elle, garde bien le record : c'est un trophée personnel.
  const brut = await (await fetch(`${BASE}/api/loadFrutiSlots?sid=${sid}&game=miniwave`)).text();
  const carte = JSON.parse(new URLSearchParams(brut).get('slot0'));
  assert.equal(carte.$arcade.$bestScore, 31000, 'le record personnel est sur la carte');
});
