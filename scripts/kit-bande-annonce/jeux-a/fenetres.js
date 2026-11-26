#!/usr/bin/env node
/*
 * Kit bande-annonce — les jeux DANS LEUR FENÊTRE du bureau Frutiz, section « jeux-a ».
 *
 *   node scripts/kit-bande-annonce/jeux-a/fenetres.js [--seul=<jeu>]
 *
 * Sortie : /home/user/Frutiparc/kit-bande-annonce/jeux-a/<jeu>/<jeu>-fenetre.mp4
 *
 * Le spectateur fictif du casting (kit-bande-annonce/casting.json, « pomelo »)
 * se crée un compte sur le serveur local (sans base), se connecte, et le
 * client /light s'ouvre en mode bureau (fenêtre ≥ 768 px). On y ouvre le jeu
 * comme le fait le site (activateTab : la rubrique devient une fenêtre du
 * bureau, le jeu chargé dans son cadre), et l'on filme quelques secondes de
 * son écran d'accueil qui s'anime, à l'horloge virtuelle (le script d'horloge
 * est injecté dans TOUS les cadres de la page, jeu compris).
 *
 * La page est rendue à 1280×720 points à l'échelle 1,5 : le bureau garde ses
 * proportions d'origine, l'image fait 1920×1080 et reste nette.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const K = require('./lib/commun');

const JEUX = {
  swapou: { titre: 'Swapou' }, snake3: { titre: 'Frutisnake' }, bkiwi: { titre: 'Burning Kiwi' },
  kaluga: { titre: 'Kaluga' }, minifever: { titre: 'Mini-Fever' }, minipixiz: { titre: 'MiniPixiz' },
};

async function compte() {
  const casting = JSON.parse(fs.readFileSync('/home/user/Frutiparc/kit-bande-annonce/casting.json', 'utf8'));
  const pseudo = (casting.spectateur && casting.spectateur.pseudo) || 'pomelo';
  const motDePasse = 'kit-bande-annonce';
  const post = (url, corps) => fetch(K.BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }).then((r) => r.json());
  await post('/api/auth/register', { username: pseudo, password: motDePasse }).catch(() => null);
  const r = await post('/api/auth/login', { username: pseudo, password: motDePasse });
  if (!r || !r.sid) throw new Error('connexion impossible : ' + JSON.stringify(r));
  return r.sid;
}

async function fenetre(nav, sid, jeu) {
  const page = await K.nouvellePage(nav, { largeur: 1280, hauteur: 720, echelle: 1.5 });
  await page.goto(K.BASE + '/light?sid=' + encodeURIComponent(sid));
  await K.attendre(page, () => !!(window.BureauFrutiz && document.body.classList.contains('bureau-frutiz') && window.activateTab), { nom: 'bureau', images: 4 });
  await K.avancer(page, 120);
  await page.evaluate((j) => window.activateTab(j), jeu);
  // Le jeu charge dans son cadre (réseau réel) : on laisse battre l'horloge.
  const debut = Date.now();
  while (Date.now() - debut < 25000) {
    await K.avancer(page, 6);
    await new Promise((r) => setTimeout(r, 40));
  }
  await K.avancer(page, 60 * 3);
  const dossier = path.join(K.SORTIE, jeu);
  fs.mkdirSync(dossier, { recursive: true });
  await K.filmer(page, path.join(dossier, jeu + '-fenetre.mp4'), 60 * 6, { affiche: 60 * 3, fichierAffiche: path.join(dossier, jeu + '-fenetre.png') });
  await page.close();
  K.ajouterAuManifeste(jeu, jeu + '-fenetre.mp4', K.descriptionFenetre(K.TITRES_JEUX[jeu] || jeu));
}

async function principal() {
  const seuls = process.argv.filter((a) => a.startsWith('--seul=')).map((a) => a.slice(7));
  await K.serveur();
  const sid = await compte();
  const nav = await K.navigateur();
  try {
    for (const jeu of Object.keys(JEUX)) {
      if (seuls.length && !seuls.includes(jeu)) continue;
      try { await fenetre(nav, sid, jeu); } catch (e) { console.error('  ✘ fenêtre ' + jeu + ' : ' + e.message); }
    }
  } finally {
    await nav.close();
  }
}

module.exports = { principal, JEUX };
if (require.main === module) principal().catch((e) => { console.error(e); process.exit(1); });
