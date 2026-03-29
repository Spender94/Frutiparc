/**
 * Runtime JS mirror for pragmatic CBee subset (listener/cmd orchestration).
 */
class CBee {
  constructor(o = {}) {
    Object.assign(this, o);

    this.cmdList = this.cmdList || {
      onclose: 'onclose',
      onconnect: 'onconnect',
    };

    this.listeners = this.listeners || {};
    this.specificListeners = this.specificListeners || {};
    this.connected = this.connected || false;
    this.cnxNb = this.cnxNb || 0;
    this.sentLog = [];
  }

  debug() {}

  connect(host, port) {
    this.host = host;
    this.port = port;
    this.connected = false;
  }

  onConnect(success) {
    this.callGlobalListener('onConnect', success);
    if (success) {
      this.connected = true;
      this.cnxNb += 1;
    } else {
      this.connected = false;
    }
    this.callListenersArray(this.listeners.onconnect, success);
  }

  onClose() {
    this.callGlobalListener('onClose');
    this.connected = false;
    this.callListenersArray(this.listeners.onclose);
  }

  onXML(node) {
    if (!node) return;

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

    this.callGlobalListener('onXML', node);
  }

  setGlobalListener(obj) {
    this.globalListener = obj;
  }

  callGlobalListener(event, data) {
    if (!this.globalListener) return;
    this.globalListener.obj[this.globalListener.method](this.port, event, data);
  }

  send(x) {
    if (!this.connected) return false;
    this.sentLog.push(x);
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
  CBee,
};
