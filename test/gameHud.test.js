// Options « tableau de bord » posées en overlay au-dessus des jeux Flash :
//   - Frutisnake : longueur du serpent, dynamites, durée du bonus actif
//   - Swapou     : compteur de coups
//
// Les deux reposent sur le MÊME pont : un ExternalInterface.call injecté dans le
// bytecode AVM1 du SWF, capté par window.fp*() dans game-popup.html.
//
// Le piège que ces tests verrouillent : ExternalInterface est une API Flash
// Player 8. Tant que l'en-tête du SWF annonce la version 7 (leur valeur
// d'origine), Ruffle ne publie pas flash.external.ExternalInterface et l'appel
// injecté ne fait RIEN — sans erreur, sans trace. Vérifié par une sonde
// inconditionnelle posée sur l'image 1 : zéro rappel en version 7, rappel
// immédiat en version 8. Un futur re-patch qui oublierait de relever cet octet
// casserait les deux options en silence : d'où l'assertion ci-dessous.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3427;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000' }),
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

function swfBody(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel));
  const sig = raw.slice(0, 3).toString('ascii');
  return { version: raw[3], body: sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8) };
}
const contient = (buf, s) => buf.includes(Buffer.from(s, 'latin1'));

test('kasparov obtient le tableau de bord Frutisnake, pas les autres joueurs', async () => {
  const sidOk = await sidFor('kasparov');
  const j = await (await fetch(BASE + '/api/features?sid=' + sidOk)).json();
  assert.equal(j.features.snake3Hud, true, 'kasparov → snake3Hud accordé');
  assert.equal(j.features.swapouMoves, true, 'kasparov → compteur Swapou conservé');

  const sidKo = await sidFor('quidamsnake');
  const k = await (await fetch(BASE + '/api/features?sid=' + sidKo)).json();
  assert.equal(k.features.snake3Hud, false, 'autre joueur → snake3Hud refusé');
  assert.equal(k.features.swapouMoves, false, 'autre joueur → compteur Swapou refusé');

  const anon = await (await fetch(BASE + '/api/features')).json();
  assert.equal(anon.features.snake3Hud, false, 'sans session → refusé');
});

test('snake3.swf : pont présent et jouable en version 8 (sinon ExternalInterface est mort)', () => {
  const { version, body } = swfBody('Games/snake3/snake3.swf');
  assert.ok(version >= 8, `version SWF ${version} : ExternalInterface exige Flash 8, l'appel serait ignoré en silence`);
  assert.ok(contient(body, 'fpSnakeHud'), 'nom du rappel JS présent');
  assert.ok(contient(body, 'ExternalInterface'), 'appel ExternalInterface présent');
  // Symboles du jeu intacts : l'injection ne doit rien avoir écrasé.
  for (const s of ['slots', 'giveItem', ']@=%^$', '3}-82]#', '*}^#"#']) {
    assert.ok(contient(body, s), `symbole du jeu conservé : ${JSON.stringify(s)}`);
  }
});

test('swapou.swf : même pont, même exigence de version', () => {
  const { version, body } = swfBody('Games/swapou2/swapou.swf');
  assert.ok(version >= 8, `version SWF ${version} : le compteur de coups serait ignoré en silence`);
  assert.ok(contient(body, 'fpSwapouCoup'), 'nom du rappel JS présent');
  assert.ok(contient(body, 'ExternalInterface'), 'appel ExternalInterface présent');
});

test('overlay Frutisnake : trois informations, transparent aux clics, calé dans la scène', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  const bloc = html.slice(html.indexOf('function setupSnakeHud'), html.indexOf('const wrap = document.getElementById'));
  assert.ok(bloc.length > 100, 'bloc setupSnakeHud présent');

  for (const label of ['LONGUEUR', 'DYNAMITES', 'BONUS']) {
    assert.ok(bloc.includes(`"${label}"`), `information affichée : ${label}`);
  }
  assert.ok(/pointer-events:\s*none/.test(bloc), 'ne peut pas intercepter un clic du joueur');
  assert.ok(bloc.includes('features.snake3Hud'), 'affichage conditionné à l\'option serveur');
  // Posé DANS #player-wrap ⇒ suit la loupe et se fait découper comme le jeu.
  assert.ok(bloc.includes('getElementById("player-wrap")'), 'ancré dans la scène du jeu');
  // Collé en bas à droite, dans le cadre décoratif (jumeau de FRUTIBARRE),
  // donc hors de l'aire de jeu qui s'arrête à y=443 sur une scène de 480.
  assert.ok(/right:\s*0/.test(bloc) && /bottom:\s*10px/.test(bloc), 'aligné sur l\'étiquette FRUTIBARRE');
  // `time` est déjà en secondes (Const.as : « temps en secondes ») : aucune
  // division parasite ne doit se glisser dans la conversion.
  assert.ok(/Math\.ceil\(t\)/.test(bloc), 'durée affichée telle quelle, en secondes');
  assert.ok(!/t\s*\/\s*30/.test(bloc), 'pas de conversion images→secondes erronée');
});
