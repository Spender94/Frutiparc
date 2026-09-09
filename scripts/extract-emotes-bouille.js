#!/usr/bin/env node
'use strict';
/*
 * LES ÉMOTES QUI VIENNENT D'UNE AUTRE FAMILLE
 * ═══════════════════════════════════════════
 *
 * Deux familles du parc terminent une émote par une CHUTE que la famille 0
 * n'a pas. On les récolte ici, pour que tout le monde puisse les jouer :
 *
 *   · LE JUTSU d'hiko (famille 12). Après « regarde ailleurs », son visage
 *     part en fumée et il ne reste qu'un chocapic. Deux dessins portent la
 *     chute — la fumée (six formes qui se relaient) et le chocapic — et ils
 *     n'existent que dans famille12.swf. Ce sont eux qu'on emporte.
 *
 *   · LA TOUX (familles 15 et 16). Elle ne dessine RIEN : c'est le visage
 *     entier qui sursaute, deux fois, sur une courbe de six images. On
 *     emporte donc les six matrices, pas des tracés.
 *
 *   · LE CHEWING-GUM D'HIKO (famille 12). Toutes les familles ont un gum, et
 *     de la MÊME FORME : `gum`, puis `gumNext` trois images plus loin, douze
 *     en tout, et une fin qui pose deux images d'éclatement suivies d'une
 *     « tache ». Seuls les DESSINS changent — et les constantes de la boucle
 *     de croissance —, et c'est là que hiko se distingue : là où la famille 0
 *     pose une petite tache sur la joue, lui s'en prend une EN PLEINE FIGURE —
 *     un aplat jaune qui couvre toute la tête, puis se dilue. On emporte donc
 *     ses trois dessins de fin, que le moteur substitue à ceux de la famille
 *     d'accueil ; la bulle, elle, reste celle de la famille.
 *
 * CE QU'ON N'EMPORTE PAS : les pellicules. Le jutsu d'époque tient dans les
 * images 129 à 148 du visage de hiko, avec ses scripts, ses boucles d'attente
 * et son alpha qui descend de cinq en cinq. Rien de tout cela n'a de place
 * dans le visage de la famille 0, qui n'a pas ces images. Le moteur rejoue
 * donc la chute lui-même (cf. `jouerAnim`, animations 14 et 15) : c'est du
 * code, pas une greffe de pellicule, et ça vaut pour les dix familles.
 *
 * LES NUMÉROS SONT RÉÉCRITS. Un caractère de hiko porte un identifiant sur
 * seize bits, et la famille d'accueil a le sien au même numéro : #415 est le
 * chocapic chez hiko et tout autre chose dans la famille 0. On décale donc la
 * récolte au-delà de la plage d'un SWF (100 000 et au-dessus), et plus rien ne
 * peut se marcher dessus.
 *
 *   node scripts/extract-emotes-bouille.js
 *   → public/fbouille/emotes.json
 */

const fs = require('node:fs');
const path = require('node:path');
const Swf = require('../public/js/bouille-swf.js');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'public/fbouille');
const SORTIE = path.join(DOSSIER, 'emotes.json');

// Le décalage des identifiants récoltés : au-delà de ce qu'un SWF peut porter.
const DECALAGE = 100000;

function lire(fichier) {
  const b = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}

// Le VISAGE d'une famille : le sprite qui porte le plus d'étiquettes d'action.
const ACTIONS = ['parle', 'rire', 'mdr', 'langue', 'rougir', 'regard', 'sifflote',
  'gum', 'question', 'miam', 'pleurer', 'larme'];
function visageDe(defs) {
  let best = null, score = -1;
  for (const [id, sp] of defs.sprites) {
    const n = ACTIONS.filter((a) => sp.labels && a in sp.labels).length;
    if (n > score) { score = n; best = { id, sp }; }
  }
  if (score <= 0) throw new Error('visage introuvable');
  return best;
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
      // Les ordres, avec leurs caractères renumérotés. Les scripts d'image ne
      // se recopient PAS : le moteur rejoue la chute lui-même, et un script
      // d'hiko n'aurait de sens que dans la pellicule d'hiko.
      images: (sp.images || []).map((im) => (im || [])
        .filter((o) => o.t !== 'script')
        .map((o) => (o.ch !== undefined && o.ch !== null && o.ch >= 0
          ? Object.assign({}, o, { ch: DECALAGE + o.ch }) : o))),
    };
  }
  return { formes, sprites };
}

// La matrice d'un caractère posé à une image donnée du visage.
function poseDe(sp, image, ch) {
  const o = (sp.images[image - 1] || []).find((x) => x.t === 'pose' && x.ch === ch);
  if (!o) throw new Error('pose introuvable : #' + ch + ' à l’image ' + image);
  return { ch: DECALAGE + ch, M: o.M };
}

/*
 * LA FIN DU CHEWING-GUM D'UNE FAMILLE : l'éclatement, puis la tache.
 *
 * Elle tient dans les trois images qui suivent `gumNext`, et la pellicule est
 * la même partout — on lit donc la même chose chez tout le monde :
 *
 *   · les poses SANS NOM sont les images de l'éclatement, dans leur ordre ;
 *   · la pose nommée « tache » est ce qui reste sur la figure.
 *
 * Une pose qui n'apporte pas de matrice garde celle de la précédente à sa
 * profondeur (c'est la règle de Flash quand on remplace un caractère sans
 * toucher au placement) : on la reporte, sinon le dessin partirait à l'origine
 * de la scène.
 */
function finDuGum(sp) {
  const deb = sp.labels.gumNext;
  if (!deb) return null;
  const eclats = [];
  let tache = null;
  const dernierM = {};
  for (let i = deb; i < deb + 3; i++) {
    for (const o of (sp.images[i - 1] || [])) {
      if (o.t !== 'pose' || !(o.ch >= 0)) continue;
      const M = o.M || dernierM[o.prof] || null;
      if (o.M) dernierM[o.prof] = o.M;
      if (o.nom === 'tache') tache = { ch: o.ch, M };
      else eclats.push({ ch: o.ch, M });
    }
  }
  return (eclats.length && tache) ? { eclats, tache } : null;
}

/*
 * LA SECOUSSE DE LA TOUX, relevée sur la famille 15.
 *
 * Les sept profondeurs du visage bougent TOUTES DE LA MÊME FAÇON pendant la
 * quinte : ce n'est pas un morceau qui remue, c'est la tête entière. On peut
 * donc n'en garder qu'une matrice par image — celle qui dit ce que devient le
 * visage par rapport à son repos.
 *
 * On la calcule comme un ÉCART : la matrice de l'image, composée avec
 * l'inverse de celle du repos. Appliquée au visage d'une autre famille, elle
 * y produit le même mouvement.
 */
function inverse(M) {
  const det = M.a * M.d - M.b * M.c;
  if (!det) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  return {
    a: M.d / det, b: -M.b / det, c: -M.c / det, d: M.a / det,
    e: (M.c * M.f - M.d * M.e) / det, f: (M.b * M.e - M.a * M.f) / det,
  };
}
// La MÊME composition que `composerM` du moteur : E d'abord, puis P.
function composer(P, E) {
  return {
    a: P.a * E.a + P.c * E.b, b: P.b * E.a + P.d * E.b,
    c: P.a * E.c + P.c * E.d, d: P.b * E.c + P.d * E.d,
    e: P.a * E.e + P.c * E.f + P.e, f: P.b * E.e + P.d * E.f + P.f,
  };
}

function secousse(defs) {
  const v = visageDe(defs);
  const sp = v.sp;
  const debut = sp.labels.tousse;
  if (!debut) throw new Error('la famille n’a pas de « tousse »');
  // Le repos : la dernière matrice posée à chaque profondeur avant la quinte.
  const repos = {};
  for (let i = 1; i < debut; i++) {
    (sp.images[i - 1] || []).forEach((o) => { if (o.t === 'pose' && o.M) repos[o.prof] = o.M; });
  }
  // La secousse dure six images. On prend la profondeur la plus basse — elles
  // portent toutes le même écart, on le vérifie au passage.
  const profs = Object.keys(repos).map(Number).sort((a, b) => a - b);
  const pas = [];
  for (let i = debut; i < debut + 6; i++) {
    const par = {};
    (sp.images[i - 1] || []).forEach((o) => { if (o.t === 'pose' && o.M) par[o.prof] = o.M; });
    const ecarts = profs.filter((p) => par[p]).map((p) => composer(par[p], inverse(repos[p])));
    if (!ecarts.length) throw new Error('image ' + i + ' : rien ne bouge');
    /*
     * TOUTES LES PROFONDEURS DOIVENT DIRE LA MÊME CHOSE — et c'est bien le
     * cas : c'est la tête entière qui sursaute, pas un morceau.
     *
     * On le vérifie en deux temps, parce que les deux moitiés d'une matrice
     * ne se valent pas. La partie LINÉAIRE (a, b, c, d) — la rotation — est
     * rigoureusement la même partout : on l'exige au millième. La
     * TRANSLATION, elle, sort d'un pivot commun recalculé pièce par pièce et
     * arrondi en virgule fixe par le SWF : sur le relevé de la famille 15
     * les sept pièces s'écartent au plus de deux dixièmes d'unité de scène —
     * deux millièmes de la tête, que personne ne verra jamais. On tolère
     * donc une demi-unité, et l'on prend la MOYENNE plutôt qu'une pièce au
     * hasard.
     */
    const moyenne = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((k) => {
      const min = Math.min(...ecarts.map((x) => x[k]));
      const max = Math.max(...ecarts.map((x) => x[k]));
      const marge = (k === 'e' || k === 'f') ? 0.5 : 0.001;
      if (max - min > marge) {
        throw new Error('image ' + i + ' : les profondeurs ne bougent pas ensemble ('
          + k + ' va de ' + min + ' à ' + max + ')');
      }
      moyenne[k] = ecarts.reduce((s, x) => s + x[k], 0) / ecarts.length;
    });
    pas.push(arrondir(moyenne));
  }
  return pas;
}
const arrondir = (M) => {
  const r = {};
  ['a', 'b', 'c', 'd', 'e', 'f'].forEach((k) => { r[k] = Math.round(M[k] * 1e5) / 1e5; });
  return r;
};

(async () => {
  const d12 = await lire('famille12.swf');
  const face12 = visageDe(d12).sp;
  const JUTSU = face12.labels.jutsu2;
  if (!JUTSU) throw new Error('famille 12 : « jutsu2 » introuvable');

  // Les deux caractères posés à `jutsu2` : la fumée et le chocapic.
  const poses = (face12.images[JUTSU - 1] || []).filter((o) => o.t === 'pose' && o.ch >= 0);
  const fumee = poses.find((o) => o.nom === 'smoke');
  const choco = poses.find((o) => o !== fumee);
  if (!fumee || !choco) throw new Error('famille 12 : la fumée ou le chocapic manque');

  const d15 = await lire('famille15.swf');
  const face15 = visageDe(d15).sp;

  /*
   * LE NUAGE DE LA TOUX. « Je veux garder le nuage pour la toux, c'est ce qui
   * fait tout le charme de l'animation. »
   *
   * Il se pose chez elle à `gumNext` — l'image où la bulle de chewing-gum
   * éclate — sous le nom `smoke`, à trois quarts d'opacité (`ma` = 192). On
   * le récolte sans la bulle : c'est le nuage qu'on veut, pas ce qui le
   * provoque. C'est un clip de treize images, six dessins qui se relaient,
   * comme la fumée d'hiko.
   */
  const GUM = face15.labels.gumNext;
  const nuage = (face15.images[GUM - 1] || [])
    .find((o) => o.t === 'pose' && o.ch >= 0 && o.nom === 'smoke');
  if (!nuage) throw new Error('famille 15 : le nuage de la toux est introuvable');

  // LE GUM D'HIKO : les deux images de l'éclatement, et la tache qui reste.
  const gum12 = finDuGum(face12);
  if (!gum12) throw new Error('famille 12 : la fin du chewing-gum est introuvable');

  /*
   * ET LA BULLE ELLE-MÊME.
   *
   * Chaque famille a la sienne, posée sous le nom `bubble` à l'étiquette
   * « gum », et c'est un clip d'UNE image : une seule forme, que la pellicule
   * fait enfler. Celle de la famille 0 est ROSE (contour 142,21,21, dégradé
   * 255,183,183) quand l'éclatement d'hiko, lui, est JAUNE — on voyait donc une
   * bulle rose exploser en jaune. On récolte la bulle d'hiko (dégradé
   * 254,248,182, contour olive à moitié transparent) pour qu'elle soit de la
   * bonne couleur DÈS LE DÉPART.
   */
  const bulle12 = (face12.images[face12.labels.gum - 1] || [])
    .find((o) => o.t === 'pose' && o.ch >= 0 && o.nom === 'bubble');
  if (!bulle12) throw new Error('famille 12 : la bulle du chewing-gum est introuvable');

  const recolte = recolter(d12, [fumee.ch, choco.ch, bulle12.ch]
    .concat(gum12.eclats.map((e) => e.ch), [gum12.tache.ch]));
  const recolte15 = recolter(d15, [nuage.ch]);
  // Les deux récoltes vivent dans le même paquet : les numéros ne peuvent pas
  // se heurter, un même décalage appliqué à deux familles pouvant retomber sur
  // le même. On pousse la seconde d'une plage de plus.
  const DECALE15 = DECALAGE;
  const glisser = (table) => {
    const out = {};
    Object.entries(table).forEach(([id, v]) => { out[Number(id) + DECALE15] = v; });
    return out;
  };
  const renumeroter = (sprites) => {
    const out = {};
    Object.entries(sprites).forEach(([id, sp]) => {
      out[Number(id) + DECALE15] = Object.assign({}, sp, {
        images: sp.images.map((im) => im.map((o) => (o.ch >= 0
          ? Object.assign({}, o, { ch: o.ch + DECALE15 }) : o))),
      });
    });
    return out;
  };

  const paquet = {
    // De quoi retrouver la source si l'on doit refaire la récolte.
    source: {
      jutsu: 'famille12.swf, visage, image ' + JUTSU + ' (étiquette « jutsu2 »)',
      toux: 'famille15.swf, visage, étiquette « tousse » — six images de secousse',
      gum: 'famille12.swf, visage, étiquettes « gum » (la bulle) et « gumNext » '
        + '(l’éclatement et la tache)',
      outil: 'scripts/extract-emotes-bouille.js',
      decalage: DECALAGE,
    },
    formes: Object.assign({}, recolte.formes, glisser(recolte15.formes)),
    sprites: Object.assign({}, recolte.sprites, renumeroter(recolte15.sprites)),
    jutsu: {
      fumee: poseDe(face12, JUTSU, fumee.ch),
      chocapic: poseDe(face12, JUTSU, choco.ch),
    },
    toux: {
      secousse: secousse(d15),
      // Le nuage, avec sa pose ET son opacité : trois quarts, comme chez elle.
      nuage: { ch: nuage.ch + DECALAGE + DECALE15, M: nuage.M,
        alpha: nuage.cx ? nuage.cx.ma / 256 : 1 },
    },
    // Le gum d'hiko, prêt à remplacer celui de la famille d'accueil : la bulle
    // (jaune, du premier souffle) puis l'éclatement et la tache.
    gum: {
      bulle: { ch: bulle12.ch + DECALAGE },
      eclats: gum12.eclats.map((e) => ({ ch: e.ch + DECALAGE, M: e.M })),
      tache: { ch: gum12.tache.ch + DECALAGE, M: gum12.tache.M },
    },
  };

  fs.writeFileSync(SORTIE, JSON.stringify(paquet) + '\n');
  const ko = (fs.statSync(SORTIE).size / 1024).toFixed(1);
  console.log('emotes.json écrit — ' + ko + ' Ko');
  console.log('  formes récoltées : ' + Object.keys(paquet.formes).join(', '));
  console.log('  clips récoltés   : ' + Object.keys(paquet.sprites).join(', '));
  console.log('  secousse de toux : ' + paquet.toux.secousse.length + ' images');
})().catch((e) => { console.error(e); process.exit(1); });
