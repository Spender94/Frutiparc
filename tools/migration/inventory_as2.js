#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const TARGET_DIRS = ['frutiengine', 'frutiparc'];
const OUTPUT_FILE = path.join(ROOT, 'migration', 'inventory', 'as2-inventory.json');

function walk(dir, collector) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, collector);
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.as')) {
      collector.push(fullPath);
    }
  }
}

function normalizeTypeName(rawName) {
  if (!rawName) return rawName;
  const parts = rawName.split('.').filter(Boolean);
  return parts[parts.length - 1] || rawName;
}

function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const classes = [...content.matchAll(/\bclass\s+([A-Za-z_][A-Za-z0-9_.]*)/g)]
    .map((m) => normalizeTypeName(m[1]));

  const extendsMatch = [...content.matchAll(/\bclass\s+[A-Za-z_][A-Za-z0-9_.]*\s+extends\s+([A-Za-z_][A-Za-z0-9_.]*)/g)]
    .map((m) => normalizeTypeName(m[1]));

  const imports = [...content.matchAll(/\bimport\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/g)].map((m) => m[1]);

  return {
    file: path.relative(ROOT, filePath),
    lines: lines.length,
    classes,
    extends: extendsMatch,
    imports,
    hasOnClipEvent: /\bonClipEvent\b/.test(content),
    hasAttachMovie: /\battachMovie\b/.test(content),
    hasLoadMovie: /\bloadMovie\b/.test(content),
    hasXml: /\bXML\b/.test(content),
  };
}

function main() {
  const files = [];
  for (const dir of TARGET_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) {
      walk(full, files);
    }
  }

  const parsed = files
    .map(parseFile)
    .sort((a, b) => a.file.localeCompare(b.file, 'en'));

  const summary = {
    generatedAt: new Date().toISOString(),
    fileCount: parsed.length,
    totalLines: parsed.reduce((sum, f) => sum + f.lines, 0),
    filesWithOnClipEvent: parsed.filter((f) => f.hasOnClipEvent).length,
    filesWithAttachMovie: parsed.filter((f) => f.hasAttachMovie).length,
    filesWithLoadMovie: parsed.filter((f) => f.hasLoadMovie).length,
    filesWithXml: parsed.filter((f) => f.hasXml).length,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify({ summary, files: parsed }, null, 2) + '\n',
    'utf8'
  );

  console.log(`AS2 inventory written to ${path.relative(ROOT, OUTPUT_FILE)}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
