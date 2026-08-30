/*
 * UNE FENÊTRE PAR SALON.
 *
 * Le bureau d'époque n'a pas de « fenêtre des salons » unique où les
 * conversations défileraient tour à tour. `box.Chat` est une instance PAR
 * SALON — le bytecode de main.swf le dit deux fois dans le même `init` :
 *
 *     cmode == "private"  →  chatMng.setBox(this.user, this)      (0x29fdc)
 *     cmode == "channel"  →  channelMng.pushUniq(this.group)      (0x2a065)
 *
 * — et `Slot.addBox` (0x35c98) range les boîtes d'un slot dans une LISTE, pas
 * dans un emplacement unique. On en ouvre donc autant qu'on veut, et rejoindre
 * un salon n'en ferme aucune.
 *
 * La fermeture suit la même partition. `box.Chat.close` (0x2a11a) commence par
 * `this.part()` — AVANT le test `cmode == "private"` : fermer la fenêtre d'une
 * conversation, c'est quitter le salon, privé compris. Vient ensuite le
 * rangement : `chatMng.unsetBox(this.user)` (0x2a188) ou `channelMng.rm(
 * this.group)` (0x2a1dc).
 *
 * Et l'invitation reçue ne s'impose pas : `chatMng.onInvite` (0x8d840) appelle
 * `chatMng.open(p, g, u, trashSlot)` (0x8d599) — le quatrième argument est le
 * SLOT D'ATTENTE. La conversation existe, elle a sa fenêtre, mais c'est
 * l'onglet qui prévient (`box.Chat.onSend` → `this.slot.warning()`).
 *
 * LE MOBILE NE BOUGE PAS : un fil, un sélecteur de salon, une conversation à
 * la fois. Tout ce qui suit ne vaut que sur le bureau.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('le bureau n’a plus UNE fenêtre de salon, mais une rubrique par salon', () => {
  // La rubrique « chat » n'existe plus : une fenêtre unique ne pourrait pas
  // porter deux conversations.
  assert.doesNotMatch(JS, /^\s*chat:\s*\{ panneau: '#chat-panel'/m);
  // C'est `ouvrirSalon` qui bâtit la rubrique, sous la clé « salon:<id> » —
  // le même procédé que « dossier:<uid> » pour les dossiers du bureau.
  assert.match(JS, /RUBRIQUES\[cle\] = \{\s*\n\s*panneau: '\[data-salon="'/);
  assert.match(JS, /var cle = 'salon:' \+ salon;/);
  // Et tout chemin qui menait à « le salon » y passe.
  assert.match(JS, /if \(tab === 'chat'\) return ouvrirSalon\(salonCourant\(\)\);/);
  assert.match(JS, /ouvrirSalon: ouvrirSalon,/);
});

test('la fenêtre se désigne par sa CLÉ : les panneaux de salon sont des copies', () => {
  // Toutes les copies portent id="chat-panel" (la feuille de style du chat est
  // écrite en « # » d'un bout à l'autre) : `fenetres` ne peut donc plus être
  // indexé par l'identifiant du panneau.
  assert.match(JS, /var cle = rub\.cle \|\| panneau\.id;\s*\n\s*var f = fenetres\[cle\];/);
  assert.match(JS, /f = creerFenetre\(rub, panneau, cle\);\s*\n\s*fenetres\[cle\] = f;/);
  assert.match(JS, /function creerFenetre\(rub, panneau, cle\) \{/);
  // Le light garde les identifiants dans la copie, ET s'appuie sur le fait que
  // `querySelector` rend le PREMIER nœud du document — donc toujours le
  // panneau mobile d'origine.
  assert.match(LIGHT, /var p = \$\("#chat-panel"\)\.cloneNode\(true\);\s*\n\s*p\.setAttribute\("data-salon", salon\);/);
  assert.match(LIGHT, /function dansCadre\(c, id\) \{ return c\.panneau\.querySelector\("#" \+ id\); \}/);
});

test('chaque salon a SON fil, et les lignes vont dans le fil de LEUR salon', () => {
  assert.match(LIGHT, /var journaux = \{\};/);
  assert.match(LIGHT, /function journalDe\(salon\) \{\s*\n\s*return \(salon && journaux\[salon\]\) \|\| msgEl;/);
  assert.match(LIGHT, /journaux\[salon\] = c\.fil;/);
  // Le tri du gestionnaire <t> : un salon qui a SON fil ne s'arrête plus au
  // compteur de non-lus, sa ligne tombe chez lui.
  assert.match(LIGHT, /if \(salon && salon !== state\.room && !aSonJournal\(salon\)\) \{/);
  // Et chaque rendu porte son salon.
  const t = LIGHT.indexOf('case "t":');
  const bloc = LIGHT.slice(t, LIGHT.indexOf('case "r":', t));
  assert.match(bloc, /addEmoteMessage\(\{ from: emWho, time: h, label: emLabel, salon: salon \}\);/);
  assert.match(bloc, /showBouilleOverlay\(from, em\.anim, em\.label, salon\);/);
  // (`mentions` a rejoint la ligne avec les @mentions : le corps met en évidence
  // les pseudos que le serveur a reconnus, et le salon reste porté par `salon`.)
  assert.match(bloc, /kind: isAdmin \? "admin" : "normal", noFrom: isAdmin, pen: penColor, salon: salon, mentions: nommes \}\);/);
  // Les arrivées et les départs aussi : chaque fenêtre tient le compte de ses
  // propres allées et venues.
  // (Les mots sont ceux de `chat.userjoined`, sans point final — cf.
  // finitionsFenetre.test.js.)
  assert.match(LIGHT, /if \(rj === state\.room \|\| aSonJournal\(rj\)\) \{[\s\S]*?systemLine\(uj \+ \(estPrive\(rj\) \? " est là\." : " a rejoint le salon"\), rj\);/);
  assert.match(LIGHT, /if \(rl === state\.room \|\| aSonJournal\(rl\)\) \{/);
});

test('rejoindre un salon n’en ferme aucun autre', () => {
  // `switchRoom` ne quitte PAS un salon qui garde sa fenêtre : elle continue
  // de vivre, elle doit continuer de recevoir.
  assert.match(LIGHT, /if \(state\.room && state\.room !== room && !estPrive\(state\.room\) && !aSonJournal\(state\.room\)\) \{\s*\n\s*wsSend\('<y g="'/);
  // Et la liste « Salons publics » se contente d'ouvrir : plus de bascule.
  assert.match(JS, /b\.addEventListener\('click', function \(\) \{ pont\.rejoindre\(s\.id\); \}\);/);
  assert.match(LIGHT, /rejoindre: function \(id\) \{ ouvrirSalon\(id\); \},/);
});

test('fermer la fenêtre d’une conversation, c’est QUITTER le salon', () => {
  // `box.Chat.close` : `this.part()` d'abord, pour les deux modes.
  assert.match(JS, /if \(f\.salon\) \{\s*\n\s*delete RUBRIQUES\[idPanneau\];\s*\n\s*if \(window\.SalonsBureau && SalonsBureau\.fermerCadre\) SalonsBureau\.fermerCadre\(f\.salon\);/);
  assert.match(LIGHT, /function fermerCadreSalon\(salon\) \{[\s\S]*?wsSend\('<y g="' \+ xmlEscape\(salon\) \+ '" \/>'\);/);
  assert.match(LIGHT, /if \(estPrive\(salon\)\) delete state\.prives\[salon\];/);
  // Le salon « regardé » part avec sa fenêtre.
  assert.match(LIGHT, /if \(state\.room === salon\) \{\s*\n\s*var reste = cadresOuverts\(\);/);
});

test('une invitation privée ouvre sa fenêtre, mais RANGÉE', () => {
  // `chatMng.open(p, g, u, trashSlot)` : la conversation existe, l'onglet
  // clignote, le bureau ne bouge pas.
  assert.match(JS, /function ouvrirSalon\(salon, enFond\) \{/);
  assert.match(JS, /if \(f && neuve && !f\.onglet\) mettreEnOnglet\(cle, false\);\s*\n\s*if \(f\) avertirSlot\(f\.onglet \|\| 'bureau'\);/);
  assert.match(JS, /ouvrirSalonEnFond: function \(salon\) \{ ouvrirSalon\(salon, true\); \},/);
  const s = LIGHT.indexOf('case "s":');
  const bloc = LIGHT.slice(s, LIGHT.indexOf('case "ax":', s));
  assert.match(bloc, /BureauFrutiz\.ouvrirSalonEnFond\(idInvite\);/);
  // Le mobile, lui, garde son message : il ne bascule pas de force.
  assert.match(bloc, /if \(!dejaLa\) systemLine\(deQui \+ " t'écrit en privé/);
});

test('chaque fenêtre a SA colonne d’icônes, SES connectés, SA colonne de bouilles', () => {
  // La copie emporte la barre d'icônes — sans le retour à l'accueil ni le
  // menu déroulant des salons : une fenêtre d'époque est liée À SON salon.
  assert.match(LIGHT, /var barre = \$\("#topbar"\)\.cloneNode\(true\);/);
  assert.match(LIGHT, /\["#menu-btn", "#room-select"\]\.forEach\(function \(s\) \{/);
  // Le bureau n'y ajoute que son quatrième bouton (`chat_warning`).
  assert.match(JS, /if \(topbar && !topbar\.querySelector\('#chat-warning'\)\) topbar\.appendChild\(warningSalon\(\)\);/);
  // Et tout ce qui lisait « le » panneau du chat lit désormais LE panneau
  // qu'on lui donne.
  assert.match(JS, /function minSalon\(p\) \{/);
  assert.match(JS, /function ecranDe\(pseudo, panneau\) \{/);
  assert.match(JS, /function majBouilles\(panneau\) \{/);
  assert.match(JS, /function majListeConnectes\(panneau\) \{/);
  assert.match(JS, /function membresDuPanneau\(panneau\) \{/);
  // Sans panneau nommé, on passe sur TOUTES les conversations ouvertes.
  assert.match(JS, /for \(var cle in fenetres\) if \(fenetres\[cle\]\.salon\) majBouilles\(fenetres\[cle\]\.panneau\);/);
  // Côté light, la liste des connectés d'un cadre suit SON salon.
  assert.match(LIGHT, /membresDuSalon\(c\.salon\)\.forEach\(function \(n\) \{/);
  assert.match(LIGHT, /membresDe: function \(id\) \{/);
  // La fenêtre du salon s'ouvre SANS ses connectés : `win.Chat.init` (0x6915f)
  // ferme ses trois panneaux avant même d'appeler `win.Dialog.init`. La liste
  // est REMPLIE mais REFERMÉE — le bouton la montre, et la fenêtre grandit
  // alors d'elle-même (cf. test/salonEtroit.test.js).
  assert.match(LIGHT, /ouvrirTiroir\(false\);\s*\n\s*majConnectesCadre\(c\);\s*\n\s*\}/);
});

test('deux conversations peuvent jouer deux émotions à la fois', () => {
  // Un lecteur par cadre : `c.canvas`, `c.timer`. Sans cela, deux fenêtres se
  // disputeraient le même canevas.
  assert.match(LIGHT, /function overlayIframe\(c, etat\) \{\s*\n\s*var courant = c \? c\.canvas : overlayCanvas;/);
  assert.match(LIGHT, /function overlayMinuteur\(c, fn\) \{/);
  assert.match(LIGHT, /function showBouilleOverlay\(pseudo, anim, labelOverride, salon\) \{/);
  assert.match(LIGHT, /BureauFrutiz\.ecranDe\(pseudo, c \? c\.panneau : null\)/);
  // Et la scène rendue retourne dans la colonne de SA fenêtre.
  assert.match(JS, /var col = ecran\.closest \? ecran\.closest\('#bouille-overlay'\) : null;/);
  // L'écran qui joue n'efface que sa VIGNETTE FIGÉE — son enfant direct. Sans
  // le « > », le lecteur (un canevas, lui aussi, depuis le portage JS des
  // bouilles) disparaissait avec elle et l'écran restait blanc quatre
  // secondes durant.
  assert.match(CSS, /\.bo-anime > img,\s*\n[^\n]*\.bo-anime > canvas \{ visibility: hidden !important; \}/);
});

test('le feutre reste celui du JOUEUR, pas celui d’une fenêtre', () => {
  // `selectPen` (0x821f4) écrit dans `PenMng.current`, un seul pour la
  // session : le choix se répercute sur toutes les barres et toutes les
  // saisies ouvertes.
  assert.match(LIGHT, /Array\.prototype\.forEach\.call\(document\.querySelectorAll\("#pen-bar \.pen-swatch"\)/);
  assert.match(LIGHT, /Array\.prototype\.forEach\.call\(document\.querySelectorAll\("#compose-input"\), function \(inp\) \{/);
  // La connexion (et la coupure) touche toutes les saisies.
  assert.match(LIGHT, /\["#compose-input", "#compose-send", "#accent-toggle"\]\.forEach\(function \(sel\) \{/);
});

test('après une coupure, chaque fenêtre reprend sa place', () => {
  // Le serveur a oublié les abonnements : on les refait un à un, et l'on vide
  // les fils avant le rejeu pour ne pas lire deux fois la même chose.
  // Le fil vidé retrouve sa phrase d'entrée : `onJoin` la pose à CHAQUE join.
  assert.match(LIGHT, /cadresOuverts\(\)\.forEach\(function \(sn\) \{\s*\n\s*if \(sn === state\.room \|\| refaits\[sn\]\) return;\s*\n\s*clearMessages\(sn\);\s*\n\s*systemLine\(phraseEntree\(sn\), sn\);\s*\n\s*rejoindreSalon\(sn\);/);
  assert.match(LIGHT, /clearMessages\(aSonJournal\(state\.room\) \? state\.room : undefined\);/);
});

test('le mobile n’a pas changé : un fil, un sélecteur, une conversation', () => {
  // Aucun cadre n'existe sans le bureau — `creerCadreSalon` n'est appelé que
  // par le pont, et le pont n'est sollicité que par bureau-frutiz.js.
  const appels = LIGHT.match(/creerCadreSalon\(/g) || [];
  assert.strictEqual(appels.length, 2);           // la définition + l'appel du pont
  assert.match(LIGHT, /cadre: function \(id\) \{\s*\n\s*var c = creerCadreSalon\(id\);/);
  // `ouvrirSalon` retombe sur `switchRoom` dès que le bureau n'est pas là.
  assert.match(LIGHT, /function ouvrirSalon\(room\) \{[\s\S]*?BureauFrutiz\.ouvrirSalon\(room\);[\s\S]*?switchRoom\(room\);/);
  // Et le panneau d'origine garde ses identifiants : c'est lui que
  // `$("#…")` rend, puisqu'il vient en tête du document.
  assert.match(LIGHT, /<section class="panel" id="chat-panel"/);
});

test('la fiche ne flotte plus au-dessus du bureau quand elle est fermée', () => {
  // Le voile du mobile devient une couche transparente sur le bureau — mais
  // il reste commandé par `.show`, comme partout ailleurs. Sans ça, une fiche
  // vide couvrait en permanence le coin gauche du bureau, colonne d'icônes de
  // la conversation comprise.
  assert.match(CSS, /body\.bureau-frutiz #fiche-backdrop \{[\s\S]*?display: none; background: none;/);
  assert.match(CSS, /body\.bureau-frutiz #fiche-backdrop\.show \{ display: block; \}/);
});
