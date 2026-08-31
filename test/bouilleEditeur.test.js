/*
 * « Ma Frutibouille » — l'éditeur de visage du light, et LE SAC À PATATE.
 *
 * À l'époque, qui n'avait pas encore fait sa bouille portait un sac en papier
 * sur la tête : c'est la coiffure 1 de la famille 0, et la bouille par défaut
 * la porte. Sur le mobile, l'éditeur s'ouvrait donc SUR LE SAC — qui couvre
 * tout le visage. On changeait d'yeux, d'iris, de bouche… sans rien voir
 * changer : impossible de concevoir sa bouille à la première connexion.
 *
 * Trois coiffures sont en fait le sac (1 plein, 2 soulevé, 3 porté en
 * bonnet). On ne les propose plus, et l'éditeur quitte le sac à l'ouverture.
 * Le DESSIN, lui, reste : les bouilles déjà enregistrées avec un sac
 * s'affichent partout comme avant — on retire l'option, pas l'asset.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

/**
 * L'éditeur, extrait du light et exécuté pour de bon : on rejoue les
 * fonctions de défilement sur un état, sans navigateur.
 */
function editeur() {
  const bloc = (nom) => {
    const i = LIGHT.indexOf('function ' + nom);
    assert.ok(i > 0, 'fonction ' + nom + ' introuvable dans light.html');
    // Jusqu'à l'accolade fermante de la fonction, comptée à la main.
    let p = LIGHT.indexOf('{', i);
    let n = 0;
    for (let j = p; j < LIGHT.length; j++) {
      if (LIGHT[j] === '{') n++;
      else if (LIGHT[j] === '}' && --n === 0) return LIGHT.substring(i, j + 1);
    }
    throw new Error('fonction ' + nom + ' non refermée');
  };
  const src = [
    LIGHT.match(/var FB_SAC = \[[^\]]*\];/)[0],
    LIGHT.match(/var FB_PARTS = \[[\s\S]*?\n {2}\];/)[0],
    'var fbState = "000000010000000000000000";',
    bloc('fbDecChar'), bloc('fbEncChar'), bloc('fbGet'), bloc('fbSet'),
    bloc('fbChoix'),
    // fbCycle touche à l'affichage : on neutralise ce qui sort du calcul.
    bloc('fbCycle')
      .replace(/if \(part\.color\) fbRefreshBar\(part\);/, '')
      .replace(/else fbRefreshLabel\(part\);/, '')
      .replace(/fbRenderPreviewSoon\(\);/, ''),
    'return { FB_SAC: FB_SAC, FB_PARTS: FB_PARTS, fbChoix: fbChoix, fbCycle: fbCycle,'
      + ' get: function (p) { return fbGet(p); },'
      + ' set: function (p, v) { fbSet(p, v); },'
      + ' etat: function () { return fbState; } };',
  ].join('\n');
  return new Function(src)();   // eslint-disable-line no-new-func
}

test('le sac à patate n\'est plus proposé parmi les coiffures', () => {
  const e = editeur();
  assert.deepEqual(e.FB_SAC, [1, 2, 3], 'le sac plein, le sac soulevé, le sac en bonnet');
  const cheveux = e.FB_PARTS.find((p) => p.key === 'cheveux');
  assert.deepEqual(cheveux.saute, e.FB_SAC, 'la ligne « cheveux » les écarte');
  const choix = e.fbChoix(cheveux);
  assert.equal(choix.length, 64, '67 coiffures moins les trois sacs');
  for (const sac of e.FB_SAC) {
    assert.ok(!choix.includes(sac), 'la coiffure ' + sac + ' n\'est plus offerte');
  }
  assert.ok(choix.includes(0), 'le crâne nu reste — c\'est un choix, pas un sac');
  assert.ok(choix.includes(66), 'et la dernière coiffure aussi');
  // Les autres lignes ne sautent rien : on ne retire que le sac.
  for (const p of e.FB_PARTS.filter((x) => x.key !== 'cheveux')) {
    assert.ok(!p.saute, p.key + ' garde toutes ses valeurs');
  }
});

test('les flèches enjambent le sac, dans les deux sens et au tour du compteur', () => {
  const e = editeur();
  const cheveux = e.FB_PARTS.find((p) => p.key === 'cheveux');
  // Depuis le crâne nu, en avant : on saute 1, 2, 3 pour tomber sur 4.
  e.set(6, 0);
  e.fbCycle(cheveux, 1);
  assert.equal(e.get(6), 4, 'en avant, le sac est enjambé');
  // En arrière depuis le crâne nu : on repart de la fin, pas du sac.
  e.set(6, 0);
  e.fbCycle(cheveux, -1);
  assert.equal(e.get(6), 66, 'en arrière, le tour passe par la dernière coiffure');
  // Et de la dernière, en avant, on revient au crâne nu.
  e.fbCycle(cheveux, 1);
  assert.equal(e.get(6), 0);
  // Une VIEILLE bouille posée sur un sac : la flèche rejoint la liste au lieu
  // de tourner dans le vide.
  e.set(6, 2);
  e.fbCycle(cheveux, 1);
  assert.ok(!e.FB_SAC.includes(e.get(6)), 'on quitte le sac : ' + e.get(6));
  e.set(6, 2);
  e.fbCycle(cheveux, -1);
  assert.ok(!e.FB_SAC.includes(e.get(6)), 'dans l\'autre sens aussi : ' + e.get(6));
});

test('l\'éditeur s\'ouvre sur un visage VISIBLE, jamais sous le sac', () => {
  // La bouille par défaut porte le sac (coiffure 1) — c'est la marque
  // d'époque du joueur qui n'a pas encore fait sa tête.
  const defaut = /var DEFAULT_BOUILLE = "([^"]+)"/.exec(LIGHT)[1];
  const e = editeur();
  e.set(6, 0);                     // repartir d'un état neutre
  const cheveuxDefaut = (defaut.charCodeAt(6) - 48) * 62 + (defaut.charCodeAt(7) - 48);
  assert.ok(e.FB_SAC.includes(cheveuxDefaut),
    'la bouille par défaut porte bien le sac — c\'est le problème qu\'on corrige');
  // openFbEditor quitte le sac dès l'ouverture.
  const ouvre = LIGHT.substring(LIGHT.indexOf('function openFbEditor'),
    LIGHT.indexOf('function closeFbEditor'));
  assert.match(ouvre, /FB_SAC\.indexOf\(fbGet\(6\)\) >= 0\) fbSet\(6, 0\)/,
    'sous le sac, l\'ouverture bascule sur le crâne nu');
});

/* ══ LA FENÊTRE, AU CHIFFRE PRÈS ══════════════════════════════════════════
 *
 * `win.EditFrutibouille` (0xa2e4d) n'est qu'un empilement de composants ; ce
 * sont leurs mesures qu'on vérifie ici, avec les dessins qu'ils demandent.
 */

test('la ligne ne porte que le NOM de la partie, comme la console d’époque', () => {
  /* `cp.FBConsole.attachText` (0x90c86) pose `field.text = info[id].name` UNE
     FOIS, à la construction : la console ne réécrit jamais son champ. Le
     portage y ajoutait « cheveux · 13/64 » ; ce n'est pas d'époque. */
  const src = LIGHT.substring(LIGHT.indexOf('function fbRefreshLabel'),
    LIGHT.indexOf('function fbRefreshLabels'));
  assert.match(src, /l\.textContent = part\.label;/);
  assert.ok(!/choix\.length/.test(src), 'plus de compteur dans le libellé');
});

test('les six lignes portent les noms du tableau `info` de la famille', () => {
  /* `Frutibouille.getInfo` (0x7eea9) rend `face.info`, que `updateInfo`
     (famille0.swf) construit en douze entrées poussées à l'envers :
     0 famille · 1 yeux · 2 iris · 3 cheveux · 4 bouche · 5 couleur1 ·
     6 couleur2 · 7 accessoire · 8 accessoire2 · 9..11 acc couleur1..3.
     L'ID d'une ligne est l'INDICE DE LA PAIRE, d'où `pos = 2 × id`. */
  const e = editeur();
  assert.deepEqual(e.FB_PARTS.map((p) => p.label),
    ['yeux', 'iris', 'cheveux', 'bouche', 'couleur1', 'couleur2']);
  assert.deepEqual(e.FB_PARTS.map((p) => p.id), [1, 2, 3, 4, 5, 6]);
  for (const p of e.FB_PARTS) {
    assert.equal(p.pos, p.id * 2, p.label + ' : la paire suit l’identifiant');
  }
  // Les deux dernières sont de `type: "color"` — un échantillon, pas un texte.
  assert.deepEqual(e.FB_PARTS.map((p) => !!p.color),
    [false, false, false, false, true, true]);
});

test('la fenêtre reprend les mesures du bytecode', () => {
  const css = LIGHT.substring(LIGHT.indexOf('#fb-editor-backdrop'),
    LIGHT.indexOf('/* ── Generic panel ── */'));
  // L'écran : `frutiScreen` en `fix {w:100, h:100}`, et sa marge basse de 10
  // (`margin.y = {ratio: 0, min: 10}` dans `initFrameSet`).
  assert.match(css, /\.fb-ecran \{[\s\S]*?width: 100px; height: 100px; margin: 6px 0 10px;/);
  // C'est le MÊME écran que l'aquarium du salon : mêmes dessins, mêmes liserés.
  assert.match(css, /url\('\/frutiz\/sprites\/ecran-fond\.svg'\)/);
  assert.match(css, /url\('\/frutiz\/sprites\/ecran-reflet\.svg'\)/);
  // La ligne : `min {w: 140, h: 26}`, et des flèches CARRÉES de la hauteur
  // (`right._x = width − height`).
  assert.match(css, /\.fb-row \{[\s\S]*?height: 26px;/);
  assert.match(css, /\.fb-arrow \{\s*\n\s*flex: 0 0 26px; width: 26px; height: 26px;/);
  // Les deux images de `butPushSmallPink`, sorties du SWF.
  assert.match(css, /\.fb-arrow\.lft \{ background-image: url\('\/frutiz\/sprites\/fb-fleche-gauche\.svg'\); \}/);
  assert.match(css, /\.fb-arrow\.rgt \{ background-image: url\('\/frutiz\/sprites\/fb-fleche-droite\.svg'\); \}/);
  // Le bouton : la gélule `butPushStandard` (#465), 16 px de haut.
  assert.match(css, /\.fb-valider \{[\s\S]*?height: 16px;[\s\S]*?background: #FFAAAD; box-shadow: inset 0 0 0 1\.5px #F28687;/);
  assert.match(css, /\.fb-valider \{[\s\S]*?color: #660000;/);
  // Et les vieilles images bricolées ont disparu.
  assert.ok(!/icone_fleche_gauche\.png|icone_fleche_droite\.png/.test(LIGHT),
    'plus de flèches hors SWF');
});

test('les deux dessins de flèche sortent bien du SWF', () => {
  const SPRITES = path.join(ROOT, 'public/frutiz/sprites');
  for (const n of ['fb-fleche-gauche.svg', 'fb-fleche-droite.svg']) {
    const p = path.join(SPRITES, n);
    assert.ok(fs.existsSync(p), n + ' manque — lancer extract-editeur-bouille.js');
  }
  /* L'image 11 est l'image 10 RETOURNÉE : même forme (#367), échelle en x
     niée. C'est ce que la bande #374 fait à ses deux images. */
  const g = fs.readFileSync(path.join(SPRITES, 'fb-fleche-gauche.svg'), 'utf8');
  const d = fs.readFileSync(path.join(SPRITES, 'fb-fleche-droite.svg'), 'utf8');
  assert.match(g, /matrix\(-1,0,0,1\.0045,10,10\)/);
  assert.match(d, /matrix\(1,0,0,1\.0045,10,10\)/);
  // À la matrice près, les deux dessins sont le même.
  assert.equal(g.replace(/matrix\([^)]*\)/g, ''), d.replace(/matrix\([^)]*\)/g, ''));
  const man = JSON.parse(fs.readFileSync(path.join(SPRITES, 'bureau.json'), 'utf8'));
  assert.ok(man.editeurBouille, 'le manifeste du bureau garde la trace de l’extraction');
  assert.equal(man.editeurBouille['fb-fleche-gauche'].image, 11);
  assert.equal(man.editeurBouille['fb-fleche-droite'].image, 10);
  // Et l'extraction n'a pas écrasé le reste du manifeste, qui est COMMUN.
  assert.ok(man.boutons, 'les boutons de bandeau sont toujours là');
});

test('l’échantillon de couleur refait le DÉCALAGE de `setColor`', () => {
  /* `updateSampleColor` (0x90d34) dessine du blanc bordé de `#BBBBBB`, puis
     `setColor(colorSample, generalPalette[val])`. `FEMC.setColor` (0x4a81c)
     pose `sortie = source + (col − 255)` : le blanc rend la couleur, le gris
     la même en plus sombre de 68 par canal. Un liseré assorti, jamais noir. */
  const src = LIGHT.substring(LIGHT.indexOf('function fbDecale'),
    LIGHT.indexOf('function fbRefreshBars'));
  assert.match(src, /var s = 255 - source;/);
  assert.match(src, /b\.style\.borderColor = fbDecale\(hex, 0xBB\);/);
  // Et la valeur, en clair : un rouge vif garde sa teinte, en plus sombre.
  const f = new Function(LIGHT.substring(LIGHT.indexOf('function fbDecale'),
    LIGHT.indexOf('function fbRefreshBar(')) + '\nreturn fbDecale;')();
  assert.equal(f('#FFFFFF', 0xBB), '#bbbbbb');
  assert.equal(f('#FF0000', 0xBB), '#bb0000');
  assert.equal(f('#404040', 0xBB), '#000000', 'le décalage se borne à zéro');
});
