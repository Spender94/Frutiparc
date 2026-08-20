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
const fs = require('node:fs');
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

// `lc="1"` est la marque du client Light. Le bureau (main.swf) ne l'envoie
// jamais : c'est à cela que le serveur reconnaît qui sait jouer un blindtest.
async function client(pseudo, sid, light = true) {
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
  ws.send(`<k l="${pseudo}" s="${sid}"${light ? ' lc="1"' : ''} />\0`);
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
const clientBureau = (pseudo, sid) => client(pseudo, sid, false);

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
  // /donne puise dans le COMPTE du donateur. L'enveloppe hebdomadaire, elle,
  // appartient à /don — qui crée des kikooz sans toucher au compte. Les avoir
  // confondues débitait deux fois l'animateur qui offrait son propre argent.
  assert.match(await quota(sidAnim), /a="2000"/,
    'et l\'enveloppe n\'a pas bougé : ce n\'était pas son argent à elle');

  assert.match(await donner(sidModo, 5000, 'sans plafond'), /k="0"/,
    'le modérateur donne aussi du sien');

  // L'écriture au registre part sans qu'on l'attende (le don ne doit pas
  // dépendre de la base) : on laisse la ligne se poser avant de relire.
  await wait(500);

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

  assert.equal(dAnim[0].source, 'personnel', 'et sa provenance : son compte');

  // L'enveloppe reste pleine : aucun /don n'a été passé.
  const env = reg.quotas.find((q) => q.username.toLowerCase() === ANIM);
  assert.deepEqual({ given: env.given, left: env.left, max: env.max },
    { given: 0, left: 2000, max: 2000 });

  // Les filtres.
  const parRole = await admin('/api/admin/kikooz-gifts?role=animateur');
  assert.equal(parRole.gifts.length, 1, 'filtre par rôle');
  const parCible = await admin(`/api/admin/kikooz-gifts?recipient=${CIBLE}`);
  assert.equal(parCible.gifts.length, 2, 'filtre par destinataire');
  const parDonneur = await admin(`/api/admin/kikooz-gifts?giver=${MODO}`);
  assert.equal(parDonneur.gifts.length, 1, 'filtre par donateur');
  const parSource = await admin('/api/admin/kikooz-gifts?source=personnel');
  assert.equal(parSource.gifts.length, 2, 'filtre par provenance');
});

// ── /don : le don qui puise dans l'enveloppe ──────────────────────────────
//
// C'est CELUI-LÀ que l'équipe voulait relire, et il n'était nulle part : seul
// /donne — l'argent personnel — remontait à l'admin. Le registre était donc
// exactement à l'envers de ce qu'on en attendait.

test('/don débite l\'enveloppe, s\'inscrit au registre, et ne touche pas le compte', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const DONN = 'animenv';
  const sidAnim = await inscrire(DONN);
  await donnerRole(DONN, { is_animator: true, kikooz: 777 });
  await inscrire(CIBLE);
  const anim = await client(DONN, sidAnim);
  const cible = await client(CIBLE, await inscrire(CIBLE));
  try {
    anim.envoyer('<o g="pomme" />');
    cible.envoyer('<o g="pomme" />');
    await cible.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'userlist');

    anim.envoyer(`<t g="pomme" t="m" p="">/don ${CIBLE} 250</t>`);
    await cible.attendre((x) => x.includes('250'), 'l\'annonce du don');
    await wait(600);

    const reg = await admin(`/api/admin/kikooz-gifts?giver=${DONN}`);
    assert.equal(reg.gifts.length, 1, 'le /don est inscrit au registre');
    assert.equal(reg.gifts[0].amount, 250);
    assert.equal(reg.gifts[0].source, 'enveloppe', 'et marqué comme venant de l\'enveloppe');
    assert.equal(reg.gifts[0].recipient, CIBLE);

    // Le compte du donateur n'a pas bougé : /don CRÉE les kikooz.
    const quota = await fetch(`${BASE}/do/give?sid=${sidAnim}`, { cache: 'no-store' }).then((x) => x.text());
    assert.match(quota, /a="1750"/, 'l\'enveloppe est débitée de 250');
    const env = (reg.quotas || []).find((q) => q.username.toLowerCase() === DONN);
    assert.equal(env.given, 250, 'et l\'admin le montre');
  } finally { anim.fermer(); cible.fermer(); }
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

// ── 5. Le blindtest ────────────────────────────────────────────────────────
//
// YouTube seul : le SDK de Spotify n'émet un son que si l'auditeur possède un
// compte Premium ET s'authentifie en OAuth — inutilisable pour un salon.
//
// Trois choses valent d'être tenues : le salon ne doit JAMAIS voir passer
// l'identifiant de la vidéo (sinon la réponse s'affiche avec la question), un
// retardataire doit tomber sur la même seconde que les autres, et le SWF du
// bureau — qui ne saurait pas jouer YouTube — ne doit pas recevoir une trame
// dont il ne ferait rien.

test('le blindtest : un jeton, jamais la vidéo, et tout le monde à la même seconde', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire(ANIM);
  await donnerRole(ANIM, { is_animator: true });
  const sidLight = await inscrire('btlight');
  const sidBureau = await inscrire('btbureau');
  const anim = await client(ANIM, sidAnim);
  const light = await client('btlight', sidLight);      // lc="1" : un mobile
  const bureau = await clientBureau('btbureau', sidBureau);
  try {
    for (const c of [anim, light, bureau]) c.envoyer('<o g="pomme" />');
    await light.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'userlist');

    // La syntaxe, puis un lien qui n'est pas de YouTube.
    anim.envoyer('<t g="pomme" t="m" p="">/blind</t>');
    assert.match(await anim.attendre((x) => x.includes('Blindtest —'), 'l\'aide'), /YouTube/);
    anim.envoyer('<t g="pomme" t="m" p="">/blind https://exemple.test/chanson.mp3</t>');
    await anim.attendre((x) => x.includes('non reconnu'), 'le refus');

    // L'extrait.
    light.trames.length = 0; bureau.trames.length = 0;
    anim.envoyer('<t g="pomme" t="m" p="">/blind https://youtu.be/dQw4w9WgXcQ?t=1m02s 1:02 20</t>');
    const annonce = await light.attendre((x) => x.includes('Blindtest !'), 'l\'annonce');
    assert.match(annonce, /t="c"/, 'annoncé dans la typo bleue');
    assert.match(annonce, /20 secondes/);
    // LE point : le salon ne voit pas la vidéo.
    assert.ok(!annonce.includes('dQw4w9WgXcQ'), 'l\'annonce ne trahit pas la chanson');

    const trame = await light.attendre((x) => x.includes('t="bt"'), 'la trame du lecteur');
    const jeton = /bk="([^"]*)"/.exec(trame)[1];
    assert.equal(jeton.length, 16, 'un jeton opaque');
    assert.ok(!trame.includes('dQw4w9WgXcQ'), 'la trame non plus ne la trahit pas');
    assert.match(trame, /bd="20"/, 'la durée voyage');
    await wait(400);
    assert.ok(!bureau.trames.some((x) => x.includes('t="bt"')),
      'le SWF du bureau ne reçoit rien : sa page hôte interroge l\'état à la place');

    // Le lecteur : une redirection vers l'extrait, bornée et sans habillage.
    const r = await fetch(`${BASE}/api/blindtest/embed?k=${jeton}`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const dest = new URL(r.headers.get('location'));
    assert.equal(dest.origin + dest.pathname, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
    assert.ok(Number(dest.searchParams.get('start')) >= 62, 'départ à 1:02');
    assert.equal(dest.searchParams.get('end'), '82', 'et fin vingt secondes plus loin');
    assert.equal(dest.searchParams.get('controls'), '0', 'sans contrôles ni titre à lire');

    // MUET au départ, et pilotable ensuite — c'est ce qui fait entendre
    // l'extrait ailleurs que sur Firefox (cf. test/blindtestSon.test.js).
    assert.equal(dest.searchParams.get('mute'), '1', 'muet au départ');
    assert.equal(dest.searchParams.get('enablejsapi'), '1', 'mais pilotable');
    assert.match(String(dest.searchParams.get('origin')), /^https?:\/\/[^/]+$/,
      'avec l\'origine de la page, sans laquelle YouTube n\'écoute pas : '
        + dest.searchParams.get('origin'));

    // La porte de sortie du dernier recours : ?m=0 rend le son — et l'extrait
    // garde sa seconde, il ne repart pas du début.
    const rSon = await fetch(`${BASE}/api/blindtest/embed?k=${jeton}&m=0`, { redirect: 'manual' });
    const destSon = new URL(rSon.headers.get('location'));
    assert.equal(destSon.searchParams.get('mute'), '0', 'avec ?m=0, le son est rendu');
    assert.ok(Number(destSon.searchParams.get('start')) >= 62,
      'et le recours reste synchrone : ' + destSon.searchParams.get('start'));

    // La synchro par l'horloge : deux secondes plus tard, on entre plus loin.
    await wait(2200);
    const r2 = await fetch(`${BASE}/api/blindtest/embed?k=${jeton}`, { redirect: 'manual' });
    const tard = Number(new URL(r2.headers.get('location')).searchParams.get('start'));
    assert.ok(tard >= 64, `un retardataire entre à ${tard} s, pas au début`);

    // L'état que lit la page hôte du bureau.
    const st = await (await fetch(`${BASE}/api/blindtest/state?sid=${sidBureau}`)).json();
    assert.equal(st.jeton, jeton, 'la page hôte retrouve l\'extrait de son salon');
    assert.ok(st.restant > 0 && st.restant <= 20);
    assert.equal(st.par.toLowerCase(), ANIM);

    // L'arrêt.
    light.trames.length = 0;
    anim.envoyer('<t g="pomme" t="m" p="">/blindstop</t>');
    await light.attendre((x) => x.includes('arrêté'), 'l\'annonce d\'arrêt');
    await light.attendre((x) => x.includes('t="bt"') && x.includes('bk=""'), 'l\'ordre de se taire');
    const r3 = await fetch(`${BASE}/api/blindtest/embed?k=${jeton}`, { redirect: 'manual' });
    assert.equal(r3.status, 404, 'le jeton ne mène plus nulle part');

    // Et un joueur ordinaire ne lance rien.
    light.envoyer('<t g="pomme" t="m" p="">/blind https://youtu.be/dQw4w9WgXcQ</t>');
    await wait(600);
    const st2 = await (await fetch(`${BASE}/api/blindtest/state?sid=${sidLight}`)).json();
    assert.equal(st2.jeton, null, 'la commande d\'un non-animateur ne lance aucun extrait');
  } finally { anim.fermer(); light.fermer(); bureau.fermer(); }
});

test('le blindtest accepte les liens YouTube tels qu\'on les colle', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidAnim = await inscrire(ANIM);
  await donnerRole(ANIM, { is_animator: true });
  const anim = await client(ANIM, sidAnim);
  const light = await client('btformes', await inscrire('btformes'));
  try {
    anim.envoyer('<o g="pomme" />');
    light.envoyer('<o g="pomme" />');
    await light.attendre((x) => x.startsWith('<p') && x.includes('g="pomme"'), 'userlist');

    const formes = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45s', 45],
      ['https://youtu.be/dQw4w9WgXcQ?t=90', 90],
      ['https://www.youtube.com/embed/dQw4w9WgXcQ?start=12', 12],
      ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 0],
      ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 0],
      ['dQw4w9WgXcQ', 0],                                   // l'identifiant nu
    ];
    for (const [lien, debutAttendu] of formes) {
      light.trames.length = 0;
      anim.envoyer(`<t g="pomme" t="m" p="">/blind ${lien}</t>`);
      const trame = await light.attendre((x) => x.includes('t="bt"') && x.includes('bk="'),
        `la trame pour ${lien}`);
      const jeton = /bk="([^"]*)"/.exec(trame)[1];
      assert.ok(jeton, `${lien} est reconnu`);
      const r = await fetch(`${BASE}/api/blindtest/embed?k=${jeton}`, { redirect: 'manual' });
      const d = new URL(r.headers.get('location'));
      assert.equal(d.pathname, '/embed/dQw4w9WgXcQ', `${lien} → la bonne vidéo`);
      // Le repère de temps du lien sert de départ quand on n'en donne pas.
      const start = Number(d.searchParams.get('start'));
      assert.ok(start >= debutAttendu && start <= debutAttendu + 3,
        `${lien} démarre vers ${debutAttendu} s (mesuré ${start})`);
      // La durée par défaut : trente secondes.
      assert.equal(Number(d.searchParams.get('end')) - debutAttendu, 30,
        `${lien} dure trente secondes par défaut`);
      anim.envoyer('<t g="pomme" t="m" p="">/blindstop</t>');
      await wait(150);
    }
  } finally { anim.fermer(); light.fermer(); }
});

// ── Le RENDU du classement sur le client Light ────────────────────────────
//
// Les tests plus haut vérifient la TRAME que diffuse le serveur. Ce n'est pas
// la même chose que ce que le joueur lit : la première version du classement
// sans balises est bien partie en t="c" avec ses <br/>… et le mobile les a
// affichés EN CLAIR, parce qu'il ne passait le corps par `htmlToText` que
// s'il COMMENÇAIT par « < ». Une capture d'écran l'a montré, aucun test ne
// l'avait vu. Celui-ci fait tourner le vrai code du client sur un vrai corps.

test('le mobile rend le classement sur plusieurs lignes, sans <br/> en clair', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  // On extrait les fonctions du client, telles qu'elles sont écrites.
  const prendre = (nom) => {
    const m = new RegExp(`\\n  function ${nom}\\(([\\s\\S]*?)\\n  \\}`).exec(html);
    assert.ok(m, `${nom} trouvée dans light.html`);
    return `function ${nom}(${m[1]}\n}`;
  };
  // Et la ligne qui décide du corps affiché pour une ligne bleue (t="c").
  const ligne = /if \(ty === "c"\) \{[\s\S]*?(var cBody = [^\n]+)/.exec(html);
  assert.ok(ligne, 'la construction du corps t="c" est trouvée');

  const rendre = new Function('body', [
    prendre('xmlUnescape'), prendre('stripCdata'), prendre('htmlToText'),
    ligne[1], 'return cBody;',
  ].join('\n'));

  // Le corps exact que diffuse `formaterClassement`.
  const corps = '<![CDATA[Classement — Manche 1<br/>1. remi — 5 pts<br/>2. zoe — 3 pts]]>';
  const rendu = rendre(corps);
  assert.ok(!/<br/i.test(rendu), 'aucun <br/> n\'apparaît en clair : ' + rendu);
  assert.equal(rendu.split('\n').length, 3, 'trois lignes');
  assert.match(rendu.split('\n')[0], /^Classement — Manche 1$/);
  assert.match(rendu.split('\n')[1], /^1\. remi — 5 pts$/);

  // Et le CSS les laisse vivre : sans `pre-line`, le HTML replierait tout.
  assert.match(html, /\.msg\.blue \.body \{ white-space: pre-line; \}/,
    'les retours à la ligne sont respectés à l\'affichage');

  // Une ligne bleue ORDINAIRE (le mode /blueon, du texte d'un joueur) passe
  // toujours, y compris quand elle contient des chevrons — qui nous arrivent
  // échappés et doivent réapparaître tels quels.
  assert.equal(rendre('<![CDATA[<i>Mode bleu activé.</i>]]>'), 'Mode bleu activé.');
  assert.equal(rendre('<![CDATA[3 &lt; 5 &amp; 7 &gt; 2]]>'), '3 < 5 & 7 > 2');
});

// ── Les couleurs du bureau, pas celles qu'on croit ────────────────────────
//
// Le bleu du mode animateur avait été approché à l'œil (#1A5FD0, un bleu vif)
// alors que le bureau en applique un tout autre : main.swf compose ces lignes
// en `<font size="14"><b>…</b></font>` teintées de `penBlueAnimator`, que
// global.as déclare {r:0, g:0, b:70} — un marine presque noir. On lit donc la
// déclaration à la source, pour que le portage ne puisse plus dériver.

test('le mode animateur reprend la teinte et la taille exactes du bureau', () => {
  const global = fs.readFileSync(path.join(ROOT, 'frutiparc/global.as'), 'utf8');
  const lire = (nom) => {
    const m = new RegExp(`_global\\.${nom}\\s*=\\s*\\{\\s*r:\\s*(\\d+)\\s*,\\s*g:\\s*(\\d+)\\s*,\\s*b:\\s*(\\d+)`).exec(global);
    assert.ok(m, `${nom} déclaré dans global.as`);
    return '#' + [m[1], m[2], m[3]]
      .map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const bleu = lire('penBlueAnimator');
  const rouge = lire('penRedMode');
  assert.equal(bleu, '#000046', 'le bleu animateur du SWF');
  assert.equal(rouge, '#C10000', 'et le rouge du cri');

  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.ok(html.includes('color: ' + bleu.toLowerCase()) || html.includes('color: ' + bleu),
    'la ligne bleue du mobile porte ' + bleu);
  assert.ok(html.includes(rouge) || html.includes(rouge.toLowerCase()),
    'et le cri rouge porte ' + rouge);
  // Plus aucune trace du bleu inventé.
  assert.ok(!/1A5FD0/i.test(html), 'le bleu approché à l\'œil a disparu de light.html');

  // La taille : le chat du bureau écrit en Verdana 12, l'animateur en 14.
  assert.match(html, /\.msg\.blue \{ font-size: 1\.1667em; \}/,
    'le rapport de taille 14/12 est appliqué');

  // Le bandeau du blindtest emprunte la même teinte, sur les deux clients.
  assert.match(html, /\.blindtest \{[\s\S]*?background: #000046;/, 'le bandeau mobile');
  const ruffle = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');
  assert.match(ruffle, /background:#000046/, 'et le bandeau du bureau');
  assert.ok(!/1A5FD0/i.test(ruffle), 'plus de bleu inventé côté bureau non plus');
});

// ── La persistance, prouvée plutôt qu'affirmée ────────────────────────────
//
// « L'historique est-il persistant ? » — la seule réponse honnête est un
// SECOND serveur. On en lance un sur la MÊME base, sans rien partager avec le
// premier : ce qu'il voit vient forcément du disque, pas d'une mémoire.
//
// Il vérifie du même coup deux choses qui ne se voient qu'au redémarrage :
// l'enveloppe hebdomadaire, recomptée depuis le registre (le fichier JSON ne
// sert plus dès qu'une base est là), et le tableau des enveloppes de l'admin,
// qui lisait le cache mémoire des comptes — vide au démarrage, puisqu'il ne se
// remplit qu'à la demande.

test('l\'historique et l\'enveloppe vivent en base, pas en mémoire', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  // Son propre compte : les autres tests du fichier partagent la base, et une
  // enveloppe déjà entamée ailleurs rendrait la mesure illisible.
  const PERS = 'animpersist';
  const sidAnim = await inscrire(PERS);
  await donnerRole(PERS, { is_animator: true, kikooz: 100000 });
  await inscrire(CIBLE);
  // Un don d'ENVELOPPE (/don) : c'est lui qui entame le quota, donc lui qui
  // prouve que le quota se recompte depuis la base.
  const pers = await client(PERS, sidAnim);
  try {
    pers.envoyer('<o g="pomme" />');
    await wait(400);
    pers.envoyer(`<t g="pomme" t="m" p="">/don ${CIBLE} 470</t>`);
    await wait(800);
  } finally { pers.fermer(); }

  // Un second serveur, sur la même base, qui ne sait rien du premier.
  const PORT2 = 3463;
  const BASE2 = `http://127.0.0.1:${PORT2}`;
  const autre = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT2), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5290', FRUTISCORE_PORT: '5291',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let journal = '';
  autre.stdout.on('data', (d) => { journal += d.toString(); });
  autre.stderr.on('data', () => {});
  try {
    let pret = false;
    for (let i = 0; i < 200 && !pret; i++) {
      try { pret = (await fetch(BASE2 + '/api/loadFrutiSlots?game=snake3')).ok; } catch {}
      if (!pret) await wait(250);
    }
    assert.ok(pret, 'le second serveur répond');
    await wait(1500);                   // le temps de sa reprise au démarrage

    const vu = await (await fetch(BASE2 + '/api/admin/kikooz-gifts',
      { headers: { 'x-admin-key': CLE } })).json();
    const don = (vu.gifts || []).find((g) => g.giver === PERS && g.amount === 470);
    assert.ok(don, 'le second serveur relit le don du premier');
    assert.equal(don.amount, 470);
    assert.equal(don.giver_role, 'animateur');
    assert.equal(don.source, 'enveloppe');

    // L'enveloppe : recomptée depuis le registre, pas depuis un fichier.
    assert.match(journal, /Quota de dons repris pour \d+ donateur/,
      'la reprise au démarrage a bien eu lieu');
    const sid2 = (await (await fetch(BASE2 + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: PERS, password: 'secret123' }),
    })).json()).sid;
    const quota = await (await fetch(`${BASE2}/do/give?sid=${sid2}`, { cache: 'no-store' })).text();
    assert.match(quota, /a="1530"/, 'et elle est bien entamée de 470 sur le second serveur');

    // Le tableau des enveloppes de l'admin lisait le cache MÉMOIRE des comptes,
    // qui ne se remplit qu'à la demande : il était vide au redémarrage.
    const ligne = (vu.quotas || []).find((q) => q.username.toLowerCase() === PERS);
    assert.ok(ligne, 'l\'animateur figure au tableau des enveloppes');
    assert.equal(ligne.given, 470);
    assert.equal(ligne.left, 1530);
  } finally { autre.kill('SIGKILL'); }
});
