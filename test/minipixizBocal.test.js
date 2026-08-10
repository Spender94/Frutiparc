/*
 * Le BOCAL et la fiche des fées — ce que le serveur a le droit de réécrire.
 *
 * Retour de terrain : « j'ai placé ma fée dans son bocal, je suis allé chercher
 * une nouvelle fée au bassin. De retour à la clairière, pas de fée présente, et
 * dans mon sac c'est mon ANCIENNE fée. Je lance une partie : c'est bel et bien
 * ma fée niveau 10 qui est avec moi. Je quitte, et une ancienne fée niveau 12
 * est apparue — toujours pas de trace de la nouvelle. »
 *
 * Trois écritures du serveur en cause, toutes ajoutées comme filets de sécurité
 * et devenues plus dangereuses que ce qu'elles protégeaient :
 *
 *   1. `$pos` (la case du bocal qui abrite la fée) était REMIS À NULL à chaque
 *      chargement. La fée sortait de son bocal toute seule. C'est pourtant un
 *      champ de FaerieSeed — « null = en main , 0-16 = index de l'inventaire »
 *      — que le SWF transporte lui aussi dans son pipe.
 *
 *   2. `mergeFaerieByIdentity` ne laissait JAMAIS tomber une fée : celle qui
 *      part (partie dans la nuit, renvoyée au pays des fées, dévorée par une
 *      sœur affamée) revenait à la sauvegarde suivante. D'où la niveau 12.
 *
 *   3. Le dé-doublonnage par nom retirait des entrées SANS recaler `$current`,
 *      qui est un INDEX : la main du joueur désignait alors une autre fée, ou
 *      le vide — « pas de fée présente ».
 *
 * Le jeu d'origine, lui, tient une règle simple (Cm.mt, inv/Slot.mt,
 * FaerieInfo.erase) : `$current` désigne la fée en main, `$pos` celle qui dort
 * en bocal, jamais les deux à la fois, et une fée effacée est effacée.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3466;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.TEST_DATABASE_URL_BOCAL
  || 'postgres://postgres@127.0.0.1:5433/frutiparc_bocal';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const M = require('../minipixizFaerie.js');

let proc = null, dispo = false, sid = '';

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

function lancerServeur() {
  return spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5212', FRUTISCORE_PORT: '5213',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function attendreServeur() {
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return true;
    } catch {}
    await wait(250);
  }
  return false;
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = lancerServeur();
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  if (!(await attendreServeur())) throw new Error('serveur indisponible');
  const body = JSON.stringify({ username: 'feetestv', password: 'secret123' });
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  sid = (await r.json()).sid;
});
after(() => { if (proc) proc.kill('SIGKILL'); });

// Une fée COMPLÈTE, comme le client light en écrit — pas un moignon de pipe.
function fee(nom, niveau, extra) {
  return Object.assign({
    $name: nom, $level: niveau, $humor: 0, $exp: 0, $hunger: 50, $moral: 20,
    $bagMax: 2, $shot: 0, $life: 3, $mana: 3, $mission: null, $pos: null,
    $carac: [1, 1, 1, 1, 1, 1], $skin: [0, 0, 0, 0], $next: [0, 0], $inv: [],
    $spell: [], $spellCoef: [], $mood: [], $behaviour: [], $taste: [[], []],
  }, extra || {});
}

const carteAvec = (faerie, current, inv) => ({
  $time: { $t: Date.now(), $d: 0, $s: 21600000 },
  $current: current, $vs: 1.2, $bag: 1, $wind: 0, $help: [true, true, true],
  $inv: inv || [], $faerie: faerie, $mis: [], $mission: [], $god: [false, false, false],
  $diam: 0, $key: 0, $star: 0, $frog: false, $checkpoint: 0,
  $dungeon: { $lvl: 0, $f: false, $loop: 0, $day: 0 },
  $rainbow: { $f: false, $day: 0, $it: 0 },
  $pond: { $q: 0, $d: 0, $fs: null },
  $stat: {
    $item: [], $eat: [], $kill: [0, 0, 0, 0, 0], $run: 5, $game: [0, 0, 0, 0, 0],
    $forestMax: 0, $treeMax: 0, $misNum: 0,
  },
});

const ecrire = (carte) => fetch(BASE + '/api/saveFrutiSlot', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sid, game: 'minipixiz', slotId: '0', data: JSON.stringify(carte) }),
});

async function relire() {
  const r = await fetch(`${BASE}/api/loadFrutiSlots?sid=${sid}&game=minipixiz`, { cache: 'no-store' });
  const txt = await r.text();
  const m = /(?:^|&)slot0=([^&]*)/.exec(txt);
  assert.ok(m, 'le slot 0 revient');
  return JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' ')));
}

test('la fée rangée dans son bocal y reste', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Le bocal résidentiel (objet 30) occupe la case 0 du sac ; Ancienne y dort,
  // donc personne n'est en main — inv/Slot.mt : entrer en bocal retire la main.
  await ecrire(carteAvec([fee('Ancienne', 9, { $pos: 0 })], null, [30]));
  const c = await relire();
  assert.equal(c.$faerie.length, 1);
  assert.equal(c.$faerie[0].$name, 'Ancienne');
  assert.equal(c.$faerie[0].$pos, 0, 'elle est toujours dans le bocal de la case 0');
  assert.equal(c.$current, null, 'et le joueur a toujours les mains vides');
});

test('la fée qui part ne revient pas d\'entre les mortes', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Deux fées : une en bocal, une en main.
  await ecrire(carteAvec([fee('Ancienne', 9, { $pos: 0 }), fee('Vieille', 11)], 1, [30]));
  let c = await relire();
  assert.equal(c.$faerie.length, 2);

  // Vieille s'en va (FaerieInfo.erase : moral à zéro dans la nuit). Le client
  // écrit la fiche SANS elle, et remet les mains vides.
  await ecrire(carteAvec([fee('Ancienne', 9, { $pos: 0 })], null, [30]));
  c = await relire();
  assert.equal(c.$faerie.length, 1, 'la fiche ne garde qu\'une fée');
  assert.equal(c.$faerie[0].$name, 'Ancienne');
  assert.ok(!c.$faerie.some((f) => f.$name === 'Vieille'),
    'Vieille est partie pour de bon');
});

test('la nouvelle fée du bassin est bien celle qu\'on emmène', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Le scénario du joueur, bout en bout : Ancienne en bocal, Vieille partie
  // dans la nuit, puis le bassin rend une Nouvelle — base/Fountain.freeFaerie
  // fait `$current = $faerie.length` PUIS `push`, donc elle est en main.
  await ecrire(carteAvec([fee('Ancienne', 9, { $pos: 0 }), fee('Vieille', 11)], null, [30]));
  await ecrire(carteAvec(
    [fee('Ancienne', 9, { $pos: 0 }), fee('Nouvelle', 0)], 1, [30]));
  const c = await relire();
  assert.equal(c.$faerie.length, 2, 'deux fées : celle du bocal et la nouvelle');
  const enMain = c.$faerie[c.$current];
  assert.ok(enMain, 'la main désigne bien une fée');
  assert.equal(enMain.$name, 'Nouvelle', 'et c\'est la nouvelle');
  assert.equal(enMain.$level, 0, 'niveau 1');
  const bocal = c.$faerie.find((f) => f.$name === 'Ancienne');
  assert.equal(bocal.$pos, 0, 'l\'ancienne dort toujours dans son bocal');
});

test('une fiche qui perd ses fées par accident est encore protégée', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await ecrire(carteAvec([fee('Gardee', 5), fee('Aussi', 3)], 0, []));
  // Une sauvegarde de MOIGNONS ({$name,$level} seuls) est le format appauvri du
  // SWF : elle ne dit pas qui est parti, elle dit seulement ce qu'elle sait.
  // Le serveur doit alors continuer de recoller l'état riche du précédent.
  const moignons = carteAvec([{ $name: 'Gardee', $level: 6 }], 0, []);
  await ecrire(moignons);
  const c = await relire();
  assert.equal(c.$faerie.length, 2, 'la sauvegarde appauvrie ne fait perdre personne');
  const g = c.$faerie.find((f) => f.$name === 'Gardee');
  assert.equal(g.$level, 6, 'le niveau du moignon gagne');
  assert.ok(Array.isArray(g.$carac), 'et l\'état riche est recollé');
});

test('la main du joueur suit sa fée quand le serveur retaille la liste', () => {
  // Le dé-doublonnage par nom retire des entrées ; `$current` est un INDEX.
  // Sans recalage, la main désigne une autre fée — ou le vide.
  const c = {
    $faerie: [{ $name: 'A', $level: 1 }, { $name: 'A', $level: 1 }, { $name: 'B', $level: 2 }],
    $current: 2,
  };
  const r = M.recalerCurrent(c, M.dedoublonnerFees(c.$faerie));
  assert.equal(r.$faerie.length, 2);
  assert.equal(r.$faerie[r.$current].$name, 'B', 'la main suit B, pas son ancien index');
});

test('une fée ne peut pas être à la fois en bocal et en main', () => {
  // inv/Slot.mt : entrer en bocal RETIRE la main. Les deux états sont exclusifs,
  // et c'est cette exclusion — pas l'effacement de $pos — qui empêche la fée
  // d'apparaître deux fois.
  const c = { $faerie: [fee('Double', 3, { $pos: 0 })], $current: 0, $inv: [30] };
  M.reglerBocaux(c);
  assert.equal(c.$faerie[0].$pos, 0, 'elle reste dans son bocal');
  assert.equal(c.$current, null, 'et le joueur a les mains vides');

  // Deux fées ne tiennent pas dans le même bocal : la seconde en sort.
  const d = { $faerie: [fee('Une', 1, { $pos: 0 }), fee('Deux', 2, { $pos: 0 })],
    $current: null, $inv: [30] };
  M.reglerBocaux(d);
  assert.equal(d.$faerie[0].$pos, 0);
  assert.equal(d.$faerie[1].$pos, null, 'la seconde est libre');

  // Un bocal qui n'existe pas ne retient personne.
  const e = { $faerie: [fee('Perdue', 1, { $pos: 4 })], $current: null, $inv: [30] };
  M.reglerBocaux(e);
  assert.equal(e.$faerie[0].$pos, null, 'la case 4 ne porte pas de bocal');
});

test('la dernière fée peut partir, mais pas par accident', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await ecrire(carteAvec([fee('Seule', 2)], 0, []));
  assert.equal((await relire()).$faerie.length, 1);

  // Le portage écrit la carte ENTIÈRE : une liste vide veut dire que la
  // dernière fée s'en est allée, et le filet ne doit plus la retenir.
  await ecrire(carteAvec([], null, []));
  const c = await relire();
  assert.equal(c.$faerie.length, 0, 'la fiche est bien sans fée');
  assert.equal(c.$current, null, 'et sans main');

  // Le pipe du SWF, lui, reste sous surveillance : un champ « fées » perdu
  // n'est pas une fée partie. (Le pipe ne repasse pas par ecrire() : on vérifie
  // ici la règle qui l'en distingue.)
  assert.equal(M.listeAutoritaire([{ $name: 'X', $level: 1 }]), false,
    'des moignons ne font pas foi');
  assert.equal(M.listeAutoritaire([fee('X', 1)]), true,
    'une fée complète, si');
  assert.equal(M.listeAutoritaire([]), false,
    'et une liste vide ne dit rien par elle-même');
});

test('la fée libérée du bassin n\'y retourne pas : la lueur reste éteinte', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // base/Fountain.freeFaerie : la bulle cède, $pond.$fs part dans $faerie et
  // la lueur s'éteint ($fs nul, $q zéro). Le filet « prev.$q > merged.$q »
  // du forward-merge ne doit PAS rallumer le bassin — sinon le joueur
  // « replonge le même jour » et retrouve la même fée au fond.
  const dansLeBassin = fee('Nixe', 0, { $carac: [2, 1, 3, 1, 1, 2] });
  const avant = carteAvec([], null, []);
  avant.$pond = { $q: 3, $d: 0, $fs: dansLeBassin };
  await ecrire(avant);
  let c = await relire();
  assert.equal(c.$pond.$q, 3, 'la lueur brille');
  assert.equal(c.$pond.$fs.$name, 'Nixe');

  // La bulle cède : le client écrit la fiche à l'instant même.
  const apres = carteAvec([fee('Nixe', 0, { $carac: [2, 1, 3, 1, 1, 2] })], 0, []);
  apres.$pond = { $q: 0, $d: 0, $fs: null };
  await ecrire(apres);
  c = await relire();
  assert.equal(c.$pond.$fs, null, 'le bassin est vide');
  assert.equal(Number(c.$pond.$q) || 0, 0, 'et la lueur éteinte');
  assert.equal(c.$faerie.length, 1, 'Nixe est sortie de l\'eau');
  assert.equal(c.$faerie[c.$current].$name, 'Nixe', 'et accompagne le joueur');
});

test('une fée qu\'on ne nourrit plus s\'en va d\'elle-même, et ne revient pas', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // C'est le ménage que le jeu d'origine fait tout seul (FaerieInfo.upkeep) :
  // la faim descend de quatre par nuit, le moral suit, et sous trois « elle
  // s'est enfuie pendant la nuit » — erase(), la fiche l'oublie. Encore
  // fallait-il que la sauvegarde suivante ne la ressuscite pas.
  const N = require('../public/minipixiz/nuit.js');

  const gardee = fee('Gardee', 4, { $hunger: 60, $moral: 10 });
  const lasse = fee('Lasse', 8, { $hunger: 0, $moral: 3 });
  const carte = carteAvec([gardee, lasse], 0, []);
  await ecrire(carte);
  assert.equal((await relire()).$faerie.length, 2);

  // Quelques nuits passent, personne ne nourrit Lasse.
  let garde = 0;
  while (carte.$faerie.some((f) => f.$name === 'Lasse') && garde++ < 10) {
    carte.$time.$t -= 86400000;
    N.passerLeTemps(carte, Date.now());
  }
  assert.ok(!carte.$faerie.some((f) => f.$name === 'Lasse'),
    'Lasse a fini par partir (en ' + garde + ' nuit(s))');

  await ecrire(carte);
  const c = await relire();
  assert.ok(!c.$faerie.some((f) => f.$name === 'Lasse'),
    'et le serveur ne la rappelle pas');
  assert.ok(c.$faerie.some((f) => f.$name === 'Gardee'),
    'tandis que celle qu\'on garde reste');
});

// ── Les homonymes du bassin (le retour de 3l_professor) ───────────────────
//
// « Le bogue s'est produit lorsque j'ai déplacé le bocal avec ma fée niveau 11
// dedans, ça l'a supprimée ! » Le bassin tire les noms dans un pool fini
// (~970 combinaisons de syllabes) : deux fées distinctes finissent par être
// homonymes. Le dé-doublonnage « par nom » d'alors en supprimait une à la
// PREMIÈRE écriture venue — déplacer le bocal, plonger au bassin… L'identité
// d'une fée est désormais son nom PLUS sa peau ($skin, posée à la naissance,
// jamais changée) : les homonymes vivent, les vrais clones tombent toujours.

test('deux fées homonymes sont deux fées — l\'identité est nom + peau', () => {
  const A = { $skin: [1, 111, 222, 333] };
  const B = { $skin: [2, 444, 555, 666] };
  const paire = [fee('Lumilie', 11, A), fee('Lumilie', 12, B)];
  assert.equal(M.dedoublonnerFees(paire).length, 2, 'aucune des deux ne disparaît');
  // Même nom, même peau : la même fée deux fois (le clone d'un vieux bug de
  // fusion) — le doublon tombe, comme avant.
  const clone = [fee('Lumilie', 11, A), fee('Lumilie', 11, A)];
  assert.equal(M.dedoublonnerFees(clone).length, 1, 'le vrai doublon tombe');
  // Moignons sans peau : la peau synthétique se calcule du nom, elles sont
  // indistinguables — doublon aussi (stable d'un chargement à l'autre).
  assert.equal(M.dedoublonnerFees(
    [{ $name: 'Stub', $level: 1 }, { $name: 'Stub', $level: 3 }]).length, 1);
});

test('le merge apparie chaque homonyme à la SIENNE (par la peau)', () => {
  const A = { $skin: [1, 111, 222, 333] };
  const B = { $skin: [2, 444, 555, 666] };
  const prev = [
    Object.assign(fee('Jumelle', 11, A), { $exp: 110 }),
    Object.assign(fee('Jumelle', 12, B), { $exp: 220 }),
  ];
  // La sauvegarde revient dans l'AUTRE ordre, sans $exp : l'état riche stocké
  // doit suivre la peau, pas la position ni la première du nom.
  const sansExp = (f) => { const c = Object.assign({}, f); delete c.$exp; return c; };
  const next = [sansExp(fee('Jumelle', 12, B)), sansExp(fee('Jumelle', 11, A))];
  const out = M.mergeFaerieByIdentity(prev, next, { autoritaire: true });
  assert.equal(out.length, 2);
  assert.equal(out[0].$exp, 220, 'la 12 retrouve SON expérience');
  assert.equal(out[1].$exp, 110, 'et la 11 la sienne');
});

test('la séquence de 3l_professor, sans perte : bocal déplacé, second bocal, bassin', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const peau11 = [1, 111, 222, 333];
  const peau12 = [2, 444, 555, 666];
  // Deux homonymes : la 11 dort dans le bocal de la case 0, la 12 est en main.
  await ecrire(carteAvec(
    [fee('Vaillante', 11, { $skin: peau11, $pos: 0 }), fee('Vaillante', 12, { $skin: peau12 })],
    1, [30]));
  let c = await relire();
  assert.equal(c.$faerie.length, 2, 'les deux homonymes sont là');

  // « J'ai déplacé le bocal avec ma fée niveau 11 dedans » : case 0 → case 2.
  // La locataire suit son bocal (It.deplacer) — et personne ne disparaît.
  await ecrire(carteAvec(
    [fee('Vaillante', 11, { $skin: peau11, $pos: 2 }), fee('Vaillante', 12, { $skin: peau12 })],
    1, [null, null, 30]));
  c = await relire();
  assert.equal(c.$faerie.length, 2, 'déplacer le bocal ne supprime personne');
  const onze = c.$faerie.find((f) => f.$level === 11);
  assert.ok(onze, 'la 11 est toujours là');
  assert.equal(onze.$pos, 2, 'dans son bocal, case 2');
  assert.equal(c.$faerie[c.$current].$level, 12, 'et la main tient toujours la 12');

  // « Je l'ai mise en bocal celle-là » : un second bocal, la 12 y dort.
  await ecrire(carteAvec(
    [fee('Vaillante', 11, { $skin: peau11, $pos: 2 }),
      fee('Vaillante', 12, { $skin: peau12, $pos: 0 })],
    null, [30, null, 30]));
  c = await relire();
  assert.equal(c.$faerie.length, 2, 'la mise en bocal non plus');

  // « Je suis allé dans le bassin chercher une nouvelle fée » — et le bassin
  // TIRE LE MÊME NOM : c'était le déclencheur du drame. Trois homonymes.
  await ecrire(carteAvec(
    [fee('Vaillante', 11, { $skin: peau11, $pos: 2 }),
      fee('Vaillante', 12, { $skin: peau12, $pos: 0 }),
      fee('Vaillante', 0, { $skin: [3, 777, 888, 999] })],
    2, [30, null, 30]));
  c = await relire();
  assert.equal(c.$faerie.length, 3, 'les trois Vaillante vivent leur vie');
  assert.equal(c.$faerie[c.$current].$level, 0, 'la nouvelle est en main');
  assert.equal(c.$faerie.find((f) => f.$level === 11).$pos, 2, 'la 11 dort toujours');
  assert.equal(c.$faerie.find((f) => f.$level === 12).$pos, 0, 'la 12 aussi');
});

test('le vrai clone (même nom, même peau) tombe toujours au chargement', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await ecrire(carteAvec(
    [fee('Clonee', 12, { $skin: [4, 10, 20, 30] }), fee('Clonee', 12, { $skin: [4, 10, 20, 30] })],
    null, []));
  const c = await relire();
  assert.equal(c.$faerie.filter((f) => f.$name === 'Clonee').length, 1,
    'le clone strict est tombé — le correctif des fantômes tient');
});
