/*
 * KALUGA — LA PAUSE AUTOMATIQUE QUAND LA FENÊTRE N'EST PLUS AU-DESSUS.
 *
 * « Pause automatique des jeux quand la fenêtre n'est pas au dessus. » Le jeu
 * tourne dans un cadre du light ou du bureau, ou dans sa propre fenêtre :
 * quand le joueur clique le chat d'à côté, passe à une autre fenêtre ou à une
 * autre application (`blur`), ou que l'onglet ou le panneau se cache
 * (`visibilitychange`, `__relacherCommandes` de light.html, une scène à
 * zéro), une partie EN COURS se met dans SA pause — celle de P ou ÉCHAP
 * (Manager.setPause, l'écran mcPause).
 *
 * Le chemin est celui de la Frusion : la page lève `client.forcePause` et
 * appelle Client.onPause, qui passe au slot courant (`mng.current.onPause()`),
 * et seule la partie y répond (Game.onPause). Ce fichier le vérifie sur les
 * vraies classes du jeu, chargées sans navigateur, et sur le vrai script de
 * index.html, rejoué dans un bac à sable :
 *
 *   1. une partie en cours se met en pause, la même que P ;
 *   2. ni le panneau de départ, ni la fin de partie, ni le menu, ni une
 *      partie déjà en pause ;
 *   3. rien ne reprend tout seul : le joueur relance par ÉCHAP, dès que la
 *      fenêtre lui revient (`forcePause` retombe) ;
 *   4. la page branche bien `blur`, `visibilitychange` et
 *      `__relacherCommandes`, et lâche toujours les commandes.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Le moteur (sans DOM) puis les classes du jeu, dans l'ordre de la page.
globalThis.window = undefined;
for (const f of ['moteur/formes.js', 'moteur/flash.js', 'moteur/texte.js', 'jeu/base.js', 'jeu/sprites.js',
  'jeu/game.js', 'jeu/modes.js', 'jeu/menu.js', 'plateforme.js', 'jeu/manager.js']) {
  require(path.join(ROOT, 'public/kaluga', f));
}
const K = globalThis.KalugaMoteur;
const J = globalThis.KalugaJeu;
const Key = K.Key;

// La teinte de pause (MC.setPColor) veut un vrai clip : on la note seulement.
J.MC.setPColor = () => {};

// Une racine qui sait attacher et retirer l'écran de pause.
function racine() {
  const r = {
    attachMovie(link, nom) { r[nom] = { link, field: {}, removeMovieClip() { delete r[nom]; } }; },
  };
  return r;
}

// Un manager et sa partie, sans la scène : les champs que la pause regarde.
function partie(etat) {
  Key.toutRelacher();
  const mng = Object.create(J.Manager.prototype);
  Object.assign(mng, { root: racine(), flPause: false, slotList: [], fadeColor: 0xADE76B, flReleasePause: true });
  const client = new J.Client('');
  client.mng = mng;
  mng.client = client;
  const jeu = Object.create(J.Game.prototype);
  Object.assign(jeu, { mng, masterStep: 1, flEndGame: false, flEndingGame: false }, etat || {});
  mng.current = jeu;
  return { mng, client, jeu };
}

// Une image du manager avec telle touche enfoncée (puis relâchée).
function image(mng, code) {
  if (code) Key.presser(code);
  mng.update();
  if (code) Key.relacher(code);
}

/* ── 1. LA MÊME PAUSE QUE P ──────────────────────────────────────────────── */

test('une partie en cours se met en pause par Client.onPause — la même que P', () => {
  const auto = partie();
  auto.client.onPause();
  assert.strictEqual(auto.mng.flPause, true, 'la partie est en pause');
  assert.ok(auto.mng.root.mcPause, 'avec son écran de pause');
  assert.strictEqual(auto.mng.root.mcPause.link, 'mcPause');

  const manuelle = partie();
  image(manuelle.mng, 80);                       // P
  assert.strictEqual(manuelle.mng.flPause, true);
  assert.strictEqual(manuelle.mng.root.mcPause.link, auto.mng.root.mcPause.link, 'le même écran');
  assert.strictEqual(typeof auto.mng.pauseStart, 'number', 'et l’heure du début, pour décaler le chrono à la reprise');
});

/* ── 2. HORS PARTIE, RIEN ────────────────────────────────────────────────── */

test('ni le panneau de départ, ni la fin de partie, ni le menu, ni une pause déjà posée', () => {
  for (const [nom, etat] of [
    ['panneau de consignes (masterStep 0)', { masterStep: 0 }],
    ['panneau de fin (masterStep 2)', { masterStep: 2 }],
    ['fin de partie en cours', { flEndingGame: true }],
    ['partie finie', { flEndGame: true }],
  ]) {
    const p = partie(etat);
    p.client.onPause();
    assert.strictEqual(p.mng.flPause, false, nom + ' : pas de pause');
    assert.ok(!p.mng.root.mcPause, nom + ' : pas d’écran');
  }
  // Le menu n'a pas d'onPause : l'appel se perd sans bruit, comme en 2005.
  const p = partie();
  p.mng.current = Object.create(J.Menu.prototype);
  assert.doesNotThrow(() => p.client.onPause());
  assert.strictEqual(p.mng.flPause, false, 'le menu continue');
  // Pas encore de slot (chargement) : rien non plus.
  p.mng.current = null;
  assert.doesNotThrow(() => p.client.onPause());

  // Déjà en pause : on ne repose pas l'écran ni l'heure de départ.
  const q = partie();
  q.client.onPause();
  const ecran = q.mng.root.mcPause;
  const debut = q.mng.pauseStart = 1234;
  q.client.onPause();
  assert.strictEqual(q.mng.root.mcPause, ecran, 'le même écran');
  assert.strictEqual(q.mng.pauseStart, debut, 'la même heure de départ');
});

/* ── 3. LA REPRISE : CELLE DU JOUEUR ─────────────────────────────────────── */

test('rien ne reprend tout seul ; ÉCHAP relance dès que forcePause retombe', () => {
  const p = partie();
  p.client.forcePause = true;                    // ce que fait la page
  p.client.onPause();
  for (let i = 0; i < 5; i++) image(p.mng);
  assert.strictEqual(p.mng.flPause, true, 'la pause tient toute seule');
  // Tant que la fenêtre n'est pas revenue, la touche de pause est bloquée
  // (Manager.update d'époque) : c'est pourquoi la page la relâche au retour.
  image(p.mng, 27);
  assert.strictEqual(p.mng.flPause, true, 'forcePause levé : ÉCHAP ne fait rien');
  p.client.forcePause = false;
  image(p.mng);
  image(p.mng, 27);
  assert.strictEqual(p.mng.flPause, false, 'la fenêtre revenue, ÉCHAP relance');
  assert.ok(!p.mng.root.mcPause, 'et l’écran de pause s’en va');
});

/* ── 4. LA PAGE ──────────────────────────────────────────────────────────── */

// Le script de index.html, rejoué dans un bac à sable avec les vraies classes.
function page(mng) {
  const html = fs.readFileSync(path.join(ROOT, 'public/kaluga/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const src = scripts.find((s) => s.includes('demarrerKaluga('));
  assert.ok(src, 'le script de démarrage de la page');
  const ecouteurs = { window: {}, document: {} };
  const ecouter = (cible) => (type, fn) => { (ecouteurs[cible][type] = ecouteurs[cible][type] || []).push(fn); };
  const element = { clientWidth: 700, clientHeight: 480, style: {}, getBoundingClientRect: () => ({ width: 700, height: 480 }), focus() {}, remove() {} };
  const relaches = { n: 0 };
  const KK = Object.assign(Object.create(K), { Key: Object.assign(Object.create(Key), { toutRelacher() { relaches.n++; Key.toutRelacher(); } }) });
  J.manager = mng;
  const bac = {
    KalugaMoteur: KK, KalugaJeu: J, URLSearchParams, console,
    location: { search: '' }, devicePixelRatio: 1,
    addEventListener: ecouter('window'),
    demarrerKaluga: () => new Promise(() => {}),
    document: { hidden: false, getElementById: () => element, querySelectorAll: () => [], addEventListener: ecouter('document') },
  };
  bac.window = bac;
  vm.createContext(bac);
  vm.runInContext(src, bac, { filename: 'kaluga/index.html' });
  const emettre = (cible, type) => { for (const fn of ecouteurs[cible][type] || []) fn({ type }); };
  return { bac, emettre, relaches };
}

test('la page : blur, onglet caché et __relacherCommandes mettent la partie en pause et lâchent les commandes', () => {
  for (const [nom, declencher] of [
    ['blur', (pg) => pg.emettre('window', 'blur')],
    ['visibilitychange caché', (pg) => { pg.bac.document.hidden = true; pg.emettre('document', 'visibilitychange'); }],
    ['__relacherCommandes (onglet du light quitté)', (pg) => pg.bac.__relacherCommandes()],
  ]) {
    const p = partie();
    const pg = page(p.mng);
    Key.presser(38);
    declencher(pg);
    assert.strictEqual(p.mng.flPause, true, nom + ' : la partie est en pause');
    assert.strictEqual(p.client.forcePause, true, nom + ' : forcePause levé');
    assert.ok(pg.relaches.n >= 1 && !Key.isDown(38), nom + ' : les commandes sont lâchées');
  }
  // Un onglet qui redevient visible ne relance rien.
  const p = partie();
  const pg = page(p.mng);
  pg.emettre('window', 'blur');
  pg.bac.document.hidden = false;
  pg.emettre('document', 'visibilitychange');
  assert.strictEqual(p.mng.flPause, true, 'toujours en pause');
});

test('la page : au retour (focus, clic, touche), forcePause retombe mais la pause reste', () => {
  for (const retour of ['focus', 'pointerdown', 'keydown']) {
    const p = partie();
    const pg = page(p.mng);
    pg.emettre('window', 'blur');
    pg.emettre('window', retour);
    assert.strictEqual(p.client.forcePause, false, retour + ' : forcePause retombe');
    assert.strictEqual(p.mng.flPause, true, retour + ' : la partie reste en pause');
  }
});

test('la page : dans le menu, perdre le focus lâche les commandes sans rien mettre en pause', () => {
  const p = partie();
  p.mng.current = Object.create(J.Menu.prototype);
  const pg = page(p.mng);
  pg.emettre('window', 'blur');
  assert.strictEqual(p.mng.flPause, false, 'le menu continue');
  assert.strictEqual(pg.relaches.n, 1, 'les commandes sont lâchées');
  // Et avant que le jeu soit chargé (pas encore de manager), rien ne casse.
  const pg2 = page(null);
  assert.doesNotThrow(() => pg2.emettre('window', 'blur'));
  assert.doesNotThrow(() => pg2.emettre('window', 'focus'));
});
