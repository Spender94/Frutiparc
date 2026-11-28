'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — MIKEHORNY (le compte `kiloute79`),
 * l'animateur de la Question à 60 kikooz et des quiz (kilouteRun,
 * kilouteStartSession… dans server.js). En français, un animateur de jeu
 * télé qui s'emballe (« Bonsoiiiir les Frutiz ! ») ; en anglais aussi : le
 * présentateur de quiz du samedi soir, pas une traduction mot à mot.
 *
 * `kiloute.<banque>.<rang>` : la phrase du même rang dans la banque française
 * (intro, preambule, transition, bravo, gain, tropTard, bonsoir). {anim} est
 * son pseudo affiché ; {r} et {nom} (le quiz) arrivent dans la langue du
 * lecteur (`kiloute.libre`).
 */
module.exports = {
  // Ce que l'admin a écrit (énoncé, réponse, nom du quiz) : son anglais quand
  // il y en a un, le français sinon.
  'kiloute.libre': (p) => (p.en ? p.en : p.fr),

  // ── Les banques ──
  'kiloute.intro.0': 'Good eveniiiing, Frutiz! {anim} is here for a very special BIG QUIZ!',
  'kiloute.intro.1': 'Hello, everybody! It\'s {anim}, and it\'s QUIZ TIME!',
  'kiloute.intro.2': 'Ears open wide, Frutiz: {anim} is kicking off his BIG QUIZ!',
  'kiloute.intro.3': 'Hey there, champions! {anim} is here for one crazy quiz!',
  'kiloute.intro.4': 'Hello, Fruti-family! {anim} here, ready to get those brains sizzling!',
  'kiloute.intro.5': 'Drumroll, please! {anim} has cooked up a quiz just for you!',
  'kiloute.intro.6': 'Make yourselves comfortable: {anim} is opening the doors to his big quiz!',
  'kiloute.intro.7': 'It\'s the event of the day, folks: {anim}\'s big quiz is starting!',

  'kiloute.preambule.0': 'Question {n} of {t} — {r} kikooz up for grabs!',
  'kiloute.preambule.1': 'Here we go, question {n}! {r} kikooz for the fastest finger!',
  'kiloute.preambule.2': 'On to question {n} of {t}. {r} kikooz on the line!',
  'kiloute.preambule.3': 'Here comes question number {n}! {r} kikooz at stake!',
  'kiloute.preambule.4': 'Question {n}... fingers at the ready! {r} kikooz to snap up!',
  'kiloute.preambule.5': 'And... go! It\'s question {n} of {t}! {r} kikooz are waiting for a winner.',
  'kiloute.preambule.6': 'Number {n} of {t}, get ready: {r} kikooz on the table!',
  'kiloute.preambule.7': 'And here\'s question number {n}! Still {r} kikooz for whoever gets it first.',

  'kiloute.transition.0': 'Take a moment to catch your breath...',
  'kiloute.transition.1': 'Deep breath before the next one.',
  'kiloute.transition.2': 'Quick break, then we carry on, nice and easy.',
  'kiloute.transition.3': 'There we go... let it settle, the next one\'s coming.',
  'kiloute.transition.4': 'Relax, no rush, the next one\'s coming up soon.',
  'kiloute.transition.5': 'Nice one, everybody! We\'ll keep going at your pace.',
  'kiloute.transition.6': 'Let me give you a little second to think...',
  'kiloute.transition.7': 'Breathe out, stretch... and off we go again, gently.',
  'kiloute.transition.8': 'Don\'t panic, we\'ve got all the time in the world!',
  'kiloute.transition.9': 'What an atmosphere! Let\'s savour it for a moment, then carry on.',
  'kiloute.transition.10': 'Come on, no rushing: the next one\'s on its way.',
  'kiloute.transition.11': 'Calmly, serenely... over to the next one.',
  'kiloute.transition.12': 'Keep smiling, the next question is coming.',
  'kiloute.transition.13': 'A little breather... and hop, on we go, gently.',

  'kiloute.bravo.0': 'Stoooop! Bravooo {w}!!! The answer was indeed: {r}.',
  'kiloute.bravo.1': 'And it\'s {w} who\'s quickest on the draw! It was: {r}. Magnificent!',
  'kiloute.bravo.2': 'Yesss! {w} nailed it: {r}! What instinct!',
  'kiloute.bravo.3': 'Excellent, {w}! {r}, of course! You\'re on fire!',
  'kiloute.bravo.4': 'Well played, {w}! The right answer was {r}. Everyone else, hang in there!',
  'kiloute.bravo.5': 'Unbeatable, {w}! {r}, that was it! Hats off!',
  'kiloute.bravo.6': 'Boom! {w} gets it: {r}! A masterpiece!',
  'kiloute.bravo.7': 'Perfect, {w}! {r}, without a moment\'s hesitation! Take a bow!',
  'kiloute.bravo.8': 'Bang on, {w}! The answer was indeed {r}.',
  'kiloute.bravo.9': 'Lightning fast, {w}! {r}, and it\'s all correct!',

  'kiloute.gain.0': { one: '+{kz} kikooz for {w}! ({n} right answer for {w})', other: '+{kz} kikooz for {w}! ({n} right answers for {w})' },
  'kiloute.gain.1': 'And hop, {kz} kikooz drop into {w}\'s pocket!',
  'kiloute.gain.2': { one: '{kz} kikooz for {w}, already {n} right answer on the board!', other: '{kz} kikooz for {w}, already {n} right answers on the board!' },
  'kiloute.gain.3': 'There you go, {kz} well-earned kikooz for {w}!',
  'kiloute.gain.4': 'Ka-ching! {kz} kikooz for {w} (total: {n} right)!',
  'kiloute.gain.5': '{w} pockets {kz} more kikooz! Keep it up!',
  'kiloute.gain.6': '{kz} more kikooz for {w}! The jackpot keeps growing!',

  'kiloute.tropTard.0': 'Too late! The answer was: {r}. Nobody scores on this one!',
  'kiloute.tropTard.1': 'Oh, nobody?! Shame... it was {r}. We\'ll make up for it on the next one!',
  'kiloute.tropTard.2': 'Time\'s up! The answer was {r}. Don\'t panic, we\'re carrying on!',
  'kiloute.tropTard.3': 'Ouch, that one got you! It was {r}. Come on, the next one\'s yours!',
  'kiloute.tropTard.4': 'Bzzzt! Time\'s up. The answer: {r}. Better luck next time!',
  'kiloute.tropTard.5': 'Nobody this time... it was {r}. Back to it, nice and easy!',
  'kiloute.tropTard.6': 'Nope! The answer was {r}. No matter, we\'ve got all the time in the world for the next one.',

  'kiloute.bonsoir.0': 'Good eveniiiing, Frutiz! {anim} is in the house!',
  'kiloute.bonsoir.1': 'Hey hey, Frutiz! {anim} is here with his famous question!',
  'kiloute.bonsoir.2': 'Hello everyone! {anim} is popping in to say hi!',
  'kiloute.bonsoir.3': 'It\'s me, {anim}! Ready for tonight\'s big date?',
  'kiloute.bonsoir.4': 'Good evening, Fruti-family! {anim} at your service for the question of the day!',

  // ── La Question à 60 kikooz du soir ──
  'kiloute.soir.annonce': 'It\'s time for your favourite show: THE 60 KIKOOZ QUESTION!',
  'kiloute.soir.regle': 'The first one to give the right answer scoops the 60 kikooz! Are you ready?!',
  'kiloute.soir.attention': 'So listen carefully, here\'s the question:',
  'kiloute.soir.personne': 'Oh? Nobody? Really?! What a letdown!',
  'kiloute.soir.reponse': 'The right answer was {r}.',
  'kiloute.soir.aDemain': 'See you tomorrow for another 60 Kikooz Question — don\'t miss it!',
  'kiloute.stop': 'Stoooooooooooop!',
  'kiloute.merciSoir': 'Thanks for playing, everyone, you\'re fantastic! See you tomorrow at 7pm for another 60 Kikooz Question!',

  // ── Le quiz ──
  'kiloute.quiz.annonce': {
    one: 'Today\'s quiz is “{nom}”: {n} question, and {kz} kikooz per right answer!',
    other: 'Today\'s quiz is “{nom}”: {n} questions, and {kz} kikooz per right answer!',
  },
  'kiloute.quiz.regle': 'The first one to give the right answer takes the prize. Get ready...',
  'kiloute.quiz.parti': 'Here we gooo!',
  'kiloute.quiz.fin': 'And that\'s the end of our big quiz! What an atmosphere!',
  'kiloute.quiz.personne': 'Nobody scored this time... next time for sure, I just know it!',
  'kiloute.quiz.classement': 'Here are the rankings for this quiz:',
  'kiloute.quiz.podium': { one: '{medaille} {nom} — {kz} kikooz ({n} right answer)', other: '{medaille} {nom} — {kz} kikooz ({n} right answers)' },
  'kiloute.quiz.bravo': 'A huge round of applause for {nom}, the big winner of this quiz!',
  'kiloute.quiz.merci': 'Thank you all for playing, you\'re fantastic! See you very soon!',
  'kiloute.quiz.stop': 'The quiz ends here! Thanks for playing, everyone, see you very soon!',
};
