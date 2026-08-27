#!/usr/bin/env node
/*
 * LES DESSINS DE LA RECHERCHE (main.swf) — le bouton, les drapeaux, le voyant.
 *
 *   node scripts/extract-recherche.js     → écrit public/frutiz/sprites/
 *
 * Trois pièces, que le bytecode désigne nommément :
 *
 *   mcSearchButton (#441)   le bouton de la bande des contacts. UNE SEULE
 *                           image, trois profondeurs — pas trois états :
 *                             1  ch437  la plaque grise, 95,6 × 14,45
 *                             2  ch438  le CHAMP « recherche » (DefineEditText
 *                                       #438 : police #148 en 10, BLANC,
 *                                       align 2 = centré, readOnly), posé en
 *                                       (26 ; 2,35), cadre (−2,−2)–(73,4 ; 14,05)
 *                             3  ch440  la loupe, tournée de 45°, en (17,95 ; 8,75)
 *                           `SideList.buildList` (0xa115b) l'attache par
 *                           `attachMovie` et ne lui pose qu'un `onPress` : rien
 *                           ne va jamais chercher une deuxième image. Le
 *                           portage ne sort donc qu'un seul dessin, et écrit le
 *                           mot par-dessus en texte — c'en est un.
 *   countryBox (#113)       le petit drapeau d'une entrée du listing.
 *                           `cp.SearchSlot.initScreen` fait
 *                           `country.gotoAndStop(info.countryCode)`, et les
 *                           six images sont ÉTIQUETÉES : fr, be, lu, ca, ch,
 *                           ot — un code inconnu retombe sur « ot ».
 *   status (#253)           le voyant, à gauche de la bouille. `bg` (ch217)
 *                           est sur toutes les images ; `ico` change selon
 *                           l'étiquette que `updateStatus` vise :
 *                             image 2  « presence »  ico = presence + 1
 *                             image 6  « internal »  ico = le jeu en cours
 *                             image 13 « external »  ico = absent, tél., zzz…
 *                           On sort le fond et les deux jeux d'icônes que le
 *                           portage n'avait pas encore (la présence et les
 *                           absences) ; les voyants de JEU sont déjà sortis
 *                           par extract-voyants-jeux.js, on ne les refait pas.
 *
 * Même moteur que extract-frutiz-bureau.js : les formes par
 * extract-swf-shapes.js, les matrices en pixels, un cxform en feColorMatrix.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir, IDENTITE } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'legacy/main.swf');
const SORTIE = path.join(RACINE, 'public/frutiz/sprites');

const swf = ouvrir(SWF, { textesEnFormes: false });
const b = swf.b;
const arr = (v) => String(Math.round(v * 100) / 100);

// ── Les formes, par l'extracteur commun ───────────────────────────────────
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'recherche-formes-'));
const formes = new Map();
function chargerFormes(ids) {
  if (!ids.length) return;
  execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), SWF, TMP, ...ids.map(String)],
    { stdio: 'pipe' });
  for (const id of ids) {
    const p = path.join(TMP, 'shape' + id + '.svg');
    if (!fs.existsSync(p)) { console.warn('!! forme absente', id); continue; }
    const t = fs.readFileSync(p, 'utf8');
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(t);
    formes.set(id, {
      corps: t.replace(/<svg[^>]*>/, '').replace('</svg>', ''),
      vb: { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] },
    });
  }
}

const cxNeutre = (c) => !c || (c.mr === 256 && c.mv === 256 && c.mb === 256
  && c.ma === 256 && !c.ar && !c.av && !c.ab && !c.aa);
let nFiltre = 0;
function filtreCx(cx) {
  if (cxNeutre(cx)) return null;
  const id = 'cx' + (++nFiltre);
  const m = [
    cx.mr / 256, 0, 0, 0, cx.ar / 255,
    0, cx.mv / 256, 0, 0, cx.av / 255,
    0, 0, cx.mb / 256, 0, cx.ab / 255,
    0, 0, 0, cx.ma / 256, cx.aa / 255,
  ];
  return { id, def: `<filter id="${id}" color-interpolation-filters="sRGB">`
    + `<feColorMatrix type="matrix" values="${m.map((v) => +v.toFixed(4)).join(' ')}"/></filter>` };
}

// La composition d'un jeu de morceaux en SVG. `cadreImpose` sert aux bandes
// dont toutes les images doivent s'aligner (les drapeaux, les icônes) : sans
// lui chacune se recadre sur son propre dessin et la bande saute.
function svgCompose(morceaux, cadreImpose) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const dessins = [];
  for (const m of morceaux) {
    if (m.masque) continue;
    const f = formes.get(m.shape);
    if (!f) continue;
    for (const [px, py] of [[f.vb.x, f.vb.y], [f.vb.x + f.vb.w, f.vb.y],
      [f.vb.x, f.vb.y + f.vb.h], [f.vb.x + f.vb.w, f.vb.y + f.vb.h]]) {
      const sx = m.M.a * px + m.M.c * py + m.M.e / 20;
      const sy = m.M.b * px + m.M.d * py + m.M.f / 20;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    dessins.push(m);
  }
  if (!dessins.length) return null;
  const propre = { x: +arr(x0), y: +arr(y0),
    w: +arr(Math.max(0.01, x1 - x0)), h: +arr(Math.max(0.01, y1 - y0)) };
  const c = cadreImpose || propre;
  let defs = '', corps = '';
  for (const d of dessins) {
    const f = formes.get(d.shape);
    const fc = filtreCx(d.cx);
    if (fc) defs += fc.def;
    corps += `<g transform="matrix(${[d.M.a, d.M.b, d.M.c, d.M.d, d.M.e / 20, d.M.f / 20]
      .map((v) => +v.toFixed(4)).join(',')})"` + (fc ? ` filter="url(#${fc.id})"` : '') + '>'
      + f.corps + '</g>\n';
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(c.x)} ${arr(c.y)} ${arr(c.w)} ${arr(c.h)}"`
    + ` width="${arr(c.w)}" height="${arr(c.h)}">\n`
    + (defs ? '<defs>' + defs + '</defs>\n' : '') + corps + '</svg>\n';
  return { svg, cadre: propre };
}

// Une BANDE : une image par entrée, toutes cadrées sur leur union.
function bande(spriteId, images) {
  const jeux = images.map((im) => ({
    nom: im.nom,
    morceaux: swf.aplatir(spriteId, IDENTITE, 0, im.frame, '', undefined),
  }));
  const ids = new Set();
  for (const j of jeux) for (const m of j.morceaux) if (m.shape !== undefined) ids.add(m.shape);
  chargerFormes([...ids]);
  const bruts = jeux.map((j) => ({ nom: j.nom, r: svgCompose(j.morceaux) })).filter((j) => j.r);
  if (!bruts.length) return null;
  let u = null;
  for (const j of bruts) {
    const k = j.r.cadre;
    u = u ? { x: Math.min(u.x, k.x), y: Math.min(u.y, k.y),
      x1: Math.max(u.x1, k.x + k.w), y1: Math.max(u.y1, k.y + k.h) }
      : { x: k.x, y: k.y, x1: k.x + k.w, y1: k.y + k.h };
  }
  const cadre = { x: u.x, y: u.y, w: +arr(u.x1 - u.x), h: +arr(u.y1 - u.y) };
  const sortis = [];
  for (const j of jeux) {
    const r = svgCompose(j.morceaux, cadre);
    if (!r) { console.warn('!! image vide :', j.nom); continue; }
    fs.writeFileSync(path.join(SORTIE, j.nom + '.svg'), r.svg, 'utf8');
    sortis.push(j.nom);
  }
  return { cadre, images: sortis };
}

function principal() {
  fs.mkdirSync(SORTIE, { recursive: true });
  const manifeste = {};

  // ── LE BOUTON (mcSearchButton #441) ─────────────────────────────────────
  // `SideList.buildList` l'attache sous la bande des contacts, à `_y = 770` —
  // la hauteur de scène d'époque moins `hSearch = 24`, et le masque de la
  // liste des contacts est raccourci d'autant (`mcListMask._yscale = mch −
  // hSearch`). UN SEUL dessin : la plaque et la loupe. Le mot « recherche »
  // est un CHAMP (ch438) — le portage l'écrit en texte par-dessus, blanc,
  // centré, gras 10, comme le DefineEditText le demande.
  const bouton = bande(441, [{ frame: 1, nom: 'recherche' }]);
  if (bouton) {
    // Le cadre du champ, relevé sur le tag : posé en (26 ; 2,35) avec un
    // rectangle propre de (−2 ; −2) à (73,4 ; 14,05) — soit, sur la scène,
    // x 24..99,4 et y 0,35..16,4. Rapporté au cadre du dessin (qui commence
    // en x 9,95 ; y 0,65) : 14,05..89,45 et −0,3..15,75.
    manifeste.bouton = Object.assign({ champ: { x: 14.05, y: -0.3, w: 75.4, h: 16.05 } }, bouton);
    console.log('bouton de recherche :', JSON.stringify(bouton.cadre), bouton.images.join(' '));
  }

  // ── LES DRAPEAUX (countryBox #113) ──────────────────────────────────────
  // Les six images sont étiquetées dans le fichier ; `gotoAndStop(code)` les
  // vise par leur nom, et `initScreen` remplace un code vide par « ot ».
  const PAYS = ['fr', 'be', 'lu', 'ca', 'ch', 'ot'];
  const drapeaux = bande(113, PAYS.map((p, i) => ({ frame: i + 1, nom: 'recherche-pays-' + p })));
  if (drapeaux) {
    manifeste.pays = Object.assign({ codes: PAYS }, drapeaux);
    console.log('drapeaux :', JSON.stringify(drapeaux.cadre), drapeaux.images.join(' '));
  }

  // ── LE VOYANT (status #253) ─────────────────────────────────────────────
  // Le FOND, d'abord : `bg` (ch217) est posé sur toutes les images, et
  // `initScreen` le fige sur son image 2.
  const fond = bande(253, [{ frame: 1, nom: 'recherche-voyant-fond' }]);
  if (fond) {
    manifeste.voyantFond = fond;
    console.log('fond du voyant :', JSON.stringify(fond.cadre));
  }
  // LA PRÉSENCE : image 2 du clip, `ico` = ch222, dont `updateStatus` vise
  // l'image `presence + 1`. Le clip n'a que TROIS images — relevé au
  // PlaceObject près : f1 pose ch218, f2 le remplace par ch220, f3 par ch221
  // (ch219, le reflet, reste sur les trois) — et Flash borne au-delà.
  //   image 1  ROUGE   `presence` 0 : hors ligne (ou rien de connu)
  //   image 2  VERTE   `presence` 1 : en ligne — ce que le serveur envoie
  //   image 3  GRISE   `presence` 2 : invisible (`MeMng.isInvisible`)
  const presence = bandeIco(222, 3, 'recherche-presence-');
  if (presence) {
    manifeste.presence = presence;
    console.log('présence :', JSON.stringify(presence.cadre), presence.images.join(' '));
  }
  // LES ABSENCES (image 13, `ico` = ch252 : cinq images, ch247 à ch251) NE
  // SONT PAS SORTIES. Le revival ne les émet jamais — `getStatusCode` assemble
  // `encode62(ext,1)` avec un `ext` toujours nul —, l'icône ne paraîtrait donc
  // sur aucune fiche ; et l'ordre d'`externalList` (away, phone, zzz, work,
  // eat) ne se recoupe PAS avec les dessins relevés (f2 des Zzz, f3 un
  // combiné, f4 des couverts, f5 un sens interdit). On ne devine pas une
  // correspondance qu'aucun trafic ne viendrait confirmer : le jour où le
  // serveur émettra des absences, il faudra la relever pour de bon.

  fs.writeFileSync(path.join(SORTIE, 'recherche.json'), JSON.stringify(manifeste, null, 1), 'utf8');
  console.log('manifeste → public/frutiz/sprites/recherche.json');
}

// Une bande d'ICÔNES : le clip `ico` d'un état du voyant, une image par état.
function bandeIco(spriteId, n, prefixe, noms) {
  const images = [];
  for (let i = 0; i < n; i++) {
    images.push({ frame: i + 1, nom: prefixe + (noms ? noms[i] : i) });
  }
  return bande(spriteId, images);
}

principal();
