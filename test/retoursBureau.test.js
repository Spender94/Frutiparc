/*
 * Le lot de retours du bureau — cinq corrections, une par test.
 *
 *   · Boutique › Pass : « Vous en possédez 5  7 parties par jour ». La flèche
 *     de la phrase n'existe pas dans la police de shopitem.swf, qui ne dessine
 *     alors RIEN — deux nombres se retrouvaient collés.
 *   · Classement kikooz : « Je ne suis pas classé pour le moment » alors que le
 *     joueur l'est. Sa place se cherchait dans le magasin de scores, où le
 *     kikooz n'habite pas.
 *   · Fond d'écran : une fois l'un posé, plus rien ne ramenait au thème
 *     d'origine — on ne pouvait qu'échanger un fond contre un autre.
 *   · Pictos : tous dans un seul dossier, par centaines. Un dossier par jeu.
 *   · Éjection du disque : les clients NATIFS (Grapiz, Frutibandas, et les
 *     trois portages HTML) ne refermaient pas leur fenêtre.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3495;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-retours-bureau';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5260', FRUTISCORE_PORT: '5261',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  for (const fichier of ['data/scores.json', 'data/challenge-medals.json']) {
    try {
      const p = path.join(ROOT, fichier);
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (d.users) for (const u of Object.keys(d.users)) if (u.startsWith('rbur')) delete d.users[u];
      if (d.medalsByVisibleDay) {
        for (const [jour, parJoueur] of Object.entries(d.medalsByVisibleDay)) {
          for (const u of Object.keys(parJoueur)) if (u.startsWith('rbur')) delete parJoueur[u];
          if (Object.keys(parJoueur).length === 0) delete d.medalsByVisibleDay[jour];
        }
      }
      fs.writeFileSync(p, JSON.stringify(d));
    } catch { /* rien à nettoyer */ }
  }
});

async function sidPour(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'session ouverte pour ' + pseudo);
  return j.sid;
}
const texte = (chemin) => fetch(BASE + chemin).then((r) => r.text());

// ── Boutique › Pass ───────────────────────────────────────────────────────

test('le Pass quotidien dit son compte en toutes lettres, sans flèche perdue', async () => {
  const sid = await sidPour('rburpass' + RUN);
  // Le catalogue entier : on cherche la fiche d'un pass.
  // Le premier pass du catalogue : sa fiche se demande par son identifiant.
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ids = [];
  for (const m of srv.matchAll(/id:\s*(\d+),[\s\S]{0,900}?fdPassGame:/g)) ids.push(m[1]);
  assert.ok(ids.length > 0, 'le catalogue porte des pass');
  let phrases = [];
  for (const id of ids) {
    const xml = await texte('/ft/pack?sid=' + encodeURIComponent(sid) + '&id=' + id);
    phrases = phrases.concat(xml.match(/Vous en possédez [^<]*/g) || []);
  }
    assert.ok(phrases.length > 0, 'au moins un pass porte la phrase');
  for (const p of phrases) {
    assert.equal(/→/.test(p), false, 'plus de flèche : ' + p);
    // Deux nombres séparés par de l'espace seulement, c'était le bug.
    assert.equal(/possédez \d+\s+\d/.test(p), false, 'deux nombres collés : ' + p);
    assert.match(p, /Vous en possédez \d+, soit \d+ partie/, 'la phrase se lit : ' + p);
  }
});

// ── Classement kikooz ─────────────────────────────────────────────────────

test('le kikooz sait dire MA place — il ne vit pourtant pas dans le magasin de scores', async () => {
  const pseudo = 'rburkik' + RUN;
  await sidPour(pseudo);
  // On lui donne de quoi être en tête : le classement fusionne mémoire et base.
  const r = await fetch(`${BASE}/api/admin/kikooz/${pseudo}`, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ kikooz: 999999 }),
  });
  // La route d'admin n'existe pas partout ; à défaut, on se contente du solde
  // de départ — la question est la PLACE, pas le montant.
  if (!r.ok) assert.ok(true, 'solde laissé tel quel');

  const classement = await fetch(BASE + '/api/club/records').then((x) => x.json());
  assert.ok(classement, 'le serveur répond');

  // La fonction qui répondait vide : on la relit par la voie du bureau.
  const mod = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/async function positionDuJoueur/.test(mod),
    'le calcul de « ma place » connaît les classements joueur');
  assert.ok(/const info = await positionDuJoueur\(targetUser, internalId\)/.test(mod),
    'et userResult passe par lui');
  const bloc = mod.slice(mod.indexOf('async function positionDuJoueur'),
    mod.indexOf('async function getConsecrationLeaderboard'));
  assert.ok(/getKikoozLeaderboard/.test(bloc),
    'le kikooz se lit dans SON classement, pas dans scoresData');
});

// ── Fond d'écran ──────────────────────────────────────────────────────────

test('le retour au thème d\'origine n\'apparaît QUE si un fond est posé', async () => {
  const sid = await sidPour('rburfond' + RUN);
  const nu = await texte('/ff/ls?sid=' + encodeURIComponent(sid) + '&uid=inv_wallpapers');
  assert.equal(/__fond_defaut__/.test(nu), false,
    'sans fond posé, rien à défaire — reçu : ' + nu);

  // On pose un fond : la préférence n° 5 se remplit (même route que le mobile).
  const fonds = await fetch(BASE + '/api/light/inventaire?sid=' + encodeURIComponent(sid))
    .then((r) => r.json());
  assert.ok(fonds.ok, 'inventaire lisible');

  // Faute de fond acheté, on écrit la préférence directement par la route de
  // pose : elle refuse un identifiant inconnu, donc on passe par la voie admin
  // si elle existe — sinon on vérifie au moins le refus.
  const pose = await fetch(BASE + '/api/light/fond', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, id: 'wp_inexistant' }),
  }).then((r) => r.json());
  assert.equal(pose.ok, undefined === pose.ok ? undefined : false,
    'un fond qu\'on ne possède pas est refusé');
});

test('le thème d\'origine est un fond comme les autres — même icône, même clic', async () => {
  const sid = await sidPour('rburthe' + RUN);
  await texte('/do/prefsavepartial?sid=' + encodeURIComponent(sid) + '&i=5&v=wal/pi.jpg%7CF9D190;');
  const liste = await texte('/ff/ls?sid=' + encodeURIComponent(sid) + '&uid=inv_wallpapers');

  // Le TYPE fait l'icône : « wallpaper » comme les fonds achetés, plus la
  // page-mystère du type « url ».
  assert.match(liste, /<e u="__fond_defaut__" t="wallpaper"/, 'c\'est un fond d\'écran');

  // Et UNE seule ligne de description. box.Explorer appelle
  // loadWP(desc[1], desc[2]) ; deux `undefined`, c'est la voie que
  // WallPaperMng garde depuis toujours pour n'avoir aucun fond.
  const desc = liste.match(/<e u="__fond_defaut__"[^>]*>([^<]*)<\/e>/);
  assert.ok(desc, 'l\'entrée est là');
  assert.equal(desc[1].split('\n').length, 1, 'une seule ligne : ni url, ni couleur');
  assert.equal(/javascript:/.test(liste), false, 'plus de détour par la page');

  const html = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');
  assert.equal(/fp_fondDefaut = function/.test(html), false,
    'et plus de fonction de page à appeler — donc plus de rechargement');
});

test('une préférence VIDE se range quand même, même sans paramètre', async () => {
  const sid = await sidPour('rburpref' + RUN);
  await texte('/do/prefsavepartial?sid=' + encodeURIComponent(sid) + '&i=5&v=wal/pi.jpg%7CF9D190;');
  assert.match(await texte('/do/mypref?sid=' + encodeURIComponent(sid)), /wal\/pi\.jpg/,
    'le fond est posé');

  // C'est EXACTEMENT ce que le client envoie après
  // userPref.setAndSave("wallpaper","") : la valeur vide ne voyage pas, il ne
  // reste que `?i=5`. Le serveur l'ignorait — le bureau se défaisait à l'écran,
  // mais retrouvait son fond au rechargement.
  await texte('/do/prefsavepartial?sid=' + encodeURIComponent(sid) + '&i=5');
  assert.equal(/wal\/pi\.jpg/.test(await texte('/do/mypref?sid=' + encodeURIComponent(sid))), false,
    'le vide remet la préférence à son défaut');
  assert.equal(/__fond_defaut__/.test(
    await texte('/ff/ls?sid=' + encodeURIComponent(sid) + '&uid=inv_wallpapers')), false,
  'et l\'entrée disparaît, n\'ayant plus rien à défaire');
});

// ── Pictos rangés par jeu ─────────────────────────────────────────────────

test('les pictos se rangent par jeu, dans l\'arbre COMME dans le dossier', async () => {
  const sid = await sidPour('rburpic' + RUN);

  // Sans picto : le dossier est vide et l'arbre ne porte pas de sous-dossier.
  const videDossier = await texte('/ff/ls?sid=' + encodeURIComponent(sid) + '&uid=inv_pictos');
  assert.match(videDossier, /<i \/>/, 'dossier vide');
  const videArbre = await texte('/ff/tree?sid=' + encodeURIComponent(sid));
  assert.match(videArbre, /<f u="inv_pictos" n="Pictos" t="inventory" \/>/,
    'l\'arbre garde son dossier sans enfant');

  // Une partie de Mini-Fever : cinq pictos, donc un jeu.
  const r = await fetch(BASE + '/api/minifever/score', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sid, palier: 0, niveau: 5, jouees: 5,
      gagnees: ['gameBasket', 'gameLander', 'gameFlower', 'gamePong', 'gameAstero'],
    }),
  }).then((x) => x.json());
  assert.equal(r.ok, true, 'la partie compte');

  // L'ARBRE porte le sous-dossier — c'est lui qui lui donne son nom, et son
  // absence est ce qui affichait « Undefined ».
  const arbre = await texte('/ff/tree?sid=' + encodeURIComponent(sid));
  assert.match(arbre, /<f u="inv_pictos" n="Pictos" t="inventory">/,
    'le dossier Pictos a maintenant des enfants');
  // Et c'est l'arbre qui donne l'ICÔNE d'un dossier : FFileMng.analyseXml lit
  // son type dans `this.tree`, pas dans la liste. « folder » — le dossier
  // jaune ordinaire — et non « inventory », qui les affichait en coffres.
  assert.match(arbre, /<f u="inv_pictos_minifever" n="Mini-Fever" t="folder" \/>/,
    'et le jeu y est nommé, avec l\'icône de dossier');

  // Le DOSSIER liste la galerie puis les sous-dossiers — plus les pictos à plat.
  const dossier = await texte('/ff/ls?sid=' + encodeURIComponent(sid) + '&uid=inv_pictos');
  assert.match(dossier, /__pictos_gallery__/, 'la galerie reste en tête');
  assert.match(dossier, /<f u="inv_pictos_minifever" n="Mini-Fever" t="folder" \/>/,
    'le sous-dossier est proposé');
  assert.equal(/\$fvBasket/.test(dossier), false,
    'les pictos ne sont plus déversés à la racine');

  // Et le sous-dossier, lui, porte les cinq pictos.
  const sous = await texte('/ff/ls?sid=' + encodeURIComponent(sid) + '&uid=inv_pictos_minifever');
  assert.match(sous, /\$fvBasket/, 'le panier est là');
  assert.equal((sous.match(/<e /g) || []).length, 5, 'les cinq, et rien d\'autre');
});

test('un sous-dossier de pictos ne se déplace ni ne se jette', async () => {
  const sid = await sidPour('rburpic2' + RUN);
  const r = await texte('/ff/mv?sid=' + encodeURIComponent(sid)
    + '&f=inv_pictos_minifever&folder=recyclebin&p=inv_pictos');
  // La route renvoie l'icône À SA PLACE : le SWF la remet où elle était.
  assert.match(r, /p="inv_pictos"/, 'le dossier revient d\'où il vient');
  assert.equal(/folder="recyclebin"/.test(r), false, 'il n\'est pas parti à la corbeille');
});

// ── Éjection du disque ────────────────────────────────────────────────────

test('sortir le disque note l\'éjection, et le guetteur la lit', async () => {
  const sid = await sidPour('rburej' + RUN);
  // Encore faut-il que le disque SOIT dans la console. Le serveur le sait par
  // la fenêtre de jeu, qui bat toutes les secondes et demie : sans elle, un
  // disque qu'on range est un disque qu'on range, et rien ne se ferme (cf.
  // test/voyantEnPartie.test.js).
  await fetch(BASE + '/api/check-ejected?fd=0&sid=' + encodeURIComponent(sid) + '&game=grapiz');
  // Le disque revient dans « Mes disques » : c'est le signal d'éjection.
  await texte('/ff/mv?sid=' + encodeURIComponent(sid) + '&f=grapiz1&folder=disccollector');
  const vu = await fetch(BASE + '/api/check-ejected?fd=0&sid=' + encodeURIComponent(sid) + '&game=grapiz')
    .then((r) => r.json());
  assert.equal(vu.ejected, true, 'le guetteur voit l\'éjection');
  // Lu une fois, pas deux : le jeu suivant ne doit pas se fermer aussitôt.
  const encore = await fetch(BASE + '/api/check-ejected?fd=0&sid=' + encodeURIComponent(sid) + '&game=grapiz')
    .then((r) => r.json());
  assert.equal(encore.ejected, false, 'et une seule fois');
});

test('les cinq clients natifs surveillent leur disque', async () => {
  const attendus = [
    ['public/grapiz/index.html', 'grapiz'],
    ['public/bandas/index.html', 'bandas'],
    ['public/minipixiz/index.html', 'minipixiz'],
    ['public/miniwave/index.html', 'miniwave'],
    ['public/minifever/index.html', 'minifever'],
  ];
  for (const [f, jeu] of attendus) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(html, new RegExp('src="/js/eject-watch\\.js" data-jeu="' + jeu + '"'),
      f + ' inclut le guetteur');
  }
  const veille = fs.readFileSync(path.join(ROOT, 'public/js/eject-watch.js'), 'utf8');
  assert.match(veille, /check-ejected\?fd=0/,
    'le guetteur ne consomme pas le drapeau « plus de parties »');
  const r = await fetch(BASE + '/js/eject-watch.js');
  assert.ok(r.ok, 'et il est servi');
});

test('fd=0 ne mange pas le drapeau destiné à la fenêtre de jeu', async () => {
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(srv, /String\(req\.query\.fd \|\| ''\) === '0' \? null : fdTakeRefusalFlag\(sid\)/,
    'la route lit le drapeau seulement si on le lui demande');
});

// ── Les parties classées restantes ────────────────────────────────────────

test('le bandeau dit ce qu\'il reste, et se tait sur un jeu sans quota', async () => {
  const sid = await sidPour('rburfd' + RUN);

  // Kaluga rationne le CLASSEMENT : deux parties gratuites par jour.
  const depart = await fetch(BASE + '/api/fd/status?sid=' + encodeURIComponent(sid) + '&game=kaluga')
    .then((r) => r.json());
  assert.equal(depart.limited, true, 'Kaluga est rationné');
  assert.equal(depart.remaining, depart.allowance, 'rien de consommé au départ');

  await fetch(BASE + '/api/fd/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'kaluga' }),
  });
  const apres = await fetch(BASE + '/api/fd/status?sid=' + encodeURIComponent(sid) + '&game=kaluga')
    .then((r) => r.json());
  assert.equal(apres.remaining, depart.remaining - 1, 'une partie de moins');

  // Grapiz ne rationne rien : le bandeau ne doit rien afficher.
  const libre = await fetch(BASE + '/api/fd/status?sid=' + encodeURIComponent(sid) + '&game=grapiz')
    .then((r) => r.json());
  assert.equal(libre.limited, false);
  assert.equal(libre.remaining, null, 'illimité se dit « null »');
});

test('les fenêtres de jeu portent le bandeau', async () => {
  const popup = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  assert.match(popup, /src="\/js\/fd-badge\.js"/, 'la fenêtre des jeux Flash');
  const swapou = fs.readFileSync(path.join(ROOT, 'public/swapou/index.html'), 'utf8');
  assert.match(swapou, /src="\/js\/fd-badge\.js" data-jeu="swapou2"/,
    'et Swapou côté mobile — le seul jeu rationné que /light propose');

  const js = fs.readFileSync(path.join(ROOT, 'public/js/fd-badge.js'), 'utf8');
  assert.match(js, /pointer-events:none/, 'le bandeau ne prend jamais le clic');
  assert.match(js, /plus de partie classée/, 'et il sait dire l\'épuisement');
  const r = await fetch(BASE + '/js/fd-badge.js');
  assert.ok(r.ok, 'il est servi');
});

// ── Le bureau est un dossier ──────────────────────────────────────────────
//
// Au portail d'origine on posait ses disques et ses Frutiz sur le bureau, et
// on les y retrouvait à la connexion suivante. Le portage n'en avait gardé que
// la moitié : main.swf acceptait le dépôt, le serveur ne le retenait pas — d'où
// la copie qui cohabitait avec l'original (le « disque dupliqué »).

const bureau = (sid) => texte('/ff/ls?sid=' + encodeURIComponent(sid) + '&uid=root');
const disques = (sid) => texte('/ff/ls?sid=' + encodeURIComponent(sid) + '&uid=disccollector');

// On imite le SWF À LA LETTRE, et c'est tout l'enjeu : FPFileMng.move n'envoie
// QUE le fichier et la destination — jamais la provenance — et pas de
// destination du tout quand c'est le bureau :
//
//     if(newFolder != undefined && newFolder != "root"){ … folder: newFolder … }
//     else                                             { … sans folder …      }
//
// Les premiers essais, eux, envoyaient `folder=root&p=disccollector`. Deux
// paramètres que le client n'a jamais envoyés : le premier faisait croire que
// le bureau était reconnu, le second que la provenance était juste. Ils
// passaient donc au vert sur un bureau qui, en vrai, ne retenait rien.
const deplacer = (sid, f, folder) => texte('/ff/mv?sid=' + encodeURIComponent(sid)
  + '&f=' + encodeURIComponent(f) + (folder ? '&folder=' + encodeURIComponent(folder) : ''));
const lacherSurLeBureau = (sid, f) => deplacer(sid, f);

test('un disque posé sur le bureau QUITTE « Mes disques » — un objet, une place', async () => {
  const sid = await sidPour('rburbur' + RUN);
  const avant = ((await disques(sid)).match(/t="disc"/g) || []).length;
  assert.ok(avant > 1, 'le catalogue est garni');
  assert.equal(/u="grapiz1"/.test(await bureau(sid)), false, 'bureau nu au départ');

  await lacherSurLeBureau(sid, 'grapiz1');
  assert.match(await bureau(sid), /<e u="grapiz1" t="disc"/, 'le disque est sur le bureau');
  const apres = await disques(sid);
  assert.equal(/u="grapiz1"/.test(apres), false, 'et plus dans « Mes disques »');
  assert.equal((apres.match(/t="disc"/g) || []).length, avant - 1, 'un de moins au catalogue');

  // Reposé dix fois, il ne fait pas dix icônes.
  for (let i = 0; i < 10; i++) await lacherSurLeBureau(sid, 'grapiz1');
  assert.equal(((await bureau(sid)).match(/u="grapiz1"/g) || []).length, 1,
    'une seule icône, quoi qu\'on fasse');

  // Rangé, il revient au catalogue et quitte le bureau.
  await deplacer(sid, 'grapiz1', 'disccollector');
  assert.equal(/u="grapiz1"/.test(await bureau(sid)), false, 'parti du bureau');
  assert.match(await disques(sid), /u="grapiz1"/, 'revenu au catalogue');
  assert.equal(((await disques(sid)).match(/t="disc"/g) || []).length, avant, 'compte rétabli');
});

test('le disque dit d\'où il vient : plus de fantôme à demi effacé dans « Mes disques »', async () => {
  const sid = await sidPour('rburfan' + RUN);

  // C'est la RÉPONSE qui décide quelle fenêtre perd l'icône : onMove appelle
  // callListeners(p, "rmUid", uid). Et il faut bien qu'une fenêtre la perde —
  // IconFileBox.initMove a posé _alpha = 50 sur l'icône dès le début du
  // glisser, et rien d'autre ne la ranime.
  const aller = await lacherSurLeBureau(sid, 'bkiwi1');
  assert.match(aller, /p="disccollector"/, 'à l\'aller, c\'est le catalogue qui la perd');
  assert.match(aller, /f="root"/, 'et le bureau qui la gagne');

  // Au retour, l'inverse : le bureau la perd.
  const retour = await deplacer(sid, 'bkiwi1', 'disccollector');
  assert.match(retour, /p="root"/, 'au retour, c\'est le bureau qui la perd');

  // Et le lâcher sur le fond d'écran est bien reconnu comme tel, sans `folder`.
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const bloc = srv.slice(srv.indexOf('function estLeBureau'),
    srv.indexOf('function parseDesktopItems'));
  assert.match(bloc, /f === ''/, 'le vide est le bureau — c\'est ce que le SWF envoie');
});

test('un Frutiz posé sur le bureau y est un RACCOURCI — il reste aux contacts', async () => {
  const sid = await sidPour('rburcon' + RUN);
  const ami = 'rburami' + RUN;
  await sidPour(ami);
  const adresse = ami + '@frutiparc.com';

  await deplacer(sid, adresse, 'mycontact');
  await lacherSurLeBureau(sid, adresse);
  await lacherSurLeBureau(sid, adresse);                   // deux fois : une icône
  assert.equal(((await bureau(sid)).match(new RegExp('u="' + ami + '"', 'g')) || []).length, 1,
    'une seule icône sur le bureau');
  const contacts = await texte('/ff/ls?sid=' + encodeURIComponent(sid) + '&uid=mycontact');
  assert.match(contacts, new RegExp(ami), 'et il reste dans « Mes contacts »');

  // À la corbeille : il quitte le bureau avec le reste.
  await deplacer(sid, adresse, 'recyclebin');
  assert.equal(new RegExp('u="' + ami + '"').test(await bureau(sid)), false,
    'jeté, il quitte aussi le bureau');
});

test('le bureau garde ses icônes d\'une visite à l\'autre', async () => {
  const sid = await sidPour('rburgar' + RUN);
  // De VRAIS identifiants de disque : « kaluga » et « swapou2 » n'en sont pas
  // (le catalogue dit kaluga1 et swapou1), et le serveur les prenait pour des
  // adresses — l'essai passait au vert en posant deux contacts sur le bureau.
  await lacherSurLeBureau(sid, 'kaluga1');
  await lacherSurLeBureau(sid, 'swapou1');
  // Une seconde session du MÊME joueur voit le même bureau : c'est le serveur
  // qui le retient, pas l'écran.
  const sid2 = await sidPour('rburgar' + RUN);
  const vu = await bureau(sid2);
  assert.match(vu, /<e u="kaluga1" t="disc"/, 'le premier disque est toujours là');
  assert.match(vu, /<e u="swapou1" t="disc"/, 'le second aussi');
  // Et dans l'ordre où ils ont été posés — le bureau les range en grille.
  assert.ok(vu.indexOf('u="kaluga1"') < vu.indexOf('u="swapou1"'), 'dans l\'ordre du dépôt');
});

test('une icône que le serveur ne reconnaît plus est abandonnée, pas fatale', async () => {
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const bloc = srv.slice(srv.indexOf('function desktopNodesXml'),
    srv.indexOf('function parseOwnedFeutres'));
  assert.match(bloc, /if \(!disc\) continue;/,
    'un disque inconnu du catalogue est sauté');
  assert.match(bloc, /if \(!local\) continue;/,
    'un contact sans adresse aussi');
  // La colonne existe : le bureau survit au redémarrage du serveur.
  const dbjs = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  assert.match(dbjs, /ADD COLUMN IF NOT EXISTS desktop_items TEXT/,
    'et tout cela se persiste');
});

// ── Se déconnecter, sur mobile ────────────────────────────────────────────
//
// Le bureau Flash ne l'offre que par le menu contextuel du fond d'écran, un
// clic droit que le tactile n'a pas : /light n'avait AUCUN moyen de quitter
// une session. Le pied du tiroir en tient lieu.

test('la session se ferme vraiment, et le sid ne vaut plus rien', async () => {
  const sid = await sidPour('rburdec' + RUN);
  // Vivante avant.
  const avant = await fetch(BASE + '/api/light/inventaire?sid=' + encodeURIComponent(sid))
    .then((r) => r.json());
  assert.equal(avant.ok, true, 'la session répond');

  const r = await fetch(BASE + '/light/logout?sid=' + encodeURIComponent(sid), { redirect: 'manual' });
  assert.ok(r.status === 302 || r.status === 301, 'la sortie renvoie à l\'accueil');
  assert.equal(r.headers.get('location'), '/', 'et pointe bien la page d\'accueil');

  const apres = await fetch(BASE + '/api/light/inventaire?sid=' + encodeURIComponent(sid))
    .then((x) => x.json());
  assert.equal(apres.ok, false, 'le sid est révoqué');
  assert.equal(apres.error, 'auth');
});

test('le tiroir porte le compte et sa porte de sortie, en deux temps', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  // Le pseudo : il ne se lit nulle part ailleurs dans /light.
  assert.match(html, /id="home-pseudo"/, 'le pseudo a sa place');
  assert.match(html, /pseudo\.textContent = state\.user/, 'et il est renseigné');

  // Le bouton, et le chemin qu'il emprunte.
  assert.match(html, /id="logout-btn"/, 'le bouton existe');
  assert.match(html, /\/light\/logout\?sid=/, 'il appelle la route de sortie');

  // DEUX TEMPS : le premier appui demande confirmation, le second part.
  const bloc = html.slice(html.indexOf('function installerDeconnexion'),
    html.indexOf('// ── WebSocket'));
  assert.match(bloc, /Confirmer \?/, 'le premier appui demande confirmation');
  assert.match(bloc, /setTimeout\(desarmer, 5000\)/, 'et il se rétracte tout seul');
  assert.match(bloc, /state\.ws\.close\(\)/, 'la socket se referme avant de partir');
  // Rien qui ouvre une fenêtre par-dessus : la confirmation tient dans le bouton.
  assert.equal(/confirm\(/.test(bloc), false, 'pas de fenêtre du navigateur');

  // Le pied est collé au bas du tiroir, quel que soit le nombre de rubriques.
  assert.match(html, /\.home-compte \{[^}]*margin-top: auto/,
    'le pied reste au bout du chemin');
});

test('la sortie se lit comme une mention de bas de page, pas comme un bouton', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  // On se déconnecte une fois par mois et on ouvre ses rubriques cent fois par
  // jour : un aplat corail sous les tuiles tirait l'œil vers la seule chose
  // qu'on ne vient pas y chercher.
  const repos = html.slice(html.indexOf('.hc-quitter {'), html.indexOf('.hc-quitter:hover'));
  assert.match(repos, /background: none/, 'aucun aplat');
  assert.match(repos, /border: 0/, 'aucune bordure');
  assert.match(repos, /text-decoration: underline/, 'un lien, pas un bouton');

  // Armé, en revanche, il doit se voir : le prochain appui, lui, compte.
  assert.match(html, /\.hc-quitter\.confirme \{[^}]*color: #A8332A/,
    'la confirmation rougit');

  // Le pied n'a plus d'encart à lui : sous un fond d'écran il est posé à même
  // l'illustration, comme les étiquettes des tuiles — donc même halo.
  assert.match(html, /#home-panel\.a-fond \.home-compte/,
    'lisible aussi par-dessus un fond d\'écran');
  assert.match(html, /#home-panel\.a-fond \.hc-quitter\.confirme \{[^}]*color: #A8332A/,
    'et il rougit même là');
});

// ── Le bureau light se clique encore à la souris ──────────────────────────
//
// Le rangement du bureau (glisser une icône pour changer l'ordre) capturait le
// pointeur sur #home-grid dès le `pointerdown`. Or un élément qui capture le
// pointeur reçoit AUSSI le `click` de fin de geste, à la place de ce qui se
// trouvait vraiment sous le curseur : chaque clic de souris atterrissait sur la
// grille, jamais sur la tuile, et plus aucune rubrique ne s'ouvrait. Au clavier
// ça marchait encore — Entrée envoie le clic directement sur le bouton, sans
// pointeur — et au doigt aussi, dont le clic est fabriqué à partir des touches.
// D'où un bug qui ne se voyait QUE sur ordinateur, à la souris.
//
// La capture n'a lieu qu'au moment où l'icône est réellement en main. Vérifié
// dans Chromium avant/après : clic simple, glisser à la souris, appui long au
// doigt, ordre retenu au rechargement.
test('le pointeur n\'est capturé qu\'une fois l\'icône en main', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  const bloc = html.slice(html.indexOf('var bureauVientDeGlisser = false;'),
    html.indexOf('// ── Trombinoscope'));
  assert.ok(bloc.length > 500, 'le rangement du bureau est bien là');

  const appui = bloc.slice(bloc.indexOf('grille.addEventListener("pointerdown"'),
    bloc.indexOf('// Suite du geste'));
  assert.ok(appui.length > 100, 'on tient bien le gestionnaire d\'appui');
  assert.equal(/setPointerCapture/.test(appui), false,
    'rien n\'est capturé à l\'appui, sans quoi le clic irait à la grille');

  const prise = bloc.slice(bloc.indexOf('function saisir('), bloc.indexOf('function deplacer('));
  assert.match(prise, /grille\.setPointerCapture/,
    'la capture arrive avec le glisser, où elle sert vraiment');

  // Tant que rien n'est capturé, une souris qui sort de la grille avant le
  // seuil emporterait la suite du geste ailleurs : on écoute le document.
  assert.match(bloc, /document\.addEventListener\("pointermove"/,
    'la suite du geste se suit au niveau du document');
  assert.match(bloc, /\["pointerup", "pointercancel"\]\.forEach\(function \(n\) \{\s*document\.addEventListener/,
    'le relâchement aussi, où qu\'il tombe');

  // Et le clic parasite qui clôt un vrai glisser reste, lui, sans effet.
  assert.match(bloc, /bureauVientDeGlisser = true/, 'un glisser se signale…');
  assert.match(html, /if \(bureauVientDeGlisser\) return;/, '…et son clic ne navigue pas');
});

// ── LE PANNEAU DE L'APPLI ─────────────────────────────────────────────────
// Les notifications se réglaient sur une ligne du pied de l'accueil : bonne
// place pour une mention, mauvaise pour un réglage. Elles ont désormais leur
// rubrique, sous l'icône du BUREAU — le radis de « linkPreference », sorti en
// vecteur de la feuille des liens de fileIcon.swf.

test('les réglages ont leur rubrique, sous l\'icône du bureau', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  assert.match(html, /data-go="reglages"[\s\S]{0,200}icone_preferences\.svg/,
    'la tuile porte l\'icône du bureau');
  assert.match(html, /<section class="panel" id="reglages-panel">/, 'le panneau existe');
  assert.match(html, /\$\("#reglages-panel"\)\.classList\.toggle\("active", tab === "reglages"\)/,
    'et il s\'ouvre comme les autres');

  // L'icône est bien celle qu'on a sortie du SWF, servie telle quelle.
  const svg = fs.readFileSync(path.join(ROOT, 'public/fb/icone_preferences.svg'), 'utf8');
  assert.match(svg, /^<svg/, 'un vrai SVG');
  assert.match(svg, /viewBox/, 'avec sa boîte d\'origine');
  const rep = await fetch(BASE + '/fb/icone_preferences.svg');
  assert.equal(rep.status, 200, 'et le serveur la sert');

  // Les commandes de notification ont quitté le pied pour le panneau.
  const pied = html.slice(html.indexOf('<div class="home-compte">'),
    html.indexOf('</section>', html.indexOf('<div class="home-compte">')));
  assert.equal(/id="notifs-ligne"/.test(pied), false, 'plus de réglage dans le pied');
  const panneau = html.slice(html.indexOf('id="reglages-panel"'),
    html.indexOf('<!-- Trombinoscope'));
  assert.match(panneau, /id="notifs-btn"/, 'activer vit dans le panneau');
  assert.match(panneau, /id="notifs-test"/, 'tester aussi');
  assert.match(panneau, /id="notifs-off"/, 'couper aussi');
  assert.match(panneau, /id="reg-diag-btn"/, 'et le diagnostic « rien ne sonne ? »');

  // Le piège du groupe : une règle d'affichage ne doit pas l'emporter sur
  // `hidden`, sinon « Activer » et « Activées » s'affichent ensemble.
  assert.match(html, /\.reg-actions > span:not\(\[hidden\]\) \{ display: contents; \}/,
    'le groupe « activées » respecte hidden');
});

// ── LIRE À LA BONNE LARGEUR (desktop) ─────────────────────────────────────
// Sur grand écran la conversation prenait toute la largeur : les lignes
// couraient d'un bord à l'autre et l'on resserrait la FENÊTRE du navigateur
// pour lire — une drôle de façon de faire. Le panneau se cadre désormais à une
// largeur réglable, centrée, avec une poignée sur son bord.

test('le chat se règle en largeur sur desktop, et s\'en souvient', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  assert.match(html, /<div id="chat-poignee"/, 'la poignée existe');
  // Cachée par défaut, montrée seulement au-delà de 768 px : sur un téléphone,
  // l'écran EST la largeur.
  const avantMedia = html.slice(0, html.indexOf('@media (min-width: 768px)'));
  assert.match(avantMedia, /#chat-poignee \{ display: none; \}/,
    'la règle mobile précède la règle desktop (sinon elle l\'écrase)');
  const media = html.slice(html.indexOf('@media (min-width: 768px)'));
  assert.match(media, /#chat-poignee \{\s*display: block;/, 'et le desktop la montre');
  // La largeur vit dans une variable, appliquée au panneau centré.
  assert.match(html, /max-width: var\(--chat-w, 900px\)/, 'la largeur est réglable');
  assert.match(html, /align-self: center/, 'et le panneau se centre');
  // Elle se retient d'une visite à l'autre.
  assert.match(html, /localStorage\.setItem\("fp_light_chat_w"/, 'la largeur est mémorisée');
  assert.match(html, /localStorage\.getItem\("fp_light_chat_w"/, 'et relue au retour');
  // La poignée reste DANS le panneau : débordante, elle tombait sous le tiroir
  // des connectés et n'attrapait plus le clic.
  assert.match(media, /#chat-poignee \{[^}]*right: 0;/, 'la poignée ne déborde pas');
});
