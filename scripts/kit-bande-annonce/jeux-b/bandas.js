#!/usr/bin/env node
/*
 * Kit bande-annonce, section jeux-b — FRUTIBANDAS (public/bandas/).
 *
 *   node scripts/kit-bande-annonce/jeux-b/bandas.js [partie] [extras]
 *
 * Produit dans kit-bande-annonce/jeux-b/bandas/ :
 *   · accueil.mp4 — l'écran des modes puis le salon du Challenge ;
 *   · partie-maitre.mp4 — une VRAIE partie en ligne contre un bot du serveur :
 *     le draft des fruticartes, puis la bataille des oranges contre les
 *     bananes (les fruits poussés hors du plateau, le plateau qui rétrécit,
 *     les cartes — enclume, vachette, pétrification…) jusqu'à la victoire ;
 *     et les plans qu'on y découpe (le draft, les cartes jouées, la fin) ;
 *   · la jaquette, la musique et quelques bruitages.
 *
 * Notre camp est joué par l'IA de Frutibandas elle-même (public/bandas/
 * server/bot.js, au plus fort), chargée dans la page : elle choisit la carte
 * du draft, la carte à jouer et sa cible, le mouvement ; le harnais exécute
 * au clavier (les flèches) et à la souris (la carte, puis la case visée).
 * Comme pour Grapiz, le serveur répond en temps réel : chaque lancement
 * filme une partie différente.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./commun');

const JEU = 'bandas';
const DOSSIER = path.join(C.SORTIE, JEU);
const CSS = 'html,body{background:' + C.VERT_SITE + '!important}#fp-fd-badge{display:none!important}';
const PSEUDO = 'kiwinette';

// La décision de notre camp, prise dans la page (lue sur la vue du jeu).
function decisionBandas() {
  const GV = window.BandasView, B = window.Bandas && window.Bandas.bot;
  if (!GV || !B || !GV.started || GV.ended || !GV.board) return { etat: 'attente' };
  if (GV.queue.length || GV.anims.length) return { etat: 'anim' };
  if (GV.currentTeam !== GV.myTeam) return { etat: 'adversaire' };
  const slot = (c) => {
    const el = document.querySelector('#slots' + GV.myTeam + ' .cardslot.play[data-card="' + c + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const caseEcran = (x, y) => {
    const cv = document.getElementById('bd-canvas');
    const r = cv.getBoundingClientRect();
    const s = r.width / cv.width;
    return [r.left + (GV.originX + (x + 0.5) * 46) * s, r.top + (GV.originY + (y + 0.5) * 46) * s];
  };
  if (GV.phase === 1) {
    if (!GV.pool || !GV.pool.length) return { etat: 'attente' };
    const c = B.chooseDraft(GV.pool, 1, Math.random);
    return { etat: 'draft', carte: c, slot: slot(c) };
  }
  if (!GV.cardPlayedThisTurn && GV.targetCard === null) {
    let cp = null;
    try { cp = B.chooseCardPlay({ board: GV.board, hands: GV.hands }, GV.myTeam, 1, Math.random); } catch (e) { cp = null; }
    if (cp && slot(cp.card)) {
      return { etat: 'carte', carte: cp.card, slot: slot(cp.card), cible: (cp.x !== undefined && cp.x !== null) ? caseEcran(cp.x, cp.y) : null };
    }
  }
  const d = B.chooseMove(GV.board, GV.myTeam, 1, Math.random);
  return { etat: 'coup', touche: ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][d] };
}

async function filmer(page, enc, n, journal) {
  for (let i = 0; i < n; i++) {
    await C.avancer(page, 1);
    await enc.ecrire(await C.capturer(page));
    if (journal) journal.push(await page.evaluate(() => {
      const GV = window.BandasView;
      return GV ? { a: GV.anims.length, f: GV.effects.length, p: GV.phase, fin: !!GV.ended } : null;
    }));
  }
}

async function ouvrir(nav, sid) {
  const page = await C.nouvellePage(nav, { css: CSS, graine: 1313 });
  await page.goto(C.BASE + '/bandas/?sid=' + sid);
  await page.addScriptTag({ url: '/bandas/server/bot.js' });
  await page.addScriptTag({ content: decisionBandas.toString() });
  await C.patienter(page, () => document.querySelector('#screen-mode.on') && window.Bandas && window.Bandas.bot, null, 30000);
  await C.avancer(page, 30);
  return page;
}

async function cliquer(page, x, y) {
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.down();
  await page.mouse.up();
}

async function genererPartie(nav) {
  const sid = await C.compte(PSEUDO);
  const page = await ouvrir(nav, sid);
  console.log('  accueil et salon…');
  const accueil = new C.Encodeur(path.join(DOSSIER, 'accueil.mp4'));
  await filmer(page, accueil, 150);
  const bm = await page.locator('#mode-chall').boundingBox();
  await page.mouse.move(bm.x + bm.width / 2, bm.y + bm.height / 2, { steps: 6 });
  await filmer(page, accueil, 20);
  await page.mouse.down(); await page.mouse.up();
  await C.patienter(page, () => document.querySelectorAll('#players .pli').length > 0, null, 20000);
  await filmer(page, accueil, 70);
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
  const adversaire = (await ligne.textContent()).trim();
  console.log('  défi à', adversaire);
  const btn = await page.locator('.btn-defier').boundingBox();
  await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2, { steps: 6 });
  await C.avancer(page, 10);
  await page.mouse.down(); await page.mouse.up();
  await C.patienter(page, () => document.querySelector('#screen-game.on') && window.BandasView && window.BandasView.started, null, 30000);
  await page.mouse.move(1919, 1079);

  console.log('  partie…');
  const maitre = path.join(DOSSIER, 'partie-maitre.mp4');
  const enc = new C.Encodeur(maitre);
  const journal = [];
  const marques = { cartes: [], fin: -1, debutJeu: -1 };
  let tours = 0;
  for (let garde = 0; garde < 60 * 300; garde++) {
    const d = await page.evaluate(() => decisionBandas()).catch((e) => ({ etat: 'erreur', e: String(e) }));
    const derniere = journal[journal.length - 1];
    if (derniere && derniere.fin) { if (marques.fin < 0) marques.fin = enc.images; if (enc.images - marques.fin > 240) break; }
    if (derniere && derniere.p === 2 && marques.debutJeu < 0) marques.debutJeu = enc.images;
    if (d.etat === 'draft' && d.slot) {
      await filmer(page, enc, 40, journal);
      await cliquer(page, d.slot[0], d.slot[1]);
      await page.mouse.move(1919, 1079);
      await filmer(page, enc, 20, journal);
    } else if (d.etat === 'carte' && d.slot) {
      await filmer(page, enc, 30, journal);
      await cliquer(page, d.slot[0], d.slot[1]);
      await filmer(page, enc, 24, journal);
      if (d.cible) { await cliquer(page, d.cible[0], d.cible[1]); await filmer(page, enc, 6, journal); }
      await page.mouse.move(1919, 1079);
      marques.cartes.push({ image: enc.images, carte: d.carte });
      await filmer(page, enc, 10, journal);
    } else if (d.etat === 'coup') {
      await filmer(page, enc, 22 + (tours * 5) % 14, journal);
      await page.keyboard.press(d.touche);
      tours++;
      await filmer(page, enc, 6, journal);
    } else {
      await filmer(page, enc, 1, journal);
    }
    if (garde % 300 === 0) console.log(`    ${enc.images} images, ${tours} coups, ${marques.cartes.length} cartes`);
  }
  await enc.fermer();
  await page.close();
  return { maitre, marques, adversaire, journal };
}

const NOMS_CARTES = ['Enclume', 'Célérité', 'Confiscation', 'Renfort', 'Désordre', 'Pétrification', 'Vachette', 'Conversion', 'Charge', 'Entracte', 'Solo', 'Piège'];

async function genererTout(nav, elements) {
  const r = await genererPartie(nav);
  const acc = path.join(DOSSIER, 'accueil.mp4');
  elements.push(C.elementVideo(JEU, acc, {
    titre: 'Frutibandas — accueil et salon Challenge',
    description: 'L\'écran d\'accueil de Frutibandas et ses modes (Championnat, Matches amicaux, Challenge), le clic sur CHALLENGE et le salon des joueurs.',
    usage: 'Écran-titre du segment Frutibandas.',
    affiche: C.affiche(acc, path.join(DOSSIER, 'accueil.png'), 2),
  }));
  const info = C.sonde(r.maitre);
  const { cartes, fin, debutJeu } = r.marques;
  elements.push(C.elementVideo(JEU, r.maitre, {
    titre: 'Frutibandas — partie complète en ligne (plan maître)',
    description: `Une partie de Challenge jouée en ligne sur le serveur local contre le bot « ${r.adversaire} » : le draft des fruticartes, puis les oranges et les bananes qui se poussent hors du plateau, le plateau qui rétrécit, ${cartes.length} carte(s) jouée(s) par notre camp (${[...new Set(cartes.map((c) => NOMS_CARTES[c.carte]))].join(', ') || 'aucune'}), jusqu'à la fin de partie.`,
    usage: 'Réserve de plans Frutibandas.',
    affiche: C.affiche(r.maitre, path.join(DOSSIER, 'partie-maitre.png'), Math.min(info.duree - 1, debutJeu > 0 ? debutJeu / 60 + 8 : 15)),
  }));
  // Le draft (s'il a eu lieu) : 10 s depuis le début.
  if (debutJeu > 300) {
    const f = path.join(DOSSIER, 'draft.mp4');
    C.couper(r.maitre, f, Math.max(0, debutJeu / 60 - 10), 10);
    elements.push(C.elementVideo(JEU, f, {
      titre: 'Frutibandas — le draft des fruticartes',
      description: 'Avant la bataille, chaque joueur choisit à tour de rôle ses fruticartes parmi celles tirées au sort (faces pour soi, dos pour l\'adversaire).',
      usage: 'Plan d\'explication des cartes.',
      affiche: C.affiche(f, path.join(DOSSIER, 'draft.png'), 6),
    }));
  }
  // La bataille : 12 s après le début du jeu ; la ou les cartes ; la fin.
  if (debutJeu >= 0) {
    const f = path.join(DOSSIER, 'bataille.mp4');
    const d0 = debutJeu / 60 + 4;
    C.couper(r.maitre, f, d0, Math.min(12, info.duree - d0));
    elements.push(C.elementVideo(JEU, f, {
      titre: 'Frutibandas — la poussée',
      description: 'Les oranges (béret rouge) et les bananes (béret vert) avancent toutes ensemble d\'une case à chaque tour et se poussent : les fruits du bord tombent du plateau.',
      usage: 'Plan d\'action ; présente la règle du jeu en un coup d\'œil.',
      affiche: C.affiche(f, path.join(DOSSIER, 'bataille.png'), 6),
    }));
  }
  cartes.slice(0, 2).forEach((c, k) => {
    const f = path.join(DOSSIER, `carte-${k + 1}.mp4`);
    const d0 = Math.max(0, c.image / 60 - 4);
    C.couper(r.maitre, f, d0, Math.min(9, info.duree - d0));
    elements.push(C.elementVideo(JEU, f, {
      titre: `Frutibandas — carte « ${NOMS_CARTES[c.carte]} »`,
      description: `Notre camp joue la fruticarte « ${NOMS_CARTES[c.carte]} » : la carte choisie dans la main, la case visée, puis son effet animé sur le plateau.`,
      usage: 'Plan « coup spécial ».',
      affiche: C.affiche(f, path.join(DOSSIER, `carte-${k + 1}.png`), Math.min(5.5, info.duree - d0 - 0.2)),
    }));
  });
  if (fin > 0) {
    const f = path.join(DOSSIER, 'fin.mp4');
    const d0 = Math.max(0, fin / 60 - 8);
    C.couper(r.maitre, f, d0, Math.min(12, info.duree - d0));
    elements.push(C.elementVideo(JEU, f, {
      titre: 'Frutibandas — la fin de partie',
      description: 'Les derniers tours : le plateau a rétréci, les derniers fruits tombent, et le panneau de fin annonce le vainqueur.',
      usage: 'Plan de conclusion du segment Frutibandas.',
      affiche: C.affiche(f, path.join(DOSSIER, 'fin.png'), Math.min(9.5, info.duree - d0 - 0.2)),
    }));
  }
}

async function genererExtras(nav, elements) {
  const j = await C.jaquettePng(nav, 'public/frutiz/sprites/disc_jaquette_bandas.svg', path.join(DOSSIER, 'jaquette.png'), 1200);
  elements.push({ fichier: path.relative(C.SORTIE, j.fichier), jeu: JEU, type: 'image', titre: 'Frutibandas — jaquette du disque',
    description: 'La jaquette du disque Frutibandas (disc_jaquette_bandas.svg du bureau Frutiz), rendue en PNG transparent.',
    usage: 'Carton de présentation du jeu.', largeur: j.largeur, hauteur: j.hauteur, alpha: true });
  const dossierSons = path.join(C.RACINE, 'public/bandas/assets');
  const trouves = [];
  (function chercher(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) chercher(p);
      else if (/\.(mp3|ogg|wav)$/i.test(n)) trouves.push(path.relative(C.RACINE, p));
    }
  })(dossierSons);
  for (const src of trouves.slice(0, 8)) {
    const base = path.basename(src).replace(/\.(mp3|wav|ogg)$/i, '');
    const ext = /\.wav$/i.test(src) ? '.wav' : '.ogg';
    const f = path.join(DOSSIER, 'sons', base + ext);
    const duree = C.copierSon(src, f);
    const noms = { intro: 'musique d\'introduction', loop: 'musique de partie (boucle)' };
    elements.push(C.elementSon(JEU, f, duree, { titre: 'Frutibandas — ' + (noms[base] || base), description: 'Son du jeu (' + src + '), converti en OGG. Le jeu n\'a pas d\'autres bruitages : seulement ses deux musiques.', usage: 'Bande son du segment Frutibandas.' }));
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

module.exports = { JEU, generer, decisionBandas };

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
