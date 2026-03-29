const { UserMng } = require('./userMng');

/**
 * Runtime JS mirror for Lot A follow-up UserListMng.
 */
class UserListMng {
  constructor(userMngClass = UserMng) {
    this.list = {};
    this.arr = [];
    this.length = 0;
    this.listenerList = [];
    this.userMngClass = userMngClass;
  }

  addUser(u, infoBasic, flMode = false, callOnChange = true) {
    const key = String(u);

    if (this.list[key] === undefined) {
      this.length += 1;
      const UserClass = this.userMngClass;
      const user = new UserClass(key, infoBasic, flMode);
      this.list[key] = user;
      this.arr.push(user);
    }

    if (callOnChange) this.onChange();
  }

  rmUser(u, callOnChange = true) {
    const key = String(u);
    const user = this.list[key];
    let removed = false;

    if (user !== undefined) {
      const idx = this.arr.indexOf(user);
      if (idx >= 0) {
        this.arr.splice(idx, 1);
        removed = true;
      }
      this.length -= 1;
      if (typeof user.onDelete === 'function') user.onDelete();
      delete this.list[key];
    }

    if (callOnChange) this.onChange();
    return removed;
  }

  rmAll() {
    for (let i = 0; i < this.arr.length; i += 1) {
      if (typeof this.arr[i].onDelete === 'function') this.arr[i].onDelete();
    }
    this.list = {};
    this.arr = [];
    this.length = 0;
  }

  defineMc(u, mc) {
    const key = String(u);
    if (!key.length || this.list[key] === undefined) return;
    this.list[key].setMc(mc);
  }

  undefineMc(u, mc) {
    const key = String(u);
    if (!key.length || this.list[key] === undefined) return;
    this.list[key].unsetMc(mc);
  }

  onChange() {
    this.arr.sort((a, b) => a.sortString.localeCompare(b.sortString));
    this.sendToAllListeners();
  }

  onUserAction(u, act) {
    const key = String(u);
    if (!key.length || this.list[key] === undefined) return;
    this.list[key].onAction(act);
  }

  wantList(obj, method, start, length) {
    let listener = this.listenerList.find((entry) => entry.obj === obj);
    if (listener === undefined) {
      listener = { obj, method, start, length };
      this.listenerList.push(listener);
    } else {
      listener.method = method;
      listener.start = start;
      listener.length = length;
    }

    this.sendToListener(listener);
  }

  noMoreList(obj) {
    const idx = this.listenerList.findIndex((entry) => entry.obj === obj);
    if (idx > -1) {
      this.listenerList.splice(idx, 1);
      return true;
    }
    return false;
  }

  sendToAllListeners() {
    for (let i = 0; i < this.listenerList.length; i += 1) {
      this.sendToListener(this.listenerList[i]);
    }
  }

  sendToListener(listener) {
    const users = this.getPartAttrib(listener.start, listener.length, 'u');
    listener.obj[listener.method](users, this.length);
  }

  isInList(user) {
    return this.list[String(user)] !== undefined;
  }

  getRealUserName(user) {
    const asked = String(user);
    const lower = asked.toLowerCase();
    for (let i = 0; i < this.arr.length; i += 1) {
      if (String(this.arr[i].u).toLowerCase() === lower) return this.arr[i].u;
    }
    return asked;
  }

  modePresent() {
    for (let i = 0; i < this.arr.length; i += 1) {
      if (this.arr[i].flMode) return true;
    }
    return false;
  }

  isMode(user) {
    const entry = this.list[String(user)];
    return entry !== undefined && entry.flMode === true;
  }

  getUserArray() {
    return this.getPartAttrib(0, this.length, 'u');
  }

  getPartAttrib(start, length, attr) {
    const s = Math.max(0, Number(start) || 0);
    const l = Math.max(0, Number(length) || 0);
    return this.arr.slice(s, s + l).map((item) => item[attr]);
  }
}

module.exports = {
  UserListMng,
};
