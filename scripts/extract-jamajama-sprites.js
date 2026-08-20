#!/usr/bin/env node
// Sort les dessins de JamaJama (Games/poulpi/game.swf) pour le portage natif.
//
//   node scripts/extract-jamajama-sprites.js            → public/jamajama/sprites/ + fontes/
//   node scripts/extract-jamajama-sprites.js --liste    → montre ce qui serait extrait
//
// Le fichier est du VECTEUR PUR — pas une image matricielle, pas un son : 564
// formes, 212 clips, 9 fontes embarquées, 29 textes figés, 59 champs, 27
// boutons. On sort donc des SVG (nets à toute échelle), un manifeste qui dit
// comment les composer, et les fontes en WOFF.
//
// ── Ce que ce fichier fait de plus que les extracteurs précédents ──
//
// L'APLATISSEMENT SUIT LA LIGNE DE TEMPS. aplatir() de swf-sprites.js envoie
// les clips imbriqués sur l'image du parent — il suffisait à Minipixiz, dont
// les deux niveaux avancent de concert. Mais les personnages de JamaJama sont
// des emboîtements qui vivent chacun leur vie : dans « moveSouth » de Louki,
// les pattes sont un clip posé À l'image 2 du parent et qui joue depuis SA
// première image. Le lecteur Flash tient pour chaque objet posé l'image où il
// est NÉ, et le fait boucler sur sa propre longueur. C'est ce qu'on refait :
// l'image locale d'un enfant est ((image du parent − naissance) mod longueur).
//
// Les TEXTES FIGÉS (DefineText) sortent en SVG par les contours de la fonte
// embarquée — le lettrage du menu est celui de 2005, au twip près. Les CHAMPS
// (DefineEditText) ne se dessinent pas : leur géométrie, fonte, couleur et
// alignement partent dans le manifeste, et le client écrira dedans avec les
// WOFF. Les BOUTONS (DefineButton2) deviennent des entrées à trois états
// (repos, survol, appui) plus leur zone cliquable ; là où un bouton est posé
// dans un écran, le manifeste met un RENVOI plutôt qu'un dessin, pour que le
// client puisse jouer le survol.
//
// Les MASQUES restent des fenêtres : la pièce marquée `masque` ne se dessine
// pas, elle borne les pièces qui portent son numéro (`msq`) — les listes de
// niveaux défilent derrière jama_gui_barMask, l'eau découpe la caisse qui y
// tombe.
//
// Les enfants NOMMÉS à plusieurs images deviennent des RENVOIS `{clip, frame}`
// plutôt que des dessins fondus dans le parent. C'est le nom qui fait la
// frontière : tout ce que l'ActionScript pilote, il l'atteint par un nom —
// `subMc = mc.j` puis `j.gotoAndStop(param)` choisit le fruit, l'orientation
// du héros, la case de l'autotile de l'eau ; `mc.mask.gotoAndStop(2)`,
// `but.text.gotoAndStop(id)`, `icon`, `prev`, `star1`… Fondre ces clips
// figerait leur première image dans le parent. Le renvoi porte quand même
// l'image que la ligne de temps donnerait (les pattes de Louki avancent avec
// la marche) : le client la dessine telle quelle, sauf quand le jeu pilote.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir, composer, IDENTITE } = require('./lib/swf-sprites.js');
const { lireTextes } = require('./lib/swf-texte.js');

const RACINE = path.join(__dirname, '..');
const SOURCE = path.join(RACINE, 'Games/poulpi/game.swf');
const SORTIE = path.join(RACINE, 'public/jamajama');

const swf = ouvrir(SOURCE);
const b = swf.b;
const textes = lireTextes(swf);

// ── Les fontes : les sept embarquées partent en WOFF, les deux « machine »
// (zéro glyphe : le SWF dit seulement « écris en Verdana ») deviennent une
// pile de familles système. Les familles portent un préfixe pour ne pas se
// faire voler la vedette par la Verdana de la machine du joueur.
const FONTES = {
  63: { famille: 'Jama Verdana', fichier: 'verdana.woff' },
  106: { famille: 'Jama SkaterDudes', fichier: 'skaterdudes.woff' },
  308: { famille: 'Jama Pricedown', fichier: 'pricedown.woff' },
  403: { famille: 'Jama Jester', fichier: 'jester.woff' },
  410: { famille: 'Jama Arial', fichier: 'arial.woff' },
  532: { famille: 'Jama VerdanaPixel', fichier: 'verdanapx.woff' },
  785: { famille: 'Jama Verdana12', fichier: 'verdana12.woff' },
  11: { systeme: 'Verdana, Geneva, sans-serif' },
  496: { systeme: 'Verdana, Geneva, sans-serif' },
};

// ── Boutons (DefineButton2, tag 34) ──
class Bits {
  constructor(o) { this.o = o; this.bit = 0; }
  u(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((b[this.o] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.o++; }
    }
    return v >>> 0;
  }
  s(n) { if (!n) return 0; const v = this.u(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
  aligner() { if (this.bit) { this.bit = 0; this.o++; } return this.o; }
}
function lireMatriceA(o) {
  const m = new Bits(o);
  const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (m.u(1)) { const n = m.u(5); M.a = m.s(n) / 65536; M.d = m.s(n) / 65536; }
  if (m.u(1)) { const n = m.u(5); M.b = m.s(n) / 65536; M.c = m.s(n) / 65536; }
  const n = m.u(5); M.e = m.s(n); M.f = m.s(n);
  return { M, fin: m.aligner() };
}
const boutons = new Map();
swf.parcourir((code, corps, len) => {
  if (code !== 34) return;
  const id = b.readUInt16LE(corps);
  let o = corps + 5;                                   // drapeaux + ActionOffset
  const recs = [];
  for (;;) {
    const fl = b[o];
    if (fl === 0) break;
    o += 1;
    const ch = b.readUInt16LE(o); o += 2;
    const prof = b.readUInt16LE(o); o += 2;
    const m = lireMatriceA(o); o = m.fin;
    const c = new Bits(o);                             // CXFORMWITHALPHA
    const add = c.u(1), mult = c.u(1), nb = c.u(4);
    const cx = { mr: 256, mv: 256, mb: 256, ma: 256, ar: 0, av: 0, ab: 0, aa: 0 };
    if (mult) { cx.mr = c.s(nb); cx.mv = c.s(nb); cx.mb = c.s(nb); cx.ma = c.s(nb); }
    if (add) { cx.ar = c.s(nb); cx.av = c.s(nb); cx.ab = c.s(nb); cx.aa = c.s(nb); }
    o = c.aligner();
    recs.push({
      up: !!(fl & 1), over: !!(fl & 2), down: !!(fl & 4), hit: !!(fl & 8),
      ch, prof, M: m.M, cx: swf.cxNeutre(cx) ? null : cx,
    });
  }
  boutons.set(id, recs);
});

// ── Étiquettes d'images (FrameLabel 43), par clip ──
const etiquettes = new Map();
swf.parcourir((code, corps, len, id, frame) => {
  if (code !== 43 || !id) return;
  let e = corps; while (b[e] !== 0) e++;
  if (!etiquettes.has(id)) etiquettes.set(id, {});
  etiquettes.get(id)[b.slice(corps, e).toString('latin1')] = frame;
});

// ── Le cadre déclaré de chaque forme : c'est le viewBox que
// extract-swf-shapes.js écrira, on l'a donc sans relire les fichiers ──
const bornesFormes = new Map();
swf.parcourir((code, corps) => {
  if (![2, 22, 32, 83].includes(code)) return;
  const id = b.readUInt16LE(corps);
  const r = new Bits(corps + 2);
  const n = r.u(5);
  const x0 = r.s(n) / 20, x1 = r.s(n) / 20, y0 = r.s(n) / 20, y1 = r.s(n) / 20;
  bornesFormes.set(id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
});

// ── La ligne de temps : longueur de chaque clip, et index image → profondeur ──
const index = new Map();                               // clip → frame → prof → placement
const longueurs = new Map();
for (const [id, frames] of swf.parSprite) {
  const parImage = new Map();
  for (const [f, liste] of frames) {
    const m = new Map();
    for (const p of liste) m.set(p.prof, p);
    parImage.set(f, m);
  }
  index.set(id, parImage);
  longueurs.set(id, Math.max(...frames.keys()));
}

/** L'image où l'objet posé en (clip, profondeur) est né, en remontant tant que
 *  la même tête d'affiche occupe la profondeur. */
function naissance(clip, prof, frame) {
  const parImage = index.get(clip);
  const ch = parImage.get(frame).get(prof).ch;
  let f = frame;
  while (f > 1) {
    const avant = parImage.get(f - 1);
    if (!avant || !avant.has(prof) || avant.get(prof).ch !== ch) break;
    f--;
  }
  return f;
}

// Le nom d'auteur de chaque identifiant, pour que les renvois parlent la même
// langue que le reste du manifeste (`jama_Star` plutôt que `clip852`).
const nomDe = new Map();
for (const [nom, id] of swf.noms) if (!/^__Packages/.test(nom)) nomDe.set(id, nom);
const cleDe = (ch) => nomDe.get(ch) || ((boutons.has(ch) ? 'bouton' : 'clip') + ch);
const renvoisAExtraire = new Set();

/**
 * Aplatit `ch` à son image `frame`, matrices et transformations de couleur
 * composées, en suivant la ligne de temps (voir l'en-tête). Retourne des
 * pièces de cinq natures : {shape}, {texte} (figé), {edit} (champ, renvoi),
 * {bouton} (renvoi), {clip} (enfant nommé piloté, renvoi avec image). Les
 * masques posent `masque`+`num` sur leur pièce et `msq` sur les pièces qu'ils
 * fenêtrent.
 */
function aplatirVif(ch, M, cx, frame, chemin, profondeur, compteurMasques) {
  if (profondeur > 8) return [];
  if (swf.estForme(ch)) return [{ shape: ch, M, cx, chemin }];
  if (textes.statiques.has(ch)) return [{ texte: ch, M, cx, chemin }];
  if (textes.dynamiques.has(ch)) return [{ edit: ch, M, cx, chemin }];
  if (boutons.has(ch)) { renvoisAExtraire.add(ch); return [{ bouton: ch, M, cx, chemin }]; }
  if (!swf.estSprite(ch)) return [];
  const parImage = index.get(ch);
  if (!parImage) return [];
  const longueur = longueurs.get(ch);
  let f = ((frame - 1) % longueur) + 1;
  // Une image sans photographie (vide ou clairsemée) : la dernière connue fait
  // foi, comme la liste d'affichage du lecteur.
  while (f > 1 && !parImage.has(f)) f--;
  if (!parImage.has(f)) return [];
  const out = [];
  let masqueOuvert = null;
  const profs = [...parImage.get(f).keys()].sort((a, c) => a - c);
  for (const prof of profs) {
    const p = parImage.get(f).get(prof);
    if (masqueOuvert && prof > masqueOuvert.clip) masqueOuvert = null;
    const sous = p.nom ? (chemin ? chemin + '.' + p.nom : p.nom) : chemin;
    const fLocal = f - naissance(ch, prof, f) + 1;
    let morceaux;
    if (p.nom && swf.estSprite(p.ch) && (longueurs.get(p.ch) || 1) > 1) {
      // Enfant nommé et animé : un renvoi, avec l'image que la ligne de temps
      // lui donnerait ici — voir l'en-tête.
      renvoisAExtraire.add(p.ch);
      morceaux = [{ clip: p.ch, frame: ((fLocal - 1) % longueurs.get(p.ch)) + 1,
        M: composer(M, p.M), cx: swf.composerCouleur(cx, p.cx), chemin: sous }];
    } else {
      morceaux = aplatirVif(p.ch, composer(M, p.M), swf.composerCouleur(cx, p.cx),
        fLocal, sous, profondeur + 1, compteurMasques);
    }
    if (p.masque) {
      masqueOuvert = { clip: p.masque, num: ++compteurMasques.n };
      for (const m of morceaux) { m.masque = true; m.num = masqueOuvert.num; }
    } else if (masqueOuvert) {
      for (const m of morceaux) if (!m.masque) m.msq = masqueOuvert.num;
    }
    out.push(...morceaux);
  }
  return out;
}

// ── Le cadre d'une pièce, et d'un caractère entier (pour les zones de clic) ──
const arr = (v) => Math.round(v * 1e4) / 1e4;
function borneDe(pc) {
  if (pc.shape !== undefined) return bornesFormes.get(pc.shape);
  if (pc.texte !== undefined) {
    const t = textes.statiques.get(pc.texte).bounds;
    return { x: t.x0 / 20, y: t.y0 / 20, w: (t.x1 - t.x0) / 20, h: (t.y1 - t.y0) / 20 };
  }
  if (pc.edit !== undefined) return textes.dynamiques.get(pc.edit).rect;
  if (pc.clip !== undefined) return cadreClip(pc.clip, pc.frame || 1);
  return null;
}
// Le cadre local d'un clip à une image donnée — il faut le connaître quand un
// RENVOI sert de masque (la découpe de l'eau) ou de zone de clic.
const cadresClips = new Map();
function cadreClip(ch, f) {
  const cle = ch + ':' + f;
  if (cadresClips.has(cle)) return cadresClips.get(cle);
  cadresClips.set(cle, null);                    // coupe une récursion pathologique
  const pieces = aplatirVif(ch, IDENTITE, null, f, '', 0, { n: 0 });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pc of pieces) {
    const c = borneDe(pc);
    if (!c) continue;
    const t = cadreTransforme(c, pc.M);
    x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
  }
  const r = x0 === Infinity ? null
    : { x: arr(x0), y: arr(y0), w: arr(x1 - x0), h: arr(y1 - y0) };
  cadresClips.set(cle, r);
  return r;
}
function cadreTransforme(c, M) {
  const coin = (x, y) => [M.a * x + M.c * y + M.e / 20, M.b * x + M.d * y + M.f / 20];
  const pts = [coin(c.x, c.y), coin(c.x + c.w, c.y), coin(c.x, c.y + c.h), coin(c.x + c.w, c.y + c.h)];
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return { x: arr(Math.min(...xs)), y: arr(Math.min(...ys)),
    w: arr(Math.max(...xs) - Math.min(...xs)), h: arr(Math.max(...ys) - Math.min(...ys)) };
}
function cadreCaractere(ch, M) {
  const pieces = aplatirVif(ch, M, null, 1, '', 0, { n: 0 });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pc of pieces) {
    const c = borneDe(pc);
    if (!c) continue;
    const t = cadreTransforme(c, pc.M);
    x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
  }
  if (x0 === Infinity) return null;
  return { x: arr(x0), y: arr(y0), w: arr(x1 - x0), h: arr(y1 - y0) };
}

// ── Une liste de pièces brutes → les entrées du manifeste ──
const formesVoulues = new Set();
const textesVoulus = new Set();
function versManifeste(brutes) {
  const pieces = [];
  const masques = [];
  for (const pc of brutes) {
    const M6 = [pc.M.a, pc.M.b, pc.M.c, pc.M.d, pc.M.e / 20, pc.M.f / 20].map(arr);
    const commun = { m: M6 };
    if (pc.chemin) commun.nom = pc.chemin;
    if (pc.cx && !swf.cxNeutre(pc.cx)) {
      commun.cx = [pc.cx.mr, pc.cx.mv, pc.cx.mb, pc.cx.ma,
        pc.cx.ar, pc.cx.av, pc.cx.ab, pc.cx.aa].map(arr);
    }
    if (pc.edit !== undefined) {
      pieces.push(Object.assign({ champ: pc.edit }, commun, pc.msq ? { msq: pc.msq } : null));
      continue;
    }
    if (pc.bouton !== undefined) {
      pieces.push(Object.assign({ bouton: cleDe(pc.bouton) }, commun, pc.msq ? { msq: pc.msq } : null));
      continue;
    }
    if (pc.clip !== undefined) {
      const entree = Object.assign({ clip: cleDe(pc.clip), frame: pc.frame }, commun);
      if (pc.masque) {
        // Un renvoi qui découpe (le voile de l'eau) : sa fenêtre est le cadre
        // de son image courante.
        const c = cadreClip(pc.clip, pc.frame);
        if (c) masques.push(Object.assign(cadreTransforme(c, pc.M), { num: pc.num }));
        continue;
      }
      if (pc.msq) entree.msq = pc.msq;
      pieces.push(entree);
      continue;
    }
    const c = borneDe(pc);
    if (!c) continue;
    const cadre = cadreTransforme(c, pc.M);
    const fichier = pc.shape !== undefined ? `shape${pc.shape}.svg` : `texte${pc.texte}.svg`;
    if (pc.shape !== undefined) formesVoulues.add(pc.shape); else textesVoulus.add(pc.texte);
    const entree = Object.assign({ fichier }, cadre,
      { vb: [arr(c.x), arr(c.y), arr(c.w), arr(c.h)] }, commun);
    if (pc.masque) { masques.push(Object.assign(entree, { num: pc.num })); continue; }
    if (pc.msq) entree.msq = pc.msq;
    pieces.push(entree);
  }
  const etat = { pieces };
  // Les fenêtres : le client borne les pièces `msq=n` au cadre de la fenêtre n.
  if (masques.length) {
    etat.fenetres = masques.map((m) => ({ num: m.num, x: m.x, y: m.y, w: m.w, h: m.h }));
  }
  return etat;
}

// ── Les cibles : tous les symboles d'auteur, hors classes et rouages ──
const CIBLES = [];
for (const [nom, id] of swf.noms) {
  if (/^__Packages|^code$|^importer$/.test(nom)) continue;
  CIBLES.push({ nom, id });
}
CIBLES.sort((a, c) => a.id - c.id);

const manifeste = {};
const idsExtraits = new Set();
let nEtats = 0;
function extraireCible(nom, id) {
  if (idsExtraits.has(id)) return;
  idsExtraits.add(id);
  const entree = { id };
  if (boutons.has(id)) {
    // Un bouton : repos / survol / appui, puis la zone de clic (l'état `hit`,
    // invisible dans Flash, ne sert qu'à ça).
    const recs = boutons.get(id);
    const etats = [];
    for (const [i, etatNom] of [['up', 1], ['over', 2], ['down', 3]].map(([e, f]) => [f, e])) {
      const compteur = { n: 0 };
      const brutes = [];
      for (const r of recs.filter((r) => r[etatNom]).sort((a, c) => a.prof - c.prof)) {
        brutes.push(...aplatirVif(r.ch, r.M, r.cx, 1, '', 0, compteur));
      }
      etats.push(Object.assign({ frame: i }, versManifeste(brutes)));
    }
    entree.etats = etats;
    let hit = null;
    for (const r of recs.filter((r) => r.hit)) {
      const c = cadreCaractere(r.ch, r.M);
      if (!c) continue;
      hit = hit ? {
        x: Math.min(hit.x, c.x), y: Math.min(hit.y, c.y),
        w: Math.max(hit.x + hit.w, c.x + c.w) - Math.min(hit.x, c.x),
        h: Math.max(hit.y + hit.h, c.y + c.h) - Math.min(hit.y, c.y),
      } : c;
    }
    if (hit) entree.hit = { x: arr(hit.x), y: arr(hit.y), w: arr(hit.w), h: arr(hit.h) };
    entree.bouton = true;
  } else if (swf.estSprite(id)) {
    const frames = [...(swf.parSprite.get(id) || new Map()).keys()].sort((a, c) => a - c);
    entree.etats = frames.map((f) => {
      const compteur = { n: 0 };
      return Object.assign({ frame: f },
        versManifeste(aplatirVif(id, IDENTITE, null, f, '', 0, compteur)));
    });
    if (etiquettes.has(id)) entree.etiquettes = etiquettes.get(id);
  } else if (swf.estForme(id) || textes.statiques.has(id)) {
    entree.etats = [Object.assign({ frame: 1 },
      versManifeste(aplatirVif(id, IDENTITE, null, 1, '', 0, { n: 0 })))];
  } else {
    return;
  }
  entree.etats = entree.etats.filter((e) => e.pieces.length);
  // Un bouton sans dessin garde sa place : sa zone de clic est tout son emploi
  // (l'article du menu n'est qu'une zone posée sur le libellé).
  if (!entree.etats.length && !(entree.bouton && entree.hit)) return;
  nEtats += entree.etats.length;
  manifeste[nom] = entree;
}
for (const { nom, id } of CIBLES) extraireCible(nom, id);
// Les clips atteints par renvoi — et ceux qu'eux-mêmes renvoient, de proche en
// proche (l'œil renvoie à sa paupière, qui renvoie à son iris).
for (;;) {
  const restants = [...renvoisAExtraire].filter((id) => !idsExtraits.has(id));
  if (!restants.length) break;
  for (const id of restants) extraireCible(cleDe(id), id);
}

// ── Les champs : tout ce que le client doit savoir pour écrire dedans ──
const champs = {};
for (const [id, t] of textes.dynamiques) {
  const fonte = FONTES[t.fonte] || {};
  champs[id] = {
    rect: t.rect,
    fonte: fonte.famille || fonte.systeme || 'sans-serif',
    embarquee: !!fonte.fichier,
    taille: t.taille, couleur: t.couleur,
    align: t.align, interligne: t.interligne,
    wrap: t.wrap, multiligne: t.multiligne,
    variable: t.variable || undefined,
    texte: t.texte || undefined,
  };
  if (t.alpha < 1) champs[id].alpha = arr(t.alpha);
}

if (process.argv.includes('--liste')) {
  for (const [nom, m] of Object.entries(manifeste)) {
    const e = m.etats;
    console.log(`  #${String(m.id).padStart(3)} ${nom.padEnd(32)} ${e.length} état(s), `
      + `${e.reduce((n, x) => n + x.pieces.length, 0)} pièces`
      + (m.bouton ? ' [bouton]' : '')
      + (m.etiquettes ? ' {' + Object.keys(m.etiquettes).join(',') + '}' : ''));
  }
  console.log(`${Object.keys(manifeste).length} symboles, ${nEtats} états, `
    + `${formesVoulues.size} formes, ${textesVoulus.size} textes figés, `
    + `${Object.keys(champs).length} champs`);
  process.exit(0);
}

fs.mkdirSync(path.join(SORTIE, 'sprites'), { recursive: true });
fs.mkdirSync(path.join(SORTIE, 'fontes'), { recursive: true });

// Les formes, par l'extracteur commun (il écrit shapeN.svg).
const brut = execFileSync(process.execPath,
  [path.join(__dirname, 'extract-swf-shapes.js'), SOURCE, path.join(SORTIE, 'sprites'),
    ...[...formesVoulues].map(String)],
  { cwd: RACINE, encoding: 'utf8', maxBuffer: 128e6 });
const ecrites = new Set([...brut.matchAll(/^#(\d+) → /gm)].map((m) => Number(m[1])));
const perdues = [...formesVoulues].filter((id) => !ecrites.has(id));
if (perdues.length) console.log('formes perdues : ' + perdues.join(', '));

// Les textes figés, par les contours des fontes embarquées.
for (const id of textesVoulus) {
  const svg = textes.svgStatique(id);
  if (!svg) { console.log(`texte perdu : #${id}`); continue; }
  fs.writeFileSync(path.join(SORTIE, 'sprites', `texte${id}.svg`), svg, 'utf8');
}

// Les fontes embarquées, en WOFF.
for (const [id, f] of Object.entries(FONTES)) {
  if (!f.fichier) continue;
  execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-font.js'), SOURCE, String(id),
      path.join(SORTIE, 'fontes', f.fichier), f.famille],
    { cwd: RACINE, encoding: 'utf8' });
}

// Le PAQUET : tous les dessins dans un seul fichier. Cinq cents SVG de un ko,
// c'est cinq cents allers-retours pour un téléphone ; en un JSON, c'est un
// seul — et le serveur le compresse d'un bloc.
const paquet = {};
for (const f of fs.readdirSync(path.join(SORTIE, 'sprites'))) {
  if (f.endsWith('.svg')) paquet[f] = fs.readFileSync(path.join(SORTIE, 'sprites', f), 'utf8');
}
fs.writeFileSync(path.join(SORTIE, 'sprites', 'paquet.json'), JSON.stringify(paquet), 'utf8');

const dest = path.join(SORTIE, 'sprites', 'sprites.json');
fs.writeFileSync(dest, JSON.stringify({ symboles: manifeste, champs, fontes: FONTES }), 'utf8');
console.log(`→ ${path.relative(RACINE, dest)} : ${Object.keys(manifeste).length} symboles, `
  + `${nEtats} états, ${formesVoulues.size} formes, ${textesVoulus.size} textes, `
  + `${Object.keys(champs).length} champs, `
  + `${Object.values(FONTES).filter((f) => f.fichier).length} fontes`);
