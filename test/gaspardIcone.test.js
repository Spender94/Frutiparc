'use strict';
/*
 * GASPARD SUR LE BUREAU : SON ICÔNE, ET SES DEUX ENCARTS.
 *
 * « Son icône (icône de sa bouille) n'apparaît pas sur le bureau, récupère-la
 *   dans main.swf. La fenêtre est propre : mais revois les encarts de
 *   bouilles/aquarium. Tu dois reprendre la même chose que pour les autres
 *   fenêtres de discussion. »
 *
 * ── L'ICÔNE ───────────────────────────────────────────────────────────────
 * Elle était là, mais on ne la voyait pas. D'époque, Gaspard est un CONTACT de
 * la liste d'icônes du bureau — `/ff/ls?uid=root` sert, entre l'inventaire et
 * le carnet,
 *
 *     <e u="Gaspard" t="contact" s="10" d="0" a="0">Gaspard@frutiparc.com</e>
 *
 * — et `but.Icon.display` remplace le dessin d'un contact par sa frutibouille.
 * Le portage montre les icônes fixes dans `#home-grid` : la tuile de Gaspard
 * y était, mais elle portait `/fb/Aide.svg`, le point d'interrogation de la
 * barre du haut — un dessin de 15 × 14 en `#A2EB56`, vert clair sur vert
 * clair. Rien à voir, littéralement.
 *
 * Sa bouille n'est pas non plus à inventer : le serveur la garde en dur pour
 * lui, `HARDCODED_FRUTIZ.Gaspard.f = "0n0000000000000000000000"`. Ce sont les
 * douze paires en base 62 d'une frutibouille, et la première vaut 0×62 + 23 :
 * la FAMILLE 23 (public/fbouille/famille23.swf), tout le reste à zéro. Rendue,
 * c'est le rouquin à la feuille — Gaspard.
 *
 * Le geste, enfin, est écrit dans `openFunctions.as` :
 *
 *     case "contact":
 *       if(obj.name.indexOf("@") < 0){
 *         if(obj.name.toLowerCase() == Lang.fv("help.name").toLowerCase()){
 *           _global.chatNow(obj.name);
 *         }else{ _global.frutizInfMng.open(obj.name, _global.desktop); }
 *       }
 *
 * et `chatMng.open` renvoie ce nom-là sur `uniqWinMng.open("help")` : l'icône
 * de Gaspard n'ouvre pas une fiche, elle ouvre SA FENÊTRE.
 *
 * ── LES ENCARTS ───────────────────────────────────────────────────────────
 * `cp.ScreenList` et `cp.UserList` sont les MÊMES composants dans un salon et
 * chez Gaspard : `box.Help.init` (0x7fdf6) fait `userList.addUser(me.name)`
 * puis `userList.addUser(Lang.fv("help.name"))`, et la pile d'écrans suit.
 * Le portage en avait refait une version courte — sans l'anneau sombre de
 * l'écran, sans le clic, sans la bulle de survol, et avec des bandes de liste
 * sans voyant ni couleur de genre. On ne double plus : les deux fenêtres
 * partagent les règles et le constructeur de bande.
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
const OPEN = fs.readFileSync(path.join(ROOT, 'frutiparc/openFunctions.as'), 'latin1');

const BOUILLE = '0n0000000000000000000000';

/* ── 1. LA BOUILLE ────────────────────────────────────────────────────────── */

test('la bouille de Gaspard est celle du serveur, et sa famille existe', () => {
  assert.match(SERVEUR, /const HARDCODED_FRUTIZ = \{\s*\n\s*Gaspard: \{ x: 9999999, f: '0n0000000000000000000000' \},/);
  assert.match(SERVEUR, /function gaspardBouille\(\) \{ return HARDCODED_FRUTIZ\.Gaspard\.f; \}/);
  // Le client la connaît sous le même nom, et pointe vers le serveur.
  assert.match(JS, /var GS_BOUILLE = '0n0000000000000000000000';/);
  assert.match(JS, /HARDCODED_FRUTIZ/, 'le commentaire dit d’où elle vient');
  // Douze paires en base 62 : la première, « 0n », vaut 23.
  assert.strictEqual(BOUILLE.length, 24);
  const dec = (c) => (c >= '0' && c <= '9') ? c.charCodeAt(0) - 48
    : (c >= 'a' && c <= 'z') ? c.charCodeAt(0) - 87 : c.charCodeAt(0) - 29;
  const famille = dec(BOUILLE[0]) * 62 + dec(BOUILLE[1]);
  assert.strictEqual(famille, 23, 'famille 23');
  assert.strictEqual(BOUILLE.slice(2), '0'.repeat(22), 'et rien d’autre');
  // Le dessin est bien là — sans lui, la bouille sortirait en sac à patates.
  assert.ok(fs.existsSync(path.join(ROOT, 'public/fbouille/famille23.swf')),
    'famille23.swf doit être servi');
});

test('la fenêtre ne montre plus le sac à patates à la place de Gaspard', () => {
  const f = /function bouilleDeGaspard\(pseudo\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(f, 'bouilleDeGaspard doit exister');
  // Le test de son nom passe AVANT le carnet et avant le repli.
  assert.match(f[0], /if \(cle === GS_MOTS\.nom\.toLowerCase\(\)\) return GS_BOUILLE;/);
  assert.ok(f[0].indexOf('GS_BOUILLE') < f[0].indexOf("bouilleByUser"),
    'il n’est dans aucun carnet : on ne l’y cherche pas d’abord');
});

/* ── 2. L'ICÔNE DU BUREAU ─────────────────────────────────────────────────── */

test('la tuile du bureau porte sa BOUILLE, plus le point d’interrogation', () => {
  // Ce que main.swf reçoit : Gaspard est un CONTACT de la liste d'icônes,
  // et `but.Icon.display` remplace le dessin d'un contact par sa bouille.
  assert.match(SERVEUR, /<e u="Gaspard" t="contact" s="10" d="0" a="0">Gaspard@frutiparc\.com<\/e>/);
  // Le portage montre les icônes fixes dans `#home-grid` : c'est LÀ que vit
  // celle de Gaspard, et elle portait `/fb/Aide.svg` — le point
  // d'interrogation de la barre du haut, 15 × 14 en `#A2EB56`, vert clair
  // sur vert clair.
  const aide = fs.readFileSync(path.join(ROOT, 'public/fb/Aide.svg'), 'utf8');
  assert.match(aide, /fill="#a2eb56"/, 'le dessin d’origine est bien vert clair');
  assert.match(LIGHT, /<button class="home-tile home-tile-bureau" data-go="gaspard">/);
  const f = /function habillerIconeGaspard\(\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(f, 'habillerIconeGaspard doit exister');
  assert.match(f[0], /var t = \$\('#home-grid \.home-tile\[data-go="gaspard"\]'\);/);
  assert.match(f[0], /ico\.appendChild\(dessinBouille\(GS_BOUILLE\)\);/);
  // Elle est habillée quand la rangée passe sur le bureau.
  assert.match(JS, /if \(grille\) \{ bureau\.appendChild\(grille\); rendreIconesDeplacables\(grille, bureau\); \}\s*\n\s*habillerIconeGaspard\(\);/);
  // À la taille de ses voisines : 42 px, comme le `max-width` commun.
  assert.match(CSS, /#bureau \.home-tile\[data-go="gaspard"\] \.ico \.ex-bouille \{\s*\n\s*width: 42px; height: 42px;/);
  assert.match(CSS, /#bureau \.home-tile \.ico img \{ max-width: 42px; max-height: 42px; \}/);
  // Et la tuile ne paraît QUE sur le bureau : le mobile n'a pas d'aide.
  assert.match(LIGHT, /\.home-tile-bureau \{ display: none; \}/);
});

test('un contact « Gaspard » posé par le joueur prend la même bouille', () => {
  // Il n'a pas de compte : `bouilleOf` n'aurait rien rendu, et l'icône
  // serait sortie en sac à patates.
  assert.match(SERVEUR, /if \(estGaspard\(local\)\) \{\s*\n\s*return Object\.assign\(\{\s*\n\s*uid: it\.u, type: 'contact', desc: \[adresse, gaspardBouille\(\)\], name: GASPARD_NOM,/);
  assert.match(SERVEUR, /const GASPARD_ADRESSE = 'Gaspard@frutiparc\.com';/);
});

test('le clic suit `openFunctions.as` : Gaspard ouvre sa fenêtre, pas une fiche', () => {
  // La source d'époque, mot pour mot.
  assert.match(OPEN, /if\(obj\.name\.toLowerCase\(\) == Lang\.fv\("help\.name"\)\.toLowerCase\(\)\)\{\s*\n\s*_global\.chatNow\(obj\.name\);/);
  assert.match(OPEN, /if\(usr\.toLowerCase\(\) == Lang\.fv\("help\.name"\)\.toLowerCase\(\)\)\{\s*\n\s*_global\.uniqWinMng\.open\("help",slot\);/);
  const f = /function raccourciBureau\(o\) \{[\s\S]*?\n  \}\n/.exec(JS)[0];
  assert.match(f, /if \(estGaspard\(o\.name \|\| o\.desc\[0\]\)\) ouvrirGaspard\(\);\s*\n\s*else ouvrirFiche\(o\.name \|\| o\.desc\[0\]\);/);
  // La comparaison est celle du SWF : en minuscules, sur la partie locale.
  assert.match(JS, /function estGaspard\(nom\) \{\s*\n\s*return String\(nom \|\| ''\)\.split\('@'\)\[0\]\.toLowerCase\(\) === GS_MOTS\.nom\.toLowerCase\(\);/);
});

test('la grille du bureau commence SOUS la rangée d’icônes', () => {
  // Sans cela, la première case libre tombe en (18, 12) — derrière la barre
  // du haut, dont le coin est à `cornerY` = 106. L'icône de Gaspard y
  // disparaissait, et tout disque que main.swf pose sans coordonnées avec
  // elle. D'époque il n'y a qu'UNE liste : les icônes fixes prennent leurs
  // cases, `getNextAvailablePos` saute par-dessus.
  const f = /function caseLibreBureau\(parent\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(f, 'caseLibreBureau doit exister');
  assert.match(f[0], /var rangee = bureau && bureau\.querySelector\('#home-grid'\);/);
  assert.match(f[0], /var y1 = Math\.ceil\(\(rb\.bottom - bb\.top - GRILLE_MY\) \/ GRILLE_PAS\);/);
  assert.match(f[0], /for \(var ry = 0; ry < y1; ry\+\+\) \{/);
  // La rangée, elle, part bien du coin.
  assert.match(CSS, /#bureau #home-grid \{[\s\S]*?position: absolute; top: var\(--cornerY\);/);
});

/* ── 3. LES ENCARTS, PARTAGÉS AVEC LE SALON ───────────────────────────────── */

test('l’écran de Gaspard est celui du salon : une seule règle pour les deux', () => {
  // Le dessin, le reflet, l'anneau sombre, le curseur et le retrait d'un
  // pixel — tout est écrit une fois, et la colonne de Gaspard y est jointe.
  for (const r of [
    /#bouille-overlay \.bo-ecran,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ecrans \.bo-ecran \{ cursor: pointer; \}/,
    /#bouille-overlay \.bo-ecran,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ecrans \.bo-ecran \{\s*\n\s*position: relative; flex: 0 0 100px;/,
    /#bouille-overlay \.bo-ecran::before,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ecrans \.bo-ecran::before \{/,
    /#bouille-overlay \.bo-ecran::after,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ecrans \.bo-ecran::after \{/,
    /#bouille-overlay \.bo-ecran > canvas\.fp-bvig,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ecrans \.bo-ecran > canvas\.fp-bvig \{/,
  ]) assert.match(CSS, r);
  // Et la colonne n'ajoute plus son propre écart : la marge de l'écran suffit
  // (`screen<i>._y = i × (size + ecart)`, `ecart = 2`).
  const col = /#gaspard-panel \.gs-ecrans \{[\s\S]*?\n\}/.exec(CSS)[0];
  assert.ok(!/gap:/.test(col), 'pas de second écart');
  // L'anneau `#888888` de `cp.FrutiScreen` vaut donc pour les deux.
  assert.match(CSS, /\.bo-ecran::after \{\s*\n\s*content: ""; position: absolute; inset: 0; border-radius: 6px;\s*\n\s*box-shadow: inset 0 0 0 1px #888888;/);
});

test('le clic et le survol d’un écran sont branchés pour les DEUX fenêtres', () => {
  const f = /function brancherEcrans\(f\) \{[\s\S]*?\n  \}\n/.exec(JS);
  assert.ok(f, 'brancherEcrans doit exister');
  assert.match(f[0], /if \(estGaspard\(nom\)\) \{ ouvrirGaspard\(\); return; \}/);
  assert.match(f[0], /if \(S && S\.ouvrirFiche\) S\.ouvrirFiche\(nom, panneau\.getAttribute\('data-salon'\)\);/);
  assert.match(f[0], /tipMontrer\(ec, e\.clientX, e\.clientY\);/);
  // Le salon la câble par son branchement de bouilles…
  assert.match(JS, /function brancherBouillesSalon\(f\) \{[\s\S]*?brancherEcrans\(f\);\s*\n  \}/);
  // …et Gaspard à l'ouverture de sa fenêtre.
  assert.match(JS, /var f = fenetres\['gaspard-panel'\];\s*\n\s*if \(f\) brancherEcrans\(f\);/);
  // Chaque écran porte le nom de qui il montre : c'est lui que le clic suit.
  assert.match(JS, /if \(pseudo\) ecran\.setAttribute\('data-nom', pseudo\);/);
});

test('la bande d’un présent est fabriquée par le LIGHT, comme au salon', () => {
  // `cp.UserList` monte le même `userSlot` des deux côtés : le bureau demande
  // la bande au light au lieu d'en refaire une sans voyant ni genre.
  assert.match(LIGHT, /ligne: function \(pseudo, staff\) \{ return ligneConnecte\(pseudo, "", !!staff\); \},/);
  const f = /function majPresentsGaspard\(\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(f, 'majPresentsGaspard doit exister');
  assert.match(f[0], /var d = \(S && S\.ligne\) \? S\.ligne\(nom\) : null;/);
  // Gaspard n'a pas de fiche : son nom mène à sa fenêtre.
  assert.match(f[0], /d\.title = 'Parler à ' \+ GS_MOTS\.nom;/);
  assert.match(f[0], /ouvrirGaspard\(\);/);
  // `box.Help.init` : moi d'abord, Gaspard ensuite.
  assert.match(JS, /function gensDeGaspard\(\) \{[\s\S]*?if \(moi\) gens\.push\(moi\);\s*\n\s*gens\.push\(GS_MOTS\.nom\);/);
});

test('les règles de la bande sont celles du tiroir des connectés', () => {
  for (const r of [
    /#users-drawer \.u,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u \{/,
    /#users-drawer \.u:nth-child\(even\),\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u:nth-child\(even\) \{ background-image: none; \}/,
    /#users-drawer \.u \.voyant,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u \.voyant \{/,
    /#users-drawer \.u \.badge,\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u \.badge \{ display: none; \}/,
  ]) assert.match(CSS, r);
  // Plus de règle jumelle du côté Gaspard : elle vivait à part et divergeait.
  const avant = CSS.slice(0, CSS.indexOf('#chat-panel #users-drawer .u,'));
  assert.ok(!/#gaspard-panel \.gs-ul-defile \.u \{/.test(avant),
    'la bande de Gaspard ne se redéfinit plus toute seule');
  // La couleur du genre vient de la feuille du light, commune aux deux.
  assert.match(LIGHT, /\.u\[data-genre="M"\] \.nom, \.sl-contact\[data-genre="M"\] \.nom \{ color: #242169; \}/);
});

/* ── 4. CE QUI NE DOIT PAS BOUGER ─────────────────────────────────────────── */

test('le gabarit TACTILE ne voit rien de tout cela', () => {
  // Toutes les règles sont derrière `body.bureau-frutiz`.
  for (const r of ['#gaspard-panel .gs-ecrans', '#gaspard-panel .gs-ul-defile',
    '.fb-raccourci {']) {
    const i = CSS.indexOf(r);
    if (i < 0) continue;
    const debut = CSS.lastIndexOf('\n', CSS.lastIndexOf('body', i)) + 1;
    assert.match(CSS.slice(debut, i + r.length), /^body\.bureau-frutiz/, r);
  }
  // Et `SalonsBureau.ligne` ne fait que RENDRE la bande du light : elle ne
  // change pas la liste que le mobile affiche.
  assert.match(LIGHT, /list\.appendChild\(ligneConnecte\(n, "", !!\(set\[n\] && set\[n\]\.staff\)\)\);/);
});
