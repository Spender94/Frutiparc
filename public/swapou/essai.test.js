// Le mode ESSAI de Swapou 2 : node public/swapou/essai.test.js
//
// Une partie de Challenge à l'identique, illimitée et hors classement : le
// bouton « essai » du menu lance le Challenge SANS réserver de FD
// (/do/fdclaim). Il prend en revanche une graine du serveur, marquée
// « essai » (/api/swapou/partie, essai=1) : depuis que le serveur compte
// lui-même les combos au rejeu, une partie d'essai se vérifie aussi. La fin
// de partie n'envoie AUCUN score au classement (/api/saveScore) et le dit ;
// elle rend son récit à /api/swapou/essai, et la fiche se range sur ce que
// le serveur répond (ses comptes de combos, ses pictos). Un Challenge lancé
// ensuite redevient un Challenge normal.
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
let refus = false;
const corpsEnvoyes = [];
function fetchFactice(url, opts) {
  appels.push(String(url));
  corpsEnvoyes.push({ url: String(url), body: opts && opts.body ? String(opts.body) : '' });
  let corps = JSON.stringify({ ok: true });
  if (/fdclaim/.test(url)) corps = refus ? 'ok=0&remaining=0' : 'ok=1';
  else if (/swapou\/partie/.test(url)) corps = JSON.stringify({ ok: true, id: 'a'.repeat(24), graine: 1234 });
  // Le serveur a vérifié l'essai : il compte 3 confitures de fraise, et
  // n'a donné aucun picto.
  else if (/swapou\/essai/.test(url)) corps = JSON.stringify({ ok: true, essai: true, verifiee: true,
    fiche: { combos: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], pictos: [false, false, false, false, false, false, false, false, false, false, false] } });
  return Promise.resolve({ text: () => Promise.resolve(corps), json: () => Promise.resolve(JSON.parse(/fdclaim/.test(url) ? '{"ok":true}' : corps)) });
}
const sandbox = {
  console, setTimeout, clearTimeout, URLSearchParams, Date, Math, JSON, Promise,
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
  assert(Manager.mode.constructor === SW.Challenge, 'une partie de Challenge est lancée : ' + appels.join(', '));
  assert(SW.Data.gameMode === SW.Data.CHALLENGE && SW.Data.essai === true, 'en mode essai');
  assert(!appels.some((u) => /fdclaim/.test(u)), 'pas de FD réservé : ' + appels.join(', '));
  const demande = corpsEnvoyes.find((c) => /swapou\/partie/.test(c.url));
  assert(demande && /(^|&)essai=1(&|$)/.test(demande.body), 'une graine d’essai est demandée : ' + (demande && demande.body));
  assert(Manager.mode.partie && Manager.mode.partie.id === 'a'.repeat(24), 'la partie joue la graine du serveur');
  assert(!Manager.mode.horsClassement, 'un essai n’est pas annoncé « hors classement »');

  // En cours de partie, le jeu compte ses combos comme en Challenge (le
  // picto s'affiche tout de suite) ; c'est le serveur qui tranchera.
  const fiche = Manager.client.slots[0];
  for (let i = 0; i < 5; i++) SW.TItem.addCombo(2);
  assert(fiche.$items[27 + 2] === true, 'le picto du combo s’affiche en partie');

  // La fin de partie : aucun score envoyé au classement, le récit part à
  // /api/swapou/essai, et l'écran le dit.
  const appelsAvant = appels.length;
  Manager.client.partieFinie = { id: 'a'.repeat(24), graine: 1234, coups: 's1,1,0@10', duree: 5000 };
  const g = Manager.gameOver(12345);
  await attendre();
  assert(!appels.slice(appelsAvant).some((u) => /saveScore/.test(u)), 'aucun score envoyé au classement');
  const rendu = corpsEnvoyes.slice(appelsAvant).find((c) => /swapou\/essai/.test(c.url));
  assert(rendu && /partie=a{24}/.test(rendu.body) && /coups=/.test(rendu.body), 'le récit de l’essai part au serveur : ' + (rendu && rendu.body));
  assert(/essai/i.test(g.text || g.txt || ''), 'l’écran de fin parle d’une partie d’essai : ' + (g.text || g.txt));
  assert(!(fiche.$record >= 12345), 'le record de Challenge n’est pas touché');
  // La fiche se range sur le serveur : ses comptes, ses pictos.
  assert(fiche.$combos[0] === 3 && !fiche.$combos[2], 'les combos sont ceux du serveur : ' + JSON.stringify(fiche.$combos));
  assert(!fiche.$items[27 + 2], 'le picto que le serveur n’a pas donné s’efface de la fiche');

  // Retour au menu : un Challenge relancé redevient normal (FD réservé).
  Manager.startMenu();
  assert(SW.Data.essai === false, 'le mode essai retombe au menu');
  Manager.startChallenge();
  await attendre();
  assert(appels.some((u) => /fdclaim/.test(u)), 'le Challenge réserve son FD');

  // LE REFUS (plus de partie Challenge aujourd'hui) : un panneau, et son
  // bouton « Fermer » ramène à l'écran principal. Le menu, lui, ne redemande
  // pas la réservation à chaque image (le panneau se rouvrait aussitôt fermé).
  const noeuds = {};
  const faux = (id) => ({ id, style: {}, addEventListener() {}, remove() { delete noeuds[this.id]; } });
  sandbox.document = {
    getElementById: (id) => noeuds[id] || null,
    createElement: () => faux(''),
    body: { appendChild: (n) => { noeuds[n.id] = n; noeuds['fd-later'] = faux('fd-later'); } },
  };
  refus = true;
  Manager.startMenu();
  const m2 = Manager.mode;
  m2.end(SW.Data.CHALLENGE);
  pump(200, 2);
  await attendre();
  assert(noeuds['fd-overlay'], 'le refus ouvre le panneau');
  const avant = appels.filter((u) => /fdclaim/.test(u)).length;
  pump(200, 2);
  await attendre();
  pump(200, 2);
  await attendre();
  assert(appels.filter((u) => /fdclaim/.test(u)).length === avant, 'le menu ne redemande pas la partie sous le panneau');
  noeuds['fd-later'].onclick();
  assert(!noeuds['fd-overlay'], '« Fermer » retire le panneau');
  assert(Manager.mode !== m2 && Manager.mode.animPhase === 0, '…et ramène à l’écran principal (un menu neuf)');
  pump(200, 2);
  await attendre();
  assert(!noeuds['fd-overlay'], 'le panneau ne revient pas');
  assert(appels.filter((u) => /fdclaim/.test(u)).length === avant, 'aucune nouvelle demande');
  console.log('essai.test.js — ' + nassert + ' assertions OK');
})().catch((e) => { console.error(e); process.exit(1); });
