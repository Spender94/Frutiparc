#!/usr/bin/env node
// Sort les VIGNETTES DE DONNÉE du tableau des scores — la colonne annexe que
// main.swf ajoute à trois jeux, et que le portage n'avait pas.
//
//   node scripts/extract-scores-sd.js         → écrit public/fb/sd/*.png
//
// ── Ce que fait le bureau d'époque ──
//
// `buildLegacyGameScoreInfo` (côté serveur) décrit le tableau d'un jeu :
//
//   gs=0  Burning Kiwi  <desc n="Ecurie"  t="s" w="60">bkiwi_team</desc>
//                       <desc n="Rang"    t="s" w="60">bkiwi_rank</desc>
//   gs=3  Swapou 2      <desc n="Perso"   t="s" w="45">swapou_score_chars</desc>
//   gs=4  Kaluga        <desc n="Tzongre" t="s" w="60">kaluga_tz</desc>
//
// `cp.Score` (sprite#900, ~0xc3620) lit ces descripteurs. Une colonne `t="t"`
// est du texte ; une colonne `t="s"` est un DESSIN : le SWF fabrique un élément
// `url` dont l'adresse est `FEString.formatVars({u: spec.dat}, Path.scoreDataMisc)`
// — soit `/sd/<bibliothèque>.swf` — et lui passe `param.data = d`, la donnée
// annexe de la ligne (celle que `formatRankingExtraData` met en forme).
//
// Chacune de ces quatre petites bibliothèques est un SWF autonome de vingt
// pixels de côté qui lit sa variable `data`, la découpe aux deux-points et se
// place sur la bonne image. Leur contrat, tiré de leur image 1 :
//
//   kaluga_tz          data[0].toLowerCase() → kaluga 1 · piwali 2 · nalika 3
//                      · gomola 4 · makulo 5, sinon 0 ; puis gotoAndStop(10+n).
//   bkiwi_team         data[0].toLowerCase() → ultra orange 1 · uwe wing 2
//                      · fury hun 3 · sonic brain 4 · kiwix 5 ; teams ET cars
//                      vont sur cette image, puis `teams._visible = false` :
//                      c'est la VOITURE qu'on voit, et un clic bascule sur
//                      l'écusson (onRelease inverse les deux visibilités).
//   bkiwi_rank         pos = parseInt(data[2]) · perf = parseInt(data[1]) ;
//                      rank.pos.gotoAndStop(pos) (5 images) et
//                      rank.perfects.gotoAndStop(perf) (6 images).
//   swapou_score_chars chars.gotoAndStop(parseInt(data[0]) + 2) (8 images).
//
// ── Pourquoi un rendu, et pas un aplatissement ──
//
// Les autres extracteurs remontent les formes du fichier et les recomposent en
// SVG. Ici ça ne marche pas : `kaluga_tz` n'a AUCUN sprite (ses cinq tzongres
// sont posés directement sur la timeline racine, images 11 à 15),
// `swapou_score_chars` est fait de bitmaps et `bkiwi_rank` de textes tracés
// avec deux polices embarquées. On rend donc chaque état dans un vrai lecteur —
// Ruffle, celui-là même que sert /ruffle — et on photographie la scène.
//
// Le rendu se fait à QUATRE fois la taille, puis on réduit à deux : le
// suréchantillonnage donne des bords propres sur des dessins de vingt pixels.
// Le fond reste transparent (wmode), pour que le doré du panneau se voie
// derrière comme dans le SWF.

const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const SD = path.join(RACINE, 'public/swf/sd');
const RUFFLE = path.join(RACINE, 'node_modules/@ruffle-rs/ruffle');
const SORTIE = path.join(RACINE, 'public/fb/sd');
const TRAVAIL = path.join(RACINE, 'data/scores-sd-travail');

// ── Les états à photographier ─────────────────────────────────────────────
//
// `data` est écrit tel que le serveur l'envoie : `formatRankingExtraData`
// produit « Skiwix:5:1: » pour Burning Kiwi, « S0: » pour Swapou et
// « Skaluga: » pour Kaluga — le préfixe `S` de MTSerialization compris, que le
// SWF ne retire jamais (il compare `data[0].toLowerCase()` à « kiwix », pas à
// « Skiwix » : c'est le tableau des scores qui désérialise AVANT, et n'envoie
// donc que la chaîne nue).
const TZONGRES = ['kaluga', 'piwali', 'nalika', 'gomola', 'makulo'];
const ECURIES = ['ultra orange', 'uwe wing', 'fury hun', 'sonic brain', 'kiwix'];
const cle = (s) => s.replace(/ /g, '-');

const PLANS = [];
// Kaluga : cinq tzongres, plus l'image d'inconnu (frame 10) que le SWF montre
// quand le nom ne tombe dans aucun cas.
for (const tz of TZONGRES) {
  PLANS.push({ lib: 'kaluga_tz', data: tz + ':', nom: 'kaluga_tz_' + tz });
}
PLANS.push({ lib: 'kaluga_tz', data: '?:', nom: 'kaluga_tz_inconnu' });
// Burning Kiwi : la voiture de chaque écurie, puis son écusson.
for (const e of ECURIES) {
  PLANS.push({ lib: 'bkiwi_team', data: e + ':', nom: 'bkiwi_car_' + cle(e) });
  PLANS.push({ lib: 'bkiwi_team_ecusson', swf: 'bkiwi_team', data: e + ':',
    nom: 'bkiwi_team_' + cle(e) });
}
// Burning Kiwi, le rang : cinq places × six comptes de tours parfaits.
for (let pos = 1; pos <= 5; pos++) {
  for (let perf = 1; perf <= 6; perf++) {
    PLANS.push({ lib: 'bkiwi_rank', data: 'kiwix:' + perf + ':' + pos + ':',
      nom: 'bkiwi_rank_' + pos + '_' + perf });
  }
}
// Swapou : les sept personnages (image = identifiant + 2), plus l'image 1, que
// le SWF montre quand la donnée n'est pas un nombre.
for (let c = 0; c <= 6; c++) {
  PLANS.push({ lib: 'swapou_score_chars', data: c + ':', nom: 'swapou_char_' + c });
}
PLANS.push({ lib: 'swapou_score_chars', data: ':', nom: 'swapou_char_inconnu' });
/* ── LES PERSONNAGES DE LA FRUTICARD, qui ne sont PAS ceux du tableau ──────
 *
 * La fiche de Swapou 2 (0x5d532) tire son cercle de `/sd/swapou_chars.swf`,
 * une AUTRE bibliothèque que `swapou_score_chars` :
 *
 *     this._xscale = scale ; this._yscale = scale ;
 *     gotoAndStop(10 + frame)
 *
 * Les images 10 à 16 sont les sept personnages, les images 20 à 26 les mêmes
 * sous une TRANSFORMATION DE COULEUR (`PlaceObject2` y porte le drapeau
 * CxForm) : c'est la silhouette d'un personnage non débloqué. On prenait
 * jusqu'ici les vignettes du tableau des scores, où l'état inconnu est une
 * CROIX ROUGE — quatre croix dans le cercle, là où l'époque montre quatre
 * silhouettes, et des dessins de vingt pixels pour des cases de quarante-huit.
 *
 * POURQUOI IL FAUT ÉLARGIR LA SCÈNE. Le cadre déclaré va de (0,0) à (48,48),
 * mais les formes sont CENTRÉES SUR L'ORIGINE — de (−24,−24) à (24,24) — et
 * la timeline les pose sans translation. Photographier la scène telle quelle
 * n'en prend donc que le quart bas-droit. On réécrit le cadre de l'en-tête sur
 * une boîte symétrique assez large, et on RECADRE ensuite sur ce qui est
 * vraiment peint : `x`/`y` gardent l'écart à l'origine, que le light retranche
 * pour reposer le dessin là où le clip d'époque le mettait.
 */
const CADRE_SWAPOU = { x0: -48, y0: -48, x1: 48, y1: 48 };
for (let c = 0; c <= 6; c++) {
  // `frame` est ici l'image ABSOLUE : le `10 +` du SWF est mis à zéro, faute de
  // pouvoir passer un nombre par FlashVars (cf. `zeroLitteral`).
  PLANS.push({ lib: 'swapou_chars', params: { frame: String(10 + c) },
    cadre: CADRE_SWAPOU, zero: true, rogner: true, nom: 'swapou_carte_' + c });
  PLANS.push({ lib: 'swapou_chars', params: { frame: String(20 + c) },
    cadre: CADRE_SWAPOU, zero: true, rogner: true, nom: 'swapou_carte_v' + c });
}
/* ── LE PANIER DE KALUGA ───────────────────────────────────────────────────
 *
 * `kaluga_panier` porte le même `gotoAndStop(10 + frame)` que ses voisins de
 * MiniWave, et la fiche lui passe le remplissage du panier. Mais son osier —
 * la corbeille et son anse — est UN BITMAP (`DefineBitsJPEG3`, le seul du
 * fichier) : l'aplatisseur, qui remonte des formes vectorielles, n'en sortait
 * que les fruits et l'ombre, séparés par le vide en coin où passe l'anse. Un
 * tas de fraises fendu en deux, flottant au-dessus d'une flaque verte.
 *
 * On le photographie donc sous Ruffle, comme les voitures et les tzongres. La
 * scène déclarée (0..160 × 0..130) rogne les paniers les plus larges de deux
 * pixels : on l'élargit un peu, et le recadrage rend sa taille exacte à
 * chacun des vingt-deux dessins.
 */
const CADRE_PANIER = { x0: -16, y0: -16, x1: 180, y1: 148 };
for (const f of [3].concat(Array.from({ length: 21 }, (v, i) => 10 + i))) {
  PLANS.push({ lib: 'kaluga_panier', params: { frame: String(f) },
    cadre: CADRE_PANIER, zero: true, rogner: true, etat: String(f),
    nom: 'kaluga_panier_' + f });
}
// ── L'ÉCUSSON de bkiwi_team, que seul un clic montre ──────────────────────
//
// Les deux dessins d'une écurie sont sur la scène en même temps : la voiture
// (`cars`, profondeur 4) et l'écusson (`teams`, profondeur 1). L'image 3 les
// envoie tous deux sur l'image de l'écurie, puis cache le second :
//
//     teams.gotoAndStop(frame); cars.gotoAndStop(frame);
//     teams._visible = false;
//     this.onRelease = function () { teams._visible = !teams._visible;
//                                    cars._visible = !cars._visible; };
//
// Pour photographier l'écusson, on sert une copie du SWF où cette ligne cache
// `cars` au lieu de `teams` : dans le Push qui la précède, l'index de chaîne
// « teams » devient celui de « cars ». UN octet — le fichier du dépôt n'est pas
// touché, la copie ne vit que le temps de la séance.
//
// Le site est reconnu à son contexte, pas à une adresse : le même motif existe
// dans la branche d'erreur (qui cache les DEUX) et dans `onRelease` ; seul
// celui-là est immédiatement suivi de `Push "this"`.
function swfEcusson() {
  const { lireSwf } = require('./lib/swf-greffe.js');
  const { sig, version, body } = lireSwf(path.join(SD, 'bkiwi_team.swf'));
  let touche = 0;
  // Les tags de premier niveau : on ne cherche que dans les DoAction.
  let o = Math.ceil((5 + ((body[0] >> 3) & 0x1f) * 4) / 8) + 4;
  while (o < body.length - 1) {
    const hdr = body.readUInt16LE(o), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = body.readUInt32LE(o + 2); hs = 6; }
    if (code === 0) break;
    if (code === 12) touche += patcherDoAction(body, o + hs, o + hs + len);
    o += hs + len;
  }
  if (touche !== 1) throw new Error('bkiwi_team : ' + touche + ' site(s) trouvé(s), 1 attendu');
  const charge = sig === 'CWS' ? zlib.deflateSync(body, { level: 9 }) : body;
  const out = Buffer.alloc(8 + charge.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + body.length, 4);
  charge.copy(out, 8);
  return out;
}

function patcherDoAction(body, deb, fin) {
  // La table des chaînes (ActionConstantPool, 0x88), en tête du script.
  if (body[deb] !== 0x88) return 0;
  const n = body.readUInt16LE(deb + 3);
  const mots = [];
  let p = deb + 5;
  for (let i = 0; i < n; i++) {
    let e = p; while (body[e]) e++;
    mots.push(body.toString('latin1', p, e)); p = e + 1;
  }
  const iTeams = mots.indexOf('teams'), iCars = mots.indexOf('cars');
  const iVis = mots.indexOf('_visible'), iThis = mots.indexOf('this');
  if ([iTeams, iCars, iVis, iThis].some((k) => k < 0 || k > 255)) return 0;
  // Push "teams" · GetVariable · Push "_visible", false · SetMember · Push "this"
  const motif = Buffer.from([0x96, 2, 0, 8, iTeams, 0x1C,
    0x96, 4, 0, 8, iVis, 5, 0, 0x4F, 0x96, 2, 0, 8, iThis]);
  let touche = 0;
  for (let k = deb; k + motif.length <= fin; k++) {
    if (body.compare(motif, 0, motif.length, k, k + motif.length) !== 0) continue;
    body[k + 4] = iCars;
    touche++;
  }
  return touche;
}

/* ── ÉLARGIR LA SCÈNE D'UN SWF ─────────────────────────────────────────────
 *
 * On ne touche qu'au cadre de l'en-tête (le RECT qui suit la longueur), pour
 * le remplacer par une boîte carrée centrée sur l'origine. Rien d'autre ne
 * bouge : les tags gardent leurs offsets, puisque le RECT est AVANT eux et que
 * la longueur annoncée est recalculée. Le fichier du dépôt n'est pas touché —
 * la copie ne vit que le temps de la séance.
 */
function encoderRect(x0, x1, y0, y1) {
  const v = [x0, x1, y0, y1];
  let n = 1;
  while (v.some((k) => k < -(2 ** (n - 1)) || k > 2 ** (n - 1) - 1)) n++;
  const bits = [];
  const pousser = (val, larg) => {
    for (let i = larg - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pousser(n, 5);
  for (const k of v) pousser(k < 0 ? k + (1 << n) : k, n);
  while (bits.length % 8) bits.push(0);
  const out = Buffer.alloc(bits.length / 8);
  bits.forEach((b, i) => { if (b) out[i >> 3] |= 1 << (7 - (i & 7)); });
  return out;
}

/* LE `10 +` DE `gotoAndStop(10 + frame)`, mis à zéro.
 *
 * L'époque ne passait pas ses paramètres dans l'adresse : `DocPage.updateLine`
 * charge le SWF puis POSE les clés de `param` sur le clip, si bien que `frame`
 * y est un vrai NOMBRE et que `10 + frame` est une addition. Un lecteur, lui,
 * ne sait donner ses paramètres que par FlashVars, donc en CHAÎNES : `Add2`
 * bascule alors en concaténation, `10 + "6"` vaut « 106 », et les quatorze
 * états tombaient tous sur la même image (la dernière, faute de mieux).
 *
 * Plutôt que d'écrire un SWF hôte pour poser une variable numérique, on met le
 * littéral à zéro : « 0 » + « 16 » vaut « 016 », que `GotoFrame2` lit comme
 * l'image 16 après avoir cherché en vain une étiquette de ce nom. Le plan
 * porte alors le numéro d'image ABSOLU. Quatre octets, dans une copie qui ne
 * vit que le temps de la séance.
 *
 *   96 ll 00 · 07 0a 00 00 00 · <"frame"> · 1c · 47 · 9f 01 00 00
 *   Push       ↑ 10 (int32)                 Get  Add  GotoFrame2
 *
 * Le nom se pousse de deux façons selon le SWF — par renvoi à la table des
 * chaînes (`08 xx`, deux octets, `swapou_chars`) ou en toutes lettres
 * (`00 f r a m e 00`, sept octets, `kaluga_panier`). On ne fixe donc que le
 * début et la fin, et on tolère entre eux quelques octets de nom.
 */
function zeroLitteral(body) {
  const av = Buffer.from([0x07, 0x0a, 0x00, 0x00, 0x00]);
  const ap = Buffer.from([0x1c, 0x47, 0x9f, 0x01, 0x00, 0x00]);
  let touche = 0;
  for (let k = 3; k + av.length <= body.length; k++) {
    if (body[k - 3] !== 0x96 || body[k - 1] !== 0x00) continue;   // ActionPush
    if (body.compare(av, 0, av.length, k, k + av.length) !== 0) continue;
    for (let q = k + av.length; q <= k + av.length + 16; q++) {
      if (body.compare(ap, 0, ap.length, q, q + ap.length) !== 0) continue;
      body[k + 1] = 0;                       // le 10 de `10 + frame`
      touche++;
      break;
    }
  }
  if (touche !== 1) throw new Error('gotoAndStop(10 + frame) : ' + touche + ' site(s), 1 attendu');
}

function swfCadre(fichier, boite, zero) {
  const { lireSwf } = require('./lib/swf-greffe.js');
  const { sig, version, body } = lireSwf(fichier);
  if (zero) zeroLitteral(body);
  const vieux = Math.ceil((5 + ((body[0] >> 3) & 0x1f) * 4) / 8);
  const tw = (v) => Math.round(v * 20);
  const neuf = Buffer.concat([
    encoderRect(tw(boite.x0), tw(boite.x1), tw(boite.y0), tw(boite.y1)),
    body.slice(vieux)]);
  const charge = sig === 'CWS' ? zlib.deflateSync(neuf, { level: 9 }) : neuf;
  const out = Buffer.alloc(8 + charge.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + neuf.length, 4);
  charge.copy(out, 8);
  return out;
}

/* ── RECADRER sur ce qui est vraiment peint ────────────────────────────────
 * Rend l'image serrée sur ses pixels non transparents, et l'écart en pixels
 * (à l'échelle de l'image) entre son coin et celui de la scène.
 */
function rogner(img) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.px[(y * img.w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return { w: 1, h: 1, px: Buffer.alloc(4), dx: 0, dy: 0 };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    img.px.copy(px, y * w * 4, ((y + y0) * img.w + x0) * 4,
      ((y + y0) * img.w + x0 + w) * 4);
  }
  return { w, h, px, dx: x0, dy: y0 };
}

// ── La scène de chaque bibliothèque, lue dans son en-tête ─────────────────
function tailleScene(fichier) {
  const raw = fs.readFileSync(fichier);
  const b = raw.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  const n = b[0] >> 3;
  let bit = 5;
  const u = (k) => {
    let v = 0;
    for (let i = 0; i < k; i++) { v = v * 2 + ((b[bit >> 3] >> (7 - (bit & 7))) & 1); bit++; }
    return v;
  };
  const s = (k) => { const v = u(k); return (v & (1 << (k - 1))) ? v - (1 << k) : v; };
  const xmin = s(n), xmax = s(n), ymin = s(n), ymax = s(n);
  return { w: (xmax - xmin) / 20, h: (ymax - ymin) / 20 };
}

// ── PNG : lecture et écriture, sans dépendance ────────────────────────────
function lirePng(buf) {
  let pos = 8; const idat = []; let w = 0, h = 0, ctype = 0;
  while (pos < buf.length) {
    const ln = buf.readUInt32BE(pos), typ = buf.toString('ascii', pos + 4, pos + 8);
    const corps = buf.slice(pos + 8, pos + 8 + ln);
    if (typ === 'IHDR') { w = corps.readUInt32BE(0); h = corps.readUInt32BE(4); ctype = corps[9]; }
    else if (typ === 'IDAT') idat.push(corps);
    else if (typ === 'IEND') break;
    pos += 12 + ln;
  }
  const brut = zlib.inflateSync(Buffer.concat(idat));
  const ca = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ca) throw new Error('type de PNG non géré : ' + ctype);
  const stride = w * ca;
  const px = Buffer.alloc(stride * h);
  let i = 0, prec = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = brut[i++];
    const l = Buffer.from(brut.slice(i, i + stride)); i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ca ? l[x - ca] : 0, b = prec[x], c = x >= ca ? prec[x - ca] : 0;
      if (f === 1) l[x] = (l[x] + a) & 255;
      else if (f === 2) l[x] = (l[x] + b) & 255;
      else if (f === 3) l[x] = (l[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        l[x] = (l[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    l.copy(px, y * stride); prec = l;
  }
  // Tout ramener en RGBA, quel que soit le type d'origine.
  const out = Buffer.alloc(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const o = k * ca;
    if (ca === 4) { px.copy(out, k * 4, o, o + 4); }
    else if (ca === 3) { out[k * 4] = px[o]; out[k * 4 + 1] = px[o + 1]; out[k * 4 + 2] = px[o + 2]; out[k * 4 + 3] = 255; }
    else if (ca === 2) { out.fill(px[o], k * 4, k * 4 + 3); out[k * 4 + 3] = px[o + 1]; }
    else { out.fill(px[o], k * 4, k * 4 + 3); out[k * 4 + 3] = 255; }
  }
  return { w, h, px: out };
}

const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xFFFFFFFF;
    for (const o of buf) c = t[(c ^ o) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
})();

function ecrirePng(p, w, h, rgba) {
  const brut = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    brut[y * (w * 4 + 1)] = 0;
    rgba.copy(brut, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (typ, data) => {
    const c = Buffer.concat([Buffer.from(typ, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(CRC(c));
    return Buffer.concat([len, c, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(p, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(brut, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// Réduction par moyenne de blocs k×k, en couleurs PRÉ-MULTIPLIÉES : sans ça
// les pixels transparents (dont la couleur est arbitraire) déteignent sur le
// bord des dessins et cernent les vignettes de gris.
function reduire(img, k) {
  const w = Math.round(img.w / k), h = Math.round(img.h / k);
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, v = 0, b = 0, a = 0, n = 0;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const o = ((y * k + dy) * img.w + (x * k + dx)) * 4;
          const al = img.px[o + 3];
          r += img.px[o] * al; v += img.px[o + 1] * al; b += img.px[o + 2] * al;
          a += al; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(v / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return { w, h, px: out };
}

// ── Le serveur de la séance ───────────────────────────────────────────────
// Ruffle veut son WASM et son SWF sur la même origine : on sert les deux le
// temps de la séance, et rien d'autre.
const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; }
  html, body { background: transparent; }
  #scene { position: absolute; left: 0; top: 0; overflow: hidden; }
  #scene ruffle-player { width: 100% !important; height: 100% !important; display: block !important; }
</style>
<script>
  window.RufflePlayer = { config: { autoplay: "on", unmuteOverlay: "hidden",
    contextMenu: "off", showSwfDownload: false, splashScreen: false,
    preferredRenderer: "canvas", publicPath: "/ruffle/", wmode: "transparent",
    backgroundColor: null } };
</script>
<script src="/ruffle/ruffle.js"></script>
</head><body><div id="scene"></div>
<script>
window.pret = false;
window.poser = async function (lib, params, w, h, z) {
  const scene = document.getElementById('scene');
  scene.style.width = (w * z) + 'px';
  scene.style.height = (h * z) + 'px';
  scene.innerHTML = '';
  const joueur = window.RufflePlayer.newest().createPlayer();
  scene.appendChild(joueur);
  await joueur.load({
    url: '/sd/' + lib + '.swf',
    autoplay: 'on', quality: 'best', scale: 'exactFit',
    backgroundColor: null, wmode: 'transparent',
    allowScriptAccess: true, allowNetworking: 'all',
    parameters: params,
  });
  window.pret = true;
};
</script></body></html>`;

function servir(virtuels) {
  return new Promise((res) => {
    const srv = http.createServer((req, rep) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/' || u === '/index.html') {
        rep.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return rep.end(PAGE);
      }
      if (virtuels[u]) {
        rep.writeHead(200, { 'Content-Type': 'application/x-shockwave-flash' });
        return rep.end(virtuels[u]);
      }
      let f = null;
      if (u.startsWith('/ruffle/')) f = path.join(RUFFLE, u.slice(8));
      else if (u.startsWith('/sd/')) f = path.join(SD, u.slice(4));
      if (!f || !f.startsWith(f.startsWith(RUFFLE) ? RUFFLE : SD) || !fs.existsSync(f)) {
        rep.writeHead(404); return rep.end('non');
      }
      const ext = path.extname(f);
      const mime = { '.js': 'application/javascript', '.wasm': 'application/wasm',
        '.swf': 'application/x-shockwave-flash', '.map': 'application/json' }[ext]
        || 'application/octet-stream';
      rep.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(f).pipe(rep);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ── La séance ─────────────────────────────────────────────────────────────
const ZOOM = 4;      // rendu ×4 …
const FINAL = 2;     // … réduit à ×2 (écrans denses)

// Le SWF réellement servi à Ruffle : le fichier du dépôt, ou la copie dont on
// a élargi la scène. Le nom de la BIBLIOTHÈQUE, lui, ne change pas — c'est lui
// que le manifeste garde, et dont `bornes()` tire les états d'une famille.
function servi(p) {
  return p.cadre ? (p.swf || p.lib) + '_cadre' : p.lib;
}

async function principal() {
  for (const d of [SORTIE, TRAVAIL]) fs.mkdirSync(d, { recursive: true });
  /* Les SWF SERVIS À LA PLACE des vrais : l'écusson de Burning Kiwi, et une
     copie de `swapou_chars` dont la scène est élargie autour de l'origine. */
  const virtuels = { '/sd/bkiwi_team_ecusson.swf': swfEcusson() };
  // Une copie retouchée PAR BIBLIOTHÈQUE, pas par état : les quatorze Swapou
  // partagent la même, et les vingt-deux paniers de même — seul le FlashVars
  // `frame` change d'un plan à l'autre.
  for (const p of PLANS) {
    if (!p.cadre || virtuels['/sd/' + servi(p) + '.swf']) continue;
    virtuels['/sd/' + servi(p) + '.swf'] =
      swfCadre(path.join(SD, (p.swf || p.lib) + '.swf'), p.cadre, p.zero);
  }
  const srv = await servir(virtuels);
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const { chromium } = require('playwright-core');
  const nav = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await nav.newPage({ viewport: { width: 400, height: 400 } });
  page.on('pageerror', (e) => console.warn('!! page :', e.message));

  const scenes = {};
  /* LE MANIFESTE EST COMMUN aux deux extracteurs — celui-ci et
     `extract-fruticard-sd.js` écrivent dans le même fichier. On le RELIT donc
     avant d'y ajouter : reparti d'un objet vide, ce script effaçait d'un coup
     les cent trente entrées de l'autre, et toutes les fruticards perdaient
     leurs dessins (MiniWave et MiniPixiz les prennent toutes de là). */
  const chemin = path.join(SORTIE, 'manifeste.json');
  let manifeste = {};
  try { manifeste = JSON.parse(fs.readFileSync(chemin, 'utf8')) || {}; } catch (e) { manifeste = {}; }
  for (const p of PLANS) {
    const source = servi(p);                       // ce que Ruffle charge
    const fichier = p.swf || p.lib;                 // ce qui existe sur le disque
    const cle2 = p.cadre ? fichier + '@' + JSON.stringify(p.cadre) : fichier;
    if (!scenes[cle2]) {
      scenes[cle2] = p.cadre
        ? { w: p.cadre.x1 - p.cadre.x0, h: p.cadre.y1 - p.cadre.y0,
          x0: p.cadre.x0, y0: p.cadre.y0 }
        : Object.assign({ x0: 0, y0: 0 }, tailleScene(path.join(SD, fichier + '.swf')));
    }
    const sc = scenes[cle2];
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction('!!(window.RufflePlayer && window.RufflePlayer.newest)');
    await page.evaluate(([lib, params, w, h, z]) => window.poser(lib, params, w, h, z),
      [source, p.params || { data: p.data }, sc.w, sc.h, ZOOM]);
    await page.waitForFunction('window.pret === true');
    const scene = page.locator('#scene');
    const brut = await stabiliser(scene);
    let img = reduire(lirePng(brut), ZOOM / FINAL);
    // `x`/`y` : le coin du dessin VU DE L'ORIGINE du SWF, en pixels logiques.
    // C'est l'origine que l'époque posait sur le point demandé, pas le coin.
    let x = sc.x0, y = sc.y0, w = sc.w, h = sc.h;
    if (p.rogner) {
      const r = rogner(img);
      x = sc.x0 + r.dx / FINAL; y = sc.y0 + r.dy / FINAL;
      w = r.w / FINAL; h = r.h / FINAL;
      img = r;
    }
    ecrirePng(path.join(SORTIE, p.nom + '.png'), img.w, img.h, img.px);
    // `etat` et `ext` : de quoi laisser `viaManifeste` (fruticard.js) retrouver
    // le fichier d'un état, que le dessin vienne d'ici en PNG ou de
    // l'aplatisseur en SVG.
    manifeste[p.nom] = { lib: p.lib, data: p.data, params: p.params, w, h, x, y };
    if (p.etat !== undefined) { manifeste[p.nom].etat = p.etat; manifeste[p.nom].ext = 'png'; }
    console.log(p.nom + '.png  (' + img.w + '×' + img.h + ' → ' + w + '×' + h
      + ' à ' + x + ',' + y + ')');
  }
  fs.writeFileSync(path.join(SORTIE, 'manifeste.json'),
    JSON.stringify(manifeste, null, 1) + '\n');
  await nav.close();
  srv.close();
  console.log('→ public/fb/sd/  (' + PLANS.length + ' vignettes)');
}

// Attendre que l'image ne bouge plus : ces bibliothèques finissent par un
// `stop()`, mais Ruffle a besoin de quelques images pour arriver au bout de son
// préchargement (`gotoAndPlay(_totalframes - 1)`).
async function stabiliser(loc) {
  let avant = null;
  for (let i = 0; i < 40; i++) {
    const t = await loc.screenshot({ omitBackground: true });
    if (avant && Buffer.compare(avant, t) === 0) return t;
    avant = t;
    await new Promise((r) => setTimeout(r, 60));
  }
  return avant;
}

if (require.main === module) {
  principal().catch((e) => { console.error(e); process.exit(1); });
}
