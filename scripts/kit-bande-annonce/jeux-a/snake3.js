#!/usr/bin/env node
/*
 * Kit bande-annonce — Frutisnake 3 (public/snake3/) et un coup d'œil à
 * Frutisnake 2 VK (public/snake2vk/), section « jeux-a ».
 *
 *   node scripts/kit-bande-annonce/jeux-a/snake3.js [--seul=<nom>]
 *
 * Sortie : /home/user/Frutiparc/kit-bande-annonce/jeux-a/snake3/
 *
 * La page /snake3/ du site, à l'horloge virtuelle, en 1920×1080 : la scène
 * 700×480 se trace d'elle-même à la taille affichée (dessins SVG du SWF), sur
 * le vert du portail. Le jeu avance par pas fixes de 1/40 s (la cadence du
 * SWF) et ne redessine que quand un pas a été joué : on filme donc à 40 i/s
 * dans un intermédiaire, d'où sortent les plans en 60 i/s (maître) et en
 * 40 i/s (variante native) — voir lib/commun.js, INTERMEDIAIRE.
 *
 * Les serpents sont pilotés dans la page (lib/snake-pilote.js) : le solo par
 * un pilote qui anticipe murs et corps (sur le modèle du bot du Battle en
 * ligne), le Battle à quatre par le bot du jeu lui-même (server/bot.js).
 * Math.random est graine dans la page : la même partie à chaque passage.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const K = require('./lib/commun');
const SP = require('./lib/snake-pilote');

const JEU = 'snake3';
const DOSSIER = path.join(K.SORTIE, JEU);
const PAS = 25;

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

async function ouvrir(nav, graine) {
  const page = await K.nouvellePage(nav, {});
  await page.addInitScript(scriptGraine, graine);
  await page.goto(K.BASE + '/snake3/');
  await K.attendre(page, () => !!(window.__frutisnake && window.__frutisnake.mode), { nom: 'menu snake3', images: 2 });
  return page;
}

// Filme `n` pas dans l'encodeur `enc` ; `chaque(i)` est appelé après chaque image.
async function filmerPas(page, enc, n, chaque) {
  for (let i = 0; i < n; i++) {
    await page.evaluate((d) => window.__horloge.avancer(d), PAS);
    await enc.ecrire(await K.capture(page));
    if (chaque && (await chaque(i)) === false) return i + 1;
  }
  return n;
}

// Avance sans dessiner (le tracé est mis de côté le temps du saut).
async function sauter(page, n) {
  await page.evaluate((n) => {
    const j = window.__frutisnake;
    const d = j.dessiner;
    j.dessiner = () => {};
    for (let i = 0; i < n; i++) window.__horloge.avancer(25);
    j.dessiner = d;
  }, n);
}

// Le plan, en 60 i/s (maître) et — sauf pour les longs plans maîtres, coûteux à encoder — en 40 i/s natifs.
function cut(inter, nom, debut, duree, affiche) {
  const variante = !/-maitre$/.test(nom);
  K.couper(inter, debut, duree, path.join(DOSSIER, nom + '.mp4'), 60);
  if (variante) K.couper(inter, debut, duree, path.join(DOSSIER, nom + '-40ips.mp4'), null);
  K.image(inter, debut + (affiche !== undefined ? affiche : duree / 2), path.join(DOSSIER, nom + '.png'));
  console.log(`  ✔ ${nom} : ${debut.toFixed(2)} s → +${duree.toFixed(2)} s`);
}

const etatSolo = () => {
  const m = window.__frutisnake.mode;
  const p = m && m.partie;
  return p ? { score: p.score, len: p.serpent.len, go: !!p.game_over_flag, finie: !!p.finie } : null;
};

async function solo(nav) {
  const page = await ouvrir(nav, 31337);
  await K.attendre(page, () => window.__frutisnake.dessinsJeuPrets === true && window.__frutisnake.dessinsJeuChauds === true, { nom: 'arène', images: 2 });
  // 1. Du menu à la partie : 2 s de menu, la transition (le rideau), le départ.
  const inter1 = path.join(K.DOSSIER_TEMP, 'snake3-solo-debut.mp4');
  let enc = K.encodeur(inter1, { fps: 40, codec: K.INTERMEDIAIRE });
  await filmerPas(page, enc, 80);
  await page.evaluate(() => window.__frutisnake.forcerMode(97));
  let pilote = false;
  await filmerPas(page, enc, 40 * 26, async () => {
    if (!pilote && await page.evaluate(() => !!(window.__frutisnake.mode && window.__frutisnake.mode.partie))) {
      await page.evaluate(SP.installerPiloteSolo, {});
      pilote = true;
    }
  });
  await enc.fermer();
  console.log('  solo, début :', JSON.stringify(await page.evaluate(etatSolo)));
  // 2. Le saut : la partie continue, non filmée, jusqu'à ~2 min de jeu.
  await sauter(page, 40 * 95);
  console.log('  solo, après le saut :', JSON.stringify(await page.evaluate(etatSolo)));
  const inter2 = path.join(K.DOSSIER_TEMP, 'snake3-solo-suite.mp4');
  enc = K.encodeur(inter2, { fps: 40, codec: K.INTERMEDIAIRE });
  let finA = null;
  const n2 = await filmerPas(page, enc, 40 * 40, async (i) => {
    const e = await page.evaluate(etatSolo);
    if (e && e.go && finA === null) finA = i;
    if (finA !== null && i - finA > 200) return false;
    return true;
  });
  await enc.fermer();
  console.log('  solo, fin :', JSON.stringify(await page.evaluate(etatSolo)), 'images', n2, 'mort à', finA);
  await page.close();
  return { inter1, inter2, finA, n2 };
}

async function bataille(nav) {
  const page = await ouvrir(nav, 4242);
  await K.attendre(page, () => window.__frutisnake.dessinsJeuPrets === true && window.__frutisnake.dessinsJeuChauds === true, { nom: 'arène', images: 2 });
  await page.addScriptTag({ url: '/snake3/server/bot.js' });
  await page.evaluate(() => { const j = window.__frutisnake; j.nplayers = 4; j.poserModeSuivant(2); });
  await K.attendre(page, () => !!(window.__frutisnake.mode && window.__frutisnake.mode.bataille), { nom: 'bataille', images: 1 });
  await page.evaluate(SP.installerPiloteBataille, { skill: [0.95, 0.9, 0.9, 0.85] });
  const inter = path.join(K.DOSSIER_TEMP, 'snake3-bataille.mp4');
  const enc = K.encodeur(inter, { fps: 40, codec: K.INTERMEDIAIRE });
  let finA = null;
  const morts = [];
  const n = await filmerPas(page, enc, 40 * 90, async (i) => {
    const e = await page.evaluate(() => { const b = window.__frutisnake.mode.bataille; return b ? { v: b.serpents.map((s) => !!(s && s.vivant !== false)), fin: b.finie } : { fin: true }; });
    if (e.v) morts.push(e.v.filter(Boolean).length);
    if (e.fin && finA === null) finA = i;
    if (finA !== null && i - finA > 180) return false;
    return true;
  });
  await enc.fermer();
  await page.close();
  console.log('  bataille :', n, 'images, fin à', finA);
  return { inter, n, finA, morts };
}

async function titre(nav) {
  const page = await K.nouvellePage(nav, {});
  await page.goto(K.BASE + '/snake3/');
  await K.attendre(page, () => !!(window.__frutisnake && window.__frutisnake.mode), { nom: 'menu snake3', images: 0 });
  const inter = path.join(K.DOSSIER_TEMP, 'snake3-titre.mp4');
  const enc = K.encodeur(inter, { fps: 40, codec: K.INTERMEDIAIRE });
  // Le carrousel tourne, comme sous les clics d'un joueur qui hésite : deux
  // crans à droite, un à gauche — de vrais clics sur les flèches jaunes de la
  // scène (Menu.presser : x < 70 ou x > 630, à mi-hauteur).
  const ech = 1080 / 480, gauche = (1920 - 700 * ech) / 2;
  const fleche = (x) => ({ x: gauche + x * ech, y: 540 });
  const crans = { 90: fleche(672), 170: fleche(672), 250: fleche(28) };
  await filmerPas(page, enc, 40 * 8, async (i) => {
    if (crans[i]) { await page.mouse.move(crans[i].x, crans[i].y); await page.mouse.down(); await page.mouse.up(); }
  });
  await enc.fermer();
  await page.close();
  return inter;
}

// Frutisnake 2 VK (la réécriture PixiJS) : son écran d'accueil, à 60 i/s.
async function snake2vk(nav) {
  const page = await K.nouvellePage(nav, {});
  await page.goto(K.BASE + '/snake2vk/');
  await page.waitForTimeout(500);
  await K.attendre(page, () => !!document.querySelector('canvas'), { nom: 'snake2vk', images: 2, max: 30000 });
  await K.avancer(page, 30);
  const r = await K.filmer(page, path.join(DOSSIER, 'snake2vk-accueil.mp4'), 60 * 6, { affiche: 60 * 4, fichierAffiche: path.join(DOSSIER, 'snake2vk-accueil.png') });
  await page.close();
  return r;
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
      cut(inter, 'snake3-titre', 0.2, 7.5, 2);
    }
    if (veut('solo')) {
      const r = await solo(nav);
      cut(r.inter1, 'snake3-depart', 1.0, 14, 9);
      const s = (i) => i * PAS / 1000;
      if (r.finA !== null) {
        // La fin de partie : douze secondes de serpent long, puis la queue qui explose.
        cut(r.inter2, 'snake3-serpent-long', Math.max(0, s(r.finA) - 9), Math.min(14, s(r.n2) - Math.max(0, s(r.finA) - 9)), 4);
        if (s(r.finA) > 24) cut(r.inter2, 'snake3-fruits', 2, 13, 6);
      } else {
        cut(r.inter2, 'snake3-serpent-long', 2, 14, 7);
        cut(r.inter2, 'snake3-fruits', 20, 14, 7);
      }
    }
    if (veut('bataille')) {
      const r = await bataille(nav);
      const s = (i) => i * PAS / 1000;
      cut(r.inter, 'snake3-battle', 0, 14, 8);
      if (r.finA !== null) cut(r.inter, 'snake3-battle-fin', Math.max(0, s(r.finA) - 8), Math.min(12.5, s(r.n) - Math.max(0, s(r.finA) - 8)), 7.5);
      cut(r.inter, 'snake3-battle-maitre', 0, s(r.n), 6);
    }
    if (veut('snake2vk')) await snake2vk(nav);
    if (veut('jaquette')) {
      await K.jaquette(nav, JEU, 'disc_jaquette_snake.svg', 'snake3-jaquette.png');
      await K.jaquette(nav, JEU, 'disc_jaquette_snake2vk.svg', 'snake2vk-jaquette.png');
    }
  } finally {
    await nav.close();
  }
  const v40 = (nom) => [nom + '-40ips.mp4'];
  K.finirJeu(JEU, {
    videos: {
      'snake3-titre': { titre: 'Frutisnake — le menu', description: 'Le menu du jeu : le titre « Frutisnake » et le carrousel des modes (Challenge, Battle, options, encyclopéfruit).', usage: 'Carton d\'ouverture du segment Frutisnake.', variantes: v40('snake3-titre') },
      'snake3-depart': { titre: 'Frutisnake — c\'est parti', description: 'Du menu à la partie : le rideau se lève, le serpent sort de son terrier et file vers les premiers fruits ; le score grimpe, la frutibarre se remplit.', usage: 'Début de segment, présentation du jeu.', variantes: v40('snake3-depart') },
      'snake3-fruits': { titre: 'Frutisnake — la course aux fruits', description: 'Deux minutes de jeu plus tard : un serpent plus long et plus rapide qui slalome entre fruits et options.', usage: 'Plan d\'action, rythme.', variantes: v40('snake3-fruits') },
      'snake3-serpent-long': { titre: 'Frutisnake — serpent long (et fin de partie)', description: 'Le serpent, devenu long, dans l\'arène ; s\'il finit par se mordre, la queue explose segment par segment.', usage: 'Tension, « close call ».', variantes: v40('snake3-serpent-long') },
      'snake3-battle': { titre: 'Frutisnake Battle — quatre serpents', description: 'Le mode Battle à quatre sur un clavier, chaque serpent tenu par le bot du jeu : ils grandissent tout seuls, l\'arène rétrécit.', usage: 'Multijoueur, chaos joyeux.', variantes: v40('snake3-battle') },
      'snake3-battle-fin': { titre: 'Frutisnake Battle — le dernier survivant', description: 'Les derniers serpents en lice, la dernière morsure et l\'écran du vainqueur.', usage: 'Victoire, fin du segment.', variantes: v40('snake3-battle-fin') },
      'snake3-battle-maitre': { titre: 'Frutisnake Battle — partie entière (plan maître)', description: 'Une bataille à quatre complète, du départ à l\'écran de résultat.', usage: 'Plan maître à découper.', variantes: v40('snake3-battle-maitre') },
      'snake2vk-accueil': { titre: 'Frutisnake 2 VK — écran d\'accueil', description: 'La réécriture de Frutisnake 2 par Kobbs (PixiJS), servie par le site : son écran d\'accueil.', usage: 'Clin d\'œil : « et aussi Frutisnake 2 VK ».' },
    },
    images: {
      'snake3-jaquette.png': { titre: 'Frutisnake — jaquette du disque', description: 'La jaquette du disque Frutisnake du bureau Frutiz (disc_jaquette_snake), PNG transparent, 1080 px de haut.', usage: 'Incrustation, carton de fin du segment.' },
      'snake2vk-jaquette.png': { titre: 'Frutisnake 2 VK — jaquette du disque', description: 'La jaquette du disque Frutisnake 2 VK (disc_jaquette_snake2vk), PNG transparent.', usage: 'Incrustation.' },
    },
    sons: [
      { source: 'public/snake3/sons/game_loop.mp3', nom: 'snake3-musique-partie', titre: 'Frutisnake — musique de partie', description: 'La boucle musicale des parties', usage: 'Fond musical du segment Frutisnake.', boucle: true },
      { source: 'public/snake3/sons/menu_loop.mp3', nom: 'snake3-musique-menu', titre: 'Frutisnake — musique du menu', description: 'La boucle du menu', usage: 'Sous le menu.', boucle: true },
      { source: 'public/snake3/sons/glurps.mp3', nom: 'snake3-glurps', titre: 'Frutisnake — fruit avalé', description: 'Le « glurps » d\'un fruit mangé', usage: 'Sur chaque fruit mangé.' },
      { source: 'public/snake3/sons/option.mp3', nom: 'snake3-option', titre: 'Frutisnake — option ramassée', description: 'Une option ramassée', usage: 'Sur les options.' },
      { source: 'public/snake3/sons/explose.mp3', nom: 'snake3-explosion', titre: 'Frutisnake — explosion', description: 'L\'explosion (bombe, fin de partie)', usage: 'Fin de partie, impact.' },
      { source: 'public/snake3/sons/game_over.mp3', nom: 'snake3-game-over', titre: 'Frutisnake — game over', description: 'La fin de partie', usage: 'Chute, fin.' },
      { source: 'public/snake3/sons/rotmenu.mp3', nom: 'snake3-menu-rotation', titre: 'Frutisnake — carrousel du menu', description: 'Le carrousel du menu qui tourne', usage: 'Transition.' },
    ],
  });
}

module.exports = { principal };
if (require.main === module) principal().catch((e) => { console.error(e); process.exit(1); });
