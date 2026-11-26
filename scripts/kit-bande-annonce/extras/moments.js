#!/usr/bin/env node
/*
 * KIT BANDE-ANNONCE / EXTRAS — DES MOMENTS DE LA VIE DU SITE.
 *
 *   node scripts/kit-bande-annonce/extras/moments.js [nom…] [--apercu]
 *
 * Le vrai site, sur un serveur local peuplé d'un monde FICTIF (monde.js), filmé
 * image par image (scene.js, horloge pilotée) en 1920 × 1080 à 60 i/s :
 *
 *   connexion        l'écran d'accueil du light (logo, fruits), on tape son
 *                    pseudo et son code, « Se connecter » → le bureau Frutiz ;
 *   bureau           le bureau Frutiz, des fenêtres qui s'ouvrent : la
 *                    Boutique (et ses kikooz), les Scores (classement kikooz),
 *                    le Bouilloscope, les disques ;
 *   accueil-mobile   le light sur téléphone : l'avatar qui change d'humeur,
 *                    la série de connexion, la liste des salons et des jeux —
 *                    en vertical 1080 × 1920 et posé sur le vert en 1920 × 1080 ;
 *   pictos           la collection de pictos de l'inventaire (bureau) ;
 *   forum            un sujet du forum, les bouilles du casting en avatars.
 *
 * --apercu : 8 i/s, pour régler une scène vite (fichiers *-apercu.mp4).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const C = require('./commun.js');
const S = require('./scene.js');
const monde = require('./monde.js');

const APERCU = process.argv.includes('--apercu');
const FPS = APERCU ? 8 : 60;

function sorties(nom, extra) {
  const d = C.dossier('moments');
  const suf = APERCU ? '-apercu' : '';
  return Object.assign({ mp4: path.join(d, nom + suf + '.mp4') }, extra || {});
}

async function ouvrir(nav, url, o) {
  const cap = new C.Capture(nav, Object.assign({ fps: FPS }, o));
  await cap.ouvrir(C.BASE + url);
  return cap;
}

// L'affiche : on garde l'image de l'instant choisi et on l'écrit en PNG
// 1920 × 1080 (mise à l'échelle par ffmpeg si la capture est plus grande).
function ecrireAffiche(img, fichier, L, H) {
  const tmp = fichier + '.tmp.png';
  fs.writeFileSync(tmp, img);
  require('child_process').execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp,
    '-vf', 'scale=' + (L || 1920) + ':' + (H || 1080) + ':flags=lanczos', fichier]);
  fs.unlinkSync(tmp);
}

// ── Le bureau Frutiz : des fenêtres qui s'ouvrent ─────────────────────────
async function bureau(nav, sids) {
  const cap = await ouvrir(nav, '/light?sid=' + sids.pomelo, { largeur: 1280, hauteur: 720, echelle: 1.5 });
  await S.prechauffer(cap, 6);
  const o = sorties('bureau-fenetres');
  const enc = C.encodeur(o, { largeur: 1920, hauteur: 1080, fps: FPS });
  let affiche = null;
  const tuile = (go) => '.home-tile[data-go="' + go + '"]';
  await S.tourner(cap, [
    { t: 0.5, vers: tuile('shop'), duree: 0.8, clic: true, reseau: 700 },
    { t: 2.0, vers: '[data-r="0"]:not([data-a]) >> visible=true', duree: 0.6, clic: true, reseau: 700 },
    { t: 3.0, vers: '[data-r="0"][data-a="1"] >> visible=true', duree: 0.5, clic: true, reseau: 500 },
    { t: 4.0, vers: '[data-r="0"][data-a="2"] >> visible=true', duree: 0.4, clic: true, reseau: 500 },
    { t: 5.4, vers: tuile('scores'), duree: 0.8, clic: true, reseau: 900 },
    { t: 7.0, vers: 'text=Class. kikooz >> visible=true', duree: 0.6, clic: true, reseau: 700 },
    { t: 9.4, vers: tuile('trombi'), duree: 0.8, clic: true, reseau: 900 },
    // On promène le curseur sur les bouilles (le survol du site les souligne).
    { t: 11.4, vers: [330, 400], duree: 1.2 },
    { t: 12.9, vers: [520, 470], duree: 1.1 },
  ], { duree: 15, enc, depart: { x: 1000, y: 470 }, affiche: 12.5, surAffiche: (img) => { affiche = img; } });
  await enc.fin();
  if (affiche) ecrireAffiche(affiche, o.mp4.replace(/\.mp4$/, '.png'));
  await cap.fermer();
  return [C.entreeVideo(path.relative(C.SORTIE, o.mp4), { titre: 'Le bureau Frutiz — des fenêtres qui s’ouvrent',
    description: 'Le vrai bureau Frutiz (portage du bureau Flash), compte fictif Pomelo : on ouvre la Boutique (solde '
      + 'de kikooz, rayon Accessoires), les Scores et le classement des kikooz (le casting), puis le Bouilloscope '
      + '(les bouilles du casting et de figurants inventés). Curseur ajouté pour mimer les clics.',
    usage: 'Plan « tout un univers » : montrer qu’il y a un vrai bureau, des fenêtres, une boutique, des classements.',
    affiche: path.relative(C.SORTIE, o.mp4.replace(/\.mp4$/, '.png')) })];
}

// Un défilement DOUX : de petits crans de molette, trente par seconde, entre
// t0 et t1 (un seul grand cran ferait sauter la page d'une image à l'autre).
function defiler(t0, t1, px) {
  const n = Math.max(1, Math.round((t1 - t0) * 30));
  return Array.from({ length: n }, (_, k) => ({ t: t0 + k / 30,
    faire: async (page) => { await page.mouse.wheel(0, px / n); } }));
}

// ── La connexion : l'écran d'accueil, puis le bureau ──────────────────────
async function connexion(nav) {
  const cap = await ouvrir(nav, '/light', { largeur: 1280, hauteur: 720, echelle: 1.5 });
  await S.prechauffer(cap, 2);
  const o = sorties('connexion');
  const enc = C.encodeur(o, { largeur: 1920, hauteur: 1080, fps: FPS });
  let affiche = null;
  const taper = (texte, t0, pas) => [...texte].map((ch, k) => ({ t: t0 + k * pas,
    faire: async (page) => { await page.keyboard.type(ch); } }));
  await S.tourner(cap, [
    { t: 1.0, vers: '#li-user', duree: 0.8, clic: true },
    ...taper('pomelo', 2.0, 0.13),
    { t: 3.0, vers: '#li-pass', duree: 0.5, clic: true },
    ...taper('kit-bande-annonce', 3.7, 0.06),
    // « Se connecter » : la page se recharge sur le bureau. On laisse le réseau
    // livrer la nouvelle page (temps réel) ; l'horloge reprend ensuite.
    { t: 5.0, vers: '#li-btn', duree: 0.6, clic: true, reseau: 3500 },
    { t: 6.6, vers: [1000, 470], duree: 1.2 },
  ], { duree: 9.5, enc, depart: { x: 1050, y: 560 }, affiche: 1.2, surAffiche: (img) => { affiche = img; } });
  await enc.fin();
  if (affiche) ecrireAffiche(affiche, o.mp4.replace(/\.mp4$/, '.png'));
  await cap.fermer();
  return [C.entreeVideo(path.relative(C.SORTIE, o.mp4), { titre: 'La connexion — du logo au bureau',
    description: 'L’écran d’accueil du site (logo, grappe de fruits, « Des fruits, des jeux, du chat ! ») : on tape '
      + 'son pseudo (Pomelo, compte fictif) et son code secret, « Se connecter »… et le bureau Frutiz se monte, '
      + 'le salon Pomme s’ouvre. Curseur ajouté pour mimer la saisie et le clic.',
    usage: 'Ouverture de la bande-annonce, ou plan « rejoins-nous » de fin.',
    affiche: path.relative(C.SORTIE, o.mp4.replace(/\.mp4$/, '.png')) })];
}

// ── Le light sur téléphone ────────────────────────────────────────────────
/*
 * 432 × 768 à l'échelle 2,5 : 1080 × 1920, un téléphone en vertical. On en
 * tire ensuite une version 1920 × 1080 où l'écran est posé, centré, sur le
 * vert du parc.
 */
async function telephone(nav, sids, nom, plans, duree, tAffiche, champs) {
  const cap = await ouvrir(nav, '/light?sid=' + sids.pomelo, { largeur: 432, hauteur: 768, echelle: 2.5, mobile: true });
  await S.prechauffer(cap, 6);
  const o = sorties(nom + '-vertical');
  const enc = C.encodeur(o, { largeur: 1080, hauteur: 1920, fps: FPS });
  let affiche = null;
  await S.tourner(cap, plans, { duree, enc, doigt: true, depart: { x: 300, y: 600 },
    affiche: tAffiche, surAffiche: (img) => { affiche = img; } });
  await enc.fin();
  await cap.fermer();
  const vertical = o.mp4;
  const horizontal = vertical.replace('-vertical', '');
  // La version paysage : l'écran du téléphone, 1000 px de haut, liseré vert
  // sapin, centré sur le vert du parc.
  require('child_process').execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', vertical,
    '-filter_complex', 'color=c=0xADE76B:s=1920x1080:r=' + FPS + '[f];[0]scale=562:1000:flags=lanczos,'
      + 'pad=578:1016:8:8:color=0x2C4A0F[t];[f][t]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', horizontal]);
  if (affiche) {
    ecrireAffiche(affiche, vertical.replace(/\.mp4$/, '.png'), 1080, 1920);
    C.extraireImage(horizontal, tAffiche, horizontal.replace(/\.mp4$/, '.png'));
  }
  const rel = (f) => path.relative(C.SORTIE, f);
  return [C.entreeVideo(rel(horizontal), Object.assign({}, champs, {
    affiche: rel(horizontal.replace(/\.mp4$/, '.png')), variantes: [rel(vertical), rel(vertical.replace(/\.mp4$/, '.png'))] }))];
}

async function accueilMobile(nav, sids) {
  const emote = (k) => '#home-emotes > *:nth-child(' + k + ')';
  return telephone(nav, sids, 'accueil-mobile', [
    { t: 0.8, vers: emote(5), duree: 0.4, clic: true },
    { t: 1.7, vers: emote(2), duree: 0.4, clic: true },
    { t: 2.6, vers: emote(7), duree: 0.4, clic: true },
    { t: 3.5, vers: emote(4), duree: 0.4, clic: true },
    { t: 4.6, vers: '.home-tile[data-go="disques"]', duree: 0.5, clic: true, reseau: 900 },
    { t: 9.0, vers: '.sheet .sheet-head button >> visible=true', duree: 0.5, clic: true },
    // Les disques s'ouvrent par-dessus le salon : « ‹ » ramène à l'accueil.
    { t: 9.9, vers: '#menu-btn', duree: 0.5, clic: true },
    { t: 11.0, vers: '.home-tile[data-go="trombi"]', duree: 0.5, clic: true, reseau: 1200 },
    ...defiler(12.8, 14.6, 320),
  ], 15.5, 7.2, { titre: 'Le light sur téléphone — l’accueil, les disques, le Bouilloscope',
    description: 'Le client mobile du site, compte fictif Pomelo : la bouille de l’accueil change d’humeur au fil '
      + 'des émotes, la série de connexion (+10 kikooz), puis « Mes disques » — tous les jeux du parc — et le '
      + 'Bouilloscope. Version paysage (l’écran posé sur le vert du parc) ; la version verticale 1080 × 1920 est '
      + 'en variante. Les appuis du doigt sont figurés par une pastille.',
    usage: 'Plan « et sur ton téléphone » ; la version verticale pour les formats courts.' });
}

async function pictos(nav, sids) {
  return telephone(nav, sids, 'pictos-mobile', [
    { t: 0.6, vers: '.home-tile[data-go="inventaire"]', duree: 0.5, clic: true, reseau: 900 },
    { t: 2.0, vers: '.inv-onglet[data-rub="pictos"]', duree: 0.5, clic: true, reseau: 900 },
    // On fait défiler la collection (la molette, au-dessus de la liste).
    { t: 3.4, vers: [216, 560], duree: 0.3 },
    ...defiler(4.2, 8.4, 760),
  ], 10, 3.6, { titre: 'La collection de pictos (téléphone)',
    description: 'L’inventaire du light, onglet Pictos : la collection d’un joueur fictif (27 pictos de Kaluga et '
      + 'de Swapou, accordés par l’admin sur le serveur local), rangée par jeu, qu’on fait défiler.',
    usage: 'Plan « collectionne les pictos » ; les images des pictos sont celles des jeux d’époque.' });
}

// ── Le forum ──────────────────────────────────────────────────────────────
async function forum(nav, sids) {
  // 960 × 540 à l'échelle 2 : le forum en gros plan, les avatars bien lisibles.
  const cap = await ouvrir(nav, '/fb/?sid=' + sids.pomelo, { largeur: 960, hauteur: 540, echelle: 2 });
  await S.prechauffer(cap, 3);
  const o = sorties('forum');
  const enc = C.encodeur(o, { largeur: 1920, hauteur: 1080, fps: FPS });
  let affiche = null;
  await S.tourner(cap, [
    { t: 0.8, vers: 'a >> text=/^Frutiz$/ >> visible=true', duree: 0.9, clic: true, reseau: 900 },
    { t: 2.8, vers: 'text=Qui se souvient du parc en 2005 >> visible=true', duree: 0.8, clic: true, reseau: 1200 },
    { t: 4.4, vers: [560, 300], duree: 1.2 },
    ...defiler(5.8, 9.4, 420),
    { t: 9.6, vers: [420, 360], duree: 1.4 },
  ], { duree: 12, enc, depart: { x: 700, y: 380 }, affiche: 4.8, surAffiche: (img) => { affiche = img; } });
  await enc.fin();
  if (affiche) ecrireAffiche(affiche, o.mp4.replace(/\.mp4$/, '.png'));
  await cap.fermer();
  return [C.entreeVideo(path.relative(C.SORTIE, o.mp4), { titre: 'Le forum — les bouilles en avatars',
    description: 'Le forum du site (habillage phpBB d’époque) : on entre dans « Frutiz », puis dans le sujet « Qui se '
      + 'souvient du parc en 2005 ? » écrit par le casting fictif (Grenadix, Kiwinette, Banagaga, Myrtillou) — '
      + 'chaque message porte la bouille de son auteur, rendue par le moteur JS.',
    usage: 'Plan « une communauté » / « on se souvient ».',
    affiche: path.relative(C.SORTIE, o.mp4.replace(/\.mp4$/, '.png')) })];
}

const SCENES = { connexion, bureau, accueil: accueilMobile, pictos, forum };

async function main() {
  const demandes = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const noms = demandes.length ? demandes : Object.keys(SCENES);
  const srv = await C.demarrerServeur();
  const { sids } = await monde.peupler();
  const nav = await chromium.launch();
  const elements = [];
  try {
    for (const nom of noms) {
      const t0 = Date.now();
      const els = await SCENES[nom](nav, sids);
      elements.push(...els);
      console.log(nom, 'tourné en', Math.round((Date.now() - t0) / 1000), 's');
    }
  } finally { await nav.close(); srv.arreter(); }
  if (!APERCU) {
    const m = C.lireManifeste();
    // On ne remplace que les entrées des scènes qu'on vient de tourner.
    const faits = elements.map((e) => e.fichier);
    const autres = m.elements.filter((e) => e.fichier.startsWith('moments/') && !faits.includes(e.fichier));
    C.majManifeste(['moments/'], autres.concat(elements));
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { SCENES };
