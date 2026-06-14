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

// Parse pipe field 17 into [{ $name?, $level, … }].
//   legacy court : "50,50,32,"                    → [{$level}]
//   legacy nommé : "Danicie:50,Gamedea:50,"        → [{$name,$level}]
//   RICHE (nouveau patch) : chaque fée porte tout son état, en champs séparés
//   par ":" et tableaux joints par "~" (les fées restent séparées par ","):
//     name:level:humor:exp:hunger:moral:bagMax:shot:life:mana:mission:pos
//       :carac~:skin~:next~:inv~:spell~:spellCoef~:mood~:behaviour~:tasteLikes~:tasteDislikes~
// Un token à ≤ 2 segments ":" reste interprété comme legacy (rétro-compat avec
// les SWF en cache). Un nom manquant/"undefined"/"null" désactive l'identité
// pour ce token (fallback index dans mergeFaerieByIdentity), sans perdre le
// reste de l'état riche.
function parseFaerieField(part) {
  const toks = String(part == null ? '' : part).replace(/,$/, '').split(',').filter(v => v !== '');
  return toks.map(parseFaerieToken);
}

function parseFaerieToken(tok) {
  const parts = String(tok == null ? '' : tok).split(':');
  // ── Legacy (inchangé) ──
  if (parts.length <= 2) {
    if (parts.length === 1) return { $level: Number(parts[0]) || 0 };
    const name = parts[0];
    const lvl = Number(parts[1]) || 0;
    if (name === '' || name === 'undefined' || name === 'null') return { $level: lvl };
    return { $name: name, $level: lvl };
  }
  // ── Riche ──
  const num0 = (i) => { const n = Number(parts[i]); return Number.isFinite(n) ? n : 0; };
  // null légitime ($mission/$pos : "" → null), sinon nombre.
  const numN = (i) => {
    const v = parts[i];
    if (v === undefined || v === '' || v === 'null' || v === 'undefined') return null;
    const n = Number(v); return Number.isFinite(n) ? n : null;
  };
  // tableau "a~b~c" → [a,b,c] ; "" → [] ; trou ("a~~c") → null (sac) ou 0.
  const arr = (i, allowNull) => {
    const v = parts[i];
    if (v === undefined || v === '') return [];
    return v.split('~').map((t) => {
      if (t === '' || t === 'null' || t === 'undefined') return allowNull ? null : 0;
      const n = Number(t); return Number.isFinite(n) ? n : (allowNull ? null : 0);
    });
  };
  const f = {};
  const name = parts[0];
  if (name !== '' && name !== 'undefined' && name !== 'null') f.$name = name;
  f.$level = num0(1);
  if (parts.length > 2)  f.$humor   = num0(2);
  if (parts.length > 3)  f.$exp     = num0(3);   // float toléré (Number)
  if (parts.length > 4)  f.$hunger  = num0(4);
  if (parts.length > 5)  f.$moral   = num0(5);
  if (parts.length > 6)  f.$bagMax  = num0(6);
  if (parts.length > 7)  f.$shot    = num0(7);
  if (parts.length > 8)  f.$life    = num0(8);
  if (parts.length > 9)  f.$mana    = num0(9);
  if (parts.length > 10) f.$mission = numN(10);
  if (parts.length > 11) f.$pos     = numN(11);
  if (parts.length > 12) f.$carac     = arr(12, false);
  if (parts.length > 13) f.$skin      = arr(13, false);
  if (parts.length > 14) f.$next      = arr(14, false);
  if (parts.length > 15) f.$inv       = arr(15, true);
  if (parts.length > 16) f.$spell     = arr(16, false);
  if (parts.length > 17) f.$spellCoef = arr(17, false);
  if (parts.length > 18) f.$mood      = arr(18, false);
  if (parts.length > 19) f.$behaviour = arr(19, false);
  if (parts.length > 20) f.$taste     = [arr(20, false), arr(21, false)];
  return f;
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

// ── Synthèse des fées-stubs ──────────────────────────────────────────────
// Les fées écloses à l'ère du pipe n'ont jamais eu d'état riche côté serveur
// ({$name,$level} pour toujours). En jeu, ça donne : portrait qui cycle
// entre des skins aléatoires ($skin manquant), stats fausses ($carac),
// cases d'équipement absentes ($inv), fée immobile dans un coin
// ($behaviour/$mood), nourrissage cassé ($taste). On complète ici chaque
// champ manquant avec les défauts de Cm.genFaerieSeed (le créateur officiel,
// Games/miniTroll/src/Cm.mt), en DÉTERMINISTE à partir du nom : la même fée
// retrouve le même corps et les mêmes couleurs à chaque chargement.
function faerieNameHash(name) {
  let h = 5381;
  const s = String(name == null ? '' : name);
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function synthesizeFaerieDefaults(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  const h = faerieNameHash(f.$name);
  let changed = false;
  function miss(k) { return f[k] === undefined || f[k] === null; }
  function set(k, v) { if (miss(k)) { f[k] = v; changed = true; } }

  // $pos : null est une VALEUR légitime (« en main ») — on ne touche qu'à
  // undefined. Idem $mission (null = pas de mission en cours).
  if (f.$pos === undefined) { f.$pos = null; changed = true; }
  if (f.$mission === undefined) { f.$mission = null; changed = true; }

  set('$level', 0);
  set('$humor', h % 8);
  set('$exp', 0);
  set('$bagMax', 2);
  set('$hunger', 4);
  set('$moral', 10);
  set('$shot', 0);
  if (!Array.isArray(f.$carac) || f.$carac.length < 6) {
    f.$carac = [1, 1, 1, 1, 1, 1];
    changed = true;
  }
  if (!Array.isArray(f.$skin) || f.$skin.length < 4) {
    // [corps 0-5, 3 couleurs 24 bits] — multiplicateurs de Knuth pour des
    // couleurs stables et bien dispersées par nom.
    f.$skin = [
      h % 6,
      (Math.imul(h, 2654435761) >>> 8) % 0xFFFFFF,
      (Math.imul(h ^ 0x9e3779b9, 40503) >>> 4) % 0xFFFFFF,
      (Math.imul(h + 0x85ebca6b, 2246822519) >>> 6) % 0xFFFFFF,
    ];
    changed = true;
  }
  if (!Array.isArray(f.$mood)) { f.$mood = []; changed = true; }
  if (!Array.isArray(f.$next) || f.$next.length < 2) {
    // état pré-setNextLevelUp d'un seed neuf (légitime dans le jeu)
    f.$next = [0, 0];
    changed = true;
  }
  if (!Array.isArray(f.$spell)) { f.$spell = [20, 0]; changed = true; }
  if (!Array.isArray(f.$spellCoef)) { f.$spellCoef = []; changed = true; }
  if (!Array.isArray(f.$behaviour)) { f.$behaviour = []; changed = true; }
  if (!Array.isArray(f.$inv)) { f.$inv = []; changed = true; }
  if (!Array.isArray(f.$taste) || f.$taste.length < 2) {
    // 1 goût + 1 dégoût distincts, ids d'aliments 0..9 (it.Food)
    const like = h % 10;
    const dislike = (like + 1 + ((h >>> 4) % 9)) % 10;
    f.$taste = [[like], [dislike]];
    changed = true;
  }
  // $life/$mana dérivés des carac (genFaerieSeed) — on ne RÉGÉNÈRE que si la
  // valeur est absente/illisible. 0 est LÉGITIME (fée morte de faim, cf.
  // FaerieInfo « est morte de faim dans son bocal ») et doit être CONSERVÉ —
  // sinon une fée morte « ressuscite » au rechargement.
  if (typeof f.$life !== 'number' || Number.isNaN(f.$life)) {
    f.$life = Math.max(1, Math.ceil(Number(f.$carac[2]) || 1));
    changed = true;
  }
  if (typeof f.$mana !== 'number' || Number.isNaN(f.$mana)) {
    f.$mana = (Number(f.$carac[5]) || 1) * 2;
    changed = true;
  }
  return changed;
}

module.exports = { faerieIsRich, parseFaerieField, mergeFaerieByIdentity, synthesizeFaerieDefaults, faerieNameHash };
