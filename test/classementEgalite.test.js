'use strict';
/*
 * À SCORE ÉGAL, LE PREMIER ARRIVÉ RESTE DEVANT
 * ════════════════════════════════════════════
 *
 * C'est la règle du jeu d'origine, et celle de toutes les salles d'arcade :
 * égaler le meilleur score ne double personne. Celui qui l'a posé le premier
 * garde sa place ; il faut FAIRE MIEUX pour passer devant.
 *
 * Le comparateur du portage ne triait que sur le score. À égalité, l'ordre
 * était donc celui — arbitraire — dans lequel la liste avait été construite :
 * les clés du magasin JSON, ou ce que la base rend sans ORDER BY, où une ligne
 * réécrite se retrouve en fin de tas. Deux joueurs à égalité pouvaient changer
 * de place d'un rechargement à l'autre, et le dernier arrivé passer devant.
 *
 * L'horodatage qui départage est celui du RECORD (`updatedAt`), pas de la
 * dernière écriture : un score qui ne s'améliore pas ne réécrit rien, et un
 * simple rattrapage de donnée annexe ne redate pas le record — sinon le
 * joueur reculerait derrière ceux qui l'ont égalé depuis.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');

test('le comparateur départage sur l’ancienneté', () => {
  assert.match(SERVEUR, /function comparerAnciennete\(a, b\) \{/);
  assert.match(SERVEUR, /return ta < tb \? -1 : 1;/, 'le plus ancien passe devant');
  // Une entrée sans date est plus vieille que l'horodatage lui-même.
  assert.match(SERVEUR, /if \(!ta\) return -1;\s*\n\s*if \(!tb\) return 1;/);
  // Les deux noms de champ que les listes emploient.
  assert.match(SERVEUR, /const v = \(e && \(e\.at \|\| e\.updatedAt\)\) \|\| '';/);
  // Et le tri du score garde la main : l'ancienneté ne s'applique QU'à égalité.
  assert.match(SERVEUR,
    /return \(a, b\) => parScore\(a, b\) \|\| comparerAnciennete\(a, b\);/);
  // MotionBall garde sa hiérarchie propre (boss battu, temps, pourcentage) —
  // elle passe avant l'ancienneté, comme le score des autres classements.
  assert.match(SERVEUR, /const parScore = isMb2Ranking\(rankingId\) \? mb2Comparator/);
});

test('toutes les listes portent la date jusqu’au comparateur', () => {
  // Ma place, et le podium des médailles du jour : les deux lisent le magasin.
  const push = SERVEUR.match(/all\.push\(\{ u, s: Number\(rlist\[rankingId\]\.score\), data: rlist\[rankingId\]\.data,\s*\n\s*at: rlist\[rankingId\]\.updatedAt \|\| '' \}\);/g) || [];
  assert.strictEqual(push.length, 2,
    'computePosition ET collectTop3ForRanking doivent porter la date');
  // Le tableau des scores du light la portait déjà (`at`).
  assert.match(SERVEUR, /all\.push\(\{ u, s: Number\(rlist\[rkId\]\.score\), data: rlist\[rkId\]\.data, at: rlist\[rkId\]\.updatedAt \|\| '' \}\);/);
  // Le livre des records du Club : la date voyage avec le score.
  assert.match(SERVEUR, /all\.sort\(\(a, b\) => cmp\(\{ s: a\.score, data: a\.data, at: a\.updatedAt \},/);
  // L'archive d'un jour passé se relit dans l'ordre qu'elle avait ce jour-là.
  assert.match(SERVEUR, /scores\.sort\(\(a, b\) => cmp\(\{ s: Number\(a\.score\), at: dat\(a\) \},/);
  // Le seed d'un tournoi : la requête doit rendre la date pour pouvoir trier.
  assert.match(DB, /SELECT username, score, data, updated_at FROM tournament_round_scores/);
  assert.match(SERVEUR, /at: r\.updated_at \? new Date\(r\.updated_at\)\.toISOString\(\) : '',/);
  // Les deux classements « Championnat » du light passent par le comparateur
  // commun au lieu de leur tri maison sur le pseudo.
  assert.match(SERVEUR, /bd\.sort\(scoreComparator\('bandas_champion'\)\);/);
  assert.match(SERVEUR, /tt\.sort\(scoreComparator\('snake3_tournoi'\)\);/);
});

test('un rattrapage de donnée ne redate pas le record', () => {
  // `shouldBackfillData` : même score, une donnée annexe qui manquait. Ce
  // n'est pas un score neuf — le redater ferait reculer le joueur derrière
  // ceux qui l'ont égalé entre-temps.
  assert.match(SERVEUR, /updatedAt: scoreImproved\s*\n\s*\? new Date\(\)\.toISOString\(\)\s*\n\s*: \(\(prev && prev\.updatedAt\) \|\| new Date\(\)\.toISOString\(\)\),/);
  // Et un score qui n'améliore rien n'écrit rien du tout : la date du record
  // tient d'elle-même.
  assert.match(SERVEUR, /const scoreImproved = isScoreBetter\(rankingId, n, newData, oldScore, oldData\);/);
  assert.match(SERVEUR, /if \(scoreImproved \|\| shouldBackfillData\) \{/);
});
