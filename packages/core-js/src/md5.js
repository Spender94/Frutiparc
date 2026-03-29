const crypto = require('node:crypto');

/**
 * Runtime JS mirror for Lot A target MD5.
 */
function encode(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

module.exports = {
  encode,
};
