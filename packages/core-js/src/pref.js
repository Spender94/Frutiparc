const FEString = require('./feString');
const FENumber = require('./feNumber');
const FEObject = require('./feObject');

/**
 * Runtime JS mirror for Lot A target Pref (core logic only, no HTTP side-effects).
 */
class Pref {
  constructor() {
    this.types = { b: 'bool', i: 'int', s: 'string' };
    this.prefs = {};
    this.prefsId = [];
  }

  onLoadPrefDef(success, data) {
    if (!success) return;
    let str = data.PrefDef;
    while (str.length > 0) {
      const id = FEString.decode62(str.substr(0, 2));
      str = str.substr(2);

      const t = this.types[str.substr(0, 1)];
      str = str.substr(1);

      const l1 = FEString.decode62(str.substr(0, 2));
      const name = str.substr(2, l1);
      str = str.substr(l1 + 2);

      const l2 = FEString.decode62(str.substr(0, 2));
      let defaultValue = str.substr(2, l2);
      str = str.substr(l2 + 2);

      defaultValue = this.convert(defaultValue, t);
      this.prefs[name] = { type: t, default_value: defaultValue, value: defaultValue, id };
      this.prefsId[id] = name;
    }
  }

  useMyPref(str) {
    while (str.length > 0) {
      const id = FEString.decode62(str.substr(0, 2));
      const l = FEString.decode62(str.substr(2, 2));
      let value = str.substr(4, l);
      str = str.substr(l + 4);

      const name = this.prefsId[id];
      const t = this.prefs[name].type;
      value = this.convert(value, t);
      if (value !== undefined) this.prefs[name].value = value;
    }
  }

  getFormatedPref() {
    let r = '';
    for (const n in this.prefs) {
      const o = this.prefs[n];
      if (o.value !== o.default_value) {
        let content;
        switch (o.type) {
          case 'bool':
            content = o.value ? 'Y' : 'N';
            break;
          case 'int':
            content = FENumber.encode62(o.value);
            break;
          case 'string':
          default:
            content = o.value;
            break;
        }
        r += FENumber.encode62(o.id, 2);
        r += `${FENumber.encode62(content.length, 2)}${content}`;
      }
    }
    return r;
  }

  getPref(n) {
    if (n === 'cache_length' && this.prefs[n].value === undefined) return 30;
    return this.prefs[n].value;
  }

  setPref(n, v) {
    this.prefs[n].value = v;
  }

  setFromCopy(nPrefs) {
    for (const n in nPrefs) {
      const u = nPrefs[n];
      const o = this.prefs[u.name];
      if (o === undefined) continue;
      o.value = u.value;
    }
  }

  getACopy() {
    return FEObject.recursiveClone(this.prefs);
  }

  convert(value, t) {
    if (t === 'int') {
      value = FEString.decode62(value);
      if (Number.isNaN(value)) value = undefined;
    } else if (t === 'bool') {
      value = value === 'Y';
    }
    return value;
  }
}

module.exports = {
  Pref,
};
