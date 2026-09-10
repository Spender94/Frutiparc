/*
 * Mini-Wave : le FD light et la MAP DU JOUR du mode Challenge.
 *
 * Deux nouveautés d'un même mouvement :
 *
 * · UN DISQUE ROUGE dans « Mes disques » ouvre le portage HTML depuis le mode
 *   Frutiz — même mécanique que le FD MiniPixiz light : discType 3
 *   (GAMEDISC_RED, jamais consommé), gameId marqueur `light/miniwave` que
 *   ruffle.html détourne vers /miniwave/.
 *
 * · UN MODE CHALLENGE calqué sur l'arcade, mais dont les niveaux sont GÉNÉRÉS
 *   et changent chaque jour. L'arcade est toujours le même enchaînement — la
 *   map du jour ne l'est jamais. Le serveur publie une graine (minuit Paris
 *   fait foi), le générateur embarqué la déroule : même graine, même map, pour
 *   tout le monde. Quarante niveaux, difficulté croissante jusqu'à la ZONE
 *   ROUGE (le dernier quart, fait pour ne presque jamais être passé — c'est le
 *   niveau atteint qui départage), pas de titres, pas de boss (il reste
 *   l'apanage de l'arcade), et un profil de map tiré du jour — certaines
 *   journées sont plus féroces que d'autres.
 *
 * · Et c'est LE CHALLENGE QUI CLASSE : le classement quotidien MiniWave mesure
 *   la map du jour (un parcours commun, les scores se comparent), plus
 *   l'arcade (connue par cœur, elle ne départage personne).
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3501;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const C = require(path.join(ROOT, 'public/miniwave/challenge.js'));
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const P = require(path.join(ROOT, 'public/miniwave/plateforme.js'));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5254', FRUTISCORE_PORT: '5255',
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
after(() => { if (proc) proc.kill('SIGKILL'); });

async function sidPour(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const d = await r.json();
  assert.ok(d.sid, 'connexion → sid');
  return d.sid;
}

// ── Le FD rouge ───────────────────────────────────────────────────────────

test('le disque light Mini-Wave est dans « Mes disques », rouge, à côté du noir', async () => {
  const sid = await sidPour('mwfd' + RUN);
  const xml = await (await fetch(`${BASE}/ff/ls?uid=disccollector&sid=${sid}`)).text();
  const light = /<e u="miniwavelight"[^>]*>([^<]*)<\/e>/.exec(xml);
  assert.ok(light, `le disque light est listé (${xml.slice(0, 300)})`);
  const [type, vignette] = light[1].split('\n');
  assert.equal(type, '3', 'discType 3 = GAMEDISC_RED — l\'anneau rouge, jamais consommé');
  assert.equal(vignette, 'miniwave', 'la vignette d\'époque du jeu (fileIcon.swf la porte)');
  const flash = /<e u="miniwave1"[^>]*>([^<]*)<\/e>/.exec(xml);
  assert.ok(flash && flash[1].split('\n')[0] === '0', 'le FD noir d\'origine n\'a pas bougé');
});

test('le disque light livre son marqueur, et ruffle.html sait l\'ouvrir', async () => {
  const xml = await (await fetch(`${BASE}/do/ld?u=miniwavelight`)).text();
  assert.match(xml, /t="3"/, 'rouge sur le fil aussi');
  assert.match(xml, /u="light\/miniwave"/, 'le gameId est le marqueur, pas un SWF');
  assert.doesNotMatch(xml, /\.swf/, 'rien à charger dans Ruffle');
  assert.match(xml, /n="miniwave"/, 'le jeu annoncé reste Mini-Wave (voyant, classement)');

  const src = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');
  assert.match(src, /"light\/miniwave":\s*\{\s*url:\s*"\/miniwave\/"/,
    'la table des clients light le route vers /miniwave/');
});

// ── Le générateur de la map du jour ───────────────────────────────────────

test('même graine, même map — au bit près ; graines différentes, maps différentes', () => {
  const a = C.genererMap(20260811);
  const b = C.genererMap(20260811);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'déterministe');
  const c = C.genererMap(20260812);
  assert.notEqual(JSON.stringify(a.niveaux), JSON.stringify(c.niveaux), 'la map change avec la graine');
  assert.equal(a.niveaux.length, C.NIVEAUX_PAR_JOUR, 'le nombre de niveaux du jour est fixé');
});

/*
 * Le vivier du générateur, recompté sur les niveaux DESSINÉS À LA MAIN.
 *
 * Le bestiaire du moteur compte cinquante et une espèces ; les deux cents
 * niveaux de l'arcade n'en font voler que quarante et une. Les dix autres —
 * le Pruneau passe-muraille, les huit fruits des missions spéciales et le
 * Letter-monster du mode lettre — n'ont jamais volé en escadre. La map du jour
 * ne doit pas les inventer : on avait vu débarquer le mode lettre au niveau 33.
 */
test('le vivier du Challenge est exactement ce que l\'arcade fait voler', () => {
  const niveaux = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/miniwave/levels.json'), 'utf8'));
  const arcade = niveaux.main.find((g) => g.name === 'arcade') || niveaux.main[0];
  const vus = new Set();
  for (const lv of arcade.levels) {
    for (const ligne of (lv.list || [])) {
      if (!ligne) continue;
      for (const c of ligne) if (c && Number.isInteger(c.t)) vus.add(c.t);
    }
  }
  const absents = [];
  for (let t = 0; t < E.ENNEMIS.length; t++) if (!vus.has(t)) absents.push(t);
  assert.deepEqual(absents.sort((a, b) => a - b), C.HORS_ESCADRE.slice().sort((a, b) => a - b),
    'HORS_ESCADRE liste exactement les espèces que l\'arcade n\'emploie jamais');

  const vivier = C.typesJouables().map((p) => p.type).sort((a, b) => a - b);
  assert.deepEqual(vivier, [...vus].sort((a, b) => a - b), 'et le vivier est le complément');
  assert.equal(vivier.length, 41, 'quarante et une espèces');
  // Les deux bêtes que le joueur a croisées à tort.
  assert.equal(E.ENNEMIS[50].name, 'Letter-monster');
  assert.equal(E.ENNEMIS[48].name, 'Brugnon cuirassé');
  for (const t of [48, 50]) assert.ok(!vivier.includes(t), `${E.ENNEMIS[t].name} reste dehors`);
  // Et l'Astro-raisin, qu'un filtre trop large écartait, revient : l'arcade le
  // fait voler trente-deux fois.
  assert.equal(E.ENNEMIS[34].name, 'Astro-raisin');
  assert.ok(vivier.includes(34), 'l\'Astro-raisin vole bien en escadre');
});

test('chaque niveau généré respecte le contrat du moteur, sur 300 graines', () => {
  for (let g = 1; g <= 300; g++) {
    const m = C.genererMap(g);
    assert.ok(C.PROFILS.some((p) => p.nom === m.profil), 'le profil est un des profils connus');
    for (const lv of m.niveaux) {
      // Pas de titre — et surtout jamais « boss », le nom qui déclenche
      // l'étape boss dans le moteur.
      assert.equal(lv.name, undefined, 'pas de titre de niveau');
      assert.ok(lv.list.length >= 1, 'au moins une escadre');
      assert.ok(Number.isFinite(lv.moveSpeed) && Number.isFinite(lv.fallSpeed), 'vitesses finies');
      for (const ligne of lv.list) {
        // ligne[0] et ligne[1] portent la direction d'entrée : deux ennemis
        // minimum, sans trous en tête.
        assert.ok(ligne.length >= 2, 'deux ennemis par escadre au moins');
        for (const c of ligne) {
          assert.ok(Number.isInteger(c.t) && E.ENNEMIS[c.t] && E.ENNEMIS[c.t].rank !== undefined,
            `type valide (${c.t})`);
          assert.ok(!C.HORS_ESCADRE.includes(c.t),
            `${E.ENNEMIS[c.t].name} (type ${c.t}) ne vole pas en escadre dans l'arcade`);
          assert.ok(c.x >= 24 && c.x <= 216, `x dans la fenêtre du jeu (${c.x})`);
          assert.ok(c.y >= 40 && c.y <= 128, `y dans la fenêtre du jeu (${c.y})`);
        }
      }
    }
  }
});

test('la difficulté monte le long de la map : espèces plus dures, niveaux plus gros', () => {
  // Deux garanties distinctes. La FENÊTRE DE RANGS est structurelle : les
  // espèces du dernier niveau sont plus dures que celles du premier, toujours.
  // Le POIDS des niveaux (nombre × rang) monte en tendance, avec la même
  // respiration niveau à niveau que l'arcade dessinée à la main.
  for (const g of [3, 55, 1234, 999983]) {
    const m = C.genererMap(g);
    const rangs = m.niveaux.map((lv) => {
      let max = 0;
      for (const l of lv.list) for (const c of l) max = Math.max(max, E.ENNEMIS[c.t].rank);
      return max;
    });
    assert.ok(rangs[rangs.length - 1] > rangs[0] + 15,
      `le plafond d'espèces grimpe nettement (${rangs[0]} → ${rangs[rangs.length - 1]}, graine ${g})`);

    const poids = m.niveaux.map((lv) => {
      let s = 0;
      for (const l of lv.list) for (const c of l) s += 1 + E.ENNEMIS[c.t].rank / 10;
      return s;
    });
    const debut = poids.slice(0, 5).reduce((a, x) => a + x, 0) / 5;
    const fin = poids.slice(-5).reduce((a, x) => a + x, 0) / 5;
    assert.ok(fin > debut * 2,
      `les cinq derniers niveaux pèsent plus du double des cinq premiers (${debut.toFixed(1)} → ${fin.toFixed(1)}, graine ${g})`);
  }
});

test('la zone rouge : la fin de map n\'aligne que les espèces les plus dures, à pleine vitesse', () => {
  // Le dernier quart est le MUR qui départage les joueurs : le plafond de rang
  // est au maximum quel que soit le profil du jour, le plancher remonte (au
  // dernier niveau, les huit espèces les plus féroces seulement), et les
  // cadences sortent — c'est le seul endroit du mode qui dépasse le SWF.
  const rankMax = C.typesJouables().slice(-1)[0].rank;
  for (const g of [3, 55, 1234, 999983]) {
    const m = C.genererMap(g);
    const dernier = m.niveaux[m.niveaux.length - 1];
    let minRank = Infinity;
    for (const l of dernier.list) for (const c of l) minRank = Math.min(minRank, E.ENNEMIS[c.t].rank);
    assert.ok(minRank >= rankMax - 8,
      `le dernier niveau n'a plus d'espèce douce (rang min ${minRank} ≥ ${rankMax - 8}, graine ${g})`);
    assert.equal(dernier.moveSpeed, 2, 'la vague est à sa vitesse haute');
    assert.equal(dernier.fallSpeed, 8, 'la descente aussi');
    assert.equal(dernier.sd, 5, 'et les entrées d\'escadre sont resserrées');
    // Avant le mur, la map reste dans les cadences du SWF (fallSpeed 6..7).
    assert.ok(m.niveaux[0].fallSpeed <= 7 && m.niveaux[0].moveSpeed === 1,
      'le début de map garde les vitesses de l\'arcade');
  }
});

test('les profils font varier la difficulté d\'un jour à l\'autre, l\'ordinaire en tête', () => {
  const par = {};
  for (let g = 1; g <= 400; g++) par[C.genererMap(g * 7919).profil] = (par[C.genererMap(g * 7919).profil] || 0) + 1;
  assert.ok(par['ordinaire'] > (par['féroce'] || 0) * 2, 'la map féroce reste un événement');
  assert.ok(Object.keys(par).length >= 3, 'plusieurs humeurs de map existent vraiment');
});

test('une map entière SE JOUE dans le moteur, du niveau 1 à la victoire', () => {
  // Le vrai Game déroule la map ; un pilote abat les escadres. La partie doit
  // traverser les vingt panneaux et finir en « fin » (la victoire de parcours),
  // jamais bloquée — c'est le test qui interdit les niveaux morts.
  for (const graine of [111, 424242]) {
    const m = C.genererMap(graine);
    const vus = [];
    const jeu = new E.Game({ levels: m.niveaux, graine: 99, vies: 4, onEvent: (n, d) => vus.push({ n, d }) });
    let images = 0;
    while (!jeu.termine && images < 200000) {
      jeu.update(1); images++;
      if (jeu.step === E.ETAPE.COMBAT) {
        for (const b of jeu.badsList.slice(0, 3)) b.frapper(999);
      }
    }
    const fin = vus.find((v) => v.n === 'finPartie');
    assert.ok(jeu.termine, `la partie se termine (graine ${graine}, ${images} images)`);
    assert.equal(fin.d.raison, 'fin', 'et c\'est la victoire de parcours, pas un blocage');
    assert.equal(vus.filter((v) => v.n === 'panneau').length, C.NIVEAUX_PAR_JOUR,
      'tous les niveaux ont été traversés');
    assert.ok(!vus.some((v) => v.n === 'panneau' && v.d.boss), 'aucun panneau boss — il reste à l\'arcade');
  }
});

// ── La graine du jour, côté serveur ───────────────────────────────────────

test('le serveur publie la graine du jour, stable sur l\'heure de Paris', async () => {
  const a = await (await fetch(BASE + '/api/miniwave/challenge')).json();
  const b = await (await fetch(BASE + '/api/miniwave/challenge')).json();
  assert.ok(a.ok && b.ok);
  assert.match(a.jour, /^\d{4}-\d{2}-\d{2}$/, 'le jour est une date Paris');
  assert.equal(a.graine, b.graine, 'deux appels du même jour, même graine');
  assert.ok(Number.isInteger(a.graine) && a.graine >= 0 && a.graine <= 0x3FFFFFFF,
    'la graine tient dans l\'espace du générateur');
  // Et elle N'EST PAS celle de Motion-Ball : les deux jeux tirent leur map du
  // même jour, ils ne doivent pas tirer la même valeur.
  const mb2 = require(path.join(ROOT, 'mb2gen.js')).dailyChallengeSeed();
  assert.notEqual(a.graine, mb2, 'l\'espace de graines est distinct de MB2');
});

// ── La fiche : le record du Challenge ─────────────────────────────────────

test('le record du Challenge vit dans $challenge, par jour, sans toucher l\'arcade', () => {
  let c = P.carteNeuve();
  assert.deepEqual(c.$challenge, { $bestScore: 0, $bestLevel: 0, $day: '' },
    'la carte neuve porte le champ');

  c = P.fusionner(c, { mode: 'challenge', jour: '2026-08-11', score: 4200, level: 7,
    credits: 12, badsKill: { 2: 5 }, saucerKill: 1 });
  assert.equal(c.$challenge.$bestScore, 4200);
  assert.equal(c.$challenge.$bestLevel, 8, 'le niveau atteint est l\'index + 1');
  assert.equal(c.$challenge.$day, '2026-08-11');
  assert.equal(c.$arcade.$bestScore, 0, 'l\'arcade n\'a pas bougé');
  assert.equal(c.$cons.$main, 0, 'la consécration arcade non plus');
  assert.equal(c.$credit, 12, 'les crédits ramassés comptent, comme partout');
  assert.equal(c.$saucerKill, 1, 'les soucoupes aussi');
  // Le TABLEAU DE CHASSE, lui, reste celui de l'arcade : la zone rouge de la map
  // du jour n'aligne que les espèces les plus dures, en formations pleines. Les
  // compter ouvrirait en quelques parties des pictos que l'arcade fait gagner
  // en des dizaines d'heures — et pèserait sur le grade avec.
  assert.equal(c.$badsKill[2], 0, 'les éliminations du Challenge ne comptent pas (pictos)');

  // Le lendemain, la map a tourné : le record repart de zéro.
  c = P.fusionner(c, { mode: 'challenge', jour: '2026-08-12', score: 900, level: 2 });
  assert.equal(c.$challenge.$bestScore, 900, 'nouvelle map, nouvelle échelle');
  assert.equal(c.$challenge.$day, '2026-08-12');

  // Et le round-trip de normalisation le préserve.
  const relu = P.normaliser(JSON.parse(JSON.stringify(c)));
  assert.deepEqual(relu.$challenge, c.$challenge, 'normaliser garde le champ');
});

test('une sauvegarde du SWF du bureau ne mange pas le record du Challenge', async () => {
  const sid = await sidPour('mwch' + RUN);
  // Le portage enregistre une fiche riche, record du Challenge compris.
  const riche = P.carteNeuve();
  riche.$credit = 300;
  riche.$challenge = { $bestScore: 15000, $bestLevel: 12, $day: '2026-08-11' };
  await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: JSON.stringify(riche) }),
  });
  // Puis le SWF du bureau sauve par son tuyau (qui ignore tout du Challenge).
  const tuyau = P.versTuyau(riche);
  await fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'miniwave', slotId: '0', data: tuyau }),
  });
  const txt = await (await fetch(`${BASE}/api/loadFrutiSlots?sid=${sid}&game=miniwave`)).text();
  const m = /slot0=([^&]*)/.exec(txt);
  const relu = JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' ')));
  assert.deepEqual(relu.$challenge, { $bestScore: 15000, $bestLevel: 12, $day: '2026-08-11' },
    'la greffe hors-tuyau regreffe $challenge comme les crédits');
  assert.equal(relu.$credit, 300, 'et les crédits, toujours');
});

// ── Le menu et la page ────────────────────────────────────────────────────

test('CHALLENGE occupe la grille 3+2 du jeu, entre SPECIAL et STAND', () => {
  const M = require(path.join(ROOT, 'public/miniwave/menu.js'));
  const SPRITES = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/miniwave/sprites/sprites.json'), 'utf8'));
  const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));
  const appels = [];
  const i = new M.Interface({
    canvas: { width: 240, height: 240, getContext: () => ({}) },
    sprites: SPRITES, poser: () => {},
    plateforme: { carte: P.carteNeuve(), pseudo: 'x' },
    niveaux: NIVEAUX,
    surChallenge: () => appels.push('challenge'),
  });
  i.visible = true;
  i.poserPage('accueil');
  const b = i.boites.filter((x) => x.rubrique !== undefined);
  assert.equal(b.length, 5, 'cinq rubriques — les cinq rangées du jeu');
  assert.deepEqual(b.map((x) => x.texte), ['ARCADE', 'BONUS', 'SPECIAL', 'CHALLENGE', 'STAND']);
  assert.deepEqual(b.map((x) => x.gy), [0, 30, 60, 126, 156],
    'trois en haut, deux calées en bas — la géométrie de page/Main.as');

  // Le clic délègue à la page (la map vient du réseau).
  i.agir({ rubrique: 'challenge' });
  assert.deepEqual(appels, ['challenge'], 'surChallenge est appelé');

  // Sans branchement, la rubrique refuse au lieu de casser.
  const j = new M.Interface({
    canvas: { width: 240, height: 240, getContext: () => ({}) },
    sprites: SPRITES, poser: () => {},
    plateforme: { carte: P.carteNeuve(), pseudo: 'x' }, niveaux: NIVEAUX,
  });
  j.visible = true;
  j.poserPage('accueil');
  j.agir({ rubrique: 'challenge' });
  assert.match(j.message || '', /map du jour/, 'le refus explique');
});

test('la page charge la map du jour et la relie au lancement', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/index.html'), 'utf8');
  assert.match(src, /\/miniwave\/challenge\.js/, 'le générateur est servi à la page');
  assert.match(src, /\/api\/miniwave\/challenge/, 'la graine vient du serveur');
  assert.match(src, /genererMap\(d\.graine\)/, 'et la map en découle');
  assert.match(src, /defiJour\.jour !== d\.jour/, 'minuit régénère (l\'onglet ouvert la nuit)');
  assert.match(src, /mode: 'challenge'/, 'le lancement porte le mode');
  assert.match(src, /jour: l\.jour/, 'et le jour voyage jusqu\'à la fiche');
  // C'est le CHALLENGE qui classe : le score part au classement du jour à la
  // fin d'une partie de Challenge, et d'elle seule — l'arcade, connue par
  // cœur, ne départage personne.
  assert.match(src, /l\.mode === 'challenge'/, 'envoyerScore est réservé au Challenge');
  assert.doesNotMatch(src, /=== 'arcade'\)\s*\{\s*\n?\s*plateforme\.envoyerScore/,
    'l\'arcade ne classe plus');
});
