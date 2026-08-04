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
        if (/\.(png|jpg)$/.test(p.fichier)) {
          // Tout n'est pas vectoriel : le plancher de l'ascenseur du donjon est
          // une image posée telle quelle dans le fichier d'origine.
          assert.ok(fs.statSync(f).size > 100, `${p.fichier} n'est pas une image vide`);
        } else {
          const t = fs.readFileSync(f, 'utf8');
          assert.ok(/<(path|rect|circle|polygon|ellipse|image)\b/.test(t),
            `${p.fichier} contient un vrai dessin`);
        }
        vus.add(p.fichier);
      }
    }
  }
  assert.ok(vus.size >= 30, `le jeu emporte ses dessins (${vus.size})`);
});

test('l\'extraction est reproductible depuis le SWF', () => {
  // Les dessins du second fichier (gfx.swf) vivent dans un sous-dossier : on
  // parcourt donc l'arborescence, pas seulement le premier niveau.
  const tout = (dir, prefixe) => {
    let l = [];
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) l = l.concat(tout(p, prefixe + f + '/'));
      else l.push(prefixe + f);
    }
    return l;
  };
  const avant = new Map();
  for (const f of tout(DOSSIER, '')) avant.set(f, fs.readFileSync(path.join(DOSSIER, f)));
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
  // Et la teinture reprend la transformation de Flash : setColor décale de
  // couleur − 255, modColor rajoute l'éclat — 25 pour la peau des jetons,
  // 125 pour la perle et l'étoile éclaircies par bmEnlight.
  assert.match(src, /const a = 255 - \(\(ajout === undefined\) \? 25 : ajout\);/,
    'le décalage additif de Mc.setColor + modColor(1, éclat)');
});

// ── Le décor, le cadre, la fée ────────────────────────────────────────────
//
// Le portage ne se joue pas que sur les règles : un Minipixiz qui ne
// ressemblerait pas à Minipixiz ne serait pas Minipixiz. Ces tests fixent ce
// qui fait son allure — le cadre de racines, les portraits, les plans du décor.

test('le cadre de la forêt a bien ses trois morceaux', () => {
  // base/Forest.initSkin attache interfaceRacine TROIS fois, sur trois
  // profondeurs, en s'arrêtant sur les images 1, 2 et 3 : le sol derrière le
  // plateau, le panneau de la fée devant, le feuillage par-dessus tout.
  const c = sprites.cadre;
  assert.ok(c, 'le cadre est extrait');
  assert.deepEqual(c.etats.map((e) => e.frame), [1, 2, 3]);
  for (const e of c.etats) assert.ok(e.pieces.length > 0, `image ${e.frame} dessinée`);

  // Le fond (image 3) couvre le plateau, le montant (image 2) la colonne.
  const boite = (f) => {
    const e = c.etats.find((x) => x.frame === f);
    let x0 = Infinity, x1 = -Infinity;
    for (const p of e.pieces) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + p.w); }
    return { x0, x1 };
  };
  assert.ok(boite(3).x0 < 10 && boite(3).x1 > 100, 'l\'image 3 tient le plateau');
  assert.ok(boite(2).x0 > 100, 'l\'image 2 se tient à droite, où vit la fée');
});

test('les neuf plans du décor sont là, du plus lointain au plus proche', () => {
  for (const k of ['horizon', 'collines', 'foret3', 'foret2', 'foret',
    'milieu', 'arbre', 'herbe', 'premier', 'nuage']) {
    assert.ok(sprites[k], `le plan ${k} est extrait`);
    assert.ok(sprites[k].etats[0].pieces.length > 0, `et ${k} porte un dessin`);
  }
  // Menu.initDecor les empile du plus loin au plus près ; les plans lointains
  // sont plus hauts sur l'écran que les proches.
  const haut = (k) => Math.min(...sprites[k].etats[0].pieces.map((p) => p.y));
  assert.ok(haut('horizon') < haut('herbe'), 'l\'horizon est au-dessus de l\'herbe');
});

test('les six portraits de fée sont extraits, sans la blague de l\'atelier', () => {
  const p = sprites.portrait;
  assert.ok(p, 'les portraits sont extraits');
  assert.ok(p.etats.length >= 6, `au moins six visages (${p.etats.length})`);
  for (let i = 1; i <= 6; i++) {
    const e = p.etats.find((x) => x.frame === i);
    assert.ok(e && e.pieces.length > 5, `l'image ${i} est un vrai portrait`);
  }
  // Les images 11 et suivantes ne sont qu'une photo de Barbarella laissée dans
  // le fichier : on ne les emporte pas.
  for (const e of p.etats) {
    for (const q of e.pieces) {
      assert.ok(!/bitmap/.test(q.fichier),
        `aucune photo dans les portraits (image ${e.frame} : ${q.fichier})`);
    }
  }
});

test('les morceaux colorables du portrait portent leur nom', () => {
  // Mc.setPic tient chaque morceau par son nom de clip. Sans les noms, toutes
  // les fées auraient la même couleur.
  const noms = new Set();
  for (const e of sprites.portrait.etats) for (const q of e.pieces) if (q.nom) noms.add(q.nom);
  for (const n of ['f.k0', 'f.k1', 'f.w0', 'f.cloth', 'f.o0.p', 'f.o1.p']) {
    assert.ok(noms.has(n), `${n} est nommé (trouvés : ${[...noms].sort().join(', ')})`);
  }
});

test('les masques sont mis de côté, pas dessinés', () => {
  // Un masque est une forme comme une autre dans le fichier — celui du cadre du
  // portrait est un rectangle ROUGE VIF. Le dessiner mettait une barre rouge en
  // travers de la fée.
  for (const [cle, sp] of Object.entries(sprites)) {
    // `nuit` (mcNightMask) EST un masque : c'est le disque que le sort de nuit
    // pose sur l'écran. Son rouge est donc à sa place.
    if (cle === 'nuit') continue;
    for (const e of sp.etats) {
      for (const q of e.pieces) {
        const svg = path.join(DOSSIER, q.fichier);
        if (!/\.svg$/.test(q.fichier)) continue;
        const t = fs.readFileSync(svg, 'utf8');
        // Le masque du jeu est un aplat #ff0000 sans rien d'autre.
        const rougeSeul = /fill="#ff0000"/.test(t) && (t.match(/fill="/g) || []).length === 1;
        assert.ok(!rougeSeul, `${cle} ne dessine pas le masque ${q.fichier}`);
      }
    }
  }
  assert.ok(sprites.interFace.etats[0].masques, 'le cadre du portrait a gardé sa découpe');
  // Celle de la colonne des pièces à venir est PARTIELLE : elle ne s'applique
  // qu'au clip que le jeu remplit lui-même (`mcNext.zone`), pas au dessin
  // entier. Le client s'en sert pour couper les pièces qui montent.
  assert.ok(sprites.suivante.etats[0].masquesPartiels,
    'la colonne des pièces à venir a gardé la sienne');
});

test('un masque ne découpe que sa tranche de profondeurs', () => {
  // Le médaillon du panneau de l'inventaire est un masque de premier niveau,
  // mais son ClipDepth s'arrête au portrait : le fond du panneau, ses deux
  // boutons et sa pastille de niveau vivent au-dessus. L'appliquer au dessin
  // entier rognait le panneau à son médaillon.
  const e = sprites.invPanneau.etats[0];
  assert.ok(!e.masques, 'le médaillon ne prend pas tout le panneau');
  assert.ok(e.masquesPartiels && e.masquesPartiels.length === 1, 'il est retenu à part');
  const m = e.masquesPartiels[0];
  assert.ok(m.fichier, 'avec son DESSIN, pas seulement son cadre : c\'est un disque');
  const marquees = e.pieces.filter((p) => p.msq === m.num);
  assert.ok(marquees.length > 0, 'le portrait est découpé');
  assert.ok(marquees.every((p) => (p.nom || '').indexOf('pic') === 0),
    'et lui seul : ' + e.pieces.filter((p) => p.msq).map((p) => p.nom).join(', '));
});

test('le panneau de la fée sort un visage par image', () => {
  // `Mc.setPic(facePanel.pic, fi.skin)` envoie le clip du portrait sur l'image
  // du visage tiré. Le panneau doit donc en porter autant.
  assert.equal(sprites.invPanneau.etats.length, 10);
  const dessin = (n) => JSON.stringify(sprites.invPanneau.etats[n].pieces.map((p) => p.fichier));
  assert.notEqual(dessin(0), dessin(2), 'deux visages, deux dessins');
  // Ses boutons en sont sortis : ils ont leur propre image, et seraient partis
  // défiler avec les visages.
  const noms = new Set();
  for (const e of sprites.invPanneau.etats) for (const p of e.pieces) if (p.nom) noms.add(p.nom);
  for (const n of ['swap', 'quit', 'level']) assert.ok(!noms.has(n), n + ' est sorti du panneau');
  assert.ok(sprites.invPanneau.ancrages.swap, 'mais son ancre est gardée');
  assert.equal(sprites.invBouton.etats.length, 16, 'le bouton a ses seize images');
});

test('chaque pièce porte sa matrice, pour les dessins retournés', () => {
  // L'aile droite de la fée est l'aile gauche à l'envers (a = -1) et le masque
  // du cadre est étiré de 32 à 94 px. Sans la matrice, les deux seraient faux.
  let miroirs = 0, etires = 0;
  for (const sp of Object.values(sprites)) {
    for (const e of sp.etats) {
      for (const q of e.pieces) {
        assert.ok(Array.isArray(q.m) && q.m.length === 6, 'six coefficients');
        assert.ok(Array.isArray(q.vb) && q.vb.length === 4, 'et le cadre du SVG');
        if (q.m[0] < 0 || q.m[3] < 0) miroirs++;
        if (Math.abs(q.m[0]) > 1.5 || Math.abs(q.m[3]) > 1.5) etires++;
      }
    }
  }
  assert.ok(miroirs > 0, `des dessins retournés (${miroirs})`);
  assert.ok(etires > 0, `des dessins étirés (${etires})`);
});

test('l\'interface de la fée est complète : cadre, cœurs, gouttes, aperçu', () => {
  for (const k of ['interFace', 'coeur', 'mana', 'suivante', 'fee']) {
    assert.ok(sprites[k], `${k} est extrait`);
  }
  // inter.Life et inter.Mana : deux images chacune, vide et pleine.
  assert.deepEqual(sprites.coeur.etats.map((e) => e.frame), [1, 2]);
  assert.deepEqual(sprites.mana.etats.map((e) => e.frame), [1, 2]);
  // Et leurs tailles sont bien celles des écarts du jeu (14 px, 6 px).
  const large = (k) => Math.max(...sprites[k].etats[0].pieces.map((p) => p.w));
  assert.ok(large('coeur') > 10 && large('coeur') < 18, `un cœur fait ${large('coeur')} px`);
  assert.ok(large('mana') > 3 && large('mana') < 9, `une goutte fait ${large('mana')} px`);
});
