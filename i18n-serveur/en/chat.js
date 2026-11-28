'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LE CHAT : les lignes système, les réponses
 * aux commandes, les émotes, la page des logs. Le français est écrit dans
 * server.js, là où la phrase part (t(lang, 'chat.…', 'le français', …)) ; ici,
 * l'anglais seul. Une clé absente retombe sur le français. Voir docs/I18N.md,
 * « Côté serveur ».
 *
 * Ce que les joueurs et l'équipe tapent (messages, cri rouge, annonces,
 * questions de quiz, sujets) ne passe jamais par ici.
 *
 * Gabarits « HTML » (signalés) : leurs paramètres arrivent déjà échappés et
 * habillés (<b>…</b>) ; le texte du gabarit lui-même ne doit contenir ni « < »,
 * ni « & ».
 *
 * Le glossaire : frutiz, kikooz, totoche restent ; salon → chat room ;
 * pseudo → username.
 */
module.exports = {
  // ── Modération ──
  'chat.totoche': '{nom} has been totoched',
  'chat.modo.appel': '{nom} says there\'s trouble in this chat room!',
  'chat.modo.salonsPublics': 'This is only available in public chat rooms.',
  'chat.modo.dejaPresents': 'One or more moderators are already in this chat room.',
  'chat.modo.dejaPrevenus': 'You\'ve just alerted the moderators!',

  // ── Messages privés (/!) et invitations ──
  'chat.chucho.dejaPrive': '/! is for chat rooms: this conversation is already private.',
  'chat.chucho.syntaxe': 'Syntax: /! username message — only that frutiz, in this chat room, will see it.',
  'chat.chucho.absent': 'That frutiz isn\'t in this chat room.',
  'chat.chucho.absentNom': '{nom} isn\'t in this chat room: /! only talks to someone who\'s here.',
  'chat.chucho.soiMeme': 'You can\'t send a private message to yourself.',
  'chat.chucho.loupGarou': 'No private messages during a werewolf game: everyone has to hear the same thing.',
  'chat.chucho.cadence': 'Easy there: too many private messages in a row, wait a few seconds.',
  // (HTML : {nom} arrive en gras)
  'chat.chucho.de': '(from {nom})',
  'chat.chucho.a': '(to {nom})',
  'chat.prive.ferme': '{nom} isn\'t taking private messages right now.',
  'chat.invite.syntaxe': 'Syntax: /invite username — they get an invitation to join this chat room.',
  'chat.invite.inconnu': 'No frutiz is called {nom}.',
  'chat.invite.dejaLa': '{nom} is already in this chat room.',
  'chat.invite.impossible': 'Couldn\'t send the invitation.',
  'chat.invite.refusee': '{nom} turned down the invitation to join this chat room',
  'chat.invite.horsLigne': '{nom} isn\'t online: the invitation won\'t reach them.',
  'chat.invite.envoyee': 'Invitation sent to {nom}.',

  // ── /ignore ──
  'chat.ignore.syntaxeRelire': 'Syntax: /unignore username',
  'chat.ignore.syntaxe': 'Syntax: /ignore username — or just /ignore for the list.',
  'chat.ignore.liste': 'You\'re ignoring in the chat rooms: {noms} (your blacklist). /unignore username to read someone again.',
  'chat.ignore.personne': 'You\'re not ignoring anyone. /ignore username to stop seeing someone\'s messages in the chat rooms.',
  'chat.frutizInconnu': 'No frutiz is called “{nom}”.',
  'chat.ignore.soiMeme': 'You can\'t ignore yourself.',
  'chat.ignore.relu': 'You\'re no longer ignoring {nom}: their messages in the chat rooms reach you again, and {nom} leaves your blacklist.',
  'chat.ignore.pasIgnore': 'You weren\'t ignoring {nom}.',
  'chat.ignore.moderateur': '{nom} is a moderator: their messages always get through.',
  'chat.ignore.deja': 'You\'re already ignoring {nom}. /unignore {nom} to read them again.',
  'chat.ignore.ignore': 'You\'re now ignoring {nom}: you won\'t see their messages in the chat rooms any more. '
    + '{nom} also joins your blacklist (invitations and private chats turned down, mail goes to Junk). '
    + '/unignore {nom} to undo.',

  // ── Commandes diverses ──
  'chat.commandeInconnue': 'Unknown command.',
  'chat.utilisateurIntrouvable': 'User not found.',
  'chat.image.syntaxe': 'Syntax: /image width height url title',
  'chat.bleu.active': 'Blue mode on.',
  'chat.bleu.desactive': 'Blue mode off.',
  'chat.tous.cadence': 'Only one @all per minute per chat room: this one goes out as an ordinary message.',
  'chat.sujet.reserve': 'Only the chat room\'s team can change its topic.',
  'chat.sujet.tropLong': 'The topic is too long ({max} characters max).',
  'chat.statut.inconnu': 'Unknown status. Values: away, phone, zzz, work, eat — or off to clear it.',
  'chat.statut.active': 'Status “{statut}” on.',
  'chat.statut.efface': 'Status cleared — back online.',
  'chat.multicolore.pasPossede': 'You don\'t own the Rainbow felt pen yet. You can buy it in the Shop, under Felt pens!',
  'chat.multicolore.active': 'Rainbow felt pen on — your messages show up in colour! (type /multipen off to stop)',
  'chat.multicolore.desactive': 'Rainbow felt pen off.',
  'chat.stats.titre': '--- Stats for chat room {salon} ---',
  'chat.stats.connectes': 'Users online: {n}',
  'chat.stats.liste': 'List: {noms}',
  'chat.stats.sujet': 'Topic: {sujet}',
  'chat.stats.sansSujet': '(no topic)',
  'chat.logs.lien': '... see previous messages ...',
  // (HTML : {lien} arrive tout fait)
  'chat.logs.duSalon': 'Chat room logs: {lien}',

  // ── Le dé (HTML : {qui} et {tire} arrivent en rouge gras) ──
  'chat.de': '{qui} rolls a die (1–{faces}): {tire}',
  'chat.de.syntaxe': 'Syntax: /d6, /d20… (from 1 to 1000).',

  // ── /aide ──
  'chat.aide.titre': 'Chat commands:',
  'chat.aide.logs': '/log, /logs, /chatlog or /chatlogs — the chat room logs (its messages from the last 24 hours)',
  'chat.aide.chucho': '/! username message — a message only that frutiz (in this chat room) will see; nothing in the logs',
  'chat.aide.invite': '/invite username — invite them to this chat room (for a private room: create it, then invite)',
  'chat.aide.ignore': '/ignore username — stop seeing their messages in the chat rooms (they join your blacklist); just /ignore: the list',
  'chat.aide.unignore': '/unignore username — read them again',
  'chat.aide.donne': '/give kikooz username [message] — give kikooz',
  'chat.aide.image': '/image width height address title — show a picture to the chat room',
  'chat.aide.de': '/d6, /d20… — roll a die in front of the whole chat room',
  'chat.aide.statut': '/status away, phone, zzz, work, eat or off — your status dot',
  'chat.aide.stats': '/stats — the chat room stats',
  'chat.aide.loupGarou': '/lg help — the werewolf game, when one is on',
  'chat.aide.equipe': 'Chat room team: !message (red shout), /kick username, /topic text, @all',

  // ── Animation : quiz, sondages, blindtest, dons ──
  'chat.quiz.lance': 'Quiz started by {nom}!',
  'chat.quiz.lanceQuestion': 'Quiz started by {nom}: {question}',
  'chat.quiz.syntaxePoint': 'Syntax: /point username [points] — for example /point Toto 3, or /point Toto -2 to take some away ({max} max per command).',
  'chat.quiz.points': { one: '{signe}{n} point for {nom} (total: {total})', other: '{signe}{n} points for {nom} (total: {total})' },
  'chat.quiz.aucunPoint': 'No points handed out.',
  'chat.quiz.classementTitre': 'Rankings',
  'chat.quiz.classementQuestion': 'Rankings — {question}',
  'chat.quiz.classementFinal': 'Quiz over! Final rankings:',
  'chat.quiz.ligneClassement': { one: '{rang}. {nom} — {pts} pt', other: '{rang}. {nom} — {pts} pts' },
  'chat.sondage.syntaxe': 'Syntax: /poll Question? | Option A | Option B | …   (2 to 6 answers). /pollend to close it.',
  'chat.sondage.deuxReponses': 'You need a question and at least two answers: /poll Question? | Answer A | Answer B',
  'chat.blind.aide1': 'Blindtest — /blind <YouTube link> [start] [duration]',
  'chat.blind.aide2': 'Example: /blind https://youtu.be/dQw4w9WgXcQ 1:02 20',
  'chat.blind.aide3': 'The start is read from the link if you don\'t give one; the duration is {n} s by default.',
  'chat.blind.aide4': '/blindstop stops the clip.',
  'chat.blind.lienInconnu': 'YouTube link not recognised. Paste the video\'s address, or its ID.',
  'chat.blind.lance': 'Blindtest! {nom} plays a {duree}-second clip.',
  'chat.blind.arrete': 'Blindtest: clip stopped.',
  'chat.dons.entete': 'My gifts — I have {reste} kikooz left out of {total} this week',
  'chat.dons.ligne': '{quand} — {nom}: {n} kikooz',
  'chat.dons.ligneMotif': '{quand} — {nom}: {n} kikooz ({motif})',
  'chat.dons.aucun': 'No gifts recorded yet.',
  'chat.don.usage': 'Usage: /don <username> <amount> — you have {reste} kikooz left to hand out this week.',
  'chat.don.introuvable': 'Player not found (they must be online).',
  'chat.don.montantInvalide': 'Invalid amount.',
  'chat.don.soiMeme': 'You can\'t give kikooz to yourself.',
  'chat.don.quota': 'Weekly quota exceeded: you have {reste} kikooz left to hand out this week.',
  // (la ligne bleue de l'animateur : « Kiwi : offre 5 kikooz à Bob ! »)
  'chat.don.annonce': 'gives {n} kikooz to {nom}!',

  // ── Les émotes : la phrase, après le pseudo (« Kiwi bursts out laughing ») ──
  'chat.emote.rire': 'laughs',
  'chat.emote.mdr': 'bursts out laughing',
  'chat.emote.langue': 'sticks out their tongue',
  'chat.emote.rougir': 'blushes',
  'chat.emote.regard': 'looks away',
  'chat.emote.sifflote': 'whistles',
  'chat.emote.gum': 'blows a bubble-gum bubble',
  'chat.emote.question': 'wonders',
  'chat.emote.miam': 'tucks in',
  'chat.emote.pleurer': 'cries',
  'chat.emote.larme': 'sheds a tear',
  'chat.emote.beurk': 'feels sick',
  'chat.emote.jutsu': 'chocapic no jutsu',
  'chat.emote.tousse': 'coughs',
  'chat.emote.gumm': 'gets it all over their face',
  'chat.emote.clin': 'winks',
  'chat.emote.bisou': 'blows a kiss',
  'chat.emote.sixsept': 'does six-seveeen',
  'chat.emote.assomme': 'is dazed',

  // ── La page des logs (/api/chat/histo) ──
  'chat.logs.sessionInconnue': 'Unknown session.',
  'chat.logs.salonInconnu': 'Unknown chat room.',
  'chat.logs.reserve': 'Only the people in this conversation can read it.',
  'chat.logs.titre': 'Chat room {salon} — previous messages',
  // (HTML : {salon} arrive habillé)
  'chat.logs.bandeau': 'Chat room {salon} — messages from the last 24 hours',
  'chat.logs.compte': {
    one: '{n} message — the chat room\'s memory, open to every Frutiz. Times are chat times.',
    other: '{n} messages — the chat room\'s memory, open to every Frutiz. Times are chat times.',
  },
  'chat.logs.vide': 'No messages in this chat room for 24 hours.',
  'chat.logs.fermer': 'Close',
  'chat.logs.fermerLogs': 'Close the logs',
  'chat.logs.fermerEchap': 'Close (Esc)',
  'chat.logs.image': '[image]',
  'chat.logs.don': '[gift] {n} kikooz to {nom}',
  'chat.logs.auteur': '{nom}:',
};
