const test = require('node:test');
const assert = require('node:assert/strict');

const { UserListMng } = require('../../packages/core-js/src/userListMng');

test('UserListMng add/remove and sorted projection', () => {
  const list = new UserListMng();

  list.addUser('zoe', {}, false, false);
  list.addUser('alice', {}, true, false);
  list.addUser('bob', {}, false, false);

  assert.equal(list.length, 3);

  list.onChange();
  assert.deepEqual(list.getUserArray(), ['alice', 'bob', 'zoe']);
  assert.equal(list.modePresent(), true);
  assert.equal(list.isMode('alice'), true);

  assert.equal(list.getRealUserName('ALICE'), 'alice');
  assert.equal(list.isInList('zoe'), true);

  assert.equal(list.rmUser('bob', false), true);
  assert.equal(list.length, 2);
  assert.deepEqual(list.getUserArray(), ['alice', 'zoe']);
});

test('UserListMng listeners receive paged updates', () => {
  const list = new UserListMng();
  list.addUser('charlie', {}, false, false);
  list.addUser('alice', {}, false, false);
  list.addUser('bob', {}, false, false);
  list.onChange();

  const events = [];
  const listener = {
    onList(users, total) {
      events.push({ users, total });
    },
  };

  list.wantList(listener, 'onList', 1, 2);
  assert.deepEqual(events.at(-1), { users: ['bob', 'charlie'], total: 3 });

  list.rmUser('bob');
  assert.deepEqual(events.at(-1), { users: ['charlie'], total: 2 });

  assert.equal(list.noMoreList(listener), true);
  list.addUser('david');
  assert.equal(events.length, 2);
});

test('UserListMng routes mc and action calls to users', () => {
  const list = new UserListMng();
  list.addUser('alice', {}, false, false);

  const events = [];
  const mc = {
    onInfoBasic(obj) {
      events.push(['info', obj.nickname]);
    },
    onAction(act) {
      events.push(['action', act]);
    },
  };

  list.defineMc('alice', mc);
  list.onUserAction('alice', 'wave');
  list.undefineMc('alice', mc);

  assert.deepEqual(events, [
    ['info', 'alice'],
    ['action', 'wave'],
  ]);

  list.rmAll();
  assert.equal(list.length, 0);
  assert.deepEqual(list.getUserArray(), []);
});
