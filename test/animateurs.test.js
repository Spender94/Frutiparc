// Les demandes de l'équipe d'animation, une par une.
//
// 1. /img ne marchait pas pour les animateurs. Le portillon du SERVEUR était
//    correct depuis toujours ; c'est la porte du BUREAU qui ne s'ouvrait pas.
//    Le SWF gate sa commande /image sur `me.flAnimator`, drapeau posé par
//    l'attribut a="1" de la réponse d'identification — et cet attribut n'était
//    envoyé qu'aux modérateurs. La commande mourait donc dans le client, sans
//    un mot, avant même d'atteindre le réseau.
//
// 2. L'historique des dons de kikooz. Le destinataire gardait sa ligne, le
//    donateur rien du tout. Et le quota hebdomadaire des animateurs était LU
//    mais jamais DÉBITÉ : 2000 kikooz restants à perpétuité.
//
// 3. Le classement du quiz (/showpoint) en typo du mode bleu — c'est-à-dire
//    t="c", le type que les deux clients rendent en bleu gras.
//
// 4. /sujet n'avait aucun effet visible : il n'écrivait que le `topic`, qui ne
//    s'affiche nulle part en permanence, jamais le `desc` — le « nom affiché »
//    que tout le monde lit. Il n'avait pas non plus le moindre contrôle de
//    droits : n'importe qui pouvait renommer le salon des autres.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3462;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-animateurs';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_anim';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ANIM = 'animdon', MODO = 'mododon', CIBLE = 'cibledon', JOUEUR = 'joueurdon';

let proc = null, dispo = false;

async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch {} return false; }
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5198', FRUTISCORE_PORT: '5199',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'kikooz_gifts'`);
        await c.end();
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}
const donnerRole = (pseudo, champs) => fetch(`${BASE}/api/admin/users/${pseudo}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
  body: JSON.stringify(champs),
});
const admin = (chemin) => fetch(BASE + chemin, { headers: { 'x-admin-key': CLE } }).then((r) => r.json());

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
    pseudo, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    attendre: async (pred, quoi, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      throw new Error(`${pseudo} : ${quoi} — jamais reçu. Trames : ${trames.join(' ').slice(0, 700)}`);
    },
    fermer: () => { try { ws.close(); } catch {} },
  };
  await c.attendre((t) => t.startsWith('<k'), 'accusé d\'identification');
  return c;
}

// ── 1. Le drapeau qui ouvre /image au bureau ──────────────────────────────

test('l\'animateur reçoit a="1" à l\'identification — sans quoi /img meurt dans le client', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire(ANIM);
  const sidModo = await inscrire(MODO);
  assert.equal((await donnerRole(ANIM, { is_animator: true, kikooz: 100000 })).status, 200);
  assert.equal((await donnerRole(MODO, { is_moderator: true, kikooz: 100000 })).status, 200);

  const identAnim = await (await fetch(`${BASE}/do/onident?sid=${sidAnim}`)).text();
  // a="1" → listener/main.as : `_global.me.flAnimator = true`, le seul drapeau
  // que consulte le gate de /image (`if( !me.flAnimator ) return false`).
  assert.match(identAnim, /\sa="1"/, 'l\'animateur porte le drapeau d\'animation');
  // m="1" → flMode, le pouvoir GLOBAL de kick/ban. Il ne bouge pas : l'animateur
  // reçoit le sien salon par salon, dans la liste des connectés.
  assert.ok(!/\sm="1"/.test(identAnim), 'mais pas la modération globale');

  const identModo = await (await fetch(`${BASE}/do/onident?sid=${sidModo}`)).text();
  assert.match(identModo, /\sm="1"/, 'le modérateur garde flMode');
  assert.match(identModo, /\sa="1"/, 'et flAnimator');

  const identSimple = await (await fetch(`${BASE}/do/onident?sid=${await inscrire(JOUEUR)}`)).text();
  assert.ok(!/\sa="1"/.test(identSimple), 'un joueur ordinaire n\'a ni l\'un ni l\'autre');
  assert.ok(!/\sm="1"/.test(identSimple));
});

// ── 2. Le registre des dons, et le quota enfin débité ─────────────────────

test('les dons de kikooz laissent une trace, et l\'enveloppe hebdomadaire se vide', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire(ANIM);
  const sidModo = await inscrire(MODO);
  await inscrire(CIBLE);

  const donner = (sid, k, r) => fetch(
    `${BASE}/do/give?sid=${sid}&k=${k}&u=${CIBLE}&r=${encodeURIComponent(r || '')}`,
    { cache: 'no-store' }).then((x) => x.text());
  const quota = (sid) => fetch(`${BASE}/do/give?sid=${sid}`, { cache: 'no-store' }).then((x) => x.text());

  assert.match(await quota(sidAnim), /a="2000"/, 'l\'enveloppe part pleine');

  assert.match(await donner(sidAnim, 300, 'bonne réponse au quiz'), /k="0"/, 'le don passe');
  // C'est LE défaut : `animatorKikoozLeft` était lu par /meskikooz mais rien ne
  // créditait jamais `given`. Le compteur annonçait 2000 à perpétuité.
  assert.match(await quota(sidAnim), /a="1700"/, 'et l\'enveloppe est débitée');

  // Le refus part en k="4" (le seul code que le bureau sait traduire) avec
  // q="1", que le client Light lit pour dire la vraie raison.
  const trop = await donner(sidAnim, 1800, 'au-delà');
  assert.match(trop, /k="4"/);
  assert.match(trop, /q="1"/, 'le refus distingue l\'enveloppe du solde');
  assert.match(await quota(sidAnim), /a="1700"/, 'un refus ne débite rien');

  assert.match(await donner(sidModo, 5000, 'sans plafond'), /k="0"/,
    'le modérateur n\'est pas plafonné');

  // Le registre.
  const reg = await admin('/api/admin/kikooz-gifts?limit=50');
  assert.equal(reg.ok, true);
  const dAnim = reg.gifts.filter((x) => x.giver === ANIM);
  assert.equal(dAnim.length, 1, 'un seul don inscrit — le refus n\'en laisse pas');
  assert.equal(dAnim[0].amount, 300);
  assert.equal(dAnim[0].reason, 'bonne réponse au quiz', 'le motif est gardé');
  assert.equal(dAnim[0].giver_role, 'animateur', 'et le rôle du donateur');
  assert.equal(dAnim[0].recipient, CIBLE);
  const dModo = reg.gifts.filter((x) => x.giver === MODO);
  assert.equal(dModo.length, 1);
  assert.equal(dModo[0].giver_role, 'moderateur');

  // L'enveloppe de la semaine, telle que l'admin la montre.
  const env = reg.quotas.find((q) => q.username.toLowerCase() === ANIM);
  assert.deepEqual({ given: env.given, left: env.left, max: env.max },
    { given: 300, left: 1700, max: 2000 });

  // Les filtres.
  const parRole = await admin('/api/admin/kikooz-gifts?role=animateur');
  assert.equal(parRole.gifts.length, 1, 'filtre par rôle');
  const parCible = await admin(`/api/admin/kikooz-gifts?recipient=${CIBLE}`);
  assert.equal(parCible.gifts.length, 2, 'filtre par destinataire');
  const parDonneur = await admin(`/api/admin/kikooz-gifts?giver=${MODO}`);
  assert.equal(parDonneur.gifts.length, 1, 'filtre par donateur');
});

// ── 3 & 4. Le classement, et /sujet ───────────────────────────────────────

test('le classement du quiz prend la typo du mode bleu, ex æquo compris', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire(ANIM);
  await donnerRole(ANIM, { is_animator: true });
  const sidTem = await inscrire('temoinquiz');
  const anim = await client(ANIM, sidAnim);
  const temoin = await client('temoinquiz', sidTem);
  try {
    anim.envoyer('<o g="pomme" />');
    temoin.envoyer('<o g="pomme" />');
    await temoin.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'userlist');

    anim.envoyer('<t g="pomme" t="m" p="">/initpoint Capitale du Perou ?</t>');
    await temoin.attendre((x) => x.includes('Quiz lancé'), 'l\'annonce');
    anim.envoyer(`<t g="pomme" t="m" p="">/point ${CIBLE} 12</t>`);
    await temoin.attendre((x) => x.includes('12'), 'les points');
    anim.envoyer(`<t g="pomme" t="m" p="">/point ${JOUEUR} 12</t>`);
    await wait(300);

    temoin.trames.length = 0;
    anim.envoyer('<t g="pomme" t="m" p="">/showpoint</t>');
    const cl = await temoin.attendre((x) => x.includes('Classement'), 'le classement');

    // t="c" est le type du mode bleu (/blueon) : les DEUX clients le rendent en
    // bleu gras. Il partait en t="m" avec un <font> dedans, que le client Light
    // aplatissait au texte — et dont il remplaçait les <br/> par des espaces.
    assert.match(cl, /t="c"/, 'la typo du mode bleu');
    assert.ok(!/<font/.test(cl), 'plus de <font> : la couleur vient du type');
    assert.match(cl, /<br\/>/, 'et les lignes restent des lignes');

    const corps = cl.replace(/[\s\S]*CDATA\[/, '').replace(/\]\][\s\S]*/, '');
    const lignes = corps.split('<br/>');
    assert.match(lignes[0], /^Classement — Capitale du Perou \?$/, 'la question en tête');
    // Deux joueurs à douze points sont tous les deux PREMIERS.
    assert.equal(lignes.filter((l) => l.startsWith('1.')).length, 2,
      'les ex æquo partagent leur rang');

    // La fin de quiz emprunte le même chemin.
    temoin.trames.length = 0;
    anim.envoyer('<t g="pomme" t="m" p="">/endpoint</t>');
    const fin = await temoin.attendre((x) => x.includes('Fin du quiz'), 'le classement final');
    assert.match(fin, /t="c"/);
    assert.ok(!/<font/.test(fin));
  } finally { anim.fermer(); temoin.fermer(); }
});

test('/sujet change le NOM AFFICHÉ du salon, et seule son équipe y touche', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire(ANIM);
  await donnerRole(ANIM, { is_animator: true });
  const sidJoueur = await inscrire(JOUEUR);
  const anim = await client(ANIM, sidAnim);
  const joueur = await client(JOUEUR, sidJoueur);
  try {
    anim.envoyer('<o g="pomme" />');
    joueur.envoyer('<o g="pomme" />');
    await joueur.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'userlist');

    const salon = async () => (await admin('/api/admin/channels')).channels.find((c) => c.name === 'pomme');
    const avant = await salon();
    assert.equal(avant.label, 'Salon Pomme', 'le nom affiché de départ');

    joueur.trames.length = 0;
    anim.envoyer('<t g="pomme" t="m" p="">/sujet Blindtest de 20h !</t>');
    await wait(600);
    const apres = await salon();
    assert.equal(apres.topic, 'Blindtest de 20h !', 'le sujet suit');
    // C'est CE champ que lisent la liste des salons et l'onglet — celui que
    // seule l'admin savait changer, d'où « /sujet n'est pas persistant ».
    assert.equal(apres.label, 'Blindtest de 20h !', 'et le nom affiché aussi');
    assert.ok(joueur.trames.some((x) => x.startsWith('<q') && x.includes('Blindtest')),
      'la liste des salons repart à tout le monde');

    // Et la commande n'avait AUCUN contrôle de droits.
    joueur.envoyer('<t g="pomme" t="m" p="">/sujet Salon pirate</t>');
    await joueur.attendre((x) => x.includes('réservé à son équipe'), 'le refus');
    await wait(400);
    assert.equal((await salon()).label, 'Blindtest de 20h !',
      'un joueur ordinaire ne renomme rien');
  } finally { anim.fermer(); joueur.fermer(); }
});

test('/mesdons répond en privé, avec l\'enveloppe restante', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire(ANIM);
  await donnerRole(ANIM, { is_animator: true });
  const sidTem = await inscrire('temoindons');
  const anim = await client(ANIM, sidAnim);
  const temoin = await client('temoindons', sidTem);
  try {
    anim.envoyer('<o g="pomme" />');
    temoin.envoyer('<o g="pomme" />');
    await temoin.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'userlist');

    temoin.trames.length = 0;
    anim.trames.length = 0;
    anim.envoyer('<t g="pomme" t="m" p="">/mesdons</t>');
    const md = await anim.attendre((x) => x.includes('Mes dons'), 'le relevé');
    assert.match(md, /t="c"/, 'même typo que le classement');
    assert.match(md, /2000/, 'et le rappel de l\'enveloppe');
    await wait(400);
    // Ce qu'un animateur distribue ne regarde pas le salon.
    assert.ok(!temoin.trames.some((x) => x.includes('Mes dons')), 'personne d\'autre ne le voit');
  } finally { anim.fermer(); temoin.fermer(); }
});
