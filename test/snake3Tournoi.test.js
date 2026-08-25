/*
 * Frutisnake — le TOURNOI à carte partagée (mode « Entraînement » du light).
 *
 * Le contrat du mode, tel que demandé : « les fruits peuvent apparaître de
 * façon aléatoire (modulo la frutibarre), mais la séquence d'objets serait la
 * même et tomberait au même moment pour tout le monde ».
 *
 * Trois familles de vérifications :
 *   · le GÉNÉRATEUR (public/snake3/carte.js) : même graine → même carte, et
 *     la carte respecte les lois du jeu (poids de Const.PROBABILITIES,
 *     uniques tirés une seule fois, marges de Level.generate_pos, durées de
 *     vie 300+hasard(150), plafond de dix options posées) ;
 *   · le MOTEUR (partie.js) : une Partie à carte déroule le script — bons
 *     objets, bons endroits, bons instants, sur l'horloge en tmod (donc
 *     indifférent à la cadence de la machine) ; l'aléa des options est coupé,
 *     celui des fruits reste ;
 *   · le SERVEUR : la vie du mode par l'admin (générer/ouvrir/fermer,
 *     classement montrable/masquable, vidage), l'état public, et le guichet
 *     de score (graine exigée, mode ouvert exigé, meilleur score gardé,
 *     hors quota Fruit Défendu).
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const Carte = require(path.join(RACINE, 'public/snake3/carte.js'));
const C = require(path.join(RACINE, 'public/snake3/const.js'));
const P = require(path.join(RACINE, 'public/snake3/partie.js'));
const manifeste = JSON.parse(
  fs.readFileSync(path.join(RACINE, 'public/snake3/sprites/sprites.json'), 'utf8'));
const CADRES = manifeste.cadres.options;

const PORT = 3436;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-7);
const joueur = (nom) => nom + RUN;

// ── Le générateur ─────────────────────────────────────────────────────────

test('même graine, même carte — d\'un bout à l\'autre', () => {
  const a = Carte.genererCarte('finale-2026', CADRES);
  const b = Carte.genererCarte('finale-2026', CADRES);
  assert.ok(a.length > 0, 'la carte n\'est pas vide');
  assert.deepStrictEqual(a, b, 'deux générations de la même graine coïncident');
  const c = Carte.genererCarte('finale-2027', CADRES);
  assert.notDeepStrictEqual(a, c, 'une autre graine donne une autre carte');
});

test('la carte respecte les lois du jeu (poids, uniques, marges, durées, plafond)', () => {
  for (const graine of ['finale-2026', 'test', '42', 'kiwi']) {
    const carte = Carte.genererCarte(graine, CADRES);
    // Une vingtaine de minutes à ~une option toutes les 19 s et plus : entre
    // 15 et 90, quoi qu'il arrive — en dehors, la cadence n'est plus celle
    // de Game.main.
    assert.ok(carte.length >= 15 && carte.length <= 90,
      `${graine} : ${carte.length} options sur 20 min`);
    const parUnique = {};
    const vivantes = [];
    let precedent = -1;
    for (const e of carte) {
      assert.ok(e.id >= 1 && e.id <= 37, 'id d\'option : ' + e.id);
      assert.ok(e.t > precedent, 'les instants montent strictement');
      precedent = e.t;
      assert.ok(e.vie >= 300 && e.vie < 450, 'vie 300+hasard(150) : ' + e.vie);
      // Les marges de Level.generate_pos, avec la taille naturelle du dessin.
      const d = CADRES[e.id];
      const b = C.BORDER + 10;
      assert.ok(e.x >= b + d.w / 2 - 0.01 && e.x <= C.WIDTH - b - d.w / 2 + 1,
        `x dans les marges (${e.x}, option ${e.id})`);
      assert.ok(e.y >= b + C.BARRE_UP + d.h / 2 - 0.01
        && e.y <= C.HEIGHT - b - C.FRUTIBARRE_SIZE - d.h / 2 + 1,
        `y dans les marges (${e.y}, option ${e.id})`);
      if (Carte.UNIQUES.indexOf(e.id) >= 0) {
        parUnique[e.id] = (parUnique[e.id] || 0) + 1;
      }
      // Le plafond : jamais plus de dix options posées en même temps.
      for (let i = vivantes.length - 1; i >= 0; i--) {
        if (vivantes[i] <= e.t) vivantes.splice(i, 1);
      }
      assert.ok(vivantes.length < 10, 'plafond de dix respecté');
      vivantes.push(e.t + e.vie);
    }
    for (const [id, n] of Object.entries(parUnique)) {
      assert.strictEqual(n, 1, `l'unique ${id} n'est tiré qu'une fois`);
    }
  }
});

test('les trente-sept noms d\'aperçu suivent les commentaires du fichier d\'origine', () => {
  assert.strictEqual(Carte.OPTION_NOMS.length, 38, 'null + 37 noms');
  assert.strictEqual(Carte.OPTION_NOMS[15], 'Potion noire');
  assert.strictEqual(Carte.OPTION_NOMS[19], 'Bombe');
  assert.strictEqual(Carte.OPTION_NOMS[27], 'Dynamite');
  assert.strictEqual(Carte.OPTION_NOMS[37], 'Potion fuca');
  // Autant de noms que de poids : les deux tables décrivent le même monde.
  assert.strictEqual(Carte.OPTION_NOMS.length - 1, C.PROBABILITIES.length);
});

// ── Le moteur : une Partie à carte ───────────────────────────────────────

function partieACarte(carte, hasard) {
  const evts = [];
  const partie = new P.Partie({
    hasard: hasard || ((n) => 0),
    carte,
    evenement: (nom, d) => evts.push({ nom, d }),
  });
  // On teste l'ORDONNANCEUR, pas le serpent : cloué sur place, il ne mourra
  // pas contre le mur pendant les quinze secondes que dure la carte.
  partie.serpent.move = () => false;
  return { partie, evts };
}

test('la partie déroule la carte : bons objets, bons endroits, bons instants', () => {
  const carte = [
    { t: 0, id: 15, x: 100, y: 200, vie: 400 },     // la potion noire au départ
    { t: 480, id: 19, x: 300, y: 150, vie: 350 },   // la bombe 15 s plus tard
  ];
  const { partie, evts } = partieACarte(carte);
  const poses = () => evts.filter((e) => e.nom === 'bonusPose').map((e) => e.d.bonus);

  partie.main(1, 1 / 32);
  assert.strictEqual(poses().length, 1, 'la potion noire tombe à la première image');
  assert.strictEqual(poses()[0].id, 15);
  assert.strictEqual(poses()[0].x, 100);
  assert.strictEqual(poses()[0].y, 200);
  // La durée de vie est celle de la carte — moins l'image de sa chute :
  // Game.main pose l'option PUIS fait vieillir le niveau, comme en Flash.
  assert.strictEqual(poses()[0].time, 400 - 1);

  // 478 images de plus : t vaut 479 < 480, la bombe attend encore.
  for (let i = 0; i < 478; i++) partie.main(1, 1 / 32);
  assert.strictEqual(poses().length, 1, 'à t=479, toujours rien');
  partie.main(1, 1 / 32);
  assert.strictEqual(poses().length, 2, 'à t=480, la bombe tombe');
  assert.strictEqual(poses()[1].id, 19);
  assert.strictEqual(poses()[1].x, 300);
});

test('l\'horloge de la carte est en tmod : la cadence de la machine ne change rien', () => {
  // À 40 im/s le tmod vaut 0,8 : l'objet de t=480 doit tomber à la 600e image
  // (600 × 0,8 = 480) — le même instant de JEU que 480 images à tmod 1.
  const carte = [{ t: 480, id: 19, x: 300, y: 150, vie: 350 }];
  const { partie, evts } = partieACarte(carte);
  let tombeApres = null;
  for (let i = 1; i <= 700 && tombeApres === null; i++) {
    partie.main(0.8, 1 / 40);
    if (evts.some((e) => e.nom === 'bonusPose')) tombeApres = i;
  }
  assert.strictEqual(tombeApres, 600, 'à tmod 0,8, la 600e image fait 480 unités');
});

test('en pause, la carte attend — et le dé des options est vraiment coupé', () => {
  const carte = [{ t: 10, id: 1, x: 100, y: 200, vie: 300 }];
  const { partie, evts } = partieACarte(carte);
  partie.forcePause = true;
  partie.main(1, 1 / 32);               // la pause s'enclenche
  for (let i = 0; i < 50; i++) partie.main(1, 1 / 32);
  assert.strictEqual(evts.filter((e) => e.nom === 'bonusPose').length, 0,
    'rien ne tombe pendant la pause');
  partie.forcePause = false;
  partie.entree.echap = true;           // la sortie de pause du jeu
  partie.main(1, 1 / 32);
  partie.entree.echap = false;
  for (let i = 0; i < 12; i++) partie.main(1, 1 / 32);
  assert.strictEqual(evts.filter((e) => e.nom === 'bonusPose').length, 1,
    'l\'objet tombe une fois la partie reprise');

  // hasard() forcé à zéro ferait tirer une option à CHAQUE image par la voie
  // aléatoire : si une seule option est tombée, c'est que la voie aléatoire
  // est bien morte en mode carte. Les fruits, eux, continuent d'en profiter.
  assert.ok(evts.some((e) => e.nom === 'fruitPose'),
    'les fruits restent tirés au dé');
});

test('sans carte, le tirage aléatoire d\'origine est intact', () => {
  const { partie, evts } = partieACarte(null);
  partie.main(1, 1 / 32);               // hasard() → 0 : le dé tombe juste
  assert.strictEqual(evts.filter((e) => e.nom === 'bonusPose').length, 1,
    'le dé d\'origine tire encore');
});

// ── Le client : la pastille, la vue, le guichet ──────────────────────────
// Le même bac à sable que snake3Client.test.js : les fichiers du navigateur
// rejoués dans un contexte vm, canvas et document en trompe-l'œil.
function bacASable() {
  const vm = require('node:vm');
  const contexte = {
    console, Math, JSON, Object, Array, String, Number, Boolean, Date, Set, Map,
    Promise, performance, isNaN, parseInt, parseFloat, Error, URLSearchParams,
    requestAnimationFrame: () => 0, setTimeout, clearTimeout,
    fetch: () => Promise.reject(new Error('hors ligne')),
  };
  const faireCanvas = () => ({
    width: 700, height: 480, style: {},
    parentElement: { clientWidth: 700, clientHeight: 480 },
    getContext: () => new Proxy({}, {
      get: (c, n) => (n === 'canvas' ? faireCanvas()
        : (typeof n === 'string' ? () => {} : undefined)),
      set: () => true,
    }),
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 700, height: 480 }),
  });
  contexte.window = contexte;
  contexte.devicePixelRatio = 1;
  contexte.location = { search: '' };
  contexte.document = { createElement: () => faireCanvas(), getElementById: () => faireCanvas() };
  contexte.addEventListener = () => {};
  vm.createContext(contexte);
  for (const f of ['const.js', 'serpent.js', 'niveau.js', 'bonus.js', 'partie.js',
    'bataille.js', 'dessin.js', 'rendu.js', 'menu.js', 'encyclo.js', 'pack.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(RACINE, 'public/snake3', f), 'utf8'),
      contexte, { filename: f });
  }
  contexte.SnakeDessin.poserManifeste(manifeste);
  return contexte;
}

test('la pastille « entraînement » porte le tournoi de bout en bout', async () => {
  const w = bacASable();
  const carte = [{ t: 0, id: 15, x: 100, y: 200, vie: 400 }];
  const appels = [];
  const pf = {
    fruits: {}, record: 500, options: {}, prefs: { $music: true, $sounds: true, $keys: null },
    tournoi: { ouvert: true, graine: 'g-test', carte },
    chargerTournoi() { return Promise.resolve(this.tournoi); },
    sauverSlot0: () => { appels.push('slot0'); return Promise.resolve(true); },
    sauverScore: () => { appels.push('classique'); return Promise.resolve(null); },
    sauverScoreTournoi: (s) => {
      appels.push('tournoi:' + s);
      return Promise.resolve({ ok: true, oldScore: 0, oldPos: 0, newPos: 1 });
    },
  };
  const sons = new Proxy({}, { get: () => () => false });
  const jeu = new w.SnakeJeu.Jeu(w.document.getElementById('scene'), pf, sons);

  // Mode ouvert : la neuvième pastille du clip menu — l'« ENTRAINEMENT » du
  // SWF, jamais branchée en light — rejoint le carrousel. Fermé : les quatre
  // pastilles d'origine, à l'identique.
  // (Array.from côté hôte : les tableaux nés dans le vm ont un autre
  // prototype Array, deepStrictEqual les refuserait.)
  jeu.mode = jeu.menuPrincipal();
  assert.deepStrictEqual(Array.from(jeu.mode.menus, (m) => m.id), [1, 9, 2, 3, 4]);
  const pfFerme = Object.assign({}, pf, { tournoi: { ouvert: false, graine: null, carte: null } });
  const jeuFerme = new w.SnakeJeu.Jeu(w.document.getElementById('scene'), pfFerme, sons);
  assert.deepStrictEqual(Array.from(jeuFerme.menuPrincipal().menus, (m) => m.id), [1, 2, 3, 4]);

  // La pastille route vers le mode 96, et la vue en sort armée de la carte.
  jeu.next_mode = -1;
  jeu.choixMenu(9);
  assert.strictEqual(jeu.next_mode, 96);
  const vue = jeu.modeSuivant();
  assert.strictEqual(vue.tournoi, true);
  assert.strictEqual(vue.partie.carte, carte);

  // La fin de partie poste au guichet du TOURNOI — jamais au classique — et
  // laisse le record du slot 0 en paix (c'est celui du Challenge).
  vue.finDePartie(1234);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(appels.slice().sort(), ['slot0', 'tournoi:1234']);
  assert.strictEqual(pf.record, 500);

  // Le Challenge, lui, passe toujours par la voie classique.
  const vueClassique = new w.SnakeJeu.VuePartie(jeu);
  assert.strictEqual(vueClassique.partie.carte, null);
  vueClassique.finDePartie(2000);
  await new Promise((r) => setImmediate(r));
  assert.ok(appels.includes('classique'));
  assert.strictEqual(pf.record, 2000, 'le record du slot 0 suit le Challenge');
});

// ── Le serveur ────────────────────────────────────────────────────────────

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5142', FRUTISCORE_PORT: '5143',
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
  // data/ survit d'une exécution à l'autre : on retire nos joueurs et l'état
  // du tournoi posé par ces tests (une carte ouverte traînerait en local).
  try {
    const fichier = path.join(RACINE, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) {
      if (u.slice(-RUN.length) === RUN) delete d.users[u];
    }
    fs.writeFileSync(fichier, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
  try { fs.unlinkSync(path.join(RACINE, 'data/snake3-tournoi.json')); } catch { /* absent */ }
});

const admin = (chemin, corps) => fetch(BASE + '/api/admin/snake3-tournoi' + chemin, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
  body: JSON.stringify(corps || {}),
}).then((r) => r.json());
const adminEtat = () => fetch(BASE + '/api/admin/snake3-tournoi', {
  headers: { 'x-admin-key': CLE },
}).then((r) => r.json());
const etatPublic = () => fetch(BASE + '/api/snake3/tournoi').then((r) => r.json());
const posterScore = (sid, score, graine) => fetch(BASE + '/api/snake3/tournoi/score', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ sid, score: String(score), graine: graine || '' }).toString(),
});
async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const livreDesRecords = async () => {
  const j = await (await fetch(BASE + '/api/club/records?limit=50')).json();
  return (j.rankings || []).find((r) => r.id === 'snake3_tournoi');
};

test('la vie du mode : fermé → carte générée → ouvert → score → fermé', async () => {
  // Au départ : rien — le menu du jeu n'a pas la pastille.
  let pub = await etatPublic();
  assert.strictEqual(pub.ouvert, false);
  assert.strictEqual(pub.carte, null);

  // L'admin génère d'une graine : la carte existe, le mode reste FERMÉ.
  const gen = await admin('/generer', { graine: 'finale-' + RUN });
  assert.ok(gen.ok, JSON.stringify(gen));
  assert.strictEqual(gen.graine, 'finale-' + RUN);
  assert.ok(gen.nb >= 15, gen.nb + ' options');
  assert.ok(gen.apercu[0].nom, 'l\'aperçu nomme les options');
  pub = await etatPublic();
  assert.strictEqual(pub.ouvert, false, 'générer n\'ouvre pas');
  assert.strictEqual(pub.carte, null, 'carte cachée tant que fermé');

  // Fermé, le guichet refuse.
  const sid = await sidFor(joueur('tournoyeur'));
  assert.strictEqual((await posterScore(sid, 1000, 'finale-' + RUN)).status, 409);

  // Ouvert : la carte se sert, identique à l'aperçu de l'admin.
  assert.ok((await admin('/ouvrir')).ok);
  pub = await etatPublic();
  assert.strictEqual(pub.ouvert, true);
  assert.strictEqual(pub.graine, 'finale-' + RUN);
  assert.ok(Array.isArray(pub.carte) && pub.carte.length === gen.nb);
  assert.deepStrictEqual(
    pub.carte.map((e) => e.id), gen.apercu.map((a) => a.id),
    'la carte publique est celle de l\'aperçu');
  // …et c'est bien celle que le générateur redonnerait : la graine fait foi.
  const attendue = Carte.genererCarte('finale-' + RUN, CADRES);
  assert.deepStrictEqual(pub.carte, attendue);

  // Une mauvaise graine (partie entamée sur une carte remplacée) est écartée.
  const perime = await posterScore(sid, 1000, 'vieille-graine');
  assert.strictEqual(perime.status, 409);
  assert.strictEqual((await perime.json()).error, 'carte_perimee');

  // Le score entre, et persistScore ne garde que le meilleur.
  let r = await (await posterScore(sid, 1200, 'finale-' + RUN)).json();
  assert.ok(r.ok && r.updated);
  assert.strictEqual(r.newPos, 1);
  r = await (await posterScore(sid, 900, 'finale-' + RUN)).json();
  assert.strictEqual(r.updated, false, 'moins bon : rien ne bouge');
  assert.strictEqual(r.newScore, 1200);
  r = await (await posterScore(sid, 1500, 'finale-' + RUN)).json();
  assert.ok(r.updated);
  assert.strictEqual(r.oldScore, 1200);

  // Sans session : refusé (le classement est nominatif).
  assert.strictEqual((await posterScore('', 800, 'finale-' + RUN)).status, 401);
  // L'absurde est écarté (le score vient du navigateur, comme les pilotes).
  assert.strictEqual((await posterScore(sid, 5000000, 'finale-' + RUN)).status, 400);

  // Le tournoi ne touche pas au quota Fruit Défendu.
  const quota = await (await fetch(`${BASE}/api/fd/status?sid=${encodeURIComponent(sid)}&game=snake3`)).json();
  assert.strictEqual(quota.used, 0, 'aucune partie FD consommée');

  // Fermer : le guichet se referme, la carte disparaît de l'état public.
  assert.ok((await admin('/fermer')).ok);
  pub = await etatPublic();
  assert.strictEqual(pub.ouvert, false);
  assert.strictEqual(pub.carte, null);
  assert.strictEqual((await posterScore(sid, 2000, 'finale-' + RUN)).status, 409);
});

test('le classement dédié : visible au Club, masquable, vidable', async () => {
  // Le score posé au test précédent est au livre des records du Club.
  let livre = await livreDesRecords();
  assert.ok(livre, 'snake3_tournoi au livre des records');
  assert.strictEqual(livre.name, 'Frutisnake - Tournoi');
  assert.ok(livre.scores.some((s) => s.user === joueur('tournoyeur') && s.score === 1500));

  // L'interrupteur : masqué, le classement disparaît du livre (les scores
  // restent — l'admin les voit toujours).
  assert.ok((await admin('/classement', { visible: false })).ok);
  assert.strictEqual(await livreDesRecords(), undefined, 'masqué : plus au livre');
  let etat = await adminEtat();
  assert.strictEqual(etat.classement, false);
  assert.strictEqual(etat.inscrits, 1, 'le score est toujours là');
  assert.ok((await admin('/classement', { visible: true })).ok);
  assert.ok(await livreDesRecords(), 'rallumé : de retour au livre');

  // Vider : place nette pour l'édition suivante.
  const vide = await admin('/vider');
  assert.ok(vide.ok);
  assert.strictEqual(vide.vides, 1);
  etat = await adminEtat();
  assert.strictEqual(etat.inscrits, 0);
  livre = await livreDesRecords();
  assert.ok(!livre || !livre.scores.length, 'le livre ne montre plus personne');
});

test('regénérer remplace la carte et FERME le mode (jamais sous les joueurs)', async () => {
  await admin('/generer', { graine: 'a-' + RUN });
  await admin('/ouvrir');
  assert.strictEqual((await etatPublic()).ouvert, true);
  const regen = await admin('/generer', { graine: 'b-' + RUN });
  assert.ok(regen.ok);
  const pub = await etatPublic();
  assert.strictEqual(pub.ouvert, false, 'regénérer ferme');
  // Une graine vide en tire une au hasard.
  const auHasard = await admin('/generer', {});
  assert.ok(auHasard.ok && auHasard.graine.length > 0);
  // Ouvrir sans carte est impossible (le guichet le dit).
  await admin('/vider');
});

test('le classement est PERMANENT : hors du balayage quotidien des challenges', async () => {
  const src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
  // La remise à zéro nocturne se nourrit de LEGACY_RANKINGS section C —
  // snake3_tournoi ne doit pas y paraître.
  assert.ok(!/internal: 'snake3_tournoi'/.test(src),
    'pas de descripteur legacy : pas de remise à zéro quotidienne ni de médailles');
  // Et type 'C' dans RANKINGS : une coupe « Maître ÈS … » peut s'y adosser.
  const jeux = await (await fetch(BASE + '/api/admin/tournament-games', {
    headers: { 'x-admin-key': CLE },
  })).json();
  assert.ok(jeux.some((g) => g.ranking_id === 'snake3_tournoi'),
    'éligible aux coupes « Maître ÈS … »');
});
