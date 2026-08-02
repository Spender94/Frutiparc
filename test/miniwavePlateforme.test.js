// Le pont entre Miniwave et Frutiparc : la fiche du joueur.
//
// Ce module n'invente rien — il écrit le slot 0 dans le format que le serveur
// lit déjà (parseMiniwavePipe), et c'est de là que sortent les pictos puis la
// consécration. Les tests vérifient donc les DEUX bouts : que le tuyau qu'on
// écrit est celui que le serveur sait relire, et qu'il n'efface pas ce que le
// joueur a fait sur le bureau.
//
// Le piège de ce genre de pont est toujours le même : une sauvegarde neuve
// écrite par-dessus une vraie. Elle ne plante pas, elle ne rétrécit pas assez
// pour déclencher le garde-fou du serveur — elle efface simplement des mois de
// jeu. D'où le verrou `charge` et le test qui le tient.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Le module est écrit pour le navigateur (il s'accroche à window). On lui en
// fabrique un, plutôt que de le dupliquer ici : c'est le vrai fichier servi au
// joueur qui est testé.
function chargerPlateforme(fetchFactice) {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/plateforme.js'), 'utf8');
  const bac = { window: {}, fetch: fetchFactice, Promise, JSON, Number, Array, Object, String, Error };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(src, bac, { filename: 'plateforme.js' });
  return bac.window.MiniwavePlateforme;
}

// Le lecteur du serveur, pris tel quel dans server.js : c'est lui qui doit
// comprendre ce qu'on écrit. En extraire la fonction évite de démarrer tout le
// serveur pour vérifier un format.
function parseMiniwavePipeDuServeur() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = src.indexOf('function parseMiniwavePipe(s) {');
  assert.ok(i > 0, 'parseMiniwavePipe est bien dans server.js');
  // Jusqu'à l'accolade fermante en début de ligne : la fonction est au premier
  // niveau du fichier.
  const fin = src.indexOf('\n}\n', i);
  const code = src.slice(i, fin + 3);
  const bac = { Number, String, Array };
  vm.createContext(bac);
  vm.runInContext(code + '\nglobalThis.f = parseMiniwavePipe;', bac);
  return bac.f;
}

const P = chargerPlateforme(() => Promise.reject(new Error('pas de réseau dans ce test')));
const parsePipe = parseMiniwavePipeDuServeur();

test('la fiche neuve est celle de formatFruticard', () => {
  const s = P.slotNeuf();
  // Le vaisseau de départ, et lui seul.
  assert.deepEqual(s.ship, [1, 0, 0, 0, 0, 0]);
  assert.equal(s.badsKill.length, 51, 'une case par espèce du bestiaire');
  assert.ok(s.badsKill.every((n) => n === 0));
  assert.equal(s.bestLevel, 0);
  assert.equal(s.consBonus.length, 8);
  assert.equal(s.consLetter, 0);
  // La boutique : 1 = à vendre, 0 = acheté. La convention est l'inverse de
  // celle de $ship, et s'y tromper offrirait les vingt articles d'un coup.
  assert.equal(s.shop.length, 20);
  assert.ok(s.shop.every((n) => n === 1), 'rien n\'est acheté au départ');
  assert.equal(s.vs, 0.93);
});

test('le tuyau qu\'on écrit est celui que le serveur relit', () => {
  const s = P.slotNeuf();
  s.badsKill[3] = 200;
  s.badsKill[7] = 42;
  s.bestLevel = 12;
  s.ship[2] = 1;
  s.consBonus[1] = 100;
  s.consLetter = 55;
  s.shop[11] = 0;

  const relu = parsePipe(P.versTuyau(s));
  assert.ok(relu, 'le serveur accepte le tuyau');
  assert.deepEqual(relu.$ship, [true, false, true, false, false, false]);
  assert.equal(relu.$badsKill.length, 51);
  assert.equal(relu.$badsKill[3], 200);
  assert.equal(relu.$badsKill[7], 42);
  assert.equal(relu.$arcade.$bestLevel, 12);
  assert.equal(relu.$cons.$bonus[1], 100);
  assert.equal(relu.$cons.$letter, 55);
  assert.equal(relu.$shop[11], 0);
  assert.equal(relu.$vs, 0.93);
});

test('l\'aller-retour serveur ne perd rien', () => {
  const s = P.slotNeuf();
  s.badsKill[0] = 199; s.badsKill[50] = 1;
  s.bestLevel = 201; s.ship[5] = 1; s.consLetter = 100; s.shop[14] = 0;
  const retour = P.depuisServeur(parsePipe(P.versTuyau(s)));
  assert.deepEqual(retour, s);
});

test('les seuils du serveur sont ceux qu\'on annonce au joueur', () => {
  // extractGameItemsFromSlot accorde $bads{i} à 200 éliminations et $arcade dès
  // que bestLevel dépasse 0. nouveauxPictos doit dire exactement la même chose,
  // sans quoi le jeu promettrait des pictos que le serveur ne donne pas.
  const avant = P.slotNeuf();
  avant.badsKill[4] = 199;
  const apres = P.fusionner(avant, { badsKill: { 4: 1, 9: 3 }, level: 0 });
  const gagnes = P.nouveauxPictos(avant, apres);
  assert.deepEqual(gagnes, [{ genre: 'bads', type: 4 }, { genre: 'arcade' }]);

  // Une deuxième partie ne re-annonce pas ce qui est déjà acquis.
  const encore = P.fusionner(apres, { badsKill: { 4: 10 }, level: 3 });
  assert.deepEqual(P.nouveauxPictos(apres, encore), []);

  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /badsKill\[i\] >= 200\) addIfNew\('\$bads' \+ i\)/,
    'le serveur accorde bien le picto d\'espèce à 200');
  assert.match(src, /\$arcade && parsed\.\$arcade\.\$bestLevel > 0\) addIfNew\('\$arcade'\)/,
    'le serveur accorde bien le picto arcade dès le premier niveau atteint');
});

test('la fusion accumule les éliminations et ne fait jamais redescendre le record', () => {
  let s = P.slotNeuf();
  s.bestLevel = 40;
  // Trois parties de suite sur la même espèce : c'est ainsi qu'on atteint 200.
  s = P.fusionner(s, { badsKill: { 12: 80 }, level: 5 });
  s = P.fusionner(s, { badsKill: { 12: 80 }, level: 2 });
  s = P.fusionner(s, { badsKill: { 12: 80 }, level: 9 });
  assert.equal(s.badsKill[12], 240, 'les trois parties s\'additionnent');
  assert.equal(s.bestLevel, 40, 'trois parties plus courtes n\'effacent pas le record');

  const mieux = P.fusionner(s, { badsKill: {}, level: 99 });
  assert.equal(mieux.bestLevel, 100, 'un index de niveau 99 vaut 100 niveaux atteints');
});

test('la fusion laisse intacte la progression des modes non portés', () => {
  const s = P.slotNeuf();
  s.ship = [1, 1, 1, 0, 0, 0];           // vaisseaux achetés sur le bureau
  s.consBonus = [100, 100, 50, 0, 0, 0, 0, 0];
  s.consLetter = 100;
  s.shop = s.shop.slice(); s.shop[10] = 0; s.shop[13] = 0;
  const f = P.fusionner(s, { badsKill: { 1: 5 }, level: 1 });
  assert.deepEqual(f.ship, [1, 1, 1, 0, 0, 0], 'les vaisseaux achetés restent');
  assert.deepEqual(f.consBonus, [100, 100, 50, 0, 0, 0, 0, 0], 'les missions restent');
  assert.equal(f.consLetter, 100, 'le mode lettres reste');
  assert.equal(f.shop[10], 0, 'les articles achetés restent achetés');
  assert.equal(f.shop[13], 0);
  // Et la fiche d'origine n'est pas modifiée au passage.
  assert.equal(s.badsKill[1], 0, 'fusionner ne touche pas à l\'entrée');
});

test('la fusion ignore les types d\'ennemi hors bestiaire', () => {
  // Le moteur indexe badsKill par type ; un type inattendu ne doit pas allonger
  // le tableau, sans quoi le tuyau change de forme et le serveur lit de travers.
  const f = P.fusionner(P.slotNeuf(), { badsKill: { 3: 2, 51: 9, '-1': 4, x: 7 }, level: 0 });
  assert.equal(f.badsKill.length, 51);
  assert.equal(f.badsKill[3], 2);
  assert.equal(P.versTuyau(f).split('|')[1].split(',').length, 51);
});

test('la réponse LoadVars du serveur est bien décodée', () => {
  const fiche = { $ship: [true, false, false, false, false, false], $badsKill: [1, 2, 3] };
  const txt = 'ok=1&slot0=' + encodeURIComponent(JSON.stringify(fiche)) + '&slot1=' + encodeURIComponent('{"$sound":true}');
  assert.equal(P.lireLoadVars(txt, '0'), JSON.stringify(fiche));
  assert.equal(P.lireLoadVars(txt, '1'), '{"$sound":true}');
  // Un compte neuf n'a pas de slot : le serveur répond « ok=1 » tout court.
  assert.equal(P.lireLoadVars('ok=1', '0'), null);
});

test('le chargement lit la fiche du serveur, telle qu\'il la sert', async () => {
  const fiche = {
    $ship: [true, false, true, false, false, false],
    $badsKill: Array.from({ length: 51 }, (_, i) => (i === 6 ? 150 : 0)),
    $arcade: { $bestLevel: 33 },
    $cons: { $bonus: [100, 0, 0, 0, 0, 0, 0, 0], $letter: 20 },
    $shop: Array.from({ length: 20 }, (_, i) => (i === 12 ? 0 : 1)),
    $vs: 0.93,
  };
  let vue = '';
  const Pl = chargerPlateforme((url) => {
    vue = url;
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve('ok=1&slot0=' + encodeURIComponent(JSON.stringify(fiche))),
    });
  });
  const p = new Pl.Plateforme('SID42');
  const s = await p.charger();
  assert.match(vue, /^\/api\/loadFrutiSlots\?sid=SID42&game=miniwave$/);
  assert.equal(p.charge, true);
  assert.deepEqual(s.ship, [1, 0, 1, 0, 0, 0]);
  assert.equal(s.badsKill[6], 150);
  assert.equal(s.bestLevel, 33);
  assert.equal(s.consLetter, 20);
  assert.equal(s.shop[12], 0);
});

test('un compte neuf part de la fiche vierge et a le droit d\'enregistrer', async () => {
  const envois = [];
  const Pl = chargerPlateforme((url, opt) => {
    if (url.indexOf('/api/loadFrutiSlots') === 0) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve('ok=1') });
    }
    envois.push(JSON.parse(opt.body));
    return Promise.resolve({ ok: true });
  });
  const p = new Pl.Plateforme('SIDNEUF');
  await p.charger();
  assert.equal(p.charge, true, 'une réponse vide est une fiche vierge, pas une panne');
  const r = await p.enregistrer({ badsKill: { 2: 3 }, level: 0, score: 120 });
  assert.equal(r.enregistre, true);
  assert.equal(envois.length, 1);
  assert.equal(envois[0].game, 'miniwave');
  assert.equal(envois[0].slotId, '0');
  const relu = parsePipe(envois[0].data);
  assert.equal(relu.$badsKill[2], 3);
  assert.equal(relu.$arcade.$bestLevel, 1);
});

test('un chargement raté interdit d\'enregistrer — jamais de fiche neuve par-dessus une vraie', async () => {
  let sauvegardes = 0;
  const Pl = chargerPlateforme((url, opt) => {
    if (url.indexOf('/api/loadFrutiSlots') === 0) return Promise.resolve({ ok: false, status: 503 });
    sauvegardes++;
    return Promise.resolve({ ok: true });
  });
  const p = new Pl.Plateforme('SIDPANNE');
  await p.charger();
  assert.equal(p.charge, false, 'le serveur n\'a pas répondu : on ne sait pas ce qu\'il y a à fusionner');
  const r = await p.enregistrer({ badsKill: { 0: 500 }, level: 200 });
  assert.equal(r.enregistre, false);
  assert.equal(sauvegardes, 0, 'RIEN n\'est envoyé — c\'est tout l\'intérêt du verrou');
  // Le garde-fou du serveur ne suffirait pas ici : une fiche neuve fait la même
  // longueur qu'une fiche pleine (51 zéros au lieu de 51 nombres).
  const neuve = Pl.versTuyau(Pl.slotNeuf());
  const pleine = Pl.versTuyau(Pl.fusionner(Pl.slotNeuf(), { badsKill: { 0: 500 }, level: 200 }));
  assert.ok(neuve.length > pleine.length * 0.5,
    'le seuil des 50 % du serveur ne rattraperait pas l\'écrasement');
});

test('sans session, on joue mais on n\'enregistre pas', async () => {
  let appels = 0;
  const Pl = chargerPlateforme(() => { appels++; return Promise.resolve({ ok: true, text: () => Promise.resolve('') }); });
  const p = new Pl.Plateforme('');
  await p.charger();
  const r = await p.enregistrer({ badsKill: { 1: 1 }, level: 0 });
  assert.equal(appels, 0, 'aucun appel réseau sans session');
  assert.equal(r.enregistre, false);
  assert.equal(r.slot.badsKill[1], 1, 'la partie est quand même comptabilisée en mémoire');
});

test('le jeu annonce la fin de partie avec de quoi remplir la fiche', () => {
  // Le moteur doit joindre le relevé des éliminations à l'annonce finPartie :
  // sans lui, la plateforme n'aurait rien à enregistrer.
  const { Game } = require(path.join(ROOT, 'public/miniwave/engine.js'));
  const niveaux = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/miniwave/levels.json'), 'utf8'));
  let fin = null;
  const g = new Game({
    levels: niveaux.main[0].levels, graine: 1,
    onEvent: (n, d) => { if (n === 'finPartie') fin = d; },
  });
  g.badsKill[5] = 7;
  g.finPartie('gameover');
  assert.ok(fin, 'la fin de partie est annoncée');
  assert.deepEqual(fin.badsKill, { 5: 7 }, 'le relevé des éliminations part avec');
  assert.equal(typeof fin.level, 'number');
  assert.equal(typeof fin.score, 'number');
  // Et c'est bien une copie : le moteur peut être relancé sans que la fiche
  // déjà enregistrée bouge dans le dos de la plateforme.
  g.badsKill[5] = 99;
  assert.equal(fin.badsKill[5], 7);
});

test('la page du jeu branche vraiment la plateforme', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/miniwave/index.html'), 'utf8');
  assert.match(html, /src="\/miniwave\/plateforme\.js"/, 'le module est chargé');
  assert.match(html, /new window\.MiniwavePlateforme\.Plateforme\(sid\)/, 'construite avec la session');
  assert.match(html, /plateforme\.charger\(\)/, 'la fiche est lue au démarrage');
  assert.match(html, /plateforme\.enregistrer\(info\)/, 'et écrite en fin de partie');
});

test('/light lance Miniwave comme les autres disques', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(html, /id="miniwave-panel"/, 'le panneau existe');
  assert.match(html, /id="miniwave-frame"/, 'et son cadre');
  assert.match(html, /classList\.toggle\("active", tab === "miniwave"\)/, 'activateTab le montre');
  // La session DOIT être transmise : sans elle le jeu tourne, mais n'enregistre
  // rien — ni pictos ni consécration.
  assert.match(html, /"\/miniwave\/\?sid=" \+ encodeURIComponent\(state\.sid\)/,
    'le cadre reçoit la session du joueur');
  assert.match(html, /\{ tab: "miniwave", img: "\/fb\/fd_miniwave\.png", name: "Mini-Wave" \}/,
    'le disque est dans « Mes disques »');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/fb/fd_miniwave.png')), 'la vignette du disque existe');
});
