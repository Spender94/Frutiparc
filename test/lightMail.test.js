// Messagerie interne sur /light (mobile).
//
// Le point qui compte : il n'y a qu'UNE boîte. Le serveur tient une seule liste
// user.mails ; main.swf la lit en XML (/ff/ls, /ff/get, /fm/sendmail), le mobile
// en JSON (/api/light/mail…). Ces tests attaquent les deux façades sur le même
// compte et vérifient qu'elles voient la même chose — un courrier envoyé du
// téléphone doit arriver dans la boîte du bureau, et un courrier lu d'un côté
// doit être lu de l'autre. Sans quoi on aurait deux messageries parallèles, ce
// qui serait pire que pas de messagerie du tout.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3438;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// data/scores.json survit d'une exécution à l'autre : sans suffixe, les comptes
// de la veille fausseraient les comptages de courriers.
const RUN = String(Date.now()).slice(-6);

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5152', FRUTISCORE_PORT: '5153',
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

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, `session ouverte pour ${pseudo}`);
  return j.sid;
}
const getJson = async (url) => (await fetch(BASE + url)).json();
const postJson = async (url, corps) => (await fetch(BASE + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
})).json();

test('un courrier envoyé du mobile arrive chez le destinataire', async () => {
  const a = await inscrire('mlexp' + RUN);
  const b = await inscrire('mldest' + RUN);

  const envoi = await postJson('/api/light/mail/send', {
    sid: a, to: 'mldest' + RUN, subject: 'Bonjour', body: 'Premier courrier du téléphone.',
  });
  assert.equal(envoi.ok, true, 'envoi accepté');
  assert.deepEqual(envoi.livres, ['mldest' + RUN], 'le destinataire résolu est le bon');

  const boite = await getJson('/api/light/mail?sid=' + b);
  assert.equal(boite.ok, true);
  assert.equal(boite.mails.length, 1, 'un courrier reçu');
  assert.equal(boite.mails[0].subject, 'Bonjour');
  assert.equal(boite.mails[0].from.toLowerCase(), 'mlexp' + RUN, 'l\'expéditeur est nommé');
  assert.equal(boite.mails[0].read, false, 'non lu à l\'arrivée');
  assert.equal(boite.unread, 1, 'le compteur du voyant vaut 1');

  // Le corps n'est PAS dans la liste (une boîte chargée tiendrait sinon dans la
  // réponse) : on va le chercher à l'ouverture.
  assert.equal(boite.mails[0].body, undefined, 'la liste reste légère');
  const lu = await getJson('/api/light/mail/read?sid=' + b + '&uid=' + boite.mails[0].uid);
  assert.equal(lu.mail.body, 'Premier courrier du téléphone.', 'le corps arrive à la lecture');
  assert.equal(lu.unread, 0, 'ouvrir vaut lire : le voyant s\'éteint');

  // Copie dans les envoyés de l'expéditeur.
  const envoyes = await getJson('/api/light/mail?sid=' + a + '&folder=outbox');
  assert.equal(envoyes.mails.length, 1, 'copie gardée dans les envoyés');
  assert.equal(envoyes.mails[0].to.toLowerCase(), 'mldest' + RUN);
});

test('un destinataire inconnu est refusé, pas avalé en silence', async () => {
  const a = await inscrire('mlseul' + RUN);

  const r = await postJson('/api/light/mail/send', { sid: a, to: 'nexistepasdutout', body: 'oh ?' });
  assert.equal(r.ok, false, 'refusé');
  assert.match(r.error, /n'existe pas/, 'le pseudo fautif est nommé');

  // Rien ne doit traîner dans les envoyés : le courrier n'est jamais parti.
  const envoyes = await getJson('/api/light/mail?sid=' + a + '&folder=outbox');
  assert.equal(envoyes.mails.length, 0, 'aucune copie fantôme');

  // Message vide : même exigence.
  const vide = await postJson('/api/light/mail/send', { sid: a, to: 'mlseul' + RUN, body: '   ' });
  assert.equal(vide.ok, false, 'un message vide est refusé');
});

test('la boîte du mobile et celle du bureau sont la MÊME', async () => {
  const a = await inscrire('mlpont' + RUN);
  const b = await inscrire('mlpontb' + RUN);

  // Envoi par la route du bureau (LoadVars, params t/s/c) …
  await fetch(BASE + '/fm/sendmail', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sid: a, t: 'mlpontb' + RUN, s: 'Depuis le bureau', c: 'Coucou.', o: '1' }),
  });
  // … lecture par la route du mobile.
  const boite = await getJson('/api/light/mail?sid=' + b);
  assert.equal(boite.mails.length, 1, 'le mobile voit le courrier du bureau');
  assert.equal(boite.mails[0].subject, 'Depuis le bureau');
  const uid = boite.mails[0].uid;

  // Envoi par le mobile …
  await postJson('/api/light/mail/send', { sid: b, to: 'mlpont' + RUN, subject: 'Depuis le mobile', body: 'Bien reçu.' });
  // … lecture par la route XML du bureau.
  const xml = await (await fetch(BASE + '/ff/ls?uid=inbox&sid=' + a)).text();
  assert.match(xml, /Depuis le mobile/, 'le bureau voit le courrier du mobile');

  // Lu sur mobile ⇒ lu sur le bureau (l'attribut a="1" du nœud <e>).
  await getJson('/api/light/mail/read?sid=' + b + '&uid=' + uid);
  const xmlB = await (await fetch(BASE + '/ff/ls?uid=inbox&sid=' + b)).text();
  assert.match(xmlB, new RegExp(`u="${uid}"[^>]*a="1"`), 'l\'état « lu » est partagé');
});

test('supprimer envoie à la corbeille, puis efface', async () => {
  const a = await inscrire('mlpoub' + RUN);
  const b = await inscrire('mlpoubb' + RUN);
  await postJson('/api/light/mail/send', { sid: a, to: 'mlpoubb' + RUN, subject: 'À jeter', body: 'rien' });

  const boite = await getJson('/api/light/mail?sid=' + b);
  const uid = boite.mails[0].uid;

  const un = await postJson('/api/light/mail/delete', { sid: b, uid });
  assert.equal(un.ok, true);
  assert.equal(un.unread, 0, 'un courrier jeté ne compte plus comme non lu');
  const apres = await getJson('/api/light/mail?sid=' + b);
  assert.equal(apres.mails.length, 0, 'il a quitté la boîte de réception');
  // Il est en corbeille, donc encore rattrapable depuis le bureau.
  const corbeille = await (await fetch(BASE + '/ff/ls?uid=recyclebin&sid=' + b)).text();
  assert.match(corbeille, new RegExp(`u="${uid}"`), 'récupérable en corbeille');

  // Deuxième suppression : définitive.
  const deux = await postJson('/api/light/mail/delete', { sid: b, uid });
  assert.equal(deux.ok, true);
  const vide = await (await fetch(BASE + '/ff/ls?uid=recyclebin&sid=' + b)).text();
  assert.ok(!vide.includes(uid), 'la seconde suppression efface pour de bon');
});

test('le destinataire connecté est prévenu en direct par <ax>', async () => {
  const a = await inscrire('mlnotif' + RUN);
  const b = await inscrire('mlnotifb' + RUN);

  // Le destinataire est en ligne, comme le serait un joueur sur /light.
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
  ws.send(`<k l="mlnotifb${RUN}" s="${b}" lc="1" />\0`);
  await wait(600);

  try {
    await postJson('/api/light/mail/send', {
      sid: a, to: 'mlnotifb' + RUN, subject: 'Tu as du courrier', body: 'hop',
    });
    let ax = null;
    for (let i = 0; i < 60 && !ax; i++) {
      ax = trames.find((t) => t.startsWith('<ax'));
      if (!ax) await wait(50);
    }
    assert.ok(ax, `trame <ax> reçue (trames : ${trames.join(' ').slice(0, 300)})`);
    assert.match(ax, /from="mlnotif/, 'elle nomme l\'expéditeur');
    assert.match(ax, /subject="Tu as du courrier"/, 'et porte le sujet');
  } finally { try { ws.close(); } catch {} }
});

test('le voyant de la messagerie est juste dès le premier écran', async () => {
  const a = await inscrire('mlvoy' + RUN);
  const b = await inscrire('mlvoyb' + RUN);

  const avant = await getJson('/api/light/profile?sid=' + b);
  assert.equal(avant.mailUnread, 0, 'boîte vide : voyant éteint');

  await postJson('/api/light/mail/send', { sid: a, to: 'mlvoyb' + RUN, subject: 'un', body: 'x' });
  await postJson('/api/light/mail/send', { sid: a, to: 'mlvoyb' + RUN, subject: 'deux', body: 'y' });

  // Le profil est la PREMIÈRE requête du client mobile : s'il ne portait pas le
  // compteur, le voyant resterait éteint jusqu'à l'ouverture de la messagerie —
  // exactement le moment où il ne sert plus à rien.
  const apres = await getJson('/api/light/profile?sid=' + b);
  assert.equal(apres.mailUnread, 2, 'le profil porte le nombre de non-lus');
});

test('la messagerie exige une session', async () => {
  for (const url of ['/api/light/mail?sid=bidon', '/api/light/mail/read?sid=bidon&uid=m0000000000']) {
    const r = await fetch(BASE + url);
    assert.equal(r.status, 401, url + ' rejette une session inconnue');
  }
  const envoi = await fetch(BASE + '/api/light/mail/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: 'bidon', to: 'x', body: 'y' }),
  });
  assert.equal(envoi.status, 401, 'l\'envoi aussi');
});

test('le client mobile sait lister, lire, écrire et signaler', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

  // Le raccourci « Messagerie » de l'accueil ouvre bien la rubrique.
  assert.match(html, /file: "Mail",\s+name: "Messagerie", go: "mail"/,
    'le raccourci de l\'encart niveau est branché');
  assert.match(html, /tab === "mail"/, 'le panneau est piloté par activateTab');

  // Les trois vues.
  assert.match(html, /id="mail-vue-liste"/, 'vue liste');
  assert.match(html, /id="mail-vue-lecture"/, 'vue lecture');
  assert.match(html, /id="mail-vue-ecriture"/, 'vue rédaction');

  // Le voyant : icône de remplacement + compteur, par le mécanisme partagé avec
  // les événements (cf. test/lightEvents.test.js).
  assert.match(html, /majVoyant\("Mail", mailNonLus\)/, 'le voyant est mis à jour');
  assert.match(html, /voyant: "MailRecu"/, 'l\'icône d\'alerte est déclarée');
  assert.match(html, /sc-compte/, 'un compteur s\'accroche au raccourci');

  // La trame poussée par le serveur est traitée : sans ça, il faudrait ouvrir la
  // messagerie pour découvrir qu'on a du courrier.
  assert.match(html, /case "ax": \{/, 'la trame <ax> est traitée');
  assert.match(html, /setMailNonLus\(mailNonLus \+ 1\)/, 'elle incrémente le voyant');

  // Reconnexion : aucune trame <ax> n'a été poussée pendant la coupure.
  assert.match(html, /rafraichirCompteurMail\(\)/, 'le compteur est redemandé à l\'ident');

  // Repli quand l'interlocuteur est hors ligne (ce que fait le bureau).
  assert.match(html, /Lui écrire un courrier/, 'un joueur hors ligne peut être contacté par courrier');
});

test('l\'icône d\'alerte est bien celle du jeu, distincte de l\'enveloppe au repos', () => {
  const dir = path.join(ROOT, 'public/fb');
  const repos = fs.readFileSync(path.join(dir, 'Mail.svg'), 'utf8');
  const alerte = fs.readFileSync(path.join(dir, 'MailRecu.svg'), 'utf8');
  assert.match(alerte, /<svg/, 'MailRecu.svg est un SVG');
  // Vert foncé du jeu (celui des chiffres du classement) sur vert clair au repos :
  // c'est ce contraste qui rend le voyant lisible à 27 px. Le dessin change aussi
  // — l'enveloppe allumée est celle de la bande d'alerte du SWF, pas la même
  // repeinte — mais la couleur seule doit déjà se voir.
  assert.match(alerte, /#73b01e/, 'l\'enveloppe allumée est en vert foncé');
  assert.match(repos, /#a2eb56/, 'celle du repos reste en vert clair');
  assert.notEqual(alerte.replace(/\s/g, ''), repos.replace(/\s/g, ''),
    'les deux états doivent différer, sinon le voyant ne signale rien');
  // Et surtout : PAS le tracé d'une autre icône de la bande (le joystick de
  // « Jeux » y ressemblait par la taille — s'en servir aurait fait un voyant
  // qui ne veut rien dire).
  const jeux = fs.readFileSync(path.join(dir, 'Jeux.svg'), 'utf8');
  const trace = /d="([^"]+)"/.exec(alerte)[1];
  assert.ok(!jeux.includes(trace.slice(0, 40)), 'ce n\'est pas l\'icône Jeux');
});
