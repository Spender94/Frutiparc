#!/usr/bin/env node
/*
 * Kit bande-annonce — section « jeux-a » : le MANIFESTE, refait d'après le disque.
 *
 *   node scripts/kit-bande-annonce/jeux-a/manifeste.js
 *
 * Sans navigateur ni capture : pour chaque jeu, les vidéos décrites ci-dessous
 * qui EXISTENT et que ffprobe lit (1920×1080, 60 i/s) entrent au manifeste,
 * avec leur affiche PNG et leur variante native à 40 i/s quand elles existent ;
 * les jaquettes sont (re)sorties des sprites du bureau (pixels d'origine +
 * agrandissement ×16 net), les sons copiés (MP3 → OGG Vorbis, WAV tels quels).
 * Écrit <jeu>/manifest-partiel.json puis manifest.json (section entière).
 *
 * C'est aussi ce que font les scripts de jeu à la fin de leur passage
 * (K.finirJeu) ; celui-ci permet de refaire le manifeste seul.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const K = require('./lib/commun');

const V40 = ' Variante -40ips : le même plan à la cadence native du jeu (40 pas par seconde, une image par pas, aucune image répétée) ; le maître à 60 i/s répète une image sur trois, exactement comme un écran à 60 Hz.';

const JEUX = {
  swapou: {
    jaquette: 'disc_jaquette_swapou2.svg',
    videos: {
      'swapou-titre': ['Swapou — écran titre', 'L\'ouverture du jeu : Natacha et Monsieur Sel, le logo « Swapou, les légumes attaquent ! », puis le menu qui s\'installe.', 'Carton d\'ouverture du segment Swapou.'],
      'swapou-cascade-maitre': ['Swapou — la grande cascade (plan maître)', 'Partie de Challenge jouée par l\'IA du jeu (analyse.js, Monsieur Sel, graine 20261126), rejouée coup pour coup dans la vraie page : le plateau monte jusqu\'au plafond, puis un seul échange déclenche une chaîne de 26 phases (137 fruits, +5 395 points).', 'Plan maître à découper : la tension de la montée, puis le compteur de chaîne qui s\'emballe.'],
      'swapou-cascade': ['Swapou — la grande cascade', 'Les derniers coups de la montée (le plateau touche le plafond) et le départ de la chaîne : le compteur dans l\'étoile grimpe.', 'Le moment « combo » du segment Swapou.'],
      'swapou-pouvoir': ['Swapou — le pouvoir Moïse', 'Fin d\'une chaîne, puis Monsieur Sel dépense ses étoiles : le pouvoir Moïse fend le plateau, et l\'IA reconstruit aussitôt.', 'Effet spécial : plus qu\'un jeu d\'échange.'],
      'swapou-fin': ['Swapou — fin de partie sous la glace', 'Après 95 coups : fruits gelés et métalliques, plateau au plafond, et une chaîne de 18 phases pour respirer.', 'Tension, « ça va vite ».'],
    },
    sons: [
      ['public/swapou/sounds/sound_game.mp3', 'swapou-musique-challenge', 'Swapou — musique de partie', 'Boucle musicale des parties', 'Fond musical du segment.', true],
      ['public/swapou/sounds/sound_menu.mp3', 'swapou-musique-menu', 'Swapou — musique du menu', 'Boucle du menu', 'Sous l\'écran titre.', true],
      ['public/swapou/sounds/sound_combo.mp3', 'swapou-combo', 'Swapou — combo', 'Le son d\'une chaîne', 'Sur le compteur de chaîne.'],
      ['public/swapou/sounds/sound_pop1.mp3', 'swapou-pop1', 'Swapou — explosion de fruit (1)', 'Un fruit qui éclate', 'Explosions de la cascade.'],
      ['public/swapou/sounds/sound_pop2.mp3', 'swapou-pop2', 'Swapou — explosion de fruit (2)', 'Variante', 'En alternance avec pop1.'],
      ['public/swapou/sounds/sound_swap.mp3', 'swapou-echange', 'Swapou — échange', 'Deux fruits échangés', 'Sur chaque clic.'],
      ['public/swapou/sounds/sound_show_score.mp3', 'swapou-score', 'Swapou — score', 'Affichage du score', 'Carton de score.'],
    ],
  },
  bkiwi: {
    jaquette: 'disc_jaquette_bkiwi.svg',
    videos: {
      'bkiwi-titre': ['Burning Kiwi — ouverture', 'Un passage de l\'intro du disque (garage, casque et clés, silhouette du pilote).', 'Carton d\'ouverture du segment Burning Kiwi.'],
      'bkiwi-intro-maitre': ['Burning Kiwi — intro (plan maître)', 'L\'intro du disque : connexion, garage, casque et clés, silhouette du pilote, gant, nitro, burn, la voiture qui s\'envole.', 'À découper pour l\'ouverture (plans très graphiques).'],
      'bkiwi-course-maitre': ['Burning Kiwi — une course entière à Green Hill (plan maître)', 'Mode essais, la Pétaradeuse (pilote automatique de la capture) contre trois voitures de l\'IA : décompte 3-2-1, super départ, nitros, tremplins, trois tours, arrivée en tête.', 'Plan maître à découper ; tout est à vitesse réelle.'],
      'bkiwi-depart': ['Burning Kiwi — le départ', 'Le décompte (les chiffres découpent le circuit), le GO, le départ sous nitro et les premiers virages.', 'Le moment « vitesse ».'],
    },
    sons: [
      ['Games/burningKiwi/bk00.mp3', 'bkiwi-musique-course', 'Burning Kiwi — musique de course (Green Hill)', 'Musique du circuit 0, servie à /swf/games/burningKiwi/bk00.mp3', 'Fond musical des plans de course.', true],
      ['Games/burningKiwi/bkMenu.mp3', 'bkiwi-musique-menu', 'Burning Kiwi — musique du menu', 'Servie à /swf/games/burningKiwi/bkMenu.mp3', 'Sous l\'ouverture.', true],
      ['public/bkiwi/sons/kiwiPickUp.mp3', 'bkiwi-kiwi', 'Burning Kiwi — kiwi ramassé', 'Un kiwi (nitro) ramassé', 'Sur les nitros.'],
      ['public/bkiwi/sons/buttonOk.mp3', 'bkiwi-bouton-ok', 'Burning Kiwi — bouton OK', 'Validation dans le menu', 'Transitions.'],
      ['public/bkiwi/sons/loseLifeSound.mp3', 'bkiwi-vie-perdue', 'Burning Kiwi — vie perdue', 'Une vie perdue', 'Accident.'],
      ['public/bkiwi/sons/gameOverSound.mp3', 'bkiwi-game-over', 'Burning Kiwi — game over', 'Fin de partie', 'Chute, fin.'],
    ],
  },
  snake3: {
    jaquette: 'disc_jaquette_snake.svg',
    videos: {
      'snake3-titre': ['Frutisnake — le menu', 'Le menu du jeu : le titre « Frutisnake » et le carrousel des modes (challenge, battle, encyclopéfruit).', 'Carton d\'ouverture du segment Frutisnake (plan calme).'],
      'snake3-depart': ['Frutisnake — c\'est parti', 'Du menu à la partie : le rideau se lève, le serpent (pilote de la capture) sort de son terrier et file vers les premiers fruits ; le score grimpe.', 'Présentation du jeu.'],
    },
    sons: [
      ['public/snake3/sons/game_loop.mp3', 'snake3-musique-partie', 'Frutisnake — musique de partie', 'Boucle des parties', 'Fond musical du segment.', true],
      ['public/snake3/sons/menu_loop.mp3', 'snake3-musique-menu', 'Frutisnake — musique du menu', 'Boucle du menu', 'Sous le menu.', true],
      ['public/snake3/sons/glurps.mp3', 'snake3-glurps', 'Frutisnake — fruit avalé', 'Le « glurps » d\'un fruit', 'Sur chaque fruit.'],
      ['public/snake3/sons/option.mp3', 'snake3-option', 'Frutisnake — option', 'Une option ramassée', 'Sur les options.'],
      ['public/snake3/sons/explose.mp3', 'snake3-explosion', 'Frutisnake — explosion', 'Bombe, fin de partie', 'Impact.'],
      ['public/snake3/sons/game_over.mp3', 'snake3-game-over', 'Frutisnake — game over', 'Fin de partie', 'Chute.'],
    ],
  },
  kaluga: {
    jaquette: 'disc_jaquette_kaluga.svg',
    videos: {
      'kaluga-titre': ['Kaluga — le menu', 'Le menu de Kaluga Transport Inc. : le logo, la tzongre aux grands yeux, les modes de jeu.', 'Carton d\'ouverture du segment Kaluga (plan calme).'],
      'kaluga-pommes': ['Kaluga — les pommes au panier', 'Mode Essais : la tzongre (pilote de la capture) vole, cueille une pomme au bout de son fil et la porte vers le panier.', 'Le geste du jeu, en un plan.'],
    },
    sons: [
      ['public/kaluga/sons/sJeuLoop0.wav', 'kaluga-musique-partie', 'Kaluga — musique de partie', 'Boucle des parties', 'Fond musical du segment.', true],
      ['public/kaluga/sons/sMenuLoop.wav', 'kaluga-musique-menu', 'Kaluga — musique du menu', 'Boucle du menu', 'Sous le menu.', true],
      ['public/kaluga/sons/sFly.wav', 'kaluga-vol', 'Kaluga — bourdonnement', 'Les ailes de la tzongre (boucle)', 'Sous les plans de vol.', true],
      ['public/kaluga/sons/sLink.mp3', 'kaluga-fil', 'Kaluga — le fil', 'Le fil qui accroche une pomme', 'Sur la cueillette.'],
      ['public/kaluga/sons/sBonus.mp3', 'kaluga-bonus', 'Kaluga — bonus', 'Un papillon bonus', 'Temps fort.'],
      ['public/kaluga/sons/sGong.mp3', 'kaluga-gong', 'Kaluga — gong', 'Le gong de fin', 'Fin de segment.'],
    ],
  },
  minifever: {
    jaquette: 'disc_jaquette_minifever.svg',
    videos: {
      'minifever-titre': ['Mini-Fever — écran d\'accueil', 'L\'écran d\'accueil : le titre qui jaillit sur son ressort, les bulles, puis les cases des modes qui glissent.', 'Carton d\'ouverture du segment Mini-Fever.'],
      'minifever-fever-maitre': ['Mini-Fever — le mode Fever (plan maître)', 'Les épreuves s\'enchaînent, de plus en plus dures, jouées à la vraie souris : maillet, bonneteau et esquive gagnés (fondu blanc), puis le pong perdu (fondu rouge) et l\'écran de fin aux cerises.', 'Plan maître à découper : une épreuve = un plan de 3 à 6 s.'],
      'minifever-epreuves-a': ['Mini-Fever — maillet et bonneteau', 'Le début du Fever : les bestioles assommées au maillet, puis les gobelets.', 'Rythme, « mini-jeux en rafale ».'],
      'minifever-epreuves-b': ['Mini-Fever — bonneteau, esquive, pong', 'Suivre la bille sous les gobelets et cliquer le bon, esquiver les tirs des tourelles, puis le pong qui finit en fondu rouge.', 'Rythme, réflexes, chute.'],
    },
    sons: [],
  },
  minipixiz: { jaquette: 'disc_jaquette_minipixiz.svg', videos: {}, sons: [] },
};

async function principal() {
  for (const [jeu, d] of Object.entries(JEUX)) {
    const dossier = path.join(K.SORTIE, jeu);
    fs.mkdirSync(dossier, { recursive: true });
    const elements = [];
    for (const [nom, [titre, description, usage]] of Object.entries(d.videos)) {
      const f = path.join(dossier, nom + '.mp4');
      if (!fs.existsSync(f)) continue;
      let p;
      try { p = K.sonder(f); } catch (e) { console.log('✘ illisible : ' + f); continue; }
      if (p.largeur !== 1920 || p.hauteur !== 1080 || Math.round(p.fps) !== 60 || !(p.duree > 1)) { console.log('✘ hors format : ' + f); continue; }
      const e = { fichier: nom + '.mp4', type: 'video', titre, description, usage,
        duree: Math.round(p.duree * 100) / 100, fps: 60, largeur: 1920, hauteur: 1080, alpha: false };
      if (fs.existsSync(path.join(dossier, nom + '.png'))) e.affiche = nom + '.png';
      const v = nom + '-40ips.mp4';
      if (fs.existsSync(path.join(dossier, v))) {
        try {
          const q = K.sonder(path.join(dossier, v));
          if (Math.round(q.fps) === 40 && Math.abs(q.duree - p.duree) < 0.2) { e.variantes = [v]; e.description += V40; }
          else fs.unlinkSync(path.join(dossier, v));
        } catch (err) { fs.unlinkSync(path.join(dossier, v)); }
      }
      elements.push(e);
    }
    const j = await K.jaquette(null, jeu, d.jaquette, jeu + '-jaquette.png');
    if (j.vectorielle) {
      fs.rmSync(path.join(dossier, jeu + '-jaquette-x16.png'), { force: true });
      elements.push({ fichier: jeu + '-jaquette.png', type: 'image', titre: `${K.TITRES_JEUX[jeu]} — jaquette du disque`,
        description: 'La jaquette du disque du bureau Frutiz : un dessin vectoriel, tracé net à 1080 × 1080, PNG transparent.',
        usage: 'Incrustation, carton de fin du segment.', largeur: 1080, hauteur: 1080, alpha: true });
    } else {
      elements.push({ fichier: jeu + '-jaquette.png', type: 'image', titre: `${K.TITRES_JEUX[jeu]} — jaquette du disque`,
        description: 'La jaquette du disque telle que le bureau Frutiz la montre : l\'image d\'origine du sprite, 61 × 61 pixels, PNG transparent. Variante -x16 : agrandie seize fois au plus proche voisin (976 × 976, pixels nets).',
        usage: 'Incrustation, carton de fin du segment.', largeur: 61, hauteur: 61, alpha: true, variantes: [jeu + '-jaquette-x16.png'] });
    }
    if (d.sons.length) {
      elements.push(...K.copierSons(jeu, d.sons.map(([source, nom, titre, description, usage, boucle]) => ({ source, nom, titre, description, usage, boucle: !!boucle }))));
    }
    // Les éléments du manifeste partiel précédent qui ne sont pas décrits ici
    // (la fenêtre du bureau, un plan refait à part) sont gardés s'ils existent.
    K.ecrireManifesteJeu(jeu, elements);
    console.log(`  ${jeu} : ${elements.length} éléments`);
  }
}

if (require.main === module) principal().catch((e) => { console.error(e); process.exit(1); });
module.exports = { principal, JEUX };
