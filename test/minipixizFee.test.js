// Les fées de Minipixiz — le personnage du jeu.
//
// Tout tourne autour d'elles : le bassin en fait apparaître, le donjon leur est
// interdit sans elles, les missions les envoient, et la partie de forêt se joue
// avec l'une d'elles au-dessus du plateau. Une fée mal portée, c'est le jeu
// entier qui devient faux — d'où ce fichier.
//
// Deux écarts au jeu d'origine sont assumés, et ce sont eux que les deux
// premiers tests fixent : setNextLevelUp tirait la caractéristique parmi HUIT
// alors qu'il n'y en a que six, et l'ordre du moral dans upkeep est conservé
// tel quel parce que c'est une règle, pas une coquille.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));
const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));

// Un tirage reproductible : même graine, même fée.
const alea = (g) => E.generateur(g);

// ── La génération ─────────────────────────────────────────────────────────

test('une fée neuve est celle de Cm.genFaerieSeed', () => {
  const fs2 = F.genererGraine(alea(7));
  assert.equal(typeof fs2.$name, 'string');
  assert.ok(fs2.$name.length >= 3, `un nom composé de deux syllabes : ${fs2.$name}`);
  assert.deepEqual(fs2.$carac, [1, 1, 1, 1, 1, 1], 'un point partout au départ');
  assert.equal(fs2.$life, 1, 'ceil(carac.vie)');
  assert.equal(fs2.$mana, 2, 'carac.mana × 2');
  assert.equal(fs2.$hunger, 4);
  assert.equal(fs2.$moral, 10);
  assert.equal(fs2.$level, 0);
  assert.equal(fs2.$bagMax, 2);
  assert.deepEqual(fs2.$spell, [20, 0], 'la boule de lumière et l\'échange');
  assert.equal(fs2.$skin.length, 4, 'un corps parmi six, et trois couleurs');
  assert.ok(fs2.$skin[0] >= 0 && fs2.$skin[0] < 6);
  assert.equal(fs2.$mission, null);
  assert.equal(fs2.$pos, null, 'elle naît en main, pas en bocal');
});

test('le nom se compose de deux syllabes du jeu', () => {
  for (let g = 1; g <= 40; g++) {
    const n = F.genererNom(alea(g));
    const ok = F.SYLLABES_1.some((a) => F.SYLLABES_2.some((b) => a + b === n));
    assert.ok(ok, `${n} vient bien de Lang.nameSyl0 + nameSyl1`);
  }
});

test('deux graines différentes donnent deux fées différentes', () => {
  const noms = new Set();
  for (let g = 1; g <= 60; g++) noms.add(F.genererGraine(alea(g)).$name);
  assert.ok(noms.size > 30, `${noms.size} noms distincts sur soixante tirages`);
});

test('la même graine donne toujours la même fée', () => {
  const a = F.genererGraine(alea(99));
  const b = F.genererGraine(alea(99));
  assert.deepEqual(a, b, 'reproductible — sans ça, rien n\'est testable');
});

test('chaque goût de plus est bien plus rare que le précédent', () => {
  // table = [1.1, 2, 8, 40, 100, 1000] : la première préférence tombe neuf fois
  // sur dix, la deuxième une sur deux, la troisième une sur huit. C'est cette
  // décroissance qui fait qu'une fée à trois préférences se remarque.
  const compte = [0, 0, 0, 0, 0, 0, 0];
  for (let g = 1; g <= 400; g++) {
    compte[Math.min(6, F.genererGraine(alea(g)).$taste[0].length)]++;
  }
  assert.ok(compte[1] > compte[0], `une préférence est le cas courant (${compte[1]} contre ${compte[0]})`);
  assert.ok(compte[1] > compte[2], `deux, c'est déjà moins souvent (${compte[2]})`);
  assert.ok(compte[2] > compte[3], `et trois, rare (${compte[3]})`);
  assert.ok(compte[0] > 0, 'quelques fées n\'ont aucun goût marqué');
});

test('un travers de caractère est exceptionnel', () => {
  let avec = 0;
  for (let g = 1; g <= 400; g++) {
    if (F.genererGraine(alea(g)).$behaviour.some((v) => v === 1)) avec++;
  }
  // Les cinq raretés vont de 1/60 à 1/100 : autour de 8 % des fées.
  assert.ok(avec > 5 && avec < 120, `${avec} fées sur 400 ont un travers`);
});

// ── Le bassin ─────────────────────────────────────────────────────────────

test('le bassin enrichit la fée d\'autant plus que la partie est ancienne', () => {
  const jeune = [], vieux = [];
  for (let g = 1; g <= 60; g++) {
    const a = F.genererGraine(alea(g));
    jeune.push(F.enrichirGraine(a, 2, alea(g + 500)));
    const b = F.genererGraine(alea(g));
    vieux.push(F.enrichirGraine(b, 400, alea(g + 500)));
  }
  const moy = (l) => l.reduce((s, v) => s + v, 0) / l.length;
  assert.ok(moy(vieux) > moy(jeune),
    `au bout de 400 jours le bassin donne plus (${moy(vieux).toFixed(2)} contre ${moy(jeune).toFixed(2)})`);
});

test('la fée enrichie a bien plus de points, et sa vie suit', () => {
  const fee = F.genererGraine(alea(3));
  const avant = fee.$carac.reduce((s, v) => s + v, 0);
  F.enrichirGraine(fee, 1000, alea(11));
  const apres = fee.$carac.reduce((s, v) => s + v, 0);
  assert.ok(apres >= avant, 'les points ne se perdent pas');
  assert.equal(fee.$life, Math.ceil(fee.$carac[F.CARAC.VIE]), 'la vie suit la caractéristique');
  assert.equal(fee.$mana, fee.$carac[F.CARAC.MANA] * 2);
});

// ── L'expérience et la montée de niveau ───────────────────────────────────

test('le coût d\'un niveau monte au carré', () => {
  const fee = new F.Fee(F.genererGraine(alea(5)), alea(5));
  assert.equal(fee.limiteExp(), 50, 'le premier niveau coûte cinquante');
  fee.fs.$level = 9;
  assert.equal(fee.limiteExp(), 5000, 'le dixième en coûte cent fois plus');
});

test('SETNEXTLEVELUP_HUIT_CARAC : on tire parmi les SIX vraies caractéristiques', () => {
  // FaerieInfo.setNextLevelUp fait `cid = Std.random(8)` alors que
  // it.Carac.carNameList n'en compte que six. Un tirage sur quatre désignait une
  // case inexistante : la montée ne donnait rien et `$carac[6]++` inscrivait un
  // NaN, ce qui vidait la barre de vie de la fée. On tire donc parmi les six.
  const vus = new Set();
  for (let g = 1; g <= 200; g++) {
    const fee = new F.Fee(F.genererGraine(alea(g)), alea(g + 77));
    fee.preparerProchainNiveau();
    vus.add(fee.fs.$next[0]);
  }
  assert.deepEqual([...vus].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5],
    'les six, et rien que les six');

  // Et la preuve par la fiche : aucune caractéristique ne devient NaN.
  const fee = new F.Fee(F.genererGraine(alea(1)), alea(1));
  fee.incExp(50);
  fee.monterNiveau(0);
  assert.ok(fee.fs.$carac.every((v) => Number.isFinite(v)),
    `aucun NaN dans ${JSON.stringify(fee.fs.$carac)}`);
  assert.equal(fee.fs.$carac.length, 6, 'et pas de septième case inventée');
});

test('on n\'améliore pas une caractéristique déjà au maximum', () => {
  const fee = new F.Fee(F.genererGraine(alea(2)), alea(2));
  fee.fs.$carac = [7, 7, 7, 7, 7, 1];      // tout au plafond sauf le mana
  for (let i = 0; i < 20; i++) {
    fee.preparerProchainNiveau();
    assert.equal(fee.fs.$next[0], F.CARAC.MANA, 'la seule encore améliorable');
  }
});

test('monter de niveau consomme l\'expérience et remonte le moral', () => {
  const fee = new F.Fee(F.genererGraine(alea(4)), alea(4));
  fee.fs.$moral = 5;
  fee.incExp(60);
  const cible = fee.fs.$next[0];
  const avant = fee.fs.$carac[cible];
  const appris = fee.monterNiveau(0);
  assert.equal(appris.genre, 'carac');
  assert.equal(fee.fs.$level, 1);
  assert.equal(fee.fs.$exp, 10, '60 - 50');
  assert.equal(fee.fs.$carac[cible], avant + 1);
  assert.equal(fee.carac[cible], avant + 1, 'la copie vivante suit');
  assert.equal(fee.fs.$moral, 9, 'incMoral(4), borné à vingt');
});

test('monter de niveau sans l\'expérience ne fait rien', () => {
  const fee = new F.Fee(F.genererGraine(alea(6)), alea(6));
  fee.incExp(10);
  assert.equal(fee.monterNiveau(0), null);
  assert.equal(fee.fs.$level, 0, 'le niveau ne bouge pas');
});

test('on peut choisir le sort plutôt que la caractéristique', () => {
  const fee = new F.Fee(F.genererGraine(alea(8)), alea(8));
  fee.preparerProchainNiveau(() => 13);      // un sort qu'elle n'a pas
  fee.incExp(50);
  const appris = fee.monterNiveau(1, () => 14);
  assert.equal(appris.genre, 'sort');
  assert.equal(appris.id, 13);
  assert.ok(fee.fs.$spell.indexOf(13) >= 0, 'elle le connaît maintenant');
});

test('le tirage d\'un sort évite ceux qu\'elle connaît déjà', () => {
  const fee = new F.Fee(F.genererGraine(alea(9)), alea(9));
  let n = 0;
  // Les deux premiers tirages sortent des sorts connus, le troisième un neuf.
  fee.preparerProchainNiveau(() => [20, 0, 7][Math.min(n++, 2)]);
  assert.equal(fee.fs.$next[1], 7, 'on retire jusqu\'à en trouver un inconnu');
});

// ── Manger ────────────────────────────────────────────────────────────────

test('la nourrir la rassasie, et ce qu\'elle aime la réjouit', () => {
  const graine = F.genererGraine(alea(21));
  graine.$taste = [[3], [4]];
  const fee = new F.Fee(graine, alea(21));
  fee.fs.$hunger = 4; fee.fs.$moral = 10;

  assert.deepEqual(fee.manger(3), { eat: 3, moral: 3 }, 'son plat préféré');
  assert.equal(fee.fs.$hunger, 8, 'incHunger(4)');
  assert.equal(fee.fs.$moral, 13);

  assert.deepEqual(fee.manger(4), { eat: 4, moral: -3 }, 'ce qu\'elle déteste');
  assert.equal(fee.fs.$moral, 10);

  assert.deepEqual(fee.manger(1), { eat: 1, moral: 0 }, 'et le reste la laisse froide');
});

test('les aliments rares font toujours plaisir', () => {
  const fee = new F.Fee(F.genererGraine(alea(22)), alea(22));
  fee.fs.$taste = [[], []];
  assert.equal(fee.manger(12).moral, 3, 'au-delà de dix, c\'est un régal');
});

test('la faim et le moral ne dépassent jamais vingt', () => {
  const fee = new F.Fee(F.genererGraine(alea(23)), alea(23));
  for (let i = 0; i < 20; i++) fee.manger(12);
  assert.equal(fee.fs.$hunger, 20);
  assert.equal(fee.fs.$moral, 20);
});

// ── La nuit (upkeep) ──────────────────────────────────────────────────────

test('une fée bien nourrie et libre passe la nuit sans dommage', () => {
  const fee = new F.Fee(F.genererGraine(alea(31)), alea(31));
  fee.fs.$carac = [1, 1, 5, 1, 1, 1]; fee.carac = fee.fs.$carac.slice();
  fee.fs.$hunger = 20; fee.fs.$moral = 10; fee.fs.$life = 1;
  const r = fee.entretien(true);
  assert.equal(r.partie, false);
  assert.equal(fee.fs.$life, 5, 'elle se régénère à hauteur de ce qu\'elle a mangé');
  assert.equal(fee.fs.$hunger, 16, 'la faim descend de quatre par nuit');
  assert.equal(fee.fs.$moral, 10, 'libre et repue, le moral tient');
});

test('à jeun, elle perd sa vie puis s\'en va', () => {
  const fee = new F.Fee(F.genererGraine(alea(32)), alea(32));
  fee.fs.$carac = [1, 1, 3, 1, 1, 1]; fee.carac = fee.fs.$carac.slice();
  fee.fs.$hunger = 0; fee.fs.$life = 1; fee.fs.$moral = 10;

  let r = fee.entretien(false);
  assert.equal(r.partie, false);
  assert.equal(fee.fs.$life, 0, 'elle a très faim');
  assert.ok(r.messages.some((m) => /très faim/.test(m)));

  r = fee.entretien(false);
  assert.equal(r.partie, true, 'la nuit suivante, elle meurt dans son bocal');
  assert.ok(r.messages.some((m) => /morte de faim/.test(m)), r.messages.join(' | '));
});

test('à jeun mais LIBRE, elle s\'enfuit au lieu de mourir', () => {
  const fee = new F.Fee(F.genererGraine(alea(33)), alea(33));
  fee.fs.$carac = [1, 1, 3, 1, 1, 1]; fee.carac = fee.fs.$carac.slice();
  fee.fs.$hunger = 0; fee.fs.$life = 0; fee.fs.$moral = 10;
  const r = fee.entretien(true);
  assert.equal(r.partie, true);
  assert.ok(r.messages.some((m) => /enfuie car elle avait trop faim/.test(m)));
});

test('UPKEEP_MORAL_PLANCHER : enfermée, elle déprime ; libre et malheureuse, elle part', () => {
  // Le jeu teste `$moral < 3` AVANT de remonter le plancher à zéro : c'est
  // cette règle, dure mais voulue, qui fait qu'on peut perdre une fée.
  const bocal = new F.Fee(F.genererGraine(alea(34)), alea(34));
  bocal.fs.$carac = [1, 1, 3, 1, 1, 1]; bocal.carac = bocal.fs.$carac.slice();
  bocal.fs.$hunger = 20; bocal.fs.$moral = 10;
  bocal.entretien(false);
  assert.equal(bocal.fs.$moral, 9, 'le bocal coûte un point de moral par nuit');

  const libre = new F.Fee(F.genererGraine(alea(35)), alea(35));
  libre.fs.$carac = [1, 1, 3, 1, 1, 1]; libre.carac = libre.fs.$carac.slice();
  libre.fs.$hunger = 20; libre.fs.$moral = 1;
  const r = libre.entretien(true);
  assert.equal(r.partie, true, 'à un de moral, même remontée à deux, elle s\'en va');
  assert.ok(r.messages.some((m) => /enfuie pendant la nuit/.test(m)));
});

test('libre et heureuse, son moral remonte jusqu\'à dix', () => {
  const fee = new F.Fee(F.genererGraine(alea(36)), alea(36));
  fee.fs.$carac = [1, 1, 3, 1, 1, 1]; fee.carac = fee.fs.$carac.slice();
  fee.fs.$hunger = 20; fee.fs.$moral = 5;
  fee.entretien(true);
  assert.equal(fee.fs.$moral, 6);
  fee.fs.$moral = 12;
  fee.fs.$hunger = 20;
  fee.entretien(true);
  assert.equal(fee.fs.$moral, 12, 'au-delà de dix, elle ne remonte plus toute seule');
});

// ── Se battre ─────────────────────────────────────────────────────────────

test('sans vie ni moral, elle reste au bocal', () => {
  const fee = new F.Fee(F.genererGraine(alea(41)), alea(41));
  fee.fs.$life = 1; fee.fs.$moral = 1;
  assert.equal(fee.preteAuCombat(), true);
  fee.fs.$life = 0;
  assert.equal(fee.preteAuCombat(), false);
  fee.fs.$life = 1; fee.fs.$moral = 0;
  assert.equal(fee.preteAuCombat(), false);
});

test('engourdie ou malade, elle ne se bat pas non plus', () => {
  const fee = new F.Fee(F.genererGraine(alea(42)), alea(42));
  fee.fs.$life = 3; fee.fs.$moral = 10;
  fee.fs.$mood = [];
  assert.equal(fee.preteAuCombat(), true);
  fee.fs.$mood[F.ENGOURDIE] = 1;
  assert.equal(fee.preteAuCombat(), false);
  fee.fs.$mood = []; fee.fs.$mood[F.MALADE] = 1;
  assert.equal(fee.preteAuCombat(), false);
});

test('la vie et le mana restent dans leurs bornes', () => {
  const fee = new F.Fee(F.genererGraine(alea(43)), alea(43));
  fee.carac = [1, 1, 4, 1, 1, 3];
  fee.incVie(100); assert.equal(fee.fs.$life, 4);
  fee.incVie(-100); assert.equal(fee.fs.$life, 0);
  fee.incMana(100); assert.equal(fee.fs.$mana, 6, 'mana × 2');
  fee.incMana(-100); assert.equal(fee.fs.$mana, 0);
});

// ── Ce que le client en fait ──────────────────────────────────────────────

test('la fée dit au client comment la dessiner', () => {
  const graine = F.genererGraine(alea(51));
  graine.$skin = [3, 0xFF0000, 0x00FF00, 0x0000FF];
  const fee = new F.Fee(graine, alea(51));
  assert.deepEqual(fee.apparence(), { num: 3, couleurs: [0xFF0000, 0x00FF00, 0x0000FF] });
});

test('le client colore chaque morceau du portrait comme Mc.setPic', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  // Les huit sous-clips que le jeu colore, et leur couleur.
  assert.match(src, /'f\.k0', 'f\.k1', 'f\.k2'/, 'les cheveux prennent la première couleur');
  assert.match(src, /'f\.o0\.p', 'f\.o1\.p', 'f\.cloth'/, 'les yeux et la robe la deuxième');
  assert.match(src, /'f\.w0', 'f\.w1'/, 'les ailes la troisième');
  // Et ces noms existent VRAIMENT dans les dessins extraits.
  const sprites = require(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'));
  const noms = new Set();
  for (const e of sprites.portrait.etats) for (const p of e.pieces) if (p.nom) noms.add(p.nom);
  for (const n of ['f.k0', 'f.w0', 'f.cloth', 'f.o0.p']) {
    assert.ok(noms.has(n), `le dessin porte bien ${n} (trouvés : ${[...noms].join(', ')})`);
  }
});

test('la concentration de la fée décide combien de pièces on voit venir', () => {
  // inter.Face.setFaerie : nextLimit = floor(carac[WISDOM] * 0.5).
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /Math\.floor\(\(fee\.carac\[CONCENTRATION\] \|\| 0\) \* 0\.5\)/);
  assert.match(src, /FACE_ECHELLE = 0\.70/, 'et le cadre du portrait est à 70 %');
});

test('la page charge le module des fées et le passe au client', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /src="\/minipixiz\/faerie\.js"/);
  assert.match(html, /new window\.MinipixizFee\.Fee\(fs\)/, 'la fée vient de la fiche');
  assert.match(html, /coefNuit\(\)/, 'et l\'heure du jeu suit $time.$s');
  assert.match(html, /width="240" height="240"/, 'la scène fait 240 × 240, comme Cs.mcw');
});
