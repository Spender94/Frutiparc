const FEDate = require('./feDate');

/**
 * Runtime JS mirror for Lot A target RunDate.
 */
class RunDate {
  constructor() {
    this.ref = undefined;
    this.refLocal = undefined;
    this.diff = 0;
  }

  setFromString(str) {
    this.refLocal = new Date();
    this.ref = FEDate.newFromString(str);
    this.diff = this.ref.getTime() - this.refLocal.getTime();
  }

  getTime() {
    const d = new Date();
    if (this.ref !== undefined) return d.getTime() + this.diff;
    return d.getTime();
  }

  getDateObject() {
    const d = new Date();
    if (this.ref !== undefined) d.setTime(d.getTime() + this.diff);
    return d;
  }

  getObject() {
    return FEDate.getObject(this.getDateObject());
  }

  getCompleteObject() {
    return FEDate.getCompleteObject(this.getDateObject());
  }

  toString() {
    return this.getDateObject().toString();
  }

  toFormat(format, formatter) {
    return formatter(this.getCompleteObject(), format);
  }

  getCurrentFSign() {
    const t = this.getTime() / 1000;
    return {
      sign: Math.floor(((t - 345600) / 604800) % 10),
      signb: Math.floor((t / 3600) % 10),
      signCompletion: ((t - 345600) / 604800) % 1,
      signbCompletion: (t / 3600) % 1,
    };
  }
}

module.exports = {
  RunDate,
};
