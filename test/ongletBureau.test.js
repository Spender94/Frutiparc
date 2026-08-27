'use strict';
/*
 * L'ONGLET « BUREAU » A UN MENU, ET LE VOYANT DU FORUM S'ÉTEINT.
 *
 * ── 1. LE MENU DE L'ONGLET ───────────────────────────────────────────────
 *
 * Le portage avait conclu que `FPDesktop` n'avait pas de menu : sa pastille ne
 * faisait donc rien, et l'onglet paraissait mort. C'était faux.
 * `FPDesktop.getMenu` (0xb97cd) se lit d'un bloc :
 *
 *     getMenu = function () {
 *       var m;
 *       if (me.name est l'un de bumdum, deepnight, yota, whitetigle, skool,
 *           warp, roger, test, ernest, hiko, ou (en minuscules) gaspard ou
 *           snowstar)
 *         m = [ {title: "Invisibilité",      → mainCnx.cmd("invisible")},
 *               {title: "Créer accessoires", → desktop.addBox(new
 *                                               box.NewBouille())},
 *               {title: "Afficher debug",    → moveDebugToDesktop()} ];
 *       else m = [];
 *       var t = main.mainBar.flHalfHide ? "Afficher barre" : "Mode rapide";
 *       m.push({title: "Se déconnecter", → logout()});
 *       m.push({title: "Mode light",     → golight()});
 *       m.push({title: t,                → main.mainBar.toggleHalfHide()});
 *       m.push({title: "Recherche",      → uniqWinMng.open("search")});
 *       return m;
 *     };
 *
 * Les trois premières entrées sont l'outillage des AUTEURS — les pseudos sont
 * ceux de Motion-Twin —, elles n'ont pas cours ici. Restent les quatre de tout
 * le monde, et chacune existait déjà ailleurs dans le portage : il ne manquait
 * que de les rassembler là où l'époque les mettait.
 *
 * `flHalfHide` ne décide QUE du libellé : c'est la même bascule dans les deux
 * sens (`toggleHalfHide`).
 *
 * Mesuré au banc : la pastille déroule les quatre entrées, la plaque s'étire à
 * `tabMenuMargeUp + n × tabMenuSpace` = 8 + 4 × 18 = 80, un second appui
 * referme, et l'entrée devient « Afficher barre » une fois la barre repliée.
 *
 * ── 2. LE VOYANT DU FORUM ────────────────────────────────────────────────
 *
 * « Tout marquer comme lu » prévenait `window.parent` — et le forum n'est
 * `parent` que sur le TÉLÉPHONE, où il vit dans le cadre `#forum-frame`. Sur
 * le bureau, `win.Forum` (0x6e136) n'est pas une fenêtre du bureau mais un
 * renvoi vers une VRAIE fenêtre de navigateur, et le portage fait pareil
 * (`ouvrirForum`, window.open) : `parent` valait alors la fenêtre elle-même,
 * le message ne partait à personne, et le voyant clignotait encore une fois le
 * forum tout lu. C'est `opener` qu'il fallait.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const FORUM = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');

/* ── LE MENU ──────────────────────────────────────────────────────────────── */

const MENU = JS.slice(JS.indexOf('function menuDuSlot(idOnglet)'),
  JS.indexOf('function deconnecter()'));

test('les quatre entrées de tout le monde, dans l’ordre du bytecode', () => {
  const noms = [];
  const re = /\{ titre: (?:'([^']+)'|repli\.actif \? '([^']+)' : '([^']+)')/g;
  let m;
  while ((m = re.exec(MENU)) !== null) noms.push(m[1] || m[3]);
  assert.deepStrictEqual(noms.slice(0, 4),
    ['Se déconnecter', 'Mode light', 'Mode rapide', 'Recherche']);
});

test('« flHalfHide » ne décide que du libellé', () => {
  assert.match(MENU, /titre: repli\.actif \? 'Afficher barre' : 'Mode rapide',\s*\n\s*faire: function \(\) \{ basculerRepli\(\); \}/);
});

test('l’outillage des auteurs n’a pas cours ici, mais il est cité', () => {
  assert.match(JS, /bumdum, deepnight, yota, whitetigle, skool,/);
  assert.doesNotMatch(MENU, /Invisibilité|Créer accessoires|Afficher debug/);
});

test('chaque entrée repasse par ce qui existait déjà', () => {
  // La déconnexion garde le chemin du tiroir (fermeture de la socket comprise).
  assert.match(JS, /function deconnecter\(\) \{[\s\S]{0,300}?var b = \$\('#logout-btn'\);/);
  // Le repli est celui de `toggleHalfHide`, déjà porté.
  assert.match(JS, /function basculerRepli\(force\) \{/);
  // La recherche, c'est le Bouilloscope — le même choix que `butSearch`.
  assert.match(JS, /function ouvrirRecherche\(\) \{[\s\S]{0,200}?home-tile\[data-go="trombi"\]/);
});

test('« Mode light » passe par l’URL, sans rien retenir', () => {
  assert.match(JS, /p\.set\('vue', 'light'\);/);
  assert.match(LIGHT, /function vueLightForcee\(\) \{[\s\S]{0,200}?get\("vue"\) === "light";/);
  assert.match(LIGHT, /function isDesktop\(\) \{\s*\n\s*if \(vueLightForcee\(\)\) return false;/);
});

/* ── LE VOYANT DU FORUM ───────────────────────────────────────────────────── */

test('le forum prévient son cadre ET son ouvreur', () => {
  assert.match(FORUM, /function prevenirLHote\(message\) \{\s*\n\s*\[window\.parent, window\.opener\]\.forEach/);
  assert.match(FORUM, /prevenirLHote\(\{ forum: 'toutLu', restant: Number\(r\.restant\) \|\| 0 \}\);/);
  // Et l'ancien envoi direct a disparu : il ne visait que `parent`.
  assert.doesNotMatch(FORUM, /window\.parent\.postMessage\(\{ forum: 'toutLu'/);
});

test('le light écoute ce message et éteint le voyant', () => {
  assert.match(LIGHT, /if \(!d \|\| d\.forum !== "toutLu"\) return;\s*\n\s*setForumNonLus\(d\.restant\);/);
  assert.match(LIGHT, /function setForumNonLus\(n\) \{[\s\S]{0,220}?majVoyant\("Forum", forumNonLus\);/);
});

test('sur le bureau, le forum s’ouvre bien dans une fenêtre à part', () => {
  // C'est ce qui rendait `parent` inutile — et `win.Forum` (0x6e136) le veut.
  assert.match(JS, /popupForum = window\.open\(url, 'frutiparc_forum', FORUM_FENETRE\);/);
  assert.doesNotMatch(JS, /noopener/);
});
