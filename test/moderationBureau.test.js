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
  // La seule fonction qui compte ici : on s'arrête à la SUIVANTE, et non au
  // routeur — d'autres commandes se sont glissées entre les deux depuis
  // (`commandeImage`, qui rappelle sa syntaxe, elle).
  const debut = LIGHT.indexOf('function commandeModeration');
  const bloc = LIGHT.slice(debut, LIGHT.indexOf('\n  function ', debut + 10));
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
  // Le salon est retenu PAR FICHE, depuis qu'on peut en ouvrir plusieurs :
  // chacune garde celui d'où elle a été ouverte, et le kick prend le sien.
  assert.match(LIGHT, /var ficheEtat = \{ pseudo: null, data: null, onglet: "frutiz", salon: null,\s*\n\s*racine: null \};/);
  assert.match(LIGHT, /function ouvrirFiche\(pseudo, salon\) \{/);
  assert.match(LIGHT, /f = \{ pseudo: p, data: null, onglet: "frutiz",\s*\n\s*salon: salon \|\| state\.room \|\| null, racine: null \};/);
  // …et le kick s'en sert
  assert.match(LIGHT, /var ou = f\.salon \|\| state\.room \|\| "";/);
  assert.match(LIGHT, /wsSend\('<l u="' \+ xmlEscape\(p\) \+ '" g="' \+ xmlEscape\(ou\) \+ '" \/>'\);/);
  // le clic sur un écran de l'aquarium le lui donne
  assert.match(LIGHT, /ouvrirFiche: function \(pseudo, salon\) \{ ouvrirFiche\(pseudo, salon\); \},/);
  // Le clic est passé dans `brancherEcrans`, partagé avec la fenêtre de
  // Gaspard : le nom est lu une fois, le salon reste celui de la fenêtre.
  assert.match(JS, /if \(S && S\.ouvrirFiche\) S\.ouvrirFiche\(nom, panneau\.getAttribute\('data-salon'\)\);/);
});

/* ══ L'APPEL AU MODÉRATEUR — `box.whining` (main.swf 0x313e5) ═══════════════
 *
 * Le quatrième bouton de la colonne d'un salon. Il pose TROIS questions avant
 * d'envoyer quoi que ce soit :
 *
 *   · « Cette action n'est disponible que sur les salons publics. »
 *   · « Un ou plusieurs modérateurs sont déjà présents sur ce salon. »
 *   · « Vous venez de prévenir les modérateurs ! » — une minute de repos
 *     (`now − lastCallModerator < 60000`).
 *
 * puis l'alerte d'époque (`chat.call_moderator`), et `callModerator`
 * (0x3166a) envoie `cmd("callmoderator", {g})`.
 *
 * Le code de trame était déclaré côté serveur (`bo`) mais AUCUNE branche ne
 * l'écoutait : le bouton était dessiné, désactivé, et disait qu'il l'était.
 * Il est branché des deux côtés, avec les deux phrases d'époque —
 * `chat.moderator_called_channel` dans le salon, `chat.moderator_called` à
 * chaque modérateur en ligne.
 */

test('le bouton d’appel est branché, et repose les trois questions', () => {
  const w = JS.slice(JS.indexOf('function appelerLesModerateurs(salon)'),
    JS.indexOf('function enTeteDossier'));
  assert.ok(w, 'la fonction d’appel doit exister');
  assert.match(w, /Cette action n'est disponible que sur les salons publics\./);
  assert.match(w, /Un ou plusieurs modérateurs sont déjà présents sur ce salon\./);
  assert.match(w, /Vous venez de prévenir les modérateurs !/);
  assert.match(JS, /var APPEL_MODO_REPOS = 60000;/);
  // Le bouton n'est plus mort.
  const b = JS.slice(JS.indexOf('function warningSalon(salon)'), JS.indexOf('function appelerLesModerateurs'));
  assert.ok(!/b\.disabled = true/.test(b), 'le bouton n’est plus désactivé');
  assert.match(b, /b\.addEventListener\('click', function \(\) \{ appelerLesModerateurs\(salon\); \}\);/);
});

test('le light sait poser la question et envoyer la trame', () => {
  // `chat.call_moderator`, mot pour mot.
  assert.match(JS, /Etes-vous sûr de vouloir prévenir les modérateurs qu'il y a un problème/);
  assert.match(JS, /Attention !<\/b> à n'utiliser qu'en cas de véritable/);
  assert.match(JS, /okLabel: 'Oui', cancelLabel: 'Non',/);
  // `callModerator` : la trame, et rien de plus.
  assert.match(LIGHT, /wsSend\('<bo g="' \+ xmlEscape\(String\(id \|\| state\.room \|\| ""\)\) \+ '" \/>'\);/);
  // `userList.modePresent()` et le salon public, pour refuser avant d'envoyer.
  assert.match(LIGHT, /moderateurPresent: function \(id\) \{/);
  assert.match(LIGHT, /estPublic: function \(id\) \{ return !!id && !state\.prives\[id\]; \}/);
});

test('le serveur repose les mêmes questions, et prévient les deux côtés', () => {
  const c = SERVEUR.slice(SERVEUR.indexOf("case 'callmoderator': {"),
    SERVEUR.indexOf("// ── status: update user status ──"));
  assert.ok(c, 'la branche du serveur doit exister');
  // Un client ne se vérifie pas lui-même : les trois gardes sont ici aussi.
  assert.match(c, /channels\[g\]\.private \|\| \/\^pm2\?_\/\.test\(g\)/);
  assert.match(c, /if \(isChannelStaff\(cl\.username, g\)\) \{ modeLa = true; break; \}/);
  assert.match(c, /t - client\.dernierAppelModo < 60000/);
  // `chat.moderator_called_channel` : le salon voit qui a appelé, en rouge.
  assert.match(c, /indique qu'il y a des problèmes sur ce salon !/);
  assert.match(c, /st="r"/);
  // `chat.moderator_called` : chaque modérateur EN LIGNE, où qu'il soit.
  assert.match(c, /if \(!cl\.username \|\| !isModerator\(cl\.username\)\) continue;/);
  assert.match(c, /\$\{CMD\.moderatorcalled\}/);
});

test('les deux trames de retour ont leur branche dans le light', () => {
  // `bo` revient à qui a appelé — `k="1"` porte le refus.
  assert.match(LIGHT, /case "bo": \{/);
  assert.match(LIGHT, /if \(attr\(xml, "k"\) === "1"\) \{/);
  // `bp` va aux modérateurs : « …rejoindre le salon ? »
  assert.match(LIGHT, /case "bp": \{/);
  assert.match(LIGHT, /indique qu'il y a des problèmes sur "\s*\n?\s*\+ xmlEscape\(bpF\)/);
  assert.match(LIGHT, /okLabel: "Oui", cancelLabel: "Non",/);
  assert.match(LIGHT, /window\.SalonsBureau\.rejoindre\(bpG\);/);
});
