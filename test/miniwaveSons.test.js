// Sons de Miniwave 2, extraits du SWF.
//
// Deux encodages. Les MP3 sortent tels quels. Les autres sont en ADPCM de Flash,
// qu'aucun navigateur ne sait lire : il faut le décoder en PCM ici.
//
// Un décodeur ADPCM qui se trompe ne PLANTE pas — il produit du bruit, et le
// fichier se joue quand même. C'est exactement ce qui s'est passé pendant
// l'écriture : en oubliant de retirer le bit de signe avant de consulter la
// table des pas, la moitié des ajustements étaient perdus, le pas ne
// redescendait jamais et jusqu'à 9 % des échantillons saturaient. Ces tests
// mesurent donc le SIGNAL, pas seulement la présence du fichier.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'public/miniwave/sons');
const SWF = path.join(ROOT, 'Games/miniWave2/miniwave.swf');

// Le manifeste du client : nom → extension attendue.
const declares = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/sons.js'), 'utf8');
  const bloc = /const FICHIERS = \{([\s\S]*?)\};/.exec(src)[1];
  const o = {};
  for (const m of bloc.matchAll(/(\w+):\s*'(\w+)'/g)) o[m[1]] = m[2];
  return o;
})();

// Lecture d'un WAV PCM 16 bits : en-tête RIFF puis les échantillons.
function lireWav(p) {
  const b = fs.readFileSync(p);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF', `${path.basename(p)} : en-tête RIFF`);
  assert.equal(b.toString('ascii', 8, 12), 'WAVE', `${path.basename(p)} : format WAVE`);
  const canaux = b.readUInt16LE(22);
  const taux = b.readUInt32LE(24);
  const bits = b.readUInt16LE(34);
  const n = (b.length - 44) / 2;
  const ech = new Int16Array(n);
  for (let i = 0; i < n; i++) ech[i] = b.readInt16LE(44 + i * 2);
  return { canaux, taux, bits, ech };
}

test('tous les sons que le client réclame existent', () => {
  assert.ok(Object.keys(declares).length >= 25, 'le manifeste couvre le jeu');
  for (const [nom, ext] of Object.entries(declares)) {
    const p = path.join(DOSSIER, nom + '.' + ext);
    assert.ok(fs.existsSync(p), `${nom}.${ext} présent`);
    assert.ok(fs.statSync(p).size > 200, `${nom}.${ext} a du contenu`);
  }
});

test('les MP3 sont des MP3, sans les deux octets de décalage du SWF', () => {
  for (const [nom, ext] of Object.entries(declares)) {
    if (ext !== 'mp3') continue;
    const b = fs.readFileSync(path.join(DOSSIER, nom + '.mp3'));
    // Une trame MP3 commence par onze bits à 1 (le motif de synchronisation) —
    // ou par une étiquette ID3. Si les deux octets de décalage du tag SWF
    // n'avaient pas été retirés, on ne tomberait pas dessus.
    const sync = (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) || b.toString('ascii', 0, 3) === 'ID3';
    assert.ok(sync, `${nom}.mp3 commence sur une trame (${b[0].toString(16)} ${b[1].toString(16)})`);
  }
});

test('l\'ADPCM décodé donne un vrai signal, pas de la saturation', () => {
  let vus = 0;
  for (const [nom, ext] of Object.entries(declares)) {
    if (ext !== 'wav') continue;
    const w = lireWav(path.join(DOSSIER, nom + '.wav'));
    vus++;
    assert.equal(w.bits, 16, `${nom} : PCM 16 bits`);
    assert.ok([5512, 11025, 22050, 44100].includes(w.taux), `${nom} : taux d'échantillonnage du SWF (${w.taux})`);
    assert.ok(w.ech.length > 100, `${nom} : le son a une durée (${w.ech.length} échantillons)`);

    let satures = 0, somme = 0, passages = 0, precedent = 0;
    for (let i = 0; i < w.ech.length; i++) {
      const v = w.ech[i];
      if (Math.abs(v) >= 32700) satures++;
      somme += v * v;
      if ((v < 0) !== (precedent < 0)) passages++;
      precedent = v;
    }
    const partSaturee = satures / w.ech.length;
    const rms = Math.sqrt(somme / w.ech.length);

    // Le symptôme du décodeur cassé : le prédicteur part en butée et y reste.
    assert.ok(partSaturee < 0.02,
      `${nom} : ${(partSaturee * 100).toFixed(1)} % d'échantillons en butée — le décodage dérive`);
    // Et le symptôme inverse : un son quasi muet trahirait un pas jamais relevé.
    assert.ok(rms > 200, `${nom} : le son a du niveau (rms ${rms.toFixed(0)})`);
    // Un son réel oscille. Une rampe continue (dérive du prédicteur) ne
    // traverserait presque jamais le zéro.
    assert.ok(passages / w.ech.length > 0.01,
      `${nom} : le signal oscille (${(100 * passages / w.ech.length).toFixed(1)} % de passages par zéro)`);
  }
  assert.ok(vus >= 15, `les sons ADPCM sont bien décodés (${vus})`);
});

test('les sons couvrent ce dont le jeu a besoin', () => {
  const { TIR_VAISSEAU, BOMBE_VAISSEAU } = (() => {
    const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/sons.js'), 'utf8');
    const lire = (n) => JSON.parse(new RegExp(`const ${n} = (\\[[^\\]]*\\])`).exec(src)[1].replace(/'/g, '"'));
    return { TIR_VAISSEAU: lire('TIR_VAISSEAU'), BOMBE_VAISSEAU: lire('BOMBE_VAISSEAU') };
  })();
  // Chacun des six vaisseaux a son tir et sa bombe : c'est ce qui les distingue
  // à l'oreille autant qu'à l'écran.
  assert.equal(TIR_VAISSEAU.length, 6, 'six sons de tir');
  assert.equal(BOMBE_VAISSEAU.length, 6, 'six sons de bombe');
  for (const n of TIR_VAISSEAU.concat(BOMBE_VAISSEAU)) {
    assert.ok(declares[n], `${n} fait partie du lot extrait`);
  }
  // Le battement de la vague : quatre bips joués en boucle, dont le rythme
  // s'accélère à mesure qu'on nettoie l'escadre.
  for (let i = 0; i < 4; i++) assert.ok(declares['sWaveBeep' + i], `sWaveBeep${i} présent`);
});

test('l\'extraction est reproductible depuis le SWF', () => {
  const avant = new Map();
  for (const f of fs.readdirSync(DOSSIER)) avant.set(f, fs.readFileSync(path.join(DOSSIER, f)));
  const ids = execFileSync(process.execPath, [path.join(ROOT, 'scripts/extract-swf-sounds.js'), SWF],
    { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((l) => /^#(\d+)/.exec(l)).filter(Boolean).map((m) => m[1]);
  assert.ok(ids.length >= 30, `le SWF porte bien tous ses sons (${ids.length})`);
  execFileSync(process.execPath,
    [path.join(ROOT, 'scripts/extract-swf-sounds.js'), SWF, DOSSIER, ...ids],
    { cwd: ROOT, stdio: 'ignore' });
  for (const [f, octets] of avant) {
    assert.ok(fs.readFileSync(path.join(DOSSIER, f)).equals(octets),
      `${f} est identique après ré-extraction`);
  }
});
