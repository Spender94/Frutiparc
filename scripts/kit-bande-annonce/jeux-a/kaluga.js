#!/usr/bin/env node
/*
 * Kit bande-annonce — Kaluga (public/kaluga/), section « jeux-a ».
 *
 *   node scripts/kit-bande-annonce/jeux-a/kaluga.js [--seul=<nom>]
 *
 * Sortie : /home/user/Frutiparc/kit-bande-annonce/jeux-a/kaluga/
 *
 * La page /kaluga/ du site, à l'horloge virtuelle, sur le vert du parc : la
 * scène 700×480 est rejouée en vectoriel par le lecteur du portage à la
 * taille affichée (1575×1080). Le lecteur bat à 40 pas par seconde (la
 * cadence du SWF) : filmé à 40 i/s dans un intermédiaire, d'où sortent le
 * maître à 60 i/s et une variante native à 40 i/s.
 *
 * Le menu se quitte comme un joueur le ferait : la partie est lancée par le
 * menu du jeu (Menu.launchGame), et le panneau de consignes se ferme d'un vrai
 * clic. La tzongre est tenue par lib/kaluga-pilote.js (dans le pas du lecteur,
 * l'état des touches posé dans K.Key) : elle va chercher les pommes au fil et
 * les dépose dans le panier.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const K = require('./lib/commun');
const { installerPiloteKaluga } = require('./lib/kaluga-pilote');

const JEU = 'kaluga';
const DOSSIER = path.join(K.SORTIE, JEU);
const PAS = 25;
const CSS = 'html,body{background:#ADE76B !important} #manette,#pad,.pad{display:none !important}';

function scriptGraine(graine) {
  let a = graine >>> 0;
  Math.random = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const menuPret = () => !!(window.KalugaJeu && KalugaJeu.manager && KalugaJeu.manager.current && KalugaJeu.manager.current.launchGame);

async function ouvrir(nav, graine) {
  const page = await K.nouvellePage(nav, { css: CSS });
  if (graine) await page.addInitScript(scriptGraine, graine);
  await page.goto(K.BASE + '/kaluga/');
  return page;
}

function cut(inter, nom, debut, duree, affiche) {
  K.couper(inter, debut, duree, path.join(DOSSIER, nom + '.mp4'), 60);
  K.couper(inter, debut, duree, path.join(DOSSIER, nom + '-40ips.mp4'), null);
  K.image(inter, debut + (affiche !== undefined ? affiche : duree / 2), path.join(DOSSIER, nom + '.png'));
  console.log(`  ✔ ${nom} : ${debut.toFixed(2)} s → +${duree.toFixed(2)} s`);
}

// Une partie du mode `lien`, filmée de la fermeture du panneau à `secondes`.
async function partie(nav, nom, lien, initObj, secondes, graine) {
  const page = await ouvrir(nav, graine);
  await K.attendre(page, menuPret, { nom: 'menu kaluga', images: 4 });
  await K.avancer(page, 40, PAS);
  await page.evaluate(([l, o]) => KalugaJeu.manager.current.launchGame(l, o), [lien, initObj || {}]);
  await K.avancer(page, 60, PAS);
  // Le panneau de consignes : un vrai clic dessus, comme le joueur.
  for (let q = 0; q < 8; q++) {
    if (await page.evaluate(() => !!(KalugaJeu.manager.current && KalugaJeu.manager.current.tzongre))) break;
    await page.mouse.click(960, 540);
    await K.avancer(page, 30, PAS);
  }
  await K.attendre(page, () => !!(KalugaJeu.manager.current && KalugaJeu.manager.current.tzongre), { nom: 'tzongre', images: 4 });
  await page.evaluate(installerPiloteKaluga, {});
  const inter = path.join(K.DOSSIER_TEMP, `kaluga-${nom}.mp4`);
  const enc = K.encodeur(inter, { fps: 40, codec: K.INTERMEDIAIRE });
  const tele = [];
  const n = Math.round(secondes * 1000 / PAS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((ms) => window.__horloge.avancer(ms), PAS);
    await enc.ecrire(await K.capture(page));
    tele.push(await page.evaluate(() => { const g = KalugaJeu.manager.current; return { score: g && g.score, lift: !!(g && g.tzongre && g.tzongre.flLift), fin: !!(g && g.flEndingGame) }; }));
    if (i % 400 === 399) console.log(`    ${nom} : ${((i + 1) * PAS / 1000).toFixed(0)} s filmés, score ${tele[i].score}`);
    if (tele[i].fin && i > 200) break;
  }
  await enc.fermer();
  const bilan = await page.evaluate(() => window.__pilote);
  await page.close();
  console.log(`  ✔ intermédiaire ${nom} : ${tele.length} images, pilote ${JSON.stringify({ saisies: bilan.saisies, lachers: bilan.lachers })}, score ${tele[tele.length - 1].score}`);
  return { inter, tele };
}

// La fenêtre la plus riche : le plus de points marqués en `duree` secondes.
function fenetreRiche(tele, duree) {
  const w = Math.round(duree * 1000 / PAS);
  let best = 0, v = -1;
  for (let i = 0; i + w < tele.length; i += 10) {
    const g = (tele[i + w].score || 0) - (tele[i].score || 0);
    if (g > v) { v = g; best = i; }
  }
  return { debut: best * PAS / 1000, gain: v };
}

async function titre(nav) {
  const page = await ouvrir(nav, 0);
  await K.attendre(page, () => !!(window.KalugaJeu && KalugaJeu.manager), { nom: 'kaluga', images: 1 });
  const inter = path.join(K.DOSSIER_TEMP, 'kaluga-titre.mp4');
  const enc = K.encodeur(inter, { fps: 40, codec: K.INTERMEDIAIRE });
  for (let i = 0; i < 40 * 8; i++) {
    await page.evaluate((ms) => window.__horloge.avancer(ms), PAS);
    await enc.ecrire(await K.capture(page));
  }
  await enc.fermer();
  await page.close();
  return inter;
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
      const inter = await titre(nav);
      cut(inter, 'kaluga-titre', 1.0, 6, 4);
    }
    if (veut('classic')) {
      const r = await partie(nav, 'classic', 'gameClassic', {}, 60, 2026);
      const s = r.tele.length * PAS / 1000;
      cut(r.inter, 'kaluga-partie-maitre', 0, s, 8);
      const f = fenetreRiche(r.tele, 13);
      cut(r.inter, 'kaluga-pommes', f.debut, 13, 9);
      cut(r.inter, 'kaluga-envol', 0, 12, 5);
      console.log(`    fenêtre la plus riche : ${f.debut.toFixed(1)} s (+${f.gain} points)`);
    }
    if (veut('invasion')) {
      const r = await partie(nav, 'invasion', 'gameInvasion', { level: 1 }, 30, 77);
      cut(r.inter, 'kaluga-invasion', 2, 13, 7);
    }
    if (veut('jaquette')) await K.jaquette(nav, JEU, 'disc_jaquette_kaluga.svg', 'kaluga-jaquette.png');
  } finally {
    await nav.close();
  }
  const v40 = (nom) => [nom + '-40ips.mp4'];
  K.finirJeu(JEU, {
    videos: {
      'kaluga-titre': { titre: 'Kaluga — le menu', description: 'Le menu de Kaluga Transport Inc. : le logo, la tzongre aux grands yeux et les modes de jeu (essais, olympique, chrono, survie, invasion, piste…).', usage: 'Carton d\'ouverture du segment Kaluga.', variantes: v40('kaluga-titre') },
      'kaluga-envol': { titre: 'Kaluga — l\'envol', description: 'Début de partie : la tzongre décolle, file vers la première pomme et la cueille au bout de son fil.', usage: 'Présentation du jeu.', variantes: v40('kaluga-envol') },
      'kaluga-pommes': { titre: 'Kaluga — les pommes au panier', description: 'La tzongre transporte les pommes au fil et les lâche dans le panier : le moment de la partie qui rapporte le plus de points.', usage: 'Le geste du jeu, en un plan.', variantes: v40('kaluga-pommes') },
      'kaluga-partie-maitre': { titre: 'Kaluga — une minute de partie (plan maître)', description: 'Mode Essais, la carte de la clairière : une minute de vol, de pommes cueillies, portées et déposées.', usage: 'Plan maître à découper.', variantes: v40('kaluga-partie-maitre') },
      'kaluga-invasion': { titre: 'Kaluga — invasion', description: 'Le mode Invasion : les fourmis montent à l\'assaut des pommes, la tzongre les met à l\'abri dans le panier.', usage: 'Variété des modes.', variantes: v40('kaluga-invasion') },
    },
    images: {
      'kaluga-jaquette.png': { titre: 'Kaluga — jaquette du disque', description: 'La jaquette du disque Kaluga du bureau Frutiz (disc_jaquette_kaluga), PNG transparent, 1080 px de haut.', usage: 'Incrustation, carton de fin du segment.' },
    },
    sons: [
      { source: 'public/kaluga/sons/sJeuLoop0.wav', nom: 'kaluga-musique-partie', titre: 'Kaluga — musique de partie', description: 'La boucle musicale des parties', usage: 'Fond musical du segment Kaluga.', boucle: true },
      { source: 'public/kaluga/sons/sMenuLoop.wav', nom: 'kaluga-musique-menu', titre: 'Kaluga — musique du menu', description: 'La boucle du menu', usage: 'Sous le menu.', boucle: true },
      { source: 'public/kaluga/sons/sFly.wav', nom: 'kaluga-vol', titre: 'Kaluga — bourdonnement de vol', description: 'Les ailes de la tzongre (boucle)', usage: 'Sous les plans de vol.', boucle: true },
      { source: 'public/kaluga/sons/sLink.mp3', nom: 'kaluga-fil', titre: 'Kaluga — le fil', description: 'Le fil qui accroche une pomme', usage: 'Sur la cueillette.' },
      { source: 'public/kaluga/sons/sBonus.mp3', nom: 'kaluga-bonus', titre: 'Kaluga — bonus', description: 'Un papillon bonus attrapé', usage: 'Temps fort.' },
      { source: 'public/kaluga/sons/sCrunch.mp3', nom: 'kaluga-croc', titre: 'Kaluga — croc', description: 'Une pomme croquée', usage: 'Ponctuation.' },
      { source: 'public/kaluga/sons/sGong.mp3', nom: 'kaluga-gong', titre: 'Kaluga — gong', description: 'Le gong de fin', usage: 'Fin de segment.' },
    ],
  });
}

module.exports = { principal };
if (require.main === module) principal().catch((e) => { console.error(e); process.exit(1); });
