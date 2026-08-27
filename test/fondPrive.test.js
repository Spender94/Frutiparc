'use strict';
/*
 * EN PRIVÉ, CHACUN MONTRE SON BUREAU À L'AUTRE.
 *
 * On voyait, à l'ouverture d'une discussion privée, une ligne de conversation
 * comme « acgi : 80;wal-custom/hiko.jpg ». Ce n'était pas un message : c'était
 * le FOND D'ÉCRAN de l'interlocuteur, que le portage ne savait pas lire.
 *
 * ── L'ENVOI ──────────────────────────────────────────────────────────────
 * `cp.ChatManager.sendWallpaper` (0x2d620) compose deux champs et les envoie
 * comme un message de conversation ordinaire, de type « b » :
 *
 *     sendWallpaper = function (url, alpha) {
 *       this.send(new XML().createTextNode(alpha + ";" + url), "b");
 *     };
 *
 * Deux moments l'appellent :
 *
 *     onChatReady       = function () {              // 0x31843
 *       if (wallPaper.url !== undefined)
 *         this.sendWallpaper(wallPaper.url, wallPaper.pvAlpha);
 *     };
 *     onChangeWallpaper = function (url, alpha) {    // 0x317ea
 *       if (this.cmode === "private") this.sendWallpaper(url, alpha);
 *     };
 *
 * — l'ouverture du salon, et chaque changement de fond. En public, rien :
 * `cmode` vaut alors « channel », et un salon partagé n'a pas de fond.
 *
 * ── LA RÉCEPTION ─────────────────────────────────────────────────────────
 * `cp.Chat.onTrace` (0x2f178) retient le type « b » AVANT tout affichage :
 *
 *     if (t === "b") {
 *       if (node.attributes.u === me.name) return false;      ← pas mon écho
 *       var s = node.firstChild.nodeValue.toString();
 *       if (s.length > 0) { var p = s.split(";");
 *         this.wallpaper = { url: p[1], alpha: Number(p[0]) }; }
 *       else this.wallpaper = { url: null, alpha: null };
 *       this.window.setWallpaper(this.wallpaper.url, this.wallpaper.alpha);
 *       return undefined;                                     ← AUCUN addText
 *     }
 *
 * ── L'OPACITÉ ────────────────────────────────────────────────────────────
 * `win.Chat.setWallpaper` (0x698df) passe la main à `Frame.setWallpaper`
 * (0x487df), qui charge l'image dans `bg.wp` puis la FOND dans la couleur du
 * composant :
 *
 *     mcl.loadClip(url, bg.wp.img);
 *     FEMC.setPColor(bg.wp, style.color[0].main, 100 - prc);
 *
 * `setPColor(mc, c, p)` (0x4a9d1) garde `p %` de l'image et plaque
 * `100 − p %` de la couleur. Le `pvAlpha` d'époque vaut **80** par défaut
 * (`WallPaperMng.loadWP`, 0x9a6b9 : `dataMisc.length < 3 ? 80 : dataMisc[2]`),
 * si bien qu'il ne reste que **20 %** de l'illustration. C'est un fond très
 * estompé, pas une image de fond — et en CSS, c'est exactement un voile plat
 * de la chair du fil par-dessus l'image.
 *
 * ── CE QU'ON NE REPREND PAS ──────────────────────────────────────────────
 * L'URL vient d'un AUTRE JOUEUR. Le SWF la donnait telle quelle à `loadClip` ;
 * ici on n'accepte que la forme d'un fond du parc (`wal-custom/<id>.<ext>`,
 * cf. /api/light/fond) : ni schéma, ni hôte, ni remontée de dossier. **Écart
 * assumé.**
 *
 * Éprouvé au banc, deux navigateurs et une vraie socket : B envoie
 * « 80;wal-custom/hiko.jpg », le fil d'A porte l'image sous un voile à 80 % et
 * n'écrit rien ; une chaîne vide le dénude ; une url étrangère est refusée.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');

test('le type « b » est retenu AVANT tout affichage', () => {
  // Avant même le tri par salon : une conversation en arrière-plan a droit au
  // fond de l'autre, et la trame ne doit jamais compter comme un message.
  const i = LIGHT.indexOf('if (ty === "b") {');
  const j = LIGHT.indexOf('if (salon && salon !== state.room && !aSonJournal(salon)) {');
  assert.ok(i > 0 && j > i, 'la branche « b » doit précéder le tri par salon');
  const bloc = LIGHT.slice(i, j);
  assert.match(bloc, /if \(!sameName\(attr\(xml, "u"\), state\.user\)\) \{/);
  assert.match(bloc, /fondDuSalon\(salon, xmlUnescape\(stripCdata\(bodyOf\(xml\)\)\)\);/);
  assert.match(bloc, /break;/);
});

test('« alpha;url », et le pvAlpha d’époque en repli', () => {
  const bloc = LIGHT.slice(LIGHT.indexOf('function fondDuSalon(salon, brut)'),
    LIGHT.indexOf('function envoyerMonFond(salon)'));
  assert.match(bloc, /var p = t\.split\(";"\);/);
  assert.match(bloc, /url = urlFondSure\(p\[1\]\);/);
  assert.match(bloc, /alpha = Number\(p\[0\]\);/);
  assert.match(bloc, /if \(!\(alpha >= 0 && alpha <= 100\)\) alpha = FOND_PRIVE_ALPHA;/);
  assert.match(LIGHT, /var FOND_PRIVE_ALPHA = 80;/);
  // Une chaîne VIDE dénude le cadre : `{url: null, alpha: null}`.
  assert.match(bloc, /if \(!url\) \{[\s\S]{0,200}?classList\.remove\("a-fond-prive"\);/);
});

test('l’url d’un autre joueur est bornée à la forme d’un fond du parc', () => {
  const bloc = LIGHT.slice(LIGHT.indexOf('function urlFondSure(u)'),
    LIGHT.indexOf('function fondDuSalon(salon, brut)'));
  assert.match(bloc, /if \(!\/\^\[A-Za-z0-9_\\-\.\/\]\+\$\/\.test\(s\)\) return null;/);
  assert.match(bloc, /if \(s\.charAt\(0\) === "\/" \|\| s\.indexOf\("\.\."\) >= 0\) return null;/);
  assert.match(bloc, /if \(!\/\\\.\(jpe\?g\|png\|gif\|webp\)\$\/i\.test\(s\)\) return null;/);
});

test('le voile plat rejoue setPColor, et le fond ne défile pas', () => {
  // `background-attachment` reste à `scroll` (le défaut) : d'époque `bg.wp`
  // appartient au CADRE. On ne l'écrit donc nulle part — mais on ne met pas
  // `local` non plus.
  assert.match(LIGHT, /#messages\.a-fond-prive \{\s*\n\s*background:\s*\n\s*linear-gradient\(var\(--wp-voile\), var\(--wp-voile\)\),\s*\n\s*var\(--wp-img\) center \/ cover no-repeat,\s*\n\s*#CCF599;/);
  assert.doesNotMatch(LIGHT, /a-fond-prive[\s\S]{0,300}background-attachment: local/);
  // Le bureau garde en plus son lustre, qui passe PAR-DESSUS l'image.
  assert.match(CSS, /#messages\.a-fond-prive \{\s*\n\s*background:\s*\n\s*linear-gradient\(to bottom, rgba\(255,255,255,\.64\)[^\n]*\n\s*linear-gradient\(var\(--wp-voile\), var\(--wp-voile\)\),/);
});

test('et le mien part chez l’autre — à l’ouverture, et à chaque changement', () => {
  // `onChatReady` : une fois par conversation.
  assert.match(LIGHT, /if \(estPrive\(room\) && state\.prives\[room\] && !state\.prives\[room\]\.fondEnvoye\) \{\s*\n\s*state\.prives\[room\]\.fondEnvoye = true;\s*\n\s*envoyerMonFond\(room\);/);
  // `onChangeWallpaper` : à chaque fois qu'on en change.
  assert.match(LIGHT, /function appliquerFond\(fond\) \{[\s\S]{0,400}?envoyerMonFondPartout\(\);/);
  const bloc = LIGHT.slice(LIGHT.indexOf('function envoyerMonFond(salon)'),
    LIGHT.indexOf('function envoyerMonFondPartout()'));
  // En public, rien : `cmode` vaudrait « channel ».
  assert.match(bloc, /if \(!estPrive\(salon\)\) return;/);
  assert.match(bloc, /t="b"/);
  assert.match(bloc, /bodyEscape\(u \? a \+ ";" \+ u : ""\)/);
});
