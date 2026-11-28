'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES CLASSEMENTS ET LES MÉDAILLES : les noms
 * des classements (`classements.<id>`, RANKINGS dans server.js), les libellés
 * des onglets du tableau des scores (`classements.onglet.<rk>`, le `rn` de
 * LEGACY_RANKINGS, celui que le bureau affiche), les mots des étiquettes de
 * score, et les trois médailles.
 *
 * Les noms propres restent : les jeux (Burning Kiwi, Frutisnake, Kaluga…), les
 * circuits (Green Hill, Terre Grise…), Freestyle, Contest, Challenge. Un
 * classement absent d'ici garde son nom français — c'est le cas de ceux qui
 * ne portent qu'un nom propre.
 *
 * LES MÉDAILLES : le français s'élide (« la médaille d'or ») ; l'anglais n'a
 * que l'adjectif (« the gold medal »). `nomDeMedaille` en fait un paramètre :
 * chaque langue écrit sa phrase autour.
 */
module.exports = {
  // ── Les médailles ──
  'classements.medaille.or': 'gold',
  'classements.medaille.argent': 'silver',
  'classements.medaille.bronze': 'bronze',

  // ── Les noms des classements ──
  'classements.snake3_classic': 'Frutisnake - Classic',
  'classements.kaluga_classic': 'Kaluga - Cluster',
  'classements.swapou2_classic': 'Swapou - Classic',
  'classements.mb2_classic': 'MotionBall - Classic',
  'classements.jamajama_classic': 'JamaJama - Classic',
  'classements.grapiz_champion': 'Grapiz - Championship',
  'classements.bandas_champion': 'Frutibandas - Championship',
  'classements.snake3_battle': 'Frutisnake - Championship',
  'classements.snake3_tournoi': 'Frutisnake - Tournament',

  // ── Les onglets du tableau des scores (le `rn` du bureau, par numéro) ──
  'classements.onglet.4': 'Kaluga cluster',
  'classements.onglet.9': 'Kikooz rank.',
  'classements.onglet.16': 'Snake tournament',
  'classements.onglet.xp': 'XP ranking',
  'classements.onglet.consecration': 'Consecration rank.',

  // ── Les étiquettes de score ──
  'classements.niv': 'Lvl',
  'classements.etiquette.niveau': ' · level {niveau}',
  'classements.etiquette.epreuves': {
    one: '{points} · {n} trial on {palier}',
    other: '{points} · {n} trials on {palier}',
  },
  // Les paliers de Mini-Fever (public/minifever/engine.js, PALIERS).
  'classements.palierMinifever.0': 'easy',
  'classements.palierMinifever.1': 'normal',
  'classements.palierMinifever.2': 'hard',
  'classements.palierMinifever.3': 'infernal',
};
