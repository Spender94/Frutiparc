const { Lang } = require('./lang');

/**
 * Runtime JS mirror for Lot A target UserMng (core logic subset).
 */
class UserMng {
  static xpToLevel(xp) {
    xp = Math.max(0, xp);
    return Math.floor(Math.sqrt(xp / 10000) + 1);
  }

  static levelToXp(level) {
    level = Math.max(1, level);
    return ((level - 1) ** 2) * 10000;
  }

  static xpLevelCompletionRate(xp) {
    const level = UserMng.xpToLevel(xp);
    const xpOk = xp - UserMng.levelToXp(level);
    const between = UserMng.levelToXp(level + 1) - UserMng.levelToXp(level);
    return xpOk / between;
  }

  static birthdayToAge(bd, now = new Date()) {
    if (bd === undefined || bd === '0000-00-00' || bd.length < 10) return 0;
    const y = Number(bd.substr(0, 4));
    const m = Number(bd.substr(5, 2));
    const d = Number(bd.substr(8, 2));

    const ly = now.getFullYear();
    const lm = now.getMonth() + 1;
    const ld = now.getDate();

    if (lm > m || (lm === m && ld >= d)) return ly - y;
    return ly - y - 1;
  }

  static birthdayToMonthAge(bd, now = new Date()) {
    if (bd === undefined || bd === '0000-00-00 00:00:00' || bd.length < 19) return 0;
    const y = Number(bd.substr(0, 4));
    const m = Number(bd.substr(5, 2));
    const d = Number(bd.substr(8, 2));

    const ly = now.getFullYear();
    const lm = now.getMonth() + 1;
    const ld = now.getDate();

    return (ly - y) * 12 + (lm - m) - (ld < d ? 1 : 0);
  }

  static formatInfoBasic(node, now, langText) {
    return {
      xpLevel: UserMng.xpToLevel(Number(node.attributes.x)),
      xpCompletionRate: UserMng.xpLevelCompletionRate(Number(node.attributes.x)),
      nickname: node.attributes.u,
      gender: node.attributes.sx,
      age: UserMng.birthdayToAge(node.attributes.bd, now),
      birthday: node.attributes.bd,
      country: Lang.country(node.attributes.co, langText),
      countryCode: node.attributes.co,
      region: Lang.region(node.attributes.co, node.attributes.rg, langText),
    };
  }

  constructor(u, iB = {}, flMode = false) {
    this.u = u;
    this.flMode = flMode;
    this.mcList = [];

    this.updateSortString();

    this.infoBasic = {
      status: { internal: undefined, external: undefined, emote: undefined },
      fbouille: '000503000000111010',
      presence: 0,
      xpLevel: 1,
      xpCompletionRate: 0,
      nickname: u,
      gender: 'M',
      age: undefined,
      birthday: '',
      country: '',
      region: '',
      flMute: false,
    };

    Object.assign(this.infoBasic, iB);
  }

  setMc(mc) {
    if (mc === undefined) return;
    if (!this.mcList.includes(mc)) this.mcList.push(mc);
    if (this.infoBasic !== undefined && typeof mc.onInfoBasic === 'function') {
      mc.onInfoBasic(this.getInfoBasic());
    }
  }

  unsetMc(mc) {
    this.mcList = this.mcList.filter((m) => m !== mc);
  }

  onAction(act) {
    for (let i = 0; i < this.mcList.length; i += 1) {
      if (typeof this.mcList[i].onAction === 'function') this.mcList[i].onAction(act);
    }
  }

  onStatusObj(obj) {
    if (obj === undefined) return;
    Object.assign(this.infoBasic, obj);

    for (let i = 0; i < this.mcList.length; i += 1) {
      if (typeof this.mcList[i].onInfoBasic === 'function') this.mcList[i].onInfoBasic(obj);
    }
  }

  setInfoBasic(obj) {
    Object.assign(this.infoBasic, obj);
  }

  getInfoBasic() {
    return this.infoBasic;
  }

  updateSortString() {
    this.sortString = `${this.flMode ? '0' : '1'}${this.u.toLowerCase()}`;
  }
}

module.exports = {
  UserMng,
};
