// Niveaux de Miniwave 2 : décodage du format PersistCodec.
//
// Les vagues du jeu ne sont pas lisibles dans les sources : elles sont encodées
// par ext.util.PersistCodec, une sérialisation Motion-Twin dont la bibliothèque
// n'existe que compilée dans lib.swf. scripts/decode-miniwave-levels.js est la
// traduction en JS de son bytecode, désassemblé pour l'occasion.
//
// Un décodeur bit à bit est fragile : une polarité de branchement inversée
// produit encore des données — mais fausses, et plausibles (c'est exactement ce
// qui s'est passé pendant l'écriture : 7369 « niveaux » de bouillie au lieu de
// 201). Ces tests ne se contentent donc pas de vérifier que ça décode : ils
// vérifient que ce qui sort ressemble à un jeu, et que le fichier livré est
// exactement ce que le décodeur tire des sources d'origine.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DONNEES = path.join(ROOT, 'public/miniwave/levels.json');
const niveaux = JSON.parse(fs.readFileSync(DONNEES, 'utf8'));

// badsInfo.as décrit 51 ennemis (index 0 à 50).
const NB_ENNEMIS = 51;
// L'aire de jeu du disque Frutiparc fait 240×240 (cf. la fiche miniwave1 du
// serveur). Les points de passage tiennent dedans, avec un peu de marge.
const AIRE = 240;

const tousLesParcours = () => [].concat(niveaux.main, niveaux.bonus, niveaux.letter);
const toutesLesEscadres = function* () {
  for (const p of tousLesParcours()) for (const n of p.levels) for (const e of (n.list || [])) yield e;
};

test('les trois familles de niveaux sont décodées', () => {
  assert.equal(niveaux.main.length, 1, 'un seul parcours principal (l\'arcade)');
  assert.equal(niveaux.main[0].name, 'arcade');
  assert.equal(niveaux.main[0].levels.length, 201, 'les 201 niveaux de l\'arcade');
  // bonus.as contient huit entrées, dont deux réservées et jamais remplies :
  // l'extracteur doit les écarter au lieu d'échouer dessus.
  assert.equal(niveaux.bonus.length, 6, 'six missions bonus réellement écrites');
  assert.equal(niveaux.letter.length, 1, 'le parcours « lettres »');
});

test('les niveaux portent les noms écrits par les auteurs du jeu', () => {
  const noms = niveaux.main[0].levels.map((n) => n.name);
  // Des accents intacts prouvent que le source latin-1 a été relu correctement,
  // et que les chaînes 6 bits comme 8 bits sont décodées.
  assert.ok(noms.includes('Première escadre'), 'accents préservés');
  assert.ok(noms.includes('Clémentines à la rescousse'));
  assert.ok(noms.includes('Formation serrée'));
  assert.ok(noms.every((n) => typeof n === 'string' && n.length > 0), 'chaque niveau est nommé');
  const missions = niveaux.bonus.map((p) => p.name);
  assert.ok(missions.includes('Mort aux fruit jaunes !'), 'les missions gardent leur titre');
  assert.ok(missions.includes('Mission Pulpe à canon'));
});

test('chaque niveau a de quoi être joué', () => {
  const lacunes = [];
  for (const p of tousLesParcours()) {
    for (const n of p.levels) {
      assert.ok(Array.isArray(n.list) && n.list.length > 0, `« ${n.name} » a au moins une escadre`);
      // Game.initLevel lit ces quatre valeurs à chaque niveau.
      for (const champ of ['moveSpeed', 'fallSpeed', 'ss', 'sd']) {
        if (n[champ] === null) { lacunes.push(`${p.name}/${n.name}:${champ}`); continue; }
        assert.equal(typeof n[champ], 'number', `« ${n.name} » : ${champ} est un nombre`);
        assert.ok(n[champ] > 0 && n[champ] < 1000, `« ${n.name} » : ${champ} = ${n[champ]} est plausible`);
      }
    }
  }
  // Une seule lacune dans tout le jeu, et elle vient des auteurs : le niveau 36
  // du parcours d'essai « level test 1 » a un moveSpeed valant NaN — que JSON ne
  // sait écrire que « null ». On la fige ici plutôt que de la masquer : le
  // moteur devra donner une vitesse de repli, et si une AUTRE lacune apparaît
  // c'est que le décodage a dérivé.
  assert.deepEqual(lacunes, ['level test 1/ vague no36...:moveSpeed'],
    'la seule valeur manquante est celle, connue, du parcours d\'essai');
});

test('les ennemis désignés existent, et se placent dans l\'aire de jeu', () => {
  let vaisseaux = 0, passages = 0;
  const types = new Set();
  for (const escadre of toutesLesEscadres()) {
    assert.ok(Array.isArray(escadre) || escadre === null, 'une escadre est un tableau (ou un trou)');
    for (const e of (escadre || [])) {
      // Un trou, ou une entrée sans `t`, est un point de PASSAGE sans vaisseau :
      // Game.initLevel s'en sert pour décaler l'arrivée des suivants. Il faut
      // donc que le décodage les préserve — d'où ce comptage.
      if (!e || e.t === undefined) { passages++; continue; }
      vaisseaux++;
      types.add(e.t);
      assert.ok(Number.isInteger(e.t) && e.t >= 0 && e.t < NB_ENNEMIS,
        `type d'ennemi ${e.t} hors de la table badsInfo`);
      assert.ok(Number.isFinite(e.x) && e.x > -AIRE && e.x < 2 * AIRE, `x = ${e.x} hors champ`);
      assert.ok(Number.isFinite(e.y) && e.y > -AIRE && e.y < 2 * AIRE, `y = ${e.y} hors champ`);
    }
  }
  assert.ok(vaisseaux > 5000, `le jeu compte des milliers de vaisseaux (${vaisseaux})`);
  assert.ok(passages > 0, `les points de passage sans vaisseau sont conservés (${passages})`);
  assert.ok(types.size >= 45, `presque tous les types d'ennemis sont employés (${types.size})`);
});

test('les artefacts de l\'éditeur ne sont pas livrés', () => {
  // Les niveaux ont été sauvegardés depuis l'éditeur, qui sérialise au passage
  // des références de clips Flash (`path`) et son marqueur d'aperçu (`e`). Le
  // jeu n'en lit aucun ; les garder gonflerait le fichier de bouillie.
  const brut = fs.readFileSync(DONNEES, 'utf8');
  assert.ok(!brut.includes('useHandCursor'), 'aucun résidu de clip Flash');
  assert.ok(!brut.includes('"path"'), 'le champ `path` de l\'éditeur est retiré');
  assert.ok(!brut.includes('"e":'), 'son marqueur d\'aperçu aussi');
});

test('le fichier livré est bien ce que le décodeur tire des sources', () => {
  // La preuve qui compte : on rejoue l'extraction depuis Games/miniWave2 et on
  // compare octet pour octet. Si quelqu'un retouche le JSON à la main, ou si le
  // décodeur dérive, ce test le dit.
  const avant = fs.readFileSync(DONNEES);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/decode-miniwave-levels.js')],
    { cwd: ROOT, stdio: 'ignore' });
  const apres = fs.readFileSync(DONNEES);
  assert.ok(avant.equals(apres), 'public/miniwave/levels.json est reproductible depuis les sources');
});

test('un flux abîmé est refusé, pas deviné', () => {
  const { decoder } = require(path.join(ROOT, 'scripts/decode-miniwave-levels.js'));
  // Caractère hors alphabet base64 : le décodeur doit s'arrêter net.
  assert.throws(() => decoder('IYG0aW*tNzb2W5'), /corrompu/, 'caractère invalide');
  // Flux tronqué : la fin arrive avant que les conteneurs soient refermés.
  assert.throws(() => decoder('IYG0aWtNzb2W5'), /corrompu/, 'flux tronqué');
});
