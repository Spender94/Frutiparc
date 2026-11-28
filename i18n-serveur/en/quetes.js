'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES QUÊTES DE GROMELIN : les titres et les
 * lignes de détail des quêtes, les unités (« 12 points », « 4 min 20 s »), les
 * nombres en toutes lettres, les niveaux et les paliers, les refus de
 * l'échange et du contrat. Le français est dans quetes.js (et les refus dans
 * server.js) ; ici, l'anglais seul.
 *
 *   quetes.mesure.<clé>.titre|detail|nom   une mesure (MESURES : `{seuil}` y est posé)
 *   quetes.catalogue|parc|gromelin|pas.<clé>.titre|detail
 *                                          les quêtes dont le code écrit les textes
 *   quetes.detail.*                        les lignes des quêtes taillées (detailRendu)
 *   quetes.ligne.*                         l'avancement (avancement)
 *   quetes.unite.*                         les valeurs (formater) : `{v}` le nombre écrit
 *
 * Les répliques de Gromelin (`PAROLES`) ne sont pas ici : elles ont leur zone.
 *
 * Le glossaire : « quête de Gromelin » → Gromelin's quest ; « bricole » →
 * odd job ; « Challenge » reste ; les noms des jeux, des circuits et des
 * épreuves propres aux jeux (dexteripomme, plantapomme, la Tourneboule)
 * restent tels quels.
 */
const d = {
  // ── Les refus de l'échange et du contrat ──
  'quetes.dejaEchange': 'You\'ve already swapped a quest this week.',
  'quetes.bricoleNonEchangeable': 'One of Gromelin\'s odd jobs can\'t be swapped.',
  'quetes.doigtNonEchangeable': 'The finger challenge can\'t be swapped.',
  'quetes.dejaFaite': 'This quest is already done.',
  'quetes.rienAProposer': 'Gromelin has nothing else to offer you this week.',
  'quetes.dejaSigne': 'You\'ve already signed your contract this week.',

  // ── Niveaux, paliers, étiquettes, la semaine ──
  'quetes.niveau.facile': 'Easy',
  'quetes.niveau.moyenne': 'Medium',
  'quetes.niveau.difficile': 'Hard',
  'quetes.palier.bronze': 'Bronze',
  'quetes.palier.argent': 'Silver',
  'quetes.palier.or': 'Gold',
  'quetes.palier.platine': 'Platinum',
  'quetes.palier.legende': 'Legend',
  'quetes.etiquette.salons': 'Chat rooms',
  // (« Week {semaine} » : « Week of November 23 to 29 »)
  'quetes.semaine': 'of {du} to {au}',
  'quetes.lettres.0': 'zero',
  'quetes.lettres.1': 'one',
  'quetes.lettres.2': 'two',
  'quetes.lettres.3': 'three',
  'quetes.lettres.4': 'four',
  'quetes.lettres.5': 'five',

  // ── Les valeurs ──
  'quetes.unite.virgule': '.',
  'quetes.unite.pourcent': { one: '{v}%', other: '{v}%' },
  'quetes.unite.part': '{v}%',
  'quetes.unite.vaincu': 'defeated',
  'quetes.unite.pasEncore': 'not yet',
  'quetes.unite.points': { one: '{v} point', other: '{v} points' },
  'quetes.unite.cm': { one: '{v} cm', other: '{v} cm' },
  'quetes.unite.salles': { one: 'room {v}', other: 'room {v}' },
  'quetes.unite.niveau': { one: 'level {v}', other: 'level {v}' },
  'quetes.unite.coups': { one: '{v} move', other: '{v} moves' },
  'quetes.unite.victoires': { one: '{v} win', other: '{v} wins' },
  'quetes.unite.epreuves': { one: '{v} trial', other: '{v} trials' },
  // (le mot seul, après un nombre : « record battu : 640 cm »)
  'quetes.uniteMot.points': 'points',
  'quetes.uniteMot.temps': 'time',
  'quetes.uniteMot.épreuves': 'trials',
  'quetes.uniteMot.coups': 'moves',
  'quetes.uniteMot.victoires': 'wins',
  'quetes.uniteMot.salles': 'rooms',
  'quetes.uniteMot.niveau': 'level',

  // ── L'avancement ──
  'quetes.ligne.vaincu': 'defeated',
  'quetes.ligne.pasVaincu': 'not defeated yet this week',
  'quetes.ligne.pasVaincuSignature': 'not defeated yet since signing',
  'quetes.ligne.pasDeResultat': 'no result yet this week',
  'quetes.ligne.pasDeResultatSignature': 'no result yet since signing',
  'quetes.ligne.meilleur': 'your best this week: {v}',
  'quetes.ligne.meilleurSignature': 'your best since signing: {v}',
  'quetes.ligne.meilleurUnite': 'your best this week: {v} {unite}',
  'quetes.ligne.meilleurUniteSignature': 'your best since signing: {v} {unite}',
  'quetes.ligne.recordBattu': 'record beaten: {v} {unite}',
  'quetes.ligne.pasBattu': 'not beaten yet this week',
  'quetes.ligne.pasBattuSignature': 'not beaten yet since signing',
  'quetes.ligne.pariPlace': 'Prunostic placed',
  'quetes.ligne.pasDePari': 'no Prunostic yet',
  'quetes.ligne.jours': { one: '{valeur} / {n} day', other: '{valeur} / {n} days' },
  'quetes.ligne.jeux': '{valeur} / {cible} games',

  // ── Les lignes des quêtes taillées ──
  'quetes.detail.persoFacile': '{nom} · your usual level ({jours} days played)',
  'quetes.detail.persoMoyenne': '{nom} · your good days (median: {mediane})',
  'quetes.detail.persoDifficile': '{nom} · your record of the last few weeks',
  'quetes.detail.part': '{nom} · reached by {part} of the park',
  'quetes.detail.niveauFacile': '{nom} · your usual score',
  'quetes.detail.niveauMoyenne': '{nom} · your good days',
  'quetes.detail.niveauDifficile': '{nom} · on a par with your best days',
  'quetes.detail.borne.max': '{nom} · the most a single game allows',
  'quetes.detail.borne.record': '{nom} · the park record',
  'quetes.detail.corrigee.max': '{nom} · the most a single game allows (target corrected)',
  'quetes.detail.corrigee.record': '{nom} · the park record (target corrected)',
  'quetes.detail.doigtTenant': 'Finger challenge · on a phone or tablet — the park record is {record} ({tenant})',
  'quetes.detail.doigt': 'Finger challenge · on a phone or tablet — the park record is {record}',
  'quetes.detail.defi': '{nom} · a challenge from Gromelin',
  'quetes.titre.recordPlus': 'Beat your record at {groupe}: more than {seuil}',
  'quetes.titre.recordMoins': 'Beat your record at {groupe}: under {seuil}',

  // ── La découverte et les premiers pas ──
  'quetes.decouverte.titre': 'Discover {groupe}: play {nombre} games',
  'quetes.decouverte.detail': 'Discovery · {groupe} — a game you haven\'t played these past weeks',
  'quetes.pas.pas-forum.titre': 'Write your first message on the forum',
  'quetes.pas.pas-forum.detail': 'First steps · a topic or a reply, wherever you like',
  'quetes.pas.pas-prunostic.titre': 'Place a Prunostic of at least {mise} kikooz',
  'quetes.pas.pas-prunostic.detail': 'First steps · on a tournament match or on tomorrow\'s Challenge',
  'quetes.pas.pas-jeux.titre': 'Play three different games in the Challenge',
  'quetes.pas.pas-jeux.detail': 'First steps · a score in three Challenge games',

  // ── La vie du parc et les exploits (PARC) ──
  'quetes.parc.parc-forum.titre': 'Reply to three messages on the forum',
  'quetes.parc.parc-forum.detail': 'Park life · three replies, in the topics of your choice',
  'quetes.parc.parc-sujet.titre': 'Start a new topic on the forum',
  'quetes.parc.parc-sujet.detail': 'Park life · a question, an idea, the story of a game…',
  'quetes.parc.parc-salons.titre': 'Chat in the chat rooms: fifteen messages',
  'quetes.parc.parc-salons.detail': 'Park life · in the chat room of your choice',
  'quetes.parc.parc-prunostics.titre': 'Place two Prunostics',
  'quetes.parc.parc-prunostics.detail': 'Park life · on a tournament match or on tomorrow\'s Challenge',
  'quetes.parc.parc-assidu.titre': 'Play the Challenge four days this week',
  'quetes.parc.parc-assidu.detail': 'Park life · one score in the day is enough',
  'quetes.parc.exploit-podium.titre': 'Get on a Challenge podium',
  'quetes.parc.exploit-podium.detail': 'Feat · a gold, silver or bronze medal, awarded when the day changes',
  'quetes.parc.exploit-question.titre': 'Win a 60-kikooz Question',
  'quetes.parc.exploit-question.detail': 'Feat · every evening at 7 pm, in the chat rooms',
  'quetes.parc.exploit-vers.titre': 'Beat your record at worm throwing',
  'quetes.parc.exploit-vers.detail': 'Feat · Kaluga, Olympic event',
  'quetes.parc.exploit-grenouille.titre': 'Beat your record at the frog race',
  'quetes.parc.exploit-grenouille.detail': 'Feat · Kaluga, Olympic event',

  // ── Les bricoles de Gromelin ──
  'quetes.gromelin.grom-salons.titre': 'Chat in the chat rooms: five messages',
  'quetes.gromelin.grom-salons.detail': 'An odd job from Gromelin · in the chat room of your choice',
  'quetes.gromelin.grom-forum.titre': 'Write a message on the forum',
  'quetes.gromelin.grom-forum.detail': 'An odd job from Gromelin · a topic or a reply, wherever you like',
  'quetes.gromelin.grom-prunostic.titre': 'Place a Prunostic',
  'quetes.gromelin.grom-prunostic.detail': 'An odd job from Gromelin · on a tournament match or on tomorrow\'s Challenge',
  'quetes.gromelin.grom-challenge.titre': 'Get a score in the Challenge',
  'quetes.gromelin.grom-challenge.detail': 'An odd job from Gromelin · any game, one ranked score is enough',
  'quetes.gromelin.grom-deux-jeux.titre': 'Play two different games in the Challenge',
  'quetes.gromelin.grom-deux-jeux.detail': 'An odd job from Gromelin · a score in two Challenge games',
  'quetes.gromelin.grom-course.titre': 'Run a Burning Kiwi race',
  'quetes.gromelin.grom-course.detail': 'An odd job from Gromelin · in the Challenge or online',
  'quetes.gromelin.grom-swapou.titre': 'Play a game of Swapou',
  'quetes.gromelin.grom-swapou.detail': 'An odd job from Gromelin · in the Challenge',

  // ── Le catalogue (les quêtes hors mesure) ──
  'quetes.catalogue.vers-record.titre': 'Beat your record at worm throwing',
  'quetes.catalogue.vers-record.detail': 'Kaluga, Olympic event',
  'quetes.catalogue.grenouille-record.titre': 'Beat your record at the frog race',
  'quetes.catalogue.grenouille-record.detail': 'Kaluga, Olympic event',
  'quetes.catalogue.kiloute.titre': 'Win a 60-kikooz Question',
  'quetes.catalogue.kiloute.detail': 'Every evening at 7 pm, in the chat rooms',
  'quetes.catalogue.medaille.titre': 'Get on a Challenge podium',
  'quetes.catalogue.medaille.detail': 'A gold, silver or bronze medal, awarded when the day changes',
};

// ── Les mesures (MESURES, quetes.js) : titre, ligne de détail, nom ──
const mesure = (cle, nom, titre, detail) => {
  d[`quetes.mesure.${cle}.nom`] = nom;
  d[`quetes.mesure.${cle}.titre`] = titre;
  d[`quetes.mesure.${cle}.detail`] = detail;
};
mesure('swapou-challenge', 'Challenge: points', 'Score over {seuil} at Swapou', 'In the Challenge');
mesure('swapou-classique', 'Classic: points', 'Score {seuil} in classic Swapou', 'Classic mode');
mesure('snake-challenge', 'Challenge: points', 'Score {seuil} at Frutisnake', 'In the Challenge');
mesure('kaluga-grappe', 'Challenge (cluster): points', 'Score {seuil} at Kaluga', 'In the Challenge, with a cluster of 8 fruits or more');
mesure('kaluga-freestyle', 'Challenge (freestyle): points', 'Score {seuil} at Kaluga in freestyle', 'In the Challenge, without a big cluster');
['easy', 'standard', 'hard', 'infernal'].forEach((n, i) => {
  mesure('kaluga-chrono' + i, `${n} Chrono: time`, `Finish the ${n} Chrono in under {seuil}`, 'Kaluga, Olympic mode');
  mesure('kaluga-survie' + i, `${n} Survival: time held`, `Hold {seuil} in ${n} Survival`, 'Kaluga, Olympic mode');
  mesure('kaluga-invasion' + i, `${n} Invasion: time held`, `Hold {seuil} in ${n} Invasion`, 'Kaluga, Olympic mode');
  mesure('kaluga-piste' + i, `${n} Track: time`, `Lap the ${n} Track in under {seuil}`, 'Kaluga, Olympic mode');
});
['easy', 'medium', 'hard'].forEach((n, i) => {
  mesure('kaluga-defi' + i, `${n} Trial: time`, `Pass the ${n} trial in under {seuil}`, 'Kaluga, Trials mode');
});
// Les épreuves olympiques de Kaluga (KALUGA_EPREUVES, même ordre).
['worm throwing', 'dexteripomme', 'squirrel throwing', 'worm planting', 'ant throwing', 'plantapomme', 'frog race']
  .forEach((nom, i) => {
    mesure('kaluga-epreuve' + i, `Olympic, ${nom}: distance`, `Get {seuil} at ${nom}`, 'Kaluga, Olympic event');
  });
mesure('kaluga-triathlon', 'Triathlon: points', 'Score {seuil} in the triathlon', 'Kaluga, Olympic mode');
mesure('kaluga-heptathlon', 'Heptathlon: points', 'Score {seuil} in the heptathlon', 'Kaluga, Olympic mode');
mesure('mb2-challenge-salles', 'Challenge: rooms explored', 'Explore {seuil} of the MotionBall Challenge rooms', 'In the daily Challenge');
mesure('mb2-challenge-boss', 'Challenge: octopus defeated', 'Defeat the octopus in the MotionBall Challenge', 'In the daily Challenge');
mesure('mb2-classique', 'Classic: room reached', 'Reach {seuil} in MotionBall Classic', 'Classic mode');
['yellow', 'green', 'red', 'orange', 'blue', 'metal', 'purple'].forEach((coul, i) => {
  mesure('mb2-course' + i, `${coul} race: time`, `Finish the ${coul} race in under {seuil}`, 'MotionBall, Race mode (three laps)');
});
['water', 'fire', 'air', 'earth', 'Tourneboule'].forEach((nom, i) => {
  const donjon = i === 4 ? 'the Tourneboule dungeon' : `the ${nom} dungeon`;
  mesure('mb2-donjon' + i, `Adventure: boss of ${donjon}`, `Defeat the boss of ${donjon}`, 'MotionBall, Adventure mode');
});
['Green Hill', 'Banana Derby', 'Terre Grise', 'Solstice', 'Jupiter IV', 'Mistral Kiwi'].forEach((nom, i) => {
  mesure('bkiwi-circuit' + i, `${nom}: race time`, `Lap ${nom} in under {seuil}`, 'Burning Kiwi, any race mode');
  mesure('bkiwi-doigt' + i, `${nom} by finger: race time`, `Lap ${nom} by finger in under {seuil}`, 'Burning Kiwi by finger, on a phone or tablet');
});
['easy', 'normal', 'hard', 'infernal'].forEach((nom, p) => {
  mesure('minifever-arcade' + p, `${nom} Arcade: trials won`, `Win {seuil} in ${nom} arcade`, 'Mini-Fever, arcade mode');
});
mesure('minifever-fever', 'Fever: trials in a row', 'Chain {seuil} in fever mode', 'Mini-Fever, fever mode');
for (let k = 1; k <= 7; k++) {
  mesure('jamajama-tournoi' + k, `Tournament, level ${k}: moves`, `Solve level ${k} of the tournament in {seuil} at most`, 'JamaJama, tournament');
}
mesure('minipixiz-arbre', 'Hollow tree: points', 'Score {seuil} in the hollow tree', 'MiniPixiz, in the Challenge');
mesure('miniwave-challenge', 'Challenge: points', 'Score {seuil} in the MiniWave Challenge', 'MiniWave, in the Challenge');
mesure('miniwave-niveau', 'Challenge: level reached', 'Reach {seuil} in the MiniWave Challenge', 'MiniWave, in the Challenge');
mesure('grapiz-serie', 'Challenge: wins in a row', 'Chain {seuil} in a row in the Grapiz Challenge', 'Grapiz, in the Challenge');
mesure('bandas-serie', 'Challenge: wins in a row', 'Chain {seuil} in a row in the Frutibandas Challenge', 'Frutibandas, in the Challenge');

// Un nom de mesure commence par une majuscule (« Easy Chrono: time »).
for (const k of Object.keys(d)) {
  if (/^quetes\.mesure\..*\.nom$/.test(k)) d[k] = d[k].charAt(0).toUpperCase() + d[k].slice(1);
}

module.exports = d;
