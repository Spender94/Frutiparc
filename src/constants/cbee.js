// CBee XMLSocket protocol — command name ↔ wire code mappings.
// Sourced from cmdList.as / cmdList2.as in the AS2 client.
const CMD = {
  // Global
  error:       'a',
  serviceinfo: 'b',
  time:        'c',
  ip:          'd',
  ping:        'e',
  ident:       'k',
  // FrutiChat
  kick:             'l',
  ban:              'm',
  unban:            'n',
  join:             'o',
  userlist:         'p',
  channellist:      'q',
  createchannel:    'r',
  invitechat:       's',
  send:             't',
  userleaved:       'u',
  userjoined:       'v',
  channelclosed:    'w',
  refuse:           'x',
  part:             'y',
  trace:            'z',
  stoptrace:        'aa',
  invite:           'ab',
  givexp:           'ac',
  stealxp:          'ad',
  fbouille:         'ae',
  status:           'af',
  onkick:           'ag',
  onban:            'ah',
  onunban:          'ai',
  tracecallback:    'aj',
  invisible:        'ak',
  xpreceived:       'al',
  xpstolen:         'am',
  topic:            'an',
  bannedusers:      'ao',
  adminsend:        'ap',
  userinfo:         'aq',
  listbouilles:     'ar',
  addmoderator:     'as',
  delmoderator:     'at',
  changebg:         'au',
  activatefeat:     'av',
  newuserlog:       'aw',
  newmail:          'ax',
  newforummsg:      'ay',
  newsitelog:       'bl',
  mute:             'az',
  unmute:           'ba',
  onmute:           'bb',
  endmute:          'bc',
  xpflag:           'bg',
  senduserongroup:  'bk',
  awardgame:        'ha',
  awarduser:        'hb',
  xpposition:       'bm',
  searchuser:       'bn',
  callmoderator:    'bo',
  moderatorcalled:  'bp',
  // FrutiCard (slot storage)
  fcardgetpublicslot: 'ea',
  fcardlistslots:     'eb',
  fcardloadslot:      'ec',
  fcardupdateslot:    'ed',
  fcardclearslot:     'ee',
  fcardlist:          'ef',
  statusobj:          'statusobj',
};

// Reverse lookup: wire code → command name.
const CMD_REV = {};
for (const [name, code] of Object.entries(CMD)) {
  CMD_REV[code] = name;
}
// Frusion games use FrutiCard tags fa-fe (offset from main client's ea-ee).
CMD_REV['fa'] = 'fcardgetpublicslot';
CMD_REV['fb'] = 'fcardlistslots';
CMD_REV['fc'] = 'fcardloadslot';
CMD_REV['fd'] = 'fcardupdateslot';
CMD_REV['fe'] = 'fcardclearslot';

// Virtual users (PNJ) that are always considered "connected" on the
// welcome channel and exposed in userlist broadcasts.
const CONNECTED_NPCS = new Set(['gaspard']);

module.exports = { CMD, CMD_REV, CONNECTED_NPCS };
