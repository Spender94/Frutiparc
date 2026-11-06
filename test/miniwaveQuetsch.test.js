/*
 * LE CHAMP DE FORCE DE L'ASTRO-QUETSCH (engine.js, type 24).
 *
 * « Les astro-quetsch ont un forcefield trop puissant, quasi aucun vaisseau
 *   n'arrive à les atteindre. »
 *
 * Quetsch.as — et le bytecode de miniwave.swf — repoussent chaque tir du
 * vaisseau de 2 px par image dans un rayon de 26 : à quarante images par
 * seconde, le tir du Pastaga (2,6 × tmod 0,8 = 2,08 px par image) faisait du
 * surplace dans le champ, et une Quetsch isolée n'était touchée qu'une fois sur
 * dix-neuf par tous les vaisseaux sauf le Manzana. Le portage atténue le champ
 * (rayon 20, poussée 1) : un tir bien visé passe, quel que soit le vaisseau,
 * et un tir mal centré est toujours dévié.
 *
 * On fait jouer le vrai moteur : une escadre de douze, une Quetsch au centre,
 * les autres ennemis loin de sa colonne, personne ne tire en face.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));

const TMOD = 0.8;                      // quarante images par seconde (game.js)
const VITESSES = { Pastaga: -2.6, Tequila: -3, Curaso: -3.5, Manzana: -6 };

function niveau() {
  const l = [{ t: 24, x: 120, y: 60 }];
  const xs = [24, 48, 72, 168, 192, 216];
  for (let i = 0; l.length < 12; i++) l.push({ t: 0, x: xs[i % 6], y: i < 6 ? 36 : 84 });
  return [{ name: 'quetsch', moveSpeed: 0, fallSpeed: 0, ss: 6, sd: 6, list: [l] }];
}

// Un tir droit, parti de y = 200, décalé de `dx` par rapport à la Quetsch.
// Rend vrai si la Quetsch est touchée.
function tirer(vity, dx) {
  const jeu = new E.Game({ levels: niveau(), graine: 3 });
  for (let i = 0; i < 800 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(TMOD);
  assert.equal(jeu.step, E.ETAPE.COMBAT, 'la vague se range');
  if (jeu.hero) jeu.hero.newShield = 1e9;
  const q = jeu.badsList.find((b) => b.type === 24);
  jeu.newHShot({ x: q.x + dx, y: 200, vitx: 0, vity, flStandardHeroShot: true, heroType: 0 });
  for (let i = 0; i < 300; i++) {
    for (const b of jeu.badsList) b.coolDown = 1e9;   // pas de riposte
    jeu.update(TMOD);
    if (!jeu.badsList.includes(q)) return true;
    if (jeu.hShotList.length === 0) return false;
  }
  return false;
}

test('un tir bien centré atteint la Quetsch, quel que soit le vaisseau', () => {
  for (const [nom, v] of Object.entries(VITESSES)) {
    for (const dx of [-1, 0, 1]) {
      assert.ok(tirer(v, dx), `${nom}, décalage ${dx} : la Quetsch est touchée`);
    }
  }
});

test('sur toute la largeur du dessin, le champ dévie encore, sans tout arrêter', () => {
  for (const [nom, v] of Object.entries(VITESSES)) {
    let touches = 0;
    for (let dx = -9; dx <= 9; dx++) if (tirer(v, dx)) touches++;
    // Avant : 1 sur 19 pour les trois premiers. Le champ doit rester sensible
    // (des tirs déviés), mais plus de vaisseau condamné à l'échec.
    assert.ok(touches >= 7, `${nom} : ${touches}/19 touchent`);
    assert.ok(touches < 19, `${nom} : le champ dévie toujours les tirs mal centrés`);
  }
});

test('la poussée : 1 px par image, dans un rayon de 20', () => {
  const tic = E.TYPES[24].tic;
  const tir = (x, y) => ({ x, y });
  const proche = tir(100, 115);        // 15 px sous la Quetsch
  const loin = tir(100, 122);          // 22 px : hors du champ
  const b = { x: 100, y: 100, jeu: { hShotList: [proche, loin] } };
  tic(b, TMOD);
  assert.ok(Math.abs(proche.y - 116) < 1e-9, `repoussé d'un pixel (${proche.y})`);
  assert.equal(proche.x, 100);
  assert.equal(loin.y, 122, 'à 22 px, plus rien');
});

test('le SWF d\'origine portait zone 26 et power 2 (référence du commentaire)', () => {
  const zlib = require('node:zlib');
  const brut = fs.readFileSync(path.join(ROOT, 'Games/miniWave2/miniwave.swf'));
  const b = brut.slice(0, 3).toString('ascii') === 'CWS' ? zlib.inflateSync(brut.slice(8)) : brut.slice(8);
  const i = b.toString('latin1').indexOf('__Packages.miniwave.sp.bads.Quetsch');
  assert.ok(i > 0, 'la classe Quetsch est dans le SWF');
  // La table de constantes du bloc, puis les `push r1, "nom", valeur` qui
  // posent les champs du prototype.
  let d = i;
  while (b[d] !== 0x88) d++;
  const n = b.readUInt16LE(d + 3);
  let p = d + 5;
  const pool = [];
  for (let k = 0; k < n; k++) { let e = p; while (b[e] !== 0) e++; pool.push(b.slice(p, e).toString('latin1')); p = e + 1; }
  const champs = {};
  for (let o = p; o < p + 3000; o++) {
    // ActionPush de 7 octets : registre 1, constante 8 bits, entier 32 bits.
    if (b[o] !== 0x96 || b.readUInt16LE(o + 1) !== 9) continue;
    if (b[o + 3] !== 4 || b[o + 4] !== 1 || b[o + 5] !== 8 || b[o + 7] !== 7) continue;
    champs[pool[b[o + 6]]] = b.readInt32LE(o + 8);
  }
  assert.equal(champs.zone, 26);
  assert.equal(champs.power, 2);
});
