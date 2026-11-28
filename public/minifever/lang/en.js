/*
 * DICTIONNAIRE ANGLAIS — MINI-FEVER (public/minifever/index.html, client.js).
 *
 * Chargé par FPI18n.charger('/minifever/lang/{lang}.js') seulement quand la
 * page est en anglais ; le français reste écrit dans le code (argument de
 * repli de T() / tr()). Une clé absente retombe sur le français. Les entrées
 * en { one, other } sont des pluriels (T.n).
 *
 * « Épreuve » (un mini-jeu de la chaîne) se dit ROUND ; les modes Arcade et
 * Fever, et les cases Time, Train et Secret du menu, gardent leur nom. Les
 * noms des épreuves (jeux.js) et des paliers (engine.js) restent dans leurs
 * fichiers, que le serveur relit : on ne traduit que leur AFFICHAGE, par la
 * clé de l'épreuve (minifever.jeu.<cle>) ou le rang du palier. La scène fait
 * 240 × 240 : les noms tiennent sur une ligne en gras 15 px.
 */
FPI18n.ajouter('en', {
  // ── Les paliers de l'arcade (Lang.DIF_LEVEL) ────────────────────────────
  'minifever.palier0': 'easy',
  'minifever.palier1': 'normal',
  'minifever.palier2': 'hard',
  'minifever.palier3': 'infernal',

  // ── Les vingt-sept épreuves ─────────────────────────────────────────────
  'minifever.jeu.gameBasket': 'basket',
  'minifever.jeu.gameLander': 'moon landing',
  'minifever.jeu.gameFlower': 'watering',
  'minifever.jeu.gamePong': 'rebound',
  'minifever.jeu.gameAstero': 'asteroids',
  'minifever.jeu.gameParachute': 'parachute',
  'minifever.jeu.gameGobelet': 'shell game',
  'minifever.jeu.gameMarmite': 'cauldron',
  'minifever.jeu.gameGather': 'gust',
  'minifever.jeu.gameTubulo': 'pistons',
  'minifever.jeu.gameTrampoline': 'trampoline',
  'minifever.jeu.gameOrbital': 'orbit',
  'minifever.jeu.gameJumpFish': 'photo',
  'minifever.jeu.gamePatate': 'veggie',
  'minifever.jeu.gameApple': 'apple',
  'minifever.jeu.gameBomb': 'bomb',
  'minifever.jeu.gameFrog': 'frog',
  'minifever.jeu.gameCliff': 'cliff',
  'minifever.jeu.gameChain': 'chain',
  'minifever.jeu.gameGhost': 'ghost',
  'minifever.jeu.gameBalance': 'scales',
  'minifever.jeu.gamePicture': 'painting',
  'minifever.jeu.gamePlate': 'plate',
  'minifever.jeu.gamePoint': 'dot to dot',
  'minifever.jeu.gameSpaceDodge': 'dodge',
  'minifever.jeu.gameHammer': 'mallet',
  'minifever.jeu.gameTaquin': 'sliding puzzle',

  // ── La scène (client.js) ────────────────────────────────────────────────
  'minifever.reprendre': 'click to resume',
  'minifever.gagne': 'won!',
  'minifever.rate': 'missed!',
  'minifever.objectifPasse': 'goal {lvl} passed!',
  'minifever.sur': 'out of {lvl}',

  // ── Le bandeau sous la scène ────────────────────────────────────────────
  'minifever.chargement': 'loading…',
  'minifever.chargementPct': 'loading… {pct}%',
  'minifever.chargementImpossible': "can't load: {erreur}",
  'minifever.modeMenu': 'menu',
  'minifever.baremeDefaut': 'arcade: 10 pts per round won, × 2 on normal, × 3 on hard, × 4 on infernal — one single ranking',
  'minifever.bareme': 'arcade: 10 pts per round won, × {normal} on normal, × {difficile} on hard, × {infernal} on infernal — one single ranking',
  'minifever.baremeSansPlafond': 'arcade: 10 pts per round won, × {normal} on normal, × {difficile} on hard, × {infernal} on infernal — no cap: play until your last life — one single ranking',
  'minifever.preparation': 'getting the game ready…',
  'minifever.choisisMode': 'choose your mode',
  'minifever.epreuveN': 'round {n}',
  'minifever.vies': { one: '{n} life', other: '{n} lives' },
  'minifever.etatArcade': '{palier} · round {n}/{lvl} · {vies}',
  'minifever.etatAuDela': "{palier} · round {n} (mode cleared, let's keep going!) · {vies}",
  'minifever.finFever': {
    one: '{n} round won (unranked) — click to play again',
    other: '{n} rounds won (unranked) — click to play again',
  },
  'minifever.finAuDela': '{n} rounds — {palier} mode cleared, and beyond! — pick a mode to play again',
  'minifever.finSansPlafond': '{n} rounds/{objectif} — pick a mode to play again',
  'minifever.finGagnee': '{palier} mode cleared! — click a mode to play again',
  'minifever.finPerdue': '{n}/{objectif} rounds — pick a mode to play again',

  // ── Le score envoyé, et ce qu'il en advient ─────────────────────────────
  'minifever.connecteToi': 'log in to save your scores',
  'minifever.rienAClasser': 'no rounds won: nothing to rank',
  'minifever.nonEnregistre': 'score NOT saved: {motif}',
  'minifever.enAttente': 'score pending: server unreachable, trying again in a few seconds…',
  'minifever.auClassement': " — in today's rankings",
  'minifever.meilleurReste': " — your best today is still {record}: the rankings keep the best one",
  'minifever.picto': ' · picto: {pictos}',
  // Les codes du serveur (MOTIFS).
  'minifever.motifSession': 'your session has expired — log in again, then replay',
  'minifever.motifReseau': "the server didn't answer",
  'minifever.motifRefus': 'the server rejected this game',
  'minifever.motifPalier': "this level isn't ranked",
  'minifever.motifRejeu': "the server couldn't reproduce this game when replaying it",
  'minifever.motifNonVerifiee': 'game played without the server: unranked',
  'minifever.motifJeton': 'game token rejected',
  'minifever.motifDejaRendu': 'this game has already been submitted',
});
