#!/usr/bin/env node
/*
 * Kit bande-annonce, section jeux-b — GRAPIZ (public/grapiz/).
 *
 *   node scripts/kit-bande-annonce/jeux-b/grapiz.js [partie] [extras]
 *
 * Produit dans kit-bande-annonce/jeux-b/grapiz/ :
 *   · accueil.mp4 — l'écran des modes (Fruticonnect, la sphère, Championnat,
 *     Matches amicaux, Challenge) puis le salon du Challenge ;
 *   · partie-maitre.mp4 — une VRAIE partie en ligne contre un bot du serveur
 *     (salon Challenge → « Défier » → partie), de l'ouverture jusqu'à la
 *     victoire par connexion ; et les plans qu'on y découpe (l'ouverture, le
 *     coup gagnant et le panneau « Victoire ! ») ;
 *   · la jaquette.
 *
 * Notre camp est joué par l'IA de Grapiz elle-même (public/grapiz/server/
 * bot.js, au niveau le plus fort), chargée dans la page : elle choisit le
 * coup, le harnais le joue À LA SOURIS — un clic sur la bille (les cases
 * atteignables s'allument en cyan), un temps, un clic sur la case.
 *
 * Le serveur est autoritaire et répond en temps réel (le bot adverse
 * réfléchit côté Node) : c'est la seule part non déterministe. L'horloge de
 * la page reste virtuelle (1/60 s par image filmée) ; les réponses du
 * serveur arrivent quand elles arrivent, entre deux images. Chaque
 * lancement filme donc une partie différente — toujours une vraie.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./commun');

const JEU = 'grapiz';
const DOSSIER = path.join(C.SORTIE, JEU);
const CSS = 'html,body{background:' + C.VERT_SITE + '!important}#fp-fd-badge{display:none!important}';
const PSEUDO = 'grenadix';

// Lit la position sur le plateau (DOM) et rend le coup de l'IA du jeu.
function lirePosition(moi) {
  const polys = Array.from(document.querySelectorAll('#board polygon[data-x]'));
  if (!polys.length) return null;
  const centres = polys.map((p) => {
    const r = p.getBoundingClientRect();
    return { x: +p.getAttribute('data-x'), y: +p.getAttribute('data-y'), cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  const jetons = Array.from(document.querySelectorAll('#pieces-layer .ball')).map((b) => {
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bd = Infinity;
    for (const c of centres) { const d = (c.cx - cx) ** 2 + (c.cy - cy) ** 2; if (d < bd) { bd = d; best = c; } }
    return { t: b.classList.contains('b1') ? 1 : 0, x: best.x, y: best.y };
  });
  const n = polys.length;
  const size = n === 37 ? 3 : n === 61 ? 4 : n === 91 ? 5 : 4;
  let monCamp = -1, trait = -1;
  for (const c of document.querySelectorAll('#g-top .gcard')) {
    const nom = (c.querySelector('.gc-name') || {}).textContent || '';
    if (nom.trim().toLowerCase() === moi) monCamp = +c.dataset.team;
    if (c.classList.contains('active')) trait = +c.dataset.team;
  }
  const fin = getComputedStyle(document.getElementById('g-end')).display !== 'none';
  return { size, jetons, monCamp, trait, fin, centres };
}

function choisirCoup(moi, ply) {
  const pos = lirePosition(moi);
  if (!pos || pos.fin || pos.monCamp < 0 || pos.trait !== pos.monCamp) return null;
  const E = window.Grapiz.engine, B = window.Grapiz.bot;
  const board = E.Board.fromDefinition({ size: pos.size, tokens: pos.jetons });
  const m = B.chooseMove(board, pos.monCamp, 1, Math.random, { ply });
  if (!m) return null;
  const ecran = (x, y) => { const c = pos.centres.find((k) => k.x === x && k.y === y); return c ? [c.cx, c.cy] : null; };
  return { de: ecran(m.from.x, m.from.y), vers: ecran(m.target.x, m.target.y) };
}

async function filmer(page, enc, n) {
  for (let i = 0; i < n; i++) { await C.avancer(page, 1); await enc.ecrire(await C.capturer(page)); }
}

async function ouvrir(nav, sid) {
  const page = await C.nouvellePage(nav, { css: CSS, graine: 777 });
  await page.goto(C.BASE + '/grapiz/?sid=' + sid);
  // L'IA du jeu, et nos deux fonctions de lecture, posées dans la page.
  await page.addScriptTag({ url: '/grapiz/server/bot.js' });
  await page.addScriptTag({ content: lirePosition.toString() + '\n' + choisirCoup.toString() });
  await C.patienter(page, () => document.querySelector('#screen-mode.on') && window.Grapiz && window.Grapiz.bot, null, 30000);
  await C.avancer(page, 30);
  return page;
}

async function genererPartie(nav, elements) {
  const sid = await C.compte(PSEUDO);
  const page = await ouvrir(nav, sid);
  console.log('  accueil et salon…');
  const accueil = new C.Encodeur(path.join(DOSSIER, 'accueil.mp4'));
  await filmer(page, accueil, 150);
  const bout = await page.locator('#mode-chall').boundingBox();
  await page.mouse.move(bout.x + bout.width / 2, bout.y + bout.height / 2, { steps: 6 });
  await filmer(page, accueil, 20);
  await page.mouse.down(); await page.mouse.up();
  await C.patienter(page, () => document.querySelectorAll('#players .pli').length > 0, null, 20000);
  await filmer(page, accueil, 70);
  // Un bot disponible : on le sélectionne, puis « Défier ».
  const rang = await page.evaluate(() => {
    const l = Array.from(document.querySelectorAll('#players .pli'));
    const i = l.findIndex((r) => r.querySelector('.SQ-idle'));
    return i < 0 ? 0 : i;
  });
  const ligne = page.locator('#players .pli').nth(rang);
  const bl = await ligne.boundingBox();
  await page.mouse.move(bl.x + bl.width / 2, bl.y + bl.height / 2, { steps: 6 });
  await filmer(page, accueil, 15);
  await page.mouse.down(); await page.mouse.up();
  await filmer(page, accueil, 50);
  await accueil.fermer();
  const adversaire = await ligne.textContent();
  console.log('  défi à', adversaire.trim());
  const btn = await page.locator('.btn-defier').boundingBox();
  await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2, { steps: 6 });
  await C.avancer(page, 10);
  await page.mouse.down(); await page.mouse.up();
  await C.patienter(page, () => document.querySelector('#screen-game.on') && document.querySelectorAll('#pieces-layer .ball').length > 0, null, 30000);
  await page.mouse.move(1919, 1079);

  console.log('  partie…');
  const maitre = path.join(DOSSIER, 'partie-maitre.mp4');
  const enc = new C.Encodeur(maitre);
  const marques = { coups: [], fin: -1 };
  let ply = 0;
  for (let garde = 0; garde < 60 * 240; garde++) {
    const pos = await page.evaluate(lirePosition, PSEUDO);
    if (pos && pos.fin) { if (marques.fin < 0) marques.fin = enc.images; if (enc.images - marques.fin > 200) break; }
    const coup = pos && !pos.fin && pos.trait === pos.monCamp ? await page.evaluate(([m, p]) => {
      // eslint-disable-next-line no-undef
      return choisirCoup(m, p);
    }, [PSEUDO, ply]).catch(() => null) : null;
    if (coup && coup.de && coup.vers) {
      // Le geste : un temps de réflexion, la bille, un temps, la case.
      await filmer(page, enc, 25 + (ply * 7) % 20);
      await page.mouse.move(coup.de[0], coup.de[1], { steps: 4 });
      await page.mouse.down(); await page.mouse.up();
      await filmer(page, enc, 28);
      await page.mouse.move(coup.vers[0], coup.vers[1], { steps: 4 });
      await page.mouse.down(); await page.mouse.up();
      await page.mouse.move(1919, 1079);
      marques.coups.push(enc.images);
      ply += 2;
      // Le temps que le serveur valide et que le bot réponde (au plus 15 s réelles).
      const t0 = Date.now();
      for (;;) {
        await filmer(page, enc, 1);
        const p2 = await page.evaluate(lirePosition, PSEUDO);
        if (!p2 || p2.fin || (p2.trait === p2.monCamp && Date.now() - t0 > 300)) break;
        if (Date.now() - t0 > 15000) break;
      }
    } else {
      await filmer(page, enc, 1);
    }
  }
  await enc.fermer();
  await page.close();
  return { maitre, marques, adversaire: adversaire.trim() };
}

async function genererTout(nav, elements) {
  const r = await genererPartie(nav, elements);
  const acc = path.join(DOSSIER, 'accueil.mp4');
  elements.push(C.elementVideo(JEU, acc, {
    titre: 'Grapiz — accueil et salon Challenge',
    description: 'L\'écran d\'accueil de Grapiz (Fruticonnect, la sphère sur son hexagone, les modes Championnat, Matches amicaux et Challenge), le clic sur CHALLENGE et le salon : la liste des joueurs, le panneau des défis.',
    usage: 'Écran-titre du segment Grapiz.',
    affiche: C.affiche(acc, path.join(DOSSIER, 'accueil.png'), 2),
  }));
  const info = C.sonde(r.maitre);
  const { coups, fin } = r.marques;
  elements.push(C.elementVideo(JEU, r.maitre, {
    titre: 'Grapiz — partie complète en ligne (plan maître)',
    description: `Une partie de Challenge jouée en ligne sur le serveur local contre le bot « ${r.adversaire} » : chaque coup se joue à la souris (la bille choisie, les cases atteignables en cyan, la case visée), les captures, les horloges, jusqu'à la victoire par connexion (tous ses jetons réunis).${fin < 0 ? ' (Partie non conclue dans le temps imparti.)' : ''}`,
    usage: 'Réserve de plans Grapiz.',
    affiche: C.affiche(r.maitre, path.join(DOSSIER, 'partie-maitre.png'), Math.min(info.duree - 1, coups.length > 4 ? coups[4] / 60 : 5)),
    coups: coups.length,
  }));
  // L'ouverture : les premiers coups (10 s).
  const f1 = path.join(DOSSIER, 'ouverture.mp4');
  C.couper(r.maitre, f1, 0, Math.min(10, info.duree));
  elements.push(C.elementVideo(JEU, f1, {
    titre: 'Grapiz — l\'ouverture',
    description: 'Les premiers coups de la partie : les billes rouges et bleues quittent les bords du plateau hexagonal ; à chaque coup, les cases atteignables s\'allument.',
    usage: 'Plan de présentation des règles (déplacement en ligne).',
    affiche: C.affiche(f1, path.join(DOSSIER, 'ouverture.png'), Math.min(8, info.duree - 0.5)),
  }));
  // Le final : les derniers coups et le panneau de victoire (12 s).
  if (fin > 0) {
    const debut = Math.max(0, fin / 60 - 9);
    const f2 = path.join(DOSSIER, 'victoire.mp4');
    C.couper(r.maitre, f2, debut, Math.min(12, info.duree - debut));
    elements.push(C.elementVideo(JEU, f2, {
      titre: 'Grapiz — le coup gagnant',
      description: 'Les derniers coups de la partie : la bille qui relie enfin tous les jetons du même camp, puis le panneau « Victoire ! +1 à ta série ».',
      usage: 'Plan « victoire » ; fin du segment Grapiz.',
      affiche: C.affiche(f2, path.join(DOSSIER, 'victoire.png'), Math.min(10.5, info.duree - debut - 0.5)),
    }));
  }
}

async function genererExtras(nav, elements) {
  const j = await C.jaquettePng(nav, 'public/frutiz/sprites/disc_jaquette_grapiz.svg', path.join(DOSSIER, 'jaquette.png'), 1200);
  elements.push({ fichier: path.relative(C.SORTIE, j.fichier), jeu: JEU, type: 'image', titre: 'Grapiz — jaquette du disque',
    description: 'La jaquette du disque Grapiz (disc_jaquette_grapiz.svg du bureau Frutiz), rendue en PNG transparent.',
    usage: 'Carton de présentation du jeu.', largeur: j.largeur, hauteur: j.hauteur, alpha: true });
  // Les billes et le plateau d'origine (bitmaps récupérés du jeu).
  for (const [src, nom, titre] of [['public/grapiz/bille_rouge.png', 'bille-rouge.png', 'Grapiz — bille rouge'], ['public/grapiz/bille_bleue.png', 'bille-bleue.png', 'Grapiz — bille bleue'], ['public/grapiz/hex_grapiz.png', 'plateau-hex.png', 'Grapiz — case hexagonale']]) {
    const f = path.join(DOSSIER, nom);
    fs.copyFileSync(path.join(C.RACINE, src), f);
    elements.push({ fichier: path.relative(C.SORTIE, f), jeu: JEU, type: 'image', titre, description: 'Image d\'origine du jeu (' + src + '), à incruster.', usage: 'Habillage, transitions.', alpha: true });
  }
}

async function generer(nav, quoi) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const elements = [];
  const tout = !quoi || !quoi.length;
  if (tout || quoi.includes('partie')) await genererTout(nav, elements);
  if (tout || quoi.includes('extras')) await genererExtras(nav, elements);
  return elements;
}

module.exports = { JEU, generer, lirePosition, choisirCoup };

if (require.main === module) {
  (async () => {
    await C.demarrerServeur();
    const nav = await C.ouvrirNavigateur();
    try {
      const elements = await generer(nav, process.argv.slice(2));
      C.ecrireFragment(JEU, elements, process.argv.length > 2);
      console.log(`${JEU} : ${elements.length} éléments`);
    } finally {
      await nav.close();
      C.arreterServeur();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
