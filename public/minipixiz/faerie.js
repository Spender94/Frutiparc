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
// Cs.HYPOCONDREAC — l'upkeep le lit, mais genFaerieSeed ne le tire jamais : il
// dort dans le fichier, seule une ligne de mise au point le posait. On le garde
// pour que le code dise la même chose que l'original.
const HYPOCONDRIE = 5;
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

  new Fee(fs, alea, null).preparerProchainNiveau();
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
  /**
   * @param {object} fs    la graine, telle qu'elle vit dans la fiche
   * @param {function} [alea]
   * @param {object} [carte] la fiche du joueur — nécessaire pour que les objets
   *                 de SON sac (globes, grimoires) profitent aussi à la fée
   */
  constructor(fs, alea, carte) {
    this.fs = fs;
    this.alea = alea;
    this.carac = (fs.$carac || []).slice();
    this.sorts = (fs.$spell || []).slice();
    this.pouvoirs = [];               // FaerieInfo.sPow
    this.couleurCheveux = null;       // posée par une coloration portée
    this.messages = [];               // ce que Manager.addMsg aurait dit
    this.initItems(carte);
  }

  /**
   * FaerieInfo.initItems — rejoue les effets de tout ce qu'elle porte, et de
   * tout ce que le joueur garde dans son propre sac.
   *
   *     pour chaque objet de fs.$inv          → it.faerieEffect()
   *     pour chaque objet de Cm.card.$inv     → it.groupEffect(this)
   *
   * Rien de tout cela n'est écrit dans la fiche : les effets se recalculent à
   * chaque chargement. C'est ce qui fait qu'il n'y a pas d'« équiper » dans ce
   * jeu — porter suffit, et reposer l'objet annule le bonus.
   */
  initItems(carte) {
    const O = (typeof module !== 'undefined' && module.exports)
      ? require('./items.js')
      : racine.MinipixizObjets;
    if (!O) return;
    for (const n of (this.fs.$inv || [])) {
      const it = O.info(n);
      if (it) O.effetPorte(it, this);
    }
    for (const n of ((carte && carte.$inv) || [])) {
      const it = O.info(n);
      if (it) O.effetGroupe(it, this);
    }
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
  entretien(libre, ctx) {
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

    // Ce qui suit demande de connaître les AUTRES fées : on ne le fait donc que
    // si l'appelant a passé la fiche du joueur.
    if (ctx && ctx.carte) {
      this.jouerLesTravers(ctx);
      this.tirerLHumeur(ctx);
    }

    return { partie: false, messages: this.messages };
  }

  /**
   * Les travers de caractère, une fois la nuit tombée. Ils sont rares — une fée
   * sur soixante est cleptomane, une sur cent cannibale — mais ce sont eux
   * qu'on raconte. Ils n'agissent qu'entre fées LIBRES : une fée en mission est
   * ailleurs.
   */
  jouerLesTravers(ctx) {
    const bl = this.fs.$behaviour || [];
    for (let i = 0; i < bl.length; i++) {
      if (bl[i] !== 1) continue;
      switch (i) {
        case PSYCHANALYSTE:
          if (ctx.entier(5) === 0) this.psychanalyser(ctx);
          break;
        case CANNIBALISME:
          if (nombre(this.fs.$hunger) === 0 && nombre(this.fs.$life) <= 1) this.devorer(ctx);
          break;
        case CLEPTOMANIE:
          if (ctx.entier(3) === 0) this.voler(ctx);
          break;
        case APATHIE:
          break;                        // son effet est dans l'humeur
        case SCHIZOPHRENIE:
          if (ctx.entier(10) === 0) this.echangerSesCaracs();
          break;
        default: break;
      }
    }
  }

  // Les sœurs disponibles, dans un ordre brassé (Tools.shuffle).
  soeurs(ctx) {
    const l = (ctx.carte.$faerie || []).filter((o) => o !== this.fs && o.$mission === null);
    for (let i = l.length - 1; i > 0; i--) {
      const j = ctx.entier(i + 1);
      const t = l[i]; l[i] = l[j]; l[j] = t;
    }
    return l;
  }

  // CANNIBALISME : elle ne s'en prend qu'à plus faible qu'elle, et il lui faut
  // le DOUBLE de niveau pour y arriver. Sinon, elle essaie et le raconte.
  devorer(ctx) {
    for (const fso of this.soeurs(ctx)) {
      if (nombre(this.fs.$level) > nombre(fso.$level) * 2) {
        this.dire(this.fs.$name + ' a dévoré ' + fso.$name + ', elle se sent beaucoup mieux à présent.');
        this.fs.$hunger = nombre(this.fs.$hunger) + 15;
        ctx.effacer(fso);
        return;
      }
      if (nombre(this.fs.$level) > nombre(fso.$level)) {
        this.dire(this.fs.$name + ' a tellement faim qu\'elle a essayé de manger ' + fso.$name + ' !!');
        return;
      }
    }
  }

  // CLEPTOMANIE : elle ÉCHANGE un objet — la victime perd le sien et récupère
  // ce que la voleuse avait dans la case visée, souvent rien.
  voler(ctx) {
    for (const fso of this.soeurs(ctx)) {
      let i0 = null, i1 = null;
      for (let n = 0; n < nombre(this.fs.$bagMax); n++) {
        if (i0 === null || !this.fs.$inv[n]) i0 = n;
      }
      for (let n = 0; n < nombre(fso.$bagMax); n++) {
        if (fso.$inv[n] !== null && fso.$inv[n] !== undefined) i1 = n;
      }
      if (i1 === null || i0 === null) continue;
      const id0 = this.fs.$inv[i0];
      const id1 = fso.$inv[i1];
      this.fs.$inv[i0] = id1;
      fso.$inv[i1] = (id0 === undefined) ? null : id0;
      this.dire('Pendant la nuit, ' + fso.$name + ' a perdu l\'objet suivant : '
        + ctx.nomObjet(id1) + '.');
      return;
    }
  }

  /**
   * PSYCHANALYSTE : elle devine les travers de ses sœurs et les annonce.
   *
   * PSY_BOUCLE_INFINIE — l'original écrit `for(var n=1; n<fso.$behaviour.length; i++)`
   * et incrémente `i` au lieu de `n` : la boucle ne se termine jamais et le jeu
   * se fige dès qu'une psychanalyste côtoie une autre fée. On corrige, avec en
   * prime le travers 0 (que le `n=1` sautait) et une seule annonce par sœur.
   */
  psychanalyser(ctx) {
    for (const fso of this.soeurs(ctx)) {
      const bl = fso.$behaviour || [];
      for (let n = 0; n < bl.length; n++) {
        if (bl[n] !== 1) continue;
        this.dire(this.fs.$name + ' pense avoir décelé en ' + fso.$name
          + ' une forme de ' + NOM_COMPORTEMENT[n] + '.');
      }
    }
  }

  // SCHIZOPHRÉNIE : ses six caractéristiques permutent en bloc, force contre
  // intelligence. Une fée schizophrène n'est jamais la même deux jours de suite.
  echangerSesCaracs() {
    const l = this.fs.$carac.slice();
    for (let i = 0; i < 6; i++) this.fs.$carac[i] = nombre(l[(i + 3) % 6]);
    this.carac = this.fs.$carac.slice();
  }

  /**
   * L'humeur du matin. Une fée engourdie ou malade ne se bat pas de la journée
   * (isReadyForBattle) : c'est le seul aléa qui puisse gâcher une partie prévue.
   * L'apathie et l'hypocondrie la ramènent un jour sur trois, sans tirage.
   */
  tirerLHumeur(ctx) {
    const fs = this.fs;
    const bl = fs.$behaviour || [];
    const jour = nombre(ctx.jour);
    fs.$mood = [];
    if (ctx.entier(30) === 0) {
      this.dire(ctx.choisir([
        fs.$name + ' est un peu endormie aujourd\'hui !',
        fs.$name + ' a un peu trop fait la fête hier soir.',
        fs.$name + ' n\'a pas réussi à fermer l\'œil de la nuit.',
        fs.$name + ' a du mal à se réveiller ce matin.',
        fs.$name + ' n\'a pas du tout la forme ce matin.',
      ]));
      fs.$mood[ENGOURDIE] = 1;
    } else if (bl[APATHIE] === 1 && jour % 3 === 0) {
      this.dire(fs.$name + ' est un peu endormie aujourd\'hui !');
      fs.$mood[ENGOURDIE] = 1;
    }
    if (ctx.entier(50) === 0) {
      this.dire(ctx.choisir([
        fs.$name + ' ne se sent pas très bien aujourd\'hui.',
        fs.$name + ' n\'est pas dans son assiette ce matin.',
        fs.$name + ' est malade aujourd\'hui, elle ne pourra pas vous aider.',
        fs.$name + ' semble avoir de la fièvre ce matin.',
      ]));
      fs.$mood[MALADE] = 1;
    } else if (bl[HYPOCONDRIE] === 1 && jour % 3 === 1) {
      this.dire(fs.$name + ' ne se sent pas très bien aujourd\'hui.');
      fs.$mood[MALADE] = 1;
    }
  }

  // Ce qu'il faut au client pour la dessiner.
  apparence() {
    const p = this.fs.$skin || [];
    // it.Color.faerieEffect écrit `fi.skin.col1` : une coloration portée
    // remplace la couleur de cheveux, sans toucher à la fiche.
    const cheveux = (this.couleurCheveux === null || this.couleurCheveux === undefined)
      ? nombre(p[1]) : this.couleurCheveux;
    return {
      num: nombre(p[0]) % 6,
      couleurs: [cheveux, nombre(p[2]), nombre(p[3])],
    };
  }

  /**
   * getMsgTaste — ce qu'elle aime et ce qu'elle déteste, dit avec ses mots.
   * C'est le texte que le jeu affiche quand on la regarde, et c'est par lui
   * qu'on apprend quoi lui donner.
   */
  gouts() {
    const O = (typeof module !== 'undefined' && module.exports)
      ? require('./items.js') : racine.MinipixizObjets;
    const nom = (n) => (O && O.QUANTITE[n]) || 'ça';
    const liste = (l) => l.map(nom).reduce((s, v, i) => {
      if (i === 0) return v;
      return s + (i === l.length - 1 ? ' et ' : ', ') + v;
    }, '');
    const aime = (this.fs.$taste && this.fs.$taste[0]) || [];
    const deteste = (this.fs.$taste && this.fs.$taste[1]) || [];
    let str = '';
    if (aime.length) str += this.fs.$name + ' aime ' + liste(aime) + '. ';
    if (deteste.length) {
      str += (aime.length ? 'Elle ' : this.fs.$name + ' ') + 'déteste ' + liste(deteste) + '.';
    }
    return str.trim();
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
      pouvoirs: this.pouvoirs.slice(),
      sorts: this.sorts.slice(),
      prete: this.preteAuCombat(),
    };
  }
}

const API = {
  Fee, genererGraine, genererNom, enrichirGraine,
  CARAC, NOM_CARAC, NB_CARAC, CARAC_MAX, NIVEAU_MAX,
  NOM_COMPORTEMENT, RARETE_COMPORTEMENT,
  PSYCHANALYSTE, CANNIBALISME, CLEPTOMANIE, APATHIE, SCHIZOPHRENIE, HYPOCONDRIE,
  ENGOURDIE, MALADE, SYLLABES_1, SYLLABES_2,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizFee = API;

})(typeof window !== 'undefined' ? window : globalThis);
