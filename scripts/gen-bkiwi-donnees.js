#!/usr/bin/env node
// Engendre public/bkiwi/jeu/donnees.js depuis Games/burningKiwi/inc/gameData.as :
// le fichier AS2 s'évalue tel quel (des affectations et des littéraux), on en
// réécrit chaque variable dans l'ordre du source, posée sur le clip principal.
// Une valeur est prise au fichier COMPILÉ plutôt qu'au source : demoLabel
// (« PAS ENCORE DEBLOQUE » dans burningkiwi.swf, « JEU COMPLET UNIQUEMENT »
// dans gameData.as).
//
//   node scripts/gen-bkiwi-donnees.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(RACINE, 'Games/burningKiwi/inc/gameData.as'), 'latin1');
const ctx = { String, Array, Math, Object, Infinity };
vm.createContext(ctx);
vm.runInContext(src, ctx);

const ordre = [];
for (const m of src.matchAll(/^([A-Za-z_$][\w$]*)\s*=/gm)) if (!ordre.includes(m[1])) ordre.push(m[1]);

function ser(v, ind) {
  if (v === undefined) return 'undefined';
  if (v === Infinity) return 'Infinity';
  if (v instanceof String) return JSON.stringify(String(v));
  if (Array.isArray(v)) {
    const cles = Object.keys(v).map(Number).filter((k) => !Number.isNaN(k)).sort((a, b) => a - b);
    if (!cles.length) return v.length ? 'new Array(' + v.length + ')' : '[]';   // controls = new Array(5)
    const compact = cles.length && !cles.some((k) => k >= 100) && cles.length === v.length;
    if (compact) {
      const objets = v.every((e) => e && typeof e === 'object' && !Array.isArray(e));
      if (objets && v.length > 4) return '[\n' + v.map((e, i) => ind + '  ' + ser(e, ind + '  ') + ', // ' + i).join('\n') + '\n' + ind + ']';
      const simples = v.every((e) => typeof e !== 'object' || e === null);
      if (simples) return '[' + v.map((e) => ser(e, ind)).join(', ') + ']';
      return '[\n' + v.map((e) => ind + '  ' + ser(e, ind + '  ')).join(',\n') + '\n' + ind + ']';
    }
    // Un tableau CREUX (tracks[99], CP[99], carSkinNames[20…]) : on le bâtit.
    const denses = [];
    let n = 0;
    while (n < v.length && Object.prototype.hasOwnProperty.call(v, n)) { denses.push(v[n]); n++; }
    let s = '(function () {\n' + ind + '  const a = ' + ser(denses, ind + '  ') + ';\n';
    for (const k of cles) if (k >= n) s += ind + '  a[' + k + '] = ' + ser(v[k], ind + '  ') + ';\n';
    return s + ind + '  return a;\n' + ind + '})()';
  }
  if (v && typeof v === 'object') {
    const ent = Object.entries(v);
    const simples = ent.every(([, e]) => typeof e !== 'object' || e === null || e instanceof String);
    if (simples) return '{ ' + ent.map(([k, e]) => k + ': ' + ser(e, ind)).join(', ') + ' }';
    return '{\n' + ent.map(([k, e]) => ind + '  ' + k + ': ' + ser(e, ind + '  ')).join(',\n') + '\n' + ind + '}';
  }
  return JSON.stringify(v);
}

const ENTETE = [
  '/*',
  ' * Burning Kiwi — les DONNÉES (Games/burningKiwi/inc/gameData.as), posées sur',
  ' * le clip principal comme le fichier les pose sur son scénario : les',
  ' * profondeurs (DP_*, dans l\'ordre du c++ — DP_FXTOP est assigné deux fois,',
  ' * il vaut 13), les modes, les constantes de la physique (roadFriction 0,99,',
  ' * stepMax 9, borderMaxSpeed 3, borderMaxAccelSpeed 1,5, baseNitroTimer 60,',
  ' * nitroMaxSpeed 18…), les cinq voitures (carStats : rot, accel, brake,',
  ' * turning, maxSpeed, grip, kiwis, skin) et leurs jauges (staticStats), les',
  ' * six circuits et le square du tutorial (tracks[99]) — points de départ,',
  ' * décors de premier plan, IA, tours, difficulté —, les checkpoints (CP,',
  ' * avec leur tolérance dist, leur maxSpeed où l\'IA freine et leur',
  ' * distanceCheckFactor), la carte des kiwis du Kiwi-Run, les codes spéciaux.',
  ' *',
  ' * Ce fichier est ENGENDRÉ du source par scripts/gen-bkiwi-donnees.js (le',
  ' * gameData.as s\'évalue tel quel), et vérifié contre le bytecode du SWF :',
  ' * les 218 checkpoints y sont, au pixel près. Une seule valeur diffère du',
  ' * source, et c\'est celle du fichier compilé qu\'on garde : demoLabel, le',
  ' * libellé du refus, « PAS ENCORE DEBLOQUE » (le source dit « JEU COMPLET',
  ' * UNIQUEMENT »).',
  ' */',
  '\'use strict\';',
  '',
  '(function (racine) {',
  '',
  'const J = racine.BkiwiJeu = racine.BkiwiJeu || {};',
  '',
  'J.initialiserDonnees = function (M) {',
].join('\n') + '\n';

let out = ENTETE;
for (const k of ordre) {
  if (k === 'c') continue;
  let v = ctx[k];
  if (k === 'demoLabel') v = 'PAS ENCORE DEBLOQUE';
  out += '  M.' + k + ' = ' + ser(v, '  ') + ';\n';
}
out += '};\n\n})(typeof window !== \'undefined\' ? window : globalThis);\n';
fs.writeFileSync(path.join(RACINE, 'public/bkiwi/jeu/donnees.js'), out);
console.log('→ public/bkiwi/jeu/donnees.js (' + ordre.length + ' variables)');
