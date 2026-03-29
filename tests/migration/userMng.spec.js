const test = require('node:test');
const assert = require('node:assert/strict');

const { UserMng } = require('../../packages/core-js/src/userMng');

const langText = {
  countries: { FR: { name: 'France', region: { IDF: 'Île-de-France' } } },
};

test('UserMng XP helpers', () => {
  assert.equal(UserMng.xpToLevel(0), 1);
  assert.equal(UserMng.levelToXp(1), 0);
  assert.equal(UserMng.levelToXp(3), 40000);
  assert.equal(UserMng.xpToLevel(40000), 3);
  assert.equal(UserMng.xpLevelCompletionRate(45000), 0.1);
});

test('UserMng birthday helpers', () => {
  const now = new Date(2024, 5, 15);
  assert.equal(UserMng.birthdayToAge('2000-06-10', now), 24);
  assert.equal(UserMng.birthdayToAge('2000-06-20', now), 23);
  assert.equal(UserMng.birthdayToMonthAge('2024-04-20 00:00:00', now), 1);
});

test('formatInfoBasic maps profile fields', () => {
  const now = new Date(2024, 5, 15);
  const node = {
    attributes: { x: '45000', u: 'Bob', sx: 'M', bd: '2000-06-10', co: 'FR', rg: 'IDF' },
  };

  const info = UserMng.formatInfoBasic(node, now, langText);
  assert.equal(info.nickname, 'Bob');
  assert.equal(info.country, 'France');
  assert.equal(info.region, 'Île-de-France');
  assert.equal(info.xpLevel, 3);
});

test('instance methods manage listeners and info updates', () => {
  const user = new UserMng('Alice', { gender: 'F' }, true);

  const events = [];
  const mc = {
    onInfoBasic(obj) { events.push(['info', obj.nickname || obj.gender]); },
    onAction(act) { events.push(['action', act]); },
  };

  user.setMc(mc);
  user.onAction('wave');
  user.onStatusObj({ nickname: 'Alice2', flMute: true });
  user.unsetMc(mc);

  assert.equal(user.sortString, '0alice');
  assert.equal(user.getInfoBasic().nickname, 'Alice2');
  assert.equal(user.getInfoBasic().flMute, true);
  assert.deepEqual(events, [
    ['info', 'Alice'],
    ['action', 'wave'],
    ['info', 'Alice2'],
  ]);
});
