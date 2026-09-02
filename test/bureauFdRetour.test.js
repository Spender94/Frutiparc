/*
 * Le disque repris du lecteur, et ce qu'il devient quand on le lâche.
 *
 * Le rapport : « lorsqu'un FD sort du lecteur, impossible de le remettre dans
 * le dossier Jeux — il disparaît quand on le dépose, et réapparaît après F5 ».
 * Deux chemins y menaient, tous deux côté bureau (public/bureau-frutiz.js) :
 *
 *   1. Le serveur CONNAISSAIT déjà l'objet (bureau et base désaccordés : une
 *      lecture ratée au montage, une réponse avalée). `desktopAdd` ne refuse
 *      rien — il REPLACE l'objet là où on l'a lâché et le renvoie —, mais le
 *      bureau lisait `deja` comme un refus et retirait l'icône. La base, elle,
 *      avait tout noté : d'où le retour au F5.
 *   2. Un disque repris du lecteur (`comeFromFrusion`) n'a pas d'icône source à
 *      faire réapparaître quand le dépôt échoue : il quittait l'écran.
 *
 * Et, avec eux, la colonne des bouilles du bureau, qui pouvait rester vide à
 * cause d'une préférence du light que le bureau ne savait plus rallumer.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public', 'bureau-frutiz.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');

function bloc(source, depart, fin) {
  const a = source.indexOf(depart);
  assert.ok(a >= 0, 'repère introuvable : ' + depart);
  const b = source.indexOf(fin, a + depart.length);
  assert.ok(b > a, 'fin de bloc introuvable : ' + fin);
  return source.slice(a, b);
}

test('« déjà là » n\'est plus un refus : le bureau adopte l\'objet que le serveur a replacé', () => {
  const f = bloc(JS, 'function creerObjetBureau(info, parent, pos)', 'function trouverObjet(uid)');
  assert.doesNotMatch(f, /if \(d\.deja\) \{ if \(i >= 0\) objetsBureau\.splice/,
    'plus de retrait de l\'icône sur `deja`');
  assert.match(f, /if \(i >= 0\) objetsBureau\[i\] = d\.objet;\s*else if \(!trouverObjet\(d\.objet\.uid\)\) objetsBureau\.push\(d\.objet\);/,
    'la version du serveur est prise, dans tous les cas');
  // Un disque replacé quitte « Mes disques » : les explorateurs se relisent.
  assert.match(f, /if \(d\.deja && d\.objet\.type === 'disc'\) relireExplorateurs\(\);/);
  // Et seule une réponse SANS objet (refus, réseau) retire l'icône.
  assert.match(f, /if \(!d \|\| !d\.ok \|\| !d\.objet\) \{ if \(i >= 0\) objetsBureau\.splice\(i, 1\);/);
});

test('un disque repris du lecteur et lâché nulle part retourne dans le tiroir', () => {
  const f = bloc(JS, 'function finirGlisser(x, y)', 'function surLeBureau(el)');
  assert.match(f, /if \(!pris && info\.comeFromFrusion\) frusion\.reprendre\(info\);/,
    'le geste manqué le ramène au lecteur');
  const r = bloc(JS, 'frusion.reprendre = function (info)', 'function rafraichirDisques()');
  assert.match(r, /this\.rendu = true;/, 'rendu à ses dossiers, comme après l\'éjection');
  assert.match(r, /classList\.add\('plein', 'reprenable'\)/, 'et attrapable à nouveau');
  assert.match(r, /if \(!this\.ouvert\) this\.openSlot\(\);/, 'dans le tiroir OUVERT');
  assert.match(r, /rafraichirDisques\(\);/);
});

test('la lecture du bureau au montage se réessaie quand elle rate', () => {
  const f = bloc(JS, 'function chargerObjetsBureau()', 'function ecrireObjetBureau(corps)');
  assert.match(f, /if \(\+\+essaisBureau < 4\) setTimeout\(chargerObjetsBureau, 2000 \* essaisBureau\);/,
    'trois nouveaux essais, espacés');
  // Toujours UN SEUL appel direct : le montage (cf. bureauRange.test.js — en
  // cours de session rien ne relit la route, une icône reste où on l'a mise).
  assert.equal((JS.match(/chargerObjetsBureau\(\);/g) || []).length, 1);
});

test('un déplacement que le serveur ne connaît pas revient en arrière, sans relire le bureau', () => {
  const f = bloc(JS, 'function deposerDansDossier(info, uid)', 'function deposerDansExplorateur');
  assert.match(f, /var avant = \{ parent: dedans\.parent, pos: dedans\.pos \};/);
  assert.match(f, /if \(d && d\.ok === false\) \{ dedans\.parent = avant\.parent; dedans\.pos = avant\.pos; rafraichirBureau\(\); \}/);
});

test('ouvrir la colonne des bouilles au bureau rallume la préférence du light', () => {
  // Le bureau intercepte le clic AVANT le bouton du light : une préférence
  // « masquées » posée un jour sur le téléphone n'avait plus aucun moyen de
  // revenir à « oui » — icône blanchie, colonne ouverte, personne dedans.
  const f = bloc(JS, 'function brancherBouillesSalon(f)', 'if (c.closest(\'#pen-btn\')');
  assert.match(f, /if \(ouvert && window\.SalonsBureau && SalonsBureau\.activerBouilles\s*&& SalonsBureau\.bouillesActives && !SalonsBureau\.bouillesActives\(\)\) \{\s*SalonsBureau\.activerBouilles\(true\);/);
  // Les deux portes sont définies AVEC les autres portes du bureau
  // (`window.SalonsBureau`), pas après coup : le bureau doit les trouver dès
  // qu'il se monte.
  const portes = bloc(LIGHT, 'window.SalonsBureau = {', 'liste: function () {');
  assert.match(portes, /bouillesActives: function \(\) \{ return !!state\.bouillesEnabled; \}/);
  assert.match(portes, /activerBouilles: function \(on\) \{\s*state\.bouillesEnabled = !!on;[\s\S]*?applyBouillePref\(\);/);
  // Et l'état se répercute sur TOUS les boutons : chaque fenêtre de salon du
  // bureau clone la barre, classe `off` comprise.
  assert.match(LIGHT, /document\.querySelectorAll\("#bouille-toggle"\), function \(btn\) \{\s*btn\.classList\.toggle\("off", !state\.bouillesEnabled\);/);
});
