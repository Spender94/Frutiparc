const test = require('node:test');
const assert = require('node:assert/strict');

const { Lang } = require('../../packages/core-js/src/lang');

const langText = {
  greet: 'Salut $n',
  date: {
    day_short: { 2: 'mar' },
    day: { 2: 'mardi' },
    month_short: { 1: 'janv' },
    month: { 1: 'janvier' },
    format_default: '$Y/$N/$D',
  },
  duration: {
    format_default: {
      h: '$h h',
      i: '$i min',
      s: '$s sec',
      m: '$m ms',
    },
  },
  ordinal: { first: 'er', second: 'e', third: 'e', fourth: 'e', fifth: 'e', def: 'e' },
  countries: {
    FR: { name: 'France', region: { IDF: 'Île-de-France' } },
  },
  sign: { 1: 'Bélier' },
  disc_to_game: { miniboom: 'Mini Boom' },
  tip_doc: { t1: 'Astuce 1' },
};

test('fv formats language string variables', () => {
  assert.equal(Lang.fv('greet', { n: 'Bob' }, langText), 'Salut Bob');
  assert.equal(Lang.fv('unknown.path', { n: 'Bob' }, langText), '[ERR] unknown.path');
});

test('date formatting helpers', () => {
  const date = new Date(2024, 0, 2, 3, 4, 5);
  assert.equal(Lang.formatDate(date, 'default', langText), '2024/01/02');
  assert.equal(Lang.formatDateString('2024-01-02 03:04:05', 'default', langText), '2024/01/02');
  assert.equal(Lang.formatDateTime(date.getTime(), 'default', langText), '2024/01/02');
});

test('duration and ordinal helpers', () => {
  assert.equal(Lang.formatDuration(3000, 'default', langText), '3 sec');
  assert.equal(Lang.card2ord(1, langText), '1er');
  assert.equal(Lang.card2ord(8, langText), '8e');
});

test('country/region/sign/game/tip helpers', () => {
  assert.equal(Lang.country('FR', langText), 'France');
  assert.equal(Lang.country('XX', langText), 'Inconnu');
  assert.equal(Lang.region('FR', 'IDF', langText), 'Île-de-France');
  assert.equal(Lang.region('FR', '??', langText), 'Inconnu');
  assert.equal(Lang.sign(1, langText), 'Bélier');
  assert.equal(Lang.gameName('miniboom', langText), 'Mini Boom');
  assert.equal(Lang.gameName('unknown', langText), 'unknown');
  assert.equal(Lang.getTipDoc('t1', langText), 'Astuce 1');
});
