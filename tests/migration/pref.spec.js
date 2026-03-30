const test = require('node:test');
const assert = require('node:assert/strict');

const { Pref } = require('../../packages/core-js/src/pref');
const FENumber = require('../../packages/core-js/src/feNumber');

function prefDefChunk(id, typeCode, name, defaultValue) {
  return (
    FENumber.encode62(id, 2) +
    typeCode +
    FENumber.encode62(name.length, 2) +
    name +
    FENumber.encode62(defaultValue.length, 2) +
    defaultValue
  );
}

test('onLoadPrefDef parses pref definitions', () => {
  const pref = new Pref();
  const data = {
    PrefDef:
      prefDefChunk(1, 'b', 'music', 'Y') +
      prefDefChunk(2, 'i', 'volume', '0a') +
      prefDefChunk(3, 's', 'theme', 'classic'),
  };

  pref.onLoadPrefDef(true, data);

  assert.equal(pref.prefs.music.type, 'bool');
  assert.equal(pref.prefs.music.default_value, true);
  assert.equal(pref.prefs.volume.default_value, 10);
  assert.equal(pref.prefs.theme.default_value, 'classic');
});

test('useMyPref applies packed user preferences', () => {
  const pref = new Pref();
  pref.onLoadPrefDef(true, {
    PrefDef:
      prefDefChunk(1, 'b', 'music', 'Y') +
      prefDefChunk(2, 'i', 'volume', '0a') +
      prefDefChunk(3, 's', 'theme', 'classic'),
  });

  const packed =
    FENumber.encode62(1, 2) + FENumber.encode62(1, 2) + 'N' +
    FENumber.encode62(2, 2) + FENumber.encode62(2, 2) + '1Z' +
    FENumber.encode62(3, 2) + FENumber.encode62(4, 2) + 'dark';

  pref.useMyPref(packed);

  assert.equal(pref.getPref('music'), false);
  assert.equal(pref.getPref('volume'), 123);
  assert.equal(pref.getPref('theme'), 'dark');
});

test('getFormatedPref serializes only non-default values', () => {
  const pref = new Pref();
  pref.onLoadPrefDef(true, {
    PrefDef: prefDefChunk(1, 'b', 'music', 'Y') + prefDefChunk(2, 'i', 'volume', '0a'),
  });

  pref.setPref('music', false);
  pref.setPref('volume', 10); // default, should not be serialized

  const out = pref.getFormatedPref();
  const expected = FENumber.encode62(1, 2) + FENumber.encode62(1, 2) + 'N';
  assert.equal(out, expected);
});

test('getACopy returns deep copy of prefs', () => {
  const pref = new Pref();
  pref.onLoadPrefDef(true, { PrefDef: prefDefChunk(1, 's', 'theme', 'classic') });

  const copy = pref.getACopy();
  copy.theme.value = 'hacked';

  assert.equal(pref.getPref('theme'), 'classic');
});
