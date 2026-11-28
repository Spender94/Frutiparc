#!/usr/bin/env node
// Les TEXTES FIGÉS des jeux du moteur Kaluga (Kaluga, Burning Kiwi,
// MotionBall 2), pour la version anglaise.
//
//   node scripts/textes-figes.js           → écrit public/<jeu>/data/figes.json
//   node scripts/textes-figes.js --liste   → montre chaque texte français et sa clé
//
// ── Le problème ──
//
// Le « texte statique » de Flash (DefineText) n'est pas du texte : ce sont des
// glyphes posés un à un, que les extracteurs (extract-kaluga.js, -bkiwi.js,
// -mb2.js) ont cuits en FORMES vectorielles dans data/*.json. Le lettrage
// d'origine y est exact, mais on ne peut pas le traduire : « RETOUR » est une
// suite de contours, pas une chaîne. Kaluga va plus loin : ses titres de
// tutoriel (« Ramasser le plus de pommes ! »), sa pause, ses « Votre score : »
// sont écrits LETTRE À LETTRE, chaque lettre un symbole posé par le scénario
// d'un clip (l'auteur réutilisait ses « e » et ses « r » d'un titre à l'autre).
//
// ── Le choix ──
//
// En anglais, le moteur écrit le texte À L'EXÉCUTION, dans la MÊME fonte
// embarquée (le WOFF que les extracteurs ont tiré du SWF), au même corps, de
// la même couleur, sur la même ligne de base — à la place des glyphes
// français. On a préféré cela à des formes anglaises régénérées hors ligne :
//   · l'anglais ne vit qu'à un endroit, le dictionnaire du jeu
//     (public/<jeu>/lang/en.js, clés `<jeu>.fige.*`) : le corriger ne demande
//     aucune extraction ;
//   · une fonte réduite (un sous-ensemble du SWF : Donald en capitales,
//     911 Porscha sans la moitié des majuscules…) cède la place, pour une
//     chaîne qu'elle ne sait pas écrire, à la copie complète de la même fonte
//     quand le SWF en a une, sinon à une fonte système proche — ce qu'aucune
//     forme cuite ne permettait ;
//   · le français ne change pas d'un octet : ce fichier n'est lu qu'en anglais.
//
// Ce script ne fait que relever la MISE EN PAGE de chaque texte figé — où
// commence et finit chaque ligne, sa fonte, son corps, sa couleur, son
// alignement — et, pour les mots écrits lettre à lettre, quelles profondeurs
// du clip forment chaque phrase, image par image. Le moteur
// (public/kaluga/moteur/texte.js, K.poserFiges et K.ecrireFige) n'a plus qu'à
// écrire l'anglais par-dessus.
//
// ── Ce que contient public/<jeu>/data/figes.json ──
//
//   fontes      { id: 'les caractères que la fonte sait écrire' }
//   substituts  { id: idDeLaCopieComplète | 'pile CSS d'une fonte système' }
//   biblios     { nom: { textes, clips } }
//     textes    { id: { fr, l: [ligne…], a, lmax } }       un texte figé entier,
//                                                         dans son propre repère
//                                                         (avant sa matrice)
//     clips     { id: { phrases: { clé: { fr, l: [ligne], a, lmax } },
//                       images: [[de, à, [[clé, [profondeurs…]]…]]…] } }
//                                                         une phrase lettre à
//                                                         lettre, dans le repère
//                                                         du clip
//   une ligne   { f: fonte, t: corps (px), c: couleur, x, x1, y: ligne de base }
//
// `a` est l'alignement (gauche, centre, droite), déduit des positions des
// glyphes français ; `lmax` la largeur que l'anglais peut prendre avant d'être
// resserré. Les cas que la déduction ne devine pas sont réglés plus bas
// (les `reglages` de chaque jeu), après avoir regardé les écrans anglais.

'use strict';

const fs = require('fs');
const path = require('path');
const { lireSwf } = require('./lib/swf-sprites.js');
const { lireTextes } = require('./lib/swf-texte.js');
const F = require('./lib/swf-formes.js');

const RACINE = path.join(__dirname, '..');
const LISTE = process.argv.includes('--liste');

// Les fontes système de repli, quand ni la fonte d'origine ni sa copie
// complète ne savent écrire une chaîne anglaise.
const VERDANA = 'Verdana, "DejaVu Sans", "Bitstream Vera Sans", Geneva, sans-serif';
const ARIAL = 'Arial, Helvetica, "Liberation Sans", sans-serif';
const ETROITE = 'Impact, "Arial Narrow", "Liberation Sans Narrow", "DejaVu Sans Condensed", sans-serif';
const LARGE = '"Arial Black", "Arial Bold", Gadget, "DejaVu Sans", sans-serif';

const JEUX = {
  kaluga: {
    dossier: 'Games/kaluga',
    swfs: [{ nom: 'kaluga', fichier: 'kaluga.swf' }],
    // Donald : les sous-ensembles (523 en capitales, 64…) passent à la copie
    // complète (92) ; President (50, quinze lettres) aussi, faute d'une autre.
    substituts: { 50: 92, 64: 92, 523: 92, 764: 92, 771: 92, 960: 92, 709: VERDANA, 648: 92 },
    // « Partie Terminée », en tête du panneau de fin : du Donald dessiné.
    dessines: {
      kaluga: {
        638: { fr: 'Partie Terminée', l: [{ f: 92, t: 38.5, c: '#f5dfd8', x: 211.6, x1: 486.25, y: 39.8 }], a: 'centre', lmax: 300 },
      },
    },
    reglages: {
      // Les titres du panneau de départ : alignés à gauche après le numéro de
      // l'étape, ils ont toute la largeur du panneau. Ceux des modes sans
      // étapes (Survie, Piste, Invasion) sont centrés.
      'clip:1074': { a: 'gauche', lmax: 425 },
      'phrase:1074.73': { a: 'centre' },
      'phrase:1074.80': { a: 'centre' },
      'phrase:1074.86': { a: 'centre' },
      // « Contre-la-montre » est un mot entier, posé au milieu du panneau.
      'texte:1040': { a: 'centre', lmax: 425 },
      // La pause et le chargement de la carte, centrés sous l'écran.
      'clip:82': { a: 'centre', lmax: 520 },
      'clip:89': { a: 'centre', lmax: 400 },
      'texte:51': { a: 'centre', lmax: 360 },
      // Les étiquettes du grand score (« Votre score : »), alignées à droite
      // contre le chiffre.
      'clip:668': { a: 'droite' },
      'clip:701': { a: 'droite' },
    },
  },
  bkiwi: {
    dossier: 'Games/burningKiwi',
    swfs: [{ nom: 'bkiwi', fichier: 'burningkiwi.swf' }],
    // Denmark (94, 77 glyphes, sans virgule) a sa copie complète (464).
    // 911 Porscha (119) n'en a pas : ses minuscules sont toutes là, l'anglais
    // s'en accommode ; à défaut, une grasse du système.
    substituts: { 94: 464, 119: LARGE, 583: 'bold ' + VERDANA, 330: LARGE, 134: LARGE, 188: LARGE, 195: LARGE, 378: 'bold ' + VERDANA },
    reglages: {},
  },
  mb2: {
    dossier: 'Games/motionBall2',
    swfs: [{ nom: 'mb2', fichier: 'motionball.swf' }],
    // Sweet as candy (884, 33 glyphes, penchée) a sa copie complète (69,
    // droite : on la penche). Kiloton
    // (74) n'a que vingt-cinq lettres : une étroite du système. Les « _st »
    // sont des Arial pixellisées : l'Arial du système.
    substituts: { 884: 'italic "Kaluga 69", ' + ARIAL, 74: ETROITE, 124: 'bold ' + ARIAL, 126: 'bold ' + ARIAL, 129: 'bold ' + ARIAL, 136: ARIAL, 133: 'bold ' + ARIAL, 886: 69 },
    reglages: {
      // La règle du jeu : une liste à puces, alignée à gauche (les lignes de
      // suite sont en retrait, ce qui trompait la déduction).
      'texte:127': { a: 'gauche' },
    },
  },
};

// ── La lecture d'un SWF (en-tête, parcours des tags) ─────────────────────
function lireEntete(b) {
  const r = new F.Bits(b, 0);
  const n = r.u(5);
  r.s(n); r.s(n); r.s(n); r.s(n);
  r.align();
  return { debut: r.o + 4 };
}
function parcourir(b, debut, visiter) {
  (function scan(from, to, id) {
    let o = from;
    while (o < to) {
      const hdr = b.readUInt16LE(o), code = hdr >> 6;
      let len = hdr & 0x3f, hs = 2;
      if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
      if (code === 0) break;
      const corps = o + hs;
      if (code === 39) scan(corps + 4, corps + len, b.readUInt16LE(corps));
      visiter(code, corps, len, id);
      o += hs + len;
    }
  })(debut, b.length, 0);
}

const arr = (v) => Math.round(v * 100) / 100;

// La chasse d'un glyphe, en pixels : la table de la fonte si elle en a une,
// sinon le bord droit de son contour (les fontes sans métriques, rares).
function chasse(fonte, idx, taille) {
  if (fonte.avances && fonte.avances[idx] !== undefined) return fonte.avances[idx] * taille / 1024;
  const d = fonte.glyphes[idx] || '';
  let max = 0;
  const nombres = d.match(/-?\d+(\.\d+)?/g) || [];
  for (let i = 0; i < nombres.length; i += 2) max = Math.max(max, Number(nombres[i]));
  return max * taille / 1024;
}

/*
 * Les LIGNES d'un texte figé, dans son propre repère (avant sa matrice) : les
 * enregistrements de même ligne de base forment une ligne, lus de gauche à
 * droite. Les espaces de bout de ligne ne comptent pas dans sa largeur.
 */
function lignesDe(t, fontes) {
  const parY = new Map();
  for (const run of t.runs) {
    const fonte = fontes.get(run.fonte);
    if (!fonte || !run.glyphes.length) continue;
    const taille = run.taille / 20;
    const y = run.y / 20;
    let cle = null;
    for (const k of parY.keys()) if (Math.abs(k - y) < Math.max(1, taille * 0.3)) cle = k;
    if (cle === null) { cle = y; parY.set(y, []); }
    const car = run.glyphes.map((g) => String.fromCharCode(fonte.codes[g.idx]));
    parY.get(cle).push({ run, fonte, taille, car });
  }
  const lignes = [];
  for (const [y, runs] of [...parY.entries()].sort((p, q) => p[0] - q[0])) {
    runs.sort((p, q) => p.run.glyphes[0].x - q.run.glyphes[0].x);
    let texte = '', x0 = Infinity, x1 = -Infinity;
    const poids = new Map();
    let couleur = null, taille = 0;
    for (const r of runs) {
      r.run.glyphes.forEach((g, i) => {
        const c = r.car[i];
        texte += c;
        if (c.trim() === '') return;
        const gx = g.x / 20;
        x0 = Math.min(x0, gx);
        x1 = Math.max(x1, gx + chasse(r.fonte, g.idx, r.taille));
        poids.set(r.run.fonte, (poids.get(r.run.fonte) || 0) + 1);
        if (!couleur) couleur = r.run.couleur;
        taille = Math.max(taille, r.taille);
      });
    }
    if (!isFinite(x0)) continue;
    const fonte = [...poids.entries()].sort((p, q) => q[1] - p[1])[0][0];
    lignes.push({ f: fonte, t: arr(taille), c: couleur, x: arr(x0), x1: arr(x1), y: arr(y), fr: texte.replace(/\s+/g, ' ').trim() });
  }
  return lignes;
}

/*
 * L'ALIGNEMENT, d'après les glyphes français. Plusieurs lignes : mêmes débuts,
 * c'est à gauche ; mêmes fins, à droite ; sinon centré. Une seule : le cadre
 * d'un texte statique commence à x = 0 de son repère — un premier glyphe
 * décalé dit un texte centré dans un cadre plus large.
 */
function alignement(lignes) {
  if (lignes.length > 1) {
    const ecart = (f) => Math.max(...lignes.map(f)) - Math.min(...lignes.map(f));
    if (ecart((l) => l.x) < 2) return 'gauche';
    if (ecart((l) => l.x1) < 2) return 'droite';
    return 'centre';
  }
  return lignes[0].x > 2 ? 'centre' : 'gauche';
}

// La largeur permise : la plus longue ligne, ou le cadre d'un texte centré.
function largeurPermise(lignes, a) {
  let l = 0;
  for (const li of lignes) {
    const w = li.x1 - li.x;
    l = Math.max(l, a === 'centre' && li.x > 2 ? w + 2 * li.x : w);
  }
  return arr(l);
}

// Transforme une ligne par une matrice sans rotation [a, b, c, d, tx, ty].
function placer(l, m) {
  return Object.assign({}, l, {
    x: arr(m[0] * l.x + m[4]), x1: arr(m[0] * l.x1 + m[4]), y: arr(m[3] * l.y + m[5]), t: arr(l.t * m[3]),
  });
}

function traiterJeu(nomJeu, jeu) {
  const sortie = { fontes: {}, substituts: {}, biblios: {} };
  const fontesUtiles = new Set();
  const liste = [];
  for (const spec of jeu.swfs) {
    const b = lireSwf(path.join(RACINE, jeu.dossier, spec.fichier));
    const entete = lireEntete(b);
    const T = lireTextes({ b, parcourir: (v) => parcourir(b, entete.debut, v) });
    const data = JSON.parse(fs.readFileSync(path.join(RACINE, 'public', nomJeu, 'data', spec.nom + '.json'), 'utf8'));
    const reglage = (k) => jeu.reglages[k] || {};
    const textes = {};
    const clips = {};

    // Les lignes de chaque texte figé, dans son repère (`propres`, celui où
    // son cadre commence à x = 0), et passées par sa matrice (`lignesFige`,
    // le repère de qui le pose).
    const propres = new Map();
    const lignesFige = new Map();
    for (const [id, t] of T.statiques) {
      if (!data.perso[id]) continue;
      const M = t.matrice;
      if (Math.abs(M.b) > 1e-6 || Math.abs(M.c) > 1e-6) { console.warn(`  ! ${nomJeu} #${id} : texte tourné, ignoré`); continue; }
      const m = [M.a, 0, 0, M.d, M.e / 20, M.f / 20];
      const lignes = lignesDe(t, T.fontes);
      propres.set(Number(id), lignes);
      lignesFige.set(Number(id), lignes.map((l) => placer(l, m)));
    }

    // ── Les phrases écrites lettre à lettre (le scénario d'un clip) ──
    const membres = new Set();          // les textes figés qui servent dans une phrase
    for (const [cid, def] of Object.entries(data.perso)) {
      if (def.t !== 'clip') continue;
      const etat = new Map();
      const parImage = [];
      const phrases = {};
      const cleDe = {};                  // texte français → clé
      def.frames.forEach((fr, i) => {
        for (const op of fr.ops) {
          if (op.x !== undefined) { etat.delete(op.x); continue; }
          const avant = etat.get(op.p);
          if (op.c !== undefined && !(op.mv && avant)) { etat.set(op.p, { c: op.c, m: op.m || null }); continue; }
          if (!avant) continue;
          if (op.c !== undefined) avant.c = op.c;
          if (op.m) avant.m = op.m;
        }
        // Les morceaux de texte figé d'une seule ligne, dans le repère du clip.
        const morceaux = [];
        for (const [p, s] of etat) {
          const lignes = lignesFige.get(s.c);
          if (!lignes || lignes.length !== 1) continue;
          const m = s.m || [1, 0, 0, 1, 0, 0];
          if (Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6) continue;
          morceaux.push(Object.assign(placer(lignes[0], m), { p, id: s.c }));
        }
        // Regroupés par ligne de base, puis en phrases : deux morceaux voisins
        // de moins de six dixièmes de corps vont ensemble ; au-delà d'un
        // huitième, c'est qu'il y avait une espace entre eux.
        // Une autre fonte ne s'y glisse que pour une lettre accentuée (le « é »
        // d'« écureuil », pris dans une Arial) : le numéro de l'étape, en
        // Impact, reste à part.
        morceaux.sort((p, q) => p.x - q.x);
        const groupes = [];
        const accent = (mo) => mo.fr.length === 1 && /[^\x00-\x7f]/.test(mo.fr);
        for (const mo of morceaux) {
          let g = groupes.find((gr) => {
            const d = gr[gr.length - 1];
            return Math.abs(d.y - mo.y) < Math.max(2, 0.35 * d.t) && Math.abs(d.t - mo.t) < 0.25 * d.t
              && (d.f === mo.f || accent(d) || accent(mo))
              && mo.x - d.x1 < 0.8 * d.t && mo.x - d.x1 > -0.5 * d.t;
          });
          if (!g) { g = []; groupes.push(g); }
          g.push(mo);
        }
        const ici = [];
        for (const g of groupes) {
          if (g.length < 2) continue;
          let fr = '';
          g.forEach((mo, k) => { if (k && mo.x - g[k - 1].x1 > 0.12 * g[k - 1].t) fr += ' '; fr += mo.fr; });
          if (!/[a-zà-ÿ]/i.test(fr)) continue;
          // La fonte, le corps et la couleur les plus portés ; la ligne de base
          // des lettres (un accent posé à part, d'une autre fonte, n'y change rien).
          const compte = (cle) => { const n = new Map(); for (const mo of g) n.set(mo[cle], (n.get(mo[cle]) || 0) + mo.fr.length); return [...n.entries()].sort((p, q) => q[1] - p[1])[0][0]; };
          const f = compte('f');
          const principal = g.find((mo) => mo.f === f);
          const ligne = { f, t: compte('t'), c: compte('c'), x: arr(Math.min(...g.map((mo) => mo.x))), x1: arr(Math.max(...g.map((mo) => mo.x1))), y: principal.y };
          let cle = cleDe[fr];
          if (!cle) {
            cle = `${cid}.${i + 1}`;
            for (let n = 2; phrases[cle]; n++) cle = `${cid}.${i + 1}.${n}`;
            cleDe[fr] = cle;
            const r = Object.assign({}, reglage('clip:' + cid), reglage('phrase:' + cle));
            const a = r.a || 'gauche';
            phrases[cle] = { fr, l: [ligne], a, lmax: r.lmax || arr(ligne.x1 - ligne.x) };
            liste.push(`${nomJeu}.fige.${cle}  [clip ${cid}${data.symboles && Object.keys(data.symboles).find((k) => data.symboles[k] === Number(cid)) ? ' ' + Object.keys(data.symboles).find((k) => data.symboles[k] === Number(cid)) : ''}, image ${i + 1}, fonte ${f}, ${ligne.t}px, x ${ligne.x}…${ligne.x1}]  ${fr}`);
          }
          for (const mo of g) membres.add(mo.id);
          for (const mo of g) fontesUtiles.add(mo.f);
          ici.push([cle, g.map((mo) => mo.p).sort((p, q) => p - q)]);
        }
        parImage.push(ici);
      });
      if (!Object.keys(phrases).length) continue;
      // Les images aux mêmes phrases se suivent : on les range par plages.
      const images = [];
      parImage.forEach((ici, i) => {
        const dernier = images[images.length - 1];
        const s = JSON.stringify(ici);
        if (dernier && dernier[1] === i && JSON.stringify(dernier[2]) === s) { dernier[1] = i + 1; return; }
        if (ici.length) images.push([i + 1, i + 1, ici]);
      });
      clips[cid] = { phrases, images };
    }

    // ── Les textes figés entiers ──
    for (const [id, lignes] of propres) {
      const fr = lignes.map((l) => l.fr).join('\n');
      if (!lignes.length || fr.replace(/\s/g, '').length < 2 || !/[a-zà-ÿ]{2}/i.test(fr)) continue;
      if (membres.has(id) && !reglage('texte:' + id).garder) {
        // Une lettre, un mot qui ne sert que dans les phrases d'un clip : la phrase le traduit.
        let seul = false;
        for (const def of Object.values(data.perso)) {
          if (def.t === 'bouton' && def.rec.some((r) => r.c === id)) seul = true;
        }
        if (!seul) continue;
      }
      const r = reglage('texte:' + id);
      const a = r.a || alignement(lignes);
      textes[id] = { fr, l: lignes.map((l) => ({ f: l.f, t: l.t, c: l.c, x: l.x, x1: l.x1, y: l.y })), a, lmax: r.lmax || largeurPermise(lignes, a) };
      for (const l of lignes) fontesUtiles.add(l.f);
      liste.push(`${nomJeu}.fige.${id}  [fonte ${lignes[0].f}, ${lignes[0].t}px, ${a}, lmax ${textes[id].lmax}]  ${fr.replace(/\n/g, ' / ')}`);
    }

    // Les textes que l'auteur avait DESSINÉS (un texte « séparé » en contours
    // dans Flash : une forme comme une autre, sans fonte) : leur mise en page
    // est relevée à la main, d'après le cadre de la forme.
    for (const [id, m] of Object.entries((jeu.dessines || {})[spec.nom] || {})) {
      if (!data.perso[id] || data.perso[id].t !== 'forme') { console.warn(`  ! ${nomJeu} #${id} : forme dessinée introuvable`); continue; }
      textes[id] = m;
      for (const l of m.l) fontesUtiles.add(l.f);
      liste.push(`${nomJeu}.fige.${id}  [dessiné, fonte ${m.l[0].f}, ${m.l[0].t}px, ${m.a}, lmax ${m.lmax}]  ${m.fr.replace(/\n/g, ' / ')}`);
    }

    sortie.biblios[spec.nom] = { textes, clips };
    // Les fontes : ce que chacune sait écrire (les utiles et leurs substituts).
    for (const [k, v] of Object.entries(jeu.substituts)) { fontesUtiles.add(Number(k)); if (typeof v === 'number') fontesUtiles.add(v); }
    for (const id of fontesUtiles) {
      const f = T.fontes.get(Number(id));
      if (f && f.codes.length) sortie.fontes[id] = f.codes.map((c) => String.fromCharCode(c)).join('');
    }
  }
  sortie.substituts = jeu.substituts;
  return { sortie, liste };
}

for (const [nom, jeu] of Object.entries(JEUX)) {
  const { sortie, liste } = traiterJeu(nom, jeu);
  if (LISTE) { console.log(`── ${nom}`); for (const l of liste) console.log('  ' + l); continue; }
  const fichier = path.join(RACINE, 'public', nom, 'data', 'figes.json');
  fs.writeFileSync(fichier, JSON.stringify(sortie) + '\n');
  const n = Object.values(sortie.biblios).reduce((s, b) => s + Object.keys(b.textes).length + Object.values(b.clips).reduce((t, c) => t + Object.keys(c.phrases).length, 0), 0);
  console.log(`${path.relative(RACINE, fichier)} : ${n} textes`);
}
