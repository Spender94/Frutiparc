'use strict';
/*
 * JAMAJAMA — CE QUE L'ÉCRAN MONTRE, ET À QUELLE ALLURE.
 *
 * Les retours d'un joueur, un par un :
 *  1) le mur mangé par Louki restait affiché ;
 *  2) une caisse poussée à l'eau laissait voir l'eau nue ;
 *  3) un pont détruit s'affichait intact ;
 *  4) le fantôme (et le héros endormi) n'apparaissait qu'au coup suivant ;
 *  5) Kohl possédé restait un point noir ;
 *  et le personnage qui file de dix cases sur un effleurement de touche,
 *  et Winkle qui meurt dans l'explosion des bombes de la Grotte 14.
 *
 * Le moteur (regles.js), le rendu (rendu.js, son manifeste réel) et la vue
 * (vue.js) tournent ici dans un bac à sable, sur des plateaux minuscules
 * construits pour l'occasion.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.join(__dirname, '..');
const R = require(path.join(RACINE, 'public/jamajama/regles.js'));
const { Element: E, Replay } = R;
const MANIFESTE = JSON.parse(fs.readFileSync(path.join(RACINE, 'public/jamajama/sprites/sprites.json'), 'utf8'));

let bac = null;
function chargerBac() {
  if (bac) return bac;
  const noop = () => {};
  const element = () => ({ textContent: '', appendChild: noop, addEventListener: noop, getContext: () => null, width: 0, height: 0 });
  const ctx = {
    console,
    document: { createElement: element, head: { appendChild: noop }, fonts: { load: () => Promise.resolve() } },
    Image: function () { const img = { set src(v) { setTimeout(() => img.onload && img.onload(), 0); } }; return img; },
    fetch: (url) => Promise.resolve({ json: () => Promise.resolve(url.endsWith('sprites.json') ? MANIFESTE : {}) }),
    encodeURIComponent, setTimeout, Promise, Map, Set, Object, Math, Number, String, Array, JSON,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['regles.js', 'rendu.js', 'vue.js']) {
    vm.runInContext(fs.readFileSync(path.join(RACINE, 'public/jamajama', f), 'utf8'), ctx, { filename: f });
  }
  bac = ctx.JamaRendu.charger('').then(() => ctx);
  return bac;
}

// Un plateau sur mesure : [id, x, y, param, orientation].
function plateau(W, larg, haut, depart, tuiles) {
  const Rg = W.JamaRegles;
  const l = new Rg.Level();
  l.size = new Rg.Dimension(larg, haut);
  l.startPos = new Rg.Coord(depart[0], depart[1]);
  for (const [id, x, y, param, o] of tuiles) {
    const e = new Rg.Element(null);
    e.id = id;
    e.pos = new Rg.Coord(x, y);
    e.param = param == null ? -1 : param;
    e.orientation = o || 0;
    l.tiles.push(e);
  }
  return l;
}

// Une partie et sa vue, menées comme EtatPartie : une entrée, puis la vue
// joue ses lots jusqu'à rendre la main (tmod 0,5 : un écran à 64 Hz).
function monter(W, niveau) {
  const partie = new W.JamaRegles.Partie(niveau);
  const vue = new W.JamaVue.VueJeu(partie, { showBeginFade: false, showVictoFade: false });
  vue.jouer({
    lots: partie._lots.map((x) => ({ rapides: x.rapides.map((a) => a.desc), effets: x.effets.map((a) => a.desc) })),
    evenements: [],
  });
  const finir = () => {
    let images = 0;
    while (!vue.libre() || images === 0) {
      vue.update(0.5);
      if (++images > 5000) break;
    }
    return images;
  };
  finir();
  return {
    partie,
    vue,
    v: (s) => vue.vues.get(s.uid),
    seul: (id) => partie.sprites().find((s) => s.id === id),
    // L'entrée seule, sans laisser la vue avancer.
    entree: (code) => { const r = partie.jouer(code); vue.jouer(r); return r; },
    jouer(code) { const r = partie.jouer(code); vue.jouer(r); return { r, images: finir() }; },
  };
}

test('1) le mur mangé par Louki disparaît, et revient quand il le recrache', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 5, 2, [0, 0], [[E.LOUKI, 1, 0], [E.WALL, 2, 0], [E.FRUIT, 4, 1, 1]]));
  const mur = m.seul(E.WALL);
  const louki = m.seul(E.LOUKI);
  m.jouer(Replay.START_GHOST);
  m.jouer(1);                                          // le fantôme possède le louki
  assert.strictEqual(m.partie.getCurrentAvatar(), louki);
  m.jouer(1);                                          // le louki avale le mur
  assert.ok(mur.alive, 'le mur avalé vit toujours dans le ventre du louki');
  assert.strictEqual(m.v(mur).visible, false, 'mais il ne se voit plus');
  assert.strictEqual(m.v(louki).frame, 'moveFullEast', 'le louki est plein');
  m.jouer(Replay.STOP_GHOST);                          // il le recrache, et redevient mur
  assert.ok(!m.v(louki), 'le louki est parti');
  assert.strictEqual(m.v(mur).visible, true);
  assert.deepStrictEqual([m.v(mur).x, m.v(mur).y], [32, 0], 'le mur a repris la case du louki');
});

test('2) une caisse poussée à l’eau y reste visible', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 4, 1, [0, 0], [[E.BOX, 1, 0], [E.WATER, 2, 0], [E.FRUIT, 3, 0, 1]]));
  const eau = m.seul(E.WATER);
  const autotile = m.v(eau).clips.j;
  m.jouer(1);
  assert.ok(eau.isFilledWithBox());
  assert.ok(!m.seul(E.BOX), 'la caisse n’est plus un sprite');
  // La dernière image de BoxFallInWaterAnim : la caisse affleure.
  assert.strictEqual(m.v(eau).frame, W.JamaRendu.longueur('jama_Water'));
  assert.strictEqual(m.v(eau).clips.j, autotile, 'l’autotile de l’eau n’a pas bougé');
});

test('2bis) une caisse poussée sur un pont cassé y reste visible aussi', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 5, 3, [0, 0], [[E.BRIDGE, 2, 0], [E.BOX, 2, 1], [E.FRUIT, 4, 2, 1]]));
  const pont = m.seul(E.BRIDGE);
  m.jouer(1); m.jouer(1); m.jouer(1);                  // le héros passe : le pont casse
  assert.ok(pont.isBroken());
  assert.strictEqual(m.v(pont).frame, 17);
  m.jouer(2); m.jouer(2); m.jouer(3);                  // contourner la caisse par le sud…
  m.jouer(0);                                          // …et la pousser au nord, dans le trou
  assert.ok(pont.isFilledWithBox());
  assert.strictEqual(m.v(pont).frame, W.JamaRendu.longueur('jama_Bridge'));
});

test('3) un pont détruit s’affiche détruit (le stop de l’image 17)', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 4, 1, [0, 0], [[E.BRIDGE, 1, 0], [E.FRUIT, 3, 0, 1]]));
  const pont = m.seul(E.BRIDGE);
  assert.strictEqual(m.v(pont).frame, 1);
  m.jouer(1);
  m.jouer(1);
  assert.ok(pont.isBroken());
  assert.strictEqual(m.v(pont).frame, 17);
  // …et sous les flammes d'une bombe aussi.
  const b = monter(W, plateau(W, 5, 2, [0, 0], [[E.BOMB, 1, 0, 2], [E.BRIDGE, 3, 0], [E.FRUIT, 4, 1, 1]]));
  const pont2 = b.seul(E.BRIDGE);
  b.jouer(1);                                          // la bombe glisse en (2,0), mèche de deux coups
  b.jouer(2);                                          // le héros s'écarte : elle explose
  assert.ok(!b.seul(E.BOMB), 'la bombe a sauté');
  assert.ok(pont2.isBroken(), 'la déflagration a cassé le pont');
  assert.ok(b.partie.getHero().alive, 'le héros s’est écarté à temps');
  assert.strictEqual(b.v(pont2).frame, 17);
});

test('4) le fantôme et le héros endormi se montrent dès la touche espace', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 4, 2, [0, 0], [[E.FRUIT, 3, 1, 1]]));
  const heros = m.partie.getHero();
  const r = m.entree(Replay.START_GHOST);
  assert.strictEqual(r.lots.length, 0, 'l’entrée ne joue aucun lot');
  const fantome = m.partie.getGhost();
  assert.ok(m.v(fantome), 'la vue du fantôme existe sans attendre un coup');
  assert.strictEqual(m.v(fantome).visible, true);
  assert.strictEqual(m.v(fantome).alpha, 0.5);
  const sommeil = MANIFESTE.symboles.jama_Hero.etiquettes;
  assert.ok(m.v(heros).boucle, 'le héros s’endort (gotoAndPlay « sleep »)');
  // L'endormissement file, puis tourne sur « sleep_loop » — même après un
  // coup du fantôme et le recalage qui le suit.
  m.jouer(1);
  for (let i = 0; i < 200; i++) m.vue.update(0.5);
  const f = m.v(heros).frame;
  assert.ok(f >= sommeil.sleep_loop && f <= 43, 'boucle du sommeil : image ' + f);
  // Retour au corps : le fantôme s'efface tout de suite, le héros se réveille.
  m.entree(Replay.STOP_GHOST);
  assert.ok(!m.v(fantome) || !m.v(fantome).visible, 'plus de fantôme');
  assert.strictEqual(m.v(heros).boucle, null);
  assert.strictEqual(m.v(heros).frame, 1);
});

test('5) Kohl possédé montre sa flamme, et se rendort au retour du héros', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 4, 3, [0, 0], [[E.KOHL, 1, 0], [E.FRUIT, 3, 2, 1]]));
  const kohl = m.seul(E.KOHL);
  assert.strictEqual(m.v(kohl).frame, 'base', 'endormi : le point noir');
  m.jouer(Replay.START_GHOST);
  m.jouer(1);
  assert.strictEqual(m.partie.getCurrentAvatar(), kohl);
  assert.strictEqual(m.v(kohl).frame, 'South', 'éveillé : l’image de sa direction, flamme comprise');
  m.jouer(2);
  assert.strictEqual(m.v(kohl).frame, 'South');
  m.entree(1);
  assert.strictEqual(m.v(kohl).frame, 'East', 'il se tourne au moment de la touche');
  m.jouer(Replay.STOP_GHOST);
  assert.strictEqual(m.v(kohl).frame, 'sleep');
  assert.strictEqual(m.v(kohl).clips.j, W.JamaRendu.longueur('clip271'), 'au bout de son endormissement');
});

test('et plus encore : la bombe allumée garde sa mèche qui brûle', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 6, 1, [0, 0], [[E.BOMB, 1, 0, 5], [E.FRUIT, 5, 0, 1]]));
  const bombe = m.seul(E.BOMB);
  assert.strictEqual(m.v(bombe).frame, 1);
  m.jouer(1);
  const images = new Set();
  for (let i = 0; i < 40; i++) { m.vue.update(0.5); images.add(m.v(bombe).frame); }
  assert.deepStrictEqual([...images].sort(), [2, 3, 4, 5], 'la boucle 2→5 de gotoAndPlay("2")');
  assert.strictEqual(m.v(bombe).compteur, 4);
});

test('et plus encore : le voisin d’un mur brûlé ne change de forme qu’après la flamme', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 5, 3, [0, 0], [[E.BOMB, 1, 0, 2], [E.WALL, 3, 0], [E.WALL, 3, 1], [E.FRUIT, 4, 2, 1]]));
  const [haut, bas] = m.partie.sprites().filter((s) => s.id === E.WALL).sort((a, b) => a.pos.y - b.pos.y);
  const avant = m.v(bas).frame;
  m.jouer(1);                                          // la bombe glisse en (2,0)
  m.entree(2);                                         // le héros s'écarte : elle explose
  assert.ok(!haut.alive, 'le mur du haut brûle');
  assert.strictEqual(m.v(bas).frame, avant, 'à la touche, le mur du bas n’a pas encore bougé');
  while (!m.vue.libre()) m.vue.update(0.5);
  assert.notStrictEqual(m.v(bas).frame, avant, 'la flamme éteinte, il a perdu son voisin');
});

test('et plus encore : le héros foudroyé par l’Electrificator brûle sous l’arc', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 5, 3, [0, 0], [[E.ARCHER, 2, 2], [E.FRUIT, 4, 2, 1]]));
  const heros = m.partie.getHero();
  m.jouer(1);
  m.entree(1);                                         // en (2,0), dans la ligne de l'archer
  const images = new Set();
  for (let i = 0; i < 400 && !m.vue.libre(); i++) { m.vue.update(0.5); images.add(m.v(heros).frame); }
  assert.ok([...images].some((f) => typeof f === 'number' && f >= 2 && f <= 11),
    'les images de HeroBurn défilent : ' + [...images].join(','));
});

test('vitesse : un coup = une glissade, même après que le louki a recraché', async () => {
  const W = await chargerBac();
  const m = monter(W, plateau(W, 5, 3, [0, 0], [[E.LOUKI, 1, 0], [E.WALL, 2, 0], [E.FRUIT, 4, 2, 1]]));
  m.jouer(Replay.START_GHOST);
  m.jouer(1);
  m.jouer(1);
  m.jouer(Replay.STOP_GHOST);
  // Le louki a recraché son mur. Chaque pas suivant du héros doit glisser
  // (dix pas de MoveAnim, vingt images à tmod 0,5) au lieu de sauter.
  for (const code of [2, 1, 1, 0, 3]) {
    const avant = m.partie.getHero().pos.clone();
    const { r, images } = m.jouer(code);
    if (m.partie.getHero().pos.equals(avant)) continue;
    const evs = r.evenements.concat(...r.lots.map((x) => x.auDebut.concat(x.aLaFin)));
    assert.ok(!evs.some((e) => e.type === 'refreshPositions'),
      'aucun recalage des positions avant l’animation');
    assert.ok(images >= 15, 'la glissade dure : ' + images + ' images');
  }
});

test('moteur : un lot ne joue qu’une fois dans toute la partie', () => {
  // Les crochets (surDebut/surFin) se rejouaient tous à chaque entrée : la
  // caisse tombée à l'eau était re-détruite à chaque coup.
  const l = R.Level.depuisChaine('10044022-10201-10210-10720-10730-10731-10732-10733-10723-10713-10703-10702-10711-10');
  const p = new R.Partie(l);
  // Tous les événements d'une entrée : immédiats, et portés par ses lots.
  const tous = (r) => r.evenements.concat(...r.lots.map((x) => x.auDebut.concat(x.aLaFin)));
  const r = p.jouer(2);                                // la caisse tombe à l'eau
  assert.ok(tous(r).some((e) => e.type === 'destroy'));
  // …au DÉBUT du lot de l'éclaboussure, pas à l'entrée.
  assert.ok(!r.evenements.some((e) => e.type === 'destroy'));
  for (const code of [3, 1, 3, 1]) {
    const suite = p.jouer(code);
    assert.deepStrictEqual(tous(suite).filter((e) => e.type === 'destroy'), [],
      'rien n’est re-détruit aux coups suivants');
  }
  assert.strictEqual(p._lotsJoues, p._lots.length);
});

test('moteur : réveiller un winkle qui nage ne tue pas les fantômes suivants', () => {
  // Le crochet « détruire le fantôme » de ce réveil se rejouait à chaque
  // entrée, et tuait le fantôme du moment dès qu'il sortait du corps.
  const l = new R.Level();
  l.size = new R.Dimension(4, 2);
  l.startPos = new R.Coord(0, 0);
  const pose = (id, x, y, param) => { const e = new R.Element(null); e.id = id; e.pos = new R.Coord(x, y); e.param = param == null ? -1 : param; l.tiles.push(e); };
  pose(E.WINKLE, 1, 0);
  pose(E.WATER, 2, 0);
  pose(E.FRUIT, 3, 1, 1);
  const p = new R.Partie(l);
  const winkle = p.sprites().find((s) => s.id === E.WINKLE);
  p.jouer(Replay.START_GHOST);
  p.jouer(1);                                          // possession
  p.jouer(1);                                          // le winkle se met à l'eau
  assert.ok(winkle.isInWater());
  p.jouer(Replay.STOP_GHOST);
  p.jouer(Replay.START_GHOST);
  p.jouer(1);
  p.jouer(1);                                          // possession d'un winkle qui nage : le fantôme y passe
  assert.strictEqual(p.getCurrentAvatar(), winkle);
  p.jouer(Replay.STOP_GHOST);
  p.jouer(Replay.START_GHOST);
  const g = p.getGhost();
  assert.ok(g.alive, 'le nouveau fantôme est bien là');
  p.jouer(2);
  assert.ok(g.alive && p.getCurrentAvatar() === g, 'et il le reste');
  assert.deepStrictEqual([g.pos.x, g.pos.y], [0, 1]);
});

test('Winkle est incombustible, comme dans le fichier (pas de méthode burn)', () => {
  const l = new R.Level();
  l.size = new R.Dimension(5, 3);
  l.startPos = new R.Coord(0, 2);
  const pose = (id, x, y, param) => { const e = new R.Element(null); e.id = id; e.pos = new R.Coord(x, y); e.param = param == null ? -1 : param; l.tiles.push(e); };
  pose(E.BOMB, 1, 2, 2);                               // mèche de deux coups (le pas qui la pousse compte)
  pose(E.WINKLE, 3, 2);
  pose(E.FRUIT, 4, 0, 1);
  pose(E.BOX, 2, 0);
  const p = new R.Partie(l);
  const winkle = p.sprites().find((s) => s.id === E.WINKLE);
  assert.strictEqual(typeof winkle.burn, 'undefined');
  p.jouer(1);                                          // la bombe glisse en (2,2), contre le winkle
  p.jouer(0);                                          // un pas : elle explose
  assert.ok(!p.sprites().some((s) => s.id === E.BOMB), 'la bombe a sauté');
  assert.ok(winkle.alive && p.sprites().includes(winkle), 'le winkle a tenu, la flamme s’est arrêtée sur lui');
  assert.ok(p.getHero().alive, 'le héros, écarté, aussi');
  const caisse = p.sprites().find((s) => s.id === E.BOX);
  assert.ok(!caisse, 'la caisse, elle, a brûlé');
});

test('la Grotte 14 (« Winkle, Little Star ») se termine', () => {
  const xml = fs.readFileSync(path.join(RACINE, 'Games/poulpi/levels.xml'), 'utf8');
  const m = xml.match(/<l t="Grotte 14 :\\nWinkle, Little Star">([^<]+)<\/l>/);
  assert.ok(m, 'le niveau est dans levels.xml');
  // Trouvée par une recherche en largeur sur les règles : le winkle pousse
  // les bombes à mèche courte et reste à côté de l'explosion.
  const solution = [4, 0, 0, 0, 1, 2, 1, 2, 1, 0, 2, 3, 2, 2, 1, 2, 0, 3, 3, 3, 3, 3, 3, 2, 0, 1, 0, 0, 3, 0, 5, 2, 2, 2];
  const v = R.rejouer(R.Level.depuisChaine(m[1]), solution);
  assert.strictEqual(v.victorieux, true);
  assert.strictEqual(v.coups, 32);
});

test('clavier : la répétition automatique ne met rien en attente, les flèches se suivent par touche physique', () => {
  const src = fs.readFileSync(path.join(RACINE, 'public/jamajama/jeu.js'), 'utf8');
  assert.match(src, /if \(!e\.repeat\) enAttente = FLECHES\[e\.key\];/);
  assert.match(src, /flechesTenues\.set\(e\.code \|\| e\.key, FLECHES\[e\.key\]\);/);
  assert.match(src, /flechesTenues\.delete\(e\.code \|\| e\.key\);/);
  assert.match(src, /flechesTenues\.clear\(\);/);
  assert.doesNotMatch(src, /touches\.Arrow/);
});
