const { CBee } = require('./cbee');
const { CBeeLC } = require('./cbeeLc');

/**
 * Runtime JS mirror for pragmatic CBeeManager subset.
 */
class CBeeManager {
  constructor(o = {}) {
    this.className = 'CBee';
    this.timeout = 1000;
    this.cnxTimeout = 60000;
    this.cbeeCnx = {};
    this.host = 'localhost';
    this.now = () => Date.now();
    Object.assign(this, o);
  }

  addListener(port, lc, notRecallMe) {
    if (port === undefined || lc === undefined) return undefined;

    const key = String(port);
    if (this.cbeeCnx[key] === undefined) {
      this.addCnx(port, false);
    } else if (!this.cbeeCnx[key].cbee.connected) {
      this.cbeeCnx[key].cbee.connect(this.host, port);
    } else if (!notRecallMe && this.cbeeCnx[key].cbee.logged && typeof lc.onXML === 'function') {
      lc.onXML({ nodeName: this.cbeeCnx[key].cbee.cmdList.ident, attributes: { l: this.cbeeCnx[key].cbee.login } });
    }

    const listeners = this.cbeeCnx[key].listeners;
    if (!listeners.includes(lc)) listeners.push(lc);
    return this.cbeeCnx[key].lc;
  }

  getStatus(port, lc) {
    const cc = this.cbeeCnx[String(port)];
    if (!cc) return undefined;

    const obj = {
      connected: cc.cbee.connected,
      logged: !!cc.cbee.logged,
    };

    if (lc && typeof lc.onStatus === 'function') lc.onStatus(obj);
    return obj;
  }

  removeListener(port, lc, forceClose = false) {
    const cc = this.cbeeCnx[String(port)];
    if (!cc) return;

    cc.listeners = cc.listeners.filter((entry) => entry !== lc);

    if (cc.listeners.length === 0) {
      if (forceClose) this.removeCnx(port);
      else cc.emptyTime = this.now();
    }
  }

  addCnx(port, force = false, obj) {
    const cbee = new CBee(obj);
    cbee.connect(this.host, port);
    cbee.setGlobalListener({ obj: this, method: 'onGlobalListener' });

    const lc = new CBeeLC(cbee);
    this.cbeeCnx[String(port)] = {
      cbee,
      lc,
      listeners: [],
      emptyTime: this.now(),
      force,
    };

    return cbee;
  }

  removeCnx(port) {
    const key = String(port);
    if (!this.cbeeCnx[key]) return;

    this.cbeeCnx[key].cbee.setGlobalListener(undefined);
    delete this.cbeeCnx[key];
  }

  onGlobalListener(port, event, data) {
    const cc = this.cbeeCnx[String(port)];
    if (!cc) return;

    if (event === 'onClose' && !cc.force && cc.listeners.length === 0) {
      this.removeCnx(port);
      return;
    }

    for (let i = 0; i < cc.listeners.length; i += 1) {
      const e = cc.listeners[i];
      if (e && typeof e[event] === 'function') e[event](data);
    }
  }

  checkAll() {
    Object.keys(this.cbeeCnx).forEach((port) => {
      const cc = this.cbeeCnx[port];
      if (!cc.force && cc.listeners.length === 0 && this.now() - cc.emptyTime > this.cnxTimeout) {
        this.removeCnx(port);
      }
    });
  }
}

module.exports = {
  CBeeManager,
};
