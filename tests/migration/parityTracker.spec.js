const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeName,
  mapParity,
  buildAutonomyMarkdown,
} = require('../../tools/migration/parity_tracker');

test('normalizeName collapses case and separators', () => {
  assert.equal(normalizeName('FE_String'), 'festring');
  assert.equal(normalizeName('CBeeLocal'), 'cbeelocal');
});

test('mapParity returns summary and marks missing files', () => {
  const report = mapParity({
    files: [
      {
        file: 'frutiengine/Imaginary.as',
        lines: 42,
        classes: ['Imaginary'],
        hasAttachMovie: false,
        hasLoadMovie: false,
        hasOnClipEvent: false,
        hasXml: false,
      },
      {
        file: 'frutiengine/FEString.as',
        lines: 120,
        classes: ['FEString'],
        hasAttachMovie: false,
        hasLoadMovie: false,
        hasOnClipEvent: false,
        hasXml: false,
      },
    ],
  });

  assert.equal(report.summary.totalFiles, 2);
  assert.ok(report.summary.parity.missing >= 1);
  assert.equal(report.files.find((f) => f.file.includes('Imaginary')).parity, 'missing');
});

test('buildAutonomyMarkdown includes autonomous workflow section', () => {
  const md = buildAutonomyMarkdown({
    summary: {
      generatedAt: '2026-03-30T00:00:00.000Z',
      totalFiles: 1,
      parity: {
        portedJsHaxe: 0,
        portedJsOnly: 0,
        portedHaxeOnly: 0,
        missing: 1,
      },
    },
    files: [
      {
        file: 'frutiengine/Imaginary.as',
        lines: 12,
        risk: 0,
        parity: 'missing',
      },
    ],
  });

  assert.ok(md.includes('Plan autonome pour reproduire Frutiparc'));
  assert.ok(md.includes('Boucle de travail autonome'));
});
