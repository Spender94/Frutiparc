#!/usr/bin/env node
// public/awards.swf : donne aux deux classements PILOTES une vignette de
// médaille sous LEUR PROPRE NOM.
//
//   node scripts/patch-awards-vignettes.js
//
// ── Le problème ──
//
// awards.swf est une pellicule d'images étiquetées, une par jeu de 2006 :
// `gotoAndStop(<étiquette>)` choisit le dessin, `ico.gotoAndStop(<rang>)` la
// couleur du métal. Deux endroits du bureau demandent une médaille, et ils ne
// nomment PAS l'étiquette de la même façon :
//
//   · la FICHE d'un joueur (awarduser / <hb>) prend le nom dans la réponse du
//     serveur — c'est nous qui choisissons, d'où la table MEDAL_AWARD_FRAME
//     (miniwave → « wave », minipixiz → « tris ») ;
//   · le TABLEAU DES SCORES, lui, ne demande rien : main.swf construit
//     `{frame: currentRanking.game, value: <rang>}` avec l'identifiant de jeu
//     du classement (« miniwave », « minipixiz »). Hors de portée du serveur.
//
// Ces deux étiquettes-là n'existent pas dans awards.swf (il est plus vieux que
// les deux jeux) : le clip restait sur sa première image — le disque vert vide
// qu'on voyait en tête des scores MiniWave.
//
// ── Le correctif ──
//
// Une image de pellicule peut porter PLUSIEURS étiquettes : le lecteur range
// chaque FrameLabel dans sa table « nom → numéro d'image ». On ajoute donc,
// sur les images qui portent déjà le bon dessin, une étiquette de plus :
//
//   image « wave » (le vaisseau de Mini-Wave, sa vignette d'époque) → + « miniwave »
//   image « tris » (empruntée à Tris — MiniPixiz n'en a jamais eu)  → + « minipixiz »
//
// Aucun dessin n'est ajouté, aucune image n'est déplacée : deux tags de plus,
// et les deux noms marchent partout. Le jour où l'on dessine une vraie vignette
// MiniPixiz, elle prendra la place de l'emprunt sans que rien d'autre ne bouge.
//
// Le script est idempotent : il ne fait rien si les étiquettes sont déjà là.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF = path.resolve(__dirname, '..', 'public', 'awards.swf');

// Les alias à poser : <nouvelle étiquette> sur l'image de <étiquette existante>.
const ALIAS = [
  { nouveau: 'miniwave', surCelleDe: 'wave' },
  { nouveau: 'minipixiz', surCelleDe: 'tris' },
];

const TAG_FRAME_LABEL = 43;
const TAG_SHOW_FRAME = 1;
const TAG_END = 0;

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('signature inconnue : ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version: raw[3], body };
}

function ecrireSwf(p, sig, version, body) {
  const charge = sig === 'CWS' ? zlib.deflateSync(body) : body;
  const out = Buffer.alloc(8 + charge.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + body.length, 4);          // taille DÉCOMPRESSÉE, en-tête compris
  charge.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}

// Début de la liste de tags : rect du cadre (bits) + frameRate (2) + frameCount (2).
function debutDesTags(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  return Math.ceil((5 + nbits * 4) / 8) + 4;
}

// Parcourt les tags de premier niveau. `f(code, offsetTag, entete, longueur)`.
function parcourir(body, f) {
  let o = debutDesTags(body);
  while (o < body.length - 1) {
    const hdr = body.readUInt16LE(o);
    const code = hdr >> 6;
    let len = hdr & 0x3f, h = 2;
    if (len === 0x3f) { len = body.readUInt32LE(o + 2); h = 6; }
    if (code === TAG_END) return;
    if (f(code, o, h, len) === false) return;
    o += h + len;
  }
}

function tagFrameLabel(nom) {
  const txt = Buffer.from(nom + '\0', 'latin1');
  const t = Buffer.alloc(2 + txt.length);
  t.writeUInt16LE((TAG_FRAME_LABEL << 6) | txt.length, 0);   // forme courte : nom ≤ 62 o
  txt.copy(t, 2);
  return t;
}

function patch() {
  const { sig, version, body } = lireSwf(SWF);

  // Où sont les étiquettes existantes, et où finit leur image (le ShowFrame) ?
  const etiquettes = {};
  const finImage = {};                                  // étiquette → offset du ShowFrame
  let courante = null;
  parcourir(body, (code, o, h, len) => {
    if (code === TAG_FRAME_LABEL) {
      const fin = body.indexOf(0, o + h);
      courante = body.slice(o + h, fin).toString('latin1');
      etiquettes[courante] = o;
    } else if (code === TAG_SHOW_FRAME && courante) {
      finImage[courante] = o;
      courante = null;
    }
  });

  const aFaire = ALIAS.filter((a) => etiquettes[a.nouveau] === undefined);
  for (const a of ALIAS) {
    if (etiquettes[a.surCelleDe] === undefined) {
      throw new Error(`l'étiquette « ${a.surCelleDe} » est introuvable dans awards.swf`);
    }
  }
  if (aFaire.length === 0) {
    console.log('awards.swf porte déjà les étiquettes ' + ALIAS.map((a) => a.nouveau).join(', ') + ' — rien à faire.');
    return;
  }

  // On insère chaque nouvelle étiquette JUSTE AVANT le ShowFrame de l'image
  // visée : elle appartient donc à cette image-là, après le PlaceObject qui y
  // pose le dessin. En partant de la fin, les offsets déjà calculés restent
  // valables.
  const points = aFaire
    .map((a) => ({ a, at: finImage[a.surCelleDe] }))
    .sort((x, y) => y.at - x.at);

  let out = body;
  for (const { a, at } of points) {
    if (at === undefined) throw new Error(`image de « ${a.surCelleDe} » sans ShowFrame`);
    const tag = tagFrameLabel(a.nouveau);
    out = Buffer.concat([out.slice(0, at), tag, out.slice(at)]);
    console.log(`+ étiquette « ${a.nouveau} » sur l'image de « ${a.surCelleDe} » (offset ${at})`);
  }

  const taille = ecrireSwf(SWF, sig, version, out);
  console.log(`awards.swf réécrit : ${taille} octets (corps ${out.length}).`);
}

patch();
