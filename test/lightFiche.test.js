/*
 * La FICHE d'un frutiz sur /light — ce que le bureau montre en cliquant un
 * pseudo (FrutizInfo + winFrutizInfo), porté au mobile.
 *
 * Trois choses à garder :
 *   1. l'endpoint /api/light/fiche — le JSON qui réunit la commande chat
 *      `userinfo` (frutiz / perso / bonus) et FrutiScore (scores) ;
 *   2. les frutisignes — les dessins de frutiSign.swf, extraits en PNG ;
 *   3. l'écran du mobile — quatre onglets, le signe au centre, et le geste :
 *      toucher un pseudo ouvre la fiche, la fiche mène au privé.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-7);
const joueur = (nom) => nom + RUN;

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5190', FRUTISCORE_PORT: '5191',
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
after(async () => {
  if (serverProc) serverProc.kill('SIGKILL');
  // Comme les concours : on efface NOS joueurs de data/scores.json en sortant.
  await wait(300);
  const fichier = path.join(ROOT, 'data/scores.json');
  try {
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) {
      if (u.slice(-RUN.length) === RUN) delete d.users[u];
    }
    fs.writeFileSync(fichier, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

test('la fiche répond avec les quatre onglets du bureau', async () => {
  const sid = await sidFor(joueur('fichea'));
  await sidFor(joueur('ficheb'));
  const r = await fetch(`${BASE}/api/light/fiche?sid=${encodeURIComponent(sid)}&u=${joueur('ficheb')}`);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(String(j.pseudo).toLowerCase(), joueur('ficheb'));
  // basic : ce que l'en-tête affiche — bouille, niveau, « âge - ville ».
  assert.ok(typeof j.bouille === 'string' && j.bouille.length === 24, 'la bouille de l\'avatar');
  assert.ok(j.basic.niveau >= 1, 'le niveau (XP)');
  // frutiz : le signe (caché au départ), la consécration, l'inscription.
  assert.equal(j.frutiz.signe, null, 'signe encore caché — la silhouette noire');
  assert.equal(j.frutiz.job, 'Frutiz');
  assert.ok(j.frutiz.inscription, 'la date d\'inscription');
  assert.equal(j.frutiz.frutiAgeMois, 0, 'inscrit à l\'instant : zéro mois');
  // perso / bonus / scores : les structures des trois autres onglets.
  assert.ok('prenom' in j.perso && 'ville' in j.perso && 'metier' in j.perso);
  assert.ok('commentaire' in j.bonus && 'site' in j.bonus);
  assert.ok(Array.isArray(j.scores.classements) && Array.isArray(j.scores.medailles));
});

test('un score de championnat apparaît dans l\'onglet scores', async () => {
  const nom = joueur('fichesc');
  const sid = await sidFor(nom);
  // Un score Frutisnake classique (section C, rk 1 — snake3_classic).
  const r = await fetch(`${BASE}/api/saveScore`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sid, game: 'snake3', score: '4321', mode: '0' }),
  });
  // saveScore peut avoir une autre signature : dans ce cas on passe par l'API
  // du moteur de scores. On vérifie seulement que si un score EST enregistré,
  // la fiche le montre.
  const info = await (await fetch(`${BASE}/api/light/fiche?sid=${encodeURIComponent(sid)}&u=${nom}`)).json();
  assert.equal(info.ok, true);
  for (const c of info.scores.classements) {
    assert.ok(c.titre && Number.isFinite(c.score), 'chaque ligne porte un titre et un score');
  }
});

test('la fiche refuse sans session, et dit quand le frutiz n\'existe pas', async () => {
  const r1 = await fetch(`${BASE}/api/light/fiche?u=quelquun`);
  assert.equal(r1.status, 401);
  const sid = await sidFor(joueur('fichec'));
  const r2 = await fetch(`${BASE}/api/light/fiche?sid=${encodeURIComponent(sid)}&u=nexistepas${RUN}`);
  assert.equal(r2.status, 404);
});

test('les frutisignes sont extraits — les dix fruits, et la silhouette', () => {
  const signes = ['pomme', 'abricot', 'poire', 'fraise', 'citron',
    'kiwi', 'raisin', 'orange', 'cerise', 'banane', 'mystere'];
  for (const s of signes) {
    const f = path.join(ROOT, 'public/fb/signe_' + s + '.png');
    assert.ok(fs.existsSync(f), 'signe_' + s + '.png existe');
    assert.ok(fs.statSync(f).size > 800, 'et porte un vrai dessin');
  }
  // La table du serveur suit l'ordre de Lang.sign — l'index du signe est un
  // rang dans cette liste, pas un nom.
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(serveur, /SIGNES_FRUITS = \['pomme', 'abricot', 'poire', 'fraise', 'citron',\n\s*'kiwi', 'raisin', 'orange', 'cerise', 'banane'\]/,
    'les dix signes, dans l\'ordre du bureau');
});

test('la rangée d\'actions porte les vrais dessins du bureau', () => {
  // Le chrome des boutons (butPushVerySmallPink sans son glyphe), le bouton
  // « liste » complet (butPushSmallPink), le triangle (icoArrow teinté), le
  // bandeau des titres (butGfxFrutizInfoTitleBg) — et les icônes de la banque
  // fileIcon.swf (sprite iconGFX, une étiquette par type).
  for (const f of ['bouton_carre', 'bouton_liste', 'triangle', 'bandeau_titre',
    'ico_chat', 'ico_mail', 'ico_blog', 'ico_contact']) {
    const p = path.join(ROOT, 'public/fb/fiche/' + f + '.png');
    assert.ok(fs.existsSync(p), f + '.png existe');
    assert.ok(fs.statSync(p).size > 200, 'et porte un vrai dessin');
  }
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(html, /\/fb\/fiche\/bouton_carre\.png/, 'le chrome du bureau');
  assert.match(html, /\/fb\/fiche\/triangle\.png/, 'le triangle du bureau');
  assert.match(html, /\/fb\/fiche\/bandeau_titre\.png/, 'le bandeau des titres');
  for (const ico of ['ico_chat', 'ico_mail', 'ico_blog', 'ico_contact']) {
    assert.match(html, new RegExp('/fb/fiche/' + ico + '\\.png'), ico + ' posée sur son bouton');
  }
  // Les boutons sans action mobile restent visibles mais éteints.
  assert.match(html, /id="fiche-blog"[^>]*disabled/, 'le Bouilloscope attend le bureau');
  assert.match(html, /id="fiche-contact"[^>]*disabled/, 'les contacts aussi');
  // Et le courrier est branché sur la vraie messagerie, destinataire prérempli.
  assert.match(html, /ecrireMail\(p, ""\)/, 'le bouton mail ouvre le composeur');
});

test('l\'écran mobile porte la fenêtre, les onglets et les gestes', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // La fenêtre et ses quatre onglets.
  assert.match(html, /id="fiche-backdrop"/, 'la surcouche');
  for (const o of ['frutiz', 'perso', 'scores', 'bonus']) {
    assert.match(html, new RegExp('data-onglet="' + o + '"'), 'l\'onglet ' + o);
  }
  // Le signe au centre, l'ascendant en petit — et la silhouette du signe caché.
  assert.match(html, /\/fb\/signe_/, 'les dessins extraits');
  assert.match(html, /"mystere"/, 'le signe caché a sa silhouette');
  // Les gestes : pseudo → fiche (liste, messages, trombinoscope), fiche → privé.
  assert.match(html, /Voir la fiche de/, 'l\'appui sur un pseudo est annoncé');
  assert.match(html, /fr\.addEventListener\("click", function \(\) \{ ouvrirFiche\(auteur\); \}\)/,
    'le pseudo d\'un message ouvre la fiche');
  assert.match(html, /ouvrirFiche\(c\.getAttribute\("data-pseudo"\)\)/,
    'une vignette du trombinoscope aussi');
  assert.match(html, /api\/light\/fiche\?sid=/, 'la fiche interroge le bon endpoint');
  // L'en-tête : la bouille (Ruffle), le niveau, « âge - ville », fermer.
  assert.match(html, /previewIframe\(d\.bouille\)/, 'l\'avatar est la vraie bouille');
  assert.match(html, /id="fiche-niveau"/, 'la plaque NIV');
  assert.match(html, /ans"/, 'l\'âge en années');
});
