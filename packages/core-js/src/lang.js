const FEString = require('./feString');
const FEDate = require('./feDate');
const FENumber = require('./feNumber');

/**
 * Runtime JS mirror for Lot A target Lang (core formatting logic, no globals).
 */
class Lang {
  static varName = 'langText';

  static dig(obj, path) {
    return path.split('.').reduce((cur, part) => (cur == null ? undefined : cur[part]), obj);
  }

  static fv(path, obj, langText) {
    const base = Lang.dig(langText, path);
    if (base !== undefined) return FEString.formatVars(base, obj);
    return `[ERR] ${path}`;
  }

  static formatDateObject(obj, format, langText) {
    obj.A = Lang.dig(langText, `date.day_short.${obj.b}`);
    obj.a = Lang.dig(langText, `date.day.${obj.b}`);
    obj.M = Lang.dig(langText, `date.month_short.${obj.n}`);
    obj.m = Lang.dig(langText, `date.month.${obj.n}`);

    const base = format !== undefined ? Lang.dig(langText, `date.format_${format}`) : undefined;
    return base !== undefined
      ? FEString.formatVars(base, obj)
      : FEString.formatVars('$Y-$N-$D $H:$I:$S', obj);
  }

  static formatDate(date, format, langText) {
    return Lang.formatDateObject(FEDate.getCompleteObject(date), format, langText);
  }

  static formatDateString(date, format, langText) {
    return Lang.formatDate(FEDate.newFromString(date), format, langText);
  }

  static formatDateTime(t, format, langText) {
    return Lang.formatDate(FEDate.newFromTime(t), format, langText);
  }

  static formatDuration(dur, format, langText) {
    dur = Math.round(dur);
    const obj = {
      m: dur % 1000,
      s: Math.floor(dur / 1000) % 60,
      i: Math.floor(dur / 60000) % 60,
      h: Math.floor(dur / 3600000),
    };

    const f = format === undefined ? 'default' : format;
    if (obj.h > 0) return FEString.formatVars(Lang.dig(langText, `duration.format_${f}.h`), obj);
    if (obj.i > 0) return FEString.formatVars(Lang.dig(langText, `duration.format_${f}.i`), obj);
    if (obj.s > 0) return FEString.formatVars(Lang.dig(langText, `duration.format_${f}.s`), obj);
    return FEString.formatVars(Lang.dig(langText, `duration.format_${f}.m`), obj);
  }

  static displayScoreType(score, ty, userMng) {
    switch (ty) {
      case 'millisecond': {
        const ms = score % 1000;
        const s = Math.floor(score / 1000) % 60;
        const m = Math.floor(score / 60000);
        return `${m > 0 ? `${m}'` : ''}${m > 0 ? FENumber.toStringL(s, 2) : s}"${FENumber.toStringL(ms, 3)}`;
      }
      case 'xp': {
        const l = userMng.xpToLevel(score);
        const c = Math.floor(userMng.xpLevelCompletionRate(score) * 100);
        return `Niv. ${l}, ${FENumber.toStringL(c, 2)}%`;
      }
      case 'rate':
        return `${Math.round(score * 100) / 100}%`;
      case 'ptmb2':
        return score < 100 ? `${score + 1}%` : `${Math.floor(score / 100)}, ${(score % 100) + 1}%`;
      default:
        return score;
    }
  }

  static card2ord(p, langText) {
    switch (Number(p)) {
      case 1:
        return `${p}${langText.ordinal.first}`;
      case 2:
        return `${p}${langText.ordinal.second}`;
      case 3:
        return `${p}${langText.ordinal.third}`;
      case 4:
        return `${p}${langText.ordinal.fourth}`;
      case 5:
        return `${p}${langText.ordinal.fifth}`;
      default:
        return `${p}${langText.ordinal.def}`;
    }
  }

  static country(co, langText) {
    const r = Lang.dig(langText, `countries.${co}.name`);
    return r === undefined ? 'Inconnu' : r;
  }

  static region(co, rg, langText) {
    const r = Lang.dig(langText, `countries.${co}.region.${rg}`);
    return r === undefined ? 'Inconnu' : r;
  }

  static sign(fs, langText) {
    return langText.sign[Number(fs)];
  }

  static gameName(discName, langText) {
    const r = Lang.dig(langText, `disc_to_game.${discName}`);
    return r === undefined ? discName : r;
  }

  static getTipDoc(id, langText) {
    return Lang.dig(langText, `tip_doc.${id}`);
  }
}

module.exports = {
  Lang,
};
