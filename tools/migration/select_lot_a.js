#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const INVENTORY_PATH = path.join(ROOT, 'migration', 'inventory', 'as2-inventory.json');
const OUTPUT_JSON = path.join(ROOT, 'migration', 'inventory', 'lot-a-candidates.json');
const OUTPUT_MD = path.join(ROOT, 'docs', 'MVP_LOT_A.md');

function scoreFile(file) {
  const penalty =
    (file.hasAttachMovie ? 6 : 0) +
    (file.hasLoadMovie ? 6 : 0) +
    (file.hasOnClipEvent ? 6 : 0) +
    (file.hasXml ? 2 : 0);

  const classBonus = file.classes.length > 0 ? 2 : -2;
  const sizePenalty = file.lines > 500 ? 4 : file.lines > 250 ? 2 : 0;
  const engineBonus = file.file.startsWith('frutiengine/') ? 2 : 0;
  const testPenalty = file.file.includes('test_game') ? 4 : 0;

  const score = 10 + classBonus + engineBonus - penalty - sizePenalty - testPenalty;

  return {
    ...file,
    score,
    reasons: [
      file.hasAttachMovie ? 'uses attachMovie' : null,
      file.hasLoadMovie ? 'uses loadMovie' : null,
      file.hasOnClipEvent ? 'uses onClipEvent' : null,
      file.hasXml ? 'uses XML APIs' : null,
      file.lines > 500 ? 'large file (>500 lines)' : null,
      file.file.includes('test_game') ? 'test_game scope' : null,
      file.classes.length === 0 ? 'no class declaration' : 'has class declaration',
    ].filter(Boolean),
  };
}

function main() {
  if (!fs.existsSync(INVENTORY_PATH)) {
    throw new Error(`Missing inventory file: ${path.relative(ROOT, INVENTORY_PATH)}. Run inventory_as2.js first.`);
  }

  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const scored = inventory.files.map(scoreFile);

  const candidates = scored
    .filter((f) => !f.hasAttachMovie && !f.hasLoadMovie && !f.hasOnClipEvent)
    .filter((f) => !f.file.includes('test_game'))
    .sort((a, b) => b.score - a.score || a.lines - b.lines)
    .slice(0, 5)
    .map((f) => ({
      file: f.file,
      score: f.score,
      lines: f.lines,
      classes: f.classes,
      extends: f.extends,
      importsCount: f.imports.length,
      hasXml: f.hasXml,
      reasons: f.reasons,
    }));

  const payload = {
    generatedAt: new Date().toISOString(),
    strategy: 'Haxe-first migration: select low-Flash-dependency business logic modules',
    sourceInventory: path.relative(ROOT, INVENTORY_PATH),
    candidates,
  };

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const lines = [
    '# MVP Lot A — Modules candidats (Haxe first)',
    '',
    `Généré le: ${payload.generatedAt}`,
    '',
    'Ces 5 modules sont les meilleurs candidats initiaux pour le portage Haxe (faible dépendance runtime Flash).',
    '',
    '| Module | Score | Lignes | Classes | XML | Notes |',
    '|---|---:|---:|---|---|---|',
    ...candidates.map((c) =>
      `| \`${c.file}\` | ${c.score} | ${c.lines} | ${c.classes.join(', ') || '-'} | ${c.hasXml ? 'Oui' : 'Non'} | ${c.reasons.join('; ')} |`
    ),
    '',
    '## Test rapide',
    '',
    '```bash',
    'node tools/migration/inventory_as2.js',
    'node tools/migration/select_lot_a.js',
    '```',
    '',
    'Si ces modules vous conviennent, on peut démarrer le portage Haxe du premier module dès l’étape suivante.',
  ];

  fs.writeFileSync(OUTPUT_MD, lines.join('\n') + '\n', 'utf8');

  console.log(`Lot A candidates written to ${path.relative(ROOT, OUTPUT_JSON)}`);
  console.log(`MVP report written to ${path.relative(ROOT, OUTPUT_MD)}`);
}

main();
