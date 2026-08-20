/*
 * L'inventaire du mode mobile, et le fond d'écran posé sur son bureau.
 *
 * Le bureau (main.swf) range l'inventaire en TROIS dossiers — Accessoires,
 * Fonds d'écran, Pictos — alors que la tuile « Inventaire » du mobile ouvrait
 * droit sur les accessoires : ni fond ni picto n'étaient atteignables au
 * téléphone. On sert désormais les trois rubriques, bâties sur les mêmes
 * sources que les nœuds XML du bureau, et on rend le fond d'écran posable.
 *
 * Le point délicat est le PARTAGE : le fond n'est pas une donnée « light »,
 * c'est la préférence n° 5 de main.swf, écrite par WallPaperMng.loadWP sous
 * la forme « url|dataMisc » dans la chaîne encodée que /do/mypref rend au
 * SWF. Poser un fond au mobile doit donc l'afficher sur le bureau Flash, et
 * réciproquement — sans abîmer les autres préférences qui partagent la
 * chaîne. C'est ce que ce fichier vérifie, des deux côtés du tuyau.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3497;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5238', FRUTISCORE_PORT: '5239',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function sidPour(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

const inventaire = (sid) =>
  fetch(`${BASE}/api/light/inventaire?sid=${sid}`).then((r) => r.json());

const acheter = (sid, id) =>
  fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, id }),
  }).then((r) => r.json());

const poser = (sid, id) =>
  fetch(BASE + '/api/light/fond', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, id }),
  });

const mypref = (sid) =>
  fetch(`${BASE}/do/mypref?sid=${sid}`).then((r) => r.text());

test('les trois rubriques du bureau existent au mobile, et chaque objet est dans la sienne', async () => {
  const sid = await sidPour('linv' + RUN);

  const neuf = await inventaire(sid);
  assert.equal(neuf.ok, true);
  // Les quatre accessoires d'origine sont donnés à tout le monde ; un compte
  // neuf n'a en revanche ni fond ni picto.
  assert.equal(neuf.accessoires.length, 4, 'les accessoires par défaut');
  assert.deepEqual(neuf.fonds, [], 'aucun fond au départ');
  assert.deepEqual(neuf.pictos, [], 'aucun picto au départ');
  assert.equal(neuf.fond, null, 'aucun fond posé');

  // 201 = « Chevalier moutarde », 206 = « Mini-Wave Nostromo » (gratuits).
  assert.equal((await acheter(sid, 201)).ok, true);
  assert.equal((await acheter(sid, 206)).ok, true);

  const apres = await inventaire(sid);
  assert.equal(apres.fonds.length, 2, 'les deux fonds achetés sont là');
  assert.equal(apres.accessoires.length, 4,
    "un fond d'écran ne doit PAS se retrouver parmi les accessoires");
  const noms = apres.fonds.map((f) => f.nom).sort();
  assert.deepEqual(noms, ['Chevalier moutarde', 'Mini-Wave Nostromo']);
  // Chaque fond porte son image et son dataMisc — c'est ce couple que le
  // bureau range dans la préférence.
  const moutarde = apres.fonds.find((f) => f.nom === 'Chevalier moutarde');
  assert.equal(moutarde.url, '/wal/ch.jpg');
  assert.equal(moutarde.color, '4E5464;');
});

test('les pictos remontent des gameItems, groupables par jeu', async () => {
  const sid = await sidPour('lpic' + RUN);

  // Une partie de Mini-Fever : cinq épreuves remportées, donc cinq pictos.
  const r = await fetch(BASE + '/api/minifever/score', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sid, palier: 0, niveau: 5, jouees: 5,
      gagnees: ['gameBasket', 'gameLander', 'gameFlower', 'gamePong', 'gameAstero'],
    }),
  }).then((x) => x.json());
  assert.equal(r.ok, true);

  const inv = await inventaire(sid);
  assert.equal(inv.pictos.length, 5, 'les cinq pictos entrent à l’album');
  const panier = inv.pictos.find((p) => p.id === '$fvBasket');
  assert.equal(panier.nom, 'Panier');
  assert.equal(panier.jeu, 'Mini-Fever', 'le jeu sert de titre de rubrique');
  assert.equal(panier.url, '/api/picto/%24fvBasket');
});

test('poser un fond au mobile écrit la préférence n° 5 du bureau, au format de WallPaperMng', async () => {
  const sid = await sidPour('lfon' + RUN);
  assert.equal((await acheter(sid, 206)).ok, true);   // Mini-Wave Nostromo

  const r = await poser(sid, 'wp_nostromo');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.fond.url, '/wal/pl.jpg');

  // Le format exact que main.swf relit : id et longueur sur deux caractères
  // base62, puis « url|dataMisc ». « 05 » = préférence 5, « 0i » = 18
  // caractères, et la valeur est bien celle qu'écrirait loadWP().
  const pref = await mypref(sid);
  assert.equal(pref, 'myPref=050iwal/pl.jpg|000044;',
    'la chaîne de préférences doit être celle du bureau, au caractère près');

  // Et l'inventaire annonce le fond courant, pour que le mobile le coche.
  const inv = await inventaire(sid);
  assert.equal(inv.fond.url, '/wal/pl.jpg');
  assert.equal(inv.fond.color, '000044;');

  // « Aucun » : le bureau vide la préférence sans la supprimer (setAndSave
  // avec une chaîne vide). La longueur retombe à zéro.
  assert.equal((await poser(sid, '')).status, 200);
  assert.equal(await mypref(sid), 'myPref=0500', 'le fond retiré laisse une valeur vide');
  assert.equal((await inventaire(sid)).fond, null);
});

test('un fond posé depuis le bureau Flash est celui que le mobile affiche', async () => {
  const sid = await sidPour('lbur' + RUN);
  assert.equal((await acheter(sid, 201)).ok, true);   // Chevalier moutarde

  // Le chemin inverse : WallPaperMng.loadWP a fait setAndSave("wallpaper",
  // url + "|" + dataMisc), et userPref.save() a poussé la chaîne entière par
  // /do/prefsave. Le mobile doit lire ce même fond, sans rien renégocier.
  const chaine = '0101Y050iwal/ch.jpg|4E5464;';
  await fetch(`${BASE}/do/prefsave?sid=${sid}&s=${encodeURIComponent(chaine)}`);

  const inv = await inventaire(sid);
  assert.equal(inv.fond.url, '/wal/ch.jpg', 'le mobile affiche le fond choisi au bureau');
  assert.equal(inv.fond.color, '4E5464;', 'avec sa couleur d’accompagnement');
});

test('le fond posé au mobile n’écrase pas les autres préférences', async () => {
  const sid = await sidPour('lmix' + RUN);
  assert.equal((await acheter(sid, 201)).ok, true);   // Chevalier moutarde

  // Le joueur avait déjà réglé des préférences depuis le bureau : on les pose
  // telles que /do/prefsave les reçoit du SWF.
  const avant = '0101Y0301N';
  await fetch(`${BASE}/do/prefsave?sid=${sid}&s=${encodeURIComponent(avant)}`);
  assert.equal(await mypref(sid), 'myPref=' + avant);

  assert.equal((await poser(sid, 'wp_moutarde')).status, 200);
  const apres = await mypref(sid);
  assert.match(apres, /^myPref=/);
  const chaine = apres.slice('myPref='.length);
  // Les deux réglages d'origine sont intacts, et le fond s'est glissé à sa
  // place (les entrées sont rangées par numéro : 1, 3, puis 5).
  assert.ok(chaine.startsWith('0101Y0301N'), 'les préférences 1 et 3 survivent : ' + chaine);
  assert.ok(chaine.endsWith('050iwal/ch.jpg|4E5464;'), 'le fond est ajouté à la suite : ' + chaine);
});

test('on ne pose que ce qu’on possède', async () => {
  const sid = await sidPour('lvol' + RUN);

  // Le fond existe au catalogue, mais ce compte ne l'a pas acheté.
  const r = await poser(sid, 'wp_utopiz');
  assert.equal(r.status, 404, 'un fond non possédé est refusé');
  assert.equal((await r.json()).error, 'inconnu');
  assert.equal(await mypref(sid), 'myPref=', 'et rien n’est écrit');

  // Un identifiant fantaisiste ne passe pas davantage.
  assert.equal((await poser(sid, 'wp_nexistepas')).status, 404);
});

test('sans session, l’inventaire ne dit rien', async () => {
  assert.equal((await fetch(BASE + '/api/light/inventaire?sid=zzz')).status, 401);
  assert.equal((await poser('zzz', 'wp_moutarde')).status, 401);
});

/*
 * Les versions VERTICALES des fonds d'écran.
 *
 * Les fonds d'origine sont des paysages : dans le tiroir de /light — étroit et
 * en portrait, sur téléphone comme sur écran large — le cadrage du bureau
 * Flash ne peut que les poser en timbre au milieu. Chaque fond a donc reçu un
 * redessin plein cadre (1536×2752) dans public/fb/boutique/, que le serveur
 * annonce en `urlMobile`.
 *
 * La correspondance se fait par nom de fichier, sur le libellé du fond
 * slugifié : cela couvre d'office les fonds ajoutés depuis l'admin. Deux des
 * fonds d'origine échappent à la règle et sont nommés explicitement.
 */
test('chaque fond annonce sa version verticale, et le fichier existe vraiment', async () => {
  const fsync = require('node:fs');
  const sid = await sidPour('lvert' + RUN);
  for (const id of [201, 202, 203, 204, 205, 206, 207, 208]) {
    assert.equal((await acheter(sid, id)).ok, true, `achat du fond ${id}`);
  }
  const inv = await inventaire(sid);
  assert.equal(inv.fonds.length, 8, 'les huit fonds du catalogue');

  const parNom = Object.fromEntries(inv.fonds.map((f) => [f.nom, f]));
  const attendus = {
    'Chevalier moutarde':  'background_chevalier_moutarde_mobile.jpg',
    'Noël Pixiz':          'background_noel_pixiz_mobile.jpg',
    'Noël Frutisnake':     'background_noel_frutisnake_mobile.jpg',
    'Mini-Pixiz':          'background_mini_pixiz_mobile.jpg',
    'Mini-Wave Nostromo':  'background_mini_wave_nostromodo_mobile.jpg',
    'Mini-Wave Mini-Star': 'background_mini_wave_ministar_mobile.png',
    'Utopiz':              'background_utopiz_mobile.jpg',
  };
  for (const [nom, fichier] of Object.entries(attendus)) {
    assert.equal(parNom[nom].urlMobile, '/fb/boutique/' + fichier,
      `${nom} doit pointer sur sa version verticale`);
    assert.ok(fsync.existsSync(path.join(ROOT, 'public', 'fb', 'boutique', fichier)),
      `${fichier} doit exister sur le disque`);
  }
  // La Chorale n'a pas encore de redessin : elle garde le cadrage d'origine.
  assert.equal(parNom['Chorale Frutiparc'].urlMobile, null,
    'un fond sans version verticale doit annoncer null, pas une url morte');
});

test('poser un fond rend aussi sa version verticale, sans la mettre dans la préférence', async () => {
  const sid = await sidPour('lvpr' + RUN);
  assert.equal((await acheter(sid, 206)).ok, true);          // Mini-Wave Nostromo

  const j = await (await poser(sid, 'wp_nostromo')).json();
  assert.equal(j.fond.url, '/wal/pl.jpg');
  assert.equal(j.fond.urlMobile, '/fb/boutique/background_mini_wave_nostromodo_mobile.jpg');

  // La préférence est PARTAGÉE avec main.swf : elle ne doit porter que l'url
  // d'origine. La variante verticale est déduite à la lecture, jamais stockée
  // — sans quoi le bureau Flash irait chercher une image faite pour le portrait.
  assert.equal(await mypref(sid), 'myPref=050iwal/pl.jpg|000044;',
    'la préférence du bureau ne doit rien connaître de la version verticale');

  // Et l'inventaire la redéduit tout seul au chargement suivant.
  assert.equal((await inventaire(sid)).fond.urlMobile,
    '/fb/boutique/background_mini_wave_nostromodo_mobile.jpg');
});

test('le client pose la version verticale en plein cadre, et garde la règle du SWF sans elle', () => {
  const fsync = require('node:fs');
  const src = fsync.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
  assert.match(src, /var vertical = !!fond\.urlMobile;/,
    'le redessin est choisi dès qu’il existe, quelle que soit la largeur');
  assert.match(src, /backgroundSize = "cover"/,
    'la version verticale est posée en plein cadre');
  // Le repli garde la transcription de WallPaperMng, « scale = 100 » compris.
  assert.match(src, /jamais d'agrandissement/,
    'la règle du bureau doit rester en place pour les fonds sans redessin');
});
