/*
 * LE CHRONO DE LA PARTIE, DE RETOUR DANS LE PACK DE FRUTISNAKE.
 *
 * « J'aimerais que tu ajoutes le chrono de la partie dans le pack snake (en
 * plus des infos déjà existantes). Les users estiment que c'était un ajout
 * très important et ils regrettent qu'on l'ait retiré. »
 *
 * La « durée de la partie » est l'un des cinq relevés du disque Flash
 * (game-popup.html) ; le portage light l'avait retirée au profit de la
 * vitesse — « Frutisnake n'a pas de chronomètre à battre ». Les joueurs y
 * tenaient. Elle revient, la vitesse reste : six relevés.
 *
 * Deux règles, les mêmes que sur le disque :
 *   · le temps est tenu par la PAGE, pas par le jeu (qui ne le mesure pas) ;
 *   · ni la pause ni ce qui suit la mort ne comptent — le chrono se fige sur
 *     la durée jouée, et c'est elle qu'on lit à la fin.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const GAME = lire('public/snake3/game.js');
const P = require('../public/snake3/pack.js');

test('six relevés : la durée de la partie entre le bonus et la vitesse', () => {
  assert.deepStrictEqual(P.LIGNES.map((l) => l.cle), ['longueur', 'fruits', 'dynamites', 'bonus', 'chrono', 'vitesse']);
  const chrono = P.LIGNES.find((l) => l.cle === 'chrono');
  assert.strictEqual(chrono.titre, 'Durée de la partie', 'l’intitulé du disque');
  assert.strictEqual(chrono.court, 'Partie', 'et son abrégé pour la colonne étroite');
});

test('la valeur s’affiche en mm:ss, et 00:00 hors partie', () => {
  assert.strictEqual(P.valeurs(null).chrono, '00:00');
  const v = P.valeurs({ longueur: 4, fruits: 1, dynamites: 0, bonus: 0, vitesse: 100, chrono: 83.7 });
  assert.strictEqual(v.chrono, '01:23', 'les secondes entamées ne comptent pas encore');
  assert.strictEqual(P.valeurs({ longueur: 0, fruits: 0, dynamites: 0, bonus: 0, vitesse: 100, chrono: 600 }).chrono, '10:00');
});

test('le bandeau du portrait fait deux rangées de trois ; la colonne, six cases', () => {
  const PACK = lire('public/snake3/pack.js');
  assert.match(PACK, /const RANGEES = \[3, 3\];/);
  assert.match(PACK, /const n = LIGNES\.length;\s*\n\s*const c = \(haut - \(n - 1\) \* ENTRE\) \/ n;/, 'la colonne se partage entre toutes les lignes');
  // Les deux rangées se partagent la hauteur du bandeau : elle ne change pas.
  assert.strictEqual(P.H_MIN, 168);
  assert.strictEqual(P.H_MAX, 224);
});

test('la page tient le temps : hors pause, hors mort, et le relevé le porte', () => {
  assert.match(GAME, /this\.chrono = 0;\s+\/\/ secondes de jeu \(hors pause, hors mort\)/);
  assert.match(GAME, /partie\.main\(tmod, deltaT\);[\s\S]{0,600}?if \(!partie\.pause && !partie\.game_over_flag\) this\.chrono \+= deltaT;/,
    'le chrono avance juste après le moteur, et seulement quand on joue');
  assert.match(GAME, /chrono: vue\.chrono,\s*\n\s*pause: !!p\.pause,/);
  // Une vue de partie de poche, pour le voir avancer et se figer.
  const VuePartie = new Function('P', 'return ' + /class VuePartie \{[\s\S]*?\n  main\(tmod, deltaT\) \{[\s\S]*?\n  \}/.exec(GAME)[0]
    .replace(/class VuePartie \{[\s\S]*?\n  main\(/, 'class VuePartie { main(') + '}')();
  const vue = Object.create(VuePartie.prototype);
  vue.chrono = 0;
  vue.jeu = { entreesPartie: () => ({}) };
  vue.partie = { pause: false, game_over_flag: false, main() {} };
  vue.trouFx = null; vue.enrobages = new Map(); vue.bombes = []; vue.serpentsNoirs = []; vue.popups = []; vue.filmsSlot = new Map();
  vue.particules = { main() {} }; vue.ecran = null; vue.fbarreMid = 0;
  const pas = () => { try { vue.main(0.8, 1 / 40); } catch (e) { /* la suite de main veut le vrai jeu : le chrono, lui, est déjà passé */ } };
  for (let i = 0; i < 40; i++) pas();
  assert.ok(Math.abs(vue.chrono - 1) < 1e-9, 'quarante images à 1/40 s : une seconde');
  vue.partie.pause = true;
  for (let i = 0; i < 40; i++) pas();
  assert.ok(Math.abs(vue.chrono - 1) < 1e-9, 'la pause ne compte pas');
  vue.partie.pause = false; vue.partie.game_over_flag = true;
  for (let i = 0; i < 40; i++) pas();
  assert.ok(Math.abs(vue.chrono - 1) < 1e-9, 'la mort non plus : le chrono se fige sur la durée jouée');
});
