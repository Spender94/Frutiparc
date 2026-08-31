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
  /* « Mode Flash » occupe la place de « Mode light » : les deux modes ont
     échangé leurs rôles. Se connecter mène au portage natif, et c'est vers
     main.swf — la vérité historique — que l'entrée renvoie maintenant. */
  assert.deepStrictEqual(noms.slice(0, 4),
    ['Se déconnecter', 'Mode Flash', 'Mode rapide', 'Recherche']);
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
  // La recherche ouvre SA fenêtre — le même chemin que `butSearch`, qui
  // appelle `uniqWinMng.open("search")` (elle renvoyait jusqu'ici vers le
  // Bouilloscope, faute d'annuaire).
  assert.match(JS, /function ouvrirRecherche\(\) \{ ouvrirRechercheFenetre\(\); \}/);
  assert.match(JS, /\.sl-recherche'\)\.addEventListener\('click', ouvrirRechercheFenetre\);/);
});

test('« Mode Flash » emporte le sid, seul moyen d’entrer dans /legacy', () => {
  /* `/legacy` vérifie le sid côté serveur et renvoie à l'accueil sans lui. On
     le prend là où le light le range : `window.state`, ou le `localStorage`
     de la reprise de session. */
  assert.match(JS, /window\.location\.href = '\/legacy' \+ \(sid \? '\?sid=' \+ encodeURIComponent\(sid\) : ''\);/);
  assert.match(JS, /JSON\.parse\(localStorage\.getItem\('fp_light_session'\) \|\| '\{\}'\)/);
  assert.match(LIGHT, /var SESS_KEY = "fp_light_session";/);
  // La présentation mobile reste joignable par l'adresse : c'est elle que les
  // petits écrans reçoivent d'office.
  assert.match(LIGHT, /function vueLightForcee\(\) \{[\s\S]{0,200}?get\("vue"\) === "light";/);
  assert.match(LIGHT, /function isDesktop\(\) \{\s*\n\s*if \(vueLightForcee\(\)\) return false;/);
});

test('se connecter mène au LIGHT, et le Flash reste à un clic', () => {
  const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const LOGIN = fs.readFileSync(path.join(ROOT, 'public/login-bis.html'), 'utf8');
  assert.match(SRV, /redirect: `\/light\?sid=\$\{encodeURIComponent\(sid\)\}`/);
  assert.doesNotMatch(SRV, /redirect: `\/legacy\?sid=/);
  assert.match(LOGIN, /: \(data\.redirect \|\| '\/light'\);/);
  // Le Flash n'est pas retiré, il est déplacé : pied de page et menu du bureau.
  assert.match(LOGIN, /<a href="\/legacy"[^>]*>Version Flash<\/a>/);
  // Et la pop-in qui invitait au light n'a plus d'objet : on y va d'office.
  assert.doesNotMatch(LOGIN, /mobile-popup/);
  assert.match(SRV, /app\.get\('\/legacy', \(req, res\) => \{/, 'la route Flash existe toujours');
});

test('suivre « Version Flash » AVANT de se connecter mène quand même au Flash', () => {
  /* `/legacy` sans session renvoyait sèchement sur `/` : depuis que la
     connexion mène au light, le lien du pied de page faisait un clic sans
     effet, puis une connexion qui atterrissait ailleurs. Il emporte
     maintenant `vers=flash`, et la page de connexion finit le voyage. */
  const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const LOGIN = fs.readFileSync(path.join(ROOT, 'public/login-bis.html'), 'utf8');
  assert.match(SRV, /return res\.redirect\('\/\?vers=flash'\);/);
  assert.match(LOGIN, /const vers = new URLSearchParams\(location\.search\)\.get\('vers'\);/);
  assert.match(LOGIN, /\(vers === 'flash' && data\.sid\)\s*\n\s*\? '\/legacy\?sid=' \+ encodeURIComponent\(data\.sid\)/);
});

/* ── LE VOYANT DU FORUM ───────────────────────────────────────────────────── */

test('le forum prévient son cadre ET son ouvreur', () => {
  assert.match(FORUM, /function prevenirLHote\(message\) \{\s*\n\s*\[window\.parent, window\.opener\]\.forEach/);
  assert.match(FORUM, /prevenirLHote\(\{ forum: 'toutLu', restant: Number\(r\.restant\) \|\| 0 \}\);/);
  // Et l'ancien envoi direct a disparu : il ne visait que `parent`.
  assert.doesNotMatch(FORUM, /window\.parent\.postMessage\(\{ forum: 'toutLu'/);
});

test('le light écoute ce message et éteint le voyant', () => {
  // Deux messages depuis le forum, pas un : « tout marquer comme lu »
  // (`toutLu`) et l'ouverture d'un sujet (`nonLus`), qui recompte aussi.
  assert.match(LIGHT, /if \(!d \|\| \(d\.forum !== "toutLu" && d\.forum !== "nonLus"\)\) return;\s*\n\s*setForumNonLus\(d\.restant\);/);
  assert.match(LIGHT, /function setForumNonLus\(n\) \{[\s\S]{0,220}?majVoyant\("Forum", forumNonLus\);/);
});

test('sur le bureau, le forum s’ouvre bien dans une fenêtre à part', () => {
  // C'est ce qui rendait `parent` inutile — et `win.Forum` (0x6e136) le veut.
  assert.match(JS, /popupForum = window\.open\(url, 'frutiparc_forum', FORUM_FENETRE\);/);
  assert.doesNotMatch(JS, /noopener/);
});
