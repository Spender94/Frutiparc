/*
 * FRUTISNAKE — LE BATTLE EN 1 CONTRE 1 ET L'ALLER-RETOUR.
 *
 * « On m'informe que le mode battle snake en 1 vs 1 est toujours bugué, il y
 *   a du ping. Le serpent ne réagit pas immédiatement quand on tourne. Ça rend
 *   le jeu très désagréable. »
 *
 * ── CE QUI SE PASSAIT ─────────────────────────────────────────────────────
 * Le serveur joue la partie, le client la miroite. L'angle DESSINÉ venait donc
 * toujours du serveur — et le serveur ne voit le doigt qu'un aller-retour plus
 * tard. Le client n'anticipait qu'un seul pas, soit 0,125 × 0,8 = 0,1 radian,
 * cinq degrés et sept dixièmes, aussitôt effacés par l'état suivant. À cent
 * vingt millisecondes de réseau, il manquait donc vingt-sept degrés et demi de
 * virage à l'instant où l'on appuie : le serpent semblait refuser de tourner,
 * puis rattrapait d'un coup.
 *
 * ── CE QU'ON A FAIT ───────────────────────────────────────────────────────
 *   1. le SERVEUR répond au ping sur-le-champ (net.js) — le client connaît
 *      enfin son aller-retour — et joint à chaque serpent de chaque état le
 *      sens où il tourne (`tr`), pour que l'adversaire soit prolongé EN COURBE
 *      et non en ligne droite ;
 *   2. le CLIENT garde le plancher des six derniers relevés de ping (reseau.js
 *      — la latence d'un réseau se lit à son plancher, jamais à sa moyenne) ;
 *   3. et il REJOUE son propre serpent depuis l'état du serveur sur tout ce
 *      que le serveur n'a pas encore vu — l'aller-retour plus l'écart depuis
 *      l'état —, en empruntant le `move` du serpent d'origine, donc avec les
 *      mêmes points poussés dans la file : la tête reste soudée au corps.
 *
 * Mesuré au navigateur avec un aller-retour simulé de cent vingt
 * millisecondes (scratchpad/snake-lat.js) : de l'appui à sept degrés de virage
 * VISIBLE, la médiane passe de 176 ms à 43 ms.
 *
 * L'autorité reste au serveur de bout en bout : le rejeu ne cherche aucune
 * collision, ne garde rien, et chaque état remet les compteurs à sa vérité —
 * c'est ce que les cas ci-dessous verrouillent.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const C = require(path.join(RACINE, 'public/snake3/const.js'));
const { Serpent } = require(path.join(RACINE, 'public/snake3/serpent.js'));
const ENLIGNE = lire('public/snake3/enligne.js');

const PAS = 1 / C.SWF_FPS;                 // 25 ms, le pas du serveur
const TMOD = C.WANTED_FPS / C.SWF_FPS;     // 0,8 — le tmod d'un pas
const VIRAGE_PAS = C.SNAKE_DEFAULT_TURN * TMOD;   // 0,1 rad : un pas de virage
const deg = (r) => r * 180 / Math.PI;

// Les plafonds, relus DANS le client : le cas suit la source, il ne la
// recopie pas.
const cste = (nom) => {
  const m = new RegExp('const ' + nom + ' = ([0-9.]+)').exec(ENLIGNE);
  assert.ok(m, nom + ' doit être déclaré dans enligne.js');
  return Number(m[1]);
};
const PREDICTION_MAX = cste('PREDICTION_MAX');
const PREDICTION_RTT_MAX = cste('PREDICTION_RTT_MAX');
const PREDICTION_ECART_MAX = cste('PREDICTION_ECART_MAX');
const PREDICTION_PAS_MAX = cste('PREDICTION_PAS_MAX');

/*
 * On extrait du client les quatre méthodes du rejeu et on les FAIT TOURNER —
 * sur le vrai Serpent du jeu, avec les vraies constantes. `enligne.js` est un
 * module de navigateur (canvas, images, sons) : on n'en prend que ce bloc,
 * borné par ses voisins, et le cas casse si quelqu'un le déplace.
 */
const PREDICTION = (() => {
  const debut = ENLIGNE.indexOf('  _instantane(s) {');
  const fin = ENLIGNE.indexOf('  _poserChamps(s, i, n) {');
  assert.ok(debut > 0 && fin > debut, 'le bloc du rejeu doit être dans enligne.js');
  const bloc = ENLIGNE.slice(debut, fin);
  for (const n of ['_entreeA', '_predire', '_prolonger']) {
    assert.ok(bloc.indexOf('  ' + n + '(') >= 0, n + ' doit être dans le bloc du rejeu');
  }
  const bac = { C, PAS, TMOD, PREDICTION_MAX, PREDICTION_RTT_MAX, PREDICTION_ECART_MAX,
    PREDICTION_PAS_MAX, performance: { now: () => bac.__maintenant } , Math, Number, __maintenant: 0 };
  vm.createContext(bac);
  // Une classe, et non un objet : le bloc est écrit en méthodes de classe.
  const K = vm.runInContext('(class {\n' + bloc + '\n})', bac);
  return { methodes: K.prototype, bac };
})();

// Une vue de bataille réduite à ce que le rejeu lui demande.
function vue(o) {
  const v = Object.create(PREDICTION.methodes);
  v.monEquipe = 0;
  v.powers = [60, 60];
  v.niveau = { corner: { x: -5000, y: -5000 }, width: 10000, height: 10000 };
  v.ctl = { reseau: { allerRetour: (o && o.rtt) || 0 } };
  v.entrees = (o && o.entrees) || [{ t: 0, gauche: false, droite: false, haut: false }];
  v.virages = [0, 0];
  return v;
}

function serpent() {
  const s = new Serpent({ x: 0, y: 0 });
  s.ang = 0; s.old_ang = -100;
  s.queue.length = 0;
  for (let i = 0; i < 60; i++) s.queue.push({ x: -i, y: 0 });
  s.x = 0; s.y = 0;
  return s;
}

/* ── 1. LE VIRAGE SE VOIT À L'IMAGE OÙ L'ON APPUIE ────────────────────────── */

test('le rejeu tourne de tout l’aller-retour, pas d’un seul pas', () => {
  PREDICTION.bac.__maintenant = 100000;
  const rtt = 120;
  // Le doigt est sur « gauche » depuis avant la fenêtre rejouée.
  const v = vue({ rtt, entrees: [
    { t: 0, gauche: false, droite: false, haut: false },
    { t: PREDICTION.bac.__maintenant - 500, gauche: true, droite: false, haut: false },
  ] });
  const s = serpent();
  const a0 = s.ang;
  const remettre = v._predire(s, 0);
  assert.ok(remettre, 'le rejeu rend de quoi tout remettre en place');
  const tourne = a0 - s.ang;               // à gauche : l'angle décroît
  // 120 ms, c'est 4,8 pas de 25 ms : 0,125 × 0,8 × 4,8 = 0,48 rad = 27,5°.
  const attendu = C.SNAKE_DEFAULT_TURN * TMOD * (rtt / 1000 / PAS);
  assert.ok(Math.abs(tourne - attendu) < 1e-9, deg(tourne) + '° pour ' + deg(attendu) + '° attendus');
  assert.ok(deg(tourne) > 27 && deg(tourne) < 28, 'vingt-sept degrés et demi : ' + deg(tourne));
  // Ce que faisait l'ancien client : UN pas, cinq degrés et sept dixièmes.
  assert.ok(tourne > VIRAGE_PAS * 4, 'quatre fois mieux qu’un seul pas anticipé');
});

test('sans rien appuyer, le rejeu ne tourne pas — il ne fait qu’avancer', () => {
  PREDICTION.bac.__maintenant = 100000;
  const v = vue({ rtt: 120 });
  const s = serpent();
  const x0 = s.x;
  v._predire(s, 0);
  assert.strictEqual(s.ang, 0, 'cap inchangé');
  assert.ok(s.x > x0 + 10, 'mais la tête a bien avancé : ' + (s.x - x0));
});

test('la fenêtre rejouée, c’est l’aller-retour PLUS l’écart depuis l’état', () => {
  PREDICTION.bac.__maintenant = 100000;
  const faire = (rtt, depuis) => {
    const v = vue({ rtt, entrees: [
      { t: 0, gauche: false, droite: false, haut: false },
      { t: PREDICTION.bac.__maintenant - 900, gauche: false, droite: true, haut: false },
    ] });
    const s = serpent();
    v._predire(s, depuis);
    return s.ang;                          // à droite : l'angle croît
  };
  const seul = faire(80, 0);
  const somme = faire(80, 0.02);
  assert.ok(somme > seul, 'l’écart depuis l’état s’ajoute à l’aller-retour');
  const attendu = C.SNAKE_DEFAULT_TURN * TMOD * ((0.08 + 0.02) / PAS);
  assert.ok(Math.abs(somme - attendu) < 1e-9, deg(somme) + '° pour ' + deg(attendu) + '°');
});

test('l’historique des touches est relu à l’instant de chaque pas rejoué', () => {
  PREDICTION.bac.__maintenant = 100000;
  const t = PREDICTION.bac.__maintenant;
  // On a lâché la touche à mi-fenêtre : seule la première moitié tourne.
  const v = vue({ rtt: 200, entrees: [
    { t: 0, gauche: false, droite: false, haut: false },
    { t: t - 500, gauche: true, droite: false, haut: false },
    { t: t - 100, gauche: false, droite: false, haut: false },
  ] });
  const s = serpent();
  v._predire(s, 0);
  const tourne = -s.ang;
  const plein = C.SNAKE_DEFAULT_TURN * TMOD * (0.2 / PAS);
  // Comme sur le serveur (Bataille.main : on bouge, PUIS on applique les
  // touches), chaque pas relit l'historique à SA FIN : trois pas sur huit
  // tombent avant le relâchement. Ce qui compte, c'est qu'une touche lâchée
  // cesse de tourner — pas que la fenêtre entière compte.
  assert.ok(tourne > plein * 0.3 && tourne < plein * 0.6,
    'la moitié de la fenêtre environ, pas plus : ' + deg(tourne) + '° pour ' + deg(plein) + '° pleins');
  // Et `_entreeA` rend bien ce qu'on appuyait à tel instant.
  assert.strictEqual(v._entreeA(t - 300).gauche, true);
  assert.strictEqual(v._entreeA(t - 50).gauche, false);
  assert.strictEqual(v._entreeA(t - 9999).gauche, false, 'avant tout, rien n’est appuyé');
});

/* ── 2. LA TÊTE RESTE SOUDÉE AU CORPS ─────────────────────────────────────── */

test('le rejeu pousse les points dans la file : pas de trou entre la tête et le corps', () => {
  PREDICTION.bac.__maintenant = 100000;
  const v = vue({ rtt: 200, entrees: [
    { t: 0, gauche: false, droite: false, haut: false },
    { t: PREDICTION.bac.__maintenant - 900, gauche: true, droite: false, haut: false },
  ] });
  const s = serpent();
  const file0 = s.queue.length;
  const dep = { x: s.x, y: s.y };
  v._predire(s, 0);
  assert.ok(s.queue.length > file0, 'la file a grandi pendant le rejeu : ' + (s.queue.length - file0));
  const bout = s.queue[s.queue.length - 1];
  const ecart = Math.hypot(s.x - bout.x, s.y - bout.y);
  assert.ok(ecart < 2, 'le dernier point de file colle à la tête : ' + ecart.toFixed(2) + ' px');
  // Un simple déplacement de tête, lui, aurait laissé tout le trajet en trou.
  const trajet = Math.hypot(s.x - dep.x, s.y - dep.y);
  assert.ok(trajet > 20, 'le trajet rejoué est bien plus long que cet écart : ' + trajet.toFixed(1) + ' px');
});

/* ── 3. RIEN N'EST GARDÉ : LE SERVEUR RESTE LA SEULE VÉRITÉ ──────────────── */

test('après le tracé, tout est remis exactement comme le serveur l’a laissé', () => {
  PREDICTION.bac.__maintenant = 100000;
  const v = vue({ rtt: 250, entrees: [
    { t: 0, gauche: false, droite: false, haut: false },
    { t: PREDICTION.bac.__maintenant - 900, gauche: false, droite: true, haut: true },
  ] });
  const s = serpent();
  const avant = { x: s.x, y: s.y, dx: s.dx, dy: s.dy, ang: s.ang, old_ang: s.old_ang,
    speed: s.speed, eat: s.eat, dist: s.dist, redraw: s.redraw, len: s.len,
    queue: s.queue.length, queue_collide: s.queue_collide, col_pt: s.col_pt };
  const remettre = v._predire(s, 0.05);
  assert.notStrictEqual(s.ang, avant.ang, 'le rejeu a bien bougé quelque chose');
  remettre();
  for (const k of Object.keys(avant)) {
    if (k === 'queue') assert.strictEqual(s.queue.length, avant.queue, 'la file revient à la longueur du serveur');
    else assert.strictEqual(s[k], avant[k], k + ' revient à la valeur du serveur');
  }
});

test('le rejeu ne cherche aucune collision de corps : c’est le serveur qui tranche', () => {
  PREDICTION.bac.__maintenant = 100000;
  const v = vue({ rtt: 250, entrees: [
    { t: 0, gauche: false, droite: false, haut: false },
    { t: PREDICTION.bac.__maintenant - 900, gauche: true, droite: false, haut: false },
  ] });
  // Un serpent lové sur lui-même : le rejeu le traverse sans broncher.
  const s = serpent();
  s.queue.length = 0;
  for (let i = 0; i < 300; i++) {
    const a = i * 0.1;
    s.queue.push({ x: Math.cos(a) * 20, y: Math.sin(a) * 20 });
  }
  s.len = 40;
  const remettre = v._predire(s, 0);
  assert.ok(remettre, 'le rejeu est allé au bout');
  remettre();
  assert.strictEqual(s.queue_collide, true, 'et le serpent retrouve sa collision de corps');
});

/* ── 4. LES PLAFONDS ──────────────────────────────────────────────────────── */

test('un aller-retour délirant ne fait pas inventer : la fenêtre est plafonnée', () => {
  PREDICTION.bac.__maintenant = 100000;
  const faire = (rtt) => {
    const v = vue({ rtt, entrees: [
      { t: 0, gauche: false, droite: false, haut: false },
      { t: PREDICTION.bac.__maintenant - 9000, gauche: true, droite: false, haut: false },
    ] });
    const s = serpent();
    v._predire(s, 0);
    return -s.ang;
  };
  // Deux plafonds se suivent : l'aller-retour compensé d'abord
  // (PREDICTION_RTT_MAX), la fenêtre entière ensuite (PREDICTION_MAX). Pour un
  // état tout frais, c'est le premier qui mord.
  const plafond = C.SNAKE_DEFAULT_TURN * TMOD
    * (Math.min(PREDICTION_MAX, PREDICTION_RTT_MAX / 1000) / PAS);
  assert.ok(Math.abs(faire(5000) - plafond) < 1e-9, 'plafonné : ' + deg(faire(5000)) + '° pour ' + deg(plafond) + '°');
  assert.ok(Math.abs(faire(PREDICTION_RTT_MAX) - faire(PREDICTION_RTT_MAX + 3000)) < 1e-9,
    'au-delà de ' + PREDICTION_RTT_MAX + ' ms, l’aller-retour ne compte plus');
  // Et l'écart depuis l'état, qui s'y ajoute, ne fait pas dépasser la fenêtre.
  const v2 = vue({ rtt: PREDICTION_RTT_MAX, entrees: [
    { t: 0, gauche: false, droite: false, haut: false },
    { t: PREDICTION.bac.__maintenant - 9000, gauche: true, droite: false, haut: false },
  ] });
  const s2 = serpent();
  v2._predire(s2, 9);
  const fenetre = C.SNAKE_DEFAULT_TURN * TMOD * (PREDICTION_MAX / PAS);
  assert.ok(Math.abs(-s2.ang - fenetre) < 1e-9, 'la fenêtre entière tient en ' + PREDICTION_MAX + ' s');
  // Un onglet qui revient au premier plan : l'écart depuis l'état est énorme.
  const v = vue({ rtt: 0, entrees: [{ t: 0, gauche: false, droite: false, haut: false }] });
  const s = serpent();
  const x0 = s.x;
  v._predire(s, 30);
  assert.ok(s.x - x0 < 200, 'et la tête ne part pas à l’autre bout du terrain : ' + (s.x - x0));
  assert.ok(PREDICTION_PAS_MAX >= PREDICTION_MAX / PAS, 'le plafond de pas couvre la fenêtre maximale');
});

/* ── 5. L'ADVERSAIRE N'EST PAS PRÉDIT D'AUTANT ────────────────────────────── */

test('l’adversaire n’est prolongé que de l’écart entre deux états, sur sa courbe', () => {
  PREDICTION.bac.__maintenant = 100000;
  const v = vue({ rtt: 250 });
  // Tout droit : il avance, il ne tourne pas.
  const droit = serpent();
  v._prolonger(droit, 0, 0.02);
  assert.strictEqual(droit.ang, 0);
  assert.ok(droit.x > 0, 'mais il avance');
  // En virage (le `tr` du serveur) : il suit sa courbe.
  const tourne = serpent();
  v._prolonger(tourne, 1, 0.02);
  const attendu = C.SNAKE_DEFAULT_TURN * TMOD * (0.02 / PAS);
  assert.ok(Math.abs(tourne.ang - attendu) < 1e-9, deg(tourne.ang) + '° pour ' + deg(attendu) + '°');
  const gauche = serpent();
  v._prolonger(gauche, -1, 0.02);
  assert.ok(Math.abs(gauche.ang + attendu) < 1e-9, 'et de l’autre côté');
  // JAMAIS de l'aller-retour : on ne connaît pas ses intentions, et le montrer
  // en avance ferait mentir les frôlements.
  const loin = serpent();
  v._prolonger(loin, 1, 5);
  const plafond = C.SNAKE_DEFAULT_TURN * TMOD * (PREDICTION_ECART_MAX / PAS);
  assert.ok(Math.abs(loin.ang - plafond) < 1e-9, 'plafonné à ' + PREDICTION_ECART_MAX + ' s');
  assert.ok(PREDICTION_ECART_MAX < PREDICTION_MAX, 'et moins loin que pour SON serpent');
  // Lui aussi est remis en place, et l'aller-retour n'entre pas dans le calcul.
  const t = serpent();
  const remettre = v._prolonger(t, 1, 0.02);
  remettre();
  assert.strictEqual(t.ang, 0);
  assert.strictEqual(t.x, 0);
});

/* ── 6. LE PLANCHER DES PINGS (reseau.js) ────────────────────────────────── */

const Reseau = (() => {
  global.document = { addEventListener() {}, removeEventListener() {} };
  // Un DOMParser de poche : le client n'attend de lui que <sb …/> et ses
  // attributs — assez pour faire passer une vraie trame par `_recevoir`.
  global.DOMParser = class {
    parseFromString(s) {
      const attrs = {};
      const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
      let m; while ((m = re.exec(s))) attrs[m[1]] = m[2];
      return { documentElement: { nodeName: 'sb', getAttribute: (k) => (k in attrs ? attrs[k] : null) } };
    }
  };
  return require(path.join(RACINE, 'public/snake3/reseau.js')).Reseau;
})();

test('l’aller-retour, c’est le PLANCHER des six derniers relevés', () => {
  const r = new Reseau({});
  let t = 1000;
  r._horloge = () => t;
  const relever = (ms) => { r._pong(t - ms); };
  relever(120); assert.strictEqual(r.allerRetour, 120);
  relever(400); assert.strictEqual(r.allerRetour, 120, 'un paquet en retard ne gonfle rien');
  relever(90);  assert.strictEqual(r.allerRetour, 90, 'et un meilleur relevé descend le plancher');
  // Au-delà de six, les vieux sortent : le plancher remonte avec le réseau.
  for (let i = 0; i < 6; i++) relever(300);
  assert.strictEqual(r.allerRetour, 300, 'la fenêtre ne garde que six relevés');
});

test('un relevé absurde est jeté, jamais compté', () => {
  const r = new Reseau({});
  let t = 100000;
  r._horloge = () => t;
  r._pong(t - 150);
  r._pong(t + 50);              // horloge qui a sauté en avant
  r._pong(t - 60000);           // onglet endormi une minute
  r._pong(NaN);
  r._pong(undefined);
  assert.strictEqual(r.allerRetour, 150, 'seul le relevé sain compte');
});

test('le pong ne remonte pas aux vues : il ne sert qu’à la mesure', () => {
  const vus = [];
  const r = new Reseau({ surEvenement: (e) => vus.push(e) });
  let t = 5000;
  r._horloge = () => t;
  r._recevoir('<sb e="pong" t="4940" />\0<sb e="lobby" />\0');
  assert.strictEqual(r.allerRetour, 60, 'la trame de pong a bien été mesurée');
  assert.deepStrictEqual(vus, ['lobby'], 'seul le salon remonte');
});

test('le DOMParser est réutilisé — quarante trames par seconde en pleine partie', () => {
  const SRC = lire('public/snake3/reseau.js');
  assert.ok(/this\._parseur\.parseFromString/.test(SRC), 'la réception passe par le parseur gardé');
  assert.ok(!/new DOMParser\(\)\.parseFromString/.test(SRC), 'plus de DOMParser jeté par trame');
  const r = new Reseau({});
  const p = r._parseur;
  r._recevoir('<sb e="lobby" />\0');
  assert.strictEqual(r._parseur, p);
});

test('les pings s’arrêtent avec la socket', () => {
  const r = new Reseau({});
  r._lancerPings();
  assert.ok(r._pingTimer, 'le battement tourne');
  r.envoyer = () => {};
  r.fermer();
  assert.strictEqual(r._pingTimer, null, 'et s’arrête à la fermeture');
});

/* ── 7. LE SERVEUR : LE PONG, ET LE SENS DU VIRAGE DANS CHAQUE ÉTAT ──────── */

const PORT = 3459;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = String(Date.now()).slice(-7);
const joueur = (nom) => nom + RUN;
const attr = (xml, k) => { const m = new RegExp(' ' + k + '="([^"]*)"').exec(xml); return m ? m[1] : null; };

let serveur;
before(async () => {
  serveur = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-de-test', XMLSOCKET_PORT: '5168', FRUTISCORE_PORT: '5169',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serveur.stdout.on('data', () => {});
  serveur.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(async () => {
  if (serveur) serveur.kill('SIGKILL');
  await wait(300);
  try {
    const fichier = path.join(RACINE, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.slice(-RUN.length) === RUN) delete d.users[u];
    fs.writeFileSync(fichier, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

function connecter(pseudo, sid) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    const recus = [];
    let tampon = '';
    ws.on('message', (data) => {
      tampon += data.toString();
      const bouts = tampon.split('\0'); tampon = bouts.pop();
      for (const b of bouts) if (b.trim()) recus.push(b.trim());
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(`<k l="${pseudo}" s="${sid}" />\0`);
      setTimeout(() => {
        ws.send(`<sb a="hello" n="${pseudo}" />\0`);
        setTimeout(() => resolve({
          ws, recus,
          envoyer: (s) => ws.send(s + '\0'),
          sb: () => recus.filter((m) => m.indexOf('<sb') === 0),
          dernier: (e) => recus.filter((m) => m.indexOf('<sb') === 0 && attr(m, 'e') === e).pop() || null,
          fermer: () => ws.close(),
        }), 400);
      }, 300);
    });
  });
}

test('le serveur renvoie le pong sur-le-champ, avec le jeton du client', async () => {
  const A = await connecter(joueur('ping'), await sidFor(joueur('ping')));
  const depart = Date.now();
  A.envoyer('<sb a="ping" t="1234.5" />');
  for (let i = 0; i < 40 && !A.dernier('pong'); i++) await wait(10);
  const pong = A.dernier('pong');
  assert.ok(pong, 'le pong revient');
  assert.strictEqual(attr(pong, 't'), '1234.5', 'le jeton revient tel quel — c’est lui qui date la mesure');
  // Il ne passe PAS par le pas de jeu : sinon la mesure serait gonflée de
  // vingt-cinq millisecondes et le client prédirait trop loin.
  assert.ok(Date.now() - depart < 200, 'répondu dans le tour, pas au prochain pas');
  // Et depuis le salon, hors partie : c'est là que le client prend ses
  // premiers relevés.
  assert.ok(A.dernier('lobby'), 'on est bien au salon');
  A.fermer();
  await wait(200);
});

test('chaque serpent de chaque état porte le sens où il tourne', async () => {
  const A = await connecter(joueur('tr'), await sidFor(joueur('tr')));
  A.envoyer('<sb a="challenge" u="sifflet" />');
  await wait(400);
  assert.ok(A.dernier('start'), 'le défi au bot part sur-le-champ');
  const mien = (etat) => {
    const m = /<s i="0"[^>]*>/.exec(etat) || /<s i="0"[^>]*\/>/.exec(etat);
    return m ? m[0] : null;
  };
  const attendre = async (sens) => {
    for (let i = 0; i < 60; i++) {
      const e = A.dernier('state');
      const s = e && mien(e);
      if (s && attr(s, 'tr') === sens) return s;
      await wait(25);
    }
    return null;
  };
  assert.ok(await attendre('0'), 'tout droit : tr vaut zéro');
  A.envoyer('<sb a="input" g="1" d="0" h="0" />');
  assert.ok(await attendre('-1'), 'à gauche : tr vaut moins un');
  A.envoyer('<sb a="input" g="0" d="1" h="0" />');
  assert.ok(await attendre('1'), 'à droite : tr vaut un');
  // L'adversaire aussi porte le sien — c'est de lui que vient sa courbe.
  const etat = A.dernier('state');
  const autre = /<s i="1"[^>]*/.exec(etat);
  assert.ok(autre && attr(autre[0], 'tr') !== null, 'le serpent d’en face aussi : ' + etat.slice(0, 200));
  A.envoyer('<sb a="part" />');
  await wait(300);
  A.fermer();
  await wait(200);
});
