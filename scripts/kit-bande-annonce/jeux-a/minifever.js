#!/usr/bin/env node
/*
 * Kit bande-annonce — Mini-Fever (public/minifever/), section « jeux-a ».
 *
 *   node scripts/kit-bande-annonce/jeux-a/minifever.js [--seul=<nom>]
 *
 * Sortie : /home/user/Frutiparc/kit-bande-annonce/jeux-a/minifever/
 *
 * La page /minifever/ du site, à l'horloge virtuelle : la scène 240 × 240 du
 * SWF, tracée à la taille affichée (1080 × 1080, le canevas suit la taille
 * CSS), sur le vert du parc. Le bandeau des modes, sous la scène, est masqué.
 *
 * Le MODE FEVER (les épreuves s'enchaînent, la difficulté monte de dix à
 * chaque fois) est joué par lib/minifever-joueur.js : il lit l'épreuve dans
 * la page et dit où doit être la souris ; la capture bouge la VRAIE souris
 * (Playwright) — la garde des entrées de la page les accepte comme celles
 * d'un joueur, et on ne l'affaiblit en rien. Le tirage des épreuves est
 * remplacé, dans la page, par la liste de celles que le joueur sait gagner.
 *
 * Le socle bat à la cadence du SWF (40 images par seconde) : filmé à 40 i/s
 * dans un intermédiaire, d'où sortent le maître à 60 i/s et une variante
 * native à 40 i/s (lib/commun.js, INTERMEDIAIRE).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const K = require('./lib/commun');
const { installerJoueur } = require('./lib/minifever-joueur');

const JEU = 'minifever';
const DOSSIER = path.join(K.SORTIE, JEU);
const PAS = 25;
const CSS = '#bandeau{display:none !important}';
const LISTE = ['gameHammer', 'gameGobelet', 'gameSpaceDodge', 'gamePong', 'gameHammer', 'gameGobelet', 'gameSpaceDodge', 'gameHammer', 'gameGobelet'];

// Les crochets de la capture, posés avant les scripts de la page : on garde
// une poignée sur le socle (nouvellePartie), et le tirage des épreuves du
// Fever suit la liste `window.__listeJeux` quand elle est posée.
function scriptCrochets() {
  /* eslint-disable no-undef */
  const poser = (nom, patch) => {
    let v;
    Object.defineProperty(window, nom, {
      configurable: true,
      get() { return v; },
      set(x) { v = x; try { patch(x); } catch (e) { console.error(e); } },
    });
  };
  poser('MinifeverClient', (C) => {
    const n0 = C.Client.prototype.nouvellePartie;
    C.Client.prototype.nouvellePartie = function () {
      const s = n0.apply(this, arguments);
      window.__socle = s;
      window.__clientMF = this;
      return s;
    };
  });
  poser('MinifeverEngine', (E) => {
    const t0 = E.Fever.prototype.tirer;
    let k = 0;
    E.Fever.prototype.tirer = function () {
      const l = window.__listeJeux;
      if (!l || !l.length) return t0.apply(this, arguments);
      const cle = l[k++ % l.length];
      this.suivant = this.catalogue.find((c) => c.cle === cle) || this.catalogue[0];
    };
  });
  /* eslint-enable no-undef */
}

async function ouvrir(nav) {
  const page = await K.nouvellePage(nav, { css: CSS });
  await page.addInitScript(scriptCrochets);
  await page.goto(K.BASE + '/minifever/');
  await K.attendre(page, () => !!(window.__socle && window.__clientMF), { nom: 'minifever', images: 2 });
  return page;
}

async function versEcran(page, p) {
  return page.evaluate((p) => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return { x: r.left + p.x / 240 * r.width, y: r.top + p.y / 240 * r.height };
  }, p);
}

async function fever(nav) {
  const page = await ouvrir(nav);
  await page.evaluate(installerJoueur);
  await K.avancer(page, 60, PAS);
  await page.evaluate((l) => { window.__listeJeux = l; }, LISTE);
  // Le mode Fever, par le lien du bandeau (masqué à l'écran ; ce n'est pas une entrée de jeu).
  await page.evaluate(() => { const a = Array.from(document.querySelectorAll('#modes a')).find((x) => x.textContent.trim() === 'fever'); a.click(); });
  const inter = path.join(K.DOSSIER_TEMP, 'minifever-fever.mp4');
  const enc = K.encodeur(inter, { fps: 40, codec: K.INTERMEDIAIRE });
  let souris = await versEcran(page, { x: 120, y: 150 });
  await page.mouse.move(souris.x, souris.y);
  let bas = false, finA = null;
  const journal = [];
  const max = 40 * 70;
  for (let i = 0; i < max; i++) {
    const d = await page.evaluate(() => window.__joueur.decider());
    if (d) {
      const cible = await versEcran(page, d);
      const k = d.vite ? 0.55 : 0.35;
      const nx = souris.x + (cible.x - souris.x) * k, ny = souris.y + (cible.y - souris.y) * k;
      if (Math.hypot(nx - souris.x, ny - souris.y) > 0.5) { souris = { x: nx, y: ny }; await page.mouse.move(nx, ny); }
      if (d.bas && !bas) { await page.mouse.move(cible.x, cible.y); souris = cible; await page.mouse.down(); bas = true; }
      else if (!d.bas && bas) { await page.mouse.up(); bas = false; }
    } else if (bas) { await page.mouse.up(); bas = false; }
    await page.evaluate((ms) => window.__horloge.avancer(ms), PAS);
    await enc.ecrire(await K.capture(page));
    const e = await page.evaluate(() => { const s = window.__socle; return { cle: s.suivant && s.suivant.cle, niveau: s.niveau, fin: !!s.ecranFin, gagnant: s.jeu ? s.jeu.gagnant : null }; });
    journal.push(e);
    if (e.fin && finA === null) finA = i;
    if (finA !== null && i - finA > 120) break;
    if (e.niveau > LISTE.length && e.gagnant !== null && finA === null) { finA = i; }
  }
  await enc.fermer();
  await page.close();
  // Les épreuves, d'après le journal : début de chaque niveau et verdict.
  const epreuves = [];
  for (let i = 0; i < journal.length; i++) {
    const e = journal[i], p = journal[i - 1];
    if (!p || e.niveau !== p.niveau) epreuves.push({ niveau: e.niveau, cle: e.cle, debut: i, verdict: null });
    const cur = epreuves[epreuves.length - 1];
    if (cur && cur.verdict === null && e.gagnant !== null) cur.verdict = e.gagnant;
  }
  console.log('  épreuves :', epreuves.map((x) => `${x.niveau}:${x.cle}@${(x.debut * PAS / 1000).toFixed(1)}s=${x.verdict}`).join(' '));
  return { inter, n: journal.length, epreuves, finA };
}

async function titre(nav) {
  const page = await K.nouvellePage(nav, { css: CSS });
  await page.addInitScript(scriptCrochets);
  await page.goto(K.BASE + '/minifever/');
  await K.attendre(page, () => !!window.__socle, { nom: 'minifever', images: 0 });
  const inter = path.join(K.DOSSIER_TEMP, 'minifever-titre.mp4');
  const enc = K.encodeur(inter, { fps: 40, codec: K.INTERMEDIAIRE });
  for (let i = 0; i < 40 * 9; i++) {
    await page.evaluate((ms) => window.__horloge.avancer(ms), PAS);
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
      const inter = await titre(nav);
      cut(inter, 'minifever-titre', 0.5, 5, 2.5);
    }
    if (veut('fever')) {
      const r = await fever(nav);
      const s = (i) => i * PAS / 1000;
      const ep = r.epreuves;
      cut(r.inter, 'minifever-fever-maitre', 0, s(r.n), s(ep[1] ? ep[1].debut + 60 : 60));
      // Deux plans : les épreuves 1-2, puis 3-4 (un peu avant le début de la première).
      if (ep.length >= 2) cut(r.inter, 'minifever-epreuves-a', Math.max(0, s(ep[0].debut) - 0.3), Math.min(14, s((ep[2] ? ep[2].debut : r.n)) - Math.max(0, s(ep[0].debut) - 0.3)), 3);
      if (ep.length >= 4) cut(r.inter, 'minifever-epreuves-b', Math.max(0, s(ep[2].debut) - 0.3), Math.min(14, s((ep[4] ? ep[4].debut : r.n)) - Math.max(0, s(ep[2].debut) - 0.3)), 4);
      if (ep.length >= 6) cut(r.inter, 'minifever-epreuves-c', Math.max(0, s(ep[4].debut) - 0.3), Math.min(14, s(r.n) - Math.max(0, s(ep[4].debut) - 0.3)), 4);
      fs.writeFileSync(path.join(K.DOSSIER_TEMP, 'minifever-epreuves.json'), JSON.stringify(ep));
    }
    if (veut('jaquette')) await K.jaquette(nav, JEU, 'disc_jaquette_minifever.svg', 'minifever-jaquette.png');
  } finally {
    await nav.close();
  }
  const v40 = (nom) => [nom + '-40ips.mp4'];
  K.finirJeu(JEU, {
    videos: {
      'minifever-titre': { titre: 'Mini-Fever — écran d\'accueil', description: 'L\'écran d\'accueil (Menu.mt reconstruit) : le titre qui jaillit sur son ressort, les bulles qui l\'entourent, puis les cases des modes qui glissent.', usage: 'Carton d\'ouverture du segment Mini-Fever.', variantes: v40('minifever-titre') },
      'minifever-fever-maitre': { titre: 'Mini-Fever — le mode Fever (plan maître)', description: 'Les épreuves s\'enchaînent sans répit, de plus en plus dures : maillet, bonneteau, esquive, renvoi (pong)… chacune gagnée à la souris, fondu blanc à chaque victoire.', usage: 'Plan maître à découper : une épreuve = un plan de 3 à 5 s.', variantes: v40('minifever-fever-maitre') },
      'minifever-epreuves-a': { titre: 'Mini-Fever — maillet et bonneteau', description: 'Les deux premières épreuves du Fever : assommer les bestioles au maillet dès qu\'elles sortent de leur terrier, puis suivre la bille sous les gobelets qui se mélangent et cliquer le bon.', usage: 'Rythme, « mini-jeux en rafale ».', variantes: v40('minifever-epreuves-a') },
      'minifever-epreuves-b': { titre: 'Mini-Fever — esquive et renvoi', description: 'Esquiver les tirs des tourelles jusqu\'au bout du chrono, puis tenir la balle au pong.', usage: 'Rythme, réflexes.', variantes: v40('minifever-epreuves-b') },
      'minifever-epreuves-c': { titre: 'Mini-Fever — la suite, plus vite', description: 'Les mêmes épreuves, la difficulté montée de quarante : plus de bestioles, plus de gobelets, plus de tirs.', usage: 'Accélération, montée en tension.', variantes: v40('minifever-epreuves-c') },
    },
    images: {
      'minifever-jaquette.png': { titre: 'Mini-Fever — jaquette du disque', description: 'La jaquette du disque Mini-Fever du bureau Frutiz (disc_jaquette_minifever), PNG transparent, 1080 px de haut.', usage: 'Incrustation, carton de fin du segment.' },
    },
    sons: [],
  });
}

module.exports = { principal, scriptCrochets };
if (require.main === module) principal().catch((e) => { console.error(e); process.exit(1); });
