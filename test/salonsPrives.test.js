'use strict';
/*
 * CRÉER UN SALON DEPUIS LA FENÊTRE DES SALONS
 *
 * Le bouton « créer un salon » et son champ étaient là depuis le premier jour —
 * `initFrameSet` de `win.RoomList` (0xbec4d) les pose dans la marge basse — mais
 * ils étaient GRISÉS : le serveur du revival n'avait pas de `createChannel`.
 *
 * L'ordre d'époque tient en cinq lignes (`box.RoomList.createChannel`, 0xa65a5) :
 *
 *     if (n === undefined || n.length === 0) {
 *       openErrorAlert(Lang.fv("error.chat.topic_required"));
 *       return;
 *     }
 *     channelMng.create(n);
 *     this.close();
 *
 * Le salon porte donc le SUJET qu'on lui donne, et la fenêtre des salons se
 * referme derrière soi.
 *
 * CE QU'IL A DE PRIVÉ. Il n'apparaît que dans la liste de ceux qui y sont : le
 * serveur le retire du `<q>` des autres. Un salon vide n'existe donc plus pour
 * personne, et on le purge — c'est ce qui le distingue des onze permanents.
 * Pour y entrer, il faut son sujet ; le redonner à `createChannel` REJOINT le
 * salon au lieu d'en ouvrir un second. (L'époque avait un second chemin, écrit
 * dans lang_french.as : « Pour inviter un de vos contacts dans une discussion
 * privée ou un salon, il suffit de le faire glisser vers la fenêtre du chat. »)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LANG = fs.readFileSync(path.join(ROOT, 'frutiparc/lang_french.as'), 'latin1');

/* ── 1. LE SERVEUR ────────────────────────────────────────────────────────── */

test('la liste des salons n’est plus la même pour tout le monde', () => {
  // `buildChannelListXml` prend maintenant un pseudo : un salon de joueur ne
  // part QUE vers ceux qui y sont.
  assert.match(SERVEUR, /function buildChannelListXml\(username\) \{/);
  assert.match(SERVEUR,
    /if \(estSalonJoueur\(name\) && !\(username && ch\.users\.has\(username\)\)\) continue;/);
  // Et plus une seule liste diffusée telle quelle à toutes les sockets.
  assert.match(SERVEUR, /function pousserListeSalons\(\) \{[\s\S]*?buildChannelListXml\(cl && cl\.username\)/);
  assert.doesNotMatch(SERVEUR, /const listeXml = buildChannelListXml\(\);/);
});

test('la clé se dérive du sujet, accents rabattus', () => {
  assert.match(SERVEUR, /const SALON_JOUEUR = 'sal_';/);
  assert.match(SERVEUR, /function cleSalonJoueur\(sujet\) \{/);
  assert.match(SERVEUR, /normalize\('NFD'\)/);
  assert.match(SERVEUR, /replace\(\/\[\^a-z0-9\]\+\/g, '-'\)/);
  // Le préfixe ne peut heurter ni les onze permanents ni les privés `pm_`.
  const fixes = SERVEUR.slice(SERVEUR.indexOf('const channels = {'), SERVEUR.indexOf('// ── Reconnect grace'));
  for (const m of fixes.matchAll(/^\s{2}([a-z]+):\s+\{ desc:/gm)) {
    assert.ok(m[1].indexOf('sal_') !== 0, 'collision avec le salon ' + m[1]);
  }
});

test('un sujet déjà pris fait ENTRER, il ne crée pas de doublon', () => {
  const bloc = SERVEUR.slice(SERVEUR.indexOf("case 'createChannel': {"), SERVEUR.indexOf("case 'join': {"));
  assert.ok(bloc, 'le handler createChannel manque');
  assert.match(bloc, /if \(channels\[cle\]\) \{[\s\S]*?rep\(`g="\$\{escapeXml\(cle\)\}" d="\$\{escapeXml\(channels\[cle\]\.desc \|\| sujet\)\}"`\);/);
  // Le sujet vide est refusé côté serveur AUSSI — le client peut mentir.
  assert.match(bloc, /if \(!sujet\) \{ rep\('k="1" e="Vous devez spécifier un sujet pour créer un salon\."'\); break; \}/);
  // Un compte banni des salons publics l'est aussi de ceux qu'on improvise.
  assert.match(bloc, /const ban = getBanInfoForUser\(client\.username\);/);
  // Et le nombre de salons ouverts est borné.
  assert.match(bloc, /if \(ouverts >= 200\)/);
});

test('un salon de joueur vide disparaît', () => {
  assert.match(SERVEUR, /function purgerSalonJoueur\(nom\) \{[\s\S]*?if \(vivants\.length === 0\) delete channels\[nom\];/);
  // Les deux départs : le `leave` explicite et la fin de la grâce de reconnexion.
  assert.match(SERVEUR, /if \(estSalonJoueur\(g\)\) \{ purgerSalonJoueur\(g\); pousserListeSalons\(\); \}/);
  assert.match(SERVEUR, /if \(estSalonJoueur\(g\)\) purgerSalonJoueur\(g\);/);
  // Un PNJ ne compte pas comme occupant : Gaspard ne maintient pas un salon en vie.
  assert.match(SERVEUR, /const vivants = \[\.\.\.ch\.users\]\.filter\(u => !NPC_USERNAMES\.has\(u\)\);/);
});

/* ── 2. LE LIGHT ──────────────────────────────────────────────────────────── */

test('le light range les salons de joueur après les onze permanents', () => {
  assert.match(LIGHT, /salonsJoueurs: \{\}, \/\/ id "sal_…" -> \{ nom, nbUser \}/);
  // `pv="1"` : le marqueur du serveur. Sa seule présence dit qu'on en fait partie.
  assert.match(LIGHT, /if \(attr\(gattr, "pv"\) === "1"\) vus\[gid\] = true;/);
  // Ce qui a quitté le `<q>` a disparu pour de bon.
  assert.match(LIGHT, /if \(!vus\[id\]\) delete state\.salonsJoueurs\[id\];/);
  assert.match(LIGHT, /l\.push\(\{ id: id, nom: roomLabel\(id\), nbUser: state\.roomCounts\[id\] \|\| 0, joueur: true \}\);/);
});

test('le sujet canonique revient avec la réponse, avant le prochain <q>', () => {
  // Sans lui, la phrase d'entrée sortirait avec la clé brute — et le second
  // arrivant nommerait le salon avec SA casse.
  assert.match(LIGHT, /var lab = attr\(xml, "d"\);/);
  assert.match(LIGHT, /if \(lab\) state\.roomLabels\[attr\(xml, "g"\)\] = xmlUnescape\(lab\);/);
  // Et le `<desc>` du join fait pareil, pour tous les autres chemins.
  assert.match(LIGHT, /if \(og && od\) state\.roomLabels\[og\] = xmlUnescape\(od\[1\]\);/);
});

test('la demande porte un identifiant, et n’attend pas indéfiniment', () => {
  assert.match(LIGHT, /var creerSalonEnCours = \{\};/);
  assert.match(LIGHT, /wsSend\('<createChannel r="' \+ r \+ '" n="' \+ xmlEscape\(n\) \+ '" \/>'\);/);
  assert.match(LIGHT, /ko\(new Error\("Le serveur n'a pas répondu\."\)\);/);
});

/* ── 3. LA FENÊTRE ────────────────────────────────────────────────────────── */

test('le bouton et le champ ne sont plus grisés', () => {
  const bloc = JS.slice(JS.indexOf('function panneauSalons'), JS.indexOf('function majSalons'));
  assert.doesNotMatch(bloc, /creer\.disabled = true;\s*\n\s*creer\.title/);
  assert.doesNotMatch(bloc, /nom\.disabled = true;/);
  assert.match(bloc, /creer\.addEventListener\('click', lancerCreation\);/);
  // Entrée vaut le clic — c'est un champ de saisie, pas un formulaire.
  assert.match(bloc, /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); lancerCreation\(\); \}/);
});

test('l’ordre d’époque est suivi : sujet vide → alerte, sinon créer puis fermer', () => {
  const bloc = JS.slice(JS.indexOf('var lancerCreation'), JS.indexOf("creer.addEventListener('click'"));
  assert.match(bloc, /alerte\('Impossible de créer ce salon : ',\s*\n\s*'Vous devez spécifier un sujet pour créer un salon\.'\);/);
  assert.match(bloc, /S\.creer\(sujet\)\.then\(/);
  assert.match(bloc, /fermerFenetre\('salons-panel'\);/);
  // Les deux phrases sont celles de lang_french.as, au mot près.
  assert.ok(LANG.includes('Impossible de cr'), 'error.chat.create_channel manque au lang');
  assert.match(LANG, /error\.chat\.topic_required = "Vous devez sp.cifier un sujet pour cr.er un salon\."/);
});

test('win.Alert : deux cadres, un bouton « Fermer », au milieu', () => {
  // `initFrameSet` de sprite#812 : frameDoc min 200 × 80, frameButton 200 × 24.
  assert.match(JS, /min: minFenetre\(200, 80 \+ 24\), centre: true, fixe: true,/);
  assert.match(JS, /ok\.textContent = 'Fermer';/);
  assert.match(LANG, /_global\.langText\.close = "Fermer";/);
  // Le style `frSystem` est blanc, pas vert — ce n'est pas une feuille.
  assert.match(CSS, /\.fb-alerte-doc \{[\s\S]*?background: #FFFFFF;/);
  assert.match(CSS, /body\.bureau-frutiz \.fb-alerte-panneau \{ display: none; \}/);
});
