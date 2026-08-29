'use strict';
/*
 * « MES PRÉFÉRENCES » — LA FENÊTRE D'ÉPOQUE, ET LES NOTIFICATIONS DU FORUM.
 *
 * « Fais évoluer la fenêtre "Préférences" (je t'invite à récupérer le style de
 *   la vraie fenêtre du flash) pour intégrer ceci : pouvoir sélectionner les
 *   topics pour lesquels je souhaite recevoir une notification lorsqu'une
 *   personne poste — par exemple mettre un ❤ sur les sujets qui m'intéressent
 *   le plus ; pouvoir désactiver complètement les notifications du forum ;
 *   pouvoir laisser les notifications activées pour tous les topics, comme
 *   actuellement. Intègre également les autres fonctionnalités de la fenêtre
 *   préférences. »
 *
 * ── LA FENÊTRE ────────────────────────────────────────────────────────────
 * `box.Pref` (0xc9a6e) pose `winType = "winPref"` et prend son titre dans la
 * table : `pref.title` vaut « Mes préférences ». `win.Pref.initFrameSet`
 * (0x9146b) monte trois cadres — un `cpTree` de 140 au style `frSystem` (le
 * blanc) dans `margin.left`, un `cpDocument` au style `frSheet` (le vert) au
 * centre, et dans `margin.bottom` un `cpDocument` `frSystem` dont le document
 * est écrit à la main :
 *
 *   <p><l><s w="4"/><b t="{pref.use_default}" l="butPushStandard"
 *                      o="win" m="useDefault"/><s w="10"/>
 *         <b t="{pref.save}" l="butPushStandard" o="win" m="save"/>
 *         <s w="4"/></l></p>
 *
 * Le cycle d'édition n'est pas celui d'un panneau moderne : `updateFromForm`
 * (0xca16a) recopie le widget dans une COPIE, `useDefault` (0xca17f) remet
 * TOUTE la copie à ses valeurs d'origine sans rien enregistrer, et `save`
 * (0xca24e) enregistre PUIS ferme la fenêtre.
 *
 * ── LES PUCES ─────────────────────────────────────────────────────────────
 * `analysePrefForm` ne pose aucun `bulletLink` : les capsules retombent sur
 * `Standard.getTreeStyle().bullet`, soit `standardBullet` (#404). Une rubrique
 * est un `caps.Dir` — image `min(treeStyle.length - 2, niveau) + 2`, donc 2 :
 * la bille rouge de 16 (#399). Une préférence est un `caps.Exe` — sans
 * `bulletFrame`, image 1 : le disque de 6 (#398).
 *
 * ── LE FORUM ──────────────────────────────────────────────────────────────
 * Le forum de 2005 ne notifiait rien : ni voyant, ni poussée. Les deux
 * existent ici, et rien ne les réglait. `forum_notify` (id 14) prolonge donc
 * la table au premier identifiant libre, avec trois positions — 0 rien,
 * 1 tous les sujets (le défaut, le comportement d'avant), 2 seulement les
 * sujets marqués d'un ❤ (table `forum_topic_follows`).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const FORUM = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');
const LANG = fs.readFileSync(path.join(ROOT, 'frutiparc/lang_french.as'), 'latin1');
const OPEN = fs.readFileSync(path.join(ROOT, 'frutiparc/openFunctions.as'), 'latin1');

/* ── 1. LA PRÉFÉRENCE 14 ──────────────────────────────────────────────────── */

test('forum_notify prolonge prefDefs au premier identifiant libre', () => {
  // Les treize d'époque s'arrêtent à 13 : la nôtre prend 14, et pas un autre.
  assert.match(SERVEUR, /\{ id: 13, type: 'b', name: 'ch_dsp_ban',\s+def: 'Y' \},/);
  assert.match(SERVEUR, /\{ id: 14, type: 'i', name: 'forum_notify',\s+def: encode62\(1\) \},/);
  // Trois positions nommées — pas de 0/1/2 nus dans le code.
  assert.match(SERVEUR, /const FORUM_NOTIFY_AUCUNE = 0;/);
  assert.match(SERVEUR, /const FORUM_NOTIFY_TOUS = 1;/);
  assert.match(SERVEUR, /const FORUM_NOTIFY_SUIVIS = 2;/);
});

test('une valeur absente vaut le DÉFAUT, pas zéro', () => {
  // `prefsavepartial` efface l'entrée quand la valeur retombe sur le défaut :
  // la chaîne stockée ne porte que les écarts, et lire « rien » doit rendre le
  // défaut de `prefDefs` — sans quoi couper les notifications serait
  // indiscernable de n'y avoir jamais touché.
  const f = /function prefBrute\(user, name\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'prefBrute doit exister');
  assert.match(f[0], /return brut === '' \? def\.def : brut;/);
  assert.match(SERVEUR, /function prefBool\(user, name\) \{\s*\n\s*return prefBrute\(user, name\) !== 'N';/);
  assert.match(SERVEUR, /function prefEntier\(user, name\) \{\s*\n\s*return decode62\(prefBrute\(user, name\)\);/);
});

test('un mode aberrant retombe sur le comportement historique', () => {
  const f = /function forumNotifyMode\(user\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'forumNotifyMode doit exister');
  // Seuls 0 et 2 sont reconnus ; tout le reste — y compris une main sur la
  // base — vaut « tous les sujets ». Éteindre un voyant par accident serait
  // pire que de l'allumer.
  assert.match(f[0],
    /return \(v === FORUM_NOTIFY_AUCUNE \|\| v === FORUM_NOTIFY_SUIVIS\) \? v : FORUM_NOTIFY_TOUS;/);
});

/* ── 2. LE FORMULAIRE, SERVI AUX DEUX CLIENTS ─────────────────────────────── */

test('libellés et catégories sortent du gestionnaire : un seul formulaire', () => {
  // `/do/prefForm` (le SWF) et `/api/light/prefs` (le bureau light) lisent les
  // mêmes constantes. Deux listes à tenir à jour, c'en serait une de trop.
  assert.match(SERVEUR, /^const PREF_LABELS = \{$/m);
  assert.match(SERVEUR, /^const PREF_CATEGORIES = \[$/m);
  assert.match(SERVEUR, /\{ name: 'Forum',\s+ids: \[14\] \},/);
  const form = /app\.get\(\['\/do\/prefForm', '\/prefForm'\], \(req, res\) => \{[\s\S]*?\n\}\);/.exec(SERVEUR);
  assert.ok(form, 'le gestionnaire prefForm doit exister');
  assert.match(form[0], /for \(const cat of PREF_CATEGORIES\)/);
  assert.match(form[0], /PREF_LABELS\[def\.name\]/);
  const json = /function prefsEnJson\(user\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(json, 'prefsEnJson doit exister');
  assert.match(json[0], /PREF_CATEGORIES\.map/);
  assert.match(json[0], /PREF_LABELS\[def\.name\]/);
});

test('un choix se rend en radios, une par ligne', () => {
  // Le panneau de droite fait 200 au minimum (`showFrame` min 200×200) :
  // « Seulement mes sujets suivis » et ses voisines ne tiennent pas côte à
  // côte. Une `<l>` par valeur.
  const f = /function prefFormChoix\(choices\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'prefFormChoix doit exister');
  assert.match(f[0], /<l><s w="8"\/><r v="value" u="\$\{escapeXml\(encode62\(v\)\)\}">/);
  // La valeur voyage en base 62, comme dans la chaîne stockée.
  assert.match(SERVEUR, /choices: \(meta\.choices \|\| \[\]\)\.map\(\(\[v, lib\]\) => \(\{ v: encode62\(v\), label: lib \}\)\)/);
});

test('les trois positions demandées, dans cet ordre', () => {
  const bloc = /forum_notify:\s+\{ label: 'Notifications du forum',[\s\S]*?\] \},/.exec(SERVEUR);
  assert.ok(bloc, 'la préférence doit porter ses trois choix');
  assert.match(bloc[0], /\[FORUM_NOTIFY_TOUS,\s+'Pour tous les sujets'\]/);
  assert.match(bloc[0], /\[FORUM_NOTIFY_SUIVIS, 'Seulement mes sujets suivis \(❤\)'\]/);
  assert.match(bloc[0], /\[FORUM_NOTIFY_AUCUNE, 'Jamais'\]/);
});

test('les invitations offrent les NEUF modes de chooseInviteBehavior', () => {
  // La table est écrite en commentaire au-dessus de la fonction : neuf modes,
  // une action par défaut et, pour six d'entre eux, une exception prise dans
  // la liste noire ou la liste de contacts. Un menu à trois entrées aurait
  // amputé le réglage.
  assert.match(OPEN, /_global\.chooseInviteBehavior = function\(pref,user\)\{/);
  for (const c of ['case 0:', 'case 8:']) assert.ok(OPEN.includes(c), c);
  const modes = /const INVITE_MODES = \[[\s\S]*?\n\];/.exec(SERVEUR);
  assert.ok(modes, 'INVITE_MODES doit exister');
  for (let i = 0; i <= 8; i++) {
    assert.ok(new RegExp('\\[' + i + ', ').test(modes[0]), 'le mode ' + i + ' doit être offert');
  }
  assert.match(SERVEUR, /invite_channel_behavior:.*\n\s+choices: INVITE_MODES \},/);
  assert.match(SERVEUR, /invite_chat_behavior:.*\n\s+choices: INVITE_MODES \},/);
});

/* ── 3. L'ÉCRITURE ────────────────────────────────────────────────────────── */

test('on écrit ENTRÉE PAR ENTRÉE, jamais la chaîne entière', () => {
  // `/do/prefsave` remplace `user.prefs` par ce que le client envoie : un
  // client qui n'afficherait pas toutes les préférences effacerait celles
  // qu'il ignore. `appliquerPref` — celle de `prefsavepartial` — ne touche
  // qu'une entrée.
  const f = /function appliquerPref\(username, user, prefId, rawVal\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'appliquerPref doit exister');
  assert.match(f[0], /const parsed = parsePrefString\(user\.prefs \|\| ''\);/);
  assert.match(f[0], /const isDefault = \(rawVal === '' \|\| rawVal === def\.def\);/);
  assert.match(f[0], /delete parsed\[prefId\];/);
  // Les deux chemins d'écriture y passent.
  const part = /app\.get\('\/do\/prefsavepartial', \(req, res\) => \{[\s\S]*?\n\}\);/.exec(SERVEUR);
  assert.match(part[0], /appliquerPref\(session\.user, users\[session\.user\],/);
  const post = /app\.post\('\/api\/light\/prefs', \(req, res\) => \{[\s\S]*?\n\}\);/.exec(SERVEUR);
  assert.ok(post, 'POST /api/light/prefs doit exister');
  assert.match(post[0], /appliquerPref\(username, user, def\.id,/);
  assert.ok(!post[0].includes('user.prefs ='), 'il n’écrase jamais la chaîne lui-même');
});

/* ── 4. LES SUJETS SUIVIS ─────────────────────────────────────────────────── */

test('la table des ❤ existe, avec sa clé et ses deux index', () => {
  assert.match(DB, /CREATE TABLE IF NOT EXISTS forum_topic_follows \(/);
  assert.match(DB, /topic_id\s+INTEGER NOT NULL REFERENCES forum_topics\(id\) ON DELETE CASCADE,/);
  assert.match(DB, /PRIMARY KEY \(username, topic_id\)\n\s+\);\n\s+CREATE INDEX IF NOT EXISTS idx_forum_topic_follows_user/);
  assert.match(DB, /CREATE INDEX IF NOT EXISTS idx_forum_topic_follows_topic ON forum_topic_follows\(topic_id\);/);
  for (const f of ['forumSetTopicFollow', 'forumIsTopicFollowed', 'forumTopicFollowers']) {
    assert.ok(new RegExp('^  ' + f + ',$', 'm').test(DB), f + ' doit être exporté');
  }
});

test('le décompte du voyant suit le mode', () => {
  const f = /async function forumCountUnread\(username, mode\) \{[\s\S]*?\n\}/.exec(DB);
  assert.ok(f, 'forumCountUnread doit prendre le mode');
  // 0 : rien du tout, sans même interroger la base.
  assert.match(f[0], /if \(mode === FORUM_NOTIFY_AUCUNE\) return 0;/);
  // 2 : la jointure réduit le décompte aux sujets suivis.
  assert.match(f[0], /const suivisSeuls = mode === FORUM_NOTIFY_SUIVIS;/);
  assert.match(f[0], /\$\{suivisSeuls \? 'JOIN forum_topic_follows w ON w\.topic_id = t\.id AND w\.username = \$1' : ''\}/);
  // Et l'ancienne règle est intacte : on ne se compte pas soi-même.
  assert.match(f[0], /LOWER\(COALESCE\(t\.last_post_by, ''\)\) <> LOWER\(\$1\)/);
});

test('les trois lecteurs du voyant passent le mode', () => {
  assert.match(SERVEUR, /db\.forumCountUnread\(username, forumNotifyModeDe\(username\)\)/);
  assert.match(SERVEUR, /db\.forumCountUnread\(effectiveLogin, forumNotifyModeDe\(effectiveLogin\)\)/);
  assert.match(SERVEUR, /forumUnread = await db\.forumCountUnread\(username, forumNotifyMode\(u\)\)/);
});

test('le voyant poussé par un nouveau message respecte le réglage de CHACUN', () => {
  // (Le troisième paramètre, `sujet`, est venu ensuite : il NOMME le fil pour
  // ceux qui le suivent — cf. modérationLight.test.js.)
  const f = /function notifyForumNews\(authorUsername, suiveurs, sujet\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'notifyForumNews doit connaître les suiveurs');
  assert.match(f[0], /if \(mode === FORUM_NOTIFY_AUCUNE\) continue;/);
  assert.match(f[0], /const leSuit = suivi\.has\(qui\);/);
  assert.match(f[0], /if \(mode === FORUM_NOTIFY_SUIVIS && !leSuit\) continue;/);
  assert.match(f[0], /if \(qui === auteur\) continue;/, 'et jamais son auteur');
});

test('une réponse prévient ceux qui suivent le sujet', () => {
  const f = /async function pousserNotifSuiviForum\(auteur, topicId, titre, connus\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'pousserNotifSuiviForum doit exister');
  // Seul le mode 2 pousse : en mode 1, le forum n'a jamais rien poussé, et le
  // ❤ n'a pas à changer ça pour qui n'a rien demandé.
  assert.match(f[0], /if \(forumNotifyModeDe\(cible\) !== FORUM_NOTIFY_SUIVIS\) continue;/);
  assert.match(f[0], /if \(!cible \|\| cible === bas \|\| NPC_USERNAMES\.has\(cible\)\) continue;/);
  assert.match(f[0], /if \(estJoignableEnDirect\(cible\)\) \{/);
  assert.match(f[0], /PUSH_TTL\.forum/);
  // La liste est lue UNE fois par message, et partagée avec le voyant.
  assert.match(SERVEUR, /const suiveurs = process\.env\.DATABASE_URL\n\s+\? await db\.forumTopicFollowers\(topicId\)\.catch\(\(\) => \[\]\)/);
  assert.match(SERVEUR, /notifyForumNews\(username, suiveurs, \{ id: topicId, titre: topic\.title \}\);/);
  assert.match(SERVEUR, /pousserNotifSuiviForum\(username, topicId, topic\.title, suiveurs\)/);
});

test('« désactiver complètement » vaut aussi pour les citations', () => {
  const f = /function pousserNotifCitationsForum\(auteur, topicId, titre, contenu\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'pousserNotifCitationsForum doit exister');
  assert.match(f[0], /if \(forumNotifyModeDe\(cible\) === FORUM_NOTIFY_AUCUNE\) \{/);
  // En mode 2, en revanche, être cité reste personnel : la citation passe.
  assert.ok(!f[0].includes('FORUM_NOTIFY_SUIVIS'), 'le mode 2 ne coupe pas les citations');
});

test('la route du ❤ existe et garde les forums réservés', () => {
  const f = /app\.post\('\/api\/forum\/topic\/:id\/follow', async \(req, res\) => \{[\s\S]*?\n\}\);/.exec(SERVEUR);
  assert.ok(f, 'la route follow doit exister');
  assert.match(f[0], /if \(!username\) return res\.status\(401\)/);
  assert.match(f[0], /if \(staffOnly && !isForumStaff\(username\)\) return res\.status\(404\)/);
  // Sans corps, c'est une bascule : le bouton n'est pas une case à cocher.
  assert.match(f[0], /\? !!req\.body\.follow\s*\n\s+: !\(await db\.forumIsTopicFollowed\(username, topicId\)\);/);
});

test('la liste et le sujet disent si le ❤ est posé', () => {
  assert.match(DB, /const followedSelect = username \? '\(w\.username IS NOT NULL\) AS followed' : 'FALSE AS followed';/);
  assert.match(SERVEUR, /followed: !!t\.followed,/);
  assert.match(SERVEUR, /const followed = currentUser\n\s+\? await db\.forumIsTopicFollowed\(currentUser, topicId\)\.catch\(\(\) => false\)/);
  // Le client a besoin du mode pour dire si le cœur commande quelque chose.
  assert.match(SERVEUR, /forumNotify: currentUser \? forumNotifyModeDe\(currentUser\) : FORUM_NOTIFY_TOUS,/);
});

test('le forum montre le cœur, dans la liste comme dans le sujet', () => {
  assert.match(FORUM, /function boutonSuivi\(topicId, suivi, avecLibelle, mode\) \{/);
  assert.match(FORUM, /async function basculerSuivi\(topicId\) \{/);
  // Creux tant qu'on ne suit pas, plein une fois posé.
  assert.match(FORUM, /\(suivi \? '♥' : '♡'\)/);
  assert.match(FORUM, /if \(currentUser\) html \+= ' ' \+ boutonSuivi\(t\.id, t\.followed, false\);/);
  assert.match(FORUM, /html \+= boutonSuivi\(data\.topic\.id, data\.followed, true, data\.forumNotify\);/);
  // Et il dit à quoi il sert quand le réglage est ailleurs.
  assert.match(FORUM, /if \(mode !== undefined && Number\(mode\) !== 2\) \{/);
  assert.match(FORUM, /\.suivi-btn \{/);
});

/* ── 5. LA FENÊTRE ────────────────────────────────────────────────────────── */

test('le titre est celui de la table : « Mes préférences »', () => {
  assert.match(LANG, /_global\.langText\.pref\.title = "Mes pr\S*f\S*rences";/);
  assert.match(LANG, /_global\.langText\.pref\.save = "Enregistrer";/);
  assert.match(LANG, /_global\.langText\.pref\.use_default = "Valeurs par d\S*faut";/);
  assert.match(JS, /reglages:\s+\{ panneau: '#reglages-panel',\s+titre: 'Mes préférences',/);
  // Le gabarit vient d'`initFrameSet` : 140 pour l'arbre, 200 pour le panneau.
  assert.match(JS, /min: minFenetre\(140 \+ 200, 200\) \},/);
});

test('la fenêtre s’habille à l’ouverture, et relit ses valeurs à chaque fois', () => {
  assert.match(JS, /if \(tab === 'reglages'\) habillerReglages\(panneau\);/);
  const f = /function habillerReglages\(panneau\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(f, 'habillerReglages doit exister');
  // L'écorce une fois ; les valeurs à chaque ouverture — `box.Pref.init`
  // redemande `do/prefForm` à chaque fois, et une fenêtre rouverte ne doit pas
  // rouvrir sur un vieux brouillon.
  assert.match(f[0], /if \(prefHabillee\) \{ chargerPrefs\(panneau\); return; \}/);
  assert.match(f[0], /outils\.appendChild\(prefBouton\('Valeurs par défaut', prefUseDefault\)\);/);
  assert.match(f[0], /outils\.appendChild\(prefBouton\('Enregistrer', prefSave\)\);/);
  // Les cartes de l'appli descendent DANS le document : leurs identifiants ne
  // bougent pas, tout le JS du mobile les cherche par `id`.
  assert.match(f[0], /var corps = panneau\.querySelector\('#reg-corps'\);/);
  assert.match(f[0], /if \(corps\) feuille\.appendChild\(corps\);/);
});

test('le brouillon : rien n’est écrit avant « Enregistrer »', () => {
  // `box.Pref` travaille sur `prefDetails`, une COPIE.
  assert.match(JS, /brouillon: Object\.assign\(\{\}, j\.values \|\| \{\}\),/);
  const def = /function prefUseDefault\(\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(def, 'prefUseDefault doit exister');
  // `useDefault` (0xca17f) remet TOUTE la copie, pas seulement la préférence
  // affichée — et n'enregistre pas.
  assert.match(def[0], /prefEtat\.brouillon = Object\.assign\(\{\}, prefEtat\.defauts\);/);
  assert.ok(!def[0].includes('fetch('), 'il n’enregistre rien');
  const save = /function prefSave\(\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(save, 'prefSave doit exister');
  assert.match(save[0], /method: 'POST',/);
  assert.match(save[0], /body: JSON\.stringify\(\{ sid: sid, prefs: prefEtat\.brouillon \}\),/);
  // `save` finit par `close()` : la fenêtre s'en va en enregistrant.
  assert.match(save[0], /fermerFenetre\('reglages-panel'\);/);
});

test('l’arbre porte les puces de standardBullet, aux tailles de getTreeStyle', () => {
  // Rubrique : `caps.Dir`, image 2 — la bille rouge de 16 ; texte 16, rangée
  // 16 + 6 = 22 (`Capsule.height = size + 6`).
  assert.match(CSS, /\.pf-arbre \.pf-rub \{\n  height: 22px; font-size: 16px; font-weight: normal;\n\}/);
  assert.match(CSS, /\.pf-rub::before \{[\s\S]*?puce-standard-2\.svg'\) center \/ 16px 16px no-repeat;/);
  // Préférence : `caps.Exe`, image 1 — le disque de 6 ; texte 10, rangée 16.
  assert.match(CSS, /\.pf-arbre \.pf-pref \{\n  height: 16px; padding-left: 11px; font-size: 10px;\n\}/);
  assert.match(CSS, /\.pf-pref::before \{[\s\S]*?puce-standard-1\.svg'\) center \/ 6px 6px no-repeat;/);
  // Les deux dessins viennent du SWF, pas d'un crayon.
  const p2 = fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites/puce-standard-2.svg'), 'utf8');
  assert.match(p2, /viewBox="-8 -8 16 16" width="16" height="16"/);
  assert.match(p2, /fill="#ec4242"/, 'la bille est rouge');
  const p1 = fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites/puce-standard-1.svg'), 'utf8');
  assert.match(p1, /viewBox="-3 -3 6 6" width="6" height="6"/);
});

test('les trois cadres ont les couleurs de leur style', () => {
  // `menuFrame` : `frSystem` — la boîte BLANCHE, contour `c0.shade` #DDDDDD.
  assert.match(CSS, /\.pf-arbre \{[\s\S]*?background: #FFFFFF; border-radius: 3px; box-shadow: 0 0 0 2px #DDDDDD;/);
  // `menuInfoFrame` : `frSheet` — le VERT, liseré `c0.shade` #ADE76B sur
  // chair `c0.main` #CCF599, encre `c0.overdark` #335511.
  assert.match(CSS, /\.pf-feuille \{[\s\S]*?#CCF599;\n  border: 2px solid #ADE76B; border-radius: 5px; box-shadow: 0 0 0 2px #DDDDDD;/);
  assert.match(CSS, /\.pf-feuille \{[\s\S]*?color: #335511;/);
  // La colonne fait 140, comme `args {width: 140}`.
  assert.match(CSS, /\.pf-fen \{[\s\S]*?grid-template-columns: 140px 1fr;/);
  // `frameCreate` : deux gélules `butPushStandard`, 10 px entre elles,
  // calées à gauche (`x.min = 4`, `x.ratio = 0`).
  assert.match(CSS, /\.pf-outils \{[\s\S]*?gap: 10px;\n  padding: 0 4px 6px;/);
  assert.match(CSS, /\.pf-but \{[\s\S]*?background: #FFAAAD; box-shadow: inset 0 0 0 1\.5px #F28687;/);
  assert.match(CSS, /\.pf-but \{[\s\S]*?color: #660000;/);
});

test('le radio est l’ovale de de.Radio, pas celui du navigateur', () => {
  // `de.Radio.drawGfx` (0x73e65) trace deux `drawCustomOval` dans
  // `docStyle.inputColor` — c1, le vert : coque `light` #DDFFBB liserée
  // `dark` #94DB39, point `darker` #66AA22. `th` vaut 16 : 13 et 8.
  assert.match(CSS, /\.pf-choix input \{[\s\S]*?flex: 0 0 13px; width: 13px; height: 13px;/);
  assert.match(CSS, /\.pf-choix input \{[\s\S]*?border-radius: 50%; background: #DDFFBB;\n  box-shadow: inset 0 0 0 1px #94DB39;/);
  assert.match(CSS, /\.pf-choix input::after \{\n  content: ""; width: 8px; height: 8px; border-radius: 50%; background: transparent;\n\}/);
  assert.match(CSS, /\.pf-choix input:checked::after \{ background: #66AA22; \}/);
  assert.match(CSS, /\.pf-choix input \{\n  appearance: none; -webkit-appearance: none;/);
});

test('les cartes de l’appareil se cachent vraiment', () => {
  // `display: block` bat le `display: none` que la feuille du navigateur donne
  // à `[hidden]` : sans cette ligne, elles resteraient sous chaque préférence.
  assert.match(CSS, /#reg-corps\[hidden\] \{ display: none; \}/);
  assert.match(JS, /if \(corps\) corps\.hidden = !\(p && p\.local !== undefined\);/);
  // Et l'écart est assumé par écrit : ces trois cartes n'ont pas d'original.
  assert.match(CSS, /ÉCART ASSUMÉ — la rubrique « Cet appareil »/);
  const loc = /var PF_LOCALES = \{[\s\S]*?\n  \};/.exec(JS);
  assert.ok(loc, 'PF_LOCALES doit exister');
  assert.match(loc[0], /name: 'Cet appareil',/);
  assert.match(loc[0], /\{ local: 0, label: 'Notifications' \},/);
});

/* ── 6. CE QUE LE BUREAU FAIT DES PRÉFÉRENCES ─────────────────────────────── */

test('six préférences agissent vraiment sur le bureau', () => {
  const f = /function appliquerPrefsLocales\(valeurs\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(f, 'appliquerPrefsLocales doit exister');
  assert.match(f[0], /FLUIDE = valeurs\.win_flMoveAnim !== 'N';/);
  assert.match(f[0], /heure: valeurs\.ch_dsp_h !== 'N',/);
  assert.match(f[0], /arrivees: valeurs\.ch_dsp_join !== 'N',/);
  assert.match(f[0], /departs: valeurs\.ch_dsp_leave !== 'N',/);
  assert.match(f[0], /expulsions: valeurs\.ch_dsp_kick !== 'N',/);
  assert.match(f[0], /bannissements: valeurs\.ch_dsp_ban !== 'N',/);
  // Et elles sont relues au démarrage, comme `do/onident` les remet au SWF.
  assert.match(JS, /function relirePrefs\(\) \{/);
  assert.match(JS, /chargerObjetsBureau\(\);\n[\s\S]{0,200}?relirePrefs\(\);/);
});

test('le fil du salon obéit aux cinq préférences d’affichage', () => {
  // Le défaut reste OUI partout : sur téléphone personne n'y touche, et
  // l'affichage ne bouge pas d'un pixel.
  const p = /var PREFS_CHAT = \{[\s\S]*?\n  \};/.exec(LIGHT);
  assert.ok(p, 'PREFS_CHAT doit exister');
  assert.match(p[0], /heure: true, arrivees: true, departs: true,/);
  assert.match(p[0], /expulsions: true, bannissements: true,/);
  assert.match(LIGHT, /var t = PREFS_CHAT\.heure \? cleanTime\(o\.time\) : "";/);
  assert.match(LIGHT, /if \(PREFS_CHAT\.arrivees\) \{/);
  assert.match(LIGHT, /if \(PREFS_CHAT\.departs\) \{\s+\/\/ `ch_dsp_leave`/);
  assert.match(LIGHT, /var kDire = \(tag === "ah"\) \? PREFS_CHAT\.bannissements : PREFS_CHAT\.expulsions;/);
  assert.match(LIGHT, /poserPrefsAffichage: function \(p\) \{/);
});

test('la liste des présents se met à jour même quand la ligne se tait', () => {
  // La préférence règle l'AFFICHAGE, pas la présence : `majSalonPartout` reste
  // en dehors du test, sinon couper les arrivées gèlerait la liste.
  const bloc = /if \(rj === state\.room \|\| aSonJournal\(rj\)\) \{[\s\S]*?\n          \}/.exec(LIGHT);
  assert.ok(bloc, 'le bloc d’arrivée doit exister');
  assert.ok(bloc[0].indexOf('majSalonPartout(rj);') < bloc[0].indexOf('if (PREFS_CHAT.arrivees)'),
    'la liste se met à jour AVANT le test de la préférence');
  // Se faire expulser SOI-MÊME se dit toujours.
  const kb = /var kDire = \(tag === "ah"\)[\s\S]*?\n        \}/.exec(LIGHT);
  assert.match(kb[0], /if \(sameName\(kWho, state\.user\)\) \{\s*\n\s+systemLine\("Tu as été " \+ kVerb/);
});
