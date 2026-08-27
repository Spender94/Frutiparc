'use strict';
/*
 * DEUX MEUBLES QUI N'ÉTAIENT PAS D'ÉPOQUE.
 *
 * · LE PIED DE PAGE. Le portage déménageait la ligne du compte (« Connecté en
 *   tant que … · Se déconnecter · Confidentialité ») du tiroir mobile vers le
 *   bas du bureau. main.swf n'a pas de pied de page : « Se déconnecter » y vit
 *   dans le MENU DU FOND D'ÉCRAN, et le light le disait déjà en commentaire
 *   (« Le bureau Flash range “Se déconnecter” dans le menu contextuel du
 *   fond »). La ligne reste donc au tiroir, et le menu du bureau reçoit
 *   l'entrée — sans quoi on ne pourrait plus se déconnecter du tout.
 *
 * · LA PILULE « N EN LIGNE ». Une invention du portage, posée en surimpression
 *   du coin haut-droit. Le SWF n'a rien de tel : l'affluence se lit dans la
 *   liste des connectés d'une fenêtre de salon, et le titre du salon la porte
 *   déjà entre parenthèses.
 *
 * Le MOBILE ne change pas : la ligne du compte est la sienne, et elle y reste.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('la ligne du compte ne descend plus sur le bureau', () => {
  assert.doesNotMatch(JS, /var compte = \$\('#home-panel \.home-compte'\);/);
  assert.doesNotMatch(JS, /bureau\.appendChild\(compte\)/);
  // …mais elle existe toujours, pour le mobile
  assert.match(LIGHT, /<div class="home-compte">/);
  assert.match(LIGHT, /id="logout-btn"/);
});

test('« Se déconnecter » passe au menu du fond d’écran', () => {
  const menu = JS.slice(JS.indexOf('function menuDuBureau'),
    JS.indexOf('function ouvrirDossierBureau'));
  assert.match(menu, /sortir\.textContent = 'Se déconnecter';/);
  // il appuie sur le bouton du tiroir : une seule porte de sortie, pas deux
  assert.match(menu, /var q = \$\('#logout-btn'\);\s*\n\s*if \(q\) q\.click\(\);/);
  // et « Nouveau dossier » reste la première entrée
  assert.ok(menu.indexOf("'Nouveau dossier'") < menu.indexOf("'Se déconnecter'"));
});

test('la pilule « N en ligne » a disparu, code et style compris', () => {
  assert.doesNotMatch(JS, /pill-enligne/);
  assert.doesNotMatch(JS, /majEnLigne/);
  assert.doesNotMatch(CSS, /pill-enligne/);
  // et plus de sondage périodique pour l'alimenter
  assert.doesNotMatch(JS, /api\/light\/online/);
});
