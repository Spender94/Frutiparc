'use strict';
const FPI18n = require('./public/js/i18n.js');
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
 *   { a: 'public', t, tr }       une annonce de la partie, à tout le salon
 *   { a: 'info', t, tr }         une petite ligne grise, à tout le salon
 *   { a: 'secret', u, t, tr }    à un joueur seul (son rôle, son action de nuit…)
 *   { a: 'meneur', t, tr }       au meneur seul (qui fait quoi, la nuit)
 *   { a: 'fin', camp, gagnants, prix }   la partie est jouée
 * Le texte est brut ; « **gras** » et les retours à la ligne y sont permis.
 *
 * DANS LA LANGUE DE CHACUN. `t` est le texte en français ; `tr` le même,
 * TRADUISIBLE — { k, fr, p }, une clé de la zone « loupgarou », son
 * français, ses paramètres (cf. `texteDe` dans server.js) —, que le serveur
 * dit dans la langue de chaque joueur (i18n-serveur/en/loupgarou.js). Le
 * français reste écrit ici, à l'endroit où la phrase part. Un paramètre peut
 * être lui-même un texte à clé : le nom d'un rôle (« Voyante », « Seer »),
 * « A (n°1) » (`quiT`), une liste (`liste`), des lignes (`lignes`). `rendre`
 * fait le texte d'une langue.
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

// ── Les textes ───────────────────────────────────────────────────────────────

// Un texte à clé de la zone, et son pluriel ({n} vaut le nombre).
const T = (k, fr, p) => ({ k: 'loupgarou.' + k, fr, p });
const Tn = (k, n, one, other, p) => ({ k: 'loupgarou.' + k, n, formes: { one, other }, p });
// Le texte dans une langue (le français : l'argument de repli de chaque clé).
function rendre(lang, t) {
  if (t == null) return '';
  if (typeof t !== 'object' || typeof t.k !== 'string') return String(t);
  const p = {};
  for (const nom of Object.keys(t.p || {})) {
    const v = t.p[nom];
    p[nom] = v && typeof v === 'object' && typeof v.k === 'string' ? rendre(lang, v) : v;
  }
  return t.formes !== undefined ? FPI18n.pluriel(lang, t.k, Number(t.n), t.formes, p) : FPI18n.traduire(lang, t.k, t.fr, p);
}
// Des lignes (textes ou chaînes) les unes sous les autres, et une liste sur
// une ligne (`sep` entre deux) : chaque morceau se dit dans la langue, et le
// tout se range comme un texte à clé.
function lignes(l) {
  const p = {};
  l.forEach((x, i) => { p['l' + i] = x; });
  return T('lignes', l.map((x, i) => '{l' + i + '}').join('\n'), p);
}
function liste(l, sep) {
  const p = { sep };
  l.forEach((x, i) => { p['x' + i] = x; });
  return T('liste', l.map((x, i) => '{x' + i + '}').join(sep), p);
}
const roleT = (r) => T('role.' + r, nomRole(r));
const rolesT = (r) => T('roles.' + r, (ROLES[r] || {}).pluriel || r);
const descT = (r) => T('desc.' + r, (ROLES[r] || {}).desc || '');
const quiT = (j) => T('qui', '{nom} (n°{n})', { nom: j.nom, n: j.n });

// ── Petits outils ─────────────────────────────────────────────────────────────

function normaliser(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function rangDans(liste, rnd) { return Math.floor((rnd || Math.random)() * liste.length) % liste.length; }
// Une phrase tirée d'une liste, avec sa clé (`<famille>.<rang>`).
function tirerDans(liste, rnd, famille) { const i = rangDans(liste, rnd); return T(famille + '.' + i, liste[i]); }
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
function compositionCompte(roles) {
  const compte = {};
  for (const r of roles) compte[r] = (compte[r] || 0) + 1;
  return { compte, ordre: ['loup'].concat(SPECIAUX, ['villageois']).filter((r) => compte[r]) };
}
/** « 2 Loups-garous, 1 Voyante, … » */
function compositionTexte(roles) {
  const { compte, ordre } = compositionCompte(roles);
  return ordre.map((r) => `${compte[r]} ${compte[r] > 1 ? ROLES[r].pluriel : ROLES[r].nom}`).join(', ');
}
// La même, traduisible : chaque langue la recompose depuis le compte des rôles.
function compositionT(roles) {
  const { compte, ordre } = compositionCompte(roles);
  return T('composition', '{texte}', { texte: compositionTexte(roles), compte: ordre.map((r) => `${r}=${compte[r]}`).join(',') });
}
const compositionDe = (p) => compositionT(p.joueurs.map((j) => j.role).filter(Boolean));

/**
 * Les réglages tapés après « lancer » (ou « chrono ») :
 *   loups=3  +idiot  -cupidon  idiot  nuit=45  debat=120  vote=60  prix=20
 * (et leurs mots anglais : wolves=3 +seer -cupid night=45 debate=120 prize=20)
 */
const CHRONO_EN = { night: 'nuit', witch: 'sorciere', debate: 'debat', hunter: 'chasseur', evening: 'soir' };
const ROLE_ALIAS = { sorcier: 'sorciere', salva: 'salvateur', idiots: 'idiot', voyant: 'voyante',
  seer: 'voyante', witch: 'sorciere', hunter: 'chasseur', cupid: 'cupidon', defender: 'salvateur', protector: 'salvateur', bodyguard: 'salvateur' };
function lireReglages(args) {
  const out = { loups: null, plus: [], moins: [], chronos: {}, prix: null, erreurs: [] };
  for (const brut of args) {
    const a = normaliser(brut);
    if (!a) continue;
    let m;
    if ((m = /^(?:loups?|wolf|wolves)=(\d{1,2})$/.exec(a))) { out.loups = Number(m[1]); continue; }
    if ((m = /^(?:prix|prize)=(\d{1,5})$/.exec(a))) { out.prix = Number(m[1]); continue; }
    if ((m = /^(nuit|sorciere|debat|vote|chasseur|soir|night|witch|debate|hunter|evening)=(\d{1,4})$/.exec(a))) {
      const cle = CHRONO_EN[m[1]] || m[1];
      const [lo, hi] = CHRONO_BORNES[cle];
      out.chronos[cle] = Math.max(lo, Math.min(hi, Number(m[2])));
      continue;
    }
    if ((m = /^([+-]?)([a-z]+)$/.exec(a))) {
      const r = ROLE_ALIAS[m[2]] || m[2];
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

function Ctx(p, now, rnd) {
  const evts = [];
  // Un événement : le français (`t`) et, pour un texte à clé, sa forme traduisible (`tr`).
  const ev = (a, t, u) => {
    const e = u === undefined ? { a } : { a, u };
    e.t = rendre('fr', t);
    if (t && typeof t === 'object') e.tr = t;
    return e;
  };
  return {
    p, now: now || Date.now(), rnd: rnd || Math.random, evts,
    pub: (t) => evts.push(ev('public', t)),
    info: (t) => evts.push(ev('info', t)),
    sec: (u, t) => evts.push(ev('secret', t, u)),
    men: (t) => evts.push(ev('meneur', t)),
  };
}

/** L'annonce d'ouverture (le serveur l'envoie juste après creer). */
function ouverture(p) {
  const c = Ctx(p);
  const prix = p.options.prix ? T('ouverture.prix', ' À la clé : **{n} kikooz** pour chaque gagnant !', { n: p.options.prix }) : '';
  c.pub(T('ouverture', 'Une partie de LOUP-GAROU commence ! Meneur : {meneur}.{prix}\nPour jouer, tapez **/lg jouer** (sur mobile : le bouton « Je joue »). De {min} à {max} joueurs.',
    { meneur: p.meneurNom, prix, min: MIN_JOUEURS, max: MAX_JOUEURS }));
  return c.evts;
}

function inscrire(c, u, nom) {
  const p = c.p;
  if (p.phase !== 'inscriptions') return c.sec(u, T('inscrire.tard', 'La partie a déjà commencé : attends la prochaine !'));
  if (u === p.meneur) return c.sec(u, T('inscrire.meneur', 'Tu mènes la partie : le meneur ne joue pas (il sait tout !).'));
  if (joueurDe(p, u)) return c.sec(u, T('inscrire.deja', 'Tu es déjà inscrit à la partie.'));
  if (p.joueurs.length >= MAX_JOUEURS) return c.sec(u, T('inscrire.complet', 'La partie est complète ({max} joueurs).', { max: MAX_JOUEURS }));
  p.joueurs.push({ u, nom: String(nom || u), n: p.joueurs.length + 1, role: null, vivant: true, amoureux: null, revele: false, sansVote: false });
  c.info(Tn('inscrire.rejoint', p.joueurs.length, '{nom} rejoint la partie ({n} joueur).', '{nom} rejoint la partie ({n} joueurs).', { nom }));
}
function desinscrire(c, u, parQui) {
  const p = c.p;
  const j = joueurDe(p, u);
  if (!j) return c.sec(parQui || u, parQui ? T('desinscrire.pasCeJoueur', 'Ce joueur n’est pas inscrit.') : T('desinscrire.pasInscrit', 'Tu n’es pas inscrit.'));
  if (p.phase !== 'inscriptions') {
    return c.sec(parQui || u, parQui ? T('desinscrire.lanceeMeneur', 'La partie est lancée : utilise /lg eliminer.')
      : T('desinscrire.lancee', 'La partie est lancée : on ne quitte plus le village ! (Le meneur peut t’en retirer.)'));
  }
  p.joueurs = p.joueurs.filter((x) => x.u !== u);
  p.joueurs.forEach((x, i) => { x.n = i + 1; });
  c.info(Tn('desinscrire.quitte', p.joueurs.length, '{nom} quitte la partie ({n} joueur).', '{nom} quitte la partie ({n} joueurs).', { nom: j.nom }));
}

/**
 * Retrouve un joueur : son numéro, son pseudo, le début de son pseudo.
 * → { j } ou { erreur, erreurT } (le français, et le même traduisible).
 */
function trouver(p, arg, filtre) {
  const pool = p.joueurs.filter(filtre || (() => true));
  const a = normaliser(arg).replace(/^n°|^#/, '');
  const err = (t) => ({ erreur: rendre('fr', t), erreurT: t });
  const pasChoisi = (j) => err(T('trouver.pasChoisi', '{nom} ne peut pas être choisi.', { nom: j.nom }));
  if (!a) return err(T('trouver.indique', 'Indique un joueur (son numéro ou son pseudo).'));
  if (/^\d+$/.test(a)) {
    const j = p.joueurs.find((x) => x.n === Number(a));
    if (!j) return err(T('trouver.numero', 'Pas de joueur n°{n}.', { n: a }));
    if (!pool.includes(j)) return pasChoisi(j);
    return { j };
  }
  const exact = pool.filter((j) => normaliser(j.nom) === a || normaliser(j.u) === a);
  if (exact.length === 1) return { j: exact[0] };
  const debut = pool.filter((j) => normaliser(j.nom).startsWith(a));
  if (debut.length === 1) return { j: debut[0] };
  const dedans = debut.length ? debut : pool.filter((j) => normaliser(j.nom).includes(a));
  if (dedans.length === 1) return { j: dedans[0] };
  if (dedans.length > 1) return err(T('trouver.plusieurs', 'Plusieurs joueurs correspondent : {noms}. Donne le numéro.', { noms: dedans.map((j) => j.nom).join(', ') }));
  const ailleurs = p.joueurs.find((j) => normaliser(j.nom) === a || normaliser(j.nom).startsWith(a));
  if (ailleurs) return pasChoisi(ailleurs);
  return err(T('trouver.introuvable', 'Je ne trouve pas « {arg} » parmi les joueurs.', { arg }));
}

// ── Le lancement ─────────────────────────────────────────────────────────────

function lancer(c, args) {
  const p = c.p;
  if (p.phase !== 'inscriptions') return c.men(T('lancer.deja', 'La partie est déjà lancée.'));
  const n = p.joueurs.length;
  if (n < MIN_JOUEURS) return c.men(T('lancer.pasAssez', 'Il faut au moins {min} joueurs (inscrits : {n}).', { min: MIN_JOUEURS, n }));
  const r = lireReglages(args || []);
  if (r.erreurs.length) c.men(T('lancer.pasCompris', 'Je n’ai pas compris : {liste} (ignoré).', { liste: r.erreurs.join(', ') }));
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
  c.pub(T('lancer.distribues', 'Les rôles sont distribués ! Dans ce village de {n} : {compo}.\nChacun a reçu son rôle en secret (tape **/lg role** pour le revoir).',
    { n, compo: compositionT(roles) }));
  for (const j of p.joueurs) c.sec(j.u, texteRole(p, j));
  c.men(lignes([T('roles.titre', 'Les rôles :')].concat(p.joueurs.map((j) => T('roles.ligne', '{n}. {nom} — {role}', { n: j.n, nom: j.nom, role: roleT(j.role) })))));
  commencerNuit(c);
}

function texteRole(p, j) {
  const l = [T('role.tuEs', 'Tu es **{role}**. {desc}', { role: roleT(j.role), desc: descT(j.role) })];
  if (COMMANDE_ROLE[j.role]) l.push(T('role.commande', 'Ta commande : {commande}', { commande: T('commande.' + j.role, COMMANDE_ROLE[j.role]) }));
  if (j.role === 'loup') {
    const autres = p.joueurs.filter((x) => x.role === 'loup' && x.u !== j.u);
    l.push(autres.length
      ? T('role.meute', 'Ta meute : {meute}.', { meute: liste(autres.map((x) => (x.vivant ? quiT(x) : T('mort', '{qui} †', { qui: quiT(x) }))), ', ') })
      : T('role.seul', 'Tu chasses seul.'));
    l.push(T('role.nuitLoup', 'La nuit, tout ce que tu écris dans le salon n’est lu que par la meute ; le jour, **/lg meute <message>** lui parle en secret.'));
  }
  if (j.role === 'sorciere') {
    const etatPotion = (prete) => (prete ? T('potion.prete', 'prête') : T('potion.utilisee', 'utilisée'));
    l.push(T('role.potions', 'Potions : vie {vie}, mort {mort}.', { vie: etatPotion(p.potions.vie), mort: etatPotion(p.potions.mort) }));
  }
  if (j.amoureux) { const a = joueurDe(p, j.amoureux); if (a) l.push(T('role.amour', 'Ton amour : {qui}.', { qui: quiT(a) })); }
  if (j.role === 'idiot' && j.revele) l.push(T('role.demasque', 'Démasqué : tu ne votes plus.'));
  return lignes(l);
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
  c.pub(T('nuit.debut', 'NUIT {n}. {phrase}\n(Le salon se tait jusqu’au matin. Ceux qui ont un rôle de nuit ont reçu leurs instructions en secret.)',
    { n: p.nuit, phrase: tirerDans(NUITS, c.rnd, 'nuits') }));
  const meute = loupsVivants(p);
  const proies = vivants(p).filter((j) => j.role !== 'loup');
  for (const l of meute) {
    const texte = [
      T('nuit.meute', 'Nuit {n} : la meute se réveille. Désignez votre victime : **/lg devorer <numéro>** (il faut vous mettre d’accord).', { n: p.nuit }),
      T('nuit.proies', 'Proies : {liste}', { liste: listeNum(proies) }),
    ];
    if (meute.length > 1) texte.push(T('nuit.laMeute', 'La meute : {noms}. Écrivez dans le salon : seuls les loups vous lisent.', { noms: meute.map((x) => x.nom).join(', ') }));
    c.sec(l.u, lignes(texte));
  }
  const voy = roleVivant(p, 'voyante');
  if (voy) {
    c.sec(voy.u, lignes([T('nuit.voyante', 'Nuit {n} : ta boule de cristal s’allume. Quel rôle veux-tu découvrir ? **/lg voir <numéro>**', { n: p.nuit }),
      listeNum(vivants(p).filter((j) => j.u !== voy.u))]));
  }
  const sal = roleVivant(p, 'salvateur');
  if (sal) {
    const avant = joueurDe(p, p.protegeAvant);
    c.sec(sal.u, lignes([avant && avant.vivant
      ? T('nuit.salvateurPas', 'Nuit {n} : qui protèges-tu des loups ? **/lg proteger <numéro>** (toi compris) — pas {nom}, protégé la nuit dernière.', { n: p.nuit, nom: avant.nom })
      : T('nuit.salvateur', 'Nuit {n} : qui protèges-tu des loups ? **/lg proteger <numéro>** (toi compris).', { n: p.nuit }),
    listeNum(vivants(p).filter((j) => j.u !== p.protegeAvant))]));
  }
  const cup = p.nuit === 1 ? roleVivant(p, 'cupidon') : null;
  if (cup) {
    c.sec(cup.u, lignes([T('nuit.cupidon', 'Première nuit : décoche ta flèche ! Désigne deux amoureux : **/lg lier <numéro> <numéro>** (toi compris si tu veux).'),
      listeNum(vivants(p))]));
  }
  const actifs = [T('nuit.actifMeute', 'la meute ({noms})', { noms: meute.map((x) => x.nom).join(', ') })];
  if (voy) actifs.push(T('nuit.actifVoyante', 'la voyante ({nom})', { nom: voy.nom }));
  if (sal) actifs.push(T('nuit.actifSalvateur', 'le salvateur ({nom})', { nom: sal.nom }));
  if (cup) actifs.push(T('nuit.actifCupidon', 'cupidon ({nom})', { nom: cup.nom }));
  c.men(T('nuit.meneur', 'Nuit {n} ({duree} au plus) : {actifs}.', { n: p.nuit, duree: duree(p.options.chronos.nuit), actifs: liste(actifs, ', ') }));
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
  const tete = Object.keys(compte).filter((u) => compte[u] === max);
  return tete[rangDans(tete, c.rnd)];
}

function finEtapeNuit(c) {
  const p = c.p;
  const meute = loupsVivants(p);
  const accord = meute.length && meute.every((l) => p.n.loups[l.u] && p.n.loups[l.u] === p.n.loups[meute[0].u]);
  p.n.cible = victimeDesLoups(c);
  const cible = joueurDe(p, p.n.cible);
  if (!accord) {
    for (const l of meute) {
      c.sec(l.u, cible ? T('nuit.fauteAccord', 'Le temps presse : faute d’accord, la meute se jette sur {qui}.', { qui: quiT(cible) })
        : T('nuit.personneChoisi', 'La meute n’a choisi personne cette nuit.'));
    }
  }
  c.men(cible
    ? (p.n.protege === cible.u ? T('nuit.devoreProtege', 'La meute dévore {qui} (protégé par le salvateur !).', { qui: quiT(cible) })
      : T('nuit.devore', 'La meute dévore {qui}.', { qui: quiT(cible) }))
    : T('nuit.devorePersonne', 'La meute ne dévore personne.'));
  const sor = roleVivant(p, 'sorciere');
  const utile = sor && ((p.potions.vie && cible) || p.potions.mort);
  if (utile) {
    p.etape = 'sorciere';
    p.echeance = c.now + p.options.chronos.sorciere * 1000;
    const options = [];
    if (p.potions.vie && cible) options.push(T('sorciere.optVie', '**/lg sauver** (potion de vie)'));
    if (p.potions.mort) options.push(T('sorciere.optMort', '**/lg tuer <numéro>** (potion de mort)'));
    options.push(T('sorciere.optRien', '**/lg rien**'));
    c.sec(sor.u, lignes([
      cible ? T('sorciere.attaque', 'Cette nuit, les loups ont attaqué {qui}.', { qui: quiT(cible) }) : T('sorciere.attaquePersonne', 'Cette nuit, les loups n’ont attaqué personne.'),
      T('sorciere.chaudron', 'Ton chaudron bouillonne : {options}', { options: liste(options, ' · ') }),
      listeNum(vivants(p).filter((j) => j.u !== sor.u)),
    ]));
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
  c.pub(tirerDans(AUBES, c.rnd, 'aubes'));
  const encore = morts.filter((u) => (joueurDe(p, u) || {}).vivant);
  if (!encore.length) c.pub(tirerDans(PERSONNE, c.rnd, 'personne'));
  for (const u of melanger(encore, c.rnd)) tuer(c, u, 'nuit');
  suiteApresMorts(c, 'jour');
}

// ── Les morts ────────────────────────────────────────────────────────────────

// La mort d'un joueur, selon sa cause, et le rôle qu'on découvre.
const MORTS = {
  nuit: 'Au petit matin, on découvre que {qui} ne se réveillera pas. Rôle : **{role}**.',
  vote: 'Le village a tranché : {qui} est chassé du village. Rôle : **{role}**.',
  chasseur: 'PAN ! Le chasseur emporte {qui} dans sa chute. Rôle : **{role}**.',
  chagrin: 'Le cœur brisé, {qui} rejoint son amour dans la tombe. Rôle : **{role}**.',
  meneur: 'La foudre du meneur s’abat sur {qui} ! Rôle : **{role}**.',
};
function tuer(c, u, cause) {
  const p = c.p;
  const j = joueurDe(p, u);
  if (!j || !j.vivant) return;
  j.vivant = false;
  j.cause = cause;
  c.pub(T('mort.' + cause, MORTS[cause], { qui: quiT(j), role: roleT(j.role) }));
  c.sec(j.u, T('mort.quitte', 'Tu as quitté la partie. Tu peux la suivre, mais plus un mot jusqu’à la fin : les morts ne parlent pas !'));
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
    c.pub(T('chasseur.annonce', '{nom} était chasseur… et il lui reste une balle. Il a {duree} pour viser.', { nom: ch.nom, duree: duree(p.options.chronos.chasseur) }));
    c.sec(ch.u, lignes([T('chasseur.fusil', 'Dans un dernier souffle, tu épaules ton fusil : **/lg tirer <numéro>**.'), listeNum(vivants(p))]));
    return;
  }
  p.chasseur = null;
  const v = verdict(p);
  if (v) return fin(c, v);
  if (ensuite === 'jour') return commencerJour(c);
  if (ensuite === 'soir') return commencerSoir(c);
  return commencerNuit(c);
}

/** La partie est-elle jouée ? { camp, gagnants, texte, texteT } (le français, et le même traduisible) ou null. */
function verdict(p) {
  const vv = vivants(p);
  const dit = (o, t) => Object.assign(o, { texte: rendre('fr', t), texteT: t });
  if (!vv.length) return dit({ camp: 'personne', gagnants: [] }, T('verdict.personne', 'Il ne reste plus personne… Le village est désert : match nul !'));
  if (vv.length === 2 && vv[0].amoureux === vv[1].u && ROLES[vv[0].role].camp !== ROLES[vv[1].role].camp) {
    return dit({ camp: 'amoureux', gagnants: vv.map((j) => j.u) },
      T('verdict.amoureux', 'Seuls au monde, {a} et {b} s’enfuient main dans la main : **victoire des amoureux** !', { a: vv[0].nom, b: vv[1].nom }));
  }
  const loups = vv.filter((j) => j.role === 'loup').length;
  if (!loups) {
    return dit({ camp: 'village', gagnants: p.joueurs.filter((j) => ROLES[j.role].camp === 'village').map((j) => j.u) },
      T('verdict.village', 'Le dernier loup est tombé : **victoire du village** ! Ce soir, on danse sur la place.'));
  }
  if (loups >= vv.length - loups) {
    return dit({ camp: 'loups', gagnants: p.joueurs.filter((j) => j.role === 'loup').map((j) => j.u) },
      T('verdict.loups', 'Les loups sont maintenant aussi nombreux que les villageois : la meute se jette sur les derniers. **Victoire des loups-garous** !'));
  }
  return null;
}

function recapitulatif(p) {
  return lignes(p.joueurs.map((j) => T('recap.ligne', '{n}. {nom} — {role}{coeur}{vie}', {
    n: j.n, nom: j.nom, role: roleT(j.role), coeur: j.amoureux ? ' ♥' : '', vie: j.vivant ? T('recap.enVie', ' (en vie)') : '',
  })));
}
function fin(c, v) {
  const p = c.p;
  p.phase = 'fin';
  p.etape = null;
  p.echeance = null;
  p.pause = null;
  p.gagnant = v.camp;
  p.gagnants = v.gagnants;
  c.pub(lignes([v.texteT, T('roles.titre', 'Les rôles :'), recapitulatif(p)]));
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
  c.pub(lignes([
    d ? T('jour.debut', 'JOUR {n} : le village débat. Qui sont les loups ? Le vote s’ouvre dans {duree}.', { n: p.jour, duree: duree(d) })
      : T('jour.debutMeneur', 'JOUR {n} : le village débat. Qui sont les loups ? Le meneur ouvrira le vote.', { n: p.jour }),
    T('jour.vivants', 'Encore en vie : {liste}', { liste: listeNum(vivants(p)) }),
  ]));
}
function commencerVote(c) {
  const p = c.p;
  p.phase = 'vote';
  p.votes = {};
  p.echeance = c.now + p.options.chronos.vote * 1000;
  c.pub(lignes([T('vote.ouvert', 'AUX URNES ! **/lg voter <numéro>** (ou « /lg voter blanc »). Clôture dans {duree}, ou dès que tout le monde a voté.', { duree: duree(p.options.chronos.vote) }),
    listeNum(vivants(p))]));
}
const votants = (p) => vivants(p).filter((j) => !j.sansVote);
const pasEncoreVote = () => T('vote.pasOuvert', 'Le vote n’est pas encore ouvert : débattez !');
function voter(c, j, arg) {
  const p = c.p;
  if (p.phase !== 'vote') return c.sec(j.u, p.phase === 'jour' ? pasEncoreVote() : T('vote.pasLeMoment', 'Ce n’est pas le moment de voter.'));
  if (j.sansVote) return c.sec(j.u, T('vote.idiot', 'Démasqué, l’idiot du village ne vote plus.'));
  const avant = Object.prototype.hasOwnProperty.call(p.votes, j.u);
  if (/^(blanc|personne|abstention|0|blank|none|nobody|abstain)$/.test(normaliser(arg))) {
    p.votes[j.u] = null;
    c.info(T('vote.blanc', '{nom} vote blanc.', { nom: j.nom }));
  } else {
    const r = trouver(p, arg, (x) => x.vivant && x.u !== j.u);
    if (r.erreur) return c.sec(j.u, r.erreurT);
    if (p.votes[j.u] === r.j.u) return c.sec(j.u, T('vote.deja', 'Tu votes déjà contre {nom}.', { nom: r.j.nom }));
    p.votes[j.u] = r.j.u;
    const n = Object.values(p.votes).filter((x) => x === r.j.u).length;
    c.info(avant ? Tn('vote.changeAvis', n, '{nom} change d’avis : vote contre {cible} ({n} voix).', '{nom} change d’avis : vote contre {cible} ({n} voix).', { nom: j.nom, cible: r.j.nom })
      : Tn('vote.contre', n, '{nom} vote contre {cible} ({n} voix).', '{nom} vote contre {cible} ({n} voix).', { nom: j.nom, cible: r.j.nom }));
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
  const resultats = Object.entries(compte).sort((a, b) => b[1] - a[1]).map(([u, n]) => `${joueurDe(p, u).nom} ${n}`);
  if (blancs) resultats.push(T('vote.nbBlancs', 'blanc {n}', { n: blancs }));
  const absents = votants(p).filter((x) => !Object.prototype.hasOwnProperty.call(p.votes, x.u)).length;
  if (absents) resultats.push(T('vote.nbSansVote', 'sans vote {n}', { n: absents }));
  const max = Math.max(0, ...Object.values(compte));
  const tete = Object.keys(compte).filter((u) => compte[u] === max);
  c.pub(T('vote.clos', 'Le vote est clos. {resultats}', { resultats: resultats.length ? liste(resultats, ' · ') : T('vote.aucuneVoix', 'Aucune voix.') }));
  p.votes = {};
  if (!max || tete.length > 1) {
    c.pub(max ? T('vote.egalite', 'Égalité ! Le village n’arrive pas à se décider : personne n’est chassé aujourd’hui.')
      : T('vote.personne', 'Personne n’a voté : personne n’est chassé aujourd’hui.'));
    return commencerSoir(c);
  }
  const elu = joueurDe(p, tete[0]);
  if (elu.role === 'idiot' && !elu.revele) {
    elu.revele = true;
    elu.sansVote = true;
    c.pub(T('vote.idiotEpargne', 'Le village s’apprête à chasser {qui}… mais c’est l’**Idiot du village** ! On l’épargne en riant. Il reste parmi nous, mais ne votera plus.', { qui: quiT(elu) }));
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
  c.info(T('soir', 'Le soleil se couche… la nuit tombe dans {duree}.', { duree: duree(p.options.chronos.soir) }));
}

// ── Les actions de nuit ──────────────────────────────────────────────────────

function enNuit(c, j, etape) {
  if (c.p.phase !== 'nuit' || c.p.etape !== (etape || 'nuit')) { c.sec(j.u, T('pasLeMoment', 'Ce n’est pas le moment.')); return false; }
  return true;
}
function devorer(c, j, arg) {
  const p = c.p;
  if (j.role !== 'loup') return c.sec(j.u, T('devorer.pasLoup', 'Tu n’es pas un loup-garou… du moins, pas officiellement.'));
  if (!enNuit(c, j)) return;
  const r = trouver(p, arg, (x) => x.vivant);
  if (r.erreur) return c.sec(j.u, r.erreurT);
  if (r.j.role === 'loup') return c.sec(j.u, T('devorer.meute', 'On ne mange pas un membre de la meute !'));
  p.n.loups[j.u] = r.j.u;
  const meute = loupsVivants(p);
  for (const l of meute) c.sec(l.u, T('devorer.veut', 'Meute — {nom} veut dévorer {qui}.', { nom: j.nom, qui: quiT(r.j) }));
  c.men(T('devorer.meneur', '{nom} (loup) veut dévorer {qui}.', { nom: j.nom, qui: quiT(r.j) }));
  const choix = meute.map((l) => p.n.loups[l.u]);
  if (meute.length > 1 && choix.every((x) => x === r.j.u)) for (const l of meute) c.sec(l.u, T('devorer.accord', 'La meute est d’accord : ce sera {qui}.', { qui: quiT(r.j) }));
  peutEtreFinNuit(c);
}
function voir(c, j, arg) {
  const p = c.p;
  if (j.role !== 'voyante') return c.sec(j.u, T('voir.pasVoyante', 'Tu n’as pas de boule de cristal.'));
  if (!enNuit(c, j)) return;
  if (p.n.vu) return c.sec(j.u, T('voir.eteinte', 'Ta boule de cristal s’est éteinte pour cette nuit.'));
  const r = trouver(p, arg, (x) => x.vivant && x.u !== j.u);
  if (r.erreur) return c.sec(j.u, r.erreurT);
  p.n.vu = r.j.u;
  c.sec(j.u, r.j.role === 'loup' ? T('voir.loup', 'Ta boule de cristal s’éclaire : {qui} est **{role}** !', { qui: quiT(r.j), role: roleT(r.j.role) })
    : T('voir.role', 'Ta boule de cristal s’éclaire : {qui} est **{role}**.', { qui: quiT(r.j), role: roleT(r.j.role) }));
  c.men(T('voir.meneur', 'La voyante ({nom}) sonde {qui} : {role}.', { nom: j.nom, qui: quiT(r.j), role: roleT(r.j.role) }));
  peutEtreFinNuit(c);
}
function proteger(c, j, arg) {
  const p = c.p;
  if (j.role !== 'salvateur') return c.sec(j.u, T('proteger.pasSalvateur', 'Tu n’es pas le salvateur.'));
  if (!enNuit(c, j)) return;
  const r = trouver(p, arg, (x) => x.vivant);
  if (r.erreur) return c.sec(j.u, r.erreurT);
  if (r.j.u === p.protegeAvant) return c.sec(j.u, T('proteger.deuxFois', 'Tu as protégé {nom} la nuit dernière : choisis quelqu’un d’autre.', { nom: r.j.nom }));
  p.n.protege = r.j.u;
  c.sec(j.u, T('proteger.veille', 'Cette nuit, tu veilles sur {qui}.', { qui: quiT(r.j) }));
  c.men(T('proteger.meneur', 'Le salvateur ({nom}) protège {qui}.', { nom: j.nom, qui: quiT(r.j) }));
  peutEtreFinNuit(c);
}
function lier(c, j, a1, a2) {
  const p = c.p;
  if (j.role !== 'cupidon') return c.sec(j.u, T('lier.pasCupidon', 'Tu n’as ni arc ni flèches.'));
  if (!enNuit(c, j) || p.nuit !== 1) return p.nuit !== 1 && p.phase === 'nuit' ? c.sec(j.u, T('lier.premiereNuit', 'Ta flèche est déjà partie la première nuit.')) : undefined;
  if (p.n.lies) return c.sec(j.u, T('lier.deja', 'Ta flèche est déjà partie.'));
  const r1 = trouver(p, a1, (x) => x.vivant), r2 = trouver(p, a2, (x) => x.vivant);
  if (r1.erreur || r2.erreur) return c.sec(j.u, r1.erreurT || r2.erreurT);
  if (r1.j.u === r2.j.u) return c.sec(j.u, T('lier.deux', 'Il faut deux amoureux différents !'));
  r1.j.amoureux = r2.j.u;
  r2.j.amoureux = r1.j.u;
  p.n.lies = [r1.j.u, r2.j.u];
  for (const [x, y] of [[r1.j, r2.j], [r2.j, r1.j]]) {
    c.sec(x.u, T('lier.fleche', 'Une flèche de Cupidon ! Ton cœur bat désormais pour {qui}. Si l’un de vous meurt, l’autre meurt de chagrin. Si vous êtes les deux derniers en vie, vous gagnez ensemble, quels que soient vos camps.', { qui: quiT(y) }));
  }
  if (j.u !== r1.j.u && j.u !== r2.j.u) c.sec(j.u, T('lier.touche', 'Ta flèche a touché : {a} et {b} sont amoureux.', { a: r1.j.nom, b: r2.j.nom }));
  c.men(T('lier.meneur', 'Cupidon ({nom}) lie {a} et {b}.', { nom: j.nom, a: quiT(r1.j), b: quiT(r2.j) }));
  peutEtreFinNuit(c);
}
function sorciere(c, j, quoi, arg) {
  const p = c.p;
  if (j.role !== 'sorciere') return c.sec(j.u, T('sorciere.pasSorciere', 'Tu n’as pas de chaudron.'));
  if (!enNuit(c, j, 'sorciere')) return;
  const cible = joueurDe(p, p.n.cible);
  if (quoi === 'sauver') {
    if (!p.potions.vie) return c.sec(j.u, T('sorciere.vieBue', 'Ta potion de vie est déjà bue.'));
    if (!cible) return c.sec(j.u, T('sorciere.personneASauver', 'Personne à sauver cette nuit.'));
    if (p.n.sauve) return c.sec(j.u, T('sorciere.dejaFait', 'C’est déjà fait.'));
    p.potions.vie = false;
    p.n.sauve = true;
    c.sec(j.u, T('sorciere.sauve', 'Tu verses la potion de vie : {nom} se réveillera demain.', { nom: cible.nom }));
    c.men(T('sorciere.sauveMeneur', 'La sorcière ({nom}) sauve {qui}.', { nom: j.nom, qui: quiT(cible) }));
  } else if (quoi === 'tuer') {
    if (!p.potions.mort) return c.sec(j.u, T('sorciere.mortUtilisee', 'Ta potion de mort est déjà utilisée.'));
    const r = trouver(p, arg, (x) => x.vivant && x.u !== j.u);
    if (r.erreur) return c.sec(j.u, r.erreurT);
    p.potions.mort = false;
    p.n.poison = r.j.u;
    c.sec(j.u, T('sorciere.poison', 'Quelques gouttes dans le verre de {nom}… Le poison fera effet avant l’aube.', { nom: r.j.nom }));
    c.men(T('sorciere.poisonMeneur', 'La sorcière ({nom}) empoisonne {qui}.', { nom: j.nom, qui: quiT(r.j) }));
  } else {
    c.sec(j.u, T('sorciere.bonneNuit', 'Tu refermes ton grimoire. Bonne nuit.'));
    return aube(c);
  }
  const reste = (p.potions.vie && cible && !p.n.sauve) || p.potions.mort;
  if (reste) {
    c.sec(j.u, T('sorciere.autre', 'Autre chose ? {sauver}{tuer}**/lg rien** pour finir ta nuit.', {
      sauver: p.potions.vie && cible && !p.n.sauve ? T('sorciere.encoreSauver', '**/lg sauver** · ') : '',
      tuer: p.potions.mort ? T('sorciere.encoreTuer', '**/lg tuer <numéro>** · ') : '',
    }));
  } else aube(c);
}
function tirer(c, j, arg) {
  const p = c.p;
  if (p.phase !== 'chasseur' || p.chasseur !== j.u) {
    return c.sec(j.u, j.role === 'chasseur' ? T('tirer.pasEncore', 'Ton fusil ne servira qu’à ta mort.') : T('tirer.pasDeFusil', 'Tu n’as pas de fusil.'));
  }
  const r = trouver(p, arg, (x) => x.vivant);
  if (r.erreur) return c.sec(j.u, r.erreurT);
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
    if (s) c.sec(s.u, T('sorciere.tropTard', 'Trop tard : l’aube se lève.'));
    aube(c);
  } else if (p.phase === 'jour') commencerVote(c);
  else if (p.phase === 'vote') depouiller(c);
  else if (p.phase === 'chasseur') {
    const ch = joueurDe(p, p.chasseur);
    c.pub(ch ? T('chasseur.tropTard', '{nom} n’a pas eu le temps de tirer.', { nom: ch.nom }) : T('chasseur.tropTardAnonyme', 'Le chasseur n’a pas eu le temps de tirer.'));
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
  if (p.phase === 'fin') return c.men(T('suite.finie', 'La partie est terminée. /lg ouvrir pour en lancer une autre.'));
  p.pause = null;
  p.echeance = c.now;
  c.evts.push(...echeance(p, c.now, c.rnd));
}

// ── La parole ────────────────────────────────────────────────────────────────

/**
 * Peut-il parler dans le salon ? { ok } ; { meute } (la nuit, un loup : relayé
 * à la meute) ; { ok: false, raison, raisonT } (le français, et le même traduisible).
 */
function parole(p, u, staff) {
  if (!p || p.phase === 'inscriptions' || p.phase === 'fin') return { ok: true };
  const j = joueurDe(p, u);
  if (u === p.meneur || (staff && !j)) return { ok: true };
  const non = (t) => ({ ok: false, raison: rendre('fr', t), raisonT: t });
  const mortsSeTaisent = () => T('parole.morts', 'Les morts ne parlent pas… Tu pourras commenter à la fin de la partie.');
  if (p.phase === 'nuit') {
    if (j && j.vivant && j.role === 'loup') return { meute: true };
    return non(j ? (j.vivant ? T('parole.nuit', 'Chut ! C’est la nuit, le village dort. Tu pourras parler au lever du jour.') : mortsSeTaisent())
      : T('parole.salonNuit', 'C’est la nuit dans la partie de loup-garou : le salon se tait jusqu’au matin.'));
  }
  if (j && !j.vivant) return non(mortsSeTaisent());
  return { ok: true };
}
/** Un loup parle à sa meute (la nuit dans le salon, ou /lg meute). */
function meute(p, u, texte) {
  const c = Ctx(p);
  const j = joueurDe(p, u);
  if (!j || j.role !== 'loup' || !j.vivant || p.phase === 'inscriptions' || p.phase === 'fin') {
    c.sec(u, T('meute.pasDeMeute', 'Tu n’as pas de meute à qui parler.'));
    return c.evts;
  }
  const t = String(texte || '').trim().slice(0, 400);
  if (!t) return c.evts;
  // Ce que le loup a écrit part tel quel : on ne traduit jamais un joueur.
  const dit = T('meute.dit', 'Meute — {nom} : {texte}', { nom: j.nom, texte: t });
  for (const l of loupsVivants(p)) c.sec(l.u, dit);
  c.men(dit);
  return c.evts;
}

// ── Les commandes ────────────────────────────────────────────────────────────

/*
 * Les verbes de /lg, avec leurs mots anglais (les salons sont partagés : un
 * anglophone tape « /lg vote 3 », « /lg eat 2 », « /lg see 4 »). Un mot ne
 * sert qu'un verbe : « save » est à la sorcière, « kill » à sa potion de
 * mort, « eat » / « devour » aux loups. Un mot inconnu reste un joueur
 * (« /lg alice » : l'action du moment).
 */
const VERBES = {
  aide: ['aide', 'help', '?', 'commandes', 'commands'],
  jouer: ['jouer', 'joue', 'rejoindre', 'inscription', 'inscrire', 'go', 'join', 'play', 'signup'],
  quitter: ['quitter', 'partir', 'desinscrire', 'leave', 'quit'],
  role: ['role', 'monrole', 'moi', 'myrole'],
  etat: ['etat', 'joueurs', 'qui', 'liste', 'statut', 'status', 'state', 'players', 'who', 'list'],
  voter: ['voter', 'vote', 'contre', 'against'],
  devorer: ['devorer', 'manger', 'croquer', 'mordre', 'devour', 'eat', 'bite'],
  voir: ['voir', 'sonder', 'espionner', 'regarder', 'see', 'probe', 'spy', 'look', 'peek'],
  proteger: ['proteger', 'garder', 'veiller', 'protect', 'guard', 'shield'],
  lier: ['lier', 'aimer', 'flecher', 'amoureux', 'link', 'love', 'lovers', 'pair'],
  sauver: ['sauver', 'soigner', 'vie', 'save', 'heal', 'life'],
  tuer: ['tuer', 'empoisonner', 'poison', 'mort', 'kill', 'death'],
  rien: ['rien', 'passer', 'dormir', 'nothing', 'pass', 'sleep'],
  tirer: ['tirer', 'feu', 'abattre', 'shoot', 'fire'],
  meute: ['meute', 'loup', 'loups', 'pack', 'wolf', 'wolves'],
  // le meneur
  lancer: ['lancer', 'demarrer', 'commencer', 'start', 'launch', 'begin'],
  suite: ['suite', 'suivant', 'next', 'avancer'],
  pause: ['pause', 'stop-chrono'],
  reprise: ['reprise', 'reprendre', 'continuer', 'resume', 'continue'],
  ouvrirvote: ['ouvrirvote', 'urnes', 'votemaintenant', 'openvote', 'polls', 'votenow'],
  eliminer: ['eliminer', 'foudroyer', 'virer', 'eliminate', 'smite', 'zap'],
  ajouter: ['ajouter', 'inscrire+', 'add'],
  retirer: ['retirer', 'enlever', 'remove'],
  chrono: ['chrono', 'chronos', 'temps', 'timer', 'timers', 'time'],
  prix: ['prix', 'prize'],
  roles: ['roles', 'compo'],
  meneur: ['meneur', 'host'],
  fin: ['fin', 'annuler', 'arreter', 'terminer', 'end', 'cancel', 'stop'],
};
const VERBE = {};
for (const [k, l] of Object.entries(VERBES)) for (const a of l) VERBE[a] = k;
const DU_MENEUR = new Set(['lancer', 'suite', 'pause', 'reprise', 'ouvrirvote', 'eliminer', 'ajouter', 'retirer', 'chrono', 'prix', 'roles', 'meneur', 'fin']);

/** L'aide de /lg : le français, et le même traduisible (aideT). */
function aideT(p, u, meneur) {
  const l = [
    'LOUP-GAROU — les commandes (un joueur se désigne par son numéro ou son pseudo) :',
    '/lg jouer · /lg quitter — s’inscrire, se désinscrire',
    '/lg role — revoir ton rôle · /lg etat — la partie, les vivants et les morts',
    '/lg voter <n> — voter le jour (« blanc » pour s’abstenir)',
    'La nuit, selon ton rôle : /lg devorer <n> · /lg voir <n> · /lg proteger <n> · /lg lier <n> <n> · /lg sauver · /lg tuer <n> · /lg rien',
    '/lg tirer <n> — le dernier tir du chasseur · /lg meute <message> — un loup parle à sa meute',
    'Raccourci : /lg <n> fait ton action du moment (voter, dévorer, sonder, protéger, tirer).',
  ];
  if (meneur) {
    l.push('Meneur : /lg ouvrir [prix=N] · /lg ajouter <pseudo> · /lg retirer <pseudo> · /lg lancer [loups=N +idiot -cupidon nuit=60 debat=150 vote=60]',
      'Meneur : /lg suite (étape suivante sans attendre) · /lg vote (ouvrir le vote) · /lg pause · /lg reprise · /lg eliminer <n> · /lg chrono debat=90 · /lg roles · /lg fin',
      `Rôles possibles : ${Object.keys(ROLES).map(nomRole).join(', ')}.`);
  }
  return T('aide', l.join('\n'), { meneur: meneur ? 1 : 0 });
}
function aide(p, u, meneur) { return rendre('fr', aideT(p, u, meneur)); }

/** Où en est la partie (le meneur voit tous les rôles) : traduisible (etatT), et en français. */
function etatT(p, u, meneur) {
  const j = joueurDe(p, u);
  const phase = {
    inscriptions: () => T('phase.inscriptions', 'inscriptions'),
    nuit: () => T('phase.nuit', 'nuit {n}', { n: p.nuit }),
    jour: () => T('phase.jour', 'jour {n}, débat', { n: p.jour }),
    vote: () => T('phase.vote', 'jour {n}, vote', { n: p.jour }),
    chasseur: () => T('phase.chasseur', 'le dernier tir du chasseur'),
    soir: () => T('phase.soir', 'le soir tombe'),
    fin: () => T('phase.fin', 'partie terminée'),
  }[p.phase];
  const l = [T('etat.titre', 'Loup-garou — {phase}{pause}. Meneur : {meneur}.{village}', {
    phase: phase ? phase() : '', pause: p.pause != null ? T('etat.enPause', ' (en pause)') : '', meneur: p.meneurNom,
    village: p.composition ? T('etat.village', ' Village : {compo}.', { compo: compositionDe(p) }) : '',
  })];
  for (const x of p.joueurs) {
    const voitRole = meneur || p.phase === 'fin' || !x.vivant || x.u === u || (x.revele) || (j && j.role === 'loup' && x.role === 'loup');
    l.push(T('etat.joueur', '{n}. {nom}{mort}{role}{coeur}', {
      n: x.n, nom: x.nom, mort: x.vivant ? '' : ' †',
      role: p.phase !== 'inscriptions' && voitRole && x.role ? T('etat.role', ' — {role}', { role: roleT(x.role) }) : '',
      coeur: meneur && x.amoureux ? ' ♥' : '',
    }));
  }
  return lignes(l);
}
function etat(p, u, meneur) { return rendre('fr', etatT(p, u, meneur)); }

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
  if (!verbe) { c.sec(u, T('commande.inconnue', 'Commande inconnue : « {mot} ». Tape /lg aide.', { mot: args[0] })); return c.evts; }
  if (DU_MENEUR.has(verbe) && !meneur) {
    c.sec(u, staff ? T('commande.tuJoues', 'Tu joues dans cette partie : c’est le meneur qui s’en occupe.') : T('commande.seulMeneur', 'Seul le meneur peut faire ça.'));
    return c.evts;
  }
  const reste = args.slice(1);
  const a1 = reste[0], a2 = reste[1];
  const sansJoueur = () => c.sec(u, p.phase === 'inscriptions' ? T('commande.pasInscrit', 'Tu n’es pas inscrit : /lg jouer.') : T('commande.neJouePas', 'Tu ne joues pas dans cette partie.'));
  const vivant = () => { if (!j) { sansJoueur(); return false; } if (!j.vivant) { c.sec(u, T('commande.mort', 'Tu as quitté la partie : les morts n’agissent plus.')); return false; } return true; };
  switch (verbe) {
    case 'aide': c.sec(u, aideT(p, u, meneur)); break;
    case 'jouer': inscrire(c, u, nom); break;
    case 'quitter': desinscrire(c, u); break;
    case 'role':
      if (!j || !j.role) { if (j) c.sec(u, T('commande.pasDistribues', 'Les rôles ne sont pas encore distribués.')); else sansJoueur(); break; }
      c.sec(u, texteRole(p, j));
      break;
    case 'etat': c.sec(u, etatT(p, u, meneur)); break;
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
        else if (j.role === 'cupidon' && p.nuit === 1) { if (a2) lier(c, j, a1, a2); else c.sec(u, T('agir.deuxAmoureux', 'Désigne DEUX amoureux : /lg lier <numéro> <numéro>.')); }
        else c.sec(u, T('agir.dorsBien', 'Rien à faire pour toi cette nuit : dors bien.'));
      } else if (p.phase === 'nuit' && p.etape === 'sorciere' && j.role === 'sorciere') c.sec(u, T('agir.sorciere', 'Choisis : /lg sauver · /lg tuer <numéro> · /lg rien.'));
      else c.sec(u, p.phase === 'jour' ? pasEncoreVote() : T('agir.rien', 'Rien à faire pour toi en ce moment.'));
      break;
    }
    // ── le meneur ──
    case 'lancer': lancer(c, reste); break;
    case 'suite': suite(c); break;
    case 'pause':
      if (p.pause != null || !['nuit', 'jour', 'vote', 'chasseur', 'soir'].includes(p.phase)) { c.men(T('pause.rien', 'Rien à mettre en pause.')); break; }
      p.pause = p.echeance ? Math.max(0, p.echeance - c.now) : 0;
      p.echeance = null;
      c.info(T('pause', 'Le meneur met la partie en pause.'));
      break;
    case 'reprise':
      if (p.pause == null) { c.men(T('reprise.pasEnPause', 'La partie n’est pas en pause.')); break; }
      {
        const resteMs = p.pause;
        p.pause = null;
        const sansChrono = p.phase === 'jour' && !p.options.chronos.debat;
        p.echeance = sansChrono ? null : c.now + Math.max(resteMs, 5000);
        c.info(T('reprise', 'La partie reprend !'));
        if (p.phase === 'nuit') peutEtreFinNuit(c);
        else if (p.phase === 'vote' && votants(p).every((x) => Object.prototype.hasOwnProperty.call(p.votes, x.u))) depouiller(c);
      }
      break;
    case 'ouvrirvote':
      if (p.phase !== 'jour') { c.men(T('ouvrirvote.pasLeJour', 'Le vote s’ouvre pendant le débat du jour.')); break; }
      p.pause = null;
      commencerVote(c);
      break;
    case 'eliminer': {
      if (p.phase === 'inscriptions' || p.phase === 'fin') { c.men(T('eliminer.pasDePartie', 'Pas de partie en cours.')); break; }
      const r = trouver(p, reste.join(' '), (x) => x.vivant);
      if (r.erreur) { c.men(r.erreurT); break; }
      tuer(c, r.j.u, 'meneur');
      const v = verdict(p);
      if (v) { fin(c, v); break; }
      if (p.phase === 'nuit') { if (r.j.u === p.n.cible) p.n.cible = null; delete p.n.loups[r.j.u]; peutEtreFinNuit(c); }
      else if (p.phase === 'vote' && votants(p).every((x) => Object.prototype.hasOwnProperty.call(p.votes, x.u))) depouiller(c);
      else if (p.phase === 'chasseur' && p.chasseur === r.j.u) { p.chasseur = null; suiteApresMorts(c, p.apres || 'jour'); }
      break;
    }
    case 'ajouter': {
      if (p.phase !== 'inscriptions') { c.men(T('ajouter.closes', 'Les inscriptions sont closes.')); break; }
      for (const a of reste) {
        const x = compte ? compte(a) : null;
        if (!x) c.men(T('ajouter.introuvable', 'Joueur introuvable : {nom} (il doit être dans le salon).', { nom: a }));
        else inscrire(c, x.u, x.nom);
      }
      break;
    }
    case 'retirer': {
      const r = trouver(p, reste.join(' '));
      if (r.erreur) { c.men(r.erreurT); break; }
      desinscrire(c, r.j.u, u);
      break;
    }
    case 'chrono': {
      const r = lireReglages(reste);
      Object.assign(p.options.chronos, r.chronos);
      const C = p.options.chronos;
      c.men(T('chronos', 'Chronos : nuit {nuit}, sorcière {sorciere}, débat {debat}, vote {vote}, chasseur {chasseur}, soir {soir}.', {
        nuit: duree(C.nuit), sorciere: duree(C.sorciere), debat: C.debat ? duree(C.debat) : T('chronos.auMeneur', 'au meneur'),
        vote: duree(C.vote), chasseur: duree(C.chasseur), soir: duree(C.soir),
      }));
      break;
    }
    case 'prix': {
      const n = Math.max(0, Math.min(99999, Math.floor(Number(a1) || 0)));
      if (p.phase === 'fin') { c.men(T('prix.finie', 'La partie est terminée.')); break; }
      p.options.prix = n;
      c.info(n ? T('prix.promis', 'Le meneur promet **{n} kikooz** à chaque gagnant !', { n }) : T('prix.aucun', 'Pas de prix pour cette partie.'));
      break;
    }
    case 'roles': c.men(etatT(p, u, true)); break;
    case 'meneur':
      p.meneur = u;
      p.meneurNom = nom;
      c.info(T('meneur.nouveau', '{nom} reprend la partie en main : c’est le nouveau meneur.', { nom }));
      if (p.phase !== 'inscriptions') c.men(etatT(p, u, true));
      break;
    case 'fin':
      if (p.phase === 'fin') { c.men(T('fin.deja', 'La partie est déjà terminée.')); break; }
      p.phase = 'fin';
      p.etape = null;
      p.echeance = null;
      p.pause = null;
      p.gagnant = 'annulee';
      c.pub(p.joueurs.some((x) => x.role) ? lignes([T('fin.arret', 'Le meneur arrête la partie. Les rôles étaient :'), recapitulatif(p)])
        : T('fin.annule', 'Le meneur annule la partie.'));
      break;
    default: c.sec(u, T('commande.inconnueSeule', 'Commande inconnue. Tape /lg aide.'));
  }
  return c.evts;
}

// ── Ce que voit le client mobile ─────────────────────────────────────────────

/**
 * La vue d'un joueur (ou du meneur, ou d'un spectateur) : sans fuite de
 * secrets. `lang` : la langue de ses libellés (noms des rôles, actions,
 * composition) — le français par défaut.
 */
function vue(p, u, staff, now, lang) {
  const L = FPI18n.valide(lang) || 'fr';
  const dit = (t) => rendre(L, t);
  const j = joueurDe(p, u);
  const meneur = u === p.meneur || (staff && !j);
  const t = now || Date.now();
  const loupMoi = j && j.role === 'loup';
  const joueurs = p.joueurs.map((x) => {
    const voit = meneur || p.phase === 'fin' || !x.vivant || x.u === u || x.revele || (loupMoi && x.role === 'loup');
    const o = { n: x.n, nom: x.nom, vivant: x.vivant, moi: x.u === u };
    if (voit && x.role) { o.role = x.role; o.roleNom = dit(roleT(x.role)); }
    if (x.amoureux && (meneur || p.phase === 'fin' || x.u === u || x.amoureux === u)) o.amoureux = true;
    if (p.phase === 'vote') o.voix = Object.values(p.votes).filter((v) => v === x.u).length;
    return o;
  });
  let action = null;
  if (j && j.vivant && !p.pause) {
    if (p.phase === 'vote' && !j.sansVote) action = { verbe: 'voter', libelle: dit(T('vue.voter', 'Vote contre…')), cibles: vivants(p).filter((x) => x.u !== u).map((x) => x.n), choisi: (joueurDe(p, p.votes[u]) || {}).n || null, blanc: true };
    if (p.phase === 'nuit' && p.etape === 'nuit') {
      if (j.role === 'loup') action = { verbe: 'devorer', libelle: dit(T('vue.devorer', 'Dévorer…')), cibles: vivants(p).filter((x) => x.role !== 'loup').map((x) => x.n), choisi: (joueurDe(p, p.n.loups[u]) || {}).n || null };
      else if (j.role === 'voyante' && !p.n.vu) action = { verbe: 'voir', libelle: dit(T('vue.voir', 'Sonder…')), cibles: vivants(p).filter((x) => x.u !== u).map((x) => x.n) };
      else if (j.role === 'salvateur' && !p.n.protege) action = { verbe: 'proteger', libelle: dit(T('vue.proteger', 'Protéger…')), cibles: vivants(p).filter((x) => x.u !== p.protegeAvant).map((x) => x.n) };
      else if (j.role === 'cupidon' && p.nuit === 1 && !p.n.lies) action = { verbe: 'lier', libelle: dit(T('vue.lier', 'Lier deux amoureux…')), cibles: vivants(p).map((x) => x.n), deux: true };
    }
    if (p.phase === 'nuit' && p.etape === 'sorciere' && j.role === 'sorciere') {
      const cible = joueurDe(p, p.n.cible);
      action = { verbe: 'tuer', libelle: p.potions.mort ? dit(T('vue.empoisonner', 'Empoisonner…')) : '', cibles: p.potions.mort ? vivants(p).filter((x) => x.u !== u).map((x) => x.n) : [],
        sorciere: { victime: cible ? cible.nom : null, sauver: !!(p.potions.vie && cible && !p.n.sauve), sauve: !!p.n.sauve } };
    }
  }
  if (j && p.phase === 'chasseur' && p.chasseur === u) action = { verbe: 'tirer', libelle: dit(T('vue.tirer', 'Ton dernier tir…')), cibles: vivants(p).map((x) => x.n) };
  const reste = p.pause != null ? p.pause : (p.echeance ? Math.max(0, p.echeance - t) : null);
  return {
    salon: p.salon, phase: p.phase, etape: p.etape, nuit: p.nuit, jour: p.jour, reste, pause: p.pause != null,
    meneur: p.meneurNom, estMeneur: meneur, prix: p.options.prix,
    composition: p.composition ? (L === 'fr' ? p.composition : dit(compositionDe(p))) : null,
    inscrit: !!j, min: MIN_JOUEURS, max: MAX_JOUEURS,
    moi: j && j.role ? { role: j.role, roleNom: dit(roleT(j.role)), desc: dit(descT(j.role)), vivant: j.vivant,
      amoureux: j.amoureux ? (joueurDe(p, j.amoureux) || {}).nom || null : null,
      meute: j.role === 'loup' ? p.joueurs.filter((x) => x.role === 'loup' && x.u !== u).map((x) => x.nom) : null,
      potions: j.role === 'sorciere' ? Object.assign({}, p.potions) : null, sansVote: !!j.sansVote } : null,
    joueurs, action, gagnant: p.gagnant,
  };
}

module.exports = {
  ROLES, SPECIAUX, CHRONOS_DEFAUT, MIN_JOUEURS, MAX_JOUEURS,
  compositionDefaut, compositionTexte, lireReglages, normaliser,
  creer, ouverture, commande, echeance, parole, meute, vue, verdict, trouver, aide, aideT, etat, etatT, rendre,
};
