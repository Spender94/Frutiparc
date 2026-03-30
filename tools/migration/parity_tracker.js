#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const INVENTORY_PATH = path.join(ROOT, 'migration', 'inventory', 'as2-inventory.json');
const OUTPUT_JSON = path.join(ROOT, 'migration', 'inventory', 'parity-report.json');
const OUTPUT_MD = path.join(ROOT, 'docs', 'REPRO_FRUTIPARC_AUTONOME.md');
const JS_CORE_DIR = path.join(ROOT, 'packages', 'core-js', 'src');
const HAXE_CORE_DIR = path.join(ROOT, 'packages', 'core-haxe', 'src', 'frutiparc', 'core');

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function scoreRisk(file) {
  return (
    (file.hasAttachMovie ? 3 : 0) +
    (file.hasLoadMovie ? 3 : 0) +
    (file.hasOnClipEvent ? 3 : 0) +
    (file.hasXml ? 1 : 0)
  );
}

function listStemFiles(dir, ext) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs
      .readdirSync(dir)
      .filter((entry) => entry.endsWith(ext))
      .map((entry) => normalizeName(path.basename(entry, ext)))
  );
}

function mapParity(inventory) {
  const jsStems = listStemFiles(JS_CORE_DIR, '.js');
  const haxeStems = listStemFiles(HAXE_CORE_DIR, '.hx');

  const files = inventory.files.map((file) => {
    const classes = file.classes && file.classes.length > 0
      ? file.classes
      : [path.basename(file.file, path.extname(file.file))];

    const classDetails = classes.map((className) => {
      const norm = normalizeName(className);
      return {
        className,
        jsMirror: jsStems.has(norm),
        haxePort: haxeStems.has(norm),
      };
    });

    const anyJsMirror = classDetails.some((c) => c.jsMirror);
    const anyHaxePort = classDetails.some((c) => c.haxePort);

    return {
      file: file.file,
      lines: file.lines,
      risk: scoreRisk(file),
      hasAttachMovie: file.hasAttachMovie,
      hasLoadMovie: file.hasLoadMovie,
      hasOnClipEvent: file.hasOnClipEvent,
      hasXml: file.hasXml,
      classDetails,
      parity: anyJsMirror || anyHaxePort
        ? anyJsMirror && anyHaxePort
          ? 'ported-js-haxe'
          : anyHaxePort
            ? 'ported-haxe-only'
            : 'ported-js-only'
        : 'missing',
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceInventory: path.relative(ROOT, INVENTORY_PATH),
    totalFiles: files.length,
    parity: {
      portedJsHaxe: files.filter((f) => f.parity === 'ported-js-haxe').length,
      portedJsOnly: files.filter((f) => f.parity === 'ported-js-only').length,
      portedHaxeOnly: files.filter((f) => f.parity === 'ported-haxe-only').length,
      missing: files.filter((f) => f.parity === 'missing').length,
    },
  };

  return { summary, files };
}

function buildAutonomyMarkdown(report) {
  const topMissing = report.files
    .filter((f) => f.parity === 'missing')
    .sort((a, b) => a.risk - b.risk || a.lines - b.lines)
    .slice(0, 10);

  const lines = [
    '# Plan autonome pour reproduire Frutiparc',
    '',
    `Rapport généré: ${report.summary.generatedAt}`,
    '',
    '## État de parité migration (AS2 -> Haxe/JS)',
    '',
    `- Fichiers AS2 inventoriés: **${report.summary.totalFiles}**`,
    `- Portés en JS + Haxe: **${report.summary.parity.portedJsHaxe}**`,
    `- Portés JS uniquement: **${report.summary.parity.portedJsOnly}**`,
    `- Portés Haxe uniquement: **${report.summary.parity.portedHaxeOnly}**`,
    `- Non portés: **${report.summary.parity.missing}**`,
    '',
    '## Prochaines cibles (ordre recommandé)',
    '',
    '| Fichier AS2 | Lignes | Risque Flash | Action recommandée |',
    '|---|---:|---:|---|',
    ...topMissing.map((item) => {
      const action = item.risk <= 1
        ? 'Portage immédiat vers Haxe + miroir JS'
        : item.risk <= 4
          ? 'Portage Haxe avec façade runtime'
          : 'Reporter après stabilisation UI/runtime';
      return `| \`${item.file}\` | ${item.lines} | ${item.risk} | ${action} |`;
    }),
    '',
    '## Boucle de travail autonome (à répéter)',
    '',
    '1. Choisir le premier module non porté de faible risque.',
    '2. Porter en Haxe (`packages/core-haxe`) puis miroir JS (`packages/core-js`).',
    '3. Ajouter tests unitaires sous `tests/migration/`.',
    '4. Exposer la capacité via l’API Node si utile.',
    '5. Regénérer les rapports de migration et vérifier la baisse de `missing`.',
    '',
    '```bash',
    'node tools/migration/inventory_as2.js',
    'node tools/migration/parity_tracker.js',
    'node --test tests/migration/*.spec.js',
    '```',
    '',
    'Objectif: converger progressivement vers une reproduction fidèle de Frutiparc, sans blocage big-bang.',
  ];

  return lines.join('\n') + '\n';
}

function generateParityReport() {
  if (!fs.existsSync(INVENTORY_PATH)) {
    throw new Error(`Missing inventory file: ${path.relative(ROOT, INVENTORY_PATH)}. Run inventory_as2.js first.`);
  }

  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const report = mapParity(inventory);

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');

  fs.mkdirSync(path.dirname(OUTPUT_MD), { recursive: true });
  fs.writeFileSync(OUTPUT_MD, buildAutonomyMarkdown(report), 'utf8');

  return report;
}

function main() {
  const report = generateParityReport();
  console.log(`Parity report written to ${path.relative(ROOT, OUTPUT_JSON)}`);
  console.log(`Autonomy guide written to ${path.relative(ROOT, OUTPUT_MD)}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizeName,
  mapParity,
  generateParityReport,
  buildAutonomyMarkdown,
};
