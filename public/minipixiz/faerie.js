/*
 * Minipixiz — les fées.
 *
 * Une fée n'est pas un compteur de plus : c'est le personnage du jeu. Elle a un
 * nom tiré au sort, six caractéristiques, un portrait, des goûts, parfois un
 * travers de caractère ; elle mange, s'ennuie, monte de niveau, apprend des
 * sorts, et finit par s'en aller si on la néglige. Tout le reste du jeu — le
 * bassin qui en fait apparaître une, le donjon qu'on ne peut affronter sans
 * elle, les missions — tourne autour d'elle.
 *
 * Ce fichier porte Cm.genFaerieSeed, FaerieSeed et FaerieInfo.
 *
 * ── Deux écarts assumés, tous deux vérifiés par un test ──
 *
 * 1. SETNEXTLEVELUP_HUIT_CARAC. FaerieInfo.setNextLevelUp tire la
 *    caractéristique à améliorer avec `Std.random(8)`. Or il n'y en a que SIX
 *    (Cs.POWER…Cs.MANA, et it.Carac.carNameList en compte six). Un tirage sur
 *    quatre désignait donc une case qui n'existe pas : la montée de niveau ne
 *    donnait rien, et `fs.$carac[6]++` inscrivait un NaN dans la fiche — une fée
 *    dont la caractéristique devient NaN a une barre de vie vide et ne peut plus
 *    se battre. C'est l'un des « fées cassées » remontés. On tire donc parmi les
 *    six vraies.
 *
 * 2. UPKEEP_MORAL_PLANCHER. upkeep() décrémente $moral puis le remet à zéro
 *    s'il est négatif — mais teste `$moral < 3` AVANT ce redressement. L'ordre
 *    est conservé tel quel : c'est ce qui fait qu'une fée peut s'enfuir. On ne
 *    change que ce qui casse, pas ce qui est dur.
 */
'use strict';

(function (racine) {

// ── Les six caractéristiques (Cs) ─────────────────────────────────────────
const FORCE = 0, RAPIDITE = 1, VIE = 2, INTELLIGENCE = 3, CONCENTRATION = 4, MANA = 5;
const CARAC = { FORCE, RAPIDITE, VIE, INTELLIGENCE, CONCENTRATION, MANA };
const NB_CARAC = 6;                   // it.Carac.carNameList — six, pas huit
const CARAC_MAX = 7;                  // setNextLevelUp : on n'améliore pas au-delà
const NIVEAU_MAX = 50;                // Cs.FAERIE_LEVEL_MAX

const NOM_CARAC = ['force', 'rapidité', 'vie', 'intelligence', 'concentration', 'mana'];

// ── Les travers de caractère (Cs.PSYCHOANALYST…) ──────────────────────────
const PSYCHANALYSTE = 0, CANNIBALISME = 1, CLEPTOMANIE = 2, APATHIE = 3, SCHIZOPHRENIE = 4;
const NOM_COMPORTEMENT = ['psychanalyste', 'cannibalisme', 'cleptomanie', 'apathie', 'schizophrénie'];

// Leur rareté, telle que genFaerieSeed la tire : une chance sur N.
const RARETE_COMPORTEMENT = [80, 100, 60, 60, 100];

// ── Les humeurs qui empêchent de se battre (Cs.M_NUMB / M_DISEASE) ────────
const ENGOURDIE = 0, MALADE = 1;

// ── Le nom (Lang.nameSyl0 / nameSyl1) ─────────────────────────────────────
// Le jeu range ses chaînes préfixées d'un « $ » et le retire à la lecture
// (`substring(1)`) : une astuce de sérialisation, pas une partie du nom.
const SYLLABES_1 = [
  'Al', 'Ami', 'Fri', 'Aphro', 'Gili', 'Ho', 'Game', 'Ali', 'Sisi', 'Nami', 'Gi',
  'Mali', 'Pi', 'Aso', 'Ni', 'Aho', 'Cyn', 'Mo', 'Dani', 'Ju', 'Sou', 'Li',
  'Chomi', 'Kolchi', 'Chi', 'Kumi', 'Yari', 'Za', 'Pi', 'Gami', 'Soli', 'Bama',
  'Lumi', 'Api', 'Sumi', 'Dama', 'Jima', 'Magi', 'Tosta', 'Sandi', 'Sulme', 'Go', 'Hi',
];
const SYLLABES_2 = [
  'meria', 'ana', 'kine', 'ne', 'line', 'am', 'yim', 'lia', 'milie', 'lie',
  'gine', 'a', 'ka', 'ma', 'dine', 'e', 'ria', 'lyne', 'cie', 'nia', 'dea',
  'mone', 'gone',
];

// ── Les aliments, pour les goûts ──────────────────────────────────────────
// $taste = [ ce qu'elle aime, ce qu'elle déteste ], en indices d'aliment.
const NB_ALIMENTS_COURANTS = 5;       // les cinq premiers sont les aliments de base

const borner = (min, v, max) => Math.max(min, Math.min(v, max));
const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Le tirage du jeu : Std.random(n) = un entier de 0 à n-1, Math.random() = un
// réel. Les deux viennent du même générateur pour qu'une graine donne toujours
// la même fée.
function tirages(alea) {
  const reel = alea || Math.random;
  return { reel, entier: (n) => Math.floor(reel() * n) };
}

function genererNom(alea) {
  const { entier } = tirages(alea);
  return SYLLABES_1[entier(SYLLABES_1.length)] + SYLLABES_2[entier(SYLLABES_2.length)];
}

/**
 * Cm.genFaerieSeed — une fée toute neuve.
 *
 * Elle naît avec un en tout ; c'est le bassin qui la rend exceptionnelle, en
 * lui ajoutant des points avant de la déposer (voir enrichirGraine).
 *
 * @param {function} [alea] le tirage, pour un résultat reproductible
 */
function genererGraine(alea) {
  const { reel, entier } = tirages(alea);

  const fs = {
    $name: genererNom(reel),
    $humor: entier(8),
    $carac: [1, 1, 1, 1, 1, 1],
    // num : lequel des six corps ; puis trois couleurs libres.
    $skin: [entier(6), entier(0xFFFFFF), entier(0xFFFFFF), entier(0xFFFFFF)],
    $mood: [],
    $next: [0, 0],
    $pos: null,
    $level: 0,
    $exp: 0,
    $hunger: 4,
    $moral: 10,
    $shot: 0,
    // Tout le monde commence avec la boule de lumière (20) et l'échange (0).
    $spell: [20, 0],
    $spellCoef: [],
    $taste: [],
    $behaviour: [],
    $inv: [],
    $mission: null,
    $bagMax: 2,
    $life: 0,
    $mana: 0,
  };
  fs.$life = Math.ceil(fs.$carac[VIE]);
  fs.$mana = fs.$carac[MANA] * 2;

  // GOÛTS — chaque goût de plus est bien plus rare que le précédent : la table
  // fait qu'une fée à trois préférences est déjà remarquable.
  const table = [1.1, 2, 8, 40, 100, 1000];
  const aime = [], deteste = [];
  while (reel() * table[aime.length] < 1) {
    let n = entier(NB_ALIMENTS_COURANTS);
    if (entier(100) > 0) n += 5;      // presque toujours un aliment rare
    if (aime.indexOf(n) < 0) aime.push(n);
  }
  while (reel() * table[deteste.length] < 1) {
    let n = entier(NB_ALIMENTS_COURANTS);
    if (entier(30) === 0) n += 5;
    if (aime.indexOf(n) < 0 && deteste.indexOf(n) < 0) deteste.push(n);
  }
  fs.$taste = [aime, deteste];

  // TRAVERS DE CARACTÈRE — rares, et c'est ce qui rend chaque fée mémorable.
  for (let i = 0; i < RARETE_COMPORTEMENT.length; i++) {
    if (entier(RARETE_COMPORTEMENT[i]) === 0) fs.$behaviour[i] = 1;
  }

  new Fee(fs, alea).preparerProchainNiveau();
  return fs;
}

/**
 * Cm.upkeep, branche du bassin : la fée qui dort au fond gagne des avantages
 * selon l'ancienneté de la partie.
 *
 *     q = borner(0, pow(random($time.$d), 0.3) - 1, 5)
 *
 * puis q tirages : presque toujours un point de caractéristique, une fois sur
 * cent une PLACE DE SAC EN PLUS (le fameux « atlas »), qui coûte deux tirages.
 */
function enrichirGraine(fs, jour, alea) {
  const { reel, entier } = tirages(alea);
  const q = Math.floor(borner(0, Math.pow(entier(Math.max(1, nombre(jour))), 0.3) - 1, 5));
  for (let i = 0; i < q; i++) {
    if (reel() > 0.99 && i < q + 1) { i++; fs.$inv.push(null); }
    else fs.$carac[entier(NB_CARAC)]++;
  }
  fs.$life = Math.ceil(fs.$carac[VIE]);
  fs.$mana = fs.$carac[MANA] * 2;
  return q;
}

/**
 * FaerieInfo — la fée vivante, autour de sa graine.
 *
 * `fs` est ce qui est écrit dans la fiche ; tout le reste se recalcule.
 */
class Fee {
  constructor(fs, alea) {
    this.fs = fs;
    this.alea = alea;
    this.carac = (fs.$carac || []).slice();
    this.sorts = (fs.$spell || []).slice();
    this.messages = [];               // ce que Manager.addMsg aurait dit
  }

  dire(texte) { this.messages.push(texte); }

  // ── Les bornes (FaerieInfo.inc*) ──
  vieMax() { return nombre(this.carac[VIE]); }
  manaMax() { return nombre(this.carac[MANA]) * 2; }

  incVie(n) { this.fs.$life = Math.round(borner(0, nombre(this.fs.$life) + n, this.vieMax())); }
  incMana(n) { this.fs.$mana = Math.round(borner(0, nombre(this.fs.$mana) + n, this.manaMax())); }
  incMoral(n) { this.fs.$moral = Math.round(borner(0, nombre(this.fs.$moral) + n, 20)); }
  incFaim(n) { this.fs.$hunger = Math.round(borner(0, nombre(this.fs.$hunger) + n, 20)); }
  incExp(n) { this.fs.$exp = nombre(this.fs.$exp) + n; }

  // ── L'expérience ──
  // getNextExpLimit : (niveau+1)² × 50. Le premier niveau coûte 50 points, le
  // dixième 5 000 : la courbe est ce qui rend une fée de niveau 15 précieuse.
  limiteExp() { return Math.pow(nombre(this.fs.$level) + 1, 2) * 50; }
  peutMonter() { return nombre(this.fs.$exp) >= this.limiteExp() && nombre(this.fs.$level) < NIVEAU_MAX; }

  /**
   * setNextLevelUp — ce que la fée apprendra à sa prochaine montée : une
   * caractéristique OU un sort, au choix du joueur.
   *
   * @param {function} [sortDisponible] tire un sort qu'elle ne connaît pas
   */
  preparerProchainNiveau(sortDisponible) {
    const { entier } = tirages(this.alea);

    // Le sort : on retire tant qu'il est déjà connu, avec le même garde-fou de
    // cent essais que l'original.
    let sid = null;
    if (sortDisponible) {
      for (let t = 0; t < 100; t++) {
        sid = sortDisponible(this);
        if (sid === null || this.fs.$spell.indexOf(sid) < 0) break;
      }
    }

    // SETNEXTLEVELUP_HUIT_CARAC — voir l'en-tête : l'original tire sur huit
    // pour six caractéristiques.
    let cid = 0;
    for (let t = 0; t < 100; t++) {
      cid = entier(NB_CARAC);
      if (nombre(this.fs.$carac[cid]) < CARAC_MAX) break;
    }

    this.fs.$next = [cid, sid];
    return this.fs.$next;
  }

  /**
   * levelUp(n) — 0 pour la caractéristique, 1 pour le sort.
   * Monter de niveau remonte le moral de quatre : c'est une bonne journée.
   */
  monterNiveau(choix, sortDisponible) {
    this.incMoral(4);
    const cout = this.limiteExp();
    if (nombre(this.fs.$exp) < cout) return null;
    this.fs.$exp -= cout;
    this.fs.$level = nombre(this.fs.$level) + 1;

    let appris = null;
    if (choix === 1 && this.fs.$next[1] !== null && this.fs.$next[1] !== undefined) {
      const sid = this.fs.$next[1];
      this.fs.$spell.push(sid);
      this.sorts.push(sid);
      appris = { genre: 'sort', id: sid };
    } else {
      const car = this.fs.$next[0];
      this.fs.$carac[car] = nombre(this.fs.$carac[car]) + 1;
      this.carac[car] = nombre(this.carac[car]) + 1;
      appris = { genre: 'carac', id: car, nom: NOM_CARAC[car] };
    }
    this.preparerProchainNiveau(sortDisponible);
    return appris;
  }

  /**
   * eat(id) — la nourrir. C'est le geste central du jeu : ça la rassasie, ça
   * compte pour l'album (Cm.incEatStat), et ça lui plaît ou non.
   *
   * @returns {{eat:number, moral:number}} de quoi mettre $stat.$eat à jour
   */
  manger(id) {
    this.incFaim(4);
    const n = nombre(id);
    let moral = 0;
    // Les aliments rares (10 et plus) font toujours plaisir.
    if ((this.fs.$taste[0] || []).indexOf(n) >= 0 || n >= 10) { this.incMoral(3); moral = 3; }
    if ((this.fs.$taste[1] || []).indexOf(n) >= 0) { this.incMoral(-3); moral -= 3; }
    return { eat: n, moral };
  }

  // isReadyForBattle : sans vie ni moral, elle reste au bocal — et une fée
  // engourdie ou malade non plus ne se bat.
  preteAuCombat() {
    if (!(nombre(this.fs.$life) > 0 && nombre(this.fs.$moral) > 0)) return false;
    const h = this.fs.$mood || [];
    return !(h[ENGOURDIE] === 1 || h[MALADE] === 1);
  }

  /**
   * upkeep — ce qui arrive à la fée pendant la nuit. Appelé une fois par jour
   * écoulé (Cm.updateTime).
   *
   * @param {boolean} libre  vraie si elle n'est PAS enfermée dans un bocal
   *                         (Cm.card.$current != son index)
   * @returns {{partie:boolean, messages:string[]}}
   */
  entretien(libre) {
    this.messages = [];
    const fs = this.fs;

    // Elle se régénère à hauteur de ce qu'elle a mangé : une fée à jeun ne
    // récupère rien, et finit par mourir.
    const vieMax = Math.ceil((nombre(fs.$hunger) / 20) * this.vieMax());
    fs.$life = Math.max(nombre(fs.$life), vieMax);
    if (vieMax === 0) {
      if (nombre(fs.$life) > 0) {
        this.dire(fs.$name + ' a vraiment très faim !');
        fs.$life--;
      } else {
        this.dire(libre
          ? fs.$name + ' s\'est enfuie car elle avait trop faim !'
          : fs.$name + ' est morte de faim dans son bocal...');
        return { partie: true, messages: this.messages };
      }
    } else if (nombre(fs.$hunger) < 10) {
      this.dire(fs.$name + ' a faim !');
    }

    // La faim descend de quatre par nuit : il faut la nourrir souvent.
    fs.$hunger = nombre(fs.$hunger) - 4;
    if (fs.$hunger <= 0) { fs.$hunger = 0; fs.$moral = nombre(fs.$moral) - 1; }

    // Enfermée, elle déprime ; libre, elle se remet — mais peut s'enfuir.
    if (!libre) {
      fs.$moral = nombre(fs.$moral) - 1;
    } else {
      if (nombre(fs.$moral) < 10) fs.$moral = nombre(fs.$moral) + 1;
      // UPKEEP_MORAL_PLANCHER : le test précède le redressement à zéro.
      if (nombre(fs.$moral) < 3) {
        this.dire(fs.$name + ' s\'est enfuie pendant la nuit !');
        return { partie: true, messages: this.messages };
      }
    }
    if (nombre(fs.$moral) <= 0) fs.$moral = 0;

    return { partie: false, messages: this.messages };
  }

  // Ce qu'il faut au client pour la dessiner.
  apparence() {
    const p = this.fs.$skin || [];
    return {
      num: nombre(p[0]) % 6,
      couleurs: [nombre(p[1]), nombre(p[2]), nombre(p[3])],
    };
  }

  // Un résumé lisible, pour l'interface.
  etat() {
    return {
      nom: this.fs.$name,
      niveau: nombre(this.fs.$level),
      exp: nombre(this.fs.$exp),
      prochain: this.limiteExp(),
      vie: nombre(this.fs.$life), vieMax: this.vieMax(),
      mana: nombre(this.fs.$mana), manaMax: this.manaMax(),
      faim: nombre(this.fs.$hunger),
      moral: nombre(this.fs.$moral),
      carac: this.carac.slice(),
      prete: this.preteAuCombat(),
    };
  }
}

const API = {
  Fee, genererGraine, genererNom, enrichirGraine,
  CARAC, NOM_CARAC, NB_CARAC, CARAC_MAX, NIVEAU_MAX,
  NOM_COMPORTEMENT, RARETE_COMPORTEMENT,
  PSYCHANALYSTE, CANNIBALISME, CLEPTOMANIE, APATHIE, SCHIZOPHRENIE,
  ENGOURDIE, MALADE, SYLLABES_1, SYLLABES_2,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizFee = API;

})(typeof window !== 'undefined' ? window : globalThis);
