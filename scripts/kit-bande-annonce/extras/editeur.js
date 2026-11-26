#!/usr/bin/env node
/*
 * KIT BANDE-ANNONCE / EXTRAS — « CRÉE TA BOUILLE ».
 *
 *   node scripts/kit-bande-annonce/extras/editeur.js [--apercu] [--sans-morph]
 *
 * 1. LE VRAI ÉDITEUR (extras/cree-ta-bouille/editeur-ma-frutibouille.mp4)
 *    La fenêtre « Ma Frutibouille » du light — celle qui s'ouvre d'elle-même à
 *    la première connexion. On remet Citronade (la « nouvelle venue » du
 *    casting) à la bouille par défaut, avec l'éditeur réclamé, et l'on filme :
 *    les flèches cliquées EN RYTHME font défiler yeux, iris, coiffures,
 *    bouche, couleur de peau et de cheveux, jusqu'à retomber exactement sur sa
 *    bouille du casting ; puis « valider ». Le bureau en 1280 × 720 à
 *    l'échelle 3, recadré en 16:9 autour de la fenêtre : elle occupe presque
 *    toute la hauteur de l'image 1920 × 1080.
 *
 * 2. LA MÊME SÉQUENCE, ISOLÉE ET EN GRAND (cree-ta-bouille/morph-*)
 *    On relève, image par image, l'état de la bouille de l'aperçu pendant le
 *    tournage, et on le rejoue dans l'atelier (moteur JS du site) sur un
 *    canevas de 1080 px : même chaîne d'état au même instant, donc
 *    synchronisée au pixel près avec le plan 1. L'éditeur ne pose pas
 *    d'accessoires (ils se gagnent à la boutique) : la version isolée enchaîne
 *    donc, sur le même tempo, sur les accessoires — et finit sur la bouille du
 *    casting, accessoire compris, qui éclate de rire.
 *    Trois sorties : WebM transparent, MP4 fond vert, MP4 sur le vert du parc.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const C = require('./commun.js');
const S = require('./scene.js');
const { ouvrirAtelier } = require('./atelier-bouille.js');

const APERCU = process.argv.includes('--apercu');
const FPS = APERCU ? 8 : 60;
const DEFAUT = '000000010000000000000000';
const SAC = [1, 2, 3];
// Les six rangées de l'éditeur (light.html, FB_PARTS) : position dans la
// chaîne, nombre de choix, rythme des clics (s).
const RANGEES = [
  { pos: 2, n: 9, pas: 0.2, vise: 8 },          // yeux
  { pos: 4, n: 18, pas: 0.2, vise: 9 },         // iris (les 18 d'origine)
  { pos: 6, n: 67, pas: 0.11, vise: 16, saute: SAC }, // cheveux, sans le sac à patate
  { pos: 8, n: 5, pas: 0.25, vise: 3 },         // bouche
  { pos: 10, n: 53, pas: 0.11, vise: 12 },      // couleur de peau
  { pos: 12, n: 53, pas: 0.2, vise: 4 },        // couleur des cheveux
];

const d62 = (c) => '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(c);
const e62 = (n) => '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[n];
const lire = (s, pos) => d62(s[pos]) * 62 + d62(s[pos + 1]);
const poser = (s, pos, v) => s.slice(0, pos) + e62(Math.floor(v / 62)) + e62(v % 62) + s.slice(pos + 2);

/*
 * Les clics d'une rangée : en avant ou en arrière, le sens dont le nombre de
 * clics est le plus proche de `vise` (assez pour que ça défile, pas trop
 * pour tenir dans la durée).
 */
function clicsPour(r, depart, cible) {
  const choix = []; for (let v = 0; v < r.n; v++) if (!(r.saute || []).includes(v)) choix.push(v);
  let i0 = choix.indexOf(depart); if (i0 < 0) i0 = 0;
  const i1 = choix.indexOf(cible);
  if (i1 < 0) return { sens: 1, n: 0 };
  const av = (i1 - i0 + choix.length) % choix.length, ar = (i0 - i1 + choix.length) % choix.length;
  return Math.abs(av - r.vise) <= Math.abs(ar - r.vise) ? { sens: 1, n: av } : { sens: -1, n: ar };
}

async function editeurReel(nav, cible) {
  // Citronade repart de zéro : bouille par défaut, éditeur réclamé.
  await C.compte('citronade', { fbouille: DEFAUT, needs_bouille: true });
  const sid = await C.compte('citronade');
  // Le bureau (1280 × 720, où la fenêtre s'ouvre au centre) photographié à
  // l'échelle 3, et recadré en 16:9 autour de la fenêtre : elle remplit
  // presque toute la hauteur de l'image, le bureau assombri tout autour.
  const cap = new C.Capture(nav, { largeur: 1280, hauteur: 720, echelle: 3, fps: FPS });
  await cap.ouvrir(C.BASE + '/light?sid=' + sid);
  await S.prechauffer(cap, 5);
  await cap.page.waitForSelector('#fb-editor.show', { timeout: 20000 });
  await C.attendre(600);
  // La fenêtre est en position fixe au centre de l'écran (translate −50 %) :
  // on cadre sur le centre de la fenêtre du navigateur et sur sa taille de mise
  // en page (offsetWidth/Height, que la transition d'ouverture ne déforme pas).
  const dim = await cap.page.evaluate(() => {
    const e = document.querySelector('#fb-editor');
    return { w: e.offsetWidth, h: e.offsetHeight, vw: innerWidth, vh: innerHeight };
  });
  const hClip = Math.round(dim.h * 1.1), lClip = Math.round(hClip * 16 / 9);
  const clip = { x: Math.round(dim.vw / 2 - lClip / 2), y: Math.round(dim.vh / 2 - hClip / 2),
    width: lClip, height: hClip };
  const etatApercu = () => cap.page.evaluate(() => {
    const c = document.querySelector('#fb-editor-preview canvas.fp-bvig');
    return c ? c.getAttribute('data-s') : null;
  });
  let etat = await etatApercu() || DEFAUT;
  const plans = [];
  let t = 0.7;
  const fleche = (k, sens) => '#fb-editor-rows .fb-row:nth-child(' + (k + 1) + ') .fb-arrow.' + (sens > 0 ? 'rgt' : 'lft');
  RANGEES.forEach((r, k) => {
    const { sens, n } = clicsPour(r, lire(etat, r.pos), lire(cible, r.pos));
    if (!n) return;
    plans.push({ t, vers: fleche(k, sens), duree: 0.28, clic: true });
    t += 0.28 + r.pas;
    for (let j = 1; j < n; j++) { plans.push({ t, clicIci: true }); t += r.pas; }
    t += 0.1;
  });
  plans.push({ t: t + 0.25, vers: '#fb-editor-valider', duree: 0.4, clic: true });
  const duree = t + 0.25 + 0.4 + 1.2;
  const d = C.dossier('cree-ta-bouille');
  const suf = APERCU ? '-apercu' : '';
  const mp4 = path.join(d, 'editeur-ma-frutibouille' + suf + '.mp4');
  const enc = C.encodeur({ mp4 }, { largeur: 1920, hauteur: 1080, fps: FPS });
  const etats = [];
  let affiche = null;
  const tAffiche = plans[Math.floor(plans.length * 0.55)].t;
  await S.tourner(cap, plans, { duree, clip, curseurEchelle: 0.62,
    depart: { x: clip.x + clip.width * 0.82, y: clip.y + clip.height * 0.7 },
    enc: async (img, i) => {
      await enc.ecrire(img);
      etats.push(await etatApercu() || etats[etats.length - 1] || DEFAUT);
      if (i === Math.round(tAffiche * FPS)) affiche = img;
    } });
  await enc.fin();
  await cap.fermer();
  if (affiche) {
    const tmp = mp4 + '.tmp.png'; fs.writeFileSync(tmp, affiche);
    require('child_process').execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp,
      '-vf', 'scale=1920:1080:flags=lanczos', mp4.replace(/\.mp4$/, '.png')]);
    fs.unlinkSync(tmp);
  }
  // Citronade retrouve sa bouille du casting (accessoires compris).
  await C.compte('citronade', { fbouille: cible });
  const fin = etats[etats.length - 1];
  return { mp4, etats, fin, plans, duree };
}

/*
 * La version isolée : on rejoue les états relevés, puis on enchaîne sur les
 * accessoires (même tempo), puis la bouille finale éclate de rire.
 */
async function morph(nav, releve, cible) {
  const ctx = await nav.newContext({ deviceScaleFactor: 1 });
  const page = await ouvrirAtelier(ctx, C.BASE, 1080);
  await page.evaluate((e) => kit.preparer(e), cible);
  await page.evaluate(([e, px]) => kit.monter(e, px, 0.13), [releve.etats[0], 1080]);
  // On part du premier clic : le temps d'ouverture de la fenêtre n'a pas de sens ici.
  const debut = Math.max(0, Math.round((releve.plans[0].t + releve.plans[0].duree - 0.4) * FPS));
  const etats = releve.etats.slice(debut);
  // Les accessoires : la coiffure finale garde son rouleau ; on parcourt
  // quelques accessoires et leurs couleurs sur le tempo, puis la bouille du
  // casting au complet.
  const face = releve.fin || etats[etats.length - 1];
  const accs = [];
  const tenues = [[1, 0, 21, 25, 30], [3, 0, 29, 44, 2], [5, 0, 33, 22, 15], [7, 0, 24, 9, 40], [9, 0, 37, 28, 18],
    [11, 0, 15, 30, 21], [13, 0, 20, 45, 33], [2, 0, 26, 33, 9]];
  let s = face;
  for (const [a, a2, c1, c2, c3] of tenues) {
    s = poser(poser(poser(poser(poser(face, 14, a), 16, a2), 18, c1), 20, c2), 22, c3);
    for (let k = 0; k < Math.round(0.3 * FPS); k++) accs.push(s);
  }
  const finale = cible;
  const suite = etats.concat(accs);
  const nFinale = Math.round(2.2 * FPS);
  const d = C.dossier('cree-ta-bouille');
  const suf = APERCU ? '-apercu' : '';
  const base = path.join(d, 'morph-bouille' + suf);
  const enc = C.encodeur({ webm: base + '.webm', vert: base + '-vert.mp4' }, { largeur: 1920, hauteur: 1080, fps: FPS, pad: true });
  const encParc = C.encodeur({ mp4: base + '-vert-parc.mp4', fond: C.VERT_PARC }, { largeur: 1920, hauteur: 1080, fps: FPS, pad: true });
  let precedent = null, png = null, affiche = null;
  const cad = await page.evaluate(() => kit.CADENCE);
  for (let i = 0; i < suite.length + nFinale; i++) {
    const cibleTick = Math.floor((i / FPS) * cad);
    let bouge = await page.evaluate((c) => kit.avancerA(c), cibleTick);
    if (i < suite.length) {
      if (suite[i] !== precedent) { await page.evaluate((e) => kit.definir(e, 0), suite[i]); precedent = suite[i]; bouge = true; }
    } else if (i === suite.length) {
      await page.evaluate((e) => { kit.definir(e, 4); kit.animer(2); return true; }, finale); bouge = true;
    }
    if (bouge || !png) png = Buffer.from(await page.evaluate(() => kit.png()), 'base64');
    await enc.ecrire(png); await encParc.ecrire(png);
    if (i === etats.length + Math.round(0.45 * FPS)) affiche = png;
  }
  await enc.fin(); await encParc.fin();
  if (affiche) {
    const tmp = base + '.tmp.png'; fs.writeFileSync(tmp, affiche);
    require('child_process').execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp,
      '-vf', 'format=rgba,pad=1920:1080:(ow-iw)/2:0:color=black@0', base + '.png']);
    fs.unlinkSync(tmp);
  }
  await ctx.close();
  return base;
}

async function main() {
  const srv = await C.demarrerServeur();
  const cast = C.casting();
  const cible = (cast.liste.find((p) => p.pseudo === 'citronade') || cast.liste[0]).bouille;
  const nav = await chromium.launch();
  let releve, base;
  try {
    releve = await editeurReel(nav, cible);
    console.log('éditeur filmé :', releve.etats.length, 'images, état final', releve.fin, '(visé', cible.slice(0, 14) + ')');
    // --sans-morph : seul le plan de l'éditeur est refait ; la version isolée
    // déjà rendue reste valable (même plan de clics → mêmes états, mêmes instants).
    base = process.argv.includes('--sans-morph')
      ? path.join(C.SORTIE, 'cree-ta-bouille', 'morph-bouille' + (APERCU ? '-apercu' : ''))
      : await morph(nav, releve, cible);
  } finally { await nav.close(); srv.arreter(); }
  if (APERCU) return;
  const rel = (f) => path.relative(C.SORTIE, f);
  C.majManifeste(['cree-ta-bouille/'], [
    C.entreeVideo(rel(releve.mp4), { titre: 'Crée ta bouille — le vrai éditeur',
      description: 'La fenêtre « Ma Frutibouille » du site, telle qu’elle s’ouvre à la première connexion (compte fictif '
        + 'Citronade, la nouvelle venue). Les flèches, cliquées en rythme, font défiler yeux, iris, coiffures, bouche, '
        + 'couleur de peau et de cheveux, jusqu’à sa bouille du casting — puis « valider ». Curseur ajouté.',
      usage: 'Séquence « crée ta bouille » ; se cale sur la version isolée (même chaîne d’état au même instant, '
        + 'à partir du premier clic).', affiche: rel(releve.mp4.replace(/\.mp4$/, '.png')) }),
    C.entreeVideo(rel(base + '.webm'), { titre: 'Crée ta bouille — la bouille seule, en grand',
      description: 'La même séquence rendue par le moteur JS du site sur un canevas de 1080 px, centrée en 1920 × 1080 : '
        + 'les états relevés image par image pendant le tournage de l’éditeur, puis — sur le même tempo — un défilé '
        + 'd’accessoires et de couleurs d’accessoires (l’éditeur n’en pose pas : ils se gagnent), et la bouille finale '
        + 'de Citronade qui éclate de rire. Transparent ; fond vert et fond vert du parc en variantes.',
      usage: 'Incrustation rythmée sur la musique, transition entre deux plans.', alpha: true,
      affiche: rel(base + '.png'), variantes: [rel(base + '-vert.mp4'), rel(base + '-vert-parc.mp4')] }),
  ]);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
