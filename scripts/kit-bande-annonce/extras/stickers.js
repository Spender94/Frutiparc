#!/usr/bin/env node
/*
 * KIT BANDE-ANNONCE / EXTRAS — LES STICKERS DE BOUILLES.
 *
 *   node scripts/kit-bande-annonce/extras/stickers.js [pseudo…] [--sans-emotes]
 *
 * Pour chaque personnage du casting (kit-bande-annonce/casting.json, RELU au
 * lancement : l'agent « chat » peut y avoir changé des bouilles) et pour le
 * spectateur :
 *
 *   · les HUIT HUMEURS en PNG transparents de 1024 px
 *       extras/stickers/<pseudo>/<pseudo>-<humeur>.png
 *     plus une planche 8 humeurs (<pseudo>-humeurs.png, sur le vert du parc) ;
 *   · TOUTES LES ÉMOTES du moteur (actions 1 à 21 : parler, rire… jutsu,
 *     toux, gum d'hiko, clin d'œil, bisou, 67, assommé, explose), chacune en
 *       extras/stickers/<pseudo>/emotes/<pseudo>-<emote>.webm      transparent
 *       extras/stickers/<pseudo>/emotes/<pseudo>-<emote>-vert.mp4  fond vert
 *       extras/stickers/<pseudo>/emotes/<pseudo>-<emote>.png       affiche
 *     en 768 × 768, 60 i/s : un temps de repos, l'émote entière, un temps de
 *     repos. (768 et non 1024 : 189 vidéos, deux encodages chacune, sur une
 *     machine partagée — une bouille d'émote s'incruste rarement à plus d'un
 *     demi-écran, et les PNG des humeurs, eux, restent en 1024.)
 *
 * Le manifeste est mis à jour après CHAQUE personnage : un rendu interrompu
 * laisse un kit cohérent avec ce qui est déjà fait. Le spectateur passe en
 * dernier. `--sans-humeurs` saute les PNG (déjà faits).
 *
 * REPRISE : une émote dont les trois fichiers existent déjà, à la bonne
 * taille, n'est pas refaite — relancer la commande reprend où l'on s'était
 * arrêté. On peut aussi partager le travail entre plusieurs processus (un
 * groupe de pseudos chacun), puis `--manifeste` réécrit les entrées de tous
 * les personnages d'après les fichiers présents, sans rien rendre :
 *
 *   node stickers.js kiwinette prunox myrtillou &
 *   node stickers.js citronade fraizou banagaga &
 *   node stickers.js litchiloo grenadix pomelo &
 *   wait; node stickers.js --manifeste
 *
 * Tout est rendu par le moteur JS du site (atelier-bouille.js), à la cadence du
 * parc (24 battements/s) : à 60 i/s une image de moteur tient 2 ou 3 images
 * vidéo, exactement ce qu'on voit sur un écran à 60 Hz. On ne photographie que
 * quand le moteur a bougé, et l'on répète l'image précédente sinon.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const C = require('./commun.js');
const { ouvrirAtelier } = require('./atelier-bouille.js');

const PX = 1024;               // les PNG des humeurs
const PX_EMOTE = 768;          // les vidéos d'émotes
const MARGE = 0.15;            // de l'air autour : chignons, fumée, étoiles
const FPS = 60;
const AVANT = 0.4, APRES = 0.7; // secondes de repos autour de l'émote
const PLAFOND = 9;             // une émote ne dure jamais plus (sécurité)
const PARLE = 2.6;             // « parle » boucle tant qu'on parle : on coupe

const HUMEURS = ['neutre', 'colere', 'triste', 'sourire', 'joie', 'determine', 'embarrasse', 'totoche'];
const EMOTES = [null, 'parler', 'rire', 'mdr', 'langue', 'rougir', 'regard', 'sifflote', 'chewing-gum',
  'question', 'miam', 'pleurer', 'larme', 'beurk', 'jutsu', 'tousse', 'gum-hiko', 'clin-oeil', 'bisou',
  'sixsept', 'assomme', 'explose'];

async function humeurs(page, perso, dos) {
  const fichiers = [];
  for (let h = 0; h < 8; h++) {
    await page.evaluate(([e, px, m]) => kit.monter(e, px, m), [perso.bouille, PX, MARGE]);
    await page.evaluate((n) => kit.humeur(n), h);
    // Quelques battements : l'éclat de l'iris est posé, comme sur le site.
    await page.evaluate(() => kit.avancerA(3));
    const png = Buffer.from(await page.evaluate(() => kit.png()), 'base64');
    const f = path.join(dos, perso.pseudo + '-' + HUMEURS[h] + '.png');
    fs.writeFileSync(f, png);
    fichiers.push(f);
  }
  // La planche : les huit têtes côte à côte, sur le vert du parc.
  const planche = path.join(dos, perso.pseudo + '-humeurs.png');
  const entrees = []; fichiers.forEach((f) => entrees.push('-i', f));
  const pile = fichiers.map((_, i) => '[' + i + ':v]scale=480:480[t' + i + ']').join(';')
    + ';' + fichiers.map((_, i) => '[t' + i + ']').join('')
    + 'xstack=inputs=8:layout=0_0|w0_0|w0+w1_0|w0+w1+w2_0|0_h0|w0_h0|w0+w1_h0|w0+w1+w2_h0[g];'
    + 'color=c=0xADE76B:s=1920x960[f];[f][g]overlay=format=auto';
  require('child_process').execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    ...entrees, '-filter_complex', pile, '-frames:v', '1', planche]);
  return fichiers;
}

async function emote(page, perso, n, dos) {
  const nom = EMOTES[n];
  const base = path.join(dos, perso.pseudo + '-' + nom);
  await page.evaluate(([e, px, m]) => kit.monter(e, px, m), [perso.bouille, PX_EMOTE, MARGE]);
  const enc = C.encodeur({ webm: base + '.webm', vert: base + '-vert.mp4' }, { largeur: PX_EMOTE, hauteur: PX_EMOTE, fps: FPS, vite: true });
  const cad = await page.evaluate(() => kit.CADENCE);
  let png = Buffer.from(await page.evaluate(() => kit.png()), 'base64');
  let lance = false, finImage = -1, affiche = null;
  const iAvant = Math.round(AVANT * FPS);
  const max = Math.round((AVANT + PLAFOND + APRES) * FPS);
  let debutTick = 0;
  for (let i = 0; i < max; i++) {
    if (!lance && i >= iAvant) {
      debutTick = await page.evaluate((k) => { kit.animer(k); return kit.ticks; }, n);
      lance = true;
    }
    // Le battement visé : 24 par seconde depuis le début du clip. Un seul
    // aller-retour par image (avancer, photographier si ça a bougé, état).
    const cible = Math.floor((i / FPS) * cad);
    const etat = await page.evaluate(([c, f]) => kit.image(c, f), [cible, i === iAvant]);
    if (etat.png) png = Buffer.from(etat.png, 'base64');
    await enc.ecrire(png);
    if (lance && finImage < 0) {
      const ecoule = (etat.ticks - debutTick) / cad;
      if (n === 1 && ecoule >= PARLE) await page.evaluate(() => kit.arreter());
      if (etat.fin || (n === 1 && ecoule >= PARLE)) finImage = i;
      // L'affiche : l'image du milieu de l'émote (on la garde au passage).
      if (!affiche && ecoule >= 0.45 * estimer(n)) affiche = png;
    }
    if (finImage >= 0 && i >= finImage + Math.round(APRES * FPS)) break;
  }
  await enc.fin();
  fs.writeFileSync(base + '.png', affiche || png);
  return base;
}

// Une durée indicative (s) pour choisir l'image d'affiche — le milieu du geste.
function estimer(n) {
  return { 1: 2.6, 7: 1.6, 8: 4.5, 14: 5.6, 16: 4.5, 19: 2.4, 20: 2.5, 21: 3 }[n] || 1.4;
}

// Les noms d'émotes tels que le parc les affiche, lus dans le moteur lui-même.
const NOMS = require(path.join(C.RACINE, 'public/js/bouille-moteur.js')).NOMS_ANIMATIONS;

function fichierEmote(p, n) {
  return path.join(C.SORTIE, 'stickers', p.pseudo, 'emotes', p.pseudo + '-' + EMOTES[n]);
}

/** Une émote complète (les trois fichiers) et à la bonne taille. */
function dejaFaite(p, n) {
  const b = fichierEmote(p, n);
  if (![b + '.webm', b + '-vert.mp4', b + '.png'].every((f) => fs.existsSync(f) && fs.statSync(f).size > 0)) return false;
  try { return C.sonder(b + '.webm').largeur === PX_EMOTE && C.sonder(b + '-vert.mp4').largeur === PX_EMOTE; } catch (e) { return false; }
}

/** Les entrées de manifeste d'un personnage, d'après les fichiers présents. */
function entreesDe(p) {
  const relD = 'stickers/' + p.pseudo + '/';
  const groupe = 'Stickers — ' + p.affiche;
  const els = [];
  if (fs.existsSync(path.join(C.SORTIE, relD, p.pseudo + '-humeurs.png'))) {
    els.push({ fichier: relD + p.pseudo + '-humeurs.png', type: 'image', groupe,
      titre: p.affiche + ' — les 8 humeurs', largeur: 1920, hauteur: 960, alpha: false,
      description: 'Planche des huit humeurs de ' + p.affiche + ' (' + (p.role === 'spectateur' ? 'le spectateur' : p.caractere)
        + '), rendues par le moteur JS du site. Bouille ' + p.bouille + '. Les huit PNG transparents 1024 px sont en variantes.',
      usage: 'Réactions incrustées, vignettes de personnages, cartons « qui est qui ».',
      variantes: HUMEURS.map((h) => relD + p.pseudo + '-' + h + '.png') });
  }
  for (let n = 1; n < EMOTES.length; n++) {
    if (!dejaFaite(p, n)) continue;
    const rel = relD + 'emotes/' + p.pseudo + '-' + EMOTES[n];
    const s = C.sonder(path.join(C.SORTIE, rel + '.webm'));
    els.push({ fichier: rel + '.webm', type: 'video', groupe,
      titre: p.affiche + ' — ' + NOMS[n],
      description: 'Émote « ' + NOMS[n] + ' » de ' + p.affiche
        + ', telle que le chat la joue (moteur JS du site, cadence du parc). Repos, émote, repos.',
      usage: 'À incruster (WebM transparent) ou détourer (MP4 fond vert).',
      duree: s.duree, fps: s.fps, largeur: s.largeur, hauteur: s.hauteur, alpha: true, octets: s.octets,
      affiche: rel + '.png', variantes: [rel + '-vert.mp4'] });
  }
  return els;
}

async function main() {
  const args = process.argv.slice(2);
  const sansEmotes = args.includes('--sans-emotes');
  const sansHumeurs = args.includes('--sans-humeurs');
  // --emotes=2,14,21 : seulement ces émotes (essais) — le manifeste n'est alors pas touché.
  const seules = (args.find((a) => a.startsWith('--emotes=')) || '').slice(9).split(',').filter(Boolean).map(Number);
  const filtre = args.filter((a) => !a.startsWith('--'));
  const cast = C.casting();
  // Le casting d'abord, le spectateur en dernier.
  const persos = cast.liste.concat([Object.assign({ role: 'spectateur' }, cast.spectateur)])
    .filter((p) => !filtre.length || filtre.includes(p.pseudo));
  // --manifeste : rien à rendre, on réécrit les entrées d'après les fichiers
  // présents (après un rendu interrompu, ou mené par plusieurs processus).
  if (args.includes('--manifeste')) {
    for (const p of persos) C.majManifeste(['stickers/' + p.pseudo + '/'], entreesDe(p));
    return;
  }
  const serveur = await C.demarrerServeur();
  const nav = await chromium.launch();
  const ctx = await nav.newContext({ deviceScaleFactor: 1 });
  const page = await ouvrirAtelier(ctx, C.BASE, PX);
  try {
    for (const p of persos) {
      const t0 = Date.now();
      const dos = C.dossier('stickers', p.pseudo);
      await page.evaluate((e) => kit.preparer(e), p.bouille);
      // Les effets du « 67 » et de « explose » (chiffres, bombe, nuages) sont
      // des images : on les laisse arriver avant de filmer.
      await page.evaluate(([e, px]) => { kit.monter(e, px, 0); kit.animer(21); kit.avancerA(3); kit.animer(19); kit.avancerA(6); return true; }, [p.bouille, 64]);
      await page.waitForTimeout(1500);
      if (!sansHumeurs) await humeurs(page, p, dos);
      if (!sansEmotes) {
        const dosE = C.dossier('stickers', p.pseudo, 'emotes');
        for (let n = 1; n < EMOTES.length; n++) {
          if (seules.length && !seules.includes(n)) continue;
          if (dejaFaite(p, n)) continue;          // reprise d'un rendu interrompu
          await emote(page, p, n, dosE);
          process.stdout.write('.');
        }
      }
      console.log('\n' + p.pseudo + ' fait en ' + Math.round((Date.now() - t0) / 1000) + ' s');
      // Le manifeste, personnage par personnage (seul celui-ci est remplacé).
      if (!seules.length) C.majManifeste(['stickers/' + p.pseudo + '/'], entreesDe(p));
    }
  } finally {
    await nav.close();
    serveur.arreter();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { HUMEURS, EMOTES };
