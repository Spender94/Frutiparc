/**
 * Runtime JS mirror for Lot A target FEString (subset).
 */

function replace(str, search, repl) {
  if (search.length === 0) return str;
  return str.split(search).join(repl);
}

function decode62(n) {
  let r = 0;
  let coef = 1;
  for (let i = n.length - 1; i >= 0; i -= 1) {
    const c = n.substr(i, 1);
    let t;
    if (c.toLowerCase() === c) {
      t = Number.parseInt(c, 36);
    } else {
      t = Number.parseInt(c.toLowerCase(), 36) + 26;
    }
    r += t * coef;
    coef *= 62;
  }
  return r;
}

function unHTML(r) {
  if (r.length <= 0) return r;
  return replace(replace(replace(r, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
}

function rmChr(r, aChar) {
  if (r.length <= 0) return r;
  return replace(r, aChar, '');
}

function ltrim(str) {
  let i = 0;
  while (i < str.length && (str.substr(i, 1) === ' ' || str.substr(i, 1) === String.fromCharCode(13))) i += 1;
  return str.substring(i);
}

function rtrim(str) {
  let i = str.length - 1;
  while (i >= 0 && (str.substr(i, 1) === ' ' || str.substr(i, 1) === String.fromCharCode(13))) i -= 1;
  return str.substr(0, i + 1);
}

function trim(str) {
  return ltrim(rtrim(str));
}

function repeat(str, l) {
  let r = '';
  for (let i = 0; i < l; i += 1) r += str;
  return r;
}

function countUpperCase(str) {
  let count = 0;
  for (let i = 0; i < str.length; i += 1) {
    const t = str.substr(i, 1);
    if (t !== t.toLowerCase()) count += 1;
  }
  return count;
}

function startsWith(str1, str2) {
  return str1.substr(0, str2.length) === str2;
}

function endsWith(str1, str2) {
  return str1.substr(str1.length - str2.length) === str2;
}

function checkRepeat(str, max) {
  if (str.length === 0) return false;
  let last = str.charAt(0);
  let nb = 1;
  for (let i = 1; i < str.length; i += 1) {
    const j = str.charAt(i);
    if (j === last) nb += 1;
    else {
      nb = 1;
      last = j;
    }
    if (nb > max) return true;
  }
  return false;
}

function replaceBackSlashN(r) {
  return replace(r, '\\n', '\n');
}


function formatVars(str, obj) {
  let pos = str.indexOf('$');
  while (pos > -1) {
    const n = str.substr(pos + 1, 1);
    if (n === '$') {
      str = `${str.substr(0, pos)}$${str.substring(pos + 2, str.length)}`;
      pos = str.indexOf('$', pos + 2);
    } else {
      const r = obj[n];
      str = `${str.substr(0, pos)}${r}${str.substring(pos + 2, str.length)}`;
      pos = str.indexOf('$', pos + String(r).length);
    }
  }
  return str;
}

module.exports = {
  replace,
  decode62,
  unHTML,
  rmChr,
  ltrim,
  rtrim,
  trim,
  repeat,
  countUpperCase,
  startsWith,
  endsWith,
  checkRepeat,
  replaceBackSlashN,
  formatVars,
};
