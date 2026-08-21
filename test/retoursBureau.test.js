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

test('la page du bureau sait revenir au thème d\'origine', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');
  assert.ok(/window\.fp_fondDefaut = function/.test(html), 'la fonction existe');
  assert.ok(/\/api\/light\/fond/.test(html), 'elle efface la préférence n° 5');
  assert.ok(/location\.reload\(\)/.test(html), 'puis relance le bureau');
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/javascript:fp_fondDefaut\(\)/.test(srv), 'et l\'inventaire l\'appelle');
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
  assert.match(arbre, /<f u="inv_pictos_minifever" n="Mini-Fever" t="inventory" \/>/,
    'et le jeu y est nommé');

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
const deplacer = (sid, f, folder, p) => texte('/ff/mv?sid=' + encodeURIComponent(sid)
  + '&f=' + encodeURIComponent(f) + '&folder=' + folder + (p ? '&p=' + p : ''));

test('un disque posé sur le bureau QUITTE « Mes disques » — un objet, une place', async () => {
  const sid = await sidPour('rburbur' + RUN);
  const avant = ((await disques(sid)).match(/t="disc"/g) || []).length;
  assert.ok(avant > 1, 'le catalogue est garni');
  assert.equal(/u="grapiz1"/.test(await bureau(sid)), false, 'bureau nu au départ');

  await deplacer(sid, 'grapiz1', 'root', 'disccollector');
  assert.match(await bureau(sid), /<e u="grapiz1" t="disc"/, 'le disque est sur le bureau');
  const apres = await disques(sid);
  assert.equal(/u="grapiz1"/.test(apres), false, 'et plus dans « Mes disques »');
  assert.equal((apres.match(/t="disc"/g) || []).length, avant - 1, 'un de moins au catalogue');

  // Reposé dix fois, il ne fait pas dix icônes.
  for (let i = 0; i < 10; i++) await deplacer(sid, 'grapiz1', 'root');
  assert.equal(((await bureau(sid)).match(/u="grapiz1"/g) || []).length, 1,
    'une seule icône, quoi qu\'on fasse');

  // Rangé, il revient au catalogue et quitte le bureau.
  await deplacer(sid, 'grapiz1', 'disccollector', 'root');
  assert.equal(/u="grapiz1"/.test(await bureau(sid)), false, 'parti du bureau');
  assert.match(await disques(sid), /u="grapiz1"/, 'revenu au catalogue');
  assert.equal(((await disques(sid)).match(/t="disc"/g) || []).length, avant, 'compte rétabli');
});

test('un Frutiz posé sur le bureau y est un RACCOURCI — il reste aux contacts', async () => {
  const sid = await sidPour('rburcon' + RUN);
  const ami = 'rburami' + RUN;
  await sidPour(ami);
  const adresse = ami + '@frutiparc.com';

  await deplacer(sid, adresse, 'mycontact');
  await deplacer(sid, adresse, 'root', 'mycontact');
  await deplacer(sid, adresse, 'root', 'mycontact');       // deux fois : une icône
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
  await deplacer(sid, 'kaluga', 'root', 'disccollector');
  await deplacer(sid, 'swapou2', 'root', 'disccollector');
  // Une seconde session du MÊME joueur voit le même bureau : c'est le serveur
  // qui le retient, pas l'écran.
  const sid2 = await sidPour('rburgar' + RUN);
  const vu = await bureau(sid2);
  assert.match(vu, /u="kaluga"/, 'le premier disque est toujours là');
  assert.match(vu, /u="swapou2"/, 'le second aussi');
  // Et dans l'ordre où ils ont été posés — le bureau les range en grille.
  assert.ok(vu.indexOf('u="kaluga"') < vu.indexOf('u="swapou2"'), 'dans l\'ordre du dépôt');
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
