// Le pont entre Miniwave et Frutiparc : la fiche du joueur.
//
// Ce module n'invente rien côté serveur — il écrit le slot 0 dans le format que
// le serveur lit déjà, et c'est de là que sortent les pictos puis la
// consécration. Les tests vérifient donc les DEUX bouts : que ce qu'on écrit
// est ce que le serveur sait relire, et qu'on n'efface pas ce que le joueur a
// fait ailleurs.
//
// Le piège de ce genre de pont est toujours le même : une sauvegarde neuve
// écrite par-dessus une vraie. Elle ne plante pas, ne rétrécit pas assez pour
// déclencher le garde-fou du serveur — elle efface simplement des mois de jeu.
// D'où le verrou `charge` et le test qui le tient.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'public/miniwave/plateforme.js'));

// Une Plateforme avec un `fetch` de comédie : le module est écrit pour le
// navigateur, on lui en fabrique un. C'est bien le fichier servi au joueur qui
// est exercé, pas une réécriture.
function avecReseau(fetchFactice) {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/plateforme.js'), 'utf8');
  const bac = {
    window: {}, fetch: fetchFactice, Promise, JSON, Number, Array, Object, String, Error, Math,
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(src, bac, { filename: 'plateforme.js' });
  return bac.window.MiniwavePlateforme;
}

// Le lecteur du serveur, pris tel quel dans server.js : c'est lui qui doit
// comprendre le tuyau du bureau.
const parsePipe = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = src.indexOf('function parseMiniwavePipe(s) {');
  assert.ok(i > 0, 'parseMiniwavePipe est bien dans server.js');
  const code = src.slice(i, src.indexOf('\n}\n', i) + 3);
  const bac = { Number, String, Array };
  vm.createContext(bac);
  vm.runInContext(code + '\nglobalThis.f = parseMiniwavePipe;', bac);
  return bac.f;
})();

// ── La fiche ───────────────────────────────────────────────────────────────

test('la fiche neuve est celle de formatFruticard', () => {
  const c = P.carteNeuve();
  assert.deepEqual(c.$ship, [1, 0, 0, 0, 0, 0], 'le vaisseau de départ, et lui seul');
  assert.equal(c.$badsKill.length, 51, 'une case par espèce du bestiaire');
  assert.ok(c.$badsKill.every((n) => n === 0));
  assert.deepEqual(c.$arcade, { $bestScore: 0, $bestLevel: 0 });
  assert.deepEqual(c.$mode, [1, new Array(8).fill(0), [0, 0, 0], 1, 1],
    'arcade et boutique ouverts, missions et spéciaux à acheter');
  assert.equal(c.$cons.$bonus.length, 8);
  assert.equal(c.$credit, 0, 'pas un crédit au départ');
  // La boutique : 1 = à vendre, 0 = acheté. La convention est l'inverse de
  // celle de $ship, et s'y tromper offrirait les vingt articles d'un coup.
  assert.equal(c.$shop.length, 20);
  assert.ok(c.$shop.every((n) => n === 1), 'rien n\'est acheté au départ');
  assert.equal(c.$vs, 0.93);
  assert.deepEqual(c.$stats.$play, { $main: 0, $mission: 0, $survival: 0, $letter: 0 });
});

test('le tuyau du bureau reste lisible par le serveur', () => {
  // On n'enregistre plus par le tuyau, mais savoir le produire prouve qu'on
  // parle la même langue que le SWF — et c'est ce format que la greffe
  // serveur doit reconnaître.
  const c = P.carteNeuve();
  c.$badsKill[3] = 200; c.$badsKill[7] = 42;
  c.$arcade.$bestLevel = 12; c.$ship[2] = 1;
  c.$cons.$bonus[1] = 100; c.$cons.$letter = 55; c.$shop[11] = 0;

  const relu = parsePipe(P.versTuyau(c));
  assert.ok(relu, 'le serveur accepte le tuyau');
  assert.deepEqual(relu.$ship, [true, false, true, false, false, false]);
  assert.equal(relu.$badsKill[3], 200);
  assert.equal(relu.$arcade.$bestLevel, 12);
  assert.equal(relu.$cons.$bonus[1], 100);
  assert.equal(relu.$cons.$letter, 55);
  assert.equal(relu.$shop[11], 0);
  assert.equal(relu.$vs, 0.93);
});

test('une fiche venue du tuyau est complétée, pas refusée', () => {
  // Sept champs seulement : tout le reste doit reprendre ses valeurs neuves,
  // sans quoi le jeu planterait sur un $mode absent.
  const c = P.normaliser(parsePipe(P.versTuyau(P.carteNeuve())));
  assert.deepEqual(c, P.carteNeuve(), 'l\'aller-retour par le tuyau redonne la fiche neuve');
  // Et une fiche complète survit intacte à l'aller-retour JSON.
  const riche = P.carteNeuve();
  riche.$credit = 1234; riche.$mode[2] = [1, 1, 0]; riche.$survival = 9000;
  assert.deepEqual(P.normaliser(JSON.parse(JSON.stringify(riche))), riche);
});

test('les seuils du serveur sont ceux qu\'on annonce au joueur', () => {
  const avant = P.carteNeuve();
  avant.$badsKill[4] = 199;
  const apres = P.fusionner(avant, { mode: 'arcade', badsKill: { 4: 1, 9: 3 }, level: 0 });
  assert.deepEqual(P.nouveauxPictos(avant, apres),
    [{ genre: 'bads', type: 4 }, { genre: 'arcade' }]);
  // Une deuxième partie ne re-annonce pas ce qui est déjà acquis.
  const encore = P.fusionner(apres, { mode: 'arcade', badsKill: { 4: 10 }, level: 3 });
  assert.deepEqual(P.nouveauxPictos(apres, encore), []);

  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /badsKill\[i\] >= 200\) addIfNew\('\$bads' \+ i\)/);
  assert.match(src, /\$arcade && parsed\.\$arcade\.\$bestLevel > 0\) addIfNew\('\$arcade'\)/);
  assert.match(src, /cons\.\$bonus\[i\] >= 100\) addIfNew\('\$mis' \+ i\)/);
  assert.match(src, /cons\.\$letter >= 100\) addIfNew\('\$letter'\)/);
});

// ── Ce que chaque mode enregistre ──────────────────────────────────────────

test('l\'arcade retient son meilleur niveau et son meilleur score', () => {
  let c = P.carteNeuve();
  c = P.fusionner(c, { mode: 'arcade', score: 5000, level: 40, cons: 20, badsKill: { 1: 9 } });
  assert.equal(c.$arcade.$bestLevel, 41, 'un index de 40 vaut 41 niveaux atteints');
  assert.equal(c.$arcade.$bestScore, 5000);
  assert.equal(c.$cons.$main, 20);
  assert.equal(c.$stats.$play.$main, 1);
  // Une partie plus courte n'efface rien.
  c = P.fusionner(c, { mode: 'arcade', score: 100, level: 2, cons: 1, badsKill: { 1: 3 } });
  assert.equal(c.$arcade.$bestLevel, 41, 'le record tient');
  assert.equal(c.$arcade.$bestScore, 5000);
  assert.equal(c.$cons.$main, 20);
  assert.equal(c.$badsKill[1], 12, 'les éliminations, elles, s\'accumulent');
  assert.equal(c.$stats.$play.$main, 2, 'et les parties se comptent');
});

test('une mission verse sa prime une seule fois', () => {
  let c = P.carteNeuve();
  c.$credit = 30;
  // Mission bouclée à 60 % : pas de prime, mais le pourcentage est retenu.
  c = P.fusionner(c, { mode: 'mission', missionNum: 2, cons: 60, score: 800, prime: 500 });
  assert.equal(c.$cons.$bonus[2], 60);
  assert.equal(c.$bonus[2], 800);
  assert.equal(c.$credit, 30, 'pas de prime avant 100 %');
  // Bouclée entièrement : la prime tombe.
  c = P.fusionner(c, { mode: 'mission', missionNum: 2, cons: 100, score: 1200, prime: 500 });
  assert.equal(c.$cons.$bonus[2], 100);
  assert.equal(c.$credit, 530, 'la prime est versée');
  // Rebouclée : plus rien.
  c = P.fusionner(c, { mode: 'mission', missionNum: 2, cons: 100, score: 9000, prime: 500 });
  assert.equal(c.$credit, 530, 'et pas deux fois');
  // Un moins bon passage n'abaisse pas l'acquis.
  c = P.fusionner(c, { mode: 'mission', missionNum: 2, cons: 10, score: 5, prime: 500 });
  assert.equal(c.$cons.$bonus[2], 100);
  assert.equal(c.$stats.$play.$mission, 4);
});

test('les modes spéciaux gardent leur record', () => {
  let c = P.carteNeuve();
  c = P.fusionner(c, { mode: 'survival', score: 12000, level: 8 });
  assert.equal(c.$survival, 12000);
  assert.equal(c.$arcade.$bestLevel, 0, 'l\'endurance ne touche pas à l\'arcade');
  c = P.fusionner(c, { mode: 'survival', score: 900 });
  assert.equal(c.$survival, 12000, 'le record tient');

  c = P.fusionner(c, { mode: 'letter', score: 4000, cons: 100 });
  assert.equal(c.$letter, 4000);
  assert.equal(c.$cons.$letter, 100, 'le parcours des lettres bouclé ouvre son picto');
  assert.deepEqual(c.$stats.$play, { $main: 0, $mission: 0, $survival: 2, $letter: 1 });
});

test('les crédits ramassés en partie s\'ajoutent au solde', () => {
  let c = P.carteNeuve();
  c = P.fusionner(c, { mode: 'arcade', credits: 42, saucerKill: 2, score: 1, level: 0 });
  assert.equal(c.$credit, 42);
  assert.equal(c.$saucerKill, 2);
  c = P.fusionner(c, { mode: 'arcade', credits: 8, saucerKill: 1, score: 1, level: 0 });
  assert.equal(c.$credit, 50, 'ils s\'accumulent d\'une partie à l\'autre');
  assert.equal(c.$saucerKill, 3);
});

test('la fusion ignore les types d\'ennemi hors bestiaire', () => {
  // Un type inattendu ne doit pas allonger le tableau, sans quoi le tuyau
  // change de forme et le serveur lit de travers.
  const c = P.fusionner(P.carteNeuve(),
    { mode: 'arcade', badsKill: { 3: 2, 51: 9, '-1': 4, x: 7 }, level: 0 });
  assert.equal(c.$badsKill.length, 51);
  assert.equal(c.$badsKill[3], 2);
  assert.equal(P.versTuyau(c).split('|')[1].split(',').length, 51);
});

test('la fusion ne modifie pas la fiche d\'entrée', () => {
  const c = P.carteNeuve();
  P.fusionner(c, { mode: 'arcade', badsKill: { 1: 5 }, level: 9, score: 99, credits: 7 });
  assert.equal(c.$badsKill[1], 0);
  assert.equal(c.$credit, 0);
  assert.equal(c.$arcade.$bestLevel, 0);
});

// ── La boutique ────────────────────────────────────────────────────────────

test('la boutique vend ce que le jeu vend, au prix du jeu', () => {
  const attendus = [
    [0, 'Proto', 80], [1, 'Gapatsa', 140], [2, 'Namazan', 160], [3, 'Sacuro', 320],
    [4, 'Rycher', 680], [5, 'Mission 1', 10], [6, 'Mission 2', 50], [7, 'Mission 3', 80],
    [8, 'Letter Invader', 120], [9, 'Endurance', 120], [10, 'Smiley 1', 30],
    [11, 'Smiley 2', 220], [12, 'Smiley 3', 480], [15, 'Mission 4', 200], [16, 'Mission 5', 400],
  ];
  for (const [id, nom, prix] of attendus) {
    const a = P.article(id);
    assert.ok(a, `article ${id} présent`);
    assert.equal(a.nom, nom);
    assert.equal(a.prix, prix, `${nom} coûte ${prix}`);
  }
  // Les fonds d'écran gardent leur prix, seul leur libellé est francisé.
  assert.equal(P.article(13).prix, 1600);
  assert.equal(P.article(14).prix, 2400);
  // L'article 17 du jeu (« Mission 6 ») ouvrirait une mission restée vide :
  // le vendre serait faire payer un menu qui ne mène nulle part.
  assert.equal(P.article(17), null, 'la mission fantôme n\'est pas en rayon');
  assert.equal(P.BOUTIQUE.length, 17);
});

test('acheter un vaisseau le débloque et le paie', () => {
  const c = P.carteNeuve();
  c.$credit = 100;
  const r = P.acheter(c, 0);                     // Proto, 80 crédits
  assert.equal(r.ok, true);
  assert.equal(c.$credit, 20, 'le prix est débité');
  assert.equal(c.$shop[0], 0, 'l\'article est marqué vendu');
  assert.equal(c.$ship[1], 1, 'le vaisseau est acquis');
  assert.deepEqual(c.$ship, [1, 1, 0, 0, 0, 0]);
  // Le serveur accordera le picto en lisant $ship — on l'annonce d'avance.
  const gagnes = P.nouveauxPictos(P.carteNeuve(), c);
  assert.ok(gagnes.some((g) => g.genre === 'vaisseau' && g.num === 1));
});

test('on ne peut pas acheter sans crédits, ni acheter deux fois', () => {
  const c = P.carteNeuve();
  c.$credit = 50;
  const pauvre = P.acheter(c, 0);                // Proto, 80
  assert.equal(pauvre.ok, false);
  assert.equal(pauvre.raison, 'credit');
  assert.equal(pauvre.manque, 30, 'on dit combien il manque');
  assert.equal(c.$credit, 50, 'rien n\'est débité');
  assert.equal(c.$ship[1], 0, 'et rien n\'est débloqué');

  c.$credit = 200;
  assert.equal(P.acheter(c, 5).ok, true);        // Mission 1, 10
  const bis = P.acheter(c, 5);
  assert.equal(bis.ok, false);
  assert.equal(bis.raison, 'deja');
  assert.equal(c.$credit, 190, 'pas débité une seconde fois');
  assert.equal(P.acheter(c, 99).raison, 'inconnu');
});

test('la boutique ouvre les modes du menu', () => {
  const c = P.carteNeuve();
  c.$credit = 5000;
  let ouverts = P.modesOuverts(c);
  assert.equal(ouverts.letter, false, 'Letter Invader est fermé au départ');
  assert.equal(ouverts.survival, false, 'Endurance aussi');
  assert.deepEqual(ouverts.missions, new Array(8).fill(0), 'et aucune mission');

  P.acheter(c, 8);                               // Letter Invader
  P.acheter(c, 9);                               // Endurance
  P.acheter(c, 5);                               // Mission 1
  P.acheter(c, 16);                              // Mission 5 → $mode[1][4]
  ouverts = P.modesOuverts(c);
  assert.equal(ouverts.letter, true);
  assert.equal(ouverts.survival, true);
  assert.equal(ouverts.missions[0], 1, 'la première mission est ouverte');
  assert.equal(ouverts.missions[4], 1, 'la cinquième aussi');
  assert.equal(ouverts.missions[1], 0, 'les autres non');
  assert.deepEqual(c.$mode[2], [1, 1, 0], 'le mode Time reste fermé — il n\'est pas porté');
});

test('les articles-pictos passent par $shop, que le serveur relit', () => {
  const c = P.carteNeuve();
  c.$credit = 30 + 220 + 480 + 1600 + 2400;      // de quoi payer les cinq, au crédit près
  for (const id of [10, 11, 12, 13, 14]) assert.equal(P.acheter(c, id).ok, true, `article ${id}`);
  assert.equal(c.$credit, 0, 'la caisse est vide, les prix sont bien ceux du jeu');
  // C'est exactement la table du serveur.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /\[10, '\$smiley_love'\], \[11, '\$smiley_laugh'\], \[12, '\$smiley_twirl'\]/);
  assert.match(src, /\[13, '\$wpMinistar'\], \[14, '\$wpNostromo'\]/);
  for (const id of [10, 11, 12, 13, 14]) assert.equal(c.$shop[id], 0);
  const gagnes = P.nouveauxPictos(P.carteNeuve(), c);
  assert.equal(gagnes.filter((g) => g.genre === 'article').length, 5, 'cinq pictos annoncés');
});

test('les achats sont journalisés comme dans le jeu', () => {
  const c = P.carteNeuve();
  c.$credit = 1000;
  c.$stats.$play = { $main: 3, $mission: 2, $survival: 1, $letter: 0 };
  P.acheter(c, 5);
  assert.deepEqual(c.$stats.$buy, [{ id: 5, g: 6 }],
    'ShopSlot.select note l\'article et le nombre de parties jouées');
});

test('le grade suit la formule du jeu', () => {
  const c = P.carteNeuve();
  assert.equal(P.grade(c), 0, 'apprenti à la première partie');
  assert.equal(P.GRADES[0], 'Apprenti');
  assert.equal(P.GRADES.length, 13, 'treize grades, jusqu\'à Colonel');
  // Un joueur chevronné monte — sans jamais dépasser le dernier grade.
  c.$cons.$main = 100;
  c.$cons.$bonus = [100, 100, 100, 100, 100, 0, 0, 0];
  c.$badsKill = c.$badsKill.map(() => 5000);
  const g = P.grade(c);
  assert.ok(g > 0 && g < P.GRADES.length, `grade plausible (${g} — ${P.GRADES[g]})`);
});

// ── Le réseau ──────────────────────────────────────────────────────────────

test('la réponse LoadVars du serveur est bien décodée', () => {
  const fiche = { $ship: [true, false, false, false, false, false], $credit: 12 };
  const txt = 'ok=1&slot0=' + encodeURIComponent(JSON.stringify(fiche))
    + '&slot1=' + encodeURIComponent('{"$sound":true}');
  assert.equal(P.lireLoadVars(txt, '0'), JSON.stringify(fiche));
  assert.equal(P.lireLoadVars(txt, '1'), '{"$sound":true}');
  // Un compte neuf n'a pas de slot : le serveur répond « ok=1 » tout court.
  assert.equal(P.lireLoadVars('ok=1', '0'), null);
});

test('le chargement lit la fiche du serveur, telle qu\'il la sert', async () => {
  const fiche = P.carteNeuve();
  fiche.$credit = 777; fiche.$mode[2] = [1, 0, 0]; fiche.$survival = 5000;
  fiche.$badsKill[6] = 150; fiche.$arcade = { $bestScore: 9, $bestLevel: 33 };
  let vue = '';
  const Pl = avecReseau((url) => {
    vue = url;
    return Promise.resolve({
      ok: true, text: () => Promise.resolve('ok=1&slot0=' + encodeURIComponent(JSON.stringify(fiche))),
    });
  });
  const p = new Pl.Plateforme('SID42');
  const c = await p.charger();
  assert.match(vue, /^\/api\/loadFrutiSlots\?sid=SID42&game=miniwave$/);
  assert.equal(p.charge, true);
  assert.equal(c.$credit, 777);
  assert.equal(c.$badsKill[6], 150);
  assert.equal(c.$arcade.$bestLevel, 33);
  assert.equal(c.$survival, 5000);
  assert.deepEqual(c.$mode[2], [1, 0, 0]);
});

test('la sauvegarde part en JSON complet, pas en tuyau', () => {
  // C'est ce qui permet de garder crédits, modes achetés et records : le tuyau
  // du bureau n'a que sept champs et les perdrait tous.
  const c = P.carteNeuve();
  c.$credit = 500;
  const texte = JSON.stringify(c);
  assert.equal(texte[0], '{', 'la fiche part en JSON');
  // /api/saveFrutiSlot ne convertit que ce qui ressemble à un tuyau.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /game === 'miniwave' && slotId === '0' && data\.indexOf\('\|'\) >= 0 && data\[0\] !== '\{'/,
    'le serveur laisse passer le JSON tel quel');
});

test('un compte neuf part de la fiche vierge et a le droit d\'enregistrer', async () => {
  const envois = [];
  const Pl = avecReseau((url, opt) => {
    if (url.indexOf('/api/loadFrutiSlots') === 0) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve('ok=1') });
    }
    envois.push(JSON.parse(opt.body));
    return Promise.resolve({ ok: true });
  });
  const p = new Pl.Plateforme('SIDNEUF');
  await p.charger();
  assert.equal(p.charge, true, 'une réponse vide est une fiche vierge, pas une panne');
  const r = await p.enregistrer({ mode: 'arcade', badsKill: { 2: 3 }, level: 0, score: 120, credits: 4 });
  assert.equal(r.enregistre, true);
  assert.equal(envois.length, 1);
  assert.equal(envois[0].game, 'miniwave');
  assert.equal(envois[0].slotId, '0');
  const relu = JSON.parse(envois[0].data);
  assert.equal(relu.$badsKill[2], 3);
  assert.equal(relu.$arcade.$bestLevel, 1);
  assert.equal(relu.$credit, 4);
});

test('un achat est enregistré tout de suite', async () => {
  const envois = [];
  const Pl = avecReseau((url, opt) => {
    if (url.indexOf('/api/loadFrutiSlots') === 0) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve('ok=1') });
    }
    envois.push(JSON.parse(opt.body));
    return Promise.resolve({ ok: true });
  });
  const p = new Pl.Plateforme('SIDACHAT');
  await p.charger();
  p.carte.$credit = 200;
  const r = await p.acheter(0);                  // Proto
  assert.equal(r.ok, true);
  assert.equal(r.enregistre, true, 'la fiche part aussitôt — un achat ne se perd pas');
  assert.equal(JSON.parse(envois[0].data).$ship[1], 1);
  assert.equal(JSON.parse(envois[0].data).$credit, 120);

  // Un achat refusé n'envoie rien.
  const avant = envois.length;
  const refus = await p.acheter(4);              // Rycher, 680
  assert.equal(refus.ok, false);
  assert.equal(envois.length, avant, 'rien n\'est envoyé pour un refus');
});

test('un chargement raté interdit d\'enregistrer — jamais de fiche neuve par-dessus une vraie', async () => {
  let sauvegardes = 0;
  const Pl = avecReseau((url) => {
    if (url.indexOf('/api/loadFrutiSlots') === 0) return Promise.resolve({ ok: false, status: 503 });
    sauvegardes++;
    return Promise.resolve({ ok: true });
  });
  const p = new Pl.Plateforme('SIDPANNE');
  await p.charger();
  assert.equal(p.charge, false, 'le serveur n\'a pas répondu : on ne sait pas quoi fusionner');
  const r = await p.enregistrer({ mode: 'arcade', badsKill: { 0: 500 }, level: 200 });
  assert.equal(r.enregistre, false);
  assert.equal(sauvegardes, 0, 'RIEN n\'est envoyé — c\'est tout l\'intérêt du verrou');
  // Le garde-fou du serveur ne suffirait pas ici : une fiche neuve fait la même
  // longueur qu'une fiche pleine (51 zéros au lieu de 51 nombres).
  const neuve = JSON.stringify(Pl.carteNeuve());
  const pleine = JSON.stringify(Pl.fusionner(Pl.carteNeuve(),
    { mode: 'arcade', badsKill: { 0: 500 }, level: 200 }));
  assert.ok(neuve.length > pleine.length * 0.5,
    'le seuil des 50 % du serveur ne rattraperait pas l\'écrasement');
});

test('sans session, on joue mais on n\'enregistre pas', async () => {
  let appels = 0;
  const Pl = avecReseau(() => { appels++; return Promise.resolve({ ok: true, text: () => Promise.resolve('') }); });
  const p = new Pl.Plateforme('');
  await p.charger();
  const r = await p.enregistrer({ mode: 'arcade', badsKill: { 1: 1 }, level: 0 });
  assert.equal(appels, 0, 'aucun appel réseau sans session');
  assert.equal(r.enregistre, false);
  assert.equal(r.carte.$badsKill[1], 1, 'la partie est quand même comptabilisée en mémoire');
});

// ── Le moteur et la fiche se parlent ───────────────────────────────────────

test('le jeu annonce la fin de partie avec de quoi remplir la fiche', () => {
  const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
  const niveaux = require(path.join(ROOT, 'public/miniwave/levels.json'));
  let fin = null;
  const g = new E.Game({
    levels: niveaux.main[0].levels, graine: 1,
    onEvent: (n, d) => { if (n === 'finPartie') fin = d; },
  });
  g.badsKill[5] = 7;
  g.finPartie('gameover');
  assert.ok(fin, 'la fin de partie est annoncée');
  assert.deepEqual(fin.badsKill, { 5: 7 }, 'le relevé des éliminations part avec');
  assert.equal(typeof fin.level, 'number');
  assert.equal(typeof fin.score, 'number');
  assert.equal(typeof fin.credits, 'number');
  // Et c'est bien une copie : le moteur peut repartir sans que la fiche déjà
  // enregistrée bouge dans le dos de la plateforme.
  g.badsKill[5] = 99;
  assert.equal(fin.badsKill[5], 7);
});

// ── Le pont côté serveur ───────────────────────────────────────────────────

test('le serveur regreffe ce que le tuyau ne transporte pas', () => {
  // Sans cette greffe : le joueur achète un vaisseau sur mobile, ouvre le jeu
  // Flash sur son ordinateur, et la première sauvegarde du SWF — un tuyau —
  // remplace la fiche riche par sa version amputée. Crédits envolés.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = src.indexOf('MiniWave forward-merge');
  assert.ok(i > 0, 'la greffe est bien dans server.js');
  const bloc = src.slice(i, i + 2600);
  for (const champ of ['$mode', '$letter', '$survival', '$bonus', '$credit', '$stats', '$lvl']) {
    assert.ok(bloc.includes(`'${champ}'`), `${champ} est regreffé`);
  }
  assert.ok(bloc.includes('$bestScore'), 'le meilleur score d\'arcade aussi');
  assert.ok(bloc.includes('$cons.$main') || bloc.includes('$main'), 'et le pourcentage d\'arcade');
  // Elle ne doit s'appliquer QUE sur une fiche venue du tuyau : sinon une vraie
  // sauvegarde JS se ferait écraser par l'état précédent.
  assert.ok(/venuDuTuyau\s*=\s*neuf\.\$credit === undefined && neuf\.\$mode === undefined/.test(bloc),
    'la greffe reconnaît une fiche amputée');
});

// ── L'accrochage à la page ─────────────────────────────────────────────────

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
