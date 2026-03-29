const FEObject = require('./feObject');

/**
 * Runtime JS mirror for Lot A target HTTP (queue + callback orchestration only).
 */
class HTTP {
  static queue = [];
  static flIdle = true;
  static defaultParams = {};
  static defaultHeaders = {};

  constructor(action, params, callback, method = 'GET', extra = null, transport = null) {
    this.action = action;
    this.params = params || {};
    this.callback = callback;
    this.method = method;
    this.extra = extra;
    this.transport = transport;

    this.output = FEObject.clone(HTTP.defaultParams);
    FEObject.addObject(this.output, this.params, true);

    HTTP.submitMe(this);
  }

  static submitMe(obj) {
    if (HTTP.flIdle) {
      HTTP.flIdle = false;
      obj.submit();
    } else {
      HTTP.queue.push(obj);
    }
  }

  static goNext() {
    if (HTTP.queue.length === 0) {
      HTTP.flIdle = true;
    } else {
      const t = HTTP.queue.shift();
      t.submit();
    }
  }

  submit() {
    if (!this.transport) {
      this.callback.obj[this.callback.method](false, null, this.extra);
      HTTP.goNext();
      return;
    }

    this.transport(this.action, this.output, this.method, (success, data) => {
      this.callback.obj[this.callback.method](success, data, this.extra);
      HTTP.goNext();
    });
  }
}

module.exports = {
  HTTP,
};
