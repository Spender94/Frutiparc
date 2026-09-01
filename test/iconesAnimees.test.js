'use strict';
/*
 * LES ICÔNES DU BUREAU QUI S'ANIMENT AU SURVOL
 * ════════════════════════════════════════════
 *
 * `but.Icon` ne CHANGE PAS de dessin quand la souris passe dessus : il fait
 * JOUER le clip qui vit sous l'icône. Le montage a trois étages —
 *
 *     ico        la bande `iconGFX` de fileIcon.swf (un type de fichier)
 *       s1       la bande des TYPES DE DOSSIER (#200)
 *         s2     un clip de quinze images : l'animation
 *
 * et le survol se résume à trois appels (main.swf) :
 *
 *     playAnimRollOver     animList.addPlayFrame(mc.ico.s1.s2, "move_"+id,
 *                            { end:  8, sens:  1, speed: 2 })
 *     playAnimRollOut                                { end:  1, sens: -1, speed: 2 }
 *     playAnimDragRollOver                           { end: 15, sens:  1, speed: 2 }
 *
 * `AnimList.addPlayFrame` (0x51aed) pose un `setInterval(playFrame, 25)`, et
 * `playFrame` (0x51bd3) avance de `Math.round(speed × tmod)` images par
 * battement. Deux images toutes les 25 ms, de la 1 à la 8 : le drapeau de la
 * boîte aux lettres se lève en une centaine de millisecondes, le couvercle de
 * la boîte à disques se soulève, le carnet s'entrouvre.
 *
 * TOUTES LES ICÔNES NE BOUGENT PAS, et c'est le fichier qui le dit : les
 * images `recyclebin` (#133), `inventory` (#150) et `blacklist` (#199) de la
 * bande des dossiers posent une FORME nue, sans clip — il n'y a rien à jouer.
 * D'où le « certaines icônes » de la demande.
 *
 * Le portage sort les huit images de chaque clip en SVG
 * (scripts/extract-icones-animees.js) et rejoue la même mécanique.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const EX = fs.readFileSync(path.join(ROOT, 'scripts/extract-icones-animees.js'), 'utf8');
const MAN = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'public/frutiz/sprites/icones-animees.json'), 'utf8'));

test('les six jeux d’images sortent de fileIcon.swf, huit par huit', () => {
  // Six clips animés dans la bande des dossiers, et les types qui les
  // partagent. Le manifeste est produit par CONSTAT (l'extracteur cherche un
  // sous-clip nommé `s2` d'au moins huit images), pas par une liste écrite à
  // la main : c'est ce qui garantit qu'il colle au fichier.
  assert.match(EX, /const IMAGES = 8;/);
  assert.match(EX, /p\.nom === 's2' && swf\.estSprite\(p\.ch\)/);
  assert.strictEqual(MAN.images, 8);
  assert.strictEqual(MAN.intervalle, 25, 'un battement toutes les 25 ms');
  assert.strictEqual(MAN.pas, 2, 'deux images par battement (speed: 2)');

  const jeux = Object.keys(MAN.cadres).sort();
  assert.deepStrictEqual(jeux,
    ['blackbox', 'contact', 'default', 'disccollector', 'mail', 'outbox'].sort());

  // Chaque type de dossier animé pointe sur un jeu qui existe.
  for (const [type, jeu] of Object.entries(MAN.types)) {
    assert.ok(MAN.cadres[jeu], type + ' renvoie à un jeu inconnu : ' + jeu);
  }
  // Et les trois dessins FIXES d'époque n'y sont pas.
  for (const fixe of ['recyclebin', 'inventory', 'blacklist']) {
    assert.ok(!MAN.types[fixe], fixe + ' est une forme nue : rien à animer');
  }

  // Les quarante-huit fichiers.
  for (const jeu of jeux) {
    for (let n = 1; n <= MAN.images; n++) {
      const p = path.join(ROOT, 'public/frutiz/sprites/ico_anim_' + jeu + '_' + n + '.svg');
      assert.ok(fs.existsSync(p), 'ico_anim_' + jeu + '_' + n + '.svg manque');
      assert.ok(fs.statSync(p).size > 200, 'et porte un vrai dessin');
    }
  }
});

test('les huit images partagent un cadre, et l’image au repos y tombe juste', () => {
  /*
   * Chaque image du clip est UNE forme, et sa boîte n'est pas celle de la
   * précédente : l'enveloppe passe de 62 × 44 à 62 × 53 en levant son
   * drapeau. Découpées chacune sur leur propre dessin, les huit sauteraient
   * d'une image à l'autre. Elles sortent donc dans le MÊME cadre — l'union
   * des huit — et le manifeste dit où l'image AU REPOS s'y trouve.
   */
  for (const jeu of Object.keys(MAN.cadres)) {
    const c = MAN.cadres[jeu], r = MAN.repos[jeu];
    assert.ok(r, jeu + ' n’a pas de boîte au repos');
    // Le repos est CONTENU dans le cadre commun — c'est ce qui rend le
    // recalage possible.
    assert.ok(r.x >= c.x - 0.01 && r.y >= c.y - 0.01
      && r.x + r.w <= c.x + c.w + 0.01 && r.y + r.h <= c.y + c.h + 0.01,
      jeu + ' : le repos déborde du cadre commun');
    // Et le cadre est plus GRAND quelque part : sinon rien ne bougerait.
    assert.ok(c.w > r.w + 0.01 || c.h > r.h + 0.01,
      jeu + ' : le cadre ne se réserve aucune marge, l’animation ne va nulle part');
    // Toutes les images portent bien ce cadre-là.
    for (let n = 1; n <= MAN.images; n++) {
      const svg = fs.readFileSync(
        path.join(ROOT, 'public/frutiz/sprites/ico_anim_' + jeu + '_' + n + '.svg'), 'utf8');
      assert.ok(svg.includes('viewBox="' + c.x + ' ' + c.y + ' ' + c.w + ' ' + c.h + '"'),
        'ico_anim_' + jeu + '_' + n + ' ne partage pas le cadre commun');
    }
  }

  /*
   * ET LE REPOS EST EXACTEMENT LE DESSIN FIXE. L'extracteur des dossiers
   * (extract-frutiz-explorer.js) sort la même image 1 sous `ico_dossier_*` ;
   * les deux boîtes doivent coïncider, sans quoi une icône SAUTERAIT au
   * moment où l'animation prend la main. C'est la preuve, au centième de
   * pixel, que les deux chaînes lisent le même dessin.
   */
  const EXPLO = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/frutiz/sprites/explorateur.json'), 'utf8'));
  for (const [type, jeu] of Object.entries(MAN.types)) {
    const fixe = EXPLO['ico_dossier_' + type];
    if (!fixe) continue;                     // « mail » n'a pas de dessin fixe
    const r = MAN.repos[jeu];
    for (const k of ['x', 'y', 'w', 'h']) {
      assert.ok(Math.abs(fixe[k] - r[k]) < 0.02,
        type + ' : le repos (' + r[k] + ') s’écarte du dessin fixe (' + fixe[k] + ') sur ' + k);
    }
  }
});

test('le survol joue 1 → 8, la sortie 8 → 1, deux images par battement', () => {
  // La mécanique d'`AnimList.playFrame`, au chiffre près.
  assert.match(JS, /zone\.addEventListener\('pointerenter', function \(\) \{ jouer\(man\.images, man\.pas\); \}\);/);
  assert.match(JS, /zone\.addEventListener\('pointerleave', function \(\) \{ jouer\(1, -man\.pas\); \}\);/);
  assert.match(JS, /n = pas > 0 \? Math\.min\(n \+ pas, fin\) : Math\.max\(n \+ pas, fin\);/);
  assert.match(JS, /\}, man\.intervalle\);/);
  // Un survol qui repart en sens inverse ARRÊTE le battement en cours : sans
  // ça, deux minuteurs se disputeraient la même image.
  assert.match(JS, /if \(minuteur\) \{ clearInterval\(minuteur\); minuteur = 0; \}\s*\n\s*if \(n === fin\) return;/);
  // Les huit images sont demandées d'avance : le premier survol ne doit pas
  // montrer de trous le temps que les fichiers arrivent.
  assert.match(JS, /for \(var p = 2; p <= man\.images; p\+\+\) \(new Image\(\)\)\.src = fichierAnime\(jeu, p\);/);
});

test('les trois tuiles du bureau qui bougent : courrier, disques, carnet', () => {
  // « boîte aux lettres, mes jeux, et peut-être d'autres » : ce sont les trois
  // rubriques du portage qui sont, d'époque, des DOSSIERS de la rangée
  // d'icônes. Les autres tuiles sont des raccourcis (`linkScore`, `linkShop`…)
  // ou des formes nues (la corbeille, la liste noire).
  assert.match(JS, /var TUILES_ANIMEES = \{ mail: 'mail', disques: 'disccollector', contacts: 'contact' \};/);
  assert.match(JS, /animerTuilesBureau\(grille\);/, 'branchées au montage du bureau');
  // La tuile CENTRE son dessin dans une case de 64 × 44 ; le cadre commun,
  // lui, déborde vers le haut. Des marges NÉGATIVES rendent ce débord, pour
  // que la case mesure l'image au repos et la centre comme avant.
  assert.match(JS, /img\.style\.marginTop = \(-\(repos\.y - cadre\.y\) \* k\) \+ 'px';/);
  assert.match(JS, /img\.style\.marginBottom = \(-\(cadre\.y \+ cadre\.h - repos\.y - repos\.h\) \* k\) \+ 'px';/);
  assert.match(JS, /var TUILE_ECHELLE = 0\.6;/, 'la règle des dessins de fileIcon.swf sur le bureau');
  // Et la règle générique de taille ne doit plus les rogner.
  assert.match(CSS, /\.home-tile \.ico img\.ico-anim \{\s*\n\s*max-width: none; max-height: none;\s*\n\s*\}/);

  // Vérification de la règle des 0,60 : à cette échelle, l'image au repos
  // retrouve la boîte que la feuille de style donnait déjà aux tuiles.
  const attendu = { mail: [37, 27], contacts: [35, 26], disques: [33, 33] };
  for (const [go, jeu] of Object.entries(
    { mail: 'mail', contacts: 'contact', disques: 'disccollector' })) {
    const r = MAN.repos[jeu];
    const [l, h] = attendu[go];
    assert.ok(Math.abs(r.w * 0.6 - l) <= 1 && Math.abs(r.h * 0.6 - h) <= 1,
      go + ' : ' + (r.w * 0.6).toFixed(1) + '×' + (r.h * 0.6).toFixed(1)
      + ' au lieu de ' + l + '×' + h);
  }
});

test('un dossier de l’explorateur s’anime aussi, sans bouger d’un pixel', () => {
  // `but.Icon` est le même composant dans la fenêtre que sur le bureau : un
  // sous-dossier du carnet (type « mycontact ») s'ouvre au survol comme la
  // tuile. Là, le dessin est posé par l'ORIGINE de son clip (`dessinStandard`)
  // — le cadre commun suffit, aucune marge à corriger.
  assert.match(JS, /var jeu = jeuAnime\(typeDossier\);/);
  assert.match(JS, /\? dessinStandard\('ico_anim_' \+ jeu \+ '_1', undefined, cadresAnimes\(\)\.cadres\[jeu\]\)/);
  assert.match(JS, /if \(jeu\) animerIcone\(dossier, ico, jeu\);/);
  assert.match(JS, /function dessinStandard\(nom, ratio, cadre\) \{\s*\n\s*var c = cadre \|\| cadresExplorateur\(\)\[nom\];/);
});
