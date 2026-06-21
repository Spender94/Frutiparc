'use strict';

// Test e2e de la persistance MiniPixiz : démarre le vrai serveur (mémoire,
// sans DB) et vérifie les correctifs des bugs remontés par les joueurs :
//   - l'horloge $time voyage dans le pipe étendu (jours qui défilent, fée du
//     bassin, fin de la nuit permanente) et ne recule jamais ;
//   - les fées-stubs sont synthétisées au chargement (portrait stable,
//     équipement, stats, goûts) ;
//   - les trous de $help/$god restent null (sinon les aides ne s'affichent
//     plus jamais) ;
//   - plus de potion « +1 force » fantôme (item id 0) issue d'un join Ruffle ;
//   - les préférences du moulin (slot 1) persistent ;
//   - la table des noms d'aliments (pictos) est synchrone avec it/Food.mt.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3424;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProc = null;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + '/api/loadFrutiSlots?game=minipixiz');
      if (r.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
}

before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  await waitForServer();
});

after(() => {
  if (serverProc) serverProc.kill('SIGKILL');
});

// Le serveur limite les inscriptions à 5/heure/IP : on partage 4 comptes
// (les tests s'exécutent séquentiellement ; les états sont compatibles).
const sidCache = {};
async function makeSession(name) {
  if (sidCache[name]) return sidCache[name];
  await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'secret123' }),
  });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'secret123' }),
  });
  const j = await r.json();
  assert.ok(j.sid, 'login → sid');
  sidCache[name] = j.sid;
  return j.sid;
}

async function saveSlot(sid, slotId, data) {
  const body = new URLSearchParams({ sid, game: 'minipixiz', slotId: String(slotId), data });
  const r = await fetch(BASE + '/api/saveFrutiSlot', { method: 'POST', body });
  assert.equal((await r.text()).slice(0, 4), 'ok=1');
}

async function loadSlots(sid) {
  const r = await fetch(BASE + `/api/loadFrutiSlots?sid=${sid}&game=minipixiz`);
  const params = new URLSearchParams(await r.text());
  return {
    slot0: params.get('slot0') ? JSON.parse(params.get('slot0')) : null,
    slot1: params.get('slot1') ? JSON.parse(params.get('slot1')) : null,
  };
}

// pipe 33 champs « SWF patché v2 » — état réaliste de milieu de partie
function buildPipeV2(over) {
  const o = Object.assign({
    item: 'true,,true', eat: '3,0,1', kill: '1,2,3,4,5', run: '4242',
    game: '5,1,2,0,3', forestMax: '900', treeMax: '120', misNum: '2',
    diam: '3', key: '2', star: '7', bag: '4',
    dunLvl: '1', dunF: 'false', rainF: 'false', pondQ: '2',
    frog: 'true', faerie: 'Lumina:3,', vs: '1.2',
    inv: '5,,12', current: '', checkpoint: '2',
    timeT: '1770000000000', timeD: '9', timeS: '3600000',
    pondD: '1', dunDay: '6', dunLoop: '0', rainDay: '2', rainIt: '40',
    wind: '0.42', god: 'false,,true', help: 'true,,true',
  }, over || {});
  const base = [o.item, o.eat, o.kill, o.run, o.game, o.forestMax, o.treeMax, o.misNum,
    o.diam, o.key, o.star, o.bag, o.dunLvl, o.dunF, o.rainF, o.pondQ,
    o.frog, o.faerie, o.vs, o.inv, o.current, o.checkpoint,
    o.timeT, o.timeD, o.timeS, o.pondD, o.dunDay, o.dunLoop, o.rainDay, o.rainIt,
    o.wind, o.god, o.help];
  // Champs 33/34 (extension « missions ») — seulement si fournis, pour que les
  // tests « vieux SWF » gardent leur pipe 33 champs.
  if (o.mis !== undefined || o.mission !== undefined) {
    base.push(o.mis || '', o.mission || '');
  }
  return base.join('|');
}

// Un token de fée RICHE avec $mission/$pos contrôlés (index 10 = mission,
// 11 = pos), comme le sérialise le SWF patché.
function faerieTok(name, mission, pos) {
  const mis = mission == null ? '' : String(mission);
  const ps = pos == null ? '' : String(pos);
  // name:level:humor:exp:hunger:moral:bagMax:shot:life:mana:MISSION:POS
  return `${name}:3:0:0:4:10:2:0:5:2:${mis}:${ps}`;
}

test('pipe étendu : $time/$pond/$dungeon/$rainbow/$wind voyagent et reviennent', async () => {
  const sid = await makeSession('pixishared');
  await saveSlot(sid, 0, buildPipeV2());
  const { slot0 } = await loadSlots(sid);
  assert.deepEqual(slot0.$time, { $t: 1770000000000, $d: 9, $s: 3600000 });
  assert.equal(slot0.$pond.$d, 1);
  assert.equal(slot0.$dungeon.$day, 6);
  assert.equal(slot0.$dungeon.$loop, 0);
  assert.equal(slot0.$rainbow.$day, 2);
  assert.equal(slot0.$rainbow.$it, 40);
  assert.equal(slot0.$wind, 0.42);
  // trous préservés : le jeu teste $help[id] != null
  assert.deepEqual(slot0.$help, [true, null, true]);
  assert.deepEqual(slot0.$god, [false, null, true]);
});

test('le compteur de jours ne recule jamais (pipe glitché)', async () => {
  const sid = await makeSession('pixidays');
  await saveSlot(sid, 0, buildPipeV2({ timeD: '9' }));
  await saveSlot(sid, 0, buildPipeV2({ timeD: '1', timeT: '1770000005000', timeS: '12' }));
  const { slot0 } = await loadSlots(sid);
  assert.equal(slot0.$time.$d, 9, 'prev $d=9 conservé contre un $d=1 régressif');
});

test('vieux SWF (pipe 22 champs) : $time acquis conservé par le forward-merge', async () => {
  const sid = await makeSession('pixioldswf');
  await saveSlot(sid, 0, buildPipeV2({ timeD: '5' }));
  // vieux pipe : 22 champs seulement (s'arrête à checkpoint)
  const old = buildPipeV2().split('|').slice(0, 22).join('|');
  await saveSlot(sid, 0, old);
  const { slot0 } = await loadSlots(sid);
  assert.equal(slot0.$time.$d, 5, '$time de la session précédente conservé');
});

test('missions : $mis (actives) + $mission (du jour) voyagent et reviennent', async () => {
  const sid = await makeSession('piximis');
  // Une fée partie sur la mission active 0 ; $string accentué + virgule, escapé
  // par le SWF (escape()) → doit revenir exact côté serveur (unescape).
  const story = 'réussi à rapporter une clé, bravo !';
  const mis = `5~83~2~${escape(story)}`;          // $d=5, $gift=83, $type=2
  const mission = '0~2~3~83~4567,1~0~5~71~1234';  // 2 missions du jour
  await saveSlot(sid, 0, buildPipeV2({ faerie: faerieTok('Aria', 0, null) + ',', mis, mission }));
  const { slot0 } = await loadSlots(sid);
  assert.equal(slot0.$faerie[0].$mission, 0, 'fée toujours en mission 0');
  assert.ok(Array.isArray(slot0.$mis) && slot0.$mis.length === 1, '$mis persisté');
  assert.equal(slot0.$mis[0].$d, 5, 'jours restants conservés (plus de undefined)');
  assert.equal(slot0.$mis[0].$gift, 83);
  assert.equal(slot0.$mis[0].$type, 2);
  assert.equal(slot0.$mis[0].$string, story, '$string exact (accents + virgule)');
  assert.equal(slot0.$mission.length, 2, 'liste de Gromelin persistée');
  assert.deepEqual(slot0.$mission[0], [0, 2, 3, 83, 4567]);
});

test('missions : mission ratée ($gift null) round-trip', async () => {
  const sid = await makeSession('pximisb');
  const mis = `2~~4~${escape('a échoué...')}`;   // $gift vide → null
  await saveSlot(sid, 0, buildPipeV2({ faerie: faerieTok('Bea', 0, null) + ',', mis, mission: '' }));
  const { slot0 } = await loadSlots(sid);
  assert.equal(slot0.$mis[0].$gift, null, 'cadeau null préservé');
  assert.equal(slot0.$mis[0].$d, 2);
});

test('missions : fée « fantôme » réconciliée (index $mis inexistant → libérée)', async () => {
  const sid = await makeSession('pximisc');
  // fée en mission 0 mais AUCUNE mission active ($mis vide) — l'état hérité des
  // saves d'avant le fix. Le serveur doit la libérer ($mission=null) au lieu de
  // la laisser bloquée « en mission » (M jaune + undefined jours).
  await saveSlot(sid, 0, buildPipeV2({ faerie: faerieTok('Cleo', 0, null) + ',', mis: '', mission: '' }));
  const { slot0 } = await loadSlots(sid);
  assert.equal(slot0.$faerie[0].$mission, null, 'fée fantôme libérée');
});

test('fée-stub : synthèse complète et déterministe au chargement', async () => {
  const sid = await makeSession('pixishared');
  await saveSlot(sid, 0, buildPipeV2({ faerie: 'Lumina:3,' }));
  const a = (await loadSlots(sid)).slot0.$faerie[0];
  assert.equal(a.$name, 'Lumina');
  assert.equal(a.$level, 3);
  assert.equal(a.$skin.length, 4, 'portrait : corps + 3 couleurs');
  assert.deepEqual(a.$carac, [1, 1, 1, 1, 1, 1], 'stats de base');
  assert.deepEqual(a.$inv, [], "cases d'équipement présentes");
  assert.equal(a.$taste.length, 2, 'goûts/dégoûts');
  assert.ok(a.$life >= 1);
  const b = (await loadSlots(sid)).slot0.$faerie[0];
  assert.deepEqual(b.$skin, a.$skin, 'même skin à chaque chargement');
});

test('plus de potion « +1 force » fantôme : tokens non numériques du sac → null', async () => {
  const sid = await makeSession('pixishared');
  await saveSlot(sid, 0, buildPipeV2({ inv: '5,undefined,,null,12' }));
  const { slot0 } = await loadSlots(sid);
  assert.deepEqual(slot0.$inv, [5, null, null, null, 12]);
  assert.ok(!slot0.$inv.includes(0), 'aucun item id 0 (la potion +1 force) inventé');
});

test('$t dans le futur : clampé au chargement (anti-nuit-bloquée)', async () => {
  const sid = await makeSession('pixishared');
  const future = Date.now() + 5 * 86400000;
  await saveSlot(sid, 0, buildPipeV2({ timeT: String(future) }));
  const { slot0 } = await loadSlots(sid);
  assert.ok(slot0.$time.$t <= Date.now() + 60000, '$t ≤ maintenant (+60 s de marge)');
});

test('préférences du moulin (slot 1) : mini-pipe → JSON → relecture', async () => {
  const sid = await makeSession('pixipref');
  await saveSlot(sid, 0, buildPipeV2()); // une carte existe
  await saveSlot(sid, 1, 'false|1,1|37,39,32,40,38');
  const { slot1 } = await loadSlots(sid);
  assert.deepEqual(slot1, { $mouse: false, $sound: [1, 1], $key: [37, 39, 32, 40, 38] });
  // pref invalide (sans touches) : acquittée mais NON stockée
  await saveSlot(sid, 1, 'true||');
  const after2 = await loadSlots(sid);
  assert.deepEqual(after2.slot1.$key, [37, 39, 32, 40, 38], 'prefs précédentes intactes');
});

test('table des aliments (pictos) synchrone avec it/Food.mt', () => {
  const foodMt = fs.readFileSync(path.join(__dirname, '..', 'Games', 'miniTroll', 'src', 'it', 'Food.mt'), 'latin1');
  const gameNames = [];
  for (const m of foodMt.matchAll(/name:"([^"]+)"/g)) gameNames.push(m[1].trim());
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const block = serverSrc.match(/PIXIZ_FOOD_BASE_NAMES = \[([\s\S]*?)\];/)[1];
  const serverNames = [];
  for (const m of block.matchAll(/'([^']+)'/g)) serverNames.push(m[1]);
  assert.equal(gameNames.length, 19, 'Food.mt : 19 aliments');
  assert.equal(serverNames.length, 19, 'serveur : 19 noms');
  const fold = (s) => s.normalize('NFD').replace(/[^a-zA-Z ]/g, '').toLowerCase().trim();
  for (let i = 0; i < 19; i++) {
    assert.equal(fold(serverNames[i]), fold(gameNames[i]),
      `aliment ${i} : « ${serverNames[i]} » doit suivre l'ordre du jeu (« ${gameNames[i]} »)`);
  }
});
