'use strict';
/*
 * GASPARD AU CHAT — ce qu'il comprend (gaspard.js, sans serveur), puis ce
 * qu'il fait dans un salon (contre une vraie base, sauté sans Postgres) :
 *
 *   · interpellé (« @Gaspard … », « Gaspard, … », /gaspard), il répond à la
 *     question avec sa base de réponses, ou une rubrique de l'aide ;
 *   · un nouveau qui entre pour la première fois dans un salon public est
 *     accueilli, reçoit ses kikooz de bienvenue — une fois —, et un compte
 *     ancien ne l'est pas ;
 *   · l'admin règle tout cela.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));
const G = require('../gaspard.js');

/* ── 1. La reconnaissance ──────────────────────────────────────────────── */

test('interpellé : en tête, avec ou sans arobase, en commande, ou au milieu', () => {
  assert.strictEqual(G.interpelle('@Gaspard comment gagner des kikooz ?'), 'comment gagner des kikooz ?');
  assert.strictEqual(G.interpelle('gaspard, les commandes ?'), 'les commandes ?');
  assert.strictEqual(G.interpelle('/gaspard quêtes'), 'quêtes');
  assert.strictEqual(G.interpelle('merci @gaspard'), 'merci');
  assert.strictEqual(G.interpelle('@GASPARD'), '');
  assert.strictEqual(G.interpelle('je parle de gaspard à quelqu’un'), null, 'pas interpellé : il n’est pas en tête');
  assert.strictEqual(G.interpelle('bonjour tout le monde'), null);
});

test('les mots : sans accents, sans ponctuation, sans mots vides, au singulier', () => {
  assert.deepStrictEqual(G.mots('Comment gagner des Kikooz, s’il te plaît ?'), ['gagner', 'kikooz']);
  assert.deepStrictEqual(G.mots('Où sont les quêtes de Gromelin ?'), ['quete', 'gromelin']);
  assert.strictEqual(G.racine('jeux'), 'jeu');
  assert.strictEqual(G.racine('chevaux'), 'cheval');
});

test('il répond juste sur les grands sujets du parc', () => {
  const cas = [
    ['comment gagner des kikooz ?', 'kikooz'],
    ['c’est quoi les quêtes de Gromelin', 'quetes'],
    ['les commandes du chat', 'commandes'],
    ['où est la boutique', 'boutique'],
    ['je veux changer ma frutibouille', 'bouille'],
    ['à quoi sert le pass quotidien', 'challenge'],
    ['mode nuit ?', 'nuit'],
    ['comment envoyer un message privé', 'mp'],
    ['comment parrainer un ami', 'parrainage'],
    ['la mise à prix du record', 'primes'],
  ];
  for (const [q, cle] of cas) {
    const r = G.repondre(q, [], 'Remi');
    assert.strictEqual(r.source, 'base', q + ' → ' + r.source);
    assert.strictEqual(r.cle, cle, q + ' → ' + r.cle);
    assert.ok(r.texte.length > 40 && !/\{nom\}/.test(r.texte));
  }
});

/*
 * LA BASE ENRICHIE — une ou deux questions de joueur par entrée, et les pièges
 * où un mot partagé tirerait la question ailleurs. Chaque réponse est vérifiée
 * contre le code du parc (voir les entrées de gaspard.js) ; ici, on vérifie
 * qu'elle arrive à la bonne question.
 */
test('il trouve la bonne entrée sur tous les sujets du parc', () => {
  const cas = [
    // Le Challenge, les FD, les médailles, les classements
    ['comment marche le challenge du jour ?', 'challenge'],
    ['c’est quoi les FD et les disquettes ?', 'challenge'],
    ['c’est quoi les disquettes ?', 'challenge'],
    ['combien de parties classées par jour ?', 'challenge'],
    ['combien de kikooz rapporte une médaille d’or ?', 'medailles'],
    ['quand tombent les médailles ?', 'medailles'],
    ['les kikooz des médailles', 'medailles'],
    ['où voir les classements ?', 'classements'],
    ['c’est quoi la consécration ?', 'classements'],
    ['c’est quoi le championnat ?', 'championnat'],
    ['comment marche la note elo ?', 'championnat'],
    ['c’est quoi les pictos ?', 'pictos'],
    ['c’est quoi le livre des records du club', 'club'],
    // L'XP, la série de connexion
    ['comment gagner de l’xp ?', 'niveau'],
    ['combien d’xp pour passer niveau 3', 'niveau'],
    ['comment marche la série de connexion ?', 'serie'],
    ['c’est quoi le cadeau des 100 jours ?', 'serie'],
    ['récompense de connexion quotidienne', 'serie'],
    ['kikooz de la série de connexion', 'serie'],
    // Quêtes, Prunostics, Frutisigne
    ['les quêtes de la semaine', 'quetes'],
    ['c’est quoi les prunostics ?', 'prunostic'],
    ['comment parier sur le challenge ?', 'prunostic'],
    ['c’est quoi mon frutisigne ?', 'frutisigne'],
    ['quand est-ce que m’dam Irma passe ?', 'frutisigne'],
    // Boutique, inventaire, accessoires, fonds, feutres, atelier
    ['comment porter un accessoire ?', 'inventaire'],
    ['comment mettre un accessoire par défaut ?', 'inventaire'],
    ['comment acheter un accessoire ?', 'boutique'],
    ['comment changer de fond d’écran ?', 'fonds'],
    ['comment changer la couleur de mon feutre ?', 'feutres'],
    ['comment avoir le feutre multicolore', 'feutres'],
    ['comment créer un accessoire maison ?', 'atelier'],
    ['c’est quoi l’atelier ?', 'atelier'],
    // Le mode nuit, l'appli, le bureau
    ['comment activer le mode nuit sur mon téléphone', 'nuit'],
    ['le thème noir', 'nuit'],
    ['comment installer l’appli sur mon iphone ?', 'appli'],
    ['comment installer l’application sur android', 'appli'],
    ['c’est quoi la version flash ?', 'bureau'],
    // Les salons et leurs commandes
    ['à quoi sert /log ?', 'logs'],
    ['comment voir les messages précédents du salon', 'logs'],
    ['comment ignorer quelqu’un ?', 'ignorer'],
    ['comment bloquer quelqu’un', 'ignorer'],
    ['c’est quoi la liste noire', 'ignorer'],
    ['comment envoyer un message privé sur un salon public ?', 'chuchoter'],
    ['comment chuchoter à quelqu’un ?', 'chuchoter'],
    ['c’est quoi les émotes ?', 'emotes'],
    ['à quoi sert /blueon ?', 'blueon'],
    ['comment voter au sondage ?', 'blueon'],
    ['comment créer un salon ?', 'salons'],
    ['comment changer de salon ?', 'salons'],
    ['quelles sont les commandes du salon ?', 'commandes'],
    ['comment changer mon statut', 'statut'],
    ['comment mentionner quelqu’un ?', 'mentions'],
    // Courrier, contacts, fiche, Bouilloscope, compte
    ['comment envoyer un frutimail ?', 'frutimail'],
    ['où est mon courrier ?', 'frutimail'],
    ['comment marche la messagerie ?', 'frutimail'],
    ['comment ajouter un ami dans mes contacts ?', 'contacts'],
    ['comment voir la fiche d’un joueur ?', 'fiche'],
    ['comment modifier ma fiche ?', 'profil'],
    ['comment supprimer mon compte ?', 'profil'],
    ['j’ai oublié mon code secret', 'motdepasse'],
    ['comment retrouver quelqu’un dans le bouilloscope ?', 'bouilloscope'],
    ['comment inviter un ami ?', 'parrainage'],
    ['combien de kikooz pour le parrainage', 'parrainage'],
    // Forum, modération, animations
    ['comment poster sur le forum ?', 'forum'],
    ['comment signaler quelqu’un qui m’insulte ?', 'moderation'],
    ['comment appeler un modérateur ?', 'moderation'],
    ['c’est quoi un modérateur ?', 'moderation'],
    ['qui sont les animateurs ?', 'animateurs'],
    ['qui est dans l’équipe ?', 'animateurs'],
    ['c’est quoi la question à 60 kikooz ?', 'kiloute'],
    ['à quelle heure passe Kiloutou ?', 'kiloute'],
    ['comment marche le blindtest ?', 'blindtest'],
    ['comment jouer au loup-garou ?', 'loupgarou'],
    // Les jeux, un par un
    ['comment jouer à Frutisnake en ligne ?', 'frutisnake'],
    ['le mode battle de snake', 'frutisnake'],
    ['comment marche Swapou ?', 'swapou'],
    ['c’est quoi grappe et freestyle à Kaluga ?', 'kaluga'],
    ['comment marche kaluga', 'kaluga'],
    ['la carte de MotionBall change quand ?', 'motionball'],
    ['comment marche Motion Ball 2', 'motionball'],
    ['c’est quoi le circuit du jour de Burning Kiwi ?', 'burningkiwi'],
    ['comment jouer à Grapiz ?', 'grapiz'],
    ['les règles de Frutibandas', 'frutibandas'],
    ['c’est quoi les fruticartes ?', 'frutibandas'],
    ['comment marche MiniWave ?', 'miniwave'],
    ['c’est quoi le mode letter de mini wave', 'miniwave'],
    ['à quoi servent les fées de MiniPixiz ?', 'minipixiz'],
    ['c’est quoi Mini-Fever ?', 'minifever'],
    ['comment jouer à JamaJama ?', 'jamajama'],
    ['comment lancer un jeu ?', 'jeux'],
    ['où sont les jeux ?', 'jeux'],
    // Les pièges : un mot partagé ne doit pas tirer la question ailleurs.
    ['j’ai perdu mon mot de passe et mes kikooz', 'motdepasse'],
    ['j’ai perdu mes kikooz', 'kikooz'],
    ['comment avoir des kikooz en jouant', 'kikooz'],
    ['kikoo', 'kikooz'],
    ['j’ai un bug', 'bug'],
    ['c’est quoi le pass ?', 'challenge'],
    ['la boîte noire', 'ignorer'],
    ['médaille d’argent', 'medailles'],
    ['gagner de l’argent', 'kikooz'],
  ];
  for (const [q, cle] of cas) {
    const r = G.repondre(q, [], 'Remi');
    assert.strictEqual(r.source, 'base', q + ' → ' + r.source);
    assert.strictEqual(r.cle, cle, q + ' → ' + r.cle);
  }
  // Les rubriques que le serveur sème dans l'aide (mêmes titres, mêmes
  // mots-clés) ne prennent pas la main quand la base en sait autant : à
  // égalité, la base passe.
  const semees = [
    { title: 'Les Kikooz', keywords: 'kikooz monnaie boutique cadeau donne', body: 'Les Kikooz sont la monnaie virtuelle de Frutiparc.' },
    { title: 'Les scores et le challenge', keywords: 'score classement challenge medaille or argent bronze daily', body: 'Vos scores se séparent en deux familles.' },
  ];
  for (const [q, cle] of [['comment gagner des kikooz ?', 'kikooz'], ['comment marche le challenge du jour ?', 'challenge'],
    ['combien de kikooz rapporte une médaille d’or ?', 'medailles'], ['les kikooz des médailles', 'medailles']]) {
    const r = G.repondre(q, semees, 'Remi');
    assert.strictEqual(r.source + ':' + r.cle, 'base:' + cle, q);
  }
  // Chaque entrée a sa réponse, sans gabarit oublié, et une clé à elle.
  const cles = new Set();
  for (const e of G.BASE) {
    assert.ok(e.reponse.length > 40 && !/\{nom\}/.test(e.reponse), e.cle);
    assert.ok(!cles.has(e.cle), 'clé en double : ' + e.cle);
    cles.add(e.cle);
  }
});

test('une rubrique de l’aide l’emporte quand elle colle mieux, et son corps devient du texte de chat', () => {
  const rubriques = [
    { title: 'Index', keywords: 'index accueil', body: 'x', is_index: true },
    { title: 'Le loup-garou du jeudi', keywords: 'jeudi soiree rendez-vous', body: 'Tous les <b>jeudis</b> &#224; 21&#160;h, une partie de loup-garou sur pomme.<br/>Venez nombreux !' },
  ];
  const r = G.repondre('c’est quand la soirée du jeudi ?', rubriques, 'Remi');
  assert.strictEqual(r.source, 'aide');
  assert.match(r.texte, /^Le loup-garou du jeudi — Tous les jeudis à 21 h, une partie de loup-garou sur pomme\. Venez nombreux ! \(la suite/);
  // L'index ne répond jamais ; un corps long est coupé sur un mot.
  assert.strictEqual(G.repondre('index accueil', rubriques, 'x').source, 'rien');
  const long = G.texteDeRubrique('mot '.repeat(200), 50);
  assert.ok(long.length <= 52 && long.endsWith('…') && !/\s…$/.test(long), long);
});

test('politesses, et ce qu’il ne comprend pas', () => {
  assert.strictEqual(G.repondre('bonjour', [], 'Remi').source, 'politesse');
  assert.match(G.repondre('bonjour', [], 'Remi').texte, /^Bonjour Remi/);
  assert.strictEqual(G.repondre('merci !', [], 'Remi').source, 'politesse');
  assert.strictEqual(G.repondre('', [], 'Remi').source, 'rien');
  const r = G.repondre('tu préfères les fraises ou les framboises ?', [], 'Remi');
  assert.strictEqual(r.source, 'rien');
  assert.match(r.texte, /Je n’ai pas compris, Remi/);
  // Un seul mot-clé noyé dans une longue question ne suffit pas.
  assert.strictEqual(G.repondre('mon voisin a perdu son chat dans le jardin hier soir', [], 'x').source, 'rien');
});

test('le mot de bienvenue : trois lignes, le pseudo, et les kikooz quand il y en a', () => {
  const l = G.bienvenue('Prune', 100);
  assert.strictEqual(l.length, 3);
  assert.match(l[0], /^Bienvenue Prune ! .* 100 kikooz de bienvenue/);
  assert.match(l[2], /@Gaspard/);
  assert.ok(!/kikooz de bienvenue/.test(G.bienvenue('Prune', 0)[0]));
});

/* ── 2. Au chat, contre une vraie base ─────────────────────────────────── */

const ROOT = path.join(__dirname, '..');
const PORT = 3464;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_gaspard';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc, dispo = false;

async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}
function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5204', FRUTISCORE_PORT: '5205',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
}
async function pret() {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/online-count')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
  for (let i = 0; i < 240; i++) {
    const c = new Client({ connectionString: DB });
    try {
      await c.connect();
      const r = await c.query("SELECT 1 FROM forum_boards WHERE name = 'Frutiz' LIMIT 1");
      if (r.rows.length) return;
    } catch { /* tables pas encore là */ } finally { try { await c.end(); } catch { /* rien */ } }
    await wait(250);
  }
  throw new Error('la base de test n’a jamais été prête');
}
async function sql(q, p) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, p)).rows; } finally { await c.end(); }
}
async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}
const admin = (url, corps) => fetch(BASE + url, corps
  ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE }, body: JSON.stringify(corps) }
  : { headers: { 'x-admin-key': CLE } }).then((r) => r.json());
async function client(pseudo, sid) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const trames = [];
  let tampon = '';
  ws.on('message', (d) => {
    tampon += d.toString('utf8');
    const bouts = tampon.split('\0');
    tampon = bouts.pop();
    for (const b of bouts) if (b.trim()) trames.push(b.trim());
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sid}" lc="1" />\0`);
  const c = {
    pseudo, sid, ws, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    attendre: async (pred, quoi, ms = 8000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 900)}`);
    },
    fermer: () => { try { ws.close(); } catch { /* rien */ } },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d’identification');
  return c;
}
const solde = async (u) => (await sql('SELECT kikooz FROM users WHERE username = $1', [u]))[0].kikooz;

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  demarrer();
  await pret();
});
after(() => { if (proc) proc.kill('SIGKILL'); });

test('un nouveau est accueilli sur pomme, une fois, avec ses kikooz ; un ancien non ; et Gaspard répond', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await inscrire('prune');
  await inscrire('doyen');
  // Le doyen a un compte d'il y a deux ans — vu de la base, donc après un
  // redémarrage (la mémoire d'un compte tout juste inscrit le dit d'aujourd'hui).
  await sql("UPDATE users SET created_at = now() - interval '2 years' WHERE username = 'doyen'");
  proc.kill('SIGKILL');
  await wait(500);
  demarrer();
  await pret();
  const sidNeuf = await inscrire('prune');
  const sidVieux = await inscrire('doyen');
  // Un réglage à 150 kikooz, relu par le serveur.
  const R = await admin('/api/admin/gaspard/reglages', { kikooz: 150, joursNouveau: 30, actif: true, accueil: true });
  assert.deepStrictEqual(R.reglages, { actif: true, accueil: true, kikooz: 150, joursNouveau: 30 });
  const vieux = await client('doyen', sidVieux);
  const neuf = await client('prune', sidNeuf);
  // Le solde une fois identifiée au chat : la connexion quotidienne y est déjà payée.
  await wait(600);
  const avant = await solde('prune');
  try {
    vieux.envoyer('<o g="pomme" />');
    await vieux.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'entrée du doyen');
    neuf.envoyer('<o g="pomme" />');
    await neuf.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'entrée de prune');
    // Gaspard entre dans le salon et souhaite la bienvenue — à prune, nommée.
    const salut = await neuf.attendre((x) => /u="Gaspard"/.test(x) && /Bienvenue prune/.test(x), 'la bienvenue de Gaspard', 12000);
    assert.match(salut, /mn="prune"/, 'adressée à prune : son onglet clignote');
    assert.match(salut, /150 kikooz de bienvenue/);
    assert.ok(vieux.trames.some((x) => /u="Gaspard"/.test(x) && /Bienvenue prune/.test(x)), 'tout le salon l’entend');
    await neuf.attendre((x) => /u="Gaspard"/.test(x) && /@Gaspard devant/.test(x), 'la troisième ligne', 15000);
    assert.ok(!vieux.trames.some((x) => /Bienvenue doyen/.test(x)), 'le doyen, lui, n’est pas un nouveau');
    // Les kikooz, et la marque en base.
    for (let i = 0; i < 40 && (await solde('prune')) !== avant + 150; i++) await wait(100);
    assert.strictEqual(await solde('prune'), avant + 150, 'les kikooz de bienvenue');
    assert.ok((await sql("SELECT gaspard_accueil_at FROM users WHERE username = 'prune'"))[0].gaspard_accueil_at, 'marquée accueillie');
    // Une sortie et un retour : plus de bienvenue, plus de kikooz.
    neuf.envoyer('<y g="pomme" />');
    await wait(300);
    neuf.trames.length = 0;
    neuf.envoyer('<o g="pomme" />');
    await neuf.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'retour de prune');
    await wait(3500);
    // (le rejeu des cinq dernières minutes, rj="1", ramène l'ancienne : ce n'en est pas une neuve)
    assert.ok(!neuf.trames.some((x) => /Bienvenue prune/.test(x) && !/rj="1"/.test(x)), 'une seule bienvenue');
    assert.strictEqual(await solde('prune'), avant + 150);

    // La question : Gaspard répond dans le salon, à prune.
    neuf.trames.length = 0;
    neuf.envoyer('<t g="pomme" t="m" p="">@Gaspard comment gagner des kikooz ?</t>');
    const rep = await neuf.attendre((x) => /u="Gaspard"/.test(x) && /@prune/.test(x), 'la réponse', 8000);
    assert.match(rep, /mn="prune"/);
    assert.match(rep, /monnaie du parc/);
    // Sans arobase non plus, et une question qu'il ne comprend pas le dit.
    await wait(8200);
    neuf.trames.length = 0;
    neuf.envoyer('<t g="pomme" t="m" p="">Gaspard, les framboises ou les fraises ?</t>');
    const rep2 = await neuf.attendre((x) => /u="Gaspard"/.test(x) && /@prune/.test(x), 'la seconde réponse', 8000);
    assert.match(rep2, /pas compris/);
    // Un message ordinaire ne le fait pas parler.
    neuf.trames.length = 0;
    neuf.envoyer('<t g="pomme" t="m" p="">bonjour tout le monde</t>');
    await wait(2500);
    assert.ok(!neuf.trames.some((x) => /u="Gaspard"/.test(x)), 'Gaspard se tait');
    // L'essai de l'admin passe par le même chemin.
    const e = await admin('/api/admin/gaspard/essai?q=' + encodeURIComponent('les commandes'));
    assert.strictEqual(e.reponse.cle, 'commandes');
    // Éteint, il ne répond plus.
    await admin('/api/admin/gaspard/reglages', { actif: false });
    await wait(8200);
    neuf.trames.length = 0;
    neuf.envoyer('<t g="pomme" t="m" p="">@Gaspard les commandes</t>');
    await wait(2500);
    assert.ok(!neuf.trames.some((x) => /u="Gaspard"/.test(x)), 'éteint par l’admin');
    assert.strictEqual((await sql("SELECT value FROM app_state WHERE key = 'gaspard_reglages'"))[0].value.includes('"actif":false'), true);
  } finally { neuf.fermer(); vieux.fermer(); }
});
