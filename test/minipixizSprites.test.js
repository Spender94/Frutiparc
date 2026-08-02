// Les dessins de Minipixiz, sortis du SWF.
//
// Le jeton n'est pas une image mais SEIZE, une par façon d'être relié à ses
// voisins — haut 1, droite 2, bas 4, gauche 8, plus un. C'est ce qui fait qu'un
// groupe se lit comme une seule tache au lieu de quatre carrés, et c'est toute
// la lisibilité du jeu. Se tromper d'image ne fait rien planter : ça rend
// simplement le plateau illisible, ce qu'aucun test de « le fichier existe » ne
// verrait.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'public/minipixiz/sprites');
const MANIFESTE = path.join(DOSSIER, 'sprites.json');
const sprites = JSON.parse(fs.readFileSync(MANIFESTE, 'utf8'));
const SWF = path.join(ROOT, 'Games/miniTroll/swf/root.swf');

test('le SWF lu est celui qui a gardé ses noms', () => {
  // Games/miniTroll/minipixiz.swf est obfusqué : ses symboles sont du bruit et
  // on n'y retrouverait ni « token » ni « stone ». swf/root.swf est le même jeu
  // avant obfuscation. L'extracteur doit lire celui-là.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/extract-minipixiz-sprites.js'), 'utf8');
  assert.match(src, /Games\/miniTroll\/swf\/root\.swf/, 'l\'extracteur lit le SWF non obfusqué');
  assert.ok(fs.existsSync(SWF), 'et ce fichier existe');
  // La preuve par les symboles : le nom « token » n'est présent que dans l'un.
  const lisible = (p) => {
    const raw = fs.readFileSync(p);
    const b = raw.slice(0, 3).toString('ascii') === 'CWS'
      ? require('node:zlib').inflateSync(raw.slice(8)) : raw.slice(8);
    return b.toString('latin1').includes('impCell');
  };
  assert.equal(lisible(SWF), true, 'root.swf porte les vrais noms');
  assert.equal(lisible(path.join(ROOT, 'Games/miniTroll/minipixiz.swf')), false,
    'le SWF livré, lui, est obfusqué');
});

test('tous les dessins du jeu sont là', () => {
  for (const cle of ['token', 'stone', 'impCell', 'bomb', 'elItem', 'star', 'marble']) {
    assert.ok(sprites[cle], `le dessin « ${cle} » est extrait`);
    assert.ok(sprites[cle].etats.length > 0, `« ${cle} » a au moins un état`);
  }
});

test('le jeton porte ses seize liaisons, plus l\'armure', () => {
  const etats = sprites.token.etats;
  for (let f = 1; f <= 16; f++) {
    const e = etats.find((x) => x.frame === f);
    assert.ok(e, `l'image ${f} existe`);
    assert.ok(e.pieces.length >= 1, `l'image ${f} a un dessin`);
  }
  assert.ok(etats.find((x) => x.frame === 20), 'et l\'armure, à l\'image 20');
  assert.equal(etats.length, 17, 'dix-sept états, sans la queue de scénario');
});

test('chaque liaison a son propre corps — le clip imbriqué suit bien l\'image', () => {
  // Le piège : aplatir naïvement le jeton donne seize contours différents et
  // seize fois le MÊME corps (la première image du clip imbriqué). Le corps
  // porte la forme — angles arrondis là où il n'y a pas de voisin, carrés là où
  // il y en a un. Si tous les corps étaient identiques, aucun groupe ne se
  // lirait.
  const corps = new Set();
  for (let f = 1; f <= 16; f++) {
    const e = sprites.token.etats.find((x) => x.frame === f);
    // Le corps fait 100×100 ; le contour, plus petit, est le rebord supérieur.
    const c = e.pieces.find((p) => p.w === 100 && p.h === 100);
    assert.ok(c, `l'image ${f} a un corps`);
    corps.add(c.fichier);
  }
  assert.ok(corps.size >= 10,
    `les corps diffèrent d'une liaison à l'autre (${corps.size} dessins distincts sur 16)`);
});

test('le contour n\'est posé que là où il a lieu d\'être', () => {
  // Il ne dessine que le rebord SUPÉRIEUR : il n'apparaît donc que sur les
  // images sans voisin au-dessus, c'est-à-dire les images impaires (le bit du
  // haut vaut 1, et l'image vaut 1 + bits).
  for (let f = 1; f <= 16; f++) {
    const e = sprites.token.etats.find((x) => x.frame === f);
    const contour = e.pieces.find((p) => p.w !== 100 || p.h !== 100);
    const voisinDessus = ((f - 1) & 1) !== 0;
    if (voisinDessus) {
      assert.equal(contour, undefined, `image ${f} : voisin au-dessus, pas de rebord`);
    } else {
      assert.ok(contour, `image ${f} : pas de voisin au-dessus, il faut le rebord`);
    }
  }
});

test('chaque pièce sait où se poser dans sa case', () => {
  // Les contours ne sont PAS centrés (le rebord occupe le haut). Les poser
  // centrés les décalerait tous : d'où le coin haut-gauche, lu dans le viewBox.
  for (const [cle, sp] of Object.entries(sprites)) {
    for (const e of sp.etats) {
      for (const p of e.pieces) {
        assert.equal(typeof p.x, 'number', `${cle} f${e.frame} : abscisse du dessin`);
        assert.equal(typeof p.y, 'number', `${cle} f${e.frame} : ordonnée`);
        assert.ok(p.w > 0 && p.h > 0, `${cle} f${e.frame} : dimensions`);
      }
    }
  }
  // Le rebord du jeton commence bien en haut de la case, pas au milieu.
  const rebord = sprites.token.etats.find((x) => x.frame === 1)
    .pieces.find((p) => p.w !== 100);
  assert.ok(rebord.y < 20, `le rebord est en haut de la case (y = ${rebord.y})`);
});

test('la pierre montre son usure', () => {
  // sp/el/Stone.setLife : `skin.gotoAndStop(life)`. Trois points de vie, trois
  // images — une pierre entamée doit se voir, sinon on ne sait pas où frapper.
  assert.equal(sprites.stone.etats.length, 3, 'trois états d\'usure');
  const fichiers = new Set(sprites.stone.etats.map((e) => e.pieces[0].fichier));
  assert.equal(fichiers.size, 3, 'et trois dessins différents');
});

test('les fichiers annoncés existent tous, et ne sont pas vides', () => {
  const vus = new Set();
  for (const sp of Object.values(sprites)) {
    for (const e of sp.etats) {
      for (const p of e.pieces) {
        const f = path.join(DOSSIER, p.fichier);
        assert.ok(fs.existsSync(f), `${p.fichier} existe`);
        const t = fs.readFileSync(f, 'utf8');
        assert.ok(/<(path|rect|circle|polygon|ellipse|image)\b/.test(t),
          `${p.fichier} contient un vrai dessin`);
        vus.add(p.fichier);
      }
    }
  }
  assert.ok(vus.size >= 30, `le jeu emporte ses dessins (${vus.size})`);
});

test('l\'extraction est reproductible depuis le SWF', () => {
  const avant = new Map();
  for (const f of fs.readdirSync(DOSSIER)) avant.set(f, fs.readFileSync(path.join(DOSSIER, f)));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/extract-minipixiz-sprites.js')],
    { cwd: ROOT, stdio: 'ignore' });
  for (const [f, octets] of avant) {
    assert.ok(fs.readFileSync(path.join(DOSSIER, f)).equals(octets),
      `${f} est identique après ré-extraction`);
  }
});

test('le client sait choisir la bonne liaison', () => {
  // C'est la traduction de Group.draw. On la vérifie sur le moteur : un jeton
  // isolé prend l'image 1, un entouré des quatre côtés l'image 16.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /\{ x: 0, y: -1, v: 1 \}, \{ x: 1, y: 0, v: 2 \}, \{ x: 0, y: 1, v: 4 \}, \{ x: -1, y: 0, v: 8 \}/,
    'les quatre directions et leurs bits, comme dans Group.draw');
  assert.match(src, /if \(e\.special === E\.SPECIAL\.ARMURE\) return 20/,
    'l\'armure a son image à part');
  // Et la teinture reprend la transformation de Flash.
  assert.match(src, /- 230/, 'le décalage additif de Mc.setColor + modColor(1, 25)');
});
