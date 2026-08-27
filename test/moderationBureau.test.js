'use strict';
/*
 * LA MODÉRATION DEPUIS LE SALON — les boutons de la fiche et les commandes.
 *
 * ── /kick ET /eject, RELEVÉS AU BYTECODE (`box.Chat.onSend`, 0x2a5ae) ────
 * Le SWF traite les deux LUI-MÊME, sous une seule condition :
 *
 *     if (this.flMode && words[1].length) {
 *       this.eject(this.userList.getRealUserName(words[1]));
 *     }
 *
 * `flMode` est le `m="1"` de sa propre entrée dans CE salon — donc modérateur
 * partout, animateur chez lui (`isChannelStaff` côté serveur). Qui ne l'a pas
 * ne voit RIEN se passer : la commande est avalée, sans message d'erreur.
 *
 * Elles n'existaient pas dans le portage : tout ce qui commence par « / » et
 * que `traiterCommande` ne connaît pas part au serveur, qui répond
 * « Commande inconnue. » (server.js, `if (text.startsWith('/'))`).
 *
 * ── LE SALON DU KICK ─────────────────────────────────────────────────────
 * La trame porte un `g`, et le serveur en tire `pickActiveChannel` puis
 * `isChannelStaff(client.username, g)`. Le bouton de la fiche envoyait
 * `state.room` — le salon « courant » —, or sur le bureau il y a UNE FENÊTRE
 * PAR SALON : ouvrir la fiche depuis l'aquarium d'une autre fenêtre éjectait
 * du mauvais salon, ou se faisait refuser en 403. La fiche retient donc le
 * salon d'où on l'a ouverte.
 *
 * ── ÉCART ASSUMÉ ─────────────────────────────────────────────────────────
 * `/totoche` n'existe pas dans le SWF : le totoché n'y a que le bouton de la
 * fiche. On l'ajoute par symétrie avec `/kick`, sur la même condition — c'est
 * une demande du parc, pas un relevé.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('/kick et /eject sont les deux noms d’époque', () => {
  assert.match(LIGHT, /var CMD_KICK = \["\/kick", "\/eject"\];/);
  assert.match(LIGHT, /var CMD_TOTOCHE = \["\/totoche", "\/totocher"\];/);
  // et elles sont bien branchées dans le routeur des commandes locales
  assert.match(LIGHT, /if \(CMD_KICK\.indexOf\(cmd\) !== -1 \|\| CMD_TOTOCHE\.indexOf\(cmd\) !== -1\) \{\s*\n\s*commandeModeration\(cmd, mots, salon\);\s*\n\s*return true;/);
});

test('`flMode && words[1].length` — les deux, sinon rien', () => {
  const bloc = LIGHT.slice(LIGHT.indexOf('function commandeModeration'),
    LIGHT.indexOf('function traiterCommande'));
  assert.match(bloc, /if \(!jeSuisStaff\(ou\)\) return;/);
  assert.match(bloc, /if \(!cible\) return;/);
  // aucune ligne d'erreur : le SWF avale la commande en silence
  assert.doesNotMatch(bloc, /systemLine/);
});

test('le staff se lit sur le `m="1"` de MON entrée, dans CE salon', () => {
  assert.match(LIGHT, /function jeSuisStaff\(salon\) \{\s*\n\s*var set = state\.usersByRoom\[salon \|\| state\.room\] \|\| \{\};/);
  assert.match(LIGHT, /return !!\(moi && moi\.staff\);/);
  // côté serveur, c'est la même règle : modérateur partout, animateur chez lui
  assert.match(SERVEUR, /function isChannelStaff\(username, channelName\) \{\s*\n\s*return isModerator\(username\) \|\| \(channelName === ANIM_CHANNEL && isAnimator\(username\)\);/);
});

test('les trames envoyées sont celles des boutons de la fiche', () => {
  // kick → <l u g>, totoché → <az u> : exactement CMD.kick et CMD.mute
  assert.match(LIGHT, /wsSend\('<l u="' \+ xmlEscape\(cible\) \+ '" g="' \+ xmlEscape\(ou\) \+ '" \/>'\);/);
  assert.match(LIGHT, /wsSend\('<az u="' \+ xmlEscape\(cible\) \+ '" \/>'\);/);
  assert.match(SERVEUR, /kick:\s+'l',/);
  assert.match(SERVEUR, /mute:\s+'az',/);
});

test('la fiche retient le salon d’où on l’a ouverte', () => {
  assert.match(LIGHT, /var ficheEtat = \{ pseudo: null, data: null, onglet: "frutiz", salon: null \};/);
  assert.match(LIGHT, /function ouvrirFiche\(pseudo, salon\) \{/);
  assert.match(LIGHT, /ficheEtat = \{ pseudo: p, data: null, onglet: "frutiz", salon: salon \|\| state\.room \|\| null \};/);
  // …et le kick s'en sert
  assert.match(LIGHT, /var ou = ficheEtat\.salon \|\| state\.room \|\| "";/);
  assert.match(LIGHT, /wsSend\('<l u="' \+ xmlEscape\(p\) \+ '" g="' \+ xmlEscape\(ou\) \+ '" \/>'\);/);
  // le clic sur un écran de l'aquarium le lui donne
  assert.match(LIGHT, /ouvrirFiche: function \(pseudo, salon\) \{ ouvrirFiche\(pseudo, salon\); \},/);
  assert.match(JS, /S\.ouvrirFiche\(ec\.getAttribute\('data-nom'\),\s*\n\s*panneau\.getAttribute\('data-salon'\)\);/);
});
