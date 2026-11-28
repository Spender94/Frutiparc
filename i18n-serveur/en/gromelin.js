'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — GROMELIN, le ronchon de Légumia : ses
 * passages au chat (gromelinVisit, server.js) et ses répliques dans la
 * fenêtre des quêtes (PAROLES, quetes.js — `gromelin.parole.<clé>.<rang>`,
 * le rang de la réplique française). En anglais, il reste bougon : des
 * phrases courtes, sèches, et son « Grumpf » qui ne se traduit pas.
 *
 * Les titres de quêtes ({titre}) et les noms de jeux ({nom}) arrivent tels
 * que l'appelant les donne (échappés pour la fenêtre des quêtes).
 */
const quetes = (n) => `${n} quest${Number(n) === 1 ? '' : 's'}`;

module.exports = {
  // ── Au chat : quand il n'a rien à confier, il ronchonne ──
  'gromelin.ronchon.0': 'Grumpf',
  'gromelin.ronchon.1': 'Hmmmph, still people hanging around in here?',
  'gromelin.ronchon.2': 'Don\'t you lot have anything better to do than loaf about on this shabby site?',
  'gromelin.ronchon.3': 'Go on, shoo! Some of us have work to do.',
  'gromelin.ronchon.4': 'It\'s a lot quieter back in Légumia...',
  // ── Au chat : la bricole confiée à quelqu'un du salon ──
  'gromelin.bricole.0': 'Grumpf.',
  'gromelin.bricole.1': '{nom}. Yes, you. Come here.',
  'gromelin.bricole.2': 'I\'ve got a little job for you: “{titre}”. {gain} kikooz if it\'s done before Sunday midnight.',
  'gromelin.bricole.3': 'It\'s in your quest log, {nom}. Don\'t make me regret it.',

  // ── La fenêtre des quêtes ──
  'gromelin.parole.semaine.0': (p) => `<em>Grumpf.</em> You again? Fine. New week, new quests: ${p.n}, not one more. Now get moving.`,
  'gromelin.parole.semaine.1': (p) => `Monday. I hate Mondays. Here, your ${quetes(p.n)} for the week. Don't dawdle.`,
  'gromelin.parole.semaine.2': (p) => `<em>Grumpf.</em> You look well rested. That won't last: ${quetes(p.n)} waiting for you. Sunday midnight, final deadline.`,
  'gromelin.parole.faite.0': '“{titre}”: done. Not bad, for a Frutiz. <em>{gain} kikooz</em>, as agreed.',
  'gromelin.parole.faite.1': '“{titre}”? Done. I\'d have done it better, but whatever. <em>{gain} kikooz</em> for you.',
  'gromelin.parole.faite.2': 'Right. “{titre}”, sorted. Here are your <em>{gain} kikooz</em>. Don\'t spend them all in one place.',
  'gromelin.parole.reste.0': (p) => `You've got ${quetes(p.reste)} left. <em>Sunday midnight</em>, not a minute more.`,
  'gromelin.parole.reste.1': (p) => `${quetes(p.reste)} to go. What are you waiting for? For me to do them for you?`,
  'gromelin.parole.reste.2': (p) => `<em>Grumpf.</em> ${quetes(p.reste)} still to do. Time's ticking, and I've got better things to do.`,
  'gromelin.parole.fini.0': 'All done. I\'ve got nothing left for you. <em>Come back Monday.</em> Grumpf.',
  'gromelin.parole.fini.1': 'Everything\'s ticked off. Don\'t think I\'m impressed. <em>Come back Monday.</em>',
  'gromelin.parole.rien.0': 'No quests this week. Enjoy it, it won\'t last.',
  'gromelin.parole.semainePerso.0': (p) => `Monday. I went through your scores, <em>grumpf</em>. Here are ${quetes(p.n)} cut to fit you: not too hard, not too easy. Get to work.`,
  'gromelin.parole.semainePerso.1': (p) => `<em>Grumpf.</em> I looked at what you're really worth. ${quetes(p.n)} your size this week. No excuses.`,
  'gromelin.parole.semainePerso.2': (p) => `New week. ${quetes(p.n)}, made to measure from your own scores. Don't let me down.`,
  'gromelin.parole.inconnu.0': 'I don\'t know you yet. Play the <em>Challenge</em> for a few days, and next Monday I\'ll cut your quests to fit your own scores.',
  'gromelin.parole.echange.0': 'Fine. Since you insist: “{titre}” instead. And that\'s the last time this week.',
  'gromelin.parole.echange.1': '<em>Grumpf.</em> Swapped. “{titre}”, and no complaints.',
  'gromelin.parole.prime.0': 'You play so well, don\'t you: the <em>{nom}</em> record belongs to {tenant}. Beat it, and I\'ll pay you <em>{gain} kikooz</em>.',
  'gromelin.parole.bricole.0': 'In the chat room, I gave you a little job: “{titre}”. <em>{gain} kikooz</em> if it\'s done before Sunday midnight. Don\'t dawdle.',
  'gromelin.parole.bricole.1': '<em>Grumpf.</em> Remember that little job? “{titre}”. <em>{gain} kikooz</em>, Sunday midnight is the deadline.',
  'gromelin.parole.contrat.0': 'And for you, I\'ve drawn up a <em>contract</em>. Cut to fit your own scores, not anyone else\'s. Pick one, sign, and get to work.',
  'gromelin.parole.contrat.1': 'I looked at your scores. <em>Grumpf.</em> I\'ve drawn up three contracts your size. Just one: you sign it, and then we never speak of it again.',
  'gromelin.parole.contratSigne.0': 'Signed. I\'ll keep it safe. Only results <em>from now on</em> count, so off you go.',
};
