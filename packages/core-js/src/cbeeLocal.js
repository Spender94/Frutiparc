/**
 * Runtime JS mirror for pragmatic CBeeLocal subset.
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

  init() {
    if (this.port === undefined || !this.cbeeManager) return;

    this.initialized = true;
    this.cbeeLC = this.cbeeManager.addListener(this.port, this, true);

    const obj = this.cbeeManager.getStatus(this.port);
    if (obj && obj.connected) this.onConnect(true);
    if (obj && obj.logged) this.callListenersArray(this.listeners[this.cmdList.ident]);
  }

  close() {
    if (this.cbeeManager) this.cbeeManager.removeListener(this.port, this);
  }

  check() {}

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

  send(s) {
    if (!this.initialized) return false;
    if (!this.cbeeLC || typeof this.cbeeLC.send !== 'function') return false;

    this.cbeeLC.send(s);
    return true;
  }

  cmd(cmd, attr, child) {
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
