'use strict';
/*
 * GASPARD, L'HÔTE DU PARC — ce qu'il sait répondre, et comment il comprend.
 *
 * Gaspard tenait l'aide (la fenêtre « Gaspard », ses rubriques en base) et ne
 * disait rien au chat. Ici il ÉCOUTE : on l'interpelle (« @Gaspard … », ou
 * « Gaspard, … », ou /gaspard) et il répond à la question avec ce qu'il sait —
 * une base de réponses toutes faites, par mots-clés, plus les rubriques de
 * l'aide que l'admin entretient (titre, mots-clés, corps). Il accueille aussi
 * les nouveaux à leur première entrée dans un salon.
 *
 * Rien que du texte et des tableaux : ce module ne touche ni au chat ni à la
 * base, c'est le serveur qui le branche (gaspardEcoute, gaspardAccueillir).
 * Il se teste donc tel quel (test/gaspard.test.js).
 *
 * LA RECONNAISSANCE. Une question est réduite à ses mots (minuscules, sans
 * accents, sans ponctuation, sans mots vides) ; chaque réponse porte ses
 * mots-clés, et compte un point par mot-clé retrouvé — un mot de la question
 * qui COMMENCE comme le mot-clé vaut aussi (« kikooz » ↔ « kikoozs »,
 * « quêtes » ↔ « quete »), au-delà de quatre lettres. La meilleure réponse
 * l'emporte ; à égalité, la base intégrée passe avant les rubriques de l'aide,
 * et un seul point ne suffit pas quand la question est longue (on ne répond
 * pas « les kikooz » à « j'ai perdu mon mot de passe et mes kikooz »).
 */

const MOTS_VIDES = new Set(('le la les l un une des du de d et ou a au aux en y je tu il elle on nous vous ils elles me te se ce ca cela ceci ' +
  'mon ma mes ton ta tes son sa ses notre votre leur leurs qui que quoi dont ou est sont suis es etes sommes etait etais ete etre avoir ai as avons avez ont ' +
  'pour par avec sans sur sous dans chez vers entre comment pourquoi quand combien quel quelle quels quelles ne pas plus non oui si tres bien ' +
  'faire fait fais peux peut pouvez pouvoir veux veut voulez vouloir dois doit devez svp stp merci bonjour salut hello coucou hey bonsoir gaspard ' +
  'c s j m t n l qu est-ce ca va the plait sil').split(/\s+/));

function normaliser(texte) {
  return String(texte || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9@/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Un mot « racine » : sans son pluriel (chats → chat, jeux → jeu, quêtes → quete).
function racine(mot) {
  let m = mot;
  if (m.length > 4 && /aux$/.test(m)) m = m.slice(0, -3) + 'al';
  if (m.length > 3 && /x$/.test(m)) m = m.slice(0, -1);
  if (m.length > 3 && /s$/.test(m)) m = m.slice(0, -1);
  return m;
}
function mots(texte) {
  return normaliser(texte).split(' ').filter((m) => m && !MOTS_VIDES.has(m)).map(racine);
}
function motsCles(liste) {
  return String(Array.isArray(liste) ? liste.join(' ') : liste || '').split(/[\s,;]+/).filter(Boolean).map((m) => racine(normaliser(m)));
}
// Combien de mots-clés de `cles` la question `q` (déjà en mots) retrouve.
function score(q, cles) {
  let n = 0;
  for (const c of cles) {
    if (!c) continue;
    if (q.some((m) => m === c || (c.length >= 4 && m.length >= 4 && (m.startsWith(c) || c.startsWith(m))))) n++;
  }
  return n;
}

/*
 * LA BASE INTÉGRÉE : ce que Gaspard sait sans qu'on le lui apprenne. Chaque
 * entrée : ses mots-clés, et sa réponse (une ou deux phrases, pour le chat ;
 * la fenêtre d'aide en dit davantage). `{nom}` est remplacé par le pseudo.
 */
const BASE = [
  { cle: 'commandes', mots: 'commande commandes slash aide help liste',
    reponse: 'Les commandes du chat : /aide (la liste complète), /log (les logs du salon), /! pseudo message (un mot que lui seul verra), /ignore pseudo, /donne kikooz pseudo (offrir des kikooz), /status away|phone|zzz|work|eat|off (ta pastille), /d6 ou /d20 (un dé), /stats (le salon), /lg aide (le loup-garou). Et @pseudo pour interpeller quelqu’un — @Gaspard pour moi !' },
  // AVANT LES KIKOOZ : « les kikooz des quêtes », « des médailles », « du
  // parrainage » parlent des quêtes, des médailles, du parrainage. Les
  // kikooz comptent double (kikooz, kikoo) : à égalité, le sujet précis passe.
  { cle: 'quetes', mots: 'quete quetes gromelin mission missions defi defis hebdo semaine bricole',
    reponse: 'Chaque lundi, Gromelin te confie tes quêtes de la semaine, taillées sur tes jeux (tuile « Quêtes » de l’accueil) : chaque quête faite rapporte des kikooz, et les finir toutes te vaut un bonus d’XP. Il passe aussi au salon pomme, quatre fois par jour, confier une bricole à quelqu’un de présent.' },
  { cle: 'medailles', mots: 'medaille medailles or bronze podium rang rangs',
    reponse: 'À minuit, les trois premiers de chaque classement du Challenge sont médaillés : 15 kikooz pour l’or, 10 pour l’argent, 5 pour le bronze. Et les quinze premiers gagnent de l’XP selon leur rang, de 2 500 XP pour le premier à 100 XP pour le quinzième.' },
  { cle: 'parrainage', mots: 'parrain parrainage filleul filleuls inviter invitation ami amis',
    reponse: 'Le parrainage : à son inscription, ton ami écrit ton pseudo dans « Nom du parrain ». Quand il atteint le niveau 2, vous recevez chacun 100 kikooz.' },
  { cle: 'kikooz', mots: 'kikooz kikoo monnaie argent riche',
    reponse: 'Les kikooz sont la monnaie du parc, et se dépensent à la boutique. Ils se gagnent par la connexion quotidienne, les médailles du Challenge, les quêtes et les mises à prix de Gromelin, la Question à 60 kikooz, les Prunostics, le parrainage, et ce que les animateurs offrent. /donne nombre pseudo pour en offrir.' },
  { cle: 'primes', mots: 'prime primes mise mises prix record records absolu battre battu',
    reponse: 'Les mises à prix : chaque record du parc (dans « Quêtes ») a une prime qui grossit tant qu’il tient. Bats-le en détrônant quelqu’un d’autre, et Gromelin te la verse. Les records sont ceux du livre des records du Club.' },
  // Avant la boutique et la bouille : « changer de feutre » est une question
  // de feutre, pas d'achat.
  { cle: 'feutres', mots: 'feutre feutres couleur couleurs encre stylo multicolore',
    reponse: 'Ton feutre, c’est la couleur de tes messages : choisis-le dans la barre du chat, et celui que tu retrouves en arrivant dans Réglages → « Feutre par défaut ». Le feutre multicolore, qui écrit chaque lettre d’une couleur, s’achète à la boutique, rayon Feutres.' },
  { cle: 'boutique', mots: 'boutique acheter achat achete magasin vendre vend article articles feutre feutres accessoire accessoires rayon rayons',
    reponse: 'La boutique (tuile de l’accueil) range ses articles par rayons : accessoires — dont les accessoires maison, dessinés par des Frutiz —, incarnations, feutres, fonds d’écran, pass quotidiens, options de jeu (Packs) et Décors, où se cache le mode nuit. Tout se règle en kikooz.' },
  { cle: 'bouille', mots: 'bouille frutibouille avatar tete visage apparence editeur modifier changer coiffure',
    reponse: 'Ta Frutibouille (visage, yeux, bouche, coiffure, couleurs) se dessine dans l’éditeur « Ma Frutibouille », à ta première arrivée ; pour la redessiner ensuite, l’équipe peut te le rouvrir. Au quotidien, c’est l’Inventaire qui l’habille : accessoires et incarnations.' },
  { cle: 'inventaire', mots: 'inventaire porter mettre enlever retirer changer accessoire accessoires defaut incarnation incarnations',
    reponse: 'L’Inventaire (tuile de l’accueil) range tes accessoires, incarnations, fonds d’écran et pictos : touche un accessoire pour le porter, « Normal » pour l’enlever. Celui que ta bouille porte d’office se choisit dans Réglages → « Accessoire par défaut ».' },
  { cle: 'fonds', mots: 'fond fonds ecran wallpaper papier peint',
    reponse: 'Les fonds d’écran se prennent à la boutique (rayon Fonds d’écran), puis se posent depuis l’Inventaire, onglet « Fonds d’écran » ; « Aucun » rend le vert d’origine.' },
  { cle: 'atelier', mots: 'atelier maison dessiner dessine variante variantes creer createur creation graphiste accessoire',
    reponse: 'Les accessoires maison sont dessinés par des Frutiz dans l’atelier de variantes, puis publiés par l’équipe au rayon « Accessoires maison » de la boutique, signés de leur auteur — qui touche 10 % de chaque vente.' },
  // LES JEUX, un par un — avant l'entrée générale, qui ne doit pas leur voler
  // « comment jouer à Kaluga ? ».
  { cle: 'frutisnake', mots: 'frutisnake snake serpent battle',
    reponse: 'Frutisnake : ton serpent mange le plus de fruits possible. Il se joue au Challenge, en Battle à plusieurs sur un même clavier, et en ligne en un contre un — c’est le Championnat, noté à l’Elo. Le Pack de Frutisnake (boutique) affiche longueur, dynamites et bonus en jeu.' },
  { cle: 'swapou', mots: 'swapou swapou2 echanger natacha dimitri',
    reponse: 'Swapou : échange deux fruits voisins pour faire exploser les groupes de même couleur — et à chaque coup, une ligne monte par le bas. On y choisit son personnage — Dimitri, Natacha… — et le mode Challenge compte au classement du jour.' },
  { cle: 'kaluga', mots: 'kaluga tzongre grappe freestyle',
    reponse: 'Kaluga : ton Tzongre (ou l’un de ses amis) récolte un maximum de pommes. Au Challenge, deux tableaux : Grappe, et Freestyle pour les parties sans grappe de plus de mille points.' },
  { cle: 'motionball', mots: 'motionball motion ball mb2 bille billes poulpe',
    reponse: 'MotionBall 2 : fais rouler tes billes de salle en salle, jusqu’au terrible poulpe du Challenge. La carte du Challenge change chaque nuit, et VieuxPruneau la publie sur le forum (Jeux Frutiparc).' },
  { cle: 'burningkiwi', mots: 'burning kiwi bkiwi course courses circuit circuits pilote voiture turbo',
    reponse: 'Burning Kiwi : la course, sur six circuits, au meilleur temps. Au Challenge, c’est le circuit du jour ; en multi, deux à quatre pilotes du parc courent ensemble en ligne.' },
  { cle: 'grapiz', mots: 'grapiz hexagone hexagonal jeton jetons',
    reponse: 'Grapiz : un plateau hexagonal, à deux ou plus, en ligne ; un jeton avance d’autant de cases qu’il y a de jetons sur sa ligne. Au Challenge, c’est ta série de victoires qui compte ; le Championnat se joue en différé, trois jours par coup, noté à l’Elo.' },
  { cle: 'frutibandas', mots: 'frutibandas bandas fruticarte fruticartes pousser',
    reponse: 'Frutibandas : à deux, tu pousses tous tes fruits d’une case à chaque tour, avec une fruticarte en renfort, pour pousser ceux d’en face hors du plateau. Au Challenge, c’est ta série de victoires qui compte ; le Championnat, entre humains, est noté à l’Elo, en direct ou en différé.' },
  { cle: 'miniwave', mots: 'miniwave wave survival letter vaisseau',
    reponse: 'MiniWave : repousse les vagues de fruits, en Arcade, Mission, Survival ou Letter (où l’on tape au clavier la lettre de chaque monstre). Au Challenge, un parcours neuf de quarante niveaux chaque jour, le même pour tout le monde.' },
  { cle: 'minipixiz', mots: 'minipixiz pixiz fee fees bocal',
    reponse: 'MiniPixiz : des pièces tombent, et quatre jetons de même couleur qui se touchent disparaissent — les cascades rapportent gros. Autour, tes fées : elles mangent, montent de niveau, apprennent des sorts, et Gromelin peut les envoyer en mission.' },
  { cle: 'minifever', mots: 'minifever fever epreuve epreuves',
    reponse: 'Mini-Fever : des mini-jeux de quelques secondes qui s’enchaînent, à la souris ou au doigt. Jamais sorti à l’époque, il revit ici, et son mode arcade compte au Challenge du jour.' },
  { cle: 'jamajama', mots: 'jamajama jama',
    reponse: 'JamaJama : un jeu de réflexion, coup par coup, en sept packs d’aventure, plus les niveaux du tournoi, classés au moins de coups. Et tu peux dessiner tes propres niveaux dans son éditeur.' },
  // Avant l'entrée générale des jeux : « les disquettes » sont les FD.
  { cle: 'challenge', mots: 'challenge challenges fruit defendu fd disquette disquettes quota limite pass quotidien gratuit gratuites partie parties classee',
    reponse: 'Le Challenge du jour classe les parties de chaque jeu, et repart à zéro à minuit. À Burning Kiwi, Frutisnake, Swapou, MotionBall et Kaluga, tu as deux parties classées (les FD) gratuites par jour et par jeu ; chaque pass quotidien de la boutique en ajoute une par jour, pour toujours. Hors classement, tu joues autant que tu veux.' },
  { cle: 'jeux', mots: 'jeu jeux jouer disque disques console frusion lancer gratuit',
    reponse: 'Les jeux du parc : Burning Kiwi, Frutisnake, Swapou, MotionBall 2, Kaluga, Grapiz, Frutibandas, MiniWave, MiniPixiz, Mini-Fever et JamaJama, tous gratuits. Ils s’ouvrent depuis « Mes disques » sur l’accueil — et « @Gaspard Kaluga » te parle de l’un d’eux.' },
  { cle: 'classements', mots: 'classement classements score scores tableau consecration',
    reponse: 'La tuile « Scores » montre les classements : le Challenge du jour de chaque jeu, avec le podium de la veille, et la section Championnat, qui ne s’efface jamais — kikooz, XP, consécration et les championnats à deux.' },
  { cle: 'championnat', mots: 'championnat championnats elo note adversaire duel',
    reponse: 'Le Championnat, c’est le un-contre-un noté : à Frutibandas, Grapiz et Frutisnake (le Battle en ligne), chaque partie entre humains fait monter ou descendre ta note d’Elo. Les notes sont dans Scores, section Championnat, sans remise à zéro.' },
  { cle: 'pictos', mots: 'picto pictos collection',
    reponse: 'Les pictos se gagnent par des exploits dans les jeux et se rangent dans l’Inventaire, onglet « Pictos ». Au classement, la consécration mesure ta collection, jeu par jeu.' },
  { cle: 'club', mots: 'club records livre palmares',
    reponse: 'Le Club (depuis l’accueil) tient le livre des records de chaque jeu, les médailles de chacun et la fiche de tout Frutiz — tape un pseudo pour la voir.' },
  { cle: 'serie', mots: 'serie series connexion quotidien quotidienne affilee recompense cadeau fidelite bonus 100 jours',
    reponse: 'Chaque jour où tu te connectes : 10 kikooz et 5 000 XP. Le 7ᵉ jour d’affilée (puis le 14ᵉ, le 21ᵉ…) rapporte 30 kikooz au lieu de 10, et à 100 jours d’affilée, une fois pour toutes, un accessoire t’attend dans ton inventaire. Un jour manqué, et la série repart à 1.' },
  { cle: 'niveau', mots: 'niveau niveaux xp experience level monter',
    reponse: 'Ton niveau suit ton XP. Chaque jour, à minuit : 250 XP par message au chat (50 messages au plus), 2 500 pour un sujet de forum (un seul), 1 250 par réponse (huit au plus), 1 500 par classement du Challenge où tu as un score (dix au plus), 1 000 par nouveau Prunostic (cinq au plus) — et 5 000 XP dès ta première connexion du jour. Le niveau N demande (N−1)² × 10 000 XP : 10 000 pour le niveau 2, 40 000 pour le 3…' },
  { cle: 'salons', mots: 'salon salons pomme chat tchat discuter parler rejoindre changer creer',
    reponse: 'Les salons publics portent des noms de fruits — Pomme, Abricot, Poire, Fraise… — et Pomme est celui des animations. La tuile « Salons » de l’accueil les liste, et tu peux créer le tien, avec son sujet.' },
  { cle: 'logs', mots: 'log logs /log /logs historique precedent precedents relire rater manque salon',
    reponse: 'Pour relire un salon, tape /log, ou clique sur « … voir les messages précédents … » en haut du fil : les vingt-quatre dernières heures sont là.' },
  // Avant la modération : « le mode sombre » est la nuit, et « mode »
  // commence comme « modérateur ».
  { cle: 'nuit', mots: 'nuit sombre dark theme clair lumiere lumineux',
    reponse: 'Le mode nuit s’achète une fois pour toutes à la boutique, rayon Décors, sous le nom « Son temps viendra ». Il se règle ensuite dans Réglages → « Le parc, la nuit » : Jour, Nuit ou « Comme mon téléphone », appareil par appareil.' },
  // Avant les messages privés : « la messagerie » est le courrier. (« message »
  // y retrouve « messagerie » ; un vrai privé gagne quand même par « privé ».)
  { cle: 'frutimail', mots: 'frutimail frutimails mail mails courrier courriers messagerie lettre enveloppe',
    reponse: 'La Messagerie (tuile de l’accueil) garde tes Fruti-mails : un courrier attend son destinataire même s’il n’est pas connecté. Pour écrire à quelqu’un, l’enveloppe de sa fiche.' },
  { cle: 'mp', mots: 'prive mp message dm perso',
    reponse: 'Pour parler en privé : touche son pseudo (dans un salon ou la liste des connectés), puis la bulle « Discuter en privé » de sa fiche. La conversation a son onglet, qui clignote quand on te répond.' },
  // Après les privés : à égalité, « un message privé » reste un privé.
  { cle: 'chuchoter', mots: 'chuchoter chuchote murmurer murmure / public message prive',
    reponse: 'Sur un salon public, /! pseudo message envoie un mot que seul ce Frutiz, présent dans le salon, verra — et rien dans les logs.' },
  { cle: 'ignorer', mots: 'ignorer ignore /ignore /unignore unignore bloquer liste noire blacklist',
    reponse: '/ignore pseudo : tu ne vois plus ses messages sur les salons, et il rejoint ta liste noire (privés et invitations refusés, son courrier part dans la Boîte noire). /ignore seul montre la liste, /unignore pseudo le rend.' },
  { cle: 'emotes', mots: 'emote emotes emoticone emoticones smiley smileys mdr lol rigole',
    reponse: 'Les émotes : écris seul un mot comme « mdr », « lol », « :D », « rougit », « gum », « miam », « snif » ou « :p », et ta bouille le joue devant tout le salon.' },
  { cle: 'contacts', mots: 'contact contacts carnet ajouter ami amis repertoire',
    reponse: 'Au bureau, le cœur de la fiche d’un Frutiz l’ajoute à « Mes contacts » (tu peux aussi l’y glisser depuis un salon) ; sur téléphone, ton carnet s’affiche dans la liste des salons.' },
  { cle: 'mentions', mots: 'mention mentions mentionner arobase @ interpeller appeler notifier notification notifications',
    reponse: 'Écris @pseudo dans un message pour interpeller quelqu’un : son onglet clignote et il est prévenu, même s’il est ailleurs sur le site. Réglages → « Mentions » et « Notifications » disent comment tu veux être prévenu.' },
  { cle: 'forum', mots: 'forum sujet sujets poster post reponse repondre rubrique rubriques',
    reponse: 'Le forum (tuile « Forum » de l’accueil) range ses sujets par rubriques : annonces, animations, jeux, créations… Ouvre un sujet ou réponds-y — ça rapporte aussi de l’XP.' },
  { cle: 'blueon', mots: 'blueon blueoff /blueon /blueoff bleu sondage /poll /vote',
    reponse: '/blueon et /blueoff sont aux animateurs : leurs messages passent en bleu. Ils ont aussi leurs quiz, blindtests et sondages (/poll) — à un sondage, chacun répond par /vote et le numéro de son choix.' },
  // Après la nuit : « mode » commence comme « modérateur ».
  { cle: 'moderation', mots: 'moderat modo signaler signalement insulte insultes harcelement prevenir appel alerte totoche',
    reponse: 'Un souci avec quelqu’un ? /ignore pseudo pour ne plus le lire. Au bureau, chaque fenêtre de salon a un bouton « Prévenir les modérateurs » ; ils peuvent éjecter, totocher (réduire au silence) ou bannir, et les mots interdits valent dix minutes de totoche automatique.' },
  { cle: 'statut', mots: 'statut status absent away pastille rond vert icone occupe',
    reponse: 'Ton statut : /status away, phone, zzz, work ou eat remplace ta pastille verte par une petite icône ; /status off la remet.' },
  { cle: 'profil', mots: 'profil fiche compte infos informations modifier prenom ville commentaire supprimer suppression donnees',
    reponse: 'Ta fiche : touche ta bouille sur l’accueil (« Voir ma fiche »), puis « Modifier ma fiche » — prénom, ville, activité, commentaire… La suppression du compte et la copie de tes données sont tout en bas des Réglages, carte « Mes données ».' },
  { cle: 'fiche', mots: 'fiche fiches joueur joueurs',
    reponse: 'Touche un pseudo — dans un salon, la liste des connectés, les scores ou le Bouilloscope — pour ouvrir sa fiche : onglets Frutiz, Perso, Scores et Bonus, et de là, un message privé ou un Fruti-mail.' },
  { cle: 'bouilloscope', mots: 'bouilloscope trombinoscope trombi annuaire chercher rechercher retrouver',
    reponse: 'Le Bouilloscope (tuile de l’accueil) est l’annuaire des Frutiz : cherche un pseudo, ou appuie sur « par bouille » pour retrouver quelqu’un à sa tête.' },
  { cle: 'animateurs', mots: 'animateur animateurs animation animations staff equipe admin',
    reponse: 'Les animateurs mènent les animations — quiz, blindtests, loup-garou — et offrent des kikooz de leur enveloppe ; la Question à 60 kikooz, elle, tombe tous les soirs à 19 h. Les annonces sont sur le forum, rubrique « Animations officielles ».' },
  { cle: 'kiloute', mots: 'kiloute kiloutou mikehorny mike horny question questions 60 quiz heure 19h',
    reponse: 'Tous les soirs à 19 h, MikeHorny passe dans le salon le plus fréquenté poser la Question à 60 kikooz : le premier qui donne la bonne réponse les empoche. On a trois minutes.' },
  { cle: 'blindtest', mots: 'blindtest blind musique chanson extrait',
    reponse: 'Le blindtest : un animateur lance un extrait musical dans le salon, et tout le monde l’entend en même temps. À toi de trouver le titre au chat — le titre, lui, ne s’affiche pas.' },
  { cle: 'loupgarou', mots: 'loup garou loupgarou loup-garou village villageois',
    reponse: 'Le loup-garou se joue dans un salon quand un animateur en ouvre une partie : /lg jouer pour t’inscrire (quatre joueurs au moins), /lg aide pour les commandes. Le village vote le jour, les loups rôdent la nuit.' },
  { cle: 'frutisigne', mots: 'frutisigne frutisignes signe signes ascendant irma dam horoscope semaine',
    reponse: 'M’dam Irma passe dans les salons, une fois par heure, révéler le Frutisigne et l’ascendant de quelqu’un qui ne les connaît pas encore. La semaine de ton signe, tu as deux parties classées de plus par jour (à deux jeux du Challenge tirés au sort), et une le jour de ton ascendant.' },
  // Après Irma et MikeHorny : « quand passe-t-elle ? » n'est pas un mot de passe.
  { cle: 'motdepasse', mots: 'mot passe mdp code secret oubli oublie oublier perdu email adresse',
    reponse: 'Code secret oublié ? Sur la page de connexion, « Oubli de code secret » envoie un lien à l’adresse e-mail de ton compte, valable une heure. Sans e-mail enregistré, demande à l’équipe.' },
  { cle: 'appli', mots: 'appli application installer installation android iphone ios telephone',
    reponse: 'Le parc s’installe comme une appli : sur Android, menu ⋮ → « Installer l’application » ; sur iPhone, dans Safari, Partager → « Sur l’écran d’accueil ». Installée, elle peut te prévenir du courrier et des messages privés (Réglages → Notifications).' },
  { cle: 'bureau', mots: 'bureau light mobile tablette ordinateur version flash ruffle',
    reponse: 'Sur un grand écran, le parc s’ouvre en bureau, avec ses fenêtres comme à l’époque ; sur téléphone, en version mobile. Même compte, mêmes salons, mêmes jeux — et la version Flash d’origine reste là (lien « Version Flash » de la page d’accueil).' },
  { cle: 'prunostic', mots: 'prunostic prunostics pari paris parier pronostic cote cagnotte',
    reponse: 'Les Prunostics : tu mises des kikooz, la veille, sur les médaillés du Challenge du lendemain, ou sur les matchs des tournois. Toutes les mises vont au pot, que se partagent ceux qui ont vu juste ; chaque nouveau pari rapporte aussi un peu d’XP.' },
  { cle: 'bug', mots: 'bug bugs probleme problemes marche fonctionne plante bloque erreur casse panne',
    reponse: 'Un souci ? Raconte-le sur le forum, avec ce que tu faisais et sur quel appareil : l’équipe y passe. Et un rechargement de la page règle souvent l’affaire.' },
];

// Ce que Gaspard répond quand on le salue ou le remercie, sans question.
const POLITESSES = [
  { mots: ['bonjour', 'salut', 'hello', 'coucou', 'bonsoir', 'hey', 'yo'], reponse: 'Bonjour {nom} ! Pose-moi une question sur le parc, je ferai de mon mieux — par exemple « @Gaspard comment gagner des kikooz ? ».' },
  { mots: ['merci', 'thanks', 'thx'], reponse: 'Avec plaisir, {nom} ! Je suis là si tu as d’autres questions.' },
];

const THEMES = 'les kikooz, l’XP et la série de connexion, le Challenge et ses médailles, les quêtes, les Prunostics, la boutique et l’inventaire, chaque jeu du parc, les salons et leurs commandes, les messages privés et le courrier, le forum, la modération, les animations';

// Le corps d'une rubrique d'aide, ramené à du texte de chat : balises
// enlevées, entités rendues, coupé à `max` caractères sur un mot.
function texteDeRubrique(html, max) {
  let t = String(html || '')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<\/?(p|li|div|h\d)[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
  if (t.length > max) {
    t = t.slice(0, max);
    const i = t.lastIndexOf(' ');
    if (i > max * 0.6) t = t.slice(0, i);
    t += '…';
  }
  return t;
}

/**
 * La question dans un message qui s'adresse à Gaspard — ou null s'il n'est pas
 * interpellé. On accepte « @Gaspard … », « Gaspard, … », « gaspard … » en tête,
 * et « /gaspard … » ; une mention au milieu (« merci @gaspard ») compte aussi.
 */
function interpelle(texte) {
  const t = String(texte || '').trim();
  const m = /^\s*(?:\/gaspard|@?gaspard)\b\s*[,:!?]*\s*(.*)$/i.exec(t) || /^(.*?)\s*@gaspard\b\s*[,:!?]*\s*(.*)$/i.exec(t);
  if (!m) return null;
  const q = (m.length === 2 ? m[1] : (m[1] + ' ' + m[2])).trim();
  return q;
}

/**
 * La réponse à une question. `rubriques` : les rubriques de l'aide
 * ({ title, keywords, body, is_index }), facultatives.
 * @returns {{ texte: string, source: 'base'|'aide'|'politesse'|'rien', cle?: string }}
 */
function repondre(question, rubriques, nom) {
  const q = String(question || '').trim();
  const qm = mots(q);
  const brut = normaliser(q).split(' ').filter(Boolean);
  const pseudo = nom || 'toi';
  const avecNom = (t) => t.replace(/\{nom\}/g, pseudo);

  if (!qm.length) {
    for (const p of POLITESSES) if (brut.some((m) => p.mots.includes(m))) return { texte: avecNom(p.reponse), source: 'politesse' };
    return { texte: avecNom('Je t’écoute, {nom} : pose-moi ta question après « @Gaspard ». Je connais ' + THEMES + '.'), source: 'rien' };
  }

  let meilleur = null;
  const retenir = (sc, cand) => { if (sc > 0 && (!meilleur || sc > meilleur.sc)) meilleur = Object.assign({ sc }, cand); };
  for (const e of BASE) retenir(score(qm, motsCles(e.mots)), { source: 'base', cle: e.cle, texte: avecNom(e.reponse) });
  for (const r of (rubriques || [])) {
    if (!r || r.is_index) continue;
    const cles = motsCles(r.keywords).concat(mots(r.title));
    const sc = score(qm, cles);
    const corps = texteDeRubrique(r.body, 320);
    if (sc > 0 && corps) retenir(sc, { source: 'aide', cle: String(r.title || ''), texte: String(r.title || '') + ' — ' + corps + ' (la suite dans l’aide, icône Gaspard)' });
  }
  // Un seul point sur une question de cinq mots ou plus : trop fragile.
  if (meilleur && !(meilleur.sc === 1 && qm.length >= 5)) return { texte: meilleur.texte, source: meilleur.source, cle: meilleur.cle };
  for (const p of POLITESSES) if (brut.some((m) => p.mots.includes(m)) && qm.length <= 2) return { texte: avecNom(p.reponse), source: 'politesse' };
  return { texte: avecNom('Je n’ai pas compris, {nom}. Je connais ' + THEMES + ' — ou ouvre l’aide complète : l’icône Gaspard de l’accueil.'), source: 'rien' };
}

/** Le mot de bienvenue d'un nouveau, à sa première entrée dans un salon. */
function bienvenue(nom, kikooz) {
  const k = Number(kikooz) || 0;
  return [
    `Bienvenue ${nom} ! Je suis Gaspard, l’hôte du parc.` + (k > 0 ? ` Pour commencer, voici ${k} kikooz de bienvenue — la monnaie d’ici.` : ''),
    'Quelques repères : les pommes en haut sont les salons, @pseudo interpelle quelqu’un, /aide ouvre l’aide, et les quêtes de Gromelin (depuis l’accueil) rapportent des kikooz chaque semaine.',
    'Une question ? Écris @Gaspard devant, je réponds dans le salon.',
  ];
}

module.exports = { BASE, POLITESSES, THEMES, normaliser, mots, racine, score, interpelle, repondre, bienvenue, texteDeRubrique };
