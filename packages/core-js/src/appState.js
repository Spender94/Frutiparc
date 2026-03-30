const { UserListMng } = require('./userListMng');
const { StatusMng } = require('./statusMng');

class AppState {
  constructor() {
    this.users = new UserListMng();
    this.status = new StatusMng();
    this.messages = [];

    this.users.addUser('dalmatien17', { nickname: 'dalmatien17' }, false, false);
    this.users.addUser('groingroin', { nickname: 'groingroin' }, false, false);
    this.users.onChange();

    this.status.setExternal('eat');
    this.status.setInternal('forum');

    this.addMessage('system', 'Bienvenue sur le prototype Frutiparc portable.');
    this.addMessage('groingroin', 'sifflote');
  }

  addMessage(user, text) {
    const cleanUser = String(user || 'visiteur').slice(0, 32);
    const cleanText = String(text || '').trim().slice(0, 300);
    if (!cleanText) return false;
    this.messages.push({
      id: this.messages.length + 1,
      time: new Date().toISOString(),
      user: cleanUser,
      text: cleanText,
    });
    if (this.messages.length > 100) this.messages.shift();
    return true;
  }

  getState() {
    return {
      users: this.users.getUserArray(),
      messages: this.messages,
      status: StatusMng.analyseStr(this.status.last || '0000'),
    };
  }
}

function createAppState() {
  return new AppState();
}

module.exports = {
  AppState,
  createAppState,
};
