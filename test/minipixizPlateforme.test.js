// La fiche de Minipixiz : le pont avec Frutiparc, et la réparation des dégâts.
//
// server.js porte SEPT fonctions de rattrapage écrites uniquement pour ce jeu.
// Elles compensent des dégâts de Ruffle : Array.toString() qui rend "" sur les
// tableaux de l'album, le eval() de fromJSON qui rend null et fait repartir le
// jeu sur une fiche neuve, les fées réduites à des souches.
//
// Le portage supprime la CAUSE. Mais les fiches déjà abîmées sont en base, et
// c'est là que ces tests comptent : une fiche amputée doit être RÉPARÉE au
// chargement, pas propagée — et une fiche illisible ne doit surtout pas être
// remplacée par une neuve.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'public/minipixiz/plateforme.js'));

// Une Plateforme avec un `fetch` de comédie : c'est bien le fichier servi au
// joueur qui est exercé, pas une réécriture.
function avecReseau(fetchFactice) {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/plateforme.js'), 'utf8');
  const bac = { window: {}, fetch: fetchFactice, Promise, JSON, Number, Array, Object, String, Error, Math, Date };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(src, bac, { filename: 'plateforme.js' });
  return bac.window.MinipixizPlateforme;
}

// ── La fiche ──────────────────────────────────────────────────────────────

test('la fiche neuve est celle de formatFruticard', () => {
  const c = P.carteNeuve();
  assert.equal(c.$vs, 1.2, 'la version de Cm');
  assert.equal(c.$stat.$game.length, 5, 'cinq zones : forêt, bassin, château, arc-en-ciel, arbre');
  assert.equal(c.$stat.$kill.length, 5);
  assert.deepEqual(c.$god, [false, false, false]);
  assert.deepEqual(c.$dungeon, { $lvl: 0, $f: false, $day: 0, $loop: 0 });
  assert.deepEqual(c.$stat.$item, [], 'l\'album est vide');
  assert.equal(c.$checkpoint, 0);
  assert.equal(c.$bag, 0, 'pas de sac : les objets ne se gardent pas encore');
});

test('l\'horloge de la fiche neuve part de maintenant, à l\'heure qu\'il est', () => {
  // Cm.formatFruticard : $t = getTime(), $s = heure × 3 600 000. Sans ça,
  // Cm.updateTime calcule `maintenant - 0` et rattrape cinquante-six ans
  // d'entretien d'un coup ; et $s règle le jour et la nuit de la forêt.
  const t = Date.UTC(2024, 4, 17, 14, 30, 0);
  const c = P.carteNeuve(t);
  assert.equal(c.$time.$t, t, 'l\'horloge part de l\'instant donné');
  assert.equal(c.$time.$d, 0, 'aucun jour écoulé');
  assert.equal(c.$time.$s, new Date(t).getHours() * 3600000, 'et $s vaut l\'heure locale');

  const maintenant = P.carteNeuve();
  assert.ok(maintenant.$time.$t > 1.7e12, 'sans argument, c\'est vraiment maintenant');
});

test('une horloge à zéro est remise à l\'heure sans perdre les jours acquis', () => {
  const vieille = P.carteNeuve(0);
  vieille.$time.$t = 0;
  vieille.$time.$d = 42;
  const r = P.reparer(vieille);
  assert.ok(r.carte.$time.$t > 1.7e12, 'l\'horloge repart de maintenant');
  assert.equal(r.carte.$time.$d, 42, 'mais les quarante-deux jours restent');
  assert.ok(r.reparations.some((x) => /\$time/.test(x)), `dit : ${r.reparations.join(', ')}`);
});

// ── La réparation ─────────────────────────────────────────────────────────

test('une fiche saine traverse sans être touchée', () => {
  const saine = P.carteNeuve();
  saine.$stat.$run = 4200;
  saine.$stat.$item[12] = true;
  saine.$diam = 3;
  // On compare après un aller-retour JSON des DEUX côtés : c'est sous cette
  // forme que la fiche arrive du serveur, et un tableau à trous n'y survit pas
  // (les vides deviennent des nuls). Comparer l'un à l'autre ferait échouer un
  // test qui n'a rien à voir avec la réparation.
  const arrivee = JSON.parse(JSON.stringify(saine));
  const r = P.reparer(arrivee);
  assert.deepEqual(r.reparations, [], 'rien à réparer');
  assert.equal(JSON.stringify(r.carte), JSON.stringify(arrivee), 'et rien n\'a bougé');
});

test('les tableaux vidés par Ruffle sont reconstruits, pas devinés', () => {
  // Le dégât signé : Array.toString() rendait "" et $game/$kill revenaient
  // tronqués. Leur longueur est la signature — le serveur s'en sert aussi
  // (isMinipixizSlot0Corrupted).
  const abimee = P.carteNeuve();
  abimee.$stat.$run = 9000;                  // la progression, elle, a survécu
  abimee.$stat.$game = [];
  abimee.$stat.$kill = [];
  abimee.$stat.$item = '';                   // le tableau devenu chaîne vide
  abimee.$stat.$eat = '';
  const r = P.reparer(abimee);
  assert.equal(r.carte.$stat.$game.length, 5, '$game retrouve ses cinq cases');
  assert.equal(r.carte.$stat.$kill.length, 5);
  assert.deepEqual(r.carte.$stat.$item, [], '$item redevient un tableau');
  assert.deepEqual(r.carte.$stat.$eat, []);
  assert.equal(r.carte.$stat.$run, 9000, 'ce qui restait est gardé');
  assert.ok(r.reparations.length >= 4, `les réparations sont dites (${r.reparations.join(', ')})`);
  assert.ok(r.reparations.some((x) => /\$game/.test(x)));
});

test('une fiche amputée de ses sous-objets est complétée', () => {
  const r = P.reparer({ $stat: { $run: 100 } });
  assert.deepEqual(r.carte.$dungeon, { $lvl: 0, $f: false, $day: 0, $loop: 0 });
  assert.deepEqual(r.carte.$pond, { $fs: null, $d: 0, $q: null });
  assert.ok(Array.isArray(r.carte.$faerie));
  assert.ok(Array.isArray(r.carte.$inv));
  assert.equal(r.carte.$stat.$run, 100, 'et ce qu\'elle portait survit');
});

test('un sous-objet PARTIEL est complété sans écraser ce qu\'il porte', () => {
  // Le piège inverse : réparer trop fort. Un donjon à moitié décrit garde ses
  // valeurs, on ne remplit que les trous.
  const r = P.reparer({ $dungeon: { $lvl: 3, $f: true }, $stat: {} });
  assert.equal(r.carte.$dungeon.$lvl, 3, 'le niveau atteint est gardé');
  assert.equal(r.carte.$dungeon.$f, true);
  assert.equal(r.carte.$dungeon.$day, 0, 'et le reste complété');
  assert.equal(r.carte.$dungeon.$loop, 0);
});

test('les champs inconnus sont recopiés tels quels', () => {
  // Une fiche peut porter des champs des modes non encore portés. Les perdre
  // serait pire que le dégât qu'on répare.
  const r = P.reparer({ $stat: {}, $unChampInconnu: { a: 1 }, $autre: [1, 2, 3] });
  assert.deepEqual(r.carte.$unChampInconnu, { a: 1 }, 'préservé');
  assert.deepEqual(r.carte.$autre, [1, 2, 3]);
});

test('les fées ne sont pas touchées par la réparation', () => {
  // mergeFaerieByIdentity côté serveur s'en occupe déjà, et une fée est un
  // objet riche. On la recopie intacte plutôt que de la « normaliser ».
  const fee = { $name: 'Lila', $level: 4, $spells: [1, 2], $carac: { $f: 3 } };
  const r = P.reparer({ $faerie: [fee], $stat: {} });
  assert.deepEqual(r.carte.$faerie, [fee], 'la fée traverse intacte');
});

test('rien n\'est réparé sur une fiche absente — c\'est un compte neuf', () => {
  const r = P.reparer(null);
  assert.deepEqual(r.reparations, [], 'un compte neuf n\'a rien d\'abîmé');
  assert.deepEqual(r.carte, P.carteNeuve());
});

test('la santé d\'une fiche se juge comme le serveur la juge', () => {
  assert.equal(P.porteUneProgression(P.carteNeuve()), false, 'une fiche neuve ne porte rien');
  const avecRun = P.carteNeuve(); avecRun.$stat.$run = 1;
  assert.equal(P.porteUneProgression(avecRun), true);
  const avecObjet = P.carteNeuve(); avecObjet.$stat.$item[5] = true;
  assert.equal(P.porteUneProgression(avecObjet), true);
  const avecFee = P.carteNeuve(); avecFee.$faerie.push({ $level: 1 });
  assert.equal(P.porteUneProgression(avecFee), true);
  // Et c'est bien la règle du serveur.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = src.indexOf('function isMinipixizSlotHealthy');
  const bloc = src.slice(i, i + 900);
  for (const champ of ['$run', '$item', '$eat', '$faerie', '$diam', '$star', '$key']) {
    assert.ok(bloc.includes(champ), `le serveur regarde ${champ} lui aussi`);
  }
});

// ── La course en forêt ────────────────────────────────────────────────────

test('une course additionne le CARRÉ de chaque niveau franchi', () => {
  // base/Forest : setWin fait `level += 1` AVANT endGame, qui fait
  // `$stat.$run += level²`. Terminer le niveau n rapporte donc (n+1)², pas n².
  // Le premier niveau, numéroté zéro, ne rapporterait sinon rien du tout.
  const c = P.fusionner(P.carteNeuve(), { niveaux: [0, 1, 2, 3], dernier: 4 });
  assert.equal(c.$stat.$run, 1 + 4 + 9 + 16, 'la somme des carrés, décalée d\'un');
  const un = P.fusionner(P.carteNeuve(), { niveaux: [0], dernier: 1 });
  assert.equal(un.$stat.$run, 1, 'le tout premier niveau rapporte un, pas zéro');
  assert.ok(c.$stat.$run > un.$stat.$run * 4, 'une longue course paie bien plus');
});

test('le meilleur niveau de forêt ne redescend jamais', () => {
  let c = P.fusionner(P.carteNeuve(), { niveaux: [0, 1, 2], dernier: 3 });
  assert.equal(c.$stat.$forestMax, 4, 'base/Forest.kill : level + 1');
  c = P.fusionner(c, { niveaux: [], dernier: 0 });
  assert.equal(c.$stat.$forestMax, 4, 'une course ratée ne l\'abaisse pas');
});

test('les objets ramassés entrent à l\'album', () => {
  const c = P.fusionner(P.carteNeuve(), { niveaux: [0], dernier: 1, objets: [7, 12, 7] });
  assert.equal(c.$stat.$item[7], true);
  assert.equal(c.$stat.$item[12], true);
  assert.equal(P.nouveauxPictos(P.carteNeuve(), c).length, 2, 'deux objets, deux pictos');
  // Ce que le serveur en fera.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /if \(items\[id\] && GAME_ITEM_INFO\[`\$pixiz_item\$\{id\}`\]\)/,
    'le serveur accorde le picto de l\'objet');
});

test('la clé de donjon et les aliments ne passent pas par l\'album des objets', () => {
  // L'objet 31 est la clé de donjon, que l'album ne montre pas ; au-delà de 300
  // ce sont les aliments, qui ont leur propre compteur ($eat).
  const c = P.fusionner(P.carteNeuve(), { niveaux: [], dernier: 0, objets: [31, 305, 9] });
  assert.equal(c.$stat.$item[31], undefined, 'la clé reste hors album');
  assert.equal(c.$stat.$item[305], undefined, 'les aliments aussi');
  assert.equal(c.$stat.$item[9], true, 'mais l\'objet ordinaire y entre');
});

test('les relais se prennent un par un, au relais SUIVANT', () => {
  // base/Forest.endGame :
  //     if( level == (Cm.card.$checkpoint+1)*20 ) Cm.card.$checkpoint += 1
  // Le relais ne se gagne donc ni avant, ni deux d'un coup, ni en refaisant un
  // passage déjà connu.
  let c = P.fusionner(P.carteNeuve(), { niveaux: [], dernier: 19 });
  assert.equal(c.$checkpoint, 0, 'dix-neuf niveaux ne suffisent pas');
  c = P.fusionner(c, { niveaux: [], dernier: 20 });
  assert.equal(c.$checkpoint, 1, 'le vingtième franchi ouvre le premier relais');
  c = P.fusionner(c, { niveaux: [], dernier: 40 });
  assert.equal(c.$checkpoint, 2, 'puis le deuxième');
  c = P.fusionner(c, { niveaux: [], dernier: 20 });
  assert.equal(c.$checkpoint, 2, 'refaire un passage connu n\'en donne pas');
  c = P.fusionner(c, { niveaux: [], dernier: 5 });
  assert.equal(c.$checkpoint, 2, 'et une course ratée ne les reprend pas');
});

test('sauter des relais est impossible : on n\'en gagne qu\'un par course', () => {
  // Un seul saut, même en arrivant très loin — le jeu compare à l'ÉGAL, pas au
  // supérieur. C'est aussi ce qui garantit qu'une fiche gonflée ne s'ouvre pas
  // toute la forêt d'un coup.
  const c = P.fusionner(P.carteNeuve(), { niveaux: [], dernier: 100 });
  assert.equal(c.$checkpoint, 0, 'cent niveaux d\'un coup n\'ouvrent rien');
});

test('une course s\'arrête au relais suivant, pas à l\'infini', () => {
  assert.equal(P.finDeCourse(0), 20, 'partie de zéro, elle finit à vingt');
  assert.equal(P.finDeCourse(19), 20);
  assert.equal(P.finDeCourse(20), 40, 'partie du premier relais, elle finit à quarante');
  assert.equal(P.finDeCourse(41), 60);
});

test('la carte de la forêt nomme ses relais', () => {
  const p = new P.Plateforme('');
  p.carte.$checkpoint = 2;
  const carte = p.carteDesRelais();
  assert.equal(carte.length, 3, 'trois passages connus');
  assert.deepEqual(carte[0], { index: 0, niveau: 0, affiche: 1, nom: P.RELAIS[0], fin: 20 });
  assert.deepEqual(carte[2], { index: 2, niveau: 40, affiche: 41, nom: P.RELAIS[2], fin: 60 });
  // Au-delà des sept noms du jeu d'origine, on ne laisse pas de trou.
  p.carte.$checkpoint = 8;
  const loin = p.carteDesRelais();
  assert.equal(loin.length, 9);
  assert.ok(loin[8].nom.length > 0, 'le neuvième a quand même un nom');
});

test('les départs proposés sont les relais acquis', () => {
  const p = new P.Plateforme('');
  assert.deepEqual(p.departs(), [0], 'au début, seule la forêt');
  p.carte.$checkpoint = 3;
  assert.deepEqual(p.departs(), [0, 20, 40, 60], 'puis un par relais');
});

test('les entrées en forêt sont comptées', () => {
  let c = P.fusionner(P.carteNeuve(), { niveaux: [0], dernier: 1, entree: true });
  assert.equal(c.$stat.$game[0], 1);
  c = P.fusionner(c, { niveaux: [0], dernier: 1, entree: true });
  assert.equal(c.$stat.$game[0], 2);
  c = P.fusionner(c, { niveaux: [0], dernier: 1 });
  assert.equal(c.$stat.$game[0], 2, 'sans `entree`, on ne recompte pas');
});

test('la fusion ne modifie pas la fiche d\'entrée', () => {
  const c = P.carteNeuve();
  P.fusionner(c, { niveaux: [0, 1, 2], dernier: 5, objets: [3] });
  assert.equal(c.$stat.$run, 0);
  assert.equal(c.$stat.$forestMax, 0);
  assert.equal(c.$stat.$item[3], undefined);
});

// ── Le réseau ─────────────────────────────────────────────────────────────

test('le chargement lit et répare la fiche du serveur', async () => {
  const abimee = P.carteNeuve();
  abimee.$stat.$run = 5000;
  abimee.$stat.$game = [];                    // le dégât
  let vue = '';
  const Pl = avecReseau((url) => {
    vue = url;
    return Promise.resolve({
      ok: true, text: () => Promise.resolve('ok=1&slot0=' + encodeURIComponent(JSON.stringify(abimee))),
    });
  });
  const p = new Pl.Plateforme('SID1');
  const c = await p.charger();
  assert.match(vue, /^\/api\/loadFrutiSlots\?sid=SID1&game=minipixiz$/);
  assert.equal(p.charge, true);
  assert.equal(c.$stat.$run, 5000, 'la progression est là');
  assert.equal(c.$stat.$game.length, 5, 'et le dégât réparé');
  assert.ok(p.reparations.length > 0, 'la réparation est signalée');
});

test('une fiche ILLISIBLE suspend l\'enregistrement au lieu de l\'écraser', async () => {
  // Le dégât le plus grave : la fiche existe mais ne se relit pas. La remplacer
  // par une neuve n'émettrait aucune erreur — elle effacerait des mois de jeu.
  let sauvegardes = 0;
  const Pl = avecReseau((url) => {
    if (url.indexOf('/api/loadFrutiSlots') === 0) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve('ok=1&slot0=%7Bcass') });
    }
    sauvegardes++;
    return Promise.resolve({ ok: true });
  });
  const p = new Pl.Plateforme('SIDCASSE');
  await p.charger();
  assert.equal(p.charge, false, 'on ne se croit pas chargé');
  assert.match(p.reparations[0], /illisible/, 'et on dit pourquoi');
  const r = await p.enregistrer({ niveaux: [0, 1], dernier: 2, objets: [4] });
  assert.equal(r.enregistre, false);
  assert.equal(sauvegardes, 0, 'RIEN n\'est envoyé');
});

test('un chargement raté interdit d\'enregistrer', async () => {
  let sauvegardes = 0;
  const Pl = avecReseau((url) => {
    if (url.indexOf('/api/loadFrutiSlots') === 0) return Promise.resolve({ ok: false, status: 503 });
    sauvegardes++;
    return Promise.resolve({ ok: true });
  });
  const p = new Pl.Plateforme('SIDPANNE');
  await p.charger();
  assert.equal(p.charge, false);
  assert.equal((await p.enregistrer({ niveaux: [], dernier: 0 })).enregistre, false);
  assert.equal(sauvegardes, 0);
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
  assert.equal(p.charge, true, 'une réponse vide est un compte neuf, pas une panne');
  const r = await p.enregistrer({ niveaux: [0, 1, 2], dernier: 3, objets: [7], entree: true });
  assert.equal(r.enregistre, true);
  assert.equal(envois[0].game, 'minipixiz');
  assert.equal(envois[0].slotId, '0');
  const relu = JSON.parse(envois[0].data);
  assert.equal(relu.$stat.$run, 1 + 4 + 9);
  assert.equal(relu.$stat.$forestMax, 4);
  assert.equal(relu.$stat.$item[7], true);
});

test('la sauvegarde part en JSON, que le serveur range tel quel', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // La conversion tuyau→JSON ne se déclenche que sur une chaîne à barres.
  assert.match(src, /\(game === 'minipixiz' \|\| game === 'minitroll'\) && slotId === '0' && data\.indexOf\('\|'\) >= 0 && data\[0\] !== '\{'/,
    'le JSON passe sans conversion');
  const c = P.carteNeuve();
  assert.equal(JSON.stringify(c)[0], '{', 'et la fiche est bien du JSON');
});

test('une fiche pleine ne ressemble pas à une fiche neuve', () => {
  // Le garde-fou looksLikeMinipixizDefault BLOQUE une sauvegarde qui ressemble
  // aux valeurs par défaut quand la base porte une vraie progression. Une
  // course jouée doit donc en sortir — sinon elle serait silencieusement
  // refusée, et le joueur ne verrait jamais son avancement.
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = src.indexOf('function looksLikeMinipixizDefault');
  const bloc = src.slice(i, i + 800);
  const defaut = (c) => {
    const s = c.$stat || {};
    return (!s.$run || s.$run === 0)
      && (!Array.isArray(s.$item) || s.$item.every((v) => !v))
      && (!Array.isArray(s.$eat) || s.$eat.every((v) => !v))
      && (!Array.isArray(c.$faerie) || c.$faerie.length === 0)
      && !c.$diam && !c.$star && (!c.$dungeon || !c.$dungeon.$lvl);
  };
  assert.ok(bloc.includes('runZero'), 'la règle du serveur est bien celle-là');
  assert.equal(defaut(P.carteNeuve()), true, 'une fiche neuve ressemble aux défauts');
  const jouee = P.fusionner(P.carteNeuve(), { niveaux: [0, 1, 2, 3], dernier: 4 });
  assert.equal(defaut(jouee), false,
    'une course jouée ne leur ressemble plus — elle passera le garde-fou');
});

// ── Le moteur et la fiche se parlent ──────────────────────────────────────

test('le moteur annonce les objets ramassés, et la fin les emporte', () => {
  const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
  const j = new E.Jeu({ graine: 1, grille: null });
  // Un objet enterré sous un groupe de quatre : le détruire le dégage.
  new E.Objet(j, { px: 3, py: 16, type: 7 }).poser();
  for (const x of [4, 5, 6]) new E.Pierre(j, { px: x, py: 16, life: 9 }).poser();
  for (const x of [3, 4, 5, 6]) new E.Jeton(j, { px: x, py: 15, type: 0 }).poser();

  const vus = [];
  j.onEvent = (n, d) => { if (n === 'objet') vus.push(d.type); };
  j.flActiviteAFaire = true;
  j.initStatsChute();
  j.initStep(E.ETAPE.CHUTE);
  for (let i = 0; i < 400 && j.step !== E.ETAPE.JEU && !j.termine; i++) j.update(1);

  assert.deepEqual(vus, [7], 'l\'objet dégagé est ramassé');
  assert.deepEqual(j.objets, [7], 'et la partie en tient la liste');

  // Cette liste est exactement ce que la plateforme attend.
  const c = P.fusionner(P.carteNeuve(), { niveaux: [0], dernier: 1, objets: j.objets });
  assert.equal(c.$stat.$item[7], true);
});

test('un objet enterré ne se ramasse pas', () => {
  const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
  const j = new E.Jeu({ graine: 1, grille: null });
  new E.Objet(j, { px: 3, py: 16, type: 7 }).poser();
  new E.Pierre(j, { px: 3, py: 15, life: 9 }).poser();
  j.flActiviteAFaire = true;
  j.ramasserObjets();
  assert.deepEqual(j.objets, [], 'il faut le déterrer d\'abord');
});

// ── Ramasser, comme Base.grab ─────────────────────────────────────────────
//
// Un objet ramassé ne fait pas qu'entrer à l'album : la clé monte le trousseau,
// le sac agrandit l'inventaire, et tout le reste cherche une place. Sans sac il
// n'y en a aucune — et c'est précisément pour ça que le tirage ne fait tomber
// que des sacs tant qu'on n'en a pas.

test('la clé du donjon monte le trousseau et ne prend pas de place', () => {
  const c = P.carteNeuve();
  c.$bag = 1;
  assert.equal(P.ramasser(c, 31), 'cle');
  assert.equal(c.$key, 1);
  assert.deepEqual(c.$inv, [], 'elle ne va pas dans l\'inventaire');
  assert.equal(c.$stat.$item[31], undefined, 'ni à l\'album — Cm.getItem l\'exclut');
  for (let i = 0; i < 20; i++) P.ramasser(c, 31);
  assert.equal(c.$key, 9, 'Cm.incKey borne le trousseau à neuf');
});

test('le sac remplace le précédent et ouvre des places', () => {
  const c = P.carteNeuve();
  assert.equal(P.fiche(c).sac, 0, 'on commence sans rien');
  assert.equal(P.ramasser(c, 300), 'perdu', 'et sans sac, rien ne tient');

  assert.equal(P.ramasser(c, 80), 'sac');
  assert.equal(c.$bag, 1, 'Cm.getNewBag(id+1)');
  assert.equal(P.PLACES_SAC[c.$bag], 4, 'quatre places');
  assert.equal(c.$stat.$item[80], true, 'le sac entre à l\'album');

  for (let i = 0; i < 4; i++) assert.equal(P.ramasser(c, 300 + i * 3), 'inventaire');
  assert.equal(P.ramasser(c, 312), 'perdu', 'la cinquième n\'a plus de place');

  assert.equal(P.ramasser(c, 82), 'sac');
  assert.equal(c.$bag, 3);
  assert.equal(P.ramasser(c, 312), 'inventaire', 'le grand sac fait de la place');
});

test('une place libérée au milieu se reprend en premier', () => {
  const c = P.carteNeuve();
  c.$bag = 1;
  for (const id of [300, 303, 306, 309]) P.ramasser(c, id);
  c.$inv[1] = null;                                   // la fée a mangé
  assert.equal(P.ramasser(c, 70), 'inventaire');
  assert.deepEqual(c.$inv, [300, 70, 306, 309], 'la première place libre, pas la fin');
});

test('les flasques se comptent aussi chez les fées', () => {
  const c = P.carteNeuve();
  c.$bag = 2;
  c.$inv = [30, 70, 30];
  c.$faerie = [{ $name: 'Lila', $inv: [30, 300] }, { $name: 'Bleu', $inv: [] }];
  assert.deepEqual(P.fiche(c), { sac: 2, flasques: 3 },
    'Item.scanInventory additionne les deux inventaires');
});

test('la course applique les ramassages dans l\'ordre', () => {
  // Un sac, puis quatre aliments, puis un cinquième : le dernier est perdu —
  // et il ne serait PAS perdu si le sac avait été appliqué après coup.
  const c = P.fusionner(P.carteNeuve(),
    { niveaux: [0, 1], dernier: 2, objets: [80, 300, 303, 306, 309, 70] });
  assert.equal(c.$bag, 1);
  assert.deepEqual(c.$inv, [300, 303, 306, 309], 'quatre places, quatre aliments');
  assert.equal(c.$stat.$item[70], true, 'le sixième est perdu de l\'inventaire, pas de l\'album');
});

test('l\'album ignore la clé et les aliments, comme Cm.getItem', () => {
  const c = P.fusionner(P.carteNeuve(), { dernier: 0, objets: [31, 7, 300] });
  assert.equal(c.$stat.$item[31], undefined);
  assert.equal(c.$stat.$item[300], undefined, 'les aliments ont leur propre compteur');
  assert.equal(c.$stat.$item[7], true);
});

test('le moteur reçoit la fiche pour tirer ses objets', () => {
  const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
  const c = P.carteNeuve();
  const tirages = new Set();
  let n = 0;
  const hasard = (m) => (n++ * 7919) % m;             // déterministe, sans hasard réel
  for (let i = 0; i < 300; i++) tirages.add(E.tirerObjet(30, hasard, P.fiche(c)));
  assert.deepEqual([...tirages].filter((v) => v !== null), [80],
    'sans sac, il ne tombe qu\'un sac — ou rien');

  P.ramasser(c, 80);
  n = 0;
  const apres = new Set();
  for (let i = 0; i < 300; i++) apres.add(E.tirerObjet(30, hasard, P.fiche(c)));
  assert.equal(apres.has(null), false, 'avec un sac, le tirage donne toujours quelque chose');
  assert.ok(apres.size > 1, 'le sac ouvre la pioche (' + apres.size + ' résultats distincts)');
});

// ── L'accrochage à la page ────────────────────────────────────────────────

test('la page enchaîne les niveaux et n\'enregistre qu\'à la fin de la course', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /src="\/minipixiz\/plateforme\.js"/, 'le module est chargé');
  assert.match(html, /new P\.Plateforme\(sid\)/, 'construit avec la session');
  assert.match(html, /plateforme\.charger\(\)/, 'la fiche est lue au démarrage');
  // Une course est une SUITE : gagner enchaîne, perdre enregistre.
  assert.match(html, /if \(info\.gagne\)/, 'un niveau gagné enchaîne');
  assert.match(html, /setTimeout\(lancerNiveau/, 'sur le suivant');
  assert.match(html, /plateforme\.enregistrer\(\{\s*niveaux: course\.niveaux/,
    'et seule la fin de course enregistre');
  assert.match(html, /course\.objets\.push\(info\.type\)/, 'les objets sont collectés en route');
  // Base.grab agit tout de suite : le sac ramassé change le niveau SUIVANT.
  assert.match(html, /P\.ramasser\(course\.carte, info\.type\)/,
    'le ramassage s\'applique pendant la course');
  assert.match(html, /fiche: P\.fiche\(course\.carte\)/,
    'et le niveau suivant tire selon ce qu\'on porte');
  // base/Forest.endGame ferme la partie au relais suivant : pas de course infinie.
  assert.match(html, /fin: P\.finDeCourse\(depart \|\| 0\)/, 'la course a une fin');
  assert.match(html, /if \(course\.niveau < course\.fin\)/, 'et elle s\'y arrête');
  // Et la carte de la forêt, dès qu'un relais est acquis.
  assert.match(html, /plateforme\.carteDesRelais\(\)/, 'la carte liste les relais');
  assert.match(html, /id="carte"/, 'et la page a de quoi l\'afficher');
});
