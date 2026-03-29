/**
 * Runtime JS mirror for Lot A target FECMItem.
 */
class FECMItem {
  constructor(caption, callBack, flSeparatorBefore, flEnabled, flVisible) {
    this.caption = caption;
    this.callBack = callBack;
    this.flSeparatorBefore = flSeparatorBefore;
    this.flEnabled = flEnabled;
    this.flVisible = flVisible;
  }

  static onSelect(_mc, menuItem) {
    const fn = menuItem.callBack.obj[menuItem.callBack.method];
    return fn.call(menuItem.callBack.obj, menuItem.callBack.args);
  }
}

module.exports = {
  FECMItem,
};
