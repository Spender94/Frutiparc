/**
 * Runtime JS mirror for pragmatic CBeeLocal subset.
 * Supports both internal (CBeeManager bridge) and external (LocalConnection-like) variants.
 */
class CBeeLocal {
  constructor(obj = {}) {
    Object.assign(this, obj);

    this.cmdList = this.cmdList || {
      onclose: 'onclose',
      onconnect: 'onconnect',
      ident: 'ident',
    };

    this.listeners = this.listeners || {};
    this.specificListeners = this.specificListeners || {};
    this.initialized = false;
    this.connected = false;
    this.logged = false;

    this.addListener('ident', this, 'onIdent');
  }

  static randomId() {
    return Math.random().toString(36).slice(2, 10);
  }

  get isInternalMode() {
    return this.cbeeManager !== undefined && this.cbeeManager !== null;
  }

  init() {
    if (this.port === undefined) return;

    if (this.isInternalMode) {
      this.initialized = true;
      this.cbeeLC = this.cbeeManager.addListener(this.port, this, true);

      const obj = this.cbeeManager.getStatus(this.port);
      if (obj && obj.connected) this.onConnect(true);
      if (obj && obj.logged) this.callListenersArray(this.listeners[this.cmdList.ident]);
      return;
    }

    const sid = this.sid;
    const makeConnection = this.localConnectionFactory;
    if (sid === undefined || typeof makeConnection !== 'function') return;

    if (!this.lcName) this.lcName = `fp_cblc_${sid}_${this.port}_${CBeeLocal.randomId()}`;
    if (!this.managerChannel) this.managerChannel = `fp_cbeeMng_${sid}`;

    if (this.inboundConnection && typeof this.inboundConnection.connect === 'function') {
      this.inboundConnection.connect(this.lcName);
    }

    const lc = makeConnection();
    lc.obj = this;
    lc.onStatus = (obj) => {
      if (obj && obj.level === 'error') this.looseLocalConnection();
      else this.initialized = true;
    };
    lc.send(this.managerChannel, 'addListener', this.port, this.lcName);
    lc.send(this.managerChannel, 'getStatus', this.port, this.lcName);
  }

  close() {
    if (this.cbeeManager) this.cbeeManager.removeListener(this.port, this);
  }

  check() {}

  looseLocalConnection() {
    this.initialized = false;
    this.onClose();
  }

  onConnect(success) {
    this.connected = !!success;
    this.logged = false;
    this.callListenersArray(this.listeners.onconnect, success);
  }

  onClose() {
    this.connected = false;
    this.logged = false;
    this.callListenersArray(this.listeners.onclose);
  }

  onXML(node) {
    const cmdName = String(node.nodeName).toLowerCase();
    this.callListenersArray(this.listeners[cmdName], node);

    const attrs = node.attributes || {};
    Object.keys(attrs).forEach((attrib) => {
      const byCmd = this.specificListeners[cmdName];
      if (!byCmd) return;
      const byAttr = byCmd[attrib];
      if (!byAttr) return;
      this.callListenersArray(byAttr[String(attrs[attrib])], node);
    });
  }

  onStatus(obj) {
    if (obj && obj.connected) this.onConnect(true);
    this.logged = !!(obj && obj.logged);
  }

  send(s) {
    if (this.isInternalMode) {
      if (!this.initialized) return false;
      if (!this.cbeeLC || typeof this.cbeeLC.send !== 'function') return false;
      this.cbeeLC.send(s);
      return true;
    }

    if (!this.initialized || !this.connected) return false;
    if (typeof this.localConnectionFactory !== 'function') return false;

    const lc = this.localConnectionFactory();
    lc.obj = this;
    lc.onStatus = (obj) => {
      if (obj && obj.level === 'error') this.looseLocalConnection();
    };
    const channel = this.serverChannel || `fp_cbee_${this.port}_${this.sid}`;
    lc.send(channel, 'send', s);
    return true;
  }

  cmd(cmd, attr, child) {
    if (!this.isInternalMode) {
      if (!this.initialized || !this.connected) return false;
      if (typeof this.localConnectionFactory !== 'function') return false;
      const lc = this.localConnectionFactory();
      lc.obj = this;
      lc.onStatus = (obj) => {
        if (obj && obj.level === 'error') this.looseLocalConnection();
      };
      const channel = this.serverChannel || `fp_cbee_${this.port}_${this.sid}`;
      lc.send(channel, 'cmd', cmd, attr, child);
      return true;
    }

    const cbeeCmdName = this.cmdList[String(cmd).toLowerCase()];
    if (cbeeCmdName === undefined) return false;

    const x = {
      nodeName: cbeeCmdName,
      attributes: { ...(attr || {}) },
    };
    if (child !== undefined) x.child = child;

    return this.send(x);
  }

  onIdent(node) {
    this.connected = true;
    this.logged = !(node && node.attributes && node.attributes.k !== undefined);
  }

  addListener(cmd, obj, method, attrib, value) {
    const cbeeCmd = this.cmdList[String(cmd).toLowerCase()];
    if (cbeeCmd === undefined) return;

    if (attrib === undefined) {
      if (this.listeners[cbeeCmd] === undefined) this.listeners[cbeeCmd] = [];
      this.listeners[cbeeCmd].push({ obj, method });
      return;
    }

    const a = String(attrib);
    const v = String(value);
    if (this.specificListeners[cbeeCmd] === undefined) this.specificListeners[cbeeCmd] = {};
    if (this.specificListeners[cbeeCmd][a] === undefined) this.specificListeners[cbeeCmd][a] = {};
    if (this.specificListeners[cbeeCmd][a][v] === undefined) this.specificListeners[cbeeCmd][a][v] = [];
    this.specificListeners[cbeeCmd][a][v].push({ obj, method });
  }

  removeListenerCmd(cmd, attrib, value) {
    const cbeeCmd = this.cmdList[String(cmd).toLowerCase()];
    if (cbeeCmd === undefined) return;

    if (attrib === undefined) {
      this.listeners[cbeeCmd] = [];
      return;
    }

    const a = String(attrib);
    const v = String(value);
    if (this.specificListeners[cbeeCmd] && this.specificListeners[cbeeCmd][a]) {
      this.specificListeners[cbeeCmd][a][v] = [];
    }
  }

  removeListenerCmdObj(cmd, obj, attrib, value) {
    const cbeeCmd = this.cmdList[String(cmd).toLowerCase()];
    if (cbeeCmd === undefined) return;

    if (attrib === undefined) {
      const arr = this.listeners[cbeeCmd] || [];
      this.listeners[cbeeCmd] = arr.filter((entry) => entry.obj !== obj);
      return;
    }

    const a = String(attrib);
    const v = String(value);
    const arr = (((this.specificListeners[cbeeCmd] || {})[a] || {})[v]) || [];
    if (this.specificListeners[cbeeCmd] && this.specificListeners[cbeeCmd][a]) {
      this.specificListeners[cbeeCmd][a][v] = arr.filter((entry) => entry.obj !== obj);
    }
  }

  callListenersArray(arr, node) {
    if (!arr) return;
    for (let i = 0; i < arr.length; i += 1) {
      arr[i].obj[arr[i].method](node);
    }
  }
}

module.exports = {
  CBeeLocal,
};
