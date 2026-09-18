/*
 * UN COMPTE EN MÉMOIRE N'EST PAS FORCÉMENT UN COMPTE ENTIER.
 *
 * Au redémarrage, quand le jour a changé, rollDailyChallengeIfNeeded rejoue
 * le passage de minuit et awardDailyXp parcourt tous les joueurs actifs la
 * veille. Pour ceux qui ne sont pas en mémoire, il convertissait leur ligne
 * `users` (dbUserToMemory) et la POSAIT dans users[] — sans contacts,
 * inventaire, accessoires, pictos ni sauvegardes. La connexion Light
 * (/api/auth/login) et le réveil d'une session dormante ne rechargeaient
 * qu'un compte ABSENT : ces joueurs retrouvaient un carnet vide, une
 * consécration à zéro et une garde-robe perdue, alors que la base avait
 * tout ; à l'ouverture d'un jeu, les pictos « redécouverts » dans la
 * sauvegarde pleuvaient en notifications.
 *
 * Trois verrous : l'hydratation pose `_hydrated` en dernier, les deux
 * entrées Light s'y fient plutôt qu'à la seule présence en mémoire, et le
 * passage de minuit hydrate au lieu de convertir.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const corpsDe = (nom) => {
  const debut = src.indexOf(nom);
  assert.ok(debut >= 0, nom + ' introuvable');
  return src.slice(debut, src.indexOf('\n}\n', debut));
};

test('l’hydratation marque le compte entier, en dernier', () => {
  const corps = corpsDe('async function hydrateUserFromDb(');
  const drapeau = corps.lastIndexOf('users[username]._hydrated = true;');
  assert.ok(drapeau >= 0, 'le drapeau est posé');
  assert.ok(drapeau > corps.indexOf('users[username].contacts ='), 'après les contacts');
  assert.ok(drapeau > corps.indexOf('users[username].gameItems ='), 'après les pictos');
  assert.ok(drapeau > corps.indexOf('getAllFrutiSlots'), 'après les sauvegardes');
  assert.ok(drapeau > corps.indexOf('scoresData.users[username][rkId] = entry'), 'après les scores');
});

test('la connexion Light et le réveil d’une session rechargent un compte nu', () => {
  assert.match(src, /if \(!users\[username\] \|\| !users\[username\]\._hydrated\) \{\s*await hydrateUserFromDb\(username, dbUser\);/);
  const reveil = corpsDe('function reveillerSession(');
  assert.match(reveil, /\(!users\[username\] \|\| !users\[username\]\._hydrated\) && process\.env\.DATABASE_URL/);
});

test('le passage de minuit hydrate, il ne convertit plus', () => {
  const corps = corpsDe('async function awardDailyXp(');
  assert.match(corps, /await hydrateUserFromDb\(username, row\);\s*user = users\[username\];/);
  assert.ok(!/dbUserToMemory\(/.test(corps), 'plus de conversion nue');
  // Et nulle part ailleurs on ne pose une ligne convertie dans users[].
  assert.ok(!/users\[[^\]]+\] = dbUserToMemory\(/.test(src));
  assert.ok(!/user = dbUserToMemory\(row\);\s*users\[username\] = user;/.test(src));
});
