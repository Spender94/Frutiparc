#!/usr/bin/env node
'use strict';
/*
 * LES PRUNELLES D'HIKO
 * ════════════════════
 *
 * L'iris d'une frutibouille, c'est le clip `p` de `oa.o` (et `ob.o`) : un
 * simple ROULEAU que `Moteur.definir` cale par `gotoAndStop(eyeSc + 1)`. La
 * famille 0 en a dix-huit images — dix-huit paires d'yeux.
 *
 * Hiko (famille 12) en a dix-neuf, et ses deux PREMIÈRES ne ressemblent à
 * rien de ce que le parc connaît :
 *
 *   · l'image 1 est un iris ROUGE ET NOIR, fixe ;
 *   · l'image 2 porte un CLIP de vingt images — un iris qui TOURNE.
 *
 * Ce script les récolte pour qu'on puisse les greffer au bout du rouleau de
 * n'importe quelle famille. Il n'emporte que ce qu'il faut : les ordres de
 * pose de ces deux images, et la fermeture des caractères qu'ils désignent
 * (cinq formes et un clip).
 *
 * DEUX PRÉCAUTIONS.
 *
 *   LES NUMÉROS SONT RÉÉCRITS. #418 est un morceau d'iris chez hiko et tout
 *   autre chose dans la famille 0. On décale la récolte au-delà de la plage
 *   d'un SWF (300 000), et plus rien ne peut se marcher dessus.
 *
 *   L'INDEX EST FIGÉ ICI, pas calculé à la volée. Une bouille qui porte une
 *   prunelle la désigne par un NUMÉRO dans le rouleau (`eyeSc`), inscrit dans
 *   sa chaîne d'état et vendu comme tel en boutique : il doit vouloir dire la
 *   même chose sur tous les écrans, pour toujours. On relève donc la longueur
 *   du rouleau de la famille 0 au moment de la récolte, et l'on écrit les
 *   index obtenus dans le paquet. La greffe les respecte — elle comble au
 *   besoin —, quelle que soit la famille d'accueil.
 *
 * CE QU'ON N'EMPORTE PAS : les ordres de RETRAIT. Une image de rouleau ne
 * pose pas tout, elle MODIFIE ce que la précédente a laissé ; ce qu'il faut
 * retirer dépend donc de la famille d'accueil, qui seule sait ce que sa
 * dernière image laisse en place. C'est la greffe qui le calcule.
 *
 *   node scripts/extract-prunelles-bouille.js
 *   → public/fbouille/prunelles.json
 */

const fs = require('node:fs');
const path = require('node:path');
const Swf = require('../public/js/bouille-swf.js');
const Moteur = require('../public/js/bouille-moteur.js');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'public/fbouille');
const SORTIE = path.join(DOSSIER, 'prunelles.json');

// Le décalage des identifiants récoltés : au-delà de ce qu'un SWF peut porter,
// et distinct de celui des émotes (100 000) pour qu'on lise d'où vient un
// numéro rien qu'à sa taille.
const DECALAGE = 300000;

// Les deux images d'hiko qu'on emporte, dans l'ordre où elles paraîtront.
const RECOLTE = [
  { image: 1, cle: 'hiko1', nom: "Hiko's eyes",
    description: 'Les prunelles rouge et noir de hiko.' },
  { image: 2, cle: 'hiko2', nom: "Hiko's eyes #2",
    description: 'Les prunelles animées de hiko — elles tournent.' },
];

/*
 * ── LES DÉCLINAISONS ──────────────────────────────────────────────────────
 *
 * LE MOTEUR NE TEINTE PAS L'IRIS. `definir()` pose une teinte sur la peau, la
 * bouche, les cheveux et les accessoires ; pour l'œil il se contente d'un
 * `gotoAndStop(eyeSc + 1)`. La couleur d'un iris est donc DANS LE DESSIN — et
 * les dix-huit iris de la famille 0 sont dix-huit dessins, dont sept (2 à 8)
 * sont manifestement le même œil repeint : quatre couches, toujours dans le
 * même rapport de clarté.
 *
 *     2 brun   #996600 · #795200 · #241600 · #644100 (trait)
 *     3 bleu   #3399cc · #2b82ac · #113948 · #206688
 *     5 vert   #2cc523 · #23a31d · #164d0d · #1a7812
 *
 * On décline donc les prunelles d'hiko de la même façon : on repeint, on ne
 * teinte pas. SIX couleurs et non sept — le rouge de la famille 0 (#cf1612)
 * est à un cheveu de celui d'hiko, ce serait un doublon.
 *
 * CE QUI SE REPEINT, ET CE QUI NE SE REPEINT PAS :
 *
 *   · « Hiko's eyes » : quatre couches, dont UNE SEULE est colorée — le rouge
 *     #e20303. Les trois autres sont le noir et les deux blancs du reflet.
 *   · « Hiko's eyes #2 » : la couleur vit dans un DÉGRADÉ RADIAL à deux
 *     arrêts (#e21d1d clair, #710202 sombre). Le disque noir qui tourne de
 *     19° par image et les blancs ne bougent pas — c'est le mouvement, pas la
 *     teinte.
 *
 * LA RÈGLE. On garde le MODELÉ : chaque couche colorée est repeinte à la
 * couleur cible, réduite du même rapport de clarté qu'elle avait vis-à-vis du
 * rouge d'origine. Le sombre reste sombre, le reflet reste blanc.
 */
const TEINTES = [
  { cle: 'brun',   nom: 'brun',      rgb: [0x99, 0x66, 0x00] },   // iris 2 de la famille 0
  { cle: 'bleu',   nom: 'bleu ciel', rgb: [0x33, 0x99, 0xcc] },   // iris 3
  { cle: 'cyan',   nom: 'cyan',      rgb: [0x00, 0xcc, 0xff] },   // iris 4
  { cle: 'vert',   nom: 'vert',      rgb: [0x2c, 0xc5, 0x23] },   // iris 5
  { cle: 'violet', nom: 'violet',    rgb: [0xa5, 0x60, 0xca] },   // iris 7
  { cle: 'orange', nom: 'orange',    rgb: [0xdf, 0x59, 0x00] },   // iris 8
];

// Les rouges d'origine : celui de la couche plate, celui de l'arrêt clair du
// dégradé. Ce sont les références du rapport de clarté.
const ROUGE_PLAT = [226, 3, 3];
const ROUGE_DEGRADE = [226, 29, 29];

// La clarté perçue, et la repeinte qui garde le modelé.
const clarte = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const repeindre = (rgb, source, cible) => {
  const k = clarte(source) ? clarte(rgb) / clarte(source) : 1;
  return cible.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
};
// Ce qui se repeint : ce qui a une teinte. Le noir, le blanc et les gris —
// l'encre du trait et les reflets — gardent la leur.
const colore = (rgb) => Math.max(...rgb) - Math.min(...rgb) > 24;

// Une copie de forme dont les couches colorées passent à la couleur cible.
function formeRepeinte(forme, source, cible) {
  const f = JSON.parse(JSON.stringify(forme));
  const hexa = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  (f.couches || []).forEach((c) => {
    if (c.rgb && colore(c.rgb)) c.rgb = repeindre(c.rgb, source, cible);
    if (c.degrade && Array.isArray(c.degrade.arrets)) {
      c.degrade.arrets.forEach((a) => {
        if (a.rgb && colore(a.rgb)) {
          a.rgb = repeindre(a.rgb, source, cible);
          a.couleur = hexa(a.rgb);
        }
      });
    }
  });
  return f;
}

function lire(fichier) {
  const b = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}

// Ce qu'un rouleau laisse posé à l'image n : profondeur → ordre de pose.
function etatA(sp, n) {
  const par = new Map();
  for (let i = 1; i <= n && i <= sp.images.length; i++) {
    (sp.images[i - 1] || []).forEach((o) => {
      if (o.t === 'retire') par.delete(o.prof);
      else if (o.t === 'pose') par.set(o.prof, o);
    });
  }
  return par;
}

// Tout ce qu'un caractère entraîne : lui, ses sous-clips, leurs formes.
function fermeture(defs, ch, vus) {
  vus = vus || new Set();
  if (vus.has(ch)) return vus;
  vus.add(ch);
  const sp = defs.sprites.get(ch);
  if (!sp) return vus;
  (sp.images || []).forEach((im) => (im || []).forEach((o) => {
    if (o.ch !== undefined && o.ch !== null && o.ch >= 0) fermeture(defs, o.ch, vus);
  }));
  return vus;
}

// La récolte : les formes et les clips d'une fermeture, renumérotés.
function recolter(defs, racines) {
  const tout = new Set();
  racines.forEach((ch) => fermeture(defs, ch, tout));
  const formes = {}, sprites = {};
  for (const ch of tout) {
    const neuf = DECALAGE + ch;
    if (defs.formes.has(ch)) { formes[neuf] = defs.formes.get(ch); continue; }
    const sp = defs.sprites.get(ch);
    if (!sp) continue;
    sprites[neuf] = {
      n: sp.n,
      labels: sp.labels || {},
      // Les scripts d'image ne se recopient pas : un `stop()` d'hiko figerait
      // l'iris animé, dont tout l'intérêt est de tourner.
      images: (sp.images || []).map((im) => (im || [])
        .filter((o) => o.t !== 'script')
        .map((o) => (o.ch !== undefined && o.ch !== null && o.ch >= 0
          ? Object.assign({}, o, { ch: DECALAGE + o.ch }) : o))),
    };
  }
  return { formes, sprites };
}

(async () => {
  const d0 = await lire('famille0.swf');
  const d12 = await lire('famille12.swf');

  const rouleaux0 = Moteur.rouleauxIris(d0);
  const rouleaux12 = Moteur.rouleauxIris(d12);
  if (!rouleaux0.length) throw new Error('famille 0 : rouleau d’iris introuvable');
  if (!rouleaux12.length) throw new Error('famille 12 : rouleau d’iris introuvable');
  const p0 = rouleaux0[0], p12 = rouleaux12[0];
  console.log('rouleau d’iris — famille 0 : ' + p0.n + ' images, hiko : ' + p12.n);

  const racines = new Set();
  const base = [];
  RECOLTE.forEach((r, k) => {
    const venu = etatA(p12, r.image);
    if (!venu.size) throw new Error('hiko : rien de posé à l’image ' + r.image);
    for (const [, o] of venu) if (o.ch >= 0) racines.add(o.ch);
    base.push({
      cle: r.cle, nom: r.nom, description: r.description,
      // L'index DÉFINITIF dans le rouleau : la longueur d'origine du rouleau
      // de la famille 0, plus le rang de récolte.
      index: p0.n + k,
      ordres: [...venu.values()].map((o) => Object.assign({}, o, {
        ch: o.ch >= 0 ? o.ch + DECALAGE : o.ch,
      })),
    });
  });

  const recolte = recolter(d12, racines);

  /*
   * ── LE DISQUE COLORÉ SORT DU MOUVEMENT ────────────────────────────────────
   *
   * L'iris animé d'hiko est un clip de vingt images : le DISQUE coloré, posé
   * une fois à la profondeur 4, et par-dessus une roue noire qui tourne de 19°
   * par image. Le disque ne bouge jamais — c'est la couleur ; la roue, c'est le
   * mouvement.
   *
   * Recopier le clip entier pour chaque teinte coûterait quatre kilo-octets
   * pièce, sur un fichier que TOUTE PAGE affichant une bouille va chercher.
   * On sort donc le disque du clip une bonne fois : le clip ne porte plus que
   * le mouvement, et chaque teinte pose SON disque dessous, à même le rouleau.
   * Sept disques d'un kilo et demi valent mieux que sept clips de quatre.
   *
   * Le rendu ne change pas : le disque était à l'identité dans un clip lui-même
   * posé à l'identité — le sortir d'un cran ne le déplace pas.
   */
  const CLIP_ANIME = base[1].ordres.find((o) => recolte.sprites[o.ch]);
  if (!CLIP_ANIME) throw new Error('hiko2 : le clip animé est introuvable');
  const clip = recolte.sprites[CLIP_ANIME.ch];
  const disquePose = (clip.images[0] || []).find((o) => o.t === 'pose' && recolte.formes[o.ch]
    && (recolte.formes[o.ch].couches || []).some((c) => c.degrade));
  if (!disquePose) throw new Error('hiko2 : le disque coloré est introuvable dans le clip');
  // Le clip perd son disque ; il ne lui reste que la roue et son ombre.
  clip.images[0] = (clip.images[0] || []).filter((o) => o !== disquePose);

  /*
   * ── LES QUATORZE PAIRES ───────────────────────────────────────────────────
   *
   * Les deux originales gardent leurs index (18 et 19) : elles sont vendues, et
   * une chaîne d'état qui les porte doit continuer de vouloir dire la même
   * chose. Les douze déclinaisons prennent la suite, modèle par modèle.
   */
  const iris = [];
  const formes = Object.assign({}, recolte.formes);
  let libre = DECALAGE + 1000;              // les repeintes, à part des récoltées

  // Les deux modèles, tels qu'hiko les pose. On les FIGE ici : tout ce qui
  // suit part de ces ordres-là, jamais de ceux qu'on vient d'écrire.
  const POSE_PLATE = base[0].ordres[0];                 // « Hiko's eyes » : une pose
  const RESTE_ANIME = base[1].ordres.filter((o) => o !== CLIP_ANIME);   // le reflet blanc

  // Une paire fixe, d'une teinte ou d'une autre : un seul dessin.
  const ordresFixes = (ch) => [Object.assign({}, POSE_PLATE, { ch })];
  // Une paire animée : le disque dessous, le mouvement par-dessus, le reflet
  // au-dessus de tout — l'ordre qu'ils avaient dans le clip.
  const ordresAnimes = (ch) => [
    Object.assign({}, disquePose, { ch, prof: 1 }),
    Object.assign({}, CLIP_ANIME, { prof: 2 }),
  ].concat(RESTE_ANIME);

  const MODELES = [
    { modele: base[0], source: ROUGE_PLAT, forme: POSE_PLATE.ch, ordres: ordresFixes },
    { modele: base[1], source: ROUGE_DEGRADE, forme: disquePose.ch, ordres: ordresAnimes },
  ];

  // Les deux originales d'abord, à leurs index d'origine — elles sont vendues.
  iris.push(Object.assign({}, base[0], { teinte: '', ordres: ordresFixes(POSE_PLATE.ch) }));
  iris.push(Object.assign({}, base[1], { teinte: '', ordres: ordresAnimes(disquePose.ch) }));

  let index = p0.n + RECOLTE.length;        // 20 : après les deux originales
  for (const m of MODELES) {
    for (const t of TEINTES) {
      const ch = libre++;
      formes[ch] = formeRepeinte(recolte.formes[m.forme], m.source, t.rgb);
      iris.push({
        cle: m.modele.cle + '-' + t.cle,
        nom: m.modele.nom + ' — ' + t.nom,
        description: m.modele.description
          .replace('rouge et noir', t.nom)
          .replace('animées de hiko', 'animées de hiko, en ' + t.nom),
        teinte: t.nom,
        index: index++,
        ordres: m.ordres(ch),
      });
    }
  }

  const paquet = {
    source: {
      iris: 'famille12.swf, oa.o.p, images ' + RECOLTE.map((r) => r.image).join(' et '),
      hote: 'famille0.swf, oa.o.p, ' + p0.n + ' images d’origine',
      teintes: TEINTES.map((t) => t.nom).join(', ') + ' — les couleurs de pupille de la famille 0',
      outil: 'scripts/extract-prunelles-bouille.js',
      decalage: DECALAGE,
    },
    formes,
    sprites: recolte.sprites,
    iris,
  };

  fs.writeFileSync(SORTIE, JSON.stringify(paquet));
  const ko = Math.round(fs.statSync(SORTIE).size / 102.4) / 10;
  console.log('récolté : ' + Object.keys(formes).length + ' forme(s), '
    + Object.keys(recolte.sprites).length + ' clip(s)');
  iris.forEach((i) => console.log('   eyeSc ' + String(i.index).padStart(2)
    + '  ' + i.cle.padEnd(14) + '« ' + i.nom + ' »'));
  console.log('écrit : ' + path.relative(ROOT, SORTIE) + ' (' + ko + ' Ko)');
})().catch((e) => { console.error(e); process.exit(1); });
