/*
 * LA CORBEILLE, ET LA FIN D'UNE TOTOCHE.
 *
 * Deux corrections d'un même lot, qui n'ont en commun que d'avoir été relevées
 * par un joueur :
 *
 *   · la CORBEILLE de main.swf manquait au portage — icône du bureau, fenêtre
 *     verte (`frFileTrash`), et le seul geste qui supprime quoi que ce soit au
 *     bureau : lâcher un fichier dessus (`fileMng.moveToRecycleBin`). Son
 *     unique bouton, `flRemoveAll`, appelle `ff/erb` — qui ne vidait rien.
 *
 *   · la TOTOCHE « semblait se renouveler ». L'annonce « X a été totoché » est
 *     un ÉVÉNEMENT habillé en message (`<t u="admin">`, sans horodatage, pour
 *     que le SWF la rende en italique) : elle partait donc dans l'historique du
 *     salon, que le client light redemande à chaque (re)connexion. Sur
 *     téléphone, changer d'onglet coupe la socket — la ligne revenait à chaque
 *     retour. Et à l'échéance, rien ne se passait : personne ne disait que
 *     c'était fini.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3547;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SPRITES = path.join(ROOT, 'public/frutiz/sprites');

let proc = null;
let sid = null;
const USER = 'crb' + RUN;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5346', FRUTISCORE_PORT: '5347',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let pret = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) { pret = true; break; } } catch { /* pas prêt */ }
    await wait(250);
  }
  if (!pret) throw new Error('serveur indisponible');
  const entetes = { 'Content-Type': 'application/json' };
  const corps = JSON.stringify({ username: USER, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: entetes, body: corps });
  const rep = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: entetes, body: corps })).json();
  sid = rep.sid;
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('crb')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const q = (chemin, params) => `${BASE}${chemin}?sid=${encodeURIComponent(sid)}`
  + Object.entries(params || {}).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');

// ══ LA CORBEILLE ══════════════════════════════════════════════════════════

test('ff/erb VIDE la corbeille — il rendait le succès sans rien faire', async () => {
  // Deux brouillons, jetés.
  for (const sujet of ['Un mot', 'Un autre']) {
    const r = await (await fetch(q('/ff/mk', { t: 'mail', folder: 'draftbox',
      d: 'a@frutiparc.com\n' + sujet + '\nb@frutiparc.com\ncoucou' }))).text();
    const u = /<r u="([^"]+)"/.exec(r);
    assert.ok(u, 'le brouillon doit être créé');
    await fetch(q('/ff/mv', { f: u[1], folder: 'recyclebin' }));
  }
  const pleine = await (await fetch(q('/ff/ls', { uid: 'recyclebin' }))).text();
  assert.strictEqual((pleine.match(/<e /g) || []).length, 2, 'la corbeille tient les deux');

  // `FPFileMng.onEmptyRecycleBin` n'accepte QUE `<r k="0" />`.
  const rep = await (await fetch(q('/ff/erb'))).text();
  assert.match(rep, /<r k="0"\s*\/>/);
  const vide = await (await fetch(q('/ff/ls', { uid: 'recyclebin' }))).text();
  assert.doesNotMatch(vide, /<e /, 'et la corbeille est vraiment vide');
});

test('la fenêtre : même win.Explorer, peau VERTE (frFileTrash)', () => {
  const m = /'ex-corbeille':\s*\{[^}]*\}/.exec(JS);
  assert.ok(m, 'la rubrique doit être déclarée');
  assert.match(m[0], /fruit: 'winExplorer'/);
  assert.match(m[0], /l: 402, h: 402/);
  assert.match(JS, /corbeille:\s*\{[^}]*uid: 'recyclebin'/);
  // `getWinStyle().frFileTrash` = [green, green] ; la famille verte de
  // global.as donne main #CCF599, shade #ADE76B, darkest #558811.
  const peau = /\.ex-panel\.ex-corbeille \.ex-champ \{[\s\S]*?\}/.exec(CSS);
  assert.ok(peau, 'la corbeille n’a pas de peau');
  assert.match(peau[0], /#CCF599/, 'la chair est green.main');
  assert.match(peau[0], /border-color: #ADE76B/, 'le liseré est green.shade');
  assert.match(CSS, /--asc-glissiere: #ADE76B; --asc-liseret: #94DB39;/);
});

test('son unique bouton : « Vider la corbeille », et sa question d’époque', () => {
  // `onLoadList` : la corbeille est le seul dossier à porter `flRemoveAll`.
  assert.match(JS, /if \(uid === 'recyclebin'\) \{ t\.flRemoveAll = true; return t; \}/);
  assert.match(JS, /if \(t\.flRemoveAll\) \{/);
  assert.match(JS, /boutonNav\('empty_recyclebin', 'Vider la corbeille'/);
  // lang_french.as, mot pour mot.
  assert.match(JS, /Etes-vous sûr de vouloir vider votre corbeille \?/);
  assert.match(JS, /fetch\('\/ff\/erb\?sid='/);
  assert.ok(fs.existsSync(path.join(SPRITES, 'nav_empty_recyclebin.svg')), 'le dessin du bouton');
  assert.ok(fs.existsSync(path.join(SPRITES, 'ico_dossier_recyclebin.svg')), 'le dessin du dossier');
});

test('on jette EN GLISSANT — sur la tuile comme dans la fenêtre', () => {
  // `IconFileBox.onDrop` fait de l'icône un `dropBox` ; `moveToRecycleBin`
  // n'est rien d'autre que `move(uid, recyclebin)`.
  assert.match(LIGHT, /data-go="corbeille" data-depot="corbeille"/);
  assert.match(JS, /quoi === 'corbeille'\) pris = jeter\(info\)/);
  assert.match(JS, /if \(cle === 'corbeille'\) return jeter\(info\);/);
  const j = /function jeter\(info\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(j, 'jeter doit exister');
  // Ce qui vit sur le bureau quitte le bureau ; ce qui vit au gestionnaire de
  // fichiers part au serveur. Souvent les deux.
  assert.match(j[0], /if \(pose\) retirerObjetBureau\(pose\.uid\);/);
  // Et le move DIT d'où il vient (`info.parent`) : le carnet et la liste noire
  // montrent parfois le même nom, et le serveur doit savoir laquelle vider.
  // Un raccourci du bureau n'a pas de dossier d'origine — `info.parent` est
  // alors vide, et le serveur retire des deux listes.
  assert.match(j[0], /deplacerFichier\(info\.uid, 'recyclebin', info\.parent\)/);
  // Un disque ne se DÉTRUIT pas : il retourne au catalogue.
  assert.match(j[0], /if \(info\.type === 'disc'\)/);
  // Et la tuile n'existe que sur le bureau.
  assert.match(LIGHT, /class="home-tile home-tile-bureau" data-go="corbeille"/);
  assert.match(LIGHT, /if \(surBureau && BureauFrutiz\.ouvrirCorbeille\) BureauFrutiz\.ouvrirCorbeille\(\);/);
  assert.match(JS, /ouvrirCorbeille: function \(\) \{ ouvrirExplorateur\('corbeille'\); \}/);
});

// ══ LA TOTOCHE ════════════════════════════════════════════════════════════

test('une annonce de modération ne part PAS dans l’historique du salon', () => {
  /* C'est là qu'était le « ça se renouvelle » : `recordChannelHistory` écarte
     déjà les arrivées, les départs et les expulsions — « transient presence
     events » — mais l'annonce du totoché est habillée en `<t u="admin">` pour
     que le SWF la rende en italique, et se rangeait donc AVEC LES MESSAGES.
     Le client light redemande les cinq dernières minutes à chaque (re)join. */
  const a = /function annonceModeration\(channelName, corps\) \{[\s\S]*?\n\}/.exec(SRV);
  assert.ok(a, 'annonceModeration doit exister');
  assert.doesNotMatch(a[0], /recordChannelHistory/, 'elle ne RANGE rien');
  assert.match(a[0], /sendToClient\(sock, xmlStr\)/, 'elle diffuse quand même');
  // Les trois endroits qui totochent l'emploient : l'auto-modération, /totoch,
  // et la commande `mute` de la fiche.
  assert.strictEqual((SRV.match(/annonceModeration\(/g) || []).length, 4,
    'la fonction, plus ses trois appels');
  assert.doesNotMatch(SRV, /broadcastToChannel\([^)]*announceTotoche/,
    'plus aucune annonce de totoché ne passe par la diffusion qui archive');
});

test('à l’échéance, la peine se lève d’elle-même', () => {
  /* `mutedUntil` était posé et plus jamais touché : le client levait sa
     muselière tout seul, mais rien ne le lui DISAIT, et la pastille du totoché
     restait accrochée au nom dans la liste des présents. */
  const p = /function programmerFinDeTotoche\(username\) \{[\s\S]*?\n\}/.exec(SRV);
  assert.ok(p, 'programmerFinDeTotoche doit exister');
  assert.match(p[0], /delete user\.mutedUntil;/);
  assert.match(p[0], /CMD\.endmute/, 'elle envoie `bc` — « Tu peux de nouveau parler »');
  assert.match(p[0], /diffuserStatut\(username\)/, 'et rediffuse le statut aux salons');
  // Une peine reposée entre-temps n'est pas celle-ci.
  assert.match(p[0], /if \(Number\.isFinite\(fin\) && fin > Date\.now\(\) \+ 1000\) return programmerFinDeTotoche\(username\);/);
  // Les quatre endroits qui posent ou lèvent une peine la programment.
  assert.ok((SRV.match(/programmerFinDeTotoche\(/g) || []).length >= 5,
    'la fonction, ses trois poses et la levée manuelle');
});

test('l’horodatage de la peine est de l’UTC, et se lit comme tel', () => {
  /* « 2026-08-29.12:34:29 » sort de `toISOString()` : c'est de l'UTC sans
     marqueur. Le lire par `replace('.', ' ')` le fait passer pour de l'heure
     LOCALE — sur un serveur à Paris, la peine finissait deux heures trop tard
     l'été. Le même calcul, correct, vivait déjà dans /api/light/profile. */
  const g = /function getMuteInfoForUser\(username\) \{[\s\S]*?\n\}/.exec(SRV);
  assert.ok(g);
  assert.match(g[0], /new Date\(raw\.replace\('\.', 'T'\) \+ 'Z'\)/);
  const v = /function getMuteValue\(user\) \{[\s\S]*?\n\}/.exec(SRV);
  assert.ok(v);
  assert.match(v[0], /new Date\(raw\.replace\('\.', 'T'\) \+ 'Z'\)/);
});

test('la totoche se met sur la bouille DÈS qu’elle tombe, et dans tous les salons', () => {
  /* `getStatusCode` force l'humeur 7 (« Totoché ») tant que la peine court —
     mais un statut ne se redemande pas tout seul, il se POUSSE. Seule la
     commande `mute` de la fiche le poussait ; `/totoch` et l'auto-modération,
     elles, ne prévenaient personne : le salon gardait l'humeur d'avant, et la
     totoche n'apparaissait qu'au prochain `trace` de hasard — souvent jamais,
     donc jamais pendant les dix minutes. */
  const d = /function diffuserStatut\(username\) \{[\s\S]*?\n\}/.exec(SRV);
  assert.ok(d, 'diffuserStatut doit exister');
  assert.match(d[0], /CMD\.trace/, 'elle pousse une trace');
  assert.match(d[0], /getStatusCode\(ud, username\)/, 'avec le statut qui porte l’humeur 7');
  // TOUS les salons où la personne se trouve : on est présent dans plusieurs à
  // la fois, et les autres resteraient sur l'ancienne bouille.
  assert.match(d[0], /for \(const \[chanName, channel\] of Object\.entries\(channels\)\)/);
  assert.match(d[0], /channel\.users\.has\(username\)/);

  // Les deux bouts de la peine, aux quatre endroits : l'auto-modération,
  // /totoch, la commande `mute` de la fiche, la levée `unmute`, et l'échéance.
  assert.ok((SRV.match(/diffuserStatut\(/g) || []).length >= 6,
    'la fonction, ses trois poses, la levée manuelle et l’échéance');
  const auto = /Auto-moderation: forbidden words[\s\S]*?\n    break;\n  \}/.exec(SRV);
  assert.ok(auto, 'la branche d’auto-modération');
  assert.match(auto[0], /diffuserStatut\(client\.username\)/);
  const cmd = /if \(isModerator\(client\.username\) && text\.startsWith\('\/totoch '\)\) \{[\s\S]*?\n      break;\n    \}/.exec(SRV);
  assert.ok(cmd, 'la commande /totoch');
  assert.match(cmd[0], /diffuserStatut\(targetUser\)/);
});

test('l’humeur 7 est un MASQUE : le light ne la reprend pas à son compte', () => {
  /* Le light garde le dernier statut que le serveur dit de lui (`statutMien`)
     pour ne pas effacer le voyant de jeu au changement d'humeur suivant.
     Pendant la peine, ce statut porte le 7 forcé : le renvoyer, c'était le
     faire enregistrer comme l'humeur VRAIE du joueur — et laisser la bouille
     totochée une fois la peine levée. L'humeur 7 n'a d'ailleurs pas de bouton
     dans la barre : elle n'est jamais un choix. */
  assert.match(LIGHT, /if \(\(state\.mutedUntil \|\| 0\) > Date\.now\(\)\) \{\s*\n\s*mien = mien\.substring\(0, 3\) \+ String\(state\.statutMien \|\| "0000"\)\.charAt\(3\);/);
  assert.match(LIGHT, /if \(em === "7" && !\(champs && champs\.emote !== undefined\)\) em = "0";/);
  // Et la barre ne propose bien que les humeurs 0 à 6.
  const barre = /var HOME_EMOTES = \[[\s\S]*?\n  \];/.exec(LIGHT);
  assert.ok(barre, 'la barre d’humeurs');
  assert.doesNotMatch(barre[0], /e: 7/, '« Totoché » n’a pas de bouton');
});

test('côté client, la ligne de la peine s’en va avec la peine', () => {
  // « Quand une totoche est finie, elle est terminée, le message doit
  // disparaître. »
  assert.match(LIGHT, /function oublierLeMuselage\(\) \{/);
  assert.match(LIGHT, /querySelectorAll\("\[data-totoche\]"\)/);
  assert.match(LIGHT, /if \(o\.totoche\) row\.setAttribute\("data-totoche", "1"\);/);
  assert.match(LIGHT, /systemLine\("Tu as été réduit au silence \(totoché\) pour " \+ mMin \+ " minutes\.",\s*\n\s*null, \{ totoche: true \}\);/);
  // Une peine DÉJÀ ÉCHUE n'en est plus une : un `bb` au passé ne remuselle pas.
  assert.match(LIGHT, /if \(mJusqua <= Date\.now\(\)\) \{ poserMuselage\(0\); break; \}/);
});

/* ══ LE MASQUE NE DEVIENT PAS UNE HUMEUR ══════════════════════════════════
 *
 * « Quand un user n'est plus totoché et qu'il parle dans un salon, sa bouille
 * clignote et affiche la bouille totochée une frame sur deux. »
 *
 * `getStatusCode` force l'humeur 7 tant que la peine court, puis rend la main
 * à ce que le CLIENT a dit de lui-même (`cl.statusStr`, quatrième caractère).
 * Deux trous s'ouvraient là :
 *
 *   · le client RÉÉMETTAIT le 7 qu'on venait de lui pousser — le client
 *     d'époque relit son statut avant d'en changer un morceau — et le serveur
 *     l'enregistrait comme l'humeur choisie. La peine levée, la bouille
 *     restait totochée. Le light refusait déjà d'émettre ce 7, mais un
 *     correctif dans UN client ne protège pas des autres ;
 *
 *   · une trame `<status>` n'écrivait que sur SA socket, quand `getStatusCode`
 *     lit la PREMIÈRE socket qui porte un statut. Deux onglets — le cas
 *     courant, on ouvre le bureau sans fermer le light — et l'un gardait le
 *     masque quand l'autre était repassé à son humeur : le salon voyait
 *     l'un ou l'autre selon la trame. C'est le clignotement.
 *
 * Ces deux tests EXÉCUTENT `enregistrerStatut`, sortie de server.js et jouée
 * dans un bac à sable : on lui donne des sockets en carton et l'on regarde ce
 * qu'elle retient.
 */
function bacAStatut() {
  const src = /function getMuteValue\(user\) \{[\s\S]*?\n\}/.exec(SRV);
  const enr = /function enregistrerStatut\(client, brut\) \{[\s\S]*?\n\}/.exec(SRV);
  assert.ok(src && enr, 'getMuteValue et enregistrerStatut doivent exister');
  const bac = { users: {}, xmlSocketClients: new Map(), Date };
  vm.createContext(bac);
  vm.runInContext(src[0] + '\n' + enr[0], bac);
  return bac;
}
// Une peine qui court : `getMuteValue` lit « AAAA-MM-JJ.hh:mm:ss » en UTC.
const echeance = (msPlusTard) => new Date(Date.now() + msPlusTard)
  .toISOString().replace('T', '.').substring(0, 19);

test('pendant la peine, le 7 renvoyé par le client n’est PAS retenu', () => {
  const bac = bacAStatut();
  bac.users.bob = { mutedUntil: echeance(10 * 60 * 1000) };
  const socket = { username: 'bob', logged: true, statusStr: '0003' };  // il sourit
  bac.xmlSocketClients.set('s1', socket);

  // Le client réémet le masque. Le serveur garde le sourire.
  const retenu = bac.enregistrerStatut(socket, '0007');
  assert.strictEqual(retenu.charAt(3), '3', 'l’humeur vraie est gardée');
  assert.strictEqual(socket.statusStr.charAt(3), '3');

  // Et une humeur VOULUE, elle, passe : la peine ne bâillonne que le 7.
  assert.strictEqual(bac.enregistrerStatut(socket, '0001').charAt(3), '1');

  // Sans peine, le 7 n'a plus rien de spécial (il n'a pas de bouton, mais
  // rien n'oblige le serveur à s'en mêler).
  delete bac.users.bob.mutedUntil;
  assert.strictEqual(bac.enregistrerStatut(socket, '0007').charAt(3), '7');
});

test('les deux onglets d’une même personne disent la MÊME humeur', () => {
  const bac = bacAStatut();
  bac.users.bob = {};
  const light = { username: 'bob', logged: true, statusStr: '0007' };   // resté sur le masque
  const bureau = { username: 'bob', logged: true, statusStr: '0007' };
  const autre = { username: 'alice', logged: true, statusStr: '0005' };
  bac.xmlSocketClients.set('s1', light);
  bac.xmlSocketClients.set('s2', bureau);
  bac.xmlSocketClients.set('s3', autre);

  // Un seul onglet repasse au sourire — et les deux suivent.
  bac.enregistrerStatut(bureau, '0003');
  assert.strictEqual(bureau.statusStr.charAt(3), '3');
  assert.strictEqual(light.statusStr.charAt(3), '3',
    'l’autre onglet ne doit plus porter le masque : c’est lui que getStatusCode lisait');
  assert.strictEqual(autre.statusStr, '0005', 'et personne d’autre n’est touché');
});

test('le VOYANT de jeu reste propre à chaque socket', () => {
  // Les deux chiffres du milieu disent la partie en cours ; ils n'ont rien à
  // voir avec l'humeur, et `setUserInternalStatus` les repose de son côté.
  const bac = bacAStatut();
  bac.users.bob = {};
  const light = { username: 'bob', logged: true, statusStr: '0A70' };   // il joue
  const bureau = { username: 'bob', logged: true, statusStr: '0000' };
  bac.xmlSocketClients.set('s1', light);
  bac.xmlSocketClients.set('s2', bureau);
  bac.enregistrerStatut(bureau, '0002');
  assert.strictEqual(light.statusStr, '0A72', 'son voyant lui reste, son humeur suit');
  assert.strictEqual(bureau.statusStr, '0002');
});

test('la trame `status` passe par enregistrerStatut, pas par une affectation nue', () => {
  const cas = /case 'status': \{[\s\S]*?\n      break;\n    \}/.exec(SRV);
  assert.ok(cas, 'la branche `status`');
  assert.match(cas[0], /const s = enregistrerStatut\(client, String\(msg\.attrs\.s \|\| '0000'\)\);/);
  assert.doesNotMatch(cas[0], /client\.statusStr = s;/,
    'plus d’enregistrement direct : le masque passerait par-dessous');
});
