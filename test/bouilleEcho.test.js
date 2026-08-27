'use strict';
/*
 * MA PROPRE BOUILLE NE ME REVENAIT JAMAIS.
 *
 * Symptôme : on change d'accessoire (ou d'humeur) alors qu'une fenêtre de salon
 * est déjà ouverte, et la colonne d'écrans n'en sait rien. Pire, si l'on parle
 * ensuite, l'ANIMATION montre le bon accessoire — elle lit le cache — puis la
 * vignette figée reprend sa place à la fin, avec l'ancien. Quatre secondes de
 * vérité, et le mensonge revient.
 *
 * TROIS TROUS, LE MÊME FIL.
 *
 * 1. L'ACCUSÉ N'ÉTAIT PAS ÉCOUTÉ. Le serveur diffuse bien la trace `<z>` à tout
 *    le salon — mais `broadcastToChannel(ch, traceXml, socket)` en EXCLUT
 *    l'expéditeur, et lui renvoie à la place un accusé SANS PSEUDO :
 *    `<ae f="…"/>` pour la bouille, `<af s="…"/>` pour le statut. C'est ce que
 *    le SWF attend, et `MeMng` le traite en deux lignes (0x227e4 et 0x228d6) :
 *
 *        onStatus = function (node) {
 *          if (node.attributes.u === undefined
 *              && node.attributes.s !== undefined) {
 *            node.attributes.u = me.name;   ← l'accusé, c'est MOI
 *            this.onTrace(node);            ← et il repart en trace ordinaire
 *          }
 *        };
 *        onFbouille = function (node) {
 *          if (node.attributes.u === undefined) {
 *            node.attributes.u = me.name; this.onTrace(node);
 *          }
 *        };
 *
 *    Le light n'avait ni `case "ae"` ni `case "af"` : les deux trames tombaient
 *    dans le vide.
 *
 * 2. L'AQUARIUM NE SE REPEIGNAIT PAS. La fenêtre de conversation s'ouvre à
 *    220 px : `cp.ScreenList` y bascule en CLB (un seul écran pour tous) dès
 *    qu'on est deux. Or `bouilleUnique` ne faisait que RETAILLER les bulles.
 *
 * 3. LA VIGNETTE FIGÉE DATAIT. `showBouilleOverlay` demande son écran à
 *    `ecranDe`, y déménage la scène, puis la retire au bout de 4,2 s — l'état
 *    figé qui reparaît est celui du dernier `poserBouille`.
 *
 * CE QUE DIT L'ÉPOQUE, ET OÙ ON S'EN ÉCARTE. En MULTI, l'écran est INSCRIT
 * auprès de son propriétaire (`attachFrutiScreen`, 0xb646f → `userList.defineMc`
 * → `UserMng.User.setMc`, 0x268d0). Un statut qui change fait parcourir ce
 * `mcList` à `User.onStatusObj` (0x26a28), qui appelle `mc.onInfoBasic(o)` ;
 * `frutiScreen.onInfoBasic` (0x62226) renvoie sur `onStatusObj` (0x620fe), qui
 * refait la bouille SUR PLACE : `last.apply(o.fbouille)` puis
 * `last.applyEmote(o.status.emote)`. L'aquarium, lui, n'est inscrit nulle part
 * (`attachCLBScreen`, 0xb6717, ne pose qu'un `addUserActionListener`) : d'époque
 * une bouille déjà entrée gardait son accessoire jusqu'à ce qu'elle reparte.
 * On applique la règle des écrans nominatifs à l'aquarium aussi — sans quoi la
 * fenêtre étroite, celle qui s'ouvre à la connexion, ne montrerait jamais rien.
 *
 * MESURÉ AU BANC (Chromium, un salon vrai, la socket vraie) : en MULTI comme en
 * CLB, `data-bouille` suit l'accessoire et `data-humeur` l'émote, à l'ouverture
 * comme après une prise de parole, et sans qu'on ait à reparler.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

/* ── 1. L'ACCUSÉ, C'EST MOI ───────────────────────────────────────────────── */

test('le serveur m’exclut de ma propre trace et me répond par un accusé', () => {
  // `fbouille` : la trace part à tout le monde SAUF à la socket qui l'a émise…
  assert.match(SERVEUR, /broadcastToChannel\(chanName, traceXml, socket\);/);
  // …et l'expéditeur reçoit, lui, un accusé sans pseudo.
  assert.match(SERVEUR, /sendToClient\(socket, `<\$\{CMD\.fbouille\} f="\$\{f\}" \/>`\);/);
  // `status` : même chose, avec `s=`.
  assert.match(SERVEUR, /sendToClient\(socket, `<\$\{CMD\.status\} s="\$\{s\}" \/>`\);/);
  assert.match(SERVEUR, /broadcastToChannel\(ch, traceXml, socket\);/);
  // Les deux codes courts, tels que le light les lit.
  assert.match(SERVEUR, /fbouille: +'ae',/);
  assert.match(SERVEUR, /status: +'af',/);
});

test('le light traite les deux accusés comme une trace qui me nomme', () => {
  const ae = LIGHT.slice(LIGHT.indexOf('case "ae": {'), LIGHT.indexOf('case "z": {'));
  assert.match(ae, /rememberBouille\(state\.user, attr\(xml, "f"\)\);/);
  assert.match(ae, /rememberStatut\(state\.user, attr\(xml, "s"\)\);/);
  // SANS CONDITION : le cache a déjà été écrit sur-le-champ par
  // `pickAccessory` / `porterAccessoire` / `fbValider`, donc le garde
  // « ça a changé » de `rememberBouille` ne verrait rien passer.
  assert.strictEqual((ae.match(/majBouillesPartout\(\);/g) || []).length, 2);
  assert.match(LIGHT, /state\.bouilleByUser\[state\.userLower\] = newState;/);
});

test('les traces arrivent en grappe : on ne redessine qu’une fois', () => {
  const bloc = LIGHT.slice(LIGHT.indexOf('var majBouillesPrevu'),
    LIGHT.indexOf('// Emote detection'));
  assert.match(bloc, /if \(majBouillesPrevu\) return;\s*\n\s*majBouillesPrevu = true;/);
  // `setTimeout` et non `requestAnimationFrame` : dans un onglet en
  // arrière-plan le battement ne vient jamais, et le drapeau resterait levé.
  assert.match(bloc, /setTimeout\(function \(\) \{\s*\n\s*majBouillesPrevu = false;/);
  assert.doesNotMatch(bloc, /requestAnimationFrame\(/);
  assert.match(bloc, /BureauFrutiz\.majBouilles\(\);/);
});

/* ── 2. L'AQUARIUM SE REPEINT ─────────────────────────────────────────────── */

test('le mode CLB reçoit la liste des membres, et repeint ses bulles', () => {
  assert.match(JS, /else bouilleUnique\(col, gens\);/);
  assert.match(JS, /function bouilleUnique\(col, gens\) \{/);
  const bloc = JS.slice(JS.indexOf('function bouilleUnique(col, gens)'),
    JS.indexOf('function rendreScene'));
  assert.match(bloc, /var m = dansListe\(liste, b\.getAttribute\('data-qui'\)\);/);
  assert.match(bloc, /if \(m\) poserBouille\(b, m\.bouille, m\.pseudo, m\.humeur\);/);
  // Le retaillage d'époque (`updateCLBScreen`, 0xb67f5) reste, il ne bouge pas.
  assert.match(bloc, /b\.style\.width = cote \+ 'px';/);
});

test('l’écart avec l’époque est écrit noir sur blanc', () => {
  // On s'autorise ce que `attachCLBScreen` ne faisait pas — mais on dit
  // pourquoi, et d'où vient la règle qu'on étend.
  assert.match(JS, /`attachFrutiScreen` \(0xb646f\)/);
  assert.match(JS, /`User\.onStatusObj` \(0x26a28\)/);
  assert.match(JS, /`attachCLBScreen` \(0xb6717\)/);
});

/* ── 3. LA VIGNETTE FIGÉE DIT LA MÊME CHOSE QUE L'ANIMATION ───────────────── */

test('l’écran qui va s’animer est repeint AVANT de recevoir la scène', () => {
  // MULTI : `ecranDe` rend l'écran nominatif — et le remet à jour au passage.
  const bloc = JS.slice(JS.indexOf('function ecranDe(pseudo, panneau)'),
    JS.indexOf('function hauteurLibre'));
  assert.match(bloc, /var m = ec && membreDe\(pseudo, p\);\s*\n\s*if \(m\) poserBouille\(ec, m\.bouille, m\.pseudo, m\.humeur\);/);
  // CLB : `clbAccueille` repeint à CHAQUE passage, plus seulement à l'arrivée.
  const clb = bloc.slice(bloc.indexOf('function clbAccueille'));
  const creation = clb.slice(clb.indexOf('if (!b) {'), clb.indexOf('}\n    // Le dessin'));
  assert.doesNotMatch(creation, /poserBouille/);
  assert.match(clb, /\n    var m = membreDe\(pseudo, panneau\);\s*\n\s*poserBouille\(b, m && m\.bouille, pseudo, m && m\.humeur\);/);
});

test('repeindre un écran ne peut pas arracher le canevas de l’animation', () => {
  // Le lecteur d'une émotion vit DANS l'écran (`#bouille-overlay-stage` y est
  // déménagé) et porte lui aussi un `canvas.fp-bvig`. Une recherche en
  // profondeur pouvait tomber dessus, l'`oublier` et le retirer en pleine
  // animation : on ne regarde que les enfants directs.
  assert.match(JS, /var toile = ecran\.querySelector\(':scope > canvas\.fp-bvig'\);/);
  assert.match(JS, /var vieux = ecran\.querySelector\(':scope > img, :scope > canvas\.fp-bvig'\);/);
  assert.match(LIGHT, /if \(scene\.parentNode !== ecran\) ecran\.appendChild\(scene\);/);
});
