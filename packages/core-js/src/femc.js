const { toColorObj } = require('./feNumber');

/**
 * Runtime JS mirror for pragmatic FEMC subset.
 */
class FEMC {
  static setColor(mc, o, negFlag = false) {
    let col;
    if (o && o.r !== undefined) {
      col = {
        rb: o.r,
        gb: o.g,
        bb: o.b,
        ab: o.a === undefined ? 0 : o.a,
      };
    } else if (typeof o === 'number') {
      col = {
        rb: (o >> 16) & 255,
        gb: (o >> 8) & 255,
        bb: o & 255,
      };
    } else {
      return null;
    }

    if (negFlag) {
      col.ra = -100;
      col.ga = -100;
      col.ba = -100;
    } else {
      col.ra = 100;
      col.ga = 100;
      col.ba = 100;
      col.rb -= 255;
      col.gb -= 255;
      col.bb -= 255;
    }

    mc.lastTransform = col;
    return col;
  }

  static setPColor(mc, color, percent) {
    let c = color;
    if (typeof color === 'number') c = toColorObj(color);

    if (mc.colorObject === undefined) {
      mc.colorObject = {
        actual: {
          col: { r: 0, g: 0, b: 0 },
          percent: 100,
        },
      };
    }

    if (c !== undefined) mc.colorObject.actual = { col: c, percent };

    const act = mc.colorObject.actual;
    const coef = (100 - act.percent) / 100;
    const tr = {
      ra: act.percent,
      ga: act.percent,
      ba: act.percent,
      aa: 100,
      rb: act.col.r * coef,
      gb: act.col.g * coef,
      bb: act.col.b * coef,
      ab: 0,
    };

    mc.lastTransform = tr;
    return tr;
  }

  static killColor(mc) {
    const tr = {
      ra: 100,
      ga: 100,
      ba: 100,
      aa: 100,
      rb: 0,
      gb: 0,
      bb: 0,
      ab: 0,
    };
    mc.lastTransform = tr;
    return tr;
  }

  static morphToButton(mc) {
    mc.onRollOver = function onRollOver() {
      this.gotoAndStop(2);
      if (typeof this.onFrutiRollOver === 'function') this.onFrutiRollOver();
    };
    mc.onRollOut = function onRollOut() {
      this.gotoAndStop(1);
      if (typeof this.onFrutiRollOut === 'function') this.onFrutiRollOut();
    };
    mc.onPress = function onPress() {
      this.gotoAndStop(3);
      if (typeof this.onFrutiPress === 'function') this.onFrutiPress();
    };
    mc.onRelease = function onRelease() {
      this.gotoAndStop(2);
      if (typeof this.onFrutiRelease === 'function') this.onFrutiRelease();
    };
    if (typeof mc.stop === 'function') mc.stop();
  }

  static toString(mc, l = 0) {
    if (mc && mc.isRoot) return '_root';
    if (l > 10) return '..';

    if (l === 0) return `[MovieClip: ${FEMC.toString(mc._parent, l + 1)}.${mc._name}]`;
    return `${FEMC.toString(mc._parent, l + 1)}.${mc._name}`;
  }
}

module.exports = {
  FEMC,
};
