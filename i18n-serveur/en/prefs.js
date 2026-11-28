'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES PRÉFÉRENCES, telles que la fenêtre
 * « Mes préférences » du light les lit (/api/light/prefs) : les libellés et
 * descriptions (`prefs.<nom>.label|desc`, PREF_LABELS dans server.js), les
 * choix (`prefs.<nom>.choix.<valeur>`), les catégories (`prefs.categorie.<nom
 * sans accents>`, PREF_CATEGORIES) et les dix-sept feutres d'époque
 * (`prefs.feutre.<index>`, NOMS_FEUTRES). Le formulaire du bureau Flash
 * (/do/prefForm) reste en français, comme le SWF.
 *
 * Les noms des salons restent tels quels (des noms de lieux du parc) ; « Au
 * hasard » et « Aucun salon » se traduisent.
 */
module.exports = {
  // ── Les catégories ──
  'prefs.categorie.general': 'General',
  'prefs.categorie.chat': 'Chat',
  'prefs.categorie.mail': 'Mail',
  'prefs.categorie.invitations': 'Invitations',
  'prefs.categorie.forum': 'Forum',
  'prefs.categorie.mentions': 'Mentions',
  'prefs.categorie.apparence': 'Appearance',

  // ── Les préférences ──
  'prefs.default_channel.label': 'Default chat room',
  'prefs.default_channel.desc': 'The chat room that opens by itself when you log in.',
  'prefs.default_channel.choix.0': 'At random',
  'prefs.default_channel.choix.13': 'No chat room',
  'prefs.dsp_newmail_alert.label': 'New mail alert',
  'prefs.dsp_newmail_alert.desc': 'Show an alert when a new mail arrives.',
  'prefs.invite_channel_behavior.label': 'Chat room invitation',
  'prefs.invite_channel_behavior.desc': 'What to do when you get an invitation to a chat room.',
  'prefs.invite_chat_behavior.label': 'Private chat invitation',
  'prefs.invite_chat_behavior.desc': 'What to do when you get an invitation to a private chat.',
  'prefs.wallpaper.label': 'Wallpaper',
  'prefs.wallpaper.desc': 'Name of the wallpaper used on the desktop.',
  'prefs.default_accessory.label': 'Default accessory',
  'prefs.default_accessory.desc': 'The accessory your bouille wears by default: put on the desktop when you log in, '
    + 'and already picked when you open a forum message. You can still change it whenever you like — '
    + 'that doesn\'t touch the default.',
  'prefs.cache_length.label': 'Cache duration',
  'prefs.cache_length.desc': 'Number of days files are kept.',
  'prefs.cl_open.label': 'Open the contact list',
  'prefs.cl_open.desc': 'Open the contact list automatically at startup.',
  'prefs.win_flMoveAnim.label': 'Window animations',
  'prefs.win_flMoveAnim.desc': 'Animate windows when they move.',
  'prefs.ch_dsp_h.label': 'Show the time',
  'prefs.ch_dsp_h.desc': 'Show the time in front of each chat message.',
  'prefs.ch_dsp_join.label': 'Show arrivals',
  'prefs.ch_dsp_join.desc': 'Show a message when someone joins the chat room.',
  'prefs.ch_dsp_leave.label': 'Show departures',
  'prefs.ch_dsp_leave.desc': 'Show a message when someone leaves the chat room.',
  'prefs.ch_dsp_kick.label': 'Show kicks',
  'prefs.ch_dsp_kick.desc': 'Show a message when someone is kicked out.',
  'prefs.ch_dsp_ban.label': 'Show bans',
  'prefs.ch_dsp_ban.desc': 'Show a message when someone is banned.',
  'prefs.forum_notify.label': 'Forum notifications',
  'prefs.forum_notify.desc': 'When to tell you about a new forum message — the shortcut\'s light and a notification on your phone.',
  'prefs.forum_notify.choix.1': 'For every topic',
  'prefs.forum_notify.choix.2': 'Only the topics I follow (❤)',
  'prefs.forum_notify.choix.0': 'Never',
  'prefs.mention_chat.label': 'Mentions in chat rooms',
  'prefs.mention_chat.desc': 'Get told when someone writes “@your username” in a public chat room: '
    + 'the conversation tab blinks, and your phone rings if you\'re away.',
  'prefs.default_pen.label': 'Default pen',
  'prefs.default_pen.desc': 'The pen already picked when you arrive in the chat rooms: your messages are written '
    + 'in its colour without picking it again. You can still change it for a conversation — '
    + 'the default stays put.',
  'prefs.mention_forum.label': 'Mentions on the forum',
  'prefs.mention_forum.desc': 'Get told when someone mentions you in a forum message: '
    + 'the shortcut\'s light, a line in your history, and a notification on your phone.',

  // ── Les invitations (INVITE_MODES, les mêmes pour les salons et le chat privé) ──
  ...Object.fromEntries([
    'Always accept',
    'Accept, refuse my unwanted contacts',
    'Accept, ask me for my unwanted contacts',
    'Always ask me',
    'Ask me, refuse my unwanted contacts',
    'Ask me, accept my contacts',
    'Always refuse',
    'Refuse, accept my contacts',
    'Refuse, ask me for my contacts',
  ].flatMap((texte, v) => [
    ['prefs.invite_channel_behavior.choix.' + v, texte],
    ['prefs.invite_chat_behavior.choix.' + v, texte],
  ])),

  // ── Les feutres (le pot de feutres du light, par index) ──
  'prefs.feutre.aucun': 'No pen',
  'prefs.feutre.multicolore': 'Rainbow',
  'prefs.feutre.0': 'Orange',
  'prefs.feutre.1': 'Blue',
  'prefs.feutre.2': 'Dark green',
  'prefs.feutre.3': 'Burgundy',
  'prefs.feutre.4': 'Pink',
  'prefs.feutre.5': 'Yellow',
  'prefs.feutre.6': 'Light green',
  'prefs.feutre.7': 'Cyan',
  'prefs.feutre.8': 'Dark blue',
  'prefs.feutre.9': 'Brown',
  'prefs.feutre.10': 'Dark brown',
  'prefs.feutre.11': 'Khaki green',
  'prefs.feutre.12': 'Petrol blue',
  'prefs.feutre.13': 'Green',
  'prefs.feutre.14': 'Dark petrol blue',
  'prefs.feutre.15': 'Dark orange',
  'prefs.feutre.16': 'Purple',
};
