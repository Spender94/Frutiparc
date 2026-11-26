#!/usr/bin/env node
/*
 * Kit bande-annonce, section jeux-b — MINI-WAVE (public/miniwave/).
 *
 *   node scripts/kit-bande-annonce/jeux-b/miniwave.js
 *
 * Produit dans kit-bande-annonce/jeux-b/miniwave/ :
 *   · menu.mp4 — l'écran-titre (le panneau « Bienvenue » qui s'écrit, le
 *     survol des rubriques), 5 s ;
 *   · arcade-maitre.mp4 — une partie d'Arcade lancée depuis le menu, pilotée
 *     par une petite IA (esquive des tirs, visée de l'ennemi le plus proche,
 *     bombe en dernier recours), et les plans de 10–12 s qu'on y découpe
 *     là où ça explose le plus ;
 *   · boss-maitre.mp4 — le combat contre Orangre, le boss des fruits mutants
 *     (partie d'Arcade posée directement au dernier niveau par le harnais),
 *     et son plan ;
 *   · les affiches, la jaquette, la musique et les bruitages.
 *
 * Déterminisme : l'horloge de la page est virtuelle (commun.js) ; la graine
 * de la partie vient de Date.now(), donc de l'horloge virtuelle, et les
 * éclats de Math.random, remplacé par un tirage à graine. Les décisions de
 * l'IA sont calculées dans la page, mais les touches partent par le clavier
 * de Playwright. Deux lancements donnent le même film.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./commun');

const JEU = 'miniwave';
const DOSSIER = path.join(C.SORTIE, JEU);
const CSS = '#aide,#muet,#pause,#manette,#message{display:none!important}'
  + 'html,body{background:' + C.VERT_SITE + '!important}';

// ── L'IA, évaluée dans la page ────────────────────────────────────────────
// Elle LIT l'état du moteur (les tirs ennemis, la vague, le boss) et rend les
// touches qu'un joueur tiendrait : gauche, droite, tir, bombe. Elle ne touche
// à rien. Les vitesses des tirs sont MESURÉES d'une image Flash à l'autre :
// les tirs à tête chercheuse ou en spirale n'ont pas de vitx/vity fiables.
function installerIA() {
  window.__iaMiniwave = function () {
    const c = window.miniwaveClient;
    const j = c && c.jeu;
    const res = { g: false, d: false, tir: false, bombe: false };
    if (!j || j.termine || !j.hero || (c.avant && c.avant.visible)) return res;
    const H = j.hero, L = 240, yH = H.y;
    const m = window.__iaMem || (window.__iaMem = { pos: new WeakMap(), vit: new WeakMap(), anim: -1, cible: H.x, coups: 0 });
    // Vitesses observées, par image Flash.
    if (c.animT !== m.anim) {
      const suivre = (o) => {
        const p = m.pos.get(o);
        if (p && c.animT > p.a) {
          const n = c.animT - p.a;
          m.vit.set(o, { vx: (o.x - p.x) / n, vy: (o.y - p.y) / n });
        }
        m.pos.set(o, { x: o.x, y: o.y, a: c.animT });
      };
      j.bShotList.forEach(suivre);
      j.badsList.forEach(suivre);
      m.anim = c.animT;
    }
    res.tir = true;
    const pasHero = Math.max(1, (H.speed || 3) * 0.8);
    const risque = (x) => {
      let r = 0;
      for (const s of j.bShotList) {
        if (!s.vivant) continue;
        const v = m.vit.get(s) || { vx: (s.vitx || 0) * 0.8, vy: (s.vity || 0) * 0.8 };
        const dy = yH - s.y;
        if (dy < -10) continue;
        let t;
        if (Math.abs(dy) < 12) t = 0;
        else if (v.vy > 0.05) t = dy / v.vy;
        else continue;
        if (t > 50) continue;
        const xs = s.x + v.vx * t;
        const ecart = Math.abs(xs - x);
        if (ecart < 13) {
          const arrivee = Math.abs(x - H.x) / pasHero;
          r += (t < arrivee + 4 ? 1000 : 250) / (1 + t / 12);
        }
      }
      for (const b of j.badsList) {
        if (!b.vivant) continue;
        const bx = b.px, by = b.py;
        if (by < yH - 70) continue;
        const v = m.vit.get(b) || { vx: 0, vy: 0 };
        const t = v.vy > 0.1 ? Math.max(0, (yH - by) / v.vy) : 0;
        if (Math.abs(bx + v.vx * Math.min(t, 20) - x) < 20) r += 800;
      }
      if (j.boss && j.boss.vivant !== false) {
        const B = j.boss;
        if (B.y + (B.ray || 25) > yH - 40 && Math.abs(B.x - x) < (B.ray || 25) + 14) r += 900;
      }
      return r;
    };
    // La cible : une pièce qui tombe, sinon le boss, sinon le fruit le plus
    // proche (les plus bas d'abord : ce sont eux qui menacent).
    let cible = null;
    for (const o of j.optList) {
      if (o.vivant && o.y > 110 && o.y < yH && (cible === null || Math.abs(o.x - H.x) < Math.abs(cible - H.x))) cible = o.x;
    }
    if (cible === null && j.boss && j.boss.vivant !== false) cible = j.boss.x;
    if (cible === null) {
      let meilleur = Infinity;
      for (const b of j.badsList) {
        if (!b.vivant) continue;
        const v = m.vit.get(b) || { vx: 0, vy: 0 };
        const vol = Math.max(0, (yH - b.py) / 2.6);
        const bx = Math.max(10, Math.min(L - 10, b.px + v.vx * Math.min(vol, 25)));
        const s = Math.abs(bx - H.x) - 0.35 * b.py;
        if (s < meilleur) { meilleur = s; cible = bx; }
      }
    }
    if (cible === null) cible = L / 2;
    const ray = H.ray || 8;
    let choix = H.x, cout = Infinity, risqueIci = risque(H.x), meilleurRisque = Infinity;
    for (let x = ray + 2; x <= L - ray - 2; x += 2) {
      const r = risque(x);
      const k = r + 0.25 * Math.abs(x - cible) + 0.08 * Math.abs(x - H.x);
      if (k < cout) { cout = k; choix = x; }
      if (r < meilleurRisque) meilleurRisque = r;
    }
    // Hystérésis : on ne change de cap que si l'on y gagne vraiment, sans quoi
    // le vaisseau tremblerait d'une image à l'autre.
    const coutAncien = risque(m.cible) + 0.25 * Math.abs(m.cible - cible) + 0.08 * Math.abs(m.cible - H.x);
    if (cout < coutAncien - 3) m.cible = choix;
    if (m.cible > H.x + 1.6) res.d = true;
    else if (m.cible < H.x - 1.6) res.g = true;
    // La bombe : quand rien n'est sûr et que ça va toucher.
    if (H.flBomb && risqueIci >= 900 && meilleurRisque >= 600) res.bombe = true;
    return res;
  };
}

// Un journal des événements du moteur, pour choisir les meilleurs moments.
function installerJournal() {
  const c = window.miniwaveClient;
  window.__journal = [];
  const annonce = c.annonce.bind(c);
  c.annonce = function (nom, d) {
    window.__journal.push(nom);
    return annonce(nom, d);
  };
}
const POIDS = {
  badsExplose: 4, badsEcaille: 1, bossRenvoi: 2, bossExplose: 60, soucoupeExplose: 12,
  ondeChoc: 6, bonus: 2, heroExplose: -80, heroTouche: -10, finPartie: -200, panneau: -3,
};

// ── Les touches ───────────────────────────────────────────────────────────
const TOUCHES = { g: 'ArrowLeft', d: 'ArrowRight', tir: 'Space', bombe: 'Shift' };
async function appliquer(page, etat, voulu) {
  for (const k of Object.keys(TOUCHES)) {
    if (!!voulu[k] !== !!etat[k]) {
      if (voulu[k]) await page.keyboard.down(TOUCHES[k]); else await page.keyboard.up(TOUCHES[k]);
      etat[k] = !!voulu[k];
    }
  }
}

/**
 * Joue et filme : `images` images au plus (ou jusqu'à `fini()`), l'IA aux
 * commandes ; rend le score d'intérêt de chaque image.
 */
async function jouerEtFilmer(page, enc, maxImages, opts) {
  opts = opts || {};
  const etat = {};
  const scores = [];
  let finA = -1;
  for (let i = 0; i < maxImages; i++) {
    const r = await page.evaluate((ms) => {
      window.__vt.avancer(ms);
      const j = window.__journal.splice(0);
      const jeu = window.miniwaveClient.jeu;
      return {
        ia: window.__iaMiniwave(), j,
        fini: !!(jeu && jeu.termine), boss: !!(jeu && jeu.boss), vaincu: !!(jeu && jeu.arcadeFinie),
        niveau: jeu ? jeu.level : -1,
      };
    }, C.IMAGE);
    await appliquer(page, etat, r.ia);
    if (r.ia.bombe) { await page.keyboard.up('Shift'); etat.bombe = false; }
    let s = 0;
    for (const n of r.j) s += POIDS[n] || 0;
    scores.push(s);
    await enc.ecrire(await C.capturer(page));
    if ((r.fini || (opts.arreterSiVaincu && r.vaincu)) && finA < 0) finA = i;
    if (finA >= 0 && i - finA > (opts.queue || 150)) break;
    if (i % 600 === 0) process.stdout.write(`    image ${i} (niveau ${r.niveau + 1})\n`);
  }
  await appliquer(page, etat, {});
  return scores;
}

async function ouvrirJeu(nav) {
  const page = await C.nouvellePage(nav, { css: CSS, graine: 2005 });
  await page.goto(C.BASE + '/miniwave/');
  await C.patienter(page, () => !!(window.__ui && window.miniwaveClient && window.__ui.visible));
  return page;
}

// Coordonnées d'écran d'un point de la scène 240×240.
async function versEcran(page, x, y) {
  const r = await page.evaluate(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width }; });
  return { x: r.l + x * r.w / 240, y: r.t + y * r.w / 240 };
}

async function genererMenu(nav, elements) {
  console.log('  menu…');
  const page = await ouvrirJeu(nav);
  const enc = new C.Encodeur(path.join(DOSSIER, 'menu.mp4'));
  // Le survol éclaire les rubriques une à une (le curseur n'est pas filmé).
  const parcours = [[60, 64], [60, 64], [60, 95], [60, 124], [60, 190]];
  for (let i = 0; i < 300; i++) {
    const etape = Math.floor(i / 60);
    if (i % 60 === 30 && parcours[etape]) {
      const p = await versEcran(page, parcours[etape][0], parcours[etape][1]);
      await page.mouse.move(p.x, p.y);
    }
    await C.avancer(page, 1);
    await enc.ecrire(await C.capturer(page));
  }
  await enc.fermer();
  await page.close();
  const f = path.join(DOSSIER, 'menu.mp4');
  const aff = C.affiche(f, path.join(DOSSIER, 'menu.png'), 4.5);
  elements.push(C.elementVideo(JEU, f, {
    titre: 'Mini-Wave — écran-titre',
    description: 'Le menu du jeu tel qu\'il s\'ouvre : le logo mini2wave, les rubriques Arcade, Bonus, Special, Challenge et Stand, le panneau « Bienvenue » qui s\'écrit lettre à lettre et les rubriques qui s\'éclairent au survol.',
    usage: 'Plan d\'ouverture du segment Mini-Wave, ou carton titre avant les plans d\'action.',
    affiche: aff,
  }));
}

async function genererArcade(nav, elements) {
  console.log('  arcade (partie lancée depuis le menu)…');
  const page = await ouvrirJeu(nav);
  await page.evaluate(installerIA);
  await page.evaluate(installerJournal);
  // Le clic sur ARCADE (sans compte : un seul vaisseau, la partie part tout de suite).
  const p = await versEcran(page, 60, 64);
  await C.avancer(page, 110);              // les encadrés finissent de s'ouvrir
  await page.mouse.move(p.x, p.y);
  await C.avancer(page, 10);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(1900, 1060);
  await C.patienter(page, () => !!(window.miniwaveClient.jeu && !window.__ui.visible));
  const maitre = path.join(DOSSIER, 'arcade-maitre.mp4');
  const enc = new C.Encodeur(maitre);
  const scores = await jouerEtFilmer(page, enc, 60 * 110, { queue: 120 });
  await enc.fermer();
  await page.close();
  const info = C.sonde(maitre);
  elements.push(C.elementVideo(JEU, maitre, {
    titre: 'Mini-Wave — partie d\'Arcade (plan maître)',
    description: 'Une partie d\'Arcade complète depuis le premier niveau, jouée par une IA d\'esquive : les escadres de fruits mutants arrivent en formation, le vaisseau les dégomme une à une, les pièces tombent, les panneaux de niveau défilent.',
    usage: 'Réserve de plans : y couper d\'autres moments que les plans proposés.',
    affiche: C.affiche(maitre, path.join(DOSSIER, 'arcade-maitre.png'), Math.min(20, info.duree / 3)),
  }));
  // La meilleure fenêtre de 11 s, après le panneau « level 1 ».
  decouper(maitre, scores, 'arcade', 1, 11, {
    debutMin: 150,
    titre: 'Mini-Wave — premières escadres',
    description: 'Onze secondes du début d\'une partie d\'Arcade : le vaisseau slalome entre les tirs et fait éclater les fruits mutants de la première vague. Découpé automatiquement là où les explosions sont les plus nombreuses.',
    usage: 'Plan d\'action ; découverte du jeu.',
  }, elements);
}

/**
 * Découpe `n` plans de `secondes` dans un maître, là où le score d'intérêt
 * est le plus fort, en fuyant la perte d'un vaisseau et la fin de partie ;
 * l'affiche de chaque plan est l'image la plus chargée en explosions.
 */
function decouper(maitre, scores, prefixe, n, secondes, meta, elements) {
  const L = Math.round(60 * secondes);
  const mauvais = scores.map((s) => (s <= -10 ? 1 : 0));
  const fenetres = C.meilleuresFenetres(scores, L, n, {
    debutMin: meta.debutMin || 150,
    interdit: (a, b) => mauvais.slice(a, b + 30).some(Boolean),
  });
  fenetres.forEach((d, k) => {
    const nom = n > 1 ? `${prefixe}-${k + 1}` : prefixe;
    const f = path.join(DOSSIER, nom + '.mp4');
    C.couper(maitre, f, d / 60, L / 60);
    let pic = d + Math.floor(L / 2), best = -1;
    for (let i = d + 30; i < d + L - 30; i++) {
      const s = scores.slice(Math.max(d, i - 24), i + 1).reduce((x, y) => x + y, 0);
      if (s > best) { best = s; pic = i; }
    }
    const aff = C.affiche(f, path.join(DOSSIER, nom + '.png'), (pic - d) / 60);
    elements.push(C.elementVideo(JEU, f, {
      titre: meta.titre + (n > 1 ? ` (${k + 1})` : ''),
      description: meta.description, usage: meta.usage, affiche: aff,
    }));
  });
}

/**
 * Une partie d'Arcade posée par le harnais à un niveau donné (4 vaisseaux,
 * comme le jeu) : le moteur la joue telle quelle, l'IA tient les commandes.
 * C'est la seule mise en scène — rien dans les règles n'est touché.
 */
async function partieAuNiveau(nav, niveau) {
  const page = await ouvrirJeu(nav);
  await page.evaluate(installerIA);
  await page.evaluate(installerJournal);
  await page.evaluate((n) => {
    const c = window.miniwaveClient;
    window.__ui.fermer();
    c.nouvellePartie({ mode: 'arcade', vies: 4, ship: 0 });
    const j = c.jeu;
    j.level = n < 0 ? j.waveInfo.length - 1 : n;
    j.initStep(0);
  }, niveau);
  return page;
}

async function genererAvance(nav, elements) {
  console.log('  vagues avancées (niveau 61, « L\'essaim »)…');
  const page = await partieAuNiveau(nav, 60);
  const maitre = path.join(DOSSIER, 'vagues-maitre.mp4');
  const enc = new C.Encodeur(maitre);
  const scores = await jouerEtFilmer(page, enc, 60 * 80, { queue: 120 });
  await enc.fermer();
  await page.close();
  const info = C.sonde(maitre);
  elements.push(C.elementVideo(JEU, maitre, {
    titre: 'Mini-Wave — vagues du milieu de parcours (plan maître)',
    description: 'Une partie d\'Arcade reprise au niveau 61 (« L\'essaim ») : des escadres plus denses et plus variées, plus de tirs à esquiver, jouée par l\'IA d\'esquive.',
    usage: 'Réserve de plans d\'action intense.',
    affiche: C.affiche(maitre, path.join(DOSSIER, 'vagues-maitre.png'), Math.min(info.duree / 2, 25)),
  }));
  decouper(maitre, scores, 'vagues', 2, 11, {
    titre: 'Mini-Wave — les escadres explosent',
    description: 'Onze secondes au cœur de la bataille, en milieu de parcours d\'Arcade : les fruits mutants pleuvent, le vaisseau esquive et les fait éclater en chaîne. Découpé automatiquement là où les explosions sont les plus nombreuses.',
    usage: 'Plan d\'action rapide ; idéal en montage cut sur la musique.',
  }, elements);
}

async function genererBoss(nav, elements) {
  console.log('  boss Orangre…');
  const page = await partieAuNiveau(nav, -1);
  const maitre = path.join(DOSSIER, 'boss-maitre.mp4');
  const enc = new C.Encodeur(maitre);
  const scores = await jouerEtFilmer(page, enc, 60 * 100, { arreterSiVaincu: true, queue: 240 });
  await enc.fermer();
  await page.close();
  const info = C.sonde(maitre);
  elements.push(C.elementVideo(JEU, maitre, {
    titre: 'Mini-Wave — combat contre Orangre (plan maître)',
    description: 'Le combat de fin d\'Arcade : l\'avertissement « zone à haut risque », la coquille d\'Orangre qui descend, ses attaques et ses escortes, joué par l\'IA d\'esquive.',
    usage: 'Réserve de plans pour le climax du segment Mini-Wave.',
    affiche: C.affiche(maitre, path.join(DOSSIER, 'boss-maitre.png'), Math.min(info.duree - 1, 14)),
  }));
  decouper(maitre, scores, 'boss', 1, 12, {
    debutMin: 60 * 4,
    titre: 'Mini-Wave — le boss Orangre',
    description: 'Douze secondes du combat contre Orangre, le boss des fruits mutants : tirs croisés, esquives, impacts sur la coquille.',
    usage: 'Plan « montée en tension » avant le titre du jeu.',
  }, elements);
}

async function genererJaquetteEtSons(nav, elements) {
  const j = await C.jaquettePng(nav, 'public/frutiz/sprites/disc_jaquette_miniwave.svg', path.join(DOSSIER, 'jaquette.png'), 1200);
  elements.push({ fichier: path.relative(C.SORTIE, j.fichier), jeu: JEU, type: 'image', titre: 'Mini-Wave — jaquette du disque',
    description: 'La jaquette du disque Mini-Wave, telle que le bureau Frutiz l\'affiche (disc_jaquette_miniwave.svg), rendue en PNG transparent.',
    usage: 'Carton de présentation du jeu, ou incrustation à côté des plans.', largeur: j.largeur, hauteur: j.hauteur, alpha: true });
  const sons = [
    ['public/miniwave/sons/sGame.mp3', 'musique-jeu.ogg', 'Mini-Wave — musique de jeu', 'La musique de partie (boucle).'],
    ['public/miniwave/sons/sMenu.mp3', 'musique-menu.ogg', 'Mini-Wave — musique du menu', 'La musique de l\'écran-titre (boucle).'],
    ['public/miniwave/sons/sPop0.wav', 'explosion-fruit.wav', 'Mini-Wave — un fruit éclate', 'Le « pop » d\'un fruit mutant abattu.'],
    ['public/miniwave/sons/sLaser1.mp3', 'tir.ogg', 'Mini-Wave — tir du vaisseau', 'Le tir de base du vaisseau.'],
    ['public/miniwave/sons/sExplo2.wav', 'bombe.wav', 'Mini-Wave — bombe', 'L\'onde de choc de la bombe du vaisseau.'],
    ['public/miniwave/sons/sBlast0.wav', 'vaisseau-detruit.wav', 'Mini-Wave — vaisseau détruit', 'L\'explosion du vaisseau du joueur.'],
    ['public/miniwave/sons/sJingle2.mp3', 'jingle-niveau.ogg', 'Mini-Wave — jingle de niveau', 'Le jingle du panneau « level n ».'],
  ];
  for (const [src, nom, titre, desc] of sons) {
    if (!fs.existsSync(path.join(C.RACINE, src))) { console.warn('  son absent :', src); continue; }
    const f = path.join(DOSSIER, 'sons', nom);
    const duree = C.copierSon(src, f);
    elements.push(C.elementSon(JEU, f, duree, { titre, description: desc + ' Fichier du site (' + src + '), converti en OGG.', usage: 'Bande son du segment Mini-Wave.' }));
  }
}

async function generer(nav, quoi) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const elements = [];
  const tout = !quoi || !quoi.length;
  if (tout || quoi.includes('menu')) await genererMenu(nav, elements);
  if (tout || quoi.includes('arcade')) await genererArcade(nav, elements);
  if (tout || quoi.includes('avance')) await genererAvance(nav, elements);
  if (tout || quoi.includes('boss')) await genererBoss(nav, elements);
  if (tout || quoi.includes('extras')) await genererJaquetteEtSons(nav, elements);
  return elements;
}

module.exports = { JEU, generer };

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
