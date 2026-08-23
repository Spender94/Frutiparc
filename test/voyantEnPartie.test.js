/*
 * LE VOYANT « EN PARTIE » — et l'éjection du disque, qui est le même sujet.
 *
 * Le voyant s'allumait sur un événement et devait s'éteindre sur un autre. Or
 * l'événement d'extinction manque presque toujours : on ferme la fenêtre de
 * jeu, le navigateur la tue, le jeu plante, on part sans poser de score. D'où
 * un voyant allumé sur quelqu'un qui ne joue plus. Et dans l'autre sens, le
 * bureau poussait son propre `<status>` en écrasant les chiffres que le
 * serveur venait d'y mettre : un voyant qui ne s'affiche pas.
 *
 * Jouer est devenu une PLACE qu'il faut RENOUVELER — le sondage que chaque
 * fenêtre de jeu envoie déjà toutes les secondes et demie. Ces tests le
 * vérifient par où ça se voit vraiment : /api/light/online, qui dit à qui
 * regarde le salon qui joue à quoi.
 *
 * Et comme le serveur sait désormais quelle fenêtre est ouverte sur quel jeu,
 * il reconnaît une ÉJECTION : un disque déplacé alors que sa fenêtre tourne
 * sortait forcément de la console — quelle que soit sa destination, ce qui
 * n'était vu que pour un retour vers « Mes disques ».
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3510;
const SOCKET_PORT = 5270;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const TTL = 2500;                      // le filet, resserré pour le test
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const JOUEUR = 'joueur' + RUN;
const TEMOIN = 'temoin' + RUN;         // celui qui REGARDE : c'est son écran qui juge

let proc = null;
const sockets = [];

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'k', XMLSOCKET_PORT: String(SOCKET_PORT), FRUTISCORE_PORT: String(SOCKET_PORT + 1),
      PARTIE_TTL_MS: String(TTL),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => {
  for (const s of sockets) { try { s.destroy(); } catch { /* déjà fermée */ } }
  if (proc) proc.kill('SIGKILL');
});

async function sidPour(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session ouverte pour ' + pseudo);
  return j.sid;
}

// Une socket de chat : c'est elle qui rend un joueur « en ligne », donc
// visible dans /api/light/online. On garde ce qu'elle reçoit : c'est par là
// que le BUREAU apprend le voyant des autres (commande `z`, la « trace »), et
// personne ne le lui demande — il faut donc que le serveur le lui DISE.
function brancher(pseudo, sid) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET_PORT, '127.0.0.1');
    sockets.push(sock);
    sock.recus = [];
    sock.setEncoding('utf8');
    let tampon = '';
    sock.on('data', (d) => {
      tampon += d;
      let i;
      while ((i = tampon.indexOf('\0')) >= 0) {
        const m = tampon.slice(0, i);
        tampon = tampon.slice(i + 1);
        if (m) sock.recus.push(m);
      }
    });
    sock.on('error', reject);
    sock.on('connect', () => {
      sock.write(`<ident l="${pseudo}" s="${sid}" />\0`);
      setTimeout(() => resolve(sock), 500);
    });
  });
}

// Le dernier voyant que le serveur a DIFFUSÉ pour un joueur, tel que le bureau
// d'un autre le reçoit. `z` = trace ; les deux chiffres du milieu du `s` sont
// le code du jeu (snake3 = 5, kaluga = 8 — cf. STATUS_INTERNAL_FRAME).
function dernierVoyantDiffuse(sock, pseudo) {
  const motif = new RegExp('<z [^>]*u="' + pseudo + '"[^>]*s="(....)"', 'i');
  for (let i = sock.recus.length - 1; i >= 0; i--) {
    const m = motif.exec(sock.recus[i]);
    if (m) return m[1].substring(1, 3);
  }
  return null;
}

let sidJoueur = null, sidTemoin = null, sockJoueur = null;

// Ce que voit le témoin : le jeu affiché à côté du pseudo du joueur, ou null.
async function voyantDuJoueur() {
  const j = await (await fetch(`${BASE}/api/light/online?sid=${sidTemoin}`)).json();
  const e = (j.users || []).find((u) => u.pseudo.toLowerCase() === JOUEUR.toLowerCase());
  assert.ok(e, JOUEUR + ' est bien en ligne');
  return e.jeu || null;
}

// Le battement d'une fenêtre de jeu : le sondage qu'elle envoie déjà.
const battre = (jeu) =>
  fetch(`${BASE}/api/check-ejected?fd=0&sid=${sidJoueur}&game=${encodeURIComponent(jeu)}`)
    .then((r) => r.json());
// Le rapport du bureau sur SA fenêtre de jeu.
const fenetre = (jeu, ouvert) =>
  fetch(`${BASE}/api/jeu/fenetre?sid=${sidJoueur}&jeu=${encodeURIComponent(jeu)}&ouvert=${ouvert}`);
const deplacer = (f, folder) =>
  fetch(`${BASE}/ff/mv?sid=${sidJoueur}&f=${f}&folder=${folder}`).then((r) => r.text());

test('mise en place', async () => {
  sidJoueur = await sidPour(JOUEUR);
  sidTemoin = await sidPour(TEMOIN);
  sockJoueur = await brancher(JOUEUR, sidJoueur);
  await brancher(TEMOIN, sidTemoin);
  assert.equal(await voyantDuJoueur(), null, 'personne ne joue au départ');
});

// ── Le voyant s'allume, et TIENT ───────────────────────────────────────────

test('le voyant s\'allume dès le premier battement de la fenêtre', async () => {
  await battre('snake3');
  assert.equal(await voyantDuJoueur(), 'snake3', 'le témoin voit le joueur sur Frutisnake');
});

test('le bureau qui pousse son statut n\'éteint plus le voyant', async () => {
  // C'ÉTAIT LA CAUSE DU « ne s'affiche pas » : le SWF du bureau pousse son
  // `<status>` à tout bout de champ, et les chiffres du milieu écrasaient le
  // voyant que le serveur venait d'allumer.
  sockJoueur.write('<status s="0000" />\0');
  await wait(300);
  assert.equal(await voyantDuJoueur(), 'snake3', 'le voyant tient bon');
  // Et le voyant du FORUM, lui, reste piloté par le bureau : hors partie.
  sockJoueur.write('<status s="0010" />\0');
  await wait(300);
  assert.equal(await voyantDuJoueur(), 'snake3', 'la partie prime sur ce que raconte le bureau');
});

test('poser un score n\'éteint pas le voyant', async () => {
  // Le joueur enchaîne souvent une autre manche : le voyant s'éteignait sous
  // ses yeux, en pleine partie. On regarde SANS rebattre entre-temps, sinon on
  // ne prouverait rien.
  const r = await (await fetch(`${BASE}/api/saveScore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidJoueur, game: 'snake3', score: 1234 }),
  })).json();
  assert.ok(r.ok, 'le score est bien passé : ' + JSON.stringify(r).slice(0, 120));
  assert.equal(await voyantDuJoueur(), 'snake3', 'il joue encore');
});

// ── Le voyant s'éteint — les deux chemins ──────────────────────────────────

test('le bureau qui voit sa fenêtre fermée éteint le voyant sur-le-champ', async () => {
  // Le cas courant : on ferme la fenêtre de jeu. Le bureau tient la poignée,
  // il le constate en deux secondes et le dit.
  await fenetre('snake3', 0);
  assert.equal(await voyantDuJoueur(), null, 'éteint tout de suite, sans attendre de délai');
});

test('une fenêtre qui ne bat plus perd sa place', async () => {
  // Le filet : navigateur tué, machine endormie, jeu planté — personne ne dit
  // rien, et le voyant s'éteint quand même.
  await battre('kaluga');
  assert.equal(await voyantDuJoueur(), 'kaluga', 'allumé');
  await wait(TTL + 2500);
  assert.equal(await voyantDuJoueur(), null, 'plus de battement, plus de voyant');
});

test('l\'extinction est DIFFUSÉE, pas seulement constatée si on demande', async () => {
  // Le bureau des autres n'interroge personne : il attend qu'on lui dise. Un
  // voyant qui ne s'éteint que dans les réponses aux sondages resterait allumé
  // à l'écran — c'est exactement le symptôme qu'on corrige. Le balayage
  // périodique est donc ce qui compte ici, pas la péremption paresseuse.
  const temoin = sockets[1];
  // Le bureau « trace » les gens dont il affiche le voyant (barre de contacts,
  // liste du salon). C'est cet abonnement-là qu'on prend.
  temoin.write(`<z u="${JOUEUR}" />\0`);
  sockJoueur.write('<status s="0000" />\0');     // ni forum ni rien : page blanche
  await wait(400);
  temoin.recus.length = 0;
  await battre('kaluga');
  await wait(600);
  assert.equal(dernierVoyantDiffuse(temoin, JOUEUR), '08',
    'le témoin a REÇU l\'allumage (kaluga = 8) : ' + JSON.stringify(temoin.recus.slice(-3)));
  temoin.recus.length = 0;
  await wait(TTL + 3000);                 // on se tait : la place doit expirer toute seule
  assert.equal(dernierVoyantDiffuse(temoin, JOUEUR), '00',
    'et l\'extinction lui est arrivée sans qu\'il ait rien demandé');
});

test('le voyant du forum, lui, reste au bureau — et revient après la partie', async () => {
  // Tout n'est pas une partie : le forum se signale par le même emplacement,
  // mais c'est le bureau qui le pilote. La partie le COUVRE le temps qu'elle
  // dure, elle ne l'efface pas.
  const temoin = sockets[1];
  sockJoueur.write('<status s="0010" />\0');     // « je lis le forum » (code 1)
  await wait(400);
  assert.equal(dernierVoyantDiffuse(temoin, JOUEUR), '01', 'le forum s\'allume');
  await battre('snake3');
  await wait(400);
  assert.equal(dernierVoyantDiffuse(temoin, JOUEUR), '05', 'la partie prend le dessus');
  await wait(TTL + 3000);
  assert.equal(dernierVoyantDiffuse(temoin, JOUEUR), '01',
    'la partie finie, le forum reparaît : il n\'avait pas été effacé');
  sockJoueur.write('<status s="0000" />\0');
  await wait(300);
});

// ── L'ÉJECTION ────────────────────────────────────────────────────────────

test('éjecter vers « Mes disques » ferme la fenêtre', async () => {
  await battre('snake3');
  assert.equal(await voyantDuJoueur(), 'snake3');
  await deplacer('snake3', 'disccollector');
  const r = await battre('snake3');
  assert.equal(r.ejected, true, 'la fenêtre reçoit l\'ordre de se fermer');
  assert.equal(await voyantDuJoueur(), null, 'et le voyant s\'éteint');
});

test('éjecter vers LE BUREAU ferme aussi la fenêtre', async () => {
  // On ne regardait que les retours vers « Mes disques ». Or un disque sort
  // aussi de la console vers le bureau — et la fenêtre restait ouverte.
  await battre('kaluga');
  await deplacer('kaluga1', '');
  const r = await battre('kaluga');
  assert.equal(r.ejected, true, 'le bureau est une sortie de console comme une autre');
  assert.equal(await voyantDuJoueur(), null);
});

test('éjecter vers LA CORBEILLE ferme aussi la fenêtre', async () => {
  await battre('mb2');
  await deplacer('mb2', 'recyclebin');
  const r = await battre('mb2');
  assert.equal(r.ejected, true, 'la corbeille aussi');
  assert.equal(await voyantDuJoueur(), null);
});

test('ranger un disque auquel on ne joue pas ne ferme rien', async () => {
  // Le pendant du test précédent : sans lui, « toute destination compte »
  // fermerait la fenêtre du jeu en cours dès qu'on range un AUTRE disque.
  await battre('snake3');
  assert.equal(await voyantDuJoueur(), 'snake3');
  await deplacer('bkiwi1', 'disccollector');       // un disque qui dort
  const r = await battre('snake3');
  assert.equal(r.ejected, false, 'la fenêtre de Frutisnake reste ouverte');
  assert.equal(await voyantDuJoueur(), 'snake3', 'et le voyant avec');
});

test('la fenêtre n\'apprend son éjection qu\'une fois', async () => {
  await deplacer('snake3', 'disccollector');
  assert.equal((await battre('snake3')).ejected, true, 'première demande : oui');
  assert.equal((await battre('snake3')).ejected, false, 'la suivante repart à zéro');
});

test('remettre le disque en console annule une éjection en attente', async () => {
  // Sans cela, la fenêtre qu'on vient de rouvrir se refermerait aussitôt sur
  // l'éjection précédente, restée en mémoire.
  await battre('snake3');
  await deplacer('snake3', 'disccollector');       // éjection notée, non lue
  await fetch(`${BASE}/do/ld?sid=${sidJoueur}&u=snake3`);   // relance du jeu
  assert.equal((await battre('snake3')).ejected, false, 'la relance a effacé l\'éjection périmée');
  assert.equal(await voyantDuJoueur(), 'snake3', 'et le voyant s\'est rallumé au lancement');
});

// ── CE QUI FIGEAIT LES VOYANTS SUR MOBILE ─────────────────────────────────
//
// Trois défauts se cumulaient, et le mobile les réunit tous : on joue, on
// range le téléphone (la socket meurt), la place expire pendant l'absence.
//   1. l'extinction ne partait pas faute de socket — le salon gardait le
//      voyant allumé pour toujours (« il joue à Grapiz » deux heures après) ;
//   2. rien ne renouvelait la place pendant une partie Grapiz/Frutibandas :
//      le voyant s'éteignait tout seul au bout de 45 s, EN PLEINE PARTIE ;
//   3. l'arrivée d'un joueur au salon (<v>) porte son statut, mais le client
//      light ne le lisait pas : le voyant d'avant son départ restait affiché.

const JOUEUR2 = 'partant' + RUN;
let sidJoueur2 = null, sockJoueur2 = null;
const battre2 = (jeu) =>
  fetch(`${BASE}/api/check-ejected?fd=0&sid=${sidJoueur2}&game=${encodeURIComponent(jeu)}`)
    .then((r) => r.json());
async function voyantDe(pseudo) {
  const j = await (await fetch(`${BASE}/api/light/online?sid=${sidTemoin}`)).json();
  const e = (j.users || []).find((u) => u.pseudo.toLowerCase() === pseudo.toLowerCase());
  return e ? (e.jeu || null) : null;
}

test('mise en place : joueur et témoin dans le même salon', async () => {
  sidJoueur2 = await sidPour(JOUEUR2);
  sockJoueur2 = await brancher(JOUEUR2, sidJoueur2);
  const temoin = sockets[1];
  temoin.write('<o g="hall" />\0');
  sockJoueur2.write('<o g="hall" />\0');
  await wait(700);
  assert.ok(temoin.recus.some((t) => /^<p\b/.test(t)), 'le témoin a la liste du salon');
});

test('le voyant s\'éteint pour le SALON même quand le joueur a fermé l\'appli', async () => {
  const temoin = sockets[1];
  await battre2('kaluga');
  await wait(500);
  assert.equal(dernierVoyantDiffuse(temoin, JOUEUR2), '08', 'le salon voit l\'allumage (kaluga = 8)');
  // Le téléphone est rangé : l'appli gèle, la socket meurt. C'est ICI que la
  // place expire — et c'est exactement le moment où l'extinction ne partait
  // plus, faute d'une socket à qui la rattacher.
  temoin.recus.length = 0;
  sockJoueur2.destroy();
  await wait(TTL + 3000);
  assert.equal(dernierVoyantDiffuse(temoin, JOUEUR2), '00',
    'le salon a REÇU l\'extinction sans que le joueur soit là : '
    + JSON.stringify(temoin.recus.slice(-3)));
  assert.equal(await voyantDe(JOUEUR2), null, 'et le serveur le confirme');
});

test('le retour au salon porte le statut à jour (<v> avec s=)', async () => {
  // Le client light garde en cache le voyant de chacun ; il ne le rafraîchit
  // que sur les trames qui portent un statut. L'arrivée doit donc en porter
  // un, sinon le revenant traîne son ancien voyant.
  const temoin = sockets[1];
  temoin.recus.length = 0;
  sockJoueur2 = await brancher(JOUEUR2, sidJoueur2);
  sockJoueur2.write('<o g="hall" />\0');
  await wait(800);
  const arrivee = temoin.recus.find((t) => new RegExp('^<v [^>]*u="' + JOUEUR2 + '"', 'i').test(t));
  assert.ok(arrivee, 'le témoin voit l\'arrivée : ' + JSON.stringify(temoin.recus.slice(-4)));
  const s = / s="(....)"/.exec(arrivee);
  assert.ok(s, 'l\'arrivée porte un statut : ' + arrivee);
  assert.equal(s[1].substring(1, 3), '00', 'et ce statut est le bon (voyant éteint)');
});

test('une partie Grapiz garde son voyant bien au-delà du bail', async () => {
  // Grapiz et Frutibandas sont arbitrés par le serveur : personne n'envoie de
  // battement de fenêtre. Sans renouvellement, le voyant s'éteignait au bout
  // de 45 s alors que la partie durait encore.
  sockJoueur2.write(`<gz a="hello" n="${JOUEUR2}" f="${'0'.repeat(24)}" />\0`);
  await wait(400);
  sockJoueur2.write('<gz a="challenge" u="pepino" />\0');
  await wait(900);
  assert.equal(await voyantDe(JOUEUR2), 'grapiz', 'la partie allume le voyant');
  await wait(TTL + 3000);                        // bien plus que le bail
  assert.equal(await voyantDe(JOUEUR2), 'grapiz',
    'la partie dure toujours : le voyant tient');
  sockJoueur2.write('<gz a="part" />\0');        // forfait = fin de partie
  await wait(900);
  assert.equal(await voyantDe(JOUEUR2), null, 'partie finie, voyant éteint');
});

test('le client light lit le statut porté par une arrivée', async () => {
  // Contrôle de source (le client est une page, pas un module) : la branche
  // « userjoined » doit passer le s= reçu au cache des voyants.
  const fs = require('node:fs');
  const page = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
  const branche = /case "v": \{[\s\S]*?\n      \}/.exec(page);
  assert.ok(branche, 'la branche userjoined existe');
  assert.match(branche[0], /rememberStatut\(uj, attr\(xml, "s"\)\)/,
    'elle met le voyant à jour depuis le statut reçu');
});

test('téléphone rangé en pleine partie : le voyant s\'éteint quand même', async () => {
  // Une session vit jusqu'à sa conclusion — ranger son téléphone ne la termine
  // pas, et Frutibandas n'offrait même aucun bouton pour quitter proprement.
  // Renouveler sur la seule existence de la partie rallumait donc le voyant en
  // boucle pendant des heures. La présence tranche : plus personne au premier
  // plan, plus de renouvellement.
  sockJoueur2.write('<gz a="challenge" u="mirabo" />\0');
  await wait(900);
  assert.equal(await voyantDe(JOUEUR2), 'grapiz', 'la partie est bien lancée');
  sockJoueur2.write('<e h="1" />\0');            // l'appli passe en arrière-plan
  await wait(TTL + 3000);
  assert.equal(await voyantDe(JOUEUR2), null,
    'téléphone rangé : le voyant s\'éteint même si la partie court toujours');
  sockJoueur2.write('<e h="0" />\0');            // il revient dans l'appli
  await wait(2500);
  assert.equal(await voyantDe(JOUEUR2), 'grapiz',
    'de retour devant sa partie, le voyant se rallume');
  sockJoueur2.write('<gz a="part" />\0');
  await wait(800);
});
