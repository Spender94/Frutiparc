'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — GASPARD, l'hôte du parc, au chat
 * (gaspard.js pour ce qu'il sait, gaspardEcoute / gaspardAccueillir dans
 * server.js). En français, il tutoie et rend service ; en anglais aussi :
 * un hôte serviable et enjoué, pas une notice traduite mot à mot.
 *
 * Les noms du parc restent : kikooz, bouille, frutibouille, frutisign,
 * totoche, FD, les jeux, les personnages, les rubriques du forum, les noms
 * des salons (Pomme…) et des articles de la boutique (« Son temps viendra »).
 * Les libellés de l'interface sont ceux du site en anglais (« My discs »,
 * « Settings → Default felt pen »…).
 *
 * `gaspard.reponse.<clé>` : une réponse de la base (BASE, même clé) ;
 * `gaspard.rubrique` : une rubrique de l'aide, dans sa version anglaise quand
 * l'admin lui en a donné une (titreEn / corpsEn), en français sinon.
 */
const THEMES = 'kikooz, XP and the login streak, the Challenge and its medals, quests, Prunostics, the shop and the inventory, every game in the park, the chat rooms and their commands, private messages and mail, the forum, moderation, events';

module.exports = {
  // ── Ce qui entoure les réponses ──
  'gaspard.mention': '@{nom} {reponse}',
  'gaspard.rubrique': (p) => `${p.titreEn || p.titre} — ${p.corpsEn || p.corps} (more in the help: the Gaspard icon)`,
  'gaspard.politesse.bonjour': 'Hi {nom}! Ask me anything about the park and I\'ll do my best — for example "@Gaspard how do I earn kikooz?".',
  'gaspard.politesse.merci': 'My pleasure, {nom}! I\'m right here if you have more questions.',
  'gaspard.rienEcoute': 'I\'m listening, {nom}: ask your question after "@Gaspard". I know about ' + THEMES + '.',
  'gaspard.rien': 'Sorry {nom}, I didn\'t get that. I know about ' + THEMES + ' — or open the full help: the Gaspard icon on the home screen.',

  // ── La fenêtre d'aide sans page d'index (/fh/get) ──
  'gaspard.aideIndex': 'Help index',
  'gaspard.aideAccueil': 'Welcome! Pick a topic below, or use the search.',

  // ── La bienvenue d'un nouveau ──
  'gaspard.bienvenue': 'Welcome {nom}! I\'m Gaspard, your host in the park.',
  'gaspard.bienvenueKikooz': {
    one: 'Welcome {nom}! I\'m Gaspard, your host in the park. To get you started, here\'s {n} kikooz as a welcome gift — the local currency.',
    other: 'Welcome {nom}! I\'m Gaspard, your host in the park. To get you started, here are {n} kikooz as a welcome gift — the local currency.',
  },
  'gaspard.reperes': 'A few pointers: the apples at the top are the chat rooms, @username calls out to someone, /help opens the help, and Gromelin\'s quests (from the home screen) earn you kikooz every week.',
  'gaspard.question': 'Got a question? Put @Gaspard in front of it and I\'ll answer in the chat room.',

  // ── La base : une réponse par sujet ──
  'gaspard.reponse.commandes': 'The chat commands: /help (the full list), /log (the chat room logs), /! username message (a note only they will see), /ignore username, /give kikooz username (give kikooz), /status away|phone|zzz|work|eat|off (your status dot), /d6 or /d20 (a die), /stats (the chat room), /lg help (werewolf). And @username to call out to someone — @Gaspard for me!',
  'gaspard.reponse.quetes': 'Every Monday, Gromelin hands you your quests for the week, tailored to the games you play (the Quests tile on the home screen): each quest you finish earns kikooz, and finishing them all gets you an XP bonus. He also drops by the Pomme chat room four times a day to give a little chore to someone who\'s there.',
  'gaspard.reponse.medailles': 'At midnight, the top three of every Challenge ranking get a medal: 15 kikooz for gold, 10 for silver, 5 for bronze. And the top fifteen earn XP by rank, from 2,500 XP for first place down to 100 XP for fifteenth.',
  'gaspard.reponse.parrainage': 'Referrals: when your friend signs up, they type your username in the "Referrer" box. When they reach level 2, you each get 100 kikooz.',
  'gaspard.reponse.kikooz': 'Kikooz are the park\'s currency, and you spend them in the shop. You earn them with the daily login, Challenge medals, Gromelin\'s quests and bounties, the 60 Kikooz Question, Prunostics, referrals, and whatever the hosts hand out. /give number username to give some away.',
  'gaspard.reponse.primes': 'Bounties: every record in the park (in "Quests") carries a bounty that keeps growing as long as the record stands. Beat it by knocking someone else off the top, and Gromelin pays it to you. The records are the ones in the Club\'s record book.',
  'gaspard.reponse.feutres': 'Your felt pen is the colour of your messages: pick it in the chat bar, and the one you start with in Settings → "Default felt pen". The rainbow felt pen, which writes each letter in a different colour, is sold in the shop, in the Felt pens section.',
  'gaspard.reponse.boutique': 'The shop (a tile on the home screen) sorts its items into sections: accessories — including home-made ones, drawn by Frutiz —, incarnations, felt pens, wallpapers, daily passes, game options (Packs) and Decor, where night mode is hiding. Everything is paid in kikooz.',
  'gaspard.reponse.bouille': 'You draw your Frutibouille (face, eyes, mouth, hairstyle, colours) in the "My Frutibouille" editor when you first arrive; to redraw it later, the team can reopen it for you. Day to day, the Inventory dresses it up: accessories and incarnations.',
  'gaspard.reponse.inventaire': 'The Inventory (a tile on the home screen) holds your accessories, incarnations, wallpapers and pictos: tap an accessory to wear it, "Normal" to take it off. The one your bouille wears by default is picked in Settings → "Default accessory".',
  'gaspard.reponse.fonds': 'Wallpapers come from the shop (Wallpapers section), then you put them up from the Inventory, "Wallpapers" tab; "None" brings back the original green.',
  'gaspard.reponse.atelier': 'Home-made accessories are drawn by Frutiz in the variant workshop, then published by the team in the shop\'s "Home-made accessories" section, signed by their creator — who gets 10% of every sale.',
  'gaspard.reponse.frutisnake': 'Frutisnake: your snake eats as much fruit as it can. You can play it in the Challenge, in Battle with several players on one keyboard, and online one-on-one — that\'s the Championship, rated with Elo. The Frutisnake Pack (shop) shows length, dynamite and bonuses during the game.',
  'gaspard.reponse.swapou': 'Swapou: swap two neighbouring fruits to blow up groups of the same colour — and with every move, a new row rises from the bottom. You pick your character — Dimitri, Natacha… — and Challenge mode counts towards the daily ranking.',
  'gaspard.reponse.kaluga': 'Kaluga: your Tzongre (or one of his friends) picks as many apples as possible. In the Challenge there are two boards: Grappe, and Freestyle for games over a thousand points without a grappe.',
  'gaspard.reponse.motionball': 'MotionBall 2: roll your marbles from room to room, all the way to the Challenge\'s terrible octopus. The Challenge map changes every night, and VieuxPruneau posts it on the forum (Jeux Frutiparc).',
  'gaspard.reponse.burningkiwi': 'Burning Kiwi: racing against the clock on six tracks. In the Challenge it\'s the track of the day; in multiplayer, two to four drivers from the park race together online.',
  'gaspard.reponse.grapiz': 'Grapiz: a hexagonal board, for two or more players, online; a token moves as many squares as there are tokens on its line. In the Challenge, your winning streak is what counts; the Championship is played by correspondence, three days per move, rated with Elo.',
  'gaspard.reponse.frutibandas': 'Frutibandas: two players; each turn you push all your fruits one square, with a fruticard to back you up, to push the other side\'s fruits off the board. In the Challenge, your winning streak is what counts; the Championship, between humans, is rated with Elo, live or by correspondence.',
  'gaspard.reponse.miniwave': 'MiniWave: fight off the waves of fruit, in Arcade, Mission, Survival or Letter (where you type each monster\'s letter on the keyboard). In the Challenge, a brand-new forty-level run every day, the same for everyone.',
  'gaspard.reponse.minipixiz': 'MiniPixiz: pieces fall, and four tokens of the same colour that touch disappear — cascades pay off big. Around it, your fairies: they eat, level up, learn spells, and Gromelin can send them on missions.',
  'gaspard.reponse.minifever': 'Mini-Fever: a string of microgames lasting a few seconds each, with the mouse or your finger. It never came out back in the day, it lives again here, and its arcade mode counts in the daily Challenge.',
  'gaspard.reponse.jamajama': 'JamaJama: a puzzle game, move by move, in seven adventure packs, plus the tournament levels, ranked by fewest moves. And you can draw your own levels in its editor.',
  'gaspard.reponse.challenge': 'The daily Challenge ranks the games of each title, and starts over at midnight. In Burning Kiwi, Frutisnake, Swapou, MotionBall and Kaluga, you get two free ranked games (the FDs) per day and per game; each daily pass from the shop adds one more per day, forever. Unranked, you can play as much as you like.',
  'gaspard.reponse.jeux': 'The park\'s games: Burning Kiwi, Frutisnake, Swapou, MotionBall 2, Kaluga, Grapiz, Frutibandas, MiniWave, MiniPixiz, Mini-Fever and JamaJama, all free. Open them from "My discs" on the home screen — and "@Gaspard Kaluga" tells you about one of them.',
  'gaspard.reponse.classements': 'The "Scores" tile shows the rankings: each game\'s daily Challenge, with yesterday\'s podium, and the Championship section, which never resets — kikooz, XP, consecration and the head-to-head championships.',
  'gaspard.reponse.championnat': 'The Championship is rated one-on-one play: in Frutibandas, Grapiz and Frutisnake (online Battle), every game between humans moves your Elo rating up or down. The ratings are in Scores, Championship section, and they never reset.',
  'gaspard.reponse.pictos': 'You earn pictos for feats in the games, and they\'re kept in the Inventory, "Pictos" tab. In the rankings, consecration measures your collection, game by game.',
  'gaspard.reponse.club': 'The Club (from the home screen) keeps each game\'s record book, everyone\'s medals and every Frutiz\'s profile — type a username to see it.',
  'gaspard.reponse.serie': 'Every day you log in: 10 kikooz and 5,000 XP. The 7th day in a row (then the 14th, the 21st…) earns 30 kikooz instead of 10, and at 100 days in a row, once and for all, an accessory is waiting in your inventory. Miss a day, and the streak goes back to 1.',
  'gaspard.reponse.niveau': 'Your level follows your XP. Every day at midnight: 250 XP per chat message (50 messages max), 2,500 for a forum topic (just one), 1,250 per reply (eight max), 1,500 per Challenge ranking where you have a score (ten max), 1,000 per new Prunostic (five max) — and 5,000 XP for your first login of the day. Level N takes (N−1)² × 10,000 XP: 10,000 for level 2, 40,000 for level 3…',
  'gaspard.reponse.salons': 'The public chat rooms are named after fruit — Pomme, Abricot, Poire, Fraise… — and Pomme is the events room. The "Chat rooms" tile on the home screen lists them, and you can create your own, with its topic.',
  'gaspard.reponse.logs': 'To read back through a chat room, type /log, or click "... see previous messages ..." at the top of the thread: the last twenty-four hours are all there.',
  'gaspard.reponse.nuit': 'Night mode is a one-time purchase in the shop, Decor section, under the name "Son temps viendra". You then set it in Settings → "The park at night": Day, Night or "Like my phone", device by device.',
  'gaspard.reponse.frutimail': 'Mail (a tile on the home screen) keeps your Fruti-mails: a letter waits for its recipient even when they\'re offline. To write to someone, use the envelope on their profile.',
  'gaspard.reponse.mp': 'To talk privately: tap their username (in a chat room or the list of who\'s online), then the "Private chat" bubble on their profile. The conversation gets its own tab, which blinks when they answer.',
  'gaspard.reponse.chuchoter': 'In a public chat room, /! username message sends a note that only that Frutiz, who must be in the room, will see — and nothing goes in the logs.',
  'gaspard.reponse.ignorer': '/ignore username: you no longer see their messages in the chat rooms, and they go on your blacklist (private chats and invitations refused, their mail goes to the Junk folder). /ignore on its own shows the list, /unignore username takes them off.',
  'gaspard.reponse.emotes': 'Emotes: type a word like "lol", "haha", ":D", "blush", "wink", "yum", "cry" or ":p" on its own, and your bouille acts it out in front of the whole chat room.',
  'gaspard.reponse.contacts': 'On the desktop, the heart on a Frutiz\'s profile adds them to "My contacts" (you can also drag them there from a chat room); on a phone, your address book shows up in the list of chat rooms.',
  'gaspard.reponse.mentions': 'Write @username in a message to call out to someone: their tab blinks and they get a heads-up, even if they\'re somewhere else on the site. Settings → "Mentions" and "Notifications" let you choose how you want to be told.',
  'gaspard.reponse.forum': 'The forum (the "Forum" tile on the home screen) sorts its topics into boards: announcements, events, games, creations… Start a topic or reply to one — it earns you XP too.',
  'gaspard.reponse.blueon': '/blueon and /blueoff are for the hosts: their messages turn blue. They also run their quizzes, blindtests and polls (/poll) — in a poll, everyone answers with /vote and the number of their choice.',
  'gaspard.reponse.moderation': 'Trouble with someone? /ignore username to stop reading them. On the desktop, every chat room window has an "Alert the moderators" button; they can kick, totoche (mute) or ban, and banned words earn ten minutes of automatic totoche.',
  'gaspard.reponse.statut': 'Your status: /status away, phone, zzz, work or eat swaps your green dot for a little icon; /status off puts it back.',
  'gaspard.reponse.profil': 'Your profile: tap your bouille on the home screen ("View my profile"), then "Edit my profile" — first name, city, occupation, comment… Deleting your account and downloading a copy of your data are at the very bottom of Settings, on the "My data" card.',
  'gaspard.reponse.fiche': 'Tap a username — in a chat room, the list of who\'s online, the scores or the Bouilloscope — to open their profile: Frutiz, Perso, Scores and Bonus tabs, and from there, a private message or a Fruti-mail.',
  'gaspard.reponse.bouilloscope': 'The Bouilloscope (a tile on the home screen) is the Frutiz directory: search for a username, or press "by bouille" to find someone by their face.',
  'gaspard.reponse.animateurs': 'The hosts run the events — quizzes, blindtests, werewolf — and hand out kikooz from their weekly envelope; the 60 Kikooz Question, for its part, drops every evening at 7pm. Announcements are on the forum, in the « Animations officielles » board.',
  'gaspard.reponse.kiloute': 'Every evening at 7pm, MikeHorny comes to the busiest chat room to ask the 60 Kikooz Question: the first one to give the right answer pockets them. You have three minutes.',
  'gaspard.reponse.blindtest': 'The blindtest: a host plays a music clip in the chat room, and everyone hears it at the same time. It\'s up to you to find the title in the chat — the title itself never shows.',
  'gaspard.reponse.loupgarou': 'Werewolf is played in a chat room when a host opens a game: /lg join to sign up (four players minimum), /lg help for the commands. The village votes by day, the wolves prowl by night.',
  'gaspard.reponse.frutisigne': 'M\'dam Irma drops by the chat rooms once an hour to reveal the Frutisign and the rising sign of someone who doesn\'t know them yet. During your sign\'s week you get two extra ranked games per day (in two Challenge games drawn at random), and one on your rising sign\'s day.',
  'gaspard.reponse.motdepasse': 'Forgot your secret code? On the login page, "Forgot your secret code?" sends a link to your account\'s e-mail address, valid for one hour. No e-mail on file? Ask the team.',
  'gaspard.reponse.appli': 'The park installs like an app: on Android, menu ⋮ → "Install app"; on iPhone, in Safari, Share → "Add to Home Screen". Once installed, it can tell you about mail and private messages (Settings → Notifications).',
  'gaspard.reponse.bureau': 'On a big screen, the park opens as a desktop, with its windows just like back in the day; on a phone, in the mobile version. Same account, same chat rooms, same games — and the original Flash version is still there ("Flash version" link on the home page).',
  'gaspard.reponse.prunostic': 'Prunostics: you bet kikooz, the day before, on who\'ll win medals in the next day\'s Challenge, or on tournament matches. All the bets go into the pot, which is shared by those who called it right; every new bet also earns a little XP.',
  'gaspard.reponse.bug': 'Something wrong? Tell us about it on the forum, with what you were doing and on which device: the team reads it. And reloading the page often does the trick.',
};
