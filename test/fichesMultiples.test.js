'use strict';
/*
 * PLUSIEURS FICHES OUVERTES À LA FOIS
 *
 * « Les fiches users : on doit pouvoir en ouvrir plusieurs sur le bureau
 *   (aujourd'hui, une fiche remplace une autre) -> elles se comportent comme
 *   des fenêtres -> un clic sur une fenêtre située derrière une fiche la ramène
 *   en premier plan (devant la fiche), si je reclique sur la fiche ensuite, ça
 *   la re-ramène au premier plan. »
 *
 * C'EST LE COMPORTEMENT D'ÉPOQUE, et pas seulement une commodité : `box.Frutiz`
 * est une instance PAR JOUEUR, et `win.Frutiz extends WinStandard` la met dans
 * le MÊME `slotList` que les autres fenêtres. D'où les deux règles reprises
 * ici telles quelles :
 *
 *   • une seule pile de profondeur. `WinStandard.initInterface` branche
 *     `mcInterface.onPress` sur `this._parent.box.activate()`, et `Box.activate`
 *     fait un `swapDepths` : le dernier cliqué passe devant, fiche ou fenêtre.
 *   • toutes se posent dans le coin. `win.Frutiz` n'écrit pas de `pos` et
 *     n'appelle pas `moveToCenter` ; `recal` en fait (cornerX, cornerY). Il n'y
 *     a PAS d'escalier d'ouverture dans main.swf — la seconde couvre donc la
 *     première, et on l'écarte à la souris.
 *
 * Relevé au banc (scratchpad/bench-fiches.js, bench-fiches2.js) : deux fiches
 * posées à z 22 et 23, la fenêtre des scores ouverte à 24 les couvre, un clic
 * sur la seconde la remet à 25 devant elle ; glisser l'une ne bouge que l'une,
 * un onglet ne change que sa page, le bouton rose ne déplie que la sienne ; la
 * refermer rend son panneau au fond et laisse l'autre en place. Le mobile, lui,
 * n'en montre toujours qu'UNE, dans son voile sombre.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

/* ── LE LIGHT TIENT LA LISTE ───────────────────────────────────────────────
   Le portage n'avait qu'un panneau `#fiche` et un `ficheEtat` global : ouvrir
   une fiche écrasait la précédente. Il y a maintenant une entrée par pseudo. */

test('une entrée par joueur, et un NŒUD par entrée', () => {
  assert.match(LIGHT, /var fichesOuvertes = \{\};/);
  assert.match(LIGHT, /f = \{ pseudo: p, data: null, onglet: "frutiz",\s*\n\s*salon: salon \|\| state\.room \|\| null, racine: null \};/);
  assert.match(LIGHT, /f\.racine = ficheNoeud\(cle\);/);
  assert.match(LIGHT, /fichesOuvertes\[cle\] = f;/);
  // La clé est le pseudo en minuscules : « Zorro » et « zorro » sont un seul
  // joueur, donc une seule fiche.
  assert.match(LIGHT, /var ficheCle = function \(p\) \{ return String\(p \|\| ""\)\.toLowerCase\(\); \};/);
});

test('la deuxième fiche est un CLONE du gabarit, sans ses ids', () => {
  // Un document n'a qu'un `#fiche-pseudo` : les ids du clone sont retirés, et
  // ce sont les classes jumelles qui servent désormais à tout viser.
  assert.match(LIGHT, /var clone = origine\.cloneNode\(true\);\s*\n\s*clone\.removeAttribute\("id"\);/);
  assert.match(LIGHT, /clone\.classList\.add\("fiche-clone"\);/);
  assert.match(LIGHT, /clone\.querySelectorAll\("\[id\]"\), function \(n\) \{\s*\n\s*n\.removeAttribute\("id"\);/);
  // Le premier ouvreur prend le panneau d'ORIGINE ; on ne clone qu'ensuite.
  assert.match(LIGHT, /var pris = Object\.keys\(fichesOuvertes\)\.some\(function \(k\) \{\s*\n\s*return fichesOuvertes\[k\]\.racine === origine;/);
  assert.match(LIGHT, /if \(!pris\) return origine;/);
});

test('tout le rendu passe par la racine de la fiche visée', () => {
  assert.match(LIGHT, /function ficheRacine\(\) \{\s*\n\s*return \(ficheEtat && ficheEtat\.racine\) \|\| \$\("#fiche"\);/);
  assert.match(LIGHT, /function fq\(cls\) \{ return ficheRacine\(\)\.querySelector\("\." \+ cls\); \}/);
  // `avecFiche` rend `f` courante LE TEMPS D'UN GESTE : une réponse du serveur
  // qui arrive pendant qu'on regarde une autre fiche ne doit pas écrire dedans.
  assert.match(LIGHT, /function avecFiche\(f, faire\) \{\s*\n\s*var avant = ficheEtat;\s*\n\s*ficheEtat = f;\s*\n\s*try \{ return faire\(\); \} finally \{ ficheEtat = avant; \}/);
  assert.match(LIGHT, /if \(fichesOuvertes\[cle\] !== f\) return;\s+\/\/ refermée entre-temps/);
  // Plus AUCUN `$("#fiche-…")` dans le rendu : ils viseraient toujours le
  // premier panneau du document. (Le fond sombre, lui, reste unique.)
  const restants = (LIGHT.match(/\$\("#fiche-(?!backdrop)[a-z-]+"\)/g) || []);
  assert.deepStrictEqual(restants, [], 'reste des accès par id : ' + restants.join(', '));
});

test('les gestes sont DÉLÉGUÉS, chacun sur SA fiche', () => {
  // Les boutons d'un clone n'ont pas d'écouteur : le clone copie le gabarit,
  // pas ses branchements. Un seul écouteur remonte à la boîte cliquée.
  assert.match(LIGHT, /function ficheDuClic\(ev\) \{[\s\S]*?closest\("\.fiche-boite"\)[\s\S]*?getAttribute\("data-fiche-de"\)/);
  assert.match(LIGHT, /var geste = \["fiche-avance", "fiche-fermer", "fiche-mp", "fiche-mail",\s*\n\s*"fiche-kick", "fiche-ban", "fiche-totoche"\]/);
  assert.match(LIGHT, /avecFiche\(f, function \(\) \{\s*\n\s*if \(onglet\) \{ f\.onglet = onglet; renderFiche\(\); return; \}/);
});

/* ── LE BUREAU EN FAIT DES FENÊTRES ────────────────────────────────────────*/

test('la fiche rejoint la couche des fenêtres, et son compteur d’étages', () => {
  // `#fiche-backdrop` est une couche À PART (z-index 70) : tant que la fiche y
  // vivait, elle passait devant TOUTES les fenêtres, quoi qu'on clique.
  assert.match(JS, /var couche = \$\('#bureau-fenetres'\);\s*\n\s*if \(couche && f\.parentNode !== couche\) couche\.appendChild\(f\);/);
  // Le même `premierPlan` que les fenêtres — donc le même `zCourant`.
  assert.match(JS, /f\.addEventListener\('pointerdown', function \(\) \{ premierPlan\(f\); \}\);/);
  assert.match(JS, /function premierPlan\(fen\) \{ fen\.style\.zIndex = String\(\+\+zCourant\); \}/);
  // Et elle se pose DANS LE COIN, comme tout le reste : pas d'escalier.
  assert.match(JS, /f\.style\.setProperty\('--fx', CORNER_X \+ 'px'\);\s*\n\s*f\.style\.setProperty\('--fy', CORNER_Y \+ 'px'\);/);
  assert.doesNotMatch(JS, /fichesPosees\[cle\][\s\S]{0,400}CORNER_X \+ \d/);
});

test('le câblage tient au NŒUD, pas à la fiche', () => {
  // Le panneau d'origine sert tour à tour à plusieurs joueurs : on ne lui
  // rebranche pas ses écouteurs à chaque ouverture. Et c'est une PROPRIÉTÉ,
  // pas un `data-` — `cloneNode` recopie les attributs, et un clone qui se
  // croirait câblé resterait immobile.
  assert.match(JS, /if \(!f\._ficheCablee\) \{\s*\n\s*f\._ficheCablee = true;\s*\n\s*glisserFiche\(f\);/);
  assert.doesNotMatch(JS, /f\.dataset\.posee/);
});

test('chaque fiche se glisse et se borne pour elle-même', () => {
  // `glisserVers` ne passe que des coordonnées : le poseur est fabriqué POUR
  // UN NŒUD, sinon toutes les fiches suivraient la première.
  assert.match(JS, /function poseurFiche\(f\) \{\s*\n\s*return function \(x, y\) \{/);
  assert.match(JS, /glisserVers\(f, cible, poseurFiche\(f\)\);/);
  assert.doesNotMatch(JS, /function poserFicheA/);
  // `main.onResize()` reborne TOUT ce qui est posé — toutes les fiches.
  assert.match(JS, /function bornerFiche\(\) \{\s*\n\s*for \(var cle in fichesPosees\) bornerUneFiche\(fichesPosees\[cle\]\.fen\);\s*\n\s*\}/);
});

test('refermer une fiche rend son panneau au fond, et laisse les autres', () => {
  assert.match(JS, /function fermerFiche\(cle\) \{[\s\S]*?delete fichesPosees\[cle \|\| 'fiche'\];/);
  assert.match(JS, /if \(f && f\.id === 'fiche'\) \{\s*\n\s*var fond = \$\('#fiche-backdrop'\);/);
  assert.match(JS, /fermerFiche: fermerFiche,/);
  assert.match(LIGHT, /if \(window\.BureauFrutiz && BureauFrutiz\.fermerFiche\) BureauFrutiz\.fermerFiche\(cle\);/);
  assert.match(LIGHT, /if \(f\.racine\.classList\.contains\("fiche-clone"\)\) f\.racine\.remove\(\);/);
  // Le voile ne s'éteint que quand il n'en reste plus AUCUNE.
  assert.match(LIGHT, /if \(!Object\.keys\(fichesOuvertes\)\.length\) \{\s*\n\s*\$\("#fiche-backdrop"\)\.classList\.remove\("show"\);/);
  // Un panneau RANGÉ dans le fond ne se voit pas sur le bureau : sans quoi la
  // dépouille de la première flotterait tant que la seconde est ouverte.
  assert.match(CSS, /body\.bureau-frutiz #fiche-backdrop > \.fiche-boite \{ display: none; \}/);
});

/* ── L'HABILLAGE SUIT, SUR CHAQUE FICHE ────────────────────────────────────*/

test('l’habillage d’époque se pose sur chaque fiche, par classe', () => {
  assert.match(JS, /function habillerIconesFiche\(racine\) \{[\s\S]*?r\.querySelector\('\.' \+ d\.cls\);/);
  assert.match(JS, /function completerIconesFiche\(racine, rangee, pseudoDeLaFiche\) \{/);
  // Un clone porte DÉJÀ les trois boutons (il copie le gabarit) mais sans leurs
  // écouteurs : on les retrouve au lieu de les rebâtir, et on recâble.
  assert.match(JS, /var b = racine\.querySelector\('\.' \+ cls\);\s*\n\s*if \(!b\) \{/);
  assert.match(JS, /b\.addEventListener\('click', faire\);\s*\n\s*return b;/);
  // Les feuilles visent la classe, pas l'id : un clone n'a plus d'id.
  assert.match(CSS, /body\.bureau-frutiz \.fiche-boite \{\s*\n\s*position: absolute; left: var\(--fx, 220px\);/);
  assert.match(LIGHT, /\.fiche-boite \{\s*\n\s*position: relative;/);
  assert.doesNotMatch(CSS, /body\.bureau-frutiz #fiche \{/);
});

test('le pseudo de la fiche retrouve la couleur du genre', () => {
  // La règle de light.html (`.fiche-pseudo[data-genre="F"]`) perdait contre la
  // règle de base du bureau, plus profondément qualifiée : le pseudo d'une
  // fille restait BLEU. Mesuré au banc — rgb(36,33,105) dans les deux cas.
  // On la redit au même poids ici. Les valeurs restent celles du bytecode
  // (`UserSlot.onInfoBasic`, 0x63a51).
  assert.match(CSS, /body\.bureau-frutiz \.fiche-boite \.fiche-pseudo\[data-genre="M"\] \{ color: #242169; \}/);
  assert.match(CSS, /body\.bureau-frutiz \.fiche-boite \.fiche-pseudo\[data-genre="F"\] \{ color: #BB4444; \}/);
});

/* ── ET LE MOBILE NE BOUGE PAS ─────────────────────────────────────────────*/

test('le tactile n’en ouvre toujours qu’une', () => {
  // Sur un téléphone la fiche est une CARTE MODALE : empiler des panneaux hors
  // écran n'aurait aucun sens. Une fiche y remplace l'autre, comme avant.
  assert.match(LIGHT, /if \(!document\.body\.classList\.contains\("bureau-frutiz"\)\) fermerToutesLesFiches\(\);/);
  assert.match(LIGHT, /function fermerToutesLesFiches\(\) \{\s*\n\s*Object\.keys\(fichesOuvertes\)\.forEach\(function \(k\) \{ fermerFiche\(fichesOuvertes\[k\]\); \}\);/);
  // Son voile sombre et son centrage sont intacts.
  assert.match(LIGHT, /#fiche-backdrop \{[\s\S]*?background: rgba\(20, 32, 8, \.45\);/);
  assert.match(LIGHT, /#fiche-backdrop\.show \{ display: flex; \}/);
  // Et le bureau ne pose rien quand il n'est pas là.
  assert.match(JS, /function poserFiche\(cle, racine, pseudo\) \{\s*\n\s*if \(!actif\) return;/);
});
