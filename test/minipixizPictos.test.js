// Minipixiz sur /light : une course jouée débloque-t-elle vraiment des pictos ?
//
// Même question que pour Miniwave, et même exigence : rien n'est simulé côté
// serveur. La boucle complète tourne, sur un vrai serveur et une vraie base :
//
//   moteur (course réelle) → plateforme (fiche Card.mt) → /api/saveFrutiSlot
//     → extractGameItemsFromSlot (pictos) → computeConsecration (pourcentage)
//
// Et une deuxième question, propre à ce jeu : une fiche DÉJÀ ABÎMÉE — celles que
// les sept rattrapages de server.js décrivent — se répare-t-elle au chargement,
// ou le dégât se propage-t-il ? Le portage supprime la cause, pas les fiches
// déjà en base. C'est le dernier test de ce fichier, et il écrit le dégât
// directement en base pour être sûr de l'avoir vraiment.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3452;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-minipixiz-pictos';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_mppictos';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const JOUEUR = 'troll' + 'euse';

let proc = null, dispo = false;

// Le module plateforme est écrit pour le navigateur ; on lui fabrique un
// `window` et un `fetch` qui parlent au vrai serveur. C'est donc bien le
// fichier servi au joueur qui est exercé, pas une réécriture.
function chargerPlateforme() {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/plateforme.js'), 'utf8');
  const bac = {
    window: {}, Promise, JSON, Number, Array, Object, String, Error, Math, Date,
    fetch: (url, opt) => fetch(url.indexOf('http') === 0 ? url : BASE + url, opt),
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(src, bac, { filename: 'plateforme.js' });
  return bac.window.MinipixizPlateforme;
}

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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5182', FRUTISCORE_PORT: '5183',
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
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'users'`);
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

async function pictos(qui) {
  const r = await fetch(`${BASE}/api/admin/users/${qui || JOUEUR}/gameitems?key=${CLE}`);
  const brut = await r.json();
  const l = brut.items || brut.gameItems || brut;
  return Array.isArray(l) ? l.map((x) => (typeof x === 'string' ? x : x.id)) : [];
}
const consecration = async (sid) => (await fetch(
  `${BASE}/api/consecration?sid=${encodeURIComponent(sid)}`)).json();

// Une course réellement jouée : le moteur, des commandes, jusqu'à la mort ou
// jusqu'au relais suivant. C'est ce que fait la page, à l'affichage près.
function courir(P, carte, graine, depart) {
  const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
  const debut = depart || 0;
  const fin = P.finDeCourse(debut);
  const course = { niveaux: [], objets: [], dernier: debut, entree: true };
  // La page joue sur la fiche VIVANTE : Base.grab agit à l'instant du
  // ramassage, la fusion de fin de course ne solde que les stats. `carte`
  // ressort donc mutée, exactement comme plateforme.carte dans la page.
  let niveau = debut;
  while (niveau < fin) {
    const jeu = new E.Jeu({
      graine: graine + niveau, niveau, fiche: P.fiche(carte),
      onEvent: (nom, d) => {
        if (nom !== 'objet') return;
        course.objets.push(d.type);
        P.ramasser(carte, d.type);        // Base.grab agit tout de suite
      },
    });
    let i = 0;
    while (!jeu.termine && i < 20000) {
      jeu.entree.gauche = (i % 37) < 6;
      jeu.entree.droite = (i % 37) >= 6 && (i % 37) < 12;
      jeu.entree.tourner = (i % 53) === 0;
      jeu.entree.bas = (i % 7) < 4;
      jeu.update(1); i++;
    }
    if (!jeu.gagne) break;
    course.niveaux.push(niveau);
    niveau++;
  }
  course.dernier = niveau;
  return course;
}

test('une course jouée pour de vrai finit par se voir dans la fiche', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();

  const sid = await inscrire(JOUEUR);
  const p = new P.Plateforme(sid);
  await p.charger();
  assert.equal(p.charge, true, 'le compte neuf donne bien une fiche vierge');
  assert.equal(p.carte.$stat.$forestMax, 0, 'et rien d\'acquis');
  assert.equal(p.carte.$bag, 0, 'pas même un sac');

  const course = courir(P, p.carte, 7);
  assert.ok(course.niveaux.length > 0, `des niveaux ont été franchis (${course.niveaux.length})`);

  const r = await p.enregistrer(course);
  assert.equal(r.enregistre, true, 'la fiche est partie au serveur');

  // base/Forest : setWin incrémente le niveau AVANT endGame, donc terminer le
  // niveau n rapporte (n+1)².
  const attendu = course.niveaux.reduce((s, n) => s + (n + 1) * (n + 1), 0);
  const relu = await new P.Plateforme(sid).charger();
  assert.equal(relu.$stat.$run, attendu, '$stat.$run additionne le carré de chaque niveau');
  assert.equal(relu.$stat.$forestMax, course.dernier + 1, 'le meilleur niveau atteint');
  assert.equal(relu.$stat.$game[0], 1, 'une entrée en forêt comptée');
  assert.equal(relu.$stat.$game.length, 5, 'et les cinq zones intactes après l\'aller-retour');

  t.diagnostic(`course : ${course.niveaux.length} niveaux, $run ${attendu},`
    + ` ${course.objets.length} objet(s) ramassé(s)`);
});

test('les objets ramassés deviennent des pictos, et la consécration monte', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire(JOUEUR);            // même compte : on reprend sa fiche

  const avant = await consecration(sid);
  const dejaLa = await pictos();

  // On court jusqu'à ramasser. Le sac tombe le premier — c'est la règle du jeu
  // (Item.getRandomId ne donne rien d'autre tant qu'on n'en a pas) — et c'est
  // lui qui ouvre la pioche.
  const p = new P.Plateforme(sid);
  await p.charger();
  let tours = 0, ramasses = [];
  while (ramasses.length < 2 && tours < 30) {
    const course = courir(P, p.carte, 1000 + tours * 13);
    const r = await p.enregistrer(course);
    assert.equal(r.enregistre, true);
    ramasses = ramasses.concat(course.objets);
    tours++;
  }
  assert.ok(ramasses.length > 0, `des objets ont été ramassés (${ramasses.join(', ')})`);

  const relu = await new P.Plateforme(sid).charger();
  // Ce que la fiche doit porter : l'album pour les objets, le sac et le
  // trousseau pour ceux qui n'y entrent pas.
  const album = relu.$stat.$item.map((v, i) => (v ? i : null)).filter((v) => v !== null);
  assert.ok(album.length > 0, `l'album a retenu ${album.join(', ')}`);
  if (ramasses.includes(80)) assert.ok(relu.$bag >= 1, 'le sac ramassé a bien agrandi l\'inventaire');
  if (ramasses.includes(31)) assert.ok(relu.$key >= 1, 'la clé est allée au trousseau');

  // Et le serveur en a-t-il tiré les pictos ?
  const liste = await pictos();
  const gagnes = liste.filter((x) => !dejaLa.includes(x));
  for (const id of album) {
    assert.ok(liste.includes('$pixiz_item' + id),
      `picto de l'objet ${id} accordé (reçus : ${liste.join(', ') || 'aucun'})`);
  }
  assert.ok(gagnes.length > 0, 'au moins un picto est neuf');

  const apres = await consecration(sid);
  assert.ok(apres.overall > avant.overall,
    `la consécration progresse (${avant.overall} → ${apres.overall})`);

  t.diagnostic(`objets ${ramasses.join(' ')} → pictos ${gagnes.join(' ')}`
    + ` ; consécration ${avant.overall} → ${apres.overall}`);
});

test('une course ratée n\'efface pas ce qui était acquis', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire(JOUEUR);
  const p = new P.Plateforme(sid);
  const avant = await p.charger();
  const run = avant.$stat.$run;
  const record = avant.$stat.$forestMax;
  const sac = avant.$bag;
  const album = avant.$stat.$item.filter(Boolean).length;
  assert.ok(run > 0 && album > 0, 'la fiche porte la progression des tests précédents');

  // Morte au premier niveau, rien ramassé.
  await p.enregistrer({ niveaux: [], dernier: 0, objets: [], entree: true });

  const apres = await new P.Plateforme(sid).charger();
  assert.equal(apres.$stat.$run, run, '$run ne redescend pas');
  assert.equal(apres.$stat.$forestMax, record, 'le record tient');
  assert.equal(apres.$bag, sac, 'le sac reste');
  assert.equal(apres.$stat.$item.filter(Boolean).length, album, 'l\'album est intact');
  assert.equal(apres.$stat.$game[0], avant.$stat.$game[0] + 1, 'seule l\'entrée en forêt s\'ajoute');

  const liste = await pictos();
  assert.ok(liste.length > 0, 'et les pictos durement gagnés sont toujours là');
});

test('une fiche abîmée par Ruffle se répare au chargement au lieu de se propager', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const BLESSE = 'trollabime';
  const sid = await inscrire(BLESSE);

  // Le dégât exact que les garde-fous de server.js décrivent : Array.toString()
  // rend "" sur les tableaux passés par le pont JSON de Ruffle. $game, $kill,
  // $item, $eat et $inv partent donc en chaînes vides, et les sous-objets
  // manquent. On l'écrit DIRECTEMENT en base : l'API, elle, refuserait — c'est
  // justement à ça que sert isMinipixizSlot0Corrupted.
  const abimee = {
    $vs: 1.2, $bag: 2, $key: 3, $star: 5, $diam: 1, $checkpoint: 2,
    $inv: '', $faerie: '', $help: '', $mis: '', $god: '',
    $stat: { $run: 4242, $game: '', $kill: '', $item: '', $eat: '', $forestMax: 41 },
  };
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows } = await c.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [BLESSE]);
  assert.equal(rows.length, 1, 'le compte existe en base');
  await c.query(
    `INSERT INTO fruti_slots (user_id, game, slot_id, data) VALUES ($1, 'minipixiz', 0, $2)
     ON CONFLICT (user_id, game, slot_id) DO UPDATE SET data = EXCLUDED.data`,
    [rows[0].id, JSON.stringify(abimee)]);
  await c.end();
  // Le serveur sert les fiches depuis son cache mémoire, rempli à la connexion.
  // Sans relecture, il continuerait de répondre la fiche vide d'un compte neuf
  // et le test ne prouverait rien.
  const rh = await fetch(`${BASE}/api/admin/users/${BLESSE}/rehydrate?key=${CLE}`, { method: 'POST' });
  assert.equal(rh.ok, true, 'le serveur relit la base');

  // La défense est en DEUX couches, et on veut les deux.
  //
  // Couche 1, le serveur : padMinipixizSlot0 recolle la fiche à la lecture.
  // C'est lui qui répond en premier, donc le module client reçoit en général
  // une fiche déjà saine et n'a rien à signaler — c'est normal, pas un raté.
  const p = new P.Plateforme(sid);
  await p.charger();
  assert.equal(p.charge, true, 'une fiche abîmée reste enregistrable — elle est réparée, pas perdue');

  assert.equal(Array.isArray(p.carte.$stat.$game), true, '$game est redevenu un tableau');
  assert.equal(p.carte.$stat.$game.length, 5, 'de cinq cases');
  assert.equal(p.carte.$stat.$kill.length, 5);
  assert.equal(Array.isArray(p.carte.$stat.$item), true, '$item est un tableau, pas une chaîne');
  assert.equal(p.carte.$stat.$item.filter(Boolean).length, 0, 'vide, comme il l\'était');
  assert.equal(Array.isArray(p.carte.$inv), true, 'l\'inventaire aussi');
  assert.ok(p.carte.$dungeon && typeof p.carte.$dungeon === 'object', '$dungeon reconstruit');

  // Couche 2, le module : si la fiche arrivait abîmée malgré tout — vieille
  // route, import, serveur d'une autre version — reparer() la recolle seul.
  const seul = P.reparer(abimee);
  assert.ok(seul.reparations.length > 0,
    `le module sait réparer sans le serveur : ${seul.reparations.join(' ; ')}`);
  assert.equal(seul.carte.$stat.$game.length, 5);
  assert.equal(seul.carte.$stat.$run, 4242, 'sans rien perdre au passage');

  // Ce qui n'était PAS abîmé doit avoir survécu tel quel : réparer n'est pas
  // remettre à zéro.
  assert.equal(p.carte.$stat.$run, 4242, '$run intact');
  assert.equal(p.carte.$stat.$forestMax, 41, 'le record intact');
  assert.equal(p.carte.$bag, 2, 'le sac intact');
  assert.equal(p.carte.$key, 3, 'le trousseau intact');
  assert.equal(p.carte.$checkpoint, 2, 'et les relais acquis');
  assert.deepEqual(p.departs(), [0, 20, 40], 'donc trois départs possibles');

  // Une course par-dessus : les ramassages à l'instant (Base.grab), puis le
  // solde — ce qui part au serveur est la fiche RÉPARÉE.
  P.ramasser(p.carte, 82);
  P.ramasser(p.carte, 70);
  const r = await p.enregistrer({ niveaux: [41], dernier: 42, objets: [82, 70], entree: true });
  assert.equal(r.enregistre, true, 'la sauvegarde passe — elle n\'est plus corrompue');

  const relu = await new P.Plateforme(sid).charger();
  assert.equal(relu.$stat.$run, 4242 + 42 * 42, 'la course s\'ajoute au record conservé');
  assert.equal(relu.$stat.$forestMax, 43);
  assert.equal(relu.$stat.$game.length, 5, 'et le dégât ne revient pas');
  assert.equal(relu.$stat.$item[70], true, 'l\'objet ramassé est à l\'album');

  const liste = await pictos(BLESSE);
  assert.ok(liste.includes('$pixiz_item70'),
    `le picto sort d'une fiche réparée (reçus : ${liste.join(', ') || 'aucun'})`);

  t.diagnostic(`serveur : ${p.reparations.length ? p.reparations.join(' ; ') : 'fiche déjà recollée à la lecture'}`
    + ` | module seul : ${seul.reparations.join(' ; ')}`);
});
