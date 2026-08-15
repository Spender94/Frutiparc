/*
 * Mini-Fever au BUREAU — les trois rustines SWF.
 *
 * Le jeu n'est jamais sorti : aucun des SWF gravés ne le connaît. Trois
 * rustines binaires (scripts/patch-*-minifever.js, sur scripts/lib/swf-greffe)
 * lui donnent une identité de plein droit côté bureau :
 *
 *   · public/fileIcon.swf — le clip 81 (la feuille des illustrations de
 *     disques) reçoit une image GREFFÉE étiquetée « minifever » : LA MÊME
 *     JAQUETTE que le light (fd_minifever.svg), en bitmap 2× dans la boîte
 *     61×61 ;
 *   · public/awards.swf — pas de médaille inventée : Mini-Fever EMPRUNTE le
 *     set d'époque inutilisé de Tubulo (le plateau de capsules — Tubulo est
 *     une épreuve du jeu), par une étiquette « minifever » de plus sur son
 *     image, comme MiniPixiz emprunte celui de Tris ;
 *   · legacy/main.swf — la feuille d'icônes de statut (clip 246) reçoit son
 *     image 37 greffée : les cerises (sym544, l'emblème du jeu) en ~17×17,
 *     comme ses 36 voisines — et le DoInitAction internalList[13]="minifever"
 *     la branche (celui-là est vérifié par voyantsJeux.test.js, avec celui de
 *     la fée).
 *
 * Ces tests relisent les fichiers BINAIRES : si une rustine saute (SWF
 * resservi depuis l'original) ou se corrompt (longueurs, frameCount,
 * profondeurs), ils le disent. Les patchs sont idempotents — rejouables sans
 * double image.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const G = require(path.join(ROOT, 'scripts/lib/swf-greffe.js'));

// Le RECT d'un tag (bornes en px, twips/20), lu au bit près.
function lireRect(buf, off) {
  const nbits = (buf[off] >> 3) & 0x1f;
  let bit = 5;
  const vals = [];
  for (let i = 0; i < 4; i++) {
    let v = 0;
    for (let j = 0; j < nbits; j++) {
      v = (v << 1) | ((buf[off + (bit >> 3)] >> (7 - (bit & 7))) & 1);
      bit++;
    }
    if (v & (1 << (nbits - 1))) v -= (1 << nbits);
    vals.push(v / 20);
  }
  return { xmin: vals[0], xmax: vals[1], ymin: vals[2], ymax: vals[3] };
}

// Les tags d'une plage [de, a) — { code, o (offset du corps), len }.
function tags(buf, de, a) {
  const out = [];
  let o = de;
  while (o < a - 1) {
    const hdr = buf.readUInt16LE(o);
    const code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = buf.readUInt32LE(o + 2); hs = 6; }
    out.push({ code, o: o + hs, len });
    if (code === 0) break;
    o += hs + len;
  }
  return out;
}

// La dernière image d'une pellicule : les tags entre l'avant-dernier ShowFrame
// et le End, avec l'étiquette qu'elle porte.
function derniereImage(liste) {
  const shows = liste.map((t, i) => (t.code === 1 ? i : -1)).filter((i) => i >= 0);
  const debut = shows.length > 1 ? shows[shows.length - 2] + 1 : 0;
  return liste.slice(debut, shows[shows.length - 1] + 1);
}

// La forme posée : DefineShape (code 2) d'id donné → ses bornes et le bitmap
// (0x41 « clipped ») qu'elle étale. Disposition de tagFormeBitmap :
// id u16 | RECT | fillCount u8 (1) | type 0x41 | bitmapId u16 | matrice…
function formeEtBitmap(body, idForme) {
  let forme = null;
  G.parcourir(body, (code, o, h, len) => {
    if (code === 2 && body.readUInt16LE(o + h) === idForme) forme = { o: o + h, len };
  });
  assert.ok(forme, 'la forme ' + idForme + ' est définie');
  const bornes = lireRect(body, forme.o + 2);
  const nbits = (body[forme.o + 2] >> 3) & 0x1f;
  const apresRect = forme.o + 2 + Math.ceil((5 + nbits * 4) / 8);
  assert.equal(body[apresRect], 1, 'un seul style de remplissage');
  assert.equal(body[apresRect + 1], 0x41, 'un remplissage bitmap « clipped »');
  const idBitmap = body.readUInt16LE(apresRect + 2);
  let bitmap = null;
  G.parcourir(body, (code, o, h) => {
    if (code === 36 && body.readUInt16LE(o + h) === idBitmap) {
      bitmap = { format: body[o + h + 2], w: body.readUInt16LE(o + h + 3), h: body.readUInt16LE(o + h + 5) };
    }
  });
  assert.ok(bitmap, 'le bitmap ' + idBitmap + ' est défini (DefineBitsLossless2)');
  assert.equal(bitmap.format, 5, 'en ARGB 32 bits');
  return { bornes, bitmap };
}

const dims = (png) => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });

test('fileIcon.swf : la jaquette du disque, greffée au clip 81', () => {
  const { body } = G.lireSwf(path.join(ROOT, 'public/fileIcon.swf'));
  const sp = G.trouverSprite(body, 81);
  assert.ok(sp, 'le clip 81 (la feuille des illustrations) existe');
  assert.equal(body.readUInt16LE(sp.offset + sp.entete + 2), 68,
    'la feuille compte 68 images (67 d\'époque + la greffe)');

  const interne = body.slice(sp.offset + sp.entete + 4, sp.offset + sp.entete + sp.longueur);
  const image = derniereImage(tags(interne, 0, interne.length));
  const etiquette = image.find((t) => t.code === 43);
  assert.ok(etiquette, 'la dernière image est étiquetée');
  assert.equal(interne.slice(etiquette.o, etiquette.o + etiquette.len - 1).toString('latin1'),
    'minifever', 'et l\'étiquette est « minifever » — celle que gotoAndStop(iconName) demande');

  // Le gabarit des voisines : délogement puis pose en profondeur 1.
  assert.ok(image.some((t) => t.code === 28 && interne.readUInt16LE(t.o) === 1),
    'RemoveObject2 en profondeur 1 (l\'illustration précédente)');
  const pose = image.find((t) => t.code === 26);
  assert.ok(pose, 'PlaceObject2 de l\'illustration');
  assert.equal(interne.readUInt16LE(pose.o + 1), 1, 'en profondeur 1, comme les 67 autres');

  // Le dessin : la jaquette du light en 2×, dans la boîte 61×61 centrée.
  const idForme = interne.readUInt16LE(pose.o + 3);
  const { bornes, bitmap } = formeEtBitmap(body, idForme);
  assert.deepEqual(bitmap, { format: 5, w: 122, h: 122 }, 'le bitmap est la jaquette 122×122 (2×)');
  assert.ok(Math.abs(bornes.xmax - bornes.xmin - 61) < 0.1 && Math.abs(bornes.ymax - bornes.ymin - 61) < 0.1,
    'étalée sur la boîte 61×61 des illustrations (' + JSON.stringify(bornes) + ')');
});

test('awards.swf : la médaille EMPRUNTE le set inutilisé de Tubulo (rien d\'inventé)', () => {
  const { body } = G.lireSwf(path.join(ROOT, 'public/awards.swf'));
  const debut = G.debutDesTags(body);
  assert.equal(body.readUInt16LE(debut - 2), 53,
    'toujours 53 images : un alias n\'ajoute AUCUNE image à la pellicule');

  // Chaque image peut porter plusieurs étiquettes ; « minifever » doit vivre
  // sur LA MÊME image que « tubulo » — le plateau de capsules, une épreuve du
  // jeu — comme « minipixiz » vit sur celle de « tris ».
  const parImage = {};
  let img = 1;
  for (const t of tags(body, debut, body.length)) {
    if (t.code === 43) {
      const nom = body.slice(t.o, t.o + t.len - 1).toString('latin1');
      (parImage[img] = parImage[img] || []).push(nom);
    }
    if (t.code === 1) img++;
  }
  const imageDe = (nom) => Number(Object.keys(parImage).find((i) => parImage[i].includes(nom)));
  assert.ok(imageDe('minifever') > 0, 'l\'étiquette « minifever » existe');
  assert.equal(imageDe('minifever'), imageDe('tubulo'),
    'et elle est posée sur l\'image de « tubulo »');
  assert.equal(imageDe('minipixiz'), imageDe('tris'), 'le précédent MiniPixiz → Tris tient toujours');
  assert.equal(imageDe('miniwave'), imageDe('wave'), 'et MiniWave → wave aussi');

  // Aucun set utilisé n'est réquisitionné : « tubulo » n'est le dessin d'aucun
  // autre classement (ni RANKINGS ni LEGACY_RANKINGS n'ont de jeu tubulo).
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(!/game: 'tubulo'|g: 'tubulo'/.test(src), 'le set tubulo était bien libre');

  // Et rien d'autre n'a été touché : aucun bitmap ajouté à la pellicule.
  let bitmaps = 0;
  G.parcourir(body, (code) => { if (code === 36 || code === 35 || code === 21) bitmaps++; });
  assert.equal(bitmaps, 0, 'awards.swf reste 100 % vectoriel, comme gravé');
});

test('main.swf : l\'image du voyant, greffée à la feuille d\'icônes (clip 246)', () => {
  const { body } = G.lireSwf(path.join(ROOT, 'legacy/main.swf'));
  const sp = G.trouverSprite(body, 246);
  assert.ok(sp, 'le clip 246 (la feuille d\'icônes de statut) existe');
  assert.equal(body.readUInt16LE(sp.offset + sp.entete + 2), 37,
    '37 images (36 d\'époque + la greffe)');

  const interne = body.slice(sp.offset + sp.entete + 4, sp.offset + sp.entete + sp.longueur);
  const image = derniereImage(tags(interne, 0, interne.length));
  const etiquette = image.find((t) => t.code === 43);
  assert.ok(etiquette, 'la dernière image est étiquetée');
  assert.equal(interne.slice(etiquette.o, etiquette.o + etiquette.len - 1).toString('latin1'),
    'minifever', 'l\'étiquette que gotoAndStop(internalList[13]) demandera');

  // Le gabarit de la feuille : l'image 36 (« forum ») laisse la profondeur 1
  // occupée et la 2 vide — la greffe retire 1 et pose en 2, comme l'alternance
  // d'origine.
  assert.ok(image.some((t) => t.code === 28 && interne.readUInt16LE(t.o) === 1),
    'RemoveObject2 en profondeur 1 (le forum)');
  const pose = image.find((t) => t.code === 26);
  assert.ok(pose, 'PlaceObject2 du voyant');
  assert.equal(interne.readUInt16LE(pose.o + 1), 2, 'en profondeur 2');

  // Le dessin : les cerises en 2×, centrées sur l'origine comme les 36 icônes
  // (boîtes ~17×17 posées en translate(0,0)).
  const idForme = interne.readUInt16LE(pose.o + 3);
  const { bornes, bitmap } = formeEtBitmap(body, idForme);
  assert.deepEqual(bitmap, { format: 5, w: 34, h: 34 }, 'le bitmap du voyant fait 34×34 (2×)');
  assert.ok(Math.abs(bornes.xmax - bornes.xmin - 17) < 0.1 && Math.abs(bornes.ymax - bornes.ymin - 17) < 0.1,
    'étalé sur une boîte 17×17 (' + JSON.stringify(bornes) + ')');
  assert.ok(Math.abs(bornes.xmin + bornes.xmax) < 0.2 && Math.abs(bornes.ymin + bornes.ymax) < 0.2,
    'centrée sur l\'origine, comme ses voisines (' + JSON.stringify(bornes) + ')');
});

test('les emblèmes versionnés existent, aux gabarits des greffes', () => {
  // Les PNG que les patchs embarquent (make-minifever-emblemes.js les rend
  // depuis le jeu : la jaquette fd_minifever.svg, les cerises sym544).
  for (const [fichier, w, h] of [
    ['scripts/assets-minifever/disque-122.png', 122, 122],
    ['scripts/assets-minifever/voyant-34.png', 34, 34],
    ['public/fb/voyant_minifever.png', 44, 44],
  ]) {
    const p = path.join(ROOT, fichier);
    assert.ok(fs.existsSync(p), fichier + ' existe');
    const png = fs.readFileSync(p);
    assert.equal(png.slice(1, 4).toString('latin1'), 'PNG', fichier + ' est un PNG');
    assert.deepEqual(dims(png), { w, h }, fichier + ' au gabarit ' + w + '×' + h);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/make-minifever-emblemes.js')),
    'et leur fabrique est versionnée');
});

test('les trois patchs sont rejouables, et chacun se reconnaît (idempotence)', () => {
  for (const [script, garde] of [
    ['scripts/patch-fileicon-minifever.js', /aEtiquette\(body, ETIQUETTE\)/],
    ['scripts/patch-awards-minifever.js', /aEtiquette\(body, ETIQUETTE\)/],
    ['scripts/patch-main-statusmng-minifever.js', /indexOf\(ACTIONS\)|aEtiquette\(body, ETIQUETTE\)/],
  ]) {
    const p = path.join(ROOT, script);
    assert.ok(fs.existsSync(p), script + ' est versionné');
    assert.match(fs.readFileSync(p, 'utf8'), garde, script + ' porte sa garde d\'idempotence');
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/lib/swf-greffe.js')), 'la bibliothèque de greffe aussi');
});
