#!/usr/bin/env node
// Redessine en anglais les TEXTES FIGÉS de JamaJama (Games/poulpi/game.swf).
//
//   node scripts/build-jamajama-anglais.js            → public/jamajama/sprites/paquet-en.json
//   node scripts/build-jamajama-anglais.js --verifier → mesure seulement (avances, fontes)
//
// Le jeu écrit la plupart de ses textes dans des champs (le client les remplit,
// lang/en.js les traduit). Restent les textes que le SWF a FIGÉS : des
// DefineText (le lettrage du menu en SkaterDudes, les titres des fenêtres de
// l'éditeur en Jester) et quelques formes qui sont du texte vectorisé (le
// bouton « JOUER » du parchemin, la barre de menu de l'éditeur, les halos des
// articles du menu). Le paquet anglais leur donne un remplaçant, fichier pour
// fichier : { "texte107.svg": { vb, svg }, … }. Le rendu (rendu.js) le charge
// en anglais seulement et dessine le remplaçant à la place de l'original, dans
// SON cadre (vb) : un mot anglais n'a pas la largeur du mot français.
//
// ── LES FONTES ──
//
// Les remplaçants s'écrivent avec les contours des fontes EMBARQUÉES du SWF,
// au glyphe près — c'est le lettrage de 2005, pas une imitation :
//
//   · SkaterDudes, celle du menu, n'a que dix-sept glyphes dans game.swf
//     (« ATadeijmnopqrstuv »). L'intro du jeu (Games/poulpi/intro (1).swf,
//     la même que frusion/jama.swf) en embarque vingt, avec C, g, h et l.
//     Réunies, les deux tables écrivent « help » — mais toujours ni « y » ni
//     « c » : les mots anglais du menu sont choisis pour s'écrire avec elles
//     (« stats » et non « statistics », « start » pour « jouer », « restart »
//     pour « rejouer »). Le script vérifie que chaque glyphe existe, et que
//     les glyphes communs aux deux fichiers sont bien les mêmes ;
//   · Jester est complète (l'ASCII) : les titres et les boutons de l'éditeur ;
//   · Verdana aussi (482 glyphes).
//
// Les avances sont celles de la table de mise en page de la fonte
// (DefineFont2, FontAdvanceTable, et le crénage s'il y en a) ; le mot anglais
// prend la place du mot français : même ligne de base, même centre (ou même
// départ, pour un texte calé à gauche).

'use strict';

const fs = require('fs');
const path = require('path');
const { ouvrir } = require('./lib/swf-sprites.js');
const { lireTextes } = require('./lib/swf-texte.js');

const RACINE = path.join(__dirname, '..');
const SPRITES = path.join(RACINE, 'public/jamajama/sprites');
const SORTIE = path.join(SPRITES, 'paquet-en.json');
const VERIFIER = process.argv.includes('--verifier');

const jeu = ouvrir(path.join(RACINE, 'Games/poulpi/game.swf'));
const intro = ouvrir(path.join(RACINE, 'Games/poulpi/intro (1).swf'));
const textesJeu = lireTextes(jeu);
const textesIntro = lireTextes(intro);
const MANIFESTE = JSON.parse(fs.readFileSync(path.join(SPRITES, 'sprites.json'), 'utf8'));

const arr = (v) => Math.round(v * 1000) / 1000;

// ── La table de mise en page d'une DefineFont2 (avances, crénage) ──
//
// swf-texte.js lit les contours et la table des codes ; la mise en page vient
// après : ascendante, descendante, interligne, une avance par glyphe, un cadre
// par glyphe (RECT alignés sur l'octet), puis les paires de crénage.
function lireMiseEnPage(swf, id) {
  const b = swf.b;
  let resultat = null;
  swf.parcourir((code, corps) => {
    if (code !== 48 || b.readUInt16LE(corps) !== id) return;
    const drapeaux = b[corps + 2];
    const avecMiseEnPage = !!(drapeaux & 0x80);
    const larges = !!(drapeaux & 0x08), codesLarges = !!(drapeaux & 0x04);
    const lg = b[corps + 4];
    let o = corps + 5 + lg;
    const nb = b.readUInt16LE(o); o += 2;
    const base = o;
    const finTable = larges ? b.readUInt32LE(base + nb * 4) : b.readUInt16LE(base + nb * 2);
    o = base + finTable + nb * (codesLarges ? 2 : 1);
    if (!avecMiseEnPage) { resultat = { avances: null, crenage: new Map() }; return; }
    const ascendante = b.readUInt16LE(o); o += 2;
    const descendante = b.readUInt16LE(o); o += 2;
    o += 2;                                           // l'interligne
    const avances = [];
    for (let i = 0; i < nb; i++) { avances.push(b.readInt16LE(o)); o += 2; }
    for (let i = 0; i < nb; i++) {                    // les cadres : on les saute
      const n = b[o] >> 3;
      o += Math.ceil((5 + 4 * n) / 8);
    }
    const crenage = new Map();
    const nk = b.readUInt16LE(o); o += 2;
    for (let i = 0; i < nk; i++) {
      const c1 = codesLarges ? b.readUInt16LE(o) : b[o]; o += codesLarges ? 2 : 1;
      const c2 = codesLarges ? b.readUInt16LE(o) : b[o]; o += codesLarges ? 2 : 1;
      crenage.set(c1 + ',' + c2, b.readInt16LE(o)); o += 2;
    }
    resultat = { ascendante, descendante, avances, crenage };
  });
  return resultat;
}

// Les avances relevées dans les textes figés eux-mêmes : chaque glyphe d'un
// DefineText porte la sienne (en twips, à la taille du texte). Une fonte
// embarquée pour des textes figés seulement — SkaterDudes — n'a pas de table
// de mise en page : ce sont alors les seules avances qu'on ait.
function avancesDesTextes(textes, id) {
  const vues = new Map();
  for (const t of textes.statiques.values()) {
    for (const run of t.runs) {
      if (run.fonte !== id) continue;
      const f = textes.fontes.get(id);
      run.glyphes.forEach((g, i) => {
        const suivant = run.glyphes[i + 1];
        if (!suivant) return;                          // la dernière : sans voisine, pas d'avance sûre
        const c = f.codes[g.idx];
        const av = (suivant.x - g.x) * 1024 / run.taille;
        if (!vues.has(c)) vues.set(c, []);
        vues.get(c).push(av);
      });
    }
  }
  const avances = new Map();
  for (const [c, l] of vues) avances.set(c, l.sort((a, b) => a - b)[Math.floor(l.length / 2)]);
  return avances;
}

// Une fonte prête à écrire : code → { d (contour, em de 1024), avance }.
// L'avance vient de la table de mise en page quand la fonte en a une, sinon
// des textes figés qui l'emploient.
function fonte(swf, textes, id) {
  const f = textes.fontes.get(id);
  const mp = lireMiseEnPage(swf, id);
  const releves = avancesDesTextes(textes, id);
  const glyphes = new Map();
  f.codes.forEach((c, i) => glyphes.set(c, {
    d: f.glyphes[i],
    avance: mp.avances ? mp.avances[i] : releves.get(c),
  }));
  return { nom: f.nom, glyphes, crenage: mp.crenage, table: !!mp.avances };
}

// SkaterDudes : la table du jeu, complétée par celle de l'intro. Les deux
// fichiers n'ont pas été compilés ensemble : Flash a requantifié les contours
// à quelques unités près (sur 1024), mais c'est la même fonte. On le vérifie
// sur les glyphes communs — même avance, même cadre à 2 % de l'em près — et
// l'on ne prend à l'intro que ce qui manque au jeu (C, g, h, l).
const skaterJeu = fonte(jeu, textesJeu, 106);
const skaterIntro = fonte(intro, textesIntro, 204);
const SKATER = { nom: 'SkaterDudes', glyphes: new Map(skaterJeu.glyphes), crenage: skaterJeu.crenage };
const cadreEm = (d) => {
  const n = d.match(/-?\d+/g).map(Number);
  const xs = n.filter((v, i) => i % 2 === 0), ys = n.filter((v, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
for (const [c, g] of skaterIntro.glyphes) {
  const deja = SKATER.glyphes.get(c);
  if (deja) {
    const a = cadreEm(deja.d), b = cadreEm(g.d);
    const ecart = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const avances = deja.avance != null && g.avance != null;
    if ((avances && Math.abs(deja.avance - g.avance) > 12) || ecart > 20) {
      throw new Error('SkaterDudes : le glyphe « ' + String.fromCharCode(c) + ' » n’est pas le même dans game.swf et l’intro');
    }
    // Une avance que les textes du jeu ne donnent pas, ceux de l'intro peut-être.
    if (deja.avance == null) SKATER.glyphes.set(c, { d: deja.d, avance: g.avance });
  } else SKATER.glyphes.set(c, g);
}
const JESTER = fonte(jeu, textesJeu, 403);
const VERDANA = fonte(jeu, textesJeu, 63);

// La mise en ligne d'un texte : chaque glyphe à sa plume, et la largeur.
function ligne(f, texte, taille) {
  const k = taille / 1024;
  const glyphes = [];
  let x = 0;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    const g = f.glyphes.get(c);
    if (!g) throw new Error(f.nom + ' n’a pas le glyphe « ' + texte[i] + ' » (dans « ' + texte + ' »)');
    if (g.avance == null) throw new Error(f.nom + ' : aucune avance connue pour « ' + texte[i] + ' »');
    if (g.d) glyphes.push({ d: g.d, x });
    x += g.avance * k;
    if (i + 1 < texte.length) x += (f.crenage.get(c + ',' + texte.charCodeAt(i + 1)) || 0) * k;
  }
  return { glyphes, largeur: x, k };
}

// Le cadre (approché par les points du tracé, poignées comprises : un peu
// large, jamais trop étroit) d'un glyphe posé.
function cadreGlyphe(d, x, y, k) {
  const n = d.match(/-?\d+(\.\d+)?/g) || [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) {
    const px = x + Number(n[i]) * k, py = y + Number(n[i + 1]) * k;
    if (px < x0) x0 = px; if (px > x1) x1 = px;
    if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  return { x0, y0, x1, y1 };
}

// Les morceaux d'un dessin : des glyphes posés, avec leur couleur (et un
// trait pour les halos).
function poser(f, texte, taille, x, y, style) {
  const l = ligne(f, texte, taille);
  return l.glyphes.map((g) => Object.assign({ d: g.d, x: x + g.x, y, k: l.k }, style));
}

function svgDe(morceaux, marge, avant, apres, vbImpose) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let corps = '';
  for (const m of morceaux) {
    const c = cadreGlyphe(m.d, m.x, m.y, m.k);
    const e = (m.trait || 0) / 2;
    x0 = Math.min(x0, c.x0 - e); y0 = Math.min(y0, c.y0 - e);
    x1 = Math.max(x1, c.x1 + e); y1 = Math.max(y1, c.y1 + e);
    const trait = m.trait
      ? ` stroke="${m.couleur}" stroke-width="${arr(m.trait / m.k)}" stroke-linejoin="round" stroke-linecap="round"`
      : '';
    corps += `  <path transform="translate(${arr(m.x)} ${arr(m.y)}) scale(${arr(m.k * 1e4) / 1e4})"`
      + ` d="${m.d}" fill="${m.couleur}"${trait}/>\n`;
  }
  const vb = vbImpose || [arr(x0 - marge), arr(y0 - marge), arr(x1 - x0 + 2 * marge), arr(y1 - y0 + 2 * marge)];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}">\n`
    + (avant || '') + corps + (apres || '') + '</svg>\n';
  return { vb, svg };
}

// Le texte figé d'origine : sa chaîne, sa fonte, sa taille, sa couleur, sa
// ligne de base, le départ et la largeur de chaque ligne (les avances du
// fichier, telles que Flash les a posées).
function figeOrigine(id) {
  const t = textesJeu.statiques.get(id);
  const lignes = [];
  for (const run of t.runs) {
    const f = textesJeu.fontes.get(run.fonte);
    const y = run.y / 20;
    let l = lignes.find((q) => q.y === y);
    if (!l) { l = { y, texte: '', x0: Infinity, x1: -Infinity }; lignes.push(l); }
    for (const g of run.glyphes) {
      const c = f.codes[g.idx];
      const av = (f === textesJeu.fontes.get(106) ? skaterJeu : f === textesJeu.fontes.get(403) ? JESTER : VERDANA)
        .glyphes.get(c).avance * (run.taille / 20) / 1024;
      l.texte += String.fromCharCode(c);
      l.x0 = Math.min(l.x0, g.x / 20);
      l.x1 = Math.max(l.x1, g.x / 20 + av);
    }
    l.taille = run.taille / 20;
    l.couleur = run.couleur;
  }
  return { id, lignes, bounds: t.bounds };
}

// ── Ce qu'on redessine ──────────────────────────────────────────────────────

const PAQUET = {};
const RAPPORT = [];

// 1. Le lettrage du menu (clip130, SkaterDudes 20) : centré sur le mot français.
const MENU = [
  [107, 'tournament'], [109, 'Adventure'], [111, 'Arena'], [113, 'editor'],
  [115, 'stats'], [117, 'help'], [122, 'start'], [124, 'edit'], [126, 'restart'],
  // 119 « options », 121 « Test », 128 « menu » : les mêmes mots en anglais.
];
// Les halos des articles (jama_Menu_ButtonBackground, une forme par article) :
// la silhouette du mot, élargie, couleur #b99966, posée sous le lettrage dans
// le repère du bouton (le lettrage y est décalé par la matrice de clip130).
const HALOS = { 107: 'shape864.svg', 109: 'shape865.svg', 111: 'shape866.svg', 113: 'shape867.svg',
  115: 'shape868.svg', 117: 'shape869.svg' };
const HALO_COULEUR = '#b99966';
const HALO_TRAIT = 6.6;          // deux fois l'écart relevé entre le mot et son halo d'origine

function matriceDansClip130(fichier) {
  for (const e of MANIFESTE.symboles.clip130.etats) {
    for (const p of e.pieces) if (p.fichier === fichier) return p.m;
  }
  return [1, 0, 0, 1, 0, 0];
}

for (const [id, en] of MENU) {
  const o = figeOrigine(id);
  const l = o.lignes[0];
  const centre = (l.x0 + l.x1) / 2;
  const largeur = ligne(SKATER, en, l.taille).largeur;
  const x = centre - largeur / 2;
  const morceaux = poser(SKATER, en, l.taille, x, l.y, { couleur: l.couleur });
  PAQUET[`texte${id}.svg`] = svgDe(morceaux, 0.5);
  RAPPORT.push(`texte${id} « ${l.texte} » → « ${en} » (SkaterDudes ${l.taille}, centre ${arr(centre)})`);
  if (HALOS[id]) {
    const m = matriceDansClip130(`texte${id}.svg`);
    const halo = poser(SKATER, en, l.taille, x + m[4], l.y + m[5], { couleur: HALO_COULEUR, trait: HALO_TRAIT });
    PAQUET[HALOS[id]] = svgDe(halo, 0.5);
    RAPPORT.push(`${HALOS[id]} : le halo de « ${en} »`);
  }
}

// 2. Les titres et les phrases de l'éditeur (Jester) : centrés ligne à ligne,
//    ou calés à gauche (le bouton « tester »).
const JESTERS = [
  [436, ['Level size']],
  [445, ['Level title']],
  [450, ['Level order']],
  [451, ['Drag the settings to change the order', 'in which the levels are listed.']],
  [452, ['The + and - buttons choose the sort', 'order for each setting.']],
];
for (const [id, lignesEn] of JESTERS) {
  const o = figeOrigine(id);
  // Le centre de la phrase : celui des lignes d'origine, en moyenne (elles
  // sont centrées, à l'arrondi près des espaces de fin).
  const centre = o.lignes.reduce((s, l) => s + (l.x0 + l.x1) / 2, 0) / o.lignes.length;
  const morceaux = [];
  lignesEn.forEach((t, i) => {
    const l = o.lignes[Math.min(i, o.lignes.length - 1)];
    const largeur = ligne(JESTER, t, l.taille).largeur;
    morceaux.push(...poser(JESTER, t, l.taille, centre - largeur / 2, l.y, { couleur: l.couleur }));
  });
  PAQUET[`texte${id}.svg`] = svgDe(morceaux, 0.5);
  RAPPORT.push(`texte${id} « ${o.lignes.map((l) => l.texte.trim()).join(' / ')} » → « ${lignesEn.join(' / ')} »`);
}

// « tester » (bouton518, trois états) : calé à gauche, comme l'original.
const TESTER = [[514, '#c9b981'], [515, '#e3dbbf'], [517, '#ffffff']];
const lt = figeOrigine(514).lignes[0];
for (const [id] of TESTER) {
  const l = figeOrigine(id).lignes[0];
  PAQUET[`texte${id}.svg`] = svgDe(poser(JESTER, 'test', l.taille, l.x0, l.y, { couleur: l.couleur }), 0.5);
}
RAPPORT.push(`texte514/515/517 « tester » → « test » (Jester ${lt.taille}, calé à gauche)`);

// « niveau » (jama_GUI_Header_Level, trois états, Verdana 12) — l'en-tête
// d'une partie que le portage n'affiche pas ; redessiné pour le jour où.
for (const id of [69, 70, 71]) {
  const l = figeOrigine(id).lignes[0];
  PAQUET[`texte${id}.svg`] = svgDe(poser(VERDANA, 'level', l.taille, l.x0, l.y, { couleur: l.couleur }), 0.5);
}
RAPPORT.push('texte69/70/71 « niveau » → « level » (Verdana 12, calé à gauche)');

// 3. Les formes qui sont du texte vectorisé.
//
// La barre de menu de l'éditeur : « sauvegarder », « Quitter », « valider »
// sont des formes, dans une fonte fantaisie que le SWF n'embarque pas ; seul
// « tester » y est un vrai texte, en Jester 18. L'anglais écrit les quatre
// en Jester 18, au départ et sur la ligne de base de « tester » (le repère du
// bouton : la matrice de texte514 le pose en 16,25 ; −3,8) — une barre
// homogène. Trois états par bouton : repos, survol, appui (blanc, avec un
// halo blanc, comme l'original).
const m514 = MANIFESTE.symboles.bouton518.etats[0].pieces.find((p) => p.fichier === 'texte514.svg').m;
const BARRE_X = lt.x0 + m514[4], BARRE_Y = lt.y + m514[5], BARRE_TAILLE = lt.taille;
const BARRE = [
  ['save', 'shape499.svg', 'shape501.svg', 'shape503.svg'],
  ['quit', 'shape506.svg', 'shape507.svg', 'shape508.svg'],
  ['submit', 'shape510.svg', 'shape511.svg', 'shape512.svg'],
];
const ETATS = ['#c9b981', '#e3dbbf', '#ffffff'];
for (const [mot, ...fichiers] of BARRE) {
  fichiers.forEach((f, i) => {
    const morceaux = [];
    if (i === 2) morceaux.push(...poser(JESTER, mot, BARRE_TAILLE, BARRE_X, BARRE_Y, { couleur: '#ffffff', trait: 3 }));
    morceaux.push(...poser(JESTER, mot, BARRE_TAILLE, BARRE_X, BARRE_Y, { couleur: ETATS[i] }));
    PAQUET[f] = svgDe(morceaux, 0.5);
  });
  RAPPORT.push(`${fichiers.join('/')} → « ${mot} » (Jester ${BARRE_TAILLE})`);
}
// Le halo blanc de « tester » appuyé (shape516, dans le repère du bouton).
PAQUET['shape516.svg'] = svgDe(poser(JESTER, 'test', BARRE_TAILLE, BARRE_X, BARRE_Y, { couleur: '#ffffff', trait: 3 }), 0.5);
RAPPORT.push('shape516.svg : le halo de « test » appuyé');

// Le bouton « JOUER » du parchemin (shape861) : la plaque reste, le mot change.
// Dans la forme, le lettrage est le chemin brun #80613c ; on le retire et l'on
// pose « PLAY » en Jester à sa place — même centre, même hauteur de capitale.
{
  const src = fs.readFileSync(path.join(SPRITES, 'shape861.svg'), 'utf8');
  const chemins = [...src.matchAll(/<path\b[^>]*\/>\n?/g)];
  const lettrage = chemins.filter((c) => /fill="#80613c"/.test(c[0]));
  if (lettrage.length !== 1) throw new Error('shape861 : le lettrage « JOUER » n’est plus là où on l’attend');
  const nums = (/\sd="([^"]*)"/.exec(lettrage[0][0])[1].match(/-?\d+(\.\d+)?/g) || []).map(Number);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]);
    y0 = Math.min(y0, nums[i + 1]); y1 = Math.max(y1, nums[i + 1]);
  }
  // La hauteur de capitale de Jester (le « P ») donne la taille.
  const P = cadreGlyphe(JESTER.glyphes.get(80).d, 0, 0, 1);
  const taille = (y1 - y0) / (-P.y0 / 1024);
  const largeur = ligne(JESTER, 'PLAY', taille).largeur;
  const morceaux = poser(JESTER, 'PLAY', taille, (x0 + x1) / 2 - largeur / 2, y1, { couleur: '#80613c' });
  const plaque = src.replace(lettrage[0][0], '');
  const vb = (/viewBox="([^"]*)"/.exec(src)[1]).split(' ').map(Number);
  const corps = plaque.replace(/^<svg[^>]*>\n?/, '').replace(/<\/svg>\s*$/, '');
  PAQUET['shape861.svg'] = svgDe(morceaux, 0, corps, '', vb);
  RAPPORT.push(`shape861.svg « JOUER » → « PLAY » (Jester ${arr(taille)}, la plaque d'origine)`);
}

// ── Écriture ────────────────────────────────────────────────────────────────
for (const r of RAPPORT) console.log(r);
if (VERIFIER) {
  // Les avances de la fonte contre celles du fichier : le mot français remis
  // en ligne avec la table doit retomber sur la largeur posée par Flash.
  for (const f of [SKATER, JESTER, VERDANA]) {
    console.log(`  ${f.nom} : avances ${f.table ? 'de la table de mise en page' : 'relevées dans les textes figés'}`
      + (f === SKATER ? ` — glyphes ${[...f.glyphes.keys()].map((c) => String.fromCharCode(c)).join('')}` : ''));
  }
  for (const id of [...MENU.map((m) => m[0]), 436, 445, 450, 514]) {
    const l = figeOrigine(id).lignes[0];
    const f = id < 200 ? SKATER : JESTER;
    const calc = ligne(f, l.texte.replace(/ +$/, ''), l.taille).largeur;
    console.log(`  vérif texte${id} « ${l.texte} » : fichier ${arr(l.x1 - l.x0)} px, avances ${arr(calc)} px`);
  }
} else {
  fs.writeFileSync(SORTIE, JSON.stringify(PAQUET), 'utf8');
  console.log(`${Object.keys(PAQUET).length} remplaçants → ${path.relative(RACINE, SORTIE)}`);
}
