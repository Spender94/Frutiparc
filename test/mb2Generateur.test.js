/*
 * Motion-Ball 2 : le flux généré se lit avec le lecteur EXACT du client —
 * le MTBitcodec compilé dans motionball.swf, désassemblé depuis le
 * DoInitAction « __Packages.ext.util.MTBitcodec ». Deux points y furent
 * établis, chacun corrigeant une fausse piste précédente :
 *
 * 1) next_part() { this.nbits = 0; } — il jette les bits restants du
 *    caractère ENTAMÉ, rien de plus. La boucle de read() ne tire un
 *    caractère que quand elle en a besoin, donc quand le donjon finit pile
 *    sur la frontière des 6 bits, next_part ne saute RIEN. flushPartie()
 *    borde donc à la frontière sans jamais insérer de caractère plein.
 *
 * 2) L'alphabet du SWF finit par « …9-_ » : '-'=62, '_'=63. L'outillage
 *    OCaml d'époque (mb2gen.exe — la preuve : notre port le reproduit octet
 *    pour octet depuis dungeon/*.txt avec « …9_- ») écrivait l'INVERSE.
 *    Chaque '-'/'_' d'un fichier encodé « OCaml » a son dernier bit lu à
 *    l'envers par le client : un type d'item 8 (1000) devient 0 (fin de
 *    liste) et la salle perd le reste de son mobilier, un drapeau de salle
 *    s'inverse, une rouge devient bleue… Le générateur écrit donc l'alphabet
 *    du SWF, et les .dat archivés ont été transcodés une fois pour toutes
 *    (scripts/transcode-mb2-dats.js).
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const mb2 = require(path.join(ROOT, 'mb2gen.js'));
const { generateMb2ChallengeMap } = mb2;
const DAT = path.join(ROOT, 'Games', 'motionBall2', 'mb2data.dat');

// L'alphabet DU SWF — celui du lecteur qu'on modélise ici.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const POS_NBITS = 8;                       // Const.POS_NBITS (152 cases → 8 bits)

// Graines dont le donjon finit PILE sur la frontière des 6 bits (cas qui
// avait été mal diagnostiqué : next_part n'y saute rien).
const GRAINES_ALIGNEES = [16888216, 1040289264, 201442025];

// La graine du cas d'école de l'alphabet : son flux place un '-' sous les
// bits de type du 18ᵉ item de la salle (0,4) — sous l'ancien alphabet, le
// client y lisait « fin de liste » et la salle de départ perdait 10 items.
const GRAINE_TIRET = 67221073;

function lecteur(data) {
  const bits = [];
  for (const ch of data) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) continue;
    for (let j = 5; j >= 0; j--) bits.push((v >> j) & 1);
  }
  let p = 0;
  return {
    read(n) { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | (bits[p++] || 0); return v; },
    // MTBitcodec.next_part : nbits=0 — on ARRONDIT à la frontière du
    // caractère entamé ; un flux déjà aligné ne bouge pas.
    nextPart() { p = Math.ceil(p / 6) * 6; },
    position() { return p; },
    longueur() { return bits.length; },
  };
}

// La grammaire EXACTE de LevelLoader.as (vérifiée sur le bytecode du tag
// compilé). Rend la fin de la partie donjon, les 64 salles et le reste du
// flux ; jette si le flux déraille.
function decoderCommeLeClient(ddata) {
  const bc = lecteur(ddata);
  const width = bc.read(7), height = bc.read(7);
  bc.read(7); bc.read(7);
  assert.equal(width, 8); assert.equal(height, 8);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const rtype = bc.read(3);
      if (rtype === 3 || rtype === 5) bc.read(2);
      else if (rtype === 4) bc.read(3);
      if (rtype !== 0) for (let d = 0; d < 4; d++) { if (bc.read(2) === 3) bc.read(2); }
    }
  }
  const finDonjon = bc.position();
  bc.nextPart();
  const salles = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (bc.read(1) === 0) { salles.push(null); continue; }
      const items = [];
      for (;;) {
        const t = bc.read(4);
        if (t === 0) break;
        items.push([t, bc.read(POS_NBITS), bc.read(POS_NBITS)]);
        if (items.length > 500) throw new Error(`salle (${x},${y}) : flux fou`);
      }
      salles.push(items);
    }
  }
  return { finDonjon, salles, reste: bc.longueur() - bc.position() };
}

function verifierPropre(d, contexte) {
  let remplies = 0;
  for (const salle of d.salles) {
    if (!salle) continue;
    remplies++;
    let rouges = 0;
    for (const [t, x, y] of salle) {
      assert.ok(t >= 1 && t <= 9,
        `${contexte} : item de type ${t} — le générateur n'émet jamais 10-15 (téléporteurs, leviers…)`);
      assert.ok(x < 152 && y < 102, `${contexte} : position hors champ (${x},${y})`);
      if (t === 8) rouges++;
    }
    assert.ok(rouges >= 1, `${contexte} : salle garnie sans bille rouge — impossible à ouvrir`);
  }
  assert.ok(remplies >= 20, `${contexte} : ${remplies} salles garnies — un vrai donjon`);
  assert.ok(d.reste >= 0 && d.reste < 6, `${contexte} : ${d.reste} bits de reste — fin exacte`);
}

const ddataCourant = () => /ddata=([^&\n]+)/.exec(fs.readFileSync(DAT, 'utf8'))[1];

test('les graines à donjon ALIGNÉ se lisent proprement (next_part n\'y saute rien)', async () => {
  for (const graine of GRAINES_ALIGNEES) {
    const r = await generateMb2ChallengeMap(graine);
    assert.equal(r.seed, graine, 'la graine passe telle quelle');
    const d = decoderCommeLeClient(ddataCourant());
    assert.equal(d.finDonjon % 6, 0,
      `graine ${graine} : le donjon finit bien sur la frontière — le cas limite est exercé`);
    verifierPropre(d, `graine alignée ${graine}`);
  }
});

test('la graine au tiret piégé (67221073) garde ses 27 items en salle (0,4)', async () => {
  await generateMb2ChallengeMap(GRAINE_TIRET);
  const ddata = ddataCourant();
  assert.ok(/[-_]/.test(ddata), 'le flux contient bien des caractères 62/63 — le cas est exercé');
  const d = decoderCommeLeClient(ddata);
  verifierPropre(d, `graine ${GRAINE_TIRET}`);
  // La salle (0,4) — 5ᵉ de la promenade x-outer — portait la coupure : le
  // 18ᵉ item (une rouge) tombait sur le dernier bit d'un '-'. On tient les
  // 27 items, dont 10 rouges et 1 bleue.
  const salle04 = d.salles[4];
  assert.equal(salle04.length, 27, 'les 27 items de la salle (0,4)');
  assert.equal(salle04.filter(([t]) => t === 8).length, 10, 'les 10 rouges');
  assert.equal(salle04.filter(([t]) => t === 9).length, 1, 'la bleue');
});

test('un échantillon de graines ordinaires se lit proprement aussi', async () => {
  let vues = 0;
  for (let s = 1; s <= 8; s++) {
    try { await generateMb2ChallengeMap(s * 60013); } catch { continue; }
    vues++;
    verifierPropre(decoderCommeLeClient(ddataCourant()), `graine ${s * 60013}`);
  }
  assert.ok(vues >= 5, `au moins 5 maps générées (${vues})`);
});

test('la map du jour ne finit pas par un saut de ligne (fidélité aux .dat d\'époque)', async () => {
  await generateMb2ChallengeMap();
  const brut = fs.readFileSync(DAT, 'utf8');
  assert.ok(!brut.endsWith('\n'), 'pas de \\n final — LoadVars le garderait dans ddata');
});

test('les .dat servis sont à l\'alphabet du SWF ; l\'encodage OCaml historique reste prouvé', () => {
  mb2.loadBumpers();
  const swap = (s) => s.replace(/[-_]/g, (c) => (c === '-' ? '_' : '-'));
  for (const [txt, dat] of [['adv_1', 'mb2adv1'], ['tuto', 'mb2tuto'], ['course_1', 'mb2run1']]) {
    const source = path.join(ROOT, 'Games', 'motionBall2', 'dungeon', txt + '.txt');
    const surDisque = fs.readFileSync(path.join(ROOT, 'Games', 'motionBall2', dat + '.dat'), 'utf8');
    // Le fichier servi est la sortie SWF *réparée* : les items hors table sont
    // retirés (cf. test/mb2Salles.test.js — ils condamnaient sept salles).
    const rendueSwf = mb2.assembleMake(source, mb2.B64_SWF, { reparerHorsChamp: true });
    assert.equal(surDisque, rendueSwf,
      `${dat}.dat : le fichier servi est la sortie SWF réparée de dungeon/${txt}.txt`);
    // La preuve de fidélité du port porte sur le rendu BRUT : l'alphabet OCaml
    // reproduit l'archive d'époque, dont la sortie SWF est le swap -/_ exact.
    const brutSwf = mb2.assembleMake(source, mb2.B64_SWF);
    const brutOcaml = mb2.assembleMake(source, mb2.B64_OCAML);
    const [pre, dd] = brutSwf.split('&ddata=');
    assert.equal(brutOcaml, pre + '&ddata=' + swap(dd),
      `${dat}.dat : la sortie OCaml reste le transcodage exact — le port n'a pas dérivé`);
  }
});

test('le générateur clôt ses trois encodages par flushPartie (bordure simple)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'mb2gen.js'), 'utf8');
  assert.equal((src.match(/flushPartie\(b\);/g) || []).length, 3,
    'levelMake, levelMakeClassic et assembleMake');
  assert.match(src, /function flushPartie\(b\) \{\n  b\.flush\(\);\n\}/,
    'bordure à la frontière, jamais de caractère plein inséré');
});
