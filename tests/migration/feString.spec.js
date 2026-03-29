const test = require('node:test');
const assert = require('node:assert/strict');

const FEString = require('../../packages/core-js/src/feString');

test('replace/unHTML/replaceBackSlashN behave as expected', () => {
  assert.equal(FEString.replace('a-b-a', 'a', 'x'), 'x-b-x');
  assert.equal(FEString.unHTML('<a&b>'), '&lt;a&amp;b&gt;');
  assert.equal(FEString.replaceBackSlashN('line1\\nline2'), 'line1\nline2');
});

test('decode62 and repeat helpers', () => {
  assert.equal(FEString.decode62('a'), 10);
  assert.equal(FEString.decode62('A'), 36);
  assert.equal(FEString.repeat('ab', 3), 'ababab');
});

test('trim and character helpers', () => {
  assert.equal(FEString.rmChr('a-b-c', '-'), 'abc');
  assert.equal(FEString.ltrim('   hello'), 'hello');
  assert.equal(FEString.rtrim('hello   '), 'hello');
  assert.equal(FEString.trim('  hello  '), 'hello');
});

test('string predicates', () => {
  assert.equal(FEString.countUpperCase('AbCDx'), 3);
  assert.equal(FEString.startsWith('frutiparc', 'fru'), true);
  assert.equal(FEString.endsWith('frutiparc', 'parc'), true);
  assert.equal(FEString.checkRepeat('aaab', 2), true);
  assert.equal(FEString.checkRepeat('abab', 2), false);
});
