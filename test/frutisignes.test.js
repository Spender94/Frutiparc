'use strict';
/*
 * LES FRUTISIGNES : LE CALENDRIER ET LE TIRAGE (frutisignes.js).
 *
 * La semaine du signe suit la roue de la frutimandala — `RunDate
 * .getCurrentFSign` de main.swf, que le bureau HTML recopie au chiffre près :
 *
 *     signe = floor(((t − 345600) / 604800) % 10)
 *
 * Le jour de l'ascendant est la loi horaire de l'ascendant (`signb`) à
 * l'échelle du jour : floor((t / 86400) % 10).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const FS = require(path.join(__dirname, '..', 'frutisignes.js'));

// La loi d'époque, telle qu'écrite dans le bureau (mandala.majFrutisigne),
// évaluée à un instant donné.
const loiDeLaRoue = (ms) => Math.floor((((ms / 1000) - 345600) / 604800) % 10);
const JEUX = ['bkiwi', 'snake3', 'swapou2', 'mb2', 'kaluga'];

test('la semaine du signe est celle que la roue montre, à midi, chaque jour', () => {
  // Deux années entières, jour par jour : à midi UTC, la loi du SWF et la
  // nôtre disent la même chose.
  const debut = Date.UTC(2026, 0, 1);
  for (let j = 0; j < 731; j++) {
    const ms = debut + j * 86400000;
    const cle = new Date(ms).toISOString().slice(0, 10);
    assert.equal(FS.signeDeLaSemaine(cle), loiDeLaRoue(ms + 43200000), cle);
  }
  // Et c'est bien la même loi que le bureau fait tourner.
  const bureau = fs.readFileSync(path.join(__dirname, '..', 'public/bureau-frutiz.js'), 'utf8');
  assert.match(bureau, /var signe = Math\.floor\(\(\(t - 345600\) \/ 604800\) % 10\);/);
});

test('une semaine de signe va du lundi au dimanche, et dure sept jours', () => {
  // Le 4 novembre 2026 est un mercredi, dans la semaine du kiwi (5).
  assert.equal(FS.signeDeLaSemaine('2026-11-04'), 5);
  assert.deepEqual(FS.bornesDeLaSemaine('2026-11-04'), { debut: '2026-11-02', fin: '2026-11-08' });
  for (const j of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-07', '2026-11-08']) {
    assert.equal(FS.signeDeLaSemaine(j), 5, j);
  }
  assert.equal(FS.signeDeLaSemaine('2026-11-01'), 4, 'le dimanche d\'avant : le citron');
  assert.equal(FS.signeDeLaSemaine('2026-11-09'), 6, 'le lundi d\'après : le raisin');
  // Le lundi de début est toujours un lundi.
  assert.equal(new Date(FS.bornesDeLaSemaine('2026-11-04').debut + 'T12:00:00Z').getUTCDay(), 1);
});

test('le changement d\'année ne coupe pas une semaine de signe', () => {
  // Du lundi 28 décembre 2026 au dimanche 3 janvier 2027 : une seule semaine.
  const s = FS.signeDeLaSemaine('2026-12-28');
  for (const j of ['2026-12-29', '2026-12-31', '2027-01-01', '2027-01-03']) {
    assert.equal(FS.signeDeLaSemaine(j), s, j);
  }
  assert.deepEqual(FS.bornesDeLaSemaine('2027-01-01'), { debut: '2026-12-28', fin: '2027-01-03' });
  assert.equal(FS.signeDeLaSemaine('2027-01-04'), (s + 1) % 10, 'le lundi suivant, le signe suivant');
  // Le jour de l'ascendant non plus : le cycle de dix jours enjambe l'an.
  assert.equal(FS.signeDuJour('2027-01-01'), (FS.signeDuJour('2026-12-31') + 1) % 10);
  // Le 29 février compte comme un jour.
  assert.equal(FS.signeDuJour('2028-03-01'), (FS.signeDuJour('2028-02-29') + 1) % 10);
});

test('chaque signe revient toutes les dix semaines, chaque ascendant tous les dix jours', () => {
  assert.equal(FS.signeDeLaSemaine('2027-01-11'), FS.signeDeLaSemaine('2026-11-02'), '70 jours plus tard');
  assert.equal(FS.signeDuJour('2026-11-14'), FS.signeDuJour('2026-11-04'));
  const vus = new Set();
  for (let k = 0; k < 10; k++) vus.add(FS.signeDuJour(new Date(Date.UTC(2026, 10, 4 + k)).toISOString().slice(0, 10)));
  assert.equal(vus.size, 10, 'dix jours de suite, dix ascendants');
  // Le 4 novembre 2026 : jour n° 20761, ascendant abricot (1).
  assert.equal(FS.numeroDuJour('2026-11-04'), 20761);
  assert.equal(FS.signeDuJour('2026-11-04'), 1);
});

test('le cadeau : deux parties la semaine du signe, une le jour de l\'ascendant, trois s\'ils se croisent', () => {
  const cle = '2026-11-04';                      // semaine 5 (kiwi), jour 1 (abricot)
  const b = (signe, ascendant) => FS.bonusDuJour({ pseudo: 'pruneline', signe, ascendant, cleJour: cle, jeux: JEUX });
  assert.deepEqual([b(5, 7).parties, b(5, 7).semaine, b(5, 7).ascendant], [2, true, false]);
  assert.deepEqual([b(3, 1).parties, b(3, 1).semaine, b(3, 1).ascendant], [1, false, true]);
  assert.deepEqual([b(5, 1).parties, b(5, 1).semaine, b(5, 1).ascendant], [3, true, true]);
  assert.equal(b(3, 7).parties, 0, 'ni l\'un ni l\'autre');
  assert.deepEqual(b(3, 7).jeux, []);
  // Signe non révélé (-1, null) : rien, même le jour où « -1 » croiserait quoi que ce soit.
  assert.equal(b(-1, -1).parties, 0);
  assert.equal(b(null, undefined).parties, 0);
  assert.equal(b('', '').parties, 0);
  // Les jeux reçoivent UNE partie chacun : jamais deux au même.
  for (const [s, a, n] of [[5, 7, 2], [3, 1, 1], [5, 1, 3]]) {
    const r = b(s, a);
    assert.equal(r.jeux.length, n);
    assert.equal(new Set(r.jeux).size, n, 'des jeux différents');
    for (const j of r.jeux) assert.ok(JEUX.includes(j), j + ' est un jeu du Challenge');
  }
});

test('le tirage est déterministe : même joueur, même jour, mêmes jeux', () => {
  const a = FS.tirerLesJeux('Pruneline', '2026-11-04', JEUX, 3);
  assert.deepEqual(FS.tirerLesJeux('pruneline', '2026-11-04', JEUX, 3), a, 'la casse du pseudo n\'y fait rien');
  assert.deepEqual(FS.tirerLesJeux('Pruneline', '2026-11-04', [...JEUX].reverse(), 3), a,
    'l\'ordre où le serveur déclare ses jeux non plus');
  // Les deux premiers du tirage à trois sont le tirage à deux : le jour où
  // l'ascendant rejoint la semaine, il AJOUTE un jeu, il ne rebat pas les cartes.
  assert.deepEqual(FS.tirerLesJeux('Pruneline', '2026-11-04', JEUX, 2), a.slice(0, 2));
  // Pas plus de jeux qu'il n'y en a.
  assert.equal(FS.tirerLesJeux('x', '2026-11-04', ['kaluga', 'mb2'], 5).length, 2);
});

test('le tirage varie d\'un jour à l\'autre et d\'un joueur à l\'autre, et touche tous les jeux', () => {
  const compte = Object.fromEntries(JEUX.map((j) => [j, 0]));
  const combinaisons = new Set();
  for (let k = 0; k < 400; k++) {
    const jour = new Date(Date.UTC(2026, 0, 1) + k * 86400000).toISOString().slice(0, 10);
    const t = FS.tirerLesJeux('pruneline', jour, JEUX, 2);
    for (const j of t) compte[j]++;
    combinaisons.add(t.slice().sort().join('+'));
  }
  // 800 parties sur 5 jeux : chacun en reçoit à peu près 160.
  for (const j of JEUX) assert.ok(compte[j] > 110 && compte[j] < 210, `${j} : ${compte[j]} parties sur 400 jours`);
  assert.equal(combinaisons.size, 10, 'les dix paires possibles sortent');
  const autres = new Set();
  for (let k = 0; k < 40; k++) autres.add(FS.tirerLesJeux('frutiz' + k, '2026-11-04', JEUX, 2).join('+'));
  assert.ok(autres.size > 5, 'le même jour, des joueurs différents reçoivent des jeux différents');
});

test('la phrase du jour, sobre', () => {
  const libelle = (j) => ({ kaluga: 'Kaluga', snake3: 'Frutisnake', swapou2: 'Swapou' })[j] || j;
  assert.equal(FS.phraseDuBonus({ semaine: true, ascendant: false, jeux: ['kaluga', 'snake3'] }, libelle),
    'C\'est ta semaine ! Le Frutisigne t\'offre une partie de plus à Kaluga et à Frutisnake aujourd\'hui.');
  assert.equal(FS.phraseDuBonus({ semaine: false, ascendant: true, jeux: ['swapou2'] }, libelle),
    'C\'est le jour de ton ascendant ! Le Frutisigne t\'offre une partie de plus à Swapou aujourd\'hui.');
  assert.equal(FS.phraseDuBonus({ semaine: true, ascendant: true, jeux: ['kaluga', 'snake3', 'swapou2'] }, libelle),
    'C\'est ta semaine, et le jour de ton ascendant ! Le Frutisigne t\'offre une partie de plus à Kaluga, à Frutisnake et à Swapou aujourd\'hui.');
  assert.equal(FS.phraseDuBonus({ semaine: false, ascendant: false, jeux: [] }, libelle), '');
});
