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
let filesScanned = 0, withBouille = 0, entriesSeen = 0, underFrutiparc = 0;
const samples = []; // quelques fichiers réellement lus (pour diagnostic si 0 bouille)

// Lecture tolérante à l'encodage (UTF-16 LE/BE avec BOM, BOM UTF-8, sinon UTF-8).
function readText(fp) {
  const buf = fs.readFileSync(fp);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return Buffer.from(buf).swap16().toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  return buf.toString('utf8');
}
// Extrait le code bouille : on cherche le paramètre s=<14-24 car. base62>
// N'IMPORTE OÙ dans le HTML (indépendant du format exact du FlashObject/embed).
function extractBouille(html) {
  const h = html.replace(/&amp;/gi, '&'); // les archives encodent souvent & en &amp;
  const m = h.match(/[?&"']s=([0-9A-Za-z]{14,24})/);
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
    underFrutiparc++;
    const key = pseudo.toLowerCase();
    const year = yearOf(fp);
    const prev = best.get(key);
    if (prev && year <= prev.year) continue; // déjà une bouille d'une année ≥ → inutile de relire
    let html;
    try { html = readText(fp); } catch (e) { continue; }
    if (samples.length < 4) samples.push(fp);
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
console.log(`Fichiers HTML scannés : ${filesScanned} (dont ${underFrutiparc} sous un dossier "frutiparc")`);
console.log(`Bouilles extraites : ${withBouille} occurrence(s) → ${rows.length} pseudos uniques`);
console.log(`CSV écrit : ${path.resolve(OUT)}`);

// Diagnostic auto si rien trouvé : on montre un extrait des fichiers réellement
// lus pour comprendre le format réel (à copier-coller à l'assistant).
if (withBouille === 0) {
  console.log('\n⚠️  Aucune bouille trouvée. Diagnostic :');
  if (underFrutiparc === 0) {
    console.log('  → Aucun fichier sous un dossier "frutiparc" : la structure de chemins diffère.');
    console.log('    Vérifie le chemin racine et l\'arborescence (attendu <racine>/<année>/com/frutiparc/<pseudo>/...).');
  } else {
    console.log(`  → ${underFrutiparc} fichiers lus mais le motif s=<14-24 car.> n'a rien donné. Extraits :`);
    for (const fp of samples) {
      let t = ''; try { t = readText(fp); } catch (e) {}
      const flash = /flashobject|flashvars|loader\.swf|embed|<object/i.test(t);
      const idx = t.search(/s=[0-9A-Za-z]/i);
      const snippet = idx >= 0 ? t.slice(Math.max(0, idx - 30), idx + 60) : t.replace(/\s+/g, ' ').slice(0, 160);
      console.log(`    • ${fp}`);
      console.log(`      flash/embed détecté: ${flash} · longueur: ${t.length} · extrait: ${JSON.stringify(snippet)}`);
    }
    console.log('  → Copie ces extraits à l\'assistant pour ajuster l\'extraction.');
  }
}
