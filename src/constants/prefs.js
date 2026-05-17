// User preference definitions.
//
// Wire format: id (2 base62) + type (1 char) + nameLen (2 base62) + name
//            + defaultLen (2 base62) + defaultValue
// Types: 'i' = int (base62-encoded), 'b' = boolean ('Y'/'N'), 's' = string.
const { encode62, decode62 } = require('../util/base62');

const prefDefs = [
  { id: 1,  type: 'i', name: 'default_channel',          def: encode62(2) },
  { id: 2,  type: 'b', name: 'dsp_newmail_alert',        def: 'Y' },
  { id: 3,  type: 'i', name: 'invite_channel_behavior',  def: encode62(1) },
  { id: 4,  type: 'i', name: 'invite_chat_behavior',     def: encode62(1) },
  { id: 5,  type: 's', name: 'wallpaper',                def: '' },
  { id: 6,  type: 'i', name: 'cache_length',             def: encode62(30) },
  { id: 7,  type: 'b', name: 'cl_open',                  def: 'Y' },
  { id: 8,  type: 'b', name: 'win_flMoveAnim',           def: 'Y' },
  { id: 9,  type: 'b', name: 'ch_dsp_h',                 def: 'Y' },
  { id: 10, type: 'b', name: 'ch_dsp_join',              def: 'Y' },
  { id: 11, type: 'b', name: 'ch_dsp_part',              def: 'Y' },
  { id: 12, type: 'b', name: 'ch_dsp_kick',              def: 'Y' },
  { id: 13, type: 'b', name: 'ch_dsp_ban',               def: 'Y' },
];

function buildPrefDefString() {
  let r = '';
  for (const p of prefDefs) {
    r += encode62(p.id, 2);
    r += p.type;
    r += encode62(p.name.length, 2) + p.name;
    r += encode62(p.def.length, 2) + p.def;
  }
  return r;
}

function parsePrefString(str) {
  const result = {};
  let pos = 0;
  while (pos + 4 <= str.length) {
    const id = decode62(str.substring(pos, pos + 2));
    const len = decode62(str.substring(pos + 2, pos + 4));
    const val = str.substring(pos + 4, pos + 4 + len);
    pos += 4 + len;
    result[id] = val;
  }
  return result;
}

function encodePrefString(parsed) {
  let r = '';
  for (const [id, val] of Object.entries(parsed)) {
    const v = String(val);
    r += encode62(Number(id), 2) + encode62(v.length, 2) + v;
  }
  return r;
}

module.exports = {
  prefDefs,
  buildPrefDefString,
  parsePrefString,
  encodePrefString,
};
