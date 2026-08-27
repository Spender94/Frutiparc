'use strict';
/*
 * TOUS LES JEUX, POUR TOUT LE MONDE.
 *
 * ── LE CATALOGUE ─────────────────────────────────────────────────────────
 * `/ff/ls?uid=disccollector` sert `GAME_DISCS` en entier, sans aucune
 * condition de possession : chaque compte a chaque disque. Relevé au banc sur
 * un compte NEUF — 15 disques, Grapiz et Frutibandas compris — et la fenêtre
 * « Mes disques » du bureau les montre tous les quinze.
 *
 * UN DISQUE NE PEUT PAS SE PERDRE. Il ne quitte le catalogue que s'il est
 * POSÉ quelque part où le joueur peut le reprendre : le bureau, ou un dossier
 * du bureau qui existe encore. Rangé dans un dossier disparu, il n'était plus
 * nulle part — ni au catalogue, ni sur le bureau (`desktopNodesXml` saute les
 * `it.p`), ni dans aucune fenêtre. Il revient désormais à « Mes disques ».
 *
 * ── LA FEUILLE MOBILE ────────────────────────────────────────────────────
 * Elle a sa propre liste, `DISCS`. Les huit portages JS y étaient ; les trois
 * jeux ENCORE EN FLASH — Kaluga, Burning Kiwi, Motion-Ball 2 — n'y étaient
 * pas. Ils s'ouvrent dans une fenêtre à part (game-popup.html + Ruffle), avec
 * les mêmes `props` que le bureau leur donne (`GAME_DISCS`) :
 *
 *     bkiwi1  w=350 h=350        kaluga1 w=640 h=480 ct=20 cb=20
 *     mb2     w=550 h=400
 *
 * Mesuré au banc : les onze entrées s'affichent, aucune jaquette ne manque, et
 * un clic sur Kaluga ouvre bien `/game-popup.html?swf=games%2Fkaluga%2Ffull.swf
 * &width=640&height=480&game=kaluga&sid=…&ct=20&cb=20`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');

// La liste mobile, telle qu'elle est écrite dans le light.
function listeMobile() {
  const i = LIGHT.indexOf('var DISCS = [');
  const bloc = LIGHT.slice(i, LIGHT.indexOf('\n  ];', i));
  return (bloc.match(/name: "([^"]+)"/g) || []).map((m) => m.slice(7, -1));
}
// Les clés du catalogue serveur.
function catalogue() {
  const i = SERVEUR.indexOf('const GAME_DISCS = {');
  const bloc = SERVEUR.slice(i, SERVEUR.indexOf('\n};', i));
  return (bloc.match(/^  ([a-zA-Z0-9_]+): \{/gm) || []).map((m) => m.trim().split(':')[0]);
}

test('le catalogue sert TOUS les disques, sans condition de possession', () => {
  const cles = catalogue();
  for (const attendu of ['grapiz1', 'bandas1', 'bkiwi1', 'kaluga1', 'mb2',
    'swapou1', 'snake3light', 'miniwavelight', 'minipixizlight', 'minifeverlight', 'jamajama']) {
    assert.ok(cles.includes(attendu), attendu + ' manque au catalogue');
  }
  // La seule condition du listing : être posé ailleurs. Pas d'items, pas de
  // niveau, pas d'achat.
  const bloc = SERVEUR.slice(SERVEUR.indexOf("if (uid === 'disccollector')"));
  const listing = bloc.slice(0, bloc.indexOf('return res.type'));
  assert.match(listing, /for \(const \[id, disc\] of Object\.entries\(GAME_DISCS\)\) \{\s*\n\s*if \(desktopHasDisc\(user, id\)\) continue;/);
  assert.doesNotMatch(listing, /hasItem|user\.items|niveau|level/);
});

test('un disque rangé dans un dossier disparu revient à « Mes disques »', () => {
  assert.match(SERVEUR, /function desktopHasDisc\(user, id\) \{\s*\n\s*const liste = ensureDesktopItems\(user\);\s*\n\s*const dossiers = new Set\(liste\.filter\(\(it\) => it\.t === 'folder'\)\.map\(\(it\) => it\.u\)\);\s*\n\s*return liste\.some\(\(it\) => it\.t === 'disc' && it\.u === id\s*\n\s*&& \(!it\.p \|\| it\.p === 'root' \|\| dossiers\.has\(it\.p\)\)\);/);
});

test('les huit portages JS sont sur la feuille mobile', () => {
  const noms = listeMobile();
  for (const n of ['Frutibandas', 'Grapiz', 'Swapou', 'Mini-Wave', 'Minipixiz',
    'Frutisnake', 'Mini-Fever', 'JamaJama']) {
    assert.ok(noms.includes(n), n + ' manque à la feuille mobile');
  }
});

test('les trois jeux Flash y sont aussi, en fenêtre à part', () => {
  const noms = listeMobile();
  for (const n of ['Burning Kiwi', 'Kaluga', 'Motion-Ball 2']) {
    assert.ok(noms.includes(n), n + ' manque à la feuille mobile');
  }
  // Leurs gabarits sont ceux du catalogue serveur, au chiffre près.
  assert.match(LIGHT, /\{ flash: "bkiwi", swf: "games\/burningKiwi\/burningkiwi\.swf", w: 350, h: 350,/);
  assert.match(LIGHT, /\{ flash: "kaluga", swf: "games\/kaluga\/full\.swf", w: 640, h: 480, ct: 20, cb: 20,/);
  assert.match(LIGHT, /\{ flash: "mb2", swf: "games\/motionBall2\/full\.swf", w: 550, h: 400,/);
  assert.match(SERVEUR, /props: 'w=350;h=350;m=i'/);
  assert.match(SERVEUR, /props: 'w=640;h=480;ct=20;cb=20;m=i'/);
  assert.match(SERVEUR, /props: 'w=550;h=400;m=i'/);
  // …et l'ouverture reprend l'URL que `ruffle.html` construit pour la Frusion.
  assert.match(LIGHT, /var url = "\/game-popup\.html\?swf=" \+ encodeURIComponent\(d\.swf\)/);
  assert.match(LIGHT, /window\.__gamePopup = window\.open\(url, "frutiparc_game", traits\);/);
  // une seule fenêtre de jeu à la fois, comme le bureau
  assert.match(LIGHT, /if \(window\.__gamePopup && !window\.__gamePopup\.closed\) window\.__gamePopup\.close\(\);/);
  // le clic aiguille vers la fenêtre plutôt que vers un onglet
  assert.match(LIGHT, /if \(d\.flash\) return ouvrirJeuFlash\(d\);/);
});

test('leurs jaquettes sont celles du SWF, et elles existent', () => {
  // La feuille des disques compose l'ANNEAU et la JAQUETTE, comme
  // `but.icon.Full` : la jaquette seule laissait voir le fond de la feuille
  // par le trou du disque.
  for (const nom of ['bkiwi', 'kaluga', 'mb2']) {
    const p = path.join(ROOT, 'public/frutiz/sprites/disc_jaquette_' + nom + '.svg');
    assert.ok(fs.existsSync(p), 'jaquette manquante : ' + nom);
    assert.match(LIGHT, new RegExp('jaquette: "' + nom + '"'));
  }
  // Motion-Ball 2 est un FD BLANC : `discType` 1 au catalogue.
  assert.match(LIGHT, /jaquette: "mb2", anneau: "1"/);
  for (const t of ['0', '1']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/frutiz/sprites/disc_anneau_' + t + '.svg')),
      'anneau manquant : ' + t);
  }
});

/*
 * LES DEUX JAQUETTES QU'ON AVAIT INVENTÉES.
 *
 * fileIcon.swf porte dix-sept étiquettes de jaquette, et deux d'entre elles
 * servaient à des jeux pour lesquels le portage avait composé sa propre image
 * — Frutisnake (`snake`, image 1 de la bande : le serpent vert lové autour
 * d'une pomme) et JamaJama (`jama`, image 12). Les commentaires disaient
 * qu'aucune jaquette n'existait pour eux ; elles étaient là depuis le début.
 */
test('Frutisnake et JamaJama portent la jaquette d’époque', () => {
  for (const [tab, nom] of [['snake3', 'snake'], ['jamajama', 'jama']]) {
    assert.match(LIGHT, new RegExp('tab: "' + tab + '", jaquette: "' + nom + '"'),
      tab + ' doit prendre la jaquette « ' + nom + ' » du SWF');
    assert.ok(fs.existsSync(path.join(ROOT, 'public/frutiz/sprites/disc_jaquette_' + nom + '.svg')),
      'jaquette manquante : ' + nom);
  }
  // Et les montages qui les remplaçaient ont disparu.
  for (const f of ['public/fb/fd_snake3.png', 'public/fb/fd_jamajama.svg',
    'scripts/make-snake3-disc.js', 'scripts/make-jamajama-disc.js']) {
    assert.ok(!fs.existsSync(path.join(ROOT, f)), f + ' devrait avoir été retiré');
  }
  assert.ok(!/fd_snake3|fd_jamajama/.test(LIGHT), 'plus aucun renvoi vers les montages');
});

/*
 * ET SUR LE BUREAU, ILS S'ATTRAPENT.
 *
 * « Mes disques » du bureau montre les quinze FD du catalogue, mais ne rendait
 * attrapables que ceux qui ont un portage JS : Burning Kiwi, Kaluga (deux
 * pastilles — le FD et son aperçu) et Motion-Ball 2 restaient INERTES, donc
 * impossibles à glisser dans la Frusion. main.swf, lui, accepte n'importe quel
 * disque dans sa console : c'était un manque du portage, pas une règle
 * d'époque.
 */
test('les trois disques Flash s’attrapent aussi sur le bureau', () => {
  // Le pont : le catalogue des trois vit dans light.html, le bureau y puise.
  assert.match(LIGHT, /window\.JeuxFlash = \{/);
  assert.match(LIGHT, /parDisque: function \(libelle\)/);
  assert.match(BUREAU, /function jeuFlashDe\(jeu\) \{/);
  // La condition d'attrapabilité couvre les deux familles.
  const bloc = /function caseDisque\(e\) \{[\s\S]*?\n  \}/.exec(BUREAU);
  assert.ok(bloc, 'caseDisque doit exister');
  assert.match(bloc[0], /var flash = tab \? null : jeuFlashDe\(jeu\);/);
  assert.match(bloc[0], /if \(tab \|\| flash\) \{/,
    'un disque Flash doit s’attraper comme un autre');
  // Et la Frusion sait quoi en faire : une FENÊTRE, pas un onglet.
  const lance = /frusion\.lancer = function \(info\) \{[\s\S]*?\n  \};/.exec(BUREAU)[0];
  assert.match(lance, /window\.JeuxFlash\.ouvrir\(f\)/);
  // L'éjection la referme, comme elle ferme l'onglet d'un jeu porté.
  const eject = /frusion\.pushEject = function \(\) \{[\s\S]*?\n  \};/.exec(BUREAU)[0];
  assert.match(eject, /window\.JeuxFlash\.fermer\(\)/);
});

/*
 * UN DISQUE POSÉ SUR LE BUREAU QUITTE « MES DISQUES ».
 *
 * C'est la règle d'époque — un disque est un objet, pas un raccourci — et
 * c'est ce qui étonne : la fenêtre s'ouvre dans le coin, juste par-dessus les
 * icônes du bureau, et l'on croit ses disques perdus. Le catalogue, lui, ne
 * filtre rien d'autre : les quinze y sont pour qui n'a rien posé.
 */
test('le catalogue ne retient que ce qui n’est pas déjà sur le bureau', () => {
  const bloc = /if \(uid === 'disccollector'\) \{[\s\S]*?\n  \}/.exec(SERVEUR);
  assert.ok(bloc, 'le listing du catalogue doit exister');
  assert.match(bloc[0], /for \(const \[id, disc\] of Object\.entries\(GAME_DISCS\)\) \{/);
  assert.match(bloc[0], /if \(desktopHasDisc\(user, id\)\) continue;/);
  // AUCUNE autre condition : ni niveau, ni achat, ni pack.
  const corps = bloc[0].slice(bloc[0].indexOf('for ('));
  const conditions = corps.match(/\bif \(/g) || [];
  assert.strictEqual(conditions.length, 1,
    'une seule condition dans la boucle, celle du bureau (relevé : ' + conditions.length + ')');
});
