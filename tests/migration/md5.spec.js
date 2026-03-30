const test = require('node:test');
const assert = require('node:assert/strict');

const MD5 = require('../../packages/core-js/src/md5');

test('MD5 encode matches standard test vectors', () => {
  assert.equal(MD5.encode(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(MD5.encode('a'), '0cc175b9c0f1b6a831c399e269772661');
  assert.equal(MD5.encode('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(MD5.encode('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
});
