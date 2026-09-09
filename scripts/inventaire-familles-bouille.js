#!/usr/bin/env node
/*
 * TOUT CE QUE LES FAMILLES DE PNJ PORTENT, ET QUE LA FAMILLE 0 POURRAIT PRENDRE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * On ouvre les onze SWF de bouille et l'on relève, pour chacun :
 *
 *   · le VISAGE et ses étiquettes — quelles émotes il sait jouer, où elles
 *     commencent, combien d'images elles durent, et quels dessins leur sont
 *     PROPRES (ceux qui n'existent pas au repos : c'est ce qu'il faudrait
 *     récolter pour les porter ailleurs) ;
 *   · les ROULEAUX de la bouille — coiffures, accessoires, accessoires
 *     secondaires, yeux, iris, bouches — avec leur longueur ;
 *   · le poids du fichier, pour dire ce que coûterait la récolte.
 *
 *   node scripts/inventaire-familles-bouille.js          (le tableau, en texte)
 *   node scripts/inventaire-familles-bouille.js --json   (les données brutes)
 *
 * Le relevé qu'il produit est recopié dans public/frutiz/BOUILLES.md, § 11 quater.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Swf = require('../public/js/bouille-swf.js');
const M = require('../public/js/bouille-moteur.js');

const DOSSIER = path.join(__dirname, '..', 'public/fbouille');
const JSON_SEUL = process.argv.indexOf('--json') >= 0;

function lire(f) {
  const b = fs.readFileSync(path.join(DOSSIER, f));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}
const ACTIONS = ['parle', 'rire', 'mdr', 'langue', 'rougir', 'regard', 'sifflote',
  'gum', 'question', 'miam', 'pleurer', 'larme'];
function visageDe(defs) {
  let best = null, score = -1;
  for (const [id, sp] of defs.sprites) {
    const n = ACTIONS.filter((a) => sp.labels && a in sp.labels).length;
    if (n > score) { score = n; best = { id, sp }; }
  }
  return score > 0 ? best : null;
}
// Les caractères posés entre deux images.
function poses(sp, deb, fin) {
  const out = new Map();
  for (let i = deb; i < fin; i++) {
    (sp.images[i - 1] || []).forEach((o) => {
      if (o.t === 'pose' && o.ch >= 0 && !out.has(o.ch)) out.set(o.ch, o.nom || '');
    });
  }
  return out;
}

// Les ROULEAUX : on monte une bouille et l'on lit la longueur des clips que
// l'éditeur fait défiler. C'est ce que fait déjà `bouille-js.html` pour borner
// ses planches.
function rouleaux(defs, fam) {
  const etat = M.encode62(fam, 2) + '000000000000000000000000'.slice(0, 22);
  try {
    const mo = new M.Moteur(defs, { alea: () => 0.5 });
    mo.creerVisage();
    mo.definir(etat);
    const f = mo.racine.face;
    const e = (c, n) => c && c.enfantNomme(n);
    const ca = e(f, 'ca'), caC = e(ca, 'c');
    const oa = e(f, 'oa'), oaO = e(oa, 'o'), p = e(oaO, 'p');
    const b = e(f, 'b'), bb = e(b, 'b');
    return {
      cheveux: ca ? ca.def.n : 0,
      accessoire: caC ? caC.def.n : 0,
      accessoire2: e(caC, 'acc') ? e(caC, 'acc').def.n : 0,
      yeux: oaO ? oaO.def.n : 0,
      iris: p ? p.def.n : 0,
      bouche: bb ? bb.def.n : 0,
      bouches: bb ? Object.keys(bb.def.labels || {}) : [],
    };
  } catch (e) { return { erreur: e.message }; }
}


/*
 * ── LE VRAI GISEMENT : LES DESSINS ────────────────────────────────────────
 *
 * Les étiquettes se ressemblent presque toutes ; c'est SOUS elles que les
 * familles diffèrent. Six émotes posent des dessins qui leur sont propres, et
 * chacune y met les siens. On compare donc, position par position dans la
 * pellicule, le dessin de chaque famille à celui de la famille 0 : ce qui
 * DIFFÈRE est ce qu'on peut greffer, comme on l'a fait pour le gum d'hiko.
 *
 * Les numéros de caractère ne se comparent pas d'une famille à l'autre : on
 * compare des EMPREINTES — le tracé d'une forme, ou l'arbre d'un clip aplati.
 */
function empreinte(defs, ch, prof) {
  prof = prof || 0;
  if (prof > 4) return '…';
  if (defs.formes.has(ch)) {
    return JSON.stringify(defs.formes.get(ch)).replace(/"id":\d+,?/, '');
  }
  const sp = defs.sprites.get(ch);
  if (!sp) return 'ø';
  return '{' + sp.n + ':' + (sp.images || []).map((im) => (im || [])
    .map((o) => (o.t === 'pose' && o.ch >= 0 ? empreinte(defs, o.ch, prof + 1) : o.t))
    .join(',')).join(';') + '}';
}
const A_COMPARER = ['rougir', 'gum', 'gumNext', 'question', 'pleurer', 'larme', 'miam', 'regard'];
function bornes(sp, nom) {
  const l = Object.entries(sp.labels || {}).map(([n, i]) => ({ n, i: Number(i) }))
    .sort((a, b) => a.i - b.i);
  const k = l.findIndex((x) => x.n === nom);
  if (k < 0) return null;
  return { deb: l[k].i, fin: k + 1 < l.length ? l[k + 1].i : sp.images.length + 1 };
}
function propresDe(defs, sp) {
  const prem = Math.min(...Object.values(sp.labels || {}).map(Number).concat([2]));
  const repos = new Set(poses(sp, 1, prem).keys());
  const out = {};
  A_COMPARER.forEach((e) => {
    const b = bornes(sp, e);
    if (!b) return;
    out[e] = [...poses(sp, b.deb, b.fin).keys()].filter((ch) => !repos.has(ch))
      .map((ch) => empreinte(defs, ch));
  });
  return out;
}

async function comparerLesDessins(fichiers) {
  const d0 = await lire('famille0.swf');
  const ref = propresDe(d0, visageDe(d0).sp);
  console.log('\nLES DESSINS PROPRES, comparés à ceux de la famille 0');
  console.log('(« 3/3 » = trois dessins propres, tous différents de la famille 0)');
  for (const f of fichiers) {
    if (f === 'famille0.swf') continue;
    const defs = await lire(f);
    const v = visageDe(defs);
    if (!v) continue;
    const p = propresDe(defs, v.sp);
    const lignes = [];
    A_COMPARER.forEach((e) => {
      if (!p[e] || !ref[e] || !p[e].length) return;
      const n = p[e].filter((x, i) => x !== ref[e][i]).length;
      lignes.push(e + ' ' + n + '/' + p[e].length);
    });
    console.log('  famille ' + String(f.match(/\d+/)[0]).padStart(2) + ' : '
      + (lignes.length ? lignes.join(' · ') : 'rien de propre'));
  }
}

(async () => {
  const fichiers = fs.readdirSync(DOSSIER).filter((f) => /^famille\d+\.swf$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const tout = {};
  for (const f of fichiers) {
    const fam = Number(f.match(/\d+/)[0]);
    const defs = await lire(f);
    const v = visageDe(defs);
    const ko = Math.round(fs.statSync(path.join(DOSSIER, f)).size / 1024);
    if (!v) { tout[fam] = { ko, erreur: 'pas de visage' }; continue; }
    const sp = v.sp;
    const etiq = Object.entries(sp.labels || {}).map(([nom, im]) => ({ nom, im: Number(im) }))
      .sort((a, b) => a.im - b.im);
    const repos = poses(sp, 1, (etiq[0] || { im: 2 }).im);
    const emotes = etiq.map((e, i) => {
      const fin = i + 1 < etiq.length ? etiq[i + 1].im : sp.images.length + 1;
      const p = poses(sp, e.im, fin);
      const propres = [...p.entries()].filter(([ch]) => !repos.has(ch))
        .map(([ch, nom]) => ({ ch, nom }));
      return { nom: e.nom, im: e.im, n: fin - e.im, propres };
    });
    tout[fam] = { ko, visage: v.id, images: sp.images.length, emotes,
      rouleaux: rouleaux(defs, fam) };
  }

  if (JSON_SEUL) { console.log(JSON.stringify(tout, null, 1)); return; }

  // Ce que la famille 0 a déjà : le point de comparaison.
  const base = new Set((tout[0].emotes || []).map((e) => e.nom));
  console.log('FAMILLE  poids   visage  images  ÉMOTES (durée, + dessins propres)');
  for (const [fam, d] of Object.entries(tout)) {
    if (d.erreur) { console.log(String(fam).padStart(7) + '  ' + d.ko + ' Ko  ' + d.erreur); continue; }
    const liste = d.emotes.map((e) => {
      const neuf = (fam !== '0' && !base.has(e.nom)) ? '*' : '';
      return neuf + e.nom + '(' + e.n + (e.propres.length ? '+' + e.propres.length : '') + ')';
    });
    console.log(String(fam).padStart(7) + '  ' + String(d.ko + ' Ko').padStart(6)
      + '  #' + String(d.visage).padEnd(6) + String(d.images).padStart(5) + '   ' + liste.join(' '));
  }
  console.log('\n(* = étiquette que la famille 0 n’a pas)');

  console.log('\nLES ROULEAUX — combien de variantes chaque famille propose');
  console.log('FAMILLE  cheveux  access.  acc.2°  yeux  iris  bouche');
  for (const [fam, d] of Object.entries(tout)) {
    const r = d.rouleaux;
    if (!r || r.erreur) { console.log(String(fam).padStart(7) + '  ' + ((r && r.erreur) || '—')); continue; }
    console.log(String(fam).padStart(7)
      + String(r.cheveux).padStart(9) + String(r.accessoire).padStart(9)
      + String(r.accessoire2).padStart(8) + String(r.yeux).padStart(6)
      + String(r.iris).padStart(6) + String(r.bouche).padStart(8));
  }

  // Le DÉTAIL des émotes que la famille 0 n'a pas, avec leurs dessins.
  console.log('\nCE QUE LA FAMILLE 0 N’A PAS');
  for (const [fam, d] of Object.entries(tout)) {
    if (fam === '0' || d.erreur) continue;
    const neuves = d.emotes.filter((e) => !base.has(e.nom));
    if (!neuves.length) continue;
    console.log('  famille ' + fam + ' :');
    neuves.forEach((e) => {
      console.log('    ' + e.nom.padEnd(14) + 'image ' + String(e.im).padStart(4)
        + ', ' + String(e.n).padStart(3) + ' images'
        + (e.propres.length
          ? '  — dessins propres : ' + e.propres.map((p) => '#' + p.ch + (p.nom ? ' «' + p.nom + '»' : '')).join(', ')
          : '  — aucun dessin propre (c’est du mouvement)'));
    });
  }
  await comparerLesDessins(fichiers);
})().catch((e) => { console.error(e); process.exit(1); });
