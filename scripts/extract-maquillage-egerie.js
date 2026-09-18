#!/usr/bin/env node
'use strict';
/*
 * LE MAQUILLAGE D'EGERIE (famille 14), RÉCOLTÉ EN VARIANTE D'ACCESSOIRE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * « J'aimerais également récupérer le make-up (lèvres + yeux + sourcils) et
 * voir dans quelle mesure on peut le mettre en boutique + le customiser
 * (comme on le fait pour les accessoires). »
 *
 * Le maquillage n'est pas un accessoire d'époque : il est DESSINÉ DANS les
 * yeux et la bouche d'Egerie, avec le blanc de l'œil, l'iris, le trait de la
 * bouche. On ne prend que ce qui est maquillage :
 *
 *   · le FARD à paupières — la couche lavande de l'œil (p2, couche 0), à
 *     moitié transparente ;
 *   · les CILS — le trait noir qui borde l'œil (p2, couche 3) ;
 *   · les SOURCILS — le trait de l'œil gauche (p9 de `oa`), posé avec la
 *     matrice de CHAQUE œil : celui de l'œil droit porte aussi la boucle du
 *     front, qui est à Egerie, pas au maquillage ;
 *   · les LÈVRES — l'aplat lavande (p8) et son reflet (p6) de la bouche.
 *
 * ET ON L'EMPORTE AU FORMAT D'UNE VARIANTE D'ACCESSOIRE (bouille-variante.js),
 * parce que c'est LE circuit de la boutique : une variante s'injecte dans le
 * rouleau d'un accessoire d'époque, s'encode dans la chaîne de la bouille, se
 * vend en article de boutique (le suffix9 : type · variante · trois couleurs)
 * et se recolore par les niveaux de couleur — exactement comme une casquette
 * maison. Le type porteur est celui des LUNETTES (10) : c'est l'accessoire qui
 * se dessine sur le visage, et il n'a pas de couche arrière à remplir.
 *
 * Les tracés sont des aplats dans le repère de la scène, avec deux NIVEAUX DE
 * COULEUR : niveau 1 les lèvres, niveau 2 le fard. Les zones recolorables sont
 * donc en niveaux de gris (le blanc rend la couleur pleine, le gris l'assombrit
 * — la règle d'époque de FEMC.setColor), les cils et les sourcils gardent leur
 * noir : la palette n'a pas de noir, un niveau de couleur ne saurait le rendre.
 *
 * Ses limites sont celles d'un accessoire : il OCCUPE LE CRÉNEAU ACCESSOIRE
 * (pas de chapeau par-dessus), il ne suit ni les clignements ni les bouches
 * qui parlent, et il est dessiné pour les yeux et la bouche de la famille 0,
 * aux places de son gabarit (les mêmes qu'Egerie).
 *
 *   node scripts/extract-maquillage-egerie.js
 *   → public/fbouille/maquillage-egerie.json  { nom, type, couleurs, paths }
 *
 * Le paquet se charge d'un bouton dans l'admin (« Variantes d'accessoire »)
 * et se retélécharge en gabarit SVG depuis l'atelier (encart 6).
 */

const fs = require('node:fs');
const path = require('node:path');
const Swf = require('../public/js/bouille-swf.js');
const M = require('../public/js/bouille-moteur.js');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'public/fbouille');
const SORTIE = path.join(DOSSIER, 'maquillage-egerie.json');
const ETAT = '0e0000010000000000000000';         // Egerie, au repos

const ID = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
// La MÊME composition que `composerM` du moteur : E d'abord, puis P.
const mul = (P, E) => ({
  a: P.a * E.a + P.c * E.b, b: P.b * E.a + P.d * E.b,
  c: P.a * E.c + P.c * E.d, d: P.b * E.c + P.d * E.d,
  e: P.a * E.e + P.c * E.f + P.e, f: P.b * E.e + P.d * E.f + P.f,
});
const R = (v) => Math.round(v * 100) / 100;
// Un tracé, envoyé dans le repère de la scène (comme exporterAccessoire).
const transformer = (d, m) => d.replace(/([MLQ])([^MLQZ]*)/g, (_, cmd, args) => {
  const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const out = [];
  for (let i = 0; i < n.length; i += 2) out.push(R(m.a * n[i] + m.c * n[i + 1] + m.e), R(m.b * n[i] + m.d * n[i + 1] + m.f));
  return cmd + out.join(' ');
});
const gris = (v) => 'rgb(' + v + ',' + v + ',' + v + ')';

function lire(fichier) {
  const b = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}

function recolter(defs) {
  const mo = new M.Moteur(defs, { alea: () => 0.5 });
  mo.creerVisage();
  mo.definir(ETAT);
  const face = mo.racine.face;
  const enfant = (clip, nom) => { for (const e of clip.enfants.values()) if (e.nom === nom) return e; return null; };
  const parProf = (clip, prof) => clip.enfants.get(prof);
  const Mface = face.matrice();
  const out = [];
  const emettre = (ch, Mabs, couches, habiller) => {
    const t = mo.formeDe(ch, null);
    if (!t) throw new Error('forme #' + ch + ' introuvable');
    t.f.couches.forEach((c, i) => {
      if (!couches.includes(i)) return;
      out.push(Object.assign({ d: transformer(c.d, Mabs) }, habiller(i, c)));
    });
  };
  // Les yeux : oa (le gauche, en miroir) et ob (le droit).
  const gauche = enfant(face, 'oa');
  const og = gauche && enfant(gauche.objet, 'o');
  const sourcil = og && parProf(og.objet, 9);
  if (!sourcil) throw new Error('le sourcil de l’œil gauche (oa/o, profondeur 9) est introuvable');
  for (const nom of ['oa', 'ob']) {
    const eo = enfant(face, nom);
    const o = eo && eo.objet && enfant(eo.objet, 'o');
    if (!o || !o.objet) throw new Error('l’œil ' + nom + ' est introuvable');
    const Moo = mul(mul(Mface, eo.objet.matrice()), o.objet.matrice());
    const p2 = parProf(o.objet, 2);
    if (!p2) throw new Error(nom + ' : pas de profondeur 2 (fard et cils)');
    emettre(p2.ch, mul(Moo, p2.M || ID), [0, 3], (i, c) => (i === 0
      ? { fill: gris(255), alpha: 0.5, slot: 2 }                       // le fard : niveau 2
      : { fill: 'rgb(0,0,0)', alpha: c.alpha == null ? 0.8 : c.alpha })); // les cils
    const p9 = parProf(o.objet, 9);
    if (!p9) throw new Error(nom + ' : pas de profondeur 9 (sourcil)');
    emettre(sourcil.ch, mul(Moo, p9.M || ID), [0], (i, c) => ({ fill: 'rgb(0,0,0)', alpha: c.alpha == null ? 0.5 : c.alpha }));
  }
  // La bouche : b/b, les lèvres (p8) en gris clair, le reflet (p6) en blanc — niveau 1.
  const eb = enfant(face, 'b');
  const bb = eb && eb.objet && enfant(eb.objet, 'b');
  if (!bb || !bb.objet) throw new Error('la bouche (b/b) est introuvable');
  const Mb = mul(mul(Mface, eb.objet.matrice()), bb.objet.matrice());
  for (const [prof, valeur] of [[8, 225], [6, 255]]) {
    const e = parProf(bb.objet, prof);
    if (!e) throw new Error('bouche : pas de profondeur ' + prof);
    const sous = e.objet ? parProf(e.objet, 1) : null;           // un clip d'une image qui porte la forme
    const ch = sous ? sous.ch : e.ch;
    emettre(ch, mul(mul(Mb, e.M || ID), sous && sous.M ? sous.M : ID), [0], () => ({ fill: gris(valeur), alpha: 0.5, slot: 1 }));
  }
  return out;
}

(async () => {
  const d14 = await lire('famille14.swf');
  const paths = recolter(d14);
  const paquet = {
    source: 'famille14.swf — yeux (oa/o : p2 couches 0 et 3, p9 de oa), bouche (b/b : p8, p6) ; scripts/extract-maquillage-egerie.js',
    nom: 'Maquillage d’Egerie',
    // Le type d'accessoire porteur : les lunettes, dessinées sur le visage.
    type: 10,
    // Les couleurs d'Egerie : lèvres et fard lavande ; le troisième niveau ne sert pas.
    couleurs: ['#9999ff', '#9999ff', '#000000'],
    paths,
  };
  fs.writeFileSync(SORTIE, JSON.stringify(paquet) + '\n');
  console.log('maquillage-egerie.json écrit — ' + paths.length + ' aplats ('
    + paths.filter((p) => p.slot === 1).length + ' lèvres, ' + paths.filter((p) => p.slot === 2).length + ' fard, '
    + paths.filter((p) => !p.slot).length + ' cils et sourcils)');
})().catch((e) => { console.error(e); process.exit(1); });
