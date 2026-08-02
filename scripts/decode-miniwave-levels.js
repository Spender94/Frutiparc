#!/usr/bin/env node
// Décode les niveaux de Miniwave 2 (Games/miniWave2/inc/level/*.as) en JSON.
//
// Les vagues du jeu sont rangées dans une chaîne encodée par ext.util.PersistCodec,
// une sérialisation Motion-Twin dont AUCUNE source n'existe dans le dépôt : la
// bibliothèque ne vit que compilée, dans Games/miniWave2/lib.swf. Ce fichier est
// la traduction en JS de son bytecode AS2 (classes ext.util.MTBitcodec et
// ext.util.PersistCodec), désassemblé pour l'occasion.
//
//   node scripts/decode-miniwave-levels.js            → écrit public/miniwave/levels.json
//   node scripts/decode-miniwave-levels.js --resume   → n'affiche qu'un résumé
//
// Le format, dans l'ordre où le décodeur le lit :
//
//   • MTBitcodec est un flux de BITS lu par paquets de 6, chaque caractère
//     portant 6 bits (alphabet base64 « a-zA-Z0-9-_ », minuscules d'abord) ;
//   • un entier s'annonce par 2 bits de gabarit : 0/1/2 → la valeur tient sur
//     2/4/6 bits ; 3 → un bit de signe, puis un bit qui choisit 32 ou 16 bits ;
//   • un flottant est un entier (partie basse) suivi d'un entier divisé par
//     65536 (partie fractionnaire) ;
//   • une chaîne donne sa longueur, puis un bit : soit 6 bits par caractère
//     (alphabet base64), soit 7 ou 8 bits selon un second bit ;
//   • un objet répète { champ, valeur }. Le NOM du champ n'est écrit en toutes
//     lettres qu'à sa première apparition : ensuite il est désigné par son index
//     dans un dictionnaire commun, sur juste assez de bits pour le contenir.
//     C'est ce qui rend le format si compact sur des tableaux d'objets
//     homogènes — et c'est aussi pourquoi il faut décoder dans l'ordre ;
//   • un tableau répète { présent, valeur }, avec une échappatoire pour sauter
//     N cases vides d'un coup (les tableaux peuvent donc être troués).
//
// Le décodeur d'origine est INCRÉMENTAL (une poignée d'éléments par image, pour
// ne pas geler le lecteur Flash pendant la décompression) : il tient une pile
// des conteneurs en cours de remplissage. On garde cette mécanique telle quelle
// — c'est elle qui définit l'ordre de lecture — en la faisant simplement tourner
// jusqu'au bout d'un coup.

const fs = require('fs');
const path = require('path');

// ── MTBitcodec : le flux de bits ──
const D64 = (() => {
  const t = new Map();
  for (let i = 0; i < 26; i++) t.set(String.fromCharCode(97 + i), i);        // a-z → 0-25
  for (let i = 0; i < 26; i++) t.set(String.fromCharCode(65 + i), 26 + i);   // A-Z → 26-51
  for (let i = 0; i < 10; i++) t.set(String.fromCharCode(48 + i), 52 + i);   // 0-9 → 52-61
  t.set('-', 62);
  t.set('_', 63);
  return t;
})();
const C64 = (n) => {
  if (n < 0 || n > 63) return '?';
  if (n < 26) return String.fromCharCode(97 + n);
  if (n < 52) return String.fromCharCode(65 + n - 26);
  if (n < 62) return String.fromCharCode(48 + n - 52);
  return n === 62 ? '-' : '_';
};

class Bits {
  constructor(input) { this.input = input; this.pos = 0; this.nbits = 0; this.bits = 0; this.erreur = false; }
  // Traduction littérale du bytecode : accumulateur 32 bits, décalages et
  // masque comme en AS2. Les bits déjà consommés restent dans l'accumulateur —
  // ils sortent d'eux-mêmes par la gauche — et le masque les ignore. Reproduire
  // ce débordement est nécessaire : c'est lui qui définit ce que le jeu lisait.
  read(n) {
    while (this.nbits < n) {
      const v = D64.get(this.input.charAt(this.pos++));
      if (this.pos > this.input.length || v === undefined) { this.erreur = true; return -1; }
      this.nbits += 6;
      this.bits = (this.bits << 6) | v;
    }
    this.nbits -= n;
    return (this.bits >> this.nbits) & ((1 << n) - 1);
  }
}

// ── PersistCodec : les types ──
class Codec {
  constructor(input) {
    this.bc = new Bits(input);
    this.champs = [];            // dictionnaire des noms de champs déjà vus
    this.nchamps = 0;
    this.prochainSeuil = 1;      // au-delà, il faut un bit de plus pour l'index
    this.bitsIndex = 0;
    this.pile = [];              // conteneurs en cours de remplissage
    this.racine = null;
  }

  decodeInt() {
    const k = this.bc.read(2);
    if (k !== 3) return this.bc.read((k + 1) * 2);
    if (this.bc.read(1)) return -this.decodeInt();
    return this.bc.read(1) ? this.bc.read(32) : this.bc.read(16);
  }

  decodeFloat() {
    const ent = this.decodeInt();
    const frac = this.decodeInt() / 65536;
    return ent < 0 ? ent + 1 - frac : ent + frac;
  }

  decodeString() {
    const n = this.decodeInt();
    let s = '';
    if (!this.bc.read(1)) {                       // 6 bits par caractère
      for (let i = 0; i < n; i++) s += C64(this.bc.read(6));
      return s;
    }
    const bits = this.bc.read(1) ? 8 : 7;         // sinon 7 ou 8 bits
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bc.read(bits));
    return s;
  }

  // Un conteneur est renvoyé VIDE et empilé : ses éléments arrivent aux tours
  // suivants. C'est ce qui permettait au jeu d'étaler la décompression.
  decodeArray() { const a = []; a.__pos = 0; this.pile.unshift(a); return a; }
  decodeObject() { const o = {}; this.pile.unshift(o); return o; }

  decodeArrayItem(a) {
    if (!this.bc.read(1)) { a[a.__pos++] = this.doDecode(); return true; }
    if (this.bc.read(1)) return false;            // fin du tableau
    a.__pos += this.decodeInt();                  // saut de cases vides
    return true;
  }

  decodeObjectField(o) {
    let nom;
    if (!this.bc.read(1)) {
      nom = this.champs[this.bc.read(this.bitsIndex)];   // nom déjà connu
    } else {
      if (this.bc.read(1)) return false;                 // fin de l'objet
      nom = this.decodeString();
      this.champs[this.nchamps++] = nom;
      if (this.nchamps >= this.prochainSeuil) { this.bitsIndex++; this.prochainSeuil *= 2; }
    }
    o[nom] = this.doDecode();
    return true;
  }

  doDecode() {
    if (!this.bc.read(1)) {                        // nombre
      if (!this.bc.read(1)) return this.decodeInt();
      if (!this.bc.read(1)) return this.decodeFloat();
      if (!this.bc.read(1)) return NaN;
      return this.bc.read(1) ? -Infinity : Infinity;
    }
    if (!this.bc.read(1)) {                        // conteneur
      return this.bc.read(1) ? this.decodeObject() : this.decodeArray();
    }
    switch (this.bc.read(2)) {                     // le reste
      case 0: return false;
      case 1: return true;
      case 2: return this.decodeString();
      default: return undefined;
    }
  }

  // Un tour du décodeur d'origine : soit la racine, soit l'élément suivant du
  // conteneur au sommet de la pile. Renvoie true quand il n'y a plus rien.
  tour() {
    if (!this.pile.length) {
      this.racine = this.doDecode();
    } else {
      const c = this.pile[0];
      const encore = Array.isArray(c) ? this.decodeArrayItem(c) : this.decodeObjectField(c);
      if (!encore) this.pile.shift();
    }
    if (this.bc.erreur) { this.racine = null; return true; }
    return this.pile.length === 0;
  }
}

// Décode une chaîne complète et rend une valeur JS propre (sans le curseur
// interne que le décodeur promène sur les tableaux).
function decoder(chaine) {
  const c = new Codec(chaine);
  let garde = 0;
  while (!c.tour()) {
    if (++garde > 5e6) throw new Error('décodage sans fin — format inattendu');
  }
  if (c.bc.erreur) throw new Error('flux corrompu (caractère hors alphabet ou fin prématurée)');
  return nettoyer(c.racine);
}

// Les niveaux ont été sauvegardés depuis l'ÉDITEUR, qui laisse traîner dans le
// flux deux champs qui ne servent qu'à lui : `path` (la référence au clip qui
// dessine la trajectoire — sérialisée, elle ressort en bouillie d'objets Flash :
// onPress, useHandCursor…) et `e` (un marqueur qui coupe le trait de l'aperçu).
// Le jeu ne lit ni l'un ni l'autre. On les retire.
//
// En revanche on GARDE les trous des tableaux : une case vide dans une escadre
// est un point de passage sans vaisseau, et c'est elle qui décale l'arrivée des
// suivants (Game.initLevel compte les `wp` pour calculer wpTimer).
function elaguer(v) {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : elaguer(x)));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) {
      if (k === 'path' || k === 'e') continue;
      o[k] = elaguer(v[k]);
    }
    return o;
  }
  return v;
}

function nettoyer(v) {
  if (Array.isArray(v)) { delete v.__pos; return v.map(nettoyer); }
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = nettoyer(v[k]);
    return o;
  }
  return v;
}

// ── Extraction depuis les sources AS2 ──
// Les fichiers inc/level/*.as sont des littéraux ActionScript : on y récupère
// les métadonnées lisibles (nom, vaisseau, prime) et la chaîne encodée `lvl`.
const RACINE = path.join(__dirname, '..');
const SOURCES = [
  { fichier: 'Games/miniWave2/inc/level/main.as', cle: 'main' },
  { fichier: 'Games/miniWave2/inc/level/bonus.as', cle: 'bonus' },
  { fichier: 'Games/miniWave2/inc/level/letter.as', cle: 'letter' },
];

// Le source est en latin-1 (accents Flash d'époque) ; on le relit en UTF-8
// propre pour que « Clémentine mécanique » ne devienne pas « Cl?mentine ».
function lireSource(rel) {
  return fs.readFileSync(path.join(RACINE, rel), 'latin1');
}

function extraireEntrees(src) {
  const entrees = [];
  // Chaque entrée est un bloc { … } contenant au moins name: et lvl:.
  const re = /\{([^{}]*?)\}/gs;
  let m;
  while ((m = re.exec(src)) !== null) {
    const bloc = m[1];
    const lvl = /\blvl\s*:\s*"([^"]*)"/.exec(bloc);
    if (!lvl) continue;
    const entree = { lvl: lvl[1] };
    const nom = /\bname\s*:\s*"([^"]*)"/.exec(bloc);
    if (nom) entree.name = nom[1];
    for (const champ of ['ship', 'prime']) {
      const v = new RegExp('\\b' + champ + '\\s*:\\s*(-?\\d+)').exec(bloc);
      if (v) entree[champ] = Number(v[1]);
    }
    entrees.push(entree);
  }
  return entrees;
}

function principal() {
  const resume = process.argv.includes('--resume');
  const sortie = {};
  for (const { fichier, cle } of SOURCES) {
    const entrees = extraireEntrees(lireSource(fichier));
    // Deux entrées de bonus.as sont des emplacements réservés jamais remplis
    // (« level bonus no7 », « no8 ») : leur chaîne est vide. On les écarte au
    // lieu de faire échouer l'extraction sur un contenu qui n'a jamais existé.
    const vides = entrees.filter((e) => !e.lvl).map((e) => e.name);
    if (vides.length) console.log(`${cle}\t(ignorés, sans contenu : ${vides.join(', ')})`);
    sortie[cle] = entrees.filter((e) => e.lvl).map((e) => {
      const niveaux = elaguer(decoder(e.lvl));
      const o = { name: e.name, levels: niveaux };
      if (e.ship !== undefined) o.ship = e.ship;
      if (e.prime !== undefined) o.prime = e.prime;
      return o;
    });
    const total = sortie[cle].reduce((n, x) => n + x.levels.length, 0);
    console.log(`${cle}\t${sortie[cle].length} parcours\t${total} niveaux`);
    // Les valeurs non finies viennent des auteurs du jeu (un moveSpeed laissé à
    // NaN dans un parcours d'essai). JSON ne sait les écrire que « null » : on
    // les signale, parce que le moteur devra prévoir un repli.
    for (const p of sortie[cle]) {
      for (const n of p.levels) {
        for (const champ of ['moveSpeed', 'fallSpeed', 'ss', 'sd']) {
          if (n[champ] !== undefined && !Number.isFinite(n[champ])) {
            console.log(`${cle}\t(lacune d'origine : « ${p.name} » / « ${n.name} » ${champ} = ${n[champ]})`);
          }
        }
      }
    }
    if (resume) {
      for (const p of sortie[cle]) {
        console.log(`  « ${p.name} » — ${p.levels.length} niveaux`
          + (p.ship !== undefined ? `, vaisseau ${p.ship}` : '')
          + (p.prime !== undefined ? `, prime ${p.prime}` : ''));
      }
    }
  }
  if (resume) {
    const ex = sortie.main[0].levels[0];
    console.log('\nPremier niveau du parcours « ' + sortie.main[0].name + ' » :');
    console.log(JSON.stringify(ex, null, 2).slice(0, 1200));
    return;
  }
  const dest = path.join(RACINE, 'public/miniwave/levels.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(sortie), 'utf8');
  console.log('→ ' + path.relative(RACINE, dest) + ' (' + fs.statSync(dest).size + ' o)');
}

if (require.main === module) principal();
module.exports = { decoder, Codec, Bits, C64, D64 };
