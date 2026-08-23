/*
 * LA TOUCHE RESTÉE ENFONCÉE — le chat qui part lettre par lettre.
 *
 * Sur Firefox, ouvrir les chatlogs (la commande /logs, tapée puis validée par
 * Entrée) laissait ensuite chaque frappe partir comme un message d'une lettre,
 * jusqu'à ce qu'on actualise la page.
 *
 * La fenêtre qui s'ouvre prend le focus avant qu'Entrée soit relâchée : le
 * `keyup` part chez elle, et Ruffle — qui n'écoute le clavier que sur `window`
 * et seulement quand le lecteur a le focus — garde Entrée pour enfoncée à
 * jamais. Le champ de saisie du chat, qui teste Entrée à chaque frappe, envoie
 * alors la lettre suivante.
 *
 * La première correction envoyait bien un `keyup` de rattrapage, mais APRÈS
 * l'ouverture : à cet instant le popup a le focus, et Ruffle jette tout. D'où
 * ces tests, qui vérifient l'ORDRE autant que le geste.
 *
 * Le module tourne ici dans un bac à sable : un `window` et un `document` de
 * fortune suffisent, il ne demande rien d'autre.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'public/js/clavier-colle.js');

// ── Le bac à sable ─────────────────────────────────────────────────────────
// Node connaît EventTarget et Event ; KeyboardEvent, non. On le gréé avec les
// seuls champs que Ruffle lit (key, code, location) — voir le module.
function bacASable() {
  const journal = [];

  class KeyboardEvent extends Event {
    constructor(type, init) {
      super(type, init);
      init = init || {};
      this.key = init.key;
      this.code = init.code;
      this.location = init.location;
      this.ctrlKey = !!init.ctrlKey;
      this.altKey = !!init.altKey;
      this.shiftKey = !!init.shiftKey;
      this.metaKey = !!init.metaKey;
    }
  }

  const lecteur = { focus: () => { journal.push({ quoi: 'focus-lecteur' }); } };
  const win = new EventTarget();
  win.addEventListener('keyup', (e) => {
    journal.push({ quoi: 'keyup', code: e.code, key: e.key });
  });
  // Le window.open d'origine, celui que le module doit envelopper.
  win.open = (url) => {
    journal.push({ quoi: 'open', url: String(url) });
    return { closed: false, close() {}, focus() {} };
  };

  const bac = {
    window: win,
    document: { querySelector: () => lecteur },
    KeyboardEvent,
    Event,
    Map,
    Array,
    setTimeout,
    journal,
  };
  bac.window.document = bac.document;
  vm.createContext(bac);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), bac, { filename: SOURCE });
  return bac;
}

// Une vraie frappe, telle que le navigateur l'enverrait.
function appuyer(bac, code, key) {
  const e = new bac.KeyboardEvent('keydown', { key: key || code, code });
  bac.window.dispatchEvent(e);
}
function relever(bac, code, key) {
  const e = new bac.KeyboardEvent('keyup', { key: key || code, code });
  bac.window.dispatchEvent(e);
}
const attendreUnTour = () => new Promise((r) => setTimeout(r, 5));

// ── 1. LE BUG SIGNALÉ ──────────────────────────────────────────────────────

test('Entrée tenue au moment d\'ouvrir les chatlogs est relâchée AVANT l\'ouverture', () => {
  const bac = bacASable();

  // « /logs » puis Entrée : la touche est encore enfoncée quand le SWF ouvre.
  appuyer(bac, 'Enter');
  assert.deepEqual(bac.window.fpClavier.enfoncees(), ['Enter'],
    'le module voit bien Entrée enfoncée');

  bac.window.open('/api/chat/histo?sid=x&g=Frutiz', 'fp_histo');

  const iKeyup = bac.journal.findIndex((e) => e.quoi === 'keyup' && e.code === 'Enter');
  const iOpen = bac.journal.findIndex((e) => e.quoi === 'open');
  assert.notEqual(iKeyup, -1, 'un keyup Entrée est bien émis');
  assert.notEqual(iOpen, -1, 'la fenêtre s\'ouvre quand même');
  // LE point de la correction : après l'ouverture, le popup a le focus et
  // Ruffle jetterait le rattrapage. C'est ce qui rendait la 1re version inerte.
  assert.ok(iKeyup < iOpen,
    `le relâchement précède l'ouverture (keyup #${iKeyup}, open #${iOpen})`);
  assert.deepEqual(bac.window.fpClavier.enfoncees(), [],
    'et la touche n\'est plus comptée comme enfoncée');
});

test('window.open enveloppé garde sa signature : arguments transmis, fenêtre rendue', () => {
  const bac = bacASable();
  const fenetre = bac.window.open('/fb/?sid=abc', 'frutiparc_forum', 'width=860');
  assert.ok(fenetre && typeof fenetre.close === 'function',
    'l\'appelant récupère bien la fenêtre (openForumPopup la garde)');
  assert.equal(bac.journal.filter((e) => e.quoi === 'open')[0].url, '/fb/?sid=abc',
    'et l\'adresse passe intacte');
});

// ── 2. NE PAS INVENTER DE FRAPPES ──────────────────────────────────────────

test('aucun relâchement fantôme quand aucune touche n\'est tenue', () => {
  const bac = bacASable();
  bac.window.open('/fb/');
  assert.equal(bac.journal.filter((e) => e.quoi === 'keyup').length, 0,
    'ouvrir sans rien tenir n\'envoie aucun keyup');
});

test('une frappe appuyée puis relâchée normalement ne laisse rien derrière', () => {
  const bac = bacASable();
  appuyer(bac, 'KeyA', 'a');
  relever(bac, 'KeyA', 'a');
  assert.deepEqual(bac.window.fpClavier.enfoncees(), [], 'la touche est oubliée');
  bac.journal.length = 0;           // on ne veut voir que la suite
  bac.window.open('/fb/');
  assert.equal(bac.journal.filter((e) => e.quoi === 'keyup').length, 0,
    'et rien n\'est rejoué à l\'ouverture suivante');
});

test('le keyup de rattrapage ne se recompte pas comme une frappe', () => {
  const bac = bacASable();
  appuyer(bac, 'Enter');
  bac.window.open('/x');            // relâche Entrée…
  bac.window.open('/y');            // …et le second appel n'a plus rien à dire
  assert.equal(bac.journal.filter((e) => e.quoi === 'keyup').length, 1,
    'un seul relâchement, pas une boucle');
});

// ── 3. LE FILET : LES FENÊTRES QU'ON N'OUVRE PAS ───────────────────────────
// Alt-tab, une notification du système, un lien ouvert par le navigateur : la
// fenêtre perd le focus sans passer par window.open.

test('touche tenue pendant une perte de focus : rendue au retour, pas avant', async () => {
  const bac = bacASable();
  appuyer(bac, 'Space', ' ');

  bac.window.dispatchEvent(new bac.Event('blur'));
  assert.equal(bac.journal.filter((e) => e.quoi === 'keyup').length, 0,
    'rien pendant le blur : Ruffle n\'écoute plus, ce serait perdu');

  bac.window.dispatchEvent(new bac.Event('focus'));
  await attendreUnTour();

  const iFocus = bac.journal.findIndex((e) => e.quoi === 'focus-lecteur');
  const iKeyup = bac.journal.findIndex((e) => e.quoi === 'keyup' && e.code === 'Space');
  assert.notEqual(iFocus, -1, 'le lecteur récupère le focus');
  assert.notEqual(iKeyup, -1, 'Espace est relâché au retour');
  assert.ok(iFocus < iKeyup,
    'et le focus revient AVANT le keyup, sinon Ruffle le jetterait aussi');
});

test('un aller-retour de focus sans touche tenue ne réveille rien', async () => {
  const bac = bacASable();
  bac.window.dispatchEvent(new bac.Event('blur'));
  bac.window.dispatchEvent(new bac.Event('focus'));
  await attendreUnTour();
  assert.equal(bac.journal.length, 0, 'ni focus forcé ni keyup');
});

// ── 4. LE BRANCHEMENT DANS LE BUREAU ───────────────────────────────────────

test('ruffle.html charge le module avant Ruffle, et n\'a plus l\'ancienne rustine', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');

  const iModule = html.indexOf('/js/clavier-colle.js');
  const iRuffle = html.indexOf('/ruffle/ruffle.js');
  assert.notEqual(iModule, -1, 'le bureau charge clavier-colle.js');
  assert.ok(iModule < iRuffle,
    'et avant Ruffle : window.open doit être enveloppé avant que quiconque le retienne');

  // L'ancienne version envoyait le rattrapage APRÈS coup, sur des touches
  // devinées à l'avance (Entrée, Espace). Elle n'a jamais rien corrigé.
  assert.equal(/setTimeout\(rendreLeClavier/.test(html), false,
    'plus de rattrapage différé après l\'ouverture');
  assert.equal(/function rendreLeClavier/.test(html), false,
    'plus de liste de touches devinée à la main');

  // Les deux portes d'entrée du SWF ouvrent toujours leur fenêtre.
  assert.match(html, /window\.fp_openHisto = function/, 'fp_openHisto existe toujours');
  assert.match(html, /window\.fp_openPopup = function/, 'fp_openPopup aussi');
});
