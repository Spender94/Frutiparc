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
const { ouvrir, composer } = require('./lib/swf-sprites.js');

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
      let pieces = [];
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
      // `formes` : ne garder que ces dessins-là — pour scinder un clip en
      // tranches (l'arrière du trou du maillet, puis sa margelle).
      if (o.formes) pieces = pieces.filter((pc) => o.formes.includes(pc.shape));
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
    // La BOMBE (gameBomb, sym92) : ses acteurs sont des enfants de TIMELINE,
    // pas des attachMovie — seuls la mèche (sym64) et les clips accrochés par
    // script sortaient déjà sous leur identifiant. On sépare donc :
    // l'étincelle (sym73 — flammes 1 à 4 bouclées par DoAction, fumée
    // étiquetée à l'image 5, stop à 22), le monstre (sym88, trente images,
    // stop à 15 où sa timeline pose flReady), la fenêtre du masque de la
    // mèche (sym67 — un rectangle 100×100 accroché en haut à gauche :
    // _xscale y vaut des pixels). Et la cellule gameBomb elle-même est
    // REPRISE sans ses enfants nommés : le pré, puis les éclairs et le décor
    // de l'explosion — sans quoi le décor que le client pose d'office
    // porterait des copies figées de l'étincelle, du monstre et de la mèche
    // (le monstre soufflé des images 4-6 reste piloté par le jeu).
    { cle: 'sym67', id: 67 },
    { cle: 'sym73', id: 73 },
    { cle: 'sym88', id: 88 },
    { cle: 'gameBomb', id: 92, sansEnfantsNommes: true },
    // LA FALAISE (gameCliff) : la crevasse et le compteur se pilotent par
    // morceaux. Le trou (mcCliffHole, sym371) écarte ses trois enfants — le
    // fond rose (sym368, cent pixels de large : _xscale y vaut la largeur du
    // trou) et le bord friable (sym370, posé droit à l'entrée puis en MIROIR
    // au bout) ; le quart-de-cercle (mcAngleQuart, sym350) fait tourner un
    // carré blanc (sym349, posé à 50 % d'alpha) derrière un masque
    // quart-de-cercle : l'arc se remplit à la visée. On sort le cadran SANS
    // son aiguille, et le carré à part — il sert aussi de fenêtre de découpe.
    { cle: 'sym368', id: 368 },
    { cle: 'sym370', id: 370 },
    { cle: 'sym349', id: 349 },
    { cle: 'sym350', id: 350, sansEnfantsNommes: true },
    // LA CHAÎNE (gameChain) : chaque case (mcChainSlot, sym342) porte un fond
    // nommé « 9A » (sym336, posé à (-50,-50) — la tuile est centrée) que le
    // jeu feuillette à part (« 1 » table, « 2 » bandeau) : on sort le fruit
    // sans son fond, et le fond seul. La scène garde sa BARRE (sym345, la
    // bande blanche à 50 % du bandeau) comme enfant nommé : on la sort
    // aussi, et la scène sans elle.
    { cle: 'sym342', id: 342, sansEnfantsNommes: true },
    { cle: 'sym336', id: 336 },
    { cle: 'sym345', id: 345 },
    { cle: 'gameChain', id: 346, sansEnfantsNommes: true },
    // LE FANTÔME (gameGhost) : la scène cache trois enfants nommés — le
    // TUNNEL de la grotte (« 5Rng », sym272 : la forme rouge invisible que
    // le jeu interroge au hitTest — couverte par le fond, jamais vue) et les
    // deux stalactites (« 3c1 »/« 4c1 », sym275 : dix images, la pique
    // sym274 étirée par paliers). On sort la scène SANS eux (sinon le rouge
    // du tunnel cuirait dans le décor), la pellicule de la stalactite, et
    // les deux formes de collision AVEC leur contour (cf. CONTOURS).
    { cle: 'gameGhost', id: 277, sansEnfantsNommes: true },
    { cle: 'sym275', id: 275 },
    { cle: 'sym272', id: 272 },
    { cle: 'sym274', id: 274 },
    // LA BALANCE (gameBalance) : le fléau (sym258) et les deux plateaux
    // (sym256 — la corde et l'assiette, avec leur conteneur vide « 44Qvg »
    // à +93, celui où l'époque accrochait les poids) sont des enfants
    // nommés de la scène : on les sort, et la scène sans eux garde le pied.
    { cle: 'gameBalance', id: 259, sansEnfantsNommes: true },
    { cle: 'sym256', id: 256 },
    { cle: 'sym258', id: 258 },
    // LE POINT À POINT (gamePoint) : la scène porte la figure — dix-huit
    // pointillés « $p0 » à « $p17 » (les noms en $ ont survécu à
    // l'obfuscation) et le dessin fini « 9kOpo » (sym101), caché jusqu'à la
    // victoire. On sort la scène sans eux (le papier), et le dessin à part.
    { cle: 'gamePoint', id: 103, sansEnfantsNommes: true },
    { cle: 'sym101', id: 101 },
    // L'ESQUIVE SPATIALE (gameSpaceDodge) : le vaisseau-mère (sym628) porte
    // ses dix tourelles « $t0 » à « $t9 » — on sort le fuselage sans elles,
    // la tourelle à part (sa pellicule de recul, rembobinée en boucle par le
    // GotoFrame d'époque de l'image 14), et la scène sans le vaisseau
    // entier — sinon les dix tourelles cuiraient dans le décor, y compris
    // celles que la difficulté cache.
    { cle: 'gameSpaceDodge', id: 629, sansEnfantsNommes: true },
    { cle: 'sym628', id: 628, sansEnfantsNommes: true },
    { cle: 'sym627', id: 627 },
    // LE MAILLET (gameHammer) : dix-huit terriers « $t0 » à « $t17 » sur la
    // scène — on la sort sans eux. Le terrier (sym597) se SCINDE : l'arrière
    // (la forme 566) sous la bestiole, la MARGELLE (596) devant elle — la
    // taupe sort de derrière la lèvre — et sa fenêtre de découpe (sym567,
    // qui monte à -105). La bestiole (sym578, huit espèces) et le coup de
    // maillet (sym595, rappel readyToBlast à l'image 14, se cache à la 16)
    // sortent à part.
    { cle: 'gameHammer', id: 599, sansEnfantsNommes: true },
    { cle: 'sym597', id: 597, sansEnfantsNommes: true, formes: [566] },
    { cle: 'sym597_margelle', id: 597, sansEnfantsNommes: true, formes: [596] },
    { cle: 'sym578', id: 578 },
    { cle: 'sym595', id: 595 },
    // LE TAQUIN (gameTaquin) : la tuile (sym558) est une FENÊTRE — sa forme
    // 555 masque l'image plein cadre, la bordure 557 passe devant. On sort
    // la bordure seule, le cadre (sym560), l'image (sym554 — UNE seule des
    // quatre prévues a été compilée), et la fenêtre en cellule à la main
    // (cf. plus bas, comme celle du terrier).
    { cle: 'sym558', id: 558, sansEnfantsNommes: true, formes: [557] },
    { cle: 'sym560', id: 560 },
  ];
  for (const s of SUPPLEMENTS) {
    const etats = etatsDe(s.id, s);
    if (!etats.some((e) => e.pieces.length)) throw new Error(`supplément ${s.cle} : rien à dessiner`);
    const deja = cellules.findIndex((c) => c.cle === s.cle);
    const cellule = { cle: s.cle, obf: deja >= 0 ? cellules[deja].obf : null, id: s.id, etats };
    if (deja >= 0) cellules[deja] = cellule;
    else cellules.push(cellule);
  }

  // Les fenêtres de découpe qui ne sont pas des clips — la forme montée en
  // cellule à la main, à l'identité : celle du terrier du maillet (567,
  // clipDepth 17, la bestiole seule) et celle de la tuile du taquin (555).
  for (const id of [567, 555]) {
    cellules.push({ cle: 'sym' + id, obf: null, id,
      etats: [{ frame: 1, pieces: [{ shape: id, M: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }] }] });
    formes.add(id);
  }

  // La GRENOUILLE (mcFrog, sym673) : le jeu déplace sa PUPILLE — la chaîne
  // skin.«8».«8».«51».«61» du bytecode, f.h.h.o.p des sources — de ±1,8 px
  // (le chemin aplati est « 8.51.61 » : le nom du placement de PREMIER niveau
  // n'entre pas dans `chemin`, etatsDe le passe vide à aplatir) —
  // dans le repère de l'œil, pour que le regard SUIVE l'appât
  // (Frog.checkFrog). Une pellicule aplatie fige ce détail ; on sépare donc :
  // sym673 sort SANS les pièces de la pupille, et sym673_pupille les porte,
  // état par état, avec `lin` — la partie linéaire de la chaîne des
  // placements jusqu'à l'œil (les deux miroirs, ~-1,34 sur le corps et -1,2
  // sur l'œil, se composent en ~+1,61 : les yeux suivent bien l'appât, sans
  // inversion), celle qui transforme le décalage local posé par le jeu en
  // décalage écran. La tête est STOPPÉE à sa première image (DoAction 0x07),
  // la chaîne se lit donc à l'image 1 des clips intermédiaires.
  {
    const c673 = cellules.find((c) => c.id === 673);
    if (!c673) throw new Error('mcFrog (sym673) introuvable — la pupille reste collée');
    const frames673 = swf.parSprite.get(673);
    const enfantNomme = (id, nom) => {
      const images = swf.parSprite.get(id);
      const f = [...images.keys()].sort((x, y) => x - y)[0];
      return (images.get(f) || []).find((p) => p.nom === nom);
    };
    const pupille = { cle: 'sym673_pupille', obf: null, id: 673, etats: [] };
    for (const e of c673.etats) {
      const dedans = e.pieces.filter((p) => (p.chemin || '').startsWith('8.51.61'));
      e.pieces = e.pieces.filter((p) => !(p.chemin || '').startsWith('8.51.61'));
      const p8 = (frames673.get(e.frame) || []).find((p) => p.nom === '8');
      let lin = null;
      if (p8) {
        const p8b = enfantNomme(p8.ch, '8');
        const p51 = enfantNomme(p8b.ch, '51');
        const M = composer(composer(p8.M, p8b.M), p51.M);
        lin = [M.a, M.b, M.c, M.d].map((v) => Math.round(v * 1e4) / 1e4);
      }
      pupille.etats.push({ frame: e.frame, pieces: dedans, lin });
    }
    if (!pupille.etats.some((e) => e.pieces.length)) {
      throw new Error('la pupille de mcFrog est introuvable (chemin 8.51.61)');
    }
    cellules.push(pupille);
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
      const etat = e.masque ? { frame: e.frame, masque: true, pieces } : { frame: e.frame, pieces };
      if (e.lin) etat.lin = e.lin;         // la chaîne de l'œil (sym673_pupille)
      etats.push(etat);
    }
    if (!etats.some((e) => e.pieces.length)) continue;
    manifeste[c.cle] = { symbole: c.obf, id: c.id, etats };
  }
  if (perdues.length) console.log(`pièces non extraites (${perdues.length}) : ${perdues.slice(0, 8).join(', ')}…`);

  // Les CONTOURS : le polygone d'une forme de COLLISION, pour les jeux qui
  // font du hitTest(x, y, true) sur un dessin — le tunnel de la grotte du
  // Fantôme, sa stalactite. On aplatit le chemin du SVG extrait (les
  // courbes Q en huit segments — largement sous le pixel sur ces formes) et
  // on le range sur la cellule ; le moteur fait le reste (pair-impair, les
  // trous compris). Les points passent par la matrice de la pièce : le
  // contour vit dans le repère de la CELLULE, comme ses dessins.
  const CONTOURS = [
    { cle: 'sym272', shape: 271 },     // le tunnel de la grotte (rouge, invisible)
    { cle: 'sym274', shape: 273 },     // la pique de la stalactite
  ];
  for (const c of CONTOURS) {
    const cellule = manifeste[c.cle];
    if (!cellule) throw new Error(`contour ${c.cle} : cellule absente`);
    const piece = cellule.etats[0].pieces.find((p) => p.fichier === `shape${c.shape}.svg`);
    if (!piece) throw new Error(`contour ${c.cle} : la forme ${c.shape} n'y est pas`);
    const svg = fs.readFileSync(path.join(SORTIE, piece.fichier), 'utf8');
    // Un GROUPE d'anneaux par <path> : au test, chaque groupe se juge en
    // pair-impair (ses trous compris) et les groupes s'additionnent — le
    // hitTest de Flash prend l'UNION des remplissages, et les couches
    // d'ombrage posées sur la silhouette ne doivent pas la percer.
    const groupes = [];
    const [a, bb, cc, d, e, f] = piece.m;
    for (const m of svg.matchAll(/\bd="([^"]+)"/g)) {
      const anneaux = aplatirChemin(m[1]).map((anneau) => anneau.map(([x, y]) => [
        Math.round((a * x + cc * y + e) * 20) / 20,
        Math.round((bb * x + d * y + f) * 20) / 20,
      ]).flat());
      if (anneaux.length) groupes.push(anneaux);
    }
    if (!groupes.length) throw new Error(`contour ${c.cle} : chemin illisible`);
    cellule.contour = groupes;
    console.log(`contour ${c.cle} : ${groupes.length} groupe(s), `
      + `${groupes.reduce((n, g) => n + g.reduce((k, r) => k + r.length / 2, 0), 0)} points`);
  }

  // Les RASTERS : les rares dessins à REMPLISSAGE BITMAP, que
  // extract-swf-shapes laisse de côté (« hors périmètre »). L'Aliquet de
  // l'esquive spatiale est le seul du jeu : un PNG de 18 × 18
  // (DefineBitsLossless2 n° 617) posé sur toute la boîte de sa forme. On le
  // sort par extract-swf-bitmaps et on récrit le SVG de la forme autour —
  // en data-URI, net au pixel (l'art d'époque est du pixel-art).
  const RASTERS = [
    { shape: 618, bitmap: 617 },       // l'Aliquet (sym619)
    { shape: 553, bitmap: 552 },       // l'image du taquin (sym554)
  ];
  for (const r of RASTERS) {
    const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'raster-'));
    execFileSync(process.execPath,
      [path.join(__dirname, 'extract-swf-bitmaps.js'), SWF, temp, String(r.bitmap)],
      { cwd: RACINE, encoding: 'utf8' });
    const png = fs.readFileSync(path.join(temp, `bitmap${r.bitmap}.png`));
    fs.rmSync(temp, { recursive: true, force: true });
    const info = bornes.get(r.shape);
    if (!info) throw new Error(`raster : la forme ${r.shape} n'a pas de bornes`);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"'
      + ` viewBox="${info.x0} ${info.y0} ${info.w} ${info.h}"`
      + ` width="${info.w}" height="${info.h}">\n`
      + `<image x="${info.x0}" y="${info.y0}" width="${info.w}" height="${info.h}"`
      + ' image-rendering="pixelated" href="data:image/png;base64,'
      + png.toString('base64') + '"/>\n</svg>\n';
    fs.writeFileSync(path.join(SORTIE, `shape${r.shape}.svg`), svg, 'utf8');
    console.log(`raster shape${r.shape} : bitmap ${r.bitmap} incrusté (${png.length} octets)`);
  }

  const dest = path.join(SORTIE, 'sprites.json');
  fs.writeFileSync(dest, JSON.stringify(manifeste), 'utf8');
  const total = Object.values(manifeste).reduce((n, m) => n + m.etats.length, 0);
  console.log(`→ ${path.relative(RACINE, dest)} (${Object.keys(manifeste).length} symboles, ${total} images)`);
}

/**
 * Un chemin SVG (M/L/Q/Z, ce que sort extract-swf-shapes) en polygones :
 * un anneau par sous-chemin, les Q échantillonnées en huit pas.
 */
function aplatirChemin(d) {
  const jetons = d.match(/[MLQZz]|-?[\d.]+/g) || [];
  const anneaux = [];
  let anneau = null;
  let x = 0;
  let y = 0;
  let i = 0;
  const nombre = () => Number(jetons[i++]);
  while (i < jetons.length) {
    const op = jetons[i++];
    if (op === 'M') {
      if (anneau && anneau.length > 2) anneaux.push(anneau);
      x = nombre(); y = nombre();
      anneau = [[x, y]];
    } else if (op === 'L') {
      x = nombre(); y = nombre();
      anneau.push([x, y]);
    } else if (op === 'Q') {
      const cx = nombre(); const cy = nombre();
      const fx = nombre(); const fy = nombre();
      for (let t = 1; t <= 8; t++) {
        const u = t / 8;
        const v = 1 - u;
        anneau.push([v * v * x + 2 * v * u * cx + u * u * fx,
          v * v * y + 2 * v * u * cy + u * u * fy]);
      }
      x = fx; y = fy;
    } else if (op === 'Z' || op === 'z') {
      // l'anneau se referme tout seul au test pair-impair
    } else {
      i--; i++;                        // un nombre isolé : on l'ignore
    }
  }
  if (anneau && anneau.length > 2) anneaux.push(anneau);
  return anneaux;
}

if (require.main === module) principal();
module.exports = { liensEnregistres, classesDesSources, DECALAGE };
