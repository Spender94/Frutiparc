'use strict';
/*
 * UNE LUMIÈRE N'EST PAS UNE OMBRE
 * ═══════════════════════════════
 *
 * Le graphiste pose une brillance de la façon la plus ordinaire qui soit : une
 * forme blanche qui s'éteint, c'est-à-dire un DÉGRADÉ du blanc opaque au blanc
 * transparent. `bouille-custom.charger()` sait le lire — il traduit le
 * `fill="url(#…)"` en structure de dégradé (arrêts, matrice, focale) — et le
 * serveur la conserve (`nettoyerDegrade`). Deux peintres l'attendaient :
 *
 *   · `dessinerForme`, pour les variantes injectées dans la famille
 *     (`construirePoses` leur transmet `degrade`) — celui-là peignait bien ;
 *   · `dessinerAccessoireCustom`, pour les accessoires MAISON de l'inventaire
 *     — celui-là lisait `p.fill` et jetait la structure.
 *
 * Or `charger()` pose dans `p.fill` un APLAT DE REPLI, `rgb(136,136,136)`, pour
 * les rendus qui ne sauraient pas peindre un dégradé. Le second peintre le
 * prenait donc au mot : toute lumière sortait en gris moyen OPAQUE. Un gris
 * sombre étalé sur une couleur claire, ce n'est plus une lumière — c'est une
 * ombre, et c'est exactement ce qu'on voyait dans l'inventaire d'accessoires.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MOTEUR = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');
const CUSTOM = fs.readFileSync(path.join(ROOT, 'public/js/bouille-custom.js'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('l’import garde la structure du dégradé, et un aplat de repli', () => {
  // `charger()` traduit le `url(#id)` et laisse le gris de repli dans `fill`.
  assert.match(CUSTOM, /deg = degradeDe\(el, ref\[1\], vivant\.ownerDocument \|\| global\.document\);/);
  assert.match(CUSTOM, /var pf = faire\(d, deg \? 'rgb\(136,136,136\)' : fill, op\.fill, m, avant, slot, false, 0, blend, deg\);/);
  assert.match(CUSTOM, /if \(degrade\) p\.degrade = degrade;/);
  // Les arrêts sortent au format du moteur : ratio sur 255, rgb, alpha.
  assert.match(CUSTOM, /out\.push\(\{ ratio: Math\.max\(0, Math\.min\(255, Math\.round\(r \* 255\)\)\), rgb: rgb, alpha: op \}\);/);
  // …et la matrice en VINGTIÈMES, comme celles du SWF : le peintre divise.
  assert.match(CUSTOM, /Le moteur divise la matrice par 20 au dessin : on lui donne donc ×20\./);
});

test('le serveur ne perd pas le dégradé en route', () => {
  assert.match(SERVEUR, /const g = nettoyerDegrade\(p\.degrade\);\s*\n\s*if \(g\) q\.degrade = g;/);
  assert.match(SERVEUR, /function nettoyerDegrade\(g\) \{/);
});

test('le peintre des accessoires maison PEINT le dégradé', () => {
  // Le repli n'est plus lu quand la structure est là.
  assert.match(MOTEUR, /\} else if \(p\.degrade && !niveau\) \{/);
  assert.match(MOTEUR, /ctx\.transform\(G\.a \/ 20, G\.b \/ 20, G\.c \/ 20, G\.d \/ 20, G\.e \/ 20, G\.f \/ 20\);/);
  assert.match(MOTEUR, /ctx\.fillStyle = self\.degrade\(ctx, p\.degrade, null\);/);
  assert.match(MOTEUR, /ctx\.fill\(cheminDegrade\(p, G\), 'evenodd'\);/);
  // Le tracé fait le chemin INVERSE de la matrice — un dégradé se peint dans
  // SON repère, comme pour les formes du SWF (cf. p2dDegrade).
  assert.match(MOTEUR, /const cheminDegrade = \(p, G\) => \{/);
  assert.match(MOTEUR, /\.inverse\(\)\s*\n\s*: new global\.DOMMatrix\(\);/);
  // Et un tracé À NIVEAU garde la règle documentée de l'atelier : la couleur
  // du niveau remplace la sienne, dégradé compris.
  assert.match(MOTEUR, /const niveau = \(p\.slot && couleurs && couleurs\[p\.slot - 1\]\) \? couleurs\[p\.slot - 1\] : null;/);
  assert.match(MOTEUR, /const teinte = niveau \|\| p\.fill;/);
});

test('les variantes injectées, elles, peignaient déjà juste', () => {
  // `construirePoses` transmet le dégradé à la couche de forme, et
  // `dessinerForme` le peint depuis toujours : le défaut ne touchait QUE le
  // peintre des accessoires maison. On garde les deux chemins sous l'œil.
  const VAR = fs.readFileSync(path.join(ROOT, 'public/js/bouille-variante.js'), 'utf8');
  assert.match(VAR, /trait: !!p\.trait, largeur: p\.largeur \|\| 1, degrade: p\.degrade \|\| null,/);
  assert.match(MOTEUR, /\} else if \(c\.degrade\) \{\s*\n\s*ctx\.fillStyle = this\.degrade\(ctx, c\.degrade, cx\);/);
});
