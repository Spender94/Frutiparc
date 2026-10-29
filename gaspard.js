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
  { cle: 'commandes', mots: 'commande commandes slash aide help liste fonction fonctions',
    reponse: 'Les commandes du chat : /aide (l’aide complète), /fiche pseudo (la fiche d’un Frutiz), /status away|phone|zzz|work|eat (ton statut), /donne nombre pseudo (offrir des kikooz), /d6 ou /d20 (un dé), /lg aide (le loup-garou). Et @pseudo pour interpeller quelqu’un — @Gaspard pour moi !' },
  { cle: 'kikooz', mots: 'kikooz kikoo monnaie argent sous gagner riche',
    reponse: 'Les kikooz sont la monnaie du parc : ils s’achètent à la boutique et se gagnent en jouant, par la connexion quotidienne (une série de jours rapporte plus), les quêtes de Gromelin, les mises à prix des records, le parrainage, et ce que les animateurs offrent pendant les animations. /donne nombre pseudo pour en offrir.' },
  { cle: 'quetes', mots: 'quete quetes gromelin mission missions defi defis hebdo semaine',
    reponse: 'Gromelin propose chaque semaine des quêtes taillées sur tes jeux (ouvre « Quêtes » depuis l’accueil) : chaque quête faite rapporte des kikooz, et finir la semaine donne un bonus. Il passe aussi au salon pomme confier une bricole à quelqu’un de présent, quatre fois par jour.' },
  { cle: 'primes', mots: 'prime primes mise mises prix record records absolu battre battu',
    reponse: 'Les mises à prix : chaque record du parc (dans « Quêtes ») a une prime qui grossit tant qu’il tient. Bats-le en détrônant quelqu’un d’autre, et Gromelin te la verse. Les records sont ceux du livre des records du Club.' },
  { cle: 'boutique', mots: 'boutique acheter achat achete magasin vendre vend article articles feutre feutres accessoire accessoires pass',
    reponse: 'La boutique (icône sur l’accueil et le bureau) vend les feutres du chat, les accessoires de Frutibouille — dont ceux dessinés par des Frutiz —, les fonds d’écran et le pass quotidien qui ajoute une partie classée par jour. Tout se paie en kikooz.' },
  { cle: 'bouille', mots: 'bouille frutibouille avatar tete visage apparence editeur modifier changer coiffure accessoire',
    reponse: 'Ta Frutibouille se dessine dans l’éditeur (« Ma Frutibouille » depuis ton profil) : visage, yeux, bouche, coiffure, couleurs. Les accessoires s’achètent à la boutique et se posent depuis l’inventaire.' },
  { cle: 'jeux', mots: 'jeu jeux jouer partie parties disque disques console frusion burning kiwi frutisnake snake swapou motionball kaluga minipixiz miniwave minifever jamajama grapiz bandas',
    reponse: 'Les jeux du parc : Burning Kiwi, Frutisnake, Swapou, MotionBall, Kaluga, MiniPixiz, MiniWave, Mini-Fever, JamaJama, Grapiz, Frutibandas… Ils s’ouvrent depuis l’accueil (onglet Jeux) ou la console du bureau. Chaque jour, le Challenge classe tes meilleures parties.' },
  { cle: 'challenge', mots: 'challenge classement classe classes medaille medailles score scores fruit defendu fd quota pass quotidien gratuit gratuites',
    reponse: 'Le Challenge du jour classe les parties de chaque jeu ; à minuit les médailles tombent (or, argent, bronze). Tu as deux parties classées gratuites par jour et par jeu — le pass quotidien de la boutique en ajoute une. Hors classement, tu joues autant que tu veux.' },
  { cle: 'club', mots: 'club records livre historique palmares fiche joueur',
    reponse: 'Le Club (depuis l’accueil) tient le livre des records de chaque jeu, les médailles de chacun et la fiche de tout Frutiz — tape un pseudo pour la voir.' },
  { cle: 'salons', mots: 'salon salons pomme chat tchat discuter parler rejoindre changer',
    reponse: 'Les salons sont les pommes colorées en haut du chat : chacune a son sujet (pomme est le salon des animations). Clique sur un pseudo pour lui parler en privé, et sur « … voir les messages précédents … » pour relire le salon.' },
  { cle: 'mp', mots: 'prive privee privees mp message messages dm chuchoter perso',
    reponse: 'Pour parler en privé : clique sur un pseudo dans la liste des connectés, puis « message privé ». La conversation a son onglet, qui clignote quand on te répond.' },
  { cle: 'mentions', mots: 'mention mentions mentionner arobase @ interpeller appeler notifier notification',
    reponse: 'Écris @pseudo dans un message pour interpeller quelqu’un : son onglet clignote et il est prévenu, même s’il est ailleurs sur le site. Les réglages (icône engrenage) disent comment tu veux être prévenu.' },
  { cle: 'forum', mots: 'forum sujet sujets poster post reponse repondre frutimail mail courrier',
    reponse: 'Le forum (depuis l’accueil) a ses rubriques par thème : ouvre un sujet ou réponds-y. Le Frutimail, lui, est la messagerie : un courrier reste même quand tu n’es pas connecté.' },
  { cle: 'nuit', mots: 'nuit sombre dark theme mode noir clair lumiere lumineux',
    reponse: 'Le mode nuit se règle dans les réglages (icône engrenage) : allumé, éteint, ou « comme mon téléphone ».' },
  { cle: 'statut', mots: 'statut status absent away pastille rond vert icone occupe',
    reponse: 'Ton statut : /status away, phone, zzz, work ou eat remplace ta pastille verte par une petite icône ; /status off la remet.' },
  { cle: 'profil', mots: 'profil fiche compte infos informations mot passe mdp email adresse supprimer',
    reponse: 'Ton profil se modifie depuis l’accueil (« Mon profil ») : fiche, Frutibouille, mot de passe, adresse e-mail. Pour la suppression d’un compte, c’est tout en bas des réglages.' },
  { cle: 'animateurs', mots: 'animateur animateurs animation animations moderateur moderateurs modo modos staff equipe admin',
    reponse: 'Les animateurs mènent les animations (quiz, loup-garou, blindtest) et offrent des kikooz ; les modérateurs veillent sur les salons. Le staff se reconnaît en tête de la liste des connectés.' },
  { cle: 'loupgarou', mots: 'loup garou loupgarou loup-garou village villageois',
    reponse: 'Le loup-garou se joue dans un salon quand un animateur en mène une partie : /lg aide donne les commandes, et le village vote le jour, les loups rôdent la nuit.' },
  { cle: 'parrainage', mots: 'parrain parrainage filleul filleuls inviter invitation ami amis',
    reponse: 'Le parrainage : invite un ami avec ton lien de parrainage (dans ton profil). Quand il atteint le niveau 2, vous recevez chacun 100 kikooz.' },
  { cle: 'niveau', mots: 'niveau niveaux xp experience level monter',
    reponse: 'Ton niveau monte avec l’expérience : jouer, parler, poster… Il s’affiche sur ta fiche, et certains cadeaux (le parrainage) se débloquent en montant.' },
  { cle: 'bureau', mots: 'bureau light mobile telephone tablette version flash ruffle appli application installer',
    reponse: 'Le parc existe en deux versions : le bureau (l’ancien site Flash, joué sous Ruffle) et le light, fait pour le téléphone — qu’on peut installer comme une appli (réglages → « Installée sur l’écran d’accueil »). Même compte, mêmes salons, mêmes jeux.' },
  { cle: 'prunostic', mots: 'prunostic prunostics pari paris parier pronostic cote',
    reponse: 'Le Prunostic, c’est parier des kikooz sur les tournois et les défis du parc : tu mises, et si tu as vu juste, tu empoches la cote.' },
  { cle: 'logs', mots: 'log logs historique precedent precedents relire rater manque',
    reponse: 'Pour relire un salon, clique sur « … voir les messages précédents … » en haut du fil : les vingt-quatre dernières heures sont là.' },
  { cle: 'bug', mots: 'bug bugs probleme problemes marche fonctionne plante bloque erreur casse',
    reponse: 'Un souci ? Dis-le sur le forum (rubrique dédiée) avec ce que tu faisais et sur quelle version (bureau ou light) : l’équipe y passe. Et un rechargement de la page règle souvent l’affaire.' },
];

// Ce que Gaspard répond quand on le salue ou le remercie, sans question.
const POLITESSES = [
  { mots: ['bonjour', 'salut', 'hello', 'coucou', 'bonsoir', 'hey', 'yo'], reponse: 'Bonjour {nom} ! Pose-moi une question sur le parc, je ferai de mon mieux — par exemple « @Gaspard comment gagner des kikooz ? ».' },
  { mots: ['merci', 'thanks', 'thx'], reponse: 'Avec plaisir, {nom} ! Je suis là si tu as d’autres questions.' },
];

const THEMES = 'les commandes, les kikooz, les quêtes, les mises à prix, la boutique, la Frutibouille, les jeux, le Challenge, le Club, les salons, les messages privés, les mentions, le forum, le mode nuit';

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
