#!/usr/bin/env node
//
// QUI A DISPARU ? — retrouver le compte qui manque à l'appel.
//
// Le nombre de joueurs de l'admin est le nombre de lignes de la table `users`.
// Quand il baisse d'une unité, ce script dit de qui il s'agit. Il ne modifie
// RIEN : trois lectures, et de quoi conclure.
//
//   1. LES SUPPRESSIONS DÉCLARÉES. Une suppression passée par le site laisse
//      le pseudo dans `deleted_usernames`, avec la date et la cause
//      (`joueur`, `admin`, `inactivite` — ou `renommage:…`, qui n'est PAS une
//      suppression et ne fait pas baisser le compte). S'il y a une ligne du
//      jour, l'affaire est close.
//
//   2. LES ORPHELINS. Une suppression passée par le site anonymise d'abord le
//      joueur partout (son pseudo devient `compte_supprime`). Une ligne
//      effacée À LA MAIN — psql, la console de l'hébergeur, un script — saute
//      cette étape : le pseudo reste écrit sur le forum, dans les dons de
//      kikooz, au trombinoscope… sans plus aucun compte derrière. C'est
//      exactement la signature qu'on cherche.
//
//   3. LES TROUS. `users.id` est une séquence : un compte effacé laisse un
//      creux. Le creux ne rend pas le pseudo, mais les identifiants suivent
//      l'ordre des inscriptions — les voisins du trou DATENT donc le compte
//      manquant, ce qui suffit souvent à mettre un nom dessus.
//
// Où le lancer :
//   · sur l'hébergeur (le shell du service web), où DATABASE_URL est déjà là :
//         node scripts/qui-a-disparu.js
//   · ou depuis sa machine, avec l'URL EXTERNE de la base :
//         DATABASE_URL='postgres://…' node scripts/qui-a-disparu.js
//
// `--jours N` élargit la fenêtre des suppressions déclarées (7 par défaut).
//
'use strict';

const { Pool } = require('pg');

const JOURS = (() => {
  const i = process.argv.indexOf('--jours');
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
})();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL manque. Sur l’hébergeur elle est déjà posée ; '
    + 'depuis ta machine, prends l’URL EXTERNE de la base :\n'
    + "  DATABASE_URL='postgres://…' node scripts/qui-a-disparu.js");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : undefined,
});

// Les comptes du serveur qui n'ont jamais eu de ligne en base (ils vivent en
// mémoire) : ils NOMMENT des messages du forum sans exister dans `users`, et
// seraient donc de faux orphelins.
const PNJ = ['gaspard', 'mdamirma', 'gromelin', 'kiloute79', 'vieuxpruneau', 'frutiparc', 'admin'];

// Les tables qui gardent un pseudo NU (elles survivent à l'effacement du
// compte, faute de clé étrangère) — la liste d'anonymisation de db.js.
const PORTEUSES = [
  ['forum_topics', 'author_username'],
  ['forum_posts', 'author_username'],
  ['challenge_score_archive', 'username'],
  ['shop_purchases', 'username'],
  ['kikooz_gifts', 'giver'],
  ['kikooz_gifts', 'recipient'],
  ['moderation_logs', 'target_username'],
  ['trombinoscope', 'pseudo'],
  ['tournament_players', 'username'],
];

const titre = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 66 - t.length)));

async function main() {
  const { rows: [{ n: total }] } = await pool.query('SELECT count(*)::int AS n FROM users');
  console.log(`La table \`users\` compte ${total} ligne(s) — c'est le nombre affiché par l'admin.`);

  // 1 ────────────────────────────────────────────────────────────────────────
  titre(`Suppressions déclarées (${JOURS} derniers jours)`);
  const { rows: declarees } = await pool.query(
    `SELECT username, COALESCE(NULLIF(deleted_by, ''), '?') AS cause, deleted_at
       FROM deleted_usernames
      WHERE deleted_at > now() - make_interval(days => $1)
      ORDER BY deleted_at DESC`,
    [JOURS]
  );
  if (!declarees.length) {
    console.log('Aucune. Le site n’a supprimé aucun compte sur la période :');
    console.log('la ligne est partie par un autre chemin (psql, console de l’hébergeur, script).');
  } else {
    for (const r of declarees) {
      const quand = r.deleted_at instanceof Date ? r.deleted_at.toISOString().replace('T', ' ').slice(0, 19) : r.deleted_at;
      const note = r.cause.startsWith('renommage')
        ? '  ← un changement de pseudo : le compte existe toujours, le nombre n’a pas bougé'
        : '';
      console.log(`  ${quand}  ${r.username}  (par ${r.cause})${note}`);
    }
  }

  // 2 ────────────────────────────────────────────────────────────────────────
  titre('Pseudos encore écrits partout, mais sans compte');
  const union = PORTEUSES
    .map(([t, c]) => `SELECT LOWER(${c}) AS u, '${t}' AS ou FROM ${t} WHERE ${c} IS NOT NULL`)
    .join(' UNION ALL ');
  const { rows: orphelins } = await pool.query(
    `WITH noms AS (${union})
     SELECT u, string_agg(DISTINCT ou, ', ' ORDER BY ou) AS tables, count(*)::int AS traces
       FROM noms
      WHERE u <> '' AND u <> 'compte_supprime'
        AND u <> ALL($1)
        AND NOT EXISTS (SELECT 1 FROM users v WHERE LOWER(v.username) = noms.u)
        AND NOT EXISTS (SELECT 1 FROM deleted_usernames d WHERE d.username = noms.u)
      GROUP BY u
      ORDER BY traces DESC`,
    [PNJ]
  );
  if (!orphelins.length) {
    console.log('Aucun. Personne n’a été effacé à la main — ou le disparu n’avait rien écrit.');
  } else {
    console.log('Chacun est un compte parti sans anonymisation. S’il n’y en a qu’un, c’est lui.');
    for (const r of orphelins) console.log(`  ${r.u}  (${r.traces} trace(s) : ${r.tables})`);
  }

  // 3 ────────────────────────────────────────────────────────────────────────
  titre('Trous dans les identifiants (ils datent le compte manquant)');
  const { rows: trous } = await pool.query(
    `SELECT u.id AS avant, u.created_at AS inscrit_le,
            (SELECT min(v.id) FROM users v WHERE v.id > u.id) AS apres
       FROM users u
      WHERE (SELECT min(v.id) FROM users v WHERE v.id > u.id) > u.id + 1
      ORDER BY u.id DESC
      LIMIT 10`
  );
  if (!trous.length) {
    console.log('Aucun : la séquence est continue, aucun compte n’a jamais été effacé.');
  } else {
    console.log('Les dix derniers creux. Le compte manquant s’est inscrit entre ces deux dates.');
    for (const r of trous) {
      const d = r.inscrit_le instanceof Date ? r.inscrit_le.toISOString().slice(0, 10) : r.inscrit_le;
      const manquants = r.apres - r.avant - 1;
      console.log(`  id ${r.avant} → ${r.apres} : ${manquants} manquant(s), voisin inscrit le ${d}`);
    }
  }

  console.log('');
}

main()
  .catch((e) => { console.error('Erreur :', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
