/*
 * TROIS FINITIONS RELEVÉES SUR LE SWF — l'encre du pseudo, la poignée du coin,
 * la phrase qu'on lit en entrant.
 *
 * 1. LE PSEUDO PREND LA COULEUR DU GENRE. Ce n'est pas une option qu'un
 *    composant demanderait : `UserSlot.init` (0x6352f) pose
 *    `displayType = "gender"` PAR DÉFAUT, et `onInfoBasic` (0x63a51) câble
 *    alors sur le champ un `setBehavior` de type « colorText » à trois états.
 *    Le genre voyage dans l'attribut `sx` (`UserMng.formatInfoBasic`, 0x2680f).
 *
 * 2. LA POIGNÉE. Deux clips à ne pas confondre : la ZONE SENSIBLE (`transp`,
 *    un bouton de 100 × 100 mis à 30 %, posé à `pos.w − 20, pos.h − 20`) et le
 *    DESSIN, qui n'existe qu'au survol — `startResizeAnim` (0x568c1) le crée,
 *    `removeResizeArrow` le retire.
 *
 * 3. LA PHRASE D'ENTRÉE. `frutiparc/lang_french.as`, la table d'époque, est
 *    dans le dépôt : `chat.onjoin` et ses voisines, italiques comprises.
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
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LANG = fs.readFileSync(path.join(ROOT, 'frutiparc/lang_french.as'), 'latin1');

/* ── 1. L'ENCRE DU GENRE ──────────────────────────────────────────────── */

test('les six teintes du genre, telles que le bytecode les écrit', () => {
  // 0x63aad : base 2367849 · over 3031729 · press 5663155
  assert.strictEqual((2367849).toString(16).toUpperCase(), '242169');
  assert.strictEqual((3031729).toString(16).toUpperCase(), '2E42B1');
  assert.strictEqual((5663155).toString(16).toUpperCase(), '5669B3');
  // 0x63ae4 : base 12272708 · over 15168885 · press 16690091
  assert.strictEqual((12272708).toString(16).toUpperCase(), 'BB4444');
  assert.strictEqual((15168885).toString(16).toUpperCase(), 'E77575');
  assert.strictEqual((16690091).toString(16).toUpperCase(), 'FEABAB');
  // Les trois du rouge sont la famille `pink` de `_global.colorSet`
  // (frutiparc/global.as) : darker, dark, shade. Rien n'est inventé.
  const GLOBAL = fs.readFileSync(path.join(ROOT, 'frutiparc/global.as'), 'latin1');
  const pink = GLOBAL.slice(GLOBAL.indexOf('pink:{'), GLOBAL.indexOf('yellow:{'));
  assert.match(pink, /shade:\s*0xFEABAB/);
  assert.match(pink, /dark:\s*0xE77575/);
  assert.match(pink, /darker:\s*0xBB4444/);
});

test('le pseudo se teinte au genre, dans la liste comme au carnet', () => {
  // Les six règles, et l'attribut qui les déclenche.
  assert.match(LIGHT, /\.u\[data-genre="M"\] \.nom, \.sl-contact\[data-genre="M"\] \.nom \{ color: #242169; \}/);
  assert.match(LIGHT, /\.u\[data-genre="F"\] \.nom, \.sl-contact\[data-genre="F"\] \.nom \{ color: #BB4444; \}/);
  assert.match(LIGHT, /\.u\.mp\[data-genre="M"\]:hover \.nom,[^\n]*\{ color: #2E42B1; \}/);
  assert.match(LIGHT, /\.u\.mp\[data-genre="M"\]:active \.nom,[^\n]*\{ color: #5669B3; \}/);
  assert.match(LIGHT, /\.u\.mp\[data-genre="F"\]:hover \.nom,[^\n]*\{ color: #E77575; \}/);
  assert.match(LIGHT, /\.u\.mp\[data-genre="F"\]:active \.nom,[^\n]*\{ color: #FEABAB; \}/);
  // Le genre vient de `sx`, que le serveur envoie déjà dans chaque <u>.
  assert.match(LIGHT, /var sx = String\(attr\(frag, "sx"\) \|\| ""\)\.toUpperCase\(\);/);
  assert.match(LIGHT, /genre: sx === "F" \? "F" : \(sx === "M" \? "M" : ""\),/);
  assert.match(SERVEUR, /sx="\$\{ud\.gender \|\| 'M'\}"/);
  assert.match(LIGHT, /if \(gi && gi\.genre\) u\.setAttribute\("data-genre", gi\.genre\);/);
  // Le carnet de contacts est le MÊME `userSlot` : le serveur lui donne le
  // genre, la bande le pose.
  assert.match(SERVEUR, /if \(compte && compte\.gender\) o\.genre = String\(compte\.gender\)\.toUpperCase\(\) === 'F' \? 'F' : 'M';/);
  assert.match(JS, /if \(c\.genre\) b\.setAttribute\('data-genre', c\.genre\);/);
});

test('le comportement par défaut ne vaut plus quand le genre est connu', () => {
  // `onInfoBasic` ÉCRASE le `getButTextBasicBehavior` générique : les règles
  // roses du survol ne doivent plus s'appliquer aux lignes qui portent un
  // genre, sans quoi elles gagneraient par spécificité.
  assert.match(CSS, /#side-list \.sl-contact:not\(\[data-genre\]\):hover \.nom \{ color: #E7756B; \}/);
  // La règle est désormais COMMUNE au salon et à la fenêtre de Gaspard :
  // `cp.UserList` monte le même `userSlot` dans les deux.
  assert.match(CSS, /#users-drawer \.u:not\(\[data-genre\]\):hover span:not\(\.badge\),\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u:not\(\[data-genre\]\):hover span:not\(\.badge\) \{ color: #E7756B; \}/);
});

/* ── 2. LA POIGNÉE ────────────────────────────────────────────────────── */

test('la zone sensible est le carré de 30 qui déborde du coin', () => {
  // `transp` (100 × 100) à `_xscale = 30`, posé à `pos.w − 20, pos.h − 20` :
  // 20 px avant le coin, 10 px au-delà. Le −11 compense le liseré de 1 px,
  // qui décale la boîte de remplissage.
  assert.match(CSS, /\.fen-poignee \{[\s\S]*?right: -11px; bottom: -11px; width: 30px; height: 30px;/);
  assert.match(CSS, /\.fen-poignee \{[\s\S]*?background: none;/);
  assert.match(JS, /var POIGNEE_ANCRE = 20;/);
});

test('la pastille naît au survol, centrée sur le coin, et repart', () => {
  // Les trois cercles de `startResizeAnim`, avec s = 18 : outline Ø s+2,
  // shade Ø s, main Ø s−4, tous centrés en (−9, −9) du clip.
  assert.match(JS, /var POIGNEE_S = 18;/);
  assert.match(CSS, /\.pv-anneau \{\s*\n\s*left: -19px; top: -19px; width: 20px; height: 20px; background: #444444;/);
  assert.match(CSS, /\.pv-ombre \{\s*\n\s*left: -18px; top: -18px; width: 18px; height: 18px; background: #DDDDDD;/);
  assert.match(CSS, /\.pv-chair \{\s*\n\s*left: -16px; top: -16px; width: 14px; height: 14px; background: #FFFFFF;/);
  assert.match(CSS, /\.pv-icone \{[\s\S]*?left: -15px; top: -15px; width: 12px; height: 12px;/);
  // `transform-origin: 0 0` : Flash met à l'échelle autour de l'origine du
  // clip, pas de son centre.
  assert.match(CSS, /\.fen-poignee-vue \{[\s\S]*?transform-origin: 0 0;/);
  // Les deux cibles, et les deux ratios : entrée (w + s/2, h + s/2) à 100 avec
  // addSlide ratio 2 ; sortie (w − 20, h − 20) à 0 avec ratio 1. L'échelle
  // suit toujours addResize, ratio 1.
  assert.match(JS, /\? \{ x: pos\.w \+ POIGNEE_S \/ 2, y: pos\.h \+ POIGNEE_S \/ 2, e: 100 \}/);
  assert.match(JS, /: \{ x: pos\.w - POIGNEE_ANCRE, y: pos\.h - POIGNEE_ANCRE, e: 0 \}/);
  assert.match(JS, /var kMouv = Math\.pow\(GLISSE_K, entrante \? 2 : 1\);/);
  assert.match(JS, /reg\.e = reg\.e \* GLISSE_K \+ cible\.e \* \(1 - GLISSE_K\);/);
  // Le départ : (w − s, h − s) à l'échelle 0.
  assert.match(JS, /fen\._poigneeReg = \{ x: pos\.w - POIGNEE_S, y: pos\.h - POIGNEE_S, e: 0 \};/);
  // `removeResizeArrow` : au repos, le dessin n'existe pas.
  assert.match(JS, /fen\._poigneeVue\.remove\(\); fen\._poigneeVue = null; fen\._poigneeReg = null;/);
  // `initTabMode` (0x5463f) cache la poignée d'une fenêtre en onglet.
  assert.match(CSS, /\.fen\.fen-en-onglet > \.fen-poignee,\s*\nbody\.bureau-frutiz \.fen\.fen-en-onglet > \.fen-poignee-vue \{ display: none; \}/);
});

/* ── 3. LA PHRASE D'ENTRÉE ────────────────────────────────────────────── */

test('les phrases sont celles de lang_french.as, au mot près', () => {
  // La table d'époque est dans le dépôt : on lit la source, on ne devine pas.
  assert.match(LANG, /chat\.onjoin = "<i>Vous discutez maintenant sur le salon \$t<\/i>"/);
  assert.match(LANG, /chat\.initprivate = "<i>Vous pouvez desormais discuter avec \$u\.<\/i>"/);
  assert.match(LANG, /chat\.userjoined = "<i>\$u a rejoint le salon<\/i>"/);
  assert.match(LANG, /chat\.privatedcnx = "<i>\$u a quitt. la discussion<\/i>"/);

  // Et le portage les recopie — « desormais » sans accent compris, c'est le
  // texte qu'ont lu les joueurs.
  assert.match(LIGHT, /return conv\s*\n\s*\? "Vous pouvez desormais discuter avec " \+ conv\.avec \+ "\."\s*\n\s*: "Vous discutez maintenant sur le salon " \+ roomLabel\(room\);/);
  assert.match(LIGHT, /systemLine\(uj \+ \(estPrive\(rj\) \? " est là\." : " a rejoint le salon"\), rj\);/);
  assert.match(LIGHT, /systemLine\(ul \+ \(estPrive\(rl\) \? " a quitté la discussion" : " a quitté le salon"\), rl\);/);
  // Plus de « — Salon Citron — », qui n'était de nulle part.
  assert.doesNotMatch(LIGHT, /systemLine\("— " \+/);
  // Les lignes système sont en italique, comme les <i> de la table.
  assert.match(LIGHT, /\.msg\.system \{ color: #6b8a3f; font-style: italic;/);
});

test('la phrase revient à CHAQUE entrée, reconnexion comprise', () => {
  // `box.Chat.onJoin` (0x2e3a9) pose `chat.onjoin` à chaque join. Le fil vidé
  // avant le rejeu du serveur doit donc la retrouver.
  assert.match(LIGHT, /systemLine\(phraseEntree\(state\.room\), aSonJournal\(state\.room\) \? state\.room : undefined\);/);
  assert.match(LIGHT, /clearMessages\(sn\);\s*\n\s*systemLine\(phraseEntree\(sn\), sn\);\s*\n\s*rejoindreSalon\(sn\);/);
});
