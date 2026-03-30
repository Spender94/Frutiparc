const { decode62 } = require('./feString');
const { encode62 } = require('./feNumber');

/**
 * Runtime JS mirror for Lot A follow-up StatusMng.
 */
class StatusMng {
  static externalList = [undefined, 'eat', 'work', 'zzz', 'phone', 'away'];

  static internalList = [undefined, 'forum', 'bkiwi', 'mb2', 'swapou2', 'snake3', 'bandas', 'grapiz', 'kaluga', 'miniwave'];

  static analyseStr(str) {
    let iExt = decode62(str.substr(0, 1));
    iExt = Number.isNaN(iExt) ? 0 : iExt;

    let iInt = decode62(str.substr(1, 2));
    iInt = Number.isNaN(iInt) ? 0 : iInt;

    let iEmote = decode62(str.substr(3, 1));
    iEmote = Number.isNaN(iEmote) ? 0 : iEmote;

    return {
      external: StatusMng.externalList[iExt],
      internal: StatusMng.internalList[iInt],
      emote: iEmote,
    };
  }

  constructor() {
    this.external = 0;
    this.internal = 0;
    this.emote = 0;
    this.cnx = undefined;
    this.last = undefined;
  }

  setExternal(name) {
    this.external = 0;
    for (let i = 0; i < StatusMng.externalList.length; i += 1) {
      if (StatusMng.externalList[i] === name) {
        this.external = i;
        break;
      }
    }
    this.send();
  }

  setInternal(name) {
    const idx = StatusMng.internalList.indexOf(name);
    this.internal = idx < 0 ? 0 : idx;
    this.send();
  }

  unsetInternal(name) {
    const idx = StatusMng.internalList.indexOf(name);
    if (this.internal === idx) {
      this.internal = 0;
      this.send();
    }
  }

  setEmote(eId) {
    const parsed = Number(eId);
    if (Number.isNaN(parsed)) return;

    this.emote = parsed;
    this.send();
  }

  setCnx(cnx) {
    this.cnx = cnx;
  }

  send() {
    const str = encode62(this.external, 1) + encode62(this.internal, 2) + encode62(this.emote, 0);
    if (str === this.last) return false;

    if (this.cnx && typeof this.cnx.cmd === 'function') {
      this.cnx.cmd('status', { s: str });
    }
    this.last = str;
    return true;
  }
}

module.exports = {
  StatusMng,
};
