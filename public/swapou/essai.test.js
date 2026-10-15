// Le mode ESSAI de Swapou 2 : node public/swapou/essai.test.js
//
// Une partie de Challenge à l'identique, illimitée et hors classement : le
// bouton « essai » du menu lance le Challenge SANS réserver de FD
// (/do/fdclaim) ni de graine (/api/swapou/partie) ; la fin de partie
// n'envoie AUCUN score (/api/saveScore) et le dit ; les pictos de combo,
// eux, se gagnent comme en Challenge (ils vont dans la fiche, slot 0). Un
// Challenge lancé ensuite redevient un Challenge normal.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let nassert = 0;
function assert(cond, msg) {
  nassert++;
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
}

// Les appels réseau du jeu, relevés (et servis à blanc).
const appels = [];
function fetchFactice(url) {
  appels.push(String(url));
  const corps = /fdclaim/.test(url) ? 'ok=1' : JSON.stringify({ ok: true });
  return Promise.resolve({ text: () => Promise.resolve(corps), json: () => Promise.resolve(JSON.parse(/fdclaim/.test(url) ? '{"ok":true}' : corps)) });
}
const sandbox = {
  console, setTimeout, URLSearchParams, Date, Math, JSON, Promise,
  performance: { now: () => Date.now() },
  fetch: fetchFactice,
  navigator: { sendBeacon: (u) => { appels.push(String(u)); return true; } },
  Blob: function () {},
};
sandbox.self = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
});
const SW = sandbox.SW;
const Manager = SW.Manager;
const pump = (n, tmod) => { tmod = tmod || 1; for (let i = 0; i < n; i++) Manager.main(tmod, tmod / 40); };
const cliquer = (bt) => { SW.handleMouseMove(bt.curX, bt.curY); Manager.mode.onClickDown(); };
const attendre = () => new Promise((r) => setTimeout(r, 20));

(async function () {
  Manager.init('');
  // Une session : sans elle, le jeu ne parle jamais au serveur (standalone).
  Manager.client.standalone = false;
  Manager.client.sid = 'sid-test';
  pump(5);
  SW.handleMouseMove(350, 240);
  Manager.mode.onClickDown();
  pump(200, 2);
  const menu = Manager.mode;
  cliquer(menu.btList[0]);                       // jouer
  pump(120, 2);
  assert(menu.phase === 20, 'menu des modes');
  const btEssai = menu.btList[1];
  assert(/essai/.test(btEssai.label || btEssai.text || ''), 'le second bouton est « essai »');
  cliquer(btEssai);
  pump(120, 2);
  assert(menu.phase === 70, 'choix du personnage pour l’essai');
  const face0 = menu.btList.find((b) => b.faceId === 0);
  cliquer(face0);
  pump(400, 2);
  await attendre();
  assert(Manager.mode.constructor === SW.Challenge, 'une partie de Challenge est lancée');
  assert(SW.Data.gameMode === SW.Data.CHALLENGE && SW.Data.essai === true, 'en mode essai');
  assert(!appels.some((u) => /fdclaim|swapou\/partie/.test(u)), 'ni FD réservé, ni graine demandée : ' + appels.join(', '));

  // Les pictos de combo se gagnent comme en Challenge.
  const fiche = Manager.client.slots[0];
  for (let i = 0; i < 5; i++) SW.TItem.addCombo(2);
  assert(fiche.$items[27 + 2] === true, 'le picto du combo est gagné en essai');

  // La fin de partie : aucun score envoyé, et l'écran le dit.
  const appelsAvant = appels.length;
  const g = Manager.gameOver(12345);
  await attendre();
  assert(!appels.slice(appelsAvant).some((u) => /saveScore/.test(u)), 'aucun score envoyé au classement');
  assert(/essai/i.test(g.text || g.txt || ''), 'l’écran de fin parle d’une partie d’essai : ' + (g.text || g.txt));
  assert(!(fiche.$record >= 12345), 'le record de Challenge n’est pas touché');

  // Retour au menu : un Challenge relancé redevient normal (FD réservé).
  Manager.startMenu();
  assert(SW.Data.essai === false, 'le mode essai retombe au menu');
  Manager.startChallenge();
  await attendre();
  assert(appels.some((u) => /fdclaim/.test(u)), 'le Challenge réserve son FD');
  console.log('essai.test.js — ' + nassert + ' assertions OK');
})().catch((e) => { console.error(e); process.exit(1); });
