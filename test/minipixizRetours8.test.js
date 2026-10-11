/*
 * Le huitième lot de retours MiniPixiz : le cinquième donjon.
 *
 *   · « Aux dernières nouvelles, le bug du cinquième donjon n'a toujours pas
 *     été résolu et le finir ne donne rien (pas de pictos). »
 *
 * Le défaut est dans le fichier d'origine, et le portage l'avait recopié
 * fidèlement. Cm.winDungeon (Games/miniTroll/src/Cm.mt, l. 481-505) :
 *
 *     if(card.$dungeon.$lvl==4 ){ … card.$dungeon.$loop++; }               (1)
 *     if(card.$dungeon.$loop==0){ giveItem("$diam_"+card.$dungeon.$lvl); }   (2)
 *     card.$dungeon.$lvl = (card.$dungeon.$lvl+1)%5;                          (3)
 *     card.$diam = int(Math.max(card.$diam,card.$dungeon.$lvl))               (4)
 *
 * Au rang 4, (1) incrémente la boucle AVANT que (2) ne la teste : le
 * cinquième donjon ne donne jamais $diam_4. Puis (3) ramène le rang à zéro et
 * (4) laisse $diam à quatre : la cinquième alvéole de la rangée des diamants
 * (Inventory.initExtraDisplay en dessine cinq) reste vide à jamais. Et comme
 * le serveur dérive les pictos de la fiche — $dungeon et $diam —, rien ne
 * tombe non plus de ce côté-là.
 *
 * Désormais le rang joué et le tour en cours sont lus AVANT de tourner, et
 * $diam compte les rangs vaincus. Les rangs 0 à 3 ne changent pas.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const X = require(path.join(ROOT, 'public/minipixiz/lieux.js'));
const P = require(path.join(ROOT, 'public/minipixiz/plateforme.js'));
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));

function tirage(g) {
  let s = g;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// Une fiche au rang voulu, le donjon bâti, et autant de diamants que de rangs
// déjà vaincus — l'état exact d'un joueur qui entre dans son n-ième donjon.
function carte(rang, o) {
  const opts = o || {};
  const c = P.carteNeuve(1700000000000);
  const fs = F.genererGraine(tirage(3));
  fs.$carac = [3, 3, 3, 3, 3, 4];
  fs.$life = 3; fs.$mana = 8; fs.$pos = 0;
  c.$faerie.push(fs);
  c.$current = 0;
  c.$key = 3;
  c.$bag = 2;
  c.$dungeon.$lvl = rang;
  c.$dungeon.$f = true;
  c.$dungeon.$loop = opts.loop || 0;
  c.$diam = opts.diam === undefined ? rang : opts.diam;
  return { c, fs };
}

// Vider la grille et clore le tour : c'est ainsi qu'on gagne un niveau.
function viderEtFinirLeTour(lieu) {
  lieu.jeu.eList.slice().forEach((e) => e.tuer());
  lieu.jeu.nouveauTour();
}

// Traverser le donjon de bout en bout, et rapporter ce qu'il a annoncé.
function vaincre(c, fs, graine) {
  const gains = [];
  const d = new X.Donjon({
    carte: c, fee: fs, graine: graine || 7,
    surEvenement: (n, o) => { if (n === 'donjonGagne') gains.push(o); },
  });
  while (!d.fini) viderEtFinirLeTour(d);
  assert.equal(d.gagne, true, 'le donjon est vaincu');
  assert.equal(gains.length, 1, 'une seule annonce donjonGagne');
  return gains[0];
}

test('chaque rang du donjon, vaincu au premier tour, rapporte son diamant — le cinquième compris', () => {
  for (let rang = 0; rang < 5; rang++) {
    const { c, fs } = carte(rang);
    const g = vaincre(c, fs, 7 + rang);
    assert.equal(g.diamant, rang, `rang ${rang} : le diamant du rang joué`);
    assert.equal(c.$diam, rang + 1, `rang ${rang} : ${rang + 1} diamant(s) dans la rangée`);
    assert.equal(c.$dungeon.$lvl, (rang + 1) % 5, `rang ${rang} : le rang suivant`);
    assert.equal(c.$dungeon.$f, false, `rang ${rang} : le donjon disparaît du menu`);
    assert.equal(c.$dungeon.$loop, rang === 4 ? 1 : 0, `rang ${rang} : la boucle`);
    assert.equal(g.ornegon, rang === 2, `rang ${rang} : Ornegon au deuxième rang seulement`);
    assert.equal(c.$frog, rang === 2);
    assert.equal(g.arcEnCiel, rang === 4, `rang ${rang} : l'arc-en-ciel au cinquième seulement`);
    assert.equal(c.$rainbow.$f, rang === 4);
  }
});

test('le cinquième donjon : cinq diamants, et c\'est le cinquième qui tombe à l\'écran', () => {
  const { c, fs } = carte(4);
  assert.equal(c.$diam, 4, 'quatre diamants à l\'entrée');
  const g = vaincre(c, fs);
  assert.equal(g.diamant, 4, 'le diamant du rang 4');
  assert.equal(c.$diam, 5, 'la rangée est pleine');
  // Dungeon.initStep(21) : `diam.skin.gotoAndStop(string(difficulty+1))` — la
  // scène du client prend la teinte `diamant + 1`, bornée aux cinq du clip.
  const js = lire('public/minipixiz/game.js');
  assert.match(js, /rendre\(s\.invDiamant, Math\.min\(5, Math\.max\(1, c\.diamant \+ 1\)\)/);
  // Et la clairière le dit : « 5 sur 5 ».
  const page = lire('public/minipixiz/index.html');
  assert.match(page, /un diamant de plus dans le sac \('\s*\+ \(Number\(g\.diamant\) \+ 1\) \+ ' sur 5\)/);
  // L'inventaire dessine cinq alvéoles, remplies tant que $diam > i.
  const inv = lire('public/minipixiz/inventaire.js');
  assert.match(inv, /diamants: 5 \}/);
  assert.match(inv, /if \(nombre\(c\.\$diam\) > i\) dedans\('invDiamant', i \+ 1,/);
});

test('au deuxième tour, plus de diamant — mais la rangée reste pleine', () => {
  const { c, fs } = carte(4, { loop: 1, diam: 5 });
  c.$rainbow.$day = 3;                       // l'arc-en-ciel a déjà été vu
  const g = vaincre(c, fs);
  assert.equal(g.diamant, null, 'Cm.winDungeon : `if($loop==0)` seulement');
  assert.equal(g.arcEnCiel, false, 'un arc-en-ciel ne se gagne qu\'une fois');
  assert.equal(c.$diam, 5);
  assert.equal(c.$dungeon.$loop, 2);
  assert.equal(c.$dungeon.$lvl, 0);
});

test('le tour et le rang sont lus avant de tourner', () => {
  // La garantie de source : le défaut d'origine, c'est `$loop++` avant le
  // test `$loop==0`. On fige les deux AVANT la première écriture.
  const src = lire('public/minipixiz/lieux.js');
  const corps = src.slice(src.indexOf('  gagnerLeDonjon() {'), src.indexOf("this.evenement('donjonGagne'"));
  const iRang = corps.indexOf('const rang = nombre(d.$lvl);');
  const iTour = corps.indexOf('const premierTour = nombre(d.$loop) === 0;');
  const iLoop = corps.indexOf('d.$loop = nombre(d.$loop) + 1;');
  const iDiam = corps.indexOf('if (premierTour) gains.diamant = rang;');
  assert.ok(iRang >= 0 && iTour >= 0 && iLoop >= 0 && iDiam >= 0, 'les quatre lignes existent');
  assert.ok(iTour < iLoop, 'le tour est lu avant que la boucle ne monte');
  assert.ok(iRang < iLoop, 'le rang aussi');
  assert.match(corps, /c\.\$diam = Math\.max\(nombre\(c\.\$diam\), rang \+ 1\);/, '$diam compte les rangs vaincus');
});

test('la fiche part au serveur avec ses cinq diamants et sa boucle', async () => {
  // Le chemin complet de la page : ouvrirLieu → donjonGagne → plateforme.ecrire
  // → POST /api/saveFrutiSlot. Le serveur dérive les pictos de CETTE fiche
  // (extractGameItemsFromSlot : $dungeon.$loop > 0 → les cinq diamants, et
  // il garde le plus grand $diam). On capture l'envoi.
  const p = new P.Plateforme('sid-test');
  p.charge = true;
  const { c, fs } = carte(4);
  p.carte = c;
  const avant = JSON.parse(JSON.stringify(c));
  vaincre(c, fs);

  const envois = [];
  const vraiFetch = globalThis.fetch;
  globalThis.fetch = (url, opt) => { envois.push({ url, opt }); return Promise.resolve({ ok: true }); };
  try {
    const r = await p.ecrire(avant);
    assert.equal(r.enregistre, true);
  } finally {
    globalThis.fetch = vraiFetch;
  }
  assert.equal(envois.length, 1, 'un seul envoi, réussi du premier coup');
  assert.equal(envois[0].url, '/api/saveFrutiSlot');
  const corps = JSON.parse(envois[0].opt.body);
  assert.equal(corps.game, 'minipixiz');
  assert.equal(corps.slotId, '0');
  const fiche = JSON.parse(corps.data);
  assert.equal(fiche.$diam, 5, 'cinq diamants');
  assert.deepEqual(
    { lvl: fiche.$dungeon.$lvl, f: fiche.$dungeon.$f, loop: fiche.$dungeon.$loop },
    { lvl: 0, f: false, loop: 1 },
    'la boucle est faite, le rang repart à zéro',
  );
});

test('une fiche d\'avant le correctif retrouve son cinquième diamant au chargement', async () => {
  // Le joueur qui avait déjà vaincu le cinquième donjon : $loop à 1, et
  // pourtant quatre diamants. C'est la signature du défaut d'origine — pas un
  // dégât, `reparer` n'y touche pas ; c'est rendreLeCinquiemeDiamant qui le
  // rattrape, au chargement.
  const maintenant = Date.now();
  const vieille = P.carteNeuve(maintenant);
  vieille.$dungeon = { $lvl: 0, $f: false, $day: 12, $loop: 1 };
  vieille.$diam = 4;
  vieille.$stat.$run = 200000;

  const c = JSON.parse(JSON.stringify(vieille));
  assert.equal(P.rendreLeCinquiemeDiamant(c), true, 'la fiche change');
  assert.equal(c.$diam, 5, 'l\'alvéole manquante est rendue');
  assert.equal(c.$dungeon.$loop, 1, 'sans toucher à la boucle');
  assert.equal(P.rendreLeCinquiemeDiamant(c), false, 'et une seule fois');

  // Une fiche en cours de premier tour n'est pas touchée.
  const enCours = P.carteNeuve(maintenant);
  enCours.$dungeon = { $lvl: 3, $f: true, $day: 12, $loop: 0 };
  enCours.$diam = 3;
  assert.equal(P.rendreLeCinquiemeDiamant(enCours), false);
  assert.equal(enCours.$diam, 3);

  // Ni la fiche neuve, ni une fiche sans $dungeon.
  const neuve = P.carteNeuve(maintenant);
  assert.equal(P.rendreLeCinquiemeDiamant(neuve), false);
  assert.equal(neuve.$diam, 0);
  assert.equal(P.rendreLeCinquiemeDiamant({ $diam: 4 }), false);

  // Le vrai chemin : Plateforme.charger relit /api/loadFrutiSlots (LoadVars),
  // répare, puis rend le diamant — avant que les nuits n'écrivent la fiche.
  const texte = 'slot0=' + encodeURIComponent(JSON.stringify(vieille)) + '&slot1=';
  const vraiFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve(texte) });
  try {
    const p = new P.Plateforme('sid-test');
    const carte = await p.charger();
    assert.equal(p.charge, true);
    assert.equal(carte.$diam, 5, 'au chargement, cinq diamants');
    assert.equal(carte.$dungeon.$loop, 1);
    assert.deepEqual(p.reparations, [], 'et ce n\'est pas compté comme un dégât');
  } finally {
    globalThis.fetch = vraiFetch;
  }
});
