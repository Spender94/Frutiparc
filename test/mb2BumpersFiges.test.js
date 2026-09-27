/*
 * MOTIONBALL — LES BUMPERS CLASSIQUES NE RESTENT PLUS FIGÉS « GROS ET ILLUMINÉS ».
 *
 * Le bumper normal (btype 1, « bnormal », sprite 860) n'a ni compteur ni
 * drapeau : touché à l'image 1, il part sur « hit » (image 2 : l'anneau 857
 * à 130 %, l'éclat 859 teinté), joue ses neuf images, reboucle sur l'image 1
 * et s'y arrête (script d'image « mb2:860:1 » = stop()). Collide.as:204.
 *
 * Le bug était dans le moteur (kaluga/moteur/flash.js) : au rebouclage 9 → 1,
 * Clip.aller pose l'image 1 ($frame = 1), recrée la forme 855… et
 * K.finaliser VIDAIT la file des scripts au milieu de l'avance de la liste
 * d'affichage. Le script de « main » (sprite 900) déjà programmé — la boucle
 * de jeu, Manager.main — tournait alors AVANT le stop() de l'image 1 du
 * bumper, programmé juste après. Si la bille touchait le bumper à cet
 * instant, gotoAndPlay("hit") le mettait à l'image 2… puis le stop() en
 * retard l'y figeait pour de bon : gros, illuminé, muet, jusqu'à la sortie
 * de la salle. Un contact prolongé (bille calée contre le bumper) retombe
 * toujours sur ce tick-là.
 *
 * Le bumper-horloge (btime) et le bumper ombre (bshadow) n'étaient pas
 * touchés : leur rebouclage ne recrée aucun enfant, donc pas de vidage de
 * la file au milieu de l'avance.
 *
 * Le correctif : Scene.tick marque l'avance (enAvance) et K.finaliser ne
 * vide plus la file pendant celle-ci — toute la liste avance, PUIS les
 * actions se jouent, dans l'ordre où les images ont été jouées.
 *
 * Pur node : ni navigateur, ni serveur, ni canevas. La variable
 * d'environnement ANCIEN_MOTEUR=1 rejoue l'ancien Scene.tick (sans
 * enAvance), en mémoire, pour voir le test échouer sans toucher au fichier.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Le moteur (sans DOM) et les scripts d'image de MotionBall, comme la page.
globalThis.window = undefined;
for (const f of ['public/kaluga/moteur/formes.js', 'public/kaluga/moteur/flash.js', 'public/kaluga/moteur/texte.js',
  'public/mb2/jeu/scripts-images.js']) {
  require(path.join(ROOT, f));
}
const K = globalThis.KalugaMoteur;
const biblio = new K.Bibliotheque('mb2', JSON.parse(fs.readFileSync(path.join(ROOT, 'public/mb2/data/mb2.json'), 'utf8')), {});

// Contre-épreuve : l'ancien tick, qui avançait la liste sans marquer l'avance.
if (process.env.ANCIEN_MOTEUR) {
  K.Scene.prototype.tick = function () {
    this.numeroTick++;
    this.avancerTous(this.racine);
    if (this.surTick) this.fileScripts.unshift([this.racine, this.surTick]);
    this.viderScripts();
  };
}

// Une scène sans canevas : juste la file des scripts et le compteur de ticks.
function nouvelleScene() {
  const sc = Object.create(K.Scene.prototype);
  Object.assign(sc, { numeroTick: 0, fileScripts: [], dansScript: false, enAvance: false, surTick: null, souris: { x: -1000, y: -1000 } });
  sc.surSouris = () => {};
  return sc;
}

// Remplace des scripts d'image le temps de `corps`, puis les rend (et la scène).
function avecScripts(remplacements, corps) {
  const S = K.scriptsImages;
  const sauves = {};
  for (const cle of Object.keys(remplacements)) sauves[cle] = S[cle];
  const sceneAvant = K.scene;
  try {
    Object.assign(S, remplacements);
    return corps();
  } finally {
    for (const cle of Object.keys(sauves)) S[cle] = sauves[cle];
    K.scene = sceneAvant;
  }
}

// La racine du SWF (clip 0) pose « main » (900), qui joue ses vraies images
// 2 et 3 : la boucle de jeu tourne exactement comme dans la page.
function demarrer() {
  const sc = nouvelleScene();
  K.scene = sc;
  const racine = K.instancier(biblio, 0);
  sc.racine = racine;
  K.finaliser(racine, null);
  return sc;
}

// Le pire cas : la bille touche le bumper à CHAQUE tick. « main » attache un
// bumper du genre voulu, puis relance « hit » dès qu'il est à l'image 1.
function jouerContactPermanent(nom, ticks) {
  let main = null;
  let bumper = null;
  const suite = [];
  avecScripts({
    'mb2:900:1': function () { main = this; },
    'mb2:900:2': function () {
      if (!bumper) { bumper = main.attachMovie(nom, 'bumper', 3000); return; }
      if (bumper._currentframe === 1) bumper.gotoAndPlay('hit');
    },
  }, () => {
    const sc = demarrer();
    for (let i = 0; i < ticks; i++) {
      sc.tick();
      if (bumper) suite.push({ f: bumper._currentframe, joue: bumper.$joue });
    }
  });
  return suite;
}

const lisible = (suite) => suite.map((e) => e.f + (e.joue ? 'p' : 's')).join(' ');

for (const nom of ['bnormal', 'btime', 'bshadow']) {
  test(`le bumper « ${nom} » touché sans relâche reboucle toujours, il ne reste jamais figé sur « hit »`, () => {
    const suite = jouerContactPermanent(nom, 40);
    assert.ok(suite.length >= 35, 'le bumper a bien été attaché et suivi');

    // Jamais trois ticks de suite arrêté sur l'image 2 (« hit »).
    let serie = 0;
    let pire = 0;
    for (const e of suite) {
      if (e.f === 2 && !e.joue) { serie++; pire = Math.max(pire, serie); } else serie = 0;
    }
    assert.ok(pire < 3, `${nom} figé sur « hit » : ${lisible(suite)}`);

    // Et son image continue de tourner : plusieurs retours en arrière (rebouclages).
    const retours = suite.filter((e, i) => i > 0 && e.f < suite[i - 1].f).length;
    assert.ok(retours >= 3, `${nom} ne reboucle pas (${retours} retours) : ${lisible(suite)}`);

    // Sur les dix derniers ticks, il joue encore.
    assert.ok(suite.slice(-10).some((e) => e.joue), `${nom} ne joue plus : ${lisible(suite)}`);
  });
}

test('pendant l\'avance des images, K.finaliser ne vide pas la file : le stop() de l\'enfant passe avant la boucle de jeu du parent', () => {
  // Le tick marque l'avance de la liste d'affichage.
  assert.match(K.Scene.prototype.tick.toString(), /enAvance/, 'Scene.tick marque l\'avance (enAvance)');

  const journal = [];
  let main = null;
  let bumper = null;
  avecScripts({
    'mb2:900:1': function () { main = this; },
    'mb2:900:2': function () {
      if (!bumper) { bumper = main.attachMovie('bnormal', 'bumper', 3000); return; }
      journal.push('main@' + bumper._currentframe);
    },
    'mb2:860:1': function () { journal.push('stop@' + this._currentframe); this.stop(); },
  }, () => {
    const sc = demarrer();
    sc.tick();                       // « main » attache le bumper
    bumper.gotoAndPlay(8);
    sc.tick();                       // 8 → 9
    assert.strictEqual(bumper._currentframe, 9);
    journal.length = 0;
    sc.tick();                       // 9 → 1 : le rebouclage recrée la forme 855
    // L'enfant a rebouclé pendant l'avance ; son stop() de l'image 1 passe
    // AVANT la boucle de jeu, qui le voit donc déjà arrêté à l'image 1.
    assert.deepStrictEqual(journal, ['stop@1', 'main@1']);
    assert.strictEqual(bumper._currentframe, 1);
    assert.strictEqual(bumper.$joue, false);
  });
});
