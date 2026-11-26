#!/usr/bin/env node
/*
 * Kit bande-annonce — Burning Kiwi (public/bkiwi/), section « jeux-a ».
 *
 *   node scripts/kit-bande-annonce/jeux-a/bkiwi.js [--seul=<nom>]
 *
 * Sortie : /home/user/Frutiparc/kit-bande-annonce/jeux-a/bkiwi/
 *
 * La page /bkiwi/ du site, à l'horloge virtuelle, sur le vert du parc (le
 * fond noir de la page est remplacé par #ADE76B le temps de la capture). La
 * scène 350×350 est tracée en vectoriel par le lecteur du portage à la taille
 * affichée (1080×1080) : rien n'est agrandi après coup.
 *
 * Les courses se jouent en mode « essais » (TRAINING : trois voitures de l'IA
 * du jeu, rien n'est classé) avec la Pétaradeuse (voiture 4, sept kiwis de
 * nitro). Le joueur est tenu par un pilote automatique injecté dans la page
 * (lib/bkiwi-pilote.js, dérivé de celui des tests du portage), qui joue dans
 * le pas de physique — le jeu, lui, n'est pas modifié. Math.random est
 * graine dans la page, pour que les voitures de l'IA refassent la même course.
 *
 * Le jeu tourne à 40 pas par seconde : chaque course est filmée à 40 i/s
 * (une image par pas) dans un fichier intermédiaire, d'où l'on coupe le plan
 * maître et les plans courts, en 60 i/s (maître) et 40 i/s (variante native).
 * Les fenêtres se choisissent sur la télémétrie relevée pendant la course :
 * départ, dépassement le plus serré, nitro, arrivée.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const K = require('./lib/commun');
const { installerPilote } = require('./lib/bkiwi-pilote');

const JEU = 'bkiwi';
const DOSSIER = path.join(K.SORTIE, JEU);
const CSS = 'html,body{background:#ADE76B !important} #b-pause,#vise,#mode-emploi,.fd-badge,#fd-badge{display:none !important}';
const PAS = 25;                      // un pas de physique = une image filmée

// Le hasard de la page, graine : les mêmes voitures de l'IA à chaque passage.
function scriptGraine(graine) {
  let a = graine >>> 0;
  Math.random = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  window.__graine = (g) => { a = g >>> 0; };
}

const pret = () => !!(window.__bkiwi && window.BkiwiJeu && BkiwiJeu.M && BkiwiJeu.M.vs && BkiwiJeu.M.controls
  && BkiwiJeu.M.controls[0] != null && BkiwiJeu.client && BkiwiJeu.client.connected);

async function ouvrir(nav, graine) {
  const page = await K.nouvellePage(nav, { css: CSS });
  await page.addInitScript(scriptGraine, graine);
  await page.goto(K.BASE + '/bkiwi/');
  return page;
}

/*
 * Une course entière, filmée dans l'intermédiaire. Rend la télémétrie, image
 * par image : rang, vitesse, nitro, écart à la voiture la plus proche.
 */
async function course(nav, o) {
  const page = await ouvrir(nav, o.graine);
  await K.attendre(page, pret, { nom: 'menu bkiwi', images: 2 });
  await page.evaluate(([trk, car]) => {
    const M = BkiwiJeu.M;
    window.__graine(4242 + trk);
    M.vs.gameMode = M.TRAINING; M.vs.selectedTrack = trk; M.vs.selectedCar = car; M.vs.menuPhase = -1; M.vs.mainPhase = 3;
  }, [o.trk, o.car]);
  // Le circuit se charge (images, sons) : on attend sa première image, sans filmer.
  await K.attendre(page, () => BkiwiJeu.M.vs.mainPhase === 1 && !!BkiwiJeu.M.track && !!BkiwiJeu.M.cars && !!BkiwiJeu.M.cars[0], { nom: 'circuit', images: 1 });
  await page.evaluate(installerPilote, o.reglages || {});
  const tele = [];
  const inter = path.join(K.DOSSIER_TEMP, `bkiwi-${o.nom}.mp4`);
  let finA = null;
  const max = Math.round((o.maxSecondes || 75) * 1000 / PAS);
  // On filme jusqu'à l'arrivée, plus le panneau de résultat.
  const enc = K.encodeur(inter, { fps: 1000 / PAS, codec: K.INTERMEDIAIRE });
  for (let i = 0; i < max; i++) {
    await page.evaluate((d) => window.__horloge.avancer(d), PAS);
    await enc.ecrire(await K.capture(page));
    const t = await page.evaluate(() => {
      const M = BkiwiJeu.M; const c = M.cars[0];
      if (!c) return null;
      let rang = 1, ecart = Infinity;
      for (let k = 1; k < M.cars.length; k++) {
        const a = M.cars[k];
        if ((a.posCounter || 0) > (c.posCounter || 0)) rang++;
        const d = Math.hypot(a.x - c.x, a.y - c.y);
        if (d < ecart) ecart = d;
      }
      return { rang, v: c.speed, nitro: c.nitroTimer > 0 ? 1 : 0, ecart: Math.round(ecart), fin: !!c.finished, tour: c.vs ? c.vs.lap : 0, go: window.__pilote ? window.__pilote.pas : 0 };
    });
    tele.push(t);
    if (t && t.fin && finA === null) finA = i;
    if (finA !== null && i - finA > (o.apresArrivee || 200)) break;
    if (i % 400 === 399) console.log(`    ${o.nom} : ${((i + 1) * PAS / 1000).toFixed(0)} s de course filmés`);
  }
  await enc.fermer();
  await page.close();
  console.log(`  ✔ intermédiaire ${o.nom} : ${tele.length} images (${(tele.length * PAS / 1000).toFixed(1)} s)`);
  return { inter, tele, finA };
}

// Le dépassement le plus spectaculaire : un changement de rang vers le haut,
// voiture adverse à moins de 60 px, de préférence sous nitro.
function choisirAction(tele, de, a) {
  let best = null;
  for (let i = Math.max(1, de); i < a; i++) {
    const t = tele[i], p = tele[i - 1];
    if (!t || !p) continue;
    if (t.rang < p.rang) {
      let proche = Infinity, nitro = 0;
      for (let j = Math.max(0, i - 80); j <= Math.min(tele.length - 1, i + 40); j++) {
        if (tele[j]) { proche = Math.min(proche, tele[j].ecart); nitro += tele[j].nitro; }
      }
      const score = -proche + nitro * 0.5;
      if (!best || score > best.score) best = { i, score };
    }
  }
  return best ? best.i : null;
}

async function filmerTitre(nav) {
  // L'ouverture du disque : connexion, puis l'intro (la porte du garage, le
  // pilote, le casque) et le menu. Filmée à 40 i/s comme le reste.
  const page = await ouvrir(nav, 7);
  await K.attendre(page, () => !!(window.__bkiwi && window.BkiwiJeu && BkiwiJeu.M), { nom: 'bkiwi', images: 1 });
  const inter = path.join(K.DOSSIER_TEMP, 'bkiwi-titre.mp4');
  const enc = K.encodeur(inter, { fps: 1000 / PAS, codec: K.INTERMEDIAIRE });
  const n = Math.round(30000 / PAS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((d) => window.__horloge.avancer(d), PAS);
    await enc.ecrire(await K.capture(page));
  }
  await enc.fermer();
  await page.close();
  return inter;
}

// Le plan, en 60 i/s (maître) et — sauf pour les longs plans maîtres, coûteux à encoder — en 40 i/s natifs.
function cut(inter, nom, debut, duree, affiche) {
  const variante = !/-maitre$/.test(nom);
  K.couper(inter, debut, duree, path.join(DOSSIER, nom + '.mp4'), 60);
  if (variante) K.couper(inter, debut, duree, path.join(DOSSIER, nom + '-40ips.mp4'), null);
  K.image(inter, debut + (affiche !== undefined ? affiche : duree / 2), path.join(DOSSIER, nom + '.png'));
  console.log(`  ✔ ${nom} : ${debut.toFixed(2)} s → +${duree.toFixed(2)} s`);
}

async function principal() {
  fs.mkdirSync(DOSSIER, { recursive: true });
  fs.mkdirSync(K.DOSSIER_TEMP, { recursive: true });
  const seuls = process.argv.filter((a) => a.startsWith('--seul=')).map((a) => a.slice(7));
  const veut = (nom) => !seuls.length || seuls.some((s) => nom.includes(s));
  await K.serveur();
  const nav = await K.navigateur();
  try {
    if (veut('titre')) {
      const inter = await filmerTitre(nav);
      // Le passage de l'intro : choisi à l'œil sur l'intermédiaire (voir rapport).
      cut(inter, 'bkiwi-titre', 15.5, 8, 6.5);
      cut(inter, 'bkiwi-intro-maitre', 0, 29.5, 21);
    }
    if (veut('greenhill')) {
      const r = await course(nav, { nom: 'greenhill', trk: 0, car: 4, graine: 101 });
      const s = (i) => i * PAS / 1000;
      const go = r.tele.findIndex((t) => t && t.go > 0);
      const fin = r.finA !== null ? r.finA : r.tele.length - 1;
      cut(r.inter, 'bkiwi-course-maitre', 0, s(r.tele.length), s(go) + 2);
      cut(r.inter, 'bkiwi-depart', Math.max(0, s(go) - 4), 12, 4.2);
      const act = choisirAction(r.tele, go + 200, fin - 80);
      if (act !== null) cut(r.inter, 'bkiwi-depassement', Math.max(0, s(act) - 7), 12, 7);
      cut(r.inter, 'bkiwi-arrivee', Math.max(0, s(fin) - 6), Math.min(11, s(r.tele.length - fin) + 6), 6.5);
      fs.writeFileSync(path.join(K.DOSSIER_TEMP, 'bkiwi-greenhill.json'), JSON.stringify(r.tele));
    }
    if (veut('jupiter')) {
      // Un second circuit pour la variété : Jupiter IV, du départ au premier tour.
      const r = await course(nav, { nom: 'jupiter', trk: 4, car: 4, graine: 202, maxSecondes: 26 });
      const s = (i) => i * PAS / 1000;
      const go = r.tele.findIndex((t) => t && t.go > 0);
      cut(r.inter, 'bkiwi-jupiter', Math.max(0, s(go) + 1), 14, 6);
    }
    if (veut('jaquette')) await K.jaquette(nav, JEU, 'disc_jaquette_bkiwi.svg', 'bkiwi-jaquette.png');
  } finally {
    await nav.close();
  }
  const v40 = (nom) => [nom + '-40ips.mp4'];
  K.finirJeu(JEU, {
    videos: {
      'bkiwi-titre': { titre: 'Burning Kiwi — ouverture', description: 'La fin de l\'intro du disque : le pneu qui fume, la voiture qui s\'envole dans le soleil, retombe sur la piste, et le logo « Burning Kiwi » qui s\'installe.', usage: 'Carton titre du segment Burning Kiwi.', variantes: v40('bkiwi-titre') },
      'bkiwi-intro-maitre': { titre: 'Burning Kiwi — intro complète (plan maître)', description: 'Toute l\'intro du disque : le garage, le casque et les clés, la silhouette du pilote, le gant, la nitro, le burn, le saut dans le soleil et le logo.', usage: 'À découper pour l\'ouverture (plans très graphiques).', variantes: v40('bkiwi-intro-maitre') },
      'bkiwi-course-maitre': { titre: 'Burning Kiwi — une course entière à Green Hill (plan maître)', description: 'Mode essais, la Pétaradeuse contre trois voitures de l\'IA : décompte 3-2-1 découpé dans le circuit, super départ, nitros (kiwis), tremplins, trois tours, et l\'arrivée en tête.', usage: 'Plan maître à découper ; tout est à vitesse réelle.', variantes: v40('bkiwi-course-maitre') },
      'bkiwi-depart': { titre: 'Burning Kiwi — le départ', description: 'Le décompte (les chiffres découpent le circuit), le GO, le super départ sous nitro et les premiers virages.', usage: 'Le moment « vitesse » : à couper sur le GO.', variantes: v40('bkiwi-depart') },
      'bkiwi-depassement': { titre: 'Burning Kiwi — dépassement', description: 'En pleine course, la voiture du joueur remonte une voiture de l\'IA et la passe.', usage: 'Action, duel.', variantes: v40('bkiwi-depassement') },
      'bkiwi-arrivee': { titre: 'Burning Kiwi — l\'arrivée', description: 'Le dernier virage, la ligne d\'arrivée franchie en tête et le panneau de résultat.', usage: 'Victoire / fin du segment.', variantes: v40('bkiwi-arrivee') },
      'bkiwi-jupiter': { titre: 'Burning Kiwi — Jupiter IV', description: 'Un autre circuit, un autre décor : le premier tour de Jupiter IV.', usage: 'Variété des circuits.', variantes: v40('bkiwi-jupiter') },
    },
    images: {
      'bkiwi-jaquette.png': { titre: 'Burning Kiwi — jaquette du disque', description: 'La jaquette du disque Burning Kiwi du bureau Frutiz (sprite vectoriel disc_jaquette_bkiwi), en PNG transparent, 1080 px de haut.', usage: 'Incrustation, carton de fin du segment.' },
    },
    sons: [
      { source: 'Games/burningKiwi/bk00.mp3', nom: 'bkiwi-musique-course', titre: 'Burning Kiwi — musique de course (Green Hill)', description: 'La musique du circuit 0, servie par le site à /swf/games/burningKiwi/bk00.mp3', usage: 'Fond musical des plans de course.', boucle: true },
      { source: 'Games/burningKiwi/bkMenu.mp3', nom: 'bkiwi-musique-menu', titre: 'Burning Kiwi — musique du menu', description: 'La musique du menu (/swf/games/burningKiwi/bkMenu.mp3)', usage: 'Sous l\'ouverture.', boucle: true },
      { source: 'public/bkiwi/sons/kiwiPickUp.mp3', nom: 'bkiwi-kiwi', titre: 'Burning Kiwi — kiwi ramassé', description: 'Le son d\'un kiwi (nitro) ramassé', usage: 'Sur les nitros.' },
      { source: 'public/bkiwi/sons/buttonOk.mp3', nom: 'bkiwi-bouton-ok', titre: 'Burning Kiwi — bouton OK', description: 'Validation dans le menu', usage: 'Transitions, clics.' },
      { source: 'public/bkiwi/sons/loseLifeSound.mp3', nom: 'bkiwi-vie-perdue', titre: 'Burning Kiwi — vie perdue', description: 'Une vie perdue (mode survie)', usage: 'Accident, raté.' },
      { source: 'public/bkiwi/sons/gameOverSound.mp3', nom: 'bkiwi-game-over', titre: 'Burning Kiwi — game over', description: 'Fin de partie', usage: 'Chute, fin.' },
    ],
  });
}

module.exports = { principal };
if (require.main === module) principal().catch((e) => { console.error(e); process.exit(1); });
