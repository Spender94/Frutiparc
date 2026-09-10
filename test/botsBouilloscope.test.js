/*
 * Les bots de Frutibandas et de Grapiz empruntent une tête au Bouilloscope.
 *
 * Trois adversaires gravés dans le code — Banano, Orangine, Kiwano côté
 * Frutibandas, Pépino, Mirabo, Cassis côté Grapiz — et au bout de deux soirées
 * on savait à qui on avait affaire rien qu'en lisant le salon. Chacun pioche
 * désormais son pseudo ET sa bouille dans l'annuaire des Frutiz, et en change
 * après chaque partie.
 *
 * Une réserve, et c'est tout l'objet du deuxième test : le Bouilloscope
 * contient aussi des pseudos qui sont AUJOURD'HUI des comptes du Revival
 * (« kasparov »…). Voir son propre nom en face de soi, ou celui d'un ami qui
 * n'est pas connecté, serait au mieux troublant. Ces pseudos-là sont écartés.
 *
 * Le test parle au vrai pont XMLSocket (`<bd>` / `<gz>`), sur le vrai serveur :
 * c'est la seule façon de vérifier la chaîne entière, de l'annuaire en base
 * jusqu'à la ligne du salon.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3506;
const SOCKET_PORT = 5262;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-bots-bouilloscope';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Un compte du Revival qui figure AUSSI au Bouilloscope : le cas « kasparov ».
const HOMONYME = 'kasparov' + RUN;
// Des Frutiz de l'annuaire qui, eux, n'ont pas de compte.
const ANNUAIRE = ['pommelle', 'bigorneau', 'ratafia', 'chouquette', 'tourbillon',
  'grelotte', 'sirocco', 'pamplem', 'coquelic', 'brindille', 'farfadet', 'zigouigoui'];
const BOUILLE = '0006000U040L0N0000000000';   // 24 caractères, base62 : jamais « corrompue »

const NOMS_ORIGINE = ['Banano', 'Orangine', 'Kiwano', 'Pépino', 'Mirabo', 'Cassis'];

let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: String(SOCKET_PORT), FRUTISCORE_PORT: String(SOCKET_PORT + 1),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let pret = false;
  for (let i = 0; i < 160 && !pret; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) pret = true; } catch { /* pas prêt */ }
    if (!pret) await wait(250);
  }
  if (!pret) throw new Error('serveur indisponible');

  // Le compte homonyme existe pour de vrai…
  await inscrire(HOMONYME);
  // …et l'annuaire le contient, au milieu de Frutiz sans compte.
  const lignes = [HOMONYME].concat(ANNUAIRE).map((p) => p + ',' + BOUILLE).join('\r\n');
  const rep = await fetch(BASE + '/api/admin/trombinoscope/import', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv', 'x-admin-key': CLE },
    body: lignes,
  });
  const j = await rep.json();
  assert.ok(j.ok && j.total >= ANNUAIRE.length + 1, 'annuaire importé (' + JSON.stringify(j).slice(0, 120) + ')');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
}

// ── Un client XMLSocket minimal (messages XML terminés par un octet nul) ─────
function ouvrir(pseudo) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKET_PORT, '127.0.0.1');
    let tampon = '';
    const recus = [];
    let attente = null;
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      tampon += d;
      let i;
      while ((i = tampon.indexOf('\0')) >= 0) {
        const m = tampon.slice(0, i);
        tampon = tampon.slice(i + 1);
        if (m) recus.push(m);
      }
      if (attente) { const f = attente; attente = null; f(); }
    });
    sock.on('error', reject);
    const client = {
      envoyer: (xml) => sock.write(xml + '\0'),
      vider: () => { recus.length = 0; },
      // Attend le dernier message correspondant au motif, ou rend null.
      attendre: async (motif, msMax) => {
        const fin = Date.now() + (msMax || 4000);
        for (;;) {
          const trouve = recus.filter((m) => motif.test(m)).pop();
          if (trouve) return trouve;
          if (Date.now() > fin) return null;
          await new Promise((r) => { attente = r; setTimeout(r, 120); });
        }
      },
      fermer: () => sock.destroy(),
    };
    sock.on('connect', () => {
      client.envoyer(`<ident l="${pseudo}" />`);
      resolve(client);
    });
  });
}

// Les <pl …/> marqués bot="1" du dernier salon reçu.
function botsDuSalon(xml) {
  const out = [];
  for (const m of xml.matchAll(/<pl ([^>]*?)\/>/g)) {
    const attrs = {};
    for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    if (attrs.bot === '1') out.push(attrs);
  }
  return out;
}

// Entre au salon d'un jeu et rend { client, bots }.
async function entrer(jeu, pseudo) {
  const c = await ouvrir(pseudo);
  await wait(400);                                   // laisse l'ident se conclure
  c.vider();
  c.envoyer(`<${jeu} a="hello" n="${pseudo}" />`);
  const xml = await c.attendre(new RegExp('<' + jeu + ' e="lobby"'));
  assert.ok(xml, jeu + ' : le salon est arrivé');
  return { c: c, bots: botsDuSalon(xml) };
}

// Défie un bot et abandonne aussitôt : la partie se conclut, et c'est ce
// moment-là qui doit rendre au bot une nouvelle tête. Rend le salon d'après.
async function partieContre(jeu, c, botId) {
  c.vider();
  c.envoyer(`<${jeu} a="challenge" u="${botId}" t="60000" />`);
  assert.ok(await c.attendre(new RegExp('<' + jeu + ' e="(start|state)"')), jeu + ' : la partie démarre');
  c.vider();
  c.envoyer(`<${jeu} a="part" />`);                  // le joueur jette l'éponge
  const xml = await c.attendre(new RegExp('<' + jeu + ' e="lobby"'));
  assert.ok(xml, jeu + ' : le salon revient après la partie');
  return botsDuSalon(xml);
}

async function salonDe(jeu, pseudo) {
  const e = await entrer(jeu, pseudo);
  e.c.fermer();
  return e.bots;
}

// ── Le test ────────────────────────────────────────────────────────────────

for (const [jeu, nom] of [['bd', 'Frutibandas'], ['gz', 'Grapiz']]) {
  test(nom + ' : les bots portent un pseudo et une bouille du Bouilloscope', async () => {
    const bots = await salonDe(jeu, 'visiteur' + jeu + RUN);
    assert.equal(bots.length, 3, 'trois bots au salon');

    for (const b of bots) {
      assert.ok(ANNUAIRE.includes(b.n),
        `« ${b.n} » vient de l'annuaire (et non des noms gravés dans le code)`);
      assert.ok(!NOMS_ORIGINE.includes(b.n), `« ${b.n} » n'est plus un nom d'origine`);
      assert.equal(b.f, BOUILLE, 'la bouille de l\'annuaire suit le pseudo');
    }
    assert.equal(new Set(bots.map((b) => b.n)).size, 3, 'trois pseudos distincts');

    // L'identifiant INTERNE, lui, n'a pas bougé : c'est sur lui que reposent le
    // lobby, les sessions et les séries. Seul l'habillage change.
    const interne = jeu === 'bd' ? ['banano', 'orangine', 'kiwano'] : ['pepino', 'mirabo', 'cassis'];
    assert.deepEqual(bots.map((b) => b.u).sort(), interne.slice().sort(),
      'les identifiants internes sont inchangés');
  });

  test(nom + ' : un bot qui a joué revient sous une autre identité', async () => {
    const { c, bots } = await entrer(jeu, 'revanche' + jeu + RUN);
    const cible = bots[0];
    const apres = await partieContre(jeu, c, cible.u);
    const memeBot = apres.find((b) => b.u === cible.u);
    const voisin = apres.find((b) => b.u === bots[1].u);
    c.fermer();
    assert.notEqual(memeBot.n, cible.n,
      `l'adversaire suivant a l'air d'être quelqu'un d'autre (${cible.n} → ${memeBot.n})`);
    assert.ok(ANNUAIRE.includes(memeBot.n), 'sa nouvelle tête vient encore de l\'annuaire');
    assert.equal(voisin.n, bots[1].n, 'les bots restés au repos ne se renomment pas dans son dos');
    assert.equal(new Set(apres.map((b) => b.n)).size, 3, 'toujours trois pseudos distincts');
  });

  test(nom + " : jamais le pseudo d'un joueur qui existe pour de vrai", async () => {
    // Chaque partie rebat les têtes : on en enchaîne une dizaine pour multiplier
    // les tirages. Douze Frutiz libres pour trois places — sans le garde-fou,
    // le compte homonyme sortirait en deux ou trois parties.
    const { c, bots } = await entrer(jeu, 'garde' + jeu + RUN);
    const vus = new Set();
    const verifier = (liste) => {
      for (const b of liste) {
        vus.add(b.n);
        assert.notEqual(b.n.toLowerCase(), HOMONYME.toLowerCase(),
          `« ${HOMONYME} » a un compte : son pseudo est interdit aux bots`);
      }
    };
    verifier(bots);
    let courants = bots;
    for (let i = 0; i < 10; i++) {
      courants = await partieContre(jeu, c, courants[i % 3].u);
      verifier(courants);
    }
    c.fermer();
    // Et le tirage brasse vraiment : sans cela le test ne prouverait rien.
    assert.ok(vus.size >= 6, 'les têtes tournent (' + vus.size + ' pseudos différents vus)');
  });
}
