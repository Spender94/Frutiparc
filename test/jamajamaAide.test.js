'use strict';
/*
 * JAMAJAMA — L'ANNEXE DE L'AIDE, « Détails des éléments ».
 *
 * help.xml n'en porte que l'en-tête : « la suite du texte est complétée
 * automatiquement avec les noeuds ci-dessous ». C'est extension.swf
 * (ExternalData.getHelpSection) qui la complète, avec les vingt-deux fiches
 * de l'aide contextuelle de l'éditeur, dans son ordre. Le portage servait
 * l'en-tête seul : « le détail des éléments n'a pas été complété ».
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3622;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '',
      XMLSOCKET_PORT: '5622', FRUTISCORE_PORT: '5623' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

test('l’annexe porte les vingt-deux fiches, dans l’ordre de l’extension', async () => {
  const d = await (await fetch(BASE + '/api/jamajama/aide')).json();
  assert.strictEqual(d.ok, true);
  const annexe = d.sections.index_annex;
  assert.match(annexe, /Annexe : Détails des éléments/, 'l’en-tête reste');
  const titres = [...annexe.matchAll(/<p class="subtitle">([^<]+)<\/p>/g)].map((m) => m[1]);
  assert.deepStrictEqual(titres, ['Tiki', 'La trappe de sortie', 'Les fruits', 'La caisse', 'Le mur',
    'L\'eau', 'Le pont foutu', 'Les cailloux', 'La rune', 'La voie à sens unique',
    'La voie à sens unique strict', 'L\'aimant gris', 'L\'aimant en or', 'La BoBombe', 'Louki',
    'Kohl', 'Winkle', 'L\'Électrificator', 'L\'araignée', 'Le lurker', 'La statue de Jade', 'Le Zoeil']);
  assert.ok(!/L'esprit de Tiki<\/p>|L'interrupteur/.test(annexe), 'ni l’esprit ni l’interrupteur, absents de la liste');
  // Chaque fiche arrive précédée d'un saut de ligne, comme dans l'extension.
  assert.strictEqual((annexe.match(/<br \/>\s*<p class="subtitle">/g) || []).length, 22);
});
