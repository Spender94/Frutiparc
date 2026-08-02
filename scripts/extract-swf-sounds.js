#!/usr/bin/env node
// Extrait les sons d'un SWF vers des fichiers lisibles par un navigateur.
//
// Troisième extracteur de la famille, après les formes et les images.
//
//   node scripts/extract-swf-sounds.js <fichier.swf> [sortie/] [id…]
//
// Sans identifiants, liste les sons avec leur format — c'est ainsi qu'on repère
// ce qu'on cherche. Les noms d'auteur (ExportAssets) sont affichés quand ils
// existent : c'est par eux que le jeu les appelle (« sLaser0 », « sPop2 »…).
//
// Deux encodages, deux traitements :
//
//   MP3 → .mp3, tel quel. Le tag porte deux octets de plus au début
//     (SeekSamples, le décalage de lecture) qu'on retire : le reste EST un MP3.
//
//   ADPCM → .wav. C'est l'ADPCM de Flash, qu'aucun navigateur ne sait lire. On
//     le décode ici en PCM 16 bits et on l'emballe en WAV. Le format est une
//     variante d'IMA à largeur de code VARIABLE (2 à 5 bits) : chaque mot porte
//     un bit de signe et le reste en magnitude, et le pas de quantification suit
//     une table de 89 valeurs dans laquelle on se déplace à chaque échantillon.
//     Les données sont découpées en blocs de 4096 échantillons, chacun rouvrant
//     avec un échantillon et un index bruts — c'est ce qui permet de reprendre
//     la lecture en cours de route sans dériver.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Signature inconnue : ' + sig);
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
}

// ── ADPCM de Flash ────────────────────────────────────────────────────────
// La table des pas : 89 valeurs, de 7 à 32767. L'index se déplace selon le mot
// lu — un grand écart fait monter le pas, un petit le fait descendre.
const PAS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];
// Le déplacement de l'index, par largeur de code (2, 3, 4 puis 5 bits).
const INDEX = {
  2: [-1, 2],
  3: [-1, -1, 2, 4],
  4: [-1, -1, -1, -1, 2, 4, 6, 8],
  5: [-1, -1, -1, -1, -1, -1, -1, -1, 1, 2, 4, 6, 8, 10, 13, 16],
};

class Bits {
  constructor(b, o) { this.b = b; this.o = o; this.bit = 0; }
  u(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((this.b[this.o] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.o++; }
    }
    return v >>> 0;
  }
  s(n) { const v = this.u(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
}

function decoderAdpcm(data, nEchantillons, canaux) {
  const bits = new Bits(data, 0);
  const taille = bits.u(2) + 2;             // largeur de code : 2 à 5 bits
  const table = INDEX[taille];
  const sortie = new Int16Array(nEchantillons * canaux);
  let ecrit = 0;

  while (ecrit < sortie.length) {
    // Ouverture de bloc : l'état est réinscrit en clair.
    const pred = [], idx = [];
    for (let c = 0; c < canaux; c++) {
      pred.push(bits.s(16));
      idx.push(bits.u(6));
      sortie[ecrit++] = pred[c];
    }
    // Puis 4095 mots par canal — ou moins si le son se termine avant.
    for (let n = 0; n < 4095 && ecrit < sortie.length; n++) {
      for (let c = 0; c < canaux && ecrit < sortie.length; c++) {
        const code = bits.u(taille);
        const pas = PAS[idx[c]];
        // Magnitude : le bit de poids fort du reste vaut un pas entier, le
        // suivant un demi-pas, etc., plus un demi-pas de base.
        let diff = pas >> (taille - 1);
        for (let i = taille - 2; i >= 0; i--) {
          if (code & (1 << i)) diff += pas >> (taille - 2 - i);
        }
        if (code & (1 << (taille - 1))) pred[c] -= diff; else pred[c] += diff;
        if (pred[c] > 32767) pred[c] = 32767;
        if (pred[c] < -32768) pred[c] = -32768;
        // Le déplacement de l'index ne dépend QUE de la magnitude : le bit de
        // signe est retiré. L'oublier fait rater la moitié des ajustements —
        // le pas ne redescend jamais, et le son sature.
        idx[c] += table[code & ((1 << (taille - 1)) - 1)];
        if (idx[c] < 0) idx[c] = 0;
        if (idx[c] > 88) idx[c] = 88;
        sortie[ecrit++] = pred[c];
      }
    }
  }
  return sortie;
}

// Emballage WAV minimal (PCM 16 bits) : en-tête RIFF de 44 octets, puis les
// échantillons. Aucune dépendance, et tous les navigateurs le lisent.
function versWav(pcm, taux, canaux) {
  const octets = Buffer.alloc(44 + pcm.length * 2);
  octets.write('RIFF', 0);
  octets.writeUInt32LE(36 + pcm.length * 2, 4);
  octets.write('WAVE', 8);
  octets.write('fmt ', 12);
  octets.writeUInt32LE(16, 16);
  octets.writeUInt16LE(1, 20);                          // PCM
  octets.writeUInt16LE(canaux, 22);
  octets.writeUInt32LE(taux, 24);
  octets.writeUInt32LE(taux * canaux * 2, 28);          // octets par seconde
  octets.writeUInt16LE(canaux * 2, 32);                 // alignement de bloc
  octets.writeUInt16LE(16, 34);
  octets.write('data', 36);
  octets.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) octets.writeInt16LE(pcm[i], 44 + i * 2);
  return octets;
}

// ── Parcours ──────────────────────────────────────────────────────────────
const FORMATS = ['PCM', 'ADPCM', 'MP3', 'PCM-LE', 'Nellymoser16', 'Nellymoser8', '', '', '', '', '', 'Speex'];
const TAUX = [5512, 11025, 22050, 44100];

const [, , fichier, sortie, ...ids] = process.argv;
if (!fichier) {
  console.error('usage : extract-swf-sounds.js <fichier.swf> [sortie/] [id…]');
  process.exit(1);
}
const b = lireSwf(fichier);
const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;

const sons = [];
const noms = new Map();
(function scan(from, to) {
  let o = from;
  while (o < to) {
    const hdr = b.readUInt16LE(o), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
    if (code === 0) break;
    const corps = o + hs;
    if (code === 39) scan(corps + 4, corps + len);
    if (code === 14) sons.push({ corps, len });
    if (code === 56 || code === 76) {                    // ExportAssets : les noms
      let p = corps;
      const n = b.readUInt16LE(p); p += 2;
      for (let i = 0; i < n; i++) {
        const id = b.readUInt16LE(p); p += 2;
        let e = p; while (e < corps + len && b[e] !== 0) e++;
        noms.set(id, b.slice(p, e).toString('utf8'));
        p = e + 1;
      }
    }
    o += hs + len;
  }
})(debut, b.length);

function extraire(t) {
  const id = b.readUInt16LE(t.corps);
  const f = b[t.corps + 2];
  const format = f >> 4;
  const taux = TAUX[(f >> 2) & 3];
  const canaux = (f & 1) ? 2 : 1;
  const n = b.readUInt32LE(t.corps + 3);
  const data = b.subarray(t.corps + 7, t.corps + t.len);
  const info = { id, nom: noms.get(id) || ('son' + id), format, taux, canaux, n };
  if (format === 2) {
    // Les deux premiers octets sont le décalage de lecture, pas du son.
    return Object.assign(info, { ext: '.mp3', octets: Buffer.from(data.subarray(2)), note: 'MP3 tel quel' });
  }
  if (format === 1) {
    const pcm = decoderAdpcm(data, n, canaux);
    return Object.assign(info, { ext: '.wav', octets: versWav(pcm, taux, canaux), note: 'ADPCM décodé en PCM' });
  }
  if (format === 0 || format === 3) {
    // PCM brut : il ne manque que l'en-tête WAV.
    const pcm = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));
    return Object.assign(info, { ext: '.wav', octets: versWav(pcm, taux, canaux), note: 'PCM emballé' });
  }
  throw new Error('format non géré : ' + (FORMATS[format] || format));
}

const voulus = new Set(ids.map(Number));
const parNom = new Map(ids.filter((x) => Number.isNaN(Number(x))).map((x) => [x, true]));
let ecrits = 0;
for (const t of sons) {
  const id = b.readUInt16LE(t.corps);
  const nom = noms.get(id);
  const choisi = (voulus.size || parNom.size)
    ? (voulus.has(id) || (nom && parNom.has(nom)))
    : true;
  if (!choisi) continue;
  let s;
  try { s = extraire(t); } catch (e) { console.error(`  #${id} : ${e.message}`); continue; }
  if (!voulus.size && !parNom.size) {
    console.log(`#${id}\t${(s.nom || '').padEnd(16)}\t${FORMATS[s.format]}\t${s.taux}Hz\t`
      + `${s.canaux === 2 ? 'stéréo' : 'mono'}\t${(s.n / s.taux).toFixed(2)}s\t${s.ext.slice(1)}`);
    continue;
  }
  if (!sortie) { console.log(`#${id} ${s.nom} ${s.note} (${s.octets.length} o)`); continue; }
  fs.mkdirSync(sortie, { recursive: true });
  const dest = path.join(sortie, s.nom + s.ext);
  fs.writeFileSync(dest, s.octets);
  console.log(`#${id} → ${dest}  (${s.note}, ${(s.n / s.taux).toFixed(2)}s, ${s.octets.length} o)`);
  ecrits++;
}
if ((voulus.size || parNom.size) && sortie) console.log(`${ecrits} son(s) écrit(s)`);
