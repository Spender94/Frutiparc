'use strict';
/*
 * KICK, TOTOCHÉ, ET LE VOYANT DU FORUM — CE QUE LE LIGHT EN FAISAIT.
 *
 * « Faire marcher kick + totoche. Testés sur le mode light aujourd'hui, le
 *   message s'affiche mais la personne n'est pas totochée/kickée. »
 * « La gestion des notifications sur le forum ne semble pas fonctionner. J'ai
 *   choisi d'être notifié "Seulement mes sujets suivis (❤)". Je ne suis jamais
 *   notifié, alors que j'ai bien suivi des topics et qu'ils ont eu des
 *   nouveaux posts entre temps. »
 *
 * ── CE QUE LE BANC A MONTRÉ ───────────────────────────────────────────────
 * Le serveur faisait son travail dans les trois cas (relevé avec trois
 * sockets, scratchpad/diag-modo.js et diag-suivi.js) :
 *
 *   totoché : `<bb>` part à la victime, l'annonce au salon, et le message
 *             suivant de la victime est REFUSÉ — elle reçoit `<bb>` en
 *             retour au lieu d'être diffusée ;
 *   kick    : `<ag>` part à tout le salon, la victime est retirée du canal ;
 *   forum   : la poussée « sujet suivi, absent → envoyé » arrive bien au
 *             service de notifications.
 *
 * Tout ce qui manquait était CÔTÉ CLIENT :
 *
 *   · `<bb>` n'écrivait qu'une ligne. Le champ de saisie restait ouvert, et
 *     chaque message partait pour être avalé en silence — de l'extérieur,
 *     « la personne n'est pas totochée ».
 *   · `<ag>` ne faisait sortir de rien : l'expulsé restait dans le salon
 *     d'où il venait d'être chassé, avec la liste d'avant. Et le retrait de
 *     la victime visait `state.room`, pas le salon `g` de la trame — sur le
 *     bureau, où chaque salon a SA fenêtre, ce n'est pas le même.
 *   · `<ay>` (newforummsg) n'était même pas dans le `switch` : le voyant du
 *     forum n'était relu qu'au prochain passage sur `/api/light/profile`.
 *     Le serveur envoyait, personne n'écoutait.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

/* ── 1. LE TOTOCHÉ ────────────────────────────────────────────────────────── */

test('le totoché ferme vraiment la saisie', () => {
  const f = /function majMuselage\(\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(f, 'majMuselage doit exister');
  // TOUTES les saisies : celle du mobile et celles des fenêtres de salon du
  // bureau (elles partagent l'identifiant, `querySelectorAll` les rend toutes).
  assert.match(f[0], /document\.querySelectorAll\("#compose-input"\)/);
  assert.match(f[0], /inp\.disabled = mut \|\| !state\.connected;/);
  assert.match(f[0], /\["#compose-send", "#accent-toggle"\]/);
  // Et elle se rouvre toute seule à l'échéance.
  assert.match(f[0], /muselageTimer = setTimeout\(majMuselage,/);
});

test('l’échéance se lit en UTC, pas en heure locale', () => {
  // Le serveur écrit `toISOString().replace('T','.')` : « 2026-08-29.12:34:29 »
  // est de l'UTC SANS marqueur. Le lire tel quel donnerait deux heures d'écart
  // en été.
  const f = /function dateMuselage\(brut\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(f, 'dateMuselage doit exister');
  assert.match(f[0], /replace\(" ", "T"\)\.replace\("\.", "T"\) \+ "Z"/);
  // Le profil, lui, envoie un HORODATAGE : aucun fuseau à deviner.
  assert.match(SERVEUR, /mutedUntil: \(\(\) => \{[\s\S]*?\}\)\(\),/);
  assert.match(LIGHT, /if \(typeof poserMuselage === "function"\) poserMuselage\(Number\(d\.mutedUntil\) \|\| 0\);/);
});

test('une fenêtre de salon ouverte pendant la peine naît muselée', () => {
  // Sans cela, il suffirait d'ouvrir un autre salon pour reparler.
  const f = /function brancherCadre\(c\) \{[\s\S]*?\n    \[inp, envoi, acc\]\.forEach[^\n]*\n/.exec(LIGHT);
  assert.ok(f, 'brancherCadre doit tenir compte du muselage');
  assert.match(f[0], /var muet = \(state\.mutedUntil \|\| 0\) > Date\.now\(\);/);
  assert.match(f[0], /n\.disabled = !state\.connected \|\| muet;/);
});

test('la ligne ne se répète pas à chaque message refusé', () => {
  // Le serveur renvoie CE MÊME `<bb>` chaque fois qu'un message est avalé :
  // sans garde-fou, la ligne s'écrirait à chaque touche sur « Envoyer ».
  const f = /case "bb": \{[\s\S]*?\n      \}/.exec(LIGHT);
  assert.ok(f, 'le cas bb doit exister');
  assert.match(f[0], /var mNeuf = !state\.mutedUntil \|\| mJusqua > \(state\.mutedUntil \+ 1000\);/);
  assert.match(f[0], /if \(mNeuf\) \{/);
  // Et la levée existe : `bc` (endmute) rend la parole.
  assert.match(LIGHT, /case "bc": \/\/ endmute/);
  assert.match(LIGHT, /systemLine\("Tu peux de nouveau parler\."\);/);
});

/* ── 2. LE KICK ───────────────────────────────────────────────────────────── */

test('l’expulsion vise le salon de la TRAME, pas celui qu’on regarde', () => {
  const f = /case "ag": case "ah": \{[\s\S]*?\n        break;/.exec(LIGHT);
  assert.ok(f, 'le cas ag/ah doit exister');
  assert.match(f[0], /var kOu = attr\(xml, "g"\) \|\| state\.room;/);
  assert.match(f[0], /if \(state\.usersByRoom\[kOu\]\) delete state\.usersByRoom\[kOu\]\[kWho\];/);
  // La ligne s'écrit DANS le fil de ce salon-là.
  assert.match(f[0], /systemLine\("Tu as été " \+ kVerb[^\n]*, kOu\);/);
  assert.match(f[0], /systemLine\(kWho \+ " a été " \+ kVerb[^\n]*, kOu\);/);
});

test('l’expulsé quitte vraiment le salon', () => {
  const f = /case "ag": case "ah": \{[\s\S]*?\n        break;/.exec(LIGHT);
  assert.match(f[0], /setTimeout\(function \(\) \{ sortirDuSalon\(kOu\); \}, 1200\);/,
    'on laisse la ligne s’afficher, puis on referme');
  const s = /function sortirDuSalon\(salon\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(s, 'sortirDuSalon doit exister');
  // Sur le bureau, c'est la FENÊTRE qui commande le cadre.
  assert.match(s[0], /BureauFrutiz\.fermerSalon\(salon\);/);
  assert.match(s[0], /if \(cadres\[salon\]\) \{ fermerCadreSalon\(salon\); return; \}/);
  // Sur le mobile, on repart sur un autre salon plutôt qu'un fil orphelin.
  assert.match(s[0], /if \(repli\) switchRoom\(repli\); else renderUsers\(\);/);
  // Et le bureau sait fermer une conversation par son nom.
  assert.match(JS, /fermerSalon: function \(salon\) \{ fermerFenetre\('salon:' \+ salon\); \},/);
});

/* ── 3. LE VOYANT DU FORUM ────────────────────────────────────────────────── */

test('le light écoute enfin la trame du forum', () => {
  const f = /case "ay": \{[\s\S]*?\n      \}/.exec(LIGHT);
  assert.ok(f, 'le cas ay doit exister — c’est lui qui manquait');
  assert.match(f[0], /setForumNonLus\(forumNonLus \+ 1\);/);
});

test('un sujet SUIVI se nomme, et la ligne y mène', () => {
  // `<ay/>` d'époque est un drapeau nu. Pour le mode « seulement mes sujets
  // suivis », il faut dire LEQUEL : c'est la seule façon d'être prévenu
  // utilement quand on est devant son écran (la poussée, elle, ne part que
  // pour un absent).
  const n = /function notifyForumNews\(authorUsername, suiveurs, sujet\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(n, 'notifyForumNews doit porter le sujet');
  assert.match(n[0], /const nomme = sujet && sujet\.id/);
  assert.match(n[0], /s="1" i="\$\{Number\(sujet\.id\)\}" t="\$\{escapeXml\(String\(sujet\.titre \|\| ''\)\)\}"/);
  // Un suiveur reçoit la trame NOMMÉE, les autres le drapeau nu.
  assert.match(n[0], /sendToClient\(sock, leSuit \? nomme : nu\);/);
  assert.match(SERVEUR, /notifyForumNews\(username, suiveurs, \{ id: topicId, titre: topic\.title \}\);/);
  // Et le client la rend cliquable.
  const f = /case "ay": \{[\s\S]*?\n      \}/.exec(LIGHT);
  assert.match(f[0], /if \(attr\(xml, "s"\) === "1"\) \{/);
  assert.match(f[0], /routerOuverture\("forum", null, fSujet\);/);
});

/* ── 4. LA FICHE MÈNE AU TABLEAU DES SCORES ───────────────────────────────── */

test('une ligne de score de la fiche ouvre son classement', () => {
  // Le serveur donne l'identifiant interne du classement, celui que
  // `/api/light/challenge` pose en `id` sur chaque jeu.
  // `rkId` et non `d.internal` : Burning Kiwi a six classements pour un onglet,
  // et la fiche doit lire celui du circuit du jour, comme le tableau.
  assert.match(SERVEUR, /classements\.push\(\{ titre: d\.rn, jeu: d\.g, rk: rkId,/);
  assert.match(SERVEUR, /const rkId = \/\^bkiwi_\/\.test\(d\.internal\) \? bkiwiDuJour : d\.internal;/);
  const o = /function ouvrirScoresSur\(rk, jeu\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(o, 'ouvrirScoresSur doit exister');
  assert.match(o[0], /var i = jeux\.findIndex\(function \(g\) \{ return rk && g\.id === rk; \}\);/);
  // Burning Kiwi change de circuit chaque jour : son onglet ne porte pas
  // l'identifiant du descripteur. D'où le repli par nom de JEU.
  assert.match(o[0], /if \(i < 0 && jeu\) i = jeux\.findIndex\(function \(g\) \{ return g\.game === jeu; \}\);/);
  assert.match(o[0], /activateTab\("scores"\);/);
  // On ferme LA FICHE QU'ON DESSINE, pas « la » fiche courante : depuis qu'on
  // peut en ouvrir plusieurs, elle ne sera peut-être plus la même au clic.
  assert.match(LIGHT, /var laFiche = ficheEtat;\s*\n\s*var allerAuScore = function \(\) \{ fermerFiche\(laFiche\); ouvrirScoresSur\(c\.rk, c\.jeu\); \};/);
  assert.match(LIGHT, /\.fiche-jour\.cliquable \{ cursor: pointer;/);
});

/* ── 5. L'ARBRE DES SCORES NE REJOUE PLUS SON ARRIVÉE ─────────────────────── */

test('la colonne des jeux ne se refait que si elle change', () => {
  // `cp.Tree.addPhysElement` anime une entrée quand elle est AJOUTÉE — une
  // fois, à l'ouverture. Le portage refaisait tout le HTML à chaque clic pour
  // déplacer la classe `.on`, et rejouait donc la glissade entière.
  const f = /function renderScoresListe\(\) \{[\s\S]*?\n  \}/.exec(LIGHT);
  assert.ok(f, 'renderScoresListe doit exister');
  assert.match(f[0], /var signature = jeux\.map\(function \(g\) \{ return g\.id \|\| g\.name; \}\)\.join\("\|"\);/);
  assert.match(f[0], /if \(box\.getAttribute\("data-sig"\) === signature && box\.querySelector\("\.sc-rk"\)\) \{/);
  // Le retour anticipé ne touche NI au HTML NI à l'animation : il déplace le
  // `.on` sur les boutons déjà en place.
  assert.match(f[0], /b\.classList\.toggle\("on", Number\(b\.getAttribute\("data-i"\)\) === scoresGameIdx\);/);
  assert.ok(f[0].indexOf('return;\n    }\n    box.setAttribute("data-sig"') > 0
    || /return;\s*\n\s*\}\s*\n\s*box\.setAttribute\("data-sig", signature\);/.test(f[0]),
    'la reconstruction vient APRÈS le retour anticipé');
});
