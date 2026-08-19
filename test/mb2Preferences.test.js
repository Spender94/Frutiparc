/*
 * Motion-Ball 2 : les préférences (musique / bruitages) survivent à la session.
 *
 * Le SWF n'a pas de SharedObject : toute sa mémoire passe par les slots
 * FrutiCard. Client.savePrefs() écrit le slot 1 ({$music,$sounds}) et
 * Client.onServiceConnect() le relit pour régler Prefs — mais le patch
 * scripts/patch-mb2-client.js ne traitait QUE le slot 0 (la carte) : le
 * slot 1 n'était ni émis ni relu, donc chaque session repartait musique
 * allumée. Le joueur devait la recouper tous les jours.
 *
 * Ce fichier vérifie les deux moitiés de la boucle :
 *   · côté serveur, le pipe « $music|$sounds » du SWF devient du JSON stocké,
 *     et /api/loadFrutiSlots le rend tel quel au démarrage suivant ;
 *   · côté SWF, le bytecode patché contient bien les deux branches d'émission
 *     (slot:mb2:0: pour la carte, slot:mb2:1: pour les préférences) et la
 *     relecture du champ « slot1 » — sans quoi le serveur aurait beau garder
 *     la préférence, personne n'irait la chercher.
 *
 * La progression (slot 0) est vérifiée au passage : c'est le même canal, et
 * c'est lui qui porte $courses / $dungeons_done.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3496;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5236', FRUTISCORE_PORT: '5237',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=mb2')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function sidPour(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

const sauver = (sid, slotId, data) =>
  fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sid, game: 'mb2', slotId: String(slotId), data }).toString(),
  });

async function relire(sid) {
  const r = await fetch(BASE + '/api/loadFrutiSlots', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sid, game: 'mb2' }).toString(),
  });
  const p = new URLSearchParams(await r.text());
  const lire = (k) => { const v = p.get(k); return v && v !== 'null' ? JSON.parse(v) : null; };
  return { slot0: lire('slot0'), slot1: lire('slot1') };
}

test('musique coupée : le pipe du SWF devient du JSON et revient à la session suivante', async () => {
  const sid = await sidPour('mb2p' + RUN);

  // Au premier démarrage, le serveur sert les préférences par défaut — c'est
  // ce que Client.onServiceConnect attend pour allumer musique et bruitages.
  const neuf = await relire(sid);
  assert.deepEqual(neuf.slot1, { $music: true, $sounds: true }, 'préférences neuves : tout allumé');

  // Le joueur coupe la musique puis quitte l'écran des options : le SWF émet
  // getURL("slot:mb2:1:false|true") → /api/saveFrutiSlot.
  assert.ok((await sauver(sid, 1, 'false|true')).ok);
  const apres = await relire(sid);
  assert.deepEqual(apres.slot1, { $music: false, $sounds: true },
    'la musique reste coupée, les bruitages restent allumés');

  // Couper aussi les bruitages, puis tout rallumer : rien ne se fige.
  assert.ok((await sauver(sid, 1, 'false|false')).ok);
  assert.deepEqual((await relire(sid)).slot1, { $music: false, $sounds: false });
  assert.ok((await sauver(sid, 1, 'true|true')).ok);
  assert.deepEqual((await relire(sid)).slot1, { $music: true, $sounds: true });
});

test('la progression (slot 0) voyage par le même canal : course et donjon débloqués', async () => {
  const sid = await sidPour('mb2q' + RUN);
  // Le gabarit de Client.saveSlot(0) :
  //   items|challenge|classic|courses|dungeons|dungeons_done|classic_score|dtimes
  assert.ok((await sauver(sid, 0, '|true|true|true,true|true,true,true,true|true|0|')).ok);
  const { slot0 } = await relire(sid);
  assert.deepEqual(slot0.$courses, [true, true], 'la 2ᵉ course reste débloquée');
  assert.deepEqual(slot0.$dungeons_done, [true], 'le 1ᵉʳ monde reste marqué terminé');
});

test('le SWF patché émet ET relit les deux slots', () => {
  let b = fs.readFileSync(path.join(ROOT, 'Games', 'motionBall2', 'motionball.swf'));
  if (b.slice(0, 3).toString('ascii') === 'CWS') {
    b = Buffer.concat([Buffer.from('FWS'), b.slice(3, 8), zlib.inflateSync(b.slice(8))]);
  }
  const contient = (s) => b.includes(Buffer.from(s + '\0', 'latin1'));
  for (const s of ['slot:mb2:0:', 'slot:mb2:1:', 'slot0', 'slot1', '/api/loadFrutiSlots']) {
    assert.ok(contient(s), `le SWF doit porter « ${s} »`);
  }
  // L'ordre du flux : la branche du slot 1 suit celle du slot 0, et les deux
  // champs de préférence se trouvent entre elles.
  const i0 = b.indexOf(Buffer.from('slot:mb2:0:\0', 'latin1'));
  const i1 = b.indexOf(Buffer.from('slot:mb2:1:\0', 'latin1'));
  assert.ok(i1 > i0, 'la branche slot 1 vient après la branche slot 0');
  const entre = b.slice(i0, i1).toString('latin1');
  assert.match(entre, /\$music/, 'le pipe des préférences lit $music');
  assert.match(entre, /\$sounds/, 'le pipe des préférences lit $sounds');
});

test('le patch du SWF est rejouable (le fichier livré est déjà patché)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'patch-mb2-client.js'), 'utf8');
  // L'ancre bytecode remplace les offsets figés : c'est ce qui permet de
  // relancer le script sur un SWF déjà traité, sans copie vierge au dépôt.
  assert.match(src, /DEJA_PATCHE/, 'le script détecte un SWF déjà patché');
  assert.match(src, /ancre/, 'le repérage se fait par ancre bytecode');
  assert.doesNotMatch(src, /const origFuncStart = shift\(/,
    'plus de repérage par offset figé');
});

/*
 * La carte relue au démarrage : le SWF doit être estampillé version 8.
 *
 * La restauration passe par ExternalInterface.call('parseJSON', …), et
 * flash.external.ExternalInterface n'existe QUE pour un SWF de version 8 ou
 * plus. Motion-Ball est un SWF de 2005, estampillé version 7 : « flash » y
 * vaut undefined, l'appel ne part jamais, et Client.onServiceConnect repart
 * sur un « new mb2.Card() » à chaque session — courses reverrouillées,
 * records personnels effacés, modes refermés.
 *
 * Mesuré dans le vrai client avant correction : la réponse du serveur
 * arrivait pourtant complète (onLoad reçoit success = true, this.slot0 porte
 * bien le JSON) et une sonde typeof rendait « flash=undefined ». Après
 * estampillage en 8, parseJSON est appelé pour les deux slots et le menu
 * affiche l'état enregistré (challenge et classique grisés quand la carte
 * dit false, trois courses ouvertes quand elle en annonce trois).
 */
test('le SWF servi est estampillé version 8 (sans quoi ExternalInterface n’existe pas)', () => {
  const b = fs.readFileSync(path.join(ROOT, 'Games', 'motionBall2', 'motionball.swf'));
  assert.ok(['CWS', 'FWS'].includes(b.slice(0, 3).toString('ascii')), 'signature SWF');
  assert.ok(b[3] >= 8,
    `version SWF = ${b[3]} : en dessous de 8, flash.external.ExternalInterface `
    + 'est absent et la carte ne peut pas être relue');

  // Et le script de patch doit garder ce relèvement, sinon un re-patch le perd.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'patch-mb2-client.js'), 'utf8');
  assert.match(src, /SWF_VERSION_EXTERNALINTERFACE\s*=\s*8/,
    'le script de patch relève la version du SWF à 8');
});

test('la relecture des slots ne dépend PAS du drapeau success de onLoad', () => {
  // Le drapeau n'est pas le coupable (mesuré : il vaut bien true sous Ruffle),
  // mais chaque bloc de slot doit rester gardé par « champ défini ? » — c'est
  // lui qui protège d'une vraie panne réseau, pas le drapeau.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'patch-mb2-client.js'), 'utf8');
  assert.match(src, /pushUndef\(\)\), EQUALS2/,
    'chaque slot est restauré seulement si son champ LoadVars est défini');
  assert.match(src, /parseJSON/, 'la restauration passe bien par le pont parseJSON');
});
