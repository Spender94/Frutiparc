'use strict';
/*
 * LE LOUP-GAROU DU SALON — le moteur de la partie, sans serveur.
 *
 * Un animateur ouvre une partie dans son salon, les joueurs s'inscrivent, le
 * meneur lance : chacun reçoit son rôle en secret, et la partie enchaîne les
 * nuits et les jours toute seule — chaque étape a son chrono, et se termine
 * plus tôt dès que tout le monde a joué. Le meneur garde la main sur le
 * rythme (« suite », pause, vote anticipé, foudre) et voit tout.
 *
 * Ce module ne parle à personne : chaque commande rend une liste
 * d'ÉVÉNEMENTS que le serveur traduit en lignes de chat —
 *   { a: 'public', t }         une annonce de la partie, à tout le salon
 *   { a: 'info', t }           une petite ligne grise, à tout le salon
 *   { a: 'secret', u, t }      à un joueur seul (son rôle, son action de nuit…)
 *   { a: 'meneur', t }         au meneur seul (qui fait quoi, la nuit)
 *   { a: 'fin', camp, gagnants, prix }   la partie est jouée
 * Le texte est brut ; « **gras** » et les retours à la ligne y sont permis.
 *
 * L'état est un objet JSON simple : il s'enregistre tel quel, et une partie
 * survit à un redémarrage (rechargée en pause).
 */

const ROLES = {
  loup: { nom: 'Loup-garou', pluriel: 'Loups-garous', camp: 'loups',
    desc: 'Chaque nuit, avec la meute, tu dévores un villageois. Le jour, fais-toi passer pour un innocent.' },
  villageois: { nom: 'Simple villageois', pluriel: 'Simples villageois', camp: 'village',
    desc: 'Pas de pouvoir, mais ta voix compte : démasque les loups et vote juste.' },
  voyante: { nom: 'Voyante', pluriel: 'Voyantes', camp: 'village',
    desc: 'Chaque nuit, ta boule de cristal te révèle le rôle d’un joueur.' },
  sorciere: { nom: 'Sorcière', pluriel: 'Sorcières', camp: 'village',
    desc: 'Une potion de vie pour sauver la victime des loups, une potion de mort pour empoisonner : une fois chacune dans la partie.' },
  chasseur: { nom: 'Chasseur', pluriel: 'Chasseurs', camp: 'village',
    desc: 'Si tu meurs, tu emportes quelqu’un avec toi d’un dernier coup de fusil.' },
  cupidon: { nom: 'Cupidon', pluriel: 'Cupidons', camp: 'village',
    desc: 'La première nuit, tu lies deux amoureux : si l’un meurt, l’autre meurt de chagrin.' },
  salvateur: { nom: 'Salvateur', pluriel: 'Salvateurs', camp: 'village',
    desc: 'Chaque nuit, tu protèges un joueur des loups (jamais deux nuits de suite le même).' },
  idiot: { nom: 'Idiot du village', pluriel: 'Idiots du village', camp: 'village',
    desc: 'Si le village vote contre toi, on te reconnaît et on t’épargne en riant… mais tu ne votes plus.' },
};
// Ce que chaque rôle tape (rappelé dans son message secret).
const COMMANDE_ROLE = {
  loup: '/lg devorer <numéro>', voyante: '/lg voir <numéro>', sorciere: '/lg sauver · /lg tuer <numéro> · /lg rien',
  chasseur: '/lg tirer <numéro> (à ta mort)', cupidon: '/lg lier <numéro> <numéro>', salvateur: '/lg proteger <numéro>',
};
const SPECIAUX = ['voyante', 'sorciere', 'chasseur', 'cupidon', 'salvateur', 'idiot'];
const CHRONOS_DEFAUT = { nuit: 60, sorciere: 30, debat: 150, vote: 60, chasseur: 30, soir: 8 };
const CHRONO_BORNES = { nuit: [15, 600], sorciere: [10, 300], debat: [0, 1800], vote: [15, 600], chasseur: [10, 300], soir: [3, 120] };
const MIN_JOUEURS = 4;
const MAX_JOUEURS = 18;

const NUITS = [
  'La nuit tombe sur Frutiparc. Le village s’endort… mais pas tout le monde.',
  'Les volets se ferment, les bouilles se couchent. Quelque part, des crocs brillent.',
  'Un hurlement au loin. Le village s’endort en serrant les dents.',
  'La lune se lève, ronde comme une prune. Les loups ont faim.',
];
const AUBES = [
  'Le coq chante, le village s’éveille.',
  'Le soleil se lève sur Frutiparc. On compte les bouilles…',
  'Les premières lueurs de l’aube. Tout le monde sort sur la place.',
];
const PERSONNE = [
  'Miracle : tout le monde se réveille ce matin !',
  'Pas une égratignure cette nuit. Les loups auraient-ils fait la grasse matinée ?',
  'Le village se réveille au complet. Quelqu’un veillait sur lui…',
];

// ── Petits outils ─────────────────────────────────────────────────────────────

function normaliser(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function tirerDans(liste, rnd) { return liste[Math.floor((rnd || Math.random)() * liste.length) % liste.length]; }
function melanger(liste, rnd) {
  const l = liste.slice();
  for (let i = l.length - 1; i > 0; i--) {
    const k = Math.floor((rnd || Math.random)() * (i + 1));
    [l[i], l[k]] = [l[k], l[i]];
  }
  return l;
}
function duree(s) {
  s = Math.round(Number(s) || 0);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${String(r).padStart(2, '0')}` : `${m} min`;
}
const nomRole = (r) => (ROLES[r] || {}).nom || r;
const qui = (j) => `${j.nom} (n°${j.n})`;
const vivants = (p) => p.joueurs.filter((j) => j.vivant);
const joueurDe = (p, u) => p.joueurs.find((j) => j.u === u) || null;
const roleVivant = (p, r) => p.joueurs.find((j) => j.vivant && j.role === r) || null;
const loupsVivants = (p) => p.joueurs.filter((j) => j.vivant && j.role === 'loup');
const listeNum = (l) => l.map((j) => `${j.n}. ${j.nom}`).join(' · ');

/** La composition par défaut pour n joueurs. */
function compositionDefaut(n) {
  const loups = n <= 6 ? 1 : n <= 10 ? 2 : n <= 14 ? 3 : 4;
  const speciaux = ['voyante'];
  if (n >= 6) speciaux.push('sorciere');
  if (n >= 7) speciaux.push('chasseur');
  if (n >= 9) speciaux.push('cupidon');
  if (n >= 10) speciaux.push('salvateur');
  if (n >= 13) speciaux.push('idiot');
  return { loups, speciaux };
}
/** « 2 Loups-garous, 1 Voyante, … » */
function compositionTexte(roles) {
  const compte = {};
  for (const r of roles) compte[r] = (compte[r] || 0) + 1;
  const ordre = ['loup'].concat(SPECIAUX, ['villageois']).filter((r) => compte[r]);
  return ordre.map((r) => `${compte[r]} ${compte[r] > 1 ? ROLES[r].pluriel : ROLES[r].nom}`).join(', ');
}

/**
 * Les réglages tapés après « lancer » (ou « chrono ») :
 *   loups=3  +idiot  -cupidon  idiot  nuit=45  debat=120  vote=60  prix=20
 */
function lireReglages(args) {
  const out = { loups: null, plus: [], moins: [], chronos: {}, prix: null, erreurs: [] };
  for (const brut of args) {
    const a = normaliser(brut);
    if (!a) continue;
    let m;
    if ((m = /^loups?=(\d{1,2})$/.exec(a))) { out.loups = Number(m[1]); continue; }
    if ((m = /^prix=(\d{1,5})$/.exec(a))) { out.prix = Number(m[1]); continue; }
    if ((m = /^(nuit|sorciere|debat|vote|chasseur|soir)=(\d{1,4})$/.exec(a))) {
      const [lo, hi] = CHRONO_BORNES[m[1]];
      out.chronos[m[1]] = Math.max(lo, Math.min(hi, Number(m[2])));
      continue;
    }
    if ((m = /^([+-]?)([a-z]+)$/.exec(a))) {
      const r = { sorcier: 'sorciere', salva: 'salvateur', idiots: 'idiot', voyant: 'voyante' }[m[2]] || m[2];
      if (SPECIAUX.includes(r)) { (m[1] === '-' ? out.moins : out.plus).push(r); continue; }
    }
    out.erreurs.push(brut);
  }
  return out;
}

// ── La partie ────────────────────────────────────────────────────────────────

function creer({ salon, meneur, meneurNom, now, prix }) {
  return {
    v: 1, salon: String(salon), meneur: String(meneur), meneurNom: String(meneurNom || meneur),
    phase: 'inscriptions', etape: null, nuit: 0, jour: 0, joueurs: [],
    options: { chronos: Object.assign({}, CHRONOS_DEFAUT), prix: Math.max(0, Number(prix) || 0) },
    n: null, votes: {}, potions: { vie: true, mort: true }, protegeAvant: null,
    chasseur: null, apres: null, echeance: null, pause: null,
    gagnant: null, gagnants: [], creeAt: now || Date.now(),
  };
}

/** L'annonce d'ouverture (le serveur l'envoie juste après creer). */
function ouverture(p) {
  const prix = p.options.prix ? ` À la clé : **${p.options.prix} kikooz** pour chaque gagnant !` : '';
  return [{ a: 'public', t: `Une partie de LOUP-GAROU commence ! Meneur : ${p.meneurNom}.${prix}\nPour jouer, tapez **/lg jouer** (sur mobile : le bouton « Je joue »). De ${MIN_JOUEURS} à ${MAX_JOUEURS} joueurs.` }];
}

function Ctx(p, now, rnd) {
  const evts = [];
  return {
    p, now: now || Date.now(), rnd: rnd || Math.random, evts,
    pub: (t) => evts.push({ a: 'public', t }),
    info: (t) => evts.push({ a: 'info', t }),
    sec: (u, t) => evts.push({ a: 'secret', u, t }),
    men: (t) => evts.push({ a: 'meneur', t }),
  };
}

function inscrire(c, u, nom) {
  const p = c.p;
  if (p.phase !== 'inscriptions') return c.sec(u, 'La partie a déjà commencé : attends la prochaine !');
  if (u === p.meneur) return c.sec(u, 'Tu mènes la partie : le meneur ne joue pas (il sait tout !).');
  if (joueurDe(p, u)) return c.sec(u, 'Tu es déjà inscrit à la partie.');
  if (p.joueurs.length >= MAX_JOUEURS) return c.sec(u, `La partie est complète (${MAX_JOUEURS} joueurs).`);
  p.joueurs.push({ u, nom: String(nom || u), n: p.joueurs.length + 1, role: null, vivant: true, amoureux: null, revele: false, sansVote: false });
  c.info(`${nom} rejoint la partie (${p.joueurs.length} joueur${p.joueurs.length > 1 ? 's' : ''}).`);
}
function desinscrire(c, u, parQui) {
  const p = c.p;
  const j = joueurDe(p, u);
  if (!j) return c.sec(parQui || u, parQui ? 'Ce joueur n’est pas inscrit.' : 'Tu n’es pas inscrit.');
  if (p.phase !== 'inscriptions') {
    return c.sec(parQui || u, parQui ? 'La partie est lancée : utilise /lg eliminer.' : 'La partie est lancée : on ne quitte plus le village ! (Le meneur peut t’en retirer.)');
  }
  p.joueurs = p.joueurs.filter((x) => x.u !== u);
  p.joueurs.forEach((x, i) => { x.n = i + 1; });
  c.info(`${j.nom} quitte la partie (${p.joueurs.length} joueur${p.joueurs.length > 1 ? 's' : ''}).`);
}

/** Retrouve un joueur : son numéro, son pseudo, le début de son pseudo. */
function trouver(p, arg, filtre) {
  const pool = p.joueurs.filter(filtre || (() => true));
  const a = normaliser(arg).replace(/^n°|^#/, '');
  if (!a) return { erreur: 'Indique un joueur (son numéro ou son pseudo).' };
  if (/^\d+$/.test(a)) {
    const j = p.joueurs.find((x) => x.n === Number(a));
    if (!j) return { erreur: `Pas de joueur n°${a}.` };
    if (!pool.includes(j)) return { erreur: `${j.nom} ne peut pas être choisi.` };
    return { j };
  }
  const exact = pool.filter((j) => normaliser(j.nom) === a || normaliser(j.u) === a);
  if (exact.length === 1) return { j: exact[0] };
  const debut = pool.filter((j) => normaliser(j.nom).startsWith(a));
  if (debut.length === 1) return { j: debut[0] };
  const dedans = debut.length ? debut : pool.filter((j) => normaliser(j.nom).includes(a));
  if (dedans.length === 1) return { j: dedans[0] };
  if (dedans.length > 1) return { erreur: `Plusieurs joueurs correspondent : ${dedans.map((j) => j.nom).join(', ')}. Donne le numéro.` };
  const ailleurs = p.joueurs.find((j) => normaliser(j.nom) === a || normaliser(j.nom).startsWith(a));
  if (ailleurs) return { erreur: `${ailleurs.nom} ne peut pas être choisi.` };
  return { erreur: `Je ne trouve pas « ${arg} » parmi les joueurs.` };
}

// ── Le lancement ─────────────────────────────────────────────────────────────

function lancer(c, args) {
  const p = c.p;
  if (p.phase !== 'inscriptions') return c.men('La partie est déjà lancée.');
  const n = p.joueurs.length;
  if (n < MIN_JOUEURS) return c.men(`Il faut au moins ${MIN_JOUEURS} joueurs (inscrits : ${n}).`);
  const r = lireReglages(args || []);
  if (r.erreurs.length) c.men(`Je n’ai pas compris : ${r.erreurs.join(', ')} (ignoré).`);
  Object.assign(p.options.chronos, r.chronos);
  if (r.prix != null) p.options.prix = r.prix;
  const defaut = compositionDefaut(n);
  let loups = r.loups != null ? r.loups : defaut.loups;
  loups = Math.max(1, Math.min(loups, Math.ceil(n / 2) - 1 || 1));
  let speciaux = defaut.speciaux.filter((x) => !r.moins.includes(x));
  for (const x of r.plus) if (!speciaux.includes(x)) speciaux.push(x);
  speciaux = SPECIAUX.filter((x) => speciaux.includes(x));       // l'ordre canonique
  while (loups + speciaux.length > n) speciaux.pop();
  const roles = [];
  for (let i = 0; i < loups; i++) roles.push('loup');
  roles.push(...speciaux);
  while (roles.length < n) roles.push('villageois');
  const tires = melanger(roles, c.rnd);
  p.joueurs.forEach((j, i) => { j.role = tires[i]; j.vivant = true; });
  p.composition = compositionTexte(roles);
  c.pub(`Les rôles sont distribués ! Dans ce village de ${n} : ${p.composition}.\nChacun a reçu son rôle en secret (tape **/lg role** pour le revoir).`);
  for (const j of p.joueurs) c.sec(j.u, texteRole(p, j));
  c.men(`Les rôles :\n${p.joueurs.map((j) => `${j.n}. ${j.nom} — ${nomRole(j.role)}`).join('\n')}`);
  commencerNuit(c);
}

function texteRole(p, j) {
  const R = ROLES[j.role];
  let t = `Tu es **${R.nom}**. ${R.desc}`;
  if (COMMANDE_ROLE[j.role]) t += `\nTa commande : ${COMMANDE_ROLE[j.role]}`;
  if (j.role === 'loup') {
    const autres = p.joueurs.filter((x) => x.role === 'loup' && x.u !== j.u);
    t += autres.length ? `\nTa meute : ${autres.map((x) => qui(x) + (x.vivant ? '' : ' †')).join(', ')}.` : '\nTu chasses seul.';
    t += '\nLa nuit, tout ce que tu écris dans le salon n’est lu que par la meute ; le jour, **/lg meute <message>** lui parle en secret.';
  }
  if (j.role === 'sorciere') t += `\nPotions : vie ${p.potions.vie ? 'prête' : 'utilisée'}, mort ${p.potions.mort ? 'prête' : 'utilisée'}.`;
  if (j.amoureux) { const a = joueurDe(p, j.amoureux); if (a) t += `\nTon amour : ${qui(a)}.`; }
  if (j.role === 'idiot' && j.revele) t += '\nDémasqué : tu ne votes plus.';
  return t;
}

// ── La nuit ──────────────────────────────────────────────────────────────────

function commencerNuit(c) {
  const p = c.p;
  p.phase = 'nuit';
  p.etape = 'nuit';
  p.nuit += 1;
  p.votes = {};
  p.n = { loups: {}, cible: null, vu: null, protege: null, lies: null, sauve: false, poison: null };
  p.echeance = c.now + p.options.chronos.nuit * 1000;
  c.pub(`NUIT ${p.nuit}. ${tirerDans(NUITS, c.rnd)}\n(Le salon se tait jusqu’au matin. Ceux qui ont un rôle de nuit ont reçu leurs instructions en secret.)`);
  const meute = loupsVivants(p);
  const proies = vivants(p).filter((j) => j.role !== 'loup');
  for (const l of meute) {
    c.sec(l.u, `Nuit ${p.nuit} : la meute se réveille. Désignez votre victime : **/lg devorer <numéro>** (il faut vous mettre d’accord).\nProies : ${listeNum(proies)}${meute.length > 1 ? `\nLa meute : ${meute.map((x) => x.nom).join(', ')}. Écrivez dans le salon : seuls les loups vous lisent.` : ''}`);
  }
  const voy = roleVivant(p, 'voyante');
  if (voy) c.sec(voy.u, `Nuit ${p.nuit} : ta boule de cristal s’allume. Quel rôle veux-tu découvrir ? **/lg voir <numéro>**\n${listeNum(vivants(p).filter((j) => j.u !== voy.u))}`);
  const sal = roleVivant(p, 'salvateur');
  if (sal) {
    const avant = joueurDe(p, p.protegeAvant);
    c.sec(sal.u, `Nuit ${p.nuit} : qui protèges-tu des loups ? **/lg proteger <numéro>** (toi compris)${avant && avant.vivant ? ` — pas ${avant.nom}, protégé la nuit dernière` : ''}.\n${listeNum(vivants(p).filter((j) => j.u !== p.protegeAvant))}`);
  }
  const cup = p.nuit === 1 ? roleVivant(p, 'cupidon') : null;
  if (cup) c.sec(cup.u, `Première nuit : décoche ta flèche ! Désigne deux amoureux : **/lg lier <numéro> <numéro>** (toi compris si tu veux).\n${listeNum(vivants(p))}`);
  const actifs = [`la meute (${meute.map((x) => x.nom).join(', ')})`];
  if (voy) actifs.push(`la voyante (${voy.nom})`);
  if (sal) actifs.push(`le salvateur (${sal.nom})`);
  if (cup) actifs.push(`cupidon (${cup.nom})`);
  c.men(`Nuit ${p.nuit} (${duree(p.options.chronos.nuit)} au plus) : ${actifs.join(', ')}.`);
}

function nuitFinie(p) {
  if (p.phase !== 'nuit' || p.etape !== 'nuit') return false;
  const meute = loupsVivants(p);
  const choix = meute.map((l) => p.n.loups[l.u]);
  const loupsOk = choix.length > 0 && choix.every((x) => x && x === choix[0]);
  const voyOk = !roleVivant(p, 'voyante') || !!p.n.vu;
  const salOk = !roleVivant(p, 'salvateur') || !!p.n.protege;
  const cupOk = p.nuit > 1 || !roleVivant(p, 'cupidon') || !!p.n.lies;
  return loupsOk && voyOk && salOk && cupOk;
}
function peutEtreFinNuit(c) {
  if (!c.p.pause && nuitFinie(c.p)) finEtapeNuit(c);
}

// La victime de la meute : l'accord, sinon la majorité, sinon le hasard entre ex æquo.
function victimeDesLoups(c) {
  const p = c.p;
  const compte = {};
  for (const l of loupsVivants(p)) {
    const v = p.n.loups[l.u];
    if (v && (joueurDe(p, v) || {}).vivant) compte[v] = (compte[v] || 0) + 1;
  }
  const max = Math.max(0, ...Object.values(compte));
  if (!max) return null;
  return tirerDans(Object.keys(compte).filter((u) => compte[u] === max), c.rnd);
}

function finEtapeNuit(c) {
  const p = c.p;
  const meute = loupsVivants(p);
  const accord = meute.length && meute.every((l) => p.n.loups[l.u] && p.n.loups[l.u] === p.n.loups[meute[0].u]);
  p.n.cible = victimeDesLoups(c);
  const cible = joueurDe(p, p.n.cible);
  if (!accord) {
    for (const l of meute) c.sec(l.u, cible ? `Le temps presse : faute d’accord, la meute se jette sur ${qui(cible)}.` : 'La meute n’a choisi personne cette nuit.');
  }
  c.men(cible ? `La meute dévore ${qui(cible)}${p.n.protege === cible.u ? ' (protégé par le salvateur !)' : ''}.` : 'La meute ne dévore personne.');
  const sor = roleVivant(p, 'sorciere');
  const utile = sor && ((p.potions.vie && cible) || p.potions.mort);
  if (utile) {
    p.etape = 'sorciere';
    p.echeance = c.now + p.options.chronos.sorciere * 1000;
    const options = [];
    if (p.potions.vie && cible) options.push('**/lg sauver** (potion de vie)');
    if (p.potions.mort) options.push('**/lg tuer <numéro>** (potion de mort)');
    options.push('**/lg rien**');
    c.sec(sor.u, `${cible ? `Cette nuit, les loups ont attaqué ${qui(cible)}.` : 'Cette nuit, les loups n’ont attaqué personne.'}\nTon chaudron bouillonne : ${options.join(' · ')}\n${listeNum(vivants(p).filter((j) => j.u !== sor.u))}`);
    return;
  }
  aube(c);
}

function aube(c) {
  const p = c.p;
  const n = p.n;
  const morts = [];
  if (n.cible && n.cible !== n.protege && !n.sauve) morts.push(n.cible);
  if (n.poison && !morts.includes(n.poison)) morts.push(n.poison);
  p.protegeAvant = n.protege;
  p.etape = null;
  p.echeance = null;
  c.pub(`${tirerDans(AUBES, c.rnd)}`);
  const encore = morts.filter((u) => (joueurDe(p, u) || {}).vivant);
  if (!encore.length) c.pub(tirerDans(PERSONNE, c.rnd));
  for (const u of melanger(encore, c.rnd)) tuer(c, u, 'nuit');
  suiteApresMorts(c, 'jour');
}

// ── Les morts ────────────────────────────────────────────────────────────────

const MORTS = {
  nuit: (j) => `Au petit matin, on découvre que ${qui(j)} ne se réveillera pas.`,
  vote: (j) => `Le village a tranché : ${qui(j)} est chassé du village.`,
  chasseur: (j) => `PAN ! Le chasseur emporte ${qui(j)} dans sa chute.`,
  chagrin: (j) => `Le cœur brisé, ${qui(j)} rejoint son amour dans la tombe.`,
  meneur: (j) => `La foudre du meneur s’abat sur ${qui(j)} !`,
};
function tuer(c, u, cause) {
  const p = c.p;
  const j = joueurDe(p, u);
  if (!j || !j.vivant) return;
  j.vivant = false;
  j.cause = cause;
  c.pub(`${MORTS[cause](j)} Rôle : **${nomRole(j.role)}**.`);
  c.sec(j.u, 'Tu as quitté la partie. Tu peux la suivre, mais plus un mot jusqu’à la fin : les morts ne parlent pas !');
  delete p.votes[u];
  for (const k of Object.keys(p.votes)) if (p.votes[k] === u) delete p.votes[k];
  if (j.role === 'chasseur' && cause !== 'meneur') p.chasseur = u;
  const amour = j.amoureux && joueurDe(p, j.amoureux);
  if (amour && amour.vivant) tuer(c, amour.u, 'chagrin');
}

/** Après des morts : le dernier tir du chasseur, puis la fin de partie ou la suite. */
function suiteApresMorts(c, ensuite) {
  const p = c.p;
  const ch = p.chasseur && joueurDe(p, p.chasseur);
  if (ch && vivants(p).length) {
    p.phase = 'chasseur';
    p.etape = null;
    p.apres = ensuite;
    p.echeance = c.now + p.options.chronos.chasseur * 1000;
    c.pub(`${ch.nom} était chasseur… et il lui reste une balle. Il a ${duree(p.options.chronos.chasseur)} pour viser.`);
    c.sec(ch.u, `Dans un dernier souffle, tu épaules ton fusil : **/lg tirer <numéro>**.\n${listeNum(vivants(p))}`);
    return;
  }
  p.chasseur = null;
  const v = verdict(p);
  if (v) return fin(c, v);
  if (ensuite === 'jour') return commencerJour(c);
  if (ensuite === 'soir') return commencerSoir(c);
  return commencerNuit(c);
}

function verdict(p) {
  const vv = vivants(p);
  if (!vv.length) return { camp: 'personne', gagnants: [], texte: 'Il ne reste plus personne… Le village est désert : match nul !' };
  if (vv.length === 2 && vv[0].amoureux === vv[1].u && ROLES[vv[0].role].camp !== ROLES[vv[1].role].camp) {
    return { camp: 'amoureux', gagnants: vv.map((j) => j.u), texte: `Seuls au monde, ${vv[0].nom} et ${vv[1].nom} s’enfuient main dans la main : **victoire des amoureux** !` };
  }
  const loups = vv.filter((j) => j.role === 'loup').length;
  if (!loups) {
    return { camp: 'village', gagnants: p.joueurs.filter((j) => ROLES[j.role].camp === 'village').map((j) => j.u),
      texte: 'Le dernier loup est tombé : **victoire du village** ! Ce soir, on danse sur la place.' };
  }
  if (loups >= vv.length - loups) {
    return { camp: 'loups', gagnants: p.joueurs.filter((j) => j.role === 'loup').map((j) => j.u),
      texte: 'Les loups sont maintenant aussi nombreux que les villageois : la meute se jette sur les derniers. **Victoire des loups-garous** !' };
  }
  return null;
}

function recapitulatif(p) {
  return p.joueurs.map((j) => `${j.n}. ${j.nom} — ${nomRole(j.role)}${j.amoureux ? ' ♥' : ''}${j.vivant ? ' (en vie)' : ''}`).join('\n');
}
function fin(c, v) {
  const p = c.p;
  p.phase = 'fin';
  p.etape = null;
  p.echeance = null;
  p.pause = null;
  p.gagnant = v.camp;
  p.gagnants = v.gagnants;
  c.pub(`${v.texte}\nLes rôles :\n${recapitulatif(p)}`);
  c.evts.push({ a: 'fin', camp: v.camp, gagnants: v.gagnants.slice(), prix: p.options.prix });
}

// ── Le jour ──────────────────────────────────────────────────────────────────

function commencerJour(c) {
  const p = c.p;
  p.phase = 'jour';
  p.etape = null;
  p.jour += 1;
  p.votes = {};
  const d = p.options.chronos.debat;
  p.echeance = d ? c.now + d * 1000 : null;
  c.pub(`JOUR ${p.jour} : le village débat. Qui sont les loups ?${d ? ` Le vote s’ouvre dans ${duree(d)}.` : ' Le meneur ouvrira le vote.'}\nEncore en vie : ${listeNum(vivants(p))}`);
}
function commencerVote(c) {
  const p = c.p;
  p.phase = 'vote';
  p.votes = {};
  p.echeance = c.now + p.options.chronos.vote * 1000;
  c.pub(`AUX URNES ! **/lg voter <numéro>** (ou « /lg voter blanc »). Clôture dans ${duree(p.options.chronos.vote)}, ou dès que tout le monde a voté.\n${listeNum(vivants(p))}`);
}
const votants = (p) => vivants(p).filter((j) => !j.sansVote);
function voter(c, j, arg) {
  const p = c.p;
  if (p.phase !== 'vote') return c.sec(j.u, p.phase === 'jour' ? 'Le vote n’est pas encore ouvert : débattez !' : 'Ce n’est pas le moment de voter.');
  if (j.sansVote) return c.sec(j.u, 'Démasqué, l’idiot du village ne vote plus.');
  const avant = Object.prototype.hasOwnProperty.call(p.votes, j.u);
  if (/^(blanc|personne|abstention|0)$/.test(normaliser(arg))) {
    p.votes[j.u] = null;
    c.info(`${j.nom} vote blanc.`);
  } else {
    const r = trouver(p, arg, (x) => x.vivant && x.u !== j.u);
    if (r.erreur) return c.sec(j.u, r.erreur);
    if (p.votes[j.u] === r.j.u) return c.sec(j.u, `Tu votes déjà contre ${r.j.nom}.`);
    p.votes[j.u] = r.j.u;
    const n = Object.values(p.votes).filter((x) => x === r.j.u).length;
    c.info(`${j.nom} ${avant ? 'change d’avis : vote' : 'vote'} contre ${r.j.nom} (${n} voix).`);
  }
  if (!p.pause && votants(p).every((x) => Object.prototype.hasOwnProperty.call(p.votes, x.u))) depouiller(c);
}
function depouiller(c) {
  const p = c.p;
  const compte = {};
  let blancs = 0;
  for (const x of votants(p)) {
    if (!Object.prototype.hasOwnProperty.call(p.votes, x.u)) continue;
    const v = p.votes[x.u];
    if (v && (joueurDe(p, v) || {}).vivant) compte[v] = (compte[v] || 0) + 1; else blancs++;
  }
  const lignes = Object.entries(compte).sort((a, b) => b[1] - a[1]).map(([u, n]) => `${joueurDe(p, u).nom} ${n}`);
  if (blancs) lignes.push(`blanc ${blancs}`);
  const absents = votants(p).filter((x) => !Object.prototype.hasOwnProperty.call(p.votes, x.u)).length;
  if (absents) lignes.push(`sans vote ${absents}`);
  const max = Math.max(0, ...Object.values(compte));
  const tete = Object.keys(compte).filter((u) => compte[u] === max);
  c.pub(`Le vote est clos. ${lignes.length ? lignes.join(' · ') : 'Aucune voix.'}`);
  p.votes = {};
  if (!max || tete.length > 1) {
    c.pub(max ? `Égalité ! Le village n’arrive pas à se décider : personne n’est chassé aujourd’hui.` : 'Personne n’a voté : personne n’est chassé aujourd’hui.');
    return commencerSoir(c);
  }
  const elu = joueurDe(p, tete[0]);
  if (elu.role === 'idiot' && !elu.revele) {
    elu.revele = true;
    elu.sansVote = true;
    c.pub(`Le village s’apprête à chasser ${qui(elu)}… mais c’est l’**Idiot du village** ! On l’épargne en riant. Il reste parmi nous, mais ne votera plus.`);
    return commencerSoir(c);
  }
  tuer(c, elu.u, 'vote');
  suiteApresMorts(c, 'soir');
}
function commencerSoir(c) {
  const p = c.p;
  p.phase = 'soir';
  p.etape = null;
  p.echeance = c.now + p.options.chronos.soir * 1000;
  c.info(`Le soleil se couche… la nuit tombe dans ${duree(p.options.chronos.soir)}.`);
}

// ── Les actions de nuit ──────────────────────────────────────────────────────

function enNuit(c, j, etape) {
  if (c.p.phase !== 'nuit' || c.p.etape !== (etape || 'nuit')) { c.sec(j.u, 'Ce n’est pas le moment.'); return false; }
  return true;
}
function devorer(c, j, arg) {
  const p = c.p;
  if (j.role !== 'loup') return c.sec(j.u, 'Tu n’es pas un loup-garou… du moins, pas officiellement.');
  if (!enNuit(c, j)) return;
  const r = trouver(p, arg, (x) => x.vivant);
  if (r.erreur) return c.sec(j.u, r.erreur);
  if (r.j.role === 'loup') return c.sec(j.u, 'On ne mange pas un membre de la meute !');
  p.n.loups[j.u] = r.j.u;
  const meute = loupsVivants(p);
  for (const l of meute) c.sec(l.u, `Meute — ${j.nom} veut dévorer ${qui(r.j)}.`);
  c.men(`${j.nom} (loup) veut dévorer ${qui(r.j)}.`);
  const choix = meute.map((l) => p.n.loups[l.u]);
  if (meute.length > 1 && choix.every((x) => x === r.j.u)) for (const l of meute) c.sec(l.u, `La meute est d’accord : ce sera ${qui(r.j)}.`);
  peutEtreFinNuit(c);
}
function voir(c, j, arg) {
  const p = c.p;
  if (j.role !== 'voyante') return c.sec(j.u, 'Tu n’as pas de boule de cristal.');
  if (!enNuit(c, j)) return;
  if (p.n.vu) return c.sec(j.u, 'Ta boule de cristal s’est éteinte pour cette nuit.');
  const r = trouver(p, arg, (x) => x.vivant && x.u !== j.u);
  if (r.erreur) return c.sec(j.u, r.erreur);
  p.n.vu = r.j.u;
  c.sec(j.u, `Ta boule de cristal s’éclaire : ${qui(r.j)} est **${nomRole(r.j.role)}**${r.j.role === 'loup' ? ' !' : '.'}`);
  c.men(`La voyante (${j.nom}) sonde ${qui(r.j)} : ${nomRole(r.j.role)}.`);
  peutEtreFinNuit(c);
}
function proteger(c, j, arg) {
  const p = c.p;
  if (j.role !== 'salvateur') return c.sec(j.u, 'Tu n’es pas le salvateur.');
  if (!enNuit(c, j)) return;
  const r = trouver(p, arg, (x) => x.vivant);
  if (r.erreur) return c.sec(j.u, r.erreur);
  if (r.j.u === p.protegeAvant) return c.sec(j.u, `Tu as protégé ${r.j.nom} la nuit dernière : choisis quelqu’un d’autre.`);
  p.n.protege = r.j.u;
  c.sec(j.u, `Cette nuit, tu veilles sur ${qui(r.j)}.`);
  c.men(`Le salvateur (${j.nom}) protège ${qui(r.j)}.`);
  peutEtreFinNuit(c);
}
function lier(c, j, a1, a2) {
  const p = c.p;
  if (j.role !== 'cupidon') return c.sec(j.u, 'Tu n’as ni arc ni flèches.');
  if (!enNuit(c, j) || p.nuit !== 1) return p.nuit !== 1 && p.phase === 'nuit' ? c.sec(j.u, 'Ta flèche est déjà partie la première nuit.') : undefined;
  if (p.n.lies) return c.sec(j.u, 'Ta flèche est déjà partie.');
  const r1 = trouver(p, a1, (x) => x.vivant), r2 = trouver(p, a2, (x) => x.vivant);
  if (r1.erreur || r2.erreur) return c.sec(j.u, r1.erreur || r2.erreur);
  if (r1.j.u === r2.j.u) return c.sec(j.u, 'Il faut deux amoureux différents !');
  r1.j.amoureux = r2.j.u;
  r2.j.amoureux = r1.j.u;
  p.n.lies = [r1.j.u, r2.j.u];
  for (const [x, y] of [[r1.j, r2.j], [r2.j, r1.j]]) {
    c.sec(x.u, `Une flèche de Cupidon ! Ton cœur bat désormais pour ${qui(y)}. Si l’un de vous meurt, l’autre meurt de chagrin. Si vous êtes les deux derniers en vie, vous gagnez ensemble, quels que soient vos camps.`);
  }
  if (j.u !== r1.j.u && j.u !== r2.j.u) c.sec(j.u, `Ta flèche a touché : ${r1.j.nom} et ${r2.j.nom} sont amoureux.`);
  c.men(`Cupidon (${j.nom}) lie ${qui(r1.j)} et ${qui(r2.j)}.`);
  peutEtreFinNuit(c);
}
function sorciere(c, j, quoi, arg) {
  const p = c.p;
  if (j.role !== 'sorciere') return c.sec(j.u, 'Tu n’as pas de chaudron.');
  if (!enNuit(c, j, 'sorciere')) return;
  const cible = joueurDe(p, p.n.cible);
  if (quoi === 'sauver') {
    if (!p.potions.vie) return c.sec(j.u, 'Ta potion de vie est déjà bue.');
    if (!cible) return c.sec(j.u, 'Personne à sauver cette nuit.');
    if (p.n.sauve) return c.sec(j.u, 'C’est déjà fait.');
    p.potions.vie = false;
    p.n.sauve = true;
    c.sec(j.u, `Tu verses la potion de vie : ${cible.nom} se réveillera demain.`);
    c.men(`La sorcière (${j.nom}) sauve ${qui(cible)}.`);
  } else if (quoi === 'tuer') {
    if (!p.potions.mort) return c.sec(j.u, 'Ta potion de mort est déjà utilisée.');
    const r = trouver(p, arg, (x) => x.vivant && x.u !== j.u);
    if (r.erreur) return c.sec(j.u, r.erreur);
    p.potions.mort = false;
    p.n.poison = r.j.u;
    c.sec(j.u, `Quelques gouttes dans le verre de ${r.j.nom}… Le poison fera effet avant l’aube.`);
    c.men(`La sorcière (${j.nom}) empoisonne ${qui(r.j)}.`);
  } else {
    c.sec(j.u, 'Tu refermes ton grimoire. Bonne nuit.');
    return aube(c);
  }
  const reste = (p.potions.vie && cible && !p.n.sauve) || p.potions.mort;
  if (reste) c.sec(j.u, `Autre chose ? ${p.potions.vie && cible && !p.n.sauve ? '**/lg sauver** · ' : ''}${p.potions.mort ? '**/lg tuer <numéro>** · ' : ''}**/lg rien** pour finir ta nuit.`);
  else aube(c);
}
function tirer(c, j, arg) {
  const p = c.p;
  if (p.phase !== 'chasseur' || p.chasseur !== j.u) return c.sec(j.u, j.role === 'chasseur' ? 'Ton fusil ne servira qu’à ta mort.' : 'Tu n’as pas de fusil.');
  const r = trouver(p, arg, (x) => x.vivant);
  if (r.erreur) return c.sec(j.u, r.erreur);
  p.chasseur = null;
  tuer(c, r.j.u, 'chasseur');
  suiteApresMorts(c, p.apres || 'jour');
}

// ── Le temps ─────────────────────────────────────────────────────────────────

/** Le chrono de l'étape est échu : la partie avance. */
function echeance(p, now, rnd) {
  const c = Ctx(p, now, rnd);
  if (!p.echeance || p.pause || now < p.echeance) return c.evts;
  if (p.phase === 'nuit' && p.etape === 'nuit') finEtapeNuit(c);
  else if (p.phase === 'nuit' && p.etape === 'sorciere') {
    const s = roleVivant(p, 'sorciere');
    if (s) c.sec(s.u, 'Trop tard : l’aube se lève.');
    aube(c);
  } else if (p.phase === 'jour') commencerVote(c);
  else if (p.phase === 'vote') depouiller(c);
  else if (p.phase === 'chasseur') {
    const ch = joueurDe(p, p.chasseur);
    c.pub(`${ch ? ch.nom : 'Le chasseur'} n’a pas eu le temps de tirer.`);
    p.chasseur = null;
    suiteApresMorts(c, p.apres || 'jour');
  } else if (p.phase === 'soir') commencerNuit(c);
  else p.echeance = null;
  return c.evts;
}

/** « suite » : le meneur fait avancer la partie sans attendre le chrono. */
function suite(c) {
  const p = c.p;
  if (p.phase === 'inscriptions') return lancer(c, []);
  if (p.phase === 'fin') return c.men('La partie est terminée. /lg ouvrir pour en lancer une autre.');
  p.pause = null;
  p.echeance = c.now;
  c.evts.push(...echeance(p, c.now, c.rnd));
}

// ── La parole ────────────────────────────────────────────────────────────────

/**
 * Peut-il parler dans le salon ? { ok } ; { meute } (la nuit, un loup : relayé
 * à la meute) ; { ok: false, raison }.
 */
function parole(p, u, staff) {
  if (!p || p.phase === 'inscriptions' || p.phase === 'fin') return { ok: true };
  const j = joueurDe(p, u);
  if (u === p.meneur || (staff && !j)) return { ok: true };
  if (p.phase === 'nuit') {
    if (j && j.vivant && j.role === 'loup') return { meute: true };
    return { ok: false, raison: j ? (j.vivant ? 'Chut ! C’est la nuit, le village dort. Tu pourras parler au lever du jour.' : 'Les morts ne parlent pas… Tu pourras commenter à la fin de la partie.')
      : 'C’est la nuit dans la partie de loup-garou : le salon se tait jusqu’au matin.' };
  }
  if (j && !j.vivant) return { ok: false, raison: 'Les morts ne parlent pas… Tu pourras commenter à la fin de la partie.' };
  return { ok: true };
}
/** Un loup parle à sa meute (la nuit dans le salon, ou /lg meute). */
function meute(p, u, texte) {
  const c = Ctx(p);
  const j = joueurDe(p, u);
  if (!j || j.role !== 'loup' || !j.vivant || p.phase === 'inscriptions' || p.phase === 'fin') {
    c.sec(u, 'Tu n’as pas de meute à qui parler.');
    return c.evts;
  }
  const t = String(texte || '').trim().slice(0, 400);
  if (!t) return c.evts;
  for (const l of loupsVivants(p)) c.sec(l.u, `Meute — ${j.nom} : ${t}`);
  c.men(`Meute — ${j.nom} : ${t}`);
  return c.evts;
}

// ── Les commandes ────────────────────────────────────────────────────────────

const VERBES = {
  aide: ['aide', 'help', '?', 'commandes'],
  jouer: ['jouer', 'joue', 'rejoindre', 'inscription', 'inscrire', 'go'],
  quitter: ['quitter', 'partir', 'desinscrire'],
  role: ['role', 'monrole', 'moi'],
  etat: ['etat', 'joueurs', 'qui', 'liste', 'statut'],
  voter: ['voter', 'vote', 'contre'],
  devorer: ['devorer', 'manger', 'croquer', 'mordre'],
  voir: ['voir', 'sonder', 'espionner', 'regarder'],
  proteger: ['proteger', 'garder', 'veiller'],
  lier: ['lier', 'aimer', 'flecher', 'amoureux'],
  sauver: ['sauver', 'soigner', 'vie'],
  tuer: ['tuer', 'empoisonner', 'poison', 'mort'],
  rien: ['rien', 'passer', 'dormir'],
  tirer: ['tirer', 'feu', 'abattre'],
  meute: ['meute', 'loup', 'loups'],
  // le meneur
  lancer: ['lancer', 'demarrer', 'commencer', 'start'],
  suite: ['suite', 'suivant', 'next', 'avancer'],
  pause: ['pause', 'stop-chrono'],
  reprise: ['reprise', 'reprendre', 'continuer'],
  ouvrirvote: ['ouvrirvote', 'urnes', 'votemaintenant'],
  eliminer: ['eliminer', 'foudroyer', 'virer'],
  ajouter: ['ajouter', 'inscrire+'],
  retirer: ['retirer', 'enlever'],
  chrono: ['chrono', 'chronos', 'temps'],
  prix: ['prix'],
  roles: ['roles', 'compo'],
  meneur: ['meneur'],
  fin: ['fin', 'annuler', 'arreter', 'terminer'],
};
const VERBE = {};
for (const [k, l] of Object.entries(VERBES)) for (const a of l) VERBE[a] = k;
const DU_MENEUR = new Set(['lancer', 'suite', 'pause', 'reprise', 'ouvrirvote', 'eliminer', 'ajouter', 'retirer', 'chrono', 'prix', 'roles', 'meneur', 'fin']);

function aide(p, u, meneur) {
  const lignes = [
    'LOUP-GAROU — les commandes (un joueur se désigne par son numéro ou son pseudo) :',
    '/lg jouer · /lg quitter — s’inscrire, se désinscrire',
    '/lg role — revoir ton rôle · /lg etat — la partie, les vivants et les morts',
    '/lg voter <n> — voter le jour (« blanc » pour s’abstenir)',
    'La nuit, selon ton rôle : /lg devorer <n> · /lg voir <n> · /lg proteger <n> · /lg lier <n> <n> · /lg sauver · /lg tuer <n> · /lg rien',
    '/lg tirer <n> — le dernier tir du chasseur · /lg meute <message> — un loup parle à sa meute',
    'Raccourci : /lg <n> fait ton action du moment (voter, dévorer, sonder, protéger, tirer).',
  ];
  if (meneur) {
    lignes.push('Meneur : /lg ouvrir [prix=N] · /lg ajouter <pseudo> · /lg retirer <pseudo> · /lg lancer [loups=N +idiot -cupidon nuit=60 debat=150 vote=60]',
      'Meneur : /lg suite (étape suivante sans attendre) · /lg vote (ouvrir le vote) · /lg pause · /lg reprise · /lg eliminer <n> · /lg chrono debat=90 · /lg roles · /lg fin',
      `Rôles possibles : ${Object.keys(ROLES).map(nomRole).join(', ')}.`);
  }
  return lignes.join('\n');
}

function etat(p, u, meneur) {
  const j = joueurDe(p, u);
  const nom = { inscriptions: 'inscriptions', nuit: `nuit ${p.nuit}`, jour: `jour ${p.jour}, débat`, vote: `jour ${p.jour}, vote`, chasseur: 'le dernier tir du chasseur', soir: 'le soir tombe', fin: 'partie terminée' }[p.phase];
  const lignes = [`Loup-garou — ${nom}${p.pause != null ? ' (en pause)' : ''}. Meneur : ${p.meneurNom}.${p.composition ? ` Village : ${p.composition}.` : ''}`];
  for (const x of p.joueurs) {
    const voitRole = meneur || p.phase === 'fin' || !x.vivant || x.u === u || (x.revele) || (j && j.role === 'loup' && x.role === 'loup');
    lignes.push(`${x.n}. ${x.nom}${x.vivant ? '' : ' †'}${p.phase !== 'inscriptions' && voitRole && x.role ? ` — ${nomRole(x.role)}` : ''}${meneur && x.amoureux ? ' ♥' : ''}`);
  }
  return lignes.join('\n');
}

/**
 * Une commande /lg. `qui` : { u, nom, staff } ; `ligne` : ce qui suit « /lg » ;
 * `compte(arg)` : retrouve un compte (pour « ajouter ») → { u, nom } | null.
 * Rend la liste d'événements.
 */
function commande(p, { u, nom, staff }, ligne, { now, rnd, compte } = {}) {
  const c = Ctx(p, now, rnd);
  const args = String(ligne || '').trim().split(/\s+/).filter(Boolean);
  const premier = normaliser(args[0] || 'aide');
  let verbe = VERBE[premier];
  const j = joueurDe(p, u);
  const meneur = u === p.meneur || (staff && !j);
  // « /lg 3 » ou « /lg alice » : l'action du moment.
  if (!verbe && j) { verbe = 'agir'; args.unshift('agir'); }
  // « /lg vote » sans joueur désigné, tapé par le meneur : ouvrir le vote.
  if (verbe === 'voter' && meneur && !j) verbe = 'ouvrirvote';
  if (!verbe) { c.sec(u, `Commande inconnue : « ${args[0]} ». Tape /lg aide.`); return c.evts; }
  if (DU_MENEUR.has(verbe) && !meneur) {
    c.sec(u, staff ? 'Tu joues dans cette partie : c’est le meneur qui s’en occupe.' : 'Seul le meneur peut faire ça.');
    return c.evts;
  }
  const reste = args.slice(1);
  const a1 = reste[0], a2 = reste[1];
  const sansJoueur = () => c.sec(u, p.phase === 'inscriptions' ? 'Tu n’es pas inscrit : /lg jouer.' : 'Tu ne joues pas dans cette partie.');
  const vivant = () => { if (!j) { sansJoueur(); return false; } if (!j.vivant) { c.sec(u, 'Tu as quitté la partie : les morts n’agissent plus.'); return false; } return true; };
  switch (verbe) {
    case 'aide': c.sec(u, aide(p, u, meneur)); break;
    case 'jouer': inscrire(c, u, nom); break;
    case 'quitter': desinscrire(c, u); break;
    case 'role':
      if (!j || !j.role) { if (j) c.sec(u, 'Les rôles ne sont pas encore distribués.'); else sansJoueur(); break; }
      c.sec(u, texteRole(p, j));
      break;
    case 'etat': c.sec(u, etat(p, u, meneur)); break;
    case 'voter': if (vivant()) voter(c, j, reste.join(' ')); break;
    case 'devorer': if (vivant()) devorer(c, j, reste.join(' ')); break;
    case 'voir': if (vivant()) voir(c, j, reste.join(' ')); break;
    case 'proteger': if (vivant()) proteger(c, j, reste.join(' ')); break;
    case 'lier': if (vivant()) lier(c, j, a1, a2); break;
    case 'sauver': if (vivant()) sorciere(c, j, 'sauver'); break;
    case 'tuer': if (vivant()) sorciere(c, j, 'tuer', reste.join(' ')); break;
    case 'rien': if (vivant()) sorciere(c, j, 'rien'); break;
    case 'tirer': if (j) tirer(c, j, reste.join(' ')); else sansJoueur(); break;
    case 'meute': c.evts.push(...meute(p, u, reste.join(' '))); break;
    case 'agir': {
      if (p.phase === 'chasseur' && p.chasseur === u) { tirer(c, j, reste.join(' ')); break; }
      if (!vivant()) break;
      const cible = reste.join(' ');
      if (p.phase === 'vote') voter(c, j, cible);
      else if (p.phase === 'nuit' && p.etape === 'nuit') {
        if (j.role === 'loup') devorer(c, j, cible);
        else if (j.role === 'voyante') voir(c, j, cible);
        else if (j.role === 'salvateur') proteger(c, j, cible);
        else if (j.role === 'cupidon' && p.nuit === 1) { if (a2) lier(c, j, a1, a2); else c.sec(u, 'Désigne DEUX amoureux : /lg lier <numéro> <numéro>.'); }
        else c.sec(u, 'Rien à faire pour toi cette nuit : dors bien.');
      } else if (p.phase === 'nuit' && p.etape === 'sorciere' && j.role === 'sorciere') c.sec(u, 'Choisis : /lg sauver · /lg tuer <numéro> · /lg rien.');
      else c.sec(u, p.phase === 'jour' ? 'Le vote n’est pas encore ouvert : débattez !' : 'Rien à faire pour toi en ce moment.');
      break;
    }
    // ── le meneur ──
    case 'lancer': lancer(c, reste); break;
    case 'suite': suite(c); break;
    case 'pause':
      if (p.pause != null || !['nuit', 'jour', 'vote', 'chasseur', 'soir'].includes(p.phase)) { c.men('Rien à mettre en pause.'); break; }
      p.pause = p.echeance ? Math.max(0, p.echeance - c.now) : 0;
      p.echeance = null;
      c.info('Le meneur met la partie en pause.');
      break;
    case 'reprise':
      if (p.pause == null) { c.men('La partie n’est pas en pause.'); break; }
      {
        const resteMs = p.pause;
        p.pause = null;
        const sansChrono = p.phase === 'jour' && !p.options.chronos.debat;
        p.echeance = sansChrono ? null : c.now + Math.max(resteMs, 5000);
        c.info('La partie reprend !');
        if (p.phase === 'nuit') peutEtreFinNuit(c);
        else if (p.phase === 'vote' && votants(p).every((x) => Object.prototype.hasOwnProperty.call(p.votes, x.u))) depouiller(c);
      }
      break;
    case 'ouvrirvote':
      if (p.phase !== 'jour') { c.men('Le vote s’ouvre pendant le débat du jour.'); break; }
      p.pause = null;
      commencerVote(c);
      break;
    case 'eliminer': {
      if (p.phase === 'inscriptions' || p.phase === 'fin') { c.men('Pas de partie en cours.'); break; }
      const r = trouver(p, reste.join(' '), (x) => x.vivant);
      if (r.erreur) { c.men(r.erreur); break; }
      tuer(c, r.j.u, 'meneur');
      const v = verdict(p);
      if (v) { fin(c, v); break; }
      if (p.phase === 'nuit') { if (r.j.u === p.n.cible) p.n.cible = null; delete p.n.loups[r.j.u]; peutEtreFinNuit(c); }
      else if (p.phase === 'vote' && votants(p).every((x) => Object.prototype.hasOwnProperty.call(p.votes, x.u))) depouiller(c);
      else if (p.phase === 'chasseur' && p.chasseur === r.j.u) { p.chasseur = null; suiteApresMorts(c, p.apres || 'jour'); }
      break;
    }
    case 'ajouter': {
      if (p.phase !== 'inscriptions') { c.men('Les inscriptions sont closes.'); break; }
      for (const a of reste) {
        const x = compte ? compte(a) : null;
        if (!x) c.men(`Joueur introuvable : ${a} (il doit être dans le salon).`);
        else inscrire(c, x.u, x.nom);
      }
      break;
    }
    case 'retirer': {
      const r = trouver(p, reste.join(' '));
      if (r.erreur) { c.men(r.erreur); break; }
      desinscrire(c, r.j.u, u);
      break;
    }
    case 'chrono': {
      const r = lireReglages(reste);
      Object.assign(p.options.chronos, r.chronos);
      const C = p.options.chronos;
      c.men(`Chronos : nuit ${duree(C.nuit)}, sorcière ${duree(C.sorciere)}, débat ${C.debat ? duree(C.debat) : 'au meneur'}, vote ${duree(C.vote)}, chasseur ${duree(C.chasseur)}, soir ${duree(C.soir)}.`);
      break;
    }
    case 'prix': {
      const n = Math.max(0, Math.min(99999, Math.floor(Number(a1) || 0)));
      if (p.phase === 'fin') { c.men('La partie est terminée.'); break; }
      p.options.prix = n;
      c.info(n ? `Le meneur promet **${n} kikooz** à chaque gagnant !` : 'Pas de prix pour cette partie.');
      break;
    }
    case 'roles': c.men(etat(p, u, true)); break;
    case 'meneur':
      p.meneur = u;
      p.meneurNom = nom;
      c.info(`${nom} reprend la partie en main : c’est le nouveau meneur.`);
      if (p.phase !== 'inscriptions') c.men(etat(p, u, true));
      break;
    case 'fin':
      if (p.phase === 'fin') { c.men('La partie est déjà terminée.'); break; }
      p.phase = 'fin';
      p.etape = null;
      p.echeance = null;
      p.pause = null;
      p.gagnant = 'annulee';
      c.pub(p.joueurs.some((x) => x.role) ? `Le meneur arrête la partie. Les rôles étaient :\n${recapitulatif(p)}` : 'Le meneur annule la partie.');
      break;
    default: c.sec(u, 'Commande inconnue. Tape /lg aide.');
  }
  return c.evts;
}

// ── Ce que voit le client mobile ─────────────────────────────────────────────

/** La vue d'un joueur (ou du meneur, ou d'un spectateur) : sans fuite de secrets. */
function vue(p, u, staff, now) {
  const j = joueurDe(p, u);
  const meneur = u === p.meneur || (staff && !j);
  const t = now || Date.now();
  const loupMoi = j && j.role === 'loup';
  const joueurs = p.joueurs.map((x) => {
    const voit = meneur || p.phase === 'fin' || !x.vivant || x.u === u || x.revele || (loupMoi && x.role === 'loup');
    const o = { n: x.n, nom: x.nom, vivant: x.vivant, moi: x.u === u };
    if (voit && x.role) { o.role = x.role; o.roleNom = nomRole(x.role); }
    if (x.amoureux && (meneur || p.phase === 'fin' || x.u === u || x.amoureux === u)) o.amoureux = true;
    if (p.phase === 'vote') o.voix = Object.values(p.votes).filter((v) => v === x.u).length;
    return o;
  });
  let action = null;
  if (j && j.vivant && !p.pause) {
    if (p.phase === 'vote' && !j.sansVote) action = { verbe: 'voter', libelle: 'Vote contre…', cibles: vivants(p).filter((x) => x.u !== u).map((x) => x.n), choisi: (joueurDe(p, p.votes[u]) || {}).n || null, blanc: true };
    if (p.phase === 'nuit' && p.etape === 'nuit') {
      if (j.role === 'loup') action = { verbe: 'devorer', libelle: 'Dévorer…', cibles: vivants(p).filter((x) => x.role !== 'loup').map((x) => x.n), choisi: (joueurDe(p, p.n.loups[u]) || {}).n || null };
      else if (j.role === 'voyante' && !p.n.vu) action = { verbe: 'voir', libelle: 'Sonder…', cibles: vivants(p).filter((x) => x.u !== u).map((x) => x.n) };
      else if (j.role === 'salvateur' && !p.n.protege) action = { verbe: 'proteger', libelle: 'Protéger…', cibles: vivants(p).filter((x) => x.u !== p.protegeAvant).map((x) => x.n) };
      else if (j.role === 'cupidon' && p.nuit === 1 && !p.n.lies) action = { verbe: 'lier', libelle: 'Lier deux amoureux…', cibles: vivants(p).map((x) => x.n), deux: true };
    }
    if (p.phase === 'nuit' && p.etape === 'sorciere' && j.role === 'sorciere') {
      const cible = joueurDe(p, p.n.cible);
      action = { verbe: 'tuer', libelle: p.potions.mort ? 'Empoisonner…' : '', cibles: p.potions.mort ? vivants(p).filter((x) => x.u !== u).map((x) => x.n) : [],
        sorciere: { victime: cible ? cible.nom : null, sauver: !!(p.potions.vie && cible && !p.n.sauve), sauve: !!p.n.sauve } };
    }
  }
  if (j && p.phase === 'chasseur' && p.chasseur === u) action = { verbe: 'tirer', libelle: 'Ton dernier tir…', cibles: vivants(p).map((x) => x.n) };
  const reste = p.pause != null ? p.pause : (p.echeance ? Math.max(0, p.echeance - t) : null);
  return {
    salon: p.salon, phase: p.phase, etape: p.etape, nuit: p.nuit, jour: p.jour, reste, pause: p.pause != null,
    meneur: p.meneurNom, estMeneur: meneur, prix: p.options.prix, composition: p.composition || null,
    inscrit: !!j, min: MIN_JOUEURS, max: MAX_JOUEURS,
    moi: j && j.role ? { role: j.role, roleNom: nomRole(j.role), desc: ROLES[j.role].desc, vivant: j.vivant,
      amoureux: j.amoureux ? (joueurDe(p, j.amoureux) || {}).nom || null : null,
      meute: j.role === 'loup' ? p.joueurs.filter((x) => x.role === 'loup' && x.u !== u).map((x) => x.nom) : null,
      potions: j.role === 'sorciere' ? Object.assign({}, p.potions) : null, sansVote: !!j.sansVote } : null,
    joueurs, action, gagnant: p.gagnant,
  };
}

module.exports = {
  ROLES, SPECIAUX, CHRONOS_DEFAUT, MIN_JOUEURS, MAX_JOUEURS,
  compositionDefaut, compositionTexte, lireReglages, normaliser,
  creer, ouverture, commande, echeance, parole, meute, vue, verdict, trouver, aide,
};
