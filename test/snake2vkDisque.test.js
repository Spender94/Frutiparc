/*
 * Frutisnake 2 VK (snake2vk) : la réécriture de Frutisnake par Kobbs, servie
 * À CÔTÉ de l'ancien Frutisnake (snake3), sans le toucher.
 *
 * Le disque doit exister au catalogue serveur ET être branché dans chacune des
 * trois vitrines qui l'ouvrent (fenêtre Ruffle, mode /light, bureau Frutiz). Le
 * libellé d'un disque choisit à la fois sa jaquette et le jeu lancé : « snake3 »
 * ouvrirait l'ancien.
 *
 * Ce jeu n'enregistre AUCUN score : il est compilé sans envoi (VITE_NO_SCORES),
 * et le serveur n'a aucun classement à son nom, donc rien ne peut être retenu.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('le catalogue serveur a un disque light snake2vklight', () => {
  const m = lire('server.js').match(/\n  snake2vklight: \{([\s\S]*?)\n  \},/);
  assert.ok(m, 'entrée snake2vklight dans GAME_DISCS');
  assert.match(m[1], /discType: '3'/);
  assert.match(m[1], /swfName: 'snake2vk'/);
  assert.match(m[1], /iconName: 'snake2vk'/);
  assert.match(m[1], /gameId: 'light\/snake2vk'/);
  assert.match(m[1], /files: \[\]/);
});

test('le serveur n’a aucun classement snake2vk', () => {
  assert.doesNotMatch(lire('server.js'), /snake2vk_\w+\s*:/);
});

test('la fenêtre Ruffle détourne le disque vers /snake2vk/', () => {
  assert.match(lire('public/ruffle.html'), /"light\/snake2vk": \{ url: "\/snake2vk\/"/);
});

test('le mode /light a son panneau, son cadre, son adresse et son disque', () => {
  const h = lire('public/light.html');
  assert.match(h, /<section class="panel" id="snake2vk-panel">/);
  assert.match(h, /id="snake2vk-frame"/);
  assert.match(h, /snake2vk: "#snake2vk-frame"/);
  assert.match(h, /snake2vk: "\/snake2vk\/"/);
  assert.match(h, /\$\("#snake2vk-panel"\)\.classList\.toggle\("active", tab === "snake2vk"\)/);
  assert.match(h, /\{ tab: "snake2vk", jaquette: "snake2vk", anneau: "3", name: "Frutisnake 2 VK" \}/);
});

test('le bureau Frutiz a sa fenêtre, son nom, sa jaquette et son lancement', () => {
  const b = lire('public/bureau-frutiz.js');
  assert.match(b, /snake2vk:\s+\{ panneau: '#snake2vk-panel',\s+titre: 'Frutisnake 2 VK'/);
  assert.match(b, /snake2vk: 'Frutisnake 2 VK'/);
  assert.match(b, /snake2vk: 'snake2vk', jama/, 'JAQUETTES : sa propre jaquette');
  assert.match(b, /\n\s+snake2vk: 'snake2vk',\n/, 'JEUX_LIGHT : le libellé du disque lance SON jeu');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/frutiz/sprites/disc_jaquette_snake2vk.svg')), 'la jaquette existe');
});

test('le jeu compilé est servi sous /snake2vk/, sans scores', () => {
  const dir = path.join(ROOT, 'public', 'snake2vk');
  const index = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(index, /"\/snake2vk\/assets\//);
  assert.doesNotMatch(index, /snake3-v2|frutisnake3/);
  const js = fs.readdirSync(path.join(dir, 'assets')).filter((f) => /^index-.*\.js$/.test(f));
  assert.strictEqual(js.length, 1, 'un seul point d’entrée');
  const bundle = fs.readFileSync(path.join(dir, 'assets', js[0]), 'utf8');
  assert.match(bundle, /desactive/, 'la garde « scores désactivés » est compilée');
  assert.doesNotMatch(bundle, /wss?:\/\/localhost/, 'aucun serveur d’Arène : bots seulement');
});

test('l’ancien Frutisnake garde ses entrées', () => {
  assert.match(lire('public/ruffle.html'), /"light\/snake3": \{ url: "\/snake3\/"/);
  assert.match(lire('public/bureau-frutiz.js'), /snake3: 'snake3', snake: 'snake3'/);
  assert.match(lire('server.js'), /snake3_classic:\s+\{ name: 'Frutisnake - Classique'/);
});
