/*
 * Mini-Wave — LA CADENCE, et pourquoi ce n'est pas quarante.
 *
 * Un joueur d'époque a signalé que le portage allait plus vite que l'original :
 * les vaisseaux, les tirs ennemis, la descente des ennemis, jusqu'aux
 * transitions de niveau. Tout, uniformément — le genre d'écart qu'on sent sans
 * pouvoir désigner un coupable, et qui trahit une horloge.
 *
 * Il y a deux nombres, et il ne faut pas les confondre :
 *
 *   · l'en-tête de miniwave.swf dit QUARANTE — la fréquence à laquelle Flash
 *     REDESSINE ;
 *   · `Std.wantedFPS` vaut TRENTE-DEUX — la durée d'une image « nominale »,
 *     celle à laquelle `Std.tmod` ramène toutes les vitesses du jeu.
 *
 * `Std` est une classe de la bibliothèque de Motion-Twin : elle n'est pas dans
 * les sources, elle est compilée dans le SWF. Ses constantes s'y retrouvent
 * telles quelles, et ce fichier va les y RELIRE plutôt que de les recopier — si
 * quelqu'un remet quarante dans le portage, l'épreuve saute.
 *
 * Minipixiz, même bibliothèque, mêmes constantes, avait exactement le même
 * écart : cf. la note de public/minipixiz/game.js, calibrée au chronomètre par
 * un joueur sur le premier niveau.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const SWF = path.join(ROOT, 'Games/miniWave2/miniwave.swf');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));

const corps = () => {
  const brut = fs.readFileSync(SWF);
  return brut.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(brut.slice(8)) : brut.slice(8);
};

/**
 * Les constantes statiques de `Std`, lues dans son bloc d'actions.
 *
 * On repère la classe par son nom dans la table de constantes, on remonte à la
 * table (ActionConstantPool, 0x88), puis on parcourt le code à la recherche des
 * `push <objet>, "<nom>", <valeur>` suivis d'un SetMember (0x4F) — la forme que
 * prend `Std.wantedFPS = 32` une fois compilé.
 */
function constantesDeStd(b) {
  const i = b.toString('latin1').indexOf('__Packages.Std');
  assert.ok(i > 0, 'la classe Std est bien dans le SWF');
  // La table de constantes du bloc SUIT le nom du paquet — remonter, ce serait
  // tomber sur celle du bloc précédent.
  let d = i;
  while (d < b.length && b[d] !== 0x88) d++;
  assert.ok(d < b.length, 'sa table de constantes');
  const n = b.readUInt16LE(d + 3);
  let p = d + 5;
  const pool = [];
  for (let k = 0; k < n; k++) {
    let e = p; while (b[e] !== 0) e++;
    pool.push(b.slice(p, e).toString('latin1')); p = e + 1;
  }

  const out = {};
  for (let o = p; o < b.length - 8; o++) {
    if (b[o] !== 0x96) continue;                    // ActionPush
    const fin = o + 3 + b.readUInt16LE(o + 1);
    if (fin > b.length || b[fin] !== 0x4F) continue; // suivi d'un SetMember
    // On lit les éléments poussés ; on veut les DEUX derniers : le nom, la valeur.
    let q = o + 3;
    const pile = [];
    let bon = true;
    while (q < fin) {
      const t = b[q++];
      if (t === 0) { let e = q; while (b[e] !== 0) e++; pile.push(b.slice(q, e).toString('latin1')); q = e + 1; }
      else if (t === 1) { pile.push(b.readFloatLE(q)); q += 4; }
      else if (t === 2 || t === 3) pile.push(null);
      else if (t === 4 || t === 5) { pile.push(null); q += 1; }
      else if (t === 6) {
        const t8 = Buffer.alloc(8);
        b.copy(t8, 0, q + 4, q + 8); b.copy(t8, 4, q, q + 4);
        pile.push(t8.readDoubleLE(0)); q += 8;
      } else if (t === 7) { pile.push(b.readInt32LE(q)); q += 4; }
      else if (t === 8) { pile.push(pool[b[q]]); q += 1; }
      else if (t === 9) { pile.push(pool[b.readUInt16LE(q)]); q += 2; }
      else { bon = false; break; }
    }
    if (!bon || pile.length < 2) continue;
    const val = pile[pile.length - 1];
    const nom = pile[pile.length - 2];
    if (typeof nom === 'string' && typeof val === 'number' && out[nom] === undefined) out[nom] = val;
  }
  return out;
}

test('Std.wantedFPS vaut 32 dans le SWF, et le portage compte pareil', () => {
  const c = constantesDeStd(corps());
  assert.equal(c.wantedFPS, 32, 'Std.wantedFPS');
  assert.equal(Math.round(c.tmod_factor * 100) / 100, 0.95, 'Std.tmod_factor');
  assert.equal(c.maxDeltaTime, 0.5, 'Std.maxDeltaTime');

  // L'en-tête, lui, dit bien quarante : c'est la fréquence de REDESSIN, et
  // c'est elle qu'on prenait pour la cadence du jeu.
  const b = corps();
  const o = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8);
  assert.equal(b.readUInt16LE(o) / 256, 40, 'miniwave.swf se redessine à 40 i/s');

  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(src, new RegExp('const IPS = ' + c.wantedFPS + ';'), 'la boucle compte 32 unités/s');
  assert.match(src, /const TMOD_LISSAGE = 0\.95;/, 'le lissage');
  assert.match(src, /const TMOD_SAUT = 0\.5;/, 'le saut d\'image');
});

/*
 * La boucle n'avance PAS par pas entiers de tmod : elle rejoue le LECTEUR.
 * La racine du SWF boucle sur deux images (11 : `mng.update()` ; 12 :
 * `gotoAndPlay(_currentframe-1)`) — une itération par image Flash, donc
 * QUARANTE appels par seconde (l'en-tête), chacun recevant le tmod lissé
 * (≈ 32/40 = 0,8 sur une machine à l'aise). Les lignes en `*tmod` avancent de
 * 32 unités nominales par seconde ; les lignes « par image » (la marche de la
 * vague, la soucoupe, les pellicules) avancent quarante fois par seconde ; en
 * retard, Flash SAUTE des images, il ne les rattrape pas.
 */
test('la boucle rejoue le lecteur : quarante images par seconde, tmod lissé', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  // La cadence d'appel vient de l'en-tête du SWF, relue ici.
  const b = corps();
  const o = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8);
  const entete = b.readUInt16LE(o) / 256;
  assert.match(src, new RegExp('const CADENCE_FLASH = ' + entete + ';'),
    'la boucle appelle update() à la cadence de l\'en-tête');
  // Std.update : la moyenne glissante du temps réel entre images EXÉCUTÉES.
  assert.match(src, /this\.tmod = this\.tmod \* TMOD_LISSAGE \+ \(1 - TMOD_LISSAGE\) \* ecart \* IPS;/);
  assert.match(src, /if \(ecart > 0 && ecart < TMOD_SAUT\)/,
    'au-delà du seuil, tmod garde sa valeur');
  // Une image au plus par rafraîchissement : l'excédent est PERDU, comme Flash.
  assert.match(src, /this\.attente = Math\.min\(this\.attente - IMAGE_FLASH, IMAGE_FLASH\);/);
  assert.match(src, /this\.jeu\.update\(tmod\)/, 'le moteur reçoit le tmod fractionnaire');
  assert.doesNotMatch(src, /this\.jeu\.update\(1\)/, 'et plus des pas entiers');
});

/*
 * La conséquence, mesurée sur le jeu, LES DEUX CADENCES À LA FOIS :
 *
 *   · le vaisseau avance de `speed*Std.tmod` par image (Hero.as) — en une
 *     seconde (quarante images à tmod 0,8) il parcourt 32 fois sa vitesse ;
 *   · l'escadre marche de `waveSpeed` par image, SANS tmod (Bads.waveUpdate) —
 *     en une seconde elle avance 40 fois sa vitesse de vague.
 *
 * L'ancienne boucle (32 pas entiers de tmod 1) donnait la bonne moyenne au
 * vaisseau mais ralentissait la marche d'un cinquième ; celle d'avant (40 pas
 * entiers) faisait l'inverse. Seul le modèle du lecteur donne les deux.
 */
test('une seconde de jeu : 40 images à tmod 0,8 — le vaisseau à 32, la vague à 40', () => {
  const IMAGES = 40, TMOD = 0.8;
  const jeu = new E.Game({ levels: NIVEAUX.main[0].levels, graine: 7 });
  for (let i = 0; i < 600 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.COMBAT, 'la partie est engagée');
  const h = jeu.hero;
  assert.ok(h, 'le vaisseau est en piste');

  // Le vaisseau : une seconde de course vers la droite, mesurée en pixels.
  h.x = jeu.shipBounds.min + h.ray;
  const x0 = h.x;
  jeu.entree = { gauche: false, droite: true, tir: false, bombe: false };
  for (let i = 0; i < IMAGES; i++) jeu.update(TMOD);
  const parcouru = h.x - x0;
  const attendu = h.speed * h.sens * 32;             // speed × tmod × 40 = speed × 32
  assert.ok(Math.abs(parcouru - attendu) < 0.001,
    `${IMAGES} images à tmod ${TMOD} : ${attendu} attendu, ${parcouru} mesuré`);

  // La vague : sa marche ne porte pas de tmod — elle dépend du NOMBRE d'images,
  // pas de leur durée nominale. On rejoue donc la même partie aux deux tmod et
  // on exige la MÊME trajectoire horizontale, image par image : c'est ce que
  // l'ancienne boucle à pas entiers de 32 par seconde ne donnait pas (un
  // cinquième de marche en moins par seconde).
  const trace = (tmod) => {
    const g = new E.Game({ levels: NIVEAUX.main[0].levels, graine: 7 });
    for (let i = 0; i < 600 && g.step !== E.ETAPE.COMBAT; i++) g.update(1);
    const b0 = g.badsList.find((b) => b.vivant !== false && b.flWave);
    const xs = [];
    for (let i = 0; i < IMAGES; i++) { g.update(tmod); xs.push(+b0.x.toFixed(3)); }
    return xs;
  };
  assert.deepEqual(trace(TMOD), trace(1),
    'la marche de la vague, image par image, ne dépend pas de tmod');
});
