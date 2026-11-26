#!/usr/bin/env node
/*
 * Kit bande-annonce — Swapou (public/swapou/), section « jeux-a ».
 *
 *   node scripts/kit-bande-annonce/jeux-a/swapou.js            # tout
 *   node scripts/kit-bande-annonce/jeux-a/swapou.js --replan   # rejoue aussi la partie de l'IA
 *
 * Sortie : /home/user/Frutiparc/kit-bande-annonce/jeux-a/swapou/
 *
 * COMMENT LA PARTIE EST JOUÉE
 *
 * 1. Le PLAN (Node, hors navigateur) : le vrai client (engine/game/screens)
 *    tourne dans un bac à sable vm, comme le fait public/swapou/bot.run.js,
 *    et l'IA du jeu (analyse.js, celle qui conseille les joueurs) joue une
 *    partie de Challenge sur une graine fixée, avec Monsieur Sel. Le jeu est
 *    pompé à 60 images par seconde, au tmod réel (40/60), et l'IA « réfléchit »
 *    un temps humain entre deux coups : on relève, coup par coup, l'image où
 *    le plateau rend la main, l'image du clic, le gain (pièces, phases, score).
 *    Le plan est gardé dans swapou/plan.json (régénération à l'identique).
 *
 * 2. La CAPTURE (Chromium, page /swapou/ du site) : la partie de Challenge
 *    est ouverte sur la MÊME graine. Une partie de Swapou ne dépend que de la
 *    graine et de la suite des coups (c'est ce que vérifie le rejeu du
 *    serveur, swapouRejeu.js) : les coups du plan, rejoués, redonnent la même
 *    partie au fruit près. On avance sans filmer jusqu'au début du plan
 *    choisi, puis chaque image : la souris (de vrais événements, par
 *    Playwright) glisse vers la paire et clique, l'horloge avance d'1/60 s,
 *    capture. Le sélecteur suit donc la souris comme pour un joueur.
 *
 * Les plans sont choisis sur les statistiques du plan : la plus grosse
 * cascade, le pouvoir de Monsieur Sel (Moïse), et la fin de partie sous la
 * glace.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const K = require('./lib/commun');

const JEU = 'swapou';
const DOSSIER = path.join(K.SORTIE, JEU);
const SRC = path.join(K.RACINE, 'public/swapou');
const CHAR = 2;                 // Monsieur Sel : le pouvoir Moïse, qui retaille le plateau
const GRAINE = 20261126;
const TOURS_MAX = 140;
const GLISSE = 12;              // images pendant lesquelles la souris rejoint sa cible

// Le temps de « réflexion » avant le coup n (en images à 60 i/s) : entre 0,3
// et 0,6 s, variable mais reproductible — un joueur vif, pas une machine.
function attenteAvant(n) { return 18 + ((n * 37 + 11) % 19); }

// ─── 1. Le plan ────────────────────────────────────────────────────────────

function planifier() {
  // Le bac à sable, comme bot.run.js ; son Math.random est seedé (il ne sert
  // qu'aux effets : la partie, elle, tire tout de sa graine).
  let rng = 12345;
  const M = {};
  for (const k of Object.getOwnPropertyNames(Math)) M[k] = Math[k];
  M.random = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
  let horloge = 0;
  const sandbox = { console, setTimeout, URLSearchParams, performance: { now: () => horloge }, Date, Math: M, JSON };
  sandbox.self = sandbox; sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js', 'bot.js', 'analyse.js'])
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
  const SW = sandbox.SW, E = sandbox.SwapouEngine, Bot = sandbox.SwapouBot, Analyse = sandbox.SwapouAnalyse;
  const Manager = SW.Manager;
  Manager.init('');
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Data.players = [CHAR, -1];
  Manager.client.partie = { id: 'kit', graine: GRAINE };
  if (Manager.mode) Manager.mode.destroy();
  Manager.mode = new SW.Challenge();
  const chal = Manager.mode;

  const TMOD = 40 / 60, DT = 1 / 60;
  const coups = [];
  let image = 0, depuis = null, n = 0;
  const hauteur = () => Math.max.apply(null, Bot.heights(Bot.copyGrid(chal.player.level)));
  const t0 = Date.now();
  while (Manager.mode === chal && n < TOURS_MAX && image < 400000) {
    if (!chal.lock && !chal.pause.activated()) {
      if (depuis === null) depuis = image;
      if (image - depuis >= attenteAvant(n)) {
        const etat = { charId: CHAR, canDefend: chal.player.canDefend() && chal.interf.pl[0].power >= E.DEFENSE_STARS[CHAR],
          stars: chal.player.star_counter, ncoups: chal.ncoups, depth2: true, samples: 3, topK: 8 };
        const mv = Analyse.choisir(chal.player.level, etat, { budgetMs: 700 });
        const avant = chal.player.score;
        const h = hauteur();
        if (mv.type === 'none') break;
        if (mv.type === 'defend') chal.interf.defend();
        else {
          // Le clic, au point exact que la capture visera (cf. pointDeLaPaire).
          const p = pointDeLaPaire(chal.player.animator.getInfos(), mv.pair);
          SW.handleMouseMove(p.x, p.y);
          chal.gameClick();
        }
        if (!chal.lock) { console.warn('  coup refusé au tour ' + n); break; }
        coups.push({ n, type: mv.type, pair: mv.pair || null, deverrou: depuis, clic: image, attente: image - depuis,
          scoreAvant: avant, hauteur: h, etoiles: chal.player.star_counter, nature: mv.nature || null,
          prevu: mv.gained ? { score: mv.gained.score || 0, phases: mv.gained.phases || 0, pieces: mv.gained.pieces || 0 } : null });
        n++;
        depuis = null;
      }
    }
    horloge += 1000 / 60;
    Manager.main(TMOD, DT);
    image++;
    // Le gain réel du coup précédent, une fois le plateau rendu.
    if (!chal.lock && coups.length && coups[coups.length - 1].gain === undefined) {
      const c = coups[coups.length - 1];
      c.gain = chal.player.score - c.scoreAvant;
      c.fin = image;
    }
    if (n % 20 === 0 && depuis === image - 1 && n) process.stdout.write(`  plan : tour ${n}, score ${chal.player.score} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  }
  const plan = { graine: GRAINE, char: CHAR, perso: E.CHAR_NAMES[CHAR].trim(), score: chal.player.score, images: image, coups };
  return plan;
}

// Le point de clic d'une paire, en coordonnées logiques 700×480 : le milieu
// du bord commun des deux cases (bot.run.js, execSwap).
function pointDeLaPaire(info, pair) {
  if (pair.dx === 1) return { x: info.px + pair.x * 35 + 30, y: info.py + pair.y * 35 + 17 };
  return { x: info.px + pair.x * 35 + 17, y: info.py + pair.y * 35 + 30 };
}

// Choisit les plans à filmer : des fenêtres d'IMAGES de la partie du plan.
function choisirPlans(plan) {
  const c = plan.coups;
  const phases = (k) => (k && k.prevu ? k.prevu.phases : 0);
  const plusGrosse = (de, a) => { let m = de; for (let i = de; i < a; i++) if (phases(c[i]) > phases(c[m])) m = i; return m; };
  const plans = [];
  // La plus grosse cascade de la partie : un plan maître (la montée, puis la
  // chaîne entière) et un plan court qui s'arrête au plus fort.
  const i = plusGrosse(3, c.length - 1);
  const debutM = c[Math.max(0, i - 3)].deverrou;
  plans.push({ nom: 'swapou-cascade-maitre', debut: debutM, duree: Math.min((c[i].fin || c[i].clic + 600) + 75 - debutM, 60 * 32) });
  plans.push({ nom: 'swapou-cascade', debut: c[Math.max(0, i - 2)].deverrou, duree: 60 * 14 });
  // Le pouvoir de Monsieur Sel : la fin de la chaîne d'avant, Moïse, et la reprise.
  const d = c.findIndex((k) => k.type === 'defend');
  if (d >= 0) plans.push({ nom: 'swapou-pouvoir', debut: c[d].deverrou - 75, duree: 60 * 14 });
  // La fin de partie, sous la glace : la plus grosse chaîne après le 90e coup.
  const j = plusGrosse(Math.min(90, c.length - 2), d > 0 ? d : c.length - 1);
  plans.push({ nom: 'swapou-fin', debut: c[Math.max(0, j - 1)].deverrou, duree: 60 * 14 });
  return plans;
}

// ─── 2. La capture ─────────────────────────────────────────────────────────

const ECHELLE = 1080 / 480;               // la scène 700×480 à la hauteur de l'écran
const versEcran = (p) => ({ x: 960 + (p.x - 350) * ECHELLE, y: 540 + (p.y - 240) * ECHELLE });

// Ouvre une partie de Challenge sur la graine du plan, la page prête.
async function ouvrirPartie(page, plan) {
  await page.goto(K.BASE + '/swapou/');
  await K.attendre(page, () => !!(window.SW && SW.Manager && SW.Manager.mode && SW.Manager.mode.constructor.name === 'Menu'), { nom: 'menu swapou' });
  await K.avancer(page, 30);
  await page.evaluate(([graine, ch]) => {
    const SW = window.SW, Mg = SW.Manager;
    SW.Data.gameMode = SW.Data.CHALLENGE;
    SW.Data.players = [ch, -1];
    Mg.client.partie = { id: 'kit', graine };
    Mg.mode.destroy();
    Mg.mode = new SW.Challenge();
    window.__kit = { chal: Mg.mode, image: 0, k: 0, depuis: null };
  }, [plan.graine, plan.char]);
}

/*
 * Avance la partie jusqu'à l'image `jusqua` du plan, SANS dessiner ni filmer,
 * au même pas que le plan (Manager.main au tmod 40/60, une fois par image) et
 * avec la même règle de jeu (le coup part `attente` images après que le
 * plateau a rendu la main) : on arrive à l'image voulue dans l'état exact du
 * plan, même au milieu d'une cascade.
 */
async function avancerSansFilmer(page, plan, jusqua) {
  const coups = plan.coups.map((k) => ({ type: k.type, pair: k.pair, attente: k.attente }));
  await page.evaluate(([coups, jusqua]) => {
    const SW = window.SW, Mg = SW.Manager, kit = window.__kit, chal = kit.chal;
    const pdp = (info, pair) => pair.dx === 1 ? { x: info.px + pair.x * 35 + 30, y: info.py + pair.y * 35 + 17 } : { x: info.px + pair.x * 35 + 17, y: info.py + pair.y * 35 + 30 };
    while (kit.image < jusqua) {
      if (!chal.lock && !chal.pause.activated() && kit.k < coups.length) {
        if (kit.depuis === null) kit.depuis = kit.image;
        const c = coups[kit.k];
        if (kit.image - kit.depuis >= c.attente) {
          if (c.type === 'defend') chal.interf.defend();
          else { const p = pdp(chal.player.animator.getInfos(), c.pair); SW.handleMouseMove(p.x, p.y); chal.gameClick(); }
          kit.k++; kit.depuis = null;
        }
      } else if (chal.lock) kit.depuis = null;
      Mg.main(40 / 60, 1 / 60);
      kit.image++;
    }
    // Le score affiché rattrape le score réel (il défile, sinon, depuis zéro).
    chal.interf.viewScore = chal.interf.score;
  }, [coups, jusqua]);
}

async function filmerPlan(nav, plan, choix) {
  const page = await K.nouvellePage(nav, {});
  await ouvrirPartie(page, plan);
  await avancerSansFilmer(page, plan, choix.debut);
  const info = await page.evaluate(() => window.__kit.chal.player.animator.getInfos());
  const iconeDef = await page.evaluate(() => ({ x: window.__kit.chal.interf.defenseIcon.x, y: window.__kit.chal.interf.defenseIcon.y }));
  const kDepart = await page.evaluate(() => window.__kit.k);
  // La souris part du dernier coup joué (ou du centre du plateau).
  const prec = plan.coups[kDepart - 1];
  let souris = prec && prec.pair ? versEcran(pointDeLaPaire(info, prec.pair)) : versEcran({ x: 350, y: 300 });
  await page.mouse.move(souris.x, souris.y);
  let k = kDepart, depuis = await page.evaluate(() => window.__kit.depuis), cible = null, depart = null;
  if (depuis !== null) depuis = depuis - choix.debut;     // en indice d'image du clip
  let meilleure = { i: 0, v: -1 };
  const res = await K.filmer(page, path.join(DOSSIER, choix.nom + '.mp4'), choix.duree, {
    avant: async (i) => {
      if (k >= plan.coups.length) return;
      const libre = await page.evaluate(() => { const c = window.__kit.chal; return !c.lock && !c.pause.activated(); });
      if (!libre) { depuis = null; return; }
      if (depuis === null) depuis = i;
      const c = plan.coups[k];
      if (!cible) {
        cible = versEcran(c.type === 'defend' ? iconeDef : pointDeLaPaire(info, c.pair));
        depart = souris;
      }
      const ecoule = i - depuis;
      // La souris glisse vers la cible pendant les GLISSE dernières images (douce, en S).
      const g = Math.max(0, Math.min(1, (ecoule - (c.attente - GLISSE)) / GLISSE));
      if (g > 0 && ecoule < c.attente) {
        const e = g * g * (3 - 2 * g);
        souris = { x: depart.x + (cible.x - depart.x) * e, y: depart.y + (cible.y - depart.y) * e };
        await page.mouse.move(souris.x, souris.y);
      }
      if (ecoule >= c.attente) {
        await page.mouse.move(cible.x, cible.y);
        souris = cible;
        await page.mouse.down();
        await page.mouse.up();
        k++;
        depuis = null; cible = null;
      }
    },
    apres: async (i) => {
      // L'affiche : l'image où la chaîne en cours est la plus longue.
      const v = await page.evaluate(() => { const p = window.__kit.chal.player; return (p.combo_number || 0) * 100000 + (p.combo_score || 0); });
      if (v > meilleure.v) meilleure = { i, v };
    },
  });
  const verif = await page.evaluate(() => ({ score: window.__kit.chal.player.score }));
  await page.close();
  console.log(`    coups ${kDepart}–${k - 1}, score à la fin du plan : ${verif.score}`);
  return Object.assign(res, { afficheImage: Math.min(meilleure.i + 30, choix.duree - 1) });
}

// L'affiche d'un clip : l'image `i` extraite du MP4 (ffmpeg, sans perte notable à crf 16).
function afficheDuClip(fichierMp4, i, fichierPng) {
  const { execFileSync } = require('child_process');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', fichierMp4, '-vf', `select=eq(n\\,${i})`, '-frames:v', '1', fichierPng]);
}

// Le titre : la page s'ouvre, l'écran de chargement, puis le menu qui s'anime.
async function filmerTitre(nav) {
  const page = await K.nouvellePage(nav, {});
  await page.goto(K.BASE + '/swapou/');
  await K.attendre(page, () => !!(window.SW && SW.Manager && SW.Manager.mode && SW.Manager.mode.constructor.name === 'Menu'), { nom: 'menu swapou', images: 0 });
  const r = await K.filmer(page, path.join(DOSSIER, 'swapou-titre.mp4'), 60 * 5, { affiche: 60 * 4, fichierAffiche: path.join(DOSSIER, 'swapou-titre.png') });
  await page.close();
  return r;
}

// ─── Tout ──────────────────────────────────────────────────────────────────

async function principal() {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const fPlan = path.join(DOSSIER, 'plan.json');
  let plan;
  if (fs.existsSync(fPlan) && !process.argv.includes('--replan')) plan = JSON.parse(fs.readFileSync(fPlan, 'utf8'));
  else {
    console.log('Swapou : l\'IA joue la partie du plan…');
    plan = planifier();
    fs.writeFileSync(fPlan, JSON.stringify(plan) + '\n');
  }
  console.log(`Swapou : plan de ${plan.coups.length} coups, ${plan.score} points (${plan.perso}, graine ${plan.graine})`);
  const choix = choisirPlans(plan);
  for (const c of choix) console.log(`  ${c.nom} : images ${c.debut}–${c.debut + c.duree} (${(c.duree / 60).toFixed(1)} s)`);
  if (process.argv.includes('--plan-seul')) return;

  await K.serveur();
  const nav = await K.navigateur();
  try {
    const seuls = process.argv.filter((a) => a.startsWith('--seul=')).map((a) => a.slice(7));
    const veut = (nom) => !seuls.length || seuls.some((s) => nom.includes(s));
    if (veut('swapou-titre')) await filmerTitre(nav);
    for (const c of choix) {
      if (!veut(c.nom)) continue;
      const r = await filmerPlan(nav, plan, c);
      afficheDuClip(r.fichier, r.afficheImage, path.join(DOSSIER, c.nom + '.png'));
    }
    if (veut('jaquette')) await K.jaquette(nav, JEU, 'disc_jaquette_swapou2.svg', 'swapou-jaquette.png');
  } finally {
    await nav.close();
  }
  K.finirJeu(JEU, {
    videos: {
      'swapou-titre': { titre: 'Swapou — écran titre', description: 'L\'ouverture du jeu : Natacha et Monsieur Sel, le logo « Swapou, les légumes attaquent ! », puis le menu qui s\'installe.', usage: 'Carton d\'ouverture du segment Swapou, ou plan de coupe.' },
      'swapou-cascade-maitre': { titre: 'Swapou — la grande cascade (plan maître)', description: `Partie de Challenge jouée par l'IA du jeu (${plan.perso}, graine ${plan.graine}) : le plateau monte jusqu'au plafond à coups de préparations, puis un seul échange déclenche une chaîne de 26 phases (137 fruits, +5 395 points) qui vide le plateau.`, usage: 'Plan maître à découper : la tension de la montée, puis le compteur de chaîne qui s\'emballe.' },
      'swapou-cascade': { titre: 'Swapou — la grande cascade', description: 'Les trois derniers coups de la montée (le plateau touche le plafond) et le départ de la chaîne : le compteur dans l\'étoile passe de 1 à 15.', usage: 'Le moment « combo » du segment Swapou.' },
      'swapou-pouvoir': { titre: 'Swapou — le pouvoir Moïse', description: 'Fin d\'une chaîne, puis Monsieur Sel dépense ses étoiles : le pouvoir Moïse fend le plateau, les colonnes du bord tombent, et l\'IA reconstruit aussitôt.', usage: 'Effet spécial : montrer qu\'il y a plus qu\'un jeu d\'échange.' },
      'swapou-fin': { titre: 'Swapou — fin de partie sous la glace', description: 'Après 95 coups : fruits gelés et métalliques, plateau au plafond, et l\'IA qui relance une chaîne de 18 phases pour respirer.', usage: 'Tension / « ça va vite », avant la chute.' },
    },
    images: {
      'swapou-jaquette.png': { titre: 'Swapou — jaquette du disque', description: 'La jaquette du disque Swapou du bureau Frutiz (sprite vectoriel disc_jaquette_swapou2), rendue en PNG transparent, 1080 px de haut.', usage: 'Incrustation : le disque qu\'on glisse dans la Frusion, carton de fin du segment.' },
    },
    sons: [
      { source: 'public/swapou/sounds/sound_game.mp3', nom: 'swapou-musique-challenge', titre: 'Swapou — musique de partie', description: 'La boucle musicale des parties (Challenge et Duel)', usage: 'Fond musical du segment Swapou (boucle de 11,8 s).', boucle: true },
      { source: 'public/swapou/sounds/sound_menu.mp3', nom: 'swapou-musique-menu', titre: 'Swapou — musique du menu', description: 'La boucle du menu', usage: 'Sous l\'écran titre.', boucle: true },
      { source: 'public/swapou/sounds/sound_combo.mp3', nom: 'swapou-combo', titre: 'Swapou — combo', description: 'Le son d\'une chaîne', usage: 'Sur le compteur de chaîne qui monte.' },
      { source: 'public/swapou/sounds/sound_pop1.mp3', nom: 'swapou-pop1', titre: 'Swapou — explosion de fruit (1)', description: 'Un fruit qui éclate', usage: 'À répéter sur les explosions de la cascade.' },
      { source: 'public/swapou/sounds/sound_pop2.mp3', nom: 'swapou-pop2', titre: 'Swapou — explosion de fruit (2)', description: 'Un fruit qui éclate, variante', usage: 'En alternance avec pop1.' },
      { source: 'public/swapou/sounds/sound_swap.mp3', nom: 'swapou-echange', titre: 'Swapou — échange', description: 'Deux fruits échangés', usage: 'Sur chaque clic des plans de jeu.' },
      { source: 'public/swapou/sounds/sound_show_score.mp3', nom: 'swapou-score', titre: 'Swapou — score', description: 'L\'affichage du score de fin', usage: 'Sur un carton de score.' },
    ],
  });
}

module.exports = { planifier, choisirPlans, principal };
if (require.main === module) principal().catch((e) => { console.error(e); process.exit(1); });
