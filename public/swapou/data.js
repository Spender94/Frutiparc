/*
 * Swapou 2 — textes du jeu (Data.as) : répliques de versus (taunts) et
 * scénario du mode Pot au feu. Transcrits du source AS2 (encodage cp1252
 * d'origine ré-accentué).
 *
 * Entrées du scénario :
 *   { txt }                      — narration (TXTONLY)
 *   { txt, face, state, bg, left } — dialogue (PERSOTALK / HERO=-1 /
 *                                    FRIEND=-2 / OPP=-3)
 *   { movie: n }                 — cinématique (CINEMATIK)
 *   { loop: 'nom' }              — musique d'ambiance (PLAYLOOP)
 *   { stop: true }               — STOPLOOP
 *   { walk: 'scenario'|'poivre'|'wasabii' } — déplacement sur la carte
 */
'use strict';

const SwapouData = (function () {
  function T(txt) { return { left: undefined, txt: txt, face: 0, state: 0, bg: 0 }; }
  function P(perso, state, bg, txt) { return { left: false, txt: txt, face: perso, state: state, bg: bg }; }
  function HERO(state, bg, txt) { return P(-1, state, bg, txt); }
  function FRIEND(state, bg, txt) { return P(-2, state, bg, txt); }
  function OPP(state, bg, txt) { return P(-3, state, bg, txt); }
  function CIN(n) { return { movie: n }; }
  function LOOP(n) { return { loop: n }; }
  const WALK = { walk: 'scenario' };
  const POIVRE_WALK = { walk: 'poivre' };
  const WASABII_WALK = { walk: 'wasabii' };

  const TAUNT_QUESTION = [
    [ // Dimitri
      "Abandonne ! tu n'as aucune chance contre moi !",
      "Tu es sur mon terrain ! déclare forfait, ou tu en paieras les conséquences !",
      "Je vais t'écraser.",
      "Viens te battre !",
      "Tu crois pouvoir me battre ?!",
      "Finissons-en, j'ai pas que ça à faire.",
    ],
    [ // Natacha
      "Qui est cet affreux personnage ?",
      "Je vais devoir affronter cette... chose ?",
      "Je sens comme une odeur...",
      "Ils sont pourris les fruits ou quoi ?",
      "Allez, bonne chance, t'en auras besoin...",
      "Prépare-toi à avoir des pépins.",
    ],
    [ // Sel
      "Je vais ga-gagner !",
      "Tu-tu va pe-perdre !",
      "Ata-ta-tention à te-toi !",
      "Pa-par la pui-puissance sa-saline !",
      "On-on y va ?",
    ],
    [ // Poivre
      "Allez hop !",
      "Vite vite amène tes fruits par ici !",
      "Dépêche toi, je suis pressé !",
      "Non mais tu as vu l'heure ? En retard pour un combat !?!",
      "Tu vas les presser tes fruits !?",
      "Avec moi c'est vite fait bien fait, tu vas pas sentir passer ta défaite.",
      "Allez, amène ta fraise... haha !",
    ],
    [ // Moutarde
      "Je te laisse dix secondes pour changer d'avis. Après il sera trop tard !",
      "Tu veux te mesurer à moi ? Laisse tomber tu n'es pas de taille face à ma maille.",
      "Un pas de plus, et tu prends ta baffe !",
      "Tu vas finir en compote.",
      "Tu tiens vraiment à te faire écraser ?",
      "Tu le vois ce presse-agrumes ?",
      "T'inquiète pas, ça va juste piquer un peu.",
      "Me prends pas à la légère.",
    ],
    [ // Piment
      "Tel le scorpion gris, je frapperai une fois et serai sans pitié.",
      "Il est encore temps pour toi de suivre la voie de la rédemption.",
      "Si tu m'affrontes en bafouant ma Loi, tu périras par ma Loi.",
      "Ecarte toi de mon chemin.",
      "Pour toi Espelette rime avec défaite.",
      "Si tu insistes... Ta fin est proche.",
      "Tu n'auras bientôt que les yeux pour pleurer, pauvre être sans saveur !",
    ],
    [ // Wasabi
      "Bleeh bllobllpommeblub blublub ! aaaaaaah!",
      "Blaaaâââaaah héhéhé! moââe blublubpoire !",
      "Gniiihiiiii pouic blub ! ah ! ah ! aaah !",
      "Graaraaah pourri !!",
      "Pfoudaaaaa !",
    ],
  ];

  const TAUNT_ANSWER = [
    [ // Dimitri
      "C'est un combat gagné d'avance...",
      "Parle toujours, je n'ai pas peur de toi...",
      "Peuh ! une larve de ta carrure ne m'impressionne pas.",
      "Pour qui tu te prends ?",
      "Finissons-en.",
      "Tu rigoleras moins à la fin du combat.",
      "Tu vas regretter d'avoir dit ça !",
      "Assez discuté, bats-toi !",
    ],
    [ // Natacha
      "Oh... charmant. finissons en vite veux-tu ?",
      "Waaah! Trêve de blabla, aligne les fruits !",
      "Comment oses-tu me traiter ainsi ? Bats-toi !",
      "Quelle impertinence !",
      "Ouais, allez, c'est ce qu'on dit.",
      "Ferme ta bouche, c'est insupportable !",
      "Incroyable, tu crois vraiment pouvoir gagner ?",
      "Alors, on se la fait cette partie ?",
    ],
    [ // Sel
      "Arrête-te de te-te mo-moquer de me-moi !",
      "No-non ma-mais ce-c'est bi-bientôt fi-fini !",
      "Je ne-n'ai meu-meme pas pe-peur...",
      "Ah-à l'as-saut, ou-ouais !!",
      "Aïe aïe aïe...",
      "Dé-désolé m-mais je m-me lai-laisserai p-pas f-aire !",
      "En g-gaaarde !",
      "Tu v-vas voir, je suis p-pas un lâ-lâche m-moi !",
      "Qu-qui me p-parle ?!",
    ],
    [ // Poivre
      "Je vais venger mon frère !",
      "A-atchiiiitchoum !",
      "A-atchoum ! J'ai les yeux qui piquent, n'en profite pas !",
      "Bon, on y va maintenant ?",
      "Non mais je rêve ! Tais-toi et bats-toi.",
      "T'as déjà mangé une tarte au poivre ?",
      "Ouais, fais gaffe, le poivrier est aussi une arme contendante.",
      "Je t'attends de pied ferme.",
    ],
    [ // Moutarde
      "Rien ne peut transpercer ma maille !",
      "Laisse tomber, on ne t'a donc pas prévenu que je suis raifort !",
      "Tu ne me laisses pas d'autre choix que de te battre !",
      "Tu m'cherches !?",
      "Cinq minutes, pas plus, et je t'aplatis.",
      "On dirait que tu ne sais pas ce qui t'attend.",
      "T'aime les pommes ? Parcequ'après ça tu pourras manger que de la compote.",
      "Quand t'auras plus de dents, pense aussi à te faire des compotes de poires.",
    ],
    [ // Piment
      "Le pouvoir des anciens parlera pour moi.",
      "Seul le piment touché par la grâce du grand piquant vaincra.",
      "Ainsi parlait le grand piquant.",
      "Ton inconscience te perdra...",
      "Ne sens-tu vraiment pas ta défaite proche ?",
    ],
    [ // Wasabi
      "Graaarrblublub héhé..",
      "Muuhahahaha!",
      "Memmeuhpa kaphuhu héhé !",
      "Guuugnou tartare gueule !",
    ],
  ];

  const TAUNT_WINS = [
    [ // Dimitri
      "Je te l'avais pourtant dit ! Je suis Dimitri l'invincible !",
      "La victoire était déjà mienne.",
      "Tu rampais ? Maintenant retourne dans ton trou !",
      "Lamentable, c'est tout ce que tu sais faire ?",
      "La prochaine fois réfléchis-y à deux fois avant de me défier.",
      "T'as vraiment pas le niveau.",
      "Alors comme ça tu espérais me battre ?!",
    ],
    [ // Natacha
      "Ha !",
      "Hihihihi !",
      "Reviens me voir dans quelques années !",
      "Trop facile !",
      "Alors, c'est pas trop la honte de se faire battre par une fille ?",
      "T'as compris maintenant ?",
      "Allez, sans rancune !",
    ],
    [ // Sel
      "J-j'ai ga-a-gné, you-p-pi !",
      "T-tu as p-perdu je crr-crois!",
      "Ga-gagné ?",
      "Alors ça c'est ch-chou-chouette !",
      "C-c'est d-déjà f-fini ? T'étais n-nul en f-fait ?",
      "Ou-ouf, c-c'était j-juste !",
      "Et n'en r-r-reviens p-pas, mi-mi-minabbble !",
    ],
    [ // Poivre
      "Hahaha c'était un jeu de poivrierre !",
      "Tu as joué ou t'as pété là ?",
      "Maintenant, que j'ai vaincu, tu peux éternuer !",
      "Sens-tu ce goût dans ta bouche ? C'est le goût de la défaite !",
      "Fallait me le dire que tu connaissais pas les règles du jeux.",
      "Bon je suis content, j'ai pas perdu trop de temps.",
      "Suivant !",
      "Allez, reste pas là, tu me fais de la peine.",
    ],
    [ // Moutarde
      "Je te l'avais dit, quand ça me monte au nez, faut pas me chercher !",
      "Comme le disait mon oncle le fameux colonel: il ne te reste que les yeux pour pleurer!",
      "La sauce était un peu trop épicée pour toi manifestement.",
      "Ca va aller ? Tu veux un verre d'eau ? Cours toujours !",
      "Et voilà, tu t'es fait laminer... Mais je t'avais prévenu !",
      "Cette victoire écrasante m'a détendu !",
      "Allez, va t'acheter des compotes !",
    ],
    [ // Piment
      "Je suis bien rouge m'as-tu dit... devant ta défaite te voilà bien vert !",
      "Il ne fallait pas attendre que je te brûle le palais, te voilà maintenant défait !",
      "Tu peux boire toutes les larmes de ta défaite, je continuerai à t'échauffer !",
      "Le dard sacré du scorpion gris n'épargne pas les impudents.",
      "Trouve une autre occupation, les amateurs n'ont pas leur place ici.",
      "Il faudra faire preuve d'une plus grande maîtrise avant de me défier à nouveau.",
      "Je doute que tu parviennes un jour à me battre.",
    ],
    [ // Wasabi
      "Mmmmmhhhhoui hihihi onfonfbou-bhoum !",
      "Krttttttt tsoc pouing, uh-uh uh-uh niourbeuh-euuuj !",
      "Pafpafpoc babam ticprrlllsploc !",
      "Gragragra miarphouloulou !",
    ],
  ];

  const TAUNT_LOOSE = [
    [ // Dimitri
      "Jamais je ne comprendrai comment tu as pu me vaincre.",
      "Moi, me faire battre ? Jamais plus je ne pourrai me regarder dans un miroir.",
      "Impossible! J'étais pourtant le meilleur ??!!",
      "J'enrage !",
      "Je ne me ferai pas avoir deux fois.",
      "Ma technique est pourtant infaillible !",
      "Réééaaaa !!! Tu me le paieras !",
      "Non, ça n'aurait pas dû arriver !",
    ],
    [ // Natacha
      "La chance du débutant !",
      "Je veux une revanche !",
      "Ouin méchant !",
      "Oui, bon, ça va !",
      "J'ai dû me louper quelquepart...",
      "C'était une feinte, maintenant je connais ta technique... Humf!",
      "Pfff, j'ai encore des progrès à faire...",
    ],
    [ // Sel
      "P-pourq-quoi m-moi ?",
      "Oh n-non c'est p-pas v-vrai !",
      "Je s-suis en su-sucre !",
      "V-vengeanche !",
      "Co-comment ce c'est po-possible ?!",
      "Tu tu me le pai-paieras... p-peut-être... ou-oui !",
      "C'est p-pas ju-juste !",
    ],
    [ // Poivre
      "Comment ?! J'ai perd.. atchhahhh.. perdu !",
      "Atcha !",
      "Toi si fade... Tu m'as battu...",
      "Mouais -snirfl- la prochaine fois je me ferai pas avoir aussi facilement.",
      "C'est fini là ? C'est pas possible !!",
      "Pff... J'étais pas assez concentré c'est tout...",
    ],
    [ // Moutarde
      "Qui t'animes, si ce n'est le dieu Ketchup !!",
      "Avorton, comment m'as tu vaincu ?!",
      "Je t'ai sous-estimé.",
      "Je suis très en colère maintenant !",
      "Quelle dextérité !",
      "Ca va, j'ai compris, mais la prochaine fois je ne serai pas aussi doux.",
    ],
    [ // Piment
      "Impossible, tu m'as refroidi ??!!",
      "Où est passé mon piquant oh grand scorpion gris ?",
      "Un jour je te montrerai mon vrai piquant...",
      "C'était un jour sans...",
      "Il est temps de méditer et de réunir mes forces.",
      "Ma technique a perdu de son piquant.",
      "Savoure ta victoire, petit scarabée, la joie sera de courte durée.",
    ],
    [ // Wasabi
      "snourf ahhhhhhhhhhhtzoubhhhh !",
      "orchhkkrouicccscréaaneuhh blorfh !",
      "tarkroskeeeeurghhhhh huf-huf niaeurgghhh !",
      "fgaizgrouki reuheuheu.. snirfl !",
    ],
  ];

  const TXT_SCORE_BATTU = 'vous avez battu votre record !';
  function TXT_VOTRE_SCORE(s) { return 'votre score : ' + s; }
  function TXT_VOTRE_RECORD(s) { return 'votre record personnel : ' + s; }
  function TXT_VOTRE_PLACE(p) { return 'votre classement aujourd\'hui : ' + p; }
  function TXT_PLACE_GAGNEES(p) { return 'vous avez gagné ' + ((p === 1) ? 'une place' : (p + ' places')) + ' dans le classement !'; }

  const SCENARIO = [
    // phase 0 : la rencontre de Monsieur Sel
    [
      LOOP('loop_forest'),
      CIN(0),
      T('Il était une fois, au royaume de Légumia...'),
      T('Natacha et son frère, Dimitri, cultivaient chaque jour leur verger...'),
      T("Ils étaient membres d'une communauté pacifique dont le but était de rendre égaux les fruits et les légumes."),
      T("Cette tâche était particulièrement difficile sachant qu'à Légumia, domaine des légumes salés, les fruits sucrés n'étaient pas forcément les bienvenus."),
      T('Mais la tenacité des jumeaux commencait à\nporter ses fruits...'),
      FRIEND(0, 3, '$# ! $# !'),
      HERO(0, 0, "Qu'y a-t-il $* ?"),
      FRIEND(4, 3, "Ca-y-est ! J'ai enfin réussi à vendre nos premiers fruits !!"),
      HERO(4, 3, 'Vraiment ! Génial !! On a enfin persuadé les Légumiens de goûter à nos bons fruits !'),
      T('Ainsi, petit à petit, les fruits se répandaient au royaume de Légumia, mais cela ne plaisait pas à tout le monde...'),
      CIN(5),
      LOOP('loop_wind'),
      P(8, 0, 4, 'Piquerage ! Il va falloir faire quelque chose pour empêcher cela ! Au nom du Grand Piquant, je vais mener la rébellion !'),
      CIN(1),
      LOOP('loop_forest'),
      T("C'est ainsi qu'un petit matin de printemps..."),
      HERO(3, 1, '$*... nos fruits... ils ont été salés !'),
      FRIEND(0, 0, 'Mais que racontes-tu ?'),
      HERO(3, 1, "Tous nos fruits sont salés, quelqu'un a entièrement volé leur sucre !"),
      FRIEND(3, 1, "C'est affreux !\nMais qu'allons nous faire ?!?"),
      HERO(2, 0, "Ne t'inquiète pas $*, nous allons trouver et démasquer le coupable !"),
      T('Après quelques recherches, Dimitri et Natacha trouvèrent la tanière de celui qui semblait être\nà l\'origine du problème...'),
      T('Le monstrueux Monsieur Sel !!!'),
      HERO(2, 0, 'Allons-y, il se cache dans la Mine !'),
      WALK,
      CIN(2),
      LOOP('loop_forest'),
      OPP(0, 1, 'Que-qui éte-tes ve-vous ?'),
      HERO(2, 0, 'Nous sommes venus reprendre le sucre de nos fruits ! Bats-toi !'),
      OPP(3, 1, 'Combat 1 : Monsieur Sel'),
    ],
    [
      CIN(2),
      LOOP('loop_forest'),
      T('Bravo ! Vous avez vaincu Monsieur Sel, vous allez pouvoir récupérer le sucre volé !'),
      HERO(2, 1, "Rends-toi, tu es vaincu ! Avoue tes crimes : tu as volé le sucre des fruits, n'est-ce pas ?\nOù l'as-tu caché ?"),
      P(2, 5, 1, '(...)'),
      FRIEND(2, 0, "Je pense qu'il a son compte, nous devrons attendre qu'il récupère un peu avant de l'interroger..."),
      P(3, 2, 4, '(poivre magique...)'),
      FRIEND(3, 1, 'AAaaa... Aaaatchoum!!'),
      FRIEND(3, 2, '$# je me sens mal... je... je...'),
      HERO(2, 1, '$* !'),
      FRIEND(2, 4, 'Ahaahahahahah !'),
      HERO(3, 0, "$*, que t'arrive t-il ???"),
      FRIEND(2, 4, 'Bats toi !'),
      HERO(3, 0, 'Non, arrête...'),
      FRIEND(2, 2, 'Combat 2 : la Trahison de $* ?'),
    ],
    [
      CIN(2),
      LOOP('loop_forest'),
      HERO(3, 1, 'Non... $*.... je ne voulais pas'),
      FRIEND(5, 0, 'Pardon, $#, excuse-moi... je... ne... comprends pas...'),
      HERO(3, 1, '$* !'),
      OPP(2, 3, 'Ahahaahahahah ! Mon frère est vengé !'),
      POIVRE_WALK,
      HERO(2, 0, "Attends, ne t'enfuis pas !"),
      HERO(2, 0, "Je ferais mieux de le rattraper, il a l'air de savoir quelquechose..."),
      WALK,
      CIN(3),
      LOOP('loop_fall'),
      HERO(2, 0, 'Ainsi tu te cachais ici, qui es-tu ?'),
      OPP(2, 0, 'Je suis le frère vengeur de Monsieur Sel : mon nom est...'),
      HERO(4, 3, 'Monsieur... Poivre ?'),
      OPP(2, 0, "Comment as-tu deviné ? Tu es moins stupide que tu n'en as l'air... je dois me méfier"),
      OPP(2, 0, "Une fois que je t'aurai éliminé, mon frère sera enfin vengé : bats-toi !"),
      OPP(2, 1, 'Combat 3 : Monsieur Poivre'),
    ],
    [
      CIN(3),
      LOOP('loop_fall'),
      P(3, 5, 1, "aarrg, tu m'as vaincu..."),
      HERO(2, 0, "Qu'as tu donc fait à $* ???"),
      P(3, 5, 1, "Excuse-moi $#, j'avais mal compris tes intentions, j'étais enragé par ce que tu\navais fait subir à mon frère..."),
      HERO(2, 0, 'Et bien, te voilà calmé !'),
      P(3, 5, 1, "Ecoute-moi bien... Monsieur Sel n'est pas responsable du vol du sucre des fruits, il est incapable de faire une telle chose..."),
      HERO(3, 0, 'Que veux tu dire ???'),
      P(3, 5, 1, 'Mon frère est... différent. Il ne ferait pas de mal à une tzongre, crois-moi !'),
      HERO(3, 0, 'Mais alors qui est derrière tout cela ?'),
      P(3, 5, 1, "Suis ce sentier, il te mènera au temple de TomTom, c'est lui le responsable de\ntoute cette histoire..."),
      HERO(2, 0, "TomTom... si c'est vrai, alors je vais le vaincre !"),
      WALK,
      CIN(4),
      LOOP('loop_bridge'),
      OPP(2, 4, 'Halte !'),
      HERO(2, 0, 'Qui es-tu ? Ote-toi de mon chemin, sinon...'),
      OPP(2, 1, "Sinon... quoi ? Je suis le serviteur du grand TomTom, et il est hors de question que tu déranges sa seigneurie pendant son invocation."),
      HERO(2, 0, "Si tu veux m'empêcher de passer, alors il va falloir te battre !"),
      OPP(2, 0, "Tu me parais bien téméraire, sache que personne n'a jamais percé ma côte de maille !"),
      OPP(2, 1, 'Combat 4 : Chevalier Moutarde'),
    ],
    [
      CIN(4),
      LOOP('loop_bridge'),
      HERO(0, 0, 'Me voilà débarrassé de cet importun, poursuivons la route, je dois trouver et démasquer ce fameux TomTom...'),
      P(4, 5, 1, '(...)'),
      WALK,
      CIN(5),
      LOOP('loop_wind'),
      OPP(2, 2, 'Zam ! Zoum ! Glouglou Zim ! O Grand Piquant réponds à mon appel !'),
      HERO(2, 0, "Est-ce toi TomTom ?\nQu'est-ce-que tu fabriques ?"),
      OPP(2, 0, "Uhm... tu oses venir déranger l'invocation du Grand Piquant, agenouille-toi devant\nle pouvoir des anciens !"),
      OPP(2, 2, 'Zoum ! Zam ! Zim zoum zam ! O Grand Piquant donne moi ta force,\nprends ce sucre en offrande !'),
      HERO(2, 0, "C'est donc toi le voleur du sucre des fruits ! Rends-nous ce que tu as pris !!"),
      OPP(2, 0, "Je vais t'apprendre la sagesse..."),
      OPP(2, 1, 'Combat 5 : TomTom du Chili'),
    ],
    [
      CIN(5),
      LOOP('loop_wind'),
      P(5, 5, 0, "Je peux mourir en paix, je suis certain d'aller rejoindre les Anciens\nau Potager Céleste !"),
      P(5, 5, 0, 'Jamais tu ne retrouveras le sucre de tes fruits !'),
      P(5, 5, 2, 'Je... O Grand Piquant, je peux te sentir, je suis si près de toi !'),
      T('Grrraaawwwwwwww !'),
      HERO(3, 0, "Aie, les ennuis s'annoncent..."),
      WALK,
      P(5, 5, 0, 'Le Grand Piquant est revenu à la vie grâce à mon sacrifice...'),
      OPP(2, 4, 'Combat 6 : Le Grand Piquant'),
    ],
    [
      CIN(5),
      LOOP('loop_wind'),
      OPP(5, 4, 'Krttttttt tsoc pouing,\nuh-uh uh-uh niourbeuh-euuuj !'),
      OPP(4, 4, 'Suuuuuucreee suuuuucucucucureeeuuuhh ssuuucreeuuh !'),
      WASABII_WALK,
      HERO(4, 3, 'Quelquechose me dit que je devrais le suivre...'),
      WALK,
      CIN(6),
      LOOP('loop_swamp'),
      HERO(2, 0, "Où est-il encore passé ? Il m'a semblé le voir entrer dans ces marais..."),
      HERO(2, 0, "Oulà ! J'entends comme un chant... ou plutôt un cri..."),
      CIN(7),
      OPP(2, 4, 'Krttttttt tsoc pouing, uh-uh uh-uh niourbeuh-euuuj !'),
      HERO(3, 1, 'Le voilà !'),
      OPP(2, 4, 'Combat 7 : Wasabiii'),
    ],
    [
      CIN(6),
      LOOP('loop_swamp'),
      FRIEND(0, 0, '$# !!'),
      HERO(4, 0, "$* !! j'ai enfin vaincu le Grand Piquant !"),
      FRIEND(1, 0, 'Le quoi ? Cherchons plutôt le sucre, il doit être quelquepart par ici'),
      WALK, // aller sur le sucre
      CIN(8),
      LOOP('loop_night'),
      HERO(4, 0, 'Le voilà ! Enfin nous avons trouvé le sucre de tous nos fruits !'),
      FRIEND(3, 2, "Fais attention ! $# ! N'y touche pas !"),
      CIN(9),
      HERO(3, 2, 'Ooops !!'),
      FRIEND(2, 4, "Non ! Tu as fait tomber tout notre bon sucre dans la mer ! Qu'allons-nous devenir ?"),
      HERO(3, 2, '(...)'),
      T('Quelques jours plus tard...'),
      CIN(10),
      LOOP('loop_forest'),
      HERO(4, 3, "Voilà ! C'est prêt !"),
      FRIEND(4, 3, 'OOhhhh ! La belle tarte au poisson, je peux goûter ?'),
      FRIEND(4, 0, 'Miam ! Sucrée à souhait, un vrai régal !'),
      FRIEND(4, 2, 'Dis, il reste du sorbet au poulpe ?'),
      T('Ainsi la vie poursuivit son cours à Légumia, le royaume des fruits salés et des poissons sucrés, pour le plus grand régal de tous !'),
      T('Fin'),
    ],
  ];

  // cinématique n (CIN) → image de fond ; 5 = composite temple (scene6/*)
  const CIN_SCENES = ['scene1', 'scene2', 'scene3', 'scene4', 'scene5',
    'TEMPLE', 'scene7', 'scene7', 'scene8', 'scene8', 'scene9'];

  // étapes de la carte (coordonnées sur worldMap 277×287) :
  // 0 départ, 1 mine (Sel), 2 cascade (Poivre)… cf. HistoMap.as start/endEtape
  const MAP_ETAPES = [
    [42, 200],   // 0 verger / départ
    [64, 58],    // 1 la Mine (Sel + trahison)
    [148, 40],   // 2 la cascade (Poivre)
    [185, 52],   // 3 le pont (Moutarde)
    [235, 72],   // 4 le temple (TomTom)
    [248, 105],  // 5 parvis du temple (Grand Piquant)
    [218, 152],  // 6 les marais (Wasabiii)
    [150, 125],  // 7 le sucre
  ];

  return {
    TAUNT_QUESTION: TAUNT_QUESTION,
    TAUNT_ANSWER: TAUNT_ANSWER,
    TAUNT_WINS: TAUNT_WINS,
    TAUNT_LOOSE: TAUNT_LOOSE,
    SCENARIO: SCENARIO,
    CIN_SCENES: CIN_SCENES,
    MAP_ETAPES: MAP_ETAPES,
    TXT_SCORE_BATTU: TXT_SCORE_BATTU,
    TXT_VOTRE_SCORE: TXT_VOTRE_SCORE,
    TXT_VOTRE_RECORD: TXT_VOTRE_RECORD,
    TXT_VOTRE_PLACE: TXT_VOTRE_PLACE,
    TXT_PLACE_GAGNEES: TXT_PLACE_GAGNEES,
  };
})();
