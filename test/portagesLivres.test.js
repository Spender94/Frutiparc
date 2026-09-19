/*
 * UN PORTAGE QUI N'EST PAS DANS LE DÉPÔT N'EXISTE PAS.
 *
 * Burning Kiwi s'est ouvert en production sur « bibliothèque introuvable :
 * bkiwi ». Le jeu marchait sur la machine, la suite passait, le commit
 * annonçait trente-neuf fichiers — et les quarante-quatre fichiers de
 * `public/bkiwi/data/` n'étaient jamais partis. La règle `data/` du
 * `.gitignore`, écrite pour le dossier du serveur (scores, sessions), avale
 * le dossier de données de CHAQUE portage ; Kaluga et Motion-Ball avaient
 * leur exception, le nouveau venu non.
 *
 * Rien dans les tests ne regardait le dépôt : ils lisent tous le disque, où
 * les fichiers étaient bien là. Ce test-ci compare les deux, portage par
 * portage. Il tombe le jour où l'on extrait un jeu de plus sans poser sa
 * ligne dans le `.gitignore` — c'est-à-dire avant la mise en ligne, et non
 * une fois que les joueurs ont l'écran noir.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Les fichiers suivis par git sous un dossier, ou null si l'on n'est pas dans
// une copie de travail (une archive téléchargée, un conteneur sans .git).
function suivis(relatif) {
  try {
    const sortie = execFileSync('git', ['ls-files', '-z', '--', relatif],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(sortie.split('\0').filter(Boolean));
  } catch (e) {
    return null;
  }
}
function surLeDisque(relatif) {
  const out = new Set();
  const absolu = path.join(ROOT, relatif);
  if (!fs.existsSync(absolu)) return out;
  for (const e of fs.readdirSync(absolu, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    out.add(path.relative(ROOT, path.join(e.parentPath || e.path, e.name)));
  }
  return out;
}

// Les dossiers qu'un portage sert au navigateur. `data` est celui que la règle
// du `.gitignore` piège ; les autres sont là parce qu'un jeu muet ou sans
// fonte est tout aussi cassé qu'un jeu sans bibliothèque.
const DOSSIERS = ['data', 'sons', 'fontes', 'jeu', 'sprites'];

test('tout ce qu\'un portage sert au navigateur est DANS le dépôt', () => {
  const tous = suivis('public');
  if (tous === null) { console.log('# pas de copie git : rien à comparer'); return; }

  const jeux = fs.readdirSync(path.join(ROOT, 'public'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, 'public', e.name, 'index.html')))
    .map((e) => e.name);
  assert.ok(jeux.length >= 8, 'les portages sont bien là : ' + jeux.join(', '));

  const manquants = [];
  for (const jeu of jeux) {
    for (const dossier of DOSSIERS) {
      const rel = path.join('public', jeu, dossier);
      for (const f of surLeDisque(rel)) {
        if (!tous.has(f)) manquants.push(f);
      }
    }
  }
  assert.deepStrictEqual(manquants.slice(0, 20), [],
    manquants.length + ' fichier(s) servis mais absents du dépôt — il manque sans doute une '
    + 'ligne « !public/<jeu>/data/ » dans le .gitignore');
});

test('chaque dossier de données extrait a son exception dans le .gitignore', () => {
  const regles = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(regles, /^data\/$/m, 'la règle qui vise le dossier du serveur');
  const jeux = fs.readdirSync(path.join(ROOT, 'public'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, 'public', e.name, 'data')))
    .map((e) => e.name);
  const sansLigne = jeux.filter((j) => !new RegExp('^!public/' + j + '/data/$', 'm').test(regles));
  assert.deepStrictEqual(sansLigne, [],
    'sans cette ligne le dossier reste sur la machine : ' + sansLigne.map((j) => '!public/' + j + '/data/').join(', '));
});

test('Burning Kiwi sert bien sa bibliothèque, ses circuits, ses sons et ses fontes', () => {
  const tous = suivis('public/bkiwi');
  if (tous === null) { console.log('# pas de copie git : rien à comparer'); return; }
  // La bibliothèque du jeu, l'intro, les six circuits et le square du tutorial.
  for (const nom of ['bkiwi', 'intro', 'track00', 'track01', 'track02', 'track03', 'track04', 'track05', 'track99']) {
    assert.ok(tous.has('public/bkiwi/data/' + nom + '.json'), nom + '.json doit être livré');
  }
  // Les dessins qu'elles citent.
  const biblio = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/bkiwi/data/bkiwi.json'), 'utf8'));
  for (const info of Object.values(biblio.images || {})) {
    assert.ok(tous.has('public/bkiwi/data/img/' + info.f), info.f + ' doit être livré');
  }
  // Les neuf sons embarqués et les dix fontes.
  for (const s of ['buttonCancel', 'buttonOk', 'buttonSwitch', 'kiwiPickUp', 'loseLifeSound',
    'buttonRefuse', 'buttonKeys', 'buttonKeysOk', 'gameOverSound']) {
    assert.ok(tous.has('public/bkiwi/sons/' + s + '.mp3'), s + '.mp3 doit être livré');
  }
  assert.strictEqual([...tous].filter((f) => /^public\/bkiwi\/fontes\/.*\.woff$/.test(f)).length, 10);
  // Et le codec du fantôme, arrivé après coup.
  assert.ok(tous.has('public/bkiwi/jeu/fantome.js'));
});
