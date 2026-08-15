#!/usr/bin/env node
// Sort les dessins de MiniFever du SWF, en SVG, pour le portage natif.
//
//   node scripts/extract-minifever-sprites.js            → écrit public/minifever/sprites/
//   node scripts/extract-minifever-sprites.js --liste    → montre ce qui serait extrait
//   node scripts/extract-minifever-sprites.js --planche  → une planche-contact à identifier
//
// ── Le problème, et sa solution ──
//
// MiniFever n'a jamais été mis en ligne. Il en reste deux choses : les SOURCES
// (Games/miniFever/src, quatre-vingt-dix mini-jeux écrits en « mt », le langage
// maison de Motion Twin, ancêtre de Haxe — son compilateur n'existe plus) et un
// SWF de développement (release/swf/minifever.swf).
//
// Ce SWF est OBFUSQUÉ : les cent vingt et un symboles exportés portent des noms
// tirés au sort (« 87GnN2 », « 4okHh2 »…), et les noms de classes ont disparu du
// binaire. Impossible, à première vue, de savoir quel dessin appartient à quel
// mini-jeu.
//
// Le fil qu'on tire : Manager.registerSymphony() enregistre les classes une par
// une, DANS UN ORDRE FIXE, par des appels
//
//     Std.registerClass( "gameBasket", game.Basket );
//
// L'obfuscation a renommé la chaîne « gameBasket », mais elle n'a pas réordonné
// les appels. On lit donc dans le bytecode la suite des vingt-huit
// `Object.registerClass` — chacun poussant (classe, nom de liaison) — et on
// l'aligne sur la liste des sources. Les noms alignés se vérifient à l'œil :
// gameBalance montre une balance, gameMarmite une marmite, gameHammer un jeu de
// taupes au maillet, gameLander un sol lunaire sous les étoiles. C'est la table
// ci-dessous.
//
// Le décalage de six est celui du build : ce SWF de développement n'enregistre
// ni les quatre modes ni le menu (Manager.init() y saute directement au mode
// Fever, le client plateforme est commenté). Il commence donc à `gameOver`, et
// s'arrête après vingt-sept mini-jeux — les soixante-deux suivants de la liste
// des sources n'ont jamais été compilés dans cette version.
//
// Les autres symboles (une petite centaine) sont les clips que les mini-jeux
// accrochent à la volée (`dm.attach("mcBasketBall", …)`). Leurs noms sont perdus
// eux aussi ; ils sortent sous leur identifiant, et le portage les rattache un
// par un. `--planche` fabrique la planche-contact qui sert à les reconnaître.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { ouvrir } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'Games/miniFever/release/swf/minifever.swf');
const SOURCES = path.join(RACINE, 'Games/miniFever/src/Manager.mt');
const SORTIE = path.join(RACINE, 'public/minifever/sprites');

// Le build ne commence pas au début de la liste des sources : il saute les
// quatre modes, le menu et l'écran de félicitations, qu'il n'enregistre pas.
const DECALAGE = 6;

/**
 * Les noms de liaison enregistrés par le SWF, dans l'ordre du bytecode.
 *
 * On parcourt les DoAction/DoInitAction, on y retient la constante `pool` et la
 * suite des `Push`, puis on relève les constantes poussées juste avant chaque
 * « registerClass ». L'appel AS2 `Object.registerClass(nom, classe)` empile ses
 * arguments à l'envers : classe, puis nom — le NOM est donc l'avant-dernière
 * constante avant « Object », et c'est la seule des deux qui figure parmi les
 * symboles exportés (ce qu'on vérifie).
 */
function liensEnregistres(b) {
  let trouve = null;
  const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;

  const parcourir = (de, a) => {
    let p = de;
    while (p < a - 1) {
      const h = b.readUInt16LE(p);
      const code = h >> 6;
      let len = h & 0x3f, hs = 2;
      if (len === 0x3f) { len = b.readUInt32LE(p + 2); hs = 6; }
      if (code === 0) break;
      if (code === 12 || code === 59) {            // DoAction / DoInitAction
        let q = p + hs + (code === 59 ? 2 : 0);
        const fin = p + hs + len;
        let pool = null;
        const pousses = [];
        while (q < fin) {
          const a1 = b[q];
          if (a1 < 0x80) { q++; continue; }        // action sans corps
          const ln = b.readUInt16LE(q + 1);
          if (a1 === 0x88) {                       // ConstantPool
            const n = b.readUInt16LE(q + 3);
            let r = q + 5;
            pool = [];
            for (let i = 0; i < n; i++) {
              const e = b.indexOf(0, r);
              pool.push(b.slice(r, e).toString('latin1'));
              r = e + 1;
            }
          }
          if (a1 === 0x96) {                       // Push
            let r = q + 3;
            const lim = q + 3 + ln;
            while (r < lim) {
              const t = b[r++];
              if (t === 0) { const e = b.indexOf(0, r); pousses.push(b.slice(r, e).toString('latin1')); r = e + 1; }
              else if (t === 1) { pousses.push(null); r += 4; }
              else if (t === 2 || t === 3) { pousses.push(null); }
              else if (t === 4 || t === 5) { pousses.push(null); r += 1; }
              else if (t === 6) { pousses.push(null); r += 8; }
              else if (t === 7) { pousses.push(null); r += 4; }
              // 8 et 9 : une constante du pool, sur un ou deux octets. Les
              // oublier décalait toute la suite d'un cran.
              else if (t === 8) { pousses.push(pool ? pool[b[r]] : null); r += 1; }
              else if (t === 9) { pousses.push(pool ? pool[b.readUInt16LE(r)] : null); r += 2; }
              else break;
            }
          }
          q += 3 + ln;
        }
        if (pool && pool.includes('registerClass')) {
          // Seules les CHAÎNES comptent : les nombres poussés entre deux (le
          // nombre d'arguments, notamment) ne portent pas de nom. La suite
          // utile est donc « …, classe, nom, Object, registerClass ».
          const chaines = pousses.filter((s) => typeof s === 'string');
          const noms = [];
          chaines.forEach((s, i) => {
            if (s === 'registerClass') noms.push(chaines[i - 2]);
          });
          if (noms.length) trouve = noms;
        }
      }
      if (code === 39) parcourir(p + hs + 4, p + hs + len);   // DefineSprite
      p += hs + len;
    }
  };
  parcourir(debut, b.length);
  if (!trouve) throw new Error('aucun appel registerClass trouvé dans le SWF');
  return trouve;
}

// La liste des sources, dans l'ordre — c'est elle qui donne les vrais noms.
function classesDesSources() {
  const src = fs.readFileSync(SOURCES, 'utf8');
  return [...src.matchAll(/Std\.registerClass\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

function principal() {
  const brut = fs.readFileSync(SWF);
  const b = brut.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(brut.slice(8)) : brut.slice(8);
  const swf = ouvrir(SWF);

  const liens = liensEnregistres(b);
  const attendus = classesDesSources();
  const exportes = new Set([...swf.noms.keys()]);
  for (const l of liens) {
    if (!exportes.has(l)) throw new Error(`« ${l} » n'est pas un symbole exporté — l'alignement est faux`);
  }
  // nom de liaison obfusqué → nom de classe des sources
  const nomDe = new Map();
  liens.forEach((l, i) => {
    const c = attendus[i + DECALAGE];
    if (c) nomDe.set(l, c);
  });
  console.log(`${liens.length} classes enregistrées, alignées sur les sources `
    + `(${nomDe.get(liens[0])} … ${nomDe.get(liens[liens.length - 1])})`);

  // Toutes les images de tous les symboles exportés. Les clips de mini-jeu
  // portent leur vrai nom ; les autres gardent leur identifiant. Une image
  // VIDE reste dans la liste (pieces: []) : c'est une vraie image-clé du clip
  // — la bouffée du souffle de Gather s'éteint ainsi à sa septième image, et
  // la laisser tomber ferait resurgir la première.
  const etatsDe = (id, o) => {
    o = o || {};
    const images = swf.parSprite.get(id);
    if (!images || images.size === 0) return [];
    const etats = [];
    for (const f of [...images.keys()].sort((x, y) => x - y)) {
      const pieces = [];
      let masque = false;
      for (const p of images.get(f)) {
        if (o.sansEnfantsNommes && p.nom) continue;
        const morceaux = swf.aplatir(p.ch, p.M, 0, undefined, '', p.cx);
        if (p.masque && !o.masquesEnPieces) { masque = true; continue; }
        for (const m of morceaux) {
          if (m.masque && !o.masquesEnPieces) { masque = true; continue; }
          pieces.push(m);
        }
      }
      for (const pc of pieces) formes.add(pc.shape);
      etats.push(masque ? { frame: f, masque: true, pieces } : { frame: f, pieces });
    }
    return etats;
  };
  const cellules = [];
  const formes = new Set();
  for (const [obf, id] of swf.noms.entries()) {
    if (!swf.estSprite(id)) continue;
    const etats = etatsDe(id);
    if (!etats.some((e) => e.pieces.length)) continue;
    cellules.push({ cle: nomDe.get(obf) || ('sym' + id), obf, id, etats });
  }

  // Les SUPPLÉMENTS : ce qu'un jeu pilote SÉPARÉMENT de son parent. Le clip
  // mcTube de Tubulo (sym210) n'a que deux enfants : le tube — nommé, trois
  // images, que le jeu fait plonger et changer d'état — et une forme qui lui
  // sert de MASQUE (la fenêtre capsule). On sort le tube sous son propre
  // identifiant (sym209), et sym210 devient la forme du masque, gardée en
  // pièces pour que le client puisse en faire une découpe.
  const SUPPLEMENTS = [
    { cle: 'sym209', id: 209 },
    { cle: 'sym210', id: 210, sansEnfantsNommes: true, masquesEnPieces: true },
    // La pièce détachée de Patate (mcPatateElement, sym40) : chaque image
    // porte un enfant nommé — les yeux, le nez, la bouche, quatre à cinq
    // variantes chacun — que le jeu feuillette (skin.e.gotoAndStop). L'enfant
    // sort par emplacement, et le clip parent SANS lui garde la punaise.
    { cle: 'sym26', id: 26 },
    { cle: 'sym32', id: 32 },
    { cle: 'sym39', id: 39 },
    { cle: 'sym40', id: 40, sansEnfantsNommes: true },
  ];
  for (const s of SUPPLEMENTS) {
    const etats = etatsDe(s.id, s);
    if (!etats.some((e) => e.pieces.length)) throw new Error(`supplément ${s.cle} : rien à dessiner`);
    const deja = cellules.findIndex((c) => c.cle === s.cle);
    const cellule = { cle: s.cle, obf: deja >= 0 ? cellules[deja].obf : null, id: s.id, etats };
    if (deja >= 0) cellules[deja] = cellule;
    else cellules.push(cellule);
  }
  const nommes = cellules.filter((c) => !/^sym/.test(c.cle)).length;
  console.log(`${cellules.length} symboles dessinables — ${nommes} nommés, `
    + `${cellules.length - nommes} à identifier (cf. --planche)`);

  if (process.argv.includes('--liste')) {
    for (const c of cellules) {
      console.log(`  ${c.cle.padEnd(16)} #${String(c.id).padEnd(4)} ${c.etats.length} image(s)`);
    }
    return;
  }

  fs.mkdirSync(SORTIE, { recursive: true });
  const brutFormes = execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), SWF, SORTIE, ...[...formes].map(String)],
    { cwd: RACINE, encoding: 'utf8', maxBuffer: 64e6 });
  const ecrites = new Map();
  for (const m of brutFormes.matchAll(/^#(\d+) → \S*?([^/\s]+\.svg)/gm)) ecrites.set(Number(m[1]), m[2]);

  // Les bornes de chaque forme, pour poser le dessin au bon endroit.
  const bornes = new Map();
  const inv = execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), SWF], { cwd: RACINE, encoding: 'utf8', maxBuffer: 64e6 });
  for (const ligne of inv.split('\n')) {
    const m = /^#(\d+)\t\S+\t(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)\t(.*)$/.exec(ligne);
    if (!m) continue;
    const o = /\t@(-?[\d.]+),(-?[\d.]+)\s*$/.exec(m[4]);
    bornes.set(Number(m[1]), {
      w: Number(m[2]), h: Number(m[3]),
      x0: o ? Number(o[1]) : -Number(m[2]) / 2,
      y0: o ? Number(o[2]) : -Number(m[3]) / 2,
    });
  }

  const manifeste = {};
  const perdues = [];
  for (const c of cellules) {
    const etats = [];
    for (const e of c.etats) {
      const pieces = [];
      for (const pc of e.pieces) {
        const fichier = ecrites.get(pc.shape);
        const info = bornes.get(pc.shape);
        if (!fichier || !info) { perdues.push(`${c.cle} #${pc.shape}`); continue; }
        const piece = {
          fichier, w: info.w, h: info.h,
          m: [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20]
            .map((v) => Math.round(v * 1e4) / 1e4),
        };
        if (Math.abs(info.x0 + info.w / 2) > 0.5 || Math.abs(info.y0 + info.h / 2) > 0.5) {
          piece.o = [Math.round(info.x0 * 100) / 100, Math.round(info.y0 * 100) / 100];
        }
        if (pc.cx) {
          piece.cx = {
            m: [pc.cx.mr, pc.cx.mv, pc.cx.mb, pc.cx.ma].map(Math.round),
            a: [pc.cx.ar, pc.cx.av, pc.cx.ab, pc.cx.aa].map(Math.round),
          };
        }
        pieces.push(piece);
      }
      etats.push(e.masque ? { frame: e.frame, masque: true, pieces } : { frame: e.frame, pieces });
    }
    if (!etats.some((e) => e.pieces.length)) continue;
    manifeste[c.cle] = { symbole: c.obf, id: c.id, etats };
  }
  if (perdues.length) console.log(`pièces non extraites (${perdues.length}) : ${perdues.slice(0, 8).join(', ')}…`);

  const dest = path.join(SORTIE, 'sprites.json');
  fs.writeFileSync(dest, JSON.stringify(manifeste), 'utf8');
  const total = Object.values(manifeste).reduce((n, m) => n + m.etats.length, 0);
  console.log(`→ ${path.relative(RACINE, dest)} (${Object.keys(manifeste).length} symboles, ${total} images)`);
}

if (require.main === module) principal();
module.exports = { liensEnregistres, classesDesSources, DECALAGE };
