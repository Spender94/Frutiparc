/*
 * Quatrième vague de retours joueurs — Mini-Wave à l'épreuve des sources AS2
 * (Games/miniWave2/class/miniwave), et la fiche du frutiz partout dans le light.
 *
 *   1. « La hitbox des soucoupes est plus restreinte, quand on touche les bords
 *      ça passe au travers. » Sprite.hTest teste `getBounds(_parent)` — la BOÎTE
 *      DU DESSIN. La soucoupe fait 39,4 × 22,1 : un rayon de 12 rognait dix
 *      pixels de chaque côté.
 *
 *   2. « Au niveau 49, le skip qui nous mène 100 niveaux plus loin ne marche
 *      plus. » game/Main.initLevel ouvre le mur de droite de soixante pixels au
 *      cinquantième écran de l'arcade (`case 48`), et sp/Hero warpe qui le
 *      franchit. Le portage avait la sortie mais jamais la porte : le vaisseau
 *      restait cloué à LARGEUR - ray.
 *
 *   3. « $bads12 se téléporte plutôt que de se déplacer. » Mandarine.as change
 *      de place d'un coup mais DESSINE le fruit à l'ancienne, en résorbant
 *      l'écart de 0,6 par image.
 *
 *   4. « $bads28 peut passer en dessous du vaisseau. » Aubergine.as garde la
 *      RÉFÉRENCE du vaisseau, pas ses coordonnées : la charge le suit. Le
 *      portage visait un point figé, dépassait, et finissait sous lui.
 *
 *   5. « $bads19 a une trajectoire qui lui permet de remonter bizarrement. »
 *      Baies.as donne `killMargin = 0` à ses trois baies : parties vers le haut,
 *      elles meurent au bord au lieu de survivre dans la marge et de revenir.
 *
 *   6. « Le vaisseau ne peut plus bouger du tout ni tirer jusqu'à l'explosion,
 *      aléatoire. » Non reproduit ; on ferme les deux portes par lesquelles la
 *      commande peut rester coincée (cf. plus bas).
 *
 *   7. Et, côté light : un pseudo se touche PARTOUT, comme au bureau.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const SPRITES = require(path.join(ROOT, 'public/miniwave/sprites/sprites.json'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));
const ARCADE = NIVEAUX.main[0].levels;

function partie(o) {
  o = o || {};
  const journal = [];
  const jeu = new E.Game(Object.assign({
    levels: ARCADE, graine: 7, onEvent: (n, d) => journal.push({ n, d }),
  }, o));
  return { jeu, journal };
}
function jusquAuCombat(jeu) {
  for (let i = 0; i < 600 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.COMBAT, 'le combat est engagé');
}
function poserFigurants(jeu, liste) {
  while (jeu.badsList.length > 0) jeu.badsList[0].tuer();
  const nes = liste.map((o) => jeu.newBads(o.type === undefined ? 0 : o.type,
    Object.assign({ waveId: 0, lineId: 0, wpTimer: -1, flWave: false }, o)));
  for (const b of nes) b.flReady = true;
  jeu.toKill = jeu.badsList.length + 1;
  return nes;
}
// L'enveloppe d'un dessin, dans le repère du sprite.
function enveloppe(sprite, image) {
  const etat = sprite.etats.find((e) => e.frame === image) || sprite.etats[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of etat.pieces) {
    const ox = p.o ? p.o[0] : -p.w / 2;
    const oy = p.o ? p.o[1] : -p.h / 2;
    for (const [cx, cy] of [[ox, oy], [ox + p.w, oy], [ox, oy + p.h], [ox + p.w, oy + p.h]]) {
      const X = p.m[0] * cx + p.m[2] * cy + p.m[4];
      const Y = p.m[1] * cx + p.m[3] * cy + p.m[5];
      x0 = Math.min(x0, X); x1 = Math.max(x1, X);
      y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
  }
  return { x0, y0, x1, y1 };
}

// ── 1. La soucoupe se touche sur toute sa largeur ────────────────────────

test('la soucoupe présente la boîte de son dessin, pas un petit carré', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const s = jeu.genSaucer();
  s.x = 120; s.y = 40;

  // La boîte du moteur est bien celle du dessin sorti du SWF.
  const b = enveloppe(SPRITES.saucer, 1);
  assert.ok(Math.abs(s.boite.x0 - b.x0) < 0.5 && Math.abs(s.boite.x1 - b.x1) < 0.5,
    `largeur : moteur ${s.boite.x0}..${s.boite.x1}, dessin ${b.x0.toFixed(1)}..${b.x1.toFixed(1)}`);
  assert.ok(Math.abs(s.boite.y0 - b.y0) < 0.5 && Math.abs(s.boite.y1 - b.y1) < 0.5,
    `hauteur : moteur ${s.boite.y0}..${s.boite.y1}, dessin ${b.y0.toFixed(1)}..${b.y1.toFixed(1)}`);
  assert.ok(s.boite.x1 - s.boite.x0 > 38, 'la soucoupe fait bien près de quarante pixels de large');

  // Les BORDS touchent — c'est tout le sujet du retour. Douze pixels, l'ancien
  // rayon, les laissait passer au travers.
  for (const dx of [-18, -15, 15, 18]) {
    assert.equal(s.touche(120 + dx, 40), true, `un tir à ${dx} px du centre touche`);
    assert.equal(Math.abs(dx) < 12, false, 'et l\'ancien rayon de 12 le manquait');
  }
  // Au-delà du dessin, non.
  assert.equal(s.touche(120 + 21, 40), false, 'hors du dessin, rien');
  assert.equal(s.touche(120, 40 + 11), false, 'sous le ventre non plus');
});

test('un tir qui touche le bord de la soucoupe la fait bien exploser', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  poserFigurants(jeu, []);               // l'escadre mangerait le tir avant elle
  const s = jeu.genSaucer();
  s.x = 120; s.y = 40; s.speed = 0;      // figée : on vise un point précis
  const avant = jeu.score;
  jeu.newHShot({ x: 120 + 17, y: 40, vitx: 0, vity: 0 });   // 17 px : hors de l'ancien rayon
  jeu.update(1);
  assert.ok(!s.vivant, 'la soucoupe est abattue');
  assert.equal(jeu.score - avant, 200, 'et rapporte ses deux cents points');
  assert.equal(jeu.saucerKill, 1);
  assert.equal(jeu.optList.length, 1, 'elle lâche son bonus');
});

// ── 2. La porte du niveau 49 ─────────────────────────────────────────────

test('le cinquantième écran de l\'arcade ouvre le mur de droite', () => {
  const { jeu } = partie({ mode: 'arcade' });
  for (const n of [0, 47, 49, 100]) {
    jeu.level = n; jeu.initLevel();
    assert.equal(jeu.shipBounds.max, E.LARGEUR, `niveau ${n} : mur fermé`);
  }
  jeu.level = 48; jeu.initLevel();
  assert.equal(jeu.shipBounds.max, E.LARGEUR + 60,
    'niveau 48 (le cinquantième écran) : le mur s\'écarte de soixante pixels');

  // Et seulement dans l'arcade : la map du jour n'a pas de porte.
  const autre = new E.Game({ levels: ARCADE, graine: 7, mode: 'challenge', onEvent: () => {} });
  autre.level = 48; autre.initLevel();
  assert.equal(autre.shipBounds.max, E.LARGEUR, 'le Challenge n\'a pas de raccourci');
});

test('franchir la porte saute cent niveaux et rend le vaisseau à l\'escadron', () => {
  const { jeu, journal } = partie({ mode: 'arcade', vies: 3 });
  jeu.level = 48;
  jeu.initStep(1);                       // arrivée du niveau 49
  jusquAuCombat(jeu);
  assert.equal(jeu.shipBounds.max, E.LARGEUR + 60, 'la porte est ouverte');

  const h = jeu.hero;
  // On pousse le vaisseau vers la droite, comme le joueur qui insiste.
  jeu.entree.droite = true;
  for (let i = 0; i < 200 && h.vivant; i++) jeu.update(1);
  jeu.entree.droite = false;

  assert.ok(!h.vivant, 'le vaisseau s\'en va par la droite');
  assert.ok(journal.some((e) => e.n === 'warp'), 'le client saura semer les étoiles de warp');
  assert.equal(jeu.nextLevel !== undefined ? jeu.nextLevel : jeu.level, 148,
    'cent niveaux plus loin (48 + 100)');
  // Le vaisseau est RENDU à l'escadron (le niveau suivant en reprend un
  // aussitôt : c'est l'annonce qu'on observe, pas le solde).
  assert.ok(journal.some((e) => e.n === 'vieGagnee'), 'et le vaisseau revient à l\'escadron');
  assert.ok(!journal.some((e) => e.n === 'finPartie'), 'ce n\'est pas une vie perdue');
});

// ── 3. La Batmandarine glisse ────────────────────────────────────────────

test('la Batmandarine change de place d\'un coup mais se DESSINE en glissant', () => {
  const { jeu } = partie({ graine: 3 });
  jusquAuCombat(jeu);
  // Une escadre réaliste : le moteur ne fait onduler que dix ennemis par tour,
  // et c'est ce rythme qui donne sa durée au glissement.
  const nes = poserFigurants(jeu, Array.from({ length: 10 }, (_, i) => ({
    type: i === 0 ? 12 : 0, x: 40 + i * 18, y: 60,
  })));
  const m = nes[0];
  assert.equal(m.type, 12);

  let saut = null;
  for (let i = 0; i < 8000 && !saut; i++) {
    const avant = m.x;
    jeu.update(1);
    if (m.flStrafe && m.x !== avant) saut = { avant, apres: m.x, dx: m.dx };
  }
  assert.ok(saut, 'la Batmandarine a fini par se déplacer');
  assert.ok(Math.abs(saut.avant - saut.apres) > 5, 'le saut est franc');
  assert.ok(Math.abs(saut.dx) <= 60, 'et reste dans l\'écart maximum de Mandarine.as');
  // Le DESSIN part de l'ancienne place et rattrape en plusieurs images.
  assert.ok(Math.abs(m.x + m.dx - saut.avant) < 1e-6,
    'à la première image, le fruit se dessine encore là où il était');
  const suivi = [];
  for (let k = 0; k < 20 && m.flStrafe; k++) { jeu.update(1); suivi.push(m.dx); }
  assert.ok(suivi.length >= 4, `le glissement dure plusieurs images (${suivi.length})`);
  for (let i = 1; i < suivi.length; i++) {
    assert.ok(Math.abs(suivi[i]) <= Math.abs(suivi[i - 1]), 'l\'écart ne fait que se résorber');
  }
  assert.equal(m.flStrafe, false, 'puis le fruit est arrivé');
  assert.equal(m.dx, 0, 'et le dessin colle de nouveau à la position');

  // Le client pose bien le dessin décalé, et la pose d'esquive.
  const jeujs = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  // `px` = la place où le fruit se MONTRE (celle de la vague pour presque
  // tous, celle de la charge pour l'Aubergine) ; `dx` reste le rattrapage
  // propre à la Batmandarine, qui s'y ajoute.
  assert.match(jeujs, /b\.px \+ \(b\.dx \|\| 0\)/, 'le dessin suit le décalage');
  assert.match(jeujs, /b\.flStrafe && sp && sp\.etats\.length > 1 \? 2/, 'et prend l\'image 2 en route');
  assert.ok(SPRITES.bads12.etats.length >= 2, 'la Batmandarine a bien sa seconde image');
});

// ── 4. L'Aubergine suit le vaisseau ──────────────────────────────────────

test('l\'Aubergine folle suit le vaisseau pendant sa charge', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const [a] = poserFigurants(jeu, [{ type: 28, x: 120, y: 50 }]);
  const h = jeu.hero;

  // La charge part alors que le vaisseau est À DROITE…
  h.x = 210;
  for (let i = 0; i < 4000 && a.step !== 1; i++) E.TYPES[28].vague(a, 1);
  assert.equal(a.step, 1, 'la charge est lancée');
  assert.equal(a.cible, null, 'elle vise « le vaisseau », pas un point figé');

  // …et le vaisseau file à GAUCHE. Une charge visant un point figé continuerait
  // vers la droite ; celle du SWF se rabat.
  h.x = 30;
  for (let i = 0; i < 20 && a.step === 1; i++) jeu.update(1);
  assert.ok(a.kx < 120,
    `la charge suit le vaisseau au lieu de son point de départ (kx=${a.kx.toFixed(1)})`);
  assert.ok(a.vitx < 0, 'elle est bien lancée vers la gauche');
});

// ── 5. Les baies meurent au bord ─────────────────────────────────────────

test('les trois baies posthumes meurent au bord de l\'écran', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const [b] = poserFigurants(jeu, [{ type: 19, x: 120, y: 50 }]);
  b.exploser();
  const baies = jeu.bShotList.filter((t) => t.behaviourId === 2);
  assert.equal(baies.length, 3, 'trois baies');
  for (const t of baies) {
    assert.equal(t.killMargin, 0, 'aucune marge : au bord, elles disparaissent');
    assert.ok(t.vity < 0, 'elles partent vers le haut');
  }
  // Une baie poussée hors de l'écran ne survit pas à l'image suivante.
  const t = baies[0];
  t.x = 120; t.y = -1; t.vitx = 0; t.vity = -1;
  jeu.update(1);
  assert.ok(!t.vivant, 'sortie par le haut : elle meurt, elle ne revient pas');
});

// ── 6. La commande ne peut plus rester coincée ───────────────────────────

/*
 * Le blocage n'a pas été reproduit — mais la commande du light n'a que deux
 * façons de rester coincée, et les deux sont fermées :
 *
 *   · une TOUCHE tenue au moment où la fenêtre perd le focus ne reçoit jamais
 *     son relâchement. Gauche et droite coincées ensemble s'annulent : le
 *     vaisseau est cloué sur place, et le tir ne part plus si la barre n'était
 *     pas tenue. On lâche donc tout au `blur` et à la mise en arrière-plan.
 *
 *   · deux surfaces pilotent (la bande tactile et le canevas) en partageant la
 *     même commande. Le relâchement de l'une effaçait la prise de l'autre : le
 *     pouce resté posé ne visait plus rien, et le point de visée gelé ramenait
 *     le vaisseau à chaque image. Chaque surface retient donc SON pointeur.
 */
test('la commande se relâche quand la fenêtre part, et chaque surface tient son doigt', () => {
  const jeujs = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  assert.match(jeujs, /relacherTout\(\)\s*\{/, 'il existe un relâchement général');
  for (const attendu of [
    /this\.entree\.gauche = false/, /this\.entree\.droite = false/,
    /this\.entree\.tir = false/, /this\.entree\.bombe = false/,
    /this\.entree\.cibleX = null/,
  ]) assert.match(jeujs, attendu, 'il remet chaque commande à zéro');
  assert.match(jeujs, /window\.addEventListener\('blur', \(\) => this\.relacherTout\(\)\)/,
    'la perte de focus relâche tout');
  assert.match(jeujs, /document\.hidden\) \{ this\.relacherTout\(\)/,
    'passer en arrière-plan aussi');
  assert.match(jeujs, /etat\.pointeur !== null\s*\n?\s*&& ev\.pointerId !== etat\.pointeur\) return/,
    'une surface ne relâche que son propre pointeur');
  assert.match(jeujs, /lostpointercapture/, 'et une capture rompue vaut un relâchement');
});

// ── 7. Le light : un pseudo se touche partout ────────────────────────────

test('un pseudo ouvre la fiche du frutiz, où qu\'il soit', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(html, /function pseudoCliquable\(noeud, pseudo\)/, 'l\'outil existe');
  assert.match(html, /function brancherPseudos\(racine\)/, 'et sa version pour les vues en HTML');
  // Le nom vit dans l'attribut : un même élément sert à plusieurs frutiz.
  assert.match(html, /noeud\.setAttribute\("data-fiche", p\)/, 'le pseudo courant est relu au clic');
  assert.match(html, /noeud\.getAttribute\("data-fiche"\)/);
  // Les endroits du retour : le tableau des scores et ses médaillés.
  assert.match(html, /<span class="n" data-fiche="/, 'les lignes du tableau des scores');
  assert.match(html, /<span data-fiche="' \+ xmlEscape\(p\.user\)/, 'les médaillés de la veille');
  assert.match(html, /brancherPseudos\(box\)/, 'et le tableau est branché après son rendu');
  // Le chat sous toutes ses formes, et l'en-tête d'un courrier.
  assert.equal((html.match(/pseudoCliquable\(fr, o\.from\)/g) || []).length, 2,
    'les messages d\'émotion et d\'image');
  assert.match(html, /pseudoCliquable\(\$\("#mail-lu-qui"\)/, 'l\'expéditeur d\'un courrier');
  // Et « admin » reste du texte : ce n'est pas un frutiz.
  assert.match(html, /p\.toLowerCase\(\) === "admin"/, 'admin n\'a pas de fiche');
});
