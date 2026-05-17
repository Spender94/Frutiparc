// Motion-Twin 2004 serialization format used by the AS2 profile viewer
// (MTSerialization.unserialize) and several FrutiCard payloads.
//
// Wire format:
//   N<num>           number
//   S<str>           string
//   B0 / B1          boolean
//   U                undefined / null
//   [a;b;c;]         array
//   {k1:v1;k2:v2;}   object

function jsonToMTSerial(jsonStr) {
  let obj;
  if (typeof jsonStr === 'string') {
    try { obj = JSON.parse(jsonStr); } catch { return jsonStr; }
  } else {
    obj = jsonStr;
  }

  function ser(val) {
    if (val === null || val === undefined) return 'U';
    if (val === true) return 'B1';
    if (val === false) return 'B0';
    if (typeof val === 'number') return `N${val}`;
    if (typeof val === 'string') return `S${val}`;
    if (Array.isArray(val)) {
      let r = '[';
      for (let i = 0; i < val.length; i++) {
        r += ser(val[i]) + ';';
      }
      r += ']';
      return r;
    }
    if (typeof val === 'object') {
      let r = '{';
      for (const key of Object.keys(val)) {
        r += key + ':' + ser(val[key]) + ';';
      }
      r += '}';
      return r;
    }
    return 'U';
  }

  return ser(obj);
}

// Parse a serialised MT array: "[Sfoo;N12;B1;]" → ["foo", 12, true]
function parseMtSerializedArray(raw) {
  const s = String(raw || '').trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  const items = [];
  const body = s.slice(1, -1);
  const tokenRe = /([SNB])([^;]*);/g;
  let m;
  while ((m = tokenRe.exec(body)) !== null) {
    const ty = m[1];
    const payload = m[2] || '';
    if (ty === 'N') {
      const n = Number(payload);
      items.push(Number.isFinite(n) ? n : 0);
    } else if (ty === 'B') {
      items.push(payload === '1' || /^true$/i.test(payload));
    } else {
      items.push(payload);
    }
  }
  return items.length > 0 ? items : null;
}

// Parse a single MT primitive: "Sfoo" → "foo", "N42" → 42.
function parseMtSerializedPrimitive(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const strMatch = s.match(/^S([^;]*)$/);
  if (strMatch) return strMatch[1];
  const numMatch = s.match(/^N(-?\d+(?:\.\d+)?)$/);
  if (numMatch) return Number(numMatch[1]);
  return null;
}

module.exports = {
  jsonToMTSerial,
  parseMtSerializedArray,
  parseMtSerializedPrimitive,
};
