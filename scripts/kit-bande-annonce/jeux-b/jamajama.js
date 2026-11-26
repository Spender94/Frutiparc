#!/usr/bin/env node
/*
 * Kit bande-annonce, section jeux-b — JAMAJAMA (public/jamajama/).
 *
 *   node scripts/kit-bande-annonce/jeux-b/jamajama.js [menu] [niveaux] [extras]
 *
 * Produit dans kit-bande-annonce/jeux-b/jamajama/ :
 *   · menu.mp4 — l'écran-titre (le logo, les rubriques qui gonflent au survol) ;
 *   · niveau-<n>.mp4 — des niveaux de l'Aventure RÉSOLUS : Tiki y joue la
 *     solution la plus courte trouvée par jamajama-solveur.js (le moteur de
 *     règles du site, vérifiée par son propre rejeu anti-triche), touche par
 *     touche, au clavier de Playwright, dans la vraie page — du lever de
 *     rideau à l'iris de victoire ;
 *   · niveau-<n>-gros-plan.mp4 — la même partie, cadrée serré sur le plateau ;
 *   · les affiches, la jaquette, la musique et les bruitages d'origine
 *     (Games/poulpi/sound/).
 *
 * Le compte filmé est un personnage fictif du casting ; sa sauvegarde
 * d'Aventure est posée (par la route du jeu, /api/jamajama/aventure) comme
 * celle d'un joueur qui a fini les niveaux précédents, pour que le parchemin
 * ouvre le niveau voulu. Le parcours des menus se fait à la souris.
 *
 * Le canevas se peint à une échelle ENTIÈRE (echelleDuCanevas, jeu.js). Pour
 * les niveaux, la page (1920×1080) est rendue à deviceScaleFactor 2 : la
 * scène de 384 est peinte à l'échelle 6 (2304 px) ; le plan large est réduit
 * à 1080 de haut par ffmpeg, le gros plan est recadré dans l'image pleine
 * définition — net dans les deux cas, jamais agrandi.
 *
 * JAMA_CLIPS=n (3 par défaut) : nombre de niveaux filmés ;
 * JAMA_NIVEAUX=louki,aimants : seulement ces niveaux (noms de NIVEAUX).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./commun');
const S = require('./jamajama-solveur');

const JEU = 'jamajama';
const DOSSIER = path.join(C.SORTIE, JEU);
// La page du jeu, mise en scène : le fond du site autour du canevas carré.
const CSS = 'html,body{background:' + C.VERT_SITE + '!important}#jama-manette{display:none!important}';

// Les niveaux filmés : un titre (motif), et ce qu'il montre.
const NIVEAUX = [
  { motif: /^Grotte 10 :/, nom: 'bobombe', titre: 'la BoBombe', desc: 'Tiki pousse la BoBombe contre le mur : le compte à rebours, la déflagration, le mur pulvérisé, puis la sortie.' },
  { motif: /^Grotte 12 :/, nom: 'louki', titre: 'Louki le goinfre', desc: 'Tiki laisse son corps et passe en esprit (le fantôme de Tiki) pour posséder Louki, qui avale les obstacles, puis rejoint la sortie.' },
  { motif: /^Grotte 15 :/, nom: 'aimants', titre: 'la puissance magnétique', desc: 'Les aimants attirent Tiki et les blocs à travers le plateau ; vingt et un pas jusqu\'à la sortie.' },
  { motif: /^Grotte 11 :/, nom: 'electrificator', titre: 'Tiki contre l\'Electrificator', desc: 'Tiki se faufile hors de la ligne de tir de l\'archer électrique et gagne la sortie.' },
  { motif: /^Grotte 9 :/, nom: 'pont', titre: 'le pont', desc: 'Les caisses tombent à l\'eau et font un pont : Tiki traverse le lac.' },
];

// ── Crochets d'observation (aucun effet sur le jeu) ──
// La vue de la partie en cours, pour savoir quand Tiki a fini son geste (la
// boucle n'accepte une entrée que quand tout est retombé : vue.libre()).
function installerCrochets() {
  const V = window.JamaVue.VueJeu.prototype;
  const maj = V.update;
  V.update = function (t) { window.__vue = this; return maj.call(this, t); };
}

async function versEcran(page, x, y) {
  const r = await page.evaluate(() => { const b = document.getElementById('jama').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width }; });
  return { x: r.l + x * r.w / 384, y: r.t + y * r.w / 384 };
}
async function cliquer(page, x, y, attenteAvant) {
  const p = await versEcran(page, x, y);
  await page.mouse.move(p.x, p.y);
  await C.avancer(page, attenteAvant || 12);
  await page.mouse.down();
  await C.avancer(page, 1);
  await page.mouse.up();
  await C.avancer(page, 4);
}

async function ouvrirJeu(nav, sid, echelle) {
  const page = await C.nouvellePage(nav, { css: CSS, graine: 1702, largeur: 1920, hauteur: 1080, echelle: echelle || 1 });
  await page.goto(C.BASE + '/jamajama/?sid=' + sid);
  await C.patienter(page, () => !!(window.JamaVue && window.JamaEcrans && document.getElementById('jama')));
  await page.evaluate(installerCrochets);
  // Le menu est dessiné quand le logo est chargé : on laisse tourner un peu.
  await C.avancer(page, 30);
  return page;
}

/** Ouvre le niveau `index` du pack `pack` par les menus (souris). */
async function allerAuNiveau(page, pack, index) {
  await page.mouse.move(5, 5);
  await cliquer(page, 192, 210);                 // « aventure »
  await C.avancer(page, 10);
  await cliquer(page, 192, 50 + pack * 60);      // le pack
  await C.avancer(page, 10);
  // Le parchemin vient de la bibliothèque du jeu : attendre qu'elle connaisse
  // son symbole (sous forte charge, il arrivait après le clic).
  await C.patienter(page, () => { try { window.JamaEcrans.cadreEnfant('jama_gui_AdventureSelect', 1, 'next'); return true; } catch (e) { return false; } }, null, 60000);
  const zones = await page.evaluate(() => {
    const E = window.JamaEcrans;
    return { next: E.cadreEnfant('jama_gui_AdventureSelect', 1, 'next'), play: E.cadreEnfant('jama_gui_AdventureSelect', 1, 'btnPlay') };
  });
  const centre = (z) => [192 + z.x + z.w / 2, 192 + z.y + z.h / 2];
  for (let i = 0; i < index; i++) { const [x, y] = centre(zones.next); await cliquer(page, x, y, 3); }
  await C.avancer(page, 20);
  return centre(zones.play);
}

const FLECHES = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];

/**
 * Lance le niveau (clic sur « jouer ») et joue la solution en filmant, du
 * clic jusqu'au retour au parchemin après la victoire.
 *
 * La page est rendue à deviceScaleFactor 2 (capture 3840×2160) : la sortie
 * « plan large » est réduite à 1920×1080 par ffmpeg ; la sortie « gros
 * plan » (`zoom`) ne prend, pendant la partie seulement, qu'un cadre 16:9
 * autour du plateau — assez de pixels pour qu'il reste net.
 */
async function filmerNiveau(page, boutonJouer, coups, enc, ouvrirZoom) {
  const marche = [];
  let zoom = null;
  const filmer = async (n) => {
    for (let i = 0; i < n; i++) {
      await C.avancer(page, 1);
      const png = await C.capturer(page);
      await enc.ecrire(png);
      if (zoom) await zoom.ecrire(png);
    }
  };
  await filmer(20);
  const p = await versEcran(page, boutonJouer[0], boutonJouer[1]);
  await page.mouse.move(p.x, p.y);
  await filmer(12);
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.move(1919, 1079);
  // Le lever de rideau (l'iris d'ouverture) : le gros plan démarre dès que
  // la vue du niveau existe ; on attend ensuite que Tiki soit libre.
  let attente = 0;
  for (;;) {
    await filmer(1);
    if (!zoom) {
      const cadre = await page.evaluate(() => {
        const v = window.__vue;
        if (!v || !document.getElementById('jama')) return null;
        const r = document.getElementById('jama').getBoundingClientRect();
        const k = r.width / 384;
        return { x: r.left + v.padX * k, y: r.top + v.padY * k, w: v.dim.width * 32 * k, h: v.dim.height * 32 * k, cl: r.left, ct: r.top, cw: r.width, ch: r.height };
      });
      if (cadre) zoom = ouvrirZoom(cadre);
    }
    const ok = await page.evaluate(() => !!(window.__vue && window.__vue.libre()));
    if (ok && ++attente > 18) break;
  }
  for (const c of coups) {
    const touche = c === 4 || c === 5 ? 'Space' : FLECHES[c];
    await page.keyboard.down(touche);
    await filmer(2);
    await page.keyboard.up(touche);
    marche.push(enc.images);
    let libres = 0;
    for (let garde = 0; garde < 600; garde++) {
      await filmer(1);
      const ok = await page.evaluate(() => !!(window.__vue && window.__vue.libre()));
      if (ok) { if (++libres >= (c >= 4 ? 8 : 3)) break; } else libres = 0;
    }
  }
  // La victoire : l'iris se referme.
  for (let garde = 0; garde < 60 * 6; garde++) {
    await filmer(1);
    const fini = await page.evaluate(() => !window.__vue || !document.getElementById('jama') || (window.__vue.partie.isEnded() && window.__vue.libre()));
    if (fini) break;
  }
  await filmer(30);
  const zoomFini = zoom;
  zoom = null;                          // le gros plan s'arrête avec la partie
  await filmer(60);                     // le plan large garde le retour au parchemin
  return { marche, zoom: zoomFini };
}

async function genererMenu(nav, sid, elements) {
  console.log('  menu…');
  const page = await ouvrirJeu(nav, sid);
  const f = path.join(DOSSIER, 'menu.mp4');
  const enc = new C.Encodeur(f);
  // Le survol fait gonfler les rubriques (rebond à 130, 110, 140 %).
  const parcours = { 40: 180, 95: 210, 150: 240, 205: 300, 260: 210 };
  for (let i = 0; i < 300; i++) {
    if (parcours[i]) { const p = await versEcran(page, 192, parcours[i]); await page.mouse.move(p.x, p.y, { steps: 1 }); }
    await C.avancer(page, 1);
    await enc.ecrire(await C.capturer(page));
  }
  await enc.fermer();
  await page.close();
  elements.push(C.elementVideo(JEU, f, {
    titre: 'JamaJama — écran-titre',
    description: 'Le menu de JamaJama : le logo, la frise de Tiki et de ses amis, les rubriques (tournoi, aventure, édition, statistiques, aide, options) qui gonflent au passage de la souris.',
    usage: 'Ouverture du segment JamaJama.',
    affiche: C.affiche(f, path.join(DOSSIER, 'menu.png'), 4.6),
  }));
}

async function genererNiveaux(nav, sid, elements) {
  const tous = S.niveaux();
  const maxClips = Number(process.env.JAMA_CLIPS || 3);
  let faits = 0;
  for (const cible of NIVEAUX) {
    if (faits >= maxClips) break;
    // JAMA_NIVEAUX=louki,aimants : ne refaire que ces niveaux-là.
    if (process.env.JAMA_NIVEAUX && !process.env.JAMA_NIVEAUX.split(',').includes(cible.nom)) continue;
    const n = tous.find((x) => x.section === 'aventure' && cible.motif.test(x.titre));
    if (!n) { console.warn('  niveau introuvable :', cible.motif); continue; }
    console.log(`  niveau « ${n.titre} » : recherche de la solution…`);
    const coups = S.resoudre(n.contenu, { maxEtats: 150000 });
    if (!coups) { console.warn('    pas de solution trouvée, niveau suivant'); continue; }
    console.log(`    ${coups.length} coups : ${coups.join('')}`);
    // La sauvegarde d'un joueur qui a fini tout ce qui précède ce niveau.
    let dt = '';
    for (let p = 0; p <= n.pack; p++) {
      const finis = tous.filter((x) => x.section === 'aventure' && x.pack === p && (p < n.pack || x.index < n.index)).map((x) => x.index);
      if (finis.length) dt += p + '[' + finis.join(',') + ';';
    }
    await C.posterJson('/api/jamajama/aventure', { sid, dt });
    const page = await ouvrirJeu(nav, sid, 2);
    const bouton = await allerAuNiveau(page, n.pack, n.index);
    const f = path.join(DOSSIER, `niveau-${cible.nom}.mp4`);
    const fz = path.join(DOSSIER, `niveau-${cible.nom}-gros-plan.mp4`);
    const enc = new C.Encodeur(f, { filtre: 'scale=1920:1080:flags=lanczos' });
    let debutZoom = 0;
    const ouvrirZoom = (b) => {
      // Un cadre 16:9 autour du plateau (marge d'une demi-case), en pixels
      // physiques (×2), borné à l'image.
      const marge = 0.35 * b.h / 7;
      let h = b.h + 2 * marge, w = h * 16 / 9;
      if (w < b.w + 2 * marge) { w = b.w + 2 * marge; h = w * 9 / 16; }
      // On reste dans le canevas (pas de marge verte) : le bord du plateau peut
      // être un peu rogné en haut et en bas.
      if (w > b.cw) { w = b.cw; h = w * 9 / 16; }
      const x = Math.max(b.cl, Math.min(b.cl + b.cw - w, b.x + b.w / 2 - w / 2));
      const y = Math.max(b.ct, Math.min(b.ct + b.ch - h, b.y + b.h / 2 - h / 2));
      const pair = (v) => 2 * Math.round(v);
      debutZoom = enc.images;
      return new C.Encodeur(fz, { filtre: `crop=${pair(w)}:${pair(h)}:${pair(x)}:${pair(y)},scale=1920:1080:flags=lanczos` });
    };
    const { marche, zoom } = await filmerNiveau(page, bouton, coups, enc, ouvrirZoom);
    await enc.fermer();
    if (zoom) await zoom.fermer();
    await page.close();
    const info = C.sonde(f);
    // L'affiche : au tiers de la résolution, Tiki en action.
    const tAff = marche.length ? marche[Math.floor(marche.length * 0.35)] / 60 + 0.2 : info.duree / 2;
    elements.push(C.elementVideo(JEU, f, {
      titre: `JamaJama — ${cible.titre} (niveau résolu)`,
      description: `« ${n.titre} » (Aventure, pack ${n.pack + 1}, niveau ${n.index + 1}), joué d'un bout à l'autre sans faute en ${coups.length} coups : ${cible.desc} Du choix du niveau sur le parchemin jusqu'à l'iris de victoire.`,
      usage: 'Plan « casse-tête résolu » ; couper dans la résolution pour un plan court, ou garder la victoire.',
      affiche: C.affiche(f, path.join(DOSSIER, `niveau-${cible.nom}.png`), tAff),
      coups: coups.length,
    }));
    if (zoom) {
      elements.push(C.elementVideo(JEU, fz, {
        titre: `JamaJama — ${cible.titre} (gros plan sur le plateau)`,
        description: `Le même niveau résolu, « ${n.titre} », cadré serré sur le plateau (rendu à double définition puis recadré : net), de l'ouverture du niveau à la victoire.`,
        usage: 'Plan de détail : les personnages et les pièges en grand.',
        affiche: C.affiche(fz, path.join(DOSSIER, `niveau-${cible.nom}-gros-plan.png`), Math.max(0, tAff - debutZoom / 60)),
        coups: coups.length,
      }));
    }
    faits++;
  }
}

async function genererExtras(nav, elements) {
  const j = await C.jaquettePng(nav, 'public/frutiz/sprites/disc_jaquette_jama.svg', path.join(DOSSIER, 'jaquette.png'), 1200);
  elements.push({ fichier: path.relative(C.SORTIE, j.fichier), jeu: JEU, type: 'image', titre: 'JamaJama — jaquette du disque',
    description: 'La jaquette du disque JamaJama (disc_jaquette_jama.svg du bureau Frutiz), rendue en PNG transparent.',
    usage: 'Carton de présentation du jeu.', largeur: j.largeur, hauteur: j.hauteur, alpha: true });
  const sons = [
    ['Games/poulpi/sound/worldOfChip-loop30s.wav', 'musique-boucle.wav', 'JamaJama — musique (boucle de 30 s)', 'La boucle musicale du jeu d\'origine.'],
    ['Games/poulpi/sound/worldOfChip-intro5s.wav', 'musique-intro.wav', 'JamaJama — introduction musicale (5 s)', 'L\'introduction de la musique, avant la boucle.'],
    ['Games/poulpi/sound/yahou.wav', 'yahou.wav', 'JamaJama — « Yahou ! »', 'Le cri de victoire de Tiki.'],
    ['Games/poulpi/sound/glassbreak.wav', 'explosion.wav', 'JamaJama — bris (BoBombe, murs)', 'Le fracas d\'un mur ou d\'une caisse détruits.'],
    ['Games/poulpi/sound/plouf1Grave.wav', 'plouf.wav', 'JamaJama — plouf', 'Une caisse ou un fruit qui tombe à l\'eau.'],
    ['Games/poulpi/sound/ohno!.wav', 'oh-non.wav', 'JamaJama — « Oh non ! »', 'Le cri de Tiki quand il perd.'],
    ['Games/poulpi/sound/ding.wav', 'ding.wav', 'JamaJama — ding', 'Le ding (fruits, sortie qui s\'ouvre).'],
  ];
  for (const [src, nom, titre, desc] of sons) {
    if (!fs.existsSync(path.join(C.RACINE, src))) { console.warn('  son absent :', src); continue; }
    const f = path.join(DOSSIER, 'sons', nom);
    const duree = C.copierSon(src, f);
    elements.push(C.elementSon(JEU, f, duree, { titre, description: desc + ' Fichier d\'origine (' + src + ').', usage: 'Bande son du segment JamaJama.' }));
  }
}

async function generer(nav, quoi) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const elements = [];
  const tout = !quoi || !quoi.length;
  const sid = await C.compte('citronade');
  if (tout || quoi.includes('menu')) await genererMenu(nav, sid, elements);
  if (tout || quoi.includes('niveaux')) await genererNiveaux(nav, sid, elements);
  if (tout || quoi.includes('extras')) await genererExtras(nav, elements);
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
