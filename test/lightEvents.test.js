// Rubrique « Événements » sur /light (mobile).
//
// Les annonces du site vivent dans user.siteLog : l'administration les diffuse
// par /api/admin/broadcast, le bureau les reçoit dans <sl> à l'ident puis en
// direct par la trame <bl>. Le mobile lit la même liste en JSON. Ces tests
// vérifient les deux choses qui comptent : que chaque type d'annonce ressort
// avec SON visuel (sinon la rubrique n'est qu'un mur de texte), et que le
// drapeau « non lu » ne s'éteint qu'à la consultation — un voyant qui s'éteint
// tout seul ne sert à rien.
//
// Le second bloc vérifie l'extracteur d'images : c'est lui qui a produit les
// visuels, et il embarque un encodeur PNG et le rattrapage du « double JPEG »
// de Flash. Deux morceaux qu'on ne veut pas voir régresser en silence.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { spawn, execFileSync } = require('node:child_process');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3439;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-admin-de-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-6);

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: CLE,
      REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5154', FRUTISCORE_PORT: '5155',
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

// Un compte comme en produit un vrai passage sur /light : inscription, session,
// PUIS ident sur la socket. C'est l'ident qui pose l'annonce de bienvenue dans
// le journal du site — s'en tenir aux appels HTTP donnerait un compte à moitié
// né, et les tests parleraient d'autre chose que de ce que voit un joueur.
async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const accuse = new Promise((res) => ws.on('message', (d) => {
    if (d.toString('utf8').includes('<k')) res();
  }));
  ws.send(`<k l="${pseudo}" s="${j.sid}" lc="1" />\0`);
  await Promise.race([accuse, wait(3000)]);
  await wait(150);
  try { ws.close(); } catch {}
  return j.sid;
}
const getJson = async (url) => (await fetch(BASE + url)).json();
const diffuser = (message, type) => fetch(BASE + '/api/admin/broadcast', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
  body: JSON.stringify({ message, type }),
}).then((r) => r.json());

test('chaque type d\'annonce ressort avec son visuel', async () => {
  const sid = await inscrire('evtvis' + RUN);

  const TYPES = [
    [1,  'evt_info',      'Information'],
    [11, 'evt_technique', 'Info technique'],
    [20, 'evt_nouveaute', 'Nouveauté'],
    [21, 'evt_jeu',       'Nouveau jeu'],
  ];
  for (const [t, , ] of TYPES) {
    const r = await diffuser(`annonce de type ${t} — ${RUN}`, t);
    assert.equal(r.ok, true, `diffusion du type ${t}`);
    await wait(60);   // les entrées sont triées par date : on les espace
  }

  const d = await getJson('/api/light/events?sid=' + sid);
  assert.equal(d.ok, true);
  for (const [t, icone, titre] of TYPES) {
    const e = d.events.find((x) => x.text.includes(`type ${t} — ${RUN}`));
    assert.ok(e, `l'annonce de type ${t} est là`);
    assert.equal(e.kind, icone, `type ${t} → ${icone}`);
    assert.equal(e.kindLabel, titre, `type ${t} → « ${titre} »`);
  }

  // Un compte neuf porte déjà l'annonce de bienvenue (type 40), qui a elle
  // aussi son visuel — sans quoi la toute première chose que voit un joueur
  // serait une case vide.
  const bienvenue = d.events.find((e) => e.type === 40);
  assert.ok(bienvenue, 'l\'annonce de bienvenue est présente');
  assert.equal(bienvenue.kind, 'evt_inscription', 'elle porte le visuel d\'inscription');

  // Un type inconnu ne doit jamais laisser un trou.
  const r = await fetch(BASE + '/api/admin/broadcast', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ message: 'type farfelu ' + RUN, type: 999 }),
  });
  assert.equal((await r.json()).ok, true);
  const d2 = await getJson('/api/light/events?sid=' + sid);
  const farfelu = d2.events.find((e) => e.text.includes('type farfelu'));
  assert.equal(farfelu.kind, 'evt_info', 'un type inconnu retombe sur l\'information générale');

  // La plus récente en tête : c'est l'ordre attendu d'un fil d'annonces.
  const dates = d2.events.map((e) => e.date);
  assert.deepEqual(dates.slice().sort().reverse(), dates, 'tri décroissant par date');
});

// Les tracés d'un SVG, couleurs mises de côté : deux icônes qui ne diffèrent que
// par leur teinte donnent ici le même résultat.
function traces(svg) {
  return (svg.match(/ d="[^"]+"/g) || []).join('|');
}

test('les visuels annoncés existent réellement', () => {
  const dir = path.join(ROOT, 'public/fb');
  for (const f of ['evt_info', 'evt_technique', 'evt_nouveaute', 'evt_jeu', 'evt_inscription']) {
    const p = path.join(dir, f + '.svg');
    assert.ok(fs.existsSync(p), `${f}.svg présent`);
    const svg = fs.readFileSync(p, 'utf8');
    // Chaque visuel est un JPEG d'origine masqué par son canal alpha : les deux
    // moitiés doivent être là, sinon l'image sort opaque ou vide.
    assert.match(svg, /data:image\/jpeg;base64,/, `${f} embarque son image`);
    assert.match(svg, /mask="url\(#a\)"/, `${f} applique son masque alpha`);
    assert.match(svg, /viewBox="0 0 \d+ \d+"/, `${f} a des dimensions`);
  }
  // Le voyant. Il ne suffit pas qu'il soit d'une autre couleur : le SWF a un
  // VRAI triangle d'alerte (bande d'icônes de butPushSmallPink, celle d'où vient
  // aussi l'enveloppe de courrier), et c'est lui qu'on veut — un simple
  // repeignage du triangle au repos donnerait le même dessin en rouge.
  const repos = fs.readFileSync(path.join(dir, 'Warning.svg'), 'utf8');
  const alerte = fs.readFileSync(path.join(dir, 'WarningAlerte.svg'), 'utf8');
  assert.match(alerte, /#2C4A0F/, 'le triangle allumé porte le vert presque noir');
  assert.notEqual(traces(alerte), traces(repos),
    'et c\'est un autre TRACÉ, pas la même forme repeinte');
});

test('les deux flèches du pageur sont celles du jeu', () => {
  const dir = path.join(ROOT, 'public/fb');
  const g = fs.readFileSync(path.join(dir, 'fleche_gauche.svg'), 'utf8');
  const d = fs.readFileSync(path.join(dir, 'fleche_droite.svg'), 'utf8');
  // Chacune est le carré rose du SWF (#f28687 / #ffaaad) plus son triangle.
  for (const [nom, svg] of [['gauche', g], ['droite', d]]) {
    assert.match(svg, /#f28687/, `${nom} : le carré du bouton`);
    assert.match(svg, /#ffeaec/, `${nom} : le triangle`);
  }
  // La gauche est le miroir de la droite : même tracé, une symétrie en plus.
  assert.match(g, /scale\(-1,1\)/, 'la flèche gauche est le miroir de la droite');
  assert.equal(traces(g), traces(d), 'et donc exactement le même dessin');
  // L'icône de la barre de titre : celle du bureau (iconWindow, frame « default »).
  const ico = fs.readFileSync(path.join(dir, 'icone_fenetre.svg'), 'utf8');
  assert.match(ico, /#ff9900|#e98001/, 'l\'icône de fenêtre garde son orange');
});

test('le voyant ne s\'éteint qu\'à la consultation', async () => {
  const sid = await inscrire('evtvoy' + RUN);

  // Compte neuf : la bienvenue compte déjà comme non lue.
  const depart = await getJson('/api/light/events?sid=' + sid);
  assert.ok(depart.unread >= 1, 'l\'annonce de bienvenue est signalée');

  await diffuser('annonce à voir ' + RUN, 20);
  await wait(300);

  // Lister ne vaut PAS consulter : le compteur doit tenir tant que le joueur
  // n'a pas ouvert la rubrique, sinon le voyant s'éteindrait en arrière-plan.
  const avant = await getJson('/api/light/events?sid=' + sid);
  const n = avant.unread;
  assert.ok(n >= 2, 'les deux annonces sont non lues');
  const encore = await getJson('/api/light/events?sid=' + sid);
  assert.equal(encore.unread, n, 'relire la liste ne consomme pas le compteur');
  assert.ok(encore.events.some((e) => e.nouveau), 'les entrées neuves sont marquées');

  // Consulter éteint, et ça tient.
  const lu = await (await fetch(BASE + '/api/light/events/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid }),
  })).json();
  assert.equal(lu.ok, true);
  const apres = await getJson('/api/light/events?sid=' + sid);
  assert.equal(apres.unread, 0, 'le voyant est éteint');
  assert.ok(!apres.events.some((e) => e.nouveau), 'plus aucune entrée marquée');
  assert.equal(apres.events.length, avant.events.length, 'aucune annonce n\'a disparu');

  // Une annonce fraîche le rallume.
  await diffuser('nouvelle annonce ' + RUN, 21);
  await wait(300);
  const rallume = await getJson('/api/light/events?sid=' + sid);
  assert.equal(rallume.unread, 1, 'une annonce fraîche rallume le voyant');
  assert.equal(rallume.events[0].nouveau, true, 'et c\'est bien la nouvelle');
});

test('le voyant des événements est juste dès le premier écran', async () => {
  const sid = await inscrire('evtprof' + RUN);
  const p = await getJson('/api/light/profile?sid=' + sid);
  assert.ok(typeof p.eventsUnread === 'number', 'le profil porte le compteur');
  assert.ok(p.eventsUnread >= 1, 'la bienvenue y est comptée');
  await fetch(BASE + '/api/light/events/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid }),
  });
  const p2 = await getJson('/api/light/profile?sid=' + sid);
  assert.equal(p2.eventsUnread, 0, 'et il suit la consultation');
});

test('une annonce diffusée arrive en direct par <bl>', async () => {
  const pseudo = 'evtdirect' + RUN;
  const sid = await inscrire(pseudo);

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
  await wait(600);

  try {
    await diffuser('annonce en direct ' + RUN, 11);
    let bl = null;
    for (let i = 0; i < 60 && !bl; i++) {
      bl = trames.find((t) => t.startsWith('<bl'));
      if (!bl) await wait(50);
    }
    assert.ok(bl, `trame <bl> reçue (trames : ${trames.join(' ').slice(0, 300)})`);
    assert.match(bl, /type="11"/, 'elle porte le type de l\'annonce');
    assert.match(bl, new RegExp('annonce en direct ' + RUN), 'et son texte');
  } finally { try { ws.close(); } catch {} }
});

test('les événements exigent une session', async () => {
  assert.equal((await fetch(BASE + '/api/light/events?sid=bidon')).status, 401);
  const r = await fetch(BASE + '/api/light/events/read', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: 'bidon' }),
  });
  assert.equal(r.status, 401, 'la consultation aussi');
});

test('le client mobile affiche, signale et date les événements', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  assert.match(html, /name: "Événements", go: "evenements"/, 'le raccourci est branché');
  // Le panneau est piloté par activateTab — depuis l'Historique Kikooz, c'est
  // la table JOURNAUX qui décide (elle en sert trois), plus une liste de noms.
  assert.match(html, /\$\("#evt-panel"\)\.classList\.toggle\("active", !!JOURNAUX\[tab\]\);/,
    'le panneau est piloté par activateTab');
  assert.match(html, /evenements: \{\n\s+titre: "Événements", route: "events"/,
    'et « evenements » est bien une de ses clés');
  assert.match(html, /id="evt-liste"/, 'la liste existe');
  assert.match(html, /function renderJournal/, 'le rendu existe');

  // La rubrique reprend la fenêtre du bureau : cadre lilas, barre de titre avec
  // l'icône de fenêtre du SWF, et le pageur en bas. Pas de croix ni de bouton de
  // réduction — sur un téléphone, la rubrique EST l'écran.
  assert.match(html, /class="fen-titre"[\s\S]{0,160}icone_fenetre\.svg/, 'barre de titre à l\'icône du jeu');
  // Pas de cadre : la fenêtre du bureau ne porte qu'une ombre portée.
  const styleFen = /\.fenetre \{([\s\S]*?)\}/.exec(html);
  assert.ok(styleFen, 'la fenêtre a son style');
  assert.ok(!/border:/.test(styleFen[1]), 'aucun cadre');
  assert.match(styleFen[1], /box-shadow: [^;]*rgba\(0, ?0, ?0/, 'seulement une ombre noire');
  assert.match(html, /id="evt-prec"[\s\S]{0,120}fleche_gauche\.svg/, 'flèche précédente');
  assert.match(html, /id="evt-suiv"[\s\S]{0,120}fleche_droite\.svg/, 'flèche suivante');
  const barre = /<div class="fen-titre">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(barre, 'la barre de titre existe');
  assert.ok(!/<button/.test(barre[1]),
    'aucun bouton dedans : ni croix ni réduction, il n\'y a rien à fermer sur un téléphone');

  // Le pageur ne compte pas les entrées, il MESURE : les cartes ont des hauteurs
  // très inégales, un nombre figé laisserait tantôt un grand vide, tantôt une
  // barre de défilement — et paginer n'aurait plus de sens.
  // (La recherche portait sur TOUT light.html ; elle vise le journal, et le
  // tableau des scores a depuis sa propre pagination — celle-là à pas fixe,
  // parce que `box.Score` l'écrit ainsi : `nbResult = 10`, 0xc1132. On ne
  // relit donc que le code du journal.)
  const journal = /function renderJournal\([\s\S]*?\n  \}/.exec(html);
  assert.ok(journal, 'le rendu du journal doit exister');
  assert.ok(!/PAR_PAGE/.test(journal[0]), 'aucun nombre d\'entrées figé');
  assert.match(html, /var dispo = box\.clientHeight - \(parseFloat\(cs\.paddingTop\)/,
    'la place disponible est mesurée, rembourrage déduit');
  assert.match(html, /if \(hauteur && hauteur \+ h > dispo\) \{ bornes\.push\(i\); hauteur = 0; \}/,
    'on remplit tant que la carte suivante tient');
  assert.match(html, /window\.addEventListener\("resize"/,
    'et on redécoupe quand la fenêtre change de hauteur');
  assert.match(html, /prec\.disabled = page <= 0/, 'la flèche gauche s\'éteint sur la première page');
  assert.match(html, /suiv\.disabled = page >= pages - 1/, 'la droite sur la dernière');

  // La date au format du jeu : « sam 1 aout 21:35 ». Les tables viennent du SWF,
  // où quatre mois n'ont pas d'abrégé — « aout » s'y écrit sans circonflexe.
  assert.match(html, /var JOURS_COURTS = \["dim", "lun", "mar", "mer", "jeu", "ven", "sam"\]/,
    'jours abrégés du SWF');
  assert.match(html, /"juil", "aout", "sept"/, 'mois abrégés du SWF, « aout » compris');

  // Le visuel vient du SERVEUR (e.kind) : c'est ce qui empêche les deux bouts de
  // diverger sur la correspondance type → image.
  assert.match(html, /var src = "\/fb\/" \+ \(e\.kind \|\| def\.repli\) \+ "\." \+ \(e\.kindExt \|\| "svg"\);/,
    'le visuel est celui annoncé par le serveur');
  assert.match(html, /'<div class="vis"><img src="' \+ xmlEscape\(src\)/,
    'et il passe par l’échappement avant d’entrer dans le HTML');
  assert.match(html, /repli: "evt_info"/, 'un visuel de repli couvre les types inconnus');
  assert.match(html, /def\.repli \+ '\.svg/, 'et il sert aussi quand le fichier manque');

  // La trame poussée en direct.
  assert.match(html, /case "bl": \{/, 'la trame <bl> est traitée');
  assert.match(html, /setJournalNonLus\("evenements", journalEtat\.evenements\.nonLus \+ 1\)/,
    'elle incrémente le voyant');
  assert.match(html, /rafraichirCompteursJournaux\(\)/, 'les compteurs sont redemandés à l\'ident');

  // Un seul mécanisme de voyant pour les deux rubriques : deux copies auraient
  // fini par diverger.
  assert.match(html, /function majVoyant\(fichier, n\)/, 'le voyant est générique');
  assert.match(html, /majVoyant\("Mail"/, 'la messagerie s\'en sert');
  assert.match(html, /majVoyant\(JOURNAUX\[cle\]\.raccourci/, 'les journaux aussi');
});

// ── L'extracteur d'images ──
test('extract-swf-bitmaps produit des visuels valides', () => {
  const swf = path.join(ROOT, 'legacy/main.swf');
  if (!fs.existsSync(swf)) return;   // dépôt sans les assets d'origine

  const script = path.join(ROOT, 'scripts/extract-swf-bitmaps.js');
  const liste = execFileSync(process.execPath, [script, swf], { encoding: 'utf8' });
  assert.match(liste, /#568\ttag35\t51x48/, 'le visuel « information » est repéré avec sa taille');
  assert.match(liste, /#88\ttag36\t17x17\tpng/, 'les images sans perte sortent en PNG');

  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'swfbmp-'));
  try {
    execFileSync(process.execPath, [script, swf, tmp, '568', '88'], { encoding: 'utf8' });

    // ── Le JPEG + masque ──
    const svg = fs.readFileSync(path.join(tmp, 'bitmap568.svg'), 'utf8');
    assert.match(svg, /viewBox="0 0 51 48"/, 'dimensions lues dans le marqueur SOF');
    const jpeg = Buffer.from(/data:image\/jpeg;base64,([^"]+)/.exec(svg)[1], 'base64');
    // Flash écrit un « double JPEG » (tables, EOI, SOI, image). Un décodeur qui
    // s'arrête au premier EOI ne voit rien : l'extracteur doit avoir recollé.
    assert.equal(jpeg.indexOf(Buffer.from([0xff, 0xd9, 0xff, 0xd8])), -1,
      'la paire EOI/SOI parasite est retirée');
    assert.equal(jpeg.readUInt16BE(0), 0xffd8, 'commence par un SOI');
    assert.equal(jpeg.readUInt16BE(jpeg.length - 2), 0xffd9, 'et finit par un EOI');

    // Le masque : un PNG en niveaux de gris aux mêmes dimensions.
    const masque = Buffer.from(/mask[\s\S]*?data:image\/png;base64,([^"]+)/.exec(svg)[1], 'base64');
    assert.equal(masque.slice(1, 4).toString('ascii'), 'PNG', 'le masque est un PNG');
    assert.equal(masque.readUInt32BE(16), 51, 'largeur du masque');
    assert.equal(masque.readUInt32BE(20), 48, 'hauteur du masque');
    assert.equal(masque[24], 8, '8 bits par canal');
    assert.equal(masque[25], 0, 'niveaux de gris');
    // Un masque tout blanc ou tout noir signalerait un alpha mal décodé.
    const brut = zlib.inflateSync(lireIdat(masque));
    let mini = 255, maxi = 0;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 51; x++) {
      const v = brut[y * 52 + 1 + x];
      if (v < mini) mini = v;
      if (v > maxi) maxi = v;
    }
    assert.equal(mini, 0, 'le masque a des zones transparentes');
    assert.equal(maxi, 255, 'et des zones opaques');

    // ── Le PNG sans perte ──
    const png = fs.readFileSync(path.join(tmp, 'bitmap88.png'));
    assert.equal(png.slice(1, 4).toString('ascii'), 'PNG', 'signature PNG');
    assert.equal(png.readUInt32BE(16), 17, 'largeur');
    assert.equal(png.readUInt32BE(20), 17, 'hauteur');
    assert.equal(png[25], 6, 'RGBA');
    // Le CRC de chaque bloc doit être bon, sinon le navigateur refusera l'image.
    verifierCrc(png);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// Concatène les blocs IDAT d'un PNG.
function lireIdat(png) {
  const bouts = [];
  let o = 8;
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.slice(o + 4, o + 8).toString('ascii');
    if (type === 'IDAT') bouts.push(png.slice(o + 8, o + 8 + len));
    if (type === 'IEND') break;
    o += 12 + len;
  }
  return Buffer.concat(bouts);
}
function verifierCrc(png) {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  const crc = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  let o = 8, n = 0;
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.slice(o + 4, o + 8).toString('ascii');
    assert.equal(crc(png.slice(o + 4, o + 8 + len)), png.readUInt32BE(o + 8 + len), `CRC du bloc ${type}`);
    n++;
    if (type === 'IEND') break;
    o += 12 + len;
  }
  assert.ok(n >= 3, 'IHDR + IDAT + IEND au minimum');
}
