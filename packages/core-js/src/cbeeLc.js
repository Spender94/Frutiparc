/**
 * Runtime JS mirror for Lot A target CBeeLC.
 */
class CBeeLC {
  constructor(cbee) {
    this.cbee = cbee;
  }

  send(x) {
    return this.cbee.send(x);
  }

  cmd(a, b, c) {
    return this.cbee.cmd(a, b, c);
  }
}

module.exports = {
  CBeeLC,
};
