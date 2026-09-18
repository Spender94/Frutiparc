#!/usr/bin/env node
'use strict';
/*
 * LE MAQUILLAGE D'EGERIE (famille 14), RÉCOLTÉ IMAGE PAR IMAGE
 * ═══════════════════════════════════════════════════════════════
 *
 * « J'aimerais également récupérer le make-up (lèvres + yeux + sourcils) et
 * voir dans quelle mesure on peut le mettre en boutique + le customiser
 * (comme on le fait pour les accessoires). »
 *
 * Le maquillage n'est pas un accessoire d'époque : il est DESSINÉ DANS les
 * clips de la bouche et des yeux d'Egerie, image par image. Les lèvres sont
 * une seule forme, posée de quarante-sept façons au fil des cent-vingt-neuf
 * images de la bouche ; le fard change cinq fois au fil des quarante-six
 * images de l'œil, le sourcil quatre. C'est ainsi que le maquillage SUIT la
 * bouche qui parle et l'œil qui se ferme.
 *
 * Une pose fixe ne pouvait donc pas suivre. On récolte ici, pour CHAQUE image
 * des deux clips, les couches de maquillage et leur matrice :
 *
 *   · la BOUCHE (b/b, 129 images) : ce qui, aux profondeurs 3, 6 et 8, est
 *     peint dans le lavande d'Egerie — les lèvres, leur reflet, un point.
 *     À ces mêmes profondeurs vivent aussi, sur les images de la langue, la
 *     bouche ouverte rouge : elle est à Egerie, pas au maquillage, et la
 *     couleur la distingue ;
 *   · l'ŒIL (oa/o, 46 images) : le fard (couche 0) et les cils (couche 3) de
 *     la forme de la profondeur 2 — dont on laisse le blanc et le point rouge,
 *     qui sont l'œil lui-même —, et le sourcil (profondeur 9). L'œil droit
 *     d'Egerie porte un sourcil qui inclut la boucle de son front : on prend
 *     celui de l'œil gauche pour les deux, comme la famille 0 partage un seul
 *     clip d'œil pour les deux côtés.
 *
 * Et l'on relève le fait qui rend la greffe possible : la bouche d'Egerie est
 * la BOUCHE 2 de la famille 0 (même clip de 129 images, mêmes étiquettes), et
 * son œil a la ligne de temps des yeux 1 et 2 (46 images, mêmes étiquettes).
 * Sur les autres bouches et les autres yeux, la greffe se cale par ÉTIQUETTE
 * (parle, rire, ferme, regardG…) : elle suit les poses, avec les formes
 * d'Egerie.
 *
 * LES TEINTES. Le lavande est celui d'Egerie ; on décline le maquillage en
 * quelques teintes de la palette du parc, chacune un article de boutique —
 * comme un accessoire se vend par couleur. Une teinte ajoutée ICI paraît en
 * boutique au redémarrage suivant, à un index qui ne bouge plus jamais (les
 * index se suivent : teinte t, type k → base × (1 + t) + k).
 *
 *   node scripts/extract-maquillage-egerie.js
 *   → public/fbouille/maquillage-egerie.json
 *     { teintes, base:{bouches,yeux}, formes, bouche:{n,labels,images}, oeil:{…} }
 *
 * Le moteur (`grefferMaquillage`, bouille-moteur.js) en fait des IMAGES DE
 * ROULEAU : « bouche k + maquillage teinte t », « œil k + maquillage teinte t »,
 * au bout des rouleaux de la famille 0 — comme les prunelles au bout du
 * rouleau d'iris. Une bouille les désigne par sa chaîne d'état, et la boutique
 * les vend comme des incarnations.
 */

const fs = require('node:fs');
const path = require('node:path');
const Swf = require('../public/js/bouille-swf.js');
require('../public/js/bouille-avm.js');
const M = require('../public/js/bouille-moteur.js');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'public/fbouille');
const SORTIE = path.join(DOSSIER, 'maquillage-egerie.json');
const ETAT = '0e0000010000000000000000';         // Egerie, au repos
const DECALAGE = 500000;                         // hors des autres paquets (émotes 1-3e5, prunelles 3e5)
const LAVANDE = [153, 153, 255];                 // la couleur du maquillage d'Egerie

/*
 * LES TEINTES — des couleurs de la palette du parc (bouille-palette.js), pour
 * que le maquillage aille avec les cheveux et les accessoires qu'elle teinte.
 * La première est celle d'Egerie. L'ORDRE EST UN CONTRAT : on n'insère pas,
 * on ajoute à la fin.
 */
const TEINTES = [
  { cle: 'egerie',   nom: 'lavande',          levres: LAVANDE,          fard: LAVANDE },
  { cle: 'cerise',   nom: 'cerise et azur',   levres: [0xD2, 0x37, 0x37], fard: [0x6E, 0xA0, 0xE1] },
  { cle: 'rose',     nom: 'rose et or',       levres: [0xFD, 0x8C, 0xB7], fard: [0xFA, 0xE1, 0x3C] },
  { cle: 'mauve',    nom: 'mauve',            levres: [0x96, 0x64, 0xC8], fard: [0x96, 0x64, 0xC8] },
  { cle: 'turquoise', nom: 'grenat et turquoise', levres: [0xBE, 0x1E, 0x1E], fard: [0x37, 0xBE, 0xB4] },
  { cle: 'nature',   nom: 'abricot et tilleul', levres: [0xE6, 0x9B, 0x50], fard: [0xB4, 0xE6, 0x7D] },
];

const ID = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
// La MÊME composition que `composerM` du moteur : E d'abord, puis P.
const mul = (P, E) => ({
  a: P.a * E.a + P.c * E.b, b: P.b * E.a + P.d * E.b,
  c: P.a * E.c + P.c * E.d, d: P.b * E.c + P.d * E.d,
  e: P.a * E.e + P.c * E.f + P.e, f: P.b * E.e + P.d * E.f + P.f,
});
const R = (v) => Math.round(v * 1000) / 1000;
const arrondir = (m) => ({ a: R(m.a), b: R(m.b), c: R(m.c), d: R(m.d), e: R(m.e), f: R(m.f) });
const lavande = (c) => Array.isArray(c.rgb) && c.rgb[0] === LAVANDE[0] && c.rgb[1] === LAVANDE[1] && c.rgb[2] === LAVANDE[2];

function lire(fichier) {
  const b = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}

(async () => {
  const d14 = await lire('famille14.swf');
  const mo = new M.Moteur(d14, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(ETAT);
  const face = mo.racine.face;
  const bb = face.enfantNomme('b').enfantNomme('b');
  const o = face.enfantNomme('oa').enfantNomme('o');
  if (!bb || !o) throw new Error('la bouche (b/b) ou l’œil (oa/o) d’Egerie est introuvable');

  const formes = {};                 // id décalé → forme, avec le RÔLE de chaque couche
  // Une forme du paquet : les couches demandées, chacune avec son rôle
  // (« levres » / « fard » se teintent, « fixe » reste tel quel).
  const forme = (ch, choisir) => {
    const t = mo.formeDe(ch, null);
    if (!t) throw new Error('forme #' + ch + ' introuvable');
    const couches = [];
    t.f.couches.forEach((c, i) => {
      const role = choisir(i, c);
      if (!role) return;
      couches.push({ d: c.d, rgb: c.rgb ? c.rgb.slice() : null, alpha: c.alpha == null ? 1 : c.alpha,
        degrade: c.degrade || null, trait: !!c.trait, role });
    });
    if (!couches.length) return null;
    const id = DECALAGE + ch;
    if (!formes[id]) formes[id] = { id, bounds: t.f.bounds, couches };
    return id;
  };

  /* LA BOUCHE : aux profondeurs 3, 6 et 8, ce qui est lavande. Chaque entrée
     est une forme directe ou un clip d'une image qui la porte. */
  const bouche = { n: bb.def.n, labels: Object.assign({}, bb.def.labels), images: [] };
  for (let i = 1; i <= bb.def.n; i++) {
    bb.allerImage(i, false);
    const ops = [];
    for (const prof of [3, 6, 8]) {
      const e = bb.enfants.get(prof);
      if (!e) continue;
      let ch = e.ch, Mx = e.M || ID;
      if (e.objet) {
        const sous = [...e.objet.enfants.values()];
        if (sous.length !== 1 || sous[0].objet) continue;      // pas une forme simple : pas du maquillage
        ch = sous[0].ch; Mx = mul(Mx, sous[0].M || ID);
      }
      const t = mo.formeDe(ch, null);
      if (!t || !t.f.couches.every(lavande)) continue;          // la bouche ouverte rouge : à Egerie
      const id = forme(ch, () => 'levres');
      if (id) ops.push({ ch: id, prof, M: arrondir(Mx) });
    }
    bouche.images.push(ops);
  }

  /* L'ŒIL : la mise en page change d'une pose à l'autre — l'œil ouvert porte
     fard, blanc, point rouge et cils dans UNE forme de profondeur 2 et son
     sourcil en 9 ; l'œil mécontent les range en 3 et 11 ; l'œil fermé met son
     fard en 1, son trait noir en 2, son sourcil en 3. On ne suit donc pas les
     profondeurs mais les COULEURS : le lavande est du fard, le noir à 80 % des
     cils, une forme entièrement en noir à 50 % un sourcil. Le blanc de l'œil,
     le point rouge et le trait de l'œil fermé sont l'œil lui-même — celui du
     porteur reste dessous. */
  const noir = (c, a) => Array.isArray(c.rgb) && c.rgb[0] === 0 && c.rgb[1] === 0 && c.rgb[2] === 0
    && Math.abs((c.alpha == null ? 1 : c.alpha) - a) < 0.05;
  const oeil = { n: o.def.n, labels: Object.assign({}, o.def.labels), images: [] };
  for (let i = 1; i <= o.def.n; i++) {
    o.allerImage(i, false);
    const ops = [];
    o.enfants.forEach((e, prof) => {
      if (e.objet) return;                                       // l'iris et son reflet : pas du maquillage
      const t = mo.formeDe(e.ch, null);
      if (!t) return;
      const sourcil = t.f.couches.every((c) => noir(c, 0.5));
      const id = forme(e.ch, (k, c) => (sourcil ? 'fixe' : lavande(c) ? 'fard' : noir(c, 0.8) ? 'fixe' : null));
      if (id) ops.push({ ch: id, prof, M: arrondir(e.M || ID) });
    });
    ops.sort((x, y) => x.prof - y.prof);
    oeil.images.push(ops);
  }

  // Les longueurs des rouleaux de la famille d'accueil : la base des index.
  const d0 = await lire('famille0.swf');
  const m0 = new M.Moteur(d0, { alea: () => 0.5 });
  m0.creerVisage();
  m0.definir('000000010000000000000000');
  const base = { bouches: m0.racine.face.enfantNomme('b').def.n, yeux: m0.racine.face.enfantNomme('oa').def.n };
  const bb0 = m0.racine.face.enfantNomme('b'); bb0.allerImage(3, false);
  const bouche2 = bb0.enfantNomme('b');
  const memeBouche = bouche2 && bouche2.def.n === bouche.n
    && JSON.stringify(bouche2.def.labels) === JSON.stringify(bouche.labels);

  const paquet = {
    source: {
      maquillage: 'famille14.swf — bouche b/b (profondeurs 3, 6, 8, en lavande), œil oa/o (profondeur 2 couches 0 et 3, profondeur 9)',
      hote: 'famille0.swf — ' + base.bouches + ' bouches, ' + base.yeux + ' yeux ; la bouche d’Egerie est la bouche 2'
        + (memeBouche ? ' (même clip, mêmes étiquettes)' : ' (ATTENTION : clip différent)'),
      outil: 'scripts/extract-maquillage-egerie.js',
      decalage: DECALAGE,
    },
    nom: 'Maquillage d’Egerie',
    teintes: TEINTES,
    base,
    formes,
    bouche,
    oeil,
  };
  fs.writeFileSync(SORTIE, JSON.stringify(paquet) + '\n');
  const nb = (im) => im.reduce((s, ops) => s + ops.length, 0);
  console.log('maquillage-egerie.json écrit — ' + Object.keys(formes).length + ' formes ; bouche : '
    + bouche.n + ' images, ' + nb(bouche.images) + ' poses ; œil : ' + oeil.n + ' images, ' + nb(oeil.images)
    + ' poses ; ' + TEINTES.length + ' teintes ; base ' + JSON.stringify(base) + (memeBouche ? '' : ' ; BOUCHE 2 DIFFÉRENTE'));
})().catch((e) => { console.error(e); process.exit(1); });
