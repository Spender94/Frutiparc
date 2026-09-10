// Quota de parties Challenge (les « FD ») : une partie doit coûter UN disque,
// et un seul.
//
// Deux défauts signalés par les joueurs, que ces tests verrouillent :
//
//   • Kaluga — « terminer complètement une partie consomme toutes les parties
//     restantes ». Le jeu ré-émet son score à CHAQUE IMAGE quand la partie est
//     menée à son terme : le panier plein coupe la chute des fruits, le panier se
//     vide, et Classic.checkFruit() appelle initEndGame() directement, sans
//     passer par endGame() — le seul à porter le garde flEndingGame. Chaque appel
//     ré-enregistre le score, donc consommait un disque. Le chemin « mort du
//     personnage » passe, lui, par endGame() : d'où un défaut visible seulement
//     quand on TERMINE la partie.
//
//   • « flood de notifications » — chaque enregistrement refusé écrivait une
//     ligne d'historique. Avec la rafale ci-dessus, l'historique du joueur se
//     remplissait de dizaines de messages identiques.
//
// Le troisième point (Frutisnake, « la 3e partie n'enregistre pas le score »)
// n'était PAS un défaut : le quota gratuit est de deux parties par jour. C'est
// l'absence d'avertissement qui trompait le joueur, d'où le préavis testé ici.
//
// LES PARTIES DE KALUGA PORTENT UN VRAI TÉMOIN DE GRAPPE (« 1:0:0 » — une
// partie sans grappe). Depuis que le tableau du jour se partage en deux, une
// donnée muette n'entre dans aucun des deux et ne consomme donc rien : la
// prendre pour véhicule ne mesurerait plus le quota. Le témoin choisi range
// ces parties au Freestyle, dont le compte est celui qu'on éprouve ici.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3431;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5120', FRUTISCORE_PORT: '5121',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (serverProc) serverProc.kill('SIGKILL'); });

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const quota = async (sid, jeu) =>
  (await (await fetch(`${BASE}/api/fd/status?sid=${encodeURIComponent(sid)}&game=${jeu}`)).json());
// Enregistre un score comme le fait le popup de jeu. `jeu` est le disque
// (kaluga1, snake31…), `m=1` le mode challenge.
const enregistrer = (sid, jeu, score, data) =>
  fetch(`${BASE}/api/saveScore?sid=${encodeURIComponent(sid)}&game=${jeu}` +
        `&m=1&score=${score}&data=${encodeURIComponent(data || '')}`).then((r) => r.json());
// L'historique du joueur (« Mon historique ») tel que le client le reçoit.
const historique = async (sid) =>
  await (await fetch(`${BASE}/do/onident?sid=${encodeURIComponent(sid)}`)).text();

test('une partie ne coûte qu\'un disque, même renvoyée en rafale', async () => {
  const sid = await sidFor('kalugafin');
  const depart = await quota(sid, 'kaluga');
  assert.equal(depart.limited, true, 'Kaluga est bien rationné');
  // DEUX PARTIES PAR TABLEAU, et Kaluga en a deux (le défi Grappe — qui partage
  // son seau avec le Championnat — et le défi Freestyle) : le compte annoncé au
  // joueur est la somme. Épuiser l'un ne ferme pas l'autre.
  assert.equal(depart.remaining, 4, 'deux parties gratuites par tableau du jour');

  // Une partie terminée : Kaluga renvoie le MÊME score en boucle.
  for (let i = 0; i < 25; i++) await enregistrer(sid, 'kaluga', 4200, '1:0:0');
  const apres = await quota(sid, 'kaluga');
  assert.equal(apres.used, 1, `rafale de 25 renvois → ${apres.used} disque(s) consommé(s) au lieu d'un`);
  assert.equal(apres.remaining, 3, 'il reste bien trois parties');
});

test('deux parties DIFFÉRENTES coûtent bien deux disques', async () => {
  // Le garde anti-rafale ne doit pas offrir de parties : dès que le score
  // change, c'est une autre partie.
  const sid = await sidFor('kalugadeux');
  await enregistrer(sid, 'kaluga', 100, '1:0:0');
  await enregistrer(sid, 'kaluga', 250, '1:0:0');
  const q = await quota(sid, 'kaluga');
  assert.equal(q.used, 2, 'deux scores distincts = deux parties');
  /* CES PARTIES SONT DU CHAMPIONNAT (« m=1 ») : elles visent `kaluga_challenge`,
     qui n'est pas partagé en deux et se compte donc dans le seau du jeu. Le
     défi du jour Freestyle, lui, garde ses deux parties — c'est tout l'objet du
     compte par tableau : épuiser l'un n'a jamais à fermer l'autre. */
  assert.equal(q.remaining, 2, 'le défi Freestyle reste ouvert');
  const parTableau = q.seaux || [];
  assert.deepEqual(parTableau.map((x) => [x.seau, x.remaining]),
    [['kaluga', 0], ['kaluga:freestyle', 2]], 'le détail le dit tableau par tableau');
});

test('passé le quota, le score n\'est plus classé — et le joueur n\'est prévenu qu\'une fois', async () => {
  const sid = await sidFor('snakequota');
  // Les deux parties gratuites.
  const p1 = await enregistrer(sid, 'snake3', 1000, '');
  const p2 = await enregistrer(sid, 'snake3', 2000, '');
  assert.equal(p1.fdBlocked, false, '1re partie classée');
  assert.equal(p2.fdBlocked, false, '2e partie classée');
  assert.equal((await quota(sid, 'snake3')).remaining, 0, 'quota épuisé après deux parties');

  // La 3e (et les suivantes) : non classées. C'est le comportement attendu —
  // ce n'était pas un bug, seulement un manque d'information côté joueur.
  const p3 = await enregistrer(sid, 'snake3', 3000, '');
  assert.equal(p3.fdBlocked, true, '3e partie NON classée (quota épuisé)');
  for (const s of [4000, 5000, 6000]) await enregistrer(sid, 'snake3', s, '');

  // Historique : UNE seule ligne « plus de FD », pas une par partie refusée.
  const log = await historique(sid);
  const lignes = log.match(/Plus de FD/g) || [];
  assert.equal(lignes.length, 1, `${lignes.length} notifications « plus de FD » au lieu d'une seule`);
});

test('le score reste refusé sur toute la rafale d\'une partie hors quota', async () => {
  // Une fois le quota épuisé, la rafale d'une partie terminée ne doit pas non
  // plus classer le score « par erreur » au deuxième renvoi.
  const sid = await sidFor('kalugavide');
  await enregistrer(sid, 'kaluga', 11, '1:0:0');
  await enregistrer(sid, 'kaluga', 22, '1:0:0');
  assert.equal((await quota(sid, 'kaluga')).remaining, 2, 'le seau du Championnat est à sec, celui du Freestyle non');
  const renvois = [];
  for (let i = 0; i < 10; i++) renvois.push(await enregistrer(sid, 'kaluga', 33, '1:0:0'));
  assert.ok(renvois.every((r) => r.fdBlocked === true), 'tous les renvois refusés');
  assert.equal((await quota(sid, 'kaluga')).used, 2, 'aucun disque supplémentaire débité');
});

test('le préavis « tes prochains scores ne seront pas classés » est câblé dans le popup', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/game-popup.html'), 'utf8');
  const bloc = html.slice(html.indexOf('function surveillerQuotaChallenge'),
                          html.indexOf('ExternalInterface callback: JSON parser'));
  assert.ok(bloc.length > 200, 'bloc surveillerQuotaChallenge présent');
  assert.ok(/\/api\/fd\/status\?sid=/.test(bloc), 'interroge le quota du joueur');
  assert.ok(/j\.remaining !== 0/.test(bloc), 'ne prévient qu\'une fois le quota à zéro');
  assert.ok(/ne sera pas class/.test(bloc), 'le message dit que le score ne sera pas classé');
  // Burning Kiwi applique son quota AVANT la course : le message y serait faux.
  assert.ok(/gameArg === "bkiwi"/.test(bloc), 'Burning Kiwi est exclu du préavis');
  // Une seule fois par fenêtre de jeu : pas de harcèlement.
  assert.ok(/averti = true/.test(bloc) && /if \(averti\)/.test(bloc), 'affiché une seule fois');
});

/*
 * ET QUAND C'EST FAIT, LE DIRE EN FRANÇAIS.
 *
 * « À quoi correspond l'erreur "sans fruit défendu, votre score n'est pas
 * comptabilisé" sur Frutisnake ? C'est pas clair. »
 *
 * Elle ne l'était pas : elle nommait une pièce de mécanique (le Fruit Défendu)
 * sans dire ce qui manquait, ni que le score était malgré tout gardé, ni
 * comment en ravoir une. Trois lignes, trois réponses — et trois seulement,
 * le panneau de fin de Frutisnake les centrant sous celles qui précèdent
 * (record battu, places gagnées).
 */
test('Frutisnake : le message du quota épuisé dit quoi, et quoi faire', () => {
  const C = require(path.join(ROOT, 'public/snake3/const.js'));
  const lignes = C.TXT_SCORE_SANS_FD.split('\n');
  assert.strictEqual(lignes.length, 3, 'trois lignes, pas plus');
  lignes.forEach((l) => assert.ok(l.length <= 46, 'ligne trop longue pour le panneau : ' + l));
  assert.match(lignes[0], /parties classées du jour sont épuisées/, 'ce qui manque');
  assert.match(lignes[1], /reste votre record/, 'ce que le score devient quand même');
  assert.match(lignes[2], /Pass quotidien \(Boutique\)/, 'et comment en ravoir une');
  // Le jeu l'affiche bien sur le verdict du serveur, pas au petit bonheur.
  const game = fs.readFileSync(path.join(ROOT, 'public/snake3/game.js'), 'utf8');
  assert.match(game, /if \(rep\.fdBlocked\) texte \+= C\.TXT_SCORE_SANS_FD \+ '\\n';/);
});

test('full.swf : la fin de partie de Kaluga passe par le garde endGame()', () => {
  // Correctif de la CAUSE, dans le bytecode (scripts/patch-kaluga-endgame.js) :
  // checkFruit() appelle endGame(120) — qui teste flEndingGame — au lieu de
  // sauter directement à initEndGame(120). Sans lui, le jeu ré-enregistre son
  // score à chaque image et le panneau de fin ne s'affiche jamais.
  const zlib = require('node:zlib');
  const raw = fs.readFileSync(path.join(ROOT, 'Games/kaluga/full.swf'));
  const b = raw.slice(0, 3).toString('ascii') === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  const rect = (x) => Math.ceil((5 + ((x[0] >> 3) & 0x1f) * 4) / 8);

  // La classe kaluga.game.Classic, repérée par un littéral qui n'appartient qu'à elle.
  let off = rect(b) + 4, tag = null;
  while (off < b.length) {
    const h = b.readUInt16LE(off), c = h >> 6;
    let l = h & 0x3f, hs = 2;
    if (l === 0x3f) { l = b.readUInt32LE(off + 2); hs = 6; }
    if (c === 0) break;
    if ((c === 59 || c === 12) &&
        b.slice(off + hs, off + hs + l).includes(Buffer.from('Nombre de grenouille', 'latin1'))) {
      tag = { off, hs, l, c }; break;
    }
    off += hs + l;
  }
  assert.ok(tag, 'classe Classic trouvée');
  const s0 = tag.off + tag.hs + (tag.c === 12 ? 0 : 2);
  const plen = b.readUInt16LE(s0 + 1), cnt = b.readUInt16LE(s0 + 3);
  const cp = []; let q = s0 + 5;
  for (let i = 0; i < cnt; i++) { const e = b.indexOf(0, q); cp.push(b.slice(q, e).toString('latin1')); q = e + 1; }
  assert.ok(cp.includes('endGame'), 'le nom endGame est dans la table des constantes de Classic');

  // Le site : Push 120 | Push 1 | Push r? | Push cp(x) | CallMethod.
  const debut = s0 + 3 + plen, fin = tag.off + tag.hs + tag.l;
  const seq = [];
  let appele = null, sites = 0;
  for (let pc = debut; pc < fin;) {
    const op = b[pc];
    const next = op >= 0x80 ? pc + 3 + b.readUInt16LE(pc + 1) : pc + 1;
    if (next <= pc || next > fin) break;
    seq.push({ pc, op, next });
    const n = seq.length;
    if (op === 0x52 && n >= 5) {
      const [a, u, v, w] = [seq[n - 5], seq[n - 4], seq[n - 3], seq[n - 2]];
      const brut = (i) => b.slice(i.pc + 3, i.next);
      // Push 120 (type 7, entier 32 bits) ; Push 1 ; Push r? ; Push cp(1 octet)
      if (a.op === 0x96 && brut(a).length === 5 && brut(a)[0] === 7 && brut(a).readInt32LE(1) === 120 &&
          u.op === 0x96 && v.op === 0x96 && brut(v)[0] === 4 &&
          w.op === 0x96 && brut(w).length === 2 && brut(w)[0] === 8) {
        sites++; appele = cp[brut(w)[1]];
      }
    }
    pc = next;
  }
  assert.equal(sites, 1, `${sites} appel(s) « …(120) » dans Classic au lieu d'un seul`);
  assert.equal(appele, 'endGame',
    `checkFruit() appelle ${JSON.stringify(appele)}(120) : sans le garde de endGame(), ` +
    'la fin de partie est rejouée à chaque image');
});

test('la source de Kaluga confirme la rafale (fin de partie non gardée)', () => {
  // Ce test documente la CAUSE côté jeu, pour qu'elle ne se reperde pas : c'est
  // le seul appel à initEndGame qui court-circuite le garde de endGame().
  const classic = fs.readFileSync(path.join(ROOT, 'Games/kaluga/class/kaluga/game/Classic.as'), 'utf8');
  const jeu = fs.readFileSync(path.join(ROOT, 'Games/kaluga/class/kaluga/Game.as'), 'utf8');
  assert.ok(/function checkFruit\(\)\s*\{[\s\S]*?initEndGame\(120\)/.test(classic),
    'checkFruit() appelle bien initEndGame() sans garde');
  assert.ok(/function endGame\(timer\)\s*\{\s*if\(!this\.flEndingGame\)/.test(jeu),
    'endGame() est le seul à porter le garde flEndingGame');
  assert.ok(/function update\(\)[\s\S]*?this\.checkFruit\(\);/.test(classic),
    'checkFruit() est appelé depuis la boucle de jeu (donc à chaque image)');
});
