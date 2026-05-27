'use strict';

// MiniPixiz fairy-array save logic, extracted so it can be unit-tested in
// isolation (the save path has historically lost fairy progress, so this is
// the one piece that most needs a test harness).
//
// Background: the SWF save format (patch-minipixiz-client.js field 17) is
// LOSSY. It transports only each fairy's $level (legacy) or "$name:$level"
// (new format). Every rich field — skin, spells, carac, inv, taste, humor,
// exp, life, mana, hunger, moral, mission, behaviour, mood, next, spellCoef,
// bagMax, shot, pos — lives only in the previously-stored slot. Each save we
// must graft those rich fields back on. Doing that by ARRAY INDEX is the bug:
// when the in-game fairy order differs from the stored order (a fairy freed,
// reordered, or a Ruffle glitch), index i pairs the wrong rich data with the
// wrong fairy, producing "a fairy turned into a copy of another" / "a fairy's
// stats reset". Matching by $name fixes that.

// A fairy object is "rich" if it carries any field beyond the two the pipe can
// transport ($level and $name). Rich = real game state worth preserving.
function faerieIsRich(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  for (const k in f) {
    if (k === '$level' || k === '$name') continue;
    if (Object.prototype.hasOwnProperty.call(f, k)) return true;
  }
  return false;
}

// Parse pipe field 17 into [{ $name?, $level }].
//   new format: "Danicie:50,Gamedea:50,Pigone:32,"
//   legacy:     "50,50,32,"
// Trailing comma tolerated. A token whose name is missing/"undefined"/"null"
// (a Ruffle AMF-desync edge) is treated as level-only — that way a single bad
// name disables identity matching for the whole save and we fall back to the
// long-standing index behaviour instead of mis-grafting.
function parseFaerieField(part) {
  const toks = String(part == null ? '' : part).replace(/,$/, '').split(',').filter(v => v !== '');
  return toks.map(tok => {
    const ci = tok.indexOf(':');
    if (ci < 0) return { $level: Number(tok) || 0 };
    const name = tok.slice(0, ci);
    const lvl = Number(tok.slice(ci + 1)) || 0;
    if (name === '' || name === 'undefined' || name === 'null') return { $level: lvl };
    return { $name: name, $level: lvl };
  });
}

// Merge the previously-stored fairy array (prev, rich) with the array from a
// fresh pipe save (next, typically {$name,$level} or {$level} stubs).
//
// Guarantees:
//   • No fairy is ever dropped — every prev fairy and every next fairy is
//     represented in the output exactly once (so a Ruffle glitch that omits a
//     fairy, or a freed fairy, never silently erases progress).
//   • No fairy's rich data is paired with a different fairy.
//
// Identity path (used only when EVERY next fairy and at least one prev fairy
// carry a real $name): match by name, grafting prev's rich fields onto the
// matching next fairy; $level (and any other field the pipe now sends) wins
// from next. Prev fairies absent from next are appended unchanged.
//
// Otherwise: the exact legacy index merge, byte-for-byte equivalent to the old
// inline behaviour, so saves from old/cached SWFs keep working identically.
function mergeFaerieByIdentity(prev, next) {
  const pf = Array.isArray(prev) ? prev : [];
  const nf = Array.isArray(next) ? next : [];
  if (nf.length === 0) return pf; // empty/glitched save → never wipe fairies
  if (pf.length === 0) return nf;

  const isObj = f => f && typeof f === 'object' && !Array.isArray(f);
  const hasName = f => isObj(f) && typeof f.$name === 'string' && f.$name !== '';
  const nextNamed = nf.every(hasName);
  const prevNamed = pf.some(hasName);

  if (nextNamed && prevNamed) {
    const prevByName = new Map();
    for (const p of pf) if (hasName(p) && !prevByName.has(p.$name)) prevByName.set(p.$name, p);
    const matched = new Set();
    const out = nf.map(n => {
      const p = prevByName.get(n.$name);
      if (p && !matched.has(n.$name)) { matched.add(n.$name); return Object.assign({}, p, n); }
      return n; // genuinely new fairy (no prev) — rich data fills in on later saves
    });
    for (const p of pf) if (hasName(p) && !matched.has(p.$name)) out.push(p);
    return out;
  }

  // Legacy index merge (unchanged behaviour).
  if (pf.length > nf.length) return pf;
  const out = [];
  for (let i = 0; i < nf.length; i++) {
    const p = pf[i], n = nf[i];
    if (isObj(p) && isObj(n)) out.push(Object.assign({}, p, n));
    else out.push(n || p);
  }
  return out;
}

module.exports = { faerieIsRich, parseFaerieField, mergeFaerieByIdentity };
