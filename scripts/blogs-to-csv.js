#!/usr/bin/env node
/*
  Scanne les blogs Frutiparc archivés et produit un CSV "pseudo,bouille".

  Structure attendue (l'exemple de Rémi) :
    <racine>/<année>/com/frutiparc/<pseudo>/*.html
  Chaque HTML contient un flashvars du type :
    bar.addParam("flashvars", "nobg=1&e=0&s=0004030Z02060B0000&c=b6mfgx");
  On extrait :
    - le pseudo  = le dossier juste après "frutiparc"
    - la bouille = la valeur du paramètre s=
  Si un pseudo a plusieurs bouilles (plusieurs années / articles), on garde celle
  de l'année la PLUS RÉCENTE (look le plus à jour). Le 1er flashvars d'un fichier
  est celui du propriétaire du blog (box1), pas des commentateurs.

  Usage (Windows PowerShell) :
    node scripts/blogs-to-csv.js "D:\Frutiblog\FP" blog-bouilles.csv

  Sortie : un CSV "pseudo,bouille" prêt à importer dans l'admin (Trombinoscope).
*/
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const OUT = process.argv[3] || 'blog-bouilles.csv';
if (!ROOT) { console.error('Usage: node scripts/blogs-to-csv.js <racine> [sortie.csv]'); process.exit(1); }

const best = new Map(); // pseudoLower -> { year, bouille, pseudo }
let filesScanned = 0, withBouille = 0, entriesSeen = 0;

// Extrait le code bouille (paramètre s=) du 1er flashvars trouvé.
function extractBouille(html) {
  const h = html.replace(/&amp;/gi, '&'); // les archives encodent parfois & en &amp;
  const fv = h.match(/flashvars["']?\s*,\s*["']([^"']+)["']/i);
  const hay = fv ? fv[1] : h;
  const m = hay.match(/(?:^|[&?])s=([0-9A-Za-z]{6,24})/);
  return m ? m[1] : null;
}
function yearOf(p) {
  for (const s of p.split(/[\\/]/)) if (/^20\d\d$/.test(s)) return Number(s);
  return 0;
}
function pseudoOf(p) {
  const seg = p.split(/[\\/]/);
  const i = seg.findIndex((s) => s.toLowerCase() === 'frutiparc');
  return (i >= 0 && seg[i + 1]) ? seg[i + 1] : null;
}

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (++entriesSeen % 5000 === 0) console.log(`  …${entriesSeen} éléments parcourus · ${filesScanned} HTML lus · ${best.size} pseudos trouvés`);
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(fp); continue; }
    if (!ent.isFile() || !/\.html?$/i.test(ent.name)) continue;
    filesScanned++;
    const pseudo = pseudoOf(fp);
    if (!pseudo) continue;
    const key = pseudo.toLowerCase();
    const year = yearOf(fp);
    const prev = best.get(key);
    if (prev && year <= prev.year) continue; // déjà une bouille d'une année ≥ → inutile de relire
    let html;
    try { html = fs.readFileSync(fp, 'utf8'); } catch (e) { continue; }
    const bouille = extractBouille(html);
    if (!bouille) continue;
    withBouille++;
    if (!prev || year > prev.year) best.set(key, { year, bouille, pseudo });
  }
}

console.log('Scan de', ROOT, '…');
walk(ROOT);

const csvCell = (v) => /[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const rows = [...best.values()].sort((a, b) => a.pseudo.toLowerCase().localeCompare(b.pseudo.toLowerCase(), 'fr'));
const csv = 'pseudo,bouille\r\n' + rows.map((r) => csvCell(r.pseudo) + ',' + csvCell(r.bouille)).join('\r\n') + (rows.length ? '\r\n' : '');
fs.writeFileSync(OUT, csv);
console.log(`Fichiers HTML scannés : ${filesScanned}`);
console.log(`Bouilles extraites : ${withBouille} occurrence(s) → ${rows.length} pseudos uniques`);
console.log(`CSV écrit : ${path.resolve(OUT)}`);
