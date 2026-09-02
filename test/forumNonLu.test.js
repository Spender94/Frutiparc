'use strict';
/*
 * LE FORUM S'OUVRE LÀ OÙ LA LECTURE S'ÉTAIT ARRÊTÉE
 * ═════════════════════════════════════════════════
 *
 * « Le forum s'ouvre directement sur la page avec les messages les plus
 *   récents, même si le user n'a pas encore lu le premier message. »
 *
 * Ouvrir sur la dernière page est le réflexe des forums, et il est juste pour
 * un fil qu'on suit. Il est absurde pour un fil qu'on n'a JAMAIS ouvert : on
 * arrive au milieu d'une conversation dont on n'a pas le début.
 *
 * Le serveur sait pourtant répondre : `forum_topic_reads` garde une date de
 * lecture par sujet et par joueur. « page=nonlu » s'en sert pour trouver le
 * PREMIER message non lu, ouvre la page qui le contient, et rend son
 * identifiant — le client y défile et l'entoure.
 *
 * ── ET LA MARQUE DE LECTURE A DÛ CHANGER AUSSI ────────────────────────────
 *
 * Elle valait `now()` : ouvrir la page 1 d'un fil de trois pages déclarait
 * lues les deux qu'on n'avait pas vues. Elle vaut maintenant la date du
 * DERNIER MESSAGE AFFICHÉ — ce qui rend le saut juste, et le voyant des
 * non-lus honnête (un fil lu à moitié reste à moitié non lu).
 *
 * On passe l'IDENTIFIANT de ce message, pas sa date : `created_at` est précis
 * à la microseconde, et une date qui fait l'aller-retour par JavaScript revient
 * arrondie à la milliseconde, donc JUSTE AVANT l'originale. La marque tombait
 * ainsi sous le dernier message lu, qui redevenait non lu au rechargement — la
 * page ne bougeait plus d'un cran. (Constaté au banc avant correction.)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const FORUM = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');

test('le serveur sait trouver le premier message non lu, et sa page', () => {
  // Un sujet jamais ouvert n'a pas de ligne de lecture : COALESCE le fait
  // valoir « lu à l'époque zéro », donc son premier non-lu est le message 1.
  assert.match(DB, /async function forumFirstUnreadPost\(username, topicId\) \{/);
  assert.match(DB, /COALESCE\(MAX\(read_at\), TIMESTAMP 'epoch'\) AS lu/);
  // Le rang se compte dans l'ORDRE D'AFFICHAGE — le même que la pagination,
  // sans quoi la page calculée ne contiendrait pas le message visé.
  assert.match(DB, /ROW_NUMBER\(\) OVER \(ORDER BY created_at ASC, id ASC\) AS rang/);
  assert.match(DB, /ORDER BY created_at ASC, id ASC LIMIT \$2 OFFSET \$3/);
  // Et la route en tire la page, sans oublier de la rendre au client.
  assert.match(SERVEUR, /if \(pageParam === 'nonlu'\) \{/);
  assert.match(SERVEUR, /page = Math\.max\(1, Math\.ceil\(nonLu\.rang \/ FORUM_POSTS_PER_PAGE\)\);/);
  assert.match(SERVEUR, /premierNonLu = nonLu\.id;/);
  assert.match(SERVEUR, /^\s*premierNonLu,$/m);
});

test('tout lu — ou visiteur anonyme — on retombe sur la dernière page', () => {
  // Le comportement d'avant reste le filet : un fil sans rien de neuf s'ouvre
  // à la fin, et quelqu'un qui n'est pas connecté n'a pas de marque à lire.
  const bloc = SERVEUR.slice(SERVEUR.indexOf("if (pageParam === 'nonlu')"),
    SERVEUR.indexOf("await db.forumIncrementViews"));
  assert.match(bloc, /currentUserForGate\s*\n?\s*\? await db\.forumFirstUnreadPost/);
  assert.match(bloc, /: null;/);
  assert.match(bloc, /const totalPosts = await db\.forumCountPosts\(topicId\);/);
  assert.match(bloc, /page = Math\.max\(1, Math\.ceil\(totalPosts \/ FORUM_POSTS_PER_PAGE\)\);/);
});

test('la marque de lecture s’arrête au dernier message VU, et n’avance jamais à reculons', () => {
  assert.match(DB, /async function forumMarkTopicRead\(username, topicId, jusquAPostId\) \{/);
  // L'identifiant, pas la date : SQL relit `created_at` lui-même et garde la
  // microseconde (cf. l'en-tête de ce fichier).
  assert.match(DB, /FROM forum_posts p JOIN forum_topics t ON t\.id = p\.topic_id\s*\n\s*WHERE p\.id = \$3::int AND p\.topic_id = \$2\)/);
  // Le dernier message du sujet lu → le sujet est lu : la marque prend le plus
  // grand de sa date et de celle que le sujet porte (`last_post_at`, posée par
  // un now() à part, quelques microsecondes APRÈS le message — sans quoi un fil
  // lu jusqu'au bout restait « non lu » et seul « tout marquer comme lu »
  // l'éteignait). Un message qui n'est pas le dernier laisse la marque à sa date.
  assert.match(DB, /THEN GREATEST\(p\.created_at, t\.last_post_at\)\s*\n\s*ELSE p\.created_at/);
  assert.match(DB, /AND \(p2\.created_at, p2\.id\) > \(p\.created_at, p\.id\)\)/);
  assert.match(DB, /SET read_at = GREATEST\(forum_topic_reads\.read_at, EXCLUDED\.read_at\)/);
  // Sans argument — « tout marquer comme lu » — c'est bien `now()`.
  assert.match(DB, /now\(\)\)\s*\n\s*ON CONFLICT/);
  // Et le sujet, lui, porte désormais la date DU MESSAGE (plus un now() à
  // part) : les deux horloges ne peuvent plus se manquer d'une microseconde.
  assert.match(DB, /'UPDATE forum_topics SET last_post_at = \$3, last_post_by = \$2 WHERE id = \$1',\s*\n\s*\[topicId, username, rows\[0\]\.created_at\]/);
  // Et la route passe l'identifiant du dernier message de la page ouverte.
  assert.match(SERVEUR, /const dernierVu = posts\.length \? posts\[posts\.length - 1\]\.id : null;/);
  assert.match(SERVEUR, /await db\.forumMarkTopicRead\(currentUser, topicId, dernierVu\);/);
});

test('le client ouvre sur le non-lu, y défile, et l’entoure', () => {
  // Plus de saut à la dernière page par défaut.
  assert.match(FORUM, /var pageParam = \(page == null\) \? 'nonlu' : page;/);
  assert.match(FORUM, /if \(data\.premierNonLu\) allerAuNonLu\(data\.premierNonLu\);/);
  assert.match(FORUM, /function allerAuNonLu\(postId\) \{/);
  assert.match(FORUM, /el\.classList\.add\('post-nonlu'\);/);
  // On vise le DÉBUT du message (ils sont hauts), et après la mise en page.
  assert.match(FORUM, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  assert.match(FORUM, /requestAnimationFrame\(function \(\) \{\s*\n\s*requestAnimationFrame/);
  // La marque s'efface au premier geste : elle ne doit pas rester à traîner.
  assert.match(FORUM, /window\.addEventListener\('click', oter, true\);/);
  assert.match(FORUM, /setTimeout\(oter, 8000\);/);
  // Un LISERÉ, pas un fond : les deux fonds de la page alternent déjà.
  assert.match(FORUM, /\.post\.post-nonlu \{\s*\n\s*outline: 2px solid/);
  // Les clics de pagination gardent leur page exacte.
  assert.match(FORUM, /function topicPage\(p\) \{ pousserHistoire\('topic', currentTopicId, p\); loadTopic\(currentTopicId, p\); \}/);
});
