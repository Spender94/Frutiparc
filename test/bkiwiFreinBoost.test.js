/*
 * BURNING KIWI — LE FREIN PENDANT LA NITRO.
 *
 * « Permettre l'utilisation du frein lorsque la voiture est en phase de
 *   boost. Fonctionnalité présente à l'époque, en atteste les chronomètres
 *   sur les circuits comme Solstice sous 51" vs 53"XXX aujourd'hui. »
 *
 * CE QUE FAISAIT LE JEU D'ORIGINE. Dans manageGame (inc/mainGame.as), le
 * bloc FREINAGE ne regarde pas la nitro :
 *
 *     if (carPJ.finished || Key.isDown(controls[1]) ) {
 *       … carPJ.speed *= Math.pow(carPJ.statBrake, gtmod) ;
 *   //    nitroStopped = true ;
 *
 * La ligne qui aurait éteint le boost au freinage est EN COMMENTAIRE, et le
 * bytecode des deux disques (burningkiwi.swf, racer.swf) le confirme : un
 * seul bloc lit controls[1], il applique statBrake et ne touche à rien de la
 * nitro. Freiner pendant le boost multiplie donc la vitesse par
 * statBrake^gtmod à chaque image, comme hors boost, sans l'éteindre.
 *
 * POURQUOI ON CROIT QU'IL N'AGIT PAS. La nitro accélère de force tant que
 * nitroTimer > 0, avec accelBoost = 9^(1/gtmod) — ×15,6 à quarante images
 * par seconde. Elle reprend presque tout ce que le frein retire : la vitesse
 * de croisière ne baisse que de 17,75 à 16,53 (voiture 2), soit 7 %. C'est
 * ce que fait le fichier, et c'est ce que fait le portage — ce test le
 * vérifie sur le vrai manageGame (jeu/moteur.js), et le verrouille.
 *
 * Ce que gagne quand même le pilote : la perte de braquage pendant la nitro
 * vaut 0,3 × vitesse (rotationVitesseRapide) ; moins vite, il tourne plus
 * court, sans perdre son boost.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

globalThis.window = undefined;
for (const f of ['public/kaluga/moteur/formes.js', 'public/kaluga/moteur/flash.js', 'public/kaluga/moteur/texte.js',
  'public/bkiwi/jeu/scripts-images.js', 'public/bkiwi/jeu/biblio.js',
  'public/bkiwi/jeu/donnees.js', 'public/bkiwi/jeu/moteur.js']) {
  require(path.join(ROOT, f));
}
const K = globalThis.KalugaMoteur;
const J = globalThis.BkiwiJeu;

const GTMOD = 0.8;                     // 25 ms × 0,032 : quarante images par seconde (biblio.js)
const HAUT = 38, FREIN = 17, GAUCHE = 37, NITRO = 32;   // defaultControls de gameData.as

/*
 * Une ligne droite, sur le vrai manageGame : les données de gameData.as
 * (initialiserDonnees), le moteur installé sur un clip principal nu, le mode
 * éditeur pour se passer des zones du circuit (pas de terre, pas de vide), et
 * rien d'autre — ni IA, ni checkpoints, ni fumée. La nitro part au premier
 * pas ; `touches(pas)` dit ce qui est tenu à chaque pas.
 */
function rouler(touches, nbPas, idVoiture) {
  const M = {};
  J.initialiserDonnees(M);
  J.installerMoteur(M);
  J.moveIA = () => {};
  J.testCheckPoints = () => {};
  J.startBoostAnim = () => {};
  J.stopBoostAnim = () => {};
  J.spawnSmoke = () => {};
  J.G.gtmod = GTMOD;
  M.EDITORMODE = true;
  M.gameQuality = M.LOW;
  M.controls = M.defaultControls.slice();
  M.vs = { nitroFlag: false, startBoost: 0, gameMode: M.TIMETRIAL };
  M.nitroStopped = false;
  M.accelBoost = 1;
  M.hitBorder = 0;
  const st = M.carStats[idVoiture];
  const car = {
    x: 0, y: 0, oldX: 0, oldY: 0, _rotation: 0, accelAng: 0, speed: 8, speedA: 8,
    statRot: st.rot, statAccel: st.accel, statBrake: st.brake, statTurning: st.turning,
    statMaxSpeed: st.maxSpeed, currentMaxSpeed: st.maxSpeed, statGrip: st.grip,
    vs: { kiwis: st.kiwis, immuneHit: 0, offRoad: 0 }, nitroTimer: 0, finished: false, derapage: 0,
    preImmune: 0, spawnImmune: 0, signLastRotation: 1, skin: { _currentframe: 1 }, _alpha: 100,
  };
  M.carPJ = car;
  M.cars = [car];
  M.carShadows = [{}];
  M.track = { id: 0, localToGlobal() {}, skin: { sub: { outZone: { hitTest: () => false }, borderZone: { hitTest: () => false } } } };
  const releve = [];
  for (let pas = 1; pas <= nbPas; pas++) {
    K.Key.enfoncees = {};
    for (const code of touches(pas)) K.Key.enfoncees[code] = true;
    const avant = car.speed;
    J.manageGame();
    releve.push({ avant, v: car.speed, nitro: M.vs.nitroFlag, timer: car.nitroTimer, rot: car._rotation,
      rapide: M.rotationVitesseRapide, accelBoost: M.accelBoost });
  }
  return { M, releve };
}

const gaz = (pas) => (pas === 1 ? [HAUT, NITRO] : [HAUT]);
const gazEtFrein = (pas) => gaz(pas).concat([FREIN]);

// La vitesse de croisière sous nitro, tirée des formules de mainGame.as :
//   speed += gtmod·((18 − speed)/(18 + 15))·statAccel·accelBoost ;
//   speed *= statBrake^gtmod (si l'on freine) ; speed *= roadFriction^gtmod.
function croisiere(M, st, freine) {
  const k = GTMOD * st.accel * Math.pow(9, 1 / GTMOD) / (M.nitroMaxSpeed + 15);
  const c = (freine ? Math.pow(st.brake, GTMOD) : 1) * Math.pow(M.roadFriction, GTMOD);
  return c * k * M.nitroMaxSpeed / (1 - c * (1 - k));
}

test('freiner pendant la nitro ne l\'éteint pas : même minuterie, même durée de boost', () => {
  const sans = rouler(gaz, 90, 2).releve, avec = rouler(gazEtFrein, 90, 2).releve;
  const duree = (r) => r.filter((p) => p.nitro).length;
  assert.ok(duree(sans) > 70, 'la nitro dure baseNitroTimer / gtmod pas : ' + duree(sans));
  assert.strictEqual(duree(avec), duree(sans), 'le frein ne coupe pas le boost');
  assert.deepStrictEqual(avec.map((p) => p.timer), sans.map((p) => p.timer), 'nitroTimer décompte pareil');
});

test('pendant la nitro, chaque image de frein multiplie la vitesse par statBrake^gtmod, comme hors boost', () => {
  const { M, releve } = rouler(gazEtFrein, 90, 2);
  const st = M.carStats[2];
  const frein = Math.pow(st.brake, GTMOD), friction = Math.pow(M.roadFriction, GTMOD);
  let vus = 0;
  for (const p of releve) {
    if (!p.nitro) continue;
    const pousse = p.avant + GTMOD * ((M.nitroMaxSpeed - p.avant) / (M.nitroMaxSpeed + 15)) * st.accel * p.accelBoost;
    assert.ok(Math.abs(p.v - pousse * frein * friction) < 1e-9, `pas ${vus + 1} : ${p.v} au lieu de ${pousse * frein * friction}`);
    vus++;
  }
  assert.ok(vus > 70, 'toutes les images du boost : ' + vus);
});

test('sous nitro, le frein abaisse la vitesse de croisière — de peu, l\'accélération forcée reprend presque tout', () => {
  for (const id of [0, 2, 4]) {
    const sans = rouler(gaz, 40, id), avec = rouler(gazEtFrein, 40, id);
    const st = sans.M.carStats[id];
    const vSans = sans.releve[39].v, vAvec = avec.releve[39].v;
    assert.ok(Math.abs(vSans - croisiere(sans.M, st, false)) < 1e-3, `voiture ${id} sans frein : ${vSans}`);
    assert.ok(Math.abs(vAvec - croisiere(avec.M, st, true)) < 1e-3, `voiture ${id} au frein : ${vAvec}`);
    assert.ok(vAvec < vSans, `voiture ${id} : ${vAvec} < ${vSans}`);
    for (let i = 0; i < 40; i++) assert.ok(avec.releve[i].v < sans.releve[i].v, `voiture ${id}, pas ${i + 1}`);
  }
  // La voiture 2 (celle des bancs d'essai) : 17,75 → 16,53.
  const st2 = rouler(gaz, 1, 2).M;
  assert.strictEqual(croisiere(st2, st2.carStats[2], false).toFixed(2), '17.75');
  assert.strictEqual(croisiere(st2, st2.carStats[2], true).toFixed(2), '16.53');
});

test('freiner sous nitro fait tourner plus court (la perte de braquage suit la vitesse)', () => {
  const braque = (pas) => gaz(pas).concat([GAUCHE]);
  const sans = rouler(braque, 60, 2).releve, avec = rouler((pas) => braque(pas).concat([FREIN]), 60, 2).releve;
  assert.ok(avec[59].nitro && sans[59].nitro, 'toujours sous nitro');
  assert.ok(avec[59].rapide < sans[59].rapide, 'rotationVitesseRapide = 0,3 × vitesse : plus petite au frein');
  assert.ok(Math.abs(avec[59].rot) > Math.abs(sans[59].rot) + 5,
    `cap après 60 pas : ${avec[59].rot.toFixed(1)}° au frein, ${sans[59].rot.toFixed(1)}° sans`);
});

test('le jeu d\'origine : le bloc FREINAGE ne regarde pas la nitro (mainGame.as, burningkiwi.swf, racer.swf)', () => {
  // Le source : la condition, et la coupure du boost restée en commentaire.
  const src = fs.readFileSync(path.join(ROOT, 'Games/burningKiwi/inc/mainGame.as'), 'latin1');
  const i = src.indexOf('// ** FREINAGE');
  assert.ok(i > 0, 'le bloc FREINAGE');
  const bloc = src.slice(i, src.indexOf('// D', i + 10));
  assert.match(bloc, /if \(carPJ\.finished \|\| Key\.isDown\(controls\[1\]\) \)/);
  assert.match(bloc, /carPJ\.speed \*= Math\.pow\(carPJ\.statBrake, gtmod\)/);
  assert.match(bloc, /^\/\/\s+nitroStopped = true ;/m, 'la coupure du boost est en commentaire');
  assert.doesNotMatch(bloc.replace(/^\/\/.*$/mg, ''), /nitro/i, 'aucune condition de nitro');

  // Le bytecode des deux disques : un seul bloc lit Key.isDown(controls[1]),
  // il applique statBrake et ne nomme rien de la nitro.
  for (const swf of ['Games/burningKiwi/burningkiwi.swf', 'Games/burningKiwi/racer.swf']) {
    const sortie = execFileSync(process.execPath, [path.join(ROOT, 'scripts/disasm-as2.js'), path.join(ROOT, swf), '--sprites'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const lignes = sortie.split('\n').map((l) => /^\s*0x([0-9a-f]+)\s+(.*)$/.exec(l)).filter(Boolean)
      .map((m) => ({ a: parseInt(m[1], 16), t: m[2].trim() }));
    const motif = ['Push "controls"', 'GetVariable', 'Push 1', 'GetMember', 'Push 1, "Key"', 'GetVariable', 'Push "isDown"', 'CallMethod', 'Not'];
    const blocs = [];
    for (let k = 0; k < lignes.length; k++) {
      if (!motif.every((m, d) => lignes[k + d] && lignes[k + d].t === m)) continue;
      const saut = /^If -> 0x([0-9a-f]+)$/.exec(lignes[k + motif.length].t);
      if (!saut) continue;
      const fin = parseInt(saut[1], 16);
      const corps = [];
      for (let j = k + motif.length + 1; j < lignes.length && lignes[j].a < fin; j++) corps.push(lignes[j].t);
      blocs.push(corps);
    }
    assert.strictEqual(blocs.length, 1, swf + ' : un seul bloc de frein');
    assert.ok(blocs[0].some((t) => t === 'Push "statBrake"'), swf + ' : le frein applique statBrake');
    assert.deepStrictEqual(blocs[0].filter((t) => /nitro/i.test(t)), [], swf + ' : rien de la nitro dans le bloc');
    // La seule coupure du boost du fichier est celle de la terre (hitBorder).
    assert.strictEqual(lignes.filter((l) => l.t === 'Push "nitroStopped", true').length, 1, swf);
  }
});
