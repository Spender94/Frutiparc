'use strict';
/*
 * DEUX BOUILLES SUR UN SEUL CANEVAS.
 *
 * « Les bouilles clignotent, on y voit alternativement la bouille du user qui
 * parle et la bouille par défaut (sac à patates). »
 *
 * Dans le chat, UN canevas sert tout le monde : chaque personne qui parle le
 * redemande pour sa bouille, et `rafraichir` oublie la précédente pour
 * relancer un montage. Or monter une bouille, c'est d'abord aller chercher un
 * FICHIER de famille — il se passe le temps du réseau entre la demande et la
 * réponse.
 *
 * Oublier ne suffisait pas. La demande d'AVANT continuait sa route, et quand
 * elle rentrait — après la nouvelle — elle montait quand même son arbre :
 * `posees.set(c, b)`, et sa boucle de rendu partait. Deux bouilles vivantes
 * sur un canevas, chacune peignant la sienne à quarante images par seconde.
 *
 * Chaque montage porte désormais son NUMÉRO DE TOUR ; `oublier` le fait
 * tourner. Au retour, un montage qui n'est plus le tour courant rend la main
 * sans rien poser.
 *
 * Ce fichier n'inspecte pas le code, il l'EXÉCUTE : le module livré est chargé
 * avec un moteur en carton dont on tient les promesses à la main.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');

// Un canevas en carton : juste ce que le module lui demande.
function canevas(etat) {
  const attrs = { 'data-s': etat, 'data-e': '0', 'data-anime': '1' };
  return {
    isConnected: true,
    width: 1, height: 1,
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    setAttribute: (n, v) => { attrs[n] = String(v); },
    // Un vrai canevas sait aussi RETIRER un attribut, et le lecteur s'en sert
    // (`data-custom` disparaît quand la bouille n'a plus d'accessoire maison).
    // Sans lui, le faux canevas trébuchait sur du code qui n'a rien à voir
    // avec ce que ce test surveille.
    removeAttribute: (n) => { delete attrs[n]; },
    getContext: () => ({ clearRect() {} }),
    _attrs: attrs,
  };
}

// Le module, chargé avec un moteur dont on tient les promesses.
function monter() {
  const familles = new Map();          // nom de fichier → { resoudre }
  const montees = [];                  // chaque Bouille construite
  const global = {
    FPBouilleSwf: {
      charger(url) {
        return new Promise((resoudre) => { familles.set(url, resoudre); });
      },
    },
    FPBouilleMoteur: {
      familleDe: (s) => Number(String(s).slice(0, 2)) || 0,
      Bouille: function (c, defs, o) {
        this.canevas = c; this.etat = o.etat; this.vivante = true;
        montees.push(this);
        this.definir = (s) => { this.etat = s; };
        this.humeur = () => {};
        this.arreter = () => { this.vivante = false; };
        this.animer = () => {};
      },
    },
    document: { querySelectorAll: () => [] },
  };
  vm.createContext(global);
  vm.runInContext(SRC, global);
  return { V: global.FPBouilleVignette, familles, montees };
}

const SAC = '000000010000000000000000';       // la bouille par défaut, famille 0
const ZOE = '10000A05000000000000000B';       // une vraie bouille, famille 10

test('un montage abandonné ne pose plus rien à son retour', async () => {
  const { V, familles, montees } = monter();
  const c = canevas(SAC);
  // Le chat crée la scène, puis demande la bouille du locuteur : la première
  // demande part sur la famille du sac à patates.
  V.jouer(c, SAC, 1, 0);
  assert.strictEqual(familles.size, 1, 'une famille demandée');
  // Quelqu'un d'autre parle AVANT que le fichier soit arrivé.
  V.jouer(c, ZOE, 1, 0);
  assert.strictEqual(familles.size, 2, 'une seconde famille demandée');
  // Les deux fichiers rentrent — le premier en dernier, comme le réseau sait
  // si bien le faire.
  for (const [, resoudre] of [...familles].reverse()) resoudre({});
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(montees.length, 1,
    'UNE seule bouille montée (relevé : ' + montees.length + ')');
  assert.strictEqual(montees[0].etat, ZOE, 'et c’est celle du locuteur');
  assert.strictEqual(c.getAttribute('data-s'), ZOE);
});

test('AVANT le correctif, la bouille abandonnée revenait quand même', async () => {
  // On rejoue l'ancienne version — sans le numéro de tour — pour montrer d'où
  // venait le clignotement.
  const ancien = SRC
    .replace(/var tour = \(tours\.get\(c\) \|\| 0\) \+ 1;\s*\n\s*tours\.set\(c, tour\);/, '')
    .replace(/ \|\| tours\.get\(c\) !== tour/, '')
    .replace(/if \(tours\.get\(c\) !== tour\) return null;/, '')
    .replace(/tours\.set\(c, \(tours\.get\(c\) \|\| 0\) \+ 1\);/, '');
  assert.ok(!/tours\.get\(c\) !== tour/.test(ancien), 'les gardes doivent avoir sauté');
  const familles = new Map();
  const montees = [];
  const global = {
    FPBouilleSwf: { charger: (u) => new Promise((r) => { familles.set(u, r); }) },
    FPBouilleMoteur: {
      familleDe: (s) => Number(String(s).slice(0, 2)) || 0,
      Bouille: function (c, defs, o) { this.etat = o.etat; montees.push(this);
        this.definir = () => {}; this.humeur = () => {}; this.arreter = () => {};
        this.animer = () => {}; },
    },
    document: { querySelectorAll: () => [] },
  };
  vm.createContext(global);
  vm.runInContext(ancien, global);
  const c = canevas(SAC);
  global.FPBouilleVignette.jouer(c, SAC, 1, 0);
  global.FPBouilleVignette.jouer(c, ZOE, 1, 0);
  for (const [, resoudre] of [...familles].reverse()) resoudre({});
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(montees.length, 2,
    'l’ancienne version en montait DEUX — le clignotement');
  const etats = montees.map((b) => b.etat).sort();
  assert.deepStrictEqual(etats, [SAC, ZOE].sort(),
    'la bouille du locuteur ET le sac à patates, sur le même canevas');
});

test('rester dans la même famille ne relance aucun montage', async () => {
  const { V, familles, montees } = monter();
  const c = canevas(ZOE);
  V.jouer(c, ZOE, 1, 0);
  for (const [, resoudre] of familles) resoudre({});
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(montees.length, 1);
  // Un autre locuteur de la MÊME famille : on ne recharge rien.
  const AUTRE = '10000B06000000000000000C';
  V.jouer(c, AUTRE, 1, 0);
  assert.strictEqual(familles.size, 1, 'aucune nouvelle demande de fichier');
  assert.strictEqual(montees.length, 1, 'et aucune seconde bouille');
  assert.strictEqual(montees[0].etat, AUTRE, 'le même arbre a simplement changé d’état');
});

test('la scène du chat naît avec la bonne bouille, pas avec le sac', () => {
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  const bloc = /function overlayIframe\(c, etat\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(bloc, 'overlayIframe doit prendre l’état à poser');
  assert.match(bloc[0], /FPBouilleVignette\.html\(etat \|\| DEFAULT_BOUILLE/);
  const jouer = /function overlayJouer\(pseudo, anim, c\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(jouer, 'overlayJouer doit exister');
  assert.match(jouer[0], /overlayIframe\(c, f\)/, 'et lui passer la bouille du locuteur');
});

test('la bouille d’un inconnu se demande au serveur, une seule fois', () => {
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  const bloc = /function reclamerBouille\(cle\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(bloc, 'la réclamation doit exister');
  // Une seule fois : ni si on la connaît déjà, ni si on l'a déjà demandée.
  assert.match(bloc[0], /if \(!cle \|\| bouillesDemandees\[cle\] \|\| state\.bouilleByUser\[cle\] \|\| !state\.sid\) return;/);
  assert.match(bloc[0], /bouillesDemandees\[cle\] = 1;/);
  assert.match(bloc[0], /rememberBouille\(cle, d\.bouille\)/);
  const jouer = /function overlayJouer\(pseudo, anim, c\) \{[\s\S]*?\n  \}/.exec(LIGHT)[0];
  assert.match(jouer, /if \(!connue\) reclamerBouille\(cle\);/);
});
