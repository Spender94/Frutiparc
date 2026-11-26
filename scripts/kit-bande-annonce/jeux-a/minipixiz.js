#!/usr/bin/env node
/*
 * Kit bande-annonce — MiniPixiz (public/minipixiz/), section « jeux-a ».
 *
 *   node scripts/kit-bande-annonce/jeux-a/minipixiz.js [--seul=<nom>] [--replan]
 *
 * Sortie : /home/user/Frutiparc/kit-bande-annonce/jeux-a/minipixiz/
 *
 * L'ARBRE CREUX (le mode classé : des billes qui tombent, quatre de même
 * couleur éclatent, et la cascade rapporte de plus en plus à chaque maillon).
 *
 * 1. Le PLAN (Node) : lib/minipixiz-ia.js joue une partie dans le vrai moteur
 *    (lieux.js), au pas d'un écran à 60 Hz, et en tient le journal de touches —
 *    vérifié par le rejeu du serveur (rejeu.js). Gardé dans minipixiz/plan.json.
 * 2. La CAPTURE (Chromium, page /minipixiz/) : on entre dans l'arbre creux
 *    comme un joueur — un vrai clic sur l'arbre de la clairière —, avec la
 *    graine du plan (la demande de graine au serveur est remplacée, dans la
 *    page, par celle du plan : sans compte, il n'y en aurait pas). Puis le
 *    journal est rejoué AU CLAVIER, par Playwright : de vrais événements, que
 *    la garde des entrées (js/garde-entrees.js) accepte comme ceux d'un joueur.
 *    On avance sans filmer jusqu'au plan choisi, puis image par image.
 *
 * La page expose son client sur 127.0.0.1 seulement (EN_LOCAL, pour les
 * vérifications automatisées) : c'est par là qu'on compte les pas du moteur.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const K = require('./lib/commun');
const IA = require('./lib/minipixiz-ia');

const JEU = 'minipixiz';
const DOSSIER = path.join(K.SORTIE, JEU);
const GRAINE = 32676;
const CSS = '#aide,#aide-tactile,#sac-but,#pause-but,#menu-pied,#manette{display:none !important}';
const TOUCHES = [['ArrowLeft', 1], ['ArrowRight', 2], ['ArrowDown', 4], ['ArrowUp', 8]];

function planifier() {
  const r = IA.jouer(GRAINE, { pasMax: 60 * 300 });
  return { graine: GRAINE, score: r.score, multi: r.multi, pas: r.pas, fini: r.fini, verif: r.verif,
    bits: r.bits.map((b) => b.toString(16)).join(''), evenements: r.evenements, scores: r.scores };
}

// Les plans : les deux plus belles cascades (écartées d'au moins 25 s), et le départ.
function choisirPlans(plan) {
  const ev = plan.evenements.slice().sort((a, b) => b.chaine - a.chaine || a.pas - b.pas);
  const choix = [];
  for (const e of ev) {
    if (choix.length >= 2) break;
    if (choix.some((c) => Math.abs(c.pas - e.pas) < 60 * 25)) continue;
    choix.push(e);
  }
  const plans = choix.map((e, i) => ({ nom: i === 0 ? 'minipixiz-cascade' : 'minipixiz-chaine', debut: Math.max(0, e.pas - 60 * 8), duree: 60 * 13, chaine: e.chaine, pasEv: e.pas }));
  plans.push({ nom: 'minipixiz-arbre-depart', debut: 0, duree: 60 * 11, depuisMenu: true });
  return plans;
}

async function ouvrirPage(nav) {
  const page = await K.nouvellePage(nav, { css: CSS });
  await page.goto(K.BASE + '/minipixiz/');
  await K.attendre(page, () => !!(window.__client && window.__ouvrirLieu && window.__menu && window.__plateforme), { nom: 'minipixiz', images: 2 });
  return page;
}

// Le point de l'écran où cliquer pour entrer dans l'arbre creux (zone du menu).
async function pointArbre(page) {
  return page.evaluate(() => {
    const m = window.__menu;
    const z = m.zones.find((q) => q.lieu && q.lieu.nom === 'tree');
    const c = document.getElementById('menu-stage');
    const r = c.getBoundingClientRect();
    const k = r.width / 240;
    return { x: r.left + (z.x + z.l / 2) * k, y: r.top + (z.y + z.h * 0.55) * k };
  });
}

// Entre dans l'arbre : graine du plan, survol, clic. Rend quand le lieu existe.
async function entrerDansLArbre(page, graine, filmerPendant) {
  await page.evaluate((g) => {
    window.__plateforme.demanderPartieArbre = () => Promise.resolve({ graine: g });
  }, graine);
  const p = await pointArbre(page);
  const depart = { x: p.x - 260, y: p.y - 140 };
  await page.mouse.move(depart.x, depart.y);
  // La souris glisse vers l'arbre (le décor suit le regard), puis le clic.
  for (let i = 1; i <= 40; i++) {
    const t = i / 40, e = t * t * (3 - 2 * t);
    await page.mouse.move(depart.x + (p.x - depart.x) * e, depart.y + (p.y - depart.y) * e);
    if (filmerPendant) await filmerPendant(); else await K.avancer(page, 1);
  }
  await page.mouse.down();
  await page.mouse.up();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  await page.waitForFunction(() => !!(window.__client.lieu && window.__client.lieu.jeu), null, { timeout: 10000 });
  // Le compteur de pas du moteur (on enveloppe l'update déjà branché par le rejeu).
  await page.evaluate(() => {
    const l = window.__client.lieu;
    const u = l.update;
    window.__pasArbre = 0;
    l.update = function (t) { window.__pasArbre++; return u.call(this, t); };
  });
}

// Pose le clavier tel que le journal le veut pour le pas qui va se jouer.
function clavier(page, bits) {
  const tenues = {};
  return async () => {
    const k = await page.evaluate(() => window.__pasArbre);
    const b = parseInt(bits[k] || '0', 16);
    for (const [touche, m] of TOUCHES) {
      const veut = (b & m) !== 0;
      if (veut !== !!tenues[touche]) {
        if (veut) await page.keyboard.down(touche); else await page.keyboard.up(touche);
        tenues[touche] = veut;
      }
    }
    return k;
  };
}

async function filmerPlan(nav, plan, choix) {
  const page = await ouvrirPage(nav);
  // Le tmod de la page se lisse sur ~300 images : on le laisse converger
  // (546/1024 exactement, celui du plan) avant d'entrer dans l'arbre.
  await K.avancer(page, 420);
  const poser = clavier(page, plan.bits);
  if (choix.depuisMenu) {
    // Le départ : la clairière, la souris qui va à l'arbre, l'iris, les premières pièces.
    const enc = K.encodeur(path.join(DOSSIER, choix.nom + '.mp4'));
    let n = 0;
    const image = async () => { await K.avancer(page, 1); await enc.ecrire(await K.capture(page)); n++; };
    await entrerDansLArbre(page, plan.graine, image);
    while (n < choix.duree) { await poser(); await image(); if (n === 60 * 7) fs.writeFileSync(path.join(DOSSIER, choix.nom + '.png'), await K.capture(page)); }
    await enc.fermer();
    console.log(`  ✔ ${choix.nom}.mp4 — ${n} images`);
  } else {
    await entrerDansLArbre(page, plan.graine);
    /*
     * Jusqu'au début du plan, sans dessiner ni filmer. Ici, et ici seulement,
     * les commandes du journal sont posées directement dans l'état des touches
     * du client (`entree`, celui que les écouteurs du clavier remplissent) :
     * ce passage n'est pas filmé, et passer par le clavier à chaque image
     * coûtait un aller-retour au navigateur par pas. Le résultat est le même
     * — c'est ce que fait le rejeu du serveur. La garde des entrées n'est pas
     * touchée : aucun événement n'est fabriqué. Dès que l'on filme, c'est de
     * nouveau le vrai clavier (Playwright).
     */
    await page.evaluate(([bits, jusqua]) => {
      const c = window.__client;
      const d = c.dessiner;
      c.dessiner = () => {};
      for (let garde = 0; garde < 400000 && window.__pasArbre < jusqua; garde++) {
        const b = parseInt(bits[window.__pasArbre] || '0', 16);
        c.entree.gauche = !!(b & 1); c.entree.droite = !!(b & 2); c.entree.bas = !!(b & 4); c.entree.tourner = !!(b & 8);
        window.__horloge.avancer(1000 / 60);
      }
      c.entree.gauche = c.entree.droite = c.entree.bas = c.entree.tourner = false;
      c.dessiner = d;
    }, [plan.bits, choix.debut]);
    const scoreDebut = await page.evaluate(() => window.__client.lieu.score);
    let meilleure = { i: Math.round(choix.duree * 0.65), v: -1 };
    await K.filmer(page, path.join(DOSSIER, choix.nom + '.mp4'), choix.duree, {
      avant: async () => { await poser(); },
      apres: async (i) => {
        // L'affiche : l'image où la cascade en cours a le plus de maillons.
        const v = await page.evaluate(() => { const j = window.__client.lieu.jeu; return j.fs && j.fs.list ? j.fs.list.length * 100 + (j.dList ? j.dList.length : 0) : 0; });
        if (v > meilleure.v) meilleure = { i, v };
      },
    });
    const kFin = await page.evaluate(() => window.__pasArbre);
    const scoreFin = await page.evaluate(() => window.__client.lieu.score);
    const attendu = plan.scores[Math.floor(kFin / 60)];
    console.log(`    pas ${choix.debut} → ${kFin}, score ${scoreDebut} → ${scoreFin} (plan au pas ${Math.floor(kFin / 60) * 60} : ${attendu})`);
    K.image(path.join(DOSSIER, choix.nom + '.mp4'), (meilleure.i + 4) / 60, path.join(DOSSIER, choix.nom + '.png'));
  }
  await page.close();
}

// L'écran-titre de la page, puis l'iris qui ouvre sur la clairière.
async function filmerTitre(nav) {
  const page = await K.nouvellePage(nav, { css: CSS });
  await page.goto(K.BASE + '/minipixiz/');
  await K.attendre(page, () => !!document.getElementById('stage'), { nom: 'minipixiz', images: 0 });
  await K.filmer(page, path.join(DOSSIER, 'minipixiz-titre.mp4'), 60 * 6, { affiche: 60 * 2, fichierAffiche: path.join(DOSSIER, 'minipixiz-titre.png') });
  await page.close();
}

async function principal() {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const fPlan = path.join(DOSSIER, 'plan.json');
  let plan;
  if (fs.existsSync(fPlan) && !process.argv.includes('--replan')) plan = JSON.parse(fs.readFileSync(fPlan, 'utf8'));
  else {
    console.log('MiniPixiz : l\'IA joue la partie du plan…');
    plan = planifier();
    fs.writeFileSync(fPlan, JSON.stringify(plan) + '\n');
  }
  console.log(`MiniPixiz : plan de ${plan.pas} pas, ${plan.score} points (rejeu serveur : ${plan.verif.score})`);
  const choix = choisirPlans(plan);
  for (const c of choix) console.log(`  ${c.nom} : pas ${c.debut}–${c.debut + c.duree}` + (c.chaine ? ` (cascade de ${c.chaine} maillons au pas ${c.pasEv})` : ''));
  if (process.argv.includes('--plan-seul')) return;
  const seuls = process.argv.filter((a) => a.startsWith('--seul=')).map((a) => a.slice(7));
  const veut = (nom) => !seuls.length || seuls.some((s) => nom.includes(s));
  await K.serveur();
  const nav = await K.navigateur();
  try {
    if (veut('minipixiz-titre')) await filmerTitre(nav);
    for (const c of choix) if (veut(c.nom)) await filmerPlan(nav, plan, c);
    if (veut('jaquette')) await K.jaquette(nav, JEU, 'disc_jaquette_minipixiz.svg', 'minipixiz-jaquette.png');
  } finally {
    await nav.close();
  }
  const c0 = choix[0] || {}, c1 = choix[1] || {};
  K.finirJeu(JEU, {
    videos: {
      'minipixiz-titre': { titre: 'MiniPixiz — écran titre', description: 'L\'écran-titre du jeu, puis l\'iris qui ouvre sur la clairière (le menu : l\'arbre creux, le moulin, le donjon, la forêt…).', usage: 'Carton d\'ouverture du segment MiniPixiz.' },
      'minipixiz-arbre-depart': { titre: 'MiniPixiz — entrer dans l\'arbre creux', description: 'Dans la clairière, la souris glisse jusqu\'à l\'arbre creux et clique ; l\'iris ouvre sur le puzzle et les premières pièces tombent.', usage: 'Transition menu → jeu, présentation.' },
      'minipixiz-cascade': { titre: `MiniPixiz — cascade de ${c0.chaine || '?'} maillons`, description: `Arbre creux joué par l'IA de la capture (graine ${GRAINE}) : les pièces se posent, puis une réaction en chaîne de ${c0.chaine || '?'} maillons — chaque maillon vaut plus que le précédent.`, usage: 'Le moment « combo » du segment MiniPixiz.' },
      'minipixiz-chaine': { titre: `MiniPixiz — réaction en chaîne (${c1.chaine || '?'} maillons)`, description: `Plus loin dans la même partie : pièces plus rapides, couleurs en plus, et une cascade de ${c1.chaine || '?'} maillons.`, usage: 'Second plan de jeu, rythme.' },
    },
    images: {
      'minipixiz-jaquette.png': { titre: 'MiniPixiz — jaquette du disque', description: 'La jaquette du disque MiniPixiz du bureau Frutiz (disc_jaquette_minipixiz), PNG transparent, 1080 px de haut.', usage: 'Incrustation, carton de fin du segment.' },
    },
    sons: [],
  });
}

module.exports = { principal, planifier, choisirPlans };
if (require.main === module) principal().catch((e) => { console.error(e); process.exit(1); });
