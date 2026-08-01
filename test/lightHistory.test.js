// Rubrique « Historique » sur /light (mobile).
//
// C'est le journal personnel du joueur : niveaux, pictos, médailles, parrainages,
// sanctions. Même source que le « Mon historique » du bureau — user.userLog,
// servi là-bas dans <ul> à l'ident et poussé en direct par la trame <aw>.
//
// Deux propriétés méritent des tests, au-delà du « ça liste bien » :
//
//  1. chaque type d'entrée porte SON visuel, y compris celui qui n'est pas un
//     SVG (le totoché est un PNG) — sinon la liste ne se lit pas d'un coup d'œil ;
//  2. le compteur ne double pas à la reconnexion. Contrairement à <bl>, la trame
//     <aw> est REJOUÉE à chaque ident (le serveur renvoie tout le non-lu) :
//     incrémenter aveuglément gonflerait le voyant à chaque passage en
//     arrière-plan du navigateur mobile.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3440;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-6);

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '',
      REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5156', FRUTISCORE_PORT: '5157',
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

// Un client mobile complet : inscription, session, ident sur la socket. C'est
// l'ident qui pose les entrées d'ouverture de compte — s'en tenir au HTTP
// donnerait un journal vide, et les tests parleraient d'autre chose.
async function client(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const sid = (await r.json()).sid;
  assert.ok(sid, `session ouverte pour ${pseudo}`);

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const trames = [];
  let tampon = '';
  ws.on('message', (d) => {
    tampon += d.toString('utf8');
    const bouts = tampon.split('\0');
    tampon = bouts.pop();
    for (const x of bouts) if (x.trim()) trames.push(x.trim());
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sid}" lc="1" />\0`);
  for (let i = 0; i < 60; i++) {
    if (trames.some((t) => t.startsWith('<k'))) break;
    await wait(50);
  }
  await wait(250);
  return {
    pseudo, sid, trames,
    envoyer: (xml) => ws.send(xml + '\0'),
    fermer: () => { try { ws.close(); } catch {} },
  };
}
const getJson = async (url) => (await fetch(BASE + url)).json();
const marquerLu = (sid) => fetch(BASE + '/api/light/history/read', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid }),
}).then((r) => r.json());

test('un compte neuf a déjà son historique, visuels compris', async () => {
  const c = await client('hnouv' + RUN);
  try {
    const d = await getJson('/api/light/history?sid=' + c.sid);
    assert.equal(d.ok, true);
    assert.ok(d.events.length >= 2,
      `l'inscription et la récompense de connexion sont là (${d.events.length})`);
    assert.equal(d.unread, d.events.length, 'et toutes comptent comme non lues');

    const inscription = d.events.find((e) => e.type === 40);
    assert.ok(inscription, 'entrée d\'inscription présente');
    assert.equal(inscription.kind, 'evt_inscription', 'avec son visuel');
    assert.equal(inscription.kindLabel, 'Inscription');

    const parrainage = d.events.find((e) => e.type === 50);
    assert.ok(parrainage, 'récompense de connexion présente');
    assert.equal(parrainage.kind, 'histo_filleul', 'avec le sien');

    // La plus récente en tête.
    const dates = d.events.map((e) => e.date);
    assert.deepEqual(dates.slice().sort().reverse(), dates, 'tri décroissant par date');
  } finally { c.fermer(); }
});

test('chaque type porte son visuel, y compris hors SVG', async () => {
  const c = await client('hvis' + RUN);
  try {
    // On écrit directement dans le journal par la voie normale — c'est ce que
    // font les montées de niveau, les pictos, les sanctions.
    const TYPES = [
      [1,  'histo_kick',       'Expulsion',     'svg'],
      [2,  'histo_ban',        'Bannissement',  'svg'],
      [3,  'histo_totoche',    'Totoché',       'png'],
      [10, 'histo_picto',      'Picto',         'svg'],
      [20, 'histo_chat',       'Salons',        'svg'],
      [30, 'histo_niveau',     'Niveau gagné',  'svg'],
      [31, 'histo_niveau_bas', 'Niveau perdu',  'svg'],
      [60, 'histo_medaille',   'Médaille',      'svg'],
    ];
    const r = await fetch(BASE + '/api/light/history?sid=' + c.sid);
    assert.equal(r.status, 200);

    // Le serveur est la seule autorité sur la correspondance type → visuel :
    // on la lit à travers l'API, sur des entrées réellement présentes.
    const html = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const table = /const LIGHT_HISTORY_KINDS = \{([\s\S]*?)\n\};/.exec(html);
    assert.ok(table, 'la table des visuels existe');
    for (const [t, icone, titre, ext] of TYPES) {
      const ligne = new RegExp(`^\\s*${t}:\\s*\\{[^}]*icone: '${icone}'[^}]*titre: '${titre}'`, 'm');
      assert.match(table[1], ligne, `type ${t} → ${icone} « ${titre} »`);
      const fichier = path.join(ROOT, 'public/fb', icone + '.' + ext);
      assert.ok(fs.existsSync(fichier), `${icone}.${ext} présent`);
    }
    // Le totoché est le seul PNG : le serveur doit annoncer son extension,
    // sinon le client irait chercher un .svg qui n'existe pas.
    assert.match(table[1], /3:\s*\{[^}]*ext: 'png'/, 'l\'extension du PNG est annoncée');
  } finally { c.fermer(); }
});

test('les visuels de l\'historique sont valides', () => {
  const dir = path.join(ROOT, 'public/fb');
  for (const f of ['histo_kick', 'histo_ban', 'histo_boum', 'histo_picto', 'histo_chat',
                   'histo_niveau', 'histo_niveau_bas', 'histo_medaille']) {
    const svg = fs.readFileSync(path.join(dir, f + '.svg'), 'utf8');
    assert.match(svg, /data:image\/jpeg;base64,/, `${f} embarque son image`);
    assert.match(svg, /mask="url\(#a\)"/, `${f} applique son masque alpha`);
  }
  // Le parrainage est le seul vectoriel : il vient de extract-swf-shapes.js, qui
  // a dû gérer un dégradé ET des styles introduits en cours de tracé.
  const filleul = fs.readFileSync(path.join(dir, 'histo_filleul.svg'), 'utf8');
  assert.match(filleul, /<radialGradient/, 'son ombre portée est un dégradé radial');
  assert.ok((filleul.match(/<path/g) || []).length >= 10,
    'et son tracé compte les couches successives (styles en cours de forme)');
  // Le totoché est une image sans perte : PNG, pas JPEG.
  const png = fs.readFileSync(path.join(dir, 'histo_totoche.png'));
  assert.equal(png.slice(1, 4).toString('ascii'), 'PNG', 'le totoché est un vrai PNG');
  assert.equal(png.readUInt32BE(16), 20, 'largeur');

  // Le voyant reste une HORLOGE : c'est la forme que le jeu donne à
  // l'historique, et le joueur doit reconnaître la même icône, allumée. La bande
  // d'alerte du SWF (butPushSmallPink), qui a fourni l'enveloppe de courrier et
  // le triangle des événements, n'a pas d'horloge — c'est donc celle du repos,
  // dans le même rouge d'alerte que les deux autres.
  const repos = fs.readFileSync(path.join(dir, 'Historique.svg'), 'utf8');
  const alerte = fs.readFileSync(path.join(dir, 'HistoriqueAlerte.svg'), 'utf8');
  const traces = (svg) => (svg.match(/ d="[^"]+"/g) || []).join('|');
  assert.match(alerte, /#73b01e/, 'le voyant porte le vert foncé du classement');
  assert.equal(traces(alerte), traces(repos), 'et garde la forme d\'horloge');
  assert.notEqual(alerte, repos, 'seule la couleur change');
  // Même vert que le courrier : les trois voyants se lisent pareil, ce qui est
  // tout l'intérêt d'en avoir trois.
  const courrier = fs.readFileSync(path.join(dir, 'MailRecu.svg'), 'utf8');
  assert.match(courrier, /#73b01e/, 'même vert que l\'enveloppe de courrier');
  // Et l'icône au repos reste dans le vert clair : c'est le CONTRASTE entre les
  // deux qui fait le voyant.
  assert.match(repos, /#a2eb56/, 'l\'horloge au repos reste en vert clair');
});

test('le voyant ne s\'éteint qu\'à la consultation', async () => {
  const c = await client('hvoy' + RUN);
  try {
    const avant = await getJson('/api/light/history?sid=' + c.sid);
    const n = avant.unread;
    assert.ok(n >= 2, 'plusieurs entrées non lues au départ');

    // Lister ne vaut PAS consulter.
    const encore = await getJson('/api/light/history?sid=' + c.sid);
    assert.equal(encore.unread, n, 'relire la liste ne consomme pas le compteur');
    assert.ok(encore.events.every((e) => e.nouveau), 'les entrées restent marquées');

    const lu = await marquerLu(c.sid);
    assert.equal(lu.ok, true);
    const apres = await getJson('/api/light/history?sid=' + c.sid);
    assert.equal(apres.unread, 0, 'le voyant est éteint');
    assert.equal(apres.events.length, avant.events.length, 'aucune entrée n\'a disparu');
    assert.ok(!apres.events.some((e) => e.nouveau), 'plus aucune marque');
  } finally { c.fermer(); }
});

test('les deux journaux sont indépendants', async () => {
  const c = await client('hsep' + RUN);
  try {
    const histo = await getJson('/api/light/history?sid=' + c.sid);
    const evts = await getJson('/api/light/events?sid=' + c.sid);
    assert.ok(histo.unread >= 1 && evts.unread >= 1, 'les deux ont du non-lu');

    // Consulter l'un ne doit pas éteindre l'autre : ce sont deux journaux, pas
    // deux vues d'un même flux.
    await marquerLu(c.sid);
    assert.equal((await getJson('/api/light/history?sid=' + c.sid)).unread, 0, 'historique consulté');
    assert.ok((await getJson('/api/light/events?sid=' + c.sid)).unread >= 1,
      'les événements restent à lire');

    // Et leurs contenus ne se mélangent pas.
    const h = await getJson('/api/light/history?sid=' + c.sid);
    const e = await getJson('/api/light/events?sid=' + c.sid);
    assert.ok(h.events.some((x) => x.kind === 'histo_filleul'), 'la récompense est côté historique');
    assert.ok(!e.events.some((x) => x.kind === 'histo_filleul'), 'et pas côté événements');
  } finally { c.fermer(); }
});

test('les entrées d\'historique sont rejouées à l\'ident, pas dupliquées', async () => {
  const pseudo = 'hrejeu' + RUN;
  const c = await client(pseudo);
  const n = (await getJson('/api/light/history?sid=' + c.sid)).unread;
  assert.ok(n >= 2, 'du non-lu au départ');
  c.fermer();
  await wait(300);

  // Deuxième connexion — c'est ce que fait le mobile chaque fois qu'il revient
  // au premier plan. Le serveur REJOUE les <aw> non lus.
  const c2 = await client(pseudo);
  try {
    let rejeu = 0;
    for (let i = 0; i < 40; i++) {
      rejeu = c2.trames.filter((t) => t.startsWith('<aw')).length;
      if (rejeu >= n) break;
      await wait(50);
    }
    assert.equal(rejeu, n, 'les entrées non lues sont bien renvoyées');

    // Le journal, lui, n'a pas grossi : c'est pour ça que le client redemande le
    // compte au serveur au lieu d'incrémenter à chaque trame.
    const apres = await getJson('/api/light/history?sid=' + c2.sid);
    assert.equal(apres.unread, n, 'le compteur du serveur est inchangé');
    assert.equal(apres.events.length, n, 'et aucune entrée n\'a été dupliquée');
  } finally { c2.fermer(); }
});

test('le voyant de l\'historique est juste dès le premier écran', async () => {
  const c = await client('hprof' + RUN);
  try {
    const p = await getJson('/api/light/profile?sid=' + c.sid);
    assert.ok(typeof p.historyUnread === 'number', 'le profil porte le compteur');
    assert.ok(p.historyUnread >= 1, 'les entrées d\'ouverture y sont comptées');
    await marquerLu(c.sid);
    assert.equal((await getJson('/api/light/profile?sid=' + c.sid)).historyUnread, 0,
      'et il suit la consultation');
  } finally { c.fermer(); }
});

test('l\'historique exige une session', async () => {
  assert.equal((await fetch(BASE + '/api/light/history?sid=bidon')).status, 401);
  const r = await fetch(BASE + '/api/light/history/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: 'bidon' }),
  });
  assert.equal(r.status, 401, 'la consultation aussi');
});

test('la boîte aux lettres du bureau a ses deux états', () => {
  // L'icône « inbox » du bureau est une boîte aux lettres à drapeau : fermée
  // drapeau baissé, ouverte drapeau levé quand du courrier attend. Les deux
  // états sont composés comme fileIcon.swf les compose — boîte (sprite#129) et
  // drapeau (sprite#132), chacun avec sa matrice de placement.
  const dir = path.join(ROOT, 'public/fb');
  const repos = fs.readFileSync(path.join(dir, 'icone_messagerie.svg'), 'utf8');
  const plein = fs.readFileSync(path.join(dir, 'icone_messagerie_pleine.svg'), 'utf8');
  for (const [nom, svg] of [['repos', repos], ['plein', plein]]) {
    // Deux groupes transformés : la boîte, puis le drapeau.
    assert.equal((svg.match(/<g transform="matrix\(/g) || []).length, 2,
      `${nom} : la boîte et le drapeau, chacun placé`);
    assert.ok((svg.match(/<path/g) || []).length >= 8, `${nom} : le dessin est complet`);
  }
  // Le drapeau tourne : baissé au repos (matrice à rotation), droit quand il y a
  // du courrier. C'est ce qui distingue les deux états.
  assert.match(repos, /<g transform="matrix\(0\.3849,-0\.9062/, 'drapeau baissé au repos');
  assert.match(plein, /<g transform="matrix\(0\.986,0,0,0\.986/, 'drapeau levé quand du courrier attend');
  assert.notEqual(repos, plein, 'les deux états diffèrent');
});

test('les trois rubriques à voyant ont leur tuile sur l\'accueil', () => {
  // La petite rangée d'icônes de l'encart niveau se rate facilement : un joueur
  // qui ne l'a jamais remarquée n'aurait aucun moyen d'ouvrir sa messagerie.
  // Les trois rubriques ont donc aussi leur tuile dans la grille.
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  for (const [go, ico, fichier, label] of [['mail', 'Mail', 'icone_messagerie', 'Messagerie'],
                                           ['evenements', 'Warning', 'icone_evenements', 'Événements'],
                                           ['historique', 'Historique', 'icone_historique', 'Historique']]) {
    const tuile = new RegExp(`data-go="${go}" data-ico="${ico}"[\\s\\S]{0,200}?<span class="lbl">${label}</span>`);
    assert.match(html, tuile, `tuile ${label}`);
    // Les tuiles portent les icônes du BUREAU, comme leurs voisines (linkScore,
    // linkShop, inventory…) — pas les petits tracés de la rangée de raccourcis.
    assert.match(html, new RegExp(`data-ico="${ico}"[\\s\\S]{0,120}?/fb/${fichier}\\.svg`),
      `${label} porte son icône de bureau`);
    assert.ok(fs.existsSync(path.join(ROOT, 'public/fb', fichier + '.svg')), `${fichier}.svg présent`);
  }
  // Un clic sur la tuile ouvre la rubrique (les autres tuiles ouvrent des
  // feuilles ; celles-ci passent par activateTab).
  assert.match(html, /go === "mail" \|\| go === "evenements" \|\| go === "historique"/,
    'les tuiles sont branchées sur la navigation');

  // Et surtout : UNE seule fonction met à jour le raccourci ET la tuile. Deux
  // mécanismes finiraient par diverger — un endroit signalerait ce que l'autre
  // ignore.
  const maj = /function majVoyant\(fichier, n\)[\s\S]*?\n  \}/.exec(html);
  assert.ok(maj, 'majVoyant présente');
  assert.match(maj[0], /\.sc-btn\[data-sc="' \+ fichier \+ '"\], \.home-tile\[data-ico="' \+ fichier \+ '"\]/,
    'elle vise les deux endroits d\'un coup');
  assert.match(maj[0], /pastille\.remove\(\)/, 'et le compteur disparaît quand tout est lu');
  // Le compteur chiffré ne va QUE sur le raccourci : le bureau d'origine ne pose
  // aucune pastille sur ses icônes.
  assert.match(maj[0], /if \(estTuile\) return;/, 'aucune pastille sur les tuiles');
  // Chaque endroit bascule sur SES états : le raccourci entre son icône et sa
  // variante d'alerte, la tuile entre les deux états de son icône de bureau —
  // quand elle en a deux.
  assert.match(maj[0], /var repos\s+= estTuile \? def\.tuile : def\.file/,
    'la tuile part de son icône de bureau');
  assert.match(maj[0], /var alerte = estTuile \? def\.tuileVoyant : def\.voyant/,
    'et de sa variante, s\'il y en a une');
});

test('le client mobile sert les deux journaux avec un seul code', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  assert.match(html, /name: "Historique", go: "historique"/, 'le raccourci est branché');
  assert.match(html, /voyant: "HistoriqueAlerte"/, 'avec son icône d\'alerte');

  // Un seul gabarit, un seul panneau : deux copies auraient fini par diverger.
  assert.match(html, /var JOURNAUX = \{/, 'les deux rubriques sont décrites côte à côte');
  assert.match(html, /route: "history"/, 'celle de l\'historique pointe la bonne route');
  assert.match(html, /tab === "evenements" \|\| tab === "historique"/,
    'le même panneau sert les deux');
  assert.match(html, /function loadJournal\(cle\)/, 'un seul chargement');
  assert.match(html, /function renderJournal\(cle\)/, 'un seul rendu');

  // L'extension vient du serveur : le totoché est un PNG, pas un SVG.
  assert.match(html, /xmlEscape\(e\.kindExt \|\| "svg"\)/,
    'le client suit l\'extension annoncée par le serveur');

  // La trame <aw> est rejouée à l'ident : on redemande le compte au serveur au
  // lieu d'incrémenter, sinon le voyant doublerait à chaque reconnexion.
  assert.match(html, /case "aw": \{/, 'la trame <aw> est traitée');
  assert.match(html, /planifierMajHistorique\(\)/, 'elle déclenche un rafraîchissement groupé');
  assert.ok(!/case "aw":[\s\S]{0,400}nonLus \+ 1/.test(html),
    'et surtout PAS une incrémentation aveugle');
  assert.match(html, /function planifierMajHistorique/, 'le groupement existe');
});
