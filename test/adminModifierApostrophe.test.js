'use strict';
/*
 * ADMIN : « MODIFIER » NE S'OUVRAIT PLUS POUR UN FRUTIJOB À APOSTROPHE.
 *
 * Le bouton était écrit en JavaScript dans un attribut :
 *
 *     onclick="editUser('kobbs', …, 'Maître ÈS [snake] '26', …)"
 *
 * `esc` protège le HTML (& < >), pas une chaîne JavaScript : l'apostrophe de
 * « '26 » (ou de « Hôtesse d'accueil ») refermait la chaîne, le code ne se
 * lisait plus, et le clic ne faisait rien — pour ce joueur-là seulement.
 * `jsArg` encode la valeur pour JS (JSON) PUIS pour l'attribut (&quot;…).
 *
 * Ici, on fabrique le vrai bouton avec des valeurs piégées, on décode
 * l'attribut comme le ferait le navigateur, on exécute le onclick, et chaque
 * valeur doit arriver intacte dans editUser.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

function fonction(nom) {
  const f = ADMIN.indexOf('function ' + nom + '(');
  assert.ok(f >= 0, nom + ' introuvable');
  let p = ADMIN.indexOf('{', f), prof = 0;
  for (; p < ADMIN.length; p++) {
    if (ADMIN[p] === '{') prof++;
    else if (ADMIN[p] === '}' && --prof === 0) break;
  }
  return ADMIN.slice(f, p + 1);
}

test('le bouton Modifier passe chaque champ intact, apostrophes comprises', () => {
  const ligne = ADMIN.split('\n').find((l) => l.includes('onclick="editUser('));
  assert.ok(ligne, 'le bouton Modifier');
  const gabarit = ligne.trim();

  // `esc` sans le DOM : textContent → innerHTML n'échappe que & < >.
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // eslint-disable-next-line no-new-func
  const jsArg = new Function('esc', fonction('jsArg') + '\nreturn jsArg;')(esc);

  const u = {
    username: 'kobbs', xp: 12, kikooz: 3, fbouille: '0a"1b<2>&3',
    display_name: "L'ami \"Kobbs\"", fruti_sign: 2, fruti_sign_b: -1,
    frutijob: "Maître ÈS [snake] [kaluga] '26 \\o/ </button>", email: "o'neil@exemple.fr",
  };
  // eslint-disable-next-line no-new-func
  const html = new Function('u', 'esc', 'jsArg', 'return `' + gabarit + '`;')(u, esc, jsArg);
  const attr = /onclick="([^"]*)"/.exec(html);
  assert.ok(attr, 'l\'attribut onclick reste entier : ' + html);
  const code = attr[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

  let recu = null;
  // eslint-disable-next-line no-new-func
  new Function('editUser', code)((...args) => { recu = args; });
  assert.deepStrictEqual(recu, ['kobbs', 12, 3, u.fbouille, u.display_name, 2, -1, u.frutijob, u.email]);
});
