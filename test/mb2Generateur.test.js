/*
 * Motion-Ball 2 : la map Challenge générée se lit proprement avec le
 * next_part() du client — y compris quand la partie donjon finit pile sur une
 * frontière de caractère.
 *
 * Entre la partie donjon et la partie salles du flux, LevelLoader.as appelle
 * MTBitcodec.next_part(), qui AVANCE TOUJOURS d'un caractère base64 : le
 * reste du caractère entamé, ou un caractère ENTIER quand le donjon finit
 * aligné. L'ancien writer (b.flush() : bourrage seulement si besoin) laissait
 * alors les salles derrière la tête de lecture : tout le flux des salles se
 * lisait avec 6 bits de décalage — items fantômes (téléporteurs, leviers…
 * types 10/11 que le générateur n'émet jamais) et salles aux portes mortes.
 * ~1 map sur 6 : les quotidiennes des 1ᵉʳ, 4, 7 et 9 août étaient dans ce
 * cas, celles des 2, 3, 5, 6, 8 et 10 étaient saines — le « la plupart des
 * maps sont injouables » des joueurs.
 *
 * flushPartie écrit désormais le bourrage que next_part consomme (un
 * caractère plein quand on est aligné) : chaque map générée se lit comme les
 * .dat faits main — qui finissent tous hors frontière et se jouent bien
 * depuis 2006.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { generateMb2ChallengeMap } = require(path.join(ROOT, 'mb2gen.js'));
const DAT = path.join(ROOT, 'Games', 'motionBall2', 'mb2data.dat');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
const POS_NBITS = 8;                       // Const.POS_NBITS (152 cases → 8 bits)

// Les graines RETENUES des quotidiennes du 4, 7 et 9 août : leur donjon finit
// pile sur la frontière — le cas qui cassait.
const GRAINES_ALIGNEES = [16888216, 1040289264, 201442025];

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
    // MTBitcodec.next_part : TOUJOURS un caractère de plus (cf. mb2gen.js,
    // flushPartie — la preuve par élimination y est détaillée).
    nextPart() { p = (Math.floor(p / 6) + 1) * 6; },
    position() { return p; },
    longueur() { return bits.length; },
  };
}

// La grammaire EXACTE de LevelLoader.as. Rend la fin de la partie donjon, les
// 64 salles et le reste du flux ; jette si le flux déraille.
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
    for (const [t, x, y] of salle) {
      assert.ok(t >= 1 && t <= 9,
        `${contexte} : item de type ${t} — le générateur n'émet jamais 10-15 (téléporteurs, leviers…)`);
      assert.ok(x < 152 && y < 102, `${contexte} : position hors champ (${x},${y})`);
    }
  }
  assert.ok(remplies >= 20, `${contexte} : ${remplies} salles garnies — un vrai donjon`);
  assert.ok(d.reste >= 0 && d.reste < 6, `${contexte} : ${d.reste} bits de reste — fin exacte`);
}

const ddataCourant = () => /ddata=([^&\n]+)/.exec(fs.readFileSync(DAT, 'utf8'))[1];

test('les graines à donjon ALIGNÉ (les quotidiennes cassées) se lisent proprement', async () => {
  for (const graine of GRAINES_ALIGNEES) {
    const r = await generateMb2ChallengeMap(graine);
    assert.equal(r.seed, graine, 'la graine passe telle quelle');
    const d = decoderCommeLeClient(ddataCourant());
    assert.equal(d.finDonjon % 6, 0,
      `graine ${graine} : le donjon finit bien sur la frontière — le cas pathologique est exercé`);
    verifierPropre(d, `graine alignée ${graine}`);
  }
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

test('les .dat faits main du dépôt restent le témoin : hors frontière, flux exact', () => {
  for (const f of ['mb2adv1.dat', 'mb2adv3.dat', 'mb2tuto.dat', 'mb2run1.dat']) {
    const t = fs.readFileSync(path.join(ROOT, 'Games', 'motionBall2', f), 'utf8');
    const d = decoderCommeLeClient(/ddata=([^&\n]+)/.exec(t)[1]);
    assert.notEqual(d.finDonjon % 6, 0, `${f} : hors frontière — les deux next_part y sont équivalents`);
    assert.ok(d.reste < 6, `${f} : ${d.reste} bits de reste`);
  }
});

test('le générateur clôt ses trois encodages par flushPartie', () => {
  const src = fs.readFileSync(path.join(ROOT, 'mb2gen.js'), 'utf8');
  assert.equal((src.match(/flushPartie\(b\);/g) || []).length, 3,
    'levelMake, levelMakeClassic et assembleMake');
  assert.match(src, /function flushPartie\(b\)/);
  assert.match(src, /b\.write\(6, 0\)/, 'un caractère PLEIN quand le donjon finit aligné');
});
