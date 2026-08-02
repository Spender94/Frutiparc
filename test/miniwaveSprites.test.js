// Dessins de Miniwave 2 extraits du SWF.
//
// Les fruits ne sont pas dessinés en vecteur dans le jeu : chaque forme n'est
// qu'un cadre rempli d'une image. On récupère donc l'IMAGE d'origine, pas un
// tracé reconverti. Les projectiles, eux, sont de vrais tracés et sortent en SVG.
//
// Ce que ces tests protègent, c'est la correspondance : le bestiaire du moteur
// désigne les ennemis par un INDEX (les niveaux ne connaissent que ça), et le
// manifeste doit fournir un dessin pour chacun de ces index. Une lacune ne se
// verrait pas à la lecture du code — juste par un trou à l'écran.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'public/miniwave/sprites');
const MANIFESTE = path.join(DOSSIER, 'sprites.json');
const sprites = JSON.parse(fs.readFileSync(MANIFESTE, 'utf8'));
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));

const toutesLesPieces = function* () {
  for (const [cle, s] of Object.entries(sprites)) {
    for (const e of s.etats) for (const p of e.pieces) yield { cle, nom: s.nom, frame: e.frame, p };
  }
};

test('chaque ennemi du bestiaire a son dessin', () => {
  for (let t = 0; t < E.ENNEMIS.length; t++) {
    const s = sprites['bads' + t];
    assert.ok(s, `type ${t} (${E.ENNEMIS[t].name}) : dessin présent`);
    assert.ok(s.etats.length > 0, `type ${t} : au moins un état`);
  }
});

test('les six vaisseaux et le boss aussi', () => {
  for (let i = 0; i < E.VAISSEAUX.length; i++) {
    assert.ok(sprites['hero' + i], `vaisseau ${i} (${E.VAISSEAUX[i].name}) présent`);
  }
  assert.ok(sprites.boss, 'le boss est là');
  // Deux images dans sa timeline : la coquille, puis le casque avec ses mains et
  // l'orange. C'est un dessin COMPOSÉ, d'où plusieurs pièces.
  assert.equal(sprites.boss.etats.length, 2, 'ses deux aspects');
  assert.ok(sprites.boss.etats[1].pieces.length > 5,
    `le second est composé de plusieurs pièces (${sprites.boss.etats[1].pieces.length})`);
});

test('les espèces cuirassées ont un dessin par état de coque', () => {
  // Le jeu change d'image quand la coque est entamée : il faut donc autant de
  // dessins que de points de vie, sinon un Citrus à moitié détruit ressemblerait
  // à un Citrus intact.
  for (const [type, etats] of [[1, 2], [7, 2], [17, 3], [12, 2], [15, 2], [22, 2]]) {
    assert.equal(sprites['bads' + type].etats.length, etats,
      `${E.ENNEMIS[type].name} : ${etats} états de coque`);
  }
});

test('tous les fichiers annoncés existent et ne sont pas vides', () => {
  let images = 0, traces = 0;
  for (const { cle, nom, p } of toutesLesPieces()) {
    const f = path.join(DOSSIER, p.fichier);
    assert.ok(fs.existsSync(f), `${cle} (${nom}) : ${p.fichier} existe`);
    const taille = fs.statSync(f).size;
    assert.ok(taille > 60, `${cle} : ${p.fichier} n'est pas vide (${taille} o)`);
    if (p.fichier.endsWith('.png')) {
      images++;
      // Un vrai PNG commence par sa signature : le fichier n'est pas un reste
      // d'écriture partielle.
      const tete = fs.readFileSync(f).subarray(0, 8);
      assert.deepEqual([...tete], [137, 80, 78, 71, 13, 10, 26, 10], `${p.fichier} est un PNG valide`);
    } else {
      traces++;
      const svg = fs.readFileSync(f, 'utf8');
      assert.ok(/<svg[\s\S]*<\/svg>/.test(svg), `${p.fichier} est un SVG complet`);
      // Le piège rencontré pendant l'extraction : un SVG bien formé mais SANS
      // aucun tracé, parce que la forme n'était qu'un cadre à remplir d'image.
      assert.ok(/<(path|rect|circle|polygon|image)\b/.test(svg),
        `${p.fichier} contient un dessin, pas seulement une balise vide`);
    }
  }
  assert.ok(images > 50, `les fruits sortent en image (${images})`);
  assert.ok(traces > 0, `et les projectiles en tracé (${traces})`);
});

test('chaque pièce sait où et à quelle taille se poser', () => {
  for (const { cle, p } of toutesLesPieces()) {
    assert.ok(Array.isArray(p.m) && p.m.length === 6, `${cle} : matrice de placement`);
    assert.ok(p.m.every(Number.isFinite), `${cle} : matrice calculable (${p.m})`);
    assert.ok(p.w > 0 && p.h > 0, `${cle} : taille du cadre connue (${p.w}x${p.h})`);
    assert.ok(p.w < 400 && p.h < 400, `${cle} : taille plausible pour une aire de 240 (${p.w}x${p.h})`);
  }
});

test('le lot livré est bien ce que l\'extracteur tire du SWF', () => {
  // Même garantie que pour les niveaux : on rejoue l'extraction et on compare.
  // Si le manifeste est retouché à la main, ou si l'extracteur dérive, ça se voit.
  const avant = fs.readFileSync(MANIFESTE, 'utf8');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/extract-miniwave-sprites.js')],
    { cwd: ROOT, stdio: 'ignore' });
  assert.equal(fs.readFileSync(MANIFESTE, 'utf8'), avant,
    'public/miniwave/sprites/sprites.json est reproductible depuis Games/miniWave2');
});

// ── Le décor ───────────────────────────────────────────────────────────────
// Le fond du jeu est une bande verticale de quatre sections de 240×1000 qu'on
// remonte au fil des niveaux. Elles sont stockées en DefineBits — le plus ancien
// format d'image de Flash, dont les tables JPEG vivent dans un tag séparé : un
// bloc pris seul est illisible, il faut les recoller.

test('les quatre sections du décor sont extraites et lisibles', () => {
  const decor = path.join(ROOT, 'public/miniwave/decor');
  const attendues = ['bitmap1.jpg', 'bitmap3.jpg', 'bitmap5.jpg', 'bitmap7.jpg'];
  for (const f of attendues) {
    const p = path.join(decor, f);
    assert.ok(fs.existsSync(p), `${f} extraite`);
    const o = fs.readFileSync(p);
    assert.ok(o.length > 20000, `${f} a du contenu (${o.length} o)`);
    // Un JPEG recollé doit commencer par SOI et finir par EOI : c'est la preuve
    // que les tables partagées ont bien été raboutées aux données.
    assert.equal(o[0], 0xFF, `${f} commence par un marqueur JPEG`);
    assert.equal(o[1], 0xD8, `${f} : SOI présent`);
    assert.equal(o[o.length - 2], 0xFF, `${f} : fin de flux`);
    assert.equal(o[o.length - 1], 0xD9, `${f} : EOI présent`);
    // Et il doit contenir une table de Huffman (DHT) : sans elle, le décodeur
    // du navigateur refuserait l'image — c'est exactement ce qui manquait avant.
    let dht = false;
    for (let i = 0; i < o.length - 1; i++) if (o[i] === 0xFF && o[i + 1] === 0xC4) { dht = true; break; }
    assert.ok(dht, `${f} porte ses tables de Huffman`);
  }
});

test('le décor défile d\'un niveau à l\'autre', () => {
  const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));
  const jeu = new E.Game({ levels: NIVEAUX.main[0].levels, graine: 1 });
  assert.equal(jeu.defilementDecor(), 0, 'au premier niveau, on est en bas de la bande');
  jeu.level = 10;
  assert.ok(Math.abs(jeu.defilementDecor() - 10 * E.DECOR_DECAL) < 0.001,
    'le défilement suit le niveau atteint');
  // Sur les 201 niveaux de l'arcade, on traverse bien les quatre sections.
  jeu.level = 200;
  const total = jeu.defilementDecor();
  assert.ok(total > 3000 && total < 4000,
    `le parcours complet couvre les quatre sections de 1000 px (${Math.round(total)})`);
});
